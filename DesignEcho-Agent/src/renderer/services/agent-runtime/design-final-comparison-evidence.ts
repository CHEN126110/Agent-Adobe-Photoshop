import { sha256Hex } from '../../../shared/agent-runtime-v5/content-hash';
import type { RuntimeReferenceSourceKind } from '../../../shared/agent-runtime-v5/contracts';
import type {
    RuntimeReferenceBriefDeclaration
} from '../../../shared/agent-runtime-v5/runtime-reference-context';
import {
    buildRuntimeReferenceVisualContextRef
} from '../../../shared/agent-runtime-v5/runtime-reference-context';
import { normalizeAssetPathKey } from '../../../shared/design-run-tool-log-facts';
import { buildVisualObservationKey } from '../../../shared/visual-observation-bundle';
import type { AgentToolCallLogEntry, ContentBlock } from './types';
import type { TrustedFinalComparisonReplayProjection } from './trusted-final-comparison-evidence';
import {
    readAgentVisualObservationOverflow,
    readAgentVisualObservations,
    type AgentVisualObservation
} from './visual-observation-strategy';

/**
 * Final Judge 的候选集 / 参考图比较输入规划。
 *
 * 本模块不扫描项目、不调用 Tool、不读取文件、不保存像素，也不选择素材赢家。调用方只能
 * 传入 Agent 已主动调用并真实复核的 Tool entry，以及按该 entry 精确重放出的单张像素；
 * 任一身份、声明、像素摘要或整体预算不完整时，对应能力保持 unevaluated。
 */

export const MAX_FINAL_JUDGE_DECLARED_REFERENCE_IMAGES = 3;

const CANDIDATE_SET_TOOL_NAMES = new Set([
    'analyzeProjectContactSheetOverview',
    'browseAssetCandidates',
    'recommendAssets'
]);

const REFERENCE_PIXEL_TOOL_NAMES = new Set([
    'analyzeEagleReference'
]);

/**
 * Tool log 会在每轮视觉观察后立即删除大像素；终审不能等到收尾再从日志“重新发现”图片。
 * 这个 WeakMap 只保存当前 Agent run 中已经真实加入主模型 contentBlocks 的有界 presentation，
 * 不持久化、不进入 Tool result、不跨对象克隆，也不保存项目扫描或候选排名。
 */
interface RuntimeComparisonPresentationReplay {
    image: DesignFinalComparisonReplayImage;
    /** 与 presentation 同时冻结的候选 slot→path 事实；终审不再首次读取可变 Tool metadata。 */
    candidateCoverage?: CandidateSetCoverageProjection;
}

const RUNTIME_COMPARISON_PRESENTATION_REPLAYS = new WeakMap<
    object,
    Map<string, RuntimeComparisonPresentationReplay>
>();
const MAX_RUNTIME_COMPARISON_PRESENTATIONS_PER_RESULT = 4;
const MAX_RUNTIME_COMPARISON_PRESENTATION_CHARS = 24_000_000;

export type DesignFinalComparisonEvidenceReason =
    | 'not_declared'
    | 'declaration_not_ready'
    | 'declared_reference_limit_exceeded'
    | 'declared_reference_binding_missing'
    | 'declared_reference_binding_ambiguous'
    | 'declared_reference_source_mismatch'
    | 'candidate_set_missing'
    | 'candidate_set_binding_missing'
    | 'candidate_set_binding_ambiguous'
    | 'candidate_set_coverage_invalid'
    | 'tool_not_allowed'
    | 'tool_not_model_selected'
    | 'tool_result_failed'
    | 'runtime_visual_observation_missing'
    | 'runtime_visual_observation_ambiguous'
    | 'runtime_visual_observation_incomplete'
    | 'runtime_visual_observation_source_mismatch'
    | 'runtime_visual_observation_overflow'
    | 'presented_pixel_digest_missing'
    | 'replay_image_missing'
    | 'replay_image_invalid'
    | 'replay_pixel_changed'
    | 'visual_capacity_insufficient';

export interface DesignFinalComparisonReplayImage {
    data: string;
    mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
}

/**
 * 参考像素候选必须由 RuntimeReferenceBrief 的精确 context ref 指向。sourceId 只在运行内
 * 匹配，不进入 Final Judge 标签、Run Record 或持久化状态。
 */
export interface DesignFinalDeclaredReferenceReplay {
    contextRef: string;
    sourceKind: RuntimeReferenceSourceKind;
    sourceId: string;
    toolCall: AgentToolCallLogEntry;
    replayImage?: DesignFinalComparisonReplayImage;
}

/**
 * 候选联系表只绑定实际显示的源图。selectedSourcePaths 来自 Agent 最终真实放置的源图事实；
 * 本模块只做集合包含关系，不按文件名、分数、顺序或角色选出赢家。
 */
export interface DesignFinalCandidateSetReplay {
    toolCall: AgentToolCallLogEntry;
    replayImage?: DesignFinalComparisonReplayImage;
    capturedCoverage?: CandidateSetCoverageProjection;
}

export interface DesignFinalComparisonEvidenceScopeResult {
    status: 'ready' | 'unevaluated';
    reasonCodes: DesignFinalComparisonEvidenceReason[];
    imageCount: number;
}

