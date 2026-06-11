import type {
    AgentIntentControlPlaneDecision,
    AgentIntentToolScope
} from './agent-intent-control-plane';
import {
    buildAgentToolExecutionPreflight,
    classifyAgentToolExecution,
    type AgentToolExecutionKind,
    type AgentToolExecutionPreflightLogEntry
} from './agent-tool-execution-preflight';

export type AgentToolDecisionContractVersion = 'agent-tool-decision-contract/v0';

export type AgentToolDecisionContractStatus = 'ready' | 'blocked' | 'not_applicable';

export type AgentToolDecisionContractNextAction =
    | 'execute_tools'
    | 'answer_without_tools'
    | 'model_replan_without_tools'
    | 'model_replan_with_allowed_tools'
    | 'respect_system_boundary';

export type AgentToolDecisionCapabilityScope =
    | 'none'
    | 'read_only'
    | 'write_photoshop'
    | 'external_generation'
    | 'stateful_context'
    | 'unknown';

export type AgentToolDecisionBlockerCode =
    | 'intent_scope_disallows_tools'
    | 'tool_scope_exceeds_intent'
    | 'tool_unavailable'
    | 'photoshop_not_connected'
    | 'photoshop_document_required'
    | 'missing_public_plan'
    | 'missing_verification_target'
    | 'missing_prior_document_evidence'
    | 'unknown_tool_kind';

export interface AgentToolDecisionCandidateTool {
    name: string;
    kind: AgentToolExecutionKind;
    scope: AgentToolDecisionCapabilityScope;
    available: boolean;
}

export interface AgentToolDecisionBlocker {
    code: AgentToolDecisionBlockerCode;
    message: string;
    toolName?: string;
}

export interface AgentToolDecisionRuntime {
    availableTools?: string[];
    photoshopConnected?: boolean;
    hasDocument?: boolean;
}

export interface AgentToolDecisionToolCall {
    id?: string;
    name: string;
    arguments?: any;
}

export interface BuildAgentToolDecisionContractInput {
    userInput: unknown;
    intentControlPlane?: AgentIntentControlPlaneDecision;
    assistantContent?: string;
    toolCalls?: AgentToolDecisionToolCall[];
    completedToolCalls?: AgentToolExecutionPreflightLogEntry[];
    runtime?: AgentToolDecisionRuntime;
}

export interface AgentToolDecisionContract {
    version: AgentToolDecisionContractVersion;
    status: AgentToolDecisionContractStatus;
    nextAction: AgentToolDecisionContractNextAction;
    intentToolScope: AgentIntentToolScope | 'unknown';
    userInputSummary: string;
    candidateTools: AgentToolDecisionCandidateTool[];
    allowedToolCalls: AgentToolDecisionToolCall[];
    blockers: AgentToolDecisionBlocker[];
    warnings: string[];
    evidence: {
        hasPublicPlan: boolean;
        hasVerificationTarget: boolean;
        hasPriorDocumentEvidence: boolean;
        priorEvidenceTools: string[];
    };
}

const WRITE_SCOPES = new Set<AgentToolDecisionCapabilityScope>([
    'write_photoshop'
]);

const PHOTOSHOP_DOCUMENT_SCOPES = new Set<AgentToolDecisionCapabilityScope>([
    'read_only',
    'write_photoshop',
    'stateful_context'
]);

const DOCUMENT_OPTIONAL_TOOLS = new Set([
    'createDocument',
    'listDocuments',
    'listProjectResources',
    'searchProjectResources',
    'generateImage'
]);

