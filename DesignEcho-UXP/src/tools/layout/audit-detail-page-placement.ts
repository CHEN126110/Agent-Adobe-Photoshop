import { Tool, ToolSchema } from '../types';

interface Rect {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width?: number;
    height?: number;
}

interface ScreenLike {
    id: number;
    name: string;
    index?: number;
    bounds?: Rect;
}

interface PlacementExpectedRelation {
    clipped?: boolean;
    clippingBaseId?: number;
    parentGroupId?: number;
    smartObject?: boolean;
    mattingApplied?: boolean;
    containedByTarget?: boolean;
}

interface PlacementActualRelation {
    clipped?: boolean | null;
    clippingBaseId?: number | null;
    parentGroupId?: number | null;
    smartObject?: boolean | null;
    mattingApplied?: boolean | null;
    containedByTarget?: boolean | null;
}

interface PlacementRelationExpectation {
    actualLayerId?: number;
    placeholderLayerId?: number;
    expectedRelation: PlacementExpectedRelation;
}

interface PlacementRelationVerification {
    status: 'passed' | 'needs_review' | 'failed';
    expected: PlacementExpectedRelation;
    actual: PlacementActualRelation;
    passedChecks: string[];
    warnings: string[];
    blockers: string[];
}

interface PlacementLike {
    screenId?: number;
    screenName?: string;
    placeholderLayerId?: number;
    placeholderLayerName?: string;
    actualLayerId?: number;
    actualLayerName?: string;
    targetBounds?: Rect;
    actualBounds?: Rect;
    baseLayerId?: number;
    referenceLayerId?: number;
    isClipped?: boolean;
    clippingBaseId?: number | null;
    parentGroupId?: number | null;
    isSmartObject?: boolean | null;
    expectedRelation?: PlacementExpectedRelation;
    actualRelation?: PlacementActualRelation;
    fillMode?: string;
    subjectAlign?: string;
    parentGroupName?: string;
}

interface PlacementAudit {
    screenId: number;
    screenName: string;
    placeholderLayerId: number;
    placeholderLayerName: string;
    actualLayerId?: number;
    actualLayerName?: string;
    status: 'ok' | 'watch' | 'risky';
    warnings: string[];
    metrics: {
        overlapRatio: number;
        offsetRatio: number;
        centerOffsetX: number;
        centerOffsetY: number;
    };
    targetBounds: Required<Rect>;
    actualBounds: Required<Rect>;
    baseLayerId?: number;
    referenceLayerId?: number;
    isClipped?: boolean;
    clippingBaseId?: number | null;
    parentGroupId?: number | null;
    isSmartObject?: boolean | null;
    expectedRelation?: PlacementExpectedRelation;
    actualRelation: PlacementActualRelation;
    relationVerification?: PlacementRelationVerification;
    fillMode?: string;
    subjectAlign?: string;
    parentGroupName?: string;
}

function normalizeRect(rect: any): Required<Rect> | null {
    if (!rect) return null;
    const left = Number(rect.left);
    const top = Number(rect.top);
    const right = Number(rect.right);
    const bottom = Number(rect.bottom);
    if (![left, top, right, bottom].every((value) => Number.isFinite(value))) {
        return null;
    }
    if (right <= left || bottom <= top) {
        return null;
    }
    return {
        left,
        top,
        right,
        bottom,
        width: right - left,
        height: bottom - top
    };
}

function computeIntersectionRatio(a: Required<Rect>, b: Required<Rect>): number {
    const left = Math.max(a.left, b.left);
    const top = Math.max(a.top, b.top);
    const right = Math.min(a.right, b.right);
    const bottom = Math.min(a.bottom, b.bottom);
    if (right <= left || bottom <= top) return 0;
    const intersection = (right - left) * (bottom - top);
    const area = Math.max(1, a.width * a.height);
    return intersection / area;
}

