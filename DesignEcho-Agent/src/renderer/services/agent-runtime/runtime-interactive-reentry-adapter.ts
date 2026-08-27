import {
    resolveAgentWorkflowContinuationScope,
    type AgentWorkflowContinuationScope
} from '../../../shared/agent-workflow-continuation-scope';
import type { RuntimeActionPlanDeclaration } from '../../../shared/agent-runtime-v5/runtime-action-plan-declaration';
import type { RuntimeActionPlanExecutionJournal } from '../../../shared/agent-runtime-v5/runtime-action-plan-observation';
import type { RuntimeDesignBriefDeclaration } from '../../../shared/agent-runtime-v5/runtime-design-brief-declaration';
import {
    projectRuntimeInteractiveWorkflowResult,
    validateRuntimeInteractiveReentry
} from '../../../shared/agent-runtime-v5/runtime-interactive-reentry';
import type { RuntimeReferenceBriefDeclaration } from '../../../shared/agent-runtime-v5/runtime-reference-context';
import {
    canReleaseRuntimeSessionDocumentWriter,
    releaseRuntimeTaskRunWriterBinding,
    type RuntimeSession
} from '../../../shared/agent-runtime-v5/runtime-session';
import type { RuntimeDesignStrategyDeclaration } from '../../../shared/agent-runtime-v5/runtime-design-strategy-declaration';
import type { AgentConfig } from './types';

export { reconcileRuntimeSkillEffectBeforeAgentAction } from './runtime-skill-effect-reconciliation-adapter';

export interface RuntimeInteractiveDirectWorkflowHandoffSeed {
    workflowToolName: string;
    workflowCallId: string;
    binding: AgentWorkflowContinuationScope['binding'];
    currentEpochMutationCount: 0;
    ownerAccepted: false;
    mutationEvidence: [];
}

export interface RuntimeInteractiveAgentReentryState {
    planning: {
        runtimeDesignBriefDeclaration?: RuntimeDesignBriefDeclaration;
        runtimeReferenceBriefDeclaration?: RuntimeReferenceBriefDeclaration;
        runtimeDesignStrategyDeclaration?: RuntimeDesignStrategyDeclaration;
        runtimeActionPlanDeclaration?: RuntimeActionPlanDeclaration;
        runtimeActionPlanExecutionJournal?: RuntimeActionPlanExecutionJournal;
    };
    runtime: {
        workflowContinuationScope: AgentWorkflowContinuationScope;
        pendingDirectWorkflowHandoff?: RuntimeInteractiveDirectWorkflowHandoffSeed;
    };
    adoptAfterSuccessfulModelResponse: () => void;
}

export function releaseRuntimeSessionWriterAfterAgentFinalization(input: {
    session?: RuntimeSession;
    awaitingUserResponse: boolean;
    executionStatus: 'completed' | 'needs_review' | 'failed' | 'cancelled' | 'awaiting_confirmation';
    successfulMutationCalls?: number;
}): boolean {
    const session = input.session;
    if (!session) return false;
    let mutationState: 'none' | 'observed' | 'unknown' = 'unknown';
    if (typeof input.successfulMutationCalls === 'number'
        && Number.isFinite(input.successfulMutationCalls)) {
        mutationState = input.successfulMutationCalls > 0 ? 'observed' : 'none';
    }
    let outcome: 'executed' | 'failed' | 'awaiting_confirmation' | 'unknown' = 'failed';
    if (input.awaitingUserResponse) {
        outcome = 'awaiting_confirmation';
    } else if (input.executionStatus === 'completed') {
        outcome = 'executed';
    } else if (mutationState === 'unknown') {
        outcome = 'unknown';
    }
    if (!canReleaseRuntimeSessionDocumentWriter({
        session,
        ownerHasExecutionControl: true,
        outcome,
        mutationState,
        awaitingUserResponse: input.awaitingUserResponse
    })) {
        return false;
    }
    return releaseRuntimeTaskRunWriterBinding({
        taskRunId: session.taskRun.taskRunId,
        runId: session.identity.runId,
        generation: session.identity.generation
    });
}

function createRuntimeInteractiveReentryAdoption(
    config: AgentConfig
): () => void {
    let adopted = false;
    return (): void => {
        if (adopted) return;
        if (config.adoptRuntimeInteractiveReentry?.() !== true) {
            throw new Error('runtime_interactive_reentry_adoption_failed');
        }
        adopted = true;
    };
}

