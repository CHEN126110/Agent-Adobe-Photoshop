/**
 * 偏好学习服务
 * 
 * 从设计师操作中自动学习偏好，优化知识检索和推荐
 */

import { getDesignerProfileService, DesignerProfileService } from './designer-profile.service';
import { 
    DesignerProfile, 
    StylePreferences, 
    RetrievalPreferences,
    LearningData
} from '../rag/types';

// ==================== 类型定义 ====================

/**
 * 操作事件类型
 */
export type OperationEventType = 
    | 'search'           // 搜索
    | 'click'            // 点击知识
    | 'apply'            // 应用知识
    | 'favorite'         // 收藏
    | 'dismiss'          // 忽略/关闭
    | 'tool_use'         // 使用工具
    | 'style_select'     // 选择风格
    | 'color_select'     // 选择颜色
    | 'category_filter'  // 筛选类目
    | 'session_end';     // 会话结束

/**
 * 操作事件
 */
export interface OperationEvent {
    type: OperationEventType;
    designerId: string;
    timestamp: string;
    data: Record<string, any>;
}

/**
 * 学习规则
 */
interface LearningRule {
    eventType: OperationEventType;
    handler: (event: OperationEvent, profile: DesignerProfile) => Partial<DesignerProfile> | null;
}

/**
 * 学习统计
 */
export interface LearningStats {
    totalEvents: number;
    processedEvents: number;
    learnedPreferences: number;
    lastLearningTime: string | null;
}

// ==================== 学习规则定义 ====================

/**
 * 定义各类事件的学习规则
 */
const learningRules: LearningRule[] = [
    // 搜索行为学习
    {
        eventType: 'search',
        handler: (event, profile) => {
            const query = event.data.query as string;
            if (!query || query.length < 2) return null;
            
            // 已在 DesignerProfileService.recordSearch 中处理
            return null;
        }
    },
    
    // 点击行为学习
    {
        eventType: 'click',
        handler: (event, profile) => {
            const { knowledgeId, knowledgeType, categories } = event.data;
            
            // 如果多次点击同类目知识，增加该类目权重
            if (categories && Array.isArray(categories)) {
                const currentPreferred = [...profile.retrievalPreferences.preferredCategories];
                const boosts = { ...profile.retrievalPreferences.keywordBoosts };
                
                categories.forEach((cat: string) => {
                    // 如果不在优先类目中且点击次数足够，添加
                    const clickCount = profile.learningData.clickedResults
                        .filter(c => c.knowledgeId.startsWith(knowledgeType))
                        .reduce((sum, c) => sum + c.count, 0);
                    
                    if (clickCount >= 3 && !currentPreferred.includes(cat)) {
                        currentPreferred.push(cat);
                    }
                });
                
                if (currentPreferred.length !== profile.retrievalPreferences.preferredCategories.length) {
                    return {
                        retrievalPreferences: {
                            ...profile.retrievalPreferences,
                            preferredCategories: currentPreferred.slice(0, 10) // 最多 10 个
                        }
                    };
                }
            }
            
            return null;
        }
    },
    
    // 应用行为学习 - 更强的信号
    {
        eventType: 'apply',
        handler: (event, profile) => {
            const { knowledgeType, keywords } = event.data;
            
            // 应用是强信号，增加相关关键词权重
            if (keywords && Array.isArray(keywords)) {
                const boosts = { ...profile.retrievalPreferences.keywordBoosts };
                let changed = false;
                
                keywords.forEach((kw: string) => {
                    const current = boosts[kw] || 0;
                    if (current < 0.5) {
                        boosts[kw] = Math.min(0.5, current + 0.1);
                        changed = true;
                    }
                });
                
                if (changed) {
                    return {
                        retrievalPreferences: {
                            ...profile.retrievalPreferences,
                            keywordBoosts: boosts
                        }
                    };
                }
            }
            
            return null;
        }
    },
    
    // 忽略行为学习 - 负面信号
    {
        eventType: 'dismiss',
        handler: (event, profile) => {
            const { knowledgeId, reason, topic } = event.data;
            
            // 如果多次忽略某主题，添加到排除列表
            if (topic && typeof topic === 'string') {
                const excluded = [...profile.retrievalPreferences.excludedTopics];
                
                // 简单逻辑：如果有明确的排除原因，添加
                if (reason === 'not_relevant' && !excluded.includes(topic)) {
                    excluded.push(topic);
                    return {
                        retrievalPreferences: {
                            ...profile.retrievalPreferences,
                            excludedTopics: excluded.slice(0, 20)
                        }
                    };
                }
            }
            
            return null;
        }
    },
    
    // 工具使用学习
    {
        eventType: 'tool_use',
        handler: (event, profile) => {
            const { toolName, technique } = event.data;
            
            // 学习偏好的变形技术
            if (technique && ['TPS', 'MLS', 'ARAP'].includes(technique)) {
                if (profile.workflowPreferences.defaultTechnique !== technique) {
                    // 只有使用次数足够多才更新默认值
                    // 这里简化处理，实际应该统计
                    return null;
                }
            }
            
            return null;
        }
    },
    
    // 风格选择学习
    {
        eventType: 'style_select',
        handler: (event, profile) => {
            const { style } = event.data;
            
            if (style && typeof style === 'string') {
                const currentStyles = [...profile.stylePreferences.preferredStyles];
                
                if (!currentStyles.includes(style)) {
                    currentStyles.push(style);
                    return {
                        stylePreferences: {
                            ...profile.stylePreferences,
                            preferredStyles: currentStyles.slice(0, 8)
                        }
                    };
                }
            }
            
            return null;
        }
    },
    
    // 颜色选择学习
    {
        eventType: 'color_select',
        handler: (event, profile) => {
            const { colorType, colorValue } = event.data;
            
            // 分析颜色倾向
            if (colorType === 'warm' || colorType === 'cool' || colorType === 'neutral') {
                if (profile.stylePreferences.colorTendency !== colorType) {
                    // 需要足够的样本才更新
                    return null;
                }
            }
            
            return null;
        }
    },
    
    // 类目筛选学习
    {
        eventType: 'category_filter',
        handler: (event, profile) => {
            const { categories } = event.data;
            
            if (categories && Array.isArray(categories)) {
                const currentPreferred = [...profile.retrievalPreferences.preferredCategories];
                let changed = false;
                
                categories.forEach((cat: string) => {
                    if (!currentPreferred.includes(cat)) {
                        currentPreferred.push(cat);
                        changed = true;
                    }
                });
                
                if (changed) {
                    return {
                        retrievalPreferences: {
                            ...profile.retrievalPreferences,
                            preferredCategories: currentPreferred.slice(0, 10)
                        }
                    };
                }
            }
            
            return null;
        }
    },
    
    // 会话结束 - 记录统计
    {
        eventType: 'session_end',
        handler: (event, profile) => {
            const { durationMs } = event.data;
            
            if (durationMs && typeof durationMs === 'number') {
                // 已在 DesignerProfileService.recordSession 中处理
            }
            
            return null;
        }
    }
];

