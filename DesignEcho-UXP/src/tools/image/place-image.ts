/**
 * 置入图片工具
 * 
 * 将外部图片置入到当前 Photoshop 文档中
 * 支持从 Base64 数据或文件路径置入
 */

import { Tool, ToolResult, ToolSchema } from '../types';
import { getEntryFromPath } from '../../core/file-url';
import { createToolFailureResult } from '../../core/tool-error-normalizer';
import {
    arrayBufferFromBytes,
    assertImageBytesSafeForPhotoshop,
    bytesFromBase64ImagePayload,
    readFileEntryBytes
} from '../../core/image-safety';

const { app, core, action } = require('photoshop');
const uxp = require('uxp');
const fs = uxp.storage.localFileSystem;

export interface PlaceImageParams {
    /** 图片 Base64 数据 */
    imageData?: string;
    /** imageData 时的格式：png|jpeg|gif（默认 png） */
    imageFormat?: string;
    /** 图片文件路径（本地路径） */
    filePath?: string;
    /** UXP 会话文件 token（优先于 filePath） */
    fileToken?: string;
    /** 图片名称（用于图层命名） */
    name?: string;
    /** 置入位置 X */
    x?: number;
    /** 置入位置 Y */
    y?: number;
    /** 缩放比例 (0-100)，默认100 */
    scale?: number;
    /** 是否居中置入 */
    center?: boolean;
    /** 是否自动调整大小以适应画布 */
    fitToCanvas?: boolean;
    /** 来源资产ID（Agent 侧传入，用于追踪） */
    sourceAssetId?: string;
    /** 来源校验和（Agent 侧传入，用于一致性校验） */
    sourceChecksum?: string;
    /** 来源字节长度（Agent 侧传入，用于一致性校验） */
    sourceByteLength?: number;
    /** 来源路径（仅日志） */
    sourcePath?: string;
}

function getLayerBoundsNoEffects(layer: any): any {
    return layer?.boundsNoEffects || layer?.bounds;
}

async function translateLayerWithoutNativeMove(layer: any, offsetX: number, offsetY: number): Promise<void> {
    if (offsetX === 0 && offsetY === 0) {
        return;
    }
    if (typeof layer?.translate !== 'function') {
        throw new Error('置入图片定位失败：图层对象不支持 translate，已拒绝调用 Photoshop 原生 move 命令以避免弹窗。');
    }
    await Promise.resolve(layer.translate(offsetX, offsetY));
}

function calcChecksum(bytes: Uint8Array): string {
    // FNV-1a 32-bit, same as Agent side.
    let hash = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) {
        hash ^= bytes[i];
        hash = Math.imul(hash, 0x01000193);
    }
    const hex = (hash >>> 0).toString(16).padStart(8, '0');
    return `fnv1a32:${hex}`;
}

function extensionFromPath(filePath: string): string {
    const match = String(filePath || '').match(/\.([a-z0-9]+)$/i);
    return match ? match[1].toLowerCase() : '';
}

export class PlaceImageTool implements Tool {
    name = 'placeImage';
    
    get schema(): ToolSchema {
        return {
            name: this.name,
            description: '将图片置入到当前文档中，支持从项目目录选择图片置入',
            parameters: {
                type: 'object',
                properties: {
                    imageData: {
                        type: 'string',
                        description: '图片的 Base64 数据（与 filePath 二选一，用于从素材库置入时绕过 UXP 路径限制）'
                    },
                    imageFormat: {
                        type: 'string',
                        description: 'imageData 时的格式：png|jpeg|gif（默认 png）'
                    },
                    filePath: {
                        type: 'string',
                        description: '图片文件的本地路径（与 imageData 二选一）'
                    },
                    fileToken: {
                        type: 'string',
                        description: 'UXP 会话文件 token（优先于 filePath）'
                    },
                    name: {
                        type: 'string',
                        description: '置入后的图层名称'
                    },
                    x: {
                        type: 'number',
                        description: '置入位置 X 坐标（像素）'
                    },
                    y: {
                        type: 'number',
                        description: '置入位置 Y 坐标（像素）'
                    },
                    scale: {
                        type: 'number',
                        description: '缩放比例 (1-100)，默认 100'
                    },
                    center: {
                        type: 'boolean',
                        description: '是否居中置入，默认 true'
                    },
                    fitToCanvas: {
                        type: 'boolean',
                        description: '是否自动缩放以适应画布'
                    }
                }
            }
        };
    }

