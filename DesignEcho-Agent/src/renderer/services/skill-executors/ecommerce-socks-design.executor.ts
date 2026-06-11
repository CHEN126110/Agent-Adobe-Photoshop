import type { AgentResult } from '../unified-agent.service';
import type { SkillExecutor, SkillExecuteParams } from './types';
import type {
    EcommerceSocksChildDispatchReport,
    EcommerceSocksChildDispatchRunResult,
    EcommerceSocksDispatchOrchestrationChildStep
} from '../../../shared/ecommerce-socks-design';
import type { BusinessDesignSkillId } from '../../../shared/business-skill-implementation-checkpoint';
import {
    buildEcommerceSocksChildReportAggregation,
    buildEcommerceSocksChildDispatchRun,
    buildEcommerceSocksDesignEntryEvidence,
    buildEcommerceSocksDispatchAuthorization,
    buildEcommerceSocksDispatchDecision,
    buildEcommerceSocksDispatchLifecycle,
    buildEcommerceSocksDispatchOrchestrationPlan,
    normalizeEcommerceSocksDeliverables
} from '../../../shared/ecommerce-socks-design';
import { buildEcommerceSocksChildStrategyPacketSet } from '../../../shared/ecommerce-socks-child-strategy-packets';
import { buildEcommerceSocksChildStrategyReviewGate } from '../../../shared/ecommerce-socks-child-strategy-review-gate';
import { buildEcommerceSocksStrategyCheckpoint } from '../../../shared/ecommerce-socks-strategy-checkpoint';

function resolveUserIntent(executeParams: SkillExecuteParams): string {
    return String(executeParams.params.userIntent || executeParams.context?.userInput || '').trim();
}

function resolveProjectPath(executeParams: SkillExecuteParams): string | undefined {
    const projectPath = String(
        executeParams.params.projectPath
        || executeParams.context?.projectContext?.projectPath
        || ''
    ).trim();
    return projectPath || undefined;
}

function emitPlanningStep(
    executeParams: SkillExecuteParams,
    phase: 'started' | 'completed',
    options: {
        detail?: string;
        success?: boolean;
        issue?: string;
    } = {}
): void {
    const isStarted = phase === 'started';
    executeParams.callbacks?.onStep?.({
        kind: isStarted ? 'tool_started' : 'tool_completed',
        title: isStarted
            ? '开始能力：电商袜子设计'
            : `${options.success === false ? '能力未完成' : '能力完成'}：电商袜子设计`,
        detail: isStarted
            ? '整理主图、详情页、SKU 子 Skill 编排入口。'
            : options.detail || '已生成父 Skill 编排计划；未执行 Photoshop 写入。',
        status: isStarted ? 'running' : (options.success === false ? 'error' : 'success'),
        toolName: 'ecommerce-socks-design',
        toolCallId: 'ecommerce-socks-design-entry',
        percent: isStarted ? 30 : 95,
        issue: options.issue
    });
}

function summarizeDeliverables(labels: string[]): string {
    if (labels.length === 0) return '未识别交付物';
    return labels.join('、');
}

function resolveBoolean(value: unknown): boolean {
    return value === true || value === 'true' || value === 1 || value === '1';
}

function resolveChildReports(value: unknown): EcommerceSocksChildDispatchReport[] {
    return Array.isArray(value) ? value as EcommerceSocksChildDispatchReport[] : [];
}

function resolveBusinessDesignSkillIds(value: unknown): BusinessDesignSkillId[] {
    const values = Array.isArray(value)
        ? value
        : String(value || '').split(',');
    const allowed = new Set<BusinessDesignSkillId>(['main-image-design', 'detail-page-design', 'sku-batch']);
    return values
        .map((item) => String(item || '').trim())
        .filter((item): item is BusinessDesignSkillId => allowed.has(item as BusinessDesignSkillId));
}

function resolveChildDispatchEnabled(executeParams: SkillExecuteParams): boolean {
    return resolveBoolean(
        executeParams.params.enableChildDispatch
        || executeParams.params.runChildDispatch
        || executeParams.params.executeRealChildDispatch
    );
}

