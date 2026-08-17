import {
    classifyAgentToolExecution,
    isAgentDocumentContextBarrier,
    isAgentHarnessControlTool,
    isAgentInputCollectionTool
} from './agent-tool-execution-preflight';
import { resolveSkillExecutionOutcome } from './agent-react-observation-contract';
import { stableStringifyForReadCache } from './agent-read-result-cache';
import { evaluateCompletionObservationGate } from './completion-observation-gate';

export interface AgentWorkflowContinuationToolCall {
    id: string;
    name: string;
    arguments?: unknown;
}

export interface AgentWorkflowContinuationToolResult {
    callId: string;
    success?: boolean;
    output?: unknown;
}

export interface AgentWorkflowContinuationBinding {
    sessionId?: string;
    runId?: string;
    generation?: number;
    stage?: string;
}

export interface AgentWorkflowVisualObservationIdentity {
    documentId: string;
    historyStateId: string;
}

export interface AgentWorkflowContinuationScope {
    version: 'agent-workflow-continuation-scope/v0';
    workflowToolName: string;
    workflowCallId: string;
    purpose: 'observe' | 'collect_input' | 'replan' | 'execute' | 'repair' | 'deliver';
    allowedToolNames: string[];
    reason: string;
    source: 'declared' | 'fail_closed';
    binding: AgentWorkflowContinuationBinding;
    requiredToolCall?: {
        toolName: string;
        argumentEquals: Record<string, string | number | boolean>;
    };
    toolArgumentConstraints?: Record<string, {
        argumentEquals?: Record<string, string | number | boolean>;
        requiredArgumentKeys?: string[];
    }>;
    repairTarget?: {
        allowedLayerIds: number[];
        requireExplicitLayerTarget: true;
    };
    visualDelivery?: {
        requiresVisualPass: true;
        completeOnVisualPass: boolean;
        allowedToolNames: string[];
        repairAllowedToolNames: string[];
        reviewAllowedToolNames: string[];
        targetObservationIds: string[];
        reviewRequest: {
            toolName: string;
            argumentsSignature: string;
        };
        candidateDocumentId: string;
        candidateHistoryStateId: string;
        awaitingRepairObservation?: boolean;
        expectedReviewDocumentId?: string;
        expectedReviewHistoryStateId?: string;
        reviewResultToolName?: string;
        reviewResultCallId?: string;
        repairTarget?: {
            allowedLayerIds: number[];
            requireExplicitLayerTarget: true;
        };
    };
}

export type AgentWorkflowVisualDeliveryStatus =
    | 'pending'
    | 'passed'
    | 'needs_fix'
    | 'unreadable';

export type AgentWorkflowContinuationScopeUpdate =
    | {
        kind: 'activate';
        scope: AgentWorkflowContinuationScope;
    }
    | {
        kind: 'clear';
        workflowToolName: string;
        reason: string;
    }
    | {
        kind: 'none';
    };

export interface AgentWorkflowContinuationToolAccess {
    allowed: boolean;
    code?: 'workflow_continuation_scope_blocked';
    reason?: string;
}

export interface AgentWorkflowExecuteHandoffLogEntry {
    callId?: string;
    name: string;
    arguments?: unknown;
    result?: any;
}

export interface AgentWorkflowExecuteHandoffFulfillment {
    status: 'none' | 'pending' | 'fulfilled';
    workflowCallId?: string;
    successfulAtomicWrite: boolean;
    verifiedPostWriteReadback: boolean;
    taskCompletionPassed: boolean;
    freshVisualPass: boolean;
    runtimeQualityVerdictPassed: boolean;
}

function asRecord(value: unknown): Record<string, any> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    return value as Record<string, any>;
}

function normalizeToolNames(values: unknown): string[] {
    if (!Array.isArray(values)) return [];
    return Array.from(new Set(
        values
            .map((value) => String(value || '').trim())
            .filter(Boolean)
    ));
}

function isStructuredSkillWorkflowResult(
    output: Record<string, any>,
    toolName: string
): boolean {
    const data = asRecord(output.data);
    const observation = asRecord(data?.agentReActObservation);
    return observation?.version === 'agent-react-observation/v0'
        && observation.kind === 'skill'
        && observation.actionId === `skill:${toolName}`;
}

function normalizeLayerIds(values: unknown): number[] {
    if (!Array.isArray(values)) return [];
    return Array.from(new Set(
        values
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value > 0)
    ));
}

function normalizeRequiredArgumentEquals(
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
    if (entries.length === 0) return undefined;
    return Object.fromEntries(entries);
}

function normalizeToolArgumentConstraints(
    value: unknown,
    allowedToolNames: readonly string[]
): AgentWorkflowContinuationScope['toolArgumentConstraints'] | undefined {
    const record = asRecord(value);
    if (!record) return undefined;
    const allowed = new Set(allowedToolNames);
    const constraints: NonNullable<AgentWorkflowContinuationScope['toolArgumentConstraints']> = {};
    for (const [rawToolName, rawConstraint] of Object.entries(record).slice(0, 16)) {
        const toolName = String(rawToolName || '').trim();
        const constraint = asRecord(rawConstraint);
        if (!toolName || !allowed.has(toolName) || !constraint) continue;
        const argumentEquals = normalizeRequiredArgumentEquals(constraint.argumentEquals);
        const requiredArgumentKeys = normalizeToolNames(constraint.requiredArgumentKeys)
            .filter((key) => key.length <= 80)
            .slice(0, 12);
        if (!argumentEquals && requiredArgumentKeys.length === 0) continue;
        constraints[toolName] = {
            ...(argumentEquals ? { argumentEquals } : {}),
            ...(requiredArgumentKeys.length > 0 ? { requiredArgumentKeys } : {})
        };
    }
    return Object.keys(constraints).length > 0 ? constraints : undefined;
}

