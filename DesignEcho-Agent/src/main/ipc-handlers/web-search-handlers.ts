import { ipcMain, type IpcMainInvokeEvent } from 'electron';

import type { ModelService } from '../services/model-service';
import {
    searchWebViaDeepSeek,
    type WebSearchOutcome
} from '../services/web-search-service';

/**
 * 联网搜索 IPC handler。
 * API key 只在主进程内从 ModelService 解析（复用已配置的 DeepSeek provider key），
 * 渲染侧不传 key；服务失败统一折叠为结构化 outcome，不向渲染层抛未包装错误。
 */
export function registerWebSearchHandlers(modelService?: ModelService | null): void {
    ipcMain.handle(
        'webSearch:search',
        async (
            _event: IpcMainInvokeEvent,
            request: { query?: unknown; limit?: unknown }
        ): Promise<WebSearchOutcome> => {
            const query = String(request?.query ?? '').trim();
            const limit = typeof request?.limit === 'number' && Number.isFinite(request.limit)
                ? request.limit
                : undefined;
            const deepseekApiKey = modelService?.getModelSelectionApiKeys().deepseek;
            return searchWebViaDeepSeek(deepseekApiKey ?? '', query, {
                ...(limit !== undefined ? { maxResults: limit } : {})
            });
        }
    );
}
