/**
 * 主图设计技能执行器
 *
 * 完整闭环链路：
 *   文档检查 → 品牌/规范加载 → 主体检测 → 审美决策 → 逐规格布局+导出 → Critique
 */

import type { SkillExecutor, SkillExecuteParams } from './types';
import type { AgentResult } from '../unified-agent.service';
import type { DesignPlan } from './design-plan';

import { executeToolCall } from '../tool-executor.service';
import { collectDesignContext, createPipeline, getDeltaArrow } from './design-pipeline';
import { buildDesignIntent, buildDesignPlan } from './design-plan';
import { extractPlanSteps, createTracer, getStepParams } from './plan-helpers';
import { getEffectiveBrandSpec, getMainImageSpec, getPlatformRules } from './knowledge-query';

// ==================== 常量 & 类型 ====================

const SIZE_SPECS: Record<string, { width: number; height: number }> = {
    '800': { width: 800, height: 800 },
    '750': { width: 750, height: 750 },
    '1200': { width: 1200, height: 1000 },
    '3:4': { width: 750, height: 1000 },
};

interface AestheticResult {
    scale: number;
    position: { x: number; y: number; anchor: string };
    reason: string;
    confidence: number;
    referencedKnowledge: string[];
}

interface PlanExecutionFlags {
    useSubjectDetection: boolean;
    useSmartLayout: boolean;
    useQuickExport: boolean;
}

// ==================== 审美决策 ====================

async function requestAestheticDecision(
    canvasSize: { width: number; height: number },
    subjectSize: { width: number; height: number },
    options?: { preferredStyle?: string; userIntent?: string }
): Promise<AestheticResult | null> {
    try {
        const result = await window.designEcho?.invoke?.('aesthetic:makeDecision', {
            designType: 'mainImage',
            canvas: { width: canvasSize.width, height: canvasSize.height },
            asset: { id: 'main-subject', width: subjectSize.width, height: subjectSize.height },
            preferredStyle: options?.preferredStyle,
            userIntent: options?.userIntent,
        });
        if (result?.success && result.result?.success) return result.result as AestheticResult;
    } catch (e) {
        console.warn('[MainImageExecutor] 审美决策调用失败，使用规则回退:', e);
    }
    return null;
}

// ==================== 布局计算 ====================

function fallbackLayout(
    canvas: { width: number; height: number },
    subject: { width: number; height: number },
    productScale: number,
    verticalOffset: number
): { scale: number; targetX: number; targetY: number } {
    const targetW = canvas.width * productScale;
    const targetH = canvas.height * productScale;
    const scale = Math.min(targetW / subject.width, targetH / subject.height);
    const scaledW = subject.width * scale;
    const scaledH = subject.height * scale;
    return {
        scale,
        targetX: (canvas.width - scaledW) / 2,
        targetY: (canvas.height - scaledH) / 2 + canvas.height * verticalOffset,
    };
}

function scoreLayoutCandidate(
    candidate: { scale: number; targetX: number; targetY: number },
    canvas: { width: number; height: number },
    subject: { width: number; height: number },
    preferredFill: number
): number {
    const scaledW = subject.width * candidate.scale;
    const scaledH = subject.height * candidate.scale;

    const fill = Math.max(scaledW / canvas.width, scaledH / canvas.height);
    const fillScore = 100 - Math.min(80, Math.abs(fill - preferredFill) * 220);

    const idealX = (canvas.width - scaledW) / 2;
    const centerPenalty = Math.min(30, Math.abs(candidate.targetX - idealX) / Math.max(1, canvas.width) * 100);

    const top = candidate.targetY;
    const bottom = candidate.targetY + scaledH;
    const safeTop = canvas.height * 0.04;
    const safeBottom = canvas.height * 0.97;
    let safePenalty = 0;
    if (top < safeTop) safePenalty += (safeTop - top) / Math.max(1, canvas.height) * 160;
    if (bottom > safeBottom) safePenalty += (bottom - safeBottom) / Math.max(1, canvas.height) * 160;

    return Math.max(0, Math.min(100, fillScore - centerPenalty - safePenalty));
}

