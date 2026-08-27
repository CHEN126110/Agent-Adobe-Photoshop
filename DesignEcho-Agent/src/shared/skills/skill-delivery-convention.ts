/**
 * Skill-owned delivery organization contract.
 *
 * The Agent or user selects this value. Skill code compiles it into exact artifact
 * paths; Harness code may validate safety and receipts, but must not infer a
 * convention from directory counts or use it to decide visual content.
 */

import { canonicalize, sha256Hex } from '../agent-runtime-v5/content-hash';
import {
    normalizeStableSourceReferenceList
} from '../stable-source-reference';

export const SKILL_DELIVERY_CONVENTION_VERSION = 'skill-delivery-convention/v0' as const;
export const SKILL_DELIVERY_PLAN_VERSION = 'skill-delivery-plan/v1' as const;
export const SKILL_DELIVERY_PLAN_DIGEST_VERSION = SKILL_DELIVERY_PLAN_VERSION;
export const LEGACY_SKILL_DELIVERY_PLAN_DIGEST_VERSION = 'skill-delivery-plan/v0' as const;

export type SkillDeliveryConventionProvenance =
    | 'user'
    | 'confirmed_project'
    | 'agent_selected'
    | 'agent_examples'
    | 'skill_fallback';

export type SkillDeliveryPairing =
    | 'editable_only'
    | 'raster_only'
    | 'one_editable_per_raster'
    | 'one_master_many_rasters';

export type SkillDeliveryVersionPolicy =
    | 'replace_exact_set'
    | 'new_version'
    | 'fail_if_exists';

export type SkillDeliveryEditableFormat = 'psd' | 'psb' | 'tif';
export type SkillDeliveryRasterFormat = 'jpg' | 'jpeg' | 'png';

export interface SkillDeliveryEditableConvention {
    projectRelativeRoot: string;
    folderPattern?: string;
    fileNamePattern: string;
    format: SkillDeliveryEditableFormat;
}

export interface SkillDeliveryRasterConvention {
    projectRelativeRoot: string;
    folderPattern?: string;
    fileNamePattern: string;
    format: SkillDeliveryRasterFormat;
}

export interface SkillDeliveryConvention {
    version: typeof SKILL_DELIVERY_CONVENTION_VERSION;
    provenance: SkillDeliveryConventionProvenance;
    supportRefs: string[];
    editable?: SkillDeliveryEditableConvention;
    raster?: SkillDeliveryRasterConvention;
    pairing: SkillDeliveryPairing;
    versionPolicy: SkillDeliveryVersionPolicy;
}

export interface SkillDeliveryConventionResolution {
    status: 'not_provided' | 'ready' | 'blocked';
    convention?: SkillDeliveryConvention;
    blockers: string[];
}

export interface SkillDeliveryPatternValues {
    defaultName: string;
    index?: number;
    size?: number | string;
    colors?: string;
    template?: string;
    kind?: string;
    row?: number;
    name?: string;
    version?: string;
    screen?: string;
}

export interface SkillDeliveryPatternResult {
    status: 'ready' | 'blocked';
    value?: string;
    blockers: string[];
}

export type SkillDeliveryPlanArtifactKind = 'editable_document' | 'raster_export';
export type SkillDeliveryPlanArtifactFormat = SkillDeliveryEditableFormat | SkillDeliveryRasterFormat;
export type SkillDeliveryPlanSourceHistoryRole =
    | 'same_document_revision'
    | 'per_artifact_revision';

export interface SkillDeliveryPlanArtifact {
    artifactId: string;
    kind: SkillDeliveryPlanArtifactKind;
    pairId: string;
    order: number;
    path: string;
    format: SkillDeliveryPlanArtifactFormat;
    sourceHistoryRole: SkillDeliveryPlanSourceHistoryRole;
}

export interface SkillDeliveryPlan {
    version: typeof SKILL_DELIVERY_PLAN_VERSION;
    convention: SkillDeliveryConvention;
    artifacts: SkillDeliveryPlanArtifact[];
    digest: string;
    boundaries: {
        skillOwnsConvention: true;
        agentOrUserOwnsSelection: true;
        projectRelativeRootsOnly: true;
        artifactRolesAndPairingBound: true;
        containsNoVisualDecisions: true;
        grantsOverwritePermission: false;
    };
}

export interface SkillDeliveryPlanResolution {
    status: 'ready' | 'blocked';
    plan?: SkillDeliveryPlan;
    blockers: string[];
}

