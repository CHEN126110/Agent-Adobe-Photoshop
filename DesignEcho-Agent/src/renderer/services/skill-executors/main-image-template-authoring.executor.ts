import type { AgentResult } from '../unified-agent.service';
import type { SkillExecuteParams, SkillExecutor } from './types';

import { executeToolCall } from '../tool-executor.service';
import { emitSkillStep, executeObservedSkillTool } from './skill-step-events';
import {
    buildMainImageTemplateAuthoringSummary,
    buildMainImageTemplateBlueprint
} from '../design-skills/main-image-template-authoring.skill';

function buildFailure(message: string, error: string, toolResults: any[], data?: any): AgentResult {
    return {
        success: false,
        message,
        error,
        toolResults,
        data
    };
}

function summarizeAuthoringToolCall(toolName: string, params: Record<string, any>): string {
    const name = String(params?.name || params?.groupName || '').trim();
    const parts = [`工具: ${toolName}`];
    if (name) parts.push(`名称: ${name}`);
    if (Number.isFinite(Number(params?.width)) && Number.isFinite(Number(params?.height))) {
        parts.push(`尺寸: ${Number(params.width)}x${Number(params.height)}`);
    }
    if (Number.isFinite(Number(params?.x)) && Number.isFinite(Number(params?.y))) {
        parts.push(`位置: ${Number(params.x)},${Number(params.y)}`);
    }
    if (Array.isArray(params?.layerIds)) {
        parts.push(`图层数: ${params.layerIds.length}`);
    }
    if (typeof params?.content === 'string') {
        parts.push(`文案长度: ${params.content.length}`);
    }
    return parts.join('；');
}

