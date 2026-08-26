import {
    buildSkuExportReadback,
    type SkuExpectedExportInventoryItem
} from '../../../shared/sku-export-readback';
import type {
    CaptureSkuStagingDestinationBaselinesResult,
    SkuStagingDestinationBaseline,
    SkuStagingTransactionResult,
    StagedFilePromotionInput,
    StagedFilePromotionResult
} from '../../../shared/sku-staging-transaction-contract';

export interface SkuExportTransactionHost {
    invoke?: (channel: string, ...args: unknown[]) => Promise<any>;
    probeImageFile?: (filePath: string) => Promise<any>;
    issueSkuStagingTransaction?: (outputDir: string) => Promise<SkuStagingTransactionResult>;
    captureSkuStagingDestinationBaselines?: (
        transactionToken: string,
        destinationPaths: string[]
    ) => Promise<CaptureSkuStagingDestinationBaselinesResult>;
    promoteStagedFileSet?: (
        input: StagedFilePromotionInput
    ) => Promise<StagedFilePromotionResult>;
    removeSkuStagingParentIfEmpty?: (transactionToken: string) => Promise<SkuStagingTransactionResult>;
    removeSkuStagingTransactionRoot?: (transactionToken: string) => Promise<SkuStagingTransactionResult>;
}

export interface SkuIssuedStagingTransaction {
    transactionToken: string;
    transactionId: string;
    stagingRoot: string;
    stagingParent: string;
    outputDir: string;
}

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
    return String(input || '')
        .trim()
        .replace(/\//g, '\\')
        .replace(/\\+$/, '')
        .toLowerCase();
}

export function isSkuPathInsideDirectory(filePath?: string, directory?: string): boolean {
    const normalizedFile = normalizeSkuExportPathForCompare(filePath || '');
    const normalizedDir = normalizeSkuExportPathForCompare(directory || '');
    if (!normalizedFile || !normalizedDir) return false;
    return normalizedFile === normalizedDir || normalizedFile.startsWith(`${normalizedDir}\\`);
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
    if (typeof host.captureSkuStagingDestinationBaselines !== 'function') {
        throw new Error('SKU 主进程文件身份基线能力不可用。');
    }
    const normalizedToken = String(transactionToken || '').trim();
    const requestedPaths = paths.map((filePath) => String(filePath || '').trim());
    if (!normalizedToken || requestedPaths.length === 0 || requestedPaths.some((filePath) => !filePath)) {
        throw new Error('SKU 文件身份基线请求缺少事务令牌或目标路径。');
    }
    let result: CaptureSkuStagingDestinationBaselinesResult;
    try {
        result = await host.captureSkuStagingDestinationBaselines(normalizedToken, requestedPaths);
    } catch (error) {
        throw new Error(`SKU 文件身份基线读取响应中断：${error instanceof Error ? error.message : String(error)}`);
    }
    if (result?.success !== true || !Array.isArray(result.baselines)) {
        throw new Error(String(result?.error || 'SKU 文件身份基线读取失败。'));
    }
    if (result.baselines.length !== requestedPaths.length) {
        throw new Error('SKU 文件身份基线数量与冻结目标不一致。');
    }
    const baselines = new Map<string, SkuExportFileBaseline>();
    for (let index = 0; index < requestedPaths.length; index += 1) {
        const filePath = requestedPaths[index];
        const baseline = result.baselines[index];
        const pathKey = normalizeSkuExportPathForCompare(filePath);
        const baselinePathKey = normalizeSkuExportPathForCompare(baseline?.path || '');
        const identityComplete = baseline?.exists !== true || Boolean(
            Number.isFinite(Number(baseline.modifiedTimeMs))
            && Number.isSafeInteger(Number(baseline.byteLength))
            && Number(baseline.byteLength) > 0
            && /^[a-f0-9]{64}$/i.test(String(baseline.sha256 || ''))
        );
        if (!pathKey
            || baselinePathKey !== pathKey
            || (baseline?.exists !== true && baseline?.exists !== false)
            || !identityComplete
            || baselines.has(pathKey)) {
            throw new Error(`SKU 第 ${index + 1} 个文件身份基线无效或与冻结路径不一致。`);
        }
        baselines.set(pathKey, {
            path: filePath,
            exists: baseline.exists,
            ...(baseline.exists ? {
                modifiedTimeMs: Number(baseline.modifiedTimeMs),
                byteLength: Number(baseline.byteLength),
                sha256: String(baseline.sha256).toLowerCase()
            } : {})
        });
    }
    return baselines;
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
    host: SkuExportTransactionHost = currentHost()
): Promise<SkuIssuedStagingTransaction> {
    if (typeof host.issueSkuStagingTransaction !== 'function') {
        throw new Error('SKU 主进程事务签发能力不可用。');
    }
    const requestedOutputDir = String(outputDir || '').trim();
    let result: SkuStagingTransactionResult;
    try {
        result = await host.issueSkuStagingTransaction(requestedOutputDir);
    } catch (error) {
        throw new Error(`SKU 暂存事务签发响应中断：${error instanceof Error ? error.message : String(error)}`);
    }
    if (result?.success !== true) {
        const recoveryPath = String(result?.recoveryPath || '').trim();
        throw new Error(
            `${String(result?.error || 'SKU 暂存事务签发失败。')}`
            + (recoveryPath ? ` 恢复现场：${recoveryPath}` : '')
        );
    }
    const transactionToken = String(result.transactionToken || '').trim();
    const transactionId = String(result.transactionId || '').trim();
    const stagingRoot = String(result.stagingRoot || '').trim();
    const stagingParent = String(result.stagingParent || '').trim();
    const settledOutputDir = String(result.outputDir || '').trim();
    if (!transactionToken
        || !transactionId
        || !stagingRoot
        || !stagingParent
        || normalizeSkuExportPathForCompare(settledOutputDir)
            !== normalizeSkuExportPathForCompare(requestedOutputDir)
        || normalizeSkuExportPathForCompare(stagingRoot).startsWith(
            `${normalizeSkuExportPathForCompare(stagingParent)}\\`
        ) !== true
        || normalizeSkuExportPathForCompare(stagingParent)
            !== `${normalizeSkuExportPathForCompare(settledOutputDir)}\\.designecho-staging`) {
        throw new Error('SKU 主进程事务签发回执与请求目录不一致。');
    }
    return {
        transactionToken,
        transactionId,
        stagingRoot,
        stagingParent,
        outputDir: settledOutputDir
    };
}

