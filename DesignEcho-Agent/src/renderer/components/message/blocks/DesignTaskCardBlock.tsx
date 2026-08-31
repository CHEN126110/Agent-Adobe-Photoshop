/**
 * 设计任务卡（模型写、Harness 打勾）的展示块——运行时它同时是过程流的容器。
 *
 * 形态照用户日常的任务卡 / Trae 任务列表（2026-08-18 截图）：
 *   任务标题（可展开收起）→ 两三句说明（这张图在链路里干什么 / 对产品与风格的判断）
 *   → 一列朴素的勾选项，行间细分割线。
 * 运行中：「正在做」的条目文字扫光 + 框转圈，这一段的思考 / 工具 / 快照就挂在它下面；
 *   做完的条目收成一行「N 步」可点开；立卡之前的开工步骤挂在说明与清单之间。
 * 只展示 shared 的 DesignTaskCard 与 derive/resolve 结果，不在这里重算业务状态。
 */

import { useState } from 'react';
import {
    Check,
    ChevronDown,
    ChevronRight,
    LoaderCircle,
    Minus
} from 'lucide-react';

import {
    deriveDesignTaskCompletion,
    orderDesignTaskItems,
    resolveCurrentDesignTaskItemId,
    type DesignTaskItem
} from '../../../../shared/design-task-card';
import { hasLiveActionStep, ThinkingProcess, type ThinkingStep } from '../../ThinkingProcess';
import type { DesignTaskCardBlock as DesignTaskCardBlockType } from '../types';
import './DesignTaskCardBlock.css';

interface DesignTaskCardBlockProps {
    block: DesignTaskCardBlockType;
    /** 运行中传入的实时步骤（覆盖 block.steps） */
    steps?: ThinkingStep[];
    /** 运行中：当前条目扫光、步骤默认展开 */
    live?: boolean;
}

function StatusBox({ status }: { status: DesignTaskItem['status'] }): React.ReactElement {
    switch (status) {
        case 'done':
            return (
                <span className="design-task-box design-task-box--done" aria-label="已完成">
                    <Check size={11} strokeWidth={2.6} aria-hidden="true" />
                </span>
            );
        case 'doing':
            return (
                <span className="design-task-box design-task-box--doing" aria-label="正在做">
                    <LoaderCircle size={11} strokeWidth={2.2} aria-hidden="true" />
                </span>
            );
        case 'skipped':
            return (
                <span className="design-task-box design-task-box--skipped" aria-label="略过">
                    <Minus size={11} strokeWidth={2.4} aria-hidden="true" />
                </span>
            );
        case 'todo':
        default:
            return <span className="design-task-box" aria-label="待做" />;
    }
}

/** 把过程步骤按条目归组：打了 taskItemId 的归条目；没打的（立卡前 / 实时占位步）按规则归位。 */
function groupStepsByItem(
    steps: ThinkingStep[],
    itemIds: Set<string>,
    currentItemId: string | null,
    cardCreatedAt: number,
    live: boolean
): { opening: ThinkingStep[]; byItem: Map<string, ThinkingStep[]> } {
    const opening: ThinkingStep[] = [];
    const byItem = new Map<string, ThinkingStep[]>();
    for (const step of steps) {
        let target: string | null = step.taskItemId && itemIds.has(step.taskItemId) ? step.taskItemId : null;
        // 运行中没打标但发生在立卡之后的步（如实时占位步），跟着当前条目走
        if (!target && live && currentItemId && step.timestamp >= cardCreatedAt) target = currentItemId;
        if (target) {
            const list = byItem.get(target) || [];
            list.push(step);
            byItem.set(target, list);
        } else {
            opening.push(step);
        }
    }
    return { opening, byItem };
}

function StepsFold({
    steps,
    defaultOpen,
    label
}: { steps: ThinkingStep[]; defaultOpen: boolean; label: string }): React.ReactElement | null {
    const [open, setOpen] = useState(defaultOpen);
    if (steps.length === 0) return null;
    return (
        <div className="design-task-steps-fold">
            <button
                type="button"
                className="design-task-steps-toggle"
                aria-expanded={open}
                onClick={() => setOpen((value) => !value)}
            >
                {open ? <ChevronDown size={12} strokeWidth={2} aria-hidden="true" /> : <ChevronRight size={12} strokeWidth={2} aria-hidden="true" />}
                <span>{label} · {steps.length} 步</span>
            </button>
            {open ? <ThinkingProcess steps={steps} embedded /> : null}
        </div>
    );
}

