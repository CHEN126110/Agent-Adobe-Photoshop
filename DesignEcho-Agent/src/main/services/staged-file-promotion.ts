import fs from 'fs';
import path from 'path';
import { MAX_RUNTIME_DELIVERY_ARTIFACTS } from '../../shared/agent-runtime-v5/runtime-delivery-receipt';
import type {
    SkuStagingTransactionLease,
    StagedFilePromotionInput,
    StagedFilePromotionItem,
    StagedFilePromotionResult
} from '../../shared/sku-staging-transaction-contract';
import {
    authorizeSkuStagingTransaction,
    computeFileSha256,
    markSkuStagingTransactionPromoting,
    readSkuStagingFrozenDestinationBaseline,
    settleSkuStagingTransaction
} from './sku-staging-transaction.service';

const fsPromises = fs.promises;
const MAX_PROMOTION_ITEMS = MAX_RUNTIME_DELIVERY_ARTIFACTS;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

interface PreparedPromotionItem extends StagedFilePromotionItem {
    sourcePath: string;
    destinationPath: string;
    sourceByteLength: number;
    sourceSha256: string;
    destinationExisted: boolean;
    backupPath?: string;
    backupCaptured: boolean;
    index: number;
    installed: boolean;
    destinationLinked: boolean;
    sourceDevice: bigint;
    sourceInode: bigint;
}

interface StagedFileTransactionManifest {
    version: 'staged-file-transaction-manifest/v1';
    transactionId: string;
    createdAt: string;
    stagingRoot: string;
    destinationRoot: string;
    items: Array<{
        index: number;
        sourcePath: string;
        destinationPath: string;
        backupPath?: string;
        sourceByteLength: number;
        sourceSha256: string;
        expectedDestinationBaseline: StagedFilePromotionItem['expectedDestinationBaseline'];
    }>;
}

interface RegularFileIdentity {
    byteLength: number;
    modifiedTimeMs: number;
    sha256: string;
    device: bigint;
    inode: bigint;
}

