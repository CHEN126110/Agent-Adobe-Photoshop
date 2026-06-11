/**
 * 资源管理服务
 * 
 * 功能：
 * 1. 扫描项目目录，识别可用资源（图片、PSD文件等）
 * 2. 生成图片预览/缩略图
 * 3. 提供资源搜索和筛选
 * 4. 支持 AI 自主选择和使用资源
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import sharp from 'sharp';
import { readPsd, initializeCanvas } from 'ag-psd';
import { buildAgentResourceCacheBudget } from '../../shared/agent-performance-policy';

// 初始化 ag-psd 的 canvas（使用自定义 createCanvas 函数）
// 由于 Electron 主进程没有 DOM Canvas，使用 Sharp 模拟基础功能
let psdCanvasInitialized = false;

/**
 * 初始化 ag-psd Canvas 支持
 * 使用模拟的 Canvas 实现（仅用于读取缩略图）
 */
function ensurePsdCanvasInitialized(): void {
    if (psdCanvasInitialized) return;
    
    try {
        // 使用简单的占位 Canvas 实现
        // ag-psd 在只读取缩略图时不需要完整的 Canvas 支持
        const createCanvasMock = (width: number, height: number) => {
            const data = new Uint8ClampedArray(width * height * 4);
            return {
                width,
                height,
                getContext: () => ({
                    fillStyle: '',
                    fillRect: () => {},
                    drawImage: () => {},
                    getImageData: () => ({ data, width, height }),
                    putImageData: () => {},
                    createImageData: (w: number, h: number) => ({ 
                        data: new Uint8ClampedArray(w * h * 4),
                        width: w,
                        height: h
                    }),
                }),
                toBuffer: () => Buffer.alloc(0),
            } as any;
        };
        
        // createImageData 函数（可选）
        const createImageDataMock = (width: number, height: number) => {
            return {
                data: new Uint8ClampedArray(width * height * 4),
                width,
                height
            } as any;
        };
        
        initializeCanvas(createCanvasMock, createImageDataMock);
        psdCanvasInitialized = true;
        console.log('[ResourceManager] ag-psd Canvas 已初始化（轻量模式）');
    } catch (e) {
        console.warn('[ResourceManager] ag-psd Canvas 初始化失败:', e);
    }
}

// 支持的图片格式
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif'];
const DESIGN_EXTENSIONS = ['.psd', '.psb', '.ai', '.eps', '.svg'];
const ALL_SUPPORTED = [...IMAGE_EXTENSIONS, ...DESIGN_EXTENSIONS];
const RESOURCE_CACHE_BUDGET = buildAgentResourceCacheBudget();

type PixelProbeStatus = 'ok' | 'watch' | 'unverified';

function toPositiveInt(value: unknown, fallback: number): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
    return Math.max(1, Math.round(numeric));
}

function roundMetric(value: number, digits: number): number | undefined {
    if (!Number.isFinite(value)) return undefined;
    const factor = Math.pow(10, digits);
    return Math.round(value * factor) / factor;
}

async function readLumaRawForProbe(input: string | Buffer, width: number, height: number, blurSigma = 0): Promise<Buffer> {
    let image = sharp(input, { failOnError: false })
        .resize(width, height, { fit: 'fill' })
        .removeAlpha()
        .grayscale();
    if (Number.isFinite(blurSigma) && blurSigma > 0) {
        image = image.blur(blurSigma);
    }
    return image.raw().toBuffer();
}

function compareLumaRawForProbe(referenceRaw: Buffer, resultRaw: Buffer, darkThreshold = 180): {
    pixelCount: number;
    mae: number;
    rmse: number;
    highDeltaRatio: number;
    referenceDark: number;
    resultDark: number;
    darkJaccard: number;
} {
    let absoluteError = 0;
    let squaredError = 0;
    let highDeltaPixels = 0;
    let referenceDark = 0;
    let resultDark = 0;
    let darkIntersection = 0;
    let darkUnion = 0;

    const pixelCount = Math.min(referenceRaw.length, resultRaw.length);
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
        const refLuma = referenceRaw[pixel];
        const resultLuma = resultRaw[pixel];
        const delta = Math.abs(refLuma - resultLuma);
        absoluteError += delta;
        squaredError += delta * delta;
        if (delta > 32) highDeltaPixels += 1;
        const refIsDark = refLuma < darkThreshold;
        const resultIsDark = resultLuma < darkThreshold;
        if (refIsDark) referenceDark += 1;
        if (resultIsDark) resultDark += 1;
        if (refIsDark && resultIsDark) darkIntersection += 1;
        if (refIsDark || resultIsDark) darkUnion += 1;
    }

    return {
        pixelCount,
        mae: pixelCount > 0 ? absoluteError / pixelCount : Number.POSITIVE_INFINITY,
        rmse: pixelCount > 0 ? Math.sqrt(squaredError / pixelCount) : Number.POSITIVE_INFINITY,
        highDeltaRatio: pixelCount > 0 ? highDeltaPixels / pixelCount : 1,
        referenceDark,
        resultDark,
        darkJaccard: darkUnion > 0 ? darkIntersection / darkUnion : 1
    };
}

/**
 * 资源文件信息
 */
export interface ResourceFile {
    /** 文件名 */
    name: string;
    /** 完整路径 */
    path: string;
    /** 相对路径 */
    relativePath: string;
    /** 文件类型 */
    type: 'image' | 'design' | 'folder';
    /** 文件扩展名 */
    extension: string;
    /** 文件大小（字节） */
    size: number;
    /** 修改时间 */
    modifiedTime: Date;
    /** 图片尺寸（仅图片） */
    dimensions?: { width: number; height: number };
    /** 缩略图 base64（可选） */
    thumbnail?: string;
}

/**
 * 目录扫描结果
 */
export interface DirectoryScanResult {
    /** 根目录路径 */
    rootPath: string;
    /** 总文件数 */
    totalFiles: number;
    /** 图片数量 */
    imageCount: number;
    /** 设计文件数量 */
    designCount: number;
    /** 文件列表 */
    files: ResourceFile[];
    /** 子目录列表 */
    subDirectories: string[];
    /** 错误信息 */
    errors?: string[];
}

/**
 * 资源管理服务
 */
export class ResourceManagerService {
    private projectRoot: string = '';
    private cachedResources: Map<string, ResourceFile[]> = new Map();
    private cacheExpiry: number = RESOURCE_CACHE_BUDGET.resourceScanCacheTtlMs;
    private lastCacheTime: Map<string, number> = new Map();
    
