import type { DesignAgentOsScenario } from './design-agent-os-contracts';
import type { DesignerAgentDecisionStatus } from './designer-agent-decision-contract';
import type { RuntimeDesignWorkMode } from './agent-runtime-v5/contracts';
import type { DesignTeammateRole } from './types/design-team.types';

export type DesignerAgentTeamConsultationStatus =
    | 'not_required'
    | 'recommended'
    | 'required';

export type DesignerAgentTeamConsultationMode =
    | 'none'
    | 'advisory'
    | 'pipeline';

export interface DesignerAgentTeamConsultationContractInput {
    userTask?: string;
    scenario?: DesignAgentOsScenario;
    decisionStatus?: DesignerAgentDecisionStatus;
    explicitTeamRequest?: boolean;
    workMode?: RuntimeDesignWorkMode;
    /**
     * 只有结构化调用方或主 Agent 明确选择的可选专业角色。
     * 完整流水线默认仍包含观察、策略、执行和评审，但不会因为品类名称自动加入营销研究或文案。
     */
    specialistRoles?: Array<'market-researcher' | 'copywriter'>;
}

export interface DesignerAgentTeamRolePlan {
    role: DesignTeammateRole;
    purpose: string;
    phase: 'before_write' | 'after_draft' | 'after_write';
    requiredDeliverables: string[];
}

export interface DesignerAgentTeamConsultationContract {
    version: 'designer-agent-team-consultation-contract/v0';
    status: DesignerAgentTeamConsultationStatus;
    mode: DesignerAgentTeamConsultationMode;
    scenario: DesignAgentOsScenario;
    publicTeamIntent: string;
    rolePlan: DesignerAgentTeamRolePlan[];
    toolGuidance: string[];
    boundaries: string[];
    promptSection: string;
}

export interface DesignerAgentTeamConsultationProgressInput {
    contract?: DesignerAgentTeamConsultationContract | null;
    completedRoles?: DesignTeammateRole[];
    pipelineCompleted?: boolean;
    /** Coordinator 的写后 Runtime 视觉回执绑定 critic 结论；pipeline 执行完不等于质量通过。 */
    pipelineQualityPassed?: boolean;
    /**
     * 流水线后或独立委派的最新 Critic 机读裁决；调用方只有在同一次 Critic
     * 运行取得 Agent Runtime 签发的视觉回执时才可传 true。
     * undefined 表示尚无新裁决；false 覆盖较旧的 pass，防止修订后沿用过期质量信用。
     */
    criticQualityPassed?: boolean;
    phase?: DesignerAgentTeamRolePlan['phase'];
}

export interface DesignerAgentTeamConsultationProgress {
    readyForWrite: boolean;
    qualityPassed: boolean;
    requiredRoles: DesignTeammateRole[];
    completedRoles: DesignTeammateRole[];
    missingRoles: DesignTeammateRole[];
    nextRequiredRole?: DesignTeammateRole;
    publicMessage: string;
}

