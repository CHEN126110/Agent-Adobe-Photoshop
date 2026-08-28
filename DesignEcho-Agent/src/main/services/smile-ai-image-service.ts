import axios from 'axios';
import sharp from 'sharp';
import { getAxiosProxyConfig } from './network-proxy';

/**
 * Smile AI Studio（New API 聚合网关）图像生成服务。
 *
 * 为什么单独一个 service，而不是往 openrouter-gemini-image-service.ts 里加分支：
 * 同样是 Gemini 图像模型，两个网关的**协议形态完全不同**——OpenRouter 走自己的
 * 图像 API 拿 `data[0].b64_json`，本网关走 Google 原生 generateContent 拿
 * `candidates[].content.parts[].inlineData`；错误语义、档位控制方式、认证头也都不一样。
 * 混进同一个类只会让那边密集的坑位注释与实际分支对不上号。
 *
 * ── 路线选择（2026-08-28 真机实测 + 官方插件 SmileAI-S1.57 交叉验证）──
 *
 * 香蕉系（Gemini 图像模型）必须走 **Google 原生端点**：
 *     POST {BASE}/v1beta/models/{model}:generateContent
 * 走 OpenAI 风格的 /v1/images/generations 会稳定报 get_channel_failed
 *（8 个 Gemini 图像型号全军覆没），这不是渠道故障，是网关根本没在那条路上挂它们。
 * 官方插件同样把香蕉模型从 OpenAI 图像路径里单独分流出去（callBananaGenerateContentDirect）。
 *
 * gpt-image-2 相反：只在 OpenAI 图像端点可用，
 *     文生图 POST /v1/images/generations（JSON，返回 url）
 *     图生图 POST /v1/images/edits?model=xxx（multipart/form-data）
 *
 * ── 档位与比例（实测，两者独立生效）──
 *
 * 档位由**模型名后缀**决定，不是请求参数：
 *     gemini-3-pro-image-preview-1k / -2k / -4k
 * 实测 aspectRatio=1:1 时分别出 1024²、2048²、4096²。
 * 请求体里的 `imageConfig.imageSize` 固定填 '1K' 即可——它不控制计费档位，
 * 档位后缀才控制（官方插件在 bananaRequestSize 里也是这么处理的）。
 *
 * 比例由 `imageConfig.aspectRatio` **参数级精确控制**：
 *     1:1→1024x1024、16:9→1376x768、4:5→928x1152、9:16→768x1376（实测）。
 * 这是原生端点相对 chat 端点的关键优势：走 /v1/chat/completions 时比例只能靠
 * 提示词引导，同一模型会自行决定出 1024² 还是 1408x768，无法锁定。
 *
 * ── 认证 ──
 * 原生端点需要**同时**带 Authorization: Bearer 与 x-goog-api-key 两个头
 *（照官方插件的做法；只带其一未验证，不要凭猜省掉）。
 */

/** 本服务支持的模型 id。前缀 `smile-ai/` 用于与 OpenRouter 的同名模型区分通道。 */
export type SmileAiImageModel =
    | 'smile-ai/gemini-3-pro-image-preview'
    | 'smile-ai/gemini-3.1-flash-image-preview'
    | 'smile-ai/gpt-image-2';

const SUPPORTED_MODELS: SmileAiImageModel[] = [
    'smile-ai/gemini-3-pro-image-preview',
    'smile-ai/gemini-3.1-flash-image-preview',
    'smile-ai/gpt-image-2'
];

/** 香蕉系（走 Google 原生 generateContent）。gpt-image-2 不在此列。 */
const BANANA_MODELS: SmileAiImageModel[] = [
    'smile-ai/gemini-3-pro-image-preview',
    'smile-ai/gemini-3.1-flash-image-preview'
];

const DEFAULT_MODEL: SmileAiImageModel = 'smile-ai/gemini-3-pro-image-preview';

const BASE_URL = 'https://api.smile-ai-studio.com';
const IMAGE_GENERATIONS_PATH = '/v1/images/generations';
const IMAGE_EDITS_PATH = '/v1/images/edits';

/**
 * 网关支持的输出比例。
 *
 * 与 OpenRouter 侧保持同一份档位表：上游裁剪窗必须先吸附到某一档，
 * 否则结果贴回画布时要做非等比缩放，选区内容会和周围画面错位。
 */
export const SMILE_AI_IMAGE_ASPECT_RATIOS = [
    '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'
] as const;

export type SmileAiImageSize = '1K' | '2K' | '4K';

/**
 * 各档位的实测耗时（aspectRatio=1:1，gemini-3-pro-image-preview）：
 * 1K≈15.8s、2K≈28.3s、4K≈41.4s。超时按档位给，避免 4K 被 1K 的预算掐断。
 */
