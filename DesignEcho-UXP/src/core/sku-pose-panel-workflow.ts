import { SKU_POSE_ALIGNMENT_WORKFLOW_VERSION } from '../tools/sku/pose-alignment-contract';

export interface SkuPosePanelTarget {
    documentId: number;
    historyStateId: number;
    layerId: number;
    layerName: string;
}

export interface SkuPosePanelWorkflowInput {
    expectedDocumentId: unknown;
    layerIds: unknown;
    strength: unknown;
    cuffLockRatio: unknown;
}

export interface SkuPosePanelProgress {
    completed: number;
    total: number;
    layerId: number;
    layerName: string;
    phase: 'starting' | 'finished';
}

export interface SkuPosePanelLayerResult extends Record<string, unknown> {
    layerId: number;
    layerName: string;
    success: boolean;
    status: 'applied' | 'not_needed' | 'rejected' | 'failed';
    noMutation: boolean;
    error?: string;
    report?: unknown;
}

export interface SkuPosePanelBatchResult extends Record<string, unknown> {
    success: boolean;
    totalLayers: number;
    processedCount: number;
    successCount: number;
    appliedCount: number;
    notNeededCount: number;
    rejectedCount: number;
    failedCount: number;
    stoppedOnUnknownMutation: boolean;
    results: SkuPosePanelLayerResult[];
    warnings: string[];
    error?: string;
}

export interface SkuPosePanelWorkflowDependencies {
    readCurrentTarget(layerId: number): Promise<SkuPosePanelTarget> | SkuPosePanelTarget;
    invokeWorkflow(params: Record<string, unknown>, timeoutMs: number): Promise<unknown>;
    onProgress?(progress: SkuPosePanelProgress): void;
}

const PER_LAYER_TIMEOUT_MS = 180_000;

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function readBoundedNumber(
    value: unknown,
    fieldName: string,
    minimum: number,
    maximum: number
): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
        throw new Error(`${fieldName}必须在 ${minimum}~${maximum} 之间。`);
    }
    return parsed;
}

function normalizeLayerIds(value: unknown): number[] {
    if (!Array.isArray(value)) return [];
    const ids: number[] = [];
    const seen = new Set<number>();
    for (const entry of value) {
        const layerId = Number(entry);
        if (!Number.isSafeInteger(layerId) || layerId <= 0 || seen.has(layerId)) continue;
        seen.add(layerId);
        ids.push(layerId);
    }
    return ids;
}

function readExpectedDocumentId(value: unknown): number {
    const documentId = Number(value);
    if (!Number.isSafeInteger(documentId) || documentId <= 0) {
        throw new Error('面板没有绑定有效的 Photoshop 文档，请刷新图层列表后再试。');
    }
    return documentId;
}

function buildResultLayerName(sourceLayerName: string, layerId: number): string {
    const suffix = ' · 姿态统一';
    const fallback = `图层 ${layerId}`;
    const cleanName = String(sourceLayerName || fallback)
        .replace(/[\x00-\x1f]/g, ' ')
        .trim() || fallback;
    return `${cleanName.slice(0, 160 - suffix.length)}${suffix}`;
}

function buildFailedLayerResult(input: {
    layerId: number;
    layerName: string;
    error: string;
    noMutation: boolean;
    status?: 'rejected' | 'failed';
}): SkuPosePanelLayerResult {
    return {
        layerId: input.layerId,
        layerName: input.layerName,
        success: false,
        status: input.status || 'failed',
        noMutation: input.noMutation,
        error: input.error
    };
}

function readSuccessfulLayerResult(input: {
    response: Record<string, unknown>;
    layerId: number;
    layerName: string;
}): SkuPosePanelLayerResult | undefined {
    if (input.response.success !== true) return undefined;
    if (input.response.status !== 'applied' && input.response.status !== 'not_needed') {
        return undefined;
    }
    return {
        layerId: input.layerId,
        layerName: input.layerName,
        success: true,
        status: input.response.status,
        noMutation: input.response.status === 'not_needed',
        ...(input.response.report === undefined ? {} : { report: input.response.report })
    };
}

