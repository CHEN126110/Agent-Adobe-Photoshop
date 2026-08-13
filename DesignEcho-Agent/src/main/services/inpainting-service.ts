import sharp from 'sharp';
import {
    assertInpaintingMaskHasEditablePixels,
    clampSoftenedMaskToSelection
} from './inpainting-mask-protection';
import { volcengineJimengInpaintingService } from './volcengine-jimeng-inpainting-service';
import {
    OPENROUTER_IMAGE_ASPECT_RATIOS,
    openRouterGeminiImageService
} from './openrouter-gemini-image-service';

export type InpaintingModel =
    | 'jimeng-inpaint'
    | 'google/gemini-3-pro-image'
    | 'openai/gpt-5-image'
    | 'openai/gpt-5-image-mini'
    | 'openai/gpt-5.4-image-2';

export interface InpaintingRequest {
    image: string;
    mask: string;
    prompt: string;
    model?: InpaintingModel;
    skipPreview?: boolean;
    imageFormat?: 'raw' | 'png' | 'jpeg';
    imageChannels?: number;
    maskFormat?: 'raw' | 'png';
    maskChannels?: number;
    imageWidth: number;
    imageHeight: number;
    selectionBounds?: {
        left?: number;
        top?: number;
        right?: number;
        bottom?: number;
    } | null;
    documentMeta?: {
        width?: number;
        height?: number;
        scale?: number;
        selectionBoundsOriginal?: {
            left?: number;
            top?: number;
            right?: number;
            bottom?: number;
        } | null;
    } | null;
    /** 用户提供的效果参考图（data URL 或裸 base64）。目前只有 OpenRouter 通道能消费 */
    referenceImages?: string[];
}

export interface InpaintingResult {
    success: boolean;
    images?: string[];
    rawImages?: string[];
    imageBuffer?: Buffer;
    /** 请求被降级处理的地方，如实回报给用户，不静默吞掉 */
    warnings?: string[];
    meta?: {
        provider: 'jimeng' | 'openrouter';
        model: InpaintingModel;
        outputWidth: number;
        outputHeight: number;
        originalWidth: number;
        originalHeight: number;
        targetBounds: {
            left: number;
            top: number;
        };
        compositingMode: 'transparent-selection-overlay';
        outsideSelectionTransparent: true;
    };
    error?: string;
    errorStage?: string;
    errorCode?: string;
    errorDetail?: string;
    processingTime?: number;
    provider?: string;
    model?: string;
}

export interface InpaintingProgressEvent {
    progress: number;
    message: string;
    stage: string;
    provider: 'local' | 'jimeng' | 'openrouter';
    model: InpaintingModel;
}

export type InpaintingProgressCallback = (event: InpaintingProgressEvent) => void;

type RegionBounds = {
    left: number;
    top: number;
    width: number;
    height: number;
};

type SelectionBounds = {
    left: number;
    top: number;
    right: number;
    bottom: number;
};

type InpaintingPromptIntent = 'context-fill' | 'add' | 'replace' | 'remove' | 'modify';
type InpaintingProvider = 'jimeng' | 'openrouter';
type InpaintingImageFormat = 'raw' | 'png' | 'jpeg';

type OutputPlacement = {
    targetLeft: number;
    targetTop: number;
    targetWidth: number;
    targetHeight: number;
    cropLeft: number;
    cropTop: number;
    cropWidth: number;
    cropHeight: number;
};

const SUPPORTED_MODELS: InpaintingModel[] = [
    'jimeng-inpaint',
    'google/gemini-3-pro-image',
    'openai/gpt-5-image',
    'openai/gpt-5-image-mini',
    'openai/gpt-5.4-image-2'
];

const OPENROUTER_MODELS: InpaintingModel[] = [
    'google/gemini-3-pro-image',
    'openai/gpt-5-image',
    'openai/gpt-5-image-mini',
    'openai/gpt-5.4-image-2'
];

/** 不指定模型时的默认重绘通道 */
const DEFAULT_INPAINTING_MODEL: InpaintingModel = 'google/gemini-3-pro-image';

/**
 * 上下文窗口相对选区的放大倍数。
 *
 * 这是重绘能不能"融进场景"的决定性参数：模型只能看到我们裁给它的那块画面。
 * 窗口太紧，模型不知道现场的光源方向、色温、景深和周围道具，只能按训练先验
 * 画一个通用主体（典型症状就是白底商品图贴进实拍场景）。
 * 新增内容需要的环境信息最多，纯修改最少。
 */
const CONTEXT_WINDOW_SCALE: Record<InpaintingPromptIntent, number> = {
    'context-fill': 2.6,
    add: 2.9,
    replace: 2.4,
    remove: 2.6,
    modify: 2.2
};

/** 上下文窗口的最小边长。小选区按倍数放大后仍然太小，需要一个绝对下限兜住 */
const MIN_CONTEXT_WINDOW_EDGE = 768;

/** 参考图长边上限。参考图只用来说明"要什么样的东西"，不需要原始分辨率 */
const REFERENCE_IMAGE_MAX_EDGE = 1280;

/**
 * "往选区里加东西"的说法集合。判定意图和抽取主体用的是同一份来源，
 * 分成两份写迟早会漂移——判定成 add、抽主体时却没匹配上，主体就会带着动词进提示词。
 *
 * "画/来/做" 后面跟的是量词（画一只、来一双），用零宽断言只吃动词不吃量词，
 * 否则抽出来的主体会变成"只袜子""双袜子"。
 */
const ADD_INTENT_PREFIX_SOURCE =
    '^(?:请|麻烦)?(?:帮我|给我)?(?:在)?(?:这里|这儿|画面里|场景里|选区里|选区中)?'
    + '(?:加入|添加|增加|加上|放入|放上|添上|添入|生成|画上|(?:画|来|做)(?=一))';
const ADD_INTENT_PATTERN = new RegExp(ADD_INTENT_PREFIX_SOURCE);
const ADD_SUBJECT_PATTERN = new RegExp(`${ADD_INTENT_PREFIX_SOURCE}(?:一些|一点|少量|些许)?`);

