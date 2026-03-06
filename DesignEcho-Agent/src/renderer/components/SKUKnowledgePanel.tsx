/**
 * SKU 组合知识库面板 - v2.0 交互式设计
 * 
 * 改进：
 * 1. 交互式颜色标签 - 点击添加，无需填表
 * 2. 预设颜色库 - 常用颜色一键添加
 * 3. 智能粘贴 - 支持批量导入
 * 4. 拖拽排序 - 调整颜色顺序
 */

import React, { useState, useEffect, useCallback, forwardRef, useImperativeHandle, useRef } from 'react';
import type { 
    SKUComboKnowledge,
    TemplateConfig, 
    ColorCombo,
    ComboSize,
    SockType 
} from '../../shared/types/sku-combo.types';

const designEcho = (window as any).designEcho;

// 暴露给父组件的方法
export interface SKUKnowledgePanelRef {
    handleImportCSV: () => void;
    handleExportCSV: () => void;
    handleOpenAddModal: () => void;
}

// 预设颜色库
const PRESET_COLORS = [
    { name: '黑色', color: '#1a1a1a', textColor: '#fff' },
    { name: '白色', color: '#f5f5f5', textColor: '#333' },
    { name: '灰色', color: '#808080', textColor: '#fff' },
    { name: '深灰', color: '#4a4a4a', textColor: '#fff' },
    { name: '浅灰', color: '#d0d0d0', textColor: '#333' },
    { name: '米色', color: '#f5f5dc', textColor: '#333' },
    { name: '卡其', color: '#c3b091', textColor: '#333' },
    { name: '棕色', color: '#8b4513', textColor: '#fff' },
    { name: '咖啡', color: '#6f4e37', textColor: '#fff' },
    { name: '驼色', color: '#c19a6b', textColor: '#333' },
    { name: '红色', color: '#e74c3c', textColor: '#fff' },
    { name: '酒红', color: '#722f37', textColor: '#fff' },
    { name: '粉色', color: '#ffb6c1', textColor: '#333' },
    { name: '玫红', color: '#e91e63', textColor: '#fff' },
    { name: '橙色', color: '#ff9800', textColor: '#333' },
    { name: '黄色', color: '#ffd700', textColor: '#333' },
    { name: '绿色', color: '#27ae60', textColor: '#fff' },
    { name: '墨绿', color: '#2e5d4b', textColor: '#fff' },
    { name: '军绿', color: '#556b2f', textColor: '#fff' },
    { name: '蓝色', color: '#3498db', textColor: '#fff' },
    { name: '深蓝', color: '#2c3e50', textColor: '#fff' },
    { name: '藏青', color: '#003366', textColor: '#fff' },
    { name: '天蓝', color: '#87ceeb', textColor: '#333' },
    { name: '紫色', color: '#9b59b6', textColor: '#fff' },
    { name: '藕荷', color: '#d8bfd8', textColor: '#333' },
];

// 袜子类型选项
const SOCK_TYPES: { value: SockType; label: string }[] = [
    { value: '小腿袜', label: '小腿袜' },
    { value: '中筒袜', label: '中筒袜' },
    { value: '长筒袜', label: '长筒袜' },
    { value: '船袜', label: '船袜' },
    { value: '隐形袜', label: '隐形袜' },
    { value: '儿童袜', label: '儿童袜' },
    { value: '运动袜', label: '运动袜' },
    { value: '其他', label: '其他' },
];

// 规格选项
const COMBO_SIZES: number[] = [2, 3, 4, 5, 6, 7, 8, 9, 10];

// 全局知识库名称
const GLOBAL_KB_NAME = 'SKU 组合知识库';

