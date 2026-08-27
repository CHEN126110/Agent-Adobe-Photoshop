/**
 * E2 交付收据契约。
 *
 * 复合 Skill 可以声明自己真实形成了哪些交付物。单文档交付由 Runtime 核对目标、
 * 文件提交源 Host 版本与已复核全图；多文档批次必须逐项声明 save/export resultRef，
 * 再由 Runtime 绑定同一 TaskRun 的最后 mutation。普通 success、旧收据、部分文件、
 * 错目标或收据后的内容修改都不能直接推进 E2。
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
import {
    buildSkillDeliveryPlanDigest,
    isCurrentSkillDeliveryPlanDigest,
    isSkillDeliveryPlanDigest,
    normalizeSkillDeliveryArtifactPath,
    normalizeSkillDeliveryPlanArtifact,
    resolveRuntimeSkillDeliveryConvention,
    type SkillDeliveryConvention,
    type SkillDeliveryPlanArtifact
} from '../skills/skill-delivery-convention';
import type {
    RuntimeDeliveryProofKind,
    SkillRuntimeDeliveryOutputBinding
} from './contracts';

export const RUNTIME_DELIVERY_RECEIPT_VERSION = 'runtime-delivery-receipt/v2' as const;
export const MAX_RUNTIME_DELIVERY_RESULT_REFS = 48;
export const MAX_RUNTIME_DELIVERY_ARTIFACTS = 96;
const LEGACY_RUNTIME_DELIVERY_RECEIPT_V1 = 'runtime-delivery-receipt/v1' as const;
const LEGACY_RUNTIME_DELIVERY_RECEIPT_V0 = 'runtime-delivery-receipt/v0' as const;
export const RUNTIME_EDITABLE_DOCUMENT_ARTIFACT_VERSION =
    'runtime-editable-document-artifact/v1' as const;
export const RUNTIME_SCREEN_SET_ARTIFACT_VERSION =
    'runtime-screen-set-artifact/v1' as const;

export interface RuntimeEditableDocumentArtifactProof {
    version: typeof RUNTIME_EDITABLE_DOCUMENT_ARTIFACT_VERSION;
    basis: 'uxp_post_save_file_metadata';
    path: string;
    format: 'psd' | 'psb' | 'tiff';
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

export type RuntimeDeliverySettlementScope =
    | 'single_document_revision'
    | 'multi_document_task';

export interface RuntimeDeliveryResultRefProof {
    resultRef: string;
    effect: 'save_export';
}

export type RuntimeDeliveryArtifactKind = 'editable_document' | 'raster_export';
export type RuntimeDeliveryArtifactProof =
    | 'editable_document_artifact'
    | 'file_probe'
    | 'staged_editable_document_promotion'
    | 'uxp_export_readback';

export interface RuntimeDeliveryArtifactFileIdentity {
    /** Main 或受信文件探针对正式目标重新读取的完整 SHA-256（64 位小写 hex）。 */
    sha256: string;
    byteLength: number;
}

export interface RuntimeDeliveryArtifactEntry {
    path: string;
    kind: RuntimeDeliveryArtifactKind;
    proof: RuntimeDeliveryArtifactProof;
    fileIdentity?: RuntimeDeliveryArtifactFileIdentity;
    /** 生成该文件内容的 Photoshop document/history；批次内逐文件保存，不伪造单一 revision。 */
    sourceHistoryStateRef?: PhotoshopHistoryStateRef;
    /** 与执行前 Skill typed DeliveryPlan 的角色、顺序和配对绑定；不包含视觉决定。 */
    planBinding?: Omit<SkillDeliveryPlanArtifact, 'path' | 'kind'>;
}

