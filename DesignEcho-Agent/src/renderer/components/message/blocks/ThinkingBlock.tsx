/**
 * 模型反馈 / 工具调用块。
 * 只展示已经进入消息记录的 provider thinking 和真实工具调用。
 */

import React, { useEffect, useRef, useState } from 'react';
import type { ThinkingBlock as ThinkingBlockType } from '../types';
import {
    resolveThinkingStepDisplayRole,
    resolveThinkingStepRoleLabel,
    type ThinkingStepDisplayRole
} from '../thinkingStepPresentation';

interface ThinkingBlockProps {
    block: ThinkingBlockType;
    collapseForTerminalState?: boolean;
}

export const ThinkingBlock: React.FC<ThinkingBlockProps> = ({
    block,
    collapseForTerminalState = false
}) => {
    const isRunning = block.isExpanded === true && !collapseForTerminalState;
    const [isExpanded, setIsExpanded] = useState(
        collapseForTerminalState ? false : block.isExpanded ?? false
    );
    // 运行中要能实时看到它在做什么：block.isExpanded 由 parser 按 isStreaming 传入，
    // 但 useState 只取一次初始值，流式从 false→true 时界面不会跟着展开（用户只能等跑完再手动展开）。
    // 这里让「开始运行」自动展开、「运行结束」自动收起；中途用户手动收起/展开的选择在本轮内保持不变。
    const userToggledRef = useRef(false);
    const wasRunningRef = useRef(isRunning);
    const stepsContainerRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        if (isRunning === wasRunningRef.current) return;
        wasRunningRef.current = isRunning;
        userToggledRef.current = false;
        setIsExpanded(isRunning);
    }, [isRunning]);
    // 运行中把最新一步滚进视野：长流程下用户始终看得到「此刻在做什么」，
    // 而不是停在最早几步、以为卡住了。用户手动收起过就不再自动跟随。
    const stepCount = block.steps.length;
    useEffect(() => {
        if (!isRunning || !isExpanded || userToggledRef.current) return;
        const container = stepsContainerRef.current;
        if (!container) return;
        container.scrollTop = container.scrollHeight;
    }, [isRunning, isExpanded, stepCount]);
    // 步骤级展开（看"已查看/已读取"的具体内容），与整块折叠互不影响。
    const [expandedStepIds, setExpandedStepIds] = useState<Record<string, boolean>>({});

    const hasError = block.steps.some(s => s.status === 'error');

    const toggleStepExpanded = (stepId: string): void => {
        setExpandedStepIds((current) => ({ ...current, [stepId]: !current[stepId] }));
    };

    const validSteps = block.steps.filter(s => s.label || s.detail);

    if (validSteps.length === 0) return null;

    const getStepDisplayText = (step: ThinkingBlockType['steps'][0]) => {
        const genericLabels = ['完成', '成功', '失败', 'success', 'error', 'done'];
        if (step.detail && genericLabels.some(g => step.label?.toLowerCase().includes(g.toLowerCase()))) {
            return step.detail;
        }
        return step.label || step.detail || '';
    };

    const isActionStep = (step: ThinkingBlockType['steps'][0]) => step.tone === 'action';

    const getDisplayRole = (step: ThinkingBlockType['steps'][0]): ThinkingStepDisplayRole => (
        step.displayRole || resolveThinkingStepDisplayRole({
            type: step.sourceType,
            tone: step.tone
        })
    );

    const getActionLabel = (step: ThinkingBlockType['steps'][0]) => {
        if (step.actionLabel) return step.actionLabel;
        if (step.status === 'error') return '未完成';
        if (step.status === 'running' || step.status === 'pending') return '正在制作';
        return '已完成';
    };

    const getRoleLabel = (step: ThinkingBlockType['steps'][0], role: ThinkingStepDisplayRole): string => {
        if (step.roleLabel) return step.roleLabel;
        return resolveThinkingStepRoleLabel(role, step.sourceType);
    };

    return (
        <div className={`message-block thinking-block ${hasError ? 'has-error' : ''} ${isRunning ? 'is-running' : 'is-terminal'}`}>
            <div
                className="thinking-header"
                onClick={() => {
                    userToggledRef.current = true;
                    setIsExpanded(!isExpanded);
                }}
            >
                <div className="thinking-summary">
                    <span className="thinking-dot"></span>
                    <span className="thinking-label">{block.title || '设计过程'}</span>
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

            {isExpanded && (
                <div className="thinking-steps" ref={stepsContainerRef}>
                    {validSteps.map((step, index) => {
                        const displayRole = getDisplayRole(step);
                        const actionStep = isActionStep(step) || displayRole === 'action';
                        const roleLabel = getRoleLabel(step, displayRole);
                        const stepExpanded = Boolean(step.preview && expandedStepIds[step.id]);
                        return (
                            <div
                                key={step.id}
                                className={`thinking-step step-${step.status} ${actionStep ? 'thinking-step--action' : 'thinking-step--thought'} thinking-step--${displayRole}`}
                            >
                                <span className="step-number">
                                    {String(index + 1).padStart(2, '0')}
                                </span>
                                {actionStep && (
                                    <span className="step-action-marker">
                                        {getActionLabel(step)}
                                    </span>
                                )}
                                {!actionStep && displayRole !== 'reasoning' && (
                                    <span className="step-role-marker">
                                        {roleLabel}
                                    </span>
                                )}
                                <span className="step-text">
                                    {getStepDisplayText(step)}
                                    {step.detail && !getStepDisplayText(step).includes(step.detail) && (
                                        <span className="step-detail">{step.detail}</span>
                                    )}
                                    {step.preview && (
                                        <button
                                            type="button"
                                            className={`step-expand-toggle ${stepExpanded ? 'is-expanded' : ''}`}
                                            aria-expanded={stepExpanded}
                                            aria-label={stepExpanded ? '收起结果内容' : '展开查看结果内容'}
                                            onClick={() => toggleStepExpanded(step.id)}
                                        >
                                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                                                <polyline points="6 9 12 15 18 9"></polyline>
                                            </svg>
                                        </button>
                                    )}
                                    {stepExpanded && step.preview!.sections.length > 0 && (
                                        <span className="step-preview" data-testid="step-result-preview">
                                            {step.preview!.sections.map((section, sectionIndex) => (
                                                <span key={sectionIndex} className="step-preview__section">
                                                    {section.title && <span className="step-preview__title">{section.title}</span>}
                                                    <ul className="step-preview__list">
                                                        {section.lines.map((line, lineIndex) => (
                                                            <li key={lineIndex}>{line}</li>
                                                        ))}
                                                    </ul>
                                                </span>
                                            ))}
                                        </span>
                                    )}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default ThinkingBlock;
