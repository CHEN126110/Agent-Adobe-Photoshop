import type { AgentResult } from '../unified-agent.service';
import type { SkillExecuteParams, SkillExecutor } from './types';

import {
    buildControlledPhotoshopTextStyleBatchPlan,
    buildControlledPhotoshopTextStyleBenchmarkReport,
    buildControlledPhotoshopTextStyleToolCallPlan,
    executeControlledPhotoshopTextStyleToolCallPlan,
    type ControlledPhotoshopTextStyleExecutionResult,
    type ControlledPhotoshopTextStylePlanEvidence,
    type ControlledPhotoshopTextStyleTarget,
    type ControlledPhotoshopTextStyleToolCallPlan
} from '../../../shared/photoshop-controlled-text-style-execution';
import { executeToolCall } from '../tool-executor.service';
import { emitSkillStep, executeObservedSkillTool } from './skill-step-events';

type TextLayerRecord = {
    id: number;
    name: string;
    style?: {
        fontName?: string;
    };
};

interface ControlledTextStyleBatchEvidence {
    plan: ControlledPhotoshopTextStylePlanEvidence;
    toolCallPlan: ControlledPhotoshopTextStyleToolCallPlan;
    execution?: ControlledPhotoshopTextStyleExecutionResult;
    benchmark?: ReturnType<typeof buildControlledPhotoshopTextStyleBenchmarkReport>;
}

function normalizeFontToken(value: unknown): string {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[\s\-_/]+/g, '')
        .replace(/[()（）]/g, '');
}

function fontMatchesTarget(actualValue: string, targetValues: string[]): boolean {
    const actual = normalizeFontToken(actualValue);
    if (!actual) return false;
    return targetValues.some((candidate) => normalizeFontToken(candidate) === actual);
}

function buildControlledTargets(layers: TextLayerRecord[]): ControlledPhotoshopTextStyleTarget[] {
    return layers.map((layer) => ({
        layerId: Number(layer.id),
        layerName: String(layer.name || layer.id),
        kind: 'text',
        style: {
            fontName: layer.style?.fontName
        }
    }));
}

function buildControlledBatchEvidence(
    input: {
        userIntent: string;
        targetLayers: TextLayerRecord[];
        requestedFont: string;
        resolvedFontCandidates: string[];
    }
): ControlledTextStyleBatchEvidence {
    const plan = buildControlledPhotoshopTextStyleBatchPlan({
        kind: 'text-style-batch',
        userIntent: input.userIntent,
        targets: buildControlledTargets(input.targetLayers),
        style: {
            fontName: input.requestedFont,
            acceptedFontNames: input.resolvedFontCandidates
        }
    });
    const toolCallPlan = buildControlledPhotoshopTextStyleToolCallPlan(plan);
    return {
        plan,
        toolCallPlan,
        benchmark: buildControlledPhotoshopTextStyleBenchmarkReport(plan, toolCallPlan)
    };
}

function appendResolvedFontCandidates(current: string[], requestedFont: string, resolvedFont: any): string[] {
    return Array.from(new Set([
        requestedFont,
        ...current,
        resolvedFont?.postScriptName,
        resolvedFont?.family,
        resolvedFont?.name
    ].filter(Boolean)));
}

