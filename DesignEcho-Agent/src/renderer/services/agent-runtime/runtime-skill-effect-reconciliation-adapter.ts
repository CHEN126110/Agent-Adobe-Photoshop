import {
    isAgentReconciliationContextTransition,
    type AgentToolExecutionKind
} from '../../../shared/agent-tool-execution-preflight';
import type { RuntimeInteractiveReentry } from '../../../shared/agent-runtime-v5/runtime-interactive-reentry';
import {
    RUNTIME_SKILL_EFFECT_RECONCILIATION_VERSION,
    reconcileRuntimeSessionSkillEffectUnknown,
    type RuntimeSession,
    type RuntimeSkillEffectReconciliationReceipt
} from '../../../shared/agent-runtime-v5/runtime-session';
import type { SkillExecutionRuntimeLineage } from '../../../shared/skill-execution-effect';
import type { AgentToolCallLogEntry } from './types';
import {
    readAgentVisualObservationReceipt,
    readAgentVisualObservations
} from './visual-observation-strategy';

const VISUAL_RECONCILIATION_TOOL_NAMES: ReadonlySet<string> = new Set([
    'getDocumentSnapshot',
    'getCanvasSnapshot',
    'getAcceptanceSnapshot',
    'getAnnotatedSnapshot',
    'getScreenSnapshots',
    'getScreenSnapshotsWithOverlay',
    'capturePhotoshopWindow'
]);

function asRecord(value: unknown): Record<string, any> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, any>
        : undefined;
}

function hasExplicitNoDocument(result: unknown): boolean {
    const record = asRecord(result);
    const data = asRecord(record?.data);
    const documentState = String(record?.documentState || data?.documentState || '').trim();
    if (documentState === 'absent') return true;
    switch (record?.hasDocument ?? data?.hasDocument) {
        case false:
            return true;
        default:
            return false;
    }
}

function hasEmptyDocumentInventory(result: unknown): boolean {
    const record = asRecord(result);
    const data = asRecord(record?.data);
    const documents = Array.isArray(record?.documents)
        ? record.documents
        : (Array.isArray(data?.documents) ? data.documents : undefined);
    return Array.isArray(documents) && documents.length === 0;
}

function modelObservationEntries(
    toolCallLog: readonly AgentToolCallLogEntry[],
    currentModelTurn: number
): AgentToolCallLogEntry[] {
    return toolCallLog.filter((entry) => (
        entry.origin === 'model_tool_call'
        && Number.isSafeInteger(entry.modelTurn)
        && (entry.modelTurn as number) < currentModelTurn
        && entry.result?.success !== false
    ));
}

function buildRuntimeLineage(reentry: RuntimeInteractiveReentry): SkillExecutionRuntimeLineage {
    return {
        version: 'skill-execution-runtime-lineage/v0' as const,
        sessionId: reentry.session.identity.sessionId,
        runId: reentry.session.identity.runId,
        generation: reentry.session.identity.generation,
        taskRunId: reentry.session.taskRun.taskRunId,
        planRevision: reentry.session.taskRun.planRevision,
        continuationId: reentry.continuationId,
        workflowCallId: reentry.workflowHandoff.workflowCallId,
        skillId: reentry.workflowToolName
    };
}

