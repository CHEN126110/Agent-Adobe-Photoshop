/**
 * 详情页逐屏内容校验。
 *
 * 该契约只验证“实际执行的每一屏内容是否关联了已确认事实来源”，不生成文案、
 * 不判断审美、不读取任务文本，也不拥有最终 DesignVerdict。
 */

import type { DetailScreenPlan } from './detail-page-screen-plan';
import type { DesignProjectState } from './types/design-project-state.types';
import {
    canDesignProjectFactSupportEvaluation,
    listDesignProjectFactRecords
} from './design-project-fact-provenance';

export type DetailPageContentFactSource =
    | 'project_product_fact'
    | 'project_selling_point';

export interface DetailPageContentFactCandidate {
    ref: string;
    source: DetailPageContentFactSource;
    statement: string;
    sourceStrength: 'user_confirmed' | 'source_supported' | 'unverified';
    evaluationEligible: boolean;
}

export type DetailPageContentScreenIssueCode =
    | 'screen_execution_failed'
    | 'screen_decision_incomplete'
    | 'live_screen_missing'
    | 'live_copy_readback_missing'
    | 'live_copy_readback_unexpected'
    | 'applied_copy_missing'
    | 'applied_copy_not_supported'
    | 'applied_copy_partially_supported'
    | 'content_claim_negation_conflict'
    | 'content_claim_partially_supported'
    | 'content_support_ref_missing'
    | 'content_support_ref_unrelated'
    | 'content_support_ref_unconfirmed'
    | 'content_support_ref_unknown'
    | 'content_support_ref_unsafe';

export interface DetailPageContentCopyVerification {
    copyIndex: number;
    status: 'supported' | 'unsupported';
    requiresFactSupport: boolean;
    supportRefs: string[];
    issueCodes: DetailPageContentScreenIssueCode[];
}

export interface DetailPageContentScreenVerification {
    screenId: number;
    status: 'passed' | 'needs_review' | 'failed';
    appliedCopyCount: number;
    supportedCopyCount: number;
    unsupportedCopyCount: number;
    supportRefs: string[];
    sourceKinds: DetailPageContentFactSource[];
    issueCodes: DetailPageContentScreenIssueCode[];
    copyVerifications: DetailPageContentCopyVerification[];
}

export interface DetailPageContentVerification {
    version: 'detail-page-content-verification/v0';
    status: 'passed' | 'needs_review' | 'failed';
    summary: {
        screenCount: number;
        passedScreenCount: number;
        needsReviewScreenCount: number;
        failedScreenCount: number;
        linkedScreenCount: number;
        appliedCopyScreenCount: number;
        supportedCopyScreenCount: number;
        appliedCopyCount: number;
        supportedCopyCount: number;
        unsupportedCopyCount: number;
        supportCoverageRatio: number;
        factCount: number;
        confirmedFactCount: number;
        unconfirmedFactCount: number;
    };
    screens: DetailPageContentScreenVerification[];
    issueCodes: DetailPageContentScreenIssueCode[];
    verificationPassed: boolean;
    boundaries: {
        executesTools: false;
        callsModel: false;
        containsFactStatements: false;
        containsPaths: false;
        performsSemanticInference: false;
        claimsDesignQuality: false;
    };
}

export interface DetailPageContentFillPlanLike {
    screenId?: number;
    supportRefs?: unknown;
    /** 仅真实纯图片区可显式设 false；缺省仍要求至少一条实际文案。 */
    copyExpected?: unknown;
    /** Photoshop 写后回读找不到整屏时由执行器设置；不能用计划态冒充实机态。 */
    liveScreenMissing?: unknown;
    /** 兼容执行器按整屏汇总回读缺失。 */
    readbackMissing?: unknown;
    /** Photoshop 实际存在计划外文字层或旧模板字时由执行器设置。 */
    readbackUnexpected?: unknown;
    copies?: Array<{
        content?: unknown;
        generationStatus?: unknown;
        candidateScore?: unknown;
        candidateReason?: unknown;
        /** label 等非事实性装饰文案可显式声明无需事实引用；默认按事实文案校验。 */
        requiresFactSupport?: unknown;
        /** 可选的 claim 级事实引用；缺失时继承 screen/fill plan 的受控引用集合。 */
        supportRefs?: unknown;
        /** Photoshop 实际文字层回读状态；missing 必须失败关闭。 */
        readbackStatus?: unknown;
        readbackMissing?: unknown;
        readbackUnexpected?: unknown;
    }>;
}

