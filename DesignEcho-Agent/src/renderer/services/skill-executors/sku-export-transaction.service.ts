import {
    buildSkuExportReadback,
    type SkuExpectedExportInventoryItem
} from '../../../shared/sku-export-readback';
import {
    type RuntimeOwnedSkillDeliveryPlanBinding,
    type RuntimeOwnedSkillExternalDeliveryCommitReceipt
} from '../../../shared/agent-skill-atomic-tool-execution';
import type {
    StagedCommittedFileIdentity,
    SkuStagingDestinationBaseline,
    StagedFilePromotionInput
} from '../../../shared/sku-staging-transaction-contract';
import {
    promoteRuntimeBoundStagedDeliverySet
} from './staged-delivery-promotion.service';
import {
    captureStagedFileDestinationBaselines,
    finalizeStagedFileTransaction,
    issueStagedFileTransaction,
    joinStagedFilePath,
    normalizeStagedFilePath,
    type StagedFileTransaction,
    type StagedFileTransactionHost
} from './staged-file-transaction.service';

export interface SkuExportTransactionHost extends StagedFileTransactionHost {
    invoke?: (channel: string, ...args: unknown[]) => Promise<any>;
    probeImageFile?: (filePath: string) => Promise<any>;
}

export type SkuIssuedStagingTransaction = StagedFileTransaction;

export interface SkuStagedRasterExport {
    tempPath: string;
    tempPathKey: string;
    finalPath: string;
    finalPathKey: string;
    expectedDimensions?: { width: number; height: number };
}

export interface SkuStagedDeliveryResult {
    success: boolean;
    error?: string;
    warnings?: string[];
    /** 回滚不完整时由 main 文件事务保留的人工恢复位置。 */
    recoveryPath?: string;
    /** 为 true 时上层不得清理 staging root 或其父目录。 */
    preserveStagingRoot?: boolean;
    committedPaths?: string[];
    committedFiles?: StagedCommittedFileIdentity[];
    runtimeDeliveryCommitReceipt?: RuntimeOwnedSkillExternalDeliveryCommitReceipt;
}

export type SkuExportFileBaseline = SkuStagingDestinationBaseline;

export interface SkuExportFreshnessProof {
    verified: boolean;
    proof: 'new_path' | 'modified_since_baseline' | 'unverified';
    error?: string;
}

function currentHost(): SkuExportTransactionHost {
    return (window as any).designEcho || {};
}

function normalizePositiveInteger(value: unknown): number | undefined {
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : undefined;
}

function isProbeableExportPath(filePath: string): boolean {
    return /\.(?:jpe?g|png|webp)$/i.test(String(filePath || '').trim());
}

export function normalizeSkuExportPathForCompare(input: string): string {
    return normalizeStagedFilePath(input);
}

export function joinSkuExportPath(root: string, ...segments: string[]): string {
    return joinStagedFilePath(root, ...segments);
}

export function isSkuPathInsideDirectory(filePath?: string, directory?: string): boolean {
    const normalizedFile = normalizeSkuExportPathForCompare(filePath || '');
    const normalizedDir = normalizeSkuExportPathForCompare(directory || '');
    if (!normalizedFile || !normalizedDir) return false;
    return normalizedFile === normalizedDir || normalizedFile.startsWith(`${normalizedDir}/`);
}

function parseFileModifiedTimeMs(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : undefined;
}

async function readCurrentSkuExportFileState(
    filePath: string,
    host: SkuExportTransactionHost
): Promise<SkuExportFileBaseline> {
    if (typeof host.invoke !== 'function') throw new Error('SKU 文件基线读取能力不可用。');
    const exists = await host.invoke('fs:exists', filePath);
    if (exists !== true) return { path: filePath, exists: false };
    const info = await host.invoke('fs:getFileInfo', filePath);
    if (!info || info.isFile !== true) {
        throw new Error(`SKU 计划导出路径不是普通文件：${filePath}`);
    }
    const modifiedTimeMs = parseFileModifiedTimeMs(info.modified);
    if (modifiedTimeMs === undefined) {
        throw new Error(`SKU 计划导出路径缺少可比较的修改时间：${filePath}`);
    }
    return {
        path: filePath,
        exists: true,
        modifiedTimeMs,
        byteLength: normalizePositiveInteger(info.size)
    };
}