    async execute(params: PlaceImageParams): Promise<ToolResult> {
        const doc = app.activeDocument;
        if (!doc) {
            return createToolFailureResult({ toolName: this.name, error: '没有打开的文档', params });
        }

        const { 
            imageData: rawImageData, 
            filePath, 
            name = '置入的图片',
            x,
            y,
            scale = 100,
            center = true,
            fitToCanvas = false,
            sourceAssetId,
            sourceChecksum,
            sourceByteLength,
            sourcePath
        } = params;
        const imageData = rawImageData || (params as any).base64;

        if (!imageData && !filePath && !params.fileToken) {
            return createToolFailureResult({ toolName: this.name, error: '必须提供 imageData 或 filePath 或 fileToken', params });
        }

        try {
            let placedLayerId: number | null = null;
            let tokenPath: string | undefined;

            await core.executeAsModal(async () => {
                // 使用 batchPlay 置入图片
                if (params.fileToken || filePath) {
                    tokenPath = params.fileToken;
                    if (!tokenPath && filePath) {
                        const fileEntry = await getEntryFromPath(fs, filePath);
                        if (!fileEntry) {
                            throw new Error(`无法访问文件: ${filePath}`);
                        }
                        const bytes = await readFileEntryBytes(fileEntry, uxp.storage);
                        assertImageBytesSafeForPhotoshop(bytes, {
                            formatHint: extensionFromPath(filePath),
                            sourceLabel: `图片文件「${filePath.split(/[\\/]/).pop() || filePath}」`
                        });
                        tokenPath = await fs.createSessionToken(fileEntry);
                    }

                    // 从文件路径置入
                    const result = await action.batchPlay([
                        {
                            _obj: 'placeEvent',
                            null: {
                                _kind: 'local',
                                _path: tokenPath
                            },
                            freeTransformCenterState: {
                                _enum: 'quadCenterState',
                                _value: 'QCSAverage'
                            },
                            offset: {
                                _obj: 'offset',
                                horizontal: {
                                    _unit: 'pixelsUnit',
                                    _value: 0
                                },
                                vertical: {
                                    _unit: 'pixelsUnit',
                                    _value: 0
                                }
                            },
                            _options: {
                                dialogOptions: 'dontDisplay'
                            }
                        }
                    ], { synchronousExecution: true });

                    if (result && result[0]) {
                        placedLayerId = doc.activeLayers[0]?.id;
                    }
                } else if (imageData) {
                    // 从 Base64 数据置入：写入 UXP 可访问的临时文件 → placeEvent
                    const storage = uxp.storage;
                    const tempFolder = await fs.getTemporaryFolder();
                    const ext = (params.imageFormat || 'png').replace(/^\./, '') || 'png';
                    const tempFileName = `place_${Date.now()}.${ext}`;
                    const tempFile = await tempFolder.createFile(tempFileName, { overwrite: true });
                    const decoded = bytesFromBase64ImagePayload(imageData);
                    const bytes = decoded.bytes;
                    assertImageBytesSafeForPhotoshop(bytes, {
                        formatHint: ext || decoded.mimeType,
                        sourceLabel: name ? `图片「${name}」` : 'Base64 图片'
                    });
                    if (typeof sourceByteLength === 'number' && sourceByteLength > 0 && sourceByteLength !== bytes.length) {
                        throw new Error(`源图字节长度不一致: expected=${sourceByteLength}, actual=${bytes.length}`);
                    }
                    if (sourceChecksum) {
                        const actualChecksum = calcChecksum(bytes);
                        if (actualChecksum !== sourceChecksum) {
                            throw new Error(`源图校验失败: expected=${sourceChecksum}, actual=${actualChecksum}`);
                        }
                    }
                    if (sourceAssetId) {
                        console.log(`[placeImage] 置入来源 assetId=${sourceAssetId}, sourcePath=${sourcePath || filePath || 'n/a'}`);
                    }
                    await tempFile.write(arrayBufferFromBytes(bytes), { format: storage.formats.binary });
                    const sessionToken = await fs.createSessionToken(tempFile);
                    const placeResult = await action.batchPlay([
                        {
                            _obj: 'placeEvent',
                            null: { _path: sessionToken, _kind: 'local' },
                            freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' },
                            offset: { _obj: 'offset', horizontal: { _unit: 'pixelsUnit', _value: 0 }, vertical: { _unit: 'pixelsUnit', _value: 0 } },
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], { synchronousExecution: true });
                    if (placeResult?.[0]) placedLayerId = doc.activeLayers[0]?.id;
                    try { await tempFile.delete(); } catch { /* ignore */ }
                }

                // 获取置入后的图层
                const newLayer = doc.activeLayers[0];
                if (!newLayer) {
                    throw new Error('置入失败，未找到新图层');
                }

                placedLayerId = newLayer.id;

                // 重命名图层
                if (name) {
                    newLayer.name = name;
                }

                // 处理缩放
                if (fitToCanvas || scale !== 100) {
                    const layerBounds = getLayerBoundsNoEffects(newLayer);
                    const layerWidth = layerBounds.right - layerBounds.left;
                    const layerHeight = layerBounds.bottom - layerBounds.top;
                    
                    let targetScale = scale;
                    
                    if (fitToCanvas) {
                        // 计算适应画布的缩放比例
                        const docWidth = doc.width;
                        const docHeight = doc.height;
                        const scaleX = (docWidth / layerWidth) * 100;
                        const scaleY = (docHeight / layerHeight) * 100;
                        targetScale = Math.min(scaleX, scaleY, 100); // 不超过 100%
                    }

                    if (targetScale !== 100) {
                        await action.batchPlay([
                            {
                                _obj: 'transform',
                                freeTransformCenterState: {
                                    _enum: 'quadCenterState',
                                    _value: 'QCSAverage'
                                },
                                width: {
                                    _unit: 'percentUnit',
                                    _value: targetScale
                                },
                                height: {
                                    _unit: 'percentUnit',
                                    _value: targetScale
                                },
                                _options: {
                                    dialogOptions: 'dontDisplay'
                                }
                            }
                        ], { synchronousExecution: true });
                    }
                }

                // 处理位置
                if (x !== undefined || y !== undefined) {
                    // 移动到指定位置
                    const layerBounds = getLayerBoundsNoEffects(newLayer);
                    const currentX = layerBounds.left;
                    const currentY = layerBounds.top;

                    const moveX = (x ?? currentX) - currentX;
                    const moveY = (y ?? currentY) - currentY;

                    await translateLayerWithoutNativeMove(newLayer, moveX, moveY);
                } else if (center) {
                    // 居中置入
                    const layerBounds = getLayerBoundsNoEffects(newLayer);
                    const layerWidth = layerBounds.right - layerBounds.left;
                    const layerHeight = layerBounds.bottom - layerBounds.top;
                    const docWidth = doc.width;
                    const docHeight = doc.height;

                    const targetX = (docWidth - layerWidth) / 2;
                    const targetY = (docHeight - layerHeight) / 2;
                    const currentX = layerBounds.left;
                    const currentY = layerBounds.top;

                    const moveX = targetX - currentX;
                    const moveY = targetY - currentY;

                    await translateLayerWithoutNativeMove(newLayer, moveX, moveY);
                }
            }, { commandName: 'DesignEcho: 置入图片' });

            // 获取最终图层信息
            const finalLayer = doc.layers.find((l: any) => l.id === placedLayerId);
            const finalBounds = finalLayer ? getLayerBoundsNoEffects(finalLayer) : undefined;

            return {
                success: true,
                data: {
                    layerId: placedLayerId,
                    layerName: name,
                    bounds: finalBounds ? {
                        left: finalBounds.left,
                        top: finalBounds.top,
                        right: finalBounds.right,
                        bottom: finalBounds.bottom,
                        width: finalBounds.right - finalBounds.left,
                        height: finalBounds.bottom - finalBounds.top
                    } : null,
                    source: {
                        assetId: sourceAssetId,
                        checksum: sourceChecksum,
                        byteLength: sourceByteLength
                    },
                    message: `成功置入图片「${name}」`
                }
            };

        } catch (error: any) {
            const failure = createToolFailureResult({ toolName: this.name, error, params });
            return {
                ...failure,
                data: {
                    popupPrevented: true,
                    reason: failure.errorDetails.category === 'image_decode_error'
                        ? 'image-preflight-failed'
                        : 'photoshop-command-failed',
                    source: {
                        hasFilePath: !!filePath,
                        hasImageData: !!imageData,
                        assetId: sourceAssetId
                    }
                },
            };
        }
    }
}

export default PlaceImageTool;
