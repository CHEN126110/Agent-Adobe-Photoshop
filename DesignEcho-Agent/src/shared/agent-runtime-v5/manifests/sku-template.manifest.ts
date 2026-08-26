/**
 * SKU 组合模板 Runtime Manifest。
 *
 * 这是 Task Profile 的 artifact-owner 运行清单。SKU 领域阶段由统一 sku-batch Skill
 * 在通用自主循环中承接；Manifest 只声明任务身份、能力、预算、证据与交付物，
 * 不把 SKU 分支复制到 Agent/Harness 核心。
 */

import type { SkillRuntimeManifest } from '../contracts';
import {
    DESIGN_ART_DIRECTION_KNOWLEDGE_ID,
    DESIGN_CONTENT_STRATEGY_KNOWLEDGE_ID,
    DESIGN_LAYOUT_PLANNING_KNOWLEDGE_ID,
    SKU_TEMPLATE_METHOD_KNOWLEDGE_ID
} from '../design-method-knowledge';
import { GENERAL_DESIGN_EVALUATION_PROFILE_ID } from '../design-evaluation-profiles';

export const SKU_TEMPLATE_MANIFEST: SkillRuntimeManifest = {
    skill_id: 'ecommerce.sku_template',
    version: '0.1.0',
    task_type: 'ecommerce.sku_template.v1',
    display_name: 'SKU 组合模板设计',
    // 规格数量、命名、占位数与交付完整性可以确定性校验；版式、视觉层级与参考选择
    // 属于开放设计，必须保留在自主循环中，不能用 R1/R3/R4 声明作为写入门票。
    execution_model: 'agentic',
    legacy_skill_ids: [],
    workflow_entry_skill_ids: ['sku-batch'],
    required_inputs: ['goal'],
    optional_inputs: [
        'template_variants',
        'sku_card_sources',
        'existing_document',
        'canvas_size',
        'output_spec'
    ],
    input_sources: {
        goal: ['user_goal'],
        template_variants: ['structured_input', 'user_goal', 'project_context'],
        sku_card_sources: ['structured_input', 'project_sku', 'project_asset', 'photoshop_document'],
        existing_document: ['photoshop_document', 'project_template'],
        canvas_size: ['structured_input', 'photoshop_document'],
        output_spec: ['structured_input', 'project_context']
    },
    performance_profile: {
        version: 'skill-runtime-performance-profile/v0',
        budget: {
            max_model_calls: 24,
            max_tool_calls: 100,
            max_iterations: 50,
            max_vision_candidates: 8,
            max_visual_analyses: 4,
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
    runtime_stages: ['R0', 'R1', 'R3', 'R4', 'E1', 'R5', 'E2'],
    required_model_profiles: ['reasoning.default'],
    optional_model_profiles: ['vision.reference', 'review.strict'],
    read_scopes: ['brief', 'assets', 'sku_sources', 'visual_direction', 'layout_plan', 'photoshop'],
    write_scopes: ['brief', 'layout_plan', 'template_variants', 'review', 'delivery'],
    tool_namespaces: [
        'agent.',
        'project.',
        'knowledge.',
        'memory.',
        'eagle.read.',
        'preview.',
        'photoshop.read.',
        'photoshop.sandbox.',
        'delivery.'
    ],
    available_tools: [
        'agent.interaction.requestConfirmation',
        'project.listResources',
        'project.searchResources',
        'project.observeAssets',
        'knowledge.read.designFoundation',
        'memory.designProjectState',
        'eagle.read.searchReferences',
        'eagle.read.analyzeReference',
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
        SKU_TEMPLATE_METHOD_KNOWLEDGE_ID,
        'tool:getDesignKnowledge',
        'tool:getDesignPrinciples',
        'tool:searchDesignKnowledge',
        'tool:searchEagleReferences'
    ],
    memory_refs: ['design-project-state/v0'],
    evaluation_refs: ['design-quality-verdict/v0', GENERAL_DESIGN_EVALUATION_PROFILE_ID],
    policy_refs: [
        'agent-tool-decision-contract/v0',
        'design-discipline-runtime/v0',
        'tool-safety-policy/v0'
    ],
    // 模板继续复用 Design Foundation 做审美评价；workflow entry 只承接 SKU 领域流程，
    // 不在通用 Agent 中增加 SKU 专属审美规则。
    review_rubric_ref: GENERAL_DESIGN_EVALUATION_PROFILE_ID,
    // preview 与 delivery_record 由 Runtime 基于最终同版本画面和结构化交付收据确认；
    // editable document 必须由 Manifest 绑定的真实 saveDocument 结果证明。
    delivery_outputs: ['editable_sku_template_document', 'preview', 'delivery_record'],
    delivery_output_bindings: {
        editable_sku_template_document: {
            capability_refs: ['delivery.saveDocument'],
            proof_kind: 'saved_editable_document'
        }
    },
    production_obligation: 'photoshop_mutation_with_readback',
    exit_criteria: [
        '模板变体、卡片同级关系、编号与备注规则已经形成可编辑系统',
        '最后一次视觉写入后已完成结构读回与同一历史状态的画面复核',
        '颜色、编号与卡片来源来自真实项目输入，不含未声明的占位事实',
        '设计质量裁决通过或形成下一轮有界修正要求'
    ]
};
