import React from 'react';
import type { InteractiveCardDefinition } from '../../../../shared/interactive-card-contract';
import type { TaskContextCardItemView, TaskContextCardPayload } from '../../../../shared/design-intelligence/task-context-card';

interface TaskContextCardViewProps {
    block: { sourceMessageId?: string };
    card: InteractiveCardDefinition<TaskContextCardPayload>;
    onAction?: (actionId: string, params?: Record<string, any>) => void;
}

function renderItems(title: string, items: TaskContextCardItemView[]): React.ReactElement | null {
    if (!items || items.length === 0) return null;
    return (
        <div className="task-context-section">
            <div className="task-context-section-title">{title}</div>
            <ul className="task-context-items">
                {items.map((item) => (
                    <li
                        key={`${item.resourceType}:${item.resourceId}`}
                        className={`task-context-item${item.pinned ? ' is-pinned' : ''}`}
                    >
                        <span className="task-context-item-reason">
                            <strong>{item.title || item.reason}</strong>
                            {item.excerpt && <span>{item.excerpt}</span>}
                            {item.reason && item.reason !== item.title && <small>加入原因：{item.reason}</small>}
                        </span>
                        <span className="task-context-item-meta">
                            {item.sourceLabel || (item.pinned ? '用户固定' : '任务上下文')}
                        </span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

export function TaskContextCardView({ card }: TaskContextCardViewProps): React.ReactElement {
    const payload = card.payload;
    return (
        <div className="message-block interactive-card-block task-context-card">
            <div className="interactive-card-header">
                <div>
                    <div className="interactive-card-title">{card.title}</div>
                    {card.description && (
                        <div className="interactive-card-description">{card.description}</div>
                    )}
                </div>
            </div>
            <div className="task-context-body">
                {renderItems('硬约束', payload.hardConstraints)}
                {renderItems('用户固定', payload.pinned)}
                {renderItems('检索知识', payload.retrievedKnowledge)}
                {renderItems('视觉参考', payload.visualReferences)}
                {renderItems('项目状态', payload.projectStateRefs)}
            </div>
        </div>
    );
}
