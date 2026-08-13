import axios from 'axios';
import sharp from 'sharp';
import { getAxiosProxyConfig } from './network-proxy';

export type OpenRouterGeminiImageModel =
    | 'google/gemini-3-pro-image'
    | 'openai/gpt-5-image'
    | 'openai/gpt-5-image-mini'
    | 'openai/gpt-5.4-image-2';

export interface OpenRouterGeminiImageProgressEvent {
    progress: number;
    stage:
        | 'provider-validate'
        | 'provider-submit'
        | 'provider-ready'
        | 'provider-download';
    message: string;
}

export type OpenRouterGeminiImageProgressCallback = (event: OpenRouterGeminiImageProgressEvent) => void;

export interface OpenRouterGeminiImageResult {
    image: Buffer;
    model: OpenRouterGeminiImageModel;
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    aspectRatio: string;
    imageSize: '1K' | '2K' | '4K';
}

type OpenRouterImageBlock = {
    image_url?: {
        url?: string;
    };
    imageUrl?: {
        url?: string;
    };
};

type OpenRouterChatCompletionResponse = {
    id?: string;
    choices?: Array<{
        message?: {
            images?: OpenRouterImageBlock[];
            content?: string | Array<{ type?: string; text?: string }>;
        };
    }>;
    error?: {
        message?: string;
        code?: string;
    };
};

type ServiceError = Error & {
    errorStage?: string;
    errorCode?: string;
    errorDetail?: string;
    provider?: 'openrouter';
};

const OPENROUTER_CHAT_COMPLETIONS_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL: OpenRouterGeminiImageModel = 'google/gemini-3-pro-image';
const MAX_INLINE_IMAGE_BYTES = 7 * 1024 * 1024;

const SUPPORTED_MODELS: OpenRouterGeminiImageModel[] = [
    'google/gemini-3-pro-image',
    'openai/gpt-5-image',
    'openai/gpt-5-image-mini',
    'openai/gpt-5.4-image-2'
];

/**
 * image_config（aspect_ratio / image_size）是 OpenRouter 给 Gemini 图像模型的扩展字段，
 * 不是通用 chat completions 参数。发给不认识它的模型可能被拒或被忽略，
 * 所以按模型判断要不要带上，而不是无条件塞进请求体。
 */
const MODELS_WITH_IMAGE_CONFIG: OpenRouterGeminiImageModel[] = ['google/gemini-3-pro-image'];

/**
 * Gemini 图像模型只按固定比例档位出图。上游裁剪窗必须先吸附到这里的某一档，
 * 否则结果贴回去时要做非等比缩放，选区内容和周围画面就会错位。
 */
export const OPENROUTER_IMAGE_ASPECT_RATIOS = [
    '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'
] as const;

const SUPPORTED_ASPECT_RATIOS = OPENROUTER_IMAGE_ASPECT_RATIOS;

/** 引导图上标注选区边界的描边宽度基数（相对长边），描在选区外侧 */
const GUIDE_OUTLINE_RATIO = 0.0035;
const GUIDE_OUTLINE_MIN_SIGMA = 1.2;
const GUIDE_OUTLINE_MAX_SIGMA = 4.5;

export class OpenRouterGeminiImageService {
    private apiKey = '';

    setApiKey(apiKey?: string): void {
        this.apiKey = String(apiKey || '').trim();
    }

    hasApiKey(): boolean {
        return this.apiKey.length > 0;
    }

