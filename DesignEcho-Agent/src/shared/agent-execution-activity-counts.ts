export interface AgentExecutionActivitySummaryLike {
    businessActionCount?: unknown;
    toolCallCount?: unknown;
    successfulToolCalls?: unknown;
    failedToolCalls?: unknown;
    successfulMutationCalls?: unknown;
    successfulObservationCalls?: unknown;
    observedToolCallCount?: unknown;
    summaryText?: unknown;
}

export interface AgentExecutionBusinessActivityCounts {
    total: number;
    completed: number;
    failed: number;
    breakdownAvailable: boolean;
    successfulMutationCalls: number;
    /**
     * 完成观察门禁口径：只算最后一次写入之后、模型自己完成的 Photoshop 文档读取。
     * 这是"改后有没有复核"的安全判据，Harness 自己的质量复核不得计入，
     * 否则幻觉式完成会被放过。不要拿它当"这次看了多少东西"显示给用户。
     */
    successfulObservationCalls: number;
    /**
     * 用户可见口径：本次运行成功的观察类工具调用总数（素材总览、参考分析、
     * 项目资源检索、画面读取…）。与运行档案的 activityClass==='observation' 同源。
     */
    observedToolCallCount: number;
    activityBreakdownAvailable: boolean;
}

export interface NormalizeAgentExecutionSummaryTextOptions {
    /**
     * 结果卡已有独立的观察/改动与 TaskCompletion 投影时，旧 Tool 成功率不能继续
     * 用“已处理/未完成”冒充任务完成度。
     */
    taskNeutralActivityLanguage?: boolean;
}

function readOptionalCount(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const count = Number(value);
    if (!Number.isFinite(count) || count < 0) return undefined;
    return Math.floor(count);
}

function readSummaryTextCount(value: unknown, pattern: RegExp): number | undefined {
    const match = String(value || '').match(pattern);
    return readOptionalCount(match?.[1]);
}

function resolveDeclaredTotal(summary: AgentExecutionActivitySummaryLike): number {
    const businessTotal = readOptionalCount(summary.businessActionCount);
    if (businessTotal !== undefined) return businessTotal;
    return readOptionalCount(summary.toolCallCount) || 0;
}

/**
 * 新记录使用结构化成功/失败分桶；旧记录可从标准摘要文本恢复。
 * 若只有总数而没有可靠分桶，则保留总数并显式标记明细缺失，不猜测完成或失败数量。
 */
export function resolveAgentExecutionBusinessActivityCounts(
    summary: AgentExecutionActivitySummaryLike | undefined
): AgentExecutionBusinessActivityCounts {
    if (!summary) {
        return {
            total: 0,
            completed: 0,
            failed: 0,
            breakdownAvailable: false,
            successfulMutationCalls: 0,
            successfulObservationCalls: 0,
            observedToolCallCount: 0,
            activityBreakdownAvailable: false
        };
    }
    const structuredCompleted = readOptionalCount(summary.successfulToolCalls);
    const structuredFailed = readOptionalCount(summary.failedToolCalls);
    const structuredMutations = readOptionalCount(summary.successfulMutationCalls);
    const structuredObservations = readOptionalCount(summary.successfulObservationCalls);
    const structuredObservedToolCalls = readOptionalCount(summary.observedToolCallCount);
    const activityBreakdownAvailable = structuredMutations !== undefined
        && structuredObservations !== undefined;
    const textCompleted = readSummaryTextCount(summary.summaryText, /(\d+)\s*项已处理/u);
    const textFailed = readSummaryTextCount(summary.summaryText, /(\d+)\s*项未完成/u);
    const completed = structuredCompleted ?? textCompleted;
    const failed = structuredFailed ?? textFailed;
    if (completed !== undefined && failed !== undefined) {
        return {
            total: completed + failed,
            completed,
            failed,
            breakdownAvailable: true,
            successfulMutationCalls: structuredMutations || 0,
            successfulObservationCalls: structuredObservations || 0,
            observedToolCallCount: structuredObservedToolCalls || 0,
            activityBreakdownAvailable
        };
    }
    return {
        total: Math.max(resolveDeclaredTotal(summary), completed || 0, failed || 0),
        completed: completed || 0,
        failed: failed || 0,
        breakdownAvailable: false,
        successfulMutationCalls: structuredMutations || 0,
        successfulObservationCalls: structuredObservations || 0,
        observedToolCallCount: structuredObservedToolCalls || 0,
        activityBreakdownAvailable
    };
}

export function normalizeAgentExecutionSummaryText(
    value: unknown,
    counts: AgentExecutionBusinessActivityCounts,
    options: NormalizeAgentExecutionSummaryTextOptions = {}
): string {
    let normalized = String(value || '').trim();
    if (!normalized) return '';
    normalized = normalized.replace(/共处理\s*\d+\s*项/u, `共处理 ${counts.total} 项`);
    if (options.taskNeutralActivityLanguage) {
        return normalized
            .replace(/[，,]?\s*\d+\s*项已处理/u, '')
            .replace(/[，,]?\s*\d+\s*项未完成/u, '')
            .replace(/，。/gu, '。')
            .trim();
    }
    if (counts.breakdownAvailable) {
        return normalized
            .replace(/\d+\s*项已处理/u, `${counts.completed} 项已处理`)
            .replace(/\d+\s*项未完成/u, `${counts.failed} 项未完成`);
    }
    normalized = normalized
        .replace(/[，,]?\s*\d+\s*项已处理/u, '')
        .replace(/[，,]?\s*\d+\s*项未完成/u, '')
        .replace(/，。/gu, '。')
        .trim();
    if (counts.total <= 0 || normalized.includes('完成明细未记录')) return normalized;
    return `${normalized.replace(/[。.]$/u, '')}，完成明细未记录。`;
}
