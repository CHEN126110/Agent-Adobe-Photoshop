/**
 * 确定性一致性验证契约（纯逻辑）。
 *
 * 本模块只回答四件事：
 *   1) 当前规则是否有且仅有一个由上游明确签出的权威 expectation；
 *   2) 当前目标、当前修订版本上的必要 observations 是否齐全；
 *   3) expectation 与 observations 之间是否存在可证明的差异；
 *   4) 差异是否满足“单一、定点、可编辑、已有旁证”的安全修复资格。
 *
 * 它不读取文件、不调用 Tool、不持久化状态、不授予权限、不选择工作流，也不产出最终 Verdict。
 * 业务适配器负责把用户指令、配置、文件元数据、文档结构/文字等归一化为 Claim；执行器只可把
 * 本模块给出的 repairEligibility 当作候选修复资格，并须在执行前再次校验 target + revision。
 */

export const DETERMINISTIC_CONSISTENCY_VERIFICATION_VERSION =
    'deterministic-consistency-verification/v1' as const;

export type ConsistencyFactScalar = string | number | boolean | null;

/**
 * 值必须由业务适配器预先归一化。例如“3双装”“三双装”都应先归一化为 number 3。
 * 数组用于集合或有序列表；本契约不接受对象，避免不同序列化形态制造伪差异。
 */
export type ConsistencyFactValue = ConsistencyFactScalar | readonly ConsistencyFactScalar[];

export type ConsistencyExpectationSourceKind =
    | 'user_instruction'
    | 'structured_confirmation'
    | 'project_config'
    | 'execution_plan'
    | 'artifact_metadata';

export type ConsistencyObservationSourceKind =
    | 'artifact_metadata'
    | 'document_structure'
    | 'document_text'
    | 'pixel_observation'
    | 'operation_result';

export type ConsistencyEvidenceStrength = 'deterministic' | 'inferred';

export interface ConsistencyTargetRevision {
    /** 目标的稳定引用，例如 documentId、规范化文件引用或 artifact id。 */
    targetRef: string;
    /** 能在目标发生变化后失效的修订引用，例如 historyStateId、mtime+size 或内容 hash。 */
    revisionRef: string;
}

interface ConsistencyClaimBase {
    claimId: string;
    /** 业务属性的稳定键，例如 pack_count、canvas_size、variant_codes。 */
    propertyKey: string;
    value: ConsistencyFactValue;
    /** 指向原始证据的安全引用；不得用自然语言结论冒充证据。 */
    proofRef: string;
}

export interface ConsistencyExpectationClaim extends ConsistencyClaimBase {
    role: 'expectation';
    sourceKind: ConsistencyExpectationSourceKind;
    /**
     * 本模块不猜来源优先级。上游必须把当前任务唯一真相源签成 authoritative；
     * 其它尚未采纳的来源只能是 candidate。
     */
    authority: 'authoritative' | 'candidate';
}

export type ConsistencyObservationEditability =
    | {
        status: 'editable';
        /** 精确到可修对象的稳定引用，例如 text-layer:123；不是 Tool 名或动作。 */
        repairTargetRef: string;
    }
    | {
        status: 'read_only';
        reason?: string;
    }
    | {
        status: 'unknown';
        reason?: string;
    };

export interface ConsistencyObservationClaim extends ConsistencyClaimBase {
    role: 'observation';
    sourceKind: ConsistencyObservationSourceKind;
    /** observation 必须绑定其实际读取时的目标与修订版本。 */
    target: ConsistencyTargetRevision;
    /** inferred 默认不能满足必要观察，也不能形成自动修复资格。 */
    evidenceStrength: ConsistencyEvidenceStrength;
    editability: ConsistencyObservationEditability;
}

export type ConsistencyClaim = ConsistencyExpectationClaim | ConsistencyObservationClaim;

export type ConsistencyComparisonOperator = 'exact' | 'set_equals' | 'contains';

