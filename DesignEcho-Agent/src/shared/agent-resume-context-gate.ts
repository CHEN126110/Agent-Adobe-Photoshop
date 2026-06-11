import type { AgentResumeExecutionPolicy } from './agent-resume-execution-policy';

export type AgentResumeContextGateVersion = 'agent-resume-context-gate/v0';

export type AgentResumeContextGateStatus =
    | 'not_applicable'
    | 'blocked_policy_not_resumable'
    | 'blocked_missing_photoshop_connection'
    | 'blocked_missing_document'
    | 'ready_for_readonly_context_refresh'
    | 'ready_for_resume_planning';

export interface AgentResumeContextGateInput {
    policy: AgentResumeExecutionPolicy;
    photoshopConnected?: boolean;
    hasDocument?: boolean;
    documentName?: string;
    layerCount?: number;
    hasProject?: boolean;
    projectPath?: string;
    hasFreshPhotoshopSnapshot?: boolean;
    hasFreshProjectSnapshot?: boolean;
}

export interface AgentResumeContextGate {
    version: AgentResumeContextGateVersion;
    status: AgentResumeContextGateStatus;
    policyAction: AgentResumeExecutionPolicy['action'];
    canEnterResumePlanning: boolean;
    canRequestReadOnlyRefresh: boolean;
    mustNotRunWriteTools: true;
    mustNotClaimTaskCompletion: true;
    requiredReadOnlyEvidence: string[];
    blockers: string[];
    warnings: string[];
    evidenceOnly: true;
}

function hasResumeCandidatePolicy(policy: AgentResumeExecutionPolicy): boolean {
    return policy.action === 'resume_candidate_needs_model_decision'
        || policy.action === 'request_fresh_context_before_resume';
}

function buildGate(input: {
    policy: AgentResumeExecutionPolicy;
    status: AgentResumeContextGateStatus;
    canEnterResumePlanning?: boolean;
    canRequestReadOnlyRefresh?: boolean;
    requiredReadOnlyEvidence?: string[];
    blockers?: string[];
    warnings?: string[];
}): AgentResumeContextGate {
    return {
        version: 'agent-resume-context-gate/v0',
        status: input.status,
        policyAction: input.policy.action,
        canEnterResumePlanning: input.canEnterResumePlanning === true,
        canRequestReadOnlyRefresh: input.canRequestReadOnlyRefresh === true,
        mustNotRunWriteTools: true,
        mustNotClaimTaskCompletion: true,
        requiredReadOnlyEvidence: input.requiredReadOnlyEvidence || [],
        blockers: input.blockers || [],
        warnings: input.warnings || [],
        evidenceOnly: true
    };
}

export function buildAgentResumeContextGate(
    input: AgentResumeContextGateInput
): AgentResumeContextGate {
    if (!hasResumeCandidatePolicy(input.policy)) {
        return buildGate({
            policy: input.policy,
            status: input.policy.action === 'ignore' ? 'not_applicable' : 'blocked_policy_not_resumable',
            blockers: input.policy.blockers
        });
    }

    if (!input.photoshopConnected) {
        return buildGate({
            policy: input.policy,
            status: 'blocked_missing_photoshop_connection',
            blockers: ['Photoshop / UXP 当前未连接，不能读取恢复执行所需的上下文。'],
            requiredReadOnlyEvidence: ['photoshop_connection']
        });
    }

    if (!input.hasDocument) {
        return buildGate({
            policy: input.policy,
            status: 'blocked_missing_document',
            blockers: ['当前没有打开的 Photoshop 文档，不能恢复上一轮 Photoshop 执行任务。'],
            requiredReadOnlyEvidence: ['active_document']
        });
    }

    const requiredReadOnlyEvidence = [
        'document_info',
        'document_snapshot',
        'layer_hierarchy',
        'acceptance_snapshot'
    ];

    if (input.hasProject || input.projectPath) {
        requiredReadOnlyEvidence.push('project_context_snapshot');
    }

    const hasFreshPhotoshopSnapshot = input.hasFreshPhotoshopSnapshot === true;
    const hasFreshProjectSnapshot = input.hasFreshProjectSnapshot === true || (!input.hasProject && !input.projectPath);

    if (!hasFreshPhotoshopSnapshot || !hasFreshProjectSnapshot) {
        return buildGate({
            policy: input.policy,
            status: 'ready_for_readonly_context_refresh',
            canRequestReadOnlyRefresh: true,
            requiredReadOnlyEvidence,
            warnings: [
                '可以请求只读上下文刷新，但仍禁止写入 Photoshop 或声明任务完成。'
            ]
        });
    }

    return buildGate({
        policy: input.policy,
        status: 'ready_for_resume_planning',
        canEnterResumePlanning: true,
        requiredReadOnlyEvidence,
        warnings: [
            '上下文证据已就绪；下一步仍必须由模型生成明确恢复执行计划，不能直接写入。'
        ]
    });
}
