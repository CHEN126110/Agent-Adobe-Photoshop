/**
 * 技能执行器类型定义
 */

import type { AgentResult, AgentContext, ExecutionCallbacks } from '../unified-agent.service';

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
}

/**
 * 技能执行器接口
 */
export interface SkillExecutor {
    /** 技能 ID */
    skillId: string;
    /** 执行技能 */
    execute(params: SkillExecuteParams): Promise<AgentResult>;
}

/**
 * 技能执行器注册表类型
 */
export type SkillExecutorRegistry = Map<string, SkillExecutor>;
