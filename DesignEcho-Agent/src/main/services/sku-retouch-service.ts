import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { pipeline } from 'stream/promises';
import sharp from 'sharp';

import {
    SKU_RETOUCH_ASSETS_VERSION,
    SKU_RETOUCH_REPORT_VERSION,
    buildSkuRetouchUniformScaleMetrics,
    type PrepareSkuRetouchAssetsInput,
    type SkuRetouchAlphaBounds,
    type SkuRetouchAlphaSafetyMetrics,
    type SkuRetouchCacheIdentity,
    type SkuRetouchPreparedSource,
    type SkuRetouchReport,
    type SkuRetouchSourceClassification,
    type SkuRetouchSourceInput,
    type SkuRetouchSourceMode
} from '../../shared/sku-retouch-contract';
import type { MattingService } from './matting-service';
import {
    analyzeSkuRetouchShape,
    chooseSkuRetouchReferenceIndex,
    type SkuRetouchRaster,
    type SkuRetouchShapeAnalysis
} from './sku-retouch/geometry';

interface PreparedWorkingSource {
    source: Required<Pick<SkuRetouchSourceInput, 'filePath'>> & SkuRetouchSourceInput & { sourceId: string };
    classification: SkuRetouchSourceClassification;
    studioConfidence: number;
    backgroundLuminance: number;
    raster: SkuRetouchRaster;
    mask: Buffer;
    shape: SkuRetouchShapeAnalysis;
}

/** 等比缩放到统一画布后的主体资产（阶段边界：不变形、不产阴影与中性灰）。 */
interface UniformScaleAsset {
    productPng: Buffer;
    previewJpeg: Buffer;
    canvasWidth: number;
    canvasHeight: number;
    subjectWidth: number;
    subjectHeight: number;
    alphaSafety: SkuRetouchAlphaSafetyMetrics;
}

interface SubjectCropPlan {
    left: number;
    top: number;
    width: number;
    height: number;
    extendTop: number;
    extendRight: number;
    extendBottom: number;
    extendLeft: number;
    paddedWidth: number;
    paddedHeight: number;
    targetHeight: number;
    predictedWidth: number;
    sourceAlphaPixelCount: number;
    retainedAlphaPixelCount: number;
}

const DEFAULT_MAX_LONG_EDGE = 2048;
const MIN_LONG_EDGE = 1024;
const MAX_LONG_EDGE = 3072;
const MAX_SOURCE_COUNT = 12;
const MAX_SOURCE_INPUT_PIXELS = 64 * 1024 * 1024;
const MIN_UNIFORM_SCALE_FACTOR = 0.25;
const MAX_UNIFORM_SCALE_FACTOR = 4;
const MAX_UNIFORM_CANVAS_EDGE = 4096;
const MAX_UNIFORM_CANVAS_PIXELS = 12_000_000;
const MAX_UNIFORM_BATCH_PIXELS = 72_000_000;
const SUBJECT_ENVELOPE_PADDING_RATIO = 0.08;
const SUBJECT_GUARD_PADDING_RATIO = 0.012;
const MAX_SUBJECT_ENVELOPE_PADDING = 96;
const MAX_SUBJECT_GUARD_PADDING = 48;
const MIN_OUTPUT_ALPHA_SAFE_INSET = 2;

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function clean(value: unknown): string {
    return String(value || '').trim();
}

function normalizePathForComparison(value: string): string {
    return path.resolve(value).replace(/\\/g, '/').toLocaleLowerCase('zh-Hans-CN');
}

function safeFileStem(value: string, fallback: string): string {
    const stem = clean(value).replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/g, '');
    return stem || fallback;
}

function resolveSourceMode(value: unknown): SkuRetouchSourceMode {
    if (value === 'studio' || value === 'scene') return value;
    return 'auto';
}

function normalizeSources(sources: SkuRetouchSourceInput[]): Array<SkuRetouchSourceInput & { sourceId: string }> {
    if (!Array.isArray(sources) || sources.length === 0) {
        throw new Error('SKU 素材精修至少需要一张来源图片。');
    }
    if (sources.length > MAX_SOURCE_COUNT) {
        throw new Error(`SKU 素材精修单批最多 ${MAX_SOURCE_COUNT} 张，当前收到 ${sources.length} 张。`);
    }
    const seenPaths = new Set<string>();
    const seenSourceIds = new Set<string>();
    return sources.map((source, index) => {
        const filePath = clean(source?.filePath);
        if (!filePath) throw new Error(`第 ${index + 1} 张 SKU 素材缺少 filePath。`);
        const normalizedPath = normalizePathForComparison(filePath);
        if (seenPaths.has(normalizedPath)) throw new Error(`SKU 素材重复：${filePath}`);
        seenPaths.add(normalizedPath);
        const sourceId = clean(source.sourceId) || `S${String(index + 1).padStart(2, '0')}`;
        if (seenSourceIds.has(sourceId)) throw new Error(`SKU 素材 sourceId 重复：${sourceId}`);
        seenSourceIds.add(sourceId);
        return {
            ...source,
            filePath: path.resolve(filePath),
            sourceId
        };
    });
}

async function assertSourceFiles(sources: Array<SkuRetouchSourceInput & { sourceId: string }>): Promise<void> {
    for (const source of sources) {
        const stat = await fs.promises.lstat(source.filePath);
        if (!stat.isFile()) throw new Error(`SKU 素材不是普通文件：${source.filePath}`);
    }
}

async function sha256File(filePath: string): Promise<string> {
    const hash = createHash('sha256');
    await pipeline(fs.createReadStream(filePath), hash);
    return hash.digest('hex');
}

function sha256Buffer(value: Buffer): string {
    return createHash('sha256').update(value).digest('hex');
}

function fnv1a32Buffer(value: Buffer): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value[index];
        hash = Math.imul(hash, 0x01000193);
    }
    return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

