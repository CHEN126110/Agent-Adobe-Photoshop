import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, History, MessageSquarePlus, Pencil, Search, X } from 'lucide-react';

import { FloatingLayer } from './FloatingLayer';

import './ConversationManager.css';

export interface ConversationManagerConversation {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    messages: Array<{
        content?: string;
    }>;
}

interface ConversationManagerProps {
    conversations: ConversationManagerConversation[];
    currentConversationId: string | null;
    isBusy: boolean;
    onCreateConversation: () => void;
    onDeleteConversation: (conversationId: string) => void;
    onRenameConversation: (conversationId: string, title: string) => void;
    onReorderConversations: (orderedIds: string[]) => void;
    onSwitchConversation: (conversationId: string) => void;
    /**
     * 切换当前会话会替换 Composer 的本地草稿；由 ChatPanel 判断是否应提示用户确认。
     */
    onBeforeActiveConversationChange: (actionLabel: string) => boolean;
}

type ConversationDropPlacement = 'before' | 'after';

interface ConversationDropTarget {
    conversationId: string;
    placement: ConversationDropPlacement;
}

function normalizeConversationTitle(value: string): string {
    return value.trim().replace(/\s+/gu, ' ');
}

function getConversationTitle(conversation: ConversationManagerConversation): string {
    return normalizeConversationTitle(conversation.title) || '未命名对话';
}

function getLastConversationPreview(conversation: ConversationManagerConversation): string {
    const latestMessage = conversation.messages[conversation.messages.length - 1];
    const content = typeof latestMessage?.content === 'string'
        ? latestMessage.content.replace(/\s+/gu, ' ').trim()
        : '';
    return content || '尚未开始对话';
}

function sortConversationsByRecency(conversations: ConversationManagerConversation[]): ConversationManagerConversation[] {
    return [...conversations].sort((left, right) => {
        const difference = right.updatedAt - left.updatedAt;
        if (difference !== 0) return difference;
        return right.createdAt - left.createdAt;
    });
}

function moveConversationId(
    conversationIds: string[],
    sourceId: string,
    targetId: string,
    placement: ConversationDropPlacement
): string[] {
    if (sourceId === targetId) return conversationIds;

    const sourceIndex = conversationIds.indexOf(sourceId);
    const targetIndex = conversationIds.indexOf(targetId);
    if (sourceIndex < 0 || targetIndex < 0) return conversationIds;

    const nextIds = conversationIds.filter((conversationId) => conversationId !== sourceId);
    const targetIndexAfterRemoval = nextIds.indexOf(targetId);
    const insertionIndex = placement === 'after'
        ? targetIndexAfterRemoval + 1
        : targetIndexAfterRemoval;
    nextIds.splice(insertionIndex, 0, sourceId);
    return nextIds;
}

function formatConversationUpdatedAt(timestamp: number): string {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '未知时间';

    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) {
        return new Intl.DateTimeFormat('zh-CN', {
            hour: '2-digit',
            minute: '2-digit'
        }).format(date);
    }

    return new Intl.DateTimeFormat('zh-CN', {
        month: 'numeric',
        day: 'numeric'
    }).format(date);
}

function conversationMatchesQuery(conversation: ConversationManagerConversation, query: string): boolean {
    if (!query) return true;
    const haystack = [
        getConversationTitle(conversation),
        getLastConversationPreview(conversation)
    ].join(' ').toLocaleLowerCase('zh-CN');
    return haystack.includes(query.toLocaleLowerCase('zh-CN'));
}

