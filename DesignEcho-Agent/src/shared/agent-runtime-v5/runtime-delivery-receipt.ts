/**
 * E2 交付收据契约。
 *
 * 复合 Skill 可以声明自己真实形成了哪些交付物；Runtime 仍会独立核对目标文档、
 * 文件提交时的源 Host 版本、已复核全图和 Manifest 要求。普通 success、旧收据、
 * 同文档不同 revision 或未读图截图都不能直接推进 E2。
 */

import {
    readPhotoshopSourceHistoryStateRef,
    samePhotoshopHistoryStateRef,
    type PhotoshopHistoryStateRef
} from '../photoshop-history-state-ref';
import {
    sameRuntimeExecutionDocument,
    type RuntimeExecutionTargetAnchor
} from './runtime-execution-target';
import type {
    RuntimeDeliveryProofKind,
    SkillRuntimeDeliveryOutputBinding
} from './contracts';

export const RUNTIME_DELIVERY_RECEIPT_VERSION = 'runtime-delivery-receipt/v1' as const;
const LEGACY_RUNTIME_DELIVERY_RECEIPT_VERSION = 'runtime-delivery-receipt/v0' as const;
export const RUNTIME_EDITABLE_DOCUMENT_ARTIFACT_VERSION =
    'runtime-editable-document-artifact/v1' as const;
export const RUNTIME_SCREEN_SET_ARTIFACT_VERSION =
    'runtime-screen-set-artifact/v1' as const;

export interface RuntimeEditableDocumentArtifactProof {
    version: typeof RUNTIME_EDITABLE_DOCUMENT_ARTIFACT_VERSION;
    basis: 'uxp_post_save_file_metadata';
    path: string;
    format: 'psd' | 'psb';
    byteLength: number;
    modifiedAt: number;
    documentId: number;
    canvas: {
        width: number;
        height: number;
    };
}

export interface RuntimeScreenSetArtifactProof {
    version: typeof RUNTIME_SCREEN_SET_ARTIFACT_VERSION;
    basis: 'uxp_full_document_screen_parse';
    documentId: number;
    expectedScreenIds: string[];
    exportedScreenIds: string[];
}

export interface RuntimeDeliveryReceipt {
    version: typeof RUNTIME_DELIVERY_RECEIPT_VERSION;
    status: 'ready' | 'incomplete';
    outputs: string[];
    resultRefs: string[];
    issues: string[];
    /** 实际保存/导出边界所读取的源 Photoshop 文档版本；不是普通观察信用。 */
    sourceHistoryStateRef?: PhotoshopHistoryStateRef;
    boundaries: {
        workflowDeclaredOnly: true;
        manifestBoundAtomicProofAllowed: true;
        targetVerifiedByRuntime: false;
        previewVerifiedByRuntime: false;
        sourceHistoryDeclaredOnly: true;
        sourceHistoryVerifiedByRuntime: false;
        grantsPermission: false;
        changesQualityVerdict: false;
        completesDeliveryByItself: false;
    };
}

export interface RuntimeManifestDeliveryProof {
    resultRef: string;
    capabilityRefs: string[];
    proofKinds: RuntimeDeliveryProofKind[];
    sourceHistoryStateRef?: PhotoshopHistoryStateRef;
    target?: RuntimeExecutionTargetAnchor;
}

export interface RuntimeManifestDeliveryReceiptProjection {
    receipt: RuntimeDeliveryReceipt;
    receiptTarget?: RuntimeExecutionTargetAnchor;
    confirmedOutputRefs: string[];
    missingOutputRefs: string[];
    boundaries: {
        manifestBindingsRequired: true;
        attributedExecutionProofOnly: true;
        exactReviewedSourceHistoryRequired: true;
        rawSaveSuccessInsufficient: true;
        executesTools: false;
    };
}

