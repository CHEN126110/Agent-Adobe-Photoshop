/**
 * SKU Skill 的内部色卡策略。
 *
 * 专业方法和布局由共享契约给出；本文件只按计划调用 Photoshop 原子 Tool，
 * 每个关键写入都保留读回结果，不依赖 Photoshop Action 或 JSX 黑盒。
 */

import type { AgentResult } from '../unified-agent.service';
import type { SkillExecuteParams } from './types';
import {
    SKU_COLOR_CARD_EXECUTION_REPORT_VERSION,
    buildInternalSkuColorCardGeometry,
    buildSkuColorCardPlan,
    isSkuColorCardClippingReadbackVerified,
    resolveSkuColorCardSources,
    type SkuColorCardColorNameSource,
    type SkuColorCardExecutionReport,
    type SkuColorCardPreparedCard,
    type SkuColorCardSourceInput
} from '../../../shared/sku-color-card-skill';
import { emitSkillStep } from './skill-step-events';
import {
    isPreparedSkuRetouchSource,
    type SkuRetouchPreparedSource,
    type SkuRetouchReport
} from '../../../shared/sku-retouch-contract';

interface ToolObservation {
    toolName: string;
    stage: string;
    sourceId?: string;
    result: any;
}

interface LayerBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

interface TextFitResult {
    verified: boolean;
    fontSize: number;
    labelBounds?: LayerBounds;
    textBounds?: LayerBounds;
    error?: string;
}

function clean(value: unknown): string {
    return String(value || '').trim();
}

function fileBaseNameWithoutExtension(filePath: string): string {
    const normalized = clean(filePath).replace(/\\/g, '/');
    const baseName = normalized.split('/').filter(Boolean).pop() || '';
    return baseName.replace(/\.[^.]+$/, '').trim();
}

function userAuthorizesFilenameLabels(userInput: string): boolean {
    const text = clean(userInput);
    if (!text) return false;
    if (/(?:不要|别|不用|不使用|不允许|不是|没有|拒绝).{0,16}文件名.{0,12}(?:作为|当作|就是|用于)?.{0,6}(?:颜色名|色名)|文件名.{0,12}(?:不要|别|不用|不使用|不允许|不是).{0,8}(?:颜色名|色名)/i.test(text)) {
        return false;
    }
    return /(?:颜色名|色名).{0,8}(?:用|取|按|采用|使用).{0,8}文件名|文件名.{0,8}(?:作为|当作|就是|用于).{0,6}(?:颜色名|色名)/i.test(text);
}

function userProvidesColorName(userInput: string, colorName: string): boolean {
    const normalizedColorName = clean(colorName).toLocaleLowerCase('zh-Hans-CN').replace(/\s+/g, '');
    if (!normalizedColorName) return false;
    const clauses = clean(userInput)
        .toLocaleLowerCase('zh-Hans-CN')
        .split(/[。！？!?；;\n]/)
        .map((clause) => clause.replace(/\s+/g, '').trim())
        .filter(Boolean);
    return clauses.some((clause) => {
        if (!clause.includes(normalizedColorName)) return false;
        if (/(?:不要|别|不选|不使用|不是|并非|排除|去掉|猜|示例|比如|例如)/.test(clause)) return false;
        if (/(?:背景|底色|文字|文案|边框|参考).{0,10}/.test(clause.split(normalizedColorName)[0] || '')) {
            return false;
        }
        const hasExplicitColorField = /(?:颜色名|色名|可用颜色|产品颜色|sku颜色|颜色有|颜色为|颜色是|颜色包括|颜色包含|配色为|配色是|配色包括|配色包含)/i.test(clause);
        const hasColorCardAction = /(?:做成|制作|生成|用于|作为).{0,12}(?:sku)?(?:色卡|颜色卡)|(?:色卡|颜色卡).{0,12}(?:用|使用|包含|包括)/i.test(clause);
        return hasExplicitColorField || hasColorCardAction;
    });
}

function resolveInputColorNameSource(input: {
    value: unknown;
    colorName: string;
    userInput: string;
    filenameLabelsAuthorized: boolean;
    filenameDerived: boolean;
}): SkuColorCardColorNameSource {
    if (input.value === 'filename_fallback') {
        return input.filenameLabelsAuthorized ? 'provided' : 'filename_fallback';
    }
    if (input.filenameLabelsAuthorized && input.filenameDerived) return 'provided';
    if (userProvidesColorName(input.userInput, input.colorName)) return 'provided';
    // source.colorNameSource / colorNames 都是模型可写参数，不能自行把候选升级为用户事实。
    if (input.colorName) return 'inferred_candidate';
    return 'filename_fallback';
}

function normalizeSourceInputs(
    params: Record<string, any>,
    userInput: string
): SkuColorCardSourceInput[] {
    const filenameLabelsAuthorized = userAuthorizesFilenameLabels(userInput);
    const explicit = Array.isArray(params.sources) ? params.sources : [];
    if (explicit.length > 0) {
        return explicit.map((item: unknown) => {
            if (typeof item === 'string') {
                const colorName = filenameLabelsAuthorized ? fileBaseNameWithoutExtension(item) : '';
                return {
                    filePath: item,
                    colorName: colorName || undefined,
                    colorNameSource: filenameLabelsAuthorized ? 'provided' : 'filename_fallback'
                };
            }
            const source = item && typeof item === 'object' ? item as Record<string, unknown> : {};
            // 通用 source.name 通常只是文件名/显示名，不能自动升级成权威颜色名。
            const filePath = clean(source.filePath || source.path);
            const explicitColorName = clean(source.colorName);
            const shouldUseAuthorizedFilename = filenameLabelsAuthorized
                && source.colorNameSource === 'filename_fallback';
            const colorName = shouldUseAuthorizedFilename
                ? fileBaseNameWithoutExtension(filePath)
                : explicitColorName
                || (filenameLabelsAuthorized ? fileBaseNameWithoutExtension(filePath) : '');
            return {
                filePath,
                colorName: colorName || undefined,
                colorNameSource: resolveInputColorNameSource({
                    value: source.colorNameSource,
                    colorName,
                    userInput,
                    filenameLabelsAuthorized,
                    filenameDerived: !explicitColorName && Boolean(colorName)
                }),
                relativePath: clean(source.relativePath) || undefined,
                assetId: clean(source.assetId) || undefined
            };
        });
    }

    const sourcePaths = Array.isArray(params.sourcePaths) ? params.sourcePaths : [];
    const colorNames = Array.isArray(params.colorNames) ? params.colorNames : [];
    const sourceCount = Math.max(sourcePaths.length, colorNames.length);
    return Array.from({ length: sourceCount }, (_, index) => {
        const filePath = clean(sourcePaths[index]);
        const explicitColorName = clean(colorNames[index]);
        const colorName = explicitColorName
            || (filenameLabelsAuthorized ? fileBaseNameWithoutExtension(filePath) : '');
        return {
            filePath,
            colorName: colorName || undefined,
            colorNameSource: resolveInputColorNameSource({
                value: undefined,
                colorName,
                userInput,
                filenameLabelsAuthorized,
                filenameDerived: !explicitColorName && Boolean(colorName)
            })
        };
    });
}

