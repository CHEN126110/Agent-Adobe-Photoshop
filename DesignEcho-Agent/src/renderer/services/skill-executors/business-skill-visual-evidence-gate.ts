import type { AgentResult } from '../unified-agent.service';
import {
    buildBusinessSkillVisualEvidenceGate,
    type BusinessSkillVisualEvidenceGate
} from '../../../shared/business-skill-visual-evidence-gate';
import {
    BUSINESS_SKILL_EXECUTION_PREFLIGHT_SKILL_IDS,
    buildBusinessSkillExecutionPreflightGate,
    type BusinessSkillExecutionPreflightGate
} from '../../../shared/business-skill-execution-preflight-gate';
import {
    buildBusinessSkillPreflightPlannerEvidence,
    type BusinessSkillPreflightPlannerEvidence
} from '../../../shared/business-skill-preflight-planner-evidence';
import { buildBusinessSkillVisualEvidenceRefreshPlan } from '../../../shared/business-skill-visual-evidence-refresh-plan';
import {
    buildBusinessSkillVisualEvidencePreExecutionGate,
    type BusinessSkillVisualEvidencePreExecutionGate
} from '../../../shared/business-skill-visual-evidence-pre-execution-gate';
import { buildBusinessSkillVisualEvidenceControlDecision } from '../../../shared/business-skill-visual-evidence-control-decision';
import {
    buildBusinessSkillExecutionIntake,
    type BusinessSkillExecutionIntake,
    type BusinessSkillExecutionIntakeStage,
    type BusinessSkillPreExecutionRunEvidence
} from '../../../shared/business-skill-execution-intake';
import {
    buildProjectAssetUnderstandingIntake,
    type ProjectAssetUnderstandingIntake
} from '../../../shared/project-asset-understanding-intake';
import {
    buildBusinessSkillImagePlacementVerificationIntake,
    type BusinessSkillImagePlacementVerificationIntake
} from '../../../shared/business-skill-image-placement-verification-intake';
import {
    buildBusinessSkillExecutionPlanIntake,
    type BusinessSkillExecutionPlanIntake
} from '../../../shared/business-skill-execution-plan-intake';
import type { BusinessDesignSkillId } from '../../../shared/business-skill-implementation-checkpoint';
import { buildBusinessSkillVisualEvidenceFeedback } from '../../../shared/business-skill-visual-evidence-feedback';
import type { ProjectVisualSamplingScenario } from '../../../shared/project-visual-sampling';
import type { SkillExecuteParams } from './types';
import {
    runProjectVisualInsightCacheFill,
    type RunProjectVisualInsightCacheFillInput
} from '../project-visual-insight-cache-fill';
import { detectBusinessSkillVisualEvidenceRefreshRuntime } from './business-skill-visual-evidence-runtime';

const BUSINESS_VISUAL_SKILL_SCENARIOS: Record<string, ProjectVisualSamplingScenario> = {
    'main-image-design': 'main-image',
    'detail-page-design': 'detail-page',
    'sku-batch': 'sku',
    'layout-replication': 'reference-replication'
};

export function getBusinessVisualEvidenceScenarioForSkill(skillId: string): ProjectVisualSamplingScenario | undefined {
    return BUSINESS_VISUAL_SKILL_SCENARIOS[skillId];
}

export function isBusinessVisualEvidenceSkill(skillId: string): boolean {
    return Boolean(getBusinessVisualEvidenceScenarioForSkill(skillId));
}

