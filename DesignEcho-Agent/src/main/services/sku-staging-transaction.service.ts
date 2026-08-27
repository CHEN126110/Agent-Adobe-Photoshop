import { createHash, randomBytes, randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { MAX_RUNTIME_DELIVERY_ARTIFACTS } from '../../shared/agent-runtime-v5/runtime-delivery-receipt';
import type {
    CaptureSkuStagingDestinationBaselinesInput,
    CaptureSkuStagingDestinationBaselinesResult,
    SkuStagingDestinationBaseline,
    SkuStagingTransactionLease,
    SkuStagingTransactionPhase,
    SkuStagingTransactionResult
} from '../../shared/sku-staging-transaction-contract';

const fsPromises = fs.promises;
const OWNER_MARKER_FILE_NAME = '.designecho-transaction-owner.json';
const OWNER_MARKER_VERSION = 'sku-staging-owner/v1';
const MAX_STAGING_TRANSACTIONS_PER_PARENT = 128;

interface SkuStagingOwnerMarker {
    version: typeof OWNER_MARKER_VERSION;
    transactionId: string;
    createdAt: string;
    updatedAt: string;
    phase: Exclude<SkuStagingTransactionPhase, 'root_cleaned'>;
    stagingRoot: string;
    stagingParent: string;
    destinationRoot: string;
}

interface ActiveSkuStagingTransaction extends SkuStagingTransactionLease {
    createdAt: string;
    baselineCaptureInProgress: boolean;
    destinationBaselines: Map<string, SkuStagingDestinationBaseline>;
}

interface ReconciliationInspection {
    terminal: boolean;
    recoveryRequired: boolean;
    reason?: string;
}

class SkuStagingRecoveryRequiredError extends Error {
    readonly recoveryPath: string;

    constructor(message: string, recoveryPath: string) {
        super(message);
        this.name = 'SkuStagingRecoveryRequiredError';
        this.recoveryPath = recoveryPath;
    }
}

interface ReconciliationManifestItem {
    sourcePath: string;
    destinationPath: string;
    backupPath?: string;
    sourceByteLength: number;
    sourceSha256: string;
    expectedDestinationBaseline: {
        exists: boolean;
        byteLength?: number;
        sha256?: string;
    };
}

const activeTransactions = new Map<string, ActiveSkuStagingTransaction>();
let transactionIssuanceQueue: Promise<void> = Promise.resolve();

function normalizePathKey(value: string): string {
    const resolved = path.resolve(String(value || '').trim());
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isPathInside(rootPath: string, candidatePath: string): boolean {
    const relative = path.relative(rootPath, candidatePath);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isUnsupportedPathNamespace(rawPath: string): boolean {
    const slashNormalized = rawPath.replace(/\//g, '\\');
    return slashNormalized.startsWith('\\\\')
        || slashNormalized.startsWith('\\\\?\\')
        || slashNormalized.startsWith('\\\\.\\');
}

function resolveRequiredLocalAbsolutePath(value: unknown, label: string): string {
    const rawPath = String(value || '').trim();
    if (!rawPath
        || rawPath.includes('\0')
        || !path.isAbsolute(rawPath)
        || isUnsupportedPathNamespace(rawPath)) {
        throw new Error(`${label}必须是本机磁盘上的明确绝对路径，不能使用 UNC 或设备命名空间。`);
    }
    const rawSegments = rawPath.split(/[\\/]+/).filter(Boolean);
    if (rawSegments.some((segment, index) => {
        const isDriveSegment = index === 0 && /^[a-z]:$/i.test(segment);
        return segment === '.'
            || segment === '..'
            || (!isDriveSegment && segment.includes(':'))
            || /[. ]$/.test(segment);
    })) {
        throw new Error(`${label}包含不可信的路径段。`);
    }
    return path.resolve(rawPath);
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

async function assertNoReparsePointInExistingSegments(targetPath: string): Promise<void> {
    const resolvedPath = resolveRequiredLocalAbsolutePath(targetPath, '受控路径');
    const rootPath = path.parse(resolvedPath).root;
    const segments = path.relative(rootPath, resolvedPath).split(path.sep).filter(Boolean);
    let currentPath = rootPath;
    for (const segment of segments) {
        currentPath = path.join(currentPath, segment);
        let currentStat: fs.Stats;
        try {
            currentStat = await fsPromises.lstat(currentPath);
        } catch (error: unknown) {
            if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return;
            throw error;
        }
        if (currentStat.isSymbolicLink()) {
            throw new Error(`受控路径经过符号链接或目录联接，已拒绝：${currentPath}`);
        }
    }
}

async function assertRegularDirectoryIdentity(directoryPath: string, label: string): Promise<void> {
    const directoryStat = await fsPromises.lstat(directoryPath);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
        throw new Error(`${label}不是可信普通目录：${directoryPath}`);
    }
    const realPath = await fsPromises.realpath(directoryPath);
    if (normalizePathKey(realPath) !== normalizePathKey(directoryPath)) {
        throw new Error(`${label}真实路径与声明路径不一致：${directoryPath}`);
    }
}

async function ensureProjectContainedDirectory(
    projectRootValue: unknown,
    destinationRoot: string
): Promise<string> {
    const fallbackProjectRoot = path.dirname(destinationRoot);
    const projectRoot = resolveRequiredLocalAbsolutePath(
        projectRootValue || fallbackProjectRoot,
        'SKU 项目根目录'
    );
    const relative = path.relative(projectRoot, destinationRoot);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('SKU 交付目录必须位于当前项目根目录内。');
    }
    await assertNoReparsePointInExistingSegments(projectRoot);
    await assertRegularDirectoryIdentity(projectRoot, 'SKU 项目根目录');

    let currentDirectory = projectRoot;
    for (const segment of relative.split(path.sep).filter(Boolean)) {
        currentDirectory = path.join(currentDirectory, segment);
        if (!await pathExists(currentDirectory)) {
            await fsPromises.mkdir(currentDirectory, { recursive: false });
        }
        await assertNoReparsePointInExistingSegments(currentDirectory);
        await assertRegularDirectoryIdentity(currentDirectory, 'SKU 交付目录路径段');
    }
    return projectRoot;
}

async function findReparsePointInsideDirectory(rootPath: string): Promise<string | undefined> {
    const pending = [rootPath];
    while (pending.length > 0) {
        const currentPath = pending.pop();
        if (!currentPath) continue;
        const entries = await fsPromises.readdir(currentPath, { withFileTypes: true });
        for (const entry of entries) {
            const entryPath = path.join(currentPath, entry.name);
            if (entry.isSymbolicLink()) return entryPath;
            if (entry.isDirectory()) pending.push(entryPath);
        }
    }
    return undefined;
}

async function readRegularFile(filePath: string): Promise<fs.Stats> {
    const fileStat = await fsPromises.lstat(filePath);
    if (fileStat.isSymbolicLink() || !fileStat.isFile() || fileStat.size <= 0) {
        throw new Error(`目标不是普通非空文件：${filePath}`);
    }
    return fileStat;
}

export async function computeFileSha256(filePath: string): Promise<string> {
    await readRegularFile(filePath);
    return new Promise<string>((resolve, reject) => {
        const hash = createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('error', reject);
        stream.on('data', (chunk: string | Buffer) => {
            hash.update(chunk);
        });
        stream.on('end', () => resolve(hash.digest('hex')));
    });
}

async function readStableFileBaseline(filePath: string): Promise<{
    modifiedTimeMs: number;
    byteLength: number;
    sha256: string;
}> {
    const before = await readRegularFile(filePath);
    const sha256 = await computeFileSha256(filePath);
    const after = await readRegularFile(filePath);
    if (before.dev !== after.dev
        || before.ino !== after.ino
        || before.size !== after.size
        || Math.trunc(before.mtimeMs) !== Math.trunc(after.mtimeMs)) {
        throw new Error(`SKU 目标文件在 SHA-256 基线读取期间发生变化：${filePath}`);
    }
    return {
        modifiedTimeMs: Math.trunc(after.mtimeMs),
        byteLength: after.size,
        sha256
    };
}

async function writeDurableJsonExclusive(filePath: string, value: unknown): Promise<void> {
    const handle = await fsPromises.open(filePath, 'wx');
    try {
        await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
        await handle.sync();
    } finally {
        await handle.close();
    }
}

async function replaceDurableJson(filePath: string, value: unknown): Promise<void> {
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    const handle = await fsPromises.open(temporaryPath, 'wx');
    try {
        await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
        await handle.sync();
    } finally {
        await handle.close();
    }
    try {
        await fsPromises.rename(temporaryPath, filePath);
    } catch (error: unknown) {
        await fsPromises.rm(temporaryPath, { force: true });
        throw error;
    }
}

function ownerMarkerPath(stagingRoot: string): string {
    return path.join(stagingRoot, OWNER_MARKER_FILE_NAME);
}

function buildOwnerMarker(
    transaction: ActiveSkuStagingTransaction,
    phase: Exclude<SkuStagingTransactionPhase, 'root_cleaned'>
): SkuStagingOwnerMarker {
    return {
        version: OWNER_MARKER_VERSION,
        transactionId: transaction.transactionId,
        createdAt: transaction.createdAt,
        updatedAt: new Date().toISOString(),
        phase,
        stagingRoot: transaction.stagingRoot,
        stagingParent: transaction.stagingParent,
        destinationRoot: transaction.destinationRoot
    };
}

function parseOwnerMarker(value: unknown): SkuStagingOwnerMarker {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('SKU 暂存事务 owner marker 不是有效对象。');
    }
    const record = value as Record<string, unknown>;
    const phase = String(record.phase || '') as SkuStagingOwnerMarker['phase'];
    const validPhases: SkuStagingOwnerMarker['phase'][] = [
        'issued',
        'promoting',
        'committed',
        'rolled_back',
        'recovery_required'
    ];
    if (record.version !== OWNER_MARKER_VERSION
        || !/^[a-f0-9-]{36}$/i.test(String(record.transactionId || ''))
        || !validPhases.includes(phase)) {
        throw new Error('SKU 暂存事务 owner marker 版本、身份或阶段无效。');
    }
    return {
        version: OWNER_MARKER_VERSION,
        transactionId: String(record.transactionId),
        createdAt: String(record.createdAt || ''),
        updatedAt: String(record.updatedAt || ''),
        phase,
        stagingRoot: resolveRequiredLocalAbsolutePath(record.stagingRoot, 'owner staging root'),
        stagingParent: resolveRequiredLocalAbsolutePath(record.stagingParent, 'owner staging parent'),
        destinationRoot: resolveRequiredLocalAbsolutePath(record.destinationRoot, 'owner destination root')
    };
}

async function readOwnerMarker(stagingRoot: string): Promise<SkuStagingOwnerMarker> {
    const markerText = await fsPromises.readFile(ownerMarkerPath(stagingRoot), 'utf8');
    return parseOwnerMarker(JSON.parse(markerText) as unknown);
}

function validateMarkerIdentity(
    marker: SkuStagingOwnerMarker,
    stagingRoot: string,
    stagingParent: string,
    destinationRoot: string
): void {
    if (normalizePathKey(marker.stagingRoot) !== normalizePathKey(stagingRoot)
        || normalizePathKey(marker.stagingParent) !== normalizePathKey(stagingParent)
        || normalizePathKey(marker.destinationRoot) !== normalizePathKey(destinationRoot)
        || path.basename(stagingRoot).toLowerCase() !== marker.transactionId.toLowerCase()) {
        throw new Error(`SKU 暂存事务 owner marker 与目录身份不一致：${stagingRoot}`);
    }
}

function parseJournalLines(rawText: string, journalPath: string): Array<Record<string, unknown>> {
    const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) throw new Error(`SKU 事务 journal 为空：${journalPath}`);
    return lines.map((line, index) => {
        try {
            const parsed = JSON.parse(line) as unknown;
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new Error('journal event 不是对象');
            }
            return parsed as Record<string, unknown>;
        } catch (error: unknown) {
            throw new Error(
                `SKU 事务 journal 第 ${index + 1} 行损坏：${String((error as Error)?.message || error)}`
            );
        }
    });
}

