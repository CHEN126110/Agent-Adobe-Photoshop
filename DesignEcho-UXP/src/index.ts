/**
 * DesignEcho UXP Plugin - 主入口 (WebView 版本)
 * 
 * 功能：
 * 1. 使用 webview 加载远程美观 UI
 * 2. 作为 WebSocket Client 连接到 Agent
 * 3. 暴露 Photoshop 操作工具
 * 4. 作为 WebView 和 Photoshop 之间的桥梁
 */

import { JsonRpcRequestError, WebSocketClient } from './core/websocket-client';
import { MessageHandler } from './core/message-handler';
import { ToolRegistry } from './tools/registry';
import { disableLogging } from './core/logger';
import { BinaryMessageType, BinaryHeader } from './core/binary-protocol';
import { getEntryFromPath } from './core/file-url';
import { openDocumentWithJsx, saveNamedDocumentWithJsx } from './core/jsx-bridge';
import { exportSelectedLayersAsDesignAsset } from './core/design-asset-export';
import { createTemplateLibraryStateCoordinator } from './core/template-library-state-coordinator';
import { base64ToUint8Array } from './core/base64';
import { forceRefreshCanvas } from './core/canvas-refresh';
import { getFriendlyProgressMessage } from './core/friendly-progress';
import {
    buildImageToImageSelectionPayload,
    buildImageToImageSelectionSignature,
    isSelectionOwnedByCandidateRun,
    toPhotoshopEntityId
} from './core/image-to-image-selection';
import { normalizeImageToImageError, normalizeInpaintingError } from './core/image-generation-errors';
import {
    DEFAULT_IMAGE_TO_IMAGE_SIZE_PRESET,
    normalizeImageToImageModel,
    resolveImageToImageRequestTimeoutMs,
    resolveImageToImageSizePreset,
    resolveImageToImageSnapshotMaxEdge,
    resolveImageToImageSnapshotMaxEdgeForExplicitSize
} from './core/image-generation-options';
import { getImageToImageStageLabel, getInpaintingStageLabel } from './core/image-generation-stage-labels';
import { resolveImageResultFormatHint } from './core/image-safety';
import {
    TEMPLATE_LIBRARY_MAX_BINARY_EXPORT_BYTES,
    TEMPLATE_LIBRARY_MAX_PREVIEW_EXPORT_BYTES,
    TEMPLATE_LIBRARY_PREVIEW_MAX_DIMENSION,
    TEMPLATE_LIBRARY_PREVIEW_JPEG_QUALITY,
    TEMPLATE_LIBRARY_MAX_BINARY_BASE64_LENGTH,
    buildOptimisticTemplateLibraryImportOverrides,
    collectTemplateLibraryLayerIdsInStackOrder,
    getTemplateLibraryErrorMessage,
    getTemplateLibraryLayerBounds,
    getTemplateLibraryParentRelativePath,
    getTemplateLibrarySelectionBaseName,
    hasTemplateLibraryVisibleBounds,
    hasUsableTemplateLibraryCachedState,
    normalizeTemplateLibraryRelativePath,
    sanitizeTemplateLibraryAssetFileName,
    templateLibraryUint8ArrayToBase64
} from './core/template-library-core';
import { createDuplicateWebViewMessageGuard, summarizeWebViewPayload } from './core/webview-message-core';
import { applyEmbeddedWebViewElementLayout, preparePanelHostLayout } from './core/webview-panel-layout';

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

const templateLibraryStateCoordinator = createTemplateLibraryStateCoordinator({
    getWsClient: () => wsClient,
    sendToWebView: (msgType: string, data: any) => sendToWebView(msgType, data),
    schedule: (callback: () => void) => {
        setTimeout(callback, 0);
    }
});

/**
 * 初始化插件入口点
 */
