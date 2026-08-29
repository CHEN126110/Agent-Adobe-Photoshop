import {
    describeDesignDocumentNature,
    type DesignDocumentNature
} from './design-document-nature';
import {
    readPhotoshopHistoryStateRef,
    type PhotoshopHistoryStateRef
} from './photoshop-history-state-ref';

export type PhotoshopDocumentPathState = 'saved' | 'unsaved' | 'unavailable' | 'not_requested';
export type PhotoshopDocumentEditState = 'clean' | 'dirty' | 'unknown';
export type PhotoshopDocumentProjectAffinity = 'current_project' | 'outside_current_project' | 'unknown';

export interface PhotoshopDocumentInventoryEntry extends Record<string, unknown> {
    id: number;
    name: string;
    isActive: boolean;
    path?: string;
    pathState: PhotoshopDocumentPathState;
    editState: PhotoshopDocumentEditState;
    editStateReason?: string;
    historyStateRef?: PhotoshopHistoryStateRef;
    historyStateReason?: string;
    projectAffinity: PhotoshopDocumentProjectAffinity;
    projectRelativePath?: string;
    projectAffinityReason: string;
    documentNature: DesignDocumentNature;
}

export interface PhotoshopDocumentInventoryResult extends Record<string, unknown> {
    success: boolean;
    documents: PhotoshopDocumentInventoryEntry[];
    documentInventory: {
        version: 'photoshop-document-inventory/v1';
        currentProjectPath?: string;
        documentCount: number;
        facts: string;
    };
}

export interface FilesystemProjectAffinityFact {
    affinity: PhotoshopDocumentProjectAffinity;
    relativePath?: string;
    reason: string;
}

function normalizeFilesystemPath(value: unknown): string {
    const text = String(value || '').trim();
    if (!text) return '';
    const withoutScheme = text.replace(/^file:\/{2,3}/i, '');
    return withoutScheme.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export function classifyFilesystemProjectAffinity(
    candidatePath: unknown,
    projectPathValue: unknown
): FilesystemProjectAffinityFact {
    const projectPath = normalizeFilesystemPath(projectPathValue);
    const candidate = normalizeFilesystemPath(candidatePath);
    if (!projectPath) {
        return { affinity: 'unknown', reason: '当前没有已确认的项目根目录。' };
    }
    if (!candidate) {
        return { affinity: 'unknown', reason: '候选文件真实路径不可用。' };
    }
    if (candidate === projectPath) {
        return { affinity: 'current_project', relativePath: '.', reason: '文件路径就是当前项目根目录。' };
    }
    if (candidate.startsWith(`${projectPath}/`)) {
        return {
            affinity: 'current_project',
            relativePath: candidate.slice(projectPath.length + 1),
            reason: '文件路径位于当前项目根目录内。'
        };
    }
    return {
        affinity: 'outside_current_project',
        reason: '文件路径不在当前项目根目录内；其来源必须由用户附件、导入收据或明确外部路径事实解释。'
    };
}

function resolveProjectAffinity(input: {
    documentPath?: unknown;
    pathState: PhotoshopDocumentPathState;
    projectPath?: unknown;
}): {
    affinity: PhotoshopDocumentProjectAffinity;
    relativePath?: string;
    reason: string;
} {
    const projectPath = normalizeFilesystemPath(input.projectPath);
    const documentPath = normalizeFilesystemPath(input.documentPath);
    if (!projectPath) {
        return { affinity: 'unknown', reason: '当前没有已确认的项目根目录。' };
    }
    if (input.pathState !== 'saved' || !documentPath) {
        return {
            affinity: 'unknown',
            reason: input.pathState === 'unsaved'
                ? '文档尚未保存到本地路径，无法判断项目归属。'
                : '文档真实路径不可用，无法判断项目归属。'
        };
    }
    return classifyFilesystemProjectAffinity(documentPath, projectPath);
}

function normalizePathState(document: Record<string, unknown>): PhotoshopDocumentPathState {
    const explicit = document.pathState;
    if (explicit === 'saved' || explicit === 'unsaved' || explicit === 'unavailable' || explicit === 'not_requested') {
        return explicit;
    }
    return String(document.path || '').trim() ? 'saved' : 'not_requested';
}

function normalizeEditState(document: Record<string, unknown>): PhotoshopDocumentEditState {
    const explicit = document.editState;
    if (explicit === 'clean' || explicit === 'dirty' || explicit === 'unknown') {
        return explicit;
    }
    if (typeof document.hasUnsavedChanges === 'boolean') {
        return document.hasUnsavedChanges ? 'dirty' : 'clean';
    }
    return 'unknown';
}

export function enrichPhotoshopDocumentInventory(
    input: Record<string, unknown>,
    projectPath?: string
): PhotoshopDocumentInventoryResult {
    const sourceDocuments = Array.isArray(input.documents) ? input.documents : [];
    const documents = sourceDocuments
        .filter((document): document is Record<string, unknown> => Boolean(document) && typeof document === 'object')
        .map((document): PhotoshopDocumentInventoryEntry => {
            const pathState = normalizePathState(document);
            const editState = normalizeEditState(document);
            const historyStateRef = readPhotoshopHistoryStateRef(document);
            const affinity = resolveProjectAffinity({
                documentPath: document.path,
                pathState,
                projectPath
            });
            return {
                ...document,
                id: Number(document.id),
                name: String(document.name || ''),
                isActive: document.isActive === true,
                pathState,
                editState,
                ...(typeof document.editStateReason === 'string' && document.editStateReason.trim()
                    ? { editStateReason: document.editStateReason.trim() }
                    : {}),
                ...(historyStateRef ? { historyStateRef } : {}),
                ...(typeof document.historyStateReason === 'string' && document.historyStateReason.trim()
                    ? { historyStateReason: document.historyStateReason.trim() }
                    : {}),
                projectAffinity: affinity.affinity,
                ...(affinity.relativePath ? { projectRelativePath: affinity.relativePath } : {}),
                projectAffinityReason: affinity.reason,
                documentNature: describeDesignDocumentNature({
                    name: document.name,
                    layerCount: document.layerCount ?? document.layers,
                    width: document.width,
                    height: document.height
                })
            };
        });

    return {
        ...input,
        success: input.success !== false,
        documents,
        documentInventory: {
            version: 'photoshop-document-inventory/v1',
            ...(projectPath ? { currentProjectPath: projectPath } : {}),
            documentCount: documents.length,
            facts: 'pathState 表示是否有本地路径，editState 表示自上次保存后是否仍有修改；historyStateRef 在文档保持打开期间绑定 Photoshop 对象版本；projectAffinity 由 Harness 根据真实路径计算。documentNature 是结构提示，不是权限、任务所有权或关闭授权。'
        }
    };
}
