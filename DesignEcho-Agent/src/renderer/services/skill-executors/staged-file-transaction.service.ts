import { normalizeSkillDeliveryArtifactPath } from '../../../shared/skills/skill-delivery-convention';
import type {
    CaptureSkuStagingDestinationBaselinesResult,
    IssueSkuStagingTransactionInput,
    SkuStagingDestinationBaseline,
    SkuStagingTransactionResult
} from '../../../shared/sku-staging-transaction-contract';

/**
 * 通用 Renderer 文件事务边界。
 *
 * Main IPC 名称暂时保留历史 sku 前缀以兼容已发布 preload；业务调用者只消费
 * 这里的通用类型和函数，不能再依赖 SKU executor 来取得事务能力。
 */
export interface StagedFileTransactionHost {
    issueSkuStagingTransaction?: (
        input: IssueSkuStagingTransactionInput
    ) => Promise<SkuStagingTransactionResult>;
    captureSkuStagingDestinationBaselines?: (
        transactionToken: string,
        destinationPaths: string[]
    ) => Promise<CaptureSkuStagingDestinationBaselinesResult>;
    removeSkuStagingParentIfEmpty?: (transactionToken: string) => Promise<SkuStagingTransactionResult>;
    removeSkuStagingTransactionRoot?: (transactionToken: string) => Promise<SkuStagingTransactionResult>;
}

export interface StagedFileTransaction {
    transactionToken: string;
    transactionId: string;
    stagingRoot: string;
    stagingParent: string;
    outputDir: string;
}

export type StagedFileDestinationBaseline = SkuStagingDestinationBaseline;

export interface StagedFileTransactionResult {
    success: boolean;
    error?: string;
    warnings?: string[];
    recoveryPath?: string;
    preserveStagingRoot?: boolean;
}

function currentHost(): StagedFileTransactionHost {
    return (window as any).designEcho || {};
}

export function normalizeStagedFilePath(input: string): string {
    return normalizeSkillDeliveryArtifactPath(input).replace(/\/+$/g, '');
}

export function joinStagedFilePath(root: string, ...segments: string[]): string {
    const rawRoot = String(root || '').trim();
    const windowsStyle = /^[a-z]:[\\/]/i.test(rawRoot)
        || rawRoot.startsWith('\\\\')
        || rawRoot.includes('\\');
    const separator = windowsStyle ? '\\' : '/';
    const base = rawRoot === separator ? '' : rawRoot.replace(/[\\/]+$/g, '');
    const relative = segments
        .flatMap((segment) => String(segment || '').split(/[\\/]+/))
        .map((segment) => segment.trim())
        .filter(Boolean)
        .join(separator);
    return `${base}${separator}${relative}`;
}