entrypoints.setup({
    panels: {
        mainPanel: {
            show: async (node: HTMLElement) => {
                console.log('[DesignEcho] Panel show called');
                preparePanelHostLayout(node);
                panelContainer = node;
                renderPanel(node);
                // 插件加载不能等待 Agent/WebSocket/MCP 初始化；连接失败应只影响状态栏，不阻塞 UXP load。
                void initializeConnection();
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
let webviewResizeObserver: ResizeObserver | null = null;
let webviewResizeCommitTimer: number | null = null;

// 消息处理函数（命名函数，便于移除）
const shouldDropDuplicateWebViewMessage = createDuplicateWebViewMessageGuard();

function clearEmbeddedWebViewResizeCommitTimer(): void {
    if (webviewResizeCommitTimer == null) {
        return;
    }

    clearTimeout(webviewResizeCommitTimer);
    webviewResizeCommitTimer = null;
}

function commitEmbeddedWebViewSize(container: HTMLElement): void {
    if (!webviewElement) {
        return;
    }

    applyEmbeddedWebViewElementLayout(webviewElement);
}

function syncEmbeddedWebViewSize(container: HTMLElement, immediate = false): void {
    if (!webviewElement) {
        return;
    }

    const element = webviewElement as HTMLElement;
    element.style.position = 'absolute';
    element.style.inset = '0';
    element.style.width = '100%';
    element.style.height = '100%';

    if (immediate) {
        clearEmbeddedWebViewResizeCommitTimer();
        commitEmbeddedWebViewSize(container);
        return;
    }

    clearEmbeddedWebViewResizeCommitTimer();
    webviewResizeCommitTimer = window.setTimeout(() => {
        webviewResizeCommitTimer = null;
        commitEmbeddedWebViewSize(container);
    }, 96);
}

function webviewMessageHandler(e: MessageEvent) {
    try {
        const messageType = String((e as any)?.data?.type || '');
        const action = String((e as any)?.data?.action || '');
        const payloadSummary = summarizeWebViewPayload((e as any)?.data?.payload);
        console.log(`[DesignEcho] Message from WebView: type=${messageType}, action=${action}, payload=${payloadSummary}`);
    } catch (error) {
        console.warn('[DesignEcho] Failed to summarize WebView message:', error);
    }
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
    if (webviewResizeObserver) {
        webviewResizeObserver.disconnect();
        webviewResizeObserver = null;
    }
    
    // 让 WebView 跟随面板容器伸缩，避免被固定尺寸锁死。
    container.style.cssText = 'position: relative; width: 100%; height: 100%; min-height: 100%; overflow: hidden; background: #0a0a0f;';
    
    console.log('[DesignEcho] Rendering WebView with responsive panel sizing');
    
    // 创建 webview 元素 - 按照 Adobe 官方文档格式
    container.innerHTML = `
        <div id="designecho-panel-root" style="position:absolute; inset:0; width:100%; height:100%; overflow:hidden; background:#0a0a0f;">
            <webview
                id="designecho-webview"
                src="${WEBVIEW_URL}"
                uxpAllowInspector="true"
                style="position:absolute; inset:0; display:block; width:100%; height:100%; border:none; background:#0a0a0f;"
            ></webview>
        </div>
    `;
    
    // 获取 webview 元素
    webviewElement = container.querySelector('#designecho-webview');
    
    if (!webviewElement) {
        console.error('[DesignEcho] WebView element not found');
        return;
    }
    
    (webviewElement as HTMLElement).style.border = 'none';
    (webviewElement as HTMLElement).style.position = 'absolute';
    (webviewElement as HTMLElement).style.inset = '0';
    (webviewElement as HTMLElement).style.width = '100%';
    (webviewElement as HTMLElement).style.height = '100%';
    (webviewElement as HTMLElement).style.display = 'block';
    syncEmbeddedWebViewSize(container, true);
    // ResizeObserver 是 UXP v8.1（PS 26.1）才有的 API；支持版本下探到 PS 25.0 后按能力选路：
    // 有就用（精确跟随容器），没有就监听窗口 resize + 面板 show 时同步——两条路都显式声明，不是静默兜底。
    if (typeof ResizeObserver === 'function') {
        webviewResizeObserver = new ResizeObserver(() => {
            syncEmbeddedWebViewSize(container);
        });
        webviewResizeObserver.observe(container);
    } else {
        console.log('[DesignEcho] 该 Photoshop 版本无 ResizeObserver（<26.1），改用 window resize 同步 WebView 尺寸');
        window.addEventListener('resize', () => syncEmbeddedWebViewSize(container));
    }
    
    console.log('[DesignEcho] WebView element created, src:', WEBVIEW_URL);
    
    // 监听 WebView 加载事件
    webviewElement.addEventListener('loadstart', (e: any) => {
        console.log('[DesignEcho] WebView loadstart:', e.url);
    });
    
    webviewElement.addEventListener('loadstop', (e: any) => {
        console.log('[DesignEcho] WebView loadstop:', e.url);
        syncEmbeddedWebViewSize(container, true);
        syncWebViewConnectionState();
    });

    try {
        webviewElement.addEventListener('console-message', (e: any) => {
            console.log('[DesignEcho][WebViewConsole]', e?.level, e?.message || e);
        });
    } catch (error) {
        console.warn('[DesignEcho] Failed to bind webview console-message listener:', error);
    }
    
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
    // 某些 UXP 版本下消息会通过 window 派发，保留兼容监听
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
            console.log('[DesignEcho] WebView ready');
            syncWebViewConnectionState();
            const cachedTemplateLibraryState = getTemplateLibraryLastStatePayload();
            if (hasUsableTemplateLibraryCachedState(cachedTemplateLibraryState)) {
                sendToWebView('templateLibraryState', cachedTemplateLibraryState);
            }
            if (wsClient?.isConnected()) {
                void loadTemplateLibraryForWebView();
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

        case 'optimizeTextReadClipboardImage':
            await requestOptimizeTextClipboardImage();
            break;

        case 'optimizeTextGenerate':
            await handleGenerateOptimizeText(payload);
            break;

        case 'optimizeTextLoadModels':
            await handleLoadOptimizeTextModels(payload);
            break;

        case 'optimizeTextApply':
            await handleApplyOptimizeText(payload);
            break;

        case 'optimizeTextBack':
            stopOptimizeTextPolling();
            switchToPage('pageMain');
            break;

        case 'imageToImageBack':
            stopImageToImagePolling();
            switchToPage('pageMain');
            break;

        case 'imageToImageRefreshSelection':
            imageToImageLastSelectionSignature = '';
            pollImageToImageSelection();
            break;

        case 'templateLibraryRefresh':
            await loadTemplateLibraryForWebView();
            break;

        case 'templateLibraryAddDir':
            await handleTemplateLibraryAddDir(payload);
            break;

        case 'templateLibraryCreate':
            await handleTemplateLibraryCreate(payload);
            break;

        case 'templateLibrarySelect':
            await handleTemplateLibrarySelect(payload);
            break;

        case 'templateLibraryBrowse':
            await handleTemplateLibraryBrowse(payload);
            break;

        case 'templateLibraryRemove':
            await handleTemplateLibraryRemove(payload);
            break;

        case 'templateLibrarySaveCurrentDoc':
            await handleTemplateLibrarySaveCurrentDoc(payload);
            break;

        case 'templateLibraryImportFiles':
            await handleTemplateLibraryImportFiles(payload);
            break;

        case 'templateLibraryImportSelection':
            await handleTemplateLibraryImportSelection(payload);
            break;

        case 'templateLibraryUpdateAssetTags':
            await handleTemplateLibraryUpdateAssetTags(payload);
            break;

        case 'templateLibraryRenameAsset':
            await handleTemplateLibraryRenameAsset(payload);
            break;

        case 'templateLibraryUndoDelete':
            await handleTemplateLibraryUndoDelete(payload);
            break;

        case 'templateLibraryOpenTemplate':
            await handleTemplateLibraryOpenTemplate(payload);
            break;

        case 'templateLibraryPlaceAsset':
            await handleTemplateLibraryPlaceAsset(payload);
            break;

        case 'templateLibraryDeleteTemplate':
            await handleTemplateLibraryDeleteTemplate(payload);
            break;
            
        case 'inpainting':
            await handleOpenInpaintingPanel();
            break;

        case 'inpaintingGenerate':
            await handleInpaintingGenerate(payload);
            break;

        case 'imageToImage':
            await handleOpenImageToImagePanel();
            break;

        case 'sockLayoutPreview':
            await handleSockLayoutPreview(payload);
            break;

        case 'sockLayoutPickProjectRoot':
            await handleSockLayoutPickProjectRoot();
            break;

        case 'sockLayoutExecute':
            await handleSockLayoutExecute(payload);
            break;

        case 'manualSkuColorCardCheckAvailability':
            await handleManualSkuColorCardCheckAvailability();
            break;

        case 'manualSkuColorCardPickFiles':
            await handleManualSkuColorCardPickFiles();
            break;

        case 'manualSkuColorCardPickOutputFolder':
            await handleManualSkuColorCardPickOutputFolder();
            break;

        case 'manualSkuColorCardExecute':
            await handleManualSkuColorCardExecute(payload);
            break;

        case 'imageToImageGenerate':
            await handleImageToImageGenerate(payload);
            break;

        case 'imageToImageCancel':
            await handleImageToImageCancel();
            break;

        case 'imageToImageApplySelection':
            await handleImageToImageApplySelection(payload);
            break;

        case 'inpaintingApplySelection':
            await handleInpaintingApplySelection(payload);
            break;

        case 'navigate':
            // 允许 WebView 主动请求跳转（虽然通常是 UXP -> Agent，但也支持反向确认）
            sendToWebView('navigate', payload);
            break;
            
        case 'applyRasterImageResult':
            // 应用通用图像结果到 PS 画布
            await handleApplyRasterImageResult(payload);
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
    void loadTemplateLibraryForWebView();
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

function syncWebViewConnectionState(): void {
    const isConnected = wsClient?.isConnected() || false;
    sendToWebView('connectionStatus', {
        connected: isConnected,
        status: isConnected ? 'connected' : 'disconnected'
    });
    sendToWebView('enableActions', { enabled: isConnected });
    if (isConnected) {
        sendToWebView('showMattingInput', {});
    }
}

/**
 * 更新连接状态到 WebView
 */
function updateConnectionStatus() {
    syncWebViewConnectionState();
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

        // 参考形态候选 = 矢量形状图层 + 像素/智能对象图层（按 alpha 轮廓提取）。
        // 用户可直接选一张"标准袜子"图层作为目标形态，无需预先准备矢量形状。
        const referenceOptions = [
            ...shapeLayers.map((l: any) => ({ id: l.id, name: `${l.name}（形状）` })),
            ...productLayers.map((l: any) => ({ id: l.id, name: `${l.name}（图层轮廓）` }))
        ];

        // 发送到 WebView
        sendToWebView('morphLayers', {
            shapeLayers: referenceOptions,
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
    let firstFailureMessage: string | null = null;
    
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
                if (firstFailureMessage == null && error?.message) {
                    firstFailureMessage = error.message;
                }
                console.error(`[DesignEcho] 图层 ${layerNames[i]} 抠图失败:`, error);
            }
        }
        
        // 发送结果
        sendToWebView('mattingResult', { 
            success: successCount > 0, 
            error: successCount > 0 ? undefined : firstFailureMessage || '抠图失败',
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
            sendToWebView('toast', { message: firstFailureMessage || '抠图失败', type: 'error' });
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
        layerId,  // 显式传目标图层，批量循环中不依赖 PS 选中状态
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
            bbox: box,
            outputFormat: outputFormat || 'mask',
            refineEdges: true,
            enableHairRefine: payload?.enableHairRefine !== false,
            enableFabricRefine: payload?.enableFabricRefine !== false,
            quality: payload?.quality || 'balanced',
            targetPrompt: payload?.targetPrompt || ''
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
 * 唯一入口，无回退，无备用路径
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
        .filter((id: number) => !isNaN(id))
        // 参考图层自身不参与变形（把自己变形到自己无意义）
        .filter((id: number) => id !== refShapeId);

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

        const warningMessages: string[] = Array.isArray(result?.warnings)
            ? result.warnings.filter((item: any) => typeof item === 'string' && item.trim())
            : [];

        if (warningMessages.length > 0) {
            console.warn('  预警列表:');
            warningMessages.forEach(msg => console.warn('    ! ' + msg));
        }
        
        if (allSuccess) {
            console.log('  ✓ 全部成功');
            sendToWebView('toast', { 
                message: warningMessages.length > 0
                    ? `形态统一完成，但有 ${warningMessages.length} 项需要复核`
                    : `形态统一完成，成功处理 ${successCount} 个图层`,
                type: warningMessages.length > 0 ? 'warning' : 'success'
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
            if (warningMessages.length > 0) {
                sendToWebView('toast', {
                    message: warningMessages[0],
                    type: 'warning'
                });
            }
        } else {
            console.error('  ✗ 全部失败');
            console.error('  错误列表:');
            errorMessages.forEach(msg => console.error('    - ' + msg));
            
            // 使用第一个具体错误作为提示
            const displayError = errorMessages[0] || warningMessages[0] || '形态统一失败，请检查图层选择';
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
        
        messageHandler.setOnProgressCallback((operation, progress, message, stage) => {
            console.log(`[DesignEcho] 进度: ${operation} ${progress}% - ${message}`);

            if (operation === 'inpaint') {
                sendToWebView('inpaintingProgress', {
                    progress,
                    message: message || '处理中...',
                    stage: stage || ''
                });
                return;
            }

            if (operation === 'image-to-image') {
                sendToWebView('imageToImageProgress', {
                    progress,
                    message: message || '处理中...',
                    stage: stage || ''
                });
                return;
            }

            if (operation === 'remove-background' || operation === 'remove-background-by-selection') {
                sendToWebView('mattingProgress', {
                    progress,
                    message: message || '正在抠图...',
                    stage: stage || ''
                });
                return;
            }

            if (operation === 'manual-sku-color-card') {
                sendToWebView('manualSkuColorCardProgress', {
                    progress,
                    message: message || '正在制作色卡...',
                    stage: stage || ''
                });
                return;
            }

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
                toolRegistry?.getMattingBinaryMaskStore().clear('Agent 连接已断开，二进制蒙版请求已取消');
                notifyAgentDisconnected('正在尝试重新连接...', true);
            }
        );

        // ==================== 设置二进制消息回调（用于接收抠图等图像数据） ====================
        wsClient.setBinaryMessageCallback((header: BinaryHeader, imageData: Uint8Array) => {
            console.log(`[DesignEcho] 收到二进制数据: ${header.type}, requestId=${header.requestId}, ` +
                `${header.width}x${header.height}, ${(imageData.length / 1024).toFixed(1)}KB`);

            // PNG 或 RAW_MASK 类型的二进制数据传递给抠图工具
            if (header.type === BinaryMessageType.PNG || header.type === BinaryMessageType.RAW_MASK) {
                // 单目标与多目标共享一个 take-once Store：只复制一次，由真正的 JSON 请求消费。
                toolRegistry?.getMattingBinaryMaskStore().receive(
                    header.requestId,
                    header.width,
                    header.height,
                    imageData,
                    header.type
                );
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
   * 处理撰写文案
   */
  // 撰写文案页面：选中图层轮询
let optimizeTextPollingTimer: ReturnType<typeof setInterval> | null = null;
let optimizeTextLastLayerId: number | null = null;
let optimizeTextLockedLayerId: number | null = null;
// 当前选中态签名（图层 + 文本内容）。只按 layerId 判重时，用户在 Photoshop 里
// 直接改了同一图层的文字，面板会一直显示旧文本。
let optimizeTextLastSignature = '';
// 替换/生成在途标记：写入期间不要再去读 Photoshop，
// 轮询与 executeAsModal 抢 host 正是"卡一下"的来源。
let optimizeTextBusy = false;
let optimizeTextBusyStartedAt = 0;
// 在途标记的自愈上限：万一某次写入的 Promise 永远不 settle（Photoshop 卡死/文档被强制关闭），
// 也不能让选中态刷新永久停摆——超过这个时间就当作已结束继续刷新。
const OPTIMIZE_TEXT_BUSY_MAX_MS = 60000;

function setOptimizeTextBusy(busy: boolean): void {
    optimizeTextBusy = busy;
    optimizeTextBusyStartedAt = busy ? Date.now() : 0;
}

function isOptimizeTextBusy(): boolean {
    if (!optimizeTextBusy) return false;
    if (Date.now() - optimizeTextBusyStartedAt > OPTIMIZE_TEXT_BUSY_MAX_MS) {
        console.warn('[OptimizeText] 写入在途标记超时未释放，恢复选中态刷新');
        setOptimizeTextBusy(false);
        return false;
    }
    return true;
}
// Photoshop 事件监听（选中变化实时推送）。注册成功后轮询降级为兜底心跳。
let optimizeTextSelectionListener: ((...args: any[]) => void) | null = null;
const OPTIMIZE_TEXT_LISTENER_EVENTS = ['select', 'set', 'delete', 'undo', 'redo'];
let optimizeTextRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let imageToImagePollingTimer: ReturnType<typeof setInterval> | null = null;
let imageToImageLastSelectionSignature = '';
// 置入在途标记：这段时间的选中变化全是插件自己写出来的中间态（先删掉上一次的结果图层、再置入新的），
// 不代表用户改了目标图层。与撰写页同理，写入期间不要去读 Photoshop。
let imageToImageWriteInFlight = false;
let imageToImageWriteStartedAt = 0;
// 与撰写页同一个理由的自愈上限：置入的 Promise 万一永远不 settle，
// 也不能让选中态刷新永久停摆——超过这个时间就当作已结束继续刷新。
const IMAGE_TO_IMAGE_WRITE_MAX_MS = 60000;

function setImageToImageWriteInFlight(inFlight: boolean): void {
    imageToImageWriteInFlight = inFlight;
    imageToImageWriteStartedAt = inFlight ? Date.now() : 0;
}

function isImageToImageWriteInFlight(): boolean {
    if (!imageToImageWriteInFlight) return false;
    if (Date.now() - imageToImageWriteStartedAt > IMAGE_TO_IMAGE_WRITE_MAX_MS) {
        console.warn('[DesignEcho] AI 生图置入在途标记超时未释放，恢复选中态刷新');
        setImageToImageWriteInFlight(false);
        return false;
    }
    return true;
}

/**
 * 事件回调可能一次操作连发几十条（拖动、连续输入都会持续触发 set），
 * 用"尾部去抖"合并：每来一条就重置计时，只在操作停下来之后读一次 Photoshop。
 * 前沿去抖（首条就排一次、期间忽略）在连续操作下会退化成每 120ms 读一次，
 * 比原来的 2.5 秒轮询还费——事件驱动如果不去抖，就是把轮询换成了更快的轮询。
 */
function scheduleOptimizeTextSelectionRefresh(): void {
    if (optimizeTextRefreshTimer) {
        clearTimeout(optimizeTextRefreshTimer);
    }
    optimizeTextRefreshTimer = setTimeout(() => {
        optimizeTextRefreshTimer = null;
        pollOptimizeTextSelection();
    }, 250);
}

async function attachOptimizeTextSelectionListener(): Promise<boolean> {
    try {
        // 本仓的 photoshop 类型声明只覆盖 batchPlay，通知 API 需要按运行时能力探测
        const action: any = require('photoshop').action;
        if (!action?.addNotificationListener) return false;
        const handler = () => scheduleOptimizeTextSelectionRefresh();
        await action.addNotificationListener(
            OPTIMIZE_TEXT_LISTENER_EVENTS.map(event => ({ event })),
            handler
        );
        optimizeTextSelectionListener = handler;
        console.log('[OptimizeText] 已启用 Photoshop 选中事件监听，轮询降为 5s 兜底');
        return true;
    } catch (error) {
        console.warn('[OptimizeText] 选中事件监听注册失败，回退为轮询:', error);
        return false;
    }
}

function detachOptimizeTextSelectionListener(): void {
    if (!optimizeTextSelectionListener) return;
    try {
        const action: any = require('photoshop').action;
        action?.removeNotificationListener?.(
            OPTIMIZE_TEXT_LISTENER_EVENTS.map(event => ({ event })),
            optimizeTextSelectionListener
        );
    } catch (error) {
        console.warn('[OptimizeText] 选中事件监听注销失败:', error);
    }
    optimizeTextSelectionListener = null;
}

function startOptimizeTextPolling() {
    stopOptimizeTextPolling();
    optimizeTextLastLayerId = null;
    optimizeTextLastSignature = '';
    // 立即检测一次
    pollOptimizeTextSelection();
    // 先按兜底心跳起轮询；事件监听注册成功后再把频率降下来。
    optimizeTextPollingTimer = setInterval(pollOptimizeTextSelection, 2500);
    attachOptimizeTextSelectionListener().then(attached => {
        if (!attached || !optimizeTextPollingTimer) return;
        clearInterval(optimizeTextPollingTimer);
        // 事件驱动之后轮询只剩"漏事件"兜底作用，5 秒一次即可
        optimizeTextPollingTimer = setInterval(pollOptimizeTextSelection, 5000);
    });
}

function stopOptimizeTextPolling() {
    if (optimizeTextPollingTimer) {
        clearInterval(optimizeTextPollingTimer);
        optimizeTextPollingTimer = null;
    }
    if (optimizeTextRefreshTimer) {
        clearTimeout(optimizeTextRefreshTimer);
        optimizeTextRefreshTimer = null;
    }
    detachOptimizeTextSelectionListener();
    optimizeTextLastLayerId = null;
    optimizeTextLastSignature = '';
    optimizeTextLockedLayerId = null;
}

function readImageToImageSelectionPayload() {
    const { app } = require('photoshop');
    return buildImageToImageSelectionPayload(app.activeDocument);
}

function pollImageToImageSelection() {
    // 置入进行中不读 Photoshop：此刻选中的是谁都不代表用户的意图。
    // 写完后由 handleImageToImageApplySelection 显式补一次刷新。
    if (isImageToImageWriteInFlight()) return;
    try {
        const payload = readImageToImageSelectionPayload();
        const signature = buildImageToImageSelectionSignature(payload);
        if (signature === imageToImageLastSelectionSignature) {
            return;
        }
        imageToImageLastSelectionSignature = signature;
        // 面板据此判断这次选中变化要不要连带清空候选区：属于本批候选的图层（源图层 / 刚置入的结果图层）
        // 不算换目标，候选必须留着，否则用户点掉一张就再也点不到同批的其他张。
        sendToWebView('imageToImageSelection', {
            ...payload,
            belongsToCandidateRun: isSelectionOwnedByCandidateRun(payload, pendingImageToImageCandidates)
        });
    } catch (error) {
        console.warn('[DesignEcho] Failed to poll image-to-image selection:', error);
    }
}

function startImageToImagePolling() {
    stopImageToImagePolling();
    imageToImageLastSelectionSignature = '';
    pollImageToImageSelection();
    imageToImagePollingTimer = setInterval(pollImageToImageSelection, 1500);
}

function stopImageToImagePolling() {
    if (imageToImagePollingTimer) {
        clearInterval(imageToImagePollingTimer);
        imageToImagePollingTimer = null;
    }
    imageToImageLastSelectionSignature = '';
}

function pollOptimizeTextSelection() {
    // 写入进行中不读 Photoshop：executeAsModal 期间的读取要么排队要么直接失败，
    // 只会让面板看起来"卡住"，写完后会有一次显式刷新补上。
    if (isOptimizeTextBusy()) return;
    try {
        const app = require('photoshop').app;
        const doc = app.activeDocument;
        if (!doc || !doc.activeLayers || doc.activeLayers.length === 0) {
            if (optimizeTextLastSignature !== 'none') {
                optimizeTextLastSignature = 'none';
                optimizeTextLastLayerId = null;
                sendToWebView('optimizeTextSelection', {
                    success: false,
                    preserveSelection: optimizeTextLockedLayerId !== null,
                    selectionState: 'none'
                });
            }
            return;
        }
        const layer = doc.activeLayers[0];
        const layerId = layer.id;

        const { LayerKind } = require('photoshop').constants;
        if (layer.kind !== LayerKind.TEXT) {
            const signature = `non-text:${layerId}:${layer.name || ''}`;
            if (signature === optimizeTextLastSignature) return;
            optimizeTextLastSignature = signature;
            optimizeTextLastLayerId = layerId;
            sendToWebView('optimizeTextSelection', {
                success: false,
                layerName: layer.name || '',
                notText: true,
                preserveSelection: optimizeTextLockedLayerId !== null,
                selectionState: 'non-text'
            });
            return;
        }

        // 文本图层按"图层 + 内容"判重：用户在 Photoshop 里直接改字时，
        // 只比 layerId 会让面板一直显示旧文本，生成时拿的也是旧骨架。
        const selectedText = String(layer.textItem?.contents || '');
        const signature = `text:${layerId}:${selectedText}`;
        if (signature === optimizeTextLastSignature) return;
        optimizeTextLastSignature = signature;
        optimizeTextLastLayerId = layerId;
        optimizeTextLockedLayerId = layerId;
        sendToWebView('optimizeTextSelection', {
            success: true,
            layerId,
            selectedText,
            layerName: layer.name || '',
            selectionState: 'text'
        });
    } catch (e) {
        // 静默忽略，避免轮询报错刷屏
    }
}

async function handleOptimizeText() {
    startOptimizeTextPolling();
}

async function loadOptimizeSelectedTextForWebView() {
    // 手动刷新时强制重新检测
    optimizeTextLastLayerId = null;
    optimizeTextLastSignature = '';
    pollOptimizeTextSelection();
}

async function requestOptimizeTextClipboardImage() {
    if (!wsClient || !wsClient.isConnected()) {
        sendToWebView('optimizeTextImageHintReset', {});
        sendToWebView('toast', { message: '请先连接到 Agent，再读取剪贴板图片', type: 'warning' });
        return;
    }
    try {
        // UXP 的剪贴板 API 只支持文本，图片位图由 Agent(Electron) 主进程代读
        const result = await wsClient.sendRequest('read-clipboard-image', {}, 15000);
        const base64 = String(result?.base64 || '').trim();
        if (!result?.success || !base64) {
            sendToWebView('optimizeTextImageHintReset', {});
            sendToWebView('toast', { message: result?.error || '剪贴板中没有可用的图片', type: 'warning' });
            return;
        }
        sendToWebView('optimizeTextImageCaptured', {
            base64,
            mimeType: String(result?.mimeType || 'image/jpeg'),
            source: 'clipboard',
            width: Number(result?.width) || 0,
            height: Number(result?.height) || 0
        });
        sendToWebView('toast', { message: '已使用剪贴板图片作为参考', type: 'success' });
    } catch (error: any) {
        sendToWebView('optimizeTextImageHintReset', {});
        sendToWebView('toast', { message: error?.message || '读取剪贴板图片失败', type: 'error' });
    }
}

/**
 * 读取当前 Agent 模型，供 Photoshop 面板如实展示实际执行身份。
 */
async function handleLoadOptimizeTextModels(payload: any) {
    const query = String(payload?.query || '');
    if (!wsClient || !wsClient.isConnected()) {
        sendToWebView('optimizeTextModelOptions', {
            success: false,
            query,
            error: '未连接到 Agent，暂时读不到模型清单'
        });
        return;
    }
    try {
        const result = await wsClient.sendRequest('list-copywriting-models', { query }, 15000);
        sendToWebView('optimizeTextModelOptions', { ...(result || {}), query });
    } catch (error: any) {
        sendToWebView('optimizeTextModelOptions', {
            success: false,
            query,
            error: error?.message || '读取模型清单失败'
        });
    }
}

async function handleGenerateOptimizeText(payload: any) {
    if (!wsClient || !wsClient.isConnected()) {
        sendToWebView('toast', { message: '请先连接到 Agent', type: 'warning' });
        return;
    }
    if (!toolRegistry) {
        sendToWebView('toast', { message: '工具未初始化', type: 'warning' });
        return;
    }
    const textTool = toolRegistry.getTool('getTextContent');
    if (!textTool) {
        sendToWebView('toast', { message: '文本工具未找到', type: 'warning' });
        return;
    }
    sendToWebView('showLoading', { text: '正在读取文本图层...' });
    try {
        const selected = await textTool.execute(optimizeTextLockedLayerId ? { layerId: optimizeTextLockedLayerId } : {});
        if (!selected?.success || !selected?.layerId) {
            sendToWebView('hideLoading', {});
            sendToWebView('toast', { message: selected?.error || '请先在 Photoshop 手动选中一个文本图层', type: 'warning' });
            return;
        }
        // 参考图只用用户自己选的（粘贴 / 本地图片 / 读剪贴板）。
        // 不再自动截当前画面：那张图未必是这句文案对应的画面，还要多花一次
        // Photoshop 导出和几秒等待，模型看不了图时更是白做。
        sendToWebView('updateLoading', { text: '正在提交撰写请求...' });
        const originalContent = String(selected?.content || '');
        // Photoshop 回读的换行是裸 \r，用 /\r?\n/ 切会把两行文案当成一行上报，
        // 提示词里就会出现"骨架 2 行 / 约束说单行"的自相矛盾，模型自然写成一行。
        const lines = originalContent.split(/\r\n|\r|\n/);
        const charCount = originalContent.replace(/[\r\n]/g, '').length;
        const result = await wsClient.sendRequest('optimize-text', {
            text: originalContent,
            layerId: selected?.layerId,
            count: 3,
            creativeStyle: String(payload?.creativeStyle || 'natural'),
            targetAudience: String(payload?.targetAudience || '').trim(),
            contentType: String(payload?.contentType || 'auto'),
            copyRole: String(payload?.copyRole || 'auto'),
            forbiddenKeywords: String(payload?.forbiddenKeywords || ''),
            description: String(payload?.description || '').trim(),
            // 本句要表达的重点（功能卖点/表达方向），决定这一句的任务
            keyMessage: String(payload?.keyMessage || '').trim(),
            revisionNote: String(payload?.revisionNote || '').trim(),
            feedbackTags: Array.isArray(payload?.feedbackTags) ? payload.feedbackTags : [],
            goals: Array.isArray(payload?.goals) ? payload.goals : [],
            maxChars: Number(payload?.maxChars) || undefined,
            image: payload?.image || null,
            imageSource: payload?.image ? String(payload?.imageSource || 'manual') : 'none',
            charCount,
            lineCount: lines.length,
            lineCharCounts: lines.map(l => l.length)
        }, 120000);
        sendToWebView('hideLoading', {});
        if (result?.success) {
            sendToWebView('optimizeTextCandidates', result);
            if (result?.imageIgnored && result?.imageIgnoredReason) {
                // 视觉诚实：模型看不到参考图时必须让用户知道，否则用户会以为文案是照着图写的。
                // 只在成功路径提示：失败时错误 toast 已经说明真因，再叠一条 warning 会盖住它。
                sendToWebView('toast', { message: String(result.imageIgnoredReason), type: 'warning' });
            }
            if (result?.degraded) {
                // 用 Agent 侧按实际候选形态生成的精确提示，不再一律说"部分有偏差"
                const degradedMessage = String(result?.degradedMessage || '部分候选与原版式有偏差，替换前请核对候选卡上的提示');
                sendToWebView('toast', { message: degradedMessage, type: 'warning' });
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
    if (!toolRegistry) {
        sendToWebView('toast', { message: '工具未初始化', type: 'warning' });
        return;
    }
    // 同一时间只允许一次写入：连点两张候选卡会开出两个 executeAsModal，
    // Photoshop 侧互斥后表现就是"点了没反应/卡住"，而且哪一版最终落地不可预测。
    if (isOptimizeTextBusy()) {
        sendToWebView('toast', { message: '正在替换上一版文案，请等这次写入完成', type: 'warning' });
        return;
    }
    const setTextTool = toolRegistry.getTool('setTextContent');
    if (!setTextTool) {
        sendToWebView('toast', { message: '文本工具未找到', type: 'warning' });
        return;
    }
    const layerId = Number(payload?.layerId);
    const content = typeof payload?.content === 'string' ? String(payload.content).replace(/\r\n/g, '\n').replace(/\r/g, '\n') : '';
    const baselineContent = typeof payload?.baselineContent === 'string'
        ? String(payload.baselineContent).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
        : '';
    if (!layerId || content.length === 0) {
        sendToWebView('toast', { message: '请先选择候选文案', type: 'warning' });
        return;
    }
    // 不再拉全屏遮罩：替换是几百毫秒级操作，遮罩一闪反而像卡了一下；
    // 候选卡自身的"替换中..."状态已经把进度说清楚，而且不会因为漏掉一条
    // hideLoading 就把整个面板锁住。
    setOptimizeTextBusy(true);
    const applyStartedAt = Date.now();
    try {
        const result = await setTextTool.execute({ layerId, content, baselineContent });
        // 留一条耗时线索：下次再说"替换很慢"时可以直接从日志读到真实毫秒数，
        // 不用再靠感觉判断慢在哪一段。
        console.log(`[OptimizeText] 替换写入耗时 ${Date.now() - applyStartedAt}ms（图层 ${layerId}）`);
        if (result?.success) {
            sendToWebView('optimizeTextApplied', { layerId, content, data: result || null });
            sendToWebView('toast', { message: '文案已替换', type: 'success' });
        } else {
            sendToWebView('toast', { message: result?.error || '替换失败', type: 'error' });
        }
    } catch (error: any) {
        sendToWebView('toast', { message: error?.message || '替换失败', type: 'error' });
    } finally {
        // 必须先解除在途标记再回读，否则回读会被自己的守卫挡掉，
        // 面板就停在替换前的文本上。
        setOptimizeTextBusy(false);
    }
    // 回读一次真实图层内容作为落地确认（此时已无 modal 竞争）；
    // 失败路径也回读，让面板显示 Photoshop 里实际的样子而不是我们以为的样子。
    await loadOptimizeSelectedTextForWebView();
}

function getTemplateLibraryLastStatePayload(): any {
    return templateLibraryStateCoordinator.getLastState();
}

function emitTemplateLibraryState(result: any, overrides?: Record<string, any>): void {
    templateLibraryStateCoordinator.emitState(result, overrides);
}

function queueTemplateLibraryDetailRefresh(result: any, libraryIdHint = '', relativePathHint = ''): void {
    templateLibraryStateCoordinator.queueDetailRefresh(result, libraryIdHint, relativePathHint);
}

async function loadTemplateLibraryForWebView(): Promise<void> {
    return templateLibraryStateCoordinator.loadForWebView();
}

async function exportTemplateLibrarySelectionToTempFile(
    doc: any,
    orderedLayers: any[],
    unionBounds: { left: number; top: number; right: number; bottom: number },
    exportBaseName: string
): Promise<{
    extension: 'psd' | 'psb';
    filePath: string;
    previewBase64?: string;
}> {
    const uxpStorage = require('uxp').storage;
    const tempLocalFs = uxpStorage.localFileSystem;
    const tempFolderEntry = await tempLocalFs.getTemporaryFolder();
    const tempFolderPath = String(tempFolderEntry?.nativePath || '').trim().replace(/[\\/]+$/, '');
    if (!tempFolderPath) {
        throw new Error('Failed to resolve the temporary folder for design asset export.');
    }

    // 设计库导出走 UXP 原生链路（design-asset-export.ts）：按图层对象逐层复制进
    // 并集尺寸的临时小文档再保存。不做整文档 duplicate、不依赖选中状态、
    // 不经 ExtendScript——拖拽落下的瞬间跑 ExtendScript 会"JavaScript 代码丢失"空返回。
    const tempFileBaseName = sanitizeTemplateLibraryAssetFileName(exportBaseName || doc?.name || 'design-asset');
    const fileBaseName = `${tempFileBaseName}-${Date.now()}`;
    const previewFileName = `designecho-design-asset-preview-${Date.now()}.jpg`;
    const previewFilePath = `${tempFolderPath}/${previewFileName}`;
    let exportedFilePath = '';
    let keepExportedFile = false;

    try {
        const exportResult = await exportSelectedLayersAsDesignAsset({
            sourceDocument: doc,
            orderedLayers,
            unionBounds,
            targetFolder: tempFolderEntry,
            fileBaseName,
            previewFileName,
            assetName: exportBaseName || doc?.name || 'design-asset',
            previewMaxDimension: TEMPLATE_LIBRARY_PREVIEW_MAX_DIMENSION,
            jpegQuality: TEMPLATE_LIBRARY_PREVIEW_JPEG_QUALITY
        });
        exportedFilePath = String(exportResult.filePath || '').trim();
        if (!exportedFilePath) {
            throw new Error('Failed to resolve the exported design asset file path.');
        }

        let previewBase64: string | undefined;
        try {
            const previewEntry: any = await getEntryFromPath(tempLocalFs, exportResult.previewFilePath || previewFilePath);
            const previewData = await previewEntry.read({ format: uxpStorage.formats.binary });
            const previewByteArray = previewData instanceof Uint8Array ? previewData : new Uint8Array(previewData);
            if (previewByteArray.length > 0) {
                previewBase64 = `data:image/jpeg;base64,${templateLibraryUint8ArrayToBase64(previewByteArray, TEMPLATE_LIBRARY_MAX_PREVIEW_EXPORT_BYTES)}`;
            }
        } catch (previewError) {
            console.warn('[DesignLibrary] Failed to export asset preview:', previewError);
        }

        keepExportedFile = true;
        return {
            filePath: exportedFilePath,
            extension: exportResult.format,
            previewBase64
        };
    } finally {
        if (!keepExportedFile && exportedFilePath) {
            await cleanupTemplateLibraryTempFile(exportedFilePath);
        }
        await cleanupTemplateLibraryTempFile(previewFilePath);
    }
}

async function exportActiveSelectionToTemplateLibraryAsset(): Promise<{
    name: string;
    filePath: string;
    previewBase64?: string;
    extension: 'psd' | 'psb';
}> {
    const { app } = require('photoshop');
    const doc = app.activeDocument;
    if (!doc) {
        throw new Error('\u8bf7\u5148\u6253\u5f00 Photoshop \u6587\u6863\u3002');
    }

    const selectedLayers = Array.from(doc.activeLayers || []);
    if (selectedLayers.length === 0) {
        throw new Error('\u8bf7\u5148\u9009\u62e9\u81f3\u5c11\u4e00\u4e2a\u56fe\u5c42\u540e\u518d\u5bfc\u5165\u8bbe\u8ba1\u5e93\u3002');
    }

    let unionBounds: { left: number; top: number; right: number; bottom: number } | null = null;

    for (const layer of selectedLayers) {
        const bounds = getTemplateLibraryLayerBounds(layer);
        if (!hasTemplateLibraryVisibleBounds(bounds)) {
            continue;
        }

        if (!unionBounds) {
            unionBounds = {
                left: Number(bounds.left || 0),
                top: Number(bounds.top || 0),
                right: Number(bounds.right || 0),
                bottom: Number(bounds.bottom || 0)
            };
            continue;
        }

        unionBounds.left = Math.min(unionBounds.left, Number(bounds.left || 0));
        unionBounds.top = Math.min(unionBounds.top, Number(bounds.top || 0));
        unionBounds.right = Math.max(unionBounds.right, Number(bounds.right || 0));
        unionBounds.bottom = Math.max(unionBounds.bottom, Number(bounds.bottom || 0));
    }

    if (!unionBounds || !hasTemplateLibraryVisibleBounds(unionBounds)) {
        throw new Error('\u5f53\u524d\u9009\u4e2d\u5185\u5bb9\u6ca1\u6709\u53ef\u5bfc\u51fa\u7684\u53ef\u89c1\u533a\u57df\u3002');
    }

    const orderedLayerIds = collectTemplateLibraryLayerIdsInStackOrder(doc, selectedLayers);
    if (orderedLayerIds.length === 0) {
        throw new Error('\u5bfc\u51fa\u9009\u4e2d\u56fe\u5c42\u5931\u8d25\uff1a\u5728\u5f53\u524d\u6587\u6863\u7684\u56fe\u5c42\u6811\u91cc\u6ca1\u6709\u627e\u5230\u9009\u4e2d\u7684\u56fe\u5c42\u3002\u8bf7\u91cd\u65b0\u9009\u62e9\u56fe\u5c42\u540e\u518d\u8bd5\u3002');
    }
    const selectedLayerById = new Map<number, any>();
    for (const layer of selectedLayers) {
        const layerId = Math.floor(Number((layer as any)?.id));
        if (Number.isSafeInteger(layerId) && layerId > 0) {
            selectedLayerById.set(layerId, layer);
        }
    }
    const orderedLayers = orderedLayerIds
        .map(layerId => selectedLayerById.get(layerId))
        .filter(Boolean);

    const exportBaseName = getTemplateLibrarySelectionBaseName(doc, selectedLayers);

    const exportedSelection = await exportTemplateLibrarySelectionToTempFile(
        doc,
        orderedLayers,
        unionBounds,
        exportBaseName
    );

    return {
        name: exportBaseName,
        filePath: exportedSelection.filePath,
        previewBase64: exportedSelection.previewBase64,
        extension: exportedSelection.extension
    };
}

async function cleanupTemplateLibraryTempFile(filePath: string): Promise<void> {
    const targetPath = String(filePath || '').trim();
    if (!targetPath) {
        return;
    }
    try {
        const uxpStorage = require('uxp').storage;
        const localFs = uxpStorage.localFileSystem;
        const entry: any = await getEntryFromPath(localFs, targetPath);
        if (entry?.delete) {
            await entry.delete();
        }
    } catch (error) {
        console.warn('[DesignLibrary] Failed to cleanup temp export file:', error);
    }
}

async function resolveTemplateLibraryEntryByRelativePath(
    folderEntry: any,
    relativePath: string
): Promise<any> {
    const segments = normalizeTemplateLibraryRelativePath(relativePath).split('/').filter(Boolean);
    let currentEntry: any = folderEntry;
    for (const segment of segments) {
        if (!currentEntry?.getEntries) {
            throw new Error(`Cannot traverse entry: ${relativePath}`);
        }
        const entries = await currentEntry.getEntries();
        const nextEntry = entries.find((entry: any) => String(entry?.name || '') === segment);
        if (!nextEntry) {
            throw new Error(`Entry not found in library: ${relativePath}`);
        }
        currentEntry = nextEntry;
    }
    return currentEntry;
}

async function resolveTemplateLibraryFileToken(payload: any): Promise<string> {
    const uxpStorage = require('uxp').storage;
    const localFs = uxpStorage.localFileSystem;

    const libraryId = String(payload?.libraryId || '').trim();
    const dirPath = String(payload?.dirPath || '').trim();
    let dirToken = String(payload?.dirToken || '').trim();
    const relativePath = normalizeTemplateLibraryRelativePath(String(payload?.relativePath || ''));
    let resolvedRelativePath = relativePath;
    let resolvedFilePath = String(payload?.filePath || '').trim();

    if (libraryId && relativePath && wsClient?.isConnected()) {
        try {
            const assetInfo = await wsClient.sendRequest('template-library:getAssetFileInfo', {
                libraryId,
                relativePath
            }, 120000);
            const candidateFilePath = String(assetInfo?.filePath || '').trim();
            if (candidateFilePath) {
                resolvedFilePath = candidateFilePath;
            }
            const candidateRelativePath = normalizeTemplateLibraryRelativePath(String(assetInfo?.resolvedRelativePath || ''));
            if (candidateRelativePath) {
                resolvedRelativePath = candidateRelativePath;
            }
        } catch (error) {
            console.warn('[TemplateLibrary] Failed to resolve asset file info from Agent:', error);
        }
    }

    if (dirToken && resolvedRelativePath) {
        try {
            const folderEntry: any = await localFs.getEntryForPersistentToken(dirToken);
            const fileEntry = await resolveTemplateLibraryEntryByRelativePath(folderEntry, resolvedRelativePath);
            if (fileEntry) {
                return await localFs.createSessionToken(fileEntry);
            }
        } catch (error) {
            console.warn('[TemplateLibrary] Failed to resolve asset by persistent token:', error);
            dirToken = '';
        }
    }

    if (!dirToken && dirPath) {
        try {
            const folderEntry = await getEntryFromPath(localFs, dirPath);
            dirToken = await localFs.createPersistentToken(folderEntry);

            if (libraryId && wsClient?.isConnected()) {
                try {
                    const syncResult = await wsClient.sendRequest('template-library:addLocalLibraryDir', {
                        libraryId,
                        dir: dirPath,
                        dirToken
                    }, 120000);
                    emitTemplateLibraryState(syncResult);
                    queueTemplateLibraryDetailRefresh(syncResult, libraryId);
                } catch (syncError) {
                    console.warn('[TemplateLibrary] Failed to sync recovered dirToken:', syncError);
                }
            }
        } catch (error) {
            console.warn('[TemplateLibrary] Failed to recover library access from dirPath:', error);
        }
    }

    if (dirToken && resolvedRelativePath) {
        const folderEntry: any = await localFs.getEntryForPersistentToken(dirToken);
        const fileEntry = await resolveTemplateLibraryEntryByRelativePath(folderEntry, resolvedRelativePath);
        return await localFs.createSessionToken(fileEntry);
    }

    const filePath = resolvedFilePath || String(payload?.filePath || '').trim();
    if (!filePath) {
        throw new Error(dirPath ? '当前设计库需要重新授权目录后才能打开或置入资源' : '缺少资源路径');
    }

    const fileEntry = await getEntryFromPath(localFs, filePath);
    if (!fileEntry) {
        throw new Error(`无法访问资源文件: ${filePath}`);
    }
    return await localFs.createSessionToken(fileEntry);
}

async function handleTemplateLibraryBrowse(payload: any) {
    if (!wsClient || !wsClient.isConnected()) {
        sendToWebView('toast', { message: '请先连接到 Agent', type: 'warning' });
        return;
    }

    const libraryId = String(payload?.libraryId || '').trim();
    if (!libraryId) {
        sendToWebView('toast', { message: '请先选择设计库', type: 'warning' });
        return;
    }

    try {
        const result = await wsClient.sendRequest('template-library:browse', {
            libraryId,
            relativePath: String(payload?.relativePath || '')
        }, 120000);
        emitTemplateLibraryState(result);
    } catch (error: any) {
        sendToWebView('toast', { message: error?.message || '打开目录失败', type: 'error' });
    }
}

async function handleTemplateLibraryCreate(payload: any) {
    const name = String(payload?.name || '').trim();
    if (!name) {
        sendToWebView('toast', { message: '请先输入设计库名称', type: 'warning' });
        return;
    }

    if (!wsClient || !wsClient.isConnected()) {
        sendToWebView('toast', { message: '请先连接到 Agent', type: 'warning' });
        return;
    }

    try {
        const uxpStorage = require('uxp').storage;
        const localFs = uxpStorage.localFileSystem;
        const selectedFolder = await localFs.getFolder();
        if (!selectedFolder?.nativePath) {
            return;
        }
        const dirToken = await localFs.createPersistentToken(selectedFolder as any);

        sendToWebView('showLoading', { text: '正在创建设计库...' });
        const result = await wsClient.sendRequest('template-library:createLibrary', {
            name,
            dir: selectedFolder.nativePath,
            dirToken
        }, 120000);
        sendToWebView('hideLoading', {});
        emitTemplateLibraryState(result);
        queueTemplateLibraryDetailRefresh(result);
        sendToWebView('toast', { message: '设计库已创建', type: 'success' });
    } catch (error: any) {
        sendToWebView('hideLoading', {});
        sendToWebView('toast', { message: error?.message || '创建设计库失败', type: 'error' });
    }
}

async function handleTemplateLibraryAddDir(payload: any) {
    try {
        const uxpStorage = require('uxp').storage;
        const localFs = uxpStorage.localFileSystem;
        const selectedFolder = await localFs.getFolder();
        if (!selectedFolder?.nativePath) {
            return;
        }
        const dirToken = await localFs.createPersistentToken(selectedFolder as any);

        if (!wsClient || !wsClient.isConnected()) {
            sendToWebView('toast', { message: '请先连接到 Agent', type: 'warning' });
            return;
        }

        const libraryId = String(payload?.libraryId || '').trim();
        if (!libraryId) {
            sendToWebView('toast', { message: '请先选择设计库', type: 'warning' });
            return;
        }

        sendToWebView('showLoading', { text: '正在保存设计库目录...' });
        const result = await wsClient.sendRequest('template-library:addLocalLibraryDir', {
            libraryId,
            dir: selectedFolder.nativePath,
            dirToken
        }, 120000);
        sendToWebView('hideLoading', {});
        if (result?.cancelled) {
            return;
        }
        emitTemplateLibraryState(result);
        queueTemplateLibraryDetailRefresh(result);
        sendToWebView('toast', { message: '已更新设计库目录', type: 'success' });
    } catch (error: any) {
        sendToWebView('hideLoading', {});
        sendToWebView('toast', { message: error?.message || '添加目录失败', type: 'error' });
    }
}

async function handleTemplateLibrarySelect(payload: any) {
    if (!wsClient || !wsClient.isConnected()) {
        sendToWebView('toast', { message: '请先连接到 Agent', type: 'warning' });
        return;
    }

    const id = String(payload?.id || '').trim();
    if (!id) {
        sendToWebView('toast', { message: '缺少设计库 ID', type: 'warning' });
        return;
    }

    try {
        const result = await wsClient.sendRequest('template-library:setActiveLibrary', { id }, 120000);
        emitTemplateLibraryState(result);
        queueTemplateLibraryDetailRefresh(result, id);
    } catch (error: any) {
        sendToWebView('toast', { message: error?.message || '切换设计库失败', type: 'error' });
    }
}

async function handleTemplateLibraryRemove(payload: any) {
    if (!wsClient || !wsClient.isConnected()) {
        sendToWebView('toast', { message: '请先连接到 Agent', type: 'warning' });
        return;
    }

    const id = String(payload?.id || '').trim();
    if (!id) {
        sendToWebView('toast', { message: '缺少设计库 ID', type: 'warning' });
        return;
    }

    try {
        const result = await wsClient.sendRequest('template-library:removeLibrary', { id }, 120000);
        emitTemplateLibraryState(result);
        queueTemplateLibraryDetailRefresh(result);
        sendToWebView('toast', { message: '设计库已移除', type: 'success' });
    } catch (error: any) {
        sendToWebView('toast', { message: error?.message || '移除设计库失败', type: 'error' });
    }
}

async function handleTemplateLibrarySaveCurrentDoc(payload: any) {
    if (!wsClient || !wsClient.isConnected()) {
        sendToWebView('toast', { message: '请先连接到 Agent', type: 'warning' });
        return;
    }
    if (!toolRegistry) {
        sendToWebView('toast', { message: '工具未初始化', type: 'error' });
        return;
    }

    const listTool = toolRegistry.getTool('listDocuments');
    if (!listTool) {
        sendToWebView('toast', { message: '文档工具未找到', type: 'error' });
        return;
    }

    sendToWebView('showLoading', { text: '正在保存当前文档到设计库...' });
    try {
        const docsResult = await listTool.execute({ includeDetails: true });
        const docs = Array.isArray((docsResult as any)?.documents) ? (docsResult as any).documents : [];
        const activeDoc = docs.find((doc: any) => doc?.isActive) || docs[0];

        if (!activeDoc?.name) {
            throw new Error('当前没有可用的 Photoshop 文档');
        }

        const tags = Array.isArray(payload?.tags)
            ? payload.tags
            : String(payload?.tags || '')
                .split(/[,，]/)
                .map((item: string) => item.trim())
                .filter(Boolean);

        const result = await wsClient.sendRequest('template-library:addFromPhotoshop', {
            libraryId: String(payload?.libraryId || '').trim(),
            documentName: activeDoc.name,
            documentPath: activeDoc.path,
            description: String(payload?.description || '').trim(),
            tags
        }, 120000);

        const snapshotTool = toolRegistry.getTool('getCanvasSnapshot');
        const templateId = String(result?.template?.id || '').trim();
        if (snapshotTool && templateId) {
            try {
                const snapshotResult = await snapshotTool.execute({ maxSize: 512, format: 'jpeg', quality: 75 });
                const base64 = String(snapshotResult?.snapshot?.base64 || '').trim();
                if (base64) {
                    await wsClient.sendRequest('template-library:setThumbnail', {
                        id: templateId,
                        thumbnailBase64: `data:image/jpeg;base64,${base64}`
                    }, 120000);
                }
            } catch (thumbError) {
                console.warn('[DesignLibrary] Failed to capture template thumbnail:', thumbError);
            }
        }

        sendToWebView('hideLoading', {});
        sendToWebView('toast', {
            message: result?.template?.name ? `已保存文档：${result.template.name}` : '当前文档已加入设计库',
            type: 'success'
        });
        emitTemplateLibraryState(result);
        queueTemplateLibraryDetailRefresh(result);
    } catch (error: any) {
        sendToWebView('hideLoading', {});
        sendToWebView('toast', { message: error?.message || '保存当前文档失败', type: 'error' });
    }
}

async function handleTemplateLibraryImportFiles(payload: any) {
    if (!wsClient || !wsClient.isConnected()) {
        sendToWebView('toast', { message: '请先连接到 Agent', type: 'warning' });
        return;
    }

    const libraryId = String(payload?.libraryId || '').trim();
    // Design library now uses a single flat asset flow rooted at the library directory.
    const relativePath = '';
    if (!libraryId) {
        sendToWebView('toast', { message: '请先选择设计库', type: 'warning' });
        return;
    }

    try {
        const uxpStorage = require('uxp').storage;
        const localFs = uxpStorage.localFileSystem;
        const droppedFiles = Array.isArray(payload?.droppedFiles) ? payload.droppedFiles : [];
        let filePaths = Array.isArray(payload?.filePaths)
            ? payload.filePaths.map((item: any) => String(item || '').trim()).filter(Boolean)
            : [];

        if (filePaths.length === 0 && droppedFiles.length === 0) {
            const picked = await localFs.getFileForOpening({
                allowMultiple: true,
                types: ['psd', 'psb', 'tif', 'tiff', 'png', 'jpg', 'jpeg', 'webp', 'svg', 'txt']
            } as any);

            const pickedEntries = Array.isArray(picked) ? picked : (picked ? [picked] : []);
            filePaths = pickedEntries
                .map((entry: any) => String(entry?.nativePath || '').trim())
                .filter(Boolean);
        }

        if (filePaths.length === 0 && droppedFiles.length === 0) {
            return;
        }

        sendToWebView('showLoading', { text: '正在导入设计资产...' });
        let result: any;
        let importedCount = 0;

        if (filePaths.length > 0) {
            result = await wsClient.sendRequest('template-library:importFiles', {
                libraryId,
                relativePath,
                filePaths,
                detailLevel: 'summary'
            }, 120000);
            importedCount += Array.isArray(result?.imported) ? result.imported.length : filePaths.length;
        }

        if (droppedFiles.length > 0) {
            for (const item of droppedFiles) {
                const name = String(item?.name || '').trim();
                const extension = String(item?.extension || '').trim().replace(/^\./, '').toLowerCase();
                const textContent = typeof item?.textContent === 'string' ? item.textContent : '';
                const dataUrl = typeof item?.dataUrl === 'string' ? item.dataUrl : '';
                if (!name || !extension) {
                    continue;
                }

                if (textContent && extension === 'txt') {
                    result = await wsClient.sendRequest('template-library:importTextAsset', {
                        libraryId,
                        relativePath,
                        name,
                        content: textContent,
                        detailLevel: 'summary'
                    }, 120000);
                    importedCount += 1;
                    continue;
                }

                const base64Data = dataUrl.includes('base64,')
                    ? dataUrl.slice(dataUrl.indexOf('base64,') + 'base64,'.length)
                    : dataUrl;
                if (!base64Data) {
                    continue;
                }
                if (base64Data.length > TEMPLATE_LIBRARY_MAX_BINARY_BASE64_LENGTH) {
                    throw new Error(`Design asset "${name}" is too large for in-memory import. Please import it as a file path.`);
                }

                result = await wsClient.sendRequest('template-library:importBinaryAsset', {
                    libraryId,
                    relativePath,
                    name,
                    base64Data,
                    extension,
                    detailLevel: 'summary'
                }, 120000);
                importedCount += 1;
            }

            if (!result || importedCount === 0) {
                throw new Error('没有导入任何可识别的设计资产');
            }
        }

        sendToWebView('hideLoading', {});
        emitTemplateLibraryState(result);
        queueTemplateLibraryDetailRefresh(result, libraryId, relativePath);
        sendToWebView('toast', { message: `已导入 ${importedCount} 个资产`, type: 'success' });
    } catch (error: any) {
        sendToWebView('hideLoading', {});
        sendToWebView('toast', { message: getTemplateLibraryErrorMessage(error, '导入文件失败'), type: 'error' });
    }
}

async function handleTemplateLibraryImportSelection(payload: any) {
    if (!wsClient || !wsClient.isConnected()) {
        sendToWebView('toast', { message: '\u8bf7\u5148\u8fde\u63a5\u5230 Agent\u3002', type: 'warning' });
        return;
    }

    const libraryId = String(payload?.libraryId || '').trim();
    // Always import current Photoshop selection into the library root.
    const relativePath = '';
    if (!libraryId) {
        sendToWebView('toast', { message: '\u8bf7\u5148\u9009\u62e9\u4e00\u4e2a\u8bbe\u8ba1\u5e93\u3002', type: 'warning' });
        return;
    }

    let tempExportFilePath = '';
    try {
        sendToWebView('showLoading', { text: '\u6b63\u5728\u5bfc\u5165\u5f53\u524d\u9009\u4e2d...' });
        const exported = await exportActiveSelectionToTemplateLibraryAsset();
        tempExportFilePath = String(exported.filePath || '').trim();

        const result = await wsClient.sendRequest('template-library:importFiles', {
            libraryId,
            relativePath,
            filePaths: [exported.filePath],
            fileMetas: [{
                filePath: exported.filePath,
                displayName: exported.name
            }],
            detailLevel: 'summary'
        }, 120000);
        const importedRelativePath = String(result?.imported?.[0]?.relativePath || '').trim();

        let previewPersistPromise: Promise<any> | null = null;
        if (importedRelativePath && exported.previewBase64) {
            previewPersistPromise = wsClient.sendRequest('template-library:setAssetPreview', {
                libraryId,
                relativePath: importedRelativePath,
                currentRelativePath: relativePath,
                previewBase64: exported.previewBase64,
                detailLevel: 'summary'
            }, 120000).catch((previewError: any) => {
                console.warn('[DesignLibrary] Failed to save imported asset preview:', previewError);
                return null;
            });
        } else if (!exported.previewBase64) {
            console.warn('[DesignLibrary] Imported asset without preview image:', exported.name);
        }

        sendToWebView('hideLoading', {});
        emitTemplateLibraryState(
            result,
            buildOptimisticTemplateLibraryImportOverrides(
                getTemplateLibraryLastStatePayload(),
                libraryId,
                importedRelativePath,
                exported
            )
        );
        if (previewPersistPromise) {
            void previewPersistPromise.finally(() => {
                queueTemplateLibraryDetailRefresh(result, libraryId, relativePath);
            });
        } else {
            queueTemplateLibraryDetailRefresh(result, libraryId, relativePath);
        }
        sendToWebView('toast', {
            message: '\u5df2\u5bfc\u5165\u5f53\u524d\u9009\u4e2d',
            type: 'success'
        });
    } catch (error: any) {
        sendToWebView('hideLoading', {});
        sendToWebView('toast', { message: getTemplateLibraryErrorMessage(error, '\u5bfc\u5165\u5f53\u524d\u9009\u4e2d\u5931\u8d25'), type: 'error' });
    } finally {
        if (tempExportFilePath) {
            await cleanupTemplateLibraryTempFile(tempExportFilePath);
        }
    }
}

async function handleTemplateLibraryRenameAsset(payload: any) {
    if (!wsClient || !wsClient.isConnected()) {
        sendToWebView('toast', { message: '请先连接到 Agent。', type: 'warning' });
        return;
    }

    const libraryId = String(payload?.libraryId || '').trim();
    const relativePath = normalizeTemplateLibraryRelativePath(String(payload?.relativePath || ''));
    const name = String(payload?.name || '').trim();
    if (!libraryId || !relativePath) {
        sendToWebView('toast', { message: '缺少要重命名的设计库资产。', type: 'warning' });
        return;
    }
    if (!name) {
        sendToWebView('toast', { message: '请输入新的资产名称。', type: 'warning' });
        return;
    }

    try {
        sendToWebView('showLoading', { text: '正在重命名资产...' });
        const result = await wsClient.sendRequest('template-library:renameAsset', {
            libraryId,
            relativePath,
            name,
            detailLevel: 'summary'
        }, 120000);
        sendToWebView('hideLoading', {});
        emitTemplateLibraryState(result);
        queueTemplateLibraryDetailRefresh(result, libraryId, '');
        sendToWebView('toast', { message: '资产已重命名', type: 'success' });
    } catch (error: any) {
        sendToWebView('hideLoading', {});
        sendToWebView('toast', { message: getTemplateLibraryErrorMessage(error, '重命名资产失败'), type: 'error' });
    }
}

async function handleTemplateLibraryUndoDelete(payload: any) {
    if (!wsClient || !wsClient.isConnected()) {
        sendToWebView('toast', { message: '请先连接到 Agent', type: 'warning' });
        return;
    }

    try {
        const result = await wsClient.sendRequest('template-library:undoDelete', {
            libraryId: String(payload?.libraryId || '').trim(),
            relativePath: normalizeTemplateLibraryRelativePath(String(payload?.relativePath || ''))
        }, 120000);
        emitTemplateLibraryState(result);
        queueTemplateLibraryDetailRefresh(
            result,
            String(payload?.libraryId || '').trim(),
            normalizeTemplateLibraryRelativePath(String(payload?.relativePath || ''))
        );
        sendToWebView('toast', { message: result?.restored ? '已恢复最近删除的资产' : '没有可撤销的删除', type: result?.restored ? 'success' : 'warning' });
    } catch (error: any) {
        sendToWebView('toast', { message: error?.message || '撤销删除失败', type: 'error' });
    }
}

async function handleTemplateLibraryUpdateAssetTags(payload: any) {
    if (!wsClient || !wsClient.isConnected()) {
        sendToWebView('toast', { message: '请先连接到 Agent', type: 'warning' });
        return;
    }

    const libraryId = String(payload?.libraryId || '').trim();
    const relativePath = normalizeTemplateLibraryRelativePath(String(payload?.relativePath || ''));
    const tags = Array.isArray(payload?.tags) ? payload.tags : [];
    if (!libraryId || !relativePath) {
        sendToWebView('toast', { message: '缺少要更新标签的素材', type: 'warning' });
        return;
    }

    try {
        const result = await wsClient.sendRequest('template-library:updateAssetTags', {
            libraryId,
            relativePath,
            tags
        }, 120000);
        emitTemplateLibraryState(result);
        queueTemplateLibraryDetailRefresh(result, libraryId, '');
        sendToWebView('toast', { message: '标签已更新', type: 'success' });
    } catch (error: any) {
        sendToWebView('toast', { message: error?.message || '更新标签失败', type: 'error' });
    }
}

async function handleTemplateLibraryOpenTemplate(payload: any) {
    const relativePath = normalizeTemplateLibraryRelativePath(String(payload?.relativePath || ''));
    const displayPath = relativePath || String(payload?.name || '').trim() || 'asset.psd';
    if (!displayPath) {
        sendToWebView('toast', { message: '缺少资产路径', type: 'warning' });
        return;
    }

    if (String(payload?.assetType || '') === 'text') {
        sendToWebView('toast', { message: '文案资产不支持打开文件，请直接置入到文档', type: 'warning' });
        return;
    }

    sendToWebView('showLoading', { text: '正在打开设计资产...' });
    try {
        const fileToken = await resolveTemplateLibraryFileToken(payload);
        const openTool = toolRegistry?.getTool('openTemplate');
        const result = openTool
            ? await openTool.execute({ psdPath: displayPath, fileToken })
            : { success: false, error: 'Open tool not found' };

        sendToWebView('hideLoading', {});
        if (result?.success) {
            sendToWebView('toast', {
                message: result?.data?.message || '设计资产已打开',
                type: 'success'
            });
        } else {
            sendToWebView('toast', {
                message: result?.error || '无法直接打开设计资产，请确认文件路径和权限',
                type: 'error'
            });
        }
    } catch (error: any) {
        sendToWebView('hideLoading', {});
        sendToWebView('toast', {
            message: error?.message || '打开设计资产失败，请检查文件路径和权限',
            type: 'error'
        });
    }
}

async function handleTemplateLibraryPlaceAsset(payload: any) {
    if (!toolRegistry) {
        sendToWebView('toast', { message: '工具未初始化', type: 'error' });
        return;
    }

    const relativePath = normalizeTemplateLibraryRelativePath(String(payload?.relativePath || ''));
    if (!relativePath) {
        sendToWebView('toast', { message: '缺少资产路径', type: 'warning' });
        return;
    }

    if (String(payload?.assetType || '') === 'text') {
        if (!wsClient || !wsClient.isConnected()) {
            sendToWebView('toast', { message: '请先连接到 Agent', type: 'warning' });
            return;
        }

        const createTextLayerTool = toolRegistry.getTool('createTextLayer');
        if (!createTextLayerTool) {
            sendToWebView('toast', { message: '文本置入工具不可用', type: 'error' });
            return;
        }

        try {
            sendToWebView('showLoading', { text: '正在置入文案资产...' });
            const asset = await wsClient.sendRequest('template-library:readTextAsset', {
                libraryId: String(payload?.libraryId || '').trim(),
                relativePath
            });
            const { app } = require('photoshop');
            const doc = app.activeDocument;
            if (!doc) {
                throw new Error('请先打开 Photoshop 文档');
            }
            const x = Math.max(48, Math.round(Number(doc.width || 0) * 0.12));
            const y = Math.max(48, Math.round(Number(doc.height || 0) * 0.12));
            const result = await createTextLayerTool.execute({
                content: String(asset?.content || ''),
                x,
                y,
                fontSize: 24
            });
            sendToWebView('hideLoading', {});
            if (result?.success) {
                sendToWebView('toast', { message: '文案资产已置入当前文档', type: 'success' });
            } else {
                sendToWebView('toast', { message: result?.error || '置入文案资产失败', type: 'error' });
            }
        } catch (error: any) {
            sendToWebView('hideLoading', {});
            sendToWebView('toast', { message: error?.message || '置入文案资产失败', type: 'error' });
        }
        return;
    }

    const placeTool = toolRegistry.getTool('placeImage');
    if (!placeTool) {
        sendToWebView('toast', { message: '置入工具不可用', type: 'error' });
        return;
    }

    sendToWebView('showLoading', { text: '正在置入设计资产...' });
    try {
        const fileToken = await resolveTemplateLibraryFileToken(payload);
        const result = await placeTool.execute({
            fileToken,
            name: String(payload?.name || '').trim() || undefined,
            center: false
        });
        sendToWebView('hideLoading', {});
        if (result?.success) {
            sendToWebView('toast', { message: result?.data?.message || '设计资产已置入当前文档', type: 'success' });
        } else {
            sendToWebView('toast', { message: result?.error || '置入设计资产失败', type: 'error' });
        }
    } catch (error: any) {
        sendToWebView('hideLoading', {});
        sendToWebView('toast', { message: error?.message || '置入设计资产失败，请检查文件路径和权限', type: 'error' });
    }
}

async function handleTemplateLibraryDeleteTemplate(payload: any) {
    if (!wsClient || !wsClient.isConnected()) {
        sendToWebView('toast', { message: '请先连接到 Agent', type: 'warning' });
        return;
    }

    const id = String(payload?.id || '').trim();
    const relativePath = normalizeTemplateLibraryRelativePath(String(payload?.relativePath || ''));
    const libraryId = String(payload?.libraryId || '').trim();
    const currentRelativePath = normalizeTemplateLibraryRelativePath(String(payload?.currentRelativePath || ''));
    const browseRelativePath = currentRelativePath || getTemplateLibraryParentRelativePath(relativePath);
    if (!id && !relativePath) {
        sendToWebView('toast', { message: '缺少要删除的资产', type: 'warning' });
        return;
    }

    try {
        const result = await wsClient.sendRequest('template-library:deleteTemplate', {
            id,
            libraryId,
            relativePath,
            currentRelativePath: browseRelativePath
        });
        emitTemplateLibraryState(result);
        queueTemplateLibraryDetailRefresh(
            result,
            libraryId,
            browseRelativePath
        );
        sendToWebView('toast', { message: '资产已删除', type: 'success' });
        if (result?.undoAvailable) {
            sendToWebView('templateLibraryUndoAvailable', {
                message: '资产已删除，可撤销'
            });
        }
    } catch (error: any) {
        sendToWebView('toast', { message: error?.message || '删除资产失败', type: 'error' });
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
 * 把面板 payload 转成 sockLayoutConfig 工具参数（预览与执行共用同一构造，保证两边看到同一份计划）。
 */
function buildSockLayoutConfigToolParams(payload: any): Record<string, any> {
    const qualityValue = Number(payload?.quality ?? 12);
    const usesCombos = payload?.comboText !== undefined || Array.isArray(payload?.combos);
    const toolParams: Record<string, any> = {
        action: 'buildPlan',
        projectRoot: String(payload?.projectRoot || '').trim(),
        outputPattern: String(payload?.outputPattern || '').trim() || '%模板%/%文件序号%%素材%',
        quality: Number.isFinite(qualityValue) ? Math.max(1, Math.min(12, Math.round(qualityValue))) : 12,
        autoAdjustQuality: payload?.autoAdjustQuality === true,
        targetSizeMb: payload?.targetSizeMb
    };

    if (usesCombos) {
        // 组合优先路径：只传颜色组合与可选模板覆盖，不带旧版 CSV。
        toolParams.comboText = String(payload?.comboText || '');
        if (Array.isArray(payload?.combos)) toolParams.combos = payload.combos;
        const templateName = String(payload?.templateName || '').trim();
        if (templateName) toolParams.templateName = templateName;
        if (Array.isArray(payload?.availableTemplates)) toolParams.availableTemplates = payload.availableTemplates;
    } else {
        // 旧版双 CSV 兼容路径。
        toolParams.layoutCsvText = String(payload?.layoutCsvText || '');
        toolParams.colorCsvText = String(payload?.colorCsvText || '');
    }
    return toolParams;
}

/**
 * 处理袜子排版配置预览。
 *
 * 这里复用 UXP 工具层的 sockLayoutConfig，只做只读解析和阻塞项展示；
 * 真正 Photoshop 写入由 handleSockLayoutExecute 走 skuLayout 执行链路。
 */
async function handleSockLayoutPreview(payload: any) {
    const requestId = payload?.requestId;
    try {
        if (!messageHandler) {
            toolRegistry = toolRegistry || new ToolRegistry();
            messageHandler = new MessageHandler(toolRegistry);
        }

        const result = await messageHandler.handleToolCall('sockLayoutConfig', buildSockLayoutConfigToolParams(payload));

        sendToWebView('sockLayoutPreviewResult', {
            requestId,
            success: result?.success !== false,
            error: result?.error,
            data: result?.data || null
        });
    } catch (error: any) {
        console.error('[DesignEcho] Sock layout preview error:', error);
        sendToWebView('sockLayoutPreviewResult', {
            requestId,
            success: false,
            error: `袜子排版配置解析失败：${error?.message || String(error)}`,
            data: null
        });
    }
}

function fileNameWithoutExtension(filePath: string): string {
    const normalized = String(filePath || '').replace(/\\/g, '/');
    const fileName = normalized.slice(normalized.lastIndexOf('/') + 1);
    return fileName.replace(/\.[^.]+$/, '').trim() || '未命名颜色';
}

async function handleManualSkuColorCardPickFiles(): Promise<void> {
    try {
        const localFs = require('uxp').storage.localFileSystem;
        const picked = await localFs.getFileForOpening({
            allowMultiple: true,
            types: ['jpg', 'jpeg', 'png', 'tif', 'tiff', 'psd', 'psb', 'webp']
        } as any);
        const entries = Array.isArray(picked) ? picked : (picked ? [picked] : []);
        const sources = entries
            .map((entry: any) => String(entry?.nativePath || '').trim())
            .filter(Boolean)
            .map((filePath: string) => ({
                filePath,
                name: filePath.replace(/\\/g, '/').split('/').pop() || filePath,
                colorName: fileNameWithoutExtension(filePath)
            }));
        sendToWebView('manualSkuColorCardFilesSelected', { success: true, sources });
    } catch (error: any) {
        sendToWebView('manualSkuColorCardFilesSelected', {
            success: false,
            error: `选择商品图片失败：${error?.message || String(error)}`
        });
    }
}

async function handleManualSkuColorCardPickOutputFolder(): Promise<void> {
    try {
        const localFs = require('uxp').storage.localFileSystem;
        const selectedFolder = await localFs.getFolder();
        sendToWebView('manualSkuColorCardOutputFolderSelected', {
            success: true,
            path: String(selectedFolder?.nativePath || '')
        });
    } catch (error: any) {
        sendToWebView('manualSkuColorCardOutputFolderSelected', {
            success: false,
            error: `选择输出目录失败：${error?.message || String(error)}`
        });
    }
}

let manualSkuColorCardInFlight = false;
let manualSkuColorCardAvailabilityPromise: Promise<boolean> | null = null;
const MANUAL_SKU_COLOR_CARD_BRIDGE_VERSION = 'manual-sku-color-card-bridge/v2';
const MANUAL_SKU_COLOR_CARD_RESULT_VERSION = 'manual-sku-color-card-result/v2';
const MANUAL_SKU_COLOR_CARD_OUTDATED_MESSAGE = '当前运行的 DesignEcho Agent 尚未加载色卡制作后端。请完全退出并重新启动 DesignEcho Agent；仅刷新 UXP 面板无效。';

function manualSkuColorCardErrorMessage(error: any): string {
    if (error instanceof JsonRpcRequestError && error.rpcCode === -32601) {
        return MANUAL_SKU_COLOR_CARD_OUTDATED_MESSAGE;
    }
    return error?.message || '无法确认统一色卡执行器是否就绪。';
}

function manualSkuColorCardConnectionLost(error: any): boolean {
    if (!wsClient || !wsClient.isConnected()) return true;
    const message = String(error?.message || '');
    return message.includes('连接已断开') || message.includes('WebSocket 未连接');
}

async function resolveManualSkuColorCardAvailability(): Promise<boolean> {
    if (!wsClient || !wsClient.isConnected()) {
        sendToWebView('manualSkuColorCardAvailability', {
            available: false,
            state: 'disconnected',
            reason: '尚未连接 DesignEcho Agent，无法使用统一色卡执行器。'
        });
        return false;
    }

    try {
        const status = await wsClient.sendRequest('manual-sku-color-card:status', {}, 10000);
        const compatible = status?.version === MANUAL_SKU_COLOR_CARD_BRIDGE_VERSION;
        const available = compatible && status?.available === true;
        let state = String(status?.state || 'unavailable');
        let reason = String(status?.reason || '');
        if (!compatible) {
            state = 'unsupported';
            reason = MANUAL_SKU_COLOR_CARD_OUTDATED_MESSAGE;
        } else if (available) {
            state = 'ready';
            reason = '';
        }
        sendToWebView('manualSkuColorCardAvailability', {
            available,
            state,
            version: String(status?.version || ''),
            modes: Array.isArray(status?.modes) ? status.modes : [],
            reason
        });
        return available;
    } catch (error: any) {
        if (error instanceof JsonRpcRequestError && error.rpcCode === -32601) {
            sendToWebView('manualSkuColorCardAvailability', {
                available: false,
                state: 'unsupported',
                reason: MANUAL_SKU_COLOR_CARD_OUTDATED_MESSAGE
            });
            return false;
        }
        if (manualSkuColorCardConnectionLost(error)) {
            sendToWebView('manualSkuColorCardAvailability', {
                available: false,
                state: 'disconnected',
                reason: '与 DesignEcho Agent 的连接已断开。'
            });
            return false;
        }

        // status 是辅助诊断，不应因一次传输超时把真实执行能力误判成不支持。
        sendToWebView('manualSkuColorCardAvailability', {
            available: true,
            state: 'unknown',
            reason: '暂时无法确认执行器状态；点击生成时会由主进程再次验证。'
        });
        return true;
    }
}

function queryManualSkuColorCardAvailability(): Promise<boolean> {
    if (manualSkuColorCardAvailabilityPromise) return manualSkuColorCardAvailabilityPromise;
    const pending = resolveManualSkuColorCardAvailability();
    manualSkuColorCardAvailabilityPromise = pending;
    const clearPending = (): void => {
        if (manualSkuColorCardAvailabilityPromise === pending) {
            manualSkuColorCardAvailabilityPromise = null;
        }
    };
    void pending.then(clearPending, clearPending);
    return pending;
}

async function handleManualSkuColorCardCheckAvailability(): Promise<void> {
    await queryManualSkuColorCardAvailability();
}

async function handleManualSkuColorCardExecute(payload: any): Promise<void> {
    if (manualSkuColorCardInFlight) {
        sendToWebView('toast', { message: '已有一个手动色卡任务正在执行', type: 'warning' });
        return;
    }
    if (!wsClient || !wsClient.isConnected()) {
        sendToWebView('manualSkuColorCardAvailability', {
            available: false,
            state: 'disconnected',
            reason: '尚未连接 DesignEcho Agent，无法使用统一色卡执行器。'
        });
        sendToWebView('manualSkuColorCardResult', {
            success: false,
            errorCode: 'connection_lost',
            error: '尚未连接 DesignEcho Agent，无法启动统一色卡执行器。'
        });
        return;
    }

    const sources = Array.isArray(payload?.sources)
        ? payload.sources
            .map((source: any) => ({
                filePath: String(source?.filePath || '').trim(),
                colorName: String(source?.colorName || '').trim(),
                colorNameSource: 'provided'
            }))
            .filter((source: any) => source.filePath && source.colorName)
        : [];
    const outputFolder = String(payload?.outputFolder || '').trim();
    const outputPath = String(payload?.outputPath || '').trim();
    if (sources.length === 0 || !outputFolder || !outputPath) {
        sendToWebView('manualSkuColorCardResult', {
            success: false,
            errorCode: 'invalid_request',
            error: '请先选择商品图片、确认颜色名，并选择输出目录。'
        });
        return;
    }

    manualSkuColorCardInFlight = true;
    try {
        const available = await queryManualSkuColorCardAvailability();
        if (!available) {
            sendToWebView('manualSkuColorCardResult', {
                success: false,
                errorCode: 'bridge_unavailable',
                error: '统一色卡执行器尚未就绪。请按页面提示重新检测。'
            });
            return;
        }

        const result = await wsClient.sendRequest('manual-sku-color-card:execute', {
            version: 'manual-sku-color-card-request/v1',
            mode: payload?.mode === 'ins' ? 'ins' : 'studio',
            sources,
            outputFolder,
            outputPath,
            showIndexNumbers: payload?.showIndexNumbers !== false,
            columns: payload?.columns
        }, 16 * 60 * 1000);
        const normalizedResult = result || {
            success: false,
            errorCode: 'execution_failed',
            error: '统一色卡执行器没有返回结果。'
        };
        if (normalizedResult?.version !== MANUAL_SKU_COLOR_CARD_RESULT_VERSION) {
            sendToWebView('manualSkuColorCardAvailability', {
                available: false,
                state: 'unsupported',
                reason: MANUAL_SKU_COLOR_CARD_OUTDATED_MESSAGE
            });
            sendToWebView('manualSkuColorCardResult', {
                version: MANUAL_SKU_COLOR_CARD_RESULT_VERSION,
                success: false,
                errorCode: 'bridge_unavailable',
                error: MANUAL_SKU_COLOR_CARD_OUTDATED_MESSAGE
            });
            return;
        }
        if (normalizedResult?.errorCode === 'bridge_unavailable') {
            sendToWebView('manualSkuColorCardAvailability', {
                available: false,
                state: 'starting',
                reason: normalizedResult.error || '统一色卡执行器尚未就绪。'
            });
        }
        sendToWebView('manualSkuColorCardResult', normalizedResult);
    } catch (error: any) {
        const connectionLost = manualSkuColorCardConnectionLost(error);
        if (connectionLost) {
            sendToWebView('manualSkuColorCardAvailability', {
                available: false,
                state: 'disconnected',
                reason: '与 DesignEcho Agent 的连接已断开。'
            });
        }
        sendToWebView('manualSkuColorCardResult', {
            success: false,
            errorCode: connectionLost ? 'connection_lost' : 'execution_failed',
            error: connectionLost
                ? '连接在任务期间断开，结果未知。请先检查 Photoshop 文档和输出文件，避免立即重复执行。'
                : manualSkuColorCardErrorMessage(error)
        });
    } finally {
        manualSkuColorCardInFlight = false;
    }
}

/**
 * 袜子排版：弹出原生目录选择器挑选项目根目录，免手敲路径。
 * 用户取消时回传空 path，面板保持现有值不动。
 */
async function handleSockLayoutPickProjectRoot() {
    try {
        const uxpStorage = require('uxp').storage;
        const localFs = uxpStorage.localFileSystem;
        const selectedFolder = await localFs.getFolder();
        sendToWebView('sockLayoutPickProjectRootResult', {
            success: true,
            path: String(selectedFolder?.nativePath || '')
        });
    } catch (error: any) {
        console.error('[DesignEcho] Sock layout pick project root error:', error);
        sendToWebView('sockLayoutPickProjectRootResult', {
            success: false,
            error: `选择项目目录失败：${error?.message || String(error)}`
        });
    }
}

// 袜子排版执行互斥：同一时刻只允许一个批量任务，防止两批交错操作同一批文档。
let sockLayoutExecuteInFlight = false;

/**
 * 袜子排版一键执行：解析计划 → 打开素材/模板文档 → 逐组合调 skuLayout 导出。
 *
 * 纪律照抄 sku-batch 执行器（不是可优化项）：
 * - 每组合一次 skuLayout 调用：工具每次收尾会关闭模板文档，拆小调用防超时后 PS 继续裸跑；
 * - skuDocName / templateDocName 显式传：activeDocument 兜底会把任意文档当模板；
 * - modal state 等 1.8s 重试一次；占位符结构失配时跳过该模板剩余组合。
 */
async function handleSockLayoutExecute(payload: any) {
    const requestId = payload?.requestId;
    const sendExecuteResult = (result: Record<string, any>) => {
        sendToWebView('sockLayoutExecuteResult', { requestId, ...result });
    };
    const failEarly = (error: string) => {
        sendExecuteResult({ success: false, error, errors: [error], exportedCount: 0, groups: [] });
    };

    if (sockLayoutExecuteInFlight) {
        failEarly('已有一个袜子排版任务正在执行，请等它完成后再开始新任务。');
        return;
    }
    sockLayoutExecuteInFlight = true;

    try {
        if (!messageHandler) {
            toolRegistry = toolRegistry || new ToolRegistry();
            messageHandler = new MessageHandler(toolRegistry);
        }

        // 1. 执行前在 UXP 端重新解析：单一事实源，不信任面板缓存的旧计划。
        const planResult = await messageHandler.handleToolCall('sockLayoutConfig', buildSockLayoutConfigToolParams(payload));
        const plan = planResult?.data;
        if (planResult?.success === false || !plan || plan.status !== 'ready') {
            const blockers = Array.isArray(plan?.blockers) && plan.blockers.length > 0
                ? plan.blockers
                : [planResult?.error || '配置解析失败'];
            failEarly(`配置未通过解析，无法执行：\n${blockers.join('\n')}`);
            return;
        }

        const outputDir = String(plan.paths?.outputDir || '').trim();
        if (!outputDir) {
            failEarly('未能推断输出目录：请填写项目路径（例如 E:/项目/C-1021），输出目录固定为 项目/SKU。');
            return;
        }
        const rawGroups = Array.isArray(plan.templateGroups) ? plan.templateGroups : [];
        if (rawGroups.length === 0) {
            failEarly('解析结果没有可执行的模板分组。');
            return;
        }

        // 组内去重：相同组合的输出文件同名（执行层每次调用独立命名，跨调用不加序号，后写覆盖前写），
        // 只保留首次出现的组合，结果里明示每组跳过了多少重复。
        const groups = rawGroups.map((group: any) => {
            const combos: string[][] = Array.isArray(group.combos) ? group.combos : [];
            const items: any[] = Array.isArray(group.items) ? group.items : [];
            const seen = new Set<string>();
            const deduped: string[][] = [];
            const dedupedItems: any[] = [];
            let skippedDuplicates = 0;
            combos.forEach((combo, comboIndex) => {
                const key = combo.join('+');
                if (seen.has(key)) {
                    skippedDuplicates += 1;
                    return;
                }
                seen.add(key);
                deduped.push(combo);
                if (items[comboIndex]) dedupedItems.push(items[comboIndex]);
            });
            return { ...group, combos: deduped, items: dedupedItems, skippedDuplicates };
        });

        const quality = Number(plan.quality?.quality || 12);
        const totalCombos = groups.reduce((sum: number, g: any) => sum + (Array.isArray(g.combos) ? g.combos.length : 0), 0);
        const { app } = require('photoshop');

        const findOpenDocName = (predicate: (name: string) => boolean): string | null => {
            for (let i = 0; i < app.documents.length; i++) {
                const name = String(app.documents[i]?.name || '');
                if (name && predicate(name)) return name;
            }
            return null;
        };
        const emitProgress = (groupIndex: number, current: number, message: string) => {
            sendToWebView('sockLayoutExecuteProgress', {
                requestId,
                groupIndex,
                groupCount: groups.length,
                current,
                total: totalCombos,
                message
            });
        };

        // 2. 确保 SKU 素材文档打开。优先级：精确文件名匹配已打开文档 → 按约定路径打开（项目/PSD/SKU.psb）
        //    → 最后才按名字关键词兜底。关键词兜底必须放最后：名字含 "sku/素材" 的文档不一定是颜色素材源，
        //    明知正确路径时先开正确文件，避免静默用错源导出"成功"的错误产物。
        const skuSourcePath = String(plan.paths?.skuSourcePath || '').trim();
        const skuFileName = skuSourcePath ? (skuSourcePath.split('/').pop() || '') : '';
        let skuDocName = skuFileName ? findOpenDocName((n) => n === skuFileName) : null;
        let skuOpenError = '';
        if (!skuDocName && skuSourcePath) {
            emitProgress(0, 0, `正在打开 SKU 素材：${skuFileName}`);
            try {
                const opened = await openDocumentWithJsx(skuSourcePath);
                skuDocName = opened.documentName;
            } catch (error: any) {
                skuOpenError = String(error?.message || error);
            }
        }
        if (!skuDocName) {
            skuDocName = findOpenDocName((n) => /sku|素材/i.test(n));
        }
        if (!skuDocName) {
            failEarly(skuOpenError
                ? `打开 SKU 素材失败（${skuSourcePath}）：${skuOpenError}。请确认文件存在，或先在 Photoshop 手动打开素材文件。`
                : '未找到 SKU 素材文档：请先在 Photoshop 打开 SKU 素材文件（名称含「SKU」或「素材」），或填写项目路径以便自动打开 项目/PSD/SKU.psb。');
            return;
        }

        // 模板重开辅助：skuLayout 每次调用收尾会关闭模板文档，所以每个组合执行前都要确保模板打开。
        const templateDir = String(plan.paths?.templateDir || '').trim();
        const ensureTemplateOpen = async (group: any): Promise<string> => {
            const fileName = String(group.templateFileName || '').trim();
            const templateName = String(group.templateName || '').trim();
            const openName = (fileName ? findOpenDocName((n) => n === fileName) : null)
                || (templateName ? findOpenDocName((n) => n.replace(/\.[^.]+$/, '') === templateName) : null);
            if (openName) return openName;
            if (group.matchedRealTemplate === false || !templateDir || !/\.[a-z0-9]+$/i.test(fileName)) {
                throw new Error(`模板「${templateName || fileName || '未命名'}」未打开且未在模板目录找到对应文件。请把模板文件放入 ${templateDir || '项目/模板文件'} 目录，或先在 Photoshop 打开该模板。`);
            }
            const opened = await openDocumentWithJsx(`${templateDir}/${fileName}`);
            return opened.documentName;
        };

        // 3. 逐组、逐组合执行。
        let done = 0;
        let exportedCount = 0;
        const allErrors: string[] = [];
        const groupSummaries: Array<Record<string, any>> = [];

        for (let gi = 0; gi < groups.length; gi++) {
            const group = groups[gi];
            const combos: string[][] = Array.isArray(group.combos) ? group.combos : [];
            const isNote = group.mode === 'self_select_note';
            let groupExported = 0;
            const groupErrors: string[] = [];

            for (let ci = 0; ci < combos.length; ci++) {
                const combo = combos[ci];
                done += 1;
                emitProgress(gi + 1, done, `${group.templateName || '模板'} · ${combo.join('+')}`);

                let templateDocName: string;
                try {
                    templateDocName = await ensureTemplateOpen(group);
                } catch (error: any) {
                    groupErrors.push(String(error?.message || error));
                    break; // 模板打不开是结构性失败，跳过整组避免逐组合重复报错
                }

                const size = Number(group.size || combo.length) || combo.length;
                const configuredRegions = Array.isArray(group.items?.[ci]?.regions)
                    ? group.items[ci].regions
                    : [];
                const regionCapacities = configuredRegions
                    .map((region: unknown) => Array.isArray(region) ? region.length : 0)
                    .filter((capacity: number) => capacity > 0);
                const toolParams: Record<string, any> = isNote
                    ? {
                        action: 'arrangeDynamic',
                        combos: [combo],
                        skuDocName,
                        templateDocName,
                        regionCapacities: regionCapacities.length > 0 ? regionCapacities : undefined,
                        outputDir,
                        outputFormat: 'jpg',
                        quality,
                        // 自选备注每组合导出一个文件：首个无后缀，其后 -2/-3 防同名覆盖（面板预览同规则展示）
                        noteFilePrefix: `${size}双自选备注${ci > 0 ? `-${ci + 1}` : ''}`
                    }
                    : {
                        action: 'execute',
                        combos: [combo],
                        skuDocName,
                        templateDocName,
                        outputDir,
                        outputFormat: 'jpg',
                        quality,
                        autoLayoutWithoutPlaceholders: false
                    };

                let result = await messageHandler.handleToolCall('skuLayout', toolParams);
                // modal state 是真机常态：等待释放后重试一次（与 sku-batch 执行器同款）
                if (result?.success === false && /host is in a modal state/i.test(String(result?.error || ''))) {
                    await new Promise((resolve) => setTimeout(resolve, 1800));
                    result = await messageHandler.handleToolCall('skuLayout', toolParams);
                }

                const resultData = result?.data || {};
                const comboExported = Number(resultData.exportedCount || 0);
                exportedCount += comboExported;
                groupExported += comboExported;
                if (result?.success === false || comboExported === 0) {
                    const comboErrors = Array.isArray(resultData.errors) && resultData.errors.length > 0
                        ? resultData.errors
                        : [result?.error || '未知原因'];
                    comboErrors.forEach((err: any) => groupErrors.push(`${group.templateName} · ${combo.join('+')}: ${err}`));
                    // 占位符结构不匹配是结构性失败：同组后续组合必然同样失败，跳过整组
                    if (Array.isArray(resultData.placeholderMismatches) && resultData.placeholderMismatches.length > 0) {
                        const remaining = combos.length - ci - 1;
                        if (remaining > 0) {
                            groupErrors.push(`模板「${group.templateName}」占位符与颜色数不匹配，已跳过该模板剩余 ${remaining} 个组合。`);
                        }
                        break;
                    }
                }
            }

            allErrors.push(...groupErrors);
            groupSummaries.push({
                templateName: group.templateName,
                mode: group.mode,
                exportedCount: groupExported,
                skippedDuplicates: Number(group.skippedDuplicates || 0),
                errors: groupErrors
            });
        }

        sendExecuteResult({
            success: exportedCount > 0 && allErrors.length === 0,
            exportedCount,
            outputDir,
            errors: allErrors,
            groups: groupSummaries
        });
    } catch (error: any) {
        console.error('[DesignEcho] Sock layout execute error:', error);
        failEarly(`袜子排版执行失败：${error?.message || String(error)}`);
    } finally {
        sockLayoutExecuteInFlight = false;
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

async function handleOpenImageToImagePanel() {
    if (!wsClient || !wsClient.isConnected()) {
        sendToWebView('toast', { message: '请先连接到 Agent', type: 'warning' });
        return;
    }

    try {
        const { app } = require('photoshop');
        const doc = app.activeDocument;
        if (!doc) {
            sendToWebView('toast', { message: '请先打开一个 Photoshop 文档', type: 'warning' });
            return;
        }

        const selectionPayload = readImageToImageSelectionPayload();

        sendToWebView('navigate', {
            view: 'imageToImage',
            payload: {
                ...selectionPayload
            }
        });
        startImageToImagePolling();
    } catch (error: any) {
        console.error('[DesignEcho] Open image-to-image panel error:', error);
        sendToWebView('toast', {
            message: error?.message || '打开图生图面板失败',
            type: 'error'
        });
    }
}

/**
 * 应用通用图像结果
 */
async function handleApplyRasterImageResult(payload: any) {
    const { imageData } = payload;

    if (!imageData) {
        sendToWebView('toast', { message: '没有图像数据', type: 'error' });
        return;
    }

    try {
        sendToWebView('showLoading', { text: '应用结果到画布...' });
        const result = await executeApplyRasterImageResult(payload);
        sendToWebView('hideLoading', {});
        
        if (result.success) {
            sendToWebView('toast', { message: '已创建新图层', type: 'success' });
            sendToWebView('inpaintingApplied', {
                layerId: result.layerId || null,
                layerName: result.layerName || payload.layerName || '局部重绘结果'
            });
            // 强制刷新画布以显示结果
            await forceRefreshCanvas();
        } else {
            sendToWebView('toast', { message: result.error || '应用失败', type: 'error' });
        }
        
    } catch (error: any) {
        console.error('[DesignEcho] Apply raster image error:', error);
        sendToWebView('hideLoading', {});
        sendToWebView('toast', { 
            message: error.message || '应用失败',
            type: 'error'
        });
    }
}

async function executeApplyRasterImageResult(payload: {
    imageData: string;
    filePath?: string;
    imageBytes?: Uint8Array;
    imageFormat?: string;
    isRawRgba?: boolean;
    layerName?: string;
    width?: number;
    height?: number;
    placementWidth?: number;
    placementHeight?: number;
    originalWidth?: number;
    originalHeight?: number;
    targetBounds?: { left?: number; top?: number };
}) {
    if (!toolRegistry) throw new Error('工具未初始化');

    const base64Length = typeof payload.imageData === 'string' ? payload.imageData.length : 0;
    console.log('[DesignEcho] executeApplyRasterImageResult start:', {
        hasFilePath: typeof payload.filePath === 'string' && payload.filePath.length > 0,
        hasImageBytes: payload.imageBytes instanceof Uint8Array,
        isRawRgba: payload.isRawRgba === true,
        width: payload.width,
        height: payload.height,
        placementWidth: payload.placementWidth,
        placementHeight: payload.placementHeight,
        originalWidth: payload.originalWidth,
        originalHeight: payload.originalHeight,
        targetBounds: payload.targetBounds || null,
        imageFormat: payload.imageFormat || null,
        base64Length
    });

    const applyTool = toolRegistry.getTool('applyRasterImageResult');
    if (!applyTool) throw new Error('未找到应用工具');

    const result = await applyTool.execute({
        imageData: payload.imageData,
        filePath: payload.filePath,
        imageBytes: payload.imageBytes,
        imageFormat: payload.imageFormat,
        isRawRgba: payload.isRawRgba === true,
        layerName: payload.layerName || '局部重绘结果',
        width: payload.width,
        height: payload.height,
        placementWidth: payload.placementWidth,
        placementHeight: payload.placementHeight,
        originalWidth: payload.originalWidth,
        originalHeight: payload.originalHeight,
        targetBounds: payload.targetBounds
    });

    console.log('[DesignEcho] executeApplyRasterImageResult result:', result);
    return result;
}

async function executeApplyImageToImageResult(payload: {
    imageData: string;
    filePath?: string;
    imageFormat?: string;
    width?: number;
    height?: number;
    placementWidth?: number;
    placementHeight?: number;
    originalWidth?: number;
    originalHeight?: number;
    targetBounds?: { left?: number; top?: number };
    layerName?: string;
}) {
    return executeApplyRasterImageResult({
        imageData: payload.imageData,
        filePath: payload.filePath,
        imageFormat: payload.imageFormat,
        isRawRgba: false,
        width: payload.width,
        height: payload.height,
        placementWidth: payload.placementWidth,
        placementHeight: payload.placementHeight,
        originalWidth: payload.originalWidth,
        originalHeight: payload.originalHeight,
        targetBounds: payload.targetBounds,
        layerName: payload.layerName || '图生图结果'
    });
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

        // SSOT：始终在生成前从 Photoshop 原子抓取最新选区快照，忽略 WebView 缓存像素
        if (!toolRegistry) {
            throw new Error('工具未初始化，无法获取选区');
        }
        const getMaskTool = toolRegistry.getTool('getSelectionMask');
        if (!getMaskTool) {
            throw new Error('未找到获取选区工具');
        }
        // 不再由用户选"清晰度"：捕获窗按选区圈定并保持原图分辨率，
        // 上限只受模型出图能力约束，与文档尺寸无关。
        const maskResult = await getMaskTool.execute({ includeImage: true });
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

        // 用 OpenRouter models API 里真实存在的 id（不带日期后缀）。带日期的写法会被
        // OpenRouter 宽松匹配解析回本体，image_config 在那条路径上会被丢弃。
        const selectedModel = payload?.model || 'google/gemini-3-pro-image-preview';
        let imageBinaryMeta: { requestId: number; width: number; height: number } | null = null;
        let maskBinaryMeta: { requestId: number; width: number; height: number } | null = null;

        if (maskResult.imageFormat === 'raw' && image) {
            const imageBytes = base64ToUint8Array(image);
            const requestId = wsClient.allocBinaryRequestId();
            wsClient.sendBinaryData(
                BinaryMessageType.RAW_RGBA,
                requestId,
                maskResult.width,
                maskResult.height,
                imageBytes
            );
            imageBinaryMeta = {
                requestId,
                width: maskResult.width,
                height: maskResult.height
            };
            console.log('[DesignEcho] Sent inpainting RAW_RGBA binary frame:', {
                requestId,
                width: maskResult.width,
                height: maskResult.height,
                bytes: imageBytes.length
            });
        }

        if (maskResult.maskFormat === 'raw' && mask) {
            const maskBytes = base64ToUint8Array(mask);
            const requestId = wsClient.allocBinaryRequestId();
            wsClient.sendBinaryData(
                BinaryMessageType.RAW_MASK,
                requestId,
                maskResult.width,
                maskResult.height,
                maskBytes
            );
            maskBinaryMeta = {
                requestId,
                width: maskResult.width,
                height: maskResult.height
            };
            console.log('[DesignEcho] Sent inpainting RAW_MASK binary frame:', {
                requestId,
                width: maskResult.width,
                height: maskResult.height,
                bytes: maskBytes.length
            });
        }

        const normalizedPayload = {
            image: imageBinaryMeta ? '' : image,
            imageFormat: maskResult.imageFormat || 'raw',
            imageChannels: maskResult.imageChannels || 3,
            mask: maskBinaryMeta ? '' : mask,
            maskFormat: maskResult.maskFormat || 'raw',
            maskChannels: maskResult.maskChannels || 1,
            imageWidth: maskResult.width,
            imageHeight: maskResult.height,
            prompt,
            model: selectedModel,
            seed: payload?.seed,
            // 候选变体数（1-4）：对齐官方 Generative Fill 一次出多个变体任挑，
            // Agent 侧并行生成 N 次，每个候选都是一次完整的付费生成
            count: Math.min(4, Math.max(1, Math.floor(Number(payload?.count) || 1))),
            // 参考图解决的是"模型猜不出你要哪一只袜子"，只有支持多图输入的通道能消费，
            // 用不上时由 Agent 侧回 warnings，不在这里静默丢掉
            referenceImages: Array.isArray(payload?.referenceImages) ? payload.referenceImages : [],
            selectionBounds,
            documentMeta: documentMeta || {
                width: maskResult.originalWidth || payload?.originalWidth || payload?.width || 0,
                height: maskResult.originalHeight || payload?.originalHeight || payload?.height || 0
            },
            imageFromBinary: !!imageBinaryMeta,
            imageBinaryRequestId: imageBinaryMeta?.requestId,
            imageBinaryWidth: imageBinaryMeta?.width,
            imageBinaryHeight: imageBinaryMeta?.height,
            maskFromBinary: !!maskBinaryMeta,
            maskBinaryRequestId: maskBinaryMeta?.requestId,
            maskBinaryWidth: maskBinaryMeta?.width,
            maskBinaryHeight: maskBinaryMeta?.height
        };

        console.log('[DesignEcho] Inpainting normalized payload:', {
            model: normalizedPayload.model,
            imageFormat: normalizedPayload.imageFormat,
            imageChannels: normalizedPayload.imageChannels,
            maskFormat: normalizedPayload.maskFormat,
            maskChannels: normalizedPayload.maskChannels,
            imageWidth: normalizedPayload.imageWidth,
            imageHeight: normalizedPayload.imageHeight,
            imageFromBinary: normalizedPayload.imageFromBinary,
            maskFromBinary: normalizedPayload.maskFromBinary
        });

        const hasInpaintingImagePayload = normalizedPayload.image.length > 0 || normalizedPayload.imageFromBinary;
        const hasInpaintingMaskPayload = normalizedPayload.mask.length > 0 || normalizedPayload.maskFromBinary;
        if (!hasInpaintingImagePayload || !hasInpaintingMaskPayload) {
            const missingPayloads: string[] = [];
            if (!hasInpaintingImagePayload) {
                missingPayloads.push('原图');
            }
            if (!hasInpaintingMaskPayload) {
                missingPayloads.push('选区蒙版');
            }
            throw new Error(`局部重绘请求参数不完整：缺少${missingPayloads.join('和')}，请重新创建选区后重试`);
        }

        // 发送请求到 Agent
        const result = await wsClient.sendRequest('inpainting.generate', normalizedPayload, 300000); // 5分钟超时

        if (result.success) {
            const previewImages = Array.isArray(result.images) ? result.images : [];
            const rawImages = Array.isArray(result.rawImages) ? result.rawImages : [];
            // 多变体候选的全分辨率文件清单；Agent 与插件可能跨版本共存，单数字段兜底
            const imageFilePaths: string[] = Array.isArray(result.imageFilePaths)
                ? result.imageFilePaths.filter((item: unknown) => typeof item === 'string' && item.length > 0)
                : (typeof result.imageFilePath === 'string' && result.imageFilePath ? [result.imageFilePath] : []);
            const generatedMeta = result.meta || null;
            const hasUsableResult = (
                imageFilePaths.length > 0 ||
                (typeof previewImages[0] === 'string' && previewImages[0].length > 0) ||
                (typeof rawImages[0] === 'string' && rawImages[0].length > 0)
            );
            console.log('[DesignEcho] Inpainting generate result summary:', {
                imageCount: previewImages.length,
                rawImageCount: rawImages.length,
                filePathCount: imageFilePaths.length,
                hasUsableResult,
                meta: generatedMeta
            });

            if (!hasUsableResult) {
                throw new Error('局部重绘没有返回可用结果，请调整描述或选区后重试');
            }

            // 与整图重生一致：结果先给用户看，确认后才落画布。
            // 自动置入会在用户还没判断好坏时就改动文档，不满意还得手动删图层。
            pendingInpaintingCandidates = {
                filePaths: imageFilePaths,
                previews: previewImages,
                rawImages,
                meta: generatedMeta,
                fallbackWidth: maskResult.width,
                fallbackHeight: maskResult.height,
                fallbackOriginalWidth: maskResult.originalWidth || maskResult.width,
                fallbackOriginalHeight: maskResult.originalHeight || maskResult.height,
                sourceDocumentId: toPhotoshopEntityId(require('photoshop').app.activeDocument?.id),
                appliedLayerId: null
            };

            // 捕获诊断跟着结果一起回面板：重绘区实得多少像素、置入时放大几倍，
            // 是用户判断"这次为什么发虚"的唯一依据，不能只留在控制台里。
            sendToWebView('inpaintingGenerated', {
                images: previewImages,
                rawImages,
                meta: generatedMeta,
                capture: maskResult.capture || null,
                warnings: Array.isArray(result.warnings) ? result.warnings : []
            });
            sendToWebView('inpaintingProgress', {
                progress: 100,
                message: previewImages.length > 1 ? '生成完成，请选择结果' : '生成完成，确认后置入',
                stage: 'done'
            });
            sendToWebView('toast', { message: '生成完成', type: 'success' });
        } else {
            throw {
                message: result?.error || 'Inpainting failed',
                errorStage: result?.errorStage || '',
                errorCode: result?.errorCode || '',
                errorDetail: result?.errorDetail || ''
            };
        }
    } catch (error: any) {
        const errorInfo = normalizeInpaintingError(error);
        const errorMessage = errorInfo.message;
        const isSelectionWarning =
            typeof errorMessage === 'string' &&
            (errorInfo.stage === 'analyze-selection' || errorMessage.toLowerCase().includes('selection'));
        if (isSelectionWarning) {
            console.warn('[DesignEcho] Inpainting warning:', errorMessage);
        } else {
            console.error('[DesignEcho] Inpainting generate error:', error);
        }
        sendToWebView('hideLoading', {});
        sendToWebView('inpaintingError', {
            ...errorInfo,
            type: isSelectionWarning ? 'warning' : 'error',
            stageLabel: getInpaintingStageLabel(errorInfo.stage)
        });
        sendToWebView('toast', { 
            message: errorMessage,
            type: isSelectionWarning ? 'warning' : 'error'
        });
    }
}

/**
 * 局部重绘本轮的候选结果，等用户确认后才落画布。
 *
 * 必须缓存 filePaths：面板里展示的是 640px 预览缩略图，
 * 拿它回写会把低分辨率结果贴进文档，全分辨率结果只在临时文件里。
 */
let pendingInpaintingCandidates: {
    filePaths: string[];
    previews: string[];
    rawImages: string[];
    meta: any;
    fallbackWidth: number;
    fallbackHeight: number;
    fallbackOriginalWidth: number;
    fallbackOriginalHeight: number;
    /** 生成这批候选时所在的文档。删旧结果图层前要比对它——deleteLayer 只认当前活动文档 */
    sourceDocumentId: number | null;
    /** 本轮已经置入的图层。切换候选时先删掉它，避免几张候选在图层面板里越堆越多 */
    appliedLayerId: number | null;
} | null = null;

/**
 * 置入用户选中的局部重绘结果。
 *
 * 结果是「选区内有像素、选区外透明」的图层，贴到 targetBounds 指定的位置，
 * 所以不会覆盖选区外的任何原始内容。
 */
/**
 * 删掉本轮上一次置入的结果图层。
 *
 * 用户在候选之间来回点是常态，每点一次都新建图层的话，图层面板很快就堆满
 * 同名图层还得手动清理。删除本身进 PS 历史记录，用户可以撤销。
 * 删除失败不阻断本次置入，但必须如实告知，否则用户会以为只有一个图层。
 */
async function removeAppliedResultLayer(
    layerId: number,
    layerLabel: string,
    expectedDocumentId?: number | null
): Promise<void> {
    if (!toolRegistry) return;
    const deleteTool = toolRegistry.getTool('deleteLayer');
    if (!deleteTool) return;

    // deleteLayer 只认 app.activeDocument（不接受 documentId）。用户在多个文档标签之间
    // 切换是常态，此时上一张结果图层还好好待在**原来那个文档**里，在当前文档当然找不到。
    // 不先校验就删，会拿到"未找到指定图层"，再翻译成"图层面板里有两个同名图层"——
    // 一个既不成立、又指挥用户去删不存在的图层的结论。
    if (typeof expectedDocumentId === 'number') {
        const { app } = require('photoshop');
        const activeDocumentId = toPhotoshopEntityId(app.activeDocument?.id);
        if (activeDocumentId !== expectedDocumentId) {
            console.log(
                `[DesignEcho] 跳过移除上一次置入的${layerLabel}(id=${layerId})：` +
                `它属于文档 ${expectedDocumentId}，当前活动文档是 ${activeDocumentId}`
            );
            return;
        }
    }

    try {
        const raw = await deleteTool.execute({ layerId });
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (parsed?.success === false) {
            throw new Error(parsed?.error || '未知原因');
        }
    } catch (error: any) {
        const reason = error?.message || String(error);
        console.warn(`[DesignEcho] 未能移除上一次置入的${layerLabel}(id=${layerId}):`, reason);

        // 区分两种失败：图层压根不在了（用户已手动删除或撤销过）是正常情况，
        // 不该报警；只有图层确实还在却删不掉，才会真的多出一个同名图层要用户处理。
        if (/未找到指定图层|not found/i.test(reason)) {
            console.log(`[DesignEcho] 上一次置入的${layerLabel}已不存在，无需移除`);
            return;
        }

        // 面板上只说用户能处理的事。原因（含内部工具名与调用建议）留在控制台供排查——
        // 真机截图里出现过把 "deleteLayer 缺少可操作的目标对象：先调用 listDocuments、
        // getLayerHierarchy..." 整段吐给设计师的情况，那些词对他没有任何信息量，
        // 只会让一次可以手动解决的小状况看起来像系统坏了。
        sendToWebView('toast', {
            message: `上一张${layerLabel}没能自动删掉，图层面板里会有两个同名图层，手动删掉多余的那个就行`,
            type: 'warning'
        });
    }
}

async function handleInpaintingApplySelection(payload: any) {
    try {
        const candidates = pendingInpaintingCandidates;
        if (!candidates) {
            sendToWebView('toast', { message: '没有可置入的重绘结果，请先生成', type: 'warning' });
            return;
        }

        const rawIndex = Number(payload?.index);
        const index = Number.isFinite(rawIndex) && rawIndex >= 0 ? Math.floor(rawIndex) : 0;
        const meta = candidates.meta || {};

        // 优先级：raw RGBA > 全分辨率临时文件 > 预览图。
        // 预览图只有 640px，是最后的兜底而不是首选。
        const rawImage = typeof candidates.rawImages[index] === 'string' ? candidates.rawImages[index] : '';
        const filePath = candidates.filePaths[index] || candidates.filePaths[0] || '';
        const preview = typeof candidates.previews[index] === 'string' ? candidates.previews[index] : '';

        if (!rawImage && !filePath && !preview) {
            sendToWebView('toast', {
                message: '选中的第 ' + (index + 1) + ' 张结果已失效，请重新生成',
                type: 'warning'
            });
            return;
        }

        sendToWebView('inpaintingProgress', {
            progress: 60,
            message: '正在置入所选结果',
            stage: 'apply-result'
        });

        if (typeof candidates.appliedLayerId === 'number') {
            await removeAppliedResultLayer(
                candidates.appliedLayerId,
                '局部重绘结果',
                candidates.sourceDocumentId
            );
            candidates.appliedLayerId = null;
        }

        const applyResult = await executeApplyRasterImageResult({
            filePath: !rawImage && filePath ? filePath : undefined,
            imageData: rawImage || (filePath ? '' : preview),
            imageBytes: undefined,
            imageFormat: !rawImage && !filePath && preview ? 'png' : undefined,
            isRawRgba: !!rawImage,
            width: meta.outputWidth || candidates.fallbackWidth,
            height: meta.outputHeight || candidates.fallbackHeight,
            placementWidth: meta.outputWidth || candidates.fallbackWidth,
            placementHeight: meta.outputHeight || candidates.fallbackHeight,
            originalWidth: meta.originalWidth || candidates.fallbackOriginalWidth,
            originalHeight: meta.originalHeight || candidates.fallbackOriginalHeight,
            targetBounds: meta.targetBounds || undefined,
            layerName: '局部重绘结果'
        });

        if (!applyResult.success) {
            throw new Error(applyResult.error || '应用结果失败');
        }

        candidates.appliedLayerId = typeof applyResult.layerId === 'number' ? applyResult.layerId : null;

        sendToWebView('inpaintingProgress', {
            progress: 100,
            message: '已置入新图层',
            stage: 'done'
        });
        sendToWebView('inpaintingApplied', {
            layerId: applyResult.layerId || null,
            layerName: applyResult.layerName || '局部重绘结果',
            autoApplied: false,
            appliedIndex: index,
            writeMode: applyResult.writeMode,
            sourceDocumentPreserved: applyResult.sourceDocumentPreserved === true
        });
        sendToWebView('toast', { message: '已置入新图层', type: 'success' });
        await forceRefreshCanvas();
    } catch (error: any) {
        console.error('[DesignEcho] Apply inpainting selection error:', error);
        sendToWebView('inpaintingError', {
            message: error?.message || '置入所选结果失败',
            stage: 'apply-result'
        });
        sendToWebView('toast', { message: error?.message || '置入失败', type: 'error' });
    }
}

/**
 * 本轮生成出来、等待用户挑选的候选图。
 *
 * 生成与置入被拆成了两步，中间隔着用户的选择，所以候选必须在模块作用域存活。
 * 每次新生成会整体覆盖，不做累积——上一轮的临时文件由系统 temp 目录回收。
 */
let pendingImageToImageCandidates: {
    filePaths: string[];
    previews: string[];
    sizes: Array<{ width: number; height: number }>;
    meta: any;
    fallbackOriginalWidth: number;
    fallbackOriginalHeight: number;
    /** 生成这批候选时所在的文档与源图层。用户点回源图层对照原图时，候选不该被当成过期结果清掉 */
    sourceDocumentId: number | null;
    sourceLayerId: number | null;
    /** 本轮已经置入的图层。切换候选时先删掉它，避免几张候选在图层面板里越堆越多 */
    appliedLayerId: number | null;
} | null = null;

/**
 * 把用户选中的那张候选图置入画布。
 *
 * 只有到这一步才真正改文档——在此之前生成多少张都不碰图层面板。
 */
async function handleImageToImageApplySelection(payload: any) {
    setImageToImageWriteInFlight(true);
    try {
        const candidates = pendingImageToImageCandidates;
        if (!candidates || candidates.filePaths.length === 0) {
            sendToWebView('toast', { message: '没有可置入的生成结果，请先生成', type: 'warning' });
            return;
        }

        const rawIndex = Number(payload?.index);
        const index = Number.isFinite(rawIndex) && rawIndex >= 0 ? Math.floor(rawIndex) : 0;
        const filePath = candidates.filePaths[index];
        if (!filePath) {
            sendToWebView('toast', {
                message: '选中的第 ' + (index + 1) + ' 张结果已失效，请重新生成',
                type: 'warning'
            });
            return;
        }

        // 候选现在不会因为切图层 / 切文档而被清空（那些结果是按次计费买来的，见 webview
        // applyImageToImageSelection 的说明），所以「会不会落错文档」这道防线必须放在写入这一步。
        //
        // 置入走的是 app.activeDocument。如果用户切到了别的文档，静默置入就会把结果贴进
        // 不相干的文档里，而且 targetBounds 是按原文档坐标算的，位置也是错的。
        // 这属于不可逆写入，宁可拒绝并说清要切回哪里，也不要"帮用户猜"。
        const { app: photoshopApp } = require('photoshop');
        const activeDocumentId = toPhotoshopEntityId(photoshopApp.activeDocument?.id);
        if (
            typeof candidates.sourceDocumentId === 'number'
            && activeDocumentId !== null
            && activeDocumentId !== candidates.sourceDocumentId
        ) {
            const activeName = String(photoshopApp.activeDocument?.name || '当前文档');
            sendToWebView('toast', {
                message: `这批结果是为另一个文档生成的，当前在「${activeName}」。请切回原文档再置入——`
                    + `直接贴进来位置会错，结果也会留在不相干的文档里。`,
                type: 'warning'
            });
            return;
        }

        const meta = candidates.meta || {};
        const selectedSize = candidates.sizes[index];
        const resultImageFormat = resolveImageResultFormatHint({
            declaredFormat: meta.outputFormat,
            filePath,
            fallbackFormat: candidates.previews[index] ? 'png' : undefined
        });

        sendToWebView('imageToImageProgress', {
            progress: 60,
            message: '正在置入所选结果',
            stage: 'apply-result'
        });

        if (typeof candidates.appliedLayerId === 'number') {
            await removeAppliedResultLayer(
                candidates.appliedLayerId,
                'AI 生图结果',
                candidates.sourceDocumentId
            );
            candidates.appliedLayerId = null;
        }

        const applyResult = await executeApplyImageToImageResult({
            imageData: candidates.previews[index] || '',
            filePath,
            imageFormat: resultImageFormat,
            // 尺寸优先用这一张自己的真实宽高：组图里各张尺寸可能不同，
            // 统一套用 meta 里第一张的尺寸会让后面几张被拉伸。
            width: selectedSize?.width || meta.outputWidth || candidates.fallbackOriginalWidth,
            height: selectedSize?.height || meta.outputHeight || candidates.fallbackOriginalHeight,
            placementWidth: meta.placementWidth || meta.originalWidth || candidates.fallbackOriginalWidth,
            placementHeight: meta.placementHeight || meta.originalHeight || candidates.fallbackOriginalHeight,
            originalWidth: meta.originalWidth || candidates.fallbackOriginalWidth,
            originalHeight: meta.originalHeight || candidates.fallbackOriginalHeight,
            targetBounds: meta.targetBounds || { left: 0, top: 0 },
            layerName: candidates.filePaths.length > 1
                ? 'AI 生图结果 ' + (index + 1)
                : 'AI 生图结果'
        });

        if (!applyResult.success) {
            throw new Error(applyResult.error || 'Apply image-to-image result failed');
        }

        candidates.appliedLayerId = toPhotoshopEntityId(applyResult.layerId);

        // 落位做过取舍（生成图比例与原位置对不上）时如实说明。
        // 沉默地把画面拉伸到原位置尺寸，用户只会看到"图变形了"却不知道发生在哪一步。
        const placementNotice = typeof applyResult.placementNotice === 'string'
            ? applyResult.placementNotice.trim()
            : '';
        if (placementNotice) {
            console.warn('[I2I] placement notice:', placementNotice);
            sendToWebView('toast', { message: placementNotice, type: 'warning' });
        }

        sendToWebView('imageToImageProgress', {
            progress: 100,
            message: '已置入新图层',
            stage: 'done'
        });
        sendToWebView('imageToImageApplied', {
            layerId: applyResult.layerId || null,
            layerName: applyResult.layerName || 'AI 生图结果',
            appliedIndex: index,
            autoApplied: false
        });
        sendToWebView('toast', { message: '已置入新图层', type: 'success' });
        await forceRefreshCanvas();
    } catch (error: any) {
        console.error('[DesignEcho] Apply image-to-image selection error:', error);
        sendToWebView('imageToImageError', {
            message: error?.message || '置入所选结果失败',
            errorStage: 'apply-result'
        });
        sendToWebView('toast', { message: error?.message || '置入失败', type: 'error' });
    } finally {
        setImageToImageWriteInFlight(false);
        // 写入期间被压住的选中变化在这里一次性补上：置入后 Photoshop 选中的确实是新图层，
        // 面板要如实反映（否则下一次生成会拿着面板没显示的图层当源图），
        // 但这次变化会被标成"属于本批候选"，不会连带清掉其余候选。
        if (imageToImagePollingTimer) {
            pollImageToImageSelection();
        }
    }
}

/**
 * 用户点「停止生成」。
 *
 * 只停止等待，不代表上游停止出图——请求早就发出去了。所以这里的措辞是"已停止等待"
 * 而不是"已取消"，并且明确说费用不退：把它说成撤销订单是在骗人。
 */
async function handleImageToImageCancel() {
    if (!wsClient || !wsClient.isConnected()) {
        sendToWebView('imageToImageError', {
            message: '停止失败：Agent 未连接',
            errorStage: 'provider-canceled'
        });
        return;
    }

    try {
        const result = await wsClient.sendRequest('imageToImage.cancel', {}, 15000);
        const message = String(result?.message || '已停止等待这次生成。');
        console.log('[I2I] cancel result:', result);
        sendToWebView('imageToImageCanceled', { message });
        sendToWebView('toast', { message, type: 'warning' });
    } catch (error: any) {
        console.error('[DesignEcho] Image-to-image cancel error:', error);
        sendToWebView('toast', {
            message: '没能通知 Agent 停止，这次生成可能还在后台跑',
            type: 'warning'
        });
    }
}

/**
 * 处理图生图生成请求
 */
async function handleImageToImageGenerate(payload: any) {
    if (!wsClient || !wsClient.isConnected()) {
        const errorInfo = normalizeImageToImageError({ message: 'Agent not connected', errorStage: 'provider-auth' });
        sendToWebView('imageToImageError', {
            ...errorInfo,
            stageLabel: getImageToImageStageLabel(errorInfo.stage)
        });
        return;
    }

    if (!toolRegistry) {
        const errorInfo = normalizeImageToImageError({ message: 'Tool registry not initialized', errorStage: 'provider-auth' });
        sendToWebView('imageToImageError', {
            ...errorInfo,
            stageLabel: getImageToImageStageLabel(errorInfo.stage)
        });
        return;
    }

    try {
        let currentErrorStage = 'validate-prompt';
        const prompt = String(payload?.prompt || '').trim();
        if (!prompt) {
            throw new Error('Prompt is required');
        }

        const model = normalizeImageToImageModel(payload?.model);
        const requestedSizePreset = String(payload?.sizePreset || DEFAULT_IMAGE_TO_IMAGE_SIZE_PRESET).trim().toUpperCase();
        const sizePreset = resolveImageToImageSizePreset(model, requestedSizePreset);
        // 比例选择走像素模式（宽x高）：与档位互斥，由 Agent 端按模型区间校验后下发。
        const explicitSize = String(payload?.size || '').trim();
        const requestedMaxImages = Number(payload?.maxImages);
        const maxImages = Number.isFinite(requestedMaxImages) && requestedMaxImages > 1
            ? Math.floor(requestedMaxImages)
            : 1;
        // 抓图边长仍按档位推断：像素模式下用输出的长边反推，避免source图过小拖累细节。
        const snapshotMaxEdge = explicitSize
            ? resolveImageToImageSnapshotMaxEdgeForExplicitSize(explicitSize, model, sizePreset)
            : resolveImageToImageSnapshotMaxEdge(model, sizePreset);
        const { app } = require('photoshop');
        const doc = app.activeDocument;
        const exportLayerTool = toolRegistry.getTool('exportLayerAsBase64');
        if (!exportLayerTool) {
            throw new Error('Tool registry not initialized');
        }

        let sourceImageData = '';
        let originalWidth = 0;
        let originalHeight = 0;
        let placementWidth = 0;
        let placementHeight = 0;
        let targetBounds = { left: 0, top: 0 };
        let sourceKind: 'layer' | 'document' = 'layer';

        const activeLayers = Array.isArray(doc?.activeLayers) ? doc.activeLayers : [];
        const selectedLayer = activeLayers.length === 1 ? activeLayers[0] : null;

        if (!selectedLayer) {
            throw { message: 'Please select exactly one layer', errorStage: 'validate-source-layer' };
        }

        currentErrorStage = 'capture-source-layer';
        sendToWebView('imageToImageProgress', {
            progress: 8,
            message: '\u6b63\u5728\u6293\u53d6\u5f53\u524d\u9009\u4e2d\u56fe\u5c42',
            stage: 'capture-source-layer'
        });

        // v3 零闪烁：优先用 imaging.getPixels({ layerID }) 抓 raw RGBA（PS 端零文档操作）
        // 若 raw RGBA 通路失败（如"背景"图层等特殊图层），回退到 native-png 路径
        let exportResult: any = await exportLayerTool.execute({
            layerId: selectedLayer.id,
            mode: 'pixels-rgba',
            maxSize: snapshotMaxEdge
        });
        console.log('[I2I] pixels-rgba result:', {
            success: exportResult?.success,
            error: exportResult?.error,
            mimeType: exportResult?.data?.mimeType,
            hasRawPixels: !!exportResult?.data?.rawPixels,
            rawPixelsLen: exportResult?.data?.rawPixels?.length,
            rawPixelsCtor: exportResult?.data?.rawPixels?.constructor?.name,
            width: exportResult?.data?.width,
            height: exportResult?.data?.height
        });

        if (!exportResult?.success) {
            console.warn('[I2I] pixels-rgba failed, fallback to native-png. error =', exportResult?.error);
            exportResult = await exportLayerTool.execute({
                layerId: selectedLayer.id,
                mode: 'native-png',
                format: 'png',
                maxSize: snapshotMaxEdge
            });
            console.log('[I2I] native-png fallback result:', {
                success: exportResult?.success,
                error: exportResult?.error,
                mimeType: exportResult?.data?.mimeType,
                base64Len: exportResult?.data?.base64?.length,
                width: exportResult?.data?.width,
                height: exportResult?.data?.height
            });
        }

        if (!exportResult?.success || !exportResult.data) {
            throw {
                message: exportResult?.error || 'Source image is required',
                errorStage: 'capture-source-layer'
            };
        }

        const exportedMime = String(exportResult.data.mimeType || '').trim().toLowerCase();
        const rawPixelsCandidate = exportResult.data.rawPixels;
        // 宽松判断：有 length 和 byteLength 且是 number 即可认为是 typed array 风格的 raw buffer
        const isLikelyTypedArray =
            !!rawPixelsCandidate &&
            typeof rawPixelsCandidate.length === 'number' &&
            rawPixelsCandidate.length > 0 &&
            (typeof rawPixelsCandidate.byteLength === 'number' || rawPixelsCandidate instanceof Uint8Array);
        const isRawRgba = exportedMime === 'image/x-raw-rgba' && isLikelyTypedArray;

        let sourceBinaryMeta: { requestId: number; width: number; height: number } | null = null;

        if (isRawRgba) {
            // 确保是 Uint8Array：即使 instanceof 判断打了 false（webpack 原型问题），也能被 wsClient 接受
            const rawPixels: Uint8Array = rawPixelsCandidate instanceof Uint8Array
                ? rawPixelsCandidate
                : new Uint8Array(rawPixelsCandidate.buffer
                    ? rawPixelsCandidate.buffer.slice(
                        rawPixelsCandidate.byteOffset || 0,
                        (rawPixelsCandidate.byteOffset || 0) + rawPixelsCandidate.byteLength
                    )
                    : rawPixelsCandidate);

            originalWidth = exportResult.data.contentBounds?.width || exportResult.data.width || 0;
            originalHeight = exportResult.data.contentBounds?.height || exportResult.data.height || 0;
            placementWidth = originalWidth;
            placementHeight = originalHeight;
            targetBounds = exportResult.data.contentBounds
                ? {
                    left: exportResult.data.contentBounds.left,
                    top: exportResult.data.contentBounds.top
                }
                : { left: 0, top: 0 };
            sourceImageData = '';

            const sourceBinaryRequestId = wsClient.allocBinaryRequestId();
            // 使用顶部已静态 import 的 BinaryMessageType，避免 UXP 下 dynamic import 不可靠
            wsClient.sendBinaryData(
                BinaryMessageType.RAW_RGBA,
                sourceBinaryRequestId,
                exportResult.data.width,
                exportResult.data.height,
                rawPixels
            );

            sourceBinaryMeta = {
                requestId: sourceBinaryRequestId,
                width: exportResult.data.width,
                height: exportResult.data.height
            };
            console.log('[I2I] Sent RAW_RGBA binary frame:', {
                requestId: sourceBinaryRequestId,
                width: exportResult.data.width,
                height: exportResult.data.height,
                bytes: rawPixels.length
            });
        } else if (exportResult.data.base64) {
            const fallbackMime = (exportedMime && exportedMime !== 'image/x-raw-rgba')
                ? exportedMime
                : 'image/png';
            sourceImageData = `data:${fallbackMime};base64,${exportResult.data.base64}`;
            originalWidth = exportResult.data.contentBounds?.width || exportResult.data.width || 0;
            originalHeight = exportResult.data.contentBounds?.height || exportResult.data.height || 0;
            placementWidth = originalWidth;
            placementHeight = originalHeight;
            targetBounds = exportResult.data.contentBounds
                ? {
                    left: exportResult.data.contentBounds.left,
                    top: exportResult.data.contentBounds.top
                }
                : { left: 0, top: 0 };
            console.log('[I2I] Using base64 source image path, size:', sourceImageData.length);
        } else {
            throw {
                message: 'Source image data missing in export result',
                errorStage: 'capture-source-layer'
            };
        }

        const requestPayload: any = {
            prompt,
            model,
            sizePreset,
            ...(explicitSize ? { size: explicitSize } : {}),
            ...(maxImages > 1 ? { maxImages } : {}),
            // OpenRouter 图像模型的输出比例（aspect_ratio 档位）；Seedream/即梦忽略此字段
            ...(payload?.aspectRatio ? { aspectRatio: String(payload.aspectRatio) } : {}),
            image: sourceImageData,
            referenceImages: Array.isArray(payload?.referenceImages)
                ? payload.referenceImages.filter((item: unknown) => typeof item === 'string' && item.trim().length > 0)
                : [],
            originalWidth,
            originalHeight,
            placementWidth,
            placementHeight,
            targetBounds,
            sourceKind
        };

        if (sourceBinaryMeta) {
            requestPayload.sourceFromBinary = true;
            requestPayload.sourceBinaryRequestId = sourceBinaryMeta.requestId;
            requestPayload.sourceBinaryWidth = sourceBinaryMeta.width;
            requestPayload.sourceBinaryHeight = sourceBinaryMeta.height;
        }

        console.log('[I2I] Sending JSON request with payload:', {
            prompt: requestPayload.prompt?.slice(0, 40),
            model: requestPayload.model,
            sizePreset: requestPayload.sizePreset,
            size: requestPayload.size,
            maxImages: requestPayload.maxImages,
            imageLen: (requestPayload.image || '').length,
            sourceFromBinary: requestPayload.sourceFromBinary,
            sourceBinaryRequestId: requestPayload.sourceBinaryRequestId,
            refCount: requestPayload.referenceImages.length
        });

        currentErrorStage = 'provider-submit';
        sendToWebView('imageToImageProgress', {
            progress: 18,
            message: '\u6b63\u5728\u63d0\u4ea4\u751f\u6210\u8bf7\u6c42',
            stage: 'provider-submit'
        });

        // 等待时间按档位取，且必须长于 Agent 侧——否则这边先到期，Agent 那条带 provider
        // 原文的错误就传不回来，用户只能看到「请求超时」这种无信息量的提示。
        const requestTimeoutMs = resolveImageToImageRequestTimeoutMs(sizePreset);
        const result = await wsClient.sendRequest('imageToImage.generate', requestPayload, requestTimeoutMs);
        if (!result?.success) {
            throw {
                message: result?.error || 'Image-to-image generation failed',
                errorStage: result?.errorStage || currentErrorStage,
                errorCode: result?.errorCode,
                errorDetail: result?.errorDetail
            };
        }

        const images = Array.isArray(result.images) ? result.images : [];
        const imageFilePaths: string[] = Array.isArray(result.imageFilePaths)
            ? result.imageFilePaths.filter((item: unknown) => typeof item === 'string' && item.length > 0)
            : (typeof result.imageFilePath === 'string' && result.imageFilePath ? [result.imageFilePath] : []);
        const imageSizes = Array.isArray(result.imageSizes) ? result.imageSizes : [];
        const generatedMeta = result.meta || {
            originalWidth,
            originalHeight,
            outputWidth: originalWidth,
            outputHeight: originalHeight,
            targetBounds: { left: 0, top: 0 }
        };

        if (!images[0] && imageFilePaths.length === 0) {
            throw { message: 'Image-to-image provider did not return any images', errorStage: 'provider-result' };
        }

        // \u5019\u9009\u7f13\u5b58\uff1a\u7ed3\u679c\u4e0d\u518d\u81ea\u52a8\u843d\u753b\u5e03\uff0c\u6539\u4e3a\u7b49\u7528\u6237\u5728\u9762\u677f\u91cc\u6311\u4e2d\u54ea\u4e00\u5f20\u518d\u7f6e\u5165\u3002
        // \u7ec4\u56fe\u4e00\u6b21\u53ef\u80fd\u51fa\u5341\u51e0\u5f20\uff0c\u81ea\u52a8\u7f6e\u5165\u4f1a\u76f4\u63a5\u628a\u56fe\u5c42\u9762\u677f\u704c\u6ee1\uff0c\u4e14\u4e0d\u8981\u7684\u8fd8\u5f97\u624b\u5220\u3002
        pendingImageToImageCandidates = {
            filePaths: imageFilePaths,
            previews: images,
            sizes: imageSizes,
            meta: generatedMeta,
            fallbackOriginalWidth: originalWidth,
            fallbackOriginalHeight: originalHeight,
            sourceDocumentId: toPhotoshopEntityId(doc?.id),
            sourceLayerId: toPhotoshopEntityId(selectedLayer.id),
            appliedLayerId: null
        };

        // 上游"接受了档位但没照做"（如请求 4K 实际只出 896×1200）不是错误，不该中断流程，
        // 但沉默会让用户把它体感成"这个模型不清晰"。如实说出来，用户才判断得了要不要换档位。
        const providerNotice = typeof result.providerNotice === 'string' ? result.providerNotice.trim() : '';
        if (providerNotice) {
            console.warn('[I2I] provider notice:', providerNotice);
            sendToWebView('toast', { message: providerNotice, type: 'warning' });
        }

        sendToWebView('imageToImageGenerated', {
            images,
            imageSizes,
            meta: generatedMeta,
            providerNotice: providerNotice || undefined,
            partialFailures: Array.isArray(result.partialFailures) ? result.partialFailures : []
        });

        sendToWebView('imageToImageProgress', {
            progress: 100,
            message: images.length > 1
                ? '\u5df2\u751f\u6210 ' + images.length + ' \u5f20\uff0c\u8bf7\u9009\u4e00\u5f20\u7f6e\u5165'
                : '\u751f\u6210\u5b8c\u6210\uff0c\u786e\u8ba4\u540e\u7f6e\u5165',
            stage: 'done'
        });
    } catch (error: any) {
        console.error('[DesignEcho] Image-to-image generate error:', error);
        const errorInfo = normalizeImageToImageError(error);
        sendToWebView('imageToImageError', {
            ...errorInfo,
            stageLabel: getImageToImageStageLabel(errorInfo.stage)
        });
    }
}

/**
 * 插件关闭或重载前：清理定时器、轮询与 WebView 监听。
 */
function cleanup() {
    console.log('[DesignEcho] Cleaning up...');
    clearEmbeddedWebViewResizeCommitTimer();
    stopOptimizeTextPolling();
    stopImageToImagePolling();
    
    disableLogging();
    
    // 移除消息监听器
    if (isWebViewInitialized) {
        if (webviewElement) {
            webviewElement.removeEventListener('message', webviewMessageHandler as any);
        }
        window.removeEventListener('message', webviewMessageHandler);
        isWebViewInitialized = false;
    }
    if (webviewResizeObserver) {
        webviewResizeObserver.disconnect();
        webviewResizeObserver = null;
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