/** 解析暂存导出回执，同时确定唯一正式目标；不把暂存路径提前计入交付。 */
export function parseSkuStagedRasterExport(input: {
    rawFileInfo: string;
    stagingRoot: string;
    outputDir: string;
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
    const tempPath = String(info.path || '').trim().replace(/\//g, '\\');
    const stagingRoot = String(input.stagingRoot || '').trim().replace(/\//g, '\\').replace(/\\+$/, '');
    const outputDir = String(input.outputDir || '').trim().replace(/\//g, '\\').replace(/\\+$/, '');
    const expectedFinalPath = String(input.expectedFinalPath || '').trim().replace(/\//g, '\\');
    if (!tempPath
        || !stagingRoot
        || !outputDir
        || !expectedFinalPath
        || !isSkuPathInsideDirectory(tempPath, stagingRoot)
        || !isSkuPathInsideDirectory(expectedFinalPath, outputDir)) {
        return {
            success: false,
            error: `SKU 暂存位图回执或计划路径不在本次受控目录内：${tempPath || '(空)'}`
        };
    }
    const relativeSegments = tempPath
        .slice(stagingRoot.length)
        .replace(/^[\\/]+/, '')
        .split(/[\\/]+/)
        .filter(Boolean);
    const expectedRelativeSegments = expectedFinalPath
        .slice(outputDir.length)
        .replace(/^[\\/]+/, '')
        .split(/[\\/]+/)
        .filter(Boolean);
    if (relativeSegments.length < 2
        || expectedRelativeSegments.length < 2
        || relativeSegments.some((segment) => segment === '.' || segment === '..')
        || expectedRelativeSegments.some((segment) => segment === '.' || segment === '..')
        || relativeSegments.join('\\').toLowerCase() !== expectedRelativeSegments.join('\\').toLowerCase()) {
        return {
            success: false,
            error: `SKU 暂存位图路径与执行前精确计划不一致：${relativeSegments.join('\\') || '(空)'}`
        };
    }
    const targetName = String(info.targetName || '').trim();
    const expectedFileName = expectedRelativeSegments.at(-1) || '';
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

export async function cleanupSkuStagingPaths(
    transactionToken: string,
    host: SkuExportTransactionHost = currentHost()
): Promise<SkuStagedDeliveryResult> {
    if (typeof host.removeSkuStagingTransactionRoot !== 'function') {
        return { success: false, error: 'SKU 暂存事务根清理能力不可用。' };
    }
    const token = String(transactionToken || '').trim();
    if (!token) return { success: false, error: 'SKU 暂存事务根清理缺少主进程令牌。' };
    let result: SkuStagingTransactionResult;
    try {
        result = await host.removeSkuStagingTransactionRoot(token);
    } catch (error) {
        return {
            success: false,
            error: `SKU 暂存事务根清理响应中断：${error instanceof Error ? error.message : String(error)}`
        };
    }
    if (result?.success !== true) {
        return {
            success: false,
            preserveStagingRoot: true,
            ...(result?.recoveryPath ? { recoveryPath: result.recoveryPath } : {}),
            error: `无法清理 SKU 暂存事务：${String(result?.error || '未知错误')}`
        };
    }
    return { success: true };
}

export async function cleanupSkuStagingParentIfEmpty(
    transactionToken: string,
    host: SkuExportTransactionHost = currentHost()
): Promise<SkuStagedDeliveryResult> {
    if (typeof host.removeSkuStagingParentIfEmpty !== 'function') {
        return { success: false, error: 'SKU 空暂存目录清理能力不可用。' };
    }
    let result: any;
    try {
        result = await host.removeSkuStagingParentIfEmpty(String(transactionToken || '').trim());
    } catch (error) {
        return {
            success: false,
            error: `SKU 空暂存目录清理响应中断：${error instanceof Error ? error.message : String(error)}`
        };
    }
    if (result?.success === true || result?.reason === 'not_empty') return { success: true };
    return { success: false, error: String(result?.error || 'SKU 空暂存目录清理失败。') };
}

export async function finalizeSkuStagingCleanup(input: {
    transaction: SkuIssuedStagingTransaction;
    preserveStagingRoot: boolean;
    recoveryPath?: string;
    host?: SkuExportTransactionHost;
}): Promise<SkuStagedDeliveryResult> {
    if (input.preserveStagingRoot) {
        return {
            success: true,
            preserveStagingRoot: true,
            ...(input.recoveryPath ? { recoveryPath: input.recoveryPath } : {}),
            warnings: [input.recoveryPath
                ? `原交付文件回滚未完成，暂存与备份已保留在：${input.recoveryPath}`
                : `原交付文件回滚未完成，暂存目录已保留：${input.transaction.stagingRoot}`]
        };
    }
    const stagingCleanup = await cleanupSkuStagingPaths(
        input.transaction.transactionToken,
        input.host
    );
    if (!stagingCleanup.success) return stagingCleanup;
    return cleanupSkuStagingParentIfEmpty(input.transaction.transactionToken, input.host);
}

async function promoteSkuStagedFiles(input: {
    transactionToken: string;
    items: StagedFilePromotionInput['items'];
    label: string;
    host?: SkuExportTransactionHost;
}): Promise<SkuStagedDeliveryResult> {
    const host = input.host || currentHost();
    if (typeof host.promoteStagedFileSet !== 'function') {
        return { success: false, error: 'SKU 暂存文件提交能力不可用。' };
    }
    let result: StagedFilePromotionResult;
    try {
        result = await host.promoteStagedFileSet({
            transactionToken: input.transactionToken,
            items: input.items
        });
    } catch (error) {
        return {
            success: false,
            preserveStagingRoot: true,
            error: `${input.label}提交响应中断，文件写入状态未知，已保留暂存目录：${error instanceof Error ? error.message : String(error)}`
        };
    }
    if (result?.success !== true) {
        const recoveryPath = String(result?.recoveryPath || '').trim();
        const preserveStagingRoot = result?.rollbackComplete !== true || Boolean(recoveryPath);
        return {
            success: false,
            error: `${input.label}提交失败：${String(result?.error || '未知错误')}`
                + (preserveStagingRoot ? '；原文件回滚未完整完成，已停止继续交付并保留恢复备份。' : ''),
            ...(recoveryPath ? { recoveryPath } : {}),
            ...(preserveStagingRoot ? { preserveStagingRoot: true } : {})
        };
    }
    const expectedPaths = input.items.map((item) => normalizeSkuExportPathForCompare(item.destinationPath));
    const committedPaths = Array.isArray(result.committedPaths)
        ? result.committedPaths.map(normalizeSkuExportPathForCompare)
        : [];
    if (committedPaths.length !== expectedPaths.length
        || !expectedPaths.every((filePath, index) => filePath === committedPaths[index])) {
        return {
            success: false,
            preserveStagingRoot: true,
            error: `${input.label}提交回执与执行前精确计划不一致，文件写入状态未知，已保留暂存目录。`
        };
    }
    return {
        success: true,
        committedPaths: input.items.map((item) => item.destinationPath),
        warnings: Array.isArray(result.cleanupWarnings)
            ? result.cleanupWarnings.map((warning: unknown) => String(warning || '').trim()).filter(Boolean)
            : []
    };
}

export async function promoteSkuStagedDeliverySet(input: {
    expectedItems: readonly SkuExpectedExportInventoryItem[];
    rasterArtifacts: ReadonlyMap<string, SkuStagedRasterExport>;
    editableArtifacts: ReadonlyMap<string, { stagedPath: string; finalPath: string }>;
    destinationBaselines: ReadonlyMap<string, SkuExportFileBaseline>;
    transaction: SkuIssuedStagingTransaction;
    host?: SkuExportTransactionHost;
}): Promise<SkuStagedDeliveryResult> {
    if (input.expectedItems.length === 0
        || input.rasterArtifacts.size !== input.expectedItems.length
        || input.editableArtifacts.size !== input.expectedItems.length) {
        return {
            success: false,
            error: `SKU ${input.expectedItems.length * 2} 文件事务缺少完整的冻结 JPG/PSB 配对集合。`
        };
    }
    const items: StagedFilePromotionInput['items'] = [];
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
            sourcePath: raster.tempPath,
            destinationPath: expected.path,
            expectedDestinationBaseline: rasterBaseline
        });
        items.push({
            sourcePath: editable.stagedPath,
            destinationPath: expected.editablePath,
            expectedDestinationBaseline: editableBaseline
        });
    }
    return promoteSkuStagedFiles({
        transactionToken: input.transaction.transactionToken,
        label: 'SKU 成对交付',
        items,
        ...(input.host ? { host: input.host } : {})
    });
}
