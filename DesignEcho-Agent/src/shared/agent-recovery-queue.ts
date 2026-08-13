/**
 * Agent 恢复意图队列。
 *
 * 该模块只负责下一轮恢复意图的优先级、排队和一次性消费：
 * - 不执行工具；
 * - 不授予权限；
 * - 不推进 Runtime 阶段；
 * - 不声明任务完成或设计质量。
 *
 * 把这部分状态挂在 Agent 循环上，避免每条恢复路径各自维护一套
 * pending / active 标志并互相覆盖。
 */

export type AgentRecoverySource =
    | 'tool_decision'
    | 'harness_control_repair'
    | 'workflow_continuation'
    | 'liveness_recovery'
    | 'runtime_action_replan'
    | 'tool_preflight'
    | 'required_tool_result'
    | 'required_tool_no_call'
    | 'promised_tool_no_call';

export type AgentRecoveryMode = 'allowlist' | 'stop';

export type AgentRecoveryObligationClass =
    | 'safety'
    | 'control'
    | 'delivery'
    | 'liveness';

export interface AgentRecoveryIntent {
    id: string;
    source: AgentRecoverySource;
    allowedToolNames: string[];
    mode: AgentRecoveryMode;
    obligationClass: AgentRecoveryObligationClass;
    reason: string;
    issuedAtIteration: number;
    priority: number;
    sequence: number;
}

export interface AgentRecoveryRequest {
    source: AgentRecoverySource;
    allowedToolNames: Iterable<string>;
    mode?: AgentRecoveryMode;
    obligationClass?: AgentRecoveryObligationClass;
    reason: string;
    issuedAtIteration: number;
}

export interface AgentRecoveryScheduleResult {
    disposition: 'selected' | 'deferred' | 'coalesced' | 'superseded';
    scheduled: AgentRecoveryIntent;
    head: AgentRecoveryIntent;
    pendingCount: number;
}

const AGENT_RECOVERY_SOURCE_PRIORITY: Readonly<Record<AgentRecoverySource, number>> = Object.freeze({
    harness_control_repair: 100,
    runtime_action_replan: 95,
    workflow_continuation: 88,
    liveness_recovery: 85,
    required_tool_result: 80,
    required_tool_no_call: 80,
    tool_preflight: 70,
    tool_decision: 60,
    promised_tool_no_call: 50
});

const AGENT_RECOVERY_OBLIGATION_PRIORITY: Readonly<Record<AgentRecoveryObligationClass, number>> = Object.freeze({
    safety: 4_000,
    control: 3_000,
    delivery: 2_000,
    liveness: 1_000
});

const DEFAULT_OBLIGATION_CLASS: Readonly<Record<AgentRecoverySource, AgentRecoveryObligationClass>> = Object.freeze({
    tool_decision: 'control',
    harness_control_repair: 'control',
    workflow_continuation: 'delivery',
    liveness_recovery: 'liveness',
    runtime_action_replan: 'delivery',
    tool_preflight: 'control',
    required_tool_result: 'delivery',
    required_tool_no_call: 'delivery',
    promised_tool_no_call: 'delivery'
});

function cloneAgentRecoveryIntent(
    intent: AgentRecoveryIntent | undefined
): AgentRecoveryIntent | undefined {
    if (!intent) return undefined;
    return {
        ...intent,
        allowedToolNames: [...intent.allowedToolNames]
    };
}

function normalizeAgentRecoveryRequest(
    input: AgentRecoveryRequest,
    sequence: number
): AgentRecoveryIntent {
    const allowedToolNames = Array.from(new Set(
        Array.from(input.allowedToolNames)
            .map((toolName) => String(toolName || '').trim())
            .filter(Boolean)
    ));
    const obligationClass = input.obligationClass || DEFAULT_OBLIGATION_CLASS[input.source];
    const mode = input.mode || (allowedToolNames.length > 0 ? 'allowlist' : 'stop');
    return {
        id: `agent-recovery-${sequence}`,
        source: input.source,
        allowedToolNames,
        mode,
        obligationClass,
        reason: String(input.reason || '').trim().slice(0, 240),
        issuedAtIteration: Math.max(0, Math.floor(Number(input.issuedAtIteration) || 0)),
        priority: AGENT_RECOVERY_OBLIGATION_PRIORITY[obligationClass]
            + AGENT_RECOVERY_SOURCE_PRIORITY[input.source],
        sequence
    };
}

