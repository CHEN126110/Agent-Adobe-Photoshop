import type { DesignAgentOsScenario } from './design-agent-os-contracts';
import type { DesignKnowledgeResult } from './design-knowledge-search';

export type DesignIntelligencePlanStatus =
    | 'ready_for_tool_planning'
    | 'needs_model_design_decision'
    | 'needs_visual_evidence'
    | 'blocked';

export type DesignIntelligenceDecisionSource = 'model-agent' | 'manual' | 'missing';

export type DesignIntelligenceWorkflowPhase =
    | 'inspect'
    | 'analyze'
    | 'plan'
    | 'retouch'
    | 'compose'
    | 'export'
    | 'verify';

export interface DesignIntelligenceHierarchyDecision {
    primarySubject?: string;
    focalPoint?: string;
    informationPriority?: string[];
    whitespaceIntent?: string;
    layoutNotes?: string[];
}

export interface DesignIntelligenceColorDecision {
    paletteIntent?: string;
    primaryColors?: string[];
    accentColors?: string[];
    backgroundDirection?: string;
    contrastPlan?: string;
    avoid?: string[];
}

export interface DesignIntelligenceTypographyDecision {
    tone?: string;
    hierarchy?: string[];
    fontDirection?: string;
    spacingDirection?: string;
    avoid?: string[];
}

export interface DesignIntelligenceRetouchDecision {
    objectives?: string[];
    colorCorrection?: string;
    lighting?: string;
    cleanup?: string[];
    fabricOrMaterialHandling?: string;
    prohibitedEdits?: string[];
}

export interface DesignIntelligenceAssetDecision {
    selectionPrinciples?: string[];
    requiredEvidence?: string[];
    rejectRules?: string[];
}

export interface DesignIntelligenceWorkflowStep {
    phase: DesignIntelligenceWorkflowPhase;
    goal: string;
    allowedToolKinds?: string[];
    requiredEvidence?: string[];
}

export interface DesignIntelligenceAgentDecision {
    source?: Exclude<DesignIntelligenceDecisionSource, 'missing'>;
    designGoal?: string;
    productUnderstanding?: string[];
    audience?: string;
    hierarchy?: DesignIntelligenceHierarchyDecision;
    color?: DesignIntelligenceColorDecision;
    typography?: DesignIntelligenceTypographyDecision;
    retouch?: DesignIntelligenceRetouchDecision;
    assetSelection?: DesignIntelligenceAssetDecision;
    toolWorkflow?: DesignIntelligenceWorkflowStep[];
    acceptanceCriteria?: string[];
    risks?: string[];
    rationale?: string[];
}

export interface DesignIntelligenceEvidenceSummary {
    knowledgeResultCount: number;
    knowledgeAllowedUses: string[];
    localCaseCount: number;
    projectImageCount: number;
    visualInsightCount: number;
    pendingVisualAnalysisCount: number;
    memoryEvidenceStatus?: string;
}

export interface DesignIntelligencePlan {
    planVersion: 'design-intelligence-plan/v0';
    scenario: DesignAgentOsScenario;
    status: DesignIntelligencePlanStatus;
    decisionSource: DesignIntelligenceDecisionSource;
    designGoal: string;
    evidenceSummary: DesignIntelligenceEvidenceSummary;
    decisions: {
        productUnderstanding: string[];
        hierarchy: DesignIntelligenceHierarchyDecision;
        color: DesignIntelligenceColorDecision;
        typography: DesignIntelligenceTypographyDecision;
        retouch: DesignIntelligenceRetouchDecision;
        assetSelection: DesignIntelligenceAssetDecision;
    };
    toolUsePlan: {
        canPlanToolUse: boolean;
        canExecuteWriteTools: boolean;
        workflow: DesignIntelligenceWorkflowStep[];
        requiredBeforeExecution: string[];
        boundaries: string[];
    };
    acceptanceCriteria: string[];
    blockers: string[];
    warnings: string[];
    limitations: string[];
}

export interface DesignIntelligencePlanInput {
    userText?: string;
    scenario?: DesignAgentOsScenario;
    plannerReadiness?: string;
    knowledgeResults?: DesignKnowledgeResult[];
    projectContext?: {
        assetIndex?: {
            summary?: {
                totalImages?: number;
            };
        };
        visualInsightCache?: {
            summary?: {
                entriesWithInsight?: number;
            };
        };
        visualSamplingPlan?: {
            cacheSummary?: {
                shouldAnalyze?: number;
            };
        };
    } | null;
    memoryEvidence?: {
        status?: string;
    } | null;
    agentDecision?: DesignIntelligenceAgentDecision | null;
}

