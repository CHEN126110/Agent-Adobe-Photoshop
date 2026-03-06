/**
 * 智能推荐面板
 * 
 * 基于当前上下文主动推荐相关知识
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    quickSearch,
    recordKnowledgeClick,
    recordKnowledgeApply,
    ScoredKnowledgeEntry,
    KnowledgeEntry
} from '../services/rag.service';

// ==================== 类型定义 ====================

interface SmartRecommendationProps {
    /**
     * 当前上下文
     */
    context: {
        currentTask?: string;           // 当前任务，如 "形态统一"
        selectedLayerType?: string;     // 选中的图层类型
        recentActions?: string[];       // 最近操作
        userQuery?: string;             // 用户最近的问题
    };
    
    /**
     * 设计师 ID
     */
    designerId?: string;
    
    /**
     * 选择知识回调
     */
    onSelect?: (entry: KnowledgeEntry) => void;
    
    /**
     * 应用知识回调
     */
    onApply?: (entry: KnowledgeEntry) => void;
    
    /**
     * 关闭回调
     */
    onDismiss?: (entry: KnowledgeEntry, reason: string) => void;
    
    /**
     * 最大显示数量
     */
    maxItems?: number;
    
    /**
     * 自定义样式
     */
    className?: string;
    
    /**
     * 是否自动刷新
     */
    autoRefresh?: boolean;
    
    /**
     * 刷新间隔 (ms)
     */
    refreshInterval?: number;
}

// ==================== 知识类型配置 ====================

const typeIcons: Record<string, string> = {
    selling_point: '✨',
    pain_point: '💡',
    color_scheme: '🎨',
    technique: '⚙️',
    case: '📋',
    copy_template: '📝'
};

const typeLabels: Record<string, string> = {
    selling_point: '卖点',
    pain_point: '痛点',
    color_scheme: '配色',
    technique: '技巧',
    case: '案例',
    copy_template: '文案'
};

// ==================== 子组件 ====================

/**
 * 推荐卡片
 */
