/**
 * 审美决策服务 - 渲染进程接口
 * 
 * 提供审美知识库查询和 AI 审美决策能力
 * 通过 IPC 调用主进程的服务
 */

// ==================== 类型定义 ====================

export type DesignType = 
    | 'mainImage'
    | 'detailHero'
    | 'detailSection'
    | 'skuImage'
    | 'colorShowcase'
    | 'banner'
    | 'custom';

export type DesignStyle = 
    | 'minimal'
    | 'rich'
    | 'elegant'
    | 'dynamic'
    | 'natural'
    | 'premium'
    | 'playful';

export interface AestheticReference {
    id: string;
    name: string;
    description: string;
    designType: DesignType;
    style: DesignStyle;
    visualParams: {
        subjectRatio: { min: number; ideal: number; max: number };
        position: {
            vertical: string;
            horizontal: string;
            offsetX?: number;
            offsetY?: number;
        };
        whitespace: { top: number; bottom: number; left: number; right: number };
    };
    principles: string[];
    applicableScenarios: string[];
    avoidScenarios: string[];
    weight: number;
}

export interface LayoutKnowledge {
    id: string;
    type: string;
    title: string;
    description: string;
    guidance: string[];
    applicableTypes: DesignType[];
    keywords: string[];
}

export interface ColorKnowledge {
    id: string;
    name: string;
    type: string;
    primaryColors: string[];
    accentColors: string[];
    mood: string[];
    suitableFor: string[];
    guidelines: string[];
}

export interface TypographyKnowledge {
    id: string;
    purpose: string;
    fontFamilies: string[];
    fontSize: { min: number; ideal: number; max: number; unit: string };
    lineHeight: number;
    fontWeight: string;
    applicableTypes: DesignType[];
    guidelines: string[];
}

export interface AestheticDecisionRequest {
    designType: DesignType;
    canvas: {
        width: number;
        height: number;
        existingElements?: Array<{
            type: string;
            bounds: { x: number; y: number; width: number; height: number };
        }>;
    };
    asset: {
        id: string;
        width: number;
        height: number;
        subjectBounds?: { x: number; y: number; width: number; height: number };
        visualCenter?: { x: number; y: number };
    };
    userIntent?: string;
    sellingPoints?: string[];
    preferredStyle?: DesignStyle;
}

export interface AestheticDecisionResult {
    success: boolean;
    confidence: number;
    scale: number;
    position: {
        x: number;
        y: number;
        anchor: 'center' | 'topLeft' | 'bottomCenter';
    };
    reason: string;
    referencedKnowledge: string[];
    alternatives?: Array<{
        scale: number;
        position: { x: number; y: number };
        reason: string;
    }>;
    processingTime: number;
}

// ==================== IPC 调用封装 ====================

/**
 * 初始化审美知识库
 */
export async function initializeAestheticService(): Promise<boolean> {
    try {
        const result = await window.electronAPI.invoke('aesthetic:initialize');
        return result.success;
    } catch (error) {
        console.error('[AestheticService] 初始化失败:', error);
        return false;
    }
}

/**
 * 获取设计类型的审美参考
 */
export async function getAestheticReferences(
    designType: DesignType,
    style?: DesignStyle
): Promise<AestheticReference[]> {
    try {
        const result = await window.electronAPI.invoke('aesthetic:getReferences', { designType, style });
        return result.success ? result.references : [];
    } catch (error) {
        console.error('[AestheticService] getReferences 失败:', error);
        return [];
    }
}

/**
 * 获取布局知识
 */
export async function getLayoutKnowledge(
    designType?: DesignType,
    keywords?: string[]
): Promise<LayoutKnowledge[]> {
    try {
        const result = await window.electronAPI.invoke('aesthetic:getLayoutKnowledge', { designType, keywords });
        return result.success ? result.knowledge : [];
    } catch (error) {
        console.error('[AestheticService] getLayoutKnowledge 失败:', error);
        return [];
    }
}

/**
 * 获取配色知识
 */
export async function getColorKnowledge(scenario?: string): Promise<ColorKnowledge[]> {
    try {
        const result = await window.electronAPI.invoke('aesthetic:getColorKnowledge', scenario);
        return result.success ? result.knowledge : [];
    } catch (error) {
        console.error('[AestheticService] getColorKnowledge 失败:', error);
        return [];
    }
}

/**
 * 获取字体知识
 */
