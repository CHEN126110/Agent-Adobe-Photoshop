import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import readline, { type Interface as ReadLineInterface } from 'readline';

import { CODEX_SUBSCRIPTION_RUNTIME_VERSION } from '../../shared/codex-subscription-contract';

interface JsonRpcErrorShape {
    code?: number;
    message?: string;
    data?: unknown;
}

interface JsonRpcMessage {
    id?: number | string;
    method?: string;
    params?: any;
    result?: any;
    error?: JsonRpcErrorShape;
}

interface PendingRequest {
    resolve: (value: any) => void;
    reject: (reason: Error) => void;
    timer: NodeJS.Timeout;
}

interface CodexConfigReadResponse {
    config?: unknown;
}

export interface CodexAppServerNotification {
    method: string;
    params: any;
}

export interface CodexAppServerRequest {
    id: number | string;
    method: string;
    params: any;
}

export interface CodexAppServerClientOptions {
    codexHomeDir: string;
    runtimeDir: string;
    clientVersion: string;
    featureProfile?: 'model_bridge' | 'image_generation';
}

interface CodexTarget {
    packageName: string;
    triple: string;
    executableName: string;
}

const CODEX_TARGETS: Record<string, CodexTarget> = {
    'win32-x64': {
        packageName: '@openai/codex-win32-x64',
        triple: 'x86_64-pc-windows-msvc',
        executableName: 'codex.exe'
    },
    'win32-arm64': {
        packageName: '@openai/codex-win32-arm64',
        triple: 'aarch64-pc-windows-msvc',
        executableName: 'codex.exe'
    },
    'darwin-x64': {
        packageName: '@openai/codex-darwin-x64',
        triple: 'x86_64-apple-darwin',
        executableName: 'codex'
    },
    'darwin-arm64': {
        packageName: '@openai/codex-darwin-arm64',
        triple: 'aarch64-apple-darwin',
        executableName: 'codex'
    },
    'linux-x64': {
        packageName: '@openai/codex-linux-x64',
        triple: 'x86_64-unknown-linux-musl',
        executableName: 'codex'
    },
    'linux-arm64': {
        packageName: '@openai/codex-linux-arm64',
        triple: 'aarch64-unknown-linux-musl',
        executableName: 'codex'
    }
};

const DISABLED_CODEX_FEATURES = [
    'apps',
    'auth_elicitation',
    'browser_use',
    'browser_use_external',
    'browser_use_full_cdp_access',
    'code_mode_host',
    'computer_use',
    'goals',
    'guardian_approval',
    'hooks',
    'image_generation',
    'in_app_browser',
    'in_app_chat',
    'in_app_dictation',
    'in_app_updates',
    'memories',
    'multi_agent',
    'plugin_sharing',
    'plugins',
    'remote_plugin',
    'shell_snapshot',
    'shell_tool',
    'skill_mcp_dependency_install',
    'skill_search',
    'tool_suggest',
    'unified_exec',
    'unbounded_connection_retries',
    'view_image',
    'workspace_dependencies'
] as const;

const SAFE_ENVIRONMENT_KEYS = new Set([
    'APPDATA',
    'COMSPEC',
    'LANG',
    'LC_ALL',
    'LOCALAPPDATA',
    'NUMBER_OF_PROCESSORS',
    'OS',
    'PATH',
    'PATHEXT',
    'PROCESSOR_ARCHITECTURE',
    'PROCESSOR_IDENTIFIER',
    'PROGRAMDATA',
    'SYSTEMDRIVE',
    'SYSTEMROOT',
    'TEMP',
    'TMP',
    'USERDOMAIN',
    'USERNAME',
    'USERPROFILE',
    'WINDIR'
]);

const DEFAULT_RPC_TIMEOUT_MS = 30_000;

function createRuntimeError(message: string, code: string): Error {
    const error = new Error(message) as Error & { code?: string };
    error.name = 'CodexAppServerError';
    error.code = code;
    return error;
}

function resolveCodexTarget(): CodexTarget {
    const target = CODEX_TARGETS[`${process.platform}-${process.arch}`];
    if (!target) {
        throw createRuntimeError(
            `当前平台 ${process.platform}/${process.arch} 没有可用的内置 Codex Runtime。`,
            'codex_runtime_platform_unsupported'
        );
    }
    return target;
}

