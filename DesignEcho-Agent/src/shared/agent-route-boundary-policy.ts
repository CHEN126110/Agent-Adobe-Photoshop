import {
    getSkillById,
    isControlledRouteAutonomousEntrySkill
} from './skills/skill-declarations';

export type AgentRouteBoundaryVersion = 'agent-route-boundary-policy/v0';

export interface SimpleDeterministicRouteBoundaryInput {
    skillId?: string;
    hasVisibleModelReasoning: boolean;
    hasContextImage: boolean;
    /** 用户原始输入：长输入/多行正文不允许正则短路径抢跑（真机病例：文案内容被当成指令） */
    userInputText?: string;
}

export interface DeterministicRouteVetoInput {
    deterministicSkillId?: string;
    modelSkillId?: string;
    isRetryRoute?: boolean;
    isSkuIntent?: boolean;
    isMainImageDesignIntent?: boolean;
    isDocumentManagementIntent?: boolean;
    isLayoutReplicationIntent?: boolean;
    isDetailTemplateAuthoringIntent?: boolean;
    isMainImageTemplateAuthoringIntent?: boolean;
    isTemplateSaveIntent?: boolean;
}

export interface ConversationalRouteBoundaryInput {
    requestKind?: string;
    executionAuthorization?: string;
    allowsAutonomousExecution?: boolean;
    intentRequestsConversationalPath: boolean;
    lightweightIntentIsConversational: boolean;
    publicPlanConfirmed?: boolean;
}

export interface RouteBoundaryDecision {
    version: AgentRouteBoundaryVersion;
    allowed: boolean;
    reason: string;
    category: 'simple_mechanical_operation'
        | 'coordinator_workflow'
        | 'protected_deterministic_route'
        | 'business_or_open_design'
        | 'insufficient_context'
        | 'not_applicable';
}

const SIMPLE_DETERMINISTIC_SHORT_PATH_SKILLS = new Set<string>([
    'document-management',
    'layer-management',
    'text-font-replace'
]);

const COORDINATOR_WORKFLOW_SHORT_PATH_SKILLS = new Set<string>([
    'ecommerce-socks-design'
]);

export function isSimpleDeterministicShortPathSkill(skillId?: string): boolean {
    return Boolean(skillId && SIMPLE_DETERMINISTIC_SHORT_PATH_SKILLS.has(skillId));
}

export function isCoordinatorWorkflowShortPathSkill(skillId?: string): boolean {
    return Boolean(skillId && COORDINATOR_WORKFLOW_SHORT_PATH_SKILLS.has(skillId));
}

/**
 * 对话提示只能在控制面没有签发明确执行授权时决定最终路线。
 * 轻量意图用于改善普通对话体验，不能把“继续执行”“从刚才停止处继续”这类
 * 已授权任务从 autonomous runtime 降级为只回复文字。
 */
export function shouldEnterConversationalRoute(input: ConversationalRouteBoundaryInput): boolean {
    if (input.publicPlanConfirmed === true) return false;
    if (
        input.requestKind === 'autonomous_execution'
        && input.executionAuthorization === 'confirmed_tool_required'
        && input.allowsAutonomousExecution === true
    ) {
        return false;
    }
    return input.intentRequestsConversationalPath || input.lightweightIntentIsConversational;
}

// 业务/开放式设计 skill 从 SkillDeclaration.routeClass 派生（规范可插拔 skill·声明即单一真相源），
// 不再硬编码 skillId Set——business-workflow（主图/详情页/SKU）与 open-design（复刻/项目图分析/自主体）
// 一样不能走简单机械短路径。新增/移除这类 skill 只动声明，本策略零改动。
export function isBusinessOrOpenDesignSkill(skillId?: string): boolean {
    if (!skillId) return false;
    const routeClass = getSkillById(skillId)?.routeClass;
    return routeClass === 'business-workflow' || routeClass === 'open-design';
}

export function isMetadataOnlyProjectInventoryRoute(
    skillId?: string,
    params?: Record<string, unknown> | null
): boolean {
    if (skillId !== 'project-image-analysis') return false;
    if (!params || typeof params !== 'object') return false;
    return params.analysisMode === 'inventory'
        && Number(params.sampleSize ?? 0) === 0;
}