function cleanText(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function resolveScenario(input: DesignerAgentTeamConsultationContractInput): DesignAgentOsScenario {
    return input.scenario || 'general-design';
}

function isDesignScenario(scenario: DesignAgentOsScenario): boolean {
    return ['main-image', 'detail-page', 'sku', 'reference-replication', 'general-design'].includes(scenario);
}

function resolveStatus(input: DesignerAgentTeamConsultationContractInput): DesignerAgentTeamConsultationStatus {
    const scenario = resolveScenario(input);
    if (!isDesignScenario(scenario)) return 'not_required';
    if (input.explicitTeamRequest) return 'required';
    if (['edit_existing', 'analyze_only', 'export_only'].includes(input.workMode || '')) {
        return 'not_required';
    }
    if (input.decisionStatus === 'needs_design_decision') return 'recommended';
    if (['main-image', 'detail-page', 'sku', 'reference-replication'].includes(scenario)) {
        return 'recommended';
    }
    return 'not_required';
}

function resolveMode(
    status: DesignerAgentTeamConsultationStatus,
    input: DesignerAgentTeamConsultationContractInput
): DesignerAgentTeamConsultationMode {
    if (status === 'not_required') return 'none';
    if (status === 'required' && input.explicitTeamRequest) {
        return 'pipeline';
    }
    return 'advisory';
}

function buildAdvisoryRolePlan(): DesignerAgentTeamRolePlan[] {
    return [{
        role: 'design-strategist',
        purpose: '只在主 Agent 对视觉方向、信息层级或版式取舍存在明确不确定性时，提供一次聚焦建议。',
        phase: 'before_write',
        requiredDeliverables: [
            '针对当前不确定点给出一个可执行建议。',
            '说明建议依据和需要主 Agent 继续观察的画面位置。'
        ]
    }];
}

function buildPipelineRolePlan(input: DesignerAgentTeamConsultationContractInput): DesignerAgentTeamRolePlan[] {
    const specialistRoles = new Set(
        Array.isArray(input.specialistRoles)
            ? input.specialistRoles.filter((role) => (
                role === 'market-researcher' || role === 'copywriter'
            ))
            : []
    );
    const roles: DesignerAgentTeamRolePlan[] = [];

    roles.push({
        role: 'scene-analyst',
        purpose: '先看清当前画面、项目素材和明显风险，避免在没理解素材时开稿。',
        phase: 'before_write',
        requiredDeliverables: [
            '说明当前画面或项目素材里真实存在什么。',
            '指出可用素材、明显风险和下一步需要重点观察的地方。'
        ]
    });

    if (specialistRoles.has('market-researcher')) {
        roles.push({
            role: 'market-researcher',
            purpose: '当 Brief 确实需要市场判断时，把已有产品事实转成用户洞察和竞品表达。',
            phase: 'before_write',
            requiredDeliverables: [
                '明确目标用户、使用场景和核心购买疑问。',
                '只使用有来源的产品事实，不补造卖点。'
            ]
        });
    }

    if (specialistRoles.has('copywriter')) {
        roles.push({
            role: 'copywriter',
            purpose: '当交付明确需要文字时，把已确认的信息整理成适合上图的文案层级。',
            phase: 'before_write',
            requiredDeliverables: [
                '只产出 Brief 要求的文字类型，不默认补标题、标签或卖点。',
                '说明所需文字的层级与适用位置。'
            ]
        });
    }

    roles.push({
        role: 'design-strategist',
        purpose: '汇总前面判断，给出版式、选图、层级和复核重点。',
        phase: 'before_write',
        requiredDeliverables: [
            '把真实观察与任务所需的专业判断汇总成可执行设计策略。',
            '明确本阶段要做什么、预期画面是什么、做完后看什么。'
        ]
    });

    roles.push({
        role: 'critic',
        purpose: '在阶段草稿后复核画面是否需要调整，保存或导出前确认是否达到交付标准。',
        phase: 'after_draft',
        requiredDeliverables: [
            '基于真实截图或图层状态指出是否通过。',
            '如果不通过，要给出问题归属和可执行修改建议。'
        ]
    });

    return roles;
}

function buildRolePlan(
    input: DesignerAgentTeamConsultationContractInput,
    mode: DesignerAgentTeamConsultationMode
): DesignerAgentTeamRolePlan[] {
    if (mode === 'advisory') return buildAdvisoryRolePlan();
    if (mode === 'pipeline') return buildPipelineRolePlan(input);
    return [];
}

function buildPublicTeamIntent(
    status: DesignerAgentTeamConsultationStatus,
    mode: DesignerAgentTeamConsultationMode,
    input: DesignerAgentTeamConsultationContractInput
): string {
    if (status === 'not_required') return '这次不需要专业团队协作。';
    const task = cleanText(input.userTask) || '当前设计任务';
    if (mode === 'pipeline') {
        return `这是完整设计任务：${task}。让专业团队按场景观察、任务所需专业判断、策略、执行和评审协作，再由主 Agent 汇总结论。`;
    }
    return `这是需要设计取舍的任务：${task}。主 Agent 可以在遇到明确不确定性时征询一个最相关角色，最终设计决策仍由主 Agent 完成。`;
}

function buildToolGuidance(
    status: DesignerAgentTeamConsultationStatus,
    mode: DesignerAgentTeamConsultationMode
): string[] {
    if (status === 'not_required') return ['按普通任务执行，不需要启动设计团队。'];
    if (mode === 'pipeline') {
        return [
            '可以使用 runDesignTeamPipeline 处理完整画面改造，但必须先观察当前画面。',
            '团队流水线的结果是专业协作产出，主 Agent 仍要判断是否符合用户目标。',
            '评审未通过时先按问题归属修订，不要直接保存或导出。'
        ];
    }
    return [
        '仅在存在明确设计不确定性时，用 delegateToAgent 获取一个最相关角色的聚焦建议。',
        '如果主 Agent 已掌握足够素材上下文和清晰方案，可以直接推进，不要为了使用团队而委派。',
        '子 Agent 只提供建议，不能代替主 Agent 的最终设计判断和真实画面复核。'
    ];
}

function buildPromptSection(contract: Omit<DesignerAgentTeamConsultationContract, 'promptSection'>): string {
    const lines = [
        '【专业设计团队协作协议】',
        `状态：${contract.status}`,
        `协作方式：${contract.mode}`,
        `团队意图：${contract.publicTeamIntent}`,
        '角色计划：',
        ...contract.rolePlan.map((item, index) => `${index + 1}. ${item.role}（${item.phase}）：${item.purpose}`),
        '角色交付标准：',
        ...contract.rolePlan.flatMap((item, index) => [
            `${index + 1}. ${item.role}`,
            ...item.requiredDeliverables.map((deliverable) => `   - ${deliverable}`)
        ]),
        '工具使用：',
        ...contract.toolGuidance.map((item, index) => `${index + 1}. ${item}`),
        '边界：',
        ...contract.boundaries.map((item, index) => `${index + 1}. ${item}`)
    ];
    return lines.join('\n');
}

export function buildDesignerAgentTeamConsultationContract(
    input: DesignerAgentTeamConsultationContractInput
): DesignerAgentTeamConsultationContract {
    const scenario = resolveScenario(input);
    const status = resolveStatus(input);
    const mode = resolveMode(status, input);
    const rolePlan = buildRolePlan(input, mode);
    const base = {
        version: 'designer-agent-team-consultation-contract/v0' as const,
        status,
        mode,
        scenario,
        publicTeamIntent: buildPublicTeamIntent(status, mode, input),
        rolePlan,
        toolGuidance: buildToolGuidance(status, mode),
        boundaries: [
            'Agent 架构负责组织专业角色，skill 负责具体领域流程，工具只执行明确动作。',
            '子 Agent 的输出是专业建议，不是最终命令；主 Agent 必须汇总后再决定下一步。',
            '团队协作不能替代真实画面复核，保存或导出前仍要看结果。'
        ]
    };
    return {
        ...base,
        promptSection: buildPromptSection(base)
    };
}

export function buildDesignerAgentTeamPromptSection(
    input: DesignerAgentTeamConsultationContractInput
): string {
    return buildDesignerAgentTeamConsultationContract(input).promptSection;
}

function uniqueRoles(roles: DesignTeammateRole[]): DesignTeammateRole[] {
    return Array.from(new Set(roles));
}

export function buildDesignerAgentTeamConsultationProgress(
    input: DesignerAgentTeamConsultationProgressInput
): DesignerAgentTeamConsultationProgress {
    const contract = input.contract;
    const phase = input.phase || 'before_write';
    const completedRoles = uniqueRoles(Array.isArray(input.completedRoles) ? input.completedRoles : []);

    if (!contract || contract.status !== 'required') {
        return {
            readyForWrite: true,
            qualityPassed: true,
            requiredRoles: [],
            completedRoles,
            missingRoles: [],
            publicMessage: '这次不需要强制专业团队门禁。'
        };
    }

    const requiredRoles = uniqueRoles(
        contract.rolePlan
            .filter((item) => item.phase === phase)
            .map((item) => item.role)
    );

    if (input.pipelineCompleted) {
        const qualityPassed = input.criticQualityPassed === undefined
            ? input.pipelineQualityPassed === true
            : input.criticQualityPassed;
        return {
            readyForWrite: true,
            qualityPassed,
            requiredRoles,
            completedRoles: uniqueRoles([...completedRoles, ...requiredRoles]),
            missingRoles: [],
            publicMessage: qualityPassed
                ? '专业团队流水线已经完成，Critic 已确认质量通过。'
                : '专业团队流水线已经执行完成，但 Critic 未确认质量通过；可以继续定向修订，不能据此保存或交付。'
        };
    }

    const completedSet = new Set(completedRoles);
    const missingRoles = requiredRoles.filter((role) => !completedSet.has(role));
    const nextRequiredRole = missingRoles[0];
    const requiresCriticQualityPass = phase === 'after_draft'
        && requiredRoles.includes('critic');
    const qualityPassed = missingRoles.length === 0
        && (!requiresCriticQualityPass || input.criticQualityPassed === true);
    const completeLabel = phase === 'after_draft'
        ? '交付前专业评审已经完成。'
        : '写入前专业角色判断已经完成。';
    const missingLabel = phase === 'after_draft'
        ? `交付前还缺少专业评审：${missingRoles.join('、')}。`
        : `写入前还缺少专业角色判断：${missingRoles.join('、')}。`;

    return {
        readyForWrite: missingRoles.length === 0,
        qualityPassed,
        requiredRoles,
        completedRoles,
        missingRoles,
        nextRequiredRole,
        publicMessage: missingRoles.length === 0
            ? completeLabel
            : missingLabel
    };
}