function rectContainsWithTolerance(
    outer: Required<Rect>,
    inner: Required<Rect>,
    tolerance = 2
): boolean {
    return inner.left >= outer.left - tolerance
        && inner.top >= outer.top - tolerance
        && inner.right <= outer.right + tolerance
        && inner.bottom <= outer.bottom + tolerance;
}

function roundMetric(value: number): number {
    return Math.round(value * 1000) / 1000;
}

function statusFromPlacementWarnings(warnings: string[]): PlacementAudit['status'] {
    if (warnings.length >= 2) return 'risky';
    if (warnings.length === 1) return 'watch';
    return 'ok';
}

function resolveExpectedRelation(
    placement: PlacementLike,
    expectations: PlacementRelationExpectation[]
): PlacementExpectedRelation | undefined {
    const actualLayerId = Number(placement.actualLayerId || 0);
    const placeholderLayerId = Number(placement.placeholderLayerId || 0);
    const matched = expectations.find((item) => (
        (actualLayerId > 0 && Number(item.actualLayerId || 0) === actualLayerId)
        || (placeholderLayerId > 0 && Number(item.placeholderLayerId || 0) === placeholderLayerId)
    ));
    const merged = {
        ...(matched?.expectedRelation || {}),
        ...(placement.expectedRelation || {})
    };
    return Object.keys(merged).length > 0 ? merged : undefined;
}

function resolveActualRelation(placement: PlacementLike): PlacementActualRelation {
    const actual: PlacementActualRelation = {
        ...(placement.actualRelation || {})
    };
    if (actual.clipped === undefined && typeof placement.isClipped === 'boolean') {
        actual.clipped = placement.isClipped;
    }
    if (actual.clippingBaseId === undefined && placement.clippingBaseId !== undefined) {
        actual.clippingBaseId = placement.clippingBaseId;
    }
    if (actual.parentGroupId === undefined && placement.parentGroupId !== undefined) {
        actual.parentGroupId = placement.parentGroupId;
    }
    if (actual.smartObject === undefined && placement.isSmartObject !== undefined) {
        actual.smartObject = placement.isSmartObject;
    }
    return actual;
}

function relationValueIsKnown(value: unknown): boolean {
    return value !== undefined;
}

function compareRelationField(input: {
    field: keyof PlacementExpectedRelation;
    label: string;
    expected: PlacementExpectedRelation;
    actual: PlacementActualRelation;
    passedChecks: string[];
    warnings: string[];
    blockers: string[];
}): void {
    const expectedValue = input.expected[input.field];
    if (expectedValue === undefined) return;
    const actualValue = input.actual[input.field];
    if (!relationValueIsKnown(actualValue)) {
        input.warnings.push(`缺少写后${input.label}读回，无法验证预期 ${String(expectedValue)}`);
        return;
    }
    if (actualValue !== expectedValue) {
        input.blockers.push(`写后${input.label}为 ${String(actualValue)}，与明确预期 ${String(expectedValue)} 不一致`);
        return;
    }
    input.passedChecks.push(`${input.field} matches expected relation`);
}

function verifyPlacementRelation(
    expected: PlacementExpectedRelation | undefined,
    actual: PlacementActualRelation
): PlacementRelationVerification | undefined {
    if (!expected) return undefined;
    const passedChecks: string[] = [];
    const warnings: string[] = [];
    const blockers: string[] = [];
    const fields: Array<{ field: keyof PlacementExpectedRelation; label: string }> = [
        { field: 'clipped', label: '剪切状态' },
        { field: 'clippingBaseId', label: '剪切基底图层 ID' },
        { field: 'parentGroupId', label: '父组图层 ID' },
        { field: 'smartObject', label: '智能对象状态' },
        { field: 'mattingApplied', label: '抠图/蒙版处理状态' },
        { field: 'containedByTarget', label: '目标容器边界包含状态' }
    ];
    for (const relationField of fields) {
        compareRelationField({
            ...relationField,
            expected,
            actual,
            passedChecks,
            warnings,
            blockers
        });
    }

    let status: PlacementRelationVerification['status'] = 'passed';
    if (blockers.length > 0) status = 'failed';
    else if (warnings.length > 0) status = 'needs_review';
    return { status, expected, actual, passedChecks, warnings, blockers };
}