    // PSD/PSB 预览缓存（避免重复解析大文件）
    private psdPreviewCache: Map<string, { result: any; timestamp: number }> = new Map();
    private psdCacheExpiry: number = RESOURCE_CACHE_BUDGET.psdPreviewCacheTtlMs;

    constructor() {
        console.log('[ResourceManager] 服务初始化');
        // 初始化 Canvas 环境
        ensurePsdCanvasInitialized();
    }

    private calcChecksum(buffer: Buffer): string {
        // FNV-1a 32-bit, deterministic across Agent/UXP runtimes.
        let hash = 0x811c9dc5;
        for (let i = 0; i < buffer.length; i++) {
            hash ^= buffer[i];
            hash = Math.imul(hash, 0x01000193);
        }
        const hex = (hash >>> 0).toString(16).padStart(8, '0');
        return `fnv1a32:${hex}`;
    }

    /**
     * 设置项目根目录
     */
    setProjectRoot(rootPath: string): void {
        this.projectRoot = rootPath;
        this.clearCache();
        console.log('[ResourceManager] 项目根目录:', rootPath);
    }

    /**
     * 获取项目根目录
     */
    getProjectRoot(): string {
        return this.projectRoot;
    }

    /**
     * 清除缓存
     */
    clearCache(): void {
        this.cachedResources.clear();
        this.lastCacheTime.clear();
    }

    /**
     * 扫描目录
     */
    async scanDirectory(
        dirPath?: string,
        options: {
            recursive?: boolean;
            includeDesignFiles?: boolean;
            maxDepth?: number;
            generateThumbnails?: boolean;
        } = {}
    ): Promise<DirectoryScanResult> {
        const {
            recursive = true,
            includeDesignFiles = true,
            maxDepth = 5,
            generateThumbnails = false
        } = options;

        const targetPath = dirPath || this.projectRoot;
        
        if (!targetPath || !fs.existsSync(targetPath)) {
            return {
                rootPath: targetPath || '',
                totalFiles: 0,
                imageCount: 0,
                designCount: 0,
                files: [],
                subDirectories: [],
                errors: ['目录不存在或未设置项目根目录']
            };
        }

        // 检查缓存
        const cacheKey = `${targetPath}:${recursive}:${includeDesignFiles}`;
        const cachedTime = this.lastCacheTime.get(cacheKey);
        if (cachedTime && Date.now() - cachedTime < this.cacheExpiry) {
            const cached = this.cachedResources.get(cacheKey);
            if (cached) {
                return {
                    rootPath: targetPath,
                    totalFiles: cached.length,
                    imageCount: cached.filter(f => f.type === 'image').length,
                    designCount: cached.filter(f => f.type === 'design').length,
                    files: cached,
                    subDirectories: this.getSubDirectories(targetPath)
                };
            }
        }

        const files: ResourceFile[] = [];
        const errors: string[] = [];
        const subDirectories: string[] = [];

        const scanDir = async (currentPath: string, depth: number = 0) => {
            if (depth > maxDepth) return;

            try {
                const entries = fs.readdirSync(currentPath, { withFileTypes: true });

                for (const entry of entries) {
                    const fullPath = path.join(currentPath, entry.name);
                    
                    // 跳过隐藏文件和 node_modules
                    if (entry.name.startsWith('.') || entry.name === 'node_modules') {
                        continue;
                    }

                    if (entry.isDirectory()) {
                        if (depth === 0) {
                            subDirectories.push(entry.name);
                        }
                        if (recursive) {
                            await scanDir(fullPath, depth + 1);
                        }
                    } else if (entry.isFile()) {
                        const ext = path.extname(entry.name).toLowerCase();
                        const isImage = IMAGE_EXTENSIONS.includes(ext);
                        const isDesign = DESIGN_EXTENSIONS.includes(ext);

                        if (isImage || (includeDesignFiles && isDesign)) {
                            try {
                                const stats = fs.statSync(fullPath);
                                const resourceFile: ResourceFile = {
                                    name: entry.name,
                                    path: fullPath,
                                    relativePath: path.relative(targetPath, fullPath),
                                    type: isImage ? 'image' : 'design',
                                    extension: ext,
                                    size: stats.size,
                                    modifiedTime: stats.mtime
                                };

                                // 获取图片尺寸
                                if (isImage) {
                                    try {
                                        const metadata = await sharp(fullPath).metadata();
                                        resourceFile.dimensions = {
                                            width: metadata.width || 0,
                                            height: metadata.height || 0
                                        };

                                        // 生成缩略图
                                        if (generateThumbnails) {
                                            const thumbnail = await this.generateThumbnail(fullPath);
                                            if (thumbnail) {
                                                resourceFile.thumbnail = thumbnail;
                                            }
                                        }
                                    } catch (e) {
                                        // 无法读取图片元数据，跳过
                                    }
                                }

                                files.push(resourceFile);
                            } catch (e) {
                                errors.push(`无法读取文件 ${fullPath}: ${e}`);
                            }
                        }
                    }
                }
            } catch (e) {
                errors.push(`无法扫描目录 ${currentPath}: ${e}`);
            }
        };

        await scanDir(targetPath);

        // 更新缓存
        this.cachedResources.set(cacheKey, files);
        this.lastCacheTime.set(cacheKey, Date.now());

        return {
            rootPath: targetPath,
            totalFiles: files.length,
            imageCount: files.filter(f => f.type === 'image').length,
            designCount: files.filter(f => f.type === 'design').length,
            files,
            subDirectories,
            errors: errors.length > 0 ? errors : undefined
        };
    }

    /**
     * 获取子目录列表
     */
    private getSubDirectories(dirPath: string): string[] {
        try {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            return entries
                .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
                .map(e => e.name);
        } catch {
            return [];
        }
    }

    /**
     * 生成缩略图
     */
    async generateThumbnail(imagePath: string, size: number = 150): Promise<string | null> {
        try {
            // 验证文件存在
            if (!fs.existsSync(imagePath)) {
                return null;
            }
            
            const ext = path.extname(imagePath).toLowerCase();
            
            // PSD/PSB 使用专门的方法
            if (ext === '.psd' || ext === '.psb') {
                const psdResult = await this.getPsdPreview(imagePath, size);
                // 确保返回的是 base64 字符串
                if (psdResult.success && psdResult.imageData) {
                    return psdResult.imageData;
                } else if (psdResult.success && psdResult.base64) {
                    return psdResult.base64;
                }
                return null;
            }
            
            // 不支持的格式直接返回 null
            const unsupportedFormats = ['.ai', '.eps', '.raw', '.cr2', '.nef', '.arw', '.dng'];
            if (unsupportedFormats.includes(ext)) {
                return null;
            }
            
            const buffer = await sharp(imagePath, { failOnError: false })
                .resize(size, size, { fit: 'inside' })
                .jpeg({ quality: 70 })
                .toBuffer();
            
            return buffer.toString('base64');
        } catch (e: any) {
            // 只记录非预期错误，跳过常见的格式不支持错误
            if (!e.message?.includes('unsupported image format') && 
                !e.message?.includes('Input file is missing')) {
                console.warn('[ResourceManager] 生成缩略图失败:', path.basename(imagePath), e.message);
            }
            return null;
        }
    }

