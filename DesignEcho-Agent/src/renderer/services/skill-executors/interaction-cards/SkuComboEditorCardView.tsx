import { GripVertical, X } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { InteractiveCardBlock as InteractiveCardBlockType } from '../../../components/message/types';
import {
    addSkuComboToEditorValue,
    removeSkuComboFromEditorValue,
    moveSkuComboInEditorValue,
    stringifySkuCombo,
    validateSkuComboEditorValue,
    type SkuComboEditorCard,
    type SkuComboColorSlot,
    type SkuComboEditorValue
} from '../../../../shared/sku-combo-interactive-card';

interface InteractiveCardBlockProps {
    block: InteractiveCardBlockType;
    onAction?: (actionId: string, params?: Record<string, any>) => void;
}

const SKU_COLOR_SLOT_DRAG_TYPE = 'application/x-designecho-sku-color-slot';
const SKU_COMBO_ROW_DRAG_TYPE = 'application/x-designecho-sku-combo-row';

function buildInitialSkuComboValue(card: SkuComboEditorCard): SkuComboEditorValue {
    return validateSkuComboEditorValue(card.payload, card.payload.initialValue).normalizedValue;
}

function hasSkuColorSlotDrag(event: React.DragEvent<HTMLElement>): boolean {
    return Array.from(event.dataTransfer.types || []).includes(SKU_COLOR_SLOT_DRAG_TYPE);
}

function formatSkuSlotLabel(slot: number, colorSlot?: SkuComboColorSlot): string {
    return colorSlot ? `${slot} ${colorSlot.label}` : String(slot);
}

