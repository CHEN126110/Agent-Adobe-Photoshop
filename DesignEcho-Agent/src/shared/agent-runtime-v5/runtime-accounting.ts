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
import type { ModelProviderFailureKind } from '../model-provider-failure';
import type { ProviderReportedTokenUsage } from '../provider-reported-token-usage';
import {
    readProviderTransportMetrics,
    type ProviderTransportMetrics
} from '../provider-transport-metrics';

export type RuntimeAccountingStage = RuntimeStage | 'unscoped';

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
    'toolSchemaChars'
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
    }>;
    tools: ReadonlyArray<unknown>;
}

export function measureRuntimePromptShape(input: RuntimePromptShapeInput): Omit<RuntimePromptShapeSample, 'seq' | 'stage' | 'inputTokens' | 'outputTokens' | 'durationMs'> {
    let systemChars = 0;
    let historyChars = 0;
    let reasoningChars = 0;
    let imageBlocks = 0;
    for (const message of input.messages) {
        let chars = typeof message.content === 'string' ? message.content.length : 0;
        if (typeof message.reasoningContent === 'string') {
            chars += message.reasoningContent.length;
            reasoningChars += message.reasoningContent.length;
        }
        for (const block of message.contentBlocks || []) {
            if (block.type === 'image') {
                imageBlocks += 1;
            } else if (typeof block.text === 'string') {
                chars += block.text.length;
            }
        }
        for (const call of message.toolCalls || []) {
            chars += String(call.name || '').length;
            try {
                chars += JSON.stringify(call.arguments ?? {}).length;
            } catch {
                chars += 0;
            }
        }
        for (const result of message.toolResults || []) {
            try {
                chars += typeof result.output === 'string' ? result.output.length : JSON.stringify(result.output ?? '').length;
            } catch {
                chars += 0;
            }
        }
        if (message.role === 'system') {
            systemChars += chars;
        } else {
            historyChars += chars;
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
        toolSchemaChars
    };
}

export function recordRuntimeModelCall(input: {
    ledger: RuntimeAccountingLedger;
    stage?: RuntimeStage;
    durationMs: number;
    succeeded: boolean;
    usage?: Partial<ProviderReportedTokenUsage>;
    failureKind?: ModelProviderFailureKind;
    providerCode?: string;
    status?: number;
    promptShape?: ReturnType<typeof measureRuntimePromptShape>;
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
    const promptShapeSamples = sanitizedPromptShape
        ? [
            ...previousSamples,
            {
                seq: input.ledger.modelCallCount + 1,
                stage: normalizeStage(input.stage),
                ...(hasReportedUsage ? { inputTokens, outputTokens } : {}),
                ...(hasReportedCacheUsage ? { cacheHitInputTokens, cacheMissInputTokens } : {}),
                durationMs,
                ...sanitizedPromptShape
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
