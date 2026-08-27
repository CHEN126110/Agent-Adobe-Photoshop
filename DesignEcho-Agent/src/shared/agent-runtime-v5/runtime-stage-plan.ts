/**
 * Runtime stage plan
 *
 * R0 选择 Skill 后必须形成阶段计划。该计划描述每个 runtime stage 的目标、
 * 预期结果和失败去向；它不声明旧 executable tool schema 名，避免 Skill / Tool 耦合。
 */

import type {
    RuntimeDesignWorkMode,
    RuntimeComponentId,
    RuntimeStage,
    SkillRuntimeDeliveryOutputBinding,
    SkillRuntimeManifest,
    SkillRuntimeInputSourceMap,
    SkillRuntimeProductionObligation,
    SkillRuntimeReferencePolicy,
    SkillRuntimeWorkModeContract
} from './contracts';
import {
    listSkillRuntimeWorkModeInputKeys,
    normalizeRuntimeDesignWorkMode,
    resolveSkillRuntimeCapabilityCeiling,
    resolveSkillRuntimeEffectiveContract
} from './skill-runtime';
import {
    isAgentInputCollectionTool,
    isReadOnlyAgentContextTool,
    type AgentToolExecutionKind
} from '../agent-tool-execution-preflight';

export type RuntimeStageFailureTarget = 'continue_react' | 'reflexion';

export interface RuntimeStagePlanStep {
    stage: RuntimeStage;
    owner: RuntimeComponentId;
    objective: string;
    requiredOutcomes: string[];
    allowedToolCapabilities: string[];
    failureTarget: RuntimeStageFailureTarget;
}

export interface RuntimeStagePlan {
    version: 'runtime-stage-plan/v0';
    skillId: string;
    taskType: string;
    displayName?: string;
    /** R1 输入真相源；直接复制 manifest，不由 Agent 文本推断。 */
    requiredInputs: string[];
    optionalInputs: string[];
    /** R1 inputKey 与实际输入来源类型的兼容性；直接复制 manifest。 */
    inputSources: SkillRuntimeInputSourceMap;
    /** 原样复制 Manifest 的 Skill-owned 参考策略；Agent 不按品类或文本补造。 */
    referencePolicy?: SkillRuntimeReferencePolicy;
    /** R1 workMode 声明后的完整替换契约；不与顶层默认字段隐式合并。 */
    workModeContracts?: Partial<Record<RuntimeDesignWorkMode, SkillRuntimeWorkModeContract>>;
    /** 上游结构化选择的模式；R1 只能确认，不能改写。 */
    expectedWorkMode?: RuntimeDesignWorkMode;
    /** E2 交付要求真相源；直接复制 manifest，由结构化收据逐项满足。 */
    deliveryOutputs: string[];
    /** 原子 save/export 只有命中此 Manifest 绑定并形成可核对结果时，才可参与 E2 收据。 */
    deliveryOutputBindings?: Record<string, SkillRuntimeDeliveryOutputBinding>;
    deliveryPlanBindingRequired?: boolean;
    productionObligation?: SkillRuntimeProductionObligation;
    /** 默认评价标准；workMode 可通过完整替换契约选择更窄的 Profile。 */
    reviewRubricRef?: string;
    steps: RuntimeStagePlanStep[];
    onDemandCapabilityExpansionAllowed: true;
    exitCriteria: string[];
}

export interface RuntimeStagePlanEffectiveContract {
    source: 'manifest-default' | 'work-mode-contract';
    workMode?: RuntimeDesignWorkMode;
    requiredInputs: string[];
    optionalInputs: string[];
    deliveryOutputs: string[];
    deliveryOutputBindings?: Record<string, SkillRuntimeDeliveryOutputBinding>;
    deliveryPlanBindingRequired?: boolean;
    productionObligation?: SkillRuntimeProductionObligation;
    exitCriteria: string[];
    reviewRubricRef?: string;
    executionScopeKind?: 'exact_text_replacement';
    initialCapabilities?: string[];
    capabilityCeiling?: string[];
}

