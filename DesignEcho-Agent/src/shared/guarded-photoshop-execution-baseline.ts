import {
    debugBridgePhotoshopRuntimeLiveIdentitiesMatch,
    readDebugBridgePhotoshopRuntimeBinding,
    readDebugBridgePhotoshopRuntimeLiveIdentity,
    type DebugBridgePhotoshopRuntimeBinding,
    type DebugBridgePhotoshopRuntimeLiveIdentity
} from './debug-bridge-chat';

export const GUARDED_PHOTOSHOP_EXECUTION_BASELINE_VERSION =
    'guarded-photoshop-execution-baseline/v0' as const;

export const GUARDED_PHOTOSHOP_EXECUTION_BASELINE_RECEIPT_VERSION =
    'guarded-photoshop-execution-baseline-receipt/v0' as const;

export type GuardedPhotoshopExecutionBaselineState =
    | 'pending'
    | 'checking'
    | 'passed'
    | 'blocked';

/**
 * 首写基线的文档策略。
 *
 * none_open：写前必须零打开文档（既有隔离基线，缺省）。
 * external_dirty_document_open：写前必须**恰好**打开一个文档，且它就是提交时冻结的
 * 外部脏文档——用来证明任务在"别人的文档还开着"时仍只往自己的文档写。
 */
export type GuardedPhotoshopDocumentPolicy = 'none_open' | 'external_dirty_document_open';

/** 提交时冻结的外部文档身份。history 身份不变 = 文档未被触碰。 */
export interface GuardedExternalDocumentIdentity {
    documentId: number;
    name: string;
    activeHistoryStateId: number;
    historyStateCount: number;
}

export interface GuardedPhotoshopExecutionBaseline {
    version: typeof GUARDED_PHOTOSHOP_EXECUTION_BASELINE_VERSION;
    requestId: string;
    requireNoOpenDocuments: boolean;
    documentPolicy: GuardedPhotoshopDocumentPolicy;
    externalDocument?: GuardedExternalDocumentIdentity;
    expectedPhotoshopRuntimeBuildId: string;
    expectedPhotoshopRuntimeBinding: DebugBridgePhotoshopRuntimeBinding;
    state: GuardedPhotoshopExecutionBaselineState;
    firstMutationToolName?: string;
    checkedAt?: string;
    openDocumentCount?: number;
    externalDocumentIdAtFirstMutation?: number;
    observedPhotoshopRuntimeBuildId?: string;
    observedPhotoshopRuntimeIdentity?: DebugBridgePhotoshopRuntimeLiveIdentity;
    error?: string;
    checkPromise?: Promise<GuardedPhotoshopExecutionBaselineDecision>;
}

export interface GuardedPhotoshopExecutionBaselineReceipt {
    version: typeof GUARDED_PHOTOSHOP_EXECUTION_BASELINE_RECEIPT_VERSION;
    status: 'not_reached' | 'checking' | 'passed' | 'blocked';
    requestId: string;
    documentPolicy: GuardedPhotoshopDocumentPolicy;
    externalDocument?: GuardedExternalDocumentIdentity;
    expectedPhotoshopRuntimeBuildId: string;
    expectedPhotoshopRuntimeBinding: DebugBridgePhotoshopRuntimeBinding;
    firstMutationToolName?: string;
    checkedAt?: string;
    openDocumentCount?: number;
    externalDocumentIdAtFirstMutation?: number;
    observedPhotoshopRuntimeBuildId?: string;
    observedPhotoshopRuntimeIdentity?: DebugBridgePhotoshopRuntimeLiveIdentity;
    error?: string;
}

export interface GuardedPhotoshopExecutionBaselineDecision {
    ready: boolean;
    receipt: GuardedPhotoshopExecutionBaselineReceipt;
    error?: string;
}

export interface GuardedPhotoshopExecutionBaselineObservers {
    observePhotoshopRuntimeIdentity: () => Promise<DebugBridgePhotoshopRuntimeLiveIdentity | undefined>;
    observeOpenDocumentCount: () => Promise<number | undefined>;
    /** external_dirty_document_open 策略必需：返回当前打开文档的 id 列表（保序不要求）。 */
    observeOpenDocumentIds?: () => Promise<number[] | undefined>;
    now?: () => string;
}

function cleanString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function blockBaseline(
    baseline: GuardedPhotoshopExecutionBaseline,
    error: string,
    now: () => string
): GuardedPhotoshopExecutionBaselineDecision {
    baseline.state = 'blocked';
    baseline.checkedAt = baseline.checkedAt || now();
    baseline.error = error;
    return {
        ready: false,
        receipt: readGuardedPhotoshopExecutionBaselineReceipt(baseline),
        error
    };
}

