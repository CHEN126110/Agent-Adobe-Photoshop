import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';

import {
    SKU_RETOUCH_ASSETS_VERSION,
    SKU_RETOUCH_REPORT_VERSION,
    type PrepareSkuRetouchAssetsInput,
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
    measureSkuRetouchShapeDistance,
    warpSkuRetouchSource,
    type SkuRetouchRaster,
    type SkuRetouchShapeAnalysis,
    type SkuRetouchWarpResult
} from './sku-retouch/geometry';
import {
    applySoftLightChannel,
    buildSkuRetouchNeutralGrayMaps,
    type SkuRetouchLowResolutionProduct
} from './sku-retouch/lighting';

interface PreparedWorkingSource {
    source: Required<Pick<SkuRetouchSourceInput, 'filePath'>> & SkuRetouchSourceInput & { sourceId: string };
    classification: SkuRetouchSourceClassification;
    studioConfidence: number;
    backgroundLuminance: number;
    raster: SkuRetouchRaster;
    mask: Buffer;
    shape: SkuRetouchShapeAnalysis;
    warp?: SkuRetouchWarpResult;
}

const DEFAULT_SHAPE_STRENGTH = 0.72;
const DEFAULT_LIGHTING_STRENGTH = 0.68;
const DEFAULT_MAX_LONG_EDGE = 2048;
const MIN_LONG_EDGE = 1024;
const MAX_LONG_EDGE = 3072;
const MAX_SOURCE_COUNT = 12;

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
    const seen = new Set<string>();
    return sources.map((source, index) => {
        const filePath = clean(source?.filePath);
        if (!filePath) throw new Error(`第 ${index + 1} 张 SKU 素材缺少 filePath。`);
        const normalizedPath = normalizePathForComparison(filePath);
        if (seen.has(normalizedPath)) throw new Error(`SKU 素材重复：${filePath}`);
        seen.add(normalizedPath);
        return {
            ...source,
            filePath: path.resolve(filePath),
            sourceId: clean(source.sourceId) || `S${String(index + 1).padStart(2, '0')}`
        };
    });
}

async function assertSourceFiles(sources: Array<SkuRetouchSourceInput & { sourceId: string }>): Promise<void> {
    for (const source of sources) {
        const stat = await fs.promises.stat(source.filePath);
        if (!stat.isFile()) throw new Error(`SKU 素材不是文件：${source.filePath}`);
    }
}

async function buildBatchId(input: {
    sources: Array<SkuRetouchSourceInput & { sourceId: string }>;
    shapeStrength: number;
    lightingStrength: number;
    maxLongEdge: number;
    sourceMode: SkuRetouchSourceMode;
    referenceSourcePath?: string;
}): Promise<string> {
    const fingerprint: Array<Record<string, unknown>> = [];
    for (const source of input.sources) {
        const stat = await fs.promises.stat(source.filePath);
        fingerprint.push({
            filePath: normalizePathForComparison(source.filePath),
            size: stat.size,
            mtimeMs: Math.round(stat.mtimeMs)
        });
    }
    return createHash('sha256').update(JSON.stringify({
        version: SKU_RETOUCH_ASSETS_VERSION,
        fingerprint,
        shapeStrength: input.shapeStrength,
        lightingStrength: input.lightingStrength,
        maxLongEdge: input.maxLongEdge,
        sourceMode: input.sourceMode,
        referenceSourcePath: input.referenceSourcePath
            ? normalizePathForComparison(input.referenceSourcePath)
            : undefined
    })).digest('hex').slice(0, 16);
}

function resolveOutputRoot(input: PrepareSkuRetouchAssetsInput, firstSourcePath: string): string {
    if (clean(input.outputDir)) return path.resolve(clean(input.outputDir));
    if (clean(input.projectPath)) return path.join(path.resolve(clean(input.projectPath)), '.designecho', 'sku-retouch');
    return path.join(path.dirname(firstSourcePath), '.designecho', 'sku-retouch');
}