/**
 * 用户附件只能替代“参考图输入”的 R2 视觉观察。
 * 普通设计、主图和详情页即使带了商品素材，也仍需观察项目与目标画布，不能借附件越过 R2。
 */
export function canAttachedImageObservationSatisfyRuntimeR2(
    plan: Pick<RuntimeStagePlan, 'requiredInputs'> | undefined
): boolean {
    return Boolean(plan?.requiredInputs.some(
        (inputKey) => String(inputKey || '').trim().toLowerCase() === 'reference_image'
    ));
}

/**
 * 该设计任务是否「必须先有一份已打开的 Photoshop 文档」——即当前 workMode 的有效契约里
 * 有任一「必需输入」只能来源于 photoshop_document。
 * edit_existing / redesign / analyze_only / export_only（required existing_document → photoshop_document）→ true；
 * create_new / template_fill / 无 work_mode 的创意清单（主图/海报/参考复刻）→ false。
 * 用途：无文档（getDocumentInfo 返回 documentState:'absent'）时据此区分——需文档任务应如实失败（先观察既有文档），
 * 从零任务可把「已确认空画布起点」当成合法 R2 观察、继续推进到 E1 建画布。纯数据判定，category-neutral、无关键词。
 */
export function runtimeDesignTaskRequiresOpenDocument(
    plan: Pick<RuntimeStagePlan, 'requiredInputs' | 'inputSources' | 'workModeContracts'> | undefined,
    workMode?: RuntimeDesignWorkMode
): boolean {
    if (!plan) return false;
    const inputSources = plan.inputSources || {};
    const workModeContract = workMode ? plan.workModeContracts?.[workMode] : undefined;
    const requiredInputs = workModeContract?.required_inputs || plan.requiredInputs || [];
    return requiredInputs.some((key) => {
        const sources = inputSources[key] || [];
        return sources.length > 0 && sources.every((source) => source === 'photoshop_document');
    });
}

const STAGE_OBJECTIVES: Readonly<Record<RuntimeStage, {
    owner: RuntimeComponentId;
    objective: string;
    requiredOutcomes: readonly string[];
    failureTarget: RuntimeStageFailureTarget;
}>> = Object.freeze({
    R0: {
        owner: 'R0',
        objective: '选择 Skill 并制定阶段计划。',
        requiredOutcomes: ['skill_manifest_selected', 'stage_plan_created'],
        failureTarget: 'reflexion'
    },
    R1: {
        owner: 'R1',
        objective: '检查必需输入；环境事实先读取，仅在不可用、失败、已穷尽或仍有歧义时询问用户。',
        requiredOutcomes: ['required_inputs_checked', 'blocking_inputs_identified'],
        failureTarget: 'continue_react'
    },
    R2: {
        owner: 'R2',
        objective: '观察项目上下文、素材和当前画面，形成当前阶段事实。',
        requiredOutcomes: ['project_context_observed', 'visual_or_readback_observation'],
        failureTarget: 'continue_react'
    },
    R3: {
        owner: 'R3',
        objective: '制定设计策略、信息层级和当前阶段处理方向。',
        requiredOutcomes: ['design_strategy_recorded', 'stage_goal_defined'],
        failureTarget: 'continue_react'
    },
    R4: {
        owner: 'R4',
        objective: '生成可执行的预览、版式或 Photoshop 行动计划。',
        requiredOutcomes: ['preview_or_action_plan', 'stage_output_candidate'],
        failureTarget: 'continue_react'
    },
    E1: {
        owner: 'E1',
        objective: '调用当前已装载且未被 manifest 禁止的视觉分析、预览或 Photoshop 工具推进设计。',
        requiredOutcomes: ['tool_action_result', 'tool_observation_recorded'],
        failureTarget: 'continue_react'
    },
    R5: {
        owner: 'R5',
        objective: '执行 Quality Gate，判断当前阶段是否达到目标。',
        requiredOutcomes: ['quality_gate_report', 'stage_evaluation'],
        failureTarget: 'reflexion'
    },
    E2: {
        owner: 'E2',
        objective: '在通过 Quality Gate 和用户确认后进行交付或记录。',
        requiredOutcomes: ['user_confirmation_or_delivery_record'],
        failureTarget: 'reflexion'
    }
});

