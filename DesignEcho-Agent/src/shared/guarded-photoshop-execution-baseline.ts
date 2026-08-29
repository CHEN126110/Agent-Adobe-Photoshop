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

export const GUARDED_PHOTOSHOP_EXECUTION_BASELINE_VERSION =
    'guarded-photoshop-execution-baseline/v1' as const;

export const GUARDED_PHOTOSHOP_EXECUTION_BASELINE_RECEIPT_VERSION =
    'guarded-photoshop-execution-baseline-receipt/v1' as const;

export interface GuardedPhotoshopDocumentFact {
    id: number;
    name: string;
    isActive: boolean;
    pathState: PhotoshopDocumentPathState;
    editState: PhotoshopDocumentEditState;
    projectAffinity: PhotoshopDocumentProjectAffinity;
}

export interface GuardedPhotoshopDocumentAssessment {
    ready: boolean;
    openDocumentCount: number;
    openFixtureDocumentCount: number;
    openOutsideFixtureDocumentCount: number;
    unresolvedOwnershipDocumentCount: number;
    dirtyOutsideFixtureDocumentCount: number;
    activeDocumentAffinity: PhotoshopDocumentProjectAffinity | 'absent';
    outsideDocumentIds: number[];
    blocker?:
        | 'document_inventory_unavailable'
        | 'document_ownership_unresolved'
        | 'fixture_document_already_open'
        | 'new_outside_document_opened'
        | 'outside_document_is_active_write_target';
}

export type GuardedPhotoshopExecutionBaselineState =
    | 'pending'
    | 'checking'
    | 'passed'
    | 'blocked';

export interface GuardedPhotoshopExecutionBaseline {
    version: typeof GUARDED_PHOTOSHOP_EXECUTION_BASELINE_VERSION;
    requestId: string;
    documentPolicy: 'preserve_outside_project_documents';
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
}

export interface GuardedPhotoshopExecutionBaselineReceipt {
    version: typeof GUARDED_PHOTOSHOP_EXECUTION_BASELINE_RECEIPT_VERSION;
    status: 'not_reached' | 'checking' | 'passed' | 'blocked';
    requestId: string;
    documentPolicy: 'preserve_outside_project_documents';
    expectedProjectPath: string;
    initialOpenDocumentCount: number;
    initialOpenOutsideFixtureDocumentCount: number;
    initialDirtyOutsideFixtureDocumentCount: number;
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
}

export interface GuardedPhotoshopExecutionBaselineDecision {
    ready: boolean;
    receipt: GuardedPhotoshopExecutionBaselineReceipt;
    error?: string;
}

export interface GuardedPhotoshopExecutionBaselineObservers {
    observePhotoshopRuntimeIdentity: () => Promise<DebugBridgePhotoshopRuntimeLiveIdentity | undefined>;
    observeOpenDocuments: () => Promise<GuardedPhotoshopDocumentFact[] | undefined>;
    now?: () => string;
}

function cleanString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
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
    return {
        id,
        name,
        isActive: value.isActive === true,
        pathState,
        editState,
        projectAffinity
    };
}

export function assessGuardedPhotoshopDocuments(input: {
    documents: readonly GuardedPhotoshopDocumentFact[] | undefined;
    phase: 'submission' | 'first_mutation';
    firstMutationToolName?: string;
    initialOutsideDocumentIds?: readonly number[];
}): GuardedPhotoshopDocumentAssessment {
    if (!Array.isArray(input.documents)) {
        return {
            ready: false,
            openDocumentCount: 0,
            openFixtureDocumentCount: 0,
            openOutsideFixtureDocumentCount: 0,
            unresolvedOwnershipDocumentCount: 0,
            dirtyOutsideFixtureDocumentCount: 0,
            activeDocumentAffinity: 'absent',
            outsideDocumentIds: [],
            blocker: 'document_inventory_unavailable'
        };
    }
    const documents = input.documents.map(normalizeDocumentFact);
    const invalidCount = documents.filter((document) => !document).length;
    const normalized = documents.filter((document): document is GuardedPhotoshopDocumentFact => Boolean(document));
    const fixtureDocuments = normalized.filter((document) => (
        document.projectAffinity === 'current_project'
    ));
    const outsideDocuments = normalized.filter((document) => (
        document.projectAffinity === 'outside_current_project'
    ));
    const unresolvedOwnershipDocumentCount = invalidCount + normalized.filter((document) => (
        document.pathState !== 'saved' || document.projectAffinity === 'unknown'
    )).length;
    const activeDocumentAffinity = normalized.find((document) => document.isActive)?.projectAffinity
        || 'absent';
    const initialOutsideDocumentIds = new Set(
        (input.initialOutsideDocumentIds || [])
            .map(Number)
            .filter((id) => Number.isSafeInteger(id) && id > 0)
    );
    const newOutsideDocumentOpened = input.phase === 'first_mutation'
        && outsideDocuments.some((document) => !initialOutsideDocumentIds.has(document.id));
    let blocker: GuardedPhotoshopDocumentAssessment['blocker'];
    if (unresolvedOwnershipDocumentCount > 0) {
        blocker = 'document_ownership_unresolved';
    } else if (input.phase === 'submission' && fixtureDocuments.length > 0) {
        blocker = 'fixture_document_already_open';
    } else if (newOutsideDocumentOpened) {
        blocker = 'new_outside_document_opened';
    } else if (input.phase === 'first_mutation'
        && cleanString(input.firstMutationToolName) !== 'createDocument'
        && activeDocumentAffinity !== 'current_project') {
        blocker = 'outside_document_is_active_write_target';
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
        activeDocumentAffinity,
        outsideDocumentIds: outsideDocuments.map((document) => document.id).sort((left, right) => left - right),
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
        documentPolicy: 'preserve_outside_project_documents',
        expectedProjectPath,
        initialDocuments: input.initialDocuments.map((document) => ({ ...document })),
        initialDocumentAssessment,
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
        expectedProjectPath: baseline.expectedProjectPath,
        initialOpenDocumentCount: baseline.initialDocumentAssessment.openDocumentCount,
        initialOpenOutsideFixtureDocumentCount:
            baseline.initialDocumentAssessment.openOutsideFixtureDocumentCount,
        initialDirtyOutsideFixtureDocumentCount:
            baseline.initialDocumentAssessment.dirtyOutsideFixtureDocumentCount,
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

            // 文档列表必须是最后一项观察，让对象级目标事实尽可能贴近真实 mutation dispatch。
            // 提交时已冻结的外部文档可以继续打开；它们不能因此成为写入目标。当前项目文档
            // 只有在本请求开始后打开且成为活动目标时才允许承接首次写入。
            const documentAssessment = assessGuardedPhotoshopDocuments({
                documents: await observers.observeOpenDocuments(),
                phase: 'first_mutation',
                firstMutationToolName: baseline.firstMutationToolName,
                initialOutsideDocumentIds: baseline.initialDocumentAssessment.outsideDocumentIds
            });
            baseline.openDocumentCount = documentAssessment.openDocumentCount;
            baseline.openFixtureDocumentCount = documentAssessment.openFixtureDocumentCount;
            baseline.openOutsideFixtureDocumentCount = documentAssessment.openOutsideFixtureDocumentCount;
            baseline.unresolvedOwnershipDocumentCount = documentAssessment.unresolvedOwnershipDocumentCount;
            baseline.dirtyOutsideFixtureDocumentCount = documentAssessment.dirtyOutsideFixtureDocumentCount;
            if (!documentAssessment.ready) {
                const reason = documentAssessment.blocker || 'document_inventory_unavailable';
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