const ROOT_KEYS = new Set([
    'version',
    'provenance',
    'supportRefs',
    'editable',
    'raster',
    'pairing',
    'versionPolicy'
]);
const TARGET_KEYS = new Set([
    'projectRelativeRoot',
    'folderPattern',
    'fileNamePattern',
    'format'
]);
const PROVENANCES = new Set<SkillDeliveryConventionProvenance>([
    'user',
    'confirmed_project',
    'agent_selected',
    'agent_examples',
    'skill_fallback'
]);
const MODEL_PROVENANCES = new Set<SkillDeliveryConventionProvenance>([
    'agent_selected'
]);
const PAIRINGS = new Set<SkillDeliveryPairing>([
    'editable_only',
    'raster_only',
    'one_editable_per_raster',
    'one_master_many_rasters'
]);
const VERSION_POLICIES = new Set<SkillDeliveryVersionPolicy>([
    'replace_exact_set',
    'new_version',
    'fail_if_exists'
]);
const EDITABLE_FORMATS = new Set<SkillDeliveryEditableFormat>(['psd', 'psb', 'tif']);
const RASTER_FORMATS = new Set<SkillDeliveryRasterFormat>(['jpg', 'jpeg', 'png']);
const ALLOWED_PATTERN_TOKENS = new Set([
    'defaultName',
    'index',
    'size',
    'colors',
    'template',
    'kind',
    'row',
    'name',
    'version',
    'screen'
]);
const WINDOWS_RESERVED_SEGMENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const DELIVERY_PLAN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const DELIVERY_PLAN_SOURCE_HISTORY_ROLES = new Set<SkillDeliveryPlanSourceHistoryRole>([
    'same_document_revision',
    'per_artifact_revision'
]);
const DELIVERY_SUPPORT_REF_PREFIXES = [
    'user-instruction',
    'document',
    'brand-guideline',
    'project-brief',
    'knowledge',
    'design-memory'
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value: unknown): string {
    return String(value || '').trim();
}

function listUnexpectedKeys(
    value: Record<string, unknown>,
    allowed: ReadonlySet<string>,
    label: string
): string[] {
    return Object.keys(value)
        .filter((key) => !allowed.has(key))
        .map((key) => `${label} 不允许字段 ${key}；交付约定不能携带视觉、选图、色彩、字号或其他设计决策。`);
}

