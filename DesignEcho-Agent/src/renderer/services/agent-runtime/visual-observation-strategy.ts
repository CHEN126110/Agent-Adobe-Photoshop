/**
 * 主循环视觉观察策略（纯逻辑，可 smoke）。
 *
 * 当前 Agent 只允许视觉多模态模型。每张快照要么由同一个 Agent 模型直接观察，
 * 要么在能力尚未确认时如实标记为未观察；运行时不再把画面转交第二个视觉模型。
 * `visual-expert` 仅保留在历史观察记录类型中，用于兼容读取旧日志。
 */

import {
    MAX_VISUAL_OBSERVATION_BUNDLE_ITEMS,
    VISUAL_OBSERVATION_RECEIPT_VERSION,
    VISUAL_OBSERVATION_REVIEW_BATCH_VERSION,
    VISUAL_OBSERVATION_REVIEW_DECISION_VERSION,
    buildVisualObservationKey,
    inspectVisualObservationBundles,
    readVisualObservationReviewBatch,
    readVisualObservationReviewDecision,
    type VisualObservationIdentity,
    type VisualObservationReceipt,
    type VisualObservationReviewBatch,
    type VisualObservationReviewDecision
} from '../../../shared/visual-observation-bundle';
import { sha256Hex } from '../../../shared/agent-runtime-v5/content-hash';
import { readPhotoshopHistoryStateRef } from '../../../shared/photoshop-history-state-ref';
import { collectImagesFromToolResult } from './tool-result-sanitizer';
import { readExecutedToolResultProvenance } from './tool-result-provenance';

export type VisualObservationStrategy = 'primary-self' | 'visual-expert' | 'no-visual-capability';

export type AgentVisualObservationStatus =
    | 'presented_to_primary'
    | 'observed_by_primary'
    | 'observed_by_visual_expert'
    | 'not_observed';

export interface AgentVisualObservation {
    version: 'agent-visual-observation/v1';
    status: AgentVisualObservationStatus;
    reviewed: boolean;
    observer: 'primary_model' | 'visual_expert' | 'none';
    strategy: VisualObservationStrategy;
    toolName: string;
    sourceId?: string | number;
    sourceName?: string;
    resultPath?: string;
    sourceKind?: string;
    observationIdentity?: VisualObservationIdentity;
    observationKey?: string;
    reviewDecision?: VisualObservationReviewDecision;
    reason?:
        | 'no_visual_capability'
        | 'visual_expert_empty'
        | 'visual_expert_invalid_review'
        | 'visual_expert_failed'
        | 'observation_budget_exhausted'
        | 'vision_candidate_budget_exhausted'
        | 'visual_analysis_budget_exhausted';
}

export interface AgentVisualObservationOverflow {
    version: 'agent-visual-observation-overflow/v1';
    outer: string;
    expectedCount: number;
    extractedCount: number;
    omittedCount: number;
    reason: 'harness_candidate_limit' | 'producer_limit' | 'payload_scan_limit';
}

/**
 * Runtime 保留字段必须由当前进程真正签发。
 *
 * 不能只依赖 delete：冻结或不可扩展的 Tool 输出无法删除生产端伪造字段。
 * WeakSet 以对象身份标记真正由 Harness 写入的记录；序列化/克隆后的生产端字段
 * 不会继承身份，因此读取端会失败关闭。
 */
const RUNTIME_VISUAL_ANNOTATION_OWNERS = new WeakSet<object>();
const RUNTIME_VISUAL_RECEIPT_OWNERS = new WeakSet<object>();

/** Tool / Skill 不能通过返回 Runtime 保留字段为自己签发视觉复核。 */
export function clearProducerVisualRuntimeAnnotations(toolResult: unknown): void {
    if (!toolResult || typeof toolResult !== 'object') return;
    RUNTIME_VISUAL_ANNOTATION_OWNERS.delete(toolResult);
    RUNTIME_VISUAL_RECEIPT_OWNERS.delete(toolResult);
    if (!Object.isExtensible(toolResult)) return;
    const output = toolResult as Record<string, unknown>;
    delete output.agentVisualObservation;
    delete output.agentVisualObservations;
    delete output.agentVisualObservationOverflow;
    delete output.agentVisualObservationReceipt;
}

interface NestedVisualSourceResult {
    toolName: string;
    result: Record<string, unknown>;
}

function isVisualRuntimeObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function collectNestedVisualSourceResults(value: unknown): NestedVisualSourceResult[] {
    const output: NestedVisualSourceResult[] = [];
    const visited = new WeakSet<object>();
    let visitedNodeCount = 0;

    function visitContainers(container: unknown, depth: number): void {
        if (!isVisualRuntimeObject(container)
            || depth > 6
            || visitedNodeCount >= 256
            || visited.has(container)) {
            return;
        }
        visited.add(container);
        visitedNodeCount += 1;
        for (const [key, child] of Object.entries(container)) {
            const normalizedKey = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
            if (normalizedKey === 'toolresults' && Array.isArray(child)) {
                for (const item of child.slice(0, 96)) {
                    if (!isVisualRuntimeObject(item)) continue;
                    const toolName = String(item.toolName || '').trim();
                    const result = isVisualRuntimeObject(item.result) ? item.result : undefined;
                    if (toolName
                        && result
                        && result.success !== false
                        && item.success !== false) {
                        output.push({ toolName, result });
                    }
                    visitContainers(result, depth + 1);
                }
                continue;
            }
            if (normalizedKey === 'data'
                || normalizedKey === 'result'
                || normalizedKey === 'output') {
                visitContainers(child, depth + 1);
            }
        }
    }

    visitContainers(value, 0);
    return output;
}

function getVisualPayload(value: unknown): string {
    if (!isVisualRuntimeObject(value)) return '';
    return String(value.dataUrl || value.base64 || value.imageData || '').replace(/^data:image\/[^;]+;base64,/i, '');
}

function isUsableVisualSourceId(sourceId: string, resultPath?: unknown): boolean {
    if (!sourceId || sourceId === 'unknown' || sourceId === '$') return false;
    return sourceId !== String(resultPath || '').trim();
}

/**
 * 从复合 Tool/Skill 的真实嵌套只读结果派生 Runtime 保留回执。
 * 生产端自带的 visualObservationReceipt 只是一项声明；只有嵌套 Host 结果在同一
 * document/history 下按规范化 sourceId 与 Bundle 逐图对应，Runtime 才会签发回执。
 * 只比较像素集合会让 screen A/B 的标签交换后仍被误认，因此这里拒绝缺失/重复
 * sourceId、额外图片以及任一 sourceId → pixels 映射不一致。
 */