/**
 * R1 / R3 只需要收集和理解上下文，不需要提前暴露执行、导出或业务 Skill schema。
 * 这些是跨品类的 Capability id，由 Capability→Tool bridge 决定具体 provider。
 */
export const RUNTIME_PLANNING_CONTEXT_CAPABILITIES: readonly string[] = Object.freeze([
    'agent.interaction.requestConfirmation',
    'agent.intent.declareDesignTask',
    'project.listResources',
    'project.searchResources',
    'project.observeAssets',
    'knowledge.read.designFoundation',
    'eagle.read.searchReferences',
    'eagle.read.analyzeReference',
    'memory.designProjectState',
    'photoshop.read.getDocumentSummary',
    'photoshop.read.getVisualSnapshot',
    'photoshop.read.inspectLayers'
]);

/**
 * 建画布启动动作（canvas bootstrap）：唯一被允许在执行阶段之前发生的写入。
 * 三个条件同时成立才算数——
 *   1) 工具就是 createDocument（不放行任何其它写工具）；
 *   2) 当前确实没有打开的文档（hasOpenDocument === false，不是"未知"）；
 *   3) 该任务不需要已打开文档（从零设计；edit_existing/redesign 等一律排除）。
 * 安全论证：没有任何已打开文档时新建画布不可能破坏用户既有工作（无对象可破坏），它是"开始工作"
 * 而非"编辑写入"；且 createDocument 早已登记为无需前置文档读取的写入特例（agent-tool-execution-preflight）。
 * 不满足三条中任何一条 → 回到原规则：写入只在 E1。
 */
export function isCanvasBootstrapAction(input: {
    toolName: string;
    hasOpenDocument?: boolean;
    taskRequiresOpenDocument?: boolean;
}): boolean {
    return String(input.toolName || '').trim() === 'createDocument'
        && input.hasOpenDocument === false
        && input.taskRequiresOpenDocument === false;
}

/**
 * 从零设计在 R4 的“首稿上画布”schema 启动口。
 *
 * 此函数只控制模型能否看见 renderLayout，不授予执行权：真正调用仍由
 * evaluateRuntimeSessionToolExecutionGate 要求已通过 R4、进入 E1。
 */
export function isCanvasDraftBootstrapAction(input: {
    stage: RuntimeStage;
    toolName: string;
    hasOpenDocument?: boolean;
    taskRequiresOpenDocument?: boolean;
}): boolean {
    return input.stage === 'R4'
        && String(input.toolName || '').trim() === 'renderLayout'
        && input.hasOpenDocument === false
        && input.taskRequiresOpenDocument === false;
}

