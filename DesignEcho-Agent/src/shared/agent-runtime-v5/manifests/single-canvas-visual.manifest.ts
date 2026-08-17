/**
 * 单画布视觉设计 Skill Manifest。
 *
 * 海报、活动 KV、社媒封面与 Banner 共享这组专业能力；具体 artifact_kind、渠道和尺寸
 * 由 Brief 决定。它不绑定 legacy executor，也不声明固定版式或 Photoshop 调用顺序。
 */

import type { SkillRuntimeManifest } from '../contracts';
import {
    DESIGN_ART_DIRECTION_KNOWLEDGE_ID,
    DESIGN_CONTENT_STRATEGY_KNOWLEDGE_ID,
    DESIGN_LAYOUT_PLANNING_KNOWLEDGE_ID,
    SINGLE_CANVAS_VISUAL_METHOD_KNOWLEDGE_ID
} from '../design-method-knowledge';
import {
    SINGLE_CANVAS_VISUAL_EVALUATION_PROFILE_ID,
    SINGLE_CANVAS_VISUAL_SCOPED_EDIT_EVALUATION_PROFILE_ID
} from '../design-evaluation-profiles';
import {
    buildScopedEditPerformanceProfile,
    SCOPED_EDIT_CAPABILITY_CEILING,
    SCOPED_EDIT_INITIAL_CAPABILITY_IDS
} from '../scoped-edit-runtime-policy';

