/**
 * 技能执行器注册中心
 * 
 * 将技能执行逻辑从 unified-agent.service.ts 拆分出来，
 * 每个技能一个独立文件，便于维护和测试。
 */

import type { SkillExecutor, SkillExecutorRegistry, SkillExecuteParams } from './types';
import type { AgentResult } from '../unified-agent.service';
import { getSkillById } from '../../../shared/skills/skill-declarations';
import { startTiming, endTiming } from '../performance-tracker';

// 导入技能执行器
import { matteProductExecutor } from './matte-product.executor';
import { smartLayoutExecutor } from './smart-layout.executor';
import { shapeMorphingExecutor } from './shape-morphing.executor';
import { detailPageExecutor } from './detail-page.executor';
import { skuBatchExecutor } from './sku-batch.executor';
import { skuConfigExecutor } from './sku-config.executor';
import { layoutReplicationExecutor } from './layout-replication.executor';
import { mainImageExecutor } from './main-image.executor';
import { visualAnalysisExecutor } from './visual-analysis.executor';
import { designReferenceSearchExecutor } from './design-reference-search.executor';
import { findEditElementExecutor } from './find-edit-element.executor';
import { agentPanelBridgeExecutor } from './agent-panel-bridge.executor';

// 技能执行器注册表
const executorRegistry: SkillExecutorRegistry = new Map();

// 注册内置技能执行器
function registerBuiltinExecutors(): void {
    // 图像处理
    executorRegistry.set(matteProductExecutor.skillId, matteProductExecutor);
    
    // 布局排版
    executorRegistry.set(smartLayoutExecutor.skillId, smartLayoutExecutor);
    executorRegistry.set(layoutReplicationExecutor.skillId, layoutReplicationExecutor);
    
    // 形态变形
    executorRegistry.set(shapeMorphingExecutor.skillId, shapeMorphingExecutor);
    
    // 电商设计
    executorRegistry.set(mainImageExecutor.skillId, mainImageExecutor);
    executorRegistry.set(detailPageExecutor.skillId, detailPageExecutor);
    executorRegistry.set(skuConfigExecutor.skillId, skuConfigExecutor);
    executorRegistry.set(skuBatchExecutor.skillId, skuBatchExecutor);

    // 视觉分析
    executorRegistry.set(visualAnalysisExecutor.skillId, visualAnalysisExecutor);
    executorRegistry.set(findEditElementExecutor.skillId, findEditElementExecutor);
    executorRegistry.set(agentPanelBridgeExecutor.skillId, agentPanelBridgeExecutor);

    // 设计参考搜索
    executorRegistry.set(designReferenceSearchExecutor.skillId, designReferenceSearchExecutor);
}

// 初始化
registerBuiltinExecutors();

/**
 * 获取技能执行器
 */
export function getSkillExecutor(skillId: string): SkillExecutor | undefined {
    return executorRegistry.get(skillId);
}

/**
 * 注册自定义技能执行器
 */
export function registerSkillExecutor(executor: SkillExecutor): void {
    executorRegistry.set(executor.skillId, executor);
}

/**
 * 执行技能（统一入口）
 * 
 * 优先使用注册的执行器，如果没有则返回未实现错误
 */
export async function executeSkillWithExecutor(
    skillId: string,
    executeParams: SkillExecuteParams
): Promise<AgentResult> {
    startTiming(`技能:${skillId}`, { params: Object.keys(executeParams.params) });
    
    const skill = getSkillById(skillId);
    if (!skill) {
        endTiming(`技能:${skillId}`, { error: 'not found' });
        return {
            success: false,
            message: `未找到技能: ${skillId}`,
            error: 'Skill not found'
        };
    }
    
    executeParams.callbacks?.onProgress?.(`执行技能: ${skill.name}`, 0);
    executeParams.callbacks?.onMessage?.(`🔧 正在执行「${skill.name}」...`);
    
    const executor = getSkillExecutor(skillId);
    
    if (!executor) {
        endTiming(`技能:${skillId}`, { error: 'no executor' });
        return {
            success: false,
            message: `技能 ${skill.name} 的执行器尚未实现`,
            error: 'Skill executor not implemented'
        };
    }
    
    try {
        const result = await executor.execute(executeParams);
        endTiming(`技能:${skillId}`, { success: result.success });
        return result;
    } catch (e: any) {
        endTiming(`技能:${skillId}`, { error: e.message });
        return {
            success: false,
            message: `执行技能失败: ${e.message}`,
            error: e.message
        };
    }
}

// 导出类型
export type { SkillExecutor, SkillExecuteParams } from './types';
