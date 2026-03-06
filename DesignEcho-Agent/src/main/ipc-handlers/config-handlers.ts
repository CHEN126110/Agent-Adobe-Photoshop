/**
 * 配置相关 IPC Handlers
 */

import { app, ipcMain, IpcMainInvokeEvent } from 'electron';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import type { IPCContext } from './types';
import { bflService } from '../services/bfl-service';
import { googleImageService } from '../services/google-image-service';
import { volcengineInpaintingService } from '../services/volcengine-inpainting-service';

// 形态统一设置缓存
const morphingSettingsCache = {
    subjectDetectionModel: 'u2netp' as string,
    contourPrecision: 'balanced' as 'fast' | 'balanced' | 'quality',
    scaleThreshold: 2,
    positionThreshold: 2
};

// 用户配置的抠图模型设置
const userMattingConfig = {
    textGrounding: 'grounding-skip',
    objectDetection: 'detection-skip',
    segmentation: 'segment-birefnet',
    edgeRefine: 'refine-smart'
};

/**
 * 获取形态统一设置缓存
 */
export function getMorphingSettingsCache(): typeof morphingSettingsCache {
    return morphingSettingsCache;
}

/**
 * 获取抠图模型配置
 */
export function getUserMattingConfig(): typeof userMattingConfig {
    return userMattingConfig;
}

/**
 * 注册配置相关 IPC handlers
 */