// ==================== 偏好学习服务类 ====================

/**
 * 偏好学习服务
 */
export class PreferenceLearningService {
    private profileService: DesignerProfileService;
    private eventBuffer: OperationEvent[] = [];
    private stats: LearningStats = {
        totalEvents: 0,
        processedEvents: 0,
        learnedPreferences: 0,
        lastLearningTime: null
    };
    private flushInterval: NodeJS.Timeout | null = null;
    
    constructor() {
        this.profileService = getDesignerProfileService();
        
        // 定期处理事件缓冲区
        this.flushInterval = setInterval(() => {
            this.processEventBuffer();
        }, 30000); // 每 30 秒处理一次
    }
    
    /**
     * 记录操作事件
     */
    recordEvent(event: OperationEvent): void {
        this.eventBuffer.push(event);
        this.stats.totalEvents++;
        
        // 如果缓冲区太大，立即处理
        if (this.eventBuffer.length >= 50) {
            this.processEventBuffer();
        }
    }
    
    /**
     * 便捷方法：记录搜索
     */
    recordSearch(designerId: string, query: string): void {
        this.recordEvent({
            type: 'search',
            designerId,
            timestamp: new Date().toISOString(),
            data: { query }
        });
        
        // 同时更新 profile 的搜索记录
        this.profileService.recordSearch(designerId, query);
    }
    
    /**
     * 便捷方法：记录点击
     */
    recordClick(
        designerId: string, 
        knowledgeId: string, 
        knowledgeType: string,
        categories?: string[]
    ): void {
        this.recordEvent({
            type: 'click',
            designerId,
            timestamp: new Date().toISOString(),
            data: { knowledgeId, knowledgeType, categories }
        });
        
        this.profileService.recordKnowledgeClick(designerId, knowledgeId);
    }
    
    /**
     * 便捷方法：记录应用
     */
    recordApply(
        designerId: string,
        knowledgeId: string,
        knowledgeType: string,
        keywords?: string[]
    ): void {
        this.recordEvent({
            type: 'apply',
            designerId,
            timestamp: new Date().toISOString(),
            data: { knowledgeId, knowledgeType, keywords }
        });
        
        this.profileService.recordKnowledgeApplied(designerId, knowledgeId);
    }
    
