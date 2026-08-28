import { Tool, ToolSchema } from '../types';
import { saveDocumentViaJsx } from '../../core/jsx-bridge';
import { getEntryFromPath } from '../../core/file-url';
import { normalizePhotoshopJpegQuality } from '../../core/jpeg-quality';
import { createToolFailureResult } from '../../core/tool-error-normalizer';
import {
    readActiveHistoryStateRef,
    sameHistoryStateRef,
    type PhotoshopHistoryStateRef
} from '../../core/photoshop-history-state-ref';

const app = require('photoshop').app;
const { core, action } = require('photoshop');
const uxpFs = require('uxp').storage.localFileSystem;

type SaveParams = {
    format?: string;
    path?: string;
    quality?: number;
    saveAs?: boolean;
    /** Runtime staging only: preserve the active document's current file association. */
    asCopy?: boolean;
    conflictPolicy?: 'overwrite' | 'fail_if_exists';
};

type SaveConflictPolicy = NonNullable<SaveParams['conflictPolicy']>;

const EDITABLE_DOCUMENT_ARTIFACT_VERSION =
    'runtime-editable-document-artifact/v1' as const;

interface EditableDocumentArtifactProof {
    version: typeof EDITABLE_DOCUMENT_ARTIFACT_VERSION;
    basis: 'uxp_post_save_file_metadata';
    path: string;
    format: 'psd' | 'psb' | 'tiff';
    byteLength: number;
    modifiedAt: number;
    documentId: number;
    canvas: {
        width: number;
        height: number;
    };
}

export interface EditableDocumentSnapshotSaveResult {
    success: true;
    savedPath: string;
    format: 'psd' | 'psb';
    documentId: number;
    editableDocumentArtifact: EditableDocumentArtifactProof;
    sourceHistoryStateRef: PhotoshopHistoryStateRef;
}

function detectFormat(format?: string, filePath?: string): string {
    const explicit = String(format || '').trim().toLowerCase();
    if (explicit) return explicit;

    const ext = ((String(filePath || '').match(/\.([a-z0-9]+)$/i) || [])[1] || '').toLowerCase();
    if (ext === 'psb') return 'psb';
    if (ext === 'psd') return 'psd';
    if (ext === 'png') return 'png';
    if (ext === 'jpg' || ext === 'jpeg') return 'jpg';
    if (ext === 'tif' || ext === 'tiff') return 'tiff';
    if (ext === 'pdf') return 'pdf';
    return 'psd';
}

/** 逐级确保目录存在：已存在直接返回；缺失就从最近存在的祖先开始 createFolder。 */
async function ensureDirectoryEntry(uxpFs: any, directoryPath: string): Promise<any> {
    try {
        const existing = await getEntryFromPath(uxpFs, directoryPath);
        if (existing) return existing;
    } catch {
        // 不存在，往下建
    }
    const normalized = String(directoryPath || '').replace(/[\\/]+$/, '');
    const slash = Math.max(normalized.lastIndexOf('\\'), normalized.lastIndexOf('/'));
    if (slash <= 0) {
        throw new Error(`保存目录不存在且无法创建：${directoryPath}`);
    }
    const parent = await ensureDirectoryEntry(uxpFs, normalized.slice(0, slash));
    const name = normalized.slice(slash + 1);
    try {
        return await parent.createFolder(name);
    } catch (error: any) {
        try {
            const raced = await parent.getEntry(name);
            if (raced && raced.isFolder === true) return raced;
        } catch {
            // 继续抛原错误
        }
        throw new Error(`创建保存目录失败：${normalized}（${error?.message || error}）`);
    }
}

async function createSaveTargetEntry(
    filePath: string,
    conflictPolicy: SaveConflictPolicy = 'overwrite',
    onCreated?: (entry: any) => void
): Promise<any> {
    const normalizedPath = String(filePath || '').trim();
    if (!normalizedPath) {
        throw new Error('Missing save path');
    }

    try {
        const existingEntry = await getEntryFromPath(uxpFs, normalizedPath) as any;
        if (existingEntry) {
            if (existingEntry.isFolder === true) {
                throw new Error(`Save target is a folder, not a file: ${normalizedPath}`);
            }
            if (conflictPolicy === 'fail_if_exists') {
                throw new Error(`save_target_exists: ${normalizedPath}`);
            }
            return existingEntry;
        }
    } catch (error: any) {
        if (/folder, not a file|save_target_exists:/i.test(String(error?.message || error))) {
            throw error;
        }
    }

    const slashIndex = Math.max(normalizedPath.lastIndexOf('\\'), normalizedPath.lastIndexOf('/'));
    const directoryPath = slashIndex >= 0 ? normalizedPath.slice(0, slashIndex) : '';
    const fileName = slashIndex >= 0 ? normalizedPath.slice(slashIndex + 1) : normalizedPath;

    if (!directoryPath || !fileName) {
        throw new Error(`Invalid save path: ${normalizedPath}`);
    }

    // 目录不存在就逐级建出来（真机：新项目没有 PSD/ 子目录，色卡做完三张才在保存这步栽掉，
    // 随后 JSX 兜底还弹出「JavaScript 代码丢失」模态框把 Photoshop 卡住）。路径是调用方定的，目录我们负责建。
    const directoryEntry = await ensureDirectoryEntry(uxpFs, directoryPath) as any;
    let fileEntry: any;
    try {
        fileEntry = await directoryEntry.createFile(fileName, {
            overwrite: conflictPolicy === 'overwrite'
        });
    } catch (error) {
        if (conflictPolicy === 'fail_if_exists') {
            try {
                const racedEntry = await directoryEntry.getEntry(fileName);
                if (racedEntry && racedEntry.isFolder !== true) {
                    throw new Error(`save_target_exists: ${normalizedPath}`);
                }
            } catch (verificationError: any) {
                if (/save_target_exists:/i.test(String(verificationError?.message || verificationError))) {
                    throw verificationError;
                }
            }
        }
        throw error;
    }
    onCreated?.(fileEntry);
    return fileEntry;
}

