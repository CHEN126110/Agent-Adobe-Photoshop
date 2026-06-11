import { ipcMain, type IpcMainInvokeEvent } from 'electron';

import type {
    EagleReadonlyKnowledgeQuery,
    EagleReadonlySettings
} from '../../shared/eagle-readonly-knowledge';
import { EagleReadonlyKnowledgeService } from '../services/eagle-readonly-knowledge-service';

export function registerEagleKnowledgeHandlers(): void {
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
}
