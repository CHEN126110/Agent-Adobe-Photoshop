import {
    debugBridgePhotoshopRuntimeLiveIdentitiesMatch,
    readDebugBridgePhotoshopRuntimeBinding,
    readDebugBridgePhotoshopRuntimeLiveIdentity,
    type DebugBridgePhotoshopRuntimeBinding,
    type DebugBridgePhotoshopRuntimeLiveIdentity
} from './debug-bridge-chat';
import type {
    PhotoshopDocumentEditState,
    PhotoshopDocumentPathState,
    PhotoshopDocumentProjectAffinity
} from './photoshop-document-inventory';
import {
    samePhotoshopHistoryStateRef,
    type PhotoshopHistoryStateRef
} from './photoshop-history-state-ref';

export const GUARDED_PHOTOSHOP_EXECUTION_BASELINE_VERSION =
    'guarded-photoshop-execution-baseline/v2' as const;

export const GUARDED_PHOTOSHOP_EXECUTION_BASELINE_RECEIPT_VERSION =
    'guarded-photoshop-execution-baseline-receipt/v2' as const;

export interface GuardedPhotoshopDocumentFact {
    id: number;
    name: string;
    isActive: boolean;
    pathState: PhotoshopDocumentPathState;
    editState: PhotoshopDocumentEditState;
    projectAffinity: PhotoshopDocumentProjectAffinity;
    historyStateRef?: PhotoshopHistoryStateRef;
}

export interface GuardedPhotoshopDocumentAssessment {
    ready: boolean;
    openDocumentCount: number;
    openFixtureDocumentCount: number;
    openOutsideFixtureDocumentCount: number;
    unresolvedOwnershipDocumentCount: number;
    dirtyOutsideFixtureDocumentCount: number;
    preexistingDocumentRevisionsUnchanged: boolean;
    activeDocumentAffinity: PhotoshopDocumentProjectAffinity | 'absent';
    outsideDocumentIds: number[];
    protectedDocumentRefs: PhotoshopHistoryStateRef[];
    blocker?:
        | 'document_inventory_unavailable'
        | 'document_ownership_unresolved'
        | 'fixture_document_already_open'
        | 'fixture_document_opened_before_first_mutation'
        | 'new_outside_document_opened'
        | 'preexisting_document_missing'
        | 'preexisting_document_identity_changed'
        | 'preexisting_document_revision_changed'
        | 'first_mutation_must_create_task_document';
}

export type GuardedPhotoshopExecutionBaselineState =
    | 'pending'
    | 'checking'
    | 'passed'
    | 'blocked';

export interface GuardedPhotoshopExecutionBaseline {
    version: typeof GUARDED_PHOTOSHOP_EXECUTION_BASELINE_VERSION;
    requestId: string;
    documentPolicy: 'preserve_preexisting_documents';
    expectedProjectPath: string;
    initialDocuments: GuardedPhotoshopDocumentFact[];
    initialDocumentAssessment: GuardedPhotoshopDocumentAssessment;
    expectedPhotoshopRuntimeBuildId: string;
    expectedPhotoshopRuntimeBinding: DebugBridgePhotoshopRuntimeBinding;
    state: GuardedPhotoshopExecutionBaselineState;
    firstMutationToolName?: string;
    checkedAt?: string;
    openDocumentCount?: number;
    openFixtureDocumentCount?: number;
    openOutsideFixtureDocumentCount?: number;
    unresolvedOwnershipDocumentCount?: number;
    dirtyOutsideFixtureDocumentCount?: number;
    observedPhotoshopRuntimeBuildId?: string;
    observedPhotoshopRuntimeIdentity?: DebugBridgePhotoshopRuntimeLiveIdentity;
    error?: string;
    checkPromise?: Promise<GuardedPhotoshopExecutionBaselineDecision>;
    completionState: GuardedPhotoshopExecutionBaselineState;
    completionCheckedAt?: string;
    completionDocumentAssessment?: GuardedPhotoshopDocumentAssessment;
    completionError?: string;
    completionCheckPromise?: Promise<GuardedPhotoshopExecutionBaselineDecision>;
}

