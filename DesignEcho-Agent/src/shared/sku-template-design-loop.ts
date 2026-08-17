/**
 * SKU 无模板时的「Agent 自主设计模板」闭环契约（纯逻辑，可 smoke 验证）
 *
 * 治理背景（2026-07-02）：项目缺 SKU 模板时，此前存在两条并行分支——
 *   ① 模板方向确认卡（pending_sku_card_template_design_confirmation）
 *   ② 硬编码占位模板生成（buildSkuCardTemplatePreparationPlan，v4 版式脚本）
 * 且「确认卡确认后」与「缺模板+生产措辞（shouldAutoPrepareSkuCardTemplateForProduction）」
 * 都会落到 ②——用户观察到的"有概率用硬编码"即来源于此。
 *
 * 新语义（单一真相源在本模块）：
 *   - 默认路径（用户只说做 SKU 且无模板）→ 直接移交 Agent 自主设计
 *     （参考先行 → 设计 → 观察 → createSkuPlaceholders 加占位 → inspectTemplateLayout 验证 →
 *      存入 模板文件/ → 回到批量）。
 *   - 硬编码占位模板只在用户原话显式要求快速/默认/占位模板时可达；
 *     模型参数不能代替用户授权。
 *   - 占位模板产物命名与完成消息必须明示「通用占位模板（非设计稿）」。
 *
 * 红线：本模块给模型机制、不替模型决策——门禁拦「无参考观察/无占位」，不拦「路径」；
 * 每个拒绝都指路当前状态下真实可达的动作（门禁出口治理惯例，见 design-discipline-runtime）。
 */

import type { AgentReActSkillContinuation } from './agent-react-observation-contract';
import { SKU_TEMPLATE_DESIGN_TASK_TYPE_ID } from './design-task-types';
import {
    isSkuTemplateReviewRequestedText,
    type SkuSkillStage
} from './sku-intent-params';

export type SkuTemplatePreparationRouteId =
    | 'placeholder_preparation'
    | 'agent_design_handoff'
    | 'confirmation_required'
    | 'blocked_missing_template';

export interface SkuTemplatePreparationRoute {
    route: SkuTemplatePreparationRouteId;
    reason: string;
}

/**
 * 用户是否显式要求「快速/默认/占位」模板兜底（而非设计稿）。
 * 刻意保守：必须同时出现「快速出一版 / 默认 / 占位 / 通用 / 兜底 / 就行 / 先顶」这类降级措辞
 * 与「模板」语境，避免把"没有模板，帮我设计一版"这类设计请求误判成兜底请求。
 */
export function hasExplicitSkuPlaceholderTemplateFallbackText(input: string): boolean {
    const text = String(input || '').trim();
    if (!text) return false;
    const fallbackTerm = '(?:占位模板|默认模板|通用(?:占位)?模板|基础占位(?:模板)?|placeholder\\s*template)';
    const negativeBefore = new RegExp(
        `(?:不要|别用|不用|不使用|无需|不需要|拒绝|没有|缺少|不存在|不是)[^。！？!?；;\\n]{0,16}${fallbackTerm}`,
        'i'
    );
    const negativeAfter = new RegExp(
        `${fallbackTerm}[^。！？!?；;\\n]{0,12}(?:不要|别用|不用|不使用|不是|不行|拒绝|仅作说明)` ,
        'i'
    );
    if (negativeBefore.test(text) || negativeAfter.test(text)) return false;

    const positiveAction = new RegExp(
        `(?:用|使用|采用|选择|生成|创建|做|先做|先用|就用|改用)[^。！？!?；;\\n]{0,12}${fallbackTerm}`,
        'i'
    );
    const positiveOutcome = new RegExp(
        `${fallbackTerm}[^。！？!?；;\\n]{0,12}(?:就行|即可|先顶|先用|做一版|生成一版)` ,
        'i'
    );
    if (positiveAction.test(text) || positiveOutcome.test(text)) return true;
    // "快速出一版模板就行 / 先随便出一版模板顶一下"——降级措辞 + 模板语境
    const quickFallbackWording = /(?:快速|随便|先随便|简单|粗略)[^。！？!?；;\n]{0,16}(?:出|来|做|生成|建)[^。！？!?；;\n]{0,10}一版[^。！？!?；;\n]{0,12}模板/.test(text)
        || /模板[^。！？!?；;\n]{0,16}(?:就行|先顶一下|先顶着|凑合|将就)/.test(text);
    return quickFallbackWording;
}

