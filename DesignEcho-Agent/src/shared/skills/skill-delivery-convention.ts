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
export const SKILL_DELIVERY_PLAN_DIGEST_VERSION = 'skill-delivery-plan/v0' as const;

export type SkillDeliveryConventionProvenance =
    | 'user'
    | 'confirmed_project'
    | 'agent_examples'
    | 'skill_fallback';

export type SkillDeliveryPairing =
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
    size?: number;
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
    'agent_examples',
    'skill_fallback'
]);
const PAIRINGS = new Set<SkillDeliveryPairing>([
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
    allowSkillFallbackReplaceExactSet: boolean
): SkillDeliveryConventionResolution {
    if (value === undefined || value === null) return { status: 'not_provided', blockers: [] };
    if (!isRecord(value)) return { status: 'blocked', blockers: ['deliveryConvention 必须是对象。'] };

    const blockers = listUnexpectedKeys(value, ROOT_KEYS, 'deliveryConvention');
    if (value.version !== SKILL_DELIVERY_CONVENTION_VERSION) {
        blockers.push(`deliveryConvention.version 必须是 ${SKILL_DELIVERY_CONVENTION_VERSION}。`);
    }
    const provenance = cleanString(value.provenance) as SkillDeliveryConventionProvenance;
    if (!PROVENANCES.has(provenance)) blockers.push('deliveryConvention.provenance 无效。');
    const supportRefs = normalizeSupportRefs(value.supportRefs);
    blockers.push(...supportRefs.blockers);
    if ((provenance === 'confirmed_project' || provenance === 'agent_examples')
        && supportRefs.refs.length === 0) {
        blockers.push(`${provenance} 交付约定必须附至少一个稳定 supportRef。`);
    }
    const pairing = cleanString(value.pairing) as SkillDeliveryPairing;
    if (!PAIRINGS.has(pairing)) blockers.push('deliveryConvention.pairing 无效。');
    const versionPolicy = cleanString(value.versionPolicy) as SkillDeliveryVersionPolicy;
    if (!VERSION_POLICIES.has(versionPolicy)) blockers.push('deliveryConvention.versionPolicy 无效。');
    if (versionPolicy === 'replace_exact_set'
        && !(allowSkillFallbackReplaceExactSet && provenance === 'skill_fallback')) {
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

/** Runtime receipts may read the Skill-owned legacy fallback, but no other explicit replace policy. */
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

export function buildSkillDeliveryPlanDigest(input: {
    convention: SkillDeliveryConvention;
    artifactPaths: readonly string[];
}): string {
    const artifactPaths = input.artifactPaths
        .map(normalizeSkillDeliveryArtifactPath)
        .filter(Boolean)
        .sort();
    const payload = canonicalize({
        convention: input.convention,
        artifactPaths
    });
    return `${SKILL_DELIVERY_PLAN_DIGEST_VERSION}:${sha256Hex(payload)}`;
}

export function isSkillDeliveryPlanDigest(value: unknown): value is string {
    return new RegExp(`^${SKILL_DELIVERY_PLAN_DIGEST_VERSION.replace('/', '\\/')}:[a-f0-9]{64}$`).test(
        cleanString(value)
    );
}