export async function prepareBusinessSkillProjectContextForScenario(
    skillId: string,
    executeParams: SkillExecuteParams
): Promise<SkillExecuteParams> {
    const visualSamplingScenario = getBusinessVisualEvidenceScenarioForSkill(skillId);
    if (!visualSamplingScenario) return executeParams;

    const projectContext = executeParams.context?.projectContext as any;
    if (!projectContext) return executeParams;

    const currentScenario = projectContext.visualSamplingPlan?.scenario;
    if (currentScenario === visualSamplingScenario) {
        return executeParams;
    }

    const projectPath = readOptionalString(projectContext.projectPath || projectContext.contextSnapshot?.project?.path);
    if (!projectPath) {
        return appendProjectContextWarning(
            executeParams,
            `缺少项目路径，无法为 ${skillId} 构建 ${visualSamplingScenario} 场景的只读项目快照。`
        );
    }

    if (typeof window === 'undefined' || !window.designEcho?.buildProjectContextSnapshot) {
        return appendProjectContextWarning(
            executeParams,
            `运行时没有提供 buildProjectContextSnapshot，继续使用 ${currentScenario || 'unknown'} 场景项目快照。`
        );
    }

    try {
        const result = await window.designEcho.buildProjectContextSnapshot({
            projectPath,
            projectName: readOptionalString(projectContext.contextSnapshot?.project?.name),
            selectedAssetPaths: readSelectedAssetPaths(projectContext),
            visualSamplingScenario
        });

        if (!result?.success || !result.contextSnapshot || !result.visualSamplingPlan || !result.assetIndex) {
            return appendProjectContextWarning(
                executeParams,
                `构建 ${visualSamplingScenario} 场景项目快照未返回完整项目信息，继续使用现有项目上下文。`
            );
        }

        return {
            ...executeParams,
            context: {
                ...(executeParams.context as any),
                projectContext: {
                    ...projectContext,
                    assetIndex: result.assetIndex,
                    visualSamplingPlan: result.visualSamplingPlan,
                    visualInsightCache: result.visualInsightCache,
                    contextSnapshot: result.contextSnapshot,
                    contextSnapshotSource: result.source || 'runtime-project-service',
                    contextSnapshotWarnings: mergeUniqueStrings(
                        projectContext.contextSnapshotWarnings,
                        result.warnings
                    ),
                    contextSnapshotLimitations: mergeUniqueStrings(
                        projectContext.contextSnapshotLimitations,
                        result.limitations
                    )
                }
            }
        };
    } catch (error) {
        return appendProjectContextWarning(
            executeParams,
            `构建 ${visualSamplingScenario} 场景项目快照失败：${readErrorText(error)}`
        );
    }
}

export function isBusinessSkillExecutionPreflightSkill(skillId: string): skillId is BusinessDesignSkillId {
    return BUSINESS_SKILL_EXECUTION_PREFLIGHT_SKILL_IDS.includes(skillId as BusinessDesignSkillId);
}

export function buildBusinessVisualEvidenceGateForSkill(
    skillId: string,
    executeParams: SkillExecuteParams
): BusinessSkillVisualEvidenceGate | undefined {
    const scenario = getBusinessVisualEvidenceScenarioForSkill(skillId);
    if (!scenario) return undefined;

    const projectContext = executeParams.context?.projectContext;
    return buildBusinessSkillVisualEvidenceGate({
        scenario,
        projectPath: projectContext?.projectPath,
        assetIndex: projectContext?.assetIndex,
        visualSamplingPlan: projectContext?.visualSamplingPlan,
        visualInsightCache: projectContext?.visualInsightCache,
        enforcement: 'evidence-only',
        requiresVisualEvidence: true
    });
}

export function buildBusinessSkillExecutionPreflightGateForSkill(
    skillId: string,
    executeParams: SkillExecuteParams,
    result?: AgentResult
): BusinessSkillExecutionPreflightGate | undefined {
    if (!isBusinessSkillExecutionPreflightSkill(skillId)) return undefined;

    const projectContext = executeParams.context?.projectContext as any;
    return buildBusinessSkillExecutionPreflightGate({
        skillId,
        requestKind: 'execute_existing',
        contextEvidence: {
            hasProjectContext: Boolean(projectContext),
            hasAssetIndex: Boolean(projectContext?.assetIndex),
            hasVisualSamplingPlan: Boolean(projectContext?.visualSamplingPlan),
            hasVisualUnderstanding: hasSkillScenarioVisualUnderstandingEvidence(skillId, projectContext),
            hasTemplateEvidence: hasTemplateEvidence(result)
        }
    });
}

export function attachBusinessVisualEvidenceGateToResult(
    result: AgentResult,
    gate?: BusinessSkillVisualEvidenceGate
): AgentResult {
    if (!gate) return result;
    return {
        ...result,
        data: {
            ...(result.data || {}),
            businessVisualEvidenceGate: gate,
            businessVisualEvidenceFeedback: buildBusinessSkillVisualEvidenceFeedback(gate)
        }
    };
}