function parseReconciliationManifest(
    manifestValue: unknown,
    rollbackRoot: string,
    marker: SkuStagingOwnerMarker
): ReconciliationManifestItem[] {
    if (!manifestValue || typeof manifestValue !== 'object' || Array.isArray(manifestValue)) {
        throw new Error(`SKU 事务 manifest 不是有效对象：${rollbackRoot}`);
    }
    const manifest = manifestValue as Record<string, unknown>;
    if (manifest.version !== 'staged-file-transaction-manifest/v1'
        || String(manifest.transactionId || '') !== marker.transactionId
        || normalizePathKey(String(manifest.stagingRoot || '')) !== normalizePathKey(marker.stagingRoot)
        || normalizePathKey(String(manifest.destinationRoot || '')) !== normalizePathKey(marker.destinationRoot)
        || !Array.isArray(manifest.items)
        || manifest.items.length === 0
        || manifest.items.length > MAX_RUNTIME_DELIVERY_ARTIFACTS) {
        throw new Error(`SKU 事务 manifest 与 owner marker 不一致：${rollbackRoot}`);
    }
    const sourceKeys = new Set<string>();
    const destinationKeys = new Set<string>();
    return manifest.items.map((itemValue, index) => {
        if (!itemValue || typeof itemValue !== 'object' || Array.isArray(itemValue)) {
            throw new Error(`SKU 事务 manifest 第 ${index + 1} 项无效。`);
        }
        const item = itemValue as Record<string, unknown>;
        const sourcePath = resolveRequiredLocalAbsolutePath(item.sourcePath, 'manifest source path');
        const destinationPath = resolveRequiredLocalAbsolutePath(
            item.destinationPath,
            'manifest destination path'
        );
        const backupPath = item.backupPath
            ? resolveRequiredLocalAbsolutePath(item.backupPath, 'manifest backup path')
            : undefined;
        const sourceByteLength = Number(item.sourceByteLength);
        const sourceSha256 = String(item.sourceSha256 || '').trim().toLowerCase();
        const baselineValue = item.expectedDestinationBaseline;
        if (!baselineValue || typeof baselineValue !== 'object' || Array.isArray(baselineValue)) {
            throw new Error(`SKU 事务 manifest 第 ${index + 1} 项缺少目标基线。`);
        }
        const baseline = baselineValue as Record<string, unknown>;
        const baselineExists = baseline.exists === true;
        const baselineByteLength = Number(baseline.byteLength);
        const baselineSha256 = String(baseline.sha256 || '').trim().toLowerCase();
        const sourceKey = normalizePathKey(sourcePath);
        const destinationKey = normalizePathKey(destinationPath);
        if (!isPathInside(marker.stagingRoot, sourcePath)
            || !isPathInside(marker.destinationRoot, destinationPath)
            || isPathInside(marker.stagingParent, destinationPath)
            || (backupPath && !isPathInside(rollbackRoot, backupPath))
            || sourceKeys.has(sourceKey)
            || destinationKeys.has(destinationKey)
            || !Number.isSafeInteger(sourceByteLength)
            || sourceByteLength <= 0
            || !/^[a-f0-9]{64}$/.test(sourceSha256)
            || (baselineExists
                && (!Number.isSafeInteger(baselineByteLength)
                    || baselineByteLength <= 0
                    || !/^[a-f0-9]{64}$/.test(baselineSha256)))) {
            throw new Error(`SKU 事务 manifest 第 ${index + 1} 项路径或 SHA-256 身份无效。`);
        }
        sourceKeys.add(sourceKey);
        destinationKeys.add(destinationKey);
        return {
            sourcePath,
            destinationPath,
            ...(backupPath ? { backupPath } : {}),
            sourceByteLength,
            sourceSha256,
            expectedDestinationBaseline: {
                exists: baselineExists,
                ...(baselineExists ? {
                    byteLength: baselineByteLength,
                    sha256: baselineSha256
                } : {})
            }
        };
    });
}

