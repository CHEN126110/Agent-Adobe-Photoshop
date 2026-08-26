import { classifyAgentToolExecution } from './agent-tool-execution-preflight';
import {
    isRuntimeOwnedCompleteSkillToolLedger,
    type RuntimeOwnedSkillToolLedger
} from './agent-skill-atomic-tool-execution';
import {
    readDirectObservedPhotoshopMutationProof,
    type ObservedPhotoshopMutationProof,
    type PhotoshopHistoryStateRef
} from './photoshop-history-state-ref';

export const SKILL_EXECUTION_EFFECT_RECEIPT_VERSION =
    'skill-execution-effect-receipt/v0' as const;

export type SkillExecutionEffect = 'none' | 'applied' | 'partial' | 'unknown';

export interface SkillExecutionRuntimeLineage {
    version: 'skill-execution-runtime-lineage/v0';
    sessionId: string;
    runId: string;
    generation: number;
    taskRunId: string;
    planRevision: number;
    continuationId: string;
    workflowCallId: string;
    skillId: string;
}

export interface SkillExecutionRevisionTransition {
    source: ObservedPhotoshopMutationProof['source'];
    before?: PhotoshopHistoryStateRef;
    after: PhotoshopHistoryStateRef;
    toolActionCompleted: boolean;
}

/**
 * Skill 统一执行出口签发的效果收据。
 *
 * `effect` 只描述本次 Skill 已经产生的真实执行效果，不等于任务质量或完成状态：
 * - none：可以证明没有 Photoshop mutation；
 * - applied：至少一项 mutation 已由 Host revision 证明，且执行结果没有报告中断；
 * - partial：已经观察到 mutation，但 Skill 随后失败、取消或交回未完成状态；
 * - unknown：执行已经开始，但现有结构化证据无法排除 mutation。
 *
 * pendingInteraction 与 agentHandoff 独立表达控制权去向，不能从助手措辞推断。
 */
export interface SkillExecutionEffectReceipt {
    version: typeof SKILL_EXECUTION_EFFECT_RECEIPT_VERSION;
    skillId: string;
    runtimeLineage?: SkillExecutionRuntimeLineage;
    effect: SkillExecutionEffect;
    /** unknown 时为 null；其余状态必须是可证明的非负整数。 */
    mutationCount: number | null;
    revisions: SkillExecutionRevisionTransition[];
    pendingInteraction: boolean;
    agentHandoff: boolean;
    evidence: Array<
        | 'runtime_execution_summary'
        | 'host_revision_receipt'
        | 'trusted_tool_provenance'
        | 'nested_skill_receipt'
        | 'structured_tool_ledger'
        | 'declared_write_attempt'
        | 'runtime_complete_tool_ledger'
        | 'nested_receipt_lineage_rejected'
        | 'pending_interaction'
        | 'agent_handoff'
        | 'pre_execution'
        | 'declared_read_only_capability'
        | 'insufficient_execution_evidence'
    >;
    boundaries: {
        runtimeSigned: true;
        assistantTextIgnored: true;
        taskCompletionIndependent: true;
        qualityVerdictIndependent: true;
    };
}

export interface BuildSkillExecutionEffectReceiptInput {
    skillId: string;
    result: unknown;
    executionStarted: boolean;
    outcomeStatus?: string;
    declaredProviderToolNames?: readonly string[];
    runtimeLineage?: SkillExecutionRuntimeLineage;
    runtimeOwnedCompleteToolLedger?: RuntimeOwnedSkillToolLedger;
    /**
     * Renderer 统一 Tool 分发器基于对象身份登记的来源读取器。共享层不能自己导入
     * Renderer WeakMap；调用方必须显式注入。序列化、克隆或手造结果会返回 undefined。
     */
    readTrustedToolName?: (result: unknown) => string | undefined;
    /**
     * 兼容只提供真假判定的调用方；为 true 时仍只采用结构账本中的 toolName。
     * Renderer 生产出口优先使用 readTrustedToolName，避免名称也由复合 Skill 自报。
     */
    isTrustedExecutedToolResult?: (result: unknown) => boolean;
}

