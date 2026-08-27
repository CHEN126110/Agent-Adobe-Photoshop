import {
    buildAgentToolExecutionPreflight,
    classifyAgentToolExecution,
    DESIGN_ECHO_TARGET_GUARD_ARGUMENT,
    isAgentToolExecutionGuarded,
    type AgentToolExecutionPreflight,
    type AgentToolExecutionPreflightLogEntry
} from './agent-tool-execution-preflight';
import {
    buildSkillDeliveryPlan,
    normalizeSkillDeliveryArtifactPath,
    type SkillDeliveryConvention,
    type SkillDeliveryPlan,
    type SkillDeliveryPlanArtifact
} from './skills/skill-delivery-convention';

export type GuardedAtomicToolExecutor = (
    toolName: string,
    params: Record<string, any>
) => Promise<any>;

export const RUNTIME_OWNED_SKILL_TOOL_LEDGER_VERSION =
    'runtime-owned-skill-tool-ledger/v0' as const;
export const RUNTIME_OWNED_SKILL_DELIVERY_PLAN_BINDING_VERSION =
    'runtime-owned-skill-delivery-plan-binding/v0' as const;

export interface RuntimeOwnedSkillDeliveryPlanFreezeCandidate {
    projectPath: string;
    convention: SkillDeliveryConvention;
    artifacts: readonly unknown[];
}

export interface RuntimeOwnedSkillDeliveryArtifactExecution {
    artifactIds: readonly string[];
    toolName: string;
    targetPaths: readonly string[];
    dispatchState: 'returned' | 'threw';
    succeeded: boolean;
}

/**
 * Skill 只能提交候选；这份 binding 由现有 guarded Tool ledger 重建、冻结和封口。
 * 它不选择目录或命名，也不执行 Tool，只证明计划先于对应交付副作用存在。
 */
export interface RuntimeOwnedSkillDeliveryPlanBinding {
    version: typeof RUNTIME_OWNED_SKILL_DELIVERY_PLAN_BINDING_VERSION;
    status: 'ready' | 'incomplete';
    plan: SkillDeliveryPlan;
    artifactExecutions: readonly RuntimeOwnedSkillDeliveryArtifactExecution[];
    issues: readonly string[];
    boundaries: {
        runtimeOwned: true;
        frozenBeforeFinalDeliveryDispatch: true;
        immutableWithinScope: true;
        exactArtifactCallsRequired: true;
        producerResultIgnored: true;
        selectsConvention: false;
        executesTools: false;
        grantsPermission: false;
    };
}

export type RuntimeOwnedSkillDeliveryPlanFreezeDecision =
    | {
        status: 'frozen' | 'retained';
        binding: RuntimeOwnedSkillDeliveryPlanBinding;
        blockers: [];
    }
    | {
        status: 'rejected';
        code:
            | 'runtime_delivery_plan_scope_unavailable'
            | 'runtime_delivery_plan_scope_completed'
            | 'runtime_delivery_plan_invalid'
            | 'runtime_delivery_plan_already_frozen'
            | 'runtime_delivery_plan_frozen_too_late';
        blockers: string[];
    };

export interface RuntimeOwnedSkillDeliveryPlanAuthority {
    version: 'runtime-owned-skill-delivery-plan-authority/v0';
    freeze(candidate: RuntimeOwnedSkillDeliveryPlanFreezeCandidate):
        RuntimeOwnedSkillDeliveryPlanFreezeDecision;
    executeArtifacts(input: {
        artifactIds: readonly string[];
        toolName: string;
        params: Record<string, any>;
    }): Promise<any>;
    executeStagedArtifacts(input: {
        lease: RuntimeOwnedSkillStagingLease;
        artifactIds: readonly string[];
        toolName: string;
        params: Record<string, any>;
    }): Promise<any>;
    acceptExternalCommit(input: {
        artifactIds: readonly string[];
        receipt: RuntimeOwnedSkillExternalDeliveryCommitReceipt;
    }): RuntimeOwnedSkillDeliveryExternalCommitDecision;
    boundaries: {
        runtimeOwned: true;
        acceptsProducerCandidateOnly: true;
        freezesBeforeFinalDeliveryDispatch: true;
        immutableWithinScope: true;
        selectsConvention: false;
        creditsOnlyGuardedOrTrustedTransactionCommits: true;
        grantsPermission: false;
    };
}

export interface RuntimeOwnedSkillExternalDeliveryCommitReceipt {
    version: 'runtime-owned-skill-external-delivery-commit/v0';
    status: 'committed';
    deliveryPlanDigest: string;
    committedFiles: ReadonlyArray<{
        artifactId: string;
        path: string;
        byteLength: number;
        sha256: string;
    }>;
    boundaries: {
        issuedByTransactionOwner: true;
        exactArtifactSetCommitted: true;
        producerCannotSelfIssue: true;
        grantsPermission: false;
    };
}

export interface RuntimeOwnedSkillStagingLease {
    version: 'runtime-owned-skill-staging-lease/v0';
    deliveryPlanDigest: string;
    stagingRoot: string;
    destinationRoot: string;
    artifactMappings: ReadonlyArray<{
        artifactId: string;
        stagedPath: string;
        finalPath: string;
    }>;
    boundaries: {
        issuedAfterMainTransaction: true;
        exactArtifactMapping: true;
        producerCannotSelfIssue: true;
        grantsPermission: false;
    };
}

export type RuntimeOwnedSkillDeliveryExternalCommitDecision =
    | {
        status: 'accepted';
        binding: RuntimeOwnedSkillDeliveryPlanBinding;
    }
    | {
        status: 'rejected';
        code:
            | 'runtime_delivery_plan_not_frozen'
            | 'runtime_delivery_external_commit_untrusted'
            | 'runtime_delivery_external_commit_mismatch'
            | 'runtime_delivery_artifact_already_dispatched';
        blockers: string[];
    };

export interface RuntimeOwnedSkillToolLedgerEntry {
    toolName: string;
    params: Readonly<Record<string, any>>;
    dispatchState: 'not_dispatched' | 'returned' | 'threw';
    result?: unknown;
}

/** 由 guarded executor 自己记录并在 Skill 返回后封口；executor 返回值不能伪造。 */
export interface RuntimeOwnedSkillToolLedger {
    version: typeof RUNTIME_OWNED_SKILL_TOOL_LEDGER_VERSION;
    complete: true;
    entries: readonly RuntimeOwnedSkillToolLedgerEntry[];
    deliveryPlanBinding?: RuntimeOwnedSkillDeliveryPlanBinding;
    boundaries: {
        runtimeOwned: true;
        exhaustiveForScope: true;
        executorReportedResultsIgnored: true;
    };
}

export interface RuntimeOwnedSkillToolLedgerScope {
    version: 'runtime-owned-skill-tool-ledger-scope/v0';
    scopeId: string;
}

