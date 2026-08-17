/**
 * 视觉 Judge 的最终画面观察选择（纯逻辑，可 smoke）。
 *
 * 这个模块不拥有运行时状态，也不建立新的通用账本。它只从当前运行已有、
 * 按执行顺序追加的 Tool 结果日志中派生一次选择：
 * - 只接受干净的完整画布图像工具；区域截图只用于局部观察，不能冒充全局审美评价；
 * - 一旦发生 Photoshop 画布修改，只接受最后一次修改之后、且属于同一文档的观察；
 * - 文档目标不明确时 fail closed，不用旧图或其他文档的图替新结果打分；
 * - save / export 不改变画布像素，因此不会让已经在最后一次画布修改后取得的观察失效。
 *
 * 图像编码是否真的可提取仍由 renderer 现有 extractImageFromToolResult 负责；这里不复制
 * base64 解析规则，只约束观察的时序、对象与完整画布语义。
 */

import {
    buildAgentOperationDocumentTimeline,
    isSuccessfulAgentOperation,
    sameAgentOperationDocumentContext
} from './agent-operation-document-timeline';
import type { RuntimeExecutionTargetAnchor } from './agent-runtime-v5/runtime-execution-target';
import {
    type BuildDesignReviewSetResult,
    type DesignReviewSet,
    type DesignReviewSetItem,
    type DesignReviewSetRejectReason,
    type VisualObservationIdentity
} from './visual-observation-bundle';

const FULL_SURFACE_VISUAL_OBSERVATION_TOOLS = new Set([
    'getCanvasSnapshot',
    'getDocumentSnapshot'
]);

export interface DesignVisualJudgeOperationLogEntry {
    name?: string;
    arguments?: unknown;
    result?: any;
}

export interface DesignVisualJudgeObservationSelection {
    entryIndex: number;
    entry: DesignVisualJudgeOperationLogEntry;
    target?: RuntimeExecutionTargetAnchor;
    latestCanvasMutationIndex: number | null;
    freshness: 'unchanged_surface' | 'after_latest_canvas_mutation';
}

export interface DesignReviewBudget {
    maxTotalImages: number;
}

export type PlanDesignReviewImagesResult =
    | {
        status: 'ready';
        items: readonly DesignReviewSetItem[];
        totalImages: number;
    }
    | {
        status: 'budget_exceeded';
        requiredImages: number;
        availableImages: number;
    };

export function resolveDesignReviewSetItemForDiagnosis(
    reviewSet: DesignReviewSet,
    target: unknown
): DesignReviewSetItem | undefined {
    if (reviewSet.items.length === 1) return reviewSet.items[0];
    const normalizedTarget = String(target || '').trim();
    if (!normalizedTarget) return undefined;
    return reviewSet.items.find((item) => (
        item.identity.sourceId === normalizedTarget
        || item.observationKey === normalizedTarget
    ));
}

export function countUnbilledDesignReviewImages(
    reviewSet: DesignReviewSet,
    billedObservationKeys: ReadonlySet<string>
): number {
    return reviewSet.items.filter((item) => (
        !billedObservationKeys.has(item.observationKey)
    )).length;
}

export function resolveDirectVisionCandidateCharge(input: {
    directVisionCandidateCount: number;
    directVisionCandidateKeys: readonly string[];
    billedObservationKeys: ReadonlySet<string>;
    billByProviderPresentation: boolean;
}): {
    billedCandidateCount: number;
    normalizedObservationKeys: string[];
} {
    const normalizedObservationKeys = Array.from(new Set(
        input.directVisionCandidateKeys
            .map((key) => String(key || '').trim())
            .filter(Boolean)
    ));
    const normalizedPresentationCount = Number.isFinite(input.directVisionCandidateCount)
        ? Math.max(0, Math.floor(input.directVisionCandidateCount))
        : 0;
    let billedCandidateCount = normalizedPresentationCount;
    if (!input.billByProviderPresentation && normalizedObservationKeys.length > 0) {
        billedCandidateCount = normalizedObservationKeys.filter((key) => (
            !input.billedObservationKeys.has(key)
        )).length;
    }
    return {
        billedCandidateCount,
        normalizedObservationKeys
    };
}