export interface DesignFinalComparisonEvidencePlan {
    contentBlocks: ContentBlock[];
    candidateKeys: string[];
    candidateCount: number;
    contextMessage: string;
    evidenceScope: {
        declaredReferenceCompared: boolean;
        candidateSetCompared: boolean;
    };
    coverage: {
        declaredReference: DesignFinalComparisonEvidenceScopeResult;
        candidateSet: DesignFinalComparisonEvidenceScopeResult;
    };
    /** 仅供同一 TaskRun 的 post-Judge WeakMap Artifact；不进入模型 payload 或 Run Record。 */
    carryover: {
        candidateSet?: {
            evidenceId: string;
            sourceManifest: ReadonlyArray<{ slotId: string; path: string }>;
            image: DesignFinalComparisonReplayImage;
        };
        declaredReferences?: ReadonlyArray<{
            evidenceId: string;
            sourceKind: RuntimeReferenceSourceKind;
            sourceId: string;
            observationSourceId: string;
            image: DesignFinalComparisonReplayImage;
        }>;
    };
}

interface ReplayableAgentVisualObservation extends AgentVisualObservation {
    /**
     * Runtime 对实际加入主模型请求的 presentation bytes 计算的 SHA-256。该字段必须
     * 来自现有 Runtime-owned visual annotation owner；Tool 返回或序列化副本无法通过
     * readAgentVisualObservations，预算降级后的缩图也不会被 Tool 原图摘要冒充。
     */
    presentedPixelSha256?: string;
}

interface ValidatedComparisonImage {
    image: DesignFinalComparisonReplayImage;
    observationKey: string;
    observationSourceId?: string | number;
}

interface CandidateSetCoverageProjection {
    status: 'complete' | 'sampled' | 'shortlist';
    candidateUniverseCount?: number;
    attemptedCandidateCount: number;
    displayedCandidateCount: number;
    omittedCandidateCount?: number;
    displayedPaths: string[];
    sourceManifest: Array<{ slotId: string; path: string }>;
}

interface ScopePlanImage {
    image: DesignFinalComparisonReplayImage;
    candidateKey: string;
    label: string;
    sourceKind: 'candidate_set' | RuntimeReferenceSourceKind;
    sourceId: string;
    observationSourceId?: string;
    sourceManifest?: Array<{ slotId: string; path: string }>;
    origin: 'current_run' | 'trusted_parent';
}

interface ScopePlan {
    status: 'ready' | 'unevaluated';
    reasons: DesignFinalComparisonEvidenceReason[];
    images: ScopePlanImage[];
}

function uniqueReasons(
    reasons: readonly DesignFinalComparisonEvidenceReason[]
): DesignFinalComparisonEvidenceReason[] {
    return Array.from(new Set(reasons));
}

function unevaluated(
    ...reasons: DesignFinalComparisonEvidenceReason[]
): ScopePlan {
    return {
        status: 'unevaluated',
        reasons: uniqueReasons(reasons),
        images: []
    };
}

function normalizeReplayImage(
    value: DesignFinalComparisonReplayImage | undefined
): DesignFinalComparisonReplayImage | undefined {
    if (!value || !['image/jpeg', 'image/png', 'image/webp'].includes(value.mediaType)) {
        return undefined;
    }
    const data = String(value.data || '')
        .replace(/^data:image\/(?:png|jpeg|webp);base64,/iu, '')
        .replace(/\s+/gu, '');
    if (data.length < 128 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(data)) return undefined;
    return { data, mediaType: value.mediaType };
}

/**
 * 在视觉消息真正组装时捕获候选/参考 presentation。只有 Runtime-owned 的主模型观察、
 * 与其 presentation digest 完全相同的 bytes，以及允许的比较证据 Tool 才能写入。
 * Tool 自报字段、序列化副本和未实际送给主模型的原图都无法命中这个对象身份。
 */
export function writeDesignFinalComparisonPresentationReplay(input: {
    toolResult: unknown;
    toolName: string;
    observationKey: string;
    replayImage: DesignFinalComparisonReplayImage;
}): boolean {
    if (!input.toolResult || typeof input.toolResult !== 'object') return false;
    if (!CANDIDATE_SET_TOOL_NAMES.has(input.toolName)
        && !REFERENCE_PIXEL_TOOL_NAMES.has(input.toolName)) return false;
    const observationKey = String(input.observationKey || '').trim();
    const replayImage = normalizeReplayImage(input.replayImage);
    if (!observationKey
        || !replayImage
        || replayImage.data.length > MAX_RUNTIME_COMPARISON_PRESENTATION_CHARS) {
        return false;
    }
    const replayDigest = sha256Hex(replayImage.data);
    const observations = readAgentVisualObservations(input.toolResult).filter((observation) => (
        observation.observationKey === observationKey
        && observation.status === 'presented_to_primary'
        && observation.observer === 'primary_model'
        && observation.strategy === 'primary-self'
        && observation.observationIdentity?.outer === input.toolName
        && observation.presentedPixelSha256 === replayDigest
    ));
    if (observations.length !== 1) return false;
    const candidateCoverage = CANDIDATE_SET_TOOL_NAMES.has(input.toolName)
        ? projectCandidateSetCoverage({
            name: input.toolName,
            result: input.toolResult
        } as AgentToolCallLogEntry)
        : undefined;
    if (CANDIDATE_SET_TOOL_NAMES.has(input.toolName) && !candidateCoverage) return false;
    const existing = RUNTIME_COMPARISON_PRESENTATION_REPLAYS.get(input.toolResult);
    const previous = existing?.get(observationKey);
    if (previous) {
        return previous.image.mediaType === replayImage.mediaType
            && previous.image.data === replayImage.data
            && JSON.stringify(previous.candidateCoverage || null)
                === JSON.stringify(candidateCoverage || null);
    }
    const presentations = existing || new Map<string, RuntimeComparisonPresentationReplay>();
    if (presentations.size >= MAX_RUNTIME_COMPARISON_PRESENTATIONS_PER_RESULT) return false;
    presentations.set(observationKey, {
        image: { ...replayImage },
        ...(candidateCoverage ? {
            candidateCoverage: cloneCandidateSetCoverage(candidateCoverage)
        } : {})
    });
    RUNTIME_COMPARISON_PRESENTATION_REPLAYS.set(input.toolResult, presentations);
    return true;
}

