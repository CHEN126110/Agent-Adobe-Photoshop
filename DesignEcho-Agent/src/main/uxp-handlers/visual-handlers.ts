/**
 * 视觉上下文相关 UXP Handlers
 */

import { getVisualAnnotationService } from '../services/visual-annotation-service';
import type { UXPContext } from './types';

/**
 * 生成简单的图层映射文本
 */
function generateSimpleMapping(layers: any[]): string {
    const lines = ['📋 图层映射表：', ''];
    for (const layer of layers) {
        let line = `[${layer.index}] ${layer.name} (${layer.kind})`;
        if (layer.textContent) {
            const preview = layer.textContent.length > 20 
                ? layer.textContent.substring(0, 20) + '...'
                : layer.textContent;
            line += ` "${preview}"`;
        }
        lines.push(line);
    }
    return lines.join('\n');
}

/**
 * 注册视觉上下文相关 handlers
 */
export function registerVisualHandlers(context: UXPContext): void {
    const { wsServer, logService, mattingService } = context;

    // 获取视觉上下文（带标注的画布截图）
    wsServer.registerHandler('get-visual-context', async (params: {
        maxSize?: number;
        includeHidden?: boolean;
        layerFilter?: 'all' | 'visual' | 'text';
    }) => {
        logService?.logAgent('info', '[UXP Handler] 收到视觉上下文请求');
        
        try {
            if (!wsServer.isPluginConnected()) {
                return { success: false, error: 'Photoshop 插件未连接' };
            }

            const snapshotResult = await wsServer.sendRequest('getCanvasSnapshot', {
                maxSize: params.maxSize || 1200,
                format: 'jpeg',
                quality: 90
            });

            if (!snapshotResult?.success || !snapshotResult?.snapshot?.base64) {
                return { success: false, error: '获取画布截图失败' };
            }

            const mappingResult = await wsServer.sendRequest('getElementMapping', {
                includeHidden: params.includeHidden || false,
                includeGroups: true,
                sortBy: 'position'
            });

            if (!mappingResult?.success || !mappingResult?.elements) {
                return { success: false, error: '获取元素映射失败' };
            }

            const layers = mappingResult.elements.map((el: any, idx: number) => ({
                id: el.id,
                index: idx + 1,
                name: el.name,
                kind: el.type,
                visible: el.visible,
                bounds: {
                    left: Math.round(el.bounds.left * (snapshotResult.snapshot.width / snapshotResult.documentInfo.width)),
                    top: Math.round(el.bounds.top * (snapshotResult.snapshot.height / snapshotResult.documentInfo.height)),
                    right: Math.round(el.bounds.right * (snapshotResult.snapshot.width / snapshotResult.documentInfo.width)),
                    bottom: Math.round(el.bounds.bottom * (snapshotResult.snapshot.height / snapshotResult.documentInfo.height)),
                    width: Math.round(el.bounds.width * (snapshotResult.snapshot.width / snapshotResult.documentInfo.width)),
                    height: Math.round(el.bounds.height * (snapshotResult.snapshot.height / snapshotResult.documentInfo.height))
                },
                textContent: el.textContent
            }));

            const annotationService = getVisualAnnotationService();
            const annotationResult = await annotationService.annotateSnapshot(
                snapshotResult.snapshot.base64,
                layers
            );

            if (!annotationResult.success) {
                logService?.logAgent('warn', `[UXP Handler] 视觉标注失败: ${annotationResult.error}`);
                return {
                    success: true,
                    snapshot: snapshotResult.snapshot.base64,
                    layers: layers,
                    layerMapping: generateSimpleMapping(layers),
                    documentInfo: snapshotResult.documentInfo,
                    summary: mappingResult.summary,
                    annotated: false
                };
            }

            logService?.logAgent('info', `[UXP Handler] 视觉上下文获取成功，共 ${layers.length} 个元素`);

            return {
                success: true,
                snapshot: annotationResult.annotatedImage,
                layers: layers,
                layerMapping: annotationResult.layerMapping,
                documentInfo: snapshotResult.documentInfo,
                summary: mappingResult.summary,
                annotated: true
            };

        } catch (error: any) {
            logService?.logAgent('error', `[UXP Handler] 视觉上下文获取失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    // 获取抠图模型配置
    wsServer.registerHandler('get-matting-config', async () => {
        try {
            const serviceStatus = await mattingService?.getPythonBackendStatus();
            
            return {
                success: true,
                modelNameMap: {
                    'birefnet': 'BiRefNet',
                    'yolo-world': 'YOLO-World'
                },
                availableModels: serviceStatus?.models || [],
                stages: [
                    { id: 'detection', name: '目标检测', icon: '🎯' },
                    { id: 'segmentation', name: '精确分割', icon: '✂️' },
                ],
                localOnnx: serviceStatus?.available || false
            };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });
}
