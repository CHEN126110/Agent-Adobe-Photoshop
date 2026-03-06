/**
 * 消息处理器
 * 
 * 处理来自 Agent 的请求，支持 MCP 协议和旧版工具调用
 */

import { ToolRegistry } from '../tools/registry';
import { MCPProtocolHandler } from './mcp-protocol';

export class MessageHandler {
    private toolRegistry: ToolRegistry;
    private mcpHandler: MCPProtocolHandler;
    private onPongCallback: (() => void) | null = null;
    private onProgressCallback: ((operation: string, progress: number, message?: string) => void) | null = null;

    constructor(toolRegistry: ToolRegistry) {
        this.toolRegistry = toolRegistry;
        this.mcpHandler = new MCPProtocolHandler(toolRegistry);
    }

    /**
     * 设置 pong 回调（用于更新心跳时间）
     */
    setOnPongCallback(callback: () => void): void {
        this.onPongCallback = callback;
    }

    /**
     * 设置进度回调（用于更新 UI 进度）
     */
    setOnProgressCallback(callback: (operation: string, progress: number, message?: string) => void): void {
        this.onProgressCallback = callback;
    }

    // 回调函数，用于处理 WebView 转发的消息
    private webviewActionCallback: ((action: string, payload: any) => Promise<any>) | null = null;

    /**
     * 设置 WebView 动作回调
     */
    setWebViewActionCallback(callback: (action: string, payload: any) => Promise<any>): void {
        this.webviewActionCallback = callback;
    }

    /**
     * 处理工具调用 (兼容 MCP 和旧版格式)
     */
    async handleToolCall(method: string, params: any): Promise<any> {
        console.log(`[MessageHandler] 请求: ${method}`, params);

        // 处理来自 Agent WebView 的转发消息
        if (method === 'webview.action') {
            console.log('[MessageHandler] 收到 WebView 转发消息:', params);
            if (this.webviewActionCallback && params?.action) {
                try {
                    const result = await this.webviewActionCallback(params.action, params.payload || {});
                    return { success: true, result };
                } catch (error: any) {
                    console.error('[MessageHandler] WebView 动作处理错误:', error);
                    return { success: false, error: error.message };
                }
            }
            return { success: false, error: '未设置 WebView 动作回调' };
        }

        // 检查是否是 MCP 标准方法
        if (this.isMCPMethod(method)) {
            return this.mcpHandler.handleMethod(method, params);
        }

        // 提取工具名称 (格式: tool.toolName 或直接 toolName)
        const toolName = method.startsWith('tool.') 
            ? method.substring(5) 
            : method;

        // 检查是否是已注册的工具
        const tool = this.toolRegistry.getTool(toolName);
        if (tool) {
            try {
                const result = await tool.execute(params);
                console.log(`[MessageHandler] 工具结果:`, result);
                return result;
            } catch (error) {
                console.error(`[MessageHandler] 工具错误:`, error);
                throw error;
            }
        }

        // 尝试作为 MCP 方法处理
        return this.mcpHandler.handleMethod(method, params);
    }

    /**
     * 检查是否是 MCP 标准方法
     */
    private isMCPMethod(method: string): boolean {
        const mcpMethods = [
            'initialize',
            'initialized',
            'tools/list',
            'tools/call',
            'resources/list',
            'resources/read',
            'resources/templates/list',
            'prompts/list',
            'prompts/get',
            'logging/setLevel',
            'ping'
        ];
        return mcpMethods.includes(method);
    }

    /**
     * 处理通知
     */
    handleNotification(method: string, params: any): void {
        console.log(`[MessageHandler] 通知: ${method}`, params);

        switch (method) {
            case 'pong':
                // 心跳响应 - 调用回调更新时间
                if (this.onPongCallback) {
                    this.onPongCallback();
                }
                break;
            case 'progress':
                // 进度更新 - 用于长时间操作
                if (this.onProgressCallback && params) {
                    this.onProgressCallback(
                        params.operation || 'unknown',
                        params.progress || 0,
                        params.message
                    );
                }
                break;
            case 'agent.status':
                // Agent 状态更新
                console.log('[MessageHandler] Agent 状态:', params);
                break;
            case 'agent.ready':
                // Agent 就绪
                console.log('[MessageHandler] Agent 已就绪:', params);
                break;
            case 'notifications/cancelled':
                // MCP 取消通知
                console.log('[MessageHandler] 请求已取消:', params);
                break;
            default:
                console.log(`[MessageHandler] 未知通知: ${method}`);
        }
    }

    /**
     * 获取 MCP 协议处理器
     */
    getMCPHandler(): MCPProtocolHandler {
        return this.mcpHandler;
    }

    /**
     * 检查 MCP 是否已初始化
     */
    isMCPInitialized(): boolean {
        return this.mcpHandler.isInitialized();
    }
}
