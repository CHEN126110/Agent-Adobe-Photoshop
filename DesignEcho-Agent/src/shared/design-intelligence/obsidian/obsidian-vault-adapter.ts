/**
 * Design Intelligence · Obsidian 知识源契约（Phase 2 · DI-02x）
 *
 * 路线图依据：docs/design-intelligence-knowledge-system-roadmap-draft.md
 *   §6 Obsidian 定位 / §6.3 YAML Schema / §25.1 Obsidian 同步
 *
 * 职责：把 Obsidian Markdown 笔记解析为 KnowledgeNode 的契约，并实现
 *       contentHash / 冲突检测 / 原子写前置校验等纯逻辑（无 IO）。
 *
 * 边界：
 * - Obsidian 是 Human Authoring Source，**不是 Agent Runtime DB**（§6.1）。
 * - 文件系统格式 / YAML / 行号**不暴露给模型**（§32：Adapter 之下）。
 * - 冲突检测只判断「能否安全原子写」，不裁决谁对谁错——裁决留给 Conflict UI。
 * - contentHash 用仓库权威 SHA-256（shared/agent-runtime-v5/content-hash.ts），
 *   承担文件冲突与版本完整性判定；不得退化为 FNV 类快速指纹。
 */

import { AUTHORITATIVE_HASH_VERSION, sha256Hex } from '../../agent-runtime-v5/content-hash';

/** 一篇 Obsidian 笔记的最小结构（frontmatter + 正文）。 */
export interface ObsidianNote {
    /** 相对 Vault 根的文件路径（如 'design-rules/main-image.md'） */
    path: string;
    /** frontmatter 原始文本（不含 --- 分隔符） */
    frontmatter: string;
    /** Markdown 正文 */
    body: string;
}

/** Obsidian YAML 支持的知识元数据（对齐 §6.3 Schema，全集可选）。 */
export interface ObsidianFrontmatter {
    id?: string;
    type?: string;
    status?: 'validated' | 'candidate' | 'proposed' | 'deprecated';
    confidence?: number;
    domains?: string[];
    tasks?: string[];
    freshness?: 'stable' | 'medium' | 'volatile';
    related?: string[];
    version?: number;
}

/** 解析 Obsidian 笔记：拆分 frontmatter 与正文。 */
export function parseObsidianNote(raw: string, path: string): ObsidianNote {
    const trimmed = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
    const m = /^---\n([\s\S]*?)\n---\n?/.exec(trimmed);
    if (!m) {
        return { path, frontmatter: '', body: trimmed };
    }
    return {
        path,
        frontmatter: m[1],
        body: trimmed.slice(m[0].length)
    };
}

/** 解析 frontmatter 的简单 YAML 子集（标量/列表/注释），供无依赖环境使用。 */
export function parseObsidianFrontmatter(frontmatter: string): ObsidianFrontmatter {
    const result: ObsidianFrontmatter = {};
    if (!frontmatter) return result;

    const lines = frontmatter.split('\n');
    let currentKey: keyof ObsidianFrontmatter | null = null;

    for (const rawLine of lines) {
        const line = rawLine.replace(/#.*$/, '').trim();
        if (!line) continue;

        const listMatch = /^-\s+(.+)$/.exec(line);
        if (listMatch && currentKey) {
            const current = result[currentKey];
            if (Array.isArray(current)) {
                current.push(listMatch[1].trim());
            }
            continue;
        }

        const kv = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line);
        if (!kv) {
            currentKey = null;
            continue;
        }
        const key = kv[1] as keyof ObsidianFrontmatter;
        const value = kv[2].trim();
        currentKey = key;

        if (value === '' || value === '[]') {
            if (key === 'domains' || key === 'tasks' || key === 'related') {
                (result as Record<string, unknown>)[key] = [];
            }
            continue;
        }

        switch (key) {
            case 'status':
            case 'type':
            case 'freshness':
            case 'id':
                (result as Record<string, unknown>)[key] = value;
                break;
            case 'confidence':
            case 'version': {
                const num = Number(value);
                if (Number.isFinite(num)) (result as Record<string, unknown>)[key] = num;
                break;
            }
            case 'domains':
            case 'tasks':
            case 'related':
                (result as Record<string, unknown>)[key] = value
                    .replace(/^\[|\]$/g, '')
                    .split(',')
                    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
                    .filter(Boolean);
                break;
            default:
                break;
        }
    }
    return result;
}

