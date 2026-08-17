/**
 * 重命名图层工具
 * 
 * 修改图层名称
 */

import {
    photoshopTransactionRunner,
    type PhotoshopTransactionPreparation
} from '../../core/photoshop-transaction-runner';
import { Tool, ToolExecutionContext, ToolSchema } from '../types';

const app = require('photoshop').app;
const { core, action } = require('photoshop');

function findLayerById(container: any, id: number): any {
    for (const layer of container.layers || []) {
        if (layer.id === id) return layer;
        if (layer.layers) {
            const found = findLayerById(layer, id);
            if (found) return found;
        }
    }
    return null;
}

interface RenameLayerState {
    documentId: number;
    layerId: number;
    parentId: number | null;
    name: string;
}

// type 而非 interface：需要隐式索引签名以满足 TransactionRunner 的 Record<string, unknown> 约束
type RenameLayerResult = {
    success: boolean;
    layer?: {
        id: number;
        oldName: string;
        newName: string;
    };
    code?: string;
    error?: string;
}

function findLayerState(
    document: any,
    layerId: number,
    container: any = document,
    parentId: number | null = null
): RenameLayerState | undefined {
    for (const layer of container.layers || []) {
        if (Number(layer.id) === layerId) {
            return {
                documentId: Number(document.id),
                layerId,
                parentId,
                name: String(layer.name || '')
            };
        }
        if (layer.layers) {
            const found = findLayerState(document, layerId, layer, Number(layer.id));
            if (found) return found;
        }
    }
    return undefined;
}

function sameRenameTarget(left: RenameLayerState, right: RenameLayerState): boolean {
    return left.documentId === right.documentId
        && left.layerId === right.layerId
        && left.parentId === right.parentId;
}

function assertBatchPlaySucceeded(descriptors: unknown): void {
    if (!Array.isArray(descriptors)) return;
    const failure = descriptors.find((descriptor) => (
        descriptor
        && typeof descriptor === 'object'
        && String((descriptor as Record<string, unknown>)._obj || '').toLowerCase() === 'error'
    )) as Record<string, unknown> | undefined;
    if (!failure) return;
    throw new Error(String(failure.message || failure.error || 'Photoshop 拒绝了图层重命名。'));
}

export class RenameLayerTool implements Tool {
    name = 'renameLayer';

    schema: ToolSchema = {
        name: 'renameLayer',
        description: '重命名指定的图层。可以通过图层 ID 或当前选中的图层来指定目标。',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: '要重命名的图层 ID（可选，默认使用当前选中的图层）'
                },
                newName: {
                    type: 'string',
                    description: '新的图层名称'
                }
            },
            required: ['newName']
        }
    };

    async execute(
        params: {
            layerId?: number;
            newName: string;
        },
        context?: ToolExecutionContext
    ): Promise<RenameLayerResult> {
        const newName = String(params?.newName || '').trim();
        const operationId = `renameLayer:${String(
            context?.requestId
            || `${Number(params?.layerId) || 'active'}:${Date.now()}`
        )}`;

        return await photoshopTransactionRunner.run<
            RenameLayerState,
            RenameLayerState,
            RenameLayerResult
        >({
            operationId,
            toolName: this.name,
            commandName: 'DesignEcho: 重命名图层',
            params,
            context,
            historyMode: 'suspend',
            expectedEffect: 'mutation_required',
            prepare(scope): PhotoshopTransactionPreparation<RenameLayerState, RenameLayerResult> {
                if (!newName) {
                    return {
                        kind: 'complete',
                        effect: 'none',
                        result: {
                            success: false,
                            code: 'rename_layer_name_required',
                            error: '图层名称不能为空'
                        }
                    };
                }

                const hasExplicitLayerId = Object.prototype.hasOwnProperty.call(
                    params || {},
                    'layerId'
                );
                const requestedLayerId = params?.layerId;
                if (hasExplicitLayerId
                    && (!Number.isSafeInteger(requestedLayerId) || Number(requestedLayerId) <= 0)) {
                    return {
                        kind: 'complete',
                        effect: 'none',
                        result: {
                            success: false,
                            code: 'rename_layer_target_invalid',
                            error: '显式 layerId 必须是正安全整数'
                        }
                    };
                }
                const activeLayerId = Number(scope.document.activeLayers?.[0]?.id);
                const layerId = hasExplicitLayerId
                    ? Number(requestedLayerId)
                    : activeLayerId;
                if (!Number.isSafeInteger(layerId) || layerId <= 0) {
                    return {
                        kind: 'complete',
                        effect: 'none',
                        result: {
                            success: false,
                            code: 'rename_layer_target_required',
                            error: '没有选中的图层'
                        }
                    };
                }

                const before = findLayerState(scope.document, layerId);
                if (!before) {
                    return {
                        kind: 'complete',
                        effect: 'none',
                        result: {
                            success: false,
                            code: 'rename_layer_target_not_found',
                            error: `未找到 ID 为 ${layerId} 的图层`
                        }
                    };
                }
                if (before.name === newName) {
                    return {
                        kind: 'complete',
                        effect: 'already_satisfied',
                        result: {
                            success: true,
                            layer: {
                                id: before.layerId,
                                oldName: before.name,
                                newName
                            }
                        }
                    };
                }
                return {
                    kind: 'ready',
                    before
                };
            },
            async mutate(_scope, before): Promise<RenameLayerResult> {
                const descriptors = await action.batchPlay([
                    {
                        _obj: 'set',
                        _target: [{ _ref: 'layer', _id: before.layerId }],
                        to: {
                            _obj: 'layer',
                            name: newName
                        },
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], {});
                assertBatchPlaySucceeded(descriptors);
                return {
                    success: true,
                    layer: {
                        id: before.layerId,
                        oldName: before.name,
                        newName
                    }
                };
            },
            readState({ scope, before }): RenameLayerState {
                const after = findLayerState(scope.document, before.layerId);
                if (!after) {
                    throw new Error(`写后读回未找到图层 ID ${before.layerId}。`);
                }
                return after;
            },
            verifyApplied({ before, after }) {
                return {
                    verified: sameRenameTarget(before, after) && after.name === newName,
                    message: sameRenameTarget(before, after)
                        ? `写后读回名称为「${after.name}」，目标名称为「${newName}」。`
                        : '写后读回的文档、图层或父级与事务目标不一致。'
                };
            },
            verifyRolledBack({ before, after }) {
                return {
                    verified: sameRenameTarget(before, after) && after.name === before.name,
                    message: sameRenameTarget(before, after)
                        ? `回滚后名称为「${after.name}」，原名称为「${before.name}」。`
                        : '回滚读回的文档、图层或父级与事务开始时不一致。'
                };
            }
        });
    }

}

