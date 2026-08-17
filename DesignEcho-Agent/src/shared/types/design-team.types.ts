import type { VisualObservationReceipt } from '../visual-observation-bundle';

export type DesignTeammateRole =
    | 'scene-analyst'
    | 'market-researcher'
    | 'copywriter'
    | 'design-strategist'
    | 'executor'
    | 'critic';

export type DesignTeamMessageType =
    | 'scene_summary'
    | 'market_research'
    | 'copy_strategy'
    | 'design_plan'
    | 'execution_report'
    | 'review_report'
    | 'revision_request'
    | 'task_context'
    | 'task_status'
    | 'model_dispatch_trace';

export type DesignTeammateTaskStatus =
    | 'pending'
    | 'running'
    | 'completed'
    | 'failed'
    | 'cancelled';

export interface DesignTeamMessage<TPayload = Record<string, unknown>> {
    type: DesignTeamMessageType;
    fromRole: DesignTeammateRole;
    toRole?: DesignTeammateRole | 'coordinator';
    taskId?: string;
    timestamp?: string;
    payload: TPayload;
}

export interface DesignTeammateDefinition {
    role: DesignTeammateRole;
    displayName: string;
    description: string;
    systemPrompt: string;
    allowedTools: string[];
    maxIterations: number;
    outputType: DesignTeamMessageType;
    canWriteToPhotoshop: boolean;
}

export interface DesignTeammateTaskRequest {
    role: DesignTeammateRole;
    task: string;
    context?: string;
    modelId?: string;
    maxIterations?: number;
}

export interface DesignTeammateTaskResult {
    success: boolean;
    taskId: string;
    role: DesignTeammateRole;
    status: DesignTeammateTaskStatus;
    message: string;
    iterations: number;
    toolsUsed: string[];
    outputType: DesignTeamMessageType;
    startedAt: string;
    finishedAt: string;
    messages: DesignTeamMessage[];
    outputMessage?: DesignTeamMessage<{
        success: boolean;
        message: string;
        iterations: number;
        toolsUsed: string[];
        error?: string;
        budgetExhausted?: boolean;
    }>;
    error?: string;
    /** 子 Agent 由结构化 stopReason=performance_budget 停机；不从错误文案反推。 */
    budgetExhausted?: boolean;
    /**
     * Critic 真正读取当前 Photoshop 像素后，由 Agent Runtime 签发的视觉回执。
     * 单纯的文字 verdict 不得生成该字段，也不得据此解锁保存/导出。
     */
    visualReviewEvidence?: VisualObservationReceipt;
}

// ==================== 团队共享工作区（黑板） ====================

/** 一条沉淀到团队工作区的队友产出 */
export interface DesignTeamWorkspaceEntry {
    role: DesignTeammateRole;
    outputType: DesignTeamMessageType;
    /** 流水线阶段标签（如 analyze/plan/execute/review/revise-1） */
    stage: string;
    success: boolean;
    /** 队友的最终文本产出 */
    content: string;
    toolsUsed: string[];
    timestamp: string;
}

// ==================== 评审裁决 ====================

export type DesignCriticVerdictStatus = 'pass' | 'needs_fix' | 'unparseable';

export type DesignCriticIssueOwner =
    | 'requirement'
    | 'asset'
    | 'insight'
    | 'copy'
    | 'visual'
    | 'layout'
    | 'execution';

export interface DesignCriticIssue {
    /**
     * 评审问题归属，用于把返工交回最合适的队友。
     * 这是流水线协作字段，不是用户可见的工程状态。
     */
    owner?: DesignCriticIssueOwner;
    /** 问题对象（图层/模块/文案等） */
    target: string;
    problem: string;
    suggestion: string;
}

/**
 * 确定性评分卡摘要（并进评审裁决时随附）。
 * gate 取值与 design-quality-assertion 的 DesignScorecardGate 对齐；
 * 此处内联字面量联合，避免 types ↔ design-quality-assertion 的循环依赖。
 */
export interface DesignCriticDeterministicScorecard {
    /** 0..100，已评估断言的加权得分 */
    overallScore: number;
    gate: 'passed' | 'failed' | 'needs_review' | 'incomplete_verification' | 'insufficient_observations';
    /** 已被真实测量评估的断言数 / 断言总数 */
    evaluated: number;
    total: number;
    summary: string;
}

export interface DesignCriticVerdict {
    status: DesignCriticVerdictStatus;
    issues: DesignCriticIssue[];
    /** 评审报告原文（裁决 JSON 之外的部分） */
    reviewText: string;
    /**
     * 确定性事实评分卡摘要：由流水线真实工具结果与 design-quality-assertion 事实断言得出。
     * 存在即表示其失败/待复核断言已并入 issues；只有证据资格完整的硬事实失败不能被模型散文抵消。
     */
    deterministicScorecard?: DesignCriticDeterministicScorecard;
}

// ==================== 团队流水线 ====================

export interface DesignTeamPipelineStageRecord {
    stage: string;
    role: DesignTeammateRole;
    success: boolean;
    message: string;
    iterations: number;
    toolsUsed: string[];
    error?: string;
}

/**
 * 父 Agent 在启动复合 Design Team 前一次性划给全部子 Agent 的执行额度。
 *
 * 该对象只携带子执行可消费的上限与绝对截止时间；父级总预算、实时计数器和
 * finalization reserve 不得下发，避免 coordinator 取得第二套父预算所有权。
 */
export interface DesignTeamChildExecutionAllowance {
    maxAgentCalls: number;
    maxModelCalls: number;
    maxToolCalls: number;
    maxVisualAnalyses: number;
    maxVisionCandidates: number;
    /** 父请求的单次输出硬上限；子 Agent 不得恢复为默认 4096/8192。 */
    maxPrimaryOutputTokens?: number;
    /** deny-wins：父请求关闭 provider thinking 时，任何子 Agent 都必须保持关闭。 */
    allowProviderThinking?: boolean;
    deadlineAtMs: number;
}

/** 父流水线汇总的子 Agent 实际消耗；调用数按已落盘的阶段记录计。 */
export interface DesignTeamPipelineChildAgentUsage {
    calls: number;
    iterations: number;
    toolCalls: number;
}

export interface DesignTeamPipelineResult {
    /** 流水线是否完整执行；不代表设计质量已经通过。 */
    success: boolean;
    /** 只有可机读 critic 裁决明确为 pass 时才为 true。 */
    qualityPassed: boolean;
    /** 最终 Critic 在最后一次成功画面写入之后取得的 Runtime 视觉回执。 */
    visualReviewEvidence?: VisualObservationReceipt;
    /** 所有已启动并产生阶段记录的子 Agent 调用/迭代/工具调用总计。 */
    childAgentUsage: DesignTeamPipelineChildAgentUsage;
    /** 给主循环/用户的最终汇总 */
    message: string;
    goal: string;
    stages: DesignTeamPipelineStageRecord[];
    verdict?: DesignCriticVerdict;
    /** 实际执行的修订轮数 */
    revisionRounds: number;
    /**
     * 子流水线的事前 allowance 已没有足够额度继续启动完整阶段。
     * 这是资源事实，不等同于质量失败，也不得被提升为父 Agent 的写入/保存权限门禁。
     */
    budgetExhausted?: boolean;
    cancelled?: boolean;
    error?: string;
}
