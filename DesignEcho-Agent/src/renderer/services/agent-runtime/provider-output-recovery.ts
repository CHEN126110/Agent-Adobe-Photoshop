import {
    resolveCanonicalProviderStopReason
} from '../../../shared/provider-stream-completion';
import type { RuntimeProviderOutputRecoveryFailureReason } from '../../../shared/agent-runtime-v5/runtime-accounting';

const MAX_CONSECUTIVE_RECOVERY_ATTEMPTS = 2;
const MAX_RECOVERY_ATTEMPTS_PER_RUN = 4;

export type ProviderOutputRecoveryOutcome =
    | 'succeeded'
    | RuntimeProviderOutputRecoveryFailureReason;

interface ProviderToolResponseLike {
    content?: unknown;
    stopReason?: string;
    incompleteToolCallNames?: string[];
    toolCalls?: Array<{
        id?: unknown;
        name?: unknown;
        arguments?: unknown;
    }>;
}

export interface CompleteProviderTextContentRead {
    complete: boolean;
    content: string;
    stopReason: ReturnType<typeof resolveCanonicalProviderStopReason>;
    reason?:
        | 'terminal_not_complete'
        | 'tool_calls_present'
        | 'incomplete_tool_calls_present'
        | 'terminal_conflict';
}

export interface ProviderOutputFailurePresentation {
    title: string;
    progress: string;
    message: string;
    issue: 'provider_output_truncated' | 'provider_output_blocked';
    stopReason: 'provider_output_truncated' | 'provider_output_blocked';
    data: Record<string, unknown>;
}

export class ProviderOutputRecoveryController<TTool extends object> {
    private consecutiveAttempts = 0;
    private totalAttempts = 0;
    private pendingTools: TTool[] | undefined;

    get hasPendingRequest(): boolean {
        return Boolean(this.pendingTools);
    }

    get recoveryAttemptForTokenBudget(): number {
        return this.consecutiveAttempts;
    }

    get recoveryAttempts(): number {
        return this.consecutiveAttempts;
    }

    get recoveryAttemptsInRun(): number {
        return this.totalAttempts;
    }

    reset(): void {
        this.consecutiveAttempts = 0;
        this.totalAttempts = 0;
        this.pendingTools = undefined;
    }

    clearPending(): void {
        this.pendingTools = undefined;
    }

    canSchedule(): boolean {
        return this.consecutiveAttempts < MAX_CONSECUTIVE_RECOVERY_ATTEMPTS
            && this.totalAttempts < MAX_RECOVERY_ATTEMPTS_PER_RUN;
    }

    schedule(tools: readonly TTool[]): void {
        if (!this.canSchedule()) throw new Error('provider_output_recovery_limit_exhausted');
        this.consecutiveAttempts += 1;
        this.totalAttempts += 1;
        this.pendingTools = tools.map((tool) => ({ ...tool }));
    }

    consumePendingTools(): TTool[] | undefined {
        const tools = this.pendingTools;
        this.pendingTools = undefined;
        return tools?.map((tool) => ({ ...tool }));
    }

    markComplete(): void {
        this.consecutiveAttempts = 0;
    }
}

export function isProviderOutputTruncated(stopReason?: string): boolean {
    const canonical = resolveCanonicalProviderStopReason(stopReason);
    return canonical === 'max_tokens' || canonical === 'stream_incomplete';
}

export function isProviderOutputBlocked(stopReason?: string): boolean {
    return resolveCanonicalProviderStopReason(stopReason) === 'content_blocked';
}

export function resolveProviderOutputRecoveryOutcome(
    stopReason: unknown
): ProviderOutputRecoveryOutcome {
    const canonical = resolveCanonicalProviderStopReason(stopReason);
    if (canonical === 'end_turn' || canonical === 'tool_use') return 'succeeded';
    return canonical;
}

/**
 * Read text only after the Provider has produced one unambiguous, natural terminal response.
 *
 * Auxiliary calls do not have the main Agent loop's Tool settlement boundary. Without this
 * reader they could persist a partial paragraph, parse a truncated visual judgment, or mark an
 * image as observed merely because transport returned some content. Empty text is still a valid
 * `end_turn`; callers may apply their existing empty-result fallback, but every incomplete or
 * contradictory terminal is returned with an empty content buffer.
 */
export function readCompleteProviderTextContent(
    response: ProviderToolResponseLike & {
        transportComplete?: unknown;
        terminalConflict?: unknown;
        finishReasonConflict?: unknown;
    }
): CompleteProviderTextContentRead {
    const stopReason = resolveCanonicalProviderStopReason(response?.stopReason);
    if (response?.transportComplete === false || stopReason !== 'end_turn') {
        return {
            complete: false,
            content: '',
            stopReason,
            reason: 'terminal_not_complete'
        };
    }
    if (response?.terminalConflict === true || response?.finishReasonConflict === true) {
        return {
            complete: false,
            content: '',
            stopReason: 'stream_incomplete',
            reason: 'terminal_conflict'
        };
    }
    if (response.toolCalls !== undefined
        && (!Array.isArray(response.toolCalls) || response.toolCalls.length > 0)) {
        return {
            complete: false,
            content: '',
            stopReason: 'stream_incomplete',
            reason: 'tool_calls_present'
        };
    }
    if (response.incompleteToolCallNames !== undefined
        && (!Array.isArray(response.incompleteToolCallNames)
            || response.incompleteToolCallNames.length > 0)) {
        return {
            complete: false,
            content: '',
            stopReason: 'stream_incomplete',
            reason: 'incomplete_tool_calls_present'
        };
    }
    return {
        complete: true,
        content: typeof response.content === 'string' ? response.content : '',
        stopReason
    };
}

