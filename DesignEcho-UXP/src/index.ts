/**
 * DesignEcho UXP Plugin - 主入口 (WebView 版本)
 * 
 * 功能：
 * 1. 使用 webview 加载远程美观 UI
 * 2. 作为 WebSocket Client 连接到 Agent
 * 3. 暴露 Photoshop 操作工具
 * 4. 作为 WebView 和 Photoshop 之间的桥梁
 */

import { WebSocketClient } from './core/websocket-client';
import { MessageHandler } from './core/message-handler';
import { ToolRegistry } from './tools/registry';
import { disableLogging } from './core/logger';
import { BinaryMessageType, BinaryHeader } from './core/binary-protocol';

// UXP entrypoints 模块
const { entrypoints } = require('uxp');

// 全局状态
let wsClient: WebSocketClient | null = null;
let messageHandler: MessageHandler | null = null;
let toolRegistry: ToolRegistry | null = null;
let panelContainer: HTMLElement | null = null;
let isConnecting: boolean = false;
let isWebViewInitialized: boolean = false;  // 防止重复初始化

// WebView 服务器地址
const WEBVIEW_URL = 'http://127.0.0.1:8766';
const AGENT_WS_URL = 'ws://localhost:8765';

// 操作类型配置（模块级常量，避免每次调用重新创建）
const OPERATION_CONFIG: Record<string, { icon: string; name: string }> = {
    'remove-background': { icon: '✂️', name: '智能抠图' },
    'remove-background-multi': { icon: '🎯', name: '多目标抠图' },
    'one-click-beautify': { icon: '✨', name: '一键美化' },
    'optimize-text': { icon: '📝', name: '文案优化' },
    'analyze-layout': { icon: '📐', name: '排版分析' },
    'shape-morph': { icon: '◇', name: '形态统一' },
    'inpaint': { icon: '✎', name: '局部重绘' },
    'morphing': { icon: '◇', name: '形态变形' },
    'harmonize': { icon: '⊕', name: '协调融合' }
};

const DEFAULT_OPERATION = { icon: '⏳', name: '处理中' };

// 英文术语翻译映射
const ENGLISH_TO_CHINESE: Array<[RegExp, string]> = [
    [/extracting image/gi, '提取图像'],
    [/processing/gi, '处理中'],
    [/analyzing/gi, '分析中'],
    [/detecting/gi, '检测中'],
    [/segmenting/gi, '分割中'],
    [/initializing/gi, '初始化中'],
    [/loading model/gi, '加载模型'],
    [/mask/gi, '蒙版'],
    [/edge/gi, '边缘'],
    [/refining/gi, '优化中']
];

/**
 * 将技术性进度消息转换为用户友好的中文提示
 * @param operation - 操作类型标识
 * @param progress - 进度百分比 (0-100)
 * @param message - Agent 发送的原始消息（可选）
 * @returns message: 主标题, hint: 详细信息, loadingText: 加载文本
 */
function getFriendlyProgressMessage(operation: string, progress: number, message?: string): {
    message: string;
    hint: string;
    loadingText: string;
} {
    const opConfig = OPERATION_CONFIG[operation] || DEFAULT_OPERATION;
    let hintText = message || '正在处理...';
    
    // 检测纯英文消息并翻译
    const isEnglishOnly = message && !/[\u4e00-\u9fa5]/.test(message);
    if (isEnglishOnly) {
        for (const [pattern, replacement] of ENGLISH_TO_CHINESE) {
            hintText = hintText.replace(pattern, replacement);
        }
    }
    
    return {
        message: `${opConfig.icon} ${opConfig.name} ${progress}%`,
        hint: hintText,
        loadingText: hintText
    };
}

/**
 * 强制刷新 Photoshop 画布显示
 * 
 * 解决抠图/蒙版应用后画布不更新的问题
 * 使用简化的安全方法确保画布重绘
 */
