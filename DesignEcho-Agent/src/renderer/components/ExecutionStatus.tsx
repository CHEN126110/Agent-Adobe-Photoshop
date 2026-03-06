/**
 * 执行状态指示器
 * 
 * 显示 AI 模型执行过程中的实时状态，类似 GPT 的思考过程显示
 */

import React, { useEffect, useState } from 'react';

export interface ExecutionStep {
    id: string;
    label: string;
    icon: string;
    status: 'pending' | 'running' | 'completed' | 'error';
    detail?: string;
}

interface ExecutionStatusProps {
    steps: ExecutionStep[];
    currentStep?: string;
    isVisible: boolean;
}

export const ExecutionStatus: React.FC<ExecutionStatusProps> = ({
    steps,
    isVisible
}) => {
    const [dots, setDots] = useState('');

    // 动画效果：正在执行的步骤显示动态省略号
    useEffect(() => {
        if (!isVisible) return;
        
        const interval = setInterval(() => {
            setDots(prev => prev.length >= 3 ? '' : prev + '.');
        }, 500);

        return () => clearInterval(interval);
    }, [isVisible]);

    if (!isVisible || steps.length === 0) return null;

    const getStatusIcon = (status: ExecutionStep['status']) => {
        switch (status) {
            case 'completed': return '✓';
            case 'error': return '✗';
            case 'running': return '◎';
            default: return '○';
        }
    };

    const getStatusClass = (status: ExecutionStep['status']) => {
        switch (status) {
            case 'completed': return 'step-completed';
            case 'error': return 'step-error';
            case 'running': return 'step-running';
            default: return 'step-pending';
        }
    };

    return (
        <div className="execution-status">
            <div className="execution-header">
                <span className="thinking-icon">🤔</span>
                <span className="thinking-text">AI 正在执行{dots}</span>
            </div>
            
            <div className="execution-steps">
                {steps.map((step) => (
                    <div 
                        key={step.id} 
                        className={`execution-step ${getStatusClass(step.status)}`}
                    >
                        <span className="step-icon">{step.icon}</span>
                        <span className="step-status-icon">{getStatusIcon(step.status)}</span>
                        <span className="step-label">{step.label}</span>
                        {step.status === 'running' && (
                            <span className="step-dots">{dots}</span>
                        )}
                        {step.detail && step.status === 'completed' && (
                            <span className="step-detail">{step.detail}</span>
                        )}
                    </div>
                ))}
            </div>

            <style>{`
                .execution-status {
                    background: linear-gradient(135deg, rgba(99, 102, 241, 0.1) 0%, rgba(139, 92, 246, 0.1) 100%);
                    border: 1px solid rgba(99, 102, 241, 0.3);
                    border-radius: 12px;
                    padding: 16px;
                    margin: 12px 0;
                    animation: fadeIn 0.3s ease;
                }

                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(-10px); }
                    to { opacity: 1; transform: translateY(0); }
                }

                .execution-header {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin-bottom: 12px;
                    padding-bottom: 12px;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                }

                .thinking-icon {
                    font-size: 20px;
                    animation: pulse 1.5s infinite;
                }

                @keyframes pulse {
                    0%, 100% { transform: scale(1); }
                    50% { transform: scale(1.1); }
                }

                .thinking-text {
                    font-size: 14px;
                    font-weight: 600;
                    color: var(--de-text);
                }

                .execution-steps {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }

                .execution-step {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 8px 12px;
                    border-radius: 8px;
                    background: rgba(0, 0, 0, 0.2);
                    font-size: 13px;
                    transition: all 0.3s ease;
                }

                .step-icon {
                    font-size: 16px;
                    width: 24px;
                    text-align: center;
                }

                .step-status-icon {
                    font-size: 12px;
                    width: 16px;
                    text-align: center;
                }

                .step-label {
                    flex: 1;
                    color: var(--de-text-secondary);
                }

                .step-dots {
                    color: var(--de-primary);
                    font-weight: bold;
                    min-width: 20px;
                }

                .step-detail {
                    font-size: 11px;
                    color: var(--de-text-secondary);
                    opacity: 0.7;
                    max-width: 150px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                /* 状态样式 */
                .step-pending {
                    opacity: 0.5;
                }

                .step-pending .step-status-icon {
                    color: var(--de-text-secondary);
                }

                .step-running {
                    background: rgba(99, 102, 241, 0.2);
                    border: 1px solid rgba(99, 102, 241, 0.4);
                }

                .step-running .step-status-icon {
                    color: var(--de-primary);
                    animation: spin 1s linear infinite;
                }

                .step-running .step-label {
                    color: var(--de-text);
                    font-weight: 500;
                }

                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }

                .step-completed {
                    opacity: 0.8;
                }

                .step-completed .step-status-icon {
                    color: #10b981;
                }

                .step-completed .step-label {
                    color: var(--de-text);
                }

                .step-error .step-status-icon {
                    color: #ef4444;
                }

                .step-error .step-label {
                    color: #ef4444;
                }
            `}</style>
        </div>
    );
};

