/**
 * SKU 模板数量内容一致性适配器（纯逻辑）。
 *
 * 本模块把当前 SKU 执行计划、模板文件名、模板占位结构与可见文字归一化为
 * deterministic-consistency-verification 的 pack_count claims。它不读取 Photoshop、
 * 不选择 Tool、不执行写入，也不授予任何权限。
 */

import {
    isDeterministicConsistencyReportFresh,
    type ConsistencyClaim,
    type ConsistencyRepairPrecondition,
    type ConsistencyTargetRevision,
    type DeterministicConsistencyRule,
    type DeterministicConsistencyVerificationReport,
    verifyDeterministicConsistency
} from './deterministic-consistency-verification';

export const SKU_TEMPLATE_CONTENT_CONSISTENCY_VERSION =
    'sku-template-content-consistency/v1' as const;

export const SKU_TEMPLATE_PACK_COUNT_REPAIR_PROPOSAL_VERSION =
    'sku-template-pack-count-repair-proposal/v1' as const;

export const SKU_TEMPLATE_LAYOUT_INSPECTION_SCHEMA =
    'sku-template-layout-inspection/v3' as const;

export interface SkuTemplateHistoryStateRefInput {
    documentId?: number | string;
    historyStateId?: number | string;
}

export interface SkuTemplateTextObservationInput {
    layerId: number;
    name?: string;
    contents: string;
    contentsTruncated?: boolean;
    visible: boolean;
}

export interface SkuTemplateRuntimeInspectionInput {
    schema?: string;
    historyStateRef?: SkuTemplateHistoryStateRefInput;
    slotCount?: number;
    textObservations?: readonly SkuTemplateTextObservationInput[];
    textObservationCount?: number;
    textObservationsTruncated?: boolean;
}

export interface SkuTemplateContentConsistencyInput {
    /** 当前 SKU 执行计划已经确定的组合数量；适配器不会从模板反推该 expectation。 */
    expectedItemCount: number;
    /** 当前模板的实际文件名或 Photoshop 文档名。 */
    templateName: string;
    /** 指向签出 expectedItemCount 的执行计划证据；空值会让报告 invalid_input。 */
    executionPlanProofRef: string;
    /**
     * ordered_slots 的 slotCount 等于商品数量；legacy region 的 slotCount 只是区域数，不能冒充商品数量。
     * 省略时保持 ordered_slots 的既有语义。
     */
    structureRepresentsItemCount?: boolean;
    inspection: SkuTemplateRuntimeInspectionInput;
}

export interface SkuTemplatePackCountTextEvidence {
    claimId: string;
    layerId: number;
    layerName: string;
    contents: string;
    count: number;
    occurrenceIndex: number;
    digitStart: number;
    digitEnd: number;
    proofRef: string;
}

export interface SkuTemplateContentConsistencyEvaluation {
    version: typeof SKU_TEMPLATE_CONTENT_CONSISTENCY_VERSION;
    propertyKey: 'pack_count';
    templateName: string;
    expectedItemCount: number;
    /** false 表示 region 模板既没有数量文件名也没有数量文字，本规则没有可对账事实。 */
    applicable: boolean;
    target: ConsistencyTargetRevision;
    filenamePackCount?: number;
    slotCount?: number;
    textEvidence: readonly SkuTemplatePackCountTextEvidence[];
    evidenceCompleteness: {
        inspectionSchemaCompatible: boolean;
        revisionBound: boolean;
        textObservationsComplete: boolean;
        textObservationCount: number;
        returnedTextObservationCount: number;
    };
    report: DeterministicConsistencyVerificationReport;
}

export interface SkuTemplatePackCountRepairProposal {
    version: typeof SKU_TEMPLATE_PACK_COUNT_REPAIR_PROPOSAL_VERSION;
    propertyKey: 'pack_count';
    layerId: number;
    previousContent: string;
    replacementContent: string;
    previousCount: number;
    expectedCount: number;
    reportProofRef: string;
    checkProofRef: string;
    repairEligibilityProofRef: string;
    revisionPrecondition: ConsistencyTargetRevision;
    consistencyPrecondition: ConsistencyRepairPrecondition;
    boundaries: {
        selectsTool: false;
        writesPhotoshop: false;
        grantsPermission: false;
    };
}