function normalizePathKey(value: string): string {
    const resolved = path.resolve(String(value || '').trim());
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function resolveRequiredAbsolutePath(value: unknown, label: string): string {
    const rawPath = String(value || '').trim();
    if (!rawPath || rawPath.includes('\0') || !path.isAbsolute(rawPath)) {
        throw new Error(`${label}必须是明确的绝对路径。`);
    }
    const normalized = rawPath.replace(/\//g, '\\');
    if (normalized.startsWith('\\\\')
        || normalized.startsWith('\\\\?\\')
        || normalized.startsWith('\\\\.\\')) {
        throw new Error(`${label}不能使用 UNC 或设备命名空间。`);
    }
    return path.resolve(rawPath);
}

function isPathInside(rootPath: string, candidatePath: string): boolean {
    const relative = path.relative(rootPath, candidatePath);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function pathExists(pathValue: string): Promise<boolean> {
    try {
        await fsPromises.lstat(pathValue);
        return true;
    } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return false;
        throw error;
    }
}

async function readRegularFileIdentity(filePath: string): Promise<RegularFileIdentity> {
    const fileStat = await fsPromises.lstat(filePath, { bigint: true });
    const byteLength = Number(fileStat.size);
    const modifiedTimeMs = Number(fileStat.mtimeMs);
    if (fileStat.isSymbolicLink()
        || !fileStat.isFile()
        || !Number.isSafeInteger(byteLength)
        || byteLength <= 0
        || !Number.isFinite(modifiedTimeMs)) {
        throw new Error(`不是可提交的普通非空文件：${filePath}`);
    }
    if (fileStat.dev < 0n || fileStat.ino <= 0n) {
        throw new Error(`文件系统没有提供可复核的 device/inode 身份，拒绝安全提交：${filePath}`);
    }
    return {
        byteLength,
        modifiedTimeMs: Math.trunc(modifiedTimeMs),
        sha256: await computeFileSha256(filePath),
        device: fileStat.dev,
        inode: fileStat.ino
    };
}

async function ensureDestinationParentInsideRoot(
    destinationRoot: string,
    destinationPath: string
): Promise<void> {
    const parentPath = path.dirname(destinationPath);
    if (!isPathInside(destinationRoot, parentPath)) {
        throw new Error(`目标目录越出了交付根目录：${destinationPath}`);
    }
    const realRoot = await fsPromises.realpath(destinationRoot);
    const relativeParent = path.relative(destinationRoot, parentPath);
    const segments = relativeParent.split(path.sep).filter(Boolean);
    let currentPath = destinationRoot;
    for (const segment of segments) {
        currentPath = path.join(currentPath, segment);
        if (!await pathExists(currentPath)) {
            await fsPromises.mkdir(currentPath, { recursive: false });
        }
        const currentStat = await fsPromises.lstat(currentPath);
        if (currentStat.isSymbolicLink() || !currentStat.isDirectory()) {
            throw new Error(`目标目录包含链接或非目录节点：${currentPath}`);
        }
        const realCurrentPath = await fsPromises.realpath(currentPath);
        if (!isPathInside(realRoot, realCurrentPath)) {
            throw new Error(`目标目录通过链接越出了交付根目录：${destinationPath}`);
        }
    }
}

async function writeDurableJson(filePath: string, value: unknown): Promise<void> {
    const handle = await fsPromises.open(filePath, 'wx');
    try {
        await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
        await handle.sync();
    } finally {
        await handle.close();
    }
}

async function appendDurableJournalEvent(filePath: string, value: unknown): Promise<void> {
    const handle = await fsPromises.open(filePath, 'a');
    try {
        await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8');
        await handle.sync();
    } finally {
        await handle.close();
    }
}

function normalizeExpectedDestinationBaseline(
    value: unknown,
    itemIndex: number
): StagedFilePromotionItem['expectedDestinationBaseline'] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`第 ${itemIndex + 1} 个交付目标缺少执行前基线。`);
    }
    const record = value as Record<string, unknown>;
    if (record.exists !== true && record.exists !== false) {
        throw new Error(`第 ${itemIndex + 1} 个交付目标基线缺少 exists。`);
    }
    const modifiedTimeMs = Number(record.modifiedTimeMs);
    const byteLength = Number(record.byteLength);
    const sha256 = String(record.sha256 || '').trim().toLowerCase();
    if (record.exists === true
        && (!Number.isFinite(modifiedTimeMs)
            || modifiedTimeMs < 0
            || !Number.isSafeInteger(byteLength)
            || byteLength <= 0
            || !SHA256_PATTERN.test(sha256))) {
        throw new Error(
            `第 ${itemIndex + 1} 个既有交付目标基线缺少修改时间、文件大小或 main 签发的 SHA-256。`
        );
    }
    return {
        exists: record.exists,
        ...(record.exists === true ? {
            modifiedTimeMs: Math.trunc(modifiedTimeMs),
            byteLength,
            sha256
        } : {})
    };
}

function sameDestinationBaseline(
    left: StagedFilePromotionItem['expectedDestinationBaseline'],
    right: StagedFilePromotionItem['expectedDestinationBaseline']
): boolean {
    if (left.exists !== right.exists) return false;
    if (!left.exists) return true;
    return left.modifiedTimeMs === right.modifiedTimeMs
        && left.byteLength === right.byteLength
        && left.sha256 === right.sha256;
}

async function verifyDestinationMatchesBaseline(
    destinationPath: string,
    baseline: StagedFilePromotionItem['expectedDestinationBaseline']
): Promise<boolean> {
    const exists = await pathExists(destinationPath);
    if (exists !== baseline.exists) return false;
    if (!exists) return true;
    if (!baseline.sha256 || !SHA256_PATTERN.test(baseline.sha256)) return false;
    const identity = await readRegularFileIdentity(destinationPath);
    return identity.byteLength === baseline.byteLength
        && identity.modifiedTimeMs === baseline.modifiedTimeMs
        && identity.sha256 === baseline.sha256;
}