export type ConsistencyMismatchDisposition = 'conflict' | 'warning';

export interface ConsistencyObservationPolicy {
    sourceKind: ConsistencyObservationSourceKind;
    /** required=true 时，没有当前 target + revision 上的可接受证据会得到 needs_observation。 */
    required: boolean;
    /** 该来源不一致时是事实冲突，还是仅记录元数据漂移。 */
    mismatchDisposition: ConsistencyMismatchDisposition;
    /** 默认只接受 deterministic；接受 inferred 必须由规则显式声明。 */
    acceptedEvidenceStrengths?: readonly ConsistencyEvidenceStrength[];
}

export interface ConsistencyRepairPolicy {
    /** 当前版本只允许单一 observation 的定点值替换资格，不描述也不执行具体 Tool。 */
    mode: 'single_observation';
    /** 只有来自这些来源的唯一冲突 observation 才可能取得修复资格。 */
    eligibleObservationSourceKinds: readonly ConsistencyObservationSourceKind[];
    /**
     * 修复前必须已有这些来源的当前、可信、匹配 expectation 的旁证。
     * 例如修改 PSD 数量文字前，可要求文件元数据与文档结构都已经匹配。
     */
    requireMatchingObservationSourceKinds?: readonly ConsistencyObservationSourceKind[];
}

export interface DeterministicConsistencyRule {
    ruleId: string;
    propertyKey: string;
    operator: ConsistencyComparisonOperator;
    observationPolicies: readonly ConsistencyObservationPolicy[];
    repairPolicy?: ConsistencyRepairPolicy;
}

export interface DeterministicConsistencyVerificationInput {
    target: ConsistencyTargetRevision;
    claims: readonly ConsistencyClaim[];
    rules: readonly DeterministicConsistencyRule[];
}

export type ConsistencyCheckStatus =
    | 'consistent'
    | 'warning'
    | 'needs_expectation'
    | 'needs_observation'
    | 'conflict'
    | 'expectation_conflict';

export type ConsistencyVerificationStatus = ConsistencyCheckStatus | 'invalid_input';

export type ConsistencyRepairIneligibleReason =
    | 'expectation_not_unique'
    | 'verification_incomplete'
    | 'rule_disallows_repair'
    | 'multiple_conflicting_observations'
    | 'source_policy_disallows_repair'
    | 'observation_not_editable'
    | 'required_matching_observation_missing';

export interface ConsistencyRepairPrecondition {
    version: typeof DETERMINISTIC_CONSISTENCY_VERIFICATION_VERSION;
    target: ConsistencyTargetRevision;
    expectationClaimId: string;
    expectationProofRef: string;
    observationClaimId: string;
    observationProofRef: string;
}

export type ConsistencyRepairEligibility =
    | {
        status: 'not_needed';
        reason: 'no_blocking_conflict';
    }
    | {
        status: 'ineligible';
        reason: ConsistencyRepairIneligibleReason;
        conflictingObservationClaimIds: readonly string[];
    }
    | {
        status: 'eligible';
        mode: 'replace_claim_value';
        observationClaimId: string;
        observationSourceKind: ConsistencyObservationSourceKind;
        repairTargetRef: string;
        previousValue: ConsistencyFactValue;
        expectedValue: ConsistencyFactValue;
        precondition: ConsistencyRepairPrecondition;
        /** 资格证明只证明“当前修订上可安全尝试”，不证明修复已经执行或成功。 */
        proofRef: string;
    };

