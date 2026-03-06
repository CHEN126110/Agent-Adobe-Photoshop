/**
 * 动态表单组件
 * 
 * 根据模板字段定义自动生成表单
 */

import React, { useState, useCallback, useMemo } from 'react';
import type { KnowledgeTemplate, TemplateField } from '../../../shared/knowledge/template-schema';
import { validateEntry } from '../../../shared/knowledge/template-schema';

// ===== 类型定义 =====

interface DynamicFormProps {
    template: KnowledgeTemplate;
    initialData?: Record<string, unknown>;
    onSubmit: (data: Record<string, unknown>) => void;
    onCancel: () => void;
    submitLabel?: string;
}

interface TagInputProps {
    value: string[];
    onChange: (value: string[]) => void;
    placeholder?: string;
}

interface ColorPickerProps {
    value: string;
    onChange: (value: string) => void;
}

// ===== 标签输入组件 =====

const TagInput: React.FC<TagInputProps> = ({ value, onChange, placeholder }) => {
    const [inputValue, setInputValue] = useState('');

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && inputValue.trim()) {
            e.preventDefault();
            if (!value.includes(inputValue.trim())) {
                onChange([...value, inputValue.trim()]);
            }
            setInputValue('');
        } else if (e.key === 'Backspace' && !inputValue && value.length > 0) {
            onChange(value.slice(0, -1));
        }
    }, [inputValue, value, onChange]);

    const removeTag = useCallback((index: number) => {
        onChange(value.filter((_, i) => i !== index));
    }, [value, onChange]);

    return (
        <div className="df-tag-input">
            <div className="df-tags">
                {value.map((tag, index) => (
                    <span key={index} className="df-tag">
                        {tag}
                        <button type="button" onClick={() => removeTag(index)}>×</button>
                    </span>
                ))}
            </div>
            <input
                type="text"
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={value.length === 0 ? placeholder : ''}
            />
        </div>
    );
};

// ===== 颜色选择器组件 =====

const ColorPicker: React.FC<ColorPickerProps> = ({ value, onChange }) => {
    return (
        <div className="df-color-picker">
            <input
                type="color"
                value={value || '#000000'}
                onChange={e => onChange(e.target.value)}
            />
            <input
                type="text"
                value={value || ''}
                onChange={e => onChange(e.target.value)}
                placeholder="#000000"
                pattern="^#[0-9A-Fa-f]{6}$"
            />
        </div>
    );
};

// ===== 字段渲染器 =====

interface FieldRendererProps {
    field: TemplateField;
    value: unknown;
    onChange: (value: unknown) => void;
    error?: string;
}

