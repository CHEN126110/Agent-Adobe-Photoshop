/**
 * Design Intelligence · IntelligenceDb（主进程运行时持久化，Phase 0+）
 *
 * 路线图依据：docs/design-intelligence-knowledge-system-roadmap-draft.md
 *   §24.2 Runtime 存储 / §31 Runtime Persistence（intelligence-db.ts）
 *
 * 职责：在 Electron 主进程内，把 Design Intelligence 的运行时数据（知识索引、关系、
 *       候选、学习事件、资产索引）持久化到单一 JSON 文档，并提供「独占 read→mutate→write」
 *       的一致性保证。
 *
 * 边界（与仓库现有持久化约定一致）：
 * - 复用 serialized-file-operations 的 runExclusive + 原子写，不新造文件锁。
 * - 每个 IntelligenceDb 实例绑定一个数据文件；同一文件的所有读写经 runExclusive 串行。
 * - JSON 原子写（临时文件 + rename），UTF-8 无 BOM。
 * - 数据文件带 schemaVersion；读取失败或版本未知时进入 corrupt 状态：
 *   原文件隔离到带时间戳的 quarantine，禁止普通事务继续覆盖；只有显式 rebuild() 才重建。
 */

import * as fs from 'fs';
import * as path from 'path';
import {
    serializedFileOperations,
    type SerializedFileOperations
} from '../serialized-file-operations';

/** 数据库顶层结构：命名集合 → 记录数组。 */
export type IntelligenceCollections = Record<string, unknown[]>;

/** 文档 schema 版本（当前 v1）。升级格式须改版本号，不能原地改形状。 */
export const INTELLIGENCE_SCHEMA_VERSION = 1;

/** 磁盘文档形态：版本 + 集合。 */
export interface IntelligenceDocument {
    schemaVersion: number;
    collections: IntelligenceCollections;
}

/** 数据文件损坏（JSON 解析失败 / 结构非法 / 未知版本）。 */
export class IntelligenceDbCorruptError extends Error {
    readonly filePath: string;

    constructor(filePath: string, reason: string) {
        super(`IntelligenceDb 数据文件损坏（${filePath}）：${reason}`);
        this.name = 'IntelligenceDbCorruptError';
        this.filePath = filePath;
    }
}

/** 一次事务中可访问的文档读写句柄。 */
export interface IntelligenceTransaction {
    /** 读取当前完整集合数据（数组的浅拷贝）。 */
    getCollection<T>(name: string): T[];
    /** 整体替换某个集合。 */
    setCollection<T>(name: string, items: T[]): void;
}

export interface IntelligenceDbOptions {
    filePath: string;
    fileOperations?: SerializedFileOperations;
    onWarning?: (message: string) => void;
}

/**
 * 通用 JSON 文档存储：以单个文件承载多个集合，事务内独占读写。
 */
export class IntelligenceDb {
    private readonly filePath: string;
    private readonly fileOperations: SerializedFileOperations;
    private readonly onWarning?: (message: string) => void;
    private corrupt = false;

    constructor(options: IntelligenceDbOptions) {
        this.filePath = path.resolve(options.filePath);
        this.fileOperations = options.fileOperations || serializedFileOperations;
        this.onWarning = options.onWarning;
    }

    /** 是否处于损坏（拒绝写）状态。 */
    isCorrupt(): boolean {
        return this.corrupt;
    }

    /** 显式重建：清空文档到全新初始态，脱离损坏状态。仅在数据可重建时调用。 */
    async rebuild(): Promise<void> {
        await this.fileOperations.runExclusive(this.filePath, async () => {
            this.corrupt = false;
            await this.write(freshDocument());
        });
    }