function cloneCandidateSetCoverage(
    value: CandidateSetCoverageProjection
): CandidateSetCoverageProjection {
    return {
        ...value,
        displayedPaths: [...value.displayedPaths],
        sourceManifest: value.sourceManifest.map((item) => ({ ...item }))
    };
}

function readDesignFinalComparisonPresentationReplay(
    toolResult: unknown,
    observationKey: string
): RuntimeComparisonPresentationReplay | undefined {
    if (!toolResult || typeof toolResult !== 'object') return undefined;
    const replay = RUNTIME_COMPARISON_PRESENTATION_REPLAYS
        .get(toolResult)
        ?.get(String(observationKey || '').trim());
    return replay ? {
        image: { ...replay.image },
        ...(replay.candidateCoverage ? {
            candidateCoverage: cloneCandidateSetCoverage(replay.candidateCoverage)
        } : {})
    } : undefined;
}

function readSinglePresentationReplay(
    entry: AgentToolCallLogEntry
): RuntimeComparisonPresentationReplay | undefined {
    const runtimeKeys = Array.from(new Set(readAgentVisualObservations(entry.result)
        .map((observation) => String(observation.observationKey || '').trim())
        .filter(Boolean)));
    const matched = runtimeKeys.flatMap((observationKey) => {
        const replay = readDesignFinalComparisonPresentationReplay(entry.result, observationKey);
        return replay ? [replay] : [];
    });
    return matched.length === 1 ? matched[0] : undefined;
}

function readSingleReplayImage(
    entry: AgentToolCallLogEntry
): DesignFinalComparisonReplayImage | undefined {
    return readSinglePresentationReplay(entry)?.image;
}

/** 只收集当前 Agent 自己调用过的候选联系表；是否真看过、是否含选中源图由 planner 再验证。 */
export function collectDesignFinalCandidateSetReplays(
    toolCallLog: readonly AgentToolCallLogEntry[]
): DesignFinalCandidateSetReplay[] {
    return toolCallLog.flatMap((entry) => {
        if (!CANDIDATE_SET_TOOL_NAMES.has(entry.name)) return [];
        const replay = readSinglePresentationReplay(entry);
        return replay?.candidateCoverage ? [{
            toolCall: entry,
            replayImage: replay.image,
            capturedCoverage: replay.candidateCoverage
        }] : [];
    });
}

function isPrimaryConsumedComparisonObservation(
    observation: ReplayableAgentVisualObservation,
    entry: AgentToolCallLogEntry
): boolean {
    const presentedTurn = Number(observation.presentedModelTurn);
    const consumedTurn = Number(observation.consumedModelTurn);
    const identity = observation.observationIdentity;
    const identitySourceId = String(identity?.sourceId ?? '').trim();
    const projectedSourceId = observation.sourceId === undefined
        ? identitySourceId
        : String(observation.sourceId).trim();
    const explicitlyReviewed = observation.status === 'observed_by_primary'
        && observation.reviewed === true
        && observation.observer === 'primary_model'
        && observation.strategy === 'primary-self'
        && observation.reviewDecision?.reviewer === 'primary_model'
        && observation.reviewDecision.status !== 'unreadable'
        && observation.reviewDecision.observationKey === observation.observationKey;
    const consumedWithoutStructuredReview = observation.status === 'presented_to_primary'
        && observation.reviewed !== true
        && !observation.reviewDecision;
    return (explicitlyReviewed || consumedWithoutStructuredReview)
        && observation.observer === 'primary_model'
        && observation.strategy === 'primary-self'
        && Number.isSafeInteger(presentedTurn)
        && Number.isSafeInteger(consumedTurn)
        && consumedTurn >= presentedTurn
        && identity?.outer === entry.name
        && Boolean(observation.observationKey)
        && buildVisualObservationKey(identity) === observation.observationKey
        && Boolean(identitySourceId)
        && projectedSourceId === identitySourceId;
}