/**
 * 普通观察可用额度必须给终局 ReviewSet 的全部画面留出 provider 输入额度。
 * observationKey 只负责证据身份与覆盖去重；终局 Judge 再次发送像素时，仍会产生
 * 一次真实图像输入费用，因此不能用“此前看过”抵扣这里的 presentation 预留。
 */
export function resolveFinalQualityVisionCandidateReserve(input: {
    reviewSet?: DesignReviewSet;
    fallbackWithoutEvidence?: number;
}): number {
    if (input.reviewSet) {
        return input.reviewSet.items.length;
    }
    const fallback = Number(input.fallbackWithoutEvidence ?? 1);
    return Number.isFinite(fallback) ? Math.max(0, Math.floor(fallback)) : 1;
}

export function resolveVisionCandidateLimitForFinalQuality(input: {
    hardLimit: number;
    maxInitialVisionCandidates: number;
    requiresMultiSurface: boolean;
    reviewSet?: DesignReviewSet;
}): number {
    const hardLimit = Number.isFinite(input.hardLimit)
        ? Math.max(0, Math.floor(input.hardLimit))
        : 0;
    const initialLimit = Number.isFinite(input.maxInitialVisionCandidates)
        ? Math.max(0, Math.min(hardLimit, Math.floor(input.maxInitialVisionCandidates)))
        : 0;
    if (input.requiresMultiSurface && !input.reviewSet) {
        // 多屏终审目标数在 ReviewSet 到达前不可知。普通观察最多使用用户附件上限
        // 加一个开场画布槽，其余额度留给最终完整集合，避免反复截图先耗尽30屏终审。
        return Math.min(hardLimit, initialLimit + 1);
    }
    const reserved = resolveFinalQualityVisionCandidateReserve({
        reviewSet: input.reviewSet
    });
    return Math.max(0, hardLimit - reserved);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function containsRegionSelection(value: unknown): boolean {
    if (!isRecord(value)) return false;
    if (value.region != null) return true;
    return isRecord(value.data) && value.data.region != null;
}

/**
 * 判断单条操作结果是否代表干净的完整画布观察。
 * getAcceptanceSnapshot 只有结构数据，不是像素图；annotated / generated / asset preview
 * 也不是最终成品画面，因此都不在候选集合中。
 */
export function isFullSurfaceVisualJudgeObservationEntry(
    entry: DesignVisualJudgeOperationLogEntry
): boolean {
    const name = String(entry.name || '').trim();
    if (!isSuccessfulAgentOperation(entry) || !FULL_SURFACE_VISUAL_OBSERVATION_TOOLS.has(name)) {
        return false;
    }
    if (name !== 'getCanvasSnapshot') return true;
    return !containsRegionSelection(entry.arguments) && !containsRegionSelection(entry.result);
}

/**
 * 从一次运行的操作日志中选择可供最终视觉 Judge 使用的最近完整画布观察。
 * 返回值是即时派生结果，不应持久化为新的状态 owner。
 */
export function selectLatestDesignVisualJudgeObservation(
    operationLog: readonly DesignVisualJudgeOperationLogEntry[]
): DesignVisualJudgeObservationSelection | null {
    const entries = Array.isArray(operationLog) ? operationLog : [];
    const timeline = buildAgentOperationDocumentTimeline(entries);
    let latestCanvasMutationIndex = -1;
    for (const item of timeline.entries) {
        if (item.photoshopMutationObserved) {
            latestCanvasMutationIndex = item.index;
        }
    }

    const lowerBound = latestCanvasMutationIndex >= 0 ? latestCanvasMutationIndex : -1;
    for (let index = entries.length - 1; index > lowerBound; index -= 1) {
        const entry = entries[index];
        if (!entry || !isFullSurfaceVisualJudgeObservationEntry(entry)) continue;
        const candidateContext = timeline.entries[index];
        const target = candidateContext?.target;
        if (latestCanvasMutationIndex >= 0
            && !sameAgentOperationDocumentContext(
                timeline.entries[latestCanvasMutationIndex],
                candidateContext
            )) {
            continue;
        }
        if (!sameAgentOperationDocumentContext(candidateContext, timeline.finalContext)) {
            continue;
        }
        return {
            entryIndex: index,
            entry,
            target,
            latestCanvasMutationIndex: latestCanvasMutationIndex >= 0
                ? latestCanvasMutationIndex
                : null,
            freshness: latestCanvasMutationIndex >= 0
                ? 'after_latest_canvas_mutation'
                : 'unchanged_surface'
        };
    }

    return null;
}

/**
 * R5 使用 ReviewSet 前的最后一道纯版本/覆盖检查。详情页要求 multi-surface 时，
 * 单张全画布不能冒充全部屏幕；主图和普通单画布任务仍可使用 single_surface。
 */
export function selectDesignReviewSetForFinalJudge(
    reviewSet: DesignReviewSet | undefined,
    options: {
        currentVersion: Pick<VisualObservationIdentity, 'document' | 'history'>;
        requireMultiSurface: boolean;
        requiredSourceKind?: string;
    }
): BuildDesignReviewSetResult {
    if (!reviewSet) {
        return { status: 'incomplete_evidence', reasons: ['expected_count_mismatch'] };
    }
    const reasons: DesignReviewSetRejectReason[] = [];
    if (options.requireMultiSurface) {
        if (reviewSet.source !== 'visual_observation_bundle'
            || reviewSet.expectedObservationCount < 2) {
            reasons.push('expected_count_mismatch');
        }
        if (reviewSet.coverageBasis !== 'declared_targets') {
            reasons.push('undeclared_targets');
        }
        const requiredSourceKind = String(options.requiredSourceKind || '').trim();
        if (requiredSourceKind && reviewSet.expectedTargets.some((target) => (
            target.sourceKind !== requiredSourceKind
        ))) {
            reasons.push('unexpected_source');
        }
    }
    if (reviewSet.document !== options.currentVersion.document) reasons.push('mixed_document');
    if (reviewSet.history !== options.currentVersion.history) reasons.push('mixed_history');
    if (reviewSet.items.some((item) => (
        item.identity.document !== options.currentVersion.document
    ))) reasons.push('mixed_document');
    if (reviewSet.items.some((item) => (
        item.identity.history !== options.currentVersion.history
    ))) reasons.push('mixed_history');
    if (reviewSet.items.length !== reviewSet.expectedObservationCount
        || reviewSet.expectedTargets.length !== reviewSet.expectedObservationCount) {
        reasons.push('expected_count_mismatch');
    }
    if (reasons.length > 0) {
        return {
            status: 'incomplete_evidence',
            reasons: Array.from(new Set(reasons))
        };
    }
    return { status: 'ready', reviewSet };
}

/**
 * 本版仍复用“一次终局 Judge 调用”的现有预算 owner；在调用前对整组图片 fail closed，
 * 不允许裁掉尾屏后拿部分证据判通过。
 */
export function planDesignReviewImages(
    reviewSet: DesignReviewSet,
    budget: DesignReviewBudget
): PlanDesignReviewImagesResult {
    const maxTotalImages = Math.max(0, Math.floor(Number(budget.maxTotalImages) || 0));
    if (reviewSet.items.length > maxTotalImages) {
        return {
            status: 'budget_exceeded',
            requiredImages: reviewSet.items.length,
            availableImages: maxTotalImages
        };
    }
    return {
        status: 'ready',
        items: reviewSet.items,
        totalImages: reviewSet.items.length
    };
}
