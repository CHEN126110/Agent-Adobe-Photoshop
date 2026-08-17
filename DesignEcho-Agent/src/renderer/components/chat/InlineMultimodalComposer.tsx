import React, {
    forwardRef,
    useCallback,
    useImperativeHandle,
    useRef,
    useState
} from 'react';

import {
    cloneChatComposerReference,
    normalizeChatComposerContentParts,
    type ChatComposerContentPart,
    type ChatComposerReference
} from '../../../shared/chat-composer-content';

import './InlineMultimodalComposer.css';

export interface InlineMultimodalComposerSnapshot {
    parts: ChatComposerContentPart[];
    text: string;
    referenceCount: number;
}

export interface InlineMultimodalComposerHandle {
    insertReference: (reference: ChatComposerReference, previewUrl?: string) => void;
    insertText: (text: string) => void;
    updateReferencePreview: (referenceId: string, previewUrl: string) => void;
    removeReference: (referenceId: string) => void;
    replaceText: (text: string) => void;
    replaceContent: (
        parts: readonly ChatComposerContentPart[],
        previewUrls?: Readonly<Record<string, string>>
    ) => void;
    clear: () => void;
    focus: () => void;
    moveCaretToPoint: (clientX: number, clientY: number) => void;
    getSnapshot: () => InlineMultimodalComposerSnapshot;
}

interface InlineMultimodalComposerProps {
    placeholder: string;
    disabled?: boolean;
    className?: string;
    testId?: string;
    ariaLabel?: string;
    ariaDescribedBy?: string;
    submitMode?: 'enter' | 'modifier-enter';
    onChange?: (snapshot: InlineMultimodalComposerSnapshot) => void;
    onSubmit: () => void;
    onCancel?: () => void;
    onPaste?: (event: React.ClipboardEvent<HTMLDivElement>) => void;
    onReferenceRemoved?: (reference: ChatComposerReference) => void;
}

function createReferenceToken(
    reference: ChatComposerReference,
    previewUrl?: string
): HTMLSpanElement {
    const token = document.createElement('span');
    token.className = 'inline-composer-reference';
    token.contentEditable = 'false';
    token.dataset.composerReferenceId = reference.referenceId;
    token.dataset.mediaKind = reference.mediaKind;
    token.title = `${reference.sourceLabel} · ${reference.label}`;
    token.setAttribute('role', 'group');
    token.setAttribute('aria-label', `${reference.sourceLabel}：${reference.label}`);

    const preview = document.createElement('span');
    preview.className = 'inline-composer-reference__preview';
    preview.dataset.referencePreview = reference.referenceId;
    if (previewUrl) {
        const image = document.createElement('img');
        image.src = previewUrl;
        image.alt = '';
        image.draggable = false;
        preview.appendChild(image);
    } else {
        preview.textContent = resolveReferenceFallback(reference);
    }

    const label = document.createElement('span');
    label.className = 'inline-composer-reference__label';
    label.textContent = reference.label;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'inline-composer-reference__remove';
    remove.dataset.removeComposerReference = reference.referenceId;
    remove.tabIndex = 0;
    remove.setAttribute('aria-label', `移除引用：${reference.label}`);
    remove.textContent = '×';

    token.append(preview, label, remove);
    return token;
}

function resolveReferenceFallback(reference: ChatComposerReference): string {
    const source = reference.source;
    if (source.kind === 'eagle_asset') {
        const ext = String(source.assetRef.ext || '').trim().toUpperCase();
        if (ext) return ext.slice(0, 4);
    }
    if (source.kind === 'uploaded_image') return 'IMG';
    if (source.kind === 'knowledge_selection') return 'K';
    if (source.kind === 'project_asset') return 'P';
    return 'REF';
}

function isNodeWithin(root: HTMLElement, node: Node | null): boolean {
    if (!node) return false;
    return node === root || root.contains(node);
}

