/**
 * 开发期真实任务可能包含多轮视觉观察、Photoshop 写入与复核，五分钟不足以
 * 区分“仍在认真完成”与“已卡死”。三端共用同一上限，避免请求链路任一段
 * 悄悄把调用方提供的超时截短。
 */
export const MAX_DEBUG_BRIDGE_CHAT_TIMEOUT_MS = 40 * 60 * 1000;

export const DEBUG_BRIDGE_CHAT_PREFLIGHT_VERSION = 'debug-bridge-chat-preflight/v2' as const;
export const DEBUG_BRIDGE_CHAT_FAILURE_VERSION = 'debug-bridge-chat-execution-failure/v1' as const;
export const DEBUG_BRIDGE_CHAT_FAILURE_ENVELOPE_VERSION = 'debug-bridge-chat-failure-envelope/v1' as const;
export const DEBUG_BRIDGE_CHAT_SUBMIT_RECEIPT_VERSION = 'debug-bridge-chat-submit-receipt/v3' as const;
export const DEBUG_BRIDGE_INTERACTION_RECEIPT_VERSION = 'debug-bridge-interaction-receipt/v1' as const;
export const DEBUG_BRIDGE_PHOTOSHOP_RUNTIME_BINDING_VERSION =
    'debug-bridge-photoshop-runtime-binding/v1' as const;
export const DEBUG_BRIDGE_PROJECT_ASSET_REFERENCE_VERSION =
    'debug-bridge-project-asset-reference/v1' as const;
export const DEBUG_BRIDGE_PROJECT_ASSET_ATTACHMENT_VERSION =
    'debug-bridge-project-asset-attachment/v1' as const;
export const DEBUG_BRIDGE_PROJECT_ASSET_PAYLOAD_BINDING_VERSION =
    'debug-bridge-project-asset-payload-binding/v1' as const;
export const DEBUG_BRIDGE_PROJECT_ASSET_PROVIDER_RECEIPT_VERSION =
    'debug-bridge-project-asset-provider-receipt/v1' as const;
export const DEBUG_BRIDGE_MODEL_TRANSPORT_METADATA_VERSION =
    'debug-bridge-model-transport-metadata/v1' as const;

export interface DebugBridgeProjectAssetReference {
    version: typeof DEBUG_BRIDGE_PROJECT_ASSET_REFERENCE_VERSION;
    relativePath: string;
    label: string;
    digest: string;
}

export interface DebugBridgeProjectAssetAttachment {
    version: typeof DEBUG_BRIDGE_PROJECT_ASSET_ATTACHMENT_VERSION;
    relativePath: string;
    label: string;
    sourceDigest: string;
    payloadDigest: string;
    mediaType: 'image/jpeg';
    width: number;
    height: number;
    data: string;
}

export interface DebugBridgeProjectAssetPayloadBinding {
    version: typeof DEBUG_BRIDGE_PROJECT_ASSET_PAYLOAD_BINDING_VERSION;
    bindingDigest: string;
    referenceCount: number;
}

export interface DebugBridgeProjectAssetProviderReceipt {
    version: typeof DEBUG_BRIDGE_PROJECT_ASSET_PROVIDER_RECEIPT_VERSION;
    bindingDigest: string;
    referenceCount: number;
    visualBlockCount: number;
    matchedAtProviderBoundary: true;
    provider: string;
    modelId: string;
    transport: 'chat' | 'chat_with_tools' | 'chat_with_tools_stream';
    providerAttemptRef: string;
    matchedAt: string;
    committedAt: string;
}

/** 只在 Debug Bridge 单次请求范围内流经 IPC；不得进入 Agent/Prompt/业务状态。 */
export interface DebugBridgeModelTransportMetadata {
    version: typeof DEBUG_BRIDGE_MODEL_TRANSPORT_METADATA_VERSION;
    projectReferenceLeaseToken: string;
    projectReferenceBindingDigest: string;
}

export interface DebugBridgeWorkspaceSemanticSnapshot {
    folderMappings: Record<string, unknown>;
    imageClassifications: Record<string, unknown>;
    designPlan: Record<string, unknown>;
}

