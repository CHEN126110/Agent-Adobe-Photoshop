/**
 * SkillDeclaration → legacy workflow bridge 工具 schema 的纯转换层。
 *
 * 单独放在 shared 是为了让转换逻辑可被静态审计（verify-compose-design-spec.cjs）
 * 与 renderer 桥接层（skill-executors/skill-tools.ts）共用同一份实现，
 * 避免审计只覆盖原子工具、漏掉技能工具的 schema 缺陷。
 *
 * 约束（fail closed）：array 参数必须声明 items 元素类型。OpenAI strict
 * Structured Outputs 要求每个 schema 节点带 type，缺 items 生成的空 schema
 * 会让整个 Codex 订阅通道请求被 invalid_json_schema 拒绝。这里直接抛错，
 * 不用空对象或 string 默认掩盖声明缺陷。
 */

import type {
    SkillDeclaration,
    SkillParameterSchema
} from '../types/skill.types';

export interface SkillWorkflowToolSchema {
    name: string;
    description: string;
    inputSchema: {
        type: 'object';
        properties: Record<string, any>;
        required?: string[];
        additionalProperties?: boolean;
    };
}

/**
 * Skill 的完整参数合同与模型可写接口是两件事。
 *
 * 未声明 modelParameterNames 的旧 Skill 维持全量可见；声明了投影的 Skill
 * 必须只引用真实参数，并且不能隐藏 required 参数。这样模型接口可以保持小而清楚，
 * Runtime 内部参数仍留在同一个 Skill 包，不需要复制第二份执行器。
 */
export function getModelVisibleSkillParameters(skill: SkillDeclaration): SkillDeclaration['parameters'] {
    if (!skill.modelParameterNames) return skill.parameters;

    const declaredNames = new Set(skill.parameters.map((parameter) => parameter.name));
    const visibleNames = new Set(skill.modelParameterNames);
    const unknownNames = skill.modelParameterNames.filter((name) => !declaredNames.has(name));
    if (unknownNames.length > 0) {
        throw new Error(`技能 ${skill.id} 的 modelParameterNames 引用了未知参数：${unknownNames.join('、')}`);
    }

    const hiddenRequiredNames = skill.parameters
        .filter((parameter) => parameter.required && !visibleNames.has(parameter.name))
        .map((parameter) => parameter.name);
    if (hiddenRequiredNames.length > 0) {
        throw new Error(`技能 ${skill.id} 隐藏了必填模型参数：${hiddenRequiredNames.join('、')}`);
    }

    return skill.parameters.filter((parameter) => visibleNames.has(parameter.name));
}

/** SkillParameterSchema → JSON Schema；递归处理 array items 与 object properties。 */
export function skillParameterToJsonSchema(
    param: SkillParameterSchema,
    paramPath: string
): Record<string, any> {
    const schema: Record<string, any> = {};
    if (param.description) {
        schema.description = param.description;
    }

    switch (param.type) {
        case 'number':
            schema.type = 'number';
            break;
        case 'integer':
            schema.type = 'integer';
            break;
        case 'boolean':
            schema.type = 'boolean';
            break;
        case 'array':
            if (!param.items) {
                throw new Error(
                    `技能参数 ${paramPath} 声明为 array 但缺少 items 元素类型。`
                    + '请在 skill-declarations.ts 补上符合业务语义的 items；'
                    + '空 items 会被 Codex strict Structured Outputs 以 invalid_json_schema 拒绝。'
                );
            }
            schema.type = 'array';
            schema.items = skillParameterToJsonSchema(param.items, `${paramPath}.items`);
            break;
        case 'object': {
            schema.type = 'object';
            if (param.properties) {
                const properties: Record<string, any> = {};
                const required: string[] = [];
                for (const property of param.properties) {
                    properties[property.name] = skillParameterToJsonSchema(
                        property,
                        `${paramPath}.${property.name}`
                    );
                    if (property.required) {
                        required.push(property.name);
                    }
                }
                schema.properties = properties;
                if (required.length > 0) {
                    schema.required = required;
                }
            }
            break;
        }
        case 'image':
            schema.type = 'string';
            schema.description = `${param.description}（图片 base64 或本地文件路径）`;
            break;
        case 'string':
        default:
            schema.type = 'string';
    }
    if (param.enum && param.enum.length > 0) schema.enum = param.enum;
    if (param.default !== undefined) schema.default = param.default;
    if (param.additionalProperties !== undefined) {
        schema.additionalProperties = param.additionalProperties;
    }
    if (param.minimum !== undefined) schema.minimum = param.minimum;
    if (param.maximum !== undefined) schema.maximum = param.maximum;
    if (param.minLength !== undefined) schema.minLength = param.minLength;
    if (param.minItems !== undefined) schema.minItems = param.minItems;
    if (param.maxItems !== undefined) schema.maxItems = param.maxItems;
    if (param.uniqueItems !== undefined) schema.uniqueItems = param.uniqueItems;
    return schema;
}

/** 单个 Skill 声明 → 自主循环可见的 workflow bridge 工具 schema。 */
export function buildSkillWorkflowToolSchema(skill: SkillDeclaration): SkillWorkflowToolSchema {
    const properties: Record<string, any> = {};
    const required: string[] = [];
    for (const param of getModelVisibleSkillParameters(skill)) {
        properties[param.name] = skillParameterToJsonSchema(param, `${skill.id}.${param.name}`);
        if (param.required) required.push(param.name);
    }

    const descriptionLines = [
        `【设计方法】${skill.description}`,
        skill.playbookId
            ? `工作法包: ${skill.playbookId}；需要正文时调用 readSkillPlaybook("${skill.playbookId}")。`
            : '',
        '这是可以直接完成一组相关工作的专业方法，不是单个 Photoshop 动作。使用后根据实际结果继续设计、调整或交付。',
        skill.whenToUse.length > 0 ? `适合: ${skill.whenToUse.join('；')}` : '',
        skill.whenNotToUse && skill.whenNotToUse.length > 0 ? `不适合: ${skill.whenNotToUse.join('；')}` : '',
        `完成后: ${skill.output.description}`
    ].filter(Boolean);

    return {
        name: skill.id,
        description: descriptionLines.join('\n'),
        inputSchema: {
            type: 'object' as const,
            properties,
            ...(required.length > 0 ? { required } : {}),
            additionalProperties: false
        }
    };
}
