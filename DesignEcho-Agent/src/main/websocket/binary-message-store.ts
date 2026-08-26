import type { BinaryHeader } from '../../shared/binary-protocol';
import { BinaryMessageType } from '../../shared/binary-protocol';

/**
 * UXP 二进制传输只用于图像/蒙版。旧实现允许单帧 500MB，且同一 Buffer 在两层
 * 无界缓存中驻留；几张大图即可把 Electron 推向 OOM。这里给传输层一个明确、可观测
 * 的内存边界。128MiB 仍可容纳约 5700×5700 的 RAW_RGBA，编码图通常更小。
 */
export const MAX_BINARY_FRAME_BYTES = 128 * 1024 * 1024;
export const MAX_BINARY_CACHE_BYTES = 192 * 1024 * 1024;
export const MAX_BINARY_CACHE_ENTRIES = 8;
export const BINARY_CACHE_TTL_MS = 30_000;
export const MAX_BINARY_IMAGE_DIMENSION = 30_000;
export const MAX_BINARY_IMAGE_PIXELS = 80_000_000;

export interface CachedBinaryMessage {
    header: BinaryHeader;
    imageData: Buffer;
    timestamp: number;
}

export interface BinaryFrameLimits {
    maxFrameBytes: number;
    maxDimension: number;
    maxPixels: number;
}

export type BinaryFrameValidation =
    | { ok: true }
    | { ok: false; code: string; reason: string };

const DEFAULT_FRAME_LIMITS: BinaryFrameLimits = {
    maxFrameBytes: MAX_BINARY_FRAME_BYTES,
    maxDimension: MAX_BINARY_IMAGE_DIMENSION,
    maxPixels: MAX_BINARY_IMAGE_PIXELS
};

function rawChannelCount(type: BinaryMessageType): number | undefined {
    switch (type) {
        case BinaryMessageType.RAW_MASK: return 1;
        case BinaryMessageType.RAW_RGB: return 3;
        case BinaryMessageType.RAW_RGBA: return 4;
        default: return undefined;
    }
}

export function validateIncomingBinaryFrame(
    header: BinaryHeader,
    imageData: Buffer,
    limits: BinaryFrameLimits = DEFAULT_FRAME_LIMITS
): BinaryFrameValidation {
    if (!Number.isSafeInteger(header.requestId) || header.requestId <= 0 || header.requestId > 0xffffffff) {
        return { ok: false, code: 'binary_request_id_invalid', reason: '二进制 requestId 无效。' };
    }
    if (!Object.values(BinaryMessageType).includes(header.type)) {
        return { ok: false, code: 'binary_type_invalid', reason: '二进制消息类型不受支持。' };
    }
    if (!Number.isSafeInteger(header.width)
        || !Number.isSafeInteger(header.height)
        || header.width <= 0
        || header.height <= 0
        || header.width > limits.maxDimension
        || header.height > limits.maxDimension) {
        return {
            ok: false,
            code: 'binary_dimensions_invalid',
            reason: `二进制图像尺寸无效：${header.width}x${header.height}。`
        };
    }
    const pixels = header.width * header.height;
    if (!Number.isSafeInteger(pixels) || pixels > limits.maxPixels) {
        return {
            ok: false,
            code: 'binary_pixel_budget_exceeded',
            reason: `二进制图像像素数超过上限：${header.width}x${header.height}。`
        };
    }
    if (!Buffer.isBuffer(imageData)
        || imageData.length <= 0
        || imageData.length > limits.maxFrameBytes) {
        return {
            ok: false,
            code: 'binary_frame_budget_exceeded',
            reason: `二进制图像大小超过上限：${imageData?.length || 0} bytes。`
        };
    }
    const channels = rawChannelCount(header.type);
    if (channels !== undefined) {
        const expectedBytes = pixels * channels;
        if (!Number.isSafeInteger(expectedBytes) || imageData.length !== expectedBytes) {
            return {
                ok: false,
                code: 'binary_raw_geometry_mismatch',
                reason: `RAW 二进制字节数与 ${header.width}x${header.height}x${channels} 不一致。`
            };
        }
    }
    return { ok: true };
}

interface BinaryMessageStoreOptions {
    maxEntries?: number;
    maxBytes?: number;
    ttlMs?: number;
    now?: () => number;
    scheduleCleanup?: boolean;
}

export interface BinaryMessageStoreDiagnostics {
    entryCount: number;
    residentBytes: number;
    rejectedCount: number;
    maxEntries: number;
    maxBytes: number;
    ttlMs: number;
}

interface RejectedBinaryMessage {
    code: string;
    reason: string;
    timestamp: number;
}

