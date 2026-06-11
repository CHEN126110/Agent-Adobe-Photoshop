export type AgentRouteBoundaryVersion = 'agent-route-boundary-policy/v0';

export interface SimpleDeterministicRouteBoundaryInput {
    skillId?: string;
    hasVisibleModelReasoning: boolean;
    hasContextImage: boolean;
}

export interface DeterministicRouteVetoInput {
    deterministicSkillId?: string;
    modelSkillId?: string;
    isRetryRoute?: boolean;
    isSkuIntent?: boolean;
    isDocumentManagementIntent?: boolean;
    isLayoutReplicationIntent?: boolean;
    isDetailTemplateAuthoringIntent?: boolean;
    isMainImageTemplateAuthoringIntent?: boolean;
}

export interface RouteBoundaryDecision {
    version: AgentRouteBoundaryVersion;
    allowed: boolean;
    reason: string;
    category: 'simple_mechanical_operation'
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

const BUSINESS_OR_OPEN_DESIGN_SKILLS = new Set<string>([
    'sku-batch',
    'main-image-design',
    'main-image-template-authoring',
    'detail-page-design',
    'detail-page-template-authoring',
    'layout-replication',
    'ecommerce-socks-design',
    'project-image-analysis',
    'autonomous-agent'
]);

export function isSimpleDeterministicShortPathSkill(skillId?: string): boolean {
    return Boolean(skillId && SIMPLE_DETERMINISTIC_SHORT_PATH_SKILLS.has(skillId));
}

export function isBusinessOrOpenDesignSkill(skillId?: string): boolean {
    return Boolean(skillId && BUSINESS_OR_OPEN_DESIGN_SKILLS.has(skillId));
}

export function evaluateSimpleDeterministicRouteBoundary(
    input: SimpleDeterministicRouteBoundaryInput
): RouteBoundaryDecision {
    if (!input.skillId) {
        return makeBoundaryDecision(false, 'not_applicable', '没有确定性路由候选。');
    }

    if (!input.hasVisibleModelReasoning) {
        return makeBoundaryDecision(false, 'insufficient_context', '缺少模型公开判断，不能跳过隐藏 router。');
    }

    if (input.hasContextImage) {
        return makeBoundaryDecision(false, 'business_or_open_design', '带图请求需要保留模型路由或自主规划。');
    }

    if (isBusinessOrOpenDesignSkill(input.skillId)) {
        return makeBoundaryDecision(false, 'business_or_open_design', '业务或开放式设计 skill 不能走简单短路径。');
    }

    if (!isSimpleDeterministicShortPathSkill(input.skillId)) {
        return makeBoundaryDecision(false, 'not_applicable', '该 skill 不是可短路径的机械 Photoshop 操作。');
    }

    return makeBoundaryDecision(true, 'simple_mechanical_operation', '已获得模型公开判断，且命中安全机械 Photoshop 操作。');
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
        input.deterministicSkillId === 'sku-batch'
        && input.isSkuIntent
        && input.modelSkillId !== 'ecommerce-socks-design'
    ) {
        return makeBoundaryDecision(true, 'protected_deterministic_route', '明确 SKU 执行请求不能被主图、详情页或开放式设计 skill 抢路由。');
    }

    if (input.deterministicSkillId === 'document-management' && input.isDocumentManagementIntent) {
        return makeBoundaryDecision(true, 'protected_deterministic_route', '明确文档管理请求不能被业务 skill 抢路由。');
    }

    if (input.deterministicSkillId === 'layout-replication' && input.isLayoutReplicationIntent) {
        return makeBoundaryDecision(true, 'protected_deterministic_route', '带参考图复刻请求不能被其他设计 skill 抢路由。');
    }

    if (input.deterministicSkillId === 'detail-page-template-authoring' && input.isDetailTemplateAuthoringIntent) {
        return makeBoundaryDecision(true, 'protected_deterministic_route', '明确详情页模板创建请求不能被开放式详情页执行抢路由。');
    }

    if (input.deterministicSkillId === 'main-image-template-authoring' && input.isMainImageTemplateAuthoringIntent) {
        return makeBoundaryDecision(true, 'protected_deterministic_route', '明确主图模板创建请求不能被开放式主图执行抢路由。');
    }

    return makeBoundaryDecision(false, 'not_applicable', '确定性路由不构成安全否决，允许模型选择更合适的 skill。');
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
