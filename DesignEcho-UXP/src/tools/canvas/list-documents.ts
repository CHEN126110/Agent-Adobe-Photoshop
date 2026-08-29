/**
 * 列出所有文档工具
 * 
 * 获取当前 Photoshop 中所有打开的文档列表
 */

import { Tool, ToolSchema } from '../types';

const app = require('photoshop').app;
const action = require('photoshop').action;

type DocumentPathState = 'saved' | 'unsaved' | 'unavailable' | 'not_requested';

interface DocumentPathObservation {
    pathState: DocumentPathState;
    path?: string;
    pathStatusReason?: string;
}

export class ListDocumentsTool implements Tool {
    name = 'listDocuments';

    schema: ToolSchema = {
        name: 'listDocuments',
        description: '列出 Photoshop 中所有打开的文档，包括当前活动文档的标识',
        parameters: {
            type: 'object',
            properties: {
                includeDetails: {
                    type: 'boolean',
                    description: '是否包含详细信息（尺寸、图层数等），默认 false'
                },
                includePaths: {
                    type: 'boolean',
                    description: '是否读取文档路径状态；默认 true。不会递归统计图层，可显式传 false 做极简轮询'
                },
                includeDimensions: {
                    type: 'boolean',
                    description: '是否读取文档宽高；不会递归遍历图层'
                },
                includeLayerCount: {
                    type: 'boolean',
                    description: '是否递归统计图层数；默认仅在 includeDetails=true 时启用'
                },
                includeHistory: {
                    type: 'boolean',
                    description: '是否读取每个文档的历史状态身份（activeHistoryStateId、historyStateCount、saved）。纯 DOM 只读，不激活、不切换文档；用于“文档未被触碰”的版本证明'
                }
            }
        }
    };