    /**
     * 便捷方法：记录忽略
     */
    recordDismiss(
        designerId: string,
        knowledgeId: string,
        reason?: string,
        topic?: string
    ): void {
        this.recordEvent({
            type: 'dismiss',
            designerId,
            timestamp: new Date().toISOString(),
            data: { knowledgeId, reason, topic }
        });
    }
    
    /**
     * 便捷方法：记录工具使用
     */
    recordToolUse(
        designerId: string,
        toolName: string,
        params?: Record<string, any>
    ): void {
        this.recordEvent({
            type: 'tool_use',
            designerId,
            timestamp: new Date().toISOString(),
            data: { toolName, ...params }
        });
    }
    
    /**
     * 便捷方法：记录风格选择
     */
    recordStyleSelect(designerId: string, style: string): void {
        this.recordEvent({
            type: 'style_select',
            designerId,
            timestamp: new Date().toISOString(),
            data: { style }
        });
    }
    
    /**
     * 便捷方法：记录会话结束
     */
    recordSessionEnd(designerId: string, durationMs: number): void {
        this.recordEvent({
            type: 'session_end',
            designerId,
            timestamp: new Date().toISOString(),
            data: { durationMs }
        });
        
        this.profileService.recordSession(designerId, durationMs);
        
        // 会话结束时立即处理
        this.processEventBuffer();
    }
    
    /**
     * 处理事件缓冲区
     */
    private processEventBuffer(): void {
        if (this.eventBuffer.length === 0) return;
        
        console.log(`[PreferenceLearning] 处理 ${this.eventBuffer.length} 个事件...`);
        
        // 按设计师分组
        const eventsByDesigner = new Map<string, OperationEvent[]>();
        
        for (const event of this.eventBuffer) {
            const events = eventsByDesigner.get(event.designerId) || [];
            events.push(event);
            eventsByDesigner.set(event.designerId, events);
        }
        
        // 处理每个设计师的事件
        for (const [designerId, events] of eventsByDesigner) {
            this.processDesignerEvents(designerId, events);
        }
        
        this.stats.processedEvents += this.eventBuffer.length;
        this.stats.lastLearningTime = new Date().toISOString();
        this.eventBuffer = [];
    }
    
    /**
     * 处理单个设计师的事件
     */
    private processDesignerEvents(designerId: string, events: OperationEvent[]): void {
        const profile = this.profileService.getProfile(designerId);
        if (!profile) return;
        
        let updates: Partial<DesignerProfile> = {};
        let hasUpdates = false;
        
        for (const event of events) {
            // 查找匹配的学习规则
            const rule = learningRules.find(r => r.eventType === event.type);
            if (!rule) continue;
            
            const result = rule.handler(event, profile);
            if (result) {
                updates = this.mergeUpdates(updates, result);
                hasUpdates = true;
            }
        }
        
        // 应用更新
        if (hasUpdates) {
            this.profileService.updateProfile(designerId, updates);
            this.stats.learnedPreferences++;
            console.log(`[PreferenceLearning] 更新设计师 ${designerId} 的偏好`);
        }
    }
    
    /**
     * 合并更新对象
     */
    private mergeUpdates(
        current: Partial<DesignerProfile>,
        newUpdate: Partial<DesignerProfile>
    ): Partial<DesignerProfile> {
        const result = { ...current };
        
        for (const [key, value] of Object.entries(newUpdate)) {
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                result[key as keyof DesignerProfile] = {
                    ...(current[key as keyof DesignerProfile] as object || {}),
                    ...value
                } as any;
            } else {
                result[key as keyof DesignerProfile] = value as any;
            }
        }
        
        return result;
    }
    
    /**
     * 获取学习统计
     */
    getStats(): LearningStats {
        return { ...this.stats };
    }
    
    /**
     * 强制处理所有待处理事件
     */
    flush(): void {
        this.processEventBuffer();
    }
    
    /**
     * 清理资源
     */
    dispose(): void {
        if (this.flushInterval) {
            clearInterval(this.flushInterval);
            this.flushInterval = null;
        }
        this.processEventBuffer();
    }
}

// 单例实例
let preferenceLearningServiceInstance: PreferenceLearningService | null = null;

/**
 * 获取偏好学习服务单例
 */
export function getPreferenceLearningService(): PreferenceLearningService {
    if (!preferenceLearningServiceInstance) {
        preferenceLearningServiceInstance = new PreferenceLearningService();
    }
    return preferenceLearningServiceInstance;
}

export default PreferenceLearningService;