function validateComparisonImage(input: {
    toolCall: AgentToolCallLogEntry;
    replayImage?: DesignFinalComparisonReplayImage;
    allowedToolNames: ReadonlySet<string>;
}): { validated?: ValidatedComparisonImage; reasons: DesignFinalComparisonEvidenceReason[] } {
    const reasons: DesignFinalComparisonEvidenceReason[] = [];
    if (!input.allowedToolNames.has(input.toolCall.name)) reasons.push('tool_not_allowed');
    if (input.toolCall.origin !== 'model_tool_call') reasons.push('tool_not_model_selected');
    if (input.toolCall.result?.success !== true) reasons.push('tool_result_failed');
    if (readAgentVisualObservationOverflow(input.toolCall.result)) {
        reasons.push('runtime_visual_observation_overflow');
    }
    const observations = readAgentVisualObservations(input.toolCall.result)
        .filter((item): item is ReplayableAgentVisualObservation => (
            isPrimaryConsumedComparisonObservation(
                item as ReplayableAgentVisualObservation,
                input.toolCall
            )
        ));
    if (observations.length === 0) reasons.push('runtime_visual_observation_missing');
    if (observations.length > 1) reasons.push('runtime_visual_observation_ambiguous');
    const observation = observations.length === 1 ? observations[0] : undefined;
    if (observation && !observation.observationKey) {
        reasons.push('runtime_visual_observation_incomplete');
    }
    const observedDigest = String(observation?.presentedPixelSha256 || '').trim().toLowerCase();
    if (observation && !/^[a-f0-9]{64}$/u.test(observedDigest)) {
        reasons.push('presented_pixel_digest_missing');
    }
    if (!input.replayImage) reasons.push('replay_image_missing');
    const replayImage = normalizeReplayImage(input.replayImage);
    if (input.replayImage && !replayImage) reasons.push('replay_image_invalid');
    if (replayImage
        && /^[a-f0-9]{64}$/u.test(observedDigest)
        && sha256Hex(replayImage.data) !== observedDigest) {
        reasons.push('replay_pixel_changed');
    }
    if (reasons.length > 0 || !observation?.observationKey || !replayImage) {
        return { reasons: uniqueReasons(reasons) };
    }
    return {
        validated: {
            image: replayImage,
            observationKey: observation.observationKey,
            ...(observation.observationIdentity?.sourceId !== undefined
                ? { observationSourceId: observation.observationIdentity.sourceId }
                : {})
        },
        reasons: []
    };
}

function normalizeSourceId(value: unknown): string {
    return String(value || '').trim();
}

function normalizePathSet(values: readonly string[]): Set<string> {
    return new Set(values.map((value) => normalizeAssetPathKey(value)).filter(Boolean));
}

function projectAnalyzeContactSheetCoverage(
    entry: AgentToolCallLogEntry
): CandidateSetCoverageProjection | undefined {
    const coverage = entry.result?.candidateCoverage;
    const items = Array.isArray(entry.result?.contactSheet?.items)
        ? entry.result.contactSheet.items
        : [];
    if (coverage?.version !== 'project-contact-sheet-candidate-coverage/v0'
        || coverage?.doesNotRank !== true
        || coverage?.doesNotSelectWinner !== true
        || !['complete', 'sampled'].includes(coverage?.status)
        || items.length === 0) return undefined;
    const sourceManifest = items
        .filter((item: any) => item?.status === 'rendered')
        .map((item: any) => ({
            slotId: normalizeSourceId(item?.id),
            path: normalizeSourceId(item?.path)
        }));
    if (sourceManifest.some((item: { slotId: string; path: string }) => (
        !item.slotId || !item.path
    ))
        || new Set(sourceManifest.map((item: { slotId: string }) => item.slotId)).size
            !== sourceManifest.length
        || new Set(sourceManifest.map((item: { path: string }) => normalizeAssetPathKey(item.path))).size
            !== sourceManifest.length) return undefined;
    const displayedPaths = sourceManifest.map((item: { path: string }) => item.path);
    const candidateUniverseCount = Number(coverage.candidateUniverseCount);
    const attemptedCandidateCount = Number(coverage.attemptedCandidateCount);
    const displayedCandidateCount = Number(coverage.displayedCandidateCount);
    const omittedCandidateCount = Number(coverage.omittedCandidateCount);
    if (![candidateUniverseCount, attemptedCandidateCount, displayedCandidateCount, omittedCandidateCount]
        .every((count) => Number.isSafeInteger(count) && count >= 0)
        || displayedCandidateCount !== displayedPaths.length
        || attemptedCandidateCount !== displayedCandidateCount
        || candidateUniverseCount < attemptedCandidateCount
        || omittedCandidateCount !== candidateUniverseCount - displayedCandidateCount) {
        return undefined;
    }
    return {
        status: coverage.status,
        candidateUniverseCount,
        attemptedCandidateCount,
        displayedCandidateCount,
        omittedCandidateCount,
        displayedPaths,
        sourceManifest
    };
}

