/**
 * 局部修改的通用验证记录。
 *
 * 这里只消费现有 Photoshop Tool acceptance 的 before/after diff、参数断言与 Engine
 * 已签发的结构化精确修改范围；不读取任务文本、不猜品类，也不把普通 Tool success
 * 或模型自己填写的目标参数当作用户请求已经完成。
 */

import {
    resolveExactPropertyReplacementTarget,
    type AgentToolExecutionPreflightLogEntry,
    type ExactPropertyExecutionScope
} from '../agent-tool-execution-preflight';
import type { PhotoshopHistoryStateRef } from '../photoshop-history-state-ref';
import type { DesignEvaluationVerificationRecord } from './design-evaluation-profiles';

interface RuntimeScopedChangeToolResult {
    name: string;
    arguments?: unknown;
    result?: unknown;
}

interface AcceptanceAssertionLike {
    id?: unknown;
    status?: unknown;
    affectedLayerIds?: unknown;
    expected?: unknown;
    actual?: unknown;
    scope?: unknown;
}

interface AcceptanceLike {
    enabled?: unknown;
    toolName?: unknown;
    toolSucceeded?: unknown;
    verified?: unknown;
    noDocumentChangeRisk?: unknown;
    assertionStatus?: unknown;
    assertions?: unknown;
    before?: unknown;
    after?: unknown;
    diff?: unknown;
}

const NON_VISUAL_STRUCTURE_ONLY_TOOLS = new Set([
    'renameLayer',
    'batchRenameLayers'
]);

function readRecord(value: unknown): Record<string, any> | undefined {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, any>
        : undefined;
}

function readAcceptance(result: unknown): AcceptanceLike | undefined {
    const record = readRecord(result);
    const acceptance = readRecord(record?.acceptance) || readRecord(readRecord(record?.data)?.acceptance);
    return acceptance?.enabled === true ? acceptance : undefined;
}

function readAssertions(acceptance: AcceptanceLike): AcceptanceAssertionLike[] {
    return Array.isArray(acceptance.assertions)
        ? acceptance.assertions.filter((item) => Boolean(readRecord(item))) as AcceptanceAssertionLike[]
        : [];
}

function readLayerIds(value: unknown): number[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item) && item > 0)));
}

function readChangedLayerIds(acceptance: AcceptanceLike): number[] {
    const diff = readRecord(acceptance.diff);
    const changed = Array.isArray(diff?.changedLayers)
        ? diff.changedLayers.map((item) => Number(readRecord(item)?.id))
        : [];
    return Array.from(new Set([
        ...readLayerIds(diff?.addedLayerIds),
        ...readLayerIds(diff?.removedLayerIds),
        ...changed.filter((item) => Number.isFinite(item) && item > 0)
    ]));
}

function normalizeExactTextValue(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    return value.replace(/\r\n?/g, '\n').trim();
}

function normalizeExactCurrentTextValue(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    return value.replace(/\r\n?/g, '\n');
}

function readPositiveInteger(value: unknown): number | undefined {
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric > 0 ? numeric : undefined;
}

/**
 * 终局再次使用写前完整快照解析唯一目标，而不是信任模型提交给 Tool 的 layerId。
 * 同时要求 setTextContent 携带 normalizer 注入的旧值、文档与 history CAS。
 */
interface ExactTextScopeBinding {
    bound: boolean;
    targetLayerId?: number;
}