async function createSaveToken(
    filePath: string,
    conflictPolicy: SaveConflictPolicy = 'overwrite',
    onCreated?: (entry: any) => void
): Promise<string> {
    const fileEntry = await createSaveTargetEntry(filePath, conflictPolicy, onCreated);
    return await uxpFs.createSessionToken(fileEntry);
}

function normalizeSaveConflictPolicy(value: unknown): SaveConflictPolicy | undefined {
    if (value === undefined || value === null || String(value).trim() === '') return 'overwrite';
    if (value === 'overwrite' || value === 'fail_if_exists') return value;
    return undefined;
}

function buildSaveConflictFailure(
    code: 'save_conflict_policy_invalid' | 'save_conflict_policy_requires_path' | 'save_target_exists',
    message: string,
    conflictPolicy?: SaveConflictPolicy,
    requestedPath?: string
): {
    success: false;
    code: string;
    error: string;
    conflictPolicy?: SaveConflictPolicy;
    savedPath?: string;
} {
    return {
        success: false,
        code,
        error: message,
        ...(conflictPolicy ? { conflictPolicy } : {}),
        ...(requestedPath ? { savedPath: requestedPath } : {})
    };
}

function getSaveDescriptor(
    format: string,
    quality?: number,
    jpegFallbackQuality: number = 12
): any {
    const normalized = detectFormat(format);
    switch (normalized) {
        case 'psd':
            return {
                _obj: 'photoshop35Format',
                maximizeCompatibility: true
            };
        case 'psb':
            return {
                _obj: 'largeDocumentFormat',
                maximizeCompatibility: true
            };
        case 'png':
            return {
                _obj: 'PNGFormat',
                PNGInterlaceType: { _enum: 'PNGInterlaceType', _value: 'PNGInterlaceNone' },
                compression: 6
            };
        case 'jpeg':
        case 'jpg':
            return {
                _obj: 'JPEG',
                quality: normalizePhotoshopJpegQuality(quality, jpegFallbackQuality)
            };
        case 'tif':
        case 'tiff':
            return {
                _obj: 'TIFF',
                byteOrder: { _enum: 'platform', _value: 'IBMPC' },
                LZWCompression: true
            };
        case 'pdf':
            return {
                _obj: 'photoshopPDFFormat',
                pDFPresetFilename: 'High Quality Print',
                preserveEditing: true
            };
        default:
            throw new Error(`Unsupported save format: ${format}`);
    }
}

function toDocumentPixels(value: any): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    try {
        if (typeof value?.as === 'function') {
            const px = Number(value.as('px'));
            if (Number.isFinite(px)) return px;
        }
    } catch {
        // ignore and fall back
    }
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
        return numeric;
    }
    throw new Error('Unable to read document pixel size');
}

async function readEditableDocumentArtifactProof(
    filePath: string,
    format: 'psd' | 'psb' | 'tiff',
    doc: any,
    saveStartedAt: number
): Promise<EditableDocumentArtifactProof> {
    const normalizedPath = String(filePath || '').trim();
    const entry = await getEntryFromPath(uxpFs, normalizedPath) as any;
    if (entry?.isFile === false) {
        throw new Error(`保存目标不是文件：${normalizedPath}`);
    }
    const metadata = typeof entry?.getMetadata === 'function'
        ? await entry.getMetadata()
        : undefined;
    const byteLength = Number(metadata?.size);
    const rawModifiedAt = metadata?.dateModified;
    let modifiedAt: number;
    if (rawModifiedAt instanceof Date) {
        modifiedAt = rawModifiedAt.getTime();
    } else if (typeof rawModifiedAt === 'number') {
        modifiedAt = rawModifiedAt;
    } else {
        modifiedAt = Date.parse(String(rawModifiedAt || ''));
    }
    const documentId = Number(doc?.id);
    const width = toDocumentPixels(doc?.width);
    const height = toDocumentPixels(doc?.height);
    if (!Number.isSafeInteger(byteLength) || byteLength <= 0) {
        throw new Error(`保存后的可编辑文档不存在或为空：${normalizedPath}`);
    }
    if (!Number.isFinite(modifiedAt) || modifiedAt < saveStartedAt - 2_000) {
        throw new Error(`保存后的可编辑文档不是本轮新写入的结果：${normalizedPath}`);
    }
    if (!Number.isSafeInteger(documentId) || documentId <= 0
        || !Number.isFinite(width) || width <= 0
        || !Number.isFinite(height) || height <= 0) {
        throw new Error('无法把保存后的可编辑文档绑定到当前 Photoshop 文档');
    }
    return {
        version: EDITABLE_DOCUMENT_ARTIFACT_VERSION,
        basis: 'uxp_post_save_file_metadata',
        path: normalizedPath,
        format,
        byteLength,
        modifiedAt,
        documentId,
        canvas: { width, height }
    };
}