async function buildBatchIdentity(input: {
    sources: Array<SkuRetouchSourceInput & { sourceId: string }>;
    maxLongEdge: number;
    sourceMode: SkuRetouchSourceMode;
    referenceSourcePath?: string;
}): Promise<SkuRetouchCacheIdentity> {
    const fingerprint: SkuRetouchCacheIdentity['sources'] = [];
    for (const source of input.sources) {
        const before = await fs.promises.lstat(source.filePath);
        if (!before.isFile()) throw new Error(`SKU 素材不是普通文件：${source.filePath}`);
        const sourceSha256 = await sha256File(source.filePath);
        const after = await fs.promises.lstat(source.filePath);
        if (!after.isFile()
            || before.size !== after.size
            || Math.round(before.mtimeMs) !== Math.round(after.mtimeMs)) {
            throw new Error(`SKU 素材在建立处理身份时发生变化，请待文件写入完成后重试：${source.filePath}`);
        }
        fingerprint.push({
            sourceId: source.sourceId,
            colorName: clean(source.colorName) || undefined,
            sourcePath: path.resolve(source.filePath),
            sourceByteLength: after.size,
            sourceSha256
        });
    }
    const referenceSourcePath = input.referenceSourcePath
        ? path.resolve(input.referenceSourcePath)
        : undefined;
    const batchId = createHash('sha256').update(JSON.stringify({
        version: SKU_RETOUCH_ASSETS_VERSION,
        fingerprint: fingerprint.map((source) => ({
            ...source,
            sourcePath: normalizePathForComparison(source.sourcePath)
        })),
        maxLongEdge: input.maxLongEdge,
        sourceMode: input.sourceMode,
        referenceSourcePath: referenceSourcePath
            ? normalizePathForComparison(referenceSourcePath)
            : undefined
    })).digest('hex').slice(0, 16);
    return {
        batchId,
        sourceMode: input.sourceMode,
        maxLongEdge: input.maxLongEdge,
        referenceSourcePath,
        sources: fingerprint
    };
}

function resolveOutputRoot(input: PrepareSkuRetouchAssetsInput, firstSourcePath: string): string {
    if (clean(input.outputDir)) return path.resolve(clean(input.outputDir));
    if (clean(input.projectPath)) return path.join(path.resolve(clean(input.projectPath)), '.designecho', 'sku-retouch');
    return path.join(path.dirname(firstSourcePath), '.designecho', 'sku-retouch');
}

function findAlphaBounds(
    alpha: Buffer,
    width: number,
    height: number,
    threshold = 1
): { bounds: SkuRetouchAlphaBounds; pixelCount: number } | null {
    if (alpha.length !== width * height) {
        throw new Error(`alpha 像素尺寸不一致：期望 ${width * height} 字节，实际 ${alpha.length} 字节。`);
    }
    let left = width;
    let top = height;
    let right = -1;
    let bottom = -1;
    let pixelCount = 0;
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            if (alpha[y * width + x] < threshold) continue;
            left = Math.min(left, x);
            top = Math.min(top, y);
            right = Math.max(right, x);
            bottom = Math.max(bottom, y);
            pixelCount += 1;
        }
    }
    if (pixelCount === 0) return null;
    return {
        bounds: {
            left,
            top,
            right: right + 1,
            bottom: bottom + 1,
            width: right - left + 1,
            height: bottom - top + 1
        },
        pixelCount
    };
}

function extractAlphaChannel(rgba: Buffer, width: number, height: number, channels: number): Buffer {
    if (channels < 4 || rgba.length !== width * height * channels) {
        throw new Error('SKU 透明主体产物没有可验证的 RGBA 像素。');
    }
    const alpha = Buffer.allocUnsafe(width * height);
    for (let index = 0; index < width * height; index += 1) {
        alpha[index] = rgba[index * channels + channels - 1];
    }
    return alpha;
}

function measureOutputAlphaSafety(
    rgba: Buffer,
    width: number,
    height: number,
    channels: number
): Pick<SkuRetouchAlphaSafetyMetrics, 'outputAlphaPixelCount' | 'outputAlphaBounds' | 'safeInsets' | 'outputEdgesClear'> {
    const alpha = extractAlphaChannel(rgba, width, height, channels);
    const measured = findAlphaBounds(alpha, width, height);
    if (!measured) throw new Error('SKU 透明主体产物不含非零 alpha 像素。');
    const safeInsets = {
        top: measured.bounds.top,
        right: width - measured.bounds.right,
        bottom: height - measured.bounds.bottom,
        left: measured.bounds.left
    };
    return {
        outputAlphaPixelCount: measured.pixelCount,
        outputAlphaBounds: measured.bounds,
        safeInsets,
        outputEdgesClear: Object.values(safeInsets).every((value) => value >= MIN_OUTPUT_ALPHA_SAFE_INSET)
    };
}

function measureOutputSubjectBounds(
    rgba: Buffer,
    width: number,
    height: number,
    channels: number
): SkuRetouchAlphaBounds {
    const alpha = extractAlphaChannel(rgba, width, height, channels);
    const measured = findAlphaBounds(alpha, width, height, 104);
    if (!measured) throw new Error('SKU 透明主体产物没有达到主体测量阈值的 alpha 像素。');
    return measured.bounds;
}