const RUNTIME_SKILL_EXECUTION_RECEIPTS = new WeakSet<object>();
const MAX_DECLARED_RESULT_NODES = 512;
const MAX_RECEIPT_REVISIONS = 128;

function asRecord(value: unknown): Record<string, any> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, any>
        : undefined;
}

function cleanText(value: unknown): string {
    return String(value || '').trim();
}

function readSkillExecutionRuntimeLineage(
    value: unknown
): SkillExecutionRuntimeLineage | undefined {
    const record = asRecord(value);
    const generation = Number(record?.generation);
    const planRevision = Number(record?.planRevision);
    const lineage: SkillExecutionRuntimeLineage = {
        version: 'skill-execution-runtime-lineage/v0',
        sessionId: cleanText(record?.sessionId),
        runId: cleanText(record?.runId),
        generation,
        taskRunId: cleanText(record?.taskRunId),
        planRevision,
        continuationId: cleanText(record?.continuationId),
        workflowCallId: cleanText(record?.workflowCallId),
        skillId: cleanText(record?.skillId)
    };
    if (record?.version !== lineage.version
        || !lineage.sessionId
        || !lineage.runId
        || !Number.isSafeInteger(generation)
        || generation < 1
        || !lineage.taskRunId
        || !Number.isSafeInteger(planRevision)
        || planRevision < 0
        || !lineage.continuationId
        || !lineage.workflowCallId
        || !lineage.skillId) {
        return undefined;
    }
    return lineage;
}

function sameRuntimeLineageScope(
    left: SkillExecutionRuntimeLineage,
    right: SkillExecutionRuntimeLineage
): boolean {
    return left.sessionId === right.sessionId
        && left.runId === right.runId
        && left.generation === right.generation
        && left.taskRunId === right.taskRunId
        && left.planRevision === right.planRevision
        && left.continuationId === right.continuationId
        && left.workflowCallId === right.workflowCallId;
}

export function isSkillExecutionReceiptBoundToLineage(
    receipt: SkillExecutionEffectReceipt | undefined,
    expected: SkillExecutionRuntimeLineage
): boolean {
    const expectedLineage = readSkillExecutionRuntimeLineage(expected);
    const receiptLineage = readSkillExecutionRuntimeLineage(receipt?.runtimeLineage);
    return Boolean(
        receipt
        && expectedLineage
        && receiptLineage
        && receipt.skillId === expectedLineage.skillId
        && receiptLineage.skillId === expectedLineage.skillId
        && sameRuntimeLineageScope(receiptLineage, expectedLineage)
    );
}

function unique<T>(values: readonly T[]): T[] {
    return Array.from(new Set(values));
}

function readNonNegativeInteger(value: unknown): number | undefined {
    const numeric = Number(value);
    if (!Number.isSafeInteger(numeric) || numeric < 0) return undefined;
    return numeric;
}

function readRuntimeMutationCount(result: unknown): number | undefined {
    const root = asRecord(result);
    const data = asRecord(root?.data);
    const summary = asRecord(root?.executionSummary) || asRecord(data?.executionSummary);
    return readNonNegativeInteger(summary?.successfulMutationCalls);
}

function hasPendingInteraction(result: unknown, outcomeStatus?: string): boolean {
    const root = asRecord(result);
    const data = asRecord(root?.data);
    return outcomeStatus === 'awaiting_confirmation'
        || root?.skillOutcome?.status === 'awaiting_confirmation'
        || data?.awaitingUserConfirmation === true
        || data?.pendingInteractiveContinuation?.version === 'pending-interactive-continuation/v0'
        || root?.pendingInteractiveContinuation?.version === 'pending-interactive-continuation/v0';
}

function hasAgentHandoff(result: unknown): boolean {
    const root = asRecord(result);
    const data = asRecord(root?.data);
    const nextToolOptions = Array.isArray(root?.nextRequiredToolOptions)
        ? root.nextRequiredToolOptions.filter((item: unknown) => cleanText(item))
        : [];
    return Boolean(data?.agentReActContinuation && typeof data.agentReActContinuation === 'object')
        || (root?.nonFatal === true && nextToolOptions.length > 0);
}

