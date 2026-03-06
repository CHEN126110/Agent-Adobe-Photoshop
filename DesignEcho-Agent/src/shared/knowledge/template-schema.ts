/**
 * 知识模板架构定义
 * 
 * 支持用户自定义知识类型和字段结构
 */

// ===== 字段类型 =====

export type FieldType = 
    | 'text'           // 单行文本
    | 'textarea'       // 多行文本
    | 'number'         // 数字
    | 'select'         // 下拉选择
    | 'multiselect'    // 多选
    | 'color'          // 颜色选择器
    | 'tags'           // 标签数组
    | 'switch';        // 开关

// ===== 验证规则 =====

export interface FieldValidation {
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
    pattern?: string;
    patternMessage?: string;
}

// ===== 字段定义 =====

export interface TemplateField {
    id: string;
    /** 字段名（英文，用于存储） */
    name: string;
    /** 显示标签（中文） */
    label: string;
    /** 字段类型 */
    type: FieldType;
    /** 是否必填 */
    required: boolean;
    /** 占位提示 */
    placeholder?: string;
    /** 默认值 */
    defaultValue?: unknown;
    /** 下拉选项（type为select/multiselect时） */
    options?: string[];
    /** 验证规则 */
    validation?: FieldValidation;
    /** 排序顺序 */
    order: number;
    /** 字段描述/帮助文本 */
    helpText?: string;
}

// ===== 知识模板 =====

export interface KnowledgeTemplate {
    id: string;
    /** 模板名称 */
    name: string;
    /** 图标 */
    icon: string;
    /** 描述 */
    description?: string;
    /** 字段定义 */
    fields: TemplateField[];
    /** 是否为系统内置 */
    isBuiltin: boolean;
    /** 创建时间 */
    createdAt: string;
    /** 更新时间 */
    updatedAt: string;
    /** 模板版本 */
    version?: string;
    /** 适用行业/类目 */
    industry?: string;
}

// ===== 模板仓库 =====

export interface TemplateRepository {
    version: string;
    templates: KnowledgeTemplate[];
    lastUpdated: string;
}

// ===== 内置模板 =====

