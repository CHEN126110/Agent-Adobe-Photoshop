/**
 * Runtime accounting ledger for one active Agent execution owner.
 *
 * It records measured calls, reported token usage and elapsed time. Missing usage remains explicit;
 * no token count, currency amount or retry is inferred. The ledger observes work only and never
 * grants permission, enforces a budget or changes task/quality results. Before a staged Runtime
 * Session exists, plan-neutral/agentic Agent owns an unscoped ledger of this same type; late binding
 * transfers it into RuntimeSession.accounting and releases the unbound owner.
 */

import { sha256Hex } from './content-hash';
import type { RuntimeStage } from './contracts';
import type { ModelReasoningEffort } from '../config/models.config';
import type { ModelProviderFailureKind } from '../model-provider-failure';
import type { ProviderReportedTokenUsage } from '../provider-reported-token-usage';
import {
    readProviderTransportMetrics,
    type ProviderTransportMetrics
} from '../provider-transport-metrics';

export type RuntimeAccountingStage = RuntimeStage | 'unscoped';

/** 品类中立的模型调用用途；只用于性能归因，不参与路由、预算或结果裁决。 */
export type RuntimeModelCallKind =
    | 'agent_turn'
    | 'provider_output_recovery'
    | 'visual_observation'
    | 'forced_final_response'
    | 'no_tool_replan'
    | 'silent_final_summary'
    | 'richer_final_summary'
    | 'final_quality_judge'
    | 'final_quality_diagnosis_repair';

export type RuntimeModelRequestMode = 'stream' | 'non_stream';
export type RuntimeRequestedThinking = 'enabled' | 'disabled' | 'unspecified';

/**
 * 单次请求中各类消息贡献的字符数。桶名是有限枚举，不保存 source/scope 或正文。
 * 所有桶之和必须与同一样本的 systemChars + historyChars 守恒。
 */
export interface RuntimePromptContextSourceChars {
    system: number;
    currentUser: number;
    assistantResponse: number;
    assistantReasoning: number;
    assistantToolArguments: number;
    toolResults: number;
    harnessControl: number;
    runtimeObservation: number;
    visualObservation: number;
    toolObservation: number;
    unclassified: number;
}

export type RuntimeModelOutputTerminalKind =
    | 'complete'
    | 'tool_calls'
    | 'max_tokens'
    | 'content_blocked'
    | 'stream_incomplete'
    | 'incomplete_tool_calls'
    | 'unknown';

/** 只保存输出体量与有限终态，不保存正文、reasoning、Tool 参数或 Provider 原始状态。 */
export interface RuntimeModelOutputShape {
    contentChars: number;
    reasoningChars: number;
    toolCallCount: number;
    toolArgumentChars: number;
    incompleteToolCallCount: number;
    terminalKind: RuntimeModelOutputTerminalKind;
}

/** ContextManager 压缩前后的纯计数投影；不得携带 messages 或被用于预算执行。 */
export interface RuntimeContextPreparationShape {
    beforeEstimatedTokens: number;
    afterEstimatedTokens: number;
    beforeMessageCount: number;
    afterMessageCount: number;
    reservedTokens: number;
    removedMessageCount: number;
    compacted: boolean;
}

/** 只在一次记录调用内存在；原始观察键与 Photoshop revision 永不进入 ledger/digest。 */
export interface RuntimeModelVisualInput {
    observationKeys?: readonly string[];
    photoshopRevisions?: ReadonlyArray<{
        documentId: number;
        historyStateId: number;
    }>;
}

/** Run-scoped 的视觉输入归因；只证明一次模型请求携带了哪些版本身份。 */
export interface RuntimeModelVisualInputAttribution {
    trackedObservationCount: number;
    observationSetDigest?: string;
    revisionDigests: string[];
    droppedRevisionCount: number;
}

export interface RuntimeAccountingStageBucket {
    stage: RuntimeAccountingStage;
    modelCallCount: number;
    modelFailureCount: number;
    modelDurationMs: number;
    inputTokens: number;
    outputTokens: number;
    unreportedUsageCallCount: number;
    toolCallCount: number;
    toolFailureCount: number;
    toolDurationMs: number;
}

export interface RuntimePerformanceUsage {
    /** 只统计普通 Agent 执行模型池；不含独立 Final Judge 与 transport repair。 */
    modelCalls: number;
    /** 只统计模型发起、会消耗业务 Tool 预算的调用；不含 Harness 质量读回。 */
    toolCalls: number;
    iterations: number;
    /** 可跨 generation 恢复的普通执行视觉候选；不含独立 Final Judge 固定事件。 */
    visionCandidates: number;
    /** 可跨 generation 恢复的普通执行视觉请求；不含独立 Final Judge 固定事件。 */
    visualAnalyses: number;
    /**
     * 只累计各 generation 的 Agent.run 活跃时长；不包含 generation 之间等待用户、
     * 刷新 Project State 或重新授权的墙钟时间。
     */
    activeElapsedMs: number;
    /**
     * 活动 ledger 中保存同一视觉证据的原始去重键；持久化 digest 只保存稳定 SHA-256 投影。
     * 原始键跨主循环与 Reflexion generation 保存普通执行证据身份；终审精确重放
     * 使用独立 generation 内账本，不把固定验收事件回灌成普通执行额度。
     */
    observationKeys: string[];
}

/**
 * 单次模型调用的「提示体量」样本：回答「模型是不是被淹了」要靠数，不靠感觉。
 * 只记字符数与条目数（都是可复算的事实），不记正文；每次运行最多保留 48 条。
 */
export interface RuntimePromptShapeSample {
    seq: number;
    stage: RuntimeAccountingStage;
    callKind?: RuntimeModelCallKind;
    requestMode?: RuntimeModelRequestMode;
    agentIteration?: number;
    runtimeGeneration?: number;
    /** 跨 generation 单调累计的活跃执行时间起点；缺失时保持 unknown。 */
    requestStartedActiveMs?: number;
    /** 同一语义请求内的物理 Provider attempt 序号与总数；必须成对出现。 */
    transportAttemptIndex?: number;
    transportAttemptCount?: number;
    /** Renderer 实际请求值；不宣称 Provider 最终采用了该配置。 */
    requestedThinking?: RuntimeRequestedThinking;
    requestedReasoningEffort?: ModelReasoningEffort;
    requestedMaxTokens?: number;
    /** provider 报告的用量；未报告为 undefined，不估算 */
    inputTokens?: number;
    outputTokens?: number;
    /** Provider 完整报告且与 inputTokens 守恒的缓存命中输入 token；缺失保持 unknown。 */
    cacheHitInputTokens?: number;
    /** Provider 完整报告且与 inputTokens 守恒的缓存未命中输入 token；缺失保持 unknown。 */
    cacheMissInputTokens?: number;
    durationMs: number;
    /** Main-process size/timing facts for the physical Provider attempt, when instrumented. */
    providerTransportMetrics?: ProviderTransportMetrics;
    /** 系统提示字符数（策略 + 原则 + 知识 + 项目状态 + 历史摘要） */
    systemChars: number;
    /** 非系统消息（用户 / 助手 / 工具结果）总字符数 */
    historyChars: number;
    /** historyChars 中由 Provider 原生 reasoning_content 贡献的字符数。 */
    reasoningChars?: number;
    messageCount: number;
    /** 图像块数量（每块按 provider 计费，不算进字符） */
    imageBlocks: number;
    toolCount: number;
    /** 工具 schema JSON 字符数 */
    toolSchemaChars: number;
    contextSourceChars?: RuntimePromptContextSourceChars;
    contextPreparation?: RuntimeContextPreparationShape;
    outputShape?: RuntimeModelOutputShape;
    visualInputAttribution?: RuntimeModelVisualInputAttribution;
}

/** 失败调用的有界结构身份；不允许错误正文、堆栈、请求或响应载荷进入账本。 */
export interface RuntimeModelFailureSample {
    seq: number;
    stage: RuntimeAccountingStage;
    durationMs: number;
    failureKind: ModelProviderFailureKind;
    providerCode?: string;
    status?: number;
}

export type RuntimeProviderOutputRecoveryFailureReason =
    | 'max_tokens'
    | 'stream_incomplete'
    | 'content_blocked'
    | 'request_error';

export interface RuntimeProviderOutputRecoveryFailureCounts {
    max_tokens: number;
    stream_incomplete: number;
    content_blocked: number;
    request_error: number;
}

export interface RuntimeAccountingLedger {
    version: 'runtime-accounting-ledger/v0';
    startedAt: string;
    lastUpdatedAt: string;
    modelCallCount: number;
    modelFailureCount: number;
    modelDurationMs: number;
    inputTokens: number;
    outputTokens: number;
    unreportedUsageCallCount: number;
    toolCallCount: number;
    toolFailureCount: number;
    toolDurationMs: number;
    recoveryAttemptCount: number;
    /** 实际发出的 Provider 输出恢复请求；只用于诊断，不改变预算或任务结果。 */
    providerOutputRecoveryAttemptCount?: number;
    /** 恢复请求得到明确完整终态的次数。 */
    providerOutputRecoverySuccessCount?: number;
    /** 恢复请求仍未得到可交付终态的次数。 */
    providerOutputRecoveryFailureCount?: number;
    providerOutputRecoveryFailureCounts?: RuntimeProviderOutputRecoveryFailureCounts;
    reflexionCount: number;
    /**
     * 同一 Runtime Session 的请求级性能用量。Ledger 仍不自行判定预算；
     * Agent 只把它作为下一 generation 的累计用量真相源。
     */
    performanceUsage: RuntimePerformanceUsage;
    stageBuckets: RuntimeAccountingStageBucket[];
    /** 每次模型调用的提示体量样本（有界）；缺失表示旧账本或未测量。 */
    promptShapeSamples?: RuntimePromptShapeSample[];
    /** 物理失败尝试的结构化样本（有界）；不含正文与堆栈。 */
    modelFailureSamples?: RuntimeModelFailureSample[];
    boundaries: {
        observationOnly: true;
        reportedUsageOnly: true;
        missingUsageNotEstimated: true;
        monetaryCostNotConfigured: true;
        enforcesBudget: false;
        grantsPermission: false;
        changesTaskResult: false;
    };
}

