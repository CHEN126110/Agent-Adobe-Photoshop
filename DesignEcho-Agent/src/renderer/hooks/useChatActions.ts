import { useCallback, useMemo } from 'react';
import { useAppStore } from '../stores/app.store';
import { getVisionModels } from '../../shared/config/models.config';

export type TaskType = 'general' | 'logic' | 'copywriting' | 'visual';

interface UseChatActionsOptions {
    isPluginConnected: boolean;
}

interface UseChatActionsReturn {
    modelPriority: string[];
    isVisionModelAvailable: () => boolean;
    detectTaskType: (userInput: string, hasImage?: boolean) => TaskType;
    getModelPriorityForTask: (taskType: TaskType) => string[];
    getTaskTypeLabel: (taskType: TaskType) => string;
}

function uniqNonEmpty(values: Array<string | undefined | null>): string[] {
    const ordered: string[] = [];
    const seen = new Set<string>();
    for (const value of values) {
        const modelId = String(value || '').trim();
        if (!modelId || seen.has(modelId)) continue;
        seen.add(modelId);
        ordered.push(modelId);
    }
    return ordered;
}

function pickModelByTask(
    taskType: TaskType,
    models: { layoutAnalysis: string; textOptimize: string; visualAnalyze: string }
): string {
    switch (taskType) {
        case 'visual':
            return models.visualAnalyze;
        case 'copywriting':
            return models.textOptimize;
        case 'logic':
        case 'general':
        default:
            return models.layoutAnalysis;
    }
}

export const useChatActions = (_options: UseChatActionsOptions): UseChatActionsReturn => {
    const modelPreferences = useAppStore((state) => state.modelPreferences);

    const detectTaskType = useCallback((userInput: string, hasImage: boolean = false): TaskType => {
        if (hasImage) return 'visual';

        const input = String(userInput || '').toLowerCase();
        if (!input.trim()) return 'general';

        if (/(分析|风格|配色|构图|参考图|视觉|看图|识图)/.test(input)) return 'visual';
        if (/(文案|标题|副标题|润色|改写|重写|slogan|copy)/.test(input)) return 'copywriting';
        if (/(抠图|去背景|图层|移动|对齐|缩放|旋转|替换|导出|sku|主图|详情页)/.test(input)) return 'logic';

        return 'general';
    }, []);

    const getModelPriorityForTask = useCallback((taskType: TaskType): string[] => {
        const localModels = modelPreferences.preferredLocalModels;
        const cloudModels = modelPreferences.preferredCloudModels;
        const localPrimary = pickModelByTask(taskType, localModels);
        const cloudPrimary = pickModelByTask(taskType, cloudModels);
        const includeVisualBackups = taskType === 'visual';

        if (modelPreferences.mode === 'local') {
            return uniqNonEmpty([
                localPrimary,
                localModels.layoutAnalysis,
                localModels.textOptimize,
                includeVisualBackups ? localModels.visualAnalyze : undefined,
                modelPreferences.autoFallback ? cloudPrimary : undefined,
                modelPreferences.autoFallback ? cloudModels.layoutAnalysis : undefined,
                modelPreferences.autoFallback ? cloudModels.textOptimize : undefined,
                modelPreferences.autoFallback && includeVisualBackups ? cloudModels.visualAnalyze : undefined
            ]);
        }

        if (modelPreferences.mode === 'cloud') {
            return uniqNonEmpty([
                cloudPrimary,
                cloudModels.layoutAnalysis,
                cloudModels.textOptimize,
                includeVisualBackups ? cloudModels.visualAnalyze : undefined
            ]);
        }

        return uniqNonEmpty([
            localPrimary,
            localModels.layoutAnalysis,
            localModels.textOptimize,
            includeVisualBackups ? localModels.visualAnalyze : undefined,
            cloudPrimary,
            cloudModels.layoutAnalysis,
            cloudModels.textOptimize,
            includeVisualBackups ? cloudModels.visualAnalyze : undefined
        ]);
    }, [modelPreferences]);

    const modelPriority = useMemo(() => getModelPriorityForTask('general'), [getModelPriorityForTask]);

    const isVisionModelAvailable = useCallback((): boolean => {
        const visionIds = new Set(getVisionModels().map((model) => model.id));
        const candidates = getModelPriorityForTask('visual');
        return candidates.some((id) => visionIds.has(id));
    }, [getModelPriorityForTask]);

    const getTaskTypeLabel = useCallback((taskType: TaskType): string => {
        switch (taskType) {
            case 'visual':
                return '视觉分析';
            case 'copywriting':
                return '文案创作';
            case 'logic':
                return '设计执行';
            case 'general':
            default:
                return '通用对话';
        }
    }, []);

    return {
        modelPriority,
        isVisionModelAvailable,
        detectTaskType,
        getModelPriorityForTask,
        getTaskTypeLabel
    };
};

export default useChatActions;
