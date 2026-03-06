/**
 * 流式输出 IPC 处理程序
 * 
 * 处理渲染进程的流式聊天请求，通过 IPC 通道传递流式数据
 */

import { ipcMain, BrowserWindow } from 'electron';
import { ModelService } from '../services/model-service';
import type { StreamChunk } from '../services/stream-adapter';

// 存储活跃的流式请求（用于取消）
const activeStreams = new Map<string, { abort: () => void }>();

/**
 * 注册流式输出 IPC 处理程序
 */
export function registerStreamHandlers(modelService: ModelService): void {
    console.log('[StreamHandlers] 注册流式输出处理程序');
    
    /**
     * 开始流式聊天
     * 
     * 渲染进程调用此方法开始流式请求
     * 流式数据通过 'stream:chunk' 事件发送到渲染进程
     */
    ipcMain.handle('stream:chat', async (event, args: {
        requestId: string;
        modelId: string;
        messages: Array<{ role: string; content: string }>;
        options?: { maxTokens?: number; temperature?: number };
    }) => {
        const { requestId, modelId, messages, options } = args;
        const window = BrowserWindow.fromWebContents(event.sender);
        
        if (!window) {
            console.error('[StreamHandlers] 无法获取窗口引用');
            return { success: false, error: '无法获取窗口引用' };
        }
        
        console.log(`[StreamHandlers] 开始流式请求: ${requestId}, 模型: ${modelId}`);
        
        try {
            // 创建 AbortController 用于取消
            const abortController = new AbortController();
            
            // 获取流式适配器
            const adapter = modelService.chatStream(
                modelId,
                messages.map(m => ({
                    role: m.role as 'user' | 'assistant',
                    content: m.content
                })),
                {
                    ...options,
                    signal: abortController.signal
                }
            );
            
            // 存储用于取消
            activeStreams.set(requestId, {
                abort: () => {
                    abortController.abort();
                    adapter.abort();
                }
            });
            
            // 监听流式数据
            adapter.on('chunk', (chunk: StreamChunk) => {
                // 发送到渲染进程
                if (!window.isDestroyed()) {
                    window.webContents.send('stream:chunk', {
                        requestId,
                        chunk
                    });
                }
                
                // 如果完成或出错，清理
                if (chunk.type === 'done' || chunk.type === 'error') {
                    activeStreams.delete(requestId);
                }
            });
            
            return { success: true, requestId };
            
        } catch (error: any) {
            console.error('[StreamHandlers] 流式请求失败:', error);
            activeStreams.delete(requestId);
            return { success: false, error: error.message };
        }
    });
    
    /**
     * 取消流式请求
     */
    ipcMain.handle('stream:abort', async (_event, requestId: string) => {
        console.log(`[StreamHandlers] 取消流式请求: ${requestId}`);
        
        const stream = activeStreams.get(requestId);
        if (stream) {
            stream.abort();
            activeStreams.delete(requestId);
            return { success: true };
        }
        
        return { success: false, error: '请求不存在或已完成' };
    });
    
    /**
     * 获取活跃的流式请求数量
     */
    ipcMain.handle('stream:activeCount', async () => {
        return activeStreams.size;
    });
}

/**
 * 清理所有活跃的流式请求
 */
export function cleanupStreams(): void {
    console.log(`[StreamHandlers] 清理 ${activeStreams.size} 个活跃流式请求`);
    for (const [requestId, stream] of activeStreams) {
        try {
            stream.abort();
        } catch {
            // 忽略错误
        }
    }
    activeStreams.clear();
}
