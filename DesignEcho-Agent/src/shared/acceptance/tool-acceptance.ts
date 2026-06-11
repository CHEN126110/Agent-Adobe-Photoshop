import {
    AcceptanceBounds,
    AcceptanceLayer,
    AcceptanceSnapshot,
    AcceptanceSnapshotDiff,
    diffAcceptanceSnapshots
} from './photoshop-acceptance';
import { buildAgentAcceptanceCaptureBudget } from '../agent-performance-policy';

export type ToolAcceptanceStatus =
    | 'not_collected'
    | 'collected'
    | 'snapshot_failed'
    | 'diff_unavailable';

export interface AcceptanceCaptureResult {
    snapshot?: AcceptanceSnapshot;
    error?: string;
}

export interface AcceptanceSnapshotSummary {
    hasDocument: boolean;
    documentName?: string;
    documentSize?: {
        width?: number;
        height?: number;
    };
    selectedLayerIds: number[];
    summary?: AcceptanceSnapshot['summary'];
    warnings: string[];
    error?: string;
}

export interface ToolAcceptanceEvidence {
    enabled: boolean;
    toolName: string;
    status: ToolAcceptanceStatus;
    toolSucceeded?: boolean;
    verified: boolean;
    noDocumentChangeRisk: boolean;
    before?: AcceptanceSnapshotSummary;
    after?: AcceptanceSnapshotSummary;
    diff?: {
        comparable: boolean;
        issues: string[];
        summary: AcceptanceSnapshotDiff['summary'];
        addedLayerIds: number[];
        removedLayerIds: number[];
        changedLayers: AcceptanceSnapshotDiff['changedLayers'];
    };
    warnings: string[];
    error?: string;
    assertions?: ToolAcceptanceAssertion[];
    assertionStatus?: ToolAcceptanceAssertionStatus;
    summaryText?: string;
    debugText?: string;
}

export type ToolAcceptanceAssertionStatus =
    | 'passed'
    | 'failed'
    | 'needs_review'
    | 'not_applicable';

export interface ToolAcceptanceAssertion {
    id: string;
    label: string;
    status: ToolAcceptanceAssertionStatus;
    summary: string;
    expected?: string;
    actual?: string;
    scope?: string;
    affectedLayerIds?: number[];
    warnings?: string[];
}

export interface ToolAcceptanceCapturePolicy {
    collect: boolean;
    mode: 'standard' | 'deep';
    includeHidden: boolean;
    includeBounds: boolean;
    includeText: boolean;
    maxLayers: number;
    timeoutMs: number;
    reason: string;
}

const DOCUMENT_MUTATION_TOOLS = new Set([
    'createDocument',
    'closeDocument',
    'setTextContent',
    'setTextStyle',
    'moveLayer',
    'moveLayerToGroup',
    'reorderLayer',
    'alignLayers',
    'distributeLayers',
    'transformLayer',
    'quickScale',
    'setLayerOpacity',
    'setBlendMode',
    'duplicateLayer',
    'deleteLayer',
    'addDropShadow',
    'addStroke',
    'addGlow',
    'clearLayerEffects',
    'renameLayer',
    'batchRenameLayers',
    'groupLayers',
    'ungroupLayers',
    'createClippingMask',
    'releaseClippingMask',
    'removeBackground',
    'applyMattingResult',
    'applyMultiMattingResult',
    'placeImage',
    'replaceLayerContent',
    'replaceImagePlaceholder',
    'batchRenderTemplate',
    'fillDetailPage',
    'autoFixDetailPage',
    'harmonizeLayer',
    'quickHarmonize',
    'createRectangle',
    'createEllipse',
    'createTextLayer',
    'createGroup',
    'smartLayout',
    'alignToReference',
    'createSkuPlaceholders',
    'convertToSmartObject',
    'replaceSmartObjectContents',
    'updateSmartObject',
    'duplicateSmartObject',
    'rasterizeSmartObject'
]);

const DOCUMENT_CHANGE_OPTIONAL_TOOLS = new Set([
    'createDocument',
    'closeDocument',
    'openTemplate',
    'switchDocument'
]);

const TEXT_MUTATION_TOOLS = new Set([
    'setTextContent',
    'setTextStyle',
    'createTextLayer'
]);

const BULK_MUTATION_TOOLS = new Set([
    'fillDetailPage',
    'batchRenderTemplate',
    'skuLayout',
    'smartLayout',
    'batchRenameLayers',
    'createSkuPlaceholders'
]);

const IMAGE_MUTATION_TOOLS = new Set([
    'placeImage',
    'replaceLayerContent',
    'replaceImagePlaceholder',
    'removeBackground',
    'applyMattingResult',
    'applyMultiMattingResult',
    'harmonizeLayer',
    'quickHarmonize'
]);

function resolveCaptureReason(input: {
    deep: boolean;
    bulk: boolean;
    textSensitive: boolean;
    image: boolean;
}): string {
    if (input.deep) return 'explicit deep acceptance mode';
    if (input.bulk) return 'bulk mutation tool uses wider layer budget but no pixel read';
    if (input.textSensitive) return 'text mutation tool needs text/style evidence';
    if (input.image) return 'image mutation tool prioritizes bounds and structure evidence';
    return 'standard mutation evidence';
}

function statusFromBoundsDeviation(deviation?: { maxAbs: number }): ToolAcceptanceAssertionStatus | undefined {
    if (!deviation) return undefined;
    if (deviation.maxAbs <= 2) return 'passed';
    if (deviation.maxAbs <= 8) return 'needs_review';
    return 'failed';
}

function resolvePlacementAssertionStatus(
    placementStatus: string,
    deviationStatus?: ToolAcceptanceAssertionStatus
): ToolAcceptanceAssertionStatus {
    let status: ToolAcceptanceAssertionStatus;

    if (placementStatus === 'mismatch') {
        status = 'failed';
    } else if (placementStatus === 'watch' || placementStatus === 'unverified') {
        status = 'needs_review';
    } else {
        status = 'passed';
    }

    if (deviationStatus === 'failed') return 'failed';
    if (deviationStatus === 'needs_review' && status === 'passed') return 'needs_review';
    return status;
}

function formatAssertionStatusLabel(status: ToolAcceptanceAssertionStatus): string {
    if (status === 'passed') return '通过';
    if (status === 'failed') return '失败';
    return '需复核';
}

export function shouldCollectAcceptanceEvidence(toolName: string, params: any = {}): boolean {
    if (!toolName || toolName === 'getAcceptanceSnapshot') return false;
    if (params?.acceptance === false || params?.acceptanceMode === 'off') return false;
    if (toolName === 'skuLayout') {
        return ['execute', 'arrangeDynamic'].includes(String(params?.action || ''));
    }
    return DOCUMENT_MUTATION_TOOLS.has(toolName);
}

export function getToolAcceptanceCapturePolicy(toolName: string, params: any = {}): ToolAcceptanceCapturePolicy {
    const collect = shouldCollectAcceptanceEvidence(toolName, params);
    if (!collect) {
        return {
            collect: false,
            mode: 'standard',
            includeHidden: false,
            includeBounds: false,
            includeText: false,
            maxLayers: 0,
            timeoutMs: 0,
            reason: 'read-only or non-Photoshop-mutating tool'
        };
    }

    const requestedMode = params?.acceptanceMode === 'deep' ? 'deep' : 'standard';
    const deep = requestedMode === 'deep';
    const textSensitive = TEXT_MUTATION_TOOLS.has(toolName);
    const bulk = BULK_MUTATION_TOOLS.has(toolName);
    const image = IMAGE_MUTATION_TOOLS.has(toolName);
    const budget = buildAgentAcceptanceCaptureBudget({ deep, bulk });

    return {
        collect: true,
        mode: requestedMode,
        includeHidden: true,
        includeBounds: true,
        includeText: deep || textSensitive || (!image && !bulk),
        maxLayers: budget.maxLayers,
        timeoutMs: budget.timeoutMs,
        reason: resolveCaptureReason({ deep, bulk, textSensitive, image })
    };
}

export function buildToolAcceptanceEvidence(input: {
    toolName: string;
    params?: any;
    result: any;
    before: AcceptanceCaptureResult;
    after: AcceptanceCaptureResult;
    maxChangedLayers?: number;
}): ToolAcceptanceEvidence {
    const warnings: string[] = [];
    const maxChangedLayers = buildAgentAcceptanceCaptureBudget({
        maxChangedLayers: input.maxChangedLayers
    }).maxChangedLayers;
    const toolSucceeded = input.result?.success !== false;

    if (input.before.error) warnings.push(`before snapshot failed: ${input.before.error}`);
    if (input.after.error) warnings.push(`after snapshot failed: ${input.after.error}`);
    if (!toolSucceeded) warnings.push('工具返回失败，验收证据只能用于诊断，不能证明任务完成。');

    if (!input.before.snapshot || !input.after.snapshot) {
        return withAcceptanceSummaries({
            enabled: true,
            toolName: input.toolName,
            status: 'snapshot_failed',
            toolSucceeded,
            verified: false,
            noDocumentChangeRisk: false,
            before: input.before.snapshot ? summarizeAcceptanceSnapshot(input.before.snapshot) : undefined,
            after: input.after.snapshot ? summarizeAcceptanceSnapshot(input.after.snapshot) : undefined,
            warnings,
            error: warnings.join('; ') || 'acceptance snapshot is unavailable'
        });
    }

    const diff = diffAcceptanceSnapshots(input.before.snapshot, input.after.snapshot);
    const changedTotal = diff.summary.added + diff.summary.removed + diff.summary.changed;
    for (const issue of diff.issues) {
        warnings.push(issue);
    }
    const assertions = buildToolAcceptanceAssertions({
        toolName: input.toolName,
        params: input.params,
        result: input.result,
        before: input.before.snapshot,
        after: input.after.snapshot
    });
    const assertionStatus = summarizeAssertionStatus(assertions);
    const noDocumentChangeRisk =
        toolSucceeded &&
        diff.comparable &&
        changedTotal === 0 &&
        assertionStatus !== 'passed' &&
        !DOCUMENT_CHANGE_OPTIONAL_TOOLS.has(input.toolName);

    if (noDocumentChangeRisk) {
        warnings.push('工具返回成功，但 before/after 验收快照未发现文档结构、文字、几何或样式变化。');
    }
    for (const assertion of assertions) {
        if (assertion.status === 'failed' || assertion.status === 'needs_review') {
            warnings.push(assertion.summary);
        }
    }

    return withAcceptanceSummaries({
        enabled: true,
        toolName: input.toolName,
        status: diff ? 'collected' : 'diff_unavailable',
        toolSucceeded,
        verified: toolSucceeded && diff.comparable && !noDocumentChangeRisk && assertionStatus !== 'failed' && assertionStatus !== 'needs_review',
        noDocumentChangeRisk,
        before: summarizeAcceptanceSnapshot(input.before.snapshot),
        after: summarizeAcceptanceSnapshot(input.after.snapshot),
        diff: {
            comparable: diff.comparable,
            issues: diff.issues,
            summary: diff.summary,
            addedLayerIds: diff.addedLayerIds.slice(0, maxChangedLayers),
            removedLayerIds: diff.removedLayerIds.slice(0, maxChangedLayers),
            changedLayers: diff.changedLayers.slice(0, maxChangedLayers)
        },
        warnings,
        ...(assertions.length > 0 ? { assertions, assertionStatus } : {})
    });
}

export function summarizeAcceptanceSnapshot(snapshot: AcceptanceSnapshot): AcceptanceSnapshotSummary {
    return {
        hasDocument: snapshot.hasDocument === true,
        documentName: snapshot.document?.name,
        documentSize: {
            width: snapshot.document?.width,
            height: snapshot.document?.height
        },
        selectedLayerIds: Array.isArray(snapshot.selectedLayerIds) ? snapshot.selectedLayerIds : [],
        summary: snapshot.summary,
        warnings: Array.isArray(snapshot.warnings) ? snapshot.warnings : [],
        error: snapshot.error
    };
}

