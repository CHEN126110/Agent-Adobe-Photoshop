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

export interface GuardedPhotoshopExecutionBaseline {
    version: typeof GUARDED_PHOTOSHOP_EXECUTION_BASELINE_VERSION;
    requestId: string;
    requireNoOpenDocuments: true;
    expectedPhotoshopRuntimeBuildId: string;
    expectedPhotoshopRuntimeBinding: DebugBridgePhotoshopRuntimeBinding;
    state: GuardedPhotoshopExecutionBaselineState;
    firstMutationToolName?: string;
    checkedAt?: string;
    openDocumentCount?: number;
    observedPhotoshopRuntimeBuildId?: string;
    observedPhotoshopRuntimeIdentity?: DebugBridgePhotoshopRuntimeLiveIdentity;
    error?: string;
    checkPromise?: Promise<GuardedPhotoshopExecutionBaselineDecision>;
}

export interface GuardedPhotoshopExecutionBaselineReceipt {
    version: typeof GUARDED_PHOTOSHOP_EXECUTION_BASELINE_RECEIPT_VERSION;
    status: 'not_reached' | 'checking' | 'passed' | 'blocked';
    requestId: string;
    expectedPhotoshopRuntimeBuildId: string;
    expectedPhotoshopRuntimeBinding: DebugBridgePhotoshopRuntimeBinding;
    firstMutationToolName?: string;
    checkedAt?: string;
    openDocumentCount?: number;
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

export function createGuardedPhotoshopExecutionBaseline(input: {
    requestId: string;
    expectedPhotoshopRuntimeBuildId: string;
    expectedPhotoshopRuntimeBinding: DebugBridgePhotoshopRuntimeBinding;
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
    return {
        version: GUARDED_PHOTOSHOP_EXECUTION_BASELINE_VERSION,
        requestId,
        requireNoOpenDocuments: true,
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
        expectedPhotoshopRuntimeBuildId: baseline.expectedPhotoshopRuntimeBuildId,
        expectedPhotoshopRuntimeBinding: baseline.expectedPhotoshopRuntimeBinding,
        ...(baseline.firstMutationToolName
            ? { firstMutationToolName: baseline.firstMutationToolName }
            : {}),
        ...(baseline.checkedAt ? { checkedAt: baseline.checkedAt } : {}),
        ...(Number.isSafeInteger(baseline.openDocumentCount)
            ? { openDocumentCount: baseline.openDocumentCount }
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

            // 文档列表必须是最后一项观察，让 no-open 事实尽可能贴近真实 mutation dispatch。
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
