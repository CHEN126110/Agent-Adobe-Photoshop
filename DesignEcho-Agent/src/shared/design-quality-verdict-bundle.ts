/**
 * 设计质量裁决单一口径（纯逻辑，可由现有核心验证复用）。
 *
 * 背景：项目里"设计达标判断"现在有两套来源——
 *   1) task-completion-contract（agent-runtime/types.ts 的 TaskCompletionContract）：required 事实检查，
 *      只查 TaskRun / TaskProfile / 用户显式义务是否有可证明结果，由 agent.ts 早停补救消费；
 *   2) design-quality-assertion 的 DesignScorecard：共享断言→8 维加权评分，查"质量够不够"。
 * 若两者各自被早停门禁/critic/reflexion 直接读取拼判定，会形成第二套并行判定，重蹈项目最痛的
 * "多套重叠正则意图分类器"耦合覆辙。
 *
 * 本模块是**唯一裁决口径**：所有下游（早停门禁、critic、reflexion 重入）只消费 buildDesignVerdict
 * 产出的 DesignVerdict，禁止各自直接读 contract + scorecard 拼判定。
 *
 * 串联（非并行）规则——契约优先，质量其次：
 *   - 非设计任务（无 contract 或 kind 不在 designKinds）→ not_applicable（不评分）。
 *   - 契约里有 qualified failed requirement → failed，且**不看 scorecard**；qualified 表示
 *     确定性失败并携带 blockerKind + proofRef。裸 failed 与审美/可选构成只能进入 needs_review。
 *   - 契约通过但无 scorecard → 回落契约结果（向后兼容：等同当前二元判定）。
 *   - 契约通过 + 有 scorecard → 看 scorecard.gate（按"分级"强制力分流，用户 2026-06-29 拍板）：
 *       gate=failed 且有 qualified blocker → failed；qualified 表示确定性失败并携带 blockerKind + proofRef；
 *       gate=failed 但仅 major 梯度缺陷（无 blocker） → needs_review，进 warnings（**软**，只提示不返工）；
 *       needs_review → needs_review（软）；
 *       incomplete_verification → passed_unverified（**红线：质量没测到不伪造失败**，只标未验证）；
 *       passed → passed。
 *
 * 分级口径：唯一质量"硬阻断"信号是带 blockerKind + proofRef 的确定性失败断言（→ verdict.blockers）；
 * 裸 severity、审美/VLM finding、major 梯度缺陷、needs_review 与覆盖率不足都归 warnings（软）。
 * 下游接线只需把 verdict.blockers→summary.blockers（硬）、
 * verdict.warnings→summary.warnings（软），即实现分级强制力，无需各自重判，杜绝并行判定。
 */

import {
    isQualifiedDesignCompletionHardFailure,
    isQualifiedDesignQualityHardBlocker,
    type AssertionCheckMethod,
    type DesignAssertionResult,
    type DesignQualityBlockerKind,
    type DesignScorecard,
    type DesignScorecardGate
} from './design-quality-assertion';
import { DESIGN_QUALITY_VERDICT_CAPABILITY_ID } from './agent-runtime-v5/capability-provider-identities';

/** 结构化最小契约视图（与 agent-runtime/types.ts 的 TaskCompletionContract 结构兼容，避免 shared→renderer 反向依赖）。 */
export interface DesignVerdictContractView {
    kind: string;
    status: string;
    required: Array<{
        id: string;
        label?: string;
        status: 'passed' | 'failed' | 'needs_review' | 'not_applicable';
        reason?: string;
        method?: AssertionCheckMethod;
        blockerKind?: DesignQualityBlockerKind;
        proofRef?: string;
    }>;
    blockers?: string[];
    warnings?: string[];
    summary?: string;
}

export type DesignVerdictStatus =
    | 'passed'
    | 'failed'
    | 'needs_review'
    | 'passed_unverified'
    | 'not_applicable';

export type DesignVerdictSource = 'contract' | 'scorecard' | 'contract+scorecard' | 'none';