export function formatToolAcceptanceSummary(evidence?: ToolAcceptanceEvidence): string | undefined {
    if (!evidence?.enabled) return undefined;

    if (evidence.status === 'snapshot_failed') {
        const detail = evidence.error ? `原因：${evidence.error}` : '原因：快照不可用';
        return `验收证据：未能采集完整 before/after 快照，不能证明 Photoshop 文档已变化。${detail}`;
    }

    if (evidence.status === 'diff_unavailable' || !evidence.diff) {
        return '验收证据：已尝试采集快照，但未能生成可用差异。';
    }

    const summary = evidence.diff.summary;
    const changedTotal = summary.added + summary.removed + summary.changed;
    const assertionText = formatAssertionSummaryText(evidence);

    if (!evidence.diff.comparable) {
        const issues = evidence.diff.issues.slice(0, 2).join('；') || '快照不可直接比较';
        return `验收证据：已采集 before/after 快照，但需要复核。${issues}${assertionText}`;
    }

    if (evidence.toolSucceeded === false) {
        const changeText = changedTotal > 0
            ? `仍检测到 ${changedTotal} 项文档变化，但不能证明任务完成。`
            : '未检测到 Photoshop 文档结构、文字、几何或样式变化。';
        return `验收警告：工具返回失败，不能证明任务完成；${changeText}${assertionText}`;
    }

    if (evidence.noDocumentChangeRisk || changedTotal === 0) {
        return `验收警告：工具返回成功，但未检测到 Photoshop 文档结构、文字、几何或样式变化。${assertionText}`;
    }

    const parts = [
        `新增 ${summary.added}`,
        `删除 ${summary.removed}`,
        `改动 ${summary.changed}`
    ];
    const typedChanges: string[] = [];
    if (summary.textChanged > 0) typedChanges.push(`文字 ${summary.textChanged}`);
    if (summary.geometryChanged > 0) typedChanges.push(`几何 ${summary.geometryChanged}`);
    if (summary.styleChanged > 0) typedChanges.push(`样式 ${summary.styleChanged}`);

    const typedText = typedChanges.length > 0 ? `；其中 ${typedChanges.join('、')}` : '';
    return `验收证据：已采集 before/after 快照，检测到 ${changedTotal} 项变化（${parts.join('，')}）${typedText}。${assertionText}`;
}

export function formatToolAcceptanceDebug(evidence?: ToolAcceptanceEvidence): string | undefined {
    if (!evidence?.enabled) return undefined;

    const details = [
        `status=${evidence.status}`,
        `toolSucceeded=${evidence.toolSucceeded !== false}`,
        `verified=${evidence.verified}`,
        `noDocumentChangeRisk=${evidence.noDocumentChangeRisk}`
    ];
    const policy = (evidence as any).policy;
    if (policy) {
        details.push(`mode=${policy.mode}`);
        details.push(`maxLayers=${policy.maxLayers}`);
        details.push(`includeText=${policy.includeText}`);
        details.push(`timeoutMs=${policy.timeoutMs}`);
    }
    if (evidence.warnings.length > 0) {
        details.push(`warnings=${evidence.warnings.length}`);
    }
    if (evidence.assertions?.length) {
        details.push(`assertionStatus=${evidence.assertionStatus || 'unknown'}`);
        details.push(`assertions=${evidence.assertions.length}`);
    }
    return `验收调试：${details.join('，')}`;
}

function buildToolAcceptanceAssertions(input: {
    toolName: string;
    params?: any;
    result?: any;
    before: AcceptanceSnapshot;
    after: AcceptanceSnapshot;
}): ToolAcceptanceAssertion[] {
    if (input.toolName === 'closeDocument') {
        const closeAssertion = buildCloseDocumentAssertion(input.params, input.result, input.before, input.after);
        return closeAssertion ? [closeAssertion] : [];
    }
    if (input.toolName === 'moveLayer') {
        const moveAssertion = buildMoveLayerAssertion(input.params, input.before, input.after);
        return moveAssertion ? [moveAssertion] : [];
    }
    if (input.toolName === 'placeImage') {
        const placeImageAssertion = buildPlaceImageAssertion(input.params, input.result, input.before, input.after);
        return placeImageAssertion ? [placeImageAssertion] : [];
    }
    if (input.toolName === 'replaceImagePlaceholder') {
        const replacementAssertion = buildReplaceImagePlaceholderAssertion(input.params, input.result, input.before, input.after);
        return replacementAssertion ? [replacementAssertion] : [];
    }
    if (input.toolName === 'replaceLayerContent') {
        const replaceLayerContentAssertion = buildReplaceLayerContentAssertion(input.params, input.result, input.before, input.after);
        return replaceLayerContentAssertion ? [replaceLayerContentAssertion] : [];
    }
    if (input.toolName === 'createTextLayer') {
        const createTextAssertion = buildCreateTextLayerAssertion(input.params, input.result, input.before, input.after);
        return createTextAssertion ? [createTextAssertion] : [];
    }
    if (input.toolName === 'createRectangle' || input.toolName === 'createEllipse') {
        const createShapeAssertion = buildCreateShapeLayerAssertion(input.toolName, input.params, input.result, input.before, input.after);
        return createShapeAssertion ? [createShapeAssertion] : [];
    }
    if (input.toolName === 'fillDetailPage') {
        const fillDetailAssertion = buildFillDetailPageAssertion(input.params, input.result, input.before, input.after);
        return fillDetailAssertion ? [fillDetailAssertion] : [];
    }
    if (input.toolName === 'setTextContent') {
        const textAssertion = buildSetTextContentAssertion(input.params, input.before, input.after);
        return textAssertion ? [textAssertion] : [];
    }
    if (input.toolName === 'setTextStyle') {
        const fontAssertion = buildSetTextStyleFontAssertion(input.params, input.before, input.after);
        return [
            ...(fontAssertion ? [fontAssertion] : []),
            ...buildSetTextStyleNumericAssertions(input.params, input.before, input.after)
        ];
    }
    return [];
}

function buildFillDetailPageAssertion(
    params: any,
    result: any,
    before: AcceptanceSnapshot,
    after: AcceptanceSnapshot
): ToolAcceptanceAssertion {
    const fillResults = collectFillDetailResults(result);
    const plans = collectFillDetailPlans(params);
    if (fillResults.length === 0) {
        return {
            id: 'fillDetailPage.result',
            label: '详情页填充',
            status: 'needs_review',
            summary: '详情页填充验收需复核：工具结果不是可识别的 fillDetailPage 返回结构。',
            expected: 'FillResult 或 FillResult[]',
            actual: typeof result,
            scope: 'fillDetailPage result',
            warnings: ['fillDetailPage result shape is not recognized']
        };
    }

    const resultFailures = fillResults.filter((item) => item?.success === false || (Array.isArray(item?.errors) && item.errors.length > 0));
    if (resultFailures.length > 0) {
        return {
            id: 'fillDetailPage.errors',
            label: '详情页填充错误',
            status: 'failed',
            summary: `详情页填充验收失败：${resultFailures.length}/${fillResults.length} 个填充结果报告失败或存在 errors。${summarizeFillErrors(resultFailures)}`,
            expected: '所有 FillResult success=true 且 errors 为空',
            actual: summarizeFillErrors(resultFailures),
            scope: summarizeFillScope(fillResults),
            affectedLayerIds: collectFillAffectedLayerIds(fillResults),
            warnings: ['fillDetailPage returned failed result or errors']
        };
    }

    const countCheck = buildFillDetailCountCheck(plans, fillResults);
    if (countCheck) return countCheck;

    const placements = fillResults.flatMap((item) => Array.isArray(item?.placements) ? item.placements : []);
    const expectedImages = plans.reduce((sum, plan) => sum + countExpectedFillImages(plan), 0);
    if (expectedImages > 0 && placements.length === 0) {
        return {
            id: 'fillDetailPage.placements',
            label: '详情页图片填充',
            status: 'failed',
            summary: `详情页填充验收失败：计划包含 ${expectedImages} 个图片填充项，但结果没有 placement 记录。`,
            expected: `placements=${expectedImages}`,
            actual: 'placements=0',
            scope: summarizeFillScope(fillResults),
            warnings: ['image fill result contains no placement records']
        };
    }

    const placementCheck = evaluateFillPlacements(placements, before, after);
    if (placementCheck.status !== 'passed') {
        return {
            id: 'fillDetailPage.placement',
            label: '详情页图片落位',
            status: placementCheck.status,
            summary: `详情页图片落位验收${placementCheck.status === 'failed' ? '失败' : '需复核'}：${placementCheck.summary}`,
            expected: 'placement actualLayerId 存在且 bounds 与结果记录匹配',
            actual: placementCheck.summary,
            scope: summarizeFillScope(fillResults),
            affectedLayerIds: placementCheck.affectedLayerIds,
            warnings: placementCheck.warnings
        };
    }

    const auditSummaryCheck = buildFillAuditSummaryCheck(fillResults, placements);
    if (auditSummaryCheck) return auditSummaryCheck;

    return {
        id: 'fillDetailPage.result',
        label: '详情页填充',
        status: 'passed',
        summary: `详情页填充验收通过：${fillResults.length} 个结果无 errors，${placements.length} 个图片 placement 的图层和 bounds 可验证。`,
        expected: `results=${fillResults.length}, placements=${placements.length}`,
        actual: `results=${fillResults.length}, placements=${placements.length}`,
        scope: summarizeFillScope(fillResults),
        affectedLayerIds: collectFillAffectedLayerIds(fillResults),
        warnings: ['this assertion verifies fill counts, placement layers, and bounds only; it does not verify image content, copy layout, clipping fidelity, or design quality']
    };
}

function buildCreateTextLayerAssertion(
    params: any,
    result: any,
    before: AcceptanceSnapshot,
    after: AcceptanceSnapshot
): ToolAcceptanceAssertion {
    const target = resolveCreatedLayer(result, before, after, '文字图层');
    if (target.status !== 'passed') {
        return {
            id: 'createTextLayer.layer',
            label: '创建文字图层',
            status: target.status,
            summary: `创建文字图层验收${target.status === 'failed' ? '失败' : '需复核'}：${target.reason}`,
            expected: '执行后出现一个可定位的新增文字图层',
            actual: target.reason,
            scope: target.scope,
            affectedLayerIds: target.layerId ? [target.layerId] : undefined,
            warnings: target.warnings
        };
    }

    const layer = target.afterLayer;
    if (!isTextAcceptanceLayer(layer)) {
        return {
            id: 'createTextLayer.kind',
            label: '创建文字图层类型',
            status: 'failed',
            summary: `创建文字图层验收失败：新增图层 ${layer.id} 不是文本图层，kind=${layer.kind || 'unknown'}。`,
            expected: 'kind=text',
            actual: `kind=${layer.kind || 'unknown'}`,
            scope: target.scope,
            affectedLayerIds: [layer.id],
            warnings: ['created layer is not recognized as a text layer in acceptance snapshot']
        };
    }

    const expectedContent = normalizeTextContentForCompare(result?.content ?? params?.content ?? params?.text ?? '');
    if (expectedContent && !textContentMatches(layer.text?.content, expectedContent)) {
        return {
            id: 'createTextLayer.content',
            label: '创建文字图层内容',
            status: 'failed',
            summary: `创建文字图层验收失败：图层 ${layer.id} 期望内容「${truncateForAssertion(expectedContent)}」，实际「${truncateForAssertion(normalizeTextContentForCompare(layer.text?.content))}」。`,
            expected: truncateForAssertion(expectedContent),
            actual: truncateForAssertion(normalizeTextContentForCompare(layer.text?.content)),
            scope: target.scope,
            affectedLayerIds: [layer.id]
        };
    }

    const expectedFontSize = Number(params?.fontSize);
    const actualFontSize = Number(layer.text?.style?.fontSize);
    if (Number.isFinite(expectedFontSize) && expectedFontSize > 0) {
        if (!Number.isFinite(actualFontSize) || !numberWithinTolerance(actualFontSize, expectedFontSize, 0.5)) {
            return {
                id: 'createTextLayer.fontSize',
                label: '创建文字图层字号',
                status: 'failed',
                summary: `创建文字图层验收失败：图层 ${layer.id} 期望字号 ${roundForSummary(expectedFontSize)}，实际 ${Number.isFinite(actualFontSize) ? roundForSummary(actualFontSize) : '未知'}。`,
                expected: `fontSize=${roundForSummary(expectedFontSize)}`,
                actual: Number.isFinite(actualFontSize) ? `fontSize=${roundForSummary(actualFontSize)}` : 'fontSize unavailable',
                scope: target.scope,
                affectedLayerIds: [layer.id]
            };
        }
    }

    const numericStyleChecks: Array<{ key: 'tracking' | 'leading'; label: string; tolerance: number }> = [
        { key: 'tracking', label: '字距', tolerance: 1 },
        { key: 'leading', label: '行高', tolerance: 0.5 }
    ];
    for (const check of numericStyleChecks) {
        const expected = Number(params?.[check.key]);
        if (!Number.isFinite(expected)) continue;
        const actual = Number(layer.text?.style?.[check.key]);
        if (!Number.isFinite(actual) || !numberWithinTolerance(actual, expected, check.tolerance)) {
            return {
                id: `createTextLayer.${check.key}`,
                label: `创建文字图层${check.label}`,
                status: 'failed',
                summary: `创建文字图层验收失败：图层 ${layer.id} 期望${check.label} ${roundForSummary(expected)}，实际 ${Number.isFinite(actual) ? roundForSummary(actual) : '未知'}。`,
                expected: `${check.key}=${roundForSummary(expected)}`,
                actual: Number.isFinite(actual) ? `${check.key}=${roundForSummary(actual)}` : `${check.key} unavailable`,
                scope: target.scope,
                affectedLayerIds: [layer.id]
            };
        }
    }

    const nameCheck = buildCreatedLayerNameCheck('createTextLayer.name', '创建文字图层命名', params, result, layer, target.scope);
    if (nameCheck) return nameCheck;

    return {
        id: 'createTextLayer.layer',
        label: '创建文字图层',
        status: 'passed',
        summary: `创建文字图层验收通过：检测到新增文字图层 ${layer.id}「${layer.name || '未命名'}」，内容匹配。`,
        expected: expectedContent ? truncateForAssertion(expectedContent) : '新增文字图层',
        actual: truncateForAssertion(normalizeTextContentForCompare(layer.text?.content)),
        scope: target.scope,
        affectedLayerIds: [layer.id],
        warnings: ['this assertion verifies layer type, content, optional fontSize, tracking, and leading only; it does not verify text color, paragraph alignment, or visual typography quality']
    };
}