async function fileMatchesIdentity(
    filePath: string,
    byteLength: number,
    sha256: string
): Promise<boolean> {
    if (!await pathExists(filePath)) return false;
    const fileStat = await readRegularFile(filePath);
    if (fileStat.size !== byteLength) return false;
    return await computeFileSha256(filePath) === sha256;
}

async function validateCommittedManifestState(
    items: ReconciliationManifestItem[]
): Promise<string | undefined> {
    for (const item of items) {
        if (await pathExists(item.sourcePath)) {
            return `committed 终态仍存在暂存源，拒绝删除恢复现场：${item.sourcePath}`;
        }
        if (!await fileMatchesIdentity(item.destinationPath, item.sourceByteLength, item.sourceSha256)) {
            return `committed 终态的正式文件与 source SHA-256 不一致：${item.destinationPath}`;
        }
        if (item.backupPath && await pathExists(item.backupPath)) {
            const baseline = item.expectedDestinationBaseline;
            if (!baseline.exists
                || !baseline.byteLength
                || !baseline.sha256
                || !await fileMatchesIdentity(item.backupPath, baseline.byteLength, baseline.sha256)) {
                return `committed 终态的原文件备份与 baseline SHA-256 不一致：${item.backupPath}`;
            }
        }
    }
    return undefined;
}

