/**
 * 通用设计 Runtime Manifest。
 *
 * 该 manifest 只在 R0 模型路由已结构化声明 design.generic.v1 时启用，并在
 * Runtime / CapabilitySession 创建前完成选择；循环中的 declareDesignIntent 只记录选择，
 * 不切换本轮会话。它不是可执行的专用业务 Skill，不匹配用户文本，也不代表固定品类；
 * schema 中的 skill_id 只是现有 Runtime 契约身份。available_tools 是首轮能力种子，
 * Planner 仍可通过 Capability Resolver 的紧凑 inventory 按需加载其它 Tool / Skill。
 */

import type { SkillRuntimeManifest } from '../contracts';
import {
    DESIGN_ART_DIRECTION_KNOWLEDGE_ID,
    DESIGN_CONTENT_STRATEGY_KNOWLEDGE_ID,
    DESIGN_LAYOUT_PLANNING_KNOWLEDGE_ID
} from '../design-method-knowledge';
import {
    GENERAL_DESIGN_EVALUATION_PROFILE_ID,
    GENERAL_DESIGN_SCOPED_EDIT_EVALUATION_PROFILE_ID
} from '../design-evaluation-profiles';
import {
    buildScopedEditPerformanceProfile,
    SCOPED_EDIT_CAPABILITY_CEILING,
    SCOPED_EDIT_INITIAL_CAPABILITY_IDS
} from '../scoped-edit-runtime-policy';

