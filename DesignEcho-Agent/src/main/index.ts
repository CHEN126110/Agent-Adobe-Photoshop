/**
 * DesignEcho Agent - 主进程入口（Electron Main Process）
 * 
 * 职责说明：
 * - 负责启动 Electron 应用、初始化所有后端服务并注册 IPC 通道。
 *   源码在 src/main/index.ts，打包后对应 dist/main/main/index.js。
 * - 所有 IPC handler 的注册逻辑已拆分为独立模块，不再在本文件中直接注册。
 * 
 * 主要模块划分：
 * 1. IPC handlers 已拆分到 ipc-handlers/ 目录下按功能独立注册
 * 2. UXP handlers 已拆分到 uxp-handlers/ 目录下按功能独立注册
 * 3. 服务初始化在 initializeServices() 中集中完成，各服务有独立类定义
 * 4. 窗口管理、生命周期管理、端口清理等辅助逻辑保留在本文件
 */

import { app, BrowserWindow, ipcMain, shell, type IpcMainEvent } from 'electron';
import path from 'path';
import fs from 'fs';
import http from 'http';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

// 服务模块导入
import { WebSocketServer } from './websocket/server';
import { ModelService } from './services/model-service';
import { TaskOrchestrator } from './services/task-orchestrator';
import { getLogService, LogService } from './services/log-service';
import { MattingService } from './services/matting-service';
import { ResourceManagerService } from './services/resource-manager-service';
import { InpaintingService } from './services/inpainting-service';
import { bflService } from './services/bfl-service';
import { volcengineJimengInpaintingService } from './services/volcengine-jimeng-inpainting-service';
import { volcengineJimengImageService } from './services/volcengine-jimeng-image-service';
import { volcengineSeedreamService } from './services/volcengine-seedream-service';
import { volcengineTosUploadService } from './services/volcengine-tos-upload-service';
import { openRouterGeminiImageService } from './services/openrouter-gemini-image-service';
import { getSubjectDetectionService, SubjectDetectionService } from './services/subject-detection-service';
import { ContourService } from './services/contour-service';
import { getSAMService, SAMService } from './services/sam-service';
import { DebugBridgeService, type DebugBridgeChatSubmitInput } from './services/debug-bridge-service';
import { MCPHostService } from './services/mcp-host-service';
import {
    captureRuntimeBuildIdentity,
    type DesignEchoRuntimeBuildIdentity
} from './services/runtime-build-identity';
import { BrowserBridgeService, initBrowserBridgeService } from './services/browser-bridge-service';
import { handleBrowserCollectionRequest } from './services/browser-collection-service';
import { ClaudeSubscriptionService } from './services/claude-subscription-service';
import { CodexSubscriptionService } from './services/codex-subscription-service';
import {
    BROWSER_BRIDGE_PORT,
    DEBUG_BRIDGE_PORT,
    MCP_HOST_PORT,
    WEBVIEW_BIND_HOST,
    WEBVIEW_SERVER_PORT,
    WS_PORT
} from './config/network-ports';

// 导入拆分后的 handlers 注册器
import { setupIPCHandlers, IPCContext } from './ipc-handlers';
import { registerEarlyStateStoreHandlers } from './ipc-handlers/early-state-handlers';
import { registerUXPHandlers, UXPContext } from './uxp-handlers';
import { cleanupStreams } from './ipc-handlers/stream-handlers';
import { CODEX_SUBSCRIPTION_PROVIDER } from '../shared/codex-subscription-contract';
import { getDynamicModels, setDynamicModels } from '../shared/config/dynamic-model-registry';
import { resolvePersistedModelRuntimeState } from '../shared/config/persisted-model-runtime';
import {
    buildDebugBridgeChatExecutionFailure,
    createDebugBridgeChatExecutionError,
    debugBridgePhotoshopRuntimeBindingsMatch,
    debugBridgePhotoshopRuntimeLiveIdentitiesMatch,
    readDebugBridgeChatExecutionFailure,
    readDebugBridgeChatPreflightSnapshot,
    readDebugBridgePhotoshopRuntimeBinding,
    readDebugBridgePhotoshopRuntimeLiveIdentity,
    MAX_DEBUG_BRIDGE_CHAT_TIMEOUT_MS,
    type DebugBridgeChatExecutionStage,
    type DebugBridgeChatPreflightSnapshot,
    type DebugBridgePhotoshopRuntimeBinding
} from '../shared/debug-bridge-chat';

// ============ 全局变量 ============

function applyRemoteDebuggingPortFromEnv(): void {
    const raw = process.env.DESIGNECHO_REMOTE_DEBUGGING_PORT?.trim();
    if (!raw) return;

    const port = Number.parseInt(raw, 10);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        throw new Error('DESIGNECHO_REMOTE_DEBUGGING_PORT must be an integer port between 1024 and 65535.');
    }

    app.commandLine.appendSwitch('remote-debugging-port', String(port));
    app.commandLine.appendSwitch('remote-allow-origins', `http://127.0.0.1:${port}`);
    console.log(`[Main] Remote debugging enabled for running-window acceptance. port=${port}`);
}

applyRemoteDebuggingPortFromEnv();

// ============ 单实例锁（防止多开） ============
const testUserDataDir = process.env.DESIGNECHO_TEST_USER_DATA_DIR?.trim();
if (testUserDataDir) {
    const resolvedTestUserDataDir = path.resolve(testUserDataDir);
    fs.mkdirSync(resolvedTestUserDataDir, { recursive: true });
    app.setPath('userData', resolvedTestUserDataDir);
    app.setName('DesignEcho Test');
    console.log(`[Main] Using isolated test userData directory: ${resolvedTestUserDataDir}`);
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    console.log('[Main] Another Agent instance is already running. Exiting current process.');
    app.quit();
    process.exit(0);
}

// ============ 窗口与服务实例声明 ============
let mainWindow: BrowserWindow | null = null;
let wsServer: WebSocketServer | null = null;
let modelService: ModelService | null = null;
let taskOrchestrator: TaskOrchestrator | null = null;
let logService: LogService | null = null;
let mattingService: MattingService | null = null;
let resourceManagerService: ResourceManagerService | null = null;
let inpaintingService: InpaintingService | null = null;
let subjectDetectionService: SubjectDetectionService | null = null;
let contourService: ContourService | null = null;
let samService: SAMService | null = null;
let webviewServer: http.Server | null = null;
let debugBridgeService: DebugBridgeService | null = null;
let mcpHostService: MCPHostService | null = null;
let debugChatSubmissionLeaseId: string | null = null;
let browserBridgeService: BrowserBridgeService | null = null;
let codexSubscriptionService: CodexSubscriptionService | null = null;
let claudeSubscriptionService: ClaudeSubscriptionService | null = null;
let codexSubscriptionHydration: Promise<void> | null = null;
let ipcHandlersReady = false;
let mainWindowShown = false;
let loadMainWindowRenderer: (() => void) | null = null;