export interface GuardedPhotoshopExecutionBaselineReceipt {
    version: typeof GUARDED_PHOTOSHOP_EXECUTION_BASELINE_RECEIPT_VERSION;
    status: 'not_reached' | 'checking' | 'passed' | 'blocked';
    requestId: string;
    documentPolicy: 'preserve_preexisting_documents';
    expectedProjectPath: string;
    initialOpenDocumentCount: number;
    initialOpenOutsideFixtureDocumentCount: number;
    initialDirtyOutsideFixtureDocumentCount: number;
    initialProtectedDocumentRefs: PhotoshopHistoryStateRef[];
    expectedPhotoshopRuntimeBuildId: string;
    expectedPhotoshopRuntimeBinding: DebugBridgePhotoshopRuntimeBinding;
    firstMutationToolName?: string;
    checkedAt?: string;
    openDocumentCount?: number;
    openFixtureDocumentCount?: number;
    openOutsideFixtureDocumentCount?: number;
    unresolvedOwnershipDocumentCount?: number;
    dirtyOutsideFixtureDocumentCount?: number;
    observedPhotoshopRuntimeBuildId?: string;
    observedPhotoshopRuntimeIdentity?: DebugBridgePhotoshopRuntimeLiveIdentity;
    error?: string;
    completionStatus: 'not_reached' | 'checking' | 'passed' | 'blocked';
    completionCheckedAt?: string;
    completionOpenDocumentCount?: number;
    completionOpenFixtureDocumentCount?: number;
    completionOpenOutsideFixtureDocumentCount?: number;
    completionUnresolvedOwnershipDocumentCount?: number;
    completionDirtyOutsideFixtureDocumentCount?: number;
    completionPreexistingDocumentRevisionsUnchanged?: boolean;
    completionError?: string;
}

export interface GuardedPhotoshopExecutionBaselineDecision {
    ready: boolean;
    receipt: GuardedPhotoshopExecutionBaselineReceipt;
    error?: string;
    /**
     * 仅表示当前工具在 Photoshop dispatch 前被拒绝，且同一 TaskRun 可以用规定的
     * 首写工具重新执行完整基线检查。它不表示原工具可重试，也不授予写权限。
     */
    retryableWithinTaskRun?: boolean;
    nextRequiredTool?: 'createDocument';
}

export interface GuardedPhotoshopExecutionBaselineObservers {
    observePhotoshopRuntimeIdentity: () => Promise<DebugBridgePhotoshopRuntimeLiveIdentity | undefined>;
    observeOpenDocuments: () => Promise<GuardedPhotoshopDocumentFact[] | undefined>;
    now?: () => string;
}

export interface GuardedPhotoshopExecutionCompletionObservers {
    observeOpenDocuments: () => Promise<GuardedPhotoshopDocumentFact[] | undefined>;
    now?: () => string;
}

function cleanString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeHistoryStateRef(
    value: PhotoshopHistoryStateRef | undefined,
    expectedDocumentId: number
): PhotoshopHistoryStateRef | undefined {
    const documentId = Number(value?.documentId);
    const historyStateId = Number(value?.historyStateId);
    if (!Number.isSafeInteger(documentId)
        || documentId <= 0
        || documentId !== expectedDocumentId
        || !Number.isSafeInteger(historyStateId)
        || historyStateId <= 0) {
        return undefined;
    }
    return { documentId, historyStateId };
}

