import type { RuntimeReferenceSourceKind } from '../../../shared/agent-runtime-v5/contracts';
import { sha256Hex } from '../../../shared/agent-runtime-v5/content-hash';
import { normalizeAssetPathKey } from '../../../shared/design-run-tool-log-facts';
import {
    samePhotoshopHistoryStateRef,
    type PhotoshopHistoryStateRef
} from '../../../shared/photoshop-history-state-ref';

export const TRUSTED_FINAL_COMPARISON_EVIDENCE_VERSION = 'trusted-final-comparison-evidence/v0' as const;
export const MAX_TRUSTED_FINAL_COMPARISON_REFERENCE_IMAGES = 3;
export const MAX_TRUSTED_FINAL_COMPARISON_SELECTED_SOURCES = 3;
export const MAX_TRUSTED_FINAL_COMPARISON_CANDIDATE_SOURCES = 80;
export const MAX_TRUSTED_FINAL_COMPARISON_IMAGE_CHARS = 4_000_000;

const MAX_EVIDENCE_ID_CHARS = 180;
const MAX_TASK_RUN_ID_CHARS = 240;
const MAX_SOURCE_ID_CHARS = 4096;
const MAX_REFERENCE_CONTEXT_CHARS = 9_000;
const LOCAL_PATH_PATTERN = /(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/]|\/(?:Users|home|tmp|var|private)\/)/u;
const URL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//iu;

export type TrustedFinalComparisonEvidenceReason =
    | 'artifact_missing'
    | 'comparison_evidence_missing'
    | 'task_run_mismatch'
    | 'parent_history_mismatch'
    | 'current_document_mismatch'
    | 'current_history_missing'
    | 'candidate_not_compared_by_parent'
    | 'candidate_selected_source_mismatch'
    | 'reference_not_compared_by_parent';

export interface TrustedFinalComparisonImageInput {
    evidenceId: string;
    sourceKind: 'candidate_set' | RuntimeReferenceSourceKind;
    sourceId: string;
    /** 参考图必须同时携带 Runtime visual observation identity 的 sourceId。 */
    observationSourceId?: string;
    image: {
        data: string;
        mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
    };
}

export interface TrustedFinalComparisonImage {
    evidenceId: string;
    sourceKind: TrustedFinalComparisonImageInput['sourceKind'];
    /** 源身份的 SHA-256；不保存 Eagle id、URL 或项目文件路径原文。 */
    sourceIdentityDigest: string;
    image: TrustedFinalComparisonImageInput['image'];
    pixelSha256: string;
}

export interface TrustedFinalComparisonEvidenceInput {
    taskRunId: string;
    parentHistoryStateRef: PhotoshopHistoryStateRef;
    /** 只能在父代 Judge 已实际返回后写入；repair 重放不创建第二份证据。 */
    judgeStatus: 'completed' | 'stale';
    evidenceScope: {
        declaredReferenceCompared: boolean;
        candidateSetCompared: boolean;
    };
    candidateSet?: {
        selectedSourcePaths: readonly string[];
        /** 父代实际送入 Judge 的 Axx / slot → 文件映射；保存时只保留路径摘要。 */
        sourceManifest: ReadonlyArray<{ slotId: string; path: string }>;
        image: TrustedFinalComparisonImageInput;
    };
    declaredReferences?: readonly TrustedFinalComparisonImageInput[];
    /** 已校验 Reference Brief 的有界观察/迁移语义；不得包含 source id、路径或像素。 */
    referenceContext?: string;
}

export interface TrustedFinalComparisonEvidence {
    version: typeof TRUSTED_FINAL_COMPARISON_EVIDENCE_VERSION;
    taskRunId: string;
    parentHistoryStateRef: PhotoshopHistoryStateRef;
    judgeStatus: TrustedFinalComparisonEvidenceInput['judgeStatus'];
    /** history、scope、像素摘要、source binding 的整体摘要；不是 Provider usage 收据。 */
    parentJudgeInputDigest: string;
    evidenceScope: {
        declaredReferenceCompared: boolean;
        candidateSetCompared: boolean;
    };
    candidateSet?: {
        /** normalizeAssetPathKey 后再哈希、排序的精确集合，不保留明文路径。 */
        selectedSourcePathDigests: readonly string[];
        sourceManifest: ReadonlyArray<{ slotId: string; pathDigest: string }>;
        sourceManifestDigest: string;
        selectedSourceBindingDigest: string;
        image: TrustedFinalComparisonImage;
    };
    declaredReferences?: readonly TrustedFinalComparisonImage[];
    referenceContext?: string;
    boundaries: {
        parentJudgeInputOnly: true;
        noToolLog: true;
        noPermission: true;
        noWinnerSelection: true;
        budgetOwnedByCaller: true;
        requiresPostJudgeWrite: true;
    };
}

export interface TrustedFinalComparisonReplayInput {
    taskRunId: string;
    expectedParentHistoryStateRef: PhotoshopHistoryStateRef;
    currentHistoryStateRef: PhotoshopHistoryStateRef;
    currentSelectedSourcePaths?: readonly string[];
}