function buildCreateShapeLayerAssertion(
    toolName: string,
    params: any,
    result: any,
    before: AcceptanceSnapshot,
    after: AcceptanceSnapshot
): ToolAcceptanceAssertion {
    const isEllipse = toolName === 'createEllipse';
    const label = isEllipse ? '创建椭圆图层' : '创建矩形图层';
    const target = resolveCreatedLayer(result, before, after, isEllipse ? '椭圆图层' : '矩形图层');
    if (target.status !== 'passed') {
        return {
            id: `${toolName}.layer`,
            label,
            status: target.status,
            summary: `${label}验收${target.status === 'failed' ? '失败' : '需复核'}：${target.reason}`,
            expected: '执行后出现一个可定位的新增形状图层',
            actual: target.reason,
            scope: target.scope,
            affectedLayerIds: target.layerId ? [target.layerId] : undefined,
            warnings: target.warnings
        };
    }

    const layer = target.afterLayer;
    if (!isShapeAcceptanceLayer(layer)) {
        return {
            id: `${toolName}.kind`,
            label: `${label}类型`,
            status: 'failed',
            summary: `${label}验收失败：新增图层 ${layer.id} 不是形状图层，kind=${layer.kind || 'unknown'}。`,
            expected: 'kind=shape/solidColor',
            actual: `kind=${layer.kind || 'unknown'}`,
            scope: target.scope,
            affectedLayerIds: [layer.id],
            warnings: ['created layer is not recognized as a shape layer in acceptance snapshot']
        };
    }

    const expectedShapeType = isEllipse ? 'ellipse' : 'rectangle';
    const actualShapeType = String(result?.shapeType || '').trim();
    if (actualShapeType && actualShapeType !== expectedShapeType) {
        return {
            id: `${toolName}.shapeType`,
            label: `${label}类型`,
            status: 'failed',
            summary: `${label}验收失败：工具结果 shapeType=${actualShapeType}，期望 ${expectedShapeType}。`,
            expected: expectedShapeType,
            actual: actualShapeType,
            scope: target.scope,
            affectedLayerIds: [layer.id]
        };
    }

    const expectedBounds = buildExpectedShapeBounds(toolName, params);
    const actualBounds = getLayerBoundsForAssertion(layer);
    if (!expectedBounds) {
        return {
            id: `${toolName}.bounds`,
            label: `${label}bounds`,
            status: 'needs_review',
            summary: `${label}验收需复核：参数缺少可验证的 x/y/width/height。`,
            expected: 'valid x/y/width/height',
            actual: 'shape bounds expectation unavailable',
            scope: target.scope,
            affectedLayerIds: [layer.id],
            warnings: ['shape params are not sufficient to build expected bounds']
        };
    }
    if (!actualBounds) {
        return {
            id: `${toolName}.bounds`,
            label: `${label}bounds`,
            status: 'needs_review',
            summary: `${label}验收需复核：新增图层 ${layer.id} 缺少 bounds。`,
            expected: formatBoundsForSummary(expectedBounds),
            actual: 'bounds unavailable',
            scope: target.scope,
            affectedLayerIds: [layer.id],
            warnings: ['created shape layer bounds unavailable in acceptance snapshot']
        };
    }

    const deviation = calculateBoundsDeviation(expectedBounds, actualBounds);
    if (deviation.maxAbs > 2) {
        return {
            id: `${toolName}.bounds`,
            label: `${label}bounds`,
            status: 'failed',
            summary: `${label}验收失败：图层 ${layer.id} bounds 最大偏差 ${roundForSummary(deviation.maxAbs)}px。`,
            expected: formatBoundsForSummary(expectedBounds),
            actual: formatBoundsForSummary(actualBounds),
            scope: target.scope,
            affectedLayerIds: [layer.id]
        };
    }

    const nameCheck = buildCreatedLayerNameCheck(`${toolName}.name`, `${label}命名`, params, result, layer, target.scope);
    if (nameCheck) return nameCheck;

    return {
        id: `${toolName}.layer`,
        label,
        status: 'passed',
        summary: `${label}验收通过：检测到新增形状图层 ${layer.id}「${layer.name || '未命名'}」，bounds 匹配。`,
        expected: formatBoundsForSummary(expectedBounds),
        actual: formatBoundsForSummary(actualBounds),
        scope: target.scope,
        affectedLayerIds: [layer.id],
        warnings: ['this assertion verifies shape layer type and bounds only; it does not verify fill color, corner radius, path fidelity, or visual rendering']
    };
}

function buildReplaceLayerContentAssertion(
    params: any,
    result: any,
    before: AcceptanceSnapshot,
    after: AcceptanceSnapshot
): ToolAcceptanceAssertion {
    const originalLayerId = collectOriginalLayerId(params, result);
    const replacementLayerId = collectReplacementLayerId(result);
    const beforeLayerById = new Map(getSnapshotLayers(before).map((layer) => [layer.id, layer]));
    const afterLayerById = new Map(getSnapshotLayers(after).map((layer) => [layer.id, layer]));

    if (!replacementLayerId) {
        return {
            id: 'replaceLayerContent.layer',
            label: '替换图层内容',
            status: 'needs_review',
            summary: '替换图层内容验收需复核：工具结果没有返回 newLayerId，无法确定替换后的图层。',
            expected: '工具结果返回 data.newLayerId',
            actual: 'newLayerId missing',
            scope: originalLayerId ? `original layer id: ${originalLayerId}` : 'unknown replacement layer',
            affectedLayerIds: originalLayerId ? [originalLayerId] : undefined,
            warnings: ['replaceLayerContent result did not include data.newLayerId']
        };
    }

    const replacementLayer = afterLayerById.get(replacementLayerId);
    if (!replacementLayer) {
        return {
            id: 'replaceLayerContent.layer',
            label: '替换图层内容',
            status: 'failed',
            summary: `替换图层内容验收失败：工具返回 newLayerId=${replacementLayerId}，但 after 快照未找到该图层。`,
            expected: `after 快照存在新图层 ${replacementLayerId}`,
            actual: '替换图层缺失',
            scope: `replacement layer id: ${replacementLayerId}`,
            affectedLayerIds: [replacementLayerId],
            warnings: ['replacement layer missing from after snapshot']
        };
    }
    if (beforeLayerById.has(replacementLayerId)) {
        return {
            id: 'replaceLayerContent.layer',
            label: '替换图层内容',
            status: 'failed',
            summary: `替换图层内容验收失败：newLayerId=${replacementLayerId} 执行前已存在，不符合新建替换图层预期。`,
            expected: `newLayerId=${replacementLayerId} 是执行后新增图层`,
            actual: 'newLayerId existed before execution',
            scope: `replacement layer id: ${replacementLayerId}`,
            affectedLayerIds: [replacementLayerId],
            warnings: ['replacement layer id existed before replaceLayerContent']
        };
    }

    const originalLayerCheck = buildOriginalLayerHiddenCheck(originalLayerId, beforeLayerById, afterLayerById, replacementLayerId);
    if (originalLayerCheck) return originalLayerCheck;

    const expectedBounds = normalizeReplaceLayerContentBounds(params?.bounds);
    const actualBounds = getLayerBoundsForAssertion(replacementLayer);
    if (expectedBounds) {
        if (!actualBounds) {
            return {
                id: 'replaceLayerContent.bounds',
                label: '替换图层内容 bounds',
                status: 'needs_review',
                summary: `替换图层内容验收需复核：替换图层 ${replacementLayerId} 缺少 bounds，无法验证目标区域。`,
                expected: formatBoundsForSummary(expectedBounds),
                actual: 'bounds unavailable',
                scope: `replacement layer id: ${replacementLayerId}`,
                affectedLayerIds: [replacementLayerId],
                warnings: ['replacement layer bounds unavailable in acceptance snapshot']
            };
        }
        const deviation = calculateBoundsDeviation(expectedBounds, actualBounds);
        if (deviation.maxAbs > 8) {
            return {
                id: 'replaceLayerContent.bounds',
                label: '替换图层内容 bounds',
                status: 'failed',
                summary: `替换图层内容验收失败：替换图层 ${replacementLayerId} bounds 最大偏差 ${roundForSummary(deviation.maxAbs)}px。`,
                expected: formatBoundsForSummary(expectedBounds),
                actual: formatBoundsForSummary(actualBounds),
                scope: `replacement layer id: ${replacementLayerId}`,
                affectedLayerIds: [replacementLayerId]
            };
        }
        if (deviation.maxAbs > 2) {
            return {
                id: 'replaceLayerContent.bounds',
                label: '替换图层内容 bounds',
                status: 'needs_review',
                summary: `替换图层内容验收需复核：替换图层 ${replacementLayerId} bounds 最大偏差 ${roundForSummary(deviation.maxAbs)}px。`,
                expected: formatBoundsForSummary(expectedBounds),
                actual: formatBoundsForSummary(actualBounds),
                scope: `replacement layer id: ${replacementLayerId}`,
                affectedLayerIds: [replacementLayerId],
                warnings: ['replacement bounds deviate from requested bounds but remain within review threshold']
            };
        }
    }

    return {
        id: 'replaceLayerContent.layer',
        label: '替换图层内容',
        status: 'passed',
        summary: `替换图层内容验收通过：检测到新增替换图层 ${replacementLayerId}，原图层${originalLayerId ? ` ${originalLayerId}` : ''} 已保留为隐藏状态。`,
        expected: expectedBounds ? formatBoundsForSummary(expectedBounds) : '新增替换图层且原图层隐藏',
        actual: actualBounds ? formatBoundsForSummary(actualBounds) : `replacementLayerId=${replacementLayerId}`,
        scope: `replacement layer id: ${replacementLayerId}`,
        affectedLayerIds: originalLayerId ? [originalLayerId, replacementLayerId] : [replacementLayerId],
        warnings: ['this assertion verifies replacement layer structure and optional bounds only; it does not verify image pixels or warp quality']
    };
}

function buildOriginalLayerHiddenCheck(
    originalLayerId: number | undefined,
    beforeLayerById: Map<number, AcceptanceLayer>,
    afterLayerById: Map<number, AcceptanceLayer>,
    replacementLayerId: number
): ToolAcceptanceAssertion | null {
    if (!originalLayerId) {
        return {
            id: 'replaceLayerContent.original',
            label: '替换图层原图层',
            status: 'needs_review',
            summary: `替换图层内容验收需复核：工具结果没有返回 originalLayerId，无法确认原图层是否保留隐藏。`,
            expected: '工具结果返回 data.originalLayerId',
            actual: 'originalLayerId missing',
            scope: `replacement layer id: ${replacementLayerId}`,
            affectedLayerIds: [replacementLayerId],
            warnings: ['replaceLayerContent result did not include originalLayerId']
        };
    }
    if (!beforeLayerById.has(originalLayerId)) {
        return {
            id: 'replaceLayerContent.original',
            label: '替换图层原图层',
            status: 'failed',
            summary: `替换图层内容验收失败：执行前未找到原图层 ${originalLayerId}。`,
            expected: `执行前存在原图层 ${originalLayerId}`,
            actual: '原图层缺失',
            scope: `original layer id: ${originalLayerId}`,
            affectedLayerIds: [originalLayerId, replacementLayerId],
            warnings: ['original layer missing from before snapshot']
        };
    }
    const afterOriginalLayer = afterLayerById.get(originalLayerId);
    if (!afterOriginalLayer) {
        return {
            id: 'replaceLayerContent.original',
            label: '替换图层原图层',
            status: 'failed',
            summary: `替换图层内容验收失败：执行后未找到原图层 ${originalLayerId}，无法证明它被保留隐藏。`,
            expected: `原图层 ${originalLayerId} 保留且隐藏`,
            actual: '原图层执行后缺失',
            scope: `original layer id: ${originalLayerId}`,
            affectedLayerIds: [originalLayerId, replacementLayerId],
            warnings: ['original layer missing from after snapshot']
        };
    }
    if (afterOriginalLayer.visible !== false) {
        return {
            id: 'replaceLayerContent.original',
            label: '替换图层原图层',
            status: 'failed',
            summary: `替换图层内容验收失败：原图层 ${originalLayerId} 执行后仍可见。`,
            expected: `原图层 ${originalLayerId} visible=false`,
            actual: `visible=${afterOriginalLayer.visible}`,
            scope: `original layer id: ${originalLayerId}`,
            affectedLayerIds: [originalLayerId, replacementLayerId],
            warnings: ['original layer should be hidden after replaceLayerContent']
        };
    }
    return null;
}