export async function getTypographyKnowledge(
    purpose?: 'headline' | 'body' | 'accent' | 'label',
    designType?: DesignType
): Promise<TypographyKnowledge[]> {
    try {
        const result = await window.electronAPI.invoke('aesthetic:getTypographyKnowledge', { purpose, designType });
        return result.success ? result.knowledge : [];
    } catch (error) {
        console.error('[AestheticService] getTypographyKnowledge 失败:', error);
        return [];
    }
}

/**
 * 生成知识上下文（供 AI 使用）
 */
export async function generateKnowledgeContext(
    designType: DesignType,
    style?: DesignStyle
): Promise<string> {
    try {
        const result = await window.electronAPI.invoke('aesthetic:generateKnowledgeContext', { designType, style });
        return result.success ? result.context : '';
    } catch (error) {
        console.error('[AestheticService] generateKnowledgeContext 失败:', error);
        return '';
    }
}

/**
 * 执行审美决策
 */
export async function makeAestheticDecision(
    request: AestheticDecisionRequest
): Promise<AestheticDecisionResult> {
    try {
        const result = await window.electronAPI.invoke('aesthetic:makeDecision', request);
        return result.result;
    } catch (error) {
        console.error('[AestheticService] makeDecision 失败:', error);
        return {
            success: false,
            confidence: 0,
            scale: 1,
            position: { x: 0, y: 0, anchor: 'center' },
            reason: '决策失败',
            referencedKnowledge: [],
            processingTime: 0
        };
    }
}

/**
 * 批量审美决策
 */
export async function makeMultipleAestheticDecisions(
    requests: AestheticDecisionRequest[]
): Promise<AestheticDecisionResult[]> {
    try {
        const result = await window.electronAPI.invoke('aesthetic:makeMultipleDecisions', requests);
        return result.success ? result.results : [];
    } catch (error) {
        console.error('[AestheticService] makeMultipleDecisions 失败:', error);
        return [];
    }
}

/**
 * 生成决策提示词（供 Agent 使用）
 */
export async function generateDecisionPrompt(params: {
    designType: DesignType;
    canvasSize: { width: number; height: number };
    assetInfo: { width: number; height: number; subjectRatio?: number };
    userIntent?: string;
}): Promise<string> {
    try {
        const result = await window.electronAPI.invoke('aesthetic:generateDecisionPrompt', params);
        return result.success ? result.prompt : '';
    } catch (error) {
        console.error('[AestheticService] generateDecisionPrompt 失败:', error);
        return '';
    }
}

/**
 * 获取知识库统计信息
 */
export async function getAestheticStatistics(): Promise<{
    references: number;
    layoutKnowledge: number;
    colorKnowledge: number;
    typographyKnowledge: number;
    productAssets: number;
} | null> {
    try {
        const result = await window.electronAPI.invoke('aesthetic:getStatistics');
        return result.success ? result.stats : null;
    } catch (error) {
        console.error('[AestheticService] getStatistics 失败:', error);
        return null;
    }
}

// ==================== 智能设计决策辅助函数 ====================

/**
 * 判断是否应该自动执行
 * @param result 决策结果
 * @param threshold 置信度阈值（默认 0.8）
 */
export function shouldAutoExecute(result: AestheticDecisionResult, threshold = 0.8): boolean {
    return result.success && result.confidence >= threshold;
}

/**
 * 判断是否需要用户确认
 * @param result 决策结果
 * @param lowThreshold 低置信度阈值（默认 0.5）
 */
export function needsUserConfirmation(result: AestheticDecisionResult, lowThreshold = 0.5): boolean {
    return result.success && result.confidence < lowThreshold;
}

/**
 * 根据画布尺寸自动推断设计类型
 */
export function inferDesignType(width: number, height: number): DesignType {
    const ratio = width / height;
    
    // 正方形 → 主图或 SKU
    if (ratio > 0.95 && ratio < 1.05) {
        return width >= 600 ? 'mainImage' : 'skuImage';
    }
    
    // 竖版 → 详情页
    if (ratio < 0.9) {
        return 'detailHero';
    }
    
    // 横版 → Banner 或颜色展示
    if (ratio > 1.5) {
        return ratio > 2.5 ? 'banner' : 'colorShowcase';
    }
    
    return 'mainImage';
}

/**
 * 快速获取推荐的主体占比
 */
