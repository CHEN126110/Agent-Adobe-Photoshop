import type { DetailScreenPlan } from './detail-page-screen-plan';
import { normalizeDetailRect } from './detail-page-anchor-diagnostics';

export interface DetailCopyLayoutPlaceholderSource {
    layerId: number;
    layerName?: string;
    currentText?: string;
    role?: string;
    fontSize?: number;
    bounds?: unknown;
}

export interface DetailCopyLayoutScreenSource {
    id: number;
    name: string;
    copyPlaceholders?: DetailCopyLayoutPlaceholderSource[];
}

export interface DetailCopyLayoutAuditMetrics {
    charCount: number;
    lineCount: number;
    longestLineChars: number;
    longestLineUnits: number;
    duplicateCount: number;
    crossScreenExactDuplicateCount: number;
    crossScreenNearDuplicateCount: number;
    repeatedSellingPointCount: number;
    fontMetricsReliable: boolean;
    estimatedLineWidth: number | null;
    widthUsage: number | null;
    boundsWidth: number | null;
    boundsHeight: number | null;
    fontSize: number | null;
}

export interface DetailCopyLayoutAuditItem {
    screenId: number;
    screenName: string;
    screenRole: DetailScreenPlan['screenRole'] | null;
    mainMessage: string | null;
    placeholderLayerId: number;
    placeholderLayerName: string;
    role: string;
    copyStrategy: DetailScreenPlan['copyStrategy'] | null;
    currentText: string;
    status: 'ok' | 'watch' | 'risky';
    warnings: string[];
    metrics: DetailCopyLayoutAuditMetrics;
}

export interface DetailCopyLayoutAuditResult {
    success: true;
    screens: DetailCopyLayoutScreenSource[];
    screenPlans: DetailScreenPlan[];
    audits: DetailCopyLayoutAuditItem[];
    warnings: string[];
    riskyScreenIds: number[];
    summary: {
        screenCount: number;
        copyPlaceholderCount: number;
        riskyCopyCount: number;
        watchCopyCount: number;
        warningCount: number;
        crossScreenExactDuplicateCount: number;
        crossScreenNearDuplicateCount: number;
        repeatedSellingPointCount: number;
    };
}

export interface DetailCopyLayoutAuditOptions {
    screens: DetailCopyLayoutScreenSource[];
    screenPlans?: DetailScreenPlan[];
    nearLimitThreshold?: number;
    overflowThreshold?: number;
}

export interface DetailFillPlanCopyProjectionSource {
    screenId: number;
    copies?: Array<{
        layerId: number;
        content?: string;
    }>;
}

function countDetailCopyChars(text: string): number {
    return String(text || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\n/g, '')
        .replace(/\s+/g, '')
        .length;
}