interface RuntimeOwnedSkillToolLedgerInternalEntry extends RuntimeOwnedSkillToolLedgerEntry {
    scopeIds: readonly string[];
    dispatchSequence: number;
    deliveryScopeBindings: ReadonlyArray<{
        scopeId: string;
        artifactIds: readonly string[];
        phase: 'staging' | 'delivery';
    }>;
}

interface GuardedAtomicToolLedgerState {
    activeScopeIds: Set<string>;
    entries: RuntimeOwnedSkillToolLedgerInternalEntry[];
    queuedCalls: Array<{
        scopeIds: readonly string[];
        dispatchSequence: number;
        toolName: string;
        executionClass: ReturnType<typeof classifyAgentToolExecution>;
        targetPaths: readonly string[];
        deliveryScopeBindings: ReadonlyArray<{
            scopeId: string;
            artifactIds: readonly string[];
            phase: 'staging' | 'delivery';
        }>;
    }>;
    dispatchSequence: number;
    pendingDeliveryDispatch?: {
        scopeId: string;
        toolName: string;
        params: Record<string, any>;
        artifactIds: readonly string[];
        phase: 'staging' | 'delivery';
    };
    drain: () => Promise<void>;
}

interface RuntimeOwnedSkillToolLedgerScopeState {
    owner: GuardedAtomicToolLedgerState;
    scopeId: string;
    deliveryPlan?: {
        plan: SkillDeliveryPlan;
        artifactExecutions: Array<{
            artifactIds: readonly string[];
            toolName: string;
            targetPaths: readonly string[];
            dispatchState: 'pending' | 'returned' | 'threw';
            result?: unknown;
        }>;
    };
    completed?: RuntimeOwnedSkillToolLedger;
}

type RuntimeOwnedSkillDeliveryPlanInternalExecution = NonNullable<
    RuntimeOwnedSkillToolLedgerScopeState['deliveryPlan']
>['artifactExecutions'][number];

const GUARDED_ATOMIC_TOOL_LEDGER_STATES =
    new WeakMap<GuardedAtomicToolExecutor, GuardedAtomicToolLedgerState>();
const RUNTIME_OWNED_SKILL_TOOL_LEDGER_SCOPES =
    new WeakMap<object, RuntimeOwnedSkillToolLedgerScopeState>();
const RUNTIME_OWNED_SKILL_TOOL_LEDGERS = new WeakSet<object>();
const RUNTIME_OWNED_SKILL_DELIVERY_PLAN_BINDINGS = new WeakSet<object>();
const RUNTIME_OWNED_SKILL_EXTERNAL_DELIVERY_COMMIT_RECEIPTS = new WeakSet<object>();
const RUNTIME_OWNED_SKILL_STAGING_LEASES = new WeakSet<object>();
const RUNTIME_OWNED_SKILL_DELIVERY_PLAN_RESULT_BINDINGS =
    new WeakMap<object, RuntimeOwnedSkillDeliveryPlanBinding>();
let runtimeOwnedSkillToolLedgerScopeSequence = 0;

function isRecord(value: unknown): value is Record<string, any> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneAtomicToolValue(
    value: unknown,
    seen: WeakSet<object>,
    depth: number
): unknown {
    if (depth > 24) throw new Error('原子工具参数嵌套过深。');
    if (value === null
        || value === undefined
        || typeof value === 'string'
        || typeof value === 'number'
        || typeof value === 'boolean') {
        return value;
    }
    if (typeof value !== 'object') {
        throw new Error('原子工具参数只能包含可序列化数据。');
    }
    if (seen.has(value)) throw new Error('原子工具参数不能包含循环引用。');
    seen.add(value);
    if (Array.isArray(value)) {
        const cloned = value.map((item) => cloneAtomicToolValue(item, seen, depth + 1));
        seen.delete(value);
        return Object.freeze(cloned);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        throw new Error('原子工具参数包含不受支持的对象类型。');
    }
    const cloned: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
        cloned[key] = cloneAtomicToolValue(item, seen, depth + 1);
    }
    seen.delete(value);
    return Object.freeze(cloned);
}

function snapshotAtomicToolParams(params: Record<string, any>): Readonly<Record<string, any>> {
    const businessArguments = stripUntrustedTargetGuard(params || {});
    return cloneAtomicToolValue(businessArguments, new WeakSet<object>(), 0) as Readonly<
        Record<string, any>
    >;
}

function normalizedDeliveryPathsInOrder(values: readonly unknown[]): string[] {
    return values.map(normalizeSkillDeliveryArtifactPath).filter(Boolean);
}

function sameOrderedStrings(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length
        && left.every((value, index) => value === right[index]);
}

function isDeliveryPathInside(root: string, candidate: string): boolean {
    const normalizedRoot = normalizeSkillDeliveryArtifactPath(root).replace(/\/+$/g, '');
    const normalizedCandidate = normalizeSkillDeliveryArtifactPath(candidate).replace(/\/+$/g, '');
    return Boolean(normalizedRoot
        && normalizedCandidate
        && normalizedCandidate !== normalizedRoot
        && normalizedCandidate.startsWith(`${normalizedRoot}/`));
}

function relativeDeliveryPath(root: string, candidate: string): string {
    const normalizedRoot = normalizeSkillDeliveryArtifactPath(root).replace(/\/+$/g, '');
    const normalizedCandidate = normalizeSkillDeliveryArtifactPath(candidate).replace(/\/+$/g, '');
    if (!normalizedRoot
        || !normalizedCandidate.startsWith(`${normalizedRoot}/`)) return '';
    return normalizedCandidate.slice(normalizedRoot.length + 1);
}

function freezeSkillDeliveryPlan(plan: SkillDeliveryPlan): SkillDeliveryPlan {
    const convention: SkillDeliveryConvention = {
        ...plan.convention,
        supportRefs: [...plan.convention.supportRefs],
        ...(plan.convention.editable
            ? { editable: { ...plan.convention.editable } }
            : {}),
        ...(plan.convention.raster
            ? { raster: { ...plan.convention.raster } }
            : {})
    };
    Object.freeze(convention.supportRefs);
    if (convention.editable) Object.freeze(convention.editable);
    if (convention.raster) Object.freeze(convention.raster);
    Object.freeze(convention);
    const artifacts = plan.artifacts.map((artifact) => Object.freeze({ ...artifact }));
    Object.freeze(artifacts);
    const boundaries = Object.freeze({ ...plan.boundaries });
    return Object.freeze({
        ...plan,
        convention,
        artifacts,
        boundaries
    });
}

function readAtomicDeliveryTargetPaths(
    toolName: string,
    params: Readonly<Record<string, any>>
): string[] {
    switch (toolName) {
        case 'saveDocument':
            return normalizedDeliveryPathsInOrder([params.path]);
        case 'exportGroup':
        case 'quickExport':
            return normalizedDeliveryPathsInOrder([params.outputPath]);
        case 'exportDetailPageSlices': {
            const config = isRecord(params.config) ? params.config : {};
            const expectedFiles = Array.isArray(config.expectedFiles)
                ? config.expectedFiles
                : [];
            return normalizedDeliveryPathsInOrder(expectedFiles.map((entry) => (
                isRecord(entry) ? entry.path : undefined
            )));
        }
        default:
            return [];
    }
}