export class BoundedBinaryMessageStore {
    private readonly entries = new Map<number, CachedBinaryMessage>();
    private readonly rejections = new Map<number, RejectedBinaryMessage>();
    private readonly maxEntries: number;
    private readonly maxBytes: number;
    private readonly ttlMs: number;
    private readonly now: () => number;
    private readonly scheduleCleanup: boolean;
    private residentBytes = 0;
    private cleanupTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(options: BinaryMessageStoreOptions = {}) {
        this.maxEntries = Math.max(1, Math.floor(options.maxEntries || MAX_BINARY_CACHE_ENTRIES));
        this.maxBytes = Math.max(1, Math.floor(options.maxBytes || MAX_BINARY_CACHE_BYTES));
        this.ttlMs = Math.max(1, Math.floor(options.ttlMs || BINARY_CACHE_TTL_MS));
        this.now = options.now || Date.now;
        this.scheduleCleanup = options.scheduleCleanup !== false;
    }

    put(message: CachedBinaryMessage): { accepted: true } | { accepted: false; code: string; reason: string } {
        this.pruneExpired();
        this.removeEntry(message.header.requestId);
        this.rejections.delete(message.header.requestId);
        const nextBytes = this.residentBytes + message.imageData.length;
        if (this.entries.size >= this.maxEntries || nextBytes > this.maxBytes) {
            const code = 'binary_cache_capacity_exceeded';
            const reason = `二进制暂存区已满（${this.entries.size}/${this.maxEntries} 帧，${this.residentBytes}/${this.maxBytes} bytes）。`;
            this.recordRejection(message.header.requestId, code, reason, message.timestamp);
            return { accepted: false, code, reason };
        }
        this.entries.set(message.header.requestId, message);
        this.residentBytes = nextBytes;
        this.armCleanupTimer();
        return { accepted: true };
    }

    take(requestId: number): CachedBinaryMessage | undefined {
        this.pruneExpired();
        const entry = this.entries.get(requestId);
        if (!entry) return undefined;
        this.removeEntry(requestId);
        this.armCleanupTimer();
        return entry;
    }

    recordRejection(requestId: number, code: string, reason: string, timestamp = this.now()): void {
        // 同一 requestId 后续出现非法/超预算帧时，旧 Buffer 不能继续驻留或被误消费。
        this.removeEntry(requestId);
        this.rejections.set(requestId, {
            code: String(code || 'binary_frame_rejected'),
            reason: String(reason || '二进制帧被拒绝。'),
            timestamp
        });
        while (this.rejections.size > this.maxEntries * 2) {
            const oldestId = this.rejections.keys().next().value as number | undefined;
            if (oldestId === undefined) break;
            this.rejections.delete(oldestId);
        }
        this.armCleanupTimer();
    }

    takeRejection(requestId: number): { code: string; reason: string } | undefined {
        this.pruneExpired();
        const rejection = this.rejections.get(requestId);
        if (!rejection) return undefined;
        this.rejections.delete(requestId);
        this.armCleanupTimer();
        return { code: rejection.code, reason: rejection.reason };
    }

    pruneExpired(now = this.now()): void {
        for (const [requestId, entry] of this.entries) {
            if (now - entry.timestamp >= this.ttlMs) this.removeEntry(requestId);
        }
        for (const [requestId, rejection] of this.rejections) {
            if (now - rejection.timestamp >= this.ttlMs) this.rejections.delete(requestId);
        }
        this.armCleanupTimer();
    }

    clear(): void {
        if (this.cleanupTimer) clearTimeout(this.cleanupTimer);
        this.cleanupTimer = null;
        this.entries.clear();
        this.rejections.clear();
        this.residentBytes = 0;
    }

    getDiagnostics(): BinaryMessageStoreDiagnostics {
        this.pruneExpired();
        return {
            entryCount: this.entries.size,
            residentBytes: this.residentBytes,
            rejectedCount: this.rejections.size,
            maxEntries: this.maxEntries,
            maxBytes: this.maxBytes,
            ttlMs: this.ttlMs
        };
    }

    private removeEntry(requestId: number): void {
        const entry = this.entries.get(requestId);
        if (!entry) return;
        this.entries.delete(requestId);
        this.residentBytes = Math.max(0, this.residentBytes - entry.imageData.length);
    }

    private armCleanupTimer(): void {
        if (!this.scheduleCleanup) return;
        if (this.cleanupTimer) clearTimeout(this.cleanupTimer);
        this.cleanupTimer = null;
        let earliestExpiry = Number.POSITIVE_INFINITY;
        for (const entry of this.entries.values()) {
            earliestExpiry = Math.min(earliestExpiry, entry.timestamp + this.ttlMs);
        }
        for (const rejection of this.rejections.values()) {
            earliestExpiry = Math.min(earliestExpiry, rejection.timestamp + this.ttlMs);
        }
        if (!Number.isFinite(earliestExpiry)) return;
        this.cleanupTimer = setTimeout(() => {
            this.cleanupTimer = null;
            this.pruneExpired();
        }, Math.max(1, earliestExpiry - this.now()));
        this.cleanupTimer.unref?.();
    }
}