function getRasterExportExtension(filePath: string): string {
    const ext = ((String(filePath || '').match(/\.([a-z0-9]+)$/i) || [])[1] || '').toLowerCase();
    if (ext === 'png') return 'png';
    if (ext === 'jpg' || ext === 'jpeg') return 'jpg';
    return '';
}

function normalizeRasterExportFormat(format: unknown, outputPath?: string): 'png' | 'jpg' {
    const pathFormat = getRasterExportExtension(String(outputPath || ''));
    if (pathFormat) return pathFormat as 'png' | 'jpg';
    const normalized = String(format || '').trim().toLowerCase();
    return normalized === 'jpg' || normalized === 'jpeg' ? 'jpg' : 'png';
}

function requireRasterExportSourceHistoryStateRef(doc: any): PhotoshopHistoryStateRef {
    const activeDocument = app.activeDocument;
    if (!activeDocument || Number(activeDocument.id) !== Number(doc?.id)) {
        throw new Error('导出前活动文档已变化，未写入目标文件。');
    }
    const sourceHistoryStateRef = readActiveHistoryStateRef(activeDocument);
    if (!sourceHistoryStateRef) {
        throw new Error('导出前无法读取 Photoshop 文档版本，未写入目标文件。');
    }
    return sourceHistoryStateRef;
}

function verifyRasterExportSourceHistoryStateRef(input: {
    document: any;
    expected: PhotoshopHistoryStateRef;
    emittedDocumentId?: number;
}): PhotoshopHistoryStateRef {
    const activeDocument = app.activeDocument;
    const afterExportHistoryStateRef = activeDocument
        && Number(activeDocument.id) === Number(input.document?.id)
        ? readActiveHistoryStateRef(activeDocument)
        : undefined;
    if (!Number.isSafeInteger(input.emittedDocumentId)
        || Number(input.emittedDocumentId) !== input.expected.documentId
        || !sameHistoryStateRef(input.expected, afterExportHistoryStateRef)) {
        throw new Error('导出完成后无法确认文件仍来自同一 Photoshop 文档版本；文件可能已写出，但不会计为可靠交付。');
    }
    return input.expected;
}

function appendSuffixBeforeExtension(filePath: string, suffix: string): string {
    const cleanSuffix = String(suffix || '').trim();
    if (!cleanSuffix) return filePath;
    return String(filePath || '').replace(/(\.[a-z0-9]+)$/i, `${cleanSuffix}$1`);
}

async function batchPlaySave(descriptor: any, options: { token?: string; dialog?: 'dontDisplay' }) {
    const command: any = {
        _obj: 'save',
        as: descriptor,
        _options: { dialogOptions: options.dialog }
    };
    if (options.token) {
        command.in = { _kind: 'local', _path: options.token };
        command.lowerCase = true;
        command.saveStage = { _enum: 'saveStageType', _value: 'saveBegin' };
    }
    await action.batchPlay([command], { synchronousExecution: true });
}

/**
 * 在调用方已经持有 Photoshop modal 的时候，保存当前分层画面的可编辑快照。
 * 该函数不建立第二个 modal，也不决定业务输出路径；调用方必须在清理临时图层之前调用。
 */
export async function saveEditableDocumentSnapshotInModal(input: {
    document: any;
    path: string;
}): Promise<EditableDocumentSnapshotSaveResult> {
    const savedPath = String(input.path || '').trim();
    const format = detectFormat(undefined, savedPath);
    if (format !== 'psd' && format !== 'psb') {
        throw new Error(`可编辑快照只支持 PSD/PSB：${savedPath}`);
    }
    const documentId = Number(input.document?.id);
    if (!Number.isSafeInteger(documentId) || documentId <= 0
        || Number(app.activeDocument?.id) !== documentId) {
        throw new Error('可编辑快照保存前活动文档已变化。');
    }
    const sourceHistoryStateRef = readActiveHistoryStateRef(input.document);
    if (!sourceHistoryStateRef) {
        throw new Error('可编辑快照保存前无法读取 Photoshop 文档版本。');
    }
    const saveStartedAt = Date.now();
    const token = await createSaveToken(savedPath, 'overwrite');
    await batchPlaySave(getSaveDescriptor(format), { token, dialog: 'dontDisplay' });
    const editableDocumentArtifact = await readEditableDocumentArtifactProof(
        savedPath,
        format,
        input.document,
        saveStartedAt
    );
    return {
        success: true,
        savedPath,
        format,
        documentId,
        editableDocumentArtifact,
        sourceHistoryStateRef
    };
}