function normalizeText(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeToolName(value: unknown): string {
    return String(value || '').trim();
}

function unique<T>(items: T[]): T[] {
    return Array.from(new Set(items));
}

function classifyScope(kind: AgentToolExecutionKind): AgentToolDecisionCapabilityScope {
    if (kind === 'read_only_evidence') return 'read_only';
    if (kind === 'photoshop_write' || kind === 'save_export') return 'write_photoshop';
    if (kind === 'external_generation') return 'external_generation';
    if (kind === 'stateful_context') return 'stateful_context';
    return 'unknown';
}

function canIntentUseScope(
    intentScope: AgentIntentToolScope | 'unknown',
    candidateScope: AgentToolDecisionCapabilityScope
): boolean {
    if (candidateScope === 'external_generation') {
        return intentScope !== 'none';
    }
    if (candidateScope === 'stateful_context') {
        return intentScope === 'write_photoshop';
    }
    if (candidateScope === 'unknown') {
        return false;
    }
    if (intentScope === 'write_photoshop') {
        return candidateScope === 'read_only' || candidateScope === 'write_photoshop';
    }
    if (intentScope === 'read_only') {
        return candidateScope === 'read_only';
    }
    return false;
}

function blocker(
    code: AgentToolDecisionBlockerCode,
    message: string,
    toolName?: string
): AgentToolDecisionBlocker {
    return { code, message, toolName };
}

function buildCandidateTools(
    toolCalls: AgentToolDecisionToolCall[],
    runtime?: AgentToolDecisionRuntime
): AgentToolDecisionCandidateTool[] {
    const availableSet = new Set(
        Array.isArray(runtime?.availableTools)
            ? runtime.availableTools.map((name) => normalizeToolName(name)).filter(Boolean)
            : []
    );
    const hasExplicitAvailableList = availableSet.size > 0;

    return toolCalls
        .map((call) => {
            const name = normalizeToolName(call?.name);
            const kind = classifyAgentToolExecution(name, call?.arguments);
            return {
                name,
                kind,
                scope: classifyScope(kind),
                available: !hasExplicitAvailableList || availableSet.has(name)
            };
        })
        .filter((item) => item.name);
}

function buildSameBatchEvidence(
    toolCalls: AgentToolDecisionToolCall[]
): AgentToolExecutionPreflightLogEntry[] {
    const entries: AgentToolExecutionPreflightLogEntry[] = [];
    for (const call of toolCalls) {
        const name = normalizeToolName(call?.name);
        if (!name) continue;
        const kind = classifyAgentToolExecution(name, call?.arguments);
        if (kind === 'photoshop_write' || kind === 'save_export') break;
        if (kind !== 'read_only_evidence') continue;
        entries.push({
            name,
            result: { success: true, source: 'same_batch_tool_decision_contract' }
        });
    }
    return entries;
}

function mapPreflightBlocker(message: string): AgentToolDecisionBlockerCode {
    if (/公开|计划/.test(message)) return 'missing_public_plan';
    if (/复核|验证|检查|回读|截图|快照/.test(message)) return 'missing_verification_target';
    if (/文档|画面|图层|读取证据/.test(message)) return 'missing_prior_document_evidence';
    return 'missing_prior_document_evidence';
}

function resolveNextAction(
    blockers: AgentToolDecisionBlocker[],
    allowedToolCalls: AgentToolDecisionToolCall[]
): AgentToolDecisionContractNextAction {
    if (blockers.some((item) => item.code === 'intent_scope_disallows_tools')) {
        return 'model_replan_without_tools';
    }
    if (blockers.some((item) => item.code === 'tool_scope_exceeds_intent')) {
        return allowedToolCalls.length > 0 ? 'model_replan_with_allowed_tools' : 'model_replan_without_tools';
    }
    if (blockers.some((item) => item.code === 'tool_unavailable')) {
        return 'model_replan_with_allowed_tools';
    }
    if (blockers.some((item) => item.code === 'photoshop_not_connected' || item.code === 'photoshop_document_required')) {
        return 'respect_system_boundary';
    }
    return 'model_replan_with_allowed_tools';
}

export function buildAgentToolDecisionContract(
    input: BuildAgentToolDecisionContractInput
): AgentToolDecisionContract {
    const toolCalls = Array.isArray(input.toolCalls) ? input.toolCalls : [];
    const candidateTools = buildCandidateTools(toolCalls, input.runtime);
    const intentToolScope = input.intentControlPlane?.toolScope || 'unknown';
    const userInputSummary = normalizeText(input.userInput).slice(0, 160);
    const completedToolCalls = Array.isArray(input.completedToolCalls) ? input.completedToolCalls : [];
    const sameBatchEvidence = buildSameBatchEvidence(toolCalls);
    const preflight = buildAgentToolExecutionPreflight({
        assistantContent: input.assistantContent,
        toolCalls,
        completedToolCalls: [
            ...completedToolCalls,
            ...sameBatchEvidence
        ]
    });

    const blockers: AgentToolDecisionBlocker[] = [];
    const warnings = [...preflight.warnings];

    if (candidateTools.length === 0) {
        return {
            version: 'agent-tool-decision-contract/v0',
            status: 'not_applicable',
            nextAction: 'answer_without_tools',
            intentToolScope,
            userInputSummary,
            candidateTools,
            allowedToolCalls: [],
            blockers,
            warnings,
            evidence: preflight.evidence
        };
    }

    for (const candidate of candidateTools) {
        if (intentToolScope === 'none') {
            blockers.push(blocker(
                'intent_scope_disallows_tools',
                '当前意图不允许调用工具，模型需要直接回答或重新规划为无工具回复。',
                candidate.name
            ));
            continue;
        }

        if (!candidate.available) {
            blockers.push(blocker(
                'tool_unavailable',
                `工具 ${candidate.name} 不在当前可用工具列表中，不能交给运行时执行。`,
                candidate.name
            ));
        }

        if (candidate.scope === 'unknown') {
            blockers.push(blocker(
                'unknown_tool_kind',
                `工具 ${candidate.name} 没有已知能力分类，不能默认执行。`,
                candidate.name
            ));
        }

        if (!canIntentUseScope(intentToolScope, candidate.scope)) {
            blockers.push(blocker(
                'tool_scope_exceeds_intent',
                `工具 ${candidate.name} 的能力范围超过当前意图允许的工具范围。`,
                candidate.name
            ));
        }

        if (candidate.scope === 'external_generation') {
            warnings.push(`${candidate.name} 属于 external_generation，不依赖当前 Photoshop 文档，但生成结果进入文档前仍需用户或后续流程确认。`);
        }

        if (PHOTOSHOP_DOCUMENT_SCOPES.has(candidate.scope)) {
            if (input.runtime?.photoshopConnected === false) {
                blockers.push(blocker(
                    'photoshop_not_connected',
                    `工具 ${candidate.name} 需要 Photoshop 连接，但当前连接不可用。`,
                    candidate.name
                ));
            }
            if (input.runtime?.hasDocument === false && !DOCUMENT_OPTIONAL_TOOLS.has(candidate.name)) {
                blockers.push(blocker(
                    'photoshop_document_required',
                    `工具 ${candidate.name} 需要当前 Photoshop 文档，但运行时没有可用文档。`,
                    candidate.name
                ));
            }
        }
    }

    if (!preflight.ready && preflight.status === 'blocked') {
        for (const item of preflight.blockers) {
            const code = mapPreflightBlocker(item);
            blockers.push(blocker(code, item, preflight.blockedTool?.name));
        }
    }

    const dedupedBlockers = unique(
        blockers.map((item) => `${item.code}:${item.toolName || ''}:${item.message}`)
    ).map((serialized) => {
        const [code, toolName, ...messageParts] = serialized.split(':');
        return {
            code: code as AgentToolDecisionBlockerCode,
            toolName: toolName || undefined,
            message: messageParts.join(':')
        };
    });

    const blockedToolNames = new Set(dedupedBlockers.map((item) => item.toolName).filter(Boolean));
    const allowedToolCalls = toolCalls.filter((call) => !blockedToolNames.has(normalizeToolName(call?.name)));
    const status = dedupedBlockers.length > 0 ? 'blocked' : 'ready';
    return {
        version: 'agent-tool-decision-contract/v0',
        status,
        nextAction: status === 'ready'
            ? 'execute_tools'
            : resolveNextAction(dedupedBlockers, allowedToolCalls),
        intentToolScope,
        userInputSummary,
        candidateTools,
        allowedToolCalls: status === 'ready' ? toolCalls : allowedToolCalls,
        blockers: dedupedBlockers,
        warnings: unique(warnings),
        evidence: preflight.evidence
    };
}

export function formatAgentToolDecisionContractBlocker(
    contract: AgentToolDecisionContract
): string {
    if (contract.status !== 'blocked') {
        return '';
    }
    const firstBlockedToolName = contract.blockers.find((item) => item.toolName)?.toolName;
    const lines = [
        firstBlockedToolName
            ? `已阻止工具执行：${firstBlockedToolName}。`
            : '工具决策契约未通过，已阻止本轮工具执行。'
    ];
    if (firstBlockedToolName) {
        lines.push('工具决策契约未通过，已阻止本轮工具执行。');
    }
    for (const blockerItem of contract.blockers.slice(0, 5)) {
        lines.push(blockerItem.toolName
            ? `- ${blockerItem.toolName}: ${blockerItem.message}`
            : `- ${blockerItem.message}`);
    }
    if (contract.blockers.length > 5) {
        lines.push(`- 其余阻断项 ${contract.blockers.length - 5} 个。`);
    }
    return lines.join('\n');
}
