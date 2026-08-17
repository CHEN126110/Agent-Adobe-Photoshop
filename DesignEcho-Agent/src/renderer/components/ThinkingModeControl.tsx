import React, { useId, useRef, useState } from 'react';
import { Lightbulb } from 'lucide-react';

import { FloatingLayer } from './FloatingLayer';

import './ThinkingModeControl.css';

interface ThinkingModeControlProps {
    enabled: boolean;
    onToggle: () => void;
    direction?: 'up' | 'down';
    className?: string;
}

export const ThinkingModeControl: React.FC<ThinkingModeControlProps> = ({
    enabled,
    onToggle,
    direction = 'up',
    className = ''
}) => {
    const tooltipId = useId();
    const buttonRef = useRef<HTMLButtonElement>(null);
    // 提示改由 JS 控制显隐：它要 portal 出去才不会被 .chat-panel 的 overflow:hidden 切掉，
    // 而 portal 后就不再是按钮的后代，纯 CSS 的 :hover / :focus-within 管不到它了。
    const [hovered, setHovered] = useState(false);

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
                className={`thinking-mode-control-button ${enabled ? 'active' : ''}`}
                data-testid="chat-thinking-toggle"
                aria-label={enabled ? '关闭 Thinking' : '开启 Thinking'}
                aria-describedby={tooltipId}
                aria-pressed={enabled}
                onClick={onToggle}
            >
                <Lightbulb size={16} strokeWidth={1.8} aria-hidden="true" />
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
                    <strong>Thinking</strong>
                    <span>自主规划复杂任务并交付成品</span>
                </span>
            </FloatingLayer>
        </span>
    );
};
