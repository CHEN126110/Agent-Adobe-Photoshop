/**
 * 详情页文案候选的纯逻辑验收契约。
 *
 * 模型负责提出内容、事实引用、评分和理由；Harness 只验证可解析性、
 * 稳定事实引用、最低分和文字槽位容量，不在这里生成或改写文案。
 */

import {
    assessDetailPageContentClaimSupport,
    type DetailPageClaimSupportFact
} from './detail-page-content-verification';

export type DetailPageCopyFactConfirmation =
    | 'user_confirmed'
    | 'source_supported'
    | 'unverified'
    | 'pending'
    | 'rejected'
    | string;

export interface DetailPageCopyFactInput {
    ref: string;
    statement: string;
    confirmation?: DetailPageCopyFactConfirmation;
}

export interface DetailPageCopyFact {
    ref: string;
    statement: string;
    confirmation: DetailPageCopyFactConfirmation;
    evaluationEligible: boolean;
}

export interface DetailPageCopyCandidate {
    content: string;
    supportRefs: string[];
    score: number;
    reason: string;
    /** 由 Harness 根据槽位职责与候选内容判定；不信任 Provider 直接声明。 */
    requiresFactSupport?: boolean;
}

export type DetailPageCopyCandidateIssueCode =
    | 'candidate_batch_too_small'
    | 'candidate_content_empty'
    | 'candidate_reason_missing'
    | 'candidate_score_below_threshold'
    | 'candidate_capacity_mismatch'
    | 'candidate_support_ref_missing'
    | 'candidate_support_ref_unknown'
    | 'candidate_support_ref_unconfirmed'
    | 'candidate_support_ref_unrelated'
    | 'candidate_claim_negation_conflict'
    | 'candidate_claim_partially_supported';

export interface DetailPageCopyCandidateAssessment {
    accepted: boolean;
    candidate: DetailPageCopyCandidate;
    issueCodes: DetailPageCopyCandidateIssueCode[];
    charCount: number;
    targetCharCount: number;
    allowedCharDifference: number;
}

export interface DetailPageCopyCandidateSelection {
    selected: DetailPageCopyCandidate | null;
    assessments: DetailPageCopyCandidateAssessment[];
    issueCodes: DetailPageCopyCandidateIssueCode[];
}

const SAFE_FACT_REF_PATTERN = /^detail-fact:(?:[a-z0-9-]+:[0-9]+(?::[0-9]+)?|state-record:[a-f0-9]{16})$/;

function cleanText(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function cleanCopyContent(value: unknown): string {
    return String(value || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .split('\n')
        .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
        .filter(Boolean)
        .join('\n')
        .trim();
}

function uniqueStrings(value: unknown, limit = 12): string[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of value) {
        const text = cleanText(item);
        if (!text || seen.has(text)) continue;
        seen.add(text);
        result.push(text);
        if (result.length >= limit) break;
    }
    return result;
}

function clamp01(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(1, parsed));
}

function countContentChars(value: unknown): number {
    return String(value || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\n/g, '')
        .replace(/\s+/g, '')
        .length;
}

function isEvaluationEligibleConfirmation(value: unknown): boolean {
    return ['user_confirmed', 'source_supported'].includes(cleanText(value));
}

export function isSafeDetailPageCopyFactRef(value: unknown): boolean {
    return SAFE_FACT_REF_PATTERN.test(cleanText(value));
}

export function normalizeDetailPageCopyFacts(value: unknown): DetailPageCopyFact[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const result: DetailPageCopyFact[] = [];
    for (const item of value) {
        const record = item && typeof item === 'object'
            ? item as Partial<DetailPageCopyFactInput>
            : null;
        const ref = cleanText(record?.ref);
        const statement = cleanText(record?.statement);
        if (!ref || !statement || !isSafeDetailPageCopyFactRef(ref) || seen.has(ref)) continue;
        const confirmation = cleanText(record?.confirmation) || 'unverified';
        seen.add(ref);
        result.push({
            ref,
            statement,
            confirmation,
            evaluationEligible: isEvaluationEligibleConfirmation(confirmation)
        });
        if (result.length >= 40) break;
    }
    return result;
}

export function normalizeDetailPageCopyCandidate(value: unknown): DetailPageCopyCandidate | null {
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    if (!Number.isFinite(Number(record.score))) return null;
    const content = cleanCopyContent(record.content);
    const reason = cleanText(record.reason);
    const supportRefs = uniqueStrings(record.supportRefs, 8);
    return {
        content,
        supportRefs,
        score: clamp01(record.score),
        reason
    };
}

export function clampDetailPageCopyCandidateCount(value: unknown, fallback = 3): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return Math.max(2, Math.min(5, Math.round(fallback)));
    return Math.max(2, Math.min(5, Math.round(parsed)));
}

export function calculateDetailPageCopyCapacityTolerance(targetCharCount: number): number {
    const normalizedTarget = Math.max(0, Math.round(Number(targetCharCount) || 0));
    if (normalizedTarget === 0) return 6;
    return Math.max(4, Math.ceil(normalizedTarget * 0.35));
}

