/**
 * 工具结果块渲染组件
 */

import React, { useState } from 'react';
import type { ToolResultBlock as ToolResultBlockType } from '../types';

interface ToolResultBlockProps {
    block: ToolResultBlockType;
    onAction?: (actionId: string, params?: Record<string, any>) => void;
}

export const ToolResultBlock: React.FC<ToolResultBlockProps> = ({ block, onAction }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    
    const statusIcon = block.success ? '✓' : '✗';
    const statusClass = block.success ? 'success' : 'error';
    
    const formatDuration = (ms?: number) => {
        if (!ms) return null;
        if (ms < 1000) return `${ms}ms`;
        return `${(ms / 1000).toFixed(1)}s`;
    };
    
    const formatResultValue = (value: any): string => {
        if (value === null || value === undefined) return '-';
        if (typeof value === 'boolean') return value ? '是' : '否';
        if (typeof value === 'number') return value.toLocaleString();
        if (typeof value === 'string') return value;
        if (Array.isArray(value)) return `${value.length} 项`;
        if (typeof value === 'object') return JSON.stringify(value, null, 2);
        return String(value);
    };
    
    return (
        <div className={`message-block tool-result-block ${statusClass}`}>
            {/* 头部 */}
            <div className="tool-result-header" onClick={() => setIsExpanded(!isExpanded)}>
                <div className="tool-info">
                    <span className="tool-icon">{block.icon}</span>
                    <span className="tool-name">{block.displayName}</span>
                    <span className={`status-badge ${statusClass}`}>
                        {statusIcon} {block.success ? '成功' : '失败'}
                    </span>
                </div>
                <div className="tool-meta">
                    {block.duration && (
                        <span className="tool-duration">{formatDuration(block.duration)}</span>
                    )}
                    <button className="expand-btn">
                        <svg 
                            width="16" 
                            height="16" 
                            viewBox="0 0 24 24" 
                            fill="none" 
                            stroke="currentColor" 
                            strokeWidth="2"
                            style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
                        >
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </button>
                </div>
            </div>
            
            {/* 详情 */}
            {isExpanded && (
                <div className="tool-result-details">
                    {/* 错误信息 */}
                    {block.error && (
                        <div className="error-message">
                            <span className="error-icon">⚠️</span>
                            <span className="error-text">{block.error}</span>
                        </div>
                    )}
                    
                    {/* 详情列表 */}
                    {block.details && block.details.length > 0 && (
                        <div className="details-list">
                            {block.details.map((detail, index) => (
                                <div key={index} className="detail-item">
                                    <span className="detail-label">{detail.label}:</span>
                                    <span className={`detail-value ${detail.type || 'text'}`}>
                                        {detail.type === 'code' ? (
                                            <code>{detail.value}</code>
                                        ) : detail.type === 'link' ? (
                                            <a href={String(detail.value)} target="_blank" rel="noopener">
                                                {detail.value}
                                            </a>
                                        ) : (
                                            formatResultValue(detail.value)
                                        )}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                    
                    {/* 原始结果 */}
                    {block.result && !block.details && (
                        <div className="raw-result">
                            <pre>{formatResultValue(block.result)}</pre>
                        </div>
                    )}
                    
                    {/* 操作按钮 */}
                    {block.actions && block.actions.length > 0 && (
                        <div className="action-buttons">
                            {block.actions.map(action => (
                                <button
                                    key={action.id}
                                    className={`action-btn ${action.variant || 'secondary'}`}
                                    disabled={action.disabled || action.loading}
                                    onClick={() => onAction?.(action.action, action.params)}
                                >
                                    {action.loading && <span className="btn-spinner"></span>}
                                    {action.icon && <span className="btn-icon">{action.icon}</span>}
                                    <span className="btn-label">{action.label}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default ToolResultBlock;