export interface DetailPageContentExecutionResultLike {
    screenId: number;
    status: string;
}

const SAFE_REF_PATTERN = /^detail-fact:(?:[a-z0-9-]+:[0-9]+(?::[0-9]+)?|state-record:[a-f0-9]{16})$/;

export interface DetailPageClaimSupportFact {
    ref: string;
    statement: string;
    evaluationEligible: boolean;
}

export type DetailPageClaimSupportIssueCode =
    | 'claim_support_ref_missing'
    | 'claim_support_ref_unknown'
    | 'claim_support_ref_unconfirmed'
    | 'claim_support_ref_unrelated'
    | 'claim_negation_conflict'
    | 'claim_signal_uncovered';

export interface DetailPageClaimSupportAssessment {
    supported: boolean;
    requiresFactSupport: boolean;
    matchedSupportRefs: string[];
    issueCodes: DetailPageClaimSupportIssueCode[];
}

interface ClaimSignal {
    key: string;
    index: number;
    negated: boolean;
}

const CLAIM_SIGNAL_TERMS = [
    '甲醛', '荧光剂', '精梳棉', '有机棉', '羊毛', '涤纶', '聚酯纤维', '锦纶', '尼龙', '氨纶',
    '面料', '材质', '成分', '含量', '工艺', '参数', '规格', '认证', '检测', '等级', '产地', '型号',
    '尺寸', '透气', '吸湿', '排汗', '抗菌', '抑菌', '防臭', '保暖', '防晒', '防水', '防滑', '耐磨',
    '弹力', '勒脚', '无痕', '速干', '防皱', '起球', '支撑', '缓震', '加厚', '超薄', '轻薄', '薄款',
    '亲肤', '天然', '环保', '可持续', '永久', '零添加', '第一', '最佳', '最强', '支持', '退货', '机洗',
    '棉',
    'formaldehyde', 'fluorescent agent', 'combed cotton', 'organic cotton', 'cotton', 'wool',
    'polyester', 'nylon', 'spandex', 'elastane', 'material', 'fabric', 'composition', 'certified',
    'tested', 'breathable', 'moisture wicking', 'antibacterial', 'anti-bacterial', 'antimicrobial',
    'odor', 'odor control', 'odor free', 'odor-free', 'deodorizing', 'warm', 'uv protection', 'waterproof', 'non-slip',
    'durable', 'elastic', 'seamless', 'quick dry', 'quick-dry', 'support', 'cushioning', 'organic',
    'sustainable', 'machine washable', 'returnable', 'best', 'strongest', 'permanent'
] as const;

const CLAIM_METRIC_PATTERN = /\d+(?:\.\d+)?\s*(?:%|％|mm|cm|kg|mg|ml|g|l|gsm|倍|层|级|小时|天|支|双|件|hours?|hrs?|days?)/gi;