function projectAssetCandidateCoverage(
    entry: AgentToolCallLogEntry
): CandidateSetCoverageProjection | undefined {
    const comparison = entry.result?.visualComparison;
    const candidatePage = entry.result?.candidatePage;
    const items = Array.isArray(entry.result?.comparisonItems)
        ? entry.result.comparisonItems
        : [];
    const isNeutralCandidatePage = candidatePage?.version === 'asset-candidate-page/v1'
        && candidatePage?.ranked === false
        && candidatePage?.winnerSelected === false
        && candidatePage?.ordering === 'stable_source_aspect_span_round_robin';
    const isLegacyAdvisoryShortlist = comparison?.rankingIsAdvisory === true
        && comparison?.agentSelectsFinalAsset === true;
    if (!isNeutralCandidatePage && !isLegacyAdvisoryShortlist) return undefined;
    const sourceManifest = items
        .filter((item: any) => item?.status === 'rendered')
        .map((item: any) => ({
            slotId: normalizeSourceId(item?.id),
            path: normalizeSourceId(item?.path)
        }));
    if (sourceManifest.some((item: { slotId: string; path: string }) => (
        !item.slotId || !item.path
    ))
        || new Set(sourceManifest.map((item: { slotId: string }) => item.slotId)).size
            !== sourceManifest.length
        || new Set(sourceManifest.map((item: { path: string }) => normalizeAssetPathKey(item.path))).size
            !== sourceManifest.length) return undefined;
    const displayedPaths = sourceManifest.map((item: { path: string }) => item.path);
    // visualComparison.comparedCount 是上游 advisory JSON 成功解析的条目数，不是联系表
    // 实际渲染或主 Agent 实际看见的格数。终审证据以冻结的 rendered slot manifest +
    // 主模型 observation/review 为准，不能让内部推荐解析漏一项否决真实视觉比较。
    const displayedCandidateCount = displayedPaths.length;
    if (displayedCandidateCount <= 0) return undefined;
    if (isNeutralCandidatePage) {
        const candidateSetId = normalizeSourceId(candidatePage.candidateSetId);
        const page = Number(candidatePage.page);
        const pageSize = Number(candidatePage.pageSize);
        const totalCandidates = Number(candidatePage.totalCandidates);
        const totalPages = Number(candidatePage.totalPages);
        const expectedTotalPages = totalCandidates > 0
            ? Math.ceil(totalCandidates / pageSize)
            : 0;
        const expectedAttemptedCount = Math.min(
            pageSize,
            Math.max(0, totalCandidates - ((page - 1) * pageSize))
        );
        const hasMore = candidatePage.hasMore === true;
        const nextPage = Number(candidatePage.nextPage);
        if (!/^candidate-set-v1-[a-f0-9]{16}$/u.test(candidateSetId)
            || !Number.isSafeInteger(page) || page < 1
            || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 12
            || !Number.isSafeInteger(totalCandidates) || totalCandidates < 1
            || !Number.isSafeInteger(totalPages) || totalPages !== expectedTotalPages
            || page > totalPages
            || items.length !== expectedAttemptedCount
            || displayedCandidateCount > items.length
            || hasMore !== (page < totalPages)
            || (hasMore && nextPage !== page + 1)
            || (!hasMore && candidatePage.nextPage !== undefined)) {
            return undefined;
        }
        return {
            status: displayedCandidateCount === totalCandidates ? 'complete' : 'sampled',
            candidateUniverseCount: totalCandidates,
            attemptedCandidateCount: items.length,
            displayedCandidateCount,
            omittedCandidateCount: totalCandidates - displayedCandidateCount,
            displayedPaths,
            sourceManifest: sourceManifest.map((item: { slotId: string; path: string }) => ({
                ...item,
                slotId: `${candidateSetId}:${item.slotId}`
            }))
        };
    }
    return {
        // recommendAssets 上游只暴露实际显示 shortlist，不披露完整项目候选全集。终审可以
        // 比较这张 Agent 真看过的联系表，但不能把它写成完整 universe 或“未遗漏候选”。
        status: 'shortlist',
        attemptedCandidateCount: displayedCandidateCount,
        displayedCandidateCount,
        displayedPaths,
        sourceManifest
    };
}

function projectCandidateSetCoverage(
    entry: AgentToolCallLogEntry
): CandidateSetCoverageProjection | undefined {
    if (entry.name === 'analyzeProjectContactSheetOverview') {
        return projectAnalyzeContactSheetCoverage(entry);
    }
    if (entry.name === 'browseAssetCandidates' || entry.name === 'recommendAssets') {
        return projectAssetCandidateCoverage(entry);
    }
    return undefined;
}

function buildCandidateSetScope(input: {
    candidates: readonly DesignFinalCandidateSetReplay[];
    selectedSourcePaths: readonly string[];
}): ScopePlan {
    if (input.candidates.length === 0) return unevaluated('candidate_set_missing');
    const selectedPaths = normalizePathSet(input.selectedSourcePaths);
    if (selectedPaths.size === 0) return unevaluated('candidate_set_binding_missing');
    const projectedCandidates = input.candidates.flatMap((candidate) => {
        const coverage = candidate.capturedCoverage;
        if (!coverage) return [];
        return [{ candidate, coverage }];
    });
    if (projectedCandidates.length === 0) return unevaluated('candidate_set_coverage_invalid');
    const matching = projectedCandidates.flatMap(({ candidate, coverage }) => {
        const displayed = normalizePathSet(coverage.displayedPaths);
        return Array.from(selectedPaths).every((path) => displayed.has(path))
            ? [{ candidate, coverage }]
            : [];
    });
    if (matching.length === 0) return unevaluated('candidate_set_binding_missing');
    // browseAssetCandidates / legacy recommendAssets 是 Agent 主动发起的候选比较；
    // analyzeProjectContactSheetOverview 只是更宽的项目视觉库存。存在精确 shortlist 时只把
    // 同类 shortlist 视为候选集绑定，不让宽总览制造假歧义；多个 shortlist 仍 fail closed。
    const shortlistMatches = matching.filter(({ candidate }) => (
        candidate.toolCall.name === 'browseAssetCandidates'
        || candidate.toolCall.name === 'recommendAssets'
    ));
    const roleBoundMatches = shortlistMatches.length > 0 ? shortlistMatches : matching;
    if (roleBoundMatches.length > 1) return unevaluated('candidate_set_binding_ambiguous');
    const selected = roleBoundMatches[0];
    if (selected.coverage.displayedCandidateCount <= 1) {
        return unevaluated('candidate_set_coverage_invalid');
    }
    const imageResult = validateComparisonImage({
        toolCall: selected.candidate.toolCall,
        replayImage: selected.candidate.replayImage,
        allowedToolNames: CANDIDATE_SET_TOOL_NAMES
    });
    if (!imageResult.validated) return unevaluated(...imageResult.reasons);
    const key = `final_comparison:candidate_set:${sha256Hex(imageResult.validated.observationKey).slice(0, 16)}`;
    return {
        status: 'ready',
        reasons: [],
        images: [{
            image: imageResult.validated.image,
            candidateKey: key,
            sourceKind: 'candidate_set',
            sourceId: key,
            sourceManifest: selected.coverage.sourceManifest.map((item) => ({ ...item })),
            origin: 'current_run',
            label: [
                '候选联系表｜type=agent_consumed_candidate_set',
                `coverage=${selected.coverage.status}`,
                `displayed=${selected.coverage.displayedCandidateCount}`,
                `universe=${selected.coverage.candidateUniverseCount ?? 'unknown'}`,
                `omitted=${selected.coverage.omittedCandidateCount ?? 'unknown'}`,
                '终审组装未重新检索、未重新排序、未选择赢家；只重放已真实呈现给 Agent、由成功模型回合消费且包含最终选中源图的联系表；结构化自评状态仍由原观察记录单独表达'
            ].join('｜')
        }]
    };
}

