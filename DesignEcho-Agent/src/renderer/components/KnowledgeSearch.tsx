import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
    recordKnowledgeClick,
    recordKnowledgeApply,
    ScoredKnowledgeEntry,
    SearchFilters,
    KnowledgeEntry
} from '../services/rag.service';
import { useKnowledgeSearch } from '../hooks/useKnowledgeSearch';
import { useAppStore } from '../stores/app.store';

interface KnowledgeSearchProps {
    designerId?: string;
    onSelect?: (entry: KnowledgeEntry) => void;
    onApply?: (entry: KnowledgeEntry) => void;
    placeholder?: string;
    className?: string;
    autoFocus?: boolean;
}

function getConfidenceColor(percent: number): string {
    if (percent >= 70) return 'bg-green-500';
    if (percent >= 40) return 'bg-yellow-500';
    return 'bg-gray-500';
}

const typeConfig: Record<string, { icon: string; color: string; label: string }> = {
    selling_point: { icon: '✨', color: 'bg-yellow-500/20 text-yellow-400', label: '卖点' },
    pain_point: { icon: '💡', color: 'bg-red-500/20 text-red-400', label: '痛点' },
    color_scheme: { icon: '🎨', color: 'bg-purple-500/20 text-purple-400', label: '配色' },
    technique: { icon: '⚙️', color: 'bg-blue-500/20 text-blue-400', label: '技巧' },
    case: { icon: '📋', color: 'bg-green-500/20 text-green-400', label: '案例' },
    copy_template: { icon: '📝', color: 'bg-orange-500/20 text-orange-400', label: '文案' }
};

const SearchResultItem: React.FC<{
    result: ScoredKnowledgeEntry;
    onSelect: () => void;
    onApply: () => void;
    onView: () => void;
    onOpenFile?: () => void;
}> = ({ result, onSelect, onApply, onView, onOpenFile }) => {
    const { entry, score, semanticScore, keywordScore, visualScore, layoutScore, personalBoost } = result;
    const config = typeConfig[entry.type] || { icon: '📄', color: 'bg-gray-500/20 text-gray-400', label: entry.type };
    const confidencePercent = Math.round(score * 100);
    const extra = entry.metadata?.extra as { filePath?: string; projectId?: string } | undefined;

    return (
        <div
            className="group p-3 rounded-lg bg-gray-700/50 hover:bg-gray-700 transition-colors cursor-pointer"
            onClick={onSelect}
        >
            <div className="flex items-start gap-3">
                <div className={`w-8 h-8 rounded-lg ${config.color} flex items-center justify-center flex-shrink-0`}>
                    <span className="text-base">{config.icon}</span>
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-medium text-gray-200 truncate">{entry.title}</h4>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${config.color}`}>{config.label}</span>
                    </div>

                    {entry.description && <p className="text-sm text-gray-400 line-clamp-2 mb-2">{entry.description}</p>}

                    <div className="flex items-center gap-3 text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                            <span className={`w-2 h-2 rounded-full ${getConfidenceColor(confidencePercent)}`}></span>
                            相关度 {confidencePercent}%
                        </span>
                        {personalBoost > 1 && <span className="text-purple-400">⭐ 个性化推荐</span>}
                        {entry.metadata?.categories?.length > 0 && (
                            <span className="truncate">{entry.metadata.categories.slice(0, 2).join(', ')}</span>
                        )}
                    </div>

                    <div className="mt-1 text-[11px] text-gray-500">
                        语义 {Math.round((semanticScore || 0) * 100)}%
                        {' · '}关键词 {Math.round((keywordScore || 0) * 100)}%
                        {typeof visualScore === 'number' && <> {' · '}视觉 {Math.round(visualScore * 100)}%</>}
                        {typeof layoutScore === 'number' && <> {' · '}结构 {Math.round(layoutScore * 100)}%</>}
                    </div>

                    {extra?.projectId && <div className="mt-1 text-[11px] text-blue-300">项目: {extra.projectId}</div>}
                    {extra?.filePath && (
                        <div className="mt-1 text-[11px] text-gray-500 truncate" title={extra.filePath}>
                            文件: {extra.filePath}
                        </div>
                    )}
                </div>

                <div className="opacity-0 group-hover:opacity-100 flex items-center gap-2 transition-all">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onView();
                        }}
                        className="px-3 py-1.5 bg-gray-600 hover:bg-gray-500 text-white text-sm rounded-lg transition-all"
                    >
                        查看
                    </button>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onApply();
                        }}
                        className="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded-lg transition-all"
                    >
                        应用
                    </button>
                    {extra?.filePath && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onOpenFile?.();
                            }}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded-lg transition-all"
                        >
                            打开文件
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