export function attachBusinessSkillExecutionPreflightGateToResult(
    result: AgentResult,
    gate?: BusinessSkillExecutionPreflightGate,
    executeParams?: SkillExecuteParams
): AgentResult {
    if (!gate) return result;
    const plannerEvidence = buildBusinessSkillPreflightPlannerEvidence(gate);
    const refreshPlan = buildBusinessSkillVisualEvidenceRefreshPlanForSkill(
        gate.skillId,
        executeParams,
        plannerEvidence
    );
    return {
        ...result,
        data: {
            ...(result.data || {}),
            businessSkillExecutionPreflightGate: gate,
            businessSkillPreflightPlannerEvidence: plannerEvidence,
            ...(refreshPlan ? { businessSkillVisualEvidenceRefreshPlan: refreshPlan } : {})
        }
    };
}

export function attachBusinessSkillVisualEvidenceControlDecisionToResult(
    result: AgentResult
): AgentResult {
    const data = (result.data || {}) as any;
    if (!data.businessSkillPreflightPlannerEvidence) return result;

    return {
        ...result,
        data: {
            ...data,
            businessSkillVisualEvidenceControlDecision: buildBusinessSkillVisualEvidenceControlDecision({
                plannerEvidence: data.businessSkillPreflightPlannerEvidence,
                refreshPlan: data.businessSkillVisualEvidenceRefreshPlan,
                refreshRun: data.businessSkillVisualEvidenceRefreshRun
            })
        }
    };
}

export function buildBusinessSkillExecutionIntakeForSkill(
    skillId: string,
    input: {
        stage: BusinessSkillExecutionIntakeStage;
        preExecutionGate?: BusinessSkillVisualEvidencePreExecutionGate;
        preExecutionRun?: BusinessSkillPreExecutionRunEvidence;
        executionPreflightGate?: BusinessSkillExecutionPreflightGate;
        plannerEvidence?: BusinessSkillPreflightPlannerEvidence;
        refreshPlan?: any;
        refreshRun?: any;
        controlDecision?: any;
    }
): BusinessSkillExecutionIntake | undefined {
    if (!isBusinessSkillExecutionPreflightSkill(skillId)) return undefined;

    return buildBusinessSkillExecutionIntake({
        skillId,
        stage: input.stage,
        preExecutionGate: input.preExecutionGate,
        preExecutionRun: input.preExecutionRun,
        executionPreflightGate: input.executionPreflightGate,
        plannerEvidence: input.plannerEvidence,
        refreshPlan: input.refreshPlan,
        refreshRun: input.refreshRun,
        controlDecision: input.controlDecision
    });
}

export function buildBusinessSkillProjectAssetUnderstandingIntakeForSkill(
    skillId: string,
    executeParams: SkillExecuteParams
): ProjectAssetUnderstandingIntake | undefined {
    if (!isBusinessSkillExecutionPreflightSkill(skillId)) return undefined;

    return buildProjectAssetUnderstandingIntake({
        skillId,
        projectContext: executeParams.context?.projectContext as any
    });
}

export function attachBusinessSkillExecutionIntakeToResult(
    result: AgentResult,
    intake?: BusinessSkillExecutionIntake
): AgentResult {
    if (!intake) return result;
    return {
        ...result,
        data: {
            ...(result.data || {}),
            businessSkillExecutionIntake: intake
        }
    };
}

export function attachBusinessSkillProjectAssetUnderstandingIntakeToResult(
    result: AgentResult,
    intake?: ProjectAssetUnderstandingIntake
): AgentResult {
    if (!intake) return result;
    return {
        ...result,
        data: {
            ...(result.data || {}),
            businessSkillProjectAssetUnderstandingIntake: intake
        }
    };
}

export function buildBusinessSkillImagePlacementVerificationIntakeForSkill(
    skillId: string,
    result: AgentResult
): BusinessSkillImagePlacementVerificationIntake | undefined {
    if (!isBusinessSkillExecutionPreflightSkill(skillId)) return undefined;

    return buildBusinessSkillImagePlacementVerificationIntake({
        skillId,
        resultData: result.data as Record<string, unknown> | undefined
    });
}

export function attachBusinessSkillImagePlacementVerificationIntakeToResult(
    result: AgentResult,
    intake?: BusinessSkillImagePlacementVerificationIntake
): AgentResult {
    if (!intake) return result;
    return {
        ...result,
        data: {
            ...(result.data || {}),
            businessSkillImagePlacementVerificationIntake: intake
        }
    };
}