function toUnpackedAsarPath(candidate: string): string {
    return candidate.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
}

function resolveBundledCodexExecutable(): string {
    const target = resolveCodexTarget();
    let packageJsonPath = '';
    try {
        packageJsonPath = require.resolve(`${target.packageName}/package.json`);
    } catch {
        throw createRuntimeError(
            `内置 Codex Runtime 缺少平台包 ${target.packageName}，请重新安装或重新打包 DesignEcho。`,
            'codex_runtime_missing'
        );
    }

    const packageRoot = path.dirname(packageJsonPath);
    const relativeExecutable = path.join('vendor', target.triple, 'bin', target.executableName);
    const resolved = path.join(packageRoot, relativeExecutable);
    const candidates = [
        toUnpackedAsarPath(resolved),
        path.join(
            process.resourcesPath || '',
            'app.asar.unpacked',
            'node_modules',
            ...target.packageName.split('/'),
            relativeExecutable
        ),
        resolved
    ];
    // Electron 的 patched fs 会让 app.asar 内标记为 unpacked 的虚拟路径也返回 exists=true，
    // 但 child_process.spawn 不能执行该虚拟路径。长驻 stdio Runtime 必须选择真实磁盘文件。
    const executable = candidates.find((candidate) => (
        candidate
        && !/[\\/]app\.asar[\\/]/i.test(candidate)
        && fs.existsSync(candidate)
    ));
    if (!executable) {
        throw createRuntimeError(
            '没有找到内置 Codex 可执行文件。开发环境请重新安装依赖；安装包请检查 asarUnpack。',
            'codex_runtime_executable_missing'
        );
    }
    return executable;
}

function assertBundledCodeModeHost(codexExecutable: string): void {
    const executableName = process.platform === 'win32'
        ? 'codex-code-mode-host.exe'
        : 'codex-code-mode-host';
    const hostExecutable = path.join(path.dirname(codexExecutable), executableName);
    if (!fs.existsSync(hostExecutable)) {
        throw createRuntimeError(
            '内置 Codex Runtime 缺少订阅生图所需的 code-mode host，请重新安装或重新打包 DesignEcho。',
            'codex_code_mode_host_missing'
        );
    }
}

function buildSanitizedEnvironment(codexHomeDir: string): NodeJS.ProcessEnv {
    const environment: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (SAFE_ENVIRONMENT_KEYS.has(key.toUpperCase()) && value !== undefined) {
            environment[key] = value;
        }
    }
    environment.CODEX_HOME = codexHomeDir;
    environment.CODEX_MANAGED_BY_NPM = '1';
    environment.NO_COLOR = '1';
    return environment;
}

function buildCodexArguments(featureProfile: CodexAppServerClientOptions['featureProfile']): string[] {
    const args = [
        'app-server',
        '--stdio',
        '--strict-config',
        '-c',
        'cli_auth_credentials_store="keyring"',
        '-c',
        'analytics.enabled=false',
        '-c',
        'web_search="disabled"',
        '-c',
        'tools.update_plan.enabled=false',
        '-c',
        'tools.experimental_request_user_input.enabled=false'
    ];
    for (const feature of DISABLED_CODEX_FEATURES) {
        if (
            featureProfile === 'image_generation'
            && (feature === 'image_generation' || feature === 'code_mode_host')
        ) {
            continue;
        }
        args.push('--disable', feature);
    }
    if (featureProfile === 'image_generation') {
        args.push('--enable', 'image_generation', '--enable', 'code_mode_host');
    }
    return args;
}

function parseRuntimeVersion(userAgent: string): string {
    // 0.149 返回的品牌前缀不是稳定 API（不同构建可为 codex_cli_rs / codex_app_server）；
    // 版本号才是与本应用锁定协议进行兼容校验的字段。
    const match = String(userAgent || '').match(/(?:^|[^0-9])(\d+\.\d+\.\d+)(?:[^0-9]|$)/);
    return match?.[1] || '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isOfficialChatGptBaseUrl(value: unknown): boolean {
    if (typeof value !== 'string' || !value.trim()) return false;
    try {
        const parsed = new URL(String(value));
        return parsed.protocol === 'https:'
            && parsed.hostname.toLowerCase() === 'chatgpt.com'
            && (parsed.pathname === '/backend-api' || parsed.pathname === '/backend-api/')
            && !parsed.username
            && !parsed.password
            && !parsed.search
            && !parsed.hash;
    } catch {
        return false;
    }
}