export interface DeterministicConsistencyCheckResult {
    ruleId: string;
    propertyKey: string;
    operator: ConsistencyComparisonOperator;
    status: ConsistencyCheckStatus;
    authoritativeExpectationClaimIds: readonly string[];
    candidateExpectationClaimIds: readonly string[];
    matchingObservationClaimIds: readonly string[];
    conflictingObservationClaimIds: readonly string[];
    warningObservationClaimIds: readonly string[];
    missingRequiredObservationSourceKinds: readonly ConsistencyObservationSourceKind[];
    wrongTargetObservationClaimIds: readonly string[];
    staleRevisionObservationClaimIds: readonly string[];
    unacceptedEvidenceObservationClaimIds: readonly string[];
    evidenceRefs: readonly string[];
    repairEligibility: ConsistencyRepairEligibility;
    /** 对本次检查输入与结论的稳定不透明引用；不是加密签名。 */
    proofRef: string;
}

export type ConsistencyVerificationInputIssueCode =
    | 'empty_target_ref'
    | 'empty_revision_ref'
    | 'duplicate_claim_id'
    | 'invalid_claim'
    | 'duplicate_rule_id'
    | 'invalid_rule';

export interface ConsistencyVerificationInputIssue {
    code: ConsistencyVerificationInputIssueCode;
    path: string;
    message: string;
}

export interface DeterministicConsistencyVerificationReport {
    version: typeof DETERMINISTIC_CONSISTENCY_VERIFICATION_VERSION;
    target: ConsistencyTargetRevision;
    status: ConsistencyVerificationStatus;
    checks: readonly DeterministicConsistencyCheckResult[];
    inputIssues: readonly ConsistencyVerificationInputIssue[];
    evidenceRefs: readonly string[];
    /** 报告内容的稳定不透明引用；调用方仍需读取 checks，不得只凭该字符串放行。 */
    proofRef: string;
}

const DEFAULT_ACCEPTED_EVIDENCE_STRENGTHS: readonly ConsistencyEvidenceStrength[] = [
    'deterministic'
];

function isNonEmpty(value: string): boolean {
    return value.trim().length > 0;
}

function copyTarget(target: ConsistencyTargetRevision): ConsistencyTargetRevision {
    return {
        targetRef: target.targetRef,
        revisionRef: target.revisionRef
    };
}

function copyFactValue(value: ConsistencyFactValue): ConsistencyFactValue {
    return Array.isArray(value) ? [...value] : value;
}

function isValidFactScalar(value: unknown): value is ConsistencyFactScalar {
    if (value === null) return true;
    if (typeof value === 'number') return Number.isFinite(value);
    return typeof value === 'string' || typeof value === 'boolean';
}

