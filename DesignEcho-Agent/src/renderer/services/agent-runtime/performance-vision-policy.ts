/**
 * Agent 视觉成本策略：把候选、普通视觉分析与独立终审事件的额度计算集中在一起。
 *
 * 这里只做纯计算，不读取 Photoshop、不调用模型，也不决定设计内容。Agent 主循环提供
 * 当前 ReviewSet 与声明式预算，策略返回可用容量，避免预算分支继续堆进 agent.ts。
 */

import { resolveVisionCandidateLimitForFinalQuality } from '../../../shared/design-visual-judge-observation';
import type { DesignReviewSet } from '../../../shared/visual-observation-bundle';
import {
    canQueueRunLevelVisualPresentation,
    readRunLevelVisualBudgetConsumed,
    resolveFinalQualityDiagnosisRepairVisionAllowance,
    resolveFinalQualityJudgeVisionAllowance,
    type PerformanceBudget,
    type PerformanceLedgerState,
    type PerformanceModelBudgetClass
} from './performance-ledger';

export interface PerformanceVisionBudgetSnapshot {
    candidateHardLimit: number;
    candidateLimit: number;
    initialCandidateLimit: number;
    runLevelLimit: number;
    runLevelConsumed: number;
    canQueuePrimaryVisualPresentation: boolean;
}

export function resolvePerformanceVisionBudgetSnapshot(input: {
    ledger: PerformanceLedgerState;
    budget: PerformanceBudget | undefined;
    defaultMaxVisionCandidates: number;
    requiresMultiSurface: boolean;
    reviewSet?: DesignReviewSet;
    visualAnalysisAlreadyPending: boolean;
}): PerformanceVisionBudgetSnapshot {
    const configuredCandidates = input.budget?.maxVisionCandidates;
    const candidateHardLimit = typeof configuredCandidates === 'number'
        && Number.isFinite(configuredCandidates)
        ? Math.max(0, Math.floor(configuredCandidates))
        : Math.max(0, Math.floor(input.defaultMaxVisionCandidates));
    const configuredAnalyses = input.budget?.maxVisualAnalyses;
    const analysisHardLimit = typeof configuredAnalyses === 'number'
        && Number.isFinite(configuredAnalyses)
        ? Math.max(0, Math.floor(configuredAnalyses))
        : 0;
    const runLevelLimit = candidateHardLimit + analysisHardLimit;
    const runLevelConsumed = readRunLevelVisualBudgetConsumed(input.ledger);
    const configuredInitialLimit = Number(input.budget?.maxInitialVisionCandidates);
    const maxInitialVisionCandidates = Number.isFinite(configuredInitialLimit)
        ? configuredInitialLimit
        : Math.min(5, candidateHardLimit);
    const reviewSetAwareLimit = resolveVisionCandidateLimitForFinalQuality({
        hardLimit: candidateHardLimit,
        maxInitialVisionCandidates,
        requiresMultiSurface: input.requiresMultiSurface,
        reviewSet: input.reviewSet,
        supportingImageReserve: input.requiresMultiSurface ? 0 : 1
    });
    const poolCandidateLimit = input.ledger.visionCandidateCount
        + Math.max(0, runLevelLimit - runLevelConsumed);
    const candidateLimit = Math.min(reviewSetAwareLimit, poolCandidateLimit);
    const initialCandidateLimit = Number.isFinite(configuredInitialLimit)
        ? Math.max(0, Math.min(candidateLimit, Math.floor(configuredInitialLimit)))
        : candidateLimit <= 2
            ? candidateLimit
            : Math.min(5, Math.max(0, candidateLimit - Math.max(2, Math.ceil(candidateLimit / 2))));
    return {
        candidateHardLimit,
        candidateLimit,
        initialCandidateLimit,
        runLevelLimit,
        runLevelConsumed,
        canQueuePrimaryVisualPresentation: typeof configuredAnalyses !== 'number'
            || !Number.isFinite(configuredAnalyses)
            || canQueueRunLevelVisualPresentation({
                limit: runLevelLimit,
                consumed: runLevelConsumed,
                visualAnalysisAlreadyPending: input.visualAnalysisAlreadyPending
            })
    };
}

export function resolvePerformanceVisionCallCapacity(input: {
    ledger: PerformanceLedgerState;
    snapshot: PerformanceVisionBudgetSnapshot;
    visualAnalysis: boolean;
    budgetClass: PerformanceModelBudgetClass;
}): { hasFixedEventCapacity: boolean; remainingCandidateCount: number } {
    if (input.budgetClass === 'final_quality_judge') {
        return resolveFinalQualityJudgeVisionAllowance(
            input.ledger,
            input.snapshot.candidateHardLimit
        );
    }
    if (input.budgetClass === 'final_quality_diagnosis_repair') {
        return resolveFinalQualityDiagnosisRepairVisionAllowance(input.ledger);
    }
    const poolRemaining = input.snapshot.runLevelLimit
        - input.snapshot.runLevelConsumed
        - Number(input.visualAnalysis);
    return {
        hasFixedEventCapacity: poolRemaining >= 0,
        remainingCandidateCount: Math.max(0, Math.min(
            input.snapshot.candidateLimit - input.ledger.visionCandidateCount,
            poolRemaining
        ))
    };
}
