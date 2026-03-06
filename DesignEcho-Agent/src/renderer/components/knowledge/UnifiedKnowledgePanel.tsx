/**
 * 统一知识库管理面板
 * 
 * 整合 RAG 搜索、快速导入、知识浏览的一体化界面
 */

import React, { useState, useEffect, useCallback } from 'react';
import { KnowledgeSearch } from '../KnowledgeSearch';
import { SmartRecommendation } from '../SmartRecommendation';
import { QuickImport } from './QuickImport';
import {
    getCurrentDesigner,
    indexKnowledge,
    getRAGStatus,
    searchKnowledge,
    DesignerProfile
} from '../../services/rag.service';

// ==================== 类型定义 ====================

interface UnifiedKnowledgePanelProps {
    className?: string;
    onKnowledgeSelect?: (knowledge: any) => void;
    onKnowledgeApply?: (knowledge: any) => void;
}

type ViewMode = 'search' | 'browse' | 'import';
type KnowledgeType = 'all' | 'selling_point' | 'pain_point' | 'color_scheme' | 'copy_template';

interface KnowledgeStats {
    total: number;
    indexed: number;
    byType: Record<string, number>;
    lastIndexed: string | null;
}

// ==================== 类型配置 ====================

const typeConfig: Record<string, { icon: string; label: string; color: string }> = {
    all: { icon: '📚', label: '全部', color: 'bg-gray-600' },
    selling_point: { icon: '✨', label: '卖点', color: 'bg-yellow-500/20' },
    pain_point: { icon: '💡', label: '痛点', color: 'bg-red-500/20' },
    color_scheme: { icon: '🎨', label: '配色', color: 'bg-purple-500/20' },
    copy_template: { icon: '📝', label: '文案', color: 'bg-orange-500/20' }
};

// ==================== 子组件 ====================

/**
 * 类型筛选器 - 垂直侧边栏布局
 */
const TypeFilter: React.FC<{
    activeType: KnowledgeType;
    onChange: (type: KnowledgeType) => void;
    counts: Record<string, number>;
}> = ({ activeType, onChange, counts }) => {
    const types: KnowledgeType[] = ['all', 'selling_point', 'pain_point', 'color_scheme', 'copy_template'];
    
    return (
        <div className="type-filter-list">
            <div className="filter-title">类型筛选</div>
            {types.map(type => {
                const config = typeConfig[type];
                const count = type === 'all' 
                    ? Object.values(counts).reduce((a, b) => a + b, 0)
                    : counts[type] || 0;
                
                return (
                    <button
                        key={type}
                        onClick={() => onChange(type)}
                        className={`type-filter-btn ${activeType === type ? 'active' : ''}`}
                    >
                        <span className="filter-icon">{config.icon}</span>
                        <span className="filter-label">{config.label}</span>
                        <span className="filter-count">{count}</span>
                    </button>
                );
            })}
            
            <style>{`
                .type-filter-list {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }
                
                .filter-title {
                    font-size: 11px;
                    font-weight: 600;
                    color: var(--de-text-muted);
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    margin-bottom: 8px;
                }
                
                .type-filter-btn {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 8px 10px;
                    border: none;
                    background: transparent;
                    color: var(--de-text-secondary);
                    font-size: 13px;
                    border-radius: 6px;
                    cursor: pointer;
                    transition: all 0.15s ease;
                    text-align: left;
                }
                
                .type-filter-btn:hover {
                    background: rgba(255, 255, 255, 0.05);
                    color: var(--de-text);
                }
                
                .type-filter-btn.active {
                    background: var(--de-primary-alpha);
                    color: var(--de-primary);
                }
                
                .filter-icon {
                    font-size: 14px;
                }
                
                .filter-label {
                    flex: 1;
                }
                
                .filter-count {
                    font-size: 11px;
                    padding: 2px 6px;
                    background: rgba(255, 255, 255, 0.1);
                    border-radius: 10px;
                    color: var(--de-text-muted);
                }
                
                .type-filter-btn.active .filter-count {
                    background: var(--de-primary);
                    color: white;
                }
            `}</style>
        </div>
    );
};

/**
 * 浏览模式列表（RAG 对齐）
 */