function usesNonOverwritingDeliveryPolicy(
    toolName: string,
    params: Readonly<Record<string, any>>
): boolean {
    if (toolName === 'exportDetailPageSlices') {
        const config = isRecord(params.config) ? params.config : {};
        return config.conflictPolicy === 'fail_if_exists'
            || config.conflictPolicy === 'new_version';
    }
    return params.conflictPolicy === 'fail_if_exists';
}

function normalizeDeliveryFormat(value: unknown): string {
    const format = String(value || '').trim().toLowerCase();
    if (format === 'jpeg') return 'jpg';
    if (format === 'tiff') return 'tif';
    return format;
}

function readAtomicDeliveryFormat(
    toolName: string,
    params: Readonly<Record<string, any>>
): string {
    if (toolName === 'exportDetailPageSlices') {
        const config = isRecord(params.config) ? params.config : {};
        return normalizeDeliveryFormat(config.format);
    }
    return normalizeDeliveryFormat(params.format);
}

function toolMatchesDeliveryArtifacts(input: {
    toolName: string;
    params: Readonly<Record<string, any>>;
    artifacts: readonly SkillDeliveryPlanArtifact[];
}): boolean {
    const artifactFormats = new Set(input.artifacts.map((artifact) => (
        normalizeDeliveryFormat(artifact.format)
    )));
    if (artifactFormats.size !== 1
        || !artifactFormats.has(readAtomicDeliveryFormat(input.toolName, input.params))) {
        return false;
    }
    if (input.toolName === 'saveDocument') {
        return input.artifacts.length === 1
            && input.artifacts[0].kind === 'editable_document';
    }
    if (input.toolName === 'exportGroup' || input.toolName === 'quickExport') {
        return input.artifacts.length === 1
            && input.artifacts[0].kind === 'raster_export';
    }
    if (input.toolName === 'exportDetailPageSlices') {
        return input.artifacts.length > 0
            && input.artifacts.every((artifact) => artifact.kind === 'raster_export');
    }
    return false;
}

function buildRuntimeOwnedSkillDeliveryPlanBinding(
    state: RuntimeOwnedSkillToolLedgerScopeState
): RuntimeOwnedSkillDeliveryPlanBinding | undefined {
    const deliveryPlan = state.deliveryPlan;
    if (!deliveryPlan) return undefined;
    const plannedArtifactIds = new Set(deliveryPlan.plan.artifacts.map((artifact) => artifact.artifactId));
    const issues: string[] = [];
    const coveredArtifactIds = new Set<string>();
    const artifactExecutions = deliveryPlan.artifactExecutions.map((execution) => {
        const succeeded = execution.dispatchState === 'returned'
            && isRecord(execution.result)
            && execution.result.success === true;
        if (succeeded) {
            execution.artifactIds.forEach((artifactId) => coveredArtifactIds.add(artifactId));
        }
        return Object.freeze({
            artifactIds: Object.freeze([...execution.artifactIds]),
            toolName: execution.toolName,
            targetPaths: Object.freeze([...execution.targetPaths]),
            dispatchState: execution.dispatchState === 'threw' ? 'threw' as const : 'returned' as const,
            succeeded
        });
    });
    for (const artifactId of plannedArtifactIds) {
        if (!coveredArtifactIds.has(artifactId)) {
            issues.push(`交付文件 ${artifactId} 没有 Runtime 绑定的成功保存或导出调用。`);
        }
    }
    const unboundSaveExportCalls = state.owner.queuedCalls.filter((call) => (
        call.scopeIds.includes(state.scopeId)
        && call.executionClass === 'save_export'
        && !call.deliveryScopeBindings.some((binding) => binding.scopeId === state.scopeId)
    ));
    if (unboundSaveExportCalls.length > 0) {
        issues.push('当前 Skill 存在未绑定到正式交付或可信暂存事务的保存/导出调用。');
    }
    const status = issues.length === 0 && coveredArtifactIds.size === plannedArtifactIds.size
        ? 'ready' as const
        : 'incomplete' as const;
    const binding: RuntimeOwnedSkillDeliveryPlanBinding = Object.freeze({
        version: RUNTIME_OWNED_SKILL_DELIVERY_PLAN_BINDING_VERSION,
        status,
        plan: deliveryPlan.plan,
        artifactExecutions: Object.freeze(artifactExecutions),
        issues: Object.freeze(Array.from(new Set(issues))),
        boundaries: Object.freeze({
            runtimeOwned: true,
            frozenBeforeFinalDeliveryDispatch: true,
            immutableWithinScope: true,
            exactArtifactCallsRequired: true,
            producerResultIgnored: true,
            selectsConvention: false,
            executesTools: false,
            grantsPermission: false
        })
    });
    RUNTIME_OWNED_SKILL_DELIVERY_PLAN_BINDINGS.add(binding);
    return binding;
}

function buildDeliveryAuthorityBlockedResult(input: {
    code: string;
    error: string;
    toolName?: string;
}): Record<string, any> {
    return {
        success: false,
        code: input.code,
        policyGate: true,
        ...(input.toolName ? { blockedTool: input.toolName } : {}),
        error: input.error,
        executesPhotoshop: false,
        grantsPermission: false,
        countsAsObservation: false,
        countsAsTaskProgress: false
    };
}

/**
 * 由独立的文件/事务 owner 在完成精确 readback 后签发。
 * 调用位置必须由源码边界审计限制；Skill executor 不能直接导入这个 issuer。
 */
export function issueRuntimeOwnedSkillExternalDeliveryCommitReceipt(input: {
    deliveryPlanDigest: string;
    committedFiles: ReadonlyArray<{
        artifactId: string;
        path: string;
        byteLength: number;
        sha256: string;
    }>;
}): RuntimeOwnedSkillExternalDeliveryCommitReceipt {
    const committedFiles = input.committedFiles.map((file) => Object.freeze({
        artifactId: String(file.artifactId || '').trim(),
        path: String(file.path || '').trim(),
        byteLength: Number(file.byteLength),
        sha256: String(file.sha256 || '').trim().toLowerCase()
    }));
    if (!String(input.deliveryPlanDigest || '').trim()
        || committedFiles.length === 0
        || committedFiles.some((file) => (
            !file.artifactId
            || !normalizeSkillDeliveryArtifactPath(file.path)
            || !Number.isSafeInteger(file.byteLength)
            || file.byteLength <= 0
            || !/^[a-f0-9]{64}$/.test(file.sha256)
        ))) {
        throw new Error('外部交付提交回执缺少完整 artifact 文件身份。');
    }
    const receipt: RuntimeOwnedSkillExternalDeliveryCommitReceipt = Object.freeze({
        version: 'runtime-owned-skill-external-delivery-commit/v0',
        status: 'committed',
        deliveryPlanDigest: String(input.deliveryPlanDigest || '').trim(),
        committedFiles: Object.freeze(committedFiles),
        boundaries: Object.freeze({
            issuedByTransactionOwner: true,
            exactArtifactSetCommitted: true,
            producerCannotSelfIssue: true,
            grantsPermission: false
        })
    });
    RUNTIME_OWNED_SKILL_EXTERNAL_DELIVERY_COMMIT_RECEIPTS.add(receipt);
    return receipt;
}