async function preparePromotionItems(
    input: StagedFilePromotionInput,
    transaction: SkuStagingTransactionLease,
    rollbackRoot: string
): Promise<PreparedPromotionItem[]> {
    if (!Array.isArray(input.items)
        || input.items.length === 0
        || input.items.length > MAX_PROMOTION_ITEMS) {
        throw new Error(`暂存文件提交数量必须在 1-${MAX_PROMOTION_ITEMS} 之间。`);
    }
    const realStagingRoot = await fsPromises.realpath(transaction.stagingRoot);
    const sourceKeys = new Set<string>();
    const destinationKeys = new Set<string>();
    const prepared: PreparedPromotionItem[] = [];
    for (let index = 0; index < input.items.length; index += 1) {
        const sourcePath = resolveRequiredAbsolutePath(
            input.items[index]?.sourcePath,
            `第 ${index + 1} 个暂存源路径`
        );
        const destinationPath = resolveRequiredAbsolutePath(
            input.items[index]?.destinationPath,
            `第 ${index + 1} 个交付目标路径`
        );
        const rendererBaseline = normalizeExpectedDestinationBaseline(
            input.items[index]?.expectedDestinationBaseline,
            index
        );
        const expectedDestinationBaseline = normalizeExpectedDestinationBaseline(
            readSkuStagingFrozenDestinationBaseline(
                input.transactionToken,
                destinationPath
            ),
            index
        );
        if (!sameDestinationBaseline(rendererBaseline, expectedDestinationBaseline)) {
            throw new Error(`第 ${index + 1} 个交付目标基线与 main 冻结身份不一致。`);
        }
        const sourceKey = normalizePathKey(sourcePath);
        const destinationKey = normalizePathKey(destinationPath);
        if (sourceKey === destinationKey
            || sourceKeys.has(sourceKey)
            || destinationKeys.has(destinationKey)
            || !isPathInside(transaction.stagingRoot, sourcePath)
            || !isPathInside(transaction.destinationRoot, destinationPath)
            || isPathInside(transaction.stagingParent, destinationPath)) {
            throw new Error(`暂存文件提交路径不合法或重复：${sourcePath} -> ${destinationPath}`);
        }
        const sourceRealPath = await fsPromises.realpath(sourcePath);
        if (!isPathInside(realStagingRoot, sourceRealPath)) {
            throw new Error(`暂存源文件通过链接越出了本次目录：${sourcePath}`);
        }
        const sourceIdentity = await readRegularFileIdentity(sourcePath);
        if (!await verifyDestinationMatchesBaseline(destinationPath, expectedDestinationBaseline)) {
            throw new Error(`destination_changed_since_baseline: ${destinationPath}`);
        }
        await ensureDestinationParentInsideRoot(transaction.destinationRoot, destinationPath);
        const destinationExisted = expectedDestinationBaseline.exists;
        sourceKeys.add(sourceKey);
        destinationKeys.add(destinationKey);
        prepared.push({
            sourcePath,
            destinationPath,
            sourceByteLength: sourceIdentity.byteLength,
            sourceSha256: sourceIdentity.sha256,
            sourceDevice: sourceIdentity.device,
            sourceInode: sourceIdentity.inode,
            destinationExisted,
            expectedDestinationBaseline,
            index,
            ...(destinationExisted
                ? { backupPath: path.join(rollbackRoot, `${String(index).padStart(3, '0')}.bak`) }
                : {}),
            backupCaptured: false,
            installed: false,
            destinationLinked: false
        });
    }
    return prepared;
}

