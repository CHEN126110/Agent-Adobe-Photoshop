import type { AgentResult } from '../unified-agent.service';
import type { RuntimeOwnedSkillDeliveryPlanAuthority } from '../../../shared/agent-skill-atomic-tool-execution';
import {
    isGuardedAtomicToolExecutor,
    isRuntimeOwnedSkillDeliveryPlanAuthority,
    isRuntimeOwnedSkillDeliveryPlanAuthorityForExecutor,
    type GuardedAtomicToolExecutor
} from '../../../shared/agent-skill-atomic-tool-execution';
import type { RuntimeSessionIdentity } from '../../../shared/agent-runtime-v5/runtime-session';
import { extractMainImageControlledProductResultPaths } from '../../../shared/main-image-controlled-product-qa-gate';
import { buildMainImageLiveExecutorCheckpoint } from '../../../shared/main-image-live-executor-checkpoint';
import { buildMainImageLivePhotoshopAdapterContract } from '../../../shared/main-image-live-photoshop-adapter-contract';
import { runMainImageLiveExecutor } from '../../../shared/main-image-live-executor-runner';
import { normalizeSkillDeliveryArtifactPath } from '../../../shared/skills/skill-delivery-convention';
import { buildMainImageSkillDeliveryPlan } from '../../../shared/main-image-skill-delivery-plan';
import {
    buildMainImageDeliveryRuntimeEvidence,
    inspectMainImageStagedDeliveryBeforePromotion
} from './main-image-delivery-runtime';
import {
    buildMainImageAgenticFinalProductionStructure,
    buildMainImageAgenticFinalizeRequestPackage,
    inspectMainImageAgenticFinalDocument
} from './main-image-agentic-production';
import {
    consumeMainImageAgenticWorkspace,
    resolveMainImageAgenticWorkspace
} from './main-image-agentic-workspace';
import { createMainImageLivePhotoshopToolAdapter } from './main-image-live-photoshop-tool-adapter';
import {
    finalizeRuntimeStagedDelivery,
    prepareRuntimeStagedDelivery,
    promoteRuntimeStagedDelivery,
    readRuntimeStagedDeliveryDispatchContext,
    type RuntimeStagedDeliveryContext,
    type RuntimeStagedDeliveryDispatchContext
} from './runtime-staged-delivery.service';

const MAIN_IMAGE_AGENTIC_FINALIZE_TOOL_NAMES = [
    'exportGroup',
    'saveDocument',
    'getDocumentInfo',
    'getLayerHierarchy',
    'getLayerProperties',
    'getAcceptanceSnapshot'
];

export interface MainImageAgenticFinalizeRuntimeInput {
    workspaceRef?: string;
    projectPath?: string;
    runtimeTaskIdentity?: RuntimeSessionIdentity;
    guardedAtomicToolExecutor?: GuardedAtomicToolExecutor;
    runtimeDeliveryPlanAuthority?: RuntimeOwnedSkillDeliveryPlanAuthority;
    deliveryConvention?: unknown;
    deliveryVersion?: string;
    maxOperationCount?: number;
    photoshopConnection: {
        connected: boolean;
        documentWriteAvailable: boolean;
        source: string;
    };
    emitStep: (
        kind: 'task_started' | 'tool_started' | 'verification' | 'warning',
        title: string,
        detail?: string,
        status?: 'running' | 'success' | 'error',
        percent?: number
    ) => void;
}

function cleanString(value: unknown): string {
    return String(value || '').trim();
}

function readNumber(value: unknown): number | undefined {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : undefined;
}

function buildPublicRunnerSummary(runner: Awaited<ReturnType<typeof runMainImageLiveExecutor>>): Record<string, unknown> {
    return {
        status: runner.status,
        operationCount: runner.operationCount,
        executedOperationCount: runner.executedOperationCount,
        successfulOperationCount: runner.successfulOperationCount,
        failedOperationCount: runner.failedOperationCount,
        failedReadbackCount: runner.failedReadbackCount,
        finalAcceptanceSnapshotCaptured: runner.finalAcceptanceSnapshot?.success === true,
        blockers: [...runner.blockers],
        warnings: [...runner.warnings]
    };
}

function buildPublicOperationResults(
    runner: Awaited<ReturnType<typeof runMainImageLiveExecutor>>
): Array<Record<string, unknown>> {
    return runner.operationResults.map((operation) => ({
        toolName: operation.tool,
        requestId: operation.requestId,
        result: {
            success: operation.success,
            phase: operation.phase,
            readbackCount: operation.readbackResults.length,
            failedReadbackCount: operation.readbackResults.filter((readback) => !readback.success).length
        }
    }));
}

