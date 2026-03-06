/**
 * 填充计划工具函数
 *
 * 处理 FillPlan 与 ParsedScreen 的对齐、图层关系增强、质量评估。
 */

import type { FillPlan, ParsedScreen, ImagePlaceholder, PlanQuality } from './detail-page.types';
import { executeToolCall } from '../tool-executor.service';

// ==================== 数值工具 ====================

export function clamp01(input: number, fallback: number): number {
    if (!Number.isFinite(input)) return fallback;
    return Math.max(0, Math.min(1, input));
}

// ==================== 计划质量 ====================

export function calculatePlanQuality(plan: FillPlan | undefined): PlanQuality {
    const images = plan?.images || [];
    const copies = plan?.copies || [];

    const imageTotal = images.length;
    const imageMatched = images.filter(img => !!img.imagePath).length;
    const imageCoverage = imageTotal > 0 ? imageMatched / imageTotal : 1;

    const copyTotal = copies.length;
    const copyNonEmpty = copies.filter(copy => !!String(copy.content || '').trim()).length;
    const copyCoverage = copyTotal > 0 ? copyNonEmpty / copyTotal : 1;

    const confidence = clamp01(Number(plan?.confidence), imageCoverage);
    const score = (imageCoverage * 0.65) + (copyCoverage * 0.2) + (confidence * 0.15);

    return { confidence, score, imageTotal, imageMatched, imageCoverage, copyTotal, copyNonEmpty, copyCoverage };
}

// ==================== 计划-屏对齐 ====================

export function alignFillPlansToScreens(
    fillPlans: FillPlan[],
    screens: ParsedScreen[]
): { alignedPlans: Array<FillPlan | undefined>; unmatchedPlanCount: number } {
    const byScreenId = new Map<number, { plan: FillPlan; index: number }>();
    fillPlans.forEach((plan, index) => {
        if (!byScreenId.has(plan.screenId)) {
            byScreenId.set(plan.screenId, { plan, index });
        }
    });

    const usedIndexes = new Set<number>();
    const alignedPlans: Array<FillPlan | undefined> = [];

    for (let i = 0; i < screens.length; i++) {
        const screen = screens[i];
        const hit = byScreenId.get(screen.id);
        if (hit && !usedIndexes.has(hit.index)) {
            usedIndexes.add(hit.index);
            alignedPlans.push(hit.plan);
            continue;
        }
        if (fillPlans[i] && !usedIndexes.has(i)) {
            usedIndexes.add(i);
            alignedPlans.push(fillPlans[i]);
            continue;
        }
        const fallbackIndex = fillPlans.findIndex((_, idx) => !usedIndexes.has(idx));
        if (fallbackIndex >= 0) {
            usedIndexes.add(fallbackIndex);
            alignedPlans.push(fillPlans[fallbackIndex]);
            continue;
        }
        alignedPlans.push(undefined);
    }

    return { alignedPlans, unmatchedPlanCount: Math.max(0, fillPlans.length - usedIndexes.size) };
}

// ==================== 图层关系增强 ====================

export function enrichFillPlansWithLayerRelations(fillPlans: FillPlan[], screens: ParsedScreen[]): FillPlan[] {
    const screenMap = new Map<number, ParsedScreen>(screens.map(s => [s.id, s]));
    return (fillPlans || []).map(plan => {
        const screen = screenMap.get(plan.screenId);
        const placeholderMap = new Map<number, ImagePlaceholder>(
            (screen?.imagePlaceholders || []).map(item => [item.layerId, item])
        );
        const images = (plan.images || []).map(image => {
            const placeholder = placeholderMap.get(image.layerId);
            const baseLayerId = image.baseLayerId || placeholder?.baseLayerId || placeholder?.clippingInfo?.baseLayerId;
            const zone = placeholder?.zone || image.zone || 'unknown';
            const zoneDrivenFillMode = zone === 'icon' ? 'contain' : image.fillMode;
            return {
                ...image,
                fillMode: zoneDrivenFillMode || 'cover',
                isClippingMask: image.isClippingMask ?? placeholder?.isClippingMask,
                baseLayerId,
                referenceLayerId: image.referenceLayerId || baseLayerId || image.layerId,
                zone,
            };
        });
        return { ...plan, images };
    });
}

// ==================== 结构告警 ====================

export function collectStructureAlerts(screens: ParsedScreen[]): Array<{ screenName: string; missingGroups: string[] }> {
    const alerts: Array<{ screenName: string; missingGroups: string[] }> = [];
    for (const screen of screens || []) {
        const missing = screen?.structure?.missingGroups || [];
        if (missing.length > 0) {
            alerts.push({ screenName: screen.name, missingGroups: missing });
        }
    }
    return alerts;
}

// ==================== 填充后图片对齐 ====================

export async function alignFilledImages(
    plan: FillPlan,
    screen: ParsedScreen | undefined,
    callbacks: any,
    results: any[]
): Promise<number> {
    const filledImages = plan.images?.filter(img => img.imagePath) || [];
    if (filledImages.length === 0) return 0;

    let alignedCount = 0;
    for (const img of filledImages) {
        try {
            const placeholder = screen?.imagePlaceholders?.find(p => p.layerId === img.layerId);
            const referenceLayerId =
                img.referenceLayerId ||
                img.baseLayerId ||
                placeholder?.baseLayerId ||
                placeholder?.clippingInfo?.baseLayerId ||
                img.layerId;
            const alignResult = await executeToolCall('alignToReference', {
                layerId: img.layerId,
                referenceLayerId,
                alignMode: 'center-in-bounds',
            });
            if (alignResult?.success) alignedCount++;
            results.push({
                toolName: `alignToReference[${img.layerId}]`,
                result: alignResult,
                context: { referenceLayerId },
            });
        } catch {
            // 对齐失败不阻断流程
        }
    }
    return alignedCount;
}
