import {
    hasVerifiedEditableDocumentArtifact,
    type RuntimeDeliveryArtifactEntry,
    type RuntimeEditableDocumentArtifactProof
} from '../../../shared/agent-runtime-v5/runtime-delivery-receipt';
import {
    isSuccessfulSkuExportFileProbe,
    type SkuExpectedExportInventoryItem,
    type SkuExportFileProbeInput
} from '../../../shared/sku-export-readback';
import {
    readPhotoshopSourceHistoryStateRef,
    samePhotoshopHistoryStateRef
} from '../../../shared/photoshop-history-state-ref';
import {
    normalizeSkuExportPathForCompare,
    verifySkuExportFreshness,
    type SkuExportFileBaseline,
    type SkuExportTransactionHost
} from './sku-export-transaction.service';

export interface SkuEditableDeliveryReceipt {
    itemId: string;
    path: string;
    stagedPath?: string;
    format: 'psb';
    sourceHistoryStateRef: { documentId: number; historyStateId: number };
    editableDocumentArtifact: RuntimeEditableDocumentArtifactProof;
    structureReadback: {
        schema: 'sku-editable-structure-readback/v1';
        templateName: string;
        combination: string[];
        copiedLayerIds: number[];
        copiedLayerNames: string[];
        flattened: false;
        autoLayoutQaStatus: 'ready';
    };
    freshnessProof: 'staged_uxp_proof' | 'new_path' | 'modified_since_baseline';
    promotionVerified: boolean;
}

export interface SkuEditableDeliveryReadback {
    version: 'sku-editable-delivery-readback/v1';
    status: 'ready' | 'blocked';
    expectedCount: number;
    verifiedCount: number;
    expectedPaths: string[];
    verifiedPaths: string[];
    missingItemIds: string[];
    violations: string[];
    items: Array<{
        itemId: string;
        rasterPath: string;
        editablePath: string;
        templateName: string;
        combination: string[];
        sourceHistoryStateRef: { documentId: number; historyStateId: number };
        copiedLayerIds: number[];
        copiedLayerNames: string[];
        freshnessProof: 'new_path' | 'modified_since_baseline';
        promotionVerified: true;
    }>;
}

export const REQUIRED_SKU_PAIRED_EDITABLE_DELIVERY_REVISION = 'sku-paired-editable-delivery/v1';

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeCapabilityActions(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.map((action) => String(action || '').trim()).filter(Boolean);
}

export function supportsSkuPairedEditableDelivery(result: unknown): boolean {
    if (!isRecord(result) || result.success === false) return false;
    const data = isRecord(result.data) ? result.data : {};
    const capability = isRecord(data.pairedEditableDelivery)
        ? data.pairedEditableDelivery
        : {};
    const actions = normalizeCapabilityActions(capability.actions);
    return capability.revision === REQUIRED_SKU_PAIRED_EDITABLE_DELIVERY_REVISION
        && capability.deliveryPlanVersion === 'sku-layout-delivery-plan/v1'
        && capability.savesAfterGeometryQa === true
        && capability.savesBeforeCopiedLayerCleanup === true
        && capability.returnsEditableDocumentArtifact === true
        && capability.returnsStructureReadback === true
        && capability.bindsRasterAndEditableHistory === true
        && actions.includes('execute')
        && actions.includes('arrangeDynamic');
}

function sameOrderedStrings(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length
        && left.every((value, index) => value === right[index]);
}

function readPositiveIntegerArray(value: unknown): number[] | undefined {
    if (!Array.isArray(value) || value.length === 0) return undefined;
    const numbers = value.map(Number);
    if (numbers.some((number) => !Number.isSafeInteger(number) || number <= 0)
        || new Set(numbers).size !== numbers.length) {
        return undefined;
    }
    return numbers;
}

function readNonEmptyStringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value) || value.length === 0) return undefined;
    const strings = value.map((item) => String(item || '').trim());
    if (strings.some((item) => !item)) return undefined;
    return strings;
}

