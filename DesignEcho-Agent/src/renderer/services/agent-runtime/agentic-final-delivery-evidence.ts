/**
 * agentic 设计任务的最终文件集合投影。
 *
 * 开放创意不建立 staged R4/E2 计划门禁，但仍必须证明：必需交付已经完成、所有文件
 * 来自同一张最终复核画面对应的 Photoshop revision，且交付后没有继续修改内容。
 * 本模块只机械绑定已有 Tool 收据；不执行保存/导出、不选择路径，也不判断设计质量。
 */

import { classifyAgentToolExecution } from '../../../shared/agent-tool-execution-preflight';
import { findLatestObservedPhotoshopMutationIndex } from '../../../shared/agent-operation-document-timeline';
import {
    resolveRuntimeExecutionTarget,
    sameRuntimeExecutionDocument,
    type RuntimeExecutionTargetAnchor
} from '../../../shared/agent-runtime-v5/runtime-execution-target';
import {
    readPhotoshopSourceHistoryStateRef,
    samePhotoshopHistoryStateRef,
    type PhotoshopHistoryStateRef
} from '../../../shared/photoshop-history-state-ref';
import { collectRuntimeFinalArtifactPaths } from '../../../shared/runtime-final-artifact-paths';
import {
    isRuntimeEditableDeliveryOutput,
    isRuntimeRasterDeliveryOutput,
    readTaskCompletionRequiredDeliveryOutputs
} from './task-completion-contract';
import { resolveAgenticWorkflowDeliveryReceipt } from './agentic-workflow-delivery-receipt';
import type {
    AgenticArtifactCompletionContract,
    AgentExecutionSummary,
    AgentToolCallLogEntry,
    TaskCompletionRequirement
} from './types';
import type { AgentDeliveryStageEvidence } from './terminal-closure-checkpoint';

export interface AgenticFinalDeliveryEvidenceInput {
    deliveryOutputs: readonly string[];
    contract?: AgenticArtifactCompletionContract;
    requirements: readonly TaskCompletionRequirement[];
    toolCallLog: readonly AgentToolCallLogEntry[];
    reviewedTarget: RuntimeExecutionTargetAnchor;
    reviewedHistoryStateRef: PhotoshopHistoryStateRef;
}

export interface AgenticFinalDeliveryEvidence {
    status: 'passed' | 'incomplete';
    resultRefs: string[];
    artifactPaths: string[];
}

export function projectAgenticFinalDeliveryStageEvidence(input: {
    contract?: AgenticArtifactCompletionContract;
    summary: Pick<AgentExecutionSummary, 'taskCompletion'>;
    toolCallLog: readonly AgentToolCallLogEntry[];
    reviewedPreview?: {
        target: RuntimeExecutionTargetAnchor;
        historyStateRef: PhotoshopHistoryStateRef;
    };
    iteration: number;
}): AgentDeliveryStageEvidence | undefined {
    const deliveryOutputs = input.contract?.deliveryOutputs
        || readTaskCompletionRequiredDeliveryOutputs(input.summary.taskCompletion);
    if (deliveryOutputs.length === 0) return undefined;
    if (!input.reviewedPreview) return { deliveryEvidencePassed: false };
    const evidence = projectAgenticFinalDeliveryEvidence({
        deliveryOutputs,
        contract: input.contract,
        requirements: input.summary.taskCompletion?.required || [],
        toolCallLog: input.toolCallLog,
        reviewedTarget: input.reviewedPreview.target,
        reviewedHistoryStateRef: input.reviewedPreview.historyStateRef
    });
    if (evidence.status !== 'passed') return { deliveryEvidencePassed: false };
    return {
        deliveryEvidencePassed: true,
        stageTraceEvent: {
            stage: 'E2',
            source: 'delivery_result',
            outcome: 'passed',
            observedOutcomes: ['user_confirmation_or_delivery_record'],
            iteration: input.iteration,
            toolKind: 'save_export'
        },
        finalDeliveryResultRefs: evidence.resultRefs
    };
}