function collectDeclaredReferenceRefs(
    declaration: RuntimeReferenceBriefDeclaration
): string[] {
    const refs: string[] = [];
    const seen = new Set<string>();
    for (const insight of declaration.insights) {
        for (const rawRef of insight.observationRefs) {
            const ref = normalizeSourceId(rawRef);
            if (!ref || seen.has(ref)) continue;
            seen.add(ref);
            refs.push(ref);
        }
    }
    return refs;
}

function readDeclaredReferenceKind(
    declaration: RuntimeReferenceBriefDeclaration,
    contextRef: string
): RuntimeReferenceSourceKind | undefined | 'ambiguous' {
    const kinds = Array.from(new Set(declaration.sources
        .filter((source) => source.sourceRefs.includes(contextRef))
        .map((source) => source.kind)));
    if (kinds.length === 0) return undefined;
    if (kinds.length > 1) return 'ambiguous';
    return kinds[0];
}

/**
 * 只把 ready Reference Brief 精确点名的 Eagle 观察映射回同一次模型 Tool Call。
 * 搜索结果、未声明观察和本地路径都不会进入返回值。
 */
export function collectDesignFinalDeclaredReferenceReplays(input: {
    declaration?: RuntimeReferenceBriefDeclaration;
    toolCallLog: readonly AgentToolCallLogEntry[];
}): DesignFinalDeclaredReferenceReplay[] {
    if (!input.declaration || input.declaration.readiness !== 'ready') return [];
    const declaredRefs = new Set(collectDeclaredReferenceRefs(input.declaration));
    return input.toolCallLog.flatMap((entry, index) => {
        if (entry.name !== 'analyzeEagleReference' || entry.result?.success !== true) return [];
        const itemId = normalizeSourceId(
            entry.result?.item?.id || entry.arguments?.itemId || entry.arguments?.id
        ).replace(/^eagle:/iu, '');
        if (!itemId) return [];
        const contextRef = buildRuntimeReferenceVisualContextRef(itemId, index + 1);
        if (!declaredRefs.has(contextRef)) return [];
        const declaredKind = readDeclaredReferenceKind(input.declaration!, contextRef);
        if (declaredKind !== 'eagle') return [];
        const replayImage = readSingleReplayImage(entry);
        return replayImage ? [{
            contextRef,
            sourceKind: 'eagle',
            sourceId: `eagle:${itemId}`,
            toolCall: entry,
            replayImage
        }] : [];
    });
}

function normalizeEagleItemId(value: unknown): string {
    return normalizeSourceId(value).replace(/^eagle:/iu, '');
}

function referenceSourceMatchesTool(
    candidate: DesignFinalDeclaredReferenceReplay
): boolean {
    const entry = candidate.toolCall;
    if (entry.name === 'analyzeEagleReference') {
        if (candidate.sourceKind !== 'eagle') return false;
        const actual = normalizeEagleItemId(
            entry.result?.item?.id || entry.arguments?.itemId || entry.arguments?.id
        );
        return Boolean(actual) && actual === normalizeEagleItemId(candidate.sourceId);
    }
    if (entry.name === 'analyzeAssetContent') {
        if (!['project_case', 'user_reference', 'brand_template'].includes(candidate.sourceKind)) {
            return false;
        }
        const actual = normalizeAssetPathKey(
            entry.arguments?.imagePath || entry.arguments?.path
        );
        return Boolean(actual) && actual === normalizeAssetPathKey(candidate.sourceId);
    }
    if (entry.name === 'observeEagleAsset') {
        if (candidate.sourceKind !== 'eagle') return false;
        const actual = normalizeSourceId(
            entry.result?.assetRef
            || entry.result?.item?.id
            || entry.arguments?.assetRef
            || entry.arguments?.itemId
        );
        return Boolean(actual) && actual === normalizeSourceId(candidate.sourceId);
    }
    return false;
}

