/**
 * Incremental SSE decoder shared by plain-text and Tool-capable Provider streams.
 *
 * HTTP/socket end only flushes the final event; it is not a model completion signal.
 * Callers must still require an explicit Provider finish reason before accepting output.
 */
const MAX_SSE_LINE_BUFFER_CHARS = 4 * 1024 * 1024;
const MAX_SSE_EVENT_CHARS = 8 * 1024 * 1024;

export class ProviderSseDecoder {
    private buffer = '';
    private dataLines: string[] = [];
    private dataLength = 0;
    private firstCharacterPending = true;

    push(chunk: string): string[] {
        let normalizedChunk = chunk;
        if (normalizedChunk && this.firstCharacterPending) {
            this.firstCharacterPending = false;
            if (normalizedChunk.charCodeAt(0) === 0xfeff) {
                normalizedChunk = normalizedChunk.slice(1);
            }
        }
        this.buffer += normalizedChunk;
        const events = this.drainCompleteLines(false);
        this.assertWithinLimits();
        return events;
    }

    finish(): string[] {
        return this.drainCompleteLines(true);
    }

    private drainCompleteLines(flushRemainder: boolean): string[] {
        const events: string[] = [];
        let newlineIndex = this.buffer.indexOf('\n');
        while (newlineIndex >= 0) {
            const rawLine = this.buffer.slice(0, newlineIndex);
            this.buffer = this.buffer.slice(newlineIndex + 1);
            this.consumeLine(rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine, events);
            newlineIndex = this.buffer.indexOf('\n');
        }

        if (flushRemainder) {
            const rawLine = this.buffer;
            this.buffer = '';
            if (rawLine) {
                this.consumeLine(rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine, events);
            }
            this.flushEvent(events);
        }

        return events;
    }

    private consumeLine(line: string, events: string[]): void {
        if (line.length > MAX_SSE_LINE_BUFFER_CHARS) {
            this.dataLength = MAX_SSE_EVENT_CHARS + 1;
            this.assertWithinLimits();
        }
        if (!line) {
            this.flushEvent(events);
            return;
        }
        if (line.startsWith(':')) return;

        const separatorIndex = line.indexOf(':');
        const field = separatorIndex >= 0 ? line.slice(0, separatorIndex) : line;
        if (field !== 'data') return;

        let value = separatorIndex >= 0 ? line.slice(separatorIndex + 1) : '';
        if (value.startsWith(' ')) value = value.slice(1);
        this.dataLength += value.length;
        this.assertWithinLimits();
        this.dataLines.push(value);
    }

    private flushEvent(events: string[]): void {
        if (this.dataLines.length === 0) return;
        events.push(this.dataLines.join('\n'));
        this.dataLines = [];
        this.dataLength = 0;
    }

    private assertWithinLimits(): void {
        if (this.buffer.length <= MAX_SSE_LINE_BUFFER_CHARS
            && this.dataLength <= MAX_SSE_EVENT_CHARS) {
            return;
        }
        this.buffer = '';
        this.dataLines = [];
        this.dataLength = 0;
        const error = new Error('Provider SSE 帧超过安全上限') as Error & { code?: string };
        error.code = 'provider_sse_frame_too_large';
        throw error;
    }
}
