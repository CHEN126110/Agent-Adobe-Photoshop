/**
 * Agent 核心类 — ReAct 循环
 *
 * 思考 → 调工具 → 观察结果 → 继续
 *
 * Agent 循环跑在 Renderer 进程：
 * - 70+ 工具已在 Renderer 的 executeToolCall() 中
 * - 模型调用通过 IPC 桥接到 Main 进程
 * - UI 回调天然在 Renderer
 */

import type {
    AgentConfig, AgentMessage, AgentRunResult,
    ToolCall, ToolResult, ImageAttachment,
    CallModelFn, ExecuteToolFn, ContentBlock,
    AgentExecutionSummary, AgentStopReason, AgentToolCallLogEntry, AgentStepEvent,
    AgentThinkingEventMeta
} from './types';
import type { ProviderNativeToolRequest } from '../../../shared/provider-native-tools';
import { buildAgentIntentControlPlaneDecision } from '../../../shared/agent-intent-control-plane';
import {
    buildAgentToolDecisionContract,
    formatAgentToolDecisionContractBlocker
} from '../../../shared/agent-tool-decision-contract';
import { buildAgentToolExecutionPreflight } from '../../../shared/agent-tool-execution-preflight';
import { ContextManager } from './context-manager';
import { buildTaskCompletionContract } from './task-completion-contract';

const FINALIZATION_NUDGE_REMAINING_ITERATIONS = 3;
const REPEATED_TOOL_BATCH_LIMIT = 3;
const CONSECUTIVE_FAILED_TOOL_ROUND_LIMIT = 3;
const PREFLIGHT_TOOL_DECISION_BLOCKERS = new Set([
    'missing_public_plan',
    'missing_verification_target',
    'missing_prior_document_evidence'
]);

function stableStringify(value: any): string {
    if (value === null || typeof value !== 'object') {
        const serialized = JSON.stringify(value);
        return serialized === undefined ? 'undefined' : serialized;
    }
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }
    return `{${Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
        .join(',')}}`;
}

function buildToolBatchSignature(toolCalls: ToolCall[]): string {
    return toolCalls
        .map((call) => `${call.name}:${stableStringify(call.arguments || {})}`)
        .join('|');
}

function compactError(value: any): string {
    if (!value) return '';

    const success = value?.success !== false;
    const raw = success
        ? value?.error || value?.errorDetails?.message || value?.details?.error || ''
        : value?.error || value?.errorDetails?.message || value?.details?.error || value?.message || value?.details || '';
    return String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 240);
}

function summarizeToolArguments(args: any): string {
    if (!args || typeof args !== 'object') return '';
    const keys = Object.keys(args).filter((key) => !/api|key|token|secret|password/i.test(key));
    if (keys.length === 0) return '';
    return `参数字段: ${keys.slice(0, 8).join(', ')}${keys.length > 8 ? '...' : ''}`;
}

function summarizeToolResult(value: any): string {
    const error = compactError(value);
    if (error) return `失败原因: ${error}`;

    const parts: string[] = [];
    parts.push(value?.success === false ? '工具返回失败' : '工具返回成功');
    const acceptance = value?.acceptance || value?.data?.acceptance;
    if (acceptance?.enabled) {
        if (acceptance.assertionStatus) parts.push(`验收: ${acceptance.assertionStatus}`);
        if (acceptance.summaryText) parts.push(String(acceptance.summaryText).slice(0, 120));
    }
    return parts.join('；');
}

