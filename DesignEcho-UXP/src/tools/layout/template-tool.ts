/**
 * 模板渲染工具类
 * 
 * 在 Photoshop 中执行模板渲染操作
 */

import { app, core, action } from 'photoshop';
import { Tool, ToolSchema, ToolResult } from '../types';

// ===== 辅助函数 =====

/**
 * 根据路径查找图层
 */
async function findLayerByPath(layerPath: string): Promise<any | null> {
    const doc = app.activeDocument;
    if (!doc) return null;

    const parts = layerPath.split('/');
    let current: any = doc;

    for (const part of parts) {
        if (!current.layers) return null;
        
        const found = current.layers.find((layer: any) => {
            return layer.name === part || layer.name.includes(part);
        });

        if (!found) return null;
        current = found;
    }

    return current;
}

/**
 * 处理图层结构
 */
function processLayers(layers: any[]): any[] {
    return layers.map(layer => ({
        id: layer.id,
        name: layer.name,
        kind: layer.kind,
        visible: layer.visible,
        bounds: layer.bounds ? {
            left: layer.bounds.left,
            top: layer.bounds.top,
            right: layer.bounds.right,
            bottom: layer.bounds.bottom
        } : null,
        isPlaceholder: layer.name.startsWith('['),
        children: layer.layers ? processLayers(layer.layers) : undefined
    }));
}

function getBoundsNoEffects(layer: any): any {
    return layer?.boundsNoEffects || layer?.bounds;
}

