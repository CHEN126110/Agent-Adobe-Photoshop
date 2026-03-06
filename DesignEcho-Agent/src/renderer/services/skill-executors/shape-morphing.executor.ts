/**
 * 形态统一技能执行器
 */

import type { SkillExecutor, SkillExecuteParams } from './types';
import type { AgentResult } from '../unified-agent.service';
import { executeToolCall } from '../tool-executor.service';

export const shapeMorphingExecutor: SkillExecutor = {
    skillId: 'shape-morphing',
    
    async execute({ params, callbacks }: SkillExecuteParams): Promise<AgentResult> {
        callbacks?.onMessage?.('🔄 正在执行形态统一...');
        
        const morphParams = {
            refShapeLayerId: params.refShapeLayerId,
            productLayerIds: params.productLayerIds,
            step: params.step || 'full',
            edgeBandWidth: params.edgeBandWidth || 50,
            protectCuff: params.protectCuff !== false
        };
        
        callbacks?.onMessage?.('🎯 获取参考形状和产品图层...');
        
        const morphResult = await executeToolCall('morphToShape', morphParams);
        
        if (morphResult?.success) {
            callbacks?.onMessage?.('✅ 形态统一完成');
            return {
                success: true,
                message: `形态统一完成: ${morphResult.successCount || 1} 个图层已处理`,
                toolResults: [morphResult]
            };
        }
        
        return {
            success: false,
            message: `形态统一失败: ${morphResult?.error || '未知错误'}`,
            toolResults: [morphResult]
        };
    }
};