export interface RuntimeDeliveryReceipt {
    version: typeof RUNTIME_DELIVERY_RECEIPT_VERSION;
    status: 'ready' | 'incomplete';
    settlementScope: RuntimeDeliverySettlementScope;
    outputs: string[];
    resultRefs: string[];
    resultRefProofs: RuntimeDeliveryResultRefProof[];
    /** 生产者已逐文件读回的精确交付集合；不扫描目录，也不单独推进 E2。 */
    artifacts: RuntimeDeliveryArtifactEntry[];
    /** 可选的执行前 Skill exact artifact plan 摘要；只绑定组织计划，不包含视觉决定。 */
    deliveryPlanDigest?: string;
    /** 仅用于重算 plan digest 的严格交付组织契约；不得包含视觉决定。 */
    deliveryPlanConvention?: SkillDeliveryConvention;
    issues: string[];
    /** 实际保存/导出边界所读取的源 Photoshop 文档版本；不是普通观察信用。 */
    sourceHistoryStateRef?: PhotoshopHistoryStateRef;
    boundaries: {
        workflowDeclaredOnly: true;
        manifestBoundAtomicProofAllowed: true;
        settlementScopeDeclaredOnly: true;
        multiDocumentTaskVerifiedByRuntime: false;
        resultRefProofsProducerDeclaredOnly: true;
        exactArtifactSet: true;
        producerArtifactReadbackRequired: true;
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
    version: 'runtime-delivery-verification/v3';
    status: 'passed' | 'incomplete';
    settlementScope: RuntimeDeliverySettlementScope;
    requiredOutputs: string[];
    confirmedOutputs: string[];
    missingOutputs: string[];
    targetBound: boolean;
    reviewedPreviewBound: boolean;
    sourceHistoryStateBound: boolean;
    multiDocumentTaskBound: boolean;
    deliveryPlanBound: boolean;
    boundaries: {
        manifestRequirementsOnly: true;
        explicitReceiptRequired: true;
        sameTargetPreviewRequired: true;
        exactSourceHistoryRequired: true;
        multiDocumentTaskBindingRequired: true;
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

function normalizeResultRefProofs(value: unknown): RuntimeDeliveryResultRefProof[] {
    if (!Array.isArray(value)) return [];
    const proofs: RuntimeDeliveryResultRefProof[] = [];
    for (const candidate of value.slice(0, MAX_RUNTIME_DELIVERY_RESULT_REFS)) {
        if (!isRecord(candidate) || candidate.effect !== 'save_export') continue;
        const resultRef = uniqueIdentifiers([candidate.resultRef], 1)[0];
        if (!resultRef || proofs.some((proof) => proof.resultRef === resultRef)) continue;
        proofs.push({ resultRef, effect: 'save_export' });
    }
    return proofs;
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

function cleanArtifactPath(value: unknown): string {
    return String(value || '').replace(/[\r\n\0]/g, '').trim().slice(0, 2048);
}

function isDeliveryArtifactPathCompatible(
    path: string,
    kind: RuntimeDeliveryArtifactKind
): boolean {
    const normalized = path.replace(/\\/g, '/');
    const hasUriScheme = /^[a-z][a-z0-9+.-]*:/i.test(normalized)
        && !/^[a-z]:\//i.test(normalized);
    if (!normalized || hasUriScheme || normalized.split('/').includes('..')) return false;
    if (kind === 'editable_document') return /\.(?:psd|psb|tiff?)$/i.test(path);
    return /\.(?:jpe?g|png|webp)$/i.test(path);
}

function normalizeDeliveryArtifacts(value: unknown): {
    artifacts: RuntimeDeliveryArtifactEntry[];
    invalidCount: number;
    inputCount: number;
} {
    if (!Array.isArray(value)) return { artifacts: [], invalidCount: 0, inputCount: 0 };
    const artifacts: RuntimeDeliveryArtifactEntry[] = [];
    let invalidCount = 0;
    for (const candidate of value.slice(0, MAX_RUNTIME_DELIVERY_ARTIFACTS + 1)) {
        if (!isRecord(candidate)) {
            invalidCount += 1;
            continue;
        }
        const path = cleanArtifactPath(candidate.path);
        const kind = candidate.kind;
        const proof = candidate.proof;
        const fileIdentity = isRecord(candidate.fileIdentity)
            && /^[a-f0-9]{64}$/i.test(String(candidate.fileIdentity.sha256 || '').trim())
            && Number.isSafeInteger(Number(candidate.fileIdentity.byteLength))
            && Number(candidate.fileIdentity.byteLength) > 0
            ? {
                sha256: String(candidate.fileIdentity.sha256).trim().toLowerCase(),
                byteLength: Number(candidate.fileIdentity.byteLength)
            }
            : undefined;
        const sourceHistoryStateRef = readPhotoshopSourceHistoryStateRef({
            sourceHistoryStateRef: candidate.sourceHistoryStateRef
        });
        const malformedIdentity = candidate.fileIdentity !== undefined && !fileIdentity;
        const malformedSourceHistory = candidate.sourceHistoryStateRef !== undefined
            && !sourceHistoryStateRef;
        const planArtifact = candidate.planBinding === undefined
            ? undefined
            : normalizeSkillDeliveryPlanArtifact({
                ...candidate.planBinding as Record<string, unknown>,
                path,
                kind
            });
        const malformedPlanBinding = candidate.planBinding !== undefined && !planArtifact;
        if ((kind !== 'editable_document' && kind !== 'raster_export')
            || (proof !== 'editable_document_artifact'
                && proof !== 'file_probe'
                && proof !== 'staged_editable_document_promotion'
                && proof !== 'uxp_export_readback')
            || malformedIdentity
            || malformedSourceHistory
            || malformedPlanBinding
            || !isDeliveryArtifactPathCompatible(path, kind)) {
            invalidCount += 1;
            continue;
        }
        const normalizedPath = normalizeSkillDeliveryArtifactPath(path);
        if (!artifacts.some((artifact) => (
            artifact.kind === kind
            && normalizeSkillDeliveryArtifactPath(artifact.path) === normalizedPath
        ))) {
            artifacts.push({
                path,
                kind,
                proof,
                ...(fileIdentity ? { fileIdentity } : {}),
                ...(sourceHistoryStateRef ? { sourceHistoryStateRef } : {}),
                ...(planArtifact ? {
                    planBinding: {
                        artifactId: planArtifact.artifactId,
                        pairId: planArtifact.pairId,
                        order: planArtifact.order,
                        format: planArtifact.format,
                        sourceHistoryRole: planArtifact.sourceHistoryRole
                    }
                } : {})
            });
        }
    }
    return {
        artifacts: artifacts.slice(0, MAX_RUNTIME_DELIVERY_ARTIFACTS),
        invalidCount,
        inputCount: value.length
    };
}

function normalizeArtifactPath(value: unknown): string {
    return normalizeSkillDeliveryArtifactPath(readPath(value));
}

function normalizeEditableArtifactFormat(value: unknown): 'psd' | 'psb' | 'tiff' | undefined {
    const format = String(value || '').trim().toLowerCase();
    if (format === 'psd' || format === 'psb') return format;
    if (format === 'tif' || format === 'tiff') return 'tiff';
    return undefined;
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
    const recordFormat = normalizeEditableArtifactFormat(record.format);
    const artifactFormat = normalizeEditableArtifactFormat(artifact.format);
    const savedPath = normalizeArtifactPath(record.savedPath)
        || normalizeArtifactPath(record.filePath);
    const artifactPath = normalizeArtifactPath(artifact.path);
    const byteLength = readPositiveSafeInteger(artifact.byteLength);
    const modifiedAt = readPositiveFiniteNumber(artifact.modifiedAt);
    const documentId = readPositiveSafeInteger(artifact.documentId);
    const width = readPositiveFiniteNumber(artifact.canvas.width);
    const height = readPositiveFiniteNumber(artifact.canvas.height);
    const expectedExtensions = recordFormat === 'tiff' ? ['.tif', '.tiff'] : [`.${recordFormat}`];
    return Boolean(sourceHistoryStateRef
        && recordFormat
        && artifactFormat === recordFormat
        && savedPath
        && artifactPath === savedPath
        && expectedExtensions.some((extension) => savedPath.endsWith(extension))
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
    settlementScope?: RuntimeDeliverySettlementScope;
    outputs: readonly string[];
    resultRefs: readonly string[];
    resultRefProofs?: readonly RuntimeDeliveryResultRefProof[];
    artifacts?: readonly RuntimeDeliveryArtifactEntry[];
    expectedDeliveryPlan?: {
        digest: string;
        convention: SkillDeliveryConvention;
        artifacts?: readonly SkillDeliveryPlanArtifact[];
    };
    issues?: readonly string[];
    sourceHistoryStateRef?: PhotoshopHistoryStateRef;
}): RuntimeDeliveryReceipt {
    const outputs = uniqueIdentifiers(input.outputs);
    const resultRefs = uniqueIdentifiers(input.resultRefs, MAX_RUNTIME_DELIVERY_RESULT_REFS);
    const resultRefProofs = normalizeResultRefProofs(input.resultRefProofs || []);
    const issues = uniqueText(input.issues || []);
    const artifactSet = normalizeDeliveryArtifacts(input.artifacts || []);
    const expectedPlanDigest = input.expectedDeliveryPlan?.digest;
    const conventionResolution = input.expectedDeliveryPlan
        ? resolveRuntimeSkillDeliveryConvention(input.expectedDeliveryPlan.convention)
        : { status: 'not_provided' as const, blockers: [] as string[] };
    const deliveryPlanConvention = conventionResolution.status === 'ready'
        ? conventionResolution.convention
        : undefined;
    const receiptPlanArtifacts = artifactSet.artifacts.flatMap((artifact) => (
        artifact.planBinding
            ? [{
                ...artifact.planBinding,
                path: artifact.path,
                kind: artifact.kind
            }]
            : []
    ));
    const expectedPlanArtifacts = input.expectedDeliveryPlan?.artifacts;
    const expectedTypedPlanDigest = deliveryPlanConvention && expectedPlanArtifacts
        ? buildSkillDeliveryPlanDigest({
            convention: deliveryPlanConvention,
            artifacts: expectedPlanArtifacts
        })
        : undefined;
    const receiptTypedPlanDigest = deliveryPlanConvention
        && receiptPlanArtifacts.length === artifactSet.artifacts.length
        ? buildSkillDeliveryPlanDigest({
            convention: deliveryPlanConvention,
            artifacts: receiptPlanArtifacts
        })
        : undefined;
    const legacyPlanDigest = deliveryPlanConvention
        ? buildSkillDeliveryPlanDigest({
            convention: deliveryPlanConvention,
            artifactPaths: artifactSet.artifacts.map((artifact) => artifact.path)
        })
        : undefined;
    const recomputedDeliveryPlanDigest = isCurrentSkillDeliveryPlanDigest(expectedPlanDigest)
        ? (expectedTypedPlanDigest === receiptTypedPlanDigest ? expectedTypedPlanDigest : undefined)
        : legacyPlanDigest;
    const deliveryPlanDigest = isSkillDeliveryPlanDigest(expectedPlanDigest)
        && expectedPlanDigest === recomputedDeliveryPlanDigest
        ? expectedPlanDigest
        : undefined;
    if (input.expectedDeliveryPlan && !deliveryPlanDigest) {
        issues.push(
            conventionResolution.blockers[0]
            || 'Skill 交付计划摘要与规范化最终 artifact 集合不一致。'
        );
    }
    if (artifactSet.invalidCount > 0 || artifactSet.inputCount > MAX_RUNTIME_DELIVERY_ARTIFACTS) {
        issues.push(`存在 ${artifactSet.invalidCount + Math.max(0, artifactSet.inputCount - MAX_RUNTIME_DELIVERY_ARTIFACTS)} 个无效最终文件声明。`);
    }
    if (artifactSet.artifacts.length !== artifactSet.inputCount
        && artifactSet.invalidCount === 0
        && artifactSet.inputCount <= MAX_RUNTIME_DELIVERY_ARTIFACTS) {
        issues.push('最终文件声明存在重复项。');
    }
    const settlementScope = input.settlementScope || 'single_document_revision';
    const sourceHistoryStateRef = readPhotoshopSourceHistoryStateRef({
        sourceHistoryStateRef: input.sourceHistoryStateRef
    });
    const multiDocumentProofsComplete = settlementScope === 'multi_document_task'
        && resultRefProofs.length === resultRefs.length
        && resultRefs.every((resultRef) => (
            resultRefProofs.some((proof) => proof.resultRef === resultRef)
        ));
    const multiDocumentArtifactIdentitiesComplete = settlementScope === 'multi_document_task'
        && artifactSet.artifacts.length > 0
        && artifactSet.artifacts.every((artifact) => (
            Boolean(artifact.fileIdentity)
            && Boolean(artifact.sourceHistoryStateRef)
        ));
    if (settlementScope === 'single_document_revision' && !sourceHistoryStateRef) {
        issues.push('单文档交付收据缺少源 Photoshop revision。');
    }
    if (settlementScope === 'multi_document_task' && input.sourceHistoryStateRef !== undefined) {
        issues.push('多文档交付收据不能伪装成单一 Photoshop revision。');
    }
    if (settlementScope === 'multi_document_task' && !multiDocumentProofsComplete) {
        issues.push('多文档交付收据的 save/export resultRef 证明不完整。');
    }
    if (settlementScope === 'multi_document_task' && !multiDocumentArtifactIdentitiesComplete) {
        issues.push('多文档交付收据缺少逐文件 SHA-256、字节数或 Photoshop document/history 身份。');
    }
    const ready = input.status === 'ready'
        && outputs.length > 0
        && resultRefs.length > 0
        && (settlementScope !== 'multi_document_task' || artifactSet.artifacts.length > 0)
        && (settlementScope === 'single_document_revision'
            ? Boolean(sourceHistoryStateRef)
            : multiDocumentProofsComplete && multiDocumentArtifactIdentitiesComplete)
        && issues.length === 0;
    return {
        version: RUNTIME_DELIVERY_RECEIPT_VERSION,
        status: ready ? 'ready' : 'incomplete',
        settlementScope,
        outputs,
        resultRefs,
        resultRefProofs,
        artifacts: artifactSet.artifacts,
        ...(deliveryPlanDigest ? { deliveryPlanDigest } : {}),
        ...(deliveryPlanConvention && deliveryPlanDigest ? { deliveryPlanConvention } : {}),
        issues,
        ...(sourceHistoryStateRef ? { sourceHistoryStateRef } : {}),
        boundaries: {
            workflowDeclaredOnly: true,
            manifestBoundAtomicProofAllowed: true,
            settlementScopeDeclaredOnly: true,
            multiDocumentTaskVerifiedByRuntime: false,
            resultRefProofsProducerDeclaredOnly: true,
            exactArtifactSet: true,
            producerArtifactReadbackRequired: true,
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

function hasNamedHistoryStateRefValue(
    value: unknown,
    field: 'sourceHistoryStateRef' | 'historyStateRef'
): boolean {
    if (!isRecord(value)) return false;
    return value[field] !== undefined
        || (isRecord(value.data) && value.data[field] !== undefined);
}

function readNamedHistoryStateRef(
    value: unknown,
    field: 'sourceHistoryStateRef' | 'historyStateRef'
): PhotoshopHistoryStateRef | undefined {
    if (field === 'sourceHistoryStateRef') return readPhotoshopSourceHistoryStateRef(value);
    if (!isRecord(value)) return undefined;
    return readPhotoshopSourceHistoryStateRef({
        sourceHistoryStateRef: value.historyStateRef
            || (isRecord(value.data) ? value.data.historyStateRef : undefined)
    });
}

/**
 * 从生产者自己的有序执行结果中读取最后稳定文件版本；不扫描业务对象或目录。
 */
export function findRuntimeDeliverySourceHistoryStateRef(
    orderedToolResults: readonly unknown[],
    finalAcceptanceResult?: unknown
): PhotoshopHistoryStateRef | undefined {
    const results = Array.isArray(orderedToolResults) ? orderedToolResults : [];
    const finalAcceptanceRevision = readNamedHistoryStateRef(
        finalAcceptanceResult,
        'historyStateRef'
    );
    const declaredSourceRevisions = results
        .map((value) => readNamedHistoryStateRef(value, 'sourceHistoryStateRef'))
        .filter((value): value is PhotoshopHistoryStateRef => Boolean(value));
    const declaredSourceValueCount = results.filter((value) => (
        hasNamedHistoryStateRefValue(value, 'sourceHistoryStateRef')
    )).length;
    if (declaredSourceRevisions.length !== declaredSourceValueCount) return undefined;
    if (declaredSourceRevisions.length === 0) return finalAcceptanceRevision;
    const first = declaredSourceRevisions[0];
    const commonSourceRevision = declaredSourceRevisions.every((revision) => (
        samePhotoshopHistoryStateRef(first, revision)
    ))
        ? first
        : undefined;
    if (!commonSourceRevision
        || (finalAcceptanceRevision
            && !samePhotoshopHistoryStateRef(finalAcceptanceRevision, commonSourceRevision))) {
        return undefined;
    }
    return finalAcceptanceRevision || commonSourceRevision;
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
        settlementScope: 'single_document_revision',
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
            && candidate.version !== LEGACY_RUNTIME_DELIVERY_RECEIPT_V1
            && candidate.version !== LEGACY_RUNTIME_DELIVERY_RECEIPT_V0)
        || (candidate.status !== 'ready' && candidate.status !== 'incomplete')
        || !Array.isArray(candidate.outputs)
        || !Array.isArray(candidate.resultRefs)
        || !Array.isArray(candidate.issues)) {
        return undefined;
    }
    const isCurrent = candidate.version === RUNTIME_DELIVERY_RECEIPT_VERSION;
    if (isCurrent
        && ((candidate.settlementScope !== 'single_document_revision'
            && candidate.settlementScope !== 'multi_document_task')
            || !Array.isArray(candidate.resultRefProofs)
            || !Array.isArray(candidate.artifacts)
            || !isRecord(candidate.boundaries)
            || candidate.boundaries.workflowDeclaredOnly !== true
            || candidate.boundaries.manifestBoundAtomicProofAllowed !== true
            || candidate.boundaries.settlementScopeDeclaredOnly !== true
            || candidate.boundaries.multiDocumentTaskVerifiedByRuntime !== false
            || candidate.boundaries.resultRefProofsProducerDeclaredOnly !== true
            || candidate.boundaries.exactArtifactSet !== true
            || candidate.boundaries.producerArtifactReadbackRequired !== true
            || candidate.boundaries.targetVerifiedByRuntime !== false
            || candidate.boundaries.previewVerifiedByRuntime !== false
            || candidate.boundaries.sourceHistoryDeclaredOnly !== true
            || candidate.boundaries.sourceHistoryVerifiedByRuntime !== false
            || candidate.boundaries.grantsPermission !== false
            || candidate.boundaries.changesQualityVerdict !== false
            || candidate.boundaries.completesDeliveryByItself !== false)) {
        return undefined;
    }
    if (candidate.sourceHistoryStateRef !== undefined
        && !readPhotoshopSourceHistoryStateRef(candidate)) {
        return undefined;
    }
    const hasDeliveryPlanDigest = candidate.deliveryPlanDigest !== undefined;
    const hasDeliveryPlanConvention = candidate.deliveryPlanConvention !== undefined;
    if (hasDeliveryPlanDigest !== hasDeliveryPlanConvention
        || (hasDeliveryPlanDigest && !isSkillDeliveryPlanDigest(candidate.deliveryPlanDigest))) {
        return undefined;
    }
    return buildRuntimeDeliveryReceipt({
        // v0 没有源 Host 版本，只能作为 legacy/incomplete 读取，绝不能推进 E2；
        // v1 是旧单文档协议，继续按严格 source revision 读取。
        status: candidate.version === LEGACY_RUNTIME_DELIVERY_RECEIPT_V0
            ? 'incomplete'
            : candidate.status,
        settlementScope: isCurrent
            ? candidate.settlementScope as RuntimeDeliverySettlementScope
            : 'single_document_revision',
        outputs: candidate.outputs,
        resultRefs: candidate.resultRefs,
        resultRefProofs: isCurrent
            ? candidate.resultRefProofs as RuntimeDeliveryResultRefProof[]
            : [],
        artifacts: isCurrent
            ? candidate.artifacts as RuntimeDeliveryArtifactEntry[]
            : [],
        expectedDeliveryPlan: isCurrent
            && typeof candidate.deliveryPlanDigest === 'string'
            && candidate.deliveryPlanConvention !== undefined
            ? {
                digest: candidate.deliveryPlanDigest,
                convention: candidate.deliveryPlanConvention as SkillDeliveryConvention,
                ...(isCurrentSkillDeliveryPlanDigest(candidate.deliveryPlanDigest)
                    ? {
                        artifacts: (candidate.artifacts as RuntimeDeliveryArtifactEntry[]).flatMap((artifact) => (
                            artifact.planBinding
                                ? [{
                                    ...artifact.planBinding,
                                    path: artifact.path,
                                    kind: artifact.kind
                                }]
                                : []
                        ))
                    }
                    : {})
            }
            : undefined,
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
    multiDocumentTaskBound?: boolean;
    expectedDeliveryPlanDigest?: string;
    deliveryPlanBindingRequired?: boolean;
}): RuntimeDeliveryVerification {
    const requiredOutputs = uniqueIdentifiers(input.requiredOutputs);
    const settlementScope = input.receipt?.settlementScope || 'single_document_revision';
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
    const multiDocumentTaskBound = settlementScope === 'multi_document_task'
        && input.multiDocumentTaskBound === true;
    const settlementBound = settlementScope === 'multi_document_task'
        ? multiDocumentTaskBound
        : targetBound && sourceHistoryStateBound;
    const receiptDeliveryPlanDigest = input.receipt?.deliveryPlanDigest;
    const strictTypedDeliveryPlanRequired = input.deliveryPlanBindingRequired === true;
    const deliveryPlanBindingRequired = strictTypedDeliveryPlanRequired
        || receiptDeliveryPlanDigest !== undefined
        || input.expectedDeliveryPlanDigest !== undefined;
    const deliveryPlanBound = !deliveryPlanBindingRequired
        || ((strictTypedDeliveryPlanRequired
            ? isCurrentSkillDeliveryPlanDigest(input.expectedDeliveryPlanDigest)
            : isSkillDeliveryPlanDigest(input.expectedDeliveryPlanDigest))
            && receiptDeliveryPlanDigest === input.expectedDeliveryPlanDigest);
    const confirmedOutputs = input.receipt?.status === 'ready'
        && settlementBound
        && deliveryPlanBound
        ? uniqueIdentifiers([
            ...input.receipt.outputs,
            'delivery_record',
            'preview'
        ])
        : [];
    const missingOutputs = requiredOutputs.filter((output) => !confirmedOutputs.includes(output));
    return {
        version: 'runtime-delivery-verification/v3',
        status: input.receipt?.status === 'ready'
            && settlementBound
            && deliveryPlanBound
            && requiredOutputs.length > 0
            && missingOutputs.length === 0
            ? 'passed'
            : 'incomplete',
        settlementScope,
        requiredOutputs,
        confirmedOutputs,
        missingOutputs,
        targetBound,
        reviewedPreviewBound,
        sourceHistoryStateBound,
        multiDocumentTaskBound,
        deliveryPlanBound,
        boundaries: {
            manifestRequirementsOnly: true,
            explicitReceiptRequired: true,
            sameTargetPreviewRequired: true,
            exactSourceHistoryRequired: true,
            multiDocumentTaskBindingRequired: true,
            qualityVerdictAuthority: false,
            grantsPermission: false,
            executesTools: false
        }
    };
}
