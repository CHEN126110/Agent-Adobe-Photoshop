/**
 * 通用设计纪律运行时（generic, data-driven design discipline runtime）
 *
 * 背景：详情页「从零设计」此前在 autonomous-agent.executor.ts 里以一整套硬编码
 * 状态机（freshDetailPage*）实现——检测靠正则、工具靠详情页专属白名单、门禁顺序
 * 写死。这违反「技能不渗透进 Agent」不变量，且只覆盖手写过正则的品类。
 *
 * 本模块把其中真正跨任务的**运行不变量**（真实状态、防重复建档、写后观察、保存前复核）
 * 与仍在迁移中的显式 Skill policy（stagePlan / reference-first）整理成纯逻辑：
 *   - 任务类型来自 design-task-types.ts（详情页/主图/SKU/未来新品类=加数据）
 *   - 看图纪律来自 design-observation-intents.ts（DESIGN_OBSERVATION_REQUIREMENTS）
 *   - 方法论工具由现有 Skill Manifest 明确声明，并绑定其 knowledge_refs
 *
 * 通用 Harness 不再通过本模块缩窄 Tool Registry，也不再强制「方法论→建档→renderLayout」路线。
 * Skill policy 后续继续迁入 manifest；本模块保持纯逻辑、无 Photoshop / 无 renderer 依赖，可被 smoke 验证。
 *
 * 治理轨道见 CLAUDE.md「设计能力治理（D→B→A）」；本模块是 A1 的通用替身，
 * A1.2 把 executor 改调它后，audit:executor-generic 棘轮随之下降。
 */

import { DESIGN_DISCIPLINE_POLICY_CAPABILITY_ID } from './agent-runtime-v5/capability-provider-identities';
import { getManifestByTaskType } from './agent-runtime-v5/skill-runtime';
import {
    resolveDesignTaskTypeSpec,
    getDesignTaskTypeSpec,
    hitsAnyDesignTaskExcludeSignal,
    GENERIC_DESIGN_TASK_TYPE,
    type DesignTaskTypeSpec
} from './design-task-types';
import {
    DESIGN_OBSERVATION_REQUIREMENTS,
    type DesignObservationIntent,
    type DesignObservationRequirement
} from './design-observation-intents';
import { validateCreativeStagePlan } from './creative-stage-plan';
import { classifyPhotoshopToolSkillExecution } from './photoshop-tool-skill';

export type DesignDisciplineRuntimeVersion = typeof DESIGN_DISCIPLINE_POLICY_CAPABILITY_ID;

function resolveFrameworkToolName(spec: DesignTaskTypeSpec): string {
    const manifest = getManifestByTaskType(spec.id);
    const ref = manifest?.primary_method_tool_ref;
    return ref && manifest?.knowledge_refs?.includes(ref) ? ref.slice('tool:'.length) : 'searchDesignKnowledge';
}

/**
 * 设计治理上下文：是否进入设计纪律/Skill policy 治理 + 命中的任务类型 + 方法论工具。
 * active = 结构化 Runtime/移交 owner 或已确认创意设计意图命中数据驱动任务类型；本模块不重造意图正则。
 * active 不等于固定「从零创建」路线；编辑、检查和导出仍由 Planner 按真实目标选择。
 */
export interface DesignDisciplineContext {
    version: DesignDisciplineRuntimeVersion;
    active: boolean;
    spec?: DesignTaskTypeSpec;
    taskTypeId?: string;
    label?: string;
    /** 该任务类型的方法论工具（如 getDetailPageDesignFramework）；无专属时为 searchDesignKnowledge */
    frameworkToolName: string;
    /**
     * 该品类是否有可用的 renderLayout 阶段计划契约（从 spec.requiresStagePlanOnRender 派生）。
     * 这是方法提示，不是开放创意路径的写入门票；命中时只给出 advisory。
     */
    requiresStagePlan: boolean;
    /**
     * 新建画布前是否必须先读取参考输入（从 spec.requiresReferenceInputBeforeDocument 派生）。
     * 仅限明确声明“外部参考本身就是任务输入”的复刻类 Profile；普通开放设计、SKU 模板和
     * 规格化生产不得因为参考库离线而启用该硬门禁。启用时，在拿到 searchEagleReferences /
     * searchDesignKnowledge / analyzeAssetContent 等任一参考输入（或用户自带参考来源）之前，
     * createDocument 会被门禁拦下并指路。
     * 该门禁只检查是否已有参考输入，不限定获取路径；启用时参考类工具无条件放行并暴露给模型。
     */
    requiresReferenceInput: boolean;
    /**
     * 该品类的目标文档规范名（从 spec.canonicalDocumentName 派生）。
     * 用于 stagePlan.targetDocumentName 一致性校验；无则不做文档名校验。
     */
    canonicalDocumentName?: string;
    /**
     * 编辑模式：目标品类文档已在前台打开（activeDocumentName 含 canonicalDocumentName）——
     * 任务是存量修改而非从零设计。requiresStagePlan 自动降级；createDocument 被守卫拦下。
     * 只有 Harness 已从结构化目标判定为独立交付物时，才能通过可信授权放行。
     */
    editingExistingCanonicalDocument: boolean;
    /**
     * 用户是否给出了明确的参考来源（参考链接 / 复刻 / 对标）。
     * 由调用方（executor）基于其正则 helper 传入，runtime 不重造意图正则；默认 false。
     * 用于放行 reference 类工具（searchEagleReferences / searchDesignKnowledge / fetchWebPageDesignContent 等）。
     */
    hasReferenceSource: boolean;
}