function cloneValidSelectionRange(root: HTMLElement): Range | null {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (!isNodeWithin(root, range.commonAncestorContainer)) return null;
    return range.cloneRange();
}

function buildInsertRange(root: HTMLElement, savedRange: Range | null): Range {
    if (savedRange && isNodeWithin(root, savedRange.commonAncestorContainer)) {
        return savedRange.cloneRange();
    }
    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
    return range;
}

function findAdjacentReference(
    root: HTMLElement,
    range: Range,
    direction: 'backward' | 'forward'
): HTMLElement | null {
    if (!range.collapsed) return null;
    const container = range.startContainer;
    const offset = range.startOffset;
    let candidate: Node | null = null;

    if (container === root) {
        const index = direction === 'backward' ? offset - 1 : offset;
        candidate = index >= 0 ? root.childNodes[index] || null : null;
    } else if (container.nodeType === Node.TEXT_NODE) {
        const text = container.textContent || '';
        if (direction === 'backward' && offset === 0) candidate = container.previousSibling;
        if (direction === 'forward' && offset === text.length) candidate = container.nextSibling;
    }
    if (!(candidate instanceof HTMLElement)) return null;
    return candidate.matches('[data-composer-reference-id]') ? candidate : null;
}

function serializeEditor(
    root: HTMLElement,
    references: Map<string, ChatComposerReference>
): InlineMultimodalComposerSnapshot {
    const parts: ChatComposerContentPart[] = [];
    let textBuffer = '';

    function flushText(): void {
        if (!textBuffer) return;
        parts.push({
            type: 'text',
            text: textBuffer.replace(/\u00a0/g, ' ').replace(/\u200b/g, '')
        });
        textBuffer = '';
    }

    function walk(node: Node): void {
        if (node.nodeType === Node.TEXT_NODE) {
            textBuffer += node.textContent || '';
            return;
        }
        if (!(node instanceof HTMLElement)) return;
        const referenceId = node.dataset.composerReferenceId;
        if (referenceId) {
            const reference = references.get(referenceId);
            if (!reference) return;
            flushText();
            parts.push({ type: 'reference', reference });
            return;
        }
        if (node.tagName === 'BR') {
            textBuffer += '\n';
            return;
        }
        const isBlock = node !== root && (node.tagName === 'DIV' || node.tagName === 'P');
        if (isBlock && textBuffer && !textBuffer.endsWith('\n')) textBuffer += '\n';
        node.childNodes.forEach(walk);
        if (isBlock && !textBuffer.endsWith('\n')) textBuffer += '\n';
    }

    root.childNodes.forEach(walk);
    flushText();
    const normalized = normalizeChatComposerContentParts(parts);
    const text = normalized
        .filter((part): part is Extract<ChatComposerContentPart, { type: 'text' }> => part.type === 'text')
        .map((part) => part.text)
        .join('')
        .trim();
    return {
        parts: normalized,
        text,
        referenceCount: normalized.filter((part) => part.type === 'reference').length
    };
}

export const InlineMultimodalComposer = forwardRef<
    InlineMultimodalComposerHandle,
    InlineMultimodalComposerProps
