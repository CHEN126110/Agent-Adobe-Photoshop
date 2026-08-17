export type SkuDeliveryStatus = 'completed' | 'partial' | 'failed';

export type SkuDeliveryIssueCode =
    | 'invalid_template_layout'
    | 'combo_output_incomplete'
    | 'note_output_incomplete'
    | 'export_readback_blocked'
    | 'export_readback_pending'
    | 'execution_warning';

const SKU_DELIVERY_ISSUE_CODES = new Set<SkuDeliveryIssueCode>([
    'invalid_template_layout',
    'combo_output_incomplete',
    'note_output_incomplete',
    'export_readback_blocked',
    'export_readback_pending',
    'execution_warning'
]);

export interface SkuDeliveryOutputMismatch {
    size: number;
    kind: 'combo' | 'note';
    expected: number;
    completed: number;
}

export interface SkuDeliveryIssueGroup {
    code: SkuDeliveryIssueCode;
    title: string;
    detail: string;
    count: number;
    sizes: number[];
}

export interface SkuDeliveryWarningGroup {
    representative: string;
    count: number;
    sizes: number[];
}

export interface SkuDeliveryComboGroup {
    size: number;
    comboCount: number;
    noteGenerated: boolean;
    noteSkipped: boolean;
    previewCombos: string[];
    hiddenComboCount: number;
}

export interface SkuDeliverySummary {
    version: 'sku-delivery-summary/v0';
    presentationMode: 'sku_delivery_owned';
    status: SkuDeliveryStatus;
    skuDocName: string;
    requestedSizes: number[];
    processedSizes: string[];
    totalCombos: number;
    generatedNoteSizes: number[];
    skippedNoteSizes: number[];
    noteCount: number;
    skippedNoteCount: number;
    exportCount: number;
    warningCount: number;
    advisoryCount: number;
    issueCount: number;
    warningGroupCount: number;
    primaryIssue?: string;
    issueGroups: SkuDeliveryIssueGroup[];
    warningGroups: SkuDeliveryWarningGroup[];
    comboGroups: SkuDeliveryComboGroup[];
    exportedFileNames: string[];
    warnings: string[];
    advisories: string[];
    compactText: string;
    detailText: string;
    publicationNotice?: string;
    rawPayloadRedacted: true;
}

export interface BuildSkuDeliverySummaryInput {
    status: SkuDeliveryStatus;
    skuDocName?: string;
    requestedSizes?: Iterable<number>;
    processedSizes?: string[];
    completedCombosBySize?: Record<string, string[][]>;
    generatedNoteSizes?: Iterable<number>;
    skippedNoteSizes?: Iterable<number>;
    exportedFileNames?: string[];
    /**
     * 只接受已经面向用户改写过的交付提示。执行器内部错误、能力版本、
     * 读回记录和契约诊断必须留在私有诊断通道，不能直接传到这里。
     */
    userWarnings?: string[];
    /** 不影响已通过交付验收的维护性提醒，例如临时目录清理失败。 */
    userAdvisories?: string[];
    requestedOutputMismatches?: SkuDeliveryOutputMismatch[];
    invalidTemplateSizes?: Iterable<number>;
    exportReadbackStatus?: 'no_exports' | 'needs_file_probe' | 'ready_for_review' | 'blocked';
    publicationNotice?: string;
    maxPreviewCombosPerSize?: number;
}

function toBasename(value: string): string {
    const text = String(value || '').trim();
    if (!text) return '';
    return text.split(/[/\\]/).pop() || text;
}

function normalizeTextList(values: unknown[] | undefined): string[] {
    if (!Array.isArray(values)) return [];
    return values.map((item) => String(item || '').trim()).filter(Boolean);
}

function normalizeWarningFamilyKey(value: string): string {
    return value
        .replace(/第\s*\d+\s*组/g, '{batch}')
        .replace(/\d+\s*双/g, '{size}')
        .replace(/\d+\s*\/\s*\d+/g, '{ratio}')
        .replace(/\s+/g, '')
        .replace(/[。！!]+$/g, '');
}

