/**
 * Agent Run Record（Harness v1 · H1）：一次自主运行 = 一条可持久化、可回放的运行记录。
 *
 * 背景：此前运行状态只活在内存——触上限/中断即全丢，续跑靠从聊天历史反推
 * （agent-resumable-task-contract 是消息考古，不是状态恢复）；过程审计要手扒
 * conversations JSON。本模块把 AgentRunResult 已携带的全部事件（toolCallLog/
 * executionSummary/stopReason）+ 控制面决策，组装成统一 Trace 记录。
 *
 * 纯逻辑（无 IPC / 无文件系统 / 无 Date.now），smoke 可测：
 *  - 工具调用一律摘要化：不存原始 arguments/result（可能含 base64 大对象），
 *    只存 argsKeys/摘要行/成败/风险类，boundaries.argsDigestedOnly 钉死。
 *  - 风险分类复用 isAgentToolExecutionGuarded 单一口径（写类判定与新鲜度门禁同源）。
 *  - checkpoint v0 只记录可从日志确定性推导的状态旗标（为 H2 续跑供数，不宣称已可续跑）。
 *
 * 持久化在 main 进程 handler（agentRun:writeRecord，原子写 <project>/.designecho/runs/），
 * 写入方是 autonomous-agent 执行器边缘——记录失败绝不影响任务结果。
 */

import {
    classifyAgentToolExecution,
    isAgentHarnessControlTool,
    isAgentInputCollectionTool,
    isAgentToolExecutionGuarded,
    type AgentToolExecutionKind
} from './agent-tool-execution-preflight';
import {
    readPhotoshopHistoryStateRef,
    readPhotoshopHistoryTransition,
    readPhotoshopMutationCommit,
    type PhotoshopHistoryStateRef,
    type PhotoshopMutationCommit,
    type PhotoshopHistoryTransition
} from './photoshop-history-state-ref';
import type { RuntimeStageState } from './agent-runtime-v5/runtime-stage-state';
import type { RuntimeStageTraceDigest } from './agent-runtime-v5/runtime-stage-trace';
import type { RuntimeDesignBriefDigest } from './agent-runtime-v5/runtime-design-brief-declaration';
import type { RuntimeDesignStrategyDigest } from './agent-runtime-v5/runtime-design-strategy-declaration';
import {
    MAX_RUNTIME_ACTION_PLAN_STEPS,
    type RuntimeActionPlanDigest
} from './agent-runtime-v5/runtime-action-plan-declaration';
import type { RuntimeActionPlanReconciliationDigest } from './agent-runtime-v5/runtime-action-plan-reconciliation';
import type { RuntimeActionPlanNoRedoShadowDigest } from './agent-runtime-v5/runtime-action-plan-no-redo-shadow';
import type { RuntimePlanningContextSeedDigest } from './agent-runtime-v5/runtime-planning-context-seed';
import {
    cloneRuntimeAccountingDigest,
    validateRuntimeAccountingDigest,
    validatePersistedRuntimeAccountingDigest,
    type RuntimeAccountingDigest
} from './agent-runtime-v5/runtime-accounting';
import {
    MAX_ARTIFACT_REFS,
    readArtifactRef,
    readArtifactRepositoryProjection,
    type ArtifactRepositoryReadProjection
} from './agent-runtime-v5/artifact-repository-contract';
import type { ArtifactRef } from './agent-runtime-v5/contracts/common';
import {
    validateRuntimeSessionIdentity,
    type RuntimeSessionDigest,
    type RuntimeSessionIdentity
} from './agent-runtime-v5/runtime-session';
import {
    buildRuntimeContractStatus,
    type RuntimeContractStatus
} from './agent-runtime-v5/runtime-selected-skill-handoff';
import {
    buildRuntimeResumeContextAnchor,
    type RuntimeActionPlanResumeFreshness,
    type RuntimeResumeContextAnchor
} from './agent-runtime-v5/runtime-action-plan-resume-freshness';
import {
    describeDesignRunToolLogFacts,
    extractDesignRunToolLogFacts
} from './design-run-tool-log-facts';
import type { DesignEvaluationProfileDigest } from './agent-runtime-v5/design-evaluation-profiles';
import {
    readFinalQualityModelProtocolDigest,
    type FinalQualityModelProtocolDigest
} from './design-quality-assertion';
import type { DesignVerdict } from './design-quality-verdict-bundle';
import {
    sanitizeModelProviderDiagnostic,
    type ModelProviderFailureBasis,
    type ModelProviderFailureKind
} from './model-provider-failure';

export type AgentRunRecordVersion = 'agent-run-record/v0';

export type RunToolRiskClass = 'write' | 'read';
export type AgentRunToolActivityClass = 'mutation' | 'observation' | 'control' | 'other';
export type AgentRunToolCallOrigin =
    | 'model_tool_call'
    | 'harness_compact_workflow_owner'
    | 'harness_opening_observation'
    | 'harness_quality_verification';
export type AgentRunQualityVerificationPhase = 'pre_judge' | 'post_judge' | 'final_summary';

export interface AgentRunToolCallEntry {
    seq: number;
    name: string;
    riskClass: RunToolRiskClass;
    /**
     * 运行事实类别。互斥分类用于审计与续跑口径：
     * 观察/控制动作绝不能被解释为设计已完成。
     */
    activityClass: AgentRunToolActivityClass;
    success: boolean;
    /** 可选来源；旧运行记录缺省时仍按模型调用兼容。 */
    origin?: AgentRunToolCallOrigin;
    /** Harness 质量复核的闭合相位；只在 origin=harness_quality_verification 时保存。 */
    qualityVerificationPhase?: AgentRunQualityVerificationPhase;
    /**
     * 距本轮 run 起点（performanceLedger.runStartedAtMs）的毫秒数（非负整数，上限 24h 拒绝）。
     * 缺失代表旧记录或未开启时序；诊断口径「首次成功写入延迟」只统计带值的档案。
     */
    elapsedMs?: number;
    /** 写调用窗口的紧凑 Host before/after 对账；仍来自同一 Tool 结果，不另建版本账本。 */
    photoshopHistoryTransition?: PhotoshopHistoryTransition;
    /** UXP 在同一 executeAsModal 内形成的调用级提交；优先于外围快照对账。 */
    photoshopMutationCommit?: PhotoshopMutationCommit;
    /** 只读调用观察到的文档 / history 版本；用于证明写后读回针对同一真实版本。 */
    photoshopObservationRef?: PhotoshopHistoryStateRef;
    /** 结果里的错误码（如有），如 blocked_missing_per_size_template */
    code?: string;
    /** 一行摘要（≤160 字符，已剥 base64/data URL），来自 error/message/固定成功语 */
    summary: string;
    /** 入参顶层键名（不存值——防大对象与敏感内容入档） */
    argsKeys: string[];
}

/** 本轮创建的关键画布实体（实体锚）：续跑时防止把自己的半成品当成文档原有内容而重做。 */
export interface AgentRunPlacedLayer {
    layerId: number;
    name?: string;
}

export interface AgentRunActivityCount {
    successful: number;
    failed: number;
}

export interface AgentRunActivityCounts {
    mutation: AgentRunActivityCount;
    observation: AgentRunActivityCount;
    control: AgentRunActivityCount;
    other: AgentRunActivityCount;
}

/** H2 续跑的确定性状态旗标：只记能从工具日志推导的事实，不做任何推测。 */
export interface AgentRunCheckpoint {
    documentCreated: boolean;
    layoutRendered: boolean;
    lastToolName?: string;
    /**
     * v0 兼容总数：历史语义混合了读取、控制与写入，不能作为任务完成依据。
     * 新消费者应使用 activityCounts。
     */
    successfulToolCount: number;
    /** 新记录始终写入；可选是为了兼容尚未迁移的 v0 历史档案。 */
    activityCounts?: AgentRunActivityCounts;
    /** 成功 placeImage 产物的图层 id/名（上限 8 条；结果里提不到 id 就不记，不臆造） */
    placedLayers?: AgentRunPlacedLayer[];
    /**
     * 只读发现的有界摘要（上限 6 条，每条 ≤120 字，形如"工具名：摘要"）。
     * 续跑摘要带上它，"重新核实现状"才能变成"核对既有清单"，而不是从零重做发现。
     */
    readFindings?: string[];
    /**
     * 「做到哪」的自然语言摘要（≤600 字），只陈述工具日志能证明的事实：在哪个文档、看过 / 置入了哪些素材、
     * Agent 声明了什么版面与标题、导出了什么。续跑摘要读它，下一轮开工就知道上一轮的画面内容，
     * 而不是只知道「已建文档 / 已排版」两个旗标。
     */
    designSummary?: string;
}

export interface AgentRunModelProviderFailureDigest {
    version: 'model-provider-failure-digest/v0';
    kind: ModelProviderFailureKind;
    basis: ModelProviderFailureBasis;
    modelId: string;
    status?: number;
    providerCode?: string;
    diagnostic: string;
}

export interface AgentRunModelIdentityDigest {
    version: 'agent-run-model-identity/v0';
    source: 'runtime-selected-model';
    modelId: string;
    provider: string;
    apiModelId?: string;
}

/**
 * Run Record 只保存对话与消息树分支的身份，不保存消息正文。
 * 自动恢复必须同时命中两者，避免编辑重发或跨对话时把旧任务带回来。
 */
export interface AgentRunConversationScope {
    conversationId: string;
    branchId: string;
}

