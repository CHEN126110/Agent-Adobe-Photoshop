export interface AgentToolFailureDiagnosticInput {
    toolName: string;
    toolKind?: 'tool' | 'skill';
    result: unknown;
}

function readNonEmptyText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeDiagnosticCode(value: unknown): string {
    const text = readNonEmptyText(value);
    if (!text) return '';
    return text
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[^a-zA-Z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase();
}

function readIssueText(value: unknown): string {
    if (typeof value === 'string') return value.trim();
    if (!value || typeof value !== 'object') return '';
    const issue = value as Record<string, unknown>;
    const code = readNonEmptyText(issue.code);
    const path = readNonEmptyText(issue.path);
    const message = readNonEmptyText(issue.message) || readNonEmptyText(issue.summary);
    return [code, path ? `(${path})` : '', message].filter(Boolean).join(' ');
}

function readFailureDetail(result: Record<string, any>): string {
    const direct = [result.error, result.message, result.summary]
        .map(readNonEmptyText)
        .find(Boolean);
    if (direct) return direct;
    const blocker = Array.isArray(result.blockers)
        ? result.blockers.map(readIssueText).find(Boolean)
        : '';
    if (blocker) return blocker;
    const issue = Array.isArray(result.issues)
        ? result.issues.map(readIssueText).find(Boolean)
        : '';
    if (issue) return issue;
    return readNonEmptyText(result.errorDetails?.userMessage)
        || readNonEmptyText(result.errorDetails?.message);
}

function resolveFailureCode(
    result: Record<string, any>,
    toolKind: 'tool' | 'skill',
    hasDiagnosticDetail: boolean
): string {
    // 既有 code 可能被外部消费者持久化或匹配，不能在归一化边界改写其大小写/分隔符。
    const existingCode = readNonEmptyText(result.code)
        || normalizeDiagnosticCode(result.errorCode)
        || normalizeDiagnosticCode(result.errorDetails?.category);
    if (existingCode) return existingCode;
    if (result.cancelled === true) return 'task_cancelled';
    if (result.requiresUserAction === true || result.status === 'awaiting_confirmation') {
        return 'user_confirmation_required';
    }
    if (result.nonFatal === true) return 'skill_workflow_handoff_pending';
    if (!hasDiagnosticDetail) return 'tool_failure_diagnostic_missing';
    return toolKind === 'skill' ? 'skill_execution_failed' : 'tool_execution_failed';
}

/**
 * 统一失败结果的内部诊断形状。它不改变 success/nonFatal/cancelled 等控制语义，
 * 也不负责用户 UI 投影；原始详情继续留在结果中供模型恢复和运行档案使用。
 */
export function ensureAgentToolFailureDiagnostics(
    input: AgentToolFailureDiagnosticInput
): unknown {
    if (!input.result || typeof input.result !== 'object') return input.result;
    const result = input.result as Record<string, any>;
    if (result.success !== false) return input.result;
    const toolKind = input.toolKind === 'skill' ? 'skill' : 'tool';
    const toolName = readNonEmptyText(input.toolName) || '当前工具';
    const detail = readFailureDetail(result);
    const code = resolveFailureCode(result, toolKind, Boolean(detail));
    const generatedSummary = detail
        ? `「${toolName}」未完成：${detail} 请按该原因修正输入，或重新读取关联对象后再继续。`
        : `「${toolName}」未完成，执行方没有返回具体原因。请检查当前文档和输入是否仍有效，再调整处理方式。`;
    // 普通结果原地补字段，保留 Tool dispatcher 绑定在对象身份上的私有 provenance。
    // 冻结结果只能复制；调用边界负责在确认原对象可信后把 provenance 显式转移给副本。
    const normalized = Object.isExtensible(result) ? result : { ...result };
    normalized.code = code;
    normalized.error = readNonEmptyText(result.error) || generatedSummary;
    normalized.message = readNonEmptyText(result.message) || generatedSummary;
    normalized.summary = readNonEmptyText(result.summary) || generatedSummary;
    return normalized;
}
