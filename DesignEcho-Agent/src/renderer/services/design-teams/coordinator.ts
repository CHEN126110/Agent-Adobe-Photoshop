import { selectTools } from '../agent-runtime/tool-schemas';
import type {
    AgentConfig,
    AgentCallbacks,
    CallModelFn,
    ExecuteToolFn
} from '../agent-runtime/types';
import {
    readAgentVisualObservationReceipt,
    readAgentVisualObservations,
    resolveAgentVisualDeliveryReviewStatus
} from '../agent-runtime/visual-observation-strategy';
import {
    readTrustedVisualReviewArtifact,
    transferTrustedVisualReviewArtifact,
    writeTrustedVisualReviewArtifact,
    type TrustedVisualReviewArtifact
} from '../agent-runtime/trusted-visual-review-artifact';
import { getDesignTeammateDefinition } from './registry';
import { DesignTeammateTask } from './task';
import { DesignTeamWorkspace } from './workspace';
import {
    syncPipelineRetrospectiveToDesignState,
    syncTeammateOutputToDesignState
} from './state-sync';
import type {
    DesignCriticIssueOwner,
    DesignCriticVerdict,
    DesignTeamChildExecutionAllowance,
    DesignTeammateRole,
    DesignTeammateTaskRequest,
    DesignTeammateTaskResult,
    DesignTeamPipelineChildAgentUsage,
    DesignTeamPipelineResult,
    DesignTeamPipelineStageRecord
} from '../../../shared/types/design-team.types';
import {
    evaluateDeterministicAssertions,
    scoreDesignAssertions,
    type DesignScorecard
} from '../../../shared/design-quality-assertion';
import { extractDesignQualityMeasurements } from '../../../shared/design-quality-measurement';
import { extractFreshDesignSurfaceSnapshotFromToolResults } from '../../../shared/design-surface-snapshot-normalizer';
import { classifyAgentToolExecution } from '../../../shared/agent-tool-execution-preflight';
import { resolveModelContextWindow } from '../../../shared/config/models.config';
import {
    buildDesignTeamRuntimeBudget,
    getDesignTeamRoleExecutionMinimum,
    resolveDesignTeamRequiredBaseRoles,
    sumDesignTeamRoleExecutionRequirements
} from '../../../shared/agent-performance-policy';
import {
    buildMultimodalModelDispatchPlan,
    formatModelDispatchTrace,
    type MultimodalModelDispatchPlan
} from '../../../shared/multimodal-model-dispatch';
import { useAppStore } from '../../stores/app.store';
import type { VisualObservationReceipt } from '../../../shared/visual-observation-bundle';

export function findLatestRuntimeVisualReviewEvidence(
    entries: Array<{ name: string; result: any }>
): VisualObservationReceipt | undefined {
    let lastSuccessfulMutationIndex = -1;
    for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        if (entry?.result?.success === false) continue;
        if (classifyAgentToolExecution(String(entry?.name || '')) === 'photoshop_write') {
            lastSuccessfulMutationIndex = index;
        }
    }
    for (let index = entries.length - 1; index > lastSuccessfulMutationIndex; index -= 1) {
        const entry = entries[index];
        const receipt = readAgentVisualObservationReceipt(entry?.result);
        if (!receipt) continue;
        const reviewStatus = resolveAgentVisualDeliveryReviewStatus(
            entry.result,
            String(entry.name || '')
        );
        if (reviewStatus === 'passed' || reviewStatus === 'needs_fix') return receipt;
        // 单画布工具没有 Workflow deliveryCandidate；仍要求 Runtime 真正签发的 receipt、
        // 当前 owner 的逐图 reviewed 决定和完全一致的 sourceTool，不能只凭字段形状通过。
        const observations = readAgentVisualObservations(entry.result);
        if (receipt.sourceTool === String(entry.name || '')
            && observations.length === 1
            && observations[0].reviewed === true
            && observations[0].reviewDecision?.observationKey
                === observations[0].observationKey) {
            return receipt;
        }
    }
    return undefined;
}

export interface DesignTeamCoordinatorOptions {
    callModel: CallModelFn;
    executeTool: ExecuteToolFn;
    resolveDefaultModelId: () => string;
}

export interface RunTeammateTaskOptions {
    /** 共享工作区：注入前序成果摘要，并把本次产出沉淀回去 */
    workspace?: DesignTeamWorkspace;
    /** 工作区沉淀时的阶段标签（默认用角色名） */
    stage?: string;
    /** 项目路径：提供时队友产出按映射写穿到 Design Project State */
    projectPath?: string;
    /**
     * 流水线级工具结果收集器：追加本次队友运行 agent.run 已产出的 toolCallLog（{name,result}），
     * 供 critic 阶段复用现成的 extractFreshDesignSurfaceSnapshotFromToolResults → 客观测量信号 / 确定性事实
     * 管道（复用既有采集，不新建平行采集管道；顺序即时间序，测量新鲜度门禁依赖此约定）。
     */
    toolResultsSink?: Array<{ name: string; result: any }>;
    /** coordinator 从父 Agent 签发的 allowance 中、在阶段启动前一次性提交的局部预算。 */
    stagePerformanceBudget?: NonNullable<AgentConfig['performanceBudget']>;
    /** 阶段局部迭代上限；与 performanceBudget.maxModelCalls 一起约束子 Agent。 */
    stageMaxIterations?: number;
}

