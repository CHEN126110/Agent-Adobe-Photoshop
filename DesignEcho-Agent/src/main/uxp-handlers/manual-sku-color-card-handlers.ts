import { ipcMain, type IpcMainEvent } from 'electron';

import {
    MANUAL_SKU_COLOR_CARD_BRIDGE_VERSION,
    MANUAL_SKU_COLOR_CARD_RESULT_VERSION,
    type ManualSkuColorCardAvailability,
    type ManualSkuColorCardBridgeProbe,
    type ManualSkuColorCardBridgeReady,
    type ManualSkuColorCardErrorCode,
    type ManualSkuColorCardProgress,
    type ManualSkuColorCardRendererRequest,
    type ManualSkuColorCardResult,
    validateManualSkuColorCardRequest
} from '../../shared/manual-sku-color-card';
import type { UXPContext } from './types';

const REQUEST_CHANNEL = 'uxp:manual-sku-color-card-request';
const PROGRESS_CHANNEL = 'uxp:manual-sku-color-card-progress';
const RESULT_CHANNEL = 'uxp:manual-sku-color-card-result';
const RENDERER_READY_CHANNEL = 'uxp:manual-sku-color-card-renderer-ready';
const RENDERER_PROBE_CHANNEL = 'uxp:manual-sku-color-card-renderer-probe';
const RENDERER_ACK_TIMEOUT_MS = 5000;
const TIMEOUT_MS = 15 * 60 * 1000;

let inFlightRequestId: string | null = null;
let rendererBridgeReady: (ManualSkuColorCardBridgeReady & { webContentsId: number }) | null = null;
const acknowledgedRendererProbes = new Map<string, number>();
let rendererReadyListenerInstalled = false;
let expectedRendererWebContentsId: number | null = null;

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error || '未知错误');
}

function getAvailability(
    context: UXPContext,
    requiredProbeId?: string
): ManualSkuColorCardAvailability {
    if (!context.mainWindow || context.mainWindow.isDestroyed() || context.mainWindow.webContents.isDestroyed()) {
        return {
            version: MANUAL_SKU_COLOR_CARD_BRIDGE_VERSION,
            available: false,
            state: 'unavailable',
            modes: ['ins', 'studio'],
            reason: 'DesignEcho 主窗口不可用，无法启动统一色卡执行器。'
        };
    }

    const bridgeMatches = rendererBridgeReady?.version === MANUAL_SKU_COLOR_CARD_BRIDGE_VERSION
        && rendererBridgeReady.webContentsId === context.mainWindow.webContents.id;
    const probeMatches = !requiredProbeId
        || acknowledgedRendererProbes.get(requiredProbeId) === context.mainWindow.webContents.id;
    const ready = bridgeMatches && probeMatches;
    return {
        version: MANUAL_SKU_COLOR_CARD_BRIDGE_VERSION,
        available: ready,
        state: ready ? 'ready' : 'starting',
        modes: ['ins', 'studio'],
        reason: ready
            ? undefined
            : 'DesignEcho 界面执行器正在加载。请稍候后重新检测；若持续无法就绪，再完整重启 DesignEcho Agent。'
    };
}