function assertSafeRuntimeConfiguration(response: CodexConfigReadResponse): void {
    if (!isRecord(response?.config)) {
        throw createRuntimeError(
            'Codex Runtime 没有返回可验证的隔离配置，DesignEcho 已拒绝启动。',
            'codex_runtime_unsafe_configuration'
        );
    }
    const config = response.config;
    const requiredFields = [
        'model_provider',
        'openai_base_url',
        'chatgpt_base_url',
        'model_providers',
        'mcp_servers',
        'cli_auth_credentials_store'
    ];
    const hasRequiredShape = requiredFields.every((field) => (
        Object.prototype.hasOwnProperty.call(config, field)
    ));
    const hasOfficialProvider = config.model_provider === null || config.model_provider === 'openai';
    const customProviders = isRecord(config.model_providers) ? Object.keys(config.model_providers) : [];
    const enabledMcpServers = isRecord(config.mcp_servers)
        ? Object.values(config.mcp_servers).filter((entry) => !isRecord(entry) || entry.enabled !== false)
        : [];
    const hasOfficialOpenAiBaseUrl = config.openai_base_url === null || config.openai_base_url === '';
    if (
        !hasRequiredShape
        || !isRecord(config.model_providers)
        || !isRecord(config.mcp_servers)
        || config.cli_auth_credentials_store !== 'keyring'
        || !hasOfficialProvider
        || customProviders.length > 0
        || !hasOfficialOpenAiBaseUrl
        || !isOfficialChatGptBaseUrl(config.chatgpt_base_url)
        || enabledMcpServers.length > 0
    ) {
        throw createRuntimeError(
            '隔离的 Codex Runtime 不符合安全基线：必须使用 keyring、官方 OpenAI Provider，且不得启用 MCP。DesignEcho 已拒绝启动该配置。',
            'codex_runtime_unsafe_configuration'
        );
    }
}

export class CodexAppServerClient extends EventEmitter {
    private readonly options: CodexAppServerClientOptions;
    private child: ChildProcessWithoutNullStreams | null = null;
    private stdoutReader: ReadLineInterface | null = null;
    private nextRequestId = 1;
    private pendingRequests = new Map<number | string, PendingRequest>();
    private startingPromise: Promise<void> | null = null;
    private disposed = false;
    private intentionalStop = false;
    private runtimeVersion = '';
    private workerGeneration = 0;
    private failedChildren = new WeakSet<ChildProcessWithoutNullStreams>();

    constructor(options: CodexAppServerClientOptions) {
        super();
        this.options = options;
    }

    getRuntimeVersion(): string {
        return this.runtimeVersion || CODEX_SUBSCRIPTION_RUNTIME_VERSION;
    }

    getGeneration(): number {
        return this.workerGeneration;
    }

    async ensureStarted(): Promise<void> {
        if (this.disposed) {
            throw createRuntimeError('Codex Runtime 已关闭。', 'codex_runtime_disposed');
        }
        if (this.startingPromise) return this.startingPromise;
        if (this.child && !this.child.killed) return;

        this.startingPromise = this.startProcess();
        try {
            await this.startingPromise;
        } finally {
            this.startingPromise = null;
        }
    }

    async request<T>(method: string, params: unknown = {}, timeoutMs = DEFAULT_RPC_TIMEOUT_MS): Promise<T> {
        await this.ensureStarted();
        return this.sendStartedRequest<T>(method, params, timeoutMs);
    }

    async requestWithGeneration<T>(
        method: string,
        params: unknown = {},
        timeoutMs = DEFAULT_RPC_TIMEOUT_MS
    ): Promise<{ result: T; generation: number }> {
        await this.ensureStarted();
        const generation = this.workerGeneration;
        const result = await this.sendStartedRequest<T>(method, params, timeoutMs);
        return { result, generation };
    }

