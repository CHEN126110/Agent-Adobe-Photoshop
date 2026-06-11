/**
 * 设计参考搜索技能执行器
 *
 * 根据 mode 调用 searchDesigns 或 fetchWebPageDesignContent
 */

import { SkillExecutor, SkillExecuteParams } from './types';
import { AgentResult } from '../unified-agent.service';
import { executeToolCall } from '../tool-executor.service';
import { emitSkillStep, executeObservedSkillTool } from './skill-step-events';
import { normalizeExternalDesignKnowledgeResults } from '../../../shared/design-knowledge-search';

function buildSearchKnowledgeResults(query: string, results: any[], limit: number) {
    return normalizeExternalDesignKnowledgeResults(
        {
            query,
            intents: ['reference'],
            sourceTypes: ['design_crawler'],
            limit
        },
        results.map((item, index) => ({
            id: item.id ? `design-crawler:${item.id}` : undefined,
            title: item.title || `设计参考 ${index + 1}`,
            intent: 'reference',
            sourceType: 'design_crawler',
            summary: item.description || item.summary || item.title || '设计参考搜索结果。',
            evidence: [
                `平台：${item.platform || 'unknown'}`,
                item.url ? `来源：${item.url}` : '来源：未提供 URL'
            ],
            tags: ['design-reference-search', item.platform || 'unknown'],
            allowedUses: ['prompt_context', 'user_reference'],
            evidenceLevel: 'external_snippet',
            sourceRank: Number.isFinite(Number(item.score)) ? Math.max(1, Math.min(100, Math.round(Number(item.score) * 100))) : Math.max(1, 62 - index),
            sourceUrl: item.url
        }))
    );
}

function buildFetchedPageKnowledgeResult(url: string, result: any) {
    return normalizeExternalDesignKnowledgeResults(
        {
            query: url,
            intents: ['reference'],
            sourceTypes: ['web_page'],
            limit: 1
        },
        [{
            id: result.id ? `web-page:${result.id}` : undefined,
            title: result.title || url,
            intent: 'reference',
            sourceType: 'web_page',
            summary: result.description || (result.textContent || '').slice(0, 300) || '网页设计内容摘要。',
            evidence: [
                `URL：${url}`,
                `图片数：${Array.isArray(result.images) ? result.images.length : 0}`,
                `文本长度：${String(result.textContent || '').length}`
            ],
            tags: ['web-page-design-reference'],
            allowedUses: ['prompt_context', 'user_reference'],
            evidenceLevel: 'external_snippet',
            sourceRank: 58,
            sourceUrl: url
        }]
    );
}

