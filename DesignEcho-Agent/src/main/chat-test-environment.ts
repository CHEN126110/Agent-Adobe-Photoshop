import fs from 'fs';
import path from 'path';

export interface ChatTestEnvironmentInput {
    environment: Readonly<Record<string, string | undefined>>;
    isPackaged: boolean;
    normalUserDataDir: string;
    appPath: string;
    tempDir: string;
}

export interface ChatTestEnvironmentEnvelope {
    enabled: boolean;
    bridgeEnabled: boolean;
    environmentKeys: string[];
    testUserDataDir: string;
    projectPath: string;
    remoteDebuggingPort: number | null;
    reuseNormalCodexSubscriptionSession: boolean;
}

const EXACT_CHAT_TEST_ENVIRONMENT_KEYS = new Set([
    'DESIGNECHO_TEST_USER_DATA_DIR',
    'DESIGNECHO_TEST_REUSE_CODEX_SUBSCRIPTION_SESSION',
    'DESIGNECHO_REMOTE_DEBUGGING_PORT'
]);

function isStrictPathDescendant(rootPath: string, targetPath: string): boolean {
    const relative = path.relative(rootPath, targetPath);
    return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function resolveExistingDirectoryRealPath(environmentName: string, rawPath: string): string {
    const resolvedPath = path.resolve(rawPath);
    if (!fs.existsSync(resolvedPath)) {
        throw new Error(`${environmentName} must point to an existing directory.`);
    }
    const pathStat = fs.lstatSync(resolvedPath);
    if (!pathStat.isDirectory() || pathStat.isSymbolicLink()) {
        throw new Error(`${environmentName} cannot use a symlink, junction, or non-directory path.`);
    }
    return fs.realpathSync.native(resolvedPath);
}

function collectChatTestEnvironmentKeys(
    environment: Readonly<Record<string, string | undefined>>
): string[] {
    return Object.keys(environment)
        .filter((key) => (
            key.startsWith('DESIGNECHO_CHAT_TEST_')
            || EXACT_CHAT_TEST_ENVIRONMENT_KEYS.has(key)
        ))
        .sort();
}

function parseRemoteDebuggingPort(rawValue: string | undefined): number | null {
    const raw = rawValue?.trim();
    if (!raw) return null;
    if (!/^\d+$/.test(raw)) {
        throw new Error('DESIGNECHO_REMOTE_DEBUGGING_PORT must be an integer port between 1024 and 65535.');
    }
    const port = Number(raw);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        throw new Error('DESIGNECHO_REMOTE_DEBUGGING_PORT must be an integer port between 1024 and 65535.');
    }
    return port;
}

function resolveSafeTestUserDataDir(input: {
    rawUserDataDir: string;
    normalUserDataDir: string;
    tempRoot: string;
}): string {
    const resolvedTestUserDataDir = path.resolve(input.rawUserDataDir);
    const normalUserDataPath = path.resolve(input.normalUserDataDir);
    const resolvedNormalUserDataDir = fs.existsSync(normalUserDataPath)
        ? fs.realpathSync.native(normalUserDataPath)
        : normalUserDataPath;
    if (!isStrictPathDescendant(input.tempRoot, resolvedTestUserDataDir)
        || resolvedTestUserDataDir === resolvedNormalUserDataDir
        || isStrictPathDescendant(resolvedNormalUserDataDir, resolvedTestUserDataDir)
        || isStrictPathDescendant(resolvedTestUserDataDir, resolvedNormalUserDataDir)) {
        throw new Error(
            'DESIGNECHO_TEST_USER_DATA_DIR must be an isolated descendant of OS temp and must not overlap normal DesignEcho userData.'
        );
    }
    const realTestUserDataDir = resolveExistingDirectoryRealPath(
        'DESIGNECHO_TEST_USER_DATA_DIR',
        resolvedTestUserDataDir
    );
    if (!isStrictPathDescendant(input.tempRoot, realTestUserDataDir)) {
        throw new Error('DESIGNECHO_TEST_USER_DATA_DIR cannot use a symlink, junction, or path outside OS temp.');
    }
    return realTestUserDataDir;
}