export async function captureStagedFileDestinationBaselines(
    paths: readonly string[],
    transactionToken: string,
    host: StagedFileTransactionHost = currentHost()
): Promise<Map<string, StagedFileDestinationBaseline>> {
    if (typeof host.captureSkuStagingDestinationBaselines !== 'function') {
        throw new Error('主进程文件身份基线能力不可用。');
    }
    const normalizedToken = String(transactionToken || '').trim();
    const requestedPaths = paths.map((filePath) => String(filePath || '').trim());
    if (!normalizedToken || requestedPaths.length === 0 || requestedPaths.some((filePath) => !filePath)) {
        throw new Error('文件身份基线请求缺少事务令牌或目标路径。');
    }
    let result: CaptureSkuStagingDestinationBaselinesResult;
    try {
        result = await host.captureSkuStagingDestinationBaselines(normalizedToken, requestedPaths);
    } catch (error) {
        throw new Error(`文件身份基线读取响应中断：${error instanceof Error ? error.message : String(error)}`);
    }
    if (result?.success !== true || !Array.isArray(result.baselines)) {
        throw new Error(String(result?.error || '文件身份基线读取失败。'));
    }
    if (result.baselines.length !== requestedPaths.length) {
        throw new Error('文件身份基线数量与冻结目标不一致。');
    }
    const baselines = new Map<string, StagedFileDestinationBaseline>();
    for (let index = 0; index < requestedPaths.length; index += 1) {
        const filePath = requestedPaths[index];
        const baseline = result.baselines[index];
        const pathKey = normalizeStagedFilePath(filePath);
        const baselinePathKey = normalizeStagedFilePath(baseline?.path || '');
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
            throw new Error(`第 ${index + 1} 个文件身份基线无效或与冻结路径不一致。`);
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

export async function issueStagedFileTransaction(
    outputDir: string,
    projectRoot: string,
    host: StagedFileTransactionHost = currentHost()
): Promise<StagedFileTransaction> {
    if (typeof host.issueSkuStagingTransaction !== 'function') {
        throw new Error('主进程文件事务签发能力不可用。');
    }
    const requestedOutputDir = String(outputDir || '').trim();
    const requestedProjectRoot = String(projectRoot || '').trim();
    if (!requestedOutputDir || !requestedProjectRoot) {
        throw new Error('文件事务缺少项目根或交付目录。');
    }
    let result: SkuStagingTransactionResult;
    try {
        result = await host.issueSkuStagingTransaction({
            outputDir: requestedOutputDir,
            projectRoot: requestedProjectRoot
        });
    } catch (error) {
        throw new Error(`文件事务签发响应中断：${error instanceof Error ? error.message : String(error)}`);
    }
    if (result?.success !== true) {
        const recoveryPath = String(result?.recoveryPath || '').trim();
        throw new Error(
            `${String(result?.error || '文件事务签发失败。')}`
            + (recoveryPath ? ` 恢复位置：${recoveryPath}` : '')
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
        || normalizeStagedFilePath(settledOutputDir)
            !== normalizeStagedFilePath(requestedOutputDir)
        || normalizeStagedFilePath(stagingRoot).startsWith(
            `${normalizeStagedFilePath(stagingParent)}/`
        ) !== true
        || normalizeStagedFilePath(stagingParent)
            !== normalizeStagedFilePath(joinStagedFilePath(settledOutputDir, '.designecho-staging'))) {
        throw new Error('主进程文件事务签发回执与请求目录不一致。');
    }
    return Object.freeze({
        transactionToken,
        transactionId,
        stagingRoot,
        stagingParent,
        outputDir: settledOutputDir
    });
}

async function cleanupStagedFileRoot(
    transactionToken: string,
    host: StagedFileTransactionHost
): Promise<StagedFileTransactionResult> {
    if (typeof host.removeSkuStagingTransactionRoot !== 'function') {
        return { success: false, error: '临时文件事务根清理能力不可用。' };
    }
    let result: SkuStagingTransactionResult;
    try {
        result = await host.removeSkuStagingTransactionRoot(String(transactionToken || '').trim());
    } catch (error) {
        return {
            success: false,
            error: `临时文件事务根清理响应中断：${error instanceof Error ? error.message : String(error)}`
        };
    }
    if (result?.success === true) return { success: true };
    return {
        success: false,
        preserveStagingRoot: true,
        ...(result?.recoveryPath ? { recoveryPath: result.recoveryPath } : {}),
        error: `无法清理临时文件事务：${String(result?.error || '未知错误')}`
    };
}

async function cleanupStagedFileParentIfEmpty(
    transactionToken: string,
    host: StagedFileTransactionHost
): Promise<StagedFileTransactionResult> {
    if (typeof host.removeSkuStagingParentIfEmpty !== 'function') {
        return { success: false, error: '空临时文件目录清理能力不可用。' };
    }
    let result: SkuStagingTransactionResult;
    try {
        result = await host.removeSkuStagingParentIfEmpty(String(transactionToken || '').trim());
    } catch (error) {
        return {
            success: false,
            error: `空临时文件目录清理响应中断：${error instanceof Error ? error.message : String(error)}`
        };
    }
    if (result?.success === true || result?.reason === 'not_empty') return { success: true };
    return { success: false, error: String(result?.error || '空临时文件目录清理失败。') };
}

export async function finalizeStagedFileTransaction(input: {
    transaction: StagedFileTransaction;
    preserveStagingRoot: boolean;
    recoveryPath?: string;
    host?: StagedFileTransactionHost;
}): Promise<StagedFileTransactionResult> {
    if (input.preserveStagingRoot) {
        return {
            success: true,
            preserveStagingRoot: true,
            ...(input.recoveryPath ? { recoveryPath: input.recoveryPath } : {}),
            warnings: [input.recoveryPath
                ? `文件回滚未完成，临时文件与备份已保留在：${input.recoveryPath}`
                : `文件回滚未完成，临时文件目录已保留：${input.transaction.stagingRoot}`]
        };
    }
    const host = input.host || currentHost();
    const rootCleanup = await cleanupStagedFileRoot(input.transaction.transactionToken, host);
    if (!rootCleanup.success) return rootCleanup;
    return cleanupStagedFileParentIfEmpty(input.transaction.transactionToken, host);
}