const FilterSelector: React.FC<{
    filters: SearchFilters;
    onChange: (filters: SearchFilters) => void;
}> = ({ filters, onChange }) => {
    const types = [
        { id: 'selling_point', label: '卖点' },
        { id: 'pain_point', label: '痛点' },
        { id: 'color_scheme', label: '配色' },
        { id: 'technique', label: '技巧' },
        { id: 'case', label: '案例' },
        { id: 'copy_template', label: '文案' }
    ];

    const toggleType = (type: string) => {
        const current = filters.types || [];
        const updated = current.includes(type as any)
            ? current.filter(t => t !== type)
            : [...current, type as any];
        onChange({ ...filters, types: updated.length > 0 ? updated : undefined });
    };

    return (
        <div className="flex flex-wrap gap-1.5 p-2 bg-gray-800/50 rounded-lg">
            {types.map(type => (
                <button
                    key={type.id}
                    onClick={() => toggleType(type.id)}
                    className={`px-2 py-1 text-xs rounded transition-colors ${
                        (filters.types || []).includes(type.id as any)
                            ? 'bg-blue-500 text-white'
                            : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                    }`}
                >
                    {type.label}
                </button>
            ))}
        </div>
    );
};

const EmptyState: React.FC<{ query: string }> = ({ query }) => (
    <div className="text-center py-12">
        <div className="text-4xl mb-4">🔍</div>
        <h3 className="text-lg font-medium text-gray-300 mb-2">{query ? `未找到 "${query}" 相关知识` : '开始搜索'}</h3>
        <p className="text-sm text-gray-500">
            {query ? '尝试使用不同的关键词或减少过滤条件' : '输入关键词搜索知识库，如：保暖、舒适、配色方案'}
        </p>
    </div>
);

