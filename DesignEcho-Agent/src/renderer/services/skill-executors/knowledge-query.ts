/**
 * 知识查询模块
 * 
 * 为技能执行器提供统一的知识检索接口。
 * 所有查询通过 IPC 调用主进程服务，执行器不直接持有知识数据。
 */

// ==================== 品牌规范 ====================

export interface BrandSpec {
    id: string;
    name: string;
    colors: {
        primary: string;
        secondary: string;
        accent: string;
        background: string[];
        text: string;
        forbidden: string[];
    };
    typography: {
        headlineFont: string;
        bodyFont: string;
        headlineSize: { min: number; max: number };
        bodySize: { min: number; max: number };
        labelSize: { min: number; max: number };
    };
    layout: {
        productRatio: { min: number; max: number };
        whitespaceStyle: string;
        alignment: string;
    };
    tone: string;
    platform: string;
    category: string;
    keywords: string[];
}

/**
 * 获取当前生效的品牌规范
 */
export async function getEffectiveBrandSpec(projectPath?: string): Promise<BrandSpec | null> {
    try {
        const result = await window.designEcho?.invoke?.('brand:getEffective', projectPath);
        if (result?.success && result.spec) {
            return result.spec as BrandSpec;
        }
    } catch (e) {
        console.warn('[KnowledgeQuery] 品牌规范获取失败:', e);
    }
    return null;
}

/**
 * 获取品牌规范的 Prompt 上下文
 */
export async function getBrandPromptContext(projectPath?: string): Promise<string> {
    try {
        const result = await window.designEcho?.invoke?.('brand:toPromptContext', projectPath);
        if (result?.success) return result.context || '';
    } catch { /* 非阻断 */ }
    return '';
}

// ==================== 主图规范 ====================

export interface MainImageSpec {
    imageType: string;
    designPrinciples: string[];
    dos: string[];
    donts: string[];
    productRatio?: { min: number; max: number };
    recommendedSections?: string[];
    requiredSections?: string[];
}

const MAIN_IMAGE_FALLBACK_SPEC: Record<string, MainImageSpec> = {
    click: {
        imageType: 'click',
        designPrinciples: [
            '优先建立第一眼点击动机',
            '每个图层组保持 文案/icon/图片 三层结构',
            '文案短句化，减少硬广词'
        ],
        dos: ['突出主利益点', '画面与文案可互相佐证', '保留可读留白'],
        donts: ['堆叠过多口号', '无证据夸张表达'],
        productRatio: { min: 0.58, max: 0.72 },
        recommendedSections: ['点击图-01', '点击图-02'],
        requiredSections: ['点击图-01']
    },
    conversion: {
        imageType: 'conversion',
        designPrinciples: [
            '优先解除用户顾虑并完成转化解释',
            '每个图层组保持 文案/icon/图片 三层结构',
            '每屏聚焦一个利益点'
        ],
        dos: ['材质面料必须覆盖', '核心卖点必须明确', '图文一一对应'],
        donts: ['泛泛而谈', '脱离画面的抽象口号'],
        productRatio: { min: 0.55, max: 0.7 },
        recommendedSections: ['材质面料', '核心卖点', '弹力/功能', '穿搭场景'],
        requiredSections: ['材质面料', '核心卖点']
    },
    'white-bg': {
        imageType: 'white-bg',
        designPrinciples: [
            '保持商品主体清晰完整',
            '弱化装饰，强调商品本体'
        ],
        dos: ['背景纯净', '主体边缘清楚'],
        donts: ['复杂背景干扰', '过度文案'],
        productRatio: { min: 0.62, max: 0.82 },
        recommendedSections: ['白底主图'],
        requiredSections: ['白底主图']
    }
};

/**
 * 根据图片类型获取主图设计规范
 */
export async function getMainImageSpec(
    imageType: string,
    platform?: string
): Promise<MainImageSpec | null> {
    try {
        const result = await window.designEcho?.invoke?.(
            'rag:search',
            {
                query: `${imageType} 主图设计规范 ${platform || ''}`,
                filters: { types: ['main_image_spec'] },
                limit: 3
            }
        );
        if (result?.success && (result.data?.entries?.length > 0 || result.results?.entries?.length > 0)) {
            const entry = (result.data?.entries || result.results?.entries || [])[0].entry;
            return entry.metadata?.extra as MainImageSpec || null;
        }
    } catch { /* 非阻断 */ }
    const key = String(imageType || '').toLowerCase();
    if (MAIN_IMAGE_FALLBACK_SPEC[key]) {
        return MAIN_IMAGE_FALLBACK_SPEC[key];
    }
    return MAIN_IMAGE_FALLBACK_SPEC.click;
}

