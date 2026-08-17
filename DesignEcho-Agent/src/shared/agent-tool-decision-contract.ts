import { AGENT_TOOL_DECISION_POLICY_CAPABILITY_ID } from './agent-runtime-v5/capability-provider-identities';
import type {
    AgentIntentControlPlaneDecision,
    AgentIntentToolScope
} from './agent-intent-control-plane';
import {
    classifyAgentToolExecution,
    isAgentHarnessControlTool,
    isReadOnlyAgentContextTool,
    type AgentToolExecutionKind,
    type AgentToolExecutionPreflightLogEntry
} from './agent-tool-execution-preflight';
import { getAgentToolDecisionNextActionPublicText } from './agent-user-visible-state';
import { canAgentToolStartWithoutOpenDocument } from './document-optional-tools';
import {
    capabilityBlocksExecution,
    resolveDeclaredCapabilityVerdict
} from './model-capability-verdict';

export type AgentToolDecisionContractVersion = typeof AGENT_TOOL_DECISION_POLICY_CAPABILITY_ID;

export type AgentToolDecisionContractStatus = 'ready' | 'blocked' | 'not_applicable';

export type AgentToolDecisionContractNextAction =
    | 'execute_tools'
    | 'answer_without_tools'
    | 'model_replan_without_tools'
    | 'model_replan_with_allowed_tools'
    | 'respect_system_boundary';

export type AgentToolDecisionCapabilityScope =
    | 'none'
    | 'knowledge_search'
    | 'read_only'
    | 'write_photoshop'
    | 'external_generation'
    | 'stateful_context'
    | 'unknown';

export type AgentToolDecisionBlockerCode =
    | 'intent_scope_disallows_tools'
    | 'tool_scope_exceeds_intent'
    | 'execution_authorization_required'
    | 'tool_unavailable'
    | 'photoshop_not_connected'
    | 'photoshop_document_required'
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
    /**
     * GATE-SIMPLIFY-008：结构化升级出口——被拦后模型可以一步到位的具体解锁选项，
     * 取代「当前条件还不够完整」式无出路拒绝（gates-definitions 4.3 空转病例）。
     */
    unlockOptions?: string[];
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
}

const WRITE_SCOPES = new Set<AgentToolDecisionCapabilityScope>([
    'write_photoshop'
]);

const PHOTOSHOP_DOCUMENT_SCOPES = new Set<AgentToolDecisionCapabilityScope>([
    'read_only',
    'write_photoshop',
    'stateful_context'
]);

