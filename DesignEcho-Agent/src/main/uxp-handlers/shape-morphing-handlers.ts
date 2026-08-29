/**
 * 形态统一 UXP 处理器
 *
 * 面向 UXP 面板的内部 operation。
 * 当前只接通面板主链，不暴露为普通用户聊天 skill。
 */

import sharp from 'sharp';

import { getLayoutRulesService } from '../services/layout-rules-service';
import { createSockMorphIntegration } from '../services/sock-morphing';
import { alignSkuRetouchPose, analyzeSkuRetouchShape } from '../services/sku-retouch/geometry';
import {
    ShapeMorphingOrchestrator,
    type ShapeMorphingParams,
    type ShapeMorphingResult
} from '../services/shape-morphing-orchestrator';
import type { UXPContext } from './types';
import type { WebSocketServer } from '../websocket/server';

type SupportedShapeMorphStep = 'align' | 'morph' | 'all';

function normalizeSockStyle(sockStyle: unknown): string {
    switch (String(sockStyle ?? '').trim()) {
        case 'boat':
            return 'no-show';
        default:
            return typeof sockStyle === 'string' && sockStyle.trim() ? sockStyle : 'crew';
    }
}

function normalizeCuffType(cuffType: unknown): string {
    switch (String(cuffType ?? '').trim()) {
        case 'double-welt':
            return 'double';
        case 'fold':
            return 'folded';
        default:
            return typeof cuffType === 'string' && cuffType.trim() ? cuffType : 'plain';
    }
}

function normalizeSelectedRegions(regions: unknown): string[] {
    if (!Array.isArray(regions)) {
        return [];
    }

    return Array.from(
        new Set(
            regions
                .map((region) => String(region))
                .map((region) => region === 'foot' ? 'body' : region)
                .filter(Boolean)
        )
    );
}

function normalizePreferredExecution(value: unknown): ShapeMorphingParams['preferredExecution'] {
    const normalized = String(value ?? '').trim();
    if (normalized === 'native-puppet' || normalized === 'auto') {
        return normalized;
    }
    return 'optimized-displacement';
}

function normalizeNativeFallback(value: unknown): ShapeMorphingParams['nativeFallback'] {
    const normalized = String(value ?? '').trim();
    if (normalized === 'optimized-displacement' || normalized === 'none') {
        return normalized;
    }
    return 'apply-morphed-image';
}

function normalizeShapeMorphingParams(params: Partial<ShapeMorphingParams> & {
    step?: string;
    qualityPreset?: 'fast' | 'balanced' | 'high';
}): ShapeMorphingParams {
    const referenceShapeId = Number(params.referenceShapeId);
    const productLayerIds = Array.isArray(params.productLayerIds)
        ? params.productLayerIds
            .map((id) => Number(id))
            .filter((id) => Number.isFinite(id))
        : [];

    const step = typeof params.step === 'string' ? params.step : 'morph';

    return {
        referenceShapeId,
        productLayerIds,
        step: step as ShapeMorphingParams['step'],
        preAlign: params.preAlign !== false,
        shapeMatch: params.shapeMatch !== false,
        edgeStrength: typeof params.edgeStrength === 'number' ? params.edgeStrength : 70,
        contentProtection: typeof params.contentProtection === 'number' ? params.contentProtection : 80,
        smoothness: typeof params.smoothness === 'number' ? params.smoothness : 50,
        selectedRegions: normalizeSelectedRegions(params.selectedRegions),
        sockStyle: normalizeSockStyle(params.sockStyle),
        cuffType: normalizeCuffType(params.cuffType),
        cuffProtected: params.cuffProtected === true,
        quality: params.qualityPreset ?? params.quality ?? 'balanced',
        useAdvancedDetection: params.useAdvancedDetection,
        useOptimizedMorphing: params.useOptimizedMorphing,
        forceRedetect: params.forceRedetect,
        preferredExecution: normalizePreferredExecution((params as any).preferredExecution),
        nativeFallback: normalizeNativeFallback((params as any).nativeFallback),
        intensity: params.intensity
    };
}

function isSupportedStep(step: string): step is SupportedShapeMorphStep {
    return step === 'align' || step === 'morph' || step === 'all';
}

function summarizeResult(result: ShapeMorphingResult, totalLayers: number, step: SupportedShapeMorphStep) {
    const successCount = result.results.filter((item) => item.success).length;
    return {
        ...result,
        step,
        totalLayers,
        successCount
    };
}

