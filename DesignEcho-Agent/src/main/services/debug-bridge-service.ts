import http from 'http';
import fs from 'fs';
import path from 'path';

export interface DebugBridgeMessage {
    id: string;
    timestamp: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    direction: 'inbound' | 'outbound' | 'event';
    content: string;
    agent?: string;
    metadata?: Record<string, unknown>;
    trace?: Record<string, unknown>;
    toolCalls?: unknown[];
    errors?: unknown[];
}

export interface DebugBridgeSession {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    metadata?: Record<string, unknown>;
    messages: DebugBridgeMessage[];
}

interface DebugBridgeOptions {
    host: string;
    port: number;
    dataDir: string;
    onEvent?: (event: {
        type: 'session.created' | 'message.appended';
        sessionId: string;
        payload: DebugBridgeSession | DebugBridgeMessage;
    }) => void;
}

function safeJsonParse<T>(raw: string): T | null {
    try {
        return JSON.parse(raw) as T;
    } catch {
        return null;
    }
}

function sendJson(res: http.ServerResponse, statusCode: number, body: unknown): void {
    const payload = JSON.stringify(body, null, 2);
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end(payload);
}

function readRequestBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

function sanitizeSessionId(input?: string): string {
    const normalized = String(input || '')
        .trim()
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);

    return normalized || `session-${Date.now()}`;
}

function createMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export class DebugBridgeService {
    private server: http.Server | null = null;
    private readonly host: string;
    private readonly port: number;
    private readonly dataDir: string;
    private readonly sessionsDir: string;
    private readonly onEvent?: DebugBridgeOptions['onEvent'];

    constructor(options: DebugBridgeOptions) {
        this.host = options.host;
        this.port = options.port;
        this.dataDir = options.dataDir;
        this.sessionsDir = path.join(this.dataDir, 'sessions');
        this.onEvent = options.onEvent;
        fs.mkdirSync(this.sessionsDir, { recursive: true });
    }

    start(): void {
        if (this.server) return;

        this.server = http.createServer(async (req, res) => {
            if (!req.url) {
                sendJson(res, 400, { success: false, error: 'Missing URL' });
                return;
            }

            if (req.method === 'OPTIONS') {
                sendJson(res, 200, { success: true });
                return;
            }

            try {
                await this.handleRequest(req, res);
            } catch (error: any) {
                sendJson(res, 500, {
                    success: false,
                    error: error?.message || 'Debug bridge internal error'
                });
            }
        });

        this.server.listen(this.port, this.host);
    }

    stop(): void {
        this.server?.close();
        this.server = null;
    }

    getBaseUrl(): string {
        return `http://${this.host}:${this.port}`;
    }

    private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const method = String(req.method || 'GET').toUpperCase();
        const url = new URL(req.url || '/', this.getBaseUrl());
        const pathname = url.pathname;

        if (method === 'GET' && pathname === '/health') {
            sendJson(res, 200, {
                success: true,
                service: 'debug-bridge',
                host: this.host,
                port: this.port
            });
            return;
        }

        if (method === 'GET' && pathname === '/sessions') {
            sendJson(res, 200, {
                success: true,
                sessions: this.listSessions()
            });
            return;
        }

        if (method === 'POST' && pathname === '/sessions') {
            const body = safeJsonParse<Record<string, unknown>>(await readRequestBody(req)) || {};
            const session = this.createSession({
                id: typeof body.id === 'string' ? body.id : undefined,
                title: typeof body.title === 'string' ? body.title : undefined,
                metadata: isRecord(body.metadata) ? body.metadata : undefined
            });
            sendJson(res, 201, { success: true, session });
            return;
        }

        const sessionMatch = pathname.match(/^\/sessions\/([^/]+)$/);
        if (method === 'GET' && sessionMatch) {
            const session = this.readSession(sessionMatch[1]);
            if (!session) {
                sendJson(res, 404, { success: false, error: 'Session not found' });
                return;
            }
            sendJson(res, 200, { success: true, session });
            return;
        }

        const messageMatch = pathname.match(/^\/sessions\/([^/]+)\/messages$/);
        if (method === 'POST' && messageMatch) {
            const body = safeJsonParse<Record<string, unknown>>(await readRequestBody(req));
            if (!body) {
                sendJson(res, 400, { success: false, error: 'Invalid JSON body' });
                return;
            }

            const message = this.appendMessage(messageMatch[1], {
                role: typeof body.role === 'string' ? body.role : 'user',
                direction: typeof body.direction === 'string' ? body.direction : 'inbound',
                content: typeof body.content === 'string' ? body.content : '',
                agent: typeof body.agent === 'string' ? body.agent : undefined,
                metadata: isRecord(body.metadata) ? body.metadata : undefined,
                trace: isRecord(body.trace) ? body.trace : undefined,
                toolCalls: Array.isArray(body.toolCalls) ? body.toolCalls : undefined,
                errors: Array.isArray(body.errors) ? body.errors : undefined
            });

            sendJson(res, 201, { success: true, message });
            return;
        }

        if (method === 'POST' && pathname === '/message') {
            const body = safeJsonParse<Record<string, unknown>>(await readRequestBody(req));
            if (!body) {
                sendJson(res, 400, { success: false, error: 'Invalid JSON body' });
                return;
            }

            const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined;
            const session = sessionId ? (this.readSession(sessionId) || this.createSession({ id: sessionId })) : this.createSession({});
            const message = this.appendMessage(session.id, {
                role: typeof body.role === 'string' ? body.role : 'user',
                direction: typeof body.direction === 'string' ? body.direction : 'inbound',
                content: typeof body.content === 'string' ? body.content : '',
                agent: typeof body.agent === 'string' ? body.agent : undefined,
                metadata: isRecord(body.metadata) ? body.metadata : undefined,
                trace: isRecord(body.trace) ? body.trace : undefined,
                toolCalls: Array.isArray(body.toolCalls) ? body.toolCalls : undefined,
                errors: Array.isArray(body.errors) ? body.errors : undefined
            });

            sendJson(res, 201, { success: true, sessionId: session.id, message });
            return;
        }

        sendJson(res, 404, { success: false, error: `Not found: ${pathname}` });
    }

    private sessionPath(sessionId: string): string {
        return path.join(this.sessionsDir, `${sanitizeSessionId(sessionId)}.json`);
    }

    private createSession(input: {
        id?: string;
        title?: string;
        metadata?: Record<string, unknown>;
    }): DebugBridgeSession {
        const now = new Date().toISOString();
        const id = sanitizeSessionId(input.id);
        const existing = this.readSession(id);
        if (existing) return existing;

        const session: DebugBridgeSession = {
            id,
            title: input.title?.trim() || `Debug Session ${id}`,
            createdAt: now,
            updatedAt: now,
            metadata: input.metadata,
            messages: []
        };

        this.writeSession(session);
        this.onEvent?.({ type: 'session.created', sessionId: id, payload: session });
        return session;
    }

    private appendMessage(sessionId: string, input: {
        role: string;
        direction: string;
        content: string;
        agent?: string;
        metadata?: Record<string, unknown>;
        trace?: Record<string, unknown>;
        toolCalls?: unknown[];
        errors?: unknown[];
    }): DebugBridgeMessage {
        const session = this.readSession(sessionId) || this.createSession({ id: sessionId });
        const message: DebugBridgeMessage = {
            id: createMessageId(),
            timestamp: new Date().toISOString(),
            role: normalizeRole(input.role),
            direction: normalizeDirection(input.direction),
            content: String(input.content || '').trim(),
            agent: input.agent,
            metadata: input.metadata,
            trace: input.trace,
            toolCalls: input.toolCalls,
            errors: input.errors
        };

        session.messages.push(message);
        session.updatedAt = message.timestamp;
        this.writeSession(session);
        this.writeLatestPointers(session, message);
        this.onEvent?.({ type: 'message.appended', sessionId: session.id, payload: message });
        return message;
    }

    private listSessions(): Array<Pick<DebugBridgeSession, 'id' | 'title' | 'createdAt' | 'updatedAt'> & { messageCount: number }> {
        return fs.readdirSync(this.sessionsDir)
            .filter(name => name.endsWith('.json'))
            .map(name => this.readSession(name.replace(/\.json$/i, '')))
            .filter((session): session is DebugBridgeSession => !!session)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .map(session => ({
                id: session.id,
                title: session.title,
                createdAt: session.createdAt,
                updatedAt: session.updatedAt,
                messageCount: session.messages.length
            }));
    }

    private readSession(sessionId: string): DebugBridgeSession | null {
        const filePath = this.sessionPath(sessionId);
        if (!fs.existsSync(filePath)) return null;
        return safeJsonParse<DebugBridgeSession>(fs.readFileSync(filePath, 'utf8'));
    }

    private writeSession(session: DebugBridgeSession): void {
        const filePath = this.sessionPath(session.id);
        fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf8');
    }

    private writeLatestPointers(session: DebugBridgeSession, message: DebugBridgeMessage): void {
        fs.writeFileSync(
            path.join(this.dataDir, 'latest-session.json'),
            JSON.stringify(session, null, 2),
            'utf8'
        );
        fs.writeFileSync(
            path.join(this.dataDir, 'latest-message.json'),
            JSON.stringify({ sessionId: session.id, message }, null, 2),
            'utf8'
        );
    }
}

function normalizeRole(role: string): DebugBridgeMessage['role'] {
    if (role === 'assistant' || role === 'system' || role === 'tool') return role;
    return 'user';
}

function normalizeDirection(direction: string): DebugBridgeMessage['direction'] {
    if (direction === 'outbound' || direction === 'event') return direction;
    return 'inbound';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