    /**
     * 获取图片预览（较大尺寸，支持 PSD）
     */
    async getImagePreview(imagePath: string, maxSize: number = 800): Promise<{
        success: boolean;
        imageData?: string;
        base64?: string;  // 兼容旧接口
        dimensions?: { width: number; height: number };
        error?: string;
    }> {
        try {
            if (!fs.existsSync(imagePath)) {
                return { success: false, error: '文件不存在' };
            }

            const ext = path.extname(imagePath).toLowerCase();
            
            // PSD/PSB 文件特殊处理
            if (ext === '.psd' || ext === '.psb') {
                return await this.getPsdPreview(imagePath, maxSize);
            }

            // 常规图片使用 Sharp
            const sharpInstance = sharp(imagePath, { failOnError: false });
            const metadata = await sharpInstance.metadata();
            
            // 检查是否为支持的格式
            if (!metadata.format) {
                return { success: false, error: '不支持的图片格式' };
            }
            
            const buffer = await sharp(imagePath, { failOnError: false })
                .resize(maxSize, maxSize, { fit: 'inside' })
                .jpeg({ quality: 85 })
                .toBuffer();

            const base64Data = buffer.toString('base64');
            return {
                success: true,
                imageData: base64Data,
                base64: base64Data,
                dimensions: {
                    width: metadata.width || 0,
                    height: metadata.height || 0
                }
            };
        } catch (e) {
            return {
                success: false,
                error: `读取图片失败: ${e instanceof Error ? e.message : e}`
            };
        }
    }