export interface RuntimeAccountingDigest {
    version: 'runtime-accounting-digest/v0';
    modelCallCount: number;
    modelFailureCount: number;
    modelDurationMs: number;
    inputTokens: number;
    outputTokens: number;
    unreportedUsageCallCount: number;
    toolCallCount: number;
    toolFailureCount: number;
    toolDurationMs: number;
    recoveryAttemptCount: number;
    providerOutputRecoveryAttemptCount?: number;
    providerOutputRecoverySuccessCount?: number;
    providerOutputRecoveryFailureCount?: number;
    providerOutputRecoveryFailureCounts?: RuntimeProviderOutputRecoveryFailureCounts;
    reflexionCount: number;
    performanceUsage: RuntimePerformanceUsage;
    wallTimeMs: number;
    stageBuckets: RuntimeAccountingStageBucket[];
    /** 提示体量样本（有界，同 ledger）；诊断「模型是否被淹」用。 */
    promptShapeSamples?: RuntimePromptShapeSample[];
    /** 物理失败尝试的结构化样本（有界，同 ledger）；不含正文与堆栈。 */
    modelFailureSamples?: RuntimeModelFailureSample[];
    costEstimate: {
        status: 'not_configured';
    };
    boundaries: {
        digestOnly: true;
        observationOnly: true;
        reportedUsageOnly: true;
        missingUsageNotEstimated: true;
        enforcesBudget: false;
        grantsPermission: false;
        changesTaskResult: false;
    };
}

/** 深拷贝可持久化摘要；不复制任何消息、Tool 参数或图像内容。 */
export function cloneRuntimeAccountingDigest(
    digest: RuntimeAccountingDigest
): RuntimeAccountingDigest {
    const promptShapeSamples = clonePromptShapeSamples(digest.promptShapeSamples);
    const modelFailureSamples = cloneModelFailureSamples(digest.modelFailureSamples);
    const cloned: RuntimeAccountingDigest = {
        ...digest,
        ...(digest.providerOutputRecoveryFailureCounts
            ? { providerOutputRecoveryFailureCounts: { ...digest.providerOutputRecoveryFailureCounts } }
            : {}),
        performanceUsage: cloneDigestPerformanceUsage(digest.performanceUsage),
        stageBuckets: cloneBuckets(digest.stageBuckets),
        costEstimate: { ...digest.costEstimate },
        boundaries: { ...digest.boundaries }
    };
    if (promptShapeSamples) cloned.promptShapeSamples = promptShapeSamples;
    else delete cloned.promptShapeSamples;
    if (modelFailureSamples) cloned.modelFailureSamples = modelFailureSamples;
    else delete cloned.modelFailureSamples;
    return cloned;
}

const RUNTIME_ACCOUNTING_DIGEST_ALLOWED_KEYS = new Set([
    'version',
    'modelCallCount',
    'modelFailureCount',
    'modelDurationMs',
    'inputTokens',
    'outputTokens',
    'unreportedUsageCallCount',
    'toolCallCount',
    'toolFailureCount',
    'toolDurationMs',
    'recoveryAttemptCount',
    'providerOutputRecoveryAttemptCount',
    'providerOutputRecoverySuccessCount',
    'providerOutputRecoveryFailureCount',
    'providerOutputRecoveryFailureCounts',
    'reflexionCount',
    'performanceUsage',
    'wallTimeMs',
    'stageBuckets',
    'promptShapeSamples',
    'modelFailureSamples',
    'costEstimate',
    'boundaries'
]);

const LEGACY_RUNTIME_ACCOUNTING_DIGEST_ALLOWED_KEYS = new Set([
    'version',
    'modelCallCount',
    'modelFailureCount',
    'modelDurationMs',
    'inputTokens',
    'outputTokens',
    'unreportedUsageCallCount',
    'toolCallCount',
    'toolFailureCount',
    'toolDurationMs',
    'recoveryAttemptCount',
    'reflexionCount',
    'wallTimeMs',
    'stageBuckets',
    'costEstimate',
    'boundaries'
]);

const RUNTIME_ACCOUNTING_PERFORMANCE_USAGE_ALLOWED_KEYS = new Set([
    'modelCalls',
    'toolCalls',
    'iterations',
    'visionCandidates',
    'visualAnalyses',
    'activeElapsedMs',
    'observationKeys'
]);

const RUNTIME_PROVIDER_OUTPUT_RECOVERY_FAILURE_COUNT_KEYS = new Set([
    'max_tokens',
    'stream_incomplete',
    'content_blocked',
    'request_error'
]);

const RUNTIME_ACCOUNTING_STAGE_BUCKET_ALLOWED_KEYS = new Set([
    'stage',
    'modelCallCount',
    'modelFailureCount',
    'modelDurationMs',
    'inputTokens',
    'outputTokens',
    'unreportedUsageCallCount',
    'toolCallCount',
    'toolFailureCount',
    'toolDurationMs'
]);

const RUNTIME_ACCOUNTING_PROMPT_SAMPLE_ALLOWED_KEYS = new Set([
    'seq',
    'stage',
    'callKind',
    'requestMode',
    'agentIteration',
    'runtimeGeneration',
    'requestStartedActiveMs',
    'transportAttemptIndex',
    'transportAttemptCount',
    'requestedThinking',
    'requestedReasoningEffort',
    'requestedMaxTokens',
    'inputTokens',
    'outputTokens',
    'cacheHitInputTokens',
    'cacheMissInputTokens',
    'durationMs',
    'providerTransportMetrics',
    'systemChars',
    'historyChars',
    'reasoningChars',
    'messageCount',
    'imageBlocks',
    'toolCount',
    'toolSchemaChars',
    'contextSourceChars',
    'contextPreparation',
    'outputShape',
    'visualInputAttribution'
]);

const RUNTIME_PROMPT_CONTEXT_SOURCE_CHAR_KEYS = new Set<keyof RuntimePromptContextSourceChars>([
    'system',
    'currentUser',
    'assistantResponse',
    'assistantReasoning',
    'assistantToolArguments',
    'toolResults',
    'harnessControl',
    'runtimeObservation',
    'visualObservation',
    'toolObservation',
    'unclassified'
]);

const RUNTIME_MODEL_OUTPUT_SHAPE_KEYS = new Set<keyof RuntimeModelOutputShape>([
    'contentChars',
    'reasoningChars',
    'toolCallCount',
    'toolArgumentChars',
    'incompleteToolCallCount',
    'terminalKind'
]);

const RUNTIME_CONTEXT_PREPARATION_KEYS = new Set<keyof RuntimeContextPreparationShape>([
    'beforeEstimatedTokens',
    'afterEstimatedTokens',
    'beforeMessageCount',
    'afterMessageCount',
    'reservedTokens',
    'removedMessageCount',
    'compacted'
]);

const RUNTIME_MODEL_VISUAL_INPUT_ATTRIBUTION_KEYS = new Set<keyof RuntimeModelVisualInputAttribution>([
    'trackedObservationCount',
    'observationSetDigest',
    'revisionDigests',
    'droppedRevisionCount'
]);

const RUNTIME_ACCOUNTING_MODEL_FAILURE_SAMPLE_ALLOWED_KEYS = new Set([
    'seq',
    'stage',
    'durationMs',
    'failureKind',
    'providerCode',
    'status'
]);

const RUNTIME_ACCOUNTING_BOUNDARY_ALLOWED_KEYS = new Set([
    'digestOnly',
    'observationOnly',
    'reportedUsageOnly',
    'missingUsageNotEstimated',
    'enforcesBudget',
    'grantsPermission',
    'changesTaskResult'
]);

const RUNTIME_ACCOUNTING_STAGE_VALUES = new Set<RuntimeAccountingStage>([
    'R0', 'R1', 'R2', 'R3', 'R4', 'E1', 'R5', 'E2', 'unscoped'
]);

const RUNTIME_MODEL_CALL_KINDS = new Set<RuntimeModelCallKind>([
    'agent_turn',
    'provider_output_recovery',
    'visual_observation',
    'forced_final_response',
    'no_tool_replan',
    'silent_final_summary',
    'richer_final_summary',
    'final_quality_judge',
    'final_quality_diagnosis_repair'
]);

const RUNTIME_MODEL_REQUEST_MODES = new Set<RuntimeModelRequestMode>(['stream', 'non_stream']);
const RUNTIME_REQUESTED_THINKING_VALUES = new Set<RuntimeRequestedThinking>([
    'enabled',
    'disabled',
    'unspecified'
]);
const RUNTIME_REASONING_EFFORT_VALUES = new Set<ModelReasoningEffort>([
    'low', 'medium', 'high', 'xhigh', 'max', 'ultra'
]);
const RUNTIME_MODEL_OUTPUT_TERMINAL_KINDS = new Set<RuntimeModelOutputTerminalKind>([
    'complete',
    'tool_calls',
    'max_tokens',
    'content_blocked',
    'stream_incomplete',
    'incomplete_tool_calls',
    'unknown'
]);

const MAX_RUNTIME_MODEL_VISUAL_OBSERVATION_KEYS = 128;
const MAX_RUNTIME_MODEL_VISUAL_REVISION_DIGESTS = 4;
const RUNTIME_MODEL_VISUAL_OBSERVATION_SET_DIGEST_PREFIX =
    'runtime-visual-observation-set-sha256-v1:';
const RUNTIME_MODEL_VISUAL_REVISION_DIGEST_PREFIX =
    'runtime-photoshop-revision-sha256-v1:';
const RUNTIME_MODEL_VISUAL_OBSERVATION_SET_DIGEST_PATTERN =
    /^runtime-visual-observation-set-sha256-v1:[0-9a-f]{64}$/;