>(function InlineMultimodalComposer({
    placeholder,
    disabled,
    className,
    testId = 'chat-input',
    ariaLabel = '给 Agent 的消息',
    ariaDescribedBy,
    submitMode = 'enter',
    onChange,
    onSubmit,
    onCancel,
    onPaste,
    onReferenceRemoved
}, forwardedRef) {
    const rootRef = useRef<HTMLDivElement>(null);
    const lastRangeRef = useRef<Range | null>(null);
    const referencesRef = useRef(new Map<string, ChatComposerReference>());
    const [empty, setEmpty] = useState(true);

    const publishSnapshot = useCallback((): InlineMultimodalComposerSnapshot => {
        const root = rootRef.current;
        const snapshot = root
            ? serializeEditor(root, referencesRef.current)
            : { parts: [], text: '', referenceCount: 0 };
        setEmpty(snapshot.parts.length === 0);
        onChange?.(snapshot);
        return snapshot;
    }, [onChange]);

    const saveSelection = useCallback((): void => {
        const root = rootRef.current;
        if (!root) return;
        const range = cloneValidSelectionRange(root);
        if (range) lastRangeRef.current = range;
    }, []);

    const removeReferenceElement = useCallback((element: HTMLElement): void => {
        const referenceId = element.dataset.composerReferenceId;
        if (!referenceId) return;
        const reference = referencesRef.current.get(referenceId);
        referencesRef.current.delete(referenceId);
        element.remove();
        if (reference) onReferenceRemoved?.(reference);
        publishSnapshot();
    }, [onReferenceRemoved, publishSnapshot]);

    useImperativeHandle(forwardedRef, () => ({
        insertReference(reference: ChatComposerReference, previewUrl?: string): void {
            const root = rootRef.current;
            if (!root || disabled) return;
            referencesRef.current.set(reference.referenceId, reference);
            const range = buildInsertRange(root, lastRangeRef.current);
            range.deleteContents();
            const token = createReferenceToken(reference, previewUrl);
            const spacer = document.createTextNode('\u00a0');
            range.insertNode(token);
            token.after(spacer);
            const nextRange = document.createRange();
            nextRange.setStartAfter(spacer);
            nextRange.collapse(true);
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(nextRange);
            lastRangeRef.current = nextRange.cloneRange();
            root.focus();
            publishSnapshot();
        },
        insertText(text: string): void {
            const root = rootRef.current;
            if (!root || disabled || !text) return;
            const range = buildInsertRange(root, lastRangeRef.current);
            range.deleteContents();
            const textNode = document.createTextNode(text);
            range.insertNode(textNode);
            const nextRange = document.createRange();
            nextRange.setStartAfter(textNode);
            nextRange.collapse(true);
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(nextRange);
            lastRangeRef.current = nextRange.cloneRange();
            root.focus();
            publishSnapshot();
        },
        updateReferencePreview(referenceId: string, previewUrl: string): void {
            const root = rootRef.current;
            if (!root || !previewUrl) return;
            const preview = root.querySelector<HTMLElement>(
                `[data-reference-preview="${CSS.escape(referenceId)}"]`
            );
            if (!preview) return;
            preview.replaceChildren();
            const image = document.createElement('img');
            image.src = previewUrl;
            image.alt = '';
            image.draggable = false;
            preview.appendChild(image);
        },
        removeReference(referenceId: string): void {
            const root = rootRef.current;
            if (!root || !referenceId) return;
            const token = root.querySelector<HTMLElement>(
                `[data-composer-reference-id="${CSS.escape(referenceId)}"]`
            );
            if (token) removeReferenceElement(token);
        },
        replaceText(text: string): void {
            const root = rootRef.current;
            if (!root) return;
            referencesRef.current.clear();
            root.replaceChildren(document.createTextNode(text));
            const range = document.createRange();
            range.selectNodeContents(root);
            range.collapse(false);
            lastRangeRef.current = range;
            publishSnapshot();
        },
        replaceContent(
            parts: readonly ChatComposerContentPart[],
            previewUrls: Readonly<Record<string, string>> = {}
        ): void {
            const root = rootRef.current;
            if (!root) return;
            root.replaceChildren();
            referencesRef.current.clear();
            const normalized = normalizeChatComposerContentParts(parts);
            for (const part of normalized) {
                if (part.type === 'text') {
                    root.appendChild(document.createTextNode(part.text));
                    continue;
                }
                const reference = cloneChatComposerReference(part.reference);
                referencesRef.current.set(reference.referenceId, reference);
                root.appendChild(createReferenceToken(
                    reference,
                    previewUrls[reference.referenceId]
                ));
            }
            const range = document.createRange();
            range.selectNodeContents(root);
            range.collapse(false);
            lastRangeRef.current = range.cloneRange();
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);
            publishSnapshot();
        },
        clear(): void {
            const root = rootRef.current;
            if (!root) return;
            root.replaceChildren();
            referencesRef.current.clear();
            lastRangeRef.current = null;
            publishSnapshot();
        },
        focus(): void {
            rootRef.current?.focus();
        },
        moveCaretToPoint(clientX: number, clientY: number): void {
            const root = rootRef.current;
            if (!root) return;
            const documentWithCaret = document as Document & {
                caretRangeFromPoint?: (x: number, y: number) => Range | null;
                caretPositionFromPoint?: (x: number, y: number) => {
                    offsetNode: Node;
                    offset: number;
                } | null;
            };
            let range = documentWithCaret.caretRangeFromPoint?.(clientX, clientY) || null;
            if (!range) {
                const position = documentWithCaret.caretPositionFromPoint?.(clientX, clientY) || null;
                if (position) {
                    range = document.createRange();
                    range.setStart(position.offsetNode, position.offset);
                    range.collapse(true);
                }
            }
            if (!range || !isNodeWithin(root, range.commonAncestorContainer)) {
                range = buildInsertRange(root, lastRangeRef.current);
            }
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);
            lastRangeRef.current = range.cloneRange();
            root.focus();
        },
        getSnapshot(): InlineMultimodalComposerSnapshot {
            const root = rootRef.current;
            return root
                ? serializeEditor(root, referencesRef.current)
                : { parts: [], text: '', referenceCount: 0 };
        }
    }), [disabled, publishSnapshot]);

    return (
        <div
            ref={rootRef}
            className={['inline-multimodal-composer', className].filter(Boolean).join(' ')}
            data-empty={empty ? 'true' : 'false'}
            data-placeholder={placeholder}
            data-testid={testId}
            role="textbox"
            aria-label={ariaLabel}
            aria-describedby={ariaDescribedBy}
            aria-multiline="true"
            contentEditable={!disabled}
            suppressContentEditableWarning
            spellCheck={false}
            onInput={() => {
                saveSelection();
                publishSnapshot();
            }}
            onMouseUp={saveSelection}
            onKeyUp={saveSelection}
            onFocus={saveSelection}
            onBlur={saveSelection}
            onPaste={(event) => {
                saveSelection();
                onPaste?.(event);
            }}
            onClick={(event) => {
                const target = event.target as HTMLElement;
                const removeButton = target.closest<HTMLElement>('[data-remove-composer-reference]');
                if (!removeButton) return;
                event.preventDefault();
                event.stopPropagation();
                const token = removeButton.closest<HTMLElement>('[data-composer-reference-id]');
                if (token) removeReferenceElement(token);
            }}
            onKeyDown={(event) => {
                const target = event.target as HTMLElement;
                if (target.closest('[data-remove-composer-reference]')) return;
                if (event.nativeEvent.isComposing) return;
                if (event.key === 'Escape' && onCancel) {
                    event.preventDefault();
                    onCancel();
                    return;
                }
                const submitRequested = submitMode === 'modifier-enter'
                    ? event.key === 'Enter' && (event.ctrlKey || event.metaKey)
                    : event.key === 'Enter' && !event.shiftKey;
                if (submitRequested) {
                    event.preventDefault();
                    onSubmit();
                    return;
                }
                if (event.key !== 'Backspace' && event.key !== 'Delete') return;
                const root = rootRef.current;
                const selection = window.getSelection();
                if (!root || !selection || selection.rangeCount === 0) return;
                const direction = event.key === 'Backspace' ? 'backward' : 'forward';
                const adjacent = findAdjacentReference(root, selection.getRangeAt(0), direction);
                if (!adjacent) return;
                event.preventDefault();
                removeReferenceElement(adjacent);
            }}
        />
    );
});