export interface RuntimeDeliveryVerification {
    version: 'runtime-delivery-verification/v1';
    status: 'passed' | 'incomplete';
    requiredOutputs: string[];
    confirmedOutputs: string[];
    missingOutputs: string[];
    targetBound: boolean;
    reviewedPreviewBound: boolean;
    sourceHistoryStateBound: boolean;
    boundaries: {
        manifestRequirementsOnly: true;
        explicitReceiptRequired: true;
        sameTargetPreviewRequired: true;
        exactSourceHistoryRequired: true;
        qualityVerdictAuthority: false;
        grantsPermission: false;
        executesTools: false;
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function uniqueIdentifiers(values: readonly unknown[], limit = 32): string[] {
    return Array.from(new Set(values
        .map((value) => String(value || '').trim())
        .filter((value) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(value))))
        .slice(0, limit);
}

function uniqueText(values: readonly unknown[], limit = 24): string[] {
    return Array.from(new Set(values
        .map((value) => String(value || '').trim())
        .filter(Boolean)))
        .slice(0, limit);
}

function readResultRecords(value: unknown): Record<string, unknown>[] {
    if (!isRecord(value)) return [];
    return [
        value,
        ...(isRecord(value.data) ? [value.data] : [])
    ];
}

function readPath(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeArtifactPath(value: unknown): string {
    return readPath(value)
        .replace(/\\/g, '/')
        .replace(/\/+/g, '/')
        .toLowerCase();
}

function readPositiveSafeInteger(value: unknown): number | undefined {
    const numeric = Number(value);
    if (!Number.isSafeInteger(numeric) || numeric <= 0) return undefined;
    return numeric;
}

function readPositiveFiniteNumber(value: unknown): number | undefined {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
    return numeric;
}

function readStrictIdentifiers(
    value: unknown,
    input: { min: number; max: number }
): string[] | undefined {
    if (!Array.isArray(value)
        || value.length < input.min
        || value.length > input.max) {
        return undefined;
    }
    const identifiers = value.map((item) => String(item || '').trim());
    if (identifiers.some((identifier) => (
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(identifier)
    )) || new Set(identifiers).size !== identifiers.length) {
        return undefined;
    }
    return identifiers;
}

function sameOrderedIdentifiers(
    left: readonly string[],
    right: readonly string[]
): boolean {
    return left.length === right.length
        && left.every((identifier, index) => identifier === right[index]);
}

export function hasVerifiedEditableDocumentArtifact(
    record: Record<string, unknown>
): boolean {
    if (!isRecord(record.editableDocumentArtifact)) return false;
    const artifact = record.editableDocumentArtifact;
    if (artifact.version !== RUNTIME_EDITABLE_DOCUMENT_ARTIFACT_VERSION
        || artifact.basis !== 'uxp_post_save_file_metadata'
        || !isRecord(artifact.canvas)) {
        return false;
    }
    const sourceHistoryStateRef = readPhotoshopSourceHistoryStateRef(record);
    const recordFormat = String(record.format || '').trim().toLowerCase();
    const artifactFormat = String(artifact.format || '').trim().toLowerCase();
    const savedPath = normalizeArtifactPath(record.savedPath)
        || normalizeArtifactPath(record.filePath);
    const artifactPath = normalizeArtifactPath(artifact.path);
    const byteLength = readPositiveSafeInteger(artifact.byteLength);
    const modifiedAt = readPositiveFiniteNumber(artifact.modifiedAt);
    const documentId = readPositiveSafeInteger(artifact.documentId);
    const width = readPositiveFiniteNumber(artifact.canvas.width);
    const height = readPositiveFiniteNumber(artifact.canvas.height);
    return Boolean(sourceHistoryStateRef
        && (recordFormat === 'psd' || recordFormat === 'psb')
        && artifactFormat === recordFormat
        && savedPath
        && artifactPath === savedPath
        && savedPath.endsWith(`.${recordFormat}`)
        && byteLength
        && modifiedAt
        && documentId === sourceHistoryStateRef.documentId
        && width
        && height);
}

function hasVerifiedScreenSetArtifact(
    record: Record<string, unknown>,
    screens: readonly unknown[]
): boolean {
    if (!isRecord(record.screenSetArtifact)) return false;
    const artifact = record.screenSetArtifact;
    if (artifact.version !== RUNTIME_SCREEN_SET_ARTIFACT_VERSION
        || artifact.basis !== 'uxp_full_document_screen_parse') {
        return false;
    }
    const sourceHistoryStateRef = readPhotoshopSourceHistoryStateRef(record);
    const documentId = readPositiveSafeInteger(artifact.documentId);
    const expectedScreenIds = readStrictIdentifiers(
        artifact.expectedScreenIds,
        { min: 2, max: 64 }
    );
    const exportedScreenIds = readStrictIdentifiers(
        artifact.exportedScreenIds,
        { min: 2, max: 64 }
    );
    const resultScreenIds = readStrictIdentifiers(
        screens.map((screen) => (
            isRecord(screen) ? screen.screenId : undefined
        )),
        { min: 2, max: 64 }
    );
    return Boolean(sourceHistoryStateRef
        && documentId === sourceHistoryStateRef.documentId
        && expectedScreenIds
        && exportedScreenIds
        && resultScreenIds
        && sameOrderedIdentifiers(expectedScreenIds, exportedScreenIds)
        && sameOrderedIdentifiers(exportedScreenIds, resultScreenIds));
}

/**
 * 把真实交付 Tool 结果归一为通用品类无关的结果类型。只识别已经落盘且结构完整的结果，
 * 普通 success 或 outputDir 本身不产生任何交付信用。
 */
export function readRuntimeDeliveryProofKinds(
    toolResult: unknown
): RuntimeDeliveryProofKind[] {
    const kinds = new Set<RuntimeDeliveryProofKind>();
    for (const record of readResultRecords(toolResult)) {
        if (record.success !== true) continue;
        if (hasVerifiedEditableDocumentArtifact(record)) {
            kinds.add('saved_editable_document');
        }

        const screens = Array.isArray(record.screens) ? record.screens : [];
        const totalScreens = Number(record.totalScreens);
        const successCount = Number(record.successCount);
        const failedCount = Number(record.failedCount);
        const screenPaths = screens.map((screen) => (
            isRecord(screen) ? readPath(screen.path) : ''
        ));
        const screenPathsComplete = screenPaths.length > 0
            && screenPaths.every(Boolean)
            && new Set(screenPaths).size === screenPaths.length;
        const screenSizesComplete = screens.every((screen) => {
            if (!isRecord(screen) || !isRecord(screen.size)) return false;
            const width = Number(screen.size.width);
            const height = Number(screen.size.height);
            const fileSize = Number(screen.fileSize);
            return Number.isFinite(width) && width > 0
                && Number.isFinite(height) && height > 0
                && Number.isFinite(fileSize) && fileSize > 0;
        });
        if (Number.isSafeInteger(totalScreens)
            && totalScreens > 0
            && successCount === totalScreens
            && failedCount === 0
            && screens.length === totalScreens
            && record.sourceStateRestored === true
            && screenPathsComplete
            && screenSizesComplete
            && hasVerifiedScreenSetArtifact(record, screens)) {
            kinds.add('exported_image_slices');
        }
    }
    return Array.from(kinds);
}

export function buildRuntimeDeliveryReceipt(input: {
    status: RuntimeDeliveryReceipt['status'];
    outputs: readonly string[];
    resultRefs: readonly string[];
    issues?: readonly string[];
    sourceHistoryStateRef?: PhotoshopHistoryStateRef;
}): RuntimeDeliveryReceipt {
    const outputs = uniqueIdentifiers(input.outputs);
    const resultRefs = uniqueIdentifiers(input.resultRefs, 48);
    const issues = uniqueText(input.issues || []);
    const sourceHistoryStateRef = readPhotoshopSourceHistoryStateRef({
        sourceHistoryStateRef: input.sourceHistoryStateRef
    });
    const ready = input.status === 'ready'
        && outputs.length > 0
        && resultRefs.length > 0
        && Boolean(sourceHistoryStateRef)
        && issues.length === 0;
    return {
        version: RUNTIME_DELIVERY_RECEIPT_VERSION,
        status: ready ? 'ready' : 'incomplete',
        outputs,
        resultRefs,
        issues,
        ...(sourceHistoryStateRef ? { sourceHistoryStateRef } : {}),
        boundaries: {
            workflowDeclaredOnly: true,
            manifestBoundAtomicProofAllowed: true,
            targetVerifiedByRuntime: false,
            previewVerifiedByRuntime: false,
            sourceHistoryDeclaredOnly: true,
            sourceHistoryVerifiedByRuntime: false,
            grantsPermission: false,
            changesQualityVerdict: false,
            completesDeliveryByItself: false
        }
    };
}

/**
 * 将“R4 计划已唯一归属的 deliver 动作”投影成 E2 收据候选。
 * 输出语义来自 Manifest binding，动作事实来自真实 save/export 结果，两者缺一不可。
 */
export function projectManifestBoundRuntimeDeliveryReceipt(input: {
    requiredOutputs: readonly string[];
    outputBindings: Readonly<Record<string, SkillRuntimeDeliveryOutputBinding>> | undefined;
    proofs: readonly RuntimeManifestDeliveryProof[];
    reviewedPreviewTarget?: RuntimeExecutionTargetAnchor;
    reviewedPreviewHistoryStateRef?: PhotoshopHistoryStateRef;
}): RuntimeManifestDeliveryReceiptProjection | undefined {
    const requiredOutputs = uniqueIdentifiers(input.requiredOutputs);
    const outputBindings = input.outputBindings;
    if (!outputBindings || Object.keys(outputBindings).length === 0) return undefined;

    const runtimeOwnedOutputs = new Set(['preview', 'delivery_record']);
    const confirmedOutputRefs: string[] = [];
    const missingOutputRefs: string[] = [];
    const selectedProofs = new Map<string, RuntimeManifestDeliveryProof>();

    for (const outputRef of requiredOutputs) {
        if (runtimeOwnedOutputs.has(outputRef)) continue;
        const binding = outputBindings[outputRef];
        if (!binding) {
            missingOutputRefs.push(outputRef);
            continue;
        }
        const capabilityRefs = new Set(uniqueIdentifiers(binding.capability_refs));
        const proof = [...input.proofs].reverse().find((candidate) => (
            candidate.proofKinds.includes(binding.proof_kind)
            && candidate.capabilityRefs.some((capabilityRef) => capabilityRefs.has(capabilityRef))
            && samePhotoshopHistoryStateRef(
                candidate.sourceHistoryStateRef,
                input.reviewedPreviewHistoryStateRef
            )
            && sameRuntimeExecutionDocument(
                candidate.target,
                input.reviewedPreviewTarget
            )
        ));
        if (!proof) {
            missingOutputRefs.push(outputRef);
            continue;
        }
        confirmedOutputRefs.push(outputRef);
        selectedProofs.set(outputRef, proof);
    }

    const selected = Array.from(selectedProofs.values());
    const receiptTarget = selected[0]?.target;
    const allTargetsMatch = selected.every((proof) => (
        sameRuntimeExecutionDocument(receiptTarget, proof.target)
    ));
    const allRequiredProofPresent = missingOutputRefs.length === 0
        && confirmedOutputRefs.length > 0
        && allTargetsMatch;
    const receipt = buildRuntimeDeliveryReceipt({
        status: allRequiredProofPresent ? 'ready' : 'incomplete',
        outputs: confirmedOutputRefs,
        resultRefs: selected.map((proof) => proof.resultRef),
        issues: [
            ...missingOutputRefs.map((outputRef) => `缺少 Manifest 绑定的交付结果：${outputRef}`),
            ...(!allTargetsMatch ? ['交付结果不属于同一 Photoshop 文档'] : [])
        ],
        sourceHistoryStateRef: allRequiredProofPresent
            ? input.reviewedPreviewHistoryStateRef
            : undefined
    });
    return {
        receipt,
        ...(receiptTarget ? { receiptTarget } : {}),
        confirmedOutputRefs,
        missingOutputRefs,
        boundaries: {
            manifestBindingsRequired: true,
            attributedExecutionProofOnly: true,
            exactReviewedSourceHistoryRequired: true,
            rawSaveSuccessInsufficient: true,
            executesTools: false
        }
    };
}

export function readRuntimeDeliveryReceipt(toolResult: unknown): RuntimeDeliveryReceipt | undefined {
    if (!isRecord(toolResult) || !isRecord(toolResult.data)) return undefined;
    const candidate = toolResult.data.runtimeDeliveryReceipt;
    if (!isRecord(candidate)
        || (candidate.version !== RUNTIME_DELIVERY_RECEIPT_VERSION
            && candidate.version !== LEGACY_RUNTIME_DELIVERY_RECEIPT_VERSION)
        || (candidate.status !== 'ready' && candidate.status !== 'incomplete')
        || !Array.isArray(candidate.outputs)
        || !Array.isArray(candidate.resultRefs)
        || !Array.isArray(candidate.issues)) {
        return undefined;
    }
    return buildRuntimeDeliveryReceipt({
        // v0 没有源 Host 版本，只能作为 legacy/incomplete 读取，绝不能推进 E2。
        status: candidate.version === RUNTIME_DELIVERY_RECEIPT_VERSION
            ? candidate.status
            : 'incomplete',
        outputs: candidate.outputs,
        resultRefs: candidate.resultRefs,
        issues: candidate.issues,
        sourceHistoryStateRef: readPhotoshopSourceHistoryStateRef(candidate)
    });
}

export function verifyRuntimeDelivery(input: {
    requiredOutputs: readonly string[];
    receipt: RuntimeDeliveryReceipt | undefined;
    receiptTarget: RuntimeExecutionTargetAnchor | undefined;
    reviewedPreviewTarget?: RuntimeExecutionTargetAnchor;
    reviewedPreviewHistoryStateRef?: PhotoshopHistoryStateRef;
}): RuntimeDeliveryVerification {
    const requiredOutputs = uniqueIdentifiers(input.requiredOutputs);
    const targetBound = Boolean(input.receiptTarget);
    const reviewedPreviewBound = sameRuntimeExecutionDocument(
        input.receiptTarget,
        input.reviewedPreviewTarget
    );
    const sourceHistoryStateBound = reviewedPreviewBound
        && samePhotoshopHistoryStateRef(
            input.receipt?.sourceHistoryStateRef,
            input.reviewedPreviewHistoryStateRef
        );
    const confirmedOutputs = input.receipt?.status === 'ready'
        && targetBound
        && sourceHistoryStateBound
        ? uniqueIdentifiers([
            ...input.receipt.outputs,
            'delivery_record',
            'preview'
        ])
        : [];
    const missingOutputs = requiredOutputs.filter((output) => !confirmedOutputs.includes(output));
    return {
        version: 'runtime-delivery-verification/v1',
        status: input.receipt?.status === 'ready'
            && targetBound
            && sourceHistoryStateBound
            && requiredOutputs.length > 0
            && missingOutputs.length === 0
            ? 'passed'
            : 'incomplete',
        requiredOutputs,
        confirmedOutputs,
        missingOutputs,
        targetBound,
        reviewedPreviewBound,
        sourceHistoryStateBound,
        boundaries: {
            manifestRequirementsOnly: true,
            explicitReceiptRequired: true,
            sameTargetPreviewRequired: true,
            exactSourceHistoryRequired: true,
            qualityVerdictAuthority: false,
            grantsPermission: false,
            executesTools: false
        }
    };
}