function waitForRenderer(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function getAvailabilityWithProbe(context: UXPContext): Promise<ManualSkuColorCardAvailability> {
    const current = getAvailability(context);
    if (
        !context.mainWindow
        || context.mainWindow.isDestroyed()
        || context.mainWindow.webContents.isDestroyed()
    ) return current;

    const probe: ManualSkuColorCardBridgeProbe = {
        probeId: `manual_sku_probe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    };
    try {
        context.mainWindow.webContents.send(RENDERER_PROBE_CHANNEL, probe);
    } catch (error) {
        context.logService?.logAgent('error', `[ManualSkuColorCard] Renderer probe failed: ${errorMessage(error)}`);
        return {
            version: MANUAL_SKU_COLOR_CARD_BRIDGE_VERSION,
            available: false,
            state: 'unavailable',
            modes: ['ins', 'studio'],
            reason: 'DesignEcho 界面执行器无法接收状态检测请求。'
        };
    }
    for (let attempt = 0; attempt < 6; attempt += 1) {
        await waitForRenderer(150);
        const refreshed = getAvailability(context, probe.probeId);
        if (refreshed.available) {
            acknowledgedRendererProbes.delete(probe.probeId);
            return refreshed;
        }
    }
    const unavailable = getAvailability(context, probe.probeId);
    acknowledgedRendererProbes.delete(probe.probeId);
    return unavailable;
}

function installRendererReadyListener(context: UXPContext): void {
    expectedRendererWebContentsId = context.mainWindow?.webContents.id ?? null;
    if (!rendererReadyListenerInstalled) {
        ipcMain.on(RENDERER_READY_CHANNEL, (event: IpcMainEvent, payload: ManualSkuColorCardBridgeReady) => {
            if (event.sender.id !== expectedRendererWebContentsId) return;
            if (payload?.version !== MANUAL_SKU_COLOR_CARD_BRIDGE_VERSION) return;
            rendererBridgeReady = {
                version: payload.version,
                probeId: typeof payload.probeId === 'string' ? payload.probeId : undefined,
                webContentsId: event.sender.id
            };
            if (typeof payload.probeId === 'string' && payload.probeId) {
                acknowledgedRendererProbes.set(payload.probeId, event.sender.id);
                if (acknowledgedRendererProbes.size > 32) {
                    const oldestProbeId = acknowledgedRendererProbes.keys().next().value;
                    if (oldestProbeId) acknowledgedRendererProbes.delete(oldestProbeId);
                }
            }
            context.logService?.logAgent('info', `[ManualSkuColorCard] Renderer bridge ready: ${payload.version}`);
        });
        rendererReadyListenerInstalled = true;
    }

    if (context.mainWindow && !context.mainWindow.isDestroyed()) {
        const resetRendererBridge = (): void => {
            if (rendererBridgeReady?.webContentsId === context.mainWindow?.webContents.id) {
                rendererBridgeReady = null;
                acknowledgedRendererProbes.clear();
            }
        };
        context.mainWindow.webContents.on('did-start-loading', resetRendererBridge);
        context.mainWindow.webContents.on('render-process-gone', resetRendererBridge);
    }
}

function createFailureResult(input: {
    requestId: string;
    mode?: 'ins' | 'studio';
    sourceCount?: number;
    errorCode?: ManualSkuColorCardErrorCode;
    error: string;
}): ManualSkuColorCardResult {
    return {
        version: MANUAL_SKU_COLOR_CARD_RESULT_VERSION,
        requestId: input.requestId,
        success: false,
        mode: input.mode || 'studio',
        message: input.error,
        sourceCount: input.sourceCount || 0,
        preparedCardCount: 0,
        uniformScalePlacedCardCount: 0,
        retouchedCardCount: 0,
        needsVisualReview: false,
        errorCode: input.errorCode || 'execution_failed',
        error: input.error
    };
}

function requestRendererExecution(
    context: UXPContext,
    request: ManualSkuColorCardRendererRequest
): Promise<ManualSkuColorCardResult> {
    return new Promise((resolve) => {
        const target = context.mainWindow?.webContents;
        if (!target || target.isDestroyed()) {
            resolve(createFailureResult({
                requestId: request.requestId,
                mode: request.mode,
                sourceCount: request.sources.length,
                errorCode: 'bridge_unavailable',
                error: 'DesignEcho 界面执行器不可用，无法接收本次色卡任务。'
            }));
            return;
        }

        let settled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        let acknowledgementTimer: ReturnType<typeof setTimeout> | null = null;

        const cleanup = (): void => {
            if (timer) clearTimeout(timer);
            if (acknowledgementTimer) clearTimeout(acknowledgementTimer);
            ipcMain.removeListener(PROGRESS_CHANNEL, handleProgress);
            ipcMain.removeListener(RESULT_CHANNEL, handleResult);
            target.removeListener('did-start-loading', handleRendererUnavailable);
            target.removeListener('render-process-gone', handleRendererUnavailable);
            target.removeListener('destroyed', handleRendererUnavailable);
        };

        const finish = (result: ManualSkuColorCardResult): void => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(result);
        };

        const handleProgress = (event: IpcMainEvent, payload: ManualSkuColorCardProgress): void => {
            if (event.sender.id !== target.id) return;
            if (!payload || payload.requestId !== request.requestId) return;
            if (acknowledgementTimer) {
                clearTimeout(acknowledgementTimer);
                acknowledgementTimer = null;
            }
            context.wsServer.sendNotification('progress', {
                operation: 'manual-sku-color-card',
                progress: Math.max(0, Math.min(100, Number(payload.progress) || 0)),
                message: String(payload.message || '正在制作色卡...'),
                stage: String(payload.stage || '')
            });
        };

        const handleResult = (event: IpcMainEvent, payload: ManualSkuColorCardResult): void => {
            if (event.sender.id !== target.id) return;
            if (!payload || payload.requestId !== request.requestId) return;
            if (payload.version !== MANUAL_SKU_COLOR_CARD_RESULT_VERSION) {
                finish(createFailureResult({
                    requestId: request.requestId,
                    mode: request.mode,
                    sourceCount: request.sources.length,
                    errorCode: 'bridge_unavailable',
                    error: 'DesignEcho 界面执行器返回了旧版色卡结果协议。请完全退出并重新启动 DesignEcho Agent 后再试。'
                }));
                return;
            }
            finish(payload);
        };

        const handleRendererUnavailable = (): void => {
            rendererBridgeReady = null;
            finish(createFailureResult({
                requestId: request.requestId,
                mode: request.mode,
                sourceCount: request.sources.length,
                errorCode: 'bridge_unavailable',
                error: 'DesignEcho 界面执行器在任务期间重载或退出，本次结果未知。请先检查 Photoshop 文档和输出文件，避免立即重复执行。'
            }));
        };

        ipcMain.on(PROGRESS_CHANNEL, handleProgress);
        ipcMain.on(RESULT_CHANNEL, handleResult);
        target.once('did-start-loading', handleRendererUnavailable);
        target.once('render-process-gone', handleRendererUnavailable);
        target.once('destroyed', handleRendererUnavailable);
        timer = setTimeout(() => {
            finish(createFailureResult({
                requestId: request.requestId,
                mode: request.mode,
                sourceCount: request.sources.length,
                errorCode: 'outcome_unknown',
                error: '手动色卡执行超时。Photoshop 可能仍在处理，请先检查当前文档和输出目录，避免立即重复执行。'
            }));
        }, TIMEOUT_MS);
        acknowledgementTimer = setTimeout(() => {
            finish(createFailureResult({
                requestId: request.requestId,
                mode: request.mode,
                sourceCount: request.sources.length,
                errorCode: 'bridge_unavailable',
                error: 'DesignEcho 界面执行器未确认接收色卡任务。请重新检测执行器状态后再试。'
            }));
        }, RENDERER_ACK_TIMEOUT_MS);

        try {
            target.send(REQUEST_CHANNEL, request);
        } catch (error) {
            context.logService?.logAgent('error', `[ManualSkuColorCard] Renderer request delivery failed: ${errorMessage(error)}`);
            finish(createFailureResult({
                requestId: request.requestId,
                mode: request.mode,
                sourceCount: request.sources.length,
                errorCode: 'bridge_unavailable',
                error: 'DesignEcho 界面执行器未能接收本次色卡任务。请重新检测执行器状态。'
            }));
        }
    });
}

export function registerManualSkuColorCardHandlers(context: UXPContext): void {
    installRendererReadyListener(context);

    context.wsServer.registerHandler('manual-sku-color-card:status', async () => getAvailabilityWithProbe(context));

    context.wsServer.registerHandler('manual-sku-color-card:execute', async (params: unknown) => {
        const validation = validateManualSkuColorCardRequest(params);
        const provisionalRequestId = `manual_sku_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        if (!validation.success || !validation.request) {
            return createFailureResult({
                requestId: provisionalRequestId,
                errorCode: 'invalid_request',
                error: validation.error || '手动色卡请求无效。'
            });
        }

        if (!context.mainWindow || context.mainWindow.isDestroyed()) {
            return createFailureResult({
                requestId: provisionalRequestId,
                mode: validation.request.mode,
                sourceCount: validation.request.sources.length,
                errorCode: 'bridge_unavailable',
                error: 'DesignEcho 主窗口不可用，无法启动色卡执行器。'
            });
        }

        const availability = await getAvailabilityWithProbe(context);
        if (!availability.available) {
            return createFailureResult({
                requestId: provisionalRequestId,
                mode: validation.request.mode,
                sourceCount: validation.request.sources.length,
                errorCode: 'bridge_unavailable',
                error: availability.reason || '统一色卡执行器尚未就绪。'
            });
        }

        if (inFlightRequestId) {
            return createFailureResult({
                requestId: provisionalRequestId,
                mode: validation.request.mode,
                sourceCount: validation.request.sources.length,
                errorCode: 'busy',
                error: '已有一个手动色卡任务正在执行，请等待当前任务结束。'
            });
        }

        const request: ManualSkuColorCardRendererRequest = {
            ...validation.request,
            requestId: provisionalRequestId
        };
        inFlightRequestId = request.requestId;
        try {
            return await requestRendererExecution(context, request);
        } finally {
            if (inFlightRequestId === request.requestId) {
                inFlightRequestId = null;
            }
        }
    });
}