const BrowseList: React.FC<{
    knowledgeType: KnowledgeType;
    onSelect: (item: any) => void;
    onApply: (item: any) => void;
}> = ({ knowledgeType, onSelect, onApply }) => {
    const [items, setItems] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadItems = async () => {
            setLoading(true);
            try {
                const userKnowledge = await (window as any).designEcho?.invoke('userKnowledge:getGlobal') || {};
                const allItems: any[] = [];

                const addItems = (data: any[], type: string, source: string) => {
                    data.forEach(item => {
                        allItems.push({ ...item, type, source });
                    });
                };

                if (knowledgeType === 'all' || knowledgeType === 'selling_point') {
                    addItems(userKnowledge.sellingPoints || [], 'selling_point', 'user');
                }
                if (knowledgeType === 'all' || knowledgeType === 'pain_point') {
                    addItems(userKnowledge.painPoints || [], 'pain_point', 'user');
                }
                if (knowledgeType === 'all' || knowledgeType === 'color_scheme') {
                    addItems(userKnowledge.colorSchemes || [], 'color_scheme', 'user');
                }
                if (knowledgeType === 'all' || knowledgeType === 'copy_template') {
                    addItems(userKnowledge.copyTemplates || [], 'copy_template', 'user');
                }

                const ragFilters = knowledgeType === 'all' ? undefined : { types: [knowledgeType as any] };
                const ragResult = await searchKnowledge('设计 知识 模板 规范 卖点', {
                    limit: 80,
                    filters: ragFilters
                });

                if (ragResult?.entries?.length) {
                    const exists = new Set(allItems.map(i => i.id));
                    for (const r of ragResult.entries) {
                        if (exists.has(r.entry.id)) continue;
                        allItems.push({
                            id: r.entry.id,
                            title: r.entry.title,
                            description: r.entry.description,
                            content: r.entry.text,
                            text: r.entry.text,
                            type: r.entry.type,
                            source: 'rag',
                            metadata: r.entry.metadata
                        });
                    }
                }

                setItems(allItems);
            } catch (e) {
                console.error('加载知识失败:', e);
            } finally {
                setLoading(false);
            }
        };

        loadItems();
    }, [knowledgeType]);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            </div>
        );
    }

    if (items.length === 0) {
        return (
            <div className="text-center py-12 text-gray-500">
                <span className="text-4xl block mb-3">📭</span>
                <p>暂无知识内容</p>
                <p className="text-xs mt-1">请先导入并索引知识</p>
            </div>
        );
    }

    return (
        <div className="space-y-2 p-4">
            {items.map((item, idx) => {
                const config = typeConfig[item.type] || typeConfig.all;
                const sourceBadge = item.source === 'rag' ? '索引' : '自定义';
                const sourceBadgeClass = item.source === 'rag'
                    ? 'bg-blue-500/20 text-blue-400'
                    : 'bg-yellow-500/20 text-yellow-400';
                const summary =
                    typeof item.description === 'string' ? item.description :
                    typeof item.scenario === 'string' ? item.scenario :
                    typeof item.content === 'string' ? item.content :
                    typeof item.text === 'string' ? item.text : '-';

                return (
                    <div
                        key={item.id || idx}
                        className="group flex items-start gap-3 p-3 bg-gray-700/30 rounded-lg hover:bg-gray-700/50 transition-colors cursor-pointer"
                        onClick={() => onSelect(item)}
                    >
                        <span className="text-lg">{config.icon}</span>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                                <h4 className="text-sm font-medium text-gray-200 truncate">
                                    {item.title || item.name || '未命名'}
                                </h4>
                                <span className={"text-xs px-1.5 py-0.5 rounded " + sourceBadgeClass}>
                                    {sourceBadge}
                                </span>
                            </div>
                            <p className="text-xs text-gray-400 line-clamp-2">{summary}</p>
                        </div>
                        <button
                            onClick={(e) => { e.stopPropagation(); onApply(item); }}
                            className="opacity-0 group-hover:opacity-100 px-2 py-1 bg-blue-500/80 hover:bg-blue-500 text-white text-xs rounded transition-all"
                        >
                            应用
                        </button>
                    </div>
                );
            })}
        </div>
    );
};

// ==================== 主组件 ====================

