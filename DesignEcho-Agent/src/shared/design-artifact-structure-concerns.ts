/**
 * 设计成品结构 concern 检测（纯逻辑）。
 *
 * 本模块只把工具时序与最终 Photoshop 验收快照中存在唯一答案的结构事实关联起来：
 * - 不修改文档；
 * - 不决定元素应当保留还是删除；
 * - 不按固定字号、图层数量或“必须有文字”等规则替模型做设计判断；
 * - 快照覆盖不完整时明确返回 needs_review，不把部分清单冒充“没有结构问题”。
 */

import type {
    AcceptanceBounds,
    AcceptanceLayer,
    AcceptanceSnapshot
} from './acceptance/photoshop-acceptance';
import {
    readPhotoshopHistoryStateRef,
    readPhotoshopHistoryTransition,
    readPhotoshopMutationCommit
} from './photoshop-history-state-ref';
import { readPhotoshopOperationResult } from './photoshop-operation-result';

export const DESIGN_ARTIFACT_STRUCTURE_CONCERNS_VERSION = 'design-artifact-structure-concerns/v1' as const;

const MAX_CONCERNS = 12;
const MAX_REASON_CODES = 8;

export type DesignArtifactStructureConcernKind =
    | 'abandoned-visible-content-after-failed-clear'
    | 'concealed-content-after-failed-clear'
    | 'structure-observation-incomplete';

export type DesignArtifactStructureCoverageStatus =
    | 'complete'
    | 'incomplete'
    | 'unavailable';

export type DesignArtifactStructureCoverageReason =
    | 'snapshot_unavailable'
    | 'snapshot_failed'
    | 'document_unavailable'
    | 'document_identity_unavailable'
    | 'layer_list_unavailable'
    | 'layer_list_truncated'
    | 'reported_layer_count_mismatch'
    | 'text_detail_unavailable'
    | 'layer_read_warning'
    | 'tool_layer_identity_unavailable'
    | 'concern_list_truncated';

export type DesignArtifactStructureConcernFact =
    | 'non_empty_text_created'
    | 'clear_attempt_failed'
    | 'same_layer_style_changed_after_failure'
    | 'same_layer_hidden_after_failure'
    | 'same_layer_zero_opacity_after_failure'
    | 'same_layer_moved_after_failure'
    | 'created_content_remained'
    | 'final_layer_visible'
    | 'final_layer_hidden'
    | 'final_layer_fully_transparent'
    | 'final_layer_outside_canvas'
    | 'final_text_non_empty'
    | 'structure_snapshot_incomplete'
    | 'structure_snapshot_unavailable'
    | 'tool_layer_identity_unavailable'
    | 'structure_concern_report_truncated';

export interface DesignArtifactStructureToolLogEntry {
    name?: unknown;
    arguments?: unknown;
    result?: unknown;
}

export interface DesignArtifactStructureLayerRef {
    /** Photoshop 打开期内的文档身份，与 layer id 共同组成唯一目标。 */
    documentId: number;
    /** Photoshop 当前文档内的稳定图层 id；不包含文件系统路径或完整工具载荷。 */
    id: number;
    kind: 'text';
}

export interface DesignArtifactStructureConcernMeasurements {
    createdFontSize?: number;
    latestRequestedFontSize?: number;
    finalFontSize?: number;
    requestedToCreatedFontScaleRatio?: number;
    finalTextLength?: number;
    finalOpacity?: number;
    finalBounds?: Pick<AcceptanceBounds, 'width' | 'height'>;
    canvas?: { width: number; height: number };
    finalBoundsAreaToCanvasRatio?: number;
    observedLayerCount?: number;
    reportedLayerCount?: number;
    detectedConcernCount?: number;
    reportedConcernCount?: number;
    unresolvedLayerIdentityCount?: number;
}

export interface DesignArtifactStructureConcern {
    /** concern 类别，不承担实例身份。 */
    kind: DesignArtifactStructureConcernKind;
    /** 本次报告内的稳定实例引用；供 Judge 逐项确认已经消费。 */
    evidenceId: string;
    status: 'needs_review';
    summary: string;
    layerRef?: DesignArtifactStructureLayerRef;
    facts: DesignArtifactStructureConcernFact[];
    measurements?: DesignArtifactStructureConcernMeasurements;
}

export interface DesignArtifactStructureCoverage {
    status: DesignArtifactStructureCoverageStatus;
    observedLayerCount: number;
    reportedLayerCount?: number;
    /** 不含 coverage 自身生成的结构证据缺口 concern。 */
    detectedConcernCount: number;
    /** 返回的 concerns 中不含 coverage concern 的业务 concern 数。 */
    reportedConcernCount: number;
    /** 相关工具调用缺少 Host 图层身份，无法安全组成关系链的次数。 */
    unresolvedLayerIdentityCount: number;
    /** concern 列表是否因 MAX_CONCERNS 被截断；与 Photoshop 图层快照截断分开。 */
    concernsTruncated: boolean;
    truncated: boolean;
    reasonCodes: DesignArtifactStructureCoverageReason[];
}