export const SkuComboEditorCardView: React.FC<InteractiveCardBlockProps & { card: SkuComboEditorCard }> = ({
    block,
    card,
    onAction
}) => {
    const [editorValue, setEditorValue] = useState<SkuComboEditorValue>(() => buildInitialSkuComboValue(card));
    const [draft, setDraft] = useState<number[]>([]);
    const [isDragOver, setIsDragOver] = useState(false);
    const [feedback, setFeedback] = useState('');
    // 组合行拖拽重排：记录正在拖的组合与当前悬停的目标行（仅同一双装组内重排）。
    const [draggingCombo, setDraggingCombo] = useState<{ size: number; index: number } | null>(null);
    const [dragOverCombo, setDragOverCombo] = useState<{ size: number; index: number } | null>(null);
    // 重复/新增时高亮并滚动到对应组合行（组合多、列表长，用户否则看不到发生了什么）。
    const [highlightedCombo, setHighlightedCombo] = useState<{ size: number; index: number } | null>(null);
    const highlightedRowRef = useRef<HTMLDivElement | null>(null);
    const colorSlots = useMemo(
        () => editorValue.colorSlots || card.payload.colorSlots,
        [card.payload.colorSlots, editorValue.colorSlots]
    );
    const colorSlotsById = useMemo(
        () => new Map(colorSlots.map((slot) => [slot.slot, slot])),
        [colorSlots]
    );
    const knownColorSlots = useMemo(
        () => new Set(colorSlots.map((slot) => slot.slot)),
        [colorSlots]
    );
    // 拖几个颜色就是几双装：规格集合升序去重，最大值作为一个组合的颜色上限。
    const requiredSizes = useMemo(
        () => Array.from(new Set(card.payload.requiredSizes)).sort((a, b) => a - b),
        [card.payload.requiredSizes]
    );
    const maxComboSize = requiredSizes.length > 0 ? requiredSizes[requiredSizes.length - 1] : 0;

    const validation = useMemo(
        () => validateSkuComboEditorValue(card.payload, editorValue),
        [card.payload, editorValue]
    );
    const draftSize = draft.length;
    const hasDraft = draftSize > 0;
    const draftSizeIsValid = requiredSizes.includes(draftSize);

    // 只把颜色加入当前草稿；不再需要预选规格，也不自动提交——由用户点「添加此组合」确认。
    function addColorToDraft(slot: number): void {
        setHighlightedCombo(null);
        if (!knownColorSlots.has(slot)) {
            setFeedback('这个颜色不属于当前 SKU 卡片，未添加。');
            return;
        }
        if (draft.length >= maxComboSize) {
            setFeedback(`一个组合最多 ${maxComboSize} 个颜色，已达上限。`);
            return;
        }
        const nextDraft = [...draft, slot];
        setDraft(nextDraft);
        setFeedback(requiredSizes.includes(nextDraft.length)
            ? `当前 ${nextDraft.length} 个颜色 = ${nextDraft.length}双装，可点「添加此组合」，或继续拖。`
            : `当前 ${nextDraft.length} 个颜色，再拖到 ${requiredSizes.join(' / ')} 个即可添加。`);
    }

    // 在某双装组内按「多重集」找与给定颜色集合相同的组合下标（与去重口径一致，忽略顺序）。
    function findComboIndexInGroup(size: number, colors: number[]): number {
        const group = editorValue.groups.find((item) => item.size === size);
        if (!group) return -1;
        const key = [...colors].sort((a, b) => a - b).join(',');
        return group.combos.findIndex((combo) => [...combo].sort((a, b) => a - b).join(',') === key);
    }

    // 按草稿里的颜色数量提交为对应双装的组合。
    function commitDraftCombo(): void {
        const size = draft.length;
        if (!requiredSizes.includes(size)) {
            setFeedback(`一个组合需要 ${requiredSizes.join(' / ')} 个颜色，当前 ${size} 个。`);
            return;
        }
        const mutation = addSkuComboToEditorValue(editorValue, size, draft);
        if (mutation.changed) {
            setEditorValue(mutation.value);
            // 高亮 + 滚动到刚加进去的那一组，避免列表长时用户看不到。
            const group = mutation.value.groups.find((item) => item.size === size);
            const newIndex = group ? group.combos.length - 1 : -1;
            if (newIndex >= 0) setHighlightedCombo({ size, index: newIndex });
            setFeedback(`已添加 ${size}双装组合 ${stringifySkuCombo(draft)}。`);
            setDraft([]);
            return;
        }
        if (mutation.reason === 'duplicate') {
            // 高亮 + 滚动到已存在的那一组，让用户看清"不是没反应，是重复了"。
            const matchIndex = findComboIndexInGroup(size, draft);
            if (matchIndex >= 0) setHighlightedCombo({ size, index: matchIndex });
            setFeedback(`组合 ${stringifySkuCombo(draft)} 已存在（已为你高亮那一组），未重复添加。`);
            return;
        }
        setFeedback('未能添加该组合，请重试。');
    }

    function removeCombo(size: number, comboIndex: number): void {
        const group = editorValue.groups.find((item) => item.size === size);
        const combo = group?.combos[comboIndex];
        const mutation = removeSkuComboFromEditorValue(editorValue, size, comboIndex);
        if (!mutation.changed) return;
        setHighlightedCombo(null);
        setEditorValue(mutation.value);
        setFeedback(`已删除 ${size}双装组合 ${combo ? stringifySkuCombo(combo) : ''}。`);
    }

    function handleComboDragStart(event: React.DragEvent<HTMLDivElement>, size: number, index: number): void {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(SKU_COMBO_ROW_DRAG_TYPE, `${size}:${index}`);
        setDraggingCombo({ size, index });
    }

    function handleComboDragEnter(size: number, index: number): void {
        if (draggingCombo && draggingCombo.size === size) {
            setDragOverCombo({ size, index });
        }
    }

    function handleComboDragOver(event: React.DragEvent<HTMLDivElement>, size: number): void {
        // 只允许在同一双装组内重排（不同双装颜色数量不同，不跨组移动）。
        if (!draggingCombo || draggingCombo.size !== size) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
    }

    function handleComboDragLeave(): void {
        setDragOverCombo(null);
    }

    function handleComboDrop(event: React.DragEvent<HTMLDivElement>, size: number, targetIndex: number): void {
        event.preventDefault();
        event.stopPropagation();
        const source = draggingCombo;
        setDraggingCombo(null);
        setDragOverCombo(null);
        if (!source || source.size !== size || source.index === targetIndex) return;
        const mutation = moveSkuComboInEditorValue(editorValue, size, source.index, targetIndex);
        if (!mutation.changed) return;
        setHighlightedCombo(null);
        setEditorValue(mutation.value);
        setFeedback(`已调整 ${size}双装组合顺序。`);
    }

    function handleComboDragEnd(): void {
        setDraggingCombo(null);
        setDragOverCombo(null);
    }

    // 高亮某组合后：滚动到它，并短暂停留后自动淡出高亮。
    useEffect(() => {
        if (!highlightedCombo || !highlightedRowRef.current) return;
        highlightedRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        const timer = setTimeout(() => setHighlightedCombo(null), 2600);
        return () => clearTimeout(timer);
    }, [highlightedCombo]);

    function removeDraftSlot(slotIndex: number): void {
        setDraft((current) => current.filter((_, index) => index !== slotIndex));
        setFeedback('已从当前组合移除 1 个颜色。');
    }

    function clearDraft(): void {
        setDraft([]);
        setFeedback('已清空当前组合。');
    }

    function handleColorDragStart(event: React.DragEvent<HTMLButtonElement>, slot: number): void {
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData(SKU_COLOR_SLOT_DRAG_TYPE, String(slot));
    }

    function handleColorDragEnd(): void {
        setIsDragOver(false);
    }

    function handleDragOver(event: React.DragEvent<HTMLDivElement>): void {
        if (!hasSkuColorSlotDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'copy';
        setIsDragOver(true);
    }

    function handleDragLeave(event: React.DragEvent<HTMLDivElement>): void {
        const nextTarget = event.relatedTarget;
        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
        setIsDragOver(false);
    }

    function handleDrop(event: React.DragEvent<HTMLDivElement>): void {
        if (!hasSkuColorSlotDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        setIsDragOver(false);
        addColorToDraft(Number(event.dataTransfer.getData(SKU_COLOR_SLOT_DRAG_TYPE)));
    }

    function handleSubmit(): void {
        if (hasDraft) {
            setFeedback('还有没添加的组合，请先点「添加此组合」或清空后再确认。');
            return;
        }
        const latestValidation = validateSkuComboEditorValue(card.payload, editorValue);
        if (!latestValidation.canSubmit) return;
        onAction?.(card.submitAction || 'submitInteractiveCard', {
            cardId: card.id,
            cardKind: card.kind,
            card,
            value: latestValidation.normalizedValue,
            validation: latestValidation,
            sourceBlockId: block.id
        });
    }

    return (
        <div className="message-block interactive-card-block sku-combo-card">
            <div className="interactive-card-header">
                <div>
                    <div className="interactive-card-title">{card.title}</div>
                    {card.description && (
                        <div className="interactive-card-description">{card.description}</div>
                    )}
                </div>
                <span className="interactive-card-status">待确认</span>
            </div>

            <div className="sku-combo-builder-instructions">
                <span>把颜色拖进下面的组合框，或点击颜色添加；拖几个颜色就是几双装（{requiredSizes.join(' / ')}双），点「添加此组合」加入。</span>
            </div>

            <div className="sku-color-slot-list" role="list" aria-label="可用颜色">
                {colorSlots.map((slot) => (
                    <div
                        className="sku-color-slot-item"
                        key={slot.slot}
                        role="listitem"
                    >
                        <button
                            type="button"
                            className="sku-color-slot"
                            draggable
                            aria-label={`颜色 ${formatSkuSlotLabel(slot.slot, slot)}，拖动或点击加入当前组合`}
                            title="拖到组合框，或点击加入当前组合"
                            onClick={() => addColorToDraft(slot.slot)}
                            onDragStart={(event) => handleColorDragStart(event, slot.slot)}
                            onDragEnd={handleColorDragEnd}
                        >
                            <GripVertical size={13} aria-hidden="true" />
                            {slot.colorHex && (
                                <span className="sku-color-slot-swatch" style={{ backgroundColor: slot.colorHex }} aria-hidden="true" />
                            )}
                            <span className="sku-color-slot-number">{slot.slot}</span>
                            <span className="sku-color-slot-label">{slot.label}</span>
                        </button>
                    </div>
                ))}
            </div>

            <section className={`sku-combo-composer${isDragOver ? ' is-drag-over' : ''}`}>
                <div className="sku-combo-field-header">
                    <span className="sku-combo-label">
                        当前组合{draftSizeIsValid ? ` = ${draftSize}双装` : ''}
                    </span>
                    <span className="sku-combo-draft-count">{draftSize} 个颜色</span>
                </div>
                <div
                    className="sku-combo-drop-zone"
                    role="group"
                    tabIndex={0}
                    aria-label={`组合添加区，当前 ${draftSize} 个颜色；拖几个颜色就是几双装`}
                    onDragEnter={handleDragOver}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                >
                    <div className="sku-combo-draft-content">
                        {draft.length === 0 ? (
                            <span className="sku-combo-drop-hint">拖入或点击颜色（{requiredSizes.join(' / ')} 个 = 对应双装）</span>
                        ) : draft.map((slot, slotIndex) => (
                            <span className="sku-combo-token is-draft" key={`${slot}-${slotIndex}`}>
                                <span>{formatSkuSlotLabel(slot, colorSlotsById.get(slot))}</span>
                                <button
                                    type="button"
                                    aria-label={`从当前组合移除 ${formatSkuSlotLabel(slot, colorSlotsById.get(slot))}`}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        removeDraftSlot(slotIndex);
                                    }}
                                >
                                    <X size={12} aria-hidden="true" />
                                </button>
                            </span>
                        ))}
                    </div>
                </div>
                <div className="sku-combo-composer-actions">
                    <button
                        type="button"
                        className="sku-combo-commit-draft"
                        disabled={!draftSizeIsValid}
                        onClick={commitDraftCombo}
                    >
                        {draftSizeIsValid ? `添加 ${draftSize}双装组合` : '添加此组合'}
                    </button>
                    {draft.length > 0 && (
                        <button type="button" className="sku-combo-clear-draft" onClick={clearDraft}>
                            清空
                        </button>
                    )}
                </div>
            </section>

            {feedback && <div className="sku-combo-feedback sku-combo-feedback-inline" role="status" aria-live="polite">{feedback}</div>}

            <div className="sku-combo-editor-grid">
                {requiredSizes.map((size) => {
                    const group = editorValue.groups.find((item) => item.size === size) || { size, combos: [] };
                    return (
                        <section
                            className="sku-combo-field"
                            key={size}
                        >
                            <div className="sku-combo-field-header">
                                <span className="sku-combo-label">{size}双装组合</span>
                                <span className="sku-combo-count">{group.combos.length} 组</span>
                            </div>
                            <div className="sku-combo-list" aria-label={`${size}双装已有组合`}>
                                {group.combos.length === 0 ? (
                                    <div className="sku-combo-empty">还没有组合</div>
                                ) : group.combos.map((combo, comboIndex) => {
                                    const isDropTarget = dragOverCombo?.size === size && dragOverCombo?.index === comboIndex;
                                    const isDragging = draggingCombo?.size === size && draggingCombo?.index === comboIndex;
                                    const isHighlighted = highlightedCombo?.size === size && highlightedCombo?.index === comboIndex;
                                    return (
                                        <div
                                            className={`sku-combo-row${isDropTarget ? ' is-drop-target' : ''}${isDragging ? ' is-dragging' : ''}${isHighlighted ? ' is-highlighted' : ''}`}
                                            key={`${stringifySkuCombo(combo)}-${comboIndex}`}
                                            ref={isHighlighted ? highlightedRowRef : undefined}
                                            draggable
                                            onDragStart={(event) => handleComboDragStart(event, size, comboIndex)}
                                            onDragEnter={() => handleComboDragEnter(size, comboIndex)}
                                            onDragOver={(event) => handleComboDragOver(event, size)}
                                            onDragLeave={handleComboDragLeave}
                                            onDrop={(event) => handleComboDrop(event, size, comboIndex)}
                                            onDragEnd={handleComboDragEnd}
                                        >
                                            <span className="sku-combo-row-grip" aria-hidden="true" title="拖动调整顺序">
                                                <GripVertical size={12} />
                                            </span>
                                            <div className="sku-combo-row-values" aria-label={`组合 ${stringifySkuCombo(combo)}`}>
                                                {combo.map((slot, slotIndex) => (
                                                    <React.Fragment key={`${slot}-${slotIndex}`}>
                                                        {slotIndex > 0 && <span className="sku-combo-plus" aria-hidden="true">+</span>}
                                                        <span className="sku-combo-token">
                                                            {formatSkuSlotLabel(slot, colorSlotsById.get(slot))}
                                                        </span>
                                                    </React.Fragment>
                                                ))}
                                            </div>
                                            <button
                                                type="button"
                                                className="sku-combo-remove"
                                                aria-label={`删除 ${size}双装组合 ${stringifySkuCombo(combo)}`}
                                                onClick={() => removeCombo(size, comboIndex)}
                                            >
                                                <X size={14} aria-hidden="true" />
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        </section>
                    );
                })}
            </div>

            <label className="sku-combo-note-toggle">
                <input
                    type="checkbox"
                    checked={editorValue.generateSelfSelectNotes !== false}
                    onChange={(event) => setEditorValue((current) => ({
                        ...current,
                        generateSelfSelectNotes: event.target.checked
                    }))}
                />
                <span>生成自选备注</span>
            </label>

            {validation.issues.length > 0 && (
                <div className="interactive-card-issues">
                    {validation.issues.slice(0, 5).map((issue, index) => (
                        <div
                            key={`${issue.code}-${index}`}
                            className={`interactive-card-issue ${issue.severity}`}
                        >
                            {issue.message}
                        </div>
                    ))}
                </div>
            )}

            <div className="interactive-card-actions">
                <button
                    type="button"
                    className="interactive-card-submit"
                    disabled={!validation.canSubmit || hasDraft}
                    onClick={handleSubmit}
                >
                    确认组合
                </button>
            </div>
        </div>
    );
};
