/**
 * Set text content while keeping the current text-layer formatting stable.
 *
 * The primary write path swaps only the text payload. Ordinary edits remap
 * formatting from the current live descriptor; candidate switching may opt in
 * to an explicit baselineContent so repeated alternatives stay anchored without
 * letting an implicit stale cache overwrite later style edits.
 */

import { safeBatchPlay } from '../../core/error-handler';
import {
    readActiveHistoryStateRef,
    sameHistoryStateRef,
    type PhotoshopHistoryStateRef
} from '../../core/photoshop-history-state-ref';
import { createToolFailureResult } from '../../core/tool-error-normalizer';
import { normalizePhotoshopTextContent, toPhotoshopTextKey } from '../../core/photoshop-text-content';
import {
    photoshopTransactionRunner,
    type PhotoshopTransactionPreparation
} from '../../core/photoshop-transaction-runner';
import type { Tool, ToolExecutionContext, ToolSchema } from '../types';

const app = require('photoshop').app;
const { LayerKind } = require('photoshop').constants;

type BoundsLike = { left: number; top: number; right: number; bottom: number };

type TextUpdate = {
    layerId: number;
    content: string;
    baselineContent?: string;
    expectedCurrentContent?: string;
};

interface SetTextContentParams {
    layerId?: number;
    content?: string;
    baselineContent?: string;
    expectedCurrentContent?: string;
    expectedDocumentId?: number;
    expectedHistoryStateRef?: PhotoshopHistoryStateRef;
    updates?: TextUpdate[];
}

interface TextContentChecks {
    isOutOfBounds: boolean;
    isClipped: boolean;
    overflowDirection?: string;
    suggestedFix?: string;
}

interface TextContentResultItem {
    layerId: number;
    previousContent: string;
    newContent: string;
    checks: TextContentChecks;
    layerBounds?: BoundsLike;
}

interface SetTextContentResult extends Record<string, unknown> {
    success: boolean;
    layerId?: number;
    previousContent?: string;
    newContent?: string;
    results?: TextContentResultItem[];
    error?: string;
    code?: string;
    checks?: TextContentChecks;
    layerBounds?: BoundsLike;
    canvasBounds?: { width: number; height: number };
    errorDetails?: unknown;
    data?: null;
}

interface PreparedTextContentUpdate {
    layerId: number;
    previousContent: string;
    previousNormalizedContent: string;
    newContent: string;
    baselineContent: string;
    expectedCurrentContent?: string;
    sourceDescriptor: any | null;
}

interface SetTextContentBefore {
    documentId: number;
    canvasBounds: { width: number; height: number };
    batchMode: boolean;
    updates: PreparedTextContentUpdate[];
}

interface LiveTextContentState {
    layerId: number;
    exists: boolean;
    isTextLayer: boolean;
    content?: string;
    bounds?: BoundsLike;
}

interface SetTextContentReadback {
    documentId: number;
    layers: LiveTextContentState[];
}

type FormattingBaseline = {
    documentId: number;
    baselineContent: string;
    descriptor: any | null;
};

export class SetTextContentTool implements Tool {
    name = 'setTextContent';
    private formattingBaselines: Map<string, FormattingBaseline> = new Map();

