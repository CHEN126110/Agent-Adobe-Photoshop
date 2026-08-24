/**
 * 「设计过程」块：折叠头 + 展开后的过程时间线。
 *
 * 展开内容直接复用运行中同一套 ThinkingProcess 时间线（快照缩略图、结果摘要、
 * 可展开的结果预览、重复动作合并全部保留）。此前这里维护过一份平行的简化列表，
 * 它不渲染画面快照、结果摘要也被折在小按钮后——对话一完成/停止，用户在运行中
 * 看到的细节就全部消失。终态与运行中必须是同一份数据、同一套渲染。
 */

import React, { useEffect, useRef, useState } from 'react';
import type { ThinkingBlock as ThinkingBlockType } from '../types';
import { ThinkingProcess } from '../../ThinkingProcess';
import { cleanInlineProcessText } from '../thinkingStepPresentation';

interface ThinkingBlockProps {
    block: ThinkingBlockType;
    collapseForTerminalState?: boolean;
}

/** 折叠头右侧的用时文案（Codex 的「Thought for 8s」）。不足 1 秒不显示，免得全是「0 秒」噪音。 */
function formatThinkingDuration(ms?: number): string {
    if (!Number.isFinite(ms) || !ms || ms < 1000) return '';
    const totalSeconds = Math.round(ms / 1000);
    if (totalSeconds < 60) return `${totalSeconds} 秒`;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分钟`;
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
    const stepCount = block.sourceSteps.length;
    useEffect(() => {
        if (!isRunning || !isExpanded || userToggledRef.current) return;
        const container = stepsContainerRef.current;
        if (!container) return;
        container.scrollTop = container.scrollHeight;
    }, [isRunning, isExpanded, stepCount]);

    if (block.sourceSteps.length === 0) return null;

    const hasError = block.sourceSteps.some((step) => step.status === 'error');
    const latestDecision = [...block.sourceSteps].reverse().find((step) => (
        step.type === 'decision' && !step.toolName
    ));
    const decisionSummary = latestDecision
        ? cleanInlineProcessText(latestDecision.content).replace(/\s+/g, ' ').trim().slice(0, 56)
        : '';
    // 头部右侧元信息：让折叠的一行也能回答「这轮做了多少事、花了多久」。
    const durationText = formatThinkingDuration(block.totalDuration);
    const metaText = [`${stepCount} 步`, durationText].filter(Boolean).join(' · ');

    return (
        <div className={`message-block thinking-block ${hasError ? 'has-error' : ''} ${isRunning ? 'is-running' : 'is-terminal'}`}>
            {/* 整行是折叠开关：此前是只带 onClick 的 div，里面再套一个无标签 button，
                键盘用户展不开、读屏也读不出展开状态。语义收到这一行上，箭头退回装饰件。 */}
            <div
                className="thinking-header"
                role="button"
                tabIndex={0}
                aria-expanded={isExpanded}
                aria-label={`${isExpanded ? '收起' : '展开'}${block.title || '设计过程'}，共 ${metaText}`}
                onClick={() => {
                    userToggledRef.current = true;
                    setIsExpanded(!isExpanded);
                }}
                onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    userToggledRef.current = true;
                    setIsExpanded(!isExpanded);
                }}
            >
                <div className="thinking-summary">
                    <span className="thinking-dot"></span>
                    <span className="thinking-label">
                        {block.title || '设计过程'}
                        {!isExpanded && decisionSummary ? ` · ${decisionSummary}` : ''}
                    </span>
                </div>
                <span className="thinking-meta">{metaText}</span>
                <span className="expand-toggle" aria-hidden="true">
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
                </span>
            </div>

            {isExpanded && (
                <div className="thinking-steps" ref={stepsContainerRef}>
                    <ThinkingProcess steps={block.sourceSteps} embedded />
                </div>
            )}
        </div>
    );
};

export default ThinkingBlock;
