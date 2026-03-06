# Electron Agent 开发指南

> **适用版本**: Electron 28+ / Node.js 20+  
> **更新日期**: 2026-01-25  
> **官方文档**: https://www.electronjs.org/docs

---

## 目录

1. [Electron 概述](#1-electron-概述)
2. [项目架构](#2-项目架构)
3. [主进程开发](#3-主进程开发)
4. [渲染进程开发](#4-渲染进程开发)
5. [IPC 通信](#5-ipc-通信)
6. [WebSocket 服务](#6-websocket-服务)
7. [服务层设计](#7-服务层设计)
8. [打包与发布](#8-打包与发布)

---

## 1. Electron 概述

### 1.1 什么是 Electron

Electron 是使用 JavaScript、HTML 和 CSS 构建跨平台桌面应用的框架。

```
┌─────────────────────────────────────────────────────────┐
│                    Electron 应用                         │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────────────┐   ┌─────────────────────────┐  │
│  │      主进程          │   │       渲染进程          │  │
│  │   (Node.js 环境)     │   │   (Chromium 环境)       │  │
│  │                     │   │                         │  │
│  │  - 窗口管理          │◄─►│  - React/Vue UI        │  │
│  │  - 系统 API          │IPC│  - 用户交互            │  │
│  │  - 文件操作          │   │  - 页面渲染            │  │
│  │  - 网络服务          │   │                         │  │
│  └─────────────────────┘   └─────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 1.2 DesignEcho 中的角色

在 DesignEcho 项目中，Electron Agent 承担：
- **AI 推理中心**: 运行 ONNX 模型
- **WebSocket 服务器**: 与 Photoshop UXP 插件通信
- **用户界面**: 提供项目管理和设置界面

---

## 2. 项目架构

### 2.1 目录结构

```
DesignEcho-Agent/
├── src/
│   ├── main/                    # 主进程
│   │   ├── index.ts             # 入口
│   │   ├── preload.ts           # 预加载脚本
│   │   ├── services/            # 服务层
│   │   │   ├── matting-service.ts
│   │   │   ├── sam-service.ts
│   │   │   └── morphing/
│   │   ├── ipc-handlers/        # IPC 处理器
│   │   ├── uxp-handlers/        # UXP 请求处理器
│   │   └── websocket/           # WebSocket 服务器
│   │       └── server.ts
│   ├── renderer/                # 渲染进程
│   │   ├── App.tsx
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── services/
│   │   └── stores/
│   └── shared/                  # 共享模块
│       ├── binary-protocol.ts
│       └── types/
├── models/                      # ONNX 模型
├── package.json
├── vite.config.ts               # Vite 配置
└── tsconfig.json
```

### 2.2 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | Electron 28 |
| 主进程 | Node.js 20 + TypeScript |
| 渲染进程 | React 18 + Vite |
| 状态管理 | Zustand |
| AI 推理 | onnxruntime-node |
| 图像处理 | Sharp |
| 通信 | WebSocket (ws) |

---

## 3. 主进程开发

### 3.1 应用入口

```typescript
// src/main/index.ts
import { app, BrowserWindow } from 'electron';
import path from 'path';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,    // 安全隔离
            nodeIntegration: false     // 禁用 Node
        }
    });

    // 开发模式加载 Vite 服务器
    if (process.env.NODE_ENV === 'development') {
        mainWindow.loadURL('http://localhost:5173');
    } else {
        mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
    }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
```

### 3.2 单实例锁定

防止多个 Agent 实例运行：

```typescript
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    console.log('已有 Agent 实例在运行，退出...');
    app.quit();
    process.exit(0);
}
```

### 3.3 Preload 脚本

安全地暴露 API 给渲染进程：

```typescript
// src/main/preload.ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('designEcho', {
    // 连接状态
    getConnectionStatus: () => ipcRenderer.invoke('connection:status'),
    onPluginConnected: (callback: () => void) => {
        ipcRenderer.on('plugin:connected', callback);
        return () => ipcRenderer.removeListener('plugin:connected', callback);
    },
    
    // 设置
    setApiKeys: (keys: Record<string, string>) => 
        ipcRenderer.invoke('config:set-api-keys', keys),
    
    // 抠图
    removeBackground: (params: any) => 
        ipcRenderer.invoke('matting:remove-background', params)
});
```

---

## 4. 渲染进程开发

### 4.1 React 入口

```tsx
// src/renderer/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
```

### 4.2 使用 Preload API

```tsx
// src/renderer/App.tsx
import { useEffect, useState } from 'react';

function App() {
    const [isConnected, setIsConnected] = useState(false);

    useEffect(() => {
        // 检查连接状态
        window.designEcho?.getConnectionStatus().then((status) => {
            setIsConnected(status?.connected ?? false);
        });

        // 监听连接事件
        const unsubscribe = window.designEcho?.onPluginConnected(() => {
            setIsConnected(true);
        });

        return () => unsubscribe?.();
    }, []);

    return (
        <div>
            <span>状态: {isConnected ? '已连接' : '未连接'}</span>
        </div>
    );
}
```

### 4.3 类型定义

```typescript
// src/renderer/types.d.ts
interface DesignEchoAPI {
    getConnectionStatus: () => Promise<{ connected: boolean }>;
    onPluginConnected: (callback: () => void) => () => void;
    onPluginDisconnected: (callback: () => void) => () => void;
    setApiKeys: (keys: Record<string, string>) => Promise<void>;
}

declare global {
    interface Window {
        designEcho?: DesignEchoAPI;
    }
}
```

---

## 5. IPC 通信

### 5.1 通信模式

| 模式 | 方法 | 用途 |
|------|------|------|
| 请求-响应 | `invoke` / `handle` | 获取数据、执行操作 |
| 单向通知 | `send` / `on` | 事件通知 |

### 5.2 Handler 注册

```typescript
// src/main/ipc-handlers/matting-handlers.ts
import { ipcMain } from 'electron';
import { MattingService } from '../services/matting-service';

export function setupMattingHandlers(mattingService: MattingService) {
    // 请求-响应模式
    ipcMain.handle('matting:remove-background', async (event, params) => {
        try {
            const result = await mattingService.removeBackground(params);
            return { success: true, data: result };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });
    
    // 获取状态
    ipcMain.handle('matting:status', async () => {
        return mattingService.getModelsStatus();
    });
}
```

### 5.3 模块化注册

```typescript
// src/main/ipc-handlers/index.ts
import { setupMattingHandlers } from './matting-handlers';
import { setupConfigHandlers } from './config-handlers';

export function setupIPCHandlers(context: IPCContext) {
    setupMattingHandlers(context.mattingService);
    setupConfigHandlers(context);
    
    console.log('[IPC] Handlers registered');
}
```

---

## 6. WebSocket 服务

### 6.1 服务器实现

```typescript
// src/main/websocket/server.ts
import { WebSocketServer as WSServer, WebSocket } from 'ws';

export class WebSocketServer {
    private wss: WSServer | null = null;
    private pluginSocket: WebSocket | null = null;
    
    constructor(private port: number) {}
    
    start(): void {
        this.wss = new WSServer({ 
            port: this.port,
            maxPayload: 500 * 1024 * 1024  // 500MB
        });
        
        this.wss.on('connection', (socket) => {
            console.log('[WebSocket] 客户端已连接');
            this.pluginSocket = socket;
            
            socket.on('message', (data) => {
                this.handleMessage(data);
            });
            
            socket.on('close', () => {
                console.log('[WebSocket] 客户端已断开');
                this.pluginSocket = null;
            });
        });
        
        console.log(`[WebSocket] 服务器已启动: ws://localhost:${this.port}`);
    }
    
    private handleMessage(data: Buffer): void {
        // 区分二进制和文本消息
        if (this.isBinaryMessage(data)) {
            this.handleBinaryMessage(data);
        } else {
            this.handleTextMessage(data.toString());
        }
    }
    
    // 发送请求到 UXP
    async sendRequest(method: string, params: any): Promise<any> {
        // JSON-RPC 2.0 格式
        const request = {
            jsonrpc: '2.0',
            id: ++this.requestId,
            method: `tool.${method}`,
            params
        };
        
        this.pluginSocket?.send(JSON.stringify(request));
        
        // 等待响应...
    }
}
```

### 6.2 JSON-RPC 2.0 协议

```typescript
// 请求格式
interface JsonRpcRequest {
    jsonrpc: '2.0';
    id: string | number;
    method: string;
    params?: any;
}

// 响应格式
interface JsonRpcResponse {
    jsonrpc: '2.0';
    id: string | number;
    result?: any;
    error?: {
        code: number;
        message: string;
    };
}
```

---

## 7. 服务层设计

### 7.1 服务类模式

```typescript
// src/main/services/matting-service.ts
export class MattingService {
    private ort: typeof import('onnxruntime-node') | null = null;
    private birefnetSession: any = null;
    
    constructor(private modelsDir: string) {}
    
    // 延迟初始化
    async initialize(): Promise<boolean> {
        this.ort = await import('onnxruntime-node');
        
        const modelPath = path.join(this.modelsDir, 'birefnet/birefnet.onnx');
        this.birefnetSession = await this.ort.InferenceSession.create(modelPath);
        
        return true;
    }
    
    // 核心方法
    async removeBackground(imageData: Buffer): Promise<Buffer> {
        // 1. 预处理
        const tensor = this.preprocessImage(imageData);
        
        // 2. 推理
        const result = await this.birefnetSession.run({ input: tensor });
        
        // 3. 后处理
        return this.postprocessMask(result);
    }
    
    // 获取状态
    getModelsStatus(): { available: boolean; models: string[] } {
        return {
            available: this.birefnetSession !== null,
            models: ['birefnet']
        };
    }
}
```

### 7.2 单例模式

```typescript
// src/main/services/morphing/index.ts
let morphingService: MorphingService | null = null;

export function getMorphingService(): MorphingService {
    if (!morphingService) {
        morphingService = new MorphingService();
    }
    return morphingService;
}
```

---

## 8. 打包与发布

### 8.1 electron-builder 配置

```json
// package.json
{
    "build": {
        "appId": "com.designecho.agent",
        "productName": "DesignEcho",
        "directories": {
            "output": "release"
        },
        "files": [
            "dist/**/*",
            "models/**/*",
            "node_modules/**/*"
        ],
        "win": {
            "target": ["nsis"],
            "icon": "resources/icon.ico"
        },
        "mac": {
            "target": ["dmg"],
            "icon": "resources/icon.icns"
        }
    }
}
```

### 8.2 打包命令

```bash
# 开发模式
npm run dev

# 构建
npm run build

# 打包
npm run package
```

### 8.3 模型文件处理

```javascript
// 将大型模型文件放在 extraResources
{
    "build": {
        "extraResources": [
            {
                "from": "models",
                "to": "models"
            }
        ]
    }
}
```

---

## 9. 最新实践

### 9.1 安全最佳实践

```typescript
// 1. 始终启用上下文隔离
webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true  // Electron 28+ 推荐
}

// 2. 限制 IPC 暴露的 API
contextBridge.exposeInMainWorld('api', {
    // 只暴露必要的方法，不暴露整个模块
    getStatus: () => ipcRenderer.invoke('status'),
    // 避免暴露 ipcRenderer.send/on
});

// 3. 验证 IPC 消息来源
ipcMain.handle('sensitive-action', async (event, data) => {
    // 验证发送者
    if (!event.senderFrame.url.startsWith('file://')) {
        throw new Error('Unauthorized');
    }
    return await performAction(data);
});
```

### 9.2 性能优化技巧

```typescript
// 1. 使用 Worker Threads 处理 CPU 密集任务
import { Worker, isMainThread, parentPort } from 'worker_threads';

if (isMainThread) {
    const worker = new Worker('./inference-worker.js');
    worker.postMessage({ imageData });
    worker.on('message', (result) => {
        console.log('推理完成:', result);
    });
} else {
    parentPort?.on('message', async (data) => {
        const result = await runONNXInference(data.imageData);
        parentPort?.postMessage(result);
    });
}

// 2. 批量 IPC 调用合并
const pendingCalls: Map<string, Deferred> = new Map();
let batchTimer: NodeJS.Timeout | null = null;

function batchedInvoke(channel: string, data: unknown): Promise<unknown> {
    const id = generateId();
    const deferred = createDeferred();
    pendingCalls.set(id, { channel, data, deferred });
    
    if (!batchTimer) {
        batchTimer = setTimeout(() => {
            flushBatch();
            batchTimer = null;
        }, 16); // ~60fps
    }
    
    return deferred.promise;
}

// 3. 大文件分块传输
async function sendLargeFile(filePath: string, chunkSize = 1024 * 1024) {
    const file = await fs.open(filePath, 'r');
    const stats = await file.stat();
    
    let offset = 0;
    while (offset < stats.size) {
        const buffer = Buffer.alloc(Math.min(chunkSize, stats.size - offset));
        await file.read(buffer, 0, buffer.length, offset);
        await sendChunk(buffer, offset, stats.size);
        offset += buffer.length;
    }
    
    await file.close();
}
```

### 9.3 内存管理

```typescript
// 1. ONNX Session 生命周期管理
class ModelManager {
    private sessions: Map<string, ort.InferenceSession> = new Map();
    private lastUsed: Map<string, number> = new Map();
    private readonly TTL = 5 * 60 * 1000; // 5 分钟未使用则释放
    
    async getSession(modelName: string): Promise<ort.InferenceSession> {
        this.lastUsed.set(modelName, Date.now());
        
        if (!this.sessions.has(modelName)) {
            const session = await ort.InferenceSession.create(
                `models/${modelName}.onnx`
            );
            this.sessions.set(modelName, session);
        }
        
        return this.sessions.get(modelName)!;
    }
    
    // 定期清理
    startGarbageCollection() {
        setInterval(() => {
            const now = Date.now();
            for (const [name, lastUsed] of this.lastUsed.entries()) {
                if (now - lastUsed > this.TTL) {
                    const session = this.sessions.get(name);
                    session?.release();
                    this.sessions.delete(name);
                    this.lastUsed.delete(name);
                    console.log(`[GC] Released model: ${name}`);
                }
            }
        }, 60 * 1000);
    }
}

// 2. Sharp 内存限制
import sharp from 'sharp';

sharp.cache({ memory: 256, files: 20 });  // 限制缓存
sharp.concurrency(2);  // 限制并发
```

### 9.4 错误恢复

```typescript
// 1. 优雅降级
async function inferenceWithFallback(imageData: Buffer): Promise<Buffer> {
    try {
        // 首选：GPU 推理
        return await runGPUInference(imageData);
    } catch (gpuError) {
        console.warn('[Fallback] GPU failed, trying CPU:', gpuError.message);
        try {
            // 回退：CPU 推理
            return await runCPUInference(imageData);
        } catch (cpuError) {
            console.error('[Error] All inference methods failed');
            throw cpuError;
        }
    }
}

// 2. 自动重启 WebSocket 服务
class ResilientWSServer {
    private server: WebSocketServer | null = null;
    private restartAttempts = 0;
    private readonly maxRestarts = 5;
    
    async start(port: number): Promise<void> {
        try {
            this.server = new WebSocketServer({ port });
            this.restartAttempts = 0;
            
            this.server.on('error', (error) => {
                console.error('[WS] Server error:', error);
                this.attemptRestart(port);
            });
            
        } catch (error) {
            this.attemptRestart(port);
        }
    }
    
    private async attemptRestart(port: number): Promise<void> {
        if (this.restartAttempts >= this.maxRestarts) {
            console.error('[WS] Max restarts reached');
            return;
        }
        
        this.restartAttempts++;
        const delay = Math.pow(2, this.restartAttempts) * 1000;
        
        console.log(`[WS] Restarting in ${delay}ms (attempt ${this.restartAttempts})`);
        await new Promise(r => setTimeout(r, delay));
        
        await this.start(port);
    }
}
```

### 9.5 日志与监控

```typescript
// 1. 结构化日志
import { createLogger, transports, format } from 'winston';

const logger = createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: format.combine(
        format.timestamp(),
        format.json()
    ),
    transports: [
        new transports.File({ filename: 'error.log', level: 'error' }),
        new transports.File({ filename: 'combined.log' }),
        new transports.Console({
            format: format.combine(
                format.colorize(),
                format.simple()
            )
        })
    ]
});

