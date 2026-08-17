import { sha256Hex } from './agent-runtime-v5/content-hash';

export type ProjectMemoryScope =
    | { type: 'user' }
    | { type: 'project'; id: string };

export type StableProjectMemoryIdentitySource = 'project_id' | 'project_path_fingerprint';

export interface StableProjectMemoryIdentity {
    id: string;
    source: StableProjectMemoryIdentitySource;
}

export interface ResolveStableProjectMemoryIdentityInput {
    projectId?: unknown;
    projectPath?: unknown;
}

const PROJECT_PATH_FINGERPRINT_VERSION = 'project-path-sha256-v1';
const REDACTED_IDENTITY_PATTERN = /\[(?:redacted(?:-local-path|-path|-identity)?|local-path-redacted)\]/i;
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]/;
const UNC_PATH_PATTERN = /^(?:\\\\|\/\/)[^\\/]+[\\/]/;
const FILE_URL_PATTERN = /^file:\/\//i;

function cleanIdentityText(value: unknown): string {
    return String(value || '').normalize('NFKC').trim();
}

function isRawLocalPath(value: string): boolean {
    return WINDOWS_ABSOLUTE_PATH_PATTERN.test(value)
        || UNC_PATH_PATTERN.test(value)
        || FILE_URL_PATTERN.test(value);
}

/**
 * 只接受不透明且未脱敏的稳定项目 ID。原始路径与显示层脱敏占位符都不是身份。
 */
export function normalizeStableProjectId(value: unknown): string {
    const text = cleanIdentityText(value);
    if (!text || REDACTED_IDENTITY_PATTERN.test(text) || isRawLocalPath(text) || /[\\/]/.test(text)) return '';
    return text.slice(0, 180);
}

function normalizeProjectPathForFingerprint(value: unknown): string {
    const text = cleanIdentityText(value);
    if (!text || REDACTED_IDENTITY_PATTERN.test(text)) return '';
    const normalized = text
        .replace(FILE_URL_PATTERN, '')
        .replace(/\\/g, '/')
        .replace(/\/{2,}/g, '/')
        .replace(/^\/+([a-z]:\/)/i, '$1')
        .replace(/\/+$/g, '')
        .toLowerCase();
    return normalized;
}

/**
 * 路径只在本地转换为不可逆、版本化的稳定指纹；返回值不包含任何可显示路径片段。
 */
export function buildStableProjectPathFingerprint(projectPath: unknown): string {
    const normalizedPath = normalizeProjectPathForFingerprint(projectPath);
    if (!normalizedPath) return '';
    return `${PROJECT_PATH_FINGERPRINT_VERSION}:${sha256Hex(normalizedPath)}`;
}

/** 优先使用项目存储层签发的 projectId；缺失时才退回路径指纹。 */
export function resolveStableProjectMemoryIdentity(
    input: ResolveStableProjectMemoryIdentityInput
): StableProjectMemoryIdentity | undefined {
    const projectId = normalizeStableProjectId(input.projectId);
    if (projectId) {
        return { id: projectId, source: 'project_id' };
    }
    const projectPathFingerprint = buildStableProjectPathFingerprint(input.projectPath);
    return projectPathFingerprint
        ? { id: projectPathFingerprint, source: 'project_path_fingerprint' }
        : undefined;
}

export function resolveStableProjectMemoryScope(
    input: ResolveStableProjectMemoryIdentityInput
): ProjectMemoryScope {
    const identity = resolveStableProjectMemoryIdentity(input);
    return identity
        ? { type: 'project', id: identity.id }
        : { type: 'user' };
}

/**
 * 卡片等边界只接收已经解析好的 scope。旧的脱敏路径占位符不会被恢复或自动归属。
 */
export function normalizeResolvedProjectMemoryScope(scope: unknown): ProjectMemoryScope {
    const raw = scope && typeof scope === 'object'
        ? scope as { type?: unknown; id?: unknown }
        : {};
    if (raw.type !== 'project') return { type: 'user' };
    const id = normalizeStableProjectId(raw.id);
    return id
        ? { type: 'project', id }
        : { type: 'user' };
}