    async editImage(
        prompt: string,
        sourceImage: Buffer,
        maskImage: Buffer,
        options?: {
            model?: OpenRouterGeminiImageModel | string;
            timeoutMs?: number;
            /** 用户提供的效果参考图，用来锁定"要哪一只袜子"这类模型猜不出来的信息 */
            referenceImages?: Buffer[];
        },
        onProgress?: OpenRouterGeminiImageProgressCallback
    ): Promise<OpenRouterGeminiImageResult> {
        if (!this.hasApiKey()) {
            throw this.createStageError('OpenRouter API Key 未配置', 'provider-validate');
        }

        const cleanPrompt = String(prompt || '').trim();
        if (!cleanPrompt) {
            throw this.createStageError('Prompt is required', 'provider-validate');
        }
        if (!(sourceImage instanceof Buffer) || sourceImage.length === 0) {
            throw this.createStageError('Source image is required', 'provider-validate');
        }
        if (!(maskImage instanceof Buffer) || maskImage.length === 0) {
            throw this.createStageError('Mask image is required', 'provider-validate');
        }

        const model = this.normalizeModel(options?.model);
        const timeoutMs = Math.max(30_000, options?.timeoutMs || 180_000);

        onProgress?.({
            progress: 28,
            stage: 'provider-validate',
            message: 'Preparing OpenRouter inpainting request'
        });

        const sourceMetadata = await sharp(sourceImage).metadata();
        const width = Math.max(1, sourceMetadata.width || 1024);
        const height = Math.max(1, sourceMetadata.height || 1024);
        const aspectRatio = this.resolveAspectRatio(width, height);
        const imageSize = this.resolveImageSize(width, height);

        const normalizedMask = await this.normalizeMask(maskImage);
        const guideImage = await this.buildGuideImage(sourceImage, normalizedMask);

        // 二值蒙版不作为参考图发送：Gemini 这类指令式编辑模型没有蒙版通道，
        // 收到一张纯黑白图会当成风格参考融进结果里（典型症状就是生成物带白底）。
        // 蒙版只用来生成"选区外侧描边"的引导图，以及最终合成时的 alpha。
        const sourceDataUrl = await this.encodeImageDataUrl(sourceImage, 'source');
        const guideDataUrl = await this.encodeImageDataUrl(guideImage, 'guide');

        const referenceBuffers = Array.isArray(options?.referenceImages)
            ? options!.referenceImages!.filter((buffer) => buffer instanceof Buffer && buffer.length > 0)
            : [];
        const referenceDataUrls: string[] = [];
        for (const reference of referenceBuffers) {
            referenceDataUrls.push(await this.encodeImageDataUrl(reference, 'reference'));
        }

        const requestBody = this.buildRequestBody({
            model,
            instruction: this.buildEditInstruction(cleanPrompt, referenceDataUrls.length),
            sourceDataUrl,
            guideDataUrl,
            referenceDataUrls,
            aspectRatio,
            imageSize
        });

        onProgress?.({
            progress: 46,
            stage: 'provider-submit',
            message: 'Submitting image edit request to OpenRouter'
        });

        let response;
        try {
            response = await axios.post<OpenRouterChatCompletionResponse>(
                OPENROUTER_CHAT_COMPLETIONS_ENDPOINT,
                requestBody,
                {
                    timeout: timeoutMs,
                    ...getAxiosProxyConfig(),
                    headers: {
                        Authorization: `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json',
                        'HTTP-Referer': 'https://designecho.app',
                        'X-Title': 'DesignEcho Agent'
                    }
                }
            );
        } catch (error: any) {
            throw this.wrapAxiosError(error);
        }

        const payload = response.data;
        const imageUrl = this.extractImageUrl(payload);
        if (!imageUrl) {
            const responseText = this.extractResponseText(payload);
            throw this.createStageError(
                responseText
                    ? `OpenRouter did not return an image result: ${responseText}`
                    : 'OpenRouter did not return an image result',
                'provider-ready'
            );
        }

        onProgress?.({
            progress: 82,
            stage: 'provider-ready',
            message: 'OpenRouter returned image result'
        });

        const resolved = await this.resolveImageUrl(imageUrl);

        onProgress?.({
            progress: 92,
            stage: 'provider-download',
            message: 'Downloading OpenRouter image result'
        });

        return {
            image: resolved.image,
            model,
            mimeType: resolved.mimeType,
            aspectRatio,
            imageSize
        };
    }

    /**
     * 构造 OpenRouter 请求体。
     *
     * 单独抽出来是为了能离线断言——这个函数里藏过一个代价很大的 bug：
     * 图片内容块的字段名写成了 camelCase 的 `imageUrl`，OpenAI 兼容层不认识，
     * 于是三张图被**静默丢弃**，模型只收到那段文字，执行的是纯文生图，
     * 返回一张跟原图毫无关系的新场景。整条链路没有任何一处会报错。
     *
     * 仓库其余出图路径（model-service / openai-adapter / stream-adapter）用的都是
     * snake_case `image_url`，这里是唯一的例外——所以它才活了下来。
     * 现在由 test:openrouter-image-request 把这条契约钉住。
     */
    buildRequestBody(input: {
        model: OpenRouterGeminiImageModel;
        instruction: string;
        sourceDataUrl: string;
        guideDataUrl: string;
        referenceDataUrls: string[];
        aspectRatio: string;
        imageSize: '1K' | '2K' | '4K';
    }): Record<string, unknown> {
        const body: Record<string, unknown> = {
            model: input.model,
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: input.instruction },
                        { type: 'image_url', image_url: { url: input.sourceDataUrl } },
                        { type: 'image_url', image_url: { url: input.guideDataUrl } },
                        ...input.referenceDataUrls.map((url) => ({ type: 'image_url', image_url: { url } }))
                    ]
                }
            ],
            modalities: ['image', 'text'],
            stream: false
        };

        if (MODELS_WITH_IMAGE_CONFIG.includes(input.model)) {
            body.image_config = {
                aspect_ratio: input.aspectRatio,
                image_size: input.imageSize
            };
        }

        return body;
    }

    /**
     * 这里曾经无论传什么都返回 DEFAULT_MODEL——面板上选了别的模型也照样打给 Gemini，
     * 用户看到的是"换了模型但结果没变"。现在按支持清单校验，不认识的显式报错，
     * 而不是悄悄替换成另一个模型。
     */
    private normalizeModel(model?: string): OpenRouterGeminiImageModel {
        const normalized = String(model || '').trim();
        if (!normalized) {
            return DEFAULT_MODEL;
        }
        if (SUPPORTED_MODELS.includes(normalized as OpenRouterGeminiImageModel)) {
            return normalized as OpenRouterGeminiImageModel;
        }
        throw this.createStageError(
            `OpenRouter 图像模型「${normalized}」不在支持清单内。当前可用：${SUPPORTED_MODELS.join('、')}`,
            'provider-validate'
        );
    }

    private buildEditInstruction(prompt: string, referenceCount: number): string {
        const lines = [
            'You are performing a localized generative fill on a photograph, like Photoshop Generative Fill.',
            'Image 1 is the working photo.',
            'Image 2 is the same photo with a thin red outline drawn just OUTSIDE the editable region.',
            referenceCount > 0
                ? `The remaining ${referenceCount} image(s) are appearance references supplied by the user: match the subject, material, color and styling shown there.`
                : '',
            `Task, applied only inside the outlined region: ${prompt}`,
            '',
            'Hard requirements:',
            '- Return ONE image that is the full Image 1 with identical framing, crop, resolution and camera position. Do not zoom, pan, rotate or re-compose.',
            '- Everything outside the outlined region must stay pixel-identical.',
            '- Do NOT draw the red outline, any marker, border or label into the result.',
            '',
            'Photographic consistency (this is what makes the fill believable):',
            '- Reuse the same light source direction, intensity, softness and color temperature as the surrounding photo.',
            '- Cast contact shadows and reflections onto the existing surface the new content sits on.',
            '- Match the surrounding depth of field, focus falloff, motion blur, lens distortion, sensor noise and grain.',
            '- Match the surrounding white balance, contrast curve and color grading.',
            '- Ground the new content in the scene: correct scale relative to nearby objects, correct perspective, correct occlusion by objects already in front.',
            '',
            'Never do:',
            '- Never place the new content on a white, gray, gradient or studio background.',
            '- Never produce a cutout, sticker, collage or pasted-product look with a hard silhouette edge.',
            '- Never render the subject floating, or lit differently from the rest of the photo.',
            ...this.buildSceneDiscipline()
        ];

        return lines.filter((line) => line !== '').join('\n');
    }

    /**
     * 场景纪律：上面那些是通用摄影一致性要求，这里补的是"我们这类图"特有的规矩。
     *
     * 返回若干条追加到提示词末尾的英文规则（每条一行，建议以 '- ' 开头）；
     * 返回空数组表示不追加，功能照常工作。
     */
    private buildSceneDiscipline(): string[] {
        // TODO(human)
        return [];
    }

    private async normalizeMask(maskImage: Buffer): Promise<Buffer> {
        return sharp(maskImage)
            .grayscale()
            .threshold(8)
            .png()
            .toBuffer();
    }

    /**
     * 生成"选区边界标注图"：在选区**外侧**画一圈细描边，选区内部不做任何着色。
     *
     * 两个刻意的设计：
     * 1. 内部不填色——半透明色块会被模型当成真实光照/颜色抄进结果里。
     * 2. 描边只落在选区外侧——最终合成时 alpha 取自原始蒙版，
     *    外侧像素一律丢弃，所以万一模型把描边画进结果也影响不到落地内容。
     */
    private async buildGuideImage(sourceImage: Buffer, normalizedMask: Buffer): Promise<Buffer> {
        const source = sharp(sourceImage).ensureAlpha();
        const sourceMetadata = await source.metadata();
        const width = Math.max(1, sourceMetadata.width || 1);
        const height = Math.max(1, sourceMetadata.height || 1);

        const sigma = Math.min(
            GUIDE_OUTLINE_MAX_SIGMA,
            Math.max(GUIDE_OUTLINE_MIN_SIGMA, Math.max(width, height) * GUIDE_OUTLINE_RATIO)
        );

        const alignedMask = sharp(normalizedMask).resize(width, height, { fit: 'fill' });

        // 二值蒙版做一次高斯模糊后，边界会变成一条从 0 到 255 的渐变带，取靠外的那半条当描边。
        const blurredMaskRaw = await alignedMask
            .clone()
            .blur(sigma)
            .ensureAlpha()
            .extractChannel('red')
            .raw()
            .toBuffer();

        // 光靠模糊值判断在凸角处会漏进选区内侧：方角内侧边界像素的模糊值约 0.25，
        // 同样落在"外侧带"的取值区间里。再与一次原始硬蒙版，边界就是精确的。
        const hardMaskRaw = await alignedMask
            .clone()
            .ensureAlpha()
            .extractChannel('red')
            .raw()
            .toBuffer();

        const overlayRaw = Buffer.alloc(width * height * 4);
        for (let i = 0; i < width * height; i += 1) {
            const isOuterEdgeBand = hardMaskRaw[i] === 0 && blurredMaskRaw[i] >= 12 && blurredMaskRaw[i] < 128;
            const offset = i * 4;
            overlayRaw[offset] = 255;
            overlayRaw[offset + 1] = 32;
            overlayRaw[offset + 2] = 32;
            overlayRaw[offset + 3] = isOuterEdgeBand ? 255 : 0;
        }

        return source
            .composite([
                {
                    input: overlayRaw,
                    raw: { width, height, channels: 4 }
                }
            ])
            .png()
            .toBuffer();
    }

    private resolveAspectRatio(width: number, height: number): string {
        const ratio = width / height;
        let best: (typeof SUPPORTED_ASPECT_RATIOS)[number] = SUPPORTED_ASPECT_RATIOS[0];
        let bestDelta = Number.POSITIVE_INFINITY;

        for (const candidate of SUPPORTED_ASPECT_RATIOS) {
            const [w, h] = candidate.split(':').map(Number);
            const candidateRatio = w / h;
            const delta = Math.abs(candidateRatio - ratio);
            if (delta < bestDelta) {
                best = candidate;
                bestDelta = delta;
            }
        }

        return best;
    }

    private resolveImageSize(width: number, height: number): '1K' | '2K' | '4K' {
        const maxEdge = Math.max(width, height);
        if (maxEdge >= 2304) return '4K';
        if (maxEdge >= 1152) return '2K';
        return '1K';
    }

    private async encodeImageDataUrl(
        imageBuffer: Buffer,
        role: 'source' | 'guide' | 'reference'
    ): Promise<string> {
        let output = await sharp(imageBuffer).rotate().webp({ quality: 92 }).toBuffer();

        if (output.length <= MAX_INLINE_IMAGE_BYTES) {
            return this.toDataUrl(output, 'image/webp');
        }

        let working = imageBuffer;
        let scale = 1;

        for (const quality of [88, 84, 78, 72, 66, 60]) {
            for (const nextScale of [scale, 0.92, 0.86, 0.8]) {
                const metadata = await sharp(working).metadata();
                const width = Math.max(1, Math.round((metadata.width || 1) * nextScale));
                const height = Math.max(1, Math.round((metadata.height || 1) * nextScale));
                const resized = await sharp(working)
                    .resize(width, height, { fit: 'inside', withoutEnlargement: true })
                    .webp({ quality })
                    .toBuffer();
                if (resized.length <= MAX_INLINE_IMAGE_BYTES) {
                    return this.toDataUrl(resized, 'image/webp');
                }
                output = resized;
                scale = nextScale;
            }
        }

        if (output.length > MAX_INLINE_IMAGE_BYTES) {
            throw this.createStageError(
                `Prepared ${role} image exceeds OpenRouter inline limit (${Math.round(output.length / 1024 / 1024)} MB)`,
                'provider-validate'
            );
        }

        return this.toDataUrl(output, 'image/webp');
    }

    private toDataUrl(buffer: Buffer, mimeType: string): string {
        return `data:${mimeType};base64,${buffer.toString('base64')}`;
    }

    private extractImageUrl(payload: OpenRouterChatCompletionResponse): string {
        const images = payload?.choices?.[0]?.message?.images;
        if (!Array.isArray(images) || images.length === 0) {
            return '';
        }
        for (const item of images) {
            const url = String(item?.image_url?.url || item?.imageUrl?.url || '').trim();
            if (url) return url;
        }
        return '';
    }

    private extractResponseText(payload: OpenRouterChatCompletionResponse): string {
        const content = payload?.choices?.[0]?.message?.content;
        if (typeof content === 'string') {
            return content.trim();
        }
        if (Array.isArray(content)) {
            return content
                .map((item) => String(item?.text || '').trim())
                .filter(Boolean)
                .join('\n');
        }
        return '';
    }

    private async resolveImageUrl(url: string): Promise<{
        image: Buffer;
        mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    }> {
        const trimmed = String(url || '').trim();
        if (!trimmed) {
            throw this.createStageError('OpenRouter image URL is empty', 'provider-ready');
        }

        if (/^data:image\/[^;]+;base64,/i.test(trimmed)) {
            const mimeMatch = trimmed.match(/^data:(image\/[^;]+);base64,/i);
            const mimeType = this.normalizeMimeType(mimeMatch?.[1]);
            const base64 = trimmed.replace(/^data:image\/[^;]+;base64,/i, '');
            return {
                image: Buffer.from(base64, 'base64'),
                mimeType
            };
        }

        const response = await axios.get<ArrayBuffer>(trimmed, {
            responseType: 'arraybuffer',
            timeout: 90_000,
            ...getAxiosProxyConfig()
        });
        const mimeType = this.normalizeMimeType(String(response.headers['content-type'] || 'image/png'));
        return {
            image: Buffer.from(response.data),
            mimeType
        };
    }

    private normalizeMimeType(mimeType?: string): 'image/png' | 'image/jpeg' | 'image/webp' {
        const normalized = String(mimeType || '').trim().toLowerCase();
        if (normalized.includes('webp')) return 'image/webp';
        if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'image/jpeg';
        return 'image/png';
    }

    private wrapAxiosError(error: any): ServiceError {
        const status = Number(error?.response?.status || 0);
        const payload = error?.response?.data;
        const errorMessage = String(
            payload?.error?.message ||
            payload?.message ||
            error?.message ||
            'OpenRouter request failed'
        ).trim();
        const stage = status === 401 || status === 403 ? 'provider-validate' : 'provider-submit';
        const serviceError = new Error(`OpenRouter request failed: ${errorMessage}`) as ServiceError;
        serviceError.errorStage = stage;
        serviceError.errorCode = String(payload?.error?.code || status || '').trim();
        serviceError.errorDetail = errorMessage;
        serviceError.provider = 'openrouter';
        return serviceError;
    }

    private createStageError(message: string, stage: ServiceError['errorStage']): ServiceError {
        const error = new Error(message) as ServiceError;
        error.errorStage = stage;
        error.provider = 'openrouter';
        return error;
    }
}

export const openRouterGeminiImageService = new OpenRouterGeminiImageService();