// 2. 性能指标收集
class PerformanceMonitor {
    private metrics: Map<string, number[]> = new Map();
    
    recordLatency(operation: string, durationMs: number): void {
        const existing = this.metrics.get(operation) || [];
        existing.push(durationMs);
        
        // 保留最近 100 条
        if (existing.length > 100) existing.shift();
        
        this.metrics.set(operation, existing);
    }
    
    getStats(operation: string): { avg: number; p95: number; p99: number } {
        const data = this.metrics.get(operation) || [];
        if (data.length === 0) return { avg: 0, p95: 0, p99: 0 };
        
        const sorted = [...data].sort((a, b) => a - b);
        return {
            avg: data.reduce((a, b) => a + b, 0) / data.length,
            p95: sorted[Math.floor(sorted.length * 0.95)],
            p99: sorted[Math.floor(sorted.length * 0.99)]
        };
    }
}
```

---

## 附录

### A. 常见问题

| 问题 | 解决方案 |
|------|----------|
| 端口被占用 | 检测并终止占用进程 |
| ONNX 加载慢 | 使用延迟加载 |
| 内存泄漏 | 正确释放模型会话 |
| WebSocket 断连 | 实现自动重连机制 |
| 打包后模型找不到 | 使用 extraResources 配置 |

### B. 性能优化

1. **模型延迟加载**: 首次使用时才加载模型
2. **Worker Threads**: 将推理放入工作线程
3. **二进制传输**: 避免 Base64 编码图像
4. **批量 IPC**: 合并高频调用
5. **内存限制**: 配置 Sharp 和 ONNX 缓存上限

### C. 安全检查清单

- [ ] 启用 contextIsolation
- [ ] 禁用 nodeIntegration
- [ ] 使用 sandbox 模式
- [ ] 验证 IPC 消息来源
- [ ] 限制 WebView 域名白名单
- [ ] 定期更新依赖

### D. 参考资源

- [Electron 官方文档](https://www.electronjs.org/docs)
- [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)
- [ONNX Runtime Node](https://onnxruntime.ai/docs/api/js/index.html)
- [Sharp 文档](https://sharp.pixelplumbing.com/)
- [Winston 日志库](https://github.com/winstonjs/winston)

---

> **文档维护**: 请在架构变更后同步更新此文档