function normalizeTargetObservationIds(candidate: Record<string, any> | undefined): string[] {
    if (Array.isArray(candidate?.targetObservationIds)) {
        return Array.from(new Set(candidate.targetObservationIds
            .map((value: unknown) => String(value || '').trim())
            .filter(Boolean)));
    }
    if (!Array.isArray(candidate?.targetScreenIds)) return [];
    return Array.from(new Set(candidate.targetScreenIds
        .map((screenId: unknown) => Number(screenId))
        .filter((screenId: number) => Number.isInteger(screenId) && screenId > 0)
        .map((screenId: number) => `screen:${screenId}`)));
}

function buildArgumentsSignature(value: unknown): string {
    return stableStringifyForReadCache(value ?? {});
}

function normalizeVisualObservationIdentity(
    value: unknown
): AgentWorkflowVisualObservationIdentity | undefined {
    const record = asRecord(value);
    const documentId = String(record?.documentId || '').trim();
    const historyStateId = String(record?.historyStateId || '').trim();
    if (!documentId || !historyStateId) return undefined;
    return { documentId, historyStateId };
}

function matchesVisualReviewRequest(
    request: NonNullable<AgentWorkflowContinuationScope['visualDelivery']>['reviewRequest'],
    call: AgentWorkflowContinuationToolCall
): boolean {
    return call.name === request.toolName
        && buildArgumentsSignature(call.arguments) === request.argumentsSignature;
}

function isToolAllowedForContinuationPurpose(
    toolName: string,
    purpose: AgentWorkflowContinuationScope['purpose']
): boolean {
    const kind = classifyAgentToolExecution(toolName);
    if (purpose === 'observe') {
        return kind === 'read_only_observation' || kind === 'knowledge_search';
    }
    if (purpose === 'collect_input') {
        return isAgentInputCollectionTool(toolName);
    }
    if (purpose === 'repair') {
        return isAgentHarnessControlTool(toolName)
            || isAgentDocumentContextBarrier(toolName)
            || kind === 'read_only_observation'
            || kind === 'knowledge_search'
            || kind === 'photoshop_write'
            || kind === 'save_export';
    }
    if (purpose === 'execute') {
        return isAgentHarnessControlTool(toolName)
            || kind === 'read_only_observation'
            || kind === 'knowledge_search'
            || kind === 'photoshop_write'
            || kind === 'external_generation'
            || kind === 'stateful_context';
    }
    if (purpose === 'deliver') {
        return kind === 'save_export';
    }
    return isAgentHarnessControlTool(toolName)
        || kind === 'read_only_observation'
        || kind === 'knowledge_search';
}

function normalizePurpose(value: unknown): AgentWorkflowContinuationScope['purpose'] | undefined {
    if (value === 'observe'
        || value === 'collect_input'
        || value === 'replan'
        || value === 'execute'
        || value === 'repair'
        || value === 'deliver') return value;
    return undefined;
}

function labelContinuationPurpose(
    purpose: AgentWorkflowContinuationScope['purpose']
): string {
    if (purpose === 'observe') return '观察';
    if (purpose === 'collect_input') return '输入收集';
    if (purpose === 'repair') return '定向修复';
    if (purpose === 'execute') return '自主执行';
    if (purpose === 'deliver') return '交付';
    return '重规划';
}

function resolveFallbackPurpose(output: Record<string, any>): AgentWorkflowContinuationScope['purpose'] {
    const data = asRecord(output.data);
    const observation = asRecord(data?.agentReActObservation);
    const continuation = asRecord(data?.agentReActContinuation);
    const nextAction = observation?.nextAction || continuation?.nextAction;
    return nextAction === 'ask_user' ? 'collect_input' : 'replan';
}

function selectPurposeCompatibleTools(input: {
    toolNames: Iterable<string>;
    availableToolNames: Set<string>;
    purpose: AgentWorkflowContinuationScope['purpose'];
}): string[] {
    return normalizeToolNames(Array.from(input.toolNames)).filter((toolName) => (
        input.availableToolNames.has(toolName)
        && isToolAllowedForContinuationPurpose(toolName, input.purpose)
    ));
}

function readContinuationRecovery(output: Record<string, any>): Record<string, any> | undefined {
    const data = asRecord(output.data);
    const observation = asRecord(data?.agentReActObservation);
    const continuation = asRecord(data?.agentReActContinuation);
    return asRecord(observation?.recovery) || asRecord(continuation?.recovery);
}

/**
 * 判断一次失败形状的 Skill 结果是否其实是可信、可执行的控制权移交。
 *
 * 只有 Skill runner 写入的 versioned observation、明确的 nonFatal 标记、
 * 非终态观察和非空 allowlist 同时成立才返回 true。普通失败、裸 nonFatal、
 * 原始 executor continuation、等待用户确认和伪造的普通 Tool JSON 都不能借此
 * 绕过连续失败熔断。
 */
export function isDeclaredNonFatalAgentWorkflowHandoff(input: {
    workflowToolName: string;
    output: unknown;
}): boolean {
    const output = asRecord(input.output);
    if (!output
        || output.success !== false
        || output.nonFatal !== true
        || output.cancelled === true
        || !isStructuredSkillWorkflowResult(output, input.workflowToolName)) {
        return false;
    }
    const observation = asRecord(asRecord(output.data)?.agentReActObservation);
    if ((observation?.status !== 'needs_repair'
            && observation?.status !== 'needs_decision')
        || (observation?.nextAction !== 'repair'
            && observation?.nextAction !== 'decide_next')) {
        return false;
    }
    const recovery = asRecord(observation.recovery);
    const purpose = recovery?.mode === 'allowlist'
        ? normalizePurpose(recovery.purpose)
        : undefined;
    return Boolean(
        purpose
        && purpose !== 'collect_input'
        && normalizeToolNames(recovery?.allowedToolNames).length > 0
    );
}