function readPositiveId(result: any, keys: string[]): number | undefined {
    const candidates: unknown[] = [];
    const data = result?.data;
    for (const key of keys) {
        candidates.push(result?.[key], data?.[key], result?.document?.[key], data?.document?.[key]);
    }
    for (const candidate of candidates) {
        const value = Number(candidate);
        if (Number.isFinite(value) && value > 0) return Math.round(value);
    }
    return undefined;
}

function readDocumentSize(result: any): { width: number; height: number; documentId?: number } | null {
    const document = result?.document || result?.data?.document || result?.data || result;
    const width = Number(document?.width);
    const height = Number(document?.height);
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) return null;
    return {
        width: Math.round(width),
        height: Math.round(height),
        documentId: readPositiveId(result, ['documentId', 'id'])
    };
}

function readLayerBounds(result: any): LayerBounds | null {
    const value = result?.boundsNoEffects
        || result?.data?.boundsNoEffects
        || result?.bounds
        || result?.data?.bounds;
    if (!value || typeof value !== 'object') return null;
    const left = Number(value.left);
    const top = Number(value.top);
    const right = Number(value.right);
    const bottom = Number(value.bottom);
    const width = Number.isFinite(Number(value.width)) ? Number(value.width) : right - left;
    const height = Number.isFinite(Number(value.height)) ? Number(value.height) : bottom - top;
    if (![left, top, right, bottom, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
        return null;
    }
    return { left, top, right, bottom, width, height };
}

function toolError(result: any, fallback: string): string {
    return clean(result?.error || result?.message) || fallback;
}

function isSmartObjectVerified(result: any): boolean {
    return result?.success === true && (
        result?.isSmartObject === true
        || result?.data?.isSmartObject === true
        || result?.entityType === 'smart-object'
    );
}

function isSoftLightVerified(result: any): boolean {
    const value = clean(
        result?.blendMode
        || result?.data?.blendMode
        || result?.properties?.blendMode
        || result?.data?.properties?.blendMode
    ).toLocaleLowerCase('en-US').replace(/[\s_-]+/g, '');
    return result?.success === true && (value === 'softlight' || value === '柔光');
}

function resolveRetouchMode(value: unknown): 'auto' | 'layout_only' | 'studio_retouch_required' {
    if (value === 'layout_only') return 'layout_only';
    if (value === 'studio_retouch_required') return 'studio_retouch_required';
    return 'auto';
}

function resolveRetouchLayerStructureCheck(
    cards: SkuColorCardPreparedCard[]
): 'passed' | 'not_applicable' | 'failed' {
    const retouchedCards = cards.filter((card) => card.retouchLayersVerified !== undefined);
    if (retouchedCards.length === 0) return 'not_applicable';
    return retouchedCards.every((card) => card.retouchLayersVerified === true) ? 'passed' : 'failed';
}

function resolveSourceCoverageStatus(
    preparedCards: SkuColorCardPreparedCard[],
    sourceCount: number
): SkuColorCardExecutionReport['checks']['sourceCoverage'] {
    if (preparedCards.length !== sourceCount) return 'failed';
    if (preparedCards.some((card) => card.colorNameSource !== 'provided')) return 'needs_review';
    return 'passed';
}

function buildFailureReport(input: {
    outputPath: string;
    sourceCount: number;
    preparedCards: SkuColorCardPreparedCard[];
    stage: string;
    error: string;
    indexReferenceIsolation: 'passed' | 'failed' | 'not_requested';
    finalStructureReadback?: boolean;
}): SkuColorCardExecutionReport {
    return {
        version: SKU_COLOR_CARD_EXECUTION_REPORT_VERSION,
        status: 'failed',
        outputPath: input.outputPath,
        sourceCount: input.sourceCount,
        preparedCards: input.preparedCards,
        checks: {
            sourceCoverage: resolveSourceCoverageStatus(input.preparedCards, input.sourceCount),
            smartObjectEditability: input.preparedCards.every((card) => card.smartObjectVerified) ? 'passed' : 'failed',
            clippingStructure: input.preparedCards.every((card) => card.clippingVerified) ? 'passed' : 'failed',
            labelTextFit: input.preparedCards.every((card) => card.labelTextFitVerified) ? 'passed' : 'failed',
            indexReferenceIsolation: input.indexReferenceIsolation,
            finalStructureReadback: input.finalStructureReadback ? 'passed' : 'failed',
            visualComposition: 'failed'
        },
        failureStage: input.stage,
        error: input.error
    };
}

export async function executeSkuColorCardStrategy(
    executeParams: SkillExecuteParams
): Promise<AgentResult> {
        const {
            params,
            callbacks,
            signal,
            context,
            guardedAtomicToolExecutor
        } = executeParams;
        // 只有 Runtime context 中的原始用户消息可以授权“文件名就是颜色名”。
        // params.userIntent 为模型可写参数，不得据此提升来源可信度。
        const userInput = clean(context?.userInput);
        const requestedSources = normalizeSourceInputs(params, userInput);
        const sourceResolution = resolveSkuColorCardSources({
            sources: requestedSources,
            assetIndex: context?.projectContext?.assetIndex,
            userInput
        });
        const sources = sourceResolution.sources;
        const projectPath = clean(params.projectPath || context?.projectContext?.projectPath);
        const plan = buildSkuColorCardPlan({
            sources,
            projectPath,
            outputPath: clean(params.outputPath),
            outputRelativePath: clean(params.outputRelativePath),
            layout: {
                canvasWidth: params.canvasWidth,
                canvasHeight: params.canvasHeight,
                cardWidth: params.cardWidth,
                cardHeight: params.cardHeight,
                cardCornerRadius: params.cardCornerRadius,
                columnGap: params.columnGap,
                rowGap: params.rowGap,
                columns: params.columns,
                showIndexNumbers: params.showIndexNumbers
            },
            sourceResolution
        });
        const observations: ToolObservation[] = [];
        const preparedCards: SkuColorCardPreparedCard[] = [];
        let retouchReport: SkuRetouchReport | undefined;
        let indexReferenceIsolation: 'passed' | 'failed' | 'not_requested' = plan.indexReference.enabled
            ? 'failed'
            : 'not_requested';

        function cancelled(): boolean {
            return signal?.aborted === true;
        }

        async function callTool(
            toolName: string,
            toolParams: Record<string, any>,
            stage: string,
            sourceId?: string
        ): Promise<any> {
            if (cancelled()) {
                return { success: false, cancelled: true, error: '任务已取消' };
            }
            callbacks?.onToolStart?.(toolName);
            const result = guardedAtomicToolExecutor
                ? await guardedAtomicToolExecutor(toolName, toolParams)
                : {
                    success: false,
                    code: 'skill_atomic_tool_owner_unavailable',
                    error: '当前 Skill 没有 Harness 签发的原子工具执行边界，已停止 Photoshop 写入。'
                };
            callbacks?.onToolComplete?.(toolName, result);
            observations.push({ toolName, stage, sourceId, result });
            return result;
        }

        async function fitAndCenterLabelText(input: {
            sourceId: string;
            labelLayerId: number;
            textLayerId: number;
            initialFontSize: number;
        }): Promise<TextFitResult> {
            const labelBoundsResult = await callTool('getLayerBounds', {
                layerId: input.labelLayerId,
                includeEffects: false
            }, 'read-label-background-bounds', input.sourceId);
            const initialTextBoundsResult = await callTool('getLayerBounds', {
                layerId: input.textLayerId,
                includeEffects: false
            }, 'read-label-text-bounds', input.sourceId);
            const labelBounds = readLayerBounds(labelBoundsResult);
            let textBounds = readLayerBounds(initialTextBoundsResult);
            if (!labelBounds || !textBounds) {
                return {
                    verified: false,
                    fontSize: input.initialFontSize,
                    error: '无法读取色名白底或文字的真实边界。'
                };
            }

            const horizontalPadding = Math.max(4, Math.round(labelBounds.width * 0.08));
            const verticalPadding = Math.max(3, Math.round(labelBounds.height * 0.12));
            const availableWidth = Math.max(1, labelBounds.width - horizontalPadding * 2);
            const availableHeight = Math.max(1, labelBounds.height - verticalPadding * 2);
            const fitScale = Math.min(1, availableWidth / textBounds.width, availableHeight / textBounds.height);
            let fittedFontSize = input.initialFontSize;

            if (fitScale < 0.995) {
                fittedFontSize = Math.max(8, Math.floor(input.initialFontSize * fitScale));
                const resizeResult = await callTool('setTextStyle', {
                    layerId: input.textLayerId,
                    fontSize: fittedFontSize
                }, 'fit-label-text-size', input.sourceId);
                if (!resizeResult?.success) {
                    return {
                        verified: false,
                        fontSize: fittedFontSize,
                        labelBounds,
                        textBounds,
                        error: toolError(resizeResult, '色名文字无法按白底宽度缩放。')
                    };
                }
                const resizedTextBoundsResult = await callTool('getLayerBounds', {
                    layerId: input.textLayerId,
                    includeEffects: false
                }, 'read-fitted-label-text-bounds', input.sourceId);
                textBounds = readLayerBounds(resizedTextBoundsResult);
                if (!textBounds) {
                    return {
                        verified: false,
                        fontSize: fittedFontSize,
                        labelBounds,
                        error: '色名缩放后无法读回真实文字边界。'
                    };
                }
            }

            const targetX = Math.round(labelBounds.left + (labelBounds.width - textBounds.width) / 2);
            const targetY = Math.round(labelBounds.top + (labelBounds.height - textBounds.height) / 2);
            const moveResult = await callTool('moveLayer', {
                layerId: input.textLayerId,
                x: targetX,
                y: targetY,
                relative: false
            }, 'center-label-text', input.sourceId);
            if (!moveResult?.success) {
                return {
                    verified: false,
                    fontSize: fittedFontSize,
                    labelBounds,
                    textBounds,
                    error: toolError(moveResult, '色名文字无法移动到白底中心。')
                };
            }

            const finalTextBoundsResult = await callTool('getLayerBounds', {
                layerId: input.textLayerId,
                includeEffects: false
            }, 'verify-centered-label-text', input.sourceId);
            const finalTextBounds = readLayerBounds(finalTextBoundsResult);
            if (!finalTextBounds) {
                return {
                    verified: false,
                    fontSize: fittedFontSize,
                    labelBounds,
                    error: '色名文字居中后无法读回最终边界。'
                };
            }

            const tolerance = 2;
            const labelCenterX = labelBounds.left + labelBounds.width / 2;
            const labelCenterY = labelBounds.top + labelBounds.height / 2;
            const textCenterX = finalTextBounds.left + finalTextBounds.width / 2;
            const textCenterY = finalTextBounds.top + finalTextBounds.height / 2;
            const inside = finalTextBounds.left >= labelBounds.left + horizontalPadding - tolerance
                && finalTextBounds.right <= labelBounds.right - horizontalPadding + tolerance
                && finalTextBounds.top >= labelBounds.top + verticalPadding - tolerance
                && finalTextBounds.bottom <= labelBounds.bottom - verticalPadding + tolerance;
            const centered = Math.abs(labelCenterX - textCenterX) <= tolerance
                && Math.abs(labelCenterY - textCenterY) <= tolerance;
            return {
                verified: inside && centered,
                fontSize: fittedFontSize,
                labelBounds,
                textBounds: finalTextBounds,
                ...(!inside || !centered ? { error: '色名文字最终边界没有同时满足白底内收纳与水平/垂直居中。' } : {})
            };
        }

        function fail(stage: string, error: string): AgentResult {
            const report = buildFailureReport({
                outputPath: plan.outputPath,
                sourceCount: plan.slots.length,
                preparedCards,
                stage,
                error,
                indexReferenceIsolation
            });
            emitSkillStep(callbacks, {
                kind: 'verification',
                title: 'SKU 色卡未完成',
                detail: error,
                status: 'error',
                percent: 100,
                issue: stage
            });
            return {
                success: false,
                message: `SKU 色卡没有完成：${error}`,
                error,
                cancelled: cancelled(),
                toolResults: observations,
                data: { plan, report, sourceResolution }
            };
        }

        emitSkillStep(callbacks, {
            kind: 'observation',
            title: '检查 SKU 色卡输入与结构',
            detail: `输入图片 ${sources.length} 张；目标文档 ${plan.documentName}；画布 ${plan.canvas.width}×${plan.canvas.height}。`,
            status: plan.canExecute ? 'success' : 'error',
            percent: 6,
            issue: plan.canExecute ? undefined : plan.status
        });
        if (!plan.canExecute) {
            return fail(plan.status, plan.blockers.join('；'));
        }
        if (!guardedAtomicToolExecutor) {
            // TODO(human): 这条错误会直接显示在 UXP 色卡面板上给设计师看。
            // 现有文案「没有 Harness 签发的原子工具执行边界」是内部工程语言，
            // 设计师读不懂，也不知道自己该做什么。请改写成面向使用者的说明。
            //
            // 约束（来自本仓库的错误信息规范）：
            //   1. 说明哪一步没能开始（色卡还没开始制作，不是做坏了）
            //   2. 不出现 Harness / 原子工具 / 执行边界 / 签发 等内部词汇
            //   3. 给出用户能自己做的下一步动作
            //   4. 简体中文
            return fail(
                'skill-atomic-tool-owner-unavailable',
                '当前 SKU 工作流没有 Harness 签发的原子工具执行边界，不能安全绑定 Photoshop 文档和历史版本。'
            );
        }

        const retouchMode = resolveRetouchMode(params.retouchMode);
        if (retouchMode !== 'layout_only') {
            emitSkillStep(callbacks, {
                kind: 'tool_planned',
                title: '准备纯底 SKU 精修资产',
                detail: '先判断纯底/场景，再生成形态统一主体、独立原影和中性灰光影修正层。',
                status: 'running',
                percent: 8
            });
            const retouchResult = await callTool('prepareSkuRetouchAssets', {
                sources: plan.slots.map((slot) => ({
                    sourceId: slot.source.sourceId,
                    filePath: slot.source.filePath,
                    colorName: slot.source.colorName
                })),
                projectPath,
                outputDir: clean(params.retouchOutputDir) || undefined,
                referenceSourcePath: clean(params.referenceSourcePath) || undefined,
                sourceMode: params.sourceMode === 'studio' || params.sourceMode === 'scene'
                    ? params.sourceMode
                    : 'auto',
                shapeStrength: params.shapeStrength,
                lightingStrength: params.lightingStrength,
                maxLongEdge: params.retouchMaxLongEdge,
                force: params.forceRetouch === true
            }, 'prepare-sku-retouch-assets');
            if (!retouchResult?.success) {
                return fail(
                    'prepare-sku-retouch-assets',
                    toolError(retouchResult, 'SKU 纯底素材精修资产生成失败。')
                );
            }
            retouchReport = retouchResult as SkuRetouchReport;
            if (retouchMode === 'studio_retouch_required' && retouchReport.workflowStatus !== 'prepared') {
                return fail('prepare-sku-retouch-assets', '当前任务要求纯底精修，但素材没有通过纯底适用性检查。');
            }
            emitSkillStep(callbacks, {
                kind: 'verification',
                title: retouchReport.workflowStatus === 'prepared' ? 'SKU 精修资产已生成' : '已跳过纯底精修',
                detail: retouchReport.workflowStatus === 'prepared'
                    ? `基准：${retouchReport.referenceSourceId || '自动'}；已生成 ${retouchReport.sources.filter((source) => source.status === 'prepared').length} 组可编辑资产。`
                    : '素材不适用纯底处理，将保留原图进入色卡结构并等待场景方向复核。',
                status: 'success',
                percent: 10
            });
        }

        callbacks?.onProgress?.('创建 SKU 色卡文档', 10);
        const createDocumentResult = await callTool('createDocument', {
            name: plan.documentName,
            width: plan.canvas.width,
            height: plan.canvas.height,
            backgroundColor: plan.canvas.backgroundColor
        }, 'create-document');
        if (!createDocumentResult?.success) {
            return fail('create-document', toolError(createDocumentResult, '创建 SKU 文档失败。'));
        }
        const mainDocumentId = readPositiveId(createDocumentResult, ['documentId', 'id']);
        if (!mainDocumentId) {
            return fail('create-document-readback', 'SKU 文档创建后没有返回可用文档 ID。');
        }

        for (let slotIndex = 0; slotIndex < plan.slots.length; slotIndex += 1) {
            const slot = plan.slots[slotIndex];
            const sourceId = slot.source.sourceId;
            const progressBase = 14 + Math.round((slotIndex / plan.slots.length) * 68);
            callbacks?.onProgress?.(`制作色卡：${slot.source.colorName}`, progressBase);
            emitSkillStep(callbacks, {
                kind: 'tool_planned',
                title: `制作色卡 ${slot.index}/${plan.slots.length}`,
                detail: `${slot.source.colorName} ← ${slot.source.filePath}`,
                status: 'running',
                percent: progressBase
            });

            const groupResult = await callTool('createGroup', {
                groupName: slot.groupName
            }, 'create-color-group', sourceId);
            const groupId = readPositiveId(groupResult, ['layerId', 'createdLayerId', 'id']);
            if (!groupResult?.success || !groupId) {
                return fail('create-color-group', toolError(groupResult, `颜色组“${slot.groupName}”创建失败。`));
            }
            const normalizeGroupRootResult = await callTool('moveLayerToGroup', {
                layerId: groupId,
                targetGroupId: 0,
                position: 'inside'
            }, 'normalize-color-group-root', sourceId);
            if (!normalizeGroupRootResult?.success) {
                return fail(
                    'normalize-color-group-root',
                    toolError(normalizeGroupRootResult, `颜色组“${slot.groupName}”无法归位到文档根级。`)
                );
            }

            const rectangleResult = await callTool('createRectangle', {
                name: `${slot.source.colorName}-圆角占位`,
                ...slot.cardBounds,
                fillColorHex: plan.cardStyle.fillColorHex,
                cornerRadius: plan.cardStyle.cornerRadius
            }, 'create-rounded-placeholder', sourceId);
            const rectangleLayerId = readPositiveId(rectangleResult, ['layerId', 'createdLayerId']);
            if (!rectangleResult?.success || !rectangleLayerId) {
                return fail('create-rounded-placeholder', toolError(rectangleResult, `“${slot.source.colorName}”圆角占位创建失败。`));
            }

            const convertResult = await callTool('convertToSmartObject', {
                layerIds: [rectangleLayerId],
                name: slot.smartObjectName
            }, 'convert-placeholder-to-smart-object', sourceId);
            const smartObjectLayerId = readPositiveId(convertResult, ['layerId', 'createdLayerId']);
            if (!convertResult?.success || !smartObjectLayerId) {
                return fail('convert-placeholder-to-smart-object', toolError(convertResult, `“${slot.source.colorName}”占位转智能对象失败。`));
            }

            const editResult = await callTool('editSmartObjectContents', {
                layerId: smartObjectLayerId
            }, 'open-smart-object', sourceId);
            const internalDocumentId = readPositiveId(editResult, ['documentId', 'id']);
            if (!editResult?.success || !internalDocumentId) {
                return fail('open-smart-object', toolError(editResult, `“${slot.source.colorName}”智能对象内容无法打开。`));
            }

            const internalInfoResult = await callTool('getDocumentInfo', {}, 'read-smart-object-document', sourceId);
            const internalSize = readDocumentSize(internalInfoResult);
            if (!internalInfoResult?.success || !internalSize) {
                return fail('read-smart-object-document', toolError(internalInfoResult, `无法读取“${slot.source.colorName}”智能对象内部尺寸。`));
            }
            const internalGeometry = buildInternalSkuColorCardGeometry({
                width: internalSize.width,
                height: internalSize.height,
                recipe: plan.cardStyle.internalLabel,
                labelText: slot.source.colorName
            });

            const retouchSource: SkuRetouchPreparedSource | undefined = retouchReport?.sources.find(
                (source) => source.sourceId === sourceId
            );
            let sourceBackupLayerId: number | undefined;
            let shadowLayerId: number | undefined;
            let neutralGrayLayerId: number | undefined;
            let imageLayerId: number;
            let clippingVerified = false;
            let retouchLayersVerified: boolean | undefined;

            if (isPreparedSkuRetouchSource(retouchSource)) {
                const backupResult = await callTool('placeImage', {
                    filePath: slot.source.filePath,
                    name: `${slot.source.colorName}-原始素材（备份）`,
                    targetBounds: internalGeometry.image,
                    targetFit: 'contain',
                    layerOrder: 'back'
                }, 'place-source-backup', sourceId);
                sourceBackupLayerId = readPositiveId(backupResult, ['layerId', 'placedLayerId', 'createdLayerId']);
                if (!backupResult?.success || !sourceBackupLayerId) {
                    return fail('place-source-backup', toolError(backupResult, `“${slot.source.colorName}”原始素材备份置入失败。`));
                }
                const hideBackupResult = await callTool('setLayerVisibility', {
                    layerId: sourceBackupLayerId,
                    visible: false
                }, 'hide-source-backup', sourceId);
                if (!hideBackupResult?.success) {
                    return fail('hide-source-backup', toolError(hideBackupResult, `“${slot.source.colorName}”原始素材备份无法隐藏。`));
                }

                const shadowResult = await callTool('placeImage', {
                    filePath: retouchSource.shadowPath,
                    name: `${slot.source.colorName}-原影`,
                    targetBounds: internalGeometry.image,
                    targetFit: 'contain',
                    layerOrder: 'front'
                }, 'place-retouched-shadow', sourceId);
                shadowLayerId = readPositiveId(shadowResult, ['layerId', 'placedLayerId', 'createdLayerId']);
                if (!shadowResult?.success || !shadowLayerId) {
                    return fail('place-retouched-shadow', toolError(shadowResult, `“${slot.source.colorName}”原影层置入失败。`));
                }
                const shadowClipResult = await callTool('createClippingMask', {
                    layerId: shadowLayerId
                }, 'clip-retouched-shadow', sourceId);
                const shadowClipReadback = shadowClipResult?.success
                    ? await callTool('getClippingMaskInfo', { layerId: shadowLayerId }, 'verify-retouched-shadow-clipping', sourceId)
                    : shadowClipResult;
                if (!isSkuColorCardClippingReadbackVerified(shadowClipReadback)) {
                    return fail('verify-retouched-shadow-clipping', toolError(shadowClipReadback, `“${slot.source.colorName}”原影层剪切关系未通过读回。`));
                }

                const productResult = await callTool('placeImage', {
                    filePath: retouchSource.productPath,
                    name: `${slot.source.colorName}-形态统一主体`,
                    targetBounds: internalGeometry.image,
                    targetFit: 'contain',
                    layerOrder: 'front'
                }, 'place-retouched-product', sourceId);
                imageLayerId = readPositiveId(productResult, ['layerId', 'placedLayerId', 'createdLayerId']) || 0;
                if (!productResult?.success || !imageLayerId) {
                    return fail('place-retouched-product', toolError(productResult, `“${slot.source.colorName}”形态统一主体置入失败。`));
                }
                const productClipResult = await callTool('createClippingMask', {
                    layerId: imageLayerId
                }, 'clip-retouched-product', sourceId);
                const productClipReadback = productClipResult?.success
                    ? await callTool('getClippingMaskInfo', { layerId: imageLayerId }, 'verify-retouched-product-clipping', sourceId)
                    : productClipResult;
                clippingVerified = isSkuColorCardClippingReadbackVerified(productClipReadback);
                if (!clippingVerified) {
                    return fail('verify-retouched-product-clipping', toolError(productClipReadback, `“${slot.source.colorName}”主体层剪切关系未通过读回。`));
                }

                const neutralGrayResult = await callTool('placeImage', {
                    filePath: retouchSource.neutralGrayPath,
                    name: `${slot.source.colorName}-中性灰光影修正`,
                    targetBounds: internalGeometry.image,
                    targetFit: 'contain',
                    layerOrder: 'front'
                }, 'place-neutral-gray-correction', sourceId);
                neutralGrayLayerId = readPositiveId(neutralGrayResult, ['layerId', 'placedLayerId', 'createdLayerId']);
                if (!neutralGrayResult?.success || !neutralGrayLayerId) {
                    return fail('place-neutral-gray-correction', toolError(neutralGrayResult, `“${slot.source.colorName}”中性灰修正层置入失败。`));
                }
                const blendResult = await callTool('setBlendMode', {
                    layerId: neutralGrayLayerId,
                    blendMode: 'softLight'
                }, 'set-neutral-gray-soft-light', sourceId);
                if (!blendResult?.success) {
                    return fail('set-neutral-gray-soft-light', toolError(blendResult, `“${slot.source.colorName}”中性灰层无法设为柔光。`));
                }
                const neutralClipResult = await callTool('createClippingMask', {
                    layerId: neutralGrayLayerId
                }, 'clip-neutral-gray-correction', sourceId);
                const neutralClipReadback = neutralClipResult?.success
                    ? await callTool('getClippingMaskInfo', { layerId: neutralGrayLayerId }, 'verify-neutral-gray-clipping', sourceId)
                    : neutralClipResult;
                const neutralProperties = await callTool('getLayerProperties', {
                    layerId: neutralGrayLayerId
                }, 'verify-neutral-gray-properties', sourceId);
                retouchLayersVerified = isSkuColorCardClippingReadbackVerified(neutralClipReadback)
                    && isSoftLightVerified(neutralProperties);
                if (!retouchLayersVerified) {
                    return fail('verify-neutral-gray-layer', '中性灰修正层未同时读回为柔光模式和有效剪切关系。');
                }
            } else {
                const imageResult = await callTool('placeImage', {
                    filePath: slot.source.filePath,
                    name: `${slot.source.colorName}-商品图`,
                    targetBounds: internalGeometry.image,
                    targetFit: 'contain',
                    layerOrder: 'front'
                }, 'place-product-image-draft', sourceId);
                imageLayerId = readPositiveId(imageResult, ['layerId', 'placedLayerId', 'createdLayerId']) || 0;
                if (!imageResult?.success || !imageLayerId) {
                    return fail('place-product-image', toolError(imageResult, `“${slot.source.colorName}”图片置入失败。`));
                }

                const clippingResult = await callTool('createClippingMask', {
                    layerId: imageLayerId
                }, 'clip-product-image', sourceId);
                if (!clippingResult?.success) {
                    return fail('clip-product-image', toolError(clippingResult, `“${slot.source.colorName}”图片剪切蒙版创建失败。`));
                }
                const clippingReadback = await callTool('getClippingMaskInfo', {
                    layerId: imageLayerId
                }, 'verify-product-clipping', sourceId);
                clippingVerified = isSkuColorCardClippingReadbackVerified(clippingReadback);
                if (!clippingVerified) {
                    return fail('verify-product-clipping', toolError(clippingReadback, `“${slot.source.colorName}”图片未读回为剪切蒙版。`));
                }
            }

            const labelResult = await callTool('createRectangle', {
                name: `${slot.source.colorName}-色名白底`,
                ...internalGeometry.label,
                fillColorHex: plan.cardStyle.labelFillColorHex,
                cornerRadius: internalGeometry.label.cornerRadius
            }, 'create-color-label-background', sourceId);
            const labelBackgroundLayerId = readPositiveId(labelResult, ['layerId', 'createdLayerId']);
            if (!labelResult?.success || !labelBackgroundLayerId) {
                return fail('create-color-label-background', toolError(labelResult, `“${slot.source.colorName}”白色色名底创建失败。`));
            }

            const textResult = await callTool('createTextLayer', {
                content: slot.source.colorName,
                name: `${slot.source.colorName}-色名`,
                ...internalGeometry.text,
                colorHex: plan.cardStyle.labelTextColorHex,
                alignment: 'left'
            }, 'create-color-label-text', sourceId);
            const labelTextLayerId = readPositiveId(textResult, ['layerId', 'createdLayerId']);
            if (!textResult?.success || !labelTextLayerId) {
                return fail('create-color-label-text', toolError(textResult, `“${slot.source.colorName}”色名文字创建失败。`));
            }

            const textFitResult = await fitAndCenterLabelText({
                sourceId,
                labelLayerId: labelBackgroundLayerId,
                textLayerId: labelTextLayerId,
                initialFontSize: internalGeometry.text.fontSize
            });
            if (!textFitResult.verified) {
                return fail(
                    'verify-label-text-fit',
                    `“${slot.source.colorName}”色名文字适配未通过：${textFitResult.error || '未知原因'}`
                );
            }

            const closeResult = await callTool('closeDocument', {
                documentId: internalDocumentId,
                save: true
            }, 'save-and-close-smart-object', sourceId);
            if (!closeResult?.success) {
                return fail('save-and-close-smart-object', toolError(closeResult, `“${slot.source.colorName}”智能对象保存失败。`));
            }

            const switchMainResult = await callTool('switchDocument', {
                documentId: mainDocumentId,
                documentName: plan.documentName
            }, 'return-to-main-document', sourceId);
            if (!switchMainResult?.success) {
                return fail('return-to-main-document', toolError(switchMainResult, '无法返回 SKU 主文档。'));
            }
            const reboundMainDocumentResult = await callTool(
                'getDocumentInfo',
                {},
                'rebind-main-document-after-switch',
                sourceId
            );
            const reboundMainDocument = readDocumentSize(reboundMainDocumentResult);
            if (!reboundMainDocumentResult?.success
                || reboundMainDocument?.documentId !== mainDocumentId) {
                return fail(
                    'rebind-main-document-after-switch',
                    '切回 SKU 主文档后未能读回同一文档身份，已停止后续图层写入。'
                );
            }
            const reboundMainHierarchyResult = await callTool(
                'getLayerHierarchy',
                {},
                'rebind-main-layers-after-switch',
                sourceId
            );
            if (!reboundMainHierarchyResult?.success) {
                return fail(
                    'rebind-main-layers-after-switch',
                    `切回 SKU 主文档后无法重新读取颜色组“${slot.groupName}”及其智能对象图层。`
                );
            }

            const moveSmartObjectResult = await callTool('moveLayerToGroup', {
                layerId: smartObjectLayerId,
                targetGroupId: groupId,
                position: 'inside'
            }, 'group-smart-object', sourceId);
            if (!moveSmartObjectResult?.success) {
                return fail('group-smart-object', toolError(moveSmartObjectResult, `“${slot.source.colorName}”智能对象无法移入颜色组。`));
            }

            const smartObjectInfo = await callTool('getSmartObjectInfo', {
                layerId: smartObjectLayerId
            }, 'verify-smart-object', sourceId);
            const smartObjectVerified = isSmartObjectVerified(smartObjectInfo);
            if (!smartObjectVerified) {
                return fail('verify-smart-object', toolError(smartObjectInfo, `“${slot.source.colorName}”未读回为可编辑智能对象。`));
            }

            preparedCards.push({
                sourceId,
                colorName: slot.source.colorName,
                colorNameSource: slot.source.colorNameSource,
                sourcePath: slot.source.filePath,
                groupId,
                smartObjectLayerId,
                internalDocumentId,
                internalCanvas: { width: internalSize.width, height: internalSize.height },
                imageLayerId,
                labelBackgroundLayerId,
                labelTextLayerId,
                clippingVerified,
                smartObjectVerified,
                labelTextFitVerified: textFitResult.verified,
                sourceBackupLayerId,
                shadowLayerId,
                neutralGrayLayerId,
                retouchLayersVerified,
                retouchAssetReportPath: isPreparedSkuRetouchSource(retouchSource)
                    ? retouchReport?.reportPath
                    : undefined
            });
            emitSkillStep(callbacks, {
                kind: 'verification',
                title: `色卡结构已确认：${slot.source.colorName}`,
                detail: '已读回智能对象、商品图剪切关系，以及色名文字的真实边界与居中结果。',
                status: 'success',
                percent: progressBase + 8
            });
        }

        if (plan.indexReference.enabled) {
            const referenceGroupResult = await callTool('createGroup', {
                groupName: plan.indexReference.groupName
            }, 'create-index-reference-group');
            const referenceGroupId = readPositiveId(referenceGroupResult, ['layerId', 'createdLayerId', 'id']);
            if (!referenceGroupResult?.success || !referenceGroupId) {
                return fail(
                    'create-index-reference-group',
                    toolError(referenceGroupResult, '序号参考组创建失败。')
                );
            }
            const normalizeReferenceGroupResult = await callTool('moveLayerToGroup', {
                layerId: referenceGroupId,
                targetGroupId: 0,
                position: 'inside'
            }, 'normalize-index-reference-group-root');
            if (!normalizeReferenceGroupResult?.success) {
                return fail(
                    'normalize-index-reference-group-root',
                    toolError(normalizeReferenceGroupResult, '序号参考组无法归位到文档根层级。')
                );
            }

            for (const slot of plan.slots) {
                if (!slot.indexText) continue;
                const indexTextResult = await callTool('createTextLayer', {
                    content: slot.indexText.content,
                    name: slot.indexLayerName,
                    x: slot.indexText.x,
                    y: slot.indexText.y,
                    fontSize: slot.indexText.fontSize,
                    colorHex: '#111111',
                    alignment: 'center'
                }, 'create-index-reference-text', slot.source.sourceId);
                const indexLayerId = readPositiveId(indexTextResult, ['layerId', 'createdLayerId']);
                if (!indexTextResult?.success || !indexLayerId) {
                    return fail(
                        'create-index-reference-text',
                        toolError(indexTextResult, `“${slot.source.colorName}”参考序号创建失败。`)
                    );
                }
                const moveIndexResult = await callTool('moveLayerToGroup', {
                    layerId: indexLayerId,
                    targetGroupId: referenceGroupId,
                    position: 'inside'
                }, 'move-index-to-reference-group', slot.source.sourceId);
                if (!moveIndexResult?.success) {
                    return fail(
                        'move-index-to-reference-group',
                        toolError(moveIndexResult, `“${slot.source.colorName}”参考序号无法移入参考组。`)
                    );
                }
            }
            indexReferenceIsolation = 'passed';
        }

        const finalDocumentInfo = await callTool('getDocumentInfo', {}, 'verify-main-document');
        const finalDocumentSize = readDocumentSize(finalDocumentInfo);
        if (!finalDocumentInfo?.success
            || !finalDocumentSize
            || finalDocumentSize.documentId !== mainDocumentId
            || finalDocumentSize.width !== plan.canvas.width
            || finalDocumentSize.height !== plan.canvas.height) {
            return fail('verify-main-document', '最终活动文档不是预期的 SKU 画布，已停止保存。');
        }

        const snapshotResult = await callTool('getAcceptanceSnapshot', {
            includeHidden: true,
            includeText: true,
            includeBounds: true,
            maxLayers: 240
        }, 'final-structure-readback');
        if (!snapshotResult?.success) {
            return fail('final-structure-readback', toolError(snapshotResult, 'SKU 色卡完成后无法读回图层结构。'));
        }

        const draftVisualSnapshot = await callTool('getCanvasSnapshot', {
            maxSize: 1500
        }, 'draft-visual-snapshot');
        if (!draftVisualSnapshot?.success) {
            return fail('draft-visual-snapshot', toolError(draftVisualSnapshot, 'SKU 色卡结构草稿创建后无法取得视觉快照。'));
        }

        const saveResult = await callTool('saveDocument', {
            format: 'psb',
            path: plan.outputPath,
            saveAs: true
        }, 'save-output');
        if (!saveResult?.success) {
            return fail('save-output', toolError(saveResult, `SKU 色卡无法保存到 ${plan.outputPath}。`));
        }

        const report: SkuColorCardExecutionReport = {
            version: SKU_COLOR_CARD_EXECUTION_REPORT_VERSION,
            status: 'structure_ready',
            outputPath: plan.outputPath,
            documentId: mainDocumentId,
            sourceCount: plan.slots.length,
            preparedCards,
            checks: {
                sourceCoverage: resolveSourceCoverageStatus(preparedCards, plan.slots.length),
                smartObjectEditability: preparedCards.every((card) => card.smartObjectVerified) ? 'passed' : 'failed',
                clippingStructure: preparedCards.every((card) => card.clippingVerified) ? 'passed' : 'failed',
                labelTextFit: preparedCards.every((card) => card.labelTextFitVerified) ? 'passed' : 'failed',
                indexReferenceIsolation,
                finalStructureReadback: 'passed',
                visualComposition: 'needs_review',
                retouchAssets: retouchReport?.workflowStatus === 'prepared'
                    ? 'passed'
                    : 'not_applicable',
                retouchLayerStructure: resolveRetouchLayerStructureCheck(preparedCards)
            },
            retouchReport
        };
        const retouchedCardCount = preparedCards.filter((card) => card.retouchLayersVerified === true).length;
        const allCardsRetouched = retouchedCardCount === preparedCards.length && preparedCards.length > 0;
        const visualAdjustmentHandoff = {
            version: 'sku-color-card-visual-adjustment-handoff/v0' as const,
            status: 'needs_visual_review' as const,
            mainDocumentId,
            outputPath: plan.outputPath,
            cards: preparedCards.map((card) => ({
                colorName: card.colorName,
                colorNameSource: card.colorNameSource,
                sourcePath: card.sourcePath,
                smartObjectLayerId: card.smartObjectLayerId,
                imageLayerId: card.imageLayerId,
                labelBackgroundLayerId: card.labelBackgroundLayerId,
                labelTextLayerId: card.labelTextLayerId,
                internalCanvas: card.internalCanvas,
                retouchLayersVerified: card.retouchLayersVerified === true,
                /**
                 * 主体适配的建议参数——色卡的构图标准属于本 Skill，不该让模型每次现推。
                 *
                 * 关键是 subjectFillRatio：fitLayerSubjectToRegion 的说明让模型按
                 * getDesignPrinciples 的档位取值，而那里写的是「电商主图主体常占 40%~60%」——
                 * 那是主图要留白呼吸的标准。色卡是巴掌大的格子、要看清花色纹理，主体必须顶到 0.9，
                 * 照主图档位调必然偏小（真机 2026-08-01：袜子只占卡片约四成，四周全是拍摄环境）。
                 *
                 * targetRegion 取内部画布全幅：主体填满整格，上下不会剩黑边。
                 */
                suggestedSubjectFit: card.retouchLayersVerified === true ? undefined : {
                    tool: 'fitLayerSubjectToRegion',
                    layerId: card.imageLayerId,
                    targetRegion: {
                        x: 0,
                        y: 0,
                        width: card.internalCanvas.width,
                        height: card.internalCanvas.height
                    },
                    subjectFillRatio: 0.9,
                    method: 'smart',
                    rationale: '色卡格子小、要看清花色，主体占比取 0.9；这是色卡档位，不适用主图 40%~60% 的留白标准。'
                }
            })),
            reviewQuestions: [
                '商品主体是否足够突出，且没有因原图留白显得偏小？',
                '主体重心和裁切是否适合卡片，而不是机械居中或机械铺满？',
                '色名标签是否遮挡关键商品细节，整体位置是否需要微调？'
            ],
            nextSteps: [
                '只打开尚未复核的色卡智能对象并取得真实画布快照；不要移动 SKU 主文档中的颜色组或重新编排卡片。',
                '先由视觉模型判断主体大小、重心、轮廓、原影和光影是否一致；只有未生成精修层的原图卡片才默认考虑 fitLayerSubjectToRegion。',
                '已有「形态统一主体 / 原影 / 中性灰光影修正」图层的卡片只在画面确实需要时做小步调整，不重复运行旧形态位移工具。',
                '若主体检测失败或超时，不重复阻塞调用：由视觉模型给出放大/缩小和移动方向，使用 transformLayer/moveLayer 小步调整。',
                '只有画面确实需要修改时才执行一次小步调整；每次调整后重新取得快照复核，再保存关闭智能对象并返回 SKU 主文档。',
                '同一对象的写后验收未通过时停止重复动作，改用其他方法或如实说明阻塞原因。',
                '全部色卡复核后保存主文档，并读取最终画面与结构；视觉未复核时不得声明设计完成。'
            ]
        };
        emitSkillStep(callbacks, {
            kind: 'observation',
            title: 'SKU 色卡结构草稿已生成',
            detail: `已创建 ${preparedCards.length} 个可编辑颜色卡，其中 ${retouchedCardCount} 个包含形态、原影和中性灰精修层；下一步需要 Agent 依据真实快照完成视觉验收。`,
            status: 'running',
            percent: 88
        });
        callbacks?.onProgress?.('SKU 色卡结构草稿已生成，等待视觉调整', 88);

        return {
            success: true,
            // 结构化交接：nextSteps 那些句子是散文，模型可以读也可以忽略；只有这两个字段
            // 会被 Agent 循环翻译成下一轮的工具 allowlist（agent.ts resolveRequiredToolRecovery）。
            // 真机 2026-08-01：交接信息一应俱全，但全在 data 里当参考，模型看了 12 次快照、
            // 一次没调过主体大小——因为「结构做完」和「设计做完」之间缺一条有约束力的通道。
            nextRequiredToolOptions: allCardsRetouched
                ? ['getAnnotatedSnapshot', 'getCanvasSnapshot', 'editSmartObjectContents', 'transformLayer']
                : ['fitLayerSubjectToRegion', 'getSubjectBounds', 'transformLayer', 'getAnnotatedSnapshot'],
            nextRequiredToolReason: allCardsRetouched
                ? '色卡的形态统一主体、独立原影和中性灰修正层已经写入并完成结构读回；请查看真实画面，比较五个颜色的轮廓、受光、阴影方向和裁切，只在有明确视觉问题时小步修订。'
                : '部分卡片没有适用纯底精修资产，仍需查看真实画面；未精修卡片可在主体检测可靠时使用 fitLayerSubjectToRegion，已有精修层的卡片不要重复套用旧形态位移。',
            message: `SKU 色卡可编辑结构已生成：${preparedCards.length} 个颜色，${retouchedCardCount} 个已写入形态、原影和中性灰精修层，已保存到 ${plan.outputPath}；仍需 Agent 根据真实快照完成最终视觉验收。${preparedCards.some((card) => card.colorNameSource !== 'provided') ? '部分标签来自文件名或未经证实的候选，真实颜色名仍待确认。' : ''}`,
            toolResults: observations,
            data: {
                plan,
                report,
                snapshot: draftVisualSnapshot.snapshot,
                snapshotResult,
                draftVisualSnapshot,
                saveResult,
                sourceResolution,
                visualAdjustmentHandoff,
                agentReActContinuation: {
                    status: 'needs_decision',
                    summary: 'SKU 色卡可编辑结构与可用精修层已生成，但轮廓、光影、原影、重心和裁切尚未由 Agent 根据真实画面确认。',
                    details: [
                        `已创建 ${preparedCards.length} 个可编辑色卡智能对象。`,
                        `其中 ${retouchedCardCount} 个已写入形态统一主体、独立原影和中性灰光影修正层。`,
                        '色名文字已按 Photoshop 真实 bounds 完成宽度适配和水平/垂直居中。',
                        '已取得 SKU 主文档写后视觉快照。'
                    ],
                    warnings: [
                        '当前只完成结构和离线精修资产写入；没有通过真实快照视觉验收，不得直接宣称专业精修完成。',
                        ...(preparedCards.some((card) => card.colorNameSource !== 'provided')
                            ? ['部分色名只是文件名或模型/上游推断生成的 provisional 资产标签；确认真实颜色名之前不得宣称色名准确性通过。']
                            : []),
                        '视觉复核只处理智能对象内部商品图，不得移动主文档颜色组或重复执行验收未通过的相同动作。'
                    ],
                    nextAction: 'decide_next',
                    sourceStatus: 'structure_ready'
                }
            }
        };
}
