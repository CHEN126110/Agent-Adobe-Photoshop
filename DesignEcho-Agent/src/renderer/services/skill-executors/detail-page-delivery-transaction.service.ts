import type { RuntimeOwnedSkillDeliveryPlanBinding } from '../../../shared/agent-skill-atomic-tool-execution';
import type { DetailPageDeliveryPlan } from './detail-page-delivery-plan';
import {
    finalizeRuntimeStagedDelivery,
    prepareRuntimeStagedDelivery,
    promoteRuntimeStagedDelivery,
    readRuntimeStagedDeliveryDispatchContext,
    type RuntimeStagedDeliveryContext,
    type RuntimeStagedDeliveryDispatchContext,
    type RuntimeStagedDeliveryPreparation
} from './runtime-staged-delivery.service';
import type { RuntimeStagedDeliveryPromotionResult } from './staged-delivery-promotion.service';

export interface DetailPageStagedDeliveryContext {
    runtimeContext: RuntimeStagedDeliveryContext;
    dispatch: RuntimeStagedDeliveryDispatchContext;
    saveDocumentParams?: NonNullable<DetailPageDeliveryPlan['toolCalls']['saveDocument']> & {
        asCopy: true;
    };
    exportSlicesParams?: NonNullable<DetailPageDeliveryPlan['toolCalls']['exportDetailPageSlices']>;
}

export type DetailPageStagedDeliveryPreparation =
    | { status: 'ready'; context: DetailPageStagedDeliveryContext; blockers: [] }
    | Extract<RuntimeStagedDeliveryPreparation, { status: 'blocked' }>;

function parentPath(filePath: string): string {
    const normalized = String(filePath || '').replace(/[\\/]+$/g, '');
    const splitAt = Math.max(normalized.lastIndexOf('\\'), normalized.lastIndexOf('/'));
    return splitAt > 0 ? normalized.slice(0, splitAt) : '';
}

export async function prepareDetailPageStagedDelivery(input: {
    plan: DetailPageDeliveryPlan;
    runtimeDeliveryPlanBinding: RuntimeOwnedSkillDeliveryPlanBinding;
}): Promise<DetailPageStagedDeliveryPreparation> {
    const prepared = await prepareRuntimeStagedDelivery({
        projectRoot: input.plan.projectRoot,
        runtimeDeliveryPlanBinding: input.runtimeDeliveryPlanBinding
    });
    if (prepared.status !== 'ready') {
        return prepared;
    }
    const dispatch = readRuntimeStagedDeliveryDispatchContext(prepared.context);
    if (!dispatch) {
        await finalizeRuntimeStagedDelivery({
            context: prepared.context,
            preserveStagingRoot: false
        });
        return { status: 'blocked', blockers: ['详情页临时文件映射无法读取。'] };
    }
    const saveDocumentParams = input.plan.editable && input.plan.toolCalls.saveDocument
        ? {
            ...input.plan.toolCalls.saveDocument,
            path: dispatch.stagedPathsByArtifactId[input.plan.editable.artifactId],
            asCopy: true as const
        }
        : undefined;
    const exportSlicesParams = input.plan.toolCalls.exportDetailPageSlices
        ? {
            ...input.plan.toolCalls.exportDetailPageSlices,
            config: {
                ...input.plan.toolCalls.exportDetailPageSlices.config,
                projectRoot: dispatch.lease.stagingRoot,
                outputDir: parentPath(
                    dispatch.stagedPathsByArtifactId[
                        input.plan.slices[0]?.artifactId
                    ] || dispatch.lease.stagingRoot
                ),
                expectedFiles: input.plan.slices.map((slice) => ({
                    screenId: slice.screenId,
                    path: dispatch.stagedPathsByArtifactId[slice.artifactId]
                }))
            }
        }
        : undefined;
    const allArtifactPathsReady = input.plan.artifacts.every((artifact) => (
        Boolean(dispatch.stagedPathsByArtifactId[artifact.artifactId])
    ));
    const operationShapeReady = Boolean(input.plan.editable) === Boolean(saveDocumentParams)
        && (input.plan.slices.length > 0) === Boolean(exportSlicesParams);
    if (!allArtifactPathsReady || !operationShapeReady) {
        await finalizeRuntimeStagedDelivery({
            context: prepared.context,
            preserveStagingRoot: false
        });
        return {
            status: 'blocked',
            blockers: ['详情页可编辑稿或切图与本次临时文件计划不完整。']
        };
    }
    return {
        status: 'ready',
        context: Object.freeze({
            runtimeContext: prepared.context,
            dispatch,
            ...(saveDocumentParams ? { saveDocumentParams } : {}),
            ...(exportSlicesParams ? { exportSlicesParams } : {})
        }),
        blockers: []
    };
}

export async function promoteDetailPageStagedDelivery(input: {
    context: DetailPageStagedDeliveryContext;
    runtimeDeliveryPlanBinding: RuntimeOwnedSkillDeliveryPlanBinding;
}): Promise<RuntimeStagedDeliveryPromotionResult> {
    return promoteRuntimeStagedDelivery({
        context: input.context.runtimeContext,
        runtimeDeliveryPlanBinding: input.runtimeDeliveryPlanBinding,
        label: '详情页整组交付'
    });
}

export async function finalizeDetailPageStaging(input: {
    context: DetailPageStagedDeliveryContext;
    preserveStagingRoot: boolean;
    recoveryPath?: string;
}): Promise<RuntimeStagedDeliveryPromotionResult> {
    return finalizeRuntimeStagedDelivery({
        context: input.context.runtimeContext,
        preserveStagingRoot: input.preserveStagingRoot,
        recoveryPath: input.recoveryPath
    });
}