const FieldRenderer: React.FC<FieldRendererProps> = ({ field, value, onChange, error }) => {
    const renderInput = () => {
        switch (field.type) {
            case 'text':
                return (
                    <input
                        type="text"
                        value={(value as string) || ''}
                        onChange={e => onChange(e.target.value)}
                        placeholder={field.placeholder}
                        maxLength={field.validation?.maxLength}
                    />
                );
            
            case 'textarea':
                return (
                    <textarea
                        value={(value as string) || ''}
                        onChange={e => onChange(e.target.value)}
                        placeholder={field.placeholder}
                        maxLength={field.validation?.maxLength}
                        rows={3}
                    />
                );
            
            case 'number':
                return (
                    <input
                        type="number"
                        value={(value as number) ?? ''}
                        onChange={e => onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
                        placeholder={field.placeholder}
                        min={field.validation?.min}
                        max={field.validation?.max}
                    />
                );
            
            case 'select':
                return (
                    <select
                        value={(value as string) || ''}
                        onChange={e => onChange(e.target.value)}
                    >
                        <option value="">请选择</option>
                        {field.options?.map(opt => (
                            <option key={opt} value={opt}>{opt}</option>
                        ))}
                    </select>
                );
            
            case 'multiselect':
                const selectedValues = (value as string[]) || [];
                return (
                    <div className="df-multiselect">
                        {field.options?.map(opt => (
                            <label key={opt} className="df-checkbox">
                                <input
                                    type="checkbox"
                                    checked={selectedValues.includes(opt)}
                                    onChange={e => {
                                        if (e.target.checked) {
                                            onChange([...selectedValues, opt]);
                                        } else {
                                            onChange(selectedValues.filter(v => v !== opt));
                                        }
                                    }}
                                />
                                <span>{opt}</span>
                            </label>
                        ))}
                    </div>
                );
            
            case 'color':
                return (
                    <ColorPicker
                        value={(value as string) || ''}
                        onChange={onChange}
                    />
                );
            
            case 'tags':
                return (
                    <TagInput
                        value={(value as string[]) || []}
                        onChange={v => onChange(v)}
                        placeholder={field.placeholder}
                    />
                );
            
            case 'switch':
                return (
                    <label className="df-switch">
                        <input
                            type="checkbox"
                            checked={Boolean(value)}
                            onChange={e => onChange(e.target.checked)}
                        />
                        <span className="df-switch-slider"></span>
                    </label>
                );
            
            default:
                return <span>不支持的字段类型: {field.type}</span>;
        }
    };

    return (
        <div className={`df-field ${error ? 'has-error' : ''}`}>
            <label>
                {field.label}
                {field.required && <span className="df-required">*</span>}
            </label>
            {renderInput()}
            {field.helpText && <p className="df-help">{field.helpText}</p>}
            {error && <p className="df-error">{error}</p>}
        </div>
    );
};

// ===== 主组件 =====

export const DynamicForm: React.FC<DynamicFormProps> = ({
    template,
    initialData,
    onSubmit,
    onCancel,
    submitLabel = '保存',
}) => {
    const [formData, setFormData] = useState<Record<string, unknown>>(() => {
        const data: Record<string, unknown> = {
            id: initialData?.id || `entry-${Date.now()}`,
            templateId: template.id,
            createdAt: initialData?.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        
        for (const field of template.fields) {
            data[field.name] = initialData?.[field.name] ?? field.defaultValue ?? getDefaultValue(field.type);
        }
        
        return data;
    });
    
    const [errors, setErrors] = useState<Record<string, string>>({});

    const sortedFields = useMemo(() => 
        [...template.fields].sort((a, b) => a.order - b.order),
        [template.fields]
    );

    const handleFieldChange = useCallback((fieldName: string, value: unknown) => {
        setFormData(prev => ({
            ...prev,
            [fieldName]: value,
            updatedAt: new Date().toISOString(),
        }));
        // 清除该字段的错误
        if (errors[fieldName]) {
            setErrors(prev => {
                const next = { ...prev };
                delete next[fieldName];
                return next;
            });
        }
    }, [errors]);

    const handleSubmit = useCallback((e: React.FormEvent) => {
        e.preventDefault();
        
        const validation = validateEntry(formData, template);
        if (!validation.valid) {
            setErrors(validation.errors);
            return;
        }
        
        onSubmit(formData);
    }, [formData, template, onSubmit]);

    return (
        <form className="df-form" onSubmit={handleSubmit}>
            <div className="df-header">
                <span className="df-title">{initialData?.id ? '编辑' : '添加'}{template.name}</span>
            </div>
            
            <div className="df-body">
                {sortedFields.map(field => (
                    <FieldRenderer
                        key={field.id}
                        field={field}
                        value={formData[field.name]}
                        onChange={v => handleFieldChange(field.name, v)}
                        error={errors[field.name]}
                    />
                ))}
            </div>
            
            <div className="df-footer">
                <button type="button" className="df-btn" onClick={onCancel}>
                    取消
                </button>
                <button type="submit" className="df-btn df-btn-primary">
                    {submitLabel}
                </button>
            </div>
        </form>
    );
};

// ===== 工具函数 =====

function getDefaultValue(type: string): unknown {
    switch (type) {
        case 'text':
        case 'textarea':
            return '';
        case 'number':
            return 0;
        case 'switch':
            return false;
        case 'tags':
        case 'multiselect':
            return [];
        case 'color':
            return '#000000';
        default:
            return null;
    }
}

// ===== 样式 =====
const styles = `
.df-form {
    background: var(--de-bg-card, #1a1a2e);
    border-radius: 12px;
    border: 1px solid var(--de-border, rgba(255,255,255,0.1));
    max-width: 500px;
    width: 100%;
}

.df-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 16px 20px;
    border-bottom: 1px solid var(--de-border, rgba(255,255,255,0.1));
}

.df-title {
    font-size: 16px;
    font-weight: 500;
    color: var(--de-text-primary, #fff);
}

.df-body {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    max-height: 60vh;
    overflow-y: auto;
}

.df-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.df-field > label {
    font-size: 13px;
    color: var(--de-text-secondary, #888);
    font-weight: 500;
}

.df-required {
    color: #f43f5e;
    margin-left: 4px;
}

.df-field input[type="text"],
.df-field input[type="number"],
.df-field textarea,
.df-field select {
    background: var(--de-bg-primary, #0a0a14);
    border: 1px solid var(--de-border, rgba(255,255,255,0.1));
    border-radius: 6px;
    color: var(--de-text-primary, #fff);
    padding: 10px 12px;
    font-size: 14px;
    font-family: inherit;
}

.df-field input:focus,
.df-field textarea:focus,
.df-field select:focus {
    outline: none;
    border-color: var(--de-accent, #6366f1);
}

.df-field.has-error input,
.df-field.has-error textarea,
.df-field.has-error select {
    border-color: #f43f5e;
}

.df-field textarea {
    resize: vertical;
    min-height: 80px;
}

.df-help {
    margin: 0;
    font-size: 12px;
    color: var(--de-text-tertiary, #666);
}

.df-error {
    margin: 0;
    font-size: 12px;
    color: #f43f5e;
}

.df-tag-input {
    background: var(--de-bg-primary, #0a0a14);
    border: 1px solid var(--de-border, rgba(255,255,255,0.1));
    border-radius: 6px;
    padding: 6px 8px;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    min-height: 42px;
}

.df-tag-input input {
    flex: 1;
    min-width: 100px;
    background: transparent;
    border: none;
    color: var(--de-text-primary, #fff);
    padding: 4px;
    font-size: 14px;
}
.df-tag-input input:focus {
    outline: none;
}

.df-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
}

.df-tag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: var(--de-accent-alpha, rgba(99,102,241,0.2));
    color: var(--de-accent, #6366f1);
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 13px;
}

.df-tag button {
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    padding: 0;
    font-size: 14px;
    line-height: 1;
    opacity: 0.7;
}
.df-tag button:hover {
    opacity: 1;
}

.df-color-picker {
    display: flex;
    gap: 8px;
    align-items: center;
}

.df-color-picker input[type="color"] {
    width: 42px;
    height: 42px;
    padding: 0;
    border: 1px solid var(--de-border, rgba(255,255,255,0.1));
    border-radius: 6px;
    cursor: pointer;
}

.df-color-picker input[type="text"] {
    flex: 1;
}

.df-multiselect {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.df-checkbox {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    font-size: 13px;
    color: var(--de-text-primary, #fff);
}

.df-checkbox input {
    cursor: pointer;
}

.df-switch {
    position: relative;
    display: inline-block;
    width: 44px;
    height: 24px;
}

.df-switch input {
    opacity: 0;
    width: 0;
    height: 0;
}

.df-switch-slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: var(--de-bg-primary, #0a0a14);
    border: 1px solid var(--de-border, rgba(255,255,255,0.1));
    border-radius: 24px;
    transition: 0.2s;
}

.df-switch-slider:before {
    position: absolute;
    content: "";
    height: 18px;
    width: 18px;
    left: 2px;
    bottom: 2px;
    background-color: var(--de-text-secondary, #888);
    border-radius: 50%;
    transition: 0.2s;
}

.df-switch input:checked + .df-switch-slider {
    background-color: var(--de-accent, #6366f1);
    border-color: var(--de-accent, #6366f1);
}

.df-switch input:checked + .df-switch-slider:before {
    transform: translateX(20px);
    background-color: #fff;
}

.df-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 16px 20px;
    border-top: 1px solid var(--de-border, rgba(255,255,255,0.1));
}

.df-btn {
    background: var(--de-bg-primary, #0a0a14);
    border: 1px solid var(--de-border, rgba(255,255,255,0.1));
    border-radius: 6px;
    color: var(--de-text-primary, #fff);
    padding: 8px 20px;
    font-size: 14px;
    cursor: pointer;
    transition: all 0.2s;
}

.df-btn:hover {
    background: var(--de-hover-bg, rgba(255,255,255,0.1));
}

.df-btn-primary {
    background: var(--de-accent, #6366f1);
    border-color: var(--de-accent, #6366f1);
}

.df-btn-primary:hover {
    opacity: 0.9;
    background: var(--de-accent, #6366f1);
}
`;

// 注入样式
if (typeof document !== 'undefined') {
    const styleId = 'dynamic-form-styles';
    if (!document.getElementById(styleId)) {
        const styleEl = document.createElement('style');
        styleEl.id = styleId;
        styleEl.textContent = styles;
        document.head.appendChild(styleEl);
    }
}

export default DynamicForm;