export function resolveDesignDisciplineContext(input: {
    taskText?: string;
    isCreativeDesignIntent?: boolean;
    /**
     * 结构化声明的任务类型 id（评审修复 2026-07-03）：来自 Runtime Profile、移交契约
     * data.declaredDesignTaskTypeId 或模型自身声明。命中注册品类时**确定性激活**——优先于 taskText 关键词匹配，且不受
     * excludeSignals 文本启发式影响（确认卡重提交文本里的「出图」等措辞不再误杀纪律激活），
     * 也不要求 isCreativeDesignIntent（部分品类的控制面信号不含 explicit_creative_design）。
     * 数据驱动：只做 id 查表，不做任何文本猜测；未注册的 id 不激活（回落原有判定）。
     */
    declaredTaskTypeId?: string;
    /** 用户是否给出明确参考来源；由调用方基于其正则 helper 传入，默认 false。 */
    hasReferenceSource?: boolean;
    /**
     * 当前活动文档名（真机病例 2026-07-07）：目标品类文档已打开（如「详情页.psb」在前台）
     * 时，任务是对存量文档的修改而非从零设计——纪律进入编辑模式：不逐屏出稿（requiresStagePlan
     * 降级）、createDocument 被守卫拦下指路（曾在读取失败误导下于存量详情页旁另建空文档）。
     */
    activeDocumentName?: string;
}): DesignDisciplineContext {
    const declaredSpec = getDesignTaskTypeSpec(input.declaredTaskTypeId);
    let spec = declaredSpec || resolveDesignTaskTypeSpec(input.taskText);
    if (!spec && input.isCreativeDesignIntent && !hitsAnyDesignTaskExcludeSignal(input.taskText)) {
        // 通用兜底：确定是创意设计意图（isCreativeDesignIntent 来自控制面，非关键词）、不匹配任何
        // 具体品类（海报 / 小红书 / Banner …）、且不命中"非从零设计"排除信号（检查/填充/导出/保存）
        // → 仍继承通用设计纪律，不靠逐品类堆关键词（理解优于硬编码）。
        // generic 无 stagePlan / 无文档名校验 / 只用通用核心工具集。
        spec = GENERIC_DESIGN_TASK_TYPE;
    }
    const active = Boolean(declaredSpec) || (Boolean(input.isCreativeDesignIntent) && Boolean(spec));
    const hasReferenceSource = Boolean(input.hasReferenceSource);
    if (!active || !spec) {
        return {
            version: DESIGN_DISCIPLINE_POLICY_CAPABILITY_ID,
            active: false,
            frameworkToolName: 'searchDesignKnowledge',
            requiresStagePlan: false,
            requiresReferenceInput: false,
            editingExistingCanonicalDocument: false,
            hasReferenceSource
        };
    }
    // 编辑模式（真机病例 2026-07-07）：目标品类文档已在前台打开 → 任务是存量修改而非从零设计。
    // 从零纪律的两个假设不成立：不需要逐屏出稿（requiresStagePlan 降级），更不能新建同类文档
    // （createDocument 由守卫拦下指路 switchDocument——曾在「读取失败误导+从零纪律引导」叠加下
    // 于 116 层存量详情页旁另建空文档）。改后必看等纪律不受影响。
    const editingExistingCanonicalDocument = Boolean(
        spec.canonicalDocumentName
        && String(input.activeDocumentName || '').includes(spec.canonicalDocumentName)
    );
    return {
        version: DESIGN_DISCIPLINE_POLICY_CAPABILITY_ID,
        active: true,
        spec,
        taskTypeId: spec.id,
        label: spec.label,
        frameworkToolName: resolveFrameworkToolName(spec),
        requiresStagePlan: Boolean(spec.requiresStagePlanOnRender) && !editingExistingCanonicalDocument,
        requiresReferenceInput: Boolean(spec.requiresReferenceInputBeforeDocument),
        canonicalDocumentName: spec.canonicalDocumentName,
        editingExistingCanonicalDocument,
        hasReferenceSource
    };
}

/** 是否进入从零设计纪律（薄封装，便于 executor 直接替换 isFreshDetailPageDesignTask） */
export function isDesignDisciplineTask(input: {
    taskText?: string;
    isCreativeDesignIntent?: boolean;
}): boolean {
    return resolveDesignDisciplineContext(input).active;
}

/** 改动类工具（触发「改后必看」纪律） */
export const DESIGN_DISCIPLINE_MUTATION_TOOL_NAMES: ReadonlySet<string> = new Set([
    'renderLayout',
    'placeImage',
    'transformLayer',
    'fitLayerSubjectToRegion',
    'moveLayer',
    'setTextStyle',
    'setTextContent',
    'fixLayerIssues',
    'fillDetailPage',
    // replaceLayerContent 随放行集纳入（2026-07-02）：它替换画面内容，同样受
    // 「改后必看」与「不无限微调」纪律约束，不开无观察的写入旁路。
    'replaceLayerContent'
]);

/**
 * 是否为会改变 Photoshop 结果的设计动作。
 * 显式集合保留观察意图的稳定语义；Tool Registry 的执行分类补齐新增原子工具，
 * 避免每增加一个 Tool 都必须回到设计 Harness 手工登记才能触发「写后观察」。
 */
export function isDesignDisciplineMutationTool(
    toolName: string,
    classifiedAsPhotoshopMutation?: boolean
): boolean {
    if (classifiedAsPhotoshopMutation === true) return true;
    if (DESIGN_DISCIPLINE_MUTATION_TOOL_NAMES.has(toolName)) return true;
    if (toolName === 'createDocument') return false;
    return classifyPhotoshopToolSkillExecution(toolName) === 'photoshop_write';
}

/** 视觉/结构复核工具（满足「改后必看」） */
export const DESIGN_DISCIPLINE_VISUAL_REVIEW_TOOL_NAMES: ReadonlySet<string> = new Set([
    'getAcceptanceSnapshot',
    'getCanvasSnapshot',
    'getAnnotatedSnapshot',
    'getScreenSnapshots',
    'getScreenSnapshotsWithOverlay',
    'getLayerBounds',
    'getLayerProperties',
    'getAllTextLayers',
    'getClippingMaskInfo',
    'getAllClippingMasks'
]);

/** 保存/导出工具 */
export const DESIGN_DISCIPLINE_EXPORT_TOOL_NAMES: ReadonlySet<string> = new Set([
    'saveDocument',
    'quickExport',
    'smartSave',
    'exportDetailPageSlices',
    // 用户导出规范 4.0（2026-07-07）：主图/详情页批量导出，同受「改后未复核不许导出」纪律约束
    'exportMainImageDocuments'
]);

