/**
 * Skill 包服务：读取 Claude 官方形态的 skill 包（skills/<id>/SKILL.md + references/*.md）。
 * 渐进披露三层：列表只给 name+description（frontmatter）；正文按需读；reference 按需读。
 * 只读服务，UTF-8，路径钉死在应用 skills/ 目录内，拒绝任何目录穿越。
 */

import { app } from 'electron';
import { execFile, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface SkillPackageSummary {
    id: string;
    name: string;
    description: string;
    references: string[];
    scripts: string[];
}

export interface SkillScriptRunResult {
    success: boolean;
    error?: string;
    script?: string;
    exitCode?: number;
    stdout?: string;
    stderr?: string;
    timedOut?: boolean;
    /** true=经系统 Node --permission 沙箱执行；false=Electron 内嵌 Node 回退（无文件系统隔离）。 */
    sandboxed?: boolean;
}

export interface SkillPackageReadResult {
    success: boolean;
    error?: string;
    packages?: SkillPackageSummary[];
    id?: string;
    name?: string;
    description?: string;
    body?: string;
    reference?: string;
    references?: string[];
    scripts?: string[];
}

const SAFE_SEGMENT = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SAFE_REFERENCE = /^[a-z0-9][a-z0-9-]{0,63}\.md$/;
const SAFE_SCRIPT = /^[a-z0-9][a-z0-9-]{0,63}\.(?:cjs|mjs|js)$/;
const SCRIPT_TIMEOUT_MS = 30_000;
const SCRIPT_OUTPUT_LIMIT = 64_000;

/**
 * 脚本沙箱运行时（借 codex exec 沙箱思路）：优先用系统 Node 的 --permission 权限模型
 * （读=包目录+项目目录，写=项目目录，子进程/worker 默认全禁）。Electron 28 内嵌 Node 18
 * 不支持该旗标（bad option，且安全旗标禁走 NODE_OPTIONS），探测失败时回退内嵌无沙箱执行，
 * 结果如实标注 sandboxed:false——降级透明，不假装有笼子。
 */
let cachedSandboxRuntime: { execPath: string; sandboxed: boolean } | null = null;

function resolveScriptRuntime(): { execPath: string; sandboxed: boolean } {
    if (cachedSandboxRuntime) return cachedSandboxRuntime;
    try {
        execFileSync('node', ['--permission', '-e', '0'], { timeout: 5_000, windowsHide: true, stdio: 'ignore' });
        cachedSandboxRuntime = { execPath: 'node', sandboxed: true };
    } catch {
        cachedSandboxRuntime = { execPath: process.execPath, sandboxed: false };
    }
    return cachedSandboxRuntime;
}

function buildSandboxFlags(packageDir: string, projectPath?: string): string[] {
    // 权限模型对路径格式敏感（混合斜杠不生效）：授权前一律 resolve 成本地规范路径。
    const readRoots = [path.join(path.resolve(packageDir), '*')];
    const writeRoots: string[] = [];
    const project = String(projectPath || '').trim();
    if (project && fs.existsSync(project)) {
        const normalizedProject = path.resolve(project);
        readRoots.push(path.join(normalizedProject, '*'));
        writeRoots.push(path.join(normalizedProject, '*'));
    }
    // Node 22 起逗号分隔多路径已废弃：每条路径必须单独一个 --allow-fs-* 旗标。
    return [
        '--permission',
        ...readRoots.map((root) => `--allow-fs-read=${root}`),
        ...writeRoots.map((root) => `--allow-fs-write=${root}`)
    ];
}

function resolveSkillsRoot(): string {
    const candidates = [
        path.join(app.getAppPath(), 'skills'),
        path.join(process.resourcesPath || '', 'skills')
    ];
    for (const candidate of candidates) {
        if (candidate && fs.existsSync(candidate)) return candidate;
    }
    return candidates[0];
}

function parseFrontmatter(raw: string): { name: string; description: string; body: string } {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) return { name: '', description: '', body: raw.trim() };
    const meta = match[1];
    const readField = (field: string): string => {
        const line = meta.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
        return line ? line[1].trim() : '';
    };
    return { name: readField('name'), description: readField('description'), body: match[2].trim() };
}

