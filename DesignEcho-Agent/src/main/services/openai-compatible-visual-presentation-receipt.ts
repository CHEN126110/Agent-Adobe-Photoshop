import { sha256Hex } from '../../shared/agent-runtime-v5/content-hash';
import {
    buildModelVisualPresentationReceipt,
    modelProviderSupportsNonStreamingVisualPresentationReceipt,
    projectSerializedVisualImageDataUrl,
    type ModelVisualPresentationReceipt,
    type SerializedVisualImageProjection
} from '../../shared/model-visual-presentation-receipt';

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readSerializedImageUrl(block: unknown): unknown {
    if (!isRecord(block) || block.type !== 'image_url' || !isRecord(block.image_url)) {
        return undefined;
    }
    return block.image_url.url;
}

/**
 * 只读取已经由 OpenAI-compatible serializer 构造的 `messages[].content[].image_url.url`。
 * 不递归扫描任意字段，也不接受 Renderer 入站 image block，避免把“准备发送”冒充“已序列化”。
 */
export function projectOpenAICompatibleSerializedOutgoingImages(
    formattedMessages: unknown
): SerializedVisualImageProjection[] | undefined {
    if (!Array.isArray(formattedMessages)) return undefined;
    const images: SerializedVisualImageProjection[] = [];
    for (const message of formattedMessages) {
        if (!isRecord(message) || !Array.isArray(message.content)) continue;
        for (const block of message.content) {
            const imageUrl = readSerializedImageUrl(block);
            if (imageUrl === undefined) continue;
            const projection = projectSerializedVisualImageDataUrl(imageUrl);
            if (!projection) return undefined;
            images.push(projection);
        }
    }
    return images;
}

/**
 * 为一次已经完整成功的 OpenAI-compatible Chat Completions turn 签发逐图出站收据。
 *
 * responseId / created / provider / model 只参与不可逆 attemptId，不进入回执。调用点必须在
 * Provider 完整终态和正文校验之后调用；没有 responseId、候选键或精确图片序列时整份缺席。
 */
export function buildOpenAICompatibleSuccessfulVisualPresentationReceipt(input: {
    provider: string;
    modelId: string;
    formattedMessages: unknown;
    candidateKeys: readonly string[] | undefined;
    responseId: unknown;
    responseCreated?: unknown;
}): ModelVisualPresentationReceipt | undefined {
    const provider = String(input.provider || '').trim().toLowerCase();
    const modelId = String(input.modelId || '').trim();
    const responseId = String(input.responseId || '').trim();
    if (!modelProviderSupportsNonStreamingVisualPresentationReceipt(provider)
        || provider === 'openai-codex'
        || !modelId
        || !responseId
        || !Array.isArray(input.candidateKeys)
        || input.candidateKeys.length === 0) {
        return undefined;
    }
    const serializedImages = projectOpenAICompatibleSerializedOutgoingImages(
        input.formattedMessages
    );
    if (!serializedImages) return undefined;
    const attemptId = sha256Hex(JSON.stringify({
        serializer: 'openai-compatible-chat-completions',
        provider,
        modelId,
        responseId,
        responseCreated: Number(input.responseCreated) || null
    }));
    return buildModelVisualPresentationReceipt({
        provider: 'openai-compatible',
        attemptId,
        candidateKeys: input.candidateKeys,
        serializedImages
    });
}