function extractWarningSizes(value: string): number[] {
    const sizes = new Set<number>();
    for (const match of value.matchAll(/(\d+)\s*双/g)) {
        const size = Number(match[1]);
        if (Number.isFinite(size) && size > 0) sizes.add(Math.floor(size));
    }
    return Array.from(sizes).sort((left, right) => left - right);
}

function buildSkuDeliveryWarningGroups(warnings: string[]): SkuDeliveryWarningGroup[] {
    const groups = new Map<string, SkuDeliveryWarningGroup>();
    for (const warning of warnings) {
        const key = normalizeWarningFamilyKey(warning);
        if (!key) continue;
        const sizes = extractWarningSizes(warning);
        const existing = groups.get(key);
        if (!existing) {
            groups.set(key, {
                representative: warning,
                count: 1,
                sizes
            });
            continue;
        }
        existing.count += 1;
        existing.sizes = Array.from(new Set([...existing.sizes, ...sizes]))
            .sort((left, right) => left - right);
    }
    return Array.from(groups.values());
}

function normalizeNumberSet(values: Iterable<number> | undefined): Set<number> {
    const result = new Set<number>();
    if (!values) return result;
    for (const value of values) {
        const numberValue = Number(value);
        if (Number.isFinite(numberValue)) {
            result.add(numberValue);
        }
    }
    return result;
}

function normalizePositiveInteger(value: unknown): number {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue) || numberValue <= 0) return 0;
    return Math.floor(numberValue);
}

function normalizeOutputMismatches(
    values: SkuDeliveryOutputMismatch[] | undefined
): SkuDeliveryOutputMismatch[] {
    if (!Array.isArray(values)) return [];
    return values
        .map((item) => ({
            size: normalizePositiveInteger(item?.size),
            kind: item?.kind === 'note' ? 'note' as const : 'combo' as const,
            expected: normalizePositiveInteger(item?.expected),
            completed: Math.max(0, Math.floor(Number(item?.completed) || 0))
        }))
        .filter((item) => item.size > 0 && item.expected !== item.completed);
}

function formatIssueSizes(sizes: number[]): string {
    return sizes.length > 0 ? sizes.map((size) => `${size}双`).join('、') : '';
}

function buildOutputMismatchIssueGroup(
    kind: 'combo' | 'note',
    mismatches: SkuDeliveryOutputMismatch[]
): SkuDeliveryIssueGroup | undefined {
    const matching = mismatches
        .filter((item) => item.kind === kind)
        .sort((left, right) => left.size - right.size);
    if (matching.length === 0) return undefined;
    const unit = kind === 'combo' ? '组' : '项';
    const hasOnlyMissingRows = matching.every((item) => item.completed < item.expected);
    const title = kind === 'combo'
        ? (hasOnlyMissingRows ? '组合图未完整生成' : '组合图数量与计划不一致')
        : (hasOnlyMissingRows ? '自选备注未完整生成' : '自选备注数量与计划不一致');
    return {
        code: kind === 'combo' ? 'combo_output_incomplete' : 'note_output_incomplete',
        title,
        detail: matching
            .map((item) => `${item.size}双 ${item.completed}/${item.expected}${unit}`)
            .join('；'),
        count: matching.length,
        sizes: matching.map((item) => item.size)
    };
}

