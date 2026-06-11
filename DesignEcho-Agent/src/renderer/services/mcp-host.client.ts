const MCP_HOST_ENDPOINT = 'http://127.0.0.1:8768/mcp';
const MCP_HOST_TIMEOUT_MS = 1500;

type JsonRpcId = string | number;

type JsonRpcResponse = {
    jsonrpc: '2.0';
    id: JsonRpcId | null;
    result?: unknown;
    error?: {
        code: number;
        message: string;
        data?: unknown;
    };
};

type InvokeBridge = (channel: string, ...args: any[]) => Promise<any>;

type McpToolCallResult = {
    content?: Array<{ type?: string; text?: string }>;
    isError?: boolean;
};

function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
}

function parseJsonText(text: string): unknown {
    const raw = String(text || '').trim();
    if (!raw) return raw;
    try {
        return JSON.parse(raw);
    } catch {
        return raw;
    }
}

function getInvokeBridge(): InvokeBridge | null {
    const maybeInvoke = (window as any)?.designEcho?.invoke;
    if (typeof maybeInvoke !== 'function') return null;
    return maybeInvoke as InvokeBridge;
}

function parseToolCallPayload(result: unknown): unknown {
    const record = asRecord(result) as McpToolCallResult;
    const first = Array.isArray(record.content) ? record.content[0] : null;
    const text = first && typeof first.text === 'string' ? first.text : '';
    if (!text) return result;
    return parseJsonText(text);
}

async function postMcpRequest(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), MCP_HOST_TIMEOUT_MS);

    try {
        const response = await fetch(MCP_HOST_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: Date.now(),
                method,
                params
            }),
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error(`MCP host HTTP ${response.status}`);
        }

        const payload = await response.json() as JsonRpcResponse;
        if (payload.error) {
            throw new Error(`MCP host error (${payload.error.code}): ${payload.error.message}`);
        }

        return payload.result;
    } finally {
        clearTimeout(timeoutId);
    }
}

async function callHostTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const result = await postMcpRequest('tools/call', {
        name,
        arguments: args
    });
    return parseToolCallPayload(result);
}

export async function getPhotoshopConnectionStatus(): Promise<{ connected: boolean; source: 'mcp-host' | 'ipc' }> {
    try {
        const result = asRecord(await callHostTool('photoshop.connection_status'));
        return {
            connected: Boolean(result.connected),
            source: 'mcp-host'
        };
    } catch {
        const invoke = getInvokeBridge();
        if (!invoke) return { connected: false, source: 'ipc' };
        const legacy = asRecord(await invoke('ws:status'));
        return {
            connected: Boolean(legacy.connected),
            source: 'ipc'
        };
    }
}

export async function listPhotoshopMcpTools(): Promise<unknown> {
    try {
        return await callHostTool('photoshop.tools.list');
    } catch {
        const invoke = getInvokeBridge();
        if (!invoke) throw new Error('MCP host unavailable and IPC bridge is not available');
        return await invoke('mcp:tools:list');
    }
}

export async function callPhotoshopMcpTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const normalizedName = String(name || '').trim();
    if (!normalizedName) {
        throw new Error('Tool name is required');
    }

    try {
        return await callHostTool('photoshop.tools.call', {
            name: normalizedName,
            arguments: args
        });
    } catch {
        const invoke = getInvokeBridge();
        if (!invoke) throw new Error('MCP host unavailable and IPC bridge is not available');
        return await invoke('mcp:tools:call', normalizedName, args);
    }
}
