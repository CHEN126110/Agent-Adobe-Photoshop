/**
 * 设计知识笔记（Design Notes）共享契约
 *
 * 笔记 = 磁盘上的 Markdown 文件（UTF-8 无 BOM），带可选 YAML frontmatter，
 * 与 Obsidian 库格式兼容：用户可以把笔记库目录直接指向已有 Obsidian vault。
 * 本文件只含纯逻辑（解析/序列化/链接提取），不做任何 IO——主进程与渲染进程共用。
 *
 * 作者边界：author 只区分「user / agent」两种写入者，用于展示与追溯，
 * 不是权限系统；Agent 写入的笔记用户随时可改可删，反之 Agent 也能读用户笔记。
 */

export type DesignNoteAuthor = 'user' | 'agent';

/** 笔记元数据（列表/搜索返回；不含正文全文） */
export interface DesignNoteMeta {
    /** 稳定标识：相对笔记库根目录的路径（正斜杠、无 .md 后缀），如「排版/主图排版心得」 */
    id: string;
    title: string;
    tags: string[];
    author: DesignNoteAuthor;
    createdAt: string;
    updatedAt: string;
    /** 正文摘录（去 markdown 标记后的前若干字符） */
    excerpt: string;
    /** 正文中的 wiki 链接目标（[[目标]]），用于图谱/反链 */
    links: string[];
}

/** 完整笔记（读取单条时返回） */
export interface DesignNote extends DesignNoteMeta {
    /** 正文 markdown（不含 frontmatter） */
    content: string;
}

export interface DesignNoteSearchMatch {
    note: DesignNoteMeta;
    /** 命中位置说明，如「标题命中」「标签：排版」或正文摘录片段 */
    matchedIn: string[];
    score: number;
}

