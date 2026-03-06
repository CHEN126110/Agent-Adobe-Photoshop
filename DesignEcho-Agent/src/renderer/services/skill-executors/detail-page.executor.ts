/**
 * 详情页设计技能执行器
 *
 * 完整闭环链路：
 *   解析模板 → 检测问题 → 自动修复 → 匹配内容 → 文案处理 → 逐屏填充 → 对齐修正 → 导出切片 → Critique
 */

import type { SkillExecutor, SkillExecuteParams } from './types';
import type { AgentResult } from '../unified-agent.service';
import type { ParsedScreen, FillPlan, LayerIssue, CopyPlaceholder } from './detail-page.types';
import type { CritiqueResult } from './design-pipeline';

import { executeToolCall } from '../tool-executor.service';
import { collectDesignContext, createPipeline, getDeltaArrow } from './design-pipeline';
import { buildDesignIntent, buildDesignPlan } from './design-plan';
import { extractPlanSteps, createTracer, getStepParams } from './plan-helpers';
import {
    clamp01,
    calculatePlanQuality,
    alignFillPlansToScreens,
    enrichFillPlansWithLayerRelations,
    collectStructureAlerts,
    alignFilledImages,
} from './fill-plan-utils';
import {
    applyCopyGuard,
    buildCopyEvidence,
    evaluateCopyQuality,
    reviewCopyWithFallback,
    buildCopyCandidates,
    fitCopyForLayout,
    tokenOverlapRatio,
    normalizeTextTokens,
} from './copy-processor';
import {
    getEffectiveBrandSpec,
    getBrandPromptContext,
    getCopywritingFormulas,
    getSceneKnowledge,
    getScreenTemplates,
} from './knowledge-query';

// ==================== 常量 ====================

const DEFAULT_MIN_PLAN_CONFIDENCE = 0.62;
const DEFAULT_MIN_IMAGE_COVERAGE = 0.6;

// ==================== 执行器 ====================