export interface RunPipelineRequest {
    goal: string;
    context?: string;
    /**
     * 上游团队协作契约已选择的专业角色。基础分析/策略/执行/评审始终保留；
     * 市场与文案阶段只有被现有 rolePlan 选中时才加入，避免所有设计任务固定跑完整营销链。
     */
    plannedRoles?: DesignTeammateRole[];
    /** 评审不通过时允许的修订轮数，默认 1 */
    maxRevisions?: number;
    /** 项目路径：提供时各阶段产出写穿到 Design Project State */
    projectPath?: string;
    /** 父 Agent 在完整流水线启动前签发；coordinator 不读取或拥有父级总账本。 */
    childAllowance: DesignTeamChildExecutionAllowance;
}

interface ReservedPipelineStageBudget {
    maxIterations: number;
    performanceBudget: NonNullable<AgentConfig['performanceBudget']>;
}

interface PipelineBudgetBlock {
    code: 'design_team_child_allowance_exhausted' | 'design_team_child_deadline_exceeded';
    reason: string;
}

export function resolveDesignTeamStageVisualBudget(input: {
    role: DesignTeammateRole;
    availableVisualAnalyses: number;
    availableVisionCandidates: number;
    preserveForLaterCritic: number;
}): { visualAnalyses: number; visionCandidates: number } {
    const availableVisualAnalyses = Math.max(0, Math.floor(input.availableVisualAnalyses));
    const availableVisionCandidates = Math.max(0, Math.floor(input.availableVisionCandidates));
    const preserveForLaterCritic = Math.max(0, Math.floor(input.preserveForLaterCritic));
    if (input.role === 'critic') {
        return {
            visualAnalyses: availableVisualAnalyses,
            visionCandidates: availableVisionCandidates
        };
    }
    if (input.role !== 'scene-analyst'
        || availableVisualAnalyses <= preserveForLaterCritic
        || availableVisionCandidates <= preserveForLaterCritic) {
        return { visualAnalyses: 0, visionCandidates: 0 };
    }
    return { visualAnalyses: 1, visionCandidates: 1 };
}

type PipelineStageOutcome =
    | { status: 'completed'; result: DesignTeammateTaskResult }
    | { status: 'cancelled' }
    | { status: 'budget_blocked'; block: PipelineBudgetBlock };

// 裁决解析/评分卡并轨迁移至 shared/design-team-verdict.ts（纯逻辑，可被 smoke 直接测试），此处 re-export 兼容
import {
    mergeDeterministicScorecardIntoCriticVerdict,
    parseCriticVerdict
} from '../../../shared/design-team-verdict';
export { parseCriticVerdict };

function formatCriticIssues(verdict: DesignCriticVerdict): string {
    const issueList = verdict.issues
        .map((issue, idx) => {
            const owner = issue.owner ? `归属：${issue.owner}；` : '';
            return `${idx + 1}. ${owner}[${issue.target}] 问题：${issue.problem}${issue.suggestion ? `；建议：${issue.suggestion}` : ''}`;
        })
        .join('\n');
    return issueList || verdict.reviewText;
}

function pickPrimaryIssueOwner(verdict: DesignCriticVerdict): DesignCriticIssueOwner | undefined {
    return verdict.issues.find((issue) => Boolean(issue.owner))?.owner;
}

function buildRevisionRoute(owner: DesignCriticIssueOwner | undefined): DesignTeammateRole[] {
    switch (owner) {
        case 'copy':
            return ['copywriter', 'executor'];
        case 'insight':
            return ['market-researcher', 'design-strategist', 'executor'];
        case 'asset':
            return ['scene-analyst', 'design-strategist', 'executor'];
        case 'requirement':
            return ['design-strategist', 'executor'];
        case 'visual':
        case 'layout':
        case 'execution':
        default:
            return ['executor'];
    }
}

function buildRevisionTask(role: DesignTeammateRole, goal: string, issueText: string): string {
    switch (role) {
        case 'market-researcher':
            return `评审认为市场/用户洞察不足。围绕目标「${goal}」补充痛点、竞品表达和可用于设计的洞察，不要改 Photoshop。\n待处理问题：\n${issueText}`;
        case 'copywriter':
            return `评审认为文案或卖点表达需要返工。围绕目标「${goal}」重出可上图文案和卖点层级，不要改 Photoshop。\n待处理问题：\n${issueText}`;
        case 'scene-analyst':
            return `评审认为素材、画面或图层理解不足。重新检查当前 Photoshop 画面，补充可执行的场景/素材判断，不要改 Photoshop。\n待处理问题：\n${issueText}`;
        case 'design-strategist':
            return `基于最新团队成果和评审问题，修订目标「${goal}」的设计计划，明确 executor 下一步该改什么，不要改 Photoshop。\n待处理问题：\n${issueText}`;
        case 'executor':
        default:
            return `按最新团队成果和评审问题执行 Photoshop 修订，逐项落实并报告结果。\n待处理问题：\n${issueText}`;
    }
}

function summarizeChildAgentUsage(
    stages: DesignTeamPipelineStageRecord[]
): DesignTeamPipelineChildAgentUsage {
    return stages.reduce<DesignTeamPipelineChildAgentUsage>((usage, stage) => ({
        calls: usage.calls + 1,
        iterations: usage.iterations + stage.iterations,
        toolCalls: usage.toolCalls + stage.toolsUsed.length
    }), {
        calls: 0,
        iterations: 0,
        toolCalls: 0
    });
}

export class DesignTeamCoordinator {
    private readonly callModel: CallModelFn;
    private readonly executeTool: ExecuteToolFn;
    private readonly resolveDefaultModelId: () => string;

    constructor(options: DesignTeamCoordinatorOptions) {
        this.callModel = options.callModel;
        this.executeTool = options.executeTool;
        this.resolveDefaultModelId = options.resolveDefaultModelId;
    }