export async function getRecommendedSubjectRatio(designType: DesignType): Promise<{
    min: number;
    ideal: number;
    max: number;
}> {
    const references = await getAestheticReferences(designType);
    
    if (references.length > 0) {
        // 使用权重最高的参考
        const primaryRef = references[0];
        return primaryRef.visualParams.subjectRatio;
    }
    
    // 默认值
    const defaults: Record<DesignType, { min: number; ideal: number; max: number }> = {
        mainImage: { min: 0.55, ideal: 0.65, max: 0.75 },
        detailHero: { min: 0.40, ideal: 0.50, max: 0.60 },
        detailSection: { min: 0.50, ideal: 0.60, max: 0.70 },
        skuImage: { min: 0.75, ideal: 0.82, max: 0.90 },
        colorShowcase: { min: 0.18, ideal: 0.22, max: 0.28 },
        banner: { min: 0.30, ideal: 0.40, max: 0.50 },
        custom: { min: 0.50, ideal: 0.65, max: 0.80 }
    };
    
    return defaults[designType] || defaults.custom;
}

// ==================== 趋势感知服务 ====================

/**
 * 趋势信息
 */
export interface TrendInfo {
    name: string;
    type: 'style' | 'color' | 'layout' | 'typography' | 'technique';
    popularity: number;
    lifecycle: 'emerging' | 'growing' | 'peak' | 'declining' | 'outdated';
    description: string;
    keywords: string[];
}

/**
 * 趋势洞察
 */
export interface TrendInsight {
    currentTrends: {
        styles: TrendInfo[];
        colors: TrendInfo[];
        layouts: TrendInfo[];
        typography: TrendInfo[];
    };
    differentiationSuggestions: string[];
    avoidTrends: TrendInfo[];
    emergingTrends: TrendInfo[];
    lastUpdated: string;
}

/**
 * 初始化趋势服务
 */
export async function initializeTrendService(): Promise<boolean> {
    try {
        const result = await window.electronAPI.invoke('trend:initialize');
        return result.success;
    } catch (error) {
        console.error('[TrendService] 初始化失败:', error);
        return false;
    }
}

/**
 * 设置搜索 API Key
 */
export async function setTrendApiKey(provider: 'tavily' | 'serpapi', apiKey: string): Promise<boolean> {
    try {
        const result = await window.electronAPI.invoke('trend:setApiKey', { provider, apiKey });
        return result.success;
    } catch (error) {
        console.error('[TrendService] 设置 API Key 失败:', error);
        return false;
    }
}

/**
 * 获取当前设计趋势
 */
export async function getCurrentTrends(forceRefresh: boolean = false): Promise<TrendInsight | null> {
    try {
        const result = await window.electronAPI.invoke('trend:getCurrentTrends', forceRefresh);
        return result.success ? result.trends : null;
    } catch (error) {
        console.error('[TrendService] getCurrentTrends 失败:', error);
        return null;
    }
}

/**
 * 搜索设计趋势
 */
export async function searchDesignTrends(query: string): Promise<Array<{
    title: string;
    url: string;
    snippet: string;
    source: string;
}>> {
    try {
        const result = await window.electronAPI.invoke('trend:search', query);
        return result.success ? result.results : [];
    } catch (error) {
        console.error('[TrendService] searchDesignTrends 失败:', error);
        return [];
    }
}

/**
 * 检测设计是否过时
 */
export async function checkIfDesignOutdated(designFeatures: {
    style?: string;
    colors?: string[];
    layout?: string;
}): Promise<{
    isOutdated: boolean;
    reasons: string[];
    suggestions: string[];
} | null> {
    try {
        const result = await window.electronAPI.invoke('trend:checkIfOutdated', designFeatures);
        return result.success ? result.result : null;
    } catch (error) {
        console.error('[TrendService] checkIfOutdated 失败:', error);
        return null;
    }
}

// ==================== VLM 审美分析服务 ====================

/**
 * 设计分析请求
 */
export interface DesignAnalysisRequest {
    imageBase64: string;
    designType?: DesignType;
    depth: 'quick' | 'standard' | 'deep';
    aspects: ('strengths' | 'implementation' | 'improvements' | 'trends')[];
    context?: string;
}

/**
 * 设计分析结果
 */
export interface DesignAnalysisResult {
    success: boolean;
    detectedType?: DesignType;
    detectedStyle?: DesignStyle;
    strengths: Array<{
        aspect: string;
        description: string;
        principle: string;
    }>;
    implementation: Array<{
        technique: string;
        details: string;
        canReplicate: boolean;
    }>;
    improvements: Array<{
        area: string;
        currentIssue: string;
        suggestion: string;
        priority: 'high' | 'medium' | 'low';
    }>;
    trendAssessment: {
        isOutdated: boolean;
        isFollowingTrend: boolean;
        uniqueness: number;
        marketFit: number;
        assessment: string;
    };
    overallScore: number;
    summary: string;
    modelUsed: string;
    processingTime: number;
    error?: string;
}