/**
 * 以「存储副本」（asCopy=true）静默导出 JPEG/PNG。
 *
 * PS v22+ 不允许对带图层文档「存储为 JPEG」（只能「存储副本」）。batchPlay
 * {_obj:'save', as:{_obj:'JPEG'}} 不带 copy 标志时 PS 无法静默执行，即使
 * dialogOptions:'dontDisplay' 也会弹出「存储为」对话框，且对话框里没有 JPEG
 * 选项、默认落在 PSD（2026-08-25 真机确证；已验证修法见
 * core/design-asset-export.ts 的预览保存段）。DOM saveAs 的 asCopy=true 是
 * 带图层文档静默出 JPEG 的唯一合法通道；PNG 的「存储为」在部分版本虽被允许，
 * 一并走副本通道以消除版本差异。
 */
async function saveRasterCopyViaDom(
    modalDocument: any,
    fileEntry: any,
    format: 'png' | 'jpg',
    jpegQuality: number
): Promise<void> {
    if (format === 'jpg') {
        if (typeof modalDocument?.saveAs?.jpg !== 'function') {
            throw new Error('导出 JPEG 失败：当前 Photoshop 运行时缺少 Document.saveAs.jpg 接口，无法以「存储副本」方式静默导出。请确认 Photoshop 版本满足插件最低要求。');
        }
        await modalDocument.saveAs.jpg(fileEntry, { quality: jpegQuality }, true);
        return;
    }
    if (typeof modalDocument?.saveAs?.png !== 'function') {
        throw new Error('导出 PNG 失败：当前 Photoshop 运行时缺少 Document.saveAs.png 接口，无法以「存储副本」方式静默导出。请确认 Photoshop 版本满足插件最低要求。');
    }
    await modalDocument.saveAs.png(fileEntry, {}, true);
}

export class SaveDocumentTool implements Tool {
    name = 'saveDocument';

    schema: ToolSchema = {
        name: 'saveDocument',
        description: 'Save the active document as PSD, PSB, or another export format. Supports deterministic save-as when path is provided.',
        parameters: {
            type: 'object',
            properties: {
                format: {
                    type: 'string',
                    enum: ['psd', 'psb', 'png', 'jpeg', 'jpg', 'tiff', 'pdf'],
                    description: 'Save format. If omitted, format is inferred from path or defaults to psd.'
                },
                path: {
                    type: 'string',
                    description: 'Absolute output path. When provided, the document is saved silently to this path.'
                },
                quality: {
                    type: 'number',
                    description: 'JPEG quality: 1-12 uses Photoshop\'s native scale; 13-100 is percentage-style and maps to 1-12. Omit for native quality 12 (maximum).'
                },
                saveAs: {
                    type: 'boolean',
                    description: 'Deprecated for Agent execution. Provide path for deterministic Save As; no-path dialog save is refused.'
                },
                asCopy: {
                    type: 'boolean',
                    description: 'Runtime staging option for PSD/PSB only. Saves an editable copy without changing the active document file association.'
                },
                conflictPolicy: {
                    type: 'string',
                    enum: ['overwrite', 'fail_if_exists'],
                    description: 'Output conflict policy. overwrite is the default and preserves existing behavior; fail_if_exists requires an explicit path and refuses to replace an existing file.'
                }
            }
        }
    };

    async execute(params: SaveParams): Promise<{
        success: boolean;
        savedPath?: string;
        format?: string;
        documentId?: number;
        editableDocumentArtifact?: EditableDocumentArtifactProof;
        sourceHistoryStateRef?: PhotoshopHistoryStateRef;
        code?: string;
        conflictPolicy?: SaveConflictPolicy;
        error?: string;
    }> {
        const requestedPath = String(params.path || '').trim();
        const conflictPolicy = normalizeSaveConflictPolicy(params.conflictPolicy);
        let newlyCreatedTargetEntry: any;
        let batchSaveCommitted = false;
        if (!conflictPolicy) {
            return buildSaveConflictFailure(
                'save_conflict_policy_invalid',
                `Unsupported save conflictPolicy: ${String(params.conflictPolicy || '')}`
            );
        }
        if (conflictPolicy === 'fail_if_exists' && !requestedPath) {
            return buildSaveConflictFailure(
                'save_conflict_policy_requires_path',
                'saveDocument conflictPolicy=fail_if_exists requires an explicit path.',
                conflictPolicy
            );
        }
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return createToolFailureResult({
                    toolName: this.name,
                    error: new Error('No active document'),
                    params
                });
            }

            const format = detectFormat(params.format, requestedPath);
            if (params.asCopy === true
                && (!requestedPath || (format !== 'psd' && format !== 'psb'))) {
                return createToolFailureResult({
                    toolName: this.name,
                    error: new Error('saveDocument asCopy=true requires an explicit PSD/PSB path.'),
                    params
                });
            }

