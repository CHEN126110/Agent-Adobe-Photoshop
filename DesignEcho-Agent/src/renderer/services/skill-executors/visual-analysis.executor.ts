import { SkillExecutor, SkillExecuteParams } from './types';
import { AgentResult } from '../unified-agent.service';
import { executeToolCall } from '../tool-executor.service';
import { emitSkillStep, executeObservedSkillTool } from './skill-step-events';

export const visualAnalysisExecutor: SkillExecutor = {
    skillId: 'visual-analysis',

    async execute({ params, callbacks }: SkillExecuteParams): Promise<AgentResult> {
        callbacks?.onProgress?.('准备视觉分析', 8);
        callbacks?.onMessage?.('正在进行视觉分析。');

        const sourceType = params.sourceType || 'active_document';
        let analysisResult;
        emitSkillStep(callbacks, {
            kind: 'observation',
            title: '准备视觉分析',
            detail: `数据源: ${sourceType}；分析焦点: ${params.analysisFocus || '未指定'}`,
            status: 'running',
            percent: 8
        });

        try {
            if (sourceType === 'local_file') {
                const filePath = params.filePath;
                if (!filePath) {
                    emitSkillStep(callbacks, {
                        kind: 'verification',
                        title: '视觉分析未开始',
                        detail: 'local_file 数据源缺少文件路径。',
                        status: 'error',
                        issue: 'File path is required for local_file source'
                    });
                    return { success: false, message: '缺少本地文件路径', error: 'File path is required for local_file source' };
                }

                callbacks?.onProgress?.('读取本地图片文件', 24);
                callbacks?.onMessage?.(`读取本地文件: ${filePath}`);
                emitSkillStep(callbacks, {
                    kind: 'tool_started',
                    title: '调用视觉模型分析本地图片',
                    detail: `文件: ${filePath}`,
                    status: 'running',
                    toolName: 'visual:analyzeLocalImage',
                    percent: 34
                });

                // Call IPC directly for local file analysis
                const result = await (window as any).designEcho.invoke('visual:analyzeLocalImage', filePath, params.analysisFocus);

                if (!result.success) {
                    emitSkillStep(callbacks, {
                        kind: 'tool_completed',
                        title: '本地图片视觉分析失败',
                        detail: result.error || '未知错误',
                        status: 'error',
                        toolName: 'visual:analyzeLocalImage',
                        issue: result.error || 'visual_analysis_failed'
                    });
                    return { success: false, message: `视觉分析失败: ${result.error || '未知错误'}`, error: result.error };
                }
                analysisResult = result.data;
                emitSkillStep(callbacks, {
                    kind: 'tool_completed',
                    title: '本地图片视觉分析完成',
                    detail: `文件: ${filePath}`,
                    status: 'success',
                    toolName: 'visual:analyzeLocalImage',
                    percent: 78
                });

            } else if (sourceType === 'active_document') {
                callbacks?.onProgress?.('获取当前文档快照', 24);
                callbacks?.onMessage?.('获取当前文档快照。');

                // Use tool executor to get snapshot
                const snapshotResult = await executeObservedSkillTool(
                    callbacks,
                    'getCanvasSnapshot',
                    {},
                    executeToolCall,
                    '读取当前 Photoshop 画布快照，供视觉模型分析。'
                );

                if (!snapshotResult?.success) {
                    emitSkillStep(callbacks, {
                        kind: 'verification',
                        title: '视觉分析未完成',
                        detail: '获取画布快照失败。',
                        status: 'error',
                        toolName: 'getCanvasSnapshot',
                        issue: 'Failed to get canvas snapshot'
                    });
                    return { success: false, message: '获取画布快照失败', error: 'Failed to get canvas snapshot' };
                }

                // UXP getCanvasSnapshot returns { success, snapshot: { base64, width, height } }
                const base64 = snapshotResult.snapshot?.base64
                    ?? snapshotResult.data?.base64
                    ?? (typeof snapshotResult.data === 'string' ? snapshotResult.data : undefined);

                if (!base64) {
                    emitSkillStep(callbacks, {
                        kind: 'verification',
                        title: '视觉分析未完成',
                        detail: '快照结果缺少 base64 图像数据。',
                        status: 'error',
                        toolName: 'getCanvasSnapshot',
                        issue: 'Invalid snapshot data'
                    });
                    return { success: false, message: '快照数据无效，请确保 Photoshop 中有打开的文档', error: 'Invalid snapshot data' };
                }

                callbacks?.onProgress?.('调用视觉模型分析', 62);
                callbacks?.onMessage?.('正在调用视觉模型分析。');
                emitSkillStep(callbacks, {
                    kind: 'tool_started',
                    title: '调用视觉模型分析画布',
                    detail: '使用当前画布快照进行视觉分析；不在步骤中暴露 base64 图像内容。',
                    status: 'running',
                    toolName: 'visual:analyzeBase64Image',
                    percent: 64
                });

                // Call IPC for base64 analysis
                const result = await (window as any).designEcho.invoke('visual:analyzeBase64Image', base64, params.analysisFocus);

                if (!result.success) {
                    emitSkillStep(callbacks, {
                        kind: 'tool_completed',
                        title: '画布视觉分析失败',
                        detail: result.error || '未知错误',
                        status: 'error',
                        toolName: 'visual:analyzeBase64Image',
                        issue: result.error || 'visual_analysis_failed'
                    });
                    return { success: false, message: `视觉分析失败: ${result.error || '未知错误'}`, error: result.error };
                }
                analysisResult = result.data;
                emitSkillStep(callbacks, {
                    kind: 'tool_completed',
                    title: '画布视觉分析完成',
                    detail: `快照尺寸: ${snapshotResult.snapshot?.width || snapshotResult.data?.width || '未知'}x${snapshotResult.snapshot?.height || snapshotResult.data?.height || '未知'}`,
                    status: 'success',
                    toolName: 'visual:analyzeBase64Image',
                    percent: 82
                });
            } else {
                emitSkillStep(callbacks, {
                    kind: 'verification',
                    title: '视觉分析数据源不支持',
                    detail: `不支持的数据源类型: ${sourceType}`,
                    status: 'error',
                    issue: `Unsupported source type: ${sourceType}`
                });
                return {
                    success: false,
                    message: `不支持的数据源类型: ${sourceType}`,
                    error: `Unsupported source type: ${sourceType}`
                };
            }

            // Format the result for the agent
            // 构建易读的 Markdown 报告
            const report = `### 🎨 视觉分析报告

**风格**: ${analysisResult.style}
**构图**: ${analysisResult.composition}

**配色方案**:
${analysisResult.colorPalette.map((c: string) => `- \`${c}\``).join('\n')}

**关键元素**:
${analysisResult.elements.map((e: string) => `- ${e}`).join('\n')}

**💡 改进建议**:
${analysisResult.suggestions.map((s: string) => `- ${s}`).join('\n')}
`;
            emitSkillStep(callbacks, {
                kind: 'verification',
                title: '视觉分析报告已生成',
                detail: `风格: ${analysisResult.style || '未返回'}；元素数: ${Array.isArray(analysisResult.elements) ? analysisResult.elements.length : 0}；建议数: ${Array.isArray(analysisResult.suggestions) ? analysisResult.suggestions.length : 0}`,
                status: 'success',
                percent: 100
            });

            return {
                success: true,
                message: report,
                data: analysisResult
            };

        } catch (error: any) {
            console.error('[VisualAnalysis] Execution failed:', error);
            emitSkillStep(callbacks, {
                kind: 'verification',
                title: '视觉分析执行异常',
                detail: error?.message || String(error),
                status: 'error',
                issue: error?.message || String(error)
            });
            return {
                success: false,
                message: `视觉分析执行失败: ${error?.message || '未知错误'}`,
                error: error.message
            };
        }
    }
};