export function deriveAgentVisualObservationReceipt(input: {
    toolResult: unknown;
    outerToolName: string;
    isTrustedObservationTool: (toolName: string) => boolean;
}): VisualObservationReceipt | undefined {
    const bundles = inspectVisualObservationBundles(
        input.toolResult,
        input.outerToolName
    ).bundles;
    const directResult = isVisualRuntimeObject(input.toolResult)
        && input.isTrustedObservationTool(input.outerToolName)
        && readExecutedToolResultProvenance(input.toolResult)?.toolName === input.outerToolName
        ? input.toolResult
        : undefined;
    if (directResult) {
        const directHistoryStateRef = readPhotoshopHistoryStateRef(directResult);
        const directImages = collectImagesFromToolResult(
            directResult,
            24,
            input.outerToolName
        ).images;
        if (directHistoryStateRef
            && directImages.length > 0
            && directImages.every((image) => (
                image.observationIdentity?.outer === input.outerToolName
                && image.observationIdentity.document === String(directHistoryStateRef.documentId)
                && image.observationIdentity.history === String(directHistoryStateRef.historyStateId)
            ))) {
            return {
                version: VISUAL_OBSERVATION_RECEIPT_VERSION,
                document: String(directHistoryStateRef.documentId),
                history: String(directHistoryStateRef.historyStateId),
                sourceTool: input.outerToolName
            };
        }
    }
    const sources = collectNestedVisualSourceResults(input.toolResult);
    for (const bundle of [...bundles].reverse()) {
        if (bundle.expectedObservationCount <= 0
            || bundle.items.length !== bundle.expectedObservationCount
            || bundle.overflow
            || bundle.items.some((item) => !item.captured || !getVisualPayload(item.image))) {
            continue;
        }
        const document = bundle.items[0]?.identity.document || '';
        const history = bundle.items[0]?.identity.history || '';
        if (!document
            || document === 'unknown'
            || !history
            || history === 'unknown'
            || bundle.items.some((item) => (
                item.identity.outer !== input.outerToolName
                || item.identity.document !== document
                || item.identity.history !== history
            ))) {
            continue;
        }
        const bundlePixelsBySourceId = new Map<string, string>();
        let bundleSourceMappingValid = true;
        for (const item of bundle.items) {
            const sourceId = normalizeVisualDeliverySourceId(
                item.identity.sourceId,
                item.identity.sourceKind,
                input.outerToolName
            );
            if (!isUsableVisualSourceId(sourceId, item.identity.resultPath)
                || bundlePixelsBySourceId.has(sourceId)) {
                bundleSourceMappingValid = false;
                break;
            }
            bundlePixelsBySourceId.set(sourceId, sha256Hex(getVisualPayload(item.image)));
        }
        if (!bundleSourceMappingValid
            || bundlePixelsBySourceId.size !== bundle.expectedObservationCount) {
            continue;
        }
        const sourcePixelsBySourceId = new Map<string, string>();
        const sourceToolNames = new Set<string>();
        let invalidSourceMapping = false;
        for (const candidate of sources) {
            if (!input.isTrustedObservationTool(candidate.toolName)) continue;
            const provenance = readExecutedToolResultProvenance(candidate.result);
            if (provenance?.toolName !== candidate.toolName) continue;
            const historyStateRef = readPhotoshopHistoryStateRef(candidate.result);
            if (!historyStateRef
                || String(historyStateRef.documentId) !== document
                || String(historyStateRef.historyStateId) !== history) {
                continue;
            }
            const sourceCollection = collectImagesFromToolResult(
                candidate.result,
                Math.min(
                    MAX_VISUAL_OBSERVATION_BUNDLE_ITEMS,
                    bundle.expectedObservationCount
                ),
                candidate.toolName
            );
            if (sourceCollection.overflow) {
                invalidSourceMapping = true;
                break;
            }
            sourceToolNames.add(candidate.toolName);
            for (const image of sourceCollection.images) {
                const identity = image.observationIdentity;
                if (!identity
                    || identity.outer !== candidate.toolName
                    || identity.document !== document
                    || identity.history !== history) {
                    invalidSourceMapping = true;
                    break;
                }
                const sourceId = normalizeVisualDeliverySourceId(
                    identity.sourceId,
                    identity.sourceKind,
                    candidate.toolName
                );
                if (!isUsableVisualSourceId(sourceId, identity.resultPath)
                    || sourcePixelsBySourceId.has(sourceId)) {
                    invalidSourceMapping = true;
                    break;
                }
                sourcePixelsBySourceId.set(sourceId, sha256Hex(image.data));
            }
            if (invalidSourceMapping) break;
        }
        if (invalidSourceMapping
            || sourceToolNames.size !== 1
            || sourcePixelsBySourceId.size !== bundlePixelsBySourceId.size
            || !Array.from(bundlePixelsBySourceId.entries()).every(([sourceId, pixelHash]) => (
                sourcePixelsBySourceId.get(sourceId) === pixelHash
            ))) {
            continue;
        }
        return {
            version: VISUAL_OBSERVATION_RECEIPT_VERSION,
            document,
            history,
            sourceTool: Array.from(sourceToolNames)[0]
        };
    }
    return undefined;
}

export function writeAgentVisualObservationReceipt(
    toolResult: unknown,
    receipt: VisualObservationReceipt
): VisualObservationReceipt | undefined {
    if (!toolResult || typeof toolResult !== 'object' || !Object.isExtensible(toolResult)) return undefined;
    (toolResult as Record<string, unknown>).agentVisualObservationReceipt = receipt;
    RUNTIME_VISUAL_RECEIPT_OWNERS.add(toolResult);
    return receipt;
}

export function readAgentVisualObservationReceipt(
    toolResult: unknown
): VisualObservationReceipt | undefined {
    if (!isVisualRuntimeObject(toolResult)
        || !RUNTIME_VISUAL_RECEIPT_OWNERS.has(toolResult)) return undefined;
    const receipt = toolResult.agentVisualObservationReceipt;
    if (!isVisualRuntimeObject(receipt)
        || receipt.version !== VISUAL_OBSERVATION_RECEIPT_VERSION
        || !String(receipt.document || '').trim()
        || !String(receipt.history || '').trim()
        || !String(receipt.sourceTool || '').trim()) {
        return undefined;
    }
    return {
        version: VISUAL_OBSERVATION_RECEIPT_VERSION,
        document: String(receipt.document),
        history: String(receipt.history),
        sourceTool: String(receipt.sourceTool)
    };
}