type ChildDispatchExecutionPath = 'unified_executor' | 'test_override';

function resolveChildExecutorOverride(step: EcommerceSocksDispatchOrchestrationChildStep, executeParams: SkillExecuteParams): SkillExecutor | undefined {
    const override = executeParams.params.childExecutorOverrides?.[step.skillId];
    if (override && typeof override.execute === 'function') {
        return override as SkillExecutor;
    }
    if (typeof override === 'function') {
        return {
            skillId: step.skillId,
            execute: override
        };
    }

    return undefined;
}

function hasChildExecutorOverride(steps: EcommerceSocksDispatchOrchestrationChildStep[], executeParams: SkillExecuteParams): boolean {
    return steps.some((step) => Boolean(resolveChildExecutorOverride(step, executeParams)));
}

function resolveChildDispatchExecutionPath(
    executeParams: SkillExecuteParams,
    steps: EcommerceSocksDispatchOrchestrationChildStep[]
): ChildDispatchExecutionPath | undefined {
    if (executeParams.runSkill) {
        return 'unified_executor';
    }
    if (hasChildExecutorOverride(steps, executeParams)) {
        return 'test_override';
    }
    return undefined;
}

function resolveChildSkillParams(
    step: EcommerceSocksDispatchOrchestrationChildStep,
    executeParams: SkillExecuteParams,
    userIntent: string,
    projectPath?: string
): Record<string, any> {
    const childSkillParams = executeParams.params.childSkillParams;
    const explicitParams = childSkillParams && typeof childSkillParams === 'object'
        ? childSkillParams[step.skillId] || childSkillParams[step.deliverable] || {}
        : {};

    return {
        ...explicitParams,
        userIntent,
        projectPath,
        parentSkillId: 'ecommerce-socks-design',
        parentDeliverable: step.deliverable,
        expectedReportKey: step.expectedReportKey
    };
}

function toChildReportStatus(
    result: AgentResult,
    expectedReportKey?: string
): EcommerceSocksChildDispatchReport['status'] {
    if (!result.success) return 'failed';
    const dataStatus = resolveChildStatusFromData(result, expectedReportKey || '');
    if (['completed', 'partial', 'failed', 'needs_review'].includes(dataStatus)) {
        return dataStatus as EcommerceSocksChildDispatchReport['status'];
    }
    return 'needs_review';
}

function toChildOutputQuality(result: AgentResult, expectedReportKey: string): boolean {
    const data = readObject(result.data);
    const report = resolveChildReportPayload(result, expectedReportKey);
    if (report && typeof report === 'object' && report.canClaimOutputQuality === true) {
        return true;
    }
    if (data?.canClaimOutputQuality === true) {
        return true;
    }

    const mainImageQaReport = readObject(data?.mainImageQaReport);
    const qualityClaim = readObject(mainImageQaReport?.qualityClaim);
    if (qualityClaim?.allowed === true) {
        return true;
    }

    return data?.reviewLevel === 'ok' || data?.status === 'completed';
}

function toText(value: unknown): string | undefined {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text || undefined;
}

function readObject(value: unknown): Record<string, any> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, any>;
}

function resolveChildReportPayload(result: AgentResult, expectedReportKey: string): Record<string, any> | null {
    const data = readObject(result.data);
    if (!data) {
        return null;
    }
    return readObject(data[expectedReportKey]);
}

function resolveChildStatusFromData(result: AgentResult, expectedReportKey: string): string {
    const report = resolveChildReportPayload(result, expectedReportKey);
    if (typeof report?.status === 'string') {
        return report.status.trim();
    }

    const data = readObject(result.data);
    if (typeof data?.status === 'string') {
        return data.status.trim();
    }

    if (typeof data?.reviewLevel === 'string') {
        return data.reviewLevel === 'ok' ? 'completed' : 'needs_review';
    }

    const mainImageQaReport = readObject(data?.mainImageQaReport);
    const qualityClaim = readObject(mainImageQaReport?.qualityClaim);
    if (qualityClaim?.allowed === true) {
        return 'completed';
    }
    if (typeof mainImageQaReport?.status === 'string') {
        return mainImageQaReport.status === 'passed' ? 'completed' : 'needs_review';
    }

    return '';
}