export function projectAgenticFinalDeliveryEvidence(
    input: AgenticFinalDeliveryEvidenceInput
): AgenticFinalDeliveryEvidence {
    const deliveryRequirement = input.requirements.find((requirement) => (
        requirement.id === 'production-delivery'
        || readTaskCompletionRequiredDeliveryOutputs({ required: [requirement] }).length > 0
    ));
    if (deliveryRequirement?.status !== 'passed') return incompleteEvidence();

    if (input.contract?.deliveryPlanBindingRequired === true) {
        const workflowEvidence = resolveAgenticWorkflowDeliveryReceipt({
            contract: input.contract,
            toolCallLog: input.toolCallLog
        });
        const receiptTarget = workflowEvidence?.receipt.sourceHistoryStateRef
            ? resolveRuntimeExecutionTarget({
                result: {
                    documentId: workflowEvidence.receipt.sourceHistoryStateRef.documentId
                }
            })
            : undefined;
        if (!workflowEvidence
            || workflowEvidence.receipt.settlementScope !== 'single_document_revision'
            || !workflowEvidence.receipt.sourceHistoryStateRef
            || !receiptTarget
            || !sameRuntimeExecutionDocument(receiptTarget, input.reviewedTarget)
            || !samePhotoshopHistoryStateRef(
                workflowEvidence.receipt.sourceHistoryStateRef,
                input.reviewedHistoryStateRef
            )) {
            return incompleteEvidence();
        }
        const resultRefs = Array.from(new Set(workflowEvidence.receipt.resultRefs));
        const artifactPaths = collectRuntimeFinalArtifactPaths({
            entries: input.toolCallLog,
            resultRefs,
            producerReceiptCallRefs: [workflowEvidence.callId],
            producerReceiptE2CallRefs: [workflowEvidence.callId],
            includeProducerReceipts: true
        });
        const editableRequired = input.deliveryOutputs.some(isRuntimeEditableDeliveryOutput);
        const rasterRequired = input.deliveryOutputs.some(isRuntimeRasterDeliveryOutput);
        if (resultRefs.length === 0
            || artifactPaths.length === 0
            || (editableRequired && workflowEvidence.editableArtifactCount === 0)
            || (rasterRequired && workflowEvidence.rasterArtifactCount === 0)) {
            return incompleteEvidence();
        }
        return {
            status: 'passed',
            resultRefs,
            artifactPaths
        };
    }

    const latestMutationIndex = findLatestObservedPhotoshopMutationIndex(input.toolCallLog);
    const resultRefs = input.toolCallLog.flatMap((entry, index) => {
        if (index <= latestMutationIndex
            || !entry.callId
            || entry.result?.success === false
            || classifyAgentToolExecution(entry.name, entry.arguments) !== 'save_export') {
            return [];
        }
        const sourceHistoryStateRef = readPhotoshopSourceHistoryStateRef(entry.result);
        const target = resolveRuntimeExecutionTarget({
            arguments: entry.arguments,
            result: entry.result
        });
        if (!sourceHistoryStateRef
            || !target
            || !sameRuntimeExecutionDocument(target, input.reviewedTarget)
            || !samePhotoshopHistoryStateRef(
                sourceHistoryStateRef,
                input.reviewedHistoryStateRef
            )) {
            return [];
        }
        return [entry.callId];
    });
    const artifactPaths = collectRuntimeFinalArtifactPaths({
        entries: input.toolCallLog,
        resultRefs,
        includeProducerReceipts: false
    });
    const editableRequired = input.deliveryOutputs.some(
        isRuntimeEditableDeliveryOutput
    );
    const rasterRequired = input.deliveryOutputs.some(
        isRuntimeRasterDeliveryOutput
    );
    const editableDelivered = artifactPaths.some((artifactPath) => (
        /\.(?:psd|psb)$/iu.test(artifactPath)
    ));
    const rasterDelivered = artifactPaths.some((artifactPath) => (
        /\.(?:jpe?g|png|webp)$/iu.test(artifactPath)
    ));
    if (resultRefs.length === 0
        || (editableRequired && !editableDelivered)
        || (rasterRequired && !rasterDelivered)) {
        return incompleteEvidence();
    }
    return {
        status: 'passed',
        resultRefs: Array.from(new Set(resultRefs)),
        artifactPaths
    };
}

function incompleteEvidence(): AgenticFinalDeliveryEvidence {
    return {
        status: 'incomplete',
        resultRefs: [],
        artifactPaths: []
    };
}