async function rollbackInstalledSource(
    item: PreparedPromotionItem,
    journalPath?: string
): Promise<string | undefined> {
    if (!item.installed) return undefined;
    if (await pathExists(item.sourcePath)) {
        return `暂存源路径被外部重新占用，未移动现有目标：${item.sourcePath}`;
    }
    if (!await pathExists(item.destinationPath)) {
        return `已安装文件被外部移除，无法恢复暂存源：${item.destinationPath}`;
    }
    const destinationIdentity = await readRegularFileIdentity(item.destinationPath);
    if (destinationIdentity.byteLength !== item.sourceByteLength
        || destinationIdentity.sha256 !== item.sourceSha256
        || destinationIdentity.device !== item.sourceDevice
        || destinationIdentity.inode !== item.sourceInode) {
        return `交付目标已被外部文件重新占用，未删除或移动冲突文件：${item.destinationPath}`;
    }
    await fsPromises.rename(item.destinationPath, item.sourcePath);
    item.installed = false;
    item.destinationLinked = false;
    if (journalPath) {
        await appendDurableJournalEvent(journalPath, {
            phase: 'rollback_source_restored',
            index: item.index,
            sourceSha256: item.sourceSha256,
            at: new Date().toISOString()
        });
    }
    return undefined;
}

async function rollbackLinkedDestination(
    item: PreparedPromotionItem,
    journalPath?: string
): Promise<string | undefined> {
    if (item.installed || !item.destinationLinked) return undefined;
    if (!await pathExists(item.destinationPath)) {
        item.destinationLinked = false;
        return undefined;
    }
    if (!await pathExists(item.sourcePath)) {
        return `排他安装后的暂存源意外消失，无法证明目标所有权：${item.destinationPath}`;
    }
    const [sourceIdentity, destinationIdentity] = await Promise.all([
        readRegularFileIdentity(item.sourcePath),
        readRegularFileIdentity(item.destinationPath)
    ]);
    if (sourceIdentity.device !== item.sourceDevice
        || sourceIdentity.inode !== item.sourceInode
        || sourceIdentity.sha256 !== item.sourceSha256
        || destinationIdentity.device !== item.sourceDevice
        || destinationIdentity.inode !== item.sourceInode
        || destinationIdentity.sha256 !== item.sourceSha256) {
        return `交付目标已不再是本事务创建的 hard link，未删除冲突文件：${item.destinationPath}`;
    }
    await fsPromises.unlink(item.destinationPath);
    item.destinationLinked = false;
    if (journalPath) {
        await appendDurableJournalEvent(journalPath, {
            phase: 'rollback_destination_link_removed',
            index: item.index,
            sourceSha256: item.sourceSha256,
            at: new Date().toISOString()
        });
    }
    return undefined;
}

async function rollbackDestinationBackup(
    item: PreparedPromotionItem,
    journalPath?: string
): Promise<string | undefined> {
    if (!item.backupPath || !await pathExists(item.backupPath)) return undefined;
    if (await pathExists(item.destinationPath)) {
        return `交付目标已被外部重新占用，未删除冲突文件，原备份继续保留：${item.destinationPath}`;
    }
    const backupIdentity = await readRegularFileIdentity(item.backupPath);
    const baselineMatched = item.expectedDestinationBaseline.exists === true
        && backupIdentity.byteLength === item.expectedDestinationBaseline.byteLength
        && backupIdentity.modifiedTimeMs === item.expectedDestinationBaseline.modifiedTimeMs
        && backupIdentity.sha256 === item.expectedDestinationBaseline.sha256;
    try {
        // 与正式安装相同，hard link 是同卷普通文件的原子 no-replace 恢复原语。
        // pathExists 只用于生成清晰诊断；真正的并发占位保护由 link 的 EEXIST 提供。
        await fsPromises.link(item.backupPath, item.destinationPath);
    } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') {
            return `恢复原交付文件时目标被外部重新占用，未覆盖目标，原备份继续保留：${item.destinationPath}`;
        }
        throw error;
    }
    const restoredIdentity = await readRegularFileIdentity(item.destinationPath);
    if (restoredIdentity.device !== backupIdentity.device
        || restoredIdentity.inode !== backupIdentity.inode
        || restoredIdentity.byteLength !== backupIdentity.byteLength
        || restoredIdentity.sha256 !== backupIdentity.sha256) {
        return `恢复后的正式路径已不再属于原备份 hard link，未删除备份或冲突目标：${item.destinationPath}`;
    }
    await fsPromises.unlink(item.backupPath);
    item.backupCaptured = false;
    if (journalPath) {
        await appendDurableJournalEvent(journalPath, {
            phase: baselineMatched
                ? 'rollback_destination_restored'
                : 'rollback_changed_destination_restored',
            index: item.index,
            restoredSha256: backupIdentity.sha256,
            baselineMatched,
            baselineSha256: item.expectedDestinationBaseline.sha256,
            at: new Date().toISOString()
        });
    }
    return baselineMatched
        ? undefined
        : `目标在备份原子移动前已发生外部变化，已把实际移动文件原样放回正式路径，但未宣称旧基线恢复完成：${item.destinationPath}`;
}

