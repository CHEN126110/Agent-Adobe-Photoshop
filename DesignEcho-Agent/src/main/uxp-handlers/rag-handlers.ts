import { getRAGService } from '../services/rag/rag-service';
import { UXPContext } from './types';

/**
 * 注册 RAG 相关的 UXP Handlers
 * 处理来自 UXP 插件的文档上下文摄入请求
 */
export function registerRAGUXPHandlers(context: UXPContext): void {
    const { wsServer } = context;
    if (!wsServer) return;

    // 接收文档上下文并摄入
    // UXP 端调用: await wsClient.sendRequest('rag.ingest', { document: ... })
    wsServer.registerHandler('rag.ingest', async (params: any) => {
        try {
            const { document, options } = params;
            if (!document) {
                throw new Error('Missing document data');
            }

            console.log(`[UXP] 收到文档上下文: ${document.name} (${document.width}x${document.height})`);
            
            const ragService = getRAGService();
            const result = await ragService.ingestDocumentContext(document, options);
            
            console.log(`[UXP] 文档摄入完成: ${result.ingested} 条目`);

            return {
                success: true,
                data: result
            };
        } catch (error: any) {
            console.error('[UXP] 文档摄入失败:', error);
            return {
                success: false,
                error: error.message
            };
        }
    });
}