    /**
     * 获取 PSD/PSB 文件预览
     * 
     * 注意：PSB 文件可能非常大，需要特殊处理
     */
    private async getPsdPreview(psdPath: string, maxSize: number = 800): Promise<{
        success: boolean;
        imageData?: string;
        base64?: string;
        dimensions?: { width: number; height: number };
        error?: string;
    }> {
        const cacheKey = `${psdPath}:${maxSize}`;
        try {
            // 检查缓存
            const cached = this.psdPreviewCache.get(cacheKey);
            if (cached && (Date.now() - cached.timestamp) < this.psdCacheExpiry) {
                console.log(`[ResourceManager] 使用 PSD 缓存: ${path.basename(psdPath)}`);
                return cached.result;
            }
            
            console.log(`[ResourceManager] 解析 PSD/PSB: ${psdPath}`);
            
            // 检查文件大小
            const stats = fs.statSync(psdPath);
            const fileSizeMB = stats.size / (1024 * 1024);
            console.log(`[ResourceManager] 文件大小: ${fileSizeMB.toFixed(1)} MB`);
            
            // 超大文件（>2GB）直接返回占位符，避免内存溢出
            // 提高阈值，尝试读取内嵌缩略图
            if (fileSizeMB > 2000) {
                console.warn(`[ResourceManager] 文件过大，跳过预览: ${psdPath}`);
                const result = {
                    success: false,
                    error: `文件过大 (${fileSizeMB.toFixed(0)}MB)，暂不支持预览`
                };
                this.psdPreviewCache.set(cacheKey, { result, timestamp: Date.now() });
                return result;
            }
            
            // 异步读取文件（对于大文件，使用流式读取可能更好，但 ag-psd 需要 Buffer）
            // 注意：Node.js Buffer 最大限制约 2GB
            const buffer = await fs.promises.readFile(psdPath);
            
            // 确保 Canvas 已初始化
            ensurePsdCanvasInitialized();
            
            // 解析 PSD/PSB：
            // 1) 读取合成图原始像素（用于高质量预览）
            // 2) 读取 raw 缩略图（作为备用）
            const parseOptions = { 
                skipLayerImageData: true, 
                skipCompositeImageData: false,
                skipThumbnail: false,
                useRawThumbnail: true,
                useImageData: true
            };
            
            const psd = readPsd(buffer, parseOptions as any) as any;

            // 优先使用合成图像素数据（分辨率最高）
            const composite = psd.imageData;
            const compositeW = composite?.width || 0;
            const compositeH = composite?.height || 0;
            const compositeData = composite?.data;
            const compositePixels = compositeW * compositeH;
            const MAX_COMPOSITE_PIXELS = 80000000; // 约 320MB RGBA 原始数据
            if (
                compositeData &&
                compositeW > 0 &&
                compositeH > 0 &&
                compositePixels > 0 &&
                compositePixels <= MAX_COMPOSITE_PIXELS
            ) {
                try {
                    const compositeBuffer = await sharp(Buffer.from(compositeData), {
                        raw: { width: compositeW, height: compositeH, channels: 4 }
                    })
                        .resize(maxSize, maxSize, { fit: 'inside', kernel: 'lanczos3' })
                        .sharpen({ sigma: 1.1, m1: 1, m2: 2.5, x1: 2, y2: 10, y3: 20 })
                        .jpeg({ quality: 96, mozjpeg: true, chromaSubsampling: '4:4:4' })
                        .toBuffer();

                    const base64Data = compositeBuffer.toString('base64');
                    const result = {
                        success: true,
                        imageData: base64Data,
                        base64: base64Data,
                        dimensions: {
                            width: psd.width || compositeW,
                            height: psd.height || compositeH
                        }
                    };
                    this.psdPreviewCache.set(cacheKey, { result, timestamp: Date.now() });
                    console.log('[ResourceManager] 使用 PSD 合成图生成高质量预览');
                    return result;
                } catch (compositeError: any) {
                    console.warn(`[ResourceManager] 合成图路径失败，降级到缩略图路径: ${compositeError?.message || compositeError}`);
                }
            }
            
            // 优先使用原始缩略图（JPEG 字节）
            const rawThumb = psd.imageResources?.thumbnailRaw;
            if (rawThumb?.data && rawThumb.data.length > 0) {
                try {
                    const outputBuffer = await sharp(Buffer.from(rawThumb.data))
                        .resize(maxSize, maxSize, { fit: 'inside', kernel: 'lanczos3' })
                        .sharpen({ sigma: 1.1, m1: 1, m2: 2.5, x1: 2, y2: 10, y3: 20 })
                        .jpeg({ quality: 96, mozjpeg: true, chromaSubsampling: '4:4:4' })
                        .toBuffer();
                    
                    const base64Data = outputBuffer.toString('base64');
                    const result = {
                        success: true,
                        imageData: base64Data,
                        base64: base64Data,
                        dimensions: {
                            width: psd.width || rawThumb.width || 0,
                            height: psd.height || rawThumb.height || 0
                        }
                    };
                    this.psdPreviewCache.set(cacheKey, { result, timestamp: Date.now() });
                    return result;
                } catch (thumbError: any) {
                    console.warn(`[ResourceManager] raw 缩略图解析失败，尝试其他路径: ${thumbError?.message || thumbError}`);
                }
            }

            // 兼容旧路径：如果拿到的是 Canvas thumbnail，尝试 toDataURL 解码
            const canvasThumb = psd.imageResources?.thumbnail;
            if (canvasThumb && typeof canvasThumb.toDataURL === 'function') {
                try {
                    const dataUrl: string = canvasThumb.toDataURL('image/jpeg', 1) || '';
                    const base64Raw = dataUrl.startsWith('data:image/jpeg;base64,')
                        ? dataUrl.slice('data:image/jpeg;base64,'.length)
                        : '';
                    if (base64Raw) {
                        const resizedBuffer = await sharp(Buffer.from(base64Raw, 'base64'))
                            .resize(maxSize, maxSize, { fit: 'inside', kernel: 'lanczos3' })
                            .sharpen({ sigma: 1.1, m1: 1, m2: 2.5, x1: 2, y2: 10, y3: 20 })
                            .jpeg({ quality: 96, mozjpeg: true, chromaSubsampling: '4:4:4' })
                            .toBuffer();
                        
                        const base64Data = resizedBuffer.toString('base64');
                        const result = {
                            success: true,
                            imageData: base64Data,
                            base64: base64Data,
                            dimensions: {
                                width: psd.width || canvasThumb.width || 0,
                                height: psd.height || canvasThumb.height || 0
                            }
                        };
                        this.psdPreviewCache.set(cacheKey, { result, timestamp: Date.now() });
                        return result;
                    }
                } catch (thumbError: any) {
                    console.warn(`[ResourceManager] canvas 缩略图解析失败，尝试合成图像: ${thumbError?.message || thumbError}`);
                }
            }
            
            // PSD 没有内嵌缩略图，或者解析失败
            // 尝试使用 Sharp 直接读取源文件（Sharp 会尝试读取 PSD/PSB 的合成视图）
            console.log('[ResourceManager] 无内嵌缩略图或解析失败，尝试使用 Sharp 读取合成图...');
            try {
                // 使用文件路径让 Sharp 处理，避免大文件 Buffer 拷贝
                // Sharp (libvips) 对 PSD/PSB 的支持取决于合成数据是否存在
                const sharpBuffer = await sharp(psdPath, { failOnError: false })
                    .resize(maxSize, maxSize, { fit: 'inside', kernel: 'lanczos3' })
                    .sharpen({ sigma: 1.1, m1: 1, m2: 2.5, x1: 2, y2: 10, y3: 20 })
                    .jpeg({ quality: 94, mozjpeg: true, chromaSubsampling: '4:4:4' })
                    .toBuffer();
                
                const base64Data = sharpBuffer.toString('base64');
                const result = {
                    success: true,
                    imageData: base64Data,
                    base64: base64Data,
                    dimensions: {
                        width: psd.width,
                        height: psd.height
                    }
                };
                
                // 缓存结果
                this.psdPreviewCache.set(cacheKey, { result, timestamp: Date.now() });
                console.log('[ResourceManager] Sharp 合成图读取成功');
                return result;
            } catch (sharpError: any) {
                console.warn('[ResourceManager] Sharp 读取合成图失败:', sharpError.message);
            }

            // 如果都失败了，返回基本信息（尺寸），前端可显示占位符
            const result = { 
                success: false, 
                error: 'PSD 文件没有内嵌缩略图且无法读取合成图',
                dimensions: {
                    width: psd.width,
                    height: psd.height
                }
            };
            this.psdPreviewCache.set(cacheKey, { result, timestamp: Date.now() });
            return result;
        } catch (e) {
            console.error(`[ResourceManager] PSD 解析失败: ${psdPath}`, e);
            const result = {
                success: false,
                error: `PSD 解析失败: ${e instanceof Error ? e.message : e}`
            };
            this.psdPreviewCache.set(cacheKey, { result, timestamp: Date.now() });
            return result;
        }
    }

    /**
     * 搜索资源文件
     */
    async searchResources(
        query: string,
        options: {
            directory?: string;
            type?: 'image' | 'design' | 'all';
            limit?: number;
        } = {}
    ): Promise<ResourceFile[]> {
        const { directory, type = 'all', limit = 20 } = options;
        
        const scanResult = await this.scanDirectory(directory || this.projectRoot, {
            recursive: true,
            includeDesignFiles: type !== 'image'
        });

        const queryLower = query.toLowerCase();
        
        let results = scanResult.files.filter(file => {
            // 类型筛选
            if (type !== 'all' && file.type !== type) {
                return false;
            }
            
            // 名称匹配
            return file.name.toLowerCase().includes(queryLower) ||
                   file.relativePath.toLowerCase().includes(queryLower);
        });

        // 按相关性排序（名称完全匹配优先）
        results.sort((a, b) => {
            const aExact = a.name.toLowerCase() === queryLower ? 0 : 1;
            const bExact = b.name.toLowerCase() === queryLower ? 0 : 1;
            if (aExact !== bExact) return aExact - bExact;
            
            // 按修改时间排序（新的优先）
            return b.modifiedTime.getTime() - a.modifiedTime.getTime();
        });

        return results.slice(0, limit);
    }

