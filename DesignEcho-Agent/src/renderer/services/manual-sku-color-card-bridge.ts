import {
    MANUAL_SKU_COLOR_CARD_BRIDGE_VERSION,
    MANUAL_SKU_COLOR_CARD_RESULT_VERSION,
    type ManualSkuColorCardBridgeProbe,
    type ManualSkuColorCardProgress,
    type ManualSkuColorCardRendererRequest,
    type ManualSkuColorCardResult
} from '../../shared/manual-sku-color-card';
import type { SkuColorCardExecutionReport } from '../../shared/sku-color-card-skill';
import { executeSkuColorCardStrategy } from './skill-executors/sku-color-card.executor';

let rendererExecutionInFlight = false;

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error || '手动色卡执行失败。');
}

function sendProgress(input: ManualSkuColorCardProgress): void {
    window.designEcho?.sendManualSkuColorCardProgress(input);
}

function buildUserAuthorizationText(request: ManualSkuColorCardRendererRequest): string {
    const colorNames = request.sources.map((source) => source.colorName).join('、');
    return `用户通过 UXP 手动色卡面板选择了 ${request.sources.length} 张源图，`
        + `并确认颜色名为：${colorNames}。这些界面中填写的颜色名是本次色卡的权威标签。`;
}

function buildSuccessMessage(input: {
    request: ManualSkuColorCardRendererRequest;
    report?: SkuColorCardExecutionReport;
    retouchedCardCount: number;
}): string {
    const outputPath = input.report?.outputPath || input.request.outputPath;
    if (input.request.mode === 'ins') {
        return `INS 卡片色卡的可编辑结构已生成并保存到 ${outputPath}。`
            + '本模式保留原图与场景，没有执行抠图、形态统一或中性灰修正；请在 Photoshop 中检查主体裁切和卡片节奏。';
    }

    return `纯底精修色卡的可编辑结构已生成并保存到 ${outputPath}。`
        + `已为 ${input.retouchedCardCount}/${input.request.sources.length} 张图片写入形态统一主体、独立原影和中性灰光影修正层；`
        + '请在 Photoshop 中检查特殊袜口、边缘、纹理和各颜色受光，确认后再导出成品。';
}

function compactResult(
    request: ManualSkuColorCardRendererRequest,
    result: Awaited<ReturnType<typeof executeSkuColorCardStrategy>>
): ManualSkuColorCardResult {
    const report = result.data?.report as SkuColorCardExecutionReport | undefined;
    const preparedCards = Array.isArray(report?.preparedCards) ? report.preparedCards : [];
    const retouchedCardCount = preparedCards.filter((card) => card.retouchLayersVerified === true).length;
    const success = result.success === true && report?.status !== 'failed';
    const failure = String(result.error || report?.error || result.message || '手动色卡执行失败。');

    return {
        version: MANUAL_SKU_COLOR_CARD_RESULT_VERSION,
        requestId: request.requestId,
        success,
        mode: request.mode,
        message: success
            ? buildSuccessMessage({ request, report, retouchedCardCount })
            : failure,
        outputPath: report?.outputPath || request.outputPath,
        documentId: report?.documentId,
        sourceCount: report?.sourceCount || request.sources.length,
        preparedCardCount: preparedCards.length,
        retouchedCardCount,
        status: report?.status,
        checks: report?.checks,
        retouchReportPath: report?.retouchReport?.reportPath,
        needsVisualReview: success,
        errorCode: success ? undefined : 'execution_failed',
        error: success ? undefined : failure
    };
}

async function executeManualSkuColorCard(request: ManualSkuColorCardRendererRequest): Promise<void> {
    if (rendererExecutionInFlight) {
        window.designEcho?.sendManualSkuColorCardResult({
            version: MANUAL_SKU_COLOR_CARD_RESULT_VERSION,
            requestId: request.requestId,
            success: false,
            mode: request.mode,
            message: 'Renderer 已有一个手动色卡任务正在执行。',
            sourceCount: request.sources.length,
            preparedCardCount: 0,
            retouchedCardCount: 0,
            needsVisualReview: false,
            errorCode: 'busy',
            error: 'Renderer 已有一个手动色卡任务正在执行。'
        });
        return;
    }

    rendererExecutionInFlight = true;
    sendProgress({
        requestId: request.requestId,
        progress: 2,
        message: request.mode === 'studio' ? '正在准备纯底精修色卡...' : '正在准备 INS 卡片色卡...',
        stage: 'starting'
    });

    try {
        const result = await executeSkuColorCardStrategy({
            params: {
                stage: 'color-card',
                sources: request.sources,
                projectPath: request.outputFolder,
                outputPath: request.outputPath,
                showIndexNumbers: request.showIndexNumbers,
                columns: request.columns,
                retouchMode: request.mode === 'studio' ? 'studio_retouch_required' : 'layout_only',
                sourceMode: request.mode === 'studio' ? 'studio' : 'scene',
                shapeStrength: 0.72,
                lightingStrength: 0.68
            },
            context: {
                userInput: buildUserAuthorizationText(request),
                conversationHistory: [],
                isPluginConnected: true,
                projectContext: {
                    projectPath: request.outputFolder
                }
            },
            callbacks: {
                onProgress: (message, percent) => {
                    sendProgress({
                        requestId: request.requestId,
                        progress: percent,
                        message,
                        stage: 'executing'
                    });
                },
                onStep: (step) => {
                    if (typeof step.percent !== 'number') return;
                    sendProgress({
                        requestId: request.requestId,
                        progress: step.percent,
                        message: step.detail || step.title,
                        stage: step.kind
                    });
                }
            }
        });
        const compact = compactResult(request, result);
        sendProgress({
            requestId: request.requestId,
            progress: 100,
            message: compact.success ? '色卡可编辑文档已生成' : compact.message,
            stage: compact.success ? 'completed' : 'failed'
        });
        window.designEcho?.sendManualSkuColorCardResult(compact);
    } catch (error) {
        const message = errorMessage(error);
        sendProgress({
            requestId: request.requestId,
            progress: 100,
            message,
            stage: 'failed'
        });
        window.designEcho?.sendManualSkuColorCardResult({
            version: MANUAL_SKU_COLOR_CARD_RESULT_VERSION,
            requestId: request.requestId,
            success: false,
            mode: request.mode,
            message,
            sourceCount: request.sources.length,
            preparedCardCount: 0,
            retouchedCardCount: 0,
            needsVisualReview: false,
            errorCode: 'execution_failed',
            error: message
        });
    } finally {
        rendererExecutionInFlight = false;
    }
}

export function installManualSkuColorCardBridge(): () => void {
    const subscribe = window.designEcho?.onManualSkuColorCardRequest;
    const notifyReady = window.designEcho?.notifyManualSkuColorCardBridgeReady;
    const subscribeProbe = window.designEcho?.onManualSkuColorCardBridgeProbe;
    if (!subscribe || !notifyReady || !subscribeProbe) return () => undefined;
    const announceReady = (probe?: ManualSkuColorCardBridgeProbe): void => {
        notifyReady({
            version: MANUAL_SKU_COLOR_CARD_BRIDGE_VERSION,
            probeId: probe?.probeId
        });
    };
    const unsubscribeRequest = subscribe((request) => {
        void executeManualSkuColorCard(request);
    });
    const unsubscribeProbe = subscribeProbe(announceReady);
    announceReady();
    return () => {
        unsubscribeRequest();
        unsubscribeProbe();
    };
}