export interface DebugBridgePhotoshopRuntimeLiveIdentity {
    version: 'designecho-uxp-runtime-build/v1';
    buildId: string;
    builtAt: string;
    loadedAt: string;
    buildMode: 'development' | 'production';
    gitCommit: string;
    gitDirty: boolean;
    dirtyScope: string;
    sourceDigest: string;
    features: string[];
}

export interface DebugBridgePhotoshopRuntimeBinding {
    version: typeof DEBUG_BRIDGE_PHOTOSHOP_RUNTIME_BINDING_VERSION;
    live: DebugBridgePhotoshopRuntimeLiveIdentity;
    runtimeDigest: string;
    manifestDigest: string;
}

export type DebugBridgeChatExecutionStage =
    | 'bridge_preflight'
    | 'main_preflight'
    | 'renderer_preflight'
    | 'before_handle_send'
    | 'handle_send_started'
    | 'completion'
    | 'unknown';

export interface DebugBridgeChatPreflightRequest {
    requestId: string;
}

export interface DebugBridgeChatPreflightSnapshot {
    version: typeof DEBUG_BRIDGE_CHAT_PREFLIGHT_VERSION;
    capturedAt: string;
    selectedProvider: string;
    selectedModelId: string;
    selectedApiModelId: string;
    selectedModelResolved: boolean;
    projectPath: string;
    mainImageCanvas: {
        width: number;
        height: number;
    };
    chatBusy: boolean;
}

export interface DebugBridgeChatExecutionFailure {
    version: typeof DEBUG_BRIDGE_CHAT_FAILURE_VERSION;
    stage: DebugBridgeChatExecutionStage;
    writePossible: boolean;
    message: string;
    code?: string;
    requestId?: string;
}

export interface DebugBridgeChatFailureEnvelope {
    version: typeof DEBUG_BRIDGE_CHAT_FAILURE_ENVELOPE_VERSION;
    failure: DebugBridgeChatExecutionFailure;
}

export interface DebugBridgeChatExecutionError extends Error {
    debugBridgeFailure: DebugBridgeChatExecutionFailure;
}

export type DebugBridgeInteractionKind = 'protocol_interaction' | 'user_design_correction';

/** 只存在于单次受控 Debug 请求期间，不进入 Agent Context、Prompt 或业务状态。 */
export interface DebugBridgeInteractionLedger {
    requestId: string;
    startedAt: string;
    protocolInteractionCount: number;
    userDesignCorrectionCount: number;
}

export interface DebugBridgeInteractionReceipt {
    version: typeof DEBUG_BRIDGE_INTERACTION_RECEIPT_VERSION;
    requestId: string;
    startedAt: string;
    completedAt: string;
    protocolInteractionCount: number;
    userDesignCorrectionCount: number;
    source: 'renderer_ui_event_ledger';
}

function cleanDebugBridgeText(value: unknown, maxLength: number): string {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.slice(0, maxLength);
}

function hasExactKeys(value: object, expectedKeys: string[]): boolean {
    const actual = Object.keys(value).sort();
    const expected = [...expectedKeys].sort();
    return actual.length === expected.length
        && actual.every((key, index) => key === expected[index]);
}