export async function captureSkuExportPathBaselines(
    paths: readonly string[],
    transactionToken: string,
    host: SkuExportTransactionHost = currentHost()
): Promise<Map<string, SkuExportFileBaseline>> {
    return captureStagedFileDestinationBaselines(paths, transactionToken, host);
}

export async function verifySkuExportFreshness(input: {
    filePath: string;
    baseline?: SkuExportFileBaseline;
    host?: SkuExportTransactionHost;
}): Promise<SkuExportFreshnessProof> {
    if (!input.baseline) {
        return { verified: false, proof: 'unverified', error: '缺少执行前文件基线。' };
    }
    let current: SkuExportFileBaseline;
    try {
        current = await readCurrentSkuExportFileState(input.filePath, input.host || currentHost());
    } catch (error) {
        return {
            verified: false,
            proof: 'unverified',
            error: error instanceof Error ? error.message : String(error)
        };
    }
    if (!current.exists) {
        return { verified: false, proof: 'unverified', error: '本次导出后文件仍不存在。' };
    }
    if (!input.baseline.exists) return { verified: true, proof: 'new_path' };
    if (current.modifiedTimeMs !== undefined
        && input.baseline.modifiedTimeMs !== undefined
        && current.modifiedTimeMs > input.baseline.modifiedTimeMs) {
        return { verified: true, proof: 'modified_since_baseline' };
    }
    return {
        verified: false,
        proof: 'unverified',
        error: '文件修改时间没有晚于本次执行前基线，不能排除旧文件。'
    };
}

export async function issueSkuStagingTransaction(
    outputDir: string,
    projectRoot: string,
    host: SkuExportTransactionHost = currentHost()
): Promise<SkuIssuedStagingTransaction> {
    return issueStagedFileTransaction(outputDir, projectRoot, host);
}

