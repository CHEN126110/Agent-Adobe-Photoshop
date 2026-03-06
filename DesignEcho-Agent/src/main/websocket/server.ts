/**
 * WebSocket 服务器
 * 
 * 处理与 UXP 插件的通信
 * 支持 MCP (Model Context Protocol) 协议 + 二进制传输
 * 
 * 二进制传输优化：
 * - 图像数据使用二进制帧传输，避免 Base64 膨胀
 * - 参考 sd-ppp 设计，使用 Buffer/Uint8Array 直传
 */

import { WebSocketServer as WSServer, WebSocket } from 'ws';
import { getLogService, LogEntry } from '../services/log-service';
import {
    BinaryMessageType,
    BinaryHeader,
    BINARY_HEADER_SIZE,
    createBinaryMessage,
    parseBinaryMessage,
    isBinaryMessage,
    getBinaryTypeName,
    base64ToBuffer
} from '../../shared/binary-protocol';

// 重新导出二进制协议类型，供其他模块使用
export { BinaryMessageType, BinaryHeader } from '../../shared/binary-protocol';

// MCP 协议版本和服务器信息
const MCP_VERSION = '2024-11-05';
const AGENT_INFO = {
    name: 'DesignEcho-Agent',
    version: '1.0.0',
    description: 'DesignEcho Agent - MCP Host for AI-powered design assistance'
};

// MCP 能力声明 (作为 Host/Client)
const AGENT_CAPABILITIES = {
    roots: { listChanged: true },
    sampling: {}
};

interface JsonRpcRequest {
    jsonrpc: '2.0';
    id: string | number;
    method: string;
    params?: any;
}

interface JsonRpcResponse {
    jsonrpc: '2.0';
    id: string | number | null;
    result?: any;
    error?: {
        code: number;
        message: string;
        data?: any;
    };
}

interface ServerOptions {
    onMessage?: (message: any) => void;
    onConnection?: () => void;
    onDisconnection?: () => void;
}

type PendingRequest = {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
};

// 请求处理器类型
type RequestHandler = (params: any) => Promise<any>;

// 二进制请求处理器类型
type BinaryRequestHandler = (header: BinaryHeader, imageData: Buffer) => Promise<{
    type: BinaryMessageType;
    width: number;
    height: number;
    data: Buffer;
} | null>;

// 二进制请求待处理项
type PendingBinaryRequest = {
    resolve: (data: { header: BinaryHeader; imageData: Buffer }) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
};

export class WebSocketServer {
    private requestHandlers: Map<string, RequestHandler> = new Map();
    private binaryHandler: BinaryRequestHandler | null = null;  // 二进制消息处理器
    private pendingBinaryRequests: Map<number, PendingBinaryRequest> = new Map();  // 二进制请求
    private wss: WSServer | null = null;
    private port: number;
    private pluginSocket: WebSocket | null = null;
    private options: ServerOptions;
    private requestId: number = 0;
    private pendingRequests: Map<string | number, PendingRequest> = new Map();
    
    // 连接保持机制（参考 sd-ppp: ping_interval=60, ping_timeout=50）
    private keepAliveInterval: ReturnType<typeof setInterval> | null = null;
    private lastActivityTime: number = Date.now();
    private static readonly KEEP_ALIVE_INTERVAL = 30000;  // 30秒发送一次心跳（sd-ppp 用 60s，适中选择）

    constructor(port: number, options: ServerOptions = {}) {
        this.port = port;
        this.options = options;
    }