function chooseBestLayoutCandidate(
    base: { scale: number; targetX: number; targetY: number },
    canvas: { width: number; height: number },
    subject: { width: number; height: number },
    preferredFill: number,
    verticalOffset: number
): { scale: number; targetX: number; targetY: number; score: number; reason: string } {
    const scaleMultipliers = [0.9, 0.95, 1, 1.05, 1.1];
    const offsetAdjustments = [-0.03, -0.015, 0, 0.015, 0.03];

    let best = {
        ...base,
        score: scoreLayoutCandidate(base, canvas, subject, preferredFill),
        reason: 'fallback-base',
    };

    for (const sm of scaleMultipliers) {
        const scale = Math.max(0.1, base.scale * sm);
        const scaledW = subject.width * scale;
        const scaledH = subject.height * scale;
        const targetX = (canvas.width - scaledW) / 2;

        for (const dy of offsetAdjustments) {
            const targetY = (canvas.height - scaledH) / 2 + canvas.height * (verticalOffset + dy);
            const score = scoreLayoutCandidate({ scale, targetX, targetY }, canvas, subject, preferredFill);
            if (score > best.score) {
                best = { scale, targetX, targetY, score, reason: `sm=${sm.toFixed(2)}, dy=${dy.toFixed(3)}` };
            }
        }
    }

    return best;
}

// ==================== AI 背景生成 ====================

async function generateAIBackground(
    prompt: string,
    size: { width: number; height: number },
    callbacks?: any
): Promise<string | null> {
    try {
        const hasKey = await window.designEcho?.invoke?.('bfl:hasApiKey');
        if (!hasKey?.hasKey) return null;
        callbacks?.onMessage?.(`🎨 AI 生成背景: "${prompt.substring(0, 40)}..."`);
        const result = await window.designEcho?.bfl?.text2image?.(
            'flux-2-klein-4b', prompt, { width: size.width, height: size.height, steps: 4 }
        );
        if (result?.success && result.data?.url) {
            const downloaded = await window.designEcho?.bfl?.downloadImage?.(result.data.url);
            if (downloaded?.success && downloaded.data) return downloaded.data as string;
        }
    } catch (e) {
        console.warn('[MainImageExecutor] BFL 背景生成失败:', e);
    }
    return null;
}

// ==================== 单规格处理 ====================