export interface DesignArtifactStructureConcernReport {
    version: typeof DESIGN_ARTIFACT_STRUCTURE_CONCERNS_VERSION;
    coverage: DesignArtifactStructureCoverage;
    concerns: DesignArtifactStructureConcern[];
    boundaries: {
        observationOnly: true;
        doesNotMutateDocument: true;
        doesNotChooseDesignOutcome: true;
        requiresJudgeInterpretation: true;
        rawToolPayloadExcluded: true;
        filesystemPathsExcluded: true;
    };
}

export interface DetectDesignArtifactStructureConcernsInput {
    toolCallLog: readonly DesignArtifactStructureToolLogEntry[];
    /**
     * 最终、同一 revision 的完整验收快照。省略时仅从日志里最后一次成功的
     * getAcceptanceSnapshot 结果读取；不会把单步 acceptance summary 当作完整图层快照。
     */
    acceptanceSnapshot?: AcceptanceSnapshot | null;
}

interface CreatedTextRecord {
    index: number;
    documentId: number;
    layerId: number;
    content: string;
    fontSize?: number;
}

interface FailedClearRecord {
    index: number;
    documentId: number;
    layerId: number;
}

interface LaterStyleRecord {
    index: number;
    documentId: number;
    layerId: number;
    fontSize?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readFiniteNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (!isRecord(value)) return undefined;
    const nested = value._value ?? value.value;
    const parsed = Number(nested);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function readPositiveLayerId(value: unknown): number | undefined {
    const parsed = readFiniteNumber(value);
    if (!Number.isSafeInteger(parsed) || Number(parsed) <= 0) return undefined;
    return Number(parsed);
}

function readPositiveDocumentId(value: unknown): number | undefined {
    return readPositiveLayerId(value);
}

function addDocumentId(target: Set<number>, value: unknown): void {
    const documentId = readPositiveDocumentId(value);
    if (documentId !== undefined) target.add(documentId);
}

/**
 * 从 Host 返回的版本/事务收据解析一次工具调用实际所属文档。模型参数不是 Host 事实，
 * 所以 expectedDocumentId/documentId 参数都不参与；多个收据互相冲突时保持 unknown。
 */
function readToolResultDocumentId(entry: DesignArtifactStructureToolLogEntry): number | undefined {
    const result = readToolResult(entry);
    const documentIds = new Set<number>();
    const directHistoryStateRef = readPhotoshopHistoryStateRef(result);
    addDocumentId(documentIds, directHistoryStateRef?.documentId);

    const transition = readPhotoshopHistoryTransition(result);
    addDocumentId(documentIds, transition?.before?.documentId);
    addDocumentId(documentIds, transition?.after?.documentId);

    const mutationCommit = readPhotoshopMutationCommit(result);
    addDocumentId(documentIds, mutationCommit?.before?.documentId);
    addDocumentId(documentIds, mutationCommit?.after?.documentId);
    addDocumentId(documentIds, mutationCommit?.createdDocumentId);

    const operationResult = readPhotoshopOperationResult(result);
    addDocumentId(documentIds, operationResult?.before?.documentId);
    addDocumentId(documentIds, operationResult?.after?.documentId);

    const data = isRecord(result.data) ? result.data : undefined;
    const target = isRecord(result.target) ? result.target : undefined;
    const layer = isRecord(result.layer) ? result.layer : undefined;
    const readback = isRecord(result.readback) ? result.readback : undefined;
    addDocumentId(documentIds, result.documentId);
    addDocumentId(documentIds, data?.documentId);
    addDocumentId(documentIds, target?.documentId);
    addDocumentId(documentIds, layer?.documentId);
    addDocumentId(documentIds, readback?.documentId);
    return documentIds.size === 1 ? Array.from(documentIds)[0] : undefined;
}

function readSnapshotDocumentId(snapshot: AcceptanceSnapshot | undefined): number | undefined {
    if (!snapshot) return undefined;
    const documentIds = new Set<number>();
    addDocumentId(documentIds, readPhotoshopHistoryStateRef(snapshot)?.documentId);
    addDocumentId(documentIds, snapshot.document?.id);
    return documentIds.size === 1 ? Array.from(documentIds)[0] : undefined;
}

function buildLayerConcernEvidenceId(
    kind: DesignArtifactStructureConcernKind,
    documentId: number,
    layerId: number
): string {
    return `structure:${kind}:document-${documentId}:layer-${layerId}`;
}

function buildCoverageConcernEvidenceId(
    coverage: DesignArtifactStructureCoverage,
    documentId: number | undefined
): string {
    const scope = documentId === undefined ? 'document-unknown' : `document-${documentId}`;
    return `structure:structure-observation-incomplete:${scope}:${coverage.status}`;
}

function readToolArguments(entry: DesignArtifactStructureToolLogEntry): Record<string, unknown> {
    return isRecord(entry.arguments) ? entry.arguments : {};
}

function readToolResult(entry: DesignArtifactStructureToolLogEntry): Record<string, unknown> {
    return isRecord(entry.result) ? entry.result : {};
}

function toolSucceeded(entry: DesignArtifactStructureToolLogEntry): boolean {
    return isRecord(entry.result) && entry.result.success !== false;
}

function toolFailed(entry: DesignArtifactStructureToolLogEntry): boolean {
    return isRecord(entry.result) && entry.result.success === false;
}

function readCreatedLayerId(entry: DesignArtifactStructureToolLogEntry): number | undefined {
    const result = readToolResult(entry);
    const layer = isRecord(result.layer) ? result.layer : undefined;
    const createdLayer = isRecord(result.createdLayer) ? result.createdLayer : undefined;
    const data = isRecord(result.data) ? result.data : undefined;
    const candidates = new Set<number>();
    for (const candidate of [
        result.layerId,
        result.createdLayerId,
        layer?.id,
        createdLayer?.id,
        data?.layerId,
        data?.createdLayerId
    ]) {
        const layerId = readPositiveLayerId(candidate);
        if (layerId !== undefined) candidates.add(layerId);
    }
    return candidates.size === 1 ? Array.from(candidates)[0] : undefined;
}

interface HostLayerIdentityResolution {
    /** undefined 表示结果未给出可核验的目标身份；空数组表示 Host 明确报告没有变更目标。 */
    layerIds?: number[];
}

function addLayerId(target: Set<number>, value: unknown): void {
    const layerId = readPositiveLayerId(value);
    if (layerId !== undefined) target.add(layerId);
}

function addLayerIdsFromResultItems(target: Set<number>, value: unknown): void {
    if (!Array.isArray(value)) return;
    for (const item of value) {
        if (!isRecord(item)) continue;
        addLayerId(target, item.layerId);
        addLayerId(target, item.id);
    }
}

/**
 * 读取 Tool 自身公开结果里的 Host 图层身份。这里只接受工具实际结果字段，不读取模型参数。
 * 各工具结果形状不同：文字 patch 返回 layerId/target，批量文字返回 results，图层可见性
 * 返回 changed。changed=[] 是已知“没有变更目标”，不能再用参数补成一次关系动作。
 */
function readDirectHostTargetLayerIds(
    entry: DesignArtifactStructureToolLogEntry
): HostLayerIdentityResolution {
    const name = String(entry?.name || '').trim();
    const result = readToolResult(entry);
    const data = isRecord(result.data) ? result.data : undefined;
    const target = isRecord(result.target) ? result.target : undefined;
    const layer = isRecord(result.layer) ? result.layer : undefined;
    const ids = new Set<number>();

    if (name === 'setTextContent') {
        addLayerId(ids, result.layerId);
        addLayerId(ids, target?.layerId);
        addLayerId(ids, data?.layerId);
        addLayerIdsFromResultItems(ids, result.results);
    } else if (name === 'setTextStyle') {
        addLayerId(ids, result.layerId);
        addLayerId(ids, target?.layerId);
        addLayerId(ids, data?.layerId);
    } else if (name === 'setLayerVisibility') {
        if (Array.isArray(result.changed)) {
            addLayerIdsFromResultItems(ids, result.changed);
            return { layerIds: Array.from(ids) };
        }
    } else if (name === 'setLayerOpacity'
        || name === 'moveLayer'
        || name === 'transformLayer') {
        addLayerId(ids, result.layerId);
        addLayerId(ids, target?.layerId);
        addLayerId(ids, layer?.id);
        addLayerId(ids, data?.layerId);
    }

    return ids.size > 0 ? { layerIds: Array.from(ids) } : {};
}

function readSingleRequestedTargetLayerId(
    entry: DesignArtifactStructureToolLogEntry
): number | undefined {
    const args = readToolArguments(entry);
    const direct = [args.layerId, args.targetLayerId, args.id]
        .map(readPositiveLayerId)
        .filter((value): value is number => value !== undefined);
    if (direct.length > 0) {
        return new Set(direct).size === 1 ? direct[0] : undefined;
    }
    if (!Array.isArray(args.layerIds) || args.layerIds.length !== 1) return undefined;
    return readPositiveLayerId(args.layerIds[0]);
}

/**
 * 旧事务失败结果可能没有公开 target 字段，但 versioned operation receipt 会保留 modal
 * 前后的活动图层。只有前后 Host 活动图层一致且与唯一请求目标相同，才把参数当作已被
 * Host 佐证；活动图层缺失/变化/不匹配时保持 unknown。
 */
function readTransactionCorroboratedTargetLayerId(
    entry: DesignArtifactStructureToolLogEntry
): number | undefined {
    const result = readToolResult(entry);
    if (!readPhotoshopOperationResult(result)) return undefined;
    const rawOperation = isRecord(result.photoshopOperationResult)
        ? result.photoshopOperationResult
        : undefined;
    const before = isRecord(rawOperation?.before) ? rawOperation.before : undefined;
    const after = isRecord(rawOperation?.after) ? rawOperation.after : undefined;
    const beforeLayerId = readPositiveLayerId(before?.activeLayerId);
    const afterLayerId = readPositiveLayerId(after?.activeLayerId);
    const requestedLayerId = readSingleRequestedTargetLayerId(entry);
    if (beforeLayerId === undefined
        || afterLayerId === undefined
        || requestedLayerId === undefined
        || beforeLayerId !== afterLayerId
        || beforeLayerId !== requestedLayerId) return undefined;
    return beforeLayerId;
}

function readHostTargetLayerIds(
    entry: DesignArtifactStructureToolLogEntry
): number[] | undefined {
    const direct = readDirectHostTargetLayerIds(entry);
    if (direct.layerIds !== undefined) return direct.layerIds;
    const corroborated = readTransactionCorroboratedTargetLayerId(entry);
    return corroborated === undefined ? undefined : [corroborated];
}

function readRequestedText(args: Record<string, unknown>): string | undefined {
    const value = args.content ?? args.text;
    return typeof value === 'string' ? value : undefined;
}

function normalizeComparableText(value: string): string {
    return value.replace(/\r\n?/gu, '\n');
}

function roundRatio(value: number): number {
    return Math.round(value * 1_000_000) / 1_000_000;
}

function readSnapshotCandidate(value: unknown): AcceptanceSnapshot | undefined {
    if (!isRecord(value)) return undefined;
    if ('hasDocument' in value || Array.isArray(value.layers)) {
        return value as unknown as AcceptanceSnapshot;
    }
    const nestedCandidates = [value.snapshot, value.data];
    for (const candidate of nestedCandidates) {
        if (isRecord(candidate) && ('hasDocument' in candidate || Array.isArray(candidate.layers))) {
            return candidate as unknown as AcceptanceSnapshot;
        }
    }
    return undefined;
}

function resolveFinalAcceptanceSnapshot(
    input: DetectDesignArtifactStructureConcernsInput
): AcceptanceSnapshot | undefined {
    if (input.acceptanceSnapshot) return input.acceptanceSnapshot;
    for (let index = input.toolCallLog.length - 1; index >= 0; index -= 1) {
        const entry = input.toolCallLog[index];
        if (String(entry?.name || '').trim() !== 'getAcceptanceSnapshot') continue;
        if (!toolSucceeded(entry)) continue;
        const snapshot = readSnapshotCandidate(entry.result);
        if (snapshot) return snapshot;
    }
    return undefined;
}

function addCoverageReason(
    reasons: DesignArtifactStructureCoverageReason[],
    reason: DesignArtifactStructureCoverageReason
): void {
    if (reasons.includes(reason) || reasons.length >= MAX_REASON_CODES) return;
    reasons.push(reason);
}

function buildCoverage(snapshot: AcceptanceSnapshot | undefined): DesignArtifactStructureCoverage {
    if (!snapshot) {
        return {
            status: 'unavailable',
            observedLayerCount: 0,
            detectedConcernCount: 0,
            reportedConcernCount: 0,
            unresolvedLayerIdentityCount: 0,
            concernsTruncated: false,
            truncated: false,
            reasonCodes: ['snapshot_unavailable']
        };
    }

    const layers = Array.isArray(snapshot.layers) ? snapshot.layers : [];
    const reportedLayerCount = readFiniteNumber(snapshot.summary?.totalLayers);
    const reasons: DesignArtifactStructureCoverageReason[] = [];
    if (snapshot.success !== true) addCoverageReason(reasons, 'snapshot_failed');
    if (snapshot.hasDocument !== true) addCoverageReason(reasons, 'document_unavailable');
    if (snapshot.hasDocument === true && readSnapshotDocumentId(snapshot) === undefined) {
        addCoverageReason(reasons, 'document_identity_unavailable');
    }
    if (!Array.isArray(snapshot.layers)) addCoverageReason(reasons, 'layer_list_unavailable');
    if (snapshot.summary?.truncated === true) addCoverageReason(reasons, 'layer_list_truncated');
    if (reportedLayerCount !== undefined && reportedLayerCount !== layers.length) {
        addCoverageReason(reasons, 'reported_layer_count_mismatch');
    }
    const textLayers = layers.filter((layer) => String(layer?.kind || '').toLowerCase() === 'text');
    if (textLayers.some((layer) => !layer.text || typeof layer.text.content !== 'string')) {
        addCoverageReason(reasons, 'text_detail_unavailable');
    }
    const warnings = Array.isArray(snapshot.warnings) ? snapshot.warnings : [];
    if (warnings.some((warning) => /截断|跳过失效图层|truncat|incomplete/iu.test(String(warning)))) {
        addCoverageReason(reasons, 'layer_read_warning');
    }

    let status: DesignArtifactStructureCoverageStatus = 'complete';
    if (reasons.includes('snapshot_failed')
        || reasons.includes('document_unavailable')
        || reasons.includes('layer_list_unavailable')) {
        status = 'unavailable';
    } else if (reasons.length > 0) {
        status = 'incomplete';
    }

    return {
        status,
        observedLayerCount: layers.length,
        ...(reportedLayerCount !== undefined ? { reportedLayerCount } : {}),
        detectedConcernCount: 0,
        reportedConcernCount: 0,
        unresolvedLayerIdentityCount: 0,
        concernsTruncated: false,
        truncated: snapshot.summary?.truncated === true,
        reasonCodes: reasons
    };
}

function isRelevantStructureRelationEntry(
    entry: DesignArtifactStructureToolLogEntry
): boolean {
    const name = String(entry?.name || '').trim();
    const args = readToolArguments(entry);
    if (name === 'createTextLayer') {
        const content = readRequestedText(args);
        return toolSucceeded(entry) && typeof content === 'string' && content.trim().length > 0;
    }
    if (name === 'setTextContent') {
        const content = readRequestedText(args);
        return toolFailed(entry) && typeof content === 'string' && content.trim().length === 0;
    }
    if (name === 'setTextStyle') return toolSucceeded(entry);
    if (name === 'setLayerVisibility') return toolSucceeded(entry) && args.visible === false;
    if (name === 'setLayerOpacity') {
        return toolSucceeded(entry) && readFiniteNumber(args.opacity) === 0;
    }
    return (name === 'moveLayer' || name === 'transformLayer') && toolSucceeded(entry);
}

function countUnresolvedLayerIdentities(
    toolCallLog: readonly DesignArtifactStructureToolLogEntry[],
    documentId: number | undefined
): number {
    let count = 0;
    for (const entry of toolCallLog) {
        if (!isRelevantStructureRelationEntry(entry)) continue;
        const entryDocumentId = readToolResultDocumentId(entry);
        if (entryDocumentId === undefined) {
            count += 1;
            continue;
        }
        if (documentId !== undefined
            && entryDocumentId !== documentId) continue;
        const createdLayerId = readCreatedLayerId(entry);
        const layerIds = String(entry?.name || '').trim() === 'createTextLayer'
            ? (createdLayerId === undefined ? undefined : [createdLayerId])
            : readHostTargetLayerIds(entry);
        if (layerIds === undefined) count += 1;
    }
    return count;
}

function collectCreatedTextRecords(
    toolCallLog: readonly DesignArtifactStructureToolLogEntry[]
): Map<string, CreatedTextRecord[]> {
    const records = new Map<string, CreatedTextRecord[]>();
    toolCallLog.forEach((entry, index) => {
        if (String(entry?.name || '').trim() !== 'createTextLayer' || !toolSucceeded(entry)) return;
        const layerId = readCreatedLayerId(entry);
        const documentId = readToolResultDocumentId(entry);
        const args = readToolArguments(entry);
        const content = readRequestedText(args);
        if (documentId === undefined
            || layerId === undefined
            || typeof content !== 'string'
            || content.trim().length === 0) return;
        const recordKey = `${documentId}:${layerId}`;
        const current = records.get(recordKey) || [];
        current.push({
            index,
            documentId,
            layerId,
            content,
            ...(readFiniteNumber(args.fontSize) !== undefined
                ? { fontSize: readFiniteNumber(args.fontSize) }
                : {})
        });
        records.set(recordKey, current);
    });
    return records;
}

function collectFailedClearRecords(
    toolCallLog: readonly DesignArtifactStructureToolLogEntry[]
): FailedClearRecord[] {
    const records: FailedClearRecord[] = [];
    toolCallLog.forEach((entry, index) => {
        if (String(entry?.name || '').trim() !== 'setTextContent' || !toolFailed(entry)) return;
        const content = readRequestedText(readToolArguments(entry));
        const hostLayerIds = readHostTargetLayerIds(entry);
        const layerId = hostLayerIds?.length === 1 ? hostLayerIds[0] : undefined;
        const documentId = readToolResultDocumentId(entry);
        if (documentId === undefined
            || layerId === undefined
            || typeof content !== 'string'
            || content.trim().length > 0) return;
        records.push({ index, documentId, layerId });
    });
    return records;
}

function findLatestPriorCreation(
    records: Map<string, CreatedTextRecord[]>,
    failedClear: FailedClearRecord
): CreatedTextRecord | undefined {
    const candidates = records.get(`${failedClear.documentId}:${failedClear.layerId}`) || [];
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
        if (candidates[index].index < failedClear.index) return candidates[index];
    }
    return undefined;
}