const RUNTIME_MODEL_VISUAL_REVISION_DIGEST_PATTERN =
    /^runtime-photoshop-revision-sha256-v1:[0-9a-f]{64}$/;

const RUNTIME_MODEL_FAILURE_KINDS = new Set<ModelProviderFailureKind>([
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

function findUnknownAccountingKey(
    value: Record<string, unknown>,
    allowedKeys: ReadonlySet<string>
): string | undefined {
    return Object.keys(value).find((key) => !allowedKeys.has(key));
}

function isNonNegativeSafeInteger(value: unknown): boolean {
    return Number.isSafeInteger(value) && Number(value) >= 0;
}

/** 持久化边界使用的严格摘要校验；不接受正文、Tool 参数、图像或未知诊断字段。 */
export function validateRuntimeAccountingDigest(
    value: unknown
): { ok: boolean; reason?: string } {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { ok: false, reason: 'Runtime accounting 不是对象' };
    }
    const digest = value as Record<string, unknown>;
    const unknownKey = findUnknownAccountingKey(digest, RUNTIME_ACCOUNTING_DIGEST_ALLOWED_KEYS);
    if (unknownKey) return { ok: false, reason: `Runtime accounting 含未知字段：${unknownKey}` };
    if (digest.version !== 'runtime-accounting-digest/v0') {
        return { ok: false, reason: 'Runtime accounting digest 版本非法' };
    }
    const numericKeys = [
        'modelCallCount',
        'modelFailureCount',
        'modelDurationMs',
        'inputTokens',
        'outputTokens',
        'unreportedUsageCallCount',
        'toolCallCount',
        'toolFailureCount',
        'toolDurationMs',
        'recoveryAttemptCount',
        'reflexionCount',
        'wallTimeMs'
    ];
    if (numericKeys.some((key) => !isNonNegativeSafeInteger(digest[key]))) {
        return { ok: false, reason: 'Runtime accounting 含非法计数或耗时' };
    }
    const providerRecoveryNumericKeys = [
        'providerOutputRecoveryAttemptCount',
        'providerOutputRecoverySuccessCount',
        'providerOutputRecoveryFailureCount'
    ];
    if (providerRecoveryNumericKeys.some((key) => (
        digest[key] !== undefined && !isNonNegativeSafeInteger(digest[key])
    ))) {
        return { ok: false, reason: 'Runtime accounting Provider 输出恢复计数非法' };
    }
    const providerRecoveryAttempts = Number(digest.providerOutputRecoveryAttemptCount || 0);
    const providerRecoverySuccesses = Number(digest.providerOutputRecoverySuccessCount || 0);
    const providerRecoveryFailures = Number(digest.providerOutputRecoveryFailureCount || 0);
    if (providerRecoveryAttempts > Number(digest.recoveryAttemptCount)) {
        return { ok: false, reason: 'Runtime accounting Provider 输出恢复次数超过总恢复次数' };
    }
    if (providerRecoverySuccesses + providerRecoveryFailures !== providerRecoveryAttempts) {
        return { ok: false, reason: 'Runtime accounting Provider 输出恢复请求与结果未闭合' };
    }
    if (providerRecoveryFailures > 0
        && digest.providerOutputRecoveryFailureCounts === undefined) {
        return { ok: false, reason: 'Runtime accounting Provider 输出恢复失败缺少分类计数' };
    }
    if (digest.providerOutputRecoveryFailureCounts !== undefined) {
        if (!digest.providerOutputRecoveryFailureCounts
            || typeof digest.providerOutputRecoveryFailureCounts !== 'object'
            || Array.isArray(digest.providerOutputRecoveryFailureCounts)) {
            return { ok: false, reason: 'Runtime accounting Provider 输出恢复失败分类非法' };
        }
        const failureCounts = digest.providerOutputRecoveryFailureCounts as Record<string, unknown>;
        const unknownFailureKey = findUnknownAccountingKey(
            failureCounts,
            RUNTIME_PROVIDER_OUTPUT_RECOVERY_FAILURE_COUNT_KEYS
        );
        if (unknownFailureKey) {
            return {
                ok: false,
                reason: `Runtime accounting Provider 输出恢复失败分类含未知字段：${unknownFailureKey}`
            };
        }
        if ([...RUNTIME_PROVIDER_OUTPUT_RECOVERY_FAILURE_COUNT_KEYS]
            .some((key) => !isNonNegativeSafeInteger(failureCounts[key]))) {
            return { ok: false, reason: 'Runtime accounting Provider 输出恢复失败分类计数非法' };
        }
        const classifiedFailureCount = [...RUNTIME_PROVIDER_OUTPUT_RECOVERY_FAILURE_COUNT_KEYS]
            .reduce((sum, key) => sum + Number(failureCounts[key]), 0);
        if (classifiedFailureCount !== providerRecoveryFailures) {
            return { ok: false, reason: 'Runtime accounting Provider 输出恢复失败分类与总数不一致' };
        }
    }

    if (!digest.performanceUsage
        || typeof digest.performanceUsage !== 'object'
        || Array.isArray(digest.performanceUsage)) {
        return { ok: false, reason: 'Runtime accounting performanceUsage 非法' };
    }
    const performanceUsage = digest.performanceUsage as Record<string, unknown>;
    const unknownPerformanceUsageKey = findUnknownAccountingKey(
        performanceUsage,
        RUNTIME_ACCOUNTING_PERFORMANCE_USAGE_ALLOWED_KEYS
    );
    if (unknownPerformanceUsageKey) {
        return {
            ok: false,
            reason: `Runtime accounting performanceUsage 含未知字段：${unknownPerformanceUsageKey}`
        };
    }
    if (['modelCalls', 'toolCalls', 'iterations', 'visionCandidates', 'visualAnalyses', 'activeElapsedMs']
        .some((key) => !isNonNegativeSafeInteger(performanceUsage[key]))) {
        return { ok: false, reason: 'Runtime accounting performanceUsage 含非法计数' };
    }
    if (!Array.isArray(performanceUsage.observationKeys)
        || performanceUsage.observationKeys.length > MAX_RUNTIME_PERFORMANCE_OBSERVATION_KEYS
        || performanceUsage.observationKeys.some((key) => (
            typeof key !== 'string' || !RUNTIME_OBSERVATION_KEY_DIGEST_PATTERN.test(key)
        ))) {
        return { ok: false, reason: 'Runtime accounting observationKeys 不是稳定摘要' };
    }

    if (!Array.isArray(digest.stageBuckets) || digest.stageBuckets.length > 16) {
        return { ok: false, reason: 'Runtime accounting stageBuckets 非法' };
    }
    for (const bucketValue of digest.stageBuckets) {
        if (!bucketValue || typeof bucketValue !== 'object' || Array.isArray(bucketValue)) {
            return { ok: false, reason: 'Runtime accounting stage bucket 不是对象' };
        }
        const bucket = bucketValue as Record<string, unknown>;
        const unknownBucketKey = findUnknownAccountingKey(
            bucket,
            RUNTIME_ACCOUNTING_STAGE_BUCKET_ALLOWED_KEYS
        );
        if (unknownBucketKey) {
            return { ok: false, reason: `Runtime accounting stage bucket 含未知字段：${unknownBucketKey}` };
        }
        if (!RUNTIME_ACCOUNTING_STAGE_VALUES.has(String(bucket.stage || '') as RuntimeAccountingStage)) {
            return { ok: false, reason: 'Runtime accounting stage bucket 的 stage 非法' };
        }
        if ([
            'modelCallCount',
            'modelFailureCount',
            'modelDurationMs',
            'inputTokens',
            'outputTokens',
            'unreportedUsageCallCount',
            'toolCallCount',
            'toolFailureCount',
            'toolDurationMs'
        ].some((key) => !isNonNegativeSafeInteger(bucket[key]))) {
            return { ok: false, reason: 'Runtime accounting stage bucket 含非法计数或耗时' };
        }
    }

    if (digest.promptShapeSamples !== undefined) {
        if (!Array.isArray(digest.promptShapeSamples)
            || digest.promptShapeSamples.length > MAX_PROMPT_SHAPE_SAMPLES) {
            return { ok: false, reason: 'Runtime accounting promptShapeSamples 非法' };
        }
        for (const sampleValue of digest.promptShapeSamples) {
            if (!sampleValue || typeof sampleValue !== 'object' || Array.isArray(sampleValue)) {
                return { ok: false, reason: 'Runtime accounting prompt sample 不是对象' };
            }
            const sample = sampleValue as Record<string, unknown>;
            const unknownSampleKey = findUnknownAccountingKey(
                sample,
                RUNTIME_ACCOUNTING_PROMPT_SAMPLE_ALLOWED_KEYS
            );
            if (unknownSampleKey) {
                return { ok: false, reason: `Runtime accounting prompt sample 含未知字段：${unknownSampleKey}` };
            }
            if (!RUNTIME_ACCOUNTING_STAGE_VALUES.has(String(sample.stage || '') as RuntimeAccountingStage)) {
                return { ok: false, reason: 'Runtime accounting prompt sample 的 stage 非法' };
            }
            if (sample.callKind !== undefined
                && !RUNTIME_MODEL_CALL_KINDS.has(sample.callKind as RuntimeModelCallKind)) {
                return { ok: false, reason: 'Runtime accounting prompt sample 的 callKind 非法' };
            }
            if (sample.requestMode !== undefined
                && !RUNTIME_MODEL_REQUEST_MODES.has(sample.requestMode as RuntimeModelRequestMode)) {
                return { ok: false, reason: 'Runtime accounting prompt sample 的 requestMode 非法' };
            }
            if (sample.agentIteration !== undefined
                && !isNonNegativeSafeInteger(sample.agentIteration)) {
                return { ok: false, reason: 'Runtime accounting prompt sample 的 Agent iteration 非法' };
            }
            if (sample.runtimeGeneration !== undefined
                && !isNonNegativeSafeInteger(sample.runtimeGeneration)) {
                return { ok: false, reason: 'Runtime accounting prompt sample 的 Runtime generation 非法' };
            }
            if (sample.requestStartedActiveMs !== undefined
                && !isNonNegativeSafeInteger(sample.requestStartedActiveMs)) {
                return { ok: false, reason: 'Runtime accounting prompt sample 的请求起点非法' };
            }
            const hasAttemptIndex = sample.transportAttemptIndex !== undefined;
            const hasAttemptCount = sample.transportAttemptCount !== undefined;
            if (hasAttemptIndex !== hasAttemptCount
                || (hasAttemptIndex && (
                    !Number.isSafeInteger(sample.transportAttemptIndex)
                    || !Number.isSafeInteger(sample.transportAttemptCount)
                    || Number(sample.transportAttemptIndex) < 1
                    || Number(sample.transportAttemptCount) < 1
                    || Number(sample.transportAttemptIndex) > Number(sample.transportAttemptCount)
                    || Number(sample.transportAttemptCount) > 4
                ))) {
                return { ok: false, reason: 'Runtime accounting prompt sample 的 transport attempt 身份非法' };
            }
            if (sample.requestedThinking !== undefined
                && !RUNTIME_REQUESTED_THINKING_VALUES.has(
                    sample.requestedThinking as RuntimeRequestedThinking
                )) {
                return { ok: false, reason: 'Runtime accounting prompt sample 的 thinking 请求非法' };
            }
            if (sample.requestedReasoningEffort !== undefined
                && !RUNTIME_REASONING_EFFORT_VALUES.has(
                    sample.requestedReasoningEffort as ModelReasoningEffort
                )) {
                return { ok: false, reason: 'Runtime accounting prompt sample 的 reasoning effort 非法' };
            }
            if (sample.requestedMaxTokens !== undefined
                && !isNonNegativeSafeInteger(sample.requestedMaxTokens)) {
                return { ok: false, reason: 'Runtime accounting prompt sample 的 max tokens 非法' };
            }
            if ([
                'seq',
                'durationMs',
                'systemChars',
                'historyChars',
                'messageCount',
                'imageBlocks',
                'toolCount',
                'toolSchemaChars'
            ].some((key) => !isNonNegativeSafeInteger(sample[key]))) {
                return { ok: false, reason: 'Runtime accounting prompt sample 含非法计数或耗时' };
            }
            if (sample.reasoningChars !== undefined
                && !isNonNegativeSafeInteger(sample.reasoningChars)) {
                return { ok: false, reason: 'Runtime accounting prompt reasoningChars 非法' };
            }
            if (sample.inputTokens !== undefined && !isNonNegativeSafeInteger(sample.inputTokens)) {
                return { ok: false, reason: 'Runtime accounting prompt sample inputTokens 非法' };
            }
            if (sample.outputTokens !== undefined && !isNonNegativeSafeInteger(sample.outputTokens)) {
                return { ok: false, reason: 'Runtime accounting prompt sample outputTokens 非法' };
            }
            const hasCacheHit = sample.cacheHitInputTokens !== undefined;
            const hasCacheMiss = sample.cacheMissInputTokens !== undefined;
            if (hasCacheHit !== hasCacheMiss) {
                return { ok: false, reason: 'Runtime accounting prompt cache usage 必须成对存在' };
            }
            if (hasCacheHit && (
                !isNonNegativeSafeInteger(sample.cacheHitInputTokens)
                || !isNonNegativeSafeInteger(sample.cacheMissInputTokens)
                || !isNonNegativeSafeInteger(sample.inputTokens)
                || Number(sample.cacheHitInputTokens) + Number(sample.cacheMissInputTokens) !== Number(sample.inputTokens)
            )) {
                return { ok: false, reason: 'Runtime accounting prompt cache usage 非法或与 inputTokens 不守恒' };
            }
            if (sample.providerTransportMetrics !== undefined
                && !readProviderTransportMetrics(sample.providerTransportMetrics)) {
                return { ok: false, reason: 'Runtime accounting Provider transport 指标非法' };
            }
            if (sample.contextSourceChars !== undefined) {
                if (!sample.contextSourceChars
                    || typeof sample.contextSourceChars !== 'object'
                    || Array.isArray(sample.contextSourceChars)) {
                    return { ok: false, reason: 'Runtime accounting prompt context buckets 非法' };
                }
                const contextSourceChars = sample.contextSourceChars as Record<string, unknown>;
                const unknownContextKey = findUnknownAccountingKey(
                    contextSourceChars,
                    RUNTIME_PROMPT_CONTEXT_SOURCE_CHAR_KEYS
                );
                if (unknownContextKey
                    || [...RUNTIME_PROMPT_CONTEXT_SOURCE_CHAR_KEYS].some((key) => (
                        !isNonNegativeSafeInteger(contextSourceChars[key])
                    ))) {
                    return { ok: false, reason: 'Runtime accounting prompt context buckets 含非法字段' };
                }
                const contextChars = [...RUNTIME_PROMPT_CONTEXT_SOURCE_CHAR_KEYS]
                    .reduce((sum, key) => sum + Number(contextSourceChars[key]), 0);
                if (contextChars !== Number(sample.systemChars) + Number(sample.historyChars)) {
                    return { ok: false, reason: 'Runtime accounting prompt context buckets 与总字符数不守恒' };
                }
            }
            if (sample.contextPreparation !== undefined) {
                if (!sample.contextPreparation
                    || typeof sample.contextPreparation !== 'object'
                    || Array.isArray(sample.contextPreparation)) {
                    return { ok: false, reason: 'Runtime accounting context preparation 非法' };
                }
                const contextPreparation = sample.contextPreparation as Record<string, unknown>;
                const unknownPreparationKey = findUnknownAccountingKey(
                    contextPreparation,
                    RUNTIME_CONTEXT_PREPARATION_KEYS
                );
                if (unknownPreparationKey
                    || [
                        'beforeEstimatedTokens',
                        'afterEstimatedTokens',
                        'beforeMessageCount',
                        'afterMessageCount',
                        'reservedTokens',
                        'removedMessageCount'
                    ].some((key) => !isNonNegativeSafeInteger(contextPreparation[key]))
                    || typeof contextPreparation.compacted !== 'boolean'
                    || Number(contextPreparation.afterEstimatedTokens)
                        > Number(contextPreparation.beforeEstimatedTokens)
                    || Number(contextPreparation.afterMessageCount)
                        > Number(contextPreparation.beforeMessageCount)
                    || Number(contextPreparation.removedMessageCount)
                        !== Number(contextPreparation.beforeMessageCount)
                            - Number(contextPreparation.afterMessageCount)) {
                    return { ok: false, reason: 'Runtime accounting context preparation 含非法字段' };
                }
            }
            if (sample.outputShape !== undefined) {
                if (!sample.outputShape
                    || typeof sample.outputShape !== 'object'
                    || Array.isArray(sample.outputShape)) {
                    return { ok: false, reason: 'Runtime accounting model output shape 非法' };
                }
                const outputShape = sample.outputShape as Record<string, unknown>;
                const unknownOutputKey = findUnknownAccountingKey(
                    outputShape,
                    RUNTIME_MODEL_OUTPUT_SHAPE_KEYS
                );
                if (unknownOutputKey
                    || [
                        'contentChars',
                        'reasoningChars',
                        'toolCallCount',
                        'toolArgumentChars',
                        'incompleteToolCallCount'
                    ].some((key) => !isNonNegativeSafeInteger(outputShape[key]))
                    || !RUNTIME_MODEL_OUTPUT_TERMINAL_KINDS.has(
                        outputShape.terminalKind as RuntimeModelOutputTerminalKind
                    )) {
                    return { ok: false, reason: 'Runtime accounting model output shape 含非法字段' };
                }
            }
            if (sample.visualInputAttribution !== undefined) {
                if (!sample.visualInputAttribution
                    || typeof sample.visualInputAttribution !== 'object'
                    || Array.isArray(sample.visualInputAttribution)) {
                    return { ok: false, reason: 'Runtime accounting visual input attribution 非法' };
                }
                const visualInputAttribution = sample.visualInputAttribution as Record<string, unknown>;
                const unknownVisualInputKey = findUnknownAccountingKey(
                    visualInputAttribution,
                    RUNTIME_MODEL_VISUAL_INPUT_ATTRIBUTION_KEYS
                );
                if (unknownVisualInputKey
                    || !isNonNegativeSafeInteger(visualInputAttribution.trackedObservationCount)
                    || Number(visualInputAttribution.trackedObservationCount)
                        > MAX_RUNTIME_MODEL_VISUAL_OBSERVATION_KEYS
                    || !isNonNegativeSafeInteger(visualInputAttribution.droppedRevisionCount)
                    || !Array.isArray(visualInputAttribution.revisionDigests)
                    || visualInputAttribution.revisionDigests.length
                        > MAX_RUNTIME_MODEL_VISUAL_REVISION_DIGESTS
                    || visualInputAttribution.revisionDigests.some((digest) => (
                        typeof digest !== 'string'
                        || !RUNTIME_MODEL_VISUAL_REVISION_DIGEST_PATTERN.test(digest)
                    ))
                    || new Set(visualInputAttribution.revisionDigests).size
                        !== visualInputAttribution.revisionDigests.length
                    || (Number(visualInputAttribution.droppedRevisionCount) > 0
                        && visualInputAttribution.revisionDigests.length
                            !== MAX_RUNTIME_MODEL_VISUAL_REVISION_DIGESTS)) {
                    return { ok: false, reason: 'Runtime accounting visual input attribution 含非法字段' };
                }
                const trackedObservationCount = Number(
                    visualInputAttribution.trackedObservationCount
                );
                if ((trackedObservationCount === 0
                    && visualInputAttribution.observationSetDigest !== undefined)
                    || (trackedObservationCount > 0
                        && (typeof visualInputAttribution.observationSetDigest !== 'string'
                            || !RUNTIME_MODEL_VISUAL_OBSERVATION_SET_DIGEST_PATTERN.test(
                                visualInputAttribution.observationSetDigest
                            )))) {
                    return { ok: false, reason: 'Runtime accounting visual observation set digest 非法' };
                }
            }
        }
    }

    if (digest.modelFailureSamples !== undefined) {
        if (!Array.isArray(digest.modelFailureSamples)
            || digest.modelFailureSamples.length > MAX_MODEL_FAILURE_SAMPLES) {
            return { ok: false, reason: 'Runtime accounting modelFailureSamples 非法' };
        }
        for (const sampleValue of digest.modelFailureSamples) {
            if (!sampleValue || typeof sampleValue !== 'object' || Array.isArray(sampleValue)) {
                return { ok: false, reason: 'Runtime accounting model failure sample 不是对象' };
            }
            const sample = sampleValue as Record<string, unknown>;
            const unknownSampleKey = findUnknownAccountingKey(
                sample,
                RUNTIME_ACCOUNTING_MODEL_FAILURE_SAMPLE_ALLOWED_KEYS
            );
            if (unknownSampleKey) {
                return {
                    ok: false,
                    reason: `Runtime accounting model failure sample 含未知字段：${unknownSampleKey}`
                };
            }
            if (!isNonNegativeSafeInteger(sample.seq)
                || !isNonNegativeSafeInteger(sample.durationMs)
                || !RUNTIME_ACCOUNTING_STAGE_VALUES.has(
                    String(sample.stage || '') as RuntimeAccountingStage
                )
                || !RUNTIME_MODEL_FAILURE_KINDS.has(
                    String(sample.failureKind || '') as ModelProviderFailureKind
                )) {
                return { ok: false, reason: 'Runtime accounting model failure sample 身份非法' };
            }
            if (sample.providerCode !== undefined
                && (typeof sample.providerCode !== 'string'
                    || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(sample.providerCode))) {
                return { ok: false, reason: 'Runtime accounting model failure providerCode 非法' };
            }
            if (sample.status !== undefined
                && (!Number.isInteger(sample.status)
                    || Number(sample.status) < 100
                    || Number(sample.status) > 599)) {
                return { ok: false, reason: 'Runtime accounting model failure status 非法' };
            }
        }
    }

    if (!digest.costEstimate
        || typeof digest.costEstimate !== 'object'
        || Array.isArray(digest.costEstimate)
        || Object.keys(digest.costEstimate as Record<string, unknown>).length !== 1
        || (digest.costEstimate as Record<string, unknown>).status !== 'not_configured') {
        return { ok: false, reason: 'Runtime accounting costEstimate 非法' };
    }
    if (!digest.boundaries || typeof digest.boundaries !== 'object' || Array.isArray(digest.boundaries)) {
        return { ok: false, reason: 'Runtime accounting boundaries 非法' };
    }
    const boundaries = digest.boundaries as Record<string, unknown>;
    const unknownBoundaryKey = findUnknownAccountingKey(
        boundaries,
        RUNTIME_ACCOUNTING_BOUNDARY_ALLOWED_KEYS
    );
    if (unknownBoundaryKey) {
        return { ok: false, reason: `Runtime accounting boundaries 含未知字段：${unknownBoundaryKey}` };
    }
    if (boundaries.digestOnly !== true
        || boundaries.observationOnly !== true
        || boundaries.reportedUsageOnly !== true
        || boundaries.missingUsageNotEstimated !== true
        || boundaries.enforcesBudget !== false
        || boundaries.grantsPermission !== false
        || boundaries.changesTaskResult !== false) {
        return { ok: false, reason: 'Runtime accounting 真实性边界非法' };
    }
    return { ok: true };
}

/**
 * Runtime Session 历史档案兼容校验。
 *
 * 早期 v0 摘要尚无 performanceUsage；该形态已真实存在于用户历史会话中。只接受当时
 * 已知的精确字段集合，并通过补零的验证投影复用当前真实性/数值/边界校验。补零仅用于
 * 校验，不会回写历史文件，也不把缺失遥测伪装成已采集数据。
 */
export function validatePersistedRuntimeAccountingDigest(
    value: unknown
): { ok: boolean; reason?: string } {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { ok: false, reason: 'Runtime accounting 不是对象' };
    }
    const digest = value as Record<string, unknown>;
    if (digest.performanceUsage !== undefined) {
        return validateRuntimeAccountingDigest(value);
    }
    const unknownLegacyKey = findUnknownAccountingKey(
        digest,
        LEGACY_RUNTIME_ACCOUNTING_DIGEST_ALLOWED_KEYS
    );
    if (unknownLegacyKey) {
        return {
            ok: false,
            reason: `历史 Runtime accounting 含未知字段：${unknownLegacyKey}`
        };
    }
    return validateRuntimeAccountingDigest({
        ...digest,
        performanceUsage: {
            modelCalls: 0,
            toolCalls: 0,
            iterations: 0,
            visionCandidates: 0,
            visualAnalyses: 0,
            activeElapsedMs: 0,
            observationKeys: []
        }
    });
}