/**
 * 判断一次声明式 `purpose=execute` handoff 是否已被同一运行内的真实原子闭环履行。
 *
 * Skill 返回 `executed` 只表示它完成了能力交接，不能单独把用户任务升级为完成；
 * 后续任意一次读取或写入也不能把这个未验证状态冲掉。只有 handoff 之后同时存在：
 * 成功 Photoshop 原子写入、同文档最终写入后的可信读回、TaskCompletion 通过、
 * 当前版本视觉通过，以及 Manifest 要求 R5 时唯一 DesignVerdict 通过，才算履行。
 */
export function evaluateAgentWorkflowExecuteHandoffFulfillment(input: {
    toolCallLog: readonly AgentWorkflowExecuteHandoffLogEntry[];
    workflowEntryTools: Iterable<string>;
    taskCompletionStatus?: string;
    hasFreshVisualPass: boolean;
    runtimeRequiresQualityVerdict: boolean;
    designVerdictStatus?: string;
}): AgentWorkflowExecuteHandoffFulfillment {
    function buildEmptyResult(): AgentWorkflowExecuteHandoffFulfillment {
        return {
            status: 'none',
            successfulAtomicWrite: false,
            verifiedPostWriteReadback: false,
            taskCompletionPassed: false,
            freshVisualPass: false,
            runtimeQualityVerdictPassed: false
        };
    }
    const toolCallLog = Array.isArray(input.toolCallLog) ? input.toolCallLog : [];
    const workflowEntryTools = new Set(
        Array.from(input.workflowEntryTools).map((name) => String(name || '').trim()).filter(Boolean)
    );
    let ownerIndex = -1;
    for (let index = toolCallLog.length - 1; index >= 0; index -= 1) {
        if (workflowEntryTools.has(String(toolCallLog[index]?.name || '').trim())) {
            ownerIndex = index;
            break;
        }
    }
    if (ownerIndex < 0) return buildEmptyResult();

    const owner = toolCallLog[ownerIndex];
    const ownerResult = asRecord(owner?.result);
    if (!ownerResult || ownerResult.success === false) return buildEmptyResult();
    const recovery = readContinuationRecovery(ownerResult);
    const outcome = resolveSkillExecutionOutcome(ownerResult);
    const isPendingExecuteHandoff = recovery?.mode === 'allowlist'
        && normalizePurpose(recovery.purpose) === 'execute'
        && outcome.status !== 'completed'
        && outcome.status !== 'failed'
        && outcome.status !== 'blocked'
        && outcome.status !== 'cancelled'
        && outcome.status !== 'awaiting_confirmation';
    if (!isPendingExecuteHandoff) return buildEmptyResult();

    const continuationLog = toolCallLog.slice(ownerIndex + 1);
    const successfulAtomicWrite = continuationLog.some((entry) => (
        !workflowEntryTools.has(String(entry?.name || '').trim())
        && classifyAgentToolExecution(String(entry?.name || ''), entry?.arguments) === 'photoshop_write'
        && Boolean(asRecord(entry?.result))
        && entry?.result?.success !== false
    ));
    const observationGate = evaluateCompletionObservationGate(
        continuationLog.map((entry) => ({
            name: entry.name,
            arguments: entry.arguments,
            result: entry.result,
            succeeded: Boolean(asRecord(entry.result)) && entry.result?.success !== false
        }))
    );
    const verifiedPostWriteReadback = successfulAtomicWrite
        && observationGate.reason === 'has_observation'
        && observationGate.observationCount > 0;
    const taskCompletionPassed = input.taskCompletionStatus === 'completed';
    const freshVisualPass = input.hasFreshVisualPass === true;
    const runtimeQualityVerdictPassed = !input.runtimeRequiresQualityVerdict
        || input.designVerdictStatus === 'passed';
    const fulfilled = successfulAtomicWrite
        && verifiedPostWriteReadback
        && taskCompletionPassed
        && freshVisualPass
        && runtimeQualityVerdictPassed;
    return {
        status: fulfilled ? 'fulfilled' : 'pending',
        workflowCallId: owner.callId,
        successfulAtomicWrite,
        verifiedPostWriteReadback,
        taskCompletionPassed,
        freshVisualPass,
        runtimeQualityVerdictPassed
    };
}

function selectVisualDeliveryRepairTools(input: {
    declaredToolNames: Iterable<string>;
    availableToolNames: Set<string>;
    workflowEntryTools: Set<string>;
}): string[] {
    return selectPurposeCompatibleTools({
        toolNames: input.declaredToolNames,
        availableToolNames: input.availableToolNames,
        purpose: 'repair'
    }).filter((toolName) => (
        classifyAgentToolExecution(toolName) !== 'save_export'
        && !input.workflowEntryTools.has(toolName)
    ));
}

function selectVisualDeliveryReviewTools(input: {
    declaredToolNames: Iterable<string>;
    availableToolNames: Set<string>;
}): string[] {
    return selectPurposeCompatibleTools({
        toolNames: input.declaredToolNames,
        availableToolNames: input.availableToolNames,
        purpose: 'observe'
    });
}

function resolveVisualDeliveryScopeState(input: {
    visualStatus: AgentWorkflowVisualDeliveryStatus;
    deliveryToolNames: string[];
    repairToolNames: string[];
    completeOnVisualPass: boolean;
    repairTarget?: AgentWorkflowContinuationScope['repairTarget'];
    availableToolNames: Set<string>;
    workflowEntryTools: Set<string>;
}): Pick<
    AgentWorkflowContinuationScope,
    'purpose' | 'allowedToolNames' | 'reason' | 'repairTarget'
