/**
 * composeDesign 车间的主进程能力：生成场景底。
 *
 * 渲染进程通过 `window.designEcho.invoke('designWorkshop:generateBackdrop', params)` 调用。
 * 参照图只定光线与氛围；返回 data URL 供 placeImage(imageData) 直接置入。
 */
import { app, ipcMain } from 'electron';
import { promises as fs } from 'fs';
import path from 'path';
import { normalizeDesignLearningLedger } from '../../shared/design-learning-candidates';
import { openRouterGeminiImageService } from '../services/openrouter-gemini-image-service';
import type { IPCContext } from './types';

interface GenerateBackdropParams {
    referenceFilePath?: string;
    /** 也接受 data URL / base64（如画布导出）——二选一 */
    referenceImageData?: string;
    prompt: string;
    width?: number;
    height?: number;
    model?: string;
    imageSize?: '1K' | '2K' | '4K';
}

function pickAspectRatio(width?: number, height?: number): string | undefined {
    const w = Number(width);
    const h = Number(height);
    if (!(w > 0 && h > 0)) return undefined;
    const ratio = w / h;
    const candidates: Array<[string, number]> = [
        ['1:1', 1], ['4:3', 4 / 3], ['3:4', 3 / 4], ['16:9', 16 / 9], ['9:16', 9 / 16],
        ['3:2', 1.5], ['2:3', 2 / 3], ['4:5', 0.8], ['5:4', 1.25], ['21:9', 21 / 9]
    ];
    let best = candidates[0];
    for (const candidate of candidates) {
        if (Math.abs(candidate[1] - ratio) < Math.abs(best[1] - ratio)) best = candidate;
    }
    return best[0];
}

function dataUrlToBuffer(value: string): Buffer {
    const clean = String(value || '').replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
    return Buffer.from(clean, 'base64');
}

async function writeJsonAtomically(file: string, value: unknown): Promise<void> {
    const dir = path.dirname(file);
    const tempFile = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
    await fs.writeFile(tempFile, JSON.stringify(value, null, 2), 'utf8');
    try {
        await fs.rename(tempFile, file);
    } catch (error) {
        await fs.rm(tempFile, { force: true });
        throw error;
    }
}

const IMAGE_EXT = /\.(png|jpe?g|webp|tiff?|bmp)$/i;

