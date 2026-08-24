/**
 * 设计知识笔记服务（主进程）
 *
 * 笔记库 = 一个磁盘目录（默认 <userData>/design-notes，可指向已有 Obsidian vault）。
 * 每条笔记一个 .md 文件（UTF-8 无 BOM），frontmatter 契约见 shared/design-notes.ts。
 * 写入使用「临时文件 + rename」原子写；删除移入 .trash 子目录（可手工找回，不做硬删）。
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import {
    buildDesignNoteExcerpt,
    extractDesignNoteLinks,
    isValidDesignNoteId,
    normalizeDesignNoteTags,
    parseDesignNoteFile,
    sanitizeDesignNoteFileName,
    serializeDesignNoteFile,
    type DesignNote,
    type DesignNoteAuthor,
    type DesignNoteMeta,
    type DesignNoteSearchMatch
} from '../../shared/design-notes';

const CONFIG_FILE_NAME = 'design-notes-config.json';
const DEFAULT_VAULT_DIR_NAME = 'design-notes';
const TRASH_DIR_NAME = '.trash';
const MAX_NOTE_FILE_BYTES = 2 * 1024 * 1024;
const MAX_LISTED_NOTES = 2000;
const SKIPPED_DIR_NAMES = new Set([TRASH_DIR_NAME, '.obsidian', '.git', 'node_modules', '.designecho']);

export interface DesignNotesVaultInfo {
    vaultPath: string;
    isDefault: boolean;
    noteCount: number;
}

export interface WriteDesignNoteInput {
    /** 已有笔记 id；缺省表示新建 */
    id?: string;
    title?: string;
    content: string;
    tags?: string[];
    /** replace = 覆盖正文；append = 在正文末尾追加一段 */
    mode?: 'replace' | 'append';
    author: DesignNoteAuthor;
}

export class DesignNotesService {
    private cachedVaultPath: string | null = null;

    getVaultInfo(): DesignNotesVaultInfo {
        const vaultPath = this.resolveVaultPath();
        return {
            vaultPath,
            isDefault: vaultPath === this.getDefaultVaultPath(),
            noteCount: this.listNotes().length
        };
    }

    setVaultPath(vaultPath: string): DesignNotesVaultInfo {
        const normalized = String(vaultPath || '').trim();
        if (!normalized) {
            throw new Error('设置笔记库位置失败：路径为空。');
        }
        if (!fs.existsSync(normalized) || !fs.statSync(normalized).isDirectory()) {
            throw new Error(`设置笔记库位置失败：目录不存在（${normalized}）。请先创建目录或选择已有文件夹。`);
        }
        const configPath = path.join(app.getPath('userData'), CONFIG_FILE_NAME);
        writeFileAtomicUtf8(configPath, `${JSON.stringify({ vaultPath: normalized }, null, 2)}\n`);
        this.cachedVaultPath = normalized;
        return this.getVaultInfo();
    }

    resetVaultPath(): DesignNotesVaultInfo {
        const configPath = path.join(app.getPath('userData'), CONFIG_FILE_NAME);
        if (fs.existsSync(configPath)) fs.rmSync(configPath, { force: true });
        this.cachedVaultPath = null;
        return this.getVaultInfo();
    }

    listNotes(): DesignNoteMeta[] {
        const vaultPath = this.resolveVaultPath();
        const metas: DesignNoteMeta[] = [];
        collectMarkdownFiles(vaultPath, vaultPath, metas, { count: 0 });
        return metas.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
    }

    readNote(id: string): DesignNote {
        const filePath = this.resolveNoteFilePath(id);
        if (!fs.existsSync(filePath)) {
            throw new Error(`读取笔记失败：找不到「${id}」。请先用列表或搜索确认笔记 id。`);
        }
        const meta = readNoteFromFile(this.resolveVaultPath(), filePath);
        if (!meta) {
            throw new Error(`读取笔记失败：「${id}」超过大小上限（2MB）或无法解析。`);
        }
        return meta;
    }