export interface AgentRunRecord {
    version: AgentRunRecordVersion;
    runId: string;
    /** Reflexion 重入链：本轮若是复盘重跑，指向上一轮记录 */
    parentRunId?: string;
    endedAt: string;
    goal: string;
    decision?: {
        requestKind?: string;
        route?: string;
        skillId?: string;
    };
    /**
     * 循环内由唯一 Resolver 已解析的 Manifest 身份摘要。
     * agentic 路径不创建 staged RuntimeSession，因此不能用 runtimeSession 缺失反推未绑定。
     * 本字段只记录选择事实，不授予 Tool、Stage、完成或发布权限。
     */
    runtimeContractStatus?: RuntimeContractStatus;
    projectPath?: string;
    conversationScope?: AgentRunConversationScope;
    iterations: number;
    stopReason?: string;
    success: boolean;
    cancelled?: boolean;
    toolCalls: AgentRunToolCallEntry[];
    /** 超出上限被截断的调用数（中段丢弃，保头尾） */
    droppedToolCalls: number;
    blockers: string[];
    warnings: string[];
    /** 真实模型请求边界的有界失败摘要；不含 API Key、Authorization 或完整响应载荷。 */
    providerFailure?: AgentRunModelProviderFailureDigest;
    /** 本轮自主循环真正采用的模型配置身份；不由开发 Runner 手工填写。 */
    modelIdentity?: AgentRunModelIdentityDigest;
    quality?: {
        executionStatus?: string;
        hardBlocked?: boolean;
        verdictStatus?: DesignVerdict['status'];
        verdictSource?: DesignVerdict['source'];
        overallScore?: number;
        artifactStatus?: DesignEvaluationProfileDigest['completion']['artifactStatus'];
        publicationReviewStatus?: DesignEvaluationProfileDigest['completion']['publicationReviewStatus'];
        /** 只供开发 / Runtime 诊断；不得参与 completion、权限或 DesignVerdict。 */
        finalQualityModelProtocol?: FinalQualityModelProtocolDigest;
    };
    /** 当前 generation 的生产 Runtime Session 摘要；runId 必须与记录主键完全一致。 */
    runtimeSession?: RuntimeSessionDigest;
    /**
     * 没有可持久化 runtimeSession digest 时的会计摘要，包括普通 Agent 与 staged 失败路径。
     * 与 runtimeSession.accounting 互斥，只供开发诊断，不影响预算、权限或任务结果。
     */
    runtimeAccounting?: RuntimeAccountingDigest;
    /** 仅由主进程 Artifact Repository reader 附加；不保存 payload、路径或调用方 hash。 */
    artifactRefs?: ArtifactRef[];
    /** 同一 Runtime identity 下超过持久化上限、未进入本记录的 Repository ref 数。 */
    droppedArtifactRefCount?: number;
    /** 同一活动 Session 内规划声明承接的审计摘要；绝不包含完整声明。 */
    planningContextCarry?: RuntimePlanningContextSeedDigest;
    /** Stage State 的脱敏摘要；完整 transition ledger 仍随本轮 Agent result 暂存，不复制进运行档案。 */
    stageState?: {
        status: RuntimeStageState['status'];
        currentStage?: string;
        lastDecision?: string;
        lastTargetStage?: string;
        transitionCount: number;
        issueCount: number;
    };
    /** Shadow Stage Trace 的脱敏对账摘要；完整 events 不进入长期运行档案。 */
    stageTrace?: {
        status: RuntimeStageTraceDigest['status'];
        eventCount: number;
        droppedEventCount: number;
        observedStages: string[];
        missingStages: string[];
        outOfOrderCount: number;
        unbackedTransitionCount: number;
        traceEventWithoutTransitionCount: number;
        issueCount: number;
    };
    /** 模型 R1 Design Brief 的续跑摘要；完整输入覆盖声明不进入长期运行档案。 */
    designBrief?: {
        readiness: RuntimeDesignBriefDigest['readiness'];
        taskGoal: string;
        deliverables: string[];
        requiredInputCount: number;
        providedRequiredInputCount: number;
        missingRequiredInputKeys: string[];
        assumedRequiredInputKeys: string[];
        contextRefs: string[];
        constraintCount: number;
    };
    /** 模型 R3 策略的续跑摘要；完整声明不进入长期运行档案。 */
    designStrategy?: {
        readiness: RuntimeDesignStrategyDigest['readiness'];
        stageGoal: string;
        primaryGoal: string;
        targetAudienceSummary: string;
        primaryMessage: string;
        moodKeywords: string[];
        compositionIntent: string[];
        contextRefs: string[];
        constraintCount: number;
        assumptionCount: number;
        missingInputCount: number;
    };
    /** 模型 R4 动态行动计划的续跑摘要；完整步骤、依赖图和 DSL 不进入长期运行档案。 */
    actionPlan?: {
        readiness: RuntimeActionPlanDigest['readiness'];
        planGoal: string;
        strategyStageGoal: string;
        stepCount: number;
        stepKinds: string[];
        rootStepIds: string[];
        terminalStepIds: string[];
        parallelGroupCount: number;
        capabilityRefs: string[];
        missingCapabilityRefs: string[];
        contextRefs: string[];
        designDsl?: {
            compositionIntent: string;
            regionCount: number;
            elementCount: number;
            readingOrder: string[];
        };
        missingInputCount: number;
        resumeReuseCount: number;
        resumeRedoRequiredCount: number;
    };
    /** R4 节点执行影子对账摘要；完整步骤状态和 observation attribution 不进入长期档案。 */
    actionPlanReconciliation?: {
        status: RuntimeActionPlanReconciliationDigest['status'];
        planReadiness: RuntimeActionPlanReconciliationDigest['planReadiness'];
        stepCount: number;
        completedStepIds: string[];
        completedStepDescriptors?: Array<{
            stepId: string;
            kind: string;
            capabilityRefs: string[];
            observedOutcomes: string[];
        }>;
        failedStepIds: string[];
        recoveredStepIds: string[];
        resumeStepIds: string[];
        observationCount: number;
        droppedObservationCount: number;
        ambiguousObservationCount: number;
        dependencyBlockedObservationCount: number;
        unmatchedObservationCount: number;
        repeatAfterCompletionCount: number;
        issueCount: number;
    };
    /** 跨轮防重做影子摘要；完整映射和当前 observation 不进入长期档案。 */
    actionPlanNoRedoShadow?: {
        status: RuntimeActionPlanNoRedoShadowDigest['status'];
        sourceRunId?: string;
        reuseCandidateStepIds: string[];
        repeatObservedStepIds: string[];
        intentionalRedoStepIds: string[];
        intentionalRedoObservedStepIds: string[];
        verifiedPriorCompletedStepCount: number;
        mappingCount: number;
        unmappedVerifiedPriorStepCount: number;
    };
    /** 上一轮结束时的 Context 指纹；只含 digest，不含原始文档 / 项目状态。 */
    contextAnchor?: RuntimeResumeContextAnchor;
    /** 本轮若采用旧档案，记录其新鲜度裁决；仍是建议性诊断信息。 */
    resumeFreshness?: RuntimeActionPlanResumeFreshness;
    checkpoint: AgentRunCheckpoint;
    boundaries: {
        argsDigestedOnly: true;
        containsRawImages: false;
        neverBlocksTaskResult: true;
        stageStateDigestOnly?: true;
        stageTraceDigestOnly?: true;
        designBriefDigestOnly?: true;
        designStrategyDigestOnly?: true;
        actionPlanDigestOnly?: true;
        actionPlanReconciliationDigestOnly?: true;
        actionPlanNoRedoShadowDigestOnly?: true;
        contextAnchorDigestOnly?: true;
        resumeFreshnessDigestOnly?: true;
        runtimeSessionDigestOnly?: true;
        planningContextCarryDigestOnly?: true;
        artifactRefsFromRepositoryOnly?: true;
        providerFailureDigestOnly?: true;
        modelIdentityDigestOnly?: true;
        conversationScopeIdentityOnly?: true;
        runtimeAccountingDigestOnly?: true;
        runtimeContractStatusDigestOnly?: true;
    };
}

export interface BuildAgentRunRecordInput {
    /** ISO 时间（调用方传入，本模块不取时钟） */
    now: string;
    goal: unknown;
    projectPath?: unknown;
    conversationScope?: {
        conversationId?: unknown;
        branchId?: unknown;
    };
    projectState?: unknown;
    parentRunId?: string;
    /** 由生产 Runtime 在执行前签发；存在时取代收尾阶段的 late runId 生成。 */
    runtimeSessionIdentity?: RuntimeSessionIdentity;
    resumeFreshness?: RuntimeActionPlanResumeFreshness;
    controlPlane?: {
        requestKind?: unknown;
        route?: unknown;
        skillId?: unknown;
    } | null;
    /** 循环内 Resolver 的当前结构化状态；仅 resolved 摘要会进入长期档案。 */
    runtimeContractStatus?: RuntimeContractStatus;
    modelIdentity?: {
        modelId?: unknown;
        provider?: unknown;
        apiModelId?: unknown;
    };
    result: {
        success?: unknown;
        cancelled?: unknown;
        iterations?: unknown;
        stopReason?: unknown;
        error?: unknown;
        toolCallLog?: Array<{
            name?: unknown;
            arguments?: unknown;
            result?: unknown;
            origin?: unknown;
            qualityVerificationPhase?: unknown;
            elapsedMs?: unknown;
        }>;
        executionSummary?: {
            status?: unknown;
            blockers?: unknown;
            warnings?: unknown;
            designQualityHardBlocked?: unknown;
            designVerdict?: DesignVerdict;
            designEvaluationProfileDigest?: DesignEvaluationProfileDigest;
            finalQualityModelProtocolDigest?: FinalQualityModelProtocolDigest;
            runtimeStageState?: RuntimeStageState;
            runtimeStageTraceDigest?: RuntimeStageTraceDigest;
            runtimeDesignBriefDigest?: RuntimeDesignBriefDigest;
            runtimeDesignStrategyDigest?: RuntimeDesignStrategyDigest;
            runtimeActionPlanDigest?: RuntimeActionPlanDigest;
            runtimeActionPlanReconciliationDigest?: RuntimeActionPlanReconciliationDigest;
            runtimeActionPlanNoRedoShadowDigest?: RuntimeActionPlanNoRedoShadowDigest;
            runtimeSessionDigest?: RuntimeSessionDigest;
            runtimeAccountingDigest?: RuntimeAccountingDigest;
            runtimePlanningContextSeedDigest?: RuntimePlanningContextSeedDigest;
            modelProviderFailureDigest?: {
                version?: unknown;
                kind?: unknown;
                basis?: unknown;
                modelId?: unknown;
                status?: unknown;
                providerCode?: unknown;
                diagnostic?: unknown;
            };
        } | null;
    };
}

const MAX_TOOL_CALLS = 400;
const KEEP_HEAD = 200;
const KEEP_TAIL = 200;
const MAX_LIST = 20;
const MAX_SUMMARY_CHARS = 160;
const MAX_GOAL_CHARS = 400;

const AGENT_RUN_RECORD_ALLOWED_KEYS = new Set<string>([
    'version',
    'runId',
    'parentRunId',
    'endedAt',
    'goal',
    'decision',
    'runtimeContractStatus',
    'projectPath',
    'conversationScope',
    'iterations',
    'stopReason',
    'success',
    'cancelled',
    'toolCalls',
    'droppedToolCalls',
    'blockers',
    'warnings',
    'providerFailure',
    'modelIdentity',
    'quality',
    'runtimeSession',
    'runtimeAccounting',
    'artifactRefs',
    'droppedArtifactRefCount',
    'planningContextCarry',
    'stageState',
    'stageTrace',
    'designBrief',
    'designStrategy',
    'actionPlan',
    'actionPlanReconciliation',
    'actionPlanNoRedoShadow',
    'contextAnchor',
    'resumeFreshness',
    'checkpoint',
    'boundaries'
] as const satisfies readonly (keyof AgentRunRecord)[]);