const TIMEOUT_BY_SIZE: Record<SmileAiImageSize, number> = {
    '1K': 120_000,
    '2K': 180_000,
    '4K': 300_000
};

/** 单次请求体上限的保守取值。内联图像会在发送前按总预算做无损降采样。 */
const MAX_REQUEST_BYTES = 40 * 1024 * 1024;
/** 4K PNG 以 base64 放进 JSON 后可能超过请求体大小，响应预算必须单独计算。 */
const MAX_RESPONSE_BYTES = 96 * 1024 * 1024;
/** 预留约 30% 给 base64 膨胀、prompt 和 JSON/multipart 边界。 */
const MAX_INLINE_IMAGE_BYTES = Math.floor(MAX_REQUEST_BYTES * 0.68);
const MIN_TIMEOUT_MS = 30_000;

export interface SmileAiImageProgressEvent {
    progress: number;
    stage:
        | 'provider-validate'
        | 'provider-submit'
        | 'provider-upload-progress'
        | 'provider-ready'
        | 'provider-download';
    message: string;
}

export type SmileAiImageProgressCallback = (event: SmileAiImageProgressEvent) => void;

export interface SmileAiImageResult {
    image: Buffer;
    model: SmileAiImageModel;
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    aspectRatio: string;
    /** 本次**请求**的档位。上游是否照做看 actualWidth/actualHeight，别把它当事实。 */
    imageSize: SmileAiImageSize;
    actualWidth: number;
    actualHeight: number;
    /** 上游输出与请求档位或比例不一致时的人话说明；一致时为 undefined。 */
    providerNotice?: string;
}

/** 图像源：已编码字节，或未编码 raw RGBA（UXP 直传形态，省一次编解码往返）。 */
export type SmileAiImageSource =
    | Buffer
    | { raw: Buffer; width: number; height: number; channels: 1 | 2 | 3 | 4 };

export interface SmileAiImageOptions {
    model?: SmileAiImageModel | string;
    timeoutMs?: number;
    referenceImages?: Buffer[];
    signal?: AbortSignal;
    aspectRatio?: string;
    imageSize?: SmileAiImageSize;
}

export interface SmileAiImageBatchOptions extends SmileAiImageOptions {
    count?: number;
}

interface PreparedSmileAiImageRequest {
    model: SmileAiImageModel;
    prompt: string;
    images: Buffer[];
    aspectRatio: string;
    imageSize: SmileAiImageSize;
    timeoutMs: number;
    signal?: AbortSignal;
}

type ServiceError = Error & {
    errorStage?: string;
    errorCode?: string;
    errorDetail?: string;
    provider?: 'smile-ai';
};

/** 各档位期望的输出长边；用于判断"请求了 4K 但上游没照做"。 */
const EXPECTED_LONG_EDGE: Record<SmileAiImageSize, number> = {
    '1K': 1024,
    '2K': 2048,
    '4K': 4096
};

function openSource(source: SmileAiImageSource): sharp.Sharp {
    if (Buffer.isBuffer(source)) {
        return sharp(source);
    }
    return sharp(source.raw, {
        raw: { width: source.width, height: source.height, channels: source.channels }
    });
}

function hasValidImageSource(source: SmileAiImageSource | undefined): boolean {
    if (Buffer.isBuffer(source)) return source.length > 0;
    if (!source || !Buffer.isBuffer(source.raw) || source.raw.length === 0) return false;
    const width = Number(source.width);
    const height = Number(source.height);
    const channels = Number(source.channels);
    const expectedBytes = width * height * channels;
    return Number.isSafeInteger(expectedBytes)
        && width > 0
        && height > 0
        && channels >= 1
        && channels <= 4
        && source.raw.length === expectedBytes;
}

export function isSmileAiImageModelId(model?: string): boolean {
    return SUPPORTED_MODELS.includes(String(model || '').trim() as SmileAiImageModel);
}

export class SmileAiImageService {
    private apiKey = '';

    setApiKey(apiKey?: string): void {
        this.apiKey = String(apiKey || '').trim();
    }

    hasApiKey(): boolean {
        return this.apiKey.length > 0;
    }

    /**
     * 图生图：源图 + 文字描述再生成。
     *
     * 不接受蒙版——香蕉系的原生端点没有蒙版通道。局部重绘请走 inpainting 链路，
     * 由上层把选区裁出来再送进来。
     */
    async generateFromImage(
        prompt: string,
        sourceImage: SmileAiImageSource,
        options?: SmileAiImageOptions,
        onProgress?: SmileAiImageProgressCallback
    ): Promise<SmileAiImageResult> {
        const prepared = await this.prepareFromImageRequest(prompt, sourceImage, options, onProgress);
        return this.executePreparedRequest(prepared, onProgress);
    }

