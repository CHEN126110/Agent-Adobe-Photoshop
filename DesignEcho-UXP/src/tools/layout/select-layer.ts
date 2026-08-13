/**
 * 图层选择工具
 * 
 * 让 AI 能够选中指定的图层
 * 支持错别字容错匹配
 */

import { Tool, ToolSchema } from '../types';
import { createToolFailureResult } from '../../core/tool-error-normalizer';

const app = require('photoshop').app;
const { core, action } = require('photoshop');

/**
 * 计算两个字符串的编辑距离（Levenshtein Distance）
 */
function levenshteinDistance(str1: string, str2: string): number {
    const m = str1.length;
    const n = str2.length;
    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
    
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (str1[i - 1] === str2[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1];
            } else {
                dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + 1);
            }
        }
    }
    return dp[m][n];
}

/**
 * 计算相似度分数 (0-1)
 */
function similarityScore(str1: string, str2: string): number {
    const s1 = str1.toLowerCase();
    const s2 = str2.toLowerCase();
    if (s1 === s2) return 1;
    if (s2.includes(s1) || s1.includes(s2)) return 0.9;
    const distance = levenshteinDistance(s1, s2);
    return 1 - (distance / Math.max(s1.length, s2.length));
}

function readSafeLayerId(value: unknown): number | undefined {
    const numeric = Number(value);
    if (!Number.isSafeInteger(numeric) || numeric <= 0) return undefined;
    return numeric;
}

function uniqueLayerIds(values: readonly number[]): number[] {
    return Array.from(new Set(values));
}

function sameLayerIdSet(left: readonly number[], right: readonly number[]): boolean {
    if (left.length !== right.length) return false;
    const rightSet = new Set(right);
    return left.every(layerId => rightSet.has(layerId));
}

function readActiveLayerIds(document: any): number[] {
    return (Array.from(document?.activeLayers || []) as any[])
        .map(layer => readSafeLayerId(layer?.id))
        .filter((layerId): layerId is number => layerId !== undefined);
}

function buildSelectLayerFailure(
    params: unknown,
    code: string,
    error: string,
    extra?: Record<string, unknown>
): Record<string, unknown> & { success: false; error: string } {
    const failure = createToolFailureResult({ toolName: 'selectLayer', error, params });
    return {
        ...failure,
        ...extra,
        success: false,
        code,
        error
    };
}

export class SelectLayerTool implements Tool {
    name = 'selectLayer';

