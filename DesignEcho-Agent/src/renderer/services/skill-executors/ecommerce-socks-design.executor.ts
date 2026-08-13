import type { AgentResult } from '../unified-agent.service';
import type { SkillExecutor, SkillExecuteParams } from './types';
import type {
    EcommerceSocksChildDispatchReport,
    EcommerceSocksChildDispatchRun,
    EcommerceSocksChildDispatchRunResult,
    EcommerceSocksDispatchOrchestrationChildStep
} from '../../../shared/ecommerce-socks-design';
import type { BusinessDesignSkillId } from '../../../shared/business-skill-implementation-checkpoint';
import {
    buildEcommerceSocksChildReportAggregation,
    buildEcommerceSocksChildDispatchRun,
    buildEcommerceSocksDesignState,
    buildEcommerceSocksDispatchAuthorization,
    buildEcommerceSocksDispatchDecision,
    buildEcommerceSocksDispatchLifecycle,
    buildEcommerceSocksDispatchOrchestrationPlan,
    normalizeEcommerceSocksDeliverables
} from '../../../shared/ecommerce-socks-design';
import { buildEcommerceSocksChildStrategyPacketSet } from '../../../shared/ecommerce-socks-child-strategy-packets';
import { buildEcommerceSocksChildStrategyReviewGate } from '../../../shared/ecommerce-socks-child-strategy-review-gate';
import { buildEcommerceSocksChildStrategyHandoff } from '../../../shared/ecommerce-socks-child-strategy-handoff';
import { buildEcommerceSocksStrategyCheckpoint } from '../../../shared/ecommerce-socks-strategy-checkpoint';
import { applySharedSkillParamDefaults } from '../../../shared/skill-param-defaults';

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

/**
 * 子调度是否就绪。默认 true——真实下发实现（runChildDispatch）早已完整并有专项 smoke 覆盖，
 * 此前默认 false 只是保守没接线，导致 `child_dispatch_checkpoint_not_implemented`
 * 把授权永久卡在 approved_but_blocked，而真机没有任何入口能把它打开。
 *
 * 保留显式 `enableChildDispatch: false` 作为关闭口：调试与状态机测试仍需要构造受阻分支。
 */
function resolveChildDispatchEnabled(executeParams: SkillExecuteParams): boolean {
    const params = executeParams.params || {};
    for (const key of ['enableChildDispatch', 'runChildDispatch', 'executeRealChildDispatch']) {
        if (params[key] === false || params[key] === 'false') return false;
    }
    return true;
}

type ChildDispatchExecutionPath = 'unified_executor' | 'test_override' | 'own_registry';

const CHILD_DOCUMENT_TARGETS: Record<BusinessDesignSkillId, {
    targetDocumentRole: 'mainImage' | 'detailPage' | 'sku';
    targetDocumentName: string;
    targetDocumentNameAliases: string[];
}> = {
    'main-image-design': {
        targetDocumentRole: 'mainImage',
        targetDocumentName: '主图',
        targetDocumentNameAliases: ['主图', '点击图', '转化图', 'main-image']
    },
    'detail-page-design': {
        targetDocumentRole: 'detailPage',
        targetDocumentName: '详情页',
        targetDocumentNameAliases: ['详情页', '商品详情', 'detail-page']
    },
    'sku-batch': {
        targetDocumentRole: 'sku',
        targetDocumentName: 'SKU',
        targetDocumentNameAliases: ['SKU', 'SKU.psd', 'SKU.psb', 'SKU-card-source']
    }
};

function resolveChildExecutionDefaults(step: EcommerceSocksDispatchOrchestrationChildStep): Record<string, any> {
    if (step.skillId === 'main-image-design') {
        return {
            mainImageExecutionMode: 'product-disposable-live',
            executionScope: 'disposable-document',
            sourceAssetKind: 'selected-project-image',
            outputDirPolicy: 'project-main-image-dir',
            approvedLiveExecution: true,
            approvedLiveAdapterRun: true,
            enableVisionPreflight: true,
            maxVisionCandidates: 1,
            userCheckpointApproved: true
        };
    }

    if (step.skillId === 'detail-page-design') {
        return {
            allowFreshDetailPageFallback: true,
            freshDetailPageFallbackSkillId: 'autonomous-agent'
        };
    }

    return {};
}

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