async function readCachedReport(reportPath: string): Promise<SkuRetouchReport | null> {
    if (!fs.existsSync(reportPath)) return null;
    const raw = await fs.promises.readFile(reportPath, 'utf8');
    const parsed = JSON.parse(raw) as SkuRetouchReport;
    if (parsed.version !== SKU_RETOUCH_REPORT_VERSION || parsed.assetVersion !== SKU_RETOUCH_ASSETS_VERSION) {
        return null;
    }
    const assetPaths = parsed.sources.flatMap((source) => [
        source.productPath,
        source.shadowPath,
        source.neutralGrayPath,
        source.previewPath
    ]).filter((value): value is string => Boolean(value));
    if (assetPaths.some((assetPath) => !fs.existsSync(assetPath))) return null;
    return { ...parsed, cacheHit: true };
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
    const result = await sharp(filePath, { failOn: 'warning' })
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

function cleanMaskByRows(mask: Buffer, shape: SkuRetouchShapeAnalysis, width: number, height: number): Buffer {
    const output = Buffer.alloc(width * height);
    for (let y = shape.bounds.top; y < shape.bounds.bottom; y += 1) {
        const row = shape.rows[y];
        if (!row?.valid) continue;
        const left = clamp(Math.floor(row.left - 3), 0, width - 1);
        const right = clamp(Math.ceil(row.right + 3), left, width - 1);
        for (let x = left; x <= right; x += 1) {
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
    const mask = cleanMaskByRows(matting.maskBuffer, rawShape, raster.width, raster.height);
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

async function toLowResolutionProduct(warp: SkuRetouchWarpResult): Promise<SkuRetouchLowResolutionProduct> {
    const maxSize = 448;
    const scale = Math.min(1, maxSize / Math.max(warp.output.width, warp.output.height));
    const width = Math.max(32, Math.round(warp.output.width * scale));
    const height = Math.max(32, Math.round(warp.output.height * scale));
    const resized = await sharp(warp.productRgba, {
        raw: { width: warp.output.width, height: warp.output.height, channels: 4 }
    }).resize(width, height, { fit: 'fill', kernel: sharp.kernel.lanczos3 }).raw().toBuffer();
    const rgb = Buffer.alloc(width * height * 3);
    const alpha = Buffer.alloc(width * height);
    for (let index = 0; index < width * height; index += 1) {
        rgb[index * 3] = resized[index * 4];
        rgb[index * 3 + 1] = resized[index * 4 + 1];
        rgb[index * 3 + 2] = resized[index * 4 + 2];
        alpha[index] = resized[index * 4 + 3];
    }
    return { rgb, alpha, width, height };
}

async function buildShadowRgba(warp: SkuRetouchWarpResult): Promise<Buffer> {
    const radius = clamp(Math.round(Math.min(warp.output.width, warp.output.height) * 0.026), 4, 36);
    const offsetX = Math.max(5, Math.round(warp.output.subjectWidth * 0.038));
    const offsetY = Math.max(3, Math.round(warp.output.subjectHeight * 0.012));
    const shifted = Buffer.alloc(warp.output.width * warp.output.height);
    for (let y = 0; y < warp.output.height - offsetY; y += 1) {
        for (let x = 0; x < warp.output.width - offsetX; x += 1) {
            shifted[(y + offsetY) * warp.output.width + x + offsetX] = warp.shadowAlpha[y * warp.output.width + x];
        }
    }
    const blurredResult = await sharp(shifted, {
        raw: { width: warp.output.width, height: warp.output.height, channels: 1 }
    }).blur(radius).raw().toBuffer({ resolveWithObject: true });
    const rgba = Buffer.alloc(warp.output.width * warp.output.height * 4);
    const pixelCount = warp.output.width * warp.output.height;
    for (let index = 0; index < pixelCount; index += 1) {
        const blurredAlpha = blurredResult.data[index * blurredResult.info.channels];
        const alpha = blurredAlpha < 2 ? 0 : Math.min(72, Math.round(blurredAlpha * 0.27));
        rgba[index * 4 + 3] = alpha;
    }
    return rgba;
}

function compositePreview(input: {
    productRgba: Buffer;
    shadowRgba: Buffer;
    neutralGray: Buffer;
    width: number;
    height: number;
}): Buffer {
    const output = Buffer.alloc(input.width * input.height * 3);
    const background = [248, 248, 246];
    for (let index = 0; index < input.width * input.height; index += 1) {
        const shadowAlpha = input.shadowRgba[index * 4 + 3] / 255;
        const productAlpha = input.productRgba[index * 4 + 3] / 255;
        const gray = input.neutralGray[index];
        for (let channel = 0; channel < 3; channel += 1) {
            const behindProduct = Math.round(background[channel] * (1 - shadowAlpha));
            const corrected = applySoftLightChannel(input.productRgba[index * 4 + channel], gray);
            output[index * 3 + channel] = Math.round(behindProduct * (1 - productAlpha) + corrected * productAlpha);
        }
    }
    return output;
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
        const shapeStrength = clamp(Number(input.shapeStrength ?? DEFAULT_SHAPE_STRENGTH), 0, 1);
        const lightingStrength = clamp(Number(input.lightingStrength ?? DEFAULT_LIGHTING_STRENGTH), 0, 1);
        const maxLongEdge = clamp(Math.round(Number(input.maxLongEdge ?? DEFAULT_MAX_LONG_EDGE)), MIN_LONG_EDGE, MAX_LONG_EDGE);
        const batchId = await buildBatchId({
            sources,
            sourceMode,
            shapeStrength,
            lightingStrength,
            maxLongEdge,
            referenceSourcePath: clean(input.referenceSourcePath) || undefined
        });
        const outputDir = path.join(resolveOutputRoot(input, sources[0].filePath), batchId);
        const reportPath = path.join(outputDir, 'report.json');
        if (input.force !== true) {
            const cached = await readCachedReport(reportPath);
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
                sourceMode,
                shapeStrength,
                lightingStrength,
                maxLongEdge,
                sources: skipped,
                checks: {
                    sourceCoverage: 'not_applicable',
                    commonGeometry: 'not_applicable',
                    shapeResidualReduced: 'not_applicable',
                    lightingResidualReduced: 'not_applicable',
                    editableAssetLayersReady: 'not_applicable'
                },
                warnings: ['本批素材没有达到纯底精修链的适用条件；应由 SKU Skill 路由到场景图设计方向。']
            };
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

        for (const item of working) {
            item.warp = warpSkuRetouchSource({
                raster: item.raster,
                mask: item.mask,
                shape: item.shape,
                reference: reference.shape,
                strength: shapeStrength
            });
        }
        const lowProducts = await Promise.all(working.map((item) => toLowResolutionProduct(item.warp!)));
        const neutralGrayResults = buildSkuRetouchNeutralGrayMaps({
            products: lowProducts,
            strength: lightingStrength
        });

        const preparedSources: SkuRetouchPreparedSource[] = [];
        for (let index = 0; index < working.length; index += 1) {
            const item = working[index];
            const warp = item.warp!;
            const neutral = neutralGrayResults[index];
            const stem = `${String(index + 1).padStart(2, '0')}-${safeFileStem(item.source.colorName || item.source.sourceId, item.source.sourceId)}`;
            const productPath = path.join(outputDir, `${stem}-product.png`);
            const shadowPath = path.join(outputDir, `${stem}-shadow.png`);
            const neutralGrayPath = path.join(outputDir, `${stem}-neutral-gray.png`);
            const previewPath = path.join(outputDir, `${stem}-preview.jpg`);
            const productPng = await sharp(warp.productRgba, {
                raw: { width: warp.output.width, height: warp.output.height, channels: 4 }
            }).png({ compressionLevel: 7 }).toBuffer();
            const shadowRgba = await buildShadowRgba(warp);
            const shadowPng = await sharp(shadowRgba, {
                raw: { width: warp.output.width, height: warp.output.height, channels: 4 }
            }).png({ compressionLevel: 7 }).toBuffer();
            const neutralResizeResult = await sharp(neutral.neutralGray, {
                raw: { width: lowProducts[index].width, height: lowProducts[index].height, channels: 1 }
            }).resize(warp.output.width, warp.output.height, {
                fit: 'fill',
                kernel: sharp.kernel.cubic
            }).raw().toBuffer({ resolveWithObject: true });
            const fullNeutralGray = Buffer.alloc(warp.output.width * warp.output.height);
            for (let pixelIndex = 0; pixelIndex < fullNeutralGray.length; pixelIndex += 1) {
                fullNeutralGray[pixelIndex] = neutralResizeResult.data[
                    pixelIndex * neutralResizeResult.info.channels
                ];
            }
            const neutralPng = await sharp(fullNeutralGray, {
                raw: { width: warp.output.width, height: warp.output.height, channels: 1 }
            }).png({ compressionLevel: 7 }).toBuffer();
            const previewRgb = compositePreview({
                productRgba: warp.productRgba,
                shadowRgba,
                neutralGray: fullNeutralGray,
                width: warp.output.width,
                height: warp.output.height
            });
            const previewJpeg = await sharp(previewRgb, {
                raw: { width: warp.output.width, height: warp.output.height, channels: 3 }
            }).jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer();
            await Promise.all([
                fs.promises.writeFile(productPath, productPng),
                fs.promises.writeFile(shadowPath, shadowPng),
                fs.promises.writeFile(neutralGrayPath, neutralPng),
                fs.promises.writeFile(previewPath, previewJpeg)
            ]);

            const distanceBefore = measureSkuRetouchShapeDistance(item.shape, reference.shape);
            preparedSources.push({
                sourceId: item.source.sourceId,
                colorName: item.source.colorName,
                sourcePath: item.source.filePath,
                classification: item.classification,
                studioConfidence: item.studioConfidence,
                status: 'prepared',
                width: warp.output.width,
                height: warp.output.height,
                productPath,
                shadowPath,
                neutralGrayPath,
                previewPath,
                shape: {
                    distanceToReferenceBefore: distanceBefore,
                    distanceToReferenceAfter: distanceBefore * (1 - shapeStrength),
                    maxDisplacementPx: warp.maxDisplacementPx,
                    subjectWidthRatio: warp.output.subjectWidth / warp.output.width,
                    subjectHeightRatio: warp.output.subjectHeight / warp.output.height
                },
                lighting: {
                    residualBefore: neutral.residualBefore,
                    residualAfter: neutral.residualAfter,
                    correctionMin: neutral.correctionMin,
                    correctionMax: neutral.correctionMax
                },
                warnings: [
                    ...(item.classification === 'uncertain'
                        ? ['纯底识别置信度处于边界区，最终色卡需要视觉复核。']
                        : []),
                    ...(working.length === 1
                        ? ['单图无法建立跨颜色批次光照中位目标，中性灰修正采用保守自归一，必须人工复核。']
                        : [])
                ]
            });
        }

        const allSources = sources.map((source) => preparedSources.find((item) => item.sourceId === source.sourceId)
            || skipped.find((item) => item.sourceId === source.sourceId)!);
        const commonGeometry = preparedSources.every((source) => (
            source.width === preparedSources[0].width && source.height === preparedSources[0].height
        ));
        const shapeReduced = preparedSources.every((source) => (
            (source.shape?.distanceToReferenceAfter || 0) <= (source.shape?.distanceToReferenceBefore || 0) + 1e-6
        ));
        const lightingReduced = preparedSources.every((source) => (
            (source.lighting?.residualAfter || 0) <= (source.lighting?.residualBefore || 0) + 1e-6
        ));
        let lightingResidualCheck: SkuRetouchReport['checks']['lightingResidualReduced'] = 'failed';
        if (lightingReduced && working.length > 1) {
            lightingResidualCheck = 'passed';
        } else if (lightingReduced) {
            lightingResidualCheck = 'needs_review';
        }
        const report: SkuRetouchReport = {
            version: SKU_RETOUCH_REPORT_VERSION,
            assetVersion: SKU_RETOUCH_ASSETS_VERSION,
            success: true,
            workflowStatus: 'prepared',
            cacheHit: false,
            outputDir,
            reportPath,
            referenceSourceId: reference.source.sourceId,
            referenceSourcePath: reference.source.filePath,
            sourceMode,
            shapeStrength,
            lightingStrength,
            maxLongEdge,
            sources: allSources,
            checks: {
                sourceCoverage: preparedSources.length + skipped.length === sources.length ? 'passed' : 'failed',
                commonGeometry: commonGeometry ? 'passed' : 'failed',
                shapeResidualReduced: shapeReduced ? 'passed' : 'failed',
                lightingResidualReduced: lightingResidualCheck,
                editableAssetLayersReady: preparedSources.every((source) => (
                    source.productPath && source.shadowPath && source.neutralGrayPath
                )) ? 'passed' : 'failed'
            },
            warnings: [
                ...skipped.flatMap((source) => source.warnings.map((warning) => `${source.colorName || source.sourceId}：${warning}`)),
                '离线资产通过不等于 Photoshop 色卡完成；仍需可编辑图层写入、同文档读回与最终视觉验收。'
            ]
        };
        await writeJsonAtomic(reportPath, report);
        return report;
    }
}