> {
    if (input.visualStatus === 'passed') {
        if (input.completeOnVisualPass) {
            return {
                purpose: 'replan',
                allowedToolNames: [],
                repairTarget: undefined,
                reason: '真实画面已由 Runtime 视觉复核通过；本任务未请求保存或导出，可以进入最终完成判断。'
            };
        }
        return {
            purpose: 'deliver',
            allowedToolNames: input.deliveryToolNames,
            repairTarget: undefined,
            reason: '真实画面已由 Runtime 视觉复核通过，只开放声明的交付动作。'
        };
    }
    if (input.visualStatus === 'needs_fix') {
        return {
            purpose: 'repair',
            allowedToolNames: selectVisualDeliveryRepairTools({
                declaredToolNames: input.repairToolNames,
                availableToolNames: input.availableToolNames,
                workflowEntryTools: input.workflowEntryTools
            }),
            repairTarget: input.repairTarget,
            reason: '真实画面复核发现需修问题；交付仍锁定，先开放同一 Stage 的原子修复能力。'
        };
    }
    return {
        purpose: 'observe',
        allowedToolNames: selectPurposeCompatibleTools({
            toolNames: input.availableToolNames,
            availableToolNames: input.availableToolNames,
            purpose: 'observe'
        }),
        repairTarget: undefined,
        reason: input.visualStatus === 'unreadable'
            ? '真实画面无法可靠读取；交付仍锁定，只允许重新观察。'
            : '交付候选仍在等待真实画面复核；交付保持锁定。'
    };
}

function sameBinding(
    left: AgentWorkflowContinuationBinding,
    right: AgentWorkflowContinuationBinding
): boolean {
    return left.sessionId === right.sessionId
        && left.runId === right.runId
        && left.generation === right.generation
        && left.stage === right.stage;
}

/**
 * 将最新 Workflow 结果解析为持久 continuation 范围。
 *
 * Skill 返回值不能扩权：声明工具必须同时属于当前模型轮可见集合，且类别必须与
 * purpose 匹配。缺失、非法或空声明进入 fail-closed 范围，只保留当前可见的安全
 * 读取/输入/重规划能力。只有 Workflow 显式声明且与当前可见工具相交的 repair
 * allowlist 才能恢复其中列出的 Photoshop 写入或保存/导出能力；fallback 永不推断 repair。
 */