async function validateRolledBackManifestState(
    items: ReconciliationManifestItem[]
): Promise<string | undefined> {
    for (const item of items) {
        if (!await fileMatchesIdentity(item.sourcePath, item.sourceByteLength, item.sourceSha256)) {
            return `rollback_complete 终态的暂存源与 source SHA-256 不一致：${item.sourcePath}`;
        }
        const baseline = item.expectedDestinationBaseline;
        if (baseline.exists) {
            if (!baseline.byteLength
                || !baseline.sha256
                || !await fileMatchesIdentity(
                    item.destinationPath,
                    baseline.byteLength,
                    baseline.sha256
                )) {
                return `rollback_complete 终态的正式文件与 baseline SHA-256 不一致：${item.destinationPath}`;
            }
        } else if (await pathExists(item.destinationPath)) {
            return `rollback_complete 终态出现了基线之外的正式文件：${item.destinationPath}`;
        }
        if (item.backupPath && await pathExists(item.backupPath)) {
            return `rollback_complete 终态仍残留原文件备份：${item.backupPath}`;
        }
    }
    return undefined;
}

async function inspectRollbackDirectory(
    rollbackRoot: string,
    marker: SkuStagingOwnerMarker
): Promise<ReconciliationInspection> {
    const manifestPath = path.join(rollbackRoot, 'transaction-manifest.json');
    const journalPath = path.join(rollbackRoot, 'transaction-journal.jsonl');
    const [manifestText, journalText] = await Promise.all([
        fsPromises.readFile(manifestPath, 'utf8'),
        fsPromises.readFile(journalPath, 'utf8')
    ]);
    const manifestItems = parseReconciliationManifest(
        JSON.parse(manifestText) as unknown,
        rollbackRoot,
        marker
    );
    const events = parseJournalLines(journalText, journalPath);
    const lastPhase = String(events.at(-1)?.phase || '');
    if (lastPhase === 'committed') {
        const stateError = await validateCommittedManifestState(manifestItems);
        if (stateError) {
            return { terminal: false, recoveryRequired: true, reason: stateError };
        }
        return { terminal: true, recoveryRequired: false };
    }
    if (lastPhase === 'rollback_complete') {
        const stateError = await validateRolledBackManifestState(manifestItems);
        if (stateError) {
            return { terminal: false, recoveryRequired: true, reason: stateError };
        }
        return { terminal: true, recoveryRequired: false };
    }
    return {
        terminal: false,
        recoveryRequired: true,
        reason: `事务日志停在非终态 ${lastPhase || 'unknown'}：${rollbackRoot}`
    };
}