export interface TrustedFinalComparisonReplayProjection {
    evidenceScope: {
        declaredReferenceCompared: boolean;
        candidateSetCompared: boolean;
    };
    candidateSet?: TrustedFinalComparisonImage;
    declaredReferences?: TrustedFinalComparisonImage[];
    referenceContext?: string;
    reasonCodes: TrustedFinalComparisonEvidenceReason[];
    /** 本函数不裁剪；调用方以此完整数量决定自己的视觉预算。 */
    requiredImageCount: number;
}

function normalizeIdentifier(value: unknown, maxLength: number): string {
    const text = String(value || '').trim();
    if (!text
        || text.length > maxLength
        || !/^[A-Za-z0-9_.:-]+$/u.test(text)
        || LOCAL_PATH_PATTERN.test(text)
        || /^data:/iu.test(text)) {
        return '';
    }
    return text;
}

function normalizeReferenceContext(value: unknown): string {
    const text = String(value || '').replace(/\s+/gu, ' ').trim();
    if (!text
        || text.length > MAX_REFERENCE_CONTEXT_CHARS
        || LOCAL_PATH_PATTERN.test(text)
        || /data:image\//iu.test(text)) return '';
    return text;
}

function normalizeImageData(value: unknown): string {
    const data = String(value || '')
        .replace(/^data:image\/(?:png|jpeg|webp);base64,/iu, '')
        .replace(/\s+/gu, '');
    if (data.length < 128
        || data.length > MAX_TRUSTED_FINAL_COMPARISON_IMAGE_CHARS
        || !/^[A-Za-z0-9+/]+={0,2}$/u.test(data)) return '';
    return data;
}

function normalizeSourceIdentity(
    sourceKind: TrustedFinalComparisonImageInput['sourceKind'],
    value: unknown
): string {
    const sourceId = String(value || '').trim();
    if (!sourceId || sourceId.length > MAX_SOURCE_ID_CHARS || /^data:/iu.test(sourceId)) return '';
    if (sourceKind === 'candidate_set') return normalizeIdentifier(sourceId, MAX_EVIDENCE_ID_CHARS);
    if (sourceKind === 'eagle') return sourceId.replace(/^eagle:/iu, '');
    if (sourceKind === 'web') return URL_PATTERN.test(sourceId) ? sourceId : '';
    const pathKey = normalizeAssetPathKey(sourceId);
    return pathKey && !URL_PATTERN.test(pathKey) ? pathKey : '';
}

function buildSourceIdentityDigest(
    sourceKind: TrustedFinalComparisonImageInput['sourceKind'],
    sourceId: unknown
): string {
    const identity = normalizeSourceIdentity(sourceKind, sourceId);
    return identity ? sha256Hex(`${sourceKind}:${identity}`) : '';
}

function buildTrustedImage(
    input: TrustedFinalComparisonImageInput,
    expectedKind?: TrustedFinalComparisonImageInput['sourceKind']
): TrustedFinalComparisonImage | undefined {
    const evidenceId = normalizeIdentifier(input?.evidenceId, MAX_EVIDENCE_ID_CHARS);
    const sourceKind = input?.sourceKind;
    const mediaType = input?.image?.mediaType;
    const data = normalizeImageData(input?.image?.data);
    const sourceIdentityDigest = buildSourceIdentityDigest(sourceKind, input?.sourceId);
    const observationSourceIdentityDigest = sourceKind === 'candidate_set'
        ? sourceIdentityDigest
        : buildSourceIdentityDigest(sourceKind, input?.observationSourceId);
    if (!evidenceId
        || !sourceIdentityDigest
        || observationSourceIdentityDigest !== sourceIdentityDigest
        || (expectedKind && sourceKind !== expectedKind)
        || !['candidate_set', 'user_reference', 'brand_template', 'project_case', 'eagle', 'web']
            .includes(sourceKind)
        || !['image/jpeg', 'image/png', 'image/webp'].includes(mediaType)
        || !data) return undefined;
    return {
        evidenceId,
        sourceKind,
        sourceIdentityDigest,
        image: { data, mediaType },
        pixelSha256: sha256Hex(data)
    };
}

function cloneTrustedImage(value: TrustedFinalComparisonImage): TrustedFinalComparisonImage | undefined {
    const data = normalizeImageData(value?.image?.data);
    const evidenceId = normalizeIdentifier(value?.evidenceId, MAX_EVIDENCE_ID_CHARS);
    const sourceIdentityDigest = String(value?.sourceIdentityDigest || '').trim().toLowerCase();
    const pixelSha256 = String(value?.pixelSha256 || '').trim().toLowerCase();
    if (!evidenceId
        || !['candidate_set', 'user_reference', 'brand_template', 'project_case', 'eagle', 'web']
            .includes(value?.sourceKind)
        || !['image/jpeg', 'image/png', 'image/webp'].includes(value?.image?.mediaType)
        || !data
        || !/^[a-f0-9]{64}$/u.test(sourceIdentityDigest)
        || !/^[a-f0-9]{64}$/u.test(pixelSha256)
        || sha256Hex(data) !== pixelSha256) return undefined;
    return {
        evidenceId,
        sourceKind: value.sourceKind,
        sourceIdentityDigest,
        image: { data, mediaType: value.image.mediaType },
        pixelSha256
    };
}

function buildSelectedSourcePathDigests(paths: readonly string[] | undefined): string[] {
    if (!Array.isArray(paths)
        || paths.length === 0
        || paths.length > MAX_TRUSTED_FINAL_COMPARISON_SELECTED_SOURCES) return [];
    const normalized = paths.map((path) => {
        const raw = String(path || '').trim();
        if (!raw
            || raw.length > MAX_SOURCE_ID_CHARS
            || /^data:/iu.test(raw)
            || URL_PATTERN.test(raw)) return '';
        return normalizeAssetPathKey(raw);
    });
    if (normalized.some((path) => !path)
        || new Set(normalized).size !== normalized.length) return [];
    return normalized.map((path) => sha256Hex(path)).sort();
}

function buildCandidateSourceManifest(
    value: ReadonlyArray<{ slotId: string; path: string }> | undefined
): {
    entries: Array<{ slotId: string; pathDigest: string }>;
    digest: string;
} | undefined {
    if (!Array.isArray(value)
        || value.length < 2
        || value.length > MAX_TRUSTED_FINAL_COMPARISON_CANDIDATE_SOURCES) return undefined;
    const entries = value.map((item) => {
        const slotId = String(item?.slotId || '').trim();
        const rawPath = String(item?.path || '').trim();
        const pathKey = rawPath
            && rawPath.length <= MAX_SOURCE_ID_CHARS
            && !/^data:/iu.test(rawPath)
            && !URL_PATTERN.test(rawPath)
            ? normalizeAssetPathKey(rawPath)
            : '';
        if (!/^[A-Za-z0-9_.:-]{1,48}$/u.test(slotId) || !pathKey) return undefined;
        return { slotId, pathDigest: sha256Hex(pathKey) };
    });
    if (entries.some((item) => !item)) return undefined;
    const projected = entries as Array<{ slotId: string; pathDigest: string }>;
    if (new Set(projected.map((item) => item.slotId)).size !== projected.length
        || new Set(projected.map((item) => item.pathDigest)).size !== projected.length) {
        return undefined;
    }
    const sorted = [...projected].sort((left, right) => left.slotId.localeCompare(right.slotId));
    return {
        entries: sorted,
        digest: sha256Hex(JSON.stringify(sorted))
    };
}

function cloneCandidateSourceManifest(
    value: ReadonlyArray<{ slotId: string; pathDigest: string }> | undefined,
    expectedDigest: unknown
): {
    entries: Array<{ slotId: string; pathDigest: string }>;
    digest: string;
} | undefined {
    if (!Array.isArray(value)
        || value.length < 2
        || value.length > MAX_TRUSTED_FINAL_COMPARISON_CANDIDATE_SOURCES) return undefined;
    const entries = value.map((item) => ({
        slotId: String(item?.slotId || '').trim(),
        pathDigest: String(item?.pathDigest || '').trim().toLowerCase()
    }));
    if (entries.some((item) => (
        !/^[A-Za-z0-9_.:-]{1,48}$/u.test(item.slotId)
        || !/^[a-f0-9]{64}$/u.test(item.pathDigest)
    ))
        || new Set(entries.map((item) => item.slotId)).size !== entries.length
        || new Set(entries.map((item) => item.pathDigest)).size !== entries.length) {
        return undefined;
    }
    const sorted = [...entries].sort((left, right) => left.slotId.localeCompare(right.slotId));
    const digest = sha256Hex(JSON.stringify(sorted));
    if (digest !== String(expectedDigest || '').trim().toLowerCase()) return undefined;
    return { entries: sorted, digest };
}

function buildSelectedSourceBindingDigest(input: {
    image: TrustedFinalComparisonImage;
    selectedSourcePathDigests: readonly string[];
    sourceManifestDigest: string;
}): string {
    return sha256Hex(JSON.stringify({
        evidenceId: input.image.evidenceId,
        sourceKind: input.image.sourceKind,
        mediaType: input.image.image.mediaType,
        pixelSha256: input.image.pixelSha256,
        sourceIdentityDigest: input.image.sourceIdentityDigest,
        selectedSourcePathDigests: [...input.selectedSourcePathDigests].sort(),
        sourceManifestDigest: input.sourceManifestDigest
    }));
}

function buildParentJudgeInputDigest(input: {
    taskRunId: string;
    parentHistoryStateRef: PhotoshopHistoryStateRef;
    judgeStatus: TrustedFinalComparisonEvidenceInput['judgeStatus'];
    declaredReferenceCompared: boolean;
    candidateSetCompared: boolean;
    candidateSet?: TrustedFinalComparisonEvidence['candidateSet'];
    declaredReferences?: readonly TrustedFinalComparisonImage[];
    referenceContext?: string;
}): string {
    return sha256Hex(JSON.stringify({
        taskRunId: input.taskRunId,
        parentHistoryStateRef: input.parentHistoryStateRef,
        judgeStatus: input.judgeStatus,
        evidenceScope: {
            declaredReferenceCompared: input.declaredReferenceCompared,
            candidateSetCompared: input.candidateSetCompared
        },
        candidateSet: input.candidateSet ? {
            evidenceId: input.candidateSet.image.evidenceId,
            sourceKind: input.candidateSet.image.sourceKind,
            mediaType: input.candidateSet.image.image.mediaType,
            pixelSha256: input.candidateSet.image.pixelSha256,
            selectedSourceBindingDigest: input.candidateSet.selectedSourceBindingDigest
        } : undefined,
        declaredReferences: input.declaredReferences?.map((item) => ({
            evidenceId: item.evidenceId,
            sourceKind: item.sourceKind,
            sourceIdentityDigest: item.sourceIdentityDigest,
            mediaType: item.image.mediaType,
            pixelSha256: item.pixelSha256
        })),
        referenceContextSha256: input.referenceContext
            ? sha256Hex(input.referenceContext)
            : undefined
    }));
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
    if (left.length !== right.length) return false;
    const rightSet = new Set(right);
    return left.every((item) => rightSet.has(item));
}

function cloneHistoryStateRef(value: PhotoshopHistoryStateRef): PhotoshopHistoryStateRef | undefined {
    const documentId = Number(value?.documentId);
    const historyStateId = Number(value?.historyStateId);
    if (!Number.isSafeInteger(documentId)
        || documentId <= 0
        || !Number.isSafeInteger(historyStateId)
        || historyStateId <= 0) return undefined;
    return { documentId, historyStateId };
}

function buildBoundaries(): TrustedFinalComparisonEvidence['boundaries'] {
    return {
        parentJudgeInputOnly: true,
        noToolLog: true,
        noPermission: true,
        noWinnerSelection: true,
        budgetOwnedByCaller: true,
        requiresPostJudgeWrite: true
    };
}

export function buildTrustedFinalComparisonEvidence(input: {
    value: TrustedFinalComparisonEvidenceInput;
    artifactHistoryStateRef: PhotoshopHistoryStateRef;
}): TrustedFinalComparisonEvidence | undefined {
    const taskRunId = normalizeIdentifier(input.value?.taskRunId, MAX_TASK_RUN_ID_CHARS);
    const parentHistoryStateRef = cloneHistoryStateRef(input.value?.parentHistoryStateRef);
    const judgeStatus = input.value?.judgeStatus;
    if (!taskRunId
        || !parentHistoryStateRef
        || !['completed', 'stale'].includes(judgeStatus)
        || !samePhotoshopHistoryStateRef(parentHistoryStateRef, input.artifactHistoryStateRef)) {
        return undefined;
    }
    const declaredReferenceCompared = input.value?.evidenceScope?.declaredReferenceCompared === true;
    const candidateSetCompared = input.value?.evidenceScope?.candidateSetCompared === true;
    if (!declaredReferenceCompared && !candidateSetCompared) return undefined;

    let candidateSet: TrustedFinalComparisonEvidence['candidateSet'];
    if (candidateSetCompared) {
        const selectedSourcePathDigests = buildSelectedSourcePathDigests(
            input.value.candidateSet?.selectedSourcePaths
        );
        const sourceManifest = buildCandidateSourceManifest(
            input.value.candidateSet?.sourceManifest
        );
        const image = input.value.candidateSet?.image
            ? buildTrustedImage(input.value.candidateSet.image, 'candidate_set')
            : undefined;
        if (!image
            || !sourceManifest
            || selectedSourcePathDigests.length === 0
            || selectedSourcePathDigests.some((digest) => (
                !sourceManifest.entries.some((item) => item.pathDigest === digest)
            ))) return undefined;
        candidateSet = {
            selectedSourcePathDigests,
            sourceManifest: sourceManifest.entries,
            sourceManifestDigest: sourceManifest.digest,
            selectedSourceBindingDigest: buildSelectedSourceBindingDigest({
                image,
                selectedSourcePathDigests,
                sourceManifestDigest: sourceManifest.digest
            }),
            image
        };
    } else if (input.value.candidateSet) {
        return undefined;
    }

    let declaredReferences: TrustedFinalComparisonImage[] | undefined;
    let referenceContext: string | undefined;
    if (declaredReferenceCompared) {
        const rawReferences = input.value.declaredReferences;
        if (!Array.isArray(rawReferences)
            || rawReferences.length === 0
            || rawReferences.length > MAX_TRUSTED_FINAL_COMPARISON_REFERENCE_IMAGES) {
            return undefined;
        }
        const references = rawReferences.map((item) => buildTrustedImage(item));
        if (references.some((item) => !item)
            || references.some((item) => item?.sourceKind === 'candidate_set')) return undefined;
        declaredReferences = references as TrustedFinalComparisonImage[];
        const evidenceIds = new Set(declaredReferences.map((item) => item.evidenceId));
        const sourceDigests = new Set(declaredReferences.map((item) => item.sourceIdentityDigest));
        if (evidenceIds.size !== declaredReferences.length
            || sourceDigests.size !== declaredReferences.length) return undefined;
        referenceContext = normalizeReferenceContext(input.value.referenceContext);
        if (!referenceContext) return undefined;
    } else if (Array.isArray(input.value.declaredReferences)
        && input.value.declaredReferences.length > 0) {
        return undefined;
    } else if (input.value.referenceContext) {
        return undefined;
    }

    const parentJudgeInputDigest = buildParentJudgeInputDigest({
        taskRunId,
        parentHistoryStateRef,
        judgeStatus,
        declaredReferenceCompared,
        candidateSetCompared,
        candidateSet,
        declaredReferences,
        referenceContext
    });
    return {
        version: TRUSTED_FINAL_COMPARISON_EVIDENCE_VERSION,
        taskRunId,
        parentHistoryStateRef,
        judgeStatus,
        parentJudgeInputDigest,
        evidenceScope: { declaredReferenceCompared, candidateSetCompared },
        ...(candidateSet ? { candidateSet } : {}),
        ...(declaredReferences ? { declaredReferences } : {}),
        ...(referenceContext ? { referenceContext } : {}),
        boundaries: buildBoundaries()
    };
}

export function cloneTrustedFinalComparisonEvidence(input: {
    value: TrustedFinalComparisonEvidence;
    artifactHistoryStateRef: PhotoshopHistoryStateRef;
}): TrustedFinalComparisonEvidence | undefined {
    const value = input.value;
    const taskRunId = normalizeIdentifier(value?.taskRunId, MAX_TASK_RUN_ID_CHARS);
    const parentHistoryStateRef = cloneHistoryStateRef(value?.parentHistoryStateRef);
    const judgeStatus = value?.judgeStatus;
    const parentJudgeInputDigest = String(value?.parentJudgeInputDigest || '').trim().toLowerCase();
    if (value?.version !== TRUSTED_FINAL_COMPARISON_EVIDENCE_VERSION
        || !taskRunId
        || !parentHistoryStateRef
        || !['completed', 'stale'].includes(judgeStatus)
        || !/^[a-f0-9]{64}$/u.test(parentJudgeInputDigest)
        || !samePhotoshopHistoryStateRef(parentHistoryStateRef, input.artifactHistoryStateRef)
        || value.boundaries?.parentJudgeInputOnly !== true
        || value.boundaries?.noToolLog !== true
        || value.boundaries?.noPermission !== true
        || value.boundaries?.noWinnerSelection !== true
        || value.boundaries?.budgetOwnedByCaller !== true
        || value.boundaries?.requiresPostJudgeWrite !== true) return undefined;

    const declaredReferenceCompared = value.evidenceScope?.declaredReferenceCompared === true;
    const candidateSetCompared = value.evidenceScope?.candidateSetCompared === true;
    let candidateSet: TrustedFinalComparisonEvidence['candidateSet'];
    if (candidateSetCompared) {
        const selectedSourcePathDigests = Array.from(new Set(
            value.candidateSet?.selectedSourcePathDigests
                ?.map((item) => String(item || '').trim().toLowerCase())
                .filter((item) => /^[a-f0-9]{64}$/u.test(item)) || []
        )).sort();
        const sourceManifest = cloneCandidateSourceManifest(
            value.candidateSet?.sourceManifest,
            value.candidateSet?.sourceManifestDigest
        );
        const image = value.candidateSet?.image
            ? cloneTrustedImage(value.candidateSet.image)
            : undefined;
        if (!image
            || image.sourceKind !== 'candidate_set'
            || !sourceManifest
            || selectedSourcePathDigests.length === 0
            || selectedSourcePathDigests.length > MAX_TRUSTED_FINAL_COMPARISON_SELECTED_SOURCES
            || selectedSourcePathDigests.length !== value.candidateSet?.selectedSourcePathDigests.length
            || selectedSourcePathDigests.some((digest) => (
                !sourceManifest.entries.some((item) => item.pathDigest === digest)
            ))) {
            return undefined;
        }
        const selectedSourceBindingDigest = buildSelectedSourceBindingDigest({
            image,
            selectedSourcePathDigests,
            sourceManifestDigest: sourceManifest.digest
        });
        if (selectedSourceBindingDigest
            !== String(value.candidateSet?.selectedSourceBindingDigest || '').trim().toLowerCase()) {
            return undefined;
        }
        candidateSet = {
            selectedSourcePathDigests,
            sourceManifest: sourceManifest.entries,
            sourceManifestDigest: sourceManifest.digest,
            selectedSourceBindingDigest,
            image
        };
    } else if (value.candidateSet) {
        return undefined;
    }

    let declaredReferences: TrustedFinalComparisonImage[] | undefined;
    let referenceContext: string | undefined;
    if (declaredReferenceCompared) {
        if (!Array.isArray(value.declaredReferences)
            || value.declaredReferences.length === 0
            || value.declaredReferences.length > MAX_TRUSTED_FINAL_COMPARISON_REFERENCE_IMAGES) {
            return undefined;
        }
        const references = value.declaredReferences.map(cloneTrustedImage);
        if (references.some((item) => !item)
            || references.some((item) => item?.sourceKind === 'candidate_set')) return undefined;
        declaredReferences = references as TrustedFinalComparisonImage[];
        if (new Set(declaredReferences.map((item) => item.evidenceId)).size !== declaredReferences.length
            || new Set(declaredReferences.map((item) => item.sourceIdentityDigest)).size
                !== declaredReferences.length) return undefined;
        referenceContext = normalizeReferenceContext(value.referenceContext);
        if (!referenceContext) return undefined;
    } else if (Array.isArray(value.declaredReferences) && value.declaredReferences.length > 0) {
        return undefined;
    } else if (value.referenceContext) {
        return undefined;
    }
    if (!declaredReferenceCompared && !candidateSetCompared) return undefined;

    const expectedParentJudgeInputDigest = buildParentJudgeInputDigest({
        taskRunId,
        parentHistoryStateRef,
        judgeStatus,
        declaredReferenceCompared,
        candidateSetCompared,
        candidateSet,
        declaredReferences,
        referenceContext
    });
    if (expectedParentJudgeInputDigest !== parentJudgeInputDigest) return undefined;

    return {
        version: TRUSTED_FINAL_COMPARISON_EVIDENCE_VERSION,
        taskRunId,
        parentHistoryStateRef,
        judgeStatus,
        parentJudgeInputDigest,
        evidenceScope: { declaredReferenceCompared, candidateSetCompared },
        ...(candidateSet ? { candidateSet } : {}),
        ...(declaredReferences ? { declaredReferences } : {}),
        ...(referenceContext ? { referenceContext } : {}),
        boundaries: buildBoundaries()
    };
}

function cloneProjectionImage(value: TrustedFinalComparisonImage): TrustedFinalComparisonImage {
    return {
        evidenceId: value.evidenceId,
        sourceKind: value.sourceKind,
        sourceIdentityDigest: value.sourceIdentityDigest,
        image: { ...value.image },
        pixelSha256: value.pixelSha256
    };
}

function emptyProjection(
    ...reasonCodes: TrustedFinalComparisonEvidenceReason[]
): TrustedFinalComparisonReplayProjection {
    return {
        evidenceScope: {
            declaredReferenceCompared: false,
            candidateSetCompared: false
        },
        reasonCodes: Array.from(new Set(reasonCodes)),
        requiredImageCount: 0
    };
}

export function projectTrustedFinalComparisonEvidenceForReflexion(input: {
    evidence: TrustedFinalComparisonEvidence | undefined;
    replay: TrustedFinalComparisonReplayInput;
}): TrustedFinalComparisonReplayProjection {
    if (!input.evidence) return emptyProjection('comparison_evidence_missing');
    const evidence = cloneTrustedFinalComparisonEvidence({
        value: input.evidence,
        artifactHistoryStateRef: input.evidence.parentHistoryStateRef
    });
    if (!evidence) return emptyProjection('comparison_evidence_missing');
    const taskRunId = normalizeIdentifier(input.replay?.taskRunId, MAX_TASK_RUN_ID_CHARS);
    if (!taskRunId || taskRunId !== evidence.taskRunId) {
        return emptyProjection('task_run_mismatch');
    }
    if (!samePhotoshopHistoryStateRef(
        input.replay.expectedParentHistoryStateRef,
        evidence.parentHistoryStateRef
    )) {
        return emptyProjection('parent_history_mismatch');
    }
    const currentHistoryStateRef = cloneHistoryStateRef(input.replay.currentHistoryStateRef);
    if (!currentHistoryStateRef) return emptyProjection('current_history_missing');
    if (currentHistoryStateRef.documentId !== evidence.parentHistoryStateRef.documentId) {
        return emptyProjection('current_document_mismatch');
    }

    const reasons: TrustedFinalComparisonEvidenceReason[] = [];
    let candidateSet: TrustedFinalComparisonImage | undefined;
    if (evidence.evidenceScope.candidateSetCompared && evidence.candidateSet) {
        const currentPathDigests = buildSelectedSourcePathDigests(
            input.replay.currentSelectedSourcePaths
        );
        if (!sameStringSet(
            evidence.candidateSet.selectedSourcePathDigests,
            currentPathDigests
        )) {
            reasons.push('candidate_selected_source_mismatch');
        } else {
            // 父代候选 presentation、Axx→path manifest 与像素摘要已经在同一个
            // Runtime-owned WeakMap Artifact 中通过 post-Judge 签发并逐次 clone 校验；
            // 子代没有父代 Tool log，也不应为了“重新证明”而重跑候选工具。只要同一
            // TaskRun 当前真实可见 selected-source 集合未变化，这份父代所见比较集仍适用。
            candidateSet = cloneProjectionImage(evidence.candidateSet.image);
        }
    } else {
        reasons.push('candidate_not_compared_by_parent');
    }

    let declaredReferences: TrustedFinalComparisonImage[] | undefined;
    let referenceContext: string | undefined;
    if (evidence.evidenceScope.declaredReferenceCompared && evidence.declaredReferences) {
        // 参考图是“父代 Agent 实际看过并实际送入父代 Judge 的 presentation”，不是
        // 外部参考源的最新状态。直接承接同 TaskRun 的 exact bytes 才能保持设计依据一致；
        // 重新抓 Eagle / Web 反而可能把更新后的像素冒充父代所见。
        declaredReferences = evidence.declaredReferences.map(cloneProjectionImage);
        referenceContext = evidence.referenceContext;
    } else {
        reasons.push('reference_not_compared_by_parent');
    }

    const candidateSetCompared = Boolean(candidateSet);
    const declaredReferenceCompared = Boolean(declaredReferences?.length);
    return {
        evidenceScope: { declaredReferenceCompared, candidateSetCompared },
        ...(candidateSet ? { candidateSet } : {}),
        ...(declaredReferences ? { declaredReferences } : {}),
        ...(referenceContext ? { referenceContext } : {}),
        reasonCodes: Array.from(new Set(reasons)),
        requiredImageCount: (candidateSet ? 1 : 0) + (declaredReferences?.length || 0)
    };
}

/**
 * 子代 Final Judge 已实际完成后，把本轮确实再次发送的父代 exact presentation 重新绑定到
 * 子代当前 history。这里只消费已经通过 WeakMap lineage 投影的组；scope 由本轮 protocol
 * 实际结果给出，不能用父代 scope 或预算预案提前补绿。
 */
export function rebindTrustedFinalComparisonEvidenceForReflexion(input: {
    evidence: TrustedFinalComparisonEvidence | undefined;
    replay: TrustedFinalComparisonReplayInput;
    currentArtifactHistoryStateRef: PhotoshopHistoryStateRef;
    judgeStatus: 'completed' | 'stale';
    evidenceScope: {
        declaredReferenceCompared: boolean;
        candidateSetCompared: boolean;
    };
}): TrustedFinalComparisonEvidence | undefined {
    if (!input.evidence) return undefined;
    const source = cloneTrustedFinalComparisonEvidence({
        value: input.evidence,
        artifactHistoryStateRef: input.evidence.parentHistoryStateRef
    });
    const currentHistoryStateRef = cloneHistoryStateRef(input.currentArtifactHistoryStateRef);
    if (!source
        || !currentHistoryStateRef
        || !['completed', 'stale'].includes(input.judgeStatus)
        || !samePhotoshopHistoryStateRef(
            currentHistoryStateRef,
            input.replay.currentHistoryStateRef
        )) return undefined;
    const projection = projectTrustedFinalComparisonEvidenceForReflexion({
        evidence: source,
        replay: input.replay
    });
    const candidateSetCompared = input.evidenceScope.candidateSetCompared === true
        && projection.evidenceScope.candidateSetCompared === true
        && Boolean(source.candidateSet);
    const declaredReferenceCompared = input.evidenceScope.declaredReferenceCompared === true
        && projection.evidenceScope.declaredReferenceCompared === true
        && Boolean(source.declaredReferences?.length)
        && Boolean(source.referenceContext);
    if (!candidateSetCompared && !declaredReferenceCompared) return undefined;
    const candidateSet = candidateSetCompared && source.candidateSet
        ? {
            selectedSourcePathDigests: [...source.candidateSet.selectedSourcePathDigests],
            sourceManifest: source.candidateSet.sourceManifest.map((item) => ({ ...item })),
            sourceManifestDigest: source.candidateSet.sourceManifestDigest,
            selectedSourceBindingDigest: source.candidateSet.selectedSourceBindingDigest,
            image: cloneProjectionImage(source.candidateSet.image)
        }
        : undefined;
    const declaredReferences = declaredReferenceCompared
        ? source.declaredReferences?.map(cloneProjectionImage)
        : undefined;
    const referenceContext = declaredReferenceCompared ? source.referenceContext : undefined;
    const parentJudgeInputDigest = buildParentJudgeInputDigest({
        taskRunId: source.taskRunId,
        parentHistoryStateRef: currentHistoryStateRef,
        judgeStatus: input.judgeStatus,
        declaredReferenceCompared,
        candidateSetCompared,
        candidateSet,
        declaredReferences,
        referenceContext
    });
    return {
        version: TRUSTED_FINAL_COMPARISON_EVIDENCE_VERSION,
        taskRunId: source.taskRunId,
        parentHistoryStateRef: currentHistoryStateRef,
        judgeStatus: input.judgeStatus,
        parentJudgeInputDigest,
        evidenceScope: {
            declaredReferenceCompared,
            candidateSetCompared
        },
        ...(candidateSet ? { candidateSet } : {}),
        ...(declaredReferences ? { declaredReferences } : {}),
        ...(referenceContext ? { referenceContext } : {}),
        boundaries: buildBoundaries()
    };
}

export type TrustedFinalComparisonEvidenceOrigin = 'current_run' | 'trusted_parent';

/**
 * 同一次子代 Judge 可以同时收到“本代新观察的候选 + 父代参考”或反向组合。这里按证据组
 * 选择已验证来源并统一重签当前 history，避免 all-current/all-parent 二分导致第三代丢证。
 */
export function mergeTrustedFinalComparisonEvidenceAfterJudge(input: {
    taskRunId: string;
    currentHistoryStateRef: PhotoshopHistoryStateRef;
    judgeStatus: 'completed' | 'stale';
    evidenceScope: {
        declaredReferenceCompared: boolean;
        candidateSetCompared: boolean;
    };
    origins: {
        candidateSet?: TrustedFinalComparisonEvidenceOrigin;
        declaredReference?: TrustedFinalComparisonEvidenceOrigin;
    };
    currentEvidence?: TrustedFinalComparisonEvidence;
    trustedParentEvidence?: TrustedFinalComparisonEvidence;
    trustedParentReplay?: TrustedFinalComparisonReplayInput;
}): TrustedFinalComparisonEvidence | undefined {
    const taskRunId = normalizeIdentifier(input.taskRunId, MAX_TASK_RUN_ID_CHARS);
    const currentHistoryStateRef = cloneHistoryStateRef(input.currentHistoryStateRef);
    if (!taskRunId || !currentHistoryStateRef) return undefined;
    const currentEvidence = input.currentEvidence
        ? cloneTrustedFinalComparisonEvidence({
            value: input.currentEvidence,
            artifactHistoryStateRef: currentHistoryStateRef
        })
        : undefined;
    const trustedParentEvidence = input.trustedParentEvidence
        ? cloneTrustedFinalComparisonEvidence({
            value: input.trustedParentEvidence,
            artifactHistoryStateRef: input.trustedParentEvidence.parentHistoryStateRef
        })
        : undefined;
    const trustedParentProjection = trustedParentEvidence && input.trustedParentReplay
        ? projectTrustedFinalComparisonEvidenceForReflexion({
            evidence: trustedParentEvidence,
            replay: input.trustedParentReplay
        })
        : undefined;
    if ((currentEvidence && currentEvidence.taskRunId !== taskRunId)
        || (trustedParentEvidence && trustedParentEvidence.taskRunId !== taskRunId)) return undefined;

    let candidateSet: TrustedFinalComparisonEvidence['candidateSet'];
    if (input.evidenceScope.candidateSetCompared) {
        if (input.origins.candidateSet === 'current_run') {
            candidateSet = currentEvidence?.candidateSet;
        } else if (input.origins.candidateSet === 'trusted_parent'
            && trustedParentProjection?.evidenceScope.candidateSetCompared) {
            candidateSet = trustedParentEvidence?.candidateSet;
        }
        if (!candidateSet) return undefined;
        candidateSet = {
            selectedSourcePathDigests: [...candidateSet.selectedSourcePathDigests],
            sourceManifest: candidateSet.sourceManifest.map((item) => ({ ...item })),
            sourceManifestDigest: candidateSet.sourceManifestDigest,
            selectedSourceBindingDigest: candidateSet.selectedSourceBindingDigest,
            image: cloneProjectionImage(candidateSet.image)
        };
    }

    let declaredReferences: TrustedFinalComparisonImage[] | undefined;
    let referenceContext: string | undefined;
    if (input.evidenceScope.declaredReferenceCompared) {
        if (input.origins.declaredReference === 'current_run') {
            declaredReferences = currentEvidence?.declaredReferences?.map(cloneProjectionImage);
            referenceContext = currentEvidence?.referenceContext;
        } else if (input.origins.declaredReference === 'trusted_parent'
            && trustedParentProjection?.evidenceScope.declaredReferenceCompared) {
            declaredReferences = trustedParentEvidence?.declaredReferences?.map(cloneProjectionImage);
            referenceContext = trustedParentEvidence?.referenceContext;
        }
        if (!declaredReferences?.length || !referenceContext) return undefined;
    }
    if (!candidateSet && !declaredReferences?.length) return undefined;
    const parentJudgeInputDigest = buildParentJudgeInputDigest({
        taskRunId,
        parentHistoryStateRef: currentHistoryStateRef,
        judgeStatus: input.judgeStatus,
        declaredReferenceCompared: Boolean(declaredReferences?.length),
        candidateSetCompared: Boolean(candidateSet),
        candidateSet,
        declaredReferences,
        referenceContext
    });
    return {
        version: TRUSTED_FINAL_COMPARISON_EVIDENCE_VERSION,
        taskRunId,
        parentHistoryStateRef: currentHistoryStateRef,
        judgeStatus: input.judgeStatus,
        parentJudgeInputDigest,
        evidenceScope: {
            declaredReferenceCompared: Boolean(declaredReferences?.length),
            candidateSetCompared: Boolean(candidateSet)
        },
        ...(candidateSet ? { candidateSet } : {}),
        ...(declaredReferences ? { declaredReferences } : {}),
        ...(referenceContext ? { referenceContext } : {}),
        boundaries: buildBoundaries()
    };
}