const AGENT_RUN_RECORD_BOUNDARY_ALLOWED_KEYS = new Set<string>([
    'argsDigestedOnly',
    'containsRawImages',
    'neverBlocksTaskResult',
    'stageStateDigestOnly',
    'stageTraceDigestOnly',
    'designBriefDigestOnly',
    'designStrategyDigestOnly',
    'actionPlanDigestOnly',
    'actionPlanReconciliationDigestOnly',
    'actionPlanNoRedoShadowDigestOnly',
    'contextAnchorDigestOnly',
    'resumeFreshnessDigestOnly',
    'runtimeSessionDigestOnly',
    'planningContextCarryDigestOnly',
    'artifactRefsFromRepositoryOnly',
    'providerFailureDigestOnly',
    'modelIdentityDigestOnly',
    'conversationScopeIdentityOnly',
    'runtimeAccountingDigestOnly',
    'runtimeContractStatusDigestOnly'
] as const satisfies readonly (keyof AgentRunRecord['boundaries'])[]);

const RUNTIME_CONTRACT_STATUS_ALLOWED_KEYS = new Set<string>([
    'version',
    'status',
    'selectedSkillId',
    'selectedTaskType',
    'manifestSkillId',
    'selectionSource',
    'reason',
    'boundaries'
] as const satisfies readonly (keyof RuntimeContractStatus)[]);

const RUNTIME_CONTRACT_STATUS_BOUNDARY_ALLOWED_KEYS = new Set<string>([
    'doesNotExecuteSkill',
    'doesNotGrantToolPermission'
] as const satisfies readonly (keyof RuntimeContractStatus['boundaries'])[]);

const RUNTIME_CONTRACT_STATUS_SELECTION_SOURCES = new Set<NonNullable<RuntimeContractStatus['selectionSource']>>([
    'model_router_react_handoff',
    'skill_declaration_unique_match',
    'controlled_route_react_handoff',
    'user_explicit_selection',
    'explicit_runtime_declaration'
]);

const AGENT_RUN_CONVERSATION_SCOPE_ALLOWED_KEYS = new Set<string>([
    'conversationId',
    'branchId'
] as const satisfies readonly (keyof AgentRunConversationScope)[]);

const MODEL_PROVIDER_FAILURE_DIGEST_ALLOWED_KEYS = new Set<string>([
    'version',
    'kind',
    'basis',
    'modelId',
    'status',
    'providerCode',
    'diagnostic'
]);

const MODEL_IDENTITY_DIGEST_ALLOWED_KEYS = new Set<string>([
    'version',
    'source',
    'modelId',
    'provider',
    'apiModelId'
]);

const MODEL_PROVIDER_FAILURE_KINDS = new Set<ModelProviderFailureKind>([
    'billing',
    'auth',
    'model_access',
    'rate_limit',
    'timeout',
    'network',
    'protocol',
    'service_unavailable',
    'unknown'
]);

const MODEL_PROVIDER_FAILURE_BASES = new Set<ModelProviderFailureBasis>([
    'status',
    'code',
    'message',
    'none'
]);

function cleanText(value: unknown, maxLen: number): string {
    const text = String(value ?? '').trim();
    if (!text) return '';
    return stripBulkPayloads(text).slice(0, maxLen);
}

function buildModelProviderFailureDigest(value: unknown): AgentRunModelProviderFailureDigest | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const candidate = value as Record<string, unknown>;
    const kind = cleanText(candidate.kind, 40) as ModelProviderFailureKind;
    const basis = cleanText(candidate.basis, 20) as ModelProviderFailureBasis;
    const modelId = cleanText(candidate.modelId, 160);
    const diagnostic = sanitizeModelProviderDiagnostic(candidate.diagnostic);
    if (!MODEL_PROVIDER_FAILURE_KINDS.has(kind)
        || !MODEL_PROVIDER_FAILURE_BASES.has(basis)
        || !modelId
        || !diagnostic) {
        return undefined;
    }
    const status = Number(candidate.status);
    const providerCode = cleanText(candidate.providerCode, 120);
    return {
        version: 'model-provider-failure-digest/v0',
        kind,
        basis,
        modelId,
        ...(Number.isInteger(status) && status >= 100 && status <= 599 ? { status } : {}),
        ...(providerCode ? { providerCode } : {}),
        diagnostic
    };
}

function buildModelIdentityDigest(
    value: BuildAgentRunRecordInput['modelIdentity']
): AgentRunModelIdentityDigest | undefined {
    const modelId = cleanText(value?.modelId, 160);
    const provider = cleanText(value?.provider, 80);
    const apiModelId = cleanText(value?.apiModelId, 160);
    if (!modelId || !provider) return undefined;
    return {
        version: 'agent-run-model-identity/v0',
        source: 'runtime-selected-model',
        modelId,
        provider,
        ...(apiModelId ? { apiModelId } : {})
    };
}

function cleanStrategyText(value: unknown, maxLen: number): string {
    return cleanText(value, maxLen)
        .replace(/[A-Za-z]:[\\/][^\s，。；;]*/g, '[local-path-omitted]')
        .replace(/\\\\[^\\/\s]+[\\/][^\s，。；;]*/g, '[local-path-omitted]')
        .replace(/\/(?:Users|home|tmp|var|private)\/[^\s，。；;]*/g, '[local-path-omitted]')
        .slice(0, maxLen);
}

function cleanStrategyList(value: unknown, limit: number): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => cleanStrategyText(item, MAX_SUMMARY_CHARS))
        .filter(Boolean)
        .slice(0, limit);
}

function cleanStableRefs(value: unknown, limit = 12): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value
        .map((item) => String(item || '').trim())
        .filter((item) => /^[A-Za-z][A-Za-z0-9_.:-]{0,99}$/.test(item))))
        .slice(0, limit);
}

/** 剥 data URL 与长 base64 串——记录里绝不进图像字节。 */
function stripBulkPayloads(text: string): string {
    return text
        .replace(/data:[a-zA-Z0-9/+.-]+;base64,[A-Za-z0-9+/=]+/g, '[image-data-omitted]')
        .replace(/[A-Za-z0-9+/=]{200,}/g, '[bulk-payload-omitted]');
}

