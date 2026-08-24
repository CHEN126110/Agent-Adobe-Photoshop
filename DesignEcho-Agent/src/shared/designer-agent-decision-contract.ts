import type {
    DesignIntelligenceAgentDecision,
    DesignIntelligenceWorkflowPhase
} from './design-intelligence-plan';
import type { DesignAgentOsScenario } from './design-agent-os-contracts';
import {
    DESIGN_OBSERVATION_REQUIREMENTS,
    type DesignObservationIntent
} from './design-observation-intents';
import { hasConcreteProjectVisualInsight } from './project-visual-sampling';

export type DesignerAgentDecisionStatus =
    | 'ready'
    | 'needs_design_decision'
    | 'needs_visual_observation';

export interface DesignerAgentObservationGoal {
    intent: DesignObservationIntent;
    purpose: string;
    reviewSignals: string[];
}

export interface DesignerAgentDecisionOption {
    id: string;
    label: string;
    whenUseful: string;
    possibleActions: string[];
    userFacingReason: string;
}

export interface DesignerAgentDecisionContractInput {
    userTask?: string;
    scenario?: DesignAgentOsScenario;
    /**
     * 仅用于已有视觉事实的诊断与摘要。缓存是否存在不能授予或阻止执行。
     */
    visualInsightCache?: unknown;
    /**
     * 上游已经产生时可作为工作笔记使用；不是自主 Agent 开工前必填的表单。
     */
    agentDecision?: DesignIntelligenceAgentDecision | null;
}

export function resolveDesignerAgentProjectVisualObservation(input: {
    visualInsightCache?: unknown;
}): boolean {
    const visualCache = input.visualInsightCache as Record<string, any> | undefined;
    if (!visualCache || ['missing', 'invalid'].includes(String(visualCache.source || ''))) return false;
    return Array.isArray(visualCache.entries) && visualCache.entries.some((entry: unknown) => {
        if (!entry || typeof entry !== 'object') return false;
        const insight = (entry as Record<string, any>).insight;
        return hasConcreteProjectVisualInsight(insight);
    });
}

export interface DesignerAgentDecisionContract {
    version: 'designer-agent-decision-contract/v0';
    status: DesignerAgentDecisionStatus;
    scenario: DesignAgentOsScenario;
    publicDesignIntent: string;
    publicObservationGoals: DesignerAgentObservationGoal[];
    decisionOptions: DesignerAgentDecisionOption[];
    toolUseGuidance: string[];
    blockers: string[];
    boundaries: string[];
    promptSection: string;
}

