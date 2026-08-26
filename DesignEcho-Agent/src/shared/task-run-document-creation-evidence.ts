import type { RuntimeSessionIdentity } from './agent-runtime-v5/runtime-session';
import { validateRuntimeSessionIdentity } from './agent-runtime-v5/runtime-session';
import {
    readDirectObservedPhotoshopMutationProof,
    type PhotoshopHistoryStateRef
} from './photoshop-history-state-ref';

export const TASK_RUN_DOCUMENT_CREATION_EVIDENCE_VERSION =
    'task-run-document-creation-evidence/v0' as const;

export interface TaskRunDocumentCreationRecord {
    documentId: number;
    creationHistoryStateId: number;
    sourceRunId: string;
    sourceGeneration: number;
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
        containsDocumentName: false;
        containsAssistantText: false;
        grantsPermission: false;
        changesQualityVerdict: false;
    };
}

export interface TaskRunDocumentCreationToolLogEntry {
    name?: unknown;
    arguments?: unknown;
    result?: unknown;
}

const trustedEvidence = new WeakSet<object>();

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isExplicitDocumentCreation(
    entry: TaskRunDocumentCreationToolLogEntry,
    proof: ReturnType<typeof readDirectObservedPhotoshopMutationProof>
): boolean {
    const name = String(entry.name || '').trim();
    if (!proof) return false;
    if (name === 'createDocument') return proof.toolActionCompleted;
    if (name === 'composeDesign') {
        const args = isRecord(entry.arguments) ? entry.arguments : {};
        const document = isRecord(args.document) ? args.document : {};
        if (String(document.mode || '').trim() !== 'new') return false;
        const result = isRecord(entry.result) ? entry.result : {};
        const data = isRecord(result.data) ? result.data : {};
        return proof.toolActionCompleted || data.createdDocument === true;
    }
    if (name === 'layout-replication') {
        const result = isRecord(entry.result) ? entry.result : {};
        const data = isRecord(result.data) ? result.data : {};
        return proof.toolActionCompleted && data.createdDocument === true;
    }
    return false;
}

function collectCreationHistoryStateRefs(
    toolCallLog: readonly TaskRunDocumentCreationToolLogEntry[]
): PhotoshopHistoryStateRef[] {
    const byDocumentId = new Map<number, PhotoshopHistoryStateRef>();
    for (const entry of Array.isArray(toolCallLog) ? toolCallLog : []) {
        const proof = readDirectObservedPhotoshopMutationProof(entry.result);
        if (!isExplicitDocumentCreation(entry, proof)) continue;
        byDocumentId.set(proof!.after.documentId, { ...proof!.after });
    }
    return Array.from(byDocumentId.values());
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

/**
 * 把同一授权 TaskRun 已发生的文档创建事实带到下一 Reflexion generation。
 *
 * 事实只来自 Host mutation proof；Run Record、项目记忆、文档名和助手文本都不能
 * 创建或恢复这份内存收据。Renderer 重载后收据失效并保持 fail closed。
 */
export function extendTaskRunDocumentCreationEvidence(input: {
    previous?: TaskRunDocumentCreationEvidence;
    identity: RuntimeSessionIdentity;
    toolCallLog: readonly TaskRunDocumentCreationToolLogEntry[];
}): TaskRunDocumentCreationEvidence | undefined {
    const validation = validateRuntimeSessionIdentity(input.identity);
    if (!validation.ok) return undefined;
    const taskRunId = input.identity.sessionId;
    const previous = readTrustedEvidence(input.previous);
    const existing = previous?.taskRunId === taskRunId
        ? previous.createdDocuments
        : [];
    const created = collectCreationHistoryStateRefs(input.toolCallLog);
    if (existing.length === 0 && created.length === 0) return undefined;

    const byDocumentId = new Map<number, TaskRunDocumentCreationRecord>();
    for (const record of existing) {
        if (record.sourceGeneration > input.identity.generation) continue;
        byDocumentId.set(record.documentId, { ...record });
    }
    for (const historyStateRef of created) {
        if (byDocumentId.has(historyStateRef.documentId)) continue;
        byDocumentId.set(historyStateRef.documentId, {
            documentId: historyStateRef.documentId,
            creationHistoryStateId: historyStateRef.historyStateId,
            sourceRunId: input.identity.runId,
            sourceGeneration: input.identity.generation
        });
    }

    const evidence: TaskRunDocumentCreationEvidence = Object.freeze({
        version: TASK_RUN_DOCUMENT_CREATION_EVIDENCE_VERSION,
        taskRunId,
        createdDocuments: Object.freeze(Array.from(byDocumentId.values()).map((record) => (
            Object.freeze({ ...record })
        ))),
        boundaries: Object.freeze({
            runtimeOwned: true,
            hostMutationProofOnly: true,
            sameTaskRunOnly: true,
            sameTargetDocumentRequired: true,
            containsDocumentName: false,
            containsAssistantText: false,
            grantsPermission: false,
            changesQualityVerdict: false
        })
    });
    trustedEvidence.add(evidence);
    return evidence;
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