function findLaterStyleMutation(
    toolCallLog: readonly DesignArtifactStructureToolLogEntry[],
    failedClear: FailedClearRecord
): LaterStyleRecord | undefined {
    let latest: LaterStyleRecord | undefined;
    for (let index = failedClear.index + 1; index < toolCallLog.length; index += 1) {
        const entry = toolCallLog[index];
        if (String(entry?.name || '').trim() !== 'setTextStyle' || !toolSucceeded(entry)) continue;
        if (readToolResultDocumentId(entry) !== failedClear.documentId) continue;
        const hostLayerIds = readHostTargetLayerIds(entry);
        if (!hostLayerIds?.includes(failedClear.layerId)) continue;
        latest = {
            index,
            documentId: failedClear.documentId,
            layerId: failedClear.layerId,
            ...(readFiniteNumber(readToolArguments(entry).fontSize) !== undefined
                ? { fontSize: readFiniteNumber(readToolArguments(entry).fontSize) }
                : {})
        };
    }
    return latest;
}

function toolTargetsLayer(
    entry: DesignArtifactStructureToolLogEntry,
    layerId: number
): boolean {
    return readHostTargetLayerIds(entry)?.includes(layerId) === true;
}

interface LaterConcealmentRelation {
    hidden: boolean;
    zeroOpacity: boolean;
    spatiallyMoved: boolean;
}