function buildRevisionReceipt(input: {
    reentry: RuntimeInteractiveReentry;
    observations: readonly AgentToolCallLogEntry[];
    nextToolName: string;
    currentModelTurn: number;
}): RuntimeSkillEffectReconciliationReceipt | undefined {
    for (let index = input.observations.length - 1; index >= 0; index -= 1) {
        const entry = input.observations[index];
        if (!VISUAL_RECONCILIATION_TOOL_NAMES.has(entry.name)) continue;
        const visualReceipt = readAgentVisualObservationReceipt(entry.result);
        if (!visualReceipt || visualReceipt.sourceTool !== entry.name) continue;
        const documentId = Number(visualReceipt.document);
        const historyStateId = Number(visualReceipt.history);
        if (!Number.isSafeInteger(documentId) || documentId <= 0
            || !Number.isSafeInteger(historyStateId) || historyStateId <= 0) continue;
        const visualObservation = readAgentVisualObservations(entry.result).find((observation) => (
            (observation.status === 'presented_to_primary'
                || observation.status === 'observed_by_primary')
            && observation.observer === 'primary_model'
            && observation.strategy === 'primary-self'
            && Boolean(observation.observationKey)
            && observation.observationIdentity?.outer === entry.name
            && observation.observationIdentity.document === visualReceipt.document
            && observation.observationIdentity.history === visualReceipt.history
            && Number.isSafeInteger(observation.presentedModelTurn)
            && (observation.presentedModelTurn as number) > (entry.modelTurn as number)
            && Number.isSafeInteger(observation.consumedModelTurn)
            && (observation.consumedModelTurn as number) >= (observation.presentedModelTurn as number)
            && (observation.consumedModelTurn as number) <= input.currentModelTurn
            && !observation.reason
        ));
        if (!visualObservation) continue;
        const observedRevision = { documentId, historyStateId };
        return {
            version: RUNTIME_SKILL_EFFECT_RECONCILIATION_VERSION,
            runtimeLineage: buildRuntimeLineage(input.reentry),
            workflowToolName: input.reentry.workflowToolName,
            conclusion: 'adopt_observed_revision',
            observedRevision,
            observationToolNames: [entry.name],
            visualObservationBinding: {
                observationKey: visualObservation.observationKey!,
                sourceTool: entry.name,
                documentId,
                historyStateId,
                presentedModelTurn: visualObservation.presentedModelTurn!,
                consumedModelTurn: visualObservation.consumedModelTurn!,
                observer: 'primary_model'
            },
            nextToolName: input.nextToolName,
            boundaries: {
                agentSelectedNextAtomicAction: true,
                visualObservationVerified: true,
                noDocumentConsensusVerified: false,
                operationIdentityBound: true,
                executesTools: false,
                grantsPermission: false
            }
        };
    }
    return undefined;
}

function buildNoDocumentReceipt(input: {
    reentry: RuntimeInteractiveReentry;
    observations: readonly AgentToolCallLogEntry[];
    nextToolName: string;
}): RuntimeSkillEffectReconciliationReceipt | undefined {
    const documentInfo = [...input.observations].reverse().find((entry) => (
        entry.name === 'getDocumentInfo' && hasExplicitNoDocument(entry.result)
    ));
    const documentInventory = [...input.observations].reverse().find((entry) => (
        entry.name === 'listDocuments' && hasEmptyDocumentInventory(entry.result)
    ));
    if (!documentInfo || !documentInventory) return undefined;
    return {
        version: RUNTIME_SKILL_EFFECT_RECONCILIATION_VERSION,
        runtimeLineage: buildRuntimeLineage(input.reentry),
        workflowToolName: input.reentry.workflowToolName,
        conclusion: 'confirm_no_document',
        observationToolNames: [documentInfo.name, documentInventory.name],
        nextToolName: input.nextToolName,
        boundaries: {
            agentSelectedNextAtomicAction: true,
            visualObservationVerified: false,
            noDocumentConsensusVerified: true,
            operationIdentityBound: true,
            executesTools: false,
            grantsPermission: false
        }
    };
}

/**
 * 模型先观察真实现场、再主动选择下一项原子写动作或安全文档迁移时，解除同一
 * TaskRun 的 unknown。Skill 调用、Harness 开工预取和普通文字都不能触发这个出口。
 */
export function reconcileRuntimeSkillEffectBeforeAgentAction(input: {
    session: RuntimeSession;
    reentry?: RuntimeInteractiveReentry;
    toolCallLog: readonly AgentToolCallLogEntry[];
    nextToolName: string;
    nextToolKind: AgentToolExecutionKind;
    nextToolIsSkill: boolean;
    currentModelTurn: number;
}): RuntimeSession {
    const eligibleNextAction = input.nextToolKind === 'photoshop_write'
        || input.nextToolKind === 'save_export'
        || (input.nextToolKind === 'stateful_context'
            && isAgentReconciliationContextTransition(input.nextToolName));
    if (input.session.taskRun.sideEffectState?.status !== 'unknown'
        || !input.reentry
        || input.nextToolIsSkill
        || !eligibleNextAction) {
        return input.session;
    }
    const observations = modelObservationEntries(input.toolCallLog, input.currentModelTurn);
    const receipt = buildRevisionReceipt({
        reentry: input.reentry,
        observations,
        nextToolName: input.nextToolName,
        currentModelTurn: input.currentModelTurn
    }) || buildNoDocumentReceipt({
        reentry: input.reentry,
        observations,
        nextToolName: input.nextToolName
    });
    if (!receipt) return input.session;
    return reconcileRuntimeSessionSkillEffectUnknown({
        session: input.session,
        receipt
    }).session;
}