function isTrustedRendererUrl(rawUrl: string): boolean {
    try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol !== 'file:') return false;
        const expectedPath = path.resolve(__dirname, '../../renderer/index.html');
        return path.resolve(fileURLToPath(parsed)) === expectedPath;
    } catch {
        return false;
    }
}

function resolveSafeExternalUrl(rawUrl: string): string | null {
    try {
        const parsed = new URL(rawUrl);
        if (parsed.username || parsed.password) return null;
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'mailto:') return null;
        return parsed.toString();
    } catch {
        return null;
    }
}

function openExternalFromMainWindow(rawUrl: string): void {
    const safeUrl = resolveSafeExternalUrl(rawUrl);
    if (!safeUrl) {
        logService?.logAgent('warn', '[Main] Blocked an unsafe renderer navigation target');
        return;
    }
    void shell.openExternal(safeUrl).catch((error) => {
        logService?.logAgent('warn', `[Main] Failed to open an approved external URL (${error instanceof Error ? error.name : 'Error'})`);
    });
}

function captureCurrentRuntimeBuildIdentity(): DesignEchoRuntimeBuildIdentity {
    return captureRuntimeBuildIdentity({
        appRoot: app.getAppPath(),
        appVersion: app.getVersion()
    });
}

function buildDebugChatError(input: {
    stage: DebugBridgeChatExecutionStage;
    writePossible: boolean;
    message: string;
    code: string;
    requestId?: string;
}): Error {
    return createDebugBridgeChatExecutionError(buildDebugBridgeChatExecutionFailure(input));
}