function normalizeDocumentFact(value: GuardedPhotoshopDocumentFact): GuardedPhotoshopDocumentFact | null {
    const id = Number(value?.id);
    const name = cleanString(value?.name);
    if (!Number.isSafeInteger(id) || id <= 0 || !name) return null;
    const pathState = value.pathState;
    const editState = value.editState;
    const projectAffinity = value.projectAffinity;
    if (!['saved', 'unsaved', 'unavailable', 'not_requested'].includes(pathState)
        || !['clean', 'dirty', 'unknown'].includes(editState)
        || !['current_project', 'outside_current_project', 'unknown'].includes(projectAffinity)) {
        return null;
    }
    const historyStateRef = normalizeHistoryStateRef(value.historyStateRef, id);
    return {
        id,
        name,
        isActive: value.isActive === true,
        pathState,
        editState,
        projectAffinity,
        ...(historyStateRef ? { historyStateRef } : {})
    };
}

function preexistingDocumentIdentityMatches(
    initial: GuardedPhotoshopDocumentFact,
    current: GuardedPhotoshopDocumentFact
): boolean {
    return initial.id === current.id
        && initial.name === current.name
        && initial.pathState === current.pathState
        && initial.editState === current.editState
        && initial.projectAffinity === current.projectAffinity;
}