/**
 * Main-backed transaction owner compiles the exact staging-to-final mapping and
 * signs it out of band. The authority still revalidates it against the frozen
 * delivery plan before any staged save/export is dispatched.
 */
export function issueRuntimeOwnedSkillStagingLease(input: {
    deliveryPlanDigest: string;
    stagingRoot: string;
    destinationRoot: string;
    artifactMappings: ReadonlyArray<{
        artifactId: string;
        stagedPath: string;
        finalPath: string;
    }>;
}): RuntimeOwnedSkillStagingLease {
    const stagingRoot = String(input.stagingRoot || '').trim();
    const destinationRoot = String(input.destinationRoot || '').trim();
    const artifactMappings = input.artifactMappings.map((mapping) => Object.freeze({
        artifactId: String(mapping.artifactId || '').trim(),
        stagedPath: String(mapping.stagedPath || '').trim(),
        finalPath: String(mapping.finalPath || '').trim()
    }));
    if (!String(input.deliveryPlanDigest || '').trim()
        || !stagingRoot
        || !destinationRoot
        || artifactMappings.length === 0
        || artifactMappings.some((mapping) => (
            !mapping.artifactId
            || !isDeliveryPathInside(stagingRoot, mapping.stagedPath)
            || !isDeliveryPathInside(destinationRoot, mapping.finalPath)
        ))) {
        throw new Error('暂存事务租约缺少完整 artifact 路径映射。');
    }
    const lease: RuntimeOwnedSkillStagingLease = Object.freeze({
        version: 'runtime-owned-skill-staging-lease/v0',
        deliveryPlanDigest: String(input.deliveryPlanDigest || '').trim(),
        stagingRoot,
        destinationRoot,
        artifactMappings: Object.freeze(artifactMappings),
        boundaries: Object.freeze({
            issuedAfterMainTransaction: true,
            exactArtifactMapping: true,
            producerCannotSelfIssue: true,
            grantsPermission: false
        })
    });
    RUNTIME_OWNED_SKILL_STAGING_LEASES.add(lease);
    return lease;
}

/**
 * 在现有 Skill Tool ledger scope 上创建一次性交付 authority。
 * Agent/Skill 仍决定候选计划内容；Runtime 只重建、冻结并把精确 artifact 调用绑定到账本。
 */
