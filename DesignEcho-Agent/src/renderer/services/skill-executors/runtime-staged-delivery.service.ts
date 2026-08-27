import {
    isRuntimeOwnedSkillDeliveryPlanBinding,
    issueRuntimeOwnedSkillStagingLease,
    type RuntimeOwnedSkillDeliveryPlanBinding,
    type RuntimeOwnedSkillStagingLease
} from '../../../shared/agent-skill-atomic-tool-execution';
import { normalizeSkillDeliveryArtifactPath } from '../../../shared/skills/skill-delivery-convention';
import type { SkillDeliveryPlan } from '../../../shared/skills/skill-delivery-convention';
import {
    captureStagedFileDestinationBaselines,
    finalizeStagedFileTransaction,
    issueStagedFileTransaction,
    type StagedFileDestinationBaseline,
    type StagedFileTransaction
} from './staged-file-transaction.service';
import {
    promoteRuntimeBoundStagedDeliverySet,
    type RuntimeStagedDeliveryPromotionResult
} from './staged-delivery-promotion.service';

export interface RuntimeStagedDeliveryContext {
    version: 'runtime-staged-delivery-context/v0';
    boundaries: {
        runtimeOwned: true;
        opaqueTransactionState: true;
        immutableDispatchMapping: true;
        grantsPermission: false;
    };
}

export interface RuntimeStagedDeliveryDispatchContext {
    lease: RuntimeOwnedSkillStagingLease;
    stagedPathsByArtifactId: Readonly<Record<string, string>>;
}

interface RuntimeStagedDeliveryState {
    transaction: StagedFileTransaction;
    plan: SkillDeliveryPlan;
    deliveryPlanDigest: string;
    lease: RuntimeOwnedSkillStagingLease;
    stagedPathsByArtifactId: Readonly<Record<string, string>>;
    destinationBaselines: Map<string, StagedFileDestinationBaseline>;
    promotionAttempted: boolean;
    finalizationResult?: RuntimeStagedDeliveryPromotionResult;
}

export type RuntimeStagedDeliveryPreparation =
    | { status: 'ready'; context: RuntimeStagedDeliveryContext; blockers: [] }
    | { status: 'blocked'; blockers: string[]; recoveryPath?: string };

const RUNTIME_STAGED_DELIVERY_STATES = new WeakMap<object, RuntimeStagedDeliveryState>();

function normalizePath(value: unknown): string {
    return normalizeSkillDeliveryArtifactPath(value).replace(/\/+$/g, '');
}

function relativeProjectPath(projectRoot: string, absolutePath: string): string {
    const root = normalizePath(projectRoot);
    const target = normalizePath(absolutePath);
    if (!root || !target.startsWith(`${root}/`)) return '';
    return target.slice(root.length + 1);
}

function joinPath(root: string, relativePath: string): string {
    const separator = String(root).includes('\\') ? '\\' : '/';
    return `${String(root).replace(/[\\/]+$/g, '')}${separator}${relativePath.replace(/[\\/]+/g, separator)}`;
}

async function cleanupPreparationFailure(
    transaction: StagedFileTransaction,
    blocker: string
): Promise<RuntimeStagedDeliveryPreparation> {
    const cleanup = await finalizeStagedFileTransaction({
        transaction,
        preserveStagingRoot: false
    });
    if (cleanup.success) return { status: 'blocked', blockers: [blocker] };
    return {
        status: 'blocked',
        blockers: [blocker, String(cleanup.error || '暂存目录清理失败。')],
        ...(cleanup.recoveryPath ? { recoveryPath: cleanup.recoveryPath } : {})
    };
}