export const detailPageExecutor: SkillExecutor = {
    skillId: 'detail-page-design',

    async execute({ params, callbacks, signal, context }: SkillExecuteParams): Promise<AgentResult> {
        const startTime = Date.now();
        const results: any[] = [];

        // 统计计数器
        let issuesFound = 0;
        let issuesFixed = 0;
        let copyGuardAdjusted = 0;
        let copyReviewedCount = 0;
        let copyRewrittenCount = 0;
        let copyFlaggedCount = 0;
        let copyEvidenceWeakCount = 0;
        let copyLayoutAdjusted = 0;
        let copyOverflowRiskCount = 0;
        let copyContinuityAdjusted = 0;
        const copyReviewFlags: Array<{
            screenName: string; layerId: number; score: number;
            reasons: string[]; candidates: string[];
        }> = [];

        const report = (step: string, progress: number) => {
            callbacks?.onProgress?.(step, progress);
            callbacks?.onMessage?.(`📋 ${step}`);
        };

        try {
            // ===== 计划初始化 =====
            const designIntent = buildDesignIntent(this.skillId, params, context);
            const designPlan = buildDesignPlan(designIntent);
            const { stepMap, has } = extractPlanSteps(designPlan);
            const tracer = createTracer(designPlan.steps || designPlan.layoutSteps || []);

            const useParseStep = has('parseDetailPageTemplate');
            const useMatchStep = has('matchDetailPageContent');
            const useFillStep = has('fillDetailPage');
            const useExportStep = has('exportDetailPageSlices');

            if (!useParseStep) {
                tracer.upsert('parseDetailPageTemplate', 'failed', '设计计划缺少必需解析步骤');
                return { success: false, message: '❌ 设计计划缺少 parseDetailPageTemplate，无法继续', toolResults: results };
            }

            // ===== Phase 1: 模板解析 =====
            report('解析模板结构...', 0.1);

            const parseResult = await executeToolCall('parseDetailPageTemplate', getStepParams(stepMap, 'parseDetailPageTemplate'));
            if (!parseResult?.success) {
                tracer.upsert('parseDetailPageTemplate', 'failed', parseResult?.error || '未知错误');
                return { success: false, message: `❌ 模板解析失败: ${parseResult?.error || '未知错误'}`, toolResults: [parseResult] };
            }

            const screens: ParsedScreen[] = parseResult.screens || [];
            if (screens.length === 0) {
                return { success: false, message: '❌ 未找到有效的详情页屏', toolResults: [parseResult] };
            }

            // 结构检查
            const structureMode = String(params.structureMode || 'guided').toLowerCase();
            const structureAlerts = collectStructureAlerts(screens);
            const copyPlaceholderMap = new Map<number, CopyPlaceholder>();
            for (const screen of screens) {
                for (const copy of (screen.copyPlaceholders || [])) {
                    copyPlaceholderMap.set(copy.layerId, copy);
                }
            }

            if (structureAlerts.length > 0 && structureMode !== 'ignore') {
                callbacks?.onMessage?.(`🧱 结构检查: ${structureAlerts.length} 屏缺少标准分组（文案/icon/图片）`);
                for (const alert of structureAlerts.slice(0, 5)) {
                    callbacks?.onMessage?.(`   • ${alert.screenName}: 缺少 ${alert.missingGroups.join('/')}`);
                }
                if (structureMode === 'strict') {
                    return {
                        success: false,
                        message: '❌ 模板结构不符合 strict 模式要求：请先补齐每屏的 文案/icon/图片 分组',
                        toolResults: [parseResult], data: { structureAlerts, structureMode },
                    };
                }
            }

            callbacks?.onMessage?.(`✅ 解析完成: 发现 ${screens.length} 屏`);
            results.push(parseResult);
            tracer.upsert('parseDetailPageTemplate', 'success', `解析 ${screens.length} 屏`);

            if (signal?.aborted) return { success: true, cancelled: true, message: '⏹️ 已停止' };

            // ===== Phase 2: 问题检测 + 自动修复 =====
            report('检测图层问题...', 0.2);

            const detectResult = await executeToolCall('detectLayerIssues', { screens });
            const issues: LayerIssue[] = detectResult?.issues || [];
            issuesFound = issues.length;

            if (issuesFound > 0) {
                callbacks?.onMessage?.(`⚠️ 发现 ${issuesFound} 个图层问题`);
                const autoFix = params.autoFix !== false;
                const fixableIssues = issues.filter(i => i.autoFixable);
                if (autoFix && fixableIssues.length > 0) {
                    report(`修复 ${fixableIssues.length} 个可修复问题...`, 0.3);
                    const fixResult = await executeToolCall('fixLayerIssues', { issues: fixableIssues });
                    issuesFixed = fixResult?.fixed || 0;
                    callbacks?.onMessage?.(`🔧 已修复 ${issuesFixed}/${fixableIssues.length} 个问题`);
                    results.push(fixResult);
                }
            } else {
                callbacks?.onMessage?.('✅ 图层结构良好，无需修复');
            }
            results.push(detectResult);

            if (signal?.aborted) return { success: true, cancelled: true, message: '⏹️ 已停止' };

            // ===== Phase 3: 内容匹配 → 生成填充计划 =====
            report('匹配内容到占位符...', 0.4);

            const projectPath = designIntent.projectPath || params.projectPath || '';
            const forceCopyOnly = params.copyOnly === true || params.forceCopyOnly === true;
            let fillPlans: FillPlan[] = [];

            if (forceCopyOnly) {
                callbacks?.onMessage?.('✍️ 仅文案优化模式，跳过素材匹配');
                tracer.upsert('matchDetailPageContent', 'skipped', 'copy-only-mode');
                fillPlans = screens.map(s => ({
                    screenId: s.id, screenName: s.name, screenType: s.type,
                    copies: (s.copyPlaceholders || []).map(c => ({ layerId: c.layerId, content: String(c.currentText || '').trim() })),
                    images: [],
                }));
            } else if (useMatchStep) {
                const matchParams = getStepParams(stepMap, 'matchDetailPageContent');
                const matchResult = await executeToolCall('matchDetailPageContent', {
                    ...matchParams, screens, projectPath: matchParams.projectPath || projectPath,
                });
                fillPlans = matchResult?.plans || [];
                results.push(matchResult);
                tracer.upsert('matchDetailPageContent', 'success', `生成 ${fillPlans.length} 个填充计划`);
            } else {
                callbacks?.onMessage?.('↪ 计划未包含素材匹配，使用模板默认');
                tracer.upsert('matchDetailPageContent', 'skipped', '计划未包含');
                fillPlans = screens.map(s => ({
                    screenId: s.id, screenName: s.name, screenType: s.type,
                    copies: (s.copyPlaceholders || []).map(c => ({ layerId: c.layerId, content: c.currentText || '' })),
                    images: (s.imagePlaceholders || []).map(img => ({
                        layerId: img.layerId, imagePath: '', fillMode: 'cover',
                        isClippingMask: img.isClippingMask,
                        baseLayerId: img.baseLayerId || img.clippingInfo?.baseLayerId,
                        referenceLayerId: img.baseLayerId || img.clippingInfo?.baseLayerId || img.layerId,
                    })),
                }));
            }

            fillPlans = enrichFillPlansWithLayerRelations(fillPlans, screens);
            const { alignedPlans, unmatchedPlanCount } = alignFillPlansToScreens(fillPlans, screens);
            if (unmatchedPlanCount > 0) {
                callbacks?.onMessage?.(`⚠️ 匹配计划与屏结构存在 ${unmatchedPlanCount} 个未对齐项，已使用兜底映射`);
            }

            const totalCopies = alignedPlans.reduce((sum, p) => sum + (p?.copies?.length || 0), 0);
            const totalImages = alignedPlans.reduce((sum, p) => sum + (p?.images?.length || 0), 0);

            if (signal?.aborted) return { success: true, cancelled: true, message: '⏹️ 已停止' };

            // ===== Phase 4: 文案处理管线 =====
            const brandSpec = await getEffectiveBrandSpec(projectPath || undefined);
            const brandContext = (brandSpec && brandSpec.id !== 'default') ? await getBrandPromptContext(projectPath) : '';
            if (brandSpec && brandSpec.id !== 'default') {
                callbacks?.onMessage?.(`🎨 品牌规范: ${brandSpec.name} (${brandSpec.tone})`);
            }
            const brandTone = (brandSpec?.tone || params.brandTone || 'professional') as string;
            const copyCreativeStyle = (
                String(params.copyCreativeStyle || '').toLowerCase() === 'playful'
                    ? 'playful'
                    : String(params.copyCreativeStyle || '').toLowerCase() === 'professional'
                        ? 'professional'
                        : (brandTone === 'playful' ? 'playful' : brandTone === 'professional' ? 'professional' : 'natural')
            ) as 'natural' | 'playful' | 'professional';
            callbacks?.onMessage?.(`🧭 文案风格: ${copyCreativeStyle}（去广告感 + 图文佐证）`);

            // Phase 4.1: CopyGuard — 广告法合规
            const enableCopyGuard = params.copyGuard !== false;
            if (enableCopyGuard) {
                for (const plan of alignedPlans) {
                    if (!plan) continue;
                    for (const copy of (plan.copies || [])) {
                        const before = copy.content || '';
                        const after = applyCopyGuard(before, { screenType: plan.screenType, brandTone });
                        if (after !== before) { copy.content = after; copyGuardAdjusted++; }
                    }
                }
                if (copyGuardAdjusted > 0) callbacks?.onMessage?.(`🛡️ 文案去广告处理: 调整 ${copyGuardAdjusted} 处`);
            }

            // Phase 4.2: AI 文案填补空占位符
            const enableAICopy = params.aiCopyGeneration !== false;
            if (enableAICopy && totalCopies > 0) {
                const copyFormulas = await getCopywritingFormulas(brandSpec?.category);
                const formulaContext = copyFormulas.length > 0
                    ? copyFormulas.map(f => `- ${f.name}: ${f.structure}`).join('\n') : '';
                const sceneKnowledges = await getSceneKnowledge(brandSpec?.category);
                const sceneContext = sceneKnowledges.length > 0
                    ? sceneKnowledges.slice(0, 3).map(s => `- ${s.sceneName}: ${s.copyAngle}`).join('\n') : '';
                const screenTemplates = await getScreenTemplates();
                const templateByType = new Map<string, string>(
                    screenTemplates.map(t => [t.type, `${t.name}（${t.purpose || '用途未描述'}）`])
                );

                let emptyCount = 0;
                for (const plan of alignedPlans) {
                    if (!plan) continue;
                    emptyCount += (plan.copies || []).filter(c => !c.content || c.content.trim() === '').length;
                }

                if (emptyCount > 0) {
                    callbacks?.onMessage?.(`📝 检测到 ${emptyCount} 个空文案占位符，尝试 AI 生成...`);
                    try {
                        for (const plan of alignedPlans) {
                            if (!plan) continue;
                            for (const copy of (plan.copies || [])) {
                                if (copy.content && copy.content.trim() !== '') continue;
                                const screenTemplateHint = templateByType.get(plan.screenType) || '';
                                const promptParts = [
                                    `为${plan.screenType}屏生成一句电商文案`,
                                    brandTone !== 'professional' ? `品牌调性: ${brandTone}` : '',
                                    `文案风格: ${copyCreativeStyle}`,
                                    screenTemplateHint ? `参考屏模板: ${screenTemplateHint}` : '',
                                    formulaContext ? `参考文案公式:\n${formulaContext}` : '',
                                    sceneContext ? `参考场景角度:\n${sceneContext}` : '',
                                    '要求：避免硬广和夸张承诺；文案要能被画面佐证；优先短句，允许轻微友好调侃。'
                                ].filter(Boolean).join('\n');

                                const aiResult = await window.designEcho?.invoke?.(
                                    'task:execute', 'text-optimize', { text: promptParts, context: { screenType: plan.screenType, brandTone, brandContext } }
                                );
                                if (aiResult?.result) {
                                    const generated = typeof aiResult.result === 'string'
                                        ? aiResult.result : aiResult.result?.optimized?.[0]?.text || '';
                                    if (generated) {
                                        copy.content = enableCopyGuard
                                            ? applyCopyGuard(generated, { screenType: plan.screenType, brandTone })
                                            : generated;
                                        callbacks?.onMessage?.(`  └ AI 文案: "${generated.substring(0, 30)}..."`);
                                    }
                                }
                            }
                        }
                    } catch (e: any) {
                        console.warn('[DetailPageExecutor] AI 文案生成失败:', e.message);
                        callbacks?.onMessage?.('⚠️ AI 文案生成不可用，保留模板占位符');
                    }
                }
            }

            // Phase 4.3: CopyReview — 质量评审
            const enableCopyReview = params.copyReview !== false;
            const copyMinScore = clamp01(Number(params.copyMinScore), 0.72);
            const copyCandidateCount = Math.max(2, Math.min(5, Math.round(Number(params.copyCandidateCount) || 3)));
            const lowScoreCopyStrategyRaw = String(params.lowScoreCopyStrategy || (forceCopyOnly ? 'keep' : 'replace')).toLowerCase();
            const lowScoreCopyStrategy: 'replace' | 'flag' | 'keep' =
                lowScoreCopyStrategyRaw === 'flag' ? 'flag' : (lowScoreCopyStrategyRaw === 'keep' ? 'keep' : 'replace');

            if (enableCopyReview && totalCopies > 0) {
                callbacks?.onMessage?.(`🧪 文案审查启动（阈值 ${Math.round(copyMinScore * 100)} 分）...`);
                for (const plan of alignedPlans) {
                    if (!plan) continue;
                    const evidence = buildCopyEvidence(plan);
                    for (const copy of (plan.copies || [])) {
                        const decision = reviewCopyWithFallback(copy.content || '', evidence, {
                            minScore: copyMinScore, candidateCount: copyCandidateCount,
                            strategy: lowScoreCopyStrategy, screenType: plan.screenType, brandTone, creativeStyle: copyCreativeStyle,
                        });
                        copyReviewedCount++;
                        if (decision.quality.evidenceScore < 0.5) copyEvidenceWeakCount++;
                        const beforeTrimmed = String(copy.content || '').trim();
                        if (decision.replaced) { copy.content = decision.finalContent; copyRewrittenCount++; }
                        else if (!beforeTrimmed && decision.candidates.length > 0 && lowScoreCopyStrategy !== 'keep') {
                            copy.content = decision.candidates[0].text;
                            copyRewrittenCount++;
                        }
                        if (decision.flagged) {
                            copyFlaggedCount++;
                            copyReviewFlags.push({
                                screenName: plan.screenName, layerId: copy.layerId, score: decision.quality.score,
                                reasons: decision.quality.reasons, candidates: decision.candidates.map(c => c.text).slice(0, copyCandidateCount),
                            });
                        }
                    }
                }
                if (copyReviewedCount > 0) {
                    callbacks?.onMessage?.(`🧾 文案审查完成: ${copyReviewedCount} 条, 改写 ${copyRewrittenCount} 条, 标记 ${copyFlaggedCount} 条`);
                }
            }

            // Phase 4.4: CopyLayoutFit — 排版适配
            const enableCopyLayoutFit = params.copyLayoutFit !== false;
            const copyLineBreakStyle: 'balanced' | 'compact' =
                String(params.copyLineBreakStyle || 'balanced').toLowerCase() === 'compact' ? 'compact' : 'balanced';
            const copyTitleMaxLines = Math.max(1, Math.min(3, Math.round(Number(params.copyTitleMaxLines) || 2)));
            const copySubtitleMaxLines = Math.max(1, Math.min(3, Math.round(Number(params.copySubtitleMaxLines) || 2)));
            const copyBodyMaxLines = Math.max(1, Math.min(5, Math.round(Number(params.copyBodyMaxLines) || 3)));
            const continuityOverlapThreshold = 0.82;

            if (enableCopyLayoutFit && totalCopies > 0) {
                callbacks?.onMessage?.(`🧩 文案排版适配（换行风格: ${copyLineBreakStyle}）...`);
                for (const plan of alignedPlans) {
                    if (!plan) continue;
                    const evidence = buildCopyEvidence(plan);
                    const sortedCopies = [...(plan.copies || [])].sort((a, b) => {
                        const ap = copyPlaceholderMap.get(a.layerId);
                        const bp = copyPlaceholderMap.get(b.layerId);
                        return (Number(ap?.bounds?.top || 0) - Number(bp?.bounds?.top || 0))
                            || (Number(ap?.bounds?.left || 0) - Number(bp?.bounds?.left || 0));
                    });

                    let prevText = '';
                    for (const copy of sortedCopies) {
                        const before = String(copy.content || '').trim();
                        if (!before) continue;
                        const placeholder = copyPlaceholderMap.get(copy.layerId);
                        const fitOpts = { lineBreakStyle: copyLineBreakStyle, titleMaxLines: copyTitleMaxLines, subtitleMaxLines: copySubtitleMaxLines, bodyMaxLines: copyBodyMaxLines };

                        let finalText = fitCopyForLayout(before, placeholder, fitOpts).text;
                        let adjustedForLayout = fitCopyForLayout(before, placeholder, fitOpts).changed;
                        let overflowRisk = fitCopyForLayout(before, placeholder, fitOpts).overflowRisk;

                        // 连贯性检查：相邻文案过于相似时替换
                        const overlapRatio = prevText ? tokenOverlapRatio(prevText, finalText) : 0;
                        if (prevText && normalizeTextTokens(prevText).length >= 3 && normalizeTextTokens(finalText).length >= 3
                            && overlapRatio >= continuityOverlapThreshold) {
                            const currentQuality = evaluateCopyQuality(finalText, evidence);
                            const continuityCandidates = buildCopyCandidates(
                                evidence,
                                Math.max(copyCandidateCount + 1, 3),
                                { screenType: plan.screenType, brandTone, creativeStyle: copyCreativeStyle }
                            );
                            let bestText = finalText;
                            let bestScore = currentQuality.score - (overlapRatio * 0.32);
                            for (const candidate of continuityCandidates) {
                                if (!candidate || candidate === finalText) continue;
                                const fitted = fitCopyForLayout(candidate, placeholder, fitOpts);
                                const candidateOverlap = tokenOverlapRatio(prevText, fitted.text);
                                if (candidateOverlap > overlapRatio - 0.12) continue;
                                const candidateQuality = evaluateCopyQuality(fitted.text, evidence);
                                if (candidateQuality.score < currentQuality.score - 0.06) continue;
                                const blendedScore = candidateQuality.score - (candidateOverlap * 0.32);
                                if (blendedScore > bestScore + 0.015) { bestScore = blendedScore; bestText = fitted.text; }
                            }
                            if (bestText !== finalText) { finalText = bestText; copyContinuityAdjusted++; }
                        }

                        if (finalText !== before) copy.content = finalText;
                        if (adjustedForLayout) copyLayoutAdjusted++;
                        if (overflowRisk) copyOverflowRiskCount++;
                        prevText = String(copy.content || '').trim();
                    }
                }
                callbacks?.onMessage?.(
                    `🧾 文案排版完成: 调整 ${copyLayoutAdjusted} 处, 连贯性改写 ${copyContinuityAdjusted} 处`
                    + (copyOverflowRiskCount > 0 ? `, ${copyOverflowRiskCount} 处仍有溢出风险` : '')
                );
            }

            if (signal?.aborted) return { success: true, cancelled: true, message: '⏹️ 已停止' };

            // ===== Phase 5: Critique 前诊断 =====
            callbacks?.onProgress?.('设计诊断...', 0.48);
            const designCtx = await collectDesignContext({
                platform: 'ecommerce',
                brandTone: (designIntent.brandTone || params.brandTone) as string | undefined,
                userIntent: params.userIntent as string | undefined,
            });
            const pipeline = createPipeline(designCtx, { onMessage: callbacks?.onMessage });
            const beforeReport = await pipeline.before();

            // ===== Phase 6: 逐屏填充 + 对齐修正 =====
            let successCount = 0;
            let failCount = 0;
            let filledImages = 0;
            let skippedImages = 0;
            let totalAligned = 0;
            let fillAttemptCount = 0;
            let fillSuccessCount = 0;
            let guardedScreenCount = 0;
            let copyOnlyScreenCount = 0;
            const guardedScreenNames: string[] = [];

            const minPlanConfidence = clamp01(Number(params.minPlanConfidence), DEFAULT_MIN_PLAN_CONFIDENCE);
            const minImageCoverage = clamp01(Number(params.minImageCoverage), DEFAULT_MIN_IMAGE_COVERAGE);
            const usePlanGuard = params.planGuard === true;
            const allowLowConfidenceFill = params.allowLowConfidenceFill === true;
            const fillStepParams = getStepParams(stepMap, 'fillDetailPage');

            for (let i = 0; i < screens.length; i++) {
                const screen = screens[i];
                const plan = alignedPlans[i];
                report(`填充屏 ${i + 1}/${screens.length}: ${screen.name}`, 0.5 + (i / screens.length) * 0.25);

                if (signal?.aborted) return { success: true, cancelled: true, message: '⏹️ 已停止' };

                if (!useFillStep) {
                    successCount++;
                    callbacks?.onMessage?.(`  └ ${screen.name}: 计划未包含填充，跳过`);
                    continue;
                }

                if (!plan) { successCount++; callbacks?.onMessage?.(`  └ ${screen.name}: 跳过`); continue; }

                const quality = calculatePlanQuality(plan);
                const shouldGuard = usePlanGuard && !allowLowConfidenceFill
                    && (!!plan.needsReview || quality.score < minPlanConfidence || quality.imageCoverage < minImageCoverage);

                let planToApply = plan;
                let copyOnlyApplied = forceCopyOnly;

                if (forceCopyOnly) {
                    planToApply = { ...plan, images: [] };
                    callbacks?.onMessage?.(`  └ ${screen.name}: ✍️ 仅文案模式`);
                } else if (shouldGuard) {
                    guardedScreenCount++;
                    guardedScreenNames.push(screen.name);
                    planToApply = { ...plan, images: [] };
                    copyOnlyApplied = true;
                    callbacks?.onMessage?.(
                        `  └ ${screen.name}: ⚠️ 保护策略（评分 ${quality.score.toFixed(2)}），本屏仅填文案`
                    );
                }
                if (copyOnlyApplied) copyOnlyScreenCount++;

                const planImages = planToApply.images?.filter(img => img.imagePath) || [];
                const planSkipped = planToApply.images?.filter(img => !img.imagePath) || [];

                if (planImages.length > 0 || planToApply.copies?.length > 0) {
                    fillAttemptCount++;
                    const fillResult = await executeToolCall('fillDetailPage', { ...fillStepParams, plan: planToApply });
                    if (fillResult?.success) {
                        successCount++;
                        fillSuccessCount++;
                        filledImages += planImages.length;
                        skippedImages += planSkipped.length;
                        if (planImages.length > 0) {
                            totalAligned += await alignFilledImages(planToApply, screen, callbacks, results);
                        }
                        const details = [];
                        if (planImages.length > 0) details.push(`${planImages.length} 图片`);
                        if (planToApply.copies?.length > 0) details.push(`${planToApply.copies.length} 文案`);
                        callbacks?.onMessage?.(`  └ ${screen.name}: ${details.join(', ')} ✓`);
                    } else {
                        failCount++;
                        callbacks?.onMessage?.(`  └ ${screen.name}: 填充失败 ✗`);
                    }
                    results.push(fillResult);
                } else {
                    successCount++;
                    callbacks?.onMessage?.(`  └ ${screen.name}: 无需填充`);
                }
            }

            callbacks?.onMessage?.(`📊 填充汇总: ${filledImages} 图片已填充, ${skippedImages} 图片跳过`);
            if (totalAligned > 0) callbacks?.onMessage?.(`📐 对齐修正: ${totalAligned} 张图片已居中对齐`);

            // ===== Phase 7: 导出切片 =====
            report('导出详情页切片...', 0.8);

            const outputDir = designIntent.outputDir || params.outputDir || projectPath;
            let exportResult: any = null;

            if (useExportStep) {
                const { config: exportConfigFromStep, ...exportToolParams } = getStepParams(stepMap, 'exportDetailPageSlices');
                exportResult = await executeToolCall('exportDetailPageSlices', {
                    ...exportToolParams, screens,
                    config: {
                        outputDir, format: params.exportFormat || 'jpeg', quality: params.exportQuality || 10,
                        namingPattern: '{index}_{type}', createSubfolder: true, subfolder: '详情',
                        ...(exportConfigFromStep || {}),
                    },
                });
                results.push(exportResult);
                tracer.upsert('exportDetailPageSlices',
                    exportResult?.success ? 'success' : 'failed',
                    exportResult?.success ? `导出 ${exportResult.successCount || screens.length} 张` : exportResult?.error
                );
            } else {
                callbacks?.onMessage?.('↪ 计划未包含导出步骤，跳过');
                tracer.upsert('exportDetailPageSlices', 'skipped', '计划未包含');
                exportResult = { skipped: true };
            }

            // ===== Phase 8: Critique 后评估 =====
            const doVisualValidation = params.visualValidation !== false;
            let critiqueResult: CritiqueResult | null = null;
            let verificationScore = 0;
            let verificationIssueCount = 0;

            if (doVisualValidation) {
                report('设计评估...', 0.92);
                critiqueResult = await pipeline.after(beforeReport);
                if (critiqueResult) {
                    verificationScore = critiqueResult.afterScore;
                    verificationIssueCount = critiqueResult.afterIssues.length;
                }
            }

            // ===== 汇总 =====
            report('完成', 1.0);
            const totalTime = Date.now() - startTime;

            // 更新 tracer
            if (useFillStep) {
                tracer.upsert('fillDetailPage',
                    fillAttemptCount === 0 ? 'skipped'
                        : fillSuccessCount === fillAttemptCount ? 'success' : 'partial',
                    `成功 ${fillSuccessCount}/${fillAttemptCount}`
                );
            }

            const summary = buildSummary({
                screens, alignedPlans, successCount, failCount,
                filledImages, skippedImages, totalAligned, totalImages,
                issuesFound, issuesFixed, copyGuardAdjusted,
                copyReviewedCount, copyRewrittenCount, copyFlaggedCount,
                enableCopyLayoutFit, copyLayoutAdjusted, copyContinuityAdjusted, copyOverflowRiskCount,
                guardedScreenCount, guardedScreenNames, forceCopyOnly, copyOnlyScreenCount,
                structureAlerts, structureMode, critiqueResult,
                verificationScore, verificationIssueCount,
                exportResult, outputDir, totalTime,
            });

            return {
                success: failCount === 0,
                message: summary,
                toolResults: results,
                data: {
                    screensProcessed: screens.length,
                    screensSuccess: successCount,
                    screensFailed: failCount,
                    imagesFilledCount: filledImages,
                    imagesSkippedCount: skippedImages,
                    imagesAligned: totalAligned,
                    issuesFound, issuesFixed, copyGuardAdjusted,
                    copyQuality: {
                        reviewed: copyReviewedCount, rewritten: copyRewrittenCount,
                        flagged: copyFlaggedCount, weakEvidence: copyEvidenceWeakCount,
                        layoutAdjusted: copyLayoutAdjusted, overflowRisk: copyOverflowRiskCount,
                        continuityAdjusted: copyContinuityAdjusted,
                        lineBreakStyle: copyLineBreakStyle,
                        maxLines: { title: copyTitleMaxLines, subtitle: copySubtitleMaxLines, body: copyBodyMaxLines },
                        minScore: copyMinScore, strategy: lowScoreCopyStrategy, flags: copyReviewFlags,
                    },
                    structureMode, structureAlerts,
                    planGuard: {
                        enabled: usePlanGuard, forceCopyOnly, allowLowConfidenceFill,
                        minPlanConfidence, minImageCoverage,
                        guardedScreenCount, copyOnlyScreenCount, guardedScreenNames,
                    },
                    critique: critiqueResult,
                    totalTime,
                    exportPath: exportResult?.outputDir,
                },
            };

        } catch (e: any) {
            console.error('[DetailPageExecutor] 执行失败:', e);
            return { success: false, message: `❌ 详情页设计失败: ${e.message}`, error: e.message, toolResults: results };
        }
    },
};

