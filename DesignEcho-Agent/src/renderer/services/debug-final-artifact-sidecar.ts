import type {
    AgentDebugSkuDeliverySource,
    AgentFinalDeliveryDebugProjection
} from './agent-runtime/final-delivery-artifact-collector';

const MAX_DEBUG_FINAL_ARTIFACT_PATH_CANDIDATES = 97;

interface DebugFinalArtifactCaptureState {
    pathCandidates?: unknown;
    skuDeliverySource?: AgentDebugSkuDeliverySource;
}

const debugFinalArtifactCaptureByRequest = new Map<string, DebugFinalArtifactCaptureState>();

function normalizeRequestId(value: unknown): string {
    return String(value || '').trim();
}

function capturePathCandidates(values: unknown): unknown {
    if (!Array.isArray(values)) return null;
    if (values.length === 0) return undefined;
    // 第 97 项只用于保留 overflow 事实；真正的上限仍由收据投影校验为 96。
    // 这里不能先过滤、去重或截成 96，否则非法输入会被压扁成可信集合。
    return values.slice(0, MAX_DEBUG_FINAL_ARTIFACT_PATH_CANDIDATES);
}

/**
 * 为一次已通过 Guarded Photoshop baseline 的 Debug Bridge 请求建立瞬态 sidecar。
 * 这里不持久化、不进入 Agent Runtime 类型，也不参与任务完成或质量判断。
 */
export function beginDebugFinalArtifactCapture(requestId: unknown): void {
    const normalizedRequestId = normalizeRequestId(requestId);
    if (!normalizedRequestId) return;
    debugFinalArtifactCaptureByRequest.set(normalizedRequestId, {});
}

/**
 * 仅更新已经由 Debug Bridge 显式建立的请求；普通 Agent 运行无法自行开启捕获。
 */
export function publishDebugFinalArtifactPaths(
    requestId: unknown,
    paths: unknown
): void {
    const normalizedRequestId = normalizeRequestId(requestId);
    if (!normalizedRequestId || !debugFinalArtifactCaptureByRequest.has(normalizedRequestId)) return;
    debugFinalArtifactCaptureByRequest.set(normalizedRequestId, {
        pathCandidates: capturePathCandidates(paths)
    });
}

export function publishDebugFinalDeliveryProjection(
    requestId: unknown,
    projection: AgentFinalDeliveryDebugProjection
): void {
    const normalizedRequestId = normalizeRequestId(requestId);
    if (!normalizedRequestId || !debugFinalArtifactCaptureByRequest.has(normalizedRequestId)) return;
    debugFinalArtifactCaptureByRequest.set(normalizedRequestId, {
        pathCandidates: capturePathCandidates(projection.pathCandidates),
        ...(projection.skuDeliverySource
            ? { skuDeliverySource: projection.skuDeliverySource }
            : {})
    });
}

export function readDebugFinalArtifactPaths(requestId: unknown): unknown {
    const normalizedRequestId = normalizeRequestId(requestId);
    if (!normalizedRequestId) return undefined;
    const candidates = debugFinalArtifactCaptureByRequest.get(normalizedRequestId)?.pathCandidates;
    return Array.isArray(candidates) ? [...candidates] : candidates;
}

export function readDebugSkuDeliverySource(
    requestId: unknown
): AgentDebugSkuDeliverySource | undefined {
    const normalizedRequestId = normalizeRequestId(requestId);
    if (!normalizedRequestId) return undefined;
    return debugFinalArtifactCaptureByRequest.get(normalizedRequestId)?.skuDeliverySource;
}

export function clearDebugFinalArtifactCapture(requestId: unknown): void {
    const normalizedRequestId = normalizeRequestId(requestId);
    if (!normalizedRequestId) return;
    debugFinalArtifactCaptureByRequest.delete(normalizedRequestId);
}
