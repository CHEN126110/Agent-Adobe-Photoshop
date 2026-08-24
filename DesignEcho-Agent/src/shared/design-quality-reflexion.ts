import type { DesignAssertionResult } from './design-quality-assertion';
import { resolveDesignReviewSetItemForDiagnosis } from './design-visual-judge-observation';
import type { DesignReviewSet } from './visual-observation-bundle';

export interface DesignQualityReflexionIssueRecord {
    sourceId: string;
    observationKey: string;
    description: string;
    expectedFix: string;
    blocker: false;
}

/**
 * Project reliable VLM diagnoses onto their exact ReviewSet items. The output carries evidence
 * identity and advisory repair text; it does not decide whether to re-enter or execute a change.
 */
export function buildDesignQualityReflexionIssues(
    results: readonly DesignAssertionResult[],
    reviewSet?: DesignReviewSet
): DesignQualityReflexionIssueRecord[] {
    if (!reviewSet) return [];
    return results.map((result): DesignQualityReflexionIssueRecord | undefined => {
        const diagnosis = result.diagnosis;
        const target = String(diagnosis?.visualFinding.target || '').trim();
        const reviewItem = resolveDesignReviewSetItemForDiagnosis(reviewSet, target)
            || (reviewSet.items.length === 1 ? reviewSet.items[0] : undefined);
        if (!reviewItem) return undefined;
        const sourceId = reviewItem.identity.sourceId;
        const preserve = diagnosis?.revision.preserve || [];
        const verify = diagnosis?.revision.verify || [];
        return {
            sourceId,
            observationKey: reviewItem.observationKey,
            description: diagnosis?.visualFinding.description || result.rationale,
            expectedFix: [
                diagnosis?.revision.action || '只修正该画面的已定位关系',
                preserve.length > 0 ? `保持：${preserve.join('、')}` : '',
                verify.length > 0 ? `复核：${verify.join('、')}` : '',
                `修订后必须用新 history 重新观察 ${sourceId}`
            ].filter(Boolean).join('；'),
            blocker: false
        };
    }).filter((item): item is DesignQualityReflexionIssueRecord => Boolean(item));
}
