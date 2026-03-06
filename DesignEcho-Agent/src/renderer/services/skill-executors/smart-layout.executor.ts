/**
 * 智能布局技能执行器
 */

import type { SkillExecutor, SkillExecuteParams } from './types';
import type { AgentResult } from '../unified-agent.service';
import { executeToolCall } from '../tool-executor.service';

export const smartLayoutExecutor: SkillExecutor = {
    skillId: 'smart-layout',
    
    async execute({ params, callbacks }: SkillExecuteParams): Promise<AgentResult> {
        callbacks?.onMessage?.('📐 正在执行智能布局...');
        
        const layoutResult = await executeToolCall('smartLayout', params);
        
        return {
            success: layoutResult?.success ?? false,
            message: layoutResult?.success ? '✅ 布局调整完成' : `❌ 布局调整失败: ${layoutResult?.error || '未知错误'}`,
            toolResults: [layoutResult]
        };
    }
};