    requestIfRunning<T>(
        expectedGeneration: number,
        method: string,
        params: unknown = {},
        timeoutMs = DEFAULT_RPC_TIMEOUT_MS
    ): Promise<T | undefined> {
        const child = this.child;
        if (
            this.disposed
            || expectedGeneration !== this.workerGeneration
            || !child
            || child.killed
            || !child.stdin.writable
        ) {
            return Promise.resolve(undefined);
        }
        return this.sendStartedRequest<T>(method, params, timeoutMs);
    }

    async restart(): Promise<void> {
        if (this.disposed) return;
        await this.stopProcess();
    }

    async dispose(): Promise<void> {
        if (this.disposed) return;
        this.disposed = true;
        await this.stopProcess();
        this.removeAllListeners();
    }

    private async startProcess(): Promise<void> {
        fs.mkdirSync(this.options.codexHomeDir, { recursive: true });
        fs.mkdirSync(this.options.runtimeDir, { recursive: true });

        const executable = resolveBundledCodexExecutable();
        if (this.options.featureProfile === 'image_generation') {
            assertBundledCodeModeHost(executable);
        }
        this.intentionalStop = false;
        const child = spawn(executable, buildCodexArguments(this.options.featureProfile), {
            cwd: this.options.runtimeDir,
            env: buildSanitizedEnvironment(this.options.codexHomeDir),
            shell: false,
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe']
        });
        this.workerGeneration += 1;
        this.child = child;
        child.stderr.resume();

        child.once('error', (error) => {
            this.handleChildFailure(
                child,
                createRuntimeError(
                    `内置 Codex Runtime 启动失败：${error.message}`,
                    'codex_runtime_spawn_failed'
                )
            );
        });
        child.once('exit', (code, signal) => {
            const suffix = signal ? `signal=${signal}` : `exitCode=${code ?? 'unknown'}`;
            this.handleChildFailure(
                child,
                createRuntimeError(
                    `内置 Codex Runtime 已退出（${suffix}）。下次调用会重新启动。`,
                    'codex_runtime_exited'
                )
            );
        });
        child.stdin.once('error', (error) => {
            this.handleChildFailure(
                child,
                createRuntimeError(
                    `Codex Runtime 输入管道已断开：${error.message}`,
                    'codex_runtime_pipe_failed'
                )
            );
        });
        child.stdout.once('error', (error) => {
            this.handleChildFailure(
                child,
                createRuntimeError(
                    `Codex Runtime 输出管道已断开：${error.message}`,
                    'codex_runtime_pipe_failed'
                )
            );
        });

        this.stdoutReader = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
        this.stdoutReader.on('line', (line) => this.handleLine(line));

        try {
            const initialized = await this.sendStartedRequest<{ userAgent?: string }>(
                'initialize',
                {
                    clientInfo: {
                        name: 'designecho',
                        title: 'DesignEcho',
                        version: this.options.clientVersion
                    },
                    capabilities: { experimentalApi: true }
                },
                DEFAULT_RPC_TIMEOUT_MS
            );
            this.runtimeVersion = parseRuntimeVersion(initialized?.userAgent || '');
            if (this.runtimeVersion !== CODEX_SUBSCRIPTION_RUNTIME_VERSION) {
                throw createRuntimeError(
                    `内置 Codex Runtime 版本不兼容：需要 ${CODEX_SUBSCRIPTION_RUNTIME_VERSION}，实际为 ${this.runtimeVersion || '未知'}。`,
                    'codex_runtime_version_mismatch'
                );
            }
            this.writeMessage({ method: 'initialized', params: {} });
            const configSnapshot = await this.sendStartedRequest<CodexConfigReadResponse>(
                'config/read',
                {
                    includeLayers: true,
                    cwd: this.options.runtimeDir
                },
                DEFAULT_RPC_TIMEOUT_MS
            );
            assertSafeRuntimeConfiguration(configSnapshot);
        } catch (error) {
            await this.stopProcess();
            throw error;
        }
    }