export function writeAgentVisualObservation(
    toolResult: unknown,
    observation: Omit<AgentVisualObservation, 'version'>
): AgentVisualObservation | undefined {
    if (!toolResult || typeof toolResult !== 'object' || !Object.isExtensible(toolResult)) return undefined;
    const observationKey = observation.observationKey
        || (observation.observationIdentity
            ? buildVisualObservationKey(observation.observationIdentity)
            : undefined);
    const reviewDecision = observationKey
        ? readVisualObservationReviewDecision(observation.reviewDecision, observationKey)
        : undefined;
    const record: AgentVisualObservation = {
        version: 'agent-visual-observation/v1',
        ...observation,
        ...(observationKey ? { observationKey } : {}),
        ...(reviewDecision ? { reviewDecision, reviewed: true } : {}),
        ...(observationKey && !reviewDecision ? { reviewed: false } : {})
    };
    const output = toolResult as Record<string, unknown>;
    const previous = Array.isArray(output.agentVisualObservations)
        ? (output.agentVisualObservations as unknown[])
            .filter((item): item is AgentVisualObservation => (
                Boolean(item)
                && typeof item === 'object'
                && (item as AgentVisualObservation).version === 'agent-visual-observation/v1'
            ))
        : [];
    const identity = record.observationKey
        ? `observation:${record.observationKey}`
        : record.sourceId !== undefined
        ? `source:${String(record.sourceId)}`
        : `tool:${record.toolName}`;
    const next = previous.filter((item) => {
        const itemIdentity = item.observationKey
            ? `observation:${item.observationKey}`
            : item.sourceId !== undefined
            ? `source:${String(item.sourceId)}`
            : `tool:${item.toolName}`;
        return itemIdentity !== identity;
    });
    next.push(record);
    output.agentVisualObservations = next;
    (toolResult as Record<string, unknown>).agentVisualObservation = record;
    RUNTIME_VISUAL_ANNOTATION_OWNERS.add(toolResult);
    return record;
}

export function readAgentVisualObservations(toolResult: unknown): AgentVisualObservation[] {
    if (!toolResult
        || typeof toolResult !== 'object'
        || !RUNTIME_VISUAL_ANNOTATION_OWNERS.has(toolResult)) return [];
    const records = (toolResult as Record<string, any>).agentVisualObservations;
    if (Array.isArray(records)) {
        return records.filter((record): record is AgentVisualObservation => (
            record?.version === 'agent-visual-observation/v1'
        ));
    }
    const legacy = (toolResult as Record<string, any>).agentVisualObservation;
    return legacy?.version === 'agent-visual-observation/v1'
        ? [legacy as AgentVisualObservation]
        : [];
}

export function readAgentVisualObservation(toolResult: unknown): AgentVisualObservation | undefined {
    const observations = readAgentVisualObservations(toolResult);
    if (observations.length === 0) return undefined;
    const unreviewed = observations.find((observation) => observation.reviewed !== true);
    if (unreviewed) return unreviewed;
    const overflow = readAgentVisualObservationOverflow(toolResult);
    if (overflow) {
        return {
            ...observations[observations.length - 1],
            reviewed: false,
            reason: 'vision_candidate_budget_exhausted'
        };
    }
    const needsFix = observations.find((observation) => (
        observation.reviewDecision?.status === 'needs_fix'
        || observation.reviewDecision?.status === 'unreadable'
    ));
    if (needsFix) {
        return {
            ...needsFix,
            reviewed: false
        };
    }
    return observations[observations.length - 1];
}

export function writeAgentVisualObservationOverflow(
    toolResult: unknown,
    overflow: Omit<AgentVisualObservationOverflow, 'version'>
): AgentVisualObservationOverflow | undefined {
    if (!toolResult || typeof toolResult !== 'object' || !Object.isExtensible(toolResult)) return undefined;
    const record: AgentVisualObservationOverflow = {
        version: 'agent-visual-observation-overflow/v1',
        ...overflow,
        expectedCount: Math.max(0, Math.round(Number(overflow.expectedCount) || 0)),
        extractedCount: Math.max(0, Math.round(Number(overflow.extractedCount) || 0)),
        omittedCount: Math.max(0, Math.round(Number(overflow.omittedCount) || 0))
    };
    (toolResult as Record<string, unknown>).agentVisualObservationOverflow = record;
    RUNTIME_VISUAL_ANNOTATION_OWNERS.add(toolResult);
    return record;
}

export function readAgentVisualObservationOverflow(
    toolResult: unknown
): AgentVisualObservationOverflow | undefined {
    if (!toolResult
        || typeof toolResult !== 'object'
        || !RUNTIME_VISUAL_ANNOTATION_OWNERS.has(toolResult)) return undefined;
    const value = (toolResult as Record<string, unknown>).agentVisualObservationOverflow;
    if (!value || typeof value !== 'object') return undefined;
    const record = value as AgentVisualObservationOverflow;
    if (record.version !== 'agent-visual-observation-overflow/v1'
        || record.omittedCount <= 0
        || record.expectedCount <= 0) {
        return undefined;
    }
    return record;
}