/**
 * 观察类工具（只读 / 打开既有 / 查看结构 / 看画面）——Harness「Observation 必须永远畅通」的载体。
 *
 * 设计纪律**绝不拦这些工具**（含建画布之前）：让 Agent 随时能打开并看清它被问的文件。
 * 真机病例（2026-07-08「帮我导出主图详情页」被误判从零设计）：openTemplate / getLayerHierarchy
 * 在建画布前被拦 → Agent 看不到"这其实是张做好的详情页" → 只能顺着牢笼去 createDocument。
 * 读不产生破坏性写入；防套版 / 防旁建空文档由写路径门禁与 2.2b 编辑模式保证，不靠"致盲"Agent。
 *
 * 刻意**不含**：
 *  - 方法论工具（getDetailPageDesignFramework 等）——受「读一次别重复读」停机约束；
 *  - 素材分析工具（analyzeAssetContent 等）——受「别反复分析空耗本轮」上限约束；
 *  - 参考检索（searchEagleReferences / searchDesignKnowledge）——有各自的参考通道处理。
 */
export const DESIGN_DISCIPLINE_OBSERVATION_TOOL_NAMES: ReadonlySet<string> = new Set([
    // 打开 / 切换既有文档
    'openTemplate',
    'openProjectFile',
    'openDocument',
    'listDocuments',
    'switchDocument',
    // 文档 / 画面读取
    'getDocumentInfo',
    'getDocumentSnapshot',
    'getCanvasSnapshot',
    'getAnnotatedSnapshot',
    'getAcceptanceSnapshot',
    'getScreenSnapshots',
    'getScreenSnapshotsWithOverlay',
    'diagnoseState',
    // 图层 / 文本 / 智能对象读取
    'getLayerHierarchy',
    'findLayers',
    'getLayerBounds',
    'getLayerProperties',
    'getAllTextLayers',
    'getClippingMaskInfo',
    'getAllClippingMasks',
    'getTextContent',
    'getTextStyle',
    'getSmartObjectInfo',
    'getSmartObjectLayers',
    'getElementMapping',
    'analyzeLayout',
    'getHistoryInfo',
    'getSkuPlaceholders'
]);

/** 是否为观察类工具（永远放行，不受设计纪律拦截）。 */
export function isDesignDisciplineObservationTool(toolName: string): boolean {
    return DESIGN_DISCIPLINE_OBSERVATION_TOOL_NAMES.has(toolName);
}

/**
 * 纯图像快照类工具：结果主体是像素图，不带可独立消费的结构化复核证据。
 * 视觉复核不可用时（无视觉能力 / 视觉预算耗尽），这类工具不能作为结构复核证据。
 */
const DESIGN_DISCIPLINE_IMAGE_SNAPSHOT_TOOLS: ReadonlySet<string> = new Set([
    'getCanvasSnapshot',
    'getAcceptanceSnapshot',
    'getScreenSnapshots',
    'getScreenSnapshotsWithOverlay'
]);

/**
 * 结构复核工具：观察类工具中除纯图像快照外的成员（图层层级/边界/文本/蒙版/布局读回等）。
 * 视觉复核不可用时，这些工具的成功结果可作为「改后必看」的结构化复核证据——
 * 纪律的意图是防止「不回头看画面就继续写/导出」，而不是要求一种能力并不存在的复核方式。
 */
export function isStructuralDesignReviewTool(toolName: string): boolean {
    return isDesignDisciplineObservationTool(toolName)
        && !DESIGN_DISCIPLINE_IMAGE_SNAPSHOT_TOOLS.has(toolName);
}

/**
 * 运行层视觉复核不可用的原因（agent.ts attachToolImageObservations 写入的 not_observed reason）。
 * 命中即表示「系统已尽力把画面交给视觉复核，但运行时确实做不到」——
 * 这不是模型的过错，纪律不应因此把写入/导出永久锁死。
 */
export const RUNTIME_VISUAL_REVIEW_BLOCKED_REASONS: ReadonlySet<string> = new Set([
    'no_visual_capability',
    'vision_candidate_budget_exhausted',
    'visual_analysis_budget_exhausted',
    'visual_expert_invalid_review',
    'visual_expert_failed'
]);

/** 判定一次视觉观察记录是否因运行时原因无法完成视觉复核。 */
export function isRuntimeVisualReviewBlocked(
    observation: { status?: string; reason?: string } | null | undefined
): boolean {
    return Boolean(
        observation
        && observation.status === 'not_observed'
        && observation.reason
        && RUNTIME_VISUAL_REVIEW_BLOCKED_REASONS.has(observation.reason)
    );
}

/**
 * 已消费参考内容的工具（参考先行门禁的数据来源，治理2026-08-01）。
 * 搜索候选、读取通用方法论或只发现一个参考 URL 不等于看过本任务目标参考，因此
 * searchEagleReferences、searchDesignKnowledge 和 design-reference-search 不能增加计数。
 * 当前计数仍是过渡结构；M4 TaskRun 必须进一步绑定 reference artifact identity。
 */
export const DESIGN_DISCIPLINE_REFERENCE_INPUT_TOOL_NAMES: ReadonlySet<string> = new Set([
    'analyzeAssetContent',
    'analyzeEagleReference',
    'measureReferenceComposition',
    'fetchWebPageDesignContent',
    // 设计源解析（PSD 知识库 P0）：设计师 PSD/PSB 的结构与度量是高保真参考输入
    'analyzePsdDesignSource',
    // 浏览器扩展读页/截图：用户浏览器里的参考页也属于参考输入
    'readBrowserPage',
    'captureBrowserTab',
    // Eagle 素材真实视觉观察（P3）：亲眼看过选中/检索到的 Eagle 素材当然是参考输入
    'observeEagleAsset'
]);

// ── 纪律状态机（纯函数 reducer，便于 smoke 与 executor 共用一套真相） ──

export interface DesignDisciplineState {
    documentCreated: boolean;
    layoutRendered: boolean;
    designKnowledgeReadCount: number;
    /** 参考输入计数（参考先行门禁）：DESIGN_DISCIPLINE_REFERENCE_INPUT_TOOL_NAMES 成功调用数 */
    referenceInputCount: number;
    frameworkReadCount: number;
    needsObservationAfterMutation: boolean;
    observationIntent?: DesignObservationIntent;
    repairAttemptCount: number;
    lastMutationToolName?: string;
}

