/**
 * Skill 包 IPC：渲染进程按需读取官方形态 skill 包（只读）。
 */

import { ipcMain, type IpcMainInvokeEvent } from 'electron';

import { listSkillPackages, readSkillPackage, runSkillScript } from '../services/skill-package-service';

export function registerSkillPackageHandlers(): void {
    ipcMain.handle('skillPackage:list', async () => {
        try {
            return listSkillPackages();
        } catch (error) {
            return {
                success: false,
                error: `Skill 包列表读取失败：${error instanceof Error ? error.message : String(error)}`
            };
        }
    });

    ipcMain.handle(
        'skillPackage:runScript',
        async (_event: IpcMainInvokeEvent, skillId: string, scriptName: string, params?: unknown, projectPath?: string) => {
            try {
                return await runSkillScript(skillId, scriptName, params, projectPath);
            } catch (error) {
                return {
                    success: false,
                    error: `脚本执行失败：${error instanceof Error ? error.message : String(error)}`
                };
            }
        }
    );

    ipcMain.handle(
        'skillPackage:read',
        async (_event: IpcMainInvokeEvent, skillId: string, reference?: string) => {
            try {
                return readSkillPackage(skillId, reference);
            } catch (error) {
                return {
                    success: false,
                    error: `Skill 包读取失败：${error instanceof Error ? error.message : String(error)}`
                };
            }
        }
    );
}
