import { action, core } from 'photoshop';
import { storage } from 'uxp';
import { normalizeLocalFilePath } from './file-url';

export interface JsxBridgeResult<T = any> {
    raw: any;
    message: string;
    data: T | null;
}

const JSX_RESULT_PREFIX = '__DESIGNECHO_RESULT__';

function normalizeJsxMessage(message: any): { message: string; data: any | null } {
    const normalized = typeof message === 'string' ? message : String(message ?? '');
    if (!normalized) {
        return { message: '', data: null };
    }

    if (normalized.startsWith(JSX_RESULT_PREFIX)) {
        const payload = normalized.slice(JSX_RESULT_PREFIX.length);
        const data: Record<string, string | boolean> = {};

        for (const part of payload.split('&')) {
            if (!part) continue;
            const separatorIndex = part.indexOf('=');
            const rawKey = separatorIndex >= 0 ? part.slice(0, separatorIndex) : part;
            const rawValue = separatorIndex >= 0 ? part.slice(separatorIndex + 1) : '';
            const key = decodeURIComponent(rawKey);
            const value = decodeURIComponent(rawValue);
            data[key] = key === 'success' ? value === '1' : value;
        }

        return {
            message: normalized,
            data
        };
    }

    try {
        return {
            message: normalized,
            data: JSON.parse(normalized)
        };
    } catch {
        return {
            message: normalized,
            data: null
        };
    }
}