function buildReplaceImagePlaceholderAssertion(
    params: any,
    result: any,
    before: AcceptanceSnapshot,
    after: AcceptanceSnapshot
): ToolAcceptanceAssertion {
    const target = resolvePlacedImageLayer(result, before, after);
    if (target.status !== 'passed') {
        return {
            id: 'replaceImagePlaceholder.layer',
            label: '替换图片占位符',
            status: target.status,
            summary: `图片占位符替换验收${target.status === 'failed' ? '失败' : '需复核'}：${target.reason}`,
            expected: '执行后出现替换后的新图片图层',
            actual: target.reason,
            scope: target.scope,
            affectedLayerIds: target.layerId ? [target.layerId] : undefined,
            warnings: target.warnings
        };
    }

    const layer = target.afterLayer;
    const targetLayerCheck = buildReplacementTargetLayerCheck(params, result, before, after, layer.id);
    if (targetLayerCheck) return targetLayerCheck;

    const audit = getPlacementAudit(result);
    const bounds = getLayerBoundsForAssertion(layer);
    if (!audit) {
        const status: ToolAcceptanceAssertionStatus = hasPlacementExpectation(params) ? 'needs_review' : 'passed';
        return {
            id: 'replaceImagePlaceholder.layer',
            label: '替换图片占位符',
            status,
            summary: status === 'passed'
                ? `图片占位符替换验收通过：检测到替换后的新增图层 ${layer.id}「${layer.name || '未命名'}」。`
                : `图片占位符替换验收需复核：检测到替换后的新增图层 ${layer.id}，但缺少 placementAudit，无法验证落位。`,
            expected: hasPlacementExpectation(params) ? '存在 placementAudit 并匹配目标 bounds' : '替换后的新增图片图层',
            actual: bounds ? formatBoundsForSummary(bounds) : `layerId=${layer.id}`,
            scope: target.scope,
            affectedLayerIds: [layer.id],
            warnings: [
                'placementAudit missing from replaceImagePlaceholder result',
                'this assertion verifies layer replacement only; it does not verify image content or aesthetic placement'
            ]
        };
    }

    const plannedBounds = normalizeAuditBounds(audit.plannedBounds);
    const placementStatus = String(audit.status || 'unverified');
    const deviation = plannedBounds && bounds ? calculateBoundsDeviation(plannedBounds, bounds) : undefined;
    const status = resolvePlacementAssertionStatus(placementStatus, statusFromBoundsDeviation(deviation));

    const expected = plannedBounds ? formatBoundsForSummary(plannedBounds) : `placementAudit.status=${placementStatus}`;
    const actual = bounds ? formatBoundsForSummary(bounds) : 'bounds unavailable';
    const deviationText = deviation ? `，最大偏差 ${roundForSummary(deviation.maxAbs)}px` : '';
    const statusLabel = formatAssertionStatusLabel(status);

    return {
        id: 'replaceImagePlaceholder.placement',
        label: '替换图片占位符落位',
        status,
        summary: `图片占位符替换验收${statusLabel}：图层 ${layer.id} placementAudit=${placementStatus}${deviationText}。`,
        expected,
        actual,
        scope: target.scope,
        affectedLayerIds: [layer.id],
        warnings: [
            ...(Array.isArray(audit.notes) ? audit.notes : []),
            'this assertion verifies replacement layer bounds only; it does not verify image content, crop quality, or design aesthetics'
        ]
    };
}

function buildPlaceImageAssertion(
    params: any,
    result: any,
    before: AcceptanceSnapshot,
    after: AcceptanceSnapshot
): ToolAcceptanceAssertion {
    const target = resolvePlacedImageLayer(result, before, after);
    if (target.status !== 'passed') {
        return {
            id: 'placeImage.layer',
            label: '置入图片',
            status: target.status,
            summary: `置入图片验收${target.status === 'failed' ? '失败' : '需复核'}：${target.reason}`,
            expected: '执行后出现一个可定位的新增图片图层',
            actual: target.reason,
            scope: target.scope,
            affectedLayerIds: target.layerId ? [target.layerId] : undefined,
            warnings: target.warnings
        };
    }

    const layer = target.afterLayer;
    const bounds = getLayerBoundsForAssertion(layer);
    const nameAssertion = buildPlacedImageNameCheck(params, layer, target.scope);
    if (nameAssertion) return nameAssertion;

    if (hasAbsolutePositionParam(params)) {
        if (!bounds) {
            return {
                id: 'placeImage.position',
                label: '置入图片位置',
                status: 'needs_review',
                summary: `置入图片验收需复核：新增图层 ${layer.id} 缺少 bounds，无法验证 x/y。`,
                expected: formatAbsolutePositionExpected(params),
                actual: 'bounds unavailable',
                scope: target.scope,
                affectedLayerIds: [layer.id],
                warnings: ['placed image layer bounds unavailable in acceptance snapshot']
            };
        }

        const expectedLeft = Object.prototype.hasOwnProperty.call(params || {}, 'x') ? Number(params.x) : bounds.left;
        const expectedTop = Object.prototype.hasOwnProperty.call(params || {}, 'y') ? Number(params.y) : bounds.top;
        const leftMatches = numberWithinTolerance(bounds.left, expectedLeft, 1);
        const topMatches = numberWithinTolerance(bounds.top, expectedTop, 1);
        const expected = `left=${roundForSummary(expectedLeft)}, top=${roundForSummary(expectedTop)}`;
        const actual = `left=${roundForSummary(bounds.left)}, top=${roundForSummary(bounds.top)}`;

        if (!leftMatches || !topMatches) {
            return {
                id: 'placeImage.position',
                label: '置入图片位置',
                status: 'failed',
                summary: `置入图片验收失败：新增图层 ${layer.id} 期望 ${expected}，实际 ${actual}。`,
                expected,
                actual,
                scope: target.scope,
                affectedLayerIds: [layer.id]
            };
        }
    }

    return {
        id: 'placeImage.layer',
        label: '置入图片',
        status: 'passed',
        summary: `置入图片验收通过：检测到新增图层 ${layer.id}「${layer.name || '未命名'}」。`,
        expected: hasAbsolutePositionParam(params) ? formatAbsolutePositionExpected(params) : '新增图片图层',
        actual: bounds ? formatBoundsForSummary(bounds) : `layerId=${layer.id}`,
        scope: target.scope,
        affectedLayerIds: [layer.id],
        warnings: ['this assertion verifies layer creation and optional bounds only; it does not verify image content or aesthetic placement']
    };
}

function buildReplacementTargetLayerCheck(
    params: any,
    result: any,
    before: AcceptanceSnapshot,
    after: AcceptanceSnapshot,
    replacementLayerId: number
): ToolAcceptanceAssertion | null {
    const targetLayerId = collectReplacementTargetLayerId(params, result);
    if (!targetLayerId || targetLayerId === replacementLayerId) return null;

    const beforeLayerById = new Map(getSnapshotLayers(before).map((layer) => [layer.id, layer]));
    const afterLayerById = new Map(getSnapshotLayers(after).map((layer) => [layer.id, layer]));
    if (!beforeLayerById.has(targetLayerId)) {
        return {
            id: 'replaceImagePlaceholder.target',
            label: '图片占位符目标',
            status: before.summary?.truncated ? 'needs_review' : 'failed',
            summary: `图片占位符替换验收${before.summary?.truncated ? '需复核' : '失败'}：执行前快照未找到目标占位图层 ${targetLayerId}。`,
            expected: `执行前存在目标占位图层 ${targetLayerId}`,
            actual: '目标占位图层缺失',
            scope: `target layer id: ${targetLayerId}`,
            affectedLayerIds: [targetLayerId, replacementLayerId],
            warnings: before.summary?.truncated
                ? ['before snapshot was truncated; target layer may be outside captured range']
                : ['target placeholder layer missing from before snapshot']
        };
    }
    const targetStillExists = afterLayerById.has(targetLayerId);
    if (targetStillExists) {
        return {
            id: 'replaceImagePlaceholder.target',
            label: '图片占位符目标',
            status: 'failed',
            summary: `图片占位符替换验收失败：目标占位图层 ${targetLayerId} 执行后仍存在，替换图层为 ${replacementLayerId}。`,
            expected: `目标占位图层 ${targetLayerId} 被替换为新图层 ${replacementLayerId}`,
            actual: `目标占位图层 ${targetLayerId} 仍存在`,
            scope: `target layer id: ${targetLayerId}`,
            affectedLayerIds: [targetLayerId, replacementLayerId],
            warnings: ['target placeholder layer still exists after replacement']
        };
    }
    return null;
}

type PlacedImageLayerTarget =
    | {
        status: 'passed';
        afterLayer: AcceptanceLayer;
        scope: string;
        warnings: string[];
    }
    | {
        status: 'failed' | 'needs_review';
        layerId?: number;
        scope: string;
        reason: string;
        warnings: string[];
    };

type CreatedLayerTarget =
    | {
        status: 'passed';
        afterLayer: AcceptanceLayer;
        scope: string;
        warnings: string[];
    }
    | {
        status: 'failed' | 'needs_review';
        layerId?: number;
        scope: string;
        reason: string;
        warnings: string[];
    };

function resolveCreatedLayer(
    result: any,
    before: AcceptanceSnapshot,
    after: AcceptanceSnapshot,
    entityLabel: string
): CreatedLayerTarget {
    const beforeLayers = getSnapshotLayers(before);
    const afterLayers = getSnapshotLayers(after);
    const beforeLayerById = new Map(beforeLayers.map((layer) => [layer.id, layer]));
    const afterLayerById = new Map(afterLayers.map((layer) => [layer.id, layer]));
    const resultLayerIds = collectCreatedLayerIds(result);

    if (resultLayerIds.length > 0) {
        if (resultLayerIds.length > 1) {
            return {
                status: 'needs_review',
                scope: `result layer ids: ${resultLayerIds.join(',')}`,
                reason: `工具结果包含多个 layerId：${resultLayerIds.join(',')}，无法确定新增${entityLabel}。`,
                warnings: ['multiple result layer ids found']
            };
        }
        const layerId = resultLayerIds[0];
        const afterLayer = afterLayerById.get(layerId);
        if (!afterLayer) {
            return {
                status: 'failed',
                layerId,
                scope: `result layer id: ${layerId}`,
                reason: `工具返回 layerId=${layerId}，但执行后快照未找到该图层。`,
                warnings: ['result layer id missing from after snapshot']
            };
        }
        if (beforeLayerById.has(layerId)) {
            return {
                status: 'failed',
                layerId,
                scope: `result layer id: ${layerId}`,
                reason: `工具返回 layerId=${layerId}，但该图层执行前已存在，不符合新增${entityLabel}预期。`,
                warnings: ['result layer id already existed before create tool execution']
            };
        }
        return {
            status: 'passed',
            afterLayer,
            scope: `result layer id: ${layerId}`,
            warnings: []
        };
    }

    const addedLayers = afterLayers.filter((layer) => !beforeLayerById.has(layer.id));
    if (addedLayers.length === 1) {
        return {
            status: 'passed',
            afterLayer: addedLayers[0],
            scope: `single added layer: ${addedLayers[0].id}`,
            warnings: [`created ${entityLabel} inferred from one added layer because result layerId was missing`]
        };
    }
    if (addedLayers.length === 0) {
        return {
            status: 'failed',
            scope: 'added layer diff',
            reason: `执行后快照未检测到新增${entityLabel}。`,
            warnings: ['no added layer detected for create tool execution']
        };
    }
    return {
        status: 'needs_review',
        scope: `added layers: ${addedLayers.map((layer) => layer.id).join(',')}`,
        reason: `执行后检测到 ${addedLayers.length} 个新增图层，但工具结果没有明确 layerId。`,
        warnings: ['multiple added layers require live Photoshop verification']
    };
}