function readChatPreflightFromCurrentWindow(): Promise<DebugBridgeChatPreflightSnapshot> {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return Promise.reject(buildDebugChatError({
            stage: 'main_preflight',
            writePossible: false,
            message: 'DesignEcho 主窗口不可用，不能读取运行窗口预检。',
            code: 'main_window_unavailable'
        }));
    }
    const requestId = `debug_preflight_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const resultChannel = 'debug-bridge:chat-preflight-result';
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            cleanup();
            reject(buildDebugChatError({
                stage: 'renderer_preflight',
                writePossible: false,
                message: '运行窗口预检超时。',
                code: 'renderer_preflight_timeout',
                requestId
            }));
        }, 5000);

        const cleanup = (): void => {
            clearTimeout(timer);
            ipcMain.removeListener(resultChannel, handleResult);
        };

        const handleResult = (event: IpcMainEvent, payload: any): void => {
            if (!mainWindow
                || mainWindow.isDestroyed()
                || event.sender.id !== mainWindow.webContents.id) return;
            if (!payload || payload.requestId !== requestId) return;
            cleanup();
            if (payload.success !== true) {
                const failure = readDebugBridgeChatExecutionFailure(payload)
                    || buildDebugBridgeChatExecutionFailure({
                        stage: 'renderer_preflight',
                        writePossible: false,
                        message: payload.error || '运行窗口预检失败',
                        code: 'renderer_preflight_failed',
                        requestId
                    });
                reject(createDebugBridgeChatExecutionError(failure));
                return;
            }
            const snapshot = readDebugBridgeChatPreflightSnapshot(payload.result);
            if (!snapshot) {
                reject(buildDebugChatError({
                    stage: 'renderer_preflight',
                    writePossible: false,
                    message: '运行窗口返回了无效的预检快照。',
                    code: 'renderer_preflight_snapshot_invalid',
                    requestId
                }));
                return;
            }
            resolve(snapshot);
        };

        ipcMain.on(resultChannel, handleResult);
        try {
            mainWindow!.webContents.send('debug-bridge:chat-preflight', { requestId });
        } catch (error) {
            cleanup();
            reject(buildDebugChatError({
                stage: 'main_preflight',
                writePossible: false,
                message: error instanceof Error ? error.message : String(error),
                code: 'renderer_preflight_dispatch_failed',
                requestId
            }));
        }
    });
}

function submitChatToCurrentWindow(input: DebugBridgeChatSubmitInput): Promise<unknown> {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return Promise.reject(buildDebugChatError({
            stage: 'main_preflight',
            writePossible: false,
            message: 'DesignEcho 主窗口不可用，不能提交运行窗口消息。',
            code: 'main_window_unavailable'
        }));
    }
    const expectedRuntimeGitCommit = String(input.expectedRuntimeGitCommit || '').trim().toLowerCase();
    const expectedRuntimeBuildId = String(input.expectedRuntimeBuildId || '').trim();
    const expectedPhotoshopRuntimeBuildId = String(
        input.expectedPhotoshopRuntimeBuildId || ''
    ).trim();
    const expectedPhotoshopRuntimeBinding = readDebugBridgePhotoshopRuntimeBinding(
        input.expectedPhotoshopRuntimeBinding
    );
    const completeGuard = Boolean(
        expectedRuntimeGitCommit
        && expectedRuntimeBuildId
        && expectedPhotoshopRuntimeBuildId
        && expectedPhotoshopRuntimeBinding
        && expectedPhotoshopRuntimeBinding.live.buildId === expectedPhotoshopRuntimeBuildId
        && String(input.expectedProjectPath || '').trim()
        && String(input.expectedProvider || '').trim()
        && String(input.expectedModelId || '').trim()
        && input.requireCleanRuntimeGitState === true
        && input.requireNoOpenPhotoshopDocuments === true
    );
    if (!completeGuard) {
        return Promise.reject(buildDebugChatError({
            stage: 'main_preflight',
            writePossible: false,
            message: '受控调试提交缺少完整的项目、构建、模型或 Photoshop 写前约束。',
            code: 'main_submission_guard_incomplete'
        }));
    }
    // 启动时身份只用于日志与诊断。正式受控提交必须重新读取 manifest 并逐文件验摘要，
    // 防止 watch/rebuild/Renderer reload 后继续沿用旧的 artifactsVerified 缓存。
    let submissionRuntimeBuildIdentity: DesignEchoRuntimeBuildIdentity;
    try {
        submissionRuntimeBuildIdentity = captureCurrentRuntimeBuildIdentity();
    } catch (error) {
        return Promise.reject(buildDebugChatError({
            stage: 'main_preflight',
            writePossible: false,
            message: error instanceof Error ? error.message : String(error),
            code: 'runtime_identity_submission_failed'
        }));
    }
    if (submissionRuntimeBuildIdentity.version !== 'designecho-runtime-build-identity/v1'
        || submissionRuntimeBuildIdentity.gitCommit !== expectedRuntimeGitCommit
        || submissionRuntimeBuildIdentity.buildId !== expectedRuntimeBuildId
        || submissionRuntimeBuildIdentity.artifactsVerified !== true) {
        return Promise.reject(buildDebugChatError({
            stage: 'main_preflight',
            writePossible: false,
            message: '当前 DesignEcho 实际构建与受控调试指定版本不一致，请重新构建并重启。',
            code: 'runtime_build_mismatch'
        }));
    }
    if (submissionRuntimeBuildIdentity.gitDirty !== false) {
        return Promise.reject(buildDebugChatError({
            stage: 'main_preflight',
            writePossible: false,
            message: '当前 DesignEcho 构建来自未提交工作树，不能进入受控质量样本。',
            code: 'runtime_build_dirty'
        }));
    }
    if (submissionRuntimeBuildIdentity.fakeModelEnabled || submissionRuntimeBuildIdentity.fakePhotoshopEnabled) {
        return Promise.reject(buildDebugChatError({
            stage: 'main_preflight',
            writePossible: false,
            message: '当前 DesignEcho 启用了测试替身，不能执行真实模型与 Photoshop 质量采集。',
            code: 'fake_runtime_forbidden'
        }));
    }
    if (debugChatSubmissionLeaseId) {
        return Promise.reject(buildDebugChatError({
            stage: 'main_preflight',
            writePossible: false,
            message: '已有受控调试请求尚未闭合；在它完成或应用重启前不会启动第二轮。',
            code: 'debug_submission_lease_held'
        }));
    }

    const requestId = `debug_chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    debugChatSubmissionLeaseId = requestId;
    const timeoutMs = Math.max(
        1000,
        Math.min(Number(input.timeoutMs) || 60000, MAX_DEBUG_BRIDGE_CHAT_TIMEOUT_MS)
    );

    return new Promise((resolve, reject) => {
        const resultChannel = 'debug-bridge:chat-submit-result';
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            try {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('debug-bridge:chat-cancel', { requestId });
                }
            } catch (error) {
                logService?.logAgent(
                    'warn',
                    `[DebugBridge] Failed to dispatch timeout cancellation (${error instanceof Error ? error.name : 'Error'})`
                );
            }
            reject(buildDebugChatError({
                stage: 'handle_send_started',
                writePossible: true,
                message: `运行窗口消息提交超时：${timeoutMs}ms`,
                code: 'debug_submission_timeout',
                requestId
            }));
        }, timeoutMs + 5000);

        const cleanup = (): void => {
            clearTimeout(timer);
            ipcMain.removeListener(resultChannel, handleResult);
            if (debugChatSubmissionLeaseId === requestId) {
                debugChatSubmissionLeaseId = null;
            }
        };

        const handleResult = (event: IpcMainEvent, payload: any): void => {
            if (!mainWindow
                || mainWindow.isDestroyed()
                || event.sender.id !== mainWindow.webContents.id) return;
            if (!payload || payload.requestId !== requestId) return;
            if (timedOut) {
                cleanup();
                return;
            }
            if (payload.success) {
                let completedRuntimeBuildIdentity: DesignEchoRuntimeBuildIdentity;
                try {
                    completedRuntimeBuildIdentity = captureCurrentRuntimeBuildIdentity();
                } catch (error) {
                    cleanup();
                    reject(buildDebugChatError({
                        stage: 'completion',
                        writePossible: true,
                        message: error instanceof Error ? error.message : String(error),
                        code: 'runtime_identity_completion_failed',
                        requestId
                    }));
                    return;
                }
                const runtimeArtifactsUnchangedThroughCompletion = Boolean(
                    completedRuntimeBuildIdentity.artifactsVerified === true
                    && completedRuntimeBuildIdentity.gitCommit === submissionRuntimeBuildIdentity.gitCommit
                    && completedRuntimeBuildIdentity.buildId === submissionRuntimeBuildIdentity.buildId
                    && completedRuntimeBuildIdentity.artifactDigest === submissionRuntimeBuildIdentity.artifactDigest
                    && completedRuntimeBuildIdentity.manifestDigest === submissionRuntimeBuildIdentity.manifestDigest
                );
                if (!runtimeArtifactsUnchangedThroughCompletion) {
                    cleanup();
                    reject(buildDebugChatError({
                        stage: 'completion',
                        writePossible: true,
                        message: 'DesignEcho 构建产物在受控任务期间发生变化，本轮不能计入正式质量样本。',
                        code: 'runtime_artifacts_changed',
                        requestId
                    }));
                    return;
                }
                const result: Record<string, unknown> = payload.result && typeof payload.result === 'object' && !Array.isArray(payload.result)
                    ? payload.result as Record<string, unknown>
                    : { snapshot: payload.result };
                const resultReceipt = result['receipt'];
                const receipt = resultReceipt && typeof resultReceipt === 'object' && !Array.isArray(resultReceipt)
                    ? resultReceipt as Record<string, unknown>
                    : {};
                const receiptExpectedPhotoshopBinding = readDebugBridgePhotoshopRuntimeBinding(
                    receipt['expectedPhotoshopRuntimeBinding']
                );
                const submittedPhotoshopRuntimeIdentity = readDebugBridgePhotoshopRuntimeLiveIdentity(
                    receipt['submittedPhotoshopRuntimeIdentity']
                );
                const completedPhotoshopRuntimeIdentity = readDebugBridgePhotoshopRuntimeLiveIdentity(
                    receipt['completedPhotoshopRuntimeIdentity']
                );
                const photoshopReceiptBound = Boolean(
                    expectedPhotoshopRuntimeBinding
                    && receiptExpectedPhotoshopBinding
                    && submittedPhotoshopRuntimeIdentity
                    && completedPhotoshopRuntimeIdentity
                    && debugBridgePhotoshopRuntimeBindingsMatch(
                        receiptExpectedPhotoshopBinding,
                        expectedPhotoshopRuntimeBinding
                    )
                    && debugBridgePhotoshopRuntimeLiveIdentitiesMatch(
                        submittedPhotoshopRuntimeIdentity,
                        expectedPhotoshopRuntimeBinding.live
                    )
                    && debugBridgePhotoshopRuntimeLiveIdentitiesMatch(
                        completedPhotoshopRuntimeIdentity,
                        expectedPhotoshopRuntimeBinding.live
                    )
                    && receipt['photoshopRuntimeBindingMatchedAtSubmission'] === true
                    && receipt['photoshopRuntimeBindingUnchangedThroughCompletion'] === true
                );
                if (!photoshopReceiptBound) {
                    cleanup();
                    reject(buildDebugChatError({
                        stage: 'completion',
                        writePossible: true,
                        message: 'Photoshop Runtime 完整身份没有贯穿受控任务，本轮不能计入正式质量样本。',
                        code: 'photoshop_runtime_binding_changed',
                        requestId
                    }));
                    return;
                }
                cleanup();
                resolve({
                    ...result,
                    receipt: {
                        ...receipt,
                        runtimeBuildIdentity: submissionRuntimeBuildIdentity,
                        completedRuntimeBuildIdentity,
                        runtimeArtifactsUnchangedThroughCompletion,
                        expectedRuntimeGitCommit: expectedRuntimeGitCommit || null,
                        expectedRuntimeBuildId: expectedRuntimeBuildId || null,
                        expectedPhotoshopRuntimeBuildId: expectedPhotoshopRuntimeBuildId || null,
                        expectedPhotoshopRuntimeBinding:
                            expectedPhotoshopRuntimeBinding as DebugBridgePhotoshopRuntimeBinding,
                        runtimeIdentityMatchedAtSubmission: Boolean(
                            expectedRuntimeGitCommit
                            && submissionRuntimeBuildIdentity.gitCommit === expectedRuntimeGitCommit
                            && submissionRuntimeBuildIdentity.buildId === expectedRuntimeBuildId
                            && submissionRuntimeBuildIdentity.gitDirty === false
                            && submissionRuntimeBuildIdentity.artifactsVerified === true
                        )
                    }
                });
            } else {
                cleanup();
                const failure = readDebugBridgeChatExecutionFailure(payload)
                    || buildDebugBridgeChatExecutionFailure({
                        stage: 'unknown',
                        writePossible: true,
                        message: payload.error || '运行窗口消息提交失败',
                        code: 'renderer_submission_failed_unclassified',
                        requestId
                    });
                reject(createDebugBridgeChatExecutionError(failure));
            }
        };

        ipcMain.on(resultChannel, handleResult);
        try {
            mainWindow!.webContents.send('debug-bridge:chat-submit', {
                ...input,
                requestId,
                timeoutMs
            });
        } catch (error) {
            cleanup();
            reject(buildDebugChatError({
                stage: 'main_preflight',
                writePossible: false,
                message: error instanceof Error ? error.message : String(error),
                code: 'renderer_submission_dispatch_failed',
                requestId
            }));
        }
    });
}