function resolveSafeChatTestProjectPath(input: {
    rawProjectPath: string;
    appPath: string;
    tempRoot: string;
}): string {
    const realProjectPath = resolveExistingDirectoryRealPath(
        'DESIGNECHO_CHAT_TEST_PROJECT_PATH',
        input.rawProjectPath
    );
    const repositoryTempPath = path.resolve(input.appPath, 'tmp');
    const safeProjectRoots = [input.tempRoot];
    if (fs.existsSync(repositoryTempPath)) {
        safeProjectRoots.push(fs.realpathSync.native(repositoryTempPath));
    }
    if (!safeProjectRoots.some((rootPath) => isStrictPathDescendant(rootPath, realProjectPath))) {
        throw new Error(
            'DESIGNECHO_CHAT_TEST_PROJECT_PATH must be a disposable directory under repository tmp or OS temp.'
        );
    }
    if (fs.existsSync(path.join(realProjectPath, '.designecho'))) {
        throw new Error(
            'DESIGNECHO_CHAT_TEST_PROJECT_PATH must be a fresh one-time directory without prior .designecho runtime state.'
        );
    }
    return realProjectPath;
}

export function resolveChatTestEnvironmentEnvelope(
    input: ChatTestEnvironmentInput
): ChatTestEnvironmentEnvelope {
    const environmentKeys = collectChatTestEnvironmentKeys(input.environment);
    const bridgeEnabled = input.environment.DESIGNECHO_CHAT_TEST_BRIDGE === '1';
    const rawUserDataDir = input.environment.DESIGNECHO_TEST_USER_DATA_DIR?.trim() || '';
    const rawProjectPath = input.environment.DESIGNECHO_CHAT_TEST_PROJECT_PATH?.trim() || '';
    if (environmentKeys.length === 0) {
        return {
            enabled: false,
            bridgeEnabled: false,
            environmentKeys,
            testUserDataDir: '',
            projectPath: '',
            remoteDebuggingPort: null,
            reuseNormalCodexSubscriptionSession: false
        };
    }
    if (input.isPackaged || !bridgeEnabled || !rawUserDataDir || !rawProjectPath) {
        throw new Error(
            'Chat test/debug flags require an unpackaged test bridge with isolated userData and project directories. '
            + `Rejected flags: ${environmentKeys.join(', ')}`
        );
    }

    const tempRoot = resolveExistingDirectoryRealPath('OS temp directory', input.tempDir);
    const testUserDataDir = resolveSafeTestUserDataDir({
        rawUserDataDir,
        normalUserDataDir: input.normalUserDataDir,
        tempRoot
    });
    const projectPath = resolveSafeChatTestProjectPath({
        rawProjectPath,
        appPath: input.appPath,
        tempRoot
    });
    if (isStrictPathDescendant(testUserDataDir, projectPath)
        || isStrictPathDescendant(projectPath, testUserDataDir)
        || testUserDataDir === projectPath) {
        throw new Error('Chat test project and userData directories must not overlap.');
    }

    const reuseNormalCodexSubscriptionSession = (
        input.environment.DESIGNECHO_TEST_REUSE_CODEX_SUBSCRIPTION_SESSION === '1'
    );
    if (reuseNormalCodexSubscriptionSession && input.environment.DESIGNECHO_PORT_OFFSET !== '0') {
        throw new Error(
            'DESIGNECHO_TEST_REUSE_CODEX_SUBSCRIPTION_SESSION requires an isolated chat test bridge on the default runtime ports.'
        );
    }

    return {
        enabled: true,
        bridgeEnabled,
        environmentKeys,
        testUserDataDir,
        projectPath,
        remoteDebuggingPort: parseRemoteDebuggingPort(
            input.environment.DESIGNECHO_REMOTE_DEBUGGING_PORT
        ),
        reuseNormalCodexSubscriptionSession
    };
}