interface PackCountOccurrence {
    count: number;
    occurrenceIndex: number;
    digitStart: number;
    digitEnd: number;
}

interface PreparedTextObservation {
    layerId: number;
    layerName: string;
    contents: string;
    occurrences: readonly PackCountOccurrence[];
    sourceOrdinal: number;
}

const PACK_COUNT_PROPERTY_KEY = 'pack_count' as const;
const PACK_COUNT_RULE_ID = 'sku-template-pack-count' as const;

function normalizeIdentityPart(value: unknown): string | undefined {
    if (typeof value === 'number') {
        return Number.isFinite(value) && value > 0 ? String(value) : undefined;
    }
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
}

function normalizePositiveInteger(value: unknown): number | undefined {
    const numberValue = Number(value);
    if (!Number.isSafeInteger(numberValue) || numberValue <= 0) return undefined;
    return numberValue;
}

function normalizeNonNegativeInteger(value: unknown): number | undefined {
    const numberValue = Number(value);
    if (!Number.isSafeInteger(numberValue) || numberValue < 0) return undefined;
    return numberValue;
}

function normalizeDigits(value: string): string {
    return value.replace(/[０-９]/g, (character) => (
        String(character.charCodeAt(0) - '０'.charCodeAt(0))
    ));
}

function findPackCountOccurrences(value: string): PackCountOccurrence[] {
    const occurrences: PackCountOccurrence[] = [];
    const pattern = /([0-9０-９]+)(?=\s*双(?:装)?)/g;
    let match = pattern.exec(value);
    while (match) {
        const count = normalizePositiveInteger(normalizeDigits(match[1]));
        if (count !== undefined) {
            occurrences.push({
                count,
                occurrenceIndex: occurrences.length,
                digitStart: match.index,
                digitEnd: match.index + match[1].length
            });
        }
        match = pattern.exec(value);
    }
    return occurrences;
}

function resolveUniqueFilenamePackCount(templateName: string): number | undefined {
    const occurrences = findPackCountOccurrences(templateName);
    return occurrences.length === 1 ? occurrences[0].count : undefined;
}

function buildTarget(inspection: SkuTemplateRuntimeInspectionInput): ConsistencyTargetRevision {
    const documentId = normalizeIdentityPart(inspection.historyStateRef?.documentId);
    const historyStateId = normalizeIdentityPart(inspection.historyStateRef?.historyStateId);
    return {
        targetRef: documentId ? `photoshop-document:${documentId}` : '',
        revisionRef: historyStateId ? `photoshop-history:${historyStateId}` : ''
    };
}

function buildEvidenceBase(target: ConsistencyTargetRevision): string {
    const targetRef = target.targetRef || 'photoshop-document:missing';
    const revisionRef = target.revisionRef || 'photoshop-history:missing';
    return `${targetRef}/${revisionRef}`;
}

function prepareVisibleTextObservations(
    observations: readonly SkuTemplateTextObservationInput[]
): PreparedTextObservation[] {
    return observations
        .filter((observation) => observation.visible === true)
        .filter((observation) => Number.isSafeInteger(observation.layerId) && observation.layerId > 0)
        .map((observation) => ({
            layerId: observation.layerId,
            layerName: String(observation.name || ''),
            contents: String(observation.contents || ''),
            occurrences: findPackCountOccurrences(String(observation.contents || ''))
        }))
        .filter((observation) => observation.occurrences.length > 0)
        .sort((left, right) => {
            const layerDelta = left.layerId - right.layerId;
            if (layerDelta !== 0) return layerDelta;
            const nameDelta = left.layerName.localeCompare(right.layerName);
            if (nameDelta !== 0) return nameDelta;
            return left.contents.localeCompare(right.contents);
        })
        .map((observation, sourceOrdinal) => ({ ...observation, sourceOrdinal }));
}