function cleanString(value: unknown): string {
    return String(value || '').trim();
}

function cleanStrings(values: unknown, limit = 8): string[] {
    if (!Array.isArray(values)) return [];
    return Array.from(new Set(values.map(cleanString).filter(Boolean))).slice(0, limit);
}

function cleanColorStrings(values: unknown): string[] {
    return cleanStrings(values, 8).filter((value) => value.length <= 40);
}

function isWorkflowPhase(value: unknown): value is DesignIntelligenceWorkflowPhase {
    return ['inspect', 'analyze', 'plan', 'retouch', 'compose', 'export', 'verify'].includes(String(value || ''));
}

function isDecisionSource(value: unknown): value is Exclude<DesignIntelligenceDecisionSource, 'missing'> {
    return value === 'model-agent' || value === 'manual';
}

function normalizeWorkflow(value: unknown): DesignIntelligenceWorkflowStep[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item): DesignIntelligenceWorkflowStep | null => {
            const record = item as Record<string, unknown>;
            const phase = record?.phase;
            const goal = cleanString(record?.goal);
            if (!isWorkflowPhase(phase) || !goal) return null;
            return {
                phase,
                goal,
                allowedToolKinds: cleanStrings(record.allowedToolKinds, 8),
                requiredEvidence: cleanStrings(record.requiredEvidence, 8)
            };
        })
        .filter((item): item is DesignIntelligenceWorkflowStep => Boolean(item))
        .slice(0, 12);
}

function normalizeAgentDecision(value: DesignIntelligenceAgentDecision | null | undefined): DesignIntelligenceAgentDecision | null {
    if (!value || typeof value !== 'object') return null;
    const normalized: DesignIntelligenceAgentDecision = {};
    if (isDecisionSource(value.source)) normalized.source = value.source;
    const designGoal = cleanString(value.designGoal);
    if (designGoal) normalized.designGoal = designGoal;
    const productUnderstanding = cleanStrings(value.productUnderstanding, 8);
    if (productUnderstanding.length) normalized.productUnderstanding = productUnderstanding;
    const audience = cleanString(value.audience);
    if (audience) normalized.audience = audience;

    const hierarchy = value.hierarchy || {};
    normalized.hierarchy = {
        primarySubject: cleanString(hierarchy.primarySubject) || undefined,
        focalPoint: cleanString(hierarchy.focalPoint) || undefined,
        informationPriority: cleanStrings(hierarchy.informationPriority, 8),
        whitespaceIntent: cleanString(hierarchy.whitespaceIntent) || undefined,
        layoutNotes: cleanStrings(hierarchy.layoutNotes, 8)
    };

    const color = value.color || {};
    normalized.color = {
        paletteIntent: cleanString(color.paletteIntent) || undefined,
        primaryColors: cleanColorStrings(color.primaryColors),
        accentColors: cleanColorStrings(color.accentColors),
        backgroundDirection: cleanString(color.backgroundDirection) || undefined,
        contrastPlan: cleanString(color.contrastPlan) || undefined,
        avoid: cleanStrings(color.avoid, 8)
    };

    const typography = value.typography || {};
    normalized.typography = {
        tone: cleanString(typography.tone) || undefined,
        hierarchy: cleanStrings(typography.hierarchy, 8),
        fontDirection: cleanString(typography.fontDirection) || undefined,
        spacingDirection: cleanString(typography.spacingDirection) || undefined,
        avoid: cleanStrings(typography.avoid, 8)
    };

    const retouch = value.retouch || {};
    normalized.retouch = {
        objectives: cleanStrings(retouch.objectives, 8),
        colorCorrection: cleanString(retouch.colorCorrection) || undefined,
        lighting: cleanString(retouch.lighting) || undefined,
        cleanup: cleanStrings(retouch.cleanup, 8),
        fabricOrMaterialHandling: cleanString(retouch.fabricOrMaterialHandling) || undefined,
        prohibitedEdits: cleanStrings(retouch.prohibitedEdits, 8)
    };

    const assetSelection = value.assetSelection || {};
    normalized.assetSelection = {
        selectionPrinciples: cleanStrings(assetSelection.selectionPrinciples, 8),
        requiredEvidence: cleanStrings(assetSelection.requiredEvidence, 8),
        rejectRules: cleanStrings(assetSelection.rejectRules, 8)
    };

    const workflow = normalizeWorkflow(value.toolWorkflow);
    if (workflow.length) normalized.toolWorkflow = workflow;
    const acceptanceCriteria = cleanStrings(value.acceptanceCriteria, 10);
    if (acceptanceCriteria.length) normalized.acceptanceCriteria = acceptanceCriteria;
    const risks = cleanStrings(value.risks, 8);
    if (risks.length) normalized.risks = risks;
    const rationale = cleanStrings(value.rationale, 8);
    if (rationale.length) normalized.rationale = rationale;

    const hasDecisionContent = Boolean(
        normalized.designGoal
        || normalized.productUnderstanding?.length
        || normalized.hierarchy?.primarySubject
        || normalized.hierarchy?.informationPriority?.length
        || normalized.color?.paletteIntent
        || normalized.color?.primaryColors?.length
        || normalized.typography?.tone
        || normalized.retouch?.objectives?.length
        || normalized.toolWorkflow?.length
        || normalized.acceptanceCriteria?.length
    );
    return hasDecisionContent ? normalized : null;
}