export type AgentVisualDeliveryReviewStatus =
    | 'pending'
    | 'passed'
    | 'needs_fix'
    | 'unreadable';

interface AgentVisualDeliveryObservationSet {
    status: 'pending' | 'valid' | 'unreadable';
    observationKeys: string[];
    sourceIds: string[];
}

function normalizeVisualDeliverySourceId(
    sourceId: unknown,
    sourceKind?: unknown,
    outerToolName?: unknown
): string {
    const value = sourceId === undefined || sourceId === null
        ? ''
        : String(sourceId).trim();
    if (!value) return '';
    if (/^\d+$/.test(value)
        && (/screen/i.test(String(sourceKind || ''))
            || /screen.?snapshots?/i.test(String(outerToolName || '')))) {
        return `screen:${Number(value)}`;
    }
    return value;
}

function inspectAgentVisualDeliveryObservationSet(
    toolResult: unknown,
    outerToolName: string
): AgentVisualDeliveryObservationSet {
    const scan = inspectVisualObservationBundles(toolResult, outerToolName);
    if (scan.truncated || scan.invalidBundleCount > 0) {
        return { status: 'unreadable', observationKeys: [], sourceIds: [] };
    }
    const bundle = scan.bundles[scan.bundles.length - 1];
    const receipt = readAgentVisualObservationReceipt(toolResult);
    if (bundle && receipt) {
        if (bundle.expectedObservationCount <= 0
            || bundle.items.length !== bundle.expectedObservationCount
            || bundle.overflow
            || readAgentVisualObservationOverflow(toolResult)) {
            return { status: 'unreadable', observationKeys: [], sourceIds: [] };
        }
        const observationKeys = new Set<string>();
        const sourceIds = new Set<string>();
        for (const item of bundle.items) {
            const identity = item.identity;
            if (!item.captured
                || identity.outer !== outerToolName
                || !identity.resultPath
                || !identity.document
                || identity.document === 'unknown'
                || !identity.history
                || identity.history === 'unknown'
                || identity.document !== receipt.document
                || identity.history !== receipt.history) {
                return { status: 'unreadable', observationKeys: [], sourceIds: [] };
            }
            observationKeys.add(buildVisualObservationKey(identity));
            sourceIds.add(normalizeVisualDeliverySourceId(
                identity.sourceId,
                identity.sourceKind,
                outerToolName
            ));
        }
        if (observationKeys.size !== bundle.expectedObservationCount
            || sourceIds.has('')) {
            return { status: 'unreadable', observationKeys: [], sourceIds: [] };
        }
        return {
            status: 'valid',
            observationKeys: Array.from(observationKeys),
            sourceIds: Array.from(sourceIds)
        };
    }
    if (!receipt) {
        return { status: 'pending', observationKeys: [], sourceIds: [] };
    }
    const provenance = readExecutedToolResultProvenance(toolResult);
    if (provenance?.toolName !== outerToolName
        || receipt.sourceTool !== outerToolName
        || readAgentVisualObservationOverflow(toolResult)) {
        return { status: 'unreadable', observationKeys: [], sourceIds: [] };
    }
    const observations = readAgentVisualObservations(toolResult);
    if (observations.length === 0) {
        return { status: 'pending', observationKeys: [], sourceIds: [] };
    }
    const observationKeys = new Set<string>();
    const sourceIds = new Set<string>();
    for (const observation of observations) {
        const identity = observation.observationIdentity;
        const observationKey = observation.observationKey;
        if (!identity
            || !observationKey
            || identity.outer !== outerToolName
            || identity.document !== receipt.document
            || identity.history !== receipt.history) {
            return { status: 'unreadable', observationKeys: [], sourceIds: [] };
        }
        observationKeys.add(observationKey);
        sourceIds.add(normalizeVisualDeliverySourceId(
            identity.sourceId,
            identity.sourceKind,
            outerToolName
        ));
    }
    if (observationKeys.size !== observations.length || sourceIds.has('')) {
        return { status: 'unreadable', observationKeys: [], sourceIds: [] };
    }
    return {
        status: 'valid',
        observationKeys: Array.from(observationKeys),
        sourceIds: Array.from(sourceIds)
    };
}

export function hasAgentVisualDeliveryObservationCoverage(
    toolResult: unknown,
    outerToolName: string,
    targetObservationIds: readonly string[]
): boolean {
    const targets = new Set(targetObservationIds
        .map((sourceId) => normalizeVisualDeliverySourceId(
            sourceId,
            undefined,
            outerToolName
        ))
        .filter(Boolean));
    if (targets.size === 0) return false;
    const observationSet = inspectAgentVisualDeliveryObservationSet(toolResult, outerToolName);
    if (observationSet.status !== 'valid') return false;
    const observed = new Set(observationSet.sourceIds);
    return observed.size === targets.size
        && Array.from(targets).every((sourceId) => observed.has(sourceId));
}

