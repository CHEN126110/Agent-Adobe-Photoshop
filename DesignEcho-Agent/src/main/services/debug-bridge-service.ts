import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import path from 'path';
import sharp from 'sharp';
import {
    buildDebugBridgeChatExecutionFailure,
    buildDebugBridgeWorkspaceSemanticSnapshot,
    createDebugBridgeChatExecutionError,
    debugBridgeProjectAssetProviderReceiptMatches,
    readDebugBridgeChatExecutionFailure,
    readDebugBridgeChatPreflightSnapshot,
    readDebugBridgeProjectAssetProviderReceipt,
    readDebugBridgeProjectAssetReferences,
    readDebugBridgePhotoshopRuntimeBinding,
    stableDebugBridgeJson,
    type DebugBridgeChatExecutionFailure,
    type DebugBridgeChatPreflightSnapshot,
    type DebugBridgeProjectAssetAttachment,
    type DebugBridgeProjectAssetPayloadBinding,
    type DebugBridgeProjectAssetReference,
    type DebugBridgePhotoshopRuntimeBinding
} from '../../shared/debug-bridge-chat';

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
    executionSummary?: DebugBridgeExecutionSummary;
}

export interface DebugBridgeSession {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    metadata?: Record<string, unknown>;
    messages: DebugBridgeMessage[];
}

export interface DebugBridgeCreateSessionInput {
    id?: string;
    title?: string;
    metadata?: Record<string, unknown>;
}

export interface DebugBridgeAppendMessageInput {
    role: string;
    direction: string;
    content: string;
    agent?: string;
    metadata?: Record<string, unknown>;
    trace?: Record<string, unknown>;
    toolCalls?: unknown[];
    errors?: unknown[];
    executionSummary?: unknown;
}

export interface DebugBridgeExecutionSummary {
    status: string;
    stopReason?: string;
    iterations?: number;
    toolCallCount?: number;
    successfulToolCalls?: number;
    failedToolCalls?: number;
    acceptanceVerified?: number;
    acceptanceFailed?: number;
    acceptanceNeedsReview?: number;
    noDocumentChangeRisks?: number;
    lastToolName?: string;
    lastError?: string;
    blockers?: string[];
    warnings?: string[];
    summaryText?: string;
}

export interface DebugBridgeExecutionSummaryPreview {
    status: string;
    stopReason?: string;
    iterations?: number;
    toolCallCount?: number;
    successfulToolCalls?: number;
    failedToolCalls?: number;
    acceptanceVerified?: number;
    acceptanceFailed?: number;
    acceptanceNeedsReview?: number;
    noDocumentChangeRisks?: number;
    lastToolName?: string;
    blockerCount: number;
    warningCount: number;
    summaryText?: string;
}

export interface DebugBridgeChatSubmitInput {
    text: string;
    timeoutMs?: number;
    resetConversation?: boolean;
    disableSkillBridges?: boolean;
    /** 用户在本轮消息中明确附带的项目参考；Main 已按项目根与 SHA-256 验真。 */
    projectAssetReferences?: DebugBridgeProjectAssetReference[];
    /** Main 从已验真的源字节生成的规范化视觉载荷；HTTP 调用方不能直接提供。 */
    projectAssetAttachments?: DebugBridgeProjectAssetAttachment[];
    /** 对规范化视觉载荷顺序、源摘要与实际像素摘要的 Main 侧绑定。 */
    projectAssetPayloadBinding?: DebugBridgeProjectAssetPayloadBinding;
    /** CLI 在 Attempt armed 前冻结的项目语义摘要；Renderer 在 handleSend 紧邻点复核。 */
    expectedWorkspaceSemanticDigest?: string;
    /** 开发评测写前绑定；Renderer 必须与当前项目精确匹配，否则不提交消息。 */
    expectedProjectPath?: string;
    /** 开发评测写前绑定；Main 进程必须是此 Git 提交启动的 Runtime。 */
    expectedRuntimeGitCommit?: string;
    expectedRuntimeBuildId?: string;
    /** 受控样本必须绑定当前 Photoshop UXP Runtime build。 */
    expectedPhotoshopRuntimeBuildId?: string;
    /** 正式样本绑定 live 全身份及 runtime.js / manifest 摘要，buildId 不能单独授权。 */
    expectedPhotoshopRuntimeBinding?: DebugBridgePhotoshopRuntimeBinding;
    /** 开发评测写前绑定；Renderer 必须在调用模型前核对当前选择。 */
    expectedProvider?: string;
    expectedModelId?: string;
    /** 正式成功率样本不接受从 dirty worktree 启动的 Runtime。 */
    requireCleanRuntimeGitState?: boolean;
    /** 从零创作的隔离 Case 要求提交时 Photoshop 没有任何既有文档。 */
    requireNoOpenPhotoshopDocuments?: boolean;
    publicPlanConfirmationSourceMessageId?: string;
    publicPlanConfirmationRequestId?: string;
    publicPlanDisposableLiveAdapter?: boolean;
}