export function buildBusinessSkillExecutionPlanIntakeForSkill(
    skillId: string,
    result: AgentResult
): BusinessSkillExecutionPlanIntake | undefined {
    if (!isBusinessSkillExecutionPreflightSkill(skillId)) return undefined;

    return buildBusinessSkillExecutionPlanIntake({
        skillId,
        resultData: result.data as Record<string, unknown> | undefined
    });
}

export function attachBusinessSkillExecutionPlanIntakeToResult(
    result: AgentResult,
    intake?: BusinessSkillExecutionPlanIntake
): AgentResult {
    if (!intake) return result;
    return {
        ...result,
        data: {
            ...(result.data || {}),
            businessSkillExecutionPlanIntake: intake
        }
    };
}

export interface BusinessSkillVisualEvidenceRefreshRunSummary {
    version: 'business-skill-visual-evidence-refresh-run/v0';
    status: string;
    attempted: boolean;
    planStatus?: string;
    reason?: string;
    analyzedCount: number;
    successCount: number;
    failedCount: number;
    writtenEntryCount: number;
    warnings: string[];
    limitations: string[];
    evidence: Array<{ source: string; summary: string; status?: string }>;
    error?: string;
}

export interface BusinessSkillVisualEvidenceRefreshRunnerOptions {
    runCacheFill?: (input: RunProjectVisualInsightCacheFillInput) => Promise<{
        status?: string;
        analyzedCount?: number;
        successCount?: number;
        failedCount?: number;
        entries?: unknown[];
        warnings?: string[];
        limitations?: string[];
        evidence?: Array<{ source: string; summary: string; status?: string }>;
    }>;
}

export interface BusinessSkillVisualEvidencePreExecutionRunSummary {
    version: 'business-skill-visual-evidence-pre-execution-run/v0';
    stage: 'before_execution';
    status: string;
    attempted: boolean;
    planStatus?: string;
    reason?: string;
    analyzedCount: number;
    successCount: number;
    failedCount: number;
    writtenEntryCount: number;
    warnings: string[];
    limitations: string[];
    evidence: Array<{ source: string; summary: string; status?: string }>;
    error?: string;
}

export interface BusinessSkillVisualEvidencePreExecutionRunnerResult {
    executeParams: SkillExecuteParams;
    runSummary?: BusinessSkillVisualEvidencePreExecutionRunSummary;
    blockedResult?: AgentResult;
}

export function buildBusinessSkillVisualEvidencePreExecutionGateForSkill(
    skillId: string,
    executeParams: SkillExecuteParams
): BusinessSkillVisualEvidencePreExecutionGate | undefined {
    if (!isBusinessSkillExecutionPreflightSkill(skillId)) return undefined;

    const params = executeParams.params || {};
    const projectContext = executeParams.context?.projectContext as any;
    const runtimeReady = params.visualEvidenceRefreshRuntimeReady === true;
    const runtimeCapabilities = detectBusinessSkillVisualEvidenceRefreshRuntime();

    return buildBusinessSkillVisualEvidencePreExecutionGate({
        skillId,
        projectPath: projectContext?.projectPath,
        visualSamplingPlan: projectContext?.visualSamplingPlan,
        expectedVisualSamplingScenario: getBusinessVisualEvidenceScenarioForSkill(skillId),
        hasProjectContext: Boolean(projectContext),
        hasAssetIndex: Boolean(projectContext?.assetIndex),
        hasVisualSamplingPlan: Boolean(projectContext?.visualSamplingPlan),
        hasVisualUnderstanding: hasSkillScenarioVisualUnderstandingEvidence(skillId, projectContext),
        enabled: firstDefined(
            params.enableBusinessVisualEvidenceRefresh,
            params.enableVisualEvidenceRefresh,
            params.refreshVisualEvidence
        ),
        runBeforeExecution: firstDefined(
            params.runBusinessVisualEvidenceRefreshBeforeExecution,
            params.runVisualEvidenceRefreshBeforeExecution,
            params.executeBusinessVisualEvidenceRefreshBeforeExecution
        ),
        requireBeforeExecution: firstDefined(
            params.requireBusinessVisualEvidenceBeforeExecution,
            params.requireVisualEvidenceBeforeExecution,
            params.blockWithoutBusinessVisualEvidence
        ),
        runtimeCanAnalyze: params.visualEvidenceRefreshCanAnalyze === true
            || runtimeReady
            || runtimeCapabilities.canAnalyze,
        runtimeCanWriteCache: params.visualEvidenceRefreshCanWriteCache === true
            || runtimeReady
            || runtimeCapabilities.canWriteCache,
        maxCandidates: params.visualEvidenceRefreshMaxCandidates
    });
}