    schema: ToolSchema = {
        name: 'setTextContent',
        description: '完整替换一个或多个文本图层的内容。普通调用始终以当前 live descriptor 保持字体、字号和布局；baselineContent 仅供显式候选文案切换使用，不能作为普通编辑的隐式缓存。批量 updates 优先于顶层 layerId/content。',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: '单层模式的目标文本图层 ID；省略时使用当前唯一选中的文本图层。'
                },
                content: {
                    type: 'string',
                    description: '单层模式的新完整文本。'
                },
                baselineContent: {
                    type: 'string',
                    description: '候选文案生成时显式捕获的原文，仅用于同一文档/图层的候选切换；普通编辑不要提供。'
                },
                expectedCurrentContent: {
                    type: 'string',
                    description: '可选的比较后写入前置条件；仅当目标图层当前完整文字仍与该值一致时才写入。'
                },
                expectedDocumentId: {
                    type: 'number',
                    description: '可选的目标文档前置条件；活动文档不匹配时拒绝写入。'
                },
                expectedHistoryStateRef: {
                    type: 'object',
                    description: '可选的 Photoshop 修订前置条件；文档或 history 已变化时拒绝写入。',
                    properties: {
                        documentId: { type: 'number' },
                        historyStateId: { type: 'number' }
                    },
                    required: ['documentId', 'historyStateId']
                },
                updates: {
                    type: 'array',
                    description: '批量模式；提供后忽略顶层 layerId/content。',
                    items: {
                        type: 'object',
                        properties: {
                            layerId: {
                                type: 'number',
                                description: '目标文本图层 ID。'
                            },
                            content: {
                                type: 'string',
                                description: '新完整文本。'
                            },
                            baselineContent: {
                                type: 'string',
                                description: '可选的显式候选文案基线；普通批量编辑不要提供。'
                            },
                            expectedCurrentContent: {
                                type: 'string',
                                description: '可选的比较后写入前置条件。'
                            }
                        },
                        required: ['layerId', 'content']
                    }
                }
            },
            required: []
        }
    };

    async execute(
        params: SetTextContentParams,
        context?: ToolExecutionContext
    ): Promise<SetTextContentResult> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return createToolFailureResult({ toolName: this.name, error: '没有打开的文档', params });
            }
            const initialPreconditionError = this.readTargetPreconditionError(params, doc);
            if (initialPreconditionError) {
                return createToolFailureResult({
                    toolName: this.name,
                    error: initialPreconditionError,
                    params
                });
            }

            const canvasBounds = {
                width: Number(doc.width) || 0,
                height: Number(doc.height) || 0
            };
            const preparedHistoryStateRef = readActiveHistoryStateRef(doc);

            if (params.updates && params.updates.length > 0) {
                const targetLayers = params.updates.map(update => {
                    const layer = this.resolveLayerByIdFast(doc, update.layerId);
                    if (!layer) {
                        throw new Error(`未找到图层 ID: ${update.layerId}`);
                    }
                    if (layer.kind !== LayerKind.TEXT) {
                        throw new Error(`图层 ID ${update.layerId} 不是文本图层`);
                    }
                    const previousContent = String(layer.textItem.contents || '');
                    if (typeof update.expectedCurrentContent === 'string'
                        && this.normalizeContent(previousContent)
                            !== this.normalizeContent(update.expectedCurrentContent)) {
                        throw new Error(`图层 ID ${update.layerId} 的文字已发生变化，已取消这次过期写入`);
                    }
                    return {
                        layer,
                        previousContent,
                        newContent: this.normalizeContent(update.content),
                        baselineContent: this.normalizeContent(update.baselineContent ?? ''),
                        expectedCurrentContent: typeof update.expectedCurrentContent === 'string'
                            ? this.normalizeContent(update.expectedCurrentContent)
                            : undefined
                    };
                });

                // 样式来源属于读取，放在 modal 之外先取好：modal 期间 Photoshop 对用户是
                // 冻结的，把读也塞进去只会拉长冻结时间，也更容易和别的操作抢互斥。
                const prepared = [] as Array<{ item: typeof targetLayers[number]; sourceDescriptor: any | null }>;
                for (const item of targetLayers) {
                    prepared.push({
                        item,
                        sourceDescriptor: await this.resolveSourceDescriptor(item.layer.id, item.baselineContent)
                    });
                }

                return await this.runTextContentTransaction({
                    params,
                    context,
                    preparedDocumentId: Number(doc.id),
                    preparedHistoryStateRef,
                    batchMode: true,
                    canvasBounds,
                    updates: prepared.map(entry => ({
                        layerId: Number(entry.item.layer.id),
                        previousContent: entry.item.previousContent,
                        previousNormalizedContent: this.normalizeContent(
                            entry.item.previousContent
                        ),
                        newContent: entry.item.newContent,
                        baselineContent: entry.item.baselineContent,
                        expectedCurrentContent: entry.item.expectedCurrentContent,
                        sourceDescriptor: entry.sourceDescriptor
                    }))
                });
            }

            if (typeof params.content !== 'string') {
                return createToolFailureResult({ toolName: this.name, error: '必须提供 content 或 updates', params });
            }

            const layer = this.resolveTargetLayer(doc, params.layerId);
            if (!layer) {
                return createToolFailureResult({
                    toolName: this.name,
                    error: params.layerId ? `未找到图层 ID: ${params.layerId}` : '请先选中一个文本图层',
                    params
                });
            }
            if (layer.kind !== LayerKind.TEXT) {
                return createToolFailureResult({ toolName: this.name, error: '选中的不是文本图层', params });
            }

            const previousContent = String(layer.textItem.contents || '');
            if (typeof params.expectedCurrentContent === 'string'
                && this.normalizeContent(previousContent)
                    !== this.normalizeContent(params.expectedCurrentContent)) {
                return createToolFailureResult({
                    toolName: this.name,
                    error: '目标文字已发生变化，已取消这次过期写入',
                    params
                });
            }
            const newContent = this.normalizeContent(params.content);
            const baselineContent = this.normalizeContent(params.baselineContent ?? '');

            const sourceDescriptor = await this.resolveSourceDescriptor(layer.id, baselineContent);

            return await this.runTextContentTransaction({
                params,
                context,
                preparedDocumentId: Number(doc.id),
                preparedHistoryStateRef,
                batchMode: false,
                canvasBounds,
                updates: [{
                    layerId: Number(layer.id),
                    previousContent,
                    previousNormalizedContent: this.normalizeContent(previousContent),
                    newContent,
                    baselineContent,
                    expectedCurrentContent: typeof params.expectedCurrentContent === 'string'
                        ? this.normalizeContent(params.expectedCurrentContent)
                        : undefined,
                    sourceDescriptor
                }]
            });
        } catch (error) {
            console.error('[SetTextContent] Error:', error);
            return createToolFailureResult({ toolName: this.name, error, params });
        }
    }

    private async runTextContentTransaction(input: {
        params: SetTextContentParams;
        context?: ToolExecutionContext;
        preparedDocumentId: number;
        preparedHistoryStateRef?: PhotoshopHistoryStateRef;
        batchMode: boolean;
        canvasBounds: { width: number; height: number };
        updates: PreparedTextContentUpdate[];
    }): Promise<SetTextContentResult> {
        const owner = this;
        const operationId = `setTextContent:${String(
            input.context?.requestId
            || `${input.updates.map(update => update.layerId).join(',')}:${Date.now()}`
        )}`;

        return await photoshopTransactionRunner.run<
            SetTextContentBefore,
            SetTextContentReadback,
            SetTextContentResult
        >({
            operationId,
            toolName: this.name,
            commandName: input.batchMode
                ? 'DesignEcho: 批量修改文本'
                : 'DesignEcho: 修改文本',
            params: input.params,
            context: input.context,
            historyMode: 'suspend',
            expectedEffect: 'mutation_required',
            rollbackTargetPolicy: 'document_revision',
            prepare(scope): PhotoshopTransactionPreparation<SetTextContentBefore, SetTextContentResult> {
                if (Number(scope.document.id) !== input.preparedDocumentId) {
                    return {
                        kind: 'complete',
                        effect: 'none',
                        result: owner.buildTextContentFailure(
                            input.params,
                            'set_text_content_document_changed',
                            '读取目标文字后活动文档发生了变化，已取消这次过期写入。请重新读取目标文档后重试。'
                        )
                    };
                }
                const targetPreconditionError = owner.readTargetPreconditionError(
                    input.params,
                    scope.document
                );
                if (targetPreconditionError) {
                    return {
                        kind: 'complete',
                        effect: 'none',
                        result: owner.buildTextContentFailure(
                            input.params,
                            'set_text_content_target_changed',
                            targetPreconditionError
                        )
                    };
                }
                if (input.preparedHistoryStateRef
                    && !sameHistoryStateRef(
                        input.preparedHistoryStateRef,
                        readActiveHistoryStateRef(scope.document)
                    )) {
                    return {
                        kind: 'complete',
                        effect: 'none',
                        result: owner.buildTextContentFailure(
                            input.params,
                            'set_text_content_prepared_revision_changed',
                            '读取文字格式后 Photoshop 修订发生了变化，已取消这次过期写入。请重新读取目标文字后重试。'
                        )
                    };
                }

                const uniqueLayerIds = new Set(input.updates.map(update => update.layerId));
                if (uniqueLayerIds.size !== input.updates.length) {
                    return {
                        kind: 'complete',
                        effect: 'none',
                        result: owner.buildTextContentFailure(
                            input.params,
                            'set_text_content_duplicate_target',
                            '批量 updates 含重复 layerId，无法为同一图层判定唯一目标内容；本次未写入。'
                        )
                    };
                }

                for (const update of input.updates) {
                    const live = owner.readLiveTextContentState(
                        scope.document,
                        update.layerId
                    );
                    if (!live.exists) {
                        return {
                            kind: 'complete',
                            effect: 'none',
                            result: owner.buildTextContentFailure(
                                input.params,
                                'set_text_content_target_not_found',
                                `未找到图层 ID: ${update.layerId}`
                            )
                        };
                    }
                    if (!live.isTextLayer) {
                        return {
                            kind: 'complete',
                            effect: 'none',
                            result: owner.buildTextContentFailure(
                                input.params,
                                'set_text_content_target_not_text',
                                `图层 ID ${update.layerId} 不是文本图层。`
                            )
                        };
                    }
                    if (live.content !== update.previousNormalizedContent) {
                        return {
                            kind: 'complete',
                            effect: 'none',
                            result: owner.buildTextContentFailure(
                                input.params,
                                'set_text_content_target_changed',
                                `图层 ID ${update.layerId} 的文字在写入前发生了变化，已取消这次过期写入。`
                            )
                        };
                    }
                    if (update.expectedCurrentContent !== undefined
                        && live.content !== update.expectedCurrentContent) {
                        return {
                            kind: 'complete',
                            effect: 'none',
                            result: owner.buildTextContentFailure(
                                input.params,
                                'set_text_content_expected_content_mismatch',
                                `图层 ID ${update.layerId} 的文字不再匹配 expectedCurrentContent，本次未写入。`
                            )
                        };
                    }
                }

                const before: SetTextContentBefore = {
                    documentId: Number(scope.document.id),
                    canvasBounds: input.canvasBounds,
                    batchMode: input.batchMode,
                    updates: input.updates
                };
                const alreadySatisfied = input.updates.every(
                    update => update.previousNormalizedContent === update.newContent
                );
                if (alreadySatisfied) {
                    return {
                        kind: 'complete',
                        effect: 'already_satisfied',
                        result: owner.buildVerifiedTextContentResult(
                            before,
                            owner.readTextContentReadback(scope.document, before)
                        )
                    };
                }
                return { kind: 'ready', before };
            },
            async mutate(scope, before): Promise<SetTextContentResult> {
                for (const update of before.updates) {
                    const layer = owner.resolveLayerByIdFast(
                        scope.document,
                        update.layerId
                    );
                    if (!layer || layer.kind !== LayerKind.TEXT) {
                        return owner.buildTextContentFailure(
                            input.params,
                            'set_text_content_target_changed',
                            `图层 ID ${update.layerId} 在写入阶段不可用，已停止并回滚。`
                        );
                    }
                    const liveContent = owner.normalizeContent(
                        layer.textItem.contents || ''
                    );
                    if (liveContent !== update.previousNormalizedContent) {
                        return owner.buildTextContentFailure(
                            input.params,
                            'set_text_content_target_changed',
                            `图层 ID ${update.layerId} 的文字在写入阶段发生变化，已停止并回滚。`
                        );
                    }
                    if (update.previousNormalizedContent === update.newContent) {
                        continue;
                    }
                    await owner.applyContentPreservingFormatting(
                        layer,
                        update.newContent,
                        update.sourceDescriptor,
                        update.baselineContent
                    );
                }
                return {
                    success: true,
                    canvasBounds: before.canvasBounds
                };
            },
            readState({ scope, before }): SetTextContentReadback {
                return owner.readTextContentReadback(scope.document, before);
            },
            verifyApplied({ before, after }) {
                const mismatches = before.updates.filter((update, index) => {
                    const live = after.layers[index];
                    return !live
                        || !live.exists
                        || !live.isTextLayer
                        || live.layerId !== update.layerId
                        || live.content !== update.newContent;
                });
                return {
                    verified: after.documentId === before.documentId
                        && mismatches.length === 0,
                    message: mismatches.length === 0
                        ? undefined
                        : `setTextContent 写后逐层读回不一致：${mismatches.map(
                            update => `图层 ${update.layerId} 预期“${update.newContent}”`
                        ).join('；')}。`
                };
            },
            verifyRolledBack({ before, after }) {
                const mismatches = before.updates.filter((update, index) => {
                    const live = after.layers[index];
                    return !live
                        || !live.exists
                        || !live.isTextLayer
                        || live.layerId !== update.layerId
                        || live.content !== update.previousNormalizedContent;
                });
                return {
                    verified: after.documentId === before.documentId
                        && mismatches.length === 0,
                    message: mismatches.length === 0
                        ? 'setTextContent 失败后已恢复全部目标图层的原文字。'
                        : `setTextContent 回滚后仍有内容不一致的图层：${mismatches.map(
                            update => update.layerId
                        ).join(', ')}。`
                };
            },
            buildVerifiedResult({ before, after }): SetTextContentResult {
                return owner.buildVerifiedTextContentResult(before, after);
            }
        });
    }

    private readTargetPreconditionError(
        params: SetTextContentParams,
        document: any
    ): string | undefined {
        const activeDocumentId = Number(document?.id);
        if (Number.isSafeInteger(params.expectedDocumentId)
            && Number(params.expectedDocumentId) > 0
            && activeDocumentId !== params.expectedDocumentId) {
            return '活动文档已发生变化，已取消这次过期写入';
        }
        if (params.expectedHistoryStateRef
            && !sameHistoryStateRef(
                params.expectedHistoryStateRef,
                readActiveHistoryStateRef(document)
            )) {
            return '目标 Photoshop 修订已发生变化，已取消这次过期写入';
        }
        return undefined;
    }

    private buildTextContentFailure(
        params: SetTextContentParams,
        code: string,
        error: string
    ): SetTextContentResult {
        return {
            ...createToolFailureResult({ toolName: this.name, error, params }),
            success: false,
            code,
            error
        };
    }

    private readLiveTextContentState(document: any, layerId: number): LiveTextContentState {
        const layer = this.resolveLayerByIdFast(document, layerId);
        if (!layer) {
            return { layerId, exists: false, isTextLayer: false };
        }
        const isTextLayer = layer.kind === LayerKind.TEXT;
        return {
            layerId: Number(layer.id),
            exists: true,
            isTextLayer,
            ...(isTextLayer
                ? {
                    content: this.normalizeContent(layer.textItem.contents || ''),
                    bounds: this.toBounds(layer.bounds)
                }
                : {})
        };
    }

    private readTextContentReadback(
        document: any,
        before: SetTextContentBefore
    ): SetTextContentReadback {
        return {
            documentId: Number(document.id),
            layers: before.updates.map(update => this.readLiveTextContentState(
                document,
                update.layerId
            ))
        };
    }

    private buildVerifiedTextContentResult(
        before: SetTextContentBefore,
        after: SetTextContentReadback
    ): SetTextContentResult {
        const results = before.updates.map((update, index): TextContentResultItem => {
            const live = after.layers[index];
            const bounds = live.bounds as BoundsLike;
            return {
                layerId: update.layerId,
                previousContent: update.previousContent,
                newContent: live.content as string,
                checks: this.buildTextContentChecks(bounds, before.canvasBounds),
                layerBounds: bounds
            };
        });
        if (before.batchMode) {
            return {
                success: true,
                results,
                canvasBounds: before.canvasBounds
            };
        }
        const result = results[0];
        return {
            success: true,
            layerId: result.layerId,
            previousContent: result.previousContent,
            newContent: result.newContent,
            checks: result.checks,
            layerBounds: result.layerBounds,
            canvasBounds: before.canvasBounds
        };
    }

    private buildTextContentChecks(
        bounds: BoundsLike,
        canvasBounds: { width: number; height: number }
    ): TextContentChecks {
        const overflows: string[] = [];
        if (bounds.left < 0) overflows.push('左侧');
        if (bounds.top < 0) overflows.push('上方');
        if (bounds.right > canvasBounds.width) overflows.push('右侧');
        if (bounds.bottom > canvasBounds.height) overflows.push('下方');

        const isOutOfBounds = overflows.length > 0;
        let suggestedFix = '';
        if (overflows.includes('右侧') || overflows.includes('左侧')) {
            suggestedFix = '建议：减小字号、缩短文案，或调整文本框宽度';
        }
        if (overflows.includes('下方') || overflows.includes('上方')) {
            suggestedFix = '建议：调整文本位置或减少行数';
        }
        if (overflows.length > 1) {
            suggestedFix = '建议：减小字号并重新定位文本';
        }
        return {
            isOutOfBounds,
            isClipped: isOutOfBounds,
            overflowDirection: overflows.length > 0 ? overflows.join('、') : undefined,
            suggestedFix: suggestedFix || undefined
        };
    }

    private resolveTargetLayer(doc: any, layerId?: number): any | null {
        if (layerId !== undefined) {
            return this.resolveLayerByIdFast(doc, layerId);
        }
        const activeLayers = doc.activeLayers;
        if (!activeLayers || activeLayers.length === 0) {
            return null;
        }
        return activeLayers[0];
    }

    /**
     * 按 ID 取图层：先看当前选中项，命中就跳过整棵图层树的递归。
     *
     * 递归遍历每访问一个 layer/layers 属性都要跨一次 UXP↔Photoshop 边界。
     * 真机实测（详情页.psb，115 图层，2026-08-06）：全树扫描约 1.1s，按 ID 定位约 150ms；
     * 而面板替换文案时目标图层几乎总是当前选中项，这一趟本来就不用走。
     */
    private resolveLayerByIdFast(doc: any, layerId: number): any | null {
        try {
            const activeLayers = doc.activeLayers;
            if (activeLayers && activeLayers.length > 0) {
                for (const layer of activeLayers) {
                    if (layer?.id === layerId) return layer;
                }
            }
        } catch {
            // 选中态读取失败不影响正确性，继续走全树查找
        }
        return this.findLayerById(doc, layerId);
    }

    /** 内部统一用 \n 表示换行，便于比对、切行和算字数。 */
    private normalizeContent(content: string): string {
        return normalizePhotoshopTextContent(content);
    }

    /** 写回 Photoshop 前把换行还原成硬回车 \r（口径见 core/photoshop-text-content）。 */
    private toPhotoshopLineBreaks(content: string): string {
        return toPhotoshopTextKey(content);
    }

    private toBounds(bounds: any): BoundsLike {
        return {
            left: Number(bounds.left) || 0,
            top: Number(bounds.top) || 0,
            right: Number(bounds.right) || 0,
            bottom: Number(bounds.bottom) || 0
        };
    }

    private cloneValue<T>(value: T): T {
        if (value === undefined || value === null) return value;
        return JSON.parse(JSON.stringify(value));
    }

    private getCurrentTextLayerDescriptor(descriptor: any | null): any | null {
        if (!descriptor || typeof descriptor !== 'object') return null;
        if (descriptor.textKey && typeof descriptor.textKey === 'object') {
            return descriptor.textKey;
        }
        return descriptor;
    }

    private remapRanges<T extends { from?: number; to?: number }>(
        ranges: T[] | undefined,
        sourceLength: number,
        targetLength: number
    ): T[] | undefined {
        if (!Array.isArray(ranges) || ranges.length === 0) return ranges;

        const safeSourceLength = Number.isFinite(sourceLength) && sourceLength > 0 ? sourceLength : targetLength;
        const useProportionalMapping = ranges.length > 1 && safeSourceLength > 0 && targetLength >= 0;

        const normalized = ranges
            .map(range => {
                const cloned = this.cloneValue(range);
                const originalFrom = Math.max(0, Math.min(Number(cloned.from) || 0, safeSourceLength));
                const originalTo = Math.max(originalFrom, Math.min(Number(cloned.to) || safeSourceLength, safeSourceLength));

                let from = originalFrom;
                let to = originalTo;

                if (useProportionalMapping) {
                    from = Math.floor((originalFrom / safeSourceLength) * targetLength);
                    to = Math.ceil((originalTo / safeSourceLength) * targetLength);
                }

                from = Math.max(0, Math.min(from, targetLength));
                to = Math.max(from, Math.min(to, targetLength));

                return {
                    ...cloned,
                    from,
                    to
                };
            })
            .filter(range => range.to >= range.from)
            .sort((a, b) => a.from - b.from || a.to - b.to);

        if (normalized.length === 0) return normalized;

        let cursor = 0;
        for (const range of normalized) {
            range.from = Math.max(cursor, Math.min(range.from, targetLength));
            range.to = Math.max(range.from, Math.min(range.to, targetLength));
            cursor = range.to;
        }

        normalized[0].from = 0;
        normalized[normalized.length - 1].to = targetLength;
        return normalized;
    }

    private getDescriptorContentLength(descriptor: any | null, fallbackContent = ''): number {
        const rawContent = typeof descriptor?.textKey === 'string'
            ? descriptor.textKey
            : fallbackContent;
        return this.normalizeContent(String(rawContent || '')).length;
    }

    private getParagraphSpans(content: string): Array<{ from: number; to: number }> {
        if (!content.length) {
            return [{ from: 0, to: 0 }];
        }

        const spans: Array<{ from: number; to: number }> = [];
        let cursor = 0;
        const lines = content.split('\n');

        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index];
            const hasTrailingBreak = index < lines.length - 1;
            const from = cursor;
            const to = cursor + line.length + (hasTrailingBreak ? 1 : 0);
            spans.push({ from, to });
            cursor = to;
        }

        if (spans.length === 0) {
            spans.push({ from: 0, to: content.length });
        }

        spans[0].from = 0;
        spans[spans.length - 1].to = content.length;
        return spans;
    }

    private normalizeParagraphRanges(
        ranges: Array<{ from?: number; to?: number; paragraphStyle?: any }> | undefined,
        targetContent: string
    ): Array<{ from: number; to: number; paragraphStyle?: any }> | undefined {
        if (!Array.isArray(ranges) || ranges.length === 0) return ranges as any;

        const styles = ranges.map(range => this.cloneValue(range?.paragraphStyle || {}));
        const spans = this.getParagraphSpans(targetContent);

        return spans.map((span, index) => ({
            _obj: 'paragraphStyleRange',
            from: span.from,
            to: span.to,
            paragraphStyle: styles[Math.min(index, styles.length - 1)] || {}
        }));
    }

    private styleSignature(style: any): string {
        return JSON.stringify(this.cloneValue(style || {}));
    }

    private normalizeTextStyleRanges(
        ranges: Array<{ from?: number; to?: number; textStyle?: any }> | undefined,
        sourceLength: number,
        targetLength: number
    ): Array<{ from: number; to: number; textStyle?: any; _obj?: string }> | undefined {
        if (!Array.isArray(ranges) || ranges.length === 0) return ranges as any;

        const signatures = new Set(ranges.map(range => this.styleSignature(range?.textStyle)));
        if (signatures.size <= 1) {
            return [{
                _obj: 'textStyleRange',
                from: 0,
                to: targetLength,
                textStyle: this.cloneValue(ranges[0]?.textStyle || {})
            }];
        }

        return this.remapRanges(ranges as any, sourceLength, targetLength) as any;
    }

    private async getTextLayerDescriptor(layerId: number): Promise<any | null> {
        const result = await safeBatchPlay([{
            _obj: 'get',
            _target: [{ _ref: 'layer', _id: layerId }],
            _options: { dialogOptions: 'dontDisplay' }
        }], { synchronousExecution: true }, '获取文本图层描述');

        if (!result.success || !Array.isArray(result.result) || !result.result[0]) {
            return null;
        }

        return result.result[0];
    }

    private async getFormattingBaseline(layerId: number, baselineContent: string): Promise<any | null> {
        const normalizedBaselineContent = this.normalizeContent(baselineContent);
        // 普通 Agent 改文案没有显式 baselineContent 时，必须以当前 live 样式为准。
        // 若复用历史缓存，之前的 setTextStyle 结果会被旧 descriptor 悄悄写回。
        if (!normalizedBaselineContent) {
            return await this.getTextLayerDescriptor(layerId);
        }

        const documentId = Number(app.activeDocument?.id);
        const cacheKey = `${Number.isFinite(documentId) ? documentId : 'unknown'}:${layerId}`;
        const cached = this.formattingBaselines.get(cacheKey);

        if (cached
            && cached.documentId === documentId
            && cached.baselineContent === normalizedBaselineContent) {
            return this.cloneValue(cached.descriptor);
        }

        const descriptor = await this.getTextLayerDescriptor(layerId);
        this.formattingBaselines.set(cacheKey, {
            documentId,
            baselineContent: normalizedBaselineContent,
            descriptor: this.cloneValue(descriptor)
        });
        return descriptor;
    }

    /**
     * 取本次写入的样式来源描述符（读操作，必须在 executeAsModal 之外调用）。
     *
     * 候选文案连续替换时必须锚定"第一次替换前"的 baseline descriptor，
     * 否则每次都拿写入后的 live 几何做基准，偏移会一次次累积。
     * live descriptor 只在没有 baseline 时才拉——此前无论如何都先拉一次再丢掉。
     */
    private async resolveSourceDescriptor(layerId: number, baselineContent: string): Promise<any | null> {
        const normalizedBaselineContent = this.normalizeContent(baselineContent);
        if (normalizedBaselineContent) {
            const baselineDescriptor = this.getCurrentTextLayerDescriptor(
                await this.getFormattingBaseline(layerId, normalizedBaselineContent)
            );
            if (baselineDescriptor) return baselineDescriptor;
        }
        return this.getCurrentTextLayerDescriptor(await this.getTextLayerDescriptor(layerId));
    }

    private async applyContentPreservingFormatting(
        layer: any,
        content: string,
        sourceDescriptor: any | null,
        baselineContent = ''
    ): Promise<void> {
        const normalizedContent = this.normalizeContent(content);

        const totalLength = normalizedContent.length;
        // baselineContent 只作为 descriptor 里没有可用 textKey 时的长度兜底，
        // 语义与重构前保持一致。
        const sourceLength = this.getDescriptorContentLength(sourceDescriptor, baselineContent);
        const textStyleRange = this.normalizeTextStyleRanges(this.cloneValue(sourceDescriptor?.textStyleRange), sourceLength, totalLength);
        const paragraphStyleRange = this.normalizeParagraphRanges(this.cloneValue(sourceDescriptor?.paragraphStyleRange), normalizedContent);
        const kerningRange = this.remapRanges(this.cloneValue(sourceDescriptor?.kerningRange), sourceLength, totalLength);

        const setDescriptor: any = {
            _obj: 'set',
            _target: [{ _ref: 'layer', _id: layer.id }],
            to: {
                _obj: 'textLayer',
                // Photoshop 的硬回车是 \r：写 \n 会把多行文案拼成一行（见 toPhotoshopLineBreaks）
                textKey: this.toPhotoshopLineBreaks(normalizedContent)
            },
            _options: { dialogOptions: 'dontDisplay' }
        };

        if (Array.isArray(textStyleRange) && textStyleRange.length > 0) {
            setDescriptor.to.textStyleRange = textStyleRange;
        }
        if (Array.isArray(paragraphStyleRange) && paragraphStyleRange.length > 0) {
            setDescriptor.to.paragraphStyleRange = paragraphStyleRange;
        }
        if (Array.isArray(kerningRange) && kerningRange.length > 0) {
            setDescriptor.to.kerningRange = kerningRange;
        }
        if (Array.isArray(sourceDescriptor?.textShape) && sourceDescriptor.textShape.length > 0) {
            // Paragraph text and transformed text layers depend on the original
            // text shape geometry. Preserve the baseline text shape, but avoid
            // replaying live bounds/boundingBox values that can compound drift.
            setDescriptor.to.textShape = this.cloneValue(sourceDescriptor.textShape);
        }
        if (sourceDescriptor?.orientation) {
            setDescriptor.to.orientation = this.cloneValue(sourceDescriptor.orientation);
        }
        if (sourceDescriptor?.warp) {
            setDescriptor.to.warp = this.cloneValue(sourceDescriptor.warp);
        }

        const batchResult = await safeBatchPlay(
            [setDescriptor],
            { synchronousExecution: true },
            '设置文本内容（保留当前文本层格式）'
        );

        if (batchResult.success) {
            return;
        }

        // DOM 兜底路径同样要用 \r，否则 batchPlay 失败后写进去的又是被拼成一行的文案
        layer.textItem.contents = this.toPhotoshopLineBreaks(normalizedContent);
    }

    private findLayerById(container: any, id: number): any {
        for (const layer of container.layers) {
            if (layer.id === id) {
                return layer;
            }
            if (layer.layers) {
                const found = this.findLayerById(layer, id);
                if (found) return found;
            }
        }
        return null;
    }
}