/**
 * 自我验证结果
 */
export interface SelfValidationResult {
    passed: boolean;
    confidence: number;
    decision: any;
    reasoning: {
        referencedCases: string[];
        appliedPrinciples: string[];
        trendConsideration: string;
        differentiationStrategy: string;
    };
    scores: {
        aesthetics: number;
        marketFit: number;
        uniqueness: number;
        userAcceptance: number;
    };
    needsConfirmation: boolean;
}

/**
 * 初始化 VLM 服务
 */
export async function initializeVLMService(): Promise<boolean> {
    try {
        const result = await window.electronAPI.invoke('vlm:initialize');
        return result.success;
    } catch (error) {
        console.error('[VLMService] 初始化失败:', error);
        return false;
    }
}

/**
 * 设置视觉模型
 */
export async function setVisionModel(modelId: string): Promise<boolean> {
    try {
        const result = await window.electronAPI.invoke('vlm:setVisionModel', modelId);
        return result.success;
    } catch (error) {
        console.error('[VLMService] setVisionModel 失败:', error);
        return false;
    }
}

/**
 * 分析设计图片
 */
export async function analyzeDesign(request: DesignAnalysisRequest): Promise<DesignAnalysisResult> {
    try {
        const result = await window.electronAPI.invoke('vlm:analyzeDesign', request);
        return result.success ? result.result : {
            success: false,
            strengths: [],
            implementation: [],
            improvements: [],
            trendAssessment: {
                isOutdated: false,
                isFollowingTrend: false,
                uniqueness: 0,
                marketFit: 0,
                assessment: '分析失败'
            },
            overallScore: 0,
            summary: '分析失败',
            modelUsed: 'unknown',
            processingTime: 0,
            error: result.error
        };
    } catch (error: any) {
        console.error('[VLMService] analyzeDesign 失败:', error);
        return {
            success: false,
            strengths: [],
            implementation: [],
            improvements: [],
            trendAssessment: {
                isOutdated: false,
                isFollowingTrend: false,
                uniqueness: 0,
                marketFit: 0,
                assessment: '分析失败'
            },
            overallScore: 0,
            summary: error.message || '分析失败',
            modelUsed: 'unknown',
            processingTime: 0,
            error: error.message
        };
    }
}

/**
 * 验证设计决策
 */
export async function validateDecision(params: {
    decision: any;
    designType: DesignType;
    context?: string;
    currentDesignImage?: string;
}): Promise<SelfValidationResult | null> {
    try {
        const result = await window.electronAPI.invoke('vlm:validateDecision', params);
        return result.success ? result.result : null;
    } catch (error) {
        console.error('[VLMService] validateDecision 失败:', error);
        return null;
    }
}

/**
 * 对比两个设计
 */
export async function compareDesigns(params: {
    imageA: string;
    imageB: string;
    criteria?: ('aesthetics' | 'uniqueness' | 'marketFit')[];
}): Promise<{
    winner: 'A' | 'B' | 'tie';
    analysis: {
        designA: { score: number; strengths: string[]; weaknesses: string[] };
        designB: { score: number; strengths: string[]; weaknesses: string[] };
    };
    reasoning: string;
} | null> {
    try {
        const result = await window.electronAPI.invoke('vlm:compareDesigns', params);
        return result.success ? result.result : null;
    } catch (error) {
        console.error('[VLMService] compareDesigns 失败:', error);
        return null;
    }
}

// ==================== 用户标记"好设计"功能 ====================

/**
 * 标记好设计
 */
export async function markAsGoodDesign(params: {
    imageBase64: string;
    designType: DesignType;
    style?: DesignStyle;
    reason?: string;
    tags?: string[];
}): Promise<boolean> {
    try {
        const result = await window.electronAPI.invoke('aesthetic:markGoodDesign', params);
        return result.success;
    } catch (error) {
        console.error('[AestheticService] markAsGoodDesign 失败:', error);
        return false;
    }
}

/**
 * 获取用户标记的好设计
 */
export async function getUserMarkedDesigns(params?: {
    designType?: DesignType;
    style?: DesignStyle;
    limit?: number;
}): Promise<Array<{
    id: string;
    imageBase64: string;
    designType: DesignType;
    style?: DesignStyle;
    reason?: string;
    tags: string[];
    markedAt: string;
}>> {
    try {
        const result = await window.electronAPI.invoke('aesthetic:getUserMarkedDesigns', params);
        return result.success ? result.designs : [];
    } catch (error) {
        console.error('[AestheticService] getUserMarkedDesigns 失败:', error);
        return [];
    }
}
