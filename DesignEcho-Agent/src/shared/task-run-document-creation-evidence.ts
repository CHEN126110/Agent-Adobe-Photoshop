import { validateRuntimeSessionIdentity, type RuntimeSessionIdentity } from './agent-runtime-v5/runtime-session';
import { hasVerifiedEditableDocumentArtifact } from './agent-runtime-v5/runtime-delivery-receipt';
import {
    readDirectObservedPhotoshopMutationProof,
    readPhotoshopMutationCommit,
    readPhotoshopSourceHistoryStateRef,
    samePhotoshopHistoryStateRef,
    type PhotoshopHistoryStateRef
} from './photoshop-history-state-ref';

export const TASK_RUN_DOCUMENT_CREATION_EVIDENCE_VERSION =
    'task-run-document-creation-evidence/v1' as const;

export interface TaskRunDocumentCreationRecord {
    documentId: number;
    creationHistoryStateId: number;
    latestHistoryStateId: number;
    sourceRunId: string;
    sourceGeneration: number;
    rasterDeliveredAtLatestRevision: boolean;
    editableDeliveredAtLatestRevision: boolean;
    explicitlyClosed: boolean;
}

export interface TaskRunDocumentCreationEvidence {
    version: typeof TASK_RUN_DOCUMENT_CREATION_EVIDENCE_VERSION;
    taskRunId: string;
    createdDocuments: readonly TaskRunDocumentCreationRecord[];
    boundaries: {
        runtimeOwned: true;
        hostMutationProofOnly: true;
        sameTaskRunOnly: true;
        sameTargetDocumentRequired: true;
        latestRevisionTracked: true;
        partialDeliveryReceiptsTracked: true;
        exactDocumentCloseRequired: true;
        containsDocumentName: false;
        containsAssistantText: false;
        grantsPermission: false;
        changesQualityVerdict: false;
    };
}

export interface TaskRunDocumentCreationToolLogEntry {
    name?: unknown;
    arguments?: unknown;
    result?: any;
}

export interface TaskRunCreatedDocumentDeliveryRequirement {
    rasterRequired: boolean;
    editableRequired: boolean;
}

export type TaskRunCreatedDocumentSettlementStatus =
    | 'delivered'
    | 'closed'
    | 'unsettled';

export interface TaskRunCreatedDocumentLifecycleItem {
    documentId: number;
    latestHistoryStateRef: PhotoshopHistoryStateRef;
    rasterDelivered: boolean;
    editableDelivered: boolean;
    explicitlyClosed: boolean;
    status: TaskRunCreatedDocumentSettlementStatus;
}

export interface TaskRunCreatedDocumentLifecycleProjection {
    createdDocumentCount: number;
    deliveredDocumentCount: number;
    closedDocumentCount: number;
    settledDocumentCount: number;
    unsettledDocumentCount: number;
    unsettledDocumentIds: number[];
    documents: TaskRunCreatedDocumentLifecycleItem[];
    deliveryRequirement: TaskRunCreatedDocumentDeliveryRequirement;
    boundaries: {
        currentTaskRunOnly: true;
        exactDocumentRevisionRequired: true;
        explicitCloseResultRequired: true;
        filesystemScanUsed: false;
        assistantTextUsed: false;
        grantsPermission: false;
        executesTools: false;
        changesQualityVerdict: false;
    };
}

const DOCUMENT_SAVE_TOOLS = new Set([
    'saveDocument',
    'quickExport',
    'exportDetailPageSlices',
    'exportMainImageDocuments'
]);

const trustedEvidence = new WeakSet<object>();

function isRecord(value: unknown): value is Record<string, any> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readPositiveInteger(value: unknown): number | undefined {
    const numeric = typeof value === 'number'
        ? value
        : (typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : Number.NaN);
    return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : undefined;
}

function toolSucceeded(entry: TaskRunDocumentCreationToolLogEntry): boolean {
    return entry.result?.success !== false
        && entry.result?.policyGate !== true
        && entry.result?.safetyBlock !== true;
}