export function createRuntimeOwnedSkillDeliveryPlanAuthority(input: {
    scope: RuntimeOwnedSkillToolLedgerScope | undefined;
    executor: GuardedAtomicToolExecutor | undefined;
}): RuntimeOwnedSkillDeliveryPlanAuthority | undefined {
    if (!input.scope || !input.executor) return undefined;
    const state = RUNTIME_OWNED_SKILL_TOOL_LEDGER_SCOPES.get(input.scope);
    const owner = GUARDED_ATOMIC_TOOL_LEDGER_STATES.get(input.executor);
    if (!state || !owner || state.owner !== owner) return undefined;

    const dispatchArtifacts = async (dispatchInput: {
        phase: 'staging' | 'delivery';
        lease?: RuntimeOwnedSkillStagingLease;
        artifactIds: readonly string[];
        toolName: string;
        params: Record<string, any>;
    }): Promise<any> => {
        const toolName = String(dispatchInput.toolName || '').trim();
        let params: Readonly<Record<string, any>>;
        try {
            params = snapshotAtomicToolParams(isRecord(dispatchInput.params) ? dispatchInput.params : {});
        } catch (error) {
            return buildDeliveryAuthorityBlockedResult({
                code: 'runtime_delivery_arguments_invalid',
                error: error instanceof Error ? error.message : String(error),
                toolName
            });
        }
        if (state.completed) {
            return buildDeliveryAuthorityBlockedResult({
                code: 'runtime_delivery_plan_scope_completed',
                error: '当前 Skill 运行已经封口，不能继续保存或导出。',
                toolName
            });
        }
        if (!state.deliveryPlan) {
            return buildDeliveryAuthorityBlockedResult({
                code: 'runtime_delivery_plan_not_frozen',
                error: '最终保存、导出或暂存前必须先冻结精确交付计划。',
                toolName
            });
        }
        const artifactIds = dispatchInput.artifactIds.map((artifactId) => (
            String(artifactId || '').trim()
        ));
        if (artifactIds.length === 0
            || artifactIds.some((artifactId) => !artifactId)
            || new Set(artifactIds).size !== artifactIds.length) {
            return buildDeliveryAuthorityBlockedResult({
                code: 'runtime_delivery_artifact_identity_invalid',
                error: '交付调用必须逐项绑定唯一 artifactId。',
                toolName
            });
        }
        const requestedArtifactIds = new Set(artifactIds);
        const typedArtifacts = state.deliveryPlan.plan.artifacts.filter((artifact) => (
            requestedArtifactIds.has(artifact.artifactId)
        ));
        if (typedArtifacts.length !== artifactIds.length
            || !sameOrderedStrings(
                artifactIds,
                typedArtifacts.map((artifact) => artifact.artifactId)
            )) {
            return buildDeliveryAuthorityBlockedResult({
                code: 'runtime_delivery_artifact_order_mismatch',
                error: '交付 artifactId 必须按冻结计划的逐项顺序提交。',
                toolName
            });
        }
        if (dispatchInput.phase === 'delivery') {
            const alreadyReserved = state.deliveryPlan.artifactExecutions.some((execution) => (
                execution.artifactIds.some((artifactId) => requestedArtifactIds.has(artifactId))
            ));
            if (alreadyReserved) {
                return buildDeliveryAuthorityBlockedResult({
                    code: 'runtime_delivery_artifact_already_dispatched',
                    error: '同一冻结文件已经进入保存或导出流程，不能重复派发。',
                    toolName
                });
            }
        }
        if (classifyAgentToolExecution(toolName, params) !== 'save_export') {
            return buildDeliveryAuthorityBlockedResult({
                code: 'runtime_delivery_tool_not_save_export',
                error: '交付 artifact 只能绑定正式保存、导出或受控暂存工具。',
                toolName
            });
        }
        if (!usesNonOverwritingDeliveryPolicy(toolName, params)) {
            return buildDeliveryAuthorityBlockedResult({
                code: 'runtime_delivery_overwrite_policy_forbidden',
                error: '交付与暂存调用都必须使用不覆盖策略。',
                toolName
            });
        }
        if (!toolMatchesDeliveryArtifacts({ toolName, params, artifacts: typedArtifacts })) {
            return buildDeliveryAuthorityBlockedResult({
                code: 'runtime_delivery_artifact_tool_mismatch',
                error: '保存或导出工具的文件类型、数量或格式与冻结 artifact 不一致。',
                toolName
            });
        }
        let expectedPaths = typedArtifacts.map((artifact) => (
            normalizeSkillDeliveryArtifactPath(artifact.path)
        ));
        if (dispatchInput.phase === 'staging') {
            const lease = dispatchInput.lease;
            if (!lease
                || !RUNTIME_OWNED_SKILL_STAGING_LEASES.has(lease)
                || lease.deliveryPlanDigest !== state.deliveryPlan.plan.digest) {
                return buildDeliveryAuthorityBlockedResult({
                    code: 'runtime_delivery_staging_lease_untrusted',
                    error: '暂存调用没有绑定本次 Main 文件事务。',
                    toolName
                });
            }
            const planArtifacts = state.deliveryPlan.plan.artifacts;
            if (lease.artifactMappings.length !== planArtifacts.length
                || lease.artifactMappings.some((mapping, index) => {
                    const artifact = planArtifacts[index];
                    return mapping.artifactId !== artifact.artifactId
                        || normalizeSkillDeliveryArtifactPath(mapping.finalPath)
                            !== normalizeSkillDeliveryArtifactPath(artifact.path)
                        || relativeDeliveryPath(lease.stagingRoot, mapping.stagedPath)
                            !== relativeDeliveryPath(lease.destinationRoot, mapping.finalPath);
                })) {
                return buildDeliveryAuthorityBlockedResult({
                    code: 'runtime_delivery_staging_mapping_mismatch',
                    error: '暂存路径映射与冻结交付计划不一致。',
                    toolName
                });
            }
            const mappingsById = new Map(lease.artifactMappings.map((mapping) => (
                [mapping.artifactId, mapping] as const
            )));
            expectedPaths = typedArtifacts.map((artifact) => (
                normalizeSkillDeliveryArtifactPath(mappingsById.get(artifact.artifactId)?.stagedPath)
            ));
        }
        const actualPaths = readAtomicDeliveryTargetPaths(toolName, params);
        if (new Set(actualPaths).size !== actualPaths.length
            || !sameOrderedStrings(expectedPaths, actualPaths)) {
            return buildDeliveryAuthorityBlockedResult({
                code: 'runtime_delivery_artifact_path_mismatch',
                error: '保存或导出的逐项目标与冻结 artifact 映射不一致。',
                toolName
            });
        }
        const execution: RuntimeOwnedSkillDeliveryPlanInternalExecution | undefined =
            dispatchInput.phase === 'delivery'
                ? {
                    artifactIds: Object.freeze([...artifactIds]),
                    toolName,
                    targetPaths: Object.freeze([...actualPaths]),
                    dispatchState: 'pending'
                }
                : undefined;
        if (execution) state.deliveryPlan.artifactExecutions.push(execution);
        owner.pendingDeliveryDispatch = {
            scopeId: state.scopeId,
            toolName,
            params: params as Record<string, any>,
            artifactIds: Object.freeze([...artifactIds]),
            phase: dispatchInput.phase
        };
        let dispatched: Promise<any>;
        try {
            dispatched = input.executor!(toolName, params as Record<string, any>);
        } finally {
            owner.pendingDeliveryDispatch = undefined;
        }
        try {
            const result = await dispatched;
            if (execution) {
                execution.dispatchState = 'returned';
                execution.result = result;
            }
            return result;
        } catch (error) {
            if (execution) execution.dispatchState = 'threw';
            throw error;
        }
    };

    const authority: RuntimeOwnedSkillDeliveryPlanAuthority = Object.freeze({
        version: 'runtime-owned-skill-delivery-plan-authority/v0' as const,
        freeze(candidate: RuntimeOwnedSkillDeliveryPlanFreezeCandidate):
            RuntimeOwnedSkillDeliveryPlanFreezeDecision {
            if (state.completed) {
                return {
                    status: 'rejected',
                    code: 'runtime_delivery_plan_scope_completed',
                    blockers: ['当前 Skill 运行已经封口，不能再补写交付计划。']
                };
            }
            const resolution = buildSkillDeliveryPlan(candidate);
            if (resolution.status !== 'ready' || !resolution.plan) {
                return {
                    status: 'rejected',
                    code: 'runtime_delivery_plan_invalid',
                    blockers: resolution.blockers.length > 0
                        ? [...resolution.blockers]
                        : ['交付计划无效。']
                };
            }
            const plan = freezeSkillDeliveryPlan(resolution.plan);
            if (state.deliveryPlan) {
                if (state.deliveryPlan.plan.digest !== plan.digest) {
                    return {
                        status: 'rejected',
                        code: 'runtime_delivery_plan_already_frozen',
                        blockers: ['当前 Skill 运行已经冻结另一份交付计划；必须开始新的计划版本，不能原地覆盖。']
                    };
                }
                return {
                    status: 'retained',
                    binding: buildRuntimeOwnedSkillDeliveryPlanBinding(state)!,
                    blockers: []
                };
            }
            const postHocSaveExportCall = owner.queuedCalls.some((call) => (
                call.scopeIds.includes(state.scopeId)
                && call.executionClass === 'save_export'
            ));
            if (postHocSaveExportCall) {
                return {
                    status: 'rejected',
                    code: 'runtime_delivery_plan_frozen_too_late',
                    blockers: ['当前 Skill 已进入保存或导出队列；Runtime 不接受事后补写的交付计划。']
                };
            }
            state.deliveryPlan = {
                plan,
                artifactExecutions: []
            };
            return {
                status: 'frozen',
                binding: buildRuntimeOwnedSkillDeliveryPlanBinding(state)!,
                blockers: []
            };
        },
        async executeArtifacts(executionInput: {
            artifactIds: readonly string[];
            toolName: string;
            params: Record<string, any>;
        }): Promise<any> {
            return dispatchArtifacts({ ...executionInput, phase: 'delivery' });
        },
        async executeStagedArtifacts(stagingInput: {
            lease: RuntimeOwnedSkillStagingLease;
            artifactIds: readonly string[];
            toolName: string;
            params: Record<string, any>;
        }): Promise<any> {
            return dispatchArtifacts({ ...stagingInput, phase: 'staging' });
        },
        acceptExternalCommit(commitInput: {
            artifactIds: readonly string[];
            receipt: RuntimeOwnedSkillExternalDeliveryCommitReceipt;
        }): RuntimeOwnedSkillDeliveryExternalCommitDecision {
            if (!state.deliveryPlan) {
                return {
                    status: 'rejected',
                    code: 'runtime_delivery_plan_not_frozen',
                    blockers: ['外部事务提交前没有冻结交付计划。']
                };
            }
            if (!commitInput.receipt
                || !RUNTIME_OWNED_SKILL_EXTERNAL_DELIVERY_COMMIT_RECEIPTS.has(commitInput.receipt)) {
                return {
                    status: 'rejected',
                    code: 'runtime_delivery_external_commit_untrusted',
                    blockers: ['外部文件提交回执不是由可信事务 owner 签发。']
                };
            }
            const artifactIds = commitInput.artifactIds.map((artifactId) => (
                String(artifactId || '').trim()
            ));
            const planArtifacts = state.deliveryPlan.plan.artifacts;
            const plannedArtifactIds = planArtifacts.map((artifact) => artifact.artifactId);
            const committedFiles = commitInput.receipt.committedFiles;
            const committedFilesMatch = committedFiles.length === planArtifacts.length
                && committedFiles.every((file, index) => {
                    const artifact = planArtifacts[index];
                    return file.artifactId === artifact.artifactId
                        && normalizeSkillDeliveryArtifactPath(file.path)
                            === normalizeSkillDeliveryArtifactPath(artifact.path)
                        && Number.isSafeInteger(file.byteLength)
                        && file.byteLength > 0
                        && /^[a-f0-9]{64}$/.test(file.sha256);
                });
            if (commitInput.receipt.deliveryPlanDigest !== state.deliveryPlan.plan.digest
                || !sameOrderedStrings(artifactIds, plannedArtifactIds)
                || !committedFilesMatch) {
                return {
                    status: 'rejected',
                    code: 'runtime_delivery_external_commit_mismatch',
                    blockers: ['外部事务提交回执与 Runtime 冻结的完整 artifact 集合不一致。']
                };
            }
            if (state.deliveryPlan.artifactExecutions.length > 0) {
                return {
                    status: 'rejected',
                    code: 'runtime_delivery_artifact_already_dispatched',
                    blockers: ['当前冻结 artifact 已经通过另一条交付调用派发，不能重复接受外部提交。']
                };
            }
            state.deliveryPlan.artifactExecutions.push({
                artifactIds: Object.freeze([...artifactIds]),
                toolName: 'runtimeExternalFileTransaction',
                targetPaths: Object.freeze(committedFiles.map((file) => (
                    normalizeSkillDeliveryArtifactPath(file.path)
                ))),
                dispatchState: 'returned',
                result: Object.freeze({
                    success: true,
                    committedFiles: Object.freeze(committedFiles.map((file) => Object.freeze({ ...file })))
                })
            });
            const binding = buildRuntimeOwnedSkillDeliveryPlanBinding(state)!;
            return binding.status === 'ready'
                ? { status: 'accepted', binding }
                : {
                    status: 'rejected',
                    code: 'runtime_delivery_external_commit_mismatch',
                    blockers: [...binding.issues]
                };
        },
        boundaries: Object.freeze({
            runtimeOwned: true,
            acceptsProducerCandidateOnly: true,
            freezesBeforeFinalDeliveryDispatch: true,
            immutableWithinScope: true,
            selectsConvention: false,
            creditsOnlyGuardedOrTrustedTransactionCommits: true,
            grantsPermission: false
        })
    });
    return authority;
}

