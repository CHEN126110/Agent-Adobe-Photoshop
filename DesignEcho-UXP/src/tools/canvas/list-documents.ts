/**
 * 列出所有文档工具
 * 
 * 获取当前 Photoshop 中所有打开的文档列表
 */

import { Tool, ToolSchema } from '../types';

const app = require('photoshop').app;
const action = require('photoshop').action;

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
                    description: '是否读取已保存文档路径；可与 includeDetails 分开启用，避免为轮询递归统计全部图层'
                },
                includeDimensions: {
                    type: 'boolean',
                    description: '是否读取文档宽高；不会递归遍历图层'
                },
                includeLayerCount: {
                    type: 'boolean',
                    description: '是否递归统计图层数；默认仅在 includeDetails=true 时启用'
                }
            }
        }
    };

    async execute(params: {
        includeDetails?: boolean;
        includePaths?: boolean;
        includeDimensions?: boolean;
        includeLayerCount?: boolean;
    }): Promise<{
        success: boolean;
        activeDocumentId?: number;
        documents?: {
            id: number;
            name: string;
            isActive: boolean;
            path?: string;
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
                    width?: number;
                    height?: number;
                    layerCount?: number;
                } = {
                    id: doc.id,
                    name: doc.name,
                    isActive: doc.id === activeDocId
                };

                if (params.includeDetails || params.includeDimensions) {
                    docInfo.width = doc.width;
                    docInfo.height = doc.height;
                }
                if (params.includeDetails || params.includeLayerCount) {
                    docInfo.layerCount = this.countLayers(doc);
                }
                if (params.includeDetails || params.includePaths) {
                    docInfo.path = await this.getDocumentPath(doc.id);
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
    private async getDocumentPath(documentId: number): Promise<string | undefined> {
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
                return fileReference;
            }
            if (fileReference && typeof fileReference === 'object') {
                const pathLike = fileReference._path || fileReference.path || fileReference.filePath || fileReference._value;
                if (typeof pathLike === 'string' && pathLike.trim()) {
                    return pathLike;
                }
            }
        } catch {
            // 未保存文档或受限文档可能读不到路径，忽略即可
        }
        return undefined;
    }
}
