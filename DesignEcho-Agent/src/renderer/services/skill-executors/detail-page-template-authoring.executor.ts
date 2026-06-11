import type { AgentResult } from '../unified-agent.service';
import type { SkillExecuteParams, SkillExecutor } from './types';

import { executeToolCall } from '../tool-executor.service';
import { emitSkillStep, executeObservedSkillTool } from './skill-step-events';
import {
    buildDetailPageTemplateAuthoringSummary,
    buildDetailPageTemplateBlueprint
} from '../design-skills/detail-page-template-authoring.skill';

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

export const detailPageTemplateAuthoringExecutor: SkillExecutor = {
    skillId: 'detail-page-template-authoring',

    async execute({ params, callbacks, signal, context }: SkillExecuteParams): Promise<AgentResult> {
        const results: any[] = [];
        const userIntent = String(params.userIntent || context?.userInput || '').trim();
        const report = (message: string, percent: number, emitStatus = true) => {
            callbacks?.onProgress?.(message, percent);
            if (emitStatus) callbacks?.onStatus?.(message);
        };
        const runTool = (toolName: string, toolParams: Record<string, any>) =>
            executeObservedSkillTool(callbacks, toolName, toolParams, executeToolCall, summarizeAuthoringToolCall(toolName, toolParams));

        try {
            report('先规划详情页模板蓝图。', 0.08);
            const blueprint = buildDetailPageTemplateBlueprint({
                userIntent,
                productTheme: params.productTheme,
                screenCount: Number.isFinite(params.screenCount) ? Number(params.screenCount) : undefined,
                density: params.density,
                width: Number.isFinite(params.width) ? Number(params.width) : undefined
            });
            emitSkillStep(callbacks, {
                kind: 'observation',
                title: '详情页模板蓝图已生成',
                detail: `屏数: ${blueprint.screens.length}；文档: ${blueprint.document.width}x${blueprint.document.height}；名称: ${blueprint.document.name}`,
                status: 'success',
                percent: 8
            });

            callbacks?.onStatus?.(`已规划 ${blueprint.screens.length} 屏，准备创建文档和占位骨架。`);

            if (signal?.aborted) {
                emitSkillStep(callbacks, {
                    kind: 'stopped',
                    title: '详情页模板创建已取消',
                    detail: '任务在创建文档前被取消。',
                    status: 'error',
                    issue: 'aborted'
                });
                return {
                    success: false,
                    cancelled: true,
                    message: '详情页模板创建已取消。',
                    toolResults: results,
                    data: { blueprint }
                };
            }

            report('正在新建详情页文档。', 0.16);
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
                    `详情页模板创建失败：${createDocumentResult?.error || '无法新建文档'}`,
                    createDocumentResult?.error || 'createDocument failed',
                    results,
                    { blueprint }
                );
            }

            const createdScreens: Array<{ name: string; groupId?: number; layerIds: number[] }> = [];
            const totalScreens = blueprint.screens.length;
            const orderedScreens = [...blueprint.screens].sort((a, b) => b.order - a.order);

            for (let index = 0; index < orderedScreens.length; index += 1) {
                const screen = orderedScreens[index];
                const progressBase = 0.2 + (index / Math.max(1, totalScreens)) * 0.65;
                report(`正在创建第 ${screen.order + 1} 屏模板结构：${screen.name}`, progressBase, true);
                emitSkillStep(callbacks, {
                    kind: 'observation',
                    title: `创建详情页屏结构 ${screen.order + 1}/${totalScreens}`,
                    detail: `${screen.name}；图片区: ${screen.images.length}；图标位: ${screen.icons.length}；文案位: ${screen.copies.length}`,
                    status: 'running',
                    percent: Math.round(progressBase * 100)
                });

                const layerIds: number[] = [];

                for (const image of screen.images) {
                    const result = await runTool('createRectangle', {
                        name: image.name,
                        x: image.x,
                        y: image.y,
                        width: image.width,
                        height: image.height,
                        fillColorHex: image.fillColorHex,
                        cornerRadius: image.cornerRadius
                    });
                    results.push({ toolName: `createRectangle[${screen.name}:${image.name}]`, result });
                    if (!result?.success || !Number.isFinite(result?.layerId)) {
                        return buildFailure(
                            `创建图片区失败：${image.name}`,
                            result?.error || 'createRectangle failed',
                            results,
                            { blueprint, createdScreens }
                        );
                    }
                    layerIds.push(Number(result.layerId));
                }

                for (const icon of screen.icons) {
                    const toolName = icon.shape === 'rectangle' ? 'createRectangle' : 'createEllipse';
                    const payload = icon.shape === 'rectangle'
                        ? {
                            name: icon.name,
                            x: icon.x,
                            y: icon.y,
                            width: icon.width,
                            height: icon.height,
                            fillColorHex: icon.fillColorHex,
                            cornerRadius: Math.min(icon.width, icon.height) / 2
                        }
                        : {
                            name: icon.name,
                            x: icon.x + icon.width / 2,
                            y: icon.y + icon.height / 2,
                            width: icon.width,
                            height: icon.height,
                            fillColorHex: icon.fillColorHex
                        };
                    const result = await runTool(toolName, payload);
                    results.push({ toolName: `${toolName}[${screen.name}:${icon.name}]`, result });
                    if (!result?.success || !Number.isFinite(result?.layerId)) {
                        return buildFailure(
                            `创建图标位失败：${icon.name}`,
                            result?.error || `${toolName} failed`,
                            results,
                            { blueprint, createdScreens }
                        );
                    }
                    layerIds.push(Number(result.layerId));
                }

                for (const copy of screen.copies) {
                    const result = await runTool('createTextLayer', {
                        name: copy.name,
                        content: copy.content,
                        x: copy.x,
                        y: copy.y,
                        fontSize: copy.fontSize,
                        alignment: copy.alignment,
                        colorHex: copy.colorHex
                    });
                    results.push({ toolName: `createTextLayer[${screen.name}:${copy.name}]`, result });
                    if (!result?.success || !Number.isFinite(result?.layerId)) {
                        return buildFailure(
                            `创建文案位失败：${copy.name}`,
                            result?.error || 'createTextLayer failed',
                            results,
                            { blueprint, createdScreens }
                        );
                    }
                    layerIds.push(Number(result.layerId));
                }

                const groupResult = await runTool('createGroup', {
                    groupName: screen.name,
                    layerIds
                });
                results.push({ toolName: `createGroup[${screen.name}]`, result: groupResult });
                if (!groupResult?.success) {
                    return buildFailure(
                        `创建屏分组失败：${screen.name}`,
                        groupResult?.error || 'createGroup failed',
                        results,
                        { blueprint, createdScreens }
                    );
                }

                createdScreens.push({
                    name: screen.name,
                    groupId: Number.isFinite(groupResult?.layerId) ? Number(groupResult.layerId) : undefined,
                    layerIds
                });
                emitSkillStep(callbacks, {
                    kind: 'verification',
                    title: `详情页屏结构已创建 ${screen.order + 1}/${totalScreens}`,
                    detail: `${screen.name}；图层数: ${layerIds.length}；分组 ID: ${Number.isFinite(groupResult?.layerId) ? Number(groupResult.layerId) : '未返回'}`,
                    status: 'success',
                    percent: Math.min(88, Math.round((0.25 + ((index + 1) / Math.max(1, totalScreens)) * 0.62) * 100))
                });

                if (signal?.aborted) {
                    emitSkillStep(callbacks, {
                        kind: 'stopped',
                        title: '详情页模板创建已取消',
                        detail: `已创建 ${createdScreens.length}/${totalScreens} 屏后取消。`,
                        status: 'error',
                        issue: 'aborted'
                    });
                    return {
                        success: false,
                        cancelled: true,
                        message: '详情页模板创建已取消。',
                        toolResults: results,
                        data: { blueprint, createdScreens }
                    };
                }
            }

            report('正在读取新模板文档信息。', 0.92, true);
            const documentInfoResult = await runTool('getDocumentInfo', {});
            results.push({ toolName: 'getDocumentInfo', result: documentInfoResult });

            const summary = buildDetailPageTemplateAuthoringSummary(blueprint);
            const documentId = createDocumentResult?.documentId || documentInfoResult?.id;
            emitSkillStep(callbacks, {
                kind: 'verification',
                title: '详情页模板创建结果已汇总',
                detail: `屏数: ${createdScreens.length}/${totalScreens}；文档 ID: ${documentId || '未返回'}`,
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
                        id: documentId,
                        name: createDocumentResult?.name || documentInfoResult?.name || blueprint.document.name,
                        width: createDocumentResult?.width || documentInfoResult?.width || blueprint.document.width,
                        height: createDocumentResult?.height || documentInfoResult?.height || blueprint.document.height,
                        resolution: createDocumentResult?.resolution || blueprint.document.resolution
                    },
                    createdScreens
                }
            };
        } catch (error: any) {
            emitSkillStep(callbacks, {
                kind: 'verification',
                title: '详情页模板创建异常',
                detail: error?.message || String(error),
                status: 'error',
                issue: error?.message || String(error)
            });
            return buildFailure(
                `详情页模板创建失败：${error?.message || '未知错误'}`,
                error?.message || 'detail-page-template-authoring failed',
                results
            );
        }
    }
};
