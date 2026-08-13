/**
 * 撤销/重做工具
 * 
 * 调用 Photoshop 内置的撤销/重做功能
 */

import { Tool, ToolSchema } from '../types';

const app = require('photoshop').app;
const { core } = require('photoshop');
const { action } = require('photoshop');

interface HistoryPosition {
    historyCount: number;
    currentState: number;
}

interface HistoryPositionDocument {
    activeHistoryState?: { id?: number };
    historyStates?: {
        readonly length: number;
        readonly [index: number]: { id?: number } | undefined;
    };
}

/**
 * 通过 Photoshop 官方 HistoryStates DOM 读取当前历史位置（1 基）。
 *
 * 不要为这类 DOM 已公开的数据构造 batchPlay `get` 描述符：无效的
 * historyState/property 组合会让 Photoshop 弹出“命令‘获取’当前不可用”，
 * 原生弹窗随后会阻塞整个 UXP 调度线程。
 */
function readCurrentHistoryPosition(document: HistoryPositionDocument): HistoryPosition | null {
    const historyStates = document?.historyStates;
    const historyCount = Number(historyStates?.length);
    const activeHistoryStateId = Number(document?.activeHistoryState?.id);
    if (!Number.isSafeInteger(historyCount)
        || historyCount <= 0
        || !Number.isSafeInteger(activeHistoryStateId)
        || activeHistoryStateId <= 0) {
        return null;
    }

    for (let index = 0; index < historyCount; index++) {
        if (Number(historyStates[index]?.id) === activeHistoryStateId) {
            return {
                historyCount,
                currentState: index + 1
            };
        }
    }

    return null;
}

export class UndoTool implements Tool {
    name = 'undo';

    schema: ToolSchema = {
        name: 'undo',
        description: '撤销上一步操作',
        parameters: {
            type: 'object',
            properties: {
                steps: {
                    type: 'number',
                    description: '撤销的步数，默认为 1'
                }
            }
        }
    };

    async execute(params: { steps?: number }): Promise<{
        success: boolean;
        message?: string;
        error?: string;
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            const steps = params.steps || 1;

            const before = readCurrentHistoryPosition(doc);
            if (!before) {
                return { success: false, error: '无法读取历史状态，不能确认可撤销步数' };
            }
            if (before.currentState <= 1) {
                return { success: false, error: '没有可撤销的历史状态' };
            }

            await core.executeAsModal(async () => {
                for (let i = 0; i < steps; i++) {
                    await action.batchPlay([
                        {
                            _obj: 'select',
                            _target: [
                                { _ref: 'historyState', _enum: 'ordinal', _value: 'previous' }
                            ],
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], {});
                }
            }, { commandName: 'DesignEcho: 撤销' });

            const after = readCurrentHistoryPosition(doc);
            const undone = before.currentState - (after?.currentState ?? before.currentState);
            if (undone <= 0) {
                return { success: false, error: '撤销未生效：历史状态没有变化' };
            }
            if (undone < steps) {
                return {
                    success: true,
                    message: `已撤销 ${undone} 步操作（请求 ${steps} 步，历史深度不足）`
                };
            }

            return {
                success: true,
                message: `已撤销 ${undone} 步操作`
            };

        } catch (error) {
            console.error('[Undo] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '撤销失败'
            };
        }
    }
}

export class RedoTool implements Tool {
    name = 'redo';

    schema: ToolSchema = {
        name: 'redo',
        description: '重做上一步被撤销的操作',
        parameters: {
            type: 'object',
            properties: {
                steps: {
                    type: 'number',
                    description: '重做的步数，默认为 1'
                }
            }
        }
    };

    async execute(params: { steps?: number }): Promise<{
        success: boolean;
        message?: string;
        error?: string;
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            const steps = params.steps || 1;

            const before = readCurrentHistoryPosition(doc);
            if (!before) {
                return { success: false, error: '无法读取历史状态，不能确认可重做步数' };
            }

            await core.executeAsModal(async () => {
                for (let i = 0; i < steps; i++) {
                    await action.batchPlay([
                        {
                            _obj: 'select',
                            _target: [
                                { _ref: 'historyState', _enum: 'ordinal', _value: 'next' }
                            ],
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], {});
                }
            }, { commandName: 'DesignEcho: 重做' });

            const after = readCurrentHistoryPosition(doc);
            const redone = (after?.currentState ?? before.currentState) - before.currentState;
            if (redone <= 0) {
                return { success: false, error: '没有可重做的历史状态' };
            }
            if (redone < steps) {
                return {
                    success: true,
                    message: `已重做 ${redone} 步操作（请求 ${steps} 步，后面没有更多历史）`
                };
            }

            return {
                success: true,
                message: `已重做 ${redone} 步操作`
            };

        } catch (error) {
            console.error('[Redo] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '重做失败'
            };
        }
    }
}

/**
 * 获取历史记录信息工具
 */
export class GetHistoryInfoTool implements Tool {
    name = 'getHistoryInfo';

    schema: ToolSchema = {
        name: 'getHistoryInfo',
        description: '获取当前文档的历史记录信息',
        parameters: {
            type: 'object',
            properties: {}
        }
    };

    async execute(): Promise<{
        success: boolean;
        historyCount?: number;
        currentState?: number;
        canUndo?: boolean;
        canRedo?: boolean;
        error?: string;
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            const historyPosition = readCurrentHistoryPosition(doc);
            if (!historyPosition) {
                return { success: false, error: '无法读取当前文档的历史记录位置' };
            }

            return {
                success: true,
                historyCount: historyPosition.historyCount,
                currentState: historyPosition.currentState,
                canUndo: historyPosition.currentState > 1,
                canRedo: historyPosition.currentState < historyPosition.historyCount
            };

        } catch (error) {
            console.error('[GetHistoryInfo] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '获取历史记录失败'
            };
        }
    }
}