            if (requestedPath && (format === 'png' || format === 'jpg' || format === 'jpeg')) {
                const jsxFormat = format === 'png' ? 'png' : 'jpg';
                const sourceHistoryStateRef = requireRasterExportSourceHistoryStateRef(doc);
                const jsxResult = await saveDocumentViaJsx(requestedPath, jsxFormat, doc.name, {
                    jpegQuality: normalizePhotoshopJpegQuality(params.quality, 12),
                    conflictPolicy,
                    expectedSourceDocumentId: sourceHistoryStateRef.documentId
                });
                const verifiedSourceHistoryStateRef = verifyRasterExportSourceHistoryStateRef({
                    document: doc,
                    expected: sourceHistoryStateRef,
                    emittedDocumentId: jsxResult.sourceDocumentId
                });
                return {
                    success: true,
                    savedPath: jsxResult.filePath,
                    format: jsxFormat,
                    documentId: Number(doc.id),
                    sourceHistoryStateRef: verifiedSourceHistoryStateRef
                };
            }

            const descriptor = getSaveDescriptor(format, params.quality);
            let sourceHistoryStateRef: PhotoshopHistoryStateRef | undefined;
            const saveStartedAt = Date.now();

            await core.executeAsModal(async () => {
                const modalDocument = app.activeDocument;
                if (!modalDocument || Number(modalDocument.id) !== Number(doc.id)) {
                    throw new Error('Active document changed before save commit');
                }
                sourceHistoryStateRef = readActiveHistoryStateRef(modalDocument);
                if (requestedPath) {
                    if (params.asCopy === true) {
                        const targetEntry = await createSaveTargetEntry(
                            requestedPath,
                            conflictPolicy,
                            (entry) => {
                                if (conflictPolicy === 'fail_if_exists') {
                                    newlyCreatedTargetEntry = entry;
                                }
                            }
                        );
                        const saveOptions = {
                            embedColorProfile: true,
                            layers: true,
                            maximizeCompatibility: true
                        };
                        const saveAsCapability = (modalDocument as any)?.saveAs as {
                            psd?: (entry: any, options: typeof saveOptions, asCopy: boolean) => Promise<void>;
                            psb?: (entry: any, options: typeof saveOptions, asCopy: boolean) => Promise<void>;
                        } | undefined;
                        if (format === 'psb') {
                            if (typeof saveAsCapability?.psb !== 'function') {
                                throw new Error('当前 Photoshop 运行时不支持 PSB 存储副本。');
                            }
                            await saveAsCapability.psb(targetEntry, saveOptions, true);
                        } else {
                            if (typeof saveAsCapability?.psd !== 'function') {
                                throw new Error('当前 Photoshop 运行时不支持 PSD 存储副本。');
                            }
                            await saveAsCapability.psd(targetEntry, saveOptions, true);
                        }
                        batchSaveCommitted = true;
                        return;
                    }
                    const token = await createSaveToken(
                        requestedPath,
                        conflictPolicy,
                        (entry) => {
                            if (conflictPolicy === 'fail_if_exists') {
                                newlyCreatedTargetEntry = entry;
                            }
                        }
                    );
                    await batchPlaySave(descriptor, { token, dialog: 'dontDisplay' });
                    batchSaveCommitted = true;
                    return;
                }

                const hasSavedPath = (doc as any).saved;
                if ((format === 'psd' || format === 'psb') && !params.saveAs && hasSavedPath && format === 'psd') {
                    await action.batchPlay([
                        {
                            _obj: 'save',
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], { synchronousExecution: true });
                    return;
                }

                throw new Error('saveDocument requires path when the current document cannot be saved silently; refusing to open Photoshop save dialog.');
            }, { commandName: `DesignEcho: Save Document (${format.toUpperCase()})` });

            const editableDocumentArtifact = requestedPath
                && (format === 'psd' || format === 'psb' || format === 'tiff')
                ? await readEditableDocumentArtifactProof(
                    requestedPath,
                    format,
                    doc,
                    saveStartedAt
                )
                : undefined;
            return {
                success: true,
                savedPath: requestedPath || doc.name,
                format,
                documentId: Number(doc.id),
                ...(editableDocumentArtifact ? { editableDocumentArtifact } : {}),
                sourceHistoryStateRef
            };
        } catch (error) {
            console.error('[SaveDocument] Error:', error);

            if (conflictPolicy === 'fail_if_exists'
                && newlyCreatedTargetEntry
                && !batchSaveCommitted) {
                try {
                    await newlyCreatedTargetEntry.delete();
                } catch (cleanupError) {
                    console.warn('[SaveDocument] Failed to clean uncommitted save target:', cleanupError);
                }
            }

            const format = detectFormat(params.format, requestedPath);
            if (conflictPolicy === 'fail_if_exists'
                && /save_target_exists:/i.test(String((error as any)?.message || error))) {
                return buildSaveConflictFailure(
                    'save_target_exists',
                    `保存目标已存在，已按 fail_if_exists 拒绝覆盖：${requestedPath}`,
                    conflictPolicy,
                    requestedPath
                );
            }
            // 2026-08-19：删除 JSX 保存兜底（用户原则：兜底=上一层有问题，不是治本）。目录缺失已由
            // ensureDirectoryEntry 在主路径解决；主路径失败就把真实错误交回，不再切通道重试（那条兜底在真机
            // 弹出「JavaScript 代码丢失」模态框把 Photoshop 卡住）。

            return createToolFailureResult({
                toolName: this.name,
                error,
                params
            });
        }
    }
}