function buildSkuDeliveryIssueGroups(input: {
    status: SkuDeliveryStatus;
    warningCount: number;
    requestedOutputMismatches: SkuDeliveryOutputMismatch[];
    invalidTemplateSizes: number[];
    exportReadbackStatus?: BuildSkuDeliverySummaryInput['exportReadbackStatus'];
}): SkuDeliveryIssueGroup[] {
    const groups: SkuDeliveryIssueGroup[] = [];
    if (input.invalidTemplateSizes.length > 0) {
        groups.push({
            code: 'invalid_template_layout',
            title: '模板版面结构未通过检查',
            detail: `${formatIssueSizes(input.invalidTemplateSizes)}已停止生成，避免输出错位文件`,
            count: input.invalidTemplateSizes.length,
            sizes: input.invalidTemplateSizes
        });
    }
    const comboGroup = buildOutputMismatchIssueGroup('combo', input.requestedOutputMismatches);
    if (comboGroup) groups.push(comboGroup);
    const noteGroup = buildOutputMismatchIssueGroup('note', input.requestedOutputMismatches);
    if (noteGroup) groups.push(noteGroup);
    if (input.exportReadbackStatus === 'blocked') {
        groups.push({
            code: 'export_readback_blocked',
            title: '导出文件未通过完整性检查',
            detail: '文件解码、尺寸或像素验收未通过，本次不计为完成',
            count: 1,
            sizes: []
        });
    } else if (input.exportReadbackStatus === 'needs_file_probe') {
        groups.push({
            code: 'export_readback_pending',
            title: '导出文件仍需检查',
            detail: '部分文件缺少可靠读回，本次不计为完整交付',
            count: 1,
            sizes: []
        });
    }
    return groups;
}

function formatCombo(combo: string[]): string {
    const colors = normalizeTextList(combo);
    const counts = new Map<string, number>();
    for (const color of colors) {
        counts.set(color, (counts.get(color) || 0) + 1);
    }
    return Array.from(counts.entries())
        .map(([color, count]) => count > 1 ? `${color}x${count}` : color)
        .join('+') || '未命名组合';
}

function buildCompactText(summary: {
    status: SkuDeliveryStatus;
    exportCount: number;
    primaryIssue?: string;
}): string {
    let statusLabel = 'SKU 未完成';
    if (summary.status === 'completed') statusLabel = 'SKU 已完成';
    else if (summary.status === 'partial') statusLabel = 'SKU 部分完成';
    const lines = [`${statusLabel}。`];
    if (summary.primaryIssue) {
        lines.push(`主要问题：${summary.primaryIssue.replace(/[。！!]+$/g, '')}。`);
    } else if (summary.status === 'failed' && summary.exportCount === 0) {
        lines.push('本次没有生成可交付文件。');
    } else if (summary.status === 'completed') {
        lines.push('交付文件已通过本轮检查。');
    }
    return lines.join('\n');
}