function findLaterConcealmentRelation(
    toolCallLog: readonly DesignArtifactStructureToolLogEntry[],
    failedClear: FailedClearRecord
): LaterConcealmentRelation {
    const relation: LaterConcealmentRelation = {
        hidden: false,
        zeroOpacity: false,
        spatiallyMoved: false
    };
    for (let index = failedClear.index + 1; index < toolCallLog.length; index += 1) {
        const entry = toolCallLog[index];
        if (!toolSucceeded(entry)
            || readToolResultDocumentId(entry) !== failedClear.documentId
            || !toolTargetsLayer(entry, failedClear.layerId)) continue;
        const name = String(entry?.name || '').trim();
        const args = readToolArguments(entry);
        if (name === 'setLayerVisibility' && args.visible === false) {
            relation.hidden = true;
        } else if (name === 'setLayerOpacity' && readFiniteNumber(args.opacity) === 0) {
            relation.zeroOpacity = true;
        } else if (name === 'moveLayer' || name === 'transformLayer') {
            relation.spatiallyMoved = true;
        }
    }
    return relation;
}

function finalLayerIsOutsideCanvas(
    snapshot: AcceptanceSnapshot,
    layer: AcceptanceLayer
): boolean {
    const bounds = layer.boundsNoEffects || layer.bounds;
    const left = readFiniteNumber(bounds?.left);
    const top = readFiniteNumber(bounds?.top);
    const right = readFiniteNumber(bounds?.right);
    const bottom = readFiniteNumber(bounds?.bottom);
    const canvasWidth = readFiniteNumber(snapshot.document?.width);
    const canvasHeight = readFiniteNumber(snapshot.document?.height);
    if (left === undefined
        || top === undefined
        || right === undefined
        || bottom === undefined
        || canvasWidth === undefined
        || canvasHeight === undefined
        || canvasWidth <= 0
        || canvasHeight <= 0) return false;
    return right <= 0 || bottom <= 0 || left >= canvasWidth || top >= canvasHeight;
}

