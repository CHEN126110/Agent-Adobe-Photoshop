import { app, action, core, imaging } from 'photoshop';
import { Tool, ToolSchema } from '../types';
import { toNumber } from '../layout/layer-utils';

type Bounds = {
    left: number;
    top: number;
    right: number;
    bottom: number;
};

function normalizeBounds(bounds: Bounds) {
    return {
        left: toNumber(bounds.left),
        top: toNumber(bounds.top),
        right: toNumber(bounds.right),
        bottom: toNumber(bounds.bottom)
    };
}

function findLayerById(container: any, id: number): any {
    const numericId = typeof id === 'string' ? parseInt(id, 10) : id;
    for (const layer of container.layers || []) {
        if (layer.id === numericId) return layer;
        if (layer.layers) {
            const found = findLayerById(layer, numericId);
            if (found) return found;
        }
    }
    return null;
}

function boundsFromLayer(layer: any): Bounds {
    const source = layer.boundsNoEffects || layer.bounds;
    return normalizeBounds({
        left: source.left,
        top: source.top,
        right: source.right,
        bottom: source.bottom
    });
}

export class GetSubjectBoundsTool implements Tool {
    name = 'getSubjectBounds';
    description = '获取图层主体区域边界；可选 alpha 不透明区域或 Photoshop「选择主体」智能模式。';

    schema: ToolSchema = {
        name: 'getSubjectBounds',
        description: '读取指定图层的主体外接矩形。method=alpha 基于透明度；method=smart 使用 Photoshop 选择主体。',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: '图层 ID'
                },
                method: {
                    type: 'string',
                    enum: ['alpha', 'smart'],
                    description: '检测方式：alpha（不透明区域）或 smart（选择主体）'
                }
            },
            required: ['layerId']
        }
    };

    async execute(params: {
        layerId: number;
        method?: 'alpha' | 'smart';
    }): Promise<{
        success: boolean;
        data?: {
            bounds: {
                left: number;
                top: number;
                right: number;
                bottom: number;
                width: number;
                height: number;
                centerX: number;
                centerY: number;
            };
            method: string;
        };
        error?: string;
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '请先打开 Photoshop 文档' };
            }

            const layerId = typeof params.layerId === 'string'
                ? parseInt(params.layerId, 10)
                : params.layerId;

            const layer = findLayerById(doc, layerId);
            if (!layer) {
                return { success: false, error: `未找到图层，ID: ${layerId}` };
            }

            const method = params.method || 'smart';
            const bounds = method === 'smart'
                ? await this.getSmartSubjectBounds(layer)
                : await this.getAlphaBounds(doc, layer);

            if (!bounds) {
                return { success: false, error: `无法使用「${method}」方式获取主体区域` };
            }

            const normalized = normalizeBounds(bounds);
            return {
                success: true,
                data: {
                    bounds: {
                        left: normalized.left,
                        top: normalized.top,
                        right: normalized.right,
                        bottom: normalized.bottom,
                        width: normalized.right - normalized.left,
                        height: normalized.bottom - normalized.top,
                        centerX: (normalized.left + normalized.right) / 2,
                        centerY: (normalized.top + normalized.bottom) / 2
                    },
                    method
                }
            };
        } catch (error: any) {
            console.error('[GetSubjectBounds] Error:', error);
            return {
                success: false,
                error: error.message || '获取主体区域失败'
            };
        }
    }

    private async getSmartSubjectBounds(layer: any): Promise<Bounds | null> {
        let resolved: Bounds | null = null;
        await core.executeAsModal(async () => {
            await action.batchPlay([
                {
                    _obj: 'select',
                    _target: [{ _ref: 'layer', _id: layer.id }],
                    makeVisible: false,
                    _options: { dialogOptions: 'dontDisplay' }
                }
            ], { synchronousExecution: true });

            await this.clearSelectionSilently();

            try {
                await action.batchPlay([
                    {
                        _obj: 'selectSubject',
                        sampleAllLayers: false,
                        _isCommand: false,
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], {
                    synchronousExecution: true
                });
            } catch (error: any) {
                throw new Error(`选择主体失败: ${error.message || error}`);
            }

            try {
                const selectionInfo = await action.batchPlay([
                    {
                        _obj: 'get',
                        _target: [
                            { _property: 'selection' },
                            { _ref: 'document', _enum: 'ordinal', _value: 'targetEnum' }
                        ],
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], { synchronousExecution: true });

                const selection = selectionInfo?.[0]?.selection;
                if (!selection) {
                    throw new Error('Photoshop 未返回有效选区');
                }

                resolved = normalizeBounds({
                    left: selection.left?._value ?? selection.left,
                    top: selection.top?._value ?? selection.top,
                    right: selection.right?._value ?? selection.right,
                    bottom: selection.bottom?._value ?? selection.bottom
                });
            } finally {
                await this.clearSelectionSilently();
            }
        }, { commandName: 'Get Subject Bounds (smart)' });
        return resolved;
    }

    private async getAlphaBounds(doc: any, layer: any): Promise<Bounds | null> {
        let resolved: Bounds | null = null;
        await core.executeAsModal(async () => {
            const requestedBounds = boundsFromLayer(layer);
            const pixelResult = await imaging.getPixels({
                documentID: doc.id,
                layerID: layer.id,
                sourceBounds: requestedBounds
            });

            if (!pixelResult?.imageData) {
                throw new Error('无法读取图层像素数据');
            }

            const actualBounds = normalizeBounds(pixelResult.sourceBounds || requestedBounds);
            const imageData = pixelResult.imageData;
            const width = imageData.width;
            const height = imageData.height;
            const components = imageData.components;
            const rawData = await imageData.getData();

            try {
                if (components < 4) {
                    resolved = actualBounds;
                    return;
                }

                let minX = width;
                let minY = height;
                let maxX = -1;
                let maxY = -1;

                for (let y = 0; y < height; y++) {
                    for (let x = 0; x < width; x++) {
                        const alpha = rawData[(y * width + x) * components + 3];
                        if (alpha > 0) {
                            if (x < minX) minX = x;
                            if (y < minY) minY = y;
                            if (x > maxX) maxX = x;
                            if (y > maxY) maxY = y;
                        }
                    }
                }

                if (maxX < minX || maxY < minY) {
                    resolved = null;
                    return;
                }

                resolved = {
                    left: actualBounds.left + minX,
                    top: actualBounds.top + minY,
                    right: actualBounds.left + maxX + 1,
                    bottom: actualBounds.top + maxY + 1
                };
            } finally {
                imageData.dispose();
            }
        }, { commandName: 'Get Subject Bounds (alpha)' });
        return resolved;
    }

    private async clearSelectionSilently(): Promise<void> {
        try {
            await action.batchPlay([
                {
                    _obj: 'set',
                    _target: [{ _ref: 'channel', _property: 'selection' }],
                    to: { _enum: 'ordinal', _value: 'none' },
                    _options: { dialogOptions: 'dontDisplay' }
                }
            ], { synchronousExecution: true });
        } catch {
            // ignore if there is no active selection
        }
    }
}
