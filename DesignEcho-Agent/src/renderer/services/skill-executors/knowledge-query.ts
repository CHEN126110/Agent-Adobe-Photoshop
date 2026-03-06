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

export interface MainImageSpec {
    imageType: string;
    designPrinciples: string[];
    dos: string[];
    donts: string[];
    productRatio?: { min: number; max: number };
    recommendedSections?: string[];
    requiredSections?: string[];
}

export interface CopywritingFormula {
    name: string;
    structure: string;
    examples: string[];
}

export interface SceneKnowledge {
    sceneName: string;
    requirements: string[];
    colorSuggestions: string[];
    copyAngle: string;
    stylingTips: string[];
}

export interface ScreenTemplate {
    type: string;
    name: string;
    purpose: string;
    contentTemplate: Record<string, string>;
    designTips: string[];
}

export interface PlatformRules {
    platform: string;
    rules: string[];
    sizes: Array<{ width: number; height: number; name: string }>;
}

const MAIN_IMAGE_FALLBACK_SPEC: Record<string, MainImageSpec> = {
    click: {
        imageType: 'click',
        designPrinciples: [
            '优先建立第一眼点击动机',
            '文案、图像和卖点要一一对应',
            '保持短句表达和清晰留白'
        ],
        dos: ['突出核心利益点', '保留主体识别度', '让画面能证明文案'],
        donts: ['堆砌口号', '过度装饰', '使用无证据夸张描述'],
        productRatio: { min: 0.58, max: 0.72 },
        recommendedSections: ['点击图 01', '点击图 02'],
        requiredSections: ['点击图 01']
    },
    conversion: {
        imageType: 'conversion',
        designPrinciples: [
            '优先消除顾虑并强化购买理由',
            '每屏聚焦一个卖点',
            '图文关系必须明确'
        ],
        dos: ['覆盖材质和功能', '明确对比结果', '用场景辅助转化'],
        donts: ['泛泛而谈', '脱离画面空喊卖点'],
        productRatio: { min: 0.55, max: 0.7 },
        recommendedSections: ['材质面料', '核心卖点', '弹力功能', '穿搭场景'],
        requiredSections: ['材质面料', '核心卖点']
    },
    'white-bg': {
        imageType: 'white-bg',
        designPrinciples: ['保持商品主体完整清晰', '弱化装饰，强调商品本体'],
        dos: ['背景纯净', '边缘干净', '信息克制'],
        donts: ['复杂背景', '大段文案'],
        productRatio: { min: 0.62, max: 0.82 },
        recommendedSections: ['白底主图'],
        requiredSections: ['白底主图']
    }
};

const COPYWRITING_FORMULAS: CopywritingFormula[] = [
    {
        name: '利益点直述',
        structure: '核心利益 + 使用场景 + 轻量证明',
        examples: ['久站不勒脚，通勤一整天也轻松', '抬脚更贴合，运动和日常都更舒服']
    },
    {
        name: '痛点解决',
        structure: '常见痛点 + 解决方式 + 结果感受',
        examples: ['告别闷热黏脚，透气织法让双脚更清爽', '不易滑落卷边，走路跑跳都更稳']
    },
    {
        name: '场景带入',
        structure: '使用场景 + 卖点 + 情绪感受',
        examples: ['通勤配皮鞋也不臃肿，干净利落更显质感', '运动出汗后依然干爽，步伐更轻快']
    }
];

const SCENE_KNOWLEDGE: SceneKnowledge[] = [
    {
        sceneName: '通勤',
        requirements: ['清爽', '稳定', '不勒脚'],
        colorSuggestions: ['中性色', '低饱和蓝', '米白'],
        copyAngle: '强调全天舒适和搭配稳定性',
        stylingTips: ['搭配皮鞋或乐福鞋', '文案克制专业']
    },
    {
        sceneName: '运动',
        requirements: ['透气', '包裹', '弹力'],
        colorSuggestions: ['亮色点缀', '黑白对比', '荧光局部'],
        copyAngle: '强调动态包裹和排汗体验',
        stylingTips: ['用动作图增强感受', '突出脚踝和袜口细节']
    },
    {
        sceneName: '日常休闲',
        requirements: ['柔软', '百搭', '轻松'],
        colorSuggestions: ['奶油色', '雾灰', '浅卡其'],
        copyAngle: '强调轻松穿搭和日常耐穿',
        stylingTips: ['场景图适合生活化', '保持文案短句']
    }
];

