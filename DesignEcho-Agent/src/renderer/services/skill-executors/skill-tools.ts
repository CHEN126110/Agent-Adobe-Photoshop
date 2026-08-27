/**
 * Skill → legacy workflow bridge 适配层
 *
 * Skill 不是 Tool。本文件只是在旧 renderer Agent 工具循环尚未整体迁移到
 * v5 SkillRuntimeManifest 前，把 SKILL_REGISTRY 中的技能声明暴露成 legacy
 * workflow bridge，让模型能在 ReAct 中选择一个封装工作流。
 *
 * 约束在执行点强制（技能开关、抠图暂停、执行器存在性），结果必须返回
 * ReAct observation，不能把工作流输出当作跳过 Agent 的终局硬编码答案。
 */

import type { ToolSchema } from '../agent-runtime/types';
import type {
    RuntimeDesignBriefDeclaration,
    RuntimeDesignBriefDigest
} from '../../../shared/agent-runtime-v5/runtime-design-brief-declaration';
import type {
    RuntimeReferenceBriefDeclaration,
    RuntimeReferenceBriefDigest
} from '../../../shared/agent-runtime-v5/runtime-reference-context';
import type {
    RuntimeDesignStrategyDeclaration,
    RuntimeDesignStrategyDigest
} from '../../../shared/agent-runtime-v5/runtime-design-strategy-declaration';
import type {
    RuntimeActionPlanDeclaration,
    RuntimeActionPlanDigest
} from '../../../shared/agent-runtime-v5/runtime-action-plan-declaration';
import type { AgentTaskPlanningContract } from '../../../shared/agent-task-planning-contract';
import {
    forwardRuntimeOwnedSkillDeliveryPlanBinding,
    type GuardedAtomicToolExecutor
} from '../../../shared/agent-skill-atomic-tool-execution';
import type { InteractiveContinuationResolution } from '../../../shared/pending-interactive-continuation';
import {
    peekRuntimeWorkflowDeliveryReentry,
    type RuntimeWorkflowDeliveryReentry
} from '../../../shared/agent-workflow-continuation-scope';
import {
    attachSkillExecutionEffectReceipt,
    type SkillExecutionRuntimeLineage
} from '../../../shared/skill-execution-effect';
import type {
    SkillDeclaration,
    SkillParameterSchema
} from '../../../shared/types/skill.types';
import { SKILL_REGISTRY, getSkillById } from '../../../shared/skills/skill-declarations';
import { useAppStore } from '../../stores/app.store';
import { applySharedSkillParamDefaults } from '../../../shared/skill-param-defaults';
import {
    isAgentMattingPaused,
    getAgentMattingPausedMessage
} from '../agent-orchestration/routing';
import { executeSkillWithExecutor, getSkillExecutor } from './registry';
import { buildAgentReActObservationFromSkillResult } from '../../../shared/agent-react-observation-contract';

let scopedSkillBridgeSuppressionDepth = 0;

/**
 * 在一个有界运行作用域内隐藏并拒绝全部 legacy Skill bridge。
 *
 * 该作用域只供本地验收入口使用：不修改 Zustand / localStorage 中的用户 Skill 开关，
 * 不进入模型消息，也不会在任务结束后残留。ChatPanel 已保证同一窗口只运行一个任务；
 * depth 仍用于保证嵌套调用可以按 finally 成对恢复。
 */
export async function runWithSkillBridgesSuppressed<T>(operation: () => Promise<T>): Promise<T> {
    scopedSkillBridgeSuppressionDepth += 1;
    try {
        return await operation();
    } finally {
        scopedSkillBridgeSuppressionDepth = Math.max(0, scopedSkillBridgeSuppressionDepth - 1);
    }
}

/** 与 routing.isSkillEnabled 同语义的本地实现（避免引入 routing 的重依赖链） */
function isSkillEnabledInSettings(skillId: string): boolean {
    if (scopedSkillBridgeSuppressionDepth > 0) return false;
    try {
        const integrationSettings = (useAppStore.getState() as any).integrationSettings;
        return integrationSettings?.skills?.[skillId]?.enabled !== false;
    } catch {
        return true;
    }
}

function isSkillExposableToLoop(skill: SkillDeclaration): boolean {
    if (skill.id === 'autonomous-agent') return false;
    const visibility = (skill as any).visibility;
    if (visibility && visibility !== 'user-facing') return false;
    if (skill.id === 'matte-product' && isAgentMattingPaused()) return false;
    if (!isSkillEnabledInSettings(skill.id)) return false;
    return true;
}

