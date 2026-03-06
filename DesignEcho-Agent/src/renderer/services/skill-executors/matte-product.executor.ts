/**
 * 抠图技能执行器
 */

import type { SkillExecutor, SkillExecuteParams } from './types';
import type { AgentResult } from '../unified-agent.service';
import { executeToolCall } from '../tool-executor.service';

export const matteProductExecutor: SkillExecutor = {
    skillId: 'matte-product',
    
    async execute({ params, callbacks }: SkillExecuteParams): Promise<AgentResult> {
        callbacks?.onMessage?.('🎨 正在执行智能抠图...');
        
        const matteResult = await executeToolCall('removeBackground', params);
        
        return {
            success: matteResult?.success ?? false,
            message: matteResult?.success ? '✅ 抠图完成' : `❌ 抠图失败: ${matteResult?.error || '未知错误'}`,
            toolResults: [matteResult]
        };
    }
};
