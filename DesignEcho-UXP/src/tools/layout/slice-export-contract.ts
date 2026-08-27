/**
 * Pure contract for detail-page slice delivery.
 *
 * The Skill supplies exact paths. This module only validates path containment,
 * naming safety, artifact coverage and no-overwrite policy; it never chooses
 * which screens exist or how they should look.
 */

export type SliceExportFormat = 'jpeg' | 'png';
export type SliceExportConflictPolicy = 'fail_if_exists' | 'new_version';

export interface SliceExportScreenIdentity {
    id: number;
    name: string;
    type: string;
    index: number;
}

export interface SliceExportExpectedFile {
    screenId: string | number;
    path: string;
}

export interface SliceExportConfigInput {
    projectRoot?: string;
    outputDir?: string;
    format?: SliceExportFormat;
    quality?: number;
    namingPattern?: string;
    createSubfolder?: boolean;
    subfolder?: string;
    conflictPolicy?: SliceExportConflictPolicy;
    deliveryPlanDigest?: string;
    expectedFiles?: SliceExportExpectedFile[];
}

export interface NormalizedSliceExportConfig {
    projectRoot: string;
    outputDir: string;
    format: SliceExportFormat;
    quality: number;
    namingPattern: string;
    createSubfolder: boolean;
    subfolder: string;
    conflictPolicy: SliceExportConflictPolicy;
    deliveryPlanDigest: string;
    expectedFiles: SliceExportExpectedFile[];
}

export interface SliceExportPlannedFile {
    screenId: string;
    index: number;
    path: string;
}

export interface SliceExportPlan {
    status: 'ready' | 'blocked';
    config?: NormalizedSliceExportConfig;
    outputRoot?: string;
    files: SliceExportPlannedFile[];
    blockers: string[];
}

export interface SliceExportRollbackPlan {
    rollbackPaths: string[];
    blockers: string[];
}

const ALLOWED_NAMING_TOKENS = new Set(['index', 'name', 'type']);
const DELIVERY_PLAN_DIGEST = /^skill-delivery-plan\/v\d+:[a-f0-9]{64}$/;
const WINDOWS_RESERVED_SEGMENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function cleanText(value: unknown): string {
    return String(value || '').trim();
}

function isWindowsPath(value: string): boolean {
    return /^[a-z]:[\\/]/i.test(value) || /^\\\\/.test(value);
}

function isAbsolutePath(value: string): boolean {
    return isWindowsPath(value) || /^\//.test(value);
}

function normalizePathForCompare(value: string): string {
    const raw = cleanText(value);
    const windows = isWindowsPath(raw);
    const normalized = raw
        .replace(/\\/g, '/')
        .replace(/\/{2,}/g, '/')
        .replace(/\/$/g, '');
    return windows ? normalized.toLowerCase() : normalized;
}