function stableHash(input: string): string {
    // FNV-1a 32bit，十六进制——确定性、无依赖（与仓内其他纯逻辑哈希做法一致）
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

export function generateAgentRunId(now: string, goal: string, toolNames: string[]): string {
    const compactTime = String(now || '').replace(/[-:TZ.]/g, '').slice(0, 14) || 'unknown';
    return `run-${compactTime}-${stableHash(goal)}-${stableHash(toolNames.join('>')).slice(0, 4)}`;
}

/**
 * 工具活动分类：运行档案与执行摘要共用的单一口径。
 *
 * 导出而非各自实现：此前执行摘要用「完成观察门禁」的口径显示"已查看 N 项"，
 * 而那个口径只统计最后一次写入之后的 Photoshop 文档观察，于是真实看了 11 次
 * （素材总览、参考分析、项目资源…）却对用户显示 0，让人以为 Agent 根本没看。
 */
export function classifyRunToolActivity(
    name: string,
    executionKind: AgentToolExecutionKind,
    origin?: AgentRunToolCallOrigin
): AgentRunToolActivityClass {
    if (executionKind === 'photoshop_write' || executionKind === 'save_export') {
        return 'mutation';
    }
    if (isAgentHarnessControlTool(name)
        || isAgentInputCollectionTool(name)
        || executionKind === 'stateful_context') {
        return 'control';
    }
    if (executionKind === 'read_only_observation' || executionKind === 'knowledge_search') {
        return 'observation';
    }
    if (origin === 'harness_opening_observation'
        || origin === 'harness_quality_verification') {
        return 'observation';
    }
    return 'other';
}

function digestToolCall(
    entry: {
        name?: unknown;
        arguments?: unknown;
        result?: unknown;
        origin?: unknown;
        qualityVerificationPhase?: unknown;
        elapsedMs?: unknown;
    },
    seq: number
): AgentRunToolCallEntry {
    const name = cleanText(entry.name, 80) || 'unknown_tool';
    const result = (entry.result && typeof entry.result === 'object') ? entry.result as Record<string, unknown> : {};
    const success = result.success !== false;
    const code = cleanText(result.code, 60);
    const rawSummary = !success
        ? (result.error ?? result.message ?? '失败（无错误信息）')
        : (result.message ?? '成功');
    const args = (entry.arguments && typeof entry.arguments === 'object' && !Array.isArray(entry.arguments))
        ? entry.arguments as Record<string, unknown>
        : {};
    const origin = entry.origin === 'model_tool_call'
        || entry.origin === 'harness_compact_workflow_owner'
        || entry.origin === 'harness_opening_observation'
        || entry.origin === 'harness_quality_verification'
        ? entry.origin
        : undefined;
    const qualityVerificationPhase = origin === 'harness_quality_verification'
        && (entry.qualityVerificationPhase === 'pre_judge'
            || entry.qualityVerificationPhase === 'post_judge'
            || entry.qualityVerificationPhase === 'final_summary')
        ? entry.qualityVerificationPhase
        : undefined;
    const photoshopHistoryTransition = readPhotoshopHistoryTransition(result);
    const photoshopMutationCommit = readPhotoshopMutationCommit(result);
    const photoshopObservationRef = readPhotoshopHistoryStateRef(result);
    const executionKind = classifyAgentToolExecution(name, args);
    const activityClass = classifyRunToolActivity(name, executionKind, origin);
    const rawElapsedMs = typeof entry.elapsedMs === 'number' && Number.isFinite(entry.elapsedMs)
        ? Math.floor(entry.elapsedMs)
        : NaN;
    const elapsedMs = rawElapsedMs >= 0 && rawElapsedMs < 24 * 60 * 60 * 1000
        ? rawElapsedMs
        : undefined;
    return {
        seq,
        name,
        riskClass: isAgentToolExecutionGuarded(name, args) ? 'write' : 'read',
        activityClass,
        success,
        ...(origin ? { origin } : {}),
        ...(qualityVerificationPhase ? { qualityVerificationPhase } : {}),
        ...(elapsedMs !== undefined ? { elapsedMs } : {}),
        ...(photoshopMutationCommit ? { photoshopMutationCommit } : {}),
        ...(photoshopHistoryTransition ? { photoshopHistoryTransition } : {}),
        ...(photoshopObservationRef ? { photoshopObservationRef } : {}),
        ...(code ? { code } : {}),
        summary: cleanText(rawSummary, MAX_SUMMARY_CHARS) || (success ? '成功' : '失败'),
        argsKeys: Object.keys(args).slice(0, 12)
    };
}

const MAX_PLACED_LAYERS = 8;

/** 从成功 placeImage 的原始结果里提取实体锚（layerId 必需；提不到不记，不臆造）。 */
function derivePlacedLayers(rawLog: unknown[]): AgentRunPlacedLayer[] {
    const placed: AgentRunPlacedLayer[] = [];
    for (const entry of rawLog) {
        if (placed.length >= MAX_PLACED_LAYERS) break;
        const record = entry as { name?: unknown; result?: unknown } | null;
        if (!record || String(record.name || '') !== 'placeImage') continue;
        const result = record.result as Record<string, any> | null | undefined;
        if (!result || result.success === false) continue;
        const layerId = Number(result.layerId ?? result.layer?.id ?? result.data?.layerId ?? result.newLayerId);
        if (!Number.isFinite(layerId) || layerId <= 0) continue;
        const rawName = result.layerName ?? result.layer?.name ?? result.data?.layerName;
        const name = cleanText(rawName, 40);
        placed.push(name ? { layerId, name } : { layerId });
    }
    return placed;
}

interface ComposeDesignCheckpointFacts {
    documentCreated: boolean;
    layoutRendered: boolean;
}

function deriveComposeDesignCheckpointFacts(rawLog: unknown[]): ComposeDesignCheckpointFacts {
    let documentCreated = false;
    let layoutRendered = false;
    for (const entry of rawLog) {
        const record = entry as { name?: unknown; arguments?: unknown; result?: unknown } | null;
        if (!record || String(record.name || '') !== 'composeDesign') continue;
        const args = record.arguments && typeof record.arguments === 'object'
            ? record.arguments as Record<string, any>
            : {};
        const result = record.result && typeof record.result === 'object'
            ? record.result as Record<string, any>
            : {};
        const transition = readPhotoshopHistoryTransition(result);
        const mutationObserved = transition?.mutationObserved === true;
        const requestedNewDocument = String(args.document?.mode || '').trim() === 'new';
        const succeeded = result.success !== false;

        if (requestedNewDocument
            && mutationObserved
            && (succeeded || result.data?.createdDocument === true)) {
            documentCreated = true;
        }
        if (mutationObserved
            && (result.data?.layoutRendered === true
                || (succeeded && Boolean(result.layerStructureReceipt)))) {
            layoutRendered = true;
        }
    }
    return { documentCreated, layoutRendered };
}

function deriveCheckpoint(calls: AgentRunToolCallEntry[], rawLog: unknown[]): AgentRunCheckpoint {
    const composeFacts = deriveComposeDesignCheckpointFacts(rawLog);
    let documentCreated = composeFacts.documentCreated;
    let layoutRendered = composeFacts.layoutRendered;
    let successfulToolCount = 0;
    const activityCounts: AgentRunActivityCounts = {
        mutation: { successful: 0, failed: 0 },
        observation: { successful: 0, failed: 0 },
        control: { successful: 0, failed: 0 },
        other: { successful: 0, failed: 0 }
    };
    for (const call of calls) {
        const activityCount = activityCounts[call.activityClass];
        if (call.success) {
            activityCount.successful += 1;
        } else {
            activityCount.failed += 1;
        }
        if (!call.success) continue;
        if (call.origin === 'harness_opening_observation'
            || call.origin === 'harness_quality_verification') continue;
        successfulToolCount += 1;
        if (call.name === 'createDocument') documentCreated = true;
        if (call.name === 'renderLayout') layoutRendered = true;
    }
    const last = [...calls].reverse().find((call) => (
        call.origin !== 'harness_opening_observation'
        && call.origin !== 'harness_quality_verification'
    ));
    const placedLayers = derivePlacedLayers(rawLog);
    const readFindings = deriveReadFindings(calls);
    const designSummary = deriveDesignSummary(rawLog);
    return {
        documentCreated,
        layoutRendered,
        ...(last ? { lastToolName: last.name } : {}),
        successfulToolCount,
        activityCounts,
        ...(placedLayers.length > 0 ? { placedLayers } : {}),
        ...(readFindings.length > 0 ? { readFindings } : {}),
        ...(designSummary ? { designSummary } : {})
    };
}

const DESIGN_SUMMARY_MAX_CHARS = 600;

/** 从原始工具日志提取「做到哪」摘要；提取失败或没有事实时返回空串，不影响档案其余部分。 */
function deriveDesignSummary(rawLog: unknown[]): string {
    try {
        const facts = extractDesignRunToolLogFacts(rawLog as Array<{ name?: unknown; arguments?: unknown; result?: unknown }>);
        return cleanText(describeDesignRunToolLogFacts(facts, { maxChars: DESIGN_SUMMARY_MAX_CHARS }), DESIGN_SUMMARY_MAX_CHARS);
    } catch {
        return '';
    }
}

/** 只读/检索类工具的发现摘要上限（供续跑摘要复用）。 */
const READ_FINDINGS_MAX = 6;
const READ_FINDINGS_TOOLS: ReadonlySet<string> = new Set([
    'listProjectResources',
    'searchProjectResources',
    'getResourcesByCategory',
    'getDesignProjectState',
    'searchDesignKnowledge',
    'searchEagleReferences',
    'recommendAssets',
    'parseDetailPageTemplate',
    'getDocumentInfo',
    'getLayerHierarchy',
    'analyzeProjectContactSheetOverview',
    'analyzeEagleReference'
]);

/** 从成功的只读/检索调用提取"工具名：摘要"有界行；同签名重复只留最后一条。 */
function deriveReadFindings(calls: AgentRunToolCallEntry[]): string[] {
    const findings = new Map<string, string>();
    for (const call of calls) {
        if (!call.success) continue;
        if (!READ_FINDINGS_TOOLS.has(call.name)) continue;
        const summary = cleanText(call.summary, 96);
        if (!summary || summary === '成功') continue;
        findings.set(`${call.name}|${summary}`, `${call.name}：${summary}`);
        if (findings.size >= READ_FINDINGS_MAX) break;
    }
    return [...findings.values()].slice(0, READ_FINDINGS_MAX);
}

function cleanList(value: unknown, limit = MAX_LIST): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => cleanText(item, MAX_SUMMARY_CHARS))
        .filter(Boolean)
        .slice(0, limit);
}

function buildResolvedRuntimeContractStatusDigest(
    value: RuntimeContractStatus | null | undefined
): RuntimeContractStatus | undefined {
    if (!value || value.status !== 'resolved') return undefined;
    const digest = buildRuntimeContractStatus({
        selectedSkillId: value.selectedSkillId,
        selectedTaskType: value.selectedTaskType,
        manifestSkillId: value.manifestSkillId,
        selectionSource: value.selectionSource,
        selectionExpected: true
    });
    return digest.status === 'resolved' ? digest : undefined;
}

