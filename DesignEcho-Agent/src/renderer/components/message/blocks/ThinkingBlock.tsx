/**
 * 思考过程块渲染组件（GPT Pondering 风格）
 * 简洁纯文本，无图标装饰
 */

import React, { useState } from 'react';
import type { ThinkingBlock as ThinkingBlockType } from '../types';

interface ThinkingBlockProps {
    block: ThinkingBlockType;
}

export const ThinkingBlock: React.FC<ThinkingBlockProps> = ({ block }) => {
    const [isExpanded, setIsExpanded] = useState(block.isExpanded ?? false);
    
    const completedSteps = block.steps.filter(s => s.status === 'success').length;
    const totalSteps = block.steps.length;
    const hasError = block.steps.some(s => s.status === 'error');
    
    const formatDuration = (ms?: number) => {
        if (!ms) return null;
        if (ms < 1000) return `${ms}ms`;
        return `${(ms / 1000).toFixed(1)}s`;
    };
    
    // 过滤出有内容的步骤
    const validSteps = block.steps.filter(s => s.label || s.detail);
    
    if (validSteps.length === 0) return null;
    
    // 获取步骤的显示文本（优先显示 detail，其次是 label）
    const getStepDisplayText = (step: ThinkingBlockType['steps'][0]) => {
        // 如果 label 是通用状态词（完成/成功/失败），则使用 detail
        const genericLabels = ['完成', '成功', '失败', 'success', 'error', 'done'];
        if (step.detail && genericLabels.some(g => step.label?.toLowerCase().includes(g.toLowerCase()))) {
            return step.detail;
        }
        // 否则优先使用 label，如果 label 为空则用 detail
        return step.label || step.detail || '';
    };
    
    return (
        <div className={`message-block thinking-block ${hasError ? 'has-error' : ''}`}>
            {/* 折叠头部 */}
            <div 
                className="thinking-header"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="thinking-summary">
                    <span className="thinking-dot"></span>
                    <span className="thinking-label">Pondering</span>
                    <span className="thinking-progress">({totalSteps})</span>
                    {block.totalDuration && (
                        <span className="thinking-duration">
                            {formatDuration(block.totalDuration)}
                        </span>
                    )}
                </div>
                <button className="expand-toggle">
                    <svg 
                        width="14" 
                        height="14" 
                        viewBox="0 0 24 24" 
                        fill="none" 
                        stroke="currentColor" 
                        strokeWidth="2"
                        style={{ 
                            transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                            transition: 'transform 0.2s ease'
                        }}
                    >
                        <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                </button>
            </div>
            
            {/* 展开的步骤列表 - 纯文本风格 */}
            {isExpanded && (
                <div className="thinking-steps">
                    {validSteps.map((step, index) => (
                        <div 
                            key={step.id} 
                            className={`thinking-step step-${step.status}`}
                        >
                            <span className="step-number">
                                {String(index + 1).padStart(2, '0')}
                            </span>
                            <span className="step-text">
                                {getStepDisplayText(step)}
                                {step.duration && (
                                    <span className="step-duration">
                                        {formatDuration(step.duration)}
                                    </span>
                                )}
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default ThinkingBlock;
