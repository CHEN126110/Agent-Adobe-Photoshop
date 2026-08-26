import type { AgentWorkflowContinuationScope } from '../../../shared/agent-workflow-continuation-scope';
import type { RuntimeActionPlanExecutionJournal } from '../../../shared/agent-runtime-v5/runtime-action-plan-observation';
import {
    RUNTIME_INTERACTIVE_CHECKPOINT_VERSION,
    RUNTIME_INTERACTIVE_HANDOFF_IDENTITY_VERSION,
    createRuntimeInteractiveBoundaries,
    type RuntimeInteractiveReentry
} from '../../../shared/agent-runtime-v5/runtime-interactive-reentry';
import type { RuntimePlanningDeclarations } from '../../../shared/agent-runtime-v5/runtime-planning-context-seed';
import type { RuntimeSession } from '../../../shared/agent-runtime-v5/runtime-session';
import type { RuntimeStagePlan } from '../../../shared/agent-runtime-v5/runtime-stage-plan';
import { resolvePendingInteractiveContinuationLeaf } from '../../../shared/pending-interactive-continuation';
import { registerActiveRuntimeInteractiveCheckpoint } from './active-runtime-interactive-continuation';

function readWaitingRuntimeSessionFromAgentResult(result: unknown): RuntimeSession | undefined {
    const data = (result as { data?: Record<string, unknown> } | null)?.data;
    const session = data?.runtimeSession;
    if (!session || typeof session !== 'object' || Array.isArray(session)) return undefined;
    const value = session as Partial<RuntimeSession>;
    if (value.version !== 'runtime-session/v0'
        || !value.identity
        || !value.stageState
        || !value.stageTrace
        || value.finalized !== false
        || value.taskRun?.status !== 'waiting_user') {
        return undefined;
    }
    return value as RuntimeSession;
}

export function readRuntimePlanningDeclarationsFromAgentResult(
    result: unknown
): RuntimePlanningDeclarations {
    const data = (result as { data?: Record<string, unknown> } | null)?.data;
    return {
        ...(data?.runtimeDesignBriefDeclaration && typeof data.runtimeDesignBriefDeclaration === 'object'
            ? { brief: data.runtimeDesignBriefDeclaration as RuntimePlanningDeclarations['brief'] }
            : {}),
        ...(data?.runtimeReferenceBriefDeclaration && typeof data.runtimeReferenceBriefDeclaration === 'object'
            ? { referenceBrief: data.runtimeReferenceBriefDeclaration as RuntimePlanningDeclarations['referenceBrief'] }
            : {}),
        ...(data?.runtimeDesignStrategyDeclaration && typeof data.runtimeDesignStrategyDeclaration === 'object'
            ? { strategy: data.runtimeDesignStrategyDeclaration as RuntimePlanningDeclarations['strategy'] }
            : {}),
        ...(data?.runtimeActionPlanDeclaration && typeof data.runtimeActionPlanDeclaration === 'object'
            ? { actionPlan: data.runtimeActionPlanDeclaration as RuntimePlanningDeclarations['actionPlan'] }
            : {})
    };
}

function readRuntimeActionPlanExecutionJournalFromAgentResult(
    result: unknown
): RuntimeActionPlanExecutionJournal | undefined {
    const data = (result as { data?: Record<string, unknown> } | null)?.data;
    const journal = data?.runtimeActionPlanExecutionJournal;
    if (!journal || typeof journal !== 'object' || Array.isArray(journal)) return undefined;
    return (journal as Partial<RuntimeActionPlanExecutionJournal>).version
        === 'runtime-action-plan-execution-journal/v0'
        ? journal as RuntimeActionPlanExecutionJournal
        : undefined;
}

function readRuntimeInteractiveHandoffIdentityFromAgentResult(input: {
    result: unknown;
    session: RuntimeSession;
    workflowToolName: string;
}): RuntimeInteractiveReentry['workflowHandoff'] | undefined {
    const data = (input.result as { data?: Record<string, unknown> } | null)?.data;
    const scope = data?.runtimeWorkflowContinuationScope as
        | AgentWorkflowContinuationScope
        | undefined;
    if (scope?.version !== 'agent-workflow-continuation-scope/v0'
        || scope.workflowToolName !== input.workflowToolName
        || !String(scope.workflowCallId || '').trim()
        || scope.binding.sessionId !== input.session.identity.sessionId
        || scope.binding.runId !== input.session.identity.runId
        || scope.binding.generation !== input.session.identity.generation
        || scope.binding.stage !== input.session.stageState.currentStage) {
        return undefined;
    }
    return {
        version: RUNTIME_INTERACTIVE_HANDOFF_IDENTITY_VERSION,
        workflowToolName: scope.workflowToolName,
        workflowCallId: scope.workflowCallId,
        binding: scope.binding
    };
}

export function registerRuntimeInteractiveCheckpointFromAgentResult(input: {
    result: unknown;
    sourceTask: string;
    plan?: RuntimeStagePlan;
    authorizationTokens: ReadonlyMap<string, string>;
}): boolean {
    const continuation = resolvePendingInteractiveContinuationLeaf(input.result);
    if (!continuation?.taskRunBinding) return false;
    const session = readWaitingRuntimeSessionFromAgentResult(input.result);
    if (!input.plan || !session) {
        throw new Error('runtime_interactive_checkpoint_state_missing');
    }
    const declarations = readRuntimePlanningDeclarationsFromAgentResult(input.result);
    const actionPlanExecutionJournal = readRuntimeActionPlanExecutionJournalFromAgentResult(
        input.result
    );
    const workflowHandoff = readRuntimeInteractiveHandoffIdentityFromAgentResult({
        result: input.result,
        session,
        workflowToolName: continuation.operation.skillId
    });
    if (!workflowHandoff) throw new Error('runtime_interactive_checkpoint_handoff_identity_missing');
    registerActiveRuntimeInteractiveCheckpoint({
        version: RUNTIME_INTERACTIVE_CHECKPOINT_VERSION,
        continuationId: continuation.id,
        workflowToolName: continuation.operation.skillId,
        sourceTask: input.sourceTask,
        taskRunBinding: continuation.taskRunBinding,
        session,
        plan: input.plan,
        declarations,
        workflowHandoff,
        ...(declarations.actionPlan && actionPlanExecutionJournal ? {
            actionPlanExecutionJournal: {
                planRevision: session.taskRun.planRevision,
                journal: actionPlanExecutionJournal
            }
        } : {}),
        ...(input.authorizationTokens.get(session.identity.runId)
            ? { artifactAuthorizationToken: input.authorizationTokens.get(session.identity.runId) }
            : {}),
        registeredAt: new Date().toISOString(),
        boundaries: createRuntimeInteractiveBoundaries()
    });
    return true;
}