    /**
     * 在独占事务内读写集合。操作函数收到一个句柄，可 getCollection / setCollection。
     * 事务结束统一落盘（原子写）。数据文件损坏时拒绝普通事务继续覆盖。
     */
    async transaction<T>(
        operation: (tx: IntelligenceTransaction) => Promise<T>
    ): Promise<T> {
        return this.fileOperations.runExclusive(this.filePath, async () => {
            if (this.corrupt) {
                throw new IntelligenceDbCorruptError(
                    this.filePath,
                    '数据文件损坏已隔离，普通事务被禁止覆盖；请显式 rebuild() 或恢复。'
                );
            }
            const doc = await this.tryRead();
            const tx: IntelligenceTransaction = {
                getCollection: <C>(name: string): C[] => {
                    const arr = doc.collections[name];
                    return Array.isArray(arr) ? (arr as C[]) : ([] as C[]);
                },
                setCollection: <C>(name: string, items: C[]): void => {
                    doc.collections[name] = items;
                }
            };
            const result = await operation(tx);
            await this.write(doc);
            return result;
        });
    }

    /** 只读读取全部集合（供查询路径使用，不做独占写）。 */
    async readCollections(): Promise<IntelligenceCollections> {
        return this.fileOperations.runExclusive(this.filePath, async () => {
            const doc = await this.tryRead();
            return doc.collections;
        });
    }

    /** 读取；损坏时隔离原文件并抛 IntelligenceDbCorruptError。 */
    private async tryRead(): Promise<IntelligenceDocument> {
        try {
            return await this.read();
        } catch (error: any) {
            if (error instanceof IntelligenceDbCorruptError) {
                await this.quarantineCorruptFile();
                this.corrupt = true;
            }
            throw error;
        }
    }

    private async read(): Promise<IntelligenceDocument> {
        if (!fs.existsSync(this.filePath)) return freshDocument();

        let raw: string;
        try {
            raw = await fs.promises.readFile(this.filePath, 'utf8');
        } catch (error: any) {
            // 读取失败（权限/编码）不能伪装成"文件不存在"。
            throw new IntelligenceDbCorruptError(
                this.filePath,
                `读取失败：${error?.message || String(error)}`
            );
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch (error: any) {
            throw new IntelligenceDbCorruptError(
                this.filePath,
                `JSON 解析失败：${error?.message || String(error)}`
            );
        }

        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new IntelligenceDbCorruptError(this.filePath, '文档结构非法（非对象）。');
        }
        const doc = parsed as Partial<IntelligenceDocument>;
        if (typeof doc.schemaVersion !== 'number') {
            throw new IntelligenceDbCorruptError(this.filePath, '缺少 schemaVersion。');
        }
        if (doc.schemaVersion > INTELLIGENCE_SCHEMA_VERSION) {
            throw new IntelligenceDbCorruptError(
                this.filePath,
                `未知 schemaVersion=${doc.schemaVersion}（当前支持 ${INTELLIGENCE_SCHEMA_VERSION}），需迁移。`
            );
        }
        if (doc.schemaVersion < INTELLIGENCE_SCHEMA_VERSION) {
            // 当前无历史版本；低版本视为需要显式重建，不做原地迁移。
            throw new IntelligenceDbCorruptError(
                this.filePath,
                `schemaVersion=${doc.schemaVersion} 过旧，需显式 rebuild()。`
            );
        }
        const collections = doc.collections && typeof doc.collections === 'object' && !Array.isArray(doc.collections)
            ? doc.collections as IntelligenceCollections
            : {};
        return { schemaVersion: INTELLIGENCE_SCHEMA_VERSION, collections };
    }

    /** 把损坏的原文件隔离到带时间戳的 quarantine，保留给人工/自动恢复。 */
    private async quarantineCorruptFile(): Promise<void> {
        const quarantinePath = `${this.filePath}.corrupt-${Date.now()}`;
        try {
            await fs.promises.rename(this.filePath, quarantinePath);
            this.onWarning?.(`IntelligenceDb 损坏文件已隔离：${quarantinePath}`);
        } catch (error: any) {
            this.onWarning?.(`IntelligenceDb 隔离损坏文件失败：${error?.message || String(error)}`);
        }
    }

    private async write(doc: IntelligenceDocument): Promise<void> {
        await this.fileOperations.writeUtf8Atomically(
            this.filePath,
            JSON.stringify(doc, null, 2)
        );
    }
}

function freshDocument(): IntelligenceDocument {
    return { schemaVersion: INTELLIGENCE_SCHEMA_VERSION, collections: {} };
}