    /**
     * 文生图：无源图，只有提示词。
     */
    async generateImage(
        prompt: string,
        options?: SmileAiImageOptions,
        onProgress?: SmileAiImageProgressCallback
    ): Promise<SmileAiImageResult> {
        const cleanPrompt = this.requirePromptAndCredentials(prompt);
        const model = this.normalizeModel(options?.model);
        const aspectRatio = this.normalizeAspectRatio(options?.aspectRatio) || '1:1';
        const imageSize = this.normalizeImageSize(options?.imageSize, '2K');
        const timeoutMs = this.resolveTimeoutMs(imageSize, options?.timeoutMs);
        const references = Array.isArray(options?.referenceImages)
            ? options!.referenceImages!.filter((buffer) => buffer instanceof Buffer && buffer.length > 0)
            : [];
        const images = await this.prepareInputImages(references, 'reference');

        onProgress?.({ progress: 40, stage: 'provider-submit', message: '正在请求生成' });

        const resolved = await this.requestImage({
            model,
            prompt: cleanPrompt,
            images,
            aspectRatio,
            imageSize,
            timeoutMs,
            signal: options?.signal,
            onProgress
        });

        return this.describeResult(resolved, model, aspectRatio, imageSize);
    }

    /**
     * 批量图生图。
     *
     * 网关的香蕉系一次调用只出一张（实测 responseModalities:["IMAGE"] 固定单图），
     * 所以这里是并发 N 次而不是请求多张——按次计费，N 张就是 N 次费用。
     * 失败的单张不拖垮整批，如实收进 failures 交给面板显示。
     */
    async generateBatchFromImage(
        prompt: string,
        sourceImage: SmileAiImageSource,
        options: SmileAiImageBatchOptions | undefined,
        onProgress?: SmileAiImageProgressCallback
    ): Promise<{ results: SmileAiImageResult[]; failures: Array<{ index: number; message: string }> }> {
        const requested = Number(options?.count);
        const count = Number.isFinite(requested) && requested > 1 ? Math.min(Math.floor(requested), 4) : 1;
        const prepared = await this.prepareFromImageRequest(prompt, sourceImage, options, onProgress);

        const settled = await Promise.allSettled(
            Array.from({ length: count }, (_unused, index) =>
                this.executePreparedRequest(
                    prepared,
                    // 只让第一路上报进度，避免 N 路进度互相覆盖导致进度条跳动
                    index === 0 ? onProgress : undefined
                )
            )
        );

        const results: SmileAiImageResult[] = [];
        const failures: Array<{ index: number; message: string }> = [];
        let firstFailure: unknown;
        settled.forEach((entry, index) => {
            if (entry.status === 'fulfilled') {
                results.push(entry.value);
                return;
            }
            firstFailure ??= entry.reason;
            failures.push({ index, message: entry.reason?.message || String(entry.reason) });
        });

        // 全部失败时保留第一条 Provider 错误的 stage/code/detail。把它压成“空结果”
        // 会让取消、鉴权与渠道故障全都失去可行动信息。
        if (results.length === 0 && firstFailure) {
            throw firstFailure;
        }

        return { results, failures };
    }

    // ────────────────────────── 内部实现 ──────────────────────────

    private requirePromptAndCredentials(prompt: string): string {
        if (!this.hasApiKey()) {
            throw this.createStageError('Smile AI Studio API Key 未配置', 'provider-validate');
        }
        const cleanPrompt = String(prompt || '').trim();
        if (!cleanPrompt) {
            throw this.createStageError('提示词不能为空', 'provider-validate');
        }
        return cleanPrompt;
    }

    private async prepareFromImageRequest(
        prompt: string,
        sourceImage: SmileAiImageSource,
        options?: SmileAiImageOptions,
        onProgress?: SmileAiImageProgressCallback
    ): Promise<PreparedSmileAiImageRequest> {
        const cleanPrompt = this.requirePromptAndCredentials(prompt);
        if (!hasValidImageSource(sourceImage)) {
            throw this.createStageError('源图像素数据无效或为空', 'provider-validate');
        }

        const model = this.normalizeModel(options?.model);
        onProgress?.({ progress: 20, stage: 'provider-validate', message: '正在准备生成请求' });

        let metadata: sharp.Metadata;
        try {
            metadata = await openSource(sourceImage).rotate().metadata();
        } catch (error: any) {
            throw this.createStageError(
                '源图无法读取，已在发送前停止',
                'provider-validate',
                error?.message || String(error),
                'invalid_source_image'
            );
        }
        const width = Math.max(1, metadata.width || 1024);
        const height = Math.max(1, metadata.height || 1024);
        const aspectRatio = this.resolveAspectRatio(options?.aspectRatio, width, height);
        const inferredSize = this.inferImageSize(width, height);
        const imageSize = this.normalizeImageSize(options?.imageSize, inferredSize);
        const timeoutMs = this.resolveTimeoutMs(imageSize, options?.timeoutMs);
        const references = Array.isArray(options?.referenceImages)
            ? options.referenceImages.filter((buffer) => Buffer.isBuffer(buffer) && buffer.length > 0)
            : [];
        const images = await this.prepareInputImages([sourceImage, ...references], 'source');

        return {
            model,
            prompt: cleanPrompt,
            images,
            aspectRatio,
            imageSize,
            timeoutMs,
            signal: options?.signal
        };
    }