const RecommendationCard: React.FC<{
    result: ScoredKnowledgeEntry;
    onSelect: () => void;
    onApply: () => void;
    onDismiss: () => void;
}> = ({ result, onSelect, onApply, onDismiss }) => {
    const { entry, score, personalBoost } = result;
    const icon = typeIcons[entry.type] || '📄';
    const label = typeLabels[entry.type] || entry.type;
    const confidencePercent = Math.round(score * 100);
    
    return (
        <div className="group relative bg-gradient-to-br from-gray-700/50 to-gray-800/50 rounded-lg p-3 hover:from-gray-600/50 hover:to-gray-700/50 transition-all cursor-pointer border border-gray-600/50 hover:border-gray-500/50">
            {/* 关闭按钮 */}
            <button
                onClick={(e) => { e.stopPropagation(); onDismiss(); }}
                className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 text-gray-500 hover:text-gray-300 transition-opacity"
                title="不感兴趣"
            >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
                </svg>
            </button>
            
            <div className="flex items-start gap-3" onClick={onSelect}>
                {/* 类型图标 */}
                <div className="text-2xl flex-shrink-0">{icon}</div>
                
                {/* 内容 */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <h4 className="text-sm font-medium text-gray-200 truncate">
                            {entry.title}
                        </h4>
                        {personalBoost > 1 && (
                            <span className="text-xs text-purple-400" title="个性化推荐">
                                ⭐
                            </span>
                        )}
                    </div>
                    
                    {entry.description && (
                        <p className="text-xs text-gray-400 line-clamp-2 mb-2">
                            {entry.description}
                        </p>
                    )}
                    
                    {/* 底部信息 */}
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500">{label}</span>
                            <span className="text-xs text-gray-600">•</span>
                            <span className={`text-xs ${
                                confidencePercent >= 70 ? 'text-green-400' : 
                                confidencePercent >= 40 ? 'text-yellow-400' : 'text-gray-500'
                            }`}>
                                {confidencePercent}% 相关
                            </span>
                        </div>
                        
                        <button
                            onClick={(e) => { e.stopPropagation(); onApply(); }}
                            className="opacity-0 group-hover:opacity-100 px-2 py-1 bg-blue-500/80 hover:bg-blue-500 text-white text-xs rounded transition-all"
                        >
                            应用
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

/**
 * 加载状态
 */
const LoadingState: React.FC = () => (
    <div className="flex items-center justify-center py-6">
        <div className="flex items-center gap-2 text-gray-400">
            <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            <span className="text-sm">分析中...</span>
        </div>
    </div>
);

/**
 * 空状态
 */
const EmptyState: React.FC = () => (
    <div className="text-center py-6">
        <div className="text-2xl mb-2">🎯</div>
        <p className="text-sm text-gray-500">
            暂无推荐，开始操作后将显示相关知识
        </p>
    </div>
);

// ==================== 主组件 ====================

/**
 * 智能推荐面板
 */
export const SmartRecommendation: React.FC<SmartRecommendationProps> = ({
    context,
    designerId,
    onSelect,
    onApply,
    onDismiss,
    maxItems = 5,
    className = '',
    autoRefresh = true,
    refreshInterval = 10000
}) => {
    const [recommendations, setRecommendations] = useState<ScoredKnowledgeEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [lastQuery, setLastQuery] = useState<string>('');
    const [collapsed, setCollapsed] = useState(false);
    
    const refreshTimerRef = useRef<NodeJS.Timeout | null>(null);
    const dismissedIdsRef = useRef<Set<string>>(new Set());

    /**
     * 构建查询
     */
    const buildQuery = useCallback((): string => {
        const parts: string[] = [];
        
        if (context.currentTask) {
            parts.push(context.currentTask);
        }
        
        if (context.selectedLayerType) {
            parts.push(context.selectedLayerType);
        }
        
        if (context.userQuery) {
            parts.push(context.userQuery);
        }
        
        if (context.recentActions && context.recentActions.length > 0) {
            parts.push(context.recentActions.slice(0, 2).join(' '));
        }
        
        return parts.join(' ').trim();
    }, [context]);

    /**
     * 获取推荐
     */
    const fetchRecommendations = useCallback(async () => {
        const query = buildQuery();
        
        // 如果查询为空或相同，跳过
        if (!query || query === lastQuery) {
            return;
        }
        
        setLoading(true);
        setLastQuery(query);
        
        try {
            const results = await quickSearch(query, maxItems + dismissedIdsRef.current.size);
            
            if (results) {
                // 过滤掉已忽略的
                const filtered = results
                    .filter(r => !dismissedIdsRef.current.has(r.entry.id))
                    .slice(0, maxItems);
                
                setRecommendations(filtered);
            }
        } catch (error) {
            console.error('[SmartRecommendation] 获取推荐失败:', error);
        } finally {
            setLoading(false);
        }
    }, [buildQuery, lastQuery, maxItems]);

    /**
     * 上下文变化时刷新
     */
    useEffect(() => {
        fetchRecommendations();
    }, [context.currentTask, context.selectedLayerType, context.userQuery]);

    /**
     * 自动刷新
     */
    useEffect(() => {
        if (autoRefresh && refreshInterval > 0) {
            refreshTimerRef.current = setInterval(() => {
                fetchRecommendations();
            }, refreshInterval);
        }
        
        return () => {
            if (refreshTimerRef.current) {
                clearInterval(refreshTimerRef.current);
            }
        };
    }, [autoRefresh, refreshInterval, fetchRecommendations]);

    /**
     * 处理选择
     */
    const handleSelect = useCallback((entry: KnowledgeEntry) => {
        if (designerId) {
            recordKnowledgeClick(designerId, entry.id);
        }
        onSelect?.(entry);
    }, [designerId, onSelect]);

    /**
     * 处理应用
     */
    const handleApply = useCallback((entry: KnowledgeEntry) => {
        if (designerId) {
            recordKnowledgeApply(designerId, entry.id);
        }
        onApply?.(entry);
    }, [designerId, onApply]);

    /**
     * 处理忽略
     */
    const handleDismiss = useCallback((entry: KnowledgeEntry) => {
        dismissedIdsRef.current.add(entry.id);
        setRecommendations(prev => prev.filter(r => r.entry.id !== entry.id));
        onDismiss?.(entry, 'not_relevant');
    }, [onDismiss]);

    /**
     * 手动刷新
     */
    const handleRefresh = useCallback(() => {
        setLastQuery(''); // 强制刷新
        fetchRecommendations();
    }, [fetchRecommendations]);

    // 折叠状态
    if (collapsed) {
        return (
            <div className={`bg-gray-800/50 rounded-lg ${className}`}>
                <button
                    onClick={() => setCollapsed(false)}
                    className="w-full px-3 py-2 flex items-center justify-between text-gray-400 hover:text-gray-200 transition-colors"
                >
                    <div className="flex items-center gap-2">
                        <span>💡</span>
                        <span className="text-sm">智能推荐</span>
                        {recommendations.length > 0 && (
                            <span className="px-1.5 py-0.5 bg-blue-500/20 text-blue-400 text-xs rounded">
                                {recommendations.length}
                            </span>
                        )}
                    </div>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
                    </svg>
                </button>
            </div>
        );
    }

    return (
        <div className={`bg-gray-800 rounded-xl overflow-hidden ${className}`}>
            {/* 头部 */}
            <div className="px-3 py-2.5 bg-gray-900/50 border-b border-gray-700 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className="text-lg">💡</span>
                    <h3 className="text-sm font-medium text-gray-200">智能推荐</h3>
                    {recommendations.length > 0 && (
                        <span className="text-xs text-gray-500">
                            基于: {context.currentTask || context.userQuery || '当前操作'}
                        </span>
                    )}
                </div>
                
                <div className="flex items-center gap-1">
                    <button
                        onClick={handleRefresh}
                        disabled={loading}
                        className="p-1.5 text-gray-500 hover:text-gray-300 rounded transition-colors disabled:opacity-50"
                        title="刷新"
                    >
                        <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                        </svg>
                    </button>
                    <button
                        onClick={() => setCollapsed(true)}
                        className="p-1.5 text-gray-500 hover:text-gray-300 rounded transition-colors"
                        title="收起"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7"/>
                        </svg>
                    </button>
                </div>
            </div>
            
            {/* 内容 */}
            <div className="p-3">
                {loading && recommendations.length === 0 ? (
                    <LoadingState />
                ) : recommendations.length > 0 ? (
                    <div className="space-y-2">
                        {recommendations.map(result => (
                            <RecommendationCard
                                key={result.entry.id}
                                result={result}
                                onSelect={() => handleSelect(result.entry)}
                                onApply={() => handleApply(result.entry)}
                                onDismiss={() => handleDismiss(result.entry)}
                            />
                        ))}
                    </div>
                ) : (
                    <EmptyState />
                )}
            </div>
        </div>
    );
};

export default SmartRecommendation;
