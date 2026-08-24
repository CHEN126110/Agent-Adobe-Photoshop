import type {
    MinimalDesignElement,
    MinimalDesignElementStyle,
    MinimalDesignRepresentation
} from './reference-replication';

export type ReferenceStyleRecipeId =
    | 'solid-fill'
    | 'opacity'
    | 'corner-radius'
    | 'typography-scale'
    | 'shadow'
    | 'stroke'
    | 'glow'
    | 'blur'
    | 'gradient'
    | 'unknown-effect';

export type ReferenceStyleRecipeMaturity =
    | 'implemented-basic'
    | 'implemented-recipe'
    | 'planned'
    | 'unsupported';

export interface ReferenceStyleRecipe {
    id: ReferenceStyleRecipeId;
    label: string;
    maturity: ReferenceStyleRecipeMaturity;
    sourceFields: string[];
    currentExecution: string;
    limitation: string;
}

export interface ReferenceStyleRecipeHit {
    elementId: string;
    elementName: string;
    recipeId: ReferenceStyleRecipeId;
    maturity: ReferenceStyleRecipeMaturity;
    source: string;
}

export interface ReferenceStyleRecipeAnalysis {
    styledElementCount: number;
    executableHitCount: number;
    plannedHitCount: number;
    unsupportedHitCount: number;
    hits: ReferenceStyleRecipeHit[];
    plannedRecipes: ReferenceStyleRecipe[];
    unsupportedEffects: string[];
}

export interface ReferenceStrokeRecipeExecutionPlan {
    executable: boolean;
    recipeId: 'stroke';
    reason: string;
    params?: {
        color: { r: number; g: number; b: number };
        size: number;
        position: 'inside' | 'outside' | 'center';
        opacity: number;
    };
}

export interface ReferenceShadowRecipeExecutionPlan {
    executable: boolean;
    recipeId: 'shadow';
    reason: string;
    params?: {
        color: { r: number; g: number; b: number };
        opacity: number;
        angle: number;
        distance: number;
        spread: number;
        size: number;
    };
}

export const REFERENCE_STYLE_RECIPES: ReferenceStyleRecipe[] = [
    {
        id: 'solid-fill',
        label: '纯色填充 / 文字颜色',
        maturity: 'implemented-basic',
        sourceFields: ['fillColor', 'textColor', 'strokeColor'],
        currentExecution: '模板骨架落地时传入 createRectangle.fillColorHex 或 createTextLayer.colorHex。',
        limitation: '当前只支持单色，不支持复杂渐变、图片纹理或混合模式。'
    },
    {
        id: 'opacity',
        label: '透明度',
        maturity: 'implemented-basic',
        sourceFields: ['opacity'],
        currentExecution: '模板骨架落地时调用 setLayerOpacity。',
        limitation: '当前只设置图层整体透明度，不处理混合模式。'
    },
    {
        id: 'corner-radius',
        label: '圆角',
        maturity: 'implemented-basic',
        sourceFields: ['cornerRadius'],
        currentExecution: '矩形占位落地时传入 createRectangle.cornerRadius。',
        limitation: '当前只覆盖新建矩形占位，不覆盖任意矢量路径或已有图层。'
    },
    {
        id: 'typography-scale',
        label: '字号比例',
        maturity: 'implemented-basic',
        sourceFields: ['fontSizeRatio'],
        currentExecution: '文字占位落地时按画布高度换算 fontSize。',
        limitation: '当前不处理字距、行高、字体家族和精确字重。'
    },
    {
        id: 'shadow',
        label: '投影 / 阴影',
        maturity: 'planned',
        sourceFields: ['effects.shadow'],
        currentExecution: '只有取得颜色、透明度、角度、距离、扩展和大小的显式参数后才可调用 addDropShadow；仅识别到“有阴影”时不执行。',
        limitation: '当前参考表示没有完整投影参数，不能用统一黑色柔和阴影冒充原效果。'
    },
    {
        id: 'stroke',
        label: '描边',
        maturity: 'planned',
        sourceFields: ['effects.stroke'],
        currentExecution: '只有取得颜色、宽度、位置和透明度的显式参数后才可调用 addStroke；仅识别到描边颜色时不执行。',
        limitation: '当前参考表示没有完整描边参数，不能按目标框尺寸猜宽度或默认使用内描边。'
    },
    {
        id: 'glow',
        label: '发光',
        maturity: 'planned',
        sourceFields: ['effects.glow'],
        currentExecution: '当前只识别，不执行真实 Photoshop 发光样式。',
        limitation: '需要区分内发光/外发光，并明确混合模式、范围、颜色。'
    },
    {
        id: 'blur',
        label: '模糊',
        maturity: 'planned',
        sourceFields: ['effects.blur'],
        currentExecution: '当前只识别，不执行真实滤镜或智能滤镜。',
        limitation: '需要明确是背景模糊、阴影模糊还是素材模糊，并处理不可逆编辑风险。'
    },
    {
        id: 'gradient',
        label: '渐变',
        maturity: 'planned',
        sourceFields: ['effects.gradient'],
        currentExecution: '当前只识别，不执行真实渐变图层或渐变叠加。',
        limitation: '需要定义渐变方向、色标、位置、叠加方式和目标图层类型。'
    },
    {
        id: 'unknown-effect',
        label: '未知效果',
        maturity: 'unsupported',
        sourceFields: ['effects.*'],
        currentExecution: '当前不执行。',
        limitation: '需要先归一化为明确 recipe，不能把模型自由文本直接当 Photoshop 指令。'
    }
];