/** 仅可信完整 ledger 可把 binding 绑定到最终 Skill result 对象。 */
export function attachRuntimeOwnedSkillDeliveryPlanBinding<T>(
    result: T,
    ledger: RuntimeOwnedSkillToolLedger | undefined
): T {
    if (!result || typeof result !== 'object' || !isRuntimeOwnedCompleteSkillToolLedger(ledger)) {
        return result;
    }
    const binding = ledger.deliveryPlanBinding;
    if (!binding
        || binding.status !== 'ready'
        || !RUNTIME_OWNED_SKILL_DELIVERY_PLAN_BINDINGS.has(binding)) {
        return result;
    }
    RUNTIME_OWNED_SKILL_DELIVERY_PLAN_RESULT_BINDINGS.set(result as object, binding);
    return result;
}

/** 包装 Skill result 时显式转移同一不可序列化 binding；JSON/克隆不会自动继承。 */
export function forwardRuntimeOwnedSkillDeliveryPlanBinding<T>(source: unknown, target: T): T {
    if (!target || typeof target !== 'object' || !source || typeof source !== 'object') return target;
    const binding = RUNTIME_OWNED_SKILL_DELIVERY_PLAN_RESULT_BINDINGS.get(source as object);
    if (!binding || !RUNTIME_OWNED_SKILL_DELIVERY_PLAN_BINDINGS.has(binding)) return target;
    RUNTIME_OWNED_SKILL_DELIVERY_PLAN_RESULT_BINDINGS.set(target as object, binding);
    return target;
}

export function readRuntimeOwnedSkillDeliveryPlanBinding(
    result: unknown
): RuntimeOwnedSkillDeliveryPlanBinding | undefined {
    if (!result || typeof result !== 'object') return undefined;
    const binding = RUNTIME_OWNED_SKILL_DELIVERY_PLAN_RESULT_BINDINGS.get(result as object);
    return binding?.status === 'ready'
        && RUNTIME_OWNED_SKILL_DELIVERY_PLAN_BINDINGS.has(binding)
        ? binding
        : undefined;
}

export function readRuntimeOwnedSkillDeliveryPlanDigest(result: unknown): string | undefined {
    return readRuntimeOwnedSkillDeliveryPlanBinding(result)?.plan.digest;
}

/** 事务桥只读取由本 scope owner 签发的冻结对象身份；JSON/手造对象一律失败。 */
export function isRuntimeOwnedSkillDeliveryPlanBinding(
    value: unknown
): value is RuntimeOwnedSkillDeliveryPlanBinding {
    return Boolean(value)
        && typeof value === 'object'
        && RUNTIME_OWNED_SKILL_DELIVERY_PLAN_BINDINGS.has(value as object)
        && (value as RuntimeOwnedSkillDeliveryPlanBinding).version
            === RUNTIME_OWNED_SKILL_DELIVERY_PLAN_BINDING_VERSION;
}

export function beginRuntimeOwnedSkillToolLedgerScope(
    executor: GuardedAtomicToolExecutor | undefined
): RuntimeOwnedSkillToolLedgerScope | undefined {
    if (!executor) return undefined;
    const owner = GUARDED_ATOMIC_TOOL_LEDGER_STATES.get(executor);
    if (!owner) return undefined;
    runtimeOwnedSkillToolLedgerScopeSequence += 1;
    const scope: RuntimeOwnedSkillToolLedgerScope = Object.freeze({
        version: 'runtime-owned-skill-tool-ledger-scope/v0',
        scopeId: `skill-tool-ledger-${runtimeOwnedSkillToolLedgerScopeSequence}`
    });
    owner.activeScopeIds.add(scope.scopeId);
    RUNTIME_OWNED_SKILL_TOOL_LEDGER_SCOPES.set(scope, {
        owner,
        scopeId: scope.scopeId
    });
    return scope;
}