/** 用户是否在模板方向确认卡上明确拒绝/要求调整（与执行器确认解析的负向分支同一口径）。 */
export function hasDeclinedSkuCardTemplateDesignText(input: string): boolean {
    const text = String(input || '').trim();
    if (!text) return false;
    return /(?:模板方向确认|允许先生成可编辑基础模板)[:：]\s*(?:否|不|false|no|需要调整)/i.test(text);
}

/** 用户这次要 SKU 链条的哪一段（与 sku-batch 声明的 stage 参数同一口径）。 */
export type SkuRequestStage = SkuSkillStage;

export interface ResolveSkuTemplatePreparationRouteInput {
    userInput: string;
    /** 模板方向是否已由绑定的结构化确认卡或真实用户原文确认。 */
    templateDesignConfirmed: boolean;
    /**
     * 用户这次请求的阶段意图。缺省按 'full' 处理（用户只说"帮我做SKU"）。
     * 阶段决定交付范围，但不自动制造人工确认点。
     */
    stage?: SkuRequestStage;
}

/**
 * 缺模板时是否跳过方向确认卡、直接进入 Agent 自主设计。
 *
 * 背景：用户 2026-08-06 拍板「直接做SKU的话要看看有没有模板，没有就重新设计模板和占位符」——
 * 完整生产途中每缺一件就停下来问一轮，正是"Agent 不能自主解决问题"的体感来源。
 * 单独做模板仍是可逆设计任务，也应直接执行；只有用户明确说“先让我确认模板方向”
 * 才保留方向确认卡。
 *
 * 注意：本函数只决定「要不要问」，不决定「怎么做」。返回 true 时走的仍是
 * agent_design_handoff（参考先行 → 设计 → 占位符 → 验证 → 存模板），
 * 绝不等于降级成通用占位脚本——那条路只由 hasExplicitSkuPlaceholderTemplateFallbackText 开启。
 */
export function shouldDesignTemplateWithoutAsking(
    input: ResolveSkuTemplatePreparationRouteInput
): boolean {
    return !isSkuTemplateReviewRequestedText(input.userInput);
}

/**
 * 缺模板时的唯一路由决策：显式兜底 > 明确拒绝 > 已确认方向 > 默认自主设计 > 用户明确要求方向确认。
 * 注意：本函数只在「按规格确认缺模板」后调用；模板可用时不进入本路由。
 */
export function resolveSkuTemplatePreparationRoute(
    input: ResolveSkuTemplatePreparationRouteInput
): SkuTemplatePreparationRoute {
    const userInput = String(input.userInput || '');

    if (hasExplicitSkuPlaceholderTemplateFallbackText(userInput)) {
        return {
            route: 'placeholder_preparation',
            reason: '用户显式要求快速/默认/占位模板兜底，允许生成通用占位模板（非设计稿）。'
        };
    }

    if (hasDeclinedSkuCardTemplateDesignText(userInput)) {
        return {
            route: 'blocked_missing_template',
            reason: '用户在模板方向确认卡上明确要求调整，本轮不推进模板生成，等待用户给出新的方向。'
        };
    }

    if (input.templateDesignConfirmed) {
        return {
            route: 'agent_design_handoff',
            reason: '模板方向已确认，移交 Agent 自主设计模板（参考先行 → 设计 → 占位符 → 验证 → 存模板）。'
        };
    }

    if (shouldDesignTemplateWithoutAsking(input)) {
        return {
            route: 'agent_design_handoff',
            reason: '完整 SKU 生产途中发现缺模板：不打断用户，直接自主设计模板（参考先行 → 设计 → 占位符 → 验证 → 存模板），完成后在交付说明里报告模板为本次新建。'
        };
    }

    return {
        route: 'confirmation_required',
        reason: '用户明确要求先确认 SKU 模板方向；在结构化确认前不开始模板写入。'
    };
}