function hasLaterExplicitTextReplacement(
    toolCallLog: readonly DesignArtifactStructureToolLogEntry[],
    failedClear: FailedClearRecord,
    finalContent: string
): boolean {
    for (let index = failedClear.index + 1; index < toolCallLog.length; index += 1) {
        const entry = toolCallLog[index];
        if (String(entry?.name || '').trim() !== 'setTextContent' || !toolSucceeded(entry)) continue;
        if (readToolResultDocumentId(entry) !== failedClear.documentId) continue;
        if (!readHostTargetLayerIds(entry)?.includes(failedClear.layerId)) continue;
        const replacement = readRequestedText(readToolArguments(entry));
        if (typeof replacement === 'string' && replacement === finalContent) return true;
    }
    return false;
}

function findFinalTextLayer(
    snapshot: AcceptanceSnapshot,
    layerId: number
): AcceptanceLayer | undefined {
    const layers = Array.isArray(snapshot.layers) ? snapshot.layers : [];
    return layers.find((layer) => Number(layer?.id) === layerId && String(layer?.kind || '').toLowerCase() === 'text');
}

function buildMeasurements(input: {
    snapshot: AcceptanceSnapshot;
    layer: AcceptanceLayer;
    creation: CreatedTextRecord;
    style?: LaterStyleRecord;
}): DesignArtifactStructureConcernMeasurements {
    const measurements: DesignArtifactStructureConcernMeasurements = {};
    if (input.creation.fontSize !== undefined) measurements.createdFontSize = input.creation.fontSize;
    if (input.style?.fontSize !== undefined) measurements.latestRequestedFontSize = input.style.fontSize;
    if (input.creation.fontSize !== undefined
        && input.creation.fontSize > 0
        && input.style?.fontSize !== undefined) {
        measurements.requestedToCreatedFontScaleRatio = roundRatio(
            input.style.fontSize / input.creation.fontSize
        );
    }
    const finalFontSize = readFiniteNumber(input.layer.text?.style?.fontSize);
    if (finalFontSize !== undefined) measurements.finalFontSize = finalFontSize;
    const finalLength = readFiniteNumber(input.layer.text?.length);
    if (finalLength !== undefined) measurements.finalTextLength = Math.max(0, Math.floor(finalLength));
    const opacity = readFiniteNumber(input.layer.opacity);
    if (opacity !== undefined) measurements.finalOpacity = opacity;
    const bounds = input.layer.boundsNoEffects || input.layer.bounds;
    const width = readFiniteNumber(bounds?.width);
    const height = readFiniteNumber(bounds?.height);
    if (width !== undefined && height !== undefined) {
        measurements.finalBounds = { width, height };
    }
    const canvasWidth = readFiniteNumber(input.snapshot.document?.width);
    const canvasHeight = readFiniteNumber(input.snapshot.document?.height);
    if (canvasWidth !== undefined && canvasHeight !== undefined) {
        measurements.canvas = { width: canvasWidth, height: canvasHeight };
        if (measurements.finalBounds
            && canvasWidth > 0
            && canvasHeight > 0) {
            measurements.finalBoundsAreaToCanvasRatio = roundRatio(
                (measurements.finalBounds.width * measurements.finalBounds.height)
                / (canvasWidth * canvasHeight)
            );
        }
    }
    return measurements;
}