// 获取颜色的显示样式
function getColorStyle(colorName: string): { bg: string; text: string } {
    const preset = PRESET_COLORS.find(c => c.name === colorName);
    if (preset) {
        return { bg: preset.color, text: preset.textColor };
    }
    // 未知颜色使用渐变背景
    return { bg: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', text: '#fff' };
}

export const SKUKnowledgePanel = forwardRef<SKUKnowledgePanelRef>((_, ref) => {
    // 全局知识库数据
    const [globalKB, setGlobalKB] = useState<SKUComboKnowledge | null>(null);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
    
    // 添加模态框
    const [showAddModal, setShowAddModal] = useState(false);
    const [editingTemplate, setEditingTemplate] = useState<TemplateConfig | null>(null);
    
    // 模板基本信息
    const [templateName, setTemplateName] = useState('');
    const [templateSockType, setTemplateSockType] = useState<SockType>('小腿袜');
    const [selectedSize, setSelectedSize] = useState<ComboSize>(4);
    
    // 颜色组合 - 核心交互数据
    const [combos, setCombos] = useState<{ colors: string[]; remark?: string }[]>([]);
    const [currentCombo, setCurrentCombo] = useState<string[]>([]);
    const [customColorInput, setCustomColorInput] = useState('');
    const [showPresets, setShowPresets] = useState(false);
    
    // 批量粘贴模式
    const [showBatchInput, setShowBatchInput] = useState(false);
    const [batchText, setBatchText] = useState('');
    
    // refs
    const customInputRef = useRef<HTMLInputElement>(null);
    
    // 显示消息
    const showMessage = (type: 'success' | 'error' | 'info', text: string) => {
        setMessage({ type, text });
        setTimeout(() => setMessage(null), 3000);
    };
    
    // 加载全局知识库
    const loadGlobalKB = useCallback(async () => {
        try {
            setLoading(true);
            const list = await designEcho.invoke('sku-knowledge:getAll');
            let kb = list?.find((k: SKUComboKnowledge) => k.name === GLOBAL_KB_NAME);
            if (!kb) {
                kb = await designEcho.invoke('sku-knowledge:create', GLOBAL_KB_NAME);
            }
            setGlobalKB(kb);
        } catch (error: any) {
            console.error('加载知识库失败:', error);
            showMessage('error', '加载知识库失败');
        } finally {
            setLoading(false);
        }
    }, []);
    
    useEffect(() => {
        loadGlobalKB();
    }, [loadGlobalKB]);
    
    // 打开添加弹窗
    const handleOpenAddModal = useCallback(() => {
        setEditingTemplate(null);
        setTemplateName('');
        setTemplateSockType('小腿袜');
        setSelectedSize(4);
        setCombos([]);
        setCurrentCombo([]);
        setShowAddModal(true);
    }, []);
    
    // 编辑模板
    const handleEditTemplate = (template: TemplateConfig) => {
        setEditingTemplate(template);
        setTemplateName(template.name);
        setTemplateSockType(template.sockType);
        setSelectedSize(template.comboSize);
        setCombos(template.combos.map(c => ({ colors: [...c.colors], remark: c.remark })));
        setCurrentCombo([]);
        setShowAddModal(true);
    };
    
    // 删除模板
    const handleDeleteTemplate = async (templateId: string) => {
        if (!globalKB) return;
        if (!confirm('确定删除此模板及其所有组合？')) return;
        
        try {
            await designEcho.invoke('sku-knowledge:deleteTemplate', globalKB.id, templateId);
            setGlobalKB(prev => prev ? {
                ...prev,
                templates: prev.templates.filter(t => t.id !== templateId)
            } : null);
            showMessage('success', '模板已删除');
        } catch (error: any) {
            showMessage('error', error.message);
        }
    };
    
    // ===== 颜色交互逻辑 =====
    
    // 添加颜色到当前组合
    const addColorToCombo = (colorName: string) => {
        if (currentCombo.length >= selectedSize) {
            showMessage('info', `已达到 ${selectedSize} 双规格上限`);
            return;
        }
        setCurrentCombo(prev => [...prev, colorName]);
    };
    
    // 从当前组合移除颜色
    const removeColorFromCombo = (index: number) => {
        setCurrentCombo(prev => prev.filter((_, i) => i !== index));
    };
    
    // 添加自定义颜色
    const addCustomColor = () => {
        const color = customColorInput.trim();
        if (!color) return;
        addColorToCombo(color);
        setCustomColorInput('');
        customInputRef.current?.focus();
    };
    
    // 确认当前组合
    const confirmCurrentCombo = () => {
        if (currentCombo.length !== selectedSize) {
            showMessage('error', `请选择 ${selectedSize} 个颜色`);
            return;
        }
        setCombos(prev => [...prev, { colors: [...currentCombo] }]);
        setCurrentCombo([]);
    };
    
    // 删除已添加的组合
    const removeCombo = (index: number) => {
        setCombos(prev => prev.filter((_, i) => i !== index));
    };
    
    // 批量解析文本
    const parseBatchText = () => {
        if (!batchText.trim()) return;
        
        const lines = batchText.split('\n').filter(line => line.trim());
        const newCombos: { colors: string[] }[] = [];
        
        for (const line of lines) {
            // 支持多种分隔符：逗号、加号、空格、制表符
            const colors = line.split(/[,+\s\t]+/).map(c => c.trim()).filter(c => c);
            if (colors.length === selectedSize) {
                newCombos.push({ colors });
            } else if (colors.length > 0) {
                // 尝试补齐或截断
                const adjusted = colors.slice(0, selectedSize);
                while (adjusted.length < selectedSize) {
                    adjusted.push('');
                }
                if (adjusted.every(c => c)) {
                    newCombos.push({ colors: adjusted });
                }
            }
        }
        
        if (newCombos.length > 0) {
            setCombos(prev => [...prev, ...newCombos]);
            setBatchText('');
            setShowBatchInput(false);
            showMessage('success', `成功添加 ${newCombos.length} 个组合`);
        } else {
            showMessage('error', '未能解析任何有效组合');
        }
    };
    
    // 保存模板和组合
    const handleSave = async () => {
        if (!globalKB) return;
        if (!templateName.trim()) {
            showMessage('error', '请输入模板名称');
            return;
        }
        if (combos.length === 0) {
            showMessage('error', '请至少添加一个颜色组合');
            return;
        }
        
        try {
            if (editingTemplate) {
                await designEcho.invoke('sku-knowledge:deleteTemplate', globalKB.id, editingTemplate.id);
            }
            
            const template = await designEcho.invoke('sku-knowledge:addTemplate', globalKB.id, {
                name: templateName,
                templateFile: `${templateName}.tif`,
                comboSize: selectedSize,
                sockType: templateSockType,
            });
            
            for (const combo of combos) {
                await designEcho.invoke(
                    'sku-knowledge:addCombo',
                    globalKB.id,
                    template.id,
                    combo.colors,
                    combo.remark
                );
            }
            
            await loadGlobalKB();
            setShowAddModal(false);
            showMessage('success', editingTemplate ? '模板已更新' : '模板创建成功');
        } catch (error: any) {
            showMessage('error', error.message);
        }
    };
    
    // CSV 导入
    const handleImportCSV = async () => {
        if (!globalKB) return;
        
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.csv';
        
        input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = async (event) => {
                const csvContent = event.target?.result as string;
                try {
                    const result = await designEcho.invoke('sku-knowledge:importCSV', globalKB.id, csvContent);
                    if (result.imported > 0) {
                        showMessage('success', `导入成功: ${result.imported} 个组合`);
                        await loadGlobalKB();
                    } else {
                        showMessage('info', `无新增组合，跳过 ${result.skipped} 个`);
                    }
                } catch (err: any) {
                    showMessage('error', err.message);
                }
            };
            reader.readAsText(file);
        };
        input.click();
    };
    
    // CSV 导出
    const handleExportCSV = async () => {
        if (!globalKB) return;
        
        try {
            const csvContent = await designEcho.invoke('sku-knowledge:exportCSV', globalKB.id);
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'SKU组合知识库.csv';
            link.click();
            URL.revokeObjectURL(url);
            showMessage('success', 'CSV 导出成功');
        } catch (error: any) {
            showMessage('error', error.message);
        }
    };
    
    // 暴露方法给父组件
    useImperativeHandle(ref, () => ({
        handleImportCSV,
        handleExportCSV,
        handleOpenAddModal
    }), [handleOpenAddModal]);
    
    if (loading) {
        return (
            <div className="sku-panel-v2 loading">
                <style>{STYLES}</style>
                <div className="spinner" />
                <p>加载中...</p>
            </div>
        );
    }
    
    return (
        <div className="sku-panel-v2">
            <style>{STYLES}</style>
            
            {/* 消息提示 */}
            {message && (
                <div className={`toast ${message.type}`}>{message.text}</div>
            )}
            
            {/* 模板网格 */}
            <div className="template-grid">
                {globalKB?.templates.map(template => (
                    <div key={template.id} className="template-card">
                        <div className="card-header">
                            <div className="card-info">
                                <h4>{template.name}</h4>
                                <div className="meta">
                                    <span className="badge size">{template.comboSize}双装</span>
                                    <span className="badge type">{template.sockType}</span>
                                    <span className="count">{template.combos.length} 组合</span>
                                </div>
                            </div>
                            <div className="card-actions">
                                <button onClick={() => handleEditTemplate(template)} title="编辑">✏️</button>
                                <button className="delete" onClick={() => handleDeleteTemplate(template.id)} title="删除">🗑️</button>
                            </div>
                        </div>
                        
                        {/* 组合预览 - 可视化色块 */}
                        <div className="combos-preview">
                            {template.combos.slice(0, 4).map((combo, idx) => (
                                <div key={combo.id} className="combo-row">
                                    {combo.colors.map((color, cIdx) => {
                                        const style = getColorStyle(color);
                                        return (
                                            <span 
                                                key={cIdx} 
                                                className="color-chip"
                                                style={{ 
                                                    background: style.bg,
                                                    color: style.text 
                                                }}
                                                title={color}
                                            >
                                                {color}
                                            </span>
                                        );
                                    })}
                                </div>
                            ))}
                            {template.combos.length > 4 && (
                                <div className="combo-more">+{template.combos.length - 4} 更多</div>
                            )}
                        </div>
                    </div>
                ))}
                
                {/* 空状态 */}
                {(!globalKB?.templates || globalKB.templates.length === 0) && (
                    <div className="empty-state">
                        <span className="icon">🎨</span>
                        <p>暂无 SKU 组合</p>
                        <button className="btn-add" onClick={handleOpenAddModal}>
                            + 创建颜色组合
                        </button>
                    </div>
                )}
            </div>
            
            {/* 添加/编辑弹窗 */}
            {showAddModal && (
                <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
                    <div className="modal-v2" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>{editingTemplate ? '编辑组合' : '🎨 新建颜色组合'}</h3>
                            <button className="btn-close" onClick={() => setShowAddModal(false)}>✕</button>
                        </div>
                        
                        <div className="modal-body">
                            {/* 快速设置条 */}
                            <div className="quick-settings">
                                <div className="setting-item">
                                    <label>名称</label>
                                    <input
                                        type="text"
                                        placeholder="如：经典配色"
                                        value={templateName}
                                        onChange={e => setTemplateName(e.target.value)}
                                        className="name-input"
                                    />
                                </div>
                                <div className="setting-item">
                                    <label>规格</label>
                                    <div className="size-pills">
                                        {COMBO_SIZES.map(size => (
                                            <button
                                                key={size}
                                                className={selectedSize === size ? 'active' : ''}
                                                onClick={() => {
                                                    setSelectedSize(size);
                                                    setCurrentCombo([]);
                                                }}
                                            >
                                                {size}双
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="setting-item">
                                    <label>类型</label>
                                    <select 
                                        value={templateSockType}
                                        onChange={e => setTemplateSockType(e.target.value as SockType)}
                                    >
                                        {SOCK_TYPES.map(t => (
                                            <option key={t.value} value={t.value}>{t.label}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            
                            {/* 颜色选择区 */}
                            <div className="color-picker-section">
                                <div className="section-header">
                                    <h4>选择颜色 <span className="hint">点击添加到组合</span></h4>
                                    <button 
                                        className="btn-toggle"
                                        onClick={() => setShowPresets(!showPresets)}
                                    >
                                        {showPresets ? '收起预设' : '展开预设'}
                                    </button>
                                </div>
                                
                                {/* 预设颜色面板 */}
                                {showPresets && (
                                    <div className="preset-colors">
                                        {PRESET_COLORS.map(preset => (
                                            <button
                                                key={preset.name}
                                                className="preset-color"
                                                style={{ 
                                                    background: preset.color,
                                                    color: preset.textColor 
                                                }}
                                                onClick={() => addColorToCombo(preset.name)}
                                                title={preset.name}
                                            >
                                                {preset.name}
                                            </button>
                                        ))}
                                    </div>
                                )}
                                
                                {/* 自定义颜色输入 */}
                                <div className="custom-color-input">
                                    <input
                                        ref={customInputRef}
                                        type="text"
                                        placeholder="输入自定义颜色名称，按 Enter 添加..."
                                        value={customColorInput}
                                        onChange={e => setCustomColorInput(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && addCustomColor()}
                                    />
                                    <button onClick={addCustomColor} disabled={!customColorInput.trim()}>
                                        添加
                                    </button>
                                </div>
                            </div>
                            
                            {/* 当前正在编辑的组合 */}
                            <div className="current-combo-section">
                                <div className="section-header">
                                    <h4>当前组合 <span className="progress">{currentCombo.length}/{selectedSize}</span></h4>
                                    {currentCombo.length > 0 && (
                                        <button className="btn-clear" onClick={() => setCurrentCombo([])}>
                                            清空
                                        </button>
                                    )}
                                </div>
                                
                                <div className="current-combo">
                                    {currentCombo.length === 0 ? (
                                        <div className="placeholder">
                                            👆 点击上方颜色开始添加
                                        </div>
                                    ) : (
                                        <>
                                            <div className="combo-chips">
                                                {currentCombo.map((color, idx) => {
                                                    const style = getColorStyle(color);
                                                    return (
                                                        <span 
                                                            key={idx}
                                                            className="color-chip removable"
                                                            style={{ background: style.bg, color: style.text }}
                                                            onClick={() => removeColorFromCombo(idx)}
                                                            title="点击移除"
                                                        >
                                                            {color} ×
                                                        </span>
                                                    );
                                                })}
                                                {/* 占位符 */}
                                                {Array(selectedSize - currentCombo.length).fill(0).map((_, idx) => (
                                                    <span key={`empty-${idx}`} className="color-chip empty">
                                                        ?
                                                    </span>
                                                ))}
                                            </div>
                                            <button 
                                                className="btn-confirm"
                                                onClick={confirmCurrentCombo}
                                                disabled={currentCombo.length !== selectedSize}
                                            >
                                                ✓ 确认组合
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>
                            
                            {/* 已添加的组合列表 */}
                            <div className="combos-list-section">
                                <div className="section-header">
                                    <h4>已添加 <span className="count">{combos.length} 个组合</span></h4>
                                    <button 
                                        className="btn-batch"
                                        onClick={() => setShowBatchInput(!showBatchInput)}
                                    >
                                        📋 批量粘贴
                                    </button>
                                </div>
                                
                                {/* 批量输入 */}
                                {showBatchInput && (
                                    <div className="batch-input">
                                        <textarea
                                            placeholder={`每行一个组合，颜色用逗号或加号分隔\n例如：\n黑色,白色,灰色,深蓝\n红色+粉色+白色+米色`}
                                            value={batchText}
                                            onChange={e => setBatchText(e.target.value)}
                                            rows={4}
                                        />
                                        <button onClick={parseBatchText}>解析并添加</button>
                                    </div>
                                )}
                                
                                <div className="combos-list">
                                    {combos.map((combo, idx) => (
                                        <div key={idx} className="combo-item">
                                            <span className="combo-num">{idx + 1}</span>
                                            <div className="combo-colors">
                                                {combo.colors.map((color, cIdx) => {
                                                    const style = getColorStyle(color);
                                                    return (
                                                        <span 
                                                            key={cIdx}
                                                            className="color-chip small"
                                                            style={{ background: style.bg, color: style.text }}
                                                        >
                                                            {color}
                                                        </span>
                                                    );
                                                })}
                                            </div>
                                            <button 
                                                className="btn-remove"
                                                onClick={() => removeCombo(idx)}
                                                title="删除"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    ))}
                                    {combos.length === 0 && (
                                        <div className="empty-combos">
                                            尚未添加组合
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                        
                        <div className="modal-footer">
                            <button className="btn" onClick={() => setShowAddModal(false)}>取消</button>
                            <button 
                                className="btn btn-primary" 
                                onClick={handleSave}
                                disabled={!templateName.trim() || combos.length === 0}
                            >
                                保存 ({combos.length} 个组合)
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
});

SKUKnowledgePanel.displayName = 'SKUKnowledgePanel';

// ===== 样式 =====
const STYLES = `
.sku-panel-v2 {
    height: 100%;
    display: flex;
    flex-direction: column;
}

.sku-panel-v2.loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px;
    color: var(--de-text-secondary);
}

.sku-panel-v2 .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid rgba(0, 102, 255, 0.2);
    border-top-color: var(--de-primary);
    border-radius: 50%;
    animation: spin 1s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

/* Toast */
.toast {
    position: fixed;
    top: 80px;
    right: 20px;
    padding: 12px 20px;
    background: var(--de-bg-card);
    border: 1px solid var(--de-border);
    border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.4);
    z-index: 9999;
    animation: slideIn 0.3s ease;
}
.toast.success { border-color: var(--de-success); color: var(--de-success); }
.toast.error { border-color: var(--de-error); color: var(--de-error); }
.toast.info { border-color: var(--de-primary); color: var(--de-primary); }
@keyframes slideIn { from { transform: translateX(100px); opacity: 0; } }

/* 模板网格 */
.template-grid {
    flex: 1;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 16px;
    overflow-y: auto;
    padding: 4px;
}

/* 模板卡片 */
.template-card {
    background: var(--de-bg-card);
    border: 1px solid var(--de-border);
    border-radius: 12px;
    padding: 16px;
    transition: all 0.2s;
}

.template-card:hover {
    border-color: var(--de-primary);
    box-shadow: 0 4px 16px rgba(0, 102, 255, 0.15);
}

.card-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 12px;
}

.card-info h4 {
    margin: 0 0 6px 0;
    font-size: 15px;
    font-weight: 600;
}

.meta {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}

.badge {
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
}

.badge.size {
    background: rgba(243, 156, 18, 0.15);
    color: var(--de-warning);
}

.badge.type {
    background: rgba(0, 102, 255, 0.15);
    color: var(--de-primary);
}

.count {
    font-size: 11px;
    color: var(--de-text-secondary);
}

.card-actions {
    display: flex;
    gap: 4px;
}

.card-actions button {
    padding: 4px 8px;
    background: transparent;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s;
}

.card-actions button:hover {
    background: rgba(255,255,255,0.1);
}

.card-actions button.delete:hover {
    background: rgba(231, 76, 60, 0.2);
}

/* 组合预览 */
.combos-preview {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.combo-row {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
}

.color-chip {
    display: inline-block;
    padding: 4px 10px;
    border-radius: 16px;
    font-size: 11px;
    font-weight: 500;
    white-space: nowrap;
    border: 1px solid rgba(255,255,255,0.1);
}

.color-chip.small {
    padding: 2px 8px;
    font-size: 10px;
}

.combo-more {
    font-size: 11px;
    color: var(--de-text-secondary);
    padding: 4px;
}

/* 空状态 */
.empty-state {
    grid-column: 1 / -1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px 20px;
    color: var(--de-text-secondary);
}

.empty-state .icon {
    font-size: 48px;
    margin-bottom: 16px;
}

.empty-state p {
    margin: 0 0 16px 0;
}

.btn-add {
    padding: 12px 24px;
    background: var(--de-primary);
    border: none;
    border-radius: 8px;
    color: white;
    font-size: 14px;
    cursor: pointer;
    transition: all 0.2s;
}

.btn-add:hover {
    box-shadow: 0 0 20px var(--de-primary-glow);
}

/* 弹窗 */
.modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
}

.modal-v2 {
    background: var(--de-bg-card);
    border: 1px solid var(--de-border);
    border-radius: 16px;
    width: 700px;
    max-width: 95vw;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 24px 80px rgba(0,0,0,0.6);
}

.modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px 24px;
    border-bottom: 1px solid var(--de-border);
}

.modal-header h3 {
    margin: 0;
    font-size: 18px;
}

.btn-close {
    background: none;
    border: none;
    color: var(--de-text-secondary);
    font-size: 20px;
    cursor: pointer;
    padding: 4px 8px;
}

.modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 20px 24px;
}

.modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    padding: 16px 24px;
    border-top: 1px solid var(--de-border);
}

/* 快速设置条 */
.quick-settings {
    display: flex;
    gap: 16px;
    padding: 16px;
    background: var(--de-bg);
    border-radius: 10px;
    margin-bottom: 20px;
    flex-wrap: wrap;
}

.setting-item {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.setting-item label {
    font-size: 11px;
    color: var(--de-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.name-input {
    padding: 8px 12px;
    background: var(--de-bg-card);
    border: 1px solid var(--de-border);
    border-radius: 6px;
    color: var(--de-text);
    font-size: 14px;
    width: 180px;
}

.name-input:focus {
    outline: none;
    border-color: var(--de-primary);
}

.size-pills {
    display: flex;
    gap: 4px;
}

.size-pills button {
    padding: 6px 12px;
    background: transparent;
    border: 1px solid var(--de-border);
    border-radius: 6px;
    color: var(--de-text-secondary);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
}

.size-pills button:hover {
    background: rgba(255,255,255,0.05);
}

.size-pills button.active {
    background: var(--de-primary);
    border-color: var(--de-primary);
    color: white;
}

.setting-item select {
    padding: 8px 12px;
    background: var(--de-bg-card);
    border: 1px solid var(--de-border);
    border-radius: 6px;
    color: var(--de-text);
    font-size: 13px;
}

/* 颜色选择区 */
.color-picker-section {
    margin-bottom: 20px;
}

.section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
}

.section-header h4 {
    margin: 0;
    font-size: 14px;
    display: flex;
    align-items: center;
    gap: 8px;
}

.section-header .hint {
    font-size: 11px;
    color: var(--de-text-secondary);
    font-weight: normal;
}

.section-header .progress {
    padding: 2px 8px;
    background: var(--de-primary);
    border-radius: 10px;
    font-size: 11px;
    color: white;
}

.section-header .count {
    font-size: 12px;
    color: var(--de-text-secondary);
    font-weight: normal;
}

.btn-toggle, .btn-clear, .btn-batch {
    padding: 6px 12px;
    background: transparent;
    border: 1px solid var(--de-border);
    border-radius: 6px;
    color: var(--de-text-secondary);
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s;
}

.btn-toggle:hover, .btn-clear:hover, .btn-batch:hover {
    background: rgba(255,255,255,0.05);
    color: var(--de-text);
}

/* 预设颜色 */
.preset-colors {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 16px;
    background: var(--de-bg);
    border-radius: 10px;
    margin-bottom: 12px;
}

.preset-color {
    padding: 6px 14px;
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 20px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
}

.preset-color:hover {
    transform: scale(1.05);
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
}

/* 自定义颜色输入 */
.custom-color-input {
    display: flex;
    gap: 8px;
}

.custom-color-input input {
    flex: 1;
    padding: 10px 14px;
    background: var(--de-bg);
    border: 1px solid var(--de-border);
    border-radius: 8px;
    color: var(--de-text);
    font-size: 13px;
}

.custom-color-input input:focus {
    outline: none;
    border-color: var(--de-primary);
}

.custom-color-input button {
    padding: 10px 18px;
    background: var(--de-primary);
    border: none;
    border-radius: 8px;
    color: white;
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s;
}

.custom-color-input button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

/* 当前组合 */
.current-combo-section {
    margin-bottom: 20px;
    padding: 16px;
    background: var(--de-bg);
    border-radius: 10px;
    border: 2px dashed var(--de-border);
}

.current-combo {
    min-height: 60px;
}

.current-combo .placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 60px;
    color: var(--de-text-secondary);
    font-size: 13px;
}

.combo-chips {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 12px;
}

.color-chip.removable {
    cursor: pointer;
    transition: all 0.15s;
}

.color-chip.removable:hover {
    transform: scale(0.95);
    opacity: 0.8;
}

.color-chip.empty {
    background: transparent;
    border: 2px dashed var(--de-border);
    color: var(--de-text-secondary);
}

.btn-confirm {
    padding: 10px 20px;
    background: var(--de-success);
    border: none;
    border-radius: 8px;
    color: white;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
}

.btn-confirm:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.btn-confirm:not(:disabled):hover {
    box-shadow: 0 0 16px rgba(46, 204, 113, 0.4);
}

/* 组合列表 */
.combos-list-section {
    margin-bottom: 20px;
}

.batch-input {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
}

.batch-input textarea {
    flex: 1;
    padding: 12px;
    background: var(--de-bg);
    border: 1px solid var(--de-border);
    border-radius: 8px;
    color: var(--de-text);
    font-size: 12px;
    font-family: monospace;
    resize: vertical;
}

.batch-input textarea:focus {
    outline: none;
    border-color: var(--de-primary);
}

.batch-input button {
    padding: 12px 16px;
    background: var(--de-primary);
    border: none;
    border-radius: 8px;
    color: white;
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
}

.combos-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 200px;
    overflow-y: auto;
}

.combo-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    background: var(--de-bg);
    border-radius: 8px;
}

.combo-num {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--de-bg-card);
    border-radius: 50%;
    font-size: 11px;
    color: var(--de-text-secondary);
}

.combo-colors {
    flex: 1;
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
}

.btn-remove {
    padding: 4px 8px;
    background: transparent;
    border: none;
    color: var(--de-text-secondary);
    cursor: pointer;
    font-size: 12px;
    transition: all 0.15s;
}

.btn-remove:hover {
    color: var(--de-error);
}

.empty-combos {
    padding: 20px;
    text-align: center;
    color: var(--de-text-secondary);
    font-size: 13px;
}

/* 按钮 */
.btn {
    padding: 10px 20px;
    background: var(--de-bg);
    border: 1px solid var(--de-border);
    border-radius: 8px;
    color: var(--de-text);
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s;
}

.btn:hover {
    background: var(--de-bg-light);
}

.btn-primary {
    background: var(--de-primary);
    border-color: var(--de-primary);
    color: white;
}

.btn-primary:hover:not(:disabled) {
    box-shadow: 0 0 16px var(--de-primary-glow);
}

.btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
`;

export default SKUKnowledgePanel;