function normalizeProjectRelativeRoot(value: unknown, label: string): {
    value?: string;
    blockers: string[];
} {
    const raw = cleanString(value).replace(/\\/g, '/').replace(/\/+$/g, '');
    if (!raw) return { blockers: [`${label} 缺少项目相对目录。`] };
    if (/^(?:[a-z]:|\/|\\)/i.test(raw)) {
        return { blockers: [`${label} 必须是项目相对目录，不能是绝对路径。`] };
    }
    const segments = raw.split('/').filter(Boolean);
    if (segments.length === 0
        || segments.some((segment) => (
            segment === '.'
            || segment === '..'
            || /[<>:"|?*\x00-\x1F]/.test(segment)
            || /[. ]$/.test(segment)
            || WINDOWS_RESERVED_SEGMENT.test(segment)
        ))) {
        return { blockers: [`${label} 包含不安全的项目相对路径片段。`] };
    }
    return { value: segments.join('/'), blockers: [] };
}

function normalizeNamingPattern(value: unknown, label: string, required: boolean): {
    value?: string;
    blockers: string[];
} {
    const pattern = cleanString(value);
    if (!pattern) {
        return required ? { blockers: [`${label} 缺少命名 pattern。`] } : { blockers: [] };
    }
    if (pattern === '.'
        || pattern === '..'
        || /[<>:"/\\|?*\x00-\x1F]/.test(pattern)
        || /[. ]$/.test(pattern)) {
        return { blockers: [`${label} 包含不安全的文件名字符或路径分隔符。`] };
    }
    const tokens = Array.from(pattern.matchAll(/\{([^{}]+)\}/g)).map((match) => match[1]);
    const unknownTokens = tokens.filter((token) => !ALLOWED_PATTERN_TOKENS.has(token));
    const patternWithoutTokens = pattern.replace(/\{[^{}]+\}/g, '');
    if (unknownTokens.length > 0
        || patternWithoutTokens.includes('{')
        || patternWithoutTokens.includes('}')) {
        return {
            blockers: [`${label} 包含不支持的 token：${unknownTokens.join('、') || '括号不完整'}。`]
        };
    }
    return { value: pattern, blockers: [] };
}

function normalizeSupportRefs(value: unknown): { refs: string[]; blockers: string[] } {
    const normalized = normalizeStableSourceReferenceList(value, {
        allowedOpaquePrefixes: DELIVERY_SUPPORT_REF_PREFIXES,
        allowProjectFile: true,
        maxItems: 12
    });
    if (normalized.invalidCount > 0) {
        return {
            refs: normalized.refs,
            blockers: ['supportRefs 只能使用稳定引用，不能写本机绝对路径、URL 或任意文本。']
        };
    }
    return { refs: normalized.refs, blockers: [] };
}

function normalizeEditableConvention(value: unknown): {
    convention?: SkillDeliveryEditableConvention;
    blockers: string[];
} {
    if (!isRecord(value)) return { blockers: ['editable 必须是对象。'] };
    const blockers = listUnexpectedKeys(value, TARGET_KEYS, 'editable');
    const root = normalizeProjectRelativeRoot(value.projectRelativeRoot, 'editable.projectRelativeRoot');
    const folder = normalizeNamingPattern(value.folderPattern, 'editable.folderPattern', false);
    const fileName = normalizeNamingPattern(value.fileNamePattern, 'editable.fileNamePattern', true);
    const format = cleanString(value.format).toLowerCase() as SkillDeliveryEditableFormat;
    blockers.push(...root.blockers, ...folder.blockers, ...fileName.blockers);
    if (!EDITABLE_FORMATS.has(format)) blockers.push('editable.format 必须是 psd、psb 或 tif。');
    if (blockers.length > 0 || !root.value || !fileName.value) return { blockers };
    return {
        convention: {
            projectRelativeRoot: root.value,
            ...(folder.value ? { folderPattern: folder.value } : {}),
            fileNamePattern: fileName.value,
            format
        },
        blockers: []
    };
}

function normalizeRasterConvention(value: unknown): {
    convention?: SkillDeliveryRasterConvention;
    blockers: string[];
} {
    if (!isRecord(value)) return { blockers: ['raster 必须是对象。'] };
    const blockers = listUnexpectedKeys(value, TARGET_KEYS, 'raster');
    const root = normalizeProjectRelativeRoot(value.projectRelativeRoot, 'raster.projectRelativeRoot');
    const folder = normalizeNamingPattern(value.folderPattern, 'raster.folderPattern', false);
    const fileName = normalizeNamingPattern(value.fileNamePattern, 'raster.fileNamePattern', true);
    const format = cleanString(value.format).toLowerCase() as SkillDeliveryRasterFormat;
    blockers.push(...root.blockers, ...folder.blockers, ...fileName.blockers);
    if (!RASTER_FORMATS.has(format)) blockers.push('raster.format 必须是 jpg、jpeg 或 png。');
    if (blockers.length > 0 || !root.value || !fileName.value) return { blockers };
    return {
        convention: {
            projectRelativeRoot: root.value,
            ...(folder.value ? { folderPattern: folder.value } : {}),
            fileNamePattern: fileName.value,
            format
        },
        blockers: []
    };
}

function resolveSkillDeliveryConventionWithPolicy(
    value: unknown,
    allowTrustedRuntimeProvenance: boolean
): SkillDeliveryConventionResolution {
    if (value === undefined || value === null) return { status: 'not_provided', blockers: [] };
    if (!isRecord(value)) return { status: 'blocked', blockers: ['deliveryConvention 必须是对象。'] };

    const blockers = listUnexpectedKeys(value, ROOT_KEYS, 'deliveryConvention');
    if (value.version !== SKILL_DELIVERY_CONVENTION_VERSION) {
        blockers.push(`deliveryConvention.version 必须是 ${SKILL_DELIVERY_CONVENTION_VERSION}。`);
    }
    const provenance = cleanString(value.provenance) as SkillDeliveryConventionProvenance;
    if (!PROVENANCES.has(provenance)) blockers.push('deliveryConvention.provenance 无效。');
    if (!allowTrustedRuntimeProvenance && !MODEL_PROVENANCES.has(provenance)) {
        blockers.push('模型提交的 deliveryConvention 只能声明 agent_selected；agent_examples 需要当前任务的 Runtime 观察收据，用户与项目确认来源也必须由 Runtime 签发。');
    }
    const supportRefs = normalizeSupportRefs(value.supportRefs);
    blockers.push(...supportRefs.blockers);
    if (provenance !== 'skill_fallback' && supportRefs.refs.length === 0) {
        blockers.push(`${provenance} 交付约定必须附至少一个稳定 supportRef。`);
    }
    const pairing = cleanString(value.pairing) as SkillDeliveryPairing;
    if (!PAIRINGS.has(pairing)) blockers.push('deliveryConvention.pairing 无效。');
    const versionPolicy = cleanString(value.versionPolicy) as SkillDeliveryVersionPolicy;
    if (!VERSION_POLICIES.has(versionPolicy)) blockers.push('deliveryConvention.versionPolicy 无效。');
    if (versionPolicy === 'replace_exact_set'
        && !(allowTrustedRuntimeProvenance && provenance === 'skill_fallback')) {
        blockers.push(
            '显式 deliveryConvention 不能授权覆盖同名文件；replace_exact_set 仅保留给 Skill 内部兼容事务。'
        );
    }

    const editable = value.editable === undefined
        ? { blockers: [] as string[] }
        : normalizeEditableConvention(value.editable);
    const raster = value.raster === undefined
        ? { blockers: [] as string[] }
        : normalizeRasterConvention(value.raster);
    blockers.push(...editable.blockers, ...raster.blockers);
    if (!editable.convention && !raster.convention) {
        blockers.push('deliveryConvention 至少需要 editable 或 raster 其中一项。');
    }
    if (pairing === 'one_editable_per_raster' && (!editable.convention || !raster.convention)) {
        blockers.push('one_editable_per_raster 必须同时声明 editable 与 raster。');
    }
    if (pairing === 'one_master_many_rasters' && (!editable.convention || !raster.convention)) {
        blockers.push('one_master_many_rasters 必须同时声明 editable 与 raster。');
    }
    if (pairing === 'editable_only' && (!editable.convention || raster.convention)) {
        blockers.push('editable_only 只能声明 editable。');
    }
    if (pairing === 'raster_only' && (!raster.convention || editable.convention)) {
        blockers.push('raster_only 只能声明 raster。');
    }
    if (blockers.length > 0) return { status: 'blocked', blockers: Array.from(new Set(blockers)) };

    return {
        status: 'ready',
        convention: {
            version: SKILL_DELIVERY_CONVENTION_VERSION,
            provenance,
            supportRefs: supportRefs.refs,
            ...(editable.convention ? { editable: editable.convention } : {}),
            ...(raster.convention ? { raster: raster.convention } : {}),
            pairing,
            versionPolicy
        },
        blockers: []
    };
}

export function resolveSkillDeliveryConvention(value: unknown): SkillDeliveryConventionResolution {
    return resolveSkillDeliveryConventionWithPolicy(value, false);
}

/** Runtime 可读取历史 Skill fallback 收据；模型入口不能伪造用户、项目确认或 legacy replace 来源。 */
export function resolveRuntimeSkillDeliveryConvention(
    value: unknown
): SkillDeliveryConventionResolution {
    return resolveSkillDeliveryConventionWithPolicy(value, true);
}

function cleanPatternValue(value: unknown): string {
    return cleanString(value)
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
        .replace(/\s+/g, ' ')
        .replace(/-+/g, '-')
        .replace(/^[.\- ]+|[.\- ]+$/g, '');
}

export function renderSkillDeliveryPattern(
    pattern: string,
    values: SkillDeliveryPatternValues
): SkillDeliveryPatternResult {
    const normalized = normalizeNamingPattern(pattern, 'delivery pattern', true);
    if (!normalized.value) return { status: 'blocked', blockers: normalized.blockers };
    const replacements: Record<string, string> = {
        defaultName: cleanPatternValue(values.defaultName),
        index: cleanPatternValue(values.index),
        size: cleanPatternValue(values.size),
        colors: cleanPatternValue(values.colors),
        template: cleanPatternValue(values.template),
        kind: cleanPatternValue(values.kind),
        row: cleanPatternValue(values.row),
        name: cleanPatternValue(values.name),
        version: cleanPatternValue(values.version),
        screen: cleanPatternValue(values.screen)
    };
    const rendered = normalized.value.replace(/\{([^{}]+)\}/g, (_match, token: string) => replacements[token] || '');
    const safeRendered = cleanPatternValue(rendered);
    if (!safeRendered) {
        return { status: 'blocked', blockers: ['delivery pattern 渲染后文件名为空。'] };
    }
    return { status: 'ready', value: safeRendered, blockers: [] };
}

export function resolveSkillDeliveryProjectPath(projectPath: string, relativeRoot: string): string {
    const rawRoot = cleanString(projectPath);
    const windowsStyle = /^[a-z]:[\\/]/i.test(rawRoot)
        || rawRoot.startsWith('\\\\')
        || rawRoot.includes('\\');
    const relative = cleanString(relativeRoot).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (windowsStyle) {
        const root = rawRoot.replace(/\//g, '\\').replace(/\\+$/g, '');
        return `${root}\\${relative.replace(/\//g, '\\')}`;
    }
    const root = rawRoot === '/' ? '' : rawRoot.replace(/\/+$/g, '');
    return `${root}/${relative}`;
}

export function normalizeSkillDeliveryArtifactPath(value: unknown): string {
    const rawPath = cleanString(value);
    const windowsStyle = /^[a-z]:[\\/]/i.test(rawPath) || rawPath.startsWith('\\\\');
    const slashNormalized = rawPath.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
    return windowsStyle ? slashNormalized.toLowerCase() : slashNormalized;
}

function isAbsoluteLocalDeliveryPath(value: unknown): boolean {
    const text = cleanString(value)
        .replace(/\\/g, '/')
        .replace(/\/+$/g, '');
    const windowsDrivePath = /^[a-z]:\//i.test(text);
    const windowsUncPath = text.startsWith('//');
    const posixPath = text.startsWith('/') && !windowsUncPath;
    if (!windowsDrivePath && !windowsUncPath && !posixPath) return false;
    const withoutPrefix = windowsDrivePath
        ? text.slice(3)
        : text.replace(/^\/+/, '');
    const segments = withoutPrefix.split('/');
    const requiredSegments = windowsUncPath ? 3 : 1;
    if (segments.length < requiredSegments || segments.some((segment) => !segment)) return false;
    return segments.every((segment) => {
        if (segment === '.' || segment === '..' || /[\x00-\x1F]/.test(segment)) return false;
        if (!windowsDrivePath && !windowsUncPath) return true;
        return !/[<>:"|?*]/.test(segment)
            && !/[. ]$/.test(segment)
            && !WINDOWS_RESERVED_SEGMENT.test(segment);
    });
}

function isDeliveryPathInsideRoot(candidatePath: string, rootPath: string): boolean {
    const candidate = normalizeSkillDeliveryArtifactPath(candidatePath).replace(/\/+$/g, '');
    const root = normalizeSkillDeliveryArtifactPath(rootPath).replace(/\/+$/g, '');
    return Boolean(candidate)
        && Boolean(root)
        && (candidate === root || candidate.startsWith(`${root}/`));
}

function artifactFormatMatchesPath(
    path: string,
    format: SkillDeliveryPlanArtifactFormat
): boolean {
    const extension = path.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
    if (format === 'jpeg') return extension === 'jpg' || extension === 'jpeg';
    if (format === 'tif') return extension === 'tif' || extension === 'tiff';
    return extension === format;
}

export function normalizeSkillDeliveryPlanArtifact(
    value: unknown
): SkillDeliveryPlanArtifact | undefined {
    if (!isRecord(value)) return undefined;
    const artifactId = cleanString(value.artifactId);
    const pairId = cleanString(value.pairId);
    const kind = cleanString(value.kind) as SkillDeliveryPlanArtifactKind;
    const format = cleanString(value.format).toLowerCase() as SkillDeliveryPlanArtifactFormat;
    const path = cleanString(value.path);
    const order = Number(value.order);
    const sourceHistoryRole = cleanString(value.sourceHistoryRole) as SkillDeliveryPlanSourceHistoryRole;
    const formatAllowedForKind = kind === 'editable_document'
        ? EDITABLE_FORMATS.has(format as SkillDeliveryEditableFormat)
        : kind === 'raster_export' && RASTER_FORMATS.has(format as SkillDeliveryRasterFormat);
    if (!DELIVERY_PLAN_ID.test(artifactId)
        || !DELIVERY_PLAN_ID.test(pairId)
        || (kind !== 'editable_document' && kind !== 'raster_export')
        || !formatAllowedForKind
        || !Number.isSafeInteger(order)
        || order < 0
        || !DELIVERY_PLAN_SOURCE_HISTORY_ROLES.has(sourceHistoryRole)
        || !isAbsoluteLocalDeliveryPath(path)
        || !artifactFormatMatchesPath(path, format)) {
        return undefined;
    }
    return {
        artifactId,
        kind,
        pairId,
        order,
        path,
        format,
        sourceHistoryRole
    };
}

function canonicalizeSkillDeliveryPlanArtifacts(
    artifacts: readonly SkillDeliveryPlanArtifact[]
): SkillDeliveryPlanArtifact[] {
    return artifacts
        .map((artifact) => ({
            ...artifact,
            path: normalizeSkillDeliveryArtifactPath(artifact.path)
        }))
        .sort((left, right) => left.order - right.order || left.artifactId.localeCompare(right.artifactId));
}

function collectDeliveryPlanArtifactBlockers(input: {
    projectPath: string;
    convention: SkillDeliveryConvention;
    artifacts: readonly unknown[];
}): { artifacts: SkillDeliveryPlanArtifact[]; blockers: string[] } {
    const blockers: string[] = [];
    const artifacts = input.artifacts.map(normalizeSkillDeliveryPlanArtifact);
    if (artifacts.some((artifact) => !artifact)) {
        blockers.push('交付计划包含无效的文件身份、格式、顺序、配对或绝对路径。');
    }
    const normalized = artifacts.filter(Boolean) as SkillDeliveryPlanArtifact[];
    if (normalized.length === 0) blockers.push('交付计划至少需要一个文件。');
    if (new Set(normalized.map((artifact) => artifact.artifactId)).size !== normalized.length) {
        blockers.push('交付计划 artifactId 必须唯一。');
    }
    if (new Set(normalized.map((artifact) => artifact.order)).size !== normalized.length) {
        blockers.push('交付计划 order 必须唯一。');
    }
    const normalizedPathKeys = normalized.map((artifact) => (
        `${artifact.kind}:${normalizeSkillDeliveryArtifactPath(artifact.path)}`
    ));
    if (new Set(normalizedPathKeys).size !== normalizedPathKeys.length) {
        blockers.push('交付计划不能重复声明同一类型和路径。');
    }

    const editableRoot = input.convention.editable
        ? resolveSkillDeliveryProjectPath(input.projectPath, input.convention.editable.projectRelativeRoot)
        : undefined;
    const rasterRoot = input.convention.raster
        ? resolveSkillDeliveryProjectPath(input.projectPath, input.convention.raster.projectRelativeRoot)
        : undefined;
    for (const artifact of normalized) {
        const conventionTarget = artifact.kind === 'editable_document'
            ? input.convention.editable
            : input.convention.raster;
        const expectedRoot = artifact.kind === 'editable_document' ? editableRoot : rasterRoot;
        if (!conventionTarget || !expectedRoot) {
            blockers.push(`${artifact.artifactId} 的文件类型未在 deliveryConvention 中声明。`);
            continue;
        }
        if (artifact.format !== conventionTarget.format) {
            blockers.push(`${artifact.artifactId} 的格式与 deliveryConvention 不一致。`);
        }
        if (!isDeliveryPathInsideRoot(artifact.path, expectedRoot)) {
            blockers.push(`${artifact.artifactId} 不在 deliveryConvention 声明的项目目录内。`);
        }
    }

    const byPair = new Map<string, SkillDeliveryPlanArtifact[]>();
    for (const artifact of normalized) {
        const group = byPair.get(artifact.pairId) || [];
        group.push(artifact);
        byPair.set(artifact.pairId, group);
    }
    if (input.convention.pairing === 'editable_only') {
        if (normalized.some((artifact) => artifact.kind !== 'editable_document')) {
            blockers.push('editable_only 交付计划只能包含可编辑源稿。');
        }
    } else if (input.convention.pairing === 'raster_only') {
        if (normalized.some((artifact) => artifact.kind !== 'raster_export')) {
            blockers.push('raster_only 交付计划只能包含导出图。');
        }
    } else if (input.convention.pairing === 'one_editable_per_raster') {
        for (const [pairId, group] of byPair) {
            const editableCount = group.filter((artifact) => artifact.kind === 'editable_document').length;
            const rasterCount = group.filter((artifact) => artifact.kind === 'raster_export').length;
            if (editableCount !== 1 || rasterCount !== 1 || group.length !== 2) {
                blockers.push(`交付配对 ${pairId} 必须恰好包含一份可编辑源稿和一份导出图。`);
            }
        }
    } else if (!input.convention.editable || !input.convention.raster) {
        blockers.push('one_master_many_rasters 必须同时声明可编辑源稿与导出图。');
    } else {
        for (const [pairId, group] of byPair) {
            const editableCount = group.filter((artifact) => artifact.kind === 'editable_document').length;
            const rasterCount = group.filter((artifact) => artifact.kind === 'raster_export').length;
            if (editableCount !== 1 || rasterCount === 0 || group.length !== editableCount + rasterCount) {
                blockers.push(`交付配对 ${pairId} 必须包含一份可编辑主稿和至少一份导出图。`);
            }
        }
    }
    return { artifacts: normalized, blockers: Array.from(new Set(blockers)) };
}

export function buildSkillDeliveryPlan(input: {
    projectPath: string;
    convention: SkillDeliveryConvention;
    artifacts: readonly unknown[];
}): SkillDeliveryPlanResolution {
    const projectPath = cleanString(input.projectPath);
    if (!isAbsoluteLocalDeliveryPath(projectPath)) {
        return { status: 'blocked', blockers: ['交付计划需要当前项目的绝对路径。'] };
    }
    const conventionResolution = resolveRuntimeSkillDeliveryConvention(input.convention);
    if (conventionResolution.status !== 'ready' || !conventionResolution.convention) {
        return { status: 'blocked', blockers: conventionResolution.blockers };
    }
    const normalized = collectDeliveryPlanArtifactBlockers({
        projectPath,
        convention: conventionResolution.convention,
        artifacts: input.artifacts
    });
    if (normalized.blockers.length > 0) {
        return { status: 'blocked', blockers: normalized.blockers };
    }
    const digest = buildSkillDeliveryPlanDigest({
        convention: conventionResolution.convention,
        artifacts: normalized.artifacts
    });
    if (!isCurrentSkillDeliveryPlanDigest(digest)) {
        return { status: 'blocked', blockers: ['交付计划无法生成稳定摘要。'] };
    }
    return {
        status: 'ready',
        plan: {
            version: SKILL_DELIVERY_PLAN_VERSION,
            convention: conventionResolution.convention,
            artifacts: [...normalized.artifacts].sort((left, right) => left.order - right.order),
            digest,
            boundaries: {
                skillOwnsConvention: true,
                agentOrUserOwnsSelection: true,
                projectRelativeRootsOnly: true,
                artifactRolesAndPairingBound: true,
                containsNoVisualDecisions: true,
                grantsOverwritePermission: false
            }
        },
        blockers: []
    };
}

export function buildSkillDeliveryPlanDigest(input: {
    convention: SkillDeliveryConvention;
    artifactPaths?: readonly string[];
    artifacts?: readonly SkillDeliveryPlanArtifact[];
}): string {
    if (input.artifacts) {
        const artifacts = input.artifacts.map(normalizeSkillDeliveryPlanArtifact);
        if (artifacts.length === 0 || artifacts.some((artifact) => !artifact)) return '';
        const normalized = canonicalizeSkillDeliveryPlanArtifacts(
            artifacts.filter(Boolean) as SkillDeliveryPlanArtifact[]
        );
        const payload = canonicalize({ convention: input.convention, artifacts: normalized });
        return `${SKILL_DELIVERY_PLAN_DIGEST_VERSION}:${sha256Hex(payload)}`;
    }
    const artifactPaths = input.artifactPaths
        ? input.artifactPaths
        .map(normalizeSkillDeliveryArtifactPath)
        .filter(Boolean)
        .sort()
        : [];
    const payload = canonicalize({
        convention: input.convention,
        artifactPaths
    });
    return `${LEGACY_SKILL_DELIVERY_PLAN_DIGEST_VERSION}:${sha256Hex(payload)}`;
}

export function isSkillDeliveryPlanDigest(value: unknown): value is string {
    return /^(?:skill-delivery-plan\/v0|skill-delivery-plan\/v1):[a-f0-9]{64}$/.test(cleanString(value));
}

export function isCurrentSkillDeliveryPlanDigest(value: unknown): value is string {
    return new RegExp(`^${SKILL_DELIVERY_PLAN_DIGEST_VERSION.replace('/', '\\/')}:[a-f0-9]{64}$`)
        .test(cleanString(value));
}