function isCompleteProviderToolCall(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const toolCall = value as Record<string, unknown>;
    const argumentsValue = toolCall.arguments;
    return Boolean(
        String(toolCall.id || '').trim()
        && String(toolCall.name || '').trim()
        && argumentsValue
        && typeof argumentsValue === 'object'
        && !Array.isArray(argumentsValue)
    );
}

/**
 * Agent 接收 Provider 结果的唯一结算边界。
 *
 * 只有 `tool_use` 与一组完整 Tool calls 同时成立时才允许进入执行；自然结束必须没有
 * Tool calls。任何协议矛盾都降级为未完成输出并清空调用，防止未来 Provider 或测试注入
 * 绕过各 adapter 的局部校验。
 */
export function settleProviderToolResponse<T extends ProviderToolResponseLike>(response: T): T {
    const toolCalls = Array.isArray(response.toolCalls) ? response.toolCalls : [];
    const canonical = resolveCanonicalProviderStopReason(response.stopReason);
    const uniqueToolCallIds = new Set(
        toolCalls.map((toolCall) => String(toolCall?.id || '').trim())
    );
    const completeToolCalls = toolCalls.length > 0
        && uniqueToolCallIds.size === toolCalls.length
        && toolCalls.every(isCompleteProviderToolCall);
    const protocolComplete = (canonical === 'tool_use' && completeToolCalls)
        || (canonical === 'end_turn' && toolCalls.length === 0);

    if (protocolComplete) {
        return {
            ...response,
            stopReason: canonical,
            toolCalls: canonical === 'tool_use' ? toolCalls : []
        };
    }

    if (canonical === 'max_tokens'
        || canonical === 'stream_incomplete'
        || canonical === 'content_blocked') {
        return {
            ...response,
            stopReason: canonical,
            toolCalls: []
        };
    }

    return {
        ...response,
        stopReason: 'stream_incomplete',
        toolCalls: []
    };
}

export async function requestWithProviderOutputRecoveryAccounting<T extends ProviderToolResponseLike>(input: {
    recoveryRequest: boolean;
    onRecoveryAttempt: () => void;
    onRecoveryOutcome: (outcome: ProviderOutputRecoveryOutcome) => void;
    request: () => Promise<T>;
}): Promise<T> {
    if (input.recoveryRequest) input.onRecoveryAttempt();
    try {
        const response = settleProviderToolResponse(await input.request());
        if (input.recoveryRequest) {
            input.onRecoveryOutcome(resolveProviderOutputRecoveryOutcome(response.stopReason));
        }
        return response;
    } catch (error) {
        if (input.recoveryRequest) input.onRecoveryOutcome('request_error');
        throw error;
    }
}

export function buildProviderOutputContinuationPrompt(input: {
    truncatedToolNames: readonly string[];
    requiresRealAction: boolean;
}): string {
    return [
        input.truncatedToolNames.length > 0
            ? `上一次输出因长度上限中断，中断发生在工具调用 ${input.truncatedToolNames.join(' / ')} 的参数上。请只保留必要字段；项目内资源优先使用相对路径或稳定引用；当前 schema 提供目录、批量或集合参数时优先使用；仍然过长就拆成有界的多次调用，不要原样重发。`
            : '上一次输出没有完整返回。',
        input.requiresRealAction
            ? '当前任务仍要求真实动作；请停止扩展分析，直接从本轮仍可用的工具中选择下一项必要动作。'
            : '请重新给出一份完整、精简、可独立阅读的最终回答；不要只续写后半段，也不要向用户解释本次恢复。',
        '所有用户可见内容和 provider-visible reasoning_content 都使用简体中文。',
        '从设计目标、视觉依据和下一步动作表达，不复述系统、Harness、工具名、路由、门禁、轮次或调试信息。'
    ].join('\n');
}

export function buildProviderOutputFailurePresentation(input: {
    kind: 'truncated' | 'blocked';
    phase?: 'agent_turn' | 'forced_final_summary';
    recoveryAttempts?: number;
    recoveryAttemptsInRun?: number;
    hasPhotoshopMutation: boolean;
    taskProgressPreserved: boolean;
}): ProviderOutputFailurePresentation {
    if (input.kind === 'blocked') {
        const message = input.hasPhotoshopMutation
            ? '这次请求被模型服务拦截，没能返回可用的完整结果。前面的 Photoshop 改动已保留，但任务还没有完成。'
            : '这次请求被模型服务拦截，没能返回可用的完整结果；尚未修改 Photoshop 画面。';
        return {
            title: '没有取得可用结果，已停止',
            progress: '没有取得可用结果，本次已停止',
            message,
            issue: 'provider_output_blocked',
            stopReason: 'provider_output_blocked',
            data: {
                providerOutputBlocked: {
                    taskProgressPreserved: input.taskProgressPreserved,
                    photoshopMutationPreserved: input.hasPhotoshopMutation
                }
            }
        };
    }
    const message = input.hasPhotoshopMutation
        ? '这次没有拿到完整结果。前面的 Photoshop 改动已保留，但任务还没有完成。为避免用残缺内容继续修改画面，我已停止本轮。'
        : '这次没有拿到完整结果，尚未修改 Photoshop 画面。为避免根据残缺内容误操作，我已停止本轮。';
    return {
        title: '回复不完整，已停止',
        progress: '回复不完整，本次已停止',
        message,
        issue: 'provider_output_truncated',
        stopReason: 'provider_output_truncated',
        data: {
            providerOutputTruncated: {
                phase: input.phase || 'agent_turn',
                recoveryAttempts: input.recoveryAttempts || 0,
                recoveryAttemptsInRun: input.recoveryAttemptsInRun || 0,
                taskProgressPreserved: input.taskProgressPreserved,
                photoshopMutationPreserved: input.hasPhotoshopMutation
            }
        }
    };
}
