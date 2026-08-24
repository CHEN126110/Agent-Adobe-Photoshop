import { CODEX_SUBSCRIPTION_PROVIDER } from '../codex-subscription-contract';
import {
    type ModelConfig,
    type ModelPreferencesPatch
} from './models.config';
import { normalizeDynamicModelUsageConfig } from './provider-model-merge';

export type PersistedModelRuntimeSource = 'designecho-storage' | 'rendererState' | 'default';

export interface PersistedModelRuntimeState {
    modelPreferences: ModelPreferencesPatch | null;
    dynamicModels: ModelConfig[];
    source: PersistedModelRuntimeSource;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function parsePersistedEntry(value: unknown): Record<string, unknown> | null {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
        const parsed = asRecord(JSON.parse(value));
        if (!parsed) return null;
        return asRecord(parsed.state) || parsed;
    } catch {
        return null;
    }
}

function asPersistedModelPreferences(value: unknown): ModelPreferencesPatch | null {
    const preferences = asRecord(value);
    if (!preferences) return null;
    const primaryModel = String(preferences.primaryModel || '').trim();
    const legacyVisualModel = String(preferences.visualModel || '').trim();
    const hasKnownMode = preferences.mode === 'local' || preferences.mode === 'cloud';
    return primaryModel || legacyVisualModel || hasKnownMode
        ? preferences as ModelPreferencesPatch
        : null;
}

export function normalizePersistedDynamicModels(value: unknown): ModelConfig[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter((model): model is ModelConfig => (
            !!model
            && typeof model === 'object'
            && typeof model.id === 'string'
            && model.id.trim().length > 0
            && typeof model.apiModelId === 'string'
            && model.apiModelId.trim().length > 0
        ))
        .map(normalizeDynamicModelUsageConfig);
}

export function excludeSessionBoundDynamicModels(models: ModelConfig[]): ModelConfig[] {
    return models.filter((model) => model.provider !== CODEX_SUBSCRIPTION_PROVIDER);
}

/**
 * 从 renderer 已有的 Zustand 持久化 owner 读取主进程冷启动所需的模型投影。
 * `designecho-storage` 是 canonical；`rendererState` 只在 canonical 缺失模型偏好时兜底，
 * 避免 300ms 备份快照反过来覆盖更新更及时的 Store。
 */
export function resolvePersistedModelRuntimeState(entriesValue: unknown): PersistedModelRuntimeState {
    const entries = asRecord(entriesValue) || {};
    const canonicalState = parsePersistedEntry(entries['designecho-storage']);
    const fallbackState = parsePersistedEntry(entries.rendererState);
    const canonicalPreferences = asPersistedModelPreferences(canonicalState?.modelPreferences);
    const fallbackPreferences = asPersistedModelPreferences(fallbackState?.modelPreferences);

    if (canonicalPreferences) {
        return {
            modelPreferences: canonicalPreferences,
            dynamicModels: excludeSessionBoundDynamicModels(
                normalizePersistedDynamicModels(canonicalState?.dynamicModels)
            ),
            source: 'designecho-storage'
        };
    }

    if (fallbackPreferences) {
        return {
            modelPreferences: fallbackPreferences,
            dynamicModels: [],
            source: 'rendererState'
        };
    }

    return {
        modelPreferences: null,
        dynamicModels: [],
        source: 'default'
    };
}