export const BUILTIN_TEMPLATES: KnowledgeTemplate[] = [
    {
        id: 'tpl-selling-point',
        name: '卖点',
        icon: '',
        description: '产品卖点和特色功能',
        isBuiltin: true,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        version: '1.0',
        fields: [
            {
                id: 'f-sp-title',
                name: 'title',
                label: '卖点标题',
                type: 'text',
                required: true,
                placeholder: '如：100%纯棉',
                order: 0,
            },
            {
                id: 'f-sp-desc',
                name: 'description',
                label: '卖点描述',
                type: 'textarea',
                required: true,
                placeholder: '一句话描述卖点',
                order: 1,
            },
            {
                id: 'f-sp-detail',
                name: 'detail',
                label: '详细说明',
                type: 'textarea',
                required: false,
                placeholder: '更详细的说明（可选）',
                order: 2,
            },
            {
                id: 'f-sp-type',
                name: 'type',
                label: '卖点类型',
                type: 'select',
                required: false,
                options: ['材质', '功能', '舒适', '设计', '品质', '健康'],
                order: 3,
            },
            {
                id: 'f-sp-priority',
                name: 'priority',
                label: '优先级',
                type: 'number',
                required: false,
                defaultValue: 3,
                validation: { min: 1, max: 5 },
                helpText: '1-5，5为最高',
                order: 4,
            },
            {
                id: 'f-sp-keywords',
                name: 'keywords',
                label: '关键词',
                type: 'tags',
                required: false,
                placeholder: '输入关键词后按回车',
                order: 5,
            },
            {
                id: 'f-sp-categories',
                name: 'categories',
                label: '适用类目',
                type: 'tags',
                required: false,
                order: 6,
            },
        ],
    },
    {
        id: 'tpl-pain-point',
        name: '痛点',
        icon: '',
        description: '用户痛点和解决方案',
        isBuiltin: true,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        version: '1.0',
        fields: [
            {
                id: 'f-pp-title',
                name: 'title',
                label: '痛点标题',
                type: 'text',
                required: true,
                placeholder: '如：袜子勒脚踝',
                order: 0,
            },
            {
                id: 'f-pp-scenario',
                name: 'scenario',
                label: '场景描述',
                type: 'textarea',
                required: true,
                placeholder: '描述用户遇到这个问题的场景',
                order: 1,
            },
            {
                id: 'f-pp-voice',
                name: 'userVoice',
                label: '用户心声',
                type: 'textarea',
                required: false,
                placeholder: '用第一人称描述用户的感受',
                order: 2,
            },
            {
                id: 'f-pp-solution-title',
                name: 'solutionTitle',
                label: '解决方案',
                type: 'text',
                required: true,
                placeholder: '如：宽松袜口不勒脚',
                order: 3,
            },
            {
                id: 'f-pp-solution-desc',
                name: 'solutionDescription',
                label: '方案说明',
                type: 'textarea',
                required: false,
                order: 4,
            },
            {
                id: 'f-pp-type',
                name: 'type',
                label: '痛点类型',
                type: 'select',
                required: false,
                options: ['舒适', '耐用', '卫生', '功能', '外观', '健康'],
                order: 5,
            },
            {
                id: 'f-pp-severity',
                name: 'severity',
                label: '严重程度',
                type: 'number',
                required: false,
                defaultValue: 3,
                validation: { min: 1, max: 5 },
                helpText: '1-5，5为最严重',
                order: 6,
            },
        ],
    },
    {
        id: 'tpl-color-scheme',
        name: '配色方案',
        icon: '',
        description: '品牌配色和主题色',
        isBuiltin: true,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        version: '1.0',
        fields: [
            {
                id: 'f-cs-name',
                name: 'name',
                label: '方案名称',
                type: 'text',
                required: true,
                placeholder: '如：品牌主色',
                order: 0,
            },
            {
                id: 'f-cs-desc',
                name: 'description',
                label: '描述',
                type: 'text',
                required: false,
                order: 1,
            },
            {
                id: 'f-cs-primary',
                name: 'primary',
                label: '主色',
                type: 'color',
                required: true,
                defaultValue: '#6366f1',
                order: 2,
            },
            {
                id: 'f-cs-secondary',
                name: 'secondary',
                label: '次色',
                type: 'color',
                required: false,
                order: 3,
            },
            {
                id: 'f-cs-accent',
                name: 'accent',
                label: '强调色',
                type: 'color',
                required: false,
                order: 4,
            },
            {
                id: 'f-cs-bg',
                name: 'background',
                label: '背景色',
                type: 'color',
                required: false,
                order: 5,
            },
            {
                id: 'f-cs-text',
                name: 'text',
                label: '文字色',
                type: 'color',
                required: false,
                order: 6,
            },
        ],
    },
    {
        id: 'tpl-copy-template',
        name: '文案模板',
        icon: '',
        description: '可复用的文案模板',
        isBuiltin: true,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        version: '1.0',
        fields: [
            {
                id: 'f-ct-name',
                name: 'name',
                label: '模板名称',
                type: 'text',
                required: true,
                placeholder: '如：促销标题模板',
                order: 0,
            },
            {
                id: 'f-ct-type',
                name: 'type',
                label: '文案类型',
                type: 'select',
                required: true,
                options: ['标题', '副标题', '标签', '促销', '描述', '其他'],
                order: 1,
            },
            {
                id: 'f-ct-content',
                name: 'content',
                label: '文案内容',
                type: 'textarea',
                required: true,
                placeholder: '支持 {{变量}} 占位符',
                order: 2,
            },
            {
                id: 'f-ct-categories',
                name: 'categories',
                label: '适用类目',
                type: 'tags',
                required: false,
                order: 3,
            },
            {
                id: 'f-ct-scenes',
                name: 'scenes',
                label: '适用场景',
                type: 'tags',
                required: false,
                order: 4,
            },
        ],
    },
];