function hasUnsafePathSegment(value: string): boolean {
    const normalized = cleanText(value).replace(/\\/g, '/');
    const withoutPrefix = normalized
        .replace(/^[a-z]:\//i, '')
        .replace(/^\/+/, '');
    const segments = withoutPrefix.split('/').filter(Boolean);
    return segments.length === 0 || segments.some((segment) => (
        segment === '.'
        || segment === '..'
        || /[<>:"|?*\x00-\x1F]/.test(segment)
        || /[. ]$/.test(segment)
        || WINDOWS_RESERVED_SEGMENT.test(segment)
    ));
}

function isPathInsideRoot(root: string, candidate: string): boolean {
    const rootKey = normalizePathForCompare(root);
    const candidateKey = normalizePathForCompare(candidate);
    return Boolean(rootKey)
        && Boolean(candidateKey)
        && candidateKey.startsWith(`${rootKey}/`);
}

function joinPath(root: string, child: string): string {
    const separator = isWindowsPath(root) ? '\\' : '/';
    const base = cleanText(root).replace(/[\\/]+$/g, '');
    const relative = cleanText(child).replace(/^[\\/]+|[\\/]+$/g, '');
    return `${base}${separator}${relative.replace(/[\\/]+/g, separator)}`;
}

function parentDirectory(filePath: string): string {
    const value = cleanText(filePath);
    const index = Math.max(value.lastIndexOf('\\'), value.lastIndexOf('/'));
    return index > 0 ? value.slice(0, index) : '';
}

function validateAbsoluteDirectory(value: unknown, label: string): {
    value?: string;
    blockers: string[];
} {
    const path = cleanText(value).replace(/[\\/]+$/g, '');
    if (!path) return { blockers: [`${label} 不能为空。`] };
    if (!isAbsolutePath(path) || hasUnsafePathSegment(path)) {
        return { blockers: [`${label} 必须是无 traversal 的绝对目录。`] };
    }
    return { value: path, blockers: [] };
}

function validateNamingPattern(value: unknown): {
    value?: string;
    blockers: string[];
} {
    const pattern = cleanText(value) || '{index}_{name}';
    if (pattern === '.'
        || pattern === '..'
        || /[<>:"/\\|?*\x00-\x1F]/.test(pattern)
        || /[. ]$/.test(pattern)) {
        return { blockers: ['namingPattern 只能生成单个安全文件名，不能包含路径分隔符或 traversal。'] };
    }
    const tokens = Array.from(pattern.matchAll(/\{([^{}]+)\}/g)).map((match) => match[1]);
    const unknownTokens = tokens.filter((token) => !ALLOWED_NAMING_TOKENS.has(token));
    const withoutTokens = pattern.replace(/\{[^{}]+\}/g, '');
    if (unknownTokens.length > 0 || withoutTokens.includes('{') || withoutTokens.includes('}')) {
        return {
            blockers: [`namingPattern 只支持 {index}、{name}、{type}；无效 token：${unknownTokens.join('、') || '括号不完整'}。`]
        };
    }
    return { value: pattern, blockers: [] };
}

function validateSubfolder(value: unknown, createSubfolder: boolean): {
    value?: string;
    blockers: string[];
} {
    const subfolder = cleanText(value) || 'detail-page-slices';
    if (!createSubfolder) return { value: subfolder, blockers: [] };
    if (subfolder === '.'
        || subfolder === '..'
        || /[<>:"/\\|?*\x00-\x1F]/.test(subfolder)
        || /[. ]$/.test(subfolder)
        || WINDOWS_RESERVED_SEGMENT.test(subfolder)) {
        return { blockers: ['subfolder 必须是单个安全目录名，不能包含路径分隔符或 traversal。'] };
    }
    return { value: subfolder, blockers: [] };
}

function sanitizeFileNamePart(value: unknown): string {
    return cleanText(value)
        .replace(/[\\/:*?"<>|\x00-\x1F]/g, '_')
        .replace(/\s+/g, ' ')
        .replace(/[. ]+$/g, '')
        .trim();
}

function generateLegacyFileName(
    screen: SliceExportScreenIdentity,
    index: number,
    pattern: string,
    format: SliceExportFormat
): string {
    const paddedIndex = String(index + 1).padStart(2, '0');
    const safeName = sanitizeFileNamePart(screen.name) || `screen-${index + 1}`;
    const typePart = String(screen.type || '').split('_')[1] || screen.type || 'screen';
    const safeType = sanitizeFileNamePart(typePart) || 'screen';
    const base = pattern
        .replace(/\{index\}/g, paddedIndex)
        .replace(/\{name\}/g, safeName)
        .replace(/\{type\}/g, safeType);
    const safeBase = sanitizeFileNamePart(base);
    if (!safeBase || safeBase === '.' || safeBase === '..') {
        throw new Error(`第 ${index + 1} 屏 namingPattern 渲染后文件名为空或不安全。`);
    }
    return `${safeBase}.${format === 'jpeg' ? 'jpg' : 'png'}`;
}

function buildExpectedFilePlan(input: {
    screens: readonly SliceExportScreenIdentity[];
    expectedFiles: readonly SliceExportExpectedFile[];
    outputRoot: string;
    format: SliceExportFormat;
}): { files: SliceExportPlannedFile[]; blockers: string[] } {
    const blockers: string[] = [];
    if (input.expectedFiles.length !== input.screens.length) {
        blockers.push(`expectedFiles 必须逐屏覆盖全部 ${input.screens.length} 屏。`);
    }
    const expectedByScreenId = new Map<string, string>();
    for (const [index, item] of input.expectedFiles.entries()) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            blockers.push(`expectedFiles[${index}] 必须是对象。`);
            continue;
        }
        const unexpectedKeys = Object.keys(item).filter((key) => !['screenId', 'path'].includes(key));
        if (unexpectedKeys.length > 0) {
            blockers.push(`expectedFiles[${index}] 包含未授权字段 ${unexpectedKeys.join('、')}。`);
        }
        const screenId = cleanText(item.screenId);
        const path = cleanText(item.path);
        if (!screenId || expectedByScreenId.has(screenId)) {
            blockers.push(`expectedFiles[${index}] 的 screenId 为空或重复。`);
            continue;
        }
        if (!isAbsolutePath(path)
            || hasUnsafePathSegment(path)
            || !isPathInsideRoot(input.outputRoot, path)) {
            blockers.push(`expectedFiles[${index}] 必须位于已验证的详情页输出目录内。`);
            continue;
        }
        const expectedExtension = input.format === 'jpeg' ? /\.jpe?g$/i : /\.png$/i;
        if (!expectedExtension.test(path)) {
            blockers.push(`expectedFiles[${index}] 的扩展名与 ${input.format} 不一致。`);
            continue;
        }
        expectedByScreenId.set(screenId, path);
    }
    const files = input.screens.flatMap((screen, index) => {
        const screenId = cleanText(screen.id);
        const path = expectedByScreenId.get(screenId);
        if (!path) {
            blockers.push(`expectedFiles 缺少屏 ${screenId || index + 1}。`);
            return [];
        }
        return [{ screenId, index, path }];
    });
    const normalizedPaths = files.map((item) => normalizePathForCompare(item.path));
    if (new Set(normalizedPaths).size !== normalizedPaths.length) {
        blockers.push('expectedFiles 产生了重复目标路径。');
    }
    return { files, blockers };
}

export function buildSliceExportPlan(
    screens: readonly SliceExportScreenIdentity[],
    input: SliceExportConfigInput | undefined
): SliceExportPlan {
    const blockers: string[] = [];
    const projectRoot = validateAbsoluteDirectory(input?.projectRoot, 'projectRoot');
    const outputDir = validateAbsoluteDirectory(input?.outputDir, 'outputDir');
    blockers.push(...projectRoot.blockers, ...outputDir.blockers);
    if (projectRoot.value
        && outputDir.value
        && normalizePathForCompare(projectRoot.value) !== normalizePathForCompare(outputDir.value)
        && !isPathInsideRoot(projectRoot.value, outputDir.value)) {
        blockers.push('outputDir 必须位于当前项目目录内。');
    }
    const format: SliceExportFormat = input?.format === 'png' ? 'png' : 'jpeg';
    const quality = Number(input?.quality);
    const namingPattern = validateNamingPattern(input?.namingPattern);
    const createSubfolder = input?.createSubfolder === true;
    const subfolder = validateSubfolder(input?.subfolder, createSubfolder);
    blockers.push(...namingPattern.blockers, ...subfolder.blockers);
    const conflictPolicy = input?.conflictPolicy;
    if (conflictPolicy !== 'fail_if_exists' && conflictPolicy !== 'new_version') {
        blockers.push('conflictPolicy 必须是 fail_if_exists 或 new_version；详情页切片不允许静默覆盖。');
    }
    const deliveryPlanDigest = cleanText(input?.deliveryPlanDigest);
    if (!DELIVERY_PLAN_DIGEST.test(deliveryPlanDigest)) {
        blockers.push('deliveryPlanDigest 缺失或格式无效。');
    }
    if (!Array.isArray(input?.expectedFiles) || input.expectedFiles.length === 0) {
        blockers.push('expectedFiles 必须提供 Skill 在执行前冻结的逐屏精确文件计划。');
    }
    if (!Array.isArray(screens) || screens.length < 2 || screens.length > 64) {
        blockers.push('详情页切片必须覆盖 2–64 个完整屏。');
    }
    const screenIds = Array.isArray(screens)
        ? screens.map((screen) => cleanText(screen?.id))
        : [];
    if (screenIds.some((screenId) => !screenId)
        || new Set(screenIds).size !== screenIds.length) {
        blockers.push('screens 必须具有不重复的稳定 screen id。');
    }
    if (blockers.length > 0
        || !projectRoot.value
        || !outputDir.value
        || !namingPattern.value
        || !subfolder.value
        || !conflictPolicy) {
        return { status: 'blocked', files: [], blockers: Array.from(new Set(blockers)) };
    }
    const outputRoot = createSubfolder
        ? joinPath(outputDir.value, subfolder.value)
        : outputDir.value;
    if (!isPathInsideRoot(projectRoot.value, outputRoot)
        && normalizePathForCompare(projectRoot.value) !== normalizePathForCompare(outputRoot)) {
        return {
            status: 'blocked',
            files: [],
            blockers: ['切片输出目录解析后越出了当前项目目录。']
        };
    }
    const expected = buildExpectedFilePlan({
        screens,
        expectedFiles: input.expectedFiles || [],
        outputRoot,
        format
    });
    blockers.push(...expected.blockers);
    if (blockers.length > 0) {
        return { status: 'blocked', files: [], blockers: Array.from(new Set(blockers)) };
    }
    return {
        status: 'ready',
        config: {
            projectRoot: projectRoot.value,
            outputDir: outputDir.value,
            format,
            quality: Number.isFinite(quality)
                ? Math.max(1, Math.min(12, Math.round(quality)))
                : 10,
            namingPattern: namingPattern.value,
            createSubfolder,
            subfolder: subfolder.value,
            conflictPolicy,
            deliveryPlanDigest,
            expectedFiles: input.expectedFiles || []
        },
        outputRoot,
        files: expected.files,
        blockers: []
    };
}

export function buildLegacySliceExportFileName(
    screen: SliceExportScreenIdentity,
    index: number,
    pattern: string,
    format: SliceExportFormat
): string {
    return generateLegacyFileName(screen, index, pattern, format);
}

export function readSliceExportParentDirectory(filePath: string): string {
    return parentDirectory(filePath);
}

/**
 * Decide which paths belong to an incomplete invocation and may be removed.
 * A path observed before the run is never a rollback target, even if a caller
 * accidentally includes it in createdPaths.
 */
export function buildSliceExportRollbackPlan(input: {
    createdPaths: readonly string[];
    preexistingPaths: readonly string[];
    deliverySucceeded: boolean;
    sourceStateRestored: boolean;
}): SliceExportRollbackPlan {
    if (input.deliverySucceeded && input.sourceStateRestored) {
        return { rollbackPaths: [], blockers: [] };
    }
    const preexisting = new Set(input.preexistingPaths.map(normalizePathForCompare));
    const blockers: string[] = [];
    const rollbackPaths: string[] = [];
    const seen = new Set<string>();
    for (const path of input.createdPaths) {
        const value = cleanText(path);
        const key = normalizePathForCompare(value);
        if (!value || !key || seen.has(key)) continue;
        seen.add(key);
        if (preexisting.has(key)) {
            blockers.push(`拒绝把运行前已存在的文件加入回滚：${value}`);
            continue;
        }
        rollbackPaths.push(value);
    }
    return { rollbackPaths, blockers };
}