export function resolveAgentWorkflowContinuationScopeUpdate(input: {
    workflowEntryTools: Iterable<string>;
    toolCalls: AgentWorkflowContinuationToolCall[];
    toolResults: AgentWorkflowContinuationToolResult[];
    availableToolNames: Iterable<string>;
    binding?: AgentWorkflowContinuationBinding;
    visualDeliveryStatusByCallId?: Readonly<Record<string, AgentWorkflowVisualDeliveryStatus>>;
    visualDeliveryIdentityByCallId?: Readonly<
        Record<string, AgentWorkflowVisualObservationIdentity>
    >;
}): AgentWorkflowContinuationScopeUpdate {
    const workflowEntryTools = new Set(input.workflowEntryTools);
    const availableToolNames = new Set(input.availableToolNames);
    for (const result of [...input.toolResults].reverse()) {
        const call = input.toolCalls.find((item) => item.id === result.callId);
        if (!call) continue;
        const output = asRecord(result.output);
        const isStructuredSkillResult = Boolean(
            output && isStructuredSkillWorkflowResult(output, call.name)
        );
        if (!workflowEntryTools.has(call.name) && !isStructuredSkillResult) continue;
        if (isStructuredSkillResult) workflowEntryTools.add(call.name);
        if (!output) {
            return {
                kind: 'activate',
                scope: {
                    version: 'agent-workflow-continuation-scope/v0',
                    workflowToolName: call.name,
                    workflowCallId: call.id,
                    purpose: 'replan',
                    allowedToolNames: [],
                    reason: `${call.name} 没有返回可验证的工作流结果，已保持失败关闭。`,
                    source: 'fail_closed',
                    binding: input.binding || {}
                }
            };
        }
        const outcome = resolveSkillExecutionOutcome(output);
        if (outcome.status === 'completed') {
            return {
                kind: 'clear',
                workflowToolName: call.name,
                reason: outcome.summary
            };
        }
        const recovery = readContinuationRecovery(output);
        const declaredPurpose = recovery?.mode === 'allowlist'
            ? normalizePurpose(recovery.purpose)
            : undefined;
        if (declaredPurpose === 'deliver') {
            const data = asRecord(output.data);
            const deliveryCandidate = asRecord(data?.deliveryCandidate);
            const deliveryToolNames = selectPurposeCompatibleTools({
                toolNames: recovery?.allowedToolNames || [],
                availableToolNames,
                purpose: 'deliver'
            });
            const candidateRepairToolNames = normalizeToolNames(
                deliveryCandidate?.repairAllowedToolNames
            );
            const recoveryRepairToolNames = normalizeToolNames(
                recovery?.repairAllowedToolNames
            );
            const recoveryRepairToolNameSet = new Set(recoveryRepairToolNames);
            const repairToolNames = selectVisualDeliveryRepairTools({
                declaredToolNames: candidateRepairToolNames.filter((toolName) => (
                    recoveryRepairToolNameSet.has(toolName)
                )),
                availableToolNames,
                workflowEntryTools
            });
            const candidateReviewToolNames = normalizeToolNames(
                deliveryCandidate?.reviewAllowedToolNames
            );
            const recoveryReviewToolNames = new Set(normalizeToolNames(
                recovery?.reviewAllowedToolNames
            ));
            const reviewToolNames = selectVisualDeliveryReviewTools({
                declaredToolNames: candidateReviewToolNames.filter((toolName) => (
                    recoveryReviewToolNames.has(toolName)
                )),
                availableToolNames
            });
            const visualReviewRequest = asRecord(data?.visualReviewRequest);
            const reviewRequestToolName = String(visualReviewRequest?.toolName || '').trim();
            const reviewRequestArguments = asRecord(
                visualReviewRequest?.params ?? visualReviewRequest?.arguments
            );
            const reviewRequest = reviewRequestToolName
                && reviewRequestArguments
                && reviewToolNames.includes(reviewRequestToolName)
                ? {
                    toolName: reviewRequestToolName,
                    argumentsSignature: buildArgumentsSignature(reviewRequestArguments)
                }
                : undefined;
            const targetObservationIds = normalizeTargetObservationIds(deliveryCandidate);
            const candidateVisualIdentity = normalizeVisualObservationIdentity(
                input.visualDeliveryIdentityByCallId?.[call.id]
            );
            const candidateWorkMode = String(deliveryCandidate?.workMode || '').trim();
            const repairTargetLayerIds = normalizeLayerIds(
                deliveryCandidate?.targetLayerIds
            );
            const repairTarget = candidateWorkMode === 'edit_existing'
                ? {
                    allowedLayerIds: repairTargetLayerIds,
                    requireExplicitLayerTarget: true as const
                }
                : undefined;
            const completeOnVisualPass = recovery?.completeOnVisualPass === true
                && deliveryCandidate?.completeOnVisualPass === true
                && deliveryCandidate?.exportRequested !== true;
            const hasValidDeliveryDeclaration = recovery?.requiresVisualPass === true
                && deliveryCandidate?.status === 'awaiting_visual_review'
                && deliveryCandidate?.deterministicChecksPassed === true
                && deliveryCandidate?.requiresVisualPass === true
                && targetObservationIds.length > 0
                && Boolean(candidateVisualIdentity)
                && reviewToolNames.length > 0
                && Boolean(reviewRequest)
                && (
                    completeOnVisualPass
                    || (
                        normalizeToolNames(recovery?.allowedToolNames).length > 0
                        && deliveryToolNames.length > 0
                    )
                );
            if (hasValidDeliveryDeclaration) {
                const visualStatus = input.visualDeliveryStatusByCallId?.[call.id] || 'pending';
                const deliveryState = resolveVisualDeliveryScopeState({
                    visualStatus,
                    deliveryToolNames,
                    repairToolNames,
                    completeOnVisualPass,
                    repairTarget,
                    availableToolNames,
                    workflowEntryTools
                });
                return {
                    kind: 'activate',
                    scope: {
                        version: 'agent-workflow-continuation-scope/v0',
                        workflowToolName: call.name,
                        workflowCallId: call.id,
                        ...deliveryState,
                        source: 'declared',
                        binding: input.binding || {},
                        visualDelivery: {
                            requiresVisualPass: true as const,
                            completeOnVisualPass,
                            allowedToolNames: deliveryToolNames,
                            repairAllowedToolNames: repairToolNames,
                            reviewAllowedToolNames: reviewToolNames,
                            targetObservationIds,
                            reviewRequest: reviewRequest!,
                            candidateDocumentId: candidateVisualIdentity!.documentId,
                            candidateHistoryStateId: candidateVisualIdentity!.historyStateId,
                            repairTarget
                        }
                    }
                };
            }
        }
        const nonDeliveryDeclaredPurpose = declaredPurpose === 'deliver'
            ? undefined
            : declaredPurpose;
        const declaredToolNames = nonDeliveryDeclaredPurpose
            ? selectPurposeCompatibleTools({
                toolNames: recovery?.allowedToolNames || [],
                availableToolNames,
                purpose: nonDeliveryDeclaredPurpose
            })
            : [];
        const requiredToolName = String(recovery?.requiredToolName || '').trim();
        const requiredArgumentEquals = normalizeRequiredArgumentEquals(
            recovery?.requiredArguments
        );
        const hasValidRequiredToolCall = Boolean(
            requiredToolName
            && requiredArgumentEquals
            && declaredToolNames.includes(requiredToolName)
        );
        const continuationCandidate = asRecord(asRecord(output.data)?.deliveryCandidate);
        const continuationWorkMode = String(continuationCandidate?.workMode || '').trim();
        const continuationTargetLayerIds = normalizeLayerIds(
            continuationCandidate?.targetLayerIds
        );
        const requiresScopedRepairTarget = nonDeliveryDeclaredPurpose === 'repair'
            && continuationWorkMode === 'edit_existing';
        const hasValidDeclaration = Boolean(
            nonDeliveryDeclaredPurpose
            && normalizeToolNames(recovery?.allowedToolNames).length > 0
            && declaredToolNames.length > 0
            && (!requiresScopedRepairTarget || continuationTargetLayerIds.length > 0)
        );
        const purpose = hasValidDeclaration
            ? nonDeliveryDeclaredPurpose as AgentWorkflowContinuationScope['purpose']
            : resolveFallbackPurpose(output);
        const allowedToolNames = hasValidDeclaration
            ? declaredToolNames
            : selectPurposeCompatibleTools({
                toolNames: availableToolNames,
                availableToolNames,
                purpose
            }).filter((toolName) => toolName !== call.name);
        const toolArgumentConstraints = hasValidDeclaration
            ? normalizeToolArgumentConstraints(
                recovery?.toolArgumentConstraints,
                allowedToolNames
            )
            : undefined;
        return {
            kind: 'activate',
            scope: {
                version: 'agent-workflow-continuation-scope/v0',
                workflowToolName: call.name,
                workflowCallId: call.id,
                purpose,
                allowedToolNames,
                reason: hasValidDeclaration
                    ? String(recovery?.reason || '').trim().slice(0, 240)
                        || `${call.name} 已声明继续所需的最小能力范围。`
                    : `${call.name} 尚未完成且没有可验证的能力交接；已限制为工作流 owner 和安全${purpose === 'collect_input' ? '输入' : '读取/重规划'}能力。`,
                source: hasValidDeclaration ? 'declared' : 'fail_closed',
                binding: input.binding || {},
                ...(hasValidDeclaration && hasValidRequiredToolCall
                    ? {
                        requiredToolCall: {
                            toolName: requiredToolName,
                            argumentEquals: requiredArgumentEquals!
                        }
                    }
                    : {}),
                ...(toolArgumentConstraints ? { toolArgumentConstraints } : {}),
                ...(hasValidDeclaration && requiresScopedRepairTarget
                    ? {
                        repairTarget: {
                            allowedLayerIds: continuationTargetLayerIds,
                            requireExplicitLayerTarget: true as const
                        }
                    }
                    : {})
            }
        };
    }
    return { kind: 'none' };
}