    writeNote(input: WriteDesignNoteInput): DesignNote {
        const vaultPath = this.resolveVaultPath();
        const now = new Date().toISOString();
        const content = String(input.content || '');
        if (!content.trim() && input.mode !== 'replace') {
            throw new Error('写入笔记失败：正文为空。请提供 content。');
        }

        if (input.id) {
            // 更新已有笔记
            const filePath = this.resolveNoteFilePath(input.id);
            if (!fs.existsSync(filePath)) {
                throw new Error(`更新笔记失败：找不到「${input.id}」。若要新建笔记，请不要传 id。`);
            }
            const raw = fs.readFileSync(filePath, 'utf8');
            const parsed = parseDesignNoteFile(raw);
            const nextContent = input.mode === 'append'
                ? `${parsed.content.replace(/\s+$/, '')}\n\n${content.trim()}\n`
                : content;
            const fileText = serializeDesignNoteFile({
                frontmatter: {
                    title: String(input.title || parsed.frontmatter.title || path.basename(filePath, '.md')).trim(),
                    tags: input.tags !== undefined
                        ? normalizeDesignNoteTags(input.tags)
                        : (parsed.frontmatter.tags || []),
                    author: parsed.frontmatter.author || input.author,
                    createdAt: parsed.frontmatter.createdAt || now,
                    updatedAt: now
                },
                content: nextContent,
                rawFrontmatterRest: parsed.rawFrontmatterRest
            });
            writeFileAtomicUtf8(filePath, fileText);
            return this.readNote(input.id);
        }

        // 新建笔记
        const title = String(input.title || '').trim();
        if (!title) {
            throw new Error('新建笔记失败：缺少标题（title）。');
        }
        const baseName = sanitizeDesignNoteFileName(title);
        let fileName = `${baseName}.md`;
        let sequence = 2;
        while (fs.existsSync(path.join(vaultPath, fileName))) {
            fileName = `${baseName} ${sequence}.md`;
            sequence += 1;
            if (sequence > 200) {
                throw new Error(`新建笔记失败：同名笔记「${baseName}」过多，请换一个标题。`);
            }
        }
        const fileText = serializeDesignNoteFile({
            frontmatter: {
                title,
                tags: normalizeDesignNoteTags(input.tags),
                author: input.author,
                createdAt: now,
                updatedAt: now
            },
            content
        });
        writeFileAtomicUtf8(path.join(vaultPath, fileName), fileText);
        return this.readNote(fileName.replace(/\.md$/i, ''));
    }

    /** 删除 = 移入 .trash（带时间戳防撞名），不做不可逆硬删 */
    deleteNote(id: string): { trashedTo: string } {
        const vaultPath = this.resolveVaultPath();
        const filePath = this.resolveNoteFilePath(id);
        if (!fs.existsSync(filePath)) {
            throw new Error(`删除笔记失败：找不到「${id}」。`);
        }
        const trashDir = path.join(vaultPath, TRASH_DIR_NAME);
        fs.mkdirSync(trashDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const trashedName = `${path.basename(filePath, '.md')}.${stamp}.md`;
        const trashedPath = path.join(trashDir, trashedName);
        fs.renameSync(filePath, trashedPath);
        return { trashedTo: path.join(TRASH_DIR_NAME, trashedName) };
    }

    searchNotes(input: { query?: string; tags?: string[]; limit?: number }): DesignNoteSearchMatch[] {
        const limit = clampInt(input.limit, 1, 50, 20);
        const terms = String(input.query || '')
            .toLowerCase()
            .split(/\s+/)
            .map((term) => term.trim())
            .filter(Boolean)
            .slice(0, 8);
        const requiredTags = normalizeDesignNoteTags(input.tags).map((tag) => tag.toLowerCase());

        const matches: DesignNoteSearchMatch[] = [];
        for (const meta of this.listNotes()) {
            const filePath = this.resolveNoteFilePath(meta.id);
            let body = '';
            try {
                const raw = fs.readFileSync(filePath, 'utf8');
                body = parseDesignNoteFile(raw).content;
            } catch {
                continue;
            }
            const noteTags = meta.tags.map((tag) => tag.toLowerCase());
            if (requiredTags.length > 0 && !requiredTags.every((tag) => noteTags.includes(tag))) continue;

            const matchedIn: string[] = [];
            const titleLower = meta.title.toLowerCase();
            const bodyLower = body.toLowerCase();
            let matchedTerms = 0;
            for (const term of terms) {
                const inTitle = titleLower.includes(term);
                const inTags = noteTags.some((tag) => tag.includes(term));
                const inBody = bodyLower.includes(term);
                if (!inTitle && !inTags && !inBody) continue;
                matchedTerms += 1;
                if (inTitle) matchedIn.push(`标题命中：${term}`);
                if (inTags) matchedIn.push(`标签命中：${term}`);
                if (inBody && !inTitle) matchedIn.push(buildBodyMatchSnippet(body, term));
            }
            if (terms.length > 0 && matchedTerms === 0) continue;
            if (terms.length === 0 && requiredTags.length === 0) {
                // 无条件搜索 = 按更新时间列出最近笔记
                matches.push({ note: meta, matchedIn: ['最近更新'], score: 0 });
                continue;
            }
            const score = scoreDesignNoteMatch({
                titleHits: terms.filter((term) => titleLower.includes(term)).length,
                tagHits: terms.filter((term) => noteTags.some((tag) => tag.includes(term))).length,
                bodyHits: terms.filter((term) => bodyLower.includes(term)).length,
                totalTerms: terms.length,
                updatedAt: meta.updatedAt
            });
            matches.push({ note: meta, matchedIn: Array.from(new Set(matchedIn)).slice(0, 4), score });
        }
        return matches
            .sort((left, right) => right.score - left.score
                || Date.parse(right.note.updatedAt) - Date.parse(left.note.updatedAt))
            .slice(0, limit);
    }

    /** 反向链接：正文里 [[目标]] 指向该笔记（按 id 或文件名匹配）的其他笔记 */
    getBacklinks(id: string): DesignNoteMeta[] {
        const target = this.readNote(id);
        const baseName = target.id.split('/').pop() || target.id;
        const candidates = new Set([target.id.toLowerCase(), baseName.toLowerCase(), target.title.toLowerCase()]);
        return this.listNotes().filter((meta) => meta.id !== target.id
            && meta.links.some((link) => candidates.has(link.toLowerCase())));
    }

    listAllTags(): Array<{ tag: string; count: number }> {
        const counts = new Map<string, number>();
        for (const meta of this.listNotes()) {
            for (const tag of meta.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
        }
        return Array.from(counts.entries())
            .map(([tag, count]) => ({ tag, count }))
            .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag, 'zh-Hans-CN'));
    }