async function executeNativeWarpWorkflow(
    wsServer: WebSocketServer,
    params: ShapeMorphingParams
): Promise<ShapeMorphingResult & {
    nativeComparison?: any;
    nativeExecutions?: any[];
}> {
    const integration = createSockMorphIntegration({
        autoConvertToSmartObject: true,
        preserveOriginal: true,
        debug: true
    });
    const warnings: string[] = [];
    const executions: any[] = [];
    const results: ShapeMorphingResult['results'] = [];
    let nativeComparison: any;

    for (const layerId of params.productLayerIds) {
        const integrationResult = await integration.execute(
            layerId,
            params.referenceShapeId,
            (toolName: string, toolParams: any) => wsServer.sendRequest(toolName, toolParams, 120000),
            {
                cuffProtection: params.cuffProtected !== false,
                patternProtection: (params.contentProtection ?? 80) >= 40,
                matchIntensity: params.intensity ?? params.edgeStrength ?? 70
            }
        );

        if (integrationResult.comparison && !nativeComparison) {
            nativeComparison = integrationResult.comparison;
        }

        if (integrationResult.execution) {
            executions.push(integrationResult.execution);
            if (integrationResult.execution.fallbackReason) {
                warnings.push(integrationResult.execution.fallbackReason);
            }
        }

        if (integrationResult.success) {
            results.push({
                layerId: integrationResult.execution?.outputLayerId ?? layerId,
                success: true,
                method: integrationResult.execution?.actualMethod ?? 'native-puppet'
            });
        } else {
            results.push({
                layerId,
                success: false,
                error: integrationResult.error || '原生 Warp 执行失败'
            });
        }
    }

    const successCount = results.filter((item) => item.success).length;
    return {
        success: successCount > 0,
        results,
        message: `完成: ${successCount}/${params.productLayerIds.length} 个图层完成原生 Warp/Puppet 路线处理`,
        warnings: Array.from(new Set(warnings)),
        nativeComparison,
        nativeExecutions: executions
    };
}

/**
 * 注册形态统一相关 UXP handlers
 */