export function readGuardedExternalDocumentIdentity(
    value: unknown
): GuardedExternalDocumentIdentity | undefined {
    const record = value as Partial<GuardedExternalDocumentIdentity> | null | undefined;
    const documentId = Number(record?.documentId);
    const name = cleanString(record?.name);
    const activeHistoryStateId = Number(record?.activeHistoryStateId);
    const historyStateCount = Number(record?.historyStateCount);
    if (!Number.isSafeInteger(documentId) || documentId <= 0) return undefined;
    if (!name) return undefined;
    if (!Number.isSafeInteger(activeHistoryStateId) || activeHistoryStateId <= 0) return undefined;
    if (!Number.isSafeInteger(historyStateCount) || historyStateCount < 0) return undefined;
    return { documentId, name, activeHistoryStateId, historyStateCount };
}

export function createGuardedPhotoshopExecutionBaseline(input: {
    requestId: string;
    expectedPhotoshopRuntimeBuildId: string;
    expectedPhotoshopRuntimeBinding: DebugBridgePhotoshopRuntimeBinding;
    documentPolicy?: GuardedPhotoshopDocumentPolicy;
    externalDocument?: GuardedExternalDocumentIdentity;
}): GuardedPhotoshopExecutionBaseline {
    const requestId = cleanString(input.requestId);
    const expectedPhotoshopRuntimeBuildId = cleanString(input.expectedPhotoshopRuntimeBuildId);
    const expectedPhotoshopRuntimeBinding = readDebugBridgePhotoshopRuntimeBinding(
        input.expectedPhotoshopRuntimeBinding
    );
    if (!requestId
        || !expectedPhotoshopRuntimeBuildId
        || !expectedPhotoshopRuntimeBinding
        || expectedPhotoshopRuntimeBinding.live.buildId !== expectedPhotoshopRuntimeBuildId) {
        throw new Error('受控 Photoshop 执行基线缺少 requestId 或 Photoshop Runtime 完整身份。');
    }
    const documentPolicy: GuardedPhotoshopDocumentPolicy = input.documentPolicy
        ?? 'none_open';
    if (documentPolicy !== 'none_open' && documentPolicy !== 'external_dirty_document_open') {
        throw new Error(`受控 Photoshop 执行基线不认识文档策略 ${String(documentPolicy)}。`);
    }
    const externalDocument = documentPolicy === 'external_dirty_document_open'
        ? readGuardedExternalDocumentIdentity(input.externalDocument)
        : undefined;
    if (documentPolicy === 'external_dirty_document_open' && !externalDocument) {
        throw new Error('external_dirty_document_open 基线必须携带完整的外部文档冻结身份。');
    }
    return {
        version: GUARDED_PHOTOSHOP_EXECUTION_BASELINE_VERSION,
        requestId,
        requireNoOpenDocuments: documentPolicy === 'none_open',
        documentPolicy,
        ...(externalDocument ? { externalDocument } : {}),
        expectedPhotoshopRuntimeBuildId,
        expectedPhotoshopRuntimeBinding,
        state: 'pending'
    };
}

export function readGuardedPhotoshopExecutionBaselineReceipt(
    baseline: GuardedPhotoshopExecutionBaseline
): GuardedPhotoshopExecutionBaselineReceipt {
    const status = baseline.state === 'pending'
        ? 'not_reached'
        : baseline.state;
    return Object.freeze({
        version: GUARDED_PHOTOSHOP_EXECUTION_BASELINE_RECEIPT_VERSION,
        status,
        requestId: baseline.requestId,
        documentPolicy: baseline.documentPolicy,
        ...(baseline.externalDocument ? { externalDocument: baseline.externalDocument } : {}),
        expectedPhotoshopRuntimeBuildId: baseline.expectedPhotoshopRuntimeBuildId,
        expectedPhotoshopRuntimeBinding: baseline.expectedPhotoshopRuntimeBinding,
        ...(baseline.firstMutationToolName
            ? { firstMutationToolName: baseline.firstMutationToolName }
            : {}),
        ...(baseline.checkedAt ? { checkedAt: baseline.checkedAt } : {}),
        ...(Number.isSafeInteger(baseline.openDocumentCount)
            ? { openDocumentCount: baseline.openDocumentCount }
            : {}),
        ...(Number.isSafeInteger(baseline.externalDocumentIdAtFirstMutation)
            ? { externalDocumentIdAtFirstMutation: baseline.externalDocumentIdAtFirstMutation }
            : {}),
        ...(baseline.observedPhotoshopRuntimeBuildId
            ? { observedPhotoshopRuntimeBuildId: baseline.observedPhotoshopRuntimeBuildId }
            : {}),
        ...(baseline.observedPhotoshopRuntimeIdentity
            ? { observedPhotoshopRuntimeIdentity: baseline.observedPhotoshopRuntimeIdentity }
            : {}),
        ...(baseline.error ? { error: baseline.error } : {})
    });
}