export class QuickExportTool implements Tool {
    name = 'quickExport';

    schema: ToolSchema = {
        name: 'quickExport',
        description: 'Quick export the active document or selected layers as PNG/JPEG.',
        parameters: {
            type: 'object',
            properties: {
                format: {
                    type: 'string',
                    enum: ['png', 'jpeg', 'jpg'],
                    description: 'Export format.'
                },
                scale: {
                    type: 'number',
                    description: 'Scale ratio (0.1-4).'
                },
                quality: {
                    type: 'number',
                    description: 'JPEG quality: 1-12 uses Photoshop\'s native scale; 13-100 is percentage-style and maps to 1-12. Omit for the existing percentage-style default 80 (native quality 10).'
                },
                exportLayers: {
                    type: 'boolean',
                    description: 'Export selected layers instead of the full document.'
                },
                outputPath: {
                    type: 'string',
                    description: 'Absolute output directory or complete PNG/JPEG file path. Required for silent Agent export.'
                },
                suffix: {
                    type: 'string',
                    description: 'Optional filename suffix.'
                }
            }
        }
    };

    async execute(params: {
        format?: string;
        scale?: number;
        quality?: number;
        exportLayers?: boolean;
        suffix?: string;
        outputPath?: string;
    }): Promise<{
        success: boolean;
        exportedFiles?: string[];
        outputPath?: string;
        /** 导出成功时的最终文件绝对路径（含自动生成的文件名/后缀），与 exportedFiles[0] 一致 */
        filePath?: string;
        /** 实际使用的导出格式（png/jpg，经 normalizeRasterExportFormat 归一） */
        format?: 'png' | 'jpg';
        sourceHistoryStateRef?: PhotoshopHistoryStateRef;
        error?: string;
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return createToolFailureResult({
                    toolName: this.name,
                    error: new Error('No active document'),
                    params
                });
            }

            const quality = params.quality ?? 80;
            const suffix = params.suffix || '';
            const outputPath = String(params.outputPath || '').trim();
            const format = normalizeRasterExportFormat(params.format, outputPath);
            const scale = Number(params.scale || 1);

            if (params.exportLayers) {
                return createToolFailureResult({
                    toolName: this.name,
                    error: new Error('quickExport exportLayers is not supported in silent Agent export; use a layer-specific export tool with an explicit output path.'),
                    params
                });
            }

            if (Number.isFinite(scale) && scale !== 1) {
                return createToolFailureResult({
                    toolName: this.name,
                    error: new Error('quickExport scale is not supported by the silent export path; use batchExport presets for resized outputs.'),
                    params
                });
            }

            if (!outputPath) {
                return createToolFailureResult({
                    toolName: this.name,
                    error: new Error('quickExport requires outputPath for silent export; refusing to open Photoshop export dialog.'),
                    params
                });
            }

            const exported = await this.exportToPath(doc, outputPath, format, quality, suffix);

            return {
                success: true,
                exportedFiles: [exported.filePath],
                outputPath: outputPath || undefined,
                filePath: exported.filePath,
                format,
                sourceHistoryStateRef: exported.sourceHistoryStateRef
            };
        } catch (error) {
            console.error('[QuickExport] Error:', error);
            return createToolFailureResult({
                toolName: this.name,
                error,
                params
            });
        }
    }

    private async exportToPath(
        doc: any,
        outputPath: string,
        format: string,
        quality: number,
        suffix: string
    ): Promise<{ filePath: string; sourceHistoryStateRef?: PhotoshopHistoryStateRef }> {
        const sourceHistoryStateRef = requireRasterExportSourceHistoryStateRef(doc);
        const explicitFileFormat = getRasterExportExtension(outputPath);
        if (explicitFileFormat) {
            const filePath = appendSuffixBeforeExtension(outputPath, suffix);
            const jsxResult = await saveDocumentViaJsx(filePath, explicitFileFormat === 'png' ? 'png' : 'jpg', doc.name, {
                jpegQuality: normalizePhotoshopJpegQuality(quality, 80),
                expectedSourceDocumentId: sourceHistoryStateRef.documentId
            });
            return {
                filePath,
                sourceHistoryStateRef: verifyRasterExportSourceHistoryStateRef({
                    document: doc,
                    expected: sourceHistoryStateRef,
                    emittedDocumentId: jsxResult.sourceDocumentId
                })
            };
        }

        const docName = doc.name?.replace(/\.[^.]+$/, '') || 'export';
        const ext = format === 'png' ? '.png' : '.jpg';
        const fileName = `${docName}${suffix}${ext}`;
        const filePath = `${outputPath.replace(/[\\/]+$/, '')}\\${fileName}`;
        const jsxResult = await saveDocumentViaJsx(filePath, format === 'png' ? 'png' : 'jpg', doc.name, {
            jpegQuality: normalizePhotoshopJpegQuality(quality, 80),
            expectedSourceDocumentId: sourceHistoryStateRef.documentId
        });
        return {
            filePath,
            sourceHistoryStateRef: verifyRasterExportSourceHistoryStateRef({
                document: doc,
                expected: sourceHistoryStateRef,
                emittedDocumentId: jsxResult.sourceDocumentId
            })
        };
    }

}