/** 解析出的知识元数据（宽松视图；映射为完整 KnowledgeNode 由上层组装）。 */
export interface KnowledgeMetaView {
    status?: string;
    type?: string;
    domains?: string[];
    tasks?: string[];
    freshness?: string;
    version?: number;
    related?: string[];
}

/** 把解析结果映射为知识元数据视图（不负责填充 id——id 由 Knowledge 层生成/校验）。 */
export function frontmatterToKnowledgeMeta(fm: ObsidianFrontmatter): KnowledgeMetaView {
    return {
        ...(fm.status ? { status: fm.status } : {}),
        ...(fm.type ? { type: fm.type } : {}),
        ...(fm.domains ? { domains: fm.domains } : {}),
        ...(fm.tasks ? { tasks: fm.tasks } : {}),
        ...(fm.freshness ? { freshness: fm.freshness } : {}),
        ...(fm.version !== undefined ? { version: fm.version } : {}),
        ...(fm.related ? { related: fm.related } : {})
    };
}

/** 稳定 contentHash（SHA-256，与仓库权威哈希一致），用于冲突检测与版本完整性。 */
export function contentHash(note: ObsidianNote): string {
    // 稳定拼接，忽略分隔符排版差异，避免只改换行/空格就误报冲突。
    const canonical = [note.path, note.frontmatter.replace(/\s+/g, ' ').trim(), note.body.replace(/\s+/g, ' ').trim()].join('\u0000');
    return `${AUTHORITATIVE_HASH_VERSION}:${sha256Hex(canonical)}`;
}

/** 冲突检测结果。 */
export type ObsidianConflictResult =
    | { conflict: false; reason: 'no_change' | 'new_file' }
    | { conflict: true; reason: 'changed_externally'; diskHash: string; expectedHash: string }
    | { conflict: true; reason: 'baseline_required'; diskHash?: string };

/**
 * 写前冲突检测（§25.1）：
 * - 期望 hash 与磁盘当前 hash 一致 → 无冲突（磁盘未被外部改动），可安全原子写。
 * - 期望 hash 为空且磁盘**无同名文件** → 可写（新文件）。
 * - 磁盘已有同名文件但期望 hash 缺失 → `baseline_required` 冲突，**禁止覆盖**：
 *   调用方必须先读一次磁盘拿到基线，证明与写前看到的版本一致，否则可能覆盖外部改动。
 * - 期望 hash 存在但磁盘 hash 不同 → `changed_externally` 冲突，需 Conflict UI 裁决。
 */
export function checkObsidianWriteConflict(input: {
    expectedHash?: string;
    diskHash?: string;
    diskExists: boolean;
}): ObsidianConflictResult {
    if (!input.diskExists) {
        return { conflict: false, reason: 'new_file' };
    }
    if (!input.expectedHash) {
        // 磁盘已有文件但无基线 → 一律要求先读基线，不能靠"没传就放行"覆盖。
        return { conflict: true, reason: 'baseline_required', diskHash: input.diskHash };
    }
    if (input.expectedHash === input.diskHash) {
        return { conflict: false, reason: 'no_change' };
    }
    return {
        conflict: true,
        reason: 'changed_externally',
        diskHash: input.diskHash || '',
        expectedHash: input.expectedHash || ''
    };
}

/** 生成用于原子写的规范序列化（frontmatter + 正文，LF 行尾）。 */
export function serializeObsidianNote(note: ObsidianNote): string {
    const body = note.body.replace(/\r\n/g, '\n');
    if (!note.frontmatter) return body;
    const fm = note.frontmatter.replace(/\r\n/g, '\n').trim();
    return `---\n${fm}\n---\n\n${body.replace(/^\n+/, '')}`;
}