function resolvePlacedImageLayer(
    result: any,
    before: AcceptanceSnapshot,
    after: AcceptanceSnapshot
): PlacedImageLayerTarget {
    const beforeLayers = getSnapshotLayers(before);
    const afterLayers = getSnapshotLayers(after);
    const beforeLayerById = new Map(beforeLayers.map((layer) => [layer.id, layer]));
    const afterLayerById = new Map(afterLayers.map((layer) => [layer.id, layer]));
    const resultLayerIds = collectResultLayerIds(result);

    if (resultLayerIds.length > 0) {
        if (resultLayerIds.length > 1) {
            return {
                status: 'needs_review',
                scope: `result layer ids: ${resultLayerIds.join(',')}`,
                reason: `工具结果包含多个 layerId：${resultLayerIds.join(',')}，无法确定置入图层。`,
                warnings: ['multiple result layer ids found']
            };
        }
        const layerId = resultLayerIds[0];
        const afterLayer = afterLayerById.get(layerId);
        if (!afterLayer) {
            return {
                status: 'failed',
                layerId,
                scope: `result layer id: ${layerId}`,
                reason: `工具返回 layerId=${layerId}，但执行后快照未找到该图层。`,
                warnings: ['result layer id missing from after snapshot']
            };
        }
        if (beforeLayerById.has(layerId)) {
            return {
                status: 'failed',
                layerId,
                scope: `result layer id: ${layerId}`,
                reason: `工具返回 layerId=${layerId}，但该图层执行前已存在，不符合 placeImage 新增图层预期。`,
                warnings: ['result layer id already existed before placeImage']
            };
        }
        return {
            status: 'passed',
            afterLayer,
            scope: `result layer id: ${layerId}`,
            warnings: []
        };
    }

    const addedLayers = afterLayers.filter((layer) => !beforeLayerById.has(layer.id));
    if (addedLayers.length === 1) {
        return {
            status: 'passed',
            afterLayer: addedLayers[0],
            scope: `single added layer: ${addedLayers[0].id}`,
            warnings: ['placed image layer inferred from one added layer because result layerId was missing']
        };
    }
    if (addedLayers.length === 0) {
        return {
            status: 'failed',
            scope: 'added layer diff',
            reason: '执行后快照未检测到新增图层。',
            warnings: ['no added layer detected for placeImage']
        };
    }
    return {
        status: 'needs_review',
        scope: `added layers: ${addedLayers.map((layer) => layer.id).join(',')}`,
        reason: `执行后检测到 ${addedLayers.length} 个新增图层，但工具结果没有明确 layerId。`,
        warnings: ['multiple added layers require live Photoshop verification']
    };
}

function buildFillDetailCountCheck(plans: any[], fillResults: any[]): ToolAcceptanceAssertion | null {
    if (plans.length === 0) return null;
    const mismatches: string[] = [];
    for (let index = 0; index < Math.min(plans.length, fillResults.length); index++) {
        const plan = plans[index];
        const result = fillResults[index];
        const expectedCopies = Array.isArray(plan?.copies) ? plan.copies.length : 0;
        const expectedImages = countExpectedFillImages(plan);
        if (Number.isFinite(Number(result?.copiesFilled)) && Number(result.copiesFilled) !== expectedCopies) {
            mismatches.push(`${result?.screenName || plan?.screenName || index}: copies ${result.copiesFilled}/${expectedCopies}`);
        }
        if (Number.isFinite(Number(result?.imagesFilled)) && Number(result.imagesFilled) !== expectedImages) {
            mismatches.push(`${result?.screenName || plan?.screenName || index}: images ${result.imagesFilled}/${expectedImages}`);
        }
    }
    if (mismatches.length === 0) return null;
    return {
        id: 'fillDetailPage.counts',
        label: '详情页填充数量',
        status: 'failed',
        summary: `详情页填充验收失败：填充数量与计划不一致。${mismatches.slice(0, 3).join('；')}${mismatches.length > 3 ? `；另有 ${mismatches.length - 3} 项` : ''}`,
        expected: 'copiesFilled/imagesFilled 与计划数量一致',
        actual: mismatches.join('；'),
        scope: 'fill plans vs results'
    };
}

function evaluateFillPlacements(
    placements: any[],
    before: AcceptanceSnapshot,
    after: AcceptanceSnapshot
): { status: ToolAcceptanceAssertionStatus; summary: string; affectedLayerIds: number[]; warnings: string[] } {
    if (placements.length === 0) {
        return {
            status: 'passed',
            summary: '没有图片 placement 需要验证。',
            affectedLayerIds: [],
            warnings: []
        };
    }

    const beforeLayerById = new Map(getSnapshotLayers(before).map((layer) => [layer.id, layer]));
    const afterLayerById = new Map(getSnapshotLayers(after).map((layer) => [layer.id, layer]));
    const failures: string[] = [];
    const reviews: string[] = [];
    const warnings: string[] = [];
    const affectedLayerIds: number[] = [];

    for (const placement of placements) {
        const actualLayerId = Number(placement?.actualLayerId);
        const placeholderLayerId = Number(placement?.placeholderLayerId);
        if (Number.isFinite(actualLayerId) && actualLayerId > 0) affectedLayerIds.push(actualLayerId);
        if (Number.isFinite(placeholderLayerId) && placeholderLayerId > 0) affectedLayerIds.push(placeholderLayerId);

        if (!Number.isFinite(actualLayerId) || actualLayerId <= 0) {
            failures.push(`${placement?.placeholderLayerName || 'unknown'} 缺少 actualLayerId`);
            continue;
        }
        const afterLayer = afterLayerById.get(actualLayerId);
        if (!afterLayer) {
            failures.push(`actualLayerId=${actualLayerId} 在 after 快照中不存在`);
            continue;
        }
        if (beforeLayerById.has(actualLayerId)) {
            failures.push(`actualLayerId=${actualLayerId} 执行前已存在，不符合图片填充新增图层预期`);
        }

        const expectedBounds = normalizeAuditBounds(placement?.actualBounds);
        const afterBounds = getLayerBoundsForAssertion(afterLayer);
        if (!expectedBounds || !afterBounds) {
            reviews.push(`actualLayerId=${actualLayerId} 缺少可比较 bounds`);
        } else {
            const deviation = calculateBoundsDeviation(expectedBounds, afterBounds);
            if (deviation.maxAbs > 8) {
                failures.push(`actualLayerId=${actualLayerId} bounds 最大偏差 ${roundForSummary(deviation.maxAbs)}px`);
            } else if (deviation.maxAbs > 2) {
                reviews.push(`actualLayerId=${actualLayerId} bounds 最大偏差 ${roundForSummary(deviation.maxAbs)}px`);
            }
        }

        const auditStatus = String(placement?.placementAudit?.status || '').trim();
        if (auditStatus === 'mismatch') {
            failures.push(`actualLayerId=${actualLayerId} placementAudit=mismatch`);
        } else if (auditStatus === 'watch' || auditStatus === 'unverified') {
            reviews.push(`actualLayerId=${actualLayerId} placementAudit=${auditStatus}`);
        }
        if (Array.isArray(placement?.placementAudit?.notes)) {
            warnings.push(...placement.placementAudit.notes);
        }

        if (!placement?.isClipped && !placement?.baseLayerId && Number.isFinite(placeholderLayerId) && placeholderLayerId > 0) {
            const afterPlaceholder = afterLayerById.get(placeholderLayerId);
            if (afterPlaceholder?.visible === true) {
                failures.push(`placeholderLayerId=${placeholderLayerId} 执行后仍可见`);
            }
        }
    }

    if (failures.length > 0) {
        return {
            status: 'failed',
            summary: summarizeFillIssues(failures),
            affectedLayerIds: uniqueNumbers(affectedLayerIds),
            warnings
        };
    }
    if (reviews.length > 0) {
        return {
            status: 'needs_review',
            summary: summarizeFillIssues(reviews),
            affectedLayerIds: uniqueNumbers(affectedLayerIds),
            warnings
        };
    }
    return {
        status: 'passed',
        summary: `${placements.length} 个 placement 图层和 bounds 可验证。`,
        affectedLayerIds: uniqueNumbers(affectedLayerIds),
        warnings
    };
}

function buildFillAuditSummaryCheck(fillResults: any[], placements: any[]): ToolAcceptanceAssertion | null {
    const summaryMismatch = fillResults.find((item) => {
        const summary = item?.placementAuditSummary;
        if (!summary) return false;
        const resultPlacements = Array.isArray(item?.placements) ? item.placements : [];
        return Number(summary.total) !== resultPlacements.length;
    });
    if (!summaryMismatch) return null;
    return {
        id: 'fillDetailPage.auditSummary',
        label: '详情页落位审计汇总',
        status: 'needs_review',
        summary: `详情页填充验收需复核：placementAuditSummary.total 与 placements.length 不一致。screen=${summaryMismatch?.screenName || 'unknown'}`,
        expected: `placementAuditSummary.total=${placements.length}`,
        actual: `screen summary total=${summaryMismatch?.placementAuditSummary?.total}`,
        scope: summarizeFillScope(fillResults),
        warnings: ['placement audit summary does not match placement record count']
    };
}

function buildCreatedLayerNameCheck(
    id: string,
    label: string,
    params: any,
    result: any,
    layer: AcceptanceLayer,
    scope: string
): ToolAcceptanceAssertion | null {
    const expectedName = String(result?.layerName || result?.name || params?.name || '').trim();
    if (!expectedName) return null;
    const actualName = String(layer.name || '').trim();
    if (actualName === expectedName) return null;
    return {
        id,
        label,
        status: 'needs_review',
        summary: `${label}验收需复核：新增图层 ${layer.id} 期望命名为「${expectedName}」，实际为「${actualName || '未命名'}」。`,
        expected: expectedName,
        actual: actualName || '未命名',
        scope,
        affectedLayerIds: [layer.id],
        warnings: ['created layer name differs from requested/result name; Photoshop may normalize or suffix duplicate names']
    };
}

function buildExpectedShapeBounds(toolName: string, params: any): AcceptanceBounds | undefined {
    const x = Number(params?.x);
    const y = Number(params?.y);
    const width = Number(params?.width);
    const height = Number(params?.height);
    if (![x, y, width, height].every((value) => Number.isFinite(value)) || width <= 0 || height <= 0) {
        return undefined;
    }
    if (toolName === 'createEllipse') {
        const left = x - width / 2;
        const top = y - height / 2;
        return {
            left,
            top,
            right: left + width,
            bottom: top + height,
            width,
            height
        };
    }
    return {
        left: x,
        top: y,
        right: x + width,
        bottom: y + height,
        width,
        height
    };
}

function buildPlacedImageNameCheck(
    params: any,
    layer: AcceptanceLayer,
    scope: string
): ToolAcceptanceAssertion | null {
    const expectedName = typeof params?.name === 'string' ? params.name.trim() : '';
    if (!expectedName) return null;
    const actualName = String(layer.name || '').trim();
    if (actualName === expectedName) return null;
    return {
        id: 'placeImage.name',
        label: '置入图片命名',
        status: 'failed',
        summary: `置入图片验收失败：新增图层 ${layer.id} 期望命名为「${expectedName}」，实际为「${actualName || '未命名'}」。`,
        expected: expectedName,
        actual: actualName || '未命名',
        scope,
        affectedLayerIds: [layer.id]
    };
}

