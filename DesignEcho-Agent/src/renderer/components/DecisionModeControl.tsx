/**
 * Agent 拿不准时怎么办：问我（弹选项让我选）/ 全自动（按它自己倾向的继续并说明）。
 * 与 ThinkingModeControl 同一套观感（图标按钮 + 浮层提示），放在输入框工具条里。
 */
import React, { useId, useRef, useState } from 'react';
import { MessageCircleQuestion, Zap } from 'lucide-react';

import { FloatingLayer } from './FloatingLayer';
import type { AgentDecisionMode } from '../../shared/user-choice-request';

import './ThinkingModeControl.css';

interface DecisionModeControlProps {
    mode: AgentDecisionMode;
    onToggle: () => void;
    direction?: 'up' | 'down';
    className?: string;
}

export const DecisionModeControl: React.FC<DecisionModeControlProps> = ({
    mode,
    onToggle,
    direction = 'up',
    className = ''
}) => {
    const tooltipId = useId();
    const buttonRef = useRef<HTMLButtonElement>(null);
    const [hovered, setHovered] = useState(false);
    const auto = mode === 'auto';

    return (
        <span
            className={`thinking-mode-control ${className}`.trim()}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onFocus={() => setHovered(true)}
            onBlur={() => setHovered(false)}
        >
            <button
                ref={buttonRef}
                type="button"
                className={`thinking-mode-control-button ${auto ? 'active' : ''}`}
                data-testid="chat-decision-mode-toggle"
                aria-label={auto ? '切到「问我」：拿不准时弹选项让我选' : '切到「全自动」：拿不准时它自己定'}
                aria-describedby={tooltipId}
                aria-pressed={auto}
                onClick={onToggle}
            >
                {auto
                    ? <Zap size={16} strokeWidth={1.8} aria-hidden="true" />
                    : <MessageCircleQuestion size={16} strokeWidth={1.8} aria-hidden="true" />}
            </button>
            <FloatingLayer
                anchorRef={buttonRef}
                open={hovered}
                placement={direction}
                align="center"
                className="thinking-mode-tooltip"
                role="tooltip"
            >
                <span id={tooltipId} className="thinking-mode-tooltip-inner">
                    <strong>{auto ? '全自动' : '问我'}</strong>
                    <span>{auto ? '拿不准的事它按自己倾向的继续，并说明为什么' : '拿不准的事弹几个选项让你定'}</span>
                </span>
            </FloatingLayer>
        </span>
    );
};