function nonNegativeInteger(value: unknown): number {
    return Number.isFinite(value) ? Math.max(0, Math.floor(Number(value))) : 0;
}

function normalizeStage(stage: RuntimeStage | undefined): RuntimeAccountingStage {
    return stage || 'unscoped';
}

function cloneBuckets(values: readonly RuntimeAccountingStageBucket[]): RuntimeAccountingStageBucket[] {
    return values.map((bucket) => ({ ...bucket }));
}

function clonePromptShapeSamples(
    values: readonly RuntimePromptShapeSample[] | undefined
): RuntimePromptShapeSample[] | undefined {
    if (!Array.isArray(values) || values.length === 0) return undefined;
    return values.map((sample) => ({
        ...sample,
        ...(sample.contextSourceChars
            ? { contextSourceChars: { ...sample.contextSourceChars } }
            : {}),
        ...(sample.contextPreparation
            ? { contextPreparation: { ...sample.contextPreparation } }
            : {}),
        ...(sample.outputShape ? { outputShape: { ...sample.outputShape } } : {}),
        ...(sample.visualInputAttribution
            ? {
                visualInputAttribution: {
                    ...sample.visualInputAttribution,
                    revisionDigests: [...sample.visualInputAttribution.revisionDigests]
                }
            }
            : {}),
        ...(sample.providerTransportMetrics
            ? { providerTransportMetrics: { ...sample.providerTransportMetrics } }
            : {})
    }));
}