export async function runBusinessSkillVisualEvidenceRefreshBeforeExecution(
    gate: BusinessSkillVisualEvidencePreExecutionGate | undefined,
    executeParams: SkillExecuteParams,
    options: BusinessSkillVisualEvidenceRefreshRunnerOptions = {}
): Promise<BusinessSkillVisualEvidencePreExecutionRunnerResult> {
    if (!gate) return { executeParams };

    if (!gate.canRunBusinessExecutor && !gate.shouldRunRefreshBeforeExecution) {
        return {
            executeParams,
            blockedResult: buildBusinessSkillVisualEvidencePreExecutionBlockedResult(gate)
        };
    }

    if (!gate.shouldRunRefreshBeforeExecution) {
        return { executeParams };
    }

    const plan = gate.refreshPlan;
    if (!plan || !plan.shouldCallAnalyzer) {
        const runSummary = buildBusinessSkillVisualEvidencePreExecutionRunSummary({
            status: 'skipped_plan_not_ready',
            attempted: false,
            planStatus: plan?.status,
            reason: plan?.reason || 'refresh_plan_not_ready',
            warnings: gate.warnings,
            limitations: gate.limitations,
            evidence: [{
                source: 'business-skill-visual-evidence-pre-execution-run',
                summary: 'pre-execution refresh plan is not runnable',
                status: 'needs_review'
            }]
        });
        return { executeParams, runSummary };
    }

    const runner = options.runCacheFill || runProjectVisualInsightCacheFill;
    try {
        const fillResult = await runner({
            projectPath: plan.projectPath,
            visualSamplingPlan: executeParams.context?.projectContext?.visualSamplingPlan,
            enabled: true,
            maxCandidates: plan.maxCandidates,
            modelId: readOptionalString(executeParams.params.visualEvidenceRefreshModelId)
        });
        const runSummary = buildBusinessSkillVisualEvidencePreExecutionRunSummary({
            status: fillResult.status || 'unknown',
            attempted: true,
            planStatus: plan.status,
            analyzedCount: fillResult.analyzedCount || 0,
            successCount: fillResult.successCount || 0,
            failedCount: fillResult.failedCount || 0,
            writtenEntryCount: Array.isArray(fillResult.entries) ? fillResult.entries.length : 0,
            warnings: fillResult.warnings || [],
            limitations: [
                '前置刷新只把结构化视觉摘要写入缓存，不把模型 payload 暴露给业务结果。',
                '前置刷新只更新只读上下文，不改变业务 skill 的设计策略。',
                ...(fillResult.limitations || [])
            ],
            evidence: fillResult.evidence || []
        });
        const updatedExecuteParams = updateExecuteParamsWithPreExecutionVisualEvidence(
            executeParams,
            fillResult.successCount || 0
        );
        return {
            executeParams: updatedExecuteParams,
            runSummary
        };
    } catch (error) {
        const runSummary = buildBusinessSkillVisualEvidencePreExecutionRunSummary({
            status: 'failed',
            attempted: true,
            planStatus: plan.status,
            warnings: ['前置素材理解刷新失败；默认不改变既有业务执行，除非启用 strict。'],
            limitations: [
                '前置刷新失败不能证明视觉理解已完成，也不能证明设计质量通过。',
                '默认策略下该失败只作为内部记录保留，不改变业务 skill 执行。'
            ],
            evidence: [{
                source: 'business-skill-visual-evidence-pre-execution-run',
                summary: 'pre-execution visual evidence refresh failed',
                status: 'failed'
            }],
            error: readErrorText(error)
        });

        if (!gate.canRunBusinessExecutor) {
            return {
                executeParams,
                runSummary,
                blockedResult: buildBusinessSkillVisualEvidencePreExecutionBlockedResult(gate, runSummary)
            };
        }

        return { executeParams, runSummary };
    }
}