    /** 角色只隔离职责和上下文，基础模型始终复用用户选择的同一个 Agent 模型。 */
    private buildDispatchPlanForRole(role: DesignTeammateRole): MultimodalModelDispatchPlan {
        try {
            const prefs = (useAppStore.getState() as any).modelPreferences;
            return buildMultimodalModelDispatchPlan({
                consumer: 'teammate',
                role,
                prefs,
                mode: prefs?.mode,
                includeFallback: false,
                includeCrossTaskBackups: false,
                requireToolUse: true,
            });
        } catch {
            const fallbackModelId = this.resolveDefaultModelId();
            return buildMultimodalModelDispatchPlan({
                consumer: 'teammate',
                role,
                explicitModelId: fallbackModelId,
                availableModels: fallbackModelId ? [fallbackModelId] : [],
                requireToolUse: true
            });
        }
    }

    async runTeammateTask(
        request: DesignTeammateTaskRequest,
        callbacks?: AgentCallbacks,
        signal?: AbortSignal,
        options?: RunTeammateTaskOptions
    ): Promise<DesignTeammateTaskResult> {
        const definition = getDesignTeammateDefinition(request.role);
        const tools = selectTools(definition.allowedTools);
        const exposedToolNames = new Set(tools.map((tool) => tool.name));
        const missingAllowedTools = definition.allowedTools.filter((toolName) => !exposedToolNames.has(toolName));
        if (process.env.NODE_ENV === 'development' && missingAllowedTools.length > 0) {
            const detail = `角色 ${request.role} 的 allowedTools 缺少工具 schema：${missingAllowedTools.join(', ')}`;
            console.error(`[DesignTeamCoordinator] ${detail}`);
            callbacks?.onStep?.({
                kind: 'warning',
                title: 'Design Team 工具配置缺口',
                detail,
                status: 'error',
                source: 'system',
                audience: 'debug'
            });
        }
        const allowedToolNames = new Set(definition.allowedTools);
        const scopedExecuteTool: ExecuteToolFn = async (toolName, params, runtimeContext) => {
            if (!allowedToolNames.has(toolName)) {
                return {
                    success: false,
                    code: 'design_teammate_tool_not_allowed',
                    error: `角色 ${request.role} 无权调用工具 ${toolName}。`,
                    role: request.role,
                    toolName
                };
            }
            return this.executeTool(toolName, params, runtimeContext);
        };
        const dispatchPlan = this.buildDispatchPlanForRole(request.role);
        const modelId = dispatchPlan.selectedModelId;
        if (!modelId) {
            throw new Error('当前 Agent 模型没有经过读图能力验证，Design Team 未启动，也没有改用其他模型。');
        }
        const taskId = this.createTaskId(request.role);
        const task = new DesignTeammateTask(taskId, request);
        const runtimeBudget = buildDesignTeamRuntimeBudget({
            role: request.role,
            requestedMaxIterations: request.maxIterations
        });
        const stageMaxIterations = Math.max(
            1,
            Math.min(
                runtimeBudget.maxIterations,
                Number.isFinite(Number(options?.stageMaxIterations))
                    ? Math.floor(Number(options?.stageMaxIterations))
                    : runtimeBudget.maxIterations
            )
        );

        options?.workspace?.record({
            role: request.role,
            outputType: 'model_dispatch_trace',
            stage: options?.stage || request.role,
            success: true,
            content: formatModelDispatchTrace(dispatchPlan),
            toolsUsed: []
        });

        const promptSections = [
            definition.systemPrompt,
            `Model dispatch context:\n${formatModelDispatchTrace(dispatchPlan)}`
        ];
        const workspaceDigest = options?.workspace?.buildContextDigest({ excludeRole: request.role }) || '';
        if (workspaceDigest) promptSections.push(workspaceDigest);
        if (request.context) promptSections.push(`Coordinator context:\n${request.context}`);
        const systemPrompt = promptSections.join('\n\n');
        const modelContextWindow = resolveModelContextWindow(modelId)?.tokens;

        const { Agent } = await import('../agent-runtime/agent');
        const agent = new Agent(
            {
                systemPrompt,
                tools,
                modelId,
                ...(modelContextWindow ? { contextWindowTokens: modelContextWindow } : {}),
                maxIterations: stageMaxIterations,
                ...(options?.stagePerformanceBudget
                    ? { performanceBudget: options.stagePerformanceBudget }
                    : {}),
                // Design Team 的角色与阶段已经是结构化视觉任务 owner；显式保留原有开场画布观察。
                // Agent 默认值是 none，不能依赖隐式默认把所有未来调用方绑到 Photoshop。
                openingCanvasObservationMode: 'canvas_visual',
                requireInitialToolCall: false,
                callbacks: callbacks || {},
                signal
            },
            this.callModel,
            scopedExecuteTool
        );

        task.markRunning();
        const result = await agent.run(request.task);

        // 把本次运行的工具结果沉进流水线级收集器（若调用方提供）：复用 agent.run 已产出的
        // toolCallLog，供确定性测量取"最近一次成功结果"，不是新采集管道。
        if (options?.toolResultsSink) {
            for (const entry of result.toolCallLog) {
                options.toolResultsSink.push({ name: entry.name, result: entry.result });
            }
        }

        const finalized = task.finalize({
            success: result.success,
            message: result.message,
            iterations: result.iterations,
            toolsUsed: result.toolCallLog.map((item) => item.name),
            error: result.error,
            cancelled: result.cancelled,
            budgetExhausted: result.stopReason === 'performance_budget'
        });
        const visualReviewArtifact = request.role === 'critic'
            ? readTrustedVisualReviewArtifact(result)
            : undefined;
        const visualReviewEvidence = visualReviewArtifact?.fullyReviewed === true
            ? visualReviewArtifact.receipt
            : undefined;
        const finalizedWithEvidence: DesignTeammateTaskResult = {
            ...finalized,
            ...(visualReviewEvidence ? { visualReviewEvidence } : {})
        };
        if (visualReviewArtifact) {
            transferTrustedVisualReviewArtifact(result, finalizedWithEvidence);
        }

        options?.workspace?.record({
            role: request.role,
            outputType: definition.outputType,
            stage: options?.stage || request.role,
            success: finalizedWithEvidence.success,
            content: finalizedWithEvidence.message,
            toolsUsed: finalizedWithEvidence.toolsUsed
        });

        // 写穿到共享项目状态（失败不阻断）
        await syncTeammateOutputToDesignState(options?.projectPath, {
            role: request.role,
            outputType: definition.outputType,
            stage: options?.stage || request.role,
            success: finalizedWithEvidence.success,
            content: finalizedWithEvidence.message
        });

        return finalizedWithEvidence;
    }