export function createDesignDisciplineState(init?: Partial<DesignDisciplineState>): DesignDisciplineState {
    return {
        documentCreated: Boolean(init?.documentCreated),
        layoutRendered: Boolean(init?.layoutRendered),
        designKnowledgeReadCount: init?.designKnowledgeReadCount ?? 0,
        referenceInputCount: init?.referenceInputCount ?? 0,
        frameworkReadCount: init?.frameworkReadCount ?? 0,
        needsObservationAfterMutation: Boolean(init?.needsObservationAfterMutation),
        observationIntent: init?.observationIntent,
        repairAttemptCount: init?.repairAttemptCount ?? 0,
        lastMutationToolName: init?.lastMutationToolName
    };
}

/** 根据改动工具推断要做的观察意图（generic：置图/换图→image_fit、文字→text_readability、其余→stage_readiness） */
export function inferObservationIntentForTool(toolName: string): DesignObservationIntent {
    if (toolName === 'placeImage' || toolName === 'transformLayer' || toolName === 'replaceLayerContent') return 'image_fit';
    if (toolName === 'setTextStyle' || toolName === 'setTextContent') return 'text_readability';
    return 'stage_readiness';
}

/** 纯函数：把一次成功的工具调用推进到下一个纪律状态（不可变更新） */
export function applyDesignDisciplineProgress(
    state: DesignDisciplineState,
    toolName: string,
    succeeded: boolean,
    context: {
        frameworkToolName: string;
        isPhotoshopMutation?: boolean;
        /**
         * 只有截图图像已被主模型或视觉专家真实消费后才为 true。
         * 工具成功、坐标表读回或“图像已生成但预算不足”都不能冒充视觉复核。
         */
        visualReviewed?: boolean;
    }
): DesignDisciplineState {
    if (!succeeded) return state;
    const next: DesignDisciplineState = { ...state };
    const hadPendingObservation = next.needsObservationAfterMutation;

    if (toolName === 'createDocument') next.documentCreated = true;

    if (toolName === 'renderLayout') {
        next.layoutRendered = true;
        next.needsObservationAfterMutation = true;
        next.observationIntent = 'stage_readiness';
    }

    if (isDesignDisciplineMutationTool(toolName, context.isPhotoshopMutation)) {
        // 连续写入但尚未观察时累计修正次数；不再以「是否先调用 renderLayout」作为计数前提。
        if (hadPendingObservation) {
            next.repairAttemptCount += 1;
        }
        next.needsObservationAfterMutation = true;
        next.lastMutationToolName = toolName;
        // 对齐详情页守卫语义：置图/变换→image_fit、文字→text_readability、
        // 其他改动工具只在观察意图未设时落 stage_readiness（不覆盖已有的更具体意图，
        // 例如 transformLayer 设的 image_fit 不应被随后的 moveLayer 改写成 stage_readiness）。
        if (toolName === 'placeImage' || toolName === 'transformLayer' || toolName === 'replaceLayerContent') {
            next.observationIntent = 'image_fit';
        } else if (toolName === 'setTextStyle' || toolName === 'setTextContent') {
            next.observationIntent = 'text_readability';
        } else if (!next.observationIntent) {
            next.observationIntent = 'stage_readiness';
        }
    }

    if (
        toolName === 'searchDesignKnowledge'
        || toolName === 'getDesignPrinciples'
        || toolName === 'searchEagleReferences'
        || toolName === context.frameworkToolName
    ) {
        // searchEagleReferences：Eagle 素材参考检索也算"开稿前的设计依据"，让参考检索成为开稿纪律的一部分。
        // Tool 可达性由统一 Registry / Capability Resolver 管理；本纪律只记录成功读取，不维护暴露清单。
        next.designKnowledgeReadCount += 1;
    }
    if (DESIGN_DISCIPLINE_REFERENCE_INPUT_TOOL_NAMES.has(toolName)) {
        // 只记录已成功消费的参考内容；候选搜索与通用知识读取不能冒充目标参考观察。
        next.referenceInputCount += 1;
    }
    if (toolName === context.frameworkToolName) {
        next.frameworkReadCount += 1;
    }

    if (context.visualReviewed === true) {
        // 视觉观察记录可能由独立截图工具返回，也可能嵌在一个复合 Skill 的结果中。
        // `visualReviewed` 只能由 Harness 在真实消费图像后写入，因此无需再用工具名
        // 白名单否定复合结果；否则 Skill 已看完全部屏幕后仍会被“改后必看”卡住。
        next.needsObservationAfterMutation = false;
        next.repairAttemptCount = 0;
    }

    return next;
}

// ── 通用门禁：复现 freshDetailPage 的纪律顺序，但品类无关、文案用任务类型标签 ──

export interface DesignToolStateGuardResult {
    success: false;
    message: string;
    error: string;
    nextRequiredTool?: string;
    nextRequiredToolOptions?: string[];
    nextRequiredToolReason?: string;
    /** 命中的规则 id / 大类（由 evaluateDesignToolStateGuard 附加）：调用方据此决定拦截还是降级为提示。 */
    disciplineRuleId?: string;
    disciplineRuleCategory?: DisciplineRuleCategory;
}

/**
 * 设计路径宪法：不能证明本次动作必然错误的流程/审美纪律只提醒、不拦截。
 * 阶段计划、方法论读取次数、连续写入次数与保存前观察都可能提高质量，但它们不是开放创意
 * 的唯一正确路径。调用方照常执行工具，把 message 作为 advisory 交给模型；真实质量由读回、
 * 独立评价与用户验收承担。
 */
export const ADVISORY_DISCIPLINE_RULE_CATEGORIES: readonly DisciplineRuleCategory[] = Object.freeze([
    'stage-plan',
    'framework-halt',
    'redo-cap',
    'observe-before-export'
]);

export function isAdvisoryDisciplineGuardResult(result: DesignToolStateGuardResult | null | undefined): boolean {
    return Boolean(result?.disciplineRuleCategory)
        && ADVISORY_DISCIPLINE_RULE_CATEGORIES.includes(result!.disciplineRuleCategory!);
}

export interface DesignToolStateGuardInput {
    context: DesignDisciplineContext;
    state: DesignDisciplineState;
    toolName: string;
    /** 工具入参（renderLayout 的 stagePlan 校验需要）。 */
    toolParams?: Record<string, any>;
    /** Harness 统一 Tool Registry 的执行分类结果；用于识别 Skill bridge 内的 Photoshop 写入。 */
    isPhotoshopMutation?: boolean;
    /** 仅由 Harness 根据结构化执行目标签发；模型 Tool 参数不能提供或覆盖。 */
    trustedCreateDocumentAuthorization?: boolean;
}