export class BatchExportTool implements Tool {
    name = 'batchExport';

    schema: ToolSchema = {
        name: 'batchExport',
        description: 'Batch export multiple sizes for e-commerce deliverables.',
        parameters: {
            type: 'object',
            properties: {
                presets: {
                    type: 'array',
                    description: 'Export presets with width, height, and suffix.'
                },
                format: {
                    type: 'string',
                    enum: ['png', 'jpeg', 'jpg'],
                    description: 'Export format.'
                },
                quality: {
                    type: 'number',
                    description: 'JPEG quality: 1-12 uses Photoshop\'s native scale; 13-100 is percentage-style and maps to 1-12. Omit for the existing percentage-style default 85 (native quality 10).'
                },
                outputDirectory: {
                    type: 'string',
                    description: 'Absolute output directory for silent batch export.'
                }
            },
            required: ['outputDirectory']
        }
    };

    async execute(params: {
        presets?: Array<{ width: number; height: number; suffix: string }>;
        format?: string;
        quality?: number;
        outputDirectory?: string;
    }): Promise<any> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return createToolFailureResult({
                    toolName: this.name,
                    error: new Error('No active document'),
                    params
                });
            }

            const outputDirectory = String(params.outputDirectory || '').trim();
            if (!outputDirectory) {
                return createToolFailureResult({
                    toolName: this.name,
                    error: new Error('batchExport requires outputDirectory'),
                    params
                });
            }

            const presets = params.presets || [
                { width: 800, height: 800, suffix: '_main' },
                { width: 400, height: 400, suffix: '_sku' },
                { width: 750, height: 0, suffix: '_detail' }
            ];
            const format = String(params.format || 'jpeg').toLowerCase();
            const quality = params.quality ?? 85;
            if (!Array.isArray(presets) || presets.length === 0) {
                return { success: false, error: 'batchExport requires at least one preset' };
            }

            const normalizedPresets = presets.map((preset, index) => {
                const width = Number(preset?.width || 0);
                const height = Number(preset?.height || 0);
                const suffix = String(preset?.suffix || '').trim();
                if ((!Number.isFinite(width) || width < 0) || (!Number.isFinite(height) || height < 0)) {
                    throw new Error(`Invalid preset dimensions at index ${index}`);
                }
                if (width <= 0 && height <= 0) {
                    throw new Error(`Preset at index ${index} must define width or height greater than 0`);
                }
                if (!suffix) {
                    throw new Error(`Preset at index ${index} requires a non-empty suffix`);
                }
                return { width, height, suffix };
            });

            const ext = format === 'png' ? 'png' : 'jpg';
            const docName = String(doc.name || 'export').replace(/\.[^.]+$/, '');
            const exportedFiles: Array<{
                filePath: string;
                width: number;
                height: number;
                suffix: string;
            }> = [];
            const sourceHistoryStateRef = requireRasterExportSourceHistoryStateRef(doc);

            for (const preset of normalizedPresets) {
                const resolved = this.resolvePresetDimensions(doc, preset);
                const filePath = `${outputDirectory.replace(/[\\/]+$/, '')}\\${docName}${preset.suffix}.${ext}`;
                const jsxResult = await saveDocumentViaJsx(filePath, ext === 'png' ? 'png' : 'jpg', doc.name, {
                    width: resolved.width,
                    height: resolved.height,
                    jpegQuality: normalizePhotoshopJpegQuality(quality, 85),
                    expectedSourceDocumentId: sourceHistoryStateRef.documentId
                });
                verifyRasterExportSourceHistoryStateRef({
                    document: doc,
                    expected: sourceHistoryStateRef,
                    emittedDocumentId: jsxResult.sourceDocumentId
                });
                exportedFiles.push({
                    filePath,
                    width: resolved.width,
                    height: resolved.height,
                    suffix: preset.suffix
                });
            }

            return {
                success: true,
                entityType: 'export-batch',
                documentId: Number(doc.id),
                name: doc.name,
                outputDirectory,
                format: ext,
                exportedCount: exportedFiles.length,
                exportedFiles,
                sourceHistoryStateRef,
                sourceHistoryStateVerified: true,
                message: `Exported ${exportedFiles.length} files to ${outputDirectory}`,
                exported: exportedFiles.length
            };
        } catch (error) {
            console.error('[BatchExport] Error:', error);
            return createToolFailureResult({
                toolName: this.name,
                error,
                params
            });
        }
    }

    private resolvePresetDimensions(
        doc: any,
        preset: { width: number; height: number; suffix: string }
    ): { width: number; height: number } {
        const documentWidth = toDocumentPixels(doc.width);
        const documentHeight = toDocumentPixels(doc.height);
        let targetWidth = preset.width;
        let targetHeight = preset.height;

        if (targetHeight === 0) {
            targetHeight = Math.round((targetWidth / documentWidth) * documentHeight);
        } else if (targetWidth === 0) {
            targetWidth = Math.round((targetHeight / documentHeight) * documentWidth);
        }
        return { width: targetWidth, height: targetHeight };
    }

}

export class SmartSaveTool implements Tool {
    name = 'smartSave';