/** Agent 自主设计模板的移交契约状态（与 skill-tools 阶段移交同一状态词）。 */
export const SKU_TEMPLATE_DESIGN_HANDOFF_STATUS = 'pending_sku_template_design_agent_decision';

export interface SkuTemplateDesignHandoffContract {
    status: typeof SKU_TEMPLATE_DESIGN_HANDOFF_STATUS;
    audience: 'agent';
    message: string;
    /** 兼容既有遥测；失败态 handoff 不会据此切换当前 Runtime 任务身份。 */
    declaredDesignTaskTypeId: string;
    /** 项目观察优先、外部参考按需补充的可达工具。 */
    requiredReferenceObservationTools: string[];
    /** 同一 SKU Workflow 续跑内允许的最小模板设计工具；不授予新的 Runtime 能力。 */
    templateDesignToolNames: string[];
    /** 设计完成后的占位闭环步骤（确定性顺序，缺一不可进入批量）。 */
    completionChecklist: string[];
    /** 交还主 Agent 后持续限定为本次模板补齐所需的最小观察、设计和读回能力。 */
    agentReActContinuation: AgentReActSkillContinuation;
}

export interface SkuTemplateLayoutRepairTarget {
    size: number;
    mode?: 'combo' | 'self_select_note';
    templateName?: string;
    expectedItemCount: number;
    issue: string;
}

export interface SkuTemplateDesignTarget {
    size: number;
    mode: 'combo' | 'self_select_note';
    expectedItemCount: number;
}