/**
 * Workflow 交付候选的 Runtime 视觉握手。
 *
 * 这里只接受 Runtime 身份标记的 receipt 与逐图 review；Bundle 自带结论、匿名
 * reviewed 字段或部分覆盖均不能解锁交付。
 */
export function resolveAgentVisualDeliveryReviewStatus(
    toolResult: unknown,
    outerToolName: string,
    options?: {
        targetObservationIds?: readonly string[];
    }
): AgentVisualDeliveryReviewStatus {
    const observationSet = inspectAgentVisualDeliveryObservationSet(toolResult, outerToolName);
    if (observationSet.status === 'pending') return 'pending';
    if (observationSet.status === 'unreadable') return 'unreadable';
    const observationKeys = new Set(observationSet.observationKeys);
    const sourceIds = new Set(observationSet.sourceIds);
    const output = isVisualRuntimeObject(toolResult) ? toolResult : undefined;
    const data = isVisualRuntimeObject(output?.data) ? output?.data : undefined;
    const deliveryCandidate = isVisualRuntimeObject(data?.deliveryCandidate)
        ? data?.deliveryCandidate
        : undefined;
    let rawTargetObservationIds: unknown[] = [];
    if (Array.isArray(options?.targetObservationIds)
        && options.targetObservationIds.length > 0) {
        rawTargetObservationIds = [...options.targetObservationIds];
    } else if (Array.isArray(deliveryCandidate?.targetObservationIds)) {
        rawTargetObservationIds = deliveryCandidate.targetObservationIds;
    } else if (Array.isArray(deliveryCandidate?.targetScreenIds)) {
        rawTargetObservationIds = deliveryCandidate.targetScreenIds
            .map((screenId) => `screen:${screenId}`);
    }
    const targetObservationIds = new Set(rawTargetObservationIds
        .map((sourceId) => normalizeVisualDeliverySourceId(
            sourceId,
            undefined,
            outerToolName
        ))
        .filter(Boolean));
    if (targetObservationIds.size > 0
        && (targetObservationIds.size !== sourceIds.size
            || Array.from(targetObservationIds).some((sourceId) => !sourceIds.has(sourceId)))) {
        return 'unreadable';
    }

    const decisionsByKey = new Map(
        readAgentVisualObservations(toolResult).flatMap((observation) => (
            observation.reviewDecision && observation.reviewed === true
                ? [[observation.reviewDecision.observationKey, observation.reviewDecision] as const]
                : []
        ))
    );
    const decisions = Array.from(observationKeys).map((key) => decisionsByKey.get(key));
    if (decisions.some((decision) => !decision)) return 'pending';
    if (decisions.some((decision) => decision?.status === 'needs_fix')) return 'needs_fix';
    if (decisions.some((decision) => decision?.status === 'unreadable')) return 'unreadable';
    return decisions.every((decision) => decision?.status === 'passed')
        ? 'passed'
        : 'pending';
}

export function resolveVisualObservationStrategy(input: {
    primaryModelSupportsVision: boolean;
}): VisualObservationStrategy {
    if (input.primaryModelSupportsVision) {
        return 'primary-self';
    }
    return 'no-visual-capability';
}

const VISUAL_EXPERT_QUALITY_CHECKLIST = [
    '你是视觉核对专家。只根据这张设计稿画面，如实描述当前真实状态，供主 Agent 决定下一步：',
    '1) 主体是什么、是否清晰突出；主体相对容器是过大、过小还是合适，裁切是否合理；',
    '2) 构图与层次：主次是否清楚、有无明显空洞或失衡；主体重心是否需要移动；',
    '3) 排版问题：文字/元素有无遮挡、重叠、出血、对齐错乱、超出画布；',
    '4) 文字是否清晰可读；',
    '5) 是否还停在「产品图 + 居中文字、白底、无背景设计」的排版级，缺少设计感。',
    '若主体大小或位置有问题，请明确建议放大、缩小或移动方向，但不要猜像素坐标或固定缩放百分比。',
    '用简体中文说事实，简洁直接，不要客套，绝不编造画面上看不到的内容。'
];

