/**
 * 知识模板编辑器
 * 
 * 允许用户自定义知识类型的字段结构
 */

import React, { useState, useCallback, useMemo } from 'react';

// ===== 类型定义 =====

export type FieldType = 
    | 'text'
    | 'textarea'
    | 'number'
    | 'select'
    | 'multiselect'
    | 'color'
    | 'tags'
    | 'switch';

export interface FieldValidation {
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
    pattern?: string;
}

export interface TemplateField {
    id: string;
    name: string;
    label: string;
    type: FieldType;
    required: boolean;
    placeholder?: string;
    defaultValue?: unknown;
    options?: string[];
    validation?: FieldValidation;
    order: number;
}

export interface KnowledgeTemplate {
    id: string;
    name: string;
    icon: string;
    description?: string;
    fields: TemplateField[];
    isBuiltin: boolean;
    createdAt: string;
    updatedAt: string;
}

interface TemplateEditorProps {
    template?: KnowledgeTemplate;
    onSave: (template: KnowledgeTemplate) => void;
    onCancel: () => void;
    onDelete?: () => void;
}

// ===== 常量 =====

const FIELD_TYPE_OPTIONS: Array<{ value: FieldType; label: string }> = [
    { value: 'text', label: '单行文本' },
    { value: 'textarea', label: '多行文本' },
    { value: 'number', label: '数字' },
    { value: 'select', label: '下拉选择' },
    { value: 'multiselect', label: '多选' },
    { value: 'color', label: '颜色' },
    { value: 'tags', label: '标签组' },
    { value: 'switch', label: '开关' },
];

const DEFAULT_TEMPLATE: KnowledgeTemplate = {
    id: '',
    name: '',
    icon: '',
    description: '',
    fields: [],
    isBuiltin: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
};

// ===== 工具函数 =====