function summarizeChildResult(
    step: EcommerceSocksDispatchOrchestrationChildStep,
    result: AgentResult
): EcommerceSocksChildDispatchRunResult {
    const status = toChildReportStatus(result, step.expectedReportKey);
    const data = readObject(result.data);
    const report = resolveChildReportPayload(result, step.expectedReportKey);
    const outputCount = Number(report?.outputCount ?? data?.outputCount ?? data?.exportCount ?? 0) || undefined;
    const warnings = Array.isArray(report?.warnings)
        ? report.warnings
        : (Array.isArray(data?.warnings) ? data.warnings : []);
    const blockers = Array.isArray(report?.blockers)
        ? report.blockers
        : (Array.isArray(data?.blockers) ? data.blockers : []);
    return {
        version: 'ecommerce-socks-child-report/v0',
        expectedReportKey: step.expectedReportKey,
        deliverable: step.deliverable,
        skillId: step.skillId,
        success: result.success === true && status !== 'failed',
        status,
        canClaimOutputQuality: toChildOutputQuality(result, step.expectedReportKey),
        outputCount,
        message: toText(result.message),
        error: toText(result.error),
        warnings,
        blockers
    };
}

function toChildDispatchReports(
    childRunResults: EcommerceSocksChildDispatchRunResult[]
): EcommerceSocksChildDispatchReport[] {
    return childRunResults.map((result) => ({
        version: 'ecommerce-socks-child-report/v0',
        expectedReportKey: result.expectedReportKey,
        deliverable: result.deliverable,
        skillId: result.skillId,
        status: result.status,
        canClaimOutputQuality: result.canClaimOutputQuality,
        outputCount: result.outputCount,
        warnings: result.warnings,
        blockers: result.blockers
    }));
}

function buildFailedChildResultFromError(
    step: EcommerceSocksDispatchOrchestrationChildStep,
    error: unknown
): EcommerceSocksChildDispatchRunResult {
    const message = error instanceof Error ? error.message : String(error || 'Unknown child skill error');
    return {
        version: 'ecommerce-socks-child-report/v0',
        expectedReportKey: step.expectedReportKey,
        deliverable: step.deliverable,
        skillId: step.skillId,
        success: false,
        status: 'failed',
        canClaimOutputQuality: false,
        message: undefined,
        error: toText(message) || 'child_skill_exception',
        warnings: [],
        blockers: ['child_skill_exception']
    };
}

async function runChildDispatch(
    executeParams: SkillExecuteParams,
    steps: EcommerceSocksDispatchOrchestrationChildStep[],
    userIntent: string,
    projectPath: string | undefined,
    childExecutionPath: ChildDispatchExecutionPath
): Promise<EcommerceSocksChildDispatchRunResult[]> {
    const results: EcommerceSocksChildDispatchRunResult[] = [];

    for (const step of steps) {
        if (executeParams.signal?.aborted) {
            throw new Error('Child dispatch aborted');
        }

        executeParams.callbacks?.onStep?.({
            kind: 'tool_started',
            title: `执行子能力：${step.label}`,
            detail: `调用 ${step.skillId}`,
            status: 'running',
            toolName: step.skillId,
            toolCallId: `ecommerce-socks-child-${step.skillId}`,
            percent: step.progressRange.start
        });

        let childResult: EcommerceSocksChildDispatchRunResult;
        try {
            const childParams: SkillExecuteParams = {
                ...executeParams,
                params: resolveChildSkillParams(step, executeParams, userIntent, projectPath)
            };
            const overrideExecutor = resolveChildExecutorOverride(step, executeParams);
            const result = childExecutionPath === 'test_override' && overrideExecutor
                ? await overrideExecutor.execute(childParams)
                : await executeParams.runSkill!(step.skillId, childParams);
            childResult = summarizeChildResult(step, result);
        } catch (error) {
            childResult = buildFailedChildResultFromError(step, error);
        }

        results.push(childResult);

        executeParams.callbacks?.onStep?.({
            kind: 'tool_completed',
            title: `${childResult.success ? '子能力完成' : '子能力失败'}：${step.label}`,
            detail: childResult.error || childResult.message || `子能力 ${step.skillId} 已返回。`,
            status: childResult.success ? 'success' : 'error',
            toolName: step.skillId,
            toolCallId: `ecommerce-socks-child-${step.skillId}`,
            percent: step.progressRange.end,
            issue: childResult.success ? undefined : childResult.error || 'child_skill_failed'
        });

        if (!childResult.success || childResult.status === 'failed') break;
    }

    return results;
}