/**
 * primary-self 视觉复核发生在 Workflow 返回后的下一模型轮。
 * 该轮拿到结构化 review decision 后，用此纯函数把持久 Scope 从等待观察切换为
 * deliver 或 repair；交付 Tool 仍只能来自原始声明，视觉失败绝不放开保存/导出。
 */
export function refreshAgentWorkflowContinuationVisualDelivery(input: {
    scope?: AgentWorkflowContinuationScope;
    visualStatus: AgentWorkflowVisualDeliveryStatus;
    availableToolNames: Iterable<string>;
    workflowEntryTools: Iterable<string>;
}): AgentWorkflowContinuationScope | undefined {
    const scope = input.scope;
    if (!scope?.visualDelivery) return scope;
    const availableToolNames = new Set(input.availableToolNames);
    const deliveryToolNames = scope.visualDelivery.allowedToolNames.filter((toolName) => (
        availableToolNames.has(toolName)
        && isToolAllowedForContinuationPurpose(toolName, 'deliver')
    ));
    const repairToolNames = selectVisualDeliveryRepairTools({
        declaredToolNames: scope.visualDelivery.repairAllowedToolNames,
        availableToolNames,
        workflowEntryTools: new Set(input.workflowEntryTools)
    });
    if (deliveryToolNames.length === 0
        && scope.visualDelivery.completeOnVisualPass !== true) {
        return {
            ...scope,
            purpose: 'observe',
            allowedToolNames: [],
            reason: '原交付动作已不在当前 Stage 能力范围内，保持失败关闭。'
        };
    }
    const deliveryState = resolveVisualDeliveryScopeState({
        visualStatus: input.visualStatus,
        deliveryToolNames,
        repairToolNames,
        completeOnVisualPass: scope.visualDelivery.completeOnVisualPass,
        repairTarget: scope.visualDelivery.repairTarget,
        availableToolNames,
        workflowEntryTools: new Set(input.workflowEntryTools)
    });
    return {
        ...scope,
        ...deliveryState,
        visualDelivery: {
            requiresVisualPass: true as const,
            completeOnVisualPass: scope.visualDelivery.completeOnVisualPass,
            allowedToolNames: deliveryToolNames,
            repairAllowedToolNames: repairToolNames,
            reviewAllowedToolNames: scope.visualDelivery.reviewAllowedToolNames,
            targetObservationIds: scope.visualDelivery.targetObservationIds,
            reviewRequest: scope.visualDelivery.reviewRequest,
            candidateDocumentId: scope.visualDelivery.candidateDocumentId,
            candidateHistoryStateId: scope.visualDelivery.candidateHistoryStateId,
            ...(input.visualStatus === 'pending' || input.visualStatus === 'unreadable'
                ? {
                    awaitingRepairObservation: scope.visualDelivery.awaitingRepairObservation,
                    expectedReviewDocumentId: scope.visualDelivery.expectedReviewDocumentId,
                    expectedReviewHistoryStateId: scope.visualDelivery.expectedReviewHistoryStateId,
                    reviewResultToolName: scope.visualDelivery.reviewResultToolName,
                    reviewResultCallId: scope.visualDelivery.reviewResultCallId
                }
                : {}),
            repairTarget: scope.visualDelivery.repairTarget
        }
    };
}

/**
 * 视觉失败后的原子修复不能直接解除交付锁。
 *
 * 当且仅当声明范围内的 Photoshop 写操作真实成功后，Harness 才切换为
 * “修复后重新观察”状态：复合 owner 与所有写工具继续隐藏，只开放 Skill 双重
 * 声明的视觉读取工具。这样不会因重跑生产工作流而覆盖刚完成的原子修复。
 */
export function advanceAgentWorkflowContinuationAfterRepair(input: {
    scope?: AgentWorkflowContinuationScope;
    toolCalls: AgentWorkflowContinuationToolCall[];
    toolResults: AgentWorkflowContinuationToolResult[];
    validatedRepairWrites?: Iterable<{
        callId: string;
        documentId: string;
        historyStateId: string;
    }>;
}): AgentWorkflowContinuationScope | undefined {
    const scope = input.scope;
    if (!scope?.visualDelivery || scope.purpose !== 'repair') return scope;
    const allowedToolNames = new Set(scope.allowedToolNames);
    const validatedRepairWrites = new Map(
        Array.from(input.validatedRepairWrites || []).map((write) => (
            [write.callId, write] as const
        ))
    );
    const successfulRepair = [...input.toolResults].reverse().flatMap((result) => {
        const write = validatedRepairWrites.get(result.callId);
        if (result.success !== true
            || !write
            || write.documentId !== scope.visualDelivery!.candidateDocumentId
            || write.historyStateId === scope.visualDelivery!.candidateHistoryStateId) {
            return [];
        }
        const call = input.toolCalls.find((item) => item.id === result.callId);
        return (
            call
            && allowedToolNames.has(call.name)
            && classifyAgentToolExecution(call.name) === 'photoshop_write'
        ) ? [write] : [];
    })[0];
    if (!successfulRepair) return scope;
    return {
        ...scope,
        purpose: 'observe',
        allowedToolNames: [scope.visualDelivery.reviewRequest.toolName],
        repairTarget: undefined,
        visualDelivery: {
            ...scope.visualDelivery,
            awaitingRepairObservation: true,
            expectedReviewDocumentId: successfulRepair.documentId,
            expectedReviewHistoryStateId: successfulRepair.historyStateId,
            reviewResultToolName: undefined,
            reviewResultCallId: undefined
        },
        reason: '目标内原子修复已完成；只允许重新读取同一目标画面，复核期间不会重跑生产写入。'
    };
}