export class InpaintingService {
    async inpaint(request: InpaintingRequest, onProgress?: InpaintingProgressCallback): Promise<InpaintingResult> {
        const startedAt = Date.now();

        try {
            const model = this.normalizeModel(request.model);
            const provider = this.getModelProvider(model);
            const normalizedFormats = this.normalizeRequestFormats(request);
            this.emitProgress(onProgress, {
                progress: 4,
                message: 'Validating request',
                stage: 'validate',
                provider: 'local',
                model
            });

            if (!request.image?.trim() || !request.mask?.trim()) {
                throw new Error('Image and mask are required');
            }
            if (!request.imageWidth || !request.imageHeight) {
                throw new Error('Image dimensions are required');
            }

            const promptPlan = this.buildPromptPlan(request.prompt, provider);

            this.validateProviderCredentials(model);

            const fullImage = await this.decodeRgbImage(
                request.image,
                request.imageWidth,
                request.imageHeight,
                request.imageChannels || 3,
                normalizedFormats.imageFormat
            );
            const fullMask = await this.decodeMaskImage(
                request.mask,
                request.imageWidth,
                request.imageHeight,
                request.maskChannels || 1,
                normalizedFormats.maskFormat
            );
            const fullMaskRaw = await fullMask.clone().raw().toBuffer();
            assertInpaintingMaskHasEditablePixels(fullMaskRaw);

            // 区域只解析一次：这个函数在没有 selectionBounds 时要全图扫蒙版，
            // 算两遍既浪费也有让生成路径与回贴路径算出不同结果的风险。
            const region = provider === 'jimeng'
                ? { left: 0, top: 0, width: request.imageWidth, height: request.imageHeight }
                : await this.resolveRegion(request, fullMask, promptPlan.intent);

            const { references, warnings } = await this.resolveReferenceImages(request, provider);

            const outputRgba = provider === 'jimeng'
                ? await this.runJimengOfficialFlow(request, promptPlan, model, fullImage, fullMask, onProgress)
                : await this.runCroppedProviderFlow(
                    request,
                    promptPlan,
                    model,
                    provider,
                    region,
                    fullImage,
                    fullMask,
                    references,
                    onProgress
                );

            this.emitProgress(onProgress, {
                progress: 98,
                message: 'Encoding final PNG',
                stage: 'encode-result',
                provider,
                model
            });

            const outputPlacement = this.resolveOutputPlacement(request, region, promptPlan.intent);
            const outputPng = await sharp(outputRgba, {
                raw: { width: outputPlacement.targetWidth, height: outputPlacement.targetHeight, channels: 4 }
            }).png().toBuffer();

            return {
                success: true,
                images: [],
                rawImages: [],
                imageBuffer: outputPng,
                warnings,
                meta: {
                    provider,
                    model,
                    outputWidth: outputPlacement.targetWidth,
                    outputHeight: outputPlacement.targetHeight,
                    originalWidth: outputPlacement.targetWidth,
                    originalHeight: outputPlacement.targetHeight,
                    targetBounds: {
                        left: outputPlacement.targetLeft,
                        top: outputPlacement.targetTop
                    },
                    compositingMode: 'transparent-selection-overlay',
                    outsideSelectionTransparent: true
                },
                processingTime: Date.now() - startedAt,
                provider,
                model
            };
        } catch (error: any) {
            return {
                success: false,
                error: error?.message || String(error),
                errorStage: typeof error?.errorStage === 'string' ? error.errorStage : '',
                errorCode: typeof error?.errorCode === 'string' ? error.errorCode : '',
                errorDetail: typeof error?.errorDetail === 'string' ? error.errorDetail : '',
                processingTime: Date.now() - startedAt
            };
        }
    }

    private async runCroppedProviderFlow(
        request: InpaintingRequest,
        promptPlan: { originalPrompt: string; effectivePrompt: string; intent: InpaintingPromptIntent },
        model: InpaintingModel,
        provider: InpaintingProvider,
        region: RegionBounds,
        fullImage: sharp.Sharp,
        fullMask: sharp.Sharp,
        referenceImages: Buffer[],
        onProgress?: InpaintingProgressCallback
    ): Promise<Buffer> {
        this.emitProgress(onProgress, {
            progress: 10,
            message: 'Analyzing selection',
            stage: 'analyze-selection',
            provider: 'local',
            model
        });

        this.emitProgress(onProgress, {
            progress: 16,
            message: 'Cropping region of interest',
            stage: 'crop-region',
            provider: 'local',
            model
        });

        const cropImagePng = await fullImage.clone().extract(region).png().toBuffer();
        const cropMaskPng = await fullMask.clone().extract(region).png().toBuffer();
        const sourceMaskRaw = await fullMask.clone().extract(region).raw().toBuffer();

        this.emitProgress(onProgress, {
            progress: 22,
            message: 'Submitting image edit request',
            stage: 'submit-model',
            provider,
            model
        });

        const generatedCrop = await this.runProviderEdit(
            model,
            promptPlan.effectivePrompt,
            cropImagePng,
            cropMaskPng,
            referenceImages,
            onProgress
        );

        const generatedRgba = await sharp(generatedCrop)
            .resize(region.width, region.height, { fit: 'fill' })
            .ensureAlpha()
            .raw()
            .toBuffer();

        this.emitProgress(onProgress, {
            progress: 94,
            message: 'Compositing masked result',
            stage: 'composite',
            provider,
            model
        });

        const outputPlacement = this.resolveOutputPlacement(request, region, promptPlan.intent);
        return this.buildTransparentOutputFromPlacement(
            generatedRgba,
            sourceMaskRaw,
            region.width,
            region.height,
            outputPlacement,
            promptPlan.intent,
            { softenMask: true }
        );
    }

