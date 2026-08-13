import type { EagleAssetRef } from './eagle-asset-ref';
import { formatEagleAssetRefToken } from './eagle-asset-ref';
import type {
    KnowledgeReferenceUseRole,
    KnowledgeSelectionReference
} from './knowledge-selection-context';

export const CHAT_COMPOSER_REFERENCE_VERSION = 'chat-composer-reference/v0' as const;

export type ChatComposerReferenceMediaKind =
    | 'image'
    | 'video'
    | 'design_document'
    | 'font'
    | 'document'
    | 'knowledge'
    | 'other';

export type ChatComposerReferenceSource =
    | {
        kind: 'uploaded_image';
        imageId: string;
        mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
    }
    | {
        kind: 'eagle_asset';
        assetRef: EagleAssetRef;
    }
    | {
        kind: 'project_asset';
        relativePath: string;
        imageType?: string;
        folderType?: string;
    }
    | {
        kind: 'knowledge_selection';
        bindingRef: string;
        resultId: string;
        title: string;
        sourceRevision: string;
        contentFingerprint: string;
        useRole?: KnowledgeReferenceUseRole;
        /**
         * 已有 KnowledgeSelectionReference 本身就是有界、脱敏且不授予权限的请求级引用。
         * 随消息保存它，才能在编辑重发时恢复同一条知识证据，而不是靠标题或 bindingRef 猜测。
         */
        selection?: KnowledgeSelectionReference;
    };

export interface ChatComposerReference {
    version: typeof CHAT_COMPOSER_REFERENCE_VERSION;
    referenceId: string;
    label: string;
    sourceLabel: string;
    mediaKind: ChatComposerReferenceMediaKind;
    source: ChatComposerReferenceSource;
    addedAt: string;
}

export type ChatComposerContentPart =
    | {
        type: 'text';
        text: string;
    }
    | {
        type: 'reference';
        reference: ChatComposerReference;
    };

export interface ChatMessageImage {
    id: string;
    data: string;
    type: 'image/jpeg' | 'image/png' | 'image/webp';
    name?: string;
}

export function normalizeChatComposerContentParts(
    parts: readonly ChatComposerContentPart[]
): ChatComposerContentPart[] {
    const normalized: ChatComposerContentPart[] = [];
    let textBuffer = '';

    function flushText(): void {
        if (!textBuffer) return;
        normalized.push({ type: 'text', text: textBuffer });
        textBuffer = '';
    }

    for (const part of parts) {
        if (part.type === 'text') {
            textBuffer += String(part.text || '');
            continue;
        }
        if (!part.reference?.referenceId || !part.reference.label) continue;
        flushText();
        normalized.push({
            type: 'reference',
            reference: cloneChatComposerReference(part.reference)
        });
    }
    flushText();

    if (normalized[0]?.type === 'text') {
        normalized[0] = {
            type: 'text',
            text: normalized[0].text.replace(/^\s+/, '')
        };
    }
    const lastIndex = normalized.length - 1;
    if (lastIndex >= 0 && normalized[lastIndex]?.type === 'text') {
        const last = normalized[lastIndex];
        normalized[lastIndex] = {
            type: 'text',
            text: last.text.replace(/\s+$/, '')
        };
    }
    return normalized.filter((part) => part.type !== 'text' || part.text.length > 0);
}

export function buildChatComposerPlainText(parts: readonly ChatComposerContentPart[]): string {
    return normalizeChatComposerContentParts(parts)
        .filter((part): part is Extract<ChatComposerContentPart, { type: 'text' }> => part.type === 'text')
        .map((part) => part.text)
        .join('')
        .trim();
}

export function buildChatComposerModelText(parts: readonly ChatComposerContentPart[]): string {
    const normalized = normalizeChatComposerContentParts(parts);
    let referenceIndex = 0;
    return normalized.map((part) => {
        if (part.type === 'text') return part.text;
        referenceIndex += 1;
        return buildChatComposerReferenceMarker(part.reference, referenceIndex);
    }).join('').trim();
}

export function stripChatComposerReferenceMarkers(value: string): {
    content: string;
    removed: boolean;
} {
    const input = String(value || '');
    const content = input
        .replace(/【引用\d+：[^】]*；来源=[^】]*】/g, ' ')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
    return {
        content,
        removed: content !== input.trim()
    };
}

export function buildChatComposerReferenceMarker(
    reference: ChatComposerReference,
    index: number
): string {
    const locator = buildReferenceLocator(reference.source);
    const locatorSuffix = locator ? `；引用=${locator}` : '';
    return `【引用${Math.max(1, Math.floor(index))}：${reference.label}；来源=${reference.sourceLabel}${locatorSuffix}】`;
}

export function hasChatComposerReference(
    parts: readonly ChatComposerContentPart[],
    referenceId: string
): boolean {
    return parts.some((part) => (
        part.type === 'reference'
        && part.reference.referenceId === referenceId
    ));
}

export function cloneChatComposerReference(reference: ChatComposerReference): ChatComposerReference {
    const source = reference.source;
    if (source.kind === 'eagle_asset') {
        return {
            ...reference,
            source: {
                kind: source.kind,
                assetRef: {
                    ...source.assetRef,
                    tags: [...source.assetRef.tags],
                    folderPaths: [...source.assetRef.folderPaths]
                }
            }
        };
    }
    if (source.kind === 'knowledge_selection') {
        return {
            ...reference,
            source: {
                ...source,
                ...(source.selection ? {
                    selection: {
                        ...source.selection,
                        allowedUses: [...source.selection.allowedUses]
                    }
                } : {})
            }
        };
    }
    return {
        ...reference,
        source: { ...source }
    };
}

function buildReferenceLocator(source: ChatComposerReferenceSource): string {
    switch (source.kind) {
        case 'uploaded_image':
            return `image:${source.imageId}`;
        case 'eagle_asset':
            return `eagle:${formatEagleAssetRefToken(source.assetRef)}`;
        case 'project_asset':
            return `project:${cleanRelativePath(source.relativePath)}`;
        case 'knowledge_selection':
            return `knowledge:${source.bindingRef}`;
        default:
            return '';
    }
}

function cleanRelativePath(value: unknown): string {
    return String(value || '')
        .trim()
        .replace(/^[a-z]:[\\/]/i, '')
        .replace(/^[/\\]+/, '')
        .slice(0, 320);
}