/** 历史下发确认卡的标识。父级已不再产这张卡，仅用于回读可能还挂着的旧卡片提交。 */
const DISPATCH_CONFIRMATION_CARD_ID = 'ecommerce-socks-dispatch-confirmation';
const DISPATCH_CONFIRMATION_FIELD_ID = 'startChildDispatch';

/**
 * 回读历史下发确认卡的选择。
 *
 * 这张卡已于 2026-07-31 移除：它问的是「要不要开始」，而用户在需求里已经回答过——
 * 属于问许可而不是问信息，是无意义的打断（详见下方 dispatchDecision 处的说明）。
 * 保留回读是为了兼容：卡片移除前产生的挂起操作若被用户续跑回来，仍要认得出那次授权，
 * 否则会退回「未授权」并再次卡住。不要因为「没人再产这张卡」就把它当死代码删掉。
 */
function readDispatchConfirmationFromCard(params: Record<string, any>): boolean {
    const submission = params?.interactiveCardSubmission;
    if (!submission || typeof submission !== 'object') return false;
    if (String(submission.cardId || '').trim() !== DISPATCH_CONFIRMATION_CARD_ID) return false;
    const values = submission.value && typeof submission.value === 'object'
        ? (submission.value as Record<string, any>).values
        : undefined;
    return Boolean(values && values[DISPATCH_CONFIRMATION_FIELD_ID] === true);
}

/**
 * 解析用什么方式调起子任务。
 *
 * 真机 2026-07-31：父 Skill 原先只认调用方注入的 `executeParams.runSkill`，缺了就产出
 * `child_skill_runner_missing`、静默退化成 plan-only——用户侧只看到「本轮完成了编排规划，
 * 没有下发子任务」，像是设计如此，实际是断链。而这个注入散在调用链上，任何一条路径漏传
 * 整个编排能力就没了，且不报错。
 *
 * 编排是父 Skill 的本职：它自己就该有能力调子 Skill，不该依赖别人递进来。
 * 因此加 `own_registry` 兜底——注入缺失时直接走技能注册表。用动态 import 避免
 * registry ↔ executor 的循环依赖。
 */
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
    return 'own_registry';
}

/** 注入缺失时自持的子任务执行口径，与 unified_executor 走同一个注册表入口。 */
async function runChildSkillViaRegistry(
    skillId: string,
    childParams: SkillExecuteParams
): Promise<AgentResult> {
    const registry = await import('./registry');
    return registry.executeSkillWithExecutor(skillId, childParams);
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

    const params = {
        ...resolveChildExecutionDefaults(step),
        ...CHILD_DOCUMENT_TARGETS[step.skillId],
        ...explicitParams,
        userIntent,
        projectPath,
        parentSkillId: 'ecommerce-socks-design',
        parentDeliverable: step.deliverable,
        expectedReportKey: step.expectedReportKey
    };

    return applySharedSkillParamDefaults({
        skillId: step.skillId,
        userInput: userIntent,
        mode: 'execute',
        params
    });
}