    async execute(params: {
        includeDetails?: boolean;
        includePaths?: boolean;
        includeDimensions?: boolean;
        includeLayerCount?: boolean;
        includeHistory?: boolean;
    }): Promise<{
        success: boolean;
        activeDocumentId?: number;
        documents?: {
            id: number;
            name: string;
            isActive: boolean;
            path?: string;
            pathState: DocumentPathState;
            pathStatusReason?: string;
            width?: number;
            height?: number;
            layerCount?: number;
            activeHistoryStateId?: number;
            historyStateCount?: number;
            saved?: boolean;
            historyStatusReason?: string;
        }[];
        count?: number;
        error?: string;
    }> {
        try {
            console.log('[ListDocuments] 获取文档列表');

            const documents = app.documents;
            if (!documents || documents.length === 0) {
                return {
                    success: true,
                    activeDocumentId: undefined,
                    documents: [],
                    count: 0
                };
            }

            const activeDoc = app.activeDocument;
            const activeDocId = activeDoc?.id;

            const docList: {
                id: number;
                name: string;
                isActive: boolean;
                path?: string;
                pathState: DocumentPathState;
                pathStatusReason?: string;
                width?: number;
                height?: number;
                layerCount?: number;
                activeHistoryStateId?: number;
                historyStateCount?: number;
                saved?: boolean;
                historyStatusReason?: string;
            }[] = [];

            for (const doc of documents) {
                const docInfo: {
                    id: number;
                    name: string;
                    isActive: boolean;
                    path?: string;
                    pathState: DocumentPathState;
                    pathStatusReason?: string;
                    width?: number;
                    height?: number;
                    layerCount?: number;
                    activeHistoryStateId?: number;
                    historyStateCount?: number;
                    saved?: boolean;
                    historyStatusReason?: string;
                } = {
                    id: doc.id,
                    name: doc.name,
                    isActive: doc.id === activeDocId,
                    pathState: 'not_requested'
                };

                if (params.includeDetails || params.includeDimensions) {
                    docInfo.width = doc.width;
                    docInfo.height = doc.height;
                }
                if (params.includeHistory) {
                    // 逐文档 DOM 读取，不激活目标文档：history 身份用于"未被触碰"证明，
                    // 读取动作本身绝不能制造历史状态。读不到时保留字段缺失并说明原因，
                    // 由调用方 fail closed，不用 0 或 -1 冒充真实观察。
                    try {
                        const historyStateId = Number(doc.activeHistoryState?.id);
                        const historyStates = doc.historyStates;
                        const historyStateCount = Number(historyStates?.length);
                        if (Number.isSafeInteger(historyStateId) && historyStateId > 0) {
                            docInfo.activeHistoryStateId = historyStateId;
                        }
                        if (Number.isSafeInteger(historyStateCount) && historyStateCount >= 0) {
                            docInfo.historyStateCount = historyStateCount;
                        }
                        // UXP 类型定义缺少 Document.saved，但运行时存在（save-document.ts 同款读法）
                        const savedFlag = (doc as any).saved;
                        if (typeof savedFlag === 'boolean') {
                            docInfo.saved = savedFlag;
                        }
                        if (docInfo.activeHistoryStateId === undefined
                            || docInfo.historyStateCount === undefined
                            || docInfo.saved === undefined) {
                            docInfo.historyStatusReason =
                                'Photoshop 未返回完整历史身份（activeHistoryState/historyStates/saved 部分缺失）。';
                        }
                    } catch (historyError) {
                        docInfo.historyStatusReason = `读取文档历史身份失败：${
                            historyError instanceof Error ? historyError.message : String(historyError)
                        }`;
                    }
                }
                if (params.includeDetails || params.includeLayerCount) {
                    docInfo.layerCount = this.countLayers(doc);
                }
                if (params.includeDetails || params.includePaths !== false) {
                    const pathObservation = await this.getDocumentPath(doc.id);
                    docInfo.pathState = pathObservation.pathState;
                    if (pathObservation.path) docInfo.path = pathObservation.path;
                    if (pathObservation.pathStatusReason) {
                        docInfo.pathStatusReason = pathObservation.pathStatusReason;
                    }
                }

                docList.push(docInfo);
            }

            console.log('[ListDocuments] 找到', docList.length, '个文档');

            return {
                success: true,
                activeDocumentId: activeDocId,
                documents: docList,
                count: docList.length
            };

        } catch (error) {
            console.error('[ListDocuments] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '获取文档列表失败'
            };
        }
    }

    /**
     * 统计图层数量
     */
    private countLayers(container: any): number {
        let count = 0;
        if (!container.layers) return 0;
        
        for (const layer of container.layers) {
            count++;
            if (layer.layers) {
                count += this.countLayers(layer);
            }
        }
        return count;
    }

    /**
     * 读取文档文件路径（仅对已保存文档有效）
     */
    private async getDocumentPath(documentId: number): Promise<DocumentPathObservation> {
        try {
            const result = await action.batchPlay([
                {
                    _obj: 'get',
                    _target: [
                        { _property: 'fileReference' },
                        { _ref: 'document', _id: documentId }
                    ],
                    _options: { dialogOptions: 'dontDisplay' }
                }
            ], { synchronousExecution: true });

            const descriptor = result?.[0];
            const fileReference = descriptor?.fileReference;
            if (typeof fileReference === 'string' && fileReference.trim()) {
                return { pathState: 'saved', path: fileReference };
            }
            if (fileReference && typeof fileReference === 'object') {
                const pathLike = fileReference._path || fileReference.path || fileReference.filePath || fileReference._value;
                if (typeof pathLike === 'string' && pathLike.trim()) {
                    return { pathState: 'saved', path: pathLike };
                }
            }
            return {
                pathState: 'unsaved',
                pathStatusReason: 'Photoshop 未返回文件路径；文档尚未保存到本地文件。'
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                pathState: 'unavailable',
                pathStatusReason: `Photoshop 无法读取该文档路径；不能据此判断文档是否已保存。${message ? ` ${message}` : ''}`
            };
        }
    }
}
