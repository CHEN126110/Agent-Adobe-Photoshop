/**
 * IPC Handlers 共享类型定义
 */

import type { IpcMainInvokeEvent } from 'electron';
import type { WebSocketServer } from '../websocket/server';
import type { ModelService } from '../services/model-service';
import type { TaskOrchestrator } from '../services/task-orchestrator';
import type { LogService } from '../services/log-service';
import type { MattingService } from '../services/matting-service';
import type { ResourceManagerService } from '../services/resource-manager-service';
import type { ClaudeSubscriptionService } from '../services/claude-subscription-service';
import type { CodexSubscriptionService } from '../services/codex-subscription-service';

/**
 * IPC Handler 上下文 - 包含所有可能需要的服务引用
 */
export interface IPCContext {
    wsServer: WebSocketServer | null;
    modelService: ModelService | null;
    taskOrchestrator: TaskOrchestrator | null;
    logService: LogService | null;
    mattingService: MattingService | null;
    resourceManagerService: ResourceManagerService | null;
    codexSubscriptionService: CodexSubscriptionService | null;
    claudeSubscriptionService: ClaudeSubscriptionService | null;
    /** 当前 Main Runtime 实际启动的 MCP Host endpoint；Renderer 只读。 */
    mcpHostEndpoint: string | null;
    mainWindow: Electron.BrowserWindow | null;
}

/**
 * IPC Handler 注册函数类型
 */
export type IPCHandlerRegistrar = (context: IPCContext) => void;

export { IpcMainInvokeEvent };
