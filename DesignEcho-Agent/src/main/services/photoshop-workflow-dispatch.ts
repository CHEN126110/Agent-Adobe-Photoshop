export type PhotoshopRemoveBackgroundOutputFormat = 'mask' | 'selection' | 'channel' | 'layer';
export type PhotoshopRemoveBackgroundQuality = 'fast' | 'balanced' | 'quality';

export interface PhotoshopRemoveBackgroundWorkflowInput {
    expectedDocumentId?: unknown;
    expectedHistoryStateId?: unknown;
    layerId?: unknown;
    targetPrompt?: unknown;
    outputFormat?: unknown;
    quality?: unknown;
    sampleAllLayers?: unknown;
    enableHairRefine?: unknown;
    enableFabricRefine?: unknown;
    requestKey?: unknown;
    abortSignal?: unknown;
}

export interface PhotoshopWorkflowDispatchDependencies {
    getDocumentInfo(): Promise<unknown>;
    invokeRegisteredHandler(method: string, params: Record<string, unknown>): Promise<unknown>;
}

const OUTPUT_FORMATS = new Set<PhotoshopRemoveBackgroundOutputFormat>([
    'mask',
    'selection',
    'channel',
    'layer'
]);

const QUALITY_PRESETS = new Set<PhotoshopRemoveBackgroundQuality>([
    'fast',
    'balanced',
    'quality'
]);

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function requirePositiveInteger(value: unknown, fieldName: string): number {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new Error(`photoshop.workflows.remove_background 缺少有效的 ${fieldName}。`);
    }
    return parsed;
}

function normalizeOutputFormat(value: unknown): PhotoshopRemoveBackgroundOutputFormat {
    const normalized = String(value || '').trim() as PhotoshopRemoveBackgroundOutputFormat;
    if (!OUTPUT_FORMATS.has(normalized)) {
        throw new Error('photoshop.workflows.remove_background 的 outputFormat 只能是 mask、selection、channel 或 layer。');
    }
    return normalized;
}

function normalizeQuality(value: unknown): PhotoshopRemoveBackgroundQuality {
    if (value === undefined) return 'balanced';
    const normalized = String(value || '').trim() as PhotoshopRemoveBackgroundQuality;
    if (!QUALITY_PRESETS.has(normalized)) {
        throw new Error('photoshop.workflows.remove_background 的 quality 只能是 fast、balanced 或 quality。');
    }
    return normalized;
}

function normalizeTargetPrompt(value: unknown): string {
    const targetPrompt = String(value || '').trim();
    if (!targetPrompt) {
        throw new Error('photoshop.workflows.remove_background 需要由调用方明确提供 targetPrompt。');
    }
    return targetPrompt;
}

function readAbortSignal(value: unknown): AbortSignal | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const candidate = value as Partial<AbortSignal>;
    return typeof candidate.aborted === 'boolean'
        ? candidate as AbortSignal
        : undefined;
}

function throwIfAborted(signal: AbortSignal | undefined, stage: string): void {
    if (!signal?.aborted) return;
    throw new Error(`Photoshop 抠图工作流已在${stage}取消，本轮没有启动新的 Photoshop 写入。`);
}

export async function dispatchPhotoshopRemoveBackgroundWorkflow(
    input: PhotoshopRemoveBackgroundWorkflowInput,
    dependencies: PhotoshopWorkflowDispatchDependencies
): Promise<unknown> {
    const abortSignal = readAbortSignal(input.abortSignal);
    throwIfAborted(abortSignal, '读取目标前');
    const expectedDocumentId = requirePositiveInteger(input.expectedDocumentId, 'expectedDocumentId');
    const expectedHistoryStateId = input.expectedHistoryStateId === undefined
        ? undefined
        : requirePositiveInteger(input.expectedHistoryStateId, 'expectedHistoryStateId');
    const layerId = requirePositiveInteger(input.layerId, 'layerId');
    const targetPrompt = normalizeTargetPrompt(input.targetPrompt);
    const outputFormat = normalizeOutputFormat(input.outputFormat);
    const quality = normalizeQuality(input.quality);
    const requestKey = String(input.requestKey || '').trim() || undefined;

    const documentInfo = asRecord(await dependencies.getDocumentInfo());
    throwIfAborted(abortSignal, '文档核对后');
    const activeDocument = asRecord(documentInfo.document);
    const historyStateRef = asRecord(documentInfo.historyStateRef);
    const activeDocumentId = Number(activeDocument.id);
    const activeHistoryStateId = Number(historyStateRef.historyStateId);
    if (documentInfo.success === false || !Number.isSafeInteger(activeDocumentId)) {
        throw new Error('无法读取当前 Photoshop 文档身份，本轮没有启动抠图工作流。');
    }
    if (activeDocumentId !== expectedDocumentId) {
        throw new Error(
            `当前 Photoshop 文档已经变化：期望 ${expectedDocumentId}，实际 ${activeDocumentId}。本轮没有启动抠图工作流。`
        );
    }
    if (expectedHistoryStateId !== undefined
        && activeHistoryStateId !== expectedHistoryStateId) {
        const actual = Number.isSafeInteger(activeHistoryStateId)
            ? String(activeHistoryStateId)
            : '未知';
        throw new Error(
            `当前 Photoshop 历史版本已经变化：期望 ${expectedHistoryStateId}，实际 ${actual}。本轮没有启动抠图工作流。`
        );
    }

    return await dependencies.invokeRegisteredHandler('remove-background', {
        mode: 'ai',
        useMask: outputFormat === 'mask',
        outputFormat,
        quality,
        targetPrompt,
        sampleAllLayers: input.sampleAllLayers === true,
        enableHairRefine: input.enableHairRefine !== false,
        enableFabricRefine: input.enableFabricRefine !== false,
        layerId,
        expectedDocumentId,
        ...(requestKey ? { requestKey } : {}),
        ...(abortSignal ? { abortSignal } : {}),
        ...(expectedHistoryStateId !== undefined
            ? { expectedHistoryStateId }
            : {})
    });
}
