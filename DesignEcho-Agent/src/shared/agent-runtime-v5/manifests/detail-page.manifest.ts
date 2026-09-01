/**
 * 详情页 Skill Manifest（skill-runtime-manifest.schema）
 *
 * §6.2：核心系统不知道「详情页几屏」。任务类型、阶段、读写范围、工具白名单、
 * 模板族、退出条件全部在 manifest 数据里声明。默认屏结构走 design-task-types 知识
 * （task_type = ecommerce.detail_page.v1），不硬编码进 Orchestrator。
 */

import type { SkillRuntimeManifest } from '../contracts';
import {
    DESIGN_ART_DIRECTION_KNOWLEDGE_ID,
    DESIGN_CONTENT_STRATEGY_KNOWLEDGE_ID,
    DESIGN_LAYOUT_PLANNING_KNOWLEDGE_ID,
    DETAIL_PAGE_METHOD_KNOWLEDGE_ID
} from '../design-method-knowledge';
import {
    DETAIL_PAGE_CREATE_NEW_EVALUATION_PROFILE_ID,
    DETAIL_PAGE_EVALUATION_PROFILE_ID,
    DETAIL_PAGE_SCOPED_EDIT_EVALUATION_PROFILE_ID
} from '../design-evaluation-profiles';
import {
    buildScopedEditPerformanceProfile,
    SCOPED_EDIT_CAPABILITY_CEILING,
    SCOPED_EDIT_INITIAL_CAPABILITY_IDS
} from '../scoped-edit-runtime-policy';

