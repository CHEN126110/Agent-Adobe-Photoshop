import { ipcMain, type IpcMainInvokeEvent } from 'electron';

import type {
    EagleReadonlyKnowledgeQuery,
    EagleReadonlySettings
} from '../../shared/eagle-readonly-knowledge';
import { EagleReadonlyKnowledgeService } from '../services/eagle-readonly-knowledge-service';
import { buildVisionModelCall } from './resource-handlers';
import type { IPCContext } from './types';

export function registerEagleKnowledgeHandlers(context: IPCContext): void {
    ipcMain.handle(
        'designKnowledge:probeEagleReadonly',
        async (_event: IpcMainInvokeEvent, settings?: Partial<EagleReadonlySettings>) => {
            return EagleReadonlyKnowledgeService.probe({ settings });
        }
    );

    ipcMain.handle(
        'designKnowledge:searchEagleReadonly',
        async (
            _event: IpcMainInvokeEvent,
            query: EagleReadonlyKnowledgeQuery,
            settings?: Partial<EagleReadonlySettings>
        ) => {
            return EagleReadonlyKnowledgeService.search(query, { settings });
        }
    );

    ipcMain.handle(
        'designKnowledge:getEagleReferencePreview',
        async (_event: IpcMainInvokeEvent, request: {
            itemId?: string;
            maxSize?: number;
            purpose?: 'knowledge_library_ui';
            settings?: Partial<EagleReadonlySettings>;
        }) => {
            const { resourceManagerService } = context;
            if (!resourceManagerService) {
                return {
                    success: false,
                    status: 'unavailable',
                    warnings: [],
                    error: 'Eagle 预览不可用：资源服务未初始化。',
                    boundaries: {
                        uiOnly: true,
                        requiresExplicitRequest: true,
                        singleItemOnly: true,
                        requiredPurpose: 'knowledge_library_ui',
                        maxPreviewSize: 512,
                        localPathRedacted: true,
                        doesNotEnterAgentContext: true,
                        doesNotPersist: true,
                        doesNotWriteEagle: true,
                        doesNotRunPhotoshop: true
                    }
                };
            }
            return EagleReadonlyKnowledgeService.getUiPreview(
                request || {},
                (localImagePath, maxSize) => resourceManagerService.getImagePreview(localImagePath, maxSize),
                { settings: request?.settings }
            );
        }
    );

    // 评审对照用途：按 Eagle item id 解析预览图像供 evaluateDesign 并排对照。
    // R0 边界保持：本地路径与原始文件不回传（图像只作为评审模型调用的输入，工具结果不含路径）。
    ipcMain.handle(
        'designKnowledge:getEagleReferenceImageForEvaluation',
        async (_event: IpcMainInvokeEvent, request: {
            itemId?: string;
            settings?: Partial<EagleReadonlySettings>;
        }) => {
            const { resourceManagerService } = context;
            if (!resourceManagerService) {
                return { success: false, error: 'Eagle 参考图不可用：资源服务未初始化。' };
            }
            const resolved = await EagleReadonlyKnowledgeService.resolveItemForAnalysis(
                String(request?.itemId || '').trim(),
                { settings: request?.settings }
            );
            if (!resolved.success || !resolved.item) {
                return {
                    success: false,
                    error: resolved.error || `Eagle 参考条目不可用（itemId=${String(request?.itemId || '')}）。`,
                    warnings: resolved.warnings
                };
            }
            const preview = await resourceManagerService.getImagePreview(resolved.item.localImagePath, 1024);
            const imageData = preview.imageData || preview.base64;
            if (!preview.success || !imageData) {
                return {
                    success: false,
                    error: `Eagle 参考图读取失败：${preview.error || '预览无图像数据'}`
                };
            }
            return {
                success: true,
                imageData,
                item: { id: resolved.item.id, title: resolved.item.title },
                boundaries: { readonly: true, localPathRedacted: true, doesNotWriteEagle: true }
            };
        }
    );

    ipcMain.handle(
        'designKnowledge:analyzeEagleReference',
        async (_event: IpcMainInvokeEvent, request: {
            itemId?: string;
            topics?: string[];
            settings?: Partial<EagleReadonlySettings>;
        }) => {
            const { resourceManagerService, modelService, taskOrchestrator } = context;
            if (!resourceManagerService || !modelService) {
                return {
                    success: false,
                    status: 'unavailable',
                    error: 'Eagle 参考视觉分析失败：资源服务或模型服务未初始化。'
                };
            }
            const resolved = await EagleReadonlyKnowledgeService.resolveItemForAnalysis(
                String(request?.itemId || '').trim(),
                { settings: request?.settings }
            );
            if (!resolved.success || !resolved.item) {
                return {
                    success: false,
                    status: resolved.status,
                    error: resolved.error || 'Eagle 参考条目不可用。',
                    warnings: resolved.warnings
                };
            }
            const analysis = await resourceManagerService.analyzeDesignReference({
                imagePath: resolved.item.localImagePath,
                referenceTitle: resolved.item.title,
                referenceTags: resolved.item.tags,
                referenceSource: `eagle:${resolved.item.id}`,
                topics: Array.isArray(request?.topics) ? request.topics.map(String) : undefined,
                cadence: 'agent_reference_context'
            }, buildVisionModelCall(modelService, taskOrchestrator));
            if (!analysis.success || !analysis.observation) {
                return {
                    success: false,
                    status: 'unavailable',
                    item: {
                        id: resolved.item.id,
                        title: resolved.item.title,
                        tags: resolved.item.tags,
                        folders: resolved.item.folders,
                        ...(resolved.item.ext ? { ext: resolved.item.ext } : {}),
                        ...(resolved.item.width ? { width: resolved.item.width } : {}),
                        ...(resolved.item.height ? { height: resolved.item.height } : {})
                    },
                    error: analysis.error || '视觉模型没有形成可用的参考洞察。',
                    warnings: resolved.warnings,
                    boundaries: {
                        readonly: true,
                        localPathRedacted: true,
                        rawImageRedacted: true,
                        doesNotWriteEagle: true,
                        doesNotRunPhotoshop: true
                    }
                };
            }
            return {
                success: true,
                status: 'ok',
                item: {
                    id: resolved.item.id,
                    title: resolved.item.title,
                    tags: resolved.item.tags,
                    folders: resolved.item.folders,
                    ...(resolved.item.ext ? { ext: resolved.item.ext } : {}),
                    ...(resolved.item.width ? { width: resolved.item.width } : {}),
                    ...(resolved.item.height ? { height: resolved.item.height } : {})
                },
                observation: analysis.observation,
                warnings: resolved.warnings,
                boundaries: {
                    readonly: true,
                    localPathRedacted: true,
                    rawImageRedacted: true,
                    doesNotWriteEagle: true,
                    doesNotRunPhotoshop: true
                }
            };
        }
    );
}
