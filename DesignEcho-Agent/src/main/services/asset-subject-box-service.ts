/**
 * 素材主体框服务（主进程）：把「主体在哪」算成素材属性，一张图只算一次。
 *
 * 获取链（按可靠性，逐级降级；每级带 method / confidence）：
 *  ① alpha 边界（透明底 PNG，零模型，确定）
 *  ② 纯色底裁边（白底 / 灰底产品图，零模型，高置信）
 *  ③ 本地分割模型（BiRefNet / InSPyReNet，DirectML；SubjectDetectionService，中 / 低置信）
 *  ④ 整图外框（兜底，低置信，明说）
 *
 * 也提供「对 Photoshop 图层像素跑同一条链」的入口（不依赖 Photoshop 选择主体）：
 * 由调用方先经 WebSocket 让插件导出图层像素，这里只负责算。
 *
 * 边界：只读文件 / 像素，不写盘；结果是相对坐标（0–1），与置入后的缩放位置无关。
 */

import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import {
    computeAlphaSubjectBox,
    computeUniformBorderSubjectBox,
    frameSubjectBox,
    resolveMattingSubjectBox,
    type RawPixelImage,
    type SubjectBoxResolution
} from '../../shared/subject-box-from-pixels';
import { getSubjectDetectionService } from './subject-detection-service';

export interface AssetSubjectBoxResult {
    success: boolean;
    /** 相对框与来源；失败时缺省 */
    resolution?: SubjectBoxResolution;
    imageWidth?: number;
    imageHeight?: number;
    fromCache?: boolean;
    /** 每一级尝试了什么、为什么没用（诊断用，人话） */
    attempts: string[];
    error?: string;
}

const ANALYSIS_MAX_EDGE = 1024;
const CACHE_LIMIT = 300;
const RASTER_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff', '.gif', '.bmp', '.avif']);

interface CacheEntry {
    key: string;
    result: AssetSubjectBoxResult;
}

export class AssetSubjectBoxService {
    private cache = new Map<string, CacheEntry>();

    private buildCacheKey(filePath: string): string | undefined {
        try {
            const stat = fs.statSync(filePath);
            return `${filePath.toLowerCase()}|${stat.size}|${Math.floor(stat.mtimeMs)}`;
        } catch {
            return undefined;
        }
    }

    private remember(filePath: string, key: string, result: AssetSubjectBoxResult): void {
        if (this.cache.size >= CACHE_LIMIT) {
            const oldest = this.cache.keys().next().value;
            if (oldest !== undefined) this.cache.delete(oldest);
        }
        this.cache.set(filePath.toLowerCase(), { key, result });
    }

    /**
     * 对图像文件求主体框。PSD/PSB 等非位图交给调用方先出预览再走 resolveFromEncodedImage。
     */
    async resolveForFile(filePath: string): Promise<AssetSubjectBoxResult> {
        const normalized = String(filePath || '').trim();
        if (!normalized) {
            return { success: false, attempts: [], error: '主体框解析失败：缺少文件路径。' };
        }
        if (!fs.existsSync(normalized)) {
            return { success: false, attempts: [], error: `主体框解析失败：文件不存在（${normalized}）。` };
        }
        const cacheKey = this.buildCacheKey(normalized);
        const cached = this.cache.get(normalized.toLowerCase());
        if (cached && cacheKey && cached.key === cacheKey) {
            return { ...cached.result, fromCache: true };
        }
        const ext = path.extname(normalized).toLowerCase();
        if (!RASTER_EXTENSIONS.has(ext)) {
            return {
                success: false,
                attempts: [],
                error: `主体框解析失败：${ext || '无扩展名'} 不是位图格式；PSD/PSB 请先导出预览再解析。`
            };
        }
        const result = await this.resolveFromSharpInput(normalized);
        if (cacheKey) this.remember(normalized, cacheKey, result);
        return result;
    }

    /**
     * 对一段已编码图像（PNG / JPEG 字节，或 base64 字符串）求主体框——供图层像素与预览图使用。
     */
    async resolveFromEncodedImage(input: Buffer | string): Promise<AssetSubjectBoxResult> {
        const buffer = typeof input === 'string'
            ? Buffer.from(input.includes(',') ? input.split(',')[1] : input, 'base64')
            : input;
        if (!buffer || buffer.length < 16) {
            return { success: false, attempts: [], error: '主体框解析失败：图像数据为空。' };
        }
        return this.resolveFromSharpInput(buffer);
    }

