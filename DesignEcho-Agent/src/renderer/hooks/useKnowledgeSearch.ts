/**
 * 知识库搜索 Hook
 * 
 * 提供防抖搜索、搜索历史、热门搜索等功能
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import {
    searchKnowledge,
    searchKnowledgeAdvanced,
    quickSearch,
    recordKnowledgeClick,
    ScoredKnowledgeEntry,
    SearchFilters,
    RAGSearchResult
} from '../services/rag.service';

// ==================== 类型定义 ====================

interface UseKnowledgeSearchOptions {
    /**
     * 设计师 ID (用于个性化)
     */
    designerId?: string;
    
    /**
     * 默认搜索限制
     */
    defaultLimit?: number;
    
    /**
     * 防抖延迟 (ms)
     */
    debounceMs?: number;
    
    /**
     * 是否启用搜索历史
     */
    enableHistory?: boolean;
    
    /**
     * 最大历史记录数
     */
    maxHistory?: number;
    
    /**
     * 是否自动触发热门推荐
     */
    autoRecommend?: boolean;

    /**
     * setQuery 时是否自动触发搜索
     */
    autoSearchOnQueryChange?: boolean;

    /**
     * 可选视觉向量输入（由上层提供）
     */
    visualEmbedding?: number[];

    /**
     * 可选布局向量输入（由上层提供）
     */
    layoutEmbedding?: number[];
}

interface SearchState {
    query: string;
    results: ScoredKnowledgeEntry[];
    loading: boolean;
    error: string | null;
    lastResult: RAGSearchResult | null;
    metadata: {
        totalResults: number;
        processingTimeMs: number;
    } | null;
}

interface UseKnowledgeSearchReturn {
    // 状态
    query: string;
    results: ScoredKnowledgeEntry[];
    loading: boolean;
    error: string | null;
    lastResult: RAGSearchResult | null;
    metadata: SearchState['metadata'];
    
    // 搜索历史
    searchHistory: string[];
    
    // 热门/推荐
    suggestions: string[];
    
    // 操作
    setQuery: (query: string, filters?: SearchFilters) => void;
    search: (query?: string, filters?: SearchFilters) => Promise<void>;
    clearResults: () => void;
    clearHistory: () => void;
    recordClick: (knowledgeId: string) => void;
}

// ==================== 本地存储 Key ====================

const HISTORY_STORAGE_KEY = 'designecho_search_history';
const SUGGESTIONS_CACHE_KEY = 'designecho_search_suggestions';

// ==================== Hook 实现 ====================