/** SkillParameterSchema → JSON Schema；递归处理 array items 与 object properties。 */
function skillParamToSchema(param: SkillParameterSchema): Record<string, any> {
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
            schema.type = 'array';
            schema.items = param.items
                ? skillParamToSchema(param.items)
                : {};
            break;
        case 'object': {
            schema.type = 'object';
            if (param.properties) {
                const properties: Record<string, any> = {};
                const required: string[] = [];
                for (const property of param.properties) {
                    properties[property.name] = skillParamToSchema(property);
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

/**
 * 构建当前可暴露给自主循环的技能工具 schema 列表。
 * 每次调用时重新评估（技能开关可能在设置中变化）。
 */
export function buildSkillToolSchemas(): ToolSchema[] {
    return SKILL_REGISTRY
        .filter(isSkillExposableToLoop)
        .map(skill => {
            const properties: Record<string, any> = {};
            const required: string[] = [];
            for (const param of skill.parameters) {
                properties[param.name] = skillParamToSchema(param);
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
        });
}

/** 判断某个 legacy workflow bridge 名称是否对应一个已注册 Skill。 */
export function isSkillWorkflowBridgeToolName(toolName: string): boolean {
    return Boolean(getSkillById(toolName));
}

/** @deprecated Use isSkillWorkflowBridgeToolName. Kept for legacy callers. */
export const isSkillToolName = isSkillWorkflowBridgeToolName;

export interface SkillToolExecuteOptions {
    callbacks?: any;
    signal?: AbortSignal;
    context?: any;
    /** 仅由 Harness 创建；不会从模型 Skill 参数中读取。 */
    guardedAtomicToolExecutor?: GuardedAtomicToolExecutor;
    /** 仅由 Runtime continuation owner 注入；模型参数不能创建或覆盖。 */
    runtimeSkillExecutionLineage?: SkillExecutionRuntimeLineage;
    runtimeDesignBriefDeclaration?: RuntimeDesignBriefDeclaration;
    runtimeDesignBriefDigest?: RuntimeDesignBriefDigest;
    runtimeDesignBriefRequiredInputKeys?: string[];
    runtimeReferenceBriefDeclaration?: RuntimeReferenceBriefDeclaration;
    runtimeReferenceBriefDigest?: RuntimeReferenceBriefDigest;
    runtimeDesignStrategyDeclaration?: RuntimeDesignStrategyDeclaration;
    runtimeDesignStrategyDigest?: RuntimeDesignStrategyDigest;
    runtimeActionPlanDeclaration?: RuntimeActionPlanDeclaration;
    runtimeActionPlanDigest?: RuntimeActionPlanDigest;
    /** 仅由当前 Agent continuation owner 注入；模型参数不能创建。 */
    runtimeWorkflowDeliveryReentry?: RuntimeWorkflowDeliveryReentry;
    agentTaskPlan?: AgentTaskPlanningContract;
    /** Engine-owned、账本验证后的 continuation；自主模型调用不能设置。 */
    trustedInteractiveContinuation?: Extract<InteractiveContinuationResolution, { status: 'accepted' }>;
}

const RUNTIME_OWNED_SKILL_PARAM_NAMES = new Set([
    'interactiveContinuationId',
    'interactiveCardDefinition',
    'interactiveCardSubmission',
    // 已退役的手工面板授权字段：旧模型消息、文本 Tool parser 或外部调用即使携带，
    // 也必须在进入业务执行器前剥离。真实授权只存在于不可序列化的函数 capability。
    '__manualPanelLegacyProfileAuthorized',
    'runtimeWorkflowDeliveryReentry'
]);

function stripRuntimeOwnedSkillParams(params: Record<string, any>): Record<string, any> {
    return Object.fromEntries(
        Object.entries(params || {}).filter(([name]) => !RUNTIME_OWNED_SKILL_PARAM_NAMES.has(name))
    );
}

export function buildSkillWorkflowBridgeObservation(toolName: string, result: any): any {
    return buildAgentReActObservationFromSkillResult({
        skillId: toolName,
        result
    });
}

function resolveSkillToolUserInput(params: Record<string, any>, options: SkillToolExecuteOptions): string {
    return String(
        options.context?.userInput
        || params?.userIntent
        || params?.userTask
        || params?.task
        || params?.userInput
        || ''
    ).trim();
}

function resolveSkillToolMode(params: Record<string, any>): 'execute' | 'inspect' | undefined {
    const mode = String(params?.mode || '').trim();
    return mode === 'execute' || mode === 'inspect' ? mode : undefined;
}

function buildRejectedSkillToolResult(
    skillId: string,
    error: string,
    runtimeLineage?: SkillExecutionRuntimeLineage
): any {
    return attachSkillExecutionEffectReceipt({
        success: false,
        error
    }, {
        skillId,
        executionStarted: false,
        runtimeLineage
    });
}

/** 在自主循环内执行技能。 */
export async function executeSkillTool(
    toolName: string,
    params: Record<string, any>,
    options: SkillToolExecuteOptions
): Promise<any> {
    // 门禁出口治理（2026-07-02）：执行点拒绝必须给出替代路径（改用什么工具 / 谁能解锁），
    // 不能只说"不行"。抠图暂停消息（getAgentMattingPausedMessage）本身已说明替代边界
    // （UXP 面板用户工具），保持单一来源不在此复写。
    const skill = getSkillById(toolName);
    if (!skill) {
        return buildRejectedSkillToolResult(
            toolName,
            `未注册的技能: ${toolName}。请改用本轮可用工具列表中的原子工具完成同一目标。`,
            options.runtimeSkillExecutionLineage
        );
    }
    if (toolName === 'matte-product' && isAgentMattingPaused()) {
        return buildRejectedSkillToolResult(
            toolName,
            getAgentMattingPausedMessage(),
            options.runtimeSkillExecutionLineage
        );
    }
    if (!isSkillEnabledInSettings(toolName)) {
        return buildRejectedSkillToolResult(
            toolName,
            `技能 ${skill.name} 当前已在设置中关闭。请改用基础原子工具完成同一目标，或提示用户在设置中启用该技能。`,
            options.runtimeSkillExecutionLineage
        );
    }

    if (!getSkillExecutor(toolName)) {
        return buildRejectedSkillToolResult(
            toolName,
            `技能 ${toolName} 还没有接好，请改用基础处理动作完成该任务。`,
            options.runtimeSkillExecutionLineage
        );
    }

    const modelOrFrozenParams = stripRuntimeOwnedSkillParams(params || {});
    const normalizedParams = applySharedSkillParamDefaults({
        skillId: toolName,
        userInput: resolveSkillToolUserInput(modelOrFrozenParams, options),
        mode: resolveSkillToolMode(modelOrFrozenParams),
        params: modelOrFrozenParams
    });
    const trustedInteractiveContinuation = options.trustedInteractiveContinuation?.skillId === toolName
        ? options.trustedInteractiveContinuation
        : undefined;
    const runtimeWorkflowDeliveryReentry = peekRuntimeWorkflowDeliveryReentry(
        options.runtimeWorkflowDeliveryReentry,
        toolName
    );

    const result = await executeSkillWithExecutor(toolName, {
        params: normalizedParams,
        callbacks: options.callbacks,
        signal: options.signal,
        context: options.context,
        guardedAtomicToolExecutor: options.guardedAtomicToolExecutor,
        runtimeSkillExecutionLineage: options.runtimeSkillExecutionLineage,
        runtimeDesignBriefDeclaration: options.runtimeDesignBriefDeclaration,
        runtimeDesignBriefDigest: options.runtimeDesignBriefDigest,
        runtimeDesignBriefRequiredInputKeys: options.runtimeDesignBriefRequiredInputKeys,
        runtimeReferenceBriefDeclaration: options.runtimeReferenceBriefDeclaration,
        runtimeReferenceBriefDigest: options.runtimeReferenceBriefDigest,
        runtimeDesignStrategyDeclaration: options.runtimeDesignStrategyDeclaration,
        runtimeDesignStrategyDigest: options.runtimeDesignStrategyDigest,
        runtimeActionPlanDeclaration: options.runtimeActionPlanDeclaration,
        runtimeActionPlanDigest: options.runtimeActionPlanDigest,
        runtimeWorkflowDeliveryReentry,
        agentTaskPlan: options.agentTaskPlan,
        trustedInteractiveContinuation
    });
    const currentData = result?.data && typeof result.data === 'object'
        ? result.data
        : {};
    const wrappedResult = {
        ...result,
        data: {
            ...currentData,
            agentReActObservation: buildSkillWorkflowBridgeObservation(toolName, result)
        }
    };
    return forwardRuntimeOwnedSkillDeliveryPlanBinding(result, wrappedResult);
}
