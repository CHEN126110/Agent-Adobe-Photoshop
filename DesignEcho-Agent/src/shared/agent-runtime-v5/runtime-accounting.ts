/**
 * Runtime accounting ledger for the existing Runtime Session.
 *
 * It records measured calls, reported token usage and elapsed time. Missing usage remains explicit;
 * no token count, currency amount or retry is inferred. The ledger observes work only and never
 * grants permission, enforces a budget or changes task/quality results.
 */

import type { RuntimeStage } from './contracts';

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
    /** 只统计受 AgentPerformancePolicy 约束的主/视觉模型调用。 */
    modelCalls: number;
    /** 只统计模型发起、会消耗业务 Tool 预算的调用；不含 Harness 质量读回。 */
    toolCalls: number;
    iterations: number;
    visionCandidates: number;
    visualAnalyses: number;
    /**
     * 只累计各 generation 的 Agent.run 活跃时长；不包含 generation 之间等待用户、
     * 刷新 Project State 或重新授权的墙钟时间。
     */
    activeElapsedMs: number;
    /** 同一视觉证据跨主循环、R5 与 Reflexion generation 只计费一次。 */
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
    durationMs: number;
    /** 系统提示字符数（策略 + 原则 + 知识 + 项目状态 + 历史摘要） */
    systemChars: number;
    /** 非系统消息（用户 / 助手 / 工具结果）总字符数 */
    historyChars: number;
    messageCount: number;
    /** 图像块数量（每块按 provider 计费，不算进字符） */
    imageBlocks: number;
    toolCount: number;
    /** 工具 schema JSON 字符数 */
    toolSchemaChars: number;
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
    reflexionCount: number;
    /**
     * 同一 Runtime Session 的请求级性能用量。Ledger 仍不自行判定预算；
     * Agent 只把它作为下一 generation 的累计用量真相源。
     */
    performanceUsage: RuntimePerformanceUsage;
    stageBuckets: RuntimeAccountingStageBucket[];
    /** 每次模型调用的提示体量样本（有界）；缺失表示旧账本或未测量。 */
    promptShapeSamples?: RuntimePromptShapeSample[];
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
    reflexionCount: number;
    performanceUsage: RuntimePerformanceUsage;
    wallTimeMs: number;
    stageBuckets: RuntimeAccountingStageBucket[];
    /** 提示体量样本（有界，同 ledger）；诊断「模型是否被淹」用。 */
    promptShapeSamples?: RuntimePromptShapeSample[];
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

function nonNegativeInteger(value: unknown): number {
    return Number.isFinite(value) ? Math.max(0, Math.floor(Number(value))) : 0;
}

function normalizeStage(stage: RuntimeStage | undefined): RuntimeAccountingStage {
    return stage || 'unscoped';
}

function cloneBuckets(values: readonly RuntimeAccountingStageBucket[]): RuntimeAccountingStageBucket[] {
    return values.map((bucket) => ({ ...bucket }));
}

const MAX_RUNTIME_PERFORMANCE_OBSERVATION_KEYS = 128;

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

/** 提示体量：从消息与工具 schema 直接量出来（纯逻辑，不看正文语义）。 */
export interface RuntimePromptShapeInput {
    messages: ReadonlyArray<{
        role?: unknown;
        content?: unknown;
        contentBlocks?: ReadonlyArray<{ type?: unknown; text?: unknown }>;
        toolCalls?: ReadonlyArray<{ name?: unknown; arguments?: unknown }>;
        toolResults?: ReadonlyArray<{ output?: unknown }>;
    }>;
    tools: ReadonlyArray<unknown>;
}

export function measureRuntimePromptShape(input: RuntimePromptShapeInput): Omit<RuntimePromptShapeSample, 'seq' | 'stage' | 'inputTokens' | 'outputTokens' | 'durationMs'> {
    let systemChars = 0;
    let historyChars = 0;
    let imageBlocks = 0;
    for (const message of input.messages) {
        let chars = typeof message.content === 'string' ? message.content.length : 0;
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
    usage?: { inputTokens?: number; outputTokens?: number };
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
    const previousSamples = Array.isArray(input.ledger.promptShapeSamples) ? input.ledger.promptShapeSamples : [];
    const promptShapeSamples = input.promptShape
        ? [
            ...previousSamples,
            {
                seq: input.ledger.modelCallCount + 1,
                stage: normalizeStage(input.stage),
                ...(hasReportedUsage ? { inputTokens, outputTokens } : {}),
                durationMs,
                ...input.promptShape
            }
        ].slice(-MAX_PROMPT_SHAPE_SAMPLES)
        : previousSamples;
    return {
        ...input.ledger,
        lastUpdatedAt: input.now || new Date().toISOString(),
        ...(promptShapeSamples.length > 0 ? { promptShapeSamples } : {}),
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
        reflexionCount: input.ledger.reflexionCount,
        performanceUsage: clonePerformanceUsage(input.ledger.performanceUsage),
        wallTimeMs,
        stageBuckets: cloneBuckets(input.ledger.stageBuckets),
        ...(Array.isArray(input.ledger.promptShapeSamples) && input.ledger.promptShapeSamples.length > 0
            ? { promptShapeSamples: input.ledger.promptShapeSamples.map((sample) => ({ ...sample })) }
            : {}),
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