function makeFailure(input: {
    message: string;
    error: string;
    status: string;
    blockers?: string[];
    data?: Record<string, unknown>;
    toolResults?: Array<Record<string, unknown>>;
}): AgentResult {
    return {
        success: false,
        message: input.message,
        error: input.error,
        toolResults: input.toolResults || [],
        data: {
            status: input.status,
            blockers: input.blockers || [],
            ...(input.data || {})
        }
    };
}

export async function runMainImageAgenticFinalizeRuntime(
    input: MainImageAgenticFinalizeRuntimeInput
): Promise<AgentResult> {
    input.emitStep(
        'task_started',
        '核对主图设计并准备交付',
        '读取同一任务的真实 Photoshop 文档与非空标准组，不重新置图或改版。',
        'running',
        0.02
    );
    if (!isGuardedAtomicToolExecutor(input.guardedAtomicToolExecutor)) {
        return makeFailure({
            message: '当前没有受保护的 Photoshop 执行通道，本轮没有保存或导出。',
            error: 'main_image_agentic_finalize_guarded_executor_required',
            status: 'blocked_main_image_agentic_finalize_guarded_executor'
        });
    }
    if (!isRuntimeOwnedSkillDeliveryPlanAuthority(input.runtimeDeliveryPlanAuthority)
        || !isRuntimeOwnedSkillDeliveryPlanAuthorityForExecutor(
            input.runtimeDeliveryPlanAuthority,
            input.guardedAtomicToolExecutor
        )) {
        return makeFailure({
            message: '当前文件事务不属于这次 Photoshop 执行，本轮没有保存或导出。',
            error: 'main_image_agentic_finalize_delivery_authority_mismatch',
            status: 'blocked_main_image_agentic_finalize_delivery_authority'
        });
    }
    const projectPath = cleanString(input.projectPath);
    const workspaceResolution = resolveMainImageAgenticWorkspace({
        workspaceRef: input.workspaceRef,
        runtimeTaskIdentity: input.runtimeTaskIdentity,
        projectPath
    });
    if (workspaceResolution.status !== 'ready') {
        return makeFailure({
            message: '找不到属于当前任务和项目的主图工作文档，本轮没有保存或导出。',
            error: workspaceResolution.blockers[0] || 'main_image_agentic_workspace_unavailable',
            status: 'blocked_main_image_agentic_workspace',
            blockers: workspaceResolution.blockers
        });
    }
    const workspace = workspaceResolution.lease;
    const documentInfoResult = await input.guardedAtomicToolExecutor('getDocumentInfo', {});
    const hierarchyResult = await input.guardedAtomicToolExecutor('getLayerHierarchy', {
        includeHidden: true,
        includeBounds: true,
        flatList: true
    });
    const finalInspection = inspectMainImageAgenticFinalDocument({
        workspace,
        documentInfoResult,
        hierarchyResult
    });
    if (finalInspection.status !== 'ready') {
        return makeFailure({
            message: finalInspection.blockers.includes('main_image_agentic_finalize_design_revision_unchanged')
                ? '工作文档还没有产生可交付的设计变化；请先完成画面，再提交交付。'
                : '当前 Photoshop 文档与本次准备的主图工作区不一致，已停止在保存和导出之前。',
            error: finalInspection.blockers[0] || 'main_image_agentic_finalize_readback_failed',
            status: 'blocked_main_image_agentic_finalize_readback',
            blockers: finalInspection.blockers,
            data: {
                workspaceRef: workspace.workspaceRef,
                finalizedNonemptyGroupCount: finalInspection.finalizedGroups.length
            }
        });
    }
    const productionStructure = buildMainImageAgenticFinalProductionStructure({
        workspace,
        finalizedGroups: finalInspection.finalizedGroups
    });
    const deliveryPlan = buildMainImageSkillDeliveryPlan({
        projectPath,
        deliveryConvention: input.deliveryConvention,
        deliveryVersion: input.deliveryVersion,
        productionDocumentStructure: productionStructure
    });
    const requestPackage = buildMainImageAgenticFinalizeRequestPackage({
        workspaceRef: workspace.workspaceRef,
        productionStructure,
        deliveryPlan
    });
    if (deliveryPlan.status !== 'ready'
        || !deliveryPlan.typedPlan
        || !deliveryPlan.deliveryPlanDigest
        || !requestPackage) {
        return makeFailure({
            message: '主图输出目录或文件名无法唯一确定，本轮没有保存或导出。',
            error: deliveryPlan.blockers[0] || 'main_image_agentic_finalize_delivery_plan_blocked',
            status: 'blocked_main_image_agentic_finalize_delivery_plan',
            blockers: deliveryPlan.blockers
        });
    }
    const checkpoint = buildMainImageLiveExecutorCheckpoint({
        requestPackage,
        approvedLiveExecution: true,
        photoshopConnection: input.photoshopConnection,
        executionScope: 'disposable-document',
        maxOperationCount: readNumber(input.maxOperationCount)
    });
    const adapterContract = buildMainImageLivePhotoshopAdapterContract({
        checkpoint,
        availableToolNames: MAIN_IMAGE_AGENTIC_FINALIZE_TOOL_NAMES
    });
    if (checkpoint.status !== 'ready_for_live_executor_run'
        || adapterContract.status !== 'ready_for_disposable_photoshop_adapter') {
        return makeFailure({
            message: '当前 Photoshop 交付环境没有通过执行前检查，本轮没有保存或导出。',
            error: adapterContract.blockers[0]
                || checkpoint.blockers[0]
                || 'main_image_agentic_finalize_environment_blocked',
            status: 'blocked_main_image_agentic_finalize_environment',
            blockers: [...checkpoint.blockers, ...adapterContract.blockers]
        });
    }
    let stagedContext: RuntimeStagedDeliveryContext | undefined;
    let stagedDispatchContext: RuntimeStagedDeliveryDispatchContext | undefined;
    const executeTool = async (
        toolName: string,
        toolParams: Record<string, unknown>
    ): Promise<unknown> => {
        if (toolName !== 'exportGroup' && toolName !== 'saveDocument') {
            return input.guardedAtomicToolExecutor!(toolName, toolParams);
        }
        const expectedKind = toolName === 'saveDocument' ? 'editable_document' : 'raster_export';
        const targetPath = toolName === 'saveDocument'
            ? cleanString(toolParams.path)
            : cleanString(toolParams.outputPath);
        const artifact = deliveryPlan.typedPlan?.artifacts.find((candidate) => (
            candidate.kind === expectedKind
            && normalizeSkillDeliveryArtifactPath(candidate.path)
                === normalizeSkillDeliveryArtifactPath(targetPath)
        ));
        if (!artifact || !stagedDispatchContext) {
            return {
                success: false,
                error: 'main_image_agentic_finalize_artifact_not_in_frozen_plan'
            };
        }
        const stagedPath = stagedDispatchContext.stagedPathsByArtifactId[artifact.artifactId];
        const stagedParams = toolName === 'saveDocument'
            ? {
                ...toolParams,
                path: stagedPath,
                // 交付副本进入 staging；Agent 的活动工作文档保持原身份，不指向临时目录。
                asCopy: true
            }
            : { ...toolParams, outputPath: stagedPath };
        return input.runtimeDeliveryPlanAuthority!.executeStagedArtifacts({
            lease: stagedDispatchContext.lease,
            artifactIds: [artifact.artifactId],
            toolName,
            params: stagedParams
        });
    };
    const adapterBuild = createMainImageLivePhotoshopToolAdapter({
        adapterContract,
        approvedLiveAdapterRun: true,
        executionScope: 'disposable-document',
        executeTool,
        initialState: {
            documentId: workspace.document.documentId,
            backgroundLayerId: workspace.document.backgroundLayerId,
            groupBindings: workspace.document.groups.map((group) => ({
                path: [...group.path],
                layerId: group.layerId
            }))
        }
    });
    if (!adapterBuild.adapter) {
        return makeFailure({
            message: '当前工作文档无法绑定到受控交付适配器，本轮没有保存或导出。',
            error: adapterBuild.blockers[0] || 'main_image_agentic_finalize_adapter_blocked',
            status: 'blocked_main_image_agentic_finalize_adapter',
            blockers: adapterBuild.blockers
        });
    }
    const deliveryPlanFreeze = input.runtimeDeliveryPlanAuthority.freeze({
        projectPath,
        convention: deliveryPlan.typedPlan.convention,
        artifacts: deliveryPlan.typedPlan.artifacts
    });
    if (deliveryPlanFreeze.status !== 'frozen' && deliveryPlanFreeze.status !== 'retained') {
        return makeFailure({
            message: '主图交付文件集合没有在写入前冻结，本轮没有保存或导出。',
            error: 'main_image_agentic_finalize_delivery_plan_freeze_blocked',
            status: 'blocked_main_image_agentic_finalize_delivery_plan_freeze'
        });
    }
    const stagedPreparation = await prepareRuntimeStagedDelivery({
        projectRoot: projectPath,
        runtimeDeliveryPlanBinding: deliveryPlanFreeze.binding
    });
    if (stagedPreparation.status !== 'ready') {
        return makeFailure({
            message: '主图临时交付位置没有准备完成，本轮没有保存或导出正式文件。',
            error: stagedPreparation.blockers[0] || 'main_image_agentic_finalize_staging_blocked',
            status: 'blocked_main_image_agentic_finalize_staging',
            blockers: stagedPreparation.blockers
        });
    }
    stagedContext = stagedPreparation.context;
    stagedDispatchContext = readRuntimeStagedDeliveryDispatchContext(stagedContext);
    if (!stagedDispatchContext) {
        await finalizeRuntimeStagedDelivery({ context: stagedContext, preserveStagingRoot: false });
        return makeFailure({
            message: '主图临时文件映射无法读取，本轮没有保存或导出正式文件。',
            error: 'main_image_agentic_finalize_staging_mapping_unavailable',
            status: 'blocked_main_image_agentic_finalize_staging_mapping'
        });
    }
    input.emitStep(
        'tool_started',
        '保存主图源稿并导出非空设计组',
        `将 ${finalInspection.finalizedGroups.length} 个真实非空组与可编辑稿作为同一文件事务提交。`,
        'running',
        0.45
    );
    const runner = await runMainImageLiveExecutor({ checkpoint, adapter: adapterBuild.adapter });
    const publicRunnerSummary = buildPublicRunnerSummary(runner);
    const publicOperationResults = buildPublicOperationResults(runner);
    const actualRasterPaths = extractMainImageControlledProductResultPaths(runner);
    const stagedReadiness = await inspectMainImageStagedDeliveryBeforePromotion({
        plan: deliveryPlan,
        runner,
        actualRasterPaths,
        stagedPathsByArtifactId: stagedDispatchContext.stagedPathsByArtifactId
    });
    if (!stagedReadiness.ready) {
        const cleanup = await finalizeRuntimeStagedDelivery({
            context: stagedContext,
            preserveStagingRoot: false
        });
        return makeFailure({
            message: cleanup.success
                ? '主图文件没有完整生成，临时文件已清理，正式目录没有留下半成品。'
                : '主图文件没有完整生成，已保留恢复位置，不能把本轮当作交付成功。',
            error: stagedReadiness.issues[0]
                || cleanup.error
                || 'main_image_agentic_finalize_staged_delivery_incomplete',
            status: 'failed_main_image_agentic_finalize_staged_delivery',
            blockers: [...runner.blockers, ...stagedReadiness.issues],
            data: {
                mainImageControlledProductRunner: publicRunnerSummary,
                ...(cleanup.recoveryPath ? { recoveryPath: cleanup.recoveryPath } : {})
            },
            toolResults: publicOperationResults
        });
    }
    const promoted = await promoteRuntimeStagedDelivery({
        context: stagedContext,
        runtimeDeliveryPlanBinding: deliveryPlanFreeze.binding,
        label: 'Agent 主图整组交付'
    });
    if (!promoted.success
        || !promoted.runtimeDeliveryCommitReceipt
        || !promoted.committedFiles) {
        const workspaceInvalidation = promoted.success && promoted.committedFiles?.length
            ? consumeMainImageAgenticWorkspace({
                workspaceRef: workspace.workspaceRef,
                runtimeTaskIdentity: input.runtimeTaskIdentity,
                projectPath
            })
            : undefined;
        const cleanup = await finalizeRuntimeStagedDelivery({
            context: stagedContext,
            preserveStagingRoot: promoted.preserveStagingRoot === true,
            recoveryPath: promoted.recoveryPath
        });
        return makeFailure({
            message: promoted.preserveStagingRoot === true
                ? '主图正式提交的状态无法完全确认，已保留恢复位置，不能声明成功。'
                : '主图正式提交失败并已撤回，没有留下正式半成品。',
            error: promoted.error || cleanup.error || 'main_image_agentic_finalize_promotion_failed',
            status: 'failed_main_image_agentic_finalize_promotion',
            blockers: [promoted.error].filter((value): value is string => Boolean(value)),
            data: {
                mainImageControlledProductRunner: publicRunnerSummary,
                ...(workspaceInvalidation ? {
                    workspaceInvalidatedAfterFileCommit: workspaceInvalidation.status === 'ready'
                } : {}),
                ...(promoted.recoveryPath ? { recoveryPath: promoted.recoveryPath } : {})
            },
            toolResults: publicOperationResults
        });
    }
    const externalCommit = input.runtimeDeliveryPlanAuthority.acceptExternalCommit({
        artifactIds: deliveryPlan.typedPlan.artifacts.map((artifact) => artifact.artifactId),
        receipt: promoted.runtimeDeliveryCommitReceipt
    });
    if (externalCommit.status !== 'accepted') {
        const workspaceInvalidation = consumeMainImageAgenticWorkspace({
            workspaceRef: workspace.workspaceRef,
            runtimeTaskIdentity: input.runtimeTaskIdentity,
            projectPath
        });
        await finalizeRuntimeStagedDelivery({
            context: stagedContext,
            preserveStagingRoot: false,
            recoveryPath: promoted.recoveryPath
        });
        return makeFailure({
            message: '主图文件已经写入，但与本次完整交付清单的绑定没有闭合；不能声明交付完成。',
            error: externalCommit.blockers[0] || 'main_image_agentic_finalize_external_commit_rejected',
            status: 'failed_main_image_agentic_finalize_external_commit',
            blockers: externalCommit.blockers,
            data: {
                mainImageControlledProductRunner: publicRunnerSummary,
                workspaceInvalidatedAfterFileCommit: workspaceInvalidation.status === 'ready'
            },
            toolResults: publicOperationResults
        });
    }
    const cleanup = await finalizeRuntimeStagedDelivery({
        context: stagedContext,
        preserveStagingRoot: false
    });
    const deliveryEvidence = await buildMainImageDeliveryRuntimeEvidence({
        plan: deliveryPlan,
        runner,
        actualRasterPaths,
        stagedPathsByArtifactId: stagedDispatchContext.stagedPathsByArtifactId,
        stagedFileProbes: stagedReadiness.allFileProbes,
        committedFiles: promoted.committedFiles,
        externalCommitAccepted: true
    });
    const consumption = consumeMainImageAgenticWorkspace({
        workspaceRef: workspace.workspaceRef,
        runtimeTaskIdentity: input.runtimeTaskIdentity,
        projectPath
    });
    const deliveryComplete = deliveryEvidence.receipt.status === 'ready'
        && consumption.status === 'ready';
    let deliveryError: string | undefined;
    if (!deliveryComplete) {
        deliveryError = deliveryEvidence.receipt.issues[0];
        if (!deliveryError && consumption.status === 'blocked') {
            deliveryError = consumption.blockers[0];
        }
        deliveryError = deliveryError || 'main_image_agentic_finalize_receipt_incomplete';
    }
    input.emitStep(
        deliveryComplete ? 'verification' : 'warning',
        '主图文件交付已对账',
        deliveryComplete
            ? `同一 Photoshop 版本的 ${deliveryEvidence.rasterPaths.length} 张结果图和可编辑稿已提交，控制权交还 Agent 做视觉判断。`
            : '文件已经提交，但工作区消费或完整交付收据没有闭合，不能声明任务完成。',
        deliveryComplete ? 'success' : 'error',
        1
    );
    return {
        success: deliveryComplete,
        message: deliveryComplete
            ? [
                '**主图文件已生成**',
                `已导出 ${deliveryEvidence.rasterPaths.length} 个真实非空设计组，并保存同一版本的可编辑源稿。`,
                '主 Agent 会继续查看真实结果，判断画面是否达到设计目标；文件成功不等于审美自动通过。'
            ].join('\n')
            : '主图文件已写入，但内部完整性收据没有闭合，当前不能声明交付完成。',
        error: deliveryError,
        toolResults: publicOperationResults,
        data: {
            status: deliveryComplete
                ? 'main_image_agentic_delivery_completed'
                : 'failed_main_image_agentic_delivery_receipt',
            runtimeDeliveryReceipt: deliveryEvidence.receipt,
            resultImagePaths: deliveryEvidence.rasterPaths,
            resultFileProbes: deliveryEvidence.rasterFileProbes,
            mainImageControlledProductRunner: publicRunnerSummary,
            mainImageDeliveryTransaction: {
                status: deliveryComplete ? 'committed' : 'verification_incomplete',
                committedFileCount: promoted.committedFiles.length,
                exactArtifactSet: true,
                stagingCleanupComplete: cleanup.success === true,
                workspaceConsumed: consumption.status === 'ready'
            },
            canClaimOutputQuality: false,
            agentReActContinuation: {
                status: 'needs_decision',
                summary: '文件与 Photoshop revision 已闭合；请查看真实导出图，按当前设计目标决定完成或做一次关键修订。',
                nextAction: 'review_actual_main_image_output'
            }
        }
    };
}
