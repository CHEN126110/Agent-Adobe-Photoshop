/**
 * 主模型选择器（弹层版）
 *
 * 替代输入栏原来的原生 <select>：候选一多（单 Google 一组就近 20 条）原生下拉只能给出
 * 一列裸模型名，用户既搜不了、也看不出「这个模型能不能读图 / 能不能调工具」。
 *
 * 这里只换呈现与交互，不改候选口径：分组仍来自 primary-model-options
 * （硬编码 + 动态拉取，按运行模式过滤），选择结果仍写回 modelPreferences.primaryModel。
 *
 * 能力标注沿用 model-capability-verdict 的三态判据：
 * 只有「有依据的否定」才标红并提示，unknown 不标注（多数 provider 不返回能力字段，
 * 逐项标注会让整屏都是警告，真正受限的那几个反而被淹没）。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box } from 'lucide-react';

import {
    getModelById,
    isModelThinkingUserControllable
} from '../../shared/config/models.config';
import {
    formatPrimaryModelShortName,
    type PrimaryModelOptionGroup
} from '../../shared/config/primary-model-options';
import {
    capabilityBlocksExecution,
    resolveToolUseVerdict
} from '../../shared/model-capability-verdict';

import { FloatingLayer } from './FloatingLayer';

import './ModelPicker.css';

export interface ModelCapabilityNote {
    /** 附在模型名后的短后缀；只有确定受限时才非空 */
    suffix: string;
    /** 确定不具备工具调用能力：设计任务在它上面只能聊天 */
    blocked: boolean;
    /** 面向用户的中文说明，走 title */
    hint: string;
}

/**
 * 单个模型的工具调用能力说明。
 *
 * 「选得到、用不了」曾经是常态：用户选了一个不具备工具调用能力的模型，界面毫无提示，
 * 直到发消息才收到一句指错方向的报错。能力信息必须在**选择的那一刻**就可见，
 * 判据与执行链完全同源（model-capability-verdict），不另起一套。
 * 从 ChatPanel 内联函数提取到这里，让触发器与列表共用同一判据，避免两处漂移。
 */
export function describeModelCapabilityNote(modelId: string): ModelCapabilityNote {
    const model = getModelById(modelId);
    if (!model) {
        return { suffix: '', blocked: false, hint: '' };
    }
    const verdict = resolveToolUseVerdict({
        declared: model.supportsToolUse,
        provider: model.provider,
        modelLabel: model.name || modelId
    });
    if (capabilityBlocksExecution(verdict)) {
        return {
            suffix: ' · 不支持工具调用',
            blocked: true,
            hint: `${verdict.reason}设计任务需要调用 Photoshop 工具，选它只能聊天。`
        };
    }
    if (verdict.status === 'unknown') {
        return {
            suffix: '',
            blocked: false,
            hint: `${verdict.reason}可以直接用，遇到不支持会在调用时明确报错。`
        };
    }
    return { suffix: '', blocked: false, hint: '' };
}

/** 渠道分页：本地 = 本机 Ollama，云端 = 各家 API */
export type ModelChannelTab = 'cloud' | 'local';

const CHANNEL_TAB_LABELS: Record<ModelChannelTab, string> = {
    cloud: '云端',
    local: '本地'
};

type ModelBadgeTone = 'vision' | 'thinking' | 'meta' | 'local' | 'warn';

/**
 * 徽标该显示什么，取决于当前这份清单里「什么是共性、什么是差异」。
 * 共性不必逐行重复（整页都是视觉模型时不用每行标「视觉」），
 * 差异必须标出来（同一页里混着本地与云端时，渠道就是关键差异）。
 */
interface RowBadgeContext {
    /** 清单混了两种渠道 → 每行标出本地/云端 */
    showChannel: boolean;
    /** 整页都是视觉模型 → 「视觉」标签变成噪音，收掉 */
    suppressVision: boolean;
}

interface ModelBadge {
    label: string;
    tone: ModelBadgeTone;
    title: string;
}

interface ModelPickerRow {
    id: string;
    name: string;
    description: string;
    badges: ModelBadge[];
    blocked: boolean;
    hint: string;
}