export function buildSkuTemplateDesignHandoffContract(input: {
    missingSizes?: number[];
    missingTargets?: SkuTemplateDesignTarget[];
    colorCount?: number;
    repairTargets?: SkuTemplateLayoutRepairTarget[];
}): SkuTemplateDesignHandoffContract {
    const repairTargets = Array.isArray(input.repairTargets) ? input.repairTargets : [];
    const missingTargets: SkuTemplateDesignTarget[] = [
        ...(input.missingSizes || []).map((size) => ({
            size,
            mode: 'combo' as const,
            expectedItemCount: size
        })),
        ...(Array.isArray(input.missingTargets) ? input.missingTargets : [])
    ].filter((target) => Number.isInteger(target.size) && target.size > 0);
    const targetSizes = Array.from(new Set([
        ...missingTargets.map((target) => target.size),
        ...repairTargets.map((target) => target.size)
    ].filter((size) => Number.isInteger(size) && size > 0))).sort((left, right) => left - right);
    const sizesText = targetSizes.length > 0
        ? targetSizes.map((size) => `${size}双装`).join('、')
        : '所需规格';
    const colorText = Number(input.colorCount) > 0 ? `（当前色卡 ${input.colorCount} 色）` : '';
    const repairsExistingTemplate = repairTargets.length > 0;
    const missingTargetSummary = Array.from(new Set(missingTargets.map((target) => (
        target.mode === 'self_select_note'
            ? `${target.size}双装自选备注`
            : `${target.size}双装组合`
    )))).join('、');
    const requiredReferenceObservationTools = [
        'listProjectResources',
        'searchProjectResources',
        'analyzeProjectContactSheetOverview',
        'searchEagleReferences',
        'searchDesignKnowledge'
    ];
    const templateDesignToolNames = [
        'listDocuments',
        'switchDocument',
        'getDocumentInfo',
        'getLayerHierarchy',
        'getLayerProperties',
        'skuLayout',
        'createDocument',
        'createGroup',
        'createRectangle',
        'createTextLayer',
        'setTextContent',
        'setTextStyle',
        'placeImage',
        'createSkuPlaceholders',
        'getLayerBounds',
        'getCanvasSnapshot',
        'moveLayer',
        'transformLayer',
        'saveDocument',
        'getAcceptanceSnapshot'
    ];
    const completionChecklist = [
        '优先复用本轮已经取得的项目素材观察和产品事实；只有现有证据不足以确定版式时，才补充项目联系表、Eagle 参考或设计知识检索，不为走流程重复看图。',
        ...(repairsExistingTemplate
            ? ['先切换到待修模板，用 skuLayout.inspectTemplateLayout、getLayerHierarchy、getLayerBounds 和画布快照读取真实占位类型、layerId、面板顺序与 bounds；不要凭文件名或默认参数猜结构。']
            : []),
        `用通用 Photoshop 工具为 ${sizesText} 设计可编辑模板${colorText}，改动后用截图观察真实画面。`,
        '添加占位符也是排版设计：先用截图和 getLayerBounds 读取已设计版面，再选择 ordered_slots（6.3，一色一槽，物理槽数=双数）或 region_composition（6.0，一个矩形区域可放多色，显式 regionCapacities 总和=双数）；把规划好的 slots 显式传给 createSkuPlaceholders，只有空白裸模板才允许只传 count 让工具均分。',
        '用 skuLayout 的 inspectTemplateLayout 读取 layerId/type/panelIndex/bounds 并形成 TemplateLayoutPlan；调整现有占位时用 transformLayer 修改目标 layerId 后重新 inspect，不要新建第二套占位。',
        '用 saveDocument 把模板另存为项目「模板文件」目录中的新文件，必须显式提供 path 和 conflictPolicy=fail_if_exists；命名用规格本身、与用户既有模板同风格（组合模板如「3双装-DesignEcho候选」，自选备注模板如「3双装自选备注-DesignEcho候选」），绝不覆盖作为参考读取的源模板。',
        '模板齐备后再回到 sku-batch 继续组合规划；候选组合生成后先显示组合确认卡，用户确认后再批量出图。只有用户明确要求跳过组合确认，或项目已经提供受信的权威组合时才可直接继续。由资源扫描和模板结构读回确认模板已经存在，不要用裸布尔参数跳过验证。'
    ];
    const repairSummary = repairTargets
        .map((target) => `${target.size}双${target.mode === 'self_select_note' ? '自选备注' : '组合'}「${String(target.templateName || '未命名模板')}」：${target.issue}`)
        .join('\n');
    const opening = repairsExistingTemplate
        ? `当前 ${sizesText} 模板的占位结构需要修复：完整 SKU 任务已进入自主修复阶段，由 Agent 读取真实 layerId / bounds 后调整或重建可编辑占位，不把结构问题变成用户确认。`
        : `当前项目缺少 ${missingTargetSummary || sizesText} 的排版模板：完整 SKU 任务已进入自主补齐阶段，由 Agent 根据现有产品素材直接设计，不使用通用占位脚本代替设计稿。`;
    const message = [
        opening,
        ...(repairSummary ? [`待修问题：\n${repairSummary}`] : []),
        `设计闭环要求（按顺序执行）：`,
        ...completionChecklist.map((item, index) => `${index + 1}. ${item}`)
    ].join('\n');
    const agentWorkDetails = [
        repairsExistingTemplate
            ? `需要修复：${repairSummary || `${sizesText} 模板的占位结构`}`
            : `需要设计：${missingTargetSummary || sizesText} 的可编辑模板${colorText}`,
        '先看当前模板或项目素材，再决定版式；占位符数量、位置和阅读顺序要与实际规格一致，不能重叠、越界或压住文案。',
        '保留色卡、文字和占位结构的可编辑性；完成一版后查看整体画面并调整间距、比例和视觉重心。',
        '保存为项目模板目录中的新版本，不覆盖作为参考的源文件。',
        '模板完成后重新使用 sku-batch，继续组合规划和批量制作。'
    ];
    return {
        status: SKU_TEMPLATE_DESIGN_HANDOFF_STATUS,
        audience: 'agent',
        message,
        declaredDesignTaskTypeId: SKU_TEMPLATE_DESIGN_TASK_TYPE_ID,
        requiredReferenceObservationTools,
        templateDesignToolNames,
        completionChecklist,
        agentReActContinuation: {
            status: 'needs_repair',
            summary: repairsExistingTemplate
                ? 'SKU 模板占位结构已进入自主修复阶段；读取真实结构后直接调整并复验。'
                : 'SKU 模板设计已进入自主执行阶段；观察相关项目素材后直接完成可编辑模板。',
            details: agentWorkDetails,
            nextAction: 'repair',
            sourceStatus: SKU_TEMPLATE_DESIGN_HANDOFF_STATUS,
            recovery: {
                mode: 'allowlist',
                purpose: 'repair',
                allowedToolNames: [
                    ...requiredReferenceObservationTools,
                    ...templateDesignToolNames
                ],
                toolArgumentConstraints: {
                    skuLayout: {
                        argumentEquals: { action: 'inspectTemplateLayout' }
                    },
                    saveDocument: {
                        argumentEquals: { conflictPolicy: 'fail_if_exists' },
                        requiredArgumentKeys: ['path']
                    }
                },
                reason: repairsExistingTemplate
                    ? '占位结构修复由当前 SKU 工作流负责：只允许读取模板结构、完成可逆调整或新版本设计、看图复验、保存和结构读回；模板通过后重新调用 sku-batch 继续批量。'
                    : '缺失模板由当前 SKU 工作流负责补齐：只允许读取相关素材、完成模板原子设计、看图调整、保存和结构读回；模板齐备后重新调用 sku-batch 继续批量。'
            }
        }
    };
}