function sha256Buffer(value: Buffer): string {
    return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

function readStableBoundedFile(filePath: string, maxBytes: number, label: string): Buffer {
    const descriptor = fs.openSync(filePath, 'r');
    try {
        const before = fs.fstatSync(descriptor);
        if (!before.isFile() || before.size < 1 || before.size > maxBytes) {
            throw new Error(`${label}超出大小边界。`);
        }
        const bytes = Buffer.allocUnsafe(before.size);
        let offset = 0;
        while (offset < bytes.length) {
            const read = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
            if (read <= 0) throw new Error(`${label}在读取期间发生变化。`);
            offset += read;
        }
        const extra = Buffer.allocUnsafe(1);
        if (fs.readSync(descriptor, extra, 0, 1, offset) !== 0) {
            throw new Error(`${label}在读取期间超过大小边界。`);
        }
        const after = fs.fstatSync(descriptor);
        if (after.size !== before.size
            || after.mtimeMs !== before.mtimeMs
            || after.ctimeMs !== before.ctimeMs) {
            throw new Error(`${label}在读取期间发生变化。`);
        }
        return bytes;
    } finally {
        fs.closeSync(descriptor);
    }
}

function readDebugWorkspaceSemanticDigest(projectPath: string): string {
    const projectRoot = path.resolve(projectPath);
    const metadataPath = path.join(projectRoot, '.designecho', 'project.json');
    let metadata: unknown;
    if (!fs.existsSync(metadataPath)) {
        metadata = undefined;
    } else {
        const stat = fs.lstatSync(metadataPath);
        if (stat.isSymbolicLink() || !stat.isFile()) {
            throw new Error('受控调试项目语义配置不是普通文件。');
        }
        const realProjectRoot = fs.realpathSync.native(projectRoot);
        const realMetadataPath = fs.realpathSync.native(metadataPath);
        const realRelative = path.relative(realProjectRoot, realMetadataPath);
        if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
            throw new Error('受控调试项目语义配置通过 junction 越出项目。');
        }
        const metadataText = readStableBoundedFile(
            realMetadataPath,
            1024 * 1024,
            '受控调试项目语义配置'
        ).toString('utf8');
        try {
            metadata = JSON.parse(metadataText);
        } catch {
            throw new Error('受控调试项目语义配置不是有效 JSON。');
        }
    }
    return sha256Buffer(Buffer.from(stableDebugBridgeJson(
        buildDebugBridgeWorkspaceSemanticSnapshot(metadata)
    ), 'utf8'));
}

const MAX_DEBUG_REFERENCE_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_DEBUG_REFERENCE_PAYLOAD_BYTES = 8 * 1024 * 1024;
const MAX_DEBUG_REFERENCE_TOTAL_PAYLOAD_BYTES = 20 * 1024 * 1024;
const MAX_DEBUG_REFERENCE_PIXELS = 40_000_000;

interface VerifiedDebugProjectAssetPayload {
    references: DebugBridgeProjectAssetReference[];
    attachments: DebugBridgeProjectAssetAttachment[];
    binding: DebugBridgeProjectAssetPayloadBinding;
}