export const SINGLE_CANVAS_VISUAL_MANIFEST: SkillRuntimeManifest = {
    skill_id: 'design.single_canvas_visual',
    version: '0.1.0',
    task_type: 'design.single_canvas_visual.v1',
    display_name: '单画布视觉设计',
    legacy_skill_ids: [],
    required_inputs: ['goal'],
    optional_inputs: [
        'content_source',
        'asset_source',
        'artifact_kind',
        'canvas_size',
        'brand_style',
        'audience',
        'channel',
        'must_include',
        'reference_source'
    ],
    input_sources: {
        goal: ['user_goal'],
        content_source: ['structured_input', 'user_goal', 'project_context'],
        asset_source: ['structured_input', 'attached_image', 'project_asset', 'selected_project_asset'],
        artifact_kind: ['structured_input', 'user_goal'],
        canvas_size: ['structured_input', 'photoshop_document'],
        brand_style: ['structured_input', 'project_context'],
        audience: ['structured_input', 'project_context'],
        channel: ['structured_input', 'project_context'],
        must_include: ['structured_input', 'user_goal', 'project_context'],
        reference_source: ['structured_input', 'attached_image', 'project_asset'],
        existing_document: ['photoshop_document'],
        redesign_goal: ['user_goal', 'structured_input'],
        target_scope: ['structured_input', 'photoshop_target'],
        requested_change: ['user_goal', 'structured_input']
    },
    performance_profile: {
        version: 'skill-runtime-performance-profile/v0',
        budget: {
            max_model_calls: 24,
            max_tool_calls: 100,
            max_iterations: 50,
            max_vision_candidates: 6,
            max_visual_analyses: 3,
            max_full_resolution_image_reads: 0,
            soft_time_budget_ms: 600_000
        },
        verification_tier: 'screenshot',
        cost_profile: {
            model_call_class: 'vision-light',
            photoshop_tool_class: 'write-heavy',
            image_processing_class: 'bounded-vision',
            expected_latency: 'long',
            resource_risk: 'medium'
        },
        vision_policy: 'bounded'
    },
    work_mode_contracts: {
        create_new: {
            required_inputs: ['goal'],
            optional_inputs: [
                'content_source',
                'asset_source',
                'artifact_kind',
                'canvas_size',
                'brand_style',
                'audience',
                'channel',
                'must_include',
                'reference_source'
            ],
            delivery_outputs: ['editable_single_canvas_document', 'design_preview', 'delivery_record'],
            production_obligation: 'photoshop_mutation_with_readback',
            review_rubric_ref: SINGLE_CANVAS_VISUAL_EVALUATION_PROFILE_ID,
            exit_criteria: [
                '单画布视觉目标、内容与画布约束有可追溯记录',
                '最后一次 Photoshop 写入后完成结构读回与同一历史状态的视觉复核',
                'Evaluation Profile 通过或形成下一轮 Reflexion 约束'
            ]
        },
        redesign: {
            required_inputs: ['existing_document', 'redesign_goal'],
            optional_inputs: ['content_source', 'asset_source', 'brand_style', 'audience', 'channel', 'must_include'],
            delivery_outputs: ['updated_single_canvas_document', 'design_preview', 'redesign_report'],
            production_obligation: 'photoshop_mutation_with_readback',
            review_rubric_ref: SINGLE_CANVAS_VISUAL_EVALUATION_PROFILE_ID,
            exit_criteria: [
                '重设计方向已形成并落实到当前单画布文档',
                '最后一次写入后完成结构读回与视觉复核',
                'Evaluation Profile 通过或形成下一轮定向修订约束'
            ]
        },
        edit_existing: {
            required_inputs: ['existing_document', 'target_scope', 'requested_change'],
            optional_inputs: ['brand_style'],
            delivery_outputs: ['updated_single_canvas_document', 'change_verification_report'],
            production_obligation: 'photoshop_mutation_with_readback',
            review_rubric_ref: SINGLE_CANVAS_VISUAL_SCOPED_EDIT_EVALUATION_PROFILE_ID,
            runtime_stages: ['R0', 'R1', 'R2', 'E1', 'R5'],
            execution_scope_kind: 'exact_text_replacement',
            initial_capabilities: [...SCOPED_EDIT_INITIAL_CAPABILITY_IDS],
            capability_ceiling: [...SCOPED_EDIT_CAPABILITY_CEILING],
            performance_profile: buildScopedEditPerformanceProfile(),
            exit_criteria: [
                '用户要求的单画布局部修改已在显式目标范围内完成',
                '修改后已读回目标属性、图层结构或必要的目标区域画面',
                '未发现无关图层或画布区域被意外改动'
            ]
        }
    },
    runtime_stages: ['R0', 'R1', 'R2', 'R3', 'R4', 'E1', 'R5', 'E2'],
    required_model_profiles: ['reasoning.default'],
    optional_model_profiles: ['vision.reference', 'review.strict'],
    read_scopes: [
        'brief',
        'assets',
        'visual_direction',
        'layout_plan',
        'photoshop'
    ],
    write_scopes: [
        'brief',
        'layout_plan',
        'preview_versions',
        'review',
        'delivery'
    ],
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
        'knowledge.read.designFoundation',
        'memory.designProjectState',
        'eagle.read.searchReferences',
        'eagle.read.analyzeReference',
        'eagle.read.observeAsset',
        'preview.renderStoryboard',
        'photoshop.read.getDocumentSummary',
        'photoshop.read.getVisualSnapshot',
        'photoshop.read.inspectLayers',
        'photoshop.read.getLayerBounds',
        'photoshop.sandbox.createDocument',
        'photoshop.sandbox.createScreenGroup',
        'photoshop.sandbox.createShape',
        'photoshop.sandbox.manageLayers',
        'photoshop.sandbox.editSmartObject',
        'photoshop.sandbox.placeImage',
        'photoshop.sandbox.transformLayer',
        'photoshop.sandbox.writeText',
        'delivery.exportAsset',
        'delivery.saveDocument'
    ],
    forbidden_tools: [
        'photoshop.apply.overwriteCurrentDocument',
        'photoshop.raw.batchPlay'
    ],
    knowledge_refs: [
        DESIGN_CONTENT_STRATEGY_KNOWLEDGE_ID,
        DESIGN_ART_DIRECTION_KNOWLEDGE_ID,
        DESIGN_LAYOUT_PLANNING_KNOWLEDGE_ID,
        SINGLE_CANVAS_VISUAL_METHOD_KNOWLEDGE_ID,
        'tool:getDesignPrinciples',
        'tool:searchDesignKnowledge',
        'tool:searchEagleReferences'
    ],
    memory_refs: ['design-project-state/v0'],
    evaluation_refs: [
        'design-quality-verdict/v0',
        SINGLE_CANVAS_VISUAL_EVALUATION_PROFILE_ID,
        SINGLE_CANVAS_VISUAL_SCOPED_EDIT_EVALUATION_PROFILE_ID
    ],
    policy_refs: [
        'agent-tool-decision-contract/v0',
        'design-discipline-runtime/v0',
        'tool-safety-policy/v0'
    ],
    review_rubric_ref: SINGLE_CANVAS_VISUAL_EVALUATION_PROFILE_ID,
    delivery_outputs: ['editable_single_canvas_document', 'design_preview', 'delivery_record'],
    exit_criteria: [
        '单画布视觉目标、artifact_kind、必须出现的内容与画布约束有可追溯记录',
        '最后一次 Photoshop 写入后完成结构读回与同一历史状态的视觉复核',
        '单画布视觉 Evaluation Profile 通过或形成下一轮 Reflexion 约束',
        '只在交付记录与可编辑文档、预览一致时声明完成'
    ]
};