export function registerDesignWorkshopHandlers(context?: Pick<IPCContext, 'mattingService'>): void {
    /**
     * 产品抠图落盘：真实产品照片 → 本地抠图 → 透明 PNG 文件（放在 outputDir 或 userData/design-workshop/cutouts）。
     * 车间拿返回的 filePath 作配方主体；原照片仍作生成场景底的光线参照。
     */
    ipcMain.handle('designWorkshop:prepareSubjectCutout', async (_event, params: { filePath: string; outputDir?: string }) => {
        const startedAt = Date.now();
        const source = String(params?.filePath || '').trim();
        if (!source || !IMAGE_EXT.test(source)) {
            return { success: false, error: `产品抠图失败：filePath 需要 png/jpg/webp/tif 图片，收到「${source || '空'}」` };
        }
        const mattingService = context?.mattingService;
        if (!mattingService) {
            return { success: false, error: '产品抠图失败：抠图服务未初始化（本地 ONNX 模型未就绪），可改用已抠好的透明 PNG 作 subject.filePath' };
        }
        let buffer: Buffer;
        try {
            buffer = await fs.readFile(source);
        } catch (error: any) {
            return { success: false, error: `产品抠图失败：读取「${path.basename(source)}」失败：${error?.message || error}` };
        }
        try {
            const result = await mattingService.removeBackground(buffer.toString('base64'), {});
            if (!result?.success || !result.mattedImage) {
                return { success: false, error: `产品抠图失败：${result?.error || '抠图服务未返回透明图'}` };
            }
            const clean = String(result.mattedImage).replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
            const outDir = String(params?.outputDir || '').trim() || path.join(app.getPath('userData'), 'design-workshop', 'cutouts');
            await fs.mkdir(outDir, { recursive: true });
            const outPath = path.join(outDir, `${path.basename(source).replace(/\.[^.]+$/, '')}-cutout.png`);
            await fs.writeFile(outPath, Buffer.from(clean, 'base64'));
            return {
                success: true,
                filePath: outPath,
                usedModel: result.usedModel,
                elapsedMs: Date.now() - startedAt
            };
        } catch (error: any) {
            return { success: false, error: `产品抠图失败：${error?.message || String(error)}`, elapsedMs: Date.now() - startedAt };
        }
    });

    /**
     * 学习候选区落盘：项目 .designecho/learning-candidates.json（人可读、可删改）。
     * 读写边界统一升级 / 校验 v2，写入使用同目录临时文件 + rename，避免进程中断留下半份 JSON。
     */
    ipcMain.handle('designWorkshop:readLearningLedger', async (_event, params: { projectPath: string }) => {
        const projectPath = String(params?.projectPath || '').trim();
        if (!projectPath) return { success: false, error: '读取学习候选区失败：缺少 projectPath' };
        const file = path.join(projectPath, '.designecho', 'learning-candidates.json');
        try {
            const raw = await fs.readFile(file, 'utf8');
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.candidates)) {
                return { success: false, error: `读取学习候选区失败：${file} 不是有效的候选账本（缺少 candidates 数组）` };
            }
            const ledger = normalizeDesignLearningLedger(parsed);
            const rawCount = parsed.candidates.length;
            const warning = rawCount === ledger.candidates.length
                ? undefined
                : `有 ${rawCount - ledger.candidates.length} 条无效候选未加载`;
            return {
                success: true,
                ledger,
                filePath: file,
                migratedFrom: parsed.version === ledger.version ? undefined : String(parsed.version || 'unknown'),
                ...(warning ? { warning } : {})
            };
        } catch (error: any) {
            if (error?.code === 'ENOENT') return { success: true, ledger: null, filePath: file };
            return { success: false, error: `读取学习候选区失败：${error?.message || error}` };
        }
    });
    ipcMain.handle('designWorkshop:writeLearningLedger', async (_event, params: { projectPath: string; ledger: unknown }) => {
        const projectPath = String(params?.projectPath || '').trim();
        if (!projectPath || !params?.ledger) return { success: false, error: '写入学习候选区失败：缺少 projectPath 或 ledger' };
        const dir = path.join(projectPath, '.designecho');
        const file = path.join(dir, 'learning-candidates.json');
        try {
            const rawLedger = params.ledger as Record<string, unknown>;
            if (!Array.isArray(rawLedger.candidates)) {
                return { success: false, error: '写入学习候选区失败：ledger.candidates 必须是数组' };
            }
            const ledger = normalizeDesignLearningLedger(rawLedger);
            await fs.mkdir(dir, { recursive: true });
            await writeJsonAtomically(file, ledger);
            return { success: true, filePath: file, version: ledger.version, count: ledger.candidates.length };
        } catch (error: any) {
            return { success: false, error: `写入学习候选区失败：${error?.message || error}` };
        }
    });

    /**
     * 近期成稿指纹落盘：项目 .designecho/recent-designs.json（人可读可删）。
     * 读：返回 ledger 或 null；写：整份覆盖（调用方在纯逻辑里追加后写回）。
     */
    ipcMain.handle('designWorkshop:readRecentDesigns', async (_event, params: { projectPath: string }) => {
        const projectPath = String(params?.projectPath || '').trim();
        if (!projectPath) return { success: false, error: '读取近期成稿失败：缺少 projectPath' };
        const file = path.join(projectPath, '.designecho', 'recent-designs.json');
        try {
            const raw = await fs.readFile(file, 'utf8');
            return { success: true, ledger: JSON.parse(raw), filePath: file };
        } catch (error: any) {
            if (error?.code === 'ENOENT') return { success: true, ledger: null, filePath: file };
            return { success: false, error: `读取近期成稿失败：${error?.message || error}` };
        }
    });
    ipcMain.handle('designWorkshop:writeRecentDesigns', async (_event, params: { projectPath: string; ledger: unknown }) => {
        const projectPath = String(params?.projectPath || '').trim();
        if (!projectPath || !params?.ledger) return { success: false, error: '写入近期成稿失败：缺少 projectPath 或 ledger' };
        const dir = path.join(projectPath, '.designecho');
        const file = path.join(dir, 'recent-designs.json');
        try {
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(file, JSON.stringify(params.ledger, null, 2), 'utf8');
            return { success: true, filePath: file };
        } catch (error: any) {
            return { success: false, error: `写入近期成稿失败：${error?.message || error}` };
        }
    });

    /**
     * 列 Eagle 文件夹里的图（本机 Eagle API 41595），供「从 Eagle 学品味」用：按文件夹 id 或名字（含子层名）找。
     * 只读；返回本地原图路径（原图与缩略图同目录 name.ext）。
     */
    ipcMain.handle('designWorkshop:listEagleFolderItems', async (_event, params: { folderId?: string; folderName?: string; limit?: number }) => {
        const base = 'http://localhost:41595';
        const limit = Math.min(30, Math.max(1, Number(params?.limit) || 6));
        try {
            let folderId = String(params?.folderId || '').trim();
            let folderPath = '';
            if (!folderId) {
                const name = String(params?.folderName || '').trim();
                if (!name) return { success: false, error: '列 Eagle 文件夹失败：需要 folderId 或 folderName' };
                const tree = await (await fetch(`${base}/api/folder/list`)).json();
                const hits: Array<{ id: string; path: string }> = [];
                const walk = (nodes: any[], trail: string[]) => {
                    for (const node of nodes || []) {
                        const here = [...trail, String(node.name || '')];
                        if (String(node.name || '').includes(name)) hits.push({ id: String(node.id), path: here.join('/') });
                        if (Array.isArray(node.children)) walk(node.children, here);
                    }
                };
                walk(tree?.data || [], []);
                if (hits.length === 0) return { success: false, error: `Eagle 里找不到名字含「${name}」的文件夹` };
                if (hits.length > 1) return { success: false, error: `Eagle 里有 ${hits.length} 个文件夹名字含「${name}」：${hits.map((h) => h.path).join('；')}——请用更完整的名字或 folderId` };
                folderId = hits[0].id;
                folderPath = hits[0].path;
            }
            const list = await (await fetch(`${base}/api/item/list?folders=${encodeURIComponent(folderId)}&limit=${limit}&orderBy=-modificationTime`)).json();
            const items: any[] = Array.isArray(list?.data) ? list.data : [];
            const out: Array<{ id: string; name: string; ext: string; filePath: string; width?: number; height?: number }> = [];
            for (const item of items) {
                try {
                    const thumb = await (await fetch(`${base}/api/item/thumbnail?id=${encodeURIComponent(item.id)}`)).json();
                    const thumbPath = decodeURIComponent(String(thumb?.data || '').replace(/^file:\/\/\/?/, ''));
                    if (!thumbPath) continue;
                    const dir = path.dirname(thumbPath);
                    const original = path.join(dir, `${item.name}.${item.ext}`);
                    let filePath = thumbPath;
                    try { await fs.access(original); filePath = original; } catch { /* 用缩略图 */ }
                    out.push({ id: String(item.id), name: String(item.name), ext: String(item.ext), filePath, width: item.width, height: item.height });
                } catch { /* skip */ }
            }
            return { success: true, folderId, folderPath, items: out };
        } catch (error: any) {
            return { success: false, error: `列 Eagle 文件夹失败：${error?.message || error}（Eagle 是否在运行、本机 API 41595 是否开启）` };
        }
    });

    /**
     * 照片分区体检（摄影优先的证据）：把照片缩到 48×48 灰度，按 3×3 网格给每格的平均明度与"忙碌度"（明度标准差 + 相邻像素差），
     * 车间据此判断文字该住哪一侧（更干净的一侧）、用深字还是浅字。纯像素统计，不用模型。
     */
    ipcMain.handle('designWorkshop:analyzePhotoRegions', async (_event, params: { filePath?: string; imageData?: string }) => {
        try {
            const sharp = (await import('sharp')).default;
            let input: Buffer;
            if (params?.filePath) input = await fs.readFile(String(params.filePath));
            else if (params?.imageData) input = dataUrlToBuffer(String(params.imageData));
            else return { success: false, error: '照片分区体检失败：需要 filePath 或 imageData' };
            const size = 48;
            const { data, info } = await sharp(input).rotate().resize(size, size, { fit: 'fill' }).greyscale().raw().toBuffer({ resolveWithObject: true });
            const w = info.width; const h = info.height;
            const px = (x: number, y: number) => data[y * w + x] / 255;
            const grid: Array<Array<{ luminance: number; busyness: number }>> = [];
            for (let gy = 0; gy < 3; gy += 1) {
                const row: Array<{ luminance: number; busyness: number }> = [];
                for (let gx = 0; gx < 3; gx += 1) {
                    const x0 = Math.floor((gx * w) / 3); const x1 = Math.floor(((gx + 1) * w) / 3);
                    const y0 = Math.floor((gy * h) / 3); const y1 = Math.floor(((gy + 1) * h) / 3);
                    let sum = 0; let sumSq = 0; let n = 0; let grad = 0; let gn = 0;
                    for (let y = y0; y < y1; y += 1) {
                        for (let x = x0; x < x1; x += 1) {
                            const v = px(x, y); sum += v; sumSq += v * v; n += 1;
                            if (x + 1 < x1) { grad += Math.abs(v - px(x + 1, y)); gn += 1; }
                            if (y + 1 < y1) { grad += Math.abs(v - px(x, y + 1)); gn += 1; }
                        }
                    }
                    const mean = n ? sum / n : 0;
                    const std = n ? Math.sqrt(Math.max(0, sumSq / n - mean * mean)) : 0;
                    const avgGrad = gn ? grad / gn : 0;
                    row.push({ luminance: Number(mean.toFixed(3)), busyness: Number((std * 0.6 + avgGrad * 4).toFixed(3)) });
                }
                grid.push(row);
            }
            const colBusy = [0, 1, 2].map((gx) => (grid[0][gx].busyness + grid[1][gx].busyness + grid[2][gx].busyness) / 3);
            const colLum = [0, 1, 2].map((gx) => (grid[0][gx].luminance + grid[1][gx].luminance + grid[2][gx].luminance) / 3);
            const rowBusy = [0, 1, 2].map((gy) => (grid[gy][0].busyness + grid[gy][1].busyness + grid[gy][2].busyness) / 3);
            return { success: true, grid, columns: { busyness: colBusy, luminance: colLum }, rows: { busyness: rowBusy }, width: info.width, height: info.height };
        } catch (error: any) {
            return { success: false, error: `照片分区体检失败：${error?.message || error}` };
        }
    });

    ipcMain.handle('designWorkshop:generateBackdrop', async (_event, params: GenerateBackdropParams) => {
        const startedAt = Date.now();
        try {
            const prompt = String(params?.prompt || '').trim();
            if (!prompt) {
                return { success: false, error: '生成场景底失败：缺少 prompt（场景方向）' };
            }
            if (!openRouterGeminiImageService.hasApiKey()) {
                return { success: false, error: '生成场景底失败：OpenRouter API Key 未配置（设置 → API 密钥 → OpenRouter）' };
            }
            let reference: Buffer | null = null;
            const referencePath = String(params?.referenceFilePath || '').trim();
            if (referencePath) {
                try {
                    reference = await fs.readFile(referencePath);
                } catch (error: any) {
                    return { success: false, error: `生成场景底失败：参照图读取失败「${path.basename(referencePath)}」：${error?.message || error}` };
                }
            } else if (params?.referenceImageData) {
                reference = dataUrlToBuffer(params.referenceImageData);
            }
            if (!reference || reference.length === 0) {
                return { success: false, error: '生成场景底失败：需要参照图（referenceFilePath 或 referenceImageData）来确定光线与色温' };
            }
            const aspectRatio = pickAspectRatio(params?.width, params?.height);
            // 车间是「首稿一分钟级」的工序：场景底 1K 正常 40–75 秒；超过 100 秒就放弃回退纯色底，
            // 不让一次上游卡顿把整张稿子拖到五分钟（真机 2026-08-18 曾等满 303 秒才超时）。
            const result = await openRouterGeminiImageService.generateBackdropFromReference(prompt, reference, {
                model: params?.model,
                aspectRatio,
                imageSize: params?.imageSize || '1K',
                timeoutMs: 100000
            });
            const dataUrl = `data:${result.mimeType};base64,${result.image.toString('base64')}`;
            return {
                success: true,
                imageData: dataUrl,
                model: result.upstreamModel || result.model,
                width: result.actualWidth,
                height: result.actualHeight,
                aspectRatio: result.aspectRatio,
                imageSize: result.imageSize,
                notice: result.sizeDowngradeNotice,
                elapsedMs: Date.now() - startedAt
            };
        } catch (error: any) {
            const stage = error?.errorStage ? `（阶段 ${error.errorStage}）` : '';
            return {
                success: false,
                error: `生成场景底失败${stage}：${error?.message || String(error)}`,
                elapsedMs: Date.now() - startedAt
            };
        }
    });
}