export function bindAgentWorkflowContinuationRepairObservation(input: {
    scope?: AgentWorkflowContinuationScope;
    toolCalls: AgentWorkflowContinuationToolCall[];
    toolResults: AgentWorkflowContinuationToolResult[];
    validatedReviewObservations?: Iterable<{
        callId: string;
        documentId: string;
        historyStateId: string;
    }>;
}): AgentWorkflowContinuationScope | undefined {
    const scope = input.scope;
    if (!scope?.visualDelivery?.awaitingRepairObservation
        || scope.purpose !== 'observe') {
        return scope;
    }
    const reviewToolNames = new Set(scope.visualDelivery.reviewAllowedToolNames);
    const expectedReviewDocumentId = scope.visualDelivery.expectedReviewDocumentId;
    const expectedReviewHistoryStateId = scope.visualDelivery.expectedReviewHistoryStateId;
    if (!expectedReviewDocumentId || !expectedReviewHistoryStateId) return scope;
    const validatedReviewObservations = new Map(
        Array.from(input.validatedReviewObservations || []).map((observation) => (
            [observation.callId, observation] as const
        ))
    );
    const reviewCall = [...input.toolResults].reverse().flatMap((result) => {
        const observation = validatedReviewObservations.get(result.callId);
        if (result.success !== true
            || !observation
            || observation.documentId !== expectedReviewDocumentId
            || observation.historyStateId !== expectedReviewHistoryStateId) {
            return [];
        }
        const call = input.toolCalls.find((item) => item.id === result.callId);
        return call
            && reviewToolNames.has(call.name)
            && matchesVisualReviewRequest(scope.visualDelivery!.reviewRequest, call)
            ? [call]
            : [];
    })[0];
    if (!reviewCall) return scope;
    return {
        ...scope,
        visualDelivery: {
            ...scope.visualDelivery,
            reviewResultToolName: reviewCall.name,
            reviewResultCallId: reviewCall.id
        },
        reason: '已取得修复后的新版本画面，等待 Runtime 逐图视觉复核。'
    };
}

export function resolveAgentWorkflowContinuationScope(input: {
    workflowEntryTools: Iterable<string>;
    toolCalls: AgentWorkflowContinuationToolCall[];
    toolResults: AgentWorkflowContinuationToolResult[];
    availableToolNames: Iterable<string>;
    binding?: AgentWorkflowContinuationBinding;
}): AgentWorkflowContinuationScope | undefined {
    const update = resolveAgentWorkflowContinuationScopeUpdate(input);
    return update.kind === 'activate' ? update.scope : undefined;
}

export function retainAgentWorkflowContinuationScope(input: {
    scope?: AgentWorkflowContinuationScope;
    binding: AgentWorkflowContinuationBinding;
}): AgentWorkflowContinuationScope | undefined {
    if (!input.scope) return undefined;
    return sameBinding(input.scope.binding, input.binding) ? input.scope : undefined;
}

export function selectAgentWorkflowContinuationToolNames(input: {
    scope?: AgentWorkflowContinuationScope;
    availableToolNames: Iterable<string>;
}): string[] {
    const availableToolNames = Array.from(input.availableToolNames);
    if (!input.scope) return availableToolNames;
    const allowedToolNames = new Set([
        ...(input.scope.visualDelivery || input.scope.purpose === 'execute'
            ? []
            : [input.scope.workflowToolName]),
        ...input.scope.allowedToolNames
    ]);
    return availableToolNames.filter((toolName) => allowedToolNames.has(toolName));
}

export function evaluateAgentWorkflowContinuationToolAccess(input: {
    scope?: AgentWorkflowContinuationScope;
    toolName: string;
    args?: unknown;
}): AgentWorkflowContinuationToolAccess {
    if (!input.scope) return { allowed: true };
    const allowed = (!input.scope.visualDelivery
        && input.scope.purpose !== 'execute'
        && input.toolName === input.scope.workflowToolName)
        || input.scope.allowedToolNames.includes(input.toolName);
    if (!allowed) {
        return {
            allowed: false,
            code: 'workflow_continuation_scope_blocked',
            reason: `当前仍在 ${input.scope.workflowToolName} 的${labelContinuationPurpose(input.scope.purpose)}阶段，未授权执行 ${input.toolName}。`
        };
    }
    if (input.scope.requiredToolCall
        && input.toolName === input.scope.requiredToolCall.toolName) {
        const args = asRecord(input.args);
        const mismatchedArguments = Object.entries(
            input.scope.requiredToolCall.argumentEquals
        ).filter(([key, expected]) => args?.[key] !== expected);
        if (mismatchedArguments.length > 0) {
            return {
                allowed: false,
                code: 'workflow_continuation_scope_blocked',
                reason: `${input.toolName} 必须继续原工作流动作，不能改写 ${mismatchedArguments
                    .map(([key]) => key)
                    .join('、')} 或切换到其他操作。`
            };
        }
    }
    const toolArgumentConstraint = input.scope.toolArgumentConstraints?.[input.toolName];
    if (toolArgumentConstraint) {
        const args = asRecord(input.args);
        const missingArgumentKeys = (toolArgumentConstraint.requiredArgumentKeys || [])
            .filter((key) => args?.[key] === undefined || args?.[key] === null || args?.[key] === '');
        const mismatchedArguments = Object.entries(toolArgumentConstraint.argumentEquals || {})
            .filter(([key, expected]) => args?.[key] !== expected);
        if (missingArgumentKeys.length > 0 || mismatchedArguments.length > 0) {
            const invalidKeys = Array.from(new Set([
                ...missingArgumentKeys,
                ...mismatchedArguments.map(([key]) => key)
            ]));
            return {
                allowed: false,
                code: 'workflow_continuation_scope_blocked',
                reason: `${input.toolName} 在当前恢复阶段必须满足参数约束：${invalidKeys.join('、')}。`
            };
        }
    }
    if (input.scope.purpose === 'repair'
        && input.toolName !== input.scope.workflowToolName
        && classifyAgentToolExecution(input.toolName) === 'photoshop_write'
        && input.scope.repairTarget?.requireExplicitLayerTarget) {
        const allowedLayerIds = new Set(input.scope.repairTarget.allowedLayerIds);
        const targetedLayerIds = collectExplicitLayerTargetIds(input.toolName, input.args);
        if (allowedLayerIds.size === 0 || targetedLayerIds.length === 0) {
            return {
                allowed: false,
                code: 'workflow_continuation_scope_blocked',
                reason: `当前局部修复必须为 ${input.toolName} 提供明确的目标图层 ID，不能依赖当前选区或整屏兜底。`
            };
        }
        const outOfScopeLayerIds = targetedLayerIds.filter((layerId) => (
            !allowedLayerIds.has(layerId)
        ));
        if (outOfScopeLayerIds.length > 0) {
            return {
                allowed: false,
                code: 'workflow_continuation_scope_blocked',
                reason: `${input.toolName} 试图修改局部任务目标外图层 ${outOfScopeLayerIds.join('、')}，已拒绝执行。`
            };
        }
    }
    if (input.scope.purpose === 'observe'
        && input.scope.visualDelivery?.awaitingRepairObservation
        && input.toolName === input.scope.visualDelivery.reviewRequest.toolName
        && buildArgumentsSignature(input.args)
            !== input.scope.visualDelivery.reviewRequest.argumentsSignature) {
        return {
            allowed: false,
            code: 'workflow_continuation_scope_blocked',
            reason: `${input.toolName} 必须严格复验原候选声明的目标屏与参数，不能改成其他屏幕或扩大范围。`
        };
    }
    return { allowed: true };
}