type PersistedApiKeys = {
    anthropic?: string;
    google?: string;
    xiaomi?: string;
    openai?: string;
    openrouter?: string;
    deepseek?: string;
    ollamaUrl?: string;
    ollamaApiKey?: string;
    bfl?: string;
    volcengineJimengAccessKeyId?: string;
    volcengineJimengSecretAccessKey?: string;
    volcengineSeedreamApiKey?: string;
    volcengineTosRegion?: string;
    volcengineTosEndpoint?: string;
    volcengineTosBucket?: string;
    volcengineTosPublicBaseUrl?: string;
    volcengineTosKeyPrefix?: string;
};

/**
 * 释放指定端口上占用的进程（仅 Windows 支持）
 */
function killProcessOnPort(port: number): boolean {
    if (process.env.DESIGNECHO_ALLOW_PORT_CLEANUP !== '1') {
        console.log(`[Main] Port cleanup is disabled by default. Set DESIGNECHO_ALLOW_PORT_CLEANUP=1 to intentionally free port ${port}.`);
        return false;
    }

    if (process.platform !== 'win32') {
        console.log('[Main] Port cleanup is only supported on Windows.');
        return false;
    }
    
    try {
        const result = execSync(`netstat -ano | findstr ":${port}"`, { encoding: 'utf-8' });
        const lines = result.split('\n').filter(line => line.includes('LISTENING'));
        
        for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            const pid = parts[parts.length - 1];
            
            if (pid && /^\d+$/.test(pid) && parseInt(pid) > 0) {
                console.log(`[Main] Found process on target port. PID: ${pid}`);
                try {
                    execSync(`taskkill /F /PID ${pid}`, { encoding: 'utf-8' });
                    console.log(`[Main] Process ${pid} terminated`);
                    return true;
                } catch (e) {
                    console.log(`[Main] Unable to terminate process ${pid} (it may already be closed)`);
                }
            }
        }
    } catch {
        // 端口无占用或 netstat 未找到匹配项
    }
    return false;
}

/**
 * 创建主窗口（Electron BrowserWindow）
 */
