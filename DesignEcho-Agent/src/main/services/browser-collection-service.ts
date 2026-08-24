import fs from 'fs/promises';
import path from 'path';
import { randomBytes } from 'crypto';
import { app } from 'electron';

/**
 * 浏览器收藏服务（Browser Collection → Eagle 素材库）
 *
 * 浏览器扩展侧的用户主动收藏（保存链接 / 批量收藏图片 / 区域·可视·整页截图）
 * 经浏览器桥的 client_request 通道推入本服务，写进 **Eagle 当前打开的素材库**：
 * - 图片/截图：先落主进程临时文件，再 POST /api/item/addFromPath 导入
 *   （保留扩展带登录态下载的原始字节，比让 Eagle 重新下载的成功率高）；
 * - 链接：POST /api/item/addBookmark（标题 + 可视区预览图）。
 *
 * 用户在 Eagle 里切换素材库时，API 自动作用于新打开的库——收藏落点跟随切换。
 *
 * 边界（与 eagle-writeback-gate 的红线一致）：
 * - 写入只走运行中 Eagle 的官方 API（127.0.0.1:41595），绝不直接改 .library 文件；
 * - 唯一入口是用户在浏览器里的手动收藏动作（按下即确认），不作为 Agent 工具暴露，
 *   Agent 对 Eagle 保持只读；
 * - Eagle 未运行时明确报错，不静默退回其他落点；
 * - 网页内容是不可信外部数据：名称/标签/批注逐字段清洗，只按白名单扩展名落临时文件。
 */

const EAGLE_API_BASE = 'http://127.0.0.1:41595';
const EAGLE_PROBE_TIMEOUT_MS = 2_000;
const EAGLE_CALL_TIMEOUT_MS = 10_000;
/** 单条收藏的图像数据上限（base64 解码后），防止异常大帧写爆磁盘/内存 */
const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
/**
 * addFromPath 是异步导入队列：API 返回成功不代表 Eagle 已复制完文件，
 * 立即删临时文件有竞态。临时文件留在专用目录，每次调用清理超过此时长的旧文件。
 */
const TEMP_FILE_TTL_MS = 24 * 60 * 60 * 1000;
const TEMP_SUBDIR = 'designecho-eagle-import';
const FORMAT_EXTENSIONS: Record<string, string> = {
    jpeg: '.jpg',
    jpg: '.jpg',
    png: '.png',
    webp: '.webp',
    gif: '.gif'
};

export interface BrowserCollectionDeps {
    onLog?: (level: 'info' | 'warn' | 'error', message: string) => void;
}

export interface BrowserCollectionSaveResult {
    savedTo: 'eagle';
    /** Eagle 条目名（扩展 toast 直接展示） */
    fileName: string;
    /** 面向用户的落点说明（扩展 toast 直接展示） */
    targetLabel: string;
    itemId?: string;
}

/**
 * client_request 分发入口（由 browser-bridge-service 的 onClientRequest 调用）。
 * 未知 method 抛出明确错误——扩展与 Agent 版本不匹配时用户能看懂原因。
 */
export async function handleBrowserCollectionRequest(
    method: string,
    params: any,
    deps: BrowserCollectionDeps
): Promise<any> {
    if (method === 'collect.save') {
        return saveCollection(params, deps);
    }
    throw new Error(
        `Agent 不支持的收藏方法：${method}。当前支持 collect.save；`
        + '若扩展刚更新过，请同步更新并重启 DesignEcho Agent。'
    );
}

