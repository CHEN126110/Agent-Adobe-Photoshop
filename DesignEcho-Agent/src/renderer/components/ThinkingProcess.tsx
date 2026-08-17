import React, { useState } from 'react';
import './ThinkingProcess.css';
import { ImageZoomOverlay } from './ImageZoomOverlay';
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

/**
 * 面板是否还有步骤在跑。
 *
 * 标题文案、标题扫光、状态点呼吸三处都按这一个判据走：口径散在各处迟早会出现
 * 「标题写着设计过程、点还在亮蓝呼吸」这种自相矛盾的状态。
 */
function hasActiveThinkingStep(panelSteps: ThinkingStep[]): boolean {
    return panelSteps.some((step) => step.status === 'running' || step.status === 'pending');
}

function resolveThinkingPanelTitle(panelSteps: ThinkingStep[]): string {
    return hasActiveThinkingStep(panelSteps) ? '正在设计' : '设计过程';
}

/** 步骤快照的图片源：Agent 回传的可能是完整 data URL，也可能是裸 base64 */
function resolveSnapshotSrc(imageData: string): string {
    return imageData.startsWith('data:') ? imageData : `data:image/jpeg;base64,${imageData}`;
}

/** 快照缩略图在固定槽位里的呈现方式。槽位尺寸恒定，形态差异全部由这里吸收。 */
export interface SnapshotDisplayMode {
    /** 传给 CSS object-fit：contain 保全貌但会留白，cover 铺满但会裁掉画面 */
    objectFit: 'contain' | 'cover';
    /** 传给 CSS object-position：决定被裁时保留画面的哪一部分 */
    objectPosition: string;
    /** 右下角角标文案；返回空串表示这张图不需要额外说明 */
    badge: string;
}

/**
 * 按画面真实像素比例决定缩略图怎么放进 4:3 的固定槽位。
 *
 * ratio = 宽 / 高。真机会同时出现两种极端：详情页 psb 约 0.05（1:19 的超长竖图）、
 * 主图画布 1.0（正方）。槽位不能再跟着比例变形，所以差异必须在这里收敛。
 */
function resolveSnapshotDisplayMode(ratio: number): SnapshotDisplayMode {
    if (!Number.isFinite(ratio) || ratio <= 0) {
        return { objectFit: 'contain', objectPosition: 'center', badge: '' };
    }
    // 超长竖图（详情页 psb 实测约 1:19）：contain 会把它缩成框里几像素宽的一根线，
    // 既看不出画面、又让整条步骤显得空。铺满槽位并保留顶部——详情页首屏是信息
    // 密度最高的一段，也最能让用户认出「Agent 看的是哪份稿子」。
    if (ratio < 0.5) {
        return {
            objectFit: 'cover',
            objectPosition: 'center top',
            badge: `长图 1:${Math.round(1 / ratio)} · 点开看全图`
        };
    }
    // 超宽横图同理，保留左端起始处（横向版面的阅读起点）。
    if (ratio > 3) {
        return {
            objectFit: 'cover',
            objectPosition: 'left center',
            badge: `宽图 ${Math.round(ratio)}:1 · 点开看全图`
        };
    }
    // 与槽位比例接近的画面（含 800×800 的 SKU 画布）两种 fit 观感差别很小，
    // 保留 contain 的完整画面；也不挂角标——每张图都带标签只会变成噪音。
    return { objectFit: 'contain', objectPosition: 'center', badge: '' };
}