const LAYER_ORGANIZATION_VISUAL_CHECKLIST = [
    '你正在复核一次纯图层结构整理后的画面。Harness 已用原始画布指纹另行验证整理前后像素是否一致。',
    '这里只检查当前图片是否可读，以及是否出现明显的图层消失、异常裁切、透明度/混合异常或破坏性渲染。',
    '不要评价原设计的审美、构图、文案或排版质量；这些既有问题不属于本次图层归组任务。',
    '图片可读且没有明显结构性渲染异常时用 passed；无法读取用 unreadable；明确出现破坏性异常才用 needs_fix。'
];

/**
 * 视觉专家替主模型看单图时的聚焦指令。
 * 同时按设计质量自检反馈（不止排版正确性），与 design-principles 的排版及格线红线呼应。
 */
export const VISUAL_EXPERT_OBSERVATION_PROMPT = [
    ...VISUAL_EXPERT_QUALITY_CHECKLIST,
    `只返回 JSON：{"version":"${VISUAL_OBSERVATION_REVIEW_DECISION_VERSION}","observationKey":"由调用方提供","status":"passed|needs_fix|unreadable","reviewer":"visual_expert","summary":"观察结论","issues":["问题1"]}。`,
    '有明确视觉问题时用 needs_fix；像素无法读取时用 unreadable；只有真实看过且没有发现需修问题时才用 passed。'
].join('\n');

export interface VisualExpertReviewBatchPromptItem {
    observationKey: string;
    label: string;
    sourceKind?: string;
}

/**
 * 多图批复核仍逐 observationKey 形成观察决定；批次只节约模型调用，不合并观察记录身份。
 * 图片与清单按同一顺序交给 Provider，不能依赖文字块和图片块在所有 Provider 中交错保留。
 */
export function buildVisualExpertReviewBatchPrompt(
    items: readonly VisualExpertReviewBatchPromptItem[]
): string {
    const isLayerOrganizationReview = items.length > 0
        && items.every((item) => (
            item.sourceKind === 'semantic-layer-organization-region'
        ));
    const checklist = isLayerOrganizationReview
        ? LAYER_ORGANIZATION_VISUAL_CHECKLIST
        : VISUAL_EXPERT_QUALITY_CHECKLIST;
    const observationList = items.map((item, index) => (
        `图片 ${index + 1}：${item.label}；observationKey=${item.observationKey}`
    ));
    return [
        ...checklist,
        '',
        `本批共有 ${items.length} 张图片。必须按图片顺序分别复核，不能用一条结论代替整批。`,
        ...observationList,
        '',
        `只返回 JSON：{"version":"${VISUAL_OBSERVATION_REVIEW_BATCH_VERSION}","decisions":[{"version":"${VISUAL_OBSERVATION_REVIEW_DECISION_VERSION}","observationKey":"从上方清单原样复制","status":"passed|needs_fix|unreadable","reviewer":"visual_expert","summary":"该图观察结论","issues":["问题1"]}]}。`,
        '每张真实看过的图片各返回一条 decision；无法读取时用 unreadable；有问题用 needs_fix；没有发现需修问题才用 passed。',
        '不要返回清单之外的 observationKey，不要省略已查看图片，也不要输出 Markdown 代码块或 JSON 之外的文字。'
    ].join('\n');
}

const PRIMARY_VISUAL_REVIEW_BLOCK_PATTERN =
    /<visual_observation_review>\s*([\s\S]*?)\s*<\/visual_observation_review>/gi;

export function buildPrimaryVisualObservationReviewInstruction(
    observationKey: string,
    label: string,
    sourceKind?: string
): string {
    const reviewBoundary = sourceKind === 'semantic-layer-organization-region'
        ? [
            '这是纯图层结构整理后的复核：只判断图片是否可读、是否出现图层消失、异常裁切或混合/透明度破坏。',
            '不要把原设计既有的审美、文案或排版问题算作本次归组失败；整理前后像素等价由 Harness 指纹另行证明。'
        ]
        : [];
    return [
        `视觉观察记录：${label}；observationKey=${observationKey}`,
        '你必须真实查看这张图后，才可在本次回复中附加结构化复核。',
        ...reviewBoundary,
        `格式：<visual_observation_review>{"version":"${VISUAL_OBSERVATION_REVIEW_BATCH_VERSION}","decisions":[{"version":"${VISUAL_OBSERVATION_REVIEW_DECISION_VERSION}","observationKey":"${observationKey}","status":"passed|needs_fix|unreadable","reviewer":"primary_model","summary":"简短观察","issues":[]}]}</visual_observation_review>`,
        '若本次回复没有判断这张图，不要输出该 observationKey；普通回复或工具调用不会被视为已复核。'
    ].join('\n');
}