export function buildSkuRuntimeDeliveryArtifacts(input: {
    expectedItems: readonly SkuExpectedExportInventoryItem[];
    rasterFileProbes: readonly SkuExportFileProbeInput[];
    editableReceipts: ReadonlyMap<string, SkuEditableDeliveryReceipt>;
}): RuntimeDeliveryArtifactEntry[] {
    const verifiedRasterPathKeys = new Set(input.rasterFileProbes
        .filter((probe) => (
            isSuccessfulSkuExportFileProbe(probe) && probe.freshnessVerified === true
        ))
        .map((probe) => normalizeSkuExportPathForCompare(String(probe.path || '')))
        .filter(Boolean));
    return input.expectedItems.flatMap((item) => {
        const artifacts: RuntimeDeliveryArtifactEntry[] = [];
        if (verifiedRasterPathKeys.has(normalizeSkuExportPathForCompare(item.path))) {
            artifacts.push({
                path: item.path,
                kind: 'raster_export',
                proof: 'file_probe'
            });
        }
        const editableReceipt = input.editableReceipts.get(item.id);
        if (editableReceipt?.promotionVerified === true
            && normalizeSkuExportPathForCompare(editableReceipt.path)
                === normalizeSkuExportPathForCompare(item.editablePath)) {
            artifacts.push({
                path: editableReceipt.path,
                kind: 'editable_document',
                proof: 'staged_editable_document_promotion'
            });
        }
        return artifacts;
    });
}

export async function validateSkuEditableDeliveryResult(input: {
    expected: SkuExpectedExportInventoryItem;
    toolResult: unknown;
    baseline?: SkuExportFileBaseline;
    stagedEditablePath?: string;
    host?: SkuExportTransactionHost;
}): Promise<{ success: true; receipt: SkuEditableDeliveryReceipt } | { success: false; error: string }> {
    const root = isRecord(input.toolResult) ? input.toolResult : undefined;
    const data = root && isRecord(root.data) ? root.data : undefined;
    const records = data && Array.isArray(data.editableDocuments)
        ? data.editableDocuments
        : [];
    const matchingRecords = records.filter((record) => (
        isRecord(record) && record.deliveryItemId === input.expected.id
    ));
    if (matchingRecords.length !== 1 || !isRecord(matchingRecords[0])) {
        return { success: false, error: `${input.expected.id} 没有返回唯一可编辑文档回执。` };
    }
    const record = matchingRecords[0];
    if (record.deliveryItemId !== input.expected.id
        || record.success !== true
        || !hasVerifiedEditableDocumentArtifact(record)) {
        return { success: false, error: `${input.expected.id} 的可编辑文档回执身份或 UXP 保存证明无效。` };
    }
    const sourceHistoryStateRef = readPhotoshopSourceHistoryStateRef(record);
    const rasterSourceHistoryStateRef = isRecord(record.rasterSourceHistoryStateRef)
        ? readPhotoshopSourceHistoryStateRef({
            sourceHistoryStateRef: record.rasterSourceHistoryStateRef
        })
        : undefined;
    if (!sourceHistoryStateRef
        || !rasterSourceHistoryStateRef
        || !samePhotoshopHistoryStateRef(sourceHistoryStateRef, rasterSourceHistoryStateRef)) {
        return { success: false, error: `${input.expected.id} 的 JPG 与 PSB 没有绑定同一 Photoshop 版本。` };
    }
    const savedPath = String(record.savedPath || '').trim();
    const expectedObservedPath = String(input.stagedEditablePath || input.expected.editablePath).trim();
    if (normalizeSkuExportPathForCompare(savedPath)
        !== normalizeSkuExportPathForCompare(expectedObservedPath)) {
        return { success: false, error: `${input.expected.id} 的可编辑文档路径偏离执行前冻结计划。` };
    }
    const structure = isRecord(record.structureReadback) ? record.structureReadback : undefined;
    const combination = structure ? readNonEmptyStringArray(structure.combination) : undefined;
    const copiedLayerIds = structure ? readPositiveIntegerArray(structure.copiedLayerIds) : undefined;
    const copiedLayerNames = structure ? readNonEmptyStringArray(structure.copiedLayerNames) : undefined;
    if (!structure
        || structure.schema !== 'sku-editable-structure-readback/v1'
        || String(structure.templateName || '').trim() !== input.expected.templateName
        || !combination
        || !sameOrderedStrings(combination, input.expected.combination)
        || !copiedLayerIds
        || copiedLayerIds.length !== input.expected.combination.length
        || !copiedLayerNames
        || copiedLayerNames.length !== copiedLayerIds.length
        || structure.flattened !== false
        || structure.autoLayoutQaStatus !== 'ready') {
        return { success: false, error: `${input.expected.id} 的可编辑图层结构读回不完整。` };
    }
    const freshness = input.stagedEditablePath
        ? { verified: true, proof: 'staged_uxp_proof' as const }
        : await verifySkuExportFreshness({
            filePath: input.expected.editablePath,
            baseline: input.baseline,
            host: input.host
        });
    if (!freshness.verified || freshness.proof === 'unverified') {
        const freshnessError = 'error' in freshness ? freshness.error : undefined;
        return {
            success: false,
            error: `${input.expected.id} 的可编辑文档不能证明是本轮新写入：${freshnessError || '未知原因'}`
        };
    }
    return {
        success: true,
        receipt: {
            itemId: input.expected.id,
            path: input.expected.editablePath,
            ...(input.stagedEditablePath ? { stagedPath: expectedObservedPath } : {}),
            format: 'psb',
            sourceHistoryStateRef,
            editableDocumentArtifact: record.editableDocumentArtifact as RuntimeEditableDocumentArtifactProof,
            structureReadback: {
                schema: 'sku-editable-structure-readback/v1',
                templateName: input.expected.templateName,
                combination: [...combination],
                copiedLayerIds: [...copiedLayerIds],
                copiedLayerNames: [...copiedLayerNames],
                flattened: false,
                autoLayoutQaStatus: 'ready'
            },
            freshnessProof: freshness.proof,
            promotionVerified: !input.stagedEditablePath
        }
    };
}