function buildBatchResult(
    layerIds: number[],
    results: SkuPosePanelLayerResult[],
    stoppedOnUnknownMutation: boolean
): SkuPosePanelBatchResult {
    const appliedCount = results.filter((item) => item.status === 'applied').length;
    const notNeededCount = results.filter((item) => item.status === 'not_needed').length;
    const rejectedCount = results.filter((item) => item.status === 'rejected').length;
    const failedCount = results.filter((item) => item.status === 'failed').length;
    const warnings: string[] = [];
    if (notNeededCount > 0) {
        warnings.push(`${notNeededCount} 个图层已经较直，未重复修改。`);
    }
    if (stoppedOnUnknownMutation) {
        warnings.push('有一项写入结果无法确认，已停止后续图层，避免继续叠加修改。');
    }
    const successCount = appliedCount + notNeededCount;
    const success = results.length === layerIds.length
        && rejectedCount === 0
        && failedCount === 0
        && !stoppedOnUnknownMutation;
    const firstFailure = results.find((item) => !item.success)?.error;
    return {
        success,
        totalLayers: layerIds.length,
        processedCount: results.length,
        successCount,
        appliedCount,
        notNeededCount,
        rejectedCount,
        failedCount,
        stoppedOnUnknownMutation,
        results,
        warnings,
        ...(firstFailure ? { error: firstFailure } : {})
    };
}

export async function executeSkuPosePanelBatch(
    input: SkuPosePanelWorkflowInput,
    dependencies: SkuPosePanelWorkflowDependencies
): Promise<SkuPosePanelBatchResult> {
    const layerIds = normalizeLayerIds(input.layerIds);
    if (layerIds.length === 0) {
        return {
            success: false,
            totalLayers: 0,
            processedCount: 0,
            successCount: 0,
            appliedCount: 0,
            notNeededCount: 0,
            rejectedCount: 0,
            failedCount: 0,
            stoppedOnUnknownMutation: false,
            results: [],
            warnings: [],
            error: '请选择至少一个需要统一姿态的商品图层。'
        };
    }
    const expectedDocumentId = readExpectedDocumentId(input.expectedDocumentId);
    const strength = readBoundedNumber(input.strength, '矫正强度', 0, 1);
    const cuffLockRatio = readBoundedNumber(input.cuffLockRatio, '上边缘保护比例', 0, 0.4);
    const results: SkuPosePanelLayerResult[] = [];
    let stoppedOnUnknownMutation = false;

    for (const layerId of layerIds) {
        let target: SkuPosePanelTarget;
        try {
            target = await dependencies.readCurrentTarget(layerId);
        } catch (error) {
            results.push(buildFailedLayerResult({
                layerId,
                layerName: `图层 ${layerId}`,
                error: error instanceof Error ? error.message : String(error),
                noMutation: true
            }));
            break;
        }
        if (target.documentId !== expectedDocumentId) {
            results.push(buildFailedLayerResult({
                layerId,
                layerName: target.layerName,
                error: '当前 Photoshop 文档已变化，请刷新图层列表后重新选择。',
                noMutation: true
            }));
            break;
        }
        dependencies.onProgress?.({
            completed: results.length,
            total: layerIds.length,
            layerId,
            layerName: target.layerName,
            phase: 'starting'
        });

        let response: Record<string, unknown>;
        try {
            response = asRecord(await dependencies.invokeWorkflow({
                version: SKU_POSE_ALIGNMENT_WORKFLOW_VERSION,
                expectedDocumentId: target.documentId,
                expectedHistoryStateId: target.historyStateId,
                layerId: target.layerId,
                resultLayerName: buildResultLayerName(target.layerName, target.layerId),
                options: {
                    strength,
                    cuffLockRatio
                }
            }, PER_LAYER_TIMEOUT_MS));
        } catch (error) {
            results.push(buildFailedLayerResult({
                layerId,
                layerName: target.layerName,
                error: error instanceof Error ? error.message : String(error),
                noMutation: false
            }));
            stoppedOnUnknownMutation = true;
            break;
        }

        const successful = readSuccessfulLayerResult({
            response,
            layerId,
            layerName: target.layerName
        });
        if (successful) {
            results.push(successful);
        } else {
            const noMutation = response.noMutation === true
                || response.mutationState === 'not_started';
            const status = response.status === 'rejected' ? 'rejected' : 'failed';
            results.push(buildFailedLayerResult({
                layerId,
                layerName: target.layerName,
                error: String(response.error || '姿态统一没有返回可信结果。'),
                noMutation,
                status
            }));
            if (!noMutation) {
                stoppedOnUnknownMutation = true;
            }
        }

        dependencies.onProgress?.({
            completed: results.length,
            total: layerIds.length,
            layerId,
            layerName: target.layerName,
            phase: 'finished'
        });
        if (stoppedOnUnknownMutation) break;
    }

    return buildBatchResult(layerIds, results, stoppedOnUnknownMutation);
}