export const designReferenceSearchExecutor: SkillExecutor = {
    skillId: 'design-reference-search',

    async execute({ params, callbacks }: SkillExecuteParams): Promise<AgentResult> {
        const mode = params.mode || 'search';

        emitSkillStep(callbacks, {
            kind: 'observation',
            title: '准备设计参考检索',
            detail: `模式: ${mode}`,
            status: 'running',
            percent: 8
        });

        if (mode === 'search') {
            const query = (params.query || '').trim();
            if (!query) {
                emitSkillStep(callbacks, {
                    kind: 'verification',
                    title: '设计参考检索未开始',
                    detail: '搜索模式缺少关键词。',
                    status: 'error',
                    issue: 'Query is required for search mode'
                });
                return { success: false, message: '请提供搜索关键词', error: 'Query is required for search mode' };
            }

            callbacks?.onProgress?.('搜索设计参考', 28);
            callbacks?.onMessage?.(`正在搜索设计参考: 「${query}」。`);

            const result = await executeObservedSkillTool(callbacks, 'searchDesigns', {
                query,
                platform: params.platform || 'all',
                limit: params.limit || 10
            }, executeToolCall, `关键词: ${query}；平台: ${params.platform || 'all'}；数量: ${params.limit || 10}`);

            if (!result?.success) {
                emitSkillStep(callbacks, {
                    kind: 'verification',
                    title: '设计参考检索失败',
                    detail: result?.error || result?.message || '未知错误',
                    status: 'error',
                    toolName: 'searchDesigns',
                    issue: result?.error || result?.message || 'search_failed'
                });
                return {
                    success: false,
                    message: result?.message || `搜索失败: ${result?.error || '未知错误'}`,
                    error: result?.error
                };
            }

            const results = result.results || [];
            const total = result.total ?? results.length;
            const knowledgeResults = buildSearchKnowledgeResults(query, results, params.limit || 10);

            const summary = results.slice(0, 5).map((w: any, i: number) =>
                `${i + 1}. [${w.title || '未命名'}](${w.url || '#'}) - ${w.platform || ''}`
            ).join('\n');
            emitSkillStep(callbacks, {
                kind: 'verification',
                title: '设计参考检索完成',
                detail: `返回结果: ${total}；展示前 ${Math.min(5, results.length)} 条`,
                status: 'success',
                toolName: 'searchDesigns',
                percent: 100
            });

            return {
                success: true,
                message: `### 设计参考 (共 ${total} 个)\n\n${summary}${results.length > 5 ? `\n\n... 还有 ${results.length - 5} 个结果` : ''}\n\n请根据用户需求介绍这些设计参考。`,
                data: { results, total, knowledgeResults }
            };
        }

        if (mode === 'fetchUrl') {
            const url = (params.url || '').trim();
            if (!url) {
                emitSkillStep(callbacks, {
                    kind: 'verification',
                    title: '网页设计内容获取未开始',
                    detail: 'fetchUrl 模式缺少 URL。',
                    status: 'error',
                    issue: 'URL is required for fetchUrl mode'
                });
                return { success: false, message: '请提供要访问的网页 URL', error: 'URL is required for fetchUrl mode' };
            }

            callbacks?.onProgress?.('获取网页设计内容', 28);
            callbacks?.onMessage?.(`正在获取网页内容: ${url.substring(0, 50)}。`);

            const result = await executeObservedSkillTool(callbacks, 'fetchWebPageDesignContent', {
                url,
                extractImages: params.extractImages !== false,
                maxTextLength: params.maxTextLength
            }, executeToolCall, `URL: ${url}; extractImages: ${params.extractImages !== false}`);

            if (!result?.success) {
                emitSkillStep(callbacks, {
                    kind: 'verification',
                    title: '网页设计内容获取失败',
                    detail: result?.error || result?.message || '未知错误',
                    status: 'error',
                    toolName: 'fetchWebPageDesignContent',
                    issue: result?.error || result?.message || 'fetch_failed'
                });
                return {
                    success: false,
                    message: result?.message || `网页内容获取失败: ${result?.error || '未知错误'}`,
                    error: result?.error
                };
            }

            const textPreview = (result.textContent || '').slice(0, 500);
            const imgCount = (result.images || []).length;
            const knowledgeResults = buildFetchedPageKnowledgeResult(url, result);
            emitSkillStep(callbacks, {
                kind: 'verification',
                title: '网页设计内容已获取',
                detail: `标题: ${result.title || '无'}；图片数: ${imgCount}；文本长度: ${(result.textContent || '').length}`,
                status: 'success',
                toolName: 'fetchWebPageDesignContent',
                percent: 100
            });

            return {
                success: true,
                message: `### 网页内容\n\n**标题**: ${result.title || '无'}\n**描述**: ${result.description || '无'}\n**图片数**: ${imgCount}\n\n**内容摘要**:\n${textPreview}${(result.textContent || '').length > 500 ? '...' : ''}`,
                data: { ...result, knowledgeResults }
            };
        }

        emitSkillStep(callbacks, {
            kind: 'verification',
            title: '设计参考检索模式不支持',
            detail: `不支持的模式: ${mode}`,
            status: 'error',
            issue: `Unsupported mode: ${mode}`
        });
        return {
            success: false,
            message: `不支持的模式: ${mode}，请使用 search 或 fetchUrl`,
            error: `Unsupported mode: ${mode}`
        };
    }
};