    private async runJimengOfficialFlow(
        request: InpaintingRequest,
        promptPlan: { originalPrompt: string; effectivePrompt: string; intent: InpaintingPromptIntent },
        model: InpaintingModel,
        fullImage: sharp.Sharp,
        fullMask: sharp.Sharp,
        onProgress?: InpaintingProgressCallback
    ): Promise<Buffer> {
        this.emitProgress(onProgress, {
            progress: 10,
            message: 'Preparing full image and mask for Jimeng',
            stage: 'analyze-selection',
            provider: 'local',
            model
        });

        const sourceImagePng = await fullImage.clone().png().toBuffer();
        const sourceMaskPng = await fullMask.clone().png().toBuffer();
        const sourceMaskRaw = await fullMask.clone().raw().toBuffer();

        this.emitProgress(onProgress, {
            progress: 16,
            message: 'Submitting full-image inpainting request',
            stage: 'crop-region',
            provider: 'local',
            model
        });

        this.emitProgress(onProgress, {
            progress: 22,
            message: 'Submitting Jimeng inpainting task',
            stage: 'submit-model',
            provider: 'jimeng',
            model
        });

        const generatedFull = await this.runJimengInpaint(
            promptPlan.effectivePrompt,
            sourceImagePng,
            sourceMaskPng,
            model,
            onProgress
        );

        const generatedRgba = await sharp(generatedFull)
            .resize(request.imageWidth, request.imageHeight, { fit: 'fill' })
            .ensureAlpha()
            .raw()
            .toBuffer();

        this.emitProgress(onProgress, {
            progress: 94,
            message: 'Extracting masked result from Jimeng output',
            stage: 'composite',
            provider: 'jimeng',
            model
        });

        const fullRegion: RegionBounds = {
            left: 0,
            top: 0,
            width: request.imageWidth,
            height: request.imageHeight
        };
        const outputPlacement = this.resolveJimengOutputPlacement(request, fullRegion);
        return this.buildTransparentOutputFromPlacement(
            generatedRgba,
            sourceMaskRaw,
            request.imageWidth,
            request.imageHeight,
            outputPlacement,
            promptPlan.intent,
            { softenMask: false }
        );
    }

    private resolveJimengOutputPlacement(
        request: InpaintingRequest,
        scaledRegion: RegionBounds
    ): OutputPlacement {
        const scaledSelectionBounds = this.normalizeBounds(request.selectionBounds || null);
        const originalSelectionBounds = this.normalizeBounds(request.documentMeta?.selectionBoundsOriginal || null);

        const scaledOutputBounds = scaledSelectionBounds || {
            left: scaledRegion.left,
            top: scaledRegion.top,
            right: scaledRegion.left + scaledRegion.width,
            bottom: scaledRegion.top + scaledRegion.height
        };

        const cropLeft = this.clamp(scaledOutputBounds.left - scaledRegion.left, 0, Math.max(0, scaledRegion.width - 1));
        const cropTop = this.clamp(scaledOutputBounds.top - scaledRegion.top, 0, Math.max(0, scaledRegion.height - 1));
        const cropWidth = this.clamp(scaledOutputBounds.right - scaledOutputBounds.left, 1, Math.max(1, scaledRegion.width - cropLeft));
        const cropHeight = this.clamp(scaledOutputBounds.bottom - scaledOutputBounds.top, 1, Math.max(1, scaledRegion.height - cropTop));

        if (originalSelectionBounds) {
            return {
                targetLeft: originalSelectionBounds.left,
                targetTop: originalSelectionBounds.top,
                targetWidth: originalSelectionBounds.right - originalSelectionBounds.left,
                targetHeight: originalSelectionBounds.bottom - originalSelectionBounds.top,
                cropLeft,
                cropTop,
                cropWidth,
                cropHeight
            };
        }

        const scale = this.resolveRequestScale(request);
        const documentWidth = Number(request.documentMeta?.width);
        const documentHeight = Number(request.documentMeta?.height);
        if (scale < 0.999 && documentWidth > 0 && documentHeight > 0) {
            const targetLeft = this.clamp(Math.round(scaledOutputBounds.left / scale), 0, Math.max(0, documentWidth - 1));
            const targetTop = this.clamp(Math.round(scaledOutputBounds.top / scale), 0, Math.max(0, documentHeight - 1));
            const targetWidth = this.clamp(Math.round((scaledOutputBounds.right - scaledOutputBounds.left) / scale), 1, Math.max(1, documentWidth - targetLeft));
            const targetHeight = this.clamp(Math.round((scaledOutputBounds.bottom - scaledOutputBounds.top) / scale), 1, Math.max(1, documentHeight - targetTop));
            return {
                targetLeft,
                targetTop,
                targetWidth,
                targetHeight,
                cropLeft,
                cropTop,
                cropWidth,
                cropHeight
            };
        }

        return {
            targetLeft: scaledOutputBounds.left,
            targetTop: scaledOutputBounds.top,
            targetWidth: scaledOutputBounds.right - scaledOutputBounds.left,
            targetHeight: scaledOutputBounds.bottom - scaledOutputBounds.top,
            cropLeft,
            cropTop,
            cropWidth,
            cropHeight
        };
    }

    private async buildTransparentOutputFromPlacement(
        generatedRgba: Buffer,
        sourceMaskRaw: Buffer,
        sourceWidth: number,
        sourceHeight: number,
        outputPlacement: OutputPlacement,
        intent: InpaintingPromptIntent,
        options?: { softenMask?: boolean }
    ): Promise<Buffer> {
        const croppedGeneratedRgba = await this.cropRawRgba(
            generatedRgba,
            sourceWidth,
            sourceHeight,
            outputPlacement.cropLeft,
            outputPlacement.cropTop,
            outputPlacement.cropWidth,
            outputPlacement.cropHeight
        );
        const croppedMaskRaw = await this.cropRawChannel(
            sourceMaskRaw,
            sourceWidth,
            sourceHeight,
            outputPlacement.cropLeft,
            outputPlacement.cropTop,
            outputPlacement.cropWidth,
            outputPlacement.cropHeight,
            1
        );
        const resizedGeneratedRgba = await this.resizeRawRgba(
            croppedGeneratedRgba,
            outputPlacement.cropWidth,
            outputPlacement.cropHeight,
            outputPlacement.targetWidth,
            outputPlacement.targetHeight
        );
        const resizedMaskRaw = await this.resizeRawChannel(
            croppedMaskRaw,
            outputPlacement.cropWidth,
            outputPlacement.cropHeight,
            outputPlacement.targetWidth,
            outputPlacement.targetHeight,
            1
        );
        return this.composeTransparentOutput(
            resizedGeneratedRgba,
            resizedMaskRaw,
            outputPlacement.targetWidth,
            outputPlacement.targetHeight,
            intent,
            options
        );
    }

