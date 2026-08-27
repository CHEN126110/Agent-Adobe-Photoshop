import {
    isRuntimeOwnedSkillDeliveryPlanBinding,
    issueRuntimeOwnedSkillExternalDeliveryCommitReceipt,
    type RuntimeOwnedSkillDeliveryPlanBinding,
    type RuntimeOwnedSkillExternalDeliveryCommitReceipt
} from '../../../shared/agent-skill-atomic-tool-execution';
import { normalizeSkillDeliveryArtifactPath } from '../../../shared/skills/skill-delivery-convention';
import type {
    StagedCommittedFileIdentity,
    StagedFilePromotionInput,
    StagedFilePromotionResult
} from '../../../shared/sku-staging-transaction-contract';

interface StagedDeliveryPromotionHost {
    promoteStagedFileSet?: (
        input: StagedFilePromotionInput
    ) => Promise<StagedFilePromotionResult>;
}

export interface RuntimeStagedDeliveryPromotionItem {
    artifactId: string;
    sourcePath: string;
    destinationPath: string;
    expectedDestinationBaseline: StagedFilePromotionInput['items'][number]['expectedDestinationBaseline'];
}

export interface RuntimeStagedDeliveryPromotionResult {
    success: boolean;
    error?: string;
    warnings?: string[];
    recoveryPath?: string;
    preserveStagingRoot?: boolean;
    committedPaths?: string[];
    committedFiles?: StagedCommittedFileIdentity[];
    runtimeDeliveryCommitReceipt?: RuntimeOwnedSkillExternalDeliveryCommitReceipt;
}

function currentHost(): StagedDeliveryPromotionHost {
    if (typeof window === 'undefined') return {};
    return (window as any).designEcho || {};
}

function normalizePath(value: unknown): string {
    return normalizeSkillDeliveryArtifactPath(value).replace(/\/+$/g, '');
}

function validateCommittedFiles(input: {
    files: unknown;
    plan: RuntimeOwnedSkillDeliveryPlanBinding['plan'];
}): StagedCommittedFileIdentity[] {
    if (!Array.isArray(input.files) || input.files.length !== input.plan.artifacts.length) return [];
    return input.files.flatMap((candidate, index) => {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
        const file = candidate as Record<string, unknown>;
        const artifact = input.plan.artifacts[index];
        const path = String(file.path || '').trim();
        const byteLength = Number(file.byteLength);
        const sha256 = String(file.sha256 || '').trim().toLowerCase();
        if (normalizePath(path) !== normalizePath(artifact.path)
            || !Number.isSafeInteger(byteLength)
            || byteLength <= 0
            || !/^[a-f0-9]{64}$/.test(sha256)) return [];
        return [{ path: artifact.path, byteLength, sha256 }];
    });
}

/**
 * The only renderer owner allowed to turn a Main promotion readback into the
 * opaque Runtime commit receipt. Callers provide a trusted frozen plan and an
 * ordered staging mapping; the actual host is never dependency-injected by a
 * production caller.
 */
export async function promoteRuntimeBoundStagedDeliverySet(input: {
    transactionToken: string;
    label: string;
    items: readonly RuntimeStagedDeliveryPromotionItem[];
    runtimeDeliveryPlanBinding: RuntimeOwnedSkillDeliveryPlanBinding;
}): Promise<RuntimeStagedDeliveryPromotionResult> {
    const binding = input.runtimeDeliveryPlanBinding;
    if (!isRuntimeOwnedSkillDeliveryPlanBinding(binding)
        || binding.status !== 'incomplete'
        || input.items.length !== binding.plan.artifacts.length) {
        return { success: false, error: `${input.label}缺少完整的 Runtime 冻结交付计划。` };
    }
    const orderedMappingMatches = input.items.every((item, index) => {
        const artifact = binding.plan.artifacts[index];
        return String(item.artifactId || '').trim() === artifact.artifactId
            && normalizePath(item.destinationPath) === normalizePath(artifact.path)
            && Boolean(normalizePath(item.sourcePath))
            && normalizePath(item.sourcePath) !== normalizePath(item.destinationPath);
    });
    if (!orderedMappingMatches) {
        return { success: false, error: `${input.label}暂存映射与冻结 artifact 顺序不一致。` };
    }
    const host = currentHost();
    if (typeof host.promoteStagedFileSet !== 'function') {
        return { success: false, error: `${input.label}主进程文件提交能力不可用。` };
    }
    let result: StagedFilePromotionResult;
    try {
        result = await host.promoteStagedFileSet({
            transactionToken: String(input.transactionToken || '').trim(),
            items: input.items.map((item) => ({
                sourcePath: item.sourcePath,
                destinationPath: item.destinationPath,
                expectedDestinationBaseline: item.expectedDestinationBaseline
            }))
        });
    } catch (error) {
        return {
            success: false,
            preserveStagingRoot: true,
            error: `${input.label}提交响应中断，文件状态未知，已保留恢复现场：${error instanceof Error ? error.message : String(error)}`
        };
    }
    if (result?.success !== true) {
        const recoveryPath = String(result?.recoveryPath || '').trim();
        const preserveStagingRoot = result?.rollbackComplete !== true || Boolean(recoveryPath);
        return {
            success: false,
            error: `${input.label}提交失败：${String(result?.error || '未知错误')}`,
            ...(recoveryPath ? { recoveryPath } : {}),
            ...(preserveStagingRoot ? { preserveStagingRoot: true } : {})
        };
    }
    const expectedPaths = binding.plan.artifacts.map((artifact) => normalizePath(artifact.path));
    const committedPaths = Array.isArray(result.committedPaths)
        ? result.committedPaths.map(normalizePath)
        : [];
    const committedFiles = validateCommittedFiles({ files: result.committedFiles, plan: binding.plan });
    if (!sameOrderedPaths(expectedPaths, committedPaths)
        || committedFiles.length !== binding.plan.artifacts.length) {
        return {
            success: false,
            preserveStagingRoot: true,
            error: `${input.label}提交回执与冻结计划不一致，文件状态未知，已保留恢复现场。`
        };
    }
    return {
        success: true,
        committedPaths: binding.plan.artifacts.map((artifact) => artifact.path),
        committedFiles,
        warnings: Array.isArray(result.cleanupWarnings)
            ? result.cleanupWarnings.map((warning) => String(warning || '').trim()).filter(Boolean)
            : [],
        runtimeDeliveryCommitReceipt: issueRuntimeOwnedSkillExternalDeliveryCommitReceipt({
            deliveryPlanDigest: binding.plan.digest,
            committedFiles: committedFiles.map((file, index) => ({
                artifactId: binding.plan.artifacts[index].artifactId,
                path: file.path,
                byteLength: file.byteLength,
                sha256: file.sha256
            }))
        })
    };
}

function sameOrderedPaths(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length
        && left.every((path, index) => path === right[index]);
}
