/**
 * 主图 Skill Manifest（skill-runtime-manifest.schema）
 *
 * Skill 只声明任务能力、阶段、读写范围和可用工具能力；不声明旧 renderer
 * executable tool schema 名，也不把 legacy skill id 当作工具。
 */

import type { SkillRuntimeManifest } from '../contracts';
import {
    DESIGN_ART_DIRECTION_KNOWLEDGE_ID,
    DESIGN_CONTENT_STRATEGY_KNOWLEDGE_ID,
    DESIGN_LAYOUT_PLANNING_KNOWLEDGE_ID,
    MAIN_IMAGE_METHOD_KNOWLEDGE_ID
} from '../design-method-knowledge';
import {
    MAIN_IMAGE_EVALUATION_PROFILE_ID,
    MAIN_IMAGE_SCOPED_EDIT_EVALUATION_PROFILE_ID
} from '../design-evaluation-profiles';
import {
    buildScopedEditPerformanceProfile,
    SCOPED_EDIT_CAPABILITY_CEILING,
    SCOPED_EDIT_INITIAL_CAPABILITY_IDS
} from '../scoped-edit-runtime-policy';

export const MAIN_IMAGE_MANIFEST: SkillRuntimeManifest = {
    skill_id: 'ecommerce.main_image',
    version: '0.1.0',
    task_type: 'ecommerce.main_image.v1',
    display_name: '电商主图设计',
    legacy_skill_ids: ['main-image-design'],
    required_inputs: ['product', 'asset_source'],
    optional_inputs: ['platform_size', 'image_type', 'brand_style', 'target_user', 'selling_points'],
    input_sources: {
        product: ['structured_input', 'project_product'],
        asset_source: ['structured_input', 'attached_image', 'project_asset'],
        platform_size: ['structured_input', 'photoshop_document'],
        image_type: ['structured_input'],
        brand_style: ['structured_input', 'project_context'],
        target_user: ['structured_input', 'project_context'],
        selling_points: ['structured_input', 'project_product'],
        existing_document: ['photoshop_document'],
        redesign_goal: ['user_goal', 'structured_input'],
        target_scope: ['structured_input', 'photoshop_target'],
        requested_change: ['user_goal', 'structured_input']
    },
    performance_profile: {
        version: 'skill-runtime-performance-profile/v0',
        budget: {
            max_model_calls: 22,
            max_tool_calls: 60,
            max_iterations: 35,
            max_vision_candidates: 4,
            max_visual_analyses: 3,
            max_full_resolution_image_reads: 0,
            soft_time_budget_ms: 600_000
        },
        verification_tier: 'screenshot',
        cost_profile: {
            model_call_class: 'vision-light',
            photoshop_tool_class: 'write-heavy',
            image_processing_class: 'bounded-vision',
            expected_latency: 'medium',
            resource_risk: 'medium'
        },
        vision_policy: 'bounded'
    },
    work_mode_contracts: {
        create_new: {
            required_inputs: ['product', 'asset_source'],
            optional_inputs: ['platform_size', 'image_type', 'brand_style', 'target_user', 'selling_points'],
            delivery_outputs: ['main_image_psd', 'main_image_preview', 'delivery_manifest'],
            production_obligation: 'photoshop_mutation_with_readback',
            review_rubric_ref: MAIN_IMAGE_EVALUATION_PROFILE_ID,
            exit_criteria: [
                '主图阶段草稿已生成并经过工具观察',
                'R5 review 通过或产生下一轮 Reflexion 约束',
                '用户确认交付范围后再导出文件'
            ]
        },
        redesign: {
            required_inputs: ['existing_document', 'redesign_goal'],
            optional_inputs: ['asset_source', 'brand_style', 'target_user', 'selling_points'],
            delivery_outputs: ['updated_main_image_document', 'main_image_preview', 'redesign_report'],
            production_obligation: 'photoshop_mutation_with_readback',
            review_rubric_ref: MAIN_IMAGE_EVALUATION_PROFILE_ID,
            exit_criteria: [
                '重设计方向已形成并落实到当前主图文档',
                '最后一次写入后完成结构读回与视觉复核',
                'R5 review 通过或形成下一轮定向修订约束'
            ]
        },
        edit_existing: {
            required_inputs: ['existing_document', 'target_scope', 'requested_change'],
            optional_inputs: ['brand_style'],
            delivery_outputs: ['updated_main_image_document', 'change_verification_report'],
            production_obligation: 'photoshop_mutation_with_readback',
            review_rubric_ref: MAIN_IMAGE_SCOPED_EDIT_EVALUATION_PROFILE_ID,
            runtime_stages: ['R0', 'R1', 'R2', 'E1', 'R5'],
            execution_scope_kind: 'exact_text_replacement',
            initial_capabilities: [...SCOPED_EDIT_INITIAL_CAPABILITY_IDS],
            capability_ceiling: [...SCOPED_EDIT_CAPABILITY_CEILING],
            performance_profile: buildScopedEditPerformanceProfile(),
            exit_criteria: [
                '用户要求的主图局部修改已在显式目标范围内完成',
                '修改后已读回目标属性、图层结构或必要的目标区域画面',
                '未发现无关图层或画布区域被意外改动'
            ]
        }
    },
    runtime_stages: ['R0', 'R1', 'R2', 'R3', 'R4', 'E1', 'R5', 'E2'],
    required_model_profiles: ['reasoning.default'],
    optional_model_profiles: ['vision.reference', 'review.strict'],
    read_scopes: ['brief', 'product_analysis', 'assets', 'visual_direction', 'image_placement_plan', 'photoshop'],
    write_scopes: ['brief', 'layout_plan', 'preview_versions', 'review', 'delivery'],
    tool_namespaces: ['project.', 'preview.', 'eagle.read.', 'photoshop.read.', 'photoshop.sandbox.', 'photoshop.write.', 'delivery.'],
    available_tools: [
        'project.listResources',
        'project.searchResources',
        'project.observeAssets',
        'preview.renderStoryboard',
        'eagle.read.searchReferences',
        'eagle.read.analyzeReference',
        'eagle.read.observeAsset',
        'photoshop.read.getDocumentSummary',
        'photoshop.read.getVisualSnapshot',
        'photoshop.read.getLayerBounds',
        'photoshop.sandbox.createScreenGroup',
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
        MAIN_IMAGE_METHOD_KNOWLEDGE_ID,
        'tool:getMainImageDesignFramework',
        'tool:getDesignPrinciples',
        'tool:searchDesignKnowledge'
    ],
    primary_method_tool_ref: 'tool:getMainImageDesignFramework',
    memory_refs: ['design-project-state/v0'],
    evaluation_refs: [
        'design-quality-verdict/v0',
        MAIN_IMAGE_EVALUATION_PROFILE_ID,
        MAIN_IMAGE_SCOPED_EDIT_EVALUATION_PROFILE_ID
    ],
    policy_refs: [
        'agent-tool-decision-contract/v0',
        'design-discipline-runtime/v0',
        'tool-safety-policy/v0'
    ],
    template_families: ['main_image.standard.v1'],
    review_rubric_ref: MAIN_IMAGE_EVALUATION_PROFILE_ID,
    delivery_outputs: ['main_image_psd', 'main_image_preview', 'delivery_manifest'],
    exit_criteria: [
        '主图阶段草稿已生成并经过工具观察',
        'R5 review 通过或产生下一轮 Reflexion 约束',
        '用户确认交付范围后再导出文件'
    ]
};