function toChildReportStatus(
    result: AgentResult,
    expectedReportKey?: string
): EcommerceSocksChildDispatchReport['status'] {
    const dataStatus = resolveChildStatusFromData(result, expectedReportKey || '');
    if (['completed', 'partial', 'failed', 'needs_review'].includes(dataStatus)) {
        return dataStatus as EcommerceSocksChildDispatchReport['status'];
    }
    const executionSummaryStatus = String(
        (result as any).executionSummary?.status
        || (result.data as any)?.executionSummary?.status
        || ''
    ).trim();
    if (['completed', 'failed', 'needs_review'].includes(executionSummaryStatus)) {
        return executionSummaryStatus as EcommerceSocksChildDispatchReport['status'];
    }
    if (!result.success) return 'failed';
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

function resolveInteractiveCardsFromResult(result: AgentResult): unknown[] {
    const cardsFromData = Array.isArray((result.data as any)?.interactiveCards)
        ? (result.data as any).interactiveCards
        : [];
    const cardsFromTools = Array.isArray(result.toolResults)
        ? result.toolResults.flatMap((toolResult: any) => (
            Array.isArray(toolResult?.result?.interactiveCards)
                ? toolResult.result.interactiveCards
                : []
        ))
        : [];
    return [...cardsFromData, ...cardsFromTools]
        .filter((card) => readObject(card)?.version === 'interactive-card/v0');
}

function resolveInteractiveCardsFromChildRunResults(
    childRunResults: EcommerceSocksChildDispatchRunResult[]
): unknown[] {
    return childRunResults.flatMap((result) => (
        Array.isArray(result.interactiveCards) ? result.interactiveCards : []
    ));
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
        success: status !== 'failed',
        status,
        canClaimOutputQuality: toChildOutputQuality(result, step.expectedReportKey),
        outputCount,
        message: toText(result.message),
        error: toText(result.error),
        warnings,
        blockers,
        interactiveCards: resolveInteractiveCardsFromResult(result)
    };
}

function shouldRunFreshDetailPageFallback(
    step: EcommerceSocksDispatchOrchestrationChildStep,
    childResult: EcommerceSocksChildDispatchRunResult,
    childParams: SkillExecuteParams,
    executeParams: SkillExecuteParams
): boolean {
    if (step.skillId !== 'detail-page-design') return false;
    if (childParams.params.allowFreshDetailPageFallback === false) return false;
    if (!executeParams.runSkill) return false;
    const failureText = [
        childResult.error,
        childResult.message,
        ...(Array.isArray(childResult.blockers) ? childResult.blockers : [])
    ].map((item) => String(item || '')).join(' ');
    return childResult.success === false
        && (
            childResult.error === 'detail_page_document_role_mismatch'
            || /No parsed screens|没有识别到可用的详情页屏结构|没有识别到详情页屏结构/i.test(failureText)
        );
}

function wantsExistingDetailPageTemplate(userIntent: string, params: Record<string, any>): boolean {
    if (params.useExistingDetailPageTemplate === true || params.forceDetailPageTemplateFirst === true) {
        return true;
    }
    const text = String(userIntent || params.userIntent || '').replace(/\s+/g, ' ').trim();
    if (!text) return false;
    if (/(不要|不走|别用|不是|没有|无).{0,12}(模板|套版|填充)/u.test(text)) {
        return false;
    }
    return /(现有|已有|当前).{0,12}(详情页|详情长图).{0,12}(模板|文档|psd|psb)|(?:基于|使用|套用|填充).{0,12}(现有|已有|当前)?.{0,12}(详情页)?(?:模板|PSD|PSB)|详情页.{0,12}(模板填充|模板解析|套模板|套版)/iu.test(text);
}

function shouldRunFreshDetailPageAutonomousFirst(
    step: EcommerceSocksDispatchOrchestrationChildStep,
    childParams: SkillExecuteParams,
    executeParams: SkillExecuteParams,
    userIntent: string
): boolean {
    if (step.skillId !== 'detail-page-design') return false;
    if (!executeParams.runSkill) return false;
    const params = (childParams.params || {}) as Record<string, any>;
    if (params.freshDetailPageExecutionMode === 'template-first') return false;
    if (wantsExistingDetailPageTemplate(userIntent, params)) return false;
    if (params.preferFreshDetailPageAutonomy === true || params.freshDetailPageExecutionMode === 'autonomous-first') {
        return true;
    }

    const text = String(userIntent || params.userIntent || '').replace(/\s+/g, ' ').trim();
    if (!text) return false;
    const asksFreshDetail = /(从零|从头|新建|创建|建立|重新做|自主跑完|完整完成|全部完成|整套|全套|都要做|详情页文档按名称|详情页就是详情页)/iu.test(text);
    const mentionsDetail = /详情页|详情长图|detail\s*page/i.test(text);
    return asksFreshDetail && mentionsDetail;
}