function isFailureLikeResult(result: unknown, outcomeStatus?: string): boolean {
    const root = asRecord(result);
    return root?.success === false
        || root?.cancelled === true
        || outcomeStatus === 'partial'
        || outcomeStatus === 'blocked'
        || outcomeStatus === 'failed'
        || outcomeStatus === 'cancelled';
}

function transitionFingerprint(transition: SkillExecutionRevisionTransition): string {
    return [
        transition.source,
        transition.before?.documentId || '',
        transition.before?.historyStateId || '',
        transition.after.documentId,
        transition.after.historyStateId,
        transition.toolActionCompleted ? 'completed' : 'incomplete'
    ].join(':');
}

function toRevisionTransition(
    proof: ObservedPhotoshopMutationProof
): SkillExecutionRevisionTransition {
    return {
        source: proof.source,
        ...(proof.before ? { before: proof.before } : {}),
        after: proof.after,
        toolActionCompleted: proof.toolActionCompleted
    };
}

interface DeclaredExecutionEvidence {
    revisions: SkillExecutionRevisionTransition[];
    nestedReceipts: SkillExecutionEffectReceipt[];
    toolLedgerEntryCount: number;
    writeAttemptCount: number;
    trustedResultCount: number;
    rejectedNestedReceiptCount: number;
}

function readDeclaredResultArrays(value: unknown): unknown[][] {
    const record = asRecord(value);
    if (!record) return [];
    const data = asRecord(record.data);
    return [
        record.toolResults,
        record.operationResults,
        record.toolCallLog,
        data?.toolResults,
        data?.operationResults,
        data?.toolCallLog
    ].filter((candidate): candidate is unknown[] => Array.isArray(candidate));
}

function resolveLedgerEntry(input: unknown): {
    toolName?: string;
    params: Record<string, any>;
    result: unknown;
} {
    const record = asRecord(input);
    if (!record) return { params: {}, result: input };
    const toolName = cleanText(record.toolName || record.name || record.tool);
    const params = asRecord(record.arguments) || asRecord(record.params) || {};
    if (Object.prototype.hasOwnProperty.call(record, 'result')) {
        return { ...(toolName ? { toolName } : {}), params, result: record.result };
    }
    if (Object.prototype.hasOwnProperty.call(record, 'output')) {
        return { ...(toolName ? { toolName } : {}), params, result: record.output };
    }
    return { ...(toolName ? { toolName } : {}), params, result: input };
}

function isWriteExecutionKind(kind: ReturnType<typeof classifyAgentToolExecution>): boolean {
    return kind === 'photoshop_write' || kind === 'save_export';
}

function isNonMutatingExecutionKind(kind: ReturnType<typeof classifyAgentToolExecution>): boolean {
    return kind === 'read_only_observation'
        || kind === 'knowledge_search'
        || kind === 'stateful_context';
}

function readTrustedToolName(input: {
    result: unknown;
    claimedToolName?: string;
    readTrustedToolName?: BuildSkillExecutionEffectReceiptInput['readTrustedToolName'];
    isTrustedExecutedToolResult?: BuildSkillExecutionEffectReceiptInput['isTrustedExecutedToolResult'];
}): string | undefined {
    const trustedName = cleanText(input.readTrustedToolName?.(input.result));
    if (trustedName) return trustedName;
    if (input.isTrustedExecutedToolResult?.(input.result) === true) {
        return cleanText(input.claimedToolName) || undefined;
    }
    return undefined;
}