    schema: ToolSchema = {
        name: 'smartSave',
        description: 'Create a recovery checkpoint for the active document. Final user-facing delivery must use saveDocument or an export tool.',
        parameters: {
            type: 'object',
            properties: {
                exportFormat: {
                    type: 'string',
                    enum: ['psd', 'psb', 'jpg', 'png'],
                    description: 'Primary save format or additional export format.'
                },
                exportQuality: {
                    type: 'number',
                    description: 'JPEG quality: 1-12 uses Photoshop\'s native scale; 13-100 is percentage-style and maps to 1-12.'
                },
                path: {
                    type: 'string',
                    description: 'Absolute output path for deterministic save-as.'
                }
            }
        }
    };

    async execute(params: {
        exportFormat?: string;
        exportQuality?: number;
        path?: string;
    }): Promise<{
        success: boolean;
        message?: string;
        savedPath?: string;
        exportedPath?: string;
        sourceHistoryStateRef?: PhotoshopHistoryStateRef;
        error?: string;
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return createToolFailureResult({
                    toolName: this.name,
                    error: new Error('No active document'),
                    params
                });
            }

            const saveFormat = detectFormat(params.exportFormat, params.path);
            let savedPath = '';
            let sourceHistoryStateRef: PhotoshopHistoryStateRef | undefined;

            await core.executeAsModal(async () => {
                const modalDocument = app.activeDocument;
                if (!modalDocument || Number(modalDocument.id) !== Number(doc.id)) {
                    throw new Error('Active document changed before smart save commit');
                }
                sourceHistoryStateRef = readActiveHistoryStateRef(modalDocument);
                if (params.path) {
                    if (saveFormat === 'jpg' || saveFormat === 'jpeg' || saveFormat === 'png') {
                        // 带图层文档不能走 batchPlay save（会弹「存储为」对话框），见 saveRasterCopyViaDom
                        const targetEntry = await createSaveTargetEntry(params.path);
                        await saveRasterCopyViaDom(
                            modalDocument,
                            targetEntry,
                            saveFormat === 'png' ? 'png' : 'jpg',
                            normalizePhotoshopJpegQuality(params.exportQuality, 80)
                        );
                        savedPath = params.path;
                        return;
                    }
                    const token = await createSaveToken(params.path);
                    await batchPlaySave(getSaveDescriptor(saveFormat, params.exportQuality, 80), {
                        token,
                        dialog: 'dontDisplay'
                    });
                    savedPath = params.path;
                    return;
                }

                const isSaved = (doc as any).saved !== false;
                if (isSaved && saveFormat === 'psd') {
                    await action.batchPlay([
                        {
                            _obj: 'save',
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], { synchronousExecution: true });
                    savedPath = doc.name;
                    return;
                }

                throw new Error(
                    'smartSave requires path when the current document cannot be saved silently; refusing to open Photoshop save dialog.'
                );
            }, { commandName: 'DesignEcho: Smart Save' });

            let exportedPath = '';
            if (params.exportFormat && params.exportFormat !== 'psd' && params.exportFormat !== 'psb') {
                if (!params.path) {
                    return createToolFailureResult({
                        toolName: this.name,
                        error: new Error('smartSave requires path for silent export formats; refusing to open Photoshop export dialog.'),
                        params
                    });
                }

                const exportFormat = params.exportFormat === 'png' ? 'png' : 'jpg';
                const slashIndex = Math.max(params.path.lastIndexOf('\\'), params.path.lastIndexOf('/'));
                const directoryPath = slashIndex >= 0 ? params.path.slice(0, slashIndex) : '';
                const baseName = slashIndex >= 0 ? params.path.slice(slashIndex + 1) : params.path;
                const exportBaseName = baseName.replace(/\.[^.]+$/, '') || doc.name.replace(/\.(psd|psb)$/i, '');
                const exportPath = `${directoryPath}\\${exportBaseName}.${exportFormat}`;
                const exportEntry = await createSaveTargetEntry(exportPath);

                await core.executeAsModal(async () => {
                    const exportModalDocument = app.activeDocument;
                    const exportSourceRef = readActiveHistoryStateRef(exportModalDocument);
                    if (!sameHistoryStateRef(sourceHistoryStateRef, exportSourceRef)) {
                        throw new Error('Document version changed between smart save and export');
                    }
                    // 带图层文档不能走 batchPlay save（会弹「存储为」对话框），见 saveRasterCopyViaDom
                    await saveRasterCopyViaDom(
                        exportModalDocument,
                        exportEntry,
                        exportFormat,
                        normalizePhotoshopJpegQuality(params.exportQuality, 85)
                    );
                    exportedPath = exportPath;
                }, { commandName: `DesignEcho: Export ${String(params.exportFormat).toUpperCase()}` });
            }

            return {
                success: true,
                message: exportedPath
                    ? `Saved: ${savedPath}; Exported: ${exportedPath}`
                    : `Saved: ${savedPath}`,
                savedPath,
                exportedPath: exportedPath || undefined,
                sourceHistoryStateRef
            };
        } catch (error) {
            console.error('[SmartSave] Error:', error);
            return createToolFailureResult({
                toolName: this.name,
                error,
                params
            });
        }
    }
}