function hasVisualEvidence(input: DesignIntelligencePlanInput): boolean {
    const assetImages = Number(input.projectContext?.assetIndex?.summary?.totalImages || 0);
    const visualInsights = Number(input.projectContext?.visualInsightCache?.summary?.entriesWithInsight || 0);
    return assetImages > 0 || visualInsights > 0;
}

function buildEvidenceSummary(input: DesignIntelligencePlanInput): DesignIntelligenceEvidenceSummary {
    const knowledgeResults = Array.isArray(input.knowledgeResults) ? input.knowledgeResults : [];
    return {
        knowledgeResultCount: knowledgeResults.length,
        knowledgeAllowedUses: Array.from(new Set(knowledgeResults.flatMap((item) => item.allowedUses || []))).sort(),
        localCaseCount: knowledgeResults.filter((item) => item.sourceType === 'local_case').length,
        projectImageCount: Number(input.projectContext?.assetIndex?.summary?.totalImages || 0),
        visualInsightCount: Number(input.projectContext?.visualInsightCache?.summary?.entriesWithInsight || 0),
        pendingVisualAnalysisCount: Number(input.projectContext?.visualSamplingPlan?.cacheSummary?.shouldAnalyze || 0),
        memoryEvidenceStatus: cleanString(input.memoryEvidence?.status) || undefined
    };
}

function pendingHierarchy(): DesignIntelligenceHierarchyDecision {
    return {
        informationPriority: [],
        layoutNotes: ['待模型 Agent 基于产品证据、视觉素材和用户目标决定视觉层级。']
    };
}

function pendingColor(): DesignIntelligenceColorDecision {
    return {
        primaryColors: [],
        accentColors: [],
        avoid: ['不要由代码按关键词猜测配色。']
    };
}

function pendingTypography(): DesignIntelligenceTypographyDecision {
    return {
        hierarchy: [],
        avoid: ['不要由代码按场景固定标题、字体或字号。']
    };
}

function pendingRetouch(): DesignIntelligenceRetouchDecision {
    return {
        objectives: [],
        cleanup: [],
        prohibitedEdits: ['没有模型 Agent 决策和视觉证据时，不要自动调色、磨皮、液化或改变产品材质。']
    };
}

function pendingAssetSelection(): DesignIntelligenceAssetDecision {
    return {
        requiredEvidence: ['项目素材索引', '视觉理解结果', '用户或模型 Agent 的选图理由'],
        rejectRules: ['不能只靠文件名或目录名最终选图。']
    };
}

function countDecisionAreas(decision: DesignIntelligenceAgentDecision | null): number {
    if (!decision) return 0;
    return [
        Boolean(decision.designGoal),
        Boolean(decision.productUnderstanding?.length),
        Boolean(decision.hierarchy?.primarySubject || decision.hierarchy?.informationPriority?.length),
        Boolean(decision.color?.paletteIntent || decision.color?.primaryColors?.length),
        Boolean(decision.typography?.tone || decision.typography?.hierarchy?.length),
        Boolean(decision.retouch?.objectives?.length || decision.retouch?.colorCorrection || decision.retouch?.lighting),
        Boolean(decision.assetSelection?.selectionPrinciples?.length || decision.assetSelection?.requiredEvidence?.length),
        Boolean(decision.toolWorkflow?.length),
        Boolean(decision.acceptanceCriteria?.length)
    ].filter(Boolean).length;
}