function collectDeliveryFormats(entry: TaskRunDocumentCreationToolLogEntry): string[] {
    const args = isRecord(entry.arguments) ? entry.arguments : {};
    const result = isRecord(entry.result) ? entry.result : {};
    const values: unknown[] = [
        args.format,
        result.format,
        result.outputFormat,
        result.saveFormat
    ];
    const paths: unknown[] = [
        args.outputPath,
        args.savePath,
        result.outputPath,
        result.savePath,
        result.filePath,
        result.savedPath,
        ...(Array.isArray(result.exportedFiles) ? result.exportedFiles : [])
    ];
    for (const pathValue of paths) {
        const match = String(pathValue || '').match(/\.([a-z0-9]+)(?:$|[?#])/i);
        if (match?.[1]) values.push(match[1]);
    }
    return values.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
}

function isRasterDeliveryEntry(entry: TaskRunDocumentCreationToolLogEntry): boolean {
    const name = String(entry.name || '').trim();
    if (!DOCUMENT_SAVE_TOOLS.has(name) || !toolSucceeded(entry)) return false;
    if (name === 'quickExport' || name === 'exportDetailPageSlices') return true;
    return collectDeliveryFormats(entry).some((format) => (
        /^(?:jpg|jpeg|png|webp|gif|tif|tiff)$/.test(format)
    ));
}

function isEditableDeliveryEntry(entry: TaskRunDocumentCreationToolLogEntry): boolean {
    const name = String(entry.name || '').trim();
    if (!DOCUMENT_SAVE_TOOLS.has(name) || !toolSucceeded(entry)) return false;
    const result = isRecord(entry.result) ? entry.result : {};
    const resultRecords = [result, result.data]
        .filter((value): value is Record<string, unknown> => isRecord(value));
    if (resultRecords.some(hasVerifiedEditableDocumentArtifact)) return true;
    return resultRecords.some((record) => [
        record.savedPath,
        record.filePath,
        record.outputPath
    ].some((value) => /\.(?:psd|psb)(?:$|[?#])/i.test(String(value || '').trim())));
}

function readExactClosedDocumentId(
    entry: TaskRunDocumentCreationToolLogEntry
): number | undefined {
    if (String(entry.name || '').trim() !== 'closeDocument'
        || entry.result?.success !== true
        || entry.result?.policyGate === true
        || entry.result?.safetyBlock === true) {
        return undefined;
    }
    const args = isRecord(entry.arguments) ? entry.arguments : {};
    const requestedDocumentId = readPositiveInteger(args.documentId);
    if (requestedDocumentId === undefined) return undefined;
    const result = isRecord(entry.result) ? entry.result : {};
    const data = isRecord(result.data) ? result.data : {};
    const returnedDocumentId = readPositiveInteger(
        result.closedDocumentId ?? data.closedDocumentId
    );
    if (returnedDocumentId !== undefined && returnedDocumentId !== requestedDocumentId) {
        return undefined;
    }
    const closedDocument = String(result.closedDocument || data.closedDocument || '').trim();
    return returnedDocumentId !== undefined || closedDocument
        ? requestedDocumentId
        : undefined;
}

function readTrustedEvidence(
    value: TaskRunDocumentCreationEvidence | undefined
): TaskRunDocumentCreationEvidence | undefined {
    if (!value
        || value.version !== TASK_RUN_DOCUMENT_CREATION_EVIDENCE_VERSION
        || !trustedEvidence.has(value)
        || !value.taskRunId
        || !Array.isArray(value.createdDocuments)) {
        return undefined;
    }
    return value;
}

function cloneRecord(record: TaskRunDocumentCreationRecord): TaskRunDocumentCreationRecord {
    return { ...record };
}

function resetSettlementForRevision(
    record: TaskRunDocumentCreationRecord,
    historyStateId: number
): void {
    record.latestHistoryStateId = historyStateId;
    record.rasterDeliveredAtLatestRevision = false;
    record.editableDeliveredAtLatestRevision = false;
    record.explicitlyClosed = false;
}

function collectTaskRunCreationRecords(input: {
    previous?: TaskRunDocumentCreationEvidence;
    taskRunId?: string;
    generation: number;
    sourceRunId: string;
    toolCallLog: readonly TaskRunDocumentCreationToolLogEntry[];
}): TaskRunDocumentCreationRecord[] {
    const previous = readTrustedEvidence(input.previous);
    const acceptsPrevious = Boolean(
        previous
        && previous.taskRunId === String(input.taskRunId || '').trim()
    );
    const byDocumentId = new Map<number, TaskRunDocumentCreationRecord>();
    for (const record of acceptsPrevious ? previous!.createdDocuments : []) {
        if (record.sourceGeneration > input.generation) continue;
        byDocumentId.set(record.documentId, cloneRecord(record));
    }

    for (const entry of Array.isArray(input.toolCallLog) ? input.toolCallLog : []) {
        const proof = readDirectObservedPhotoshopMutationProof(entry.result);
        const commit = readPhotoshopMutationCommit(entry.result);
        const creationHistoryStateRef = commit?.changeKind === 'document_creation'
            ? commit.after
            : undefined;
        if (creationHistoryStateRef) {
            const documentId = creationHistoryStateRef.documentId;
            if (!byDocumentId.has(documentId)) {
                byDocumentId.set(documentId, {
                    documentId,
                    creationHistoryStateId: creationHistoryStateRef.historyStateId,
                    latestHistoryStateId: creationHistoryStateRef.historyStateId,
                    sourceRunId: input.sourceRunId,
                    sourceGeneration: input.generation,
                    rasterDeliveredAtLatestRevision: false,
                    editableDeliveredAtLatestRevision: false,
                    explicitlyClosed: false
                });
            }
        }

        if (proof?.after) {
            const record = byDocumentId.get(proof.after.documentId);
            if (record && record.latestHistoryStateId !== proof.after.historyStateId) {
                resetSettlementForRevision(record, proof.after.historyStateId);
            }
        }

        const sourceHistoryStateRef = readPhotoshopSourceHistoryStateRef(entry.result);
        if (sourceHistoryStateRef) {
            const record = byDocumentId.get(sourceHistoryStateRef.documentId);
            const latestHistoryStateRef = record
                ? {
                    documentId: record.documentId,
                    historyStateId: record.latestHistoryStateId
                }
                : undefined;
            if (record && samePhotoshopHistoryStateRef(sourceHistoryStateRef, latestHistoryStateRef)) {
                if (isRasterDeliveryEntry(entry)) {
                    record.rasterDeliveredAtLatestRevision = true;
                }
                if (isEditableDeliveryEntry(entry)) {
                    record.editableDeliveredAtLatestRevision = true;
                }
            }
        }

        const closedDocumentId = readExactClosedDocumentId(entry);
        const closedRecord = closedDocumentId !== undefined
            ? byDocumentId.get(closedDocumentId)
            : undefined;
        if (closedRecord) closedRecord.explicitlyClosed = true;
    }

    return Array.from(byDocumentId.values()).sort((left, right) => (
        left.sourceGeneration - right.sourceGeneration
        || left.documentId - right.documentId
    ));
}

function freezeEvidence(input: {
    taskRunId: string;
    records: readonly TaskRunDocumentCreationRecord[];
}): TaskRunDocumentCreationEvidence {
    const evidence: TaskRunDocumentCreationEvidence = Object.freeze({
        version: TASK_RUN_DOCUMENT_CREATION_EVIDENCE_VERSION,
        taskRunId: input.taskRunId,
        createdDocuments: Object.freeze(input.records.map((record) => (
            Object.freeze({ ...record })
        ))),
        boundaries: Object.freeze({
            runtimeOwned: true,
            hostMutationProofOnly: true,
            sameTaskRunOnly: true,
            sameTargetDocumentRequired: true,
            latestRevisionTracked: true,
            partialDeliveryReceiptsTracked: true,
            exactDocumentCloseRequired: true,
            containsDocumentName: false,
            containsAssistantText: false,
            grantsPermission: false,
            changesQualityVerdict: false
        })
    });
    trustedEvidence.add(evidence);
    return evidence;
}

/**
 * 把同一授权 TaskRun 已发生的文档创建与结算事实带到下一 Reflexion generation。
 *
 * 事实只来自 Host mutation proof、带源 revision 的保存 /导出结果和精确 documentId
 * 的成功关闭结果。Run Record、项目记忆、文件名和助手文本都不能创建或恢复这份
 * 内存收据；Renderer 重载后收据失效并保持 fail closed。
 */
export function extendTaskRunDocumentCreationEvidence(input: {
    previous?: TaskRunDocumentCreationEvidence;
    identity: RuntimeSessionIdentity;
    toolCallLog: readonly TaskRunDocumentCreationToolLogEntry[];
}): TaskRunDocumentCreationEvidence | undefined {
    const validation = validateRuntimeSessionIdentity(input.identity);
    if (!validation.ok) return undefined;
    const taskRunId = input.identity.sessionId;
    const records = collectTaskRunCreationRecords({
        previous: input.previous,
        taskRunId,
        generation: input.identity.generation,
        sourceRunId: input.identity.runId,
        toolCallLog: input.toolCallLog
    });
    if (records.length === 0) return undefined;
    return freezeEvidence({ taskRunId, records });
}

/**
 * 对当前 generation 的有序 Tool 结果和上一代可信内存收据做只读投影。
 * required delivery 由 Task / Manifest owner 传入；本模块不从品类、路径或文案推断。
 */
export function projectTaskRunCreatedDocumentLifecycle(input: {
    previous?: TaskRunDocumentCreationEvidence;
    taskRunId?: string;
    generation?: number;
    toolCallLog: readonly TaskRunDocumentCreationToolLogEntry[];
    deliveryRequirement: TaskRunCreatedDocumentDeliveryRequirement;
}): TaskRunCreatedDocumentLifecycleProjection {
    const generation = Number.isSafeInteger(Number(input.generation))
        ? Math.max(0, Number(input.generation))
        : 0;
    const records = collectTaskRunCreationRecords({
        previous: input.previous,
        taskRunId: input.taskRunId,
        generation,
        sourceRunId: 'current-generation',
        toolCallLog: input.toolCallLog
    });
    const requirement = {
        rasterRequired: input.deliveryRequirement.rasterRequired === true,
        editableRequired: input.deliveryRequirement.editableRequired === true
    };
    const documents = records.map((record): TaskRunCreatedDocumentLifecycleItem => {
        const hasDeliveryRequirement = requirement.rasterRequired || requirement.editableRequired;
        const delivered = hasDeliveryRequirement
            && (!requirement.rasterRequired || record.rasterDeliveredAtLatestRevision)
            && (!requirement.editableRequired || record.editableDeliveredAtLatestRevision);
        const status: TaskRunCreatedDocumentSettlementStatus = record.explicitlyClosed
            ? 'closed'
            : (delivered ? 'delivered' : 'unsettled');
        return {
            documentId: record.documentId,
            latestHistoryStateRef: {
                documentId: record.documentId,
                historyStateId: record.latestHistoryStateId
            },
            rasterDelivered: record.rasterDeliveredAtLatestRevision,
            editableDelivered: record.editableDeliveredAtLatestRevision,
            explicitlyClosed: record.explicitlyClosed,
            status
        };
    });
    const deliveredDocumentCount = documents.filter((item) => item.status === 'delivered').length;
    const closedDocumentCount = documents.filter((item) => item.status === 'closed').length;
    const unsettledDocumentIds = documents
        .filter((item) => item.status === 'unsettled')
        .map((item) => item.documentId);
    return {
        createdDocumentCount: documents.length,
        deliveredDocumentCount,
        closedDocumentCount,
        settledDocumentCount: deliveredDocumentCount + closedDocumentCount,
        unsettledDocumentCount: unsettledDocumentIds.length,
        unsettledDocumentIds,
        documents,
        deliveryRequirement: requirement,
        boundaries: {
            currentTaskRunOnly: true,
            exactDocumentRevisionRequired: true,
            explicitCloseResultRequired: true,
            filesystemScanUsed: false,
            assistantTextUsed: false,
            grantsPermission: false,
            executesTools: false,
            changesQualityVerdict: false
        }
    };
}

/** 只统计当前 TaskRun、当前或更早 generation、且与子运行写入目标相同的创建事实。 */
export function countTaskRunCreatedDocumentsForTarget(input: {
    evidence?: TaskRunDocumentCreationEvidence;
    taskRunId?: string;
    generation?: number;
    targetDocumentId?: number;
}): number {
    const evidence = readTrustedEvidence(input.evidence);
    const generation = Number(input.generation);
    const targetDocumentId = Number(input.targetDocumentId);
    if (!evidence
        || evidence.taskRunId !== String(input.taskRunId || '').trim()
        || !Number.isSafeInteger(generation)
        || generation < 0
        || !Number.isSafeInteger(targetDocumentId)
        || targetDocumentId <= 0) {
        return 0;
    }
    return evidence.createdDocuments.some((record) => (
        record.documentId === targetDocumentId
        && record.sourceGeneration <= generation
    )) ? 1 : 0;
}