function isCanonicalIsoTimestamp(value: unknown): value is string {
    if (typeof value !== 'string' || !value) return false;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

export function createDebugBridgeInteractionLedger(
    requestId: string,
    startedAt: string = new Date().toISOString()
): DebugBridgeInteractionLedger {
    const normalizedRequestId = String(requestId || '').trim();
    if (!normalizedRequestId || !isCanonicalIsoTimestamp(startedAt)) {
        throw new Error('Debug interaction ledger requires a request id and canonical start time.');
    }
    return {
        requestId: normalizedRequestId,
        startedAt,
        protocolInteractionCount: 0,
        userDesignCorrectionCount: 0
    };
}

export function recordDebugBridgeInteraction(
    ledger: DebugBridgeInteractionLedger,
    kind: DebugBridgeInteractionKind
): void {
    const field = kind === 'protocol_interaction'
        ? 'protocolInteractionCount'
        : 'userDesignCorrectionCount';
    const next = ledger[field] + 1;
    if (!Number.isSafeInteger(next) || next > 1000) {
        throw new Error('Debug interaction ledger exceeded its bounded event capacity.');
    }
    ledger[field] = next;
}

export function buildDebugBridgeInteractionReceipt(
    ledger: DebugBridgeInteractionLedger,
    completedAt: string = new Date().toISOString()
): DebugBridgeInteractionReceipt {
    const receipt = readDebugBridgeInteractionReceipt({
        version: DEBUG_BRIDGE_INTERACTION_RECEIPT_VERSION,
        requestId: ledger.requestId,
        startedAt: ledger.startedAt,
        completedAt,
        protocolInteractionCount: ledger.protocolInteractionCount,
        userDesignCorrectionCount: ledger.userDesignCorrectionCount,
        source: 'renderer_ui_event_ledger'
    });
    if (!receipt) throw new Error('Debug interaction receipt could not be finalized.');
    return receipt;
}

export function readDebugBridgeInteractionReceipt(
    value: unknown
): DebugBridgeInteractionReceipt | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    if (!hasExactKeys(record, [
        'version',
        'requestId',
        'startedAt',
        'completedAt',
        'protocolInteractionCount',
        'userDesignCorrectionCount',
        'source'
    ])
        || record['version'] !== DEBUG_BRIDGE_INTERACTION_RECEIPT_VERSION
        || typeof record['requestId'] !== 'string'
        || !record['requestId'].trim()
        || !isCanonicalIsoTimestamp(record['startedAt'])
        || !isCanonicalIsoTimestamp(record['completedAt'])
        || Date.parse(record['completedAt']) < Date.parse(record['startedAt'])
        || !Number.isSafeInteger(record['protocolInteractionCount'])
        || Number(record['protocolInteractionCount']) < 0
        || Number(record['protocolInteractionCount']) > 1000
        || !Number.isSafeInteger(record['userDesignCorrectionCount'])
        || Number(record['userDesignCorrectionCount']) < 0
        || Number(record['userDesignCorrectionCount']) > 1000
        || record['source'] !== 'renderer_ui_event_ledger') return undefined;
    return {
        version: DEBUG_BRIDGE_INTERACTION_RECEIPT_VERSION,
        requestId: record['requestId'].trim(),
        startedAt: record['startedAt'],
        completedAt: record['completedAt'],
        protocolInteractionCount: Number(record['protocolInteractionCount']),
        userDesignCorrectionCount: Number(record['userDesignCorrectionCount']),
        source: 'renderer_ui_event_ledger'
    };
}

function isSha256Digest(value: unknown): value is string {
    return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
}

function isSafeProjectRelativePath(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    const normalized = value.trim().replace(/\\/g, '/');
    return Boolean(normalized)
        && !normalized.startsWith('/')
        && !normalized.startsWith('//')
        && !/^[a-z]:\//i.test(normalized)
        && !normalized.split('/').includes('..');
}

function normalizeDebugBridgeSemanticRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right)));
}

function sortDebugBridgeJson(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortDebugBridgeJson);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [
            key,
            sortDebugBridgeJson((value as Record<string, unknown>)[key])
        ]));
}

export function buildDebugBridgeWorkspaceSemanticSnapshot(
    value: unknown
): DebugBridgeWorkspaceSemanticSnapshot {
    const record = value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
    return {
        folderMappings: normalizeDebugBridgeSemanticRecord(record['folderMappings']),
        imageClassifications: normalizeDebugBridgeSemanticRecord(record['imageClassifications']),
        designPlan: normalizeDebugBridgeSemanticRecord(record['designPlan'])
    };
}

export function stableDebugBridgeJson(value: unknown): string {
    return JSON.stringify(sortDebugBridgeJson(value));
}

export async function buildDebugBridgeWorkspaceSemanticDigest(value: unknown): Promise<string> {
    const bytes = new TextEncoder().encode(stableDebugBridgeJson(
        buildDebugBridgeWorkspaceSemanticSnapshot(value)
    ));
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return `sha256:${Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')}`;
}

