/**
 * R4 语义节点的首批可执行能力包。
 *
 * 这不是第二 Capability Registry 或第二执行器。Capability→provider 仍只读取
 * LEGACY_TOOL_CAPABILITY_MAP；本文件只认证已经迁入唯一 PhotoshopTransactionRunner
 * 的最小 provider 集，并在现有 E1 派发点把模型 Tool call 编译成有界执行信封。
 */

import type { AgentToolExecutionPreflight } from '../agent-tool-execution-preflight';
import { computeFastFingerprint } from './content-hash';
import type { RuntimeActionPlanDeclaration } from './runtime-action-plan-declaration';
import type { RuntimeActionPlanReconciliation } from './runtime-action-plan-reconciliation';
import type { RuntimeSession } from './runtime-session';
import { LEGACY_TOOL_CAPABILITY_MAP } from './tool-capability-bridge';

export const RUNTIME_ACTION_EXECUTION_PACK_VERSION =
    'runtime-action-execution-pack/v0' as const;
export const RUNTIME_ACTION_EXECUTION_ENVELOPE_VERSION =
    'runtime-action-execution-envelope/v0' as const;
export const PHOTOSHOP_MUTATION_V0_PACK_ID = 'photoshop.mutation.v0' as const;

const CERTIFIED_PROVIDER_NAMES = Object.freeze([
    'renameLayer',
    'groupLayersSafely',
    'moveLayer',
    'lockLayer',
    'setTextStyle'
] as const);

export type RuntimeActionExecutionV0ProviderName = typeof CERTIFIED_PROVIDER_NAMES[number];

export interface RuntimeActionExecutionPackAction {
    capabilityRef: string;
    providerName: RuntimeActionExecutionV0ProviderName;
    operationKind: 'photoshop_write';
    transactionOwner: 'PhotoshopTransactionRunner';
    requiresExplicitLayerTarget: true;
    requiresDocumentRevision: true;
}

export interface RuntimeActionExecutionPack {
    version: typeof RUNTIME_ACTION_EXECUTION_PACK_VERSION;
    packId: typeof PHOTOSHOP_MUTATION_V0_PACK_ID;
    actions: RuntimeActionExecutionPackAction[];
    boundaries: {
        certificationOnly: true;
        capabilityMapOwner: 'LEGACY_TOOL_CAPABILITY_MAP';
        executionOwner: 'PhotoshopTransactionRunner';
        exactLeafCapabilityRequired: true;
        defaultOffOutsideExactCapability: true;
        categoryNeutral: true;
        executesTools: false;
        grantsPermission: false;
        schedulerAuthority: false;
    };
}

export interface RuntimeActionProviderSchema {
    name: string;
    inputSchema?: {
        type?: string;
        properties?: Record<string, {
            type?: string;
            enum?: unknown[];
            items?: { type?: string };
        }>;
        required?: string[];
    };
}

export interface RuntimeActionExecutionEnvelope {
    version: typeof RUNTIME_ACTION_EXECUTION_ENVELOPE_VERSION;
    envelopeId: string;
    packVersion: typeof RUNTIME_ACTION_EXECUTION_PACK_VERSION;
    packId: typeof PHOTOSHOP_MUTATION_V0_PACK_ID;
    taskRunId: string;
    runId: string;
    planRevision: number;
    planFingerprint: string;
    nodeId: string;
    capabilityRef: string;
    providerName: RuntimeActionExecutionV0ProviderName;
    providerCallId: string;
    argumentFingerprint: string;
    target: {
        documentId: number;
        historyStateId: number;
        observationTool: string;
    };
    compiledAt: string;
    boundaries: {
        compiledFromModelToolCall: true;
        bindsExistingTaskRunNode: true;
        bindsActiveCapability: true;
        bindsSchemaCheckedArguments: true;
        bindsPreflightTargetRevision: true;
        requiresIndependentRuntimeGate: true;
        executionOwner: 'PhotoshopTransactionRunner';
        categoryNeutral: true;
        executesTools: false;
        grantsPermission: false;
        schedulerAuthority: false;
        countsAsTaskProgress: false;
        countsAsQualityPass: false;
    };
}

