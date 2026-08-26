/**
 * Evaluation 业务结果适配贡献。
 *
 * 每个贡献只负责一个 Profile 与一个版本化 Skill bridge 结果之间的翻译。
 * 通用聚合器不读取这些业务身份，也不在核心中维护 Profile switch。
 */

import {
    DETAIL_PAGE_EVALUATION_PROFILE_ID,
    DETAIL_PAGE_SCOPED_EDIT_EVALUATION_PROFILE_ID,
    MAIN_IMAGE_EVALUATION_PROFILE_ID,
    SKU_BATCH_EVALUATION_PROFILE_ID,
    SKU_COLOR_CARD_EVALUATION_PROFILE_ID,
    type DesignEvaluationProfile,
    type DesignEvaluationVerificationRecord,
    type DesignEvaluationVerificationStatus
} from './design-evaluation-profiles';

export interface DesignEvaluationResultAdapterContribution {
    profileId: DesignEvaluationProfile['profileId'];
    sourceToolName: string;
    buildRecords(data: Record<string, any>): DesignEvaluationVerificationRecord[];
}

function readRecord(value: unknown): Record<string, any> | undefined {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, any>
        : undefined;
}

function readArray(value: unknown): any[] {
    return Array.isArray(value) ? value : [];
}

function readNumber(value: unknown): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
}

function readText(value: unknown): string {
    return String(value || '').trim();
}

function verificationRecord(
    key: string,
    status: DesignEvaluationVerificationStatus,
    verificationRef: string,
    source: DesignEvaluationVerificationRecord['source'] = 'quality_adapter'
): DesignEvaluationVerificationRecord {
    return { key, status, source, verificationRef };
}

function buildMainImageRecords(data: Record<string, any>): DesignEvaluationVerificationRecord[] {
    const report = readRecord(data.mainImageQaReport);
    if (report?.reportVersion !== 'main-image-qa-report/v0') return [];
    const qualityClaim = readRecord(report.qualityClaim);
    const redaction = readRecord(report.redaction);
    const stage = readText(report.stage);
    const reportStatus = readText(report.status);
    const explicitlyFailed = stage === 'blocked' || reportStatus === 'failed';
    const fullyPassed = stage === 'passed'
        && reportStatus === 'passed'
        && qualityClaim?.allowed === true
        && redaction?.rawImagesRedacted === true
        && redaction?.pathsRedacted === true;
    const status: DesignEvaluationVerificationStatus = explicitlyFailed
        ? 'failed'
        : fullyPassed ? 'passed' : 'needs_review';
    return [verificationRecord(
        'main_image_qa_report',
        status,
        `quality-adapter:main-image-qa-report:${status}`
    )];
}

function buildDetailScreenCoverageRecord(data: Record<string, any>): DesignEvaluationVerificationRecord | undefined {
    const summary = readRecord(data.detailPageAgentResultSummary);
    const stats = readRecord(data.stats);
    const screenPlans = readArray(data.screenPlans);
    if (summary?.summaryVersion !== 'detail-page-agent-result-summary/v0' || !stats) return undefined;
    const processed = readNumber(stats.screensProcessed);
    const succeeded = readNumber(stats.screensSuccess);
    const failed = readNumber(stats.screensFailed);
    const summaryStatus = readText(summary.status);
    const explicitlyFailed = summaryStatus === 'failed'
        || summaryStatus === 'blocked'
        || failed > 0;
    // “屏覆盖”只判断目标屏是否都真实执行；视觉观察记录是否已经逐屏复核由独立的
    // visualObservationBundle 门禁负责。不能因为等待看图就否认已经完成的屏覆盖。
    const fullyCovered = !explicitlyFailed
        && processed > 0
        && failed === 0
        && succeeded === processed
        && screenPlans.length >= processed;
    const status: DesignEvaluationVerificationStatus = explicitlyFailed
        ? 'failed'
        : fullyCovered ? 'passed' : 'needs_review';
    return verificationRecord(
        'detail_page_screen_coverage',
        status,
        `quality-adapter:detail-page-screen-coverage:${status}`
    );
}

function buildDetailPlacementRecord(data: Record<string, any>): DesignEvaluationVerificationRecord | undefined {
    const audit = readRecord(data.placementAudit);
    const diagnostics = readRecord(data.livePlacementDiagnostics);
    if (!audit || !diagnostics) return undefined;
    const warnings = readArray(audit.warnings);
    const riskyScreenIds = readArray(audit.riskyScreenIds);
    const placementCount = readNumber(diagnostics.placementCount);
    const unmatchedCount = readNumber(diagnostics.unmatchedPlaceholderCount);
    const explicitlyFailed = audit.success === false
        || warnings.length > 0
        || riskyScreenIds.length > 0
        || unmatchedCount > 0;
    const fullyPassed = audit.success === true
        && placementCount > 0
        && warnings.length === 0
        && riskyScreenIds.length === 0
        && unmatchedCount === 0;
    const status: DesignEvaluationVerificationStatus = explicitlyFailed
        ? 'failed'
        : fullyPassed ? 'passed' : 'needs_review';
    return verificationRecord(
        'detail_page_placement_audit',
        status,
        `quality-adapter:detail-page-placement-audit:${status}`
    );
}