function generateId(): string {
    return `field-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function generateTemplateId(): string {
    return `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ===== 字段编辑器组件 =====

interface FieldEditorProps {
    field: TemplateField;
    index: number;
    totalFields: number;
    onUpdate: (field: TemplateField) => void;
    onDelete: () => void;
    onMoveUp: () => void;
    onMoveDown: () => void;
}

const FieldEditor: React.FC<FieldEditorProps> = ({
    field,
    index,
    totalFields,
    onUpdate,
    onDelete,
    onMoveUp,
    onMoveDown,
}) => {
    const [expanded, setExpanded] = useState(false);
    const [optionsText, setOptionsText] = useState(field.options?.join('\n') || '');

    const handleFieldChange = useCallback((key: keyof TemplateField, value: unknown) => {
        onUpdate({ ...field, [key]: value });
    }, [field, onUpdate]);

    const handleOptionsChange = useCallback((text: string) => {
        setOptionsText(text);
        const options = text.split('\n').map(s => s.trim()).filter(Boolean);
        onUpdate({ ...field, options });
    }, [field, onUpdate]);

    const needsOptions = field.type === 'select' || field.type === 'multiselect';

    return (
        <div className="te-field-item">
            <div className="te-field-header">
                <div className="te-field-drag">⋮⋮</div>
                <div className="te-field-info">
                    <input
                        type="text"
                        className="te-field-label-input"
                        value={field.label}
                        onChange={e => handleFieldChange('label', e.target.value)}
                        placeholder="字段标签"
                    />
                    <select
                        className="te-field-type-select"
                        value={field.type}
                        onChange={e => handleFieldChange('type', e.target.value as FieldType)}
                    >
                        {FIELD_TYPE_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>
                                {opt.label}
                            </option>
                        ))}
                    </select>
                    <label className="te-field-required">
                        <input
                            type="checkbox"
                            checked={field.required}
                            onChange={e => handleFieldChange('required', e.target.checked)}
                        />
                        必填
                    </label>
                </div>
                <div className="te-field-actions">
                    <button
                        className="te-btn-icon"
                        onClick={onMoveUp}
                        disabled={index === 0}
                        title="上移"
                    >
                        ↑
                    </button>
                    <button
                        className="te-btn-icon"
                        onClick={onMoveDown}
                        disabled={index === totalFields - 1}
                        title="下移"
                    >
                        ↓
                    </button>
                    <button
                        className="te-btn-icon"
                        onClick={() => setExpanded(!expanded)}
                        title="展开设置"
                    >
                        {expanded ? '▼' : '▶'}
                    </button>
                    <button
                        className="te-btn-icon te-btn-danger"
                        onClick={onDelete}
                        title="删除字段"
                    >
                        ✕
                    </button>
                </div>
            </div>
            
            {expanded && (
                <div className="te-field-details">
                    <div className="te-field-row">
                        <label>
                            <span>字段名（英文）</span>
                            <input
                                type="text"
                                value={field.name}
                                onChange={e => handleFieldChange('name', e.target.value.replace(/\s/g, '_'))}
                                placeholder="如: title, description"
                            />
                        </label>
                        <label>
                            <span>占位提示</span>
                            <input
                                type="text"
                                value={field.placeholder || ''}
                                onChange={e => handleFieldChange('placeholder', e.target.value)}
                                placeholder="输入框提示文字"
                            />
                        </label>
                    </div>
                    
                    {needsOptions && (
                        <div className="te-field-row">
                            <label className="te-full-width">
                                <span>选项（每行一个）</span>
                                <textarea
                                    value={optionsText}
                                    onChange={e => handleOptionsChange(e.target.value)}
                                    placeholder="选项1&#10;选项2&#10;选项3"
                                    rows={4}
                                />
                            </label>
                        </div>
                    )}
                    
                    {(field.type === 'text' || field.type === 'textarea') && (
                        <div className="te-field-row">
                            <label>
                                <span>最小长度</span>
                                <input
                                    type="number"
                                    value={field.validation?.minLength || ''}
                                    onChange={e => handleFieldChange('validation', {
                                        ...field.validation,
                                        minLength: e.target.value ? parseInt(e.target.value) : undefined
                                    })}
                                    min={0}
                                />
                            </label>
                            <label>
                                <span>最大长度</span>
                                <input
                                    type="number"
                                    value={field.validation?.maxLength || ''}
                                    onChange={e => handleFieldChange('validation', {
                                        ...field.validation,
                                        maxLength: e.target.value ? parseInt(e.target.value) : undefined
                                    })}
                                    min={0}
                                />
                            </label>
                        </div>
                    )}
                    
                    {field.type === 'number' && (
                        <div className="te-field-row">
                            <label>
                                <span>最小值</span>
                                <input
                                    type="number"
                                    value={field.validation?.min ?? ''}
                                    onChange={e => handleFieldChange('validation', {
                                        ...field.validation,
                                        min: e.target.value ? parseFloat(e.target.value) : undefined
                                    })}
                                />
                            </label>
                            <label>
                                <span>最大值</span>
                                <input
                                    type="number"
                                    value={field.validation?.max ?? ''}
                                    onChange={e => handleFieldChange('validation', {
                                        ...field.validation,
                                        max: e.target.value ? parseFloat(e.target.value) : undefined
                                    })}
                                />
                            </label>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

// ===== 主组件 =====

export const TemplateEditor: React.FC<TemplateEditorProps> = ({
    template,
    onSave,
    onCancel,
    onDelete,
}) => {
    const isEditing = !!template?.id;
    const [formData, setFormData] = useState<KnowledgeTemplate>(() => 
        template ? { ...template } : { ...DEFAULT_TEMPLATE, id: generateTemplateId() }
    );
    const [errors, setErrors] = useState<Record<string, string>>({});

    // 验证表单
    const validate = useCallback((): boolean => {
        const newErrors: Record<string, string> = {};
        
        if (!formData.name.trim()) {
            newErrors.name = '请输入模板名称';
        }
        
        if (formData.fields.length === 0) {
            newErrors.fields = '至少添加一个字段';
        }
        
        const fieldNames = new Set<string>();
        formData.fields.forEach((field, index) => {
            if (!field.label.trim()) {
                newErrors[`field-${index}-label`] = '字段标签不能为空';
            }
            if (!field.name.trim()) {
                newErrors[`field-${index}-name`] = '字段名不能为空';
            } else if (fieldNames.has(field.name)) {
                newErrors[`field-${index}-name`] = '字段名重复';
            } else {
                fieldNames.add(field.name);
            }
        });
        
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    }, [formData]);

    // 添加字段
    const addField = useCallback(() => {
        const newField: TemplateField = {
            id: generateId(),
            name: `field_${formData.fields.length + 1}`,
            label: `字段 ${formData.fields.length + 1}`,
            type: 'text',
            required: false,
            order: formData.fields.length,
        };
        setFormData(prev => ({
            ...prev,
            fields: [...prev.fields, newField],
        }));
    }, [formData.fields.length]);

    // 更新字段
    const updateField = useCallback((index: number, updatedField: TemplateField) => {
        setFormData(prev => ({
            ...prev,
            fields: prev.fields.map((f, i) => i === index ? updatedField : f),
        }));
    }, []);

    // 删除字段
    const deleteField = useCallback((index: number) => {
        setFormData(prev => ({
            ...prev,
            fields: prev.fields.filter((_, i) => i !== index),
        }));
    }, []);

    // 移动字段
    const moveField = useCallback((index: number, direction: 'up' | 'down') => {
        setFormData(prev => {
            const newFields = [...prev.fields];
            const targetIndex = direction === 'up' ? index - 1 : index + 1;
            if (targetIndex < 0 || targetIndex >= newFields.length) return prev;
            
            [newFields[index], newFields[targetIndex]] = [newFields[targetIndex], newFields[index]];
            // 更新 order
            newFields.forEach((f, i) => f.order = i);
            
            return { ...prev, fields: newFields };
        });
    }, []);

    // 保存
    const handleSave = useCallback(() => {
        if (!validate()) return;
        
        const now = new Date().toISOString();
        const templateToSave: KnowledgeTemplate = {
            ...formData,
            updatedAt: now,
            createdAt: isEditing ? formData.createdAt : now,
        };
        
        onSave(templateToSave);
    }, [formData, isEditing, onSave, validate]);

    // 导出模板
    const handleExport = useCallback(() => {
        const exportData = {
            ...formData,
            isBuiltin: false,
        };
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `template-${formData.name || 'unnamed'}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }, [formData]);

    // 预览生成的表单
    const previewForm = useMemo(() => {
        return formData.fields.map(field => {
            const typeInfo = FIELD_TYPE_OPTIONS.find(t => t.value === field.type);
            return (
                <div key={field.id} className="te-preview-field">
                    <label>
                        {field.label}
                        {field.required && <span className="te-required">*</span>}
                    </label>
                    <div className="te-preview-input">
                        [{typeInfo?.label}]
                        {field.placeholder && <span className="te-placeholder"> {field.placeholder}</span>}
                    </div>
                </div>
            );
        });
    }, [formData.fields]);

    return (
        <div className="te-editor">
            <div className="te-header">
                <h3>{isEditing ? '编辑模板' : '新建知识模板'}</h3>
                <button className="te-btn-close" onClick={onCancel}>✕</button>
            </div>
            
            <div className="te-body">
                <div className="te-section">
                    <h4>基本信息</h4>
                    <div className="te-form-field">
                        <label>模板名称</label>
                        <input
                            type="text"
                            value={formData.name}
                            onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                            placeholder="如：卖点、产品规格、FAQ"
                            className={errors.name ? 'error' : ''}
                        />
                        {errors.name && <span className="te-error">{errors.name}</span>}
                    </div>
                    <div className="te-form-field">
                        <label>模板描述（可选）</label>
                        <input
                            type="text"
                            value={formData.description || ''}
                            onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))}
                            placeholder="描述这个模板的用途"
                        />
                    </div>
                </div>
                
                <div className="te-section">
                    <div className="te-section-header">
                        <h4>字段定义</h4>
                        <button className="te-btn-add" onClick={addField}>
                            + 添加字段
                        </button>
                    </div>
                    {errors.fields && <div className="te-error te-center">{errors.fields}</div>}
                    
                    <div className="te-fields-list">
                        {formData.fields.length === 0 ? (
                            <div className="te-empty">
                                点击"添加字段"开始定义模板结构
                            </div>
                        ) : (
                            formData.fields.map((field, index) => (
                                <FieldEditor
                                    key={field.id}
                                    field={field}
                                    index={index}
                                    totalFields={formData.fields.length}
                                    onUpdate={(f) => updateField(index, f)}
                                    onDelete={() => deleteField(index)}
                                    onMoveUp={() => moveField(index, 'up')}
                                    onMoveDown={() => moveField(index, 'down')}
                                />
                            ))
                        )}
                    </div>
                </div>
                
                {formData.fields.length > 0 && (
                    <div className="te-section">
                        <h4>预览</h4>
                        <div className="te-preview">
                            {previewForm}
                        </div>
                    </div>
                )}
            </div>
            
            <div className="te-footer">
                <div className="te-footer-left">
                    {isEditing && onDelete && !formData.isBuiltin && (
                        <button className="te-btn te-btn-danger" onClick={onDelete}>
                            删除模板
                        </button>
                    )}
                    <button className="te-btn" onClick={handleExport}>
                        导出模板
                    </button>
                </div>
                <div className="te-footer-right">
                    <button className="te-btn" onClick={onCancel}>
                        取消
                    </button>
                    <button className="te-btn te-btn-primary" onClick={handleSave}>
                        保存模板
                    </button>
                </div>
            </div>
        </div>
    );
};

// ===== 样式 =====
const styles = `
.te-editor {
    background: var(--de-bg-card, #1a1a2e);
    border-radius: 12px;
    border: 1px solid var(--de-border, rgba(255,255,255,0.1));
    display: flex;
    flex-direction: column;
    max-height: 80vh;
    width: 700px;
    max-width: 95vw;
}

.te-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    border-bottom: 1px solid var(--de-border, rgba(255,255,255,0.1));
}

.te-header h3 {
    margin: 0;
    font-size: 16px;
    color: var(--de-text-primary, #fff);
}

.te-btn-close {
    background: none;
    border: none;
    color: var(--de-text-secondary, #888);
    cursor: pointer;
    font-size: 18px;
    padding: 4px 8px;
}
.te-btn-close:hover {
    color: var(--de-text-primary, #fff);
}

.te-body {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
}

.te-section {
    margin-bottom: 24px;
}

.te-section h4 {
    margin: 0 0 12px 0;
    font-size: 14px;
    color: var(--de-text-secondary, #888);
    font-weight: 500;
}

.te-section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
}

.te-form-row {
    display: flex;
    gap: 12px;
    align-items: flex-start;
}

.te-form-field {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.te-form-field label {
    font-size: 12px;
    color: var(--de-text-secondary, #888);
}

.te-form-field input,
.te-form-field textarea {
    background: var(--de-bg-primary, #0a0a14);
    border: 1px solid var(--de-border, rgba(255,255,255,0.1));
    border-radius: 6px;
    color: var(--de-text-primary, #fff);
    padding: 8px 12px;
    font-size: 14px;
}
.te-form-field input:focus,
.te-form-field textarea:focus {
    outline: none;
    border-color: var(--de-accent, #6366f1);
}
.te-form-field input.error {
    border-color: #f43f5e;
}

.te-error {
    color: #f43f5e;
    font-size: 12px;
}
.te-center {
    text-align: center;
    margin: 8px 0;
}

.te-btn-add {
    background: var(--de-accent, #6366f1);
    color: white;
    border: none;
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 13px;
    cursor: pointer;
}
.te-btn-add:hover {
    opacity: 0.9;
}

.te-fields-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.te-empty {
    text-align: center;
    padding: 32px;
    color: var(--de-text-secondary, #888);
    background: var(--de-bg-primary, #0a0a14);
    border-radius: 8px;
    border: 1px dashed var(--de-border, rgba(255,255,255,0.1));
}

.te-field-item {
    background: var(--de-bg-primary, #0a0a14);
    border: 1px solid var(--de-border, rgba(255,255,255,0.1));
    border-radius: 8px;
    overflow: hidden;
}

.te-field-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
}

.te-field-drag {
    color: var(--de-text-secondary, #888);
    cursor: grab;
    font-size: 12px;
    user-select: none;
}

.te-field-info {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
}

.te-field-label-input {
    flex: 1;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    color: var(--de-text-primary, #fff);
    padding: 4px 8px;
    font-size: 14px;
}
.te-field-label-input:focus {
    outline: none;
    border-color: var(--de-border, rgba(255,255,255,0.2));
    background: var(--de-bg-card, #1a1a2e);
}

.te-field-type-select {
    background: var(--de-bg-card, #1a1a2e);
    border: 1px solid var(--de-border, rgba(255,255,255,0.1));
    border-radius: 4px;
    color: var(--de-text-primary, #fff);
    padding: 4px 8px;
    font-size: 12px;
}

.te-field-required {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--de-text-secondary, #888);
    cursor: pointer;
}
.te-field-required input {
    cursor: pointer;
}

.te-field-actions {
    display: flex;
    gap: 4px;
}

.te-btn-icon {
    width: 28px;
    height: 28px;
    background: none;
    border: 1px solid transparent;
    border-radius: 4px;
    color: var(--de-text-secondary, #888);
    cursor: pointer;
    font-size: 12px;
}
.te-btn-icon:hover:not(:disabled) {
    background: var(--de-hover-bg, rgba(255,255,255,0.1));
    color: var(--de-text-primary, #fff);
}
.te-btn-icon:disabled {
    opacity: 0.3;
    cursor: not-allowed;
}
.te-btn-icon.te-btn-danger:hover {
    background: rgba(244,63,94,0.2);
    color: #f43f5e;
}

.te-field-details {
    padding: 12px 16px;
    border-top: 1px solid var(--de-border, rgba(255,255,255,0.1));
    background: var(--de-bg-card, #1a1a2e);
}

.te-field-row {
    display: flex;
    gap: 12px;
    margin-bottom: 12px;
}
.te-field-row:last-child {
    margin-bottom: 0;
}

.te-field-row label {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
}
.te-field-row label.te-full-width {
    flex: none;
    width: 100%;
}

.te-field-row label span {
    font-size: 12px;
    color: var(--de-text-secondary, #888);
}

.te-field-row input,
.te-field-row textarea {
    background: var(--de-bg-primary, #0a0a14);
    border: 1px solid var(--de-border, rgba(255,255,255,0.1));
    border-radius: 4px;
    color: var(--de-text-primary, #fff);
    padding: 6px 10px;
    font-size: 13px;
}
.te-field-row textarea {
    resize: vertical;
    font-family: inherit;
}

.te-preview {
    background: var(--de-bg-primary, #0a0a14);
    border: 1px solid var(--de-border, rgba(255,255,255,0.1));
    border-radius: 8px;
    padding: 16px;
}

.te-preview-field {
    margin-bottom: 12px;
}
.te-preview-field:last-child {
    margin-bottom: 0;
}

.te-preview-field label {
    display: block;
    font-size: 13px;
    color: var(--de-text-primary, #fff);
    margin-bottom: 4px;
}

.te-required {
    color: #f43f5e;
    margin-left: 4px;
}

.te-preview-input {
    background: var(--de-bg-card, #1a1a2e);
    border: 1px solid var(--de-border, rgba(255,255,255,0.1));
    border-radius: 4px;
    padding: 8px 12px;
    font-size: 13px;
    color: var(--de-text-secondary, #888);
}

.te-placeholder {
    color: var(--de-text-tertiary, #666);
    font-size: 12px;
}

.te-footer {
    display: flex;
    justify-content: space-between;
    padding: 16px 20px;
    border-top: 1px solid var(--de-border, rgba(255,255,255,0.1));
}

.te-footer-left,
.te-footer-right {
    display: flex;
    gap: 8px;
}

.te-btn {
    background: var(--de-bg-card, #1a1a2e);
    border: 1px solid var(--de-border, rgba(255,255,255,0.1));
    border-radius: 6px;
    color: var(--de-text-primary, #fff);
    padding: 8px 16px;
    font-size: 13px;
    cursor: pointer;
}
.te-btn:hover {
    background: var(--de-hover-bg, rgba(255,255,255,0.1));
}

.te-btn-primary {
    background: var(--de-accent, #6366f1);
    border-color: var(--de-accent, #6366f1);
}
.te-btn-primary:hover {
    opacity: 0.9;
    background: var(--de-accent, #6366f1);
}

.te-btn-danger {
    color: #f43f5e;
    border-color: rgba(244,63,94,0.3);
}
.te-btn-danger:hover {
    background: rgba(244,63,94,0.2);
}
`;

// 注入样式
if (typeof document !== 'undefined') {
    const styleId = 'template-editor-styles';
    if (!document.getElementById(styleId)) {
        const styleEl = document.createElement('style');
        styleEl.id = styleId;
        styleEl.textContent = styles;
        document.head.appendChild(styleEl);
    }
}

export default TemplateEditor;