async function saveCollection(params: any, deps: BrowserCollectionDeps): Promise<BrowserCollectionSaveResult> {
    const kind = String(params?.kind || '');
    if (kind !== 'image' && kind !== 'screenshot' && kind !== 'link') {
        throw new Error(`收藏失败：未知的收藏类型 ${JSON.stringify(kind)}（支持 image / screenshot / link）。`);
    }

    const sourceUrl = cleanText(params?.sourceUrl, 2048);
    if (!/^https?:\/\//i.test(sourceUrl)) {
        throw new Error('收藏失败：sourceUrl 必须是 http/https 页面地址（浏览器内部页面不可收藏）。');
    }
    const title = cleanText(params?.title, 200);
    const alt = cleanText(params?.alt, 200);
    const variant = cleanText(params?.variant, 40);
    // eagle-attributes 协议字段（页面/用户脚本标注，不可信外部数据）
    const annotation = cleanText(params?.annotation, 300);
    const linkRaw = cleanText(params?.link, 1024);
    const link = /^https?:\/\//i.test(linkRaw) ? linkRaw : '';
    const tags = sanitizeTags(params?.tags);

    let imageBuffer: Buffer | null = null;
    let extension = '';
    let base64 = '';
    if (typeof params?.base64 === 'string' && params.base64.length > 0) {
        const format = String(params?.format || '').toLowerCase();
        extension = FORMAT_EXTENSIONS[format] || '';
        if (!extension) {
            throw new Error(`收藏失败：不支持的图像格式 ${JSON.stringify(params?.format)}（支持 jpeg / png / webp / gif）。`);
        }
        base64 = params.base64;
        imageBuffer = decodeBase64Image(base64);
    }
    if (kind !== 'link' && !imageBuffer) {
        throw new Error(`收藏失败：${kind === 'image' ? '图片' : '截图'}收藏缺少图像数据（base64）。`);
    }

    await assertEagleRunning();

    const itemName = buildEagleItemName({ kind, variant, sourceUrl, title, alt });
    // website 记回源地址：eagle-link 覆盖优先，否则用来源页面
    const website = link || sourceUrl;

    let itemId: string | undefined;
    if (kind === 'link') {
        itemId = await eagleAddBookmark({ url: sourceUrl, name: itemName, base64, tags });
    } else {
        const tempPath = await writeTempImportFile(itemName, extension, imageBuffer!, deps);
        itemId = await eagleAddFromPath({ path: tempPath, name: itemName, website, annotation, tags });
    }

    deps.onLog?.('info', `[BrowserCollection] 已收藏 ${kind}${variant ? `(${variant})` : ''} → Eagle 素材库（${itemName}）`);
    return {
        savedTo: 'eagle',
        fileName: itemName,
        targetLabel: 'Eagle 素材库（当前打开的库）',
        ...(itemId ? { itemId } : {})
    };
}

// ---------- Eagle API ----------

async function assertEagleRunning(): Promise<void> {
    try {
        const response = await fetchWithTimeout(`${EAGLE_API_BASE}/api/application/info`, { method: 'GET' }, EAGLE_PROBE_TIMEOUT_MS);
        const payload: any = await response.json();
        if (payload?.status !== 'success') {
            throw new Error(`Eagle API 返回异常：${JSON.stringify(payload).slice(0, 120)}`);
        }
    } catch (error: any) {
        throw new Error(
            '收藏失败：无法连接本机 Eagle（127.0.0.1:41595）。'
            + '收藏会存入 Eagle 当前打开的素材库，请先启动 Eagle；'
            + '若 Eagle 已在运行，请检查其设置中的 API 功能是否开启。'
            + `原始错误：${error?.message || error}`
        );
    }
}

async function eagleAddBookmark(input: { url: string; name: string; base64: string; tags: string[] }): Promise<string | undefined> {
    const body: Record<string, unknown> = {
        url: input.url,
        name: input.name || input.url
    };
    if (input.base64) body.base64 = input.base64;
    if (input.tags.length > 0) body.tags = input.tags;
    return eaglePost('/api/item/addBookmark', body, '保存链接');
}

async function eagleAddFromPath(input: {
    path: string;
    name: string;
    website: string;
    annotation: string;
    tags: string[];
}): Promise<string | undefined> {
    const body: Record<string, unknown> = {
        path: input.path,
        name: input.name,
        website: input.website
    };
    if (input.annotation) body.annotation = input.annotation;
    if (input.tags.length > 0) body.tags = input.tags;
    return eaglePost('/api/item/addFromPath', body, '导入图像');
}

