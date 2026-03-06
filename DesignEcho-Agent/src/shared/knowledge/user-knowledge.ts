/**
 * 用户自定义知识库
 * 
 * 支持用户导入和管理自己的知识内容
 */

// ===== 类型定义 =====

/** 用户自定义卖点 */
export interface UserSellingPoint {
    id: string;
    title: string;
    description: string;
    detail?: string;
    categories?: string[];
    keywords?: string[];
    priority?: number;
    createdAt: string;
    updatedAt: string;
    source?: 'manual' | 'import' | 'ai_extract';
}

/** 用户自定义痛点 */
export interface UserPainPoint {
    id: string;
    title: string;
    scenario: string;
    userVoice?: string;
    solutionTitle: string;
    solutionDescription?: string;
    categories?: string[];
    createdAt: string;
    updatedAt: string;
    source?: 'manual' | 'import' | 'ai_extract';
}

/** 用户自定义文案模板 */
export interface UserCopyTemplate {
    id: string;
    name: string;
    /** 文案类型：标题/副标题/卖点标签/促销文案/详情描述 */
    type: 'title' | 'subtitle' | 'tag' | 'promo' | 'description' | 'other';
    /** 文案内容（支持变量占位符 {{变量名}}） */
    content: string;
    /** 变量说明 */
    variables?: Array<{
        name: string;
        description: string;
        example: string;
    }>;
    /** 适用类目 */
    categories?: string[];
    /** 适用场景 */
    scenes?: string[];
    createdAt: string;
    updatedAt: string;
    source?: 'manual' | 'import' | 'ai_extract';
}

/** 用户自定义配色 */
export interface UserColorScheme {
    id: string;
    name: string;
    description?: string;
    primary: string;
    secondary?: string;
    accent?: string;
    background?: string;
    text?: string;
    palette?: string[];
    createdAt: string;
    updatedAt: string;
    source?: 'manual' | 'import' | 'eyedropper';
}

/** 用户知识库 */
export interface UserKnowledge {
    version: string;
    lastUpdated: string;
    sellingPoints: UserSellingPoint[];
    painPoints: UserPainPoint[];
    copyTemplates: UserCopyTemplate[];
    colorSchemes: UserColorScheme[];
    /** 用户自定义关键词词库 */
    keywords: {
        [category: string]: string[];
    };
    /** 历史使用记录（用于智能推荐） */
    usageHistory: {
        sellingPointIds: string[];
        copyTemplateIds: string[];
        colorSchemeIds: string[];
    };
}

/** 导入格式 */
export interface ImportFormat {
    type: 'selling_points' | 'pain_points' | 'copy_templates' | 'color_schemes' | 'mixed';
    format: 'json' | 'csv';
    data: unknown;
}

/** 导入结果 */
export interface ImportResult {
    success: boolean;
    imported: number;
    skipped: number;
    errors: Array<{ row: number; message: string }>;
}

// ===== 默认空知识库 =====

export const EMPTY_USER_KNOWLEDGE: UserKnowledge = {
    version: '1.0',
    lastUpdated: new Date().toISOString(),
    sellingPoints: [],
    painPoints: [],
    copyTemplates: [],
    colorSchemes: [],
    keywords: {},
    usageHistory: {
        sellingPointIds: [],
        copyTemplateIds: [],
        colorSchemeIds: []
    }
};

// ===== CSV 解析工具 =====

/**
 * 简单 CSV 解析（支持带引号的字段）
 */