/**
 * 预定义的执行步骤模板
 */
export const EXECUTION_TEMPLATES = {
    textOptimize: [
        { id: 'get-text', label: '获取选中图层文本', icon: '📝', status: 'pending' as const },
        { id: 'get-style', label: '分析当前样式', icon: '🎨', status: 'pending' as const },
        { id: 'ai-optimize', label: '调用 AI 模型优化', icon: '🤖', status: 'pending' as const },
        { id: 'generate', label: '生成优化方案', icon: '✨', status: 'pending' as const },
    ],
    layoutAnalysis: [
        { id: 'get-doc', label: '获取文档信息', icon: '📄', status: 'pending' as const },
        { id: 'get-layers', label: '扫描所有图层', icon: '📋', status: 'pending' as const },
        { id: 'analyze-bounds', label: '分析图层位置', icon: '📐', status: 'pending' as const },
        { id: 'ai-analyze', label: '调用 AI 分析排版', icon: '🤖', status: 'pending' as const },
        { id: 'generate-fixes', label: '生成修复建议', icon: '🔧', status: 'pending' as const },
    ],
    referenceAnalyze: [
        { id: 'upload-ref', label: '上传参考图', icon: '🖼️', status: 'pending' as const },
        { id: 'get-snapshot', label: '获取当前设计截图', icon: '📸', status: 'pending' as const },
        { id: 'ai-compare', label: 'AI 视觉对比分析', icon: '🔍', status: 'pending' as const },
        { id: 'extract-rules', label: '提取设计规则', icon: '📏', status: 'pending' as const },
        { id: 'generate-suggestions', label: '生成调整建议', icon: '💡', status: 'pending' as const },
    ],
    naturalChat: [
        { id: 'get-context', label: '获取 Photoshop 上下文', icon: '🎯', status: 'pending' as const },
        { id: 'ai-think', label: 'AI 理解与推理', icon: '💡', status: 'pending' as const },
        { id: 'generate-response', label: '生成回复', icon: '💬', status: 'pending' as const },
    ],
    applyFix: [
        { id: 'select-layer', label: '选中目标图层', icon: '👆', status: 'pending' as const },
        { id: 'apply-change', label: '应用修改', icon: '✏️', status: 'pending' as const },
        { id: 'verify', label: '验证结果', icon: '✅', status: 'pending' as const },
    ],
    generateCopy: [
        { id: 'capture', label: '捕获当前画布', icon: '📸', status: 'pending' as const },
        { id: 'analyze-visual', label: '分析视觉内容', icon: '👁️', status: 'pending' as const },
        { id: 'identify-product', label: '识别产品特征', icon: '🏷️', status: 'pending' as const },
        { id: 'ai-generate', label: 'AI 生成卖点文案', icon: '🤖', status: 'pending' as const },
        { id: 'format-output', label: '格式化输出', icon: '📋', status: 'pending' as const },
    ],
};

/**
 * 创建步骤管理器的 Hook
 */
export function useExecutionSteps(templateName: keyof typeof EXECUTION_TEMPLATES) {
    const [steps, setSteps] = useState<ExecutionStep[]>([]);
    const [isVisible, setIsVisible] = useState(false);

    const start = () => {
        const template = EXECUTION_TEMPLATES[templateName];
        setSteps(template.map(s => ({ ...s, status: 'pending' as const })));
        setIsVisible(true);
    };

    const updateStep = (stepId: string, status: ExecutionStep['status'], detail?: string) => {
        setSteps(prev => prev.map(step => 
            step.id === stepId ? { ...step, status, detail } : step
        ));
    };

    const completeStep = (stepId: string, detail?: string) => {
        updateStep(stepId, 'completed', detail);
    };

    const startStep = (stepId: string) => {
        updateStep(stepId, 'running');
    };

    const errorStep = (stepId: string, detail?: string) => {
        updateStep(stepId, 'error', detail);
    };

    const finish = () => {
        setTimeout(() => setIsVisible(false), 1000);
    };

    const reset = () => {
        setSteps([]);
        setIsVisible(false);
    };

    return {
        steps,
        isVisible,
        start,
        startStep,
        completeStep,
        errorStep,
        finish,
        reset,
    };
}