function buildDetailContentRecord(data: Record<string, any>): DesignEvaluationVerificationRecord | undefined {
    const contentVerification = readRecord(data.detailPageContentVerification);
    if (contentVerification?.version !== 'detail-page-content-verification/v0') return undefined;
    const explicitlyFailed = contentVerification.status === 'failed';
    const fullyPassed = contentVerification.status === 'passed'
        && contentVerification.verificationPassed === true
        && readRecord(contentVerification.summary)?.screenCount > 0
        && readRecord(contentVerification.boundaries)?.claimsDesignQuality === false;
    const status: DesignEvaluationVerificationStatus = explicitlyFailed
        ? 'failed'
        : fullyPassed ? 'passed' : 'needs_review';
    return verificationRecord(
        'detail_page_content_verification',
        status,
        `quality-adapter:detail-page-content-verification:${status}`
    );
}

function buildDetailPageRecords(data: Record<string, any>): DesignEvaluationVerificationRecord[] {
    return [
        buildDetailScreenCoverageRecord(data),
        buildDetailPlacementRecord(data),
        buildDetailContentRecord(data)
    ].filter((record): record is DesignEvaluationVerificationRecord => Boolean(record));
}

function buildDetailPageScopedEditRecords(data: Record<string, any>): DesignEvaluationVerificationRecord[] {
    return [buildDetailPlacementRecord(data)]
        .filter((record): record is DesignEvaluationVerificationRecord => Boolean(record));
}

function buildSkuVariantCoverageRecord(data: Record<string, any>): DesignEvaluationVerificationRecord | undefined {
    const delivery = readRecord(data.skuDeliverySummary);
    const manifest = readArray(data.skuExecutionManifest).map(readRecord).filter(Boolean) as Record<string, any>[];
    if (delivery?.version !== 'sku-delivery-summary/v0' || manifest.length === 0) return undefined;
    const expectedComboCount = manifest.reduce((total, item) => {
        return total + (readArray(item.plannedActions).includes('combo') ? readNumber(item.comboCount) : 0);
    }, 0);
    const expectedNoteCount = manifest.filter((item) => readArray(item.plannedActions).includes('self-select-note')).length;
    const hasBlockedManifest = manifest.some((item) => readText(item.status) === 'blocked');
    const explicitlyFailed = hasBlockedManifest
        || delivery.status === 'failed'
        || delivery.status === 'partial'
        || readNumber(delivery.warningCount) > 0;
    const hasExpectedWork = expectedComboCount > 0 || expectedNoteCount > 0;
    const fullyCovered = delivery.status === 'completed'
        && hasExpectedWork
        && !hasBlockedManifest
        && readNumber(delivery.warningCount) === 0
        && readNumber(delivery.totalCombos) === expectedComboCount
        && readNumber(delivery.noteCount) === expectedNoteCount;
    const status: DesignEvaluationVerificationStatus = explicitlyFailed
        ? 'failed'
        : fullyCovered ? 'passed' : 'needs_review';
    return verificationRecord(
        'sku_variant_coverage',
        status,
        `quality-adapter:sku-variant-coverage:${status}`
    );
}

function buildSkuExportReadbackRecord(data: Record<string, any>): DesignEvaluationVerificationRecord | undefined {
    const readback = readRecord(data.skuExportReadback);
    if (readback?.version !== 'sku-export-readback/v0') return undefined;
    const expectedCount = readNumber(readback.expectedExportCount);
    const probes = readArray(readback.fileProbes);
    const everyProbeHasSafeMetrics = expectedCount > 0
        && probes.length === expectedCount
        && probes.every((value) => {
            const probe = readRecord(value);
            const metrics = readRecord(probe?.visualMetrics);
            return probe?.success === true
                && probe.rawImagesRedacted === true
                && metrics?.rawImagesRedacted === true;
        });
    const explicitlyFailed = readback.status === 'blocked' || readback.status === 'no_exports';
    const fullyPassed = readback.status === 'ready_for_review'
        && expectedCount > 0
        && readNumber(readback.okFileProbeCount) === expectedCount
        && readNumber(readback.failedFileProbeCount) === 0
        && readNumber(readback.missingFileProbeCount) === 0
        && readNumber(readback.dimensionMismatchCount) === 0
        && readNumber(readback.visualMetricBlockerCount) === 0
        && everyProbeHasSafeMetrics;
    const status: DesignEvaluationVerificationStatus = explicitlyFailed
        ? 'failed'
        : fullyPassed ? 'passed' : 'needs_review';
    return verificationRecord(
        'sku_export_readback',
        status,
        `quality-adapter:sku-export-readback:${status}`
    );
}