function evaluateExactTextMutationScopeBinding(input: {
    entry: RuntimeScopedChangeToolResult;
    entryIndex: number;
    toolResults: readonly RuntimeScopedChangeToolResult[];
    acceptance: AcceptanceLike;
    assertions: readonly AcceptanceAssertionLike[];
    scope: ExactPropertyExecutionScope;
}): ExactTextScopeBinding {
    const target = resolveExactPropertyReplacementTarget({
        replacement: input.scope.replacement,
        completedToolCalls: input.toolResults.slice(0, input.entryIndex) as AgentToolExecutionPreflightLogEntry[]
    });
    if (target.status !== 'ready' || target.property !== 'text_content') return { bound: false };
    const unresolved = { bound: false, targetLayerId: target.layerId };
    if (input.entry.name !== 'setTextContent'
        || input.acceptance.toolName !== 'setTextContent'
        || input.acceptance.toolSucceeded !== true) return unresolved;
    const args = readRecord(input.entry.arguments);
    if (!args || Array.isArray(args.updates)) return unresolved;
    const layerId = readPositiveInteger(args.layerId);
    const expectedDocumentId = readPositiveInteger(args.expectedDocumentId);
    const expectedHistoryStateRef = readRecord(args.expectedHistoryStateRef);
    const expectedHistoryDocumentId = readPositiveInteger(expectedHistoryStateRef?.documentId);
    const expectedHistoryStateId = readPositiveInteger(expectedHistoryStateRef?.historyStateId);
    if (!layerId
        || !expectedDocumentId
        || expectedHistoryDocumentId !== expectedDocumentId
        || !expectedHistoryStateId
        || normalizeExactTextValue(args.content) !== input.scope.replacement.to
        || normalizeExactTextValue(args.expectedCurrentContent) !== input.scope.replacement.from) {
        return unresolved;
    }
    if (target.layerId !== layerId
        || target.historyStateRef.documentId !== expectedDocumentId
        || target.historyStateRef.historyStateId !== expectedHistoryStateId
        || normalizeExactCurrentTextValue(args.expectedCurrentContent)
            !== normalizeExactCurrentTextValue(target.currentValue)) {
        return unresolved;
    }

    const acceptanceBefore = readRecord(input.acceptance.before);
    const acceptanceBeforeHistory = readRecord(acceptanceBefore?.historyStateRef);
    if (readPositiveInteger(acceptanceBeforeHistory?.documentId) !== expectedDocumentId
        || readPositiveInteger(acceptanceBeforeHistory?.historyStateId) !== expectedHistoryStateId) {
        return unresolved;
    }

    const assertionBound = input.assertions.some((assertion) => {
        const affectedLayerIds = readLayerIds(assertion.affectedLayerIds);
        return assertion.id === 'setTextContent.content'
            && assertion.status === 'passed'
            && affectedLayerIds.length === 1
            && affectedLayerIds[0] === layerId;
    });
    return {
        bound: assertionBound,
        targetLayerId: target.layerId
    };
}

function hasFreshExactTextStructureReadback(
    acceptance: AcceptanceLike,
    expectedBefore: PhotoshopHistoryStateRef,
    requiredAfter: PhotoshopHistoryStateRef | undefined
): boolean {
    const before = readRecord(acceptance.before);
    const after = readRecord(acceptance.after);
    const beforeSummary = readRecord(before?.summary);
    const afterSummary = readRecord(after?.summary);
    const beforeHistory = readRecord(before?.historyStateRef);
    const afterHistory = readRecord(after?.historyStateRef);
    const beforeDocumentId = readPositiveInteger(beforeHistory?.documentId);
    const beforeHistoryStateId = readPositiveInteger(beforeHistory?.historyStateId);
    const afterDocumentId = readPositiveInteger(afterHistory?.documentId);
    const afterHistoryStateId = readPositiveInteger(afterHistory?.historyStateId);
    return requiredAfter !== undefined
        && beforeSummary?.truncated === false
        && afterSummary?.truncated === false
        && beforeDocumentId === expectedBefore.documentId
        && beforeHistoryStateId === expectedBefore.historyStateId
        && afterDocumentId === expectedBefore.documentId
        && afterHistoryStateId !== undefined
        && afterHistoryStateId !== expectedBefore.historyStateId
        && afterDocumentId === requiredAfter.documentId
        && afterHistoryStateId === requiredAfter.historyStateId;
}

function hasCompleteComparableDiff(acceptance: AcceptanceLike): boolean {
    const before = readRecord(acceptance.before);
    const after = readRecord(acceptance.after);
    const beforeSummary = readRecord(before?.summary);
    const afterSummary = readRecord(after?.summary);
    const diff = readRecord(acceptance.diff);
    const summary = readRecord(diff?.summary);
    if (diff?.comparable !== true
        || beforeSummary?.truncated === true
        || afterSummary?.truncated === true
        || !summary) return false;
    const listedChangeCount = readLayerIds(diff.addedLayerIds).length
        + readLayerIds(diff.removedLayerIds).length
        + (Array.isArray(diff.changedLayers) ? diff.changedLayers.length : 0);
    const reportedChangeCount = Number(summary.added || 0)
        + Number(summary.removed || 0)
        + Number(summary.changed || 0);
    return Number.isFinite(reportedChangeCount) && listedChangeCount === reportedChangeCount;
}