function isValidFactValue(value: unknown): value is ConsistencyFactValue {
    if (isValidFactScalar(value)) return true;
    return Array.isArray(value) && value.every(isValidFactScalar);
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
    return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function canonicalScalar(value: ConsistencyFactScalar): string {
    if (value === null) return 'null:';
    return `${typeof value}:${String(value)}`;
}

function valuesEqual(left: ConsistencyFactValue, right: ConsistencyFactValue): boolean {
    if (Array.isArray(left) || Array.isArray(right)) {
        if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
        return left.every((value, index) => canonicalScalar(value) === canonicalScalar(right[index]));
    }
    return canonicalScalar(left as ConsistencyFactScalar) === canonicalScalar(right as ConsistencyFactScalar);
}

function setsEqual(left: ConsistencyFactValue, right: ConsistencyFactValue): boolean {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    const leftSet = uniqueSorted(left.map(canonicalScalar));
    const rightSet = uniqueSorted(right.map(canonicalScalar));
    return leftSet.length === rightSet.length
        && leftSet.every((value, index) => value === rightSet[index]);
}

function valueContains(observed: ConsistencyFactValue, expected: ConsistencyFactValue): boolean {
    if (typeof observed === 'string' && typeof expected === 'string') {
        return observed.includes(expected);
    }
    if (!Array.isArray(observed)) return false;
    const observedSet = new Set(observed.map(canonicalScalar));
    if (Array.isArray(expected)) {
        return expected.every((value) => observedSet.has(canonicalScalar(value)));
    }
    return observedSet.has(canonicalScalar(expected as ConsistencyFactScalar));
}

function comparisonMatches(
    expected: ConsistencyFactValue,
    observed: ConsistencyFactValue,
    operator: ConsistencyComparisonOperator
): boolean {
    switch (operator) {
        case 'exact':
            return valuesEqual(expected, observed);
        case 'set_equals':
            return setsEqual(expected, observed);
        case 'contains':
            return valueContains(observed, expected);
    }
}

function fingerprint(value: string, seed: number): string {
    let hash = seed >>> 0;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

function buildProofRef(namespace: string, payload: unknown): string {
    const serialized = JSON.stringify(payload);
    const digest = `${fingerprint(serialized, 2166136261)}${fingerprint(serialized, 3339675911)}`;
    return `${DETERMINISTIC_CONSISTENCY_VERIFICATION_VERSION}#${namespace}:${digest}`;
}

export function isSameConsistencyTargetRevision(
    left: ConsistencyTargetRevision,
    right: ConsistencyTargetRevision
): boolean {
    return left.targetRef === right.targetRef && left.revisionRef === right.revisionRef;
}

function addIssue(
    issues: ConsistencyVerificationInputIssue[],
    code: ConsistencyVerificationInputIssueCode,
    path: string,
    message: string
): void {
    issues.push({ code, path, message });
}

function validateClaim(
    claim: ConsistencyClaim,
    index: number,
    issues: ConsistencyVerificationInputIssue[]
): void {
    const path = `claims[${index}]`;
    if (!isNonEmpty(claim.claimId)) {
        addIssue(issues, 'invalid_claim', `${path}.claimId`, 'claimId 不能为空。');
    }
    if (!isNonEmpty(claim.propertyKey)) {
        addIssue(issues, 'invalid_claim', `${path}.propertyKey`, 'propertyKey 不能为空。');
    }
    if (!isNonEmpty(claim.proofRef)) {
        addIssue(issues, 'invalid_claim', `${path}.proofRef`, 'proofRef 不能为空。');
    }
    if (!isValidFactValue(claim.value)) {
        addIssue(issues, 'invalid_claim', `${path}.value`, 'value 必须是有限标量或标量数组。');
    }
    if (claim.role !== 'observation') return;
    if (!isNonEmpty(claim.target.targetRef)) {
        addIssue(issues, 'invalid_claim', `${path}.target.targetRef`, 'observation.targetRef 不能为空。');
    }
    if (!isNonEmpty(claim.target.revisionRef)) {
        addIssue(issues, 'invalid_claim', `${path}.target.revisionRef`, 'observation.revisionRef 不能为空。');
    }
    if (claim.editability.status === 'editable' && !isNonEmpty(claim.editability.repairTargetRef)) {
        addIssue(
            issues,
            'invalid_claim',
            `${path}.editability.repairTargetRef`,
            '可编辑 observation 必须提供精确 repairTargetRef。'
        );
    }
}

function validateRule(
    rule: DeterministicConsistencyRule,
    index: number,
    issues: ConsistencyVerificationInputIssue[]
): void {
    const path = `rules[${index}]`;
    if (!isNonEmpty(rule.ruleId)) {
        addIssue(issues, 'invalid_rule', `${path}.ruleId`, 'ruleId 不能为空。');
    }
    if (!isNonEmpty(rule.propertyKey)) {
        addIssue(issues, 'invalid_rule', `${path}.propertyKey`, 'propertyKey 不能为空。');
    }
    if (rule.observationPolicies.length === 0) {
        addIssue(issues, 'invalid_rule', `${path}.observationPolicies`, '至少需要一个 observation policy。');
        return;
    }

    const policySources = rule.observationPolicies.map((policy) => policy.sourceKind);
    if (new Set(policySources).size !== policySources.length) {
        addIssue(
            issues,
            'invalid_rule',
            `${path}.observationPolicies`,
            '同一规则中 sourceKind 不得重复。'
        );
    }
    if (!rule.observationPolicies.some((policy) => policy.required)) {
        addIssue(
            issues,
            'invalid_rule',
            `${path}.observationPolicies`,
            '至少一个 observation policy 必须标记 required。'
        );
    }
    rule.observationPolicies.forEach((policy, policyIndex) => {
        const strengths = policy.acceptedEvidenceStrengths;
        if (strengths && (strengths.length === 0 || new Set(strengths).size !== strengths.length)) {
            addIssue(
                issues,
                'invalid_rule',
                `${path}.observationPolicies[${policyIndex}].acceptedEvidenceStrengths`,
                'acceptedEvidenceStrengths 必须非空且不得重复。'
            );
        }
    });

    const repairPolicy = rule.repairPolicy;
    if (!repairPolicy) return;
    const eligibleSources = repairPolicy.eligibleObservationSourceKinds;
    if (eligibleSources.length === 0 || new Set(eligibleSources).size !== eligibleSources.length) {
        addIssue(
            issues,
            'invalid_rule',
            `${path}.repairPolicy.eligibleObservationSourceKinds`,
            '可修来源必须非空且不得重复。'
        );
    }
    eligibleSources.forEach((sourceKind) => {
        const policy = rule.observationPolicies.find((item) => item.sourceKind === sourceKind);
        if (!policy || policy.mismatchDisposition !== 'conflict') {
            addIssue(
                issues,
                'invalid_rule',
                `${path}.repairPolicy.eligibleObservationSourceKinds`,
                `可修来源 ${sourceKind} 必须存在且 mismatchDisposition=conflict。`
            );
        }
    });

    const matchingSources = repairPolicy.requireMatchingObservationSourceKinds ?? [];
    if (new Set(matchingSources).size !== matchingSources.length) {
        addIssue(
            issues,
            'invalid_rule',
            `${path}.repairPolicy.requireMatchingObservationSourceKinds`,
            '旁证来源不得重复。'
        );
    }
    matchingSources.forEach((sourceKind) => {
        const policy = rule.observationPolicies.find((item) => item.sourceKind === sourceKind);
        if (!policy || !policy.required) {
            addIssue(
                issues,
                'invalid_rule',
                `${path}.repairPolicy.requireMatchingObservationSourceKinds`,
                `旁证来源 ${sourceKind} 必须存在且 required=true。`
            );
        }
    });
}

/** 输入校验不抛异常；非法输入不会生成可修资格。 */
export function validateDeterministicConsistencyVerificationInput(
    input: DeterministicConsistencyVerificationInput
): ConsistencyVerificationInputIssue[] {
    const issues: ConsistencyVerificationInputIssue[] = [];
    if (!isNonEmpty(input.target.targetRef)) {
        addIssue(issues, 'empty_target_ref', 'target.targetRef', 'targetRef 不能为空。');
    }
    if (!isNonEmpty(input.target.revisionRef)) {
        addIssue(issues, 'empty_revision_ref', 'target.revisionRef', 'revisionRef 不能为空。');
    }

    const claimIds = new Set<string>();
    input.claims.forEach((claim, index) => {
        if (claimIds.has(claim.claimId)) {
            addIssue(issues, 'duplicate_claim_id', `claims[${index}].claimId`, `claimId ${claim.claimId} 重复。`);
        }
        claimIds.add(claim.claimId);
        validateClaim(claim, index, issues);
    });

    if (input.rules.length === 0) {
        addIssue(issues, 'invalid_rule', 'rules', '至少需要一个一致性规则。');
    }
    const ruleIds = new Set<string>();
    input.rules.forEach((rule, index) => {
        if (ruleIds.has(rule.ruleId)) {
            addIssue(issues, 'duplicate_rule_id', `rules[${index}].ruleId`, `ruleId ${rule.ruleId} 重复。`);
        }
        ruleIds.add(rule.ruleId);
        validateRule(rule, index, issues);
    });

    return issues.sort((left, right) => {
        const pathDelta = left.path.localeCompare(right.path);
        return pathDelta !== 0 ? pathDelta : left.code.localeCompare(right.code);
    });
}

function acceptedEvidenceStrengths(
    policy: ConsistencyObservationPolicy
): readonly ConsistencyEvidenceStrength[] {
    return policy.acceptedEvidenceStrengths ?? DEFAULT_ACCEPTED_EVIDENCE_STRENGTHS;
}

function ineligibleRepair(
    reason: ConsistencyRepairIneligibleReason,
    claims: readonly ConsistencyObservationClaim[]
): ConsistencyRepairEligibility {
    return {
        status: 'ineligible',
        reason,
        conflictingObservationClaimIds: claims.map((claim) => claim.claimId).sort()
    };
}

function evaluateRepairEligibility(
    status: ConsistencyCheckStatus,
    rule: DeterministicConsistencyRule,
    target: ConsistencyTargetRevision,
    expectation: ConsistencyExpectationClaim | undefined,
    matchingObservations: readonly ConsistencyObservationClaim[],
    conflictingObservations: readonly ConsistencyObservationClaim[],
    missingRequiredSources: readonly ConsistencyObservationSourceKind[]
): ConsistencyRepairEligibility {
    if (status === 'consistent' || status === 'warning') {
        return { status: 'not_needed', reason: 'no_blocking_conflict' };
    }
    if (!expectation || status === 'needs_expectation' || status === 'expectation_conflict') {
        return ineligibleRepair('expectation_not_unique', conflictingObservations);
    }
    if (missingRequiredSources.length > 0 || status === 'needs_observation') {
        return ineligibleRepair('verification_incomplete', conflictingObservations);
    }
    if (!rule.repairPolicy) {
        return ineligibleRepair('rule_disallows_repair', conflictingObservations);
    }
    if (conflictingObservations.length !== 1) {
        return ineligibleRepair('multiple_conflicting_observations', conflictingObservations);
    }

    const observation = conflictingObservations[0];
    if (!rule.repairPolicy.eligibleObservationSourceKinds.includes(observation.sourceKind)) {
        return ineligibleRepair('source_policy_disallows_repair', conflictingObservations);
    }
    if (observation.editability.status !== 'editable') {
        return ineligibleRepair('observation_not_editable', conflictingObservations);
    }

    const requiredMatchingSources = rule.repairPolicy.requireMatchingObservationSourceKinds ?? [];
    const allRequiredSourcesMatch = requiredMatchingSources.every((sourceKind) => (
        matchingObservations.some((claim) => claim.sourceKind === sourceKind)
    ));
    if (!allRequiredSourcesMatch) {
        return ineligibleRepair('required_matching_observation_missing', conflictingObservations);
    }

    const precondition: ConsistencyRepairPrecondition = {
        version: DETERMINISTIC_CONSISTENCY_VERIFICATION_VERSION,
        target: copyTarget(target),
        expectationClaimId: expectation.claimId,
        expectationProofRef: expectation.proofRef,
        observationClaimId: observation.claimId,
        observationProofRef: observation.proofRef
    };
    const previousValue = copyFactValue(observation.value);
    const expectedValue = copyFactValue(expectation.value);
    return {
        status: 'eligible',
        mode: 'replace_claim_value',
        observationClaimId: observation.claimId,
        observationSourceKind: observation.sourceKind,
        repairTargetRef: observation.editability.repairTargetRef,
        previousValue,
        expectedValue,
        precondition,
        proofRef: buildProofRef('repair', {
            ruleId: rule.ruleId,
            target,
            expectationClaimId: expectation.claimId,
            expectationProofRef: expectation.proofRef,
            observationClaimId: observation.claimId,
            observationProofRef: observation.proofRef,
            repairTargetRef: observation.editability.repairTargetRef,
            previousValue,
            expectedValue
        })
    };
}

function evaluateRule(
    rule: DeterministicConsistencyRule,
    target: ConsistencyTargetRevision,
    claims: readonly ConsistencyClaim[]
): DeterministicConsistencyCheckResult {
    const relevantClaims = claims
        .filter((claim) => claim.propertyKey === rule.propertyKey)
        .sort((left, right) => left.claimId.localeCompare(right.claimId));
    const authoritativeExpectations = relevantClaims.filter(
        (claim): claim is ConsistencyExpectationClaim => (
            claim.role === 'expectation' && claim.authority === 'authoritative'
        )
    );
    const candidateExpectations = relevantClaims.filter(
        (claim): claim is ConsistencyExpectationClaim => (
            claim.role === 'expectation' && claim.authority === 'candidate'
        )
    );
    const policyBySource = new Map(
        rule.observationPolicies.map((policy) => [policy.sourceKind, policy] as const)
    );
    const observations = relevantClaims.filter(
        (claim): claim is ConsistencyObservationClaim => (
            claim.role === 'observation' && policyBySource.has(claim.sourceKind)
        )
    );

    const wrongTargetObservations = observations.filter(
        (claim) => claim.target.targetRef !== target.targetRef
    );
    const staleRevisionObservations = observations.filter((claim) => (
        claim.target.targetRef === target.targetRef && claim.target.revisionRef !== target.revisionRef
    ));
    const freshObservations = observations.filter((claim) => isSameConsistencyTargetRevision(claim.target, target));
    const unacceptedEvidenceObservations = freshObservations.filter((claim) => {
        const policy = policyBySource.get(claim.sourceKind);
        return Boolean(policy && !acceptedEvidenceStrengths(policy).includes(claim.evidenceStrength));
    });
    const acceptedObservations = freshObservations.filter((claim) => {
        const policy = policyBySource.get(claim.sourceKind);
        return Boolean(policy && acceptedEvidenceStrengths(policy).includes(claim.evidenceStrength));
    });
    const missingRequiredSources = rule.observationPolicies
        .filter((policy) => (
            policy.required
            && !acceptedObservations.some((claim) => claim.sourceKind === policy.sourceKind)
        ))
        .map((policy) => policy.sourceKind)
        .sort();

    const expectation = authoritativeExpectations.length === 1
        ? authoritativeExpectations[0]
        : undefined;
    const matchingObservations: ConsistencyObservationClaim[] = [];
    const conflictingObservations: ConsistencyObservationClaim[] = [];
    const warningObservations: ConsistencyObservationClaim[] = [];
    if (expectation) {
        acceptedObservations.forEach((observation) => {
            if (comparisonMatches(expectation.value, observation.value, rule.operator)) {
                matchingObservations.push(observation);
                return;
            }
            const policy = policyBySource.get(observation.sourceKind);
            if (policy?.mismatchDisposition === 'warning') {
                warningObservations.push(observation);
                return;
            }
            conflictingObservations.push(observation);
        });
    }

    let status: ConsistencyCheckStatus;
    if (authoritativeExpectations.length > 1) {
        status = 'expectation_conflict';
    } else if (authoritativeExpectations.length === 0) {
        status = 'needs_expectation';
    } else if (conflictingObservations.length > 0) {
        status = 'conflict';
    } else if (missingRequiredSources.length > 0) {
        status = 'needs_observation';
    } else if (warningObservations.length > 0) {
        status = 'warning';
    } else {
        status = 'consistent';
    }

    const repairEligibility = evaluateRepairEligibility(
        status,
        rule,
        target,
        expectation,
        matchingObservations,
        conflictingObservations,
        missingRequiredSources
    );
    const evidenceRefs = uniqueSorted(relevantClaims.map((claim) => claim.proofRef));
    const resultShape = {
        ruleId: rule.ruleId,
        propertyKey: rule.propertyKey,
        operator: rule.operator,
        status,
        target,
        authoritativeExpectationClaimIds: authoritativeExpectations.map((claim) => claim.claimId).sort(),
        candidateExpectationClaimIds: candidateExpectations.map((claim) => claim.claimId).sort(),
        matchingObservationClaimIds: matchingObservations.map((claim) => claim.claimId).sort(),
        conflictingObservationClaimIds: conflictingObservations.map((claim) => claim.claimId).sort(),
        warningObservationClaimIds: warningObservations.map((claim) => claim.claimId).sort(),
        missingRequiredObservationSourceKinds: missingRequiredSources,
        wrongTargetObservationClaimIds: wrongTargetObservations.map((claim) => claim.claimId).sort(),
        staleRevisionObservationClaimIds: staleRevisionObservations.map((claim) => claim.claimId).sort(),
        unacceptedEvidenceObservationClaimIds: unacceptedEvidenceObservations
            .map((claim) => claim.claimId)
            .sort(),
        evidenceRefs,
        repairEligibility
    };
    return {
        ...resultShape,
        proofRef: buildProofRef('check', resultShape)
    };
}

function aggregateStatus(
    checks: readonly DeterministicConsistencyCheckResult[]
): ConsistencyVerificationStatus {
    const priority: readonly ConsistencyCheckStatus[] = [
        'expectation_conflict',
        'conflict',
        'needs_expectation',
        'needs_observation',
        'warning',
        'consistent'
    ];
    return priority.find((status) => checks.some((check) => check.status === status)) ?? 'invalid_input';
}

/**
 * 对归一化 facts 做确定性一致性验证。输出顺序与输入顺序无关，便于缓存、审计与测试。
 * 非法输入会得到 invalid_input；本函数不会抛异常，也不会给出可修资格。
 */
export function verifyDeterministicConsistency(
    input: DeterministicConsistencyVerificationInput
): DeterministicConsistencyVerificationReport {
    const target = copyTarget(input.target);
    const inputIssues = validateDeterministicConsistencyVerificationInput(input);
    if (inputIssues.length > 0) {
        const proofRef = buildProofRef('invalid-report', {
            target,
            issues: inputIssues
        });
        return {
            version: DETERMINISTIC_CONSISTENCY_VERIFICATION_VERSION,
            target,
            status: 'invalid_input',
            checks: [],
            inputIssues,
            evidenceRefs: [],
            proofRef
        };
    }

    const checks = [...input.rules]
        .sort((left, right) => left.ruleId.localeCompare(right.ruleId))
        .map((rule) => evaluateRule(rule, target, input.claims));
    const status = aggregateStatus(checks);
    const evidenceRefs = uniqueSorted(checks.flatMap((check) => check.evidenceRefs));
    const proofRef = buildProofRef('report', {
        target,
        status,
        checks: checks.map((check) => ({
            ruleId: check.ruleId,
            status: check.status,
            proofRef: check.proofRef
        }))
    });
    return {
        version: DETERMINISTIC_CONSISTENCY_VERIFICATION_VERSION,
        target,
        status,
        checks,
        inputIssues: [],
        evidenceRefs,
        proofRef
    };
}

/** 报告只对完全相同的目标与修订版本有效；任何写入后都必须重新观察并重新验证。 */
export function isDeterministicConsistencyReportFresh(
    report: DeterministicConsistencyVerificationReport,
    currentTarget: ConsistencyTargetRevision
): boolean {
    return report.version === DETERMINISTIC_CONSISTENCY_VERIFICATION_VERSION
        && isSameConsistencyTargetRevision(report.target, currentTarget);
}

/** 修复资格同样绑定目标与修订；调用方不得在版本变化后复用旧资格。 */
export function isConsistencyRepairEligibilityFresh(
    eligibility: ConsistencyRepairEligibility,
    currentTarget: ConsistencyTargetRevision
): boolean {
    return eligibility.status === 'eligible'
        && eligibility.precondition.version === DETERMINISTIC_CONSISTENCY_VERIFICATION_VERSION
        && isSameConsistencyTargetRevision(eligibility.precondition.target, currentTarget);
}