export function buildAgentRunRecord(input: BuildAgentRunRecordInput): AgentRunRecord {
    const goal = cleanText(input.goal, MAX_GOAL_CHARS);
    const rawLog = Array.isArray(input.result.toolCallLog) ? input.result.toolCallLog : [];

    // 全量摘要化后按上限截断：保头（任务如何开局）+ 保尾（如何收场），中段计数丢弃
    const digestedAll = rawLog.map((entry, index) => digestToolCall(entry, index + 1));
    let toolCalls = digestedAll;
    let droppedToolCalls = 0;
    if (digestedAll.length > MAX_TOOL_CALLS) {
        droppedToolCalls = digestedAll.length - KEEP_HEAD - KEEP_TAIL;
        toolCalls = [...digestedAll.slice(0, KEEP_HEAD), ...digestedAll.slice(-KEEP_TAIL)];
    }

    const summary = input.result.executionSummary || null;
    const finalQualityModelProtocolCandidate = summary?.finalQualityModelProtocolDigest;
    const finalQualityModelProtocolDigest = finalQualityModelProtocolCandidate
        ? readFinalQualityModelProtocolDigest(finalQualityModelProtocolCandidate)
        : undefined;
    if (finalQualityModelProtocolCandidate && !finalQualityModelProtocolDigest) {
        throw new Error('final_quality_model_protocol_digest_invalid');
    }
    const runtimeStageState = summary?.runtimeStageState;
    const runtimeStageTraceDigest = summary?.runtimeStageTraceDigest;
    const runtimeDesignBriefDigest = summary?.runtimeDesignBriefDigest;
    const runtimeDesignStrategyDigest = summary?.runtimeDesignStrategyDigest;
    const runtimeActionPlanDigest = summary?.runtimeActionPlanDigest;
    const runtimeActionPlanReconciliationDigest = summary?.runtimeActionPlanReconciliationDigest;
    const runtimeActionPlanNoRedoShadowDigest = summary?.runtimeActionPlanNoRedoShadowDigest;
    const runtimeSessionDigest = summary?.runtimeSessionDigest;
    const runtimeSessionIdentity = input.runtimeSessionIdentity;
    const standaloneAccountingCandidate = !runtimeSessionDigest
        ? summary?.runtimeAccountingDigest
        : undefined;
    const standaloneAccountingValidation = standaloneAccountingCandidate
        ? validateRuntimeAccountingDigest(standaloneAccountingCandidate)
        : { ok: true };
    if (!standaloneAccountingValidation.ok) {
        throw new Error(
            `runtime_accounting_digest_invalid:${standaloneAccountingValidation.reason || 'unknown'}`
        );
    }
    const runtimeAccountingDigest = standaloneAccountingCandidate
        ? cloneRuntimeAccountingDigest(standaloneAccountingCandidate)
        : undefined;
    const runtimePlanningContextSeedDigest = summary?.runtimePlanningContextSeedDigest;
    const modelProviderFailureDigest = buildModelProviderFailureDigest(
        summary?.modelProviderFailureDigest
    );
    const modelIdentity = buildModelIdentityDigest(input.modelIdentity);
    const runtimeContractStatus = buildResolvedRuntimeContractStatusDigest(
        input.runtimeContractStatus
    );
    if (runtimeSessionIdentity) {
        const validation = validateRuntimeSessionIdentity(runtimeSessionIdentity);
        if (!validation.ok) throw new Error(validation.issues.join(','));
    }
    if (runtimeSessionIdentity && runtimeSessionDigest && (
        runtimeSessionIdentity.sessionId !== runtimeSessionDigest.sessionId
        || runtimeSessionIdentity.runId !== runtimeSessionDigest.runId
        || runtimeSessionIdentity.generation !== runtimeSessionDigest.generation
    )) {
        throw new Error('runtime_session_run_record_identity_mismatch');
    }
    if (runtimeSessionIdentity?.parentRunId
        && input.parentRunId
        && runtimeSessionIdentity.parentRunId !== input.parentRunId) {
        throw new Error('runtime_session_run_record_parent_mismatch');
    }
    if (runtimeSessionDigest?.parentRunId
        && input.parentRunId
        && runtimeSessionDigest.parentRunId !== input.parentRunId) {
        throw new Error('runtime_session_run_record_parent_mismatch');
    }
    const contextAnchor = buildRuntimeResumeContextAnchor({
        toolCallLog: rawLog,
        projectState: input.projectState
    });
    const lastStageTransition = runtimeStageState?.transitions?.[runtimeStageState.transitions.length - 1];
    const controlPlane = input.controlPlane || null;
    const decision = controlPlane
        ? {
            ...(cleanText(controlPlane.requestKind, 60) ? { requestKind: cleanText(controlPlane.requestKind, 60) } : {}),
            ...(cleanText(controlPlane.route, 60) ? { route: cleanText(controlPlane.route, 60) } : {}),
            ...(cleanText(controlPlane.skillId, 60) ? { skillId: cleanText(controlPlane.skillId, 60) } : {})
        }
        : undefined;
    const projectPath = cleanText(input.projectPath, 260);
    const conversationId = cleanText(input.conversationScope?.conversationId, 160);
    const conversationBranchId = cleanText(input.conversationScope?.branchId, 160);
    const conversationScope = conversationId && conversationBranchId
        ? { conversationId, branchId: conversationBranchId }
        : undefined;

    return {
        version: 'agent-run-record/v0',
        runId: runtimeSessionIdentity?.runId
            || runtimeSessionDigest?.runId
            || generateAgentRunId(input.now, goal, [
                ...(input.parentRunId ? [`parent:${input.parentRunId}`] : []),
                ...digestedAll.map((call) => call.name)
            ]),
        ...(runtimeSessionIdentity?.parentRunId
            ? { parentRunId: runtimeSessionIdentity.parentRunId }
            : (runtimeSessionDigest?.parentRunId
                ? { parentRunId: runtimeSessionDigest.parentRunId }
                : (input.parentRunId ? { parentRunId: input.parentRunId } : {}))),
        endedAt: cleanText(input.now, 40),
        goal,
        ...(decision && Object.keys(decision).length > 0 ? { decision } : {}),
        ...(runtimeContractStatus ? { runtimeContractStatus } : {}),
        ...(projectPath ? { projectPath } : {}),
        ...(conversationScope ? { conversationScope } : {}),
        iterations: Number(input.result.iterations) || 0,
        ...(cleanText(input.result.stopReason, 60) ? { stopReason: cleanText(input.result.stopReason, 60) } : {}),
        success: input.result.success === true,
        ...(input.result.cancelled === true ? { cancelled: true } : {}),
        toolCalls,
        droppedToolCalls,
        blockers: cleanList(summary?.blockers),
        warnings: cleanList(summary?.warnings),
        ...(modelProviderFailureDigest ? { providerFailure: modelProviderFailureDigest } : {}),
        ...(modelIdentity ? { modelIdentity } : {}),
        ...(runtimeAccountingDigest ? { runtimeAccounting: runtimeAccountingDigest } : {}),
        ...(summary
            ? {
                quality: {
                    ...(cleanText(summary.status, 40) ? { executionStatus: cleanText(summary.status, 40) } : {}),
                    ...(summary.designQualityHardBlocked === true ? { hardBlocked: true } : {}),
                    ...(summary.designVerdict ? { verdictStatus: summary.designVerdict.status } : {}),
                    ...(summary.designVerdict ? { verdictSource: summary.designVerdict.source } : {}),
                    ...(typeof summary.designVerdict?.overallScore === 'number'
                        ? { overallScore: summary.designVerdict.overallScore }
                        : {}),
                    ...(summary.designEvaluationProfileDigest?.completion
                        ? {
                            artifactStatus: summary.designEvaluationProfileDigest.completion.artifactStatus,
                            publicationReviewStatus: summary.designEvaluationProfileDigest.completion.publicationReviewStatus
                        }
                        : {}),
                    ...(finalQualityModelProtocolDigest
                        ? { finalQualityModelProtocol: finalQualityModelProtocolDigest }
                        : {})
                }
            }
            : {}),
        ...(runtimeSessionDigest ? { runtimeSession: runtimeSessionDigest } : {}),
        ...(runtimePlanningContextSeedDigest ? {
            planningContextCarry: {
                ...runtimePlanningContextSeedDigest,
                carriedStages: [...runtimePlanningContextSeedDigest.carriedStages],
                invalidatedStages: [...runtimePlanningContextSeedDigest.invalidatedStages],
                boundaries: { ...runtimePlanningContextSeedDigest.boundaries }
            }
        } : {}),
        ...(runtimeStageState ? {
            stageState: {
                status: runtimeStageState.status,
                ...(runtimeStageState.currentStage ? { currentStage: runtimeStageState.currentStage } : {}),
                ...(lastStageTransition ? { lastDecision: lastStageTransition.decision } : {}),
                ...(lastStageTransition?.targetStage ? { lastTargetStage: lastStageTransition.targetStage } : {}),
                transitionCount: runtimeStageState.transitions.length,
                issueCount: runtimeStageState.issues.length
            }
        } : {}),
        ...(runtimeStageTraceDigest ? {
            stageTrace: {
                status: runtimeStageTraceDigest.status,
                eventCount: runtimeStageTraceDigest.eventCount,
                droppedEventCount: runtimeStageTraceDigest.droppedEventCount,
                observedStages: runtimeStageTraceDigest.observedStages.slice(0, 12),
                missingStages: runtimeStageTraceDigest.missingStages.slice(0, 12),
                outOfOrderCount: runtimeStageTraceDigest.outOfOrderCount,
                unbackedTransitionCount: runtimeStageTraceDigest.unbackedTransitionCount,
                traceEventWithoutTransitionCount: runtimeStageTraceDigest.traceEventWithoutTransitionCount,
                issueCount: runtimeStageTraceDigest.issueCount
            }
        } : {}),
        ...(runtimeDesignBriefDigest ? {
            designBrief: {
                readiness: runtimeDesignBriefDigest.readiness,
                taskGoal: cleanStrategyText(runtimeDesignBriefDigest.taskGoal, 320),
                deliverables: cleanStrategyList(runtimeDesignBriefDigest.deliverables, 8),
                requiredInputCount: Math.max(0, Number(runtimeDesignBriefDigest.requiredInputCount) || 0),
                providedRequiredInputCount: Math.max(
                    0,
                    Number(runtimeDesignBriefDigest.providedRequiredInputCount) || 0
                ),
                missingRequiredInputKeys: cleanStableRefs(
                    runtimeDesignBriefDigest.missingRequiredInputKeys,
                    12
                ),
                assumedRequiredInputKeys: cleanStableRefs(
                    runtimeDesignBriefDigest.assumedRequiredInputKeys,
                    12
                ),
                contextRefs: cleanStableRefs(runtimeDesignBriefDigest.contextRefs, 16),
                constraintCount: Math.max(0, Number(runtimeDesignBriefDigest.constraintCount) || 0)
            }
        } : {}),
        ...(runtimeDesignStrategyDigest ? {
            designStrategy: {
                readiness: runtimeDesignStrategyDigest.readiness,
                stageGoal: cleanStrategyText(runtimeDesignStrategyDigest.stageGoal, 240),
                primaryGoal: cleanStrategyText(runtimeDesignStrategyDigest.primaryGoal, 240),
                targetAudienceSummary: cleanStrategyText(runtimeDesignStrategyDigest.targetAudienceSummary, 240),
                primaryMessage: cleanStrategyText(runtimeDesignStrategyDigest.primaryMessage, 320),
                moodKeywords: cleanStrategyList(runtimeDesignStrategyDigest.moodKeywords, 8),
                compositionIntent: cleanStrategyList(runtimeDesignStrategyDigest.compositionIntent, 8),
                contextRefs: cleanStableRefs(runtimeDesignStrategyDigest.contextRefs),
                constraintCount: Math.max(0, Number(runtimeDesignStrategyDigest.constraintCount) || 0),
                assumptionCount: Math.max(0, Number(runtimeDesignStrategyDigest.assumptionCount) || 0),
                missingInputCount: Math.max(0, Number(runtimeDesignStrategyDigest.missingInputCount) || 0)
            }
        } : {}),
        ...(runtimeActionPlanDigest ? {
            actionPlan: {
                readiness: runtimeActionPlanDigest.readiness,
                planGoal: cleanStrategyText(runtimeActionPlanDigest.planGoal, 280),
                strategyStageGoal: cleanStrategyText(runtimeActionPlanDigest.strategyStageGoal, 240),
                stepCount: Math.max(0, Number(runtimeActionPlanDigest.stepCount) || 0),
                stepKinds: cleanStableRefs(runtimeActionPlanDigest.stepKinds, 12),
                rootStepIds: cleanStableRefs(runtimeActionPlanDigest.rootStepIds, 12),
                terminalStepIds: cleanStableRefs(runtimeActionPlanDigest.terminalStepIds, 12),
                parallelGroupCount: Math.max(0, Number(runtimeActionPlanDigest.parallelGroupCount) || 0),
                capabilityRefs: cleanStableRefs(runtimeActionPlanDigest.capabilityRefs, 24),
                missingCapabilityRefs: cleanStableRefs(runtimeActionPlanDigest.missingCapabilityRefs, 24),
                contextRefs: cleanStableRefs(runtimeActionPlanDigest.contextRefs, 12),
                ...(runtimeActionPlanDigest.designDsl ? {
                    designDsl: {
                        compositionIntent: cleanStrategyText(
                            runtimeActionPlanDigest.designDsl.compositionIntent,
                            320
                        ),
                        regionCount: Math.max(0, Number(runtimeActionPlanDigest.designDsl.regionCount) || 0),
                        elementCount: Math.max(0, Number(runtimeActionPlanDigest.designDsl.elementCount) || 0),
                        readingOrder: cleanStableRefs(
                            runtimeActionPlanDigest.designDsl.readingOrder,
                            24
                        )
                    }
                } : {}),
                missingInputCount: Math.max(0, Number(runtimeActionPlanDigest.missingInputCount) || 0),
                resumeReuseCount: Math.max(0, Number(runtimeActionPlanDigest.resumeReuseCount) || 0),
                resumeRedoRequiredCount: Math.max(0, Number(runtimeActionPlanDigest.resumeRedoRequiredCount) || 0)
            }
        } : {}),
        ...(runtimeActionPlanReconciliationDigest ? {
            actionPlanReconciliation: {
                status: runtimeActionPlanReconciliationDigest.status,
                planReadiness: runtimeActionPlanReconciliationDigest.planReadiness,
                stepCount: Math.max(0, Number(runtimeActionPlanReconciliationDigest.stepCount) || 0),
                completedStepIds: cleanStableRefs(
                    runtimeActionPlanReconciliationDigest.completedStepIds,
                    MAX_RUNTIME_ACTION_PLAN_STEPS
                ),
                completedStepDescriptors: Array.isArray(
                    runtimeActionPlanReconciliationDigest.completedStepDescriptors
                )
                    ? runtimeActionPlanReconciliationDigest.completedStepDescriptors
                        .slice(0, MAX_RUNTIME_ACTION_PLAN_STEPS)
                        .map((step) => ({
                            stepId: cleanStrategyText(step.stepId, 48),
                            kind: cleanStrategyText(step.kind, 48),
                            capabilityRefs: cleanStableRefs(step.capabilityRefs, 8),
                            observedOutcomes: cleanStableRefs(step.observedOutcomes, 8)
                        }))
                    : [],
                failedStepIds: cleanStableRefs(
                    runtimeActionPlanReconciliationDigest.failedStepIds,
                    MAX_RUNTIME_ACTION_PLAN_STEPS
                ),
                recoveredStepIds: cleanStableRefs(
                    runtimeActionPlanReconciliationDigest.recoveredStepIds,
                    MAX_RUNTIME_ACTION_PLAN_STEPS
                ),
                resumeStepIds: cleanStableRefs(
                    runtimeActionPlanReconciliationDigest.resumeStepIds,
                    MAX_RUNTIME_ACTION_PLAN_STEPS
                ),
                observationCount: Math.max(0, Number(runtimeActionPlanReconciliationDigest.observationCount) || 0),
                droppedObservationCount: Math.max(0, Number(runtimeActionPlanReconciliationDigest.droppedObservationCount) || 0),
                ambiguousObservationCount: Math.max(0, Number(runtimeActionPlanReconciliationDigest.ambiguousObservationCount) || 0),
                dependencyBlockedObservationCount: Math.max(0, Number(runtimeActionPlanReconciliationDigest.dependencyBlockedObservationCount) || 0),
                unmatchedObservationCount: Math.max(0, Number(runtimeActionPlanReconciliationDigest.unmatchedObservationCount) || 0),
                repeatAfterCompletionCount: Math.max(0, Number(runtimeActionPlanReconciliationDigest.repeatAfterCompletionCount) || 0),
                issueCount: Math.max(0, Number(runtimeActionPlanReconciliationDigest.issueCount) || 0)
            }
        } : {}),
        ...(runtimeActionPlanNoRedoShadowDigest ? {
            actionPlanNoRedoShadow: {
                status: runtimeActionPlanNoRedoShadowDigest.status,
                ...(runtimeActionPlanNoRedoShadowDigest.sourceRunId
                    ? { sourceRunId: cleanStrategyText(runtimeActionPlanNoRedoShadowDigest.sourceRunId, 100) }
                    : {}),
                reuseCandidateStepIds: cleanStableRefs(
                    runtimeActionPlanNoRedoShadowDigest.reuseCandidateStepIds,
                    12
                ),
                repeatObservedStepIds: cleanStableRefs(
                    runtimeActionPlanNoRedoShadowDigest.repeatObservedStepIds,
                    12
                ),
                intentionalRedoStepIds: cleanStableRefs(
                    runtimeActionPlanNoRedoShadowDigest.intentionalRedoStepIds,
                    12
                ),
                intentionalRedoObservedStepIds: cleanStableRefs(
                    runtimeActionPlanNoRedoShadowDigest.intentionalRedoObservedStepIds,
                    12
                ),
                verifiedPriorCompletedStepCount: Math.max(
                    0,
                    Number(runtimeActionPlanNoRedoShadowDigest.verifiedPriorCompletedStepCount) || 0
                ),
                mappingCount: Math.max(0, Number(runtimeActionPlanNoRedoShadowDigest.mappingCount) || 0),
                unmappedVerifiedPriorStepCount: Math.max(
                    0,
                    Number(runtimeActionPlanNoRedoShadowDigest.unmappedVerifiedPriorStepCount) || 0
                )
            }
        } : {}),
        contextAnchor,
        ...(input.resumeFreshness ? { resumeFreshness: input.resumeFreshness } : {}),
        checkpoint: deriveCheckpoint(digestedAll, rawLog),
        boundaries: {
            argsDigestedOnly: true,
            containsRawImages: false,
            neverBlocksTaskResult: true,
            stageStateDigestOnly: true,
            stageTraceDigestOnly: true,
            designBriefDigestOnly: true,
            designStrategyDigestOnly: true,
            actionPlanDigestOnly: true,
            actionPlanReconciliationDigestOnly: true,
            actionPlanNoRedoShadowDigestOnly: true,
            contextAnchorDigestOnly: true,
            resumeFreshnessDigestOnly: true,
            ...(runtimeSessionDigest ? { runtimeSessionDigestOnly: true as const } : {}),
            ...(runtimePlanningContextSeedDigest ? { planningContextCarryDigestOnly: true as const } : {}),
            ...(modelProviderFailureDigest ? { providerFailureDigestOnly: true as const } : {}),
            ...(modelIdentity ? { modelIdentityDigestOnly: true as const } : {}),
            ...(conversationScope ? { conversationScopeIdentityOnly: true as const } : {}),
            ...(runtimeAccountingDigest ? { runtimeAccountingDigestOnly: true as const } : {}),
            ...(runtimeContractStatus ? { runtimeContractStatusDigestOnly: true as const } : {})
        }
    };
}

