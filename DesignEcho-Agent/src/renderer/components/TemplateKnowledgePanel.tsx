/**
 * 模板知识库面板 - v2.0 交互式设计
 * 
 * 改进：
 * 1. 拖拽上传 - 直接拖入 PSD/TIF 文件
 * 2. 自动识别 - 从文件名推断模板类型
 * 3. 简化表单 - 只需文件 + 描述
 * 4. 卡片预览 - 可视化模板信息
 */

import React, { useState, useEffect, useCallback, forwardRef, useImperativeHandle, useRef } from 'react';

const designEcho = (window as any).designEcho;

// 模板类型
type TemplateType = 'sku' | 'detail-page' | 'banner' | 'main-image' | 'other';

// 模板类型配置
const TEMPLATE_TYPES: { value: TemplateType; label: string; icon: string; keywords: string[] }[] = [
    { value: 'sku', label: 'SKU 排版', icon: '🧦', keywords: ['sku', '双装', '规格', '组合'] },
    { value: 'detail-page', label: '详情页', icon: '📄', keywords: ['详情', 'detail', '长图'] },
    { value: 'banner', label: 'Banner', icon: '🖼️', keywords: ['banner', '横幅', '海报', '活动'] },
    { value: 'main-image', label: '主图', icon: '🎯', keywords: ['主图', 'main', '首图', '封面'] },
    { value: 'other', label: '其他', icon: '📁', keywords: [] },
];

// 暴露给父组件的方法
export interface TemplateKnowledgePanelRef {
    handleImport: () => void;
    handleExport: () => void;
    handleOpenAddModal: () => void;
}

interface TemplateAsset {
    id: string;
    name: string;
    type: TemplateType;
    filePath: string;
    fileFormat: string;
    thumbnail?: string;
    description: string;
    aiPrompt?: string;
    metadata?: {
        comboSize?: number;
        category?: string;
        placeholderLayers?: string[];
        textLayers?: string[];
        platforms?: string[];
    };
    tags?: string[];
    source?: string;
    createdAt: number;
    updatedAt: number;
}

interface TemplateResolverSettings {
    localLibraryDirs: string[];
}

// 从文件名推断模板类型
function inferTemplateType(fileName: string): TemplateType {
    const lowerName = fileName.toLowerCase();
    for (const type of TEMPLATE_TYPES) {
        if (type.keywords.some(kw => lowerName.includes(kw))) {
            return type.value;
        }
    }
    // 检测数字+双装模式 (如 "4双装")
    if (/\d+双/.test(fileName)) {
        return 'sku';
    }
    return 'other';
}

// 从文件名提取可能的规格数
function extractComboSize(fileName: string): number | undefined {
    const match = fileName.match(/(\d+)双/);
    if (match) {
        return parseInt(match[1]);
    }
    return undefined;
}