function listReferenceFiles(packageDir: string): string[] {
    const referenceDir = path.join(packageDir, 'references');
    if (!fs.existsSync(referenceDir)) return [];
    return fs.readdirSync(referenceDir)
        .filter((file) => SAFE_REFERENCE.test(file))
        .sort();
}

function listScriptFiles(packageDir: string): string[] {
    const scriptDir = path.join(packageDir, 'scripts');
    if (!fs.existsSync(scriptDir)) return [];
    return fs.readdirSync(scriptDir)
        .filter((file) => SAFE_SCRIPT.test(file))
        .sort();
}

/**
 * 在子进程中运行 skill 包内脚本（Node 执行，30 秒超时，输出截断）。
 * 脚本收到一个 JSON 参数（argv[2]），以 stdout 输出结果；没有 Photoshop 通道，
 * 只适合文件级确定性工作（校验、解析、核对）。
 */
/**
 * 应用一条已获用户批准的 skill 手册改进（2026-08-24 自我改进闭环的唯一写入口）：
 * find 必须在目标文件中恰好出现一次（0 次或多次都拒绝，不做模糊替换）；
 * 写入前备份 .bak-<时间戳>，UTF-8 原子写。Agent 不直接持有此能力——只有
 * 用户在候选区批准 skill_improvement 提议后由渲染进程代为调用。
 */
export function applySkillImprovement(input: {
    skillId: string;
    file: string;
    find: string;
    replace: string;
}): { success: boolean; error?: string; backupPath?: string } {
    const skillId = String(input.skillId || '').trim().toLowerCase();
    const file = String(input.file || '').trim();
    if (!SAFE_SEGMENT.test(skillId)) {
        return { success: false, error: `改进写入失败：包名「${skillId}」不合法。` };
    }
    if (!/^(?:SKILL\.md|references\/[a-z0-9][a-z0-9-]{0,63}\.md)$/.test(file)) {
        return { success: false, error: `改进写入失败：目标文件「${file}」不合法（仅允许 SKILL.md 或 references/<名>.md）。` };
    }
    const target = path.join(resolveSkillsRoot(), skillId, ...file.split('/'));
    if (!fs.existsSync(target)) {
        return { success: false, error: `改进写入失败：文件不存在（${skillId}/${file}）。` };
    }
    const find = String(input.find || '');
    const replace = String(input.replace || '');
    if (!find.trim() || !replace.trim()) {
        return { success: false, error: '改进写入失败：find/replace 不能为空。' };
    }
    const content = fs.readFileSync(target, 'utf8');
    const first = content.indexOf(find);
    if (first < 0) {
        return { success: false, error: '改进写入失败：目标文件里找不到 find 原文（手册可能已被编辑，提议过期）。' };
    }
    if (content.indexOf(find, first + 1) >= 0) {
        return { success: false, error: '改进写入失败：find 原文在文件中出现多次，无法唯一定位；请给更长的上下文片段。' };
    }
    const backupPath = `${target}.bak-${Date.now()}`;
    fs.copyFileSync(target, backupPath);
    const next = content.slice(0, first) + replace + content.slice(first + find.length);
    const tempPath = `${target}.tmp-${process.pid}`;
    fs.writeFileSync(tempPath, next, 'utf8');
    fs.renameSync(tempPath, target);
    return { success: true, backupPath };
}