/**
 * renderLayout 的通用阶段计划校验：结构由 creative-stage-plan 契约负责，
 * 文档规范名来自当前 Skill / 任务上下文。Harness 不推断任务品类，也不依赖详情页专属校验器。
 */
function validateDesignDisciplineStagePlan(
    context: DesignDisciplineContext,
    stagePlan: unknown
): { valid: boolean; blockers: string[] } {
    const expectedDocumentName = String(context.canonicalDocumentName || '').trim() || undefined;
    const base = validateCreativeStagePlan(stagePlan, { expectedDocumentName });
    return { valid: base.valid, blockers: base.blockers };
}

/**
 * 通用设计纪律评估：未激活时返回 null。流程与审美建议通过 advisory 返回；硬阻断仅保留
 * 能由结构化目标和真实状态证明会做错的情况（错误目标建档、缺失指定参考、无授权重复建档）。
 * 它不承担工具白名单、强制新建画布或强制 renderLayout 等路线选择。
 */
/**
 * 守卫计算上下文（computedCtx）：级联前算一次的共享前置 + 惰性缓存，供所有 DisciplineRule 复用。
 * 这是「policy-as-code」的求值环境——规则的 when/build 只读它，不各自重算，也不碰 input 之外的状态。
 */
interface DesignToolStateGuardComputedContext {
    context: DesignDisciplineContext;
    state: DesignDisciplineState;
    toolName: string;
    toolParams?: Record<string, any>;
    isPhotoshopMutation: boolean;
    trustedCreateDocumentAuthorization: boolean;
    /** 任务类型标签（context.label || '设计'），所有文案避免写死「详情页」。 */
    label: string;
    /** 该品类方法论工具（context.frameworkToolName）；block-1 的比较对象、多规则的指路目标。 */
    framework: string;
    /** 观察意图配置（含 purpose/observationTools/maxRepairAttempts）；block-2 与 block-7 消费。 */
    observation: DesignObservationRequirement;
    /** 微调上限下界保护（Math.max(1, observation.maxRepairAttempts)）；唯一消费点是 block-2。 */
    maxRepairAttempts: number;
    /**
     * 惰性缓存 block-0 的 stagePlan 校验结果：when 判「!valid」与 build 取「blockers.slice(0,4)」共用，
     * 只调用一次 validateDesignDisciplineStagePlan（纯函数），避免重复计算。
     */
    stagePlanValidation(): { valid: boolean; blockers: string[] };
}

/**
 * 规则大类（β 元数据，为未来单一 manifest 铺路）：便于审计与文档生成按类聚合，不参与判定。
 */
export type DisciplineRuleCategory =
    | 'stage-plan'
    | 'framework-halt'
    | 'redo-cap'
    | 'edit-mode'
    | 'reference-first'
    | 'no-recreate'
    | 'observe-before-export';

/**
 * 结构化治理历史（β 元数据）：把 note 里的历史修复来由拆成 { date, note } 条目，
 * 便于后续审计与文档生成机读；不参与判定，纯机构记忆。
 */
interface DisciplineRuleGovernanceEntry {
    /** 修复日期（YYYY-MM-DD），对应 note 里记录的真机病例/评审修复/Harness 修正。 */
    date: string;
    /** 该次修复的简述（来由）。 */
    note: string;
}

/**
 * 声明式纪律规则：把原来 evaluateDesignToolStateGuard 里的一条 if 块抽成
 * { id, category, note(治理注释/机构记忆), governanceHistory, when(命中判定), build(拦截结果) }。
 * 顺序即语义——数组顺序 = 原块顺序，后面的规则隐含「前面没命中」（级联早返回语义）。
 */
interface DisciplineRule {
    id: string;
    /** 规则大类（β 元数据）：审计/文档聚合用，不参与判定。 */
    category: DisciplineRuleCategory;
    /** 治理注释：记录该块的真实历史修复（机构记忆），不得丢失。 */
    note: string;
    /** 结构化治理历史（β 元数据，可选）：note 里带日期的关键修复的机读形式。 */
    governanceHistory?: DisciplineRuleGovernanceEntry[];
    when(ctx: DesignToolStateGuardComputedContext): boolean;
    build(ctx: DesignToolStateGuardComputedContext): DesignToolStateGuardResult;
}

/**
 * 有序设计纪律规则数组（policy-as-code）：从上到下第一个 when 命中即返回结果；
 * 是否阻断由规则 category 的 advisory / hard 分类决定。
 *
 * 顺序强相关（不可乱序）：
 *  - block-0(stagePlan) 先于 block-2(重做上限)：同为 renderLayout，优先给出更具体的计划建议。
 *  - createDocument 处理链：编辑现有文档保护 → 显式 reference-first policy → 防重复建档。
 *  - 写后观察是 Harness 不变量，不依赖是否使用 renderLayout。
 */
