import {
    buildAgentOperationDocumentTimeline,
    type AgentOperationDocumentTimeline
} from './agent-operation-document-timeline';
import { readRuntimeDeliveryReceipt } from './agent-runtime-v5/runtime-delivery-receipt';
import {
    readPhotoshopSourceHistoryStateRef,
    samePhotoshopHistoryStateRef,
    type PhotoshopHistoryStateRef
} from './photoshop-history-state-ref';

export interface RuntimeFinalArtifactToolLogEntry {
    callId?: string;
    name?: string;
    arguments?: unknown;
    result?: unknown;
    succeeded?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeRef(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function isSuccessfulEntry(entry: RuntimeFinalArtifactToolLogEntry): boolean {
    const result = isRecord(entry.result) ? entry.result : undefined;
    return entry.succeeded !== false && result?.success !== false;
}

function readResultRecords(value: unknown): Record<string, unknown>[] {
    if (!isRecord(value)) return [];
    return [value, ...(isRecord(value.data) ? [value.data] : [])];
}

function readSettlementRevision(value: unknown): PhotoshopHistoryStateRef | undefined {
    return readPhotoshopSourceHistoryStateRef(value)
        || readRuntimeDeliveryReceipt(value)?.sourceHistoryStateRef;
}

function resolveSingleFinalRevision(
    entries: readonly RuntimeFinalArtifactToolLogEntry[],
    finalResultRefs: ReadonlySet<string>
): PhotoshopHistoryStateRef | undefined {
    const matchedEntries = entries.filter((entry) => {
        const callId = normalizeRef(entry.callId);
        return Boolean(callId && finalResultRefs.has(callId) && isSuccessfulEntry(entry));
    });
    if (matchedEntries.length === 0) return undefined;
    const revisions = matchedEntries.map((entry) => readSettlementRevision(entry.result));
    if (revisions.some((revision) => !revision)) return undefined;
    const settledRevisions = revisions as PhotoshopHistoryStateRef[];
    const first = settledRevisions[0];
    if (!settledRevisions.every((revision) => samePhotoshopHistoryStateRef(first, revision))) {
        return undefined;
    }
    return first;
}

function buildArtifactTimeline(
    entries: readonly RuntimeFinalArtifactToolLogEntry[]
): AgentOperationDocumentTimeline {
    return buildAgentOperationDocumentTimeline(entries.map((entry) => {
        const receiptRevision = readRuntimeDeliveryReceipt(entry.result)?.sourceHistoryStateRef;
        const result = isRecord(entry.result) && receiptRevision
            ? { ...entry.result, activeDocumentId: receiptRevision.documentId }
            : entry.result;
        return {
            name: entry.name,
            arguments: entry.arguments,
            result,
            succeeded: entry.succeeded
        };
    }));
}

function findLatestMutationIndex(timeline: AgentOperationDocumentTimeline): number {
    for (let index = timeline.entries.length - 1; index >= 0; index -= 1) {
        if (timeline.entries[index]?.photoshopMutationObserved) return index;
    }
    return -1;
}

function hasMutationAfter(
    timeline: AgentOperationDocumentTimeline,
    index: number
): boolean {
    return timeline.entries.slice(index + 1).some((entry) => entry.photoshopMutationObserved);
}

function selectProducerReceiptIndex(input: {
    entries: readonly RuntimeFinalArtifactToolLogEntry[];
    timeline: AgentOperationDocumentTimeline;
    finalResultRefs: ReadonlySet<string>;
    producerReceiptCallRefs: ReadonlySet<string>;
    producerReceiptE2CallRefs: ReadonlySet<string>;
    finalRevision?: PhotoshopHistoryStateRef;
}): number | undefined {
    const latestMutationIndex = findLatestMutationIndex(input.timeline);
    const finalRefIndices = input.entries.flatMap((entry, index) => {
        const callId = normalizeRef(entry.callId);
        return callId && input.finalResultRefs.has(callId) && isSuccessfulEntry(entry)
            ? [index]
            : [];
    });
    const latestFinalRefIndex = finalRefIndices.length > 0
        ? Math.max(...finalRefIndices)
        : -1;
    // E2 resultRef 之后又发生 Photoshop mutation，说明这组 resultRef 已经不是最终版本。
    if (latestFinalRefIndex >= 0 && latestMutationIndex > latestFinalRefIndex) return undefined;
    for (let index = input.entries.length - 1; index >= 0; index -= 1) {
        const entry = input.entries[index];
        if (!entry || !isSuccessfulEntry(entry) || hasMutationAfter(input.timeline, index)) continue;
        const receipt = readRuntimeDeliveryReceipt(entry.result);
        if (receipt?.status !== 'ready' || receipt.artifacts.length === 0) continue;
        const callId = normalizeRef(entry.callId);
        const directlyBound = Boolean(callId && input.finalResultRefs.has(callId));
        if (directlyBound && receipt.settlementScope === 'single_document_revision') return index;
        if (!callId || !input.producerReceiptCallRefs.has(callId)) continue;
        const e2BoundCompositeProducer = input.producerReceiptE2CallRefs.has(callId);

        if (receipt.settlementScope === 'multi_document_task') {
            // 多文档批次无法伪装成单 revision，也不能与 Skill 之后任意一次 save/export
            // 拼接成“完整交付”。只能消费该生产 Skill 自己声明、并由同一 TaskRun E2
            // 精确绑定的 artifact 集；生产 Skill 还必须是最后一次内容 mutation。
            if (!e2BoundCompositeProducer || index !== latestMutationIndex) {
                continue;
            }
            return index;
        }

        // 复合单文档 Skill 的 resultRef 属于其内部执行账本，不会作为外层 callId 出现在
        // Agent Tool log。只有 E2 已按同目标、同 revision 和已复核预览通过，并把完整内部
        // ref 集精确绑定到这个外层 Skill call 时，才允许消费同一张 receipt 的 artifact 集。
        if (e2BoundCompositeProducer) return index;

        if (input.finalResultRefs.size > 0) {
            // 与后续原子保存/导出合并时，生产者必须声明并匹配同一最终 Host revision。
            if (!input.finalRevision
                || !samePhotoshopHistoryStateRef(receipt.sourceHistoryStateRef, input.finalRevision)) {
                continue;
            }
            return index;
        }

        // 没有 E2 resultRef 时，只允许本轮最后一个 mutation-producing Skill 的精确收据。
        // 这是显式调用资格，不是对任意历史 successful Tool 的扫描。
        if (index === latestMutationIndex) return index;
    }
    return undefined;
}

function collectReferencedResultPaths(
    value: unknown,
    addPath: (value: unknown) => void
): void {
    for (const record of readResultRecords(value)) {
        const editableArtifact = record.editableDocumentArtifact;
        if (isRecord(editableArtifact)) addPath(editableArtifact.path);
        addPath(record.savedPath);
        addPath(record.filePath);
        addPath(record.outputPath);
        for (const exportedFile of Array.isArray(record.exportedFiles) ? record.exportedFiles : []) {
            if (typeof exportedFile === 'string') {
                addPath(exportedFile);
            } else if (isRecord(exportedFile)) {
                addPath(exportedFile.filePath);
                addPath(exportedFile.path);
                addPath(exportedFile.outputPath);
            }
        }
        for (const screen of Array.isArray(record.screens) ? record.screens : []) {
            if (isRecord(screen)) addPath(screen.path);
        }
    }
}

/**
 * 从 E2 精确 resultRef 和一次已结算的复合生产者收据中收集最终文件事实。
 *
 * producerReceiptCallRefs 必须由调用方根据注册 Skill 身份显式签发；即使签发，单文档
 * 收据仍须匹配最终 revision，多文档收据仍须绑定最后一次 mutation 与 E2 精确 save/export；
 * 复合 Skill 的内部 resultRef 只能由 Agent 在 E2 验证通过后映射回同一个外层 call。
 * 旧收据或其后又发生 mutation 的收据都会失效。函数不递归扫描业务对象、不读取目录，
 * 也不把这些路径写入生产结果或完成/质量判断。
 */
export function collectRuntimeFinalArtifactPaths(input: {
    entries: readonly RuntimeFinalArtifactToolLogEntry[];
    resultRefs?: readonly string[];
    producerReceiptCallRefs?: readonly string[];
    /** E2 已把复合生产者声明的精确 save/export resultRefs 绑定到该外层 Skill call。 */
    producerReceiptE2CallRefs?: readonly string[];
    includeProducerReceipts: boolean;
}): string[] {
    const entries = Array.isArray(input.entries) ? input.entries : [];
    const finalResultRefs = new Set(
        (input.resultRefs || []).map(normalizeRef).filter(Boolean)
    );
    const producerReceiptCallRefs = new Set(
        (input.producerReceiptCallRefs || []).map(normalizeRef).filter(Boolean)
    );
    const producerReceiptE2CallRefs = new Set(
        (input.producerReceiptE2CallRefs || []).map(normalizeRef).filter(Boolean)
    );
    const timeline = buildArtifactTimeline(entries);
    const finalRevision = resolveSingleFinalRevision(entries, finalResultRefs);
    const producerReceiptIndex = input.includeProducerReceipts
        ? selectProducerReceiptIndex({
            entries,
            timeline,
            finalResultRefs,
            producerReceiptCallRefs,
            producerReceiptE2CallRefs,
            finalRevision
        })
        : undefined;
    const paths: string[] = [];
    const addPath = (value: unknown): void => {
        const normalized = typeof value === 'string' ? value.trim() : '';
        if (normalized && !paths.includes(normalized)) paths.push(normalized);
    };

    for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        if (!entry || !isSuccessfulEntry(entry)) continue;
        if (index === producerReceiptIndex) {
            const receipt = readRuntimeDeliveryReceipt(entry.result);
            for (const artifact of receipt?.artifacts || []) addPath(artifact.path);
        }
        const callId = normalizeRef(entry.callId);
        if (callId && finalResultRefs.has(callId)) {
            collectReferencedResultPaths(entry.result, addPath);
        }
    }
    return paths.slice(0, 96);
}