    private normalizeModel(model?: string): InpaintingModel {
        if (!model) {
            return DEFAULT_INPAINTING_MODEL;
        }
        if (SUPPORTED_MODELS.includes(model as InpaintingModel)) {
            return model as InpaintingModel;
        }
        throw new Error(
            `不支持的局部重绘模型「${model}」。当前可用：${SUPPORTED_MODELS.join('、')}`
        );
    }

    private validateProviderCredentials(model: InpaintingModel): void {
        if (OPENROUTER_MODELS.includes(model)) {
            if (!openRouterGeminiImageService.hasApiKey()) {
                throw new Error('OpenRouter API Key is not configured');
            }
            return;
        }

        if (model === 'jimeng-inpaint' && !volcengineJimengInpaintingService.hasCredentials()) {
            throw new Error('即梦AI Access Key ID / Secret Access Key 未配置');
        }
    }

    private getModelProvider(model: InpaintingModel): InpaintingProvider {
        return model === 'jimeng-inpaint' ? 'jimeng' : 'openrouter';
    }

    private normalizeRequestFormats(request: InpaintingRequest): { imageFormat: InpaintingImageFormat; maskFormat: InpaintingImageFormat } {
        const imageFormat = this.normalizeTransportFormat(request.imageFormat, 'raw');
        const maskFormat = this.normalizeTransportFormat(request.maskFormat, 'raw');
        return { imageFormat, maskFormat };
    }

    private normalizeTransportFormat(
        format: InpaintingRequest['imageFormat'] | InpaintingRequest['maskFormat'],
        fallback: InpaintingImageFormat
    ): InpaintingImageFormat {
        if (format === 'png' || format === 'jpeg' || format === 'raw') {
            return format;
        }
        return fallback;
    }

    private async runProviderEdit(
        model: InpaintingModel,
        prompt: string,
        cropImagePng: Buffer,
        cropMaskPng: Buffer,
        referenceImages: Buffer[],
        onProgress?: InpaintingProgressCallback
    ): Promise<Buffer> {
        if (model === 'jimeng-inpaint') {
            return this.runJimengInpaint(prompt, cropImagePng, cropMaskPng, model, onProgress);
        }

        return this.runOpenRouterInpaint(prompt, cropImagePng, cropMaskPng, model, referenceImages, onProgress);
    }

    private async runJimengInpaint(
        prompt: string,
        cropImagePng: Buffer,
        cropMaskPng: Buffer,
        model: InpaintingModel,
        onProgress?: InpaintingProgressCallback
    ): Promise<Buffer> {
        const result = await volcengineJimengInpaintingService.inpaint(
            prompt,
            cropImagePng,
            cropMaskPng,
            (event) => {
                this.emitProgress(onProgress, {
                    progress: event.progress,
                    message: event.message,
                    stage: event.stage,
                    provider: 'jimeng',
                    model
                });
            }
        );

        return result.image;
    }

    private async runOpenRouterInpaint(
        prompt: string,
        cropImagePng: Buffer,
        cropMaskPng: Buffer,
        model: InpaintingModel,
        referenceImages: Buffer[],
        onProgress?: InpaintingProgressCallback
    ): Promise<Buffer> {
        const result = await openRouterGeminiImageService.editImage(
            prompt,
            cropImagePng,
            cropMaskPng,
            { model, referenceImages },
            (event) => {
                this.emitProgress(onProgress, {
                    progress: event.progress,
                    message: event.message,
                    stage: event.stage,
                    provider: 'openrouter',
                    model
                });
            }
        );

        return result.image;
    }

    private async decodeRgbImage(
        base64: string,
        width: number,
        height: number,
        channels: number,
        format: 'raw' | 'png' | 'jpeg'
    ): Promise<sharp.Sharp> {
        const normalized = base64.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(normalized, 'base64');
        if (format === 'raw') {
            if (channels !== 3 && channels !== 4) {
                throw new Error(`Unsupported image channel count: ${channels}`);
            }
            return sharp(buffer, {
                raw: { width, height, channels }
            }).removeAlpha();
        }

        const image = sharp(buffer).removeAlpha();
        const metadata = await image.metadata();
        if ((metadata.width && metadata.width !== width) || (metadata.height && metadata.height !== height)) {
            throw new Error(`Encoded image size mismatch: got ${metadata.width}x${metadata.height}, expected ${width}x${height}`);
        }
        return image;
    }

    private async decodeMaskImage(
        base64: string,
        width: number,
        height: number,
        channels: number,
        format: 'raw' | 'png' | 'jpeg'
    ): Promise<sharp.Sharp> {
        const normalized = base64.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(normalized, 'base64');
        if (format === 'raw') {
            if (channels !== 1) {
                throw new Error(`Unsupported mask channel count: ${channels}`);
            }
            return sharp(buffer, {
                raw: { width, height, channels: 1 }
            }).grayscale();
        }

        const image = sharp(buffer).grayscale();
        const metadata = await image.metadata();
        if ((metadata.width && metadata.width !== width) || (metadata.height && metadata.height !== height)) {
            throw new Error(`Encoded mask size mismatch: got ${metadata.width}x${metadata.height}, expected ${width}x${height}`);
        }
        return image;
    }

