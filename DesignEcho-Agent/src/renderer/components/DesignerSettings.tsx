/**
 * 设计师偏好设置组件
 * 
 * 允许设计师配置个人风格、工作流和 UI 偏好
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
    getOrCreateDesignerProfile,
    updateStylePreferences,
    updateWorkflowPreferences,
    updateUIPreferences,
    updateRetrievalPreferences,
    DesignerProfile,
    StylePreferences,
    WorkflowPreferences,
    UIPreferences,
    RetrievalPreferences
} from '../services/rag.service';

// ==================== 类型定义 ====================

interface DesignerSettingsProps {
    designerId: string;
    onProfileUpdated?: (profile: DesignerProfile) => void;
    className?: string;
}

type SettingsTab = 'style' | 'workflow' | 'ui' | 'retrieval';

// ==================== 子组件 ====================

/**
 * 风格偏好设置
 */
const StylePreferencesPanel: React.FC<{
    preferences: StylePreferences;
    onUpdate: (updates: Partial<StylePreferences>) => void;
}> = ({ preferences, onUpdate }) => {
    const styleOptions = ['极简', '现代', '复古', '轻奢', '自然', '工业', '北欧', '日式'];
    const colorTendencies: Array<{ value: StylePreferences['colorTendency']; label: string }> = [
        { value: 'warm', label: '暖色调' },
        { value: 'cool', label: '冷色调' },
        { value: 'neutral', label: '中性色调' },
        { value: 'mixed', label: '混合' }
    ];

    const toggleStyle = (style: string) => {
        const current = preferences.preferredStyles || [];
        const updated = current.includes(style)
            ? current.filter(s => s !== style)
            : [...current, style];
        onUpdate({ preferredStyles: updated });
    };

    return (
        <div className="space-y-6">
            {/* 偏好风格 */}
            <div>
                <h4 className="text-sm font-medium text-gray-200 mb-3">偏好风格</h4>
                <div className="flex flex-wrap gap-2">
                    {styleOptions.map(style => (
                        <button
                            key={style}
                            onClick={() => toggleStyle(style)}
                            className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                                (preferences.preferredStyles || []).includes(style)
                                    ? 'bg-blue-500 text-white'
                                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                            }`}
                        >
                            {style}
                        </button>
                    ))}
                </div>
            </div>

            {/* 色彩倾向 */}
            <div>
                <h4 className="text-sm font-medium text-gray-200 mb-3">色彩倾向</h4>
                <div className="grid grid-cols-2 gap-2">
                    {colorTendencies.map(({ value, label }) => (
                        <button
                            key={value}
                            onClick={() => onUpdate({ colorTendency: value })}
                            className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                                preferences.colorTendency === value
                                    ? 'bg-blue-500 text-white'
                                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            {/* 设计原则 */}
            <div>
                <h4 className="text-sm font-medium text-gray-200 mb-3">设计原则 (可选)</h4>
                <textarea
                    value={(preferences.designPrinciples || []).join('\n')}
                    onChange={(e) => onUpdate({ designPrinciples: e.target.value.split('\n').filter(Boolean) })}
                    placeholder="每行一条设计原则，如：&#10;保持视觉平衡&#10;使用黄金比例&#10;少即是多"
                    className="w-full h-24 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-sm text-gray-200 placeholder-gray-500 resize-none focus:outline-none focus:border-blue-500"
                />
            </div>
        </div>
    );
};

/**
 * 工作流偏好设置
 */
const WorkflowPreferencesPanel: React.FC<{
    preferences: WorkflowPreferences;
    onUpdate: (updates: Partial<WorkflowPreferences>) => void;
}> = ({ preferences, onUpdate }) => {
    const techniques: Array<{ value: WorkflowPreferences['defaultTechnique']; label: string; desc: string }> = [
        { value: 'TPS', label: 'TPS', desc: '薄板样条 - 平滑变形' },
        { value: 'MLS', label: 'MLS', desc: '移动最小二乘 - 精确控制' },
        { value: 'ARAP', label: 'ARAP', desc: '刚性保持 - 纹理保护' }
    ];

    const previewModes: Array<{ value: WorkflowPreferences['previewMode']; label: string }> = [
        { value: '2D', label: '2D 预览' },
        { value: '3D', label: '3D 预览' },
        { value: 'split', label: '分屏对比' }
    ];

    return (
        <div className="space-y-6">
            {/* 默认变形技术 */}
            <div>
                <h4 className="text-sm font-medium text-gray-200 mb-3">默认变形技术</h4>
                <div className="space-y-2">
                    {techniques.map(({ value, label, desc }) => (
                        <button
                            key={value}
                            onClick={() => onUpdate({ defaultTechnique: value })}
                            className={`w-full px-4 py-3 rounded-lg text-left transition-colors ${
                                preferences.defaultTechnique === value
                                    ? 'bg-blue-500/20 border border-blue-500'
                                    : 'bg-gray-700 border border-gray-600 hover:bg-gray-600'
                            }`}
                        >
                            <span className="font-medium text-gray-200">{label}</span>
                            <span className="text-gray-400 text-sm ml-2">{desc}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* 预览模式 */}
            <div>
                <h4 className="text-sm font-medium text-gray-200 mb-3">预览模式</h4>
                <div className="grid grid-cols-3 gap-2">
                    {previewModes.map(({ value, label }) => (
                        <button
                            key={value}
                            onClick={() => onUpdate({ previewMode: value })}
                            className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                                preferences.previewMode === value
                                    ? 'bg-blue-500 text-white'
                                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            {/* 开关选项 */}
            <div className="space-y-3">
                <label className="flex items-center justify-between">
                    <span className="text-sm text-gray-300">自动纠正</span>
                    <input
                        type="checkbox"
                        checked={preferences.autoCorrection ?? true}
                        onChange={(e) => onUpdate({ autoCorrection: e.target.checked })}
                        className="w-5 h-5 rounded bg-gray-700 border-gray-600 text-blue-500 focus:ring-blue-500 focus:ring-offset-gray-800"
                    />
                </label>
                <label className="flex items-center justify-between">
                    <span className="text-sm text-gray-300">批量处理</span>
                    <input
                        type="checkbox"
                        checked={preferences.batchProcessing ?? false}
                        onChange={(e) => onUpdate({ batchProcessing: e.target.checked })}
                        className="w-5 h-5 rounded bg-gray-700 border-gray-600 text-blue-500 focus:ring-blue-500 focus:ring-offset-gray-800"
                    />
                </label>
                <label className="flex items-center justify-between">
                    <span className="text-sm text-gray-300">应用前确认</span>
                    <input
                        type="checkbox"
                        checked={preferences.confirmBeforeApply ?? false}
                        onChange={(e) => onUpdate({ confirmBeforeApply: e.target.checked })}
                        className="w-5 h-5 rounded bg-gray-700 border-gray-600 text-blue-500 focus:ring-blue-500 focus:ring-offset-gray-800"
                    />
                </label>
                <label className="flex items-center justify-between">
                    <span className="text-sm text-gray-300">自动保存</span>
                    <input
                        type="checkbox"
                        checked={preferences.autoSave ?? true}
                        onChange={(e) => onUpdate({ autoSave: e.target.checked })}
                        className="w-5 h-5 rounded bg-gray-700 border-gray-600 text-blue-500 focus:ring-blue-500 focus:ring-offset-gray-800"
                    />
                </label>
            </div>
        </div>
    );
};

/**
 * UI 偏好设置
 */
const UIPreferencesPanel: React.FC<{
    preferences: UIPreferences;
    onUpdate: (updates: Partial<UIPreferences>) => void;
}> = ({ preferences, onUpdate }) => {
    const themes: Array<{ value: UIPreferences['theme']; label: string }> = [
        { value: 'dark', label: '深色' },
        { value: 'light', label: '浅色' },
        { value: 'auto', label: '跟随系统' }
    ];

    const layouts: Array<{ value: UIPreferences['layoutMode']; label: string }> = [
        { value: 'grid', label: '网格' },
        { value: 'list', label: '列表' },
        { value: 'compact', label: '紧凑' }
    ];

    const densities: Array<{ value: UIPreferences['infoDensity']; label: string }> = [
        { value: 'dense', label: '密集' },
        { value: 'normal', label: '正常' },
        { value: 'spacious', label: '宽松' }
    ];

    const fontSizes: Array<{ value: UIPreferences['fontSize']; label: string }> = [
        { value: 'small', label: '小' },
        { value: 'medium', label: '中' },
        { value: 'large', label: '大' }
    ];

    return (
        <div className="space-y-6">
            {/* 主题 */}
            <div>
                <h4 className="text-sm font-medium text-gray-200 mb-3">主题</h4>
                <div className="grid grid-cols-3 gap-2">
                    {themes.map(({ value, label }) => (
                        <button
                            key={value}
                            onClick={() => onUpdate({ theme: value })}
                            className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                                preferences.theme === value
                                    ? 'bg-blue-500 text-white'
                                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            {/* 布局模式 */}
            <div>
                <h4 className="text-sm font-medium text-gray-200 mb-3">布局模式</h4>
                <div className="grid grid-cols-3 gap-2">
                    {layouts.map(({ value, label }) => (
                        <button
                            key={value}
                            onClick={() => onUpdate({ layoutMode: value })}
                            className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                                preferences.layoutMode === value
                                    ? 'bg-blue-500 text-white'
                                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            {/* 信息密度 */}
            <div>
                <h4 className="text-sm font-medium text-gray-200 mb-3">信息密度</h4>
                <div className="grid grid-cols-3 gap-2">
                    {densities.map(({ value, label }) => (
                        <button
                            key={value}
                            onClick={() => onUpdate({ infoDensity: value })}
                            className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                                preferences.infoDensity === value
                                    ? 'bg-blue-500 text-white'
                                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            {/* 字体大小 */}
            <div>
                <h4 className="text-sm font-medium text-gray-200 mb-3">字体大小</h4>
                <div className="grid grid-cols-3 gap-2">
                    {fontSizes.map(({ value, label }) => (
                        <button
                            key={value}
                            onClick={() => onUpdate({ fontSize: value })}
                            className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                                preferences.fontSize === value
                                    ? 'bg-blue-500 text-white'
                                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            {/* 显示提示 */}
            <label className="flex items-center justify-between">
                <span className="text-sm text-gray-300">显示操作提示</span>
                <input
                    type="checkbox"
                    checked={preferences.showTips ?? true}
                    onChange={(e) => onUpdate({ showTips: e.target.checked })}
                    className="w-5 h-5 rounded bg-gray-700 border-gray-600 text-blue-500 focus:ring-blue-500 focus:ring-offset-gray-800"
                />
            </label>
        </div>
    );
};

/**
 * 检索偏好设置
 */
const RetrievalPreferencesPanel: React.FC<{
    preferences: RetrievalPreferences;
    onUpdate: (updates: Partial<RetrievalPreferences>) => void;
}> = ({ preferences, onUpdate }) => {
    const categoryOptions = ['女袜', '男袜', '童袜', '运动袜', '商务袜', '保暖袜', '丝袜', '船袜'];

    const toggleCategory = (category: string) => {
        const current = preferences.preferredCategories || [];
        const updated = current.includes(category)
            ? current.filter(c => c !== category)
            : [...current, category];
        onUpdate({ preferredCategories: updated });
    };

    return (
        <div className="space-y-6">
            {/* 优先类目 */}
            <div>
                <h4 className="text-sm font-medium text-gray-200 mb-3">优先检索类目</h4>
                <div className="flex flex-wrap gap-2">
                    {categoryOptions.map(category => (
                        <button
                            key={category}
                            onClick={() => toggleCategory(category)}
                            className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                                (preferences.preferredCategories || []).includes(category)
                                    ? 'bg-green-500 text-white'
                                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                            }`}
                        >
                            {category}
                        </button>
                    ))}
                </div>
            </div>

            {/* 语义权重 */}
            <div>
                <h4 className="text-sm font-medium text-gray-200 mb-3">
                    语义检索权重: {((preferences.semanticWeight || 0.6) * 100).toFixed(0)}%
                </h4>
                <input
                    type="range"
                    min="0"
                    max="100"
                    value={(preferences.semanticWeight || 0.6) * 100}
                    onChange={(e) => onUpdate({ semanticWeight: parseInt(e.target.value) / 100 })}
                    className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                    <span>关键词优先</span>
                    <span>语义优先</span>
                </div>
            </div>

            {/* 返回结果数 */}
            <div>
                <h4 className="text-sm font-medium text-gray-200 mb-3">
                    默认返回结果数: {preferences.resultLimit || 10}
                </h4>
                <input
                    type="range"
                    min="3"
                    max="20"
                    value={preferences.resultLimit || 10}
                    onChange={(e) => onUpdate({ resultLimit: parseInt(e.target.value) })}
                    className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                    <span>3</span>
                    <span>20</span>
                </div>
            </div>

            {/* 排除主题 */}
            <div>
                <h4 className="text-sm font-medium text-gray-200 mb-3">排除主题 (可选)</h4>
                <input
                    type="text"
                    value={(preferences.excludedTopics || []).join(', ')}
                    onChange={(e) => onUpdate({ excludedTopics: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                    placeholder="用逗号分隔，如：儿童, 卡通"
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
            </div>
        </div>
    );
};

// ==================== 主组件 ====================

/**
 * 设计师设置面板
 */
export const DesignerSettings: React.FC<DesignerSettingsProps> = ({
    designerId,
    onProfileUpdated,
    className = ''
}) => {
    const [profile, setProfile] = useState<DesignerProfile | null>(null);
    const [activeTab, setActiveTab] = useState<SettingsTab>('style');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // 加载设计师档案
    useEffect(() => {
        const loadProfile = async () => {
            setLoading(true);
            const data = await getOrCreateDesignerProfile(designerId);
            setProfile(data);
            setLoading(false);
        };
        loadProfile();
    }, [designerId]);

    // 更新处理函数
    const handleStyleUpdate = useCallback(async (updates: Partial<StylePreferences>) => {
        if (!profile) return;
        setSaving(true);
        const success = await updateStylePreferences(designerId, updates);
        if (success) {
            const updatedProfile: DesignerProfile = {
                ...profile,
                stylePreferences: { ...profile.stylePreferences, ...updates }
            };
            setProfile(updatedProfile);
            onProfileUpdated?.(updatedProfile);
        }
        setSaving(false);
    }, [designerId, profile, onProfileUpdated]);

    const handleWorkflowUpdate = useCallback(async (updates: Partial<WorkflowPreferences>) => {
        if (!profile) return;
        setSaving(true);
        const success = await updateWorkflowPreferences(designerId, updates);
        if (success) {
            const updatedProfile: DesignerProfile = {
                ...profile,
                workflowPreferences: { ...profile.workflowPreferences, ...updates }
            };
            setProfile(updatedProfile);
            onProfileUpdated?.(updatedProfile);
        }
        setSaving(false);
    }, [designerId, profile, onProfileUpdated]);

    const handleUIUpdate = useCallback(async (updates: Partial<UIPreferences>) => {
        if (!profile) return;
        setSaving(true);
        const success = await updateUIPreferences(designerId, updates);
        if (success) {
            const updatedProfile: DesignerProfile = {
                ...profile,
                uiPreferences: { ...profile.uiPreferences, ...updates }
            };
            setProfile(updatedProfile);
            onProfileUpdated?.(updatedProfile);
        }
        setSaving(false);
    }, [designerId, profile, onProfileUpdated]);

    const handleRetrievalUpdate = useCallback(async (updates: Partial<RetrievalPreferences>) => {
        if (!profile) return;
        setSaving(true);
        const success = await updateRetrievalPreferences(designerId, updates);
        if (success) {
            const updatedProfile: DesignerProfile = {
                ...profile,
                retrievalPreferences: { ...profile.retrievalPreferences, ...updates }
            };
            setProfile(updatedProfile);
            onProfileUpdated?.(updatedProfile);
        }
        setSaving(false);
    }, [designerId, profile, onProfileUpdated]);

    // 渲染
    if (loading) {
        return (
            <div className={`flex items-center justify-center h-64 ${className}`}>
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            </div>
        );
    }

    if (!profile) {
        return (
            <div className={`text-center text-gray-400 py-8 ${className}`}>
                无法加载设计师档案
            </div>
        );
    }

    const tabs: Array<{ id: SettingsTab; label: string }> = [
        { id: 'style', label: '风格' },
        { id: 'workflow', label: '工作流' },
        { id: 'ui', label: '界面' },
        { id: 'retrieval', label: '检索' }
    ];

    return (
        <div className={`bg-gray-800 rounded-xl overflow-hidden ${className}`}>
            {/* 头部 */}
            <div className="px-4 py-3 bg-gray-900/50 border-b border-gray-700 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white text-sm font-medium">
                        {profile.name.charAt(0)}
                    </div>
                    <div>
                        <h3 className="font-medium text-gray-200">{profile.name}</h3>
                        <p className="text-xs text-gray-500">个人设置</p>
                    </div>
                </div>
                {saving && (
                    <span className="text-xs text-blue-400">保存中...</span>
                )}
            </div>

            {/* 标签页 */}
            <div className="flex border-b border-gray-700">
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex-1 px-4 py-2.5 text-sm transition-colors ${
                            activeTab === tab.id
                                ? 'text-blue-400 border-b-2 border-blue-500 bg-gray-700/30'
                                : 'text-gray-400 hover:text-gray-300 hover:bg-gray-700/20'
                        }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* 内容区 */}
            <div className="p-4 max-h-[400px] overflow-y-auto">
                {activeTab === 'style' && (
                    <StylePreferencesPanel
                        preferences={profile.stylePreferences}
                        onUpdate={handleStyleUpdate}
                    />
                )}
                {activeTab === 'workflow' && (
                    <WorkflowPreferencesPanel
                        preferences={profile.workflowPreferences}
                        onUpdate={handleWorkflowUpdate}
                    />
                )}
                {activeTab === 'ui' && (
                    <UIPreferencesPanel
                        preferences={profile.uiPreferences}
                        onUpdate={handleUIUpdate}
                    />
                )}
                {activeTab === 'retrieval' && (
                    <RetrievalPreferencesPanel
                        preferences={profile.retrievalPreferences}
                        onUpdate={handleRetrievalUpdate}
                    />
                )}
            </div>
        </div>
    );
};

export default DesignerSettings;