export const UnifiedKnowledgePanel: React.FC<UnifiedKnowledgePanelProps> = ({
    className = '',
    onKnowledgeSelect,
    onKnowledgeApply
}) => {
    const [viewMode, setViewMode] = useState<ViewMode>('search');
    const [knowledgeType, setKnowledgeType] = useState<KnowledgeType>('all');
    const [designer, setDesigner] = useState<DesignerProfile | null>(null);
    const [stats, setStats] = useState<KnowledgeStats>({
        total: 0,
        indexed: 0,
        byType: {},
        lastIndexed: null
    });
    const [indexing, setIndexing] = useState(false);
    const [indexProgress, setIndexProgress] = useState<{ phase: string; current: number; total: number; message: string } | null>(null);
    
    // 加载设计师档案
    useEffect(() => {
        getCurrentDesigner().then(setDesigner);
    }, []);
    
    // 加载统计信息
    useEffect(() => {
        const loadStats = async () => {
            try {
                // 获取 RAG 状态
                const ragStatus = await getRAGStatus();
                
                // 获取知识数量
                const userKnowledge = await (window as any).designEcho?.invoke('userKnowledge:getGlobal') || {};
                
                const byType: Record<string, number> = {
                    selling_point: (userKnowledge.sellingPoints?.length || 0),
                    pain_point: (userKnowledge.painPoints?.length || 0),
                    color_scheme: (userKnowledge.colorSchemes?.length || 0),
                    copy_template: (userKnowledge.copyTemplates?.length || 0)
                };
                
                setStats({
                    total: Object.values(byType).reduce((a, b) => a + b, 0),
                    indexed: ragStatus?.indexedCount || 0,
                    byType,
                    lastIndexed: ragStatus?.lastIndexTime || null
                });
            } catch (e) {
                console.error('加载统计失败:', e);
            }
        };
        
        loadStats();
    }, []);
    
    // 刷新索引
    const handleRefreshIndex = useCallback(async () => {
        setIndexing(true);
        setIndexProgress(null);
        
        const unsub = (window as any).designEcho?.onRAGIndexProgress?.((p: { phase: string; current: number; total: number; message: string }) => {
            setIndexProgress(p);
        });
        
        try {
            const userKnowledge = await (window as any).designEcho?.invoke('userKnowledge:getGlobal') || {};
            
            const result = await indexKnowledge({
                sellingPoints: [...(userKnowledge.sellingPoints || [])],
                painPoints: [...(userKnowledge.painPoints || [])],
                colorSchemes: [...(userKnowledge.colorSchemes || [])],
                copyTemplates: [...(userKnowledge.copyTemplates || [])]
            });
            
            if (result) {
                setStats(prev => ({
                    ...prev,
                    indexed: result.totalIndexed,
                    lastIndexed: new Date().toISOString()
                }));
            }
        } catch (e) {
            console.error('索引失败:', e);
        } finally {
            setIndexing(false);
            setIndexProgress(null);
            unsub?.();
        }
    }, []);

    // 清空所有知识
    const handleClearAll = async () => {
        if (!confirm('确定要清空所有知识库数据吗？\n警告：这将删除用户自定义数据和向量索引，操作不可恢复！')) return;
        
        setIndexing(true);
        try {
            const result: any = await (window as any).designEcho?.invoke('knowledge:clearAll');
            if (result?.success) {
                // 清空后刷新统计
                const ragStatus = await getRAGStatus();
                setStats({
                    total: 0,
                    indexed: 0,
                    byType: {
                        selling_point: 0,
                        pain_point: 0,
                        color_scheme: 0,
                        copy_template: 0
                    },
                    lastIndexed: ragStatus?.lastIndexTime || null
                });
                
                // 刷新页面数据
                handleRefreshIndex();
            } else {
                console.error('清空失败:', result?.error);
                alert(`清空失败: ${result?.error}`);
            }
        } catch (e: any) {
            console.error('操作失败:', e);
            alert(`操作失败: ${e.message}`);
        } finally {
            setIndexing(false);
        }
    };
    
    // 处理导入完成
    const handleImportComplete = useCallback((result: any) => {
        // 刷新统计
        setStats(prev => ({
            ...prev,
            total: prev.total + result.total,
            byType: {
                ...prev.byType,
                selling_point: (prev.byType.selling_point || 0) + (result.counts.sellingPoints || 0),
                pain_point: (prev.byType.pain_point || 0) + (result.counts.painPoints || 0),
                color_scheme: (prev.byType.color_scheme || 0) + (result.counts.colorSchemes || 0),
                copy_template: (prev.byType.copy_template || 0) + (result.counts.copyTemplates || 0)
            }
        }));
        
        // 自动索引
        handleRefreshIndex();
    }, [handleRefreshIndex]);
    
    return (
        <div className={`knowledge-panel ${className}`}>
            {/* 左侧边栏 - 分类和筛选 */}
            <div className="knowledge-sidebar">
                <div className="sidebar-header">
                    <h2>知识库</h2>
                    <span className="stats-badge">{stats.total} 条</span>
                </div>
                
                {/* 视图切换 */}
                <div className="view-switcher">
                    {[
                        { id: 'search' as ViewMode, icon: '🔍', label: '搜索' },
                        { id: 'browse' as ViewMode, icon: '📋', label: '浏览' },
                        { id: 'import' as ViewMode, icon: '📥', label: '导入' },
                    ].map(view => (
                        <button
                            key={view.id}
                            onClick={() => setViewMode(view.id)}
                            className={`view-btn ${viewMode === view.id ? 'active' : ''}`}
                        >
                            <span>{view.icon}</span>
                            <span>{view.label}</span>
                        </button>
                    ))}
                </div>
                
                {/* 类型筛选（仅在浏览模式显示） */}
                {viewMode === 'browse' && (
                    <div className="type-filter-sidebar">
                        <TypeFilter
                            activeType={knowledgeType}
                            onChange={setKnowledgeType}
                            counts={stats.byType}
                        />
                    </div>
                )}
                
                {/* 索引状态 */}
                <div className="index-status">
                    <div className="status-info">
                        <span className={stats.indexed > 0 ? 'text-green' : 'text-gray'}>
                            {stats.indexed > 0 ? '✓' : '○'} 已索引 {stats.indexed}
                        </span>
                        {indexing && indexProgress && (
                            <div className="index-progress-mini">
                                <span className="progress-msg">{indexProgress.message}</span>
                                {indexProgress.total > 0 && (
                                    <div className="progress-bar-mini">
                                        <div
                                            className="progress-fill-mini"
                                            style={{ width: `${Math.round((indexProgress.current / indexProgress.total) * 100)}%` }}
                                        />
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    <div className="status-actions">
                        <button
                            onClick={handleRefreshIndex}
                            disabled={indexing}
                            className={`refresh-btn ${indexing ? 'loading' : ''}`}
                            title="刷新索引"
                        >
                            <span className={indexing ? 'spin' : ''}>🔄</span>
                            {indexing ? (indexProgress?.message || '索引中...') : '刷新'}
                        </button>
                        <button
                            onClick={handleClearAll}
                            disabled={indexing}
                            className="clear-btn"
                            title="清空所有知识"
                        >
                            🗑️ 清空
                        </button>
                    </div>
                </div>
            </div>
            
            {/* 右侧内容区 */}
            <div className="knowledge-content">
                {viewMode === 'search' && (
                    <div className="search-content">
                        <KnowledgeSearch
                            designerId={designer?.designerId}
                            onSelect={onKnowledgeSelect}
                            onApply={onKnowledgeApply}
                            placeholder="输入关键词语义搜索..."
                            autoFocus
                        />
                        
                        <div className="recommendation-section">
                            <SmartRecommendation
                                context={{ currentTask: '知识库管理' }}
                                designerId={designer?.designerId}
                                onSelect={onKnowledgeSelect}
                                onApply={onKnowledgeApply}
                                maxItems={5}
                            />
                        </div>
                    </div>
                )}
                
                {viewMode === 'browse' && (
                    <BrowseList
                        knowledgeType={knowledgeType}
                        onSelect={onKnowledgeSelect || (() => {})}
                        onApply={onKnowledgeApply || (() => {})}
                    />
                )}
                
                {viewMode === 'import' && (
                    <div className="import-content">
                        <QuickImport
                            onImportComplete={handleImportComplete}
                            onError={(err) => console.error('导入错误:', err)}
                        />
                    </div>
                )}
            </div>
            
            <style>{`
                .knowledge-panel {
                    display: flex;
                    height: 100%;
                    width: 100%;
                    background: var(--de-bg-dark);
                }
                
                .knowledge-sidebar {
                    width: 240px;
                    min-width: 240px;
                    border-right: 1px solid var(--de-border);
                    display: flex;
                    flex-direction: column;
                    background: var(--de-bg-card);
                }
                
                .sidebar-header {
                    padding: 16px;
                    border-bottom: 1px solid var(--de-border);
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                }
                
                .sidebar-header h2 {
                    font-size: 16px;
                    font-weight: 600;
                    color: var(--de-text);
                    margin: 0;
                }
                
                .stats-badge {
                    font-size: 12px;
                    padding: 2px 8px;
                    background: var(--de-primary-alpha);
                    color: var(--de-primary);
                    border-radius: 12px;
                }
                
                .view-switcher {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                    padding: 12px;
                    border-bottom: 1px solid var(--de-border);
                }
                
                .view-btn {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 10px 12px;
                    border: none;
                    background: transparent;
                    color: var(--de-text-secondary);
                    font-size: 14px;
                    border-radius: 8px;
                    cursor: pointer;
                    transition: all 0.15s ease;
                    text-align: left;
                }
                
                .view-btn:hover {
                    background: rgba(255, 255, 255, 0.05);
                    color: var(--de-text);
                }
                
                .view-btn.active {
                    background: var(--de-primary);
                    color: white;
                }
                
                .type-filter-sidebar {
                    padding: 12px;
                    border-bottom: 1px solid var(--de-border);
                    flex: 1;
                    overflow-y: auto;
                }
                
                .index-status {
                    padding: 12px;
                    border-top: 1px solid var(--de-border);
                    margin-top: auto;
                }
                
                .status-info {
                    font-size: 12px;
                    color: var(--de-text-secondary);
                    margin-bottom: 8px;
                }
                
                .index-progress-mini {
                    margin-top: 6px;
                    font-size: 11px;
                    color: var(--de-text-muted);
                }
                
                .progress-msg {
                    display: block;
                    margin-bottom: 4px;
                }
                
                .progress-bar-mini {
                    height: 4px;
                    background: var(--de-bg-secondary);
                    border-radius: 2px;
                    overflow: hidden;
                }
                
                .progress-fill-mini {
                    height: 100%;
                    background: var(--de-primary);
                    border-radius: 2px;
                    transition: width 0.2s ease;
                }
                
                .status-info .text-green {
                    color: #10b981;
                }
                
                .status-info .text-gray {
                    color: var(--de-text-muted);
                }
                
                .status-actions {
                    display: flex;
                    gap: 8px;
                }
                
                .refresh-btn {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 6px;
                    flex: 1;
                    padding: 8px;
                    border: 1px solid var(--de-border);
                    background: transparent;
                    color: var(--de-text-secondary);
                    font-size: 12px;
                    border-radius: 8px;
                    cursor: pointer;
                    transition: all 0.15s ease;
                }
                
                .clear-btn {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 8px 12px;
                    border: 1px solid var(--de-error);
                    background: rgba(239, 68, 68, 0.1);
                    color: var(--de-error);
                    font-size: 12px;
                    border-radius: 8px;
                    cursor: pointer;
                    transition: all 0.15s ease;
                }
                
                .clear-btn:hover:not(:disabled) {
                    background: var(--de-error);
                    color: white;
                }
                
                .refresh-btn:hover:not(:disabled) {
                    background: rgba(255, 255, 255, 0.05);
                    border-color: var(--de-primary);
                    color: var(--de-primary);
                }
                
                .refresh-btn:disabled {
                    opacity: 0.7;
                    cursor: not-allowed;
                }
                
                .refresh-btn.loading {
                    background: rgba(234, 179, 8, 0.1);
                    border-color: rgba(234, 179, 8, 0.3);
                    color: #eab308;
                }
                
                .refresh-btn .spin {
                    animation: spin 1s linear infinite;
                }
                
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                
                .knowledge-content {
                    flex: 1;
                    overflow-y: auto;
                    padding: 20px;
                    background: var(--de-bg-dark);
                }
                
                .search-content {
                    max-width: 800px;
                    margin: 0 auto;
                }
                
                .recommendation-section {
                    margin-top: 24px;
                }
                
                .import-content {
                    max-width: 600px;
                    margin: 0 auto;
                }
                
            `}</style>
        </div>
    );
};

export default UnifiedKnowledgePanel;


