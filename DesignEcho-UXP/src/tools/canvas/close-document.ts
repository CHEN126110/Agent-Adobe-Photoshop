/**
 * 关闭文档工具
 *
 * 关闭指定文档，支持保存或不保存修改。
 * 与组合/自选备注模板使用后关闭文档的场景一致。
 */

import { Tool, ToolSchema } from '../types';

const app = require('photoshop').app;
const { core } = require('photoshop');

export class CloseDocumentTool implements Tool {
    name = 'closeDocument';

    schema: ToolSchema = {
        name: 'closeDocument',
        description: '关闭指定文档。可指定保存或不保存修改。用于批量操作后清理临时文档。',
        parameters: {
            type: 'object',
            properties: {
                documentName: {
                    type: 'string',
                    description: '要关闭的文档名称（支持模糊匹配）'
                },
                documentId: {
                    type: 'number',
                    description: '要关闭的文档 ID'
                },
                save: {
                    type: 'boolean',
                    description: '是否保存修改。默认 false 表示不保存'
                }
            }
        }
    };

    async execute(params: {
        documentName?: string;
        documentId?: number;
        save?: boolean;
    }): Promise<{
        success: boolean;
        closedDocument?: string;
        error?: string;
    }> {
        try {
            const documents = app.documents;
            if (!documents || documents.length === 0) {
                return { success: false, error: '没有打开的文档' };
            }

            let targetDoc: any = null;

            if (params.documentId) {
                for (const doc of documents) {
                    if (doc.id === params.documentId) {
                        targetDoc = doc;
                        break;
                    }
                }
            } else if (params.documentName) {
                const searchName = params.documentName.toLowerCase();
                for (const doc of documents) {
                    if (doc.name.toLowerCase().includes(searchName) ||
                        doc.name.replace(/\.[^.]+$/, '').toLowerCase() === searchName) {
                        targetDoc = doc;
                        break;
                    }
                }
            } else {
                targetDoc = app.activeDocument;
            }

            if (!targetDoc) {
                return {
                    success: false,
                    error: params.documentName
                        ? `未找到文档: ${params.documentName}`
                        : '未指定要关闭的文档'
                };
            }

            const docName = targetDoc.name;
            const shouldSave = params.save === true;

            if (documents.length <= 1) {
                return {
                    success: false,
                    error: '无法关闭最后一个文档，Photoshop 至少需要保留一个打开的文档'
                };
            }

            await core.executeAsModal(async () => {
                if (shouldSave) {
                    await targetDoc.save();
                }
                await (targetDoc as any).closeWithoutSaving();
            }, { commandName: 'DesignEcho: 关闭文档' });

            console.log(`[CloseDocument] ✅ 已关闭: ${docName} (${shouldSave ? '已保存' : '未保存'})`);

            return {
                success: true,
                closedDocument: docName
            };
        } catch (error: any) {
            console.error('[CloseDocument] Error:', error);
            return {
                success: false,
                error: error?.message || '关闭文档失败'
            };
        }
    }
}