async function inspectTransactionForReconciliation(
    marker: SkuStagingOwnerMarker
): Promise<ReconciliationInspection> {
    if (marker.phase === 'recovery_required') {
        return {
            terminal: false,
            recoveryRequired: true,
            reason: `事务已标记为需要人工恢复：${marker.stagingRoot}`
        };
    }
    const entries = await fsPromises.readdir(marker.stagingRoot, { withFileTypes: true });
    const rollbackEntries = entries.filter((entry) => entry.name.startsWith('.rollback-'));
    for (const entry of rollbackEntries) {
        if (entry.isSymbolicLink() || !entry.isDirectory()) {
            return {
                terminal: false,
                recoveryRequired: true,
                reason: `事务恢复目录不是可信普通目录：${path.join(marker.stagingRoot, entry.name)}`
            };
        }
        const inspection = await inspectRollbackDirectory(
            path.join(marker.stagingRoot, entry.name),
            marker
        );
        if (inspection.recoveryRequired) return inspection;
    }
    if (marker.phase === 'promoting' && rollbackEntries.length === 0) {
        return {
            terminal: true,
            recoveryRequired: false,
            reason: '事务尚未写入 manifest，或终态元数据已完成清理。'
        };
    }
    return { terminal: true, recoveryRequired: false };
}

async function removeValidatedTransactionRoot(stagingRoot: string): Promise<void> {
    await assertNoReparsePointInExistingSegments(stagingRoot);
    const rootStat = await fsPromises.lstat(stagingRoot);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
        throw new Error(`SKU 暂存事务根不是可信普通目录：${stagingRoot}`);
    }
    const reparsePath = await findReparsePointInsideDirectory(stagingRoot);
    if (reparsePath) {
        throw new Error(`SKU 暂存事务包含符号链接或目录联接，拒绝递归清理：${reparsePath}`);
    }
    await fsPromises.rm(stagingRoot, { recursive: true, force: false });
}

/**
 * 崩溃残留只做 fail-closed 检测：可证明处于一致终态的目录可以回收；任何非终态、损坏或
 * 文件身份不一致的现场都原样保留并阻止新事务，不在缺少运行时上下文时猜测自动 rollback。
 */
async function guardStagingParentAgainstUnresolvedTransactions(
    stagingParent: string,
    destinationRoot: string
): Promise<void> {
    const parentEntries = await fsPromises.readdir(stagingParent, { withFileTypes: true });
    if (parentEntries.length > MAX_STAGING_TRANSACTIONS_PER_PARENT) {
        throw new Error(`SKU 暂存父目录包含超过 ${MAX_STAGING_TRANSACTIONS_PER_PARENT} 个事务，已停止自动处理。`);
    }
    for (const entry of parentEntries) {
        const stagingRoot = path.join(stagingParent, entry.name);
        if (entry.isSymbolicLink() || !entry.isDirectory()) {
            throw new SkuStagingRecoveryRequiredError(
                `sku_staging_recovery_required: SKU 暂存父目录包含非事务或链接节点：${stagingRoot}`,
                stagingRoot
            );
        }
        const activeTransaction = Array.from(activeTransactions.values()).find(
            (candidate) => normalizePathKey(candidate.stagingRoot) === normalizePathKey(stagingRoot)
        );
        if (activeTransaction && activeTransaction.phase !== 'root_cleaned') {
            throw new Error(`当前 SKU 目录已有活动暂存事务：${activeTransaction.transactionId}`);
        }
        try {
            await assertNoReparsePointInExistingSegments(stagingRoot);
            const marker = await readOwnerMarker(stagingRoot);
            validateMarkerIdentity(marker, stagingRoot, stagingParent, destinationRoot);
            const inspection = await inspectTransactionForReconciliation(marker);
            if (inspection.recoveryRequired) {
                throw new SkuStagingRecoveryRequiredError(
                    `sku_staging_recovery_required: ${inspection.reason || stagingRoot}`,
                    stagingRoot
                );
            }
            await removeValidatedTransactionRoot(stagingRoot);
        } catch (error: unknown) {
            if (error instanceof SkuStagingRecoveryRequiredError) throw error;
            throw new SkuStagingRecoveryRequiredError(
                `sku_staging_recovery_required: 无法证明崩溃残留事务处于安全终态：${stagingRoot}；${String((error as Error)?.message || error)}`,
                stagingRoot
            );
        }
    }
}

function getActiveTransaction(transactionToken: unknown): ActiveSkuStagingTransaction {
    const token = String(transactionToken || '').trim();
    const transaction = activeTransactions.get(token);
    if (!token || !transaction) {
        throw new Error('SKU 暂存事务令牌无效、已过期或不属于当前主进程。');
    }
    return transaction;
}

async function validateActiveTransactionMarker(
    transaction: ActiveSkuStagingTransaction
): Promise<SkuStagingOwnerMarker> {
    await assertNoReparsePointInExistingSegments(transaction.destinationRoot);
    await assertNoReparsePointInExistingSegments(transaction.stagingRoot);
    const marker = await readOwnerMarker(transaction.stagingRoot);
    validateMarkerIdentity(
        marker,
        transaction.stagingRoot,
        transaction.stagingParent,
        transaction.destinationRoot
    );
    if (marker.transactionId !== transaction.transactionId) {
        throw new Error('SKU 暂存事务令牌与 owner marker 身份不一致。');
    }
    return marker;
}