async function forceRefreshCanvas(): Promise<void> {
    const { app, core, action } = require('photoshop');
    const doc = app.activeDocument;
    if (!doc) return;

    try {
        await core.executeAsModal(async () => {
            console.log('[DesignEcho] 开始刷新画布...');

            // 方法: 切换当前图层可见性（最安全有效的刷新方法）
            if (doc.activeLayers.length > 0) {
                const layer = doc.activeLayers[0];
                const layerId = layer.id;
                
                try {
                    // 隐藏再显示，强制重绘
                    await action.batchPlay([
                        {
                            _obj: 'hide',
                            null: [{ _ref: 'layer', _id: layerId }],
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], { synchronousExecution: true });
                    
                    await action.batchPlay([
                        {
                            _obj: 'show',
                            null: [{ _ref: 'layer', _id: layerId }],
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], { synchronousExecution: true });
                    
                    console.log('[DesignEcho] 画布刷新成功');
                } catch (e) {
                    console.log('[DesignEcho] 画布刷新失败:', e);
                }
            }
        }, { commandName: 'DesignEcho: 刷新画布' });
    } catch (error) {
        console.warn('[DesignEcho] 画布刷新出错:', error);
        // 不抛出错误
    }
}

/**
 * 初始化插件入口点
 */
entrypoints.setup({
    panels: {
        mainPanel: {
            show: async (node: HTMLElement) => {
                console.log('[DesignEcho] Panel show called');
                panelContainer = node;
                renderPanel(node);
                await initializeConnection();
            },
            hide: () => {
                console.log('[DesignEcho] Panel hidden');
            },
            destroy: () => {
                console.log('[DesignEcho] Panel destroyed');
                cleanup();
            }
        }
    }
});

// WebView 元素引用
let webviewElement: any = null;

// 消息处理函数（命名函数，便于移除）
let lastWebViewMessageSignature = '';
let lastWebViewMessageAt = 0;

function shouldDropDuplicateWebViewMessage(data: any): boolean {
    const signature = `${data?.type || ''}|${data?.action || ''}|${JSON.stringify(data?.payload || {})}`;
    const now = Date.now();
    if (signature === lastWebViewMessageSignature && (now - lastWebViewMessageAt) < 300) {
        return true;
    }
    lastWebViewMessageSignature = signature;
    lastWebViewMessageAt = now;
    return false;
}

function webviewMessageHandler(e: MessageEvent) {
    console.log('[DesignEcho] Message from WebView:', e.data);
    if (e.data && e.data.type === 'uxp-action') {
        if (shouldDropDuplicateWebViewMessage(e.data)) {
            return;
        }
        handleWebViewAction(e.data);
    }
}

/**
 * 渲染面板 UI (使用真正的 WebView 元素)
 */
async function renderPanel(container: HTMLElement) {
    console.log('[DesignEcho] Rendering panel with WebView...');
    
    // 如果已经初始化过，先移除旧的消息监听器
    if (isWebViewInitialized) {
        console.log('[DesignEcho] WebView already initialized, removing old listener');
        if (webviewElement) {
            webviewElement.removeEventListener('message', webviewMessageHandler as any);
        }
        window.removeEventListener('message', webviewMessageHandler);
    }
    
    // 设置容器样式 - 使用简单的全屏布局
    container.style.cssText = 'width: 100%; height: 100%; overflow: auto; background: #0a0a0f;';
    
    // 使用固定尺寸（与 manifest.json 中的面板尺寸一致）
    const webviewWidth = 280;
    const webviewHeight = 620;
    
    console.log(`[DesignEcho] Fixed WebView size: ${webviewWidth}x${webviewHeight}`);
    
    // 创建 webview 元素 - 按照 Adobe 官方文档格式
    container.innerHTML = `
        <webview 
            id="designecho-webview" 
            src="${WEBVIEW_URL}"
            width="${Math.round(webviewWidth)}"
            height="${Math.round(webviewHeight)}"
            uxpAllowInspector="true"
        ></webview>
    `;
    
    // 获取 webview 元素
    webviewElement = container.querySelector('#designecho-webview');
    
    if (!webviewElement) {
        console.error('[DesignEcho] WebView element not found');
        return;
    }
    
    // 简单设置 - 不使用 position absolute，避免渲染问题
    (webviewElement as HTMLElement).style.border = 'none';
    
    console.log('[DesignEcho] WebView element created, src:', WEBVIEW_URL);
    
    // 监听 WebView 加载事件
    webviewElement.addEventListener('loadstart', (e: any) => {
        console.log('[DesignEcho] WebView loadstart:', e.url);
    });
    
    webviewElement.addEventListener('loadstop', (e: any) => {
        console.log('[DesignEcho] WebView loadstop:', e.url);
        // 不在这里发送状态，等待 WebView 内部的 JavaScript 发送 webviewReady 消息
    });
    
    webviewElement.addEventListener('loaderror', (e: any) => {
        console.error('[DesignEcho] WebView loaderror:', e.url, e.code, e.message);
        const codeText = typeof e?.code !== 'undefined' ? String(e.code) : 'unknown';
        const messageText = e?.message ? String(e.message) : 'unknown';
        container.innerHTML = `
            <div style="padding: 16px; color: #e8e8ef; font-family: system-ui; background: #0a0a0f; height: 100%; box-sizing: border-box;">
                <div style="font-size: 14px; font-weight: 600; margin-bottom: 8px;">DesignEcho UI 加载失败</div>
                <div style="font-size: 12px; opacity: 0.85; line-height: 1.5; margin-bottom: 12px;">
                    无法访问 <span style="opacity: 0.95;">${WEBVIEW_URL}</span><br />
                    错误码：${codeText}<br />
                    详情：${messageText}
                </div>
                <div style="font-size: 12px; opacity: 0.85; line-height: 1.5; margin-bottom: 12px;">
                    请确认 DesignEcho Agent 已启动，并且端口 8766 未被占用。然后点击“重试”。 
                </div>
                <button id="designecho-retry" style="padding: 8px 12px; border-radius: 8px; border: 1px solid #2c2c3a; background: #141423; color: #e8e8ef; cursor: pointer;">重试</button>
            </div>
        `;
        const retryBtn = container.querySelector('#designecho-retry') as HTMLButtonElement | null;
        if (retryBtn) {
            retryBtn.addEventListener('click', () => {
                isWebViewInitialized = false;
                webviewElement = null;
                renderPanel(container);
            });
        }
    });
    
    // 监听来自 WebView 的消息
    // 注意：UXP WebView 的消息需要在 webviewElement 上监听，不是 window
    webviewElement.addEventListener('message', webviewMessageHandler as any);
    // 某些 UXP 版本下消息会通过 window 派发，保留兜底监听
    window.addEventListener('message', webviewMessageHandler);
    
    isWebViewInitialized = true;
    console.log('[DesignEcho] WebView panel setup complete');
}

/**
 * 处理来自 WebView 的动作消息
 */
async function handleWebViewAction(data: any) {
    const { action, payload } = data;
    console.log('[DesignEcho] WebView action:', action, payload);
    
    switch (action) {
        case 'webviewReady':
            // WebView 已就绪，发送完整的连接状态
            const isConnected = wsClient?.isConnected() || false;
            console.log('[DesignEcho] WebView ready, connection status:', isConnected);
            
            // 发送连接状态（同时使用两种格式确保兼容）
            sendToWebView('connectionStatus', { 
                connected: isConnected,
                status: isConnected ? 'connected' : 'disconnected'
            });
            
            // 如果已连接，启用操作按钮
            if (isConnected) {
                sendToWebView('enableActions', { enabled: true });
            }
            break;
            
        case 'connect':
            await initializeConnection();
            break;
            
        case 'oneClickBeautify':
            await handleOneClickBeautify();
            break;
            
        case 'shapeMorph':
            await handleOpenMorphingPanel();
            break;

        case 'optimizeText':
            await handleOptimizeText();
            break;

        case 'optimizeTextRefreshSelection':
            await loadOptimizeSelectedTextForWebView();
            break;

        case 'optimizeTextGenerate':
            await handleGenerateOptimizeText(payload);
            break;

        case 'optimizeTextApply':
            await handleApplyOptimizeText(payload);
            break;

        case 'optimizeTextBack':
            switchToPage('pageMain');
            break;
            
        case 'inpainting':
            await handleOpenInpaintingPanel();
            break;

        case 'inpaintingGenerate':
            await handleInpaintingGenerate(payload);
            break;

        case 'navigate':
            // 允许 WebView 主动请求跳转（虽然通常是 UXP -> Agent，但也支持反向确认）
            sendToWebView('navigate', payload);
            break;
            
        case 'applyInpaintingResult':
            // 应用局部重绘结果到 PS 画布
            await handleApplyInpaintingResult(payload);
            break;
            
        case 'harmonize':
            await handleHarmonize();
            break;
            
        case 'autoDesign':
            // 自动设计：转发给 Agent 的 design-agent.autoDesign handler
            if (wsClient && wsClient.isConnected()) {
                try {
                    sendToWebView('showLoading', { text: '自动设计中...' });
                    const result = await wsClient.sendRequest('design-agent.autoDesign', {
                        projectPath: payload?.projectPath || '',
                        templatePath: payload?.templatePath || '',
                        designType: payload?.designType || 'detail',
                        outputDir: payload?.outputDir || '',
                        brandTone: payload?.brandTone || 'professional'
                    }, 300000); // 5 分钟超时
                    sendToWebView('hideLoading', {});
                    if (result?.success) {
                        const summary = result.summary || {};
                        sendToWebView('toast', { 
                            message: `设计完成：${summary.screens || 0} 屏，${summary.screensSuccess || 0} 成功，评分 ${summary.evaluationScore ?? 'N/A'}`, 
                            type: 'success' 
                        });
                    } else {
                        sendToWebView('toast', { message: result?.error || '设计失败', type: 'error' });
                    }
                } catch (e: any) {
                    sendToWebView('hideLoading', {});
                    sendToWebView('toast', { message: e.message || '设计请求失败', type: 'error' });
                }
            } else {
                sendToWebView('toast', { message: '请先连接到 Agent', type: 'warning' });
            }
            break;
            
        case 'removeBackground':
            await handleRemoveBackground(payload?.target || '');
            break;
            
        case 'morphBack':
            sendToWebView('switchPage', { page: 'pageMain' });
            break;
            
        case 'morphRefresh':
            await loadMorphLayersForWebView();
            break;
            
        case 'morphSelectAll':
            sendToWebView('morphSelectAll', {});
            break;
            
        case 'morphDeselectAll':
            sendToWebView('morphDeselectAll', {});
            break;
            
        case 'morphExecute':
            await executeMorphingFromWebView(payload);
            break;
            
        case 'morphRefShapeSelect':
            morphSelectedRefShape = payload?.value ? parseInt(payload.value) : null;
            break;
            
        case 'morphLayerToggle':
            // 处理图层选择切换
            if (payload?.layerId) {
                const layerId = parseInt(payload.layerId);
                const idx = morphSelectedLayers.indexOf(layerId);
                if (idx >= 0) {
                    morphSelectedLayers.splice(idx, 1);
                } else {
                    morphSelectedLayers.push(layerId);
                }
            }
            break;
            
        // ===== 智能抠图页面相关 =====
        case 'executeMatting':
            await handleExecuteMatting(payload);
            break;
            
        case 'executeMattingBySelection':
            await handleExecuteMattingBySelection(payload);
            break;
            
        case 'selectLassoTool':
            // 切换到套索工具，方便用户绘制选区
            await selectLassoTool();
            break;
            
        default:
            console.log('[DesignEcho] Unknown WebView action:', action);
    }
}

/**
 * 发送消息到 WebView
 * 支持两种模式：
 * 1. UXP 内嵌 WebView：使用 webviewElement.postMessage
 * 2. Agent 桌面端：通过 WebSocket 发送到 Agent，由 Agent 转发给其 WebView
 */
function sendToWebView(msgType: string, data: any) {
    // 构建消息
    const message = { 
        ...data,             // 数据内容
        type: msgType        // 消息类型：toast, statusInfo, morphProgress, etc.
    };
    // 如果数据中有 type 字段，保留为 level 以避免冲突
    if (data.type) {
        message.level = data.type;
    }
    
    console.log('[DesignEcho] Sending to WebView:', message);
    
    // 方式1: UXP 内嵌 WebView
    if (webviewElement && webviewElement.postMessage) {
        webviewElement.postMessage(message, '*');
    }
    
    // 方式2: 通过 WebSocket 发送到 Agent 桌面端（同时发送，让 Agent 转发给其 WebView）
    if (wsClient?.isConnected()) {
        try {
            // 使用 sendNotification 发送给 Agent，不需要等待响应
            wsClient.sendNotification('webview.message', message);
        } catch (e) {
            // 忽略错误，不阻塞主流程
        }
    }
}

function notifyConnectingToAgent(): void {
    sendToWebView('connectionStatus', { status: 'connecting' });
    sendToWebView('statusInfo', { message: '正在连接...', hint: '' });
}

function notifyAgentConnected(): void {
    sendToWebView('connectionStatus', { status: 'connected' });
    sendToWebView('enableActions', { enabled: true });
    sendToWebView('showMattingInput', {});
    sendToWebView('statusInfo', { message: '已连接到 Agent', hint: '' });
}

function notifyAgentDisconnected(hint: string, shouldHideMattingInput: boolean): void {
    sendToWebView('connectionStatus', { status: 'disconnected' });
    sendToWebView('enableActions', { enabled: false });
    if (shouldHideMattingInput) {
        sendToWebView('hideMattingInput', {});
    }
    sendToWebView('statusInfo', { message: '连接已断开', hint });
}

function notifyAgentConnectionFailed(hint: string): void {
    sendToWebView('connectionStatus', { status: 'disconnected' });
    sendToWebView('enableActions', { enabled: false });
    sendToWebView('statusInfo', { message: '连接失败', hint });
}

/**
 * 更新连接状态到 WebView
 */
function updateConnectionStatus() {
    const isConnected = wsClient?.isConnected() || false;
    sendToWebView('connectionStatus', { connected: isConnected });
}


/**
 * 加载形态统一图层并发送到 WebView
 */
async function loadMorphLayersForWebView() {
    if (!toolRegistry) {
        sendToWebView('morphLayers', { error: '工具未初始化' });
        return;
    }
    
    const tool = toolRegistry.getTool('getLayerHierarchy');
    if (!tool) {
        sendToWebView('morphLayers', { error: '图层工具未找到' });
        return;
    }
    
    try {
        // 使用 flatList 获取扁平图层列表
        const result = await tool.execute({ includeHidden: false, flatList: true });
        
        if (!result?.success) {
            sendToWebView('morphLayers', { error: result?.error || '无法获取图层' });
            return;
        }
        
        // getLayerHierarchy 返回 flatList（使用 flatList: true 时）或 hierarchy
        const allLayers = result.flatList || [];
        
        // 调试：打印所有图层的类型
        console.log('[DesignEcho] 所有图层:', allLayers.map((l: any) => ({ name: l.name, kind: l.kind })));
        
        // 分类图层 - 形状图层包括多种类型
        // vector, shape, solidColor, gradient, pattern 都可以作为形状参考
        const shapeLayers = allLayers.filter((l: any) => 
            l.kind === 'vector' || 
            l.kind === 'shape' || 
            l.kind === 'solidColor' ||
            l.kind === 'gradient' ||
            l.kind === 'pattern' ||
            // 也支持检测名称中包含 "形状" 或 "shape" 的图层
            (l.name && (l.name.includes('形状') || l.name.toLowerCase().includes('shape')))
        );
        // 产品图层包括像素层、智能对象，排除背景和组
        const productLayers = allLayers.filter((l: any) => 
            l.kind === 'pixel' || l.kind === 'smartObject'
        );
        
        // 调试：显示所有图层的类型
        console.log('[DesignEcho] 所有图层类型:', allLayers.map((l: any) => ({ name: l.name, kind: l.kind })));
        console.log('[DesignEcho] 形状图层:', shapeLayers.map((l: any) => l.name));
        console.log('[DesignEcho] 产品图层:', productLayers.map((l: any) => l.name));
        
        // 保存到本地状态
        morphShapeLayers = shapeLayers;
        morphProductLayers = productLayers;
        morphSelectedLayers = [];
        morphSelectedRefShape = null;
        
        // 发送到 WebView
        sendToWebView('morphLayers', {
            shapeLayers: shapeLayers.map((l: any) => ({ id: l.id, name: l.name })),
            productLayers: productLayers.map((l: any) => ({
                id: l.id,
                name: l.name,
                kind: l.kind,
                type: l.kind === 'smartObject' ? 'SO' : 'PX'
            }))
        });
        
    } catch (error: any) {
        console.error('[DesignEcho] 加载图层失败:', error);
        sendToWebView('morphLayers', { error: error.message });
    }
}

/**
 * 执行智能抠图（使用 Photoshop 中当前选中的图层）
 * @param payload.target - 抠取目标提示词
 * @param payload.sampleAllLayers - 是否对所有图层取样（获取复合图像）
 * @param payload.outputFormat - 输出格式：'selection'（选区）或 'mask'（蒙版）
 */
async function handleExecuteMatting(payload: any) {
    const { target, sampleAllLayers, outputFormat } = payload;
    
    console.log('[DesignEcho] ✂ 智能分割开始:', { target, sampleAllLayers, outputFormat });
    
    // 获取当前选中的图层
    const app = require('photoshop').app;
    const doc = app.activeDocument;
    
    if (!doc) {
        sendToWebView('mattingResult', { success: false, error: '没有打开的文档' });
        sendToWebView('toast', { message: '请先打开一个文档', type: 'warning' });
        return;
    }
    
    const activeLayers = doc.activeLayers;
    if (!activeLayers || activeLayers.length === 0) {
        sendToWebView('mattingResult', { success: false, error: '未选择图层' });
        sendToWebView('toast', { message: '请先在 Photoshop 中选择要抠图的图层', type: 'warning' });
        return;
    }
    
    if (!wsClient?.isConnected()) {
        sendToWebView('mattingResult', { success: false, error: '未连接到 Agent' });
        sendToWebView('toast', { message: '请先连接到 Agent', type: 'error' });
        return;
    }
    
    // 获取选中图层的 ID
    const layerIds = activeLayers.map((l: any) => l.id);
    const layerNames = activeLayers.map((l: any) => l.name);
    
    console.log('[DesignEcho] 选中的图层:', layerNames.join(', '));
    
    let successCount = 0;
    const totalLayers = layerIds.length;
    
    try {
        for (let i = 0; i < layerIds.length; i++) {
            const layerId = layerIds[i];
            
            // 更新进度
            const progress = Math.round(((i + 1) / totalLayers) * 100);
            sendToWebView('statusInfo', { 
                message: `正在抠图 ${i + 1}/${totalLayers}...`, 
                hint: `图层: ${layerNames[i]}`,
                status: 'info' 
            });
            
            try {
                // 调用单图层抠图逻辑（固定使用 Python 后端）
                await handleRemoveBackgroundForLayer(layerId, target, sampleAllLayers, outputFormat);
                successCount++;
            } catch (error: any) {
                console.error(`[DesignEcho] 图层 ${layerNames[i]} 抠图失败:`, error);
            }
        }
        
        // 发送结果
        sendToWebView('mattingResult', { 
            success: successCount > 0, 
            successCount, 
            totalLayers 
        });
        
        // 显示结果提示
        const outputName = outputFormat === 'selection' ? '选区' : '蒙版';
        if (successCount === totalLayers) {
            sendToWebView('toast', { message: `成功创建${outputName}`, type: 'success' });
        } else if (successCount > 0) {
            sendToWebView('toast', { message: `抠图完成：${successCount}/${totalLayers} 个成功`, type: 'warning' });
        } else {
            sendToWebView('toast', { message: '抠图失败', type: 'error' });
        }
        
        // 恢复状态
        
    } catch (error: any) {
        console.error('[DesignEcho] 抠图失败:', error);
        sendToWebView('mattingResult', { success: false, error: error.message });
        sendToWebView('toast', { message: error.message, type: 'error' });
    }
}

/**
 * 对指定图层执行智能分割（使用本地 BiRefNet ONNX）
 * @param layerId - 目标图层 ID
 * @param target - 抠取目标提示词（可选）
 * @param sampleAllLayers - 是否对所有图层取样
 * @param outputFormat - 输出格式：'selection' 或 'mask'
 */
async function handleRemoveBackgroundForLayer(
    layerId: number, 
    target: string, 
    sampleAllLayers: boolean = false,
    outputFormat: 'selection' | 'mask' = 'mask'
) {
    console.log(`[DesignEcho] ✂ 智能分割图层 ${layerId}, 取样全部=${sampleAllLayers}, 输出=${outputFormat}`);
    
    // 获取 Photoshop API
    const app = require('photoshop').app;
    const action = require('photoshop').action;
    const core = require('photoshop').core;
    const doc = app.activeDocument;
    
    if (!doc) {
        throw new Error('没有打开的文档');
    }
    
    // 选中该图层 - 必须在 executeAsModal 中执行
    await core.executeAsModal(async () => {
        await action.batchPlay([{
            _obj: 'select',
            _target: [{ _ref: 'layer', _id: layerId }],
            makeVisible: true,
            _options: { dialogOptions: 'dontDisplay' }
        }], { synchronousExecution: true });
    }, { commandName: '选择图层' });
    
    // 使用智能分割 API（本地 BiRefNet ONNX）
    const MATTING_TIMEOUT = 3 * 60 * 1000;
    
    const result = await wsClient!.sendRequest('remove-background', {
        mode: 'ai',
        useMask: true,
        outputFormat: outputFormat,  // 'selection' 或 'mask'
        quality: 'balanced',
        targetPrompt: target || '',
        sampleAllLayers: sampleAllLayers  // 是否对所有图层取样
    }, MATTING_TIMEOUT);
    
    if (!result?.success) {
        throw new Error(result?.error || '抠图失败');
    }
    
    console.log(`[DesignEcho] 图层 ${layerId} 分割成功，输出为${outputFormat === 'selection' ? '选区' : '蒙版'}`);
}

/**
 * 选区模式分割
 * 
 * 使用用户绘制的选区边界框进行分割（BiRefNet ONNX）
 * 
 * @param payload.outputFormat - 输出格式：'selection'（选区）或 'mask'（蒙版）
 */
async function handleExecuteMattingBySelection(payload: any) {
    const { outputFormat } = payload;

    console.log('[DesignEcho] 📐 选区分割开始');
    console.log('[DesignEcho] 输出格式:', outputFormat);
    
    try {
        // 检查连接
        if (!wsClient || !wsClient.isConnected()) {
            sendToWebView('mattingComplete', { success: false });
            sendToWebView('toast', { message: '请先连接到 Agent', type: 'error' });
            return;
        }
        
        // 1. 获取当前选区边界框
        if (!toolRegistry) {
            sendToWebView('mattingComplete', { success: false });
            sendToWebView('toast', { message: '工具注册表未初始化', type: 'error' });
            return;
        }
        
        const getSelectionBoundsTool = toolRegistry.getTool('getSelectionBounds');
        if (!getSelectionBoundsTool) {
            sendToWebView('mattingComplete', { success: false });
            sendToWebView('toast', { message: '选区工具未注册', type: 'error' });
            return;
        }
        
        const boundsResult = await getSelectionBoundsTool.execute({});
        console.log('[DesignEcho] 选区边界:', boundsResult);
        
        if (!boundsResult.success || !boundsResult.hasSelection) {
            sendToWebView('mattingComplete', { success: false });
            sendToWebView('toast', { 
                message: boundsResult.error || '请先在 Photoshop 中绘制选区', 
                type: 'warning' 
            });
            return;
        }
        
        const box = boundsResult.box as [number, number, number, number];
        console.log(`[DesignEcho] 选区边界框: [${box.join(', ')}]`);
        
        // 2. 获取当前选中的图层
        const { app } = require('photoshop');
        const doc = app.activeDocument;
        if (!doc) {
            sendToWebView('mattingComplete', { success: false });
            sendToWebView('toast', { message: '没有打开的文档', type: 'error' });
            return;
        }
        
        const selectedLayers = doc.activeLayers;
        if (!selectedLayers || selectedLayers.length === 0) {
            sendToWebView('mattingComplete', { success: false });
            sendToWebView('toast', { message: '请先选择图层', type: 'warning' });
            return;
        }
        
        const layerId = selectedLayers[0].id;
        console.log(`[DesignEcho] 目标图层 ID: ${layerId}`);
        
        // 3. 发送请求到 Agent
        const MATTING_TIMEOUT = 3 * 60 * 1000;
        
        const result = await wsClient.sendRequest('remove-background-by-selection', {
            layerId: layerId,
            box: box,
            outputFormat: outputFormat || 'mask',
            refineEdges: true
        }, MATTING_TIMEOUT);
        
        if (!result?.success) {
            throw new Error(result?.error || '选区分割失败');
        }
        
        // 4. 完成
        sendToWebView('mattingComplete', { success: true });
        sendToWebView('toast', { message: '选区分割完成！', type: 'success' });
        console.log(`[DesignEcho] 📐 选区分割成功`);
        
    } catch (error: any) {
        console.error('[DesignEcho] 选区分割失败:', error.message);
        sendToWebView('mattingComplete', { success: false });
        sendToWebView('toast', { message: error.message || '选区分割失败', type: 'error' });
    }
}

/**
 * 切换到套索工具
 * 
 * 当用户选择"使用选区"模式时自动切换，方便绘制选区
 */
async function selectLassoTool(options?: { notify?: boolean }) {
    console.log('[DesignEcho] 切换到套索工具');
    
    try {
        const { app, action, core } = require('photoshop');
        
        if (!app.activeDocument) {
            console.log('[DesignEcho] 没有打开的文档，跳过工具切换');
            return;
        }
        
        await core.executeAsModal(async () => {
            await action.batchPlay([
                {
                    _obj: 'select',
                    _target: [{ _ref: 'lassoTool' }],
                    _options: { dialogOptions: 'dontDisplay' }
                }
            ], { synchronousExecution: true });
        }, { commandName: 'DesignEcho: 切换套索工具' });
        
        console.log('[DesignEcho] ✓ 已切换到套索工具');
        const notify = options?.notify === true;
        if (notify) {
            sendToWebView('toast', { message: '已切换到套索工具，请绘制选区', type: 'info', duration: 2000 });
        }
        
    } catch (error: any) {
        console.error('[DesignEcho] 切换套索工具失败:', error.message);
        // 不显示错误提示，因为这不是关键功能
    }
}

/**
 * 执行形态统一 - 步骤 1：位置对齐
 * 
 * 唯一入口，无回退，无兜底
 * 只调用 enhanced-shape-morph，只执行位置对齐
 */
async function executeMorphingFromWebView(payload: any) {
    console.log('');
    console.log('╔════════════════════════════════════════════════════╗');
    console.log('║          [形态统一] 开始执行                       ║');
    console.log('╚════════════════════════════════════════════════════╝');
    
    // 立即显示进度反馈
    sendToWebView('morphProgress', { progress: 5, message: '正在初始化...' });
    
    // ===== 1. 检查连接 =====
    console.log('[1] 检查连接状态...');
    if (!wsClient) {
        console.error('  ✗ wsClient 未初始化');
        sendToWebView('hideMorphProgress', {});
        sendToWebView('toast', { message: 'WebSocket 客户端未初始化', type: 'error' });
        return;
    }
    if (!wsClient.isConnected()) {
        console.error('  ✗ 未连接到 Agent');
        sendToWebView('hideMorphProgress', {});
        sendToWebView('toast', { message: '请先连接到 Agent', type: 'error' });
        return;
    }
    console.log('  ✓ 已连接到 Agent');
    sendToWebView('morphProgress', { progress: 10, message: '检查连接...' });
    
    // ===== 2. 解析参数 =====
    console.log('[2] 解析参数...');
    console.log('  payload:', JSON.stringify(payload));
    console.log('  morphSelectedRefShape:', morphSelectedRefShape);
    console.log('  morphSelectedLayers:', morphSelectedLayers);
    
    const refShapeId = parseInt(String(payload?.refShapeId || morphSelectedRefShape), 10);
    const productLayerIds = (payload?.layerIds || morphSelectedLayers)
        .map((id: any) => parseInt(String(id), 10))
        .filter((id: number) => !isNaN(id));
    
    console.log('  解析后 - refShapeId:', refShapeId, 'productLayerIds:', productLayerIds);
    
    // ===== 3. 参数校验 =====
    console.log('[3] 参数校验...');
    sendToWebView('morphProgress', { progress: 15, message: '验证参数...' });
    
    if (!refShapeId || isNaN(refShapeId)) {
        console.error('  ✗ 参考形状 ID 无效:', refShapeId);
        sendToWebView('hideMorphProgress', {});
        sendToWebView('toast', { message: '请选择参考形状', type: 'error' });
        return;
    }
    if (productLayerIds.length === 0) {
        console.error('  ✗ 产品图层列表为空');
        sendToWebView('hideMorphProgress', {});
        sendToWebView('toast', { message: '请选择产品图层', type: 'error' });
        return;
    }
    console.log('  ✓ 参数有效');
    
    // ===== 4. 执行形态统一（唯一路径） =====
    console.log('[4] 发送请求到 Agent...');
    console.log('  方法: enhanced-shape-morph');
    console.log('  参数: { referenceShapeId:', refShapeId, ', productLayerIds:', productLayerIds, ', step: align }');
    
    sendToWebView('morphProgress', { progress: 20, message: '正在对齐主体位置...' });
    
    try {
        const startTime = Date.now();
        
        // 检查是否强制重新检测
        const forceRedetect = payload?.forceRedetect === true;
        // 获取执行步骤（默认 analyze，用于测试轮廓分析）
        const step = payload?.step || 'morph';  // 默认执行完整变形流程
        
        // 获取开关控制
        const preAlign = payload?.preAlign !== false;  // 默认开启
        const shapeMatch = payload?.shapeMatch !== false;  // 默认开启
        
        // 获取变形强度参数
        const edgeStrength = payload?.edgeStrength ?? 70;
        const contentProtection = payload?.contentProtection ?? 80;
        const smoothness = payload?.smoothness ?? 50;
        
        // 获取分区控制
        const selectedRegions = payload?.selectedRegions || [];
        
        // 获取袜子款式信息
        const sockStyle = payload?.sockStyle || 'crew';
        const cuffType = payload?.cuffType || 'plain';
        const cuffProtected = payload?.cuffProtected === true;
        
        console.log('  执行步骤:', step);
        console.log('  强制重新检测:', forceRedetect);
        console.log('  位置对齐:', preAlign, '形态吻合:', shapeMatch);
        console.log('  边缘变形:', edgeStrength, '内容保护:', contentProtection, '变形平滑:', smoothness);
        console.log('  分区控制:', selectedRegions);
        console.log('  款式:', sockStyle, '袜口:', cuffType, '袜口保护:', cuffProtected);
        
        // 超时时间：每个图层约 15 秒，最少 60 秒
        const timeoutMs = Math.max(60000, productLayerIds.length * 15000);
        console.log(`  超时设置: ${timeoutMs / 1000} 秒`);
        
        const result = await wsClient.sendRequest('enhanced-shape-morph', {
            referenceShapeId: refShapeId,
            productLayerIds: productLayerIds,
            step: step,
            forceRedetect: forceRedetect,
            useOptimizedMorphing: true,  // 启用 JFA + 稀疏位移场优化变形
            // 开关控制
            preAlign: preAlign,
            shapeMatch: shapeMatch,
            // 变形强度参数
            edgeStrength: edgeStrength,
            contentProtection: contentProtection,
            smoothness: smoothness,
            // 分区控制
            selectedRegions: selectedRegions,
            // 款式信息
            sockStyle: sockStyle,
            cuffType: cuffType,
            cuffProtected: cuffProtected
        }, timeoutMs);
        
        const duration = Date.now() - startTime;
        console.log('[5] 收到响应 (耗时:', duration, 'ms)');
        console.log('  result:', JSON.stringify(result, null, 2));
        
        sendToWebView('morphProgress', { progress: 100, message: '处理完成' });
        
        // 延迟隐藏进度，让用户看到 100%
        setTimeout(() => {
            sendToWebView('hideMorphProgress', {});
        }, 500);
        
        sendToWebView('morphResult', result);
        
        // ===== 6. 分析结果 =====
        console.log('[6] 分析结果...');
        const totalLayers = result?.totalLayers || productLayerIds.length;
        const successCount = result?.successCount || 0;
        const allSuccess = successCount === totalLayers && successCount > 0;
        const partialSuccess = successCount > 0 && successCount < totalLayers;
        
        console.log('  totalLayers:', totalLayers);
        console.log('  successCount:', successCount);
        console.log('  allSuccess:', allSuccess);
        console.log('  partialSuccess:', partialSuccess);
        
        // 收集错误信息
        let errorMessages: string[] = [];
        
        if (result?.results) {
            console.log('  详细结果:');
            result.results.forEach((r: any, i: number) => {
                const status = r.success ? '✓' : '✗';
                console.log(`    [${i}] ${status} layerId: ${r.layerId}, success: ${r.success}, error: ${r.error || 'none'}`);
                if (!r.success && r.error) {
                    errorMessages.push(`图层${r.layerId}: ${r.error}`);
                }
            });
        }
        
        // 如果有顶层错误，也记录
        if (result?.error) {
            console.error('  顶层错误:', result.error);
            errorMessages.unshift(result.error);
        }
        
        if (allSuccess) {
            console.log('  ✓ 全部成功');
            sendToWebView('toast', { 
                message: `形态统一完成，成功处理 ${successCount} 个图层`,
                type: 'success' 
            });
            // 不返回主页，停留在当前页面
        } else if (partialSuccess) {
            console.log('  ⚠ 部分成功');
            // 显示失败的图层错误
            console.error('  失败的图层错误:');
            errorMessages.forEach(msg => console.error('    - ' + msg));
            sendToWebView('toast', { 
                message: `部分完成: ${successCount}/${totalLayers} 个图层成功`,
                type: 'warning' 
            });
        } else {
            console.error('  ✗ 全部失败');
            console.error('  错误列表:');
            errorMessages.forEach(msg => console.error('    - ' + msg));
            
            // 使用第一个具体错误作为提示
            const displayError = errorMessages[0] || '形态统一失败，请检查图层选择';
            sendToWebView('toast', { 
                message: displayError,
                type: 'error' 
            });
        }
        
        console.log('╔════════════════════════════════════════════════════╗');
        console.log('║          [形态统一] 执行结束                       ║');
        console.log('╚════════════════════════════════════════════════════╝');
        console.log('');
        
        await forceRefreshCanvas();
        
    } catch (error: any) {
        console.error('');
        console.error('╔════════════════════════════════════════════════════╗');
        console.error('║          [形态统一] 发生异常                       ║');
        console.error('╚════════════════════════════════════════════════════╝');
        console.error('  错误类型:', error?.name || 'Unknown');
        console.error('  错误消息:', error?.message || String(error));
        console.error('  错误堆栈:', error?.stack || 'N/A');
        console.error('');
        sendToWebView('hideMorphProgress', {});
        sendToWebView('morphResult', { error: error.message });
        
        // 根据错误类型给出更友好的提示
        let displayMessage = '形态统一失败';
        if (error?.message?.includes('超时')) {
            displayMessage = '处理超时，请减少图层数量或检查 Agent 连接';
        } else if (error?.message?.includes('未连接')) {
            displayMessage = '请先连接到 Agent';
        } else if (error?.message) {
            displayMessage = error.message;
        }
        
        sendToWebView('toast', { 
            message: displayMessage,
            type: 'error' 
        });
    }
}

/**
 * 绑定 UI 事件处理器
 */
function bindUIEvents(container: HTMLElement) {
    // 由于使用了 WebView，UI 事件绑定在 WebView 内部的 index.html 中处理
    // 通过 postMessage 与 UXP 进行通信
    // 此处仅保留必要的容器级事件（如果有）
    
    console.log('[DesignEcho] UI events bound (WebView mode)');
}

/**
 * 处理来自 WebView 的消息
 */
function handleWebViewMessage(event: MessageEvent) {
    const { type, action, data } = event.data || {};
    
    if (type !== 'uxp-action') return;
    
    console.log(`[DesignEcho] WebView action: ${action}`, data);
    
    switch (action) {
        case 'webviewReady':
            // WebView 准备就绪，发送当前状态
            const isConnected = wsClient?.isConnected() || false;
            console.log('[DesignEcho] WebView ready, connection status:', isConnected);
            
            // 发送连接状态（同时使用两种格式确保兼容）
            sendToWebView('connectionStatus', { 
                status: isConnected ? 'connected' : 'disconnected' 
            });
            if (isConnected) {
                sendToWebView('enableActions', { enabled: true });
                sendToWebView('showMattingInput', {});
                sendToWebView('statusInfo', { message: '已连接到 Agent', hint: '请选择操作', status: 'success' });
            }
            break;
            
        case 'oneClickBeautify':
            handleOneClickBeautify();
            break;
            
        case 'optimizeText':
            handleOptimizeText();
            break;

        case 'optimizeTextRefreshSelection':
            loadOptimizeSelectedTextForWebView();
            break;

        case 'optimizeTextGenerate':
            handleGenerateOptimizeText(data);
            break;

        case 'optimizeTextApply':
            handleApplyOptimizeText(data);
            break;

        case 'optimizeTextBack':
            switchToPage('pageMain');
            break;
            
        case 'analyzeLayout':
            handleAnalyzeLayout();
            break;
            
        case 'removeBackground':
            handleRemoveBackground(data?.target);
            break;
            
        case 'shapeMorph':
            handleOpenMorphingPanel();
            break;
            
        case 'inpainting':
            handleOpenInpaintingPanel();
            break;
            
        case 'harmonize':
            handleHarmonize();
            break;
            
        case 'reconnect':
            initializeConnection();
            break;
    }
}

// 旧的 UI 更新函数已移除，现在使用 WebView postMessage 通信

/**
 * 初始化 WebSocket 连接
 */
async function initializeConnection() {
    if (isConnecting) {
        console.log('[DesignEcho] Connection already in progress, skipping...');
        return;
    }

    if (wsClient && wsClient.isConnected()) {
        console.log('[DesignEcho] Already connected, skipping...');
        return;
    }

    isConnecting = true;
    console.log('[DesignEcho] Initializing connection...');
    notifyConnectingToAgent();
    
    try {
        if (wsClient) {
            wsClient.disconnect();
            wsClient = null;
        }

        toolRegistry = new ToolRegistry();
        messageHandler = new MessageHandler(toolRegistry);
        
        messageHandler.setOnProgressCallback((operation, progress, message) => {
            console.log(`[DesignEcho] 进度: ${operation} ${progress}% - ${message}`);
            
            // 将技术性操作名转换为友好的中文提示
            const friendlyMessages = getFriendlyProgressMessage(operation, progress, message);
            
            // 使用状态栏显示进度（抠图页面会自动从 statusInfo 中提取进度更新到页面内的进度遮罩）
            sendToWebView('statusInfo', { 
                message: friendlyMessages.message, 
                hint: friendlyMessages.hint,
                status: 'info'
            });
        });
        
        // 设置 WebView 动作回调（处理来自 Agent WebView 的转发消息）
        messageHandler.setWebViewActionCallback(async (action: string, payload: any) => {
            console.log('[DesignEcho] 收到 Agent WebView 转发的动作:', action, payload);
            // 调用现有的 handleWebViewAction 函数
            await handleWebViewAction({ action, payload });
            return { handled: true };
        });
        
        wsClient = new WebSocketClient(AGENT_WS_URL, messageHandler);
        
        wsClient.setConnectionCallbacks(
            async () => {
                console.log('[DesignEcho] Connection callback: connected');
                notifyAgentConnected();
            },
            () => {
                console.log('[DesignEcho] Connection callback: disconnected');
                notifyAgentDisconnected('正在尝试重新连接...', true);
            }
        );

        // ==================== 设置二进制消息回调（用于接收蒙版等图像数据） ====================
        wsClient.setBinaryMessageCallback((header: BinaryHeader, imageData: Uint8Array) => {
            console.log(`[DesignEcho] 收到二进制数据: ${header.type}, requestId=${header.requestId}, ` +
                `${header.width}x${header.height}, ${(imageData.length / 1024).toFixed(1)}KB`);
            
            // PNG 或 RAW_MASK 类型的二进制数据传递给抠图工具
            if (header.type === BinaryMessageType.PNG || header.type === BinaryMessageType.RAW_MASK) {
                // 单目标抠图
                const mattingTool = toolRegistry?.getApplyMattingResultTool();
                if (mattingTool) {
                    mattingTool.receiveBinaryMask(header.requestId, imageData, header.type);
                }
                
                // 多目标抠图（使用静态方法）
                const MultiMattingToolClass = toolRegistry?.getApplyMultiMattingResultTool();
                if (MultiMattingToolClass) {
                    MultiMattingToolClass.receiveBinaryMask(header.requestId, header.width, header.height, imageData);
                }
            }
        });
        
        // 设置 RemoveBackgroundTool 的 WebSocket 客户端引用（用于二进制图像传输）
        const removeBackgroundTool = toolRegistry?.getRemoveBackgroundTool();
        if (removeBackgroundTool) {
            removeBackgroundTool.setWebSocketClient(wsClient);
            console.log('[DesignEcho] RemoveBackgroundTool 已配置二进制传输');
        }
        
        await wsClient.connect();
        console.log('[DesignEcho] Connected successfully!');
        
    } catch (error) {
        console.error('[DesignEcho] Connection failed:', error);
        notifyAgentConnectionFailed(error instanceof Error ? error.message : '请确保 Agent 应用已启动');
    } finally {
        isConnecting = false;
    }
}

/**
 * 处理一键美化
 */
async function handleOneClickBeautify() {
    if (!wsClient || !wsClient.isConnected()) {
        sendToWebView('toast', { message: '请先连接到 Agent', type: 'warning' });
        return;
    }
    
    try {
        sendToWebView('actionStart', { action: 'OneClickBeautify' });
        sendToWebView('showLoading', { text: '正在分析画布...' });
        
        const result = await wsClient.sendRequest('one-click-beautify', {});
        
        sendToWebView('hideLoading', {});
        
        if (result.success) {
            sendToWebView('toast', { message: result.message || '美化完成，布局已优化', type: 'success' });
            sendToWebView('actionComplete', { action: 'OneClickBeautify', success: true });
        } else {
            sendToWebView('toast', { message: result.error || '美化失败', type: 'error' });
            sendToWebView('actionComplete', { action: 'OneClickBeautify', success: false, message: result.error });
        }
    } catch (error) {
        console.error('[DesignEcho] One click beautify error:', error);
        sendToWebView('hideLoading', {});
        sendToWebView('toast', { 
            message: error instanceof Error ? error.message : '操作失败',
            type: 'error'
        });
        sendToWebView('actionComplete', { action: 'OneClickBeautify', success: false });
    }
}

/**
 * 处理文案优化
 */
async function handleOptimizeText() {
    if (!wsClient || !wsClient.isConnected()) {
        sendToWebView('toast', { message: '请先连接到 Agent', type: 'warning' });
        return;
    }

    try {
        switchToPage('pageOptimizeText');
        await loadOptimizeSelectedTextForWebView();
    } catch (error) {
        console.error('[DesignEcho] Optimize text error:', error);
        sendToWebView('toast', { 
            message: error instanceof Error ? error.message : '操作失败',
            type: 'error'
        });
        sendToWebView('actionComplete', { action: 'OptimizeText', success: false });
    }
}

async function loadOptimizeSelectedTextForWebView() {
    if (!wsClient || !wsClient.isConnected()) {
        sendToWebView('toast', { message: '请先连接到 Agent', type: 'warning' });
        return;
    }
    sendToWebView('showLoading', { text: '正在读取当前选中文本...' });
    try {
        const result = await wsClient.sendRequest('getTextContent', {}, 60000);
        sendToWebView('hideLoading', {});
        if (result?.success && result?.layerId) {
            sendToWebView('optimizeTextSelection', {
                success: true,
                layerId: result.layerId,
                selectedText: result.content || '',
                layerName: result.layerName || ''
            });
        } else {
            sendToWebView('optimizeTextSelection', { success: false });
            sendToWebView('toast', { message: result?.error || '请在 Photoshop 中先手动选中一个文本图层', type: 'warning' });
        }
    } catch (error: any) {
        sendToWebView('hideLoading', {});
        sendToWebView('optimizeTextSelection', { success: false });
        sendToWebView('toast', { message: error?.message || '读取选中文本失败', type: 'error' });
    }
}

async function handleGenerateOptimizeText(payload: any) {
    if (!wsClient || !wsClient.isConnected()) {
        sendToWebView('toast', { message: '请先连接到 Agent', type: 'warning' });
        return;
    }
    sendToWebView('showLoading', { text: '正在生成三版文案...' });
    try {
        const selected = await wsClient.sendRequest('getTextContent', {}, 60000);
        if (!selected?.success || !selected?.layerId) {
            sendToWebView('hideLoading', {});
            sendToWebView('toast', { message: '请先在 Photoshop 手动选中一个文本图层', type: 'warning' });
            return;
        }
        const result = await wsClient.sendRequest('optimize-text', {
            text: selected?.content || '',
            layerId: selected?.layerId,
            count: 3,
            creativeStyle: String(payload?.creativeStyle || 'natural'),
            lockedKeywords: String(payload?.lockedKeywords || '')
        }, 120000);
        sendToWebView('hideLoading', {});
        if (result?.success) {
            sendToWebView('optimizeTextCandidates', result);
            if (result?.degraded) {
                sendToWebView('toast', { message: '已返回快速候选，可直接替换后再细调', type: 'warning' });
            }
        } else {
            sendToWebView('toast', { message: result?.error || '文案生成失败', type: 'error' });
        }
    } catch (error: any) {
        sendToWebView('hideLoading', {});
        sendToWebView('toast', { message: error?.message || '文案生成失败', type: 'error' });
    }
}

async function handleApplyOptimizeText(payload: any) {
    if (!wsClient || !wsClient.isConnected()) {
        sendToWebView('toast', { message: '请先连接到 Agent', type: 'warning' });
        return;
    }
    const layerId = Number(payload?.layerId);
    const content = String(payload?.content || '').trim();
    if (!layerId || !content) {
        sendToWebView('toast', { message: '请先选择候选文案', type: 'warning' });
        return;
    }
    sendToWebView('showLoading', { text: '正在替换图层文案...' });
    try {
        const result = await wsClient.sendRequest('optimize-text-apply', { layerId, content });
        sendToWebView('hideLoading', {});
        if (result?.success) {
            sendToWebView('optimizeTextApplied', { layerId, content, data: result?.data || null });
            sendToWebView('toast', { message: '文案已替换', type: 'success' });
            await loadOptimizeSelectedTextForWebView();
        } else {
            sendToWebView('toast', { message: result?.error || '替换失败', type: 'error' });
        }
    } catch (error: any) {
        sendToWebView('hideLoading', {});
        sendToWebView('toast', { message: error?.message || '替换失败', type: 'error' });
    }
}

/**
 * 处理排版分析
 */
async function handleAnalyzeLayout() {
    if (!wsClient || !wsClient.isConnected()) {
        sendToWebView('toast', { message: '请先连接到 Agent', type: 'warning' });
        return;
    }

    try {
        sendToWebView('actionStart', { action: 'AnalyzeLayout' });
        sendToWebView('showLoading', { text: '正在分析排版...' });
        
        const result = await wsClient.sendRequest('analyze-layout', {});
        
        if (result.success) {
            sendToWebView('toast', { message: result.message || '排版分析完成', type: 'success' });
            sendToWebView('actionComplete', { action: 'AnalyzeLayout', success: true });
        } else {
            sendToWebView('toast', { message: result.error || '分析失败', type: 'error' });
            sendToWebView('actionComplete', { action: 'AnalyzeLayout', success: false });
        }
    } catch (error) {
        console.error('[DesignEcho] Analyze layout error:', error);
        sendToWebView('toast', { 
            message: error instanceof Error ? error.message : '操作失败',
            type: 'error'
        });
        sendToWebView('actionComplete', { action: 'AnalyzeLayout', success: false });
    }
}

/**
 * 处理智能抠图
 */
async function handleRemoveBackground(targetPrompt?: string) {
    if (!wsClient || !wsClient.isConnected()) {
        sendToWebView('toast', { message: '请先连接到 Agent', type: 'warning' });
        return;
    }

    try {
        sendToWebView('actionStart', { action: 'RemoveBackground' });
        // 使用状态栏显示初始状态（抠图页面会根据 statusInfo 自动更新进度遮罩）
        sendToWebView('statusInfo', { 
            message: '✂️ 智能抠图 0%', 
            hint: targetPrompt ? `识别: ${targetPrompt}` : '分析图像主体...',
            status: 'info'
        });
        
        const MATTING_TIMEOUT = 5 * 60 * 1000;
        
        const result = await wsClient.sendRequest('remove-background', {
            mode: 'ai',
            useMask: true,
            outputFormat: 'mask',
            quality: 'balanced',
            targetPrompt: targetPrompt || '',
            enableHairRefine: true,
            enableFabricRefine: true,
            usePythonBackend: true  // 固定使用 Python 后端
        }, MATTING_TIMEOUT);
        
        if (result.success) {
            // 强制刷新 Photoshop 画布显示
            await forceRefreshCanvas();
            
            // 使用 Toast 显示结果
            sendToWebView('toast', { message: '抠图完成，蒙版已应用到图层', type: 'success' });
            sendToWebView('actionComplete', { action: 'RemoveBackground', success: true });
        } else {
            sendToWebView('toast', { message: result.error || '抠图失败', type: 'error' });
            sendToWebView('actionComplete', { action: 'RemoveBackground', success: false });
        }
    } catch (error) {
        console.error('[DesignEcho] Remove background error:', error);
        // 错误时使用 Toast 显示错误（抠图页面会根据 mattingResult 消息隐藏进度遮罩）
        sendToWebView('toast', { 
            message: error instanceof Error ? error.message : '抠图失败',
            type: 'error'
        });
        sendToWebView('actionComplete', { action: 'RemoveBackground', success: false });
    }
}

/**
 * 打开形态统一面板
 */
async function handleOpenMorphingPanel() {
    if (!wsClient || !wsClient.isConnected()) {
        sendToWebView('toast', { message: '请先连接到 Agent', type: 'warning' });
        return;
    }
    
    // 切换到形态统一页面
    switchToPage('pageMorph');
    
    // 加载图层列表并发送到 WebView
    await loadMorphLayersForWebView();
}

// 存储形态统一相关状态（产品图层选择）
let morphSelectedLayers: number[] = [];

/**
 * 切换页面
 */
function switchToPage(pageId: string) {
    if (!panelContainer) return;
    
    const pages = panelContainer.querySelectorAll('.page');
    pages.forEach(page => page.classList.remove('active'));
    
    const targetPage = panelContainer.querySelector(`#${pageId}`);
    if (targetPage) {
        targetPage.classList.add('active');
    }
    
    console.log(`[DesignEcho] 切换到页面: ${pageId}`);
}

// 存储形态统一相关状态
let morphShapeLayers: any[] = [];  // 形状图层（参考形状）
let morphProductLayers: any[] = [];  // 产品图层
let morphSelectedRefShape: number | null = null;  // 选中的参考形状 ID

/**
 * 加载形态统一的图层列表
 */
async function loadMorphLayers() {
    console.log('[DesignEcho] loadMorphLayers 开始');
    
    if (!panelContainer) {
        console.log('[DesignEcho] panelContainer 不存在');
        return;
    }
    
    const refShapeSelect = panelContainer.querySelector('#refShapeSelect') as HTMLElement;
    const layerList = panelContainer.querySelector('#morphLayerList');
    const layerCount = panelContainer.querySelector('#morphLayerCount');
    
    console.log('[DesignEcho] 元素检查:', {
        refShapeSelect: !!refShapeSelect,
        layerList: !!layerList,
        layerCount: !!layerCount
    });
    
    if (!refShapeSelect || !layerList) {
        console.log('[DesignEcho] 必要元素缺失');
        return;
    }
    
    // 显示加载状态 (自定义下拉菜单)
    layerList.innerHTML = '<div class="layer-empty">正在加载图层...</div>';
    const selectText = refShapeSelect.querySelector('.custom-select-text');
    if (selectText) selectText.textContent = '-- 加载中 --';
    
    try {
        // 直接使用本地 UXP 工具获取图层列表
        if (!toolRegistry) {
            layerList.innerHTML = '<div class="layer-empty">工具未初始化</div>';
            return;
        }
        const tool = toolRegistry.getTool('getLayerHierarchy');
        if (!tool) {
            layerList.innerHTML = '<div class="layer-empty">图层工具未找到</div>';
            return;
        }
        const result = await tool.execute({ includeHidden: false, flatList: true });
        
        if (!result?.success) {
            layerList.innerHTML = `<div class="layer-empty">${result?.error || '无法获取图层，请确保有打开的文档'}</div>`;
            const selectTextErr = refShapeSelect.querySelector('.custom-select-text');
            if (selectTextErr) selectTextErr.textContent = '-- 无文档 --';
            return;
        }
        
        const allLayers = result.flatList || [];
        
        // 调试：打印所有图层的类型
        console.log('[DesignEcho] loadMorphLayers - 所有图层:', allLayers.map((l: any) => ({ name: l.name, kind: l.kind })));
        
        // 分类图层：形状图层 vs 产品图层（像素/智能对象）
        morphShapeLayers = allLayers.filter((l: any) => 
            l.kind === 'vector' || l.kind === 'shape' || l.kind === 'solidColor'
        );
        morphProductLayers = allLayers.filter((l: any) => 
            l.kind === 'pixel' || l.kind === 'smartObject'
        );
        
        console.log('[DesignEcho] loadMorphLayers - 形状图层:', morphShapeLayers.map((l: any) => l.name));
        console.log('[DesignEcho] loadMorphLayers - 产品图层:', morphProductLayers.map((l: any) => l.name));
        
        // 填充参考形状下拉框 (自定义下拉菜单)
        const selectText = refShapeSelect.querySelector('.custom-select-text');
        const selectOptions = refShapeSelect.querySelector('.custom-select-options');
        
        if (morphShapeLayers.length === 0) {
            if (selectText) selectText.textContent = '-- 无形状图层（请用钢笔工具绘制）--';
            if (selectOptions) selectOptions.innerHTML = '<div class="custom-select-option" data-value="">无可用形状图层</div>';
        } else {
            // 直接显示形状图层选项，不显示占位符
            if (selectOptions) {
                selectOptions.innerHTML = morphShapeLayers.map((layer: any) => 
                    `<div class="custom-select-option" data-value="${layer.id}">${layer.name}</div>`
                ).join('');
            }
            // 默认显示第一个形状图层名称，并设置选中状态
            if (selectText) selectText.textContent = morphShapeLayers[0]?.name || '选择形状';
            // 重要：自动选中第一个形状图层
            morphSelectedRefShape = morphShapeLayers[0]?.id || null;
            console.log(`[DesignEcho] 自动选中参考形状: ${morphSelectedRefShape}`);
        }
        
        // 绑定自定义下拉菜单事件
        bindCustomSelect(refShapeSelect as HTMLElement);
        
        // 填充产品图层列表
        if (morphProductLayers.length === 0) {
            layerList.innerHTML = '<div class="layer-empty">没有产品图层</div>';
            } else {
            const layersHtml = morphProductLayers.map((layer: any) => {
                const width = layer.bounds ? layer.bounds.right - layer.bounds.left : 0;
                const height = layer.bounds ? layer.bounds.bottom - layer.bounds.top : 0;
                const typeLabel = layer.kind === 'smartObject' ? 'SO' : 'PX';
                
                return `
                    <div class="layer-item" data-layer-id="${layer.id}">
                        <span class="layer-checkbox">✓</span>
                        <span class="layer-icon">▢</span>
                        <span class="layer-name">${layer.name}</span>
                        <span class="layer-type">${typeLabel}</span>
                    </div>
                `;
            }).join('');
            
            layerList.innerHTML = layersHtml;
            
            // 绑定图层点击事件
            const layerItems = layerList.querySelectorAll('.layer-item');
            layerItems.forEach((item: Element) => {
                item.addEventListener('click', function(this: HTMLElement) {
                    this.classList.toggle('selected');
                    updateMorphSelection();
                });
            });
        }
        
        // 更新计数
        if (layerCount) {
            layerCount.textContent = `已选 0 个`;
        }
        
        // 参考形状选择事件已在 bindCustomSelect 中处理
        
        // 绑定滑块值更新
        bindSliderEvents();
        
        // 绑定高级选项展开/收起
        bindAdvancedToggle();
        
        console.log(`[DesignEcho] 形状图层: ${morphShapeLayers.length}, 产品图层: ${morphProductLayers.length}`);
        
    } catch (error) {
        console.error('[DesignEcho] 加载图层失败:', error);
        layerList.innerHTML = '<div class="layer-empty">加载图层失败</div>';
    }
}

/**
 * 绑定自定义滑块事件
 */
function bindSliderEvents() {
    if (!panelContainer) return;
    
    const sliders = [
        { id: 'morphEdgeStrength', valueId: 'morphEdgeStrengthValue' },
        { id: 'morphContentProtect', valueId: 'morphContentProtectValue' },
        { id: 'morphSmoothness', valueId: 'morphSmoothnessValue' }
    ];
    
    sliders.forEach(({ id, valueId }) => {
        const slider = panelContainer!.querySelector(`#${id}`) as HTMLElement;
        const valueSpan = panelContainer!.querySelector(`#${valueId}`);
        if (slider && valueSpan) {
            bindCustomSlider(slider, valueSpan as HTMLElement);
        }
    });
    
    // 绑定自定义开关
    const toggles = panelContainer.querySelectorAll('.custom-toggle');
    console.log('[DesignEcho] 找到开关数量:', toggles.length);
    toggles.forEach((toggle: Element) => {
        toggle.addEventListener('click', (e: Event) => {
            e.stopPropagation();
            const el = toggle as HTMLElement;
            el.classList.toggle('active');
            el.dataset.checked = el.classList.contains('active') ? 'true' : 'false';
            console.log('[DesignEcho] 开关切换:', el.id, el.dataset.checked);
        });
    });
    
    // 绑定自定义复选框
    const checkboxes = panelContainer.querySelectorAll('.region-item');
    console.log('[DesignEcho] 找到复选框数量:', checkboxes.length);
    checkboxes.forEach((item: Element) => {
        item.addEventListener('click', (e: Event) => {
            e.stopPropagation();
            const el = item as HTMLElement;
            const checkbox = el.querySelector('.custom-checkbox');
            if (checkbox) {
                checkbox.classList.toggle('checked');
                el.dataset.checked = checkbox.classList.contains('checked') ? 'true' : 'false';
                console.log('[DesignEcho] 复选框切换:', el.dataset.region, el.dataset.checked);
            }
        });
    });
}

/**
 * 绑定自定义滑块交互
 */
function bindCustomSlider(slider: HTMLElement, valueSpan: HTMLElement) {
    const track = slider.querySelector('.custom-slider-track') as HTMLElement;
    const fill = slider.querySelector('.custom-slider-fill') as HTMLElement;
    const thumb = slider.querySelector('.custom-slider-thumb') as HTMLElement;
    
    if (!track || !fill || !thumb) {
        console.log('[DesignEcho] 滑块元素未找到:', slider.id);
        return;
    }
    
    console.log('[DesignEcho] 绑定滑块:', slider.id);
    
    let isDragging = false;
    
    const updateSlider = (clientX: number) => {
        const rect = track.getBoundingClientRect();
        let percent = ((clientX - rect.left) / rect.width) * 100;
        percent = Math.max(0, Math.min(100, percent));
        
        fill.style.width = `${percent}%`;
        thumb.style.left = `${percent}%`;
        slider.dataset.value = Math.round(percent).toString();
        valueSpan.textContent = `${Math.round(percent)}%`;
    };
    
    // 使用 pointer 事件以获得更好的兼容性
    const onPointerDown = (e: PointerEvent) => {
        console.log('[DesignEcho] 滑块点击:', slider.id);
        isDragging = true;
        slider.classList.add('dragging');
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        updateSlider(e.clientX);
        e.preventDefault();
        e.stopPropagation();
    };
    
    const onPointerMove = (e: PointerEvent) => {
        if (!isDragging) return;
        updateSlider(e.clientX);
        e.preventDefault();
    };
    
    const onPointerUp = (e: PointerEvent) => {
        if (isDragging) {
            isDragging = false;
            slider.classList.remove('dragging');
            (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
        }
    };
    
    // 直接在滑块容器上监听
    slider.addEventListener('pointerdown', onPointerDown);
    slider.addEventListener('pointermove', onPointerMove);
    slider.addEventListener('pointerup', onPointerUp);
    slider.addEventListener('pointercancel', onPointerUp);
    
    // 点击轨道也可以跳转
    track.addEventListener('click', (e: MouseEvent) => {
        console.log('[DesignEcho] 滑块轨道点击');
        updateSlider(e.clientX);
    });
}

/**
 * 绑定自定义下拉菜单交互
 */
function bindCustomSelect(select: HTMLElement) {
    const trigger = select.querySelector('.custom-select-trigger') as HTMLElement;
    const options = select.querySelector('.custom-select-options') as HTMLElement;
    const textEl = select.querySelector('.custom-select-text') as HTMLElement;
    
    if (!trigger || !options || !textEl) {
        console.log('[DesignEcho] 下拉菜单元素未找到');
        return;
    }
    
    console.log('[DesignEcho] 绑定下拉菜单:', select.id);
    
    // 点击触发器打开/关闭下拉菜单
    trigger.addEventListener('click', (e: Event) => {
        console.log('[DesignEcho] 下拉菜单触发器点击');
        e.stopPropagation();
        select.classList.toggle('open');
    });
    
    // 点击选项
    const optionItems = options.querySelectorAll('.custom-select-option');
    optionItems.forEach((optItem: Element) => {
        optItem.addEventListener('click', (e: Event) => {
            e.stopPropagation();
            const target = optItem as HTMLElement;
            const value = target.dataset.value || '';
            const text = target.textContent || '';
            
            console.log('[DesignEcho] 选中选项:', text, value);
            
            // 更新选中状态
            optionItems.forEach(opt => opt.classList.remove('selected'));
            target.classList.add('selected');
            
            // 更新显示文本
            textEl.textContent = text;
            select.dataset.value = value;
            
            // 关闭下拉菜单
            select.classList.remove('open');
            
            // 更新形态统一状态
            morphSelectedRefShape = value ? parseInt(value) : null;
            updateMorphStatus();
        });
    });
    
    // 点击外部关闭下拉菜单
    if (panelContainer) {
        panelContainer.addEventListener('click', (e: Event) => {
            if (!select.contains(e.target as Node)) {
                select.classList.remove('open');
            }
                });
            }
        }
        
/**
 * 绑定高级选项展开/收起
 */
function bindAdvancedToggle() {
    if (!panelContainer) return;
    
    const toggleBtn = panelContainer.querySelector('#btnToggleAdvanced');
    const advancedSection = panelContainer.querySelector('#morphAdvancedSection');
    const advancedContent = panelContainer.querySelector('#advancedContent');
    
    if (toggleBtn && advancedSection && advancedContent) {
        toggleBtn.addEventListener('click', () => {
            advancedSection.classList.toggle('expanded');
            (advancedContent as HTMLElement).style.display = 
                advancedSection.classList.contains('expanded') ? 'block' : 'none';
        });
    }
}

/**
 * 更新形态统一的选择状态
 */
function updateMorphSelection() {
    if (!panelContainer) return;
    
    const selectedItems = panelContainer.querySelectorAll('#morphLayerList .layer-item.selected');
    morphSelectedLayers = Array.from(selectedItems).map(
        item => parseInt((item as HTMLElement).dataset.layerId || '0')
    );
    
    // 更新计数
    const layerCount = panelContainer.querySelector('#morphLayerCount');
    if (layerCount) {
        layerCount.textContent = `已选 ${morphSelectedLayers.length} 个`;
    }
    
    // 更新状态
    updateMorphStatus();
}

/**
 * 更新形态统一状态和执行按钮
 */
function updateMorphStatus() {
    if (!panelContainer) return;
    
    const statusEl = panelContainer.querySelector('#morphStatus');
    const btnExecute = panelContainer.querySelector('#btnMorphExecute') as HTMLButtonElement;
    
    const hasRefShape = morphSelectedRefShape !== null;
    const hasProducts = morphSelectedLayers.length > 0;
    
    if (!hasRefShape && !hasProducts) {
        if (statusEl) statusEl.textContent = '选择参考形状和产品图层后开始';
        if (btnExecute) btnExecute.disabled = true;
    } else if (!hasRefShape) {
        if (statusEl) statusEl.textContent = '请选择一个参考形状';
        if (btnExecute) btnExecute.disabled = true;
    } else if (!hasProducts) {
        if (statusEl) statusEl.textContent = '请选择需要调整的产品图层';
        if (btnExecute) btnExecute.disabled = true;
    } else {
        if (statusEl) statusEl.textContent = `将 ${morphSelectedLayers.length} 个产品对齐到参考形状`;
        if (btnExecute) btnExecute.disabled = false;
    }
}

/**
 * 全选产品图层
 */
function toggleSelectAllLayers() {
    if (!panelContainer) return;
    
    const layerItems = panelContainer.querySelectorAll('#morphLayerList .layer-item');
    layerItems.forEach(item => item.classList.add('selected'));
    updateMorphSelection();
}

/**
 * 取消全选
 */
function deselectAllLayers() {
    if (!panelContainer) return;
    
    const layerItems = panelContainer.querySelectorAll('#morphLayerList .layer-item');
    layerItems.forEach(item => item.classList.remove('selected'));
    updateMorphSelection();
}

/**
 * 执行图像协调融合
 * 将当前选中的前景图层与背景协调
 */
async function handleHarmonize() {
    if (!wsClient || !wsClient.isConnected()) {
        sendToWebView('toast', { message: '请先连接到 Agent', type: 'warning' });
        return;
    }
    
    const { app } = require('photoshop');
    const doc = app.activeDocument;
    
    if (!doc) {
        sendToWebView('toast', { message: '请先打开文档', type: 'warning' });
        return;
    }
    
    if (doc.activeLayers.length === 0) {
        sendToWebView('toast', { message: '请先选择前景图层', type: 'warning' });
        return;
    }

    function restoreConnectedStatus(): void {
        sendToWebView('statusInfo', {
            message: '已连接到 Agent',
            hint: '',
            status: 'success'
        });
    }
    
    try {
        sendToWebView('actionStart', { action: 'Harmonize' });
        sendToWebView('showLoading', { text: '正在协调融合...' });
        sendToWebView('statusInfo', { 
            message: '🎨 协调融合', 
            hint: '分析前景与背景色彩...',
            status: 'info'
        });
        
        const foregroundLayerId = doc.activeLayers[0].id;
        
        // 调用协调服务
        const result = await wsClient.sendRequest('harmonize', {
            foregroundLayerId: foregroundLayerId,
            mode: 'balanced',
            intensity: 0.7
        });
        
        sendToWebView('hideLoading', {});
        
        if (result && result.success) {
            sendToWebView('toast', { 
                message: `协调完成，耗时 ${result.processingTime || 0}ms`, 
                type: 'success' 
            });
            restoreConnectedStatus();
            sendToWebView('actionComplete', { action: 'Harmonize', success: true });
        } else {
            sendToWebView('toast', { 
                message: result?.error || '协调失败', 
                type: 'error' 
            });
            restoreConnectedStatus();
            sendToWebView('actionComplete', { action: 'Harmonize', success: false });
        }
    } catch (error) {
        console.error('[DesignEcho] Harmonize error:', error);
        sendToWebView('hideLoading', {});
        sendToWebView('toast', { 
            message: error instanceof Error ? error.message : '协调失败',
            type: 'error'
        });
        restoreConnectedStatus();
        sendToWebView('actionComplete', { action: 'Harmonize', success: false });
    }
}

/**
 * 打开局部重绘面板
 */
async function handleOpenInpaintingPanel() {
    console.log('[DesignEcho] handleOpenInpaintingPanel called');
    
    if (!wsClient || !wsClient.isConnected()) {
        console.warn('[DesignEcho] Agent not connected');
        sendToWebView('toast', { message: '请先连接到 Agent', type: 'warning' });
        return;
    }
    
    // 1. 获取工具注册表
    if (!toolRegistry) {
        console.error('[DesignEcho] ToolRegistry not initialized');
        sendToWebView('toast', { message: '工具未初始化', type: 'error' });
        return;
    }

    try {
        // 2. 轻量检测选区（不创建临时图层，不污染 PS 历史）
        const getBoundsTool = toolRegistry.getTool('getSelectionBounds');
        const hasValidSelection = getBoundsTool
            ? (await getBoundsTool.execute({}))?.success === true
            : false;

        // 3. 无论有无选区，都直接跳转到局部重绘页面
        //    选区数据将在用户点击"生成"时由 UXP 实时获取（SSOT 原则）
        console.log('[DesignEcho] 选区检测:', hasValidSelection ? '有效' : '无/无效');
        
        if (!hasValidSelection) {
            // 进入局部重绘时自动切换到套索工具，避免先弹提示打断流程
            await selectLassoTool({ notify: false });
        }

        sendToWebView('navigate', { 
            view: 'inpainting',
            payload: {
                selectionReady: hasValidSelection
            }
        });
        
    } catch (error: any) {
        console.error('[DesignEcho] Inpainting error:', error);
        sendToWebView('hideLoading', {});
        sendToWebView('toast', { 
            message: error.message || '操作失败',
            type: 'error'
        });
    }
}

/**
 * 应用局部重绘结果
 */
async function handleApplyInpaintingResult(payload: any) {
    const { imageData, isRawRgba, layerName, width, height, originalWidth, originalHeight, targetBounds } = payload;
    
    if (!imageData) {
        sendToWebView('toast', { message: '没有图像数据', type: 'error' });
        return;
    }
    
    try {
        sendToWebView('showLoading', { text: '应用结果到画布...' });
        
        if (!toolRegistry) throw new Error('工具未初始化');
        
        const applyTool = toolRegistry.getTool('applyInpaintingResult');
        if (!applyTool) throw new Error('未找到应用工具');
        
        const result = await applyTool.execute({
            imageData,
            isRawRgba: isRawRgba === true,
            layerName: layerName || '局部重绘结果',
            width,
            height,
            originalWidth,
            originalHeight,
            targetBounds
        });
        
        sendToWebView('hideLoading', {});
        
        if (result.success) {
            sendToWebView('toast', { message: '已创建新图层', type: 'success' });
            sendToWebView('inpaintingApplied', {
                layerId: result.layerId || null,
                layerName: result.layerName || layerName || '局部重绘结果'
            });
            // 强制刷新画布以显示结果
            await forceRefreshCanvas();
        } else {
            sendToWebView('toast', { message: result.error || '应用失败', type: 'error' });
        }
        
    } catch (error: any) {
        console.error('[DesignEcho] Apply inpainting error:', error);
        sendToWebView('hideLoading', {});
        sendToWebView('toast', { 
            message: error.message || '应用失败',
            type: 'error'
        });
    }
}

/**
 * 处理局部重绘生成请求
 */
async function handleInpaintingGenerate(payload: any) {
    if (!wsClient || !wsClient.isConnected()) {
        sendToWebView('toast', { message: '请先连接到 Agent', type: 'warning' });
        sendToWebView('hideLoading', {});
        return;
    }

    try {
        console.log('[DesignEcho] 发送局部重绘请求...');
        const prompt = String(payload?.prompt || '').trim();
        if (!prompt) {
            throw new Error('提示词不能为空');
        }

        // SSOT：始终在生成前从 Photoshop 原子抓取最新选区快照，忽略 WebView 缓存像素
        if (!toolRegistry) {
            throw new Error('工具未初始化，无法获取选区');
        }
        const getMaskTool = toolRegistry.getTool('getSelectionMask');
        if (!getMaskTool) {
            throw new Error('未找到获取选区工具');
        }
        const maskResult = await getMaskTool.execute({ includeImage: true, maxSize: 1024 });
        if (!maskResult.success) {
            const selectionError = maskResult.error || '请先创建选区（使用套索工具、矩形选框等）';
            console.warn('[DesignEcho] Inpainting skipped:', selectionError);
            sendToWebView('hideLoading', {});
            sendToWebView('toast', { message: selectionError, type: 'warning' });
            return;
        }
        // 新协议：raw base64 + 元信息
        const image = maskResult.image || '';
        const mask = maskResult.mask || '';
        const selectionBounds = maskResult.selectionBounds || null;
        const documentMeta = maskResult.documentMeta || payload?.documentMeta || null;
        console.log(`[DesignEcho] 实时选区快照获取成功 (format: ${maskResult.maskFormat || 'unknown'}, maskCh=${maskResult.maskChannels}, imgCh=${maskResult.imageChannels})`);

        const normalizedPayload = {
            image,
            imageFormat: maskResult.imageFormat || 'raw',
            imageChannels: maskResult.imageChannels || 3,
            mask,
            maskFormat: maskResult.maskFormat || 'raw',
            maskChannels: maskResult.maskChannels || 1,
            imageWidth: maskResult.width,
            imageHeight: maskResult.height,
            prompt,
            model: payload?.model || 'flux-2-pro',
            seed: payload?.seed,
            selectionBounds,
            documentMeta: documentMeta || {
                width: maskResult.originalWidth || payload?.originalWidth || payload?.width || 0,
                height: maskResult.originalHeight || payload?.originalHeight || payload?.height || 0
            }
        };

        if (!normalizedPayload.image || !normalizedPayload.mask || !normalizedPayload.prompt) {
            throw new Error('局部重绘请求参数不完整（请确保有选区和提示词）');
        }

        // 发送请求到 Agent
        const result = await wsClient.sendRequest('inpainting.generate', normalizedPayload, 120000); // 2分钟超时

        if (result.success && result.images) {
            sendToWebView('inpaintingGenerated', { images: result.images, rawImages: result.rawImages || [], meta: result.meta || null });
            sendToWebView('toast', { message: '生成完成', type: 'success' });
        } else {
            sendToWebView('hideLoading', {});
            sendToWebView('toast', { message: result.error || '生成失败', type: 'error' });
        }
    } catch (error: any) {
        const errorMessage = error?.message || '请求失败';
        const isSelectionWarning = typeof errorMessage === 'string' && errorMessage.includes('请先创建选区');
        if (isSelectionWarning) {
            console.warn('[DesignEcho] Inpainting warning:', errorMessage);
        } else {
            console.error('[DesignEcho] Inpainting generate error:', error);
        }
        sendToWebView('hideLoading', {});
        sendToWebView('toast', { 
            message: errorMessage,
            type: isSelectionWarning ? 'warning' : 'error'
        });
    }
}

/**
 * 清理资源
 */
function cleanup() {
    console.log('[DesignEcho] Cleaning up...');
    
    disableLogging();
    
    // 移除消息监听器
    if (isWebViewInitialized) {
        if (webviewElement) {
            webviewElement.removeEventListener('message', webviewMessageHandler as any);
        }
        window.removeEventListener('message', webviewMessageHandler);
        isWebViewInitialized = false;
    }
    
    if (wsClient) {
        wsClient.disconnect();
        wsClient = null;
    }
    
    messageHandler = null;
    panelContainer = null;
    webviewElement = null;
    
    console.log('[DesignEcho] Cleanup complete');
}