// ── 设计后占位闭环：模板进入批量前的确定性检查 ──

export interface SkuTemplatePlaceholderBatchEntryGateInput {
    size: number;
    action: 'execute' | 'arrangeDynamic';
    templateName?: string;
    expectedItemCount: number;
    /** 来自 skuLayout inspectTemplateLayout 的预检结果（sku-auto-layout-executor-policy）。 */
    placeholderCount: number;
    skuPlaceholderInspectionStatus: string;
    hasReliableSkuPlaceholders: boolean | undefined;
}

export interface SkuTemplatePlaceholderBatchEntryGateBlock {
    size: number;
    action: 'execute' | 'arrangeDynamic';
    templateName: string;
    expectedItemCount: number;
    placeholderCount: number;
    message: string;
}

/**
 * 模板文档（含 Agent 设计产物）没有可解析占位符时，不得被当作模板进入批量。
 * 拒绝消息指路 createSkuPlaceholders（补占位）→ inspectTemplateLayout（复验），
 * 而不是只说"结构不可用"。仅在检查状态为 inspected 且判定不可靠时拦截——
 * 检查失败/未检查不在此拦（无占位符自动排版能力另有 runtime readiness 门，口径不变）。
 */
export function evaluateSkuTemplatePlaceholderBatchEntryGate(
    input: SkuTemplatePlaceholderBatchEntryGateInput
): SkuTemplatePlaceholderBatchEntryGateBlock | null {
    if (input.skuPlaceholderInspectionStatus !== 'inspected') return null;
    if (input.hasReliableSkuPlaceholders !== false) return null;

    const actionLabel = input.action === 'arrangeDynamic' ? '自选备注' : '组合图';
    const templateName = String(input.templateName || '').trim() || '未命名模板';
    const message = [
        `${input.size}双${actionLabel}: 模板「${templateName}」没有识别到可解析的 SKU 占位符，不能作为模板进入批量出图。`,
        `本次规格包含 ${input.expectedItemCount} 个颜色，当前识别到 ${input.placeholderCount} 个物理占位。`,
        '请先用 skuLayout.inspectTemplateLayout 确认模板应采用 ordered_slots（一槽一色）还是 region_composition（矩形区域多色）；',
        '需要新建时用 createSkuPlaceholders 传入对应 placementMethod，区域模式还要传显式 regionCapacities；',
        '需要调整时用检查结果中的 layerId 调用 transformLayer，再次 inspect 复验后重试。'
    ].join(' ');

    return {
        size: input.size,
        action: input.action,
        templateName,
        expectedItemCount: input.expectedItemCount,
        placeholderCount: input.placeholderCount,
        message
    };
}