export class AuditDetailPagePlacementTool implements Tool {
    name = 'auditDetailPagePlacement';

    schema: ToolSchema = {
        name: 'auditDetailPagePlacement',
        description: 'Audit detail-page image placement against placeholder target bounds and flag stacking or offset risks.',
        parameters: {
            type: 'object',
            properties: {
                screens: {
                    type: 'array',
                    description: 'Parsed detail-page screens from parseDetailPageTemplate.'
                },
                placements: {
                    type: 'array',
                    description: 'Placement records returned from fillDetailPage.'
                },
                expectedRelations: {
                    type: 'array',
                    description: 'Optional exact clipping/base/parent/Smart Object/container containment expectations keyed by actualLayerId or placeholderLayerId.'
                }
            },
            required: ['screens']
        }
    };

    async execute(params: {
        screens: ScreenLike[];
        placements?: PlacementLike[];
        expectedRelations?: PlacementRelationExpectation[];
    }): Promise<{
        success: boolean;
        audits?: PlacementAudit[];
        warnings?: string[];
        riskyScreenIds?: number[];
        summary?: {
            screenCount: number;
            placementCount: number;
            riskyPlacementCount: number;
            warningCount: number;
            relationFailedCount: number;
            relationNeedsReviewCount: number;
        };
        error?: string;
    }> {
        const screens = Array.isArray(params.screens) ? params.screens : [];
        const placements = Array.isArray(params.placements) ? params.placements : [];
        const expectedRelations = Array.isArray(params.expectedRelations) ? params.expectedRelations : [];

        if (screens.length === 0) {
            return { success: false, error: 'Missing detail-page screens.' };
        }

        const audits: PlacementAudit[] = [];
        const warnings: string[] = [];
        const riskyScreenIds = new Set<number>();

        for (const placement of placements) {
            const screenId = Number(placement.screenId || 0);
            const screen = screens.find((item) => Number(item.id) === screenId);
            const screenName = String(placement.screenName || screen?.name || `Screen ${screenId}`);
            const targetBounds = normalizeRect(placement.targetBounds);
            const actualBounds = normalizeRect(placement.actualBounds);

            if (!screenId || !targetBounds || !actualBounds) {
                continue;
            }

            const targetCenterX = targetBounds.left + (targetBounds.width / 2);
            const targetCenterY = targetBounds.top + (targetBounds.height / 2);
            const actualCenterX = actualBounds.left + (actualBounds.width / 2);
            const actualCenterY = actualBounds.top + (actualBounds.height / 2);
            const centerOffsetX = actualCenterX - targetCenterX;
            const centerOffsetY = actualCenterY - targetCenterY;
            const targetDiagonal = Math.max(1, Math.sqrt((targetBounds.width ** 2) + (targetBounds.height ** 2)));
            const offsetRatio = Math.sqrt((centerOffsetX ** 2) + (centerOffsetY ** 2)) / targetDiagonal;
            const overlapRatio = computeIntersectionRatio(targetBounds, actualBounds);

            const itemWarnings: string[] = [];
            if (overlapRatio < 0.35) {
                itemWarnings.push('实际图片与占位容器重合过低');
            }
            if (offsetRatio > 0.18) {
                itemWarnings.push('实际图片中心明显偏离占位容器中心');
            }

            const geometryStatus = statusFromPlacementWarnings(itemWarnings);
            const expectedRelation = resolveExpectedRelation(placement, expectedRelations);
            const actualRelation = resolveActualRelation(placement);
            actualRelation.containedByTarget = rectContainsWithTolerance(targetBounds, actualBounds);
            const relationVerification = verifyPlacementRelation(expectedRelation, actualRelation);
            itemWarnings.push(...(relationVerification?.warnings || []));
            itemWarnings.push(...(relationVerification?.blockers || []));

            let status = geometryStatus;
            if (relationVerification?.status === 'failed') {
                status = 'risky';
            } else if (relationVerification?.status === 'needs_review' && status === 'ok') {
                status = 'watch';
            }

            if (status === 'risky') {
                riskyScreenIds.add(screenId);
            }

            audits.push({
                screenId,
                screenName,
                placeholderLayerId: Number(placement.placeholderLayerId || 0),
                placeholderLayerName: String(placement.placeholderLayerName || ''),
                actualLayerId: Number.isFinite(Number(placement.actualLayerId)) ? Number(placement.actualLayerId) : undefined,
                actualLayerName: placement.actualLayerName,
                status,
                warnings: itemWarnings,
                metrics: {
                    overlapRatio: roundMetric(overlapRatio),
                    offsetRatio: roundMetric(offsetRatio),
                    centerOffsetX: roundMetric(centerOffsetX),
                    centerOffsetY: roundMetric(centerOffsetY)
                },
                targetBounds,
                actualBounds,
                baseLayerId: placement.baseLayerId,
                referenceLayerId: placement.referenceLayerId,
                ...(typeof actualRelation.clipped === 'boolean' ? { isClipped: actualRelation.clipped } : {}),
                clippingBaseId: actualRelation.clippingBaseId,
                parentGroupId: actualRelation.parentGroupId,
                isSmartObject: actualRelation.smartObject,
                expectedRelation,
                actualRelation,
                ...(relationVerification ? { relationVerification } : {}),
                fillMode: placement.fillMode,
                subjectAlign: placement.subjectAlign,
                parentGroupName: placement.parentGroupName
            });
        }

        const screenGroups = new Map<number, PlacementAudit[]>();
        for (const audit of audits) {
            const group = screenGroups.get(audit.screenId) || [];
            group.push(audit);
            screenGroups.set(audit.screenId, group);
        }

        for (const [screenId, group] of screenGroups.entries()) {
            for (let i = 0; i < group.length; i++) {
                for (let j = i + 1; j < group.length; j++) {
                    const first = group[i];
                    const second = group[j];
                    const actualOverlap = computeIntersectionRatio(first.actualBounds, second.actualBounds);
                    const targetOverlap = computeIntersectionRatio(first.targetBounds, second.targetBounds);
                    if (actualOverlap > 0.72 && targetOverlap < 0.18) {
                        const warning = `${first.screenName}: ${first.placeholderLayerName} 与 ${second.placeholderLayerName} 的实际放图区域严重重叠`;
                        warnings.push(warning);
                        riskyScreenIds.add(screenId);
                        if (!first.warnings.includes('与同屏其他图片严重叠放')) {
                            first.warnings.push('与同屏其他图片严重叠放');
                        }
                        if (!second.warnings.includes('与同屏其他图片严重叠放')) {
                            second.warnings.push('与同屏其他图片严重叠放');
                        }
                        first.status = 'risky';
                        second.status = 'risky';
                    }
                }
            }
        }

        for (const audit of audits) {
            for (const warning of audit.warnings) {
                warnings.push(`${audit.screenName}: ${audit.placeholderLayerName} - ${warning}`);
            }
        }

        return {
            success: true,
            audits,
            warnings,
            riskyScreenIds: Array.from(riskyScreenIds.values()),
            summary: {
                screenCount: screens.length,
                placementCount: audits.length,
                riskyPlacementCount: audits.filter((item) => item.status === 'risky').length,
                warningCount: warnings.length,
                relationFailedCount: audits.filter((item) => item.relationVerification?.status === 'failed').length,
                relationNeedsReviewCount: audits.filter((item) => item.relationVerification?.status === 'needs_review').length
            }
        };
    }
}