export function assessDetailPageCopyCandidate(input: {
    candidate: DetailPageCopyCandidate;
    facts?: readonly DetailPageCopyFact[];
    minScore?: number;
    targetCharCount?: number;
    allowedCharDifference?: number;
    requireFactSupport?: boolean;
}): DetailPageCopyCandidateAssessment {
    const facts = Array.isArray(input.facts) ? input.facts : [];
    const factByRef = new Map(facts.map((fact) => [fact.ref, fact]));
    const targetCharCount = Math.max(0, Math.round(Number(input.targetCharCount) || 0));
    const allowedCharDifference = Math.max(
        0,
        Math.round(Number(input.allowedCharDifference) || calculateDetailPageCopyCapacityTolerance(targetCharCount))
    );
    const minScore = clamp01(input.minScore ?? 0.72);
    const normalizedCandidate = {
        ...input.candidate,
        content: cleanCopyContent(input.candidate.content),
        supportRefs: uniqueStrings(input.candidate.supportRefs, 8),
        score: clamp01(input.candidate.score),
        reason: cleanText(input.candidate.reason)
    };
    const issueCodes: DetailPageCopyCandidateIssueCode[] = [];
    const charCount = countContentChars(normalizedCandidate.content);

    if (!normalizedCandidate.content) issueCodes.push('candidate_content_empty');
    if (!normalizedCandidate.reason) issueCodes.push('candidate_reason_missing');
    if (normalizedCandidate.score < minScore) issueCodes.push('candidate_score_below_threshold');
    // 模板字数只代表可用容量，不是必须复刻的文案骨架；更短的好文案不应被拒绝。
    if (targetCharCount > 0 && charCount > targetCharCount + allowedCharDifference) {
        issueCodes.push('candidate_capacity_mismatch');
    }

    const claimAssessment = assessDetailPageContentClaimSupport({
        content: normalizedCandidate.content,
        supportRefs: normalizedCandidate.supportRefs,
        facts: Array.from(factByRef.values()) as DetailPageClaimSupportFact[],
        baselineRequiresFactSupport: input.requireFactSupport === true
            || normalizedCandidate.requiresFactSupport === true
    });
    if (claimAssessment.issueCodes.includes('claim_support_ref_missing')) {
        issueCodes.push('candidate_support_ref_missing');
    }
    if (claimAssessment.issueCodes.includes('claim_support_ref_unknown')) {
        issueCodes.push('candidate_support_ref_unknown');
    }
    if (claimAssessment.issueCodes.includes('claim_support_ref_unconfirmed')) {
        issueCodes.push('candidate_support_ref_unconfirmed');
    }
    if (claimAssessment.issueCodes.includes('claim_support_ref_unrelated')) {
        issueCodes.push('candidate_support_ref_unrelated');
    }
    if (claimAssessment.issueCodes.includes('claim_negation_conflict')) {
        issueCodes.push('candidate_claim_negation_conflict');
    }
    if (claimAssessment.issueCodes.includes('claim_signal_uncovered')) {
        issueCodes.push('candidate_claim_partially_supported');
    }
    const candidate: DetailPageCopyCandidate = {
        ...normalizedCandidate,
        requiresFactSupport: claimAssessment.requiresFactSupport
    };

    return {
        accepted: issueCodes.length === 0,
        candidate,
        issueCodes: Array.from(new Set(issueCodes)),
        charCount,
        targetCharCount,
        allowedCharDifference
    };
}

export function selectDetailPageCopyCandidate(input: {
    candidates: readonly DetailPageCopyCandidate[];
    facts?: readonly DetailPageCopyFact[];
    minScore?: number;
    targetCharCount?: number;
    allowedCharDifference?: number;
    requireFactSupport?: boolean;
    minimumCandidateCount?: number;
}): DetailPageCopyCandidateSelection {
    const minimumCandidateCount = Math.max(2, Math.min(5, Math.round(Number(input.minimumCandidateCount) || 2)));
    const assessments = (input.candidates || []).slice(0, 5).map((candidate) => (
        assessDetailPageCopyCandidate({
            candidate,
            facts: input.facts,
            minScore: input.minScore,
            targetCharCount: input.targetCharCount,
            allowedCharDifference: input.allowedCharDifference,
            requireFactSupport: input.requireFactSupport
        })
    ));
    const issueCodes: DetailPageCopyCandidateIssueCode[] = [];
    if ((input.candidates || []).length < minimumCandidateCount) {
        issueCodes.push('candidate_batch_too_small');
    }

    const accepted = assessments
        .filter((assessment) => assessment.accepted)
        .sort((left, right) => {
            if (right.candidate.score !== left.candidate.score) {
                return right.candidate.score - left.candidate.score;
            }
            const leftDiff = Math.abs(left.charCount - left.targetCharCount);
            const rightDiff = Math.abs(right.charCount - right.targetCharCount);
            return leftDiff - rightDiff;
        });
    const selected = issueCodes.length === 0
        ? accepted[0]?.candidate || null
        : null;
    return {
        selected,
        assessments,
        issueCodes: Array.from(new Set([
            ...issueCodes,
            ...assessments.flatMap((assessment) => assessment.issueCodes)
        ]))
    };
}