export function readDebugBridgeProjectAssetReferences(
    value: unknown
): DebugBridgeProjectAssetReference[] | undefined {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 4) return undefined;
    const references: DebugBridgeProjectAssetReference[] = [];
    const identities = new Set<string>();
    for (const item of value) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
        const record = item as Record<string, unknown>;
        if (!hasExactKeys(record, ['version', 'relativePath', 'label', 'digest'])
            || record['version'] !== DEBUG_BRIDGE_PROJECT_ASSET_REFERENCE_VERSION
            || !isSafeProjectRelativePath(record['relativePath'])
            || typeof record['label'] !== 'string'
            || !record['label'].trim()
            || !isSha256Digest(record['digest'])) return undefined;
        const relativePath = record['relativePath'].trim().replace(/\\/g, '/');
        const digest = record['digest'].toLowerCase();
        const identity = `${relativePath}\u0000${digest}`;
        if (identities.has(identity)) return undefined;
        identities.add(identity);
        references.push({
            version: DEBUG_BRIDGE_PROJECT_ASSET_REFERENCE_VERSION,
            relativePath,
            label: cleanDebugBridgeText(record['label'], 120),
            digest
        });
    }
    return references;
}

export function readDebugBridgeProjectAssetAttachments(
    value: unknown
): DebugBridgeProjectAssetAttachment[] | undefined {
    if (!Array.isArray(value) || value.length > 4) return undefined;
    const attachments: DebugBridgeProjectAssetAttachment[] = [];
    const paths = new Set<string>();
    for (const item of value) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
        const record = item as Record<string, unknown>;
        if (!hasExactKeys(record, [
            'version',
            'relativePath',
            'label',
            'sourceDigest',
            'payloadDigest',
            'mediaType',
            'width',
            'height',
            'data'
        ])
            || record['version'] !== DEBUG_BRIDGE_PROJECT_ASSET_ATTACHMENT_VERSION
            || !isSafeProjectRelativePath(record['relativePath'])
            || typeof record['label'] !== 'string'
            || !record['label'].trim()
            || !isSha256Digest(record['sourceDigest'])
            || !isSha256Digest(record['payloadDigest'])
            || record['mediaType'] !== 'image/jpeg'
            || !Number.isInteger(record['width'])
            || Number(record['width']) < 1
            || !Number.isInteger(record['height'])
            || Number(record['height']) < 1
            || typeof record['data'] !== 'string'
            || !/^[a-z0-9+/]+={0,2}$/i.test(record['data'])) return undefined;
        const relativePath = record['relativePath'].trim().replace(/\\/g, '/');
        if (paths.has(relativePath)) return undefined;
        paths.add(relativePath);
        attachments.push({
            version: DEBUG_BRIDGE_PROJECT_ASSET_ATTACHMENT_VERSION,
            relativePath,
            label: cleanDebugBridgeText(record['label'], 120),
            sourceDigest: record['sourceDigest'].toLowerCase(),
            payloadDigest: record['payloadDigest'].toLowerCase(),
            mediaType: 'image/jpeg',
            width: Number(record['width']),
            height: Number(record['height']),
            data: record['data']
        });
    }
    return attachments;
}

export function readDebugBridgeProjectAssetPayloadBinding(
    value: unknown
): DebugBridgeProjectAssetPayloadBinding | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    if (!hasExactKeys(record, ['version', 'bindingDigest', 'referenceCount'])
        || record['version'] !== DEBUG_BRIDGE_PROJECT_ASSET_PAYLOAD_BINDING_VERSION
        || !isSha256Digest(record['bindingDigest'])
        || !Number.isInteger(record['referenceCount'])
        || Number(record['referenceCount']) < 0
        || Number(record['referenceCount']) > 4) return undefined;
    return {
        version: DEBUG_BRIDGE_PROJECT_ASSET_PAYLOAD_BINDING_VERSION,
        bindingDigest: record['bindingDigest'].toLowerCase(),
        referenceCount: Number(record['referenceCount'])
    };
}

