/**
 * 上下文占用环形指示器。
 *
 * 放在 Thinking 灯泡左侧，平时只是一个安静的圆环，悬停才展开明细。
 * 数字全部来自 shared/context-window-usage，与运行时压缩用的是同一套估算口径；
 * 这是估算不是 provider 计费值，界面上必须写明，别让用户拿它去对账。
 */

import React, { useRef, useState } from 'react';

import {
    formatTokenCount,
    type ContextWindowUsage
} from '../../shared/context-window-usage';
import { FloatingLayer } from './FloatingLayer';

import './ContextUsageIndicator.css';

export interface ContextUsageIndicatorProps {
    usage: ContextWindowUsage;
    direction?: 'up' | 'down';
    className?: string;
}

const RADIUS = 7;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** 占用越高越该扎眼；三档而不是连续渐变，扫一眼就能判断严重程度。 */
function resolveLevel(ratio: number): 'ok' | 'warn' | 'danger' {
    if (ratio >= 0.85) return 'danger';
    if (ratio >= 0.6) return 'warn';
    return 'ok';
}

export function ContextUsageIndicator({
    usage,
    direction = 'up',
    className = ''
}: ContextUsageIndicatorProps): React.ReactElement {
    const anchorRef = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);

    const clampedRatio = Math.min(1, Math.max(0, usage.ratio));
    // 装不下是硬问题，优先级高于"用了多少"：环直接置红，不管当前比例是多少
    const level = usage.fit.verdict === 'exceeds' ? 'danger' : resolveLevel(usage.ratio);
    const percentText = `${Math.round(usage.ratio * 100)}%`;
    const basisText = ((): string => {
        switch (usage.basis) {
            case 'model_declared':
                return '按当前主模型声明的上下文窗口计算';
            case 'provider_default':
                return '当前主模型未单独声明窗口，按该渠道官方公布的上下文长度计算';
            default:
                return '当前主模型与渠道都没有公布上下文窗口，暂按 Agent 的消息压缩预算计算';
        }
    })();

    return (
        <span
            className={`context-usage ${className}`.trim()}
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
        >
            <button
                ref={anchorRef}
                type="button"
                className={`context-usage-button level-${level}`}
                data-testid="context-usage-indicator"
                aria-label={`上下文占用 ${percentText}，已用 ${formatTokenCount(usage.usedTokens)} / ${formatTokenCount(usage.windowTokens)}`}
                onClick={() => setOpen(value => !value)}
            >
                <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                    <circle className="context-usage-track" cx="9" cy="9" r={RADIUS} />
                    <circle
                        className="context-usage-fill"
                        cx="9"
                        cy="9"
                        r={RADIUS}
                        strokeDasharray={`${CIRCUMFERENCE * clampedRatio} ${CIRCUMFERENCE}`}
                    />
                </svg>
            </button>

            <FloatingLayer
                anchorRef={anchorRef}
                open={open}
                placement={direction}
                align="start"
                className="context-usage-panel"
                role="tooltip"
            >
                <div className="context-usage-panel-inner">
                    <div className="context-usage-headline">
                        <span className={`context-usage-percent level-${level}`}>{percentText} 已用</span>
                        <span className="context-usage-total">
                            {formatTokenCount(usage.usedTokens)} / {formatTokenCount(usage.windowTokens)}
                        </span>
                    </div>

                    <div className="context-usage-bar" aria-hidden="true">
                        {usage.segments.map(segment => (
                            <span
                                key={segment.key}
                                className={`context-usage-bar-part part-${segment.key}`}
                                style={{ width: `${Math.min(100, Math.max(0, segment.ratio * 100))}%` }}
                            />
                        ))}
                    </div>

                    <ul className="context-usage-list">
                        {usage.segments.map(segment => (
                            <li key={segment.key}>
                                <span className={`context-usage-dot part-${segment.key}`} aria-hidden="true" />
                                <span className="context-usage-label">{segment.label}</span>
                                <span className="context-usage-value">{formatTokenCount(segment.tokens)}</span>
                                <span className="context-usage-ratio">{Math.round(segment.ratio * 100)}%</span>
                            </li>
                        ))}
                    </ul>

                    {usage.fit.reason && (
                        <p className={`context-usage-alert level-${usage.fit.verdict}`}>
                            {usage.fit.reason}
                        </p>
                    )}

                    <p className="context-usage-note">
                        {basisText}。数值为字符级估算，与渠道实际计费 token 会有出入。
                    </p>
                    {usage.uncountedNotes.map(note => (
                        <p className="context-usage-note" key={note}>{note}。</p>
                    ))}
                </div>
            </FloatingLayer>
        </span>
    );
}
