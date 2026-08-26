import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export interface DesignEchoRuntimeBuildIdentity {
    version: 'designecho-runtime-build-identity/v1';
    processStartedAt: string;
    capturedAt: string;
    appVersion: string;
    source: 'build_manifest' | 'unavailable';
    buildId: string | null;
    gitCommit: string | null;
    gitDirty: boolean | null;
    artifactDigest: string | null;
    manifestDigest: string | null;
    artifactsVerified: boolean;
    fakeModelEnabled: boolean;
    fakePhotoshopEnabled: boolean;
}

interface CaptureRuntimeBuildIdentityInput {
    appRoot: string;
    appVersion: string;
    environment?: NodeJS.ProcessEnv;
}

interface RuntimeBuildManifestFile {
    ref: string;
    size: number;
    digest: string;
}

interface RuntimeBuildManifest {
    version: 'designecho-runtime-build-manifest/v1';
    buildId: string;
    builtAt: string;
    appVersion: string;
    gitCommit: string;
    gitDirty: boolean;
    artifactDigest: string;
    manifestDigest: string;
    mainFiles: RuntimeBuildManifestFile[];
    rendererFiles: RuntimeBuildManifestFile[];
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (!value || typeof value !== 'object') return JSON.stringify(value);
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => (
        `${JSON.stringify(key)}:${stableStringify(record[key])}`
    )).join(',')}}`;
}

function sha256Buffer(buffer: Buffer): string {
    return `sha256:${crypto.createHash('sha256').update(buffer).digest('hex')}`;
}

function isRuntimeBuildManifest(value: unknown): value is RuntimeBuildManifest {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const manifest = value as Partial<RuntimeBuildManifest>;
    return manifest.version === 'designecho-runtime-build-manifest/v1'
        && typeof manifest.buildId === 'string'
        && /^[0-9a-f]{40}$/.test(String(manifest.gitCommit || '').toLowerCase())
        && typeof manifest.gitDirty === 'boolean'
        && typeof manifest.artifactDigest === 'string'
        && typeof manifest.manifestDigest === 'string'
        && Array.isArray(manifest.mainFiles)
        && manifest.mainFiles.length > 0
        && Array.isArray(manifest.rendererFiles)
        && manifest.rendererFiles.length > 0;
}

function verifyManifestDigest(manifest: RuntimeBuildManifest): boolean {
    const { manifestDigest, ...core } = manifest;
    return sha256Buffer(Buffer.from(stableStringify(core), 'utf8')) === manifestDigest;
}

function verifyBuildFiles(
    appRoot: string,
    files: RuntimeBuildManifestFile[]
): boolean {
    for (const file of files) {
        if (!file || typeof file.ref !== 'string' || !file.ref.trim()) return false;
        if (!Number.isSafeInteger(file.size) || file.size < 0) return false;
        if (!/^sha256:[0-9a-f]{64}$/i.test(String(file.digest || ''))) return false;
        const absolutePath = path.resolve(appRoot, 'dist', file.ref);
        const relative = path.relative(path.resolve(appRoot, 'dist'), absolutePath);
        if (relative.startsWith('..') || path.isAbsolute(relative)) return false;
        if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) return false;
        const content = fs.readFileSync(absolutePath);
        if (content.length !== file.size || sha256Buffer(content) !== file.digest) return false;
    }
    return true;
}

function resolveProcessStartedAt(): string {
    const startedAtMs = Date.now() - Math.max(0, process.uptime() * 1000);
    return new Date(startedAtMs).toISOString();
}

export function captureRuntimeBuildIdentity(
    input: CaptureRuntimeBuildIdentityInput
): DesignEchoRuntimeBuildIdentity {
    const environment = input.environment || process.env;
    const processStartedAt = resolveProcessStartedAt();
    const capturedAt = new Date().toISOString();
    const fakeModelEnabled = environment.DESIGNECHO_CHAT_TEST_FAKE_MODEL === '1';
    const fakePhotoshopEnabled = environment.DESIGNECHO_CHAT_TEST_FAKE_PHOTOSHOP === '1';
    const appRoot = path.resolve(input.appRoot);
    const manifestPath = path.join(appRoot, 'dist', 'runtime-build-manifest.json');
    let manifest: RuntimeBuildManifest | null = null;
    if (fs.existsSync(manifestPath) && fs.statSync(manifestPath).isFile()) {
        try {
            const candidate = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown;
            if (isRuntimeBuildManifest(candidate)) manifest = candidate;
        } catch {
            manifest = null;
        }
    }
    const artifactsVerified = Boolean(
        manifest
        && manifest.appVersion === String(input.appVersion || '').trim()
        && verifyManifestDigest(manifest)
        && verifyBuildFiles(appRoot, manifest.mainFiles)
        && verifyBuildFiles(appRoot, manifest.rendererFiles)
        && sha256Buffer(Buffer.from(stableStringify({
            mainFiles: manifest.mainFiles,
            rendererFiles: manifest.rendererFiles
        }), 'utf8')) === manifest.artifactDigest
    );
    if (!manifest || !artifactsVerified) {
        return {
            version: 'designecho-runtime-build-identity/v1',
            processStartedAt,
            capturedAt,
            appVersion: String(input.appVersion || '').trim() || 'unknown',
            source: 'unavailable',
            buildId: null,
            gitCommit: null,
            gitDirty: null,
            artifactDigest: null,
            manifestDigest: null,
            artifactsVerified: false,
            fakeModelEnabled,
            fakePhotoshopEnabled
        };
    }
    return {
        version: 'designecho-runtime-build-identity/v1',
        processStartedAt,
        capturedAt,
        appVersion: manifest.appVersion || String(input.appVersion || '').trim() || 'unknown',
        source: 'build_manifest',
        buildId: manifest.buildId,
        gitCommit: manifest.gitCommit.toLowerCase(),
        gitDirty: manifest.gitDirty,
        artifactDigest: manifest.artifactDigest,
        manifestDigest: manifest.manifestDigest,
        artifactsVerified: true,
        fakeModelEnabled,
        fakePhotoshopEnabled
    };
}