export const TemplateKnowledgePanel = forwardRef<TemplateKnowledgePanelRef>((_, ref) => {
    const [templates, setTemplates] = useState<TemplateAsset[]>([]);
    const [resolverSettings, setResolverSettings] = useState<TemplateResolverSettings>({ localLibraryDirs: [] });
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
    const [filterType, setFilterType] = useState<TemplateType | 'all'>('all');
    
    // 拖拽状态
    const [isDragging, setIsDragging] = useState(false);
    
    // 添加/编辑弹窗
    const [showAddModal, setShowAddModal] = useState(false);
    const [editingTemplate, setEditingTemplate] = useState<TemplateAsset | null>(null);
    
    // 简化后的表单状态
    const [formName, setFormName] = useState('');
    const [formType, setFormType] = useState<TemplateType>('sku');
    const [formFilePath, setFormFilePath] = useState('');
    const [formDescription, setFormDescription] = useState('');
    const [formComboSize, setFormComboSize] = useState<number | undefined>(undefined);
    const [formTags, setFormTags] = useState<string[]>([]);
    const [tagInput, setTagInput] = useState('');
    
    // refs
    const dropZoneRef = useRef<HTMLDivElement>(null);
    
    // 显示消息
    const showMessage = (type: 'success' | 'error' | 'info', text: string) => {
        setMessage({ type, text });
        setTimeout(() => setMessage(null), 3000);
    };

    // 加载模板解析设置（本地模板库目录）
    const loadResolverSettings = useCallback(async () => {
        try {
            const settings = await designEcho.invoke('template-knowledge:getResolverSettings');
            if (settings && Array.isArray(settings.localLibraryDirs)) {
                setResolverSettings({ localLibraryDirs: settings.localLibraryDirs });
            }
        } catch (error: any) {
            console.error('加载模板解析设置失败:', error);
        }
    }, []);

    const saveResolverSettings = useCallback(async (nextDirs: string[]) => {
        const saved = await designEcho.invoke('template-knowledge:setResolverSettings', {
            localLibraryDirs: nextDirs
        });
        const normalized = saved && Array.isArray(saved.localLibraryDirs)
            ? saved.localLibraryDirs
            : nextDirs;
        setResolverSettings({ localLibraryDirs: normalized });
        return normalized as string[];
    }, []);

    // 加载模板列表
    const loadTemplates = useCallback(async () => {
        try {
            setLoading(true);
            const list = await designEcho.invoke('template-knowledge:getAll');
            setTemplates(list || []);
        } catch (error: any) {
            console.error('加载模板失败:', error);
            showMessage('error', '加载模板失败');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        Promise.all([loadTemplates(), loadResolverSettings()]);
    }, [loadTemplates, loadResolverSettings]);
    
    // 打开添加弹窗
    const handleOpenAddModal = useCallback(() => {
        setEditingTemplate(null);
        setFormName('');
        setFormType('sku');
        setFormFilePath('');
        setFormDescription('');
        setFormComboSize(undefined);
        setFormTags([]);
        setShowAddModal(true);
    }, []);
    
    // 编辑模板
    const handleEdit = (template: TemplateAsset) => {
        setEditingTemplate(template);
        setFormName(template.name);
        setFormType(template.type);
        setFormFilePath(template.filePath);
        setFormDescription(template.description);
        setFormComboSize(template.metadata?.comboSize);
        setFormTags(template.tags || []);
        setShowAddModal(true);
    };
    
    // 删除模板
    const handleDelete = async (id: string) => {
        if (!confirm('确定删除此模板？')) return;
        
        try {
            await designEcho.invoke('template-knowledge:delete', id);
            showMessage('success', '模板已删除');
            loadTemplates();
        } catch (error: any) {
            showMessage('error', error.message);
        }
    };
    
    // 选择模板文件
    const handleSelectFile = async () => {
        try {
            const filePath = await designEcho.invoke('template-knowledge:selectFile');
            if (filePath) {
                processSelectedFile(filePath);
            }
        } catch (error: any) {
            showMessage('error', '选择文件失败');
        }
    };

    const handleAddLocalLibraryDir = async () => {
        try {
            const firstDir = resolverSettings.localLibraryDirs[0];
            const selected = await designEcho.invoke('template-knowledge:selectLocalLibraryFolder', firstDir);
            if (!selected) return;

            const nextDirs = Array.from(new Set([...(resolverSettings.localLibraryDirs || []), selected]));
            await saveResolverSettings(nextDirs);
            showMessage('success', '已添加本地模板库目录');
        } catch (error: any) {
            showMessage('error', error?.message || '添加本地模板库失败');
        }
    };

    const handleRemoveLocalLibraryDir = async (targetDir: string) => {
        try {
            const nextDirs = (resolverSettings.localLibraryDirs || []).filter((dir) => dir !== targetDir);
            await saveResolverSettings(nextDirs);
            showMessage('success', '已移除本地模板库目录');
        } catch (error: any) {
            showMessage('error', error?.message || '移除本地模板库失败');
        }
    };
    
    // 处理选中的文件
    const processSelectedFile = (filePath: string) => {
        setFormFilePath(filePath);
        
        // 从文件路径提取文件名
        const fileName = filePath.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '') || '';
        
        // 自动填充名称
        if (!formName) {
            setFormName(fileName);
        }
        
        // 自动推断类型
        const inferredType = inferTemplateType(fileName);
        setFormType(inferredType);
        
        // 自动提取规格
        if (inferredType === 'sku') {
            const size = extractComboSize(fileName);
            if (size) {
                setFormComboSize(size);
            }
        }
    };

    // 从 Photoshop 当前文档获取模板文件
    const handlePickFromPhotoshop = async () => {
        try {
            const docsResult = await designEcho.sendToPlugin('listDocuments', { includeDetails: true });
            const docs = Array.isArray(docsResult?.documents) ? docsResult.documents : [];
            if (docs.length === 0) {
                showMessage('error', '未检测到已打开的 Photoshop 文档');
                return;
            }

            const activeDoc = docs.find((doc: any) => doc?.isActive) || docs[0];
            const projectRoot = await designEcho.getProjectRoot?.();
            const resolved = await designEcho.invoke('template-knowledge:resolvePhotoshopDocumentFile', {
                documentName: activeDoc.name,
                documentPath: activeDoc.path,
                currentProjectPath: projectRoot || undefined
            });

            if (!resolved?.filePath) {
                showMessage('error', '未能定位文档源文件，请改用“选择文件”');
                return;
            }

            processSelectedFile(resolved.filePath);
            showMessage('success', `已从 Photoshop 文档加载: ${activeDoc.name}`);
        } catch (error: any) {
            showMessage('error', error?.message || '从 Photoshop 获取失败');
        }
    };
    
    // 处理拖拽
    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };
    
    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    };
    
    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            const file = files[0];
            const ext = file.name.split('.').pop()?.toLowerCase();
            
            if (['psd', 'tif', 'tiff', 'psb'].includes(ext || '')) {
                // 需要通过 Electron 获取实际路径
                // 由于浏览器安全限制，这里用文件名模拟
                const fileName = file.name.replace(/\.[^.]+$/, '');
                setFormName(fileName);
                setFormType(inferTemplateType(fileName));
                
                if (inferTemplateType(fileName) === 'sku') {
                    const size = extractComboSize(fileName);
                    if (size) {
                        setFormComboSize(size);
                    }
                }
                
                // 提示用户需要手动选择文件
                showMessage('info', '请点击「选择文件」按钮选择模板文件');
                setShowAddModal(true);
            } else {
                showMessage('error', '仅支持 PSD、TIF、PSB 格式');
            }
        }
    };
    
    // 添加标签
    const addTag = () => {
        const tag = tagInput.trim();
        if (tag && !formTags.includes(tag)) {
            setFormTags([...formTags, tag]);
            setTagInput('');
        }
    };
    
    // 移除标签
    const removeTag = (tag: string) => {
        setFormTags(formTags.filter(t => t !== tag));
    };
    
    // 保存模板
    const handleSave = async () => {
        if (!formName.trim()) {
            showMessage('error', '请输入模板名称');
            return;
        }
        if (!formFilePath && !editingTemplate) {
            showMessage('error', '请选择模板文件');
            return;
        }
        if (!formDescription.trim()) {
            showMessage('error', '请输入模板描述（供 AI 理解）');
            return;
        }
        
        try {
            const metadata: any = {};
            if (formComboSize) metadata.comboSize = formComboSize;
            
            if (editingTemplate) {
                await designEcho.invoke('template-knowledge:update', {
                    id: editingTemplate.id,
                    name: formName,
                    description: formDescription,
                    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
                    tags: formTags.length > 0 ? formTags : undefined
                });
                showMessage('success', '模板已更新');
            } else {
                await designEcho.invoke('template-knowledge:add', {
                    name: formName,
                    type: formType,
                    filePath: formFilePath,
                    description: formDescription,
                    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
                    tags: formTags.length > 0 ? formTags : undefined
                });
                showMessage('success', '模板已添加');
            }
            
            setShowAddModal(false);
            loadTemplates();
        } catch (error: any) {
            showMessage('error', error.message);
        }
    };
    
    // 导入 JSON
    const handleImport = useCallback(async () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        
        input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = async (event) => {
                const content = event.target?.result as string;
                
                try {
                    const result = await designEcho.invoke('template-knowledge:importJSON', content);
                    if (result.imported > 0) {
                        showMessage('success', `导入成功: ${result.imported} 个模板`);
                        loadTemplates();
                    } else {
                        showMessage('info', '无新增模板');
                    }
                } catch (err: any) {
                    showMessage('error', err.message);
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }, [loadTemplates]);
    
    // 导出 JSON
    const handleExport = useCallback(async () => {
        try {
            const jsonContent = await designEcho.invoke('template-knowledge:exportJSON');
            const blob = new Blob([jsonContent], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = '模板知识库.json';
            link.click();
            URL.revokeObjectURL(url);
            showMessage('success', '导出成功');
        } catch (error: any) {
            showMessage('error', error.message);
        }
    }, []);
    
    // 暴露方法给父组件
    useImperativeHandle(ref, () => ({
        handleImport,
        handleExport,
        handleOpenAddModal
    }), [handleImport, handleExport, handleOpenAddModal]);
    
    // 筛选模板
    const filteredTemplates = filterType === 'all' 
        ? templates 
        : templates.filter(t => t.type === filterType);
    
    // 统计
    const stats = TEMPLATE_TYPES.map(t => ({
        ...t,
        count: templates.filter(tp => tp.type === t.value).length
    }));
    
    if (loading) {
        return (
            <div className="template-panel-v2 loading">
                <style>{STYLES}</style>
                <div className="spinner" />
                <p>加载中...</p>
            </div>
        );
    }
    
    return (
        <div 
            className="template-panel-v2"
            ref={dropZoneRef}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            <style>{STYLES}</style>
            
            {/* 拖拽覆盖层 */}
            {isDragging && (
                <div className="drag-overlay">
                    <div className="drag-content">
                        <span className="drag-icon">📂</span>
                        <p>拖放 PSD/TIF 文件到这里</p>
                    </div>
                </div>
            )}
            
            {/* 消息提示 */}
            {message && (
                <div className={`toast ${message.type}`}>{message.text}</div>
            )}

            <div className="resolver-panel">
                <div className="resolver-header">
                    <div className="resolver-title-wrap">
                        <h4>SKU 模板查找顺序</h4>
                        <span className="resolver-order">项目「模板文件」目录 → 用户本地模板库</span>
                    </div>
                    <button className="btn btn-resolver" onClick={handleAddLocalLibraryDir}>
                        + 添加本地模板库目录
                    </button>
                </div>

                {resolverSettings.localLibraryDirs.length === 0 ? (
                    <div className="resolver-empty">未配置本地模板库目录，仅使用项目「模板文件」目录。</div>
                ) : (
                    <div className="resolver-list">
                        {resolverSettings.localLibraryDirs.map((dir) => (
                            <div key={dir} className="resolver-item">
                                <span className="resolver-path" title={dir}>{dir}</span>
                                <div className="resolver-item-actions">
                                    <button
                                        className="resolver-link"
                                        onClick={() => designEcho.openPath?.(dir)}
                                        title="打开目录"
                                    >
                                        打开
                                    </button>
                                    <button
                                        className="resolver-remove"
                                        onClick={() => handleRemoveLocalLibraryDir(dir)}
                                        title="移除目录"
                                    >
                                        移除
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
            
            {/* 类型筛选器 */}
            <div className="type-filter">
                <button 
                    className={filterType === 'all' ? 'active' : ''} 
                    onClick={() => setFilterType('all')}
                >
                    全部 ({templates.length})
                </button>
                {stats.map(t => (
                    <button 
                        key={t.value}
                        className={filterType === t.value ? 'active' : ''} 
                        onClick={() => setFilterType(t.value)}
                    >
                        {t.icon} {t.label} ({t.count})
                    </button>
                ))}
            </div>
            
            {/* 模板网格 */}
            <div className="template-grid">
                {filteredTemplates.map(template => {
                    const typeInfo = TEMPLATE_TYPES.find(t => t.value === template.type);
                    return (
                        <div key={template.id} className="template-card">
                            <div className="card-header">
                                <span className="type-icon">{typeInfo?.icon || '📁'}</span>
                                <div className="card-info">
                                    <h4>{template.name}</h4>
                                    <span className="type-label">{typeInfo?.label || template.type}</span>
                                </div>
                                <div className="card-actions">
                                    <button onClick={() => handleEdit(template)} title="编辑">✏️</button>
                                    <button className="delete" onClick={() => handleDelete(template.id)} title="删除">🗑️</button>
                                </div>
                            </div>
                            
                            <p className="description">{template.description}</p>
                            
                            <div className="meta-row">
                                <span className="format-badge">{template.fileFormat.toUpperCase()}</span>
                                {template.metadata?.comboSize && (
                                    <span className="size-badge">{template.metadata.comboSize}双装</span>
                                )}
                            </div>
                            
                            {template.tags && template.tags.length > 0 && (
                                <div className="tags">
                                    {template.tags.map(tag => (
                                        <span key={tag} className="tag">{tag}</span>
                                    ))}
                                </div>
                            )}
                            
                            <div className="file-path">
                                📂 {template.filePath.split(/[/\\]/).pop()}
                            </div>
                        </div>
                    );
                })}
                
                {/* 添加卡片 */}
                <div className="template-card add-card" onClick={handleOpenAddModal}>
                    <div className="add-content">
                        <span className="add-icon">+</span>
                        <p>添加模板</p>
                        <span className="hint">点击或拖入文件</span>
                    </div>
                </div>
                
                {/* 空状态 */}
                {filteredTemplates.length === 0 && filterType !== 'all' && (
                    <div className="empty-hint">
                        该类型暂无模板
                    </div>
                )}
            </div>
            
            {/* 添加/编辑弹窗 */}
            {showAddModal && (
                <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
                    <div className="modal-v2" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>{editingTemplate ? '编辑模板' : '📂 添加模板'}</h3>
                            <button className="btn-close" onClick={() => setShowAddModal(false)}>✕</button>
                        </div>
                        
                        <div className="modal-body">
                            {/* 文件选择区 */}
                            {!editingTemplate && (
                                <div className="file-section">
                                    <div 
                                        className="file-dropzone"
                                        onClick={handleSelectFile}
                                    >
                                        {formFilePath ? (
                                            <>
                                                <span className="file-icon">✓</span>
                                                <p className="file-name">{formFilePath.split(/[/\\]/).pop()}</p>
                                                <span className="change-hint">点击更换文件</span>
                                            </>
                                        ) : (
                                            <>
                                                <span className="file-icon">📂</span>
                                                <p>点击选择模板文件</p>
                                                <span className="format-hint">支持 PSD、TIF、PSB</span>
                                            </>
                                        )}
                                    </div>
                                    <div className="file-actions">
                                        <button className="btn btn-file-action" onClick={handlePickFromPhotoshop}>
                                            从 Photoshop 当前文档获取
                                        </button>
                                    </div>
                                </div>
                            )}
                            
                            {/* 模板类型选择 */}
                            <div className="type-section">
                                <label>模板类型</label>
                                <div className="type-selector">
                                    {TEMPLATE_TYPES.map(t => (
                                        <button
                                            key={t.value}
                                            className={formType === t.value ? 'active' : ''}
                                            onClick={() => setFormType(t.value)}
                                            disabled={!!editingTemplate}
                                        >
                                            <span className="icon">{t.icon}</span>
                                            <span className="label">{t.label}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                            
                            {/* 基本信息 */}
                            <div className="form-section">
                                <div className="form-row">
                                    <div className="form-group flex-2">
                                        <label>模板名称 *</label>
                                        <input 
                                            type="text" 
                                            value={formName} 
                                            onChange={e => setFormName(e.target.value)}
                                            placeholder="如：4双装标准模板"
                                        />
                                    </div>
                                    {formType === 'sku' && (
                                        <div className="form-group">
                                            <label>规格（双装）</label>
                                            <input 
                                                type="number" 
                                                value={formComboSize || ''} 
                                                onChange={e => setFormComboSize(e.target.value ? parseInt(e.target.value) : undefined)}
                                                placeholder="4"
                                                min={1}
                                                max={10}
                                            />
                                        </div>
                                    )}
                                </div>
                                
                                <div className="form-group">
                                    <label>模板描述 * <span className="hint">帮助 AI 理解何时使用此模板</span></label>
                                    <textarea 
                                        value={formDescription} 
                                        onChange={e => setFormDescription(e.target.value)}
                                        placeholder="描述模板的用途、适用场景、布局特点..."
                                        rows={3}
                                    />
                                </div>
                            </div>
                            
                            {/* 标签 */}
                            <div className="tags-section">
                                <label>标签 <span className="hint">可选，便于搜索</span></label>
                                <div className="tags-input">
                                    <div className="current-tags">
                                        {formTags.map(tag => (
                                            <span key={tag} className="tag removable" onClick={() => removeTag(tag)}>
                                                {tag} ×
                                            </span>
                                        ))}
                                    </div>
                                    <input
                                        type="text"
                                        placeholder="输入标签，按 Enter 添加"
                                        value={tagInput}
                                        onChange={e => setTagInput(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag())}
                                    />
                                </div>
                            </div>
                        </div>
                        
                        <div className="modal-footer">
                            <button className="btn" onClick={() => setShowAddModal(false)}>取消</button>
                            <button 
                                className="btn btn-primary" 
                                onClick={handleSave}
                                disabled={!formName.trim() || !formDescription.trim() || (!formFilePath && !editingTemplate)}
                            >
                                {editingTemplate ? '保存修改' : '添加模板'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
});

TemplateKnowledgePanel.displayName = 'TemplateKnowledgePanel';

// ===== 样式 =====
const STYLES = `
.template-panel-v2 {
    height: 100%;
    display: flex;
    flex-direction: column;
    position: relative;
}

.template-panel-v2.loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px;
    color: var(--de-text-secondary);
}

.template-panel-v2 .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid rgba(0, 102, 255, 0.2);
    border-top-color: var(--de-primary);
    border-radius: 50%;
    animation: spin 1s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

/* 拖拽覆盖层 */
.drag-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 102, 255, 0.1);
    border: 3px dashed var(--de-primary);
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    backdrop-filter: blur(4px);
}

.drag-content {
    text-align: center;
    color: var(--de-primary);
}

.drag-icon {
    font-size: 48px;
    display: block;
    margin-bottom: 12px;
}

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

/* 模板解析设置 */
.resolver-panel {
    margin: 10px 0 14px 0;
    padding: 12px;
    background: var(--de-bg-card);
    border: 1px solid var(--de-border);
    border-radius: 10px;
}

.resolver-header {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: flex-start;
}

.resolver-title-wrap h4 {
    margin: 0;
    font-size: 13px;
}

.resolver-order {
    display: inline-block;
    margin-top: 4px;
    color: var(--de-primary);
    font-size: 12px;
}

.resolver-empty {
    margin-top: 10px;
    color: var(--de-text-secondary);
    font-size: 12px;
}

.resolver-list {
    margin-top: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.resolver-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    background: var(--de-bg);
    border: 1px solid var(--de-border);
    border-radius: 8px;
    padding: 8px 10px;
}

.resolver-path {
    font-family: monospace;
    font-size: 11px;
    color: var(--de-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.resolver-item-actions {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
}

.resolver-link,
.resolver-remove {
    border: 1px solid var(--de-border);
    background: transparent;
    color: var(--de-text-secondary);
    border-radius: 6px;
    padding: 4px 10px;
    font-size: 11px;
    cursor: pointer;
}

.resolver-link:hover {
    border-color: var(--de-primary);
    color: var(--de-primary);
}

.resolver-remove:hover {
    border-color: var(--de-error);
    color: var(--de-error);
}

.btn-resolver {
    padding: 8px 12px;
    font-size: 12px;
}

/* 类型筛选器 */
.type-filter {
    display: flex;
    gap: 8px;
    padding: 12px 0;
    border-bottom: 1px solid var(--de-border);
    margin-bottom: 16px;
    flex-wrap: wrap;
}

.type-filter button {
    padding: 8px 14px;
    background: transparent;
    border: 1px solid var(--de-border);
    border-radius: 8px;
    color: var(--de-text-secondary);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
}

.type-filter button:hover {
    background: rgba(255,255,255,0.05);
    color: var(--de-text);
}

.type-filter button.active {
    background: var(--de-primary);
    border-color: var(--de-primary);
    color: white;
}

/* 模板网格 */
.template-grid {
    flex: 1;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
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
    display: flex;
    flex-direction: column;
}

.template-card:hover {
    border-color: var(--de-primary);
    box-shadow: 0 4px 16px rgba(0, 102, 255, 0.15);
}

.card-header {
    display: flex;
    gap: 12px;
    margin-bottom: 12px;
}

.type-icon {
    font-size: 28px;
    line-height: 1;
}

.card-info {
    flex: 1;
}

.card-info h4 {
    margin: 0 0 4px 0;
    font-size: 14px;
    font-weight: 600;
}

.type-label {
    font-size: 11px;
    color: var(--de-primary);
    background: rgba(0, 102, 255, 0.1);
    padding: 2px 8px;
    border-radius: 4px;
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

.description {
    margin: 0 0 12px 0;
    font-size: 12px;
    color: var(--de-text-secondary);
    line-height: 1.5;
    flex: 1;
}

.meta-row {
    display: flex;
    gap: 8px;
    margin-bottom: 10px;
}

.format-badge, .size-badge {
    padding: 3px 10px;
    border-radius: 4px;
    font-size: 10px;
}

.format-badge {
    background: rgba(46, 204, 113, 0.15);
    color: var(--de-success);
}

.size-badge {
    background: rgba(243, 156, 18, 0.15);
    color: var(--de-warning);
}

.tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 10px;
}

.tag {
    padding: 2px 8px;
    background: rgba(255,255,255,0.08);
    border-radius: 4px;
    font-size: 10px;
    color: var(--de-text-secondary);
}

.tag.removable {
    cursor: pointer;
    transition: all 0.15s;
}

.tag.removable:hover {
    background: rgba(231, 76, 60, 0.2);
    color: var(--de-error);
}

.file-path {
    padding: 8px 10px;
    background: var(--de-bg);
    border-radius: 6px;
    font-size: 11px;
    color: var(--de-text-secondary);
    font-family: monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* 添加卡片 */
.add-card {
    border: 2px dashed var(--de-border);
    background: transparent;
    cursor: pointer;
    min-height: 200px;
}

.add-card:hover {
    border-color: var(--de-primary);
    background: rgba(0, 102, 255, 0.05);
}

.add-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--de-text-secondary);
}

.add-icon {
    font-size: 36px;
    margin-bottom: 8px;
    color: var(--de-primary);
}

.add-content p {
    margin: 0 0 4px 0;
    font-size: 14px;
}

.add-content .hint {
    font-size: 11px;
    opacity: 0.7;
}

.empty-hint {
    grid-column: 1 / -1;
    text-align: center;
    padding: 40px;
    color: var(--de-text-secondary);
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
    width: 560px;
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

/* 文件选择区 */
.file-section {
    margin-bottom: 20px;
}

.file-actions {
    margin-top: 10px;
    display: flex;
    justify-content: center;
}

.btn-file-action {
    width: 100%;
}

.file-dropzone {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 32px;
    background: var(--de-bg);
    border: 2px dashed var(--de-border);
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.2s;
}

.file-dropzone:hover {
    border-color: var(--de-primary);
    background: rgba(0, 102, 255, 0.05);
}

.file-icon {
    font-size: 36px;
    margin-bottom: 8px;
}

.file-dropzone p {
    margin: 0;
    font-size: 14px;
    color: var(--de-text);
}

.file-name {
    font-family: monospace;
    color: var(--de-success) !important;
}

.format-hint, .change-hint {
    font-size: 11px;
    color: var(--de-text-secondary);
    margin-top: 4px;
}

/* 类型选择器 */
.type-section {
    margin-bottom: 20px;
}

.type-section > label {
    display: block;
    font-size: 12px;
    color: var(--de-text-secondary);
    margin-bottom: 10px;
}

.type-selector {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
}

.type-selector button {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 12px 16px;
    background: var(--de-bg);
    border: 1px solid var(--de-border);
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.15s;
    min-width: 80px;
}

.type-selector button:hover:not(:disabled) {
    border-color: var(--de-primary);
    background: rgba(0, 102, 255, 0.1);
}

.type-selector button.active {
    background: var(--de-primary);
    border-color: var(--de-primary);
    color: white;
}

.type-selector button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.type-selector .icon {
    font-size: 20px;
}

.type-selector .label {
    font-size: 11px;
}

/* 表单 */
.form-section {
    margin-bottom: 20px;
}

.form-row {
    display: flex;
    gap: 16px;
}

.form-group {
    margin-bottom: 14px;
}

.form-group.flex-2 {
    flex: 2;
}

.form-group label {
    display: block;
    margin-bottom: 6px;
    font-size: 12px;
    color: var(--de-text-secondary);
}

.form-group label .hint {
    font-size: 10px;
    opacity: 0.7;
}

.form-group input,
.form-group textarea {
    width: 100%;
    padding: 10px 12px;
    background: var(--de-bg);
    border: 1px solid var(--de-border);
    border-radius: 8px;
    color: var(--de-text);
    font-size: 13px;
}

.form-group input:focus,
.form-group textarea:focus {
    outline: none;
    border-color: var(--de-primary);
}

.form-group textarea {
    resize: vertical;
    min-height: 60px;
}

/* 标签输入 */
.tags-section {
    margin-bottom: 20px;
}

.tags-section > label {
    display: block;
    font-size: 12px;
    color: var(--de-text-secondary);
    margin-bottom: 8px;
}

.tags-section > label .hint {
    font-size: 10px;
    opacity: 0.7;
}

.tags-input {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 10px;
    background: var(--de-bg);
    border: 1px solid var(--de-border);
    border-radius: 8px;
    min-height: 44px;
    align-items: center;
}

.tags-input input {
    flex: 1;
    min-width: 100px;
    padding: 4px 8px;
    background: transparent;
    border: none;
    color: var(--de-text);
    font-size: 13px;
}

.tags-input input:focus {
    outline: none;
}

.current-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
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

export default TemplateKnowledgePanel;