    /**
     * 按类别分组资源
     */
    async getResourcesByCategory(directory?: string): Promise<{
        products: ResourceFile[];      // 产品图
        backgrounds: ResourceFile[];   // 背景
        elements: ResourceFile[];      // 装饰元素
        references: ResourceFile[];    // 参考图
        others: ResourceFile[];        // 其他
    }> {
        const scanResult = await this.scanDirectory(directory || this.projectRoot);
        
        const categories = {
            products: [] as ResourceFile[],
            backgrounds: [] as ResourceFile[],
            elements: [] as ResourceFile[],
            references: [] as ResourceFile[],
            others: [] as ResourceFile[]
        };

        const keywords = {
            products: ['产品', 'product', '主图', 'main', '商品', 'item', '实拍', '白底'],
            backgrounds: ['背景', 'bg', 'background', '底图', '底纹'],
            elements: ['元素', 'element', '装饰', 'decor', 'icon', '图标', '标签', 'tag', '促销'],
            references: ['参考', 'ref', 'reference', '灵感', '样式', 'style', '模板', 'template']
        };

        for (const file of scanResult.files) {
            if (file.type !== 'image') continue;
            
            const nameLower = file.name.toLowerCase();
            const pathLower = file.relativePath.toLowerCase();
            const searchStr = nameLower + ' ' + pathLower;

            let categorized = false;
            for (const [category, keys] of Object.entries(keywords)) {
                if (keys.some(k => searchStr.includes(k))) {
                    categories[category as keyof typeof categories].push(file);
                    categorized = true;
                    break;
                }
            }

            if (!categorized) {
                categories.others.push(file);
            }
        }

        return categories;
    }

    /**
     * 获取目录结构（用于 AI 理解）
     */
    async getDirectoryStructure(directory?: string, maxDepth: number = 3): Promise<string> {
        const targetPath = directory || this.projectRoot;
        
        if (!targetPath || !fs.existsSync(targetPath)) {
            return '目录不存在或未设置';
        }

        const lines: string[] = [];
        lines.push(`📁 ${path.basename(targetPath)}/`);

        const buildTree = (dirPath: string, prefix: string = '', depth: number = 0) => {
            if (depth >= maxDepth) return;

            try {
                const entries = fs.readdirSync(dirPath, { withFileTypes: true });
                const filtered = entries.filter(e => 
                    !e.name.startsWith('.') && e.name !== 'node_modules'
                );

                filtered.forEach((entry, index) => {
                    const isLast = index === filtered.length - 1;
                    const connector = isLast ? '└── ' : '├── ';
                    const fullPath = path.join(dirPath, entry.name);

                    if (entry.isDirectory()) {
                        // 统计目录中的图片数量
                        const imageCount = this.countImages(fullPath);
                        const suffix = imageCount > 0 ? ` (${imageCount} 张图片)` : '';
                        lines.push(`${prefix}${connector}📁 ${entry.name}/${suffix}`);
                        
                        const newPrefix = prefix + (isLast ? '    ' : '│   ');
                        buildTree(fullPath, newPrefix, depth + 1);
                    } else {
                        const ext = path.extname(entry.name).toLowerCase();
                        if (IMAGE_EXTENSIONS.includes(ext)) {
                            lines.push(`${prefix}${connector}🖼️ ${entry.name}`);
                        } else if (DESIGN_EXTENSIONS.includes(ext)) {
                            lines.push(`${prefix}${connector}🎨 ${entry.name}`);
                        }
                    }
                });
            } catch (e) {
                // 忽略无法读取的目录
            }
        };

        buildTree(targetPath, '');
        return lines.join('\n');
    }

    /**
     * 统计目录中的图片数量
     */
    private countImages(dirPath: string): number {
        try {
            let count = 0;
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            
            for (const entry of entries) {
                if (entry.isFile()) {
                    const ext = path.extname(entry.name).toLowerCase();
                    if (IMAGE_EXTENSIONS.includes(ext)) {
                        count++;
                    }
                }
            }
            
            return count;
        } catch {
            return 0;
        }
    }

    /**
     * 读取图片为 Base64（用于置入操作）
     */
    async readImageAsBase64(imagePath: string): Promise<{
        success: boolean;
        base64?: string;
        mimeType?: string;
        dimensions?: { width: number; height: number };
        assetId?: string;
        checksum?: string;
        byteLength?: number;
        sha256?: string;
        error?: string;
    }> {
        try {
            if (!fs.existsSync(imagePath)) {
                return { success: false, error: '文件不存在' };
            }

            const ext = path.extname(imagePath).toLowerCase();
            if (!IMAGE_EXTENSIONS.includes(ext)) {
                return { success: false, error: '不支持的图片格式' };
            }

            const buffer = fs.readFileSync(imagePath);
            const metadata = await sharp(imagePath).metadata();
            const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
            const checksum = this.calcChecksum(buffer);
            
            const mimeTypes: Record<string, string> = {
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.png': 'image/png',
                '.gif': 'image/gif',
                '.webp': 'image/webp',
                '.bmp': 'image/bmp',
                '.tiff': 'image/tiff',
                '.tif': 'image/tiff'
            };

            return {
                success: true,
                base64: buffer.toString('base64'),
                mimeType: mimeTypes[ext] || 'image/jpeg',
                assetId: sha256,
                checksum,
                byteLength: buffer.length,
                sha256,
                dimensions: {
                    width: metadata.width || 0,
                    height: metadata.height || 0
                }
            };
        } catch (e) {
            return {
                success: false,
                error: `读取图片失败: ${e instanceof Error ? e.message : e}`
            };
        }
    }

    /**
     * 只读图片文件探针：用于验收链路确认导出图是否存在、可解码、尺寸是否可复核。
     * 不返回原始图片内容或 base64，避免把结果图泄漏到普通报告链路。
     */
    async probeImageFile(imagePath: string): Promise<{
        success: boolean;
        path: string;
        status: 'ok' | 'missing' | 'not_file' | 'unsupported' | 'decode_failed';
        exists: boolean;
        isFile: boolean;
        byteLength?: number;
        format?: string;
        mimeType?: string;
        dimensions?: { width: number; height: number };
        sha256?: string;
        rawImagesRedacted: true;
        error?: string;
    }> {
        const normalizedPath = path.resolve(String(imagePath || ''));
        const base = {
            path: normalizedPath,
            rawImagesRedacted: true as const
        };
        try {
            if (!fs.existsSync(normalizedPath)) {
                return {
                    ...base,
                    success: false,
                    status: 'missing',
                    exists: false,
                    isFile: false,
                    error: '文件不存在'
                };
            }

            const stats = fs.statSync(normalizedPath);
            if (!stats.isFile()) {
                return {
                    ...base,
                    success: false,
                    status: 'not_file',
                    exists: true,
                    isFile: false,
                    error: '目标不是文件'
                };
            }

            const ext = path.extname(normalizedPath).toLowerCase();
            if (!IMAGE_EXTENSIONS.includes(ext)) {
                return {
                    ...base,
                    success: false,
                    status: 'unsupported',
                    exists: true,
                    isFile: true,
                    byteLength: stats.size,
                    format: ext.replace(/^\./, ''),
                    error: '不支持的图片格式'
                };
            }

            const metadata = await sharp(normalizedPath).metadata();
            const buffer = fs.readFileSync(normalizedPath);
            const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
            const mimeTypes: Record<string, string> = {
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.png': 'image/png',
                '.gif': 'image/gif',
                '.webp': 'image/webp',
                '.bmp': 'image/bmp',
                '.tiff': 'image/tiff',
                '.tif': 'image/tiff'
            };

            return {
                ...base,
                success: true,
                status: 'ok',
                exists: true,
                isFile: true,
                byteLength: stats.size,
                format: String(metadata.format || ext.replace(/^\./, '')),
                mimeType: mimeTypes[ext] || 'image/jpeg',
                dimensions: {
                    width: metadata.width || 0,
                    height: metadata.height || 0
                },
                sha256
            };
        } catch (e) {
            return {
                ...base,
                success: false,
                status: 'decode_failed',
                exists: fs.existsSync(normalizedPath),
                isFile: fs.existsSync(normalizedPath) ? fs.statSync(normalizedPath).isFile() : false,
                error: `图片探针失败: ${e instanceof Error ? e.message : e}`
            };
        }
    }