    private async resolveRegion(
        request: InpaintingRequest,
        fullMask: sharp.Sharp,
        intent: InpaintingPromptIntent
    ): Promise<RegionBounds> {
        const rawBounds = request.selectionBounds || {};
        const left = Number(rawBounds.left);
        const top = Number(rawBounds.top);
        const right = Number(rawBounds.right);
        const bottom = Number(rawBounds.bottom);

        if ([left, top, right, bottom].every(Number.isFinite) && right > left && bottom > top) {
            return this.resolveContextWindow(
                { left, top, right, bottom },
                request.imageWidth,
                request.imageHeight,
                intent
            );
        }

        const maskData = await fullMask.clone().raw().toBuffer();
        let minX = request.imageWidth;
        let minY = request.imageHeight;
        let maxX = -1;
        let maxY = -1;

        for (let y = 0; y < request.imageHeight; y++) {
            for (let x = 0; x < request.imageWidth; x++) {
                if (maskData[(y * request.imageWidth) + x] > 0) {
                    if (x < minX) minX = x;
                    if (y < minY) minY = y;
                    if (x > maxX) maxX = x;
                    if (y > maxY) maxY = y;
                }
            }
        }

        if (maxX < minX || maxY < minY) {
            throw new Error('Selection bounds are empty');
        }

        return this.resolveContextWindow(
            { left: minX, top: minY, right: maxX + 1, bottom: maxY + 1 },
            request.imageWidth,
            request.imageHeight,
            intent
        );
    }

    /**
     * 以选区为中心裁一个"上下文窗口"交给模型。
     *
     * 与旧的固定 padding 相比有两个关键差别：
     * 1. 窗口按选区尺寸成倍放大并有绝对下限，模型能看到真实的现场环境，
     *    而不是只看到选区边上一圈几十像素。
     * 2. 窗口会吸附到模型支持的出图比例上。模型只按固定比例档位出图，
     *    窗口比例对不上的话，结果贴回来时要做非等比缩放，
     *    选区内容和周围画面就会错开几个百分点。
     *
     * 只有走裁剪窗的通道会调到这里；即梦是整图重绘，不经过本函数。
     */
    private resolveContextWindow(
        bounds: SelectionBounds,
        imageWidth: number,
        imageHeight: number,
        intent: InpaintingPromptIntent
    ): RegionBounds {
        const selectionWidth = Math.max(1, bounds.right - bounds.left);
        const selectionHeight = Math.max(1, bounds.bottom - bounds.top);
        const scale = CONTEXT_WINDOW_SCALE[intent];
        const minEdge = Math.min(MIN_CONTEXT_WINDOW_EDGE, imageWidth, imageHeight);

        let windowWidth = this.clamp(
            Math.max(Math.round(selectionWidth * scale), minEdge),
            Math.min(selectionWidth, imageWidth),
            imageWidth
        );
        let windowHeight = this.clamp(
            Math.max(Math.round(selectionHeight * scale), minEdge),
            Math.min(selectionHeight, imageHeight),
            imageHeight
        );

        const snapped = this.snapWindowToSupportedAspect(
            windowWidth,
            windowHeight,
            selectionWidth,
            selectionHeight,
            imageWidth,
            imageHeight
        );
        if (snapped) {
            windowWidth = snapped.width;
            windowHeight = snapped.height;
        }

        return this.centerWindowOnSelection(bounds, windowWidth, windowHeight, imageWidth, imageHeight);
    }

    /**
     * 把窗口尺寸吸附到模型支持的某个出图比例。
     *
     * 每个比例用整数倍数展开（k*rw × k*rh），比例是精确的而不是四舍五入来的。
     * 候选必须装得下整个选区，且不超出图像。
     *
     * 排序规则是"先够用，再够小"：
     * 先比相对目标窗口的缺口（缺得越少越好），缺口相同再比面积（越紧凑越好）。
     * 只按面积排会踩一个反直觉的坑——图像装不下理想窗口时，某些比例只能退到
     * 一个比选区大不了多少的尺寸，那个候选面积最小，于是被选中，上下文反而更少。
     */
    private snapWindowToSupportedAspect(
        windowWidth: number,
        windowHeight: number,
        selectionWidth: number,
        selectionHeight: number,
        imageWidth: number,
        imageHeight: number
    ): { width: number; height: number } | null {
        let best: { width: number; height: number; shortfall: number; area: number } | null = null;

        for (const ratio of OPENROUTER_IMAGE_ASPECT_RATIOS) {
            const [ratioWidth, ratioHeight] = ratio.split(':').map(Number);
            if (!ratioWidth || !ratioHeight) continue;

            // 覆盖目标窗口所需的最小倍数，与图像能容纳的最大倍数，取小者
            const desiredMultiplier = Math.ceil(
                Math.max(windowWidth / ratioWidth, windowHeight / ratioHeight)
            );
            const maxMultiplier = Math.floor(
                Math.min(imageWidth / ratioWidth, imageHeight / ratioHeight)
            );
            const requiredMultiplier = Math.ceil(
                Math.max(selectionWidth / ratioWidth, selectionHeight / ratioHeight)
            );
            const multiplier = Math.min(desiredMultiplier, maxMultiplier);

            if (multiplier < requiredMultiplier || multiplier < 1) continue;

            const width = multiplier * ratioWidth;
            const height = multiplier * ratioHeight;
            if (width > imageWidth || height > imageHeight) continue;

            const shortfall = Math.max(0, windowWidth - width) + Math.max(0, windowHeight - height);
            const area = width * height;
            if (!best || shortfall < best.shortfall || (shortfall === best.shortfall && area < best.area)) {
                best = { width, height, shortfall, area };
            }
        }

        return best ? { width: best.width, height: best.height } : null;
    }

    /** 让窗口尽量以选区为中心，贴到图像边缘时整体平移而不是裁掉 */
    private centerWindowOnSelection(
        bounds: SelectionBounds,
        windowWidth: number,
        windowHeight: number,
        imageWidth: number,
        imageHeight: number
    ): RegionBounds {
        const centerX = (bounds.left + bounds.right) / 2;
        const centerY = (bounds.top + bounds.bottom) / 2;
        const left = Math.round(this.clamp(centerX - windowWidth / 2, 0, Math.max(0, imageWidth - windowWidth)));
        const top = Math.round(this.clamp(centerY - windowHeight / 2, 0, Math.max(0, imageHeight - windowHeight)));

        return {
            left,
            top,
            width: Math.max(1, Math.min(windowWidth, imageWidth - left)),
            height: Math.max(1, Math.min(windowHeight, imageHeight - top))
        };
    }