function normalizeThinkingForUi(value: unknown): string {
    const text = String(value || '').trim();
    if (!text) return '';
    if (/[?？]{3,}/.test(text)) return '';
    if (text.includes(String.fromCodePoint(0xFFFD))) return '';
    if (/^[?？.\s…!！,，:：;；-]+$/.test(text)) return '';
    if (/^\s*[{[]/.test(text)) return '';
    if (/^(已|已经)?(完成|处理完成|完成检查|完成并验证|已完成|已处理完成)[。.!！\s]*$/.test(text)) return '';
    if (/^任务(已|已经)?完成/.test(text)) return '';
    if (/^执行状态：/.test(text)) return '';
    return text.slice(0, 900);
}

export class Agent {
    private config: AgentConfig;
    private messages: AgentMessage[] = [];
    private iteration = 0;
    private toolCallLog: AgentToolCallLogEntry[] = [];
    private currentTask = '';
    private contextManager: ContextManager;
    private callModel: CallModelFn;
    private executeTool: ExecuteToolFn;
    private lastToolBatchSignature = '';
    private repeatedToolBatchCount = 0;
    private consecutiveFailedToolRounds = 0;
    private finalizationNudgeSent = false;
    private visibleReasoningSent = false;

    constructor(
        config: AgentConfig,
        callModel: CallModelFn,
        executeTool: ExecuteToolFn
    ) {
        this.config = config;
        this.callModel = callModel;
        this.executeTool = executeTool;
        this.contextManager = new ContextManager({
            keepRecentRounds: 6
        });
    }

    private emitStep(step: AgentStepEvent): void {
        const title = String(step.title || '').trim();
        if (!title) return;
        this.config.callbacks.onStep?.({
            ...step,
            title,
            detail: step.detail ? String(step.detail).trim() : undefined
        });
    }

    /**
     * 运行 Agent
     *
     * @param task 用户任务描述
     * @param images 可选的图片附件
     */
    async run(task: string, images?: ImageAttachment[]): Promise<AgentRunResult> {
        const requireInitialToolCall = this.config.requireInitialToolCall !== false;
        this.currentTask = task;
        // 初始化消息历史
        this.messages = [
            { role: 'system', content: this.config.systemPrompt },
            this.buildUserMessage(task, images)
        ];
        this.iteration = 0;
        this.toolCallLog = [];
        this.lastToolBatchSignature = '';
        this.repeatedToolBatchCount = 0;
        this.consecutiveFailedToolRounds = 0;
        this.finalizationNudgeSent = false;
        this.visibleReasoningSent = false;

        this.emitStep({
            kind: 'task_started',
            title: '开始处理任务',
            detail: images?.length ? `包含 ${images.length} 张图片输入` : '无图片输入',
            status: 'running',
            percent: 0
        });
        this.config.callbacks.onProgress?.('Agent 开始执行...', 0);

        while (this.iteration < this.config.maxIterations) {
            // 检查取消
            if (this.config.signal?.aborted) {
                this.emitStep({
                    kind: 'stopped',
                    title: '任务已取消',
                    status: 'error',
                    iteration: this.iteration,
                    maxIterations: this.config.maxIterations
                });
                return this.buildRunResult({
                    success: false,
                    message: '任务已取消',
                    iterations: this.iteration,
                    cancelled: true,
                    stopReason: 'cancelled'
                });
            }

            this.addFinalizationNudgeIfNeeded();

            const progressPercent = Math.round(
                (this.iteration / this.config.maxIterations) * 100
            );
            this.config.callbacks.onProgress?.(
                `迭代 ${this.iteration + 1}/${this.config.maxIterations}`,
                progressPercent
            );
            this.emitStep({
                kind: 'iteration_started',
                title: `第 ${this.iteration + 1} 轮：准备调用模型`,
                detail: `可用工具 ${this.config.tools.length} 个，已有工具调用 ${this.toolCallLog.length} 次`,
                status: 'running',
                iteration: this.iteration + 1,
                maxIterations: this.config.maxIterations,
                percent: progressPercent
            });

            try {
                if (this.shouldForceFinalResponse()) {
                    return await this.requestForcedFinalResponse();
                }

                await this.requestInitialVisibleReasoningIfNeeded(requireInitialToolCall);

                // 1. 调模型（带 tools）
                this.emitStep({
                    kind: 'model_request',
                    title: '请求模型规划下一步',
                    detail: `模型: ${this.config.modelId}；上下文消息 ${this.messages.length} 条`,
                    status: 'running',
                    iteration: this.iteration + 1,
                    maxIterations: this.config.maxIterations
                });
                const response = await this.requestModelWithOptionalStream(
                    this.config.modelId,
                    this.messages,
                    this.config.tools,
                    { maxTokens: 4096, temperature: 0.7 }
                );

                // 2. 如果模型返回可读的思考摘要，通知 UI；损坏/乱码内容不展示也不伪造。
                const modelThinking = normalizeThinkingForUi(response.thinking);
                if (modelThinking) {
                    this.emitVisibleReasoning(modelThinking, { source: 'provider_final_thinking' });
                }

                // 3. 如果没有 tool_calls
                if (!response.toolCalls?.length) {
                    this.emitStep({
                        kind: 'model_response',
                        title: '模型没有请求工具',
                        detail: response.content
                            ? `返回文本 ${String(response.content).trim().length} 字`
                            : '没有返回可展示文本',
                        status: response.content ? 'success' : 'error',
                        issue: response.content ? undefined : 'empty_model_response',
                        iteration: this.iteration + 1,
                        maxIterations: this.config.maxIterations
                    });
                    console.log(`[Agent] Iteration ${this.iteration}: no tool calls, stopReason=${response.stopReason}, content=${(response.content || '').substring(0, 100)}`);

                    // 前两轮没调工具 → 强制重试，插入 nudge 消息
                    if (requireInitialToolCall && this.iteration < 2 && this.toolCallLog.length === 0) {
                        this.emitStep({
                            kind: 'warning',
                            title: '模型未执行任务，要求重新规划工具调用',
                            detail: '当前任务需要实际工具操作，系统已插入提醒让模型下一轮调用工具。',
                            status: 'error',
                            iteration: this.iteration + 1,
                            maxIterations: this.config.maxIterations,
                            issue: 'missing_initial_tool_call'
                        });
                        this.messages.push({
                            role: 'assistant',
                            content: response.content || ''
                        });
                        this.messages.push({
                            role: 'user',
                            content: 'Do NOT reply with text. You MUST call a tool now. Start by calling getDocumentInfo or another relevant tool. 不要用文字回答，请直接调用工具执行任务。'
                        });
                        this.iteration++;
                        continue;
                    }

                    // 已执行过工具 → 最终回答，结束
                    const finalMessage = String(response.content || '').trim();
                    if (!finalMessage) {
                        return this.buildEmptyFinalResponseResult();
                    }
                    this.config.callbacks.onMessage?.(finalMessage);

                    this.messages.push({
                        role: 'assistant',
                        content: finalMessage
                    });

                    return this.buildRunResult({
                        success: true,
                        message: finalMessage,
                        iterations: this.iteration + 1,
                        stopReason: 'final_response'
                    });
                }

                // 4. 有 tool_calls：记录 assistant 消息
                this.emitStep({
                    kind: 'model_response',
                    title: `模型计划执行 ${response.toolCalls.length} 个工具`,
                    detail: response.toolCalls.map((call) => call.name).join(', '),
                    status: 'success',
                    iteration: this.iteration + 1,
                    maxIterations: this.config.maxIterations
                });
                this.messages.push({
                    role: 'assistant',
                    content: response.content || '',
                    toolCalls: response.toolCalls
                });

                this.emitVisibleReasoning(response.content, { source: 'model_visible_reasoning' });

                const toolDecisionContract = buildAgentToolDecisionContract({
                    userInput: this.currentTask,
                    intentControlPlane: this.config.toolDecisionContext?.intentControlPlane
                        || buildAgentIntentControlPlaneDecision({
                            userInput: this.currentTask,
                            hasImageInput: this.config.toolDecisionContext?.hasImageInput,
                            hasDocument: this.config.toolDecisionContext?.hasDocument,
                            photoshopConnected: this.config.toolDecisionContext?.photoshopConnected
                        }),
                    assistantContent: response.content,
                    toolCalls: response.toolCalls,
                    completedToolCalls: this.toolCallLog,
                    runtime: {
                        availableTools: this.config.tools.map((tool) => tool.name),
                        photoshopConnected: this.config.toolDecisionContext?.photoshopConnected,
                        hasDocument: this.config.toolDecisionContext?.hasDocument
                    }
                });
                if (toolDecisionContract.status === 'blocked') {
                    const blockedMessage = formatAgentToolDecisionContractBlocker(toolDecisionContract)
                        || '工具决策契约未通过，已阻止本轮工具执行。';
                    const blockedIssue = toolDecisionContract.blockers.every((item) => PREFLIGHT_TOOL_DECISION_BLOCKERS.has(item.code))
                        ? 'agent_tool_execution_preflight_blocked'
                        : 'agent_tool_decision_contract_blocked';
                    this.emitStep({
                        kind: 'warning',
                        title: '工具决策契约未通过',
                        detail: blockedMessage,
                        status: 'error',
                        iteration: this.iteration + 1,
                        maxIterations: this.config.maxIterations,
                        issue: blockedIssue
                    });
                    this.messages.push({
                        role: 'tool_result',
                        toolResults: response.toolCalls.map((call) => ({
                            callId: call.id,
                            success: false,
                            output: {
                                success: false,
                                error: blockedMessage,
                                code: blockedIssue,
                                toolDecisionContract
                            }
                        }))
                    });
                    this.config.callbacks.onProgress?.('工具决策契约未通过，已停止本轮工具执行', 100);
                    return this.buildRunResult({
                        success: false,
                        message: blockedMessage,
                        iterations: this.iteration + 1,
                        error: blockedIssue,
                        stopReason: 'tool_preflight_blocked'
                    });
                }

                // 5. 执行每个 tool_call
                const toolResults: ToolResult[] = [];

                for (const call of response.toolCalls) {
                    const toolExecutionPreflight = buildAgentToolExecutionPreflight({
                        assistantContent: response.content,
                        toolCalls: [call],
                        completedToolCalls: this.toolCallLog
                    });
                    if (!toolExecutionPreflight.ready && toolExecutionPreflight.status === 'blocked') {
                        const blockedMessage = toolExecutionPreflight.message || `已阻止工具执行：${call.name}。`;
                        this.emitStep({
                            kind: 'warning',
                            title: '工具执行前置检查未通过',
                            detail: blockedMessage,
                            status: 'error',
                            iteration: this.iteration + 1,
                            maxIterations: this.config.maxIterations,
                            toolName: call.name,
                            toolCallId: call.id,
                            issue: toolExecutionPreflight.issue || 'agent_tool_execution_preflight_blocked'
                        });
                        this.messages.push({
                            role: 'tool_result',
                            toolResults: [{
                                callId: call.id,
                                success: false,
                                output: {
                                    success: false,
                                    error: blockedMessage,
                                    code: toolExecutionPreflight.issue || 'agent_tool_execution_preflight_blocked',
                                    preflight: toolExecutionPreflight
                                }
                            }]
                        });
                        this.config.callbacks.onProgress?.('工具执行前置检查未通过，已停止潜在写入', 100);
                        return this.buildRunResult({
                            success: false,
                            message: blockedMessage,
                            iterations: this.iteration + 1,
                            error: toolExecutionPreflight.issue || 'agent_tool_execution_preflight_blocked',
                            stopReason: 'tool_preflight_blocked'
                        });
                    }

                    // 检查取消
                    if (this.config.signal?.aborted) {
                        this.emitStep({
                            kind: 'stopped',
                            title: '任务已取消',
                            detail: `取消时正在处理工具: ${call.name}`,
                            status: 'error',
                            iteration: this.iteration + 1,
                            maxIterations: this.config.maxIterations,
                            toolName: call.name,
                            toolCallId: call.id
                        });
                        return this.buildRunResult({
                            success: false,
                            message: '任务已取消（工具执行中）',
                            iterations: this.iteration + 1,
                            cancelled: true,
                            stopReason: 'cancelled'
                        });
                    }

                    this.emitStep({
                        kind: 'tool_planned',
                        title: `准备执行工具：${call.name}`,
                        detail: summarizeToolArguments(call.arguments),
                        status: 'pending',
                        iteration: this.iteration + 1,
                        maxIterations: this.config.maxIterations,
                        toolName: call.name,
                        toolCallId: call.id
                    });
                    this.emitStep({
                        kind: 'tool_started',
                        title: `执行工具：${call.name}`,
                        detail: summarizeToolArguments(call.arguments),
                        status: 'running',
                        iteration: this.iteration + 1,
                        maxIterations: this.config.maxIterations,
                        toolName: call.name,
                        toolCallId: call.id
                    });
                    this.config.callbacks.onToolStart?.(call.name);

                    let result: any;
                    try {
                        result = await this.executeTool(call.name, call.arguments);
                    } catch (e: any) {
                        result = { success: false, error: e.message || 'Tool execution failed' };
                    }

                    const success = result?.success !== false;
                    this.emitStep({
                        kind: 'tool_completed',
                        title: `${success ? '工具完成' : '工具失败'}：${call.name}`,
                        detail: summarizeToolResult(result),
                        status: success ? 'success' : 'error',
                        iteration: this.iteration + 1,
                        maxIterations: this.config.maxIterations,
                        toolName: call.name,
                        toolCallId: call.id,
                        issue: success ? undefined : compactError(result) || 'tool_failed'
                    });
                    toolResults.push({
                        callId: call.id,
                        success,
                        output: result
                    });

                    this.toolCallLog.push({
                        name: call.name,
                        arguments: call.arguments,
                        result
                    });

                    this.config.callbacks.onToolComplete?.(call.name, result);
                }

                // 6. 添加 tool_result 消息
                this.messages.push({
                    role: 'tool_result',
                    toolResults
                });
                const successfulTools = toolResults.filter((result) => result.success).length;
                const failedTools = toolResults.length - successfulTools;
                this.emitStep({
                    kind: 'observation',
                    title: '观察工具执行结果',
                    detail: `本轮成功 ${successfulTools} 个，失败 ${failedTools} 个。`,
                    status: failedTools > 0 ? 'error' : 'success',
                    iteration: this.iteration + 1,
                    maxIterations: this.config.maxIterations,
                    issue: failedTools > 0 ? 'tool_failures_in_round' : undefined
                });

                const noProgressMessage = this.updateLoopGuards(response.toolCalls, toolResults);
                if (noProgressMessage) {
                    this.emitStep({
                        kind: 'stopped',
                        title: '检测到无进展循环，停止执行',
                        detail: noProgressMessage.split('\n')[0],
                        status: 'error',
                        iteration: this.iteration + 1,
                        maxIterations: this.config.maxIterations,
                        issue: 'no_progress'
                    });
                    this.config.callbacks.onProgress?.('检测到重复或失败循环，已停止', 100);
                    return this.buildRunResult({
                        success: false,
                        message: noProgressMessage,
                        iterations: this.iteration + 1,
                        error: 'No progress detected',
                        stopReason: 'no_progress'
                    });
                }

                // 7. 上下文管理（超长时截断旧的 tool 结果）
                this.messages = this.contextManager.trim(this.messages);

                // 8. 通知迭代完成
                const completedIteration = this.iteration + 1;
                this.config.callbacks.onIterationComplete?.(
                    completedIteration,
                    this.config.maxIterations
                );

                this.iteration = completedIteration;

                if (this.iteration >= this.config.maxIterations) {
                    return await this.requestForcedFinalResponse(this.iteration);
                }

            } catch (error: any) {
                console.error(`[Agent] Iteration ${this.iteration} error:`, error);

                // 模型调用失败：尝试恢复一次
                if (this.iteration > 0) {
                    return this.buildRunResult({
                        success: false,
                        message: `Agent 执行出错: ${error.message}`,
                        iterations: this.iteration,
                        error: error.message,
                        stopReason: 'error'
                    });
                }

                // 第一轮就失败：直接抛出
                throw error;
            }
        }

        // 达到最大迭代次数
        this.config.callbacks.onProgress?.('达到最大迭代次数，任务未确认完成', 100);
        return this.buildRunResult({
            success: false,
            message: this.buildMaxIterationsMessage(),
            iterations: this.iteration,
            error: 'Max iterations reached',
            stopReason: 'max_iterations'
        });
    }

    /**
     * 构建用户消息
     * 有图片时返回带 contentBlocks 的 multimodal 消息
     */
    private buildUserMessage(task: string, images?: ImageAttachment[]): AgentMessage {
        if (!images?.length) {
            return { role: 'user', content: task };
        }
        const blocks: ContentBlock[] = [
            { type: 'text', text: task },
            ...images.map(img => ({
                type: 'image' as const,
                data: img.data,
                mediaType: img.mediaType
            }))
        ];
        return { role: 'user', content: task, contentBlocks: blocks };
    }

    private addFinalizationNudgeIfNeeded(): void {
        const remainingIterations = this.config.maxIterations - this.iteration;
        if (this.finalizationNudgeSent
            || this.toolCallLog.length === 0
            || remainingIterations > FINALIZATION_NUDGE_REMAINING_ITERATIONS) {
            return;
        }

        this.finalizationNudgeSent = true;
        this.emitStep({
            kind: 'warning',
            title: '迭代预算接近上限',
            detail: '系统要求模型停止重复检查，完成则总结，未完成则说明缺口。',
            status: 'error',
            iteration: this.iteration + 1,
            maxIterations: this.config.maxIterations,
            issue: 'tool_budget_near_limit'
        });
        this.messages.push({
            role: 'user',
            content: [
                'Execution limit is near. Do not keep inspecting or repeating tools.',
                'If the task is already completed and verified, stop calling tools and provide the final Chinese result.',
                'If the task cannot be completed or verified with the current tools, stop calling tools and report what is incomplete.',
                'Only call another tool if it directly completes or verifies the user task.'
            ].join('\n')
        });
    }

    private shouldForceFinalResponse(): boolean {
        const remainingIterations = this.config.maxIterations - this.iteration;
        return this.finalizationNudgeSent
            && this.toolCallLog.length > 0
            && remainingIterations <= 1;
    }

    private async requestForcedFinalResponse(iterations = this.iteration + 1): Promise<AgentRunResult> {
        this.emitStep({
            kind: 'finalizing',
            title: '工具预算耗尽，要求模型给出真实总结',
            detail: '后续不再允许调用工具，模型必须基于已有执行结果说明完成或未完成。',
            status: 'running',
            iteration: iterations,
            maxIterations: this.config.maxIterations,
            percent: 98
        });
        this.config.callbacks.onProgress?.('工具预算即将耗尽，停止继续调用工具并要求模型总结', 98);
        this.messages.push({
            role: 'user',
            content: [
                'Tool budget is exhausted. Tools are now unavailable.',
                'Return a concise Chinese task report only.',
                'Do not claim the task is fully completed unless the tool evidence proves it.',
                'If any step is incomplete or unverified, explicitly say it needs review.'
            ].join('\n')
        });

        const response = await this.callModel(
            this.config.modelId,
            this.messages,
            [],
            { maxTokens: 2048, temperature: 0.2 }
        );

        const modelThinking = normalizeThinkingForUi(response.thinking);
        if (modelThinking) {
            this.emitVisibleReasoning(modelThinking, { source: 'provider_final_thinking' });
        }

        const finalMessage = String(response.content || '').trim();
        if (!finalMessage) {
            this.emitStep({
                kind: 'stopped',
                title: '模型没有给出最终可展示结果',
                status: 'error',
                iteration: iterations,
                maxIterations: this.config.maxIterations,
                issue: 'empty_final_response'
            });
            return this.buildEmptyFinalResponseResult(iterations);
        }

        this.messages.push({
            role: 'assistant',
            content: finalMessage
        });

        return this.buildRunResult({
            success: false,
            message: finalMessage,
            iterations,
            stopReason: 'tool_budget_final_response'
        });
    }

    private emitVisibleReasoning(value: unknown, meta: AgentThinkingEventMeta): void {
        const text = normalizeThinkingForUi(value);
        if (!text) return;
        this.visibleReasoningSent = true;
        this.config.callbacks.onThinking?.(text, meta);
    }

    private async requestModelWithOptionalStream(
        modelId: string,
        messages: AgentMessage[],
        tools: ToolCall[] | any[],
        options: { maxTokens?: number; temperature?: number; nativeTools?: ProviderNativeToolRequest[] }
    ): ReturnType<CallModelFn> {
        if (!this.config.callModelStream) {
            return this.callModel(modelId, messages, tools as any, options);
        }

        let modelContent = '';
        let modelHasStartedToolCall = false;
        return this.config.callModelStream(modelId, messages, tools as any, {
            ...options,
            onThinkingDelta: (fullThinking) => {
                this.emitVisibleReasoning(fullThinking, { source: 'provider_thinking_delta' });
            },
            onContentDelta: (fullContent) => {
                modelContent = fullContent;
                if (modelHasStartedToolCall) {
                    this.emitVisibleReasoning(modelContent, { source: 'model_visible_reasoning' });
                }
            },
            onToolCallDelta: () => {
                modelHasStartedToolCall = true;
                if (modelContent) {
                    this.emitVisibleReasoning(modelContent, { source: 'model_visible_reasoning' });
                }
            }
        });
    }

    private async requestInitialVisibleReasoningIfNeeded(requireInitialToolCall: boolean): Promise<void> {
        if (this.visibleReasoningSent
            || !requireInitialToolCall
            || this.iteration !== 0
            || !this.config.callbacks.onThinking) {
            return;
        }

        const prompt = [
            '你需要输出一段给用户看的公开判断，用于解释接下来为什么要调用工具。',
            '要求：',
            '1. 使用简体中文，1 到 3 句。',
            '2. 只说明你对用户任务的理解、当前需要确认的信息、准备先做什么。',
            '3. 不要输出 JSON，不要列内部字段，不要说任务已经完成。',
            '4. 不要暴露私有链式思维，不要编造已经读取到的 Photoshop 状态。',
            '',
            `用户任务：${this.currentTask || ''}`
        ].join('\n');

        try {
            const response = await this.callModel(
                this.config.modelId,
                [
                    {
                        role: 'system',
                        content: [
                            'You are DesignEcho Agent.',
                            'Return only a short user-visible reasoning summary in Chinese.',
                            'Do not call tools. Do not output private chain-of-thought.'
                        ].join('\n')
                    },
                    { role: 'user', content: prompt }
                ],
                [],
                { maxTokens: 220, temperature: 0.2 }
            );
            this.emitVisibleReasoning(response.thinking || response.content, { source: 'model_visible_reasoning' });
        } catch (error) {
            console.warn('[Agent] visible reasoning preflight failed; continue with tool loop:', error);
        }
    }

    private updateLoopGuards(toolCalls: ToolCall[], toolResults: ToolResult[]): string | null {
        const batchSignature = buildToolBatchSignature(toolCalls);
        if (batchSignature && batchSignature === this.lastToolBatchSignature) {
            this.repeatedToolBatchCount += 1;
        } else {
            this.lastToolBatchSignature = batchSignature;
            this.repeatedToolBatchCount = 1;
        }

        const allFailed = toolResults.length > 0 && toolResults.every((result) => !result.success);
        this.consecutiveFailedToolRounds = allFailed ? this.consecutiveFailedToolRounds + 1 : 0;

        if (this.repeatedToolBatchCount >= REPEATED_TOOL_BATCH_LIMIT) {
            const toolNames = toolCalls.map((call) => call.name).join(', ') || 'unknown';
            return [
                '检测到 Agent 连续重复相同工具调用，任务未能确认完成，已停止以避免空转。',
                `重复工具链: ${toolNames}`,
                `已执行工具调用: ${this.toolCallLog.length} 次。`,
                this.buildLastToolSummary()
            ].filter(Boolean).join('\n');
        }

        if (this.consecutiveFailedToolRounds >= CONSECUTIVE_FAILED_TOOL_ROUND_LIMIT) {
            return [
                '检测到工具连续失败，任务未能确认完成，已停止以避免继续消耗迭代次数。',
                `连续失败轮数: ${this.consecutiveFailedToolRounds}`,
                `已执行工具调用: ${this.toolCallLog.length} 次。`,
                this.buildLastToolSummary()
            ].filter(Boolean).join('\n');
        }

        return null;
    }

    private buildLastToolSummary(): string {
        const last = this.toolCallLog[this.toolCallLog.length - 1];
        if (!last) return '尚未执行任何工具。';

        const error = compactError(last.result);
        return [
            `最后工具: ${last.name}`,
            error ? `最后错误: ${error}` : ''
        ].filter(Boolean).join('\n');
    }

    private buildMaxIterationsMessage(): string {
        return [
            'Agent 达到最大迭代次数，任务未能确认完成。',
            `已执行工具调用: ${this.toolCallLog.length} 次。`,
            this.buildLastToolSummary(),
            '系统已停止继续空转；后续应从未完成或未验证的步骤继续，而不是把当前结果视为已完成。'
        ].filter(Boolean).join('\n');
    }

    private buildEmptyFinalResponseResult(iterations = this.iteration + 1): AgentRunResult {
        return this.buildRunResult({
            success: false,
            message: [
                '模型停止调用工具，但没有给出可展示的完成结果，任务未能确认完成。',
                `已执行工具调用: ${this.toolCallLog.length} 次。`,
                this.buildLastToolSummary()
            ].filter(Boolean).join('\n'),
            iterations,
            error: 'Empty final response',
            stopReason: 'empty_final_response'
        });
    }

    private buildRunResult(input: {
        success: boolean;
        message: string;
        iterations: number;
        stopReason: AgentStopReason;
        cancelled?: boolean;
        error?: string;
    }): AgentRunResult {
        const executionSummary = this.buildExecutionSummary(input.stopReason, input.iterations);
        const success = input.success && executionSummary.status === 'completed';
        this.emitStep({
            kind: 'verification',
            title: `任务验收结论：${executionSummary.status === 'completed' ? '已完成' : executionSummary.status === 'cancelled' ? '已取消' : executionSummary.status === 'failed' ? '未完成' : '需复核'}`,
            detail: this.buildVerificationStepDetail(executionSummary),
            status: executionSummary.status === 'completed' ? 'success' : 'error',
            iteration: input.iterations,
            maxIterations: this.config.maxIterations,
            percent: 100,
            issue: executionSummary.status === 'completed' ? undefined : executionSummary.stopReason
        });
        return {
            success,
            message: success
                ? input.message
                : this.buildNonCompletedResultMessage(input.message, executionSummary),
            messages: this.messages,
            iterations: input.iterations,
            toolCallLog: this.toolCallLog,
            cancelled: input.cancelled,
            error: input.error,
            stopReason: input.stopReason,
            executionSummary
        };
    }

    private buildVerificationStepDetail(summary: AgentExecutionSummary): string {
        const lines = [summary.summaryText];
        if (summary.blockers.length) {
            lines.push(`阻断原因：${summary.blockers.slice(0, 2).join('；')}`);
        }
        if (summary.warnings.length) {
            lines.push(`复核提醒：${summary.warnings.slice(0, 2).join('；')}`);
        }
        return lines.filter(Boolean).join('\n');
    }

    private buildExecutionSummary(stopReason: AgentStopReason, iterations: number): AgentExecutionSummary {
        const toolCallCount = this.toolCallLog.length;
        let successfulToolCalls = 0;
        let failedToolCalls = 0;
        let acceptanceVerified = 0;
        let acceptanceFailed = 0;
        let acceptanceNeedsReview = 0;
        let noDocumentChangeRisks = 0;

        for (const item of this.toolCallLog) {
            const result = item.result || {};
            const toolSucceeded = result?.success !== false;
            if (toolSucceeded) {
                successfulToolCalls += 1;
            } else {
                failedToolCalls += 1;
            }

            const acceptance = result?.acceptance;
            if (!acceptance?.enabled) continue;
            if (acceptance.verified === true) {
                acceptanceVerified += 1;
            }
            if (acceptance.assertionStatus === 'failed') {
                acceptanceFailed += 1;
            }
            if (acceptance.assertionStatus === 'needs_review'
                || acceptance.noDocumentChangeRisk === true
                || (acceptance.verified === false && acceptance.assertionStatus !== 'failed')) {
                acceptanceNeedsReview += 1;
            }
            if (acceptance.noDocumentChangeRisk === true) {
                noDocumentChangeRisks += 1;
            }
        }

        const last = this.toolCallLog[this.toolCallLog.length - 1];
        const lastError = last ? compactError(last.result) : undefined;
        const taskCompletion = buildTaskCompletionContract({
            task: this.currentTask,
            context: this.config.taskCompletionContext,
            toolCallLog: this.toolCallLog
        });
        const blockers: string[] = [];
        const warnings: string[] = [];

        if (stopReason === 'max_iterations') {
            blockers.push('达到最大迭代次数，任务未能确认完成。');
        } else if (stopReason === 'no_progress') {
            blockers.push('检测到重复或失败循环，已停止。');
        } else if (stopReason === 'tool_preflight_blocked') {
            blockers.push('工具执行前置检查未通过，系统已阻止潜在写入。');
        } else if (stopReason === 'empty_final_response') {
            blockers.push('模型停止调用工具，但没有给出可展示结果。');
        } else if (stopReason === 'error') {
            blockers.push('Agent 运行过程发生错误。');
        } else if (stopReason === 'tool_budget_final_response') {
            warnings.push('工具预算已用尽，系统已阻止继续调用工具并要求模型总结；结果需要复核。');
        }

        if (toolCallCount > 0 && successfulToolCalls === 0) {
            blockers.push('所有工具调用均未成功。');
        }
        if (acceptanceFailed > 0) {
            blockers.push(`存在 ${acceptanceFailed} 个验收断言失败。`);
        }
        if (failedToolCalls > 0 && successfulToolCalls > 0) {
            warnings.push(`存在 ${failedToolCalls} 个工具调用失败，需要判断是否影响最终结果。`);
        }
        if (acceptanceNeedsReview > 0) {
            warnings.push(`存在 ${acceptanceNeedsReview} 个验收项需要复核。`);
        }
        if (noDocumentChangeRisks > 0) {
            warnings.push(`存在 ${noDocumentChangeRisks} 次工具返回成功但未检测到文档变化的风险。`);
        }
        if (lastError) {
            warnings.push(`最后错误: ${lastError}`);
        }
        if (taskCompletion?.status === 'failed') {
            blockers.push(`任务完成契约未通过：${taskCompletion.summary}`);
        } else if (taskCompletion?.status === 'needs_review') {
            warnings.push(`任务完成契约需要复核：${taskCompletion.summary}`);
        }

        const status = this.resolveExecutionStatus({
            stopReason,
            toolCallCount,
            successfulToolCalls,
            failedToolCalls,
            acceptanceFailed,
            acceptanceNeedsReview,
            noDocumentChangeRisks,
            taskCompletionStatus: taskCompletion?.status
        });

        return {
            status,
            stopReason,
            iterations,
            toolCallCount,
            successfulToolCalls,
            failedToolCalls,
            acceptanceVerified,
            acceptanceFailed,
            acceptanceNeedsReview,
            noDocumentChangeRisks,
            lastToolName: last?.name,
            lastError,
            blockers,
            warnings,
            taskCompletion,
            summaryText: this.formatExecutionSummaryText(status, {
                toolCallCount,
                successfulToolCalls,
                failedToolCalls,
                acceptanceVerified,
                acceptanceFailed,
                acceptanceNeedsReview,
                noDocumentChangeRisks,
                blockers,
                warnings
            })
        };
    }

    private resolveExecutionStatus(input: {
        stopReason: AgentStopReason;
        toolCallCount: number;
        successfulToolCalls: number;
        failedToolCalls: number;
        acceptanceFailed: number;
        acceptanceNeedsReview: number;
        noDocumentChangeRisks: number;
        taskCompletionStatus?: AgentExecutionSummary['status'];
    }): AgentExecutionSummary['status'] {
        if (input.stopReason === 'cancelled') return 'cancelled';
        if (input.taskCompletionStatus === 'failed') return 'failed';
        if (input.stopReason === 'tool_budget_final_response') {
            if (input.toolCallCount > 0 && input.successfulToolCalls === 0) return 'failed';
            if (input.acceptanceFailed > 0) return 'failed';
            return 'needs_review';
        }
        if (input.stopReason !== 'final_response') return 'failed';
        if (input.toolCallCount > 0 && input.successfulToolCalls === 0) return 'failed';
        if (input.acceptanceFailed > 0) return 'failed';
        if (input.failedToolCalls > 0 || input.acceptanceNeedsReview > 0 || input.noDocumentChangeRisks > 0) {
            return 'needs_review';
        }
        if (input.taskCompletionStatus === 'needs_review') return 'needs_review';
        return 'completed';
    }

    private formatExecutionSummaryText(
        status: AgentExecutionSummary['status'],
        input: {
            toolCallCount: number;
            successfulToolCalls: number;
            failedToolCalls: number;
            acceptanceVerified: number;
            acceptanceFailed: number;
            acceptanceNeedsReview: number;
            noDocumentChangeRisks: number;
            blockers: string[];
            warnings: string[];
        }
    ): string {
        const statusText: Record<AgentExecutionSummary['status'], string> = {
            completed: '已完成',
            needs_review: '需复核',
            failed: '未完成',
            cancelled: '已取消'
        };
        const evidence = [
            `工具调用 ${input.toolCallCount} 次`,
            `成功 ${input.successfulToolCalls} 次`,
            `失败 ${input.failedToolCalls} 次`,
            input.acceptanceVerified > 0 ? `验收通过 ${input.acceptanceVerified} 项` : '',
            input.acceptanceFailed > 0 ? `验收失败 ${input.acceptanceFailed} 项` : '',
            input.acceptanceNeedsReview > 0 ? `需复核验收 ${input.acceptanceNeedsReview} 项` : '',
            input.noDocumentChangeRisks > 0 ? `无变化风险 ${input.noDocumentChangeRisks} 项` : ''
        ].filter(Boolean).join('，');
        const reason = input.blockers[0] || input.warnings[0] || '';
        return `执行状态：${statusText[status]}。${evidence}${reason ? `。${reason}` : ''}`;
    }

    private buildNonCompletedResultMessage(message: string, summary: AgentExecutionSummary): string {
        const trimmed = String(message || '').trim();
        const lines = [summary.summaryText];

        if (summary.blockers.length) {
            lines.push(`阻断原因：${summary.blockers.join('；')}`);
        }
        if (summary.warnings.length) {
            lines.push(`复核提醒：${summary.warnings.slice(0, 3).join('；')}`);
        }
        if (summary.taskCompletion) {
            const failedRequirements = summary.taskCompletion.required
                .filter((item) => item.status !== 'passed' && item.status !== 'not_applicable')
                .map((item) => `${item.label}: ${item.reason || item.status}`);
            if (failedRequirements.length) {
                lines.push(`任务完成契约：${failedRequirements.slice(0, 4).join('；')}`);
            }
        }

        if (!trimmed || trimmed.includes(summary.summaryText)) {
            return lines.join('\n');
        }

        const modelFinalCanBeOptimistic = summary.stopReason === 'final_response'
            || summary.stopReason === 'tool_budget_final_response';
        if (modelFinalCanBeOptimistic && this.looksLikeCompletionClaim(trimmed)) {
            lines.push('模型最后回复包含完成表述，但当前执行摘要未通过，已不作为完成结论展示。');
        } else {
            lines.push(`补充说明：${trimmed}`);
        }

        return lines.join('\n');
    }

    private looksLikeCompletionClaim(message: string): boolean {
        return /((我|已|已经|已为您|我已经).{0,12}(完成|成功|处理|复刻|创建|保存|验证)|成功为您|完成了|已保存|successfully|completed)/i
            .test(message);
    }

}
