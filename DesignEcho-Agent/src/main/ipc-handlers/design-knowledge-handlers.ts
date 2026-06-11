import { ipcMain, type IpcMainInvokeEvent } from 'electron';

import {
    normalizeDesignKnowledgeSettings,
    toSearxngConnectorConfig,
    type DesignKnowledgeRuntimeSettings
} from '../../shared/design-knowledge-settings';
import { DesignKnowledgeSearchService } from '../services/design-knowledge-search-service';

export function registerDesignKnowledgeHandlers(): void {
    ipcMain.handle(
        'designKnowledge:probeSearxngHealth',
        async (_event: IpcMainInvokeEvent, settings: Partial<DesignKnowledgeRuntimeSettings>) => {
            try {
                const normalized = normalizeDesignKnowledgeSettings(settings);
                const result = await DesignKnowledgeSearchService.probeSearxngHealth(
                    toSearxngConnectorConfig(normalized)
                );
                return {
                    success: true,
                    ...result
                };
            } catch (error) {
                return {
                    success: false,
                    status: 'unavailable',
                    error: error instanceof Error ? error.message : String(error || 'unknown_error')
                };
            }
        }
    );
}