export function registerConfigHandlers(context: IPCContext): void {
    const { modelService, taskOrchestrator, logService } = context;
    const stateStorePath = path.join(app.getPath('userData'), 'app-state-store.json');
    const rendererStateKey = 'rendererState';
    let stateStoreDegraded = false;
    let volatileEntries: Record<string, string> = {};
    let stateStoreWriteQueue: Promise<void> = Promise.resolve();

    const readStateStore = async (): Promise<{ entries: Record<string, string> }> => {
        try {
            const raw = await fs.readFile(stateStorePath, 'utf8');
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || typeof parsed.entries !== 'object') {
                return { entries: { ...volatileEntries } };
            }
            return { entries: { ...(parsed.entries as Record<string, string>), ...volatileEntries } };
        } catch {
            return { entries: { ...volatileEntries } };
        }
    };

    const writeStateStore = async (entries: Record<string, string>): Promise<boolean> => {
        try {
            await fs.mkdir(path.dirname(stateStorePath), { recursive: true });
            const tempPath = `${stateStorePath}.tmp`;
            const payload = JSON.stringify({ updatedAt: Date.now(), entries }, null, 2);
            try {
                await fs.writeFile(tempPath, payload, 'utf8');
                await fs.rename(tempPath, stateStorePath);
            } catch {
                await fs.writeFile(stateStorePath, payload, 'utf8');
                try { await fs.unlink(tempPath); } catch {}
            }
            volatileEntries = {};
            stateStoreDegraded = false;
            return true;
        } catch (error: any) {
            volatileEntries = { ...entries };
            if (!stateStoreDegraded) {
                stateStoreDegraded = true;
                logService?.logAgent('warn', `[Config] 持久化目录无写权限，已降级为内存模式: ${error?.message || String(error)}`);
            }
            return false;
        }
    };

    const enqueueStateStoreMutation = async (
        mutate: (entries: Record<string, string>) => void
    ): Promise<{ success: boolean; entries: Record<string, string>; error?: string }> => {
        let output: { success: boolean; entries: Record<string, string>; error?: string } = { success: false, entries: {} };
        stateStoreWriteQueue = stateStoreWriteQueue
            .then(async () => {
                const { entries } = await readStateStore();
                mutate(entries);
                const written = await writeStateStore(entries);
                output = written
                    ? { success: true, entries }
                    : { success: false, entries, error: 'file write failed, degraded to memory mode' };
            })
            .catch((error: any) => {
                output = { success: false, entries: {}, error: error?.message || String(error) };
            });
        await stateStoreWriteQueue;
        return output;
    };

    const readStateStoreSync = (): { entries: Record<string, string> } => {
        try {
            const raw = fsSync.readFileSync(stateStorePath, 'utf8');
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || typeof parsed.entries !== 'object') {
                return { entries: { ...volatileEntries } };
            }
            return { entries: { ...(parsed.entries as Record<string, string>), ...volatileEntries } };
        } catch {
            return { entries: { ...volatileEntries } };
        }
    };

    const writeStateStoreSync = (entries: Record<string, string>): boolean => {
        try {
            const entryKeys = Object.keys(entries);
            const totalSize = JSON.stringify(entries).length;
            console.log(`[StateStore] writeStateStoreSync: ${entryKeys.length} entries, totalSize=${totalSize}, keys=[${entryKeys.join(',')}]`);
            fsSync.mkdirSync(path.dirname(stateStorePath), { recursive: true });
            const tempPath = `${stateStorePath}.tmp`;
            const payload = JSON.stringify({ updatedAt: Date.now(), entries }, null, 2);
            try {
                fsSync.writeFileSync(tempPath, payload, 'utf8');
                fsSync.renameSync(tempPath, stateStorePath);
            } catch {
                fsSync.writeFileSync(stateStorePath, payload, 'utf8');
                try { fsSync.unlinkSync(tempPath); } catch {}
            }
            volatileEntries = {};
            stateStoreDegraded = false;
            return true;
        } catch (error: any) {
            volatileEntries = { ...entries };
            if (!stateStoreDegraded) {
                stateStoreDegraded = true;
                logService?.logAgent('warn', `[Config] 持久化目录无写权限，已降级为内存模式: ${error?.message || String(error)}`);
            }
            return false;
        }
    };

    // 更新 API Keys
    ipcMain.handle('config:setApiKeys', async (_event: IpcMainInvokeEvent, keys: {
        anthropic?: string;
        google?: string;
        openai?: string;
        openrouter?: string;
        ollamaUrl?: string;
        ollamaApiKey?: string;
        bfl?: string;
        volcengineAccessKeyId?: string;
        volcengineSecretAccessKey?: string;
    }) => {
        if (modelService) {
            const modelConfigPatch: Record<string, string> = {};
            if (keys.anthropic !== undefined) modelConfigPatch.anthropicApiKey = keys.anthropic;
            if (keys.google !== undefined) modelConfigPatch.googleApiKey = keys.google;
            if (keys.openai !== undefined) modelConfigPatch.openaiApiKey = keys.openai;
            if (keys.openrouter !== undefined) modelConfigPatch.openrouterApiKey = keys.openrouter;
            if (keys.ollamaUrl !== undefined) modelConfigPatch.ollamaUrl = keys.ollamaUrl;
            if (keys.ollamaApiKey !== undefined) modelConfigPatch.ollamaApiKey = keys.ollamaApiKey;
            if (keys.bfl !== undefined) modelConfigPatch.bflApiKey = keys.bfl;
            modelService.updateConfig(modelConfigPatch);
            logService?.logAgent('info', `API Keys 已更新: ${Object.keys(keys).filter(k => keys[k as keyof typeof keys]).join(', ')}`);
        }
        
        // 同步更新 BFL Service 的 API Key
        if (keys.bfl) {
            bflService.setApiKey(keys.bfl);
            logService?.logAgent('info', '[Config] BFL API Key 已同步到 BFLService');
        }
        if (keys.google) {
            googleImageService.setApiKey(keys.google);
            logService?.logAgent('info', '[Config] Google API Key 已同步到 GoogleImageService');
        }
        if (keys.volcengineAccessKeyId && keys.volcengineSecretAccessKey) {
            volcengineInpaintingService.setCredentials(keys.volcengineAccessKeyId, keys.volcengineSecretAccessKey);
            logService?.logAgent('info', '[Config] 火山引擎凭证已同步到 VolcengineInpaintingService');
        }
        
        return { success: true };
    });

    ipcMain.handle('state:getPersistedValue', async (_event: IpcMainInvokeEvent, key: string) => {
        try {
            const { entries } = await readStateStore();
            const value = Object.prototype.hasOwnProperty.call(entries, key) ? entries[key] : null;
            return { success: true, value };
        } catch (error: any) {
            return { success: false, error: error?.message || String(error) };
        }
    });

    ipcMain.handle('state:setPersistedValue', async (_event: IpcMainInvokeEvent, key: string, value: string) => {
        try {
            const valueSizeKB = Math.round((value?.length ?? 0) / 1024);
            console.log(`[StateStore] setPersistedValue (async): key="${key}", size=${valueSizeKB}KB`);
            const mutation = await enqueueStateStoreMutation((entries) => {
                entries[key] = String(value ?? '');
            });
            if (!mutation.success) {
                console.error(`[StateStore] async 写入失败（降级内存模式），key: ${key}`);
                logService?.logAgent('warn', `[Config] 持久化写入失败（降级内存模式），key: ${key}`);
                return { success: false, error: mutation.error || 'file write failed, degraded to memory mode' };
            }
            console.log(`[StateStore] async 写入成功: key="${key}"`);
            return { success: true };
        } catch (error: any) {
            console.error(`[StateStore] async 写入异常:`, error?.message || String(error));
            logService?.logAgent('warn', `[Config] 持久化写入失败: ${error?.message || String(error)}`);
            return { success: false, error: error?.message || String(error) };
        }
    });

    ipcMain.handle('state:removePersistedValue', async (_event: IpcMainInvokeEvent, key: string) => {
        try {
            const mutation = await enqueueStateStoreMutation((entries) => {
                delete entries[key];
            });
            return mutation.success ? { success: true } : { success: false, error: mutation.error || 'file write failed' };
        } catch (error: any) {
            return { success: false, error: error?.message || String(error) };
        }
    });

    ipcMain.on('state:getPersistedValueSync', (event, key: string) => {
        try {
            const { entries } = readStateStoreSync();
            const value = Object.prototype.hasOwnProperty.call(entries, key) ? entries[key] : null;
            console.log(`[StateStore] getPersistedValueSync: key="${key}", found=${value !== null}, valueLen=${value?.length ?? 0}`);
            event.returnValue = { success: true, value };
        } catch (error: any) {
            console.error(`[StateStore] getPersistedValueSync error:`, error?.message || String(error));
            event.returnValue = { success: false, error: error?.message || String(error), value: null };
        }
    });

    ipcMain.on('state:setPersistedValueSync', (event, key: string, value: string) => {
        try {
            console.log(`[StateStore] setPersistedValueSync called: key="${key}", valueLen=${value?.length ?? 0}`);
            const { entries } = readStateStoreSync();
            entries[key] = String(value ?? '');
            const written = writeStateStoreSync(entries);
            console.log(`[StateStore] writeStateStoreSync result: ${written}`);
            event.returnValue = written ? { success: true } : { success: false, error: 'file write failed, degraded to memory mode' };
        } catch (error: any) {
            console.error(`[StateStore] setPersistedValueSync error:`, error?.message || String(error));
            event.returnValue = { success: false, error: error?.message || String(error) };
        }
    });

    ipcMain.on('state:removePersistedValueSync', (event, key: string) => {
        try {
            const { entries } = readStateStoreSync();
            delete entries[key];
            const written = writeStateStoreSync(entries);
            event.returnValue = written ? { success: true } : { success: false, error: 'file write failed, degraded to memory mode' };
        } catch (error: any) {
            event.returnValue = { success: false, error: error?.message || String(error) };
        }
    });

    // 测试火山引擎凭证
    ipcMain.handle('volcengine:testCredentials', async (_event: IpcMainInvokeEvent, accessKeyId: string, secretAccessKey: string) => {
        try {
            return await volcengineInpaintingService.testCredentials(accessKeyId, secretAccessKey);
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    });

    // 更新抠图设置
    ipcMain.handle('config:setMattingSettings', async () => {
        logService?.logAgent('info', '[Config] 抠图设置更新（本地 ONNX 模式）');
        return { success: true };
    });

    ipcMain.handle('config:saveRendererState', async (_event: IpcMainInvokeEvent, state: any) => {
        try {
            const mutation = await enqueueStateStoreMutation((entries) => {
                entries[rendererStateKey] = JSON.stringify(state ?? null);
            });
            if (!mutation.success) {
                return { success: false, error: mutation.error || 'file write failed, degraded to memory mode' };
            }
            return { success: true };
        } catch (error: any) {
            logService?.logAgent('warn', `[Config] 保存 RendererState 失败: ${error?.message || String(error)}`);
            return { success: false, error: error?.message || String(error) };
        }
    });

    ipcMain.handle('config:loadRendererState', async () => {
        try {
            const { entries } = await readStateStore();
            const raw = Object.prototype.hasOwnProperty.call(entries, rendererStateKey) ? entries[rendererStateKey] : null;
            if (!raw) return { success: true, state: null };
            try {
                return { success: true, state: JSON.parse(raw) };
            } catch {
                return { success: true, state: null };
            }
        } catch (error: any) {
            return { success: false, error: error?.message || String(error), state: null };
        }
    });

    // 更新模型偏好设置
    ipcMain.handle('config:setModelPreferences', async (_event: IpcMainInvokeEvent, prefs: {
        mode?: 'local' | 'cloud' | 'auto';
        autoFallback?: boolean;
        preferredLocalModels?: { layoutAnalysis: string; textOptimize: string; visualAnalyze: string };
        preferredCloudModels?: { layoutAnalysis: string; textOptimize: string; visualAnalyze: string };
    }) => {
        if (taskOrchestrator) {
            taskOrchestrator.updatePreferences(prefs);
            logService?.logAgent('info', `模型偏好已更新: 模式=${prefs.mode || 'unchanged'}`);
        }
        return { success: true };
    });

    // 获取模型偏好设置
    ipcMain.handle('config:getModelPreferences', async () => {
        if (taskOrchestrator) {
            return taskOrchestrator.getPreferences();
        }
        return null;
    });

    // 形态统一设置
    ipcMain.handle('config:setMorphingSettings', async (_event: IpcMainInvokeEvent, settings: Partial<typeof morphingSettingsCache>) => {
        Object.assign(morphingSettingsCache, settings);
        logService?.logAgent('info', `[Config] 形态统一设置已更新: 模型=${morphingSettingsCache.subjectDetectionModel}`);
        return { success: true };
    });

    ipcMain.handle('config:getMorphingSettings', async () => {
        return morphingSettingsCache;
    });
}
