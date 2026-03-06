/**
 * 品牌规范 IPC Handlers
 */

import { ipcMain } from 'electron';
import { brandSpecService, BrandSpec } from '../services/brand-spec-service';

export function registerBrandSpecHandlers(): void {
    console.log('[BrandSpecHandlers] 注册品牌规范 IPC handlers...');

    ipcMain.handle('brand:getEffective', async (_event, projectPath?: string) => {
        try {
            const spec = await brandSpecService.getEffectiveBrandSpec(projectPath);
            return { success: true, spec };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('brand:getProject', async (_event, projectPath: string) => {
        try {
            const spec = await brandSpecService.getProjectBrandSpec(projectPath);
            return { success: true, spec };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('brand:saveProject', async (_event, params: { projectPath: string; spec: BrandSpec }) => {
        try {
            await brandSpecService.saveProjectBrandSpec(params.projectPath, params.spec);
            return { success: true };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('brand:list', async () => {
        try {
            const specs = brandSpecService.listGlobalBrandSpecs();
            return { success: true, specs };
        } catch (error: any) {
            return { success: false, specs: [], error: error.message };
        }
    });

    ipcMain.handle('brand:save', async (_event, spec: BrandSpec) => {
        try {
            brandSpecService.saveGlobalBrandSpec(spec);
            return { success: true, id: spec.id };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('brand:delete', async (_event, specId: string) => {
        try {
            const deleted = brandSpecService.deleteGlobalBrandSpec(specId);
            return { success: deleted };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('brand:getTemplate', async () => {
        try {
            const template = brandSpecService.getDefaultTemplate();
            return { success: true, template };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('brand:toPromptContext', async (_event, projectPath?: string) => {
        try {
            const spec = await brandSpecService.getEffectiveBrandSpec(projectPath);
            const context = brandSpecService.toPromptContext(spec);
            return { success: true, context, specName: spec.name };
        } catch (error: any) {
            return { success: false, context: '', error: error.message };
        }
    });

    console.log('[BrandSpecHandlers] 品牌规范 IPC handlers 注册完成 (8 handlers)');
}
