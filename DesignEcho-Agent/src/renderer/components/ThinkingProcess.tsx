import React, { useState } from 'react';
import './ThinkingProcess.css';
import {
    getToolDisplayInfo,
    TOOL_NAME_MAP,
    type ToolDisplayInfo
} from '../services/tool-display-info';
import { buildToolResultPreview } from '../services/tool-result-preview';
import {
    resolveThinkingStepDisplayRole,
    resolveThinkingStepRoleLabel,
    cleanInlineProcessText,
    type ThinkingStepDisplayRole
} from './message/thinkingStepPresentation';

export { getToolDisplayInfo, TOOL_NAME_MAP, type ToolDisplayInfo };

export interface ThinkingStep {
    id: string;
    type: 'thinking' | 'status' | 'tool_call' | 'tool_result' | 'decision' | 'reading' | 'exploring' | 'analyzing';
    content: string;
    toolName?: string;
    toolParams?: unknown;
    toolResult?: unknown;
    imageData?: string;
    status: 'pending' | 'running' | 'success' | 'error';
    timestamp: number;
    duration?: number;
    filePath?: string;
    lineRange?: string;
}

interface ThinkingProcessProps {
    steps: ThinkingStep[];
    isExpanded?: boolean;
    onToggle?: () => void;
    className?: string;
}

const VISIBLE_STEP_TYPES = new Set<ThinkingStep['type']>([
    'thinking',
    'status',
    'decision',
    'reading',
    'exploring',
    'analyzing',
    'tool_call',
    'tool_result'
]);

function isActionStep(step: ThinkingStep): boolean {
    return step.type === 'tool_call' || step.type === 'tool_result';
}

function getDisplayRole(step: ThinkingStep): ThinkingStepDisplayRole {
    return resolveThinkingStepDisplayRole({
        type: step.type,
        toolName: step.toolName,
        tone: isActionStep(step) ? 'action' : 'thought'
    });
}

function getActionLabel(step: ThinkingStep): string {
    if (step.status === 'error') return '未完成';
    if (step.status === 'running' || step.status === 'pending') return '正在制作';
    return '已完成';
}

function resolveThinkingPanelTitle(panelSteps: ThinkingStep[]): string {
    const hasActiveStep = panelSteps.some((step) => step.status === 'running' || step.status === 'pending');
    return hasActiveStep ? '正在设计' : '设计过程';
}

export const ThinkingProcess: React.FC<ThinkingProcessProps> = ({
    steps,
    className = ''
}) => {
    // 已展开步骤（看"已查看/已读取"的具体内容）；默认收起，保持过程面板清爽。
    const [expandedStepIds, setExpandedStepIds] = useState<Record<string, boolean>>({});
    const validSteps = steps.filter((step) =>
        VISIBLE_STEP_TYPES.has(step.type)
        && typeof step.content === 'string'
        && step.content.trim().length > 0
    );
    if (validSteps.length === 0) {
        return null;
    }

    const getStepText = (step: ThinkingStep): string => {
        if ((step.type === 'tool_call' || step.type === 'tool_result') && step.toolName) {
            const info = getToolDisplayInfo(step.toolName);
            const raw = step.content || info.name;
            // 动作状态已由左侧时间线节点图标表达，文案去掉冗余的「执行」前缀，只留工具名（更清爽）。
            return cleanInlineProcessText(raw.replace(/^执行\s*/, '')) || info.name;
        }
        // 思考/观察文本剥离 markdown 标记与状态 emoji，避免裸标记与彩色 emoji 噪音。
        return cleanInlineProcessText(step.content);
    };

    const toggleStepExpanded = (stepId: string): void => {
        setExpandedStepIds((current) => ({ ...current, [stepId]: !current[stepId] }));
    };

    const renderStepPanel = (title: string, panelSteps: ThinkingStep[]) => panelSteps.length > 0 ? (
        <div className={`thinking-simple ${className}`}>
            <div className="pondering-header">
                <span className="pondering-dot"></span>
                {/* 标题在进行中才带扫光（样式钩子 is-active）：强调留给整体状态这一行，
                    下面的明细列表保持静态，否则满屏都在动反而没有重点。
                    判据与 resolveThinkingPanelTitle 的「正在…」口径一致，同源同步。 */}
                <span
                    className={`pondering-title ${panelSteps.some((step) => step.status === 'running' || step.status === 'pending')
                        ? 'is-active'
                        : ''}`}
                >
                    {title}
                </span>
            </div>

            <div className="pondering-steps">
                {panelSteps.map((step) => {
                    const displayRole = getDisplayRole(step);
                    const isTool = isActionStep(step) || displayRole === 'action';
                    // 语义标签不再以文字 pill 占据版面，转为可访问性属性（hover/读屏可见）；
                    // 步骤的类型与状态由左侧时间线节点的形状/颜色表达，正文按主次分级排版。
                    const semanticLabel = isTool
                        ? getActionLabel(step)
                        : resolveThinkingStepRoleLabel(displayRole, step.type);
                    const preview = isTool && step.toolName
                        ? buildToolResultPreview(step.toolName, step.toolResult)
                        : undefined;
                    const expanded = Boolean(preview && expandedStepIds[step.id]);
                    return (
                        <div
                            key={step.id}
                            className={`pondering-step ${step.status} ${isTool ? 'is-action' : 'is-thought'} pondering-step--${displayRole}`}
                            title={semanticLabel}
                            aria-label={semanticLabel}
                        >
                            <span className="step-node" aria-hidden="true" />
                            <div className="step-body">
                                <div className={`step-line ${preview ? 'step-line--expandable' : ''}`}>
                                    <span className="step-text">{getStepText(step)}</span>
                                    {preview && (
                                        <button
                                            type="button"
                                            className={`step-expand-toggle ${expanded ? 'is-expanded' : ''}`}
                                            aria-expanded={expanded}
                                            aria-label={expanded ? '收起结果内容' : '展开查看结果内容'}
                                            onClick={() => toggleStepExpanded(step.id)}
                                        >
                                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                                                <polyline points="6 9 12 15 18 9"></polyline>
                                            </svg>
                                        </button>
                                    )}
                                </div>
                                {preview?.summary && (
                                    <span className="step-summary">{preview.summary}</span>
                                )}
                                {expanded && preview && preview.sections.length > 0 && (
                                    <div className="step-preview" data-testid="step-result-preview">
                                        {preview.sections.map((section, sectionIndex) => (
                                            <div key={sectionIndex} className="step-preview__section">
                                                {section.title && <span className="step-preview__title">{section.title}</span>}
                                                <ul className="step-preview__list">
                                                    {section.lines.map((line, lineIndex) => (
                                                        <li key={lineIndex}>{line}</li>
                                                    ))}
                                                </ul>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                            {step.imageData && (
                                <img
                                    className="step-snapshot"
                                    src={step.imageData.startsWith('data:')
                                        ? step.imageData
                                        : `data:image/jpeg;base64,${step.imageData}`}
                                    alt={getStepText(step)}
                                    loading="lazy"
                                />
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    ) : null;

    // 按原始时间顺序交替渲染：思考片段 → 它触发的工具 → 下一段思考 → 工具……（像 Claude 那样想一步做一步），
    // 而不是把思考全堆成一组、工具全堆成一组（旧版分两个面板渲染，导致思考和动作割裂、对不上）。
    return renderStepPanel(resolveThinkingPanelTitle(validSteps), validSteps);
};

export default ThinkingProcess;