export function useKnowledgeSearch(
    options: UseKnowledgeSearchOptions = {}
): UseKnowledgeSearchReturn {
    const {
        designerId,
        defaultLimit = 10,
        debounceMs = 300,
        enableHistory = true,
        maxHistory = 10,
        autoRecommend = true,
        autoSearchOnQueryChange = true
    } = options;
    
    // 状态
    const [state, setState] = useState<SearchState>({
        query: '',
        results: [],
        loading: false,
        error: null,
        lastResult: null,
        metadata: null
    });
    
    const [searchHistory, setSearchHistory] = useState<string[]>([]);
    const [suggestions, setSuggestions] = useState<string[]>([]);
    
    // Refs
    const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const latestFiltersRef = useRef<SearchFilters | undefined>(undefined);
    
    // 初始化 - 加载历史记录
    useEffect(() => {
        if (enableHistory) {
            try {
                const saved = localStorage.getItem(HISTORY_STORAGE_KEY);
                if (saved) {
                    setSearchHistory(JSON.parse(saved));
                }
            } catch (e) {
                console.warn('加载搜索历史失败:', e);
            }
        }
        
        // 加载热门搜索建议
        if (autoRecommend) {
            loadSuggestions();
        }
    }, [enableHistory, autoRecommend]);
    
    // 保存历史记录
    const saveHistory = useCallback((history: string[]) => {
        if (enableHistory) {
            try {
                localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
            } catch (e) {
                console.warn('保存搜索历史失败:', e);
            }
        }
    }, [enableHistory]);
    
    // 加载搜索建议
    const loadSuggestions = useCallback(async () => {
        // 预设的热门搜索词
        const defaultSuggestions = [
            '透气', '保暖', '舒适', '纯棉', '吸汗',
            '防臭', '运动袜', '船袜', '中筒袜', '配色方案'
        ];
        
        setSuggestions(defaultSuggestions);
    }, []);
    
    // 添加到历史
    const addToHistory = useCallback((query: string) => {
        if (!enableHistory || !query.trim()) return;
        
        setSearchHistory(prev => {
            const filtered = prev.filter(h => h !== query);
            const updated = [query, ...filtered].slice(0, maxHistory);
            saveHistory(updated);
            return updated;
        });
    }, [enableHistory, maxHistory, saveHistory]);
    
    // 执行搜索
    const performSearch = useCallback(async (
        query: string,
        filters?: SearchFilters
    ) => {
        // 取消之前的请求
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        abortControllerRef.current = new AbortController();
        
        if (!query.trim()) {
            setState(prev => ({
                ...prev,
                results: [],
                lastResult: null,
                metadata: null,
                loading: false,
                error: null
            }));
            return;
        }
        
        setState(prev => ({ ...prev, loading: true, error: null }));
        
        try {
            const hasMultiModalInput =
                (options.visualEmbedding?.length || 0) > 0 ||
                (options.layoutEmbedding?.length || 0) > 0;

            const result = hasMultiModalInput
                ? await searchKnowledgeAdvanced(query, {
                    limit: defaultLimit,
                    filters,
                    designerId,
                    usePersonalization: !!designerId,
                    visualEmbedding: options.visualEmbedding,
                    layoutEmbedding: options.layoutEmbedding
                })
                : await searchKnowledge(query, {
                    limit: defaultLimit,
                    filters,
                    designerId,
                    usePersonalization: !!designerId
                });
            
            if (result) {
                setState(prev => ({
                    ...prev,
                    results: result.entries,
                    lastResult: result,
                    metadata: {
                        totalResults: result.metadata.totalResults,
                        processingTimeMs: result.metadata.processingTimeMs
                    },
                    loading: false
                }));
                
                // 添加到历史
                addToHistory(query);
            } else {
                setState(prev => ({
                    ...prev,
                    results: [],
                    lastResult: null,
                    metadata: null,
                    loading: false
                }));
            }
        } catch (error: any) {
            if (error.name !== 'AbortError') {
                setState(prev => ({
                    ...prev,
                    error: error.message || '搜索失败',
                    loading: false
                }));
            }
        }
    }, [defaultLimit, designerId, addToHistory]);
    
    // 设置查询 (防抖)
    const setQuery = useCallback((query: string, filters?: SearchFilters) => {
        setState(prev => ({ ...prev, query }));
        latestFiltersRef.current = filters ?? latestFiltersRef.current;

        // 清除之前的定时器
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
        }

        if (!autoSearchOnQueryChange) return;

        // 设置新的定时器
        debounceTimerRef.current = setTimeout(() => {
            performSearch(query, latestFiltersRef.current);
        }, debounceMs);
    }, [autoSearchOnQueryChange, debounceMs, performSearch]);
    
    // 立即搜索
    const search = useCallback(async (
        query?: string,
        filters?: SearchFilters
    ) => {
        const searchQuery = query ?? state.query;
        latestFiltersRef.current = filters ?? latestFiltersRef.current;

        // 清除防抖定时器
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
        }

        await performSearch(searchQuery, latestFiltersRef.current);
    }, [state.query, performSearch]);
    
    // 清空结果
    const clearResults = useCallback(() => {
        setState({
            query: '',
            results: [],
            loading: false,
            error: null,
            lastResult: null,
            metadata: null
        });
    }, []);
    
    // 清空历史
    const clearHistory = useCallback(() => {
        setSearchHistory([]);
        if (enableHistory) {
            try {
                localStorage.removeItem(HISTORY_STORAGE_KEY);
            } catch (e) {
                console.warn('清除搜索历史失败:', e);
            }
        }
    }, [enableHistory]);
    
    // 记录点击
    const recordClick = useCallback((knowledgeId: string) => {
        if (designerId) {
            recordKnowledgeClick(designerId, knowledgeId);
        }
    }, [designerId]);
    
    // 清理
    useEffect(() => {
        return () => {
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
            }
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
        };
    }, []);
    
    return {
        // 状态
        query: state.query,
        results: state.results,
        loading: state.loading,
        error: state.error,
        lastResult: state.lastResult,
        metadata: state.metadata,
        
        // 历史
        searchHistory,
        
        // 建议
        suggestions,
        
        // 操作
        setQuery,
        search,
        clearResults,
        clearHistory,
        recordClick
    };
}

export default useKnowledgeSearch;