function detectFailedClearTextConcerns(
    toolCallLog: readonly DesignArtifactStructureToolLogEntry[],
    snapshot: AcceptanceSnapshot,
    documentId: number
): DesignArtifactStructureConcern[] {
    const concerns: DesignArtifactStructureConcern[] = [];
    const creations = collectCreatedTextRecords(toolCallLog);
    const failedClears = collectFailedClearRecords(toolCallLog);
    const seenLayerIds = new Set<number>();

    for (const failedClear of failedClears) {
        if (failedClear.documentId !== documentId) continue;
        if (seenLayerIds.has(failedClear.layerId)) continue;
        const creation = findLatestPriorCreation(creations, failedClear);
        const style = findLaterStyleMutation(toolCallLog, failedClear);
        const concealment = findLaterConcealmentRelation(toolCallLog, failedClear);
        const finalLayer = findFinalTextLayer(snapshot, failedClear.layerId);
        if (!creation || !finalLayer) continue;

        const finalContent = String(finalLayer.text?.content ?? '');
        const finalOpacity = readFiniteNumber(finalLayer.opacity);
        const remainsVisible = finalLayer.visible === true && (finalOpacity === undefined || finalOpacity > 0);
        const createdContentRemained = normalizeComparableText(finalContent)
            === normalizeComparableText(creation.content);
        const scaleReducedAfterFailure = style !== undefined
            && creation.fontSize !== undefined
            && creation.fontSize > 0
            && style.fontSize !== undefined
            && style.fontSize > 0
            && style.fontSize < creation.fontSize;
        if (finalContent.trim().length === 0 || !createdContentRemained) continue;
        if (hasLaterExplicitTextReplacement(toolCallLog, failedClear, finalContent)) continue;

        const finalLayerHiddenAfterFailure = concealment.hidden && finalLayer.visible === false;
        const finalLayerTransparentAfterFailure = concealment.zeroOpacity
            && finalOpacity !== undefined
            && finalOpacity <= 0;
        const finalLayerOutsideCanvasAfterFailure = concealment.spatiallyMoved
            && finalLayerIsOutsideCanvas(snapshot, finalLayer);
        const concealedAfterFailure = finalLayerHiddenAfterFailure
            || finalLayerTransparentAfterFailure
            || finalLayerOutsideCanvasAfterFailure;
        const visibleReducedAfterFailure = remainsVisible && scaleReducedAfterFailure;
        if (!concealedAfterFailure && !visibleReducedAfterFailure) continue;

        const kind: DesignArtifactStructureConcernKind = concealedAfterFailure
            ? 'concealed-content-after-failed-clear'
            : 'abandoned-visible-content-after-failed-clear';
        const facts: DesignArtifactStructureConcernFact[] = [
            'non_empty_text_created',
            'clear_attempt_failed',
            'created_content_remained',
            'final_text_non_empty'
        ];
        if (scaleReducedAfterFailure) facts.push('same_layer_style_changed_after_failure');
        if (visibleReducedAfterFailure) facts.push('final_layer_visible');
        if (finalLayerHiddenAfterFailure) {
            facts.push('same_layer_hidden_after_failure', 'final_layer_hidden');
        }
        if (finalLayerTransparentAfterFailure) {
            facts.push('same_layer_zero_opacity_after_failure', 'final_layer_fully_transparent');
        }
        if (finalLayerOutsideCanvasAfterFailure) {
            facts.push('same_layer_moved_after_failure', 'final_layer_outside_canvas');
        }

        seenLayerIds.add(failedClear.layerId);
        concerns.push({
            kind,
            evidenceId: buildLayerConcernEvidenceId(kind, documentId, failedClear.layerId),
            status: 'needs_review',
            summary: concealedAfterFailure
                ? '同一文字图层清空失败后内容仍保留，随后被隐藏、设为全透明或移出画布；需由设计评价确认它是有意备份还是未完成遗留。'
                : '同一文字图层清空失败后仍继续修改样式，最终非空内容保持可见；需由设计评价确认它是否仍承担明确作用。',
            layerRef: {
                documentId,
                id: failedClear.layerId,
                kind: 'text'
            },
            facts,
            measurements: buildMeasurements({
                snapshot,
                layer: finalLayer,
                creation,
                ...(style ? { style } : {})
            })
        });
    }

    return concerns;
}

