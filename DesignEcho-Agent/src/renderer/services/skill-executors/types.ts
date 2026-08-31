/**
 * 技能执行器类型定义
 */

import type { AgentTaskPlanningContract } from '../../../shared/agent-task-planning-contract';
import type {
    GuardedAtomicToolExecutor,
    RuntimeOwnedSkillDeliveryPlanAuthority
} from '../../../shared/agent-skill-atomic-tool-execution';
import type { SkillExecutionRuntimeLineage } from '../../../shared/skill-execution-effect';
import type { InteractiveContinuationResolution } from '../../../shared/pending-interactive-continuation';
import type { RuntimeWorkflowDeliveryReentry } from '../../../shared/agent-workflow-continuation-scope';
import type { AgentResult, AgentContext, ExecutionCallbacks } from '../unified-agent.service';
import type {
    RuntimeDesignBriefDeclaration,
    RuntimeDesignBriefDigest
} from '../../../shared/agent-runtime-v5/runtime-design-brief-declaration';
import type {
    RuntimeReferenceBriefDeclaration,
    RuntimeReferenceBriefDigest
} from '../../../shared/agent-runtime-v5/runtime-reference-context';
import type {
    RuntimeDesignStrategyDeclaration,
    RuntimeDesignStrategyDigest
} from '../../../shared/agent-runtime-v5/runtime-design-strategy-declaration';
import type {
    RuntimeActionPlanDeclaration,
    RuntimeActionPlanDigest
} from '../../../shared/agent-runtime-v5/runtime-action-plan-declaration';
import type { RuntimeInteractiveReentry } from '../../../shared/agent-runtime-v5/runtime-interactive-reentry';
import type { RuntimeSessionIdentity } from '../../../shared/agent-runtime-v5/runtime-session';

/**
 * 技能执行参数
 */
export interface SkillExecuteParams {
    /** 技能参数 */
    params: Record<string, any>;
    /** 回调函数 */
    callbacks?: ExecutionCallbacks;
    /** 中止信号 */
    signal?: AbortSignal;
    /** Agent 上下文 */
    context?: AgentContext;
    /**
     * Harness 为当前 Skill 运行签发的原子 Tool 执行边界。
     * Skill 只能传业务参数；文档、历史版本和图层目标绑定由该 owner 私下维护。
     */
    guardedAtomicToolExecutor?: GuardedAtomicToolExecutor;
    /**
     * 现有 Runtime Tool ledger 签发的交付计划 authority。
     * Skill 只提交 Agent/用户已经选定的候选，并在最终 save/export 时绑定 artifact；
     * 它不能从模型参数或父 Skill 继承，也不替 Agent 选择目录、命名或设计内容。
     */
    runtimeDeliveryPlanAuthority?: RuntimeOwnedSkillDeliveryPlanAuthority;
    /** 同一 Agent continuation owner 签发的 delivery-only Skill 复入收据。 */
    runtimeWorkflowDeliveryReentry?: RuntimeWorkflowDeliveryReentry;
    /** Harness 签发的当前 Runtime/TaskRun/continuation/Workflow call 身份。 */
    runtimeSkillExecutionLineage?: SkillExecutionRuntimeLineage;
    /**
     * 仅由 Harness 投影的当前 Runtime/TaskRun 身份（identity-only）。
     * 它不授权任何 Tool、不改变任务结果，也永远不能从模型参数创建或覆盖；
     * 后续 prepare/finalize 用它对账「同一 TaskRun」。
     */
    runtimeTaskIdentity?: RuntimeSessionIdentity;
    /**
     * 仅由 Engine 在操作账本、owner、卡片指纹和作用域全部校验后注入。
     * 模型 Tool 参数永远不能创建这一通道，子 Skill 也不自动继承。
     */
    trustedInteractiveContinuation?: Extract<InteractiveContinuationResolution, { status: 'accepted' }>;
    /**
     * 仅由 Engine 从活动 RuntimeSession checkpoint 构造的同代重入状态。
     * 它不是模型参数，不创建新 TaskRun，也不授予 Tool 权限。
     */
    runtimeInteractiveReentry?: RuntimeInteractiveReentry;
    /** 同代 Agent 完成可信上下文恢复后提交 Engine 持有的 checkpoint lease。 */
    adoptRuntimeInteractiveReentry?: () => boolean;
    /** Engine 已形成的请求级规划契约；子 Skill 继承，不能自行重判执行义务。 */
    agentTaskPlan?: AgentTaskPlanningContract;
    /** 当前 v5 R1 Brief，仅在自主 Agent 已通过 manifest 校验后由 Harness 注入。 */
    runtimeDesignBriefDeclaration?: RuntimeDesignBriefDeclaration;
    /** Harness owner 生成的 R1 digest；业务 Skill 只消费，不重复实现治理算法。 */
    runtimeDesignBriefDigest?: RuntimeDesignBriefDigest;
    /** 生成跨层 digest 所需的当前 manifest required inputs。 */
    runtimeDesignBriefRequiredInputKeys?: string[];
    /** 同一 Runtime 已验证的 R2 参考决策；只读上下文，不授予 Skill 执行权。 */
    runtimeReferenceBriefDeclaration?: RuntimeReferenceBriefDeclaration;
    /** Harness owner 生成的 R2 digest。 */
    runtimeReferenceBriefDigest?: RuntimeReferenceBriefDigest;
    /** 同一 Runtime 已验证的模型 R3 Strategy；只读上下文，不授予 Skill 执行权。 */
    runtimeDesignStrategyDeclaration?: RuntimeDesignStrategyDeclaration;
    /** Harness owner 生成的 R3 digest。 */
    runtimeDesignStrategyDigest?: RuntimeDesignStrategyDigest;
    /** 同一 Runtime 已验证的模型 R4 shadow Plan；不具有 scheduler authority。 */
    runtimeActionPlanDeclaration?: RuntimeActionPlanDeclaration;
    /** Harness owner 生成的 R4 digest；不代表节点已执行。 */
    runtimeActionPlanDigest?: RuntimeActionPlanDigest;
    /** 由统一执行入口注入，用于父 skill 调度子 skill，避免直接调用子 executor */
    runSkill?: (skillId: string, params: SkillExecuteParams) => Promise<AgentResult>;
}

/**
 * 技能执行器接口
 */
export interface SkillExecutor {
    /** 技能 ID */
    skillId: string;
    /** Skill-owned 澄清/阶段移交；纯判定，不执行 Tool、授权或推进 Runtime。 */
    resolvePreExecutionResult?(params: SkillExecuteParams): AgentResult | null;
    /** 执行技能 */
    execute(params: SkillExecuteParams): Promise<AgentResult>;
}

/**
 * 技能执行器注册表类型
 */
export type SkillExecutorRegistry = Map<string, SkillExecutor>;
