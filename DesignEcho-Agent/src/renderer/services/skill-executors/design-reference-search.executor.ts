/**
 * 设计参考搜索技能执行器
 *
 * 根据 mode 调用 searchDesigns 或 fetchWebPageDesignContent
 */

import { SkillExecutor, SkillExecuteParams } from './types';
import { AgentResult } from '../unified-agent.service';
import { executeToolCall } from '../tool-executor.service';

export const designReferenceSearchExecutor: SkillExecutor = {
    skillId: 'design-reference-search',

    async execute({ params, callbacks }: SkillExecuteParams): Promise<AgentResult> {
        const mode = params.mode || 'search';

        if (mode === 'search') {
            const query = (params.query || '').trim();
            if (!query) {
                return { success: false, message: '❌ 请提供搜索关键词', error: 'Query is required for search mode' };
            }

            callbacks?.onMessage?.(`🔍 正在搜索设计参考: 「${query}」...`);

            const result = await executeToolCall('searchDesigns', {
                query,
                platform: params.platform || 'all',
                limit: params.limit || 10
            });

            if (!result?.success) {
                return {
                    success: false,
                    message: result?.message || `❌ 搜索失败: ${result?.error || '未知错误'}`,
                    error: result?.error
                };
            }

            const results = result.results || [];
            const total = result.total ?? results.length;

            const summary = results.slice(0, 5).map((w: any, i: number) =>
                `${i + 1}. [${w.title || '未命名'}](${w.url || '#'}) - ${w.platform || ''}`
            ).join('\n');

            return {
                success: true,
                message: `### 🎨 设计参考 (共 ${total} 个)\n\n${summary}${results.length > 5 ? `\n\n... 还有 ${results.length - 5} 个结果` : ''}\n\n请根据用户需求介绍这些设计参考。`,
                data: { results, total }
            };
        }

        if (mode === 'fetchUrl') {
            const url = (params.url || '').trim();
            if (!url) {
                return { success: false, message: '❌ 请提供要访问的网页 URL', error: 'URL is required for fetchUrl mode' };
            }

            callbacks?.onMessage?.(`🌐 正在获取网页内容: ${url.substring(0, 50)}...`);

            const result = await executeToolCall('fetchWebPageDesignContent', {
                url,
                extractImages: params.extractImages !== false,
                maxTextLength: params.maxTextLength
            });

            if (!result?.success) {
                return {
                    success: false,
                    message: result?.message || `❌ 网页内容获取失败: ${result?.error || '未知错误'}`,
                    error: result?.error
                };
            }

            const textPreview = (result.textContent || '').slice(0, 500);
            const imgCount = (result.images || []).length;

            return {
                success: true,
                message: `### 📄 网页内容\n\n**标题**: ${result.title || '无'}\n**描述**: ${result.description || '无'}\n**图片数**: ${imgCount}\n\n**内容摘要**:\n${textPreview}${(result.textContent || '').length > 500 ? '...' : ''}`,
                data: result
            };
        }

        return {
            success: false,
            message: `❌ 不支持的模式: ${mode}，请使用 search 或 fetchUrl`,
            error: `Unsupported mode: ${mode}`
        };
    }
};