function scenarioRequiresVisualEvidence(scenario: DesignAgentOsScenario): boolean {
    return ['main-image', 'detail-page', 'sku', 'reference-replication', 'general-design'].includes(scenario);
}

export function buildDesignIntelligencePlan(input: DesignIntelligencePlanInput): DesignIntelligencePlan {
    const scenario = input.scenario || 'general-design';
    const agentDecision = normalizeAgentDecision(input.agentDecision);
    const decisionSource: DesignIntelligenceDecisionSource = agentDecision?.source || (agentDecision ? 'model-agent' : 'missing');
    const decisionAreas = countDecisionAreas(agentDecision);
    const evidenceSummary = buildEvidenceSummary(input);
    const blockers: string[] = [];
    const warnings: string[] = [];
    const requiredBeforeExecution: string[] = [];

    if (!agentDecision) {
        requiredBeforeExecution.push('model-agent-design-decision');
        warnings.push('缺少模型 Agent 的设计判断：不能把工具可用性当作设计计划。');
    }
    if (scenarioRequiresVisualEvidence(scenario) && !hasVisualEvidence(input)) {
        requiredBeforeExecution.push('project-visual-evidence');
        warnings.push('缺少项目视觉证据：调色、修图、选图和排版只能停在计划层。');
    }
    if (input.plannerReadiness === 'blocked') {
        blockers.push('上游 Design Planner readiness=blocked。');
    }
    if (evidenceSummary.knowledgeAllowedUses.includes('direct_photoshop_action')) {
        blockers.push('知识结果不能包含 direct_photoshop_action。');
    }

    const hasWorkflow = Boolean(agentDecision?.toolWorkflow?.length);
    const hasAcceptance = Boolean(agentDecision?.acceptanceCriteria?.length);
    const hasEnoughDecision = decisionAreas >= 4 && hasWorkflow && hasAcceptance;
    const status: DesignIntelligencePlanStatus = blockers.length > 0
        ? 'blocked'
        : !agentDecision || !hasEnoughDecision
            ? 'needs_model_design_decision'
            : scenarioRequiresVisualEvidence(scenario) && !hasVisualEvidence(input)
                ? 'needs_visual_evidence'
                : 'ready_for_tool_planning';

    const canPlanToolUse = status === 'ready_for_tool_planning' || status === 'needs_visual_evidence';
    const canExecuteWriteTools = status === 'ready_for_tool_planning';

    return {
        planVersion: 'design-intelligence-plan/v0',
        scenario,
        status,
        decisionSource,
        designGoal: agentDecision?.designGoal || cleanString(input.userText) || '待模型 Agent 明确设计目标。',
        evidenceSummary,
        decisions: {
            productUnderstanding: agentDecision?.productUnderstanding || [],
            hierarchy: agentDecision?.hierarchy || pendingHierarchy(),
            color: agentDecision?.color || pendingColor(),
            typography: agentDecision?.typography || pendingTypography(),
            retouch: agentDecision?.retouch || pendingRetouch(),
            assetSelection: agentDecision?.assetSelection || pendingAssetSelection()
        },
        toolUsePlan: {
            canPlanToolUse,
            canExecuteWriteTools,
            workflow: agentDecision?.toolWorkflow || [],
            requiredBeforeExecution,
            boundaries: [
                'Design Intelligence Plan 只决定设计与工具使用边界，不直接调用 Photoshop。',
                '调色、修图、排版、文案和选图必须来自模型 Agent / 人工决策 / 已验证知识证据。',
                'UXP 工具只执行白名单操作，执行后仍需要读回、截图或人工验收。'
            ]
        },
        acceptanceCriteria: agentDecision?.acceptanceCriteria || [
            '待模型 Agent 明确可验收的视觉、文案、素材和导出标准。'
        ],
        blockers,
        warnings: [
            ...warnings,
            ...(agentDecision?.risks || [])
        ],
        limitations: [
            '该计划不包含私有推理链，不输出未经证据校验的评分。',
            '知识库和用户偏好只能作为设计上下文，不能直接变成 Photoshop 写入动作。',
            '工具链成功不等于审美、转化或商业质量通过。'
        ]
    };
}