function cloneModelFailureSamples(
    values: readonly RuntimeModelFailureSample[] | undefined
): RuntimeModelFailureSample[] | undefined {
    if (!Array.isArray(values) || values.length === 0) return undefined;
    return values.map((sample) => ({ ...sample }));
}

function normalizeProviderFailureCode(value: unknown): string | undefined {
    const code = String(value || '').trim().slice(0, 120);
    return /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(code) ? code : undefined;
}

function normalizeProviderFailureStatus(value: unknown): number | undefined {
    const status = Number(value);
    return Number.isInteger(status) && status >= 100 && status <= 599
        ? status
        : undefined;
}

const MAX_RUNTIME_PERFORMANCE_OBSERVATION_KEYS = 128;
const RUNTIME_OBSERVATION_KEY_DIGEST_PREFIX = 'runtime-observation-sha256-v1:';
const RUNTIME_OBSERVATION_KEY_DIGEST_PATTERN = /^runtime-observation-sha256-v1:[0-9a-f]{64}$/;

function clonePerformanceUsage(value?: Partial<RuntimePerformanceUsage>): RuntimePerformanceUsage {
    const observationKeys = Array.from(new Set(
        (value?.observationKeys || []).map((key) => String(key || '').trim()).filter(Boolean)
    )).slice(-MAX_RUNTIME_PERFORMANCE_OBSERVATION_KEYS);
    return {
        modelCalls: nonNegativeInteger(value?.modelCalls),
        toolCalls: nonNegativeInteger(value?.toolCalls),
        iterations: nonNegativeInteger(value?.iterations),
        visionCandidates: Math.max(
            nonNegativeInteger(value?.visionCandidates),
            observationKeys.length
        ),
        visualAnalyses: nonNegativeInteger(value?.visualAnalyses),
        activeElapsedMs: nonNegativeInteger(value?.activeElapsedMs),
        observationKeys
    };
}

/**
 * 只在持久化边界将活动 ledger 的原始视觉去重键投影为稳定摘要。
 * 活动 ledger 与 PerformanceLedger 继续持有原键，避免改变去重、预算或恢复语义。
 */
function projectPerformanceUsageForDigest(
    value?: Partial<RuntimePerformanceUsage>
): RuntimePerformanceUsage {
    const usage = clonePerformanceUsage(value);
    const observationKeys = Array.from(new Set(
        usage.observationKeys.map((key) => (
            `${RUNTIME_OBSERVATION_KEY_DIGEST_PREFIX}${sha256Hex(key)}`
        ))
    )).slice(-MAX_RUNTIME_PERFORMANCE_OBSERVATION_KEYS);
    return {
        ...usage,
        observationKeys
    };
}

/** 已经完成投影的 digest 只做深拷贝，禁止再次哈希。 */
function cloneDigestPerformanceUsage(
    value?: Partial<RuntimePerformanceUsage>
): RuntimePerformanceUsage {
    const observationKeys = Array.from(new Set(
        (value?.observationKeys || []).map((key) => String(key || '').trim()).filter(Boolean)
    )).slice(-MAX_RUNTIME_PERFORMANCE_OBSERVATION_KEYS);
    return {
        modelCalls: nonNegativeInteger(value?.modelCalls),
        toolCalls: nonNegativeInteger(value?.toolCalls),
        iterations: nonNegativeInteger(value?.iterations),
        visionCandidates: Math.max(
            nonNegativeInteger(value?.visionCandidates),
            observationKeys.length
        ),
        visualAnalyses: nonNegativeInteger(value?.visualAnalyses),
        activeElapsedMs: nonNegativeInteger(value?.activeElapsedMs),
        observationKeys
    };
}