async function eaglePost(apiPath: string, body: Record<string, unknown>, actionLabel: string): Promise<string | undefined> {
    let payload: any;
    try {
        const response = await fetchWithTimeout(
            `${EAGLE_API_BASE}${apiPath}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            },
            EAGLE_CALL_TIMEOUT_MS
        );
        payload = await response.json();
    } catch (error: any) {
        throw new Error(`收藏失败：调用 Eagle ${actionLabel}接口（${apiPath}）未成功：${error?.message || error}`);
    }
    if (payload?.status !== 'success') {
        throw new Error(
            `收藏失败：Eagle ${actionLabel}接口拒绝了请求：${JSON.stringify(payload).slice(0, 200)}。`
            + '若 Eagle 设置里启用了 API Token，本功能暂不支持带 token 调用，请暂时关闭该选项。'
        );
    }
    const data = payload?.data;
    return typeof data === 'string' && data ? data : undefined;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

// ---------- 临时导入文件 ----------

async function writeTempImportFile(
    itemName: string,
    extension: string,
    buffer: Buffer,
    deps: BrowserCollectionDeps
): Promise<string> {
    const tempDir = path.join(app.getPath('temp'), TEMP_SUBDIR);
    await fs.mkdir(tempDir, { recursive: true });
    await cleanupStaleTempFiles(tempDir, deps);
    // 文件名带随机后缀保证唯一；Eagle 条目名由 addFromPath 的 name 字段决定，
    // 但导入文件的基名会成为 Eagle 里的原始文件名，仍用可读的 itemName。
    const fileName = `${itemName}-${randomBytes(4).toString('hex')}${extension}`;
    const filePath = path.join(tempDir, fileName);
    await fs.writeFile(filePath, buffer);
    return filePath;
}

/** 清理超过 TTL 的旧临时文件（Eagle 异步导入完成后文件即无用，但不能立即删——见 TEMP_FILE_TTL_MS 注释）。 */
async function cleanupStaleTempFiles(tempDir: string, deps: BrowserCollectionDeps): Promise<void> {
    let names: string[];
    try {
        names = await fs.readdir(tempDir);
    } catch {
        return;
    }
    const now = Date.now();
    for (const name of names) {
        const filePath = path.join(tempDir, name);
        try {
            const stat = await fs.stat(filePath);
            if (now - stat.mtimeMs > TEMP_FILE_TTL_MS) {
                await fs.unlink(filePath);
            }
        } catch (error: any) {
            deps.onLog?.('warn', `[BrowserCollection] 清理临时文件 ${name} 失败：${error?.message || error}`);
        }
    }
}

// ---------- 输入清洗 ----------

function decodeBase64Image(base64: string): Buffer {
    let buffer: Buffer;
    try {
        buffer = Buffer.from(base64, 'base64');
    } catch {
        throw new Error('收藏失败：图像 base64 数据无法解码。');
    }
    if (buffer.length === 0) {
        throw new Error('收藏失败：图像数据为空（下载或截图可能未成功）。');
    }
    if (buffer.length > MAX_IMAGE_BYTES) {
        throw new Error(
            `收藏失败：图像数据 ${(buffer.length / 1024 / 1024).toFixed(1)}MB 超过 ${MAX_IMAGE_BYTES / 1024 / 1024}MB 上限。`
        );
    }
    return buffer;
}

/**
 * Eagle 条目名：站点_标题（图片优先 alt——承载 eagle-title 覆盖与图片自身描述）。
 * 不带时间戳（Eagle 有自己的收藏时间字段），逐字符白名单清洗，网页内容不可信。
 */
function buildEagleItemName(input: {
    kind: string;
    variant: string;
    sourceUrl: string;
    title: string;
    alt: string;
}): string {
    let host = '';
    try {
        host = new URL(input.sourceUrl).hostname.replace(/^www\./, '');
    } catch {
        host = '';
    }
    const variantLabels: Record<string, string> = {
        region: '区域截图',
        visible: '可视截图',
        fullpage: '整页截图'
    };
    let label: string;
    if (input.kind === 'screenshot') {
        label = variantLabels[input.variant] || '截图';
    } else if (input.kind === 'image') {
        label = sanitizeFileNamePart(input.alt || input.title).slice(0, 48);
    } else {
        label = sanitizeFileNamePart(input.title || input.alt).slice(0, 48);
    }
    const parts = [sanitizeFileNamePart(host).slice(0, 40), label].filter(Boolean);
    return parts.join('_') || '浏览器收藏';
}

/** 只保留中日韩文字、字母、数字、空格与少量安全连接符；其余替换为空。 */
function sanitizeFileNamePart(value: string): string {
    return String(value || '')
        .replace(/[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\w\s.\-—·]/gu, '')
        .replace(/\s+/g, ' ')
        .replace(/^[\s.]+|[\s.]+$/g, '')
        .trim();
}

function sanitizeTags(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map((tag) => cleanText(tag, 50))
        .filter((tag) => tag.length > 0)
        .slice(0, 10);
}

function cleanText(value: unknown, maxLength: number): string {
    if (typeof value !== 'string') {
        return '';
    }
    return value.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, maxLength);
}