export interface DesignVerdict {
    version: typeof DESIGN_QUALITY_VERDICT_CAPABILITY_ID;
    status: DesignVerdictStatus;
    /** 裁决依据来自哪一层，便于诊断与避免误以为"评分没生效"。 */
    source: DesignVerdictSource;
    contractStatus?: string;
    /** 契约里 status==='failed' 的 required 项 id（产物缺口）。 */
    contractFailedRequirementIds: string[];
    scorecardGate?: DesignScorecardGate;
    /** scorecard 加权总分（0..100），无 scorecard 时为 undefined。 */
    overallScore?: number;
    /** 阻断级原因（人类可读）：产物缺口 + 质量 blocker 断言。 */
    blockers: string[];
    /** 非阻断级提示：契约/质量的 needs_review、覆盖率不足等。 */
    warnings: string[];
    summary: string;
}

export interface BuildDesignVerdictInput {
    contract?: DesignVerdictContractView | null;
    scorecard?: DesignScorecard | null;
    /** 视为"设计任务"的 contract.kind 集合（默认仅 creative_design）。 */
    designKinds?: readonly string[];
}

const DEFAULT_DESIGN_KINDS: readonly string[] = ['creative_design'];

function assertionToText(result: DesignAssertionResult): string {
    const fix = result.expectedFix ? `（建议：${result.expectedFix}）` : '';
    return `${result.rationale || result.id}${fix}`;
}

function notApplicable(reason: string): DesignVerdict {
    return {
        version: DESIGN_QUALITY_VERDICT_CAPABILITY_ID,
        status: 'not_applicable',
        source: 'none',
        contractFailedRequirementIds: [],
        blockers: [],
        warnings: [],
        summary: reason
    };
}

/**
 * 单一裁决口径：把 task-completion-contract 与 DesignScorecard 串联成一个 DesignVerdict。
 * 纯函数，不读运行时、不调模型。
 */