function createWindow(): void {
    mainWindowShown = false;
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        title: 'DesignEcho',
        backgroundColor: '#0d0d14',
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 16, y: 16 },
        autoHideMenuBar: true,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });
    
    mainWindow.setMenuBarVisibility(false);

    const showMainWindow = (reason: string): void => {
        if (!mainWindow || mainWindowShown) return;
        mainWindowShown = true;
        console.log(`[Main] Showing main window. reason=${reason}`);
        if (mainWindow.isMinimized()) {
            mainWindow.restore();
        }
        mainWindow.show();
        mainWindow.focus();
    };

    mainWindow.once('ready-to-show', () => {
        console.log('[Main] Window ready to show');
        showMainWindow('ready-to-show');
    });

    // 加载渲染进程页面。ChatPanel 测试桥接只在显式环境变量下启用，默认不暴露给用户会话。
    const rendererQuery = process.env.DESIGNECHO_CHAT_TEST_BRIDGE === '1'
        ? {
            designechoChatTestBridge: '1',
            ...(process.env.DESIGNECHO_CHAT_TEST_PROJECT_PATH
                ? { designechoChatTestProjectPath: process.env.DESIGNECHO_CHAT_TEST_PROJECT_PATH }
                : {}),
            ...(process.env.DESIGNECHO_CHAT_TEST_FAKE_MODEL === '1'
                ? { designechoChatTestFakeModel: '1' }
                : {}),
            ...(process.env.DESIGNECHO_CHAT_TEST_FAKE_PHOTOSHOP === '1'
                ? { designechoChatTestFakePhotoshop: '1' }
                : {}),
            ...(process.env.DESIGNECHO_CHAT_TEST_FAKE_PHOTOSHOP_EMPTY === '1'
                ? { designechoChatTestFakePhotoshopEmpty: '1' }
                : {})
        }
        : undefined;
    let rendererLoadRetries = 0;
    let rendererStartupTimeout: ReturnType<typeof setTimeout> | null = null;
    const loadRenderer = (): void => {
        if (!rendererStartupTimeout) {
            rendererStartupTimeout = setTimeout(() => {
                showMainWindow('startup-timeout');
            }, 5000);
        }
        mainWindow?.loadFile(
            path.join(__dirname, '../../renderer/index.html'),
            rendererQuery ? { query: rendererQuery } : undefined
        );
    };
    loadMainWindowRenderer = loadRenderer;

    mainWindow.webContents.on('did-finish-load', () => {
        rendererLoadRetries = 0;
        if (rendererStartupTimeout) {
            clearTimeout(rendererStartupTimeout);
            rendererStartupTimeout = null;
        }
        showMainWindow('did-finish-load');
        if (ipcHandlersReady) publishCodexSubscriptionState('ready');
    });

    // 带 preload 的主窗口只能停留在打包后的本地 renderer。所有外链都交给系统浏览器，
    // 防止远端页面或 window.open 继承 DesignEcho 的高权限 IPC 桥。
    mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
        if (isTrustedRendererUrl(navigationUrl)) return;
        event.preventDefault();
        openExternalFromMainWindow(navigationUrl);
    });
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        openExternalFromMainWindow(url);
        return { action: 'deny' };
    });

    // 渲染进程 console 告警/错误落盘：此前 ErrorBoundary 崩溃现场只在 DevTools 可见，事后无法诊断。
    mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
        if (level < 2) return;
        const source = sourceId ? `${sourceId}:${line}` : 'renderer';
        logService?.logAgent(level === 3 ? 'error' : 'warn', `[Renderer] ${message} (${source})`);
    });

    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
        // -3 = ERR_ABORTED：新一次 load 取代旧 load 的正常信号，不是失败。
        if (errorCode === -3) return;
        console.error(`[Main] Renderer failed to load. code=${errorCode}, description=${errorDescription}, url=${validatedURL}`);
        // 加载失败最常见的场景是启动恰逢 dist 重建、index.html/资产尚未写全。
        // 此前这里只把窗口 show 出来，用户面对的是一个永久纯黑的空窗口；改为延迟重试自愈。
        if (rendererLoadRetries < 5) {
            rendererLoadRetries += 1;
            console.warn(`[Main] Renderer 加载失败（${errorDescription}），1 秒后重试（第 ${rendererLoadRetries}/5 次）`);
            setTimeout(() => {
                if (mainWindow) loadRenderer();
            }, 1000);
            return;
        }
        showMainWindow('did-fail-load');
    });

    mainWindow.on('closed', () => {
        if (rendererStartupTimeout) clearTimeout(rendererStartupTimeout);
        loadMainWindowRenderer = null;
        mainWindow = null;
        mainWindowShown = false;
    });

    console.log('[Main] Window created (hidden until ready)');
}

function readPersistedStateEntries(): Record<string, string> {
    try {
        const stateStorePath = path.join(app.getPath('userData'), 'app-state-store.json');
        if (!fs.existsSync(stateStorePath)) {
            return {};
        }

        const raw = fs.readFileSync(stateStorePath, 'utf8');
        const parsed = JSON.parse(raw);
        return parsed?.entries && typeof parsed.entries === 'object'
            ? { ...(parsed.entries as Record<string, string>) }
            : {};
    } catch (error: any) {
        console.warn('[Main] Failed to read persisted renderer state:', error?.message || String(error));
    }
    return {};
}

function readPersistedApiKeys(entries: Record<string, string>): PersistedApiKeys {
    const tryParseApiKeys = (source: any): PersistedApiKeys => {
        const apiKeys = source?.apiKeys && typeof source.apiKeys === 'object' ? source.apiKeys : {};
        return {
            anthropic: typeof apiKeys.anthropic === 'string' ? apiKeys.anthropic : '',
            google: typeof apiKeys.google === 'string' ? apiKeys.google : '',
            xiaomi: typeof apiKeys.xiaomi === 'string' ? apiKeys.xiaomi : '',
            openai: typeof apiKeys.openai === 'string' ? apiKeys.openai : '',
            openrouter: typeof apiKeys.openrouter === 'string' ? apiKeys.openrouter : '',
            deepseek: typeof apiKeys.deepseek === 'string' ? apiKeys.deepseek : '',
            ollamaUrl: typeof apiKeys.ollamaUrl === 'string' ? apiKeys.ollamaUrl : '',
            ollamaApiKey: typeof apiKeys.ollamaApiKey === 'string' ? apiKeys.ollamaApiKey : '',
            bfl: typeof apiKeys.bfl === 'string' ? apiKeys.bfl : '',
            volcengineJimengAccessKeyId: typeof apiKeys.volcengineJimengAccessKeyId === 'string' ? apiKeys.volcengineJimengAccessKeyId : '',
            volcengineJimengSecretAccessKey: typeof apiKeys.volcengineJimengSecretAccessKey === 'string' ? apiKeys.volcengineJimengSecretAccessKey : '',
            volcengineSeedreamApiKey: typeof apiKeys.volcengineSeedreamApiKey === 'string' ? apiKeys.volcengineSeedreamApiKey : '',
            volcengineTosRegion: typeof apiKeys.volcengineTosRegion === 'string' ? apiKeys.volcengineTosRegion : '',
            volcengineTosEndpoint: typeof apiKeys.volcengineTosEndpoint === 'string' ? apiKeys.volcengineTosEndpoint : '',
            volcengineTosBucket: typeof apiKeys.volcengineTosBucket === 'string' ? apiKeys.volcengineTosBucket : '',
            volcengineTosPublicBaseUrl: typeof apiKeys.volcengineTosPublicBaseUrl === 'string' ? apiKeys.volcengineTosPublicBaseUrl : '',
            volcengineTosKeyPrefix: typeof apiKeys.volcengineTosKeyPrefix === 'string' ? apiKeys.volcengineTosKeyPrefix : ''
        };
    };

    for (const rawEntry of [entries.rendererState, entries['designecho-storage']]) {
        if (typeof rawEntry !== 'string' || !rawEntry.trim()) continue;
        try {
            const parsed = JSON.parse(rawEntry);
            const keys = tryParseApiKeys(parsed?.state || parsed);
            if (Object.values(keys).some(Boolean)) return keys;
        } catch (error: any) {
            console.warn('[Main] Ignored malformed persisted API key entry:', error?.message || String(error));
        }
    }
    return {};
}