export const textFontReplaceExecutor: SkillExecutor = {
    skillId: 'text-font-replace',

    async execute({ params, callbacks, signal, context }: SkillExecuteParams): Promise<AgentResult> {
        const results: any[] = [];
        const requestedFont = String(params.fontName || '').trim();
        const includeHidden = params.includeHidden === true;
        const userIntent = String(context?.userInput || params.userIntent || '').trim();
        const explicitLayerIds = Array.isArray(params.layerIds)
            ? params.layerIds.map((item: unknown) => Number(item)).filter((item: number) => Number.isFinite(item))
            : [];

        if (!requestedFont) {
            return {
                success: false,
                message: '缺少目标字体名称。',
                error: 'fontName is required'
            };
        }

        const callTool = (toolName: string, toolParams: Record<string, any>, detail?: string) => {
            return executeObservedSkillTool(callbacks, toolName, toolParams, executeToolCall, detail);
        };

        emitSkillStep(callbacks, {
            kind: 'observation',
            title: '准备批量字体替换',
            detail: explicitLayerIds.length > 0
                ? `目标字体：${requestedFont}，指定图层数：${explicitLayerIds.length}`
                : `目标字体：${requestedFont}，范围：全部文本图层`,
            status: 'running'
        });
        callbacks?.onProgress?.('读取文本图层', 0.08);
        callbacks?.onStatus?.('正在读取当前文档中的文本图层。');

        const textLayersResult = await callTool('getAllTextLayers', { includeHidden }, '读取可修改的文本图层。');
        results.push({ toolName: 'getAllTextLayers', result: textLayersResult });

        const allTextLayers: TextLayerRecord[] = Array.isArray(textLayersResult?.layers)
            ? textLayersResult.layers
            : [];

        if (!textLayersResult?.success) {
            return {
                success: false,
                message: `读取文本图层失败：${textLayersResult?.error || '未知错误'}`,
                error: textLayersResult?.error || 'getAllTextLayers failed',
                toolResults: results
            };
        }

        const targetLayers = explicitLayerIds.length > 0
            ? allTextLayers.filter((layer) => explicitLayerIds.includes(Number(layer.id)))
            : allTextLayers;

        emitSkillStep(callbacks, {
            kind: 'verification',
            title: '文本图层范围已确认',
            detail: `候选文本图层 ${allTextLayers.length} 个，实际目标 ${targetLayers.length} 个。`,
            status: targetLayers.length > 0 ? 'success' : 'error'
        });

        if (targetLayers.length === 0) {
            return {
                success: false,
                message: '当前文档中没有可修改的文本图层。',
                error: 'no text layers',
                toolResults: results
            };
        }

        const successes: Array<{ layerId: number; layerName: string; verifiedFont?: string }> = [];
        const failures: Array<{ layerId: number; layerName: string; error: string }> = [];

        let resolvedFontCandidates: string[] = [requestedFont];
        const controlledTextStyleBatch = buildControlledBatchEvidence({
            userIntent,
            targetLayers,
            requestedFont,
            resolvedFontCandidates
        });

        if (controlledTextStyleBatch.plan.status !== 'ready_dry_run'
            || controlledTextStyleBatch.toolCallPlan.status !== 'ready_tool_call_plan') {
            return {
                success: false,
                message: '受控文字样式批处理计划未就绪，已停止执行以避免不确定的 Photoshop 写入。',
                error: controlledTextStyleBatch.plan.blockers[0]
                    || controlledTextStyleBatch.toolCallPlan.blockers[0]
                    || 'controlled text style plan is not ready',
                toolResults: results,
                data: {
                    requestedFont,
                    controlledTextStyleBatch
                }
            };
        }

        let controlledCallIndex = 0;
        const controlledExecution = await executeControlledPhotoshopTextStyleToolCallPlan(
            controlledTextStyleBatch.toolCallPlan,
            {
                runToolCall: async (call) => {
                    controlledCallIndex += 1;
                    const layer = targetLayers.find((item) => Number(item.id) === Number(call.params.layerId));
                    const layerName = String(layer?.name || call.params.layerId);

                    callbacks?.onProgress?.(
                        `修改字体 ${controlledCallIndex}/${targetLayers.length}`,
                        0.15 + ((controlledCallIndex - 1) / Math.max(1, targetLayers.length)) * 0.65
                    );
                    callbacks?.onStatus?.(`正在修改字体：${layerName}`);

                    if (signal?.aborted) {
                        return {
                            success: false,
                            error: 'font replacement cancelled'
                        };
                    }

                    const styleResult = await callTool(
                        'setTextStyle',
                        call.params,
                        `图层：${layerName}，目标字体：${String(call.params.fontName || requestedFont)}`
                    );
                    results.push({ toolName: `setTextStyle[${call.params.layerId}]`, result: styleResult });

                    if (!styleResult?.success) {
                        const error = String(styleResult?.error || 'setTextStyle failed');
                        failures.push({
                            layerId: Number(call.params.layerId),
                            layerName,
                            error
                        });
                        return {
                            success: false,
                            error,
                            data: styleResult
                        };
                    }

                    resolvedFontCandidates = appendResolvedFontCandidates(
                        resolvedFontCandidates,
                        requestedFont,
                        styleResult?.resolvedFont
                    );

                    const verifiedFont = String(styleResult?.verifiedFont || '').trim();
                    if (!fontMatchesTarget(verifiedFont, resolvedFontCandidates)) {
                        const error = `字体写入未验证通过，实际字体：${verifiedFont || '未知'}`;
                        failures.push({
                            layerId: Number(call.params.layerId),
                            layerName,
                            error
                        });
                        return {
                            success: false,
                            error,
                            data: styleResult
                        };
                    }

                    successes.push({
                        layerId: Number(call.params.layerId),
                        layerName,
                        verifiedFont
                    });
                    return {
                        success: true,
                        data: styleResult
                    };
                }
            },
            {
                liveExecutionApproved: true,
                executionTarget: 'user-approved-document',
                continueOnToolFailure: true
            }
        );
        controlledTextStyleBatch.execution = controlledExecution;
        controlledTextStyleBatch.benchmark = buildControlledPhotoshopTextStyleBenchmarkReport(
            controlledTextStyleBatch.plan,
            controlledTextStyleBatch.toolCallPlan,
            controlledExecution
        );

        if (signal?.aborted) {
            return {
                success: false,
                cancelled: true,
                message: '批量字体替换已取消。',
                toolResults: results,
                data: {
                    requestedFont,
                    completed: successes.length,
                    failed: failures,
                    controlledTextStyleBatch
                }
            };
        }

        if (controlledExecution.status === 'failed_tool_call'
            && controlledExecution.executedToolCount < controlledTextStyleBatch.toolCallPlan.toolCalls.length) {
            return {
                success: false,
                message: `字体替换执行失败：${failures[0]?.error || controlledExecution.blockers[0] || '未知错误'}`,
                error: failures[0]?.error || controlledExecution.blockers[0] || 'controlled text style execution failed',
                toolResults: results,
                data: {
                    requestedFont,
                    resolvedFontCandidates,
                    totalLayers: targetLayers.length,
                    successes,
                    failures,
                    controlledTextStyleBatch
                }
            };
        }

        callbacks?.onProgress?.('复核字体结果', 0.9);
        callbacks?.onStatus?.('正在复核所有文本图层的字体结果。');

        const verificationResult = await callTool('getAllTextLayers', { includeHidden }, '复核字体写入后的文本图层状态。');
        results.push({ toolName: 'getAllTextLayers[verify]', result: verificationResult });

        if (!verificationResult?.success) {
            return {
                success: false,
                message: `字体修改后复核失败：${verificationResult?.error || '未知错误'}`,
                error: verificationResult?.error || 'verification failed',
                toolResults: results,
                data: {
                    requestedFont,
                    successes,
                    failures,
                    controlledTextStyleBatch
                }
            };
        }

        const verifiedLayers: TextLayerRecord[] = Array.isArray(verificationResult?.layers)
            ? verificationResult.layers
            : [];
        const verifyTargets = explicitLayerIds.length > 0
            ? verifiedLayers.filter((layer) => explicitLayerIds.includes(Number(layer.id)))
            : verifiedLayers;

        const mismatched = verifyTargets.filter((layer) => {
            const actualFont = String(layer?.style?.fontName || '').trim();
            return !fontMatchesTarget(actualFont, resolvedFontCandidates);
        });

        const finalFailures = [
            ...failures,
            ...mismatched
                .filter((layer) => !failures.some((item) => item.layerId === Number(layer.id)))
                .map((layer) => ({
                    layerId: Number(layer.id),
                    layerName: String(layer.name || layer.id),
                    error: `最终复核不匹配，当前字体：${String(layer?.style?.fontName || '').trim() || '未知'}`
                }))
        ];

        emitSkillStep(callbacks, {
            kind: 'verification',
            title: '字体替换复核完成',
            detail: finalFailures.length > 0
                ? `通过 ${successes.length}/${targetLayers.length}，失败 ${finalFailures.length}。`
                : `通过 ${targetLayers.length}/${targetLayers.length}。`,
            status: finalFailures.length > 0 ? 'error' : 'success'
        });

        if (finalFailures.length > 0) {
            return {
                success: false,
                message: `字体替换未完全成功：${successes.length}/${targetLayers.length} 个文本图层通过验证。`,
                error: 'font replacement verification failed',
                toolResults: results,
                data: {
                    requestedFont,
                    resolvedFontCandidates,
                    totalLayers: targetLayers.length,
                    successes,
                    failures: finalFailures,
                    controlledTextStyleBatch
                }
            };
        }

        const effectiveFont = resolvedFontCandidates[1] || requestedFont;
        return {
            success: true,
            message: `已将 ${targetLayers.length} 个文本图层的字体改为 ${requestedFont}。`,
            toolResults: results,
            data: {
                requestedFont,
                effectiveFont,
                totalLayers: targetLayers.length,
                successes,
                controlledTextStyleBatch
            }
        };
    }
};