function collectDeclaredExecutionEvidence(
    result: unknown,
    trust: Pick<
        BuildSkillExecutionEffectReceiptInput,
        'readTrustedToolName' | 'isTrustedExecutedToolResult'
    >,
    runtimeLineage: SkillExecutionRuntimeLineage | undefined,
    runtimeOwnedLedger: RuntimeOwnedSkillToolLedger | undefined
): DeclaredExecutionEvidence {
    const revisions = new Map<string, SkillExecutionRevisionTransition>();
    const nestedReceipts = new Set<SkillExecutionEffectReceipt>();
    const visited = new WeakSet<object>();
    let visitedNodeCount = 0;
    let toolLedgerEntryCount = 0;
    let writeAttemptCount = 0;
    let trustedResultCount = 0;
    let rejectedNestedReceiptCount = 0;

    function addProof(candidate: unknown): void {
        const proof = readDirectObservedPhotoshopMutationProof(candidate);
        if (!proof) return;
        const transition = toRevisionTransition(proof);
        revisions.set(transitionFingerprint(transition), transition);
    }

    function visit(
        envelope: unknown,
        depth: number,
        trustedIdentity?: {
            toolName: string;
            params: Record<string, any>;
        }
    ): void {
        if (depth > 8 || visitedNodeCount >= MAX_DECLARED_RESULT_NODES) return;
        const record = asRecord(envelope);
        if (!record || visited.has(record)) return;
        visited.add(record);
        visitedNodeCount += 1;

        const nestedReceipt = readSkillExecutionEffectReceipt(record);
        if (nestedReceipt) {
            const nestedLineage = readSkillExecutionRuntimeLineage(nestedReceipt.runtimeLineage);
            if (runtimeLineage
                && nestedLineage
                && sameRuntimeLineageScope(runtimeLineage, nestedLineage)) {
                nestedReceipts.add(nestedReceipt);
            } else {
                rejectedNestedReceiptCount += 1;
                // 已签发但 lineage 不同的结果信封整体隔离；不能绕过 receipt 检查，
                // 再从它内部复用旧 generation 的 provenance Tool 对象取得 mutation 信用。
                return;
            }
        }

        const envelopeTrustedToolName = trustedIdentity?.toolName || readTrustedToolName({
            result: record,
            ...trust
        });
        if (envelopeTrustedToolName) {
            trustedResultCount += 1;
            const trustedKind = classifyAgentToolExecution(
                envelopeTrustedToolName,
                trustedIdentity?.params || {}
            );
            if (isWriteExecutionKind(trustedKind)) addProof(record);
        }

        const arrays = readDeclaredResultArrays(record);
        if (arrays.length === 0) return;
        for (const entries of arrays) {
            for (const entry of entries.slice(0, MAX_DECLARED_RESULT_NODES)) {
                const resolved = resolveLedgerEntry(entry);
                toolLedgerEntryCount += 1;
                const trustedToolName = readTrustedToolName({
                    result: resolved.result,
                    claimedToolName: resolved.toolName,
                    ...trust
                });
                let entryIsWriteAttempt = false;
                if (resolved.toolName) {
                    const kind = classifyAgentToolExecution(resolved.toolName, resolved.params);
                    entryIsWriteAttempt = isWriteExecutionKind(kind);
                }
                if (trustedToolName) {
                    const trustedKind = classifyAgentToolExecution(trustedToolName, resolved.params);
                    entryIsWriteAttempt = entryIsWriteAttempt || isWriteExecutionKind(trustedKind);
                }
                if (entryIsWriteAttempt) writeAttemptCount += 1;
                visit(resolved.result, depth + 1, trustedToolName
                    ? {
                        toolName: trustedToolName,
                        params: resolved.params
                    }
                    : undefined);
                if (visitedNodeCount >= MAX_DECLARED_RESULT_NODES) return;
            }
        }
    }

    visit(result, 0);
    if (isRuntimeOwnedCompleteSkillToolLedger(runtimeOwnedLedger)) {
        for (const entry of runtimeOwnedLedger.entries) {
            if (entry.dispatchState === 'not_dispatched') continue;
            const kind = classifyAgentToolExecution(entry.toolName, entry.params);
            if (isWriteExecutionKind(kind)) writeAttemptCount += 1;
            if (entry.dispatchState !== 'returned') continue;
            const trustedToolName = readTrustedToolName({
                result: entry.result,
                claimedToolName: entry.toolName,
                ...trust
            });
            if (!trustedToolName || trustedToolName !== entry.toolName) continue;
            visit(entry.result, 1, {
                toolName: trustedToolName,
                params: entry.params as Record<string, any>
            });
        }
    }
    return {
        revisions: Array.from(revisions.values()).slice(0, MAX_RECEIPT_REVISIONS),
        nestedReceipts: Array.from(nestedReceipts),
        toolLedgerEntryCount,
        writeAttemptCount,
        trustedResultCount,
        rejectedNestedReceiptCount
    };
}

