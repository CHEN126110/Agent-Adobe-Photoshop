import type {
    AgentTaskPublicPlanControlledRun,
    AgentTaskPublicPlanObservationDiff
} from './agent-task-public-plan-controlled-runner';

export type AgentReActActionKind =
    | 'atomic_tool'
    | 'skill'
    | 'public_plan'
    | 'sub_agent'
    | 'design_team'
    | 'direct_answer';

export type AgentReActObservationStatus =
    | 'completed'
    | 'needs_decision'
    | 'needs_repair'
    | 'blocked'
    | 'failed';

export type AgentReActNextAction =
    | 'decide_next'
    | 'repair'
    | 'ask_user'
    | 'finish'
    | 'stop';

/**
 * Workflow 把控制权交还主 Agent 时，可以声明后续恢复动作的最小能力边界。
 *
 * Harness 会让该边界持续到 Workflow 完成或有效 Stage/Plan 替换它；该字段只缩小
 * 已经可见的工具集合，不授予新工具、权限或完成状态。
 */
export interface AgentReActRecoveryDirective {
    mode: 'allowlist';
    purpose: 'observe' | 'collect_input' | 'replan' | 'execute' | 'repair' | 'deliver';
    allowedToolNames: string[];
    reason: string;
    /** deliver 必须由 Harness 的真实视觉复核通过后才可兑现。 */
    requiresVisualPass?: boolean;
    /** 未请求保存/导出时，真实视觉通过即可完成当前工作流。 */
    completeOnVisualPass?: boolean;
    /** 视觉复核未通过时，只能恢复 Skill 显式声明的最小原子修复工具。 */
    repairAllowedToolNames?: string[];
    /** 原子修复完成后，仅用这些只读工具生成新的版本绑定视觉候选。 */
    reviewAllowedToolNames?: string[];
    /**
     * 某些恢复工具虽然需要可见，但只允许它的一个窄动作形状。
     * 该约束会在 Harness 执行前逐 Tool 校验；它只缩权，不扩展 allowedToolNames。
     */
    toolArgumentConstraints?: Record<string, {
        argumentEquals?: Record<string, string | number | boolean>;
        requiredArgumentKeys?: string[];
    }>;
    /** 单一 owner 重入场景的兼容字段；与 toolArgumentConstraints 使用同一校验语义。 */
    requiredToolName?: string;
    requiredArguments?: Record<string, string | number | boolean>;
}

export interface AgentReActObservation {
    version: 'agent-react-observation/v0';
    actionId: string;
    kind: AgentReActActionKind;
    label: string;
    status: AgentReActObservationStatus;
    summary: string;
    details: string[];
    blockers: string[];
    warnings: string[];
    nextAction: AgentReActNextAction;
    recovery?: AgentReActRecoveryDirective;
    observationDiff?: AgentTaskPublicPlanObservationDiff;
    sourceStatus?: string;
}

export interface AgentReActSkillResultLike {
    success?: boolean;
    message?: string;
    error?: string;
    cancelled?: boolean;
    nonFatal?: boolean;
    skillOutcome?: SkillExecutionOutcome;
    executionSummary?: unknown;
    data?: unknown;
}

export type SkillExecutionOutcomeStatus =
    | 'completed'
    | 'executed'
    | 'partial'
    | 'needs_review'
    | 'awaiting_confirmation'
    | 'blocked'
    | 'failed'
    | 'cancelled';

/**
 * Skill 的执行结果真相源。
 *
 * `success` 只兼容表达“执行器没有抛出致命错误”，不能证明用户任务完成；只有
 * Skill 明确返回 `skillOutcome.status = completed`，或统一 Agent Runtime 已给出无 blocker 的
 * `executionSummary.status = completed`，上层才可以声明完成。
 */
export interface SkillExecutionOutcome {
    version: 'skill-execution-outcome/v0';
    status: SkillExecutionOutcomeStatus;
    summary: string;
    outputs: string[];
    blockers: string[];
    warnings: string[];
    sourceStatus?: string;
}

export interface AgentReActSkillContinuation {
    status: Exclude<AgentReActObservationStatus, 'completed' | 'failed'>;
    summary?: string;
    details?: string[];
    blockers?: string[];
    warnings?: string[];
    nextAction?: Exclude<AgentReActNextAction, 'finish' | 'stop'>;
    recovery?: AgentReActRecoveryDirective;
    sourceStatus?: string;
}