export const DETAIL_PAGE_MANIFEST: SkillRuntimeManifest = {
    skill_id: 'ecommerce.detail_page',
    version: '0.1.0',
    task_type: 'ecommerce.detail_page.v1',
    display_name: '电商详情页设计',
    // 开放创意路径：不建 Stage 机、不以声明作写入门票（设计路径宪法）。
    // 真机 2026-08-17：绑定 Stage 机的三次详情页任务全部死于简报表单校验，零写入。
    execution_model: 'agentic',
    legacy_skill_ids: ['detail-page-design'],
    // user-facing workflow entry 与 legacy 兼容 id 分开声明：前者供 Agent 选择
    // Artifact Profile，后者只服务旧调用解析，不能再由注册顺序承担 owner 身份。
    workflow_entry_skill_ids: ['detail-page-design'],
    // 未声明 workMode 时只使用中性契约，不能默认把局部编辑升级为从零创作。
    required_inputs: ['goal'],
    optional_inputs: ['current_document', 'target_scope'],
    input_sources: {
        goal: ['user_goal'],
        current_document: ['photoshop_document'],
        product: ['structured_input', 'project_product'],
        asset_source: ['structured_input', 'attached_image', 'project_asset'],
        platform_size: ['structured_input', 'photoshop_document'],
        brand_style: ['structured_input', 'project_context'],
        target_user: ['structured_input', 'project_context'],
        existing_document: ['photoshop_document'],
        redesign_goal: ['user_goal', 'structured_input'],
        template_document: ['structured_input', 'project_template', 'photoshop_document'],
        content_source: ['structured_input', 'attached_image', 'project_asset'],
        target_scope: ['structured_input', 'photoshop_target'],
        requested_change: ['user_goal', 'structured_input'],
        edit_content_mode: ['structured_input'],
        analysis_goal: ['user_goal', 'structured_input'],
        export_target: ['user_goal', 'structured_input'],
        export_format: ['structured_input']
    },
    reference_policy: {
        version: 'skill-reference-policy/v0',
        work_mode_requirements: {
            // 普通创作与重设计可以从项目事实、模型设计知识和写后观察推进；
            // 只有用户明确要求复刻或指定品牌/参考约束时，参考才由相应任务契约设为 required。
            create_new: 'reuse_or_optional',
            redesign: 'reuse_or_optional',
            template_fill: 'reuse_or_optional',
            edit_existing: 'not_required',
            analyze_only: 'not_required',
            export_only: 'not_required'
        },
        allowed_sources: ['user_reference', 'brand_template', 'project_case', 'eagle', 'web'],
        max_search_rounds: 2,
        unavailable_behavior: 'continue_degraded'
    },
    performance_profile: {
        version: 'skill-runtime-performance-profile/v0',
        budget: {
            // 2026-08-23 真机病历：详情页 performance_budget 死亡样本（[465] 迭代 5、[428] 30 工具全成功）
            // 均远未触及 iterations/tools 上限，真凶是 soft_time 600s 硬终止 + 视觉回合慢。
            // 12 屏任务规模至少是主图（900s/36 calls）的 2 倍，预算是安全网不是终止器。
            max_model_calls: 56,
            max_tool_calls: 140,
            max_iterations: 70,
            // 12 屏首轮 + 12 屏一次有界修订 + 最多 5 张用户附件 + 1 张开场画布。
            // 这是允许上限，不是必须消耗量；没有 required fix 时不会进入第二轮。
            // 36 个业务候选 + 1 个 Runtime 终局保留槽；终审复用 observationKey，
            // 不会重复计算已经看过的屏幕。
            max_vision_candidates: 37,
            max_initial_vision_candidates: 5,
            // 视觉专家每次最多批量复核 6 屏；30 屏只需 5 次，仍给终局 Judge 留 1 次。
            max_visual_analyses: 10,
            max_full_resolution_image_reads: 0,
            soft_time_budget_ms: 1_800_000
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
            required_inputs: ['product', 'asset_source'],
            optional_inputs: ['platform_size', 'brand_style', 'target_user'],
            delivery_outputs: ['detail_page_psd', 'detail_page_slices', 'delivery_record'],
            delivery_plan_binding_required: true,
            production_obligation: 'photoshop_mutation_with_readback',
            // 详情页由同一 Workflow owner 在视觉通过后复入，内部连续提交母稿与整组切片。
            // E2 因此消费该 owner 的 Runtime-bound typed receipt；不能把外层 Skill 调用
            // 伪装成两个独立的顶层 atomic save/export 记录。
            review_rubric_ref: DETAIL_PAGE_CREATE_NEW_EVALUATION_PROFILE_ID,
            exit_criteria: [
                'storyboard 已生成并由 Agent 对照 Brief 与视觉观察复核；仅在用户要求逐步确认、品牌方向缺失或不可逆风险存在时暂停请求确认',
                'R5 review / Quality Gate 通过且无 required fix；未通过必须进入 Reflexion 后重新 ReAct',
                'PSD 与详情页切片均由真实交付结果回读，并绑定到已复核的同一 Photoshop 文档版本'
            ]
        },
        redesign: {
            required_inputs: ['existing_document', 'redesign_goal'],
            optional_inputs: ['product', 'asset_source', 'brand_style', 'target_user'],
            delivery_outputs: ['detail_page_psd', 'detail_page_slices', 'redesign_report'],
            delivery_plan_binding_required: true,
            production_obligation: 'photoshop_mutation_with_readback',
            exit_criteria: [
                '重设计方向已在写入前形成可审查方案',
                'R5 review / Quality Gate 通过且无 required fix',
                '重设计交付物已读回并记录版本'
            ]
        },
        template_fill: {
            required_inputs: ['template_document', 'content_source'],
            optional_inputs: ['platform_size', 'brand_style', 'target_user'],
            delivery_outputs: ['detail_page_psd', 'detail_page_slices', 'template_fill_report'],
            delivery_plan_binding_required: true,
            production_obligation: 'photoshop_mutation_with_readback',
            exit_criteria: [
                '模板结构保持可编辑且内容映射完整',
                '填充后的视觉检查与文字读回通过',
                '交付文件真实存在'
            ]
        },
        edit_existing: {
            required_inputs: ['existing_document', 'target_scope', 'requested_change'],
            optional_inputs: ['edit_content_mode', 'brand_style'],
            delivery_outputs: ['updated_detail_page_psd', 'change_verification_report'],
            delivery_plan_binding_required: true,
            production_obligation: 'photoshop_mutation_with_readback',
            review_rubric_ref: DETAIL_PAGE_SCOPED_EDIT_EVALUATION_PROFILE_ID,
            runtime_stages: ['R0', 'R1', 'R2', 'E1', 'R5'],
            execution_scope_kind: 'exact_text_replacement',
            // 局部编辑的绝对能力上限：不暴露项目扫描、Eagle、Design Team、建画布、整页布局、
            // 复合 Workflow 或交付动作。复合 Workflow 的内部调用目前不进入父级成本账本，不能用它
            // 冒充轻量编辑；该模式只允许目标绑定、可读回的一对一叶子动作。
            initial_capabilities: [...SCOPED_EDIT_INITIAL_CAPABILITY_IDS],
            capability_ceiling: [...SCOPED_EDIT_CAPABILITY_CEILING],
            // 局部编辑默认只给目标级风险复核留一张；完整长页复核属于重设计模式。
            performance_profile: buildScopedEditPerformanceProfile(),
            exit_criteria: [
                '用户要求的局部修改已在目标范围内完成',
                '修改后已读回文字、图层或视觉结果',
                '未发现无关图层或画布区域被意外改动'
            ]
        },
        analyze_only: {
            required_inputs: ['existing_document', 'analysis_goal'],
            optional_inputs: ['target_scope'],
            delivery_outputs: ['detail_page_analysis_report'],
            exit_criteria: [
                '分析结论均来自只读文档或视觉观察',
                '未执行任何 Photoshop 写入'
            ]
        },
        export_only: {
            required_inputs: ['existing_document', 'export_target'],
            optional_inputs: ['export_format', 'platform_size'],
            delivery_outputs: ['detail_page_slices', 'delivery_manifest'],
            delivery_plan_binding_required: true,
            exit_criteria: [
                '导出文件真实存在并与目标规格一致',
                '未改变设计内容或文档结构'
            ]
        }
    },
    // 代码控制的阶段顺序（R0 按此驱动）
    runtime_stages: ['R0', 'R1', 'R2', 'R3', 'R4', 'E1', 'R5', 'E2'],
    required_model_profiles: ['reasoning.default'],
    optional_model_profiles: ['vision.reference', 'review.strict'],
    read_scopes: ['brief', 'product_analysis', 'assets', 'user_insights', 'market_insights', 'visual_direction', 'layout_plan'],
    write_scopes: ['brief', 'detail_page_screen_plan', 'storyboard', 'review', 'delivery'],
    tool_namespaces: ['project.', 'preview.', 'eagle.read.', 'photoshop.read.', 'photoshop.apply.', 'photoshop.sandbox.', 'photoshop.write.', 'delivery.'],
    available_tools: [
        'project.listResources',
        'project.searchResources',
        'project.observeAssets',
        'preview.renderStoryboard',
        'eagle.read.searchReferences',
        'eagle.read.analyzeReference',
        'eagle.read.observeAsset',
        'photoshop.read.getDocumentSummary',
        'photoshop.read.inspectDetailPageTemplate',
        'photoshop.read.getVisualSnapshot',
        'photoshop.read.getLayerBounds',
        'photoshop.apply.fixDetailPageTemplate',
        'photoshop.apply.matchDetailPageContent',
        'photoshop.apply.fillDetailPageTemplate',
        'photoshop.sandbox.createScreenGroup',
        'photoshop.sandbox.placeImage',
        'photoshop.sandbox.manageLayers',
        'photoshop.sandbox.replaceImagePlaceholder',
        'photoshop.sandbox.transformLayer',
        'photoshop.sandbox.writeText',
        'delivery.saveDocument',
        'delivery.exportSlices'
    ],
    forbidden_tools: [
        'photoshop.apply.overwriteCurrentDocument',
        'photoshop.raw.batchPlay'
    ],
    knowledge_refs: [
        DESIGN_CONTENT_STRATEGY_KNOWLEDGE_ID,
        DESIGN_ART_DIRECTION_KNOWLEDGE_ID,
        DESIGN_LAYOUT_PLANNING_KNOWLEDGE_ID,
        DETAIL_PAGE_METHOD_KNOWLEDGE_ID,
        'tool:getDetailPageDesignFramework',
        'tool:getDesignPrinciples',
        'tool:searchDesignKnowledge'
    ],
    primary_method_tool_ref: 'tool:getDetailPageDesignFramework',
    memory_refs: ['design-project-state/v0'],
    evaluation_refs: [
        'design-quality-verdict/v0',
        DETAIL_PAGE_CREATE_NEW_EVALUATION_PROFILE_ID,
        DETAIL_PAGE_EVALUATION_PROFILE_ID,
        DETAIL_PAGE_SCOPED_EDIT_EVALUATION_PROFILE_ID
    ],
    policy_refs: [
        'agent-tool-decision-contract/v0',
        'design-discipline-runtime/v0',
        'tool-safety-policy/v0'
    ],
    // agentic 详情页不绑定内置标准版式；模板仅来自用户、项目或显式参考。
    template_families: [],
    review_rubric_ref: DETAIL_PAGE_EVALUATION_PROFILE_ID,
    delivery_outputs: ['detail_page_psd', 'change_or_delivery_record'],
    delivery_plan_binding_required: true,
    exit_criteria: [
        '任务目标已经明确并使用与 workMode 对应的契约',
        '执行后存在真实读回结果或视觉检查记录',
        '交付或变更记录可追溯'
    ]
};
