export type AgentObservationChannelVersion = 'agent-observation-channels/v0';

export type AgentObservationSource =
    | 'provider_thinking_delta'
    | 'provider_final_thinking'
    | 'model_visible_reasoning'
    | 'assistant_content_delta'
    | 'tool_call_started'
    | 'tool_call_completed'
    | 'visible_activity'
    | 'execution_lifecycle_snapshot'
    | 'acceptance_diagnostic'
    | 'hidden_evidence'
    | 'local_placeholder';

export type AgentObservationChannel =
    | 'thinking'
    | 'assistant_content'
    | 'tool_call'
    | 'activity'
    | 'hidden_diagnostic'
    | 'blocked';

export interface AgentThinkingEventMeta {
    source: AgentObservationSource;
}

export interface AgentObservationChannelInput {
    source: AgentObservationSource;
    content?: unknown;
    toolName?: unknown;
}

export interface AgentObservationChannelPolicy {
    version: AgentObservationChannelVersion;
    source: AgentObservationSource;
    channel: AgentObservationChannel;
    content: string;
    toolName?: string;
    userVisible: boolean;
    evidenceOnly: boolean;
    canPersistToThinkingSteps: boolean;
    canRenderInThinkingPanel: boolean;
    canRenderInToolPanel: boolean;
    isProviderThinking: boolean;
    canClaimModelReasoning: boolean;
    canClaimTaskCompletion: false;
    mustNotRunProvider: true;
    mustNotRunPhotoshop: true;
    reason: string;
}

const LOCAL_PLACEHOLDER_PATTERNS = [
    /等待响应/,
    /正在准备/,
    /请求已发送/,
    /等待模型返回/,
    /正在处理你的需求/
];

export function classifyAgentObservationChannel(
    input: AgentObservationChannelInput
): AgentObservationChannelPolicy {
    const content = normalizeText(input.content);
    const toolName = normalizeText(input.toolName);

    if (input.source === 'local_placeholder' || isLocalPlaceholder(content)) {
        return buildPolicy(input, {
            channel: 'blocked',
            content,
            toolName,
            userVisible: false,
            evidenceOnly: true,
            canPersistToThinkingSteps: false,
            canRenderInThinkingPanel: false,
            canRenderInToolPanel: false,
            isProviderThinking: false,
            canClaimModelReasoning: false,
            reason: 'Local waiting/preparing placeholders must not be shown as model thinking.'
        });
    }

    switch (input.source) {
        case 'provider_thinking_delta':
        case 'provider_final_thinking':
            return buildPolicy(input, {
                channel: 'thinking',
                content,
                toolName,
                userVisible: Boolean(content),
                evidenceOnly: false,
                canPersistToThinkingSteps: Boolean(content),
                canRenderInThinkingPanel: Boolean(content),
                canRenderInToolPanel: false,
                isProviderThinking: true,
                canClaimModelReasoning: true,
                reason: 'Provider supplied explicit thinking/reasoning text.'
            });
        case 'model_visible_reasoning':
            return buildPolicy(input, {
                channel: 'thinking',
                content,
                toolName,
                userVisible: Boolean(content),
                evidenceOnly: false,
                canPersistToThinkingSteps: Boolean(content),
                canRenderInThinkingPanel: Boolean(content),
                canRenderInToolPanel: false,
                isProviderThinking: false,
                canClaimModelReasoning: false,
                reason: 'Model-authored public reasoning summary, not private chain-of-thought.'
            });
        case 'assistant_content_delta':
            return buildPolicy(input, {
                channel: 'assistant_content',
                content,
                toolName,
                userVisible: Boolean(content),
                evidenceOnly: false,
                canPersistToThinkingSteps: false,
                canRenderInThinkingPanel: false,
                canRenderInToolPanel: false,
                isProviderThinking: false,
                canClaimModelReasoning: false,
                reason: 'Assistant content belongs in the assistant message body.'
            });
        case 'tool_call_started':
        case 'tool_call_completed':
            return buildPolicy(input, {
                channel: 'tool_call',
                content,
                toolName,
                userVisible: Boolean(content || toolName),
                evidenceOnly: false,
                canPersistToThinkingSteps: false,
                canRenderInThinkingPanel: false,
                canRenderInToolPanel: Boolean(content || toolName),
                isProviderThinking: false,
                canClaimModelReasoning: false,
                reason: 'Tool events render in the tool-call panel, not as model thinking.'
            });
        case 'visible_activity':
        case 'execution_lifecycle_snapshot':
            return buildPolicy(input, {
                channel: 'activity',
                content,
                toolName,
                userVisible: true,
                evidenceOnly: true,
                canPersistToThinkingSteps: false,
                canRenderInThinkingPanel: false,
                canRenderInToolPanel: false,
                isProviderThinking: false,
                canClaimModelReasoning: false,
                reason: 'Execution activity is state evidence, not model thinking.'
            });
        case 'acceptance_diagnostic':
        case 'hidden_evidence':
            return buildPolicy(input, {
                channel: 'hidden_diagnostic',
                content,
                toolName,
                userVisible: false,
                evidenceOnly: true,
                canPersistToThinkingSteps: false,
                canRenderInThinkingPanel: false,
                canRenderInToolPanel: false,
                isProviderThinking: false,
                canClaimModelReasoning: false,
                reason: 'Acceptance and debug evidence stay hidden unless rendered by developer diagnostics.'
            });
        default:
            return buildPolicy(input, {
                channel: 'blocked',
                content,
                toolName,
                userVisible: false,
                evidenceOnly: true,
                canPersistToThinkingSteps: false,
                canRenderInThinkingPanel: false,
                canRenderInToolPanel: false,
                isProviderThinking: false,
                canClaimModelReasoning: false,
                reason: 'Unknown observation source is blocked by default.'
            });
    }
}

export function canObservationEnterThinkingSteps(
    policy: AgentObservationChannelPolicy | undefined
): boolean {
    return Boolean(policy?.canPersistToThinkingSteps && policy.canRenderInThinkingPanel);
}

export function canObservationRenderAsToolCall(
    policy: AgentObservationChannelPolicy | undefined
): boolean {
    return Boolean(policy?.channel === 'tool_call' && policy.canRenderInToolPanel);
}

export function isAgentObservationChannelBoundaryOk(
    policy: AgentObservationChannelPolicy | undefined
): boolean | undefined {
    if (!policy) return undefined;
    if (policy.mustNotRunProvider !== true || policy.mustNotRunPhotoshop !== true) return false;
    if (policy.canClaimTaskCompletion !== false) return false;
    if (policy.channel !== 'thinking' && policy.canClaimModelReasoning !== false) return false;
    if (policy.channel !== 'thinking' && policy.canRenderInThinkingPanel) return false;
    if (policy.channel !== 'thinking' && policy.canPersistToThinkingSteps) return false;
    if (policy.source === 'model_visible_reasoning' && policy.canClaimModelReasoning !== false) return false;
    return true;
}

function buildPolicy(
    input: AgentObservationChannelInput,
    policy: Omit<AgentObservationChannelPolicy, 'version' | 'source' | 'canClaimTaskCompletion' | 'mustNotRunProvider' | 'mustNotRunPhotoshop'>
): AgentObservationChannelPolicy {
    return {
        version: 'agent-observation-channels/v0',
        source: input.source,
        canClaimTaskCompletion: false,
        mustNotRunProvider: true,
        mustNotRunPhotoshop: true,
        ...policy
    };
}

function normalizeText(value: unknown): string {
    return String(value || '').trim();
}

function isLocalPlaceholder(content: string): boolean {
    if (!content) return false;
    return LOCAL_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(content));
}