    /**
     * 只读图片像素探针：比较参考图与结果图的粗粒度亮度/暗部轮廓相似度。
     * 不返回原始图片内容或 base64；该指标只能作为 QA 证据，不能作为审美验收。
     */
    async compareImageFiles(referencePath: string, resultPath: string, options?: {
        targetSize?: { width?: number; height?: number };
        thresholds?: {
            maxMae?: number;
            maxHighDeltaRatio?: number;
            minDarkJaccard?: number;
            minSoftDarkJaccard?: number;
            softMaskBlurSigma?: number;
            softMaskDarkThreshold?: number;
        };
    }): Promise<{
        success: boolean;
        status: PixelProbeStatus;
        mode: 'pixel-probe';
        referencePath: string;
        resultPath: string;
        width?: number;
        height?: number;
        mae?: number;
        rmse?: number;
        highDeltaRatio?: number;
        darkJaccard?: number;
        softDarkJaccard?: number;
        softMaskBlurSigma?: number;
        softMaskDarkThreshold?: number;
        referenceDarkPixels?: number;
        resultDarkPixels?: number;
        summary?: string;
        boundary: string;
        rawImagesRedacted: true;
        error?: string;
    }> {
        const normalizedReferencePath = path.resolve(String(referencePath || ''));
        const normalizedResultPath = path.resolve(String(resultPath || ''));
        const boundary = 'Pixel probe only. It checks coarse screenshot similarity and antialias-tolerant dark-shape overlap; it is not a high-fidelity design acceptance score.';
        const base = {
            mode: 'pixel-probe' as const,
            referencePath: normalizedReferencePath,
            resultPath: normalizedResultPath,
            boundary,
            rawImagesRedacted: true as const
        };

        try {
            const referenceProbe = await this.probeImageFile(normalizedReferencePath);
            if (!referenceProbe.success || referenceProbe.status !== 'ok') {
                return {
                    ...base,
                    success: false,
                    status: 'unverified',
                    summary: '参考图不可用于像素探针。',
                    error: referenceProbe.error || referenceProbe.status
                };
            }

            const resultProbe = await this.probeImageFile(normalizedResultPath);
            if (!resultProbe.success || resultProbe.status !== 'ok') {
                return {
                    ...base,
                    success: false,
                    status: 'unverified',
                    summary: '结果图不可用于像素探针。',
                    error: resultProbe.error || resultProbe.status
                };
            }

            const width = toPositiveInt(
                options?.targetSize?.width,
                resultProbe.dimensions?.width || referenceProbe.dimensions?.width || 800
            );
            const height = toPositiveInt(
                options?.targetSize?.height,
                resultProbe.dimensions?.height || referenceProbe.dimensions?.height || 800
            );
            const thresholds = {
                maxMae: Number(options?.thresholds?.maxMae ?? 18),
                maxHighDeltaRatio: Number(options?.thresholds?.maxHighDeltaRatio ?? 0.18),
                minDarkJaccard: Number(options?.thresholds?.minDarkJaccard ?? 0.62),
                minSoftDarkJaccard: Number(options?.thresholds?.minSoftDarkJaccard ?? options?.thresholds?.minDarkJaccard ?? 0.62),
                softMaskBlurSigma: Number(options?.thresholds?.softMaskBlurSigma ?? 1.5),
                softMaskDarkThreshold: Number(options?.thresholds?.softMaskDarkThreshold ?? 180)
            };

            const referenceRaw = await readLumaRawForProbe(normalizedReferencePath, width, height);
            const resultRaw = await readLumaRawForProbe(normalizedResultPath, width, height);
            const hardMetrics = compareLumaRawForProbe(referenceRaw, resultRaw);
            const softReferenceRaw = await readLumaRawForProbe(normalizedReferencePath, width, height, thresholds.softMaskBlurSigma);
            const softResultRaw = await readLumaRawForProbe(normalizedResultPath, width, height, thresholds.softMaskBlurSigma);
            const softMetrics = compareLumaRawForProbe(softReferenceRaw, softResultRaw, thresholds.softMaskDarkThreshold);

            const darkShapeMatches = hardMetrics.darkJaccard >= thresholds.minDarkJaccard
                || softMetrics.darkJaccard >= thresholds.minSoftDarkJaccard;
            const status: PixelProbeStatus = hardMetrics.mae <= thresholds.maxMae
                && hardMetrics.highDeltaRatio <= thresholds.maxHighDeltaRatio
                && darkShapeMatches
                ? 'ok'
                : 'watch';

            return {
                ...base,
                success: true,
                status,
                width,
                height,
                mae: roundMetric(hardMetrics.mae, 3),
                rmse: roundMetric(hardMetrics.rmse, 3),
                highDeltaRatio: roundMetric(hardMetrics.highDeltaRatio, 4),
                darkJaccard: roundMetric(hardMetrics.darkJaccard, 4),
                softDarkJaccard: roundMetric(softMetrics.darkJaccard, 4),
                softMaskBlurSigma: roundMetric(thresholds.softMaskBlurSigma, 2),
                softMaskDarkThreshold: roundMetric(thresholds.softMaskDarkThreshold, 0),
                referenceDarkPixels: hardMetrics.referenceDark,
                resultDarkPixels: hardMetrics.resultDark,
                summary: `pixelProbe=${status}; mae=${roundMetric(hardMetrics.mae, 3)}; highDeltaRatio=${roundMetric(hardMetrics.highDeltaRatio, 4)}; darkJaccard=${roundMetric(hardMetrics.darkJaccard, 4)}。`
            };
        } catch (e) {
            return {
                ...base,
                success: false,
                status: 'unverified',
                summary: '像素探针执行失败。',
                error: e instanceof Error ? e.message : String(e)
            };
        }
    }