export async function enforceGuardedPhotoshopExecutionBaseline(
    baseline: GuardedPhotoshopExecutionBaseline,
    firstMutationToolName: string,
    observers: GuardedPhotoshopExecutionBaselineObservers
): Promise<GuardedPhotoshopExecutionBaselineDecision> {
    if (baseline.state === 'passed') {
        return {
            ready: true,
            receipt: readGuardedPhotoshopExecutionBaselineReceipt(baseline)
        };
    }
    if (baseline.state === 'blocked') {
        return {
            ready: false,
            receipt: readGuardedPhotoshopExecutionBaselineReceipt(baseline),
            error: baseline.error || '受控 Photoshop 执行基线已经阻断本轮写入。'
        };
    }
    if (baseline.checkPromise) return baseline.checkPromise;

    const now = observers.now || (() => new Date().toISOString());
    baseline.state = 'checking';
    baseline.firstMutationToolName = cleanString(firstMutationToolName) || 'unknown';
    baseline.checkPromise = (async (): Promise<GuardedPhotoshopExecutionBaselineDecision> => {
        try {
            const observedRuntimeIdentity = readDebugBridgePhotoshopRuntimeLiveIdentity(
                await observers.observePhotoshopRuntimeIdentity()
            );
            const observedBuildId = cleanString(observedRuntimeIdentity?.buildId);
            baseline.observedPhotoshopRuntimeBuildId = observedBuildId || undefined;
            baseline.observedPhotoshopRuntimeIdentity = observedRuntimeIdentity;
            if (!observedRuntimeIdentity) {
                return blockBaseline(
                    baseline,
                    '首次 Photoshop 写入前无法读取 Photoshop Runtime Build 身份。',
                    now
                );
            }
            if (!debugBridgePhotoshopRuntimeLiveIdentitiesMatch(
                observedRuntimeIdentity,
                baseline.expectedPhotoshopRuntimeBinding.live
            )) {
                return blockBaseline(
                    baseline,
                    `首次 Photoshop 写入前 Runtime 完整身份已变化（期望 ${baseline.expectedPhotoshopRuntimeBuildId}，实际 ${observedBuildId}）。`,
                    now
                );
            }

            // 文档列表必须是最后一项观察，让文档基线事实尽可能贴近真实 mutation dispatch。
            if (baseline.documentPolicy === 'external_dirty_document_open') {
                const externalDocument = baseline.externalDocument;
                if (!externalDocument) {
                    return blockBaseline(
                        baseline,
                        'external_dirty_document_open 基线缺少冻结的外部文档身份。',
                        now
                    );
                }
                if (typeof observers.observeOpenDocumentIds !== 'function') {
                    return blockBaseline(
                        baseline,
                        'external_dirty_document_open 基线需要能读取文档 id 列表的观察者。',
                        now
                    );
                }
                const openDocumentIds = await observers.observeOpenDocumentIds();
                if (!Array.isArray(openDocumentIds)
                    || openDocumentIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
                    return blockBaseline(
                        baseline,
                        '首次 Photoshop 写入前无法可靠读取当前文档 id 列表。',
                        now
                    );
                }
                baseline.openDocumentCount = openDocumentIds.length;
                if (openDocumentIds.length !== 1
                    || openDocumentIds[0] !== externalDocument.documentId) {
                    return blockBaseline(
                        baseline,
                        `首次 Photoshop 写入前的文档集合与冻结的外部文档不符（期望仅 ${externalDocument.documentId}，实际 [${openDocumentIds.join(', ')}]），本轮隔离写入已阻止。`,
                        now
                    );
                }
                baseline.externalDocumentIdAtFirstMutation = openDocumentIds[0];
            } else {
                const openDocumentCount = await observers.observeOpenDocumentCount();
                if (!Number.isSafeInteger(openDocumentCount) || Number(openDocumentCount) < 0) {
                    return blockBaseline(
                        baseline,
                        '首次 Photoshop 写入前无法可靠读取当前文档列表。',
                        now
                    );
                }
                baseline.openDocumentCount = Number(openDocumentCount);
                if (baseline.openDocumentCount !== 0) {
                    return blockBaseline(
                        baseline,
                        `首次 Photoshop 写入前发现 ${baseline.openDocumentCount} 个既有文档，本轮隔离写入已阻止。`,
                        now
                    );
                }
            }

            baseline.checkedAt = now();
            baseline.state = 'passed';
            return {
                ready: true,
                receipt: readGuardedPhotoshopExecutionBaselineReceipt(baseline)
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error || '未知错误');
            return blockBaseline(
                baseline,
                `首次 Photoshop 写入基线检查失败：${message}`,
                now
            );
        }
    })();
    return baseline.checkPromise;
}
