/**
 * 开发期真实任务可能包含多轮视觉观察、Photoshop 写入与复核，五分钟不足以
 * 区分“仍在认真完成”与“已卡死”。三端共用同一上限，避免请求链路任一段
 * 悄悄把调用方提供的超时截短。
 */
export const MAX_DEBUG_BRIDGE_CHAT_TIMEOUT_MS = 30 * 60 * 1000;

export const DEBUG_BRIDGE_CHAT_PREFLIGHT_VERSION = 'debug-bridge-chat-preflight/v1' as const;
export const DEBUG_BRIDGE_CHAT_FAILURE_VERSION = 'debug-bridge-chat-execution-failure/v1' as const;
export const DEBUG_BRIDGE_CHAT_FAILURE_ENVELOPE_VERSION = 'debug-bridge-chat-failure-envelope/v1' as const;
export const DEBUG_BRIDGE_PHOTOSHOP_RUNTIME_BINDING_VERSION =
    'debug-bridge-photoshop-runtime-binding/v1' as const;

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

function isSha256Digest(value: unknown): value is string {
    return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
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
    if (snapshot.version !== DEBUG_BRIDGE_CHAT_PREFLIGHT_VERSION
        || typeof snapshot.capturedAt !== 'string'
        || !Number.isFinite(Date.parse(snapshot.capturedAt))
        || typeof snapshot.selectedProvider !== 'string'
        || typeof snapshot.selectedModelId !== 'string'
        || typeof snapshot.selectedApiModelId !== 'string'
        || typeof snapshot.selectedModelResolved !== 'boolean'
        || typeof snapshot.projectPath !== 'string'
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