export type RuntimeActionExecutionCompileCode =
    | 'runtime_action_execution_not_pack_scoped'
    | 'runtime_action_execution_compiled'
    | 'runtime_action_execution_pack_integrity_invalid'
    | 'runtime_action_execution_plan_not_ready'
    | 'runtime_action_execution_capability_inactive'
    | 'runtime_action_execution_node_not_unique'
    | 'runtime_action_execution_node_not_current'
    | 'runtime_action_execution_task_run_mismatch'
    | 'runtime_action_execution_provider_schema_missing'
    | 'runtime_action_execution_arguments_invalid'
    | 'runtime_action_execution_preflight_not_ready'
    | 'runtime_action_execution_target_revision_missing'
    | 'runtime_action_execution_target_revision_mismatch';

export interface RuntimeActionExecutionCompileDecision {
    status: 'not_applicable' | 'compiled' | 'blocked';
    allowed: boolean;
    code: RuntimeActionExecutionCompileCode;
    reason: string;
    envelope?: RuntimeActionExecutionEnvelope;
    boundaries: {
        packScopedOnly: true;
        doesNotExecuteTools: true;
        doesNotGrantPermission: true;
        doesNotChangeTaskResult: true;
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(record, key);
}

function isPositiveInteger(value: unknown): boolean {
    return Number.isSafeInteger(value) && Number(value) > 0;
}

function isFiniteNumber(value: unknown): boolean {
    return typeof value === 'number' && Number.isFinite(value);
}

function cleanText(value: unknown): string {
    return String(value || '').trim();
}

function buildDecision(input: Omit<RuntimeActionExecutionCompileDecision, 'boundaries'>): RuntimeActionExecutionCompileDecision {
    return {
        ...input,
        boundaries: {
            packScopedOnly: true,
            doesNotExecuteTools: true,
            doesNotGrantPermission: true,
            doesNotChangeTaskResult: true
        }
    };
}

function resolveDedicatedCapabilityRef(
    providerName: RuntimeActionExecutionV0ProviderName
): string | undefined {
    const capabilityRef = `photoshop.write.${providerName}`;
    const providers = LEGACY_TOOL_CAPABILITY_MAP[capabilityRef] || [];
    return providers.length === 1 && providers[0] === providerName
        ? capabilityRef
        : undefined;
}

function buildCertifiedActions(): RuntimeActionExecutionPackAction[] {
    return CERTIFIED_PROVIDER_NAMES.flatMap((providerName) => {
        const capabilityRef = resolveDedicatedCapabilityRef(providerName);
        if (!capabilityRef) return [];
        return [{
            capabilityRef,
            providerName,
            operationKind: 'photoshop_write' as const,
            transactionOwner: 'PhotoshopTransactionRunner' as const,
            requiresExplicitLayerTarget: true as const,
            requiresDocumentRevision: true as const
        }];
    });
}

export function buildRuntimeActionExecutionV0Pack(): RuntimeActionExecutionPack {
    return {
        version: RUNTIME_ACTION_EXECUTION_PACK_VERSION,
        packId: PHOTOSHOP_MUTATION_V0_PACK_ID,
        actions: buildCertifiedActions(),
        boundaries: {
            certificationOnly: true,
            capabilityMapOwner: 'LEGACY_TOOL_CAPABILITY_MAP',
            executionOwner: 'PhotoshopTransactionRunner',
            exactLeafCapabilityRequired: true,
            defaultOffOutsideExactCapability: true,
            categoryNeutral: true,
            executesTools: false,
            grantsPermission: false,
            schedulerAuthority: false
        }
    };
}

function readCertifiedAction(providerName: string): RuntimeActionExecutionPackAction | undefined {
    return buildRuntimeActionExecutionV0Pack().actions.find((action) => (
        action.providerName === providerName
    ));
}

function isCertifiedProviderName(value: string): value is RuntimeActionExecutionV0ProviderName {
    return CERTIFIED_PROVIDER_NAMES.some((providerName) => providerName === value);
}

function unexpectedArgumentKeys(
    args: Record<string, unknown>,
    allowedKeys: readonly string[]
): string[] {
    const allowed = new Set(allowedKeys);
    return Object.keys(args).filter((key) => !allowed.has(key));
}

function validateSchemaValue(
    value: unknown,
    schema: { type?: string; enum?: unknown[]; items?: { type?: string } }
): boolean {
    if (schema.enum && !schema.enum.includes(value)) return false;
    switch (schema.type) {
        case 'string': return typeof value === 'string';
        case 'number': return isFiniteNumber(value);
        case 'boolean': return typeof value === 'boolean';
        case 'array':
            return Array.isArray(value)
                && (!schema.items?.type || value.every((item) => (
                    validateSchemaValue(item, { type: schema.items?.type })
                )));
        case 'object': return isRecord(value);
        default: return true;
    }
}

function validateProviderSchemaArguments(input: {
    providerSchema: RuntimeActionProviderSchema;
    arguments: Record<string, unknown>;
}): string[] {
    const issues: string[] = [];
    const schema = input.providerSchema.inputSchema;
    if (!schema || schema.type !== 'object' || !schema.properties) {
        return ['provider_schema_invalid'];
    }
    (schema.required || []).forEach((key) => {
        if (!hasOwn(input.arguments, key)) issues.push(`required_argument_missing:${key}`);
    });
    Object.entries(input.arguments).forEach(([key, value]) => {
        const propertySchema = schema.properties?.[key];
        if (propertySchema && !validateSchemaValue(value, propertySchema)) {
            issues.push(`argument_type_invalid:${key}`);
        }
    });
    return issues;
}

function validateCertifiedProviderArguments(
    providerName: RuntimeActionExecutionV0ProviderName,
    args: Record<string, unknown>
): string[] {
    const issues: string[] = [];
    if (!isPositiveInteger(args.layerId) && providerName !== 'groupLayersSafely') {
        issues.push('explicit_layer_id_required');
    }
    switch (providerName) {
        case 'renameLayer': {
            issues.push(...unexpectedArgumentKeys(args, ['layerId', 'newName'])
                .map((key) => `unsupported_argument:${key}`));
            if (!cleanText(args.newName)) issues.push('new_name_required');
            break;
        }
        case 'groupLayersSafely': {
            issues.push(...unexpectedArgumentKeys(args, ['groupName', 'layerIds'])
                .map((key) => `unsupported_argument:${key}`));
            if (!cleanText(args.groupName)) issues.push('group_name_required');
            if (!Array.isArray(args.layerIds) || args.layerIds.length === 0) {
                issues.push('explicit_layer_ids_required');
                break;
            }
            if (!args.layerIds.every(isPositiveInteger)) issues.push('layer_ids_invalid');
            if (new Set(args.layerIds).size !== args.layerIds.length) issues.push('layer_ids_duplicate');
            break;
        }
        case 'moveLayer': {
            issues.push(...unexpectedArgumentKeys(args, ['layerId', 'x', 'y', 'relative'])
                .map((key) => `unsupported_argument:${key}`));
            const xProvided = hasOwn(args, 'x');
            const yProvided = hasOwn(args, 'y');
            if (!xProvided && !yProvided) issues.push('move_coordinate_required');
            if (xProvided && !isFiniteNumber(args.x)) issues.push('x_invalid');
            if (yProvided && !isFiniteNumber(args.y)) issues.push('y_invalid');
            if (hasOwn(args, 'relative') && typeof args.relative !== 'boolean') {
                issues.push('relative_invalid');
            }
            break;
        }
        case 'lockLayer': {
            issues.push(...unexpectedArgumentKeys(args, ['layerId', 'lock', 'lockType'])
                .map((key) => `unsupported_argument:${key}`));
            if (typeof args.lock !== 'boolean') issues.push('lock_value_required');
            if (!['all', 'position', 'transparent'].includes(String(args.lockType || ''))) {
                issues.push('lock_type_invalid');
            }
            break;
        }
        case 'setTextStyle': {
            const styleKeys = ['fontName', 'fontSize', 'tracking', 'leading'] as const;
            issues.push(...unexpectedArgumentKeys(args, ['layerId', ...styleKeys])
                .map((key) => `unsupported_argument:${key}`));
            if (!styleKeys.some((key) => hasOwn(args, key))) issues.push('text_style_patch_required');
            if (hasOwn(args, 'fontName') && !cleanText(args.fontName)) issues.push('font_name_invalid');
            if (hasOwn(args, 'fontSize')
                && (!isFiniteNumber(args.fontSize) || Number(args.fontSize) <= 0 || Number(args.fontSize) > 1296)) {
                issues.push('font_size_invalid');
            }
            if (hasOwn(args, 'tracking')
                && (!isFiniteNumber(args.tracking) || Number(args.tracking) < -1000 || Number(args.tracking) > 1000)) {
                issues.push('tracking_invalid');
            }
            if (hasOwn(args, 'leading')
                && (!isFiniteNumber(args.leading) || Number(args.leading) <= 0)) {
                issues.push('leading_invalid');
            }
            break;
        }
    }
    return Array.from(new Set(issues));
}

function sameRevision(
    left: { documentId: number; historyStateId: number } | undefined,
    right: { documentId: number; historyStateId: number } | undefined
): boolean {
    return Boolean(left && right)
        && left!.documentId === right!.documentId
        && left!.historyStateId === right!.historyStateId;
}

export function compileRuntimeActionExecutionEnvelope(input: {
    declaration: RuntimeActionPlanDeclaration;
    reconciliation: RuntimeActionPlanReconciliation;
    session: RuntimeSession;
    providerCall: {
        id: string;
        name: string;
        arguments: unknown;
    };
    providerSchema?: RuntimeActionProviderSchema;
    activeCapabilityRefs: readonly string[];
    preflight: AgentToolExecutionPreflight;
    now?: string;
}): RuntimeActionExecutionCompileDecision {
    const action = readCertifiedAction(input.providerCall.name);
    if (!action) {
        if (isCertifiedProviderName(input.providerCall.name)) {
            return buildDecision({
                status: 'blocked',
                allowed: false,
                code: 'runtime_action_execution_pack_integrity_invalid',
                reason: 'V0 provider 的一对一叶子 Capability 映射缺失或发生漂移，已拒绝降级绕过。'
            });
        }
        return buildDecision({
            status: 'not_applicable',
            allowed: true,
            code: 'runtime_action_execution_not_pack_scoped',
            reason: '当前 provider 不属于 V0 可执行能力包，保持既有执行路径。'
        });
    }
    const declaredSteps = input.declaration.payload.steps.filter((step) => (
        step.kind === 'mutate' && step.capabilityRefs.includes(action.capabilityRef)
    ));
    if (declaredSteps.length === 0) {
        return buildDecision({
            status: 'not_applicable',
            allowed: true,
            code: 'runtime_action_execution_not_pack_scoped',
            reason: '当前 R4 没有显式选择该 provider 的一对一叶子 Capability，保持既有执行路径。'
        });
    }
    if (input.declaration.readiness !== 'ready'
        || input.reconciliation.planReadiness !== 'ready') {
        return buildDecision({
            status: 'blocked',
            allowed: false,
            code: 'runtime_action_execution_plan_not_ready',
            reason: 'R4 计划尚未 ready，不能编译 V0 执行节点。'
        });
    }
    if (!input.activeCapabilityRefs.includes(action.capabilityRef)) {
        return buildDecision({
            status: 'blocked',
            allowed: false,
            code: 'runtime_action_execution_capability_inactive',
            reason: `叶子 Capability ${action.capabilityRef} 尚未在当前 Capability Session 激活。`
        });
    }
    const reconciliationByStepId = new Map(
        input.reconciliation.steps.map((step) => [step.stepId, step])
    );
    const readySteps = declaredSteps.filter((step) => (
        reconciliationByStepId.get(step.stepId)?.status === 'ready'
    ));
    if (readySteps.length !== 1) {
        return buildDecision({
            status: 'blocked',
            allowed: false,
            code: 'runtime_action_execution_node_not_unique',
            reason: `当前 provider 对应 ${readySteps.length} 个 ready R4 节点；必须唯一后才能执行。`
        });
    }
    const step = readySteps[0];
    const taskRun = input.session.taskRun;
    const node = taskRun.nodes.find((candidate) => candidate.nodeId === step.stepId);
    if (taskRun.status !== 'active'
        || !taskRun.planFingerprint
        || taskRun.planRevision < 1
        || !node) {
        return buildDecision({
            status: 'blocked',
            allowed: false,
            code: 'runtime_action_execution_task_run_mismatch',
            reason: '当前 TaskRun 未绑定同一份 ready R4 计划。'
        });
    }
    if (taskRun.currentNodeId !== step.stepId || node.status !== 'ready') {
        return buildDecision({
            status: 'blocked',
            allowed: false,
            code: 'runtime_action_execution_node_not_current',
            reason: '该 R4 节点不是 TaskRun 当前唯一 ready 节点，禁止越序或重复派发。'
        });
    }
    if (!input.providerSchema || input.providerSchema.name !== action.providerName) {
        return buildDecision({
            status: 'blocked',
            allowed: false,
            code: 'runtime_action_execution_provider_schema_missing',
            reason: '当前 provider 没有与本轮 Tool surface 绑定的 schema。'
        });
    }
    if (!isRecord(input.providerCall.arguments)) {
        return buildDecision({
            status: 'blocked',
            allowed: false,
            code: 'runtime_action_execution_arguments_invalid',
            reason: 'provider 参数必须是对象。'
        });
    }
    const argumentIssues = [
        ...validateProviderSchemaArguments({
            providerSchema: input.providerSchema,
            arguments: input.providerCall.arguments
        }),
        ...validateCertifiedProviderArguments(action.providerName, input.providerCall.arguments)
    ];
    if (argumentIssues.length > 0) {
        return buildDecision({
            status: 'blocked',
            allowed: false,
            code: 'runtime_action_execution_arguments_invalid',
            reason: `provider 参数未通过 V0 认证约束：${Array.from(new Set(argumentIssues)).join(', ')}`
        });
    }
    if (input.preflight.status !== 'ready' || input.preflight.ready !== true) {
        return buildDecision({
            status: 'blocked',
            allowed: false,
            code: 'runtime_action_execution_preflight_not_ready',
            reason: '真实 Tool preflight 尚未 ready。'
        });
    }
    const targetGuard = input.preflight.preconditions.targetGuard;
    const expectedRevision = targetGuard?.expectedHistoryStateRef;
    if (!targetGuard || !expectedRevision) {
        return buildDecision({
            status: 'blocked',
            allowed: false,
            code: 'runtime_action_execution_target_revision_missing',
            reason: 'V0 mutation 必须绑定 preflight 读取到的 documentId 与 historyStateId。'
        });
    }
    const taskRunRevision = taskRun.documentBinding?.expectedRevision;
    if (taskRun.documentBinding?.status === 'conflict'
        || taskRun.documentBinding?.status === 'needs_reobserve'
        || !sameRevision(taskRunRevision, expectedRevision)
        || targetGuard.expectedDocumentId !== expectedRevision.documentId) {
        return buildDecision({
            status: 'blocked',
            allowed: false,
            code: 'runtime_action_execution_target_revision_mismatch',
            reason: 'preflight 目标 revision 与 TaskRun 当前观察不一致，必须重新观察后再规划。'
        });
    }
    const argumentFingerprint = computeFastFingerprint({
        providerName: action.providerName,
        arguments: input.providerCall.arguments
    });
    const envelopeId = `r4exec-${computeFastFingerprint({
        taskRunId: taskRun.taskRunId,
        runId: input.session.identity.runId,
        planRevision: taskRun.planRevision,
        nodeId: step.stepId,
        capabilityRef: action.capabilityRef,
        providerCallId: input.providerCall.id,
        argumentFingerprint,
        expectedRevision
    })}`;
    return buildDecision({
        status: 'compiled',
        allowed: true,
        code: 'runtime_action_execution_compiled',
        reason: 'V0 R4 节点已绑定到当前 TaskRun、Capability、provider、参数与目标 revision。',
        envelope: {
            version: RUNTIME_ACTION_EXECUTION_ENVELOPE_VERSION,
            envelopeId,
            packVersion: RUNTIME_ACTION_EXECUTION_PACK_VERSION,
            packId: PHOTOSHOP_MUTATION_V0_PACK_ID,
            taskRunId: taskRun.taskRunId,
            runId: input.session.identity.runId,
            planRevision: taskRun.planRevision,
            planFingerprint: taskRun.planFingerprint,
            nodeId: step.stepId,
            capabilityRef: action.capabilityRef,
            providerName: action.providerName,
            providerCallId: input.providerCall.id,
            argumentFingerprint,
            target: {
                documentId: expectedRevision.documentId,
                historyStateId: expectedRevision.historyStateId,
                observationTool: targetGuard.observationTool
            },
            compiledAt: cleanText(input.now) || new Date().toISOString(),
            boundaries: {
                compiledFromModelToolCall: true,
                bindsExistingTaskRunNode: true,
                bindsActiveCapability: true,
                bindsSchemaCheckedArguments: true,
                bindsPreflightTargetRevision: true,
                requiresIndependentRuntimeGate: true,
                executionOwner: 'PhotoshopTransactionRunner',
                categoryNeutral: true,
                executesTools: false,
                grantsPermission: false,
                schedulerAuthority: false,
                countsAsTaskProgress: false,
                countsAsQualityPass: false
            }
        }
    });
}