function buildMoveLayerAssertion(
    params: any,
    before: AcceptanceSnapshot,
    after: AcceptanceSnapshot
): ToolAcceptanceAssertion | null {
    if (!hasMoveLayerPositionParam(params)) return null;

    const target = resolveSingleLayerAssertionTarget(params, before, after);
    if (target.status !== 'passed') {
        const status = target.status;
        const prefix = status === 'failed' ? '移动图层验收失败' : '移动图层验收需复核';
        return {
            id: 'moveLayer.position',
            label: '移动图层',
            status,
            summary: `${prefix}：${target.reason}`,
            expected: formatMoveLayerExpectedParams(params),
            actual: target.reason,
            scope: target.scope,
            affectedLayerIds: status === 'failed' && target.layerId ? [target.layerId] : undefined,
            warnings: target.warnings
        };
    }

    const beforeLayer = target.beforeLayer;
    const afterLayer = target.afterLayer;
    const beforeBounds = beforeLayer.boundsNoEffects || beforeLayer.bounds;
    const afterBounds = afterLayer.boundsNoEffects || afterLayer.bounds;
    if (!beforeBounds || !afterBounds) {
        return {
            id: 'moveLayer.position',
            label: '移动图层',
            status: 'needs_review',
            summary: `移动图层验收需复核：目标图层 ${target.layerId} 缺少 before 或 after bounds。`,
            expected: formatMoveLayerExpectedParams(params),
            actual: 'bounds unavailable',
            scope: target.scope,
            affectedLayerIds: [target.layerId],
            warnings: ['target layer bounds unavailable in acceptance snapshot']
        };
    }

    const expectedLeft = params?.relative === true ? beforeBounds.left + Number(params.x ?? 0) : Number(params.x ?? beforeBounds.left);
    const expectedTop = params?.relative === true ? beforeBounds.top + Number(params.y ?? 0) : Number(params.y ?? beforeBounds.top);
    const leftMatches = numberWithinTolerance(afterBounds.left, expectedLeft, 1);
    const topMatches = numberWithinTolerance(afterBounds.top, expectedTop, 1);
    const expected = `left=${roundForSummary(expectedLeft)}, top=${roundForSummary(expectedTop)}`;
    const actual = `left=${roundForSummary(afterBounds.left)}, top=${roundForSummary(afterBounds.top)}`;

    if (leftMatches && topMatches) {
        return {
            id: 'moveLayer.position',
            label: '移动图层',
            status: 'passed',
            summary: `移动图层验收通过：图层 ${target.layerId} 已移动到 ${expected}。`,
            expected,
            actual,
            scope: target.scope,
            affectedLayerIds: [target.layerId]
        };
    }

    return {
        id: 'moveLayer.position',
        label: '移动图层',
        status: 'failed',
        summary: `移动图层验收失败：图层 ${target.layerId} 期望 ${expected}，实际 ${actual}。`,
        expected,
        actual,
        scope: target.scope,
        affectedLayerIds: [target.layerId]
    };
}

function buildCloseDocumentAssertion(
    params: any,
    result: any,
    before: AcceptanceSnapshot,
    after: AcceptanceSnapshot
): ToolAcceptanceAssertion {
    const beforeDoc = before.hasDocument === true ? before.document : undefined;
    if (!beforeDoc) {
        return {
            id: 'closeDocument.activeDocument',
            label: '关闭文档',
            status: 'needs_review',
            summary: '关闭文档验收需复核：执行前快照没有活动文档，无法判断关闭目标。',
            expected: '关闭目标文档',
            actual: '执行前无活动文档',
            scope: 'active document snapshot',
            warnings: ['before snapshot has no active document']
        };
    }

    const target = resolveCloseDocumentTarget(params, result, beforeDoc);
    if (!target.verifiable) {
        return {
            id: 'closeDocument.activeDocument',
            label: '关闭文档',
            status: 'needs_review',
            summary: `关闭文档验收需复核：${target.reason}`,
            expected: target.expected,
            actual: formatAcceptanceDocument(after),
            scope: 'active document snapshot',
            warnings: ['acceptance snapshot only verifies the active document; use listDocuments for non-active document close verification']
        };
    }

    const afterDoc = after.hasDocument === true ? after.document : undefined;
    const activeDocumentChanged = !afterDoc || !sameAcceptanceDocument(beforeDoc, afterDoc);
    const saveMode = params?.save === true ? '保存后关闭' : '不保存关闭';
    const expected = `${saveMode}：${formatAcceptanceDocument({ hasDocument: true, document: beforeDoc } as AcceptanceSnapshot)}`;

    if (activeDocumentChanged) {
        return {
            id: 'closeDocument.activeDocument',
            label: '关闭文档',
            status: 'passed',
            summary: `关闭文档验收通过：活动文档已从「${formatAcceptanceDocument({ hasDocument: true, document: beforeDoc } as AcceptanceSnapshot)}」切换为「${formatAcceptanceDocument(after)}」。`,
            expected,
            actual: formatAcceptanceDocument(after),
            scope: target.scope,
            warnings: ['acceptance snapshot verifies active document closure, not disk save state']
        };
    }

    return {
        id: 'closeDocument.activeDocument',
        label: '关闭文档',
        status: 'failed',
        summary: `关闭文档验收失败：工具返回后活动文档仍是「${formatAcceptanceDocument(after)}」。`,
        expected,
        actual: formatAcceptanceDocument(after),
        scope: target.scope,
        warnings: ['active document did not change after closeDocument']
    };
}

function resolveCloseDocumentTarget(
    params: any,
    result: any,
    beforeDoc: AcceptanceSnapshot['document']
): { verifiable: boolean; expected: string; scope: string; reason?: string } {
    const targetId = Number(params?.documentId);
    const hasTargetId = Number.isFinite(targetId) && targetId > 0;
    const targetName = typeof params?.documentName === 'string' ? params.documentName.trim() : '';
    const resultName = typeof result?.closedDocument === 'string' ? result.closedDocument.trim() : '';
    const beforeName = beforeDoc?.name || '';
    const beforeId = Number(beforeDoc?.id);

    if (hasTargetId && beforeId !== targetId && !documentNameMatches(beforeName, resultName)) {
        return {
            verifiable: false,
            expected: `关闭 documentId=${targetId}`,
            scope: 'non-active document target',
            reason: `目标 documentId=${targetId} 不是执行前活动文档，当前快照只能验证活动文档。`
        };
    }

    if (targetName && !documentNameMatches(beforeName, targetName) && !documentNameMatches(beforeName, resultName)) {
        return {
            verifiable: false,
            expected: `关闭 documentName=${targetName}`,
            scope: 'non-active document target',
            reason: `目标 documentName=${targetName} 不是执行前活动文档，当前快照只能验证活动文档。`
        };
    }

    return {
        verifiable: true,
        expected: formatActiveCloseDocumentExpectation(hasTargetId, targetId, targetName),
        scope: 'active document snapshot'
    };
}

function formatActiveCloseDocumentExpectation(hasTargetId: boolean, targetId: number, targetName: string): string {
    if (hasTargetId) return `关闭活动文档 documentId=${targetId}`;
    if (targetName) return `关闭活动文档 documentName=${targetName}`;
    return '关闭当前活动文档';
}

type SingleLayerAssertionTarget =
    | {
        status: 'passed';
        layerId: number;
        beforeLayer: AcceptanceLayer;
        afterLayer: AcceptanceLayer;
        scope: string;
        warnings: string[];
    }
    | {
        status: 'failed' | 'needs_review';
        layerId?: number;
        scope: string;
        reason: string;
        warnings: string[];
    };

function resolveSingleLayerAssertionTarget(
    params: any,
    before: AcceptanceSnapshot,
    after: AcceptanceSnapshot
): SingleLayerAssertionTarget {
    const beforeLayers = Array.isArray(before.layers) ? before.layers : [];
    const afterLayers = Array.isArray(after.layers) ? after.layers : [];
    const beforeLayerById = new Map(beforeLayers.map((layer) => [layer.id, layer]));
    const afterLayerById = new Map(afterLayers.map((layer) => [layer.id, layer]));
    const targetIds = collectTargetLayerIds(params);

    let layerId: number | undefined;
    let scope = '';
    if (targetIds.length > 1) {
        return {
            status: 'needs_review',
            scope: `explicit layer ids: ${targetIds.join(',')}`,
            reason: `moveLayer 只验证单个目标图层，但参数包含多个目标：${targetIds.join(',')}。`,
            warnings: ['multiple target layer ids are not verifiable for a single-layer move assertion']
        };
    }
    if (targetIds.length === 1) {
        layerId = targetIds[0];
        scope = `explicit layer id: ${layerId}`;
    } else {
        const selectedLayerIds = Array.isArray(before.selectedLayerIds) ? before.selectedLayerIds : [];
        if (selectedLayerIds.length === 1) {
            layerId = selectedLayerIds[0];
            scope = `single selected layer: ${layerId}`;
        } else if (selectedLayerIds.length > 1) {
            return {
                status: 'needs_review',
                scope: `selected layers: ${selectedLayerIds.join(',')}`,
                reason: `执行前有 ${selectedLayerIds.length} 个选中图层，快照无法判断 UXP activeLayers[0] 实际移动的是哪一个。`,
                warnings: ['multiple selected layers require live Photoshop verification']
            };
        } else {
            return {
                status: 'needs_review',
                scope: 'implicit active layer',
                reason: '参数没有 layerId，执行前快照也没有唯一选中图层，无法确定移动目标。',
                warnings: ['no explicit or uniquely selected target layer']
            };
        }
    }

    const beforeLayer = beforeLayerById.get(layerId);
    const afterLayer = afterLayerById.get(layerId);
    if (!beforeLayer) {
        return {
            status: 'failed',
            layerId,
            scope,
            reason: `执行前未找到目标图层 ${layerId}。`,
            warnings: ['target layer missing from before snapshot']
        };
    }
    if (!afterLayer) {
        return {
            status: 'failed',
            layerId,
            scope,
            reason: `执行后未找到目标图层 ${layerId}。`,
            warnings: ['target layer missing from after snapshot']
        };
    }
    return {
        status: 'passed',
        layerId,
        beforeLayer,
        afterLayer,
        scope,
        warnings: []
    };
}

function sameAcceptanceDocument(
    beforeDoc: AcceptanceSnapshot['document'],
    afterDoc: AcceptanceSnapshot['document']
): boolean {
    const beforeId = Number(beforeDoc?.id);
    const afterId = Number(afterDoc?.id);
    if (Number.isFinite(beforeId) && Number.isFinite(afterId)) {
        return beforeId === afterId;
    }
    return normalizeDocumentName(beforeDoc?.name || '') === normalizeDocumentName(afterDoc?.name || '');
}

function formatAcceptanceDocument(snapshot: AcceptanceSnapshot): string {
    if (snapshot.hasDocument !== true || !snapshot.document) return '无活动文档';
    const name = snapshot.document.name || '未命名文档';
    return snapshot.document.id ? `${name}#${snapshot.document.id}` : name;
}

function documentNameMatches(actualName: string, requestedName: string): boolean {
    const actual = normalizeDocumentName(actualName);
    const requested = normalizeDocumentName(requestedName);
    if (!actual || !requested) return false;
    return actual.includes(requested) || stripDocumentExtension(actual) === requested;
}

function normalizeDocumentName(name: string): string {
    return String(name || '').trim().toLowerCase();
}

function stripDocumentExtension(name: string): string {
    return name.replace(/\.[^.]+$/, '');
}

function hasMoveLayerPositionParam(params: any): boolean {
    return Object.prototype.hasOwnProperty.call(params || {}, 'x') || Object.prototype.hasOwnProperty.call(params || {}, 'y');
}

function hasAbsolutePositionParam(params: any): boolean {
    return Object.prototype.hasOwnProperty.call(params || {}, 'x') || Object.prototype.hasOwnProperty.call(params || {}, 'y');
}

function formatMoveLayerExpectedParams(params: any): string {
    const mode = params?.relative === true ? 'relative' : 'absolute';
    const x = Object.prototype.hasOwnProperty.call(params || {}, 'x') ? `x=${params.x}` : 'x=保持当前';
    const y = Object.prototype.hasOwnProperty.call(params || {}, 'y') ? `y=${params.y}` : 'y=保持当前';
    return `${mode} ${x}, ${y}`;
}

function formatAbsolutePositionExpected(params: any): string {
    const x = Object.prototype.hasOwnProperty.call(params || {}, 'x') ? `left=${roundForSummary(Number(params.x))}` : 'left=未指定';
    const y = Object.prototype.hasOwnProperty.call(params || {}, 'y') ? `top=${roundForSummary(Number(params.y))}` : 'top=未指定';
    return `${x}, ${y}`;
}