export function readDebugBridgeModelTransportMetadata(
    value: unknown
): DebugBridgeModelTransportMetadata | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    if (!hasExactKeys(record, [
        'version',
        'projectReferenceLeaseToken',
        'projectReferenceBindingDigest'
    ])
        || record['version'] !== DEBUG_BRIDGE_MODEL_TRANSPORT_METADATA_VERSION
        || typeof record['projectReferenceLeaseToken'] !== 'string'
        || !/^[a-f0-9]{64}$/u.test(record['projectReferenceLeaseToken'])
        || !isSha256Digest(record['projectReferenceBindingDigest'])) return undefined;
    return {
        version: DEBUG_BRIDGE_MODEL_TRANSPORT_METADATA_VERSION,
        projectReferenceLeaseToken: record['projectReferenceLeaseToken'],
        projectReferenceBindingDigest: record['projectReferenceBindingDigest'].toLowerCase()
    };
}

export function readDebugBridgeProjectAssetProviderReceipt(
    value: unknown
): DebugBridgeProjectAssetProviderReceipt | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    if (!hasExactKeys(record, [
        'version',
        'bindingDigest',
        'referenceCount',
        'visualBlockCount',
        'matchedAtProviderBoundary',
        'provider',
        'modelId',
        'transport',
        'providerAttemptRef',
        'matchedAt',
        'committedAt'
    ])
        || record['version'] !== DEBUG_BRIDGE_PROJECT_ASSET_PROVIDER_RECEIPT_VERSION
        || !isSha256Digest(record['bindingDigest'])
        || !Number.isInteger(record['referenceCount'])
        || Number(record['referenceCount']) < 1
        || Number(record['referenceCount']) > 4
        || record['visualBlockCount'] !== record['referenceCount']
        || record['matchedAtProviderBoundary'] !== true
        || typeof record['provider'] !== 'string'
        || !record['provider'].trim()
        || record['provider'].length > 120
        || typeof record['modelId'] !== 'string'
        || !record['modelId'].trim()
        || record['modelId'].length > 240
        || !['chat', 'chat_with_tools', 'chat_with_tools_stream'].includes(
            String(record['transport'] || '')
        )
        || !isSha256Digest(record['providerAttemptRef'])
        || !isCanonicalIsoTimestamp(record['matchedAt'])
        || !isCanonicalIsoTimestamp(record['committedAt'])
        || Date.parse(record['matchedAt']) > Date.parse(record['committedAt'])) return undefined;
    return {
        version: DEBUG_BRIDGE_PROJECT_ASSET_PROVIDER_RECEIPT_VERSION,
        bindingDigest: record['bindingDigest'].toLowerCase(),
        referenceCount: Number(record['referenceCount']),
        visualBlockCount: Number(record['visualBlockCount']),
        matchedAtProviderBoundary: true,
        provider: record['provider'].trim(),
        modelId: record['modelId'].trim(),
        transport: record['transport'] as DebugBridgeProjectAssetProviderReceipt['transport'],
        providerAttemptRef: record['providerAttemptRef'].toLowerCase(),
        matchedAt: record['matchedAt'],
        committedAt: record['committedAt']
    };
}

export function debugBridgeProjectAssetProviderReceiptMatches(
    receipt: DebugBridgeProjectAssetProviderReceipt,
    binding: DebugBridgeProjectAssetPayloadBinding
): boolean {
    return receipt.bindingDigest === binding.bindingDigest
        && receipt.referenceCount === binding.referenceCount
        && receipt.visualBlockCount === binding.referenceCount
        && receipt.matchedAtProviderBoundary === true;
}

