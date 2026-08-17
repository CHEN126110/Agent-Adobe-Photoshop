import { ipcMain, type IpcMainInvokeEvent } from 'electron';

import type { PrepareSkuRetouchAssetsInput } from '../../shared/sku-retouch-contract';
import { SkuRetouchService } from '../services/sku-retouch-service';
import type { IPCContext } from './types';

/** 注册 SKU 纯底素材的确定性精修资产生成入口。 */
export function registerSkuRetouchHandlers(context: IPCContext): void {
    ipcMain.handle(
        'skuRetouch:prepareAssets',
        async (_event: IpcMainInvokeEvent, input: PrepareSkuRetouchAssetsInput) => {
            if (!context.mattingService) {
                throw new Error('SKU 素材精修不可用：BiRefNet 抠图服务未初始化。');
            }
            const service = new SkuRetouchService(context.mattingService);
            return service.prepareAssets(input);
        }
    );
}