function hasOwn(value: object, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function findUnknownKey(value: Record<string, unknown>, allowedKeys: ReadonlySet<string>): string | undefined {
    return Object.keys(value).find((key) => !allowedKeys.has(key));
}

/**
 * 把主进程 Repository 的严格只读投影附到运行档案。
 *
 * 本 helper 不读取 result/snapshot，也不接受调用方自行提供的 ref。只有投影与
 * Runtime Session 的 sessionId/runId/generation 完全一致时才返回新记录。
 */
export function attachRepositoryArtifactRefsToRunRecord(
    base: AgentRunRecord,
    projection: ArtifactRepositoryReadProjection | unknown
): AgentRunRecord {
    const baseValidation = validateAgentRunRecordForPersist(base);
    if (!baseValidation.ok) {
        throw new Error(`agent_run_record_base_invalid:${baseValidation.reason || 'unknown'}`);
    }
    if (hasOwn(base, 'artifactRefs')
        || hasOwn(base, 'droppedArtifactRefCount')
        || hasOwn(base.boundaries, 'artifactRefsFromRepositoryOnly')) {
        throw new Error('agent_run_record_artifact_authority_already_present');
    }

    const verifiedProjection = readArtifactRepositoryProjection(projection);
    if (!verifiedProjection) {
        throw new Error('agent_run_record_artifact_projection_invalid');
    }
    const runtimeSession = base.runtimeSession;
    if (!runtimeSession
        || runtimeSession.sessionId !== verifiedProjection.scope.sessionId
        || runtimeSession.runId !== verifiedProjection.scope.runId
        || runtimeSession.generation !== verifiedProjection.scope.generation) {
        throw new Error('agent_run_record_artifact_projection_identity_mismatch');
    }

    return {
        ...base,
        artifactRefs: verifiedProjection.refs.map((ref) => ({ ...ref })),
        droppedArtifactRefCount: verifiedProjection.droppedRefCount,
        boundaries: {
            ...base.boundaries,
            artifactRefsFromRepositoryOnly: true
        }
    };
}

/** 读取历史运行档案时，重新确认其 refs 仍与 Repository 当前严格投影完全一致。 */
export function matchesAgentRunRecordRepositoryProjection(
    record: AgentRunRecord,
    projection: ArtifactRepositoryReadProjection | unknown
): boolean {
    const verifiedProjection = readArtifactRepositoryProjection(projection);
    if (!verifiedProjection || !record.runtimeSession) return false;
    if (record.runtimeSession.sessionId !== verifiedProjection.scope.sessionId
        || record.runtimeSession.runId !== verifiedProjection.scope.runId
        || record.runtimeSession.generation !== verifiedProjection.scope.generation) {
        return false;
    }
    if (record.boundaries.artifactRefsFromRepositoryOnly !== true
        || !Array.isArray(record.artifactRefs)
        || record.artifactRefs.length !== verifiedProjection.refs.length
        || record.droppedArtifactRefCount !== verifiedProjection.droppedRefCount) {
        return false;
    }
    return record.artifactRefs.every((candidate, index) => {
        const ref = readArtifactRef(candidate);
        const repositoryRef = verifiedProjection.refs[index];
        return Boolean(ref && repositoryRef
            && ref.artifactId === repositoryRef.artifactId
            && ref.artifactType === repositoryRef.artifactType
            && ref.contentHash === repositoryRef.contentHash);
    });
}

/** 持久化前的最小合法性校验（handler 侧复用）：非法返回具体原因，不静默吞。 */
export function validateAgentRunRecordForPersist(record: unknown): { ok: boolean; reason?: string } {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
        return { ok: false, reason: '记录不是对象' };
    }
    const unknownRecordKey = findUnknownKey(
        record as Record<string, unknown>,
        AGENT_RUN_RECORD_ALLOWED_KEYS
    );
    if (unknownRecordKey) return { ok: false, reason: `运行档案含未知顶层字段：${unknownRecordKey}` };
    const r = record as Partial<AgentRunRecord>;
    if (!r.boundaries || typeof r.boundaries !== 'object' || Array.isArray(r.boundaries)) {
        return { ok: false, reason: 'boundaries 缺失或不是对象' };
    }
    const unknownBoundaryKey = findUnknownKey(
        r.boundaries as unknown as Record<string, unknown>,
        AGENT_RUN_RECORD_BOUNDARY_ALLOWED_KEYS
    );
    if (unknownBoundaryKey) return { ok: false, reason: `运行档案 boundaries 含未知字段：${unknownBoundaryKey}` };
    if (r.version !== 'agent-run-record/v0') return { ok: false, reason: `版本不符：${String(r.version)}` };
    if (!r.runId || !/^run-[a-z0-9-]+$/i.test(r.runId)) return { ok: false, reason: 'runId 缺失或格式非法' };
    if (!Array.isArray(r.toolCalls)) return { ok: false, reason: 'toolCalls 缺失' };
    if (!r.boundaries?.argsDigestedOnly) return { ok: false, reason: '缺 argsDigestedOnly 边界声明' };
    if (r.quality !== undefined && (
        !r.quality || typeof r.quality !== 'object' || Array.isArray(r.quality)
    )) {
        return { ok: false, reason: 'quality 不是对象' };
    }
    const finalQualityModelProtocol = r.quality?.finalQualityModelProtocol;
    if (finalQualityModelProtocol !== undefined) {
        const normalizedFinalQualityDigest = readFinalQualityModelProtocolDigest(
            finalQualityModelProtocol
        );
        if (!normalizedFinalQualityDigest
            || normalizedFinalQualityDigest.judgeStatus !== finalQualityModelProtocol.judgeStatus
            || normalizedFinalQualityDigest.diagnosisRepairStatus
                !== finalQualityModelProtocol.diagnosisRepairStatus
            || normalizedFinalQualityDigest.diagnosisRepairTargetCount
                !== finalQualityModelProtocol.diagnosisRepairTargetCount
            || normalizedFinalQualityDigest.actionableDiagnosisCount
                !== finalQualityModelProtocol.actionableDiagnosisCount) {
            return { ok: false, reason: 'finalQualityModelProtocol 摘要非法或超出边界' };
        }
    }
    if (r.conversationScope) {
        if (typeof r.conversationScope !== 'object' || Array.isArray(r.conversationScope)) {
            return { ok: false, reason: 'conversationScope 不是对象' };
        }
        const unknownConversationScopeKey = findUnknownKey(
            r.conversationScope as unknown as Record<string, unknown>,
            AGENT_RUN_CONVERSATION_SCOPE_ALLOWED_KEYS
        );
        if (unknownConversationScopeKey) {
            return { ok: false, reason: `conversationScope 含未知字段：${unknownConversationScopeKey}` };
        }
        if (!String(r.conversationScope.conversationId || '').trim()
            || !String(r.conversationScope.branchId || '').trim()) {
            return { ok: false, reason: 'conversationScope 缺少完整会话或分支身份' };
        }
        if (r.boundaries.conversationScopeIdentityOnly !== true) {
            return { ok: false, reason: '存在 conversationScope 但缺 conversationScopeIdentityOnly 边界声明' };
        }
    } else if (r.boundaries.conversationScopeIdentityOnly === true) {
        return { ok: false, reason: '缺少 conversationScope 却声明了 conversationScopeIdentityOnly' };
    }
    const hasRuntimeContractStatus = hasOwn(r, 'runtimeContractStatus');
    const hasRuntimeContractStatusBoundary = hasOwn(
        r.boundaries as AgentRunRecord['boundaries'],
        'runtimeContractStatusDigestOnly'
    );
    if (hasRuntimeContractStatus || hasRuntimeContractStatusBoundary) {
        if (r.boundaries.runtimeContractStatusDigestOnly !== true) {
            return { ok: false, reason: 'Runtime Contract 状态缺 runtimeContractStatusDigestOnly 边界声明' };
        }
        if (!r.runtimeContractStatus
            || typeof r.runtimeContractStatus !== 'object'
            || Array.isArray(r.runtimeContractStatus)) {
            return { ok: false, reason: 'runtimeContractStatus 缺失或不是对象' };
        }
        const unknownRuntimeContractStatusKey = findUnknownKey(
            r.runtimeContractStatus as unknown as Record<string, unknown>,
            RUNTIME_CONTRACT_STATUS_ALLOWED_KEYS
        );
        if (unknownRuntimeContractStatusKey) {
            return {
                ok: false,
                reason: `runtimeContractStatus 含未知字段：${unknownRuntimeContractStatusKey}`
            };
        }
        if (!r.runtimeContractStatus.boundaries
            || typeof r.runtimeContractStatus.boundaries !== 'object'
            || Array.isArray(r.runtimeContractStatus.boundaries)) {
            return { ok: false, reason: 'runtimeContractStatus boundaries 缺失或不是对象' };
        }
        const unknownRuntimeContractBoundaryKey = findUnknownKey(
            r.runtimeContractStatus.boundaries as unknown as Record<string, unknown>,
            RUNTIME_CONTRACT_STATUS_BOUNDARY_ALLOWED_KEYS
        );
        if (unknownRuntimeContractBoundaryKey) {
            return {
                ok: false,
                reason: `runtimeContractStatus boundaries 含未知字段：${unknownRuntimeContractBoundaryKey}`
            };
        }
        if (r.runtimeContractStatus.version !== 'runtime-contract-status/v0'
            || r.runtimeContractStatus.status !== 'resolved'
            || r.runtimeContractStatus.boundaries.doesNotExecuteSkill !== true
            || r.runtimeContractStatus.boundaries.doesNotGrantToolPermission !== true) {
            return { ok: false, reason: 'runtimeContractStatus 版本、状态或权限边界非法' };
        }
        if (r.runtimeContractStatus.selectionSource !== undefined
            && !RUNTIME_CONTRACT_STATUS_SELECTION_SOURCES.has(r.runtimeContractStatus.selectionSource)) {
            return { ok: false, reason: 'runtimeContractStatus selectionSource 非法' };
        }
        const normalizedRuntimeContractStatus = buildResolvedRuntimeContractStatusDigest(
            r.runtimeContractStatus
        );
        if (!normalizedRuntimeContractStatus
            || normalizedRuntimeContractStatus.selectedSkillId !== r.runtimeContractStatus.selectedSkillId
            || normalizedRuntimeContractStatus.selectedTaskType !== r.runtimeContractStatus.selectedTaskType
            || normalizedRuntimeContractStatus.manifestSkillId !== r.runtimeContractStatus.manifestSkillId
            || normalizedRuntimeContractStatus.selectionSource !== r.runtimeContractStatus.selectionSource
            || normalizedRuntimeContractStatus.reason !== r.runtimeContractStatus.reason) {
            return { ok: false, reason: 'runtimeContractStatus 未按共享 Resolver 摘要口径规范化' };
        }
    }
    if (r.runtimeSession && r.boundaries?.runtimeSessionDigestOnly !== true) {
        return { ok: false, reason: '存在 Runtime Session 但缺 runtimeSessionDigestOnly 边界声明' };
    }
    if (r.runtimeSession && r.runtimeSession.version !== 'runtime-session-digest/v0') {
        return { ok: false, reason: 'Runtime Session digest 版本非法' };
    }
    if (r.runtimeSession && r.runtimeSession.runId !== r.runId) {
        return { ok: false, reason: 'Runtime Session runId 与 Run Record 主键不一致' };
    }
    if (r.runtimeSession && (
        typeof r.runtimeSession.sessionId !== 'string'
        || !r.runtimeSession.sessionId.trim()
        || r.runtimeSession.sessionId.length > 160
    )) {
        return { ok: false, reason: 'Runtime Session sessionId 非法' };
    }
    if (r.runtimeSession && r.runtimeSession.parentRunId !== r.parentRunId) {
        return { ok: false, reason: 'Runtime Session parentRunId 与 Run Record 不一致' };
    }
    if (r.runtimeSession && (!Number.isInteger(r.runtimeSession.generation) || r.runtimeSession.generation < 1)) {
        return { ok: false, reason: 'Runtime Session generation 非法' };
    }
    if (r.runtimeSession?.accounting) {
        const accountingValidation = validatePersistedRuntimeAccountingDigest(
            r.runtimeSession.accounting
        );
        if (!accountingValidation.ok) return accountingValidation;
    }
    const hasStandaloneRuntimeAccounting = hasOwn(r, 'runtimeAccounting');
    const hasStandaloneRuntimeAccountingBoundary = hasOwn(
        r.boundaries as AgentRunRecord['boundaries'],
        'runtimeAccountingDigestOnly'
    );
    if (hasStandaloneRuntimeAccounting || hasStandaloneRuntimeAccountingBoundary) {
        if (r.runtimeSession) {
            return { ok: false, reason: 'staged Runtime Session 不得重复持有顶层 runtimeAccounting' };
        }
        if (r.boundaries.runtimeAccountingDigestOnly !== true) {
            return { ok: false, reason: 'runtimeAccounting 缺 runtimeAccountingDigestOnly 边界声明' };
        }
        const accountingValidation = validateRuntimeAccountingDigest(r.runtimeAccounting);
        if (!accountingValidation.ok) return accountingValidation;
    }
    const hasProviderFailure = hasOwn(r, 'providerFailure');
    const hasProviderFailureBoundary = hasOwn(
        r.boundaries as AgentRunRecord['boundaries'],
        'providerFailureDigestOnly'
    );
    if (hasProviderFailure || hasProviderFailureBoundary) {
        if (r.boundaries?.providerFailureDigestOnly !== true) {
            return { ok: false, reason: 'Provider Failure 摘要缺 providerFailureDigestOnly 边界声明' };
        }
        if (!r.providerFailure || typeof r.providerFailure !== 'object' || Array.isArray(r.providerFailure)) {
            return { ok: false, reason: 'providerFailure 缺失或不是对象' };
        }
        const unknownProviderFailureKey = findUnknownKey(
            r.providerFailure as unknown as Record<string, unknown>,
            MODEL_PROVIDER_FAILURE_DIGEST_ALLOWED_KEYS
        );
        if (unknownProviderFailureKey) {
            return { ok: false, reason: `providerFailure 含未知字段：${unknownProviderFailureKey}` };
        }
        if (r.providerFailure.version !== 'model-provider-failure-digest/v0') {
            return { ok: false, reason: 'providerFailure digest 版本非法' };
        }
        if (!MODEL_PROVIDER_FAILURE_KINDS.has(r.providerFailure.kind)) {
            return { ok: false, reason: 'providerFailure kind 非法' };
        }
        if (!MODEL_PROVIDER_FAILURE_BASES.has(r.providerFailure.basis)) {
            return { ok: false, reason: 'providerFailure basis 非法' };
        }
        if (!r.providerFailure.modelId
            || r.providerFailure.modelId.trim() !== r.providerFailure.modelId
            || r.providerFailure.modelId.length > 160) {
            return { ok: false, reason: 'providerFailure modelId 非法' };
        }
        if (r.providerFailure.status !== undefined && (
            !Number.isInteger(r.providerFailure.status)
            || r.providerFailure.status < 100
            || r.providerFailure.status > 599
        )) {
            return { ok: false, reason: 'providerFailure status 非法' };
        }
        if (r.providerFailure.providerCode !== undefined && (
            !r.providerFailure.providerCode
            || r.providerFailure.providerCode.trim() !== r.providerFailure.providerCode
            || r.providerFailure.providerCode.length > 120
        )) {
            return { ok: false, reason: 'providerFailure providerCode 非法' };
        }
        if (!r.providerFailure.diagnostic
            || r.providerFailure.diagnostic.length > 500
            || sanitizeModelProviderDiagnostic(r.providerFailure.diagnostic) !== r.providerFailure.diagnostic) {
            return { ok: false, reason: 'providerFailure diagnostic 未按共享口径脱敏或超限' };
        }
    }
    const hasModelIdentity = hasOwn(r, 'modelIdentity');
    const hasModelIdentityBoundary = hasOwn(
        r.boundaries as AgentRunRecord['boundaries'],
        'modelIdentityDigestOnly'
    );
    if (hasModelIdentity || hasModelIdentityBoundary) {
        if (r.boundaries.modelIdentityDigestOnly !== true) {
            return { ok: false, reason: '模型身份缺 modelIdentityDigestOnly 边界声明' };
        }
        if (!r.modelIdentity || typeof r.modelIdentity !== 'object' || Array.isArray(r.modelIdentity)) {
            return { ok: false, reason: 'modelIdentity 缺失或不是对象' };
        }
        const unknownModelIdentityKey = findUnknownKey(
            r.modelIdentity as unknown as Record<string, unknown>,
            MODEL_IDENTITY_DIGEST_ALLOWED_KEYS
        );
        if (unknownModelIdentityKey) {
            return { ok: false, reason: `modelIdentity 含未知字段：${unknownModelIdentityKey}` };
        }
        if (r.modelIdentity.version !== 'agent-run-model-identity/v0'
            || r.modelIdentity.source !== 'runtime-selected-model') {
            return { ok: false, reason: 'modelIdentity 版本或来源非法' };
        }
        if (!r.modelIdentity.modelId
            || r.modelIdentity.modelId.trim() !== r.modelIdentity.modelId
            || r.modelIdentity.modelId.length > 160
            || !r.modelIdentity.provider
            || r.modelIdentity.provider.trim() !== r.modelIdentity.provider
            || r.modelIdentity.provider.length > 80) {
            return { ok: false, reason: 'modelIdentity 模型或 Provider 非法' };
        }
        if (r.modelIdentity.apiModelId !== undefined && (
            !r.modelIdentity.apiModelId
            || r.modelIdentity.apiModelId.trim() !== r.modelIdentity.apiModelId
            || r.modelIdentity.apiModelId.length > 160
        )) {
            return { ok: false, reason: 'modelIdentity apiModelId 非法' };
        }
    }
    const hasArtifactRefs = hasOwn(r, 'artifactRefs');
    const hasDroppedArtifactRefCount = hasOwn(r, 'droppedArtifactRefCount');
    const hasArtifactBoundary = Boolean(r.boundaries)
        && hasOwn(r.boundaries as AgentRunRecord['boundaries'], 'artifactRefsFromRepositoryOnly');
    if (hasArtifactRefs || hasDroppedArtifactRefCount || hasArtifactBoundary) {
        if (r.boundaries?.artifactRefsFromRepositoryOnly !== true) {
            return { ok: false, reason: 'Artifact refs 缺 artifactRefsFromRepositoryOnly 边界声明' };
        }
        if (!Array.isArray(r.artifactRefs) || r.artifactRefs.length > MAX_ARTIFACT_REFS) {
            return { ok: false, reason: 'artifactRefs 缺失或超过 Repository 上限' };
        }
        if (!Number.isInteger(r.droppedArtifactRefCount) || Number(r.droppedArtifactRefCount) < 0) {
            return { ok: false, reason: 'droppedArtifactRefCount 必须是非负整数' };
        }
        if (r.artifactRefs.some((ref) => !readArtifactRef(ref))) {
            return { ok: false, reason: 'artifactRefs 必须是 Repository 返回的精确三字段引用' };
        }
        if (!r.runtimeSession) {
            return { ok: false, reason: 'Artifact refs 缺少可绑定的 Runtime Session identity' };
        }
    }
    if (r.planningContextCarry && r.boundaries?.planningContextCarryDigestOnly !== true) {
        return { ok: false, reason: '存在 planningContextCarry 但缺 planningContextCarryDigestOnly 边界声明' };
    }
    if (r.planningContextCarry && r.planningContextCarry.version !== 'runtime-planning-context-seed-digest/v0') {
        return { ok: false, reason: 'planningContextCarry digest 版本非法' };
    }
    if (r.planningContextCarry && (
        r.planningContextCarry.targetRunId !== r.runId
        || r.planningContextCarry.sessionId !== r.runtimeSession?.sessionId
        || r.planningContextCarry.targetGeneration !== r.runtimeSession?.generation
    )) {
        return { ok: false, reason: 'planningContextCarry 与 Runtime Session 身份不一致' };
    }
    if (r.planningContextCarry && ('declarations' in r.planningContextCarry || 'payload' in r.planningContextCarry)) {
        return { ok: false, reason: 'planningContextCarry 运行档案只能保存摘要，不能复制完整规划声明' };
    }
    if (r.stageState && r.boundaries?.stageStateDigestOnly !== true) {
        return { ok: false, reason: '存在 stageState 但缺 stageStateDigestOnly 边界声明' };
    }
    if (r.stageState && ('stages' in r.stageState || 'transitions' in r.stageState)) {
        return { ok: false, reason: 'stageState 运行档案只能保存摘要，不能复制完整阶段或 transition ledger' };
    }
    if (r.stageTrace && r.boundaries?.stageTraceDigestOnly !== true) {
        return { ok: false, reason: '存在 stageTrace 但缺 stageTraceDigestOnly 边界声明' };
    }
    if (r.stageTrace && ('events' in r.stageTrace || 'issues' in r.stageTrace)) {
        return { ok: false, reason: 'stageTrace 运行档案只能保存对账摘要，不能复制完整事件或 issue ledger' };
    }
    if (r.designBrief && r.boundaries?.designBriefDigestOnly !== true) {
        return { ok: false, reason: '存在 designBrief 但缺 designBriefDigestOnly 边界声明' };
    }
    if (r.designBrief && ('payload' in r.designBrief || 'inputCoverage' in r.designBrief || 'declaration' in r.designBrief)) {
        return { ok: false, reason: 'designBrief 运行档案只能保存摘要，不能复制完整声明或输入覆盖明细' };
    }
    if (r.designStrategy && r.boundaries?.designStrategyDigestOnly !== true) {
        return { ok: false, reason: '存在 designStrategy 但缺 designStrategyDigestOnly 边界声明' };
    }
    if (r.designStrategy && ('payload' in r.designStrategy || 'declaration' in r.designStrategy || 'meta' in r.designStrategy)) {
        return { ok: false, reason: 'designStrategy 运行档案只能保存摘要，不能复制完整声明或 artifact 元数据' };
    }
    if (r.actionPlan && r.boundaries?.actionPlanDigestOnly !== true) {
        return { ok: false, reason: '存在 actionPlan 但缺 actionPlanDigestOnly 边界声明' };
    }
    if (r.actionPlan && (
        'payload' in r.actionPlan
        || 'declaration' in r.actionPlan
        || 'steps' in r.actionPlan
        || 'graph' in r.actionPlan
    )) {
        return { ok: false, reason: 'actionPlan 运行档案只能保存摘要，不能复制完整步骤、依赖图或声明' };
    }
    if (r.actionPlanReconciliation && r.boundaries?.actionPlanReconciliationDigestOnly !== true) {
        return { ok: false, reason: '存在 actionPlanReconciliation 但缺 digest-only 边界声明' };
    }
    if (r.actionPlanReconciliation && (
        'steps' in r.actionPlanReconciliation
        || 'observations' in r.actionPlanReconciliation
        || 'attributions' in r.actionPlanReconciliation
        || 'issues' in r.actionPlanReconciliation
    )) {
        return { ok: false, reason: 'actionPlanReconciliation 运行档案只能保存摘要，不能复制步骤状态或观察归属 ledger' };
    }
    if (r.actionPlanReconciliation?.completedStepDescriptors?.some((step) => (
        !step || typeof step !== 'object'
        || Object.keys(step).some((key) => ![
            'stepId', 'kind', 'capabilityRefs', 'observedOutcomes'
        ].includes(key))
    ))) {
        return { ok: false, reason: '已完成步骤描述只能保存 stepId、kind、Capability 和 Outcome 摘要' };
    }
    if (r.actionPlanNoRedoShadow && r.boundaries?.actionPlanNoRedoShadowDigestOnly !== true) {
        return { ok: false, reason: '存在 actionPlanNoRedoShadow 但缺 digest-only 边界声明' };
    }
    if (r.actionPlanNoRedoShadow && (
        'mappings' in r.actionPlanNoRedoShadow
        || 'decisions' in r.actionPlanNoRedoShadow
        || 'reconciliation' in r.actionPlanNoRedoShadow
        || 'observations' in r.actionPlanNoRedoShadow
        || 'steps' in r.actionPlanNoRedoShadow
    )) {
        return { ok: false, reason: 'actionPlanNoRedoShadow 运行档案只能保存摘要，不能复制完整映射或观察状态' };
    }
    if (r.contextAnchor && r.boundaries?.contextAnchorDigestOnly !== true) {
        return { ok: false, reason: '存在 contextAnchor 但缺 digest-only 边界声明' };
    }
    if (r.contextAnchor) {
        const serializedAnchor = JSON.stringify(r.contextAnchor);
        if (/"(?:layers|hierarchy|flatList|elements|imageData|toolName|arguments|result|path)"\s*:/.test(serializedAnchor)) {
            return { ok: false, reason: 'contextAnchor 只能保存指纹，不能复制原始层、图片、路径或 Tool 载荷' };
        }
    }
    if (r.resumeFreshness && r.boundaries?.resumeFreshnessDigestOnly !== true) {
        return { ok: false, reason: '存在 resumeFreshness 但缺 digest-only 边界声明' };
    }
    if (r.resumeFreshness) {
        const serializedFreshness = JSON.stringify(r.resumeFreshness);
        if (/"(?:goal|toolName|arguments|result|path|layers|hierarchy|imageData)"\s*:/.test(serializedFreshness)) {
            return { ok: false, reason: 'resumeFreshness 只能保存指纹、节点描述符和裁决摘要，不能复制文本或 Tool 载荷' };
        }
    }
    const serialized = JSON.stringify(record);
    if (serialized.length > 1_500_000) return { ok: false, reason: `记录过大（${serialized.length} 字节），疑似摘要化失效` };
    if (/data:[a-zA-Z0-9/+.-]+;base64,/.test(serialized)) return { ok: false, reason: '检测到图像 data URL，违反 containsRawImages 边界' };
    return { ok: true };
}