    private async composeTransparentOutput(
        generatedRgba: Buffer,
        maskRaw: Buffer,
        width: number,
        height: number,
        intent: InpaintingPromptIntent,
        options?: { softenMask?: boolean }
    ): Promise<Buffer> {
        const pixelCount = width * height;
        const expectedRgbaLength = pixelCount * 4;
        if (generatedRgba.length !== expectedRgbaLength || maskRaw.length !== pixelCount) {
            throw new Error(
                `局部重绘合成尺寸不一致：RGBA ${generatedRgba.length}/${expectedRgbaLength} 字节，蒙版 ${maskRaw.length}/${pixelCount} 字节`
            );
        }
        const softenedMask = options?.softenMask === false
            ? maskRaw
            : await this.buildCompositeMask(maskRaw, width, height, intent);
        const out = Buffer.alloc(generatedRgba.length);
        for (let i = 0; i < pixelCount; i++) {
            const offset = i * 4;
            out[offset] = generatedRgba[offset];
            out[offset + 1] = generatedRgba[offset + 1];
            out[offset + 2] = generatedRgba[offset + 2];
            out[offset + 3] = softenedMask[i];
        }
        return out;
    }

    private async buildCompositeMask(
        maskRaw: Buffer,
        width: number,
        height: number,
        intent: InpaintingPromptIntent
    ): Promise<Buffer> {
        const sigma = this.resolveCompositeBlurSigma(width, height, intent);
        if (sigma <= 0) {
            return maskRaw;
        }
        const softenedMask = await sharp(maskRaw, {
            raw: { width, height, channels: 1 }
        })
            .blur(sigma)
            .extractChannel(0)
            .raw()
            .toBuffer();
        return Buffer.from(clampSoftenedMaskToSelection(maskRaw, softenedMask));
    }

    private resolveCompositeBlurSigma(
        width: number,
        height: number,
        intent: InpaintingPromptIntent
    ): number {
        const base = Math.max(width, height) * 0.0065;
        const multiplier: Record<InpaintingPromptIntent, number> = {
            'context-fill': 1.2,
            add: 1.35,
            replace: 1.05,
            remove: 1.15,
            modify: 1
        };
        return this.clamp(Number((base * multiplier[intent]).toFixed(2)), 1.1, 4.8);
    }

    /**
     * 解码用户提供的效果参考图。
     *
     * 只有 OpenRouter/Gemini 通道能吃参考图；其他通道走的是官方蒙版重绘接口，
     * 没有多图输入位。这时不能装作用上了，要明确回报"这次没生效"。
     */
    private async resolveReferenceImages(
        request: InpaintingRequest,
        provider: InpaintingProvider
    ): Promise<{ references: Buffer[]; warnings: string[] }> {
        const rawList = Array.isArray(request.referenceImages) ? request.referenceImages : [];
        const candidates = rawList.filter((item) => typeof item === 'string' && item.trim().length > 0);
        if (candidates.length === 0) {
            return { references: [], warnings: [] };
        }

        if (provider !== 'openrouter') {
            return {
                references: [],
                warnings: [
                    `当前重绘模型不支持参考图，本次已忽略 ${candidates.length} 张参考图。改用 Nano Banana Pro 或 GPT Image 系列可让参考图生效。`
                ]
            };
        }

        const references: Buffer[] = [];
        const warnings: string[] = [];

        for (let index = 0; index < candidates.length; index++) {
            const base64 = candidates[index].replace(/^data:[^;]+;base64,/, '').trim();
            try {
                const decoded = Buffer.from(base64, 'base64');
                if (decoded.length === 0) {
                    throw new Error('解码后为空');
                }
                references.push(
                    await sharp(decoded)
                        .resize(REFERENCE_IMAGE_MAX_EDGE, REFERENCE_IMAGE_MAX_EDGE, {
                            fit: 'inside',
                            withoutEnlargement: true
                        })
                        .png()
                        .toBuffer()
                );
            } catch (error: any) {
                warnings.push(
                    `第 ${index + 1} 张参考图无法解析（${error?.message || error}），本次已跳过。请换一张常规 PNG/JPG 图片。`
                );
            }
        }

        return { references, warnings };
    }

    private buildPromptPlan(
        prompt: string | undefined,
        provider: InpaintingProvider
    ): { originalPrompt: string; effectivePrompt: string; intent: InpaintingPromptIntent } {
        const originalPrompt = String(prompt || '').trim();
        const normalizedPrompt = originalPrompt.replace(/\s+/g, ' ').trim();

        if (!normalizedPrompt) {
            if (provider === 'jimeng') {
                return {
                    originalPrompt: '',
                    intent: 'context-fill',
                    effectivePrompt: '删除'
                };
            }
            return {
                originalPrompt: '',
                intent: 'context-fill',
                effectivePrompt: '根据周围画面内容自然补全选区，保持原场景的光线、透视、材质、色温、景深和边缘过渡一致，不要生成突兀的新主体，不改动选区外内容。'
            };
        }

        // "生成/画一/来一/做一" 在实际使用里就是"添加"，漏掉它们会让最常见的说法
        // （生成一只袜子）掉进 modify 分支，拿到最小的上下文窗口和最含糊的提示词——
        // 恰恰是最需要环境信息的场景。
        const addIntent = ADD_INTENT_PATTERN;
        const replaceIntent = /^(请)?(帮我)?(把|将).*(换成|替换成|替换为|改成)/;
        const removeIntent = /^(请)?(帮我)?(把|将)?(这里|选区里)?(去掉|移除|删除|擦掉|去除)/;
        const intent: InpaintingPromptIntent = addIntent.test(normalizedPrompt)
            ? 'add'
            : replaceIntent.test(normalizedPrompt)
                ? 'replace'
                : removeIntent.test(normalizedPrompt)
                    ? 'remove'
                    : 'modify';

        if (provider === 'jimeng') {
            return {
                originalPrompt: normalizedPrompt,
                intent,
                effectivePrompt: this.buildJimengPrompt(normalizedPrompt, intent)
            };
        }

        const subject = this.extractPromptSubject(normalizedPrompt, intent);
        if (intent === 'add') {
            return {
                originalPrompt: normalizedPrompt,
                intent,
                effectivePrompt: `在选区内自然加入${subject}，让新增内容与周围画面的光线、透视、材质、色温、景深和边缘过渡保持一致，避免悬浮、拼贴感、重复物体和突兀边缘，不改动选区外内容。`
            };
        }
        if (intent === 'replace') {
            return {
                originalPrompt: normalizedPrompt,
                intent,
                effectivePrompt: `将选区中的原有内容替换为${subject}，保持与周围画面的光线、透视、材质、色温、景深和边缘过渡一致，不改动选区外内容。`
            };
        }
        if (intent === 'remove') {
            return {
                originalPrompt: normalizedPrompt,
                intent,
                effectivePrompt: `移除选区中的${subject}，并根据周围画面自然补全背景，保持原场景的光线、透视、纹理、材质和边缘过渡一致，不改动选区外内容。`
            };
        }
        return {
            originalPrompt: normalizedPrompt,
            intent,
            effectivePrompt: `在选区内根据以下描述进行自然编辑：${normalizedPrompt}。保持与周围画面的光线、透视、材质、色温、景深和边缘过渡一致，不改动选区外内容。`
        };
    }