function buildSetTextContentAssertion(
    params: any,
    before: AcceptanceSnapshot,
    after: AcceptanceSnapshot
): ToolAcceptanceAssertion | null {
    const updates = collectTextContentUpdates(params);
    if (updates.length > 0) {
        return buildTextContentUpdatesAssertion(updates, after);
    }

    if (!hasTextContentParam(params)) return null;

    const expectedContent = normalizeTextContentForCompare(params.content);
    const target = resolveTextLayerAssertionScope(params, before, after);
    if (target.missingTargetIds.length > 0) {
        return {
            id: 'setTextContent.content',
            label: '文本内容修改',
            status: 'failed',
            summary: `文本内容验收失败：显式目标文本图层不存在或不是文本图层：${target.missingTargetIds.join(',')}。`,
            expected: truncateForAssertion(expectedContent),
            actual: '目标文本图层缺失',
            scope: target.scope,
            affectedLayerIds: uniqueNumbers([...target.layers.map((layer) => layer.id), ...target.missingTargetIds]),
            warnings: ['one or more explicit text target layers were not found']
        };
    }
    if (target.layers.length === 0) {
        return {
            id: 'setTextContent.content',
            label: '文本内容修改',
            status: 'needs_review',
            summary: `文本内容验收需复核：未找到可验证的目标文本图层，期望内容为「${truncateForAssertion(expectedContent)}」。`,
            expected: truncateForAssertion(expectedContent),
            scope: target.scope,
            warnings: ['no target text layers found in acceptance snapshot']
        };
    }

    const mismatched = target.layers.filter((layer) => !textContentMatches(layer.text?.content, expectedContent));
    const affectedLayerIds = target.layers.map((layer) => layer.id);
    const actualContents = uniqueStrings(target.layers.map((layer) => truncateForAssertion(normalizeTextContentForCompare(layer.text?.content))));

    if (mismatched.length === 0) {
        return {
            id: 'setTextContent.content',
            label: '文本内容修改',
            status: 'passed',
            summary: `文本内容验收通过：${target.layers.length} 个文本图层匹配目标内容「${truncateForAssertion(expectedContent)}」。`,
            expected: truncateForAssertion(expectedContent),
            actual: actualContents.join('、'),
            scope: target.scope,
            affectedLayerIds
        };
    }

    const status: ToolAcceptanceAssertionStatus = target.explicit ? 'failed' : 'needs_review';
    const prefix = status === 'failed' ? '文本内容验收失败' : '文本内容验收需复核';
    return {
        id: 'setTextContent.content',
        label: '文本内容修改',
        status,
        summary: `${prefix}：${mismatched.length}/${target.layers.length} 个目标文本图层未匹配「${truncateForAssertion(expectedContent)}」，实际内容：${actualContents.join('、')}。`,
        expected: truncateForAssertion(expectedContent),
        actual: actualContents.join('、'),
        scope: target.scope,
        affectedLayerIds,
        warnings: target.explicit ? [] : ['target text layer scope inferred from snapshot; explicit scope was not provided']
    };
}

function buildTextContentUpdatesAssertion(
    updates: { layerId: number; content: string }[],
    after: AcceptanceSnapshot
): ToolAcceptanceAssertion {
    const afterTextLayerById = new Map(getTextLayers(after).map((layer) => [layer.id, layer]));
    const mismatched: Array<{ layerId: number; expected: string; actual: string; missing: boolean }> = [];

    for (const update of updates) {
        const layer = afterTextLayerById.get(update.layerId);
        if (!layer) {
            mismatched.push({
                layerId: update.layerId,
                expected: update.content,
                actual: '未找到文本图层',
                missing: true
            });
            continue;
        }
        const actualContent = normalizeTextContentForCompare(layer.text?.content);
        if (!textContentMatches(actualContent, update.content)) {
            mismatched.push({
                layerId: update.layerId,
                expected: update.content,
                actual: actualContent,
                missing: false
            });
        }
    }

    const affectedLayerIds = updates.map((update) => update.layerId);
    if (mismatched.length === 0) {
        return {
            id: 'setTextContent.content',
            label: '文本内容修改',
            status: 'passed',
            summary: `文本内容验收通过：${updates.length} 个显式目标文本图层内容匹配。`,
            expected: summarizeTextUpdateExpectations(updates),
            actual: summarizeTextUpdateActuals(updates, afterTextLayerById),
            scope: `explicit text updates: ${affectedLayerIds.join(',')}`,
            affectedLayerIds
        };
    }

    return {
        id: 'setTextContent.content',
        label: '文本内容修改',
        status: 'failed',
        summary: `文本内容验收失败：${mismatched.length}/${updates.length} 个显式目标文本图层未匹配。${summarizeTextMismatches(mismatched)}`,
        expected: summarizeTextUpdateExpectations(updates),
        actual: summarizeTextMismatches(mismatched),
        scope: `explicit text updates: ${affectedLayerIds.join(',')}`,
        affectedLayerIds,
        warnings: mismatched.some((item) => item.missing) ? ['one or more explicit text target layers were not found'] : []
    };
}

function buildSetTextStyleFontAssertion(
    params: any,
    before: AcceptanceSnapshot,
    after: AcceptanceSnapshot
): ToolAcceptanceAssertion | null {
    const expectedFont = typeof params?.fontName === 'string' ? params.fontName.trim() : '';
    if (!expectedFont) return null;

    const target = resolveTextLayerAssertionScope(params, before, after);
    if (target.missingTargetIds.length > 0) {
        return {
            id: 'setTextStyle.fontName',
            label: '字体修改',
            status: 'failed',
            summary: `字体修改验收失败：显式目标文本图层不存在或不是文本图层：${target.missingTargetIds.join(',')}。`,
            expected: expectedFont,
            actual: '目标文本图层缺失',
            scope: target.scope,
            affectedLayerIds: uniqueNumbers([...target.layers.map((layer) => layer.id), ...target.missingTargetIds]),
            warnings: ['one or more explicit text target layers were not found']
        };
    }
    if (target.layers.length === 0) {
        return {
            id: 'setTextStyle.fontName',
            label: '字体修改',
            status: 'needs_review',
            summary: `字体修改验收需复核：未找到可验证的目标文本图层，期望字体为「${expectedFont}」。`,
            expected: expectedFont,
            scope: target.scope,
            warnings: ['no target text layers found in acceptance snapshot']
        };
    }

    const mismatched = target.layers.filter((layer) => !fontMatches(layer.text?.style?.fontName, expectedFont));
    const actualFonts = uniqueStrings(target.layers.map((layer) => layer.text?.style?.fontName || '未知字体'));
    const affectedLayerIds = target.layers.map((layer) => layer.id);

    if (mismatched.length === 0) {
        return {
            id: 'setTextStyle.fontName',
            label: '字体修改',
            status: 'passed',
            summary: `字体修改验收通过：${target.layers.length} 个文本图层匹配目标字体「${expectedFont}」。`,
            expected: expectedFont,
            actual: actualFonts.join('、'),
            scope: target.scope,
            affectedLayerIds
        };
    }

    const status: ToolAcceptanceAssertionStatus = target.explicit ? 'failed' : 'needs_review';
    const prefix = status === 'failed' ? '字体修改验收失败' : '字体修改验收需复核';
    return {
        id: 'setTextStyle.fontName',
        label: '字体修改',
        status,
        summary: `${prefix}：${mismatched.length}/${target.layers.length} 个目标文本图层未匹配「${expectedFont}」，实际字体：${actualFonts.join('、')}。`,
        expected: expectedFont,
        actual: actualFonts.join('、'),
        scope: target.scope,
        affectedLayerIds,
        warnings: target.explicit ? [] : ['target text layer scope inferred from snapshot; explicit scope was not provided']
    };
}

function buildSetTextStyleNumericAssertions(
    params: any,
    before: AcceptanceSnapshot,
    after: AcceptanceSnapshot
): ToolAcceptanceAssertion[] {
    const styleFields: Array<{
        key: 'fontSize' | 'tracking' | 'leading';
        label: string;
        unit: string;
        tolerance: number;
    }> = [
        { key: 'fontSize', label: '字号', unit: 'pt', tolerance: 0.5 },
        { key: 'tracking', label: '字距', unit: 'tracking', tolerance: 1 },
        { key: 'leading', label: '行距', unit: 'pt', tolerance: 0.5 }
    ];

    return styleFields.flatMap((field) => {
        const expected = Number(params?.[field.key]);
        if (!Number.isFinite(expected)) return [];
        return [buildSetTextStyleNumericAssertion(field, expected, params, before, after)];
    });
}

function buildSetTextStyleNumericAssertion(
    field: { key: 'fontSize' | 'tracking' | 'leading'; label: string; unit: string; tolerance: number },
    expected: number,
    params: any,
    before: AcceptanceSnapshot,
    after: AcceptanceSnapshot
): ToolAcceptanceAssertion {
    const target = resolveTextLayerAssertionScope(params, before, after);
    const id = `setTextStyle.${field.key}`;
    const expectedText = `${field.key}=${roundForSummary(expected)}${field.unit ? ` ${field.unit}` : ''}`;

    if (target.missingTargetIds.length > 0) {
        return {
            id,
            label: `文字${field.label}`,
            status: 'failed',
            summary: `文字${field.label}验收失败：显式目标文本图层不存在或不是文本图层：${target.missingTargetIds.join(',')}。`,
            expected: expectedText,
            actual: '目标文本图层缺失',
            scope: target.scope,
            affectedLayerIds: uniqueNumbers([...target.layers.map((layer) => layer.id), ...target.missingTargetIds]),
            warnings: ['one or more explicit text target layers were not found']
        };
    }

    if (target.layers.length === 0) {
        return {
            id,
            label: `文字${field.label}`,
            status: 'needs_review',
            summary: `文字${field.label}验收需复核：未找到可验证的目标文本图层，期望 ${expectedText}。`,
            expected: expectedText,
            scope: target.scope,
            warnings: ['no target text layers found in acceptance snapshot']
        };
    }

    const affectedLayerIds = target.layers.map((layer) => layer.id);
    const actualValues = target.layers.map((layer) => Number(layer.text?.style?.[field.key]));
    const unavailable = actualValues
        .map((value, index) => ({ value, layerId: target.layers[index].id }))
        .filter((entry) => !Number.isFinite(entry.value));
    if (unavailable.length > 0) {
        return {
            id,
            label: `文字${field.label}`,
            status: 'needs_review',
            summary: `文字${field.label}验收需复核：${unavailable.length}/${target.layers.length} 个目标文本图层缺少可读 ${field.key} 字段，无法证明样式已生效。`,
            expected: expectedText,
            actual: summarizeNumericActuals(field.key, target.layers),
            scope: target.scope,
            affectedLayerIds,
            warnings: [`${field.key} unavailable in acceptance snapshot`]
        };
    }

    const mismatched = actualValues
        .map((value, index) => ({ value, layerId: target.layers[index].id }))
        .filter((entry) => !numberWithinTolerance(entry.value, expected, field.tolerance));
    if (mismatched.length === 0) {
        return {
            id,
            label: `文字${field.label}`,
            status: 'passed',
            summary: `文字${field.label}验收通过：${target.layers.length} 个文本图层匹配 ${expectedText}。`,
            expected: expectedText,
            actual: summarizeNumericActuals(field.key, target.layers),
            scope: target.scope,
            affectedLayerIds
        };
    }

    const status: ToolAcceptanceAssertionStatus = target.explicit ? 'failed' : 'needs_review';
    const prefix = status === 'failed' ? `文字${field.label}验收失败` : `文字${field.label}验收需复核`;
    return {
        id,
        label: `文字${field.label}`,
        status,
        summary: `${prefix}：${mismatched.length}/${target.layers.length} 个目标文本图层未匹配 ${expectedText}。`,
        expected: expectedText,
        actual: summarizeNumericActuals(field.key, target.layers),
        scope: target.scope,
        affectedLayerIds,
        warnings: target.explicit ? [] : ['target text layer scope inferred from snapshot; explicit scope was not provided']
    };
}

function resolveTextLayerAssertionScope(
    params: any,
    before: AcceptanceSnapshot,
    after: AcceptanceSnapshot
): { layers: AcceptanceLayer[]; scope: string; explicit: boolean; missingTargetIds: number[] } {
    const afterTextLayers = getTextLayers(after);
    const targetIds = collectTargetLayerIds(params);
    if (targetIds.length > 0) {
        const layers = afterTextLayers.filter((layer) => targetIds.includes(layer.id));
        const foundIds = new Set(layers.map((layer) => layer.id));
        return {
            layers,
            scope: `explicit layer ids: ${targetIds.join(',')}`,
            explicit: true,
            missingTargetIds: targetIds.filter((id) => !foundIds.has(id))
        };
    }

    if (params?.applyToAll === true || params?.all === true || params?.allTextLayers === true || params?.scope === 'all') {
        return {
            layers: afterTextLayers,
            scope: 'all text layers',
            explicit: true,
            missingTargetIds: []
        };
    }

    const selectedLayerIds = Array.isArray(before.selectedLayerIds) ? before.selectedLayerIds : [];
    if (selectedLayerIds.length > 0) {
        return {
            layers: afterTextLayers.filter((layer) => selectedLayerIds.includes(layer.id)),
            scope: `selected text layers: ${selectedLayerIds.join(',')}`,
            explicit: true,
            missingTargetIds: []
        };
    }

    return {
        layers: afterTextLayers,
        scope: 'all text layers inferred because no explicit target was provided',
        explicit: false,
        missingTargetIds: []
    };
}