const DESIGN_TOOL_STATE_GUARD_RULES: readonly DisciplineRule[] = [
    {
        id: 'block-0-stageplan',
        category: 'stage-plan',
        note: '0) 已声明阶段计划契约的品类可在 renderLayout 携带 stagePlan。开放创意不以它作为写入门票；'
            + '文档名校验由 validateDesignDisciplineStagePlan 参数化，并作为 advisory 返回。',
        when: (c) =>
            c.toolName === 'renderLayout'
            && c.context.requiresStagePlan
            && !c.stagePlanValidation().valid,
        build: (c) => {
            const message = [
                `当前${c.label}能力提供可选的 stagePlan 契约；缺失或不完整不会阻断本次开放式构图，但可用于降低多阶段返工。`,
                ...c.stagePlanValidation().blockers.slice(0, 4)
            ].join('\n');
            return {
                success: false,
                message,
                error: message,
                nextRequiredTool: 'renderLayout',
                nextRequiredToolReason: `如果任务确实需要分阶段交付，可补充${c.label}阶段计划；简单单画面任务可直接依据当前目标继续。`
            };
        }
    },
    {
        id: 'block-1-framework-repeat',
        category: 'framework-halt',
        note: '1) 已读过方法论后再次读取通常浪费上下文；只提示复用已有知识，不把重复读取当执行失败。',
        when: (c) => c.toolName === c.framework && c.state.frameworkReadCount >= 1,
        build: (c) => {
            const nextRequiredTool = c.state.documentCreated
                ? 'getCanvasSnapshot'
                : 'getDesignProjectState';
            const message = `已经读取过${c.label}方法论，请基于已有知识和当前任务状态自主选择下一步，不要重复读取同一个方法论工具。`;
            return {
                success: false,
                message,
                error: message,
                nextRequiredTool,
                nextRequiredToolReason: c.state.documentCreated
                    ? '先观察当前画面，再由 Planner 决定继续修改、调用 Skill 或进入评价。'
                    : '先读取项目状态与已有上下文，再由 Planner 决定是否建档、编辑现有文档或补充输入。'
            };
        }
    },
    {
        id: 'block-2-mutation-cap',
        category: 'redo-cap',
        note: '2) 连续写入达到上限时先观察真实画面。该 Harness 不变量适用于所有 Photoshop 写工具，'
            + '不再把 renderLayout 当作唯一重置路径；观察成功后 reducer 会重置修正计数。',
        when: (c) =>
            isDesignDisciplineMutationTool(c.toolName, c.isPhotoshopMutation)
            && c.state.needsObservationAfterMutation
            && c.state.repairAttemptCount >= c.maxRepairAttempts,
        build: (c) => {
            const message = '当前阶段已经连续写入多次但还没有复核真实画面。请先观察，再根据当前画面决定继续修改、调整计划或收尾。';
            return {
                success: false,
                message,
                error: message,
                nextRequiredTool: c.observation.observationTools.includes('getAnnotatedSnapshot')
                    ? 'getAnnotatedSnapshot'
                    : 'getCanvasSnapshot',
                nextRequiredToolReason: `连续写入已达到当前观察阈值，需要先查看真实画面：${c.observation.purpose}`
            };
        }
    },
    {
        id: 'block-2.2b-editing-mode-createdoc',
        category: 'edit-mode',
        governanceHistory: [
            { date: '2026-07-07', note: '真机病例：在 116 层存量详情页旁另建空文档；编辑模式下 createDocument 必须由 Harness 的独立目标判定授权。' },
            { date: '2026-07-22', note: '移除模型可自行填写的伪确认参数；授权只来自结构化执行目标。' }
        ],
        note: '2.2b) 编辑模式（真机病例 2026-07-07）：目标品类文档已在前台打开时，任务是存量修改——'
            + '不允许再新建同类文档（曾在「读取失败误导 + 从零纪律引导」叠加下于 116 层存量详情页旁另建空文档）。'
            + '出口真实可达：直接在已打开文档上操作 / switchDocument 切回；另起新档必须由 Harness 先确认它是独立交付目标。',
        when: (c) =>
            c.toolName === 'createDocument'
            && c.context.editingExistingCanonicalDocument
            && !c.trustedCreateDocumentAuthorization,
        build: (c) => {
            const message = `目标「${c.context.canonicalDocumentName || c.label}」文档已经打开，本任务是对它的修改，不要新建文档。`
                + '请直接在已打开的文档上操作（必要时先 switchDocument 切到它）。另起新档必须作为独立交付目标重新发起，不能由模型参数自行确认。';
            return {
                success: false,
                message,
                error: message,
                nextRequiredTool: 'getDocumentInfo',
                nextRequiredToolOptions: [
                    'getDocumentInfo',
                    'getLayerHierarchy',
                    'switchDocument'
                ],
                nextRequiredToolReason: '存量修改任务应先确认已打开的目标文档和当前图层结构；目标不在前台时再切换，避免在旁边另建空文档造成双份画布。'
            };
        }
    },
    {
        id: 'block-2.3-reference-first',
        category: 'reference-first',
        governanceHistory: [
            { date: '2026-07-02', note: '参考先行门禁检查 referenceInputCount 与 hasReferenceSource；参考类工具无条件可达，保证指路可通行。' },
            { date: '2026-08-01', note: '候选搜索、通用知识与“来源存在”不再算已观察；只接受成功消费参考内容的工具结果。' }
        ],
        note: '2.3) 参考先行（治理2026-07-02）：仅对显式启用 requiresReferenceInput 的外部参考复刻类 Profile，'
            + '在新建画布前必须成功消费本任务指定的参考内容；搜索候选、读取通用知识或只看到参考链接都不构成观察证据。'
            + '当前过渡实现按消费工具计数，M4 必须进一步绑定 reference artifact identity。',
        when: (c) =>
            !c.state.documentCreated
            && c.toolName === 'createDocument'
            && c.context.requiresReferenceInput
            && c.state.referenceInputCount < 1,
        build: (c) => {
            const message = '本任务把外部参考指定为交付输入，但尚未取得该参考的可核查内容。'
                + '请先分析用户指定的图片、已选择的 Eagle 项或网页参考；只搜索候选或读取通用设计知识不能替代目标参考观察。';
            return {
                success: false,
                message,
                error: message,
                nextRequiredTool: 'analyzeAssetContent',
                nextRequiredToolReason: `${c.label}任务要求使用外部参考；先消费并记录目标参考的真实视觉内容，再开始画布制作。`
            };
        }
    },
    {
        id: 'block-5-no-recreate-document',
        category: 'no-recreate',
        governanceHistory: [
            { date: '2026-07-02', note: '补状态感知指路：未排版→renderLayout，已排版→getCanvasSnapshot。' }
        ],
        note: '5) 已建画布就别重复新建（门禁出口治理 2026-07-02：补状态感知指路，不再只说"不要做什么"）。'
            + '这是通用幂等保护，不规定后续必须使用 renderLayout。',
        when: (c) =>
            c.state.documentCreated
            && c.toolName === 'createDocument'
            && !c.trustedCreateDocumentAuthorization,
        build: (c) => {
            const message = `本轮已经创建了${c.label}画布，且当前动作没有另一份独立交付目标的可信授权；请在当前文档上继续，避免误建重复画布。`;
            return {
                success: false,
                message,
                error: message,
                nextRequiredTool: 'getDocumentInfo',
                nextRequiredToolReason: '先读取当前文档真实状态，再由 Planner 选择适合本任务的下一项能力。'
            };
        }
    },
    {
        id: 'block-7-observe-before-save',
        category: 'observe-before-export',
        note: '7) 改动后未复核就保存/导出时提示做针对性观察，但不把观察节奏当成开放创意写入门票。'
            + '它适用于任意 Photoshop 写入路径，不依赖是否调用 renderLayout。'
            + '依赖共享前置 observation（=state.observationIntent 映射 DESIGN_OBSERVATION_REQUIREMENTS，缺省 stage_readiness）。',
        when: (c) =>
            DESIGN_DISCIPLINE_EXPORT_TOOL_NAMES.has(c.toolName)
            && c.state.needsObservationAfterMutation,
        build: (c) => {
            const message = '当前阶段刚调整过画面，建议在交付声明前做一次针对性观察，确认可读性、遮挡与重叠；本次保存/导出仍会执行，并由真实读回与后续验收判断质量。';
            return {
                success: false,
                message,
                error: message,
                nextRequiredTool: c.observation.observationTools.includes('getAnnotatedSnapshot')
                    ? 'getAnnotatedSnapshot'
                    : 'getCanvasSnapshot',
                nextRequiredToolReason: `当前阶段刚调整过画面，需要先做针对性观察：${c.observation.purpose}`
            };
        }
    }
];