export async function completeRuntimeOwnedSkillToolLedgerScope(
    scope: RuntimeOwnedSkillToolLedgerScope | undefined
): Promise<RuntimeOwnedSkillToolLedger | undefined> {
    if (!scope) return undefined;
    const state = RUNTIME_OWNED_SKILL_TOOL_LEDGER_SCOPES.get(scope);
    if (!state) return undefined;
    if (state.completed) return state.completed;
    await state.owner.drain();
    state.owner.activeScopeIds.delete(state.scopeId);
    const entries = state.owner.entries
        .filter((entry) => entry.scopeIds.includes(state.scopeId))
        .map((entry): RuntimeOwnedSkillToolLedgerEntry => Object.freeze({
            toolName: entry.toolName,
            params: Object.freeze({ ...entry.params }),
            dispatchState: entry.dispatchState,
            ...(Object.prototype.hasOwnProperty.call(entry, 'result')
                ? { result: entry.result }
                : {})
        }));
    const deliveryPlanBinding = buildRuntimeOwnedSkillDeliveryPlanBinding(state);
    const ledger: RuntimeOwnedSkillToolLedger = Object.freeze({
        version: RUNTIME_OWNED_SKILL_TOOL_LEDGER_VERSION,
        complete: true,
        entries: Object.freeze(entries),
        ...(deliveryPlanBinding ? { deliveryPlanBinding } : {}),
        boundaries: Object.freeze({
            runtimeOwned: true,
            exhaustiveForScope: true,
            executorReportedResultsIgnored: true
        })
    });
    RUNTIME_OWNED_SKILL_TOOL_LEDGERS.add(ledger);
    state.completed = ledger;
    return ledger;
}

export function isRuntimeOwnedCompleteSkillToolLedger(
    value: unknown
): value is RuntimeOwnedSkillToolLedger {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const ledger = value as RuntimeOwnedSkillToolLedger;
    return RUNTIME_OWNED_SKILL_TOOL_LEDGERS.has(value as object)
        && ledger.version === RUNTIME_OWNED_SKILL_TOOL_LEDGER_VERSION
        && ledger.complete === true
        && Array.isArray(ledger.entries)
        && ledger.boundaries?.runtimeOwned === true
        && ledger.boundaries.exhaustiveForScope === true
        && ledger.boundaries.executorReportedResultsIgnored === true;
}

/** 技能启动时，模型上下文里的期望执行目标。 */
export interface SkillWorkflowTargetIdentity {
    documentId?: number;
    activeLayerId?: number;
    historyStateId?: number;
}

export interface SkillWorkflowTargetRebindingInput {
    /** 被调用的技能 id，例如 sku-batch。 */
    skillId: string;
    /** 主循环上下文签发的期望目标（可能已经陈旧）。 */
    expected: SkillWorkflowTargetIdentity;
    /** 技能启动那一刻真实读到的活动文档。documentId 缺失表示当前没有打开的文档。 */
    observed: SkillWorkflowTargetIdentity & { documentName?: string };
}

export type SkillWorkflowTargetRebindingDecision =
    /** 期望与现实一致，按原目标继续。 */
    | { action: 'proceed'; reason: string }
    /**
     * 现实与期望不一致，但技能可以在真实的当前文档上继续；
     * 内部 guard owner 以 observed 为新锚点重新绑定。
     */
    | { action: 'rebind'; reason: string }
    /**
     * 差异性质不允许自动接管，必须回到模型让它先明确目标。
     * error 必须指名可以刷新执行目标的具体工具，否则模型无法脱困。
     */
    | { action: 'block'; code: string; error: string };

/**
 * 可以刷新技能执行目标的观察工具——写进拦截文案，模型才知道该调什么。
 *
 * 真机 [491] 的死循环正是因为拦截文案只说「请重新观察当前文档后再试」：
 * 模型照做了 20 次（searchProjectResources / listProjectResources / getDesignProjectState），
 * 但这些都不读 Photoshop 文档，一次都刷不新期望目标，于是原样重试、撞满 14 次。
 */
export const SKILL_WORKFLOW_TARGET_REFRESH_TOOLS = [
    'getDocumentInfo',
    'switchDocument',
    'getLayerHierarchy'
] as const;

/**
 * 技能启动前的目标对账：期望目标与真实活动文档不一致时怎么办。
 *
 * 这是「技能」与「原子写工具」的分界点。原子写工具一次调用只改一处，
 * 「执行前文档没变过」是合理前提；而技能是多步工作流——sku-batch 第一件事
 * 就是打开模板文件、切换文档——对它套同一把锁属于范畴错误。
 * 技能内部每个原子写仍各自过 preflight + guard（createGuardedAtomicToolExecutor），
 * 所以这里放行不等于放弃保护，只是把锚点从「技能调用前的模型上下文快照」
 * 换成「技能启动那一刻的真实文档」。
 */
export function resolveSkillWorkflowTargetRebinding(
    input: SkillWorkflowTargetRebindingInput
): SkillWorkflowTargetRebindingDecision {
    const expectedDocumentId = input.expected.documentId;
    const observedDocumentId = input.observed.documentId;

    if (observedDocumentId === undefined) {
        return {
            action: 'block',
            code: 'skill_workflow_target_no_open_document',
            error: `当前 Photoshop 没有打开的文档，${input.skillId} 无法开始。`
                + '请先打开或新建目标文档，再重新调用。'
        };
    }
    if (expectedDocumentId === undefined) {
        return { action: 'rebind', reason: '此前没有稳定的期望目标，以当前活动文档为锚点开始。' };
    }

    // TODO(human): 期望文档与当前活动文档不一致时的处置策略
    return { action: 'proceed', reason: '期望目标与当前活动文档一致。' };
}

export interface GuardedAtomicToolExecutionDecision {
    ready: boolean;
    businessArguments: Record<string, any>;
    executionArguments?: Record<string, any>;
    preflight: AgentToolExecutionPreflight;
    blockedResult?: Record<string, any>;
}

export interface CreateGuardedAtomicToolExecutorInput {
    executeTool: GuardedAtomicToolExecutor;
    userRequest?: string;
    initialCompletedToolCalls?: AgentToolExecutionPreflightLogEntry[];
}

function stripUntrustedTargetGuard(params: Record<string, any>): Record<string, any> {
    const {
        [DESIGN_ECHO_TARGET_GUARD_ARGUMENT]: _untrustedTargetGuard,
        ...businessArguments
    } = params || {};
    return businessArguments;
}

/**
 * 为 Skill 内部的一次原子调用构造执行参数。
 *
 * Skill 只能提交业务参数；文档、历史版本与活动图层绑定完全由 Harness 根据此前
 * 真实 Tool 结果签发。这里复用主 Agent 的同一 preflight，不建立 SKU 或其他品类分支。
 */