export function evaluateSimpleDeterministicRouteBoundary(
    input: SimpleDeterministicRouteBoundaryInput
): RouteBoundaryDecision {
    if (!input.skillId) {
        return makeBoundaryDecision(false, 'not_applicable', '没有确定性路由候选。');
    }

    if (isCoordinatorWorkflowShortPathSkill(input.skillId)) {
        return makeBoundaryDecision(true, 'coordinator_workflow', '父级协调 workflow 不直接替代子技能做设计判断，可以先启动并把设计决策交给子 Agent。');
    }

    if (input.hasContextImage) {
        return makeBoundaryDecision(false, 'business_or_open_design', '带图请求需要保留模型路由或自主规划。');
    }

    // 长输入/多行正文不允许正则短路径抢跑（真机病例 2026-07-07：用户给出待修改的四行文案，
    // 文案内容「从浅到深都很耐看」命中裸正则被当成图层明度排序指令直接执行）。
    // 输入越长，正则误击率越高、模型理解的价值越大——短路径只配吃"置顶这个图层"级的短指令。
    const userInputText = String(input.userInputText || '');
    if (userInputText && (userInputText.trim().length > 40 || /\r|\n/.test(userInputText.trim()))) {
        return makeBoundaryDecision(false, 'business_or_open_design', '输入较长或包含多行正文（可能含文案等自然语言内容），正则意图判定不可靠，交给模型理解后再执行。');
    }

    if (isBusinessOrOpenDesignSkill(input.skillId)) {
        return makeBoundaryDecision(false, 'business_or_open_design', '业务或开放式设计 skill 不能走简单短路径。');
    }

    if (!isSimpleDeterministicShortPathSkill(input.skillId)) {
        return makeBoundaryDecision(false, 'not_applicable', '该 skill 不是可短路径的机械 Photoshop 操作。');
    }

    return makeBoundaryDecision(true, 'simple_mechanical_operation', '命中安全机械 Photoshop 操作；写入安全由执行预检继续约束。');
}

export function evaluateDeterministicRouteVeto(
    input: DeterministicRouteVetoInput
): RouteBoundaryDecision {
    if (!input.deterministicSkillId || !input.modelSkillId) {
        return makeBoundaryDecision(false, 'not_applicable', '缺少确定性路由或模型路由结果。');
    }

    if (input.deterministicSkillId === input.modelSkillId) {
        return makeBoundaryDecision(false, 'not_applicable', '模型路由与确定性路由一致，不需要否决。');
    }

    if (input.isRetryRoute) {
        return makeBoundaryDecision(true, 'protected_deterministic_route', '重试反馈必须延续上一条已确认操作。');
    }

    if (
        isControlledRouteAutonomousEntrySkill(input.deterministicSkillId)
        && !isControlledRouteAutonomousEntrySkill(input.modelSkillId)
    ) {
        return makeBoundaryDecision(
            true,
            'protected_deterministic_route',
            '已由能力声明识别出的业务工作流不能被通用单步操作降级；应进入 Agent 循环完成主要目标。'
        );
    }

    if (
        input.deterministicSkillId === 'sku-batch'
        && input.isSkuIntent
    ) {
        return makeBoundaryDecision(true, 'protected_deterministic_route', '明确 SKU 执行请求不能被主图、详情页、父级全套工作流或开放式设计 skill 抢路由。');
    }

    if (input.deterministicSkillId === 'main-image-design' && input.isMainImageDesignIntent) {
        return makeBoundaryDecision(true, 'protected_deterministic_route', '明确主图、白底图、点击图或转化图请求不能被 SKU 编排抢路由。');
    }

    if (input.deterministicSkillId === 'document-management' && input.isDocumentManagementIntent) {
        return makeBoundaryDecision(true, 'protected_deterministic_route', '明确文档管理请求不能被业务 skill 抢路由。');
    }

    if (input.deterministicSkillId === 'layout-replication' && input.isLayoutReplicationIntent) {
        return makeBoundaryDecision(true, 'protected_deterministic_route', '带参考图复刻请求不能被其他设计 skill 抢路由。');
    }

    if (input.deterministicSkillId === 'save-current-template' && input.isTemplateSaveIntent) {
        return makeBoundaryDecision(true, 'protected_deterministic_route', '明确模板保存请求不能被其他设计 skill 抢路由。');
    }

    return makeBoundaryDecision(false, 'not_applicable', '确定性路由不构成安全否决，允许模型选择更合适的 skill。');
}

export function evaluateDeterministicNonExecutionProtection(
    _input: unknown
): RouteBoundaryDecision {
    // GATE-SIMPLIFY-005：原「模型非执行回复保护」用正则匹配模型回复文案并强制执行，
    // 属拦「说错」——按 AGENTS.md 分流判据降级为事后 warnings 后整体退役（该评估函数在
    // 生产代码零消费者，执行点已由完成契约推回/执行供给预留承接）。
    return makeBoundaryDecision(false, 'not_applicable', '回复文案正则强制执行已退役：模型回复不再被正则否决，事后告警由完成契约与执行点层负责。');
}

function makeBoundaryDecision(
    allowed: boolean,
    category: RouteBoundaryDecision['category'],
    reason: string
): RouteBoundaryDecision {
    return {
        version: 'agent-route-boundary-policy/v0',
        allowed,
        category,
        reason
    };
}