export function evaluateDesignToolStateGuard(
    input: DesignToolStateGuardInput
): DesignToolStateGuardResult | null {
    const { context, state, toolName } = input;
    // 顶层早返回 (a)：纪律未激活（品类未解析或未进入创意设计意图）时不拦截任何工具。
    if (!context.active || !context.spec) return null;

    // 顶层早返回 (b)：Harness「Observation 必须永远畅通」——设计纪律绝不拦只读/打开/查看类工具。
    // 让 Agent 随时能打开并看清它被问的文件——看到"这其实是张做好的详情页"，就能自己纠正
    // 关键词初判（把"导出既有"误判成"从零设计"）。读不产生破坏性写入，防套版/防旁建由写路径门禁保证。
    // 此早返回优先于全部规则，是「读旧文档结构是正当观察」的载体。
    if (isDesignDisciplineObservationTool(toolName)) return null;

    // 共享前置（级联前算一次，多规则复用）。
    const label = context.label || '设计';
    const framework = context.frameworkToolName;
    const observation = state.observationIntent
        ? DESIGN_OBSERVATION_REQUIREMENTS[state.observationIntent]
        : DESIGN_OBSERVATION_REQUIREMENTS.stage_readiness;
    const maxRepairAttempts = Math.max(1, observation.maxRepairAttempts);

    let cachedStagePlanValidation: { valid: boolean; blockers: string[] } | undefined;
    const ctx: DesignToolStateGuardComputedContext = {
        context,
        state,
        toolName,
        toolParams: input.toolParams,
        isPhotoshopMutation: input.isPhotoshopMutation === true,
        trustedCreateDocumentAuthorization: input.trustedCreateDocumentAuthorization === true,
        label,
        framework,
        observation,
        maxRepairAttempts,
        stagePlanValidation() {
            if (!cachedStagePlanValidation) {
                cachedStagePlanValidation = validateDesignDisciplineStagePlan(context, input.toolParams?.stagePlan);
            }
            return cachedStagePlanValidation;
        }
    };

    // 有序级联：第一个 when 命中即返回其 build 结果；全不命中 → null（放行）。
    // 结果附带规则 id / 大类，调用方据此区分「拦截」与「只提醒」（见 ADVISORY_DISCIPLINE_RULE_CATEGORIES）。
    for (const rule of DESIGN_TOOL_STATE_GUARD_RULES) {
        if (rule.when(ctx)) {
            return {
                ...rule.build(ctx),
                disciplineRuleId: rule.id,
                disciplineRuleCategory: rule.category
            };
        }
    }
    return null;
}

// ── 通用任务运行记录，品类无关 ──

export type DesignTaskRunStatus = 'completed' | 'needs_review' | 'partial' | 'failed';

export interface DesignTaskRunRecord {
    version: DesignDisciplineRuntimeVersion;
    status: DesignTaskRunStatus;
    canClaimOutputQuality: boolean;
    createdDocumentCount: number;
    renderedStageCount: number;
    mutationCount: number;
    observationCount: number;
    savedDocumentCount: number;
    /** 可展示产物数：已保存/导出数优先，否则回退到已排版阶段数（供 UI 概览用）。 */
    outputCount: number;
    warnings: string[];
}

export interface DesignTaskRunToolEntry {
    name: string;
    succeeded: boolean;
    /** 由统一 execution preflight 分类器提供；复合 Skill 与原子写入使用同一语义。 */
    isPhotoshopMutation?: boolean;
    /** 截图/快照只有被视觉模型实际复核后才算画面观察；工具调用成功本身不算。 */
    visualReviewed?: boolean;
    /** 复合 Skill 的真实返回值；仅用于从受限 toolResults 记录中派生内部保存/导出调用。 */
    result?: unknown;
}

function isRunRecordObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

interface NestedSuccessfulToolResult {
    toolName: string;
    result: Record<string, unknown>;
}

function collectNestedSuccessfulToolResults(value: unknown): NestedSuccessfulToolResult[] {
    const entries: NestedSuccessfulToolResult[] = [];
    const visited = new WeakSet<object>();
    let visitedNodeCount = 0;

    function visitContainer(container: unknown, depth: number): void {
        if (depth > 6 || visitedNodeCount >= 256 || !container || typeof container !== 'object') return;
        if (visited.has(container as object)) return;
        visited.add(container as object);
        visitedNodeCount += 1;

        if (Array.isArray(container)) {
            for (const item of container.slice(0, 96)) {
                if (!isRunRecordObject(item)) continue;
                const toolName = String(item.toolName || '').trim();
                const toolResult = item.result;
                if (toolName
                    && isRunRecordObject(toolResult)
                    && toolResult.success !== false
                    && item.success !== false) {
                    entries.push({ toolName, result: toolResult });
                }
                visitToolResultContainers(toolResult, depth + 1);
            }
            return;
        }
        visitToolResultContainers(container, depth + 1);
    }

    function visitToolResultContainers(container: unknown, depth: number): void {
        if (!isRunRecordObject(container) || depth > 6 || visitedNodeCount >= 256) return;
        for (const [key, child] of Object.entries(container)) {
            const normalizedKey = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
            if (normalizedKey === 'toolresults') {
                visitContainer(child, depth + 1);
                continue;
            }
            if (normalizedKey === 'data'
                || normalizedKey === 'result'
                || normalizedKey === 'output') {
                visitToolResultContainers(child, depth + 1);
            }
        }
    }

    visitToolResultContainers(value, 0);
    return entries;
}