function escapeForJsxString(input: string): string {
    return String(input || '')
        .replace(/\\/g, '/')
        .replace(/'/g, "\\'")
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n');
}

function getJsxBridgePrelude(): string {
    return `
var __dePrevDialogs = app.displayDialogs;
app.displayDialogs = DialogModes.NO;
var __deOutput = '';
function __deEncode(value) {
    return encodeURIComponent(String(value === undefined || value === null ? '' : value));
}
function __deResult(fields) {
    var parts = [];
    for (var key in fields) {
        if (!fields.hasOwnProperty(key)) continue;
        if (fields[key] === undefined || fields[key] === null) continue;
        parts.push(__deEncode(key) + '=' + __deEncode(fields[key]));
    }
    __deOutput = '${JSX_RESULT_PREFIX}' + parts.join('&');
    return __deOutput;
}
`;
}

async function runJsxToken(scriptToken: string, commandName: string): Promise<JsxBridgeResult> {
    let result: any;
    await core.executeAsModal(async () => {
        result = await action.batchPlay([
            {
                _obj: 'AdobeScriptAutomation Scripts',
                javaScript: {
                    _path: scriptToken,
                    _kind: 'local'
                },
                javaScriptMessage: 'undefined',
                _options: {
                    dialogOptions: 'dontDisplay'
                }
            } as any
        ], {
            synchronousExecution: true
        } as any);
    }, { commandName });

    const payload = Array.isArray(result) ? result[0] : result;
    const parsed = normalizeJsxMessage((payload as any)?.javaScriptMessage);
    return {
        raw: payload,
        message: parsed.message,
        data: parsed.data
    };
}

async function getPluginEntryByRelativePath(relativePath: string): Promise<any> {
    const pluginFolder: any = await storage.localFileSystem.getPluginFolder();
    const segments = String(relativePath || '')
        .replace(/[\\/]+/g, '/')
        .split('/')
        .filter(Boolean);

    let currentEntry: any = pluginFolder;
    for (const segment of segments) {
        if (!currentEntry?.getEntry) {
            throw new Error(`Cannot resolve plugin entry: ${relativePath}`);
        }
        currentEntry = await currentEntry.getEntry(segment);
    }

    return currentEntry;
}

export async function runJsxCode(code: string, commandName = 'Run JSX Code'): Promise<JsxBridgeResult> {
    const tempFolder = await storage.localFileSystem.getTemporaryFolder();
    const scriptFile = await tempFolder.createFile(`designecho-${Date.now()}.jsx`, { overwrite: true });

    try {
        await scriptFile.write(code, { format: storage.formats.utf8 });
        const token = await storage.localFileSystem.createSessionToken(scriptFile);
        return await runJsxToken(token, commandName);
    } finally {
        try {
            await scriptFile.delete();
        } catch {
            // Ignore temp cleanup failure.
        }
    }
}

export async function runBundledJsxFile(relativePath: string, commandName = 'Run Bundled JSX'): Promise<JsxBridgeResult> {
    const scriptEntry = await getPluginEntryByRelativePath(relativePath);
    const token = await storage.localFileSystem.createSessionToken(scriptEntry);
    return await runJsxToken(token, commandName);
}

export async function openDocumentWithJsx(filePath: string): Promise<{ success: true; documentName: string; filePath: string }> {
    const normalizedPath = normalizeLocalFilePath(filePath);
    const jsx = `
try {
    ${getJsxBridgePrelude()}
    var target = new File('${escapeForJsxString(normalizedPath)}');
    if (!target.exists) {
        throw new Error('File not found: ' + target.fsName);
    }
    app.open(target);
    __deResult({
        success: 1,
        documentName: app.activeDocument ? app.activeDocument.name : target.name,
        filePath: target.fsName
    });
} catch (error) {
    __deResult({
        success: 0,
        error: String(error && error.message ? error.message : error)
    });
} finally {
    try {
        app.displayDialogs = __dePrevDialogs;
    } catch (restoreError) {}
}
__deOutput;
`;

    const result = await runJsxCode(jsx, 'Open File via JSX');
    if (result.data?.success) {
        return result.data;
    }

    throw new Error(result.data?.error || result.message || `JSX open failed: ${normalizedPath}`);
}

type SaveDocumentViaJsxOptions = {
    jpegQuality?: number;
    maxDimension?: number;
    width?: number;
    height?: number;
    conflictPolicy?: 'overwrite' | 'fail_if_exists';
    /** UXP 在派发前冻结的源文档 ID；JSX 写文件前必须核对实际选中的 sourceDoc。 */
    expectedSourceDocumentId?: number;
};

function getJsxSaveOptions(
    format: 'psd' | 'psb' | 'png' | 'jpg',
    options?: SaveDocumentViaJsxOptions
): { optionCtor: string; setup: string } {
    if (format === 'psb') {
        return {
            optionCtor: 'LargeDocumentFormatOptions',
            setup: 'options.maximizeCompatibility = true;'
        };
    }

    if (format === 'png') {
        return {
            optionCtor: 'PNGSaveOptions',
            setup: ''
        };
    }

    if (format === 'jpg') {
        const jpegQualityRaw = Number(options?.jpegQuality);
        const jpegQuality = Number.isFinite(jpegQualityRaw)
            ? Math.max(0, Math.min(12, Math.round(jpegQualityRaw)))
            : 8;
        return {
            optionCtor: 'JPEGSaveOptions',
            setup: `options.quality = ${jpegQuality}; options.embedColorProfile = true; options.matte = MatteType.NONE;`
        };
    }

    return {
        optionCtor: 'PhotoshopSaveOptions',
        setup: 'options.maximizeCompatibility = true;'
    };
}

export async function saveDocumentViaJsx(
    filePath: string,
    format: 'psd' | 'psb' | 'png' | 'jpg',
    documentName?: string,
    options?: SaveDocumentViaJsxOptions
): Promise<{ success: true; filePath: string; sourceDocumentId?: number }> {
    const normalizedPath = normalizeLocalFilePath(filePath);
    const { optionCtor, setup } = getJsxSaveOptions(format, options);
    const maxDimensionRaw = Number(options?.maxDimension);
    const maxDimension = Number.isFinite(maxDimensionRaw)
        ? Math.max(0, Math.floor(maxDimensionRaw))
        : 0;
    const widthRaw = Number(options?.width);
    const heightRaw = Number(options?.height);
    const explicitWidth = Number.isFinite(widthRaw) ? Math.max(0, Math.floor(widthRaw)) : 0;
    const explicitHeight = Number.isFinite(heightRaw) ? Math.max(0, Math.floor(heightRaw)) : 0;
    const shouldResizeOnSave =
        explicitWidth > 0 ||
        explicitHeight > 0 ||
        ((format === 'jpg' || format === 'png') && maxDimension > 0);
    const failIfExists = options?.conflictPolicy === 'fail_if_exists';
    const expectedSourceDocumentId = Number(options?.expectedSourceDocumentId);
    const documentLookup = documentName
        ? `
    var targetDoc = null;
    for (var i = 0; i < app.documents.length; i++) {
        if (app.documents[i].name === '${escapeForJsxString(documentName)}') {
            targetDoc = app.documents[i];
            break;
        }
    }
    if (!targetDoc) {
        throw new Error('Document not found: ${escapeForJsxString(documentName)}');
    }
`
        : `
    var targetDoc = app.activeDocument;
`;
    const jsx = `
try {
    ${getJsxBridgePrelude()}
    if (!app.documents.length) {
        throw new Error('No active document');
    }
    var sourceDoc = null;
    var saveDoc = null;
${documentLookup}
    sourceDoc = targetDoc;
    var sourceDocumentId = '';
    try {
        sourceDocumentId = sourceDoc ? sourceDoc.id : '';
    } catch (sourceIdentityError) {}
    if (${Number.isSafeInteger(expectedSourceDocumentId) ? expectedSourceDocumentId : 0} > 0
        && Number(sourceDocumentId) !== ${Number.isSafeInteger(expectedSourceDocumentId) ? expectedSourceDocumentId : 0}) {
        throw new Error('JSX 保存前源文档已变化，未写入目标文件。');
    }
    saveDoc = sourceDoc;
    if (${shouldResizeOnSave ? 'true' : 'false'}) {
        var sourceWidth = 0;
        var sourceHeight = 0;
        try {
            sourceWidth = Number(sourceDoc.width.as('px'));
            sourceHeight = Number(sourceDoc.height.as('px'));
        } catch (sizeError) {
            sourceWidth = Number(sourceDoc.width);
            sourceHeight = Number(sourceDoc.height);
        }
        var longestSide = Math.max(sourceWidth || 0, sourceHeight || 0);
        var targetWidth = ${explicitWidth};
        var targetHeight = ${explicitHeight};
        if (targetWidth <= 0 && targetHeight <= 0 && ${maxDimension} > 0 && longestSide > ${maxDimension}) {
            var resizeScale = ${maxDimension} / longestSide;
            targetWidth = Math.max(1, Math.round((sourceWidth || 1) * resizeScale));
            targetHeight = Math.max(1, Math.round((sourceHeight || 1) * resizeScale));
        } else if (targetWidth > 0 && targetHeight <= 0) {
            targetHeight = Math.max(1, Math.round((targetWidth / (sourceWidth || 1)) * (sourceHeight || 1)));
        } else if (targetHeight > 0 && targetWidth <= 0) {
            targetWidth = Math.max(1, Math.round((targetHeight / (sourceHeight || 1)) * (sourceWidth || 1)));
        }
        if (targetWidth > 0 && targetHeight > 0 && (targetWidth !== sourceWidth || targetHeight !== sourceHeight)) {
            saveDoc = sourceDoc.duplicate();
            app.activeDocument = saveDoc;
            saveDoc.resizeImage(
                UnitValue(targetWidth, 'px'),
                UnitValue(targetHeight, 'px'),
                undefined,
                ResampleMethod.BICUBICSHARPER
            );
        }
    }
    var target = new File('${escapeForJsxString(normalizedPath)}');
    if (${failIfExists ? 'true' : 'false'} && target.exists) {
        throw new Error('save_target_exists: ${escapeForJsxString(normalizedPath)}');
    }
    if (!target.parent.exists) {
        target.parent.create();
    }
    var options = new ${optionCtor}();
    ${setup}
    saveDoc.saveAs(target, options, true, Extension.LOWERCASE);
    __deResult({
        success: 1,
        filePath: target.fsName,
        documentName: sourceDoc ? sourceDoc.name : '',
        sourceDocumentId: sourceDocumentId,
        format: '${format}'
    });
} catch (error) {
    __deResult({
        success: 0,
        error: String(error && error.message ? error.message : error),
        format: '${format}'
    });
} finally {
    try {
        if (saveDoc && sourceDoc && saveDoc !== sourceDoc) {
            saveDoc.close(SaveOptions.DONOTSAVECHANGES);
            app.activeDocument = sourceDoc;
        }
    } catch (cleanupError) {}
    try {
        app.displayDialogs = __dePrevDialogs;
    } catch (restoreError) {}
}
__deOutput;
`;

    const result = await runJsxCode(jsx, 'Save Document via JSX');
    if (result.data?.success) {
        const documentId = Number(result.data.sourceDocumentId);
        const resultData = { ...result.data };
        delete resultData.sourceDocumentId;
        return {
            ...resultData,
            ...(Number.isSafeInteger(documentId) && documentId > 0
                ? { sourceDocumentId: documentId }
                : {})
        };
    }

    throw new Error(result.data?.error || result.message || `JSX save failed: ${normalizedPath}`);
}

export async function saveNamedDocumentWithJsx(
    documentName: string,
    filePath: string,
    format: 'psd' | 'psb' | 'png' | 'jpg',
    options?: SaveDocumentViaJsxOptions
): Promise<{ success: true; filePath: string }> {
    return await saveDocumentViaJsx(filePath, format, documentName, options);
}