export function attachBusinessSkillVisualEvidencePreExecutionToResult(
    result: AgentResult,
    gate?: BusinessSkillVisualEvidencePreExecutionGate,
    runSummary?: BusinessSkillVisualEvidencePreExecutionRunSummary
): AgentResult {
    if (!gate && !runSummary) return result;
    return {
        ...result,
        data: {
            ...(result.data || {}),
            ...(gate ? { businessSkillVisualEvidencePreExecutionGate: gate } : {}),
            ...(runSummary ? { businessSkillVisualEvidencePreExecutionRun: runSummary } : {})
        }
    };
}

export async function runBusinessSkillVisualEvidenceRefreshAfterExecution(
    result: AgentResult,
    gate: BusinessSkillExecutionPreflightGate | undefined,
    executeParams: SkillExecuteParams,
    options: BusinessSkillVisualEvidenceRefreshRunnerOptions = {}
): Promise<AgentResult> {
    if (!gate) return result;

    const resultWithPlan = result.data?.businessSkillVisualEvidenceRefreshPlan
        ? result
        : attachBusinessSkillExecutionPreflightGateToResult(result, gate, executeParams);
    const plan = (resultWithPlan.data as any)?.businessSkillVisualEvidenceRefreshPlan;
    if (!plan) return resultWithPlan;

    if (!isBusinessVisualEvidenceRefreshRunnerEnabled(executeParams.params)) {
        return attachBusinessSkillVisualEvidenceRefreshRun(resultWithPlan, {
            version: 'business-skill-visual-evidence-refresh-run/v0',
            status: 'skipped_runner_disabled',
            attempted: false,
            planStatus: plan.status,
            reason: 'runner_not_enabled',
            analyzedCount: 0,
            successCount: 0,
            failedCount: 0,
            writtenEntryCount: 0,
            warnings: ['素材理解刷新 runner 未显式启用。'],
            limitations: [
                '刷新计划已生成，但不会自动调用视觉模型或写入缓存。',
                '该 runner 只在业务 executor 完成后运行，不能改变当前业务输出。'
            ],
            evidence: [{
                source: 'business-skill-visual-evidence-refresh-run',
                summary: 'runner disabled by explicit execution policy',
                status: 'needs_review'
            }]
        });
    }

    if (plan.shouldRunRefresh !== true) {
        return attachBusinessSkillVisualEvidenceRefreshRun(resultWithPlan, {
            version: 'business-skill-visual-evidence-refresh-run/v0',
            status: 'skipped_plan_not_ready',
            attempted: false,
            planStatus: plan.status,
            reason: plan.fillPlan?.reason || 'refresh_plan_not_ready',
            analyzedCount: 0,
            successCount: 0,
            failedCount: 0,
            writtenEntryCount: 0,
            warnings: plan.warnings || [],
            limitations: plan.limitations || [],
            evidence: [{
                source: 'business-skill-visual-evidence-refresh-run',
                summary: `refresh plan is not runnable: ${plan.status}`,
                status: 'needs_review'
            }]
        });
    }

    const runner = options.runCacheFill || runProjectVisualInsightCacheFill;
    try {
        const fillResult = await runner({
            projectPath: plan.projectPath,
            visualSamplingPlan: executeParams.context?.projectContext?.visualSamplingPlan,
            enabled: true,
            maxCandidates: plan.fillPlan?.maxCandidates,
            modelId: readOptionalString(executeParams.params.visualEvidenceRefreshModelId)
        });
        return attachBusinessSkillVisualEvidenceRefreshRun(resultWithPlan, {
            version: 'business-skill-visual-evidence-refresh-run/v0',
            status: fillResult.status || 'unknown',
            attempted: true,
            planStatus: plan.status,
            analyzedCount: fillResult.analyzedCount || 0,
            successCount: fillResult.successCount || 0,
            failedCount: fillResult.failedCount || 0,
            writtenEntryCount: Array.isArray(fillResult.entries) ? fillResult.entries.length : 0,
            warnings: fillResult.warnings || [],
            limitations: [
                '刷新 runner 只把结构化视觉摘要写入缓存，不把模型 payload 暴露给业务结果。',
                '刷新 runner 在业务 executor 完成后运行，不能改变当前 Photoshop 输出。',
                ...(fillResult.limitations || [])
            ],
            evidence: fillResult.evidence || []
        });
    } catch (error) {
        return attachBusinessSkillVisualEvidenceRefreshRun(resultWithPlan, {
            version: 'business-skill-visual-evidence-refresh-run/v0',
            status: 'failed',
            attempted: true,
            planStatus: plan.status,
            analyzedCount: 0,
            successCount: 0,
            failedCount: 0,
            writtenEntryCount: 0,
            warnings: ['素材理解刷新 runner 调用失败；当前业务结果保持不变。'],
            limitations: [
                'runner failure is evidence-only and must not be treated as business skill failure.',
                '该错误不证明视觉理解已完成，也不证明设计质量通过。'
            ],
            evidence: [{
                source: 'business-skill-visual-evidence-refresh-run',
                summary: 'visual evidence refresh runner failed',
                status: 'failed'
            }],
            error: readErrorText(error)
        });
    }
}

