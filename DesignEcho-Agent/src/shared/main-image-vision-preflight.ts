import type { MainImageVisionSignal } from './main-image-visual-loop';

export type MainImageVisionPreflightStatus =
    | 'disabled'
    | 'skipped_no_asset'
    | 'blocked_no_analyzer'
    | 'ready_to_call'
    | 'succeeded'
    | 'failed';

export interface MainImageVisionPreflightPlan {
    status: MainImageVisionPreflightStatus;
    enabled: boolean;
    shouldCallAnalyzer: boolean;
    assetPath?: string;
    assetName?: string;
    reason: string;
    warnings: string[];
    limitations: string[];
}

export interface MainImageAssetAnalysisPayload {
    success?: boolean;
    analysis?: {
        description?: string;
        category?: string;
        mainSubject?: string;
        colors?: string[];
        style?: string;
        suggestedPlacement?: string;
        suggestedEffects?: string[];
    };
    error?: string;
}

export interface MainImageVisionPreflightEvidence extends MainImageVisionPreflightPlan {
    resultStatus: MainImageVisionPreflightStatus;
    visionSignal?: MainImageVisionSignal;
    error?: string;
}

function cleanString(value: unknown): string {
    return String(value || '').trim();
}

function cleanList(value: unknown): string[] {
    return Array.isArray(value)
        ? value.map(cleanString).filter(Boolean)
        : [];
}

export function isMainImageVisionPreflightEnabled(value: unknown): boolean {
    if (value === true) return true;
    const text = cleanString(value).toLowerCase();
    return ['true', '1', 'yes', 'on', 'enabled', 'auto', 'required'].includes(text);
}

export function buildMainImageVisionPreflightPlan(input: {
    enabled?: unknown;
    selectedAssetPath?: string | null;
    selectedAssetName?: string | null;
    hasAnalyzer?: boolean;
}): MainImageVisionPreflightPlan {
    const enabled = isMainImageVisionPreflightEnabled(input.enabled);
    const assetPath = cleanString(input.selectedAssetPath);
    const assetName = cleanString(input.selectedAssetName) || (assetPath ? assetPath.split(/[\\/]/).pop() : '');
    const hasAnalyzer = input.hasAnalyzer !== false;
    const limitations = [
        '视觉预检只把现有素材分析结果转成 visionSignal，不改变 Photoshop 执行参数。',
        '未显式开启时不会调用视觉模型，避免隐藏费用和等待时间。',
        '视觉预检成功也不等于主图设计质量通过，仍需要截图和人工复核。'
    ];

    if (!enabled) {
        return {
            status: 'disabled',
            enabled,
            shouldCallAnalyzer: false,
            assetPath: assetPath || undefined,
            assetName: assetName || undefined,
            reason: '未显式启用主图视觉预检，保持 metadata-only 证据边界。',
            warnings: ['主图素材尚未经过视觉模型理解。'],
            limitations
        };
    }

    if (!assetPath) {
        return {
            status: 'skipped_no_asset',
            enabled,
            shouldCallAnalyzer: false,
            assetName: assetName || undefined,
            reason: '已请求视觉预检，但没有可分析的项目图片路径。',
            warnings: ['缺少 selectedProjectImagePath 或显式 imagePath。'],
            limitations
        };
    }

    if (!hasAnalyzer) {
        return {
            status: 'blocked_no_analyzer',
            enabled,
            shouldCallAnalyzer: false,
            assetPath,
            assetName: assetName || undefined,
            reason: '已请求视觉预检，但当前运行环境没有 analyzeAssetContent 能力。',
            warnings: ['缺少 renderer preload 暴露的 analyzeAssetContent。'],
            limitations
        };
    }

    return {
        status: 'ready_to_call',
        enabled,
        shouldCallAnalyzer: true,
        assetPath,
        assetName: assetName || undefined,
        reason: '已显式启用主图视觉预检，且存在可分析的项目图片。',
        warnings: [],
        limitations
    };
}

export function mapMainImageAssetAnalysisToVisionSignal(
    payload: MainImageAssetAnalysisPayload | null | undefined
): MainImageVisionSignal | null {
    if (!payload?.success || !payload.analysis) return null;
    const analysis = payload.analysis;
    const description = cleanString(analysis.description);
    const category = cleanString(analysis.category);
    const mainSubject = cleanString(analysis.mainSubject);
    const style = cleanString(analysis.style);
    const colors = cleanList(analysis.colors);
    const suggestedEffects = cleanList(analysis.suggestedEffects);
    const suggestedPlacement = cleanString(analysis.suggestedPlacement);
    const productType = mainSubject || description || category;
    const evidence = [
        description ? `description=${description}` : '',
        category ? `category=${category}` : '',
        mainSubject ? `mainSubject=${mainSubject}` : '',
        colors.length ? `colors=${colors.slice(0, 5).join(',')}` : '',
        style ? `style=${style}` : '',
        suggestedPlacement ? `suggestedPlacement=${suggestedPlacement}` : '',
        suggestedEffects.length ? `suggestedEffects=${suggestedEffects.slice(0, 5).join(',')}` : ''
    ].filter(Boolean);

    return {
        source: 'vision-model',
        productType: productType || 'unknown',
        subjectSummary: description || mainSubject || '视觉模型返回了素材分析，但主体描述不完整。',
        backgroundSummary: suggestedPlacement || category || 'unknown',
        sceneSummary: suggestedPlacement || undefined,
        styleHints: [
            style,
            ...colors.slice(0, 4),
            ...suggestedEffects.slice(0, 4)
        ].filter(Boolean),
        risks: productType ? [] : ['视觉模型未返回明确 mainSubject / description / category。'],
        evidence
    };
}

export function buildMainImageVisionPreflightEvidence(input: {
    plan: MainImageVisionPreflightPlan;
    result?: MainImageAssetAnalysisPayload | null;
    error?: unknown;
}): MainImageVisionPreflightEvidence {
    const errorText = cleanString(input.error)
        || cleanString(input.result?.error);
    const visionSignal = mapMainImageAssetAnalysisToVisionSignal(input.result);

    if (!input.plan.shouldCallAnalyzer) {
        return {
            ...input.plan,
            resultStatus: input.plan.status
        };
    }

    if (visionSignal) {
        return {
            ...input.plan,
            status: 'succeeded',
            resultStatus: 'succeeded',
            shouldCallAnalyzer: false,
            reason: '视觉预检已返回可映射的素材理解结果。',
            visionSignal
        };
    }

    return {
        ...input.plan,
        status: 'failed',
        resultStatus: 'failed',
        shouldCallAnalyzer: false,
        reason: '视觉预检已执行，但没有得到可用 visionSignal。',
        error: errorText || 'No usable asset analysis result',
        warnings: [
            ...input.plan.warnings,
            errorText || 'analyzeAssetContent 未返回 success=true 和 analysis。'
        ]
    };
}