function TaskItemRow({
    item,
    steps,
    isCurrent,
    live
}: { item: DesignTaskItem; steps: ThinkingStep[]; isCurrent: boolean; live: boolean }): React.ReactElement {
    const showCount = typeof item.count === 'number' && item.count > 1;
    const active = live && isCurrent && item.status !== 'done' && item.status !== 'skipped';
    // 单一活性点：条目下面已经有一条动作行在扫光时，条目文字让出光带。
    // 两处同时扫光就是用户看到的「两个扫光效果」——同屏光带必须只有一道。
    const shimmer = active && !hasLiveActionStep(steps);
    // 正在做：过程直接展开；其它条目：有过程就收成一行「过程 · N 步」
    return (
        <li
            className={`design-task-item design-task-item--${item.status}${active ? ' is-active' : ''}`}
            data-item-id={item.id}
            data-status={item.status}
            data-kind={item.kind}
        >
            <StatusBox status={active && item.status === 'todo' ? 'doing' : item.status} />
            <div className="design-task-item-body">
                <div className="design-task-item-line">
                    <span className={`design-task-item-text${shimmer ? ' is-shimmer' : ''}`}>{item.text}</span>
                    {showCount ? (
                        <span className="design-task-item-count">{item.producedCount || 0}/{item.count}</span>
                    ) : null}
                </div>
                {item.receipt?.note ? (
                    <div className="design-task-item-receipt">{item.receipt.note}</div>
                ) : null}
                {steps.length > 0 ? (
                    active
                        ? <div className="design-task-item-steps"><ThinkingProcess steps={steps} embedded /></div>
                        : <StepsFold steps={steps} defaultOpen={false} label="过程" />
                ) : null}
            </div>
        </li>
    );
}

export function DesignTaskCardBlock({ block, steps: liveSteps, live = false }: DesignTaskCardBlockProps): React.ReactElement {
    const { card } = block;
    const [expanded, setExpanded] = useState(true);
    const completion = deriveDesignTaskCompletion(card);
    const items = orderDesignTaskItems(card);
    const currentItemId = live ? resolveCurrentDesignTaskItemId(card) : null;
    const steps = liveSteps || block.steps || [];
    const { opening, byItem } = groupStepsByItem(
        steps,
        new Set(items.map((item) => item.id)),
        currentItemId,
        card.createdAt,
        live
    );
    const ChevronIcon = expanded ? ChevronDown : ChevronRight;
    const currentItem = currentItemId ? items.find((item) => item.id === currentItemId) : undefined;
    const currentItemActive = Boolean(
        live && currentItem && currentItem.status !== 'done' && currentItem.status !== 'skipped'
    );
    // 开工过程只在还没进入任何条目时默认摊开：进了条目就该由条目那一段承载过程。
    const openingOpenByDefault = live && byItem.size === 0;
    // 卡体里已经有活性点（当前条目文字或它下面的动作行）时，标题不再扫光：
    // 标题扫光只负责「卡刚立起来、还没有任何一段过程可看」这一小段空窗。
    const bodyOwnsShimmer = expanded && (
        currentItemActive || (openingOpenByDefault && hasLiveActionStep(opening))
    );
    const headActive = live && !completion.complete && !bodyOwnsShimmer;

    return (
        <section
            className={`message-block design-task-card${completion.complete ? ' design-task-card--complete' : ''}${live ? ' design-task-card--live' : ''}`}
            data-testid="design-task-card"
            data-card-id={card.id}
            aria-label={`任务卡：${card.title}`}
            aria-live="polite"
        >
            <button
                type="button"
                className="design-task-card-head"
                aria-expanded={expanded}
                onClick={() => setExpanded((value) => !value)}
            >
                <ChevronIcon className="design-task-card-chevron" size={14} strokeWidth={2} aria-hidden="true" />
                <span className={`design-task-card-title${headActive ? ' is-shimmer' : ''}`}>{card.title}</span>
                <span className="design-task-card-progress" title={completion.summary}>
                    {completion.complete ? <Check size={12} strokeWidth={2.4} aria-hidden="true" /> : null}
                    {completion.doneCount}/{items.length}
                </span>
            </button>

            {expanded ? (
                <div className="design-task-card-body">
                    <div className="design-task-card-brief">
                        <p className="design-task-card-brief-line">{card.role}</p>
                        <p className="design-task-card-brief-line">{card.judgment}</p>
                    </div>
                    {opening.length > 0 ? (
                        <div className="design-task-opening">
                            <StepsFold steps={opening} defaultOpen={openingOpenByDefault} label="开工" />
                        </div>
                    ) : null}
                    <ol className="design-task-items">
                        {items.map((item) => (
                            <TaskItemRow
                                key={item.id}
                                item={item}
                                steps={byItem.get(item.id) || []}
                                isCurrent={item.id === currentItemId}
                                live={live}
                            />
                        ))}
                    </ol>
                    {card.evaluation ? (
                        <p className="design-task-card-evaluation">{card.evaluation}</p>
                    ) : null}
                </div>
            ) : null}
        </section>
    );
}
