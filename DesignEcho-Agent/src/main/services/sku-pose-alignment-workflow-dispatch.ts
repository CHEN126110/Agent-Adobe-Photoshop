import {
    normalizeSkuPoseAlignmentWorkflowRequest,
    type SkuPoseAlignmentProviderResult
} from './sku-pose-alignment-provider';

export interface SkuPoseAlignmentWorkflowDispatchDependencies {
    getDocumentInfo(): Promise<unknown>;
    invokeRegisteredHandler(
        method: string,
        params: Record<string, unknown>
    ): Promise<unknown>;
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function throwIfAborted(signal: AbortSignal | undefined, stage: string): void {
    if (!signal?.aborted) return;
    throw new Error(`SKU 姿态统一已在${stage}取消，本轮没有启动新的 Photoshop 写入。`);
}

export async function dispatchSkuPoseAlignmentWorkflow(
    input: unknown,
    dependencies: SkuPoseAlignmentWorkflowDispatchDependencies
): Promise<SkuPoseAlignmentProviderResult | unknown> {
    const request = normalizeSkuPoseAlignmentWorkflowRequest(input);
    throwIfAborted(request.abortSignal, '读取目标前');
    const documentInfo = asRecord(await dependencies.getDocumentInfo());
    throwIfAborted(request.abortSignal, '文档核对后');
    const document = asRecord(documentInfo.document);
    const historyStateRef = asRecord(documentInfo.historyStateRef);
    const actualDocumentId = Number(document.id);
    const actualHistoryStateId = Number(historyStateRef.historyStateId);
    if (documentInfo.success === false
        || !Number.isSafeInteger(actualDocumentId)
        || !Number.isSafeInteger(actualHistoryStateId)) {
        throw new Error('无法读取当前 Photoshop 文档与历史版本，本轮没有启动姿态统一。');
    }
    if (actualDocumentId !== request.expectedDocumentId) {
        throw new Error(
            `当前 Photoshop 文档已经变化：期望 ${request.expectedDocumentId}，`
            + `实际 ${actualDocumentId}。本轮没有启动姿态统一。`
        );
    }
    if (actualHistoryStateId !== request.expectedHistoryStateId) {
        throw new Error(
            `当前 Photoshop 历史版本已经变化：期望 ${request.expectedHistoryStateId}，`
            + `实际 ${actualHistoryStateId}。本轮没有启动姿态统一。`
        );
    }

    return await dependencies.invokeRegisteredHandler('sku-pose-align-v1', {
        ...request
    });
}