export function ConversationManager({
    conversations,
    currentConversationId,
    isBusy,
    onCreateConversation,
    onDeleteConversation,
    onRenameConversation,
    onReorderConversations,
    onSwitchConversation,
    onBeforeActiveConversationChange
}: ConversationManagerProps): React.ReactElement {
    const [historyOpen, setHistoryOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [renamingConversationId, setRenamingConversationId] = useState<string | null>(null);
    const [titleDraft, setTitleDraft] = useState('');
    const [draggedConversationId, setDraggedConversationId] = useState<string | null>(null);
    const [dropTarget, setDropTarget] = useState<ConversationDropTarget | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const historyTriggerRef = useRef<HTMLButtonElement>(null);
    const historySearchRef = useRef<HTMLInputElement>(null);
    const tabRefs = useRef(new Map<string, HTMLDivElement>());

    const orderedConversations = useMemo(
        () => sortConversationsByRecency(conversations),
        [conversations]
    );
    const conversationIds = useMemo(
        () => conversations.map((conversation) => conversation.id),
        [conversations]
    );
    const filteredHistory = useMemo(
        () => orderedConversations.filter((conversation) => conversationMatchesQuery(conversation, query.trim())),
        [orderedConversations, query]
    );

    const closeHistory = useCallback((): void => {
        setHistoryOpen(false);
        setQuery('');
        setRenamingConversationId(null);
        setTitleDraft('');
    }, []);

    useEffect(() => {
        if (!historyOpen) return;
        historySearchRef.current?.focus();
    }, [historyOpen]);

    useEffect(() => {
        if (!currentConversationId) return;
        tabRefs.current.get(currentConversationId)?.scrollIntoView({
            behavior: 'auto',
            block: 'nearest',
            inline: 'nearest'
        });
    }, [currentConversationId]);

    useEffect(() => {
        if (!historyOpen) return;

        function handlePointerDown(event: MouseEvent): void {
            const target = event.target as Element | null;
            if (rootRef.current?.contains(target as Node)) return;
            if (target?.closest?.('.conversation-history-popover')) return;
            closeHistory();
        }

        document.addEventListener('mousedown', handlePointerDown);
        return () => document.removeEventListener('mousedown', handlePointerDown);
    }, [closeHistory, historyOpen]);

    function handleCreate(): void {
        if (isBusy) return;
        if (!onBeforeActiveConversationChange('新建对话')) return;
        closeHistory();
        onCreateConversation();
    }

    function handleSwitch(conversationId: string): void {
        if (isBusy || conversationId === currentConversationId) return;
        if (!onBeforeActiveConversationChange('切换对话')) return;
        closeHistory();
        onSwitchConversation(conversationId);
    }

    function handleDelete(conversationId: string): void {
        if (isBusy || conversations.length <= 1) return;

        if (conversationId === currentConversationId) {
            const nextConversation = orderedConversations.find((conversation) => conversation.id !== conversationId);
            if (!nextConversation) return;
            if (!onBeforeActiveConversationChange('关闭当前对话并切换')) return;
            onSwitchConversation(nextConversation.id);
        }

        onDeleteConversation(conversationId);
    }

    function handleDragStart(event: React.DragEvent<HTMLDivElement>, conversationId: string): void {
        if (isBusy) {
            event.preventDefault();
            return;
        }

        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', conversationId);
        setDraggedConversationId(conversationId);
        setDropTarget(null);
    }

    function resolveDropPlacement(
        event: React.DragEvent<HTMLDivElement>
    ): ConversationDropPlacement {
        const bounds = event.currentTarget.getBoundingClientRect();
        return event.clientX < bounds.left + bounds.width / 2 ? 'before' : 'after';
    }

    function handleDragOver(event: React.DragEvent<HTMLDivElement>, conversationId: string): void {
        if (isBusy || !draggedConversationId) return;
        if (draggedConversationId === conversationId) {
            setDropTarget(null);
            return;
        }

        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const placement = resolveDropPlacement(event);
        setDropTarget((currentTarget) => {
            if (
                currentTarget?.conversationId === conversationId
                && currentTarget.placement === placement
            ) {
                return currentTarget;
            }
            return { conversationId, placement };
        });
    }

    function handleDrop(event: React.DragEvent<HTMLDivElement>, conversationId: string): void {
        event.preventDefault();
        if (isBusy) return;

        const sourceId = draggedConversationId || event.dataTransfer.getData('text/plain');
        const placement = resolveDropPlacement(event);
        const nextIds = moveConversationId(conversationIds, sourceId, conversationId, placement);
        if (nextIds !== conversationIds) onReorderConversations(nextIds);
        setDraggedConversationId(null);
        setDropTarget(null);
    }

    function handleDragEnd(): void {
        setDraggedConversationId(null);
        setDropTarget(null);
    }

    function handleTabKeyDown(
        event: React.KeyboardEvent<HTMLButtonElement>,
        conversationId: string
    ): void {
        if (isBusy || !event.altKey) return;
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;

        const currentIndex = conversationIds.indexOf(conversationId);
        if (currentIndex < 0) return;
        const direction = event.key === 'ArrowLeft' ? -1 : 1;
        const targetId = conversationIds[currentIndex + direction];
        if (!targetId) return;

        event.preventDefault();
        const placement: ConversationDropPlacement = direction < 0 ? 'before' : 'after';
        onReorderConversations(moveConversationId(conversationIds, conversationId, targetId, placement));
    }

    function beginRenaming(conversation: ConversationManagerConversation): void {
        if (isBusy) return;
        setRenamingConversationId(conversation.id);
        setTitleDraft(getConversationTitle(conversation));
    }

    function cancelRenaming(): void {
        setRenamingConversationId(null);
        setTitleDraft('');
    }

    function commitRenaming(): void {
        if (!renamingConversationId) return;
        const nextTitle = normalizeConversationTitle(titleDraft);
        if (nextTitle) onRenameConversation(renamingConversationId, nextTitle);
        cancelRenaming();
    }

    function handleHistoryKeyDown(event: React.KeyboardEvent): void {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        closeHistory();
        historyTriggerRef.current?.focus();
    }

    const managerDisabledHint = isBusy
        ? '当前任务正在执行。为避免任务与会话错位，请完成或停止后再管理对话。'
        : undefined;

    return (
        <div className={`conversation-manager${isBusy ? ' is-busy' : ''}`} ref={rootRef} data-testid="chat-conversation-manager">
            <div className="conversation-tablist" role="tablist" aria-label="当前项目的对话，可拖动调整顺序">
                {conversations.map((conversation) => {
                    const isCurrent = conversation.id === currentConversationId;
                    const canClose = conversations.length > 1 && !isBusy;
                    const title = getConversationTitle(conversation);
                    const isDragging = draggedConversationId === conversation.id;
                    const dropPlacement = dropTarget?.conversationId === conversation.id
                        ? dropTarget.placement
                        : null;
                    return (
                        <div
                            key={conversation.id}
                            ref={(element) => {
                                if (element) {
                                    tabRefs.current.set(conversation.id, element);
                                    return;
                                }
                                tabRefs.current.delete(conversation.id);
                            }}
                            className={`conversation-tab${isCurrent ? ' is-current' : ''}${isCurrent && isBusy ? ' is-running' : ''}${isDragging ? ' is-dragging' : ''}${dropPlacement ? ` is-drop-${dropPlacement}` : ''}`}
                            draggable={!isBusy}
                            onDragStart={(event) => handleDragStart(event, conversation.id)}
                            onDragOver={(event) => handleDragOver(event, conversation.id)}
                            onDrop={(event) => handleDrop(event, conversation.id)}
                            onDragEnd={handleDragEnd}
                        >
                            <button
                                type="button"
                                role="tab"
                                aria-selected={isCurrent}
                                className="conversation-tab-select"
                                title={isCurrent && isBusy ? `${title}（正在执行）` : title}
                                disabled={isBusy}
                                aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
                                onClick={() => handleSwitch(conversation.id)}
                                onKeyDown={(event) => handleTabKeyDown(event, conversation.id)}
                            >
                                <span className="conversation-tab-title">{title}</span>
                                {isCurrent && isBusy && <span className="conversation-running-indicator" aria-label="正在执行" />}
                            </button>
                            <button
                                type="button"
                                className="conversation-tab-close"
                                aria-label={`关闭对话：${title}`}
                                title={canClose ? `关闭「${title}」` : (managerDisabledHint || '至少保留一个对话')}
                                disabled={!canClose}
                                onClick={() => handleDelete(conversation.id)}
                                onDragStart={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                }}
                            >
                                <X size={14} strokeWidth={2} aria-hidden="true" />
                            </button>
                        </div>
                    );
                })}
            </div>

            <div className="conversation-manager-actions">
                <button
                    type="button"
                    className="conversation-manager-action"
                    data-testid="chat-new-conversation"
                    aria-label="新建对话"
                    title={managerDisabledHint || '新建对话'}
                    disabled={isBusy}
                    onClick={handleCreate}
                >
                    <MessageSquarePlus size={17} strokeWidth={1.9} aria-hidden="true" />
                </button>
                <button
                    ref={historyTriggerRef}
                    type="button"
                    className={`conversation-manager-action${historyOpen ? ' is-active' : ''}`}
                    data-testid="chat-conversation-history"
                    aria-label="查看和搜索历史对话"
                    aria-haspopup="dialog"
                    aria-expanded={historyOpen}
                    title={isBusy ? '对话记录（任务执行中，仅可查看）' : '对话记录'}
                    onClick={() => {
                        if (historyOpen) {
                            closeHistory();
                            return;
                        }
                        setHistoryOpen(true);
                    }}
                >
                    <History size={17} strokeWidth={1.9} aria-hidden="true" />
                </button>
            </div>

            <FloatingLayer
                anchorRef={historyTriggerRef}
                open={historyOpen}
                placement="down"
                align="end"
                className="conversation-history-popover"
                role="dialog"
                ariaLabel="对话记录"
                onKeyDown={handleHistoryKeyDown}
            >
                <div className="conversation-history-header">
                    <div>
                        <strong>对话记录</strong>
                        <span>{conversations.length} 个对话</span>
                    </div>
                    <button
                        type="button"
                        className="conversation-history-close"
                        aria-label="关闭对话记录"
                        title="关闭"
                        onClick={() => {
                            closeHistory();
                            historyTriggerRef.current?.focus();
                        }}
                    >
                        <X size={16} strokeWidth={2} aria-hidden="true" />
                    </button>
                </div>

                <label className="conversation-history-search">
                    <Search size={15} strokeWidth={2} aria-hidden="true" />
                    <input
                        ref={historySearchRef}
                        type="search"
                        value={query}
                        placeholder="搜索对话或消息内容"
                        aria-label="搜索对话或消息内容"
                        onChange={(event) => setQuery(event.target.value)}
                    />
                </label>

                <div className="conversation-history-list" role="listbox" aria-label="历史对话">
                    {filteredHistory.length === 0 && (
                        <p className="conversation-history-empty">没有找到匹配的对话。</p>
                    )}

                    {filteredHistory.map((conversation) => {
                        const isCurrent = conversation.id === currentConversationId;
                        const isRenaming = conversation.id === renamingConversationId;
                        const title = getConversationTitle(conversation);
                        return (
                            <div
                                key={conversation.id}
                                className={`conversation-history-row${isCurrent ? ' is-current' : ''}`}
                                role="option"
                                aria-selected={isCurrent}
                            >
                                {isRenaming ? (
                                    <div className="conversation-title-editor">
                                        <input
                                            autoFocus
                                            value={titleDraft}
                                            aria-label="对话名称"
                                            onChange={(event) => setTitleDraft(event.target.value)}
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter') {
                                                    event.preventDefault();
                                                    commitRenaming();
                                                }
                                                if (event.key === 'Escape') {
                                                    event.preventDefault();
                                                    cancelRenaming();
                                                }
                                            }}
                                        />
                                        <button
                                            type="button"
                                            aria-label="保存对话名称"
                                            title="保存"
                                            onClick={commitRenaming}
                                        >
                                            <Check size={15} strokeWidth={2.2} aria-hidden="true" />
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        className="conversation-history-select"
                                        disabled={isBusy}
                                        onClick={() => handleSwitch(conversation.id)}
                                    >
                                        <span className="conversation-history-title">{title}</span>
                                        <span className="conversation-history-preview">{getLastConversationPreview(conversation)}</span>
                                        <span className="conversation-history-meta">
                                            {isCurrent ? '当前对话 · ' : ''}{formatConversationUpdatedAt(conversation.updatedAt)}
                                        </span>
                                    </button>
                                )}
                                {!isRenaming && (
                                    <button
                                        type="button"
                                        className="conversation-history-rename"
                                        aria-label={`重命名对话：${title}`}
                                        title={isBusy ? managerDisabledHint : '重命名'}
                                        disabled={isBusy}
                                        onClick={() => beginRenaming(conversation)}
                                    >
                                        <Pencil size={14} strokeWidth={1.9} aria-hidden="true" />
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>
            </FloatingLayer>
        </div>
    );
}