function cleanString(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function cleanStrings(values: unknown, limit = 6): string[] {
    if (!Array.isArray(values)) return [];
    return Array.from(new Set(values.map(cleanString).filter(Boolean))).slice(0, limit);
}

/**
 * v0 结构保留旧 status 联合类型，避免破坏外部消费者；当前生产语义是
 * “可以把已有判断作为上下文”，不是“表单填完才许执行”。
 */
function resolveStatus(_input: DesignerAgentDecisionContractInput): DesignerAgentDecisionStatus {
    return 'ready';
}

function mapWorkflowPhaseToObservationIntent(phase: DesignIntelligenceWorkflowPhase | undefined): DesignObservationIntent | undefined {
    if (phase === 'inspect' || phase === 'analyze') return 'image_fit';
    if (phase === 'compose') return 'layout_balance';
    if (phase === 'retouch') return 'visual_hierarchy';
    if (phase === 'verify') return 'stage_readiness';
    if (phase === 'export') return 'export_readiness';
    return undefined;
}

function inferObservationIntents(decision?: DesignIntelligenceAgentDecision | null): DesignObservationIntent[] {
    const intents = new Set<DesignObservationIntent>();
    const workflow = Array.isArray(decision?.toolWorkflow) ? decision.toolWorkflow : [];
    for (const step of workflow) {
        const intent = mapWorkflowPhaseToObservationIntent(step.phase);
        if (intent) intents.add(intent);
    }
    if (cleanStrings(decision?.assetSelection?.selectionPrinciples).length || cleanString(decision?.hierarchy?.primarySubject)) {
        intents.add('image_fit');
    }
    if (cleanStrings(decision?.hierarchy?.informationPriority).length || cleanString(decision?.typography?.tone)) {
        intents.add('text_readability');
    }
    if (cleanString(decision?.color?.paletteIntent)) {
        intents.add('visual_hierarchy');
    }
    if (cleanStrings(decision?.acceptanceCriteria).some((item) => /导出|保存|交付/.test(item))) {
        intents.add('export_readiness');
    }
    return Array.from(intents).slice(0, 5);
}

function buildObservationGoals(decision?: DesignIntelligenceAgentDecision | null): DesignerAgentObservationGoal[] {
    return inferObservationIntents(decision)
        .map((intent) => DESIGN_OBSERVATION_REQUIREMENTS[intent])
        .filter(Boolean)
        .map((requirement) => ({
            intent: requirement.intent,
            purpose: requirement.purpose,
            reviewSignals: requirement.reviewSignals.slice(0, 4)
        }));
}

function buildPublicDesignIntent(input: DesignerAgentDecisionContractInput): string {
    const decision = input.agentDecision;
    const pieces: string[] = [];
    const goal = cleanString(decision?.designGoal) || cleanString(input.userTask);
    if (goal) pieces.push(`目标：${goal}`);
    const productUnderstanding = cleanStrings(decision?.productUnderstanding, 4);
    if (productUnderstanding.length) pieces.push(`产品理解：${productUnderstanding.join('、')}`);
    const primarySubject = cleanString(decision?.hierarchy?.primarySubject);
    if (primarySubject) pieces.push(`第一视觉：${primarySubject}`);
    const priorities = cleanStrings(decision?.hierarchy?.informationPriority, 4);
    if (priorities.length) pieces.push(`信息层级：${priorities.join(' > ')}`);
    const palette = cleanString(decision?.color?.paletteIntent);
    if (palette) pieces.push(`配色意图：${palette}`);
    const tone = cleanString(decision?.typography?.tone);
    if (tone) pieces.push(`文字气质：${tone}`);
    return pieces.join('；') || '当前目标由用户指令与本轮真实上下文共同确定。';
}

function buildToolUseGuidance(): string[] {
    return [
        '这份内容是可选的设计上下文，不是写入门票。没有结构化设计表、工具步骤或验收清单时，Agent 仍根据目标、已知事实与当前结果自主判断。',
        '是否需要观察、查参考或请求队友，由 Agent 根据当前决策的信息增益选择；不因缺少项目视觉缓存而例行阻止可逆创作。',
        '要修改既有 Photoshop 对象时，目标文档、对象身份和 revision 仍必须来自当前读取；权限、副作用与写入目标仍由执行边界确定性校验。',
        '产生有意义的画面修改后，在会影响下一步判断的节点或交付前取得与目标 / revision 对应的必要结构或画面读回；不强迫每个原子动作后都截图。'
    ];
}

function buildDecisionOptions(): DesignerAgentDecisionOption[] {
    return [
        {
            id: 'act_with_current_judgment',
            label: '用当前判断推进',
            whenUseful: '目标、必要事实与写入对象已经足够明确。',
            possibleActions: [
                '直接完成当前最有信息量的可逆动作。',
                '根据真实结果继续、修订或换方向。'
            ],
            userFacingReason: '已有信息足够时直接制作，不用仪式性分析推迟实际结果。'
        },
        {
            id: 'inspect_decision_relevant_fact',
            label: '取得会改变决策的事实',
            whenUseful: '某个可观察事实会实质改变下一步或写入目标。',
            possibleActions: [
                '定向读取项目素材、当前文档、对象属性或必要画面。',
                '只把真实观察当事实，完成决策后停止重复读取。'
            ],
            userFacingReason: '只补会影响决策的真实信息，不做全量扫描。'
        },
        {
            id: 'ask_user_owned_fact',
            label: '询问最小必要的业务事实',
            whenUseful: '缺少的内容只有用户知道，且不同答案会实质改变交付、合规或不可逆后果。',
            possibleActions: [
                '只问一个会改变当前执行方向的问题。',
                '普通可逆审美取舍由 Agent 给出专业选择并继续。'
            ],
            userFacingReason: '用户只承担它真正拥有的业务决策，不代替 Agent 做专业设计。'
        }
    ];
}

function buildPromptSection(contract: Omit<DesignerAgentDecisionContract, 'promptSection'>): string {
    const lines = [
        '【设计判断支持（非门禁）】',
        `已有目标与判断：${contract.publicDesignIntent}`,
        '可选行动（按当前情境选择，没有固定顺序）：',
        ...contract.decisionOptions.map((option, index) => {
            const actions = option.possibleActions.length
                ? `；可做：${option.possibleActions.slice(0, 2).join(' / ')}`
                : '';
            return `${index + 1}. ${option.label}：${option.whenUseful}${actions}`;
        }),
        ...contract.publicObservationGoals.length > 0
            ? [
                '已有判断建议关注：',
                ...contract.publicObservationGoals.map((goal, index) => `${index + 1}. ${goal.purpose}`)
            ]
            : [],
        '执行与安全边界：',
        ...contract.toolUseGuidance.map((item, index) => `${index + 1}. ${item}`)
    ];
    return lines.join('\n');
}

export function buildDesignerAgentDecisionContract(
    input: DesignerAgentDecisionContractInput
): DesignerAgentDecisionContract {
    const scenario = input.scenario || 'general-design';
    const status = resolveStatus(input);
    const base = {
        version: 'designer-agent-decision-contract/v0' as const,
        status,
        scenario,
        publicDesignIntent: buildPublicDesignIntent(input),
        publicObservationGoals: buildObservationGoals(input.agentDecision),
        decisionOptions: buildDecisionOptions(),
        toolUseGuidance: buildToolUseGuidance(),
        blockers: [],
        boundaries: [
            '设计意图、观察重点和行动路线由 Agent 判断；Harness 不根据表单完整度代替它选择路线。',
            '结构化设计判断只是可选工作笔记，不授权工具、不推进阶段、不声明完成。',
            '知识、记忆、参考和专业队友只辅助判断，不替代当前项目事实或真实画面读回。',
            '执行权限、目标 / revision、写入安全和必要验真仍由确定性执行边界负责。'
        ]
    };
    return {
        ...base,
        promptSection: buildPromptSection(base)
    };
}

export function buildDesignerAgentPromptSection(
    input: DesignerAgentDecisionContractInput
): string {
    return buildDesignerAgentDecisionContract(input).promptSection;
}