    /**
     * 为 AI 生成资源摘要
     */
    async generateResourceSummary(directory?: string): Promise<string> {
        const scanResult = await this.scanDirectory(directory || this.projectRoot);
        const categories = await this.getResourcesByCategory(directory);

        const lines: string[] = [
            `📊 **项目资源概览**`,
            ``,
            `- 总图片数: ${scanResult.imageCount}`,
            `- 设计文件: ${scanResult.designCount}`,
            ``,
            `📁 **按类别分类**:`,
            `- 产品图: ${categories.products.length} 张`,
            `- 背景图: ${categories.backgrounds.length} 张`,
            `- 装饰元素: ${categories.elements.length} 张`,
            `- 参考图: ${categories.references.length} 张`,
            `- 其他: ${categories.others.length} 张`,
        ];

        // 列出一些示例文件
        if (categories.products.length > 0) {
            lines.push('', '🛍️ **产品图示例**:');
            categories.products.slice(0, 5).forEach(f => {
                lines.push(`  - ${f.relativePath}`);
            });
        }

        if (categories.backgrounds.length > 0) {
            lines.push('', '🖼️ **背景图示例**:');
            categories.backgrounds.slice(0, 5).forEach(f => {
                lines.push(`  - ${f.relativePath}`);
            });
        }

        return lines.join('\n');
    }