    resolveNoteFilePath(id: string): string {
        const normalized = String(id || '').trim().replace(/\\/g, '/').replace(/\.md$/i, '');
        if (!isValidDesignNoteId(normalized)) {
            throw new Error(`笔记 id 无效：「${id}」。id 应是笔记库内的相对路径（不含盘符与 ..）。`);
        }
        return path.join(this.resolveVaultPath(), `${normalized}.md`);
    }

    private resolveVaultPath(): string {
        if (this.cachedVaultPath && fs.existsSync(this.cachedVaultPath)) return this.cachedVaultPath;
        const configPath = path.join(app.getPath('userData'), CONFIG_FILE_NAME);
        let configured = '';
        if (fs.existsSync(configPath)) {
            try {
                const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { vaultPath?: unknown };
                configured = String(parsed.vaultPath || '').trim();
            } catch {
                configured = '';
            }
        }
        const vaultPath = configured && fs.existsSync(configured) ? configured : this.getDefaultVaultPath();
        fs.mkdirSync(vaultPath, { recursive: true });
        this.cachedVaultPath = vaultPath;
        return vaultPath;
    }

    private getDefaultVaultPath(): string {
        return path.join(app.getPath('userData'), DEFAULT_VAULT_DIR_NAME);
    }
}

/**
 * 搜索相关度评分：决定「标题命中 / 标签命中 / 正文命中 / 新旧程度」各占多大权重。
 * 返回值越大排序越靠前；返回 0 表示不区分相关度（回退为按更新时间排序）。
 */
function scoreDesignNoteMatch(input: {
    titleHits: number;
    tagHits: number;
    bodyHits: number;
    totalTerms: number;
    updatedAt: string;
}): number {
    // TODO(human)
    return 0;
}

function collectMarkdownFiles(
    vaultPath: string,
    currentDir: string,
    output: DesignNoteMeta[],
    budget: { count: number }
): void {
    if (budget.count >= MAX_LISTED_NOTES) return;
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        if (budget.count >= MAX_LISTED_NOTES) return;
        if (entry.isDirectory()) {
            if (SKIPPED_DIR_NAMES.has(entry.name) || entry.name.startsWith('.')) continue;
            collectMarkdownFiles(vaultPath, path.join(currentDir, entry.name), output, budget);
            continue;
        }
        if (!entry.isFile() || !/\.md$/i.test(entry.name)) continue;
        const meta = readNoteFromFile(vaultPath, path.join(currentDir, entry.name));
        if (meta) {
            output.push(meta);
            budget.count += 1;
        }
    }
}

function readNoteFromFile(vaultPath: string, filePath: string): DesignNote | null {
    let stat: fs.Stats;
    try {
        stat = fs.statSync(filePath);
    } catch {
        return null;
    }
    if (stat.size > MAX_NOTE_FILE_BYTES) return null;
    let raw: string;
    try {
        raw = fs.readFileSync(filePath, 'utf8');
    } catch {
        return null;
    }
    const parsed = parseDesignNoteFile(raw);
    const relative = path.relative(vaultPath, filePath).replace(/\\/g, '/').replace(/\.md$/i, '');
    const fallbackTitle = path.basename(filePath, '.md');
    return {
        id: relative,
        title: parsed.frontmatter.title || fallbackTitle,
        tags: normalizeDesignNoteTags(parsed.frontmatter.tags),
        author: parsed.frontmatter.author || 'user',
        createdAt: parsed.frontmatter.createdAt || stat.birthtime.toISOString(),
        updatedAt: parsed.frontmatter.updatedAt || stat.mtime.toISOString(),
        excerpt: buildDesignNoteExcerpt(parsed.content),
        links: extractDesignNoteLinks(parsed.content),
        content: parsed.content
    };
}

function buildBodyMatchSnippet(body: string, term: string): string {
    const lower = body.toLowerCase();
    const index = lower.indexOf(term);
    if (index < 0) return `正文命中：${term}`;
    const start = Math.max(0, index - 30);
    const end = Math.min(body.length, index + term.length + 50);
    const snippet = body.slice(start, end).replace(/\s+/g, ' ').trim();
    return `…${snippet}…`;
}

function writeFileAtomicUtf8(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tempPath, content, { encoding: 'utf8' });
    fs.renameSync(tempPath, filePath);
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(parsed)));
}

let singleton: DesignNotesService | null = null;

export function getDesignNotesService(): DesignNotesService {
    if (!singleton) singleton = new DesignNotesService();
    return singleton;
}