export async function finalizeSkuEditableDeliveryReceipts(input: {
    receipts: ReadonlyMap<string, SkuEditableDeliveryReceipt>;
    baselines: ReadonlyMap<string, SkuExportFileBaseline>;
    host?: SkuExportTransactionHost;
}): Promise<{
    receipts: Map<string, SkuEditableDeliveryReceipt>;
    violations: string[];
}> {
    const receipts = new Map<string, SkuEditableDeliveryReceipt>();
    const violations: string[] = [];
    for (const [itemId, receipt] of input.receipts) {
        const freshness = await verifySkuExportFreshness({
            filePath: receipt.path,
            baseline: input.baselines.get(normalizeSkuExportPathForCompare(receipt.path)),
            host: input.host
        });
        if (!freshness.verified || freshness.proof === 'unverified') {
            violations.push(
                `${itemId} 的可编辑 PSB 事务提交后无法证明为本轮新文件：${freshness.error || '未知原因'}`
            );
            continue;
        }
        receipts.set(itemId, {
            ...receipt,
            freshnessProof: freshness.proof,
            promotionVerified: true
        });
    }
    return { receipts, violations };
}

export function buildSkuEditableDeliveryReadback(input: {
    expectedItems: readonly SkuExpectedExportInventoryItem[];
    receipts: ReadonlyMap<string, SkuEditableDeliveryReceipt>;
    violations?: readonly string[];
}): SkuEditableDeliveryReadback {
    const expectedPaths = input.expectedItems.map((item) => item.editablePath);
    const missingItemIds = input.expectedItems
        .filter((item) => input.receipts.get(item.id)?.promotionVerified !== true)
        .map((item) => item.id);
    const items = input.expectedItems.flatMap((item) => {
        const receipt = input.receipts.get(item.id);
        if (receipt?.promotionVerified !== true
            || (receipt.freshnessProof !== 'new_path'
                && receipt.freshnessProof !== 'modified_since_baseline')) {
            return [];
        }
        return [{
            itemId: item.id,
            rasterPath: item.path,
            editablePath: receipt.path,
            templateName: receipt.structureReadback.templateName,
            combination: [...receipt.structureReadback.combination],
            sourceHistoryStateRef: { ...receipt.sourceHistoryStateRef },
            copiedLayerIds: [...receipt.structureReadback.copiedLayerIds],
            copiedLayerNames: [...receipt.structureReadback.copiedLayerNames],
            freshnessProof: receipt.freshnessProof,
            promotionVerified: true as const
        }];
    });
    const verifiedPaths = items.map((item) => item.editablePath);
    const violations = Array.from(new Set((input.violations || [])
        .map((value) => String(value || '').trim())
        .filter(Boolean)));
    const ready = input.expectedItems.length > 0
        && missingItemIds.length === 0
        && verifiedPaths.length === expectedPaths.length
        && violations.length === 0;
    return {
        version: 'sku-editable-delivery-readback/v1',
        status: ready ? 'ready' : 'blocked',
        expectedCount: input.expectedItems.length,
        verifiedCount: verifiedPaths.length,
        expectedPaths,
        verifiedPaths,
        missingItemIds,
        violations,
        items
    };
}