function updateBucket(
    buckets: readonly RuntimeAccountingStageBucket[],
    stage: RuntimeStage | undefined,
    update: (bucket: RuntimeAccountingStageBucket) => void
): RuntimeAccountingStageBucket[] {
    const next = cloneBuckets(buckets);
    const normalizedStage = normalizeStage(stage);
    let bucket = next.find((entry) => entry.stage === normalizedStage);
    if (!bucket) {
        bucket = {
            stage: normalizedStage,
            modelCallCount: 0,
            modelFailureCount: 0,
            modelDurationMs: 0,
            inputTokens: 0,
            outputTokens: 0,
            unreportedUsageCallCount: 0,
            toolCallCount: 0,
            toolFailureCount: 0,
            toolDurationMs: 0
        };
        next.push(bucket);
    }
    update(bucket);
    return next;
}

export function createRuntimeAccountingLedger(now = new Date().toISOString()): RuntimeAccountingLedger {
    return {
        version: 'runtime-accounting-ledger/v0',
        startedAt: now,
        lastUpdatedAt: now,
        modelCallCount: 0,
        modelFailureCount: 0,
        modelDurationMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        unreportedUsageCallCount: 0,
        toolCallCount: 0,
        toolFailureCount: 0,
        toolDurationMs: 0,
        recoveryAttemptCount: 0,
        providerOutputRecoveryAttemptCount: 0,
        providerOutputRecoverySuccessCount: 0,
        providerOutputRecoveryFailureCount: 0,
        providerOutputRecoveryFailureCounts: {
            max_tokens: 0,
            stream_incomplete: 0,
            content_blocked: 0,
            request_error: 0
        },
        reflexionCount: 0,
        performanceUsage: clonePerformanceUsage(),
        stageBuckets: [],
        boundaries: {
            observationOnly: true,
            reportedUsageOnly: true,
            missingUsageNotEstimated: true,
            monetaryCostNotConfigured: true,
            enforcesBudget: false,
            grantsPermission: false,
            changesTaskResult: false
        }
    };
}

/**
 * 克隆同一个 Runtime Accounting owner 的当前值。
 *
 * 用于 plan-neutral Agent 在运行中绑定 staged Runtime Session 时转移已经真实发生的
 * unscoped 调用；转移后调用方必须释放旧引用，不能让两份 ledger 继续并行写入。
 * 本函数只复制 observation-only 会计，不校验或改变预算、权限、Stage 与任务结果。
 */
export function cloneRuntimeAccountingLedger(
    ledger: RuntimeAccountingLedger
): RuntimeAccountingLedger {
    const promptShapeSamples = clonePromptShapeSamples(ledger.promptShapeSamples);
    const modelFailureSamples = cloneModelFailureSamples(ledger.modelFailureSamples);
    const cloned: RuntimeAccountingLedger = {
        ...ledger,
        ...(ledger.providerOutputRecoveryFailureCounts
            ? { providerOutputRecoveryFailureCounts: { ...ledger.providerOutputRecoveryFailureCounts } }
            : {}),
        performanceUsage: clonePerformanceUsage(ledger.performanceUsage),
        stageBuckets: cloneBuckets(ledger.stageBuckets),
        boundaries: { ...ledger.boundaries }
    };
    if (promptShapeSamples) cloned.promptShapeSamples = promptShapeSamples;
    else delete cloned.promptShapeSamples;
    if (modelFailureSamples) cloned.modelFailureSamples = modelFailureSamples;
    else delete cloned.modelFailureSamples;
    return cloned;
}

/**
 * 用 Agent 的单调累计快照同步请求级性能用量。使用 max/union 而不是 delta，
 * 使晚绑定 replay、异常重试和 generation 恢复都保持幂等。
 */
export function recordRuntimePerformanceUsage(input: {
    ledger: RuntimeAccountingLedger;
    usage: Partial<RuntimePerformanceUsage>;
    now?: string;
}): RuntimeAccountingLedger {
    const previous = clonePerformanceUsage(input.ledger.performanceUsage);
    const incoming = clonePerformanceUsage(input.usage);
    const observationKeys = Array.from(new Set([
        ...previous.observationKeys,
        ...incoming.observationKeys
    ])).slice(-MAX_RUNTIME_PERFORMANCE_OBSERVATION_KEYS);
    return {
        ...input.ledger,
        lastUpdatedAt: input.now || new Date().toISOString(),
        performanceUsage: {
            modelCalls: Math.max(previous.modelCalls, incoming.modelCalls),
            toolCalls: Math.max(previous.toolCalls, incoming.toolCalls),
            iterations: Math.max(previous.iterations, incoming.iterations),
            visionCandidates: Math.max(
                previous.visionCandidates,
                incoming.visionCandidates,
                observationKeys.length
            ),
            visualAnalyses: Math.max(previous.visualAnalyses, incoming.visualAnalyses),
            activeElapsedMs: Math.max(previous.activeElapsedMs, incoming.activeElapsedMs),
            observationKeys
        },
        stageBuckets: cloneBuckets(input.ledger.stageBuckets)
    };
}

export function readRuntimePerformanceUsage(
    ledger: RuntimeAccountingLedger
): RuntimePerformanceUsage {
    return clonePerformanceUsage(ledger.performanceUsage);
}

const MAX_PROMPT_SHAPE_SAMPLES = 48;
const MAX_MODEL_FAILURE_SAMPLES = 32;

/** 提示体量：从消息与工具 schema 直接量出来（纯逻辑，不看正文语义）。 */
export interface RuntimePromptShapeInput {
    messages: ReadonlyArray<{
        role?: unknown;
        content?: unknown;
        reasoningContent?: unknown;
        contentBlocks?: ReadonlyArray<{ type?: unknown; text?: unknown }>;
        toolCalls?: ReadonlyArray<{ name?: unknown; arguments?: unknown }>;
        toolResults?: ReadonlyArray<{ output?: unknown }>;
        contextMetadata?: {
            origin?: unknown;
        };
    }>;
    tools: ReadonlyArray<unknown>;
}

function createEmptyRuntimePromptContextSourceChars(): RuntimePromptContextSourceChars {
    return {
        system: 0,
        currentUser: 0,
        assistantResponse: 0,
        assistantReasoning: 0,
        assistantToolArguments: 0,
        toolResults: 0,
        harnessControl: 0,
        runtimeObservation: 0,
        visualObservation: 0,
        toolObservation: 0,
        unclassified: 0
    };
}

function classifyRuntimeUserPromptContextSource(
    message: RuntimePromptShapeInput['messages'][number]
): keyof RuntimePromptContextSourceChars {
    switch (message.contextMetadata?.origin) {
        case 'current_user_instruction':
            return 'currentUser';
        case 'harness_control':
            return 'harnessControl';
        case 'runtime_observation':
            return 'runtimeObservation';
        case 'visual_observation':
            return 'visualObservation';
        case 'tool_observation':
            return 'toolObservation';
        default:
            return 'unclassified';
    }
}

export function measureRuntimePromptShape(input: RuntimePromptShapeInput): Omit<RuntimePromptShapeSample, 'seq' | 'stage' | 'inputTokens' | 'outputTokens' | 'durationMs'> {
    let systemChars = 0;
    let historyChars = 0;
    let reasoningChars = 0;
    let imageBlocks = 0;
    const contextSourceChars = createEmptyRuntimePromptContextSourceChars();
    for (const message of input.messages) {
        const contentChars = typeof message.content === 'string' ? message.content.length : 0;
        const contentBlocks = message.contentBlocks || [];
        const blockTextChars = contentBlocks.reduce((sum, block) => (
            sum + (block.type === 'text' && typeof block.text === 'string' ? block.text.length : 0)
        ), 0);
        let responseChars = 0;
        let messageReasoningChars = 0;
        let messageToolArgumentChars = 0;
        let messageToolResultChars = 0;
        if (message.role === 'system') {
            responseChars = contentChars;
        } else if (message.role === 'user') {
            responseChars = contentBlocks.length > 0 ? blockTextChars : contentChars;
            imageBlocks += contentBlocks.filter((block) => block.type === 'image').length;
        } else if (message.role === 'assistant') {
            responseChars = contentChars;
        }
        if (message.role === 'assistant' && typeof message.reasoningContent === 'string') {
            messageReasoningChars = message.reasoningContent.length;
            reasoningChars += messageReasoningChars;
        }
        for (const call of message.role === 'assistant' ? message.toolCalls || [] : []) {
            messageToolArgumentChars += String(call.name || '').length;
            try {
                messageToolArgumentChars += JSON.stringify(call.arguments ?? {}).length;
            } catch {
                // Unserializable arguments remain unmeasured; no payload is retained.
            }
        }
        for (const result of message.role === 'tool_result' ? message.toolResults || [] : []) {
            try {
                messageToolResultChars += typeof result.output === 'string'
                    ? result.output.length
                    : JSON.stringify(result.output ?? '').length;
            } catch {
                // Unserializable results remain unmeasured; no payload is retained.
            }
        }
        const chars = responseChars
            + messageReasoningChars
            + messageToolArgumentChars
            + messageToolResultChars;
        if (message.role === 'system') {
            systemChars += chars;
            contextSourceChars.system += chars;
        } else if (message.role === 'assistant') {
            historyChars += chars;
            contextSourceChars.assistantResponse += responseChars;
            contextSourceChars.assistantReasoning += messageReasoningChars;
            contextSourceChars.assistantToolArguments += messageToolArgumentChars;
            contextSourceChars.toolResults += messageToolResultChars;
        } else if (message.role === 'tool_result') {
            historyChars += chars;
            contextSourceChars.toolResults += chars;
        } else {
            historyChars += chars;
            contextSourceChars[classifyRuntimeUserPromptContextSource(message)] += chars;
        }
    }
    let toolSchemaChars = 0;
    try {
        toolSchemaChars = JSON.stringify(input.tools).length;
    } catch {
        toolSchemaChars = 0;
    }
    return {
        systemChars,
        historyChars,
        ...(reasoningChars > 0 ? { reasoningChars } : {}),
        messageCount: input.messages.length,
        imageBlocks,
        toolCount: input.tools.length,
        toolSchemaChars,
        contextSourceChars
    };
}