export function isRuntimeStageToolVisible(input: {
    stage: RuntimeStage;
    toolName: string;
    toolKind: AgentToolExecutionKind;
    harnessControl: boolean;
    hasOpenDocument?: boolean;
    taskRequiresOpenDocument?: boolean;
}): boolean {
    if (input.harnessControl) return true;
    if (input.toolKind === 'unknown') return false;
    if (input.stage === 'E1') return true;
    // 从零设计在没有画布时，必须能先把画布建出来，否则观察阶段永远等不到可观察对象，
    // 模型即使知道该建画布也调不到工具（真机：反复读文档→无进展停机）。
    if (isCanvasBootstrapAction(input)) return true;
    // R4 同时投影首稿 provider schema；计划声明先执行并把 Session 推进 E1 后，
    // 同一模型响应中的后续 renderLayout 才会通过真正的执行门禁。
    if (isCanvasDraftBootstrapAction(input)) return true;
    if (input.stage === 'E2') {
        return input.toolKind === 'save_export'
            || input.toolKind === 'read_only_observation'
            || input.toolKind === 'knowledge_search'
            || isReadOnlyAgentContextTool(input.toolName);
    }
    if (input.stage === 'R1'
        || input.stage === 'R2'
        || input.stage === 'R3'
        || input.stage === 'R4'
        || input.stage === 'R5') {
        return input.toolKind === 'read_only_observation'
            || input.toolKind === 'knowledge_search'
            || isAgentInputCollectionTool(input.toolName)
            || isReadOnlyAgentContextTool(input.toolName);
    }
    return false;
}