// ==================== 汇总生成 ====================

function buildSummary(ctx: {
    screens: ParsedScreen[];
    alignedPlans: Array<FillPlan | undefined>;
    successCount: number; failCount: number;
    filledImages: number; skippedImages: number;
    totalAligned: number; totalImages: number;
    issuesFound: number; issuesFixed: number;
    copyGuardAdjusted: number;
    copyReviewedCount: number; copyRewrittenCount: number; copyFlaggedCount: number;
    enableCopyLayoutFit: boolean;
    copyLayoutAdjusted: number; copyContinuityAdjusted: number; copyOverflowRiskCount: number;
    guardedScreenCount: number; guardedScreenNames: string[];
    forceCopyOnly: boolean; copyOnlyScreenCount: number;
    structureAlerts: any[]; structureMode: string;
    critiqueResult: CritiqueResult | null;
    verificationScore: number; verificationIssueCount: number;
    exportResult: any; outputDir: string;
    totalTime: number;
}): string {
    const lines: string[] = ['✅ **详情页设计完成**', ''];

    lines.push('📋 **处理内容**：');
    for (let i = 0; i < Math.min(ctx.screens.length, 5); i++) {
        const s = ctx.screens[i];
        const p = ctx.alignedPlans[i];
        const imgCount = p?.images?.filter(img => img.imagePath).length || 0;
        const copyCount = p?.copies?.length || 0;
        const details = [];
        if (imgCount > 0) details.push(`${imgCount}张图片`);
        if (copyCount > 0) details.push(`${copyCount}处文案`);
        lines.push(`   • ${s.name}${details.length > 0 ? ` (${details.join(', ')})` : ''}`);
    }
    if (ctx.screens.length > 5) lines.push(`   • ... 还有 ${ctx.screens.length - 5} 屏`);
    lines.push('');

    lines.push(`📊 **统计**：${ctx.screens.length} 屏, ${ctx.successCount} 成功, ${ctx.failCount} 失败`);
    if (ctx.filledImages > 0 || ctx.skippedImages > 0)
        lines.push(`🖼️ **图片**：${ctx.filledImages} 已填充` + (ctx.skippedImages > 0 ? `, ${ctx.skippedImages} 跳过` : ''));
    if (ctx.totalAligned > 0) lines.push(`📐 **对齐修正**：${ctx.totalAligned} 张图片已居中对齐`);
    if (ctx.issuesFound > 0) lines.push(`🔧 **问题修复**：发现 ${ctx.issuesFound}, 修复 ${ctx.issuesFixed}`);
    if (ctx.copyGuardAdjusted > 0) lines.push(`🛡️ **文案净化**：调整 ${ctx.copyGuardAdjusted} 处`);
    if (ctx.copyReviewedCount > 0)
        lines.push(`🧪 **文案审查**：${ctx.copyReviewedCount} 条, 改写 ${ctx.copyRewrittenCount} 条, 标记 ${ctx.copyFlaggedCount} 条`);
    if (ctx.enableCopyLayoutFit && (ctx.copyLayoutAdjusted > 0 || ctx.copyContinuityAdjusted > 0))
        lines.push(`✍️ **文案编排**：${ctx.copyLayoutAdjusted} 处适配, ${ctx.copyContinuityAdjusted} 处连贯性改写`
            + (ctx.copyOverflowRiskCount > 0 ? `, ${ctx.copyOverflowRiskCount} 处溢出风险` : ''));
    if (ctx.guardedScreenCount > 0) lines.push(`🧯 **执行保护**：${ctx.guardedScreenCount} 屏触发文案优先模式`);
    if (ctx.forceCopyOnly) lines.push(`✍️ **仅文案模式**：${ctx.copyOnlyScreenCount} 屏保持原图`);
    if (ctx.structureAlerts.length > 0 && ctx.structureMode !== 'ignore')
        lines.push(`🧱 **结构提示**：${ctx.structureAlerts.length} 屏未完整命中三分区`);

    if (ctx.critiqueResult) {
        const arrow = getDeltaArrow(ctx.critiqueResult.delta);
        lines.push(`🔍 **设计评估**：${ctx.critiqueResult.beforeScore} → ${ctx.critiqueResult.afterScore} (${arrow}${Math.abs(ctx.critiqueResult.delta)})`
            + (ctx.critiqueResult.afterIssues.length > 0 ? `，${ctx.critiqueResult.afterIssues.length} 个待优化项` : ''));
    }

    if (ctx.exportResult?.success) { lines.push(''); lines.push(`📁 **导出位置**：${ctx.exportResult.outputDir || ctx.outputDir}`); }
    lines.push(`⏱️ 耗时: ${(ctx.totalTime / 1000).toFixed(1)}s`);

    if (ctx.filledImages === 0 && ctx.totalImages > 0) {
        lines.push('');
        lines.push('💡 **建议**：当前未填充任何图片。请确保项目目录中包含可用素材。');
    }

    return lines.join('\n');
}
