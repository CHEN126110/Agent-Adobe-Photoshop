import React from 'react';
import './ThinkingProcess.css';
import {
    getToolDisplayInfo,
    TOOL_NAME_MAP,
    type ToolDisplayInfo
} from '../services/tool-display-info';

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
    'tool_call',
    'tool_result'
]);

function getStepKindLabel(step: ThinkingStep): string {
    if (step.type === 'tool_call' || step.type === 'tool_result') return '执行';
    if (step.type === 'status') return '进度';
    if (step.type === 'decision') return '判断';
    if (step.type === 'analyzing') return '分析';
    if (step.type === 'exploring' || step.type === 'reading') return '读取';
    return '思考';
}

export const ThinkingProcess: React.FC<ThinkingProcessProps> = ({
    steps,
    className = ''
}) => {
    const validSteps = steps.filter((step) =>
        VISIBLE_STEP_TYPES.has(step.type)
        && typeof step.content === 'string'
        && step.content.trim().length > 0
    );
    const thinkingSteps = validSteps.filter((step) => step.type === 'thinking');
    const toolSteps = validSteps.filter((step) => step.type === 'tool_call' || step.type === 'tool_result');

    if (validSteps.length === 0) {
        return null;
    }

    const getStepText = (step: ThinkingStep): string => {
        if (step.type === 'tool_call' && step.toolName) {
            const info = getToolDisplayInfo(step.toolName);
            return step.content || `执行 ${info.name}`;
        }
        return step.content;
    };

    const renderStepPanel = (title: string, panelSteps: ThinkingStep[]) => panelSteps.length > 0 ? (
        <div className={`thinking-simple ${className}`}>
            <div className="pondering-header">
                <span className="pondering-dot"></span>
                <span className="pondering-title">{title}</span>
                <span className="pondering-count">({panelSteps.length})</span>
            </div>

            <div className="pondering-steps">
                {panelSteps.map((step, index) => (
                    <div key={step.id} className={`pondering-step ${step.status}`}>
                        <span className="step-number">{String(index + 1).padStart(2, '0')}</span>
                        <span className="step-kind">{getStepKindLabel(step)}</span>
                        <span className="step-text">{getStepText(step)}</span>
                    </div>
                ))}
            </div>
        </div>
    ) : null;

    return (
        <>
            {renderStepPanel('正在思考', thinkingSteps)}
            {renderStepPanel('工具调用', toolSteps)}
        </>
    );
};

export default ThinkingProcess;
