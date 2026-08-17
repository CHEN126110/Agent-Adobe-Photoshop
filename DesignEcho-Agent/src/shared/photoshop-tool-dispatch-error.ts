export type PhotoshopToolDispatchPhase = 'pre_dispatch' | 'dispatched';

export type PhotoshopToolDispatchFailure = {
    version: 'photoshop-tool-dispatch-failure/v1';
    phase: PhotoshopToolDispatchPhase;
    code: string;
    message: string;
};

const DISPATCH_FAILURE_TOKEN =
    /\[photoshop-dispatch:v1;phase=(pre_dispatch|dispatched);code=([a-z0-9_]+)\]/i;

function normalizeCode(value: unknown): string {
    const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return normalized || 'photoshop_dispatch_failed';
}

function getErrorMessage(value: unknown): string {
    if (value instanceof Error) return value.message;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        const message = (value as Record<string, unknown>).message;
        if (typeof message === 'string') return message;
    }
    return String(value || '');
}

export function createPhotoshopToolDispatchError(input: {
    phase: PhotoshopToolDispatchPhase;
    code: string;
    message: string;
}): Error {
    const code = normalizeCode(input.code);
    const message = String(input.message || 'Photoshop 工具派发失败').trim();
    const marker = `[photoshop-dispatch:v1;phase=${input.phase};code=${code}]`;
    const error = new Error(`${marker} ${message}`) as Error & {
        photoshopDispatchFailure?: PhotoshopToolDispatchFailure;
    };
    error.photoshopDispatchFailure = {
        version: 'photoshop-tool-dispatch-failure/v1',
        phase: input.phase,
        code,
        message
    };
    return error;
}

export function readPhotoshopToolDispatchFailure(
    value: unknown
): PhotoshopToolDispatchFailure | undefined {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        const failure = (value as {
            photoshopDispatchFailure?: Partial<PhotoshopToolDispatchFailure>;
        }).photoshopDispatchFailure;
        if (failure?.version === 'photoshop-tool-dispatch-failure/v1'
            && (failure.phase === 'pre_dispatch' || failure.phase === 'dispatched')) {
            const code = normalizeCode(failure.code);
            const message = String(failure.message || '').trim();
            if (message) {
                return {
                    version: 'photoshop-tool-dispatch-failure/v1',
                    phase: failure.phase,
                    code,
                    message
                };
            }
        }
    }

    const rawMessage = getErrorMessage(value);
    const match = rawMessage.match(DISPATCH_FAILURE_TOKEN);
    if (!match) return undefined;
    const markerEnd = (match.index || 0) + match[0].length;
    const message = rawMessage.slice(markerEnd).trim() || 'Photoshop 工具派发失败';
    return {
        version: 'photoshop-tool-dispatch-failure/v1',
        phase: match[1].toLowerCase() as PhotoshopToolDispatchPhase,
        code: normalizeCode(match[2]),
        message
    };
}