function normalizeText(value: unknown, maxLength = 220): string {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function uniqueTextList(values: unknown[], maxItems = 8, maxLength = 180): string[] {
    const output: string[] = [];
    for (const value of values) {
        const text = normalizeText(value, maxLength);
        if (!text || output.includes(text)) continue;
        output.push(text);
        if (output.length >= maxItems) break;
    }
    return output;
}

function hasCompletedPublicPlanStatus(status: string): boolean {
    return status === 'completed_live_adapter_verified'
        || status === 'completed_fake_adapter_verified'
        || status === 'completed_dry_run';
}

function normalizeSkillContinuationStatus(value: unknown): AgentReActSkillContinuation['status'] | undefined {
    if (value === 'needs_decision' || value === 'needs_repair' || value === 'blocked') return value;
    return undefined;
}

function normalizeSkillContinuationNextAction(value: unknown): AgentReActSkillContinuation['nextAction'] | undefined {
    if (value === 'decide_next' || value === 'repair' || value === 'ask_user') return value;
    return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    return value as Record<string, unknown>;
}

function normalizeOutcomeStatus(value: unknown): SkillExecutionOutcomeStatus | undefined {
    switch (value) {
        case 'completed':
        case 'executed':
        case 'partial':
        case 'needs_review':
        case 'awaiting_confirmation':
        case 'blocked':
        case 'failed':
        case 'cancelled':
            return value;
        default:
            return undefined;
    }
}

function normalizeSourceStatus(value: unknown): string {
    return normalizeText(value, 80)
        .toLowerCase()
        .replace(/[\s-]+/g, '_');
}

function collectStringArray(value: unknown): string[] {
    return Array.isArray(value) ? uniqueTextList(value) : [];
}

/**
 * 结构化 Tool allowlist 不是用户可见摘要，不能套用 uniqueTextList 的 8 项截断。
 * 名称保持原样、去重并设置独立的防滥用总上限；Capability Session 和执行 preflight
 * 仍会再与真实注册表、Manifest ceiling 和权限相交。
 */
function normalizeToolNameList(value: unknown, maxItems = 64): string[] {
    if (!Array.isArray(value)) return [];
    const names: string[] = [];
    for (const item of value) {
        const name = String(item || '').trim();
        if (!name || name.length > 80 || names.includes(name)) continue;
        names.push(name);
        if (names.length >= maxItems) break;
    }
    return names;
}

function normalizePrimitiveArgumentMap(
    value: unknown
): Record<string, string | number | boolean> | undefined {
    const record = asRecord(value);
    if (!record) return undefined;
    const entries = Object.entries(record)
        .filter(([key, item]) => (
            Boolean(String(key || '').trim())
            && (
                typeof item === 'string'
                || typeof item === 'number'
                || typeof item === 'boolean'
            )
        ))
        .slice(0, 12);
    return entries.length > 0
        ? Object.fromEntries(entries) as Record<string, string | number | boolean>
        : undefined;
}

function normalizeToolArgumentConstraints(
    value: unknown,
    allowedToolNames: readonly string[]
): AgentReActRecoveryDirective['toolArgumentConstraints'] | undefined {
    const record = asRecord(value);
    if (!record) return undefined;
    const allowed = new Set(allowedToolNames);
    const constraints: NonNullable<AgentReActRecoveryDirective['toolArgumentConstraints']> = {};
    for (const [rawToolName, rawConstraint] of Object.entries(record).slice(0, 16)) {
        const toolName = String(rawToolName || '').trim();
        const constraint = asRecord(rawConstraint);
        if (!toolName || !allowed.has(toolName) || !constraint) continue;
        const argumentEquals = normalizePrimitiveArgumentMap(constraint.argumentEquals);
        const requiredArgumentKeys = normalizeToolNameList(
            constraint.requiredArgumentKeys,
            12
        );
        if (!argumentEquals && requiredArgumentKeys.length === 0) continue;
        constraints[toolName] = {
            ...(argumentEquals ? { argumentEquals } : {}),
            ...(requiredArgumentKeys.length > 0 ? { requiredArgumentKeys } : {})
        };
    }
    return Object.keys(constraints).length > 0 ? constraints : undefined;
}

function normalizeAgentReActRecoveryDirective(value: unknown): AgentReActRecoveryDirective | undefined {
    const directive = asRecord(value);
    if (directive?.mode !== 'allowlist') return undefined;
    const purpose = directive.purpose === 'observe'
        || directive.purpose === 'collect_input'
        || directive.purpose === 'replan'
        || directive.purpose === 'execute'
        || directive.purpose === 'repair'
        || directive.purpose === 'deliver'
        ? directive.purpose
        : undefined;
    if (!purpose) return undefined;
    const allowedToolNames = normalizeToolNameList(directive.allowedToolNames);
    const completeOnVisualPass = purpose === 'deliver'
        && directive.requiresVisualPass === true
        && directive.completeOnVisualPass === true;
    if (allowedToolNames.length === 0 && !completeOnVisualPass) return undefined;
    const repairAllowedToolNames = normalizeToolNameList(directive.repairAllowedToolNames);
    const reviewAllowedToolNames = normalizeToolNameList(directive.reviewAllowedToolNames);
    const toolArgumentConstraints = normalizeToolArgumentConstraints(
        directive.toolArgumentConstraints,
        allowedToolNames
    );
    const requiredToolName = String(directive.requiredToolName || '').trim();
    const requiredArguments = normalizePrimitiveArgumentMap(directive.requiredArguments);
    return {
        mode: 'allowlist',
        purpose,
        allowedToolNames,
        reason: normalizeText(directive.reason, 220)
            || 'Workflow 已声明继续处理所需的最小能力范围。',
        ...(toolArgumentConstraints ? { toolArgumentConstraints } : {}),
        ...(requiredToolName && allowedToolNames.includes(requiredToolName) && requiredArguments
            ? { requiredToolName, requiredArguments }
            : {}),
        ...(purpose === 'deliver'
            ? {
                requiresVisualPass: directive.requiresVisualPass === true,
                completeOnVisualPass,
                ...(repairAllowedToolNames.length > 0
                    ? { repairAllowedToolNames }
                    : {}),
                ...(reviewAllowedToolNames.length > 0
                    ? { reviewAllowedToolNames }
                    : {})
            }
            : {})
    };
}

/**
 * 只从 Skill runner 已投影的结构化观察中读取续跑工具。
 *
 * 原始 executor JSON 不是 Harness 的能力真相源；调用方必须消费
 * `agent-react-observation/v0` 的规范化 recovery，避免原始 continuation、
 * 展示文案或测试手工数组绕过同一套去重与数量上限。
 */
export function readAgentReActRecoveryToolNames(result: unknown): string[] {
    const record = asRecord(result);
    const data = asRecord(record?.data);
    const observation = asRecord(data?.agentReActObservation);
    if (observation?.version !== 'agent-react-observation/v0'
        || observation.kind !== 'skill') {
        return [];
    }
    const recovery = normalizeAgentReActRecoveryDirective(observation.recovery);
    return recovery ? [...recovery.allowedToolNames] : [];
}

/**
 * 只把 Harness 自己签发的 Photoshop 原生弹窗事实转换成“下一轮可见工具”。
 * 这不会执行截图，也不要求 Agent 必须调用；它仅避免 Capability 裁剪让恢复出口不可达。
 */
export function readAgentEnvironmentRecoveryToolNames(result: unknown): string[] {
    const record = asRecord(result);
    const data = asRecord(record?.data);
    const candidates = [record, data].filter((value): value is Record<string, unknown> => Boolean(value));
    const modalObservation = candidates.some((candidate) => {
        const observation = asRecord(candidate.environmentObservation);
        return candidate.environmentState === 'photoshop_native_modal_suspected'
            && observation?.capability === 'capturePhotoshopWindow'
            && observation.scope === 'adobe_photoshop_application_window';
    });
    return modalObservation ? ['capturePhotoshopWindow'] : [];
}

function hasPendingInteractiveConfirmation(data?: Record<string, unknown>): boolean {
    if (!data) return false;
    const cards = Array.isArray(data.interactiveCards) ? data.interactiveCards : [];
    const hasActionableCard = cards.some((value) => {
        const card = asRecord(value);
        return card?.version === 'interactive-card/v0'
            && card.status !== 'submitted'
            && card.status !== 'cancelled';
    });
    if (!hasActionableCard) return false;
    return data.requiresUserAction === true || data.awaitingUserConfirmation === true;
}

function isConfirmationSourceStatus(sourceStatus: string): boolean {
    if (!sourceStatus) return false;
    const tokens = new Set(sourceStatus.split('_').filter(Boolean));
    const hasWaitToken = tokens.has('pending')
        || tokens.has('awaiting')
        || tokens.has('needs')
        || tokens.has('required');
    const hasDecisionToken = tokens.has('confirmation') || tokens.has('approval');
    return hasWaitToken && hasDecisionToken;
}

function inferLegacySkillOutcomeStatus(input: {
    result: AgentReActSkillResultLike;
    sourceStatus: string;
    continuationStatus?: AgentReActSkillContinuation['status'];
    verifiedRuntimeCompletion?: boolean;
    pendingInteractiveConfirmation?: boolean;
}): SkillExecutionOutcomeStatus {
    if (input.verifiedRuntimeCompletion) return 'completed';
    if (input.result.cancelled || input.sourceStatus === 'cancelled') return 'cancelled';
    if (input.pendingInteractiveConfirmation
        || isConfirmationSourceStatus(input.sourceStatus)
        || input.sourceStatus === 'awaiting_confirmation'
        || input.sourceStatus === 'awaiting_user_confirmation'
        || input.sourceStatus === 'pending_confirmation'
        || input.sourceStatus === 'pending_user_confirmation'
        || input.sourceStatus === 'needs_confirmation'
        || input.sourceStatus === 'pending_approval'
        || input.sourceStatus === 'blocked_pending_user_confirmation') {
        return 'awaiting_confirmation';
    }
    if (input.sourceStatus === 'needs_review'
        || input.sourceStatus === 'needs_visual_review'
        || input.sourceStatus === 'review_required'
        || input.sourceStatus === 'awaiting_review'
        || input.sourceStatus === 'pending_review'
        || input.continuationStatus === 'needs_decision') {
        return 'needs_review';
    }
    if (input.sourceStatus === 'partial'
        || input.sourceStatus === 'partially_completed'
        || input.sourceStatus === 'needs_repair'
        || input.sourceStatus === 'structure_ready'
        || input.sourceStatus === 'draft_ready'
        || input.continuationStatus === 'needs_repair'
        || input.result.nonFatal === true) {
        return 'partial';
    }
    if (input.sourceStatus === 'blocked'
        || input.sourceStatus.startsWith('blocked_')
        || input.continuationStatus === 'blocked') {
        return 'blocked';
    }
    if (input.result.success === false || Boolean(normalizeText(input.result.error, 160))) return 'failed';
    return 'executed';
}

function defaultSkillOutcomeSummary(status: SkillExecutionOutcomeStatus): string {
    switch (status) {
        case 'completed':
            return 'Skill 已明确确认本次任务完成。';
        case 'executed':
            return 'Skill 已执行，但尚未完成任务结果确认。';
        case 'partial':
            return 'Skill 已完成部分处理，仍需继续执行或修复。';
        case 'needs_review':
            return 'Skill 已返回结果，仍需复核后才能判断任务是否完成。';
        case 'awaiting_confirmation':
            return 'Skill 正在等待用户确认，任务尚未完成。';
        case 'blocked':
            return 'Skill 当前受阻，任务尚未完成。';
        case 'cancelled':
            return 'Skill 已取消，任务未完成。';
        default:
            return 'Skill 执行失败，任务未完成。';
    }
}

/**
 * 将新旧 Skill 返回值收敛成同一真相口径。裸 `success: true` 最多只能得到
 * `executed`；只有显式 outcome 或统一 Runtime 的已验收完成摘要才能升级为 `completed`。
 */
export function resolveSkillExecutionOutcome(result: AgentReActSkillResultLike): SkillExecutionOutcome {
    const explicitOutcome = asRecord(result.skillOutcome);
    const declaredExplicitStatus = normalizeOutcomeStatus(explicitOutcome?.status);
    const hasFatalResult = result.cancelled === true
        || result.success === false
        || Boolean(normalizeText(result.error, 160));
    const explicitStatus = declaredExplicitStatus === 'completed' && hasFatalResult
        ? undefined
        : declaredExplicitStatus;
    const acceptedExplicitOutcome = explicitStatus ? explicitOutcome : undefined;
    const data = asRecord(result.data);
    const executionSummary = asRecord(result.executionSummary) || asRecord(data?.executionSummary);
    const executionSummaryStatus = normalizeSourceStatus(executionSummary?.status);
    const verifiedRuntimeCompletion = result.success !== false
        && !normalizeText(result.error, 160)
        && executionSummaryStatus === 'completed'
        && collectStringArray(executionSummary?.blockers).length === 0;
    const continuation = asRecord(data?.agentReActContinuation);
    const continuationStatus = normalizeSkillContinuationStatus(continuation?.status);
    const pendingInteractiveConfirmation = hasPendingInteractiveConfirmation(data);
    const sourceStatus = normalizeSourceStatus(
        acceptedExplicitOutcome?.sourceStatus
        || explicitStatus
        || executionSummary?.status
        || data?.status
        || continuation?.sourceStatus
        || continuation?.status
        || (result.success === false ? 'failed' : 'success')
    );
    const status = pendingInteractiveConfirmation
        ? 'awaiting_confirmation'
        : explicitStatus || inferLegacySkillOutcomeStatus({
        result,
        sourceStatus,
        continuationStatus,
        verifiedRuntimeCompletion,
        pendingInteractiveConfirmation
    });
    const message = normalizeText(result.message, 220);
    const error = normalizeText(result.error, 160);
    const explicitOutputs = collectStringArray(acceptedExplicitOutcome?.outputs);
    const explicitBlockers = collectStringArray(acceptedExplicitOutcome?.blockers);
    const explicitWarnings = collectStringArray(acceptedExplicitOutcome?.warnings);
    const continuationDetails = collectStringArray(continuation?.details);
    const continuationBlockers = collectStringArray(continuation?.blockers);
    const continuationWarnings = collectStringArray(continuation?.warnings);

    return {
        version: 'skill-execution-outcome/v0',
        status,
        summary: normalizeText(acceptedExplicitOutcome?.summary, 220)
            || normalizeText(continuation?.summary, 220)
            || message
            || defaultSkillOutcomeSummary(status),
        outputs: uniqueTextList([
            ...explicitOutputs,
            ...continuationDetails,
            status === 'completed' || status === 'executed' || status === 'partial' || status === 'needs_review'
                ? message
                : ''
        ]),
        blockers: uniqueTextList([
            ...explicitBlockers,
            ...continuationBlockers,
            ...collectStringArray(executionSummary?.blockers),
            error,
            status === 'failed' || status === 'blocked' || status === 'cancelled' ? message : ''
        ]),
        warnings: uniqueTextList([
            ...explicitWarnings,
            ...continuationWarnings,
            ...collectStringArray(executionSummary?.warnings)
        ]),
        sourceStatus: sourceStatus || undefined
    };
}

function mapPublicPlanObservationStatus(
    run: Pick<AgentTaskPublicPlanControlledRun, 'status' | 'observationDiff'>
): AgentReActObservationStatus {
    if (run.observationDiff?.status === 'mismatch') {
        return run.observationDiff.nextAction === 'repair_missing_visible_copy'
            ? 'needs_repair'
            : 'needs_decision';
    }
    if (hasCompletedPublicPlanStatus(String(run.status))) return 'completed';
    if (String(run.status).startsWith('blocked_')) return 'blocked';
    if (String(run.status).startsWith('failed_')) return 'needs_decision';
    return 'needs_decision';
}

function mapPublicPlanNextAction(
    run: Pick<AgentTaskPublicPlanControlledRun, 'status' | 'observationDiff'>
): AgentReActNextAction {
    if (run.observationDiff?.status === 'mismatch') {
        return run.observationDiff.nextAction === 'repair_missing_visible_copy'
            ? 'repair'
            : 'decide_next';
    }
    if (hasCompletedPublicPlanStatus(String(run.status))) return 'decide_next';
    if (String(run.status).startsWith('blocked_')) return 'ask_user';
    if (String(run.status).startsWith('failed_')) return 'decide_next';
    return 'decide_next';
}

function summarizePublicPlanObservation(run: Pick<AgentTaskPublicPlanControlledRun, 'status' | 'observationDiff'>): string {
    const diffSummary = normalizeText(run.observationDiff?.userVisibleSummary, 180);
    if (run.observationDiff?.status === 'mismatch') {
        return diffSummary || '真实画面和计划结果不一致，需要回到上一级继续判断。';
    }
    if (hasCompletedPublicPlanStatus(String(run.status))) {
        return '行动已经执行并读回，结果应交还主 Agent 继续判断是否进入下一步。';
    }
    if (String(run.status).startsWith('blocked_')) {
        return '行动还没有满足执行条件，需要主 Agent 决定补充信息或询问用户。';
    }
    return '行动结果没有形成稳定完成态，需要主 Agent 继续判断。';
}

export function buildAgentReActObservationFromPublicPlanRun(
    run: Pick<
        AgentTaskPublicPlanControlledRun,
        | 'status'
        | 'observationDiff'
        | 'blockers'
        | 'warnings'
        | 'operationResults'
        | 'readbackResults'
        | 'executionTarget'
        | 'requestId'
    >
): AgentReActObservation {
    const diff = run.observationDiff;
    const successfulOperations = (run.operationResults || [])
        .filter((result) => result?.success)
        .map((result) => `已执行 ${normalizeText(result.toolName, 60)}`);
    const successfulReadbacks = (run.readbackResults || [])
        .filter((result) => result?.success)
        .map((result) => `已读回 ${normalizeText(result.target || result.toolName, 60)}`);
    const diffDetails = diff?.status === 'mismatch'
        ? [
            diff.userVisibleSummary,
            ...(diff.missingVisibleCopy || []).map((item) => `缺少可见内容：${item}`)
        ]
        : [];

    return {
        version: 'agent-react-observation/v0',
        actionId: normalizeText(run.requestId, 80) || `public-plan:${normalizeText(run.status, 80)}`,
        kind: 'public_plan',
        label: '公开方案执行观察',
        status: mapPublicPlanObservationStatus(run),
        summary: summarizePublicPlanObservation(run),
        details: uniqueTextList([
            ...diffDetails,
            ...successfulOperations,
            ...successfulReadbacks,
            run.executionTarget ? `执行目标：${run.executionTarget}` : ''
        ]),
        blockers: uniqueTextList(run.blockers || []),
        warnings: uniqueTextList(run.warnings || []),
        nextAction: mapPublicPlanNextAction(run),
        observationDiff: diff,
        sourceStatus: normalizeText(run.status, 80)
    };
}

export function buildAgentReActObservationFromSkillResult(input: {
    skillId: string;
    result: AgentReActSkillResultLike;
}): AgentReActObservation {
    const skillId = normalizeText(input.skillId, 80) || 'unknown-skill';
    const outcome = resolveSkillExecutionOutcome(input.result);
    const data = asRecord(input.result.data);
    const continuation = data?.agentReActContinuation
        && typeof data.agentReActContinuation === 'object'
        ? data.agentReActContinuation as AgentReActSkillContinuation
        : undefined;
    const continuationNextAction = normalizeSkillContinuationNextAction(continuation?.nextAction);
    const recovery = normalizeAgentReActRecoveryDirective(continuation?.recovery);
    let status: AgentReActObservationStatus = 'needs_decision';
    let nextAction: AgentReActNextAction = continuationNextAction || 'decide_next';
    switch (outcome.status) {
        case 'completed':
            status = 'completed';
            break;
        case 'partial':
            status = 'needs_repair';
            nextAction = continuationNextAction || 'repair';
            break;
        case 'awaiting_confirmation':
        case 'blocked':
            status = 'blocked';
            nextAction = 'ask_user';
            break;
        case 'failed':
            status = 'failed';
            break;
        case 'cancelled':
            status = 'failed';
            nextAction = 'stop';
            break;
        case 'executed':
        case 'needs_review':
            break;
    }

    return {
        version: 'agent-react-observation/v0',
        actionId: `skill:${skillId}`,
        kind: 'skill',
        label: `Skill 行动观察：${skillId}`,
        status,
        summary: outcome.summary,
        details: uniqueTextList([
            ...outcome.outputs,
            outcome.status === 'completed' || outcome.status === 'executed'
                ? `已执行 skill：${skillId}`
                : ''
        ]),
        blockers: outcome.blockers,
        warnings: outcome.warnings,
        nextAction,
        ...(status !== 'completed' && status !== 'failed' && nextAction !== 'stop' && recovery
            ? { recovery }
            : {}),
        sourceStatus: outcome.sourceStatus || outcome.status
    };
}