function collectExplicitLayerTargetIds(toolName: string, value: unknown): number[] {
    const collected = new Set<number>();
    const args = asRecord(value);
    if (!args) return [];
    ['layerId', 'targetLayerId', 'placeholderLayerId'].forEach((key) => {
        const layerId = Number(args[key]);
        if (Number.isInteger(layerId) && layerId > 0) collected.add(layerId);
    });
    ['layerIds', 'targetLayerIds', 'placeholderLayerIds'].forEach((key) => {
        normalizeLayerIds(args[key]).forEach((layerId) => collected.add(layerId));
    });
    if (toolName === 'setTextContent' && Array.isArray(args.updates)) {
        args.updates.forEach((update: unknown) => {
            const layerId = Number(asRecord(update)?.layerId);
            if (Number.isInteger(layerId) && layerId > 0) collected.add(layerId);
        });
    }
    return Array.from(collected);
}

/**
 * Workflow owner 尚未尝试时，E1 保留 owner、Harness 控制和安全读取能力，
 * 隐藏没有 R4 归属的写工具。选择依据全部来自 Runtime/Capability 状态。
 */
export function selectInitialAgentWorkflowToolNames(input: {
    workflowEntryTools: Iterable<string>;
    availableToolNames: Iterable<string>;
    progressToolNames: Iterable<string>;
    attemptedToolNames: Iterable<string>;
    hasActionResult: boolean;
}): string[] | undefined {
    const workflowEntryTools = new Set(input.workflowEntryTools);
    if (workflowEntryTools.size === 0 || input.hasActionResult) return undefined;
    const attemptedToolNames = new Set(input.attemptedToolNames);
    if (Array.from(workflowEntryTools).some((toolName) => attemptedToolNames.has(toolName))) {
        return undefined;
    }
    const progressToolNames = new Set(input.progressToolNames);
    const selectedWorkflowOwners = new Set(
        Array.from(workflowEntryTools).filter((toolName) => progressToolNames.has(toolName))
    );
    if (selectedWorkflowOwners.size === 0) return undefined;
    return Array.from(input.availableToolNames).filter((toolName) => {
        const kind = classifyAgentToolExecution(toolName);
        return selectedWorkflowOwners.has(toolName)
            || isAgentHarnessControlTool(toolName)
            || kind === 'read_only_observation'
            || kind === 'knowledge_search';
    });
}

export interface DeterministicCompactE1WorkflowOwnerCall {
    name: string;
    arguments: Record<string, never>;
}

/**
 * 紧凑 Runtime（无 R4）进入 E1 后，模型可能在唯一 Workflow owner 已经可见时仍只返回文字。
 * 此函数只判定一次确定性的 owner 调用，不执行 Tool、也不授予任何新能力：调用方仍须把
 * 返回值送回既有 preflight / execute / log / accounting 链路。
 *
 * 这里故意要求“当前可见能力”与 Manifest workflow owner 的交集恰好为一个；Manifest 有
 * 多 owner、owner 已尝试、已有 E1 动作、存在 continuation 或写授权不足时全部保持失败关闭。
 */
export function buildDeterministicCompactE1WorkflowOwnerCall(input: {
    currentStage?: string;
    runtimeStages: Iterable<string>;
    workflowEntryTools: Iterable<string>;
    visibleAllowedToolNames: Iterable<string>;
    attemptedToolNames: Iterable<string>;
    writeAuthorized: boolean;
    hasActiveContinuation: boolean;
    hasActionResult: boolean;
}): DeterministicCompactE1WorkflowOwnerCall | undefined {
    if (input.currentStage !== 'E1'
        || input.writeAuthorized !== true
        || input.hasActiveContinuation
        || input.hasActionResult) {
        return undefined;
    }

    const runtimeStages = new Set(normalizeToolNames(Array.from(input.runtimeStages)));
    if (runtimeStages.size === 0 || runtimeStages.has('R4')) return undefined;

    const visibleAllowedToolNames = new Set(
        normalizeToolNames(Array.from(input.visibleAllowedToolNames))
    );
    const visibleWorkflowOwners = normalizeToolNames(Array.from(input.workflowEntryTools))
        .filter((toolName) => visibleAllowedToolNames.has(toolName));
    if (visibleWorkflowOwners.length !== 1) return undefined;

    const ownerToolName = visibleWorkflowOwners[0];
    const attemptedToolNames = new Set(normalizeToolNames(Array.from(input.attemptedToolNames)));
    if (attemptedToolNames.has(ownerToolName)) return undefined;
    if (classifyAgentToolExecution(ownerToolName) !== 'photoshop_write') return undefined;

    return {
        name: ownerToolName,
        arguments: {}
    };
}