function hasPotentialVisualImpact(
    entry: RuntimeScopedChangeToolResult,
    acceptance: AcceptanceLike
): boolean {
    const diff = readRecord(acceptance.diff);
    if (readLayerIds(diff?.addedLayerIds).length > 0
        || readLayerIds(diff?.removedLayerIds).length > 0) return true;
    const changedLayers = Array.isArray(diff?.changedLayers)
        ? diff.changedLayers.map(readRecord).filter(Boolean) as Record<string, any>[]
        : [];
    return changedLayers.some((change) => {
        const kinds = Array.isArray(change.changes) ? change.changes.map(String) : [];
        if (kinds.some((kind) => kind === 'text' || kind === 'geometry' || kind === 'style')) return true;
        return kinds.includes('structure') && !NON_VISUAL_STRUCTURE_ONLY_TOOLS.has(entry.name);
    });
}

function isExplicitAssertion(assertion: AcceptanceAssertionLike): boolean {
    const scope = String(assertion.scope || '').toLowerCase();
    return !scope.includes('inferred')
        && assertion.expected !== undefined
        && assertion.actual !== undefined
        && readLayerIds(assertion.affectedLayerIds).length > 0;
}

function hasUnexpectedOutsideScopeChange(
    acceptance: AcceptanceLike,
    affectedLayerIds: ReadonlySet<number>
): boolean {
    const diff = readRecord(acceptance.diff);
    if (readLayerIds(diff?.addedLayerIds).some((layerId) => !affectedLayerIds.has(layerId))) return true;
    if (readLayerIds(diff?.removedLayerIds).some((layerId) => !affectedLayerIds.has(layerId))) return true;
    const changedLayers = Array.isArray(diff?.changedLayers)
        ? diff.changedLayers.map(readRecord).filter(Boolean) as Record<string, any>[]
        : [];
    const targetPaths = changedLayers
        .filter((change) => affectedLayerIds.has(Number(change.id)))
        .flatMap((change) => [String(change.before || ''), String(change.after || '')])
        .filter(Boolean);
    return changedLayers.some((change) => {
        if (affectedLayerIds.has(Number(change.id))) return false;
        const changes = Array.isArray(change.changes) ? change.changes.map(String) : [];
        const path = String(change.before || change.after || '');
        const ancestorGeometryOnly = changes.length > 0
            && changes.every((kind) => kind === 'geometry')
            && targetPaths.some((targetPath) => targetPath.startsWith(`${path}/`));
        return !ancestorGeometryOnly;
    });
}

function verificationRecord(
    key: 'requested_change_applied' | 'outside_scope_preserved' | 'fresh_structure_snapshot',
    status: DesignEvaluationVerificationRecord['status']
): DesignEvaluationVerificationRecord {
    return {
        key,
        status,
        source: 'runtime_observation',
        verificationRef: `runtime:scoped-change:${key}:${status}`
    };
}

