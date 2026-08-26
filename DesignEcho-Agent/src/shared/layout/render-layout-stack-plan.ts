export interface RenderLayoutStackUnit {
    blockId: string;
    stackOrder: number;
    /** Photoshop 图层从下到上的原子单元，例如 [裁切基底, 图片] 或 [底块, 文字]。 */
    layerIdsBottomToTop: number[];
}

export interface RenderLayoutStackPlan {
    valid: boolean;
    issues: string[];
    unitsBottomToTop: RenderLayoutStackUnit[];
    layerIdsBottomToTop: number[];
    layerIdsTopToBottom: number[];
}

/**
 * 把 Agent 的区域顺序与区域内部机械关系合成唯一层序账本。
 * 本函数不按 role 排序，也不读取品类；同 stackOrder 时保持来源顺序。
 */
export function buildRenderLayoutStackPlan(
    inputUnits: readonly RenderLayoutStackUnit[]
): RenderLayoutStackPlan {
    const issues: string[] = [];
    const seenLayerIds = new Set<number>();
    const units = inputUnits.map((unit, sourceIndex) => {
        const blockId = String(unit?.blockId || '').trim() || `stack-unit-${sourceIndex + 1}`;
        const stackOrder = Number(unit?.stackOrder);
        if (!Number.isFinite(stackOrder)) {
            issues.push(`${blockId}:stackOrder_must_be_finite`);
        }
        const layerIdsBottomToTop = Array.isArray(unit?.layerIdsBottomToTop)
            ? unit.layerIdsBottomToTop.map(Number)
            : [];
        if (layerIdsBottomToTop.length === 0) {
            issues.push(`${blockId}:layerIdsBottomToTop_non_empty_required`);
        }
        for (const layerId of layerIdsBottomToTop) {
            if (!Number.isSafeInteger(layerId) || layerId <= 0) {
                issues.push(`${blockId}:invalid_layer_id_${String(layerId)}`);
                continue;
            }
            if (seenLayerIds.has(layerId)) {
                issues.push(`${blockId}:duplicate_layer_id_${layerId}`);
                continue;
            }
            seenLayerIds.add(layerId);
        }
        return {
            sourceIndex,
            unit: { blockId, stackOrder, layerIdsBottomToTop }
        };
    });
    const unitsBottomToTop = units
        .sort((left, right) => (
            left.unit.stackOrder - right.unit.stackOrder
            || left.sourceIndex - right.sourceIndex
        ))
        .map((entry) => entry.unit);
    const layerIdsBottomToTop = unitsBottomToTop.flatMap((unit) => unit.layerIdsBottomToTop);
    return {
        valid: issues.length === 0,
        issues,
        unitsBottomToTop,
        layerIdsBottomToTop,
        layerIdsTopToBottom: [...layerIdsBottomToTop].reverse()
    };
}