    /**
     * 标准设计团队流水线：场景分析 → 设计策略 → 执行 → 评审 →（不通过则修订并复审）。
     * 各阶段通过共享工作区传递成果；评审裁决驱动修订循环。
     */
    async runPipeline(
        request: RunPipelineRequest,
        callbacks?: AgentCallbacks,
        signal?: AbortSignal
    ): Promise<DesignTeamPipelineResult> {
        const goal = String(request.goal || '').trim();
        if (!goal) {
            return {
                success: false,
                qualityPassed: false,
                childAgentUsage: summarizeChildAgentUsage([]),
                message: '流水线缺少目标描述（goal）。',
                goal: '',
                stages: [],
                revisionRounds: 0,
                error: 'Missing pipeline goal'
            };
        }

        const maxRevisions = Math.max(0, Math.min(2, Number(request.maxRevisions ?? 1)));
        const plannedRoles = new Set(
            Array.isArray(request.plannedRoles) ? request.plannedRoles : []
        );
        const includeMarketResearch = plannedRoles.has('market-researcher');
        const includeCopywriting = plannedRoles.has('copywriter');
        const childAllowance = request.childAllowance;
        const childDeadlineAtMs = Number(childAllowance?.deadlineAtMs);
        const normalizeAllowanceCount = (value: unknown): number => {
            const parsed = Number(value);
            if (!Number.isFinite(parsed) || parsed < 0) return 0;
            return Math.floor(parsed);
        };
        const requiredBaseRoles = resolveDesignTeamRequiredBaseRoles(request.plannedRoles);
        const requiredBaseExecution = sumDesignTeamRoleExecutionRequirements(requiredBaseRoles);
        const requiredBaseStageCount = requiredBaseExecution.agentCalls;
        if (!childAllowance
            || !Number.isFinite(childDeadlineAtMs)
            || childDeadlineAtMs <= Date.now()) {
            return {
                success: false,
                qualityPassed: false,
                childAgentUsage: summarizeChildAgentUsage([]),
                budgetExhausted: true,
                message: 'Design Team 的子执行额度缺失或已经超过绝对截止时间；流水线未启动。',
                goal,
                stages: [],
                revisionRounds: 0,
                error: 'design_team_child_deadline_exceeded'
            };
        }
        const remainingChildBudget = {
            agentCalls: normalizeAllowanceCount(childAllowance.maxAgentCalls),
            modelCalls: normalizeAllowanceCount(childAllowance.maxModelCalls),
            toolCalls: normalizeAllowanceCount(childAllowance.maxToolCalls),
            visualAnalyses: normalizeAllowanceCount(childAllowance.maxVisualAnalyses),
            visionCandidates: normalizeAllowanceCount(childAllowance.maxVisionCandidates)
        };
        if (remainingChildBudget.agentCalls < requiredBaseStageCount
            || remainingChildBudget.modelCalls < requiredBaseExecution.modelCalls
            || remainingChildBudget.toolCalls < requiredBaseExecution.toolCalls) {
            return {
                success: false,
                qualityPassed: false,
                childAgentUsage: summarizeChildAgentUsage([]),
                budgetExhausted: true,
                message: `Design Team 的子执行额度不足以完整启动 ${requiredBaseStageCount} 个必需阶段（至少 ${requiredBaseExecution.modelCalls} 次模型调用、${requiredBaseExecution.toolCalls} 次工具调用）；流水线未启动。`,
                goal,
                stages: [],
                revisionRounds: 0,
                error: 'design_team_child_allowance_exhausted'
            };
        }
        const workspace = new DesignTeamWorkspace();
        const stages: DesignTeamPipelineStageRecord[] = [];
        const revisionNotes: string[] = [];
        // 各阶段队友 agent.run 的工具结果累计（{name,result}），供 critic 阶段做确定性评分卡测量。
        const pipelineToolResults: Array<{ name: string; result: any }> = [];
        let revisionRounds = 0;
        let nextMandatoryRoleIndex = 0;

        const emitStage = (
            stage: string,
            role: DesignTeammateRole,
            phase: 'start' | 'done',
            detail?: string,
            succeeded = true
        ) => {
            let status: 'running' | 'success' | 'error';
            if (phase === 'start') {
                status = 'running';
            } else if (succeeded) {
                status = 'success';
            } else {
                status = 'error';
            }
            callbacks?.onStep?.({
                kind: phase === 'start' ? 'tool_started' : 'tool_completed',
                title: phase === 'start' ? `团队阶段：${stage}` : `团队阶段完成：${stage}`,
                detail: detail || `角色：${role}`,
                status,
                toolName: `designTeamPipeline:${stage}`,
                toolCallId: `pipeline-${stage}`
            });
        };

        const blockStageByBudget = (
            code: PipelineBudgetBlock['code'],
            reason: string
        ): PipelineBudgetBlock => {
            return { code, reason };
        };

        const reserveStageGroupBudgets = (
            roles: readonly DesignTeammateRole[],
            requiredRolesAfter: readonly DesignTeammateRole[] = [],
            reservationKind: 'base' | 'revision' = 'revision'
        ): ReservedPipelineStageBudget[] | PipelineBudgetBlock => {
            const nowMs = Date.now();
            if (nowMs >= childDeadlineAtMs) {
                return blockStageByBudget(
                    'design_team_child_deadline_exceeded',
                    'Design Team 已到达父 Agent 事前签发的绝对截止时间；后续阶段未启动。'
                );
            }
            const completeRoute = [...roles, ...requiredRolesAfter];
            const completeRequirement = sumDesignTeamRoleExecutionRequirements(completeRoute);
            if (remainingChildBudget.agentCalls < completeRequirement.agentCalls
                || remainingChildBudget.modelCalls < completeRequirement.modelCalls
                || remainingChildBudget.toolCalls < completeRequirement.toolCalls) {
                let reason = '剩余子执行额度不足以原子预留完整修订路线与 critic 复审；任何修订阶段都未启动。';
                if (reservationKind === 'base') {
                    reason = `剩余子执行额度无法在启动当前阶段前，为后续 ${completeRequirement.agentCalls} 个必需阶段保留加权最小额度。`;
                }
                return blockStageByBudget(
                    'design_team_child_allowance_exhausted',
                    reason
                );
            }

            let availableVisualAnalyses = remainingChildBudget.visualAnalyses;
            let availableVisionCandidates = remainingChildBudget.visionCandidates;
            const reservations = roles.map((role, roleIndex): ReservedPipelineStageBudget => {
                const minimum = getDesignTeamRoleExecutionMinimum(role);
                const laterRoles = [
                    ...roles.slice(roleIndex + 1),
                    ...requiredRolesAfter
                ];
                const preserveForLaterCritic = role !== 'critic' && laterRoles.includes('critic')
                    ? 1
                    : 0;
                const stageVisualBudget = resolveDesignTeamStageVisualBudget({
                    role,
                    availableVisualAnalyses,
                    availableVisionCandidates,
                    preserveForLaterCritic
                });
                const stageVisualAnalyses = stageVisualBudget.visualAnalyses;
                const stageVisionCandidates = stageVisualBudget.visionCandidates;
                availableVisualAnalyses -= stageVisualAnalyses;
                availableVisionCandidates -= stageVisionCandidates;

                return {
                    maxIterations: minimum.modelCalls,
                    performanceBudget: {
                        maxModelCalls: minimum.modelCalls,
                        maxToolCalls: minimum.toolCalls,
                        maxVisionCandidates: stageVisionCandidates,
                        maxInitialVisionCandidates: 0,
                        maxVisualAnalyses: stageVisualAnalyses,
                        maxFullResolutionImageReads: 0,
                        softTimeBudgetMs: Math.max(1, childDeadlineAtMs - nowMs),
                        ...(childAllowance.maxPrimaryOutputTokens
                            ? { maxPrimaryOutputTokens: childAllowance.maxPrimaryOutputTokens }
                            : {}),
                        ...(typeof childAllowance.allowProviderThinking === 'boolean'
                            ? { allowProviderThinking: childAllowance.allowProviderThinking }
                            : {})
                    }
                };
            });
            const committedRequirement = sumDesignTeamRoleExecutionRequirements(roles);
            remainingChildBudget.agentCalls -= committedRequirement.agentCalls;
            remainingChildBudget.modelCalls -= committedRequirement.modelCalls;
            remainingChildBudget.toolCalls -= committedRequirement.toolCalls;
            remainingChildBudget.visualAnalyses = availableVisualAnalyses;
            remainingChildBudget.visionCandidates = availableVisionCandidates;
            return reservations;
        };

        const reserveStageBudget = (
            role: DesignTeammateRole,
            mandatory: boolean
        ): ReservedPipelineStageBudget | PipelineBudgetBlock => {
            let requiredRolesAfter: readonly DesignTeammateRole[] = [];
            if (mandatory) {
                requiredRolesAfter = requiredBaseRoles.slice(nextMandatoryRoleIndex + 1);
            }
            const reservations = reserveStageGroupBudgets([role], requiredRolesAfter, 'base');
            if (!Array.isArray(reservations)) return reservations;
            if (mandatory) nextMandatoryRoleIndex++;
            return reservations[0];
        };

        const runStage = async (
            stage: string,
            role: DesignTeammateRole,
            taskText: string,
            context?: string,
            mandatory = false,
            preReservedBudget?: ReservedPipelineStageBudget
        ): Promise<PipelineStageOutcome> => {
            if (signal?.aborted) return { status: 'cancelled' };
            let stageBudget: ReservedPipelineStageBudget | PipelineBudgetBlock;
            if (preReservedBudget) {
                if (Date.now() >= childDeadlineAtMs) {
                    stageBudget = blockStageByBudget(
                        'design_team_child_deadline_exceeded',
                        `团队阶段 ${stage} 在启动前已到达父 Agent 事前签发的绝对截止时间。`
                    );
                } else {
                    stageBudget = {
                        ...preReservedBudget,
                        performanceBudget: {
                            ...preReservedBudget.performanceBudget,
                            softTimeBudgetMs: Math.max(1, childDeadlineAtMs - Date.now())
                        }
                    };
                }
            } else {
                stageBudget = reserveStageBudget(role, mandatory);
            }
            if ('code' in stageBudget) {
                callbacks?.onStep?.({
                    kind: 'warning',
                    title: `团队阶段未启动：${stage}`,
                    detail: stageBudget.reason,
                    status: 'error',
                    toolName: `designTeamPipeline:${stage}`,
                    toolCallId: `pipeline-${stage}`,
                    source: 'system',
                    audience: 'debug'
                });
                return { status: 'budget_blocked', block: stageBudget };
            }

            emitStage(stage, role, 'start');
            const effectiveContext = [request.context, context]
                .map((value) => String(value || '').trim())
                .filter((value, index, values) => Boolean(value) && values.indexOf(value) === index)
                .join('\n\n');
            const stageAbortController = new AbortController();
            let deadlineTriggered = false;
            const abortFromParent = (): void => stageAbortController.abort();
            if (signal) {
                if (signal.aborted) {
                    stageAbortController.abort();
                } else {
                    signal.addEventListener('abort', abortFromParent, { once: true });
                }
            }
            const deadlineTimer = setTimeout(() => {
                deadlineTriggered = true;
                stageAbortController.abort();
            }, Math.max(1, childDeadlineAtMs - Date.now()));
            let result: DesignTeammateTaskResult;
            try {
                result = await this.runTeammateTask(
                    {
                        role,
                        task: taskText,
                        ...(effectiveContext ? { context: effectiveContext } : {})
                    },
                    callbacks,
                    stageAbortController.signal,
                    {
                        workspace,
                        stage,
                        projectPath: request.projectPath,
                        toolResultsSink: pipelineToolResults,
                        stageMaxIterations: stageBudget.maxIterations,
                        stagePerformanceBudget: stageBudget.performanceBudget
                    }
                );
            } finally {
                clearTimeout(deadlineTimer);
                signal?.removeEventListener('abort', abortFromParent);
            }
            stages.push({
                stage,
                role,
                success: result.success,
                message: result.message,
                iterations: result.iterations,
                toolsUsed: result.toolsUsed,
                ...(result.error ? { error: result.error } : {})
            });
            let stageDetail = `角色：${role}`;
            if (!result.success && result.status === 'cancelled') {
                stageDetail = `角色：${role}（已取消）`;
            } else if (!result.success) {
                stageDetail = `角色：${role}（失败：${result.error || '未知原因'}）`;
            }
            emitStage(
                stage,
                role,
                'done',
                stageDetail,
                result.success
            );
            if (signal?.aborted) return { status: 'cancelled' };
            if (deadlineTriggered || Date.now() >= childDeadlineAtMs) {
                return {
                    status: 'budget_blocked',
                    block: blockStageByBudget(
                        'design_team_child_deadline_exceeded',
                        `团队阶段 ${stage} 到达父 Agent 事前签发的绝对截止时间。`
                    )
                };
            }
            if (result.budgetExhausted) {
                return {
                    status: 'budget_blocked',
                    block: blockStageByBudget(
                        'design_team_child_allowance_exhausted',
                        `团队阶段 ${stage} 已用尽其事前切片额度，不能伪装成已完整执行。`
                    )
                };
            }
            if (result.status === 'cancelled') return { status: 'cancelled' };
            return { status: 'completed', result };
        };

        const cancelledResult = (): DesignTeamPipelineResult => ({
            success: false,
            qualityPassed: false,
            childAgentUsage: summarizeChildAgentUsage(stages),
            cancelled: true,
            message: '团队流水线已取消。',
            goal,
            stages,
            revisionRounds
        });

        const mandatoryBudgetResult = (
            block: PipelineBudgetBlock
        ): DesignTeamPipelineResult => ({
            success: false,
            qualityPassed: false,
            childAgentUsage: summarizeChildAgentUsage(stages),
            budgetExhausted: true,
            message: `团队流水线未能完整执行：${block.reason}`,
            goal,
            stages,
            revisionRounds,
            error: block.code
        });

        // 阶段 1：场景分析
        const analysisOutcome = await runStage('analyze', 'scene-analyst',
            `分析当前 Photoshop 画面，目标是：${goal}。总结文档结构、视觉层级、关键模块与风险点，为设计策略提供依据。`,
            undefined,
            true);
        if (analysisOutcome.status === 'cancelled') return cancelledResult();
        if (analysisOutcome.status === 'budget_blocked') {
            return mandatoryBudgetResult(analysisOutcome.block);
        }
        const analysis = analysisOutcome.result;
        if (!analysis.success) {
            return {
                success: false,
                qualityPassed: false,
                childAgentUsage: summarizeChildAgentUsage(stages),
                message: `场景分析阶段失败：${analysis.error || analysis.message}`,
                goal, stages, revisionRounds, error: analysis.error || 'analyze stage failed'
            };
        }

        // 市场/用户洞察不是所有设计任务的默认必经项，只在既有团队 rolePlan 选中时运行。
        if (includeMarketResearch) {
            const marketOutcome = await runStage('market', 'market-researcher',
                `围绕目标「${goal}」和当前项目画面，提炼目标用户、核心痛点、竞品常见表达和可用于设计的市场洞察。不要改 Photoshop。`,
                undefined,
                true);
            if (marketOutcome.status === 'cancelled') return cancelledResult();
            if (marketOutcome.status === 'budget_blocked') {
                return mandatoryBudgetResult(marketOutcome.block);
            }
            const market = marketOutcome.result;
            if (!market.success) {
                return {
                    success: false,
                    qualityPassed: false,
                    childAgentUsage: summarizeChildAgentUsage(stages),
                    message: `市场洞察阶段失败：${market.error || market.message}`,
                    goal, stages, revisionRounds, error: market.error || 'market stage failed'
                };
            }
        }

        // 文案只在交付确实需要营销文字时运行；纯视觉、无文字和结构修改不会被强塞文案阶段。
        if (includeCopywriting) {
            const copyOutcome = await runStage('copy', 'copywriter',
                `基于团队已有的场景分析和可用洞察，为目标「${goal}」产出任务所需的上图文案与信息层级。不要改 Photoshop，也不要补造 Brief 未要求的卖点。`,
                undefined,
                true);
            if (copyOutcome.status === 'cancelled') return cancelledResult();
            if (copyOutcome.status === 'budget_blocked') {
                return mandatoryBudgetResult(copyOutcome.block);
            }
            const copy = copyOutcome.result;
            if (!copy.success) {
                return {
                    success: false,
                    qualityPassed: false,
                    childAgentUsage: summarizeChildAgentUsage(stages),
                    message: `文案策略阶段失败：${copy.error || copy.message}`,
                    goal, stages, revisionRounds, error: copy.error || 'copy stage failed'
                };
            }
        }

        // 阶段 4：设计策略
        const planOutcome = await runStage('plan', 'design-strategist',
            `基于团队已有的场景分析，为目标「${goal}」制定具体可执行的设计计划：明确要改哪些图层/模块、文案与图片策略、执行顺序与验收要点。`,
            undefined,
            true);
        if (planOutcome.status === 'cancelled') return cancelledResult();
        if (planOutcome.status === 'budget_blocked') {
            return mandatoryBudgetResult(planOutcome.block);
        }
        const plan = planOutcome.result;
        if (!plan.success) {
            return {
                success: false,
                qualityPassed: false,
                childAgentUsage: summarizeChildAgentUsage(stages),
                message: `设计策略阶段失败：${plan.error || plan.message}`,
                goal, stages, revisionRounds, error: plan.error || 'plan stage failed'
            };
        }

        // 阶段 5：执行
        const executionOutcome = await runStage('execute', 'executor',
            `按团队已有的设计计划执行 Photoshop 修改。先检查现状再动手，逐项落实计划，完成后报告每项的实际结果。`,
            undefined,
            true);
        if (executionOutcome.status === 'cancelled') return cancelledResult();
        if (executionOutcome.status === 'budget_blocked') {
            return mandatoryBudgetResult(executionOutcome.block);
        }
        const execution = executionOutcome.result;
        if (!execution.success) {
            return {
                success: false,
                qualityPassed: false,
                childAgentUsage: summarizeChildAgentUsage(stages),
                message: `执行阶段失败：${execution.error || execution.message}`,
                goal, stages, revisionRounds, error: execution.error || 'execute stage failed'
            };
        }

        // 阶段 6：评审（+ 修订循环）
        let verdict: DesignCriticVerdict | undefined;
        let visualReviewEvidence: VisualObservationReceipt | undefined;
        let visualReviewArtifact: TrustedVisualReviewArtifact | undefined;
        let budgetExhaustedDuringRevision = false;
        let budgetExhaustedReason = '';
        let pendingRevisionReviewBudget: ReservedPipelineStageBudget | undefined;
        reviewLoop: for (let round = 0; round <= maxRevisions; round++) {
            const reviewStage = round === 0 ? 'review' : `review-${round}`;
            const preReservedReviewBudget = pendingRevisionReviewBudget;
            pendingRevisionReviewBudget = undefined;
            const reviewOutcome = await runStage(
                reviewStage,
                'critic',
                `评审当前执行结果是否达成目标「${goal}」。对照团队的设计计划与执行报告，检查布局、层级、文案适配与视觉一致性。`,
                undefined,
                round === 0,
                preReservedReviewBudget
            );
            if (reviewOutcome.status === 'cancelled') return cancelledResult();
            if (reviewOutcome.status === 'budget_blocked') {
                if (round === 0) return mandatoryBudgetResult(reviewOutcome.block);
                budgetExhaustedDuringRevision = true;
                budgetExhaustedReason = reviewOutcome.block.reason;
                break;
            }
            const review = reviewOutcome.result;
            if (!review.success) {
                return {
                    success: false,
                    qualityPassed: false,
                    childAgentUsage: summarizeChildAgentUsage(stages),
                    message: `评审阶段失败：${review.error || review.message}`,
                    goal,
                    stages,
                    revisionRounds,
                    error: review.error || 'review stage failed'
                };
            }

            // 质量信用只能来自“当前这一轮 Critic 自己看过”的写后画面。流水线中 executor
            // 或其他角色取得的 Runtime 回执可以作为过程证据，但不能代替最终 Critic 观察。
            visualReviewArtifact = readTrustedVisualReviewArtifact(review);
            visualReviewEvidence = visualReviewArtifact?.fullyReviewed === true
                ? visualReviewArtifact.receipt
                : undefined;

            verdict = parseCriticVerdict(review.message);
            // 确定性评分卡并轨：从本次流水线各阶段累计的真实工具结果做确定性测量，带新鲜度门禁——
            // 结构读（getDocumentInfo/getLayerHierarchy/getAllTextLayers）必须晚于最后一次成功写操作
            // 才可用（见 buildDeterministicScorecard），绝不用执行前旧画面测量并行使否决权。
            // 失败/待复核断言带 owner 并进裁决 issues；仅 blocker 级失败强制 needs_fix（红线不被
            // 模型散文抵消），major/minor 梯度缺陷判软不翻转模型 pass。无新鲜可测快照时诚实跳过。
            const deterministicScorecard = this.buildDeterministicScorecard(pipelineToolResults);
            if (deterministicScorecard) {
                verdict = mergeDeterministicScorecardIntoCriticVerdict(verdict, deterministicScorecard);
            }
            if (verdict.status === 'pass') break;
            if (verdict.status === 'unparseable') {
                // 已评审但无法机读（且确定性测量也没发现失败）：不强行修订，按已完成处理并保留评审原文
                break;
            }
            const issueText = formatCriticIssues(verdict);
            if (round >= maxRevisions) {
                revisionNotes.push(issueText);
                break;
            }

            const owner = pickPrimaryIssueOwner(verdict);
            const route = buildRevisionRoute(owner);
            const revisionRouteWithReview = [...route, 'critic' as const];
            const revisionRouteReservations = reserveStageGroupBudgets(revisionRouteWithReview);
            if (!Array.isArray(revisionRouteReservations)) {
                budgetExhaustedDuringRevision = true;
                budgetExhaustedReason = revisionRouteReservations.reason;
                revisionNotes.push(issueText);
                break;
            }
            revisionRounds++;
            revisionNotes.push(issueText);
            for (let routeIndex = 0; routeIndex < route.length; routeIndex++) {
                const role = route[routeIndex];
                const stageSuffix = route.length === 1
                    ? ''
                    : role === 'executor'
                        ? '-apply'
                        : `-${role}`;
                const revision = await runStage(
                    `revise-${revisionRounds}${stageSuffix}`,
                    role,
                    buildRevisionTask(role, goal, issueText),
                    undefined,
                    false,
                    revisionRouteReservations[routeIndex]
                );
                if (revision.status === 'cancelled') return cancelledResult();
                if (revision.status === 'budget_blocked') {
                    budgetExhaustedDuringRevision = true;
                    budgetExhaustedReason = revision.block.reason;
                    break reviewLoop;
                }
                const revisionResult = revision.result;
                if (!revisionResult.success) {
                    return {
                        success: false,
                        qualityPassed: false,
                        childAgentUsage: summarizeChildAgentUsage(stages),
                        message: `修订阶段失败：${revisionResult.error || revisionResult.message}`,
                        goal, stages, revisionRounds, verdict,
                        error: revisionResult.error || 'revise stage failed'
                    };
                }
            }
            pendingRevisionReviewBudget = revisionRouteReservations[route.length];
        }

        const criticVerdictPassed = verdict?.status === 'pass';
        const qualityPassed = criticVerdictPassed && Boolean(visualReviewEvidence);
        let verdictLine = '评审已完成（未提供机读裁决，详见评审报告）。';
        if (qualityPassed) {
            verdictLine = '评审通过。';
        } else if (criticVerdictPassed) {
            verdictLine = 'Critic 给出了通过裁决，但没有取得最后一次画面写入后的 Runtime 视觉回执，不能据此声明质量通过。';
        } else if (budgetExhaustedDuringRevision) {
            verdictLine = `首次评审已经完成，但子执行额度不足以继续完整修订与复审：${budgetExhaustedReason}`;
        } else if (verdict?.status === 'needs_fix') {
            verdictLine = `评审仍有 ${verdict.issues.length} 个待改进项（已达修订轮数上限，详见评审报告）。`;
        }

        await syncPipelineRetrospectiveToDesignState(request.projectPath, {
            goal,
            stages,
            verdict,
            revisionRounds,
            revisionNotes
        });

        const pipelineResult: DesignTeamPipelineResult = {
            success: true,
            qualityPassed,
            ...(visualReviewEvidence ? { visualReviewEvidence } : {}),
            childAgentUsage: summarizeChildAgentUsage(stages),
            ...(budgetExhaustedDuringRevision ? { budgetExhausted: true } : {}),
            message: [
                `团队流水线执行完成（${stages.length} 个阶段，${revisionRounds} 轮修订）。${qualityPassed ? '质量通过。' : '质量未通过或尚未证实。'}${verdictLine}`,
                ...(verdict?.deterministicScorecard
                    ? [`确定性评分卡：${verdict.deterministicScorecard.summary}`]
                    : []),
                '',
                `执行报告：${workspace.latestOfType('execution_report')?.content || '（无）'}`,
                '',
                `评审报告：${verdict?.reviewText || '（无）'}`
            ].join('\n'),
            goal,
            stages,
            verdict,
            revisionRounds
        };
        if (visualReviewArtifact) {
            writeTrustedVisualReviewArtifact(pipelineResult, visualReviewArtifact);
        }
        return pipelineResult;
    }