function buildCoverageConcern(
    coverage: DesignArtifactStructureCoverage,
    documentId: number | undefined
): DesignArtifactStructureConcern | undefined {
    if (coverage.status === 'complete') return undefined;
    const facts: DesignArtifactStructureConcernFact[] = [];
    if (coverage.status === 'unavailable') {
        facts.push('structure_snapshot_unavailable');
    } else if (coverage.reasonCodes.some((reason) => (
        reason !== 'tool_layer_identity_unavailable'
        && reason !== 'concern_list_truncated'
    ))) {
        facts.push('structure_snapshot_incomplete');
    }
    if (coverage.reasonCodes.includes('tool_layer_identity_unavailable')) {
        facts.push('tool_layer_identity_unavailable');
    }
    if (coverage.reasonCodes.includes('concern_list_truncated')) {
        facts.push('structure_concern_report_truncated');
    }
    return {
        kind: 'structure-observation-incomplete',
        evidenceId: buildCoverageConcernEvidenceId(coverage, documentId),
        status: 'needs_review',
        summary: '最终结构证据覆盖不完整：可能存在未绑定到 Host 图层身份或未进入有界报告的关系，不能据此断言不存在其他结构问题。',
        facts,
        measurements: {
            observedLayerCount: coverage.observedLayerCount,
            ...(coverage.reportedLayerCount !== undefined
                ? { reportedLayerCount: coverage.reportedLayerCount }
                : {}),
            detectedConcernCount: coverage.detectedConcernCount,
            reportedConcernCount: coverage.reportedConcernCount,
            unresolvedLayerIdentityCount: coverage.unresolvedLayerIdentityCount
        }
    };
}