/** 解析暂存导出回执，同时确定唯一正式目标；不把暂存路径提前计入交付。 */
export function parseSkuStagedRasterExport(input: {
    rawFileInfo: string;
    stagingRoot: string;
    outputDir: string;
    expectedStagedPath?: string;
    expectedFinalPath: string;
    expectedDimensions?: { width: number; height: number };
}): { success: boolean; artifact?: SkuStagedRasterExport; error?: string } {
    let info: Record<string, unknown>;
    try {
        info = JSON.parse(String(input.rawFileInfo || '')) as Record<string, unknown>;
    } catch {
        return { success: false, error: 'SKU 暂存位图导出回执不是有效 JSON。' };
    }
    if (String(info.status || '') !== 'exported_jsx') {
        return {
            success: false,
            error: `SKU 暂存位图导出回执状态必须为 exported_jsx，实际为 ${String(info.status || 'missing')}。`
        };
    }
    const tempPath = String(info.path || '').trim();
    const stagingRoot = String(input.stagingRoot || '').trim().replace(/[\\/]+$/, '');
    const outputDir = String(input.outputDir || '').trim().replace(/[\\/]+$/, '');
    const expectedStagedPath = String(input.expectedStagedPath || '').trim();
    const expectedFinalPath = String(input.expectedFinalPath || '').trim();
    if (!tempPath
        || !stagingRoot
        || !outputDir
        || !expectedFinalPath
        || !isSkuPathInsideDirectory(tempPath, stagingRoot)
        || (expectedStagedPath && !isSkuPathInsideDirectory(expectedStagedPath, stagingRoot))
        || !isSkuPathInsideDirectory(expectedFinalPath, outputDir)) {
        return {
            success: false,
            error: `SKU 暂存位图回执或计划路径不在本次受控目录内：${tempPath || '(空)'}`
        };
    }
    const normalizedTempPath = normalizeSkuExportPathForCompare(tempPath);
    const normalizedStagingRoot = normalizeSkuExportPathForCompare(stagingRoot);
    const normalizedFinalPath = normalizeSkuExportPathForCompare(expectedFinalPath);
    const normalizedOutputDir = normalizeSkuExportPathForCompare(outputDir);
    const relativeSegments = normalizedTempPath
        .slice(normalizedStagingRoot.length)
        .replace(/^[\\/]+/, '')
        .split(/[\\/]+/)
        .filter(Boolean);
    const expectedRelativeSegments = normalizedFinalPath
        .slice(normalizedOutputDir.length)
        .replace(/^[\\/]+/, '')
        .split(/[\\/]+/)
        .filter(Boolean);
    const stagedPathMatches = expectedStagedPath
        ? normalizeSkuExportPathForCompare(tempPath) === normalizeSkuExportPathForCompare(expectedStagedPath)
        : relativeSegments.join('/') === expectedRelativeSegments.join('/');
    if (relativeSegments.length < 2
        || expectedRelativeSegments.length < 1
        || relativeSegments.some((segment) => segment === '.' || segment === '..')
        || expectedRelativeSegments.some((segment) => segment === '.' || segment === '..')
        || !stagedPathMatches) {
        return {
            success: false,
            error: `SKU 暂存位图路径与执行前精确计划不一致：${relativeSegments.join('\\') || '(空)'}`
        };
    }
    const targetName = String(info.targetName || '').trim();
    const expectedFileName = expectedStagedPath
        ? expectedStagedPath.split(/[\\/]+/).at(-1) || ''
        : expectedRelativeSegments.at(-1) || '';
    if (targetName && targetName.toLowerCase() !== expectedFileName.toLowerCase()) {
        return { success: false, error: `SKU 暂存位图文件名与执行前精确计划不一致：${targetName}` };
    }
    const tempPathKey = normalizeSkuExportPathForCompare(tempPath);
    const finalPathKey = normalizeSkuExportPathForCompare(expectedFinalPath);
    if (!tempPathKey || !finalPathKey || tempPathKey === finalPathKey) {
        return { success: false, error: 'SKU 暂存位图路径与正式路径无法安全区分。' };
    }
    return {
        success: true,
        artifact: {
            tempPath,
            tempPathKey,
            finalPath: expectedFinalPath,
            finalPathKey,
            expectedDimensions: input.expectedDimensions
        }
    };
}