/**
 * 批量重命名图层工具
 */
export class BatchRenameLayersTool implements Tool {
    name = 'batchRenameLayers';

    schema: ToolSchema = {
        name: 'batchRenameLayers',
        description: '批量重命名多个图层。可以使用模式替换或序号命名。',
        parameters: {
            type: 'object',
            properties: {
                layerIds: {
                    type: 'array',
                    description: '要重命名的图层 ID 列表（可选，默认使用当前选中的所有图层）',
                    items: { type: 'number' }
                },
                pattern: {
                    type: 'string',
                    description: '命名模式，使用 {n} 表示序号（从1开始），{name} 表示原名称。例如: "图层_{n}" 或 "{name}_副本"'
                },
                startNumber: {
                    type: 'number',
                    description: '起始序号，默认 1'
                },
                findReplace: {
                    type: 'object',
                    description: '查找替换模式',
                    properties: {
                        find: { type: 'string', description: '要查找的文本' },
                        replace: { type: 'string', description: '替换为的文本' }
                    }
                }
            }
        }
    };

    async execute(params: {
        layerIds?: number[];
        pattern?: string;
        startNumber?: number;
        findReplace?: { find: string; replace: string };
    }): Promise<{
        success: boolean;
        renamedLayers?: Array<{
            id: number;
            oldName: string;
            newName: string;
        }>;
        error?: string;
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            let targetLayers: any[] = [];

            if (params.layerIds && params.layerIds.length > 0) {
                for (const id of params.layerIds) {
                    const layer = findLayerById(doc, id);
                    if (layer) {
                        targetLayers.push(layer);
                    }
                }
            } else {
                targetLayers = [...doc.activeLayers];
            }

            if (targetLayers.length === 0) {
                return { success: false, error: '没有要重命名的图层' };
            }

            const results: Array<{ id: number; oldName: string; newName: string }> = [];
            const startNumber = params.startNumber || 1;

            await core.executeAsModal(async () => {
                for (let i = 0; i < targetLayers.length; i++) {
                    const layer = targetLayers[i];
                    const oldName = layer.name;
                    let newName = oldName;

                    // 使用模式命名
                    if (params.pattern) {
                        newName = params.pattern
                            .replace(/\{n\}/g, String(startNumber + i))
                            .replace(/\{name\}/g, oldName);
                    }
                    // 使用查找替换
                    else if (params.findReplace && params.findReplace.find) {
                        newName = oldName.replace(
                            new RegExp(this.escapeRegExp(params.findReplace.find), 'g'),
                            params.findReplace.replace || ''
                        );
                    }

                    if (newName !== oldName) {
                        await action.batchPlay([
                            {
                                _obj: 'set',
                                _target: [{ _ref: 'layer', _id: layer.id }],
                                to: {
                                    _obj: 'layer',
                                    name: newName
                                },
                                _options: { dialogOptions: 'dontDisplay' }
                            }
                        ], {});

                        results.push({
                            id: layer.id,
                            oldName,
                            newName
                        });
                    }
                }
            }, { commandName: 'DesignEcho: 批量重命名图层' });

            console.log(`[BatchRenameLayers] 已重命名 ${results.length} 个图层`);

            return {
                success: true,
                renamedLayers: results
            };

        } catch (error) {
            console.error('[BatchRenameLayers] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '批量重命名失败'
            };
        }
    }

    private escapeRegExp(string: string): string {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}
