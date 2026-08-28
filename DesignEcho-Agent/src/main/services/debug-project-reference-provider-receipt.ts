import crypto from 'crypto';
import {
    DEBUG_BRIDGE_PROJECT_ASSET_PROVIDER_RECEIPT_VERSION,
    readDebugBridgeModelTransportMetadata,
    readDebugBridgeProjectAssetAttachments,
    readDebugBridgeProjectAssetPayloadBinding,
    type DebugBridgeProjectAssetAttachment,
    type DebugBridgeProjectAssetPayloadBinding,
    type DebugBridgeProjectAssetProviderReceipt
} from '../../shared/debug-bridge-chat';
import { readModelVisualPresentationReceipt } from '../../shared/model-visual-presentation-receipt';

const MAX_PROVIDER_REFERENCE_PAYLOAD_BYTES = 8 * 1024 * 1024;
const MAX_PROVIDER_REFERENCE_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_PROVIDER_REFERENCE_BASE64_CHARS = Math.ceil(
    MAX_PROVIDER_REFERENCE_PAYLOAD_BYTES / 3
) * 4;
const DEBUG_PROJECT_REFERENCE_LEASE_TOKEN_PATTERN = /^[a-f0-9]{64}$/u;

type DebugProjectReferenceTransport =
    | 'chat'
    | 'chat_with_tools'
    | 'chat_with_tools_stream';

interface DebugProjectReferenceProviderLease {
    requestId: string;
    leaseToken: string;
    binding: DebugBridgeProjectAssetPayloadBinding;
    attachments: DebugBridgeProjectAssetAttachment[];
    receipt?: DebugBridgeProjectAssetProviderReceipt;
}

export interface DebugProjectReferenceProviderCandidate {
    requestId: string;
    leaseToken: string;
    bindingDigest: string;
    referenceCount: number;
    transport: DebugProjectReferenceTransport;
    providerAttemptRef: string;
    matchedAt: string;
    candidateKeys: string[];
    images: Array<{
        mediaType: string;
        payloadDigest: string;
        decodedByteLength: number;
    }>;
}

interface ProviderBoundaryImageBlock {
    data: string;
    mediaType: string;
}

let activeLease: DebugProjectReferenceProviderLease | null = null;