export function consumePrimaryVisualObservationReviewBatch(
    content: unknown
): { content: string; batch?: VisualObservationReviewBatch } {
    const text = String(content || '');
    const decisions = new Map<string, VisualObservationReviewDecision>();
    const conflicted = new Set<string>();
    let match: RegExpExecArray | null;
    PRIMARY_VISUAL_REVIEW_BLOCK_PATTERN.lastIndex = 0;
    while ((match = PRIMARY_VISUAL_REVIEW_BLOCK_PATTERN.exec(text)) !== null) {
        let parsed: unknown;
        try {
            parsed = JSON.parse(match[1]);
        } catch {
            continue;
        }
        const batch = readVisualObservationReviewBatch(parsed);
        for (const decision of batch?.decisions || []) {
            if (decision.reviewer !== 'primary_model' || conflicted.has(decision.observationKey)) continue;
            const previous = decisions.get(decision.observationKey);
            if (!previous) {
                decisions.set(decision.observationKey, decision);
                continue;
            }
            if (!sameVisualObservationReviewDecision(previous, decision)) {
                decisions.delete(decision.observationKey);
                conflicted.add(decision.observationKey);
            }
        }
    }
    const cleaned = text.replace(PRIMARY_VISUAL_REVIEW_BLOCK_PATTERN, '').trim();
    if (decisions.size === 0) return { content: cleaned };
    return {
        content: cleaned,
        batch: {
            version: VISUAL_OBSERVATION_REVIEW_BATCH_VERSION,
            decisions: Array.from(decisions.values())
        }
    };
}

export function parseVisualExpertReviewDecision(
    content: unknown,
    observationKey: string
): VisualObservationReviewDecision | undefined {
    let parsed: unknown;
    try {
        parsed = JSON.parse(String(content || '').trim());
    } catch {
        return undefined;
    }
    const decision = readVisualObservationReviewDecision(parsed, observationKey);
    if (!decision || decision.reviewer !== 'visual_expert') return undefined;
    return decision;
}

function sameVisualObservationReviewDecision(
    left: VisualObservationReviewDecision,
    right: VisualObservationReviewDecision
): boolean {
    return left.status === right.status
        && left.summary === right.summary
        && JSON.stringify(left.issues || []) === JSON.stringify(right.issues || []);
}

/**
 * 只接受本批白名单中的 visual_expert 决定。部分返回可以部分生效；
 * 同 key 冲突则该 key 整体无效，禁止用数组顺序或 last-wins 猜测。
 */
export function parseVisualExpertReviewBatch(
    content: unknown,
    expectedObservationKeys: readonly string[]
): VisualObservationReviewBatch | undefined {
    let parsed: unknown;
    try {
        parsed = JSON.parse(String(content || '').trim());
    } catch {
        return undefined;
    }
    const batch = readVisualObservationReviewBatch(parsed);
    if (!batch) return undefined;

    const expected = new Set(expectedObservationKeys.map((item) => String(item || '').trim()).filter(Boolean));
    if (expected.size === 0) return undefined;
    const decisions = new Map<string, VisualObservationReviewDecision>();
    const conflicted = new Set<string>();
    for (const decision of batch.decisions) {
        if (decision.reviewer !== 'visual_expert'
            || !expected.has(decision.observationKey)
            || conflicted.has(decision.observationKey)) {
            continue;
        }
        const previous = decisions.get(decision.observationKey);
        if (!previous) {
            decisions.set(decision.observationKey, decision);
            continue;
        }
        if (!sameVisualObservationReviewDecision(previous, decision)) {
            decisions.delete(decision.observationKey);
            conflicted.add(decision.observationKey);
        }
    }
    if (decisions.size === 0) return undefined;
    return {
        version: VISUAL_OBSERVATION_REVIEW_BATCH_VERSION,
        decisions: Array.from(decisions.values())
    };
}

/** 用户附件交给视觉专家时的独立观察指令；主模型只接收结构化视觉结论。 */
export const VISUAL_EXPERT_INPUT_PROMPT = [
    '你是主 Agent 的视觉专家。请只根据用户上传的图片提取可验证的视觉事实：',
    '1) 每张图片的主体、场景、文字和关键视觉元素；',
    '2) 构图、层级、配色、排版与风格特征；',
    '3) 与用户目标直接相关、可供后续设计或 Photoshop 操作使用的约束；',
    '4) 无法从图片确认的内容要明确标为未知。',
    '按图片顺序用简体中文输出精炼的结构化观察；不要替主 Agent 做最终决策，不要编造。'
].join('\n');