    /**
     * 启动服务器（带重试机制）
     */
    start(retryCount: number = 0): void {
        const maxRetries = 3;
        const retryDelay = 1000; // 1秒
        
        // 参考 sd-ppp: max_http_buffer_size=524288000 (500MB)
        this.wss = new WSServer({ 
            port: this.port,
            maxPayload: 500 * 1024 * 1024  // 500MB - 支持超大图像传输（sd-ppp 标准）
        });

        this.wss.on('listening', () => {
            console.log(`[WebSocket Server] Listening on port ${this.port} (maxPayload: 500MB)`);
        });

        this.wss.on('connection', (socket: WebSocket) => {
            // 使用日志服务记录连接状态（只在状态变化时显示）
            const logService = getLogService();
            logService.logConnectionStatus(true, 'WebSocket 连接建立');
            
            // 只允许一个插件连接
            if (this.pluginSocket) {
                logService.logAgent('debug', '[WebSocket] 关闭旧连接');
                this.stopKeepAlive();
                this.pluginSocket.close();
            }

            this.pluginSocket = socket;
            this.lastActivityTime = Date.now();
            this.options.onConnection?.();
            
            // 启动心跳保持
            this.startKeepAlive();

            socket.on('message', (data: Buffer) => {
                this.lastActivityTime = Date.now();
                
                // 区分二进制和文本消息
                if (isBinaryMessage(data)) {
                    this.handleBinaryMessage(data);
                } else {
                    this.handleMessage(data.toString());
                }
            });

            socket.on('close', () => {
                logService.logConnectionStatus(false, 'WebSocket 连接断开');
                logService.resetHeartbeatLog();
                this.stopKeepAlive();
                if (this.pluginSocket === socket) {
                    this.pluginSocket = null;
                    this.options.onDisconnection?.();
                }
            });

            socket.on('error', (error: Error) => {
                logService.logAgent('error', `[WebSocket] Socket 错误: ${error.message}`);
            });
        });

        this.wss.on('error', (error: Error & { code?: string }) => {
            console.error('[WebSocket Server] Server error:', error);
            
            // 处理端口占用错误
            if (error.code === 'EADDRINUSE') {
                console.log(`[WebSocket Server] 端口 ${this.port} 被占用`);
                
                if (retryCount < maxRetries) {
                    console.log(`[WebSocket Server] ${retryDelay/1000}秒后重试 (${retryCount + 1}/${maxRetries})...`);
                    
                    // 关闭当前服务器实例
                    if (this.wss) {
                        this.wss.close();
                        this.wss = null;
                    }
                    
                    // 延迟后重试
                    setTimeout(() => {
                        this.start(retryCount + 1);
                    }, retryDelay);
                } else {
                    console.error(`[WebSocket Server] 端口 ${this.port} 持续被占用，已达到最大重试次数`);
                }
            }
        });
    }

    /**
     * 停止服务器
     */
    stop(): void {
        this.stopKeepAlive();
        
        this.pendingRequests.forEach((pending) => {
            clearTimeout(pending.timeout);
            pending.reject(new Error('Server stopped'));
        });
        this.pendingRequests.clear();

        if (this.pluginSocket) {
            this.pluginSocket.close();
            this.pluginSocket = null;
        }

        if (this.wss) {
            this.wss.close();
            this.wss = null;
        }

        console.log('[WebSocket Server] Stopped');
    }

    /**
     * 启动心跳保持机制
     * 定期向 UXP 发送心跳，防止长时间操作期间连接超时
     */
    private startKeepAlive(): void {
        this.stopKeepAlive();  // 确保清理旧的
        
        this.keepAliveInterval = setInterval(() => {
            if (this.isPluginConnected()) {
                // 发送 pong 响应（模拟 UXP 的 ping），不记录日志
                this.sendNotification('pong', { 
                    timestamp: Date.now(),
                    serverAlive: true 
                });
            }
        }, WebSocketServer.KEEP_ALIVE_INTERVAL);
        
        // 只记录一次心跳启动
        const logService = getLogService();
        logService.logHeartbeatOnce();
    }