    private sendStartedRequest<T>(method: string, params: unknown, timeoutMs: number): Promise<T> {
        const child = this.child;
        if (!child || child.killed || !child.stdin.writable) {
            return Promise.reject(
                createRuntimeError('Codex Runtime 尚未就绪。', 'codex_runtime_not_ready')
            );
        }

        const id = this.nextRequestId++;
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(createRuntimeError(
                    `Codex Runtime 请求超时（${method}）。`,
                    'codex_runtime_rpc_timeout'
                ));
            }, Math.max(1_000, timeoutMs));
            this.pendingRequests.set(id, { resolve, reject, timer });
            try {
                this.writeMessage({ id, method, params });
            } catch (error) {
                clearTimeout(timer);
                this.pendingRequests.delete(id);
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }

    private writeMessage(message: JsonRpcMessage): void {
        const child = this.child;
        if (!child || child.killed || !child.stdin.writable) {
            throw createRuntimeError('Codex Runtime 连接已关闭。', 'codex_runtime_pipe_closed');
        }
        try {
            child.stdin.write(`${JSON.stringify(message)}\n`, 'utf8', (error) => {
                if (!error) return;
                this.handleChildFailure(
                    child,
                    createRuntimeError(
                        `Codex Runtime 输入管道写入失败：${error.message}`,
                        'codex_runtime_pipe_failed'
                    )
                );
            });
        } catch (error) {
            const runtimeError = createRuntimeError(
                `Codex Runtime 输入管道写入失败：${error instanceof Error ? error.message : String(error)}`,
                'codex_runtime_pipe_failed'
            );
            this.handleChildFailure(child, runtimeError);
            throw runtimeError;
        }
    }

    private handleLine(rawLine: string): void {
        const line = String(rawLine || '').trim();
        if (!line) return;

        let message: JsonRpcMessage;
        try {
            message = JSON.parse(line) as JsonRpcMessage;
        } catch {
            this.emit('protocol-warning', 'Codex Runtime 返回了无法解析的协议行。');
            return;
        }

        if (message.id !== undefined && !message.method) {
            const pending = this.pendingRequests.get(message.id);
            if (!pending) return;
            this.pendingRequests.delete(message.id);
            clearTimeout(pending.timer);
            if (message.error) {
                pending.reject(createRuntimeError(
                    `Codex Runtime 请求失败：${message.error.message || '未知协议错误'}`,
                    'codex_runtime_rpc_failed'
                ));
            } else {
                pending.resolve(message.result);
            }
            return;
        }

        if (message.id !== undefined && message.method) {
            const request: CodexAppServerRequest = {
                id: message.id,
                method: message.method,
                params: message.params
            };
            this.emit('server-request', request);
            try {
                this.writeMessage({
                    id: message.id,
                    error: {
                        code: -32601,
                        message: 'DesignEcho 的订阅模型桥不允许 Codex Runtime 请求宿主工具或权限。'
                    }
                });
            } catch {
                // writeMessage 已统一关闭失效子进程并拒绝在途请求。
            }
            return;
        }

        if (message.method) {
            this.emit('notification', {
                method: message.method,
                params: message.params
            } satisfies CodexAppServerNotification);
        }
    }

    private rejectAllPending(error: Error): void {
        for (const pending of this.pendingRequests.values()) {
            clearTimeout(pending.timer);
            pending.reject(error);
        }
        this.pendingRequests.clear();
    }

    private handleChildFailure(child: ChildProcessWithoutNullStreams, error: Error): void {
        if (this.child !== child || this.failedChildren.has(child)) return;
        this.failedChildren.add(child);
        this.child = null;
        this.runtimeVersion = '';
        this.stdoutReader?.close();
        this.stdoutReader = null;
        if (child.exitCode === null && !child.killed) {
            try {
                child.kill();
            } catch {
                // 原始 failure 才是调用方需要看到的根因；终止失效 worker 只能 best-effort。
            }
        }
        this.rejectAllPending(error);
        if (!this.intentionalStop) this.emit('runtime-exit', error);
    }

    private async stopProcess(): Promise<void> {
        const child = this.child;
        this.intentionalStop = true;
        this.child = null;
        this.runtimeVersion = '';
        this.stdoutReader?.close();
        this.stdoutReader = null;
        this.rejectAllPending(createRuntimeError(
            'Codex Runtime 已停止。',
            'codex_runtime_stopped'
        ));
        if (!child || child.killed) return;
        await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 1_500);
            child.once('exit', () => {
                clearTimeout(timer);
                resolve();
            });
            child.kill();
        });
    }
}