export function buildDesignVerdict(input: BuildDesignVerdictInput): DesignVerdict {
    const contract = input.contract ?? null;
    const scorecard = input.scorecard ?? null;
    const designKinds = input.designKinds ?? DEFAULT_DESIGN_KINDS;

    // 1) 非设计任务：不评分、不裁决质量。
    if (!contract) {
        return notApplicable('无 task-completion-contract，非设计达标裁决范围。');
    }
    if (!designKinds.includes(contract.kind)) {
        return notApplicable(`contract.kind=${contract.kind} 不在设计裁决范围（${designKinds.join('/')}）。`);
    }

    const failedRequirements = contract.required.filter((item) => item.status === 'failed');
    const qualifiedFailedRequirements = failedRequirements.filter(
        isQualifiedDesignCompletionHardFailure
    );
    const unqualifiedFailedRequirements = failedRequirements.filter(
        (item) => !isQualifiedDesignCompletionHardFailure(item)
    );
    const failedRequirementIds = qualifiedFailedRequirements.map((item) => item.id);
    const needsReviewRequirements = contract.required.filter((item) => item.status === 'needs_review');

    // 2) Completion 只有携带确定性事实资格的缺口才能硬失败；裸 failed 与审美缺陷降为复核。
    if (qualifiedFailedRequirements.length > 0) {
        const reqBlockers = qualifiedFailedRequirements.map(
            (item) => item.reason || `${item.label || item.id}：未完成`
        );
        return {
            version: DESIGN_QUALITY_VERDICT_CAPABILITY_ID,
            status: 'failed',
            source: 'contract',
            contractStatus: contract.status,
            contractFailedRequirementIds: failedRequirementIds,
            blockers: reqBlockers,
            warnings: [
                ...(contract.warnings ?? []),
                ...unqualifiedFailedRequirements.map(
                    (item) => item.reason || `${item.label || item.id}：待复核`
                )
            ],
            summary: `产物未齐（${failedRequirementIds.join('、') || contract.status}），先补完产物再谈质量。`
        };
    }

    const contractNeedsReview = contract.status === 'needs_review'
        || contract.status === 'failed'
        || needsReviewRequirements.length > 0
        || unqualifiedFailedRequirements.length > 0;
    const contractNeedsReviewItems = [
        ...needsReviewRequirements,
        ...unqualifiedFailedRequirements
    ];

    // 3) 契约通过但无 scorecard → 回落契约结果（向后兼容当前二元判定）。
    if (!scorecard) {
        const status: DesignVerdictStatus = contractNeedsReview ? 'needs_review' : 'passed';
        return {
            version: DESIGN_QUALITY_VERDICT_CAPABILITY_ID,
            status,
            source: 'contract',
            contractStatus: contract.status,
            contractFailedRequirementIds: [],
            blockers: [],
            warnings: contractNeedsReviewItems.map(
                (item) => item.reason || `${item.label || item.id}：待复核`
            ),
            summary: status === 'passed'
                ? '产物齐全（未提供质量评分卡，按契约判定通过）。'
                : '产物齐全但有待复核项（未提供质量评分卡）。'
        };
    }

    // 4) 契约通过 + 有 scorecard → 按 gate 串联。
    const overallScore = scorecard.overallScore;
    // R-040 containment：不信任裸 severity=blocker。只有确定性失败且携带合法
    // blockerKind + proofRef 的结果可以硬阻断；其余失败一律保留为 finding/warning。
    const qualifiedScorecardBlockers = scorecard.blockers.filter(isQualifiedDesignQualityHardBlocker);
    const blockerIds = new Set(qualifiedScorecardBlockers.map((item) => item.id));
    const scorecardBlockers = qualifiedScorecardBlockers.map(assertionToText);
    const softFailureResults = [...scorecard.failedAssertions, ...scorecard.blockers]
        .filter((item) => !blockerIds.has(item.id))
        .filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index);
    const majorFailureWarnings = softFailureResults
        .map(assertionToText);
    const scorecardNeedsReview = scorecard.needsReview.map(assertionToText);
    const contractNeedsReviewWarnings = contractNeedsReviewItems.map(
        (item) => item.reason || `${item.label || item.id}：待复核`
    );

    switch (scorecard.gate) {
        case 'failed':
            if (qualifiedScorecardBlockers.length > 0) {
                // 有 qualified blocker → 硬失败：下游只消费已经过证据资格校验的 blockers。
                return {
                    version: DESIGN_QUALITY_VERDICT_CAPABILITY_ID,
                    status: 'failed',
                    source: 'contract+scorecard',
                    contractStatus: contract.status,
                    contractFailedRequirementIds: [],
                    scorecardGate: scorecard.gate,
                    overallScore,
                    blockers: scorecardBlockers,
                    warnings: [...contractNeedsReviewWarnings, ...majorFailureWarnings, ...scorecardNeedsReview],
                    summary: `产物齐全，但存在有确定性证据的质量阻断（评分 ${overallScore}，${qualifiedScorecardBlockers.length} 项）。`
                };
            }
            // gate=failed 但仅 major 梯度缺陷、无 blocker → 分级判软：needs_review，不进硬阻断（绝不回落出假 blocker）。
            return {
                version: DESIGN_QUALITY_VERDICT_CAPABILITY_ID,
                status: 'needs_review',
                source: 'contract+scorecard',
                contractStatus: contract.status,
                contractFailedRequirementIds: [],
                scorecardGate: scorecard.gate,
                overallScore,
                blockers: [],
                warnings: [...contractNeedsReviewWarnings, ...majorFailureWarnings, ...scorecardNeedsReview],
                summary: `产物齐全，设计质量有梯度缺陷需复核（评分 ${overallScore}）。`
            };
        case 'needs_review':
            return {
                version: DESIGN_QUALITY_VERDICT_CAPABILITY_ID,
                status: 'needs_review',
                source: 'contract+scorecard',
                contractStatus: contract.status,
                contractFailedRequirementIds: [],
                scorecardGate: scorecard.gate,
                overallScore,
                blockers: [],
                warnings: [...contractNeedsReviewWarnings, ...majorFailureWarnings, ...scorecardNeedsReview],
                summary: `产物齐全，设计质量需复核（评分 ${overallScore}）。`
            };
        case 'incomplete_verification':
        case 'insufficient_observations':
            // 质量没测到时不伪造失败；但 Completion Contract 仍待复核时也绝不能
            // 反向升级为“已交付但未验证”。此时分数只代表已评估子集，不对外给总分。
            if (contractNeedsReview) {
                return {
                    version: DESIGN_QUALITY_VERDICT_CAPABILITY_ID,
                    status: 'needs_review',
                    source: 'contract+scorecard',
                    contractStatus: contract.status,
                    contractFailedRequirementIds: [],
                    scorecardGate: scorecard.gate,
                    blockers: [],
                    warnings: [
                        ...contractNeedsReviewWarnings,
                        `任务完成条件仍待复核；设计质量评估覆盖率不足（${scorecard.coverage.evaluated}/${scorecard.coverage.total}）。`
                    ],
                    summary: '任务结果尚未满足完成契约，且实际画面验证不完整，不能进入交付完成状态。'
                };
            }
            // Completion 已通过但质量覆盖不足：诚实标为“已交付但未验证质量”。
            return {
                version: DESIGN_QUALITY_VERDICT_CAPABILITY_ID,
                status: 'passed_unverified',
                source: 'contract+scorecard',
                contractStatus: contract.status,
                contractFailedRequirementIds: [],
                scorecardGate: scorecard.gate,
                overallScore,
                blockers: [],
                warnings: [
                    ...contractNeedsReviewWarnings,
                    `设计质量评估覆盖率不足（${scorecard.coverage.evaluated}/${scorecard.coverage.total}），质量未充分验证。`
                ],
                summary: scorecard.gate === 'insufficient_observations'
                    ? '产物齐全，但尚未充分查看实际画面，未能验证设计质量（不据此判失败）。'
                    : '产物齐全，但设计质量检查尚未覆盖完整，未能验证质量（不据此判失败）。'
            };
        case 'passed':
        default:
            if (contractNeedsReview) {
                const completionWarnings = contractNeedsReviewWarnings.length > 0
                    ? contractNeedsReviewWarnings
                    : [
                        ...(contract.warnings || []),
                        contract.summary || '任务完成条件仍待复核。'
                    ];
                return {
                    version: DESIGN_QUALITY_VERDICT_CAPABILITY_ID,
                    status: 'needs_review',
                    source: 'contract+scorecard',
                    contractStatus: contract.status,
                    contractFailedRequirementIds: [],
                    scorecardGate: scorecard.gate,
                    blockers: [],
                    warnings: completionWarnings,
                    summary: '质量子检查已通过，但任务完成契约仍待复核，不能宣告交付完成。'
                };
            }
            return {
                version: DESIGN_QUALITY_VERDICT_CAPABILITY_ID,
                status: 'passed',
                source: 'contract+scorecard',
                contractStatus: contract.status,
                contractFailedRequirementIds: [],
                scorecardGate: scorecard.gate,
                overallScore,
                blockers: [],
                warnings: contractNeedsReviewWarnings,
                summary: `产物齐全，设计质量达标（评分 ${overallScore}）。`
            };
    }
}

/**
 * 分级口径下的"可收尾"便捷判定：唯一质量硬阻断是 qualified blocker，故 deliverable ⇔ 无 blocker。
 * needs_review（major 梯度软提示）、passed_unverified（未验证）、passed、not_applicable 均不阻断收尾，
 * 只随 warnings 提示——符合"质量 finding 走提示、确定性证据才可硬阻断"与"不伪造失败"红线。
 */
export function isDesignVerdictDeliverable(verdict: DesignVerdict): boolean {
    return verdict.blockers.length === 0;
}
