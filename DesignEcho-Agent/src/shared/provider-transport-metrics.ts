/**
 * One successful OpenAI-compatible streaming transport observation.
 *
 * Every duration is measured in the Main process from the same request-boundary clock. The
 * structure contains sizes and timings only; request text, image data, headers and responses are
 * never persisted. Missing metrics stay absent instead of being inferred from token counts.
 */
export interface ProviderTransportMetrics {
    version: 'provider-transport-metrics/v1';
    /** UTF-8 bytes of the JSON request object handed to the Provider SDK, excluding headers. */
    serializedRequestBytes: number;
    /** UTF-8 bytes contributed by data:image URLs inside the serialized request. */
    imageDataUrlBytes: number;
    /** Time spent mapping canonical Agent messages/tools into Provider format. */
    adapterFormatMs: number;
    /** Observer cost of measuring request bytes and image URL bytes. */
    payloadMeasurementMs: number;
    /** Elapsed time until the Provider SDK returned the streaming response handle. */
    streamOpenMs: number;
    /** Elapsed time until the first Provider stream chunk; absent when no chunk arrived. */
    firstChunkMs?: number;
    /** Elapsed time until the first non-empty reasoning/content/tool delta. */
    firstSemanticDeltaMs?: number;
    /** Elapsed time until the stream ended and the bounded response was assembled. */
    completedMs: number;
}

const PROVIDER_TRANSPORT_METRIC_KEYS = new Set([
    'version',
    'serializedRequestBytes',
    'imageDataUrlBytes',
    'adapterFormatMs',
    'payloadMeasurementMs',
    'streamOpenMs',
    'firstChunkMs',
    'firstSemanticDeltaMs',
    'completedMs'
]);

function isNonNegativeSafeInteger(value: unknown): value is number {
    return Number.isSafeInteger(value) && Number(value) >= 0;
}

/** Strictly sanitize transport metrics before they cross IPC or enter Runtime Accounting. */
export function readProviderTransportMetrics(value: unknown): ProviderTransportMetrics | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const candidate = value as Record<string, unknown>;
    if (Object.keys(candidate).some((key) => !PROVIDER_TRANSPORT_METRIC_KEYS.has(key))) {
        return undefined;
    }
    if (candidate.version !== 'provider-transport-metrics/v1') return undefined;
    const requiredNumbers = [
        candidate.serializedRequestBytes,
        candidate.imageDataUrlBytes,
        candidate.adapterFormatMs,
        candidate.payloadMeasurementMs,
        candidate.streamOpenMs,
        candidate.completedMs
    ];
    if (requiredNumbers.some((item) => !isNonNegativeSafeInteger(item))) return undefined;
    if (candidate.firstChunkMs !== undefined
        && !isNonNegativeSafeInteger(candidate.firstChunkMs)) return undefined;
    if (candidate.firstSemanticDeltaMs !== undefined
        && !isNonNegativeSafeInteger(candidate.firstSemanticDeltaMs)) return undefined;

    const serializedRequestBytes = Number(candidate.serializedRequestBytes);
    const imageDataUrlBytes = Number(candidate.imageDataUrlBytes);
    const adapterFormatMs = Number(candidate.adapterFormatMs);
    const payloadMeasurementMs = Number(candidate.payloadMeasurementMs);
    const streamOpenMs = Number(candidate.streamOpenMs);
    const firstChunkMs = candidate.firstChunkMs === undefined
        ? undefined
        : Number(candidate.firstChunkMs);
    const firstSemanticDeltaMs = candidate.firstSemanticDeltaMs === undefined
        ? undefined
        : Number(candidate.firstSemanticDeltaMs);
    const completedMs = Number(candidate.completedMs);

    if (imageDataUrlBytes > serializedRequestBytes) return undefined;
    if (adapterFormatMs + payloadMeasurementMs > streamOpenMs) return undefined;
    if (streamOpenMs > completedMs) return undefined;
    if (firstChunkMs !== undefined
        && (firstChunkMs < streamOpenMs || firstChunkMs > completedMs)) return undefined;
    if (firstSemanticDeltaMs !== undefined && (
        firstChunkMs === undefined
        || firstSemanticDeltaMs < firstChunkMs
        || firstSemanticDeltaMs > completedMs
    )) return undefined;

    return {
        version: 'provider-transport-metrics/v1',
        serializedRequestBytes,
        imageDataUrlBytes,
        adapterFormatMs,
        payloadMeasurementMs,
        streamOpenMs,
        ...(firstChunkMs !== undefined ? { firstChunkMs } : {}),
        ...(firstSemanticDeltaMs !== undefined ? { firstSemanticDeltaMs } : {}),
        completedMs
    };
}

function elapsedMs(startedAtMs: number, observedAtMs: number): number {
    return Math.max(0, Math.floor(observedAtMs - startedAtMs));
}

/** Build a monotonic, persistence-safe observation from raw request-boundary timestamps. */
export function buildProviderTransportMetrics(input: {
    startedAtMs: number;
    serializedRequestBytes: number;
    imageDataUrlBytes: number;
    adapterFormatMs: number;
    payloadMeasurementMs: number;
    streamOpenedAtMs: number;
    firstChunkAtMs?: number;
    firstSemanticDeltaAtMs?: number;
    completedAtMs: number;
}): ProviderTransportMetrics | undefined {
    return readProviderTransportMetrics({
        version: 'provider-transport-metrics/v1',
        serializedRequestBytes: input.serializedRequestBytes,
        imageDataUrlBytes: input.imageDataUrlBytes,
        adapterFormatMs: Math.max(0, Math.floor(input.adapterFormatMs)),
        payloadMeasurementMs: Math.max(0, Math.floor(input.payloadMeasurementMs)),
        streamOpenMs: elapsedMs(input.startedAtMs, input.streamOpenedAtMs),
        ...(input.firstChunkAtMs === undefined
            ? {}
            : { firstChunkMs: elapsedMs(input.startedAtMs, input.firstChunkAtMs) }),
        ...(input.firstSemanticDeltaAtMs === undefined
            ? {}
            : { firstSemanticDeltaMs: elapsedMs(input.startedAtMs, input.firstSemanticDeltaAtMs) }),
        completedMs: elapsedMs(input.startedAtMs, input.completedAtMs)
    });
}