export const mainImageTemplateAuthoringExecutor: SkillExecutor = {
    skillId: 'main-image-template-authoring',

    async execute({ params, callbacks, signal, context }: SkillExecuteParams): Promise<AgentResult> {
        const results: any[] = [];
        const userIntent = String(params.userIntent || context?.userInput || '').trim();
        const report = (message: string, percent: number) => {
            callbacks?.onProgress?.(message, percent);
            callbacks?.onStatus?.(message);
        };
        const runTool = (toolName: string, toolParams: Record<string, any>) =>
            executeObservedSkillTool(callbacks, toolName, toolParams, executeToolCall, summarizeAuthoringToolCall(toolName, toolParams));

        try {
            report('先规划主图模板蓝图。', 0.08);
            const blueprint = buildMainImageTemplateBlueprint({
                userIntent,
                size: params.size,
                imageType: params.imageType,
                productTheme: params.productTheme,
                density: params.density
            });
            emitSkillStep(callbacks, {
                kind: 'observation',
                title: '主图模板蓝图已生成',
                detail: `文档: ${blueprint.document.width}x${blueprint.document.height}；形状: ${blueprint.shapes.length}；文案: ${blueprint.copies.length}；分组: ${blueprint.groupName}`,
                status: 'success',
                percent: 8
            });

            if (signal?.aborted) {
                emitSkillStep(callbacks, {
                    kind: 'stopped',
                    title: '主图模板创建已取消',
                    detail: '任务在创建文档前被取消。',
                    status: 'error',
                    issue: 'aborted'
                });
                return {
                    success: false,
                    cancelled: true,
                    message: '主图模板创建已取消。',
                    toolResults: results,
                    data: { blueprint }
                };
            }

            report('正在新建主图文档。', 0.16);
            const createDocumentResult = await runTool('createDocument', {
                width: blueprint.document.width,
                height: blueprint.document.height,
                resolution: blueprint.document.resolution,
                name: blueprint.document.name,
                backgroundColor: blueprint.document.backgroundColor
            });
            results.push({ toolName: 'createDocument', result: createDocumentResult });

            if (!createDocumentResult?.success) {
                return buildFailure(
                    `主图模板创建失败：${createDocumentResult?.error || '无法新建文档'}`,
                    createDocumentResult?.error || 'createDocument failed',
                    results,
                    { blueprint }
                );
            }

            const layerIds: number[] = [];

            for (let index = 0; index < blueprint.shapes.length; index += 1) {
                const shape = blueprint.shapes[index];
                report(`正在创建模板形状：${shape.name}`, 0.24 + (index / Math.max(1, blueprint.shapes.length + blueprint.copies.length)) * 0.45);
                emitSkillStep(callbacks, {
                    kind: 'observation',
                    title: `创建主图模板形状 ${index + 1}/${blueprint.shapes.length}`,
                    detail: `${shape.name}；${shape.shape}；${shape.width}x${shape.height}`,
                    status: 'running',
                    percent: Math.round((0.24 + (index / Math.max(1, blueprint.shapes.length + blueprint.copies.length)) * 0.45) * 100)
                });

                const toolName = shape.shape === 'ellipse' ? 'createEllipse' : 'createRectangle';
                const payload = shape.shape === 'ellipse'
                    ? {
                        name: shape.name,
                        x: shape.x + shape.width / 2,
                        y: shape.y + shape.height / 2,
                        width: shape.width,
                        height: shape.height,
                        fillColorHex: shape.fillColorHex
                    }
                    : {
                        name: shape.name,
                        x: shape.x,
                        y: shape.y,
                        width: shape.width,
                        height: shape.height,
                        fillColorHex: shape.fillColorHex,
                        cornerRadius: shape.cornerRadius
                    };
                const result = await runTool(toolName, payload);
                results.push({ toolName: `${toolName}[${shape.name}]`, result });

                if (!result?.success || !Number.isFinite(result?.layerId)) {
                    return buildFailure(
                        `创建模板形状失败：${shape.name}`,
                        result?.error || `${toolName} failed`,
                        results,
                        { blueprint, layerIds }
                    );
                }
                layerIds.push(Number(result.layerId));
            }

            for (let index = 0; index < blueprint.copies.length; index += 1) {
                const copy = blueprint.copies[index];
                report(`正在创建文案占位：${copy.name}`, 0.55 + (index / Math.max(1, blueprint.copies.length)) * 0.25);
                emitSkillStep(callbacks, {
                    kind: 'observation',
                    title: `创建主图文案占位 ${index + 1}/${blueprint.copies.length}`,
                    detail: `${copy.name}；字号: ${copy.fontSize}；文案长度: ${copy.content.length}`,
                    status: 'running',
                    percent: Math.round((0.55 + (index / Math.max(1, blueprint.copies.length)) * 0.25) * 100)
                });

                const result = await runTool('createTextLayer', {
                    name: copy.name,
                    content: copy.content,
                    x: copy.x,
                    y: copy.y,
                    fontSize: copy.fontSize,
                    alignment: copy.alignment,
                    colorHex: copy.colorHex
                });
                results.push({ toolName: `createTextLayer[${copy.name}]`, result });

                if (!result?.success || !Number.isFinite(result?.layerId)) {
                    return buildFailure(
                        `创建文案占位失败：${copy.name}`,
                        result?.error || 'createTextLayer failed',
                        results,
                        { blueprint, layerIds }
                    );
                }
                layerIds.push(Number(result.layerId));
            }

            report('正在整理主图模板分组。', 0.86);
            const groupResult = await runTool('createGroup', {
                groupName: blueprint.groupName,
                layerIds
            });
            results.push({ toolName: `createGroup[${blueprint.groupName}]`, result: groupResult });

            if (!groupResult?.success) {
                return buildFailure(
                    `创建模板分组失败：${blueprint.groupName}`,
                    groupResult?.error || 'createGroup failed',
                    results,
                    { blueprint, layerIds }
                );
            }

            report('正在读取主图模板文档信息。', 0.93);
            const documentInfoResult = await runTool('getDocumentInfo', {});
            results.push({ toolName: 'getDocumentInfo', result: documentInfoResult });

            const summary = buildMainImageTemplateAuthoringSummary(blueprint);
            emitSkillStep(callbacks, {
                kind: 'verification',
                title: '主图模板创建结果已汇总',
                detail: `图层数: ${layerIds.length}；分组 ID: ${Number.isFinite(groupResult?.layerId) ? Number(groupResult.layerId) : '未返回'}`,
                status: 'success',
                percent: 100
            });
            return {
                success: true,
                message: summary.join('\n'),
                toolResults: results,
                data: {
                    blueprint,
                    document: {
                        id: createDocumentResult?.documentId || documentInfoResult?.id,
                        name: createDocumentResult?.name || documentInfoResult?.name || blueprint.document.name,
                        width: createDocumentResult?.width || documentInfoResult?.width || blueprint.document.width,
                        height: createDocumentResult?.height || documentInfoResult?.height || blueprint.document.height
                    },
                    groupId: Number.isFinite(groupResult?.layerId) ? Number(groupResult.layerId) : undefined,
                    layerIds
                }
            };
        } catch (error: any) {
            emitSkillStep(callbacks, {
                kind: 'verification',
                title: '主图模板创建异常',
                detail: error?.message || String(error),
                status: 'error',
                issue: error?.message || String(error)
            });
            return buildFailure(
                `主图模板创建失败：${error?.message || '未知错误'}`,
                error?.message || 'main-image-template-authoring failed',
                results
            );
        }
    }
};
