/**
 * 模板占位符解析服务
 * 
 * 负责解析 PSD 图层名称中的占位符标记
 */

import type { 
    ParsedPlaceholder, 
    PlaceholderType,
    Placeholder,
    PlaceholderOptions
} from '../../shared/types/template';

// ===== 正则表达式 =====

// 占位符主模式: [TYPE:NAME:OPTIONS]
const PLACEHOLDER_REGEX = /^\[(\w+):([^\]:]+)(?::([^\]]+))?\](.*)$/;

// 特殊标记
const LOCK_MARKER = '#lock';
const HIDDEN_MARKER = '#hidden';
const CONDITION_REGEX = /#if:(\w+)/;

// 有效的占位符类型
const VALID_TYPES: PlaceholderType[] = ['IMG', 'TEXT', 'SO', 'GROUP', 'STYLE', 'REPEAT'];

// ===== 解析器类 =====

class TemplateParserService {
    /**
     * 解析图层名称，提取占位符信息
     */
    parseLayerName(layerName: string): ParsedPlaceholder | null {
        if (!layerName || !layerName.startsWith('[')) {
            return null;
        }

        const trimmedName = layerName.trim();
        const match = trimmedName.match(PLACEHOLDER_REGEX);

        if (!match) {
            return null;
        }

        const [, typeStr, name, optionsStr, suffix] = match;
        const type = typeStr.toUpperCase() as PlaceholderType;

        // 验证类型
        if (!VALID_TYPES.includes(type)) {
            console.warn(`[TemplateParser] 未知占位符类型: ${typeStr}`);
            return null;
        }

        // 解析选项
        const options = optionsStr ? optionsStr.split(',').map(o => o.trim()) : [];

        // 解析特殊标记
        const isLocked = suffix.includes(LOCK_MARKER);
        const isHidden = suffix.includes(HIDDEN_MARKER);
        
        // 解析条件
        const conditionMatch = suffix.match(CONDITION_REGEX);
        const condition = conditionMatch ? conditionMatch[1] : undefined;

        return {
            type,
            name,
            options,
            rawName: trimmedName,
            isLocked,
            isHidden,
            condition
        };
    }

    /**
     * 批量解析图层名称列表
     */
    parseLayerNames(layerNames: string[]): Map<string, ParsedPlaceholder> {
        const result = new Map<string, ParsedPlaceholder>();

        for (const name of layerNames) {
            const parsed = this.parseLayerName(name);
            if (parsed) {
                result.set(name, parsed);
            }
        }

        return result;
    }

    /**
     * 将解析结果转换为完整的 Placeholder 对象
     */
    toPlaceholder(parsed: ParsedPlaceholder, layerPath: string): Placeholder {
        const options = this.parseOptions(parsed.type, parsed.options);

        return {
            id: this.generateId(parsed.name),
            type: parsed.type,
            name: parsed.name,
            layerPath,
            options,
            required: !parsed.isHidden,
            description: this.generateDescription(parsed)
        };
    }

    /**
     * 解析选项字符串为 PlaceholderOptions
     */
    private parseOptions(type: PlaceholderType, optionStrings: string[]): PlaceholderOptions {
        const options: PlaceholderOptions = {};

        switch (type) {
            case 'IMG':
                // [IMG:NAME:fit,align,mask]
                if (optionStrings[0]) options.fit = optionStrings[0] as any;
                if (optionStrings[1]) options.align = optionStrings[1] as any;
                if (optionStrings[2]) options.mask = optionStrings[2] as any;
                break;

            case 'TEXT':
                // [TEXT:NAME:source,maxlen,fallback]
                if (optionStrings[0]) options.source = optionStrings[0] as any;
                if (optionStrings[1]) options.maxLength = parseInt(optionStrings[1], 10);
                if (optionStrings[2]) options.fallback = optionStrings[2];
                break;

            case 'STYLE':
                // [STYLE:NAME:property,inherit]
                if (optionStrings[0]) options.property = optionStrings[0] as any;
                if (optionStrings[1]) options.inherit = optionStrings[1] === 'true';
                break;

            case 'REPEAT':
                // [REPEAT:NAME:min,max,direction]
                if (optionStrings[0]) options.min = parseInt(optionStrings[0], 10);
                if (optionStrings[1]) options.max = parseInt(optionStrings[1], 10);
                if (optionStrings[2]) options.direction = optionStrings[2] as any;
                break;

            case 'SO':
            case 'GROUP':
                // 智能对象和组没有特殊选项
                break;
        }

        return options;
    }

    /**
     * 生成占位符 ID
     */
    private generateId(name: string): string {
        return name
            .toLowerCase()
            .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
            .replace(/^-|-$/g, '');
    }

    /**
     * 生成占位符描述
     */
    private generateDescription(parsed: ParsedPlaceholder): string {
        const typeDescriptions: Record<PlaceholderType, string> = {
            'IMG': '图片占位符',
            'TEXT': '文本占位符',
            'SO': '智能对象占位符',
            'GROUP': '图层组占位符',
            'STYLE': '样式占位符',
            'REPEAT': '重复元素占位符'
        };

        let desc = `${typeDescriptions[parsed.type]}: ${parsed.name}`;
        
        if (parsed.isLocked) desc += ' (锁定)';
        if (parsed.isHidden) desc += ' (隐藏)';
        if (parsed.condition) desc += ` (条件: ${parsed.condition})`;

        return desc;
    }

    /**
     * 验证占位符名称是否合法
     */
    isValidPlaceholderName(name: string): boolean {
        return PLACEHOLDER_REGEX.test(name);
    }

    /**
     * 生成占位符图层名称
     */
    generateLayerName(
        type: PlaceholderType,
        name: string,
        options?: string[],
        flags?: { lock?: boolean; hidden?: boolean; condition?: string }
    ): string {
        let layerName = `[${type}:${name}`;
        
        if (options && options.length > 0) {
            layerName += ':' + options.join(',');
        }
        
        layerName += ']';

        if (flags?.lock) layerName += ' ' + LOCK_MARKER;
        if (flags?.hidden) layerName += ' ' + HIDDEN_MARKER;
        if (flags?.condition) layerName += ` #if:${flags.condition}`;

        return layerName;
    }

    /**
     * 从 PSD 图层树中提取所有占位符
     */
    extractPlaceholdersFromTree(layerTree: LayerNode[], basePath: string = ''): Placeholder[] {
        const placeholders: Placeholder[] = [];

        for (const layer of layerTree) {
            const currentPath = basePath ? `${basePath}/${layer.name}` : layer.name;
            const parsed = this.parseLayerName(layer.name);

            if (parsed && !parsed.isLocked) {
                placeholders.push(this.toPlaceholder(parsed, currentPath));
            }

            // 递归处理子图层
            if (layer.children && layer.children.length > 0) {
                const childPlaceholders = this.extractPlaceholdersFromTree(layer.children, currentPath);
                placeholders.push(...childPlaceholders);
            }
        }

        return placeholders;
    }
}

// ===== 辅助类型 =====

interface LayerNode {
    name: string;
    type?: string;
    children?: LayerNode[];
}

// ===== 导出单例 =====

export const templateParserService = new TemplateParserService();