function hasNonEmptyPath(value: unknown): boolean {
    return typeof value === 'string' && value.trim().length > 0;
}

/**
 * success:true 只代表 Tool 调用没有抛错，不代表真的产生交付文件。
 * 这里按交付 Tool 的结构化返回值验证至少一个真实文件/保存动作，空切片、零成功数
 * 或只有泛化 message 的结果都不计入运行记录。
 */
function hasStructuredDeliveryArtifact(
    toolName: string,
    result: Record<string, unknown>
): boolean {
    if (result.success === false) return false;
    if (toolName === 'exportDetailPageSlices') {
        const successCount = Math.max(0, Number(result.successCount || 0));
        const screens = Array.isArray(result.screens) ? result.screens : [];
        const files = Array.isArray(result.files) ? result.files : [];
        const screenPathCount = screens.filter((screen) => (
            isRunRecordObject(screen) && hasNonEmptyPath(screen.path)
        )).length;
        const filePathCount = files.filter(hasNonEmptyPath).length;
        return successCount > 0
            && Math.max(screenPathCount, filePathCount) >= successCount;
    }
    if (toolName === 'exportMainImageDocuments') {
        const files = [
            ...(Array.isArray(result.files) ? result.files : []),
            ...(Array.isArray(result.exportedFiles) ? result.exportedFiles : []),
            ...(Array.isArray(result.outputs) ? result.outputs : [])
        ];
        const explicitCount = Math.max(
            0,
            Number(result.successCount || 0),
            Number(result.exportedCount || 0)
        );
        const pathCount = files.filter((item) => (
            hasNonEmptyPath(item)
            || (isRunRecordObject(item)
                && (hasNonEmptyPath(item.path) || hasNonEmptyPath(item.outputPath)))
        )).length;
        return explicitCount > 0 && pathCount >= explicitCount;
    }
    if (toolName === 'quickExport') {
        return hasNonEmptyPath(result.path)
            || hasNonEmptyPath(result.outputPath)
            || hasNonEmptyPath(result.filePath)
            || hasNonEmptyPath(result.savePath)
            || hasNonEmptyPath(result.exportedPath);
    }
    if (toolName === 'saveDocument' || toolName === 'smartSave') {
        return result.saved === true
            || Number(result.saved || 0) > 0
            || hasNonEmptyPath(result.path)
            || hasNonEmptyPath(result.outputPath)
            || hasNonEmptyPath(result.filePath)
            || hasNonEmptyPath(result.documentPath)
            || hasNonEmptyPath(result.savePath)
            || hasNonEmptyPath(result.savedPath)
            || hasNonEmptyPath(result.exportedPath);
    }
    return false;
}

export function deriveDesignTaskRunRecord(input: {
    executionCompleted: boolean;
    overallSuccess: boolean;
    toolEntries: DesignTaskRunToolEntry[];
    label?: string;
    /**
     * 本轮是否承诺生成可交付文件。局部 edit_existing 可以只完成画面修改与改后复核；
     * 新建、套版、重设计和导出任务必须保存或导出。缺省 true 保持既有调用安全语义。
     */
    deliveryRequired?: boolean;
}): DesignTaskRunRecord {
    const ok = (entry: DesignTaskRunToolEntry) => entry.succeeded;
    const createdDocumentCount = input.toolEntries.filter((e) => e.name === 'createDocument' && ok(e)).length;
    const renderedStageCount = input.toolEntries.filter((e) => e.name === 'renderLayout' && ok(e)).length;
    const mutationCount = input.toolEntries.filter((e) => e.isPhotoshopMutation === true && ok(e)).length;
    // `visualReviewed` 是 Harness 基于真实图像消费写入的可信事实；它既可能属于
    // 独立截图 Tool，也可能属于携带嵌套 visualObservationBundle 的复合 Skill。
    const observationCount = input.toolEntries.filter((e) => (
        ok(e) && e.visualReviewed === true
    )).length;
    const topLevelSavedDocumentCount = input.toolEntries.filter((e) => (
        DESIGN_DISCIPLINE_EXPORT_TOOL_NAMES.has(e.name)
        && ok(e)
        && isRunRecordObject(e.result)
        && hasStructuredDeliveryArtifact(e.name, e.result)
    )).length;
    const nestedSavedDocumentCount = input.toolEntries.reduce((count, entry) => {
        if (!ok(entry)) return count;
        return count + collectNestedSuccessfulToolResults(entry.result)
            .filter((nested) => (
                DESIGN_DISCIPLINE_EXPORT_TOOL_NAMES.has(nested.toolName)
                && hasStructuredDeliveryArtifact(nested.toolName, nested.result)
            ))
            .length;
    }, 0);
    const savedDocumentCount = topLevelSavedDocumentCount + nestedSavedDocumentCount;
    const deliveryRequired = input.deliveryRequired !== false;
    const hasDesignAction = renderedStageCount > 0 || mutationCount > 0;

    const canClaimOutputQuality = input.executionCompleted
        && hasDesignAction
        && observationCount > 0
        && (!deliveryRequired || savedDocumentCount > 0);

    const status: DesignTaskRunStatus = canClaimOutputQuality
        ? 'completed'
        : !input.overallSuccess && !hasDesignAction
            ? 'failed'
            : hasDesignAction && observationCount > 0
                ? 'needs_review'
                : createdDocumentCount > 0 || hasDesignAction
                    ? 'partial'
                    : 'needs_review';

    const label = input.label || '设计';
    const warnings: string[] = [];
    if (!hasDesignAction) warnings.push(`尚未完成${label}画面写入。`);
    if (observationCount === 0) warnings.push(`尚未查看${label}真实画面。`);
    if (deliveryRequired && savedDocumentCount === 0) warnings.push(`尚未保存或导出${label}结果。`);

    return {
        version: DESIGN_DISCIPLINE_POLICY_CAPABILITY_ID,
        status,
        canClaimOutputQuality,
        createdDocumentCount,
        renderedStageCount,
        mutationCount,
        observationCount,
        savedDocumentCount,
        outputCount: savedDocumentCount || renderedStageCount || (mutationCount > 0 ? 1 : 0),
        warnings
    };
}