function countDetailCopyUnits(text: string): number {
    const normalized = String(text || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\n/g, '')
        .replace(/\s+/g, '');

    let total = 0;
    for (const char of normalized) {
        if (/[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/u.test(char)) {
            total += 1;
        } else if (/[A-Z]/.test(char)) {
            total += 0.72;
        } else if (/[a-z0-9]/.test(char)) {
            total += 0.62;
        } else {
            total += 0.5;
        }
    }
    return total;
}

function normalizeCopyComparisonText(text: string): string {
    return String(text || '')
        .toLowerCase()
        .replace(/[\s，。；;、,:：!！?？"'“”‘’（）()【】[\]<>《》\-_/|·•]+/g, '')
        .slice(0, 160);
}

function buildCharacterBigrams(text: string): Set<string> {
    const grams = new Set<string>();
    for (let index = 0; index < text.length - 1; index++) {
        grams.add(text.slice(index, index + 2));
    }
    return grams;
}

function calculateDiceSimilarity(left: string, right: string): number {
    const leftGrams = buildCharacterBigrams(left);
    const rightGrams = buildCharacterBigrams(right);
    if (leftGrams.size === 0 || rightGrams.size === 0) return 0;
    let overlap = 0;
    leftGrams.forEach((gram) => {
        if (rightGrams.has(gram)) overlap += 1;
    });
    return (2 * overlap) / (leftGrams.size + rightGrams.size);
}

function findLongestCommonSubstring(left: string, right: string): string {
    if (!left || !right) return '';
    const previous = new Array<number>(right.length + 1).fill(0);
    let longestLength = 0;
    let longestEnd = 0;
    for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
        let diagonal = 0;
        for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
            const above = previous[rightIndex];
            if (left[leftIndex - 1] === right[rightIndex - 1]) {
                previous[rightIndex] = diagonal + 1;
                if (previous[rightIndex] > longestLength) {
                    longestLength = previous[rightIndex];
                    longestEnd = leftIndex;
                }
            } else {
                previous[rightIndex] = 0;
            }
            diagonal = above;
        }
    }
    return left.slice(longestEnd - longestLength, longestEnd);
}

function isNearDuplicateCopy(left: string, right: string): boolean {
    const minLength = Math.min(left.length, right.length);
    const maxLength = Math.max(left.length, right.length);
    if (minLength < 6 || maxLength === 0) return false;
    if ((left.includes(right) || right.includes(left)) && minLength / maxLength >= 0.68) {
        return true;
    }
    return calculateDiceSimilarity(left, right) >= 0.72;
}

function findRepeatedSellingPointPhrase(left: string, right: string): string {
    const minLength = Math.min(left.length, right.length);
    if (minLength < 8) return '';
    const common = findLongestCommonSubstring(left, right);
    const hasCjk = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/u.test(common);
    const minimumPhraseLength = hasCjk ? 4 : 6;
    if (common.length < minimumPhraseLength) return '';
    if (common.length / minLength < 0.32) return '';
    return common;
}

export function applyDetailFillPlanCopiesToScreens<T extends DetailCopyLayoutScreenSource>(
    screens: T[],
    fillPlans: DetailFillPlanCopyProjectionSource[]
): T[] {
    const copyByScreenId = new Map<number, Map<number, string>>();
    for (const plan of fillPlans || []) {
        const planScreenId = Number(plan?.screenId || 0);
        if (!planScreenId || !Array.isArray(plan.copies) || plan.copies.length === 0) continue;

        const perScreen = new Map<number, string>();
        for (const copy of plan.copies) {
            const layerId = Number(copy?.layerId || 0);
            if (!layerId) continue;
            perScreen.set(layerId, String(copy?.content || ''));
        }
        if (perScreen.size > 0) {
            copyByScreenId.set(planScreenId, perScreen);
        }
    }

    return (screens || []).map((screen) => {
        const perScreen = copyByScreenId.get(Number(screen?.id || 0));
        if (!perScreen || !Array.isArray(screen?.copyPlaceholders) || screen.copyPlaceholders.length === 0) {
            return screen;
        }

        return {
            ...screen,
            copyPlaceholders: screen.copyPlaceholders.map((placeholder) => {
                const replacement = perScreen.get(Number(placeholder?.layerId || 0));
                if (replacement === undefined) return placeholder;
                return {
                    ...placeholder,
                    currentText: replacement
                };
            })
        };
    });
}

export function auditDetailCopyLayoutForScreens(options: DetailCopyLayoutAuditOptions): DetailCopyLayoutAuditResult {
    const screens = Array.isArray(options.screens) ? options.screens : [];
    const screenPlans = Array.isArray(options.screenPlans) ? options.screenPlans : [];
    const planByScreenId = new Map<number, DetailScreenPlan>();
    for (const plan of screenPlans) {
        planByScreenId.set(Number(plan.screenId || 0), plan);
    }

    const nearLimitThreshold = typeof options.nearLimitThreshold === 'number'
        ? Math.max(0.7, Math.min(1.2, options.nearLimitThreshold))
        : 0.9;
    const overflowThreshold = typeof options.overflowThreshold === 'number'
        ? Math.max(0.85, Math.min(1.5, options.overflowThreshold))
        : 1.08;

    const audits: DetailCopyLayoutAuditItem[] = [];

    for (const screen of screens) {
        const screenId = Number(screen?.id || 0);
        const screenName = String(screen?.name || screenId || '');
        const screenPlan = planByScreenId.get(screenId);
        const copyPlaceholders = Array.isArray(screen?.copyPlaceholders) ? screen.copyPlaceholders : [];

        const duplicateMap = new Map<string, number>();
        for (const placeholder of copyPlaceholders) {
            const rawText = String(placeholder?.currentText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
            const duplicateKey = rawText.replace(/\s+/g, '').toLowerCase();
            if (duplicateKey) {
                duplicateMap.set(duplicateKey, (duplicateMap.get(duplicateKey) || 0) + 1);
            }
        }

        for (const placeholder of copyPlaceholders) {
            const placeholderLayerId = Number(placeholder?.layerId || 0);
            const placeholderLayerName = String(placeholder?.layerName || placeholderLayerId);
            const rawText = String(placeholder?.currentText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
            const trimmedText = rawText.trim();
            const bounds = normalizeDetailRect(placeholder?.bounds);
            const fontSize = Number(placeholder?.fontSize || 0);
            const role = String(placeholder?.role || 'unknown');
            const copyStrategy = screenPlan?.copyStrategy || null;
            const lines = rawText.length > 0 ? rawText.split('\n') : [];
            const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
            const longestLineChars = nonEmptyLines.reduce((max, line) => Math.max(max, countDetailCopyChars(line)), 0);
            const longestLineUnits = nonEmptyLines.reduce((max, line) => Math.max(max, countDetailCopyUnits(line)), 0);
            const charCount = countDetailCopyChars(rawText);
            const duplicateKey = trimmedText.replace(/\s+/g, '').toLowerCase();
            const duplicateCount = duplicateKey ? (duplicateMap.get(duplicateKey) || 0) : 0;
            const fontMetricsReliable = Boolean(
                bounds
                && fontSize > 0
                && nonEmptyLines.length > 0
                && (bounds.height / (fontSize * nonEmptyLines.length)) >= 0.75
            );
            const estimatedLineWidth = bounds && fontSize > 0
                ? Math.round(longestLineUnits * fontSize * 100) / 100
                : null;
            const widthUsage = fontMetricsReliable && estimatedLineWidth !== null && bounds && bounds.width > 0
                ? estimatedLineWidth / bounds.width
                : null;
            const itemWarnings: string[] = [];

            if (!trimmedText) {
                itemWarnings.push('Copy is empty');
            }
            if (duplicateCount > 1 && charCount > 4) {
                itemWarnings.push('Duplicate copy exists in the same screen');
            }
            if (widthUsage !== null && charCount >= 6 && widthUsage > overflowThreshold) {
                itemWarnings.push('Estimated line width exceeds the current text frame');
            } else if (widthUsage !== null && charCount >= 6 && widthUsage >= nearLimitThreshold) {
                itemWarnings.push('Estimated line width is close to the text frame limit');
            }
            if ((role === 'title' || copyStrategy === 'headline') && nonEmptyLines.length > 2) {
                itemWarnings.push('Headline uses too many lines');
            }
            if ((role === 'title' || copyStrategy === 'headline') && charCount > 24) {
                itemWarnings.push('Headline character count is too long');
            }
            if (copyStrategy === 'parameter' && nonEmptyLines.length > 3) {
                itemWarnings.push('Parameter copy uses too many lines');
            }
            if (fontMetricsReliable && fontSize > 0 && bounds && nonEmptyLines.length > 0) {
                const expectedMinHeight = fontSize * Math.max(1.15, nonEmptyLines.length * 1.02);
                if (bounds.height < expectedMinHeight * 0.8) {
                    itemWarnings.push('Text frame height looks too tight');
                }
            }
            if (nonEmptyLines.length > 1) {
                const shortestLineChars = nonEmptyLines.reduce((min, line) => Math.min(min, countDetailCopyChars(line)), Number.MAX_SAFE_INTEGER);
                if (shortestLineChars !== Number.MAX_SAFE_INTEGER && shortestLineChars > 0 && longestLineChars / shortestLineChars >= 3) {
                    itemWarnings.push('Line length imbalance is too large after wrapping');
                }
            }

            const status: 'ok' | 'watch' | 'risky' =
                itemWarnings.includes('Copy is empty')
                    ? 'risky'
                    : itemWarnings.length > 0
                        ? 'watch'
                        : 'ok';

            audits.push({
                screenId,
                screenName,
                screenRole: screenPlan?.screenRole || null,
                mainMessage: screenPlan?.mainMessage || null,
                placeholderLayerId,
                placeholderLayerName,
                role,
                copyStrategy,
                currentText: rawText,
                status,
                warnings: itemWarnings,
                metrics: {
                    charCount,
                    lineCount: nonEmptyLines.length,
                    longestLineChars,
                    longestLineUnits: Math.round(longestLineUnits * 100) / 100,
                    duplicateCount,
                    crossScreenExactDuplicateCount: 0,
                    crossScreenNearDuplicateCount: 0,
                    repeatedSellingPointCount: 0,
                    fontMetricsReliable,
                    estimatedLineWidth,
                    widthUsage: widthUsage === null ? null : Math.round(widthUsage * 1000) / 1000,
                    boundsWidth: bounds?.width ?? null,
                    boundsHeight: bounds?.height ?? null,
                    fontSize: Number.isFinite(fontSize) && fontSize > 0 ? fontSize : null
                }
            });
        }
    }

    const exactDuplicateScreens = audits.map(() => new Set<number>());
    const nearDuplicateScreens = audits.map(() => new Set<number>());
    const sellingPointScreens = audits.map(() => new Set<number>());
    const sellingPointPhrases = audits.map(() => new Set<string>());
    const comparisonTexts = audits.map((audit) => normalizeCopyComparisonText(audit.currentText));

    for (let leftIndex = 0; leftIndex < audits.length; leftIndex++) {
        for (let rightIndex = leftIndex + 1; rightIndex < audits.length; rightIndex++) {
            const leftAudit = audits[leftIndex];
            const rightAudit = audits[rightIndex];
            if (leftAudit.screenId === rightAudit.screenId) continue;
            const leftText = comparisonTexts[leftIndex];
            const rightText = comparisonTexts[rightIndex];
            if (leftText.length < 5 || rightText.length < 5) continue;

            if (leftText === rightText) {
                exactDuplicateScreens[leftIndex].add(rightAudit.screenId);
                exactDuplicateScreens[rightIndex].add(leftAudit.screenId);
                continue;
            }
            if (isNearDuplicateCopy(leftText, rightText)) {
                nearDuplicateScreens[leftIndex].add(rightAudit.screenId);
                nearDuplicateScreens[rightIndex].add(leftAudit.screenId);
                continue;
            }
            const repeatedPhrase = findRepeatedSellingPointPhrase(leftText, rightText);
            if (!repeatedPhrase) continue;
            sellingPointScreens[leftIndex].add(rightAudit.screenId);
            sellingPointScreens[rightIndex].add(leftAudit.screenId);
            sellingPointPhrases[leftIndex].add(repeatedPhrase);
            sellingPointPhrases[rightIndex].add(repeatedPhrase);
        }
    }

    const enrichedAudits = audits.map((audit, index): DetailCopyLayoutAuditItem => {
        const itemWarnings = [...audit.warnings];
        const exactCount = exactDuplicateScreens[index].size;
        const nearCount = nearDuplicateScreens[index].size;
        const repeatedSellingPointCount = sellingPointScreens[index].size;
        if (exactCount > 0) {
            itemWarnings.push(`Exact copy repeats across ${exactCount} other screen(s)`);
        }
        if (nearCount > 0) {
            itemWarnings.push(`Near-duplicate copy appears across ${nearCount} other screen(s)`);
        }
        if (repeatedSellingPointCount > 0) {
            const phrases = Array.from(sellingPointPhrases[index]).slice(0, 3).join(' / ');
            itemWarnings.push(`Selling-point phrase repeats across ${repeatedSellingPointCount} other screen(s): ${phrases}`);
        }
        const status: DetailCopyLayoutAuditItem['status'] = itemWarnings.includes('Copy is empty')
            ? 'risky'
            : itemWarnings.length > 0 ? 'watch' : 'ok';
        return {
            ...audit,
            status,
            warnings: itemWarnings,
            metrics: {
                ...audit.metrics,
                crossScreenExactDuplicateCount: exactCount,
                crossScreenNearDuplicateCount: nearCount,
                repeatedSellingPointCount
            }
        };
    });
    const warnings = enrichedAudits
        .filter((audit) => audit.status !== 'ok')
        .map((audit) => `${audit.screenName}: ${audit.placeholderLayerName} - ${audit.warnings.join('; ')}`);
    const riskyScreenIds = Array.from(new Set(
        enrichedAudits
            .filter((audit) => audit.status !== 'ok')
            .map((audit) => audit.screenId)
    ));

    return {
        success: true,
        screens,
        screenPlans,
        audits: enrichedAudits,
        warnings,
        riskyScreenIds,
        summary: {
            screenCount: screens.length,
            copyPlaceholderCount: enrichedAudits.length,
            riskyCopyCount: enrichedAudits.filter((item) => item.status === 'risky').length,
            watchCopyCount: enrichedAudits.filter((item) => item.status === 'watch').length,
            warningCount: warnings.length,
            crossScreenExactDuplicateCount: enrichedAudits.filter((item) => item.metrics.crossScreenExactDuplicateCount > 0).length,
            crossScreenNearDuplicateCount: enrichedAudits.filter((item) => item.metrics.crossScreenNearDuplicateCount > 0).length,
            repeatedSellingPointCount: enrichedAudits.filter((item) => item.metrics.repeatedSellingPointCount > 0).length
        }
    };
}