export function registerShapeMorphingUXPHandlers(context: UXPContext): void {
    const { wsServer, mattingService } = context;

    if (!wsServer) {
        console.log('[ShapeMorph UXP] WebSocket 未连接，跳过注册');
        return;
    }

    console.log('[ShapeMorph UXP] 注册形态统一 handlers...');

    wsServer.registerHandler('enhanced-shape-morph', async (rawParams: Partial<ShapeMorphingParams> & {
        step?: string;
        qualityPreset?: 'fast' | 'balanced' | 'high';
    }) => {
        try {
            if (!mattingService) {
                throw new Error('MattingService 未初始化，无法执行形态统一');
            }

            const params = normalizeShapeMorphingParams(rawParams ?? {});

            if (!Number.isFinite(params.referenceShapeId) || params.referenceShapeId <= 0) {
                throw new Error('referenceShapeId 无效');
            }

            if (params.productLayerIds.length === 0) {
                throw new Error('productLayerIds 为空');
            }

            const step = params.step ?? 'morph';

            if (!isSupportedStep(step)) {
                throw new Error(`当前仅支持 align / morph / all，收到: ${String(params.step)}`);
            }

            const layoutRulesService = await getLayoutRulesService().catch(() => undefined);
            const orchestrator = new ShapeMorphingOrchestrator(
                wsServer,
                mattingService,
                layoutRulesService
            );

            const result =
                step !== 'align' && (params.preferredExecution === 'native-puppet' || params.preferredExecution === 'auto')
                    ? await executeNativeWarpWorkflow(wsServer, params)
                    : step === 'align'
                        ? await orchestrator.executeAlignment(params)
                        : await orchestrator.executeFullMorphing(params);

            return summarizeResult(result, params.productLayerIds.length, step);
        } catch (error: any) {
            console.error('[ShapeMorph UXP] 错误:', error.message);
            return {
                success: false,
                step: rawParams?.step ?? 'morph',
                totalLayers: Array.isArray(rawParams?.productLayerIds) ? rawParams.productLayerIds.length : 0,
                successCount: 0,
                results: [],
                error: error.message || '形态统一处理失败'
            };
        }
    });

    // 姿态统一（骨架拉直）：面板主入口的新实现（round-trip 实证方案，2026-08）。
    // 同尺寸整幅进出（导出图层→同画布内拉直→原位回贴），从机制上规避老链
    // 「裁剪主体图对位原图层 bounds」造成的位置漂移；不需要参考形状图层。
    wsServer.registerHandler('pose-align-layers', async (rawParams: {
        layerIds?: unknown;
        strength?: unknown;
        cuffLockRatio?: unknown;
        referenceFrameLayerId?: unknown;
    }) => {
        const layerIds = Array.isArray(rawParams?.layerIds)
            ? rawParams.layerIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
            : [];
        if (layerIds.length === 0) {
            return { success: false, results: [], error: '没有可处理的图层：请先选择产品图层。' };
        }
        const strengthRaw = Number(rawParams?.strength);
        const cuffRaw = Number(rawParams?.cuffLockRatio);
        const options = {
            strength: Number.isFinite(strengthRaw) ? Math.max(0, Math.min(1, strengthRaw)) : 1,
            cuffLockRatio: Number.isFinite(cuffRaw) ? Math.max(0, Math.min(0.4, cuffRaw)) : 0,
            maxIterations: 3
        };
        // 用户画的占位矩形（可选）：所有袜子主体先等比对到该框（位置+尺度），
        // 再统一姿态——用户工艺「这个矩形代表着袜子的边框大小」的代码化。
        let frame: { centerX: number; centerY: number; width: number; height: number } | null = null;
        const frameLayerId = Number(rawParams?.referenceFrameLayerId);
        if (Number.isFinite(frameLayerId) && frameLayerId > 0) {
            const frameResult = await wsServer.sendRequest('getLayerBounds', { layerId: frameLayerId });
            const rawBounds = frameResult?.boundsNoEffects || frameResult?.bounds
                || frameResult?.data?.boundsNoEffects || frameResult?.data?.bounds;
            if (frameResult?.success && rawBounds) {
                const left = Number(rawBounds.left ?? rawBounds.x);
                const top = Number(rawBounds.top ?? rawBounds.y);
                const width = Number(rawBounds.width ?? (Number(rawBounds.right) - left));
                const height = Number(rawBounds.height ?? (Number(rawBounds.bottom) - top));
                if (Number.isFinite(width) && Number.isFinite(height) && width > 4 && height > 4) {
                    frame = { centerX: left + width / 2, centerY: top + height / 2, width, height };
                }
            }
        }
        const results: Array<Record<string, unknown>> = [];
        for (const layerId of layerIds) {
            try {
                const exported = await wsServer.sendRequest('exportLayerAsBase64', {
                    layerId,
                    format: 'png',
                    maxSize: 8192
                });
                const base64: string = String(exported?.data?.base64 || '').split('|||')[0];
                if (!exported?.success || !base64) {
                    results.push({ layerId, success: false, applied: false, error: '图层像素导出失败。' });
                    continue;
                }
                const fullDecoded = await sharp(Buffer.from(base64, 'base64')).ensureAlpha().raw()
                    .toBuffer({ resolveWithObject: true });
                const fullWidth = fullDecoded.info.width;
                const fullHeight = fullDecoded.info.height;
                const fullRgba = fullDecoded.data;
                // 效率纪律（同离线链 maxLongEdge）：骨架分析与 BiRefNet 在工作分辨率上做，
                // 复合映射是解析函数，最终采样在原分辨率一次完成——质量无损、速度可控。
                const WORK_LONG_EDGE = 1600;
                const workScale = Math.min(1, WORK_LONG_EDGE / Math.max(fullWidth, fullHeight));
                const workDecoded = workScale < 1
                    ? await sharp(fullRgba, { raw: { width: fullWidth, height: fullHeight, channels: 4 } })
                        .resize({ width: Math.round(fullWidth * workScale), kernel: sharp.kernel.lanczos3 })
                        .raw().toBuffer({ resolveWithObject: true })
                    : { data: fullRgba, info: { width: fullWidth, height: fullHeight } };
                const width = workDecoded.info.width;
                const height = workDecoded.info.height;
                const rgba = workDecoded.data;
                // mask：透明图层（已抠图）直接用 alpha；不透明图层走 BiRefNet 分割（工作分辨率）
                let transparentCount = 0;
                for (let i = 0; i < width * height; i += 1) {
                    if (rgba[i * 4 + 3] < 250) transparentCount += 1;
                }
                const isTransparentLayer = transparentCount / (width * height) > 0.03;
                let mask: Buffer;
                let fullMask: Buffer;
                if (isTransparentLayer) {
                    mask = Buffer.alloc(width * height);
                    for (let i = 0; i < width * height; i += 1) mask[i] = rgba[i * 4 + 3] >= 128 ? 255 : 0;
                    fullMask = Buffer.alloc(fullWidth * fullHeight);
                    for (let i = 0; i < fullWidth * fullHeight; i += 1) fullMask[i] = fullRgba[i * 4 + 3] >= 128 ? 255 : 0;
                } else {
                    if (!mattingService) {
                        results.push({ layerId, success: false, applied: false, error: '图层不含透明背景且 BiRefNet 抠图服务未初始化，无法确定主体。' });
                        continue;
                    }
                    const workPng = await sharp(rgba, { raw: { width, height, channels: 4 } })
                        .png().toBuffer();
                    const matting = await mattingService.removeBackground(workPng.toString('base64'), {
                        quality: 'quality',
                        returnMask: true,
                        binaryMaskOutput: true,
                        originalWidth: width,
                        originalHeight: height,
                        edgeRefine: 'quality'
                    });
                    if (!matting.success || !matting.maskBuffer || matting.maskWidth !== width || matting.maskHeight !== height) {
                        results.push({ layerId, success: false, applied: false, error: `主体分割失败：${matting.error || '蒙版无效'}` });
                        continue;
                    }
                    mask = matting.maskBuffer;
                    const fullMaskResult = await sharp(mask, { raw: { width, height, channels: 1 } })
                        .resize(fullWidth, fullHeight, { fit: 'fill', kernel: sharp.kernel.cubic })
                        .raw().toBuffer({ resolveWithObject: true });
                    fullMask = Buffer.alloc(fullWidth * fullHeight);
                    for (let i = 0; i < fullWidth * fullHeight; i += 1) {
                        fullMask[i] = fullMaskResult.data[i * fullMaskResult.info.channels] >= 128 ? 255 : 0;
                    }
                }
                const rgb = Buffer.alloc(width * height * 3);
                for (let i = 0; i < width * height; i += 1) {
                    rgb[i * 3] = rgba[i * 4];
                    rgb[i * 3 + 1] = rgba[i * 4 + 1];
                    rgb[i * 3 + 2] = rgba[i * 4 + 2];
                }
                const fullRgb = Buffer.alloc(fullWidth * fullHeight * 3);
                for (let i = 0; i < fullWidth * fullHeight; i += 1) {
                    fullRgb[i * 3] = fullRgba[i * 4];
                    fullRgb[i * 3 + 1] = fullRgba[i * 4 + 1];
                    fullRgb[i * 3 + 2] = fullRgba[i * 4 + 2];
                }
                const shape = analyzeSkuRetouchShape(mask, width, height);
                const outcome = alignSkuRetouchPose({
                    raster: { data: rgb, width, height, channels: 3 },
                    mask,
                    shape,
                    options,
                    fullResolution: workScale < 1
                        ? {
                            raster: { data: fullRgb, width: fullWidth, height: fullHeight, channels: 3 },
                            mask: fullMask,
                            scale: 1 / workScale
                        }
                        : undefined
                });
                // 主体对框（用户占位矩形工艺）：缩放走 PS 内变换不重采样图像，定位按主体中心
                const fitSubjectToFrame = async (fitLayerId: number, subjectWidth: number, subjectHeight: number): Promise<boolean> => {
                    if (!frame) return false;
                    const scale = Math.min(frame.width / Math.max(1, subjectWidth), frame.height / Math.max(1, subjectHeight)) * 0.98;
                    if (Math.abs(scale - 1) > 0.01) {
                        const scaled = await wsServer.sendRequest('transformLayer', {
                            layerId: fitLayerId,
                            scaleUniform: scale * 100
                        });
                        if (!scaled?.success) return false;
                    }
                    const after = await wsServer.sendRequest('getSubjectBounds', { layerId: fitLayerId, method: 'alpha' });
                    const afterBounds = after?.data?.bounds;
                    let subjectCenterX: number;
                    let subjectCenterY: number;
                    if (after?.success && Number.isFinite(Number(afterBounds?.centerX))) {
                        subjectCenterX = Number(afterBounds.centerX);
                        subjectCenterY = Number(afterBounds.centerY);
                    } else {
                        const layerBoundsResult = await wsServer.sendRequest('getLayerBounds', { layerId: fitLayerId });
                        const lb = layerBoundsResult?.boundsNoEffects || layerBoundsResult?.bounds;
                        if (!layerBoundsResult?.success || !lb) return false;
                        subjectCenterX = (Number(lb.left) + Number(lb.right)) / 2;
                        subjectCenterY = (Number(lb.top) + Number(lb.bottom)) / 2;
                    }
                    const moved = await wsServer.sendRequest('moveLayer', {
                        layerId: fitLayerId,
                        x: frame.centerX - subjectCenterX,
                        y: frame.centerY - subjectCenterY,
                        relative: true
                    });
                    return moved?.success === true;
                };

                if (!outcome.report.applied) {
                    // 姿态无需矫正；若给了占位矩形，仍把原图层主体对框（用户工艺第一步）。
                    // shape 是工作坐标，主体尺寸换算回文档分辨率再与框比较。
                    const fitted = frame
                        ? await fitSubjectToFrame(layerId, shape.bounds.width / workScale, shape.bounds.height / workScale)
                        : false;
                    results.push({
                        layerId,
                        success: true,
                        applied: false,
                        fitApplied: fitted,
                        skippedReason: outcome.report.skippedReason || '姿态已经足够直，无需矫正。'
                    });
                    continue;
                }
                // outcome 在有 fullResolution 时是原分辨率产物；回贴尺寸跟随 outcome
                const outWidth = outcome.raster.width;
                const outHeight = outcome.raster.height;
                const outRgba = Buffer.alloc(outWidth * outHeight * 4);
                for (let i = 0; i < outWidth * outHeight; i += 1) {
                    outRgba[i * 4] = outcome.raster.data[i * 3];
                    outRgba[i * 4 + 1] = outcome.raster.data[i * 3 + 1];
                    outRgba[i * 4 + 2] = outcome.raster.data[i * 3 + 2];
                    outRgba[i * 4 + 3] = outcome.mask[i];
                }
                const outPng = await sharp(outRgba, { raw: { width: outWidth, height: outHeight, channels: 4 } })
                    .png({ compressionLevel: 7 }).toBuffer();
                const applyResult = await wsServer.sendRequest('applyMorphedImage', {
                    layerId,
                    imageBase64: outPng.toString('base64'),
                    mode: 'replace',
                    preserveOriginal: true,
                    resultLayerName: undefined
                });
                if (!applyResult?.success) {
                    results.push({ layerId, success: false, applied: false, error: `拉直结果回贴失败：${applyResult?.error || '未知原因'}` });
                    continue;
                }
                const outputLayerId = applyResult?.data?.outputLayerId;
                await wsServer.sendRequest('setLayerVisibility', { layerId, visible: false }).catch(() => undefined);
                // 拉直后的主体对框（占位矩形工艺）：主体尺寸取拉直后 mask 的真实范围
                let fitted = false;
                if (frame && Number.isFinite(Number(outputLayerId))) {
                    const alignedShape = analyzeSkuRetouchShape(outcome.mask, outWidth, outHeight);
                    fitted = await fitSubjectToFrame(
                        Number(outputLayerId),
                        alignedShape.bounds.width,
                        alignedShape.bounds.height
                    );
                }
                results.push({
                    layerId,
                    success: true,
                    applied: true,
                    fitApplied: fitted,
                    outputLayerId,
                    iterations: outcome.report.iterations,
                    initialShiftPx: outcome.report.initialShiftPx,
                    residualShiftPx: outcome.report.residualShiftPx
                });
            } catch (error: any) {
                results.push({ layerId, success: false, applied: false, error: error?.message || String(error) });
            }
        }
        const appliedCount = results.filter((item) => item.applied === true).length;
        const okCount = results.filter((item) => item.success === true).length;
        return {
            // 面板兼容字段：success/successCount/results[].success/warnings 与老 handler 同构
            success: okCount > 0,
            totalLayers: layerIds.length,
            successCount: okCount,
            appliedCount,
            results,
            warnings: results
                .filter((item) => item.skippedReason)
                .map((item) => `图层 ${item.layerId}：${item.skippedReason}`)
        };
    });

    console.log('[ShapeMorph UXP] ✅ 形态统一 handlers 注册完成');
}