    schema: ToolSchema = {
        name: 'selectLayer',
        description: '选中指定的图层。可以通过图层 ID、图层名称或图层索引选择。支持多选。',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: '要选中的图层 ID'
                },
                layerName: {
                    type: 'string',
                    description: '要选中的图层名称（支持模糊匹配）'
                },
                layerIds: {
                    type: 'array',
                    description: '要选中的多个图层 ID（多选）',
                    items: { type: 'number' }
                },
                addToSelection: {
                    type: 'boolean',
                    description: '是否添加到当前选择（而非替换），默认 false'
                }
            }
        }
    };

    async execute(params: {
        layerId?: number;
        layerName?: string;
        layerIds?: number[];
        addToSelection?: boolean;
    }): Promise<{
        success: boolean;
        selectedLayers?: {
            id: number;
            name: string;
            kind: string;
        }[];
        allLayers?: { id: number; name: string; kind: string }[];
        matchInfo?: string;
        error?: string;
        code?: string;
        errorDetails?: unknown;
        data?: null;
    }> {
        try {
            console.log('[SelectLayer] 执行选择, 参数:', JSON.stringify(params));

            const doc = app.activeDocument;
            if (!doc) {
                return buildSelectLayerFailure(
                    params,
                    'select_layer_document_required',
                    '选择图层失败：Photoshop 当前没有打开的文档。请先打开目标文档后重试。'
                );
            }

            // 收集所有图层信息（用于名称匹配和错误提示）
            const allLayers = this.getAllLayers(doc);

            let targetLayerIds: number[] = [];
            let matchInfo: string | undefined;
            const hasExplicitLayerId = Object.prototype.hasOwnProperty.call(params || {}, 'layerId');
            const hasExplicitLayerIds = Object.prototype.hasOwnProperty.call(params || {}, 'layerIds');

            // 通过 ID 查找
            if (hasExplicitLayerId) {
                const layerId = readSafeLayerId(params.layerId);
                if (layerId === undefined) {
                    return buildSelectLayerFailure(
                        params,
                        'select_layer_target_invalid',
                        '选择图层失败：layerId 必须是正安全整数。请重新读取图层 ID 后重试。',
                        { allLayers }
                    );
                }
                const layer = this.findLayerById(doc, layerId);
                if (!layer) {
                    return buildSelectLayerFailure(
                        params,
                        'select_layer_target_not_found',
                        `选择图层失败：未找到 ID 为 ${layerId} 的图层。请重新读取图层结构后重试。`,
                        { allLayers }
                    );
                }
                targetLayerIds.push(layerId);
            }
            // 通过多个 ID 查找
            else if (hasExplicitLayerIds) {
                if (!Array.isArray(params.layerIds) || params.layerIds.length === 0) {
                    return buildSelectLayerFailure(
                        params,
                        'select_layer_targets_required',
                        '选择图层失败：layerIds 必须至少包含一个图层 ID。请重新读取图层结构后重试。',
                        { allLayers }
                    );
                }
                const normalizedIds = params.layerIds.map(readSafeLayerId);
                if (normalizedIds.some(layerId => layerId === undefined)) {
                    return buildSelectLayerFailure(
                        params,
                        'select_layer_targets_invalid',
                        '选择图层失败：layerIds 必须只包含正安全整数。请重新读取图层 ID 后重试。',
                        { allLayers }
                    );
                }
                targetLayerIds = uniqueLayerIds(normalizedIds as number[]);
                const missingIds = targetLayerIds.filter(id => !this.findLayerById(doc, id));
                if (missingIds.length > 0) {
                    return buildSelectLayerFailure(
                        params,
                        'select_layer_targets_not_found',
                        `选择图层失败：未找到图层 ID ${missingIds.join(', ')}。没有执行部分选择；请重新读取图层结构后重试。`,
                        { allLayers }
                    );
                }
            }
            // 通过名称查找（支持错别字容错）
            else if (typeof params.layerName === 'string' && params.layerName.trim()) {
                const searchName = params.layerName.trim();
                
                // 计算所有图层的相似度
                const matches = allLayers.map(l => ({
                    ...l,
                    score: similarityScore(searchName, l.name)
                })).sort((a, b) => b.score - a.score);
                
                const bestMatch = matches[0];
                
                // 相似度阈值：0.5 以上认为是有效匹配
                if (bestMatch && bestMatch.score >= 0.5) {
                    targetLayerIds.push(bestMatch.id);
                    
                    if (bestMatch.score < 1) {
                        matchInfo = `智能匹配："${searchName}" → "${bestMatch.name}" (${Math.round(bestMatch.score * 100)}%)`;
                        console.log(`[SelectLayer] ${matchInfo}`);
                    }
                } else {
                    // 给出建议
                    const suggestions = matches.slice(0, 5).map(m => 
                        `"${m.name}" (${Math.round(m.score * 100)}%)`
                    );
                    
                    return buildSelectLayerFailure(
                        params,
                        'select_layer_name_not_found',
                        `选择图层失败：未找到足够相似的图层。可重新确认名称；候选为：\n${suggestions.join('\n')}`,
                        { allLayers }
                    );
                }
            } else {
                return buildSelectLayerFailure(
                    params,
                    'select_layer_target_required',
                    '选择图层失败：请提供 layerId、layerIds 或 layerName。可先读取图层结构确认目标。',
                    { allLayers }
                );
            }

            targetLayerIds = uniqueLayerIds(targetLayerIds);
            const selectedBefore = readActiveLayerIds(doc);
            const expectedSelectedIds = params.addToSelection
                ? uniqueLayerIds([...selectedBefore, ...targetLayerIds])
                : targetLayerIds;

            // 使用 batchPlay 选中图层
            await core.executeAsModal(async () => {
                const selectDescriptor: any = {
                    _obj: 'select',
                    _target: targetLayerIds.map(id => ({
                        _ref: 'layer',
                        _id: id
                    })),
                    makeVisible: false,
                    _options: { dialogOptions: 'dontDisplay' }
                };

                // 如果是添加到选择
                if (params.addToSelection) {
                    selectDescriptor.selectionModifier = {
                        _enum: 'selectionModifierType',
                        _value: 'addToSelection'
                    };
                }

                await action.batchPlay([selectDescriptor], { synchronousExecution: true });
            }, { commandName: 'DesignEcho: 选择图层' });

            // 获取选中结果
            const selectedLayers = (Array.from(doc.activeLayers || []) as any[]).map((layer: any) => ({
                id: layer.id,
                name: layer.name,
                kind: layer.kind?.toString() || 'unknown'
            }));
            const actualSelectedIds = selectedLayers
                .map(layer => readSafeLayerId(layer.id))
                .filter((layerId): layerId is number => layerId !== undefined);
            if (!sameLayerIdSet(expectedSelectedIds, actualSelectedIds)) {
                return buildSelectLayerFailure(
                    params,
                    'select_layer_verification_failed',
                    `选择图层写后读回不一致：请求选中 [${expectedSelectedIds.join(', ')}]，实际选中 [${actualSelectedIds.join(', ') || '无'}]。请重新读取图层结构后重试。`,
                    {
                        selectedLayers,
                        allLayers,
                        expectedSelectedLayerIds: expectedSelectedIds,
                        actualSelectedLayerIds: actualSelectedIds
                    }
                );
            }

            console.log('[SelectLayer] 已选中:', selectedLayers.length, '个图层');

            return {
                success: true,
                selectedLayers,
                matchInfo
            };

        } catch (error) {
            console.error('[SelectLayer] Error:', error);
            return createToolFailureResult({ toolName: this.name, error, params });
        }
    }

    /**
     * 递归查找图层
     */
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

    /**
     * 获取所有图层信息
     */
    private getAllLayers(container: any): { id: number; name: string; kind: string }[] {
        const layers: { id: number; name: string; kind: string }[] = [];
        
        for (const layer of container.layers) {
            layers.push({
                id: layer.id,
                name: layer.name,
                kind: layer.kind?.toString() || 'unknown'
            });
            
            if (layer.layers) {
                layers.push(...this.getAllLayers(layer));
            }
        }
        
        return layers;
    }
}
