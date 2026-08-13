/**
 * Design Intelligence · Obsidian Vault Adapter（主进程 Node 实现，Phase 2）
 *
 * 路线图依据：docs/design-intelligence-knowledge-system-roadmap-draft.md
 *   §6.1 Obsidian 作为 Human Authoring Source / §25.1 Obsidian 同步 / §31 推荐代码结构
 *
 * 职责：在 Node 侧读写 Obsidian Vault：
 * - 读取：扫描 .md 文件 → 解析 frontmatter + 正文 → 算 contentHash。
 * - 写入：写前冲突检测（read → hash → 校验 → 原子写），冲突不覆盖（§25.1）。
 * - 监听：文件变化事件（供同步）。

 * 边界：
 * - 只做文件系统适配，不持有业务状态；契约/纯逻辑在 shared/obsidian/obsidian-vault-adapter.ts。
 * - 原子写：先写临时文件再 rename，避免半写文件。
 * - 冲突时**不自动覆盖**，返回冲突结果由上层（Conflict UI）裁决。
 */

import * as fs from 'fs';
import * as path from 'path';
import {
    parseObsidianNote,
    contentHash,
    checkObsidianWriteConflict,
    serializeObsidianNote,
    type ObsidianNote
} from '../../../shared/design-intelligence/obsidian/obsidian-vault-adapter';

/** 原子写的结果。 */
export type ObsidianWriteResult =
    | { ok: true; path: string; hash: string }
    | { ok: false; conflict: true; reason: 'changed_externally'; diskHash?: string; expectedHash?: string }
    | { ok: false; conflict: true; reason: 'baseline_required'; diskHash?: string }
    | { ok: false; conflict: false; reason: 'io_error' | 'invalid_path'; message: string };

/** Vault 适配器：以 vault 根目录为作用域，禁止越界写（安全）。 */
export class ObsidianVaultAdapter {
    private readonly root: string;

    constructor(vaultRoot: string) {
        this.root = vaultRoot;
    }

    /** 规范化相对路径并校验不越出 vault 根（防路径穿越）。 */
    private resolveSafe(relativePath: string): string | null {
        const normalized = path.normalize(relativePath).replace(/^([/\\])+/, '');
        const resolved = path.resolve(this.root, normalized);
        if (resolved !== this.root && !resolved.startsWith(this.root + path.sep)) {
            return null;
        }
        return resolved;
    }

    /** 读取并解析一个笔记；不存在返回 null。 */
    async readNote(relativePath: string): Promise<ObsidianNote | null> {
        const abs = this.resolveSafe(relativePath);
        if (!abs) return null;
        try {
            const raw = await fs.promises.readFile(abs, 'utf8');
            return parseObsidianNote(raw, relativePath);
        } catch {
            return null;
        }
    }

    /** 计算磁盘当前 hash（用于冲突检测）。 */
    async computeDiskHash(relativePath: string): Promise<{ exists: boolean; hash?: string }> {
        const abs = this.resolveSafe(relativePath);
        if (!abs) return { exists: false };
        try {
            const raw = await fs.promises.readFile(abs, 'utf8');
            return { exists: true, hash: contentHash(parseObsidianNote(raw, relativePath)) };
        } catch {
            return { exists: false };
        }
    }

    /**
     * 原子写（§25.1）：写前校验期望 hash 与磁盘一致，冲突则拒绝覆盖。
     * @param relativePath 相对 vault 根路径
     * @param note 要写入的笔记
     * @param expectedHash 写前读到的磁盘 hash；新文件传 undefined
     */
    async atomicWrite(
        relativePath: string,
        note: ObsidianNote,
        expectedHash?: string
    ): Promise<ObsidianWriteResult> {
        const abs = this.resolveSafe(relativePath);
        if (!abs) return { ok: false, conflict: false, reason: 'invalid_path', message: '路径越界或非法' };

        const disk = await this.computeDiskHash(relativePath);
        const conflict = checkObsidianWriteConflict({
            expectedHash,
            diskHash: disk.hash,
            diskExists: disk.exists
        });
        if (conflict.conflict) {
            return {
                ok: false,
                conflict: true,
                reason: conflict.reason,
                diskHash: conflict.diskHash,
                ...(conflict.reason === 'changed_externally' && conflict.expectedHash !== undefined
                    ? { expectedHash: conflict.expectedHash }
                    : {})
            };
        }

        // 原子写：临时文件 + rename
        const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`;
        try {
            await fs.promises.mkdir(path.dirname(abs), { recursive: true });
            await fs.promises.writeFile(tmp, serializeObsidianNote(note), 'utf8');
            await fs.promises.rename(tmp, abs);
            return { ok: true, path: relativePath, hash: contentHash(note) };
        } catch (error: any) {
            try { await fs.promises.unlink(tmp); } catch { /* 清理失败不阻断 */ }
            return {
                ok: false,
                conflict: false,
                reason: 'io_error',
                message: error?.message || '写入失败'
            };
        }
    }

    /** 扫描 vault 下所有 .md 文件的相对路径。 */
    async listMarkdownFiles(): Promise<string[]> {
        const result: string[] = [];
        const walk = async (dir: string): Promise<void> => {
            let entries: fs.Dirent[];
            try {
                entries = await fs.promises.readdir(dir, { withFileTypes: true });
            } catch {
                return;
            }
            for (const entry of entries) {
                if (entry.name.startsWith('.')) continue;
                const abs = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    await walk(abs);
                } else if (entry.isFile() && entry.name.endsWith('.md')) {
                    result.push(path.relative(this.root, abs).replace(/\\/g, '/'));
                }
            }
        };
        await walk(this.root);
        return result;
    }

    getRoot(): string {
        return this.root;
    }
}
