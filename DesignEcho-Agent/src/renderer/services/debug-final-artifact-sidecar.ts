import type {
    AgentDebugSkuDeliverySource,
    AgentFinalDeliveryDebugProjection
} from './agent-runtime/final-delivery-artifact-collector';

const MAX_DEBUG_FINAL_ARTIFACT_PATHS = 96;

interface DebugFinalArtifactCaptureState {
    paths: string[];
    skuDeliverySource?: AgentDebugSkuDeliverySource;
}

const debugFinalArtifactCaptureByRequest = new Map<string, DebugFinalArtifactCaptureState>();

function normalizeRequestId(value: unknown): string {
    return String(value || '').trim();
}

function normalizePaths(values: readonly unknown[]): string[] {
    return Array.from(new Set(values
        .map((value) => String(value || '').trim())
        .filter(Boolean)))
        .slice(0, MAX_DEBUG_FINAL_ARTIFACT_PATHS);
}

/**
 * 为一次已通过 Guarded Photoshop baseline 的 Debug Bridge 请求建立瞬态 sidecar。
 * 这里不持久化、不进入 Agent Runtime 类型，也不参与任务完成或质量判断。
 */
export function beginDebugFinalArtifactCapture(requestId: unknown): void {
    const normalizedRequestId = normalizeRequestId(requestId);
    if (!normalizedRequestId) return;
    debugFinalArtifactCaptureByRequest.set(normalizedRequestId, { paths: [] });
}

/**
 * 仅更新已经由 Debug Bridge 显式建立的请求；普通 Agent 运行无法自行开启捕获。
 */
export function publishDebugFinalArtifactPaths(
    requestId: unknown,
    paths: readonly unknown[]
): void {
    const normalizedRequestId = normalizeRequestId(requestId);
    if (!normalizedRequestId || !debugFinalArtifactCaptureByRequest.has(normalizedRequestId)) return;
    debugFinalArtifactCaptureByRequest.set(normalizedRequestId, { paths: normalizePaths(paths) });
}

export function publishDebugFinalDeliveryProjection(
    requestId: unknown,
    projection: AgentFinalDeliveryDebugProjection
): void {
    const normalizedRequestId = normalizeRequestId(requestId);
    if (!normalizedRequestId || !debugFinalArtifactCaptureByRequest.has(normalizedRequestId)) return;
    debugFinalArtifactCaptureByRequest.set(normalizedRequestId, {
        paths: normalizePaths(projection.paths),
        ...(projection.skuDeliverySource
            ? { skuDeliverySource: projection.skuDeliverySource }
            : {})
    });
}

export function readDebugFinalArtifactPaths(requestId: unknown): string[] {
    const normalizedRequestId = normalizeRequestId(requestId);
    if (!normalizedRequestId) return [];
    return [...(debugFinalArtifactCaptureByRequest.get(normalizedRequestId)?.paths || [])];
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