function getSkuHumanReviewStatus(data: Record<string, any>): DesignEvaluationVerificationStatus | undefined {
    const binding = readRecord(data.skuHumanReviewBinding);
    if (binding?.version !== 'sku-human-review-binding/v0') return undefined;
    const status = readText(binding.status);
    const freshness = readRecord(binding.freshness);
    if (status === 'blocked_current_output' || status === 'invalid_review_ignored' || status === 'fresh_review_rejected') {
        return 'failed';
    }
    if (
        status === 'fresh_review_approved'
        && binding.canSatisfyHumanReviewCheck === true
        && freshness?.checked === true
        && freshness.subjectMatched === true
        && freshness.projectMatched === true
        && freshness.recordIntegrityVerified === true
    ) {
        return 'passed';
    }
    return 'needs_review';
}

function buildSkuRecords(data: Record<string, any>): DesignEvaluationVerificationRecord[] {
    const records: Array<DesignEvaluationVerificationRecord | undefined> = [
        buildSkuVariantCoverageRecord(data),
        buildSkuExportReadbackRecord(data)
    ];
    const reviewStatus = getSkuHumanReviewStatus(data);
    if (reviewStatus) {
        records.push(
            verificationRecord(
                'sku_product_truth',
                reviewStatus,
                `quality-adapter:sku-product-truth:${reviewStatus}`,
                'human_review'
            ),
            verificationRecord(
                'sku_visual_consistency',
                reviewStatus,
                `quality-adapter:sku-visual-consistency:${reviewStatus}`,
                'human_review'
            )
        );
    }
    return records.filter((record): record is DesignEvaluationVerificationRecord => Boolean(record));
}

function buildSkuColorCardRecords(data: Record<string, any>): DesignEvaluationVerificationRecord[] {
    const report = readRecord(data.report);
    if (report?.version !== 'sku-color-card-execution-report/v1'
        && report?.version !== 'sku-color-card-execution-report/v2') return [];
    const checks = readRecord(report.checks);
    if (!checks) return [];

    function statusForCheck(value: unknown): DesignEvaluationVerificationStatus {
        if (value === 'passed') return 'passed';
        if (value === 'failed') return 'failed';
        return 'needs_review';
    }

    const finalStructureStatus = statusForCheck(checks.finalStructureReadback);
    const sourceCoverageStatus = statusForCheck(checks.sourceCoverage);
    const smartObjectStatus = statusForCheck(checks.smartObjectEditability);
    const flatClippingNotApplicable = report.version === 'sku-color-card-execution-report/v2'
        && report.presentationMode === 'flat'
        && checks.clippingStructure === 'not_applicable';
    const clippingStatus = flatClippingNotApplicable
        ? 'passed'
        : statusForCheck(checks.clippingStructure);
    const labelTextFitStatus = statusForCheck(checks.labelTextFit);
    const visualCompositionStatus = statusForCheck(checks.visualComposition);
    return [
        verificationRecord(
            'sku_color_card_final_structure',
            finalStructureStatus,
            `quality-adapter:sku-color-card-structure:${finalStructureStatus}`
        ),
        verificationRecord(
            'sku_color_card_source_coverage',
            sourceCoverageStatus,
            `quality-adapter:sku-color-card-source-coverage:${sourceCoverageStatus}`
        ),
        verificationRecord(
            'sku_color_card_smart_object_editability',
            smartObjectStatus,
            `quality-adapter:sku-color-card-smart-object:${smartObjectStatus}`
        ),
        verificationRecord(
            'sku_color_card_clipping_structure',
            clippingStatus,
            flatClippingNotApplicable
                ? 'quality-adapter:sku-color-card-clipping:not-applicable-flat'
                : `quality-adapter:sku-color-card-clipping:${clippingStatus}`
        ),
        verificationRecord(
            'sku_color_card_label_text_fit',
            labelTextFitStatus,
            `quality-adapter:sku-color-card-label-text-fit:${labelTextFitStatus}`
        ),
        verificationRecord(
            'sku_color_card_visual_consistency',
            visualCompositionStatus,
            `quality-adapter:sku-color-card-visual-consistency:${visualCompositionStatus}`
        )
    ];
}

function contribution(input: DesignEvaluationResultAdapterContribution): DesignEvaluationResultAdapterContribution {
    return Object.freeze(input);
}

export const DESIGN_EVALUATION_RESULT_ADAPTER_CONTRIBUTIONS: readonly DesignEvaluationResultAdapterContribution[] = Object.freeze([
    contribution({
        profileId: MAIN_IMAGE_EVALUATION_PROFILE_ID,
        sourceToolName: 'main-image-design',
        buildRecords: buildMainImageRecords
    }),
    contribution({
        profileId: DETAIL_PAGE_EVALUATION_PROFILE_ID,
        sourceToolName: 'detail-page-design',
        buildRecords: buildDetailPageRecords
    }),
    contribution({
        profileId: DETAIL_PAGE_SCOPED_EDIT_EVALUATION_PROFILE_ID,
        sourceToolName: 'detail-page-design',
        buildRecords: buildDetailPageScopedEditRecords
    }),
    contribution({
        profileId: SKU_COLOR_CARD_EVALUATION_PROFILE_ID,
        sourceToolName: 'sku-color-card',
        buildRecords: buildSkuColorCardRecords
    }),
    contribution({
        profileId: SKU_BATCH_EVALUATION_PROFILE_ID,
        sourceToolName: 'sku-batch',
        buildRecords: buildSkuRecords
    })
]);