function getTextLayers(snapshot: AcceptanceSnapshot): AcceptanceLayer[] {
    return (Array.isArray(snapshot.layers) ? snapshot.layers : []).filter((layer) => layer.kind === 'text' || !!layer.text);
}

function getSnapshotLayers(snapshot: AcceptanceSnapshot): AcceptanceLayer[] {
    return Array.isArray(snapshot.layers) ? snapshot.layers : [];
}

function getLayerBoundsForAssertion(layer: AcceptanceLayer): AcceptanceBounds | undefined {
    return layer.boundsNoEffects || layer.bounds;
}

function isTextAcceptanceLayer(layer: AcceptanceLayer): boolean {
    return layer.kind === 'text' || !!layer.text;
}

function isShapeAcceptanceLayer(layer: AcceptanceLayer): boolean {
    const kind = String(layer.kind || '').toLowerCase();
    return kind.includes('shape') || kind.includes('solidcolor') || kind.includes('contentlayer');
}

function collectResultLayerIds(result: any): number[] {
    const values = [
        result?.layerId,
        result?.id,
        result?.data?.layerId,
        result?.data?.newLayerId,
        result?.data?.id,
        result?.result?.layerId,
        result?.result?.data?.layerId
    ];
    return uniqueNumbers(values.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0));
}

function collectCreatedLayerIds(result: any): number[] {
    const values = [
        result?.layerId,
        result?.data?.layerId,
        result?.result?.layerId,
        result?.result?.data?.layerId
    ];
    return uniqueNumbers(values.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0));
}

function collectReplacementTargetLayerId(params: any, result: any): number | undefined {
    const values = [
        result?.targetLayerId,
        result?.data?.targetLayerId,
        params?.placeholderLayerId,
        params?.targetLayerId
    ];
    const layerId = values.map((value) => Number(value)).find((value) => Number.isFinite(value) && value > 0);
    return layerId;
}

function collectOriginalLayerId(params: any, result: any): number | undefined {
    const values = [
        result?.data?.originalLayerId,
        result?.originalLayerId,
        params?.layerId
    ];
    return values.map((value) => Number(value)).find((value) => Number.isFinite(value) && value > 0);
}

function collectReplacementLayerId(result: any): number | undefined {
    const values = [
        result?.data?.newLayerId,
        result?.newLayerId,
        result?.data?.layerId,
        result?.layerId
    ];
    return values.map((value) => Number(value)).find((value) => Number.isFinite(value) && value > 0);
}

function collectFillDetailResults(result: any): any[] {
    const value = Array.isArray(result)
        ? result
        : Array.isArray(result?.data)
            ? result.data
            : Array.isArray(result?.results)
                ? result.results
                : Array.isArray(result?.data?.results)
                    ? result.data.results
                    : result?.data && typeof result.data === 'object'
                        ? [result.data]
                        : result && typeof result === 'object'
                            ? [result]
                            : [];
    return value.filter((item: any) => item && typeof item === 'object');
}

function collectFillDetailPlans(params: any): any[] {
    if (Array.isArray(params?.plans)) return params.plans.filter((item: any) => item && typeof item === 'object');
    if (params?.plan && typeof params.plan === 'object') return [params.plan];
    return [];
}

function countExpectedFillImages(plan: any): number {
    return (Array.isArray(plan?.images) ? plan.images : []).filter((item: any) => typeof item?.imagePath === 'string' && item.imagePath.trim()).length;
}

function summarizeFillErrors(results: any[]): string {
    return results
        .slice(0, 3)
        .map((item) => {
            const errors = Array.isArray(item?.errors) ? item.errors.join('；') : 'unknown error';
            return `${item?.screenName || item?.screenId || 'unknown'}: ${errors}`;
        })
        .join('；') + (results.length > 3 ? `；另有 ${results.length - 3} 项` : '');
}

function summarizeFillScope(results: any[]): string {
    return results
        .slice(0, 5)
        .map((item) => item?.screenName || item?.screenId || 'unknown')
        .join(',') + (results.length > 5 ? `...(+${results.length - 5})` : '');
}

function summarizeFillIssues(issues: string[]): string {
    return issues.slice(0, 4).join('；') + (issues.length > 4 ? `；另有 ${issues.length - 4} 项` : '');
}

function collectFillAffectedLayerIds(results: any[]): number[] {
    const ids = results.flatMap((item) => {
        const placements = Array.isArray(item?.placements) ? item.placements : [];
        return placements.flatMap((placement: any) => [
            Number(placement?.placeholderLayerId),
            Number(placement?.actualLayerId),
            Number(placement?.baseLayerId),
            Number(placement?.referenceLayerId)
        ]);
    });
    return uniqueNumbers(ids.filter((value) => Number.isFinite(value) && value > 0));
}

function normalizeReplaceLayerContentBounds(bounds: any): AcceptanceBounds | undefined {
    if (!bounds) return undefined;
    const left = Number(bounds.left);
    const top = Number(bounds.top);
    const width = Number(bounds.width);
    const height = Number(bounds.height);
    if (![left, top, width, height].every((value) => Number.isFinite(value))) {
        return undefined;
    }
    if (width <= 0 || height <= 0) {
        return undefined;
    }
    return {
        left,
        top,
        right: left + width,
        bottom: top + height,
        width,
        height
    };
}

function getPlacementAudit(result: any): any {
    return result?.placementAudit || result?.data?.placementAudit || result?.result?.placementAudit || result?.result?.data?.placementAudit;
}

function hasPlacementExpectation(params: any): boolean {
    return !!(params?.targetBounds || params?.placementTransform || params?.smartScalingDecision);
}

function normalizeAuditBounds(bounds: any): AcceptanceBounds | undefined {
    if (!bounds) return undefined;
    const left = Number(bounds.left);
    const top = Number(bounds.top);
    const width = Number(bounds.width);
    const height = Number(bounds.height);
    const right = Number.isFinite(Number(bounds.right)) ? Number(bounds.right) : left + width;
    const bottom = Number.isFinite(Number(bounds.bottom)) ? Number(bounds.bottom) : top + height;
    const normalizedWidth = Number.isFinite(width) ? width : right - left;
    const normalizedHeight = Number.isFinite(height) ? height : bottom - top;
    if (![left, top, right, bottom, normalizedWidth, normalizedHeight].every((value) => Number.isFinite(value))) {
        return undefined;
    }
    if (right <= left || bottom <= top || normalizedWidth <= 0 || normalizedHeight <= 0) {
        return undefined;
    }
    return {
        left,
        top,
        right,
        bottom,
        width: normalizedWidth,
        height: normalizedHeight
    };
}

function calculateBoundsDeviation(expected: AcceptanceBounds, actual: AcceptanceBounds): { left: number; top: number; width: number; height: number; maxAbs: number } {
    const deviation = {
        left: actual.left - expected.left,
        top: actual.top - expected.top,
        width: actual.width - expected.width,
        height: actual.height - expected.height,
        maxAbs: 0
    };
    deviation.maxAbs = Math.max(
        Math.abs(deviation.left),
        Math.abs(deviation.top),
        Math.abs(deviation.width),
        Math.abs(deviation.height)
    );
    return deviation;
}

function collectTargetLayerIds(params: any): number[] {
    const values = [
        params?.layerId,
        params?.targetLayerId,
        ...(Array.isArray(params?.layerIds) ? params.layerIds : []),
        ...(Array.isArray(params?.targetLayerIds) ? params.targetLayerIds : [])
    ];
    return uniqueNumbers(values.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0));
}

function collectTextContentUpdates(params: any): { layerId: number; content: string }[] {
    if (!Array.isArray(params?.updates)) return [];
    return params.updates.flatMap((update: any) => {
        const layerId = Number(update?.layerId);
        if (!Number.isFinite(layerId) || layerId <= 0 || !hasTextContentParam(update)) return [];
        return [{
            layerId,
            content: normalizeTextContentForCompare(update.content)
        }];
    });
}

function hasTextContentParam(params: any): boolean {
    return Object.prototype.hasOwnProperty.call(params || {}, 'content');
}

function textContentMatches(actualContent: unknown, expectedContent: unknown): boolean {
    return normalizeTextContentForCompare(actualContent) === normalizeTextContentForCompare(expectedContent);
}

function numberWithinTolerance(actual: number, expected: number, tolerance: number): boolean {
    return Math.abs(actual - expected) <= tolerance;
}

function roundForSummary(value: number): number {
    return Math.round(value * 100) / 100;
}

function formatBoundsForSummary(bounds: AcceptanceBounds): string {
    return `left=${roundForSummary(bounds.left)}, top=${roundForSummary(bounds.top)}, width=${roundForSummary(bounds.width)}, height=${roundForSummary(bounds.height)}`;
}

function normalizeTextContentForCompare(content: unknown): string {
    return String(content ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function summarizeTextUpdateExpectations(updates: { layerId: number; content: string }[]): string {
    return updates
        .slice(0, 5)
        .map((update) => `${update.layerId}:「${truncateForAssertion(update.content)}」`)
        .join('、') + (updates.length > 5 ? ` 等 ${updates.length} 项` : '');
}

function summarizeTextUpdateActuals(
    updates: { layerId: number; content: string }[],
    afterTextLayerById: Map<number, AcceptanceLayer>
): string {
    return updates
        .slice(0, 5)
        .map((update) => {
            const layer = afterTextLayerById.get(update.layerId);
            return `${update.layerId}:「${truncateForAssertion(normalizeTextContentForCompare(layer?.text?.content))}」`;
        })
        .join('、') + (updates.length > 5 ? ` 等 ${updates.length} 项` : '');
}

function summarizeTextMismatches(mismatched: Array<{ layerId: number; expected: string; actual: string }>): string {
    return mismatched
        .slice(0, 3)
        .map((item) => `${item.layerId}: 期望「${truncateForAssertion(item.expected)}」实际「${truncateForAssertion(item.actual)}」`)
        .join('；') + (mismatched.length > 3 ? `；另有 ${mismatched.length - 3} 项` : '');
}

function summarizeNumericActuals(
    key: 'fontSize' | 'tracking' | 'leading',
    layers: AcceptanceLayer[]
): string {
    return layers
        .slice(0, 5)
        .map((layer) => {
            const value = Number(layer.text?.style?.[key]);
            return `${layer.id}:${Number.isFinite(value) ? roundForSummary(value) : '未知'}`;
        })
        .join('、') + (layers.length > 5 ? ` 等 ${layers.length} 项` : '');
}

function truncateForAssertion(value: string, maxLength = 80): string {
    const text = String(value ?? '');
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 1)}…`;
}

function fontMatches(actualFont: string | undefined, expectedFont: string): boolean {
    const actual = normalizeFontName(actualFont || '');
    const expected = normalizeFontName(expectedFont);
    if (!actual || !expected) return false;
    return actual === expected || actual.includes(expected) || expected.includes(actual);
}

function normalizeFontName(fontName: string): string {
    return String(fontName || '')
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, '');
}

function summarizeAssertionStatus(assertions: ToolAcceptanceAssertion[]): ToolAcceptanceAssertionStatus | undefined {
    if (assertions.length === 0) return undefined;
    if (assertions.some((assertion) => assertion.status === 'failed')) return 'failed';
    if (assertions.some((assertion) => assertion.status === 'needs_review')) return 'needs_review';
    if (assertions.every((assertion) => assertion.status === 'not_applicable')) return 'not_applicable';
    return 'passed';
}

function formatAssertionSummaryText(evidence: ToolAcceptanceEvidence): string {
    if (!evidence.assertions?.length) return '';
    const failed = evidence.assertions.find((assertion) => assertion.status === 'failed');
    if (failed) return ` 任务断言失败：${failed.summary}`;
    const review = evidence.assertions.find((assertion) => assertion.status === 'needs_review');
    if (review) return ` 任务断言需复核：${review.summary}`;
    const passed = evidence.assertions.find((assertion) => assertion.status === 'passed');
    if (passed && evidence.toolSucceeded === false) return ` 任务断言仅供诊断：${passed.summary}`;
    if (passed) return ` 任务断言通过：${passed.summary}`;
    return '';
}

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.filter(Boolean)));
}

function uniqueNumbers(values: number[]): number[] {
    return Array.from(new Set(values));
}

function withAcceptanceSummaries(evidence: ToolAcceptanceEvidence): ToolAcceptanceEvidence {
    const summaryText = formatToolAcceptanceSummary(evidence);
    const debugText = formatToolAcceptanceDebug(evidence);
    return {
        ...evidence,
        ...(summaryText ? { summaryText } : {}),
        ...(debugText ? { debugText } : {})
    };
}
