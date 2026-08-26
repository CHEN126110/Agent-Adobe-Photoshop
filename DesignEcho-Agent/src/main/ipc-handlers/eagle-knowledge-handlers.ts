import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

import type {
    EagleReadonlyKnowledgeQuery,
    EagleReadonlySettings
} from '../../shared/eagle-readonly-knowledge';
import { EagleReadonlyKnowledgeService } from '../services/eagle-readonly-knowledge-service';
import { eagleLibraryService } from '../services/eagle-library-service';
import { buildVisionModelCall } from './resource-handlers';
import type { IPCContext } from './types';

/** Eagle 应用未运行时的素材库目录直读检索（R0：本地路径不出主进程）。 */
async function searchEagleLibraryFromDisk(
    queryText: string,
    limit: number
): Promise<{ libraryName: string; results: any[] } | null> {
    const trimmed = queryText.trim();
    if (!trimmed) return null;
    try {
        const settingsPath = path.join(process.env.APPDATA || '', 'Eagle', 'Settings');
        if (!fs.existsSync(settingsPath)) return null;
        const eagleSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        const libraryPath = Array.isArray(eagleSettings?.libraryHistory)
            ? String(eagleSettings.libraryHistory[0] || '').trim()
            : '';
        if (!libraryPath || !fs.existsSync(libraryPath)) return null;
        const opened = await eagleLibraryService.openLibrary(libraryPath, false);
        if (!opened?.success) return null;
        const queryResult = await eagleLibraryService.queryLibrary({
            libraryPath,
            query: trimmed,
            limit: Math.min(Math.max(limit, 1), 20)
        } as any);
        if (!queryResult?.success || queryResult.items.length === 0) return null;
        const results = queryResult.items.map((item: any) => ({
            id: `eagle-disk:${item.libraryId}:${item.id}`,
            title: String(item.name || '未命名素材'),
            intent: 'reference_case',
            sourceType: 'eagle_library',
            summary: [
                item.annotation ? `注释：${String(item.annotation).slice(0, 120)}` : '',
                Array.isArray(item.folderPaths) && item.folderPaths.length > 0 ? `文件夹：${item.folderPaths.slice(0, 3).join('、')}` : '',
                `assetRef=${item.libraryId}:${item.id}`
            ].filter(Boolean).join('；'),
            sourceNotes: ['来自 Eagle 素材库（应用未运行·目录直读）', '检索到标题不等于看过：用 observeEagleAsset 传 assetRef 真看画面'],
            tags: Array.isArray(item.tags) ? item.tags.slice(0, 10) : [],
            allowedUses: ['prompt_context'],
            sourceLevel: 'primary',
            sourceRank: 1
        }));
        return { libraryName: opened.library?.name || path.basename(libraryPath), results };
    } catch {
        return null;
    }
}

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
            const response = await EagleReadonlyKnowledgeService.search(query, { settings });
            if (response.status !== 'unavailable') return response;
            // 2026-08-24 用户裁决「不需要 Eagle 启动」：MCP 通道不可用时从素材库目录直读降级。
            // 库路径取 Eagle 自身配置（%APPDATA%/Eagle/Settings 的 libraryHistory），
            // queryLibrary 做名字/标签/注释/文件夹全文匹配；R0 保持——本地路径不回传，
            // 看图走 observeEagleAsset(assetRef)。降级成功即 ok，不再对用户报红。
            const diskFallback = await searchEagleLibraryFromDisk(String(query?.query || ''), Number(query?.limit) || 8);
            if (!diskFallback) return response;
            return {
                ...response,
                status: 'ok' as const,
                results: diskFallback.results,
                providerSummary: { eagleLibrary: diskFallback.results.length },
                warnings: [
                    ...response.warnings,
                    `Eagle 应用未运行，已从素材库目录直读检索（库：${diskFallback.libraryName}）。看某条素材的画面用 observeEagleAsset 传它的 assetRef。`
                ]
            };
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
