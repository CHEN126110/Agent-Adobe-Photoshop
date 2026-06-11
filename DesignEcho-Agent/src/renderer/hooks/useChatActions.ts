import { useCallback, useMemo } from 'react';
import { useAppStore } from '../stores/app.store';
import { getVisionModels } from '../../shared/config/models.config';
import {
    detectConversationTaskType,
    getModelPriorityForConversationTask
} from '../../shared/model-selection';

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

const TASK_TYPE_LABELS: Record<TaskType, string> = {
    general: '\u901a\u7528',
    logic: '\u903b\u8f91\u63a8\u7406',
    copywriting: '\u6587\u6848\u521b\u4f5c',
    visual: '\u89c6\u89c9\u5206\u6790',
};

export function useChatActions({ isPluginConnected }: UseChatActionsOptions): UseChatActionsReturn {
    const { modelPreferences, apiKeys } = useAppStore();

    const modelPriority = useMemo(
        () => getModelPriorityForConversationTask(modelPreferences, 'general'),
        [modelPreferences],
    );

    const isVisionModelAvailable = useCallback(() => {
        const visionModels = getVisionModels();
        return visionModels.length > 0;
    }, []);

    const detectTaskType = useCallback(
        (userInput: string, hasImage?: boolean): TaskType =>
            detectConversationTaskType(userInput, hasImage) as TaskType,
        [],
    );

    const getModelPriorityForTask = useCallback(
        (taskType: TaskType): string[] =>
            getModelPriorityForConversationTask(modelPreferences, taskType),
        [modelPreferences],
    );

    const getTaskTypeLabel = useCallback(
        (taskType: TaskType): string => TASK_TYPE_LABELS[taskType] || taskType,
        [],
    );

    return {
        modelPriority,
        isVisionModelAvailable,
        detectTaskType,
        getModelPriorityForTask,
        getTaskTypeLabel,
    };
}