function normalizeToFileUrl(p: string): string {
    const normalized = p.replace(/\\/g, '/');
    if (/^file:\/\//i.test(normalized)) return normalized;
    if (/^[a-zA-Z]:\//.test(normalized)) return `file:///${normalized}`;
    if (normalized.startsWith('//')) return `file:${normalized}`;
    return `file://${normalized.startsWith('/') ? '' : '/'}${normalized}`;
}

function safeEncodeUrl(url: string): string {
    try {
        return encodeURI(decodeURI(url));
    } catch {
        return encodeURI(url);
    }
}

async function createSessionTokenFromPath(filePath: string): Promise<string> {
    const uxpStorage = require('uxp').storage;
    const localFs = uxpStorage.localFileSystem;
    const fileUrl = safeEncodeUrl(normalizeToFileUrl(filePath));
    const fileEntry = await localFs.getEntryWithUrl(fileUrl);
    if (!fileEntry) {
        throw new Error(`无法访问文件: ${filePath}`);
    }
    return await localFs.createSessionToken(fileEntry);
}

// ===== 打开 PSD/PSB 文件 =====
// 注意：此工具可用于打开任何 PSD/PSB 文件，包括 SKU 素材、模板、详情页等

export class OpenTemplateTool implements Tool {
    name = 'openTemplate';  // 保持向后兼容，实际可打开任意 PSD/PSB
    
    schema: ToolSchema = {
        name: 'openTemplate',
        description: '打开 PSD/PSB 文件（可以是模板、SKU 素材、详情页等任意设计文件）',
        parameters: {
            type: 'object',
            properties: {
                psdPath: {
                    type: 'string',
                    description: 'PSD/PSB 文件的完整路径'
                }
            },
            required: ['psdPath']
        }
    };

    async execute(params: { psdPath: string }): Promise<ToolResult> {
        const { psdPath } = params;
        
        console.log('[OpenFile] 开始打开文件:', psdPath);

        if (!psdPath) {
            return {
                success: false,
                error: '未提供文件路径',
                data: null
            };
        }

        try {
            // UXP 安全限制：无法通过路径字符串直接打开外部文件
            // 需要使用文件选择器获取用户授权
            const uxpStorage = require('uxp').storage;
            const localFs = uxpStorage.localFileSystem as any;  // 使用 any 绕过类型检查
            
            // 尝试使用文件选择器获取文件访问权限
            // 这会弹出一个文件选择对话框
            console.log('[OpenFile] 尝试通过文件选择器获取访问权限...');
            
            // 从路径中提取文件名
            const fileName = psdPath.split(/[\\\/]/).pop() || 'file.psd';
            
            let fileEntry;
            try {
                // 弹出文件选择器，让用户选择要打开的文件
                fileEntry = await localFs.getFileForOpening({
                    types: ['psd', 'psb']
                });
                
                if (!fileEntry) {
                    console.log('[OpenFile] 用户取消了文件选择');
                    return {
                        success: false,
                        error: `用户取消了文件选择。\n\n如需打开文件，请在 Photoshop 中使用 **文件 > 打开**:\n📁 ${psdPath}`,
                        data: {
                            suggestion: 'manual_open',
                            filePath: psdPath,
                            fileName: fileName
                        }
                    };
                }
                
                console.log('[OpenFile] 用户选择了文件:', fileEntry.name);
            } catch (pickerError: any) {
                console.error('[OpenFile] 文件选择器失败:', pickerError.message);
                
                // 如果文件选择器也失败，返回手动打开的提示
                return {
                    success: false,
                    error: `⚠️ 由于 UXP 安全限制，无法自动打开文件。\n\n请在 Photoshop 中手动打开:\n📁 ${psdPath}`,
                    data: {
                        suggestion: 'manual_open',
                        filePath: psdPath,
                        fileName: fileName
                    }
                };
            }
            
            // 创建 Session Token
            const fileToken = await localFs.createSessionToken(fileEntry);
            console.log('[OpenFile] Session Token 已创建');
            
            // 使用 token 打开文件
            await core.executeAsModal(async () => {
                await action.batchPlay([
                    {
                        _obj: 'open',
                        null: {
                            _path: fileToken,
                            _kind: 'local'
                        },
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], { synchronousExecution: true });
            }, { commandName: `打开文件: ${fileEntry.name}` });

            const docName = app.activeDocument?.name;
            console.log('[OpenFile] 打开成功，当前文档:', docName);
            
            return {
                success: true,
                data: {
                    message: `文件已打开: ${docName || fileEntry.name}`,
                    documentName: docName,
                    filePath: fileEntry.nativePath
                }
            };
        } catch (error: any) {
            console.error('[OpenFile] 打开失败:', error);
            
            // 提取文件名用于显示
            const fileName = psdPath.split(/[\\\/]/).pop() || 'file.psd';
            
            return {
                success: false,
                error: `⚠️ 无法自动打开文件。\n\n请在 Photoshop 中手动打开:\n📁 ${psdPath}`,
                data: {
                    suggestion: 'manual_open',
                    filePath: psdPath,
                    fileName: fileName
                }
            };
        }
    }
}

// ===== 获取图层结构 =====

export class GetTemplateStructureTool implements Tool {
    name = 'getTemplateStructure';
    
    schema: ToolSchema = {
        name: 'getTemplateStructure',
        description: '获取当前文档的图层结构，用于分析模板占位符',
        parameters: {
            type: 'object',
            properties: {},
            required: []
        }
    };

    async execute(_params: object): Promise<ToolResult> {
        const doc = app.activeDocument;
        if (!doc) {
            return {
                success: false,
                error: '没有打开的文档',
                data: null
            };
        }

        const placeholders: any[] = [];

        function scanForPlaceholders(layers: any[], path: string = '') {
            for (const layer of layers) {
                const currentPath = path ? `${path}/${layer.name}` : layer.name;
                
                if (layer.name.startsWith('[')) {
                    placeholders.push({
                        name: layer.name,
                        path: currentPath,
                        kind: layer.kind,
                        visible: layer.visible
                    });
                }
                
                if (layer.layers) {
                    scanForPlaceholders(layer.layers, currentPath);
                }
            }
        }

        scanForPlaceholders(doc.layers);

        return {
            success: true,
            data: {
                message: `文档包含 ${placeholders.length} 个占位符`,
                documentName: doc.name,
                width: doc.width,
                height: doc.height,
                placeholders,
                layers: processLayers(doc.layers)
            }
        };
    }
}

// ===== 替换图片占位符 =====

export class ReplaceImagePlaceholderTool implements Tool {
    name = 'replaceImagePlaceholder';
    
    schema: ToolSchema = {
        name: 'replaceImagePlaceholder',
        description: '替换模板中的图片占位符',
        parameters: {
            type: 'object',
            properties: {
                layerPath: {
                    type: 'string',
                    description: '目标图层路径，如 "产品层/[IMG:产品主体]"'
                },
                imagePath: {
                    type: 'string',
                    description: '替换图片的完整路径'
                },
                fit: {
                    type: 'string',
                    enum: ['contain', 'cover', 'fill', 'none'],
                    description: '图片适配模式'
                },
                align: {
                    type: 'string',
                    enum: ['center', 'top', 'bottom', 'left', 'right'],
                    description: '对齐方式'
                }
            },
            required: ['layerPath', 'imagePath']
        }
    };

    async execute(params: {
        layerPath: string;
        imagePath: string;
        fit?: string;
        align?: string;
    }): Promise<ToolResult> {
        const { layerPath, imagePath, fit = 'contain' } = params;
        
        const doc = app.activeDocument;
        if (!doc) {
            return { success: false, error: '没有打开的文档', data: null };
        }

        const layer = await findLayerByPath(layerPath);
        if (!layer) {
            return { success: false, error: `图层未找到: ${layerPath}`, data: null };
        }

        try {
            await core.executeAsModal(async () => {
                // 获取目标图层边界
                const targetBounds = getBoundsNoEffects(layer);
                const targetWidth = targetBounds.right - targetBounds.left;
                const targetHeight = targetBounds.bottom - targetBounds.top;
                const targetCenterX = targetBounds.left + targetWidth / 2;
                const targetCenterY = targetBounds.top + targetHeight / 2;
                const imageToken = await createSessionTokenFromPath(imagePath);

                // 放置新图片
                await action.batchPlay([
                    {
                        _obj: 'placeEvent',
                        null: {
                            _path: imageToken,
                            _kind: 'local'
                        },
                        freeTransformCenterState: {
                            _enum: 'quadCenterState',
                            _value: 'QCSAverage'
                        }
                    }
                ], {});

                const newLayer = doc.activeLayers[0];
                if (!newLayer) return;

                // 计算缩放
                const newBounds = getBoundsNoEffects(newLayer);
                const newWidth = newBounds.right - newBounds.left;
                const newHeight = newBounds.bottom - newBounds.top;

                let scaleX = 1;
                let scaleY = 1;
                if (fit === 'contain') {
                    const uniform = Math.min(targetWidth / newWidth, targetHeight / newHeight);
                    scaleX = uniform;
                    scaleY = uniform;
                } else if (fit === 'cover') {
                    const uniform = Math.max(targetWidth / newWidth, targetHeight / newHeight);
                    scaleX = uniform;
                    scaleY = uniform;
                } else if (fit === 'fill') {
                    scaleX = targetWidth / newWidth;
                    scaleY = targetHeight / newHeight;
                }

                // 应用缩放
                if (scaleX !== 1 || scaleY !== 1) {
                    await action.batchPlay([
                        {
                            _obj: 'transform',
                            freeTransformCenterState: {
                                _enum: 'quadCenterState',
                                _value: 'QCSAverage'
                            },
                            width: { _unit: 'percentUnit', _value: scaleX * 100 },
                            height: { _unit: 'percentUnit', _value: scaleY * 100 }
                        }
                    ], {});
                }

                // 移动到目标位置
                const currentBounds = getBoundsNoEffects(newLayer);
                const currentCenterX = (currentBounds.left + currentBounds.right) / 2;
                const currentCenterY = (currentBounds.top + currentBounds.bottom) / 2;
                
                await newLayer.translate(
                    targetCenterX - currentCenterX,
                    targetCenterY - currentCenterY
                );

                // 删除原图层
                const originalName = layer.name;
                await layer.delete();
                newLayer.name = originalName;

            }, { commandName: 'Replace Image Placeholder' });

            return {
                success: true,
                data: { message: `已替换图片: ${layerPath}` }
            };
        } catch (error: any) {
            return {
                success: false,
                error: `替换图片失败: ${error.message}`,
                data: null
            };
        }
    }
}

// ===== 替换文本占位符 =====

export class ReplaceTextPlaceholderTool implements Tool {
    name = 'replaceTextPlaceholder';
    
    schema: ToolSchema = {
        name: 'replaceTextPlaceholder',
        description: '替换模板中的文本占位符',
        parameters: {
            type: 'object',
            properties: {
                layerPath: {
                    type: 'string',
                    description: '目标文本图层路径，如 "文字层/[TEXT:标题]"'
                },
                text: {
                    type: 'string',
                    description: '替换的文本内容'
                },
                maxLength: {
                    type: 'string',
                    description: '最大字符数，超出会截断并添加...'
                }
            },
            required: ['layerPath', 'text']
        }
    };

    async execute(params: {
        layerPath: string;
        text: string;
        maxLength?: number;
    }): Promise<ToolResult> {
        const { layerPath, text, maxLength } = params;
        
        const doc = app.activeDocument;
        if (!doc) {
            return { success: false, error: '没有打开的文档', data: null };
        }

        const layer = await findLayerByPath(layerPath);
        if (!layer) {
            return { success: false, error: `图层未找到: ${layerPath}`, data: null };
        }

        if (layer.kind !== 'text') {
            return { success: false, error: `图层 ${layerPath} 不是文本图层`, data: null };
        }

        try {
            await core.executeAsModal(async () => {
                let finalText = text;
                if (maxLength && text.length > maxLength) {
                    finalText = text.substring(0, maxLength) + '...';
                }
                layer.textItem.contents = finalText;
            }, { commandName: 'Replace Text Placeholder' });

            return {
                success: true,
                data: { 
                    message: `已替换文本: ${layerPath}`,
                    text: text.length > 50 ? text.substring(0, 50) + '...' : text 
                }
            };
        } catch (error: any) {
            return {
                success: false,
                error: `替换文本失败: ${error.message}`,
                data: null
            };
        }
    }
}

// ===== 批量渲染 =====

export class BatchRenderTemplateTool implements Tool {
    name = 'batchRenderTemplate';
    
    schema: ToolSchema = {
        name: 'batchRenderTemplate',
        description: '批量执行模板渲染指令',
        parameters: {
            type: 'object',
            properties: {
                instructions: {
                    type: 'array',
                    description: '渲染指令数组，每个指令包含 action, layerPath 和相应参数',
                    items: { type: 'object' }
                }
            },
            required: ['instructions']
        }
    };

    async execute(params: {
        instructions: Array<{
            action: string;
            layerPath: string;
            [key: string]: any;
        }>;
    }): Promise<ToolResult> {
        const { instructions } = params;

        if (!instructions || instructions.length === 0) {
            return { success: false, error: '没有渲染指令', data: null };
        }

        const doc = app.activeDocument;
        if (!doc) {
            return { success: false, error: '没有打开的文档', data: null };
        }

        const results: { action: string; layerPath: string; success: boolean; error?: string }[] = [];

        for (const instruction of instructions) {
            try {
                const layer = await findLayerByPath(instruction.layerPath);
                
                if (!layer) {
                    results.push({
                        action: instruction.action,
                        layerPath: instruction.layerPath,
                        success: false,
                        error: '图层未找到'
                    });
                    continue;
                }

                await core.executeAsModal(async () => {
                    switch (instruction.action) {
                        case 'hideLayer':
                            layer.visible = false;
                            break;
                        case 'showLayer':
                            layer.visible = true;
                            break;
                        case 'setText':
                            if (layer.kind === 'text') {
                                layer.textItem.contents = instruction.text;
                            }
                            break;
                    }
                }, { commandName: `Render: ${instruction.action}` });

                results.push({
                    action: instruction.action,
                    layerPath: instruction.layerPath,
                    success: true
                });

            } catch (error: any) {
                results.push({
                    action: instruction.action,
                    layerPath: instruction.layerPath,
                    success: false,
                    error: error.message
                });
            }
        }

        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;

        return {
            success: failCount === 0,
            data: { 
                message: `批量渲染完成: ${successCount} 成功, ${failCount} 失败`,
                results, 
                successCount, 
                failCount 
            }
        };
    }
}