export function readDebugBridgePhotoshopRuntimeLiveIdentity(
    value: unknown
): DebugBridgePhotoshopRuntimeLiveIdentity | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    if (!hasExactKeys(record, [
        'version',
        'buildId',
        'builtAt',
        'loadedAt',
        'buildMode',
        'gitCommit',
        'gitDirty',
        'dirtyScope',
        'sourceDigest',
        'features'
    ])) return undefined;
    if (record['version'] !== 'designecho-uxp-runtime-build/v1'
        || typeof record['buildId'] !== 'string'
        || !record['buildId'].trim()
        || !isCanonicalIsoTimestamp(record['builtAt'])
        || !isCanonicalIsoTimestamp(record['loadedAt'])
        || (record['buildMode'] !== 'development' && record['buildMode'] !== 'production')
        || typeof record['gitCommit'] !== 'string'
        || !/^[0-9a-f]{40}$/.test(record['gitCommit'])
        || typeof record['gitDirty'] !== 'boolean'
        || typeof record['dirtyScope'] !== 'string'
        || !record['dirtyScope'].trim()
        || !isSha256Digest(record['sourceDigest'])
        || !Array.isArray(record['features'])
        || record['features'].some((feature) => typeof feature !== 'string' || !feature.trim())) {
        return undefined;
    }
    return {
        version: 'designecho-uxp-runtime-build/v1',
        buildId: record['buildId'].trim(),
        builtAt: record['builtAt'],
        loadedAt: record['loadedAt'],
        buildMode: record['buildMode'],
        gitCommit: record['gitCommit'],
        gitDirty: record['gitDirty'],
        dirtyScope: record['dirtyScope'].trim(),
        sourceDigest: record['sourceDigest'],
        features: record['features'].map((feature) => feature.trim())
    };
}

export function readDebugBridgePhotoshopRuntimeBinding(
    value: unknown
): DebugBridgePhotoshopRuntimeBinding | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    if (!hasExactKeys(record, ['version', 'live', 'runtimeDigest', 'manifestDigest'])
        || record['version'] !== DEBUG_BRIDGE_PHOTOSHOP_RUNTIME_BINDING_VERSION
        || !isSha256Digest(record['runtimeDigest'])
        || !isSha256Digest(record['manifestDigest'])) {
        return undefined;
    }
    const live = readDebugBridgePhotoshopRuntimeLiveIdentity(record['live']);
    if (!live) return undefined;
    return {
        version: DEBUG_BRIDGE_PHOTOSHOP_RUNTIME_BINDING_VERSION,
        live,
        runtimeDigest: record['runtimeDigest'],
        manifestDigest: record['manifestDigest']
    };
}

export function debugBridgePhotoshopRuntimeLiveIdentitiesMatch(
    left: DebugBridgePhotoshopRuntimeLiveIdentity,
    right: DebugBridgePhotoshopRuntimeLiveIdentity
): boolean {
    return left.version === right.version
        && left.buildId === right.buildId
        && left.builtAt === right.builtAt
        && left.loadedAt === right.loadedAt
        && left.buildMode === right.buildMode
        && left.gitCommit === right.gitCommit
        && left.gitDirty === right.gitDirty
        && left.dirtyScope === right.dirtyScope
        && left.sourceDigest === right.sourceDigest
        && left.features.length === right.features.length
        && left.features.every((feature, index) => feature === right.features[index]);
}

export function debugBridgePhotoshopRuntimeBindingsMatch(
    left: DebugBridgePhotoshopRuntimeBinding,
    right: DebugBridgePhotoshopRuntimeBinding
): boolean {
    return left.version === right.version
        && left.runtimeDigest === right.runtimeDigest
        && left.manifestDigest === right.manifestDigest
        && debugBridgePhotoshopRuntimeLiveIdentitiesMatch(left.live, right.live);
}

export function buildDebugBridgeChatExecutionFailure(input: {
    stage: DebugBridgeChatExecutionStage;
    writePossible: boolean;
    message: unknown;
    code?: unknown;
    requestId?: unknown;
}): DebugBridgeChatExecutionFailure {
    const message = cleanDebugBridgeText(input.message, 500) || 'Debug Bridge chat execution failed';
    const code = cleanDebugBridgeText(input.code, 120);
    const requestId = cleanDebugBridgeText(input.requestId, 160);
    return {
        version: DEBUG_BRIDGE_CHAT_FAILURE_VERSION,
        stage: input.stage,
        writePossible: input.writePossible === true,
        message,
        ...(code ? { code } : {}),
        ...(requestId ? { requestId } : {})
    };
}