function runtimeOwnedLedgerProvesNoMutation(
    ledger: RuntimeOwnedSkillToolLedger | undefined
): boolean {
    return Boolean(
        isRuntimeOwnedCompleteSkillToolLedger(ledger)
        && ledger.entries.every((entry) => (
            entry.dispatchState === 'not_dispatched'
            || isNonMutatingExecutionKind(
                classifyAgentToolExecution(entry.toolName, entry.params)
            )
        ))
    );
}

function declaredCapabilitiesAreReadOnly(toolNames: readonly string[] | undefined): boolean {
    const normalized = unique((toolNames || []).map(cleanText).filter(Boolean));
    if (normalized.length === 0) return false;
    return normalized.every((toolName) => {
        const kind = classifyAgentToolExecution(toolName);
        return kind === 'read_only_observation'
            || kind === 'knowledge_search'
            || kind === 'stateful_context';
    });
}

function buildMutationCount(input: {
    revisions: SkillExecutionRevisionTransition[];
    nestedReceipts: SkillExecutionEffectReceipt[];
}): number | undefined {
    const nestedKnownCount = input.nestedReceipts.reduce((total, receipt) => (
        receipt.mutationCount === null ? total : total + receipt.mutationCount
    ), 0);
    const evidenceCount = Math.max(input.revisions.length, nestedKnownCount);
    return evidenceCount > 0 ? evidenceCount : undefined;
}

export function buildSkillExecutionEffectReceipt(
    input: BuildSkillExecutionEffectReceiptInput
): SkillExecutionEffectReceipt {
    const parsedRuntimeLineage = readSkillExecutionRuntimeLineage(input.runtimeLineage);
    const runtimeLineage = parsedRuntimeLineage?.skillId === cleanText(input.skillId)
        ? parsedRuntimeLineage
        : undefined;
    const runtimeOwnedLedger = isRuntimeOwnedCompleteSkillToolLedger(
        input.runtimeOwnedCompleteToolLedger
    ) ? input.runtimeOwnedCompleteToolLedger : undefined;
    const evidence = collectDeclaredExecutionEvidence(input.result, {
        readTrustedToolName: input.readTrustedToolName,
        isTrustedExecutedToolResult: input.isTrustedExecutedToolResult
    }, runtimeLineage, runtimeOwnedLedger);
    const runtimeMutationCount = readRuntimeMutationCount(input.result);
    const mutationCount = buildMutationCount({
        revisions: evidence.revisions,
        nestedReceipts: evidence.nestedReceipts
    });
    const pendingInteraction = hasPendingInteraction(input.result, input.outcomeStatus);
    const agentHandoff = hasAgentHandoff(input.result);
    const failureLike = isFailureLikeResult(input.result, input.outcomeStatus);
    const hasIncompleteMutation = evidence.revisions.some((item) => !item.toolActionCompleted)
        || evidence.nestedReceipts.some((receipt) => receipt.effect === 'partial');
    const declaredReadOnly = declaredCapabilitiesAreReadOnly(input.declaredProviderToolNames);
    const runtimeLedgerProvesNone = runtimeOwnedLedgerProvesNoMutation(runtimeOwnedLedger);
    const hasUnprovenMutationSignal = (runtimeMutationCount !== undefined && runtimeMutationCount > 0)
        || evidence.writeAttemptCount > 0
        || evidence.nestedReceipts.some((receipt) => (
            receipt.effect === 'unknown'
            || (receipt.effect === 'partial' && receipt.mutationCount === null)
        ));

    let effect: SkillExecutionEffect;
    if (mutationCount !== undefined && mutationCount > 0) {
        effect = failureLike || hasIncompleteMutation || pendingInteraction || agentHandoff
            ? 'partial'
            : 'applied';
    } else if (!input.executionStarted) {
        effect = 'none';
    } else if (hasUnprovenMutationSignal) {
        effect = 'unknown';
    } else if ((evidence.toolLedgerEntryCount === 0
            && evidence.nestedReceipts.length > 0
            && evidence.nestedReceipts.every((receipt) => receipt.effect === 'none'))
        || runtimeLedgerProvesNone
        || declaredReadOnly) {
        effect = 'none';
    } else {
        effect = 'unknown';
    }

    const receiptEvidence: SkillExecutionEffectReceipt['evidence'] = [];
    // executionSummary 只作为诊断来源记录；正数不会越过 provenance 直接授予 mutation 信用。
    if (runtimeMutationCount !== undefined) receiptEvidence.push('runtime_execution_summary');
    if (evidence.revisions.length > 0) receiptEvidence.push('host_revision_receipt');
    if (evidence.trustedResultCount > 0) receiptEvidence.push('trusted_tool_provenance');
    if (evidence.nestedReceipts.length > 0) receiptEvidence.push('nested_skill_receipt');
    if (evidence.toolLedgerEntryCount > 0) receiptEvidence.push('structured_tool_ledger');
    if (evidence.writeAttemptCount > 0) receiptEvidence.push('declared_write_attempt');
    if (runtimeOwnedLedger) receiptEvidence.push('runtime_complete_tool_ledger');
    if (evidence.rejectedNestedReceiptCount > 0) {
        receiptEvidence.push('nested_receipt_lineage_rejected');
    }
    if (pendingInteraction) receiptEvidence.push('pending_interaction');
    if (agentHandoff) receiptEvidence.push('agent_handoff');
    if (!input.executionStarted) receiptEvidence.push('pre_execution');
    if (declaredReadOnly) receiptEvidence.push('declared_read_only_capability');
    if (effect === 'unknown') receiptEvidence.push('insufficient_execution_evidence');

    const receipt: SkillExecutionEffectReceipt = {
        version: SKILL_EXECUTION_EFFECT_RECEIPT_VERSION,
        skillId: cleanText(input.skillId),
        ...(runtimeLineage ? { runtimeLineage } : {}),
        effect,
        mutationCount: effect === 'unknown' ? null : (mutationCount || 0),
        revisions: evidence.revisions,
        pendingInteraction,
        agentHandoff,
        evidence: unique(receiptEvidence),
        boundaries: {
            runtimeSigned: true,
            assistantTextIgnored: true,
            taskCompletionIndependent: true,
            qualityVerdictIndependent: true
        }
    };
    for (const revision of receipt.revisions) {
        if (revision.before) Object.freeze(revision.before);
        Object.freeze(revision.after);
        Object.freeze(revision);
    }
    Object.freeze(receipt.revisions);
    Object.freeze(receipt.evidence);
    if (receipt.runtimeLineage) Object.freeze(receipt.runtimeLineage);
    Object.freeze(receipt.boundaries);
    Object.freeze(receipt);
    RUNTIME_SKILL_EXECUTION_RECEIPTS.add(receipt);
    return receipt;
}