export const ecommerceSocksDesignExecutor: SkillExecutor = {
    skillId: 'ecommerce-socks-design',

    async execute(executeParams: SkillExecuteParams): Promise<AgentResult> {
        emitPlanningStep(executeParams, 'started');

        const userIntent = resolveUserIntent(executeParams);
        const projectPath = resolveProjectPath(executeParams);
        const dryRunChildDispatch = resolveBoolean(executeParams.params.dryRunChildDispatch);
        const deliverables = normalizeEcommerceSocksDeliverables(executeParams.params.deliverables, userIntent);
        const strategyCheckpoint = buildEcommerceSocksStrategyCheckpoint({
            deliverables,
            userCheckpointConfirmed: resolveBoolean(
                executeParams.params.userCheckpointConfirmed
                || executeParams.params.confirmBusinessStrategyCheckpoint
                || executeParams.params.confirmChildStrategyCheckpoint
            ),
            strategyInputsBySkill: executeParams.params.strategyInputsBySkill,
            riskFlagsBySkill: executeParams.params.riskFlagsBySkill
        });
        const childStrategyPacketSet = buildEcommerceSocksChildStrategyPacketSet({
            strategyCheckpoint
        });
        const childStrategyReviewGate = buildEcommerceSocksChildStrategyReviewGate({
            packetSet: childStrategyPacketSet,
            userReviewedStrategyPackets: resolveBoolean(
                executeParams.params.userReviewedChildStrategyPackets
                || executeParams.params.reviewedChildStrategyPackets
                || executeParams.params.confirmChildStrategyReview
            ),
            acknowledgedStrategyBoundaries: resolveBoolean(
                executeParams.params.acknowledgeChildStrategyBoundaries
                || executeParams.params.acknowledgedChildStrategyBoundaries
            ),
            approvedSkillIds: resolveBusinessDesignSkillIds(
                executeParams.params.approvedChildStrategySkills
                || executeParams.params.approvedChildStrategySkillIds
            ),
            deniedSkillIds: resolveBusinessDesignSkillIds(
                executeParams.params.deniedChildStrategySkills
                || executeParams.params.deniedChildStrategySkillIds
            )
        });
        const evidence = buildEcommerceSocksDesignEntryEvidence({
            userIntent,
            projectPath,
            deliverables,
            strategyCheckpoint,
            childStrategyPacketSet,
            childStrategyReviewGate
        });
        const dispatchDecision = buildEcommerceSocksDispatchDecision({
            childSkills: evidence.childSkills,
            executeChildren: resolveBoolean(executeParams.params.executeChildren),
            confirmChildDispatch: resolveBoolean(executeParams.params.confirmChildDispatch),
            childDispatchImplementationReady: resolveChildDispatchEnabled(executeParams)
        });
        const dispatchLifecycle = buildEcommerceSocksDispatchLifecycle({
            userIntent,
            childSkills: evidence.childSkills,
            dispatchDecision
        });
        const dispatchOrchestration = buildEcommerceSocksDispatchOrchestrationPlan({
            childSkills: evidence.childSkills,
            dispatchDecision,
            dispatchLifecycle
        });
        const dispatchAuthorization = buildEcommerceSocksDispatchAuthorization({
            dispatchDecision,
            dispatchOrchestration,
            userDeniedChildDispatch: resolveBoolean(
                executeParams.params.userDeniedChildDispatch || executeParams.params.denyChildDispatch
            )
        });
        const childExecutionPath = resolveChildDispatchExecutionPath(executeParams, dispatchOrchestration.childSteps);
        const childDispatchRuntimeBlockers = dispatchAuthorization.canExecuteChildren
            && !dryRunChildDispatch
            && !childExecutionPath
            ? ['child_skill_runner_missing' as const]
            : [];
        const childRunResults = dispatchAuthorization.canExecuteChildren
            && !dryRunChildDispatch
            && childExecutionPath
            ? await runChildDispatch(
                executeParams,
                dispatchOrchestration.childSteps,
                userIntent,
                projectPath,
                childExecutionPath
            )
            : [];
        const childDispatchRun = buildEcommerceSocksChildDispatchRun({
            dispatchAuthorization,
            dispatchOrchestration,
            dryRunChildDispatch,
            childRunResults,
            childExecutionPath,
            runtimeBlockers: childDispatchRuntimeBlockers
        });
        const childReportAggregation = buildEcommerceSocksChildReportAggregation({
            dispatchOrchestration,
            childReports: [
                ...resolveChildReports(executeParams.params.childReports),
                ...toChildDispatchReports(childRunResults)
            ]
        });
        const executedChildDispatch = childDispatchRun.canCallChildExecutors;
        const entryEvidence = buildEcommerceSocksDesignEntryEvidence({
            userIntent,
            projectPath,
            deliverables,
            executionMode: executedChildDispatch ? 'dispatch' : 'plan-only',
            dispatchDecision,
            dispatchLifecycle,
            dispatchOrchestration,
            dispatchAuthorization,
            childDispatchRun,
            childReportAggregation,
            strategyCheckpoint,
            childStrategyPacketSet,
            childStrategyReviewGate
        });
        const labels = evidence.childSkills.map((item) => item.label);
        const realDispatchFailed = executedChildDispatch && childDispatchRun.status !== 'executed';
        const resultSuccess = !realDispatchFailed;
        const completionDetail = executedChildDispatch
            ? `父 Skill 已完成子调度汇总；childDispatchRun=${childDispatchRun.status}，父级不声明设计质量完成。`
            : '已生成父 Skill 编排计划；未执行子 Skill 或 Photoshop 写入。';
        const issue = realDispatchFailed ? `child_dispatch_${childDispatchRun.status}` : undefined;

        emitPlanningStep(executeParams, 'completed', {
            detail: completionDetail,
            success: resultSuccess,
            issue
        });

        return {
            success: resultSuccess,
            message: [
                `已建立电商袜子设计入口计划：${summarizeDeliverables(labels)}。`,
                executedChildDispatch
                    ? `已尝试执行子 Skill 调度，结果为 ${childDispatchRun.status}；父 Skill 只汇总子报告，不声明整套设计质量完成。`
                    : '当前阶段只做父 Skill 编排和调度检查点，未执行子 Skill，也不改变三个子 Skill 的业务策略。'
            ].join('\n'),
            error: realDispatchFailed ? `Child dispatch ${childDispatchRun.status}` : undefined,
            data: {
                ecommerceSocksDesign: entryEvidence,
                ecommerceSocksDispatchDecision: dispatchDecision,
                ecommerceSocksDispatchLifecycle: dispatchLifecycle,
                ecommerceSocksDispatchOrchestration: dispatchOrchestration,
                ecommerceSocksDispatchAuthorization: dispatchAuthorization,
                ecommerceSocksChildDispatchRun: childDispatchRun,
                ecommerceSocksChildReportAggregation: childReportAggregation,
                ecommerceSocksStrategyCheckpoint: strategyCheckpoint,
                ecommerceSocksChildStrategyPacketSet: childStrategyPacketSet,
                ecommerceSocksChildStrategyReviewGate: childStrategyReviewGate
            }
        };
    }
};