function buildTextEvidence(
    prepared: readonly PreparedTextObservation[],
    evidenceBase: string
): SkuTemplatePackCountTextEvidence[] {
    return prepared.flatMap((observation) => observation.occurrences.map((occurrence) => {
        const claimId = `sku-pack-count:text:${observation.layerId}:${observation.sourceOrdinal}:${occurrence.occurrenceIndex}`;
        return {
            claimId,
            layerId: observation.layerId,
            layerName: observation.layerName,
            contents: observation.contents,
            count: occurrence.count,
            occurrenceIndex: occurrence.occurrenceIndex,
            digitStart: occurrence.digitStart,
            digitEnd: occurrence.digitEnd,
            proofRef: `${evidenceBase}/text-layer:${observation.layerId}`
        };
    }));
}

function hasCompleteRevision(target: ConsistencyTargetRevision): boolean {
    return target.targetRef.length > 0 && target.revisionRef.length > 0;
}

function resolveTextObservationCompleteness(
    inspection: SkuTemplateRuntimeInspectionInput
): {
    schemaCompatible: boolean;
    complete: boolean;
    total: number;
    returned: number;
} {
    const schemaCompatible = inspection.schema === SKU_TEMPLATE_LAYOUT_INSPECTION_SCHEMA;
    const returned = inspection.textObservations?.length ?? 0;
    const declaredTotal = normalizeNonNegativeInteger(inspection.textObservationCount);
    const total = declaredTotal ?? returned;
    const truncated = inspection.textObservationsTruncated === true
        || total > returned
        || inspection.textObservations?.some((observation) => observation.contentsTruncated === true) === true;
    return {
        schemaCompatible,
        complete: schemaCompatible && !truncated,
        total,
        returned
    };
}

function hasUnambiguousRepairTextShape(prepared: readonly PreparedTextObservation[]): boolean {
    if (prepared.length === 0) return false;
    if (prepared.some((observation) => observation.occurrences.length !== 1)) return false;
    const layerIds = prepared.map((observation) => observation.layerId);
    return new Set(layerIds).size === layerIds.length;
}

function buildClaims(input: {
    source: SkuTemplateContentConsistencyInput;
    target: ConsistencyTargetRevision;
    evidenceBase: string;
    filenamePackCount?: number;
    slotCount?: number;
    textEvidence: readonly SkuTemplatePackCountTextEvidence[];
    textObservationsComplete: boolean;
}): ConsistencyClaim[] {
    const claims: ConsistencyClaim[] = [
        {
            claimId: 'sku-pack-count:expectation:execution-plan',
            propertyKey: PACK_COUNT_PROPERTY_KEY,
            value: input.source.expectedItemCount,
            proofRef: input.source.executionPlanProofRef,
            role: 'expectation',
            sourceKind: 'execution_plan',
            authority: 'authoritative'
        }
    ];

    if (input.filenamePackCount !== undefined) {
        claims.push({
            claimId: 'sku-pack-count:observation:artifact-name',
            propertyKey: PACK_COUNT_PROPERTY_KEY,
            value: input.filenamePackCount,
            proofRef: `artifact-name:${encodeURIComponent(input.source.templateName)}`,
            role: 'observation',
            sourceKind: 'artifact_metadata',
            target: input.target,
            evidenceStrength: 'deterministic',
            editability: {
                status: 'read_only',
                reason: '模板文件名不是本适配器允许自动修改的目标。'
            }
        });
    }

    if (input.slotCount !== undefined) {
        claims.push({
            claimId: 'sku-pack-count:observation:slot-count',
            propertyKey: PACK_COUNT_PROPERTY_KEY,
            value: input.slotCount,
            proofRef: `${input.evidenceBase}/sku-slot-count`,
            role: 'observation',
            sourceKind: 'document_structure',
            target: input.target,
            evidenceStrength: 'deterministic',
            editability: {
                status: 'read_only',
                reason: '占位结构差异必须交给模板结构治理，不能作为文字替换处理。'
            }
        });
    }

    input.textEvidence.forEach((evidence) => {
        claims.push({
            claimId: evidence.claimId,
            propertyKey: PACK_COUNT_PROPERTY_KEY,
            value: evidence.count,
            proofRef: evidence.proofRef,
            role: 'observation',
            sourceKind: 'document_text',
            target: input.target,
            evidenceStrength: input.textObservationsComplete ? 'deterministic' : 'inferred',
            editability: {
                status: 'editable',
                repairTargetRef: `text-layer:${evidence.layerId}`
            }
        });
    });

    return claims;
}