export function buildRuntimeScopedChangeVerificationRecords(
    toolResults: readonly RuntimeScopedChangeToolResult[],
    options: {
        exactPropertyScope?: ExactPropertyExecutionScope;
        requiredHistoryStateRef?: PhotoshopHistoryStateRef;
    } = {}
): DesignEvaluationVerificationRecord[] {
    const relevant = toolResults.flatMap((entry, entryIndex) => {
        const acceptance = readAcceptance(entry.result);
        if (!acceptance) return [];
        // 不能丢弃没有任务断言的后续 mutation：它会使先前的局部范围通过失效，
        // 否则“先精准修改、再无范围写入”会把旧验收错误沿用到最终画布。
        const assertions = readAssertions(acceptance)
            .filter((assertion) => assertion.status !== 'not_applicable');
        return [{ entry, entryIndex, acceptance, assertions }];
    });
    if (relevant.length === 0) return [];
    // 当前所有 scoped-edit Profile 都要求 Engine 签发 exact text scope。没有这份结构化
    // 用户目标时，即使 Tool 的自选参数与 Host acceptance 自洽，也不能称为“用户请求已完成”。
    if (!options.exactPropertyScope) {
        return [
            verificationRecord('requested_change_applied', 'needs_review'),
            verificationRecord('outside_scope_preserved', 'needs_review')
        ];
    }

    let requestedChangeStatus: DesignEvaluationVerificationRecord['status'] = 'passed';
    let outsideScopeStatus: DesignEvaluationVerificationRecord['status'] = 'passed';

    let exactScopeBindingSeen = false;
    let freshExactTextStructureSeen = false;
    for (const { entry, entryIndex, acceptance, assertions } of relevant) {
        const result = readRecord(entry.result);
        const assertionStatuses = assertions.map((assertion) => String(assertion.status || ''));
        const preciseAssertions = assertions.filter(isExplicitAssertion);
        const affectedLayerIds = new Set(preciseAssertions.flatMap((assertion) => (
            readLayerIds(assertion.affectedLayerIds)
        )));
        const changedLayerIds = readChangedLayerIds(acceptance);
        const completeComparableDiff = hasCompleteComparableDiff(acceptance);
        const outsideScopeChange = affectedLayerIds.size > 0
            && hasUnexpectedOutsideScopeChange(acceptance, affectedLayerIds);
        const exactScopeBinding = evaluateExactTextMutationScopeBinding({
            entry,
                entryIndex,
                toolResults,
                acceptance,
                assertions,
            scope: options.exactPropertyScope
        });
        const boundToExactScope = exactScopeBinding.bound;
        if (boundToExactScope) {
            exactScopeBindingSeen = true;
            const args = readRecord(entry.arguments);
            const expectedHistoryStateRef = readRecord(args?.expectedHistoryStateRef);
            const expectedDocumentId = readPositiveInteger(expectedHistoryStateRef?.documentId);
            const expectedHistoryStateId = readPositiveInteger(expectedHistoryStateRef?.historyStateId);
            if (expectedDocumentId && expectedHistoryStateId) {
                freshExactTextStructureSeen = freshExactTextStructureSeen
                    || hasFreshExactTextStructureReadback(acceptance, {
                        documentId: expectedDocumentId,
                        historyStateId: expectedHistoryStateId
                    }, options.requiredHistoryStateRef);
            }
        }

        if (!boundToExactScope) {
            requestedChangeStatus = 'failed';
            const signedTargetLayerIds = exactScopeBinding.targetLayerId
                ? new Set([exactScopeBinding.targetLayerId])
                : undefined;
            const changedOutsideSignedTarget = signedTargetLayerIds
                ? hasUnexpectedOutsideScopeChange(acceptance, signedTargetLayerIds)
                : changedLayerIds.length > 0;
            if (changedOutsideSignedTarget) {
                outsideScopeStatus = 'failed';
            } else if (outsideScopeStatus !== 'failed' && !completeComparableDiff) {
                outsideScopeStatus = 'needs_review';
            }
            continue;
        }

        if (result?.success === false
            || acceptance.assertionStatus === 'failed'
            || assertionStatuses.includes('failed')
            || acceptance.noDocumentChangeRisk === true) {
            requestedChangeStatus = 'failed';
        } else if (requestedChangeStatus !== 'failed' && (
            acceptance.verified !== true
            || !preciseAssertions.some((assertion) => assertion.status === 'passed')
            || changedLayerIds.length === 0
            || !completeComparableDiff
        )) {
            requestedChangeStatus = 'needs_review';
        }

        if (outsideScopeChange) {
            outsideScopeStatus = 'failed';
        } else if (outsideScopeStatus !== 'failed' && (
            !completeComparableDiff
            || affectedLayerIds.size === 0
        )) {
            outsideScopeStatus = 'needs_review';
        }
    }

    if (!exactScopeBindingSeen) {
        requestedChangeStatus = 'failed';
    }

    return [
        verificationRecord('requested_change_applied', requestedChangeStatus),
        verificationRecord('outside_scope_preserved', outsideScopeStatus),
        ...(exactScopeBindingSeen && freshExactTextStructureSeen
            ? [verificationRecord('fresh_structure_snapshot', 'passed')]
            : [])
    ];
}

/**
 * 局部编辑只有在实际 mutation 可能改变像素呈现时，才动态要求同版本视觉复核。
 * 这不是另一套裁决：当前 scoped Profile 没有可靠 changed-region 裁剪与 provenance，因而
 * 不用整张长页 VLM 冒充局部评价；发生视觉影响但没有可信区域级评价时，诚实保留可选
 * fresh_visual_evaluation=needs_review，交人工复核且不成为写入/交付硬门禁。未来只有同版本、
 * 目标区域绑定的 Judge 证据才可通过 options.hasFreshVisualEvaluation 收口为 passed。
 */
export function buildRuntimeScopedVisualReviewVerificationRecords(
    toolResults: readonly RuntimeScopedChangeToolResult[],
    options: { hasFreshVisualEvaluation: boolean }
): DesignEvaluationVerificationRecord[] {
    if (options.hasFreshVisualEvaluation) return [];
    const requiresVisualReview = toolResults.some((entry) => {
        const acceptance = readAcceptance(entry.result);
        return Boolean(acceptance && hasPotentialVisualImpact(entry, acceptance));
    });
    if (!requiresVisualReview) return [];
    return [{
        key: 'fresh_visual_evaluation',
        status: 'needs_review',
        source: 'runtime_observation',
        verificationRef: 'runtime:scoped-change:fresh-visual:needs-review'
    }];
}