export function buildGuardedAtomicToolExecutionDecision(input: {
    toolName: string;
    params?: Record<string, any>;
    userRequest?: string;
    completedToolCalls?: AgentToolExecutionPreflightLogEntry[];
}): GuardedAtomicToolExecutionDecision {
    const toolName = String(input.toolName || '').trim();
    const businessArguments = stripUntrustedTargetGuard(input.params || {});
    const preflight = buildAgentToolExecutionPreflight({
        userRequest: input.userRequest,
        toolCalls: [{ name: toolName, arguments: businessArguments }],
        completedToolCalls: input.completedToolCalls || [],
        requiresUserVisiblePreActionRationale: false
    });
    if (!preflight.ready || preflight.status === 'blocked') {
        const error = preflight.message
            || `Skill 内部原子工具 ${toolName} 缺少可校验的 Photoshop 执行目标。`;
        return {
            ready: false,
            businessArguments,
            preflight,
            blockedResult: {
                success: false,
                code: 'skill_atomic_tool_execution_preflight_blocked',
                policyGate: true,
                blockedTool: toolName,
                error,
                blockers: [...preflight.blockers],
                executesPhotoshop: false,
                grantsPermission: false,
                countsAsObservation: false,
                countsAsTaskProgress: false
            }
        };
    }

    if (!isAgentToolExecutionGuarded(toolName, businessArguments)) {
        return {
            ready: true,
            businessArguments,
            executionArguments: businessArguments,
            preflight
        };
    }
    const targetGuard = preflight.preconditions.targetGuard;
    if (!targetGuard) {
        return {
            ready: true,
            businessArguments,
            executionArguments: businessArguments,
            preflight
        };
    }

    const hasExplicitLayerId = Number.isSafeInteger(businessArguments.layerId)
        && Number(businessArguments.layerId) > 0;
    return {
        ready: true,
        businessArguments,
        executionArguments: {
            ...businessArguments,
            [DESIGN_ECHO_TARGET_GUARD_ARGUMENT]: {
                expectedDocumentId: targetGuard.expectedDocumentId,
                ...(!hasExplicitLayerId && targetGuard.expectedActiveLayerId !== undefined
                    ? { expectedActiveLayerId: targetGuard.expectedActiveLayerId }
                    : {}),
                ...(targetGuard.expectedHistoryStateRef
                    ? { expectedHistoryStateRef: targetGuard.expectedHistoryStateRef }
                    : {}),
                observationTool: targetGuard.observationTool
            }
        },
        preflight
    };
}

/**
 * 创建单个 Skill 运行作用域内的 target-binding owner。
 *
 * 所有调用强制串行，因此后一个写入的 preflight 一定能看到前一个读写结果；记录中只
 * 保存业务参数，Harness 私有 target guard 不会进入 Skill 报告或后续模型上下文。
 */
export function createGuardedAtomicToolExecutor(
    input: CreateGuardedAtomicToolExecutorInput
): GuardedAtomicToolExecutor {
    const completedToolCalls = [...(input.initialCompletedToolCalls || [])];
    let executionQueue: Promise<void> = Promise.resolve();
    const ledgerState: GuardedAtomicToolLedgerState = {
        activeScopeIds: new Set<string>(),
        entries: [],
        queuedCalls: [],
        dispatchSequence: 0,
        drain: async (): Promise<void> => await executionQueue
    };

    const executor: GuardedAtomicToolExecutor = function executeGuardedAtomicTool(
        toolName: string,
        params: Record<string, any>
    ): Promise<any> {
        const scopeIds = Array.from(ledgerState.activeScopeIds);
        ledgerState.dispatchSequence += 1;
        const dispatchSequence = ledgerState.dispatchSequence;
        let queuedParams: Readonly<Record<string, any>>;
        try {
            queuedParams = snapshotAtomicToolParams(params || {});
        } catch (error) {
            return Promise.resolve(buildDeliveryAuthorityBlockedResult({
                code: 'skill_atomic_tool_arguments_invalid',
                error: error instanceof Error ? error.message : String(error),
                toolName
            }));
        }
        const pendingDeliveryDispatch = ledgerState.pendingDeliveryDispatch;
        const deliveryScopeBindings = pendingDeliveryDispatch
            && pendingDeliveryDispatch.params === params
            && pendingDeliveryDispatch.toolName === toolName
            && scopeIds.includes(pendingDeliveryDispatch.scopeId)
            ? [Object.freeze({
                scopeId: pendingDeliveryDispatch.scopeId,
                artifactIds: Object.freeze([...pendingDeliveryDispatch.artifactIds]),
                phase: pendingDeliveryDispatch.phase
            })]
            : [];
        ledgerState.queuedCalls.push({
            scopeIds: Object.freeze([...scopeIds]),
            dispatchSequence,
            toolName,
            executionClass: classifyAgentToolExecution(toolName, queuedParams),
            targetPaths: Object.freeze(readAtomicDeliveryTargetPaths(toolName, queuedParams)),
            deliveryScopeBindings: Object.freeze([...deliveryScopeBindings])
        });
        const execution = executionQueue.then(async (): Promise<any> => {
            const decision = buildGuardedAtomicToolExecutionDecision({
                toolName,
                params: queuedParams as Record<string, any>,
                userRequest: input.userRequest,
                completedToolCalls
            });
            if (!decision.ready || !decision.executionArguments) {
                const blockedResult = decision.blockedResult || {
                    success: false,
                    code: 'skill_atomic_tool_execution_preflight_blocked',
                    error: `Skill 内部原子工具 ${toolName} 未通过执行目标预检。`
                };
                completedToolCalls.push({
                    name: toolName,
                    arguments: decision.businessArguments,
                    result: blockedResult
                });
                ledgerState.entries.push({
                    scopeIds,
                    dispatchSequence,
                    deliveryScopeBindings,
                    toolName,
                    params: decision.businessArguments,
                    dispatchState: 'not_dispatched',
                    result: blockedResult
                });
                return blockedResult;
            }

            try {
                const result = await input.executeTool(toolName, decision.executionArguments);
                completedToolCalls.push({
                    name: toolName,
                    arguments: decision.businessArguments,
                    result
                });
                ledgerState.entries.push({
                    scopeIds,
                    dispatchSequence,
                    deliveryScopeBindings,
                    toolName,
                    params: decision.businessArguments,
                    dispatchState: 'returned',
                    result
                });
                return result;
            } catch (error) {
                ledgerState.entries.push({
                    scopeIds,
                    dispatchSequence,
                    deliveryScopeBindings,
                    toolName,
                    params: decision.businessArguments,
                    dispatchState: 'threw'
                });
                throw error;
            }
        });
        executionQueue = execution.then(
            () => undefined,
            () => undefined
        );
        return execution;
    };
    GUARDED_ATOMIC_TOOL_LEDGER_STATES.set(executor, ledgerState);
    return executor;
}
