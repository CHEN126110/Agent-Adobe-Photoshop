import { SkillExecutor, SkillExecuteParams } from './types';
import { AgentResult } from '../unified-agent.service';
import { executeToolCall } from '../tool-executor.service';

export const visualAnalysisExecutor: SkillExecutor = {
    skillId: 'visual-analysis',

    async execute({ params, callbacks }: SkillExecuteParams): Promise<AgentResult> {
        callbacks?.onMessage?.('🔍 正在进行视觉分析...');

        const sourceType = params.sourceType || 'active_document';
        let analysisResult;

        try {
            if (sourceType === 'local_file') {
                const filePath = params.filePath;
                if (!filePath) {
                    return { success: false, message: '❌ 缺少本地文件路径', error: 'File path is required for local_file source' };
                }

                callbacks?.onMessage?.(`📂 读取本地文件: ${filePath}`);

                // Call IPC directly for local file analysis
                const result = await (window as any).designEcho.invoke('visual:analyzeLocalImage', filePath, params.analysisFocus);

                if (!result.success) {
                    return { success: false, message: `❌ 视觉分析失败: ${result.error || '未知错误'}`, error: result.error };
                }
                analysisResult = result.data;

            } else if (sourceType === 'active_document') {
                callbacks?.onMessage?.('📸 获取当前文档快照...');

                // Use tool executor to get snapshot
                const snapshotResult = await executeToolCall('getCanvasSnapshot', {});

                if (!snapshotResult?.success) {
                    return { success: false, message: '❌ 获取画布快照失败', error: 'Failed to get canvas snapshot' };
                }

                // getCanvasSnapshot typically returns base64 string in data property
                // but let's be safe and check
                const base64 = typeof snapshotResult.data === 'string' ? snapshotResult.data : snapshotResult.data?.base64;

                if (!base64) {
                    return { success: false, message: '❌ 快照数据无效', error: 'Invalid snapshot data' };
                }

                callbacks?.onMessage?.('🧠 正在调用视觉模型分析...');

                // Call IPC for base64 analysis
                const result = await (window as any).designEcho.invoke('visual:analyzeBase64Image', base64, params.analysisFocus);

                if (!result.success) {
                    return { success: false, message: `❌ 视觉分析失败: ${result.error || '未知错误'}`, error: result.error };
                }
                analysisResult = result.data;
            } else {
                return {
                    success: false,
                    message: `❌ 不支持的数据源类型: ${sourceType}`,
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

            return {
                success: true,
                message: report,
                data: analysisResult
            };

        } catch (error: any) {
            console.error('[VisualAnalysis] Execution failed:', error);
            return {
                success: false,
                message: `❌ 视觉分析执行失败: ${error?.message || '未知错误'}`,
                error: error.message
            };
        }
    }
};