export function buildBusinessSkillVisualEvidenceRefreshPlanForSkill(
    skillId: string,
    executeParams: SkillExecuteParams | undefined,
    plannerEvidence: BusinessSkillPreflightPlannerEvidence | undefined
) {
    if (!isBusinessSkillExecutionPreflightSkill(skillId) || !plannerEvidence) return undefined;

    const params = executeParams?.params || {};
    const projectContext = executeParams?.context?.projectContext as any;
    const runtimeReady = params.visualEvidenceRefreshRuntimeReady === true;
    const runtimeCapabilities = detectBusinessSkillVisualEvidenceRefreshRuntime();

    return buildBusinessSkillVisualEvidenceRefreshPlan({
        skillId,
        plannerEvidence,
        projectPath: projectContext?.projectPath,
        visualSamplingPlan: projectContext?.visualSamplingPlan,
        enabled: params.enableVisualEvidenceRefresh
            ?? params.enableBusinessVisualEvidenceRefresh
            ?? params.refreshVisualEvidence,
        runtimeCanAnalyze: params.visualEvidenceRefreshCanAnalyze === true || runtimeReady || runtimeCapabilities.canAnalyze,
        runtimeCanWriteCache: params.visualEvidenceRefreshCanWriteCache === true || runtimeReady || runtimeCapabilities.canWriteCache,
        maxCandidates: params.visualEvidenceRefreshMaxCandidates
    });
}

function attachBusinessSkillVisualEvidenceRefreshRun(
    result: AgentResult,
    runSummary: BusinessSkillVisualEvidenceRefreshRunSummary
): AgentResult {
    return {
        ...result,
        data: {
            ...(result.data || {}),
            businessSkillVisualEvidenceRefreshRun: runSummary
        }
    };
}

function isBusinessVisualEvidenceRefreshRunnerEnabled(params: Record<string, any>): boolean {
    return params.runBusinessVisualEvidenceRefresh === true
        || params.executeBusinessVisualEvidenceRefresh === true
        || params.runVisualEvidenceRefresh === true;
}

function firstDefined(...values: unknown[]): unknown {
    return values.find((value) => value !== undefined);
}

function appendProjectContextWarning(
    executeParams: SkillExecuteParams,
    warning: string
): SkillExecuteParams {
    const projectContext = executeParams.context?.projectContext as any;
    if (!projectContext) return executeParams;

    return {
        ...executeParams,
        context: {
            ...(executeParams.context as any),
            projectContext: {
                ...projectContext,
                contextSnapshotWarnings: mergeUniqueStrings(
                    projectContext.contextSnapshotWarnings,
                    [warning]
                )
            }
        }
    };
}

function readSelectedAssetPaths(projectContext: any): string[] {
    if (Array.isArray(projectContext?.contextSnapshot?.selectedAssetPaths)) {
        return projectContext.contextSnapshot.selectedAssetPaths
            .map((item: unknown) => readOptionalString(item))
            .filter((item: string | undefined): item is string => Boolean(item));
    }
    const selectedProjectImagePath = readOptionalString(projectContext?.selectedProjectImagePath);
    return selectedProjectImagePath ? [selectedProjectImagePath] : [];
}

