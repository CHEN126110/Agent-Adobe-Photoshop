/**
 * Agentic Manifest 的复合 Workflow 交付收据选择器。
 *
 * Manifest 要求 typed DeliveryPlan 时，普通 save/export 仍可作为 Agent 工作动作，
 * 但不能取得正式交付信用。本模块只从 Manifest 声明的 producer Skill 中选择一张
 * ready RuntimeDeliveryReceipt，并拒绝其后的内容写入或另一次保存/导出；不执行 Tool、
 * 不选择文件，也不判断设计质量。
 */

import { findLatestObservedPhotoshopMutationIndex } from '../../../shared/agent-operation-document-timeline';
import { classifyAgentToolExecution } from '../../../shared/agent-tool-execution-preflight';
import {
    readRuntimeDeliveryReceipt,
    type RuntimeDeliveryReceipt
} from '../../../shared/agent-runtime-v5/runtime-delivery-receipt';
import type {
    AgenticArtifactCompletionContract,
    AgentToolCallLogEntry
} from './types';

export interface AgenticWorkflowDeliveryReceiptEvidence {
    callId: string;
    producerSkillId: string;
    receipt: RuntimeDeliveryReceipt;
    rasterArtifactCount: number;
    editableArtifactCount: number;
}

function clean(value: unknown): string {
    return String(value || '').trim();
}

function isRasterArtifact(path: string, kind: string): boolean {
    return kind === 'raster_export' || /\.(?:jpe?g|png|webp)$/iu.test(path);
}

function isEditableArtifact(path: string, kind: string): boolean {
    return kind === 'editable_document' || /\.(?:psd|psb)$/iu.test(path);
}

function receiptCoversContract(
    receipt: RuntimeDeliveryReceipt,
    contract: AgenticArtifactCompletionContract
): boolean {
    if (receipt.status !== 'ready'
        || !receipt.deliveryPlanDigest
        || !receipt.deliveryPlanConvention
        || receipt.resultRefs.length === 0
        || receipt.resultRefProofs.length !== receipt.resultRefs.length
        || !receipt.resultRefs.every((resultRef) => receipt.resultRefProofs.some((proof) => (
            proof.resultRef === resultRef && proof.effect === 'save_export'
        )))
        || receipt.artifacts.length === 0) {
        return false;
    }
    if (!receipt.artifacts.every((artifact) => (
        Boolean(artifact.planBinding)
        && Boolean(artifact.sourceHistoryStateRef)
        && Number.isSafeInteger(Number(artifact.fileIdentity?.byteLength))
        && Number(artifact.fileIdentity?.byteLength) > 0
        && /^[a-f0-9]{64}$/.test(clean(artifact.fileIdentity?.sha256))
    ))) {
        return false;
    }
    const deliveredOutputs = new Set(receipt.outputs.map(clean).filter(Boolean));
    return contract.deliveryOutputs.every((output) => deliveredOutputs.has(clean(output)));
}

function hasLaterDeliveryOrContentMutation(
    entries: readonly AgentToolCallLogEntry[],
    producerIndex: number
): boolean {
    const laterEntries = entries.slice(producerIndex + 1);
    if (findLatestObservedPhotoshopMutationIndex(laterEntries) >= 0) return true;
    return laterEntries.some((entry) => (
        entry.result?.success !== false
        && classifyAgentToolExecution(entry.name, entry.arguments) === 'save_export'
    ));
}

export function resolveAgenticWorkflowDeliveryReceipt(input: {
    contract?: AgenticArtifactCompletionContract;
    toolCallLog: readonly AgentToolCallLogEntry[];
}): AgenticWorkflowDeliveryReceiptEvidence | undefined {
    const contract = input.contract;
    if (contract?.deliveryPlanBindingRequired !== true) return undefined;
    const producerSkillIds = new Set(
        (contract.deliveryReceiptProducerSkillIds || []).map(clean).filter(Boolean)
    );
    if (producerSkillIds.size === 0) return undefined;

    for (let index = input.toolCallLog.length - 1; index >= 0; index -= 1) {
        const entry = input.toolCallLog[index];
        const callId = clean(entry?.callId);
        const producerSkillId = clean(entry?.name);
        if (!entry
            || !callId
            || !producerSkillIds.has(producerSkillId)
            || entry.result?.success !== true
            || hasLaterDeliveryOrContentMutation(input.toolCallLog, index)) {
            continue;
        }
        const receipt = readRuntimeDeliveryReceipt(entry.result);
        if (!receipt || !receiptCoversContract(receipt, contract)) continue;
        const rasterArtifactCount = receipt.artifacts.filter((artifact) => (
            isRasterArtifact(clean(artifact.path), clean(artifact.kind))
        )).length;
        const editableArtifactCount = receipt.artifacts.filter((artifact) => (
            isEditableArtifact(clean(artifact.path), clean(artifact.kind))
        )).length;
        return {
            callId,
            producerSkillId,
            receipt,
            rasterArtifactCount,
            editableArtifactCount
        };
    }
    return undefined;
}
