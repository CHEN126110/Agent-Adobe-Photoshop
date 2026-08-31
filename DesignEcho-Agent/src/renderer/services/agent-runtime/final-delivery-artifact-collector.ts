import { classifyAgentToolExecution } from '../../../shared/agent-tool-execution-preflight';
import { readRuntimeDeliveryReceipt } from '../../../shared/agent-runtime-v5/runtime-delivery-receipt';
import { collectRuntimeFinalArtifactPathCandidates } from '../../../shared/runtime-final-artifact-paths';
import { getSkillById } from '../../../shared/skills/skill-declarations';
import type { AgentToolCallLogEntry } from './types';

export interface AgentFinalDeliveryArtifactCollectionInput {
    entries: readonly AgentToolCallLogEntry[];
    resultRefs?: readonly string[];
    includeProducerReceipts: boolean;
}

export interface AgentDebugSkuDeliverySource {
    version: 'agent-debug-sku-delivery-source/v1';
    runtimeDeliveryReceipt: NonNullable<ReturnType<typeof readRuntimeDeliveryReceipt>>;
    skuExportReadback: unknown;
    skuEditableDeliveryReadback: unknown;
}

export interface AgentFinalDeliveryDebugProjection {
    pathCandidates: unknown[];
    skuDeliverySource?: AgentDebugSkuDeliverySource;
}

function resolveProducerReceiptRefs(input: AgentFinalDeliveryArtifactCollectionInput): {
    finalResultRefSet: Set<string>;
    producerReceiptCallRefs: string[];
    producerReceiptE2CallRefs: string[];
} {
    const finalResultRefSet = new Set(
        (input.resultRefs || []).map((value) => String(value || '').trim()).filter(Boolean)
    );
    const producerReceiptCallRefs = input.includeProducerReceipts
        ? input.entries.flatMap((entry) => {
            if (!entry.callId
                || !getSkillById(entry.name)
                || entry.result?.success === false
                || readRuntimeDeliveryReceipt(entry.result)?.status !== 'ready') {
                return [];
            }
            const kind = classifyAgentToolExecution(entry.name, entry.arguments);
            return kind === 'photoshop_write' || kind === 'save_export'
                ? [entry.callId]
                : [];
        })
        : [];
    const producerReceiptE2CallRefs = input.includeProducerReceipts && finalResultRefSet.size > 0
        ? input.entries.flatMap((entry) => {
            if (!entry.callId || !producerReceiptCallRefs.includes(entry.callId)) return [];
            const deliveryReceipt = readRuntimeDeliveryReceipt(entry.result);
            if (deliveryReceipt?.status !== 'ready'
                || deliveryReceipt.resultRefs.length === 0
                || deliveryReceipt.resultRefs.length !== finalResultRefSet.size
                || !deliveryReceipt.resultRefs.every((resultRef) => finalResultRefSet.has(resultRef))) {
                return [];
            }
            return [entry.callId];
        })
        : [];
    return { finalResultRefSet, producerReceiptCallRefs, producerReceiptE2CallRefs };
}

function collectDebugSkuDeliverySource(
    input: AgentFinalDeliveryArtifactCollectionInput,
    producerReceiptE2CallRefs: readonly string[]
): AgentDebugSkuDeliverySource | undefined {
    const candidates = input.entries.flatMap((entry) => {
        if (!entry.callId || !producerReceiptE2CallRefs.includes(entry.callId)) return [];
        const runtimeDeliveryReceipt = readRuntimeDeliveryReceipt(entry.result);
        const data = entry.result?.data;
        if (runtimeDeliveryReceipt?.status !== 'ready'
            || runtimeDeliveryReceipt.settlementScope !== 'multi_document_task'
            || !runtimeDeliveryReceipt.outputs.includes('editable_sku_batch_documents')
            || !runtimeDeliveryReceipt.outputs.includes('sku_images')
            || !data
            || typeof data !== 'object'
            || Array.isArray(data)
            || !data.skuExportReadback
            || !data.skuEditableDeliveryReadback) {
            return [];
        }
        return [{
            version: 'agent-debug-sku-delivery-source/v1' as const,
            runtimeDeliveryReceipt,
            skuExportReadback: data.skuExportReadback,
            skuEditableDeliveryReadback: data.skuEditableDeliveryReadback
        }];
    });
    return candidates.length === 1 ? candidates[0] : undefined;
}

/** 只向受控 Debug sidecar 投影 E2 最终文件与 SKU 成对证据；不进入普通 Agent 结果。 */
export function collectAgentFinalDeliveryDebugProjection(
    input: AgentFinalDeliveryArtifactCollectionInput
): AgentFinalDeliveryDebugProjection {
    const { producerReceiptCallRefs, producerReceiptE2CallRefs } = resolveProducerReceiptRefs(input);
    const pathCandidates = collectRuntimeFinalArtifactPathCandidates({
        entries: input.entries,
        resultRefs: input.resultRefs,
        producerReceiptCallRefs,
        producerReceiptE2CallRefs,
        includeProducerReceipts: input.includeProducerReceipts
    });
    const skuDeliverySource = collectDebugSkuDeliverySource(input, producerReceiptE2CallRefs);
    return {
        pathCandidates,
        ...(skuDeliverySource ? { skuDeliverySource } : {})
    };
}