function mergeUniqueStrings(...values: unknown[]): string[] {
    const merged: string[] = [];
    const seen = new Set<string>();

    for (const value of values) {
        const items = Array.isArray(value) ? value : [value];
        for (const item of items) {
            const text = readOptionalString(item);
            if (!text || seen.has(text)) continue;
            seen.add(text);
            merged.push(text);
        }
    }

    return merged;
}

function buildBusinessSkillVisualEvidencePreExecutionBlockedResult(
    gate: BusinessSkillVisualEvidencePreExecutionGate,
    runSummary?: BusinessSkillVisualEvidencePreExecutionRunSummary
): AgentResult {
    return attachBusinessSkillVisualEvidencePreExecutionToResult({
        success: false,
        message: '当前业务设计能力缺少执行前必须的视觉理解结果，已按 strict 策略停止执行。',
        error: 'business_visual_evidence_required_before_execution'
    }, gate, runSummary);
}

function buildBusinessSkillVisualEvidencePreExecutionRunSummary(input: {
    status: string;
    attempted: boolean;
    planStatus?: string;
    reason?: string;
    analyzedCount?: number;
    successCount?: number;
    failedCount?: number;
    writtenEntryCount?: number;
    warnings?: string[];
    limitations?: string[];
    evidence?: Array<{ source: string; summary: string; status?: string }>;
    error?: string;
}): BusinessSkillVisualEvidencePreExecutionRunSummary {
    return {
        version: 'business-skill-visual-evidence-pre-execution-run/v0',
        stage: 'before_execution',
        status: input.status,
        attempted: input.attempted,
        planStatus: input.planStatus,
        reason: input.reason,
        analyzedCount: input.analyzedCount || 0,
        successCount: input.successCount || 0,
        failedCount: input.failedCount || 0,
        writtenEntryCount: input.writtenEntryCount || 0,
        warnings: input.warnings || [],
        limitations: input.limitations || [],
        evidence: input.evidence || [],
        error: input.error
    };
}

function updateExecuteParamsWithPreExecutionVisualEvidence(
    executeParams: SkillExecuteParams,
    successCount: number
): SkillExecuteParams {
    if (successCount <= 0) return executeParams;

    const projectContext = executeParams.context?.projectContext as any;
    if (!projectContext) return executeParams;

    const previousSummary = projectContext.visualInsightCache?.summary || {};
    const previousEntriesWithInsight = Number(previousSummary.entriesWithInsight || 0);
    const previousTotalEntries = Number(previousSummary.totalEntries || 0);
    const visualInsightCache = {
        ...(projectContext.visualInsightCache || {}),
        summary: {
            ...previousSummary,
            totalEntries: Math.max(previousTotalEntries, previousEntriesWithInsight + successCount),
            entriesWithInsight: previousEntriesWithInsight + successCount
        }
    };

    return {
        ...executeParams,
        context: {
            ...(executeParams.context as any),
            projectContext: {
                ...projectContext,
                visualInsightCache
            }
        }
    };
}

function readOptionalString(value: unknown): string | undefined {
    const text = String(value || '').trim();
    return text || undefined;
}

function readErrorText(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error || '').trim() || 'unknown refresh runner error';
}

function hasVisualUnderstandingEvidence(projectContext: any): boolean {
    const entriesWithInsight = projectContext?.visualInsightCache?.summary?.entriesWithInsight;
    if (typeof entriesWithInsight === 'number' && entriesWithInsight > 0) {
        return true;
    }

    const selectedCandidates = projectContext?.visualSamplingPlan?.selectedCandidates;
    return Array.isArray(selectedCandidates) && selectedCandidates.some((candidate) => Boolean(candidate?.cachedInsight));
}

function hasSkillScenarioVisualUnderstandingEvidence(skillId: string, projectContext: any): boolean {
    const expectedScenario = getBusinessVisualEvidenceScenarioForSkill(skillId);
    if (expectedScenario && projectContext?.visualSamplingPlan?.scenario !== expectedScenario) {
        return false;
    }
    return hasVisualUnderstandingEvidence(projectContext);
}

function hasTemplateEvidence(result: AgentResult | undefined): boolean {
    const data = result?.data as Record<string, unknown> | undefined;
    if (!data) return false;

    return Boolean(
        data.designAgentOs
        || data.templateBlueprint
        || data.detailPageSkillReadiness
        || data.readiness
        || data.mainImageAgentDraft
        || data.skuPlan
        || data.executionPlan
    );
}