function buildDeclaredReferenceScope(input: {
    declaration?: RuntimeReferenceBriefDeclaration;
    candidates: readonly DesignFinalDeclaredReferenceReplay[];
}): ScopePlan {
    if (!input.declaration) return unevaluated('not_declared');
    if (input.declaration.readiness !== 'ready') return unevaluated('declaration_not_ready');
    const refs = collectDeclaredReferenceRefs(input.declaration);
    if (refs.length === 0) return unevaluated('declared_reference_binding_missing');
    if (refs.length > MAX_FINAL_JUDGE_DECLARED_REFERENCE_IMAGES) {
        return unevaluated('declared_reference_limit_exceeded');
    }
    const images: ScopePlan['images'] = [];
    for (let index = 0; index < refs.length; index += 1) {
        const contextRef = refs[index];
        const declaredKind = readDeclaredReferenceKind(input.declaration, contextRef);
        if (declaredKind === 'ambiguous') {
            return unevaluated('declared_reference_binding_ambiguous');
        }
        if (!declaredKind) return unevaluated('declared_reference_binding_missing');
        const candidates = input.candidates.filter((candidate) => (
            candidate.contextRef === contextRef && candidate.sourceKind === declaredKind
        ));
        if (candidates.length === 0) return unevaluated('declared_reference_binding_missing');
        if (candidates.length > 1) return unevaluated('declared_reference_binding_ambiguous');
        const candidate = candidates[0];
        const imageResult = validateComparisonImage({
            toolCall: candidate.toolCall,
            replayImage: candidate.replayImage,
            allowedToolNames: REFERENCE_PIXEL_TOOL_NAMES
        });
        if (!imageResult.validated) return unevaluated(...imageResult.reasons);
        if (!referenceSourceMatchesTool(candidate)) {
            return unevaluated('declared_reference_source_mismatch');
        }
        const observationSourceId = normalizeSourceId(
            imageResult.validated.observationSourceId
        );
        const observationMatchesSource = candidate.sourceKind === 'eagle'
            ? normalizeEagleItemId(observationSourceId)
                === normalizeEagleItemId(candidate.sourceId)
            : normalizeAssetPathKey(observationSourceId)
                === normalizeAssetPathKey(candidate.sourceId);
        if (!observationSourceId || !observationMatchesSource) {
            return unevaluated('runtime_visual_observation_source_mismatch');
        }
        const candidateKey = `final_comparison:declared_reference:${sha256Hex(`${contextRef}:${imageResult.validated.observationKey}`).slice(0, 16)}`;
        images.push({
            image: imageResult.validated.image,
            candidateKey,
            sourceKind: declaredKind,
            sourceId: candidate.sourceId,
            observationSourceId,
            origin: 'current_run',
            label: `声明参考 ${index + 1}｜type=agent_declared_consumed_reference｜kind=${declaredKind}｜该图已真实呈现给 Agent 并由成功模型回合消费，且只因 RuntimeReferenceBrief 精确绑定而进入终审；不把缺少结构化自评伪装成审美通过`
        });
    }
    return { status: 'ready', reasons: [], images };
}

function projectScopeResult(scope: ScopePlan): DesignFinalComparisonEvidenceScopeResult {
    return {
        status: scope.status,
        reasonCodes: uniqueReasons(scope.reasons),
        imageCount: scope.images.length
    };
}

function applyWholeBundleCapacity(input: {
    candidateSet: ScopePlan;
    declaredReference: ScopePlan;
    availableImageSlots: number;
}): { candidateSet: ScopePlan; declaredReference: ScopePlan } {
    const availableImageSlots = Number.isFinite(Number(input.availableImageSlots))
        ? Math.max(0, Math.floor(Number(input.availableImageSlots)))
        : 0;
    const required = input.candidateSet.images.length + input.declaredReference.images.length;
    if (required <= availableImageSlots) {
        return {
            candidateSet: input.candidateSet,
            declaredReference: input.declaredReference
        };
    }
    // 两组都已准备好却无法整体送达时，不由 Harness 决定“候选 vs 参考”谁更重要。
    // 所有原本 ready 的组统一退为 unevaluated；原本缺失的组保留其真实缺失原因。
    return {
        candidateSet: input.candidateSet.status === 'ready'
            ? unevaluated('visual_capacity_insufficient')
            : input.candidateSet,
        declaredReference: input.declaredReference.status === 'ready'
            ? unevaluated('visual_capacity_insufficient')
            : input.declaredReference
    };
}

function buildTrustedParentCandidateScope(
    projection: TrustedFinalComparisonReplayProjection | undefined
): ScopePlan | undefined {
    const candidate = projection?.candidateSet;
    if (!candidate || projection?.evidenceScope.candidateSetCompared !== true) return undefined;
    return {
        status: 'ready',
        reasons: [],
        images: [{
            image: { ...candidate.image },
            candidateKey: `final_comparison:trusted_parent:candidate_set:${candidate.pixelSha256.slice(0, 16)}`,
            label: [
                '候选联系表｜type=reflexion_inherited_agent_observed_candidate_set',
                'coverage=parent_agent_observed_set',
                'universe=unknown',
                '终审只复用同一 TaskRun 父代实际比较过的 exact presentation；当前 selected-source 集合已经重新验证，未重新检索或排序'
            ].join('｜'),
            sourceKind: 'candidate_set',
            sourceId: candidate.sourceIdentityDigest,
            origin: 'trusted_parent'
        }]
    };
}

