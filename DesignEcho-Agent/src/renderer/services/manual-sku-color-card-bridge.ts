import {
    MANUAL_SKU_COLOR_CARD_BRIDGE_VERSION,
    MANUAL_SKU_COLOR_CARD_RESULT_VERSION,
    type ManualSkuColorCardBridgeProbe,
    type ManualSkuColorCardProgress,
    type ManualSkuColorCardRendererRequest,
    type ManualSkuColorCardResult
} from '../../shared/manual-sku-color-card';
import { createGuardedAtomicToolExecutor } from '../../shared/agent-skill-atomic-tool-execution';
import type { SkuColorCardExecutionReport } from '../../shared/sku-color-card-skill';
import {
    MANUAL_SKU_COLOR_CARD_LEGACY_PROFILE_CAPABILITY,
    executeSkuColorCardStrategy
} from './skill-executors/sku-color-card.executor';
import { executeToolCall } from './tool-executor.service';

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
    uniformScalePlacedCardCount: number;
}): string {
    const outputPath = input.report?.outputPath || input.request.outputPath;
    if (input.request.mode === 'ins') {
        return `INS 卡片色卡的可编辑结构已生成并保存到 ${outputPath}。`
            + '本模式保留原图与场景，没有进入纯底透明主体统一尺度处理；请在 Photoshop 中检查主体裁切和卡片节奏。';
    }

    return `纯底统一尺度色卡的可编辑结构已生成并保存到 ${outputPath}。`
        + `已为 ${input.uniformScalePlacedCardCount}/${input.request.sources.length} 张图片置入并读回确认保持真实版型的透明主体等比统一尺度资产；`
        + '当前阶段不包含形态变形、阴影分离或光影修正。请在 Photoshop 中检查主体完整性、尺度、重心、裁切和纹理，确认后再导出成品。';
}

function compactResult(
    request: ManualSkuColorCardRendererRequest,
    result: Awaited<ReturnType<typeof executeSkuColorCardStrategy>>
): ManualSkuColorCardResult {
    const report = result.data?.report as SkuColorCardExecutionReport | undefined;
    const preparedCards = Array.isArray(report?.preparedCards) ? report.preparedCards : [];
    const uniformScalePlacedCardCount = preparedCards.filter((card) => (
        card.uniformScaleAssetApplied === true && card.uniformScalePlacementVerified === true
    )).length;
    const success = result.success === true && report?.status !== 'failed';
    const failure = String(result.error || report?.error || result.message || '手动色卡执行失败。');

    return {
        version: MANUAL_SKU_COLOR_CARD_RESULT_VERSION,
        requestId: request.requestId,
        success,
        mode: request.mode,
        message: success
            ? buildSuccessMessage({ request, report, uniformScalePlacedCardCount })
            : failure,
        outputPath: report?.outputPath || request.outputPath,
        documentId: report?.documentId,
        sourceCount: report?.sourceCount || request.sources.length,
        preparedCardCount: preparedCards.length,
        uniformScalePlacedCardCount,
        retouchedCardCount: uniformScalePlacedCardCount,
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
            uniformScalePlacedCardCount: 0,
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
        message: request.mode === 'studio' ? '正在准备纯底统一尺度色卡...' : '正在准备 INS 卡片色卡...',
        stage: 'starting'
    });

    try {
        const result = await executeSkuColorCardStrategy({
            params: {
                stage: 'color-card',
                sources: request.sources,
                projectPath: request.outputFolder,
                outputPath: request.outputPath,
                colorCardDesignSpec: {
                    provenance: 'explicit_legacy_profile',
                    presentationMode: request.mode === 'studio' ? 'flat' : 'card',
                    showIndexNumbers: request.showIndexNumbers,
                    columns: request.columns
                },
                retouchMode: request.mode === 'studio' ? 'studio_retouch_required' : 'layout_only',
                sourceMode: request.mode === 'studio' ? 'studio' : 'scene'
            },
            context: {
                userInput: buildUserAuthorizationText(request),
                conversationHistory: [],
                isPluginConnected: true,
                projectContext: {
                    projectPath: request.outputFolder
                }
            },
            // 手动面板是确定性入口：源图、颜色名、输出路径都由用户在界面上直接指定，
            // 不存在模型猜测目标的问题。但色卡流程仍会新建圆角占位文档、切文档再切回，
            // 因此同样需要「写入目标绑定」把 documentId / historyStateRef 传给 Photoshop 执行层，
            // 否则结构写入会在 UXP 侧因缺少绑定被拒。绑定由本入口自己签发：文档是它建的，
            // 它比任何上游都清楚当前目标，不需要也不应该等 Agent 侧下发。
            guardedAtomicToolExecutor: createGuardedAtomicToolExecutor({
                userRequest: buildUserAuthorizationText(request),
                executeTool: (toolName, toolParams) => executeToolCall(toolName, toolParams)
            }),
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
        }, {
            manualLegacyProfile: MANUAL_SKU_COLOR_CARD_LEGACY_PROFILE_CAPABILITY
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
            uniformScalePlacedCardCount: 0,
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
