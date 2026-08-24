/**
 * 设计知识笔记面板（知识库「设计笔记」栏目）
 *
 * Obsidian 式双栏：左侧是笔记列表（搜索/标签过滤/新建），右侧是编辑器
 * （编辑/预览切换、[[wiki 链接]] 跳转、反向链接）。用户与 Agent 写的是
 * 同一个磁盘笔记库（Markdown 文件），Agent 侧入口是 searchDesignNotes /
 * readDesignNote / writeDesignNote 三个工具。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Bot,
    Eye,
    FilePlus2,
    FolderOpen,
    FolderSync,
    Link2,
    NotebookPen,
    PencilLine,
    RefreshCw,
    Save,
    Search,
    Tag,
    Trash2,
    User,
    X
} from 'lucide-react';

import type { DesignNote, DesignNoteMeta } from '../../shared/design-notes';
import { getDesignNotesClient, type DesignNotesVaultInfo } from '../services/design-notes.service';
import { MarkdownLite } from './MarkdownLite';

import './DesignNotesPanel.css';

interface DesignNotesPanelProps {
    isActive: boolean;
}

interface NoteDraft {
    title: string;
    tagsText: string;
    content: string;
}

type EditorMode = 'edit' | 'preview';

export function DesignNotesPanel({ isActive }: DesignNotesPanelProps): React.ReactElement {
    const client = getDesignNotesClient();
    const [vaultInfo, setVaultInfo] = useState<DesignNotesVaultInfo | null>(null);
    const [notes, setNotes] = useState<DesignNoteMeta[]>([]);
    const [tags, setTags] = useState<Array<{ tag: string; count: number }>>([]);
    const [query, setQuery] = useState('');
    const [activeTag, setActiveTag] = useState('');
    const [searchHits, setSearchHits] = useState<Map<string, string[]> | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [loadedNote, setLoadedNote] = useState<DesignNote | null>(null);
    const [backlinks, setBacklinks] = useState<DesignNoteMeta[]>([]);
    const [draft, setDraft] = useState<NoteDraft | null>(null);
    const [isNewNote, setIsNewNote] = useState(false);
    const [mode, setMode] = useState<EditorMode>('preview');
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const [message, setMessage] = useState('');
    const searchTimerRef = useRef<number | null>(null);

    const refreshLibrary = useCallback(async (): Promise<void> => {
        try {
            const [info, list, tagList] = await Promise.all([
                client.getVaultInfo(),
                client.listNotes(),
                client.listTags()
            ]);
            setVaultInfo(info);
            setNotes(list);
            setTags(tagList);
        } catch (error) {
            setMessage(formatError(error, '读取笔记库失败。'));
        }
    }, [client]);

    useEffect(() => {
        if (isActive) void refreshLibrary();
    }, [isActive, refreshLibrary]);

    // 搜索：有关键词时走主进程全文检索（能命中正文），否则用本地列表
    useEffect(() => {
        if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current);
        const trimmed = query.trim();
        if (!trimmed) {
            setSearchHits(null);
            return;
        }
        searchTimerRef.current = window.setTimeout(() => {
            void (async () => {
                try {
                    const matches = await client.searchNotes({ query: trimmed, limit: 50 });
                    setSearchHits(new Map(matches.map((match) => [match.note.id, match.matchedIn])));
                } catch (error) {
                    setMessage(formatError(error, '搜索笔记失败。'));
                }
            })();
        }, 250);
        return () => {
            if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current);
        };
    }, [client, query]);

    const visibleNotes = useMemo(() => notes.filter((note) => {
        if (activeTag && !note.tags.includes(activeTag)) return false;
        if (searchHits) return searchHits.has(note.id);
        return true;
    }), [notes, activeTag, searchHits]);

    async function openNote(id: string): Promise<void> {
        if (dirty && !window.confirm('当前笔记有未保存的修改，切换会丢失。仍要切换吗？')) return;
        try {
            const { note, backlinks: links } = await client.readNote(id);
            setSelectedId(note.id);
            setLoadedNote(note);
            setBacklinks(links);
            setDraft({ title: note.title, tagsText: note.tags.join('，'), content: note.content });
            setIsNewNote(false);
            setMode('preview');
            setDirty(false);
            setConfirmingDelete(false);
            setMessage('');
        } catch (error) {
            setMessage(formatError(error, `打开笔记失败：${id}`));
        }
    }

    function beginNewNote(initialTitle: string = ''): void {
        if (dirty && !window.confirm('当前笔记有未保存的修改，新建会丢失。仍要继续吗？')) return;
        setSelectedId(null);
        setLoadedNote(null);
        setBacklinks([]);
        setDraft({ title: initialTitle, tagsText: activeTag, content: '' });
        setIsNewNote(true);
        setMode('edit');
        setDirty(true);
        setConfirmingDelete(false);
        setMessage('');
    }

    async function saveDraft(): Promise<void> {
        if (!draft || saving) return;
        const title = draft.title.trim();
        if (!title) {
            setMessage('保存失败：请先填写笔记标题。');
            return;
        }
        setSaving(true);
        try {
            const saved = await client.writeNote({
                ...(isNewNote ? {} : { id: selectedId || undefined }),
                title,
                content: draft.content,
                tags: splitTags(draft.tagsText),
                mode: 'replace'
            });
            await refreshLibrary();
            await openNote(saved.id);
            setMessage(`已保存「${saved.title}」。`);
        } catch (error) {
            setMessage(formatError(error, '保存笔记失败。'));
        } finally {
            setSaving(false);
        }
    }

    async function deleteCurrent(): Promise<void> {
        if (!selectedId) return;
        try {
            const result = await client.deleteNote(selectedId);
            setSelectedId(null);
            setLoadedNote(null);
            setDraft(null);
            setBacklinks([]);
            setDirty(false);
            setConfirmingDelete(false);
            await refreshLibrary();
            setMessage(`已移入回收目录（${result.trashedTo}），可在笔记库文件夹中找回。`);
        } catch (error) {
            setMessage(formatError(error, '删除笔记失败。'));
        }
    }

    function handleWikiLink(target: string): void {
        const normalized = target.trim().toLowerCase();
        const hit = notes.find((note) => note.id.toLowerCase() === normalized
            || note.title.toLowerCase() === normalized
            || (note.id.split('/').pop() || '').toLowerCase() === normalized);
        if (hit) {
            void openNote(hit.id);
            return;
        }
        if (window.confirm(`笔记「${target}」还不存在，要新建吗？`)) beginNewNote(target.trim());
    }

    async function handleChooseVault(): Promise<void> {
        try {
            const info = await client.chooseVault();
            if (!info) return;
            setSelectedId(null);
            setLoadedNote(null);
            setDraft(null);
            setDirty(false);
            await refreshLibrary();
            setMessage(`笔记库已切换到：${info.vaultPath}`);
        } catch (error) {
            setMessage(formatError(error, '更换笔记库位置失败。'));
        }
    }

    function handleEditorKeyDown(event: React.KeyboardEvent): void {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
            event.preventDefault();
            void saveDraft();
        }
    }

    return (
        <div className="design-notes" data-testid="design-notes-panel" onKeyDown={handleEditorKeyDown}>
            <aside className="design-notes__sidebar" aria-label="笔记列表">
                <div className="design-notes__sidebar-top">
                    <label className="design-notes__search">
                        <Search size={15} aria-hidden="true" />
                        <input
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="搜索标题、标签、正文…"
                            aria-label="搜索笔记"
                        />
                        {query && <button type="button" aria-label="清空搜索" onClick={() => setQuery('')}><X size={13} aria-hidden="true" /></button>}
                    </label>
                    <button type="button" className="design-notes__new" onClick={() => beginNewNote()}>
                        <FilePlus2 size={15} aria-hidden="true" />新建笔记
                    </button>
                </div>

                {tags.length > 0 && (
                    <div className="design-notes__tags" aria-label="标签过滤">
                        <Tag size={13} aria-hidden="true" />
                        {tags.slice(0, 12).map(({ tag, count }) => (
                            <button
                                key={tag}
                                type="button"
                                className={activeTag === tag ? 'is-active' : ''}
                                aria-pressed={activeTag === tag}
                                onClick={() => setActiveTag(activeTag === tag ? '' : tag)}
                            >{tag}<em>{count}</em></button>
                        ))}
                    </div>
                )}

                <div className="design-notes__list" role="list">
                    {visibleNotes.length === 0 && (
                        <div className="design-notes__empty">
                            <NotebookPen size={22} aria-hidden="true" />
                            <strong>{notes.length === 0 ? '还没有笔记' : '没有符合条件的笔记'}</strong>
                            <span>{notes.length === 0
                                ? '记录你的设计经验、偏好和方法；Agent 也会把确认过的结论写进来。'
                                : '换个关键词或清除标签过滤试试。'}</span>
                        </div>
                    )}
                    {visibleNotes.map((note) => (
                        <button
                            key={note.id}
                            type="button"
                            role="listitem"
                            className={`design-notes__item ${selectedId === note.id ? 'is-active' : ''}`}
                            onClick={() => void openNote(note.id)}
                        >
                            <div className="design-notes__item-heading">
                                <strong>{note.title}</strong>
                                {note.author === 'agent'
                                    ? <span className="design-notes__author design-notes__author--agent"><Bot size={11} aria-hidden="true" />Agent</span>
                                    : <span className="design-notes__author"><User size={11} aria-hidden="true" />我</span>}
                            </div>
                            {searchHits?.get(note.id)?.length
                                ? <p className="design-notes__item-match">{searchHits.get(note.id)!.slice(0, 2).join('　')}</p>
                                : (note.excerpt && <p>{note.excerpt}</p>)}
                            <div className="design-notes__item-meta">
                                {note.tags.slice(0, 3).map((tag) => <em key={tag}>#{tag}</em>)}
                                <time>{formatDate(note.updatedAt)}</time>
                            </div>
                        </button>
                    ))}
                </div>

                <div className="design-notes__vault" title={vaultInfo?.vaultPath || ''}>
                    <span>{vaultInfo ? `${vaultInfo.noteCount} 条笔记 · ${vaultInfo.isDefault ? '默认位置' : '自定义位置'}` : '正在读取笔记库…'}</span>
                    <div>
                        <button type="button" onClick={() => void client.openVaultInExplorer()} title="在资源管理器中打开笔记库（可用 Obsidian 打开同一文件夹）">
                            <FolderOpen size={14} aria-hidden="true" />打开文件夹
                        </button>
                        <button type="button" onClick={() => void handleChooseVault()} title="更换笔记库位置（可指向已有 Obsidian 库）">
                            <FolderSync size={14} aria-hidden="true" />更换位置
                        </button>
                    </div>
                </div>
            </aside>

            <section className="design-notes__editor" aria-label="笔记编辑器">
                {!draft ? (
                    <div className="design-notes__placeholder">
                        <NotebookPen size={30} aria-hidden="true" />
                        <h2>设计知识笔记</h2>
                        <p>像 Obsidian 一样记录设计知识：Markdown 正文、#标签、[[双链]]。这些笔记与 Agent 共享——它会在任务里检索、引用，也会把确认过的经验写进来（追加，不覆盖你的原文）。</p>
                        <div className="design-notes__placeholder-actions">
                            <button type="button" onClick={() => beginNewNote()}><FilePlus2 size={15} aria-hidden="true" />写第一条笔记</button>
                            <button type="button" className="is-secondary" onClick={() => void refreshLibrary()}><RefreshCw size={15} aria-hidden="true" />刷新列表</button>
                        </div>
                    </div>
                ) : (
                    <>
                        <header className="design-notes__editor-head">
                            <input
                                className="design-notes__title"
                                value={draft.title}
                                onChange={(event) => { setDraft({ ...draft, title: event.target.value }); setDirty(true); }}
                                placeholder="笔记标题"
                                aria-label="笔记标题"
                            />
                            <div className="design-notes__toolbar">
                                {dirty && <span className="design-notes__dirty" title="有未保存的修改">未保存</span>}
                                <div className="design-notes__mode" role="group" aria-label="编辑或预览">
                                    <button type="button" className={mode === 'edit' ? 'is-active' : ''} aria-pressed={mode === 'edit'} onClick={() => setMode('edit')}><PencilLine size={14} aria-hidden="true" />编辑</button>
                                    <button type="button" className={mode === 'preview' ? 'is-active' : ''} aria-pressed={mode === 'preview'} onClick={() => setMode('preview')}><Eye size={14} aria-hidden="true" />预览</button>
                                </div>
                                <button type="button" className="design-notes__save" disabled={!dirty || saving} onClick={() => void saveDraft()}>
                                    <Save size={14} aria-hidden="true" />{saving ? '保存中…' : '保存'}
                                </button>
                                {!isNewNote && selectedId && (
                                    <button type="button" className="design-notes__delete" onClick={() => setConfirmingDelete(true)} aria-label="删除笔记">
                                        <Trash2 size={14} aria-hidden="true" />
                                    </button>
                                )}
                            </div>
                        </header>

                        <label className="design-notes__tags-editor">
                            <Tag size={13} aria-hidden="true" />
                            <input
                                value={draft.tagsText}
                                onChange={(event) => { setDraft({ ...draft, tagsText: event.target.value }); setDirty(true); }}
                                placeholder="标签，用逗号分隔（如：主图，排版）"
                                aria-label="笔记标签"
                            />
                        </label>

                        {confirmingDelete && (
                            <div className="design-notes__confirm" role="alert">
                                <Trash2 size={15} aria-hidden="true" />
                                <span>删除「{draft.title || selectedId}」？文件会移入笔记库的 .trash 目录，可手工找回。</span>
                                <button type="button" className="is-danger" onClick={() => void deleteCurrent()}>确认删除</button>
                                <button type="button" onClick={() => setConfirmingDelete(false)}>取消</button>
                            </div>
                        )}

                        {mode === 'edit' ? (
                            <textarea
                                className="design-notes__textarea"
                                value={draft.content}
                                onChange={(event) => { setDraft({ ...draft, content: event.target.value }); setDirty(true); }}
                                placeholder={'用 Markdown 记录设计知识…\n\n# 标题\n- 结论要点\n- 适用条件与反例\n\n关联其他笔记：[[另一条笔记的标题]]'}
                                aria-label="笔记正文"
                                spellCheck={false}
                            />
                        ) : (
                            <div className="design-notes__preview">
                                {draft.content.trim()
                                    ? <MarkdownLite content={draft.content} onWikiLinkClick={handleWikiLink} onExternalLinkClick={(url) => window.designEcho?.openExternal?.(url)} />
                                    : <p className="design-notes__preview-empty">正文还是空的，切到「编辑」开始写。</p>}
                            </div>
                        )}

                        <footer className="design-notes__footer">
                            {loadedNote && (
                                <span className="design-notes__meta">
                                    {loadedNote.author === 'agent' ? 'Agent 创建' : '我创建'} · 建于 {formatDate(loadedNote.createdAt)} · 更新 {formatDate(loadedNote.updatedAt)}
                                </span>
                            )}
                            {backlinks.length > 0 && (
                                <span className="design-notes__backlinks">
                                    <Link2 size={13} aria-hidden="true" />被引用：
                                    {backlinks.slice(0, 5).map((meta) => (
                                        <button key={meta.id} type="button" onClick={() => void openNote(meta.id)}>{meta.title}</button>
                                    ))}
                                </span>
                            )}
                            {message && <span className="design-notes__message" role="status" aria-live="polite">{message}</span>}
                        </footer>
                    </>
                )}
            </section>
        </div>
    );
}

function splitTags(value: string): string[] {
    return Array.from(new Set(value.split(/[，,]/).map((item) => item.trim()).filter(Boolean))).slice(0, 16);
}

function formatDate(value: unknown): string {
    const timestamp = Date.parse(String(value || ''));
    if (!Number.isFinite(timestamp)) return '未记录';
    return new Date(timestamp).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function formatError(error: unknown, fallback: string): string {
    if (error instanceof Error) {
        return error.message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '');
    }
    return fallback;
}
