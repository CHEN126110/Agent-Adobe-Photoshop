import {
    DEBUG_BRIDGE_MODEL_TRANSPORT_METADATA_VERSION,
    readDebugBridgeProjectAssetAttachments,
    readDebugBridgeProjectAssetPayloadBinding,
    type DebugBridgeModelTransportMetadata,
    type DebugBridgeProjectAssetAttachment,
    type DebugBridgeProjectAssetPayloadBinding,
    type DebugBridgeProjectAssetReference
} from '../../shared/debug-bridge-chat';
import {
    createDesignImageInput,
    type DesignImageInput
} from '../../shared/design-image-input';
import type { ChatComposerContentPart } from '../../shared/chat-composer-content';

export interface PreparedDebugProjectReferenceSubmission {
    attachments: DebugBridgeProjectAssetAttachment[];
    binding: DebugBridgeProjectAssetPayloadBinding;
    images: DesignImageInput[];
    contentParts: ChatComposerContentPart[];
}

interface ActiveDebugProjectReferenceTransportScope {
    leaseToken: string;
    bindingDigest: string;
    images: Array<{
        data: string;
        mediaType: string;
    }>;
    primaryTransportValidated: boolean;
}

let activeTransportScope: ActiveDebugProjectReferenceTransportScope | null = null;

function readMessageImageBlocks(message: unknown): Array<{ data: string; mediaType: string }> {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return [];
    const record = message as Record<string, unknown>;
    if (record['role'] !== 'user') return [];
    const blocks = Array.isArray(record['contentBlocks'])
        ? record['contentBlocks']
        : (Array.isArray(record['content']) ? record['content'] : []);
    return blocks
        .filter((block) => Boolean(block && typeof block === 'object' && !Array.isArray(block)))
        .map((block) => block as Record<string, unknown>)
        .filter((block) => block['type'] === 'image')
        .map((block) => {
            const nestedImage = block['image'] && typeof block['image'] === 'object'
                && !Array.isArray(block['image'])
                ? block['image'] as Record<string, unknown>
                : {};
            return {
                data: String(block['data'] || nestedImage['data'] || ''),
                mediaType: String(
                    block['mediaType'] || nestedImage['mediaType'] || 'image/jpeg'
                )
            };
        });
}

function imagesMatchActiveScope(
    images: Array<{ data: string; mediaType: string }>,
    scope: ActiveDebugProjectReferenceTransportScope
): boolean {
    return images.length === scope.images.length
        && images.every((image, index) => (
            image.data === scope.images[index]?.data
            && image.mediaType === scope.images[index]?.mediaType
        ));
}

/**
 * 在真实模型 IPC 前按同一条 user message 的有序像素做精确匹配。
 * 只有命中当前 Debug request scope 才返回租约元数据；普通 Agent 运行恒为空。
 */
export function resolveDebugProjectReferenceTransportMetadata(
    messages: unknown[]
): DebugBridgeModelTransportMetadata | undefined {
    const scope = activeTransportScope;
    if (!scope) return undefined;
    const matchingMessages = (Array.isArray(messages) ? messages : [])
        .filter((message) => imagesMatchActiveScope(readMessageImageBlocks(message), scope));
    if (!scope.primaryTransportValidated && matchingMessages.length !== 1) {
        throw new Error(
            '受控调试的首个 Agent 模型请求没有唯一携带 Main 验真的目标参考像素，本轮已在调用 Provider 前中止。'
        );
    }
    if (matchingMessages.length !== 1) return undefined;
    scope.primaryTransportValidated = true;
    return Object.freeze({
        version: DEBUG_BRIDGE_MODEL_TRANSPORT_METADATA_VERSION,
        projectReferenceLeaseToken: scope.leaseToken,
        projectReferenceBindingDigest: scope.bindingDigest
    });
}

/** Debug Bridge 单飞范围；状态只活到 handleSend Promise 闭合，不进入 AgentContext。 */
export async function runWithDebugProjectReferenceTransportScope<T>(input: {
    leaseToken: string;
    submission: PreparedDebugProjectReferenceSubmission;
    operation: () => Promise<T>;
}): Promise<T> {
    if (input.submission.binding.referenceCount === 0) return input.operation();
    const leaseToken = String(input.leaseToken || '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/u.test(leaseToken)) {
        throw new Error('受控调试缺少 Main 签发的参考图模型请求租约，本轮不会提交。');
    }
    if (activeTransportScope) {
        throw new Error('已有受控参考图模型请求尚未闭合，本轮不会并行串线。');
    }
    const scope: ActiveDebugProjectReferenceTransportScope = {
        leaseToken,
        bindingDigest: input.submission.binding.bindingDigest,
        images: input.submission.attachments.map((attachment) => ({
            data: attachment.data,
            mediaType: attachment.mediaType
        })),
        primaryTransportValidated: false
    };
    activeTransportScope = scope;
    try {
        return await input.operation();
    } finally {
        if (activeTransportScope === scope) activeTransportScope = null;
    }
}

export function prepareDebugProjectReferenceSubmission(input: {
    text: string;
    references: DebugBridgeProjectAssetReference[];
    attachments: unknown;
    binding: unknown;
}): PreparedDebugProjectReferenceSubmission {
    const attachments = readDebugBridgeProjectAssetAttachments(input.attachments);
    const binding = readDebugBridgeProjectAssetPayloadBinding(input.binding);
    if (!attachments
        || !binding
        || binding.referenceCount !== attachments.length
        || input.references.length !== attachments.length
        || input.references.some((reference, index) => (
            reference.relativePath !== attachments[index]?.relativePath
            || reference.label !== attachments[index]?.label
            || reference.digest !== attachments[index]?.sourceDigest
        ))) {
        throw new Error('受控调试用户参考的 Main 侧视觉载荷绑定无效，本轮不会提交。');
    }
    const images = attachments.map((attachment, index) => {
        const image = createDesignImageInput({
            id: `debug-reference-${index + 1}-${attachment.payloadDigest.slice(7, 23)}`,
            data: attachment.data,
            mediaType: attachment.mediaType,
            source: 'reference-upload',
            name: attachment.label
        });
        if (!image) throw new Error(`用户目标参考视觉载荷为空：${attachment.label}`);
        return image;
    });
    const contentParts: ChatComposerContentPart[] = [
        { type: 'text', text: input.text },
        ...attachments.map((attachment, index) => ({
            type: 'reference' as const,
            reference: {
                version: 'chat-composer-reference/v0' as const,
                referenceId: images[index].id,
                label: attachment.label,
                sourceLabel: '当前项目 · 用户参考',
                mediaKind: 'image' as const,
                source: {
                    kind: 'uploaded_image' as const,
                    imageId: images[index].id,
                    mediaType: attachment.mediaType
                },
                addedAt: new Date().toISOString()
            }
        }))
    ];
    return { attachments, binding, images, contentParts };
}