async function rollbackPromotion(
    items: PreparedPromotionItem[],
    journalPath?: string
): Promise<string[]> {
    const errors: string[] = [];
    for (const item of [...items].reverse()) {
        try {
            const linkedDestinationError = await rollbackLinkedDestination(item, journalPath);
            if (linkedDestinationError) {
                errors.push(linkedDestinationError);
                continue;
            }
        } catch (error: unknown) {
            errors.push(
                `撤销排他安装链接失败 ${item.destinationPath}: ${String((error as Error)?.message || error)}`
            );
            continue;
        }
        try {
            const installedSourceError = await rollbackInstalledSource(item, journalPath);
            if (installedSourceError) {
                errors.push(installedSourceError);
                continue;
            }
        } catch (error: unknown) {
            errors.push(
                `恢复暂存源失败 ${item.destinationPath}: ${String((error as Error)?.message || error)}`
            );
            continue;
        }
        try {
            const destinationBackupError = await rollbackDestinationBackup(item, journalPath);
            if (destinationBackupError) errors.push(destinationBackupError);
        } catch (error: unknown) {
            errors.push(
                `恢复原交付文件失败 ${item.destinationPath}: ${String((error as Error)?.message || error)}`
            );
        }
    }
    return errors;
}

function buildManifest(
    transaction: SkuStagingTransactionLease,
    prepared: PreparedPromotionItem[]
): StagedFileTransactionManifest {
    return {
        version: 'staged-file-transaction-manifest/v1',
        transactionId: transaction.transactionId,
        createdAt: new Date().toISOString(),
        stagingRoot: transaction.stagingRoot,
        destinationRoot: transaction.destinationRoot,
        items: prepared.map((item) => ({
            index: item.index,
            sourcePath: item.sourcePath,
            destinationPath: item.destinationPath,
            ...(item.backupPath ? { backupPath: item.backupPath } : {}),
            sourceByteLength: item.sourceByteLength,
            sourceSha256: item.sourceSha256,
            expectedDestinationBaseline: item.expectedDestinationBaseline
        }))
    };
}

function failureCode(errorMessage: string): StagedFilePromotionResult['code'] {
    if (/^(?:destination_changed|destination_appeared)/.test(errorMessage)) {
        return 'destination_changed_since_baseline';
    }
    return 'promotion_failed';
}

/**
 * 用 main 签发的 SKU 暂存令牌提交一组冻结文件。
 *
 * Renderer 只提供待提交文件清单；staging root 与 destination root 始终从 main 内存租约和
 * owner marker 复核。既有目标以 main 计算的 SHA-256 基线保护，冲突回滚永不 unlink 外部文件。
 */