function compareAgentRecoveryIntent(
    left: AgentRecoveryIntent,
    right: AgentRecoveryIntent
): number {
    if (left.priority !== right.priority) {
        return right.priority - left.priority;
    }
    return left.sequence - right.sequence;
}

function buildAgentRecoveryCoalesceKey(intent: AgentRecoveryIntent): string {
    return [
        intent.source,
        intent.mode,
        intent.obligationClass,
        [...intent.allowedToolNames].sort().join(','),
        intent.reason
    ].join('|');
}

export class AgentRecoveryQueue {
    private pending: AgentRecoveryIntent[] = [];
    private active: AgentRecoveryIntent | undefined;
    private sequence = 0;

    clear(): void {
        this.pending = [];
        this.active = undefined;
        this.sequence = 0;
    }

    clearPending(): void {
        this.pending = [];
    }

    clearSource(source: AgentRecoverySource): void {
        this.pending = this.pending.filter((intent) => intent.source !== source);
        if (this.active?.source === source) {
            this.active = undefined;
        }
    }

    schedule(input: AgentRecoveryRequest): AgentRecoveryScheduleResult {
        const previousHeadId = this.pending[0]?.id;
        this.sequence += 1;
        const next = normalizeAgentRecoveryRequest(input, this.sequence);
        const coalesceKey = buildAgentRecoveryCoalesceKey(next);
        const existing = this.pending.find((intent) => (
            buildAgentRecoveryCoalesceKey(intent) === coalesceKey
        ));
        if (existing) {
            return {
                disposition: 'coalesced',
                scheduled: cloneAgentRecoveryIntent(existing) as AgentRecoveryIntent,
                head: cloneAgentRecoveryIntent(this.pending[0]) as AgentRecoveryIntent,
                pendingCount: this.pending.length
            };
        }
        if (next.mode === 'stop') {
            const retainedSafetyObligations = this.pending.filter((intent) => (
                intent.obligationClass === 'safety'
            ));
            this.pending = next.obligationClass === 'safety'
                ? [next]
                : [...retainedSafetyObligations, next].sort(compareAgentRecoveryIntent);
        } else {
            this.pending.push(next);
            this.pending.sort(compareAgentRecoveryIntent);
        }
        const head = this.pending[0];
        let disposition: AgentRecoveryScheduleResult['disposition'] = 'deferred';
        if (head.id === next.id) {
            disposition = previousHeadId && previousHeadId !== next.id
                ? 'superseded'
                : 'selected';
        }
        return {
            disposition,
            scheduled: cloneAgentRecoveryIntent(next) as AgentRecoveryIntent,
            head: cloneAgentRecoveryIntent(head) as AgentRecoveryIntent,
            pendingCount: this.pending.length
        };
    }

    peekPending(): AgentRecoveryIntent | undefined {
        return cloneAgentRecoveryIntent(this.pending[0]);
    }

    pendingCount(): number {
        return this.pending.length;
    }

    hasPending(): boolean {
        return this.pending.length > 0;
    }

    activateForTurn(input: { continueActive?: boolean } = {}): AgentRecoveryIntent | undefined {
        if (input.continueActive) {
            return cloneAgentRecoveryIntent(this.active);
        }
        this.active = this.pending.shift();
        return cloneAgentRecoveryIntent(this.active);
    }

    peekActive(): AgentRecoveryIntent | undefined {
        return cloneAgentRecoveryIntent(this.active);
    }

    getActiveToolNames(): Set<string> | null {
        if (!this.active) return null;
        return new Set(this.active.allowedToolNames);
    }
}