export async function prepareRuntimeStagedDelivery(input: {
    projectRoot: string;
    runtimeDeliveryPlanBinding: RuntimeOwnedSkillDeliveryPlanBinding;
}): Promise<RuntimeStagedDeliveryPreparation> {
    const binding = input.runtimeDeliveryPlanBinding;
    if (!isRuntimeOwnedSkillDeliveryPlanBinding(binding) || binding.status !== 'incomplete') {
        return {
            status: 'blocked',
            blockers: ['整组交付开始前没有取得本次运行的冻结文件计划。']
        };
    }
    const plan = binding.plan;
    let transaction: StagedFileTransaction;
    try {
        transaction = await issueStagedFileTransaction(input.projectRoot, input.projectRoot);
    } catch (error) {
        return {
            status: 'blocked',
            blockers: [error instanceof Error ? error.message : String(error)]
        };
    }
    let destinationBaselines: Map<string, StagedFileDestinationBaseline>;
    try {
        destinationBaselines = await captureStagedFileDestinationBaselines(
            plan.artifacts.map((artifact) => artifact.path),
            transaction.transactionToken
        );
    } catch (error) {
        return cleanupPreparationFailure(
            transaction,
            error instanceof Error ? error.message : String(error)
        );
    }
    const baselineComplete = plan.artifacts.every((artifact) => (
        destinationBaselines.has(normalizePath(artifact.path))
    ));
    if (!baselineComplete || destinationBaselines.size !== plan.artifacts.length) {
        return cleanupPreparationFailure(transaction, '正式文件的执行前基线不完整。');
    }
    const existingTargets = plan.artifacts.filter((artifact) => (
        destinationBaselines.get(normalizePath(artifact.path))?.exists === true
    ));
    if (existingTargets.length > 0) {
        return cleanupPreparationFailure(
            transaction,
            `交付目标已存在，未覆盖任何文件：${existingTargets.map((artifact) => artifact.path).join('；')}`
        );
    }
    const stagedPathsByArtifactId: Record<string, string> = {};
    for (const artifact of plan.artifacts) {
        const relativePath = relativeProjectPath(input.projectRoot, artifact.path);
        if (!relativePath) {
            return cleanupPreparationFailure(transaction, '交付文件不在当前项目目录内。');
        }
        stagedPathsByArtifactId[artifact.artifactId] = joinPath(transaction.stagingRoot, relativePath);
    }
    let lease: RuntimeOwnedSkillStagingLease;
    try {
        lease = issueRuntimeOwnedSkillStagingLease({
            deliveryPlanDigest: plan.digest,
            stagingRoot: transaction.stagingRoot,
            destinationRoot: input.projectRoot,
            artifactMappings: plan.artifacts.map((artifact) => ({
                artifactId: artifact.artifactId,
                stagedPath: stagedPathsByArtifactId[artifact.artifactId],
                finalPath: artifact.path
            }))
        });
    } catch (error) {
        return cleanupPreparationFailure(
            transaction,
            error instanceof Error ? error.message : String(error)
        );
    }
    const immutablePaths = Object.freeze({ ...stagedPathsByArtifactId });
    const context: RuntimeStagedDeliveryContext = Object.freeze({
        version: 'runtime-staged-delivery-context/v0',
        boundaries: Object.freeze({
            runtimeOwned: true,
            opaqueTransactionState: true,
            immutableDispatchMapping: true,
            grantsPermission: false
        })
    });
    RUNTIME_STAGED_DELIVERY_STATES.set(context, {
        transaction: Object.freeze({ ...transaction }),
        plan,
        deliveryPlanDigest: plan.digest,
        lease,
        stagedPathsByArtifactId: immutablePaths,
        destinationBaselines,
        promotionAttempted: false
    });
    return { status: 'ready', context, blockers: [] };
}

export function readRuntimeStagedDeliveryDispatchContext(
    context: RuntimeStagedDeliveryContext
): RuntimeStagedDeliveryDispatchContext | undefined {
    const state = RUNTIME_STAGED_DELIVERY_STATES.get(context);
    if (!state || state.finalizationResult) return undefined;
    return Object.freeze({
        lease: state.lease,
        stagedPathsByArtifactId: state.stagedPathsByArtifactId
    });
}

export async function promoteRuntimeStagedDelivery(input: {
    context: RuntimeStagedDeliveryContext;
    runtimeDeliveryPlanBinding: RuntimeOwnedSkillDeliveryPlanBinding;
    label: string;
}): Promise<RuntimeStagedDeliveryPromotionResult> {
    const state = RUNTIME_STAGED_DELIVERY_STATES.get(input.context);
    const binding = input.runtimeDeliveryPlanBinding;
    if (!state
        || state.promotionAttempted
        || state.finalizationResult
        || !isRuntimeOwnedSkillDeliveryPlanBinding(binding)
        || binding.status !== 'incomplete'
        || binding.plan.digest !== state.deliveryPlanDigest) {
        return { success: false, error: `${input.label}没有可用的本次文件事务。` };
    }
    const baselines = state.plan.artifacts.map((artifact) => (
        state.destinationBaselines.get(normalizePath(artifact.path))
    ));
    if (baselines.some((baseline) => !baseline)) {
        return { success: false, error: `${input.label}的执行前文件基线不完整。` };
    }
    state.promotionAttempted = true;
    return promoteRuntimeBoundStagedDeliverySet({
        transactionToken: state.transaction.transactionToken,
        label: input.label,
        runtimeDeliveryPlanBinding: binding,
        items: state.plan.artifacts.map((artifact, index) => ({
            artifactId: artifact.artifactId,
            sourcePath: state.stagedPathsByArtifactId[artifact.artifactId],
            destinationPath: artifact.path,
            expectedDestinationBaseline: baselines[index]!
        }))
    });
}

export async function finalizeRuntimeStagedDelivery(input: {
    context: RuntimeStagedDeliveryContext;
    preserveStagingRoot: boolean;
    recoveryPath?: string;
}): Promise<RuntimeStagedDeliveryPromotionResult> {
    const state = RUNTIME_STAGED_DELIVERY_STATES.get(input.context);
    if (!state) return { success: false, error: '临时文件事务不存在或已失效。' };
    if (state.finalizationResult) return state.finalizationResult;
    const result = await finalizeStagedFileTransaction({
        transaction: state.transaction,
        preserveStagingRoot: input.preserveStagingRoot,
        recoveryPath: input.recoveryPath
    });
    state.finalizationResult = result;
    return result;
}