async function verifyDebugProjectAssetReferences(
    projectPath: string,
    references: DebugBridgeProjectAssetReference[]
): Promise<VerifiedDebugProjectAssetPayload> {
    if (references.length === 0) {
        return {
            references: [],
            attachments: [],
            binding: {
                version: 'debug-bridge-project-asset-payload-binding/v1',
                bindingDigest: sha256Buffer(Buffer.from('[]', 'utf8')),
                referenceCount: 0
            }
        };
    }
    const projectRoot = path.resolve(projectPath);
    if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
        throw new Error('受控调试项目目录不存在，无法验证用户参考。');
    }
    const realProjectRoot = fs.realpathSync.native(projectRoot);
    const verifiedReferences: DebugBridgeProjectAssetReference[] = [];
    const attachments: DebugBridgeProjectAssetAttachment[] = [];
    const realPaths = new Set<string>();
    let totalPayloadBytes = 0;
    for (const reference of references) {
        const absolutePath = path.resolve(projectRoot, ...reference.relativePath.split('/'));
        const relative = path.relative(projectRoot, absolutePath);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)
            || !fs.existsSync(absolutePath)
            || fs.lstatSync(absolutePath).isSymbolicLink()
            || !fs.statSync(absolutePath).isFile()) {
            throw new Error(`受控调试参考不是项目内普通文件：${reference.relativePath}`);
        }
        const realFilePath = fs.realpathSync.native(absolutePath);
        const realRelative = path.relative(realProjectRoot, realFilePath);
        if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
            throw new Error(`受控调试参考通过 junction 越出项目：${reference.relativePath}`);
        }
        const realPathIdentity = realFilePath.toLowerCase();
        if (realPaths.has(realPathIdentity)) {
            throw new Error(`受控调试参考重复指向同一文件：${reference.relativePath}`);
        }
        realPaths.add(realPathIdentity);
        const sourceBytes = readStableBoundedFile(
            realFilePath,
            MAX_DEBUG_REFERENCE_SOURCE_BYTES,
            `受控调试参考 ${reference.relativePath}`
        );
        const sourceDigest = sha256Buffer(sourceBytes);
        if (sourceDigest !== reference.digest) {
            throw new Error(`受控调试参考内容与冻结摘要不一致：${reference.relativePath}`);
        }
        let normalized;
        try {
            normalized = await sharp(sourceBytes, {
                failOn: 'error',
                limitInputPixels: MAX_DEBUG_REFERENCE_PIXELS
            })
                .rotate()
                .resize({
                    width: 3072,
                    height: 3072,
                    fit: 'inside',
                    withoutEnlargement: true
                })
                .toColorspace('srgb')
                .flatten({ background: '#ffffff' })
                .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
                .toBuffer({ resolveWithObject: true });
        } catch (error) {
            throw new Error(
                `受控调试参考不是可解码的真实图片：${reference.relativePath}（${error instanceof Error ? error.message : String(error)}）`
            );
        }
        if (!Number.isInteger(normalized.info.width)
            || !Number.isInteger(normalized.info.height)
            || normalized.data.length < 1
            || normalized.data.length > MAX_DEBUG_REFERENCE_PAYLOAD_BYTES) {
            throw new Error(`受控调试参考规范化后超出视觉载荷边界：${reference.relativePath}`);
        }
        totalPayloadBytes += normalized.data.length;
        if (totalPayloadBytes > MAX_DEBUG_REFERENCE_TOTAL_PAYLOAD_BYTES) {
            throw new Error('受控调试参考规范化后的总视觉载荷超过 20 MB。');
        }
        const canonicalRelativePath = realRelative.replace(/\\/g, '/');
        const verifiedReference = {
            ...reference,
            relativePath: canonicalRelativePath,
            digest: sourceDigest
        };
        verifiedReferences.push(verifiedReference);
        attachments.push({
            version: 'debug-bridge-project-asset-attachment/v1',
            relativePath: canonicalRelativePath,
            label: reference.label,
            sourceDigest,
            payloadDigest: sha256Buffer(normalized.data),
            mediaType: 'image/jpeg',
            width: normalized.info.width,
            height: normalized.info.height,
            data: normalized.data.toString('base64')
        });
    }
    const bindingEvidence = attachments.map((attachment) => ({
        relativePath: attachment.relativePath,
        sourceDigest: attachment.sourceDigest,
        payloadDigest: attachment.payloadDigest,
        mediaType: attachment.mediaType,
        width: attachment.width,
        height: attachment.height
    }));
    return {
        references: verifiedReferences,
        attachments,
        binding: {
            version: 'debug-bridge-project-asset-payload-binding/v1',
            bindingDigest: sha256Buffer(Buffer.from(JSON.stringify(bindingEvidence), 'utf8')),
            referenceCount: attachments.length
        }
    };
}

export interface DebugBridgeMessageSummary {
    id: string;
    timestamp: string;
    role: DebugBridgeMessage['role'];
    direction: DebugBridgeMessage['direction'];
    contentPreview: string;
    agent?: string;
    hasMetadata: boolean;
    hasTrace: boolean;
    toolCallCount: number;
    errorCount: number;
    executionSummary?: DebugBridgeExecutionSummaryPreview;
}

export interface DebugBridgeSessionSummary {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    messageCount: number;
    metadataKeys: string[];
    roleCounts: Record<string, number>;
    risk: {
        redacted: true;
        hasMetadata: boolean;
        hasTrace: boolean;
        hasToolCalls: boolean;
        hasErrors: boolean;
    };
    messages?: DebugBridgeMessageSummary[];
}

export interface DebugBridgeReadOptions {
    includeFull?: boolean;
    debugToken?: string;
    messageLimit?: number;
}