// ===== 默认模板仓库 =====

export const DEFAULT_TEMPLATE_REPOSITORY: TemplateRepository = {
    version: '1.0',
    templates: BUILTIN_TEMPLATES,
    lastUpdated: new Date().toISOString(),
};

// ===== 工具函数 =====

/**
 * 根据模板生成空白知识条目
 */
export function createEmptyEntry(template: KnowledgeTemplate): Record<string, unknown> {
    const entry: Record<string, unknown> = {
        id: `entry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        templateId: template.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    
    for (const field of template.fields) {
        if (field.defaultValue !== undefined) {
            entry[field.name] = field.defaultValue;
        } else {
            switch (field.type) {
                case 'text':
                case 'textarea':
                    entry[field.name] = '';
                    break;
                case 'number':
                    entry[field.name] = 0;
                    break;
                case 'switch':
                    entry[field.name] = false;
                    break;
                case 'tags':
                case 'multiselect':
                    entry[field.name] = [];
                    break;
                case 'color':
                    entry[field.name] = '#000000';
                    break;
                default:
                    entry[field.name] = null;
            }
        }
    }
    
    return entry;
}

/**
 * 验证知识条目是否符合模板
 */
export function validateEntry(
    entry: Record<string, unknown>,
    template: KnowledgeTemplate
): { valid: boolean; errors: Record<string, string> } {
    const errors: Record<string, string> = {};
    
    for (const field of template.fields) {
        const value = entry[field.name];
        
        // 必填检查
        if (field.required) {
            if (value === undefined || value === null || value === '') {
                errors[field.name] = `${field.label}不能为空`;
                continue;
            }
            if (Array.isArray(value) && value.length === 0) {
                errors[field.name] = `${field.label}至少选择一项`;
                continue;
            }
        }
        
        // 类型验证
        if (value !== undefined && value !== null && value !== '') {
            const v = field.validation;
            
            if (field.type === 'text' || field.type === 'textarea') {
                const strValue = String(value);
                if (v?.minLength && strValue.length < v.minLength) {
                    errors[field.name] = `${field.label}至少${v.minLength}个字符`;
                }
                if (v?.maxLength && strValue.length > v.maxLength) {
                    errors[field.name] = `${field.label}最多${v.maxLength}个字符`;
                }
                if (v?.pattern && !new RegExp(v.pattern).test(strValue)) {
                    errors[field.name] = v.patternMessage || `${field.label}格式不正确`;
                }
            }
            
            if (field.type === 'number') {
                const numValue = Number(value);
                if (isNaN(numValue)) {
                    errors[field.name] = `${field.label}必须是数字`;
                } else {
                    if (v?.min !== undefined && numValue < v.min) {
                        errors[field.name] = `${field.label}不能小于${v.min}`;
                    }
                    if (v?.max !== undefined && numValue > v.max) {
                        errors[field.name] = `${field.label}不能大于${v.max}`;
                    }
                }
            }
        }
    }
    
    return {
        valid: Object.keys(errors).length === 0,
        errors,
    };
}

/**
 * 将模板导出为 JSON
 */
export function exportTemplate(template: KnowledgeTemplate): string {
    return JSON.stringify(template, null, 2);
}

/**
 * 从 JSON 导入模板
 */
export function importTemplate(json: string): KnowledgeTemplate | null {
    try {
        const data = JSON.parse(json);
        if (!data.name || !Array.isArray(data.fields)) {
            return null;
        }
        return {
            ...data,
            id: data.id || `tpl-${Date.now()}`,
            isBuiltin: false,
            createdAt: data.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
    } catch {
        return null;
    }
}

export default {
    BUILTIN_TEMPLATES,
    DEFAULT_TEMPLATE_REPOSITORY,
    createEmptyEntry,
    validateEntry,
    exportTemplate,
    importTemplate,
};