    /**
     * 对原始像素（RGB / RGBA）求主体框——插件以 raw 格式导出图层像素时用，省一次编码。
     */
    async resolveFromRawPixels(image: RawPixelImage): Promise<AssetSubjectBoxResult> {
        const attempts: string[] = [];
        const alpha = computeAlphaSubjectBox(image);
        if (alpha) {
            return { success: true, resolution: alpha, imageWidth: image.width, imageHeight: image.height, attempts: ['alpha：命中'] };
        }
        attempts.push(image.channels === 4 ? 'alpha：整图不透明，跳过' : 'alpha：无透明通道，跳过');
        const trim = computeUniformBorderSubjectBox(image);
        if (trim) {
            return { success: true, resolution: trim, imageWidth: image.width, imageHeight: image.height, attempts: [...attempts, 'trim：命中'] };
        }
        attempts.push('trim：边框不是均匀纯色或整图都是内容，跳过');
        // 分割模型需要编码图像：把 raw 转成 PNG 再走模型
        const png = await sharp(Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength), {
            raw: { width: image.width, height: image.height, channels: image.channels }
        }).png().toBuffer();
        return this.resolveWithMatting(png, image.width, image.height, attempts);
    }

    private async resolveFromSharpInput(input: string | Buffer): Promise<AssetSubjectBoxResult> {
        const attempts: string[] = [];
        try {
            const metadata = await sharp(input, { failOnError: false }).metadata();
            const width = metadata.width || 0;
            const height = metadata.height || 0;
            if (width <= 0 || height <= 0) {
                return { success: false, attempts, error: '主体框解析失败：读不到图像尺寸。' };
            }
            const scale = Math.min(1, ANALYSIS_MAX_EDGE / Math.max(width, height));
            const analysisWidth = Math.max(1, Math.round(width * scale));
            const analysisHeight = Math.max(1, Math.round(height * scale));
            const raw = await sharp(input, { failOnError: false })
                .resize(analysisWidth, analysisHeight, { fit: 'fill' })
                .ensureAlpha()
                .raw()
                .toBuffer({ resolveWithObject: true });
            const image: RawPixelImage = {
                data: raw.data,
                width: raw.info.width,
                height: raw.info.height,
                channels: 4
            };
            const alpha = metadata.hasAlpha ? computeAlphaSubjectBox(image) : undefined;
            if (alpha) {
                return { success: true, resolution: alpha, imageWidth: width, imageHeight: height, attempts: ['alpha：命中'] };
            }
            attempts.push(metadata.hasAlpha ? 'alpha：整图不透明，跳过' : 'alpha：无透明通道，跳过');
            const trim = computeUniformBorderSubjectBox(image);
            if (trim) {
                return { success: true, resolution: trim, imageWidth: width, imageHeight: height, attempts: [...attempts, 'trim：命中'] };
            }
            attempts.push('trim：边框不是均匀纯色或整图都是内容，跳过');
            const jpeg = await sharp(input, { failOnError: false })
                .resize(analysisWidth, analysisHeight, { fit: 'fill' })
                .flatten({ background: '#ffffff' })
                .jpeg({ quality: 88 })
                .toBuffer();
            const outcome = await this.resolveWithMatting(jpeg, analysisWidth, analysisHeight, attempts);
            return { ...outcome, imageWidth: width, imageHeight: height };
        } catch (error: any) {
            return { success: false, attempts, error: `主体框解析失败：${error?.message || String(error)}` };
        }
    }

    private async resolveWithMatting(
        encoded: Buffer,
        width: number,
        height: number,
        attempts: string[]
    ): Promise<AssetSubjectBoxResult> {
        const detection = await getSubjectDetectionService().detectSubjectBounds(
            `data:image/png;base64,${encoded.toString('base64')}`,
            { originalImageWidth: width, originalImageHeight: height }
        );
        if (detection.success && detection.bounds) {
            const resolution = resolveMattingSubjectBox(detection.bounds, width, height);
            if (resolution) {
                return {
                    success: true,
                    resolution,
                    imageWidth: width,
                    imageHeight: height,
                    attempts: [...attempts, `matting：命中（${detection.method || 'matting'}，${detection.processingTime || 0}ms）`]
                };
            }
        }
        attempts.push(`matting：${detection.error || '未检测到主体'}`);
        // 兜底不算失败：明说是整图外框、低置信，让引擎 contain 适配、模型看画面
        return {
            success: true,
            resolution: frameSubjectBox(),
            imageWidth: width,
            imageHeight: height,
            attempts
        };
    }
}

let assetSubjectBoxService: AssetSubjectBoxService | null = null;

export function getAssetSubjectBoxService(): AssetSubjectBoxService {
    if (!assetSubjectBoxService) assetSubjectBoxService = new AssetSubjectBoxService();
    return assetSubjectBoxService;
}