export async function validateSkuStagedRasterExports(
    artifacts: SkuStagedRasterExport[],
    host: SkuExportTransactionHost = currentHost()
): Promise<SkuStagedDeliveryResult> {
    if (artifacts.length === 0) return { success: false, error: 'SKU 没有可验收的暂存位图。' };
    if (typeof host.probeImageFile !== 'function') {
        return { success: false, error: 'SKU 暂存位图探针不可用，无法确认导出结果。' };
    }
    const fileProbes: any[] = [];
    for (const artifact of artifacts) {
        if (!isProbeableExportPath(artifact.tempPath)) {
            fileProbes.push({
                success: false,
                path: artifact.tempPath,
                status: 'unsupported_format',
                rawImagesRedacted: true,
                error: 'SKU 暂存文件不是支持验收的图片格式。'
            });
            continue;
        }
        try {
            const probe = await host.probeImageFile(artifact.tempPath);
            fileProbes.push(probe
                ? { ...probe, path: artifact.tempPath }
                : {
                    success: false,
                    path: artifact.tempPath,
                    status: 'decode_failed',
                    rawImagesRedacted: true,
                    error: 'SKU 暂存文件没有返回图片探针结果。'
                });
        } catch (error) {
            fileProbes.push({
                success: false,
                path: artifact.tempPath,
                status: 'decode_failed',
                rawImagesRedacted: true,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }
    const readback = buildSkuExportReadback({
        expectedExports: artifacts.map((artifact) => ({
            path: artifact.tempPath,
            expectedDimensions: artifact.expectedDimensions
        })),
        actualExportPaths: artifacts.map((artifact) => artifact.tempPath),
        fileProbes
    });
    if (readback.status !== 'ready_for_review') {
        return {
            success: false,
            error: [...readback.blockers, ...readback.warnings].join('；')
                || `SKU 暂存位图验收状态为 ${readback.status}。`
        };
    }
    return { success: true };
}

export async function finalizeSkuStagingCleanup(input: {
    transaction: SkuIssuedStagingTransaction;
    preserveStagingRoot: boolean;
    recoveryPath?: string;
    host?: SkuExportTransactionHost;
}): Promise<SkuStagedDeliveryResult> {
    return finalizeStagedFileTransaction(input);
}

export async function promoteSkuStagedDeliverySet(input: {
    expectedItems: readonly SkuExpectedExportInventoryItem[];
    rasterArtifacts: ReadonlyMap<string, SkuStagedRasterExport>;
    editableArtifacts: ReadonlyMap<string, { stagedPath: string; finalPath: string }>;
    destinationBaselines: ReadonlyMap<string, SkuExportFileBaseline>;
    transaction: SkuIssuedStagingTransaction;
    runtimeDeliveryPlanBinding: RuntimeOwnedSkillDeliveryPlanBinding;
}): Promise<SkuStagedDeliveryResult> {
    if (input.expectedItems.length === 0
        || input.rasterArtifacts.size !== input.expectedItems.length
        || input.editableArtifacts.size !== input.expectedItems.length) {
        return {
            success: false,
            error: `SKU ${input.expectedItems.length * 2} 文件事务缺少完整的 Runtime 冻结 JPG/PSB 配对集合。`
        };
    }
    const frozenPlan = input.runtimeDeliveryPlanBinding.plan;
    const expectedPlanPaths = input.expectedItems.flatMap((item) => [item.path, item.editablePath])
        .map(normalizeSkuExportPathForCompare)
        .sort();
    const frozenPlanPaths = frozenPlan.artifacts
        .map((artifact) => normalizeSkuExportPathForCompare(artifact.path))
        .sort();
    if (frozenPlanPaths.length !== expectedPlanPaths.length
        || frozenPlanPaths.some((filePath, index) => filePath !== expectedPlanPaths[index])) {
        return {
            success: false,
            error: 'SKU Main 文件事务目标与 Runtime 冻结交付计划不一致。'
        };
    }
    const items: Array<StagedFilePromotionInput['items'][number] & { artifactId: string }> = [];
    for (const expected of input.expectedItems) {
        const raster = input.rasterArtifacts.get(expected.id);
        const editable = input.editableArtifacts.get(expected.id);
        const rasterBaseline = input.destinationBaselines.get(
            normalizeSkuExportPathForCompare(expected.path)
        );
        const editableBaseline = input.destinationBaselines.get(
            normalizeSkuExportPathForCompare(expected.editablePath)
        );
        if (!raster
            || !editable
            || !rasterBaseline
            || !editableBaseline
            || normalizeSkuExportPathForCompare(raster.finalPath)
                !== normalizeSkuExportPathForCompare(expected.path)
            || normalizeSkuExportPathForCompare(editable.finalPath)
                !== normalizeSkuExportPathForCompare(expected.editablePath)
            || !isSkuPathInsideDirectory(raster.tempPath, input.transaction.stagingRoot)
            || !isSkuPathInsideDirectory(editable.stagedPath, input.transaction.stagingRoot)) {
            return { success: false, error: `SKU 配对事务与冻结清单不一致：${expected.id}` };
        }
        items.push({
            artifactId: `sku:${expected.id}:raster`,
            sourcePath: raster.tempPath,
            destinationPath: expected.path,
            expectedDestinationBaseline: rasterBaseline
        });
        items.push({
            artifactId: `sku:${expected.id}:editable`,
            sourcePath: editable.stagedPath,
            destinationPath: expected.editablePath,
            expectedDestinationBaseline: editableBaseline
        });
    }
    const promoted = await promoteRuntimeBoundStagedDeliverySet({
        transactionToken: input.transaction.transactionToken,
        label: 'SKU 成对交付',
        items,
        runtimeDeliveryPlanBinding: input.runtimeDeliveryPlanBinding
    });
    if (!promoted.success
        || !promoted.committedFiles
        || promoted.committedFiles.length !== frozenPlan.artifacts.length) {
        return promoted;
    }
    return promoted;
}