function cleanText(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeStatement(value: unknown): string {
    return cleanText(value)
        .toLowerCase()
        .replace(/[\s，。；;、,:：!！?？"'“”‘’（）()\-_/]+/g, '');
}

function unique<T extends string>(values: T[]): T[] {
    return Array.from(new Set(values));
}

function addFact(input: {
    facts: DetailPageContentFactCandidate[];
    seen: Set<string>;
    statement: unknown;
    ref: string;
    source: DetailPageContentFactSource;
    sourceStrength: DetailPageContentFactCandidate['sourceStrength'];
    evaluationEligible: boolean;
}): void {
    const statement = cleanText(input.statement);
    const normalized = normalizeStatement(statement);
    const seenKey = `${input.source}:${normalized}`;
    if (!statement || normalized.length < 2 || input.seen.has(seenKey)) return;
    input.seen.add(seenKey);
    input.facts.push({
        ref: input.ref,
        source: input.source,
        statement,
        sourceStrength: input.sourceStrength,
        evaluationEligible: input.evaluationEligible
    });
}

export function buildDetailPageContentFactCatalog(input: {
    state?: DesignProjectState | null;
}): DetailPageContentFactCandidate[] {
    const facts: DetailPageContentFactCandidate[] = [];
    const seen = new Set<string>();
    listDesignProjectFactRecords(input.state).forEach((fact) => {
        if (fact.status !== 'active' || fact.confirmation === 'rejected') return;
        addFact({
            facts,
            seen,
            statement: fact.statement,
            ref: `detail-fact:state-record:${fact.factId.replace('project-fact-', '')}`,
            source: fact.claimType === 'selling_point' ? 'project_selling_point' : 'project_product_fact',
            sourceStrength: fact.confirmation,
            evaluationEligible: canDesignProjectFactSupportEvaluation(fact)
        });
    });
    return facts.slice(0, 80);
}

function statementsMatch(left: unknown, right: unknown): boolean {
    const normalizedLeft = normalizeStatement(left);
    const normalizedRight = normalizeStatement(right);
    if (normalizedLeft.length < 2 || normalizedRight.length < 2) return false;
    if (normalizedLeft === normalizedRight) return true;
    const minLength = Math.min(normalizedLeft.length, normalizedRight.length);
    return minLength >= 4
        && (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft));
}

function normalizeClaimAnalysisText(value: unknown): string {
    return String(value || '')
        .normalize('NFKC')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .toLowerCase()
        .replace(/[，。；;、,:：!！?？"'“”‘’（）()[\]{}_/\\-]+/g, ' ')
        .replace(/\s+/g, '')
        .trim();
}

function isSignalNegated(text: string, index: number, signalLength: number): boolean {
    const prefix = text.slice(Math.max(0, index - 18), index);
    const suffix = text.slice(index + signalLength, Math.min(text.length, index + signalLength + 12));
    if (/(?:不|无|未|非|免|零|拒绝|避免|杜绝|无需|没有|并非|不会|不能|从不)[^\s，。；,;]{0,4}$/.test(prefix)) {
        return true;
    }
    if (/(?:not|no|non|without|never)$/i.test(prefix)) {
        return true;
    }
    return /^(?:free|freeof)/i.test(suffix);
}

function collectClaimSignals(value: unknown): ClaimSignal[] {
    const text = normalizeClaimAnalysisText(value);
    if (!text) return [];
    const result: ClaimSignal[] = [];
    const seen = new Set<string>();
    for (const term of CLAIM_SIGNAL_TERMS) {
        const normalizedTerm = term.replace(/[\s-]+/g, '');
        let startIndex = 0;
        while (startIndex < text.length) {
            const index = text.indexOf(normalizedTerm, startIndex);
            if (index < 0) break;
            const key = `term:${term}`;
            const signature = `${key}:${index}`;
            if (!seen.has(signature)) {
                seen.add(signature);
                result.push({
                    key,
                    index,
                    negated: isSignalNegated(text, index, normalizedTerm.length)
                });
            }
            startIndex = index + Math.max(1, normalizedTerm.length);
        }
    }
    for (const match of text.matchAll(new RegExp(CLAIM_METRIC_PATTERN.source, CLAIM_METRIC_PATTERN.flags))) {
        const raw = cleanText(match[0]).replace(/\s+/g, '').toLowerCase();
        const index = Number(match.index || 0);
        const key = `metric:${raw}`;
        const signature = `${key}:${index}`;
        if (!raw || seen.has(signature)) continue;
        seen.add(signature);
        result.push({ key, index, negated: false });
    }
    return result.sort((left, right) => left.index - right.index);
}

function hasSamePolaritySignal(left: ClaimSignal[], right: ClaimSignal[]): boolean {
    return left.some((leftSignal) => right.some((rightSignal) => (
        leftSignal.key === rightSignal.key
        && leftSignal.negated === rightSignal.negated
    )));
}

function hasOppositePolaritySignal(left: ClaimSignal[], right: ClaimSignal[]): boolean {
    return left.some((leftSignal) => right.some((rightSignal) => (
        leftSignal.key === rightSignal.key
        && leftSignal.negated !== rightSignal.negated
    )));
}

function factIsRelevantToCopy(
    copy: unknown,
    factStatement: unknown,
    copySignals: ClaimSignal[],
    factSignals: ClaimSignal[]
): boolean {
    if (hasSamePolaritySignal(copySignals, factSignals)) return true;
    return statementsMatch(copy, factStatement)
        && !hasOppositePolaritySignal(copySignals, factSignals);
}

export function containsDetailPageHighRiskClaim(value: unknown): boolean {
    return collectClaimSignals(value).length > 0;
}

export function deriveDetailPageCopyRequiresFactSupport(input: {
    content: unknown;
    facts?: readonly DetailPageClaimSupportFact[];
    supportRefs?: readonly unknown[];
    baselineRequiresFactSupport?: boolean;
}): boolean {
    if (input.baselineRequiresFactSupport === true) return true;
    const refs = (input.supportRefs || []).map(cleanText).filter(Boolean);
    if (refs.length > 0 || containsDetailPageHighRiskClaim(input.content)) return true;
    return (input.facts || []).some((fact) => statementsMatch(input.content, fact.statement));
}

export function assessDetailPageContentClaimSupport(input: {
    content: unknown;
    supportRefs?: readonly unknown[];
    facts?: readonly DetailPageClaimSupportFact[];
    baselineRequiresFactSupport?: boolean;
}): DetailPageClaimSupportAssessment {
    const content = cleanText(input.content);
    const facts = Array.isArray(input.facts) ? input.facts : [];
    const factByRef = new Map(facts.map((fact) => [cleanText(fact.ref), fact]));
    const supportRefs = unique((input.supportRefs || []).map(cleanText).filter(Boolean)).slice(0, 8);
    const requiresFactSupport = deriveDetailPageCopyRequiresFactSupport({
        content,
        facts,
        supportRefs,
        baselineRequiresFactSupport: input.baselineRequiresFactSupport
    });
    if (!requiresFactSupport) {
        return {
            supported: true,
            requiresFactSupport: false,
            matchedSupportRefs: [],
            issueCodes: []
        };
    }

    const issueCodes: DetailPageClaimSupportIssueCode[] = [];
    if (supportRefs.length === 0) issueCodes.push('claim_support_ref_missing');
    const unknownRefs = supportRefs.filter((ref) => !factByRef.has(ref));
    if (unknownRefs.length > 0) issueCodes.push('claim_support_ref_unknown');
    const knownFacts = supportRefs
        .map((ref) => factByRef.get(ref))
        .filter((fact): fact is DetailPageClaimSupportFact => Boolean(fact));
    const eligibleFacts = knownFacts.filter((fact) => fact.evaluationEligible === true);
    if (knownFacts.length > 0 && eligibleFacts.length !== knownFacts.length) {
        issueCodes.push('claim_support_ref_unconfirmed');
    }

    const copySignals = collectClaimSignals(content);
    const factSignalsByRef = new Map(eligibleFacts.map((fact) => [
        fact.ref,
        collectClaimSignals(fact.statement)
    ]));
    const matchedSupportRefs: string[] = [];
    let hasNegationConflict = false;
    let hasUnrelatedRef = false;
    for (const fact of eligibleFacts) {
        const factSignals = factSignalsByRef.get(fact.ref) || [];
        if (hasOppositePolaritySignal(copySignals, factSignals)) {
            hasNegationConflict = true;
        }
        if (factIsRelevantToCopy(content, fact.statement, copySignals, factSignals)) {
            matchedSupportRefs.push(fact.ref);
        } else {
            hasUnrelatedRef = true;
        }
    }
    if (hasNegationConflict) issueCodes.push('claim_negation_conflict');
    if (hasUnrelatedRef) issueCodes.push('claim_support_ref_unrelated');

    const uncoveredSignal = copySignals.some((copySignal) => !eligibleFacts.some((fact) => {
        const factSignals = factSignalsByRef.get(fact.ref) || [];
        return factSignals.some((factSignal) => (
            factSignal.key === copySignal.key
            && factSignal.negated === copySignal.negated
        ));
    }));
    if (uncoveredSignal) issueCodes.push('claim_signal_uncovered');
    if (
        copySignals.length === 0
        && eligibleFacts.length > 0
        && matchedSupportRefs.length === 0
    ) {
        issueCodes.push('claim_support_ref_unrelated');
    }

    const dedupedIssues = unique(issueCodes);
    return {
        supported: dedupedIssues.length === 0 && matchedSupportRefs.length > 0,
        requiresFactSupport,
        matchedSupportRefs: unique(matchedSupportRefs),
        issueCodes: dedupedIssues
    };
}

export function resolveDetailPageContentSupportRefs(input: {
    catalog: readonly DetailPageContentFactCandidate[];
    statements: readonly unknown[];
}): string[] {
    const refs: string[] = [];
    for (const statement of input.statements) {
        for (const fact of input.catalog) {
            if (!statementsMatch(statement, fact.statement)) continue;
            refs.push(fact.ref);
        }
    }
    return unique(refs).slice(0, 8);
}

function readSupportRefs(value: unknown): { safe: string[]; unsafeCount: number; providedCount: number } {
    const refs = Array.isArray(value) ? value.map(cleanText).filter(Boolean) : [];
    const safe = refs.filter((ref) => SAFE_REF_PATTERN.test(ref));
    return {
        safe: unique(safe).slice(0, 8),
        unsafeCount: refs.length - safe.length,
        providedCount: refs.length
    };
}

function buildScreenVerification(input: {
    screenPlan: DetailScreenPlan;
    fillPlan?: DetailPageContentFillPlanLike;
    executionStatus?: string;
    factByRef: Map<string, DetailPageContentFactCandidate>;
}): DetailPageContentScreenVerification {
    const issues: DetailPageContentScreenIssueCode[] = [];
    if (input.fillPlan?.liveScreenMissing === true) {
        issues.push('live_screen_missing');
    }
    if (input.fillPlan?.readbackMissing === true) {
        issues.push('live_copy_readback_missing');
    }
    if (input.fillPlan?.readbackUnexpected === true) {
        issues.push('live_copy_readback_unexpected');
    }
    const planRefs = readSupportRefs(input.screenPlan.supportRefs);
    const fillRefs = readSupportRefs(input.fillPlan?.supportRefs);
    const inheritedSupportRefs = unique([...planRefs.safe, ...fillRefs.safe]);
    if (planRefs.unsafeCount + fillRefs.unsafeCount > 0) issues.push('content_support_ref_unsafe');
    const appliedCopies = (input.fillPlan?.copies || []).filter((copy) => (
        cleanText(copy?.content)
        && cleanText(copy?.generationStatus) !== 'failed'
    ));
    const appliedCopyCount = appliedCopies.length;
    const referencedKnownRefs = new Set<string>();
    const referencedUnknownRefs = new Set<string>();
    const copyVerifications = appliedCopies.map((copy, copyIndex): DetailPageContentCopyVerification => {
        const copyIssues: DetailPageContentScreenIssueCode[] = [];
        const directRefs = readSupportRefs(copy.supportRefs);
        if (directRefs.unsafeCount > 0) {
            copyIssues.push('content_support_ref_unsafe');
            issues.push('content_support_ref_unsafe');
        }
        let candidateRefs = inheritedSupportRefs;
        if (directRefs.providedCount > 0) {
            candidateRefs = directRefs.safe;
        } else if (copy.requiresFactSupport === false) {
            candidateRefs = [];
        }
        const unknownRefs = candidateRefs.filter((ref) => !input.factByRef.has(ref));
        unknownRefs.forEach((ref) => referencedUnknownRefs.add(ref));
        if (unknownRefs.length > 0) {
            copyIssues.push('content_support_ref_unknown');
            issues.push('content_support_ref_unknown');
        }
        const knownRefs = candidateRefs.filter((ref) => input.factByRef.has(ref));
        knownRefs.forEach((ref) => referencedKnownRefs.add(ref));
        const eligibleRefs = knownRefs.filter((ref) => input.factByRef.get(ref)?.evaluationEligible === true);
        if (knownRefs.length > 0 && eligibleRefs.length === 0) {
            copyIssues.push('content_support_ref_unconfirmed');
            issues.push('content_support_ref_unconfirmed');
        }
        const claimAssessment = assessDetailPageContentClaimSupport({
            content: copy.content,
            supportRefs: candidateRefs,
            facts: Array.from(input.factByRef.values()),
            baselineRequiresFactSupport: copy.requiresFactSupport !== false
        });
        if (claimAssessment.issueCodes.includes('claim_support_ref_missing')) {
            copyIssues.push('content_support_ref_missing');
        }
        if (claimAssessment.issueCodes.includes('claim_support_ref_unknown')) {
            copyIssues.push('content_support_ref_unknown');
        }
        if (claimAssessment.issueCodes.includes('claim_support_ref_unconfirmed')) {
            copyIssues.push('content_support_ref_unconfirmed');
        }
        if (claimAssessment.issueCodes.includes('claim_support_ref_unrelated')) {
            copyIssues.push('content_support_ref_unrelated');
            issues.push('content_support_ref_unrelated');
        }
        if (claimAssessment.issueCodes.includes('claim_negation_conflict')) {
            copyIssues.push('content_claim_negation_conflict');
            issues.push('content_claim_negation_conflict');
        }
        if (claimAssessment.issueCodes.includes('claim_signal_uncovered')) {
            copyIssues.push('content_claim_partially_supported');
            issues.push('content_claim_partially_supported');
        }
        const readbackStatus = cleanText(copy.readbackStatus).toLowerCase();
        const readbackMissing = copy.readbackMissing === true || readbackStatus === 'missing';
        const readbackUnexpected = copy.readbackUnexpected === true || readbackStatus === 'unexpected';
        if (readbackMissing) {
            copyIssues.push('live_copy_readback_missing');
            issues.push('live_copy_readback_missing');
        }
        if (readbackUnexpected) {
            copyIssues.push('live_copy_readback_unexpected');
            issues.push('live_copy_readback_unexpected');
        }
        if (claimAssessment.requiresFactSupport && !claimAssessment.supported) {
            copyIssues.push('applied_copy_not_supported');
        }
        const copySupported = claimAssessment.supported
            && directRefs.unsafeCount === 0
            && !readbackMissing
            && !readbackUnexpected;
        return {
            copyIndex,
            status: copySupported ? 'supported' : 'unsupported',
            requiresFactSupport: claimAssessment.requiresFactSupport,
            supportRefs: claimAssessment.matchedSupportRefs,
            issueCodes: unique(copyIssues)
        };
    });
    inheritedSupportRefs
        .filter((ref) => input.factByRef.has(ref))
        .forEach((ref) => referencedKnownRefs.add(ref));
    inheritedSupportRefs
        .filter((ref) => !input.factByRef.has(ref))
        .forEach((ref) => referencedUnknownRefs.add(ref));
    if (referencedUnknownRefs.size > 0) issues.push('content_support_ref_unknown');
    const knownRefs = Array.from(referencedKnownRefs);
    const eligibleRefs = knownRefs.filter((ref) => input.factByRef.get(ref)?.evaluationEligible === true);
    if (knownRefs.length > 0 && eligibleRefs.length === 0) issues.push('content_support_ref_unconfirmed');
    const supportedCopyCount = copyVerifications.filter((copy) => copy.status === 'supported').length;
    const unsupportedCopyCount = appliedCopyCount - supportedCopyCount;
    const hasCompleteModelCopyDecision = appliedCopies.length > 0 && appliedCopies.every((copy) => (
        cleanText(copy.generationStatus) === 'generated'
        && Number.isFinite(Number(copy.candidateScore))
        && cleanText(copy.candidateReason).length > 0
    ));
    const copyExpected = input.fillPlan?.copyExpected !== false;
    if (String(input.executionStatus || '').startsWith('failed')) issues.push('screen_execution_failed');
    // 屏级视觉策略仍可保持待复核；内容契约只要求文案已经过模型候选决策。
    // 这样 Harness 不会把 heuristic screen plan 误当最终策略，也不会否认已经真实完成的文案选择。
    if (
        (input.screenPlan.requiresModelDecision || cleanText(input.screenPlan.mainMessage).includes('待模型'))
        && copyExpected
        && !hasCompleteModelCopyDecision
    ) {
        issues.push('screen_decision_incomplete');
    }
    if (appliedCopyCount === 0 && copyExpected) {
        issues.push('applied_copy_missing');
    }
    if (appliedCopyCount > 0 && unsupportedCopyCount === appliedCopyCount) {
        issues.push('applied_copy_not_supported');
    } else if (unsupportedCopyCount > 0) {
        issues.push('applied_copy_partially_supported');
    }
    const hasFactBearingCopy = copyVerifications.some((copy) => copy.requiresFactSupport);
    if (hasFactBearingCopy && knownRefs.length === 0) issues.push('content_support_ref_missing');
    const hasFailure = issues.some((issue) => [
        'screen_execution_failed',
        'screen_decision_incomplete',
        'live_screen_missing',
        'live_copy_readback_missing',
        'live_copy_readback_unexpected',
        'content_claim_negation_conflict',
        'content_support_ref_unknown',
        'content_support_ref_unsafe'
    ].includes(issue));
    const status: DetailPageContentScreenVerification['status'] = hasFailure
        ? 'failed'
        : issues.length > 0 ? 'needs_review' : 'passed';
    return {
        screenId: Number(input.screenPlan.screenId || 0),
        status,
        appliedCopyCount,
        supportedCopyCount,
        unsupportedCopyCount,
        supportRefs: knownRefs,
        sourceKinds: unique(knownRefs
            .map((ref) => input.factByRef.get(ref)?.source)
            .filter((source): source is DetailPageContentFactSource => Boolean(source))),
        issueCodes: unique(issues),
        copyVerifications
    };
}

function roundRatio(value: number): number {
    return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
}

export function buildDetailPageContentVerification(input: {
    state?: DesignProjectState | null;
    screenPlans?: readonly DetailScreenPlan[];
    fillPlans?: readonly DetailPageContentFillPlanLike[];
    executionResults?: readonly DetailPageContentExecutionResultLike[];
}): DetailPageContentVerification {
    const catalog = buildDetailPageContentFactCatalog(input);
    const factByRef = new Map(catalog.map((fact) => [fact.ref, fact]));
    const fillPlanByScreenId = new Map((input.fillPlans || []).map((plan) => [Number(plan.screenId || 0), plan]));
    const executionByScreenId = new Map((input.executionResults || []).map((result) => [Number(result.screenId || 0), result.status]));
    const screens = (input.screenPlans || []).map((screenPlan) => buildScreenVerification({
        screenPlan,
        fillPlan: fillPlanByScreenId.get(Number(screenPlan.screenId || 0)),
        executionStatus: executionByScreenId.get(Number(screenPlan.screenId || 0)),
        factByRef
    }));
    const passedScreenCount = screens.filter((screen) => screen.status === 'passed').length;
    const needsReviewScreenCount = screens.filter((screen) => screen.status === 'needs_review').length;
    const failedScreenCount = screens.filter((screen) => screen.status === 'failed').length;
    const linkedScreenCount = screens.filter((screen) => screen.supportRefs.length > 0).length;
    const appliedCopyScreenCount = screens.filter((screen) => screen.appliedCopyCount > 0).length;
    const supportedCopyScreenCount = screens.filter((screen) => (
        screen.appliedCopyCount > 0
        && screen.supportedCopyCount === screen.appliedCopyCount
    )).length;
    const appliedCopyCount = screens.reduce((sum, screen) => sum + screen.appliedCopyCount, 0);
    const supportedCopyCount = screens.reduce((sum, screen) => sum + screen.supportedCopyCount, 0);
    const unsupportedCopyCount = screens.reduce((sum, screen) => sum + screen.unsupportedCopyCount, 0);
    const status: DetailPageContentVerification['status'] = failedScreenCount > 0
        ? 'failed'
        : screens.length > 0 && passedScreenCount === screens.length
            ? 'passed'
            : 'needs_review';
    return {
        version: 'detail-page-content-verification/v0',
        status,
        summary: {
            screenCount: screens.length,
            passedScreenCount,
            needsReviewScreenCount,
            failedScreenCount,
            linkedScreenCount,
            appliedCopyScreenCount,
            supportedCopyScreenCount,
            appliedCopyCount,
            supportedCopyCount,
            unsupportedCopyCount,
            supportCoverageRatio: roundRatio(screens.length > 0 ? linkedScreenCount / screens.length : 0),
            factCount: catalog.length,
            confirmedFactCount: catalog.filter((fact) => fact.evaluationEligible).length,
            unconfirmedFactCount: catalog.filter((fact) => !fact.evaluationEligible).length
        },
        screens,
        issueCodes: unique(screens.flatMap((screen) => screen.issueCodes)),
        verificationPassed: status === 'passed',
        boundaries: {
            executesTools: false,
            callsModel: false,
            containsFactStatements: false,
            containsPaths: false,
            performsSemanticInference: false,
            claimsDesignQuality: false
        }
    };
}
