import {
    canonicalize,
    sha256BytesHex,
    sha256Hex
} from './agent-runtime-v5/content-hash';

export const MODEL_VISUAL_PRESENTATION_RECEIPT_VERSION =
    'model-visual-presentation-receipt/v0' as const;

export type ModelVisualPresentationMediaType =
    | 'image/jpeg'
    | 'image/png'
    | 'image/webp';

export interface ModelVisualPresentationReceiptImage {
    ordinal: number;
    candidateKey: string;
    mediaType: ModelVisualPresentationMediaType;
    decodedByteSha256: string;
    decodedByteLength: number;
}

/**
 * Provider 成功返回后才允许向 Renderer 暴露的逐图出站回执。
 *
 * `candidateKey` 是调用方提供的有界关联键；像素摘要、媒体类型与顺序必须从 Provider
 * 已序列化的实际 outgoing payload 反投影，不能从 Renderer 入站计划直接签发。
 */
export interface ModelVisualPresentationReceipt {
    version: typeof MODEL_VISUAL_PRESENTATION_RECEIPT_VERSION;
    provider: 'openai-codex' | 'openai-compatible';
    binding: 'successful_provider_turn';
    /** Provider thread / turn 身份的不可逆摘要，不暴露原始远端标识。 */
    attemptId: string;
    imageCount: number;
    images: readonly ModelVisualPresentationReceiptImage[];
    manifestSha256: string;
}

export interface ModelVisualPresentationReceiptRef {
    attemptId: string;
    manifestSha256: string;
}

export interface SerializedVisualImageProjection {
    mediaType: ModelVisualPresentationMediaType;
    decodedByteSha256: string;
    decodedByteLength: number;
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const MAX_VISUAL_PRESENTATION_IMAGES = 64;
const MAX_VISUAL_PRESENTATION_CANDIDATE_KEY_CHARS = 512;
const MAX_VISUAL_PRESENTATION_DECODED_BYTES = 64 * 1024 * 1024;
const SERIALIZED_IMAGE_DATA_URL_PATTERN =
    /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]*={0,2})$/u;

const MODEL_PROVIDERS_WITH_VISUAL_PRESENTATION_RECEIPTS = new Set([
    'openai-codex',
    'openai',
    'deepseek',
    'xiaomi',
    'smile-ai'
]);

function isModelVisualPresentationReceiptProvider(
    value: unknown
): value is ModelVisualPresentationReceipt['provider'] {
    return value === 'openai-codex' || value === 'openai-compatible';
}

/**
 * 当前在非流式 chat / provider-adapter 终态真正实现 serializer-owned 逐图出站收据的模型 Provider。
 *
 * 这是 transport 能力，不是视觉模型能力：调用方仍需确认具体模型支持视觉。直接流式
 * transport 目前不在此能力内；未列入的 Provider 保持 unknown，不能因请求成功或入站
 * 消息带图就补造回执。
 */
export function modelProviderSupportsNonStreamingVisualPresentationReceipt(
    provider: unknown
): boolean {
    return MODEL_PROVIDERS_WITH_VISUAL_PRESENTATION_RECEIPTS.has(
        String(provider || '').trim().toLowerCase()
    );
}

function readBase64Value(character: string): number {
    return BASE64_ALPHABET.indexOf(character);
}

/** 严格解码 canonical Base64；不接受中间 padding、无效尾位或超大载荷。 */
function decodeCanonicalBase64(value: string): Uint8Array | undefined {
    const encoded = String(value || '');
    if (!encoded || encoded.length % 4 !== 0) return undefined;
    let padding = 0;
    if (encoded.endsWith('==')) {
        padding = 2;
    } else if (encoded.endsWith('=')) {
        padding = 1;
    }
    const contentLength = encoded.length - padding;
    if (encoded.slice(0, contentLength).includes('=')) return undefined;
    const decodedLength = (encoded.length / 4) * 3 - padding;
    if (decodedLength <= 0 || decodedLength > MAX_VISUAL_PRESENTATION_DECODED_BYTES) {
        return undefined;
    }

    const output = new Uint8Array(decodedLength);
    let outputOffset = 0;
    for (let index = 0; index < encoded.length; index += 4) {
        const c0 = readBase64Value(encoded[index]);
        const c1 = readBase64Value(encoded[index + 1]);
        const c2 = encoded[index + 2] === '=' ? 0 : readBase64Value(encoded[index + 2]);
        const c3 = encoded[index + 3] === '=' ? 0 : readBase64Value(encoded[index + 3]);
        if (c0 < 0 || c1 < 0 || c2 < 0 || c3 < 0) return undefined;
        const isLast = index + 4 === encoded.length;
        if (!isLast && (encoded[index + 2] === '=' || encoded[index + 3] === '=')) {
            return undefined;
        }
        if (isLast && padding === 2 && (c1 & 0x0f) !== 0) return undefined;
        if (isLast && padding === 1 && (c2 & 0x03) !== 0) return undefined;

        const combined = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
        if (outputOffset < decodedLength) output[outputOffset++] = (combined >>> 16) & 0xff;
        if (outputOffset < decodedLength) output[outputOffset++] = (combined >>> 8) & 0xff;
        if (outputOffset < decodedLength) output[outputOffset++] = combined & 0xff;
    }
    return outputOffset === decodedLength ? output : undefined;
}

