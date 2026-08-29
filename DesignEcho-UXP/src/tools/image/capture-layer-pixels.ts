import { app } from 'photoshop';

import { BinaryMessageType } from '../../core/binary-protocol';
import { calculateImageSourceChecksum } from '../../core/image-source-identity';
import {
    readActiveHistoryStateRef,
    sameHistoryStateRef
} from '../../core/photoshop-history-state-ref';
import { createToolFailureResult } from '../../core/tool-error-normalizer';
import type { Tool, ToolExecutionContext, ToolResult } from '../types';
import { exportLayerAsBase64 } from './export-layer';
import {
    LAYER_PIXEL_CAPTURE_VERSION,
    type LayerPixelCaptureBounds,
    type LayerPixelCaptureReceipt
} from './layer-pixel-capture-contract';

interface LayerPixelCaptureTransport {
    isConnected(): boolean;
    allocBinaryRequestId(): number;
    sendBinaryData(
        type: BinaryMessageType,
        requestId: number,
        width: number,
        height: number,
        data: Uint8Array
    ): void;
}

interface CaptureLayerPixelsParams {
    layerId: number;
    maxSize?: number;
}

interface CaptureLayerPixelsData extends LayerPixelCaptureReceipt {}

function readPositiveInteger(value: unknown, fieldName: string): number {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new Error(`captureLayerPixels ${fieldName} 必须是正整数。`);
    }
    return parsed;
}

function normalizeMaxSize(value: unknown): number {
    if (value === undefined) return 8192;
    const parsed = readPositiveInteger(value, 'maxSize');
    if (parsed > 8192) {
        throw new Error('captureLayerPixels maxSize 不能超过 8192。');
    }
    return parsed;
}

function readBounds(value: unknown): LayerPixelCaptureBounds {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('captureLayerPixels 缺少图层 contentBounds。');
    }
    const record = value as Record<string, unknown>;
    const left = Number(record.left);
    const top = Number(record.top);
    const right = Number(record.right);
    const bottom = Number(record.bottom);
    const width = Number(record.width);
    const height = Number(record.height);
    if (![left, top, right, bottom, width, height].every(Number.isFinite)
        || width <= 0 || height <= 0
        || Math.abs(right - left - width) > 1.1
        || Math.abs(bottom - top - height) > 1.1) {
        throw new Error('captureLayerPixels contentBounds 无效。');
    }
    return { left, top, right, bottom, width, height };
}

function readRawPixels(value: unknown): Uint8Array {
    if (value instanceof Uint8Array && value.length > 0) return value;
    if (value && typeof value === 'object') {
        const view = value as {
            buffer?: ArrayBuffer;
            byteOffset?: number;
            byteLength?: number;
            length?: number;
        };
        if (view.buffer instanceof ArrayBuffer
            && Number.isSafeInteger(view.byteLength)
            && Number(view.byteLength) > 0) {
            return new Uint8Array(
                view.buffer,
                Number(view.byteOffset) || 0,
                Number(view.byteLength)
            );
        }
    }
    throw new Error('captureLayerPixels 没有取得有效的 RGBA 像素。');
}

export class CaptureLayerPixelsTool implements Tool {
    name = 'captureLayerPixels';

    private transport: LayerPixelCaptureTransport | null = null;

    schema = {
        name: this.name,
        description: 'Provider 内部无损图层像素捕获：显式绑定当前文档、历史版本和图层，以 RAW RGBA 二进制帧返回，不创建临时 Photoshop 文档。',
        parameters: {
            type: 'object' as const,
            properties: {
                layerId: { type: 'number', description: '要捕获的图层 ID' },
                maxSize: { type: 'number', description: '最大边长；超过时拒绝 Provider 精确回写' }
            },
            required: ['layerId']
        }
    };

    setWebSocketClient(client: LayerPixelCaptureTransport): void {
        this.transport = client;
    }

    async execute(
        rawParams: CaptureLayerPixelsParams,
        _context?: ToolExecutionContext
    ): Promise<ToolResult<CaptureLayerPixelsData>> {
        try {
            const layerId = readPositiveInteger(rawParams?.layerId, 'layerId');
            const maxSize = normalizeMaxSize(rawParams?.maxSize);
            if (!this.transport?.isConnected()) {
                throw new Error('captureLayerPixels 二进制传输通道未连接。');
            }
            const document = app.activeDocument;
            const before = readActiveHistoryStateRef(document);
            if (!before) {
                throw new Error('captureLayerPixels 无法读取当前 Photoshop 文档版本。');
            }
            const exported = await exportLayerAsBase64({
                layerId,
                mode: 'pixels-rgba',
                maxSize
            });
            if (exported.success !== true || !exported.data) {
                throw new Error(exported.error || 'captureLayerPixels 像素读取失败。');
            }
            const data = exported.data;
            const width = readPositiveInteger(data.width, 'width');
            const height = readPositiveInteger(data.height, 'height');
            const components = Number(data.components);
            const componentSize = Number(data.componentSize);
            const contentBounds = readBounds(data.contentBounds);
            const rawPixels = readRawPixels(data.rawPixels);
            if (data.mimeType !== 'image/x-raw-rgba'
                || components !== 4
                || componentSize !== 8
                || rawPixels.length !== width * height * 4) {
                throw new Error('captureLayerPixels 返回的 RGBA 通道或字节长度无效。');
            }
            if (Math.abs(width - Math.round(contentBounds.width)) > 1
                || Math.abs(height - Math.round(contentBounds.height)) > 1) {
                throw new Error(
                    `captureLayerPixels 实际像素 ${width}×${height} 与图层 bounds `
                    + `${contentBounds.width.toFixed(1)}×${contentBounds.height.toFixed(1)} 不一致；`
                    + '精确回写路径禁止使用降采样结果。'
                );
            }
            const after = readActiveHistoryStateRef(app.activeDocument);
            if (!sameHistoryStateRef(before, after)) {
                throw new Error('captureLayerPixels 读取期间 Photoshop 文档或历史版本发生变化。');
            }

            const binaryRequestId = this.transport.allocBinaryRequestId();
            this.transport.sendBinaryData(
                BinaryMessageType.RAW_RGBA,
                binaryRequestId,
                width,
                height,
                rawPixels
            );
            const receipt: LayerPixelCaptureReceipt = {
                version: LAYER_PIXEL_CAPTURE_VERSION,
                binaryRequestId,
                mimeType: 'image/x-raw-rgba',
                width,
                height,
                components: 4,
                componentSize: 8,
                byteLength: rawPixels.length,
                checksum: calculateImageSourceChecksum(rawPixels),
                contentBounds,
                targetIdentity: {
                    documentId: before.documentId,
                    historyStateId: before.historyStateId,
                    layerId
                },
                ...(typeof data.colorProfile === 'string' && data.colorProfile.trim()
                    ? { colorProfile: data.colorProfile.trim() }
                    : {}),
                noMutation: true
            };
            return {
                success: true,
                data: receipt
            };
        } catch (error) {
            return {
                ...createToolFailureResult({
                    toolName: 'captureLayerPixels',
                    error,
                    params: {
                        layerId: rawParams?.layerId,
                        maxSize: rawParams?.maxSize
                    }
                }),
                success: false,
                data: null
            };
        }
    }
}