export function attachRuntimeInteractiveCheckpointState(input: {
    data: Record<string, unknown>;
    actionPlanExecutionJournal?: RuntimeActionPlanExecutionJournal;
    workflowContinuationScope?: AgentWorkflowContinuationScope;
}): void {
    if (input.actionPlanExecutionJournal) {
        input.data.runtimeActionPlanExecutionJournal = input.actionPlanExecutionJournal;
    }
    if (input.workflowContinuationScope) {
        input.data.runtimeWorkflowContinuationScope = input.workflowContinuationScope;
    }
}

export function resolveRuntimeInteractiveAgentReentryState(input: {
    config: AgentConfig;
    session?: RuntimeSession;
}): RuntimeInteractiveAgentReentryState | undefined {
    const reentry = input.config.runtimeInteractiveReentry;
    if (!reentry) return undefined;
    if (input.config.runtimePlanningContextSeed) {
        throw new Error('runtime_interactive_reentry_conflicts_with_generation_seed');
    }
    if (!input.session || !input.config.runtimeStagePlan) {
        throw new Error('runtime_interactive_reentry_without_session');
    }
    const validation = validateRuntimeInteractiveReentry(reentry);
    if (!validation.ok) throw new Error(validation.issues.join(','));
    if (reentry.session !== input.config.runtimeSessionSeed
        || reentry.session.identity.runId !== input.session.identity.runId) {
        throw new Error('runtime_interactive_reentry_seed_mismatch');
    }
    const callId = reentry.workflowHandoff.workflowCallId;
    const workflowResult = projectRuntimeInteractiveWorkflowResult(reentry);
    const workflowContinuationScope = resolveAgentWorkflowContinuationScope({
        workflowEntryTools: [
            ...(input.config.toolCapabilityBridge?.workflowEntryTools || []),
            reentry.workflowToolName
        ],
        toolCalls: [{ id: callId, name: reentry.workflowToolName, arguments: {} }],
        toolResults: [{
            callId,
            success: false,
            output: workflowResult
        }],
        availableToolNames: input.config.tools.map((tool) => tool.name),
        binding: {
            sessionId: input.session.identity.sessionId,
            runId: input.session.identity.runId,
            generation: input.session.identity.generation,
            stage: input.session.stageState.currentStage
        }
    });
    if (!workflowContinuationScope) {
        throw new Error('runtime_interactive_workflow_scope_restore_failed');
    }
    const declarations = reentry.declarations;
    const hasActionPlanStage = reentry.plan.steps.some((step) => step.stage === 'R4');
    const restoresCompactRepairHandoff = !hasActionPlanStage
        && input.session.stageState.currentStage === 'E1'
        && workflowContinuationScope.source === 'declared'
        && workflowContinuationScope.purpose === 'repair'
        && !workflowContinuationScope.visualDelivery;
    return {
        planning: {
            runtimeDesignBriefDeclaration: declarations.brief,
            runtimeReferenceBriefDeclaration: declarations.referenceBrief,
            runtimeDesignStrategyDeclaration: declarations.strategy,
            runtimeActionPlanDeclaration: declarations.actionPlan,
            runtimeActionPlanExecutionJournal:
                reentry.actionPlanExecutionJournal?.journal
        },
        adoptAfterSuccessfulModelResponse: createRuntimeInteractiveReentryAdoption(input.config),
        runtime: {
            // Reentry 只恢复控制状态，不执行 Tool。历史 Workflow handoff 属于暂停前的运行；
            // 若把它注入续跑 Tool 账本，会伪造一条本轮 `success:false` 动作，进而污染失败、
            // 进展、完成契约和用户过程会计。
            workflowContinuationScope,
            ...(restoresCompactRepairHandoff ? {
                pendingDirectWorkflowHandoff: {
                    workflowToolName: workflowContinuationScope.workflowToolName,
                    workflowCallId: workflowContinuationScope.workflowCallId,
                    binding: workflowContinuationScope.binding,
                    currentEpochMutationCount: 0,
                    ownerAccepted: false,
                    mutationEvidence: []
                }
            } : {})
        }
    };
}