    private buildJimengPrompt(prompt: string, intent: InpaintingPromptIntent): string {
        if (intent === 'remove' || intent === 'context-fill') {
            return '删除';
        }

        const normalizedTextEditPrompt = this.normalizeJimengTextEditPrompt(prompt, intent);
        if (normalizedTextEditPrompt) {
            return normalizedTextEditPrompt;
        }

        return prompt;
    }

    private normalizeJimengTextEditPrompt(prompt: string, intent: InpaintingPromptIntent): string | null {
        const hasTextEditVerb = /(改为|换成|替换为|替换成|替换内容|文字替换)/.test(prompt);
        const mentionsTextContent = /(文字|文案|标题|logo|字样|字体|内容|英文|中文|数字|日期)/i.test(prompt);
        if (!hasTextEditVerb && !mentionsTextContent) {
            return null;
        }

        const quotedText = this.extractQuotedText(prompt);
        const replacement = this.stripWrappingQuotes(
            quotedText || (intent === 'replace' ? this.extractPromptSubject(prompt, intent) : '')
        );
        if (!replacement) {
            return null;
        }

        const keepFontPrefix = /字体不变/.test(prompt) ? '字体不变，' : '';
        return `${keepFontPrefix}将内容替换为“${replacement}”`;
    }

    private extractPromptSubject(prompt: string, intent: InpaintingPromptIntent): string {
        let subject = prompt;
        if (intent === 'add') {
            subject = subject.replace(ADD_SUBJECT_PATTERN, '').trim();
        } else if (intent === 'replace') {
            subject = subject
                .replace(/^(请)?(帮我)?(把|将)/, '')
                .replace(/.*(换成|替换成|替换为|改成)/, '')
                .trim();
        } else if (intent === 'remove') {
            subject = subject
                .replace(/^(请)?(帮我)?(把|将)?(这里|选区里)?(去掉|移除|删除|擦掉|去除)/, '')
                .trim();
        }
        subject = subject.replace(/^[：:，,\s]+|[。！!，,\s]+$/g, '').trim();
        return subject || prompt;
    }

    private extractQuotedText(prompt: string): string {
        const match = prompt.match(/[“"](.*?)[”"]/);
        return match?.[1]?.trim() || '';
    }