async function processOneSize(
    sizeKey: string,
    targetSize: { width: number; height: number },
    subjectSize: { width: number; height: number },
    docInfo: any,
    params: Record<string, any>,
    callbacks: any,
    signal: AbortSignal | undefined,
    results: any[],
    planFlags: PlanExecutionFlags
): Promise<{ success: boolean; scale: number; aestheticUsed: boolean; reason?: string }> {

    const userProductScale = params.productScale as number | undefined;
    const verticalOffset = (params.verticalOffset as number) || -0.03;
    const preferredStyle = params.preferredStyle as string | undefined;
    const imageType = params.imageType || 'click';
    const outputDir = params.outputDir as string | undefined;
    const brandRatio = params._brandProductRatio as { min: number; max: number } | undefined;
    const mainImageSpecRatio = params._mainImageSpecRatio as { min: number; max: number } | undefined;

    // --- 布局决策 ---
    let scale: number;
    let targetX: number;
    let targetY: number;
    let aestheticUsed = false;
    let decisionReason = '';

    if (userProductScale !== undefined) {
        const fb = fallbackLayout(targetSize, subjectSize, userProductScale, verticalOffset);
        scale = fb.scale; targetX = fb.targetX; targetY = fb.targetY;
        decisionReason = `用户指定占比 ${Math.round(userProductScale * 100)}%`;
    } else {
        const aesthetic = await requestAestheticDecision(
            targetSize, subjectSize, { preferredStyle, userIntent: params.userIntent as string | undefined }
        );
        if (aesthetic && aesthetic.confidence >= 0.4) {
            scale = aesthetic.scale; targetX = aesthetic.position.x; targetY = aesthetic.position.y;
            aestheticUsed = true;
            decisionReason = aesthetic.reason;
        } else {
            const activeRatio = brandRatio || mainImageSpecRatio;
            const defaultScale = activeRatio ? (activeRatio.min + activeRatio.max) / 2 : 0.65;
            const fb = fallbackLayout(targetSize, subjectSize, defaultScale, verticalOffset);
            scale = fb.scale; targetX = fb.targetX; targetY = fb.targetY;
            decisionReason = brandRatio ? `品牌规范占比 ${Math.round(defaultScale * 100)}%`
                : mainImageSpecRatio ? `主图规范占比 ${Math.round(defaultScale * 100)}%`
                : '默认 65% 占比居中';
        }
    }

    // 候选布局搜索
    const enableLayoutSearch = params.layoutSearch !== false;
    if (enableLayoutSearch) {
        const preferredFill = userProductScale ?? (brandRatio ? (brandRatio.min + brandRatio.max) / 2 : 0.65);
        const best = chooseBestLayoutCandidate({ scale, targetX, targetY }, targetSize, subjectSize, preferredFill, verticalOffset);
        scale = best.scale; targetX = best.targetX; targetY = best.targetY;
        decisionReason = `${decisionReason}；候选评分 ${best.score.toFixed(1)}`;
        callbacks?.onMessage?.(`  🧪 候选布局选优: 评分 ${best.score.toFixed(1)} (${best.reason})`);
    }

    callbacks?.onMessage?.(`  🧠 决策依据: ${decisionReason}`);
    callbacks?.onMessage?.(`  📊 ${sizeKey} (${targetSize.width}×${targetSize.height}): 缩放 ${Math.round(scale * 100)}%`);

    if (signal?.aborted) return { success: true, scale, aestheticUsed };

    // --- 执行布局 ---
    const activeLayer = docInfo.activeLayer;
    const smartLayoutStepParams = (params._smartLayoutStepParams || {}) as Record<string, any>;

    if (planFlags.useSmartLayout) {
        const fillRatio = Math.max(0.5, Math.min(0.95,
            (scale * Math.max(subjectSize.width, subjectSize.height)) / Math.max(targetSize.width, targetSize.height)
        ));
        const layoutResult = await executeToolCall('smartLayout', {
            ...smartLayoutStepParams,
            action: (smartLayoutStepParams.action as string) || 'applyLayout',
            targetBounds: { left: 0, top: 0, width: targetSize.width, height: targetSize.height },
            config: { fillRatio, alignment: 'center', maintainAspectRatio: true, ...(smartLayoutStepParams.config || {}) },
        });
        results.push({ toolName: `smartLayout[${sizeKey}]`, result: layoutResult });
        if (!layoutResult?.success && activeLayer?.id) {
            const transformResult = await executeToolCall('transformLayer', { layerId: activeLayer.id, scaleUniform: scale * 100 });
            results.push({ toolName: `transformLayer[${sizeKey}]`, result: transformResult });
        }
    } else if (activeLayer?.id) {
        callbacks?.onMessage?.(`  ↪ 跳过 smartLayout，使用规则缩放`);
        const transformResult = await executeToolCall('transformLayer', { layerId: activeLayer.id, scaleUniform: scale * 100 });
        results.push({ toolName: `transformLayer[${sizeKey}]`, result: transformResult });
    }

    // 绝对位置校准
    if (activeLayer?.id) {
        const moveResult = await executeToolCall('moveLayer', { layerId: activeLayer.id, x: targetX, y: targetY, relative: false });
        results.push({ toolName: `moveLayer[${sizeKey}]`, result: moveResult });
    }

    // --- AI 背景 (可选) ---
    const bgPrompt = params.backgroundPrompt as string | undefined;
    if (bgPrompt) {
        const bgBase64 = await generateAIBackground(bgPrompt, targetSize, callbacks);
        if (bgBase64) {
            const placeResult = await executeToolCall('placeImage', { imageData: bgBase64, position: 'behind', name: `AI-Background-${sizeKey}` });
            results.push({ toolName: `placeBackground[${sizeKey}]`, result: placeResult });
            if (placeResult?.success) {
                callbacks?.onMessage?.(`  ✓ AI 背景已置入`);
                const harmonizeResult = await executeToolCall('harmonizeLayer', { intensity: 0.6 });
                results.push({ toolName: `harmonize[${sizeKey}]`, result: harmonizeResult });
            }
        }
    }

    // --- 导出 ---
    if (outputDir && planFlags.useQuickExport) {
        const quickExportStepParams = (params._quickExportStepParams || {}) as Record<string, any>;
        const { subfolder: exportSub, fileNamePattern: exportPattern, ...quickExportToolParams } = quickExportStepParams;
        const format = typeof quickExportToolParams.format === 'string' ? quickExportToolParams.format : 'jpg';
        const quality = typeof quickExportToolParams.quality === 'number' ? quickExportToolParams.quality : 12;
        const subfolder = typeof exportSub === 'string' && exportSub.trim() ? exportSub : '主图';
        const pattern = typeof exportPattern === 'string' && exportPattern.trim() ? exportPattern : '主图_{size}_{imageType}.{format}';
        const fileName = pattern.replace('{size}', sizeKey).replace('{imageType}', imageType).replace('{format}', format);
        const exportResult = await executeToolCall('quickExport', {
            ...quickExportToolParams, format, quality, outputPath: `${outputDir}\\${subfolder}\\${fileName}`,
        });
        results.push({ toolName: `quickExport[${sizeKey}]`, result: exportResult });
        if (exportResult?.success) callbacks?.onMessage?.(`  ✓ 已导出: ${fileName}`);
    } else if (outputDir && !planFlags.useQuickExport) {
        callbacks?.onMessage?.(`  ↪ 计划未包含 quickExport，跳过导出`);
    }

    return { success: true, scale, aestheticUsed, reason: decisionReason };
}