async function runFreshDetailPageAutonomousChild(
    step: EcommerceSocksDispatchOrchestrationChildStep,
    childParams: SkillExecuteParams,
    executeParams: SkillExecuteParams,
    userIntent: string,
    projectPath?: string,
    reason = 'fresh_detail_page_autonomous_first'
): Promise<EcommerceSocksChildDispatchRunResult> {
    executeParams.callbacks?.onStep?.({
        kind: 'observation',
        title: '详情页使用从零设计循环',
        detail: '本次详情页是新交付设计，不先跑模板解析；交给设计循环创建详情页文档、生成阶段草稿并观察画面。',
        status: 'running',
        toolName: 'autonomous-agent',
        toolCallId: `ecommerce-socks-child-detail-page-${reason}`,
        percent: step.progressRange.start + 1
    });

    try {
        const fallbackResult = await executeParams.runSkill!(
            'autonomous-agent',
            buildFreshDetailPageFallbackParams(childParams, userIntent, projectPath)
        );
        return summarizeChildResult(step, fallbackResult);
    } catch (fallbackError) {
        return buildFailedChildResultFromError(step, fallbackError);
    }
}

function buildFreshDetailPageFallbackParams(
    childParams: SkillExecuteParams,
    userIntent: string,
    projectPath?: string
): SkillExecuteParams {
    const inheritedContext = childParams.context as any;
    const inheritedPluginConnected = inheritedContext?.isPluginConnected;
    const userTask = [
        '请基于当前项目素材从零创建一个电商详情页文档。',
        '目标文档名称使用「详情页」，宽度按当前详情页尺寸规范，内容和卖点由你读取项目素材后判断。',
        '当前没有可用的详情页模板文档，不要走模板解析或模板填充；请用新建文档、阶段草稿、真实画面观察和调整来推进。',
        `原始用户目标：${userIntent}`
    ].join('\n');

    return {
        ...childParams,
        params: {
            ...childParams.params,
            userTask,
            userInput: userTask,
            task: userTask,
            skillId: 'detail-page-design',
            intentMode: 'fresh-detail-page-design',
            parentSkillId: 'ecommerce-socks-design',
            parentDeliverable: 'detail-page',
            projectPath,
            requiresDesignerAgentDecision: true,
            agentIntentControlPlane: {
                version: 'agent-intent-control-plane/v0',
                requestKind: 'autonomous_execution',
                toolScope: 'write_photoshop',
                shouldUseConversationalPath: false,
                allowsDeterministicRoute: true,
                allowsRouterModel: true,
                allowsAutonomousExecution: true,
                requiresClarificationBeforeTools: false,
                executionAuthorization: 'confirmed_tool_required',
                matchedSignals: ['explicit_creative_design'],
                userVisibleSummary: '这是从零创作详情页请求，需要先整理设计方向，再创建详情页文档并观察画面。',
                reason: '父级电商袜子设计检测到没有可用详情页文档，改走从零详情页设计。'
            }
        },
        context: {
            ...inheritedContext,
            conversationHistory: inheritedContext?.conversationHistory || [],
            isPluginConnected: inheritedPluginConnected === false ? false : true,
            userInput: userTask
        }
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
        const childParams: SkillExecuteParams = {
            ...executeParams,
            params: resolveChildSkillParams(step, executeParams, userIntent, projectPath)
        };
        try {
            if (shouldRunFreshDetailPageAutonomousFirst(step, childParams, executeParams, userIntent)) {
                childResult = await runFreshDetailPageAutonomousChild(
                    step,
                    childParams,
                    executeParams,
                    userIntent,
                    projectPath
                );
            } else {
                const overrideExecutor = resolveChildExecutorOverride(step, executeParams);
                const result = childExecutionPath === 'test_override' && overrideExecutor
                    ? await overrideExecutor.execute(childParams)
                    : executeParams.runSkill
                        ? await executeParams.runSkill(step.skillId, childParams)
                        : await runChildSkillViaRegistry(step.skillId, childParams);
                childResult = summarizeChildResult(step, result);
            }
        } catch (error) {
            childResult = buildFailedChildResultFromError(step, error);
        }

        if (shouldRunFreshDetailPageFallback(step, childResult, childParams, executeParams)) {
            childResult = await runFreshDetailPageAutonomousChild(
                step,
                childParams,
                executeParams,
                userIntent,
                projectPath,
                'template-fallback'
            );
        }

        results.push(childResult);

        executeParams.callbacks?.onStep?.({
            kind: 'tool_completed',
            title: `${childResult.success ? '子能力完成' : '子能力失败'}：${step.label}`,
            detail: childResult.message || childResult.error || `子能力 ${step.skillId} 已返回。`,
            status: childResult.success ? 'success' : 'error',
            toolName: step.skillId,
            toolCallId: `ecommerce-socks-child-${step.skillId}`,
            percent: step.progressRange.end,
            issue: childResult.success ? undefined : childResult.error || 'child_skill_failed'
        });

    }

    return results;
}