export function attachSkillExecutionEffectReceipt<T extends object>(
    result: T,
    input: Omit<BuildSkillExecutionEffectReceiptInput, 'result'>
): T & { skillExecutionReceipt: SkillExecutionEffectReceipt } {
    const receipt = buildSkillExecutionEffectReceipt({ ...input, result });
    return {
        ...result,
        skillExecutionReceipt: receipt
    };
}

export function readSkillExecutionEffectReceipt(
    value: unknown
): SkillExecutionEffectReceipt | undefined {
    const record = asRecord(value);
    const receipt = asRecord(record?.skillExecutionReceipt);
    if (!receipt || !RUNTIME_SKILL_EXECUTION_RECEIPTS.has(receipt)) return undefined;
    if (receipt.version !== SKILL_EXECUTION_EFFECT_RECEIPT_VERSION
        || !cleanText(receipt.skillId)
        || !['none', 'applied', 'partial', 'unknown'].includes(cleanText(receipt.effect))
        || (receipt.mutationCount !== null
            && readNonNegativeInteger(receipt.mutationCount) === undefined)
        || !Array.isArray(receipt.revisions)
        || typeof receipt.pendingInteraction !== 'boolean'
        || typeof receipt.agentHandoff !== 'boolean'
        || (receipt.runtimeLineage !== undefined
            && (!readSkillExecutionRuntimeLineage(receipt.runtimeLineage)
                || receipt.runtimeLineage.skillId !== receipt.skillId))) {
        return undefined;
    }
    return receipt as unknown as SkillExecutionEffectReceipt;
}