function buildRule(input: {
    hasFilenameObservation: boolean;
    hasStructureObservation: boolean;
    requiresTextObservation: boolean;
    allowRepairPolicy: boolean;
}): DeterministicConsistencyRule {
    return {
        ruleId: PACK_COUNT_RULE_ID,
        propertyKey: PACK_COUNT_PROPERTY_KEY,
        operator: 'exact',
        observationPolicies: [
            {
                sourceKind: 'artifact_metadata',
                required: input.hasFilenameObservation,
                mismatchDisposition: 'warning'
            },
            {
                sourceKind: 'document_structure',
                required: input.hasStructureObservation,
                mismatchDisposition: 'conflict'
            },
            {
                sourceKind: 'document_text',
                required: input.requiresTextObservation,
                mismatchDisposition: 'conflict'
            }
        ],
        ...(input.allowRepairPolicy
            ? {
                repairPolicy: {
                    mode: 'single_observation' as const,
                    eligibleObservationSourceKinds: ['document_text'] as const,
                    requireMatchingObservationSourceKinds: input.hasStructureObservation
                        ? ['artifact_metadata', 'document_structure'] as const
                        : ['artifact_metadata'] as const
                }
            }
            : {})
    };
}

/**
 * 验证当前修订上的 SKU 模板数量事实。没有 N双/N双装 文字的模板不会因为缺少文字而
 * 得到 needs_observation；只有实际存在数量文字时，document_text 才是必需观察。
 */
export function verifySkuTemplateContentConsistency(
    input: SkuTemplateContentConsistencyInput
): SkuTemplateContentConsistencyEvaluation {
    const target = buildTarget(input.inspection);
    const evidenceBase = buildEvidenceBase(target);
    const filenamePackCount = resolveUniqueFilenamePackCount(input.templateName);
    const slotCount = input.structureRepresentsItemCount === false
        ? undefined
        : normalizeNonNegativeInteger(input.inspection.slotCount);
    const preparedText = prepareVisibleTextObservations(input.inspection.textObservations ?? []);
    const textEvidence = buildTextEvidence(preparedText, evidenceBase);
    const textCompleteness = resolveTextObservationCompleteness(input.inspection);
    const revisionBound = hasCompleteRevision(target);
    const allowRepairPolicy = revisionBound
        && textCompleteness.complete
        && filenamePackCount !== undefined
        && (input.structureRepresentsItemCount === false || slotCount !== undefined)
        && hasUnambiguousRepairTextShape(preparedText);
    const claims = buildClaims({
        source: input,
        target,
        evidenceBase,
        filenamePackCount,
        slotCount,
        textEvidence,
        textObservationsComplete: textCompleteness.complete
    });
    const rule = buildRule({
        hasFilenameObservation: filenamePackCount !== undefined,
        hasStructureObservation: slotCount !== undefined,
        // v3 的完整遍历可以证明“画面没有数量文字”；旧 schema 不能证明未观察到，
        // 必须停在 needs_observation，不能因为缺字段而静默通过。
        requiresTextObservation: !textCompleteness.schemaCompatible || textEvidence.length > 0,
        allowRepairPolicy
    });
    const report = verifyDeterministicConsistency({
        target,
        claims,
        rules: [rule]
    });

    return {
        version: SKU_TEMPLATE_CONTENT_CONSISTENCY_VERSION,
        propertyKey: PACK_COUNT_PROPERTY_KEY,
        templateName: input.templateName,
        expectedItemCount: input.expectedItemCount,
        applicable: !textCompleteness.schemaCompatible
            || slotCount !== undefined
            || filenamePackCount !== undefined
            || textEvidence.length > 0,
        target,
        ...(filenamePackCount !== undefined ? { filenamePackCount } : {}),
        ...(slotCount !== undefined ? { slotCount } : {}),
        textEvidence,
        evidenceCompleteness: {
            inspectionSchemaCompatible: textCompleteness.schemaCompatible,
            revisionBound,
            textObservationsComplete: textCompleteness.complete,
            textObservationCount: textCompleteness.total,
            returnedTextObservationCount: textCompleteness.returned
        },
        report
    };
}

