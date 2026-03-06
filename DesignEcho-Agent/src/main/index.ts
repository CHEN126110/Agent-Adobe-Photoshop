/**
 * DesignEcho Agent - 主进程入口 (重构版)
 * 
 * 注意：
 * - 当前运行入口仍为 index.ts（package main 指向 dist/main/main/index.js）
 * - 本文件仅作为迁移参考，不应与 index.ts 并行启用
 * 
 * 重构说明：
 * 1. IPC handlers 按功能拆分到 ipc-handlers/ 目录
 * 2. UXP handlers 按功能拆分到 uxp-handlers/ 目录
 * 3. 业务逻辑提取到独立服务
 * 4. 入口文件只负责应用启动、服务初始化、模块协调
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import http from 'http';
import { execSync } from 'child_process';

// 服务导入
import { WebSocketServer } from './websocket/server';
import { ModelService } from './services/model-service';
import { TaskOrchestrator } from './services/task-orchestrator';
import { getLogService, LogService } from './services/log-service';
import { MattingService } from './services/matting-service';
import { ResourceManagerService } from './services/resource-manager-service';
import { InpaintingService } from './services/inpainting-service';
import { getSubjectDetectionService, SubjectDetectionService } from './services/subject-detection-service';
import { ContourService } from './services/contour-service';
import { getSAMService, SAMService } from './services/sam-service';

// 模块化 handlers 导入
import { setupIPCHandlers, IPCContext } from './ipc-handlers';
import { registerUXPHandlers, UXPContext } from './uxp-handlers';

// ============ 常量 ============
const WS_PORT = 8765;
const WEBVIEW_SERVER_PORT = 8766;

// ============ 单实例锁定 ============
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    console.log('[Main] 已有 Agent 实例在运行，退出...');
    app.quit();
    process.exit(0);
}

// ============ 全局服务引用 ============
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

// ============ 二进制协议 ============
let binaryRequestIdCounter = 1;
const receivedBinaryImages: Map<number, { 
    type: number; 
    width: number; 
    height: number; 
    data: Buffer;
    timestamp: number;
}> = new Map();

// 定期清理过期缓存
setInterval(() => {
    const now = Date.now();
    for (const [id, cache] of receivedBinaryImages) {
        if (now - cache.timestamp > 5 * 60 * 1000) {
            receivedBinaryImages.delete(id);
            console.log(`[Binary Cache] 清理过期缓存: requestId=${id}`);
        }
    }
}, 60 * 1000);

/**
 * 清理占用指定端口的进程（Windows）
 */
function killProcessOnPort(port: number): boolean {
    if (process.platform !== 'win32') {
        console.log('[Main] 端口清理仅支持 Windows');
        return false;
    }
    
    try {
        const result = execSync(`netstat -ano | findstr ":${port}"`, { encoding: 'utf-8' });
        const lines = result.split('\n').filter(line => line.includes('LISTENING'));
        
        for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            const pid = parts[parts.length - 1];
            
            if (pid && /^\d+$/.test(pid) && parseInt(pid) > 0) {
                console.log(`[Main] 尝试终止进程 PID: ${pid}`);
                try {
                    execSync(`taskkill /F /PID ${pid}`, { encoding: 'utf-8' });
                    console.log(`[Main] 进程 ${pid} 已终止`);
                    return true;
                } catch (e) {
                    console.log(`[Main] 无法终止进程 ${pid}（可能已退出）`);
                }
            }
        }
    } catch {
        // 端口未被占用
    }
    return false;
}

/**
 * 创建主窗口
 */
function createWindow(): void {
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
            nodeIntegration: false
        }
    });
    
    mainWindow.setMenuBarVisibility(false);

    mainWindow.once('ready-to-show', () => {
        console.log('[Main] Window ready to show');
        mainWindow?.show();
    });

    // 始终从本地构建文件加载（桌面应用模式）
    mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'));

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    console.log('[Main] Window created (hidden until ready)');
}

/**
 * 启动 WebView 静态文件服务器
 */
function startWebViewServer(): void {
    const appPath = app.getAppPath();
    const publicDir = path.join(appPath, 'public/webview');
    
    console.log(`[Main] WebView public dir: ${publicDir}`);
    
    if (!fs.existsSync(publicDir)) {
        console.error(`[Main] WebView directory not found: ${publicDir}`);
        logService?.logAgent('error', `WebView 目录不存在: ${publicDir}`);
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
        
        let filePath = req.url === '/' ? '/index.html' : req.url;
        filePath = path.join(publicDir, filePath || '');
        
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
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(content);
            }
        });
    });
    
    webviewServer.listen(WEBVIEW_SERVER_PORT, '127.0.0.1', () => {
        logService?.logAgent('info', `WebView 服务器已启动: http://127.0.0.1:${WEBVIEW_SERVER_PORT}`);
        console.log(`[Main] WebView server started on port ${WEBVIEW_SERVER_PORT}`);
    });
    
    webviewServer.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
            logService?.logAgent('warn', `WebView 端口 ${WEBVIEW_SERVER_PORT} 已被占用，跳过...`);
        } else {
            logService?.logAgent('error', `WebView 服务器错误: ${err.message}`);
        }
    });
}