const PHOTOSHOP_CONNECTION_OPTIONAL_TOOLS = new Set([
    // 只扩展下一轮模型 schema，不访问 Photoshop，也不要求插件连接。
    'requestAgentCapabilities'
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
    if (kind === 'knowledge_search') return 'knowledge_search';
    if (kind === 'read_only_observation') return 'read_only';
    if (kind === 'photoshop_write' || kind === 'save_export') return 'write_photoshop';
    if (kind === 'external_generation') return 'external_generation';
    if (kind === 'stateful_context') return 'stateful_context';
    return 'unknown';
}

function canIntentUseScope(
    intentScope: AgentIntentToolScope | 'unknown',
    candidateScope: AgentToolDecisionCapabilityScope,
    toolName?: string
): boolean {
    if (candidateScope === 'external_generation') {
        return intentScope === 'write_photoshop';
    }
    if (candidateScope === 'knowledge_search') {
        return intentScope === 'knowledge_search' || intentScope === 'write_photoshop';
    }
    if (candidateScope === 'stateful_context') {
        return intentScope === 'write_photoshop'
            || (
                (intentScope === 'read_only' || intentScope === 'knowledge_search')
                && isReadOnlyAgentContextTool(toolName)
            );
    }
    if (candidateScope === 'unknown') {
        return false;
    }
    if (intentScope === 'write_photoshop') {
        return candidateScope === 'read_only'
            || candidateScope === 'write_photoshop';
    }
    if (intentScope === 'read_only') {
        return candidateScope === 'read_only';
    }
    return false;
}

function requiresConfirmedExecutionAuthorization(
    candidate: AgentToolDecisionCandidateTool
): boolean {
    if (candidate.scope === 'write_photoshop' || candidate.scope === 'external_generation') {
        return true;
    }
    return candidate.scope === 'stateful_context'
        && !isReadOnlyAgentContextTool(candidate.name);
}

/**
 * 每轮模型 schema 与最终 ToolDecision 共用的能力判据。
 *
 * 这只是可见性收敛，不是执行授权：真实调用仍必须重新经过
 * buildAgentToolDecisionContract。把 candidate_only 下必然会被拒绝的写工具提前隐藏，
 * 可以避免模型反复选择同一条死路。
 */
export function isAgentToolVisibleForIntentDecision(
    toolName: string,
    decision?: Pick<AgentIntentControlPlaneDecision, 'toolScope' | 'executionAuthorization'> | null
): boolean {
    if (!decision) return true;
    if (decision.toolScope === 'none') return false;
    if (isAgentHarnessControlTool(toolName)) return true;

    const candidate: AgentToolDecisionCandidateTool = {
        name: normalizeToolName(toolName),
        kind: classifyAgentToolExecution(toolName),
        scope: classifyScope(classifyAgentToolExecution(toolName)),
        available: true
    };
    if (candidate.scope === 'unknown') return false;
    if (requiresConfirmedExecutionAuthorization(candidate)
        && decision.executionAuthorization !== 'confirmed_tool_required') {
        return false;
    }
    return canIntentUseScope(decision.toolScope, candidate.scope, candidate.name);
}

function blocker(
    code: AgentToolDecisionBlockerCode,
    message: string,
    toolName?: string,
    unlockOptions?: string[]
): AgentToolDecisionBlocker {
    return {
        code,
        message,
        toolName,
        ...(Array.isArray(unlockOptions) && unlockOptions.length > 0
            ? { unlockOptions: unlockOptions.map((item) => String(item).trim()).filter(Boolean) }
            : {})
    };
}

/** 意图工具范围的中文描述（用于拒绝消息里说明"允许的范围是什么"，给模型可行的重规划方向） */
function describeIntentToolScope(scope: AgentIntentToolScope | 'unknown'): string {
    switch (scope) {
        case 'none':
            return '仅对话说明';
        case 'knowledge_search':
            return '知识检索';
        case 'read_only':
            return '只读分析';
        case 'write_photoshop':
            return '读取并修改画面';
        default:
            return '未明确';
    }
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
    // `[]` 是一个明确的“本轮没有可执行工具”边界，不是“未提供清单”。
    // 若按 size 判断，模型在空工具面下臆造的调用会绕过 unavailable 预检并抵达执行器。
    const hasExplicitAvailableList = Array.isArray(runtime?.availableTools);

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

function toolResultSucceeded(result: any): boolean {
    return result?.success !== false;
}

function resultIndicatesOpenDocument(result: any): boolean {
    if (!result || typeof result !== 'object' || !toolResultSucceeded(result)) return false;
    // Controlled workflow bridges may create the target document internally and
    // expose that fact as structured data instead of flattening an atomic
    // createDocument result. This refreshes only document presence; later writes
    // still need a document-id-bearing read before receiving a target guard.
    if (result.data?.createdDocument === true) return true;
    const documentArrays = [
        result.documents,
        result.openDocuments,
        result.data?.documents,
        result.data?.openDocuments,
        result.result?.documents
    ];
    if (documentArrays.some((items) => Array.isArray(items) && items.length > 0)) return true;
    const documentObjects = [
        result.document,
        result.activeDocument,
        result.data?.document,
        result.data?.activeDocument,
        result.result?.document
    ];
    if (documentObjects.some((item) => item && typeof item === 'object')) return true;
    return Boolean(
        result.documentId
        || result.activeDocumentId
        || result.id
        || result.data?.documentId
        || result.data?.activeDocumentId
    );
}

function hasCompletedDocumentRuntimeObservation(
    completedToolCalls: AgentToolExecutionPreflightLogEntry[]
): boolean {
    return completedToolCalls.some((entry) => {
        const name = normalizeToolName(entry?.name);
        if (!canAgentToolStartWithoutOpenDocument(name)) return false;
        return resultIndicatesOpenDocument(entry?.result);
    });
}

function resolveNextAction(
    blockers: AgentToolDecisionBlocker[],
    allowedToolCalls: AgentToolDecisionToolCall[]
): AgentToolDecisionContractNextAction {
    if (blockers.some((item) => item.code === 'intent_scope_disallows_tools')) {
        return 'model_replan_without_tools';
    }
    if (blockers.some((item) => item.code === 'tool_scope_exceeds_intent')) {
        return 'model_replan_with_allowed_tools';
    }
    if (blockers.some((item) => item.code === 'execution_authorization_required')) {
        return 'model_replan_with_allowed_tools';
    }
    if (blockers.some((item) => item.code === 'tool_unavailable' || item.code === 'unknown_tool_kind')) {
        return 'model_replan_with_allowed_tools';
    }
    // PS 没连是系统边界，但不应阻断非 PS 工具（知识检索、外部生成等）。
    // 如果批次中还有不受 PS 连接影响的工具，让模型用这些工具继续，而不是整批硬停止。
    if (blockers.some((item) => item.code === 'photoshop_not_connected')) {
        return allowedToolCalls.length > 0
            ? 'model_replan_with_allowed_tools'
            : 'respect_system_boundary';
    }
    // 无文档（PS 已连）不是死边界：分析/方向类任务可换用项目级工具或依据当前上下文收尾，
    // 写画布类任务可先 createDocument——都让模型重规划，而不是把任务判失败（实测：
    // C-1188 空 PSD 项目里设计方向跑到一半调画布工具就被 fatal 阻断）。
    if (blockers.some((item) => item.code === 'photoshop_document_required')) {
        return 'model_replan_with_allowed_tools';
    }
    return 'model_replan_with_allowed_tools';
}

export function buildAgentToolDecisionContract(
    input: BuildAgentToolDecisionContractInput
): AgentToolDecisionContract {
    const toolCalls = Array.isArray(input.toolCalls) ? input.toolCalls : [];
    const candidateTools = buildCandidateTools(toolCalls, input.runtime);
    const intentToolScope = input.intentControlPlane?.toolScope || 'unknown';
    const executionAuthorization = input.intentControlPlane?.executionAuthorization || 'none';
    const userInputSummary = normalizeText(input.userInput).slice(0, 160);
    const completedToolCalls = Array.isArray(input.completedToolCalls) ? input.completedToolCalls : [];
    const hasDocumentRuntimeObservation = hasCompletedDocumentRuntimeObservation(completedToolCalls);
    const photoshopConnectionBlocked = capabilityBlocksExecution(resolveDeclaredCapabilityVerdict({
        declared: input.runtime?.photoshopConnected,
        subjectLabel: '当前 Photoshop 运行时'
    }, '连接能力'));
    const photoshopDocumentBlocked = capabilityBlocksExecution(resolveDeclaredCapabilityVerdict({
        declared: input.runtime?.hasDocument,
        subjectLabel: '当前 Photoshop 运行时'
    }, '活动文档'));

    const blockers: AgentToolDecisionBlocker[] = [];
    const warnings: string[] = [];

    if (candidateTools.length === 0) {
        return {
            version: AGENT_TOOL_DECISION_POLICY_CAPABILITY_ID,
            status: 'not_applicable',
            nextAction: 'answer_without_tools',
            intentToolScope,
            userInputSummary,
            candidateTools,
            allowedToolCalls: [],
            blockers,
            warnings
        };
    }

    // 门禁出口治理（2026-07-02）：每个拒绝消息必须带可执行的替代路径（改用什么 / 先做什么），
    // 只说"不能做"不给出路会让模型在同一堵墙上反复重试。
    for (const candidate of candidateTools) {
        if (intentToolScope === 'none') {
            blockers.push(blocker(
                'intent_scope_disallows_tools',
                '这个问题更适合先把判断说清楚；本轮不会改动画面。请直接用文字回答用户，不要调用工具。',
                candidate.name
            ));
            continue;
        }

        if (!candidate.available) {
            blockers.push(blocker(
                'tool_unavailable',
                `工具 ${candidate.name} 不在本轮可用工具列表，暂时不能直接完成；请从本轮已提供的工具中改选能达成同一目标的工具。`,
                candidate.name
            ));
        }

        // Harness control tools only update the Agent runtime protocol. They do
        // not touch Photoshop, so Brief / Strategy / Action Plan declarations
        // must be allowed before a Photoshop document exists.
        if (isAgentHarnessControlTool(candidate.name)) {
            continue;
        }

        if (requiresConfirmedExecutionAuthorization(candidate)
            && executionAuthorization !== 'confirmed_tool_required') {
            blockers.push(blocker(
                'execution_authorization_required',
                [
                    `工具 ${candidate.name} 会产生写入、外部生成或有状态变更，但当前请求尚未获得明确执行授权。`,
                    '解锁路径（选一条执行，不要反复重试同一动作）：',
                    '1. 只是先了解情况：改用只读观察、知识检索或 Harness 控制能力，把判断告诉用户；',
                    '2. 确实需要动手：用 createInteractiveCard 向用户说明要执行的动作并请求确认，用户确认后再执行；',
                    '3. 用户已经明确要求动手：把用户的授权原话纳入本轮目标后重新发起执行请求。'
                ].join('\n'),
                candidate.name,
                [
                    '改用只读观察或知识检索并回答用户',
                    '用 createInteractiveCard 请求用户确认该动作',
                    '用户明确授权后重新发起执行'
                ]
            ));
            continue;
        }

        if (candidate.scope === 'unknown') {
            blockers.push(blocker(
                'unknown_tool_kind',
                `工具 ${candidate.name} 还没有登记执行分类，本轮不会执行；请改用已登记的工具完成同一目标（新工具需先在 agent-tool-execution-preflight 登记分类）。`,
                candidate.name
            ));
        }

        if (!canIntentUseScope(intentToolScope, candidate.scope, candidate.name)) {
            blockers.push(blocker(
                'tool_scope_exceeds_intent',
                `当前请求范围（${describeIntentToolScope(intentToolScope)}）不包含 ${candidate.name} 这类操作；请改用与该范围一致的工具，或先向用户说明需要扩大操作范围。`,
                candidate.name
            ));
        }

        if (candidate.scope === 'external_generation') {
            warnings.push(`${candidate.name} 属于 external_generation，不依赖当前 Photoshop 文档，但生成结果进入文档前仍需用户或后续流程确认。`);
        }

        if (PHOTOSHOP_DOCUMENT_SCOPES.has(candidate.scope)) {
            if (photoshopConnectionBlocked
                && !PHOTOSHOP_CONNECTION_OPTIONAL_TOOLS.has(candidate.name)) {
                blockers.push(blocker(
                    'photoshop_not_connected',
                    `工具 ${candidate.name} 需要 Photoshop 连接，但当前连接不可用。请提示用户在 Photoshop 打开 DesignEcho UXP 插件面板建立连接；本轮可先用不依赖 Photoshop 的工具（知识检索 / 项目资源读取）继续。`,
                    candidate.name
                ));
            }
            if (photoshopDocumentBlocked
                && !hasDocumentRuntimeObservation
                && !canAgentToolStartWithoutOpenDocument(candidate.name)) {
                // 原子指路工具由共享静态集合声明；可自建目标文档的 Skill 由自身
                // runtimeRequirements 声明。两者共用同一 helper，防止指路进墙。
                blockers.push(blocker(
                    'photoshop_document_required',
                    `工具 ${candidate.name} 需要当前 Photoshop 文档，但运行时没有检测到可用文档。注意：读取失败不代表没有文档（Photoshop 可能正忙）。请先用 listDocuments 确认已打开的文档，有目标文档就 switchDocument 切换后重试；确认确实没有目标文档，再考虑 createDocument 新建。修改类任务不要因为一次读取失败就新建文档。`,
                    candidate.name
                ));
            }
        }
    }

    const blockerByIdentity = new Map(
        blockers.map((item) => [`${item.code}:${item.toolName || ''}:${item.message}`, item])
    );
    const dedupedBlockers = unique(
        blockers.map((item) => `${item.code}:${item.toolName || ''}:${item.message}`)
    ).map((serialized) => {
        const original = blockerByIdentity.get(serialized);
        const [code, toolName, ...messageParts] = serialized.split(':');
        return {
            code: code as AgentToolDecisionBlockerCode,
            toolName: toolName || undefined,
            message: messageParts.join(':'),
            // GATE-SIMPLIFY-008：序列化去重只保身份三要素，结构化升级出口从原对象回补。
            ...(original?.unlockOptions?.length ? { unlockOptions: original.unlockOptions } : {})
        };
    });

    const blockedToolNames = new Set(dedupedBlockers.map((item) => item.toolName).filter(Boolean));
    const allowedToolCalls = toolCalls.filter((call) => !blockedToolNames.has(normalizeToolName(call?.name)));
    const status = dedupedBlockers.length > 0 ? 'blocked' : 'ready';
    return {
        version: AGENT_TOOL_DECISION_POLICY_CAPABILITY_ID,
        status,
        nextAction: status === 'ready'
            ? 'execute_tools'
            : resolveNextAction(dedupedBlockers, allowedToolCalls),
        intentToolScope,
        userInputSummary,
        candidateTools,
        allowedToolCalls: status === 'ready' ? toolCalls : allowedToolCalls,
        blockers: dedupedBlockers,
        warnings: unique(warnings)
    };
}

export function formatAgentToolDecisionContractBlocker(
    contract: AgentToolDecisionContract
): string {
    if (contract.status !== 'blocked') {
        return '';
    }
    const lines = [
        '本轮不会改动画面。'
    ];
    lines.push(getAgentToolDecisionNextActionPublicText(contract.nextAction));
    for (const publicMessage of unique(contract.blockers.map(formatAgentToolDecisionBlockerPublicMessage)).slice(0, 5)) {
        lines.push(`- ${publicMessage}`);
    }
    if (contract.blockers.length > 5) {
        lines.push(`- 其余阻断项 ${contract.blockers.length - 5} 个。`);
    }
    return lines.join('\n');
}

function formatAgentToolDecisionBlockerPublicMessage(blockerItem: AgentToolDecisionBlocker): string {
    switch (blockerItem.code) {
        case 'intent_scope_disallows_tools':
            return '这个问题更适合先把判断说清楚。';
        case 'tool_scope_exceeds_intent':
            return '当前请求的范围和准备处理的动作不一致，需要先重新规划。';
        case 'execution_authorization_required':
            return '这个动作需要执行授权：先继续只读检查，或向用户确认后再执行。';
        case 'tool_unavailable':
            return '这个操作暂时还不能直接完成，需要换一种可用方式。';
        case 'unknown_tool_kind':
            return '这个操作还没有明确的处理方式，需要先重新判断。';
        case 'photoshop_not_connected':
            return '需要先连接 Photoshop，并确认 UXP 插件面板已打开。';
        case 'photoshop_document_required':
            return '需要先打开要处理的 Photoshop 文档。';
        default:
            return '当前条件还不够完整，需要先重新判断。';
    }
}