export interface DesignNoteFrontmatter {
    title?: string;
    tags?: string[];
    author?: DesignNoteAuthor;
    createdAt?: string;
    updatedAt?: string;
}

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const WIKI_LINK_PATTERN = /\[\[([^\[\]|#]+)(?:#[^\[\]|]*)?(?:\|[^\[\]]*)?\]\]/g;

/**
 * 解析 markdown 文件文本：拆出 frontmatter 与正文。
 * 容忍没有 frontmatter 的纯 markdown（Obsidian 老笔记常见）。
 * 只解析本功能关心的字段（title/tags/author/created/updated），
 * 其余 frontmatter 行原样保留在 rawFrontmatterRest 里，写回时不丢失。
 */
export function parseDesignNoteFile(fileText: string): {
    frontmatter: DesignNoteFrontmatter;
    content: string;
    rawFrontmatterRest: string[];
} {
    const text = String(fileText || '').replace(/^﻿/, '');
    const match = text.match(FRONTMATTER_PATTERN);
    if (!match) {
        return { frontmatter: {}, content: text, rawFrontmatterRest: [] };
    }
    const frontmatter: DesignNoteFrontmatter = {};
    const rest: string[] = [];
    const lines = match[1].split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
        if (!kv) {
            rest.push(line);
            continue;
        }
        const key = kv[1].toLowerCase();
        const rawValue = kv[2].trim();
        if (key === 'title') {
            frontmatter.title = stripYamlQuotes(rawValue);
        } else if (key === 'tags') {
            if (rawValue) {
                frontmatter.tags = parseInlineYamlList(rawValue);
            } else {
                // 块式列表：后续的「- xxx」行
                const collected: string[] = [];
                while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
                    collected.push(stripYamlQuotes(lines[i + 1].replace(/^\s*-\s+/, '').trim()));
                    i += 1;
                }
                frontmatter.tags = collected.filter(Boolean);
            }
        } else if (key === 'author') {
            const author = stripYamlQuotes(rawValue).toLowerCase();
            frontmatter.author = author === 'agent' ? 'agent' : 'user';
        } else if (key === 'created' || key === 'createdat') {
            frontmatter.createdAt = stripYamlQuotes(rawValue);
        } else if (key === 'updated' || key === 'updatedat') {
            frontmatter.updatedAt = stripYamlQuotes(rawValue);
        } else {
            rest.push(line);
        }
    }
    return {
        frontmatter,
        content: text.slice(match[0].length),
        rawFrontmatterRest: rest.filter((line) => line.trim().length > 0)
    };
}

/** 序列化为带 frontmatter 的文件文本（UTF-8 无 BOM 由写入方保证） */
export function serializeDesignNoteFile(input: {
    frontmatter: DesignNoteFrontmatter;
    content: string;
    rawFrontmatterRest?: string[];
}): string {
    const lines: string[] = ['---'];
    if (input.frontmatter.title) lines.push(`title: ${escapeYamlScalar(input.frontmatter.title)}`);
    const tags = (input.frontmatter.tags || []).filter(Boolean);
    if (tags.length > 0) lines.push(`tags: [${tags.map(escapeYamlScalar).join(', ')}]`);
    lines.push(`author: ${input.frontmatter.author === 'agent' ? 'agent' : 'user'}`);
    if (input.frontmatter.createdAt) lines.push(`created: ${input.frontmatter.createdAt}`);
    if (input.frontmatter.updatedAt) lines.push(`updated: ${input.frontmatter.updatedAt}`);
    for (const raw of input.rawFrontmatterRest || []) lines.push(raw);
    lines.push('---', '');
    const content = String(input.content || '').replace(/^\r?\n/, '');
    return `${lines.join('\n')}\n${content}${content.endsWith('\n') ? '' : '\n'}`;
}

/** 提取正文中的 wiki 链接目标（[[目标]] / [[目标|别名]] / [[目标#标题]]） */
export function extractDesignNoteLinks(content: string): string[] {
    const targets = new Set<string>();
    for (const match of String(content || '').matchAll(WIKI_LINK_PATTERN)) {
        const target = match[1].trim();
        if (target) targets.add(target);
    }
    return Array.from(targets);
}

/** 去除 markdown 标记形成纯文本摘录 */
export function buildDesignNoteExcerpt(content: string, limit: number = 160): string {
    const plain = String(content || '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`([^`]*)`/g, '$1')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[\[([^\[\]|#]+)(?:#[^\[\]|]*)?(?:\|([^\[\]]*))?\]\]/g, (_all, target, alias) => String(alias || target))
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/^>\s?/gm, '')
        .replace(/^[-*+]\s+/gm, '')
        .replace(/^\d+\.\s+/gm, '')
        .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1')
        .replace(/\s+/g, ' ')
        .trim();
    return plain.length > limit ? `${plain.slice(0, limit).trim()}…` : plain;
}

/**
 * 把用户/Agent 给的标题变成安全的文件名片段。
 * 保留中文与常用可读字符，仅剔除文件系统与路径语义字符；不做拼音化。
 */
export function sanitizeDesignNoteFileName(title: string): string {
    const cleaned = String(title || '')
        .replace(/[\\/:*?"<>|]/g, ' ')
        .replace(/[\x00-\x1F]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^\.+/, '')
        .slice(0, 80)
        .trim();
    return cleaned || '未命名笔记';
}

/** 校验笔记 id（相对路径）：拒绝绝对路径与目录穿越 */
export function isValidDesignNoteId(id: string): boolean {
    const normalized = String(id || '').trim();
    if (!normalized || normalized.length > 240) return false;
    if (/^[a-zA-Z]:[\\/]/.test(normalized) || normalized.startsWith('/') || normalized.startsWith('\\')) return false;
    const segments = normalized.split(/[\\/]/);
    return segments.every((segment) => segment.trim().length > 0 && segment !== '.' && segment !== '..');
}

/** 规范化标签：去重、去空、限长限量 */
export function normalizeDesignNoteTags(tags: unknown): string[] {
    if (!Array.isArray(tags)) return [];
    return Array.from(new Set(tags
        .map((tag) => String(tag || '').trim().replace(/^#/, ''))
        .filter((tag) => tag.length > 0 && tag.length <= 32)))
        .slice(0, 16);
}

function parseInlineYamlList(value: string): string[] {
    const inner = value.replace(/^\[/, '').replace(/\]$/, '');
    return inner.split(',').map((item) => stripYamlQuotes(item.trim())).filter(Boolean);
}

function stripYamlQuotes(value: string): string {
    return value.replace(/^['"]/, '').replace(/['"]$/, '').trim();
}

function escapeYamlScalar(value: string): string {
    const text = String(value || '').trim();
    return /[:#\[\]{}&*!|>'"%@`,]/.test(text) ? `"${text.replace(/"/g, '\\"')}"` : text;
}