function publishCodexSubscriptionState(reason: 'account' | 'runtime_exit' | 'ready'): void {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('codexSubscription:stateChanged', { reason });
    }
}

function invalidateCodexSubscriptionModels(reason: 'account' | 'runtime_exit'): void {
    if (reason === 'account') {
        setDynamicModels(
            getDynamicModels().filter((model) => model.provider !== CODEX_SUBSCRIPTION_PROVIDER)
        );
    }
    publishCodexSubscriptionState(reason);
}

async function hydrateCodexSubscriptionModels(): Promise<void> {
    if (codexSubscriptionHydration) return codexSubscriptionHydration;
    const service = codexSubscriptionService;
    if (!service) return;

    const hydration = (async (): Promise<void> => {
        const status = await service.getStatus();
        if (!status.success || !status.status.signedIn) return;
        const result = await service.listModels(false);
        if (!result.success) {
            logService?.logAgent('warn', '[Main] ChatGPT subscription model catalog bootstrap failed');
            return;
        }
        const otherProviders = getDynamicModels().filter(
            (model) => model.provider !== CODEX_SUBSCRIPTION_PROVIDER
        );
        setDynamicModels([...otherProviders, ...result.models]);
        logService?.logAgent('info', `[Main] Restored ${result.models.length} ChatGPT subscription models for this session`);
    })();
    codexSubscriptionHydration = hydration;
    try {
        await hydration;
    } finally {
        if (codexSubscriptionHydration === hydration) codexSubscriptionHydration = null;
    }
}

function handleCodexSubscriptionStateChanged(reason: 'account' | 'runtime_exit'): void {
    invalidateCodexSubscriptionModels(reason);
    if (reason === 'account') void hydrateCodexSubscriptionModels();
}

/**
 * 启动内嵌 WebView 静态文件服务器（用于 UXP 侧调试面板等）
 */
function startWebViewServer(): void {
    const appPath = app.getAppPath();
    const publicDir = path.join(appPath, 'public/webview');
    
    console.log(`[Main] WebView public dir: ${publicDir}`);
    
    if (!fs.existsSync(publicDir)) {
        console.error(`[Main] WebView directory not found: ${publicDir}`);
        logService?.logAgent('error', `WebView directory not found: ${publicDir}`);
        return;
    }
    
    const mimeTypes: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon'
    };
    
    webviewServer = http.createServer((req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        
        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }
        
        // 去掉查询串再解析：带 ?v=1 之类的请求此前会被当成文件名直接 404
        const requestPath = decodeURIComponent(String(req.url || '/').split('?')[0].split('#')[0]);
        const relativePath = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
        const filePath = path.resolve(publicDir, relativePath);

        // 目录穿越防护：请求只能落在 public/webview 内
        if (filePath !== path.resolve(publicDir) && !filePath.startsWith(path.resolve(publicDir) + path.sep)) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
        }

        const extname = path.extname(filePath).toLowerCase();
        const contentType = mimeTypes[extname] || 'application/octet-stream';

        fs.readFile(filePath, (err, content) => {
            if (err) {
                if (err.code === 'ENOENT') {
                    res.writeHead(404);
                    res.end('Not Found');
                } else {
                    res.writeHead(500);
                    res.end('Server Error');
                }
            } else {
                // 本地面板资源禁缓存：否则改完 webview 重载插件面板仍然跑的是旧脚本
                res.writeHead(200, {
                    'Content-Type': contentType,
                    'Cache-Control': 'no-store, must-revalidate'
                });
                res.end(content);
            }
        });
    });
    
    webviewServer.listen(WEBVIEW_SERVER_PORT, WEBVIEW_BIND_HOST, () => {
        logService?.logAgent('info', `WebView server started at http://${WEBVIEW_BIND_HOST}:${WEBVIEW_SERVER_PORT}`);
        console.log(`[Main] WebView server started on port ${WEBVIEW_SERVER_PORT}`);
    });
    
    webviewServer.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
            logService?.logAgent('warn', `WebView port ${WEBVIEW_SERVER_PORT} is already in use.`);
        } else {
            logService?.logAgent('error', `WebView server error: ${err.message}`);
        }
    });
}

/**
 * 初始化所有后端服务
 */
