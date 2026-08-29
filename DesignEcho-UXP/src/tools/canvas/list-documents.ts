/**
 * 列出所有文档工具
 * 
 * 获取当前 Photoshop 中所有打开的文档列表
 */

import { Tool, ToolSchema } from '../types';
import {
    observePhotoshopDocumentEditState,
    type PhotoshopDocumentEditState
} from '../../core/photoshop-document-state';
import {
    readActiveHistoryStateRef,
    type PhotoshopHistoryStateRef
} from '../../core/photoshop-history-state-ref';

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
        description: '列出 Photoshop 中所有打开的文档，包括活动标识、真实路径状态和保存后的修改状态',
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
                includeHistoryState: {
                    type: 'boolean',
                    description: '是否读取每个打开文档的 documentId/historyStateId；默认 true，用于对象级隔离与变更检测'
                }
            }
        }
    };

    async execute(params: {
        includeDetails?: boolean;
        includePaths?: boolean;
        includeDimensions?: boolean;
        includeLayerCount?: boolean;
        includeHistoryState?: boolean;
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
            editState: PhotoshopDocumentEditState;
            editStateReason?: string;
            historyStateRef?: PhotoshopHistoryStateRef;
            historyStateReason?: string;
            width?: number;
            height?: number;
            layerCount?: number;
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
                editState: PhotoshopDocumentEditState;
                editStateReason?: string;
                historyStateRef?: PhotoshopHistoryStateRef;
                historyStateReason?: string;
                width?: number;
                height?: number;
                layerCount?: number;
            }[] = [];
            
            for (const doc of documents) {
                const docInfo: {
                    id: number;
                    name: string;
                    isActive: boolean;
                    path?: string;
                    pathState: DocumentPathState;
                    pathStatusReason?: string;
                    editState: PhotoshopDocumentEditState;
                    editStateReason?: string;
                    historyStateRef?: PhotoshopHistoryStateRef;
                    historyStateReason?: string;
                    width?: number;
                    height?: number;
                    layerCount?: number;
                } = {
                    id: doc.id,
                    name: doc.name,
                    isActive: doc.id === activeDocId,
                    pathState: 'not_requested',
                    editState: 'unknown'
                };

                const editState = observePhotoshopDocumentEditState(doc);
                docInfo.editState = editState.editState;
                if (editState.editStateReason) {
                    docInfo.editStateReason = editState.editStateReason;
                }

                if (params.includeHistoryState !== false) {
                    const historyStateRef = readActiveHistoryStateRef(doc);
                    if (historyStateRef) {
                        docInfo.historyStateRef = historyStateRef;
                    } else {
                        docInfo.historyStateReason = 'Photoshop 未返回该打开文档的当前历史版本，不能形成对象级变更基线。';
                    }
                }

                if (params.includeDetails || params.includeDimensions) {
                    docInfo.width = doc.width;
                    docInfo.height = doc.height;
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