export function readDebugBridgeChatPreflightSnapshot(
    value: unknown
): DebugBridgeChatPreflightSnapshot | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const snapshot = value as Partial<DebugBridgeChatPreflightSnapshot>;
    const mainImageCanvas = snapshot.mainImageCanvas;
    if (snapshot.version !== DEBUG_BRIDGE_CHAT_PREFLIGHT_VERSION
        || typeof snapshot.capturedAt !== 'string'
        || !Number.isFinite(Date.parse(snapshot.capturedAt))
        || typeof snapshot.selectedProvider !== 'string'
        || typeof snapshot.selectedModelId !== 'string'
        || typeof snapshot.selectedApiModelId !== 'string'
        || typeof snapshot.selectedModelResolved !== 'boolean'
        || typeof snapshot.projectPath !== 'string'
        || !mainImageCanvas
        || !Number.isSafeInteger(mainImageCanvas.width)
        || mainImageCanvas.width < 100
        || mainImageCanvas.width > 8000
        || !Number.isSafeInteger(mainImageCanvas.height)
        || mainImageCanvas.height < 100
        || mainImageCanvas.height > 8000
        || typeof snapshot.chatBusy !== 'boolean') {
        return undefined;
    }
    return {
        version: DEBUG_BRIDGE_CHAT_PREFLIGHT_VERSION,
        capturedAt: snapshot.capturedAt,
        selectedProvider: cleanDebugBridgeText(snapshot.selectedProvider, 128),
        selectedModelId: cleanDebugBridgeText(snapshot.selectedModelId, 256),
        selectedApiModelId: cleanDebugBridgeText(snapshot.selectedApiModelId, 256),
        selectedModelResolved: snapshot.selectedModelResolved,
        projectPath: String(snapshot.projectPath || '').trim().slice(0, 1024),
        mainImageCanvas: {
            width: mainImageCanvas.width,
            height: mainImageCanvas.height
        },
        chatBusy: snapshot.chatBusy
    };
}

export function createDebugBridgeChatExecutionError(
    failure: DebugBridgeChatExecutionFailure
): DebugBridgeChatExecutionError {
    const error = new Error(failure.message) as DebugBridgeChatExecutionError;
    error.debugBridgeFailure = failure;
    return error;
}

export function readDebugBridgeChatExecutionFailure(
    value: unknown
): DebugBridgeChatExecutionFailure | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    const candidate = record['debugBridgeFailure'] || record['failure'];
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
    const failure = candidate as Partial<DebugBridgeChatExecutionFailure>;
    const validStages: DebugBridgeChatExecutionStage[] = [
        'bridge_preflight',
        'main_preflight',
        'renderer_preflight',
        'before_handle_send',
        'handle_send_started',
        'completion',
        'unknown'
    ];
    if (failure.version !== DEBUG_BRIDGE_CHAT_FAILURE_VERSION
        || !validStages.includes(failure.stage as DebugBridgeChatExecutionStage)
        || typeof failure.writePossible !== 'boolean'
        || typeof failure.message !== 'string'
        || !failure.message.trim()) {
        return undefined;
    }
    return buildDebugBridgeChatExecutionFailure({
        stage: failure.stage as DebugBridgeChatExecutionStage,
        writePossible: failure.writePossible,
        message: failure.message,
        code: failure.code,
        requestId: failure.requestId
    });
}

export function buildDebugBridgeChatFailureEnvelope(
    failure: DebugBridgeChatExecutionFailure
): DebugBridgeChatFailureEnvelope {
    return {
        version: DEBUG_BRIDGE_CHAT_FAILURE_ENVELOPE_VERSION,
        failure
    };
}

export function readDebugBridgeChatFailureEnvelope(
    value: unknown
): DebugBridgeChatFailureEnvelope | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    if (record['version'] !== DEBUG_BRIDGE_CHAT_FAILURE_ENVELOPE_VERSION) return undefined;
    const failure = readDebugBridgeChatExecutionFailure({ failure: record['failure'] });
    return failure ? buildDebugBridgeChatFailureEnvelope(failure) : undefined;
}