async function initializeServices(): Promise<void> {
    // 日志服务（最先初始化，后续服务依赖日志输出）
    logService = getLogService();
    await logService.initialize();
    logService.interceptConsole();
    logService.logAgent('info', 'DesignEcho Agent service initialization started');
    const currentRuntimeBuildIdentity = captureCurrentRuntimeBuildIdentity();
    logService.logAgent(
        'info',
        `[RuntimeIdentity] source=${currentRuntimeBuildIdentity.source} commit=${currentRuntimeBuildIdentity.gitCommit || 'unavailable'} dirty=${String(currentRuntimeBuildIdentity.gitDirty)}`
    );

    const persistedStateEntries = readPersistedStateEntries();
    const persistedApiKeys = readPersistedApiKeys(persistedStateEntries);
    const persistedModelRuntime = resolvePersistedModelRuntimeState(persistedStateEntries);
    // renderer Zustand Store 是模型偏好的持久化 owner。主进程在任何资源 IPC 可达前
    // 直接读取同一份快照，并先恢复持久化动态目录；不再等待 App 挂载后的延迟推送。
    setDynamicModels(persistedModelRuntime.dynamicModels);
    logService.logAgent(
        'info',
        `[Main] Restored model runtime from ${persistedModelRuntime.source}: `
        + `${persistedModelRuntime.dynamicModels.length} persisted dynamic models`
    );
    if (persistedApiKeys.bfl) {
        bflService.setApiKey(persistedApiKeys.bfl);
        logService.logAgent('info', '[Main] Restored BFL API Key from persisted state');
    }
    if (persistedApiKeys.volcengineJimengAccessKeyId || persistedApiKeys.volcengineJimengSecretAccessKey) {
        volcengineJimengInpaintingService.setCredentials(
            persistedApiKeys.volcengineJimengAccessKeyId,
            persistedApiKeys.volcengineJimengSecretAccessKey
        );
        volcengineJimengImageService.setCredentials(
            persistedApiKeys.volcengineJimengAccessKeyId,
            persistedApiKeys.volcengineJimengSecretAccessKey
        );
        logService.logAgent('info', '[Main] Restored Jimeng inpainting credentials from persisted state');
    }
    if (
        persistedApiKeys.volcengineTosRegion ||
        persistedApiKeys.volcengineTosEndpoint ||
        persistedApiKeys.volcengineTosBucket ||
        persistedApiKeys.volcengineTosPublicBaseUrl ||
        persistedApiKeys.volcengineTosKeyPrefix
    ) {
        volcengineTosUploadService.setConfig({
            region: persistedApiKeys.volcengineTosRegion,
            endpoint: persistedApiKeys.volcengineTosEndpoint,
            bucket: persistedApiKeys.volcengineTosBucket,
            publicBaseUrl: persistedApiKeys.volcengineTosPublicBaseUrl,
            keyPrefix: persistedApiKeys.volcengineTosKeyPrefix
        });
        logService.logAgent('info', '[Main] Restored TOS upload config from persisted state');
    }
    if (persistedApiKeys.volcengineSeedreamApiKey) {
        volcengineSeedreamService.setApiKey(persistedApiKeys.volcengineSeedreamApiKey);
        logService.logAgent('info', '[Main] Restored Seedream API Key from persisted state');
    }
    if (persistedApiKeys.openrouter) {
        openRouterGeminiImageService.setApiKey(persistedApiKeys.openrouter);
        logService.logAgent('info', '[Main] Restored OpenRouter API Key for Gemini image edit from persisted state');
    }
    // ChatGPT 订阅模型使用独立 Codex App Server 与隔离凭据目录；它不是 OpenAI API Key。
    codexSubscriptionService = new CodexSubscriptionService({
        userDataDir: app.getPath('userData'),
        clientVersion: app.getVersion(),
        onStateChanged: handleCodexSubscriptionStateChanged
    });
    await hydrateCodexSubscriptionModels();

    // Claude 订阅：Agent SDK 内嵌运行时，凭据由官方运行时自管（终端 /login），主进程不经手。
    claudeSubscriptionService = new ClaudeSubscriptionService();
    // 启动即恢复（不依赖用户打开设置页——真机 2026-08-23：注册链曾挂在设置卡挂载上，
    // 用户直接聊天时列表只剩持久化旧条目）：凭据在 → 后台验证+解析真实型号 → 注册并通知渲染层重拉。
    void (async () => {
        const service = claudeSubscriptionService;
        if (!service) return;
        const status = await service.getStatus();
        if (!status.success || !status.status.signedIn) return;
        const probe = await service.probeAuth();
        if (!probe.success) {
            logService?.logAgent('warn', `[Main] Claude subscription bootstrap probe failed: ${probe.error || 'unknown'}`);
            return;
        }
        const models = service.listModels();
        const otherProviders = getDynamicModels().filter((model) => model.provider !== 'claude-subscription');
        setDynamicModels([...otherProviders, ...models]);
        logService?.logAgent('info', `[Main] Restored ${models.length} Claude subscription models for this session`);
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('claudeSubscription:modelsReady');
        }
    })();

    // 初始化 AI 模型服务（多 provider 支持）
    modelService = new ModelService({
        anthropicApiKey: persistedApiKeys.anthropic,
        googleApiKey: persistedApiKeys.google,
        xiaomiApiKey: persistedApiKeys.xiaomi,
        openaiApiKey: persistedApiKeys.openai,
        openrouterApiKey: persistedApiKeys.openrouter,
        deepseekApiKey: persistedApiKeys.deepseek,
        ollamaUrl: persistedApiKeys.ollamaUrl,
        ollamaApiKey: persistedApiKeys.ollamaApiKey
    }, codexSubscriptionService, claudeSubscriptionService);
    logService.logAgent('info', 'Model service initialized');
    
    // 任务协调器（管理 Agent 任务的调度与执行）
    taskOrchestrator = new TaskOrchestrator(
        modelService,
        persistedModelRuntime.modelPreferences || undefined
    );
    logService.logAgent(
        'info',
        `Task orchestrator initialized with Agent model ${taskOrchestrator.getPreferences().primaryModel}`
    );

    // 资源管理服务（知识库文件、模板资源等）
    resourceManagerService = new ResourceManagerService();
    logService.logAgent('info', 'Resource manager initialized');

    // 局部重绘服务（Inpainting）
    inpaintingService = new InpaintingService();
    logService.logAgent('info', 'Inpainting service initialized');

    // 抠图服务（本地 ONNX 推理）
    // 模型目录显式指向 userData/models —— 与模型下载(model:download)、设置页列模型(matting:models)一致，
    // 避免推理服务在工程相对目录里找不到已下载的 BiRefNet/YOLO 模型。
    mattingService = new MattingService({ modelsDir: path.join(app.getPath('userData'), 'models') });
    logService.logAgent('info', 'Matting service initialized (local ONNX mode)');
    
    const mattingReady = await mattingService.reinitializePythonBackend();
    if (mattingReady) {
        logService.logAgent('info', 'Local matting engine ready');
    } else {
        logService.logAgent('warn', 'Matting engine initialization failed');
    }

    // 主体检测服务（用于智能排版的主体边界识别）
    subjectDetectionService = getSubjectDetectionService();
    // 2026-08-18 之前从未调用 setMattingService：服务一直是「抠图服务未初始化」，
    // measureReferenceComposition 与素材主体框的分割级都在静默失败（建好未接线）。
    subjectDetectionService.setMattingService(mattingService);
    logService.logAgent('info', 'Subject detection service initialized (matting wired)');
    
    // 轮廓提取服务（用于主体边缘描绘与裁切）
    contourService = ContourService.getInstance();
    logService.logAgent('info', 'Contour extraction service initialized');
    
    // SAM 分割服务
    samService = getSAMService({ modelsDir: path.join(process.cwd(), 'models') });
    const samReady = await samService.initialize();
    if (samReady) {
        logService.logAgent('info', 'SAM selection service ready');
    } else {
        logService.logAgent('info', 'SAM model unavailable, fallback to BiRefNet');
    }

    // WebSocket 服务（与 UXP 插件通信）
    wsServer = new WebSocketServer(WS_PORT, {
        onMessage: async (message) => {
            mainWindow?.webContents.send('ws:message', message);
        },
        onConnection: () => {
            logService?.logAgent('info', 'UXP plugin connected');
            mainWindow?.webContents.send('ws:connected');
        },
        onDisconnection: () => {
            logService?.logAgent('info', 'UXP plugin disconnected');
            mainWindow?.webContents.send('ws:disconnected');
        }
    });

    // 注册 UXP 消息处理器
    const uxpContext: UXPContext = {
        wsServer,
        logService,
        taskOrchestrator,
        mattingService,
        inpaintingService,
        subjectDetectionService,
        contourService,
        samService,
        mainWindow
    };
    registerUXPHandlers(uxpContext);

    // 先完成全部 Handler 注册，再开放端口，避免 UXP 在初始化窗口期命中新连接却拿到 Method not found。
    wsServer.start();
    logService.logAgent('info', `WebSocket server started on port ${WS_PORT}`);
    logService.logAgent('info', `Log file: ${logService.getLogFilePath()}`);
    
    // 启动 WebView 静态文件服务
    startWebViewServer();

    // 启动 Debug Bridge 服务（用于调试面板的消息代理与会话录制）
    debugBridgeService = new DebugBridgeService({
        host: WEBVIEW_BIND_HOST,
        port: DEBUG_BRIDGE_PORT,
        dataDir: path.join(app.getPath('userData'), 'debug-bridge'),
        onChatSubmitPreflight: readChatPreflightFromCurrentWindow,
        onChatSubmit: submitChatToCurrentWindow,
        onEvent: (event) => {
            if (event.type === 'session.created') {
                logService?.logAgent('info', `[DebugBridge] Session created: ${event.sessionId}`);
            } else {
                const message = event.payload as { role?: string; direction?: string; content?: string };
                const preview = String(message.content || '').slice(0, 80);
                logService?.logAgent(
                    'info',
                    `[DebugBridge] ${event.sessionId} ${message.direction || 'inbound'} ${message.role || 'user'}: ${preview}`
                );
            }
            mainWindow?.webContents.send('debug-bridge:event', event);
        }
    });
    debugBridgeService.start();
    logService.logAgent('info', `Debug Bridge started at http://${WEBVIEW_BIND_HOST}:${DEBUG_BRIDGE_PORT}`);

    mcpHostService = new MCPHostService({
        host: WEBVIEW_BIND_HOST,
        port: MCP_HOST_PORT,
        wsServer: wsServer!,
        debugBridge: debugBridgeService!,
        resourceManagerService,
        modelService,
        taskOrchestrator,
        runtimeBuildIdentity: currentRuntimeBuildIdentity,
        onLog: (level, message) => logService?.logAgent(level, message)
    });
    mcpHostService.start();
    logService.logAgent('info', `MCP Host started at ${mcpHostService.getBaseUrl()}/mcp`);

    // 启动浏览器扩展桥（Agent 操作用户真实浏览器，见 docs/browser-extension-bridge.md）
    browserBridgeService = initBrowserBridgeService({
        host: WEBVIEW_BIND_HOST,
        port: BROWSER_BRIDGE_PORT,
        token: process.env.DESIGNECHO_BROWSER_BRIDGE_TOKEN,
        onLog: (level, message) => logService?.logAgent(level, message),
        // 扩展侧用户主动收藏（保存链接/批量收藏/截图）经此写入 Eagle 当前打开的素材库
        onClientRequest: (method, params) => handleBrowserCollectionRequest(method, params, {
            onLog: (level, message) => logService?.logAgent(level, message)
        })
    });
    await browserBridgeService.start();

    console.log('[Main] Services initialized');
}