export const KnowledgeSearch: React.FC<KnowledgeSearchProps> = ({
    designerId,
    onSelect,
    onApply,
    placeholder = '搜索知识库...',
    className = '',
    autoFocus = false
}) => {
    const [filters, setFilters] = useState<SearchFilters>({});
    const [showFilters, setShowFilters] = useState(false);
    const [selectedEntry, setSelectedEntry] = useState<KnowledgeEntry | null>(null);
    const [sourceFilter, setSourceFilter] = useState<Array<'system' | 'user' | 'learned' | 'import' | 'uxp'>>([]);
    const currentProject = useAppStore((s) => s.currentProject);
    const [limitCurrentProject, setLimitCurrentProject] = useState<boolean>(false);
    const {
        query,
        results,
        loading,
        metadata: searchMeta,
        lastResult: lastSearchResult,
        setQuery,
        search,
        clearResults
    } = useKnowledgeSearch({
        designerId,
        defaultLimit: 15,
        debounceMs: 300,
        enableHistory: false,
        autoRecommend: false,
        autoSearchOnQueryChange: false
    });

    const inputRef = useRef<HTMLInputElement>(null);
    const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        if (autoFocus && inputRef.current) {
            inputRef.current.focus();
        }
    }, [autoFocus]);

    useEffect(() => {
        setLimitCurrentProject(!!currentProject?.id);
    }, [currentProject?.id]);

    const openAssetFile = useCallback(async (entry: KnowledgeEntry) => {
        const extra = entry?.metadata?.extra as { filePath?: string } | undefined;
        if (!extra?.filePath) return;
        try {
            await (window as any).designEcho?.invoke?.('fs:openPath', extra.filePath);
        } catch (error) {
            console.error('[KnowledgeSearch] 打开文件失败:', error);
        }
    }, []);

    const performSearch = useCallback(async (searchQuery: string) => {
        if (!searchQuery.trim()) {
            clearResults();
            return;
        }

        try {
            const mergedFilters: SearchFilters = { ...filters };
            if (sourceFilter.length > 0) {
                mergedFilters.sources = sourceFilter;
            }
            if (limitCurrentProject && currentProject?.id) {
                const categories = new Set<string>(mergedFilters.categories || []);
                categories.add(currentProject.id);
                mergedFilters.categories = Array.from(categories);
            }

            await search(
                searchQuery,
                Object.keys(mergedFilters).length > 0 ? mergedFilters : undefined
            );
        } catch (error) {
            console.error('[KnowledgeSearch] 搜索失败:', error);
        }
    }, [filters, sourceFilter, limitCurrentProject, currentProject?.id, search, clearResults]);

    const handleQueryChange = useCallback((value: string) => {
        setQuery(value);

        if (searchTimeoutRef.current) {
            clearTimeout(searchTimeoutRef.current);
        }

        searchTimeoutRef.current = setTimeout(() => {
            performSearch(value);
        }, 300);
    }, [performSearch]);

    const handleSelect = useCallback((entry: KnowledgeEntry) => {
        if (designerId) {
            recordKnowledgeClick(designerId, entry.id);
        }
        setSelectedEntry(entry);
        onSelect?.(entry);
    }, [designerId, onSelect]);

    const handleApply = useCallback((entry: KnowledgeEntry) => {
        if (designerId) {
            recordKnowledgeApply(designerId, entry.id);
        }
        onApply?.(entry);
    }, [designerId, onApply]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            if (searchTimeoutRef.current) {
                clearTimeout(searchTimeoutRef.current);
            }
            performSearch(query);
        }
    }, [query, performSearch]);

    const handleClear = useCallback(() => {
        setQuery('');
        clearResults();
        inputRef.current?.focus();
    }, [setQuery, clearResults]);

    return (
        <div className={`bg-gray-800 rounded-xl overflow-hidden ${className}`}>
            <div className="p-3 border-b border-gray-700">
                <div className="relative">
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(e) => handleQueryChange(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={placeholder}
                        className="w-full pl-10 pr-20 py-2.5 bg-gray-700 border border-gray-600 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                    />

                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
                        {loading ? (
                            <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                            </svg>
                        ) : (
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                            </svg>
                        )}
                    </div>

                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                        {query && (
                            <button
                                onClick={handleClear}
                                className="p-1.5 text-gray-500 hover:text-gray-300 rounded transition-colors"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
                                </svg>
                            </button>
                        )}
                        <button
                            onClick={() => setShowFilters(!showFilters)}
                            className={`p-1.5 rounded transition-colors ${
                                showFilters || Object.keys(filters).length > 0 || sourceFilter.length > 0 || limitCurrentProject
                                    ? 'text-blue-400 bg-blue-500/20'
                                    : 'text-gray-500 hover:text-gray-300'
                            }`}
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"/>
                            </svg>
                        </button>
                    </div>
                </div>

                {showFilters && (
                    <div className="mt-3 space-y-2">
                        <FilterSelector filters={filters} onChange={setFilters} />

                        <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="text-gray-400">来源过滤:</span>
                            {(['system', 'user', 'import', 'uxp', 'learned'] as const).map(source => {
                                const active = sourceFilter.includes(source);
                                return (
                                    <button
                                        key={source}
                                        onClick={() => {
                                            setSourceFilter(prev => active ? prev.filter(s => s !== source) : [...prev, source]);
                                        }}
                                        className={`px-2 py-1 rounded ${
                                            active ? 'bg-indigo-500 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                        }`}
                                    >
                                        {source}
                                    </button>
                                );
                            })}
                        </div>

                        <label className="flex items-center gap-2 text-xs text-gray-300">
                            <input
                                type="checkbox"
                                checked={limitCurrentProject}
                                onChange={(e) => setLimitCurrentProject(e.target.checked)}
                            />
                            仅当前项目{currentProject?.id ? `（${currentProject.id}）` : '（未选择项目）'}
                        </label>
                    </div>
                )}

                {searchMeta && (
                    <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
                        <span>找到 {searchMeta.totalResults} 条结果</span>
                        <span>•</span>
                        <span>{searchMeta.processingTimeMs.toFixed(0)}ms</span>
                    </div>
                )}

                {lastSearchResult && (
                    <details className="mt-2 rounded-lg border border-gray-700 bg-gray-900/40 p-2 text-xs text-gray-300">
                        <summary className="cursor-pointer select-none text-gray-200">查看检索详情（查询/过滤/Prompt上下文）</summary>
                        <div className="mt-2 space-y-1">
                            <div><span className="text-gray-400">查询:</span> {lastSearchResult.metadata.query}</div>
                            <div><span className="text-gray-400">过滤:</span> {JSON.stringify(lastSearchResult.metadata.filters || {})}</div>
                            <div><span className="text-gray-400">返回数:</span> {lastSearchResult.metadata.totalResults}</div>
                            <div><span className="text-gray-400">Context:</span></div>
                            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-2 text-[11px] text-gray-300">
                                {lastSearchResult.contextForPrompt || '(empty)'}
                            </pre>
                        </div>
                    </details>
                )}
            </div>

            <div className="max-h-[450px] overflow-y-auto">
                {results.length > 0 ? (
                    <div className="p-3 space-y-2">
                        {results.map(result => (
                            <SearchResultItem
                                key={result.entry.id}
                                result={result}
                                onSelect={() => handleSelect(result.entry)}
                                onView={() => setSelectedEntry(result.entry)}
                                onApply={() => handleApply(result.entry)}
                                onOpenFile={() => openAssetFile(result.entry)}
                            />
                        ))}
                    </div>
                ) : (
                    <EmptyState query={query} />
                )}
            </div>

            {selectedEntry && (
                <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6" onClick={() => setSelectedEntry(null)}>
                    <div className="w-full max-w-3xl max-h-[80vh] overflow-hidden rounded-xl bg-gray-800 border border-gray-600" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
                            <div>
                                <h3 className="text-base font-semibold text-gray-100">{selectedEntry.title}</h3>
                                <p className="text-xs text-gray-400 mt-1">类型: {selectedEntry.type}</p>
                            </div>
                            <button
                                onClick={() => setSelectedEntry(null)}
                                className="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm"
                            >
                                关闭
                            </button>
                        </div>
                        <div className="p-4 overflow-y-auto max-h-[calc(80vh-64px)] space-y-4">
                            {selectedEntry.description && (
                                <div>
                                    <div className="text-xs text-gray-400 mb-1">摘要</div>
                                    <div className="text-sm text-gray-200 whitespace-pre-wrap">{selectedEntry.description}</div>
                                </div>
                            )}
                            <div>
                                <div className="text-xs text-gray-400 mb-1">内容</div>
                                <div className="text-sm text-gray-200 whitespace-pre-wrap">{selectedEntry.text || '无内容'}</div>
                            </div>
                            {!!selectedEntry.metadata?.categories?.length && (
                                <div>
                                    <div className="text-xs text-gray-400 mb-1">分类</div>
                                    <div className="text-sm text-gray-200">{selectedEntry.metadata.categories.join(', ')}</div>
                                </div>
                            )}
                            {!!selectedEntry.metadata?.keywords?.length && (
                                <div>
                                    <div className="text-xs text-gray-400 mb-1">关键词</div>
                                    <div className="text-sm text-gray-200">{selectedEntry.metadata.keywords.join(', ')}</div>
                                </div>
                            )}
                            {(selectedEntry.metadata?.extra as any)?.filePath && (
                                <div>
                                    <div className="text-xs text-gray-400 mb-1">文件路径</div>
                                    <div className="text-sm text-gray-200 break-all">{(selectedEntry.metadata?.extra as any).filePath}</div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default KnowledgeSearch;