function finalizeCoverage(input: {
    base: DesignArtifactStructureCoverage;
    detectedConcernCount: number;
    unresolvedLayerIdentityCount: number;
}): DesignArtifactStructureCoverage {
    const reasonCodes = [...input.base.reasonCodes];
    if (input.unresolvedLayerIdentityCount > 0) {
        addCoverageReason(reasonCodes, 'tool_layer_identity_unavailable');
    }

    let status = input.base.status;
    if (status === 'complete' && input.unresolvedLayerIdentityCount > 0) status = 'incomplete';
    const initialCoverageConcernCount = status === 'complete' ? 0 : 1;
    const concernsTruncated = input.detectedConcernCount + initialCoverageConcernCount > MAX_CONCERNS;
    if (concernsTruncated) {
        addCoverageReason(reasonCodes, 'concern_list_truncated');
        if (status === 'complete') status = 'incomplete';
    }
    const availableIssueSlots = status === 'complete' ? MAX_CONCERNS : MAX_CONCERNS - 1;
    return {
        ...input.base,
        status,
        detectedConcernCount: input.detectedConcernCount,
        reportedConcernCount: Math.min(input.detectedConcernCount, availableIssueSlots),
        unresolvedLayerIdentityCount: input.unresolvedLayerIdentityCount,
        concernsTruncated,
        reasonCodes
    };
}

/**
 * 关联工具时序与最终结构快照，产出只读 concern。concern 只要求 Judge 解释，
 * 不自动删除、隐藏、缩放图层，也不改变唯一 DesignVerdict owner。
 */
export function detectDesignArtifactStructureConcerns(
    input: DetectDesignArtifactStructureConcernsInput
): DesignArtifactStructureConcernReport {
    const toolCallLog = Array.isArray(input.toolCallLog) ? input.toolCallLog : [];
    const snapshot = resolveFinalAcceptanceSnapshot({ ...input, toolCallLog });
    const baseCoverage = buildCoverage(snapshot);
    const documentId = readSnapshotDocumentId(snapshot);
    const detectedConcerns = snapshot && documentId !== undefined && baseCoverage.status !== 'unavailable'
        ? detectFailedClearTextConcerns(toolCallLog, snapshot, documentId)
        : [];
    const unresolvedLayerIdentityCount = countUnresolvedLayerIdentities(toolCallLog, documentId);
    const coverage = finalizeCoverage({
        base: baseCoverage,
        detectedConcernCount: detectedConcerns.length,
        unresolvedLayerIdentityCount
    });
    const concerns: DesignArtifactStructureConcern[] = [];
    const coverageConcern = buildCoverageConcern(coverage, documentId);
    if (coverageConcern) concerns.push(coverageConcern);
    concerns.push(...detectedConcerns.slice(0, coverage.reportedConcernCount));

    return {
        version: DESIGN_ARTIFACT_STRUCTURE_CONCERNS_VERSION,
        coverage,
        concerns,
        boundaries: {
            observationOnly: true,
            doesNotMutateDocument: true,
            doesNotChooseDesignOutcome: true,
            requiresJudgeInterpretation: true,
            rawToolPayloadExcluded: true,
            filesystemPathsExcluded: true
        }
    };
}