/**
 * 初始化服务
 */
async function initializeServices(): Promise<void> {
    // 日志服务（优先初始化）
    logService = getLogService();
    await logService.initialize();
    logService.interceptConsole();
    logService.logAgent('info', 'DesignEcho Agent 服务初始化开始');

    // 模型服务
    modelService = new ModelService({});
    logService.logAgent('info', '模型服务已初始化');
    
    // 任务调度器
    taskOrchestrator = new TaskOrchestrator(modelService);
    logService.logAgent('info', '任务调度器已初始化');

    // 资源管理服务
    resourceManagerService = new ResourceManagerService();
    logService.logAgent('info', '资源管理服务已初始化');

    // 局部重绘服务
    inpaintingService = new InpaintingService();
    logService.logAgent('info', '局部重绘服务已初始化');

    // 抠图服务
    mattingService = new MattingService();
    logService.logAgent('info', '抠图服务已初始化（本地 ONNX 模式）');
    
    const mattingReady = await mattingService.reinitializePythonBackend();
    if (mattingReady) {
        logService.logAgent('info', '✅ 本地抠图引擎已就绪');
    } else {
        logService.logAgent('warn', '⚠️ 抠图引擎初始化失败');
    }

    // 主体检测服务
    subjectDetectionService = getSubjectDetectionService();
    logService.logAgent('info', '主体检测服务已初始化');
    
    // 轮廓提取服务
    contourService = ContourService.getInstance();
    logService.logAgent('info', '轮廓提取服务已初始化');
    
    // SAM 服务
    samService = getSAMService({ modelsDir: path.join(process.cwd(), 'models') });
    const samReady = await samService.initialize();
    if (samReady) {
        logService.logAgent('info', '✅ SAM 选区分割服务已就绪');
    } else {
        logService.logAgent('info', 'ℹ️ SAM 模型未安装，选区分割将使用 BiRefNet 回退');
    }

    // WebSocket 服务器
    wsServer = new WebSocketServer(WS_PORT, {
        onMessage: async (message) => {
            mainWindow?.webContents.send('ws:message', message);
        },
        onConnection: () => {
            logService?.logAgent('info', 'UXP 插件已连接');
            mainWindow?.webContents.send('ws:connected');
        },
        onDisconnection: () => {
            logService?.logAgent('info', 'UXP 插件已断开');
            mainWindow?.webContents.send('ws:disconnected');
        }
    });

    wsServer.start();
    logService.logAgent('info', `WebSocket 服务器已启动，端口: ${WS_PORT}`);
    logService.logAgent('info', `日志文件位置: ${logService.getLogFilePath()}`);
    
    // 设置二进制图像接收处理器
    wsServer.setBinaryHandler(async (header, imageData) => {
        const { BinaryMessageType, getBinaryTypeName } = await import('../shared/binary-protocol');
        
        console.log(`[Binary Handler] 收到二进制图像: type=${getBinaryTypeName(header.type)}, requestId=${header.requestId}, ${header.width}x${header.height}, ${(imageData.length / 1024).toFixed(0)}KB`);
        
        if (header.type === BinaryMessageType.JPEG || 
            header.type === BinaryMessageType.PNG ||
            header.type === BinaryMessageType.RAW_RGB) {
            receivedBinaryImages.set(header.requestId, {
                type: header.type,
                width: header.width,
                height: header.height,
                data: imageData,
                timestamp: Date.now()
            });
            console.log(`[Binary Handler] 缓存图像: requestId=${header.requestId}`);
        }
        
        return null;
    });
    
    // 注册 UXP 请求处理器
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
    
    // 启动 WebView 服务器
    startWebViewServer();
    
    console.log('[Main] Services initialized');
}

/**
 * 设置 IPC 处理器
 */
function setupIPC(): void {
    const context: IPCContext = {
        wsServer,
        modelService,
        taskOrchestrator,
        logService,
        mattingService,
        resourceManagerService,
        mainWindow
    };
    
    setupIPCHandlers(context);
    console.log('[Main] IPC handlers registered');
}

// 当第二个实例尝试启动时，聚焦到主窗口
app.on('second-instance', () => {
    if (mainWindow) {
        if (mainWindow.isMinimized()) {
            mainWindow.restore();
        }
        mainWindow.focus();
        console.log('[Main] 聚焦到已有窗口');
    }
});

// 应用就绪
app.whenReady().then(async () => {
    console.log(`[Main] 检查端口 ${WS_PORT} 状态...`);
    killProcessOnPort(WS_PORT);
    
    await new Promise(resolve => setTimeout(resolve, 500));
    
    createWindow();
    await initializeServices();
    setupIPC();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

// 所有窗口关闭时退出
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// 退出前清理
app.on('before-quit', async () => {
    console.log('[Main] 应用退出，正在清理资源...');
    
    if (mattingService) {
        await mattingService.shutdown();
    }
    
    if (wsServer) {
        wsServer.stop();
    }
    
    if (logService) {
        await logService.close();
    }
    
    console.log('[Main] 资源清理完成');
});