export const GENERAL_DESIGN_MANIFEST: SkillRuntimeManifest = {
    skill_id: 'design.general',
    version: '0.1.0',
    task_type: 'design.generic.v1',
    display_name: '通用视觉设计',
    // 开放创意路径：不建 Stage 机、不以声明作写入门票（设计路径宪法）。runtime_stages 仅在
    // 显式选择 staged 执行模型时才生效，这里保留是为了 manifest 结构完整与历史对照。
    execution_model: 'agentic',
    legacy_skill_ids: [],
    required_inputs: ['goal'],
    optional_inputs: ['asset_source', 'canvas_size', 'brand_style', 'target_user'],
    input_sources: {
        goal: ['user_goal'],
        asset_source: ['structured_input', 'attached_image', 'project_asset'],
        canvas_size: ['structured_input', 'photoshop_document'],
        brand_style: ['structured_input', 'project_context'],
        target_user: ['structured_input', 'project_context'],
        existing_document: ['photoshop_document'],
        redesign_goal: ['user_goal', 'structured_input'],
        target_scope: ['structured_input', 'photoshop_target'],
        requested_change: ['user_goal', 'structured_input']
    },
    performance_profile: {
        version: 'skill-runtime-performance-profile/v0',
        budget: {
            max_model_calls: 24,
            max_tool_calls: 120,
            max_iterations: 60,
            max_vision_candidates: 6,
            max_visual_analyses: 3,
            max_full_resolution_image_reads: 0,
            soft_time_budget_ms: 600_000
        },
        verification_tier: 'manual',
        cost_profile: {
            model_call_class: 'vision-light',
            photoshop_tool_class: 'write-heavy',
            image_processing_class: 'bounded-vision',
            expected_latency: 'long',
            resource_risk: 'high'
        },
        vision_policy: 'bounded'
    },
    work_mode_contracts: {
        create_new: {
            required_inputs: ['goal'],
            optional_inputs: ['asset_source', 'canvas_size', 'brand_style', 'target_user'],
            delivery_outputs: ['editable_design_document', 'preview', 'delivery_record'],
            production_obligation: 'photoshop_mutation_with_readback',
            review_rubric_ref: GENERAL_DESIGN_EVALUATION_PROFILE_ID,
            exit_criteria: [
                '设计目标与约束有可追溯记录',
                '写入后已完成结构读回与同一历史状态的视觉复核',
                '通用设计 Evaluation Profile 通过或形成下一轮 Reflexion 约束'
            ]
        },
        redesign: {
            required_inputs: ['existing_document', 'redesign_goal'],
            optional_inputs: ['asset_source', 'brand_style', 'target_user'],
            delivery_outputs: ['updated_design_document', 'preview', 'redesign_report'],
            production_obligation: 'photoshop_mutation_with_readback',
            review_rubric_ref: GENERAL_DESIGN_EVALUATION_PROFILE_ID,
            exit_criteria: [
                '重设计方向已形成并落实到当前设计文档',
                '最后一次写入后完成结构读回与视觉复核',
                '通用设计 Evaluation Profile 通过或形成下一轮定向修订约束'
            ]
        },
        edit_existing: {
            required_inputs: ['existing_document', 'target_scope', 'requested_change'],
            optional_inputs: ['brand_style'],
            delivery_outputs: ['updated_design_document', 'change_verification_report'],
            production_obligation: 'photoshop_mutation_with_readback',
            review_rubric_ref: GENERAL_DESIGN_SCOPED_EDIT_EVALUATION_PROFILE_ID,
            runtime_stages: ['R0', 'R1', 'R2', 'E1', 'R5'],
            execution_scope_kind: 'exact_text_replacement',
            initial_capabilities: [...SCOPED_EDIT_INITIAL_CAPABILITY_IDS],
            capability_ceiling: [...SCOPED_EDIT_CAPABILITY_CEILING],
            performance_profile: buildScopedEditPerformanceProfile(),
            exit_criteria: [
                '用户要求的局部修改已在显式目标范围内完成',
                '修改后已读回目标属性、图层结构或必要的目标区域画面',
                '未发现无关图层或画布区域被意外改动'
            ]
        }
    },
    runtime_stages: ['R0', 'R1', 'R2', 'R3', 'R4', 'E1', 'R5', 'E2'],
    required_model_profiles: ['reasoning.default'],
    optional_model_profiles: ['vision.reference', 'review.strict'],
    read_scopes: ['brief', 'assets', 'visual_direction', 'layout_plan', 'photoshop'],
    write_scopes: ['brief', 'layout_plan', 'review', 'delivery'],
    tool_namespaces: [
        'agent.',
        'project.',
        'knowledge.',
        'memory.',
        'eagle.read.',
        'preview.',
        'photoshop.read.',
        'photoshop.sandbox.',
        'photoshop.write.',
        'delivery.'
    ],
    available_tools: [
        'agent.interaction.requestConfirmation',
        'project.listResources',
        'project.searchResources',
        'memory.designProjectState',
        'eagle.read.searchReferences',
        'eagle.read.analyzeReference',
        'eagle.read.observeAsset',
        'photoshop.read.getDocumentSummary'
    ],
    forbidden_tools: [
        'photoshop.apply.overwriteCurrentDocument',
        'photoshop.raw.batchPlay'
    ],
    knowledge_refs: [
        DESIGN_CONTENT_STRATEGY_KNOWLEDGE_ID,
        DESIGN_ART_DIRECTION_KNOWLEDGE_ID,
        DESIGN_LAYOUT_PLANNING_KNOWLEDGE_ID,
        'tool:getDesignPrinciples',
        'tool:searchDesignKnowledge',
        'tool:searchEagleReferences'
    ],
    memory_refs: ['design-project-state/v0'],
    evaluation_refs: [
        'design-quality-verdict/v0',
        GENERAL_DESIGN_EVALUATION_PROFILE_ID,
        GENERAL_DESIGN_SCOPED_EDIT_EVALUATION_PROFILE_ID
    ],
    policy_refs: [
        'agent-tool-decision-contract/v0',
        'design-discipline-runtime/v0',
        'tool-safety-policy/v0'
    ],
    review_rubric_ref: GENERAL_DESIGN_EVALUATION_PROFILE_ID,
    delivery_outputs: ['editable_design_document', 'preview', 'delivery_record'],
    exit_criteria: [
        '设计目标与约束有可追溯记录',
        '写入后已完成结构读回或画面观察',
        '质量裁决通过或形成下一轮 Reflexion 约束'
    ]
};