interface ModelPickerGroup {
    label: string;
    channel: ModelChannelTab;
    rows: ModelPickerRow[];
}

/** 分页项：主模型按渠道占两页，其余槽位各占一页（不再按渠道细分）。 */
interface PickerTab {
    key: string;
    label: string;
    slot: ModelPickerSlot;
    /** 仅主模型页有：把列表限定到该渠道 */
    channel?: ModelChannelTab;
}

/**
 * 分组归属哪个渠道分页。
 * 分组本身是按 provider 切的，成员渠道天然同质；取第一个能判定的成员即可。
 * 全都判不出（动态拉取的新模型还没登记 source）时按云端处理——动态模型只可能来自云端 provider。
 */
function resolveGroupChannel(rows: ModelPickerRow[]): ModelChannelTab {
    for (const row of rows) {
        const channel = getModelById(row.id)?.source;
        if (channel === 'local') return 'local';
        if (channel === 'cloud') return 'cloud';
    }
    return 'cloud';
}

/** 一个可选模型的槽位（主模型 / 视觉模型），各自独立取值与写回。 */
export interface ModelPickerSlot {
    key: string;
    /** 分页标签，同时用于 aria 与标题 */
    label: string;
    value: string;
    onChange: (modelId: string) => void;
    /** 只列声明支持读图的模型（视觉槽用） */
    requireVision?: boolean;
    /** 槽位职责说明，显示在列表上方 */
    hint?: string;
}

export interface ModelPickerProps {
    /** 槽位列表；多于一个时面板顶部出现槽位分页 */
    slots: ModelPickerSlot[];
    /** 候选分组（全渠道全量，来自 buildAllPrimaryModelOptionGroups），按槽位与渠道在组件内过滤 */
    groups: PrimaryModelOptionGroup[];
    /** 运行模式说明，挂在面板标题右侧 */
    runModeLabel?: string;
    /** 弹层展开方向；输入栏在底部时用 up */
    direction?: 'up' | 'down';
    className?: string;
}

function buildBadges(modelId: string, blocked: boolean, context: RowBadgeContext): ModelBadge[] {
    const model = getModelById(modelId);
    const badges: ModelBadge[] = [];
    if (!model) return badges;

    // 本地标绿：一页里本地模型通常是少数，上色让它们能被一眼扫出来
    if (context.showChannel && model.source === 'local') {
        badges.push({ label: '本地', tone: 'local', title: '在本机 Ollama 上运行，免费且画面不外传' });
    }
    if (context.showChannel && model.source === 'cloud') {
        badges.push({ label: '云端', tone: 'meta', title: '通过云端 API 调用' });
    }
    // 体积只对本地模型有意义：它回答「我这台机器装不装得下」
    if (model.source === 'local' && model.size) {
        badges.push({ label: model.size, tone: 'meta', title: `模型体积约 ${model.size}，需要先在下方 Ollama 区下载` });
    }
    if (model.supportsVision === true && !context.suppressVision) {
        badges.push({ label: '视觉', tone: 'vision', title: '声明支持读图，可直接看画布快照与素材' });
    }
    if (isModelThinkingUserControllable(modelId)) {
        badges.push({ label: '思考', tone: 'thinking', title: '支持由你开关的原生推理 / Thinking 输出' });
    }
    if (blocked) {
        badges.push({ label: '不支持工具', tone: 'warn', title: '不能调用 Photoshop 工具，选它只能聊天' });
    }
    return badges;
}

function buildRow(option: { id: string; name: string }, context: RowBadgeContext): ModelPickerRow {
    const note = describeModelCapabilityNote(option.id);
    return {
        id: option.id,
        name: formatPrimaryModelShortName(option.name),
        description: getModelById(option.id)?.description || '',
        badges: buildBadges(option.id, note.blocked, context),
        blocked: note.blocked,
        hint: note.hint
    };
}