/**
 * 把已经取得修复资格的唯一文字 claim 转成精确字符串替换提案。
 * 提案只替换唯一 N双/N双装 中的数字片段，保留图层内其余文案与空白。
 */
export function buildSkuTemplatePackCountRepairProposal(
    evaluation: SkuTemplateContentConsistencyEvaluation
): SkuTemplatePackCountRepairProposal | undefined {
    if (evaluation.version !== SKU_TEMPLATE_CONTENT_CONSISTENCY_VERSION) return undefined;
    if (!evaluation.evidenceCompleteness.revisionBound) return undefined;
    if (!evaluation.evidenceCompleteness.textObservationsComplete) return undefined;
    if (!isDeterministicConsistencyReportFresh(evaluation.report, evaluation.target)) return undefined;

    const check = evaluation.report.checks.find((candidate) => (
        candidate.ruleId === PACK_COUNT_RULE_ID
        && candidate.propertyKey === PACK_COUNT_PROPERTY_KEY
    ));
    if (!check || check.status !== 'conflict') return undefined;
    const eligibility = check.repairEligibility;
    if (eligibility.status !== 'eligible' || eligibility.observationSourceKind !== 'document_text') {
        return undefined;
    }
    if (typeof eligibility.previousValue !== 'number' || typeof eligibility.expectedValue !== 'number') {
        return undefined;
    }

    const evidence = evaluation.textEvidence.find((candidate) => (
        candidate.claimId === eligibility.observationClaimId
    ));
    if (!evidence) return undefined;
    if (eligibility.repairTargetRef !== `text-layer:${evidence.layerId}`) return undefined;

    const occurrences = findPackCountOccurrences(evidence.contents);
    if (occurrences.length !== 1) return undefined;
    const occurrence = occurrences[0];
    if (occurrence.count !== eligibility.previousValue) return undefined;
    if (occurrence.digitStart !== evidence.digitStart || occurrence.digitEnd !== evidence.digitEnd) {
        return undefined;
    }

    const expectedCount = normalizePositiveInteger(eligibility.expectedValue);
    if (expectedCount === undefined) return undefined;
    const replacementContent = `${evidence.contents.slice(0, occurrence.digitStart)}`
        + `${expectedCount}${evidence.contents.slice(occurrence.digitEnd)}`;
    if (replacementContent === evidence.contents) return undefined;

    return {
        version: SKU_TEMPLATE_PACK_COUNT_REPAIR_PROPOSAL_VERSION,
        propertyKey: PACK_COUNT_PROPERTY_KEY,
        layerId: evidence.layerId,
        previousContent: evidence.contents,
        replacementContent,
        previousCount: occurrence.count,
        expectedCount,
        reportProofRef: evaluation.report.proofRef,
        checkProofRef: check.proofRef,
        repairEligibilityProofRef: eligibility.proofRef,
        revisionPrecondition: { ...eligibility.precondition.target },
        consistencyPrecondition: {
            ...eligibility.precondition,
            target: { ...eligibility.precondition.target }
        },
        boundaries: {
            selectsTool: false,
            writesPhotoshop: false,
            grantsPermission: false
        }
    };
}
