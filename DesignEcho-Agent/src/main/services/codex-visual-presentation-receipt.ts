import { sha256Hex } from '../../shared/agent-runtime-v5/content-hash';
import {
    buildModelVisualPresentationReceipt,
    projectSerializedVisualImageDataUrl,
    type ModelVisualPresentationReceipt,
    type SerializedVisualImageProjection
} from '../../shared/model-visual-presentation-receipt';

export interface CodexSerializedConversation {
    historyItems: unknown[];
    currentInput: unknown[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function collectSerializedImageProjection(
    output: SerializedVisualImageProjection[],
    value: unknown
): boolean {
    const projected = projectSerializedVisualImageDataUrl(value);
    if (!projected) return false;
    output.push(projected);
    return true;
}

/**
 * 只读取 Codex Bridge 已构造出的 outgoing 形状：历史 `input_image.image_url` 与本轮
 * `image.url`。不递归扫描任意字段，避免把文本中的 data URL 或 Renderer 入站块误签为出站图。
 */
export function projectCodexSerializedOutgoingImages(
    prepared: CodexSerializedConversation
): SerializedVisualImageProjection[] | undefined {
    const images: SerializedVisualImageProjection[] = [];
    for (const item of prepared.historyItems) {
        if (!isRecord(item)
            || item.type !== 'message'
            || item.role !== 'user'
            || !Array.isArray(item.content)) continue;
        for (const block of item.content) {
            if (!isRecord(block) || block.type !== 'input_image') continue;
            if (!collectSerializedImageProjection(images, block.image_url)) return undefined;
        }
    }
    for (const block of prepared.currentInput) {
        if (!isRecord(block) || block.type !== 'image') continue;
        if (!collectSerializedImageProjection(images, block.url)) return undefined;
    }
    return images;
}

/**
 * 为已经成功返回的 Codex 首次 turn 签发逐图 outgoing receipt。
 *
 * 调用点必须传首次带图评分 turn 的真实 thread/turn/generation；这些原始标识只用于构造
 * 不可逆 attemptId，不进入回执。候选键数量与实际 outgoing 图片不精确一致时保持无回执。
 */
export function buildCodexSuccessfulVisualPresentationReceipt(input: {
    prepared: CodexSerializedConversation;
    candidateKeys: readonly string[] | undefined;
    workerGeneration: number;
    threadId: string;
    turnId: string;
}): ModelVisualPresentationReceipt | undefined {
    if (!Array.isArray(input.candidateKeys) || input.candidateKeys.length === 0) return undefined;
    const threadId = String(input.threadId || '').trim();
    const turnId = String(input.turnId || '').trim();
    const workerGeneration = Number(input.workerGeneration);
    if (!threadId
        || !turnId
        || !Number.isSafeInteger(workerGeneration)
        || workerGeneration < 0) return undefined;
    const serializedImages = projectCodexSerializedOutgoingImages(input.prepared);
    if (!serializedImages) return undefined;
    const attemptId = sha256Hex(JSON.stringify({
        provider: 'openai-codex',
        workerGeneration,
        threadId,
        turnId
    }));
    return buildModelVisualPresentationReceipt({
        provider: 'openai-codex',
        attemptId,
        candidateKeys: input.candidateKeys,
        serializedImages
    });
}