/**
 * 注册渲染进程的 IPC 通道
 */
function setupIPC(): void {
    const context: IPCContext = {
        wsServer,
        modelService,
        taskOrchestrator,
        logService,
        mattingService,
        resourceManagerService,
        codexSubscriptionService,
        claudeSubscriptionService,
        mcpHostEndpoint: mcpHostService ? `${mcpHostService.getBaseUrl()}/mcp` : null,
        mainWindow
    };
    
    setupIPCHandlers(context);
    console.log('[Main] IPC handlers registered');
}

// 处理第二个实例启动时聚焦已有窗口，而非新建窗口
app.on('second-instance', () => {
    if (mainWindow) {
        if (mainWindow.isMinimized()) {
            mainWindow.restore();
        }
        if (!mainWindow.isVisible()) {
            mainWindow.show();
        }
        mainWindow.focus();
        console.log('[Main] Focused existing window');
    }
});

// 应用就绪后初始化
app.whenReady().then(async () => {
    if (process.env.DESIGNECHO_SKIP_PORT_CLEANUP === '1') {
        console.log(`[Main] Skipping port cleanup for ${WS_PORT} because DESIGNECHO_SKIP_PORT_CLEANUP=1`);
    } else if (process.env.DESIGNECHO_ALLOW_PORT_CLEANUP === '1') {
        console.log(`[Main] Preparing to intentionally free port ${WS_PORT} before startup...`);
        killProcessOnPort(WS_PORT);
    } else {
        console.log(`[Main] Port cleanup skipped for ${WS_PORT}. Existing runtimes will not be terminated automatically.`);
    }
    
    await new Promise(resolve => setTimeout(resolve, 500));

    // 必须先于 createWindow：渲染进程加载后立即同步水合 persist，
    // 等 setupIPC 再注册该通道每次都会竞态失败（见 early-state-handlers.ts）。
    registerEarlyStateStoreHandlers();

    createWindow();
    await initializeServices();
    setupIPC();
    ipcHandlersReady = true;
    loadMainWindowRenderer?.();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
            loadMainWindowRenderer?.();
        }
    });
});

// 所有窗口关闭后退出应用（macOS 除外，macOS 上应用通常保持活跃）
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// 应用退出前清理资源，确保所有服务正常关闭
app.on('before-quit', async () => {
    console.log('[Main] App is shutting down. Cleaning up resources...');

    cleanupStreams();
    
    if (mattingService) {
        await mattingService.shutdown();
    }
    
    if (wsServer) {
        wsServer.stop();
    }

    if (debugBridgeService) {
        debugBridgeService.stop();
    }

    if (mcpHostService) {
        mcpHostService.stop();
    }

    if (browserBridgeService) {
        browserBridgeService.stop();
    }

    if (codexSubscriptionService) {
        await codexSubscriptionService.dispose();
    }

    if (logService) {
        await logService.close();
    }
    
    console.log('[Main] Resource cleanup completed');
});