function sha256Buffer(value: Buffer): string {
    return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

function decodeCanonicalBase64(value: string): Buffer | null {
    const normalized = String(value || '').trim();
    if (!normalized
        || normalized.length > MAX_PROVIDER_REFERENCE_BASE64_CHARS
        || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) return null;
    const decoded = Buffer.from(normalized, 'base64');
    return decoded.length > 0 && decoded.toString('base64') === normalized ? decoded : null;
}

function buildBindingEvidence(attachments: DebugBridgeProjectAssetAttachment[]): Array<{
    relativePath: string;
    sourceDigest: string;
    payloadDigest: string;
    mediaType: string;
    width: number;
    height: number;
}> {
    return attachments.map((attachment) => ({
        relativePath: attachment.relativePath,
        sourceDigest: attachment.sourceDigest,
        payloadDigest: attachment.payloadDigest,
        mediaType: attachment.mediaType,
        width: attachment.width,
        height: attachment.height
    }));
}

function validateLeasePayload(
    attachments: DebugBridgeProjectAssetAttachment[],
    binding: DebugBridgeProjectAssetPayloadBinding
): void {
    if (attachments.length === 0 || binding.referenceCount !== attachments.length) {
        throw new Error('Main Provider 参考收据租约缺少视觉载荷。');
    }
    let totalBytes = 0;
    for (const attachment of attachments) {
        const decoded = decodeCanonicalBase64(attachment.data);
        if (!decoded
            || decoded.length > MAX_PROVIDER_REFERENCE_PAYLOAD_BYTES
            || sha256Buffer(decoded) !== attachment.payloadDigest
            || attachment.width > 3072
            || attachment.height > 3072) {
            throw new Error(`Main Provider 参考视觉载荷与摘要不一致：${attachment.relativePath}`);
        }
        totalBytes += decoded.length;
    }
    if (totalBytes > MAX_PROVIDER_REFERENCE_TOTAL_BYTES) {
        throw new Error('Main Provider 参考视觉载荷超过总大小边界。');
    }
    const expectedBindingDigest = sha256Buffer(Buffer.from(
        JSON.stringify(buildBindingEvidence(attachments)),
        'utf8'
    ));
    if (expectedBindingDigest !== binding.bindingDigest) {
        throw new Error('Main Provider 参考视觉载荷 binding 摘要不一致。');
    }
}

function readImageBlocks(message: unknown): ProviderBoundaryImageBlock[] {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return [];
    const record = message as Record<string, unknown>;
    if (record['role'] !== 'user') return [];
    const contentBlocks = Array.isArray(record['contentBlocks'])
        ? record['contentBlocks']
        : (Array.isArray(record['content']) ? record['content'] : []);
    return contentBlocks
        .filter((block) => Boolean(block && typeof block === 'object' && !Array.isArray(block)))
        .map((block) => block as Record<string, unknown>)
        .filter((block) => block['type'] === 'image')
        .map((block) => {
            const nestedImage = block['image'] && typeof block['image'] === 'object'
                && !Array.isArray(block['image'])
                ? block['image'] as Record<string, unknown>
                : {};
            return {
                data: String(block['data'] || nestedImage['data'] || ''),
                mediaType: String(
                    block['mediaType'] || nestedImage['mediaType'] || 'image/jpeg'
                )
            };
        });
}

function messageImagesMatchLease(
    images: ProviderBoundaryImageBlock[],
    lease: DebugProjectReferenceProviderLease
): boolean {
    if (images.length !== lease.attachments.length) return false;
    return lease.attachments.every((attachment, index) => {
        const image = images[index];
        const decoded = decodeCanonicalBase64(image?.data || '');
        return Boolean(
            decoded
            && image?.mediaType === attachment.mediaType
            && sha256Buffer(decoded) === attachment.payloadDigest
        );
    });
}

function readSerializedDataUrl(value: unknown): ProviderBoundaryImageBlock | null {
    const matched = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/u.exec(
        String(value || '')
    );
    return matched ? { mediaType: matched[1], data: matched[2] } : null;
}

function projectSerializedProviderImages(value: unknown): ProviderBoundaryImageBlock[] {
    const images: ProviderBoundaryImageBlock[] = [];
    function visit(node: unknown): void {
        if (Array.isArray(node)) {
            node.forEach(visit);
            return;
        }
        if (!node || typeof node !== 'object') return;
        const record = node as Record<string, unknown>;
        if (record['type'] === 'image_url') {
            const imageUrl = record['image_url'] && typeof record['image_url'] === 'object'
                && !Array.isArray(record['image_url'])
                ? (record['image_url'] as Record<string, unknown>)['url']
                : undefined;
            const projected = readSerializedDataUrl(imageUrl);
            if (projected) images.push(projected);
            return;
        }
        if (record['type'] === 'image') {
            const source = record['source'] && typeof record['source'] === 'object'
                && !Array.isArray(record['source'])
                ? record['source'] as Record<string, unknown>
                : {};
            const projected = readSerializedDataUrl(record['url']);
            if (projected) {
                images.push(projected);
                return;
            }
            if (source['type'] === 'base64'
                && typeof source['data'] === 'string'
                && typeof source['media_type'] === 'string') {
                images.push({
                    data: source['data'],
                    mediaType: source['media_type']
                });
                return;
            }
        }
        const inlineData = record['inlineData'] && typeof record['inlineData'] === 'object'
            && !Array.isArray(record['inlineData'])
            ? record['inlineData'] as Record<string, unknown>
            : undefined;
        if (inlineData
            && typeof inlineData['data'] === 'string'
            && typeof inlineData['mimeType'] === 'string') {
            images.push({
                data: inlineData['data'],
                mediaType: inlineData['mimeType']
            });
            return;
        }
        if (Array.isArray(record['images'])) {
            for (const data of record['images']) {
                if (typeof data === 'string') {
                    images.push({ data, mediaType: 'image/jpeg' });
                }
            }
        }
        for (const key of ['messages', 'content', 'contents', 'parts']) {
            if (Array.isArray(record[key])) visit(record[key]);
        }
    }
    visit(value);
    return images;
}

function serializedProviderImagesMatchCandidate(
    formattedRequest: unknown,
    candidate: DebugProjectReferenceProviderCandidate
): boolean {
    const images = projectSerializedProviderImages(formattedRequest);
    if (images.length !== candidate.images.length) return false;
    return images.every((image, index) => {
        const decoded = decodeCanonicalBase64(image.data);
        return Boolean(
            decoded
            && image.mediaType === candidate.images[index]?.mediaType
            && sha256Buffer(decoded) === candidate.images[index]?.payloadDigest
            && decoded.length === candidate.images[index]?.decodedByteLength
        );
    });
}

export function armDebugProjectReferenceProviderReceipt(input: {
    requestId: string;
    leaseToken: string;
    attachments: unknown;
    binding: unknown;
}): void {
    if (activeLease) {
        throw new Error('已有 Main Provider 参考收据租约尚未闭合。');
    }
    const requestId = String(input.requestId || '').trim();
    const leaseToken = String(input.leaseToken || '').trim();
    const attachments = readDebugBridgeProjectAssetAttachments(input.attachments);
    const binding = readDebugBridgeProjectAssetPayloadBinding(input.binding);
    if (!requestId || !attachments || !binding) {
        throw new Error('Main Provider 参考收据租约无效。');
    }
    if (binding.referenceCount === 0) return;
    if (!DEBUG_PROJECT_REFERENCE_LEASE_TOKEN_PATTERN.test(leaseToken)) {
        throw new Error('Main Provider 参考收据租约缺少请求级绑定。');
    }
    validateLeasePayload(attachments, binding);
    activeLease = {
        requestId,
        leaseToken,
        binding,
        attachments
    };
}

export function prepareDebugProjectReferenceProviderCandidate(
    messages: unknown[],
    transport: DebugProjectReferenceTransport,
    debugTransportMetadata: unknown
): DebugProjectReferenceProviderCandidate | null {
    const lease = activeLease;
    if (!lease || lease.receipt) return null;
    const metadata = readDebugBridgeModelTransportMetadata(debugTransportMetadata);
    if (!metadata
        || lease.leaseToken !== metadata.projectReferenceLeaseToken
        || lease.binding.bindingDigest !== metadata.projectReferenceBindingDigest) {
        const error = new Error(
            '活动中的受控参考图请求缺少正确的 Main 模型传输租约，已在调用 Provider 前中止。'
        ) as Error & { code?: string };
        error.code = 'debug_project_reference_transport_metadata_invalid';
        throw error;
    }
    const matchingMessages = (Array.isArray(messages) ? messages : [])
        .filter((message) => messageImagesMatchLease(readImageBlocks(message), lease));
    if (matchingMessages.length !== 1) {
        const error = new Error(
            '活动中的受控参考图请求没有唯一携带 Main 验真的目标参考像素，已在调用 Provider 前中止。'
        ) as Error & { code?: string };
        error.code = 'debug_project_reference_provider_pixels_missing';
        throw error;
    }
    return {
        requestId: lease.requestId,
        leaseToken: lease.leaseToken,
        bindingDigest: lease.binding.bindingDigest,
        referenceCount: lease.binding.referenceCount,
        transport,
        providerAttemptRef: sha256Buffer(Buffer.from(JSON.stringify({
            requestId: lease.requestId,
            bindingDigest: lease.binding.bindingDigest,
            transport,
            nonce: crypto.randomBytes(32).toString('hex')
        }), 'utf8')),
        matchedAt: new Date().toISOString(),
        candidateKeys: lease.attachments.map((attachment, index) => (
            `debug-project-reference:${lease.binding.bindingDigest.slice(7)}:${index}:${attachment.payloadDigest.slice(7)}`
        )),
        images: lease.attachments.map((attachment) => ({
            mediaType: attachment.mediaType,
            payloadDigest: attachment.payloadDigest,
            decodedByteLength: decodeCanonicalBase64(attachment.data)?.length || 0
        }))
    };
}

export function readDebugProjectReferenceProviderCandidateKeys(
    candidate: DebugProjectReferenceProviderCandidate | null
): string[] | undefined {
    return candidate ? [...candidate.candidateKeys] : undefined;
}

export function commitDebugProjectReferenceProviderReceipt(
    candidate: DebugProjectReferenceProviderCandidate | null,
    options: {
        provider: string;
        modelId: string;
        visualPresentationReceipt?: unknown;
        formattedRequest?: unknown;
    }
): DebugBridgeProjectAssetProviderReceipt | undefined {
    if (!candidate || !activeLease || activeLease.requestId !== candidate.requestId
        || activeLease.leaseToken !== candidate.leaseToken
        || activeLease.binding.bindingDigest !== candidate.bindingDigest
        || activeLease.binding.referenceCount !== candidate.referenceCount) {
        return undefined;
    }
    const provider = String(options.provider || '').trim();
    const modelId = String(options.modelId || '').trim();
    if (!provider || !modelId) return undefined;
    if (provider === 'openai-codex') {
        const outgoingReceipt = readModelVisualPresentationReceipt(
            options.visualPresentationReceipt
        );
        if (!outgoingReceipt
            || outgoingReceipt.images.length !== candidate.images.length
            || outgoingReceipt.images.some((image, index) => (
                image.candidateKey !== candidate.candidateKeys[index]
                || image.mediaType !== candidate.images[index]?.mediaType
                || image.decodedByteSha256 !== candidate.images[index]?.payloadDigest.slice(7)
                || image.decodedByteLength !== candidate.images[index]?.decodedByteLength
            ))) {
            return undefined;
        }
    } else if (!serializedProviderImagesMatchCandidate(
        options.formattedRequest,
        candidate
    )) {
        return undefined;
    }
    const receipt: DebugBridgeProjectAssetProviderReceipt = {
        version: DEBUG_BRIDGE_PROJECT_ASSET_PROVIDER_RECEIPT_VERSION,
        bindingDigest: candidate.bindingDigest,
        referenceCount: candidate.referenceCount,
        visualBlockCount: candidate.referenceCount,
        matchedAtProviderBoundary: true,
        provider,
        modelId,
        transport: candidate.transport,
        providerAttemptRef: candidate.providerAttemptRef,
        matchedAt: candidate.matchedAt,
        committedAt: new Date().toISOString()
    };
    activeLease.receipt = receipt;
    return receipt;
}

export function readDebugProjectReferenceProviderReceipt(
    requestId: string
): DebugBridgeProjectAssetProviderReceipt | undefined {
    if (!activeLease || activeLease.requestId !== String(requestId || '').trim()) return undefined;
    return activeLease.receipt ? { ...activeLease.receipt } : undefined;
}

export function clearDebugProjectReferenceProviderReceipt(requestId: string): void {
    if (activeLease?.requestId === String(requestId || '').trim()) activeLease = null;
}