function truncateCompactIssue(value: string, maxLength = 96): string {
    const normalized = value.trim();
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function resolvePrimarySkuDeliveryIssue(
    issueGroups: SkuDeliveryIssueGroup[],
    warningGroups: SkuDeliveryWarningGroup[]
): string | undefined {
    const highConfidenceIssueGroup = issueGroups.find((group) => (
        group.code === 'invalid_template_layout'
        || group.code === 'export_readback_blocked'
    ));
    if (highConfidenceIssueGroup) {
        return [
            highConfidenceIssueGroup.title,
            highConfidenceIssueGroup.sizes.length > 0
                ? `（${formatIssueSizes(highConfidenceIssueGroup.sizes)}）`
                : ''
        ].join('');
    }
    if (warningGroups.length > 0) {
        const warningGroup = warningGroups[0];
        const representative = warningGroup.representative.replace(/[。！!]+$/g, '');
        const warningIssue = warningGroup.count > 1
            ? `${representative}（同类${warningGroup.count}条）`
            : representative;
        return truncateCompactIssue(warningIssue);
    }
    const fallbackIssueGroup = issueGroups[0];
    if (!fallbackIssueGroup) return undefined;
    return [
        fallbackIssueGroup.title,
        fallbackIssueGroup.sizes.length > 0
            ? `（${formatIssueSizes(fallbackIssueGroup.sizes)}）`
            : ''
    ].join('');
}

function buildDetailText(input: {
    skuDocName: string;
    requestedSizes: number[];
    issueGroups: SkuDeliveryIssueGroup[];
    warningGroups: SkuDeliveryWarningGroup[];
    comboGroups: SkuDeliveryComboGroup[];
    exportedFileNames: string[];
    warningCount: number;
    advisories: string[];
    publicationNotice?: string;
}): string {
    const sections: string[] = [];
    const contextLines: string[] = [];
    if (input.skuDocName) contextLines.push(`素材：${input.skuDocName}`);
    if (input.requestedSizes.length > 0) {
        contextLines.push(`请求规格：${formatIssueSizes(input.requestedSizes)}`);
    }
    if (contextLines.length > 0) sections.push(contextLines.join('\n'));
    if (input.issueGroups.length > 0) {
        sections.push([
            `交付缺口（${input.issueGroups.length}类）`,
            ...input.issueGroups.map((group) => `- ${group.title}：${group.detail}`)
        ].join('\n'));
    }
    if (input.warningGroups.length > 0) {
        sections.push([
            `执行提示（${input.warningGroups.length}类，原始${input.warningCount}条）`,
            ...input.warningGroups.map((group) => {
                const details: string[] = [];
                if (group.count > 1) details.push(`同类${group.count}条`);
                if (group.sizes.length > 0) details.push(`涉及${formatIssueSizes(group.sizes)}`);
                const suffix = details.length > 0 ? `（${details.join('，')}）` : '';
                return `- ${group.representative}${suffix}`;
            })
        ].join('\n'));
    }
    if (input.comboGroups.length > 0) {
        const comboLines = input.comboGroups.map((group) => {
            const lines = [`${group.size}双装（${group.comboCount}组）`];
            group.previewCombos.forEach((combo, index) => {
                lines.push(`${index + 1}. ${combo}`);
            });
            if (group.hiddenComboCount > 0) {
                lines.push(`另有 ${group.hiddenComboCount} 组已收起`);
            }
            if (group.noteGenerated) {
                lines.push('已生成自选备注');
            } else if (group.noteSkipped) {
                lines.push('已跳过自选备注');
            }
            return lines.join('\n');
        });
        sections.push(comboLines.join('\n\n'));
    }
    if (input.exportedFileNames.length > 0) {
        sections.push([
            `导出文件（${input.exportedFileNames.length}张）`,
            ...input.exportedFileNames.map((fileName) => `- ${fileName}`)
        ].join('\n'));
    }
    if (input.advisories.length > 0) {
        sections.push([
            `运行提醒（${input.advisories.length}项，不影响本次交付状态）`,
            ...input.advisories.map((advisory) => `- ${advisory}`)
        ].join('\n'));
    }
    if (input.publicationNotice) sections.push(`发布说明：${input.publicationNotice}`);
    return sections.join('\n\n') || '暂无明细。';
}

export function buildSkuDeliverySummary(input: BuildSkuDeliverySummaryInput): SkuDeliverySummary {
    const requestedSizes = Array.from(normalizeNumberSet(input.requestedSizes)).sort((a, b) => a - b);
    const processedSizes = normalizeTextList(input.processedSizes);
    const generatedNoteSizes = normalizeNumberSet(input.generatedNoteSizes);
    const skippedNoteSizes = normalizeNumberSet(input.skippedNoteSizes);
    const maxPreviewCombosPerSize = Math.max(1, Math.floor(input.maxPreviewCombosPerSize || 5));
    const completedCombosBySize = input.completedCombosBySize || {};
    const comboGroups = Object.entries(completedCombosBySize)
        .map(([sizeText, combos]) => {
            const size = Number(sizeText);
            const comboList = Array.isArray(combos) ? combos : [];
            const previewCombos = comboList.slice(0, maxPreviewCombosPerSize).map(formatCombo);
            return {
                size: Number.isFinite(size) ? size : 0,
                comboCount: comboList.length,
                noteGenerated: generatedNoteSizes.has(size),
                noteSkipped: skippedNoteSizes.has(size),
                previewCombos,
                hiddenComboCount: Math.max(0, comboList.length - previewCombos.length)
            } satisfies SkuDeliveryComboGroup;
        })
        .filter((group) => group.size > 0)
        .sort((a, b) => a.size - b.size);
    const exportedFileNames = normalizeTextList(input.exportedFileNames).map(toBasename).filter(Boolean);
    const warnings = normalizeTextList(input.userWarnings);
    const warningGroups = buildSkuDeliveryWarningGroups(warnings);
    const advisories = normalizeTextList(input.userAdvisories);
    const requestedOutputMismatches = normalizeOutputMismatches(input.requestedOutputMismatches);
    const invalidTemplateSizes = Array.from(normalizeNumberSet(input.invalidTemplateSizes)).sort((a, b) => a - b);
    const totalCombos = comboGroups.reduce((sum, group) => sum + group.comboCount, 0);
    const noteCount = generatedNoteSizes.size;
    const skippedNoteCount = skippedNoteSizes.size;
    const warningCount = warnings.length;
    const skuDocName = toBasename(input.skuDocName || '');
    const status = input.status;
    const issueGroups = buildSkuDeliveryIssueGroups({
        status,
        warningCount,
        requestedOutputMismatches,
        invalidTemplateSizes,
        exportReadbackStatus: input.exportReadbackStatus
    });
    const primaryIssue = resolvePrimarySkuDeliveryIssue(issueGroups, warningGroups);
    const publicationNotice = String(input.publicationNotice || '').trim() || undefined;
    const compactText = buildCompactText({
        status,
        exportCount: exportedFileNames.length,
        primaryIssue
    });
    const detailText = buildDetailText({
        skuDocName,
        requestedSizes,
        issueGroups,
        warningGroups,
        comboGroups,
        exportedFileNames,
        warningCount,
        advisories,
        publicationNotice
    });

    return {
        version: 'sku-delivery-summary/v0',
        presentationMode: 'sku_delivery_owned',
        status,
        skuDocName,
        requestedSizes,
        processedSizes,
        totalCombos,
        generatedNoteSizes: Array.from(generatedNoteSizes).sort((left, right) => left - right),
        skippedNoteSizes: Array.from(skippedNoteSizes).sort((left, right) => left - right),
        noteCount,
        skippedNoteCount,
        exportCount: exportedFileNames.length,
        warningCount,
        advisoryCount: advisories.length,
        issueCount: issueGroups.length + warningGroups.length,
        warningGroupCount: warningGroups.length,
        primaryIssue,
        issueGroups,
        warningGroups,
        comboGroups,
        exportedFileNames,
        warnings,
        advisories,
        compactText,
        detailText,
        publicationNotice,
        rawPayloadRedacted: true
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
    return isNonNegativeFiniteNumber(value) && Number.isInteger(value);
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isNormalizedTextArray(value: unknown): value is string[] {
    return isStringArray(value)
        && JSON.stringify(value) === JSON.stringify(normalizeTextList(value));
}

function isNumberArray(value: unknown): value is number[] {
    return Array.isArray(value) && value.every((item) => (
        typeof item === 'number' && Number.isInteger(item) && item > 0
    ));
}

function isCanonicalPositiveIntegerSet(values: number[]): boolean {
    const normalized = Array.from(new Set(values)).sort((left, right) => left - right);
    return JSON.stringify(values) === JSON.stringify(normalized);
}

interface ParsedSkuProcessedSize {
    size: number;
    kind: 'combo_complete' | 'combo_partial' | 'note' | 'note_skipped';
    completedComboCount: number;
    expectedComboCount: number;
}

function parseSkuProcessedSize(value: string): ParsedSkuProcessedSize | undefined {
    const comboPartialMatch = value.match(/^(\d+)\s*双\s*\((\d+)\s*\/\s*(\d+)\s*组\)$/);
    if (comboPartialMatch) {
        const size = normalizePositiveInteger(comboPartialMatch[1]);
        const completedComboCount = normalizePositiveInteger(comboPartialMatch[2]);
        const expectedComboCount = normalizePositiveInteger(comboPartialMatch[3]);
        if (size <= 0
            || completedComboCount <= 0
            || expectedComboCount <= completedComboCount) {
            return undefined;
        }
        return {
            size,
            kind: 'combo_partial',
            completedComboCount,
            expectedComboCount
        };
    }
    const comboCompleteMatch = value.match(/^(\d+)\s*双\s*\((\d+)\s*组\)$/);
    if (comboCompleteMatch) {
        const size = normalizePositiveInteger(comboCompleteMatch[1]);
        const comboCount = normalizePositiveInteger(comboCompleteMatch[2]);
        if (size <= 0 || comboCount <= 0) return undefined;
        return {
            size,
            kind: 'combo_complete',
            completedComboCount: comboCount,
            expectedComboCount: comboCount
        };
    }
    const noteMatch = value.match(/^(\d+)\s*双\s*\(自选备注\)$/);
    if (noteMatch) {
        const size = normalizePositiveInteger(noteMatch[1]);
        if (size <= 0) return undefined;
        return {
            size,
            kind: 'note',
            completedComboCount: 0,
            expectedComboCount: 0
        };
    }
    const skippedNoteMatch = value.match(/^(\d+)\s*双\s*\(自选备注已跳过\)$/);
    if (skippedNoteMatch) {
        const size = normalizePositiveInteger(skippedNoteMatch[1]);
        if (size <= 0) return undefined;
        return {
            size,
            kind: 'note_skipped',
            completedComboCount: 0,
            expectedComboCount: 0
        };
    }
    return undefined;
}

function isSkuDeliveryIssueGroup(value: unknown): value is SkuDeliveryIssueGroup {
    if (!isRecord(value)) return false;
    const baseIsValid = SKU_DELIVERY_ISSUE_CODES.has(value.code as SkuDeliveryIssueCode)
        && typeof value.title === 'string'
        && value.title.trim().length > 0
        && value.title === value.title.trim()
        && typeof value.detail === 'string'
        && value.detail.trim().length > 0
        && value.detail === value.detail.trim()
        && isNonNegativeInteger(value.count)
        && value.count > 0
        && isNumberArray(value.sizes);
    if (!baseIsValid) return false;
    const sizes = value.sizes as number[];
    if (!isCanonicalPositiveIntegerSet(sizes)) return false;
    const code = value.code as SkuDeliveryIssueCode;
    if (code === 'invalid_template_layout'
        || code === 'combo_output_incomplete'
        || code === 'note_output_incomplete') {
        return value.count === sizes.length;
    }
    if (code === 'export_readback_blocked' || code === 'export_readback_pending') {
        return value.count === 1 && sizes.length === 0;
    }
    return true;
}

function isSkuDeliveryWarningGroup(value: unknown): value is SkuDeliveryWarningGroup {
    if (!isRecord(value)) return false;
    return typeof value.representative === 'string'
        && value.representative.trim().length > 0
        && value.representative === value.representative.trim()
        && isNonNegativeInteger(value.count)
        && value.count > 0
        && isNumberArray(value.sizes);
}

function isSkuDeliveryComboGroup(value: unknown): value is SkuDeliveryComboGroup {
    if (!isRecord(value)) return false;
    return isNonNegativeInteger(value.size)
        && value.size > 0
        && isNonNegativeInteger(value.comboCount)
        && typeof value.noteGenerated === 'boolean'
        && typeof value.noteSkipped === 'boolean'
        && isNormalizedTextArray(value.previewCombos)
        && isNonNegativeInteger(value.hiddenComboCount)
        && value.comboCount === value.previewCombos.length + value.hiddenComboCount;
}

/**
 * 只有完整的新版 SKU 摘要才能拥有对话呈现权。旧记录或字段缺失时
 * 必须 fail-open，保留原始正文、执行摘要和工具失败，避免把真实原因隐藏起来。
 */
export function isSkuDeliveryPresentationSummary(value: unknown): value is SkuDeliverySummary {
    if (!isRecord(value)) return false;
    if (value.version !== 'sku-delivery-summary/v0'
        || value.presentationMode !== 'sku_delivery_owned'
        || !['completed', 'partial', 'failed'].includes(String(value.status || ''))
        || value.rawPayloadRedacted !== true) {
        return false;
    }
    if (typeof value.skuDocName !== 'string'
        || typeof value.compactText !== 'string'
        || value.compactText.trim().length === 0
        || typeof value.detailText !== 'string'
        || value.detailText.trim().length === 0) {
        return false;
    }
    const numericFields = [
        value.totalCombos,
        value.noteCount,
        value.skippedNoteCount,
        value.exportCount,
        value.warningCount,
        value.advisoryCount,
        value.issueCount,
        value.warningGroupCount
    ];
    if (!numericFields.every(isNonNegativeInteger)) return false;
    if (!isNumberArray(value.requestedSizes)
        || !isNormalizedTextArray(value.processedSizes)
        || !isNumberArray(value.generatedNoteSizes)
        || !isNumberArray(value.skippedNoteSizes)
        || !isNormalizedTextArray(value.exportedFileNames)
        || !isNormalizedTextArray(value.warnings)
        || !isNormalizedTextArray(value.advisories)
        || !Array.isArray(value.issueGroups)
        || !value.issueGroups.every(isSkuDeliveryIssueGroup)
        || !Array.isArray(value.warningGroups)
        || !value.warningGroups.every(isSkuDeliveryWarningGroup)
        || !Array.isArray(value.comboGroups)
        || !value.comboGroups.every(isSkuDeliveryComboGroup)) {
        return false;
    }
    if (value.warningCount !== value.warnings.length
        || value.advisoryCount !== value.advisories.length
        || value.warningGroupCount !== value.warningGroups.length
        || value.issueCount !== value.issueGroups.length + value.warningGroups.length) {
        return false;
    }
    const requestedSizes = value.requestedSizes as number[];
    const processedSizes = value.processedSizes as string[];
    const normalizedRequestedSizes = Array.from(normalizeNumberSet(requestedSizes))
        .sort((left, right) => left - right);
    if (JSON.stringify(requestedSizes) !== JSON.stringify(normalizedRequestedSizes)) return false;
    const generatedNoteSizes = value.generatedNoteSizes as number[];
    const skippedNoteSizes = value.skippedNoteSizes as number[];
    const normalizedGeneratedNoteSizes = Array.from(normalizeNumberSet(generatedNoteSizes))
        .sort((left, right) => left - right);
    const normalizedSkippedNoteSizes = Array.from(normalizeNumberSet(skippedNoteSizes))
        .sort((left, right) => left - right);
    if (JSON.stringify(generatedNoteSizes) !== JSON.stringify(normalizedGeneratedNoteSizes)
        || JSON.stringify(skippedNoteSizes) !== JSON.stringify(normalizedSkippedNoteSizes)
        || value.noteCount !== generatedNoteSizes.length
        || value.skippedNoteCount !== skippedNoteSizes.length) {
        return false;
    }
    const generatedNoteSizeSet = new Set(generatedNoteSizes);
    if (skippedNoteSizes.some((size) => generatedNoteSizeSet.has(size))) return false;
    const parsedProcessedSizes = processedSizes.map(parseSkuProcessedSize);
    if (parsedProcessedSizes.some((item) => !item)) return false;
    const concreteProcessedSizes = parsedProcessedSizes as ParsedSkuProcessedSize[];
    const processedSizeNumbers = concreteProcessedSizes.map((item) => item.size);
    const requestedSizeSet = new Set(requestedSizes);
    if (new Set(processedSizeNumbers).size !== processedSizeNumbers.length
        || (requestedSizes.length > 0
            && processedSizeNumbers.some((size) => !requestedSizeSet.has(size)))) {
        return false;
    }
    if (value.skuDocName !== toBasename(value.skuDocName)) return false;
    const normalizedExportedFileNames = normalizeTextList(value.exportedFileNames)
        .map(toBasename)
        .filter(Boolean);
    if (JSON.stringify(value.exportedFileNames) !== JSON.stringify(normalizedExportedFileNames)) return false;
    if (value.exportCount !== value.exportedFileNames.length) return false;
    const orderedComboSizes = value.comboGroups.map((group) => group.size);
    const normalizedComboSizes = Array.from(new Set(orderedComboSizes))
        .sort((left, right) => left - right);
    if (JSON.stringify(orderedComboSizes) !== JSON.stringify(normalizedComboSizes)) return false;
    if (requestedSizes.length > 0
        && (orderedComboSizes.some((size) => !requestedSizeSet.has(size))
            || generatedNoteSizes.some((size) => !requestedSizeSet.has(size))
            || skippedNoteSizes.some((size) => !requestedSizeSet.has(size)))) {
        return false;
    }
    const totalCombos = value.comboGroups.reduce((sum, group) => sum + group.comboCount, 0);
    if (value.totalCombos !== totalCombos) return false;
    if (value.comboGroups.some((group) => (
        group.noteGenerated !== generatedNoteSizeSet.has(group.size)
        || group.noteSkipped !== skippedNoteSizes.includes(group.size)
    ))) {
        return false;
    }
    const processedSizeSet = new Set(processedSizeNumbers);
    if (orderedComboSizes.some((size) => !processedSizeSet.has(size))
        || generatedNoteSizes.some((size) => !processedSizeSet.has(size))) {
        return false;
    }
    const comboGroupBySize = new Map(value.comboGroups.map((group) => [group.size, group]));
    for (const processedSize of concreteProcessedSizes) {
        const comboGroup = comboGroupBySize.get(processedSize.size);
        if (processedSize.kind === 'combo_complete') {
            if (!comboGroup || comboGroup.comboCount !== processedSize.completedComboCount) return false;
            continue;
        }
        if (processedSize.kind === 'combo_partial') {
            if (comboGroup) return false;
            continue;
        }
        if (processedSize.kind === 'note') {
            if (!generatedNoteSizeSet.has(processedSize.size) || comboGroup) return false;
            continue;
        }
        if (!skippedNoteSizes.includes(processedSize.size) || comboGroup) return false;
    }
    const completedComboExportCount = concreteProcessedSizes.reduce(
        (sum, item) => sum + item.completedComboCount,
        0
    );
    if (value.exportCount !== completedComboExportCount + generatedNoteSizes.length) return false;
    if (value.primaryIssue !== undefined
        && (typeof value.primaryIssue !== 'string' || value.primaryIssue.trim().length === 0)) {
        return false;
    }
    if (value.publicationNotice !== undefined
        && (typeof value.publicationNotice !== 'string'
            || value.publicationNotice.trim().length === 0
            || value.publicationNotice !== value.publicationNotice.trim())) {
        return false;
    }
    const summary = value as unknown as SkuDeliverySummary;
    const expectedWarningGroups = buildSkuDeliveryWarningGroups(summary.warnings);
    if (JSON.stringify(summary.warningGroups) !== JSON.stringify(expectedWarningGroups)) return false;
    const expectedPrimaryIssue = resolvePrimarySkuDeliveryIssue(
        summary.issueGroups,
        summary.warningGroups
    );
    if (summary.primaryIssue !== expectedPrimaryIssue) return false;
    const expectedCompactText = buildCompactText({
        status: summary.status,
        exportCount: summary.exportCount,
        primaryIssue: expectedPrimaryIssue
    });
    if (summary.compactText !== expectedCompactText) return false;
    const expectedDetailText = buildDetailText({
        skuDocName: summary.skuDocName,
        requestedSizes: summary.requestedSizes,
        issueGroups: summary.issueGroups,
        warningGroups: summary.warningGroups,
        comboGroups: summary.comboGroups,
        exportedFileNames: summary.exportedFileNames,
        warningCount: summary.warningCount,
        advisories: summary.advisories,
        publicationNotice: summary.publicationNotice
    });
    if (summary.detailText !== expectedDetailText) return false;
    if (summary.status === 'completed'
        && (summary.exportCount <= 0 || summary.issueCount !== 0)) {
        return false;
    }
    if (summary.status === 'failed' && summary.exportCount !== 0) return false;
    if (summary.status === 'partial'
        && (summary.exportCount <= 0 || summary.issueCount <= 0)) {
        return false;
    }
    return true;
}