function isFullSha256(value: unknown): value is string {
    return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function isPathInsideDirectory(filePath: string, directoryPath: string): boolean {
    const relative = path.relative(path.resolve(directoryPath), path.resolve(filePath));
    return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function cacheIdentitiesMatch(first: SkuRetouchCacheIdentity, second: SkuRetouchCacheIdentity): boolean {
    if (first.batchId !== second.batchId
        || first.sourceMode !== second.sourceMode
        || first.maxLongEdge !== second.maxLongEdge
        || normalizePathForComparison(first.referenceSourcePath || '') !== normalizePathForComparison(second.referenceSourcePath || '')
        || first.sources.length !== second.sources.length) {
        return false;
    }
    return first.sources.every((source, index) => {
        const candidate = second.sources[index];
        return source.sourceId === candidate?.sourceId
            && clean(source.colorName) === clean(candidate?.colorName)
            && normalizePathForComparison(source.sourcePath) === normalizePathForComparison(candidate?.sourcePath || '')
            && source.sourceByteLength === candidate?.sourceByteLength
            && source.sourceSha256 === candidate?.sourceSha256;
    });
}

async function decodeImageFile(filePath: string): Promise<{
    width: number;
    height: number;
    channels: number;
    format?: string;
    hasAlpha: boolean;
    data: Buffer;
}> {
    // Windows 下 libvips 的文件输入缓存可能在校验返回后仍短暂持有句柄，阻止同批损坏产物原位重建。
    // 先完整读入 Buffer，文件句柄在进入 Sharp 前即关闭；尺寸预算仍由 metadata/readback 双重校验。
    const encoded = await fs.promises.readFile(filePath);
    const metadata = await sharp(encoded, {
        failOn: 'warning',
        limitInputPixels: MAX_UNIFORM_CANVAS_PIXELS
    }).metadata();
    const width = Number(metadata.width || 0);
    const height = Number(metadata.height || 0);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
        || width > MAX_UNIFORM_CANVAS_EDGE || height > MAX_UNIFORM_CANVAS_EDGE
        || width * height > MAX_UNIFORM_CANVAS_PIXELS) {
        throw new Error(`缓存图像尺寸越界：${width}×${height}`);
    }
    const decoded = await sharp(encoded, {
        failOn: 'warning',
        limitInputPixels: MAX_UNIFORM_CANVAS_PIXELS
    }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return {
        width,
        height,
        channels: decoded.info.channels,
        format: metadata.format,
        hasAlpha: metadata.hasAlpha === true,
        data: decoded.data
    };
}

async function cachedPreparedAssetIsValid(
    source: SkuRetouchPreparedSource,
    outputDir: string
): Promise<boolean> {
    if (!source.productPath || !source.previewPath
        || !isPathInsideDirectory(source.productPath, outputDir)
        || !isPathInsideDirectory(source.previewPath, outputDir)
        || !isFullSha256(source.productSha256)
        || !/^fnv1a32:[a-f0-9]{8}$/i.test(String(source.productChecksum || ''))
        || !isFullSha256(source.previewSha256)
        || !Number.isSafeInteger(source.productByteLength)
        || !Number.isSafeInteger(source.previewByteLength)
        || !Number.isSafeInteger(source.width)
        || !Number.isSafeInteger(source.height)) {
        return false;
    }
    const [productStat, previewStat] = await Promise.all([
        fs.promises.lstat(source.productPath),
        fs.promises.lstat(source.previewPath)
    ]);
    if (!productStat.isFile() || !previewStat.isFile()
        || productStat.size !== source.productByteLength
        || previewStat.size !== source.previewByteLength) {
        return false;
    }
    const productSha256 = await sha256File(source.productPath);
    if (productSha256 !== source.productSha256) return false;
    const productBuffer = await fs.promises.readFile(source.productPath);
    if (fnv1a32Buffer(productBuffer) !== source.productChecksum) return false;
    const previewSha256 = await sha256File(source.previewPath);
    if (previewSha256 !== source.previewSha256) return false;
    const product = await decodeImageFile(source.productPath);
    if (product.format !== 'png'
        || product.hasAlpha !== true
        || product.width !== source.width
        || product.height !== source.height) {
        return false;
    }
    const preview = await decodeImageFile(source.previewPath);
    if (preview.format !== 'jpeg'
        || preview.width !== source.width
        || preview.height !== source.height) {
        return false;
    }
    const alphaSafety = measureOutputAlphaSafety(
        product.data,
        product.width,
        product.height,
        product.channels
    );
    const outputSubjectBounds = measureOutputSubjectBounds(
        product.data,
        product.width,
        product.height,
        product.channels
    );
    const storedAlphaSafety = source.alphaSafety;
    const storedScale = source.uniformScale;
    if (!storedAlphaSafety || !storedScale) return false;
    const recalculatedScale = buildSkuRetouchUniformScaleMetrics({
        originalSubjectWidth: storedScale.originalSubjectWidth,
        originalSubjectHeight: storedScale.originalSubjectHeight,
        outputSubjectWidth: storedScale.outputSubjectWidth,
        outputSubjectHeight: storedScale.outputSubjectHeight,
        targetSubjectHeight: storedScale.targetSubjectHeight
    });
    return storedAlphaSafety.sourceAlphaPixelCount > 0
        && storedAlphaSafety.sourceAlphaPixelCount === storedAlphaSafety.retainedAlphaPixelCount
        && storedAlphaSafety.sourcePixelsPreserved === true
        && storedAlphaSafety.outputEdgesClear === true
        && alphaSafety.outputEdgesClear === true
        && alphaSafety.outputAlphaPixelCount === storedAlphaSafety.outputAlphaPixelCount
        && JSON.stringify(alphaSafety.outputAlphaBounds) === JSON.stringify(storedAlphaSafety.outputAlphaBounds)
        && JSON.stringify(alphaSafety.safeInsets) === JSON.stringify(storedAlphaSafety.safeInsets)
        && outputSubjectBounds.width === storedScale.outputSubjectWidth
        && outputSubjectBounds.height === storedScale.outputSubjectHeight
        && recalculatedScale.subjectHeightUniform === true
        && recalculatedScale.aspectRatioPreserved === true
        && JSON.stringify(recalculatedScale) === JSON.stringify(storedScale);
}

async function validateCachedReport(
    parsed: SkuRetouchReport,
    expectedIdentity: SkuRetouchCacheIdentity,
    outputDir: string,
    reportPath: string
): Promise<boolean> {
    if (parsed.version !== SKU_RETOUCH_REPORT_VERSION
        || parsed.assetVersion !== SKU_RETOUCH_ASSETS_VERSION
        || !cacheIdentitiesMatch(parsed.cacheIdentity, expectedIdentity)
        || normalizePathForComparison(parsed.outputDir) !== normalizePathForComparison(outputDir)
        || normalizePathForComparison(parsed.reportPath) !== normalizePathForComparison(reportPath)
        || !Array.isArray(parsed.sources)
        || parsed.sources.length !== expectedIdentity.sources.length) {
        return false;
    }
    for (let index = 0; index < parsed.sources.length; index += 1) {
        const source = parsed.sources[index];
        const identity = expectedIdentity.sources[index];
        if (source.sourceId !== identity.sourceId
            || clean(source.colorName) !== clean(identity.colorName)
            || normalizePathForComparison(source.sourcePath) !== normalizePathForComparison(identity.sourcePath)) {
            return false;
        }
        if (source.status === 'prepared' && !(await cachedPreparedAssetIsValid(source, outputDir))) {
            return false;
        }
        if (source.status !== 'prepared'
            && (source.productPath || source.previewPath || source.productSha256 || source.previewSha256)) {
            return false;
        }
    }
    return true;
}

async function readCachedReport(
    reportPath: string,
    expectedIdentity: SkuRetouchCacheIdentity,
    outputDir: string
): Promise<SkuRetouchReport | null> {
    if (!fs.existsSync(reportPath)) return null;
    try {
        const reportStat = await fs.promises.lstat(reportPath);
        if (!reportStat.isFile()) return null;
        const raw = await fs.promises.readFile(reportPath, 'utf8');
        const parsed = JSON.parse(raw) as SkuRetouchReport;
        if (!(await validateCachedReport(parsed, expectedIdentity, outputDir, reportPath))) return null;
        return { ...parsed, cacheHit: true };
    } catch {
        // 缓存是可丢弃派生物；JSON、文件、摘要或解码任一损坏都必须重算，不能伪命中。
        return null;
    }
}

async function assertSourceIdentityUnchanged(identity: SkuRetouchCacheIdentity): Promise<void> {
    for (const source of identity.sources) {
        const stat = await fs.promises.lstat(source.sourcePath);
        if (!stat.isFile() || stat.size !== source.sourceByteLength
            || await sha256File(source.sourcePath) !== source.sourceSha256) {
            throw new Error(`SKU 素材在处理期间发生变化，已停止写入缓存报告：${source.sourcePath}`);
        }
    }
}

function classifyStudioRaster(raster: SkuRetouchRaster, override: SkuRetouchSourceMode): {
    classification: SkuRetouchSourceClassification;
    studioConfidence: number;
    backgroundLuminance: number;
} {
    const borderX = Math.max(2, Math.round(raster.width * 0.065));
    const borderY = Math.max(2, Math.round(raster.height * 0.065));
    const stride = Math.max(1, Math.floor(Math.sqrt((raster.width * raster.height) / 16_000)));
    const sums = [0, 0, 0];
    const squareSums = [0, 0, 0];
    let count = 0;
    for (let y = 0; y < raster.height; y += stride) {
        for (let x = 0; x < raster.width; x += stride) {
            const isBorder = x < borderX || x >= raster.width - borderX || y < borderY || y >= raster.height - borderY;
            if (!isBorder) continue;
            const index = (y * raster.width + x) * 3;
            for (let channel = 0; channel < 3; channel += 1) {
                const value = raster.data[index + channel];
                sums[channel] += value;
                squareSums[channel] += value * value;
            }
            count += 1;
        }
    }
    const means = sums.map((sum) => sum / Math.max(1, count));
    const deviations = squareSums.map((sum, channel) => Math.sqrt(Math.max(0, sum / Math.max(1, count) - means[channel] ** 2)));
    const averageDeviation = deviations.reduce((sum, value) => sum + value, 0) / 3;
    const channelSpread = Math.max(...means) - Math.min(...means);
    const backgroundLuminance = means[0] * 0.2126 + means[1] * 0.7152 + means[2] * 0.0722;
    const uniformity = 1 - clamp(averageDeviation / 42, 0, 1);
    const neutrality = 1 - clamp(channelSpread / 52, 0, 1);
    const brightness = smoothStudioBrightness(backgroundLuminance);
    const studioConfidence = clamp(uniformity * 0.58 + neutrality * 0.17 + brightness * 0.25, 0, 1);
    if (override === 'studio') return { classification: 'studio', studioConfidence: 1, backgroundLuminance };
    if (override === 'scene') return { classification: 'scene', studioConfidence: 0, backgroundLuminance };
    let classification: SkuRetouchSourceClassification = 'uncertain';
    if (studioConfidence >= 0.68) {
        classification = 'studio';
    } else if (studioConfidence < 0.5) {
        classification = 'scene';
    }
    return { classification, studioConfidence, backgroundLuminance };
}

function smoothStudioBrightness(luminance: number): number {
    if (luminance >= 205) return 1;
    if (luminance <= 110) return 0;
    const normalized = (luminance - 110) / 95;
    return normalized * normalized * (3 - 2 * normalized);
}

async function readWorkingRaster(filePath: string, maxLongEdge: number): Promise<SkuRetouchRaster> {
    const result = await sharp(filePath, {
        failOn: 'warning',
        limitInputPixels: MAX_SOURCE_INPUT_PIXELS
    })
        .rotate()
        .resize({ width: maxLongEdge, height: maxLongEdge, fit: 'inside', withoutEnlargement: true })
        .removeAlpha()
        .toColourspace('srgb')
        .raw()
        .toBuffer({ resolveWithObject: true });
    if (result.info.channels !== 3) {
        throw new Error(`SKU 素材无法转换为 RGB：${filePath}`);
    }
    return {
        data: result.data,
        width: result.info.width,
        height: result.info.height,
        channels: 3
    };
}

/** 以高置信主体定位有界包络，但在包络内保留原始 1~255 alpha，不按阈值 104 硬切柔边。 */
function retainSubjectAlphaEnvelope(
    mask: Buffer,
    shape: SkuRetouchShapeAnalysis,
    width: number,
    height: number
): Buffer {
    const output = Buffer.alloc(width * height);
    const horizontalPadding = clamp(
        Math.max(6, Math.ceil(shape.bounds.width * SUBJECT_ENVELOPE_PADDING_RATIO)),
        6,
        MAX_SUBJECT_ENVELOPE_PADDING
    );
    const verticalPadding = clamp(
        Math.max(6, Math.ceil(shape.bounds.height * SUBJECT_ENVELOPE_PADDING_RATIO)),
        6,
        MAX_SUBJECT_ENVELOPE_PADDING
    );
    const top = clamp(shape.bounds.top - verticalPadding, 0, height - 1);
    const bottom = clamp(shape.bounds.bottom + verticalPadding, top + 1, height);
    const left = clamp(shape.bounds.left - horizontalPadding, 0, width - 1);
    const right = clamp(shape.bounds.right + horizontalPadding, left + 1, width);
    for (let y = top; y < bottom; y += 1) {
        for (let x = left; x < right; x += 1) {
            output[y * width + x] = mask[y * width + x];
        }
    }
    return output;
}

async function prepareWorkingSource(input: {
    source: SkuRetouchSourceInput & { sourceId: string };
    sourceMode: SkuRetouchSourceMode;
    maxLongEdge: number;
    mattingService: MattingService;
}): Promise<PreparedWorkingSource | null> {
    const raster = await readWorkingRaster(input.source.filePath, input.maxLongEdge);
    const classification = classifyStudioRaster(raster, input.sourceMode);
    if (classification.classification === 'scene'
        || (classification.classification === 'uncertain' && classification.studioConfidence < 0.58)) {
        return null;
    }
    const pngBuffer = await sharp(raster.data, {
        raw: { width: raster.width, height: raster.height, channels: 3 }
    }).png().toBuffer();
    const matting = await input.mattingService.removeBackground(pngBuffer.toString('base64'), {
        quality: 'quality',
        returnMask: true,
        binaryMaskOutput: true,
        originalWidth: raster.width,
        originalHeight: raster.height,
        edgeRefine: 'quality'
    });
    if (!matting.success || !matting.maskBuffer || matting.maskWidth !== raster.width || matting.maskHeight !== raster.height) {
        throw new Error(`“${input.source.colorName || input.source.sourceId}”主体分割失败：${matting.error || '蒙版尺寸或内容无效'}`);
    }
    const rawShape = analyzeSkuRetouchShape(matting.maskBuffer, raster.width, raster.height);
    const subjectRatio = rawShape.foregroundPixels / Math.max(1, raster.width * raster.height);
    if (subjectRatio < 0.015 || subjectRatio > 0.72) {
        throw new Error(`“${input.source.colorName || input.source.sourceId}”主体占比异常（${(subjectRatio * 100).toFixed(1)}%），已停止形态处理。`);
    }
    const mask = retainSubjectAlphaEnvelope(matting.maskBuffer, rawShape, raster.width, raster.height);
    const shape = analyzeSkuRetouchShape(mask, raster.width, raster.height);
    return {
        source: input.source,
        classification: classification.classification,
        studioConfidence: classification.studioConfidence,
        backgroundLuminance: classification.backgroundLuminance,
        raster,
        mask,
        shape
    };
}

/**
 * 主体等比缩放到统一画布（用户工艺的代码化：占位框对齐，只统一尺度不改版型）。
 * 每源主体按高度归一到基准主体高（宽度等比跟随），落在全批统一尺寸的透明画布上
 * 水平/垂直居中——置入端把画布 contain 进 cardBounds 后跨色尺度天然一致。
 */
function countAlphaPixelsWithinBounds(
    alpha: Buffer,
    rasterWidth: number,
    bounds: { left: number; top: number; right: number; bottom: number }
): number {
    let count = 0;
    for (let y = bounds.top; y < bounds.bottom; y += 1) {
        for (let x = bounds.left; x < bounds.right; x += 1) {
            if (alpha[y * rasterWidth + x] > 0) count += 1;
        }
    }
    return count;
}

function buildSubjectCropPlan(item: PreparedWorkingSource, referenceSubjectHeight: number): SubjectCropPlan {
    const bounds = item.shape.bounds;
    const scaleFactor = referenceSubjectHeight / Math.max(1, bounds.height);
    if (!Number.isFinite(scaleFactor)
        || scaleFactor < MIN_UNIFORM_SCALE_FACTOR
        || scaleFactor > MAX_UNIFORM_SCALE_FACTOR) {
        throw new Error(
            `“${item.source.colorName || item.source.sourceId}”需要 ${scaleFactor.toFixed(2)}× 主体缩放，`
            + `超出安全范围 ${MIN_UNIFORM_SCALE_FACTOR}×~${MAX_UNIFORM_SCALE_FACTOR}×；请换用尺度更接近的摄影图或基准图。`
        );
    }
    const lowAlpha = findAlphaBounds(item.mask, item.raster.width, item.raster.height);
    if (!lowAlpha) {
        throw new Error(`“${item.source.colorName || item.source.sourceId}”清理后的主体蒙版没有可保留像素。`);
    }
    const outputGuardInSourcePixels = Math.ceil(MIN_OUTPUT_ALPHA_SAFE_INSET / scaleFactor);
    const baseGuard = clamp(
        Math.max(
            4,
            Math.ceil(Math.max(bounds.width, bounds.height) * SUBJECT_GUARD_PADDING_RATIO),
            outputGuardInSourcePixels
        ),
        4,
        MAX_SUBJECT_GUARD_PADDING
    );
    const maxSafetyPadding = MAX_SUBJECT_ENVELOPE_PADDING + MAX_SUBJECT_GUARD_PADDING;
    const safetyX = clamp(Math.max(
        baseGuard,
        bounds.left - lowAlpha.bounds.left + baseGuard,
        lowAlpha.bounds.right - bounds.right + baseGuard
    ), baseGuard, maxSafetyPadding);
    const safetyY = clamp(Math.max(
        baseGuard,
        bounds.top - lowAlpha.bounds.top + baseGuard,
        lowAlpha.bounds.bottom - bounds.bottom + baseGuard
    ), baseGuard, maxSafetyPadding);
    const desiredLeft = bounds.left - safetyX;
    const desiredTop = bounds.top - safetyY;
    const desiredRight = bounds.right + safetyX;
    const desiredBottom = bounds.bottom + safetyY;
    const left = clamp(desiredLeft, 0, item.raster.width - 1);
    const top = clamp(desiredTop, 0, item.raster.height - 1);
    const right = clamp(desiredRight, left + 1, item.raster.width);
    const bottom = clamp(desiredBottom, top + 1, item.raster.height);
    const retainedAlphaPixelCount = countAlphaPixelsWithinBounds(
        item.mask,
        item.raster.width,
        { left, top, right, bottom }
    );
    if (retainedAlphaPixelCount !== lowAlpha.pixelCount) {
        throw new Error(
            `“${item.source.colorName || item.source.sourceId}”柔边安全区未覆盖全部主体 alpha 像素，已停止裁切。`
        );
    }
    const paddedWidth = desiredRight - desiredLeft;
    const paddedHeight = desiredBottom - desiredTop;
    const targetHeight = Math.max(1, Math.round(paddedHeight * scaleFactor));
    const predictedWidth = Math.max(1, Math.round(paddedWidth * targetHeight / paddedHeight));
    if (targetHeight > MAX_UNIFORM_CANVAS_EDGE
        || predictedWidth > MAX_UNIFORM_CANVAS_EDGE
        || targetHeight * predictedWidth > MAX_UNIFORM_CANVAS_PIXELS) {
        throw new Error(
            `“${item.source.colorName || item.source.sourceId}”缩放后的含柔边主体尺寸超出安全预算：`
            + `${predictedWidth}×${targetHeight}。`
        );
    }
    return {
        left,
        top,
        width: right - left,
        height: bottom - top,
        extendTop: top - desiredTop,
        extendRight: desiredRight - right,
        extendBottom: desiredBottom - bottom,
        extendLeft: left - desiredLeft,
        paddedWidth,
        paddedHeight,
        targetHeight,
        predictedWidth,
        sourceAlphaPixelCount: lowAlpha.pixelCount,
        retainedAlphaPixelCount
    };
}

export function assertSkuRetouchOutputBudget(input: {
    canvasWidth: number;
    canvasHeight: number;
    sourceCount: number;
}): void {
    const { canvasWidth, canvasHeight, sourceCount } = input;
    const canvasPixels = canvasWidth * canvasHeight;
    const batchPixels = canvasPixels * sourceCount * 2;
    if (!Number.isSafeInteger(canvasWidth) || !Number.isSafeInteger(canvasHeight)
        || !Number.isSafeInteger(sourceCount) || sourceCount < 1 || sourceCount > MAX_SOURCE_COUNT
        || canvasWidth < 1 || canvasHeight < 1
        || canvasWidth > MAX_UNIFORM_CANVAS_EDGE || canvasHeight > MAX_UNIFORM_CANVAS_EDGE
        || canvasPixels > MAX_UNIFORM_CANVAS_PIXELS
        || batchPixels > MAX_UNIFORM_BATCH_PIXELS) {
        throw new Error(
            `SKU 统一尺度产物预算越界：画布 ${canvasWidth}×${canvasHeight}（${canvasPixels} 像素），`
            + `批次 ${sourceCount} 张的透明主体与预览共 ${batchPixels} 产物像素；`
            + '请缩小工作长边、拆分批次或换用尺度更接近的素材。'
        );
    }
}

function buildPaddedRgbaCrop(item: PreparedWorkingSource, cropPlan: SubjectCropPlan): Buffer {
    const output = Buffer.alloc(cropPlan.paddedWidth * cropPlan.paddedHeight * 4);
    for (let y = 0; y < cropPlan.height; y += 1) {
        const sourceY = cropPlan.top + y;
        const outputY = cropPlan.extendTop + y;
        for (let x = 0; x < cropPlan.width; x += 1) {
            const sourceX = cropPlan.left + x;
            const outputX = cropPlan.extendLeft + x;
            const sourceIndex = (sourceY * item.raster.width + sourceX) * 3;
            const outputIndex = (outputY * cropPlan.paddedWidth + outputX) * 4;
            output[outputIndex] = item.raster.data[sourceIndex];
            output[outputIndex + 1] = item.raster.data[sourceIndex + 1];
            output[outputIndex + 2] = item.raster.data[sourceIndex + 2];
            output[outputIndex + 3] = item.mask[sourceY * item.raster.width + sourceX];
        }
    }
    return output;
}

async function buildUniformScaleAsset(input: {
    item: PreparedWorkingSource;
    cropPlan: SubjectCropPlan;
    referenceSubjectHeight: number;
    canvasWidth: number;
    canvasHeight: number;
}): Promise<UniformScaleAsset> {
    const { item, cropPlan, referenceSubjectHeight, canvasWidth, canvasHeight } = input;
    assertSkuRetouchOutputBudget({ canvasWidth, canvasHeight, sourceCount: 1 });
    const bounds = item.shape.bounds;
    const paddedRgba = buildPaddedRgbaCrop(item, cropPlan);
    const scaledResult = await sharp(paddedRgba, {
        raw: { width: cropPlan.paddedWidth, height: cropPlan.paddedHeight, channels: 4 }
    })
        .resize({ height: cropPlan.targetHeight, kernel: sharp.kernel.lanczos3 })
        .png({ compressionLevel: 7 })
        .toBuffer({ resolveWithObject: true });
    const scaledCropWidth = scaledResult.info.width;
    const scaledCropHeight = scaledResult.info.height;
    const scaleX = scaledCropWidth / cropPlan.paddedWidth;
    const scaleY = scaledCropHeight / cropPlan.paddedHeight;
    const predictedSubjectWidth = Math.max(1, Math.round(bounds.width * scaleX));
    const predictedSubjectHeight = Math.max(1, Math.round(bounds.height * scaleY));
    if (Math.abs(predictedSubjectHeight - referenceSubjectHeight) > 1) {
        throw new Error(
            `“${item.source.colorName || item.source.sourceId}”主体缩放计划不满足等高目标：`
            + `${predictedSubjectHeight}px，目标 ${referenceSubjectHeight}px。`
        );
    }
    if (scaledCropWidth > canvasWidth || scaledCropHeight > canvasHeight) {
        throw new Error(`“${item.source.colorName || item.source.sourceId}”等比缩放后超出统一画布（${scaledCropWidth}×${scaledCropHeight} > ${canvasWidth}×${canvasHeight}）。`);
    }
    const left = Math.floor((canvasWidth - scaledCropWidth) / 2);
    const top = Math.floor((canvasHeight - scaledCropHeight) / 2);
    const productPng = await sharp(scaledResult.data)
        .extend({
            top,
            bottom: canvasHeight - scaledCropHeight - top,
            left,
            right: canvasWidth - scaledCropWidth - left,
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .png({ compressionLevel: 7 })
        .toBuffer();
    const previewJpeg = await sharp({
        create: {
            width: canvasWidth,
            height: canvasHeight,
            channels: 3,
            background: { r: 248, g: 248, b: 246 }
        }
    })
        .composite([{ input: productPng }])
        .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
        .toBuffer();
    const outputPixels = await sharp(productPng, {
        failOn: 'warning',
        limitInputPixels: MAX_UNIFORM_CANVAS_PIXELS
    }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const outputAlpha = measureOutputAlphaSafety(
        outputPixels.data,
        outputPixels.info.width,
        outputPixels.info.height,
        outputPixels.info.channels
    );
    const outputSubjectBounds = measureOutputSubjectBounds(
        outputPixels.data,
        outputPixels.info.width,
        outputPixels.info.height,
        outputPixels.info.channels
    );
    const subjectWidth = outputSubjectBounds.width;
    const subjectHeight = outputSubjectBounds.height;
    if (Math.abs(subjectHeight - referenceSubjectHeight) > 1
        || Math.abs(subjectWidth - predictedSubjectWidth) > 1) {
        throw new Error(
            `“${item.source.colorName || item.source.sourceId}”主体缩放像素读回不一致：`
            + `实际 ${subjectWidth}×${subjectHeight}px，计划 ${predictedSubjectWidth}×${predictedSubjectHeight}px。`
        );
    }
    const alphaSafety: SkuRetouchAlphaSafetyMetrics = {
        sourceAlphaPixelCount: cropPlan.sourceAlphaPixelCount,
        retainedAlphaPixelCount: cropPlan.retainedAlphaPixelCount,
        ...outputAlpha,
        sourcePixelsPreserved: cropPlan.sourceAlphaPixelCount === cropPlan.retainedAlphaPixelCount
    };
    if (!alphaSafety.sourcePixelsPreserved || !alphaSafety.outputEdgesClear) {
        throw new Error(`“${item.source.colorName || item.source.sourceId}”透明主体未通过像素完整性或四边安全检查。`);
    }
    return {
        productPng,
        previewJpeg,
        canvasWidth,
        canvasHeight,
        subjectWidth,
        subjectHeight,
        alphaSafety
    };
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
    const tempPath = `${filePath}.tmp`;
    await fs.promises.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await fs.promises.rename(tempPath, filePath);
}

function buildSkippedSource(
    source: SkuRetouchSourceInput & { sourceId: string },
    classification: SkuRetouchSourceClassification,
    studioConfidence: number
): SkuRetouchPreparedSource {
    return {
        sourceId: source.sourceId,
        colorName: source.colorName,
        sourcePath: source.filePath,
        classification,
        studioConfidence,
        status: 'skipped_scene',
        warnings: ['该素材被识别为场景图或纯底置信度不足，未套用纯底袜子精修链。']
    };
}

export class SkuRetouchService {
    constructor(private readonly mattingService: MattingService) {}

    async prepareAssets(input: PrepareSkuRetouchAssetsInput): Promise<SkuRetouchReport> {
        const sources = normalizeSources(input.sources);
        await assertSourceFiles(sources);
        const sourceMode = resolveSourceMode(input.sourceMode);
        const requestedMaxLongEdge = Number(input.maxLongEdge ?? DEFAULT_MAX_LONG_EDGE);
        if (!Number.isFinite(requestedMaxLongEdge)) {
            throw new Error('SKU 素材精修 maxLongEdge 必须是有限数字。');
        }
        const maxLongEdge = clamp(Math.round(requestedMaxLongEdge), MIN_LONG_EDGE, MAX_LONG_EDGE);
        const cacheIdentity = await buildBatchIdentity({
            sources,
            sourceMode,
            maxLongEdge,
            referenceSourcePath: clean(input.referenceSourcePath) || undefined
        });
        const outputDir = path.join(resolveOutputRoot(input, sources[0].filePath), cacheIdentity.batchId);
        const reportPath = path.join(outputDir, 'report.json');
        if (input.force !== true) {
            const cached = await readCachedReport(reportPath, cacheIdentity, outputDir);
            if (cached) return cached;
        }
        await fs.promises.mkdir(outputDir, { recursive: true });

        const working: PreparedWorkingSource[] = [];
        const skipped: SkuRetouchPreparedSource[] = [];
        for (const source of sources) {
            const prepared = await prepareWorkingSource({
                source,
                sourceMode,
                maxLongEdge,
                mattingService: this.mattingService
            });
            if (prepared) {
                working.push(prepared);
            } else {
                const raster = await readWorkingRaster(source.filePath, Math.min(maxLongEdge, 1200));
                const classification = classifyStudioRaster(raster, sourceMode);
                skipped.push(buildSkippedSource(
                    source,
                    classification.classification,
                    classification.studioConfidence
                ));
            }
        }

        if (working.length === 0) {
            const report: SkuRetouchReport = {
                version: SKU_RETOUCH_REPORT_VERSION,
                assetVersion: SKU_RETOUCH_ASSETS_VERSION,
                success: true,
                workflowStatus: 'not_applicable',
                cacheHit: false,
                outputDir,
                reportPath,
                cacheIdentity,
                sourceMode,
                maxLongEdge,
                sources: skipped,
                checks: {
                    sourceCoverage: 'not_applicable',
                    commonCanvas: 'not_applicable',
                    subjectHeightUniform: 'not_applicable',
                    aspectRatioPreserved: 'not_applicable',
                    alphaPixelsPreserved: 'not_applicable',
                    alphaEdgesSafe: 'not_applicable',
                    transparentAssetsReady: 'not_applicable'
                },
                warnings: ['本批素材没有达到纯底透明主体统一尺度处理的适用条件；应由 SKU Skill 保留原图并转入场景图设计方向。']
            };
            await assertSourceIdentityUnchanged(cacheIdentity);
            await writeJsonAtomic(reportPath, report);
            return report;
        }

        const requestedReference = clean(input.referenceSourcePath);
        let referenceIndex = requestedReference
            ? working.findIndex((item) => normalizePathForComparison(item.source.filePath) === normalizePathForComparison(requestedReference))
            : -1;
        if (requestedReference && referenceIndex < 0) {
            throw new Error('指定的形态基准不在本批可处理的纯底素材中。');
        }
        if (referenceIndex < 0) referenceIndex = chooseSkuRetouchReferenceIndex(working.map((item) => item.shape));
        const reference = working[referenceIndex];

        // 等比缩放统一（用户工艺）：主体按高度归一到基准主体高，宽度等比跟随，
        // 全批共用一张统一尺寸的透明画布并居中——只统一尺度，不改袜子版型。
        const referenceSubjectHeight = reference.shape.bounds.height;
        const cropPlans = working.map((item) => buildSubjectCropPlan(item, referenceSubjectHeight));
        const scaledSubjectWidths = working.map((item) => Math.max(2, Math.round(
            item.shape.bounds.width * referenceSubjectHeight / Math.max(1, item.shape.bounds.height)
        )));
        const maxSubjectWidth = Math.max(...scaledSubjectWidths);
        const horizontalPad = Math.max(12, Math.round(maxSubjectWidth * 0.1));
        const verticalPad = Math.max(12, Math.round(referenceSubjectHeight * 0.045));
        const canvasWidth = Math.max(...cropPlans.map((plan) => plan.predictedWidth)) + horizontalPad * 2;
        const canvasHeight = Math.max(...cropPlans.map((plan) => plan.targetHeight)) + verticalPad * 2;
        assertSkuRetouchOutputBudget({ canvasWidth, canvasHeight, sourceCount: working.length });

        const preparedSources: SkuRetouchPreparedSource[] = [];
        for (let index = 0; index < working.length; index += 1) {
            const item = working[index];
            const asset = await buildUniformScaleAsset({
                item,
                cropPlan: cropPlans[index],
                referenceSubjectHeight,
                canvasWidth,
                canvasHeight
            });
            const stem = `${String(index + 1).padStart(2, '0')}-${safeFileStem(item.source.colorName || item.source.sourceId, item.source.sourceId)}`;
            const productPath = path.join(outputDir, `${stem}-product.png`);
            const previewPath = path.join(outputDir, `${stem}-preview.jpg`);
            await Promise.all([
                fs.promises.writeFile(productPath, asset.productPng),
                fs.promises.writeFile(previewPath, asset.previewJpeg)
            ]);

            const preparedSource: SkuRetouchPreparedSource = {
                sourceId: item.source.sourceId,
                colorName: item.source.colorName,
                sourcePath: item.source.filePath,
                classification: item.classification,
                studioConfidence: item.studioConfidence,
                status: 'prepared',
                width: asset.canvasWidth,
                height: asset.canvasHeight,
                productPath,
                previewPath,
                productSha256: sha256Buffer(asset.productPng),
                productChecksum: fnv1a32Buffer(asset.productPng),
                productByteLength: asset.productPng.byteLength,
                previewSha256: sha256Buffer(asset.previewJpeg),
                previewByteLength: asset.previewJpeg.byteLength,
                uniformScale: buildSkuRetouchUniformScaleMetrics({
                    originalSubjectWidth: item.shape.bounds.width,
                    originalSubjectHeight: item.shape.bounds.height,
                    outputSubjectWidth: asset.subjectWidth,
                    outputSubjectHeight: asset.subjectHeight,
                    targetSubjectHeight: referenceSubjectHeight
                }),
                alphaSafety: asset.alphaSafety,
                warnings: [
                    ...(item.classification === 'uncertain'
                        ? ['纯底识别置信度处于边界区，最终色卡需要视觉复核。']
                        : [])
                ]
            };
            if (!(await cachedPreparedAssetIsValid(preparedSource, outputDir))) {
                throw new Error(`“${item.source.colorName || item.source.sourceId}”写盘后的统一尺度资产未通过摘要、解码或 alpha 读回。`);
            }
            preparedSources.push(preparedSource);
        }

        const allSources = sources.map((source) => preparedSources.find((item) => item.sourceId === source.sourceId)
            || skipped.find((item) => item.sourceId === source.sourceId)!);
        const commonCanvas = preparedSources.every((source) => (
            source.width === preparedSources[0].width && source.height === preparedSources[0].height
        ));
        const subjectHeightUniform = preparedSources.every((source) => (
            source.uniformScale?.subjectHeightUniform === true
        ));
        const aspectRatioPreserved = preparedSources.every((source) => (
            source.uniformScale?.aspectRatioPreserved === true
        ));
        const alphaPixelsPreserved = preparedSources.every((source) => (
            source.alphaSafety?.sourcePixelsPreserved === true
        ));
        const alphaEdgesSafe = preparedSources.every((source) => (
            source.alphaSafety?.outputEdgesClear === true
        ));
        const report: SkuRetouchReport = {
            version: SKU_RETOUCH_REPORT_VERSION,
            assetVersion: SKU_RETOUCH_ASSETS_VERSION,
            success: true,
            workflowStatus: 'prepared',
            cacheHit: false,
            outputDir,
            reportPath,
            cacheIdentity,
            referenceSourceId: reference.source.sourceId,
            referenceSourcePath: reference.source.filePath,
            sourceMode,
            maxLongEdge,
            sources: allSources,
            checks: {
                sourceCoverage: preparedSources.length + skipped.length === sources.length ? 'passed' : 'failed',
                commonCanvas: commonCanvas ? 'passed' : 'failed',
                subjectHeightUniform: subjectHeightUniform ? 'passed' : 'failed',
                aspectRatioPreserved: aspectRatioPreserved ? 'passed' : 'failed',
                alphaPixelsPreserved: alphaPixelsPreserved ? 'passed' : 'failed',
                alphaEdgesSafe: alphaEdgesSafe ? 'passed' : 'failed',
                transparentAssetsReady: preparedSources.every((source) => Boolean(source.productPath)) ? 'passed' : 'failed'
            },
            warnings: [
                ...skipped.flatMap((source) => source.warnings.map((warning) => `${source.colorName || source.sourceId}：${warning}`)),
                '本批产物为等比缩放统一尺度的透明底主体；未做形态变形、阴影与光影修正（属后续精修阶段）。',
                '离线资产通过不等于 Photoshop 色卡完成；仍需可编辑图层写入、同文档读回与最终视觉验收。'
            ]
        };
        await assertSourceIdentityUnchanged(cacheIdentity);
        await writeJsonAtomic(reportPath, report);
        return report;
    }
}