function countRuntimeModelToolArgumentChars(toolCalls: readonly unknown[]): number {
    let chars = 0;
    for (const value of toolCalls) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
        const call = value as { arguments?: unknown };
        try {
            chars += JSON.stringify(call.arguments ?? {}).length;
        } catch {
            // Circular or unsupported arguments stay unmeasured; no payload is retained.
        }
    }
    return chars;
}

function classifyRuntimeModelOutputTerminalKind(input: {
    stopReason: unknown;
    toolCallCount: number;
    incompleteToolCallCount: number;
}): RuntimeModelOutputTerminalKind {
    if (input.incompleteToolCallCount > 0) return 'incomplete_tool_calls';
    const reason = String(input.stopReason || '').trim().toLowerCase();
    if (reason === 'max_tokens' || reason === 'length') return 'max_tokens';
    if (reason === 'stream_incomplete') return 'stream_incomplete';
    if (reason === 'content_blocked'
        || reason === 'content_filter'
        || reason === 'blocked'
        || reason === 'safety') {
        return 'content_blocked';
    }
    if (input.toolCallCount > 0 || reason === 'tool_use' || reason === 'tool_calls') {
        return 'tool_calls';
    }
    if (reason === 'stop'
        || reason === 'end_turn'
        || reason === 'complete'
        || reason === 'completed'
        || reason === 'stop_sequence') {
        return 'complete';
    }
    return 'unknown';
}

/** 从完整响应投影有界输出体量；无对象响应保持 unknown，不读取或保留正文语义。 */
export function measureRuntimeModelOutputShape(value: unknown): RuntimeModelOutputShape | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const response = value as {
        content?: unknown;
        thinking?: unknown;
        toolCalls?: unknown;
        incompleteToolCallNames?: unknown;
        stopReason?: unknown;
    };
    const toolCalls = Array.isArray(response.toolCalls) ? response.toolCalls : [];
    const incompleteToolCalls = Array.isArray(response.incompleteToolCallNames)
        ? response.incompleteToolCallNames
        : [];
    return {
        contentChars: typeof response.content === 'string' ? response.content.length : 0,
        reasoningChars: typeof response.thinking === 'string' ? response.thinking.length : 0,
        toolCallCount: toolCalls.length,
        toolArgumentChars: countRuntimeModelToolArgumentChars(toolCalls),
        incompleteToolCallCount: incompleteToolCalls.length,
        terminalKind: classifyRuntimeModelOutputTerminalKind({
            stopReason: response.stopReason,
            toolCallCount: toolCalls.length,
            incompleteToolCallCount: incompleteToolCalls.length
        })
    };
}

function projectRuntimeModelVisualInputAttribution(input: {
    runStartedAt: string;
    visualInput?: RuntimeModelVisualInput;
}): RuntimeModelVisualInputAttribution | undefined {
    const observationKeyDigests = Array.from(new Set(
        (input.visualInput?.observationKeys || [])
            .filter((value): value is string => typeof value === 'string')
            .map((value) => value.trim())
            .filter(Boolean)
            .map((value) => sha256Hex(value))
    ))
        .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
        .slice(0, MAX_RUNTIME_MODEL_VISUAL_OBSERVATION_KEYS);
    const revisionsByIdentity = new Map<string, { documentId: number; historyStateId: number }>();
    for (const revision of input.visualInput?.photoshopRevisions || []) {
        if (!revision
            || !Number.isSafeInteger(revision.documentId)
            || revision.documentId < 1
            || !Number.isSafeInteger(revision.historyStateId)
            || revision.historyStateId < 1) {
            continue;
        }
        revisionsByIdentity.set(
            `${revision.documentId}:${revision.historyStateId}`,
            { documentId: revision.documentId, historyStateId: revision.historyStateId }
        );
    }
    const revisions = Array.from(revisionsByIdentity.values()).sort((left, right) => (
        left.documentId - right.documentId || left.historyStateId - right.historyStateId
    ));
    if (observationKeyDigests.length === 0 && revisions.length === 0) return undefined;

    const runScope = String(input.runStartedAt || '').trim();
    const retainedRevisions = revisions.slice(0, MAX_RUNTIME_MODEL_VISUAL_REVISION_DIGESTS);
    return {
        trackedObservationCount: observationKeyDigests.length,
        ...(observationKeyDigests.length > 0
            ? {
                observationSetDigest:
                    `${RUNTIME_MODEL_VISUAL_OBSERVATION_SET_DIGEST_PREFIX}${sha256Hex([
                        'runtime-model-visual-observation-set/v1',
                        runScope,
                        ...observationKeyDigests
                    ].join('\u0000'))}`
            }
            : {}),
        revisionDigests: retainedRevisions.map((revision) => (
            `${RUNTIME_MODEL_VISUAL_REVISION_DIGEST_PREFIX}${sha256Hex([
                'runtime-model-photoshop-revision/v1',
                runScope,
                String(revision.documentId),
                String(revision.historyStateId)
            ].join('\u0000'))}`
        )),
        droppedRevisionCount: Math.max(0, revisions.length - retainedRevisions.length)
    };
}

export function recordRuntimeModelCall(input: {
    ledger: RuntimeAccountingLedger;
    stage?: RuntimeStage;
    durationMs: number;
    succeeded: boolean;
    callKind?: RuntimeModelCallKind;
    requestMode?: RuntimeModelRequestMode;
    agentIteration?: number;
    runtimeGeneration?: number;
    requestStartedActiveMs?: number;
    transportAttemptIndex?: number;
    transportAttemptCount?: number;
    requestedThinking?: RuntimeRequestedThinking;
    requestedReasoningEffort?: ModelReasoningEffort;
    requestedMaxTokens?: number;
    usage?: Partial<ProviderReportedTokenUsage>;
    failureKind?: ModelProviderFailureKind;
    providerCode?: string;
    status?: number;
    promptShape?: ReturnType<typeof measureRuntimePromptShape>;
    contextPreparation?: RuntimeContextPreparationShape;
    outputShape?: RuntimeModelOutputShape;
    visualInput?: RuntimeModelVisualInput;
    now?: string;
}): RuntimeAccountingLedger {
    const durationMs = nonNegativeInteger(input.durationMs);
    const hasReportedUsage = Boolean(
        input.usage
        && Number.isFinite(input.usage.inputTokens)
        && Number.isFinite(input.usage.outputTokens)
    );
    const inputTokens = hasReportedUsage ? nonNegativeInteger(input.usage?.inputTokens) : 0;
    const outputTokens = hasReportedUsage ? nonNegativeInteger(input.usage?.outputTokens) : 0;
    const rawCacheHitInputTokens = input.usage?.cacheHitInputTokens;
    const rawCacheMissInputTokens = input.usage?.cacheMissInputTokens;
    const hasReportedCacheUsage = hasReportedUsage
        && Number.isSafeInteger(input.usage?.inputTokens)
        && Number(input.usage?.inputTokens) >= 0
        && Number.isSafeInteger(rawCacheHitInputTokens)
        && Number(rawCacheHitInputTokens) >= 0
        && Number.isSafeInteger(rawCacheMissInputTokens)
        && Number(rawCacheMissInputTokens) >= 0
        && Number(rawCacheHitInputTokens) + Number(rawCacheMissInputTokens)
            === Number(input.usage?.inputTokens);
    const cacheHitInputTokens = hasReportedCacheUsage ? Number(rawCacheHitInputTokens) : 0;
    const cacheMissInputTokens = hasReportedCacheUsage ? Number(rawCacheMissInputTokens) : 0;
    let sanitizedPromptShape = input.promptShape;
    if (input.promptShape) {
        const {
            providerTransportMetrics: rawProviderTransportMetrics,
            ...basePromptShape
        } = input.promptShape;
        const providerTransportMetrics = readProviderTransportMetrics(rawProviderTransportMetrics);
        sanitizedPromptShape = {
            ...basePromptShape,
            ...(providerTransportMetrics ? { providerTransportMetrics } : {})
        };
    }
    const previousSamples = Array.isArray(input.ledger.promptShapeSamples) ? input.ledger.promptShapeSamples : [];
    const visualInputAttribution = projectRuntimeModelVisualInputAttribution({
        runStartedAt: input.ledger.startedAt,
        visualInput: input.visualInput
    });
    const promptShapeSamples = sanitizedPromptShape
        ? [
            ...previousSamples,
            {
                seq: input.ledger.modelCallCount + 1,
                stage: normalizeStage(input.stage),
                ...(input.callKind ? { callKind: input.callKind } : {}),
                ...(input.requestMode ? { requestMode: input.requestMode } : {}),
                ...(isNonNegativeSafeInteger(input.agentIteration)
                    ? { agentIteration: Number(input.agentIteration) }
                    : {}),
                ...(isNonNegativeSafeInteger(input.runtimeGeneration)
                    ? { runtimeGeneration: Number(input.runtimeGeneration) }
                    : {}),
                ...(isNonNegativeSafeInteger(input.requestStartedActiveMs)
                    ? { requestStartedActiveMs: Number(input.requestStartedActiveMs) }
                    : {}),
                ...(Number.isSafeInteger(input.transportAttemptIndex)
                    && Number(input.transportAttemptIndex) >= 1
                    && Number.isSafeInteger(input.transportAttemptCount)
                    && Number(input.transportAttemptCount) >= Number(input.transportAttemptIndex)
                    && Number(input.transportAttemptCount) <= 4
                    ? {
                        transportAttemptIndex: Number(input.transportAttemptIndex),
                        transportAttemptCount: Number(input.transportAttemptCount)
                    }
                    : {}),
                ...(input.requestedThinking ? { requestedThinking: input.requestedThinking } : {}),
                ...(input.requestedReasoningEffort
                    ? { requestedReasoningEffort: input.requestedReasoningEffort }
                    : {}),
                ...(isNonNegativeSafeInteger(input.requestedMaxTokens)
                    ? { requestedMaxTokens: Number(input.requestedMaxTokens) }
                    : {}),
                ...(hasReportedUsage ? { inputTokens, outputTokens } : {}),
                ...(hasReportedCacheUsage ? { cacheHitInputTokens, cacheMissInputTokens } : {}),
                durationMs,
                ...sanitizedPromptShape,
                ...(input.contextPreparation
                    ? { contextPreparation: { ...input.contextPreparation } }
                    : {}),
                ...(input.outputShape ? { outputShape: { ...input.outputShape } } : {}),
                ...(visualInputAttribution
                    ? {
                        visualInputAttribution: {
                            ...visualInputAttribution,
                            revisionDigests: [...visualInputAttribution.revisionDigests]
                        }
                    }
                    : {})
            }
        ].slice(-MAX_PROMPT_SHAPE_SAMPLES)
        : previousSamples;
    const previousFailureSamples = Array.isArray(input.ledger.modelFailureSamples)
        ? input.ledger.modelFailureSamples
        : [];
    const failureKind = RUNTIME_MODEL_FAILURE_KINDS.has(input.failureKind as ModelProviderFailureKind)
        ? input.failureKind
        : undefined;
    const providerCode = normalizeProviderFailureCode(input.providerCode);
    const status = normalizeProviderFailureStatus(input.status);
    const modelFailureSamples = !input.succeeded && failureKind
        ? [
            ...previousFailureSamples,
            {
                seq: input.ledger.modelCallCount + 1,
                stage: normalizeStage(input.stage),
                durationMs,
                failureKind,
                ...(providerCode ? { providerCode } : {}),
                ...(status ? { status } : {})
            }
        ].slice(-MAX_MODEL_FAILURE_SAMPLES)
        : previousFailureSamples;
    return {
        ...input.ledger,
        lastUpdatedAt: input.now || new Date().toISOString(),
        ...(promptShapeSamples.length > 0 ? { promptShapeSamples } : {}),
        ...(modelFailureSamples.length > 0 ? { modelFailureSamples } : {}),
        modelCallCount: input.ledger.modelCallCount + 1,
        modelFailureCount: input.ledger.modelFailureCount + (input.succeeded ? 0 : 1),
        modelDurationMs: input.ledger.modelDurationMs + durationMs,
        inputTokens: input.ledger.inputTokens + inputTokens,
        outputTokens: input.ledger.outputTokens + outputTokens,
        unreportedUsageCallCount: input.ledger.unreportedUsageCallCount + (hasReportedUsage ? 0 : 1),
        stageBuckets: updateBucket(input.ledger.stageBuckets, input.stage, (bucket) => {
            bucket.modelCallCount += 1;
            bucket.modelFailureCount += input.succeeded ? 0 : 1;
            bucket.modelDurationMs += durationMs;
            bucket.inputTokens += inputTokens;
            bucket.outputTokens += outputTokens;
            bucket.unreportedUsageCallCount += hasReportedUsage ? 0 : 1;
        })
    };
}