// ==================== 执行器 ====================

export const mainImageExecutor: SkillExecutor = {
    skillId: 'main-image-design',

    async execute({ params, callbacks, signal, context }: SkillExecuteParams): Promise<AgentResult> {
        const results: any[] = [];

        const sizesParam = params.sizes as string[] | undefined;
        const singleSize = params.size as string || '800';
        const sizeKeys = sizesParam && sizesParam.length > 0 ? sizesParam : [singleSize];
        const imageType = params.imageType || 'click';

        callbacks?.onMessage?.(`📐 主图设计: ${sizeKeys.length} 个规格 (${sizeKeys.join(', ')})`);

        try {
            const designIntent = buildDesignIntent(this.skillId, params, context);
            const designPlan: DesignPlan = buildDesignPlan(designIntent);
            const { stepMap, has } = extractPlanSteps(designPlan);
            const tracer = createTracer(designPlan.steps || designPlan.layoutSteps || []);

            const planFlags: PlanExecutionFlags = {
                useSubjectDetection: has('getSubjectBounds'),
                useSmartLayout: has('smartLayout'),
                useQuickExport: has('quickExport'),
            };

            (params as any)._smartLayoutStepParams = getStepParams(stepMap, 'smartLayout');
            (params as any)._quickExportStepParams = getStepParams(stepMap, 'quickExport');

            // 1. 检查文档
            callbacks?.onProgress?.('检查文档...', 0.05);
            const docInfo = await executeToolCall('getDocumentInfo', {});
            if (!docInfo?.success) {
                return { success: false, message: '❌ **请先打开 Photoshop 文档**', error: 'No document open' };
            }
            callbacks?.onMessage?.(`📄 文档: ${docInfo.name} (${docInfo.width}×${docInfo.height})`);
            results.push({ toolName: 'getDocumentInfo', result: docInfo });
            if (signal?.aborted) return { success: true, cancelled: true, message: '⏹️ 已停止' };

            // 2. 加载品牌/平台规范
            const projectPath = (designIntent.projectPath || params.projectPath) as string | undefined;
            const brandSpec = await getEffectiveBrandSpec(projectPath);
            if (brandSpec && brandSpec.id !== 'default') {
                callbacks?.onMessage?.(`🎨 品牌规范: ${brandSpec.name} (${brandSpec.tone})`);
                if (!params.productScale && brandSpec.layout?.productRatio) {
                    params._brandProductRatio = brandSpec.layout.productRatio;
                }
            }
            const platform = (params.platform || '电商') as string;
            const mainImageSpec = await getMainImageSpec(String(imageType), platform);
            if (!params.productScale && !params._brandProductRatio && mainImageSpec?.productRatio) {
                params._mainImageSpecRatio = mainImageSpec.productRatio;
            }
            if (mainImageSpec) {
                callbacks?.onMessage?.(`📐 主图规范已加载: ${mainImageSpec.imageType}`);
                if (mainImageSpec.requiredSections?.length) {
                    callbacks?.onMessage?.(`📌 必选结构: ${mainImageSpec.requiredSections.join('、')}`);
                }
                if (mainImageSpec.recommendedSections?.length) {
                    callbacks?.onMessage?.(`🧩 推荐结构: ${mainImageSpec.recommendedSections.join('、')}`);
                }
            }
            const platformRules = await getPlatformRules(platform);
            if (platformRules?.rules?.length) {
                callbacks?.onMessage?.(`🧾 平台规范要点: ${platformRules.rules.slice(0, 2).join('；')}`);
            }

            // 3. 检测产品主体
            callbacks?.onProgress?.('检测产品主体...', 0.15);
            callbacks?.onMessage?.('🔍 检测产品主体...');

            let subjectBounds: any;
            if (planFlags.useSubjectDetection) {
                const boundsParams = getStepParams(stepMap, 'getSubjectBounds');
                const boundsResult = await executeToolCall('getSubjectBounds', boundsParams);
                results.push({ toolName: 'getSubjectBounds', result: boundsResult });
                if (!boundsResult?.success || !boundsResult.bounds) {
                    tracer.upsert('getSubjectBounds', 'fallback', '主体识别失败，回退到 getLayerBounds');
                    callbacks?.onMessage?.('⚠️ 未检测到产品主体，尝试使用当前图层...');
                    const layerBounds = await executeToolCall('getLayerBounds', { useActive: true });
                    results.push({ toolName: 'getLayerBounds', result: layerBounds });
                    if (!layerBounds?.success || !layerBounds.bounds) {
                        return { success: false, message: '❌ **无法检测产品主体**', error: 'Cannot detect subject bounds' };
                    }
                    subjectBounds = layerBounds.bounds;
                } else {
                    subjectBounds = boundsResult.bounds || boundsResult;
                    tracer.upsert('getSubjectBounds', 'success');
                }
            } else {
                tracer.upsert('getSubjectBounds', 'skipped', '计划未包含');
                const layerBounds = await executeToolCall('getLayerBounds', { useActive: true });
                results.push({ toolName: 'getLayerBounds', result: layerBounds });
                if (!layerBounds?.success || !layerBounds.bounds) {
                    return { success: false, message: '❌ **无法检测产品主体**', error: 'Cannot detect subject bounds' };
                }
                subjectBounds = layerBounds.bounds;
            }

            const subjectWidth = subjectBounds.right - subjectBounds.left;
            const subjectHeight = subjectBounds.bottom - subjectBounds.top;
            callbacks?.onMessage?.(`✓ 产品尺寸: ${Math.round(subjectWidth)}×${Math.round(subjectHeight)}`);
            if (signal?.aborted) return { success: true, cancelled: true, message: '⏹️ 已停止' };

            // 4. Critique 前诊断
            callbacks?.onProgress?.('设计诊断...', 0.22);
            const designCtx = await collectDesignContext({ platform: 'ecommerce', userIntent: params.userIntent as string | undefined });
            const pipeline = createPipeline(designCtx, { onMessage: callbacks?.onMessage });
            const beforeReport = await pipeline.before();

            // 5. 逐规格处理
            const sizeResults: { key: string; scale: number; aestheticUsed: boolean; reason?: string }[] = [];
            for (let i = 0; i < sizeKeys.length; i++) {
                const sizeKey = sizeKeys[i];
                const targetSize = SIZE_SPECS[sizeKey];
                if (!targetSize) { callbacks?.onMessage?.(`  ⚠️ 跳过未知规格: ${sizeKey}`); continue; }

                callbacks?.onProgress?.(`处理规格 ${sizeKey} (${i + 1}/${sizeKeys.length})...`, 0.2 + (i / sizeKeys.length) * 0.7);

                const oneResult = await processOneSize(
                    sizeKey, targetSize, { width: subjectWidth, height: subjectHeight },
                    docInfo, params, callbacks, signal, results, planFlags
                );
                sizeResults.push({ key: sizeKey, ...oneResult });
                if (signal?.aborted) return { success: true, cancelled: true, message: '⏹️ 已停止' };
            }

            // 6. Critique 后评估
            callbacks?.onProgress?.('设计评估...', 0.93);
            const critiqueResult = await pipeline.after(beforeReport);

            // 7. 汇总
            callbacks?.onProgress?.('完成', 1.0);

            const anyAesthetic = sizeResults.some(r => r.aestheticUsed);
            const summary = ['✅ **主图设计完成**', ''];

            for (const sr of sizeResults) {
                const spec = SIZE_SPECS[sr.key];
                summary.push(`**${sr.key}** (${spec.width}×${spec.height}): 缩放 ${Math.round(sr.scale * 100)}%`
                    + (sr.reason ? ` — ${sr.reason}` : ''));
            }

            const typeLabel = imageType === 'click' ? '点击图' : imageType === 'conversion' ? '转化图' : '白底图';
            summary.push('', `**图片类型：** ${typeLabel}`);
            if (params.outputDir) summary.push(`**导出位置：** ${params.outputDir}\\主图\\`);

            if (critiqueResult) {
                const arrow = getDeltaArrow(critiqueResult.delta);
                summary.push(`🔍 **设计评估**：${critiqueResult.beforeScore} → ${critiqueResult.afterScore} (${arrow}${Math.abs(critiqueResult.delta)})`);
            }

            // 更新 tracer
            const smartLayoutRuns = results.filter((r: any) => (r?.toolName || '').startsWith('smartLayout[')).length;
            const quickExportRuns = results.filter((r: any) => (r?.toolName || '').startsWith('quickExport[')).length;
            tracer.upsert('smartLayout', planFlags.useSmartLayout ? (smartLayoutRuns > 0 ? 'success' : 'failed') : 'skipped');
            tracer.upsert('quickExport',
                planFlags.useQuickExport ? (params.outputDir ? (quickExportRuns > 0 ? 'success' : 'failed') : 'skipped') : 'skipped'
            );

            return {
                success: true,
                message: summary.join('\n'),
                toolResults: results,
                data: { sizeResults, aestheticDecisionUsed: anyAesthetic, critique: critiqueResult },
            };

        } catch (e: any) {
            console.error('[MainImageExecutor] 执行失败:', e);
            return { success: false, message: `❌ 主图设计失败: ${e.message}`, error: e.message, toolResults: results };
        }
    },
};