const RECIPE_BY_ID = new Map<ReferenceStyleRecipeId, ReferenceStyleRecipe>(
    REFERENCE_STYLE_RECIPES.map((recipe) => [recipe.id, recipe])
);

function normalizeEffectId(effect: string): ReferenceStyleRecipeId {
    const normalized = String(effect || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
    if (!normalized) return 'unknown-effect';
    if (/shadow|投影|阴影/.test(normalized)) return 'shadow';
    if (/stroke|border|outline|描边|边框/.test(normalized)) return 'stroke';
    if (/glow|发光/.test(normalized)) return 'glow';
    if (/blur|模糊/.test(normalized)) return 'blur';
    if (/gradient|渐变/.test(normalized)) return 'gradient';
    return 'unknown-effect';
}

function isExecutableMaturity(maturity: ReferenceStyleRecipeMaturity): boolean {
    return maturity === 'implemented-basic' || maturity === 'implemented-recipe';
}

function hasEffect(style: MinimalDesignElementStyle | undefined | null, recipeId: ReferenceStyleRecipeId): boolean {
    return Array.isArray(style?.effects)
        && style!.effects.some((effect) => normalizeEffectId(effect) === recipeId);
}

function hasStrokeEffect(style?: MinimalDesignElementStyle | null): boolean {
    return hasEffect(style, 'stroke');
}

function hasShadowEffect(style?: MinimalDesignElementStyle | null): boolean {
    return hasEffect(style, 'shadow');
}

function addHit(
    hits: ReferenceStyleRecipeHit[],
    element: MinimalDesignElement,
    recipeId: ReferenceStyleRecipeId,
    source: string
): void {
    const recipe = RECIPE_BY_ID.get(recipeId) || RECIPE_BY_ID.get('unknown-effect')!;
    hits.push({
        elementId: element.id,
        elementName: element.name,
        recipeId: recipe.id,
        maturity: recipe.maturity,
        source
    });
}

function collectHitsForElement(element: MinimalDesignElement, style: MinimalDesignElementStyle, hits: ReferenceStyleRecipeHit[]): void {
    if (style.fillColor || style.textColor || style.strokeColor) {
        addHit(hits, element, 'solid-fill', 'color');
    }
    if (typeof style.opacity === 'number') {
        addHit(hits, element, 'opacity', 'opacity');
    }
    if (typeof style.cornerRadius === 'number') {
        addHit(hits, element, 'corner-radius', 'cornerRadius');
    }
    if (typeof style.fontSizeRatio === 'number' && style.fontSizeRatio > 0) {
        addHit(hits, element, 'typography-scale', 'fontSizeRatio');
    }
    for (const effect of style.effects || []) {
        addHit(hits, element, normalizeEffectId(effect), `effect:${effect}`);
    }
}

export function getReferenceStyleRecipe(id: ReferenceStyleRecipeId): ReferenceStyleRecipe | undefined {
    return RECIPE_BY_ID.get(id);
}

export function analyzeReferenceStyleRecipes(representation?: MinimalDesignRepresentation | null): ReferenceStyleRecipeAnalysis {
    const elements = Array.isArray(representation?.elements) ? representation!.elements : [];
    const styledElements = elements.filter((element) => !!element.style);
    const hits: ReferenceStyleRecipeHit[] = [];

    for (const element of styledElements) {
        collectHitsForElement(element, element.style!, hits);
    }

    const plannedIds = new Set(
        hits
            .filter((hit) => hit.maturity === 'planned')
            .map((hit) => hit.recipeId)
    );
    const unsupportedEffects = Array.from(new Set(
        hits
            .filter((hit) => hit.maturity === 'unsupported')
            .map((hit) => hit.source)
    ));

    return {
        styledElementCount: styledElements.length,
        executableHitCount: hits.filter((hit) => isExecutableMaturity(hit.maturity)).length,
        plannedHitCount: hits.filter((hit) => hit.maturity === 'planned').length,
        unsupportedHitCount: hits.filter((hit) => hit.maturity === 'unsupported').length,
        hits,
        plannedRecipes: Array.from(plannedIds)
            .map((id) => RECIPE_BY_ID.get(id))
            .filter(Boolean) as ReferenceStyleRecipe[],
        unsupportedEffects
    };
}

export function buildReferenceStrokeRecipeExecutionPlan(
    style?: MinimalDesignElementStyle | null,
    _bounds?: { width?: number; height?: number } | null
): ReferenceStrokeRecipeExecutionPlan | null {
    if (!hasStrokeEffect(style)) {
        return null;
    }

    return {
        executable: false,
        recipeId: 'stroke',
        reason: style?.strokeColor
            ? '解析到 stroke 与颜色，但宽度、位置和透明度没有被真实测量；不使用内置描边配方。'
            : '解析到 stroke 效果，但缺少完整可执行参数；不使用内置描边配方。'
    };
}

export function buildReferenceShadowRecipeExecutionPlan(
    style?: MinimalDesignElementStyle | null,
    _bounds?: { width?: number; height?: number } | null
): ReferenceShadowRecipeExecutionPlan | null {
    if (!hasShadowEffect(style)) {
        return null;
    }

    if (hasStrokeEffect(style)) {
        return {
            executable: false,
            recipeId: 'shadow',
            reason: '解析到 shadow 效果，但同一图层同时包含 stroke；当前 UXP 图层样式合并未验证，先跳过 shadow 避免覆盖描边。'
        };
    }

    return {
        executable: false,
        recipeId: 'shadow',
        reason: '解析到 shadow 效果，但颜色、透明度、角度、距离、扩展和大小没有被真实测量；不使用内置阴影配方。'
    };
}

export function formatReferenceStyleRecipeAnalysisForQa(analysis: ReferenceStyleRecipeAnalysis): string[] {
    if (analysis.styledElementCount === 0) {
        return ['未解析到可用样式字段。'];
    }
    const lines = [
        `样式 recipe 命中：可执行/基础落地 ${analysis.executableHitCount} 项，已规划未执行 ${analysis.plannedHitCount} 项，不支持 ${analysis.unsupportedHitCount} 项。`
    ];
    if (analysis.plannedRecipes.length > 0) {
        lines.push(`待补 recipe：${analysis.plannedRecipes.map((recipe) => recipe.label).join(' / ')}`);
    }
    if (analysis.unsupportedEffects.length > 0) {
        lines.push(`未知效果：${analysis.unsupportedEffects.join(' / ')}`);
    }
    return lines;
}