export function recordRuntimeToolCall(input: {
    ledger: RuntimeAccountingLedger;
    stage?: RuntimeStage;
    durationMs: number;
    succeeded: boolean;
    now?: string;
}): RuntimeAccountingLedger {
    const durationMs = nonNegativeInteger(input.durationMs);
    return {
        ...input.ledger,
        lastUpdatedAt: input.now || new Date().toISOString(),
        toolCallCount: input.ledger.toolCallCount + 1,
        toolFailureCount: input.ledger.toolFailureCount + (input.succeeded ? 0 : 1),
        toolDurationMs: input.ledger.toolDurationMs + durationMs,
        stageBuckets: updateBucket(input.ledger.stageBuckets, input.stage, (bucket) => {
            bucket.toolCallCount += 1;
            bucket.toolFailureCount += input.succeeded ? 0 : 1;
            bucket.toolDurationMs += durationMs;
        })
    };
}

export function recordRuntimeRecoveryAttempt(
    ledger: RuntimeAccountingLedger,
    now = new Date().toISOString()
): RuntimeAccountingLedger {
    return {
        ...ledger,
        lastUpdatedAt: now,
        recoveryAttemptCount: ledger.recoveryAttemptCount + 1,
        stageBuckets: cloneBuckets(ledger.stageBuckets)
    };
}

export function recordRuntimeProviderOutputRecoveryAttempt(
    ledger: RuntimeAccountingLedger,
    now = new Date().toISOString()
): RuntimeAccountingLedger {
    return {
        ...ledger,
        lastUpdatedAt: now,
        recoveryAttemptCount: ledger.recoveryAttemptCount + 1,
        providerOutputRecoveryAttemptCount: nonNegativeInteger(
            ledger.providerOutputRecoveryAttemptCount
        ) + 1,
        stageBuckets: cloneBuckets(ledger.stageBuckets)
    };
}

export function recordRuntimeProviderOutputRecoveryOutcome(
    ledger: RuntimeAccountingLedger,
    outcome: 'succeeded' | RuntimeProviderOutputRecoveryFailureReason,
    now = new Date().toISOString()
): RuntimeAccountingLedger {
    if (outcome === 'succeeded') {
        return {
            ...ledger,
            lastUpdatedAt: now,
            providerOutputRecoverySuccessCount: nonNegativeInteger(
                ledger.providerOutputRecoverySuccessCount
            ) + 1,
            stageBuckets: cloneBuckets(ledger.stageBuckets)
        };
    }
    const failureCounts: RuntimeProviderOutputRecoveryFailureCounts = {
        max_tokens: nonNegativeInteger(ledger.providerOutputRecoveryFailureCounts?.max_tokens),
        stream_incomplete: nonNegativeInteger(ledger.providerOutputRecoveryFailureCounts?.stream_incomplete),
        content_blocked: nonNegativeInteger(ledger.providerOutputRecoveryFailureCounts?.content_blocked),
        request_error: nonNegativeInteger(ledger.providerOutputRecoveryFailureCounts?.request_error)
    };
    failureCounts[outcome] += 1;
    return {
        ...ledger,
        lastUpdatedAt: now,
        providerOutputRecoveryFailureCount: nonNegativeInteger(
            ledger.providerOutputRecoveryFailureCount
        ) + 1,
        providerOutputRecoveryFailureCounts: failureCounts,
        stageBuckets: cloneBuckets(ledger.stageBuckets)
    };
}

export function recordRuntimeReflexion(
    ledger: RuntimeAccountingLedger,
    now = new Date().toISOString()
): RuntimeAccountingLedger {
    return {
        ...ledger,
        lastUpdatedAt: now,
        reflexionCount: ledger.reflexionCount + 1,
        stageBuckets: cloneBuckets(ledger.stageBuckets)
    };
}

export function buildRuntimeAccountingDigest(input: {
    ledger: RuntimeAccountingLedger;
    now?: string;
}): RuntimeAccountingDigest {
    const startMs = Date.parse(input.ledger.startedAt);
    const endMs = Date.parse(input.now || input.ledger.lastUpdatedAt);
    const wallTimeMs = Number.isFinite(startMs) && Number.isFinite(endMs)
        ? Math.max(0, Math.floor(endMs - startMs))
        : 0;
    const promptShapeSamples = clonePromptShapeSamples(input.ledger.promptShapeSamples);
    const modelFailureSamples = cloneModelFailureSamples(input.ledger.modelFailureSamples);
    return {
        version: 'runtime-accounting-digest/v0',
        modelCallCount: input.ledger.modelCallCount,
        modelFailureCount: input.ledger.modelFailureCount,
        modelDurationMs: input.ledger.modelDurationMs,
        inputTokens: input.ledger.inputTokens,
        outputTokens: input.ledger.outputTokens,
        unreportedUsageCallCount: input.ledger.unreportedUsageCallCount,
        toolCallCount: input.ledger.toolCallCount,
        toolFailureCount: input.ledger.toolFailureCount,
        toolDurationMs: input.ledger.toolDurationMs,
        recoveryAttemptCount: input.ledger.recoveryAttemptCount,
        providerOutputRecoveryAttemptCount: nonNegativeInteger(
            input.ledger.providerOutputRecoveryAttemptCount
        ),
        providerOutputRecoverySuccessCount: nonNegativeInteger(
            input.ledger.providerOutputRecoverySuccessCount
        ),
        providerOutputRecoveryFailureCount: nonNegativeInteger(
            input.ledger.providerOutputRecoveryFailureCount
        ),
        providerOutputRecoveryFailureCounts: {
            max_tokens: nonNegativeInteger(
                input.ledger.providerOutputRecoveryFailureCounts?.max_tokens
            ),
            stream_incomplete: nonNegativeInteger(
                input.ledger.providerOutputRecoveryFailureCounts?.stream_incomplete
            ),
            content_blocked: nonNegativeInteger(
                input.ledger.providerOutputRecoveryFailureCounts?.content_blocked
            ),
            request_error: nonNegativeInteger(
                input.ledger.providerOutputRecoveryFailureCounts?.request_error
            )
        },
        reflexionCount: input.ledger.reflexionCount,
        performanceUsage: projectPerformanceUsageForDigest(input.ledger.performanceUsage),
        wallTimeMs,
        stageBuckets: cloneBuckets(input.ledger.stageBuckets),
        ...(promptShapeSamples ? { promptShapeSamples } : {}),
        ...(modelFailureSamples ? { modelFailureSamples } : {}),
        costEstimate: { status: 'not_configured' },
        boundaries: {
            digestOnly: true,
            observationOnly: true,
            reportedUsageOnly: true,
            missingUsageNotEstimated: true,
            enforcesBudget: false,
            grantsPermission: false,
            changesTaskResult: false
        }
    };
}