export const ThinkingProcess: React.FC<ThinkingProcessProps> = ({
    steps,
    className = ''
}) => {
    // 已展开步骤（看"已查看/已读取"的具体内容）；默认收起，保持过程面板清爽。
    const [expandedStepIds, setExpandedStepIds] = useState<Record<string, boolean>>({});
    // 正在看大图的那张画面快照；null 表示没打开预览
    const [zoomedSnapshot, setZoomedSnapshot] = useState<{ src: string; alt: string } | null>(null);
    // 各步骤快照的真实宽高比（宽/高），由图片 onLoad 后的 naturalWidth/Height 得到。
    // data URL 在解码前拿不到尺寸，所以先按 contain 渲染，量到之后再切换到最终呈现方式。
    const [snapshotRatios, setSnapshotRatios] = useState<Record<string, number>>({});
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

    const openSnapshot = (src: string, alt: string): void => {
        setZoomedSnapshot({ src, alt });
    };

    const renderStepPanel = (title: string, panelSteps: ThinkingStep[]) => panelSteps.length > 0 ? (
        <div className={`thinking-simple ${className}`}>
            <div className="pondering-header">
                {/* 状态点进行中才亮蓝呼吸（样式钩子 is-active），与对话标签页的执行指示点同一套观感 */}
                <span className={`pondering-dot ${hasActiveThinkingStep(panelSteps) ? 'is-active' : ''}`}></span>
                {/* 标题在进行中才带扫光（样式钩子 is-active）：强调留给整体状态这一行，
                    下面的明细列表保持静态，否则满屏都在动反而没有重点。 */}
                <span className={`pondering-title ${hasActiveThinkingStep(panelSteps) ? 'is-active' : ''}`}>
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
                    const snapshotSrc = step.imageData ? resolveSnapshotSrc(step.imageData) : '';
                    // 还没量到比例时按 contain 保守渲染：宁可留白，也不要在不知道画面
                    // 长什么样的时候先裁一刀。
                    const snapshotRatio = snapshotRatios[step.id];
                    const snapshotMode = snapshotRatio
                        ? resolveSnapshotDisplayMode(snapshotRatio)
                        : { objectFit: 'contain' as const, objectPosition: 'center', badge: '' };
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
                            {snapshotSrc && (
                                /* 缩略图只有 220px 宽，看不清 Agent 到底看到了什么，点开看大图。
                                   外框定版位，图片按量到的比例决定怎么放进去。 */
                                <div
                                    className="step-snapshot-frame"
                                    role="button"
                                    tabIndex={0}
                                    title={snapshotMode.badge
                                        ? `${snapshotMode.badge}，点击查看完整画面`
                                        : '点击查看大图'}
                                    aria-label={`${getStepText(step)}${snapshotMode.badge ? `（${snapshotMode.badge}）` : ''}，点击查看大图`}
                                    onClick={() => openSnapshot(snapshotSrc, getStepText(step))}
                                    onKeyDown={(event) => {
                                        if (event.key !== 'Enter' && event.key !== ' ') return;
                                        event.preventDefault();
                                        openSnapshot(snapshotSrc, getStepText(step));
                                    }}
                                >
                                    <img
                                        className="step-snapshot"
                                        src={snapshotSrc}
                                        alt={getStepText(step)}
                                        loading="lazy"
                                        style={{
                                            objectFit: snapshotMode.objectFit,
                                            objectPosition: snapshotMode.objectPosition
                                        }}
                                        onLoad={(event) => {
                                            const image = event.currentTarget;
                                            if (!image.naturalWidth || !image.naturalHeight) return;
                                            const ratio = image.naturalWidth / image.naturalHeight;
                                            setSnapshotRatios((current) => (
                                                current[step.id] === ratio
                                                    ? current
                                                    : { ...current, [step.id]: ratio }
                                            ));
                                        }}
                                    />
                                    {snapshotMode.badge && (
                                        <span className="step-snapshot-badge">{snapshotMode.badge}</span>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    ) : null;

    // 按原始时间顺序交替渲染：思考片段 → 它触发的工具 → 下一段思考 → 工具……（像 Claude 那样想一步做一步），
    // 而不是把思考全堆成一组、工具全堆成一组（旧版分两个面板渲染，导致思考和动作割裂、对不上）。
    return (
        <>
            {renderStepPanel(resolveThinkingPanelTitle(validSteps), validSteps)}
            {zoomedSnapshot && (
                <ImageZoomOverlay
                    src={zoomedSnapshot.src}
                    alt={zoomedSnapshot.alt}
                    onClose={() => setZoomedSnapshot(null)}
                />
            )}
        </>
    );
};

export default ThinkingProcess;