const SCREEN_TEMPLATES: ScreenTemplate[] = [
    {
        type: 'C_核心卖点',
        name: '核心卖点屏',
        purpose: '集中表达一个最关键卖点',
        contentTemplate: { headline: '核心卖点', subhead: '轻量证明', body: '使用结果' },
        designTips: ['大标题只讲一件事', '辅图用特写证明卖点']
    },
    {
        type: 'G_面料',
        name: '面料说明屏',
        purpose: '说明面料质感、成分和触感',
        contentTemplate: { headline: '面料特性', body: '成分与体验描述' },
        designTips: ['优先使用细节特写', '避免抽象描述']
    },
    {
        type: 'I_穿搭推荐',
        name: '场景穿搭屏',
        purpose: '把商品放进真实场景',
        contentTemplate: { headline: '穿搭场景', body: '场景收益与风格' },
        designTips: ['场景优先于装饰', '人物或鞋款要服务主体']
    }
];

const PLATFORM_RULES: Record<string, PlatformRules> = {
    taobao: {
        platform: 'taobao',
        rules: ['主图信息要聚焦', '首屏避免信息过密', '卖点需要快速识别'],
        sizes: [{ width: 800, height: 800, name: '主图方图' }]
    },
    tmall: {
        platform: 'tmall',
        rules: ['强调品质感和品牌秩序', '避免过度促销化堆叠'],
        sizes: [{ width: 800, height: 800, name: '主图方图' }]
    },
    jd: {
        platform: 'jd',
        rules: ['强调卖点直接和利益点清晰', '主体边缘和白底质量要稳定'],
        sizes: [{ width: 800, height: 800, name: '主图方图' }]
    }
};

export async function getEffectiveBrandSpec(projectPath?: string): Promise<BrandSpec | null> {
    try {
        const result = await window.designEcho?.invoke?.('brand:getEffective', projectPath);
        if (result?.success && result.spec) {
            return result.spec as BrandSpec;
        }
    } catch (error) {
        console.warn('[KnowledgeQuery] Failed to load brand spec:', error);
    }
    return null;
}

export async function getBrandPromptContext(projectPath?: string): Promise<string> {
    try {
        const result = await window.designEcho?.invoke?.('brand:toPromptContext', projectPath);
        if (result?.success) return result.context || '';
    } catch {
        // ignore
    }
    return '';
}

export async function getMainImageSpec(imageType: string, _platform?: string): Promise<MainImageSpec | null> {
    const key = String(imageType || '').toLowerCase();
    return MAIN_IMAGE_FALLBACK_SPEC[key] || MAIN_IMAGE_FALLBACK_SPEC.click;
}

export async function getCopywritingFormulas(_context?: string): Promise<CopywritingFormula[]> {
    return COPYWRITING_FORMULAS;
}

export async function getSceneKnowledge(category?: string): Promise<SceneKnowledge[]> {
    if (!category) return SCENE_KNOWLEDGE;
    const lowerCategory = String(category).toLowerCase();
    if (lowerCategory.includes('袜')) return SCENE_KNOWLEDGE;
    return SCENE_KNOWLEDGE.slice(0, 2);
}

export async function getScreenTemplates(screenType?: string): Promise<ScreenTemplate[]> {
    if (!screenType) return SCREEN_TEMPLATES;
    return SCREEN_TEMPLATES.filter((template) => template.type === screenType);
}

export async function getPlatformRules(platform: string): Promise<PlatformRules | null> {
    const key = String(platform || '').toLowerCase();
    return PLATFORM_RULES[key] || null;
}