export async function promoteStagedFileSet(
    input: StagedFilePromotionInput
): Promise<StagedFilePromotionResult> {
    const committedPaths: string[] = [];
    const replacedPaths: string[] = [];
    const cleanupWarnings: string[] = [];
    let transaction: SkuStagingTransactionLease | undefined;
    let prepared: PreparedPromotionItem[] = [];
    let rollbackRoot = '';
    let journalPath = '';
    let journalCommitted = false;
    let promotionOwned = false;
    try {
        transaction = await authorizeSkuStagingTransaction(input?.transactionToken, 'issued');
        transaction = await markSkuStagingTransactionPromoting(input.transactionToken);
        promotionOwned = true;
        rollbackRoot = path.join(transaction.stagingRoot, `.rollback-${transaction.transactionId}`);
        await fsPromises.mkdir(rollbackRoot, { recursive: false });
        journalPath = path.join(rollbackRoot, 'transaction-journal.jsonl');
        prepared = await preparePromotionItems(input, transaction, rollbackRoot);
        await writeDurableJson(
            path.join(rollbackRoot, 'transaction-manifest.json'),
            buildManifest(transaction, prepared)
        );
        await appendDurableJournalEvent(journalPath, {
            phase: 'prepared',
            transactionId: transaction.transactionId,
            itemCount: prepared.length,
            at: new Date().toISOString()
        });

        for (const item of prepared) {
            if (!item.backupPath) continue;
            if (!await verifyDestinationMatchesBaseline(
                item.destinationPath,
                item.expectedDestinationBaseline
            )) {
                throw new Error(`destination_changed_since_baseline: ${item.destinationPath}`);
            }
            await fsPromises.rename(item.destinationPath, item.backupPath);
            item.backupCaptured = true;
            if (!await verifyDestinationMatchesBaseline(
                item.backupPath,
                item.expectedDestinationBaseline
            )) {
                throw new Error(`destination_changed_during_backup: ${item.destinationPath}`);
            }
            replacedPaths.push(item.destinationPath);
            await appendDurableJournalEvent(journalPath, {
                phase: 'destination_backed_up',
                index: item.index,
                baselineSha256: item.expectedDestinationBaseline.sha256,
                at: new Date().toISOString()
            });
        }

        for (const item of prepared) {
            if (await pathExists(item.destinationPath)) {
                throw new Error(`destination_appeared_before_install: ${item.destinationPath}`);
            }
            // hard link 是同卷普通文件的原子 no-replace 安装：目标若在检查后出现，link 以
            // EEXIST 失败，绝不会像 Windows rename 那样替换外部文件。
            await fsPromises.link(item.sourcePath, item.destinationPath);
            item.destinationLinked = true;
            await appendDurableJournalEvent(journalPath, {
                phase: 'destination_linked_no_replace',
                index: item.index,
                sourceSha256: item.sourceSha256,
                at: new Date().toISOString()
            });
            const installedIdentity = await readRegularFileIdentity(item.destinationPath);
            if (installedIdentity.byteLength !== item.sourceByteLength
                || installedIdentity.sha256 !== item.sourceSha256
                || installedIdentity.device !== item.sourceDevice
                || installedIdentity.inode !== item.sourceInode) {
                throw new Error(`提交后文件 SHA-256 不一致：${item.destinationPath}`);
            }
            await fsPromises.unlink(item.sourcePath);
            item.installed = true;
            await appendDurableJournalEvent(journalPath, {
                phase: 'source_installed',
                index: item.index,
                sourceSha256: item.sourceSha256,
                at: new Date().toISOString()
            });
            committedPaths.push(item.destinationPath);
            await appendDurableJournalEvent(journalPath, {
                phase: 'installed_file_verified',
                index: item.index,
                byteLength: installedIdentity.byteLength,
                sha256: installedIdentity.sha256,
                at: new Date().toISOString()
            });
        }

        for (const item of prepared) {
            if (await pathExists(item.sourcePath)) {
                throw new Error(`提交终态仍存在暂存源：${item.sourcePath}`);
            }
            const finalIdentity = await readRegularFileIdentity(item.destinationPath);
            if (finalIdentity.byteLength !== item.sourceByteLength
                || finalIdentity.sha256 !== item.sourceSha256
                || finalIdentity.device !== item.sourceDevice
                || finalIdentity.inode !== item.sourceInode) {
                throw new Error(`提交终态文件身份已变化：${item.destinationPath}`);
            }
        }
        await appendDurableJournalEvent(journalPath, {
            phase: 'final_set_verified',
            itemCount: prepared.length,
            at: new Date().toISOString()
        });

        await appendDurableJournalEvent(journalPath, {
            phase: 'committed',
            transactionId: transaction.transactionId,
            itemCount: committedPaths.length,
            at: new Date().toISOString()
        });
        journalCommitted = true;
        const settlement = await settleSkuStagingTransaction({
            transactionToken: input.transactionToken,
            phase: 'committed',
            terminalRollbackRoot: rollbackRoot
        });
        cleanupWarnings.push(...settlement.warnings);
        if (!settlement.durable) {
            return {
                success: false,
                committedPaths: [],
                replacedPaths: [],
                rollbackComplete: false,
                cleanupWarnings,
                error: 'SKU 文件已写入，但事务终态未能持久化；已保留恢复现场，不能宣称交付完成。',
                code: 'transaction_recovery_required',
                recoveryPath: rollbackRoot
            };
        }
        return {
            success: true,
            committedPaths,
            replacedPaths,
            rollbackComplete: true,
            cleanupWarnings
        };
    } catch (error: unknown) {
        const errorMessage = String((error as Error)?.message || error || '暂存文件提交失败');
        if (journalCommitted) {
            return {
                success: false,
                committedPaths: [],
                replacedPaths: [],
                rollbackComplete: false,
                cleanupWarnings,
                error: `${errorMessage}；提交 journal 已进入终态，已保留恢复现场。`,
                code: 'transaction_recovery_required',
                ...(rollbackRoot ? { recoveryPath: rollbackRoot } : {})
            };
        }
        const rollbackErrors = await rollbackPromotion(
            prepared,
            journalPath && await pathExists(journalPath) ? journalPath : undefined
        );
        if (journalPath && await pathExists(journalPath)) {
            try {
                await appendDurableJournalEvent(journalPath, {
                    phase: rollbackErrors.length === 0 ? 'rollback_complete' : 'rollback_incomplete',
                    rollbackErrorCount: rollbackErrors.length,
                    at: new Date().toISOString()
                });
            } catch (journalError: unknown) {
                rollbackErrors.push(
                    `回滚日志写入失败：${String((journalError as Error)?.message || journalError)}`
                );
            }
        }

        if (transaction && promotionOwned) {
            const settlement = await settleSkuStagingTransaction({
                transactionToken: input.transactionToken,
                phase: rollbackErrors.length === 0 ? 'rolled_back' : 'recovery_required',
                ...(rollbackErrors.length === 0 && rollbackRoot
                    ? { terminalRollbackRoot: rollbackRoot }
                    : {})
            });
            cleanupWarnings.push(...settlement.warnings);
            if (!settlement.durable) {
                rollbackErrors.push('事务回滚结果未能持久化，已保留恢复现场。');
            }
        }
        const rollbackComplete = rollbackErrors.length === 0;
        return {
            success: false,
            committedPaths: [],
            replacedPaths: [],
            rollbackComplete,
            cleanupWarnings,
            error: errorMessage,
            code: rollbackComplete ? failureCode(errorMessage) : 'transaction_recovery_required',
            ...(rollbackErrors.length > 0 ? { rollbackErrors } : {}),
            ...(!rollbackComplete && rollbackRoot ? { recoveryPath: rollbackRoot } : {})
        };
    }
}