    /**
     * 从流水线累计的工具结果构建确定性事实评分卡（仅真正有唯一答案的 deterministic 断言，纯逻辑）。
     * 测量新鲜度门禁：结构读结果必须晚于最后一次成功写操作（写类分类复用
     * isAgentToolExecutionGuarded 单一口径，门禁实现在
     * extractFreshDesignSurfaceSnapshotFromToolResults），否则等于拿执行前旧画面测量、
     * 且会让后续事实判断引用旧状态。renderLayout 的 subjectLayerIds 是身份声明，
     * 不受新鲜度限制。写后无新鲜结构读或无可测画面快照时返回 null——诚实不评，绝不用默认值
     * 伪造测量；critic 白名单已含 getDocumentInfo/getLayerHierarchy/getAllTextLayers，
     * 评审轮有机制自取最新结构读取结果（是否调用由模型决定）。
     */
    private buildDeterministicScorecard(
        toolResults: Array<{ name: string; result: any }>
    ): DesignScorecard | null {
        const snapshot = extractFreshDesignSurfaceSnapshotFromToolResults(toolResults);
        if (!snapshot) return null;
        const measurements = extractDesignQualityMeasurements(snapshot);
        const results = evaluateDeterministicAssertions(measurements);
        return scoreDesignAssertions(results);
    }

    private createTaskId(role: DesignTeammateTaskRequest['role']): string {
        const stamp = Date.now().toString(36);
        const random = Math.random().toString(36).slice(2, 8);
        return `design-task-${role}-${stamp}-${random}`;
    }
}