export function runSkillScript(
    skillId: string,
    scriptName: string,
    params: unknown,
    projectPath?: string
): Promise<SkillScriptRunResult> {
    const id = String(skillId || '').trim();
    const script = String(scriptName || '').trim();
    if (!SAFE_SEGMENT.test(id)) {
        return Promise.resolve({ success: false, error: `脚本执行失败：包名「${id}」不合法。` });
    }
    if (!SAFE_SCRIPT.test(script)) {
        return Promise.resolve({
            success: false,
            error: `脚本执行失败：脚本名「${script}」不合法（形如 verify-sku-delivery.cjs，仅允许 .cjs/.mjs/.js）。`
        });
    }
    const packageDir = path.join(resolveSkillsRoot(), id);
    const scriptFile = path.join(packageDir, 'scripts', script);
    if (!fs.existsSync(scriptFile)) {
        const available = listScriptFiles(packageDir).join('、') || '（无）';
        return Promise.resolve({
            success: false,
            error: `脚本执行失败：包「${id}」没有脚本「${script}」。可用：${available}。`
        });
    }
    const paramsJson = JSON.stringify(params ?? {});
    const runtime = resolveScriptRuntime();
    const runtimeArgs = runtime.sandboxed
        ? [...buildSandboxFlags(packageDir, projectPath), scriptFile, paramsJson]
        : [scriptFile, paramsJson];
    return new Promise((resolve) => {
        execFile(
            runtime.execPath,
            runtimeArgs,
            {
                timeout: SCRIPT_TIMEOUT_MS,
                maxBuffer: SCRIPT_OUTPUT_LIMIT,
                cwd: packageDir,
                env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
                windowsHide: true
            },
            (error, stdout, stderr) => {
                const timedOut = Boolean(error && (error as NodeJS.ErrnoException & { killed?: boolean }).killed);
                const exitCode = error ? ((error as NodeJS.ErrnoException & { code?: unknown }).code as number | undefined) ?? 1 : 0;
                resolve({
                    success: !error,
                    script,
                    exitCode: typeof exitCode === 'number' ? exitCode : 1,
                    stdout: String(stdout || '').slice(0, SCRIPT_OUTPUT_LIMIT),
                    stderr: String(stderr || '').slice(0, SCRIPT_OUTPUT_LIMIT),
                    timedOut,
                    sandboxed: runtime.sandboxed,
                    ...(error
                        ? {
                            error: timedOut
                                ? `脚本「${script}」执行超时（${SCRIPT_TIMEOUT_MS / 1000}s 上限）。`
                                : `脚本「${script}」退出码 ${exitCode}：${String(stderr || error.message || '').slice(0, 400)}`
                        }
                        : {})
                });
            }
        );
    });
}

export function listSkillPackages(): SkillPackageReadResult {
    const root = resolveSkillsRoot();
    if (!fs.existsSync(root)) {
        return { success: true, packages: [] };
    }
    const packages: SkillPackageSummary[] = [];
    for (const entry of fs.readdirSync(root)) {
        if (!SAFE_SEGMENT.test(entry)) continue;
        const skillFile = path.join(root, entry, 'SKILL.md');
        if (!fs.existsSync(skillFile)) continue;
        const parsed = parseFrontmatter(fs.readFileSync(skillFile, 'utf8'));
        packages.push({
            id: entry,
            name: parsed.name || entry,
            description: parsed.description,
            references: listReferenceFiles(path.join(root, entry)),
            scripts: listScriptFiles(path.join(root, entry))
        });
    }
    return { success: true, packages };
}

export function readSkillPackage(skillId: string, reference?: string): SkillPackageReadResult {
    const id = String(skillId || '').trim();
    if (!SAFE_SEGMENT.test(id)) {
        return { success: false, error: `Skill 包读取失败：包名「${id}」不合法（仅允许小写字母、数字与连字符）。` };
    }
    const root = resolveSkillsRoot();
    const packageDir = path.join(root, id);
    const skillFile = path.join(packageDir, 'SKILL.md');
    if (!fs.existsSync(skillFile)) {
        const available = (listSkillPackages().packages || []).map((item) => item.id).join('、') || '（无）';
        return { success: false, error: `Skill 包读取失败：未找到「${id}」。当前可用的包：${available}。` };
    }
    const referenceName = String(reference || '').trim();
    if (referenceName) {
        if (!SAFE_REFERENCE.test(referenceName)) {
            return { success: false, error: `Skill 包读取失败：reference 名「${referenceName}」不合法（形如 color-card-spec.md）。` };
        }
        const referenceFile = path.join(packageDir, 'references', referenceName);
        if (!fs.existsSync(referenceFile)) {
            const available = listReferenceFiles(packageDir).join('、') || '（无）';
            return { success: false, error: `Skill 包「${id}」没有 reference「${referenceName}」。可用：${available}。` };
        }
        return { success: true, id, reference: referenceName, body: fs.readFileSync(referenceFile, 'utf8').trim() };
    }
    const parsed = parseFrontmatter(fs.readFileSync(skillFile, 'utf8'));
    return {
        success: true,
        id,
        name: parsed.name || id,
        description: parsed.description,
        body: parsed.body,
        references: listReferenceFiles(packageDir),
        scripts: listScriptFiles(packageDir)
    };
}