    private async executePreparedRequest(
        prepared: PreparedSmileAiImageRequest,
        onProgress?: SmileAiImageProgressCallback
    ): Promise<SmileAiImageResult> {
        onProgress?.({ progress: 45, stage: 'provider-submit', message: '正在请求生成' });
        const resolved = await this.requestImage({ ...prepared, onProgress });
        return this.describeResult(
            resolved,
            prepared.model,
            prepared.aspectRatio,
            prepared.imageSize
        );
    }

    private normalizeModel(model?: string): SmileAiImageModel {
        const normalized = String(model || '').trim();
        if (!normalized) return DEFAULT_MODEL;
        if (SUPPORTED_MODELS.includes(normalized as SmileAiImageModel)) {
            return normalized as SmileAiImageModel;
        }
        throw this.createStageError(
            `不支持的 Smile AI 图像模型「${normalized}」，已停止请求，未自动替换模型`,
            'provider-validate',
            normalized,
            'unsupported_model'
        );
    }

    private isBananaModel(model: SmileAiImageModel): boolean {
        return BANANA_MODELS.includes(model);
    }

    /**
     * 内部 id → 网关真实模型名（含档位后缀）。
     *
     * 档位靠后缀而不是请求参数，是网关自己的设计（gemini-3-pro-image-preview-2k
     * 是一个独立的计费型号）。gpt-image-2 没有档位变体，尺寸走 OpenAI 的 size 参数。
     */
    private resolveUpstreamModelName(model: SmileAiImageModel, imageSize: SmileAiImageSize): string {
        const base = model.replace(/^smile-ai\//, '');
        if (!this.isBananaModel(model)) {
            return base;
        }
        return `${base}-${imageSize.toLowerCase()}`;
    }

    private normalizeAspectRatio(value?: string): string | undefined {
        const normalized = String(value || '').trim();
        if (!normalized || normalized === 'auto') return undefined;
        if ((SMILE_AI_IMAGE_ASPECT_RATIOS as readonly string[]).includes(normalized)) {
            return normalized;
        }
        throw this.createStageError(
            `Smile AI 不支持输出比例「${normalized}」`,
            'provider-validate',
            normalized,
            'unsupported_aspect_ratio'
        );
    }

    /** 用户显式指定优先；否则按源图实际长宽比吸附到最近的支持档位。 */
    private resolveAspectRatio(explicit: string | undefined, width: number, height: number): string {
        const chosen = this.normalizeAspectRatio(explicit);
        if (chosen) return chosen;

        const target = width / height;
        let best = '1:1';
        let bestDelta = Number.POSITIVE_INFINITY;
        for (const ratio of SMILE_AI_IMAGE_ASPECT_RATIOS) {
            const [w, h] = ratio.split(':').map(Number);
            const delta = Math.abs(w / h - target);
            if (delta < bestDelta) {
                bestDelta = delta;
                best = ratio;
            }
        }
        return best;
    }

    private inferImageSize(width: number, height: number): SmileAiImageSize {
        const longEdge = Math.max(width, height);
        if (longEdge > 3000) return '4K';
        if (longEdge > 1500) return '2K';
        return '1K';
    }

    private normalizeImageSize(
        value: SmileAiImageSize | undefined,
        fallback: SmileAiImageSize
    ): SmileAiImageSize {
        const normalized = String(value || '').trim().toUpperCase();
        if (!normalized) return fallback;
        if (normalized === '1K' || normalized === '2K' || normalized === '4K') {
            return normalized;
        }
        throw this.createStageError(
            `Smile AI 不支持分辨率档位「${normalized}」`,
            'provider-validate',
            normalized,
            'unsupported_image_size'
        );
    }

    private resolveTimeoutMs(imageSize: SmileAiImageSize, requestedMs?: number): number {
        if (Number.isFinite(requestedMs) && Number(requestedMs) > 0) {
            return Math.max(MIN_TIMEOUT_MS, Number(requestedMs));
        }
        return TIMEOUT_BY_SIZE[imageSize];
    }

    /**
     * 所有源图和参考图都先转成真实 PNG，再按整次请求预算做无损降采样。
     *
     * 旧实现把 JPEG/WebP 参考图的原始字节标成 image/png 发送；网关可能拒绝，也可能把图
     * 当损坏输入静默忽略。这里只改变像素尺寸，不用有损编码换通过率。
     */
    private async prepareInputImages(
        sources: SmileAiImageSource[],
        firstRole: 'source' | 'reference'
    ): Promise<Buffer[]> {
        if (sources.length === 0) return [];
        const perImageBudget = Math.max(
            256 * 1024,
            Math.floor(MAX_INLINE_IMAGE_BYTES / sources.length)
        );
        const prepared: Buffer[] = [];
        for (let index = 0; index < sources.length; index += 1) {
            const source = sources[index];
            try {
                prepared.push(await this.encodePngWithinBudget(source, perImageBudget));
            } catch (error: any) {
                if (error?.provider === 'smile-ai') throw error;
                const referenceIndex = firstRole === 'source' ? index : index + 1;
                const role = firstRole === 'source' && index === 0
                    ? '源图'
                    : `第 ${referenceIndex} 张参考图`;
                throw this.createStageError(
                    `${role}无法读取，已在发送前停止`,
                    'provider-validate',
                    error?.message || String(error),
                    'invalid_input_image'
                );
            }
        }
        return prepared;
    }

    private async encodePngWithinBudget(
        source: SmileAiImageSource,
        budgetBytes: number
    ): Promise<Buffer> {
        const metadata = await openSource(source).rotate().metadata();
        const originalWidth = Math.max(1, metadata.width || 1);
        const originalHeight = Math.max(1, metadata.height || 1);
        const originalPixels = originalWidth * originalHeight;
        const fullSizePng = await openSource(source)
            .rotate()
            .png({ compressionLevel: 6, adaptiveFiltering: true })
            .toBuffer();
        if (fullSizePng.length <= budgetBytes) return fullSizePng;

        let targetPixels = Math.floor(originalPixels * (budgetBytes / fullSizePng.length) * 0.88);
        for (let attempt = 0; attempt < 5; attempt += 1) {
            const scale = Math.sqrt(targetPixels / originalPixels);
            const width = Math.max(16, Math.round(originalWidth * Math.min(scale, 0.98)));
            const height = Math.max(16, Math.round(originalHeight * Math.min(scale, 0.98)));
            const resized = await openSource(source)
                .rotate()
                .resize(width, height, {
                    fit: 'inside',
                    kernel: 'lanczos3',
                    withoutEnlargement: true
                })
                .png({ compressionLevel: 6, adaptiveFiltering: true })
                .toBuffer();
            if (resized.length <= budgetBytes) {
                console.log(
                    `[SmileAI] 输入图无损降采样 ${originalWidth}×${originalHeight} → ${width}×${height}，`
                    + `${Math.round(resized.length / 1024)}KB`
                );
                return resized;
            }
            targetPixels = Math.max(
                16 * 16,
                Math.floor(targetPixels * (budgetBytes / resized.length) * 0.9)
            );
        }

        throw this.createStageError(
            `输入图无法压进 Smile AI 请求预算（原图 ${originalWidth}×${originalHeight}，`
            + `单图预算 ${Math.round(budgetBytes / 1024 / 1024)}MB）`,
            'provider-validate',
            undefined,
            'image_budget_exceeded'
        );
    }

    private async requestImage(input: {
        model: SmileAiImageModel;
        prompt: string;
        images: Buffer[];
        aspectRatio: string;
        imageSize: SmileAiImageSize;
        timeoutMs: number;
        signal?: AbortSignal;
        onProgress?: SmileAiImageProgressCallback;
    }): Promise<{ image: Buffer; mimeType: string }> {
        if (this.isBananaModel(input.model)) {
            return this.requestBananaGenerateContent(input);
        }
        return this.requestOpenAIImage(input);
    }

    /**
     * 香蕉系：Google 原生 generateContent。
     *
     * body 里的 imageConfig.imageSize 固定 '1K'——它不决定计费档位，档位在模型名后缀上。
     * 这一点如果反过来写（把 2K/4K 填进 imageSize、模型名不带后缀），实测出的是 1K 图，
     * 而账单按基础档走：既没拿到分辨率也说不清为什么。
     */
    private async requestBananaGenerateContent(input: {
        model: SmileAiImageModel;
        prompt: string;
        images: Buffer[];
        aspectRatio: string;
        imageSize: SmileAiImageSize;
        timeoutMs: number;
        signal?: AbortSignal;
        onProgress?: SmileAiImageProgressCallback;
    }): Promise<{ image: Buffer; mimeType: string }> {
        const upstreamModel = this.resolveUpstreamModelName(input.model, input.imageSize);
        const parts: Array<Record<string, unknown>> = [{ text: input.prompt }];

        let budget = MAX_REQUEST_BYTES;
        for (const image of input.images) {
            const encoded = image.toString('base64');
            budget -= encoded.length;
            if (budget < 0) {
                throw this.createStageError(
                    '请求体超出网关上限，请减少参考图数量或降低源图分辨率',
                    'provider-validate'
                );
            }
            parts.push({ inlineData: { mimeType: 'image/png', data: encoded } });
        }

        const body = {
            contents: [{ role: 'user', parts }],
            generationConfig: {
                responseModalities: ['IMAGE'],
                imageConfig: {
                    aspectRatio: input.aspectRatio,
                    // 固定 '1K'：真实档位由模型名后缀决定，见方法头注释。
                    imageSize: '1K'
                }
            }
        };

        const url = `${BASE_URL}/v1beta/models/${encodeURIComponent(upstreamModel)}:generateContent`;
        const response = await this.postJson(url, body, input.timeoutMs, input.signal, {
            // 原生端点要两个认证头都带，照官方插件的做法。
            'x-goog-api-key': this.apiKey
        });

        input.onProgress?.({ progress: 85, stage: 'provider-download', message: '正在接收生成结果' });

        const inline = this.findInlineImage(response);
        if (!inline) {
            throw this.createStageError(
                '网关返回成功但响应中没有图像数据',
                'provider-ready',
                JSON.stringify(response).slice(0, 400)
            );
        }
        return { image: Buffer.from(inline.data, 'base64'), mimeType: inline.mimeType || 'image/png' };
    }

    /**
     * gpt-image-2：OpenAI 图像端点。
     *
     * 有源图走 /v1/images/edits（multipart，model 同时放 query 与表单域——
     * 官方插件两处都带，照做）；无源图走 /v1/images/generations（JSON）。
     * 返回的是图片 URL 而不是 base64，要再取一次。
     */
    private async requestOpenAIImage(input: {
        model: SmileAiImageModel;
        prompt: string;
        images: Buffer[];
        aspectRatio: string;
        imageSize: SmileAiImageSize;
        timeoutMs: number;
        signal?: AbortSignal;
        onProgress?: SmileAiImageProgressCallback;
    }): Promise<{ image: Buffer; mimeType: string }> {
        const upstreamModel = this.resolveUpstreamModelName(input.model, input.imageSize);
        const size = this.resolveOpenAISize(input.aspectRatio);

        let payload: unknown;
        if (input.images.length > 0) {
            const form = new FormData();
            form.append('model', upstreamModel);
            form.append('model_name', upstreamModel);
            form.append('prompt', input.prompt);
            form.append('n', '1');
            form.append('size', size);
            input.images.forEach((image, index) => {
                const field = input.images.length > 1 ? 'image[]' : 'image';
                const name = index === 0 ? 'source.png' : `reference-${index + 1}.png`;
                form.append(field, new Blob([new Uint8Array(image)], { type: 'image/png' }), name);
            });
            payload = await this.postForm(
                `${BASE_URL}${IMAGE_EDITS_PATH}?model=${encodeURIComponent(upstreamModel)}`,
                form,
                input.timeoutMs,
                input.signal
            );
        } else {
            payload = await this.postJson(
                `${BASE_URL}${IMAGE_GENERATIONS_PATH}`,
                { model: upstreamModel, prompt: input.prompt, n: 1, size },
                input.timeoutMs,
                input.signal
            );
        }

        input.onProgress?.({ progress: 85, stage: 'provider-download', message: '正在下载生成结果' });

        const first = (payload as { data?: Array<{ b64_json?: string; url?: string }> })?.data?.[0];
        if (first?.b64_json) {
            return { image: Buffer.from(first.b64_json, 'base64'), mimeType: 'image/png' };
        }
        if (first?.url) {
            return this.downloadImage(first.url, input.timeoutMs, input.signal);
        }
        throw this.createStageError(
            '网关返回成功但响应中没有图像数据',
            'provider-ready',
            JSON.stringify(payload).slice(0, 400)
        );
    }

    /** OpenAI 图像端点只认像素尺寸，把比例档位映射过去。 */
    private resolveOpenAISize(aspectRatio: string): string {
        switch (aspectRatio) {
            case '16:9':
            case '3:2':
            case '4:3':
            case '5:4':
            case '21:9':
                return '1536x1024';
            case '9:16':
            case '2:3':
            case '3:4':
            case '4:5':
                return '1024x1536';
            default:
                return '1024x1024';
        }
    }

    private async postJson(
        url: string,
        body: unknown,
        timeoutMs: number,
        signal?: AbortSignal,
        extraHeaders?: Record<string, string>
    ): Promise<Record<string, unknown>> {
        try {
            const response = await axios.post(url, body, {
                timeout: timeoutMs,
                signal,
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this.apiKey}`,
                    ...(extraHeaders || {})
                },
                maxBodyLength: MAX_REQUEST_BYTES,
                maxContentLength: MAX_RESPONSE_BYTES,
                validateStatus: () => true,
                ...getAxiosProxyConfig()
            });
            return this.unwrapResponse(response.status, response.data);
        } catch (error: any) {
            throw this.wrapRequestError(error, signal, 'provider-submit');
        }
    }

    private async postForm(
        url: string,
        form: FormData,
        timeoutMs: number,
        signal?: AbortSignal
    ): Promise<Record<string, unknown>> {
        try {
            const response = await axios.post(url, form, {
                timeout: timeoutMs,
                signal,
                headers: { Authorization: `Bearer ${this.apiKey}` },
                maxBodyLength: MAX_REQUEST_BYTES,
                maxContentLength: MAX_RESPONSE_BYTES,
                validateStatus: () => true,
                ...getAxiosProxyConfig()
            });
            return this.unwrapResponse(response.status, response.data);
        } catch (error: any) {
            throw this.wrapRequestError(error, signal, 'provider-submit');
        }
    }

    private async downloadImage(
        rawUrl: string,
        timeoutMs: number,
        signal?: AbortSignal
    ): Promise<{ image: Buffer; mimeType: string }> {
        let url: URL;
        try {
            url = new URL(String(rawUrl || '').trim());
        } catch {
            throw this.createStageError(
                '网关返回了无效的结果图地址',
                'provider-ready',
                String(rawUrl || '').slice(0, 200),
                'invalid_result_url'
            );
        }
        if (url.protocol !== 'https:') {
            throw this.createStageError(
                '网关返回的结果图地址不是 HTTPS，已拒绝下载',
                'provider-ready',
                url.protocol,
                'unsafe_result_url'
            );
        }

        try {
            const response = await axios.get<ArrayBuffer>(url.toString(), {
                responseType: 'arraybuffer',
                timeout: timeoutMs,
                signal,
                maxContentLength: MAX_RESPONSE_BYTES,
                validateStatus: () => true,
                ...getAxiosProxyConfig()
            });
            if (response.status < 200 || response.status >= 300) {
                throw this.createStageError(
                    `Smile AI 结果图下载失败（HTTP ${response.status}）`,
                    'provider-download',
                    undefined,
                    String(response.status)
                );
            }
            const contentType = String(response.headers?.['content-type'] || '').split(';')[0].trim();
            if (contentType && !contentType.startsWith('image/')) {
                throw this.createStageError(
                    'Smile AI 结果地址没有返回图片内容',
                    'provider-download',
                    contentType,
                    'unexpected_content_type'
                );
            }
            return {
                image: Buffer.from(response.data),
                mimeType: contentType || 'image/png'
            };
        } catch (error: any) {
            throw this.wrapRequestError(error, signal, 'provider-download');
        }
    }

    private wrapRequestError(
        error: any,
        signal: AbortSignal | undefined,
        stage: 'provider-submit' | 'provider-download'
    ): ServiceError {
        if (error?.provider === 'smile-ai') return error as ServiceError;
        if (signal?.aborted || error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError') {
            return this.createStageError('已停止本次生成', 'provider-canceled', undefined, 'canceled');
        }
        const detail = String(
            error?.response?.data?.error?.message
            || error?.response?.data?.message
            || error?.message
            || 'network request failed'
        ).trim();
        const code = String(error?.code || error?.response?.status || '').trim() || undefined;
        if (code === 'ECONNABORTED' || /timeout/i.test(detail)) {
            return this.createStageError(
                'Smile AI Studio 等待超时，当前请求已停止',
                stage,
                detail,
                code || 'timeout'
            );
        }
        return this.createStageError(
            stage === 'provider-download'
                ? 'Smile AI Studio 结果图下载失败'
                : '无法连接 Smile AI Studio',
            stage,
            detail,
            code
        );
    }

    /**
     * 把网关错误翻成用户能行动的中文。
     *
     * 三类实测过的错误必须分开说，因为处置方式完全不同：
     * - get_channel_failed：该模型在当前 Key 的分组下没有可用渠道，要去网关控制台改分组，
     *   重试无用（实测重试 4 次稳定复现）。
     * - 余额/额度不足：充值即可。
     * - Deadlock/超时/5xx：网关侧瞬时故障，重试有意义。
     */
    private unwrapResponse(status: number, data: unknown): Record<string, unknown> {
        if (status >= 200 && status < 300) {
            return (data || {}) as Record<string, unknown>;
        }

        const raw = typeof data === 'string' ? data : JSON.stringify(data || {});
        const detail = (data as { error?: { message?: string; code?: string } })?.error;
        const message = String(detail?.message || raw || '').slice(0, 500);
        const code = String(detail?.code || '');

        if (status === 401 || /invalid token/i.test(message)) {
            throw this.createStageError(
                'Smile AI Studio API Key 无效或已过期，请在设置中更新',
                'provider-validate',
                message,
                code || String(status)
            );
        }
        if (/get_channel_failed|可用渠道不存在/i.test(`${code} ${message}`)) {
            throw this.createStageError(
                '当前 Key 的分组下没有该模型的可用渠道。请在网关控制台把该 Key 切换到支持此模型的分组，重试无法解决',
                'provider-submit',
                message,
                code || 'get_channel_failed'
            );
        }
        if (/quota|余额|额度不足/i.test(`${code} ${message}`)) {
            throw this.createStageError(
                'Smile AI Studio 账户余额不足，请充值后重试',
                'provider-submit',
                message,
                code || 'insufficient_quota'
            );
        }
        if (/deadlock/i.test(message)) {
            throw this.createStageError(
                '网关侧数据库繁忙（deadlock），稍后重试即可',
                'provider-submit',
                message,
                code || 'deadlock'
            );
        }
        throw this.createStageError(
            `Smile AI Studio 请求失败（HTTP ${status}）`,
            'provider-submit',
            message,
            code || String(status)
        );
    }

    /** 在 Gemini 原生响应里递归找 inlineData——不同版本嵌套层级不一致，按结构找比按路径找稳。 */
    private findInlineImage(node: unknown): { mimeType: string; data: string } | null {
        if (!node || typeof node !== 'object') return null;
        const record = node as Record<string, any>;
        if (record.inlineData?.data) {
            return {
                mimeType: String(record.inlineData.mimeType || 'image/png'),
                data: String(record.inlineData.data)
            };
        }
        if (record.inline_data?.data) {
            return {
                mimeType: String(record.inline_data.mime_type || record.inline_data.mimeType || 'image/png'),
                data: String(record.inline_data.data)
            };
        }
        for (const key of Object.keys(record)) {
            const found = this.findInlineImage(record[key]);
            if (found) return found;
        }
        return null;
    }

    private async describeResult(
        resolved: { image: Buffer; mimeType: string },
        model: SmileAiImageModel,
        aspectRatio: string,
        imageSize: SmileAiImageSize
    ): Promise<SmileAiImageResult> {
        let metadata: sharp.Metadata;
        try {
            metadata = await sharp(resolved.image).metadata();
        } catch (error: any) {
            throw this.createStageError(
                'Smile AI Studio 返回的内容不是可读取的图片',
                'provider-ready',
                error?.message || String(error),
                'invalid_image_payload'
            );
        }
        const actualWidth = Math.max(0, metadata.width || 0);
        const actualHeight = Math.max(0, metadata.height || 0);
        if (actualWidth === 0 || actualHeight === 0) {
            throw this.createStageError(
                'Smile AI Studio 返回的图片缺少有效尺寸',
                'provider-ready',
                `${actualWidth}x${actualHeight}`,
                'invalid_image_dimensions'
            );
        }

        const longEdge = Math.max(actualWidth, actualHeight);
        const expected = EXPECTED_LONG_EDGE[imageSize];
        const notices: string[] = [];
        // gpt-image-2 没有 1K/2K/4K 档位，不能把 UI 的单一占位档误报成上游降级。
        if (this.isBananaModel(model) && longEdge < expected * 0.75) {
            notices.push(
                `请求 ${imageSize} 档，实际输出 ${actualWidth}×${actualHeight}，上游未按档位出图`
            );
        }

        const [ratioWidth, ratioHeight] = aspectRatio.split(':').map(Number);
        const expectedRatio = ratioWidth / ratioHeight;
        const actualRatio = actualWidth / actualHeight;
        if (
            Number.isFinite(expectedRatio)
            && expectedRatio > 0
            && Math.abs(actualRatio - expectedRatio) / expectedRatio > 0.08
        ) {
            notices.push(
                `请求比例 ${aspectRatio}，实际输出约为 ${actualWidth}:${actualHeight}，置入前请复核裁切`
            );
        }

        let mimeType: SmileAiImageResult['mimeType'];
        switch (String(metadata.format || '').toLowerCase()) {
            case 'jpeg':
            case 'jpg':
                mimeType = 'image/jpeg';
                break;
            case 'webp':
                mimeType = 'image/webp';
                break;
            default:
                mimeType = 'image/png';
                break;
        }

        return {
            image: resolved.image,
            model,
            mimeType,
            aspectRatio,
            imageSize,
            actualWidth,
            actualHeight,
            providerNotice: notices.length > 0 ? notices.join('；') : undefined
        };
    }

    private createStageError(
        message: string,
        stage: string,
        detail?: string,
        code?: string
    ): ServiceError {
        const error = new Error(message) as ServiceError;
        error.errorStage = stage;
        error.provider = 'smile-ai';
        if (code) error.errorCode = code;
        if (detail) error.errorDetail = detail;
        return error;
    }
}

export const smileAiImageService = new SmileAiImageService();