async function updateTransactionPhase(
    transaction: ActiveSkuStagingTransaction,
    phase: Exclude<SkuStagingTransactionPhase, 'root_cleaned'>
): Promise<void> {
    await replaceDurableJson(ownerMarkerPath(transaction.stagingRoot), buildOwnerMarker(transaction, phase));
    transaction.phase = phase;
}

async function issueSkuStagingTransactionUnlocked(
    outputDirectory: unknown,
    projectRootValue?: unknown
): Promise<SkuStagingTransactionResult> {
    try {
        const destinationRoot = resolveRequiredLocalAbsolutePath(outputDirectory, 'SKU 交付目录');
        await ensureProjectContainedDirectory(projectRootValue, destinationRoot);
        const activeForDestination = Array.from(activeTransactions.values()).find(
            (candidate) => normalizePathKey(candidate.destinationRoot) === normalizePathKey(destinationRoot)
                && candidate.phase !== 'root_cleaned'
        );
        if (activeForDestination) {
            if (activeForDestination.phase === 'recovery_required') {
                throw new SkuStagingRecoveryRequiredError(
                    `sku_staging_recovery_required: 当前 SKU 目录存在未完成恢复事务：${activeForDestination.stagingRoot}`,
                    activeForDestination.stagingRoot
                );
            }
            throw new Error(`SKU 交付目录已有活动事务：${activeForDestination.transactionId}`);
        }
        const stagingParent = path.join(destinationRoot, '.designecho-staging');
        if (!await pathExists(stagingParent)) {
            await fsPromises.mkdir(stagingParent, { recursive: false });
        }
        await assertNoReparsePointInExistingSegments(stagingParent);
        const parentStat = await fsPromises.lstat(stagingParent);
        if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
            throw new Error(`SKU 暂存父目录不是可信普通目录：${stagingParent}`);
        }
        await guardStagingParentAgainstUnresolvedTransactions(stagingParent, destinationRoot);

        const transactionId = randomUUID();
        const stagingRoot = path.join(stagingParent, transactionId);
        await fsPromises.mkdir(stagingRoot, { recursive: false });
        const transactionToken = `${transactionId}.${randomBytes(32).toString('base64url')}`;
        const createdAt = new Date().toISOString();
        const transaction: ActiveSkuStagingTransaction = {
            transactionToken,
            transactionId,
            stagingRoot,
            stagingParent,
            destinationRoot,
            phase: 'issued',
            createdAt,
            baselineCaptureInProgress: false,
            destinationBaselines: new Map()
        };
        try {
            await writeDurableJsonExclusive(ownerMarkerPath(stagingRoot), buildOwnerMarker(transaction, 'issued'));
        } catch (error: unknown) {
            await fsPromises.rmdir(stagingRoot);
            throw error;
        }
        activeTransactions.set(transactionToken, transaction);
        return {
            success: true,
            transactionToken,
            transactionId,
            stagingRoot,
            stagingParent,
            outputDir: destinationRoot
        };
    } catch (error: unknown) {
        const errorMessage = String((error as Error)?.message || error || 'SKU 暂存事务签发失败');
        const recoveryPath = error instanceof SkuStagingRecoveryRequiredError
            ? error.recoveryPath
            : undefined;
        return {
            success: false,
            code: recoveryPath
                ? 'staging_recovery_required'
                : 'staging_transaction_issue_failed',
            error: errorMessage,
            ...(recoveryPath ? { recoveryPath } : {})
        };
    }
}

export async function issueSkuStagingTransaction(
    outputDirectory: unknown,
    projectRootValue?: unknown
): Promise<SkuStagingTransactionResult> {
    const previousIssuance = transactionIssuanceQueue;
    let releaseIssuance: () => void = () => undefined;
    transactionIssuanceQueue = new Promise<void>((resolve) => {
        releaseIssuance = resolve;
    });
    await previousIssuance;
    try {
        return await issueSkuStagingTransactionUnlocked(outputDirectory, projectRootValue);
    } finally {
        releaseIssuance();
    }
}

export async function authorizeSkuStagingTransaction(
    transactionToken: unknown,
    requiredPhase: SkuStagingTransactionPhase = 'issued'
): Promise<SkuStagingTransactionLease> {
    const transaction = getActiveTransaction(transactionToken);
    if (transaction.phase !== requiredPhase) {
        throw new Error(
            `SKU 暂存事务阶段不允许当前操作：要求 ${requiredPhase}，实际 ${transaction.phase}。`
        );
    }
    const marker = await validateActiveTransactionMarker(transaction);
    if (marker.phase !== requiredPhase) {
        throw new Error(`SKU 暂存事务内存阶段与 owner marker 不一致：${marker.phase}。`);
    }
    return { ...transaction };
}