    private stripWrappingQuotes(value: string): string {
        return String(value || '')
            .replace(/^[“"'`]+|[”"'`]+$/g, '')
            .trim();
    }

    private resolveOutputPlacement(
        request: InpaintingRequest,
        scaledRegion: RegionBounds,
        intent: InpaintingPromptIntent
    ): OutputPlacement {
        const documentWidth = Number(request.documentMeta?.width);
        const documentHeight = Number(request.documentMeta?.height);
        const scaledSelectionBounds = this.normalizeBounds(request.selectionBounds || null);
        const originalSelectionBounds = this.normalizeBounds(request.documentMeta?.selectionBoundsOriginal || null);
        const scaledOutputBounds = this.resolveSelectionOutputBounds(
            scaledSelectionBounds
                ? {
                    left: scaledSelectionBounds.left,
                    top: scaledSelectionBounds.top,
                    right: scaledSelectionBounds.right,
                    bottom: scaledSelectionBounds.bottom
                }
                : {
                    left: scaledRegion.left,
                    top: scaledRegion.top,
                    right: scaledRegion.left + scaledRegion.width,
                    bottom: scaledRegion.top + scaledRegion.height
                },
            request.imageWidth,
            request.imageHeight,
            intent
        );

        const cropLeft = this.clamp(scaledOutputBounds.left - scaledRegion.left, 0, Math.max(0, scaledRegion.width - 1));
        const cropTop = this.clamp(scaledOutputBounds.top - scaledRegion.top, 0, Math.max(0, scaledRegion.height - 1));
        const cropWidth = this.clamp(scaledOutputBounds.right - scaledOutputBounds.left, 1, Math.max(1, scaledRegion.width - cropLeft));
        const cropHeight = this.clamp(scaledOutputBounds.bottom - scaledOutputBounds.top, 1, Math.max(1, scaledRegion.height - cropTop));

        if (originalSelectionBounds && documentWidth > 0 && documentHeight > 0) {
            const originalOutputBounds = this.resolveSelectionOutputBounds(originalSelectionBounds, documentWidth, documentHeight, intent);
            return {
                targetLeft: originalOutputBounds.left,
                targetTop: originalOutputBounds.top,
                targetWidth: originalOutputBounds.right - originalOutputBounds.left,
                targetHeight: originalOutputBounds.bottom - originalOutputBounds.top,
                cropLeft,
                cropTop,
                cropWidth,
                cropHeight
            };
        }

        const scale = this.resolveRequestScale(request);
        if (scale >= 0.999 || documentWidth <= 0 || documentHeight <= 0) {
            return {
                targetLeft: scaledOutputBounds.left,
                targetTop: scaledOutputBounds.top,
                targetWidth: scaledOutputBounds.right - scaledOutputBounds.left,
                targetHeight: scaledOutputBounds.bottom - scaledOutputBounds.top,
                cropLeft,
                cropTop,
                cropWidth,
                cropHeight
            };
        }

        const targetLeft = this.clamp(Math.round(scaledOutputBounds.left / scale), 0, Math.max(0, documentWidth - 1));
        const targetTop = this.clamp(Math.round(scaledOutputBounds.top / scale), 0, Math.max(0, documentHeight - 1));
        const targetWidth = this.clamp(Math.round((scaledOutputBounds.right - scaledOutputBounds.left) / scale), 1, Math.max(1, documentWidth - targetLeft));
        const targetHeight = this.clamp(Math.round((scaledOutputBounds.bottom - scaledOutputBounds.top) / scale), 1, Math.max(1, documentHeight - targetTop));

        return {
            targetLeft,
            targetTop,
            targetWidth,
            targetHeight,
            cropLeft,
            cropTop,
            cropWidth,
            cropHeight
        };
    }

    private resolveSelectionOutputBounds(
        bounds: SelectionBounds,
        imageWidth: number,
        imageHeight: number,
        intent: InpaintingPromptIntent
    ): SelectionBounds {
        const width = bounds.right - bounds.left;
        const height = bounds.bottom - bounds.top;
        const basePadding = Math.max(4, Math.min(18, Math.round(Math.max(width, height) * 0.035)));
        const multiplier: Record<InpaintingPromptIntent, number> = {
            'context-fill': 1.05,
            add: 1.15,
            replace: 0.9,
            remove: 1,
            modify: 0.9
        };
        const padding = Math.round(basePadding * multiplier[intent]);
        return {
            left: this.clamp(bounds.left - padding, 0, Math.max(0, imageWidth - 1)),
            top: this.clamp(bounds.top - padding, 0, Math.max(0, imageHeight - 1)),
            right: this.clamp(bounds.right + padding, 1, imageWidth),
            bottom: this.clamp(bounds.bottom + padding, 1, imageHeight)
        };
    }

    private resolveRequestScale(request: InpaintingRequest): number {
        const explicitScale = Number(request.documentMeta?.scale);
        if (Number.isFinite(explicitScale) && explicitScale > 0 && explicitScale <= 1) {
            return explicitScale;
        }

        const documentWidth = Number(request.documentMeta?.width);
        const documentHeight = Number(request.documentMeta?.height);
        if (documentWidth > 0 && documentHeight > 0) {
            const scaleX = request.imageWidth / documentWidth;
            const scaleY = request.imageHeight / documentHeight;
            if (Number.isFinite(scaleX) && Number.isFinite(scaleY) && scaleX > 0 && scaleY > 0) {
                return Math.min(scaleX, scaleY);
            }
        }

        return 1;
    }

    private normalizeBounds(bounds: {
        left?: number;
        top?: number;
        right?: number;
        bottom?: number;
    } | null): SelectionBounds | null {
        if (!bounds) {
            return null;
        }
        const left = Number(bounds.left);
        const top = Number(bounds.top);
        const right = Number(bounds.right);
        const bottom = Number(bounds.bottom);
        if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) {
            return null;
        }
        return { left, top, right, bottom };
    }

    private async resizeRawRgba(
        rgba: Buffer,
        sourceWidth: number,
        sourceHeight: number,
        targetWidth: number,
        targetHeight: number
    ): Promise<Buffer> {
        if (sourceWidth === targetWidth && sourceHeight === targetHeight) {
            return rgba;
        }
        return sharp(rgba, {
            raw: { width: sourceWidth, height: sourceHeight, channels: 4 }
        })
            .resize(targetWidth, targetHeight, { fit: 'fill' })
            .raw()
            .toBuffer();
    }

    private async cropRawRgba(
        rgba: Buffer,
        sourceWidth: number,
        sourceHeight: number,
        left: number,
        top: number,
        width: number,
        height: number
    ): Promise<Buffer> {
        if (left <= 0 && top <= 0 && width === sourceWidth && height === sourceHeight) {
            return rgba;
        }
        return sharp(rgba, {
            raw: { width: sourceWidth, height: sourceHeight, channels: 4 }
        })
            .extract({ left, top, width, height })
            .raw()
            .toBuffer();
    }

    private async cropRawChannel(
        raw: Buffer,
        sourceWidth: number,
        sourceHeight: number,
        left: number,
        top: number,
        width: number,
        height: number,
        channels: 1 | 2 | 3 | 4
    ): Promise<Buffer> {
        if (left <= 0 && top <= 0 && width === sourceWidth && height === sourceHeight) {
            return raw;
        }
        const pipeline = sharp(raw, {
            raw: { width: sourceWidth, height: sourceHeight, channels }
        })
            .extract({ left, top, width, height });
        if (channels === 1) {
            return pipeline.extractChannel(0).raw().toBuffer();
        }
        return pipeline.raw().toBuffer();
    }

    private async resizeRawChannel(
        raw: Buffer,
        sourceWidth: number,
        sourceHeight: number,
        targetWidth: number,
        targetHeight: number,
        channels: 1 | 2 | 3 | 4
    ): Promise<Buffer> {
        if (sourceWidth === targetWidth && sourceHeight === targetHeight) {
            return raw;
        }
        const pipeline = sharp(raw, {
            raw: { width: sourceWidth, height: sourceHeight, channels }
        })
            .resize(targetWidth, targetHeight, {
                fit: 'fill',
                kernel: sharp.kernel.nearest
            });
        if (channels === 1) {
            return pipeline.extractChannel(0).raw().toBuffer();
        }
        return pipeline.raw().toBuffer();
    }

    private emitProgress(onProgress: InpaintingProgressCallback | undefined, event: InpaintingProgressEvent): void {
        onProgress?.(event);
    }

    private clamp(value: number, min: number, max: number): number {
        return Math.max(min, Math.min(max, value));
    }

    private toDataUrl(pngBuffer: Buffer): string {
        return `data:image/png;base64,${pngBuffer.toString('base64')}`;
    }
}