    /**
     * 停止心跳保持
     */
    private stopKeepAlive(): void {
        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval);
            this.keepAliveInterval = null;
        }
    }

    /**
     * 发送处理进度通知（用于长时间操作）
     */
    sendProgress(operation: string, progress: number, message?: string, stage?: string): void {
        if (!this.isPluginConnected()) return;
        
        this.sendNotification('progress', {
            operation,
            progress,
            message,
            stage,
            timestamp: Date.now()
        });
    }

    // ==================== 二进制传输方法 ====================

    /**
     * 注册二进制消息处理器
     */
    setBinaryHandler(handler: BinaryRequestHandler): void {
        this.binaryHandler = handler;
        console.log('[WebSocket Server] 二进制处理器已注册');
    }

    /**
     * 发送二进制数据到 UXP
     * 
     * @param type 消息类型
     * @param requestId 关联的请求 ID
     * @param width 图像宽度
     * @param height 图像高度
     * @param imageData 图像数据
     */
    sendBinaryData(
        type: BinaryMessageType,
        requestId: number,
        width: number,
        height: number,
        imageData: Buffer | Uint8Array
    ): void {
        if (!this.isPluginConnected()) {
            console.warn('[WebSocket Server] Cannot send binary: plugin not connected');
            return;
        }

        const message = createBinaryMessage(type, requestId, width, height, 
            Buffer.isBuffer(imageData) ? imageData : Buffer.from(imageData));
        
        try {
            this.pluginSocket!.send(message);
            console.log(`[WebSocket Server] 二进制发送: ${getBinaryTypeName(type)}, ` +
                `requestId=${requestId}, ${width}x${height}, ` +
                `${(imageData.length / 1024).toFixed(1)}KB`);
        } catch (e: any) {
            console.error(`[WebSocket Server] 二进制发送失败: ${e.message}`);
        }
    }

    /**
     * 处理收到的二进制消息
     */
    private async handleBinaryMessage(data: Buffer): Promise<void> {
        console.log(`[WebSocket Server] 收到二进制消息: ${(data.length / 1024).toFixed(1)}KB`);

        // 解析消息
        const { header, imageData } = parseBinaryMessage(data);
        
        console.log(`[WebSocket Server] 二进制消息: ${getBinaryTypeName(header.type)}, ` +
            `requestId=${header.requestId}, ${header.width}x${header.height}, ` +
            `数据: ${(imageData.length / 1024).toFixed(1)}KB`);

        // 检查是否有等待的响应
        const pending = this.pendingBinaryRequests.get(header.requestId);
        if (pending) {
            clearTimeout(pending.timeout);
            this.pendingBinaryRequests.delete(header.requestId);
            pending.resolve({ header, imageData });
            return;
        }

        // 调用二进制处理器
        if (this.binaryHandler) {
            try {
                const result = await this.binaryHandler(header, imageData);
                if (result) {
                    // 返回处理结果
                    this.sendBinaryData(
                        result.type,
                        header.requestId,  // 使用相同的 requestId 关联响应
                        result.width,
                        result.height,
                        result.data
                    );
                }
            } catch (error: any) {
                console.error(`[WebSocket Server] 二进制处理失败:`, error);
                // 发送错误响应（使用 JSON-RPC）
                this.sendErrorResponse(header.requestId, -32000, error.message || '二进制处理失败');
            }
        } else {
            console.warn('[WebSocket Server] 没有注册二进制处理器');
        }
    }

    /**
     * 检查插件是否已连接
     */
    isPluginConnected(): boolean {
        return this.pluginSocket !== null && 
               this.pluginSocket.readyState === WebSocket.OPEN;
    }

    /**
     * 发送请求到插件
     */
    async sendRequest(method: string, params?: any, timeout: number = 30000): Promise<any> {
        if (!this.isPluginConnected()) {
            throw new Error('Plugin not connected');
        }

        const id = ++this.requestId;
        
        // 某些方法不需要添加 tool. 前缀
        const request: JsonRpcRequest = {
            jsonrpc: '2.0',
            id,
            method,
            params
        };

        return new Promise(async (resolve, reject) => {
            const timeoutId = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`Request timeout: ${method}`));
            }, timeout);

            this.pendingRequests.set(id, {
                resolve,
                reject,
                timeout: timeoutId
            });

            // 计算数据大小并在发送大数据前发送心跳
            const startTime = Date.now();
            const jsonString = JSON.stringify(request);
            const dataSize = jsonString.length;
            const serializeTime = Date.now() - startTime;
            
            if (serializeTime > 100) {
                console.log(`[WebSocket Server] JSON 序列化耗时: ${serializeTime}ms, 数据大小: ${(dataSize / 1024 / 1024).toFixed(2)}MB`);
            }
            
            // 如果数据较大，先发送一个心跳保持连接
            if (dataSize > 1024 * 1024) {  // 大于 1MB
                this.sendNotification('pong', { 
                    timestamp: Date.now(), 
                    serverAlive: true, 
                    stage: 'before-large-data',
                    dataSize: (dataSize / 1024 / 1024).toFixed(2) + 'MB'
                });
                // 让事件循环有机会处理其他任务
                await new Promise(r => setImmediate(r));
            }
            
            try {
                this.pluginSocket!.send(jsonString);
                console.log(`[WebSocket Server] Request sent: ${method} (${(dataSize / 1024).toFixed(1)}KB, serialize: ${serializeTime}ms)`);
            } catch (e: any) {
                this.pendingRequests.delete(id);
                clearTimeout(timeoutId);
                reject(new Error(`发送失败: ${e.message}`));
            }
        });
    }

    /**
     * 发送通知到插件（带错误保护）
     */
    sendNotification(method: string, params?: any): void {
        if (!this.isPluginConnected()) {
            console.warn('[WebSocket Server] Cannot send: plugin not connected');
            return;
        }

        const notification = {
            jsonrpc: '2.0',
            method,
            params
        };

        try {
            this.pluginSocket!.send(JSON.stringify(notification));
        } catch (e: any) {
            // 忽略发送错误（可能是连接已断开）
            console.warn(`[WebSocket Server] 发送通知失败: ${e.message}`);
        }
    }

    /**
     * 注册请求处理器
     */
    registerHandler(method: string, handler: RequestHandler): void {
        this.requestHandlers.set(method, handler);
        console.log(`[WebSocket Server] Handler registered: ${method}`);
    }

    /**
     * 处理收到的消息
     */
    private handleMessage(data: string): void {
        try {
            const message = JSON.parse(data);
            
            // 过滤心跳消息的日志输出
            const isHeartbeat = message.method === 'ping' || message.method === 'pong' || 
                               (message.method === 'plugin.log' && message.params?.message?.includes('pong'));
            
            if (!isHeartbeat) {
                console.log('[WebSocket Server] Received:', message);
            }

            // 检查是否是响应（有 id，没有 method）
            if ('id' in message && message.id !== null && !('method' in message)) {
                this.handleResponse(message as JsonRpcResponse);
                return;
            }

            // 检查是否是请求（有 id 和 method）
            if ('id' in message && message.id !== null && 'method' in message) {
                this.handleRequest(message as JsonRpcRequest);
                return;
            }

            // 检查是否是通知（有 method，没有 id）
            if ('method' in message && !('id' in message)) {
                this.handleNotification(message);
                return;
            }

            // 通知渲染进程
            this.options.onMessage?.(message);

        } catch (error) {
            console.error('[WebSocket Server] Failed to parse message:', error);
        }
    }

    /**
     * 处理来自 UXP 的请求
     */
    private async handleRequest(request: JsonRpcRequest): Promise<void> {
        const { id, method, params } = request;

        // 首先检查是否是 MCP 协议方法
        if (this.isMCPMethod(method)) {
            await this.handleMCPRequest(id, method, params);
            return;
        }

        // 查找处理器
        const handler = this.requestHandlers.get(method);

        if (handler) {
            try {
                const result = await handler(params);
                this.sendResponse(id, result);
            } catch (error: any) {
                this.sendErrorResponse(id, -32000, error.message || 'Handler error');
            }
        } else {
            console.log(`[WebSocket Server] No handler for: ${method}`);
            this.sendErrorResponse(id, -32601, `Method not found: ${method}`);
        }
    }

    /**
     * 检查是否是 MCP 方法
     */
    private isMCPMethod(method: string): boolean {
        return method === 'initialize' || 
               method.startsWith('tools/') ||
               method.startsWith('resources/') ||
               method.startsWith('prompts/') ||
               method.startsWith('logging/');
    }

    /**
     * 处理 MCP 协议请求
     */
    private async handleMCPRequest(id: string | number, method: string, params: any): Promise<void> {
        console.log(`[WebSocket Server] MCP 请求: ${method}`, params);

        try {
            switch (method) {
                case 'initialize':
                    // MCP 初始化请求 - UXP 插件作为 MCP Server
                    const initResult = {
                        protocolVersion: MCP_VERSION,
                        capabilities: AGENT_CAPABILITIES,
                        serverInfo: AGENT_INFO
                    };
                    console.log('[WebSocket Server] MCP 初始化成功');
                    this.sendResponse(id, initResult);
                    break;

                case 'tools/list':
                    // 转发到 UXP 获取工具列表
                    const tools = await this.forwardMCPRequest(method, params);
                    this.sendResponse(id, tools);
                    break;

                case 'tools/call':
                    // 转发工具调用到 UXP
                    const toolResult = await this.forwardMCPRequest(method, params);
                    this.sendResponse(id, toolResult);
                    break;

                case 'resources/list':
                case 'resources/read':
                case 'resources/templates/list':
                    // 转发资源请求到 UXP
                    const resourceResult = await this.forwardMCPRequest(method, params);
                    this.sendResponse(id, resourceResult);
                    break;

                case 'prompts/list':
                case 'prompts/get':
                    // 转发提示词请求到 UXP
                    const promptResult = await this.forwardMCPRequest(method, params);
                    this.sendResponse(id, promptResult);
                    break;

                default:
                    this.sendErrorResponse(id, -32601, `Unknown MCP method: ${method}`);
            }
        } catch (error: any) {
            console.error(`[WebSocket Server] MCP 请求失败:`, error);
            this.sendErrorResponse(id, -32000, error.message || 'MCP request failed');
        }
    }

    /**
     * 转发 MCP 请求到 UXP 插件
     */
    private async forwardMCPRequest(method: string, params: any): Promise<any> {
        if (!this.isPluginConnected()) {
            throw new Error('UXP 插件未连接');
        }

        // 直接发送 MCP 方法，不加 tool. 前缀
        const id = ++this.requestId;
        const request: JsonRpcRequest = {
            jsonrpc: '2.0',
            id,
            method,
            params
        };

        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`MCP request timeout: ${method}`));
            }, 30000);

            this.pendingRequests.set(id, {
                resolve,
                reject,
                timeout: timeoutId
            });

            this.pluginSocket!.send(JSON.stringify(request));
            console.log(`[WebSocket Server] MCP 请求已发送: ${method}`);
        });
    }

    /**
     * 发送响应（带错误保护）
     */
    private sendResponse(id: string | number, result: any): void {
        if (!this.isPluginConnected()) return;

        const response: JsonRpcResponse = {
            jsonrpc: '2.0',
            id,
            result
        };

        try {
            this.pluginSocket!.send(JSON.stringify(response));
            console.log(`[WebSocket Server] Response sent for id: ${id}`);
        } catch (e: any) {
            console.warn(`[WebSocket Server] 发送响应失败: ${e.message}`);
        }
    }

    /**
     * 发送错误响应（带错误保护）
     */
    private sendErrorResponse(id: string | number, code: number, message: string): void {
        if (!this.isPluginConnected()) return;

        const response: JsonRpcResponse = {
            jsonrpc: '2.0',
            id,
            error: { code, message }
        };

        try {
            this.pluginSocket!.send(JSON.stringify(response));
            console.log(`[WebSocket Server] Error response sent for id: ${id}`);
        } catch (e: any) {
            console.warn(`[WebSocket Server] 发送错误响应失败: ${e.message}`);
        }
    }

    /**
     * 处理响应
     */
    private handleResponse(response: JsonRpcResponse): void {
        const pending = this.pendingRequests.get(response.id!);
        if (pending) {
            clearTimeout(pending.timeout);
            this.pendingRequests.delete(response.id!);

            if (response.error) {
                pending.reject(new Error(response.error.message));
            } else {
                pending.resolve(response.result);
            }
        }
    }

    /**
     * 处理通知
     */
    private handleNotification(notification: any): void {
        const { method, params } = notification;

        switch (method) {
            case 'plugin.register':
                console.log('[WebSocket Server] Plugin registered:', params);
                // 发送确认
                this.sendNotification('agent.ready', AGENT_INFO);
                break;

            case 'initialized':
                // MCP initialized 通知
                console.log('[WebSocket Server] MCP 初始化完成 (from UXP)');
                this.sendNotification('agent.ready', AGENT_INFO);
                break;

            case 'plugin.log':
                // 处理来自 UXP 的日志（心跳消息由 LogService 过滤）
                this.handlePluginLog(params as LogEntry);
                break;

            case 'ping':
                // 静默响应 ping，不记录日志
                this.sendNotification('pong', { timestamp: Date.now() });
                break;

            case 'notifications/cancelled':
                // MCP 取消通知
                console.log('[WebSocket Server] 请求已取消:', params);
                break;

            default:
                // 检查是否有已注册的处理器
                const handler = this.requestHandlers.get(method);
                if (handler) {
                    console.log(`[WebSocket Server] 处理通知: ${method}`);
                    handler(params).catch((error: Error) => {
                        console.error(`[WebSocket Server] 通知处理器错误 (${method}):`, error);
                    });
                } else {
                    console.log(`[WebSocket Server] Unknown notification: ${method}`);
                    this.options.onMessage?.(notification);
                }
        }
    }

    /**
     * 处理来自 UXP 插件的日志
     */
    private handlePluginLog(entry: LogEntry): void {
        const logService = getLogService();
        logService.logFromUXP(entry);
    }

    // ==================== MCP 便捷方法 ====================

    /**
     * 获取 UXP MCP 服务器的工具列表
     */
    async getMCPTools(): Promise<any> {
        return this.forwardMCPRequest('tools/list', {});
    }

    /**
     * 调用 UXP MCP 工具
     */
    async callMCPTool(name: string, args: any = {}): Promise<any> {
        return this.forwardMCPRequest('tools/call', { name, arguments: args });
    }

    /**
     * 获取 UXP MCP 资源列表
     */
    async getMCPResources(): Promise<any> {
        return this.forwardMCPRequest('resources/list', {});
    }

    /**
     * 读取 UXP MCP 资源
     */
    async readMCPResource(uri: string): Promise<any> {
        return this.forwardMCPRequest('resources/read', { uri });
    }

    /**
     * 获取 UXP MCP 提示词列表
     */
    async getMCPPrompts(): Promise<any> {
        return this.forwardMCPRequest('prompts/list', {});
    }

    /**
     * 获取 UXP MCP 提示词内容
     */
    async getMCPPrompt(name: string, args: Record<string, string> = {}): Promise<any> {
        return this.forwardMCPRequest('prompts/get', { name, arguments: args });
    }
}