/** 从 Provider 已序列化的 data URL 反投影媒体类型与真实解码字节摘要。 */
export function projectSerializedVisualImageDataUrl(
    value: unknown
): SerializedVisualImageProjection | undefined {
    const matched = SERIALIZED_IMAGE_DATA_URL_PATTERN.exec(String(value || ''));
    if (!matched) return undefined;
    const bytes = decodeCanonicalBase64(matched[2]);
    if (!bytes) return undefined;
    return {
        mediaType: matched[1] as ModelVisualPresentationMediaType,
        decodedByteSha256: sha256BytesHex(bytes),
        decodedByteLength: bytes.length
    };
}

function normalizeCandidateKeys(values: readonly string[] | undefined): string[] | undefined {
    if (!Array.isArray(values)
        || values.length === 0
        || values.length > MAX_VISUAL_PRESENTATION_IMAGES) return undefined;
    const normalized = values.map((value) => String(value || '').trim());
    if (normalized.some((value) => (
        !value
        || value.length > MAX_VISUAL_PRESENTATION_CANDIDATE_KEY_CHARS
        || /^data:/iu.test(value)
    )) || new Set(normalized).size !== normalized.length) return undefined;
    return normalized;
}

function buildManifestSha256(input: {
    provider: ModelVisualPresentationReceipt['provider'];
    attemptId: string;
    images: readonly ModelVisualPresentationReceiptImage[];
}): string {
    return sha256Hex(canonicalize({
        version: MODEL_VISUAL_PRESENTATION_RECEIPT_VERSION,
        provider: input.provider,
        binding: 'successful_provider_turn',
        attemptId: input.attemptId,
        images: input.images
    }));
}

/**
 * 把已经从 Provider outgoing payload 反投影出的逐图摘要与调用方关联键按序绑定。
 * 数量、键、attempt 或任何图像投影不完整时不签发部分回执。
 */
export function buildModelVisualPresentationReceipt(input: {
    provider: ModelVisualPresentationReceipt['provider'];
    attemptId: string;
    candidateKeys: readonly string[] | undefined;
    serializedImages: readonly SerializedVisualImageProjection[];
}): ModelVisualPresentationReceipt | undefined {
    if (!isModelVisualPresentationReceiptProvider(input.provider)) return undefined;
    const attemptId = String(input.attemptId || '').trim().toLowerCase();
    const candidateKeys = normalizeCandidateKeys(input.candidateKeys);
    if (!/^[a-f0-9]{64}$/u.test(attemptId)
        || !candidateKeys
        || input.serializedImages.length !== candidateKeys.length) return undefined;
    const images = input.serializedImages.map((image, ordinal) => ({
        ordinal,
        candidateKey: candidateKeys[ordinal],
        mediaType: image.mediaType,
        decodedByteSha256: String(image.decodedByteSha256 || '').trim().toLowerCase(),
        decodedByteLength: Number(image.decodedByteLength)
    }));
    if (images.some((image) => (
        !['image/jpeg', 'image/png', 'image/webp'].includes(image.mediaType)
        || !/^[a-f0-9]{64}$/u.test(image.decodedByteSha256)
        || !Number.isSafeInteger(image.decodedByteLength)
        || image.decodedByteLength <= 0
        || image.decodedByteLength > MAX_VISUAL_PRESENTATION_DECODED_BYTES
    ))) return undefined;
    const manifestSha256 = buildManifestSha256({
        provider: input.provider,
        attemptId,
        images
    });
    return {
        version: MODEL_VISUAL_PRESENTATION_RECEIPT_VERSION,
        provider: input.provider,
        binding: 'successful_provider_turn',
        attemptId,
        imageCount: images.length,
        images,
        manifestSha256
    };
}

/** 读取并完整复算回执；序列化副本可以验证内容，但不能自行取得 Provider 成功语义。 */
export function readModelVisualPresentationReceipt(
    value: unknown
): ModelVisualPresentationReceipt | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const record = value as Partial<ModelVisualPresentationReceipt>;
    if (record.version !== MODEL_VISUAL_PRESENTATION_RECEIPT_VERSION
        || !isModelVisualPresentationReceiptProvider(record.provider)
        || record.binding !== 'successful_provider_turn'
        || !Array.isArray(record.images)
        || record.imageCount !== record.images.length
        || record.images.some((image, ordinal) => (
            !image
            || typeof image !== 'object'
            || image.ordinal !== ordinal
            || image.candidateKey !== String(image.candidateKey || '').trim()
            || image.decodedByteSha256
                !== String(image.decodedByteSha256 || '').trim().toLowerCase()
        ))) return undefined;
    const rebuilt = buildModelVisualPresentationReceipt({
        provider: record.provider,
        attemptId: String(record.attemptId || ''),
        candidateKeys: record.images.map((image) => String(image?.candidateKey || '')),
        serializedImages: record.images.map((image) => ({
            mediaType: image?.mediaType as ModelVisualPresentationMediaType,
            decodedByteSha256: String(image?.decodedByteSha256 || ''),
            decodedByteLength: Number(image?.decodedByteLength)
        }))
    });
    if (!rebuilt
        || rebuilt.attemptId !== record.attemptId
        || rebuilt.manifestSha256 !== String(record.manifestSha256 || '').trim().toLowerCase()) {
        return undefined;
    }
    return rebuilt;
}

/** 只有成功 transport attempt 可以取得回执引用；失败尝试一律返回空。 */
export function projectModelVisualPresentationReceiptRef(input: {
    succeeded: boolean;
    receipt: unknown;
}): ModelVisualPresentationReceiptRef | undefined {
    if (!input.succeeded) return undefined;
    const receipt = readModelVisualPresentationReceipt(input.receipt);
    return receipt ? {
        attemptId: receipt.attemptId,
        manifestSha256: receipt.manifestSha256
    } : undefined;
}