    /**
     * 分析素材图片内容（使用视觉模型）
     */
    async analyzeAssetContent(
        imagePath: string,
        visionModelCall: (imageBase64: string, prompt: string) => Promise<string>
    ): Promise<{
        success: boolean;
        analysis?: {
            description: string;
            category: string;
            mainSubject: string;
            colors: string[];
            style: string;
            suggestedPlacement: string;
            suggestedEffects: string[];
        };
        error?: string;
    }> {
        try {
            const previewResult = await this.getImagePreview(imagePath, 512);
            if (!previewResult.success || !previewResult.imageData) {
                return { success: false, error: previewResult.error };
            }

            const prompt = `Analyze this e-commerce asset image and return JSON only.
{
  "description": "Brief visual summary within 20 Chinese characters",
  "category": "product_main | product_detail | scene | background | decorative_element | person | text_label | other",
  "mainSubject": "Main visible subject",
  "colors": ["#RRGGBB", "#RRGGBB", "#RRGGBB"],
  "style": "Short style phrase such as minimal / elegant / lively / cute / premium",
  "suggestedPlacement": "Suggested detail-page usage such as hero image / selling point / detail close-up / footer support",
  "suggestedEffects": ["clipping_mask", "drop_shadow"]
}

Allowed suggestedEffects:
- "clipping_mask"
- "drop_shadow"
- "rounded_corner"
- "stroke_emphasis"
- "blurred_background"
- "color_tuning"
- "direct_use"

Return JSON only.`;

            const response = await visionModelCall(
                `data:image/jpeg;base64,${previewResult.imageData}`,
                prompt
            );

            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const analysis = JSON.parse(jsonMatch[0]);
                return { success: true, analysis };
            }

            return { success: false, error: '无法解析分析结果' };
        } catch (e) {
            return {
                success: false,
                error: `分析失败: ${e instanceof Error ? e.message : e}`
            };
        }
    }

    /**
     * 智能推荐素材（根据设计需求）
     */
    private getRequirementKeywords(requirement: string): string[] {
        const raw = String(requirement || '')
            .toLowerCase()
            .split(/[\s,;:，。、“”'"!?()[\]{}\-_/\\|]+/)
            .map((k) => k.trim())
            .filter((k) => k.length >= 2);
        return Array.from(new Set(raw)).slice(0, 12);
    }

    private inferCategoryFromRequirement(requirement: string): 'products' | 'backgrounds' | 'elements' | 'references' | null {
        const text = String(requirement || '').toLowerCase();
        const categoryHints: Array<{ key: 'products' | 'backgrounds' | 'elements' | 'references'; words: string[] }> = [
            { key: 'products', words: ['产品', '商品', '主图', '款式', 'product', 'item', 'model'] },
            { key: 'backgrounds', words: ['背景', '底图', '场景底图', 'bg', 'background'] },
            { key: 'elements', words: ['元素', '装饰', '图标', '标签', 'icon', 'sticker'] },
            { key: 'references', words: ['参考', '风格', '版式', '样式', 'style', 'reference'] }
        ];

        for (const item of categoryHints) {
            if (item.words.some((word) => text.includes(word))) {
                return item.key;
            }
        }
        return null;
    }

    private fileMatchesCategory(file: ResourceFile, categoryKey: 'products' | 'backgrounds' | 'elements' | 'references'): boolean {
        const text = `${file.name} ${file.relativePath}`.toLowerCase();
        const keywords: Record<'products' | 'backgrounds' | 'elements' | 'references', string[]> = {
            products: ['产品', '商品', '主图', '款式', 'product', 'item', 'model'],
            backgrounds: ['背景', '底图', '场景', 'bg', 'background'],
            elements: ['元素', '装饰', '图标', '标签', 'element', 'icon'],
            references: ['参考', '风格', '版式', '样式', 'ref', 'style', 'template']
        };
        return keywords[categoryKey].some((word) => text.includes(word));
    }

    private clampScore(score: number): number {
        if (!Number.isFinite(score)) return 0;
        return Math.max(0, Math.min(100, Math.round(score)));
    }

    private scoreCandidateFile(
        file: ResourceFile,
        requirementKeywords: string[],
        inferredCategory: 'products' | 'backgrounds' | 'elements' | 'references' | null
    ): { score: number; reasons: string[] } {
        const searchText = `${file.name} ${file.relativePath}`.toLowerCase();
        let score = 12;
        const reasons: string[] = [];

        let keywordHits = 0;
        for (const keyword of requirementKeywords) {
            if (searchText.includes(keyword)) {
                keywordHits += 1;
                score += keywordHits === 1 ? 20 : 10;
                if (reasons.length < 2) {
                    reasons.push(`keyword match: ${keyword}`);
                }
            }
        }

        if (inferredCategory) {
            if (this.fileMatchesCategory(file, inferredCategory)) {
                score += 20;
                reasons.push(`category hint: ${inferredCategory}`);
            } else {
                score -= 8;
            }
        }

        const width = Number(file.dimensions?.width || 0);
        const height = Number(file.dimensions?.height || 0);
        if (width > 0 && height > 0) {
            const megaPixels = (width * height) / 1_000_000;
            score += Math.min(22, megaPixels * 4.5);
            if (megaPixels >= 1.2 && reasons.length < 3) {
                reasons.push(`high resolution: ${width}x${height}`);
            }
        }

        const ext = String(file.extension || '').toLowerCase();
        if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
            score += 3;
        }

        return {
            score: this.clampScore(score),
            reasons: reasons.slice(0, 3)
        };
    }

    private parseJsonObject<T>(input: string): T | null {
        if (!input) return null;
        const match = input.match(/\{[\s\S]*\}/);
        if (!match) return null;
        try {
            return JSON.parse(match[0]) as T;
        } catch {
            return null;
        }
    }

    /**
     * Recommend project assets based on requirement text and lightweight vision re-ranking.
     */
    async recommendAssets(
        requirement: string,
        visionModelCall: (imageBase64: string, prompt: string) => Promise<string>,
        options: {
            maxResults?: number;
            category?: string;
            deterministic?: boolean;
        } = {}
    ): Promise<{
        success: boolean;
        recommendations?: Array<{
            file: ResourceFile;
            matchScore: number;
            matchReason: string;
            suggestedUse: string;
        }>;
        error?: string;
    }> {
        const { maxResults = 5, category, deterministic = false } = options;

        try {
            const normalizedRequirement = String(requirement || '').trim() || 'find suitable project assets';
            const scanResult = await this.scanDirectory();
            let candidates = scanResult.files.filter((f) => f.type === 'image');

            if (category) {
                const categories = await this.getResourcesByCategory();
                candidates = categories[category as keyof typeof categories] || candidates;
            }

            if (candidates.length === 0) {
                return { success: true, recommendations: [] };
            }

            const requirementKeywords = this.getRequirementKeywords(normalizedRequirement);
            const inferredCategory = category ? null : this.inferCategoryFromRequirement(normalizedRequirement);

            const heuristicRanked = candidates
                .map((file) => {
                    const heuristic = this.scoreCandidateFile(file, requirementKeywords, inferredCategory);
                    return {
                        file,
                        heuristicScore: heuristic.score,
                        heuristicReason: heuristic.reasons.join(' / ') || 'base ranking'
                    };
                })
                .sort((a, b) => {
                    if (b.heuristicScore !== a.heuristicScore) return b.heuristicScore - a.heuristicScore;
                    if (deterministic) {
                        return String(a.file.path || '').localeCompare(String(b.file.path || ''));
                    }
                    return 0;
                })
                .slice(0, 12);

            const recommendations: Array<{
                file: ResourceFile;
                matchScore: number;
                matchReason: string;
                suggestedUse: string;
            }> = [];

            const visionCandidates = heuristicRanked.slice(0, 5);
            for (const candidate of visionCandidates) {
                let modelScore: number | undefined;
                let modelReason = '';
                let suggestedUse = '';

                try {
                    const preview = await this.getImagePreview(candidate.file.path, 320);
                    if (preview.success && preview.imageData) {
                        const prompt = `Evaluate how well this image matches the following design need: ${normalizedRequirement}

Return JSON only:
{
  "score": 0-100,
  "reason": "Short explanation",
  "suggestedUse": "How this image could be used in the design"
}`;

                        const response = await visionModelCall(
                            `data:image/jpeg;base64,${preview.imageData}`,
                            prompt
                        );
                        const parsed = this.parseJsonObject<{
                            score?: number;
                            reason?: string;
                            suggestedUse?: string;
                        }>(response);

                        if (parsed) {
                            modelScore = this.clampScore(Number(parsed.score || 0));
                            modelReason = String(parsed.reason || '').trim();
                            suggestedUse = String(parsed.suggestedUse || '').trim();
                        }
                    }
                } catch {
                    console.warn(`[ResourceManager] Vision re-rank failed for: ${candidate.file.path}`);
                }

                const finalScore = modelScore === undefined
                    ? candidate.heuristicScore
                    : this.clampScore(candidate.heuristicScore * 0.55 + modelScore * 0.45);
                const finalReason = modelReason
                    ? `${modelReason} | heuristic: ${candidate.heuristicReason}`
                    : `heuristic: ${candidate.heuristicReason}`;

                recommendations.push({
                    file: candidate.file,
                    matchScore: finalScore,
                    matchReason: finalReason,
                    suggestedUse: suggestedUse || 'Use as a candidate image for the current design requirement'
                });
            }

            for (const candidate of heuristicRanked.slice(visionCandidates.length)) {
                recommendations.push({
                    file: candidate.file,
                    matchScore: candidate.heuristicScore,
                    matchReason: `heuristic: ${candidate.heuristicReason}`,
                    suggestedUse: 'Use as a backup candidate'
                });
            }

            recommendations.sort((a, b) => {
                if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
                if (deterministic) {
                    return String(a.file.path || '').localeCompare(String(b.file.path || ''));
                }
                return 0;
            });
            return {
                success: true,
                recommendations: recommendations.slice(0, maxResults)
            };
        } catch (e) {
            return {
                success: false,
                error: `Asset recommendation failed: ${e instanceof Error ? e.message : e}`
            };
        }
    }

    async getAssetDetails(imagePath: string): Promise<{
        success: boolean;
        details?: {
            path: string;
            name: string;
            dimensions: { width: number; height: number };
            size: number;
            format: string;
            preview: string;  // base64 缩略图
        };
        error?: string;
    }> {
        try {
            if (!fs.existsSync(imagePath)) {
                return { success: false, error: '文件不存在' };
            }

            const stats = fs.statSync(imagePath);
            const ext = path.extname(imagePath).toLowerCase();
            const metadata = await sharp(imagePath).metadata();
            const thumbnail = await this.generateThumbnail(imagePath, 200);

            return {
                success: true,
                details: {
                    path: imagePath,
                    name: path.basename(imagePath),
                    dimensions: {
                        width: metadata.width || 0,
                        height: metadata.height || 0
                    },
                    size: stats.size,
                    format: ext.slice(1),
                    preview: thumbnail || ''
                }
            };
        } catch (e) {
            return {
                success: false,
                error: `获取详情失败: ${e instanceof Error ? e.message : e}`
            };
        }
    }
}

export default ResourceManagerService;