function matchesQuery(row: ModelPickerRow, groupLabel: string, query: string): boolean {
    if (!query) return true;
    // 徽标必须进检索：用户看见「视觉」标就会拿它当关键词搜，
    // 只搜名称与描述会把「有视觉能力但描述里没写这两个字」的模型全漏掉。
    const badgeText = row.badges.map(badge => badge.label).join(' ');
    const haystack = `${row.name} ${row.description} ${row.id} ${groupLabel} ${badgeText}`.toLowerCase();
    // 空格分词后逐词命中：允许「gemini pro」「本地 视觉」这类组合过滤
    return query
        .toLowerCase()
        .split(/\s+/u)
        .filter(Boolean)
        .every(token => haystack.includes(token));
}

export function ModelPicker({
    slots,
    groups,
    runModeLabel = '',
    direction = 'up',
    className = ''
}: ModelPickerProps): React.ReactElement {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);
    const [tabKey, setTabKey] = useState<string>('cloud');
    const rootRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const activeRowRef = useRef<HTMLButtonElement>(null);

    /**
     * 一行分页把两件事拍平：前两页是主模型的两个渠道，之后每个附加槽位各占一页。
     * 「云端 / 本地 / 视觉模型」读起来像三个并列选项——用户不需要先理解"槽位"和"渠道"
     * 是两个维度，点哪页就看哪一份清单。歧义由页签下方那行槽位说明消掉。
     */
    const tabs = useMemo<PickerTab[]>(() => {
        const primarySlot = slots[0];
        const result: PickerTab[] = [];
        if (primarySlot) {
            for (const channel of ['cloud', 'local'] as ModelChannelTab[]) {
                result.push({
                    key: channel,
                    label: CHANNEL_TAB_LABELS[channel],
                    slot: primarySlot,
                    channel
                });
            }
        }
        for (const slot of slots.slice(1)) {
            // 附加槽位不再按渠道拆页：视觉模型本来候选就少，云端与本地在同一页里按分组排开更省事
            result.push({ key: slot.key, label: slot.label, slot });
        }
        return result;
    }, [slots]);

    const activeTab = tabs.find(tab => tab.key === tabKey) || tabs[0];
    const activeSlot = activeTab?.slot || slots[0];
    const value = activeSlot?.value || '';

    // 这一页是否混着两种渠道：主模型页按渠道分开了，视觉模型页没有
    const badgeContext = useMemo<RowBadgeContext>(() => ({
        showChannel: !activeTab?.channel,
        suppressVision: activeSlot?.requireVision === true
    }), [activeTab?.channel, activeSlot?.requireVision]);

    const allGroups = useMemo<ModelPickerGroup[]>(() => {
        const built = groups
            .map(group => {
                // 视觉槽只收声明支持读图的模型：列出一个读不了图的模型，
                // 用户选完要到真正看图时才发现用不了，那时已经浪费了一整轮。
                const options = activeSlot?.requireVision
                    ? group.options.filter(option => getModelById(option.id)?.supportsVision === true)
                    : group.options;
                const rows = options.map(option => buildRow(option, badgeContext));
                return { label: group.label, channel: resolveGroupChannel(rows), rows };
            })
            .filter(group => group.rows.length > 0);
        // 兜底：当前模型不在候选里（动态拉取重置 / 模型下架 / 视觉槽选了个不支持读图的旧值）
        // 时补一组，不让用户在列表里找不到自己正在用的模型，也不静默替换它。
        const listed = built.some(group => group.rows.some(row => row.id === value));
        if (value && !listed) {
            const known = getModelById(value);
            const rows = [buildRow({ id: value, name: known?.name || value }, badgeContext)];
            built.unshift({ label: `当前${activeSlot?.label || '模型'}`, channel: resolveGroupChannel(rows), rows });
        }
        return built;
    }, [groups, value, activeSlot?.requireVision, activeSlot?.label, badgeContext]);

    const visibleGroups = useMemo<ModelPickerGroup[]>(() => {
        const trimmed = query.trim();
        // 主模型页按渠道切分；附加槽位页不切，云端与本地分组一起列
        const scoped = activeTab?.channel
            ? allGroups.filter(group => group.channel === activeTab.channel)
            : allGroups;
        if (!trimmed) return scoped;
        return scoped
            .map(group => ({
                ...group,
                rows: group.rows.filter(row => matchesQuery(row, group.label, trimmed))
            }))
            .filter(group => group.rows.length > 0);
    }, [allGroups, activeTab?.channel, query]);

    const flatRows = useMemo<ModelPickerRow[]>(
        () => visibleGroups.flatMap(group => group.rows),
        [visibleGroups]
    );

    function slotModelName(slot: ModelPickerSlot): string {
        return formatPrimaryModelShortName(getModelById(slot.value)?.name || slot.value) || '未选择';
    }

    const activeModelName = formatPrimaryModelShortName(getModelById(value)?.name || value) || '选择模型';
    // 触发器的能力告警只看第一个槽位（主模型）：能不能调工具是主模型的职责，
    // 视觉模型不支持工具调用是正常的，不该把图标染成警示色。
    const primaryNote = describeModelCapabilityNote(slots[0]?.value || '');
    const triggerTitle = slots.map(slot => `${slot.label}：${slotModelName(slot)}`).join('\n');

    const closePicker = useCallback(() => {
        setOpen(false);
        setQuery('');
    }, []);

    const selectRow = useCallback((modelId: string) => {
        if (modelId && activeSlot && modelId !== activeSlot.value) {
            activeSlot.onChange(modelId);
        }
        closePicker();
    }, [activeSlot, closePicker]);

    // 打开时停在主模型当前所在的渠道页，别让用户先自己找一遍
    useEffect(() => {
        if (!open) return;
        const primaryChannel = getModelById(slots[0]?.value || '')?.source;
        setTabKey(primaryChannel === 'local' ? 'local' : 'cloud');
        setQuery('');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // 打开时把光标放进搜索框，并把高亮定位到当前模型
    useEffect(() => {
        if (!open) return;
        searchRef.current?.focus();
        const currentIndex = flatRows.findIndex(row => row.id === value);
        setActiveIndex(currentIndex >= 0 ? currentIndex : 0);
        // 打开与切分页时各对齐一次；后续 activeIndex 由键盘与过滤驱动
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, tabKey]);

    // 过滤结果变化后把高亮收回有效范围，避免键盘停在空位上
    useEffect(() => {
        setActiveIndex(prev => {
            if (flatRows.length === 0) return 0;
            if (prev < flatRows.length) return prev;
            return flatRows.length - 1;
        });
    }, [flatRows.length]);

    useEffect(() => {
        if (!open) return;
        activeRowRef.current?.scrollIntoView({ block: 'nearest' });
    }, [activeIndex, open]);

    useEffect(() => {
        if (!open) return;
        function handlePointerDown(event: MouseEvent): void {
            const target = event.target as Element | null;
            if (rootRef.current?.contains(target as Node)) return;
            // 面板被 portal 到 body，已经不是 rootRef 的后代；
            // 只按 rootRef 判定会把「点列表项」当成点外面，mousedown 先关掉面板，click 就落空了。
            if (target?.closest?.('.model-picker-panel')) return;
            closePicker();
        }
        document.addEventListener('mousedown', handlePointerDown);
        return () => document.removeEventListener('mousedown', handlePointerDown);
    }, [open, closePicker]);

    function handlePanelKeyDown(event: React.KeyboardEvent): void {
        if (event.key === 'Escape') {
            event.preventDefault();
            closePicker();
            return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (flatRows.length === 0) return;
            const step = event.key === 'ArrowDown' ? 1 : -1;
            setActiveIndex(prev => (prev + step + flatRows.length) % flatRows.length);
            return;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            const row = flatRows[activeIndex];
            if (row) selectRow(row.id);
        }
    }

    let flatCursor = -1;

    return (
        <div
            ref={rootRef}
            className={`model-picker${open ? ' is-open' : ''} ${className}`.trim()}
            onKeyDown={handlePanelKeyDown}
        >
            <button
                ref={triggerRef}
                type="button"
                className={`model-picker-trigger${primaryNote.blocked ? ' is-capability-blocked' : ''}`}
                data-testid="chat-primary-model-select"
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-label={triggerTitle.replace(/\n/g, '，')}
                title={primaryNote.hint ? `${triggerTitle}\n${primaryNote.hint}` : triggerTitle}
                onClick={() => (open ? closePicker() : setOpen(true))}
            >
                {/* 只留图标：模型名默认不占工具条宽度，悬停看 title、点开看面板标题。
                    能力受限时图标本身变色，这个警示不能因为省字而丢掉。 */}
                <Box size={16} strokeWidth={1.8} aria-hidden="true" />
            </button>

            {/* 面板走 portal：输入栏祖先是 overflow:hidden，绝对定位会被裁掉（见 FloatingLayer） */}
            <FloatingLayer
                anchorRef={triggerRef}
                open={open}
                placement={direction}
                align="end"
                className="model-picker-panel"
                role="dialog"
                ariaLabel="模型选择"
                onKeyDown={handlePanelKeyDown}
            >
                <div className="model-picker-panel-inner">
                    {/* 触发器不再显示模型名，所以面板标题必须承担「现在用的是谁」这个信息，
                        不能只靠列表里那一行勾选（长列表里它可能在视野之外）。 */}
                    <div className="model-picker-header">
                        <span className="model-picker-title" title={activeModelName}>{activeModelName}</span>
                        {runModeLabel && <span className="model-picker-mode">{runModeLabel}</span>}
                    </div>

                    {tabs.length > 1 && (
                        <div className="model-picker-tabs" role="tablist" aria-label="模型清单">
                            {tabs.map(tab => (
                                <button
                                    key={tab.key}
                                    type="button"
                                    role="tab"
                                    aria-selected={tab.key === tabKey}
                                    className={`model-picker-tab${tab.key === tabKey ? ' is-active' : ''}`}
                                    onClick={() => {
                                        setTabKey(tab.key);
                                        setActiveIndex(0);
                                    }}
                                >
                                    {tab.label}
                                </button>
                            ))}
                        </div>
                    )}

                    {activeSlot?.hint && (
                        <p className="model-picker-slot-hint">{activeSlot.hint}</p>
                    )}

                    {/* 不做跨渠道提示：选中哪个渠道的模型，运行模式就自动跟过去，
                        用户不需要先理解「模式」这个概念才敢点。 */}
                    <input
                        ref={searchRef}
                        className="model-picker-search"
                        type="text"
                        value={query}
                        placeholder="搜索模型名称或能力"
                        aria-label="搜索模型"
                        onChange={event => setQuery(event.target.value)}
                    />

                    <div className="model-picker-list" role="listbox" aria-label={activeSlot?.label || '模型'}>
                        {flatRows.length === 0 && (
                            <p className="model-picker-empty">
                                {query.trim()
                                    ? `没有匹配「${query.trim()}」的模型，换个词试试。`
                                    : `这一侧没有可用于${activeSlot?.label || '该角色'}的模型。`}
                            </p>
                        )}

                        {visibleGroups.map(group => (
                            <div className="model-picker-group" key={group.label}>
                                <div className="model-picker-group-label">{group.label}</div>
                                {group.rows.map(row => {
                                    flatCursor += 1;
                                    const rowIndex = flatCursor;
                                    const selected = row.id === value;
                                    const active = rowIndex === activeIndex;
                                    return (
                                        <button
                                            key={row.id}
                                            ref={active ? activeRowRef : undefined}
                                            type="button"
                                            role="option"
                                            aria-selected={selected}
                                            className={`model-picker-row${selected ? ' is-selected' : ''}${active ? ' is-active' : ''}${row.blocked ? ' is-blocked' : ''}`}
                                            title={row.hint || undefined}
                                            onMouseEnter={() => setActiveIndex(rowIndex)}
                                            onClick={() => selectRow(row.id)}
                                        >
                                            <span className="model-picker-row-main">
                                                <span className="model-picker-row-name">{row.name}</span>
                                                {row.badges.map(badge => (
                                                    <span
                                                        key={badge.label}
                                                        className={`model-picker-badge tone-${badge.tone}`}
                                                        title={badge.title}
                                                    >
                                                        {badge.label}
                                                    </span>
                                                ))}
                                            </span>
                                            {row.description && (
                                                <span className="model-picker-row-desc">{row.description}</span>
                                            )}
                                            {selected && <span className="model-picker-row-check" aria-hidden="true">✓</span>}
                                        </button>
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                </div>
            </FloatingLayer>
        </div>
    );
}
