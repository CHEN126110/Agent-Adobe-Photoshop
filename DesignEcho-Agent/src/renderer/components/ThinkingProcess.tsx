import React, { useState } from 'react';
import { ChevronDown, FileSearch, Images, SquareTerminal } from 'lucide-react';
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
    /** 这一步发生时任务卡上「正在做」的条目 id（Harness 记录时打上），界面据此把过程挂到条目下。 */
    taskItemId?: string;
}

interface ThinkingProcessProps {
    steps: ThinkingStep[];
    isExpanded?: boolean;
    onToggle?: () => void;
    className?: string;
    /** 嵌在任务卡条目下时：不画外框与「正在设计」标题，只出步骤时间线。 */
    embedded?: boolean;
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

/** 连着重复的同一动作合并后的一组：key 取组内第一条（流式追加时不变），step 取最后一条（结果最新）。 */
interface MergedThinkingStep {
    key: string;
    step: ThinkingStep;
    repeat: number;
    /** 跨工具的类别聚合组（codex 化 P1.75）：members 为组内全部步骤，展开时逐条显示。 */
    members?: ThinkingStep[];
    aggregateLabel?: string;
}

/**
 * 工具的语义类别（品类无关，只按动作性质分）：连续同类的成功小动作聚合成一句人话，
 * 展开才看明细——这是 codex 过程流"清爽"的来源（对照板 P1.75）。
 * 失败步、带画面快照的步、有关键结果摘要的步一律不聚合（防吞纪律沿用）。
 */
type ToolAggregateCategory = 'look' | 'read' | 'none';

function resolveToolAggregateCategory(toolName: string | undefined): ToolAggregateCategory {
    const name = String(toolName || '');
    if (!name) return 'none';
    if (/Snapshot|snapshot|observe|describeImage|analyzeAsset|Preview/.test(name)) return 'look';
    if (/^(get|list|search|read|find)/.test(name)) return 'read';
    return 'none';
}

function buildAggregateLabel(category: ToolAggregateCategory, count: number): string {
    if (category === 'look') return `查看了 ${count} 张画面`;
    return `读取了 ${count} 项信息`;
}

/**
 * 把相邻的同一个动作合并成一条，右侧标次数。
 *
 * 真机 2026-08-19「帮我做白底图」13 步里连着 3 条「变换图层」、2 条「读取图层属性」：
 * 逐条列出既读不出信息量，还让人以为它卡在原地重复劳动。
 *
 * 合并条件收得很紧——只合「相邻 + 同工具 + 都成功 + 都没带快照」：
 * 带快照的每一张都是新画面，失败的每一条原因可能不同，思考步各说各的，都不能吞。
 */
function mergeRepeatedSteps(steps: ThinkingStep[]): MergedThinkingStep[] {
    const merged: MergedThinkingStep[] = [];
    for (const step of steps) {
        const previous = merged[merged.length - 1];
        const mergeable = Boolean(
            previous
            && isActionStep(step)
            && isActionStep(previous.step)
            && step.status === 'success'
            && previous.step.status === 'success'
            && step.toolName
            && previous.step.toolName === step.toolName
            && !step.imageData
            && !previous.step.imageData
        );
        if (mergeable && previous) {
            // 展示改用最新一条：用户点开要看的是这批动作最后落到什么结果
            previous.step = step;
            previous.repeat += 1;
            continue;
        }
        merged.push({ key: step.id, step, repeat: 1 });
    }
    return applyCategoryAggregation(merged);
}

/**
 * 第二级聚合（codex 化）：相邻的不同工具、但同一语义类别的成功小动作，
 * 收成一条「查看了 N 张画面 / 读取了 N 项信息」，展开显示逐条明细。
 * 只聚 2 条以上；带快照 / 失败 / 运行中的步骤保持独立不吞。
 */
function applyCategoryAggregation(merged: MergedThinkingStep[]): MergedThinkingStep[] {
    const out: MergedThinkingStep[] = [];
    let bucket: MergedThinkingStep[] = [];
    let bucketCategory: ToolAggregateCategory = 'none';

    const flush = (): void => {
        if (bucket.length >= 2) {
            const count = bucket.reduce((sum, item) => sum + item.repeat, 0);
            out.push({
                key: `agg-${bucket[0].key}`,
                step: bucket[bucket.length - 1].step,
                repeat: count,
                members: bucket.map((item) => item.step),
                aggregateLabel: buildAggregateLabel(bucketCategory, count)
            });
        } else if (bucket.length === 1) {
            out.push(bucket[0]);
        }
        bucket = [];
        bucketCategory = 'none';
    };

    for (const item of merged) {
        const { step } = item;
        const category = isActionStep(step) && step.status === 'success' && !step.imageData
            ? resolveToolAggregateCategory(step.toolName)
            : 'none';
        if (category !== 'none' && (bucket.length === 0 || category === bucketCategory)) {
            bucketCategory = category;
            bucket.push(item);
            continue;
        }
        flush();
        if (category !== 'none') {
            bucketCategory = category;
            bucket.push(item);
        } else {
            out.push(item);
        }
    }
    flush();
    return out;
}

function getDisplayRole(step: ThinkingStep): ThinkingStepDisplayRole {
    return resolveThinkingStepDisplayRole({
        type: step.type,
        toolName: step.toolName,
        tone: isActionStep(step) ? 'action' : 'thought'
    });
}

function getActionStateLabel(step: ThinkingStep): string {
    if (step.status === 'error') return '运行失败';
    if (step.status === 'running' || step.status === 'pending') return '正在运行';
    return '已运行';
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
    className = '',
    embedded = false
}) => {
    // 已展开步骤（看"已查看/已读取"的具体内容）；默认收起，保持过程面板清爽。
    const [expandedStepIds, setExpandedStepIds] = useState<Record<string, boolean>>({});
    // codex 式耗时头：进行中每秒跳动，跳动的时间本身就是活性信号（替代「正在设计」标题与状态点）。
    const [nowTick, setNowTick] = useState(() => Date.now());
    const anyActive = hasActiveThinkingStep(steps);
    React.useEffect(() => {
        if (!anyActive) return undefined;
        const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [anyActive]);
    // 正在看大图的那张画面快照；null 表示没打开预览
    const [zoomedSnapshot, setZoomedSnapshot] = useState<{ src: string; alt: string } | null>(null);
    // 各步骤快照的真实宽高比（宽/高），由图片 onLoad 后的 naturalWidth/Height 得到。
    // data URL 在解码前拿不到尺寸，所以先按 contain 渲染，量到之后再切换到最终呈现方式。
    const [snapshotRatios, setSnapshotRatios] = useState<Record<string, number>>({});
    // 文案为空但带 toolName 的步骤仍然显示：getStepText 会回退到工具显示名。
    // 终态「设计过程」块也走这条时间线，这类步骤不能因为没配文案就凭空消失。
    const validSteps = steps.filter((step) =>
        VISIBLE_STEP_TYPES.has(step.type)
        && (
            (typeof step.content === 'string' && step.content.trim().length > 0)
            || Boolean(step.toolName)
        )
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

    const formatElapsed = (panelSteps: ThinkingStep[]): string => {
        const first = panelSteps[0]?.timestamp;
        if (!first) return '';
        const last = hasActiveThinkingStep(panelSteps)
            ? nowTick
            : Math.max(...panelSteps.map((step) => step.timestamp));
        const totalSeconds = Math.max(0, Math.round((last - first) / 1000));
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return minutes > 0 ? `已处理 ${minutes}分${String(seconds).padStart(2, '0')}秒` : `已处理 ${seconds}秒`;
    };

    // 2026-08-25 codex 化：面板不再有「正在设计」标题与状态点——codex 的顶部只是一行
    // 耗时（进行中每秒跳动即活性信号），内容本身（模型叙事与动作行）就是过程。
    const renderStepPanel = (_title: string, panelSteps: ThinkingStep[]) => panelSteps.length > 0 ? (
        <div className={`${embedded ? 'thinking-embedded' : 'thinking-simple'} ${className}`}>
            {!embedded && (
                <div className="pondering-elapsed">{formatElapsed(panelSteps)}</div>
            )}

            <div className="pondering-steps">
                {(() => {
                    const mergedSteps = mergeRepeatedSteps(panelSteps);
                    // 单一活性点原则（codex 铁律）：任意时刻至多一处扫光/旋转——只有最末一条
                    // 进行中的「动作行」是「当前活动」；其余进行中的行静态染色即可，满屏多处动效没有重点。
                    // 正文/思考行（is-thought）永不参与活性点：codex 里正文段落从不扫光，
                    // 流式文字的出现本身与顶部计时头就是活性信号，扫光只属于动作行。
                    let liveKey = '';
                    for (const item of mergedSteps) {
                        const actsLikeTool = isActionStep(item.step) || getDisplayRole(item.step) === 'action';
                        if (actsLikeTool && (item.step.status === 'running' || item.step.status === 'pending')) liveKey = item.key;
                    }
                    return mergedSteps.map(({ key: stepKey, step, repeat, members, aggregateLabel }) => {
                        const liveClass = stepKey === liveKey ? 'is-live' : '';
                    // 类别聚合组：状态行始终可见，逐条明细默认收起。
                    if (aggregateLabel && members) {
                        const expanded = Boolean(expandedStepIds[stepKey]);
                        const AggIcon = aggregateLabel.startsWith('查看') ? Images : FileSearch;
                        return (
                            <div key={stepKey} className="pondering-step success is-action pondering-aggregate">
                                <div className="step-body">
                                    <button
                                        type="button"
                                        className={`step-action-toggle ${expanded ? 'is-expanded' : ''}`}
                                        aria-expanded={expanded}
                                        aria-label={`${expanded ? '收起' : '展开'}${aggregateLabel}的逐条明细`}
                                        onClick={() => toggleStepExpanded(stepKey)}
                                    >
                                        <AggIcon size={13} strokeWidth={1.9} className="step-action-icon" aria-hidden="true" />
                                        <span className="step-action-state">已运行</span>
                                        <span className="step-action-name">{aggregateLabel}</span>
                                        <ChevronDown size={12} strokeWidth={2.2} className="step-action-chevron" aria-hidden="true" />
                                    </button>
                                    {expanded && (
                                        <ul className="agg-members">
                                            {members.map((member) => (
                                                <li key={member.id}>
                                                    <span>{member.toolName ? getToolDisplayInfo(member.toolName).name : cleanInlineProcessText(member.content)}</span>
                                                    {typeof member.duration === 'number' && member.duration > 0 && (
                                                        <span className="agg-duration">{(member.duration / 1000).toFixed(1)}s</span>
                                                    )}
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            </div>
                        );
                    }
                    const displayRole = getDisplayRole(step);
                    const isTool = isActionStep(step) || displayRole === 'action';
                    const semanticLabel = isTool
                        ? getActionStateLabel(step)
                        : resolveThinkingStepRoleLabel(displayRole, step.type);
                    const preview = isTool && step.toolName
                        ? buildToolResultPreview(step.toolName, step.toolResult)
                        : undefined;
                    const expanded = Boolean(expandedStepIds[stepKey]);
                    const snapshotSrc = step.imageData ? resolveSnapshotSrc(step.imageData) : '';
                    // 还没量到比例时按 contain 保守渲染：宁可留白，也不要在不知道画面
                    // 长什么样的时候先裁一刀。
                    const snapshotRatio = snapshotRatios[stepKey];
                    const snapshotMode = snapshotRatio
                        ? resolveSnapshotDisplayMode(snapshotRatio)
                        : { objectFit: 'contain' as const, objectPosition: 'center', badge: '' };
                    if (isTool) {
                        const toolInfo = getToolDisplayInfo(step.toolName || '');
                        return (
                            <div
                                key={stepKey}
                                className={`pondering-step ${step.status} ${liveClass} is-action pondering-step--${displayRole}`}
                            >
                                <div className="step-body">
                                    <button
                                        type="button"
                                        className={`step-action-toggle ${expanded ? 'is-expanded' : ''}`}
                                        aria-expanded={expanded}
                                        aria-label={`${expanded ? '收起' : '展开'}${getStepText(step)}的运行详情`}
                                        onClick={() => toggleStepExpanded(stepKey)}
                                    >
                                        <SquareTerminal size={13} strokeWidth={1.8} className="step-action-icon" aria-hidden="true" />
                                        <span className="step-action-state">{getActionStateLabel(step)}</span>
                                        <span className="step-action-name">{getStepText(step)}</span>
                                        {repeat > 1 && (
                                            <span className="step-repeat" aria-label={`连续 ${repeat} 次`}>×{repeat}</span>
                                        )}
                                        <ChevronDown size={12} strokeWidth={2.2} className="step-action-chevron" aria-hidden="true" />
                                    </button>

                                    {expanded && (
                                        <div className="step-action-details" data-testid="step-action-details">
                                            {toolInfo.description && (
                                                <p className="step-action-description">{toolInfo.description}</p>
                                            )}
                                            {preview?.summary && (
                                                <span className="step-summary">{preview.summary}</span>
                                            )}
                                            {preview && preview.sections.length > 0 && (
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
                                            {typeof step.duration === 'number' && step.duration > 0 && (
                                                <span className="step-action-duration">用时 {(step.duration / 1000).toFixed(1)} 秒</span>
                                            )}
                                            {snapshotSrc && (
                                                <button
                                                    type="button"
                                                    className="step-snapshot-frame"
                                                    title={snapshotMode.badge
                                                        ? `${snapshotMode.badge}，点击查看完整画面`
                                                        : '点击查看大图'}
                                                    aria-label={`${getStepText(step)}${snapshotMode.badge ? `（${snapshotMode.badge}）` : ''}，点击查看大图`}
                                                    onClick={() => openSnapshot(snapshotSrc, getStepText(step))}
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
                                                                current[stepKey] === ratio
                                                                    ? current
                                                                    : { ...current, [stepKey]: ratio }
                                                            ));
                                                        }}
                                                    />
                                                    {snapshotMode.badge && (
                                                        <span className="step-snapshot-badge">{snapshotMode.badge}</span>
                                                    )}
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    }

                    return (
                        <div
                            key={stepKey}
                            className={`pondering-step ${step.status} ${liveClass} is-thought pondering-step--${displayRole}`}
                            title={semanticLabel}
                        >
                            <div className="step-body">
                                <div className="step-line">
                                    <span className="step-text">{getStepText(step)}</span>
                                </div>
                            </div>
                            {snapshotSrc && (
                                <button
                                    type="button"
                                    className="step-snapshot-frame"
                                    title={snapshotMode.badge
                                        ? `${snapshotMode.badge}，点击查看完整画面`
                                        : '点击查看大图'}
                                    aria-label={`${getStepText(step)}${snapshotMode.badge ? `（${snapshotMode.badge}）` : ''}，点击查看大图`}
                                    onClick={() => openSnapshot(snapshotSrc, getStepText(step))}
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
                                                current[stepKey] === ratio
                                                    ? current
                                                    : { ...current, [stepKey]: ratio }
                                            ));
                                        }}
                                    />
                                    {snapshotMode.badge && (
                                        <span className="step-snapshot-badge">{snapshotMode.badge}</span>
                                    )}
                                </button>
                            )}
                        </div>
                    );
                    });
                })()}
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