export async function markSkuStagingTransactionPromoting(
    transactionToken: unknown
): Promise<SkuStagingTransactionLease> {
    const transaction = getActiveTransaction(transactionToken);
    if (transaction.phase !== 'issued') {
        throw new Error(`SKU 暂存事务不能重复提交：${transaction.phase}。`);
    }
    if (transaction.baselineCaptureInProgress || transaction.destinationBaselines.size === 0) {
        throw new Error('SKU 暂存事务尚未冻结 main 文件身份基线，不能提交。');
    }
    // 在第一次 await 之前先占有阶段，阻止同一 token 的并发 promotion 同时通过 issued 检查。
    transaction.phase = 'promoting';
    try {
        const marker = await validateActiveTransactionMarker(transaction);
        if (marker.phase !== 'issued') {
            throw new Error(`SKU 暂存事务 owner marker 不能进入提交阶段：${marker.phase}。`);
        }
        await updateTransactionPhase(transaction, 'promoting');
        return { ...transaction };
    } catch (error: unknown) {
        transaction.phase = 'recovery_required';
        throw error;
    }
}

export function readSkuStagingFrozenDestinationBaseline(
    transactionToken: unknown,
    destinationPath: unknown
): Omit<SkuStagingDestinationBaseline, 'path'> {
    const transaction = getActiveTransaction(transactionToken);
    if (transaction.phase !== 'promoting') {
        throw new Error('SKU 暂存事务尚未取得提交所有权。');
    }
    const resolvedDestinationPath = resolveRequiredLocalAbsolutePath(
        destinationPath,
        'SKU 交付目标路径'
    );
    const baseline = transaction.destinationBaselines.get(normalizePathKey(resolvedDestinationPath));
    if (!baseline
        || normalizePathKey(baseline.path) !== normalizePathKey(resolvedDestinationPath)) {
        throw new Error(`SKU 交付目标没有 main 冻结基线：${resolvedDestinationPath}`);
    }
    return {
        exists: baseline.exists,
        ...(baseline.exists ? {
            modifiedTimeMs: baseline.modifiedTimeMs,
            byteLength: baseline.byteLength,
            sha256: baseline.sha256
        } : {})
    };
}

/**
 * Main-owned complete destination set captured before promotion. The promotion
 * owner compares the whole ordered set before its first filesystem write, so a
 * renderer bug cannot commit only a valid-looking subset of the transaction.
 */
export function readSkuStagingFrozenDestinationPaths(
    transactionToken: unknown
): string[] {
    const transaction = getActiveTransaction(transactionToken);
    if (transaction.phase !== 'issued' && transaction.phase !== 'promoting') {
        throw new Error(`SKU 暂存事务阶段不允许读取完整目标集合：${transaction.phase}。`);
    }
    if (transaction.baselineCaptureInProgress || transaction.destinationBaselines.size === 0) {
        throw new Error('SKU 暂存事务尚未冻结完整目标集合。');
    }
    return Array.from(transaction.destinationBaselines.values()).map((baseline) => baseline.path);
}

export async function settleSkuStagingTransaction(input: {
    transactionToken: unknown;
    phase: 'committed' | 'rolled_back' | 'recovery_required';
    terminalRollbackRoot?: string;
}): Promise<{ durable: boolean; warnings: string[] }> {
    const warnings: string[] = [];
    let transaction: ActiveSkuStagingTransaction | undefined;
    try {
        transaction = getActiveTransaction(input.transactionToken);
        if (transaction.phase !== 'promoting') {
            throw new Error(`SKU 暂存事务不在提交阶段：${transaction.phase}。`);
        }
        await updateTransactionPhase(transaction, input.phase);
    } catch (error: unknown) {
        if (transaction) transaction.phase = 'recovery_required';
        return {
            durable: false,
            warnings: [`SKU 暂存事务终态未能持久化：${String((error as Error)?.message || error)}`]
        };
    }
    if (input.phase !== 'recovery_required' && input.terminalRollbackRoot) {
        if (!transaction) {
            return {
                durable: false,
                warnings: ['SKU 暂存事务终态缺少活动租约，已保留恢复现场。']
            };
        }
        const rollbackRoot = resolveRequiredLocalAbsolutePath(input.terminalRollbackRoot, '事务恢复目录');
        if (!isPathInside(transaction.stagingRoot, rollbackRoot)
            || !path.basename(rollbackRoot).startsWith('.rollback-')) {
            return {
                durable: false,
                warnings: ['事务恢复目录身份不合法，已保留现场并停止清理。']
            };
        }
        try {
            await removeValidatedTransactionRoot(rollbackRoot);
        } catch (error: unknown) {
            warnings.push(`事务已进入终态，但恢复目录清理失败：${String((error as Error)?.message || error)}`);
        }
    }
    return { durable: true, warnings };
}