// ==================== 文案公式 ====================

export interface CopywritingFormula {
    name: string;
    structure: string;
    examples: string[];
}

/**
 * 获取文案公式（痛点公式、对比公式、数据公式等）
 */
export async function getCopywritingFormulas(
    context?: string
): Promise<CopywritingFormula[]> {
    try {
        const result = await window.designEcho?.invoke?.(
            'rag:search',
            {
                query: `电商文案公式 ${context || '转化图'}`,
                filters: { types: ['copy_template'] },
                limit: 5
            }
        );
        if (result?.success && (result.data?.entries?.length > 0 || result.results?.entries?.length > 0)) {
            return (result.data?.entries || result.results?.entries || []).map((e: any) => ({
                name: e.entry.title || '',
                structure: e.entry.text || '',
                examples: e.entry.metadata?.extra?.examples || []
            }));
        }
    } catch { /* 非阻断 */ }
    return [];
}

// ==================== 场景知识 ====================

export interface SceneKnowledge {
    sceneName: string;
    requirements: string[];
    colorSuggestions: string[];
    copyAngle: string;
    stylingTips: string[];
}

/**
 * 根据产品类目获取场景知识
 */
export async function getSceneKnowledge(
    category?: string
): Promise<SceneKnowledge[]> {
    try {
        const result = await window.designEcho?.invoke?.(
            'rag:search',
            {
                query: `${category || '袜子'} 使用场景 穿搭知识`,
                filters: { types: ['scene_styling'] },
                limit: 5
            }
        );
        if (result?.success && (result.data?.entries?.length > 0 || result.results?.entries?.length > 0)) {
            return (result.data?.entries || result.results?.entries || []).map((e: any) => ({
                sceneName: e.entry.title || '',
                requirements: e.entry.metadata?.extra?.requirements || [],
                colorSuggestions: e.entry.metadata?.extra?.colorSuggestions || [],
                copyAngle: e.entry.metadata?.extra?.copyAngle || '',
                stylingTips: e.entry.metadata?.extra?.stylingTips || []
            }));
        }
    } catch { /* 非阻断 */ }
    return [];
}

// ==================== 详情页屏模板 ====================

export interface ScreenTemplate {
    type: string;
    name: string;
    purpose: string;
    contentTemplate: Record<string, string>;
    designTips: string[];
}

/**
 * 获取详情页屏内容模板
 */
export async function getScreenTemplates(
    screenType?: string
): Promise<ScreenTemplate[]> {
    try {
        const query = screenType
            ? `详情页 ${screenType} 屏模板 内容`
            : '详情页屏模板 内容结构';
        const result = await window.designEcho?.invoke?.(
            'rag:search',
            {
                query,
                filters: { types: ['detail_screen_template'] },
                limit: 5
            }
        );
        if (result?.success && (result.data?.entries?.length > 0 || result.results?.entries?.length > 0)) {
            return (result.data?.entries || result.results?.entries || []).map((e: any) => ({
                type: e.entry.metadata?.extra?.type || '',
                name: e.entry.title || '',
                purpose: e.entry.description || '',
                contentTemplate: e.entry.metadata?.extra?.contentTemplate || {},
                designTips: e.entry.metadata?.extra?.designTips || []
            }));
        }
    } catch { /* 非阻断 */ }
    return [];
}

// ==================== 平台规范 ====================

export interface PlatformRules {
    platform: string;
    rules: string[];
    sizes: Array<{ width: number; height: number; name: string }>;
}

/**
 * 获取目标平台的设计规则
 */
export async function getPlatformRules(platform: string): Promise<PlatformRules | null> {
    try {
        const result = await window.designEcho?.invoke?.(
            'rag:search',
            {
                query: `${platform} 平台规范 主图要求`,
                filters: { types: ['main_image_spec', 'layout_rule'] },
                limit: 3
            }
        );
        if (result?.success && (result.data?.entries?.length > 0 || result.results?.entries?.length > 0)) {
            const entry = (result.data?.entries || result.results?.entries || [])[0].entry;
            return {
                platform,
                rules: entry.metadata?.extra?.rules || [],
                sizes: entry.metadata?.extra?.sizes || []
            };
        }
    } catch { /* 非阻断 */ }
    return null;
}