export function parseCSV(csvText: string): string[][] {
    const lines = csvText.trim().split('\n');
    const result: string[][] = [];
    
    for (const line of lines) {
        const row: string[] = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            
            if (char === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                row.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        row.push(current.trim());
        result.push(row);
    }
    
    return result;
}

// ===== 导入解析器 =====

/**
 * 从 CSV 导入卖点
 * 
 * CSV 格式：标题,描述,详情,类目(逗号分隔),关键词(逗号分隔),优先级
 */
export function importSellingPointsFromCSV(csvText: string): ImportResult {
    const rows = parseCSV(csvText);
    const result: ImportResult = {
        success: true,
        imported: 0,
        skipped: 0,
        errors: []
    };
    
    // 跳过标题行
    const dataRows = rows.slice(1);
    const imported: UserSellingPoint[] = [];
    
    dataRows.forEach((row, index) => {
        if (row.length < 2) {
            result.errors.push({ row: index + 2, message: '列数不足，至少需要标题和描述' });
            result.skipped++;
            return;
        }
        
        const [title, description, detail, categories, keywords, priority] = row;
        
        if (!title || !description) {
            result.errors.push({ row: index + 2, message: '标题或描述为空' });
            result.skipped++;
            return;
        }
        
        imported.push({
            id: `user-sp-${Date.now()}-${index}`,
            title: title.trim(),
            description: description.trim(),
            detail: detail?.trim() || undefined,
            categories: categories ? categories.split(/[,，]/).map(s => s.trim()) : undefined,
            keywords: keywords ? keywords.split(/[,，]/).map(s => s.trim()) : undefined,
            priority: priority ? parseInt(priority) || 3 : 3,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            source: 'import'
        });
        result.imported++;
    });
    
    return result;
}

/**
 * 从 CSV 导入文案模板
 * 
 * CSV 格式：名称,类型,内容,变量(JSON格式),类目,场景
 */
export function importCopyTemplatesFromCSV(csvText: string): ImportResult {
    const rows = parseCSV(csvText);
    const result: ImportResult = {
        success: true,
        imported: 0,
        skipped: 0,
        errors: []
    };
    
    const dataRows = rows.slice(1);
    
    dataRows.forEach((row, index) => {
        if (row.length < 3) {
            result.errors.push({ row: index + 2, message: '列数不足，至少需要名称、类型和内容' });
            result.skipped++;
            return;
        }
        
        const [name, type, content] = row;
        
        if (!name || !content) {
            result.errors.push({ row: index + 2, message: '名称或内容为空' });
            result.skipped++;
            return;
        }
        
        const validTypes = ['title', 'subtitle', 'tag', 'promo', 'description', 'other'];
        const normalizedType = validTypes.includes(type) ? type : 'other';
        
        result.imported++;
    });
    
    return result;
}

/**
 * 从 JSON 导入知识
 */
export function importFromJSON(jsonData: unknown): ImportResult & { data?: Partial<UserKnowledge> } {
    const result: ImportResult & { data?: Partial<UserKnowledge> } = {
        success: true,
        imported: 0,
        skipped: 0,
        errors: []
    };
    
    try {
        const data = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
        const imported: Partial<UserKnowledge> = {};
        
        // 导入卖点
        if (Array.isArray(data.sellingPoints)) {
            imported.sellingPoints = data.sellingPoints.map((sp: any, i: number) => ({
                id: sp.id || `user-sp-${Date.now()}-${i}`,
                title: sp.title || sp.name || '',
                description: sp.description || sp.desc || '',
                detail: sp.detail,
                categories: sp.categories,
                keywords: sp.keywords,
                priority: sp.priority || 3,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                source: 'import' as const
            }));
            result.imported += imported.sellingPoints?.length ?? 0;
        }
        
        // 导入痛点
        if (Array.isArray(data.painPoints)) {
            imported.painPoints = data.painPoints.map((pp: any, i: number) => ({
                id: pp.id || `user-pp-${Date.now()}-${i}`,
                title: pp.title || pp.name || '',
                scenario: pp.scenario || pp.scene || '',
                userVoice: pp.userVoice,
                solutionTitle: pp.solutionTitle || pp.solution || '',
                solutionDescription: pp.solutionDescription,
                categories: pp.categories,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                source: 'import' as const
            }));
            result.imported += imported.painPoints?.length ?? 0;
        }
        
        // 导入文案模板
        if (Array.isArray(data.copyTemplates)) {
            imported.copyTemplates = data.copyTemplates.map((ct: any, i: number) => ({
                id: ct.id || `user-ct-${Date.now()}-${i}`,
                name: ct.name || `模板${i + 1}`,
                type: ct.type || 'other',
                content: ct.content || ct.template || '',
                variables: ct.variables,
                categories: ct.categories,
                scenes: ct.scenes,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                source: 'import' as const
            }));
            result.imported += imported.copyTemplates?.length ?? 0;
        }
        
        // 导入配色
        if (Array.isArray(data.colorSchemes)) {
            imported.colorSchemes = data.colorSchemes.map((cs: any, i: number) => ({
                id: cs.id || `user-cs-${Date.now()}-${i}`,
                name: cs.name || `配色${i + 1}`,
                description: cs.description,
                primary: cs.primary || cs.main || '#000000',
                secondary: cs.secondary,
                accent: cs.accent,
                background: cs.background || cs.bg,
                text: cs.text,
                palette: cs.palette,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                source: 'import' as const
            }));
            result.imported += imported.colorSchemes?.length ?? 0;
        }
        
        result.data = imported;
        
    } catch (e) {
        result.success = false;
        result.errors.push({ row: 0, message: `JSON 解析失败: ${e}` });
    }
    
    return result;
}

// ===== 示例数据 =====

/** 卖点导入模板 (CSV) */
export const SELLING_POINT_CSV_TEMPLATE = `标题,描述,详情,类目,关键词,优先级
"超强吸汗","快速吸收汗水，保持脚部干爽","采用特殊纤维结构，吸汗能力提升3倍","运动袜,中筒袜","吸汗,速干,运动",5
"抗菌除臭","99%抑菌率，告别脚臭尴尬","银离子抗菌技术","全部","抗菌,除臭,银离子",4`;

/** 文案模板导入模板 (CSV) */
export const COPY_TEMPLATE_CSV_TEMPLATE = `名称,类型,内容,变量,类目,场景
"限时促销标题",promo,"{{折扣}}折限时抢！{{产品名}}年度低价","[{""name"":""折扣"",""example"":""5""},{""name"":""产品名"",""example"":""纯棉袜""}]","全部","促销"
"卖点标签",tag,"{{特点}} | {{效果}}","[{""name"":""特点"",""example"":""精梳棉""},{""name"":""效果"",""example"":""柔软亲肤""}]","全部","详情页"`;

/** JSON 导入示例 */
export const JSON_IMPORT_EXAMPLE = {
    sellingPoints: [
        {
            title: "防滑硅胶",
            description: "后跟3D硅胶，走路不掉跟",
            categories: ["船袜"],
            keywords: ["防滑", "硅胶", "不掉跟"],
            priority: 5
        }
    ],
    copyTemplates: [
        {
            name: "主图标题模板",
            type: "title",
            content: "{{品牌}} {{产品类型}} | {{核心卖点}}",
            variables: [
                { name: "品牌", description: "品牌名称", example: "XXXXXX" },
                { name: "产品类型", description: "产品类型", example: "纯棉中筒袜" },
                { name: "核心卖点", description: "主要卖点", example: "吸汗透气" }
            ]
        }
    ],
    colorSchemes: [
        {
            name: "我的品牌色",
            primary: "#FF6B35",
            secondary: "#004E89",
            accent: "#FFD700",
            background: "#FFFFFF"
        }
    ]
};