interface DebugBridgeOptions {
    host: string;
    port: number;
    dataDir: string;
    onChatSubmitPreflight?: () => Promise<DebugBridgeChatPreflightSnapshot>;
    onChatSubmit?: (input: DebugBridgeChatSubmitInput) => Promise<unknown>;
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

function getAllowedCorsOrigin(req: http.IncomingMessage, port: number): string | undefined {
    const origin = String(req.headers.origin || '').trim();
    if (!origin) return undefined;

    const configured = String(process.env.DESIGNECHO_DEBUG_BRIDGE_ORIGINS || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
    const allowed = configured.length > 0
        ? configured
        : [`http://127.0.0.1:${port}`, `http://localhost:${port}`];

    return allowed.includes(origin) ? origin : undefined;
}

function sendJson(res: http.ServerResponse, statusCode: number, body: unknown, req?: http.IncomingMessage, port = 0): void {
    const payload = JSON.stringify(body, null, 2);
    const headers: Record<string, string> = {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-DesignEcho-Debug-Token',
        'Vary': 'Origin'
    };
    const allowedOrigin = req ? getAllowedCorsOrigin(req, port) : undefined;
    if (allowedOrigin) {
        headers['Access-Control-Allow-Origin'] = allowedOrigin;
    }
    res.writeHead(statusCode, headers);
    res.end(payload);
}

function sendExecutionFailure(
    res: http.ServerResponse,
    statusCode: number,
    failure: DebugBridgeChatExecutionFailure,
    req: http.IncomingMessage,
    port: number
): void {
    sendJson(res, statusCode, {
        success: false,
        error: failure.message,
        failure
    }, req, port);
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

function truncateText(value: string, maxLength: number): string {
    return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

export class DebugBridgeService {
    private server: http.Server | null = null;
    private readonly host: string;
    private readonly port: number;
    private readonly dataDir: string;
    private readonly sessionsDir: string;
    private readonly onChatSubmitPreflight?: DebugBridgeOptions['onChatSubmitPreflight'];
    private readonly onChatSubmit?: DebugBridgeOptions['onChatSubmit'];
    private readonly onEvent?: DebugBridgeOptions['onEvent'];

    constructor(options: DebugBridgeOptions) {
        this.host = options.host;
        this.port = options.port;
        this.dataDir = options.dataDir;
        this.sessionsDir = path.join(this.dataDir, 'sessions');
        this.onChatSubmitPreflight = options.onChatSubmitPreflight;
        this.onChatSubmit = options.onChatSubmit;
        this.onEvent = options.onEvent;
        fs.mkdirSync(this.sessionsDir, { recursive: true });
    }

    start(): void {
        if (this.server) return;

        this.server = http.createServer(async (req, res) => {
            if (!req.url) {
                sendJson(res, 400, { success: false, error: 'Missing URL' }, req, this.port);
                return;
            }

            if (req.method === 'OPTIONS') {
                if (req.headers.origin && !getAllowedCorsOrigin(req, this.port)) {
                    sendJson(res, 403, { success: false, error: 'Origin not allowed' }, req, this.port);
                    return;
                }
                sendJson(res, 200, { success: true }, req, this.port);
                return;
            }

            try {
                await this.handleRequest(req, res);
            } catch (error: any) {
                const failure = readDebugBridgeChatExecutionFailure(error)
                    || buildDebugBridgeChatExecutionFailure({
                        stage: 'unknown',
                        writePossible: true,
                        message: error?.message || 'Debug bridge internal error',
                        code: 'debug_bridge_internal_error'
                    });
                sendExecutionFailure(res, 500, failure, req, this.port);
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
            }, req, this.port);
            return;
        }

        if (method === 'GET' && pathname === '/sessions') {
            sendJson(res, 200, {
                success: true,
                sessions: this.listSessions()
            }, req, this.port);
            return;
        }

        if (method === 'POST' && pathname === '/sessions') {
            const body = safeJsonParse<Record<string, unknown>>(await readRequestBody(req)) || {};
            const session = this.createSession({
                id: typeof body.id === 'string' ? body.id : undefined,
                title: typeof body.title === 'string' ? body.title : undefined,
                metadata: isRecord(body.metadata) ? body.metadata : undefined
            });
            sendJson(res, 201, { success: true, session: this.summarizeSession(session) }, req, this.port);
            return;
        }

        const sessionMatch = pathname.match(/^\/sessions\/([^/]+)$/);
        if (method === 'GET' && sessionMatch) {
            const session = this.readSession(sessionMatch[1]);
            if (!session) {
                sendJson(res, 404, { success: false, error: 'Session not found' }, req, this.port);
                return;
            }
            sendJson(res, 200, {
                success: true,
                session: this.readSessionForDebugOutput(session.id, {
                    includeFull: url.searchParams.get('include') === 'full',
                    debugToken: String(req.headers['x-designecho-debug-token'] || ''),
                    messageLimit: Number(url.searchParams.get('limit')) || undefined
                })
            }, req, this.port);
            return;
        }

        const messageMatch = pathname.match(/^\/sessions\/([^/]+)\/messages$/);
        if (method === 'POST' && messageMatch) {
            const body = safeJsonParse<Record<string, unknown>>(await readRequestBody(req));
            if (!body) {
                sendJson(res, 400, { success: false, error: 'Invalid JSON body' }, req, this.port);
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
                errors: Array.isArray(body.errors) ? body.errors : undefined,
                executionSummary: body.executionSummary
            });

            sendJson(res, 201, { success: true, message: this.summarizeMessage(message) }, req, this.port);
            return;
        }

        if (method === 'POST' && pathname === '/message') {
            const body = safeJsonParse<Record<string, unknown>>(await readRequestBody(req));
            if (!body) {
                sendJson(res, 400, { success: false, error: 'Invalid JSON body' }, req, this.port);
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
                errors: Array.isArray(body.errors) ? body.errors : undefined,
                executionSummary: body.executionSummary
            });

            sendJson(res, 201, { success: true, sessionId: session.id, message: this.summarizeMessage(message) }, req, this.port);
            return;
        }

        if (method === 'GET' && pathname === '/chat/submit/preflight') {
            if (!this.canUseWriteBridge(String(req.headers['x-designecho-debug-token'] || ''))) {
                sendExecutionFailure(res, 403, buildDebugBridgeChatExecutionFailure({
                    stage: 'bridge_preflight',
                    writePossible: false,
                    message: 'Debug write token is missing or invalid',
                    code: 'debug_write_token_invalid'
                }), req, this.port);
                return;
            }
            if (!this.onChatSubmitPreflight) {
                sendExecutionFailure(res, 503, buildDebugBridgeChatExecutionFailure({
                    stage: 'bridge_preflight',
                    writePossible: false,
                    message: 'Chat submit preflight bridge is unavailable',
                    code: 'chat_submit_preflight_unavailable'
                }), req, this.port);
                return;
            }
            const rendererSnapshot = readDebugBridgeChatPreflightSnapshot(
                await this.onChatSubmitPreflight()
            );
            if (!rendererSnapshot) {
                throw createDebugBridgeChatExecutionError(buildDebugBridgeChatExecutionFailure({
                    stage: 'renderer_preflight',
                    writePossible: false,
                    message: 'Renderer returned an invalid chat preflight snapshot',
                    code: 'renderer_preflight_snapshot_invalid'
                }));
            }
            sendJson(res, 200, {
                success: true,
                guardedWriteProtocol: 'debug-bridge-chat-submit/v1',
                renderer: rendererSnapshot
            }, req, this.port);
            return;
        }

        if (method === 'POST' && pathname === '/chat/submit') {
            if (!this.onChatSubmit) {
                sendExecutionFailure(res, 503, buildDebugBridgeChatExecutionFailure({
                    stage: 'bridge_preflight',
                    writePossible: false,
                    message: 'Chat submit bridge is unavailable',
                    code: 'chat_submit_unavailable'
                }), req, this.port);
                return;
            }
            if (!this.canUseWriteBridge(String(req.headers['x-designecho-debug-token'] || ''))) {
                sendExecutionFailure(res, 403, buildDebugBridgeChatExecutionFailure({
                    stage: 'bridge_preflight',
                    writePossible: false,
                    message: 'Debug write token is missing or invalid',
                    code: 'debug_write_token_invalid'
                }), req, this.port);
                return;
            }

            const body = safeJsonParse<Record<string, unknown>>(await readRequestBody(req));
            if (!body) {
                sendExecutionFailure(res, 400, buildDebugBridgeChatExecutionFailure({
                    stage: 'bridge_preflight',
                    writePossible: false,
                    message: 'Invalid JSON body',
                    code: 'chat_submit_body_invalid'
                }), req, this.port);
                return;
            }

            const text = typeof body.text === 'string' ? body.text.trim() : '';
            if (!text) {
                sendExecutionFailure(res, 400, buildDebugBridgeChatExecutionFailure({
                    stage: 'bridge_preflight',
                    writePossible: false,
                    message: 'text is required',
                    code: 'chat_submit_text_missing'
                }), req, this.port);
                return;
            }
            const expectedPhotoshopRuntimeBinding = readDebugBridgePhotoshopRuntimeBinding(
                body.expectedPhotoshopRuntimeBinding
            );
            const hasFormalWriteGuard = typeof body.expectedProjectPath === 'string'
                && Boolean(body.expectedProjectPath.trim())
                && typeof body.expectedRuntimeGitCommit === 'string'
                && /^[0-9a-f]{40}$/i.test(body.expectedRuntimeGitCommit.trim())
                && typeof body.expectedRuntimeBuildId === 'string'
                && Boolean(body.expectedRuntimeBuildId.trim())
                && typeof body.expectedPhotoshopRuntimeBuildId === 'string'
                && Boolean(body.expectedPhotoshopRuntimeBuildId.trim())
                && Boolean(expectedPhotoshopRuntimeBinding)
                && expectedPhotoshopRuntimeBinding?.live.buildId
                    === body.expectedPhotoshopRuntimeBuildId.trim()
                && typeof body.expectedProvider === 'string'
                && Boolean(body.expectedProvider.trim())
                && typeof body.expectedModelId === 'string'
                && Boolean(body.expectedModelId.trim())
                && typeof body.expectedWorkspaceSemanticDigest === 'string'
                && /^sha256:[0-9a-f]{64}$/.test(body.expectedWorkspaceSemanticDigest.trim())
                && body.requireCleanRuntimeGitState === true
                && body.requireNoOpenPhotoshopDocuments === true;
            if (!hasFormalWriteGuard) {
                sendExecutionFailure(res, 400, buildDebugBridgeChatExecutionFailure({
                    stage: 'bridge_preflight',
                    writePossible: false,
                    message: 'Debug chat submit requires the complete guarded-write protocol',
                    code: 'chat_submit_guard_incomplete'
                }), req, this.port);
                return;
            }
            const expectedWorkspaceSemanticDigest = String(
                body.expectedWorkspaceSemanticDigest || ''
            ).trim().toLowerCase();
            let currentWorkspaceSemanticDigest: string;
            try {
                currentWorkspaceSemanticDigest = readDebugWorkspaceSemanticDigest(
                    String(body.expectedProjectPath || '').trim()
                );
            } catch (error) {
                sendExecutionFailure(res, 400, buildDebugBridgeChatExecutionFailure({
                    stage: 'bridge_preflight',
                    writePossible: false,
                    message: error instanceof Error ? error.message : String(error),
                    code: 'chat_submit_workspace_semantic_read_failed'
                }), req, this.port);
                return;
            }
            if (currentWorkspaceSemanticDigest !== expectedWorkspaceSemanticDigest) {
                sendExecutionFailure(res, 409, buildDebugBridgeChatExecutionFailure({
                    stage: 'bridge_preflight',
                    writePossible: false,
                    message: '项目素材分类或设计计划已变化，本轮受控样本没有启动。',
                    code: 'chat_submit_workspace_semantic_mismatch'
                }), req, this.port);
                return;
            }
            const projectAssetReferences = readDebugBridgeProjectAssetReferences(
                body.projectAssetReferences
            );
            if (!projectAssetReferences) {
                sendExecutionFailure(res, 400, buildDebugBridgeChatExecutionFailure({
                    stage: 'bridge_preflight',
                    writePossible: false,
                    message: 'Debug chat project asset references are invalid',
                    code: 'chat_submit_project_references_invalid'
                }), req, this.port);
                return;
            }
            let verifiedProjectAssetPayload: VerifiedDebugProjectAssetPayload;
            try {
                verifiedProjectAssetPayload = await verifyDebugProjectAssetReferences(
                    String(body.expectedProjectPath || '').trim(),
                    projectAssetReferences
                );
            } catch (error) {
                sendExecutionFailure(res, 400, buildDebugBridgeChatExecutionFailure({
                    stage: 'bridge_preflight',
                    writePossible: false,
                    message: error instanceof Error ? error.message : String(error),
                    code: 'chat_submit_project_reference_verification_failed'
                }), req, this.port);
                return;
            }

            const result = await this.onChatSubmit({
                text,
                timeoutMs: Number(body.timeoutMs) || undefined,
                resetConversation: body.resetConversation === true,
                disableSkillBridges: body.disableSkillBridges === true,
                projectAssetReferences: verifiedProjectAssetPayload.references,
                projectAssetAttachments: verifiedProjectAssetPayload.attachments,
                projectAssetPayloadBinding: verifiedProjectAssetPayload.binding,
                expectedWorkspaceSemanticDigest,
                expectedProjectPath: typeof body.expectedProjectPath === 'string'
                    ? body.expectedProjectPath.trim().slice(0, 1024)
                    : undefined,
                expectedRuntimeGitCommit: typeof body.expectedRuntimeGitCommit === 'string'
                    ? body.expectedRuntimeGitCommit.trim().slice(0, 64)
                    : undefined,
                expectedRuntimeBuildId: typeof body.expectedRuntimeBuildId === 'string'
                    ? body.expectedRuntimeBuildId.trim().slice(0, 256)
                    : undefined,
                expectedPhotoshopRuntimeBuildId: typeof body.expectedPhotoshopRuntimeBuildId === 'string'
                    ? body.expectedPhotoshopRuntimeBuildId.trim().slice(0, 256)
                    : undefined,
                expectedPhotoshopRuntimeBinding,
                expectedProvider: typeof body.expectedProvider === 'string'
                    ? body.expectedProvider.trim().slice(0, 128)
                    : undefined,
                expectedModelId: typeof body.expectedModelId === 'string'
                    ? body.expectedModelId.trim().slice(0, 256)
                    : undefined,
                requireCleanRuntimeGitState: body.requireCleanRuntimeGitState === true,
                requireNoOpenPhotoshopDocuments: body.requireNoOpenPhotoshopDocuments === true,
                publicPlanConfirmationSourceMessageId: typeof body.publicPlanConfirmationSourceMessageId === 'string'
                    ? body.publicPlanConfirmationSourceMessageId
                    : undefined,
                publicPlanConfirmationRequestId: typeof body.publicPlanConfirmationRequestId === 'string'
                    ? body.publicPlanConfirmationRequestId
                    : undefined,
                publicPlanDisposableLiveAdapter: body.publicPlanDisposableLiveAdapter === true
            });
            const resultRecord = result && typeof result === 'object' && !Array.isArray(result)
                ? result as Record<string, unknown>
                : {};
            const resultReceipt = resultRecord['receipt'];
            const receiptRecord = resultReceipt && typeof resultReceipt === 'object' && !Array.isArray(resultReceipt)
                ? resultReceipt as Record<string, unknown>
                : {};
            if (verifiedProjectAssetPayload.binding.referenceCount > 0) {
                const providerReceipt = readDebugBridgeProjectAssetProviderReceipt(
                    receiptRecord['projectAssetProviderBindingReceipt']
                );
                if (!providerReceipt || !debugBridgeProjectAssetProviderReceiptMatches(
                    providerReceipt,
                    verifiedProjectAssetPayload.binding
                )) {
                    sendExecutionFailure(res, 500, buildDebugBridgeChatExecutionFailure({
                        stage: 'completion',
                        writePossible: true,
                        message: '用户目标参考没有被证明进入本次 Provider 视觉请求。',
                        code: 'chat_submit_project_reference_provider_binding_missing'
                    }), req, this.port);
                    return;
                }
            }
            sendJson(res, 200, {
                success: true,
                result: {
                    ...resultRecord,
                    receipt: {
                        ...receiptRecord,
                        projectAssetPayloadBinding: verifiedProjectAssetPayload.binding
                    }
                }
            }, req, this.port);
            return;
        }

        sendJson(res, 404, { success: false, error: `Not found: ${pathname}` }, req, this.port);
    }

    private sessionPath(sessionId: string): string {
        return path.join(this.sessionsDir, `${sanitizeSessionId(sessionId)}.json`);
    }

    public createSession(input: DebugBridgeCreateSessionInput): DebugBridgeSession {
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

    public appendMessage(sessionId: string, input: DebugBridgeAppendMessageInput): DebugBridgeMessage {
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
            errors: input.errors,
            executionSummary: normalizeExecutionSummary(input.executionSummary)
        };

        session.messages.push(message);
        session.updatedAt = message.timestamp;
        this.writeSession(session);
        this.writeLatestPointers(session, message);
        this.onEvent?.({ type: 'message.appended', sessionId: session.id, payload: message });
        return message;
    }

    public listSessions(): Array<Pick<DebugBridgeSession, 'id' | 'title' | 'createdAt' | 'updatedAt'> & { messageCount: number }> {
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

    public readSession(sessionId: string): DebugBridgeSession | null {
        const filePath = this.sessionPath(sessionId);
        if (!fs.existsSync(filePath)) return null;
        return safeJsonParse<DebugBridgeSession>(fs.readFileSync(filePath, 'utf8'));
    }

    public canReadFullDebugData(debugToken?: string): boolean {
        const expected = String(process.env.DESIGNECHO_DEBUG_TOKEN || '').trim();
        const supplied = String(debugToken || '');
        if (!expected) return false;
        const expectedBuffer = Buffer.from(expected, 'utf8');
        const suppliedBuffer = Buffer.from(supplied, 'utf8');
        if (expectedBuffer.length !== suppliedBuffer.length) return false;
        return crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
    }

    public canUseWriteBridge(debugToken?: string): boolean {
        return this.canReadFullDebugData(debugToken);
    }

    public readSessionForDebugOutput(sessionId: string, options: DebugBridgeReadOptions = {}): DebugBridgeSession | DebugBridgeSessionSummary | null {
        const session = this.readSession(sessionId);
        if (!session) return null;
        if (options.includeFull && this.canReadFullDebugData(options.debugToken)) {
            return session;
        }
        return this.summarizeSession(session, options);
    }

    public summarizeSession(session: DebugBridgeSession, options: { messageLimit?: number } = {}): DebugBridgeSessionSummary {
        const limit = Math.max(0, Math.min(100, Number(options.messageLimit ?? 20)));
        const messages = limit > 0 ? session.messages.slice(-limit).map(message => this.summarizeMessage(message)) : undefined;
        const roleCounts: Record<string, number> = {};
        for (const message of session.messages) {
            roleCounts[message.role] = (roleCounts[message.role] || 0) + 1;
        }

        return {
            id: session.id,
            title: session.title,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            messageCount: session.messages.length,
            metadataKeys: session.metadata ? Object.keys(session.metadata).sort() : [],
            roleCounts,
            risk: {
                redacted: true,
                hasMetadata: !!session.metadata && Object.keys(session.metadata).length > 0,
                hasTrace: session.messages.some(message => !!message.trace),
                hasToolCalls: session.messages.some(message => Array.isArray(message.toolCalls) && message.toolCalls.length > 0),
                hasErrors: session.messages.some(message => Array.isArray(message.errors) && message.errors.length > 0)
            },
            ...(messages ? { messages } : {})
        };
    }

    public summarizeMessage(message: DebugBridgeMessage): DebugBridgeMessageSummary {
        return {
            id: message.id,
            timestamp: message.timestamp,
            role: message.role,
            direction: message.direction,
            contentPreview: truncateText(message.content, 500),
            agent: message.agent,
            hasMetadata: !!message.metadata && Object.keys(message.metadata).length > 0,
            hasTrace: !!message.trace && Object.keys(message.trace).length > 0,
            toolCallCount: Array.isArray(message.toolCalls) ? message.toolCalls.length : 0,
            errorCount: Array.isArray(message.errors) ? message.errors.length : 0,
            executionSummary: summarizeExecutionSummary(message.executionSummary)
        };
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

function optionalString(value: unknown, maxLength = 300): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed ? truncateText(trimmed, maxLength) : undefined;
}

function optionalNumber(value: unknown): number | undefined {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : undefined;
}

function optionalStringArray(value: unknown, maxItems = 20): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const items = value
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .slice(0, maxItems)
        .map(item => truncateText(item.trim(), 300));
    return items.length > 0 ? items : undefined;
}

function normalizeExecutionSummary(value: unknown): DebugBridgeExecutionSummary | undefined {
    if (!isRecord(value)) return undefined;

    const status = optionalString(value.status, 40);
    if (!status) return undefined;

    return {
        status,
        stopReason: optionalString(value.stopReason, 80),
        iterations: optionalNumber(value.iterations),
        toolCallCount: optionalNumber(value.toolCallCount),
        successfulToolCalls: optionalNumber(value.successfulToolCalls),
        failedToolCalls: optionalNumber(value.failedToolCalls),
        acceptanceVerified: optionalNumber(value.acceptanceVerified),
        acceptanceFailed: optionalNumber(value.acceptanceFailed),
        acceptanceNeedsReview: optionalNumber(value.acceptanceNeedsReview),
        noDocumentChangeRisks: optionalNumber(value.noDocumentChangeRisks),
        lastToolName: optionalString(value.lastToolName, 120),
        lastError: optionalString(value.lastError, 500),
        blockers: optionalStringArray(value.blockers),
        warnings: optionalStringArray(value.warnings),
        summaryText: optionalString(value.summaryText, 1000)
    };
}

function summarizeExecutionSummary(summary?: DebugBridgeExecutionSummary): DebugBridgeExecutionSummaryPreview | undefined {
    if (!summary) return undefined;
    return {
        status: summary.status,
        stopReason: summary.stopReason,
        iterations: summary.iterations,
        toolCallCount: summary.toolCallCount,
        successfulToolCalls: summary.successfulToolCalls,
        failedToolCalls: summary.failedToolCalls,
        acceptanceVerified: summary.acceptanceVerified,
        acceptanceFailed: summary.acceptanceFailed,
        acceptanceNeedsReview: summary.acceptanceNeedsReview,
        noDocumentChangeRisks: summary.noDocumentChangeRisks,
        lastToolName: summary.lastToolName,
        blockerCount: summary.blockers?.length || 0,
        warningCount: summary.warnings?.length || 0,
        summaryText: summary.summaryText ? truncateText(summary.summaryText, 500) : undefined
    };
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