function formatChildRunSummary(childDispatchRun: EcommerceSocksChildDispatchRun): string {
    const childRuns = Array.isArray(childDispatchRun?.childRuns) ? childDispatchRun.childRuns : [];
    if (childRuns.length === 0) return '';
    return childRuns.map((item: any) => {
        const label = String(item?.label || item?.deliverable || item?.skillId || '子任务');
        const state = String(item?.state || 'unknown');
        const detail = String(item?.message || item?.error || '').trim();
        const readableState = state === 'completed'
            ? '已完成'
            : state === 'failed'
                ? '未完成'
                : state === 'needs_review'
                    ? '需要复核'
                    : state === 'not_run_missing_result'
                        ? '缺少结果'
                        : state;
        return detail ? `${label}：${readableState}（${detail}）` : `${label}：${readableState}`;
    }).join('；');
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
        const projectContextForStrategy = executeParams.context?.projectContext as Record<string, unknown> | undefined;
        const childStrategyHandoff = buildEcommerceSocksChildStrategyHandoff({
            packetSet: childStrategyPacketSet,
            reviewGate: childStrategyReviewGate,
            userIntent,
            projectPath,
            memoryStrategy: executeParams.params.businessSkillMemoryStrategy
                || executeParams.params.memoryStrategy
                || projectContextForStrategy?.businessSkillMemoryStrategy,
            placementIntelligenceBySkill: executeParams.params.designPlacementIntelligenceBySkill
                || executeParams.params.placementIntelligenceBySkill
                || projectContextForStrategy?.designPlacementIntelligenceBySkill
        });
        const entryState = buildEcommerceSocksDesignState({
            userIntent,
            projectPath,
            deliverables,
            strategyCheckpoint,
            childStrategyPacketSet,
            childStrategyReviewGate,
            childStrategyHandoff
        });
        // 父 Skill 被调用本身就意味着用户已经要求开始，不再额外问一次「要不要执行」。
        //
        // 曾在这里加过一张「确认开始执行设计任务」卡，结果是问了一个用户已经回答过的问题：
        // 用户说的就是「帮我开始规划设计主图详情页SKU」。Anthropic 的 agent 指引里，
        // 回头找人是为了 further information or judgement、或遇到 blocker，而不是要许可。
        // 三条理由支持直接执行：① 用户已表达执行意图；② 父级只做编排与汇总，
        // parentNoPhotoshopWrites 恒为 true，本身不改画面；③ 真正需要用户拍板的是
        // 子任务里的具体决策（如 SKU 组合规格），那一层本来就有自己的确认卡。
        //
        // 仍然保留两个否决口：用户显式拒绝（userDeniedChildDispatch）一律不下发；
        // 旧的确认卡提交也继续认，避免历史挂起操作回来时找不到授权来源。
        const dispatchConfirmedByCard = readDispatchConfirmationFromCard(executeParams.params);
        const userRequestedStop = resolveBoolean(
            executeParams.params.userDeniedChildDispatch || executeParams.params.denyChildDispatch
        );
        const dispatchAuthorizedByRequest = !userRequestedStop;
        const dispatchDecision = buildEcommerceSocksDispatchDecision({
            childSkills: entryState.childSkills,
            executeChildren: resolveBoolean(executeParams.params.executeChildren)
                || dispatchConfirmedByCard
                || dispatchAuthorizedByRequest,
            confirmChildDispatch: resolveBoolean(executeParams.params.confirmChildDispatch)
                || dispatchConfirmedByCard
                || dispatchAuthorizedByRequest,
            // 就绪开关现在默认 true（见 resolveChildDispatchEnabled）；显式传 false 仍可关闭。
            childDispatchImplementationReady: resolveChildDispatchEnabled(executeParams)
        });
        const dispatchLifecycle = buildEcommerceSocksDispatchLifecycle({
            userIntent,
            childSkills: entryState.childSkills,
            dispatchDecision
        });
        const dispatchOrchestration = buildEcommerceSocksDispatchOrchestrationPlan({
            childSkills: entryState.childSkills,
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
        const childRunInteractiveCards = resolveInteractiveCardsFromChildRunResults(childRunResults);
        const childReportAggregation = buildEcommerceSocksChildReportAggregation({
            dispatchOrchestration,
            childReports: [
                ...resolveChildReports(executeParams.params.childReports),
                ...toChildDispatchReports(childRunResults)
            ]
        });
        const executedChildDispatch = childDispatchRun.canCallChildExecutors;
        // 不再产「要不要开始执行」卡：用户提出需求即授权，再问一次等于问他已经回答过的问题。
        // 需要用户拍板的具体信息（SKU 组合规格等）由对应子任务在自己那一步问，问得更准。
        // 这里只透传子任务自己签发的卡片。
        const interactiveCards = childRunInteractiveCards;
        const finalState = buildEcommerceSocksDesignState({
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
            childStrategyReviewGate,
            childStrategyHandoff
        });
        const labels = entryState.childSkills.map((item) => item.label);
        const realDispatchFailed = executedChildDispatch
            && (childDispatchRun.status === 'failed' || childDispatchRun.status === 'blocked');
        const resultSuccess = !realDispatchFailed;
        const childRunSummary = executedChildDispatch ? formatChildRunSummary(childDispatchRun) : '';
        const completionDetail = executedChildDispatch
            ? `父 Skill 已完成子调度汇总；childDispatchRun=${childDispatchRun.status}${childRunSummary ? `；${childRunSummary}` : ''}，父级不声明设计质量完成。`
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
                    ? `子任务执行结果：${childRunSummary || childDispatchRun.status}。父级只汇总子报告，不声明整套设计质量完成。`
                    // 没下发时必须说清为什么。此前只说「没有下发」不说原因，用户无从判断是缺条件
                    // 还是系统断链，排查时也只能靠猜（真机 2026-07-31 为此耗掉数轮）。
                    : `本轮只完成了编排规划，没有下发子任务，也没有改动画面。未下发原因：${
                        [
                            !dispatchAuthorization.canExecuteChildren ? '本轮没有取得下发子任务的授权' : '',
                            childDispatchRun.status === 'blocked' ? '子任务调度被中止' : '',
                            !childExecutionPath ? '没有可用的子任务执行通道' : ''
                        ].filter(Boolean).join('；') || '暂时没有可执行的子任务'
                    }。`
            ].join('\n'),
            error: realDispatchFailed ? `Child dispatch ${childDispatchRun.status}` : undefined,
            data: {
                ecommerceSocksDesign: finalState,
                ecommerceSocksDispatchDecision: dispatchDecision,
                ecommerceSocksDispatchLifecycle: dispatchLifecycle,
                ecommerceSocksDispatchOrchestration: dispatchOrchestration,
                ecommerceSocksDispatchAuthorization: dispatchAuthorization,
                ecommerceSocksChildDispatchRun: childDispatchRun,
                ecommerceSocksChildReportAggregation: childReportAggregation,
                ecommerceSocksStrategyCheckpoint: strategyCheckpoint,
                ecommerceSocksChildStrategyPacketSet: childStrategyPacketSet,
                ecommerceSocksChildStrategyReviewGate: childStrategyReviewGate,
                ecommerceSocksChildStrategyHandoff: childStrategyHandoff,
                // 子任务自己签发的卡片原样透传；父级不再产卡，因此也不置 requiresUserAction——
                // 该标记会让 Runtime 把本轮判为 awaiting_confirmation 并停下等人。
                ...(interactiveCards.length > 0 ? { interactiveCards } : {})
            }
        };
    }
};