export async function captureSkuStagingDestinationBaselines(
    input: CaptureSkuStagingDestinationBaselinesInput
): Promise<CaptureSkuStagingDestinationBaselinesResult> {
    let transaction: ActiveSkuStagingTransaction | undefined;
    try {
        transaction = getActiveTransaction(input.transactionToken);
        if (transaction.phase !== 'issued'
            || transaction.baselineCaptureInProgress
            || transaction.destinationBaselines.size > 0) {
            throw new Error('SKU 目标基线只能在未提交事务中冻结一次。');
        }
        transaction.baselineCaptureInProgress = true;
        const marker = await validateActiveTransactionMarker(transaction);
        if (marker.phase !== 'issued') {
            throw new Error(`SKU 目标基线冻结阶段与 owner marker 不一致：${marker.phase}。`);
        }
        if (!Array.isArray(input.destinationPaths)
            || input.destinationPaths.length === 0
            || input.destinationPaths.length > MAX_RUNTIME_DELIVERY_ARTIFACTS) {
            throw new Error(`SKU 目标基线数量必须在 1-${MAX_RUNTIME_DELIVERY_ARTIFACTS} 之间。`);
        }
        const destinationKeys = new Set<string>();
        const baselines: SkuStagingDestinationBaseline[] = [];
        for (let index = 0; index < input.destinationPaths.length; index += 1) {
            const destinationPath = resolveRequiredLocalAbsolutePath(
                input.destinationPaths[index],
                `第 ${index + 1} 个 SKU 目标路径`
            );
            const destinationKey = normalizePathKey(destinationPath);
            if (!isPathInside(transaction.destinationRoot, destinationPath)
                || isPathInside(transaction.stagingParent, destinationPath)
                || destinationKeys.has(destinationKey)) {
                throw new Error(`SKU 目标基线路径越界或重复：${destinationPath}`);
            }
            destinationKeys.add(destinationKey);
            await assertNoReparsePointInExistingSegments(path.dirname(destinationPath));
            if (!await pathExists(destinationPath)) {
                baselines.push({ path: destinationPath, exists: false });
                continue;
            }
            const stableBaseline = await readStableFileBaseline(destinationPath);
            baselines.push({
                path: destinationPath,
                exists: true,
                ...stableBaseline
            });
        }
        if (transaction.phase !== 'issued') {
            throw new Error('SKU 目标基线读取期间事务阶段发生变化。');
        }
        transaction.destinationBaselines = new Map(baselines.map((baseline) => ([
            normalizePathKey(baseline.path),
            { ...baseline }
        ])));
        transaction.baselineCaptureInProgress = false;
        return { success: true, baselines };
    } catch (error: unknown) {
        if (transaction) transaction.baselineCaptureInProgress = false;
        return {
            success: false,
            error: String((error as Error)?.message || error || 'SKU 目标基线读取失败')
        };
    }
}

export async function removeSkuStagingTransactionRoot(
    transactionToken: unknown
): Promise<SkuStagingTransactionResult> {
    let recoveryPath: string | undefined;
    try {
        const transaction = getActiveTransaction(transactionToken);
        if (transaction.phase === 'promoting' || transaction.phase === 'recovery_required') {
            recoveryPath = transaction.stagingRoot;
            throw new Error(`SKU 暂存事务仍处于 ${transaction.phase}，拒绝递归清理。`);
        }
        if (!await pathExists(transaction.stagingRoot)) {
            transaction.phase = 'root_cleaned';
            return {
                success: true,
                removed: false,
                reason: 'missing',
                stagingRoot: transaction.stagingRoot
            };
        }
        const marker = await validateActiveTransactionMarker(transaction);
        const inspection = await inspectTransactionForReconciliation(marker);
        if (inspection.recoveryRequired) {
            recoveryPath = transaction.stagingRoot;
            throw new Error(`sku_staging_recovery_required: ${inspection.reason || transaction.stagingRoot}`);
        }
        await removeValidatedTransactionRoot(transaction.stagingRoot);
        transaction.phase = 'root_cleaned';
        return {
            success: true,
            removed: true,
            stagingRoot: transaction.stagingRoot
        };
    } catch (error: unknown) {
        const errorMessage = String((error as Error)?.message || error || 'SKU 暂存事务目录清理失败');
        return {
            success: false,
            removed: false,
            code: errorMessage.startsWith('sku_staging_recovery_required:')
                ? 'staging_recovery_required'
                : 'staging_transaction_cleanup_failed',
            error: errorMessage,
            ...(recoveryPath ? { recoveryPath } : {})
        };
    }
}

export async function removeSkuStagingParentIfEmpty(
    transactionToken: unknown
): Promise<SkuStagingTransactionResult> {
    try {
        const transaction = getActiveTransaction(transactionToken);
        if (transaction.phase !== 'root_cleaned') {
            throw new Error('必须先通过同一事务令牌清理 SKU 暂存事务根。');
        }
        await assertNoReparsePointInExistingSegments(transaction.destinationRoot);
        let removed = false;
        let reason: SkuStagingTransactionResult['reason'];
        try {
            await fsPromises.rmdir(transaction.stagingParent);
            removed = true;
        } catch (error: unknown) {
            const code = (error as NodeJS.ErrnoException)?.code;
            if (code === 'ENOENT') {
                reason = 'missing';
            } else if (code === 'ENOTEMPTY' || code === 'EEXIST') {
                reason = 'not_empty';
            } else {
                throw error;
            }
        }
        activeTransactions.delete(transaction.transactionToken);
        return {
            success: true,
            removed,
            ...(reason ? { reason } : {}),
            stagingParent: transaction.stagingParent
        };
    } catch (error: unknown) {
        return {
            success: false,
            removed: false,
            code: 'staging_parent_cleanup_failed',
            error: String((error as Error)?.message || error || 'SKU 暂存父目录清理失败')
        };
    }
}