export function assessGuardedPhotoshopDocuments(input: {
    documents: readonly GuardedPhotoshopDocumentFact[] | undefined;
    phase: 'submission' | 'first_mutation' | 'completion';
    firstMutationToolName?: string;
    initialDocuments?: readonly GuardedPhotoshopDocumentFact[];
}): GuardedPhotoshopDocumentAssessment {
    if (!Array.isArray(input.documents)) {
        return {
            ready: false,
            openDocumentCount: 0,
            openFixtureDocumentCount: 0,
            openOutsideFixtureDocumentCount: 0,
            unresolvedOwnershipDocumentCount: 0,
            dirtyOutsideFixtureDocumentCount: 0,
            preexistingDocumentRevisionsUnchanged: false,
            activeDocumentAffinity: 'absent',
            outsideDocumentIds: [],
            protectedDocumentRefs: [],
            blocker: 'document_inventory_unavailable'
        };
    }
    const documents = input.documents.map(normalizeDocumentFact);
    const invalidCount = documents.filter((document) => !document).length;
    const normalized = documents.filter((document): document is GuardedPhotoshopDocumentFact => Boolean(document));
    const fixtureDocuments = normalized.filter((document) => (
        document.projectAffinity === 'current_project'
    ));
    // TaskRun 所有权先看时间与对象身份，不要求文档先有磁盘路径：提交前已经存在且
    // 能读取 documentId/historyStateId 的对象属于“受保护前置文档”。保存路径只用于
    // 识别已存在的 fixture 文档污染，不能把未保存文档误判为可写目标。
    const outsideDocuments = normalized.filter((document) => (
        document.projectAffinity !== 'current_project' && Boolean(document.historyStateRef)
    ));
    const unresolvedOwnershipDocumentCount = invalidCount + normalized.filter((document) => (
        !document.historyStateRef
    )).length;
    const activeDocumentAffinity = normalized.find((document) => document.isActive)?.projectAffinity
        || 'absent';
    const initialDocuments = (input.initialDocuments || [])
        .map(normalizeDocumentFact)
        .filter((document): document is GuardedPhotoshopDocumentFact => Boolean(document));
    const initialProtectedDocuments = initialDocuments.filter((document) => (
        document.projectAffinity !== 'current_project' && Boolean(document.historyStateRef)
    ));
    const initialById = new Map(initialProtectedDocuments.map((document) => [document.id, document]));
    const currentById = new Map(normalized.map((document) => [document.id, document]));
    const preexistingDocumentMissing = input.phase !== 'submission'
        && initialProtectedDocuments.some((document) => !currentById.has(document.id));
    const preexistingDocumentIdentityChanged = input.phase !== 'submission'
        && initialProtectedDocuments.some((document) => {
            const current = currentById.get(document.id);
            return Boolean(current && !preexistingDocumentIdentityMatches(document, current));
        });
    const preexistingDocumentRevisionChanged = input.phase !== 'submission'
        && initialProtectedDocuments.some((document) => {
            const current = currentById.get(document.id);
            return Boolean(current && !samePhotoshopHistoryStateRef(
                document.historyStateRef,
                current.historyStateRef
            ));
        });
    const newOutsideDocumentOpened = input.phase !== 'submission'
        && outsideDocuments.some((document) => !initialById.has(document.id));
    const preexistingDocumentRevisionsUnchanged = !preexistingDocumentMissing
        && !preexistingDocumentIdentityChanged
        && !preexistingDocumentRevisionChanged;
    let blocker: GuardedPhotoshopDocumentAssessment['blocker'];
    if (unresolvedOwnershipDocumentCount > 0) {
        blocker = 'document_ownership_unresolved';
    } else if (input.phase === 'submission' && fixtureDocuments.length > 0) {
        blocker = 'fixture_document_already_open';
    } else if (input.phase === 'first_mutation' && fixtureDocuments.length > 0) {
        blocker = 'fixture_document_opened_before_first_mutation';
    } else if (preexistingDocumentMissing) {
        blocker = 'preexisting_document_missing';
    } else if (preexistingDocumentIdentityChanged) {
        blocker = 'preexisting_document_identity_changed';
    } else if (preexistingDocumentRevisionChanged) {
        blocker = 'preexisting_document_revision_changed';
    } else if (newOutsideDocumentOpened) {
        blocker = 'new_outside_document_opened';
    } else if (input.phase === 'first_mutation'
        && cleanString(input.firstMutationToolName) !== 'createDocument') {
        blocker = 'first_mutation_must_create_task_document';
    }
    return {
        ready: !blocker,
        openDocumentCount: normalized.length,
        openFixtureDocumentCount: fixtureDocuments.length,
        openOutsideFixtureDocumentCount: outsideDocuments.length,
        unresolvedOwnershipDocumentCount,
        dirtyOutsideFixtureDocumentCount: outsideDocuments.filter((document) => (
            document.editState === 'dirty'
        )).length,
        preexistingDocumentRevisionsUnchanged,
        activeDocumentAffinity,
        outsideDocumentIds: outsideDocuments.map((document) => document.id).sort((left, right) => left - right),
        protectedDocumentRefs: outsideDocuments
            .map((document) => document.historyStateRef)
            .filter((value): value is PhotoshopHistoryStateRef => Boolean(value))
            .map((value) => ({ ...value }))
            .sort((left, right) => left.documentId - right.documentId),
        ...(blocker ? { blocker } : {})
    };
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

/**
 * 首次写工具选错时，唯一可信事实是该调用尚未派发到 Photoshop。它可以被拒绝，
 * 但不能把整个 TaskRun 永久毒化：下一次调用仍要从 Runtime identity 和完整文档
 * inventory 重新检查，且只有 createDocument 才可能通过。真实环境漂移继续走
 * blockBaseline() 永久失败关闭。
 */
function rejectNonMutatingFirstToolSelection(
    baseline: GuardedPhotoshopExecutionBaseline,
    error: string
): GuardedPhotoshopExecutionBaselineDecision {
    baseline.state = 'pending';
    baseline.firstMutationToolName = undefined;
    baseline.checkedAt = undefined;
    baseline.openDocumentCount = undefined;
    baseline.openFixtureDocumentCount = undefined;
    baseline.openOutsideFixtureDocumentCount = undefined;
    baseline.unresolvedOwnershipDocumentCount = undefined;
    baseline.dirtyOutsideFixtureDocumentCount = undefined;
    baseline.observedPhotoshopRuntimeBuildId = undefined;
    baseline.observedPhotoshopRuntimeIdentity = undefined;
    baseline.error = undefined;
    baseline.checkPromise = undefined;
    return {
        ready: false,
        receipt: readGuardedPhotoshopExecutionBaselineReceipt(baseline),
        error,
        retryableWithinTaskRun: true,
        nextRequiredTool: 'createDocument'
    };
}

export function createGuardedPhotoshopExecutionBaseline(input: {
    requestId: string;
    expectedPhotoshopRuntimeBuildId: string;
    expectedPhotoshopRuntimeBinding: DebugBridgePhotoshopRuntimeBinding;
    expectedProjectPath: string;
    initialDocuments: GuardedPhotoshopDocumentFact[];
}): GuardedPhotoshopExecutionBaseline {
    const requestId = cleanString(input.requestId);
    const expectedPhotoshopRuntimeBuildId = cleanString(input.expectedPhotoshopRuntimeBuildId);
    const expectedPhotoshopRuntimeBinding = readDebugBridgePhotoshopRuntimeBinding(
        input.expectedPhotoshopRuntimeBinding
    );
    const expectedProjectPath = cleanString(input.expectedProjectPath);
    const initialDocumentAssessment = assessGuardedPhotoshopDocuments({
        documents: input.initialDocuments,
        phase: 'submission'
    });
    if (!requestId
        || !expectedPhotoshopRuntimeBuildId
        || !expectedProjectPath
        || !expectedPhotoshopRuntimeBinding
        || expectedPhotoshopRuntimeBinding.live.buildId !== expectedPhotoshopRuntimeBuildId) {
        throw new Error('受控 Photoshop 执行基线缺少 requestId、项目路径或 Photoshop Runtime 完整身份。');
    }
    if (!initialDocumentAssessment.ready) {
        throw new Error(`受控 Photoshop 执行基线无法冻结提交文档集合：${initialDocumentAssessment.blocker || 'unknown'}。`);
    }
    return {
        version: GUARDED_PHOTOSHOP_EXECUTION_BASELINE_VERSION,
        requestId,
        documentPolicy: 'preserve_preexisting_documents',
        expectedProjectPath,
        initialDocuments: input.initialDocuments.map((document) => ({
            ...document,
            ...(document.historyStateRef
                ? { historyStateRef: { ...document.historyStateRef } }
                : {})
        })),
        initialDocumentAssessment,
        expectedPhotoshopRuntimeBuildId,
        expectedPhotoshopRuntimeBinding,
        state: 'pending',
        completionState: 'pending'
    };
}

export function readGuardedPhotoshopExecutionBaselineReceipt(
    baseline: GuardedPhotoshopExecutionBaseline
): GuardedPhotoshopExecutionBaselineReceipt {
    const status = baseline.state === 'pending'
        ? 'not_reached'
        : baseline.state;
    const completionStatus = baseline.completionState === 'pending'
        ? 'not_reached'
        : baseline.completionState;
    return Object.freeze({
        version: GUARDED_PHOTOSHOP_EXECUTION_BASELINE_RECEIPT_VERSION,
        status,
        requestId: baseline.requestId,
        documentPolicy: baseline.documentPolicy,
        expectedProjectPath: baseline.expectedProjectPath,
        initialOpenDocumentCount: baseline.initialDocumentAssessment.openDocumentCount,
        initialOpenOutsideFixtureDocumentCount:
            baseline.initialDocumentAssessment.openOutsideFixtureDocumentCount,
        initialDirtyOutsideFixtureDocumentCount:
            baseline.initialDocumentAssessment.dirtyOutsideFixtureDocumentCount,
        initialProtectedDocumentRefs: baseline.initialDocumentAssessment.protectedDocumentRefs
            .map((value) => ({ ...value })),
        expectedPhotoshopRuntimeBuildId: baseline.expectedPhotoshopRuntimeBuildId,
        expectedPhotoshopRuntimeBinding: baseline.expectedPhotoshopRuntimeBinding,
        ...(baseline.firstMutationToolName
            ? { firstMutationToolName: baseline.firstMutationToolName }
            : {}),
        ...(baseline.checkedAt ? { checkedAt: baseline.checkedAt } : {}),
        ...(Number.isSafeInteger(baseline.openDocumentCount)
            ? { openDocumentCount: baseline.openDocumentCount }
            : {}),
        ...(Number.isSafeInteger(baseline.openFixtureDocumentCount)
            ? { openFixtureDocumentCount: baseline.openFixtureDocumentCount }
            : {}),
        ...(Number.isSafeInteger(baseline.openOutsideFixtureDocumentCount)
            ? { openOutsideFixtureDocumentCount: baseline.openOutsideFixtureDocumentCount }
            : {}),
        ...(Number.isSafeInteger(baseline.unresolvedOwnershipDocumentCount)
            ? { unresolvedOwnershipDocumentCount: baseline.unresolvedOwnershipDocumentCount }
            : {}),
        ...(Number.isSafeInteger(baseline.dirtyOutsideFixtureDocumentCount)
            ? { dirtyOutsideFixtureDocumentCount: baseline.dirtyOutsideFixtureDocumentCount }
            : {}),
        ...(baseline.observedPhotoshopRuntimeBuildId
            ? { observedPhotoshopRuntimeBuildId: baseline.observedPhotoshopRuntimeBuildId }
            : {}),
        ...(baseline.observedPhotoshopRuntimeIdentity
            ? { observedPhotoshopRuntimeIdentity: baseline.observedPhotoshopRuntimeIdentity }
            : {}),
        ...(baseline.error ? { error: baseline.error } : {}),
        completionStatus,
        ...(baseline.completionCheckedAt
            ? { completionCheckedAt: baseline.completionCheckedAt }
            : {}),
        ...(Number.isSafeInteger(baseline.completionDocumentAssessment?.openDocumentCount)
            ? { completionOpenDocumentCount: baseline.completionDocumentAssessment?.openDocumentCount }
            : {}),
        ...(Number.isSafeInteger(baseline.completionDocumentAssessment?.openFixtureDocumentCount)
            ? { completionOpenFixtureDocumentCount: baseline.completionDocumentAssessment?.openFixtureDocumentCount }
            : {}),
        ...(Number.isSafeInteger(baseline.completionDocumentAssessment?.openOutsideFixtureDocumentCount)
            ? {
                completionOpenOutsideFixtureDocumentCount:
                    baseline.completionDocumentAssessment?.openOutsideFixtureDocumentCount
            }
            : {}),
        ...(Number.isSafeInteger(baseline.completionDocumentAssessment?.unresolvedOwnershipDocumentCount)
            ? {
                completionUnresolvedOwnershipDocumentCount:
                    baseline.completionDocumentAssessment?.unresolvedOwnershipDocumentCount
            }
            : {}),
        ...(Number.isSafeInteger(baseline.completionDocumentAssessment?.dirtyOutsideFixtureDocumentCount)
            ? {
                completionDirtyOutsideFixtureDocumentCount:
                    baseline.completionDocumentAssessment?.dirtyOutsideFixtureDocumentCount
            }
            : {}),
        ...(typeof baseline.completionDocumentAssessment?.preexistingDocumentRevisionsUnchanged === 'boolean'
            ? {
                completionPreexistingDocumentRevisionsUnchanged:
                    baseline.completionDocumentAssessment.preexistingDocumentRevisionsUnchanged
            }
            : {}),
        ...(baseline.completionError ? { completionError: baseline.completionError } : {})
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

            // 文档列表必须是最后一项观察，让对象级目标事实尽可能贴近真实 mutation dispatch。
            // 提交时已冻结的外部文档可以继续打开；它们不能因此成为写入目标。当前项目文档
            // 只有在本请求开始后打开且成为活动目标时才允许承接首次写入。
            const documentAssessment = assessGuardedPhotoshopDocuments({
                documents: await observers.observeOpenDocuments(),
                phase: 'first_mutation',
                firstMutationToolName: baseline.firstMutationToolName,
                initialDocuments: baseline.initialDocuments
            });
            baseline.openDocumentCount = documentAssessment.openDocumentCount;
            baseline.openFixtureDocumentCount = documentAssessment.openFixtureDocumentCount;
            baseline.openOutsideFixtureDocumentCount = documentAssessment.openOutsideFixtureDocumentCount;
            baseline.unresolvedOwnershipDocumentCount = documentAssessment.unresolvedOwnershipDocumentCount;
            baseline.dirtyOutsideFixtureDocumentCount = documentAssessment.dirtyOutsideFixtureDocumentCount;
            if (!documentAssessment.ready) {
                const reason = documentAssessment.blocker || 'document_inventory_unavailable';
                if (reason === 'first_mutation_must_create_task_document') {
                    return rejectNonMutatingFirstToolSelection(
                        baseline,
                        `首次 Photoshop 写入前的文档目标不安全：${reason}。`
                    );
                }
                return blockBaseline(
                    baseline,
                    `首次 Photoshop 写入前的文档目标不安全：${reason}。`,
                    now
                );
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

function blockCompletionBaseline(
    baseline: GuardedPhotoshopExecutionBaseline,
    error: string,
    now: () => string
): GuardedPhotoshopExecutionBaselineDecision {
    baseline.completionState = 'blocked';
    baseline.completionCheckedAt = baseline.completionCheckedAt || now();
    baseline.completionError = error;
    return {
        ready: false,
        receipt: readGuardedPhotoshopExecutionBaselineReceipt(baseline),
        error
    };
}

/**
 * 正式 Debug TaskRun 完成前再次读取所有打开文档。提交前的每个对象必须仍然打开，
 * 且 documentId/historyStateId、名称、保存状态和 dirty 状态均未变化；本轮新建并保存到
 * fixture 的交付文档可以存在。该检查只形成同一 baseline 的完成收据，不创建第二账本。
 */
export async function completeGuardedPhotoshopExecutionBaseline(
    baseline: GuardedPhotoshopExecutionBaseline,
    observers: GuardedPhotoshopExecutionCompletionObservers
): Promise<GuardedPhotoshopExecutionBaselineDecision> {
    if (baseline.completionState === 'passed') {
        return {
            ready: true,
            receipt: readGuardedPhotoshopExecutionBaselineReceipt(baseline)
        };
    }
    if (baseline.completionState === 'blocked') {
        return {
            ready: false,
            receipt: readGuardedPhotoshopExecutionBaselineReceipt(baseline),
            error: baseline.completionError || '受保护的 Photoshop 前置文档在任务完成时未通过对账。'
        };
    }
    if (baseline.completionCheckPromise) return baseline.completionCheckPromise;

    const now = observers.now || (() => new Date().toISOString());
    baseline.completionState = 'checking';
    baseline.completionCheckPromise = (async (): Promise<GuardedPhotoshopExecutionBaselineDecision> => {
        try {
            const assessment = assessGuardedPhotoshopDocuments({
                documents: await observers.observeOpenDocuments(),
                phase: 'completion',
                initialDocuments: baseline.initialDocuments
            });
            baseline.completionDocumentAssessment = assessment;
            if (!assessment.ready) {
                return blockCompletionBaseline(
                    baseline,
                    `任务完成时受保护的 Photoshop 前置文档发生变化：${assessment.blocker || 'document_inventory_unavailable'}。`,
                    now
                );
            }
            baseline.completionCheckedAt = now();
            baseline.completionState = 'passed';
            return {
                ready: true,
                receipt: readGuardedPhotoshopExecutionBaselineReceipt(baseline)
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error || '未知错误');
            return blockCompletionBaseline(
                baseline,
                `任务完成时 Photoshop 前置文档对账失败：${message}`,
                now
            );
        }
    })();
    return baseline.completionCheckPromise;
}