function buildTrustedParentReferenceScope(
    projection: TrustedFinalComparisonReplayProjection | undefined
): ScopePlan | undefined {
    const references = projection?.declaredReferences;
    if (!Array.isArray(references)
        || references.length === 0
        || projection?.evidenceScope.declaredReferenceCompared !== true) return undefined;
    return {
        status: 'ready',
        reasons: [],
        images: references.map((reference, index) => ({
            image: { ...reference.image },
            candidateKey: `final_comparison:trusted_parent:declared_reference:${reference.pixelSha256.slice(0, 16)}`,
            label: `声明参考 ${index + 1}｜type=reflexion_inherited_agent_declared_observed_reference｜kind=${reference.sourceKind}｜同一 TaskRun 父代实际比较过的 exact presentation`,
            sourceKind: reference.sourceKind as RuntimeReferenceSourceKind,
            sourceId: reference.sourceIdentityDigest,
            observationSourceId: reference.sourceIdentityDigest,
            origin: 'trusted_parent'
        }))
    };
}

export function planDesignFinalComparisonEvidence(input: {
    referenceBrief?: RuntimeReferenceBriefDeclaration;
    declaredReferences?: readonly DesignFinalDeclaredReferenceReplay[];
    candidateSets?: readonly DesignFinalCandidateSetReplay[];
    selectedSourcePaths?: readonly string[];
    /** 已由现有 TrustedVisualReviewArtifact 按 TaskRun/history/document/source 集合复验的父代证据。 */
    trustedParentEvidence?: TrustedFinalComparisonReplayProjection;
    /** Final artifact 与 selected supporting source 已占用后的剩余图片数。 */
    availableImageSlots: number;
}): DesignFinalComparisonEvidencePlan {
    const currentCandidateSet = buildCandidateSetScope({
        candidates: input.candidateSets || [],
        selectedSourcePaths: input.selectedSourcePaths || []
    });
    const currentDeclaredReference = buildDeclaredReferenceScope({
        declaration: input.referenceBrief,
        candidates: input.declaredReferences || []
    });
    const candidateSet = currentCandidateSet.status === 'ready'
        ? currentCandidateSet
        : (buildTrustedParentCandidateScope(input.trustedParentEvidence) || currentCandidateSet);
    const declaredReference = currentDeclaredReference.status === 'ready'
        ? currentDeclaredReference
        : (buildTrustedParentReferenceScope(input.trustedParentEvidence) || currentDeclaredReference);
    const capacityPlan = applyWholeBundleCapacity({
        candidateSet,
        declaredReference,
        availableImageSlots: input.availableImageSlots
    });
    const orderedImages = [
        ...capacityPlan.candidateSet.images,
        ...capacityPlan.declaredReference.images
    ];
    const contentBlocks: ContentBlock[] = [];
    for (const item of orderedImages) {
        contentBlocks.push({ type: 'text', text: item.label });
        contentBlocks.push({
            type: 'image',
            data: item.image.data,
            mediaType: item.image.mediaType
        });
    }
    const candidateSetCoverage = projectScopeResult(capacityPlan.candidateSet);
    const declaredReferenceCoverage = projectScopeResult(capacityPlan.declaredReference);
    const scopeProjection = {
        declaredReference: declaredReferenceCoverage,
        candidateSet: candidateSetCoverage
    };
    return {
        contentBlocks,
        candidateKeys: orderedImages.map((item) => item.candidateKey),
        candidateCount: orderedImages.length,
        contextMessage: [
            `FINAL_COMPARISON_EVIDENCE_SCOPE（缺失项必须按未评价处理，不能由成品工艺分抵消）：${JSON.stringify(scopeProjection)}`,
            candidateSetCoverage.status === 'ready'
                ? '候选集比较只覆盖标签声明的实际显示集合：判断最终选中的素材关系是否兑现当前任务目标，以及是否明显错过同表中更有信息价值的候选；不得把联系表顺序或推荐分数当成赢家。'
                : '',
            declaredReferenceCoverage.status === 'ready'
                ? '声明参考比较只评价 Agent 在 Reference Brief 中点名的可迁移关系是否被当前成品理解和转化；不得要求复制参考的品牌、素材、文字或表面风格。'
                : '',
            capacityPlan.declaredReference.images.some((item) => item.origin === 'trusted_parent')
                ? String(input.trustedParentEvidence?.referenceContext || '')
                : ''
        ].filter(Boolean).join('\n'),
        evidenceScope: {
            declaredReferenceCompared: declaredReferenceCoverage.status === 'ready',
            candidateSetCompared: candidateSetCoverage.status === 'ready'
        },
        coverage: scopeProjection,
        carryover: {
            ...(capacityPlan.candidateSet.status === 'ready'
                && capacityPlan.candidateSet.images[0]?.sourceKind === 'candidate_set'
                && capacityPlan.candidateSet.images[0].sourceManifest
                && capacityPlan.candidateSet.images[0].origin === 'current_run'
                ? {
                    candidateSet: {
                        evidenceId: capacityPlan.candidateSet.images[0].candidateKey,
                        sourceManifest: capacityPlan.candidateSet.images[0].sourceManifest
                            .map((item) => ({ ...item })),
                        image: { ...capacityPlan.candidateSet.images[0].image }
                    }
                }
                : {}),
            ...(capacityPlan.declaredReference.status === 'ready'
                && capacityPlan.declaredReference.images.every((item) => item.origin === 'current_run')
                ? {
                    declaredReferences: capacityPlan.declaredReference.images.map((item) => ({
                        evidenceId: item.candidateKey,
                        sourceKind: item.sourceKind as RuntimeReferenceSourceKind,
                        sourceId: item.sourceId,
                        observationSourceId: String(item.observationSourceId || ''),
                        image: { ...item.image }
                    }))
                }
                : {})
        }
    };
}