function unique(values: readonly string[]): string[] {
    return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function copyInputSources(input: SkillRuntimeInputSourceMap): SkillRuntimeInputSourceMap {
    return Object.fromEntries(Object.entries(input).map(([inputKey, sourceKinds]) => [
        inputKey,
        Array.from(new Set(sourceKinds))
    ]));
}

function copyWorkModeContracts(
    contracts?: Partial<Record<RuntimeDesignWorkMode, SkillRuntimeWorkModeContract>>
): Partial<Record<RuntimeDesignWorkMode, SkillRuntimeWorkModeContract>> | undefined {
    if (!contracts) return undefined;
    return Object.fromEntries(Object.entries(contracts).map(([workMode, contract]) => [
        workMode,
        contract
            ? {
                required_inputs: [...contract.required_inputs],
                optional_inputs: [...contract.optional_inputs],
                delivery_outputs: [...contract.delivery_outputs],
                ...(contract.delivery_output_bindings
                    ? {
                        delivery_output_bindings: Object.fromEntries(
                            Object.entries(contract.delivery_output_bindings).map(([outputRef, binding]) => [
                                outputRef,
                                {
                                    ...binding,
                                    capability_refs: [...binding.capability_refs]
                                }
                            ])
                        )
                    }
                    : {}),
                ...(contract.production_obligation
                    ? { production_obligation: contract.production_obligation }
                    : {}),
                ...(contract.delivery_plan_binding_required === true
                    ? { delivery_plan_binding_required: true }
                    : {}),
                exit_criteria: [...contract.exit_criteria],
                ...(contract.review_rubric_ref ? { review_rubric_ref: contract.review_rubric_ref } : {}),
                ...(contract.performance_profile
                    ? {
                        performance_profile: {
                            ...contract.performance_profile,
                            budget: { ...contract.performance_profile.budget },
                            cost_profile: { ...contract.performance_profile.cost_profile }
                        }
                    }
                    : {}),
                ...(contract.runtime_stages
                    ? { runtime_stages: [...contract.runtime_stages] }
                    : {}),
                ...(contract.execution_scope_kind
                    ? { execution_scope_kind: contract.execution_scope_kind }
                    : {}),
                ...(contract.initial_capabilities
                    ? { initial_capabilities: [...contract.initial_capabilities] }
                    : {}),
                ...(contract.capability_ceiling
                    ? { capability_ceiling: [...contract.capability_ceiling] }
                    : {})
            }
            : contract
    ])) as Partial<Record<RuntimeDesignWorkMode, SkillRuntimeWorkModeContract>>;
}

export function resolveRuntimeStagePlanEffectiveContract(
    plan: RuntimeStagePlan | undefined,
    workMode?: unknown
): RuntimeStagePlanEffectiveContract | undefined {
    if (!plan) return undefined;
    const normalizedWorkMode = plan.expectedWorkMode || normalizeRuntimeDesignWorkMode(workMode);
    const modeContract = normalizedWorkMode
        ? plan.workModeContracts?.[normalizedWorkMode]
        : undefined;
    if (modeContract) {
        return {
            source: 'work-mode-contract',
            workMode: normalizedWorkMode,
            requiredInputs: [...modeContract.required_inputs],
            optionalInputs: [...modeContract.optional_inputs],
            deliveryOutputs: [...modeContract.delivery_outputs],
            ...(modeContract.delivery_output_bindings
                ? {
                    deliveryOutputBindings: Object.fromEntries(
                        Object.entries(modeContract.delivery_output_bindings).map(([outputRef, binding]) => [
                            outputRef,
                            {
                                ...binding,
                                capability_refs: [...binding.capability_refs]
                            }
                        ])
                    )
                }
                : {}),
            ...(modeContract.production_obligation
                ? { productionObligation: modeContract.production_obligation }
                : {}),
            ...(modeContract.delivery_plan_binding_required === true
                ? { deliveryPlanBindingRequired: true }
                : {}),
            exitCriteria: [...modeContract.exit_criteria],
            ...(modeContract.review_rubric_ref ? { reviewRubricRef: modeContract.review_rubric_ref } : {}),
            ...(modeContract.execution_scope_kind
                ? { executionScopeKind: modeContract.execution_scope_kind }
                : {}),
            ...(modeContract.initial_capabilities
                ? { initialCapabilities: [...modeContract.initial_capabilities] }
                : {}),
            ...(modeContract.capability_ceiling
                ? { capabilityCeiling: [...modeContract.capability_ceiling] }
                : {})
        };
    }
    return {
        source: 'manifest-default',
        ...(normalizedWorkMode ? { workMode: normalizedWorkMode } : {}),
        requiredInputs: [...plan.requiredInputs],
        optionalInputs: [...plan.optionalInputs],
        deliveryOutputs: [...plan.deliveryOutputs],
        ...(plan.deliveryOutputBindings
            ? {
                deliveryOutputBindings: Object.fromEntries(
                    Object.entries(plan.deliveryOutputBindings).map(([outputRef, binding]) => [
                        outputRef,
                        {
                            ...binding,
                            capability_refs: [...binding.capability_refs]
                        }
                    ])
                )
            }
            : {}),
        ...(plan.productionObligation
            ? { productionObligation: plan.productionObligation }
            : {}),
        ...(plan.deliveryPlanBindingRequired === true
            ? { deliveryPlanBindingRequired: true }
            : {}),
        exitCriteria: [...plan.exitCriteria],
        ...(plan.reviewRubricRef ? { reviewRubricRef: plan.reviewRubricRef } : {})
    };
}

function isContextCapability(capabilityId: string): boolean {
    return capabilityId.startsWith('agent.interaction.')
        || capabilityId.startsWith('agent.intent.')
        || capabilityId.startsWith('project.')
        || capabilityId.startsWith('knowledge.')
        || capabilityId.startsWith('memory.')
        || capabilityId.startsWith('eagle.read.')
        || capabilityId.startsWith('photoshop.read.');
}

function capabilitiesForStage(
    manifest: SkillRuntimeManifest,
    stage: RuntimeStage,
    expectedWorkMode?: RuntimeDesignWorkMode
): string[] {
    const capabilityCeiling = resolveSkillRuntimeCapabilityCeiling(manifest, expectedWorkMode);
    const ceilingSet = capabilityCeiling ? new Set(capabilityCeiling) : undefined;
    const allowedManifestCapabilities = capabilityCeiling || manifest.available_tools;
    const planningCapabilities = ceilingSet
        ? RUNTIME_PLANNING_CONTEXT_CAPABILITIES.filter((capabilityId) => ceilingSet.has(capabilityId))
        : [...RUNTIME_PLANNING_CONTEXT_CAPABILITIES];
    if (stage === 'R1' || stage === 'R3') {
        return planningCapabilities;
    }
    if (stage === 'R2') {
        return unique([
            ...planningCapabilities,
            ...allowedManifestCapabilities.filter(isContextCapability)
        ]);
    }
    if (stage === 'R4') {
        return unique([
            ...planningCapabilities,
            ...allowedManifestCapabilities.filter(isContextCapability),
            // 只负责在 R4 投影首稿 provider；是否执行仍由 Runtime Session E1 门禁裁决。
            ...(ceilingSet && !ceilingSet.has('preview.renderStoryboard')
                ? []
                : ['preview.renderStoryboard'])
        ]);
    }
    if (stage === 'E1') {
        return unique(allowedManifestCapabilities);
    }
    if (stage === 'R5') {
        return unique(allowedManifestCapabilities.filter(isContextCapability));
    }
    if (stage === 'E2') {
        return unique(allowedManifestCapabilities.filter((tool) => tool.startsWith('delivery.')));
    }
    return [];
}

export function buildRuntimeStagePlan(
    manifest: SkillRuntimeManifest,
    expectedWorkMode?: RuntimeDesignWorkMode
): RuntimeStagePlan {
    const defaultContract = resolveSkillRuntimeEffectiveContract(manifest);
    const allInputKeys = listSkillRuntimeWorkModeInputKeys(manifest);
    const effectiveRuntimeStages = expectedWorkMode
        ? manifest.work_mode_contracts?.[expectedWorkMode]?.runtime_stages
            || manifest.runtime_stages
        : manifest.runtime_stages;
    return {
        version: 'runtime-stage-plan/v0',
        skillId: manifest.skill_id,
        taskType: manifest.task_type,
        ...(manifest.display_name ? { displayName: manifest.display_name } : {}),
        ...(expectedWorkMode ? { expectedWorkMode } : {}),
        requiredInputs: unique(defaultContract.required_inputs),
        optionalInputs: unique(allInputKeys.filter((key) => !defaultContract.required_inputs.includes(key))),
        inputSources: copyInputSources(manifest.input_sources),
        deliveryOutputs: unique(defaultContract.delivery_outputs),
        ...(defaultContract.delivery_output_bindings
            ? {
                deliveryOutputBindings: Object.fromEntries(
                    Object.entries(defaultContract.delivery_output_bindings).map(([outputRef, binding]) => [
                        outputRef,
                        {
                            ...binding,
                            capability_refs: [...binding.capability_refs]
                        }
                    ])
                )
            }
            : {}),
        ...(defaultContract.production_obligation
            ? { productionObligation: defaultContract.production_obligation }
            : {}),
        ...(defaultContract.delivery_plan_binding_required === true
            ? { deliveryPlanBindingRequired: true }
            : {}),
        ...(defaultContract.review_rubric_ref ? { reviewRubricRef: defaultContract.review_rubric_ref } : {}),
        ...(manifest.work_mode_contracts
            ? { workModeContracts: copyWorkModeContracts(manifest.work_mode_contracts) }
            : {}),
        ...(manifest.reference_policy
            ? {
                referencePolicy: {
                    ...manifest.reference_policy,
                    work_mode_requirements: { ...manifest.reference_policy.work_mode_requirements },
                    allowed_sources: [...manifest.reference_policy.allowed_sources]
                }
            }
            : {}),
        steps: effectiveRuntimeStages.map((stage) => {
            const definition = STAGE_OBJECTIVES[stage];
            return {
                stage,
                owner: definition.owner,
                objective: definition.objective,
                requiredOutcomes: stage === 'R2' && manifest.reference_policy
                    ? [...definition.requiredOutcomes, 'reference_context_resolved']
                    : [...definition.requiredOutcomes],
                allowedToolCapabilities: capabilitiesForStage(manifest, stage, expectedWorkMode),
                failureTarget: definition.failureTarget
            };
        }),
        onDemandCapabilityExpansionAllowed: true,
        exitCriteria: [...defaultContract.exit_criteria]
    };
}
