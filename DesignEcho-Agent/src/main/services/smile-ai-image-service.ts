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

/** 单次请求体上限的保守取值；超过时降低源图编码质量而不是直接失败。 */
const MAX_REQUEST_BYTES = 40 * 1024 * 1024;

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
    /** 实际分辨率明显低于所请求档位时的人话说明；档位如实生效时为 undefined */
    sizeDowngradeNotice?: string;
}

/** 图像源：已编码字节，或未编码 raw RGBA（UXP 直传形态，省一次编解码往返）。 */
export type SmileAiImageSource =
    | Buffer
    | { raw: Buffer; width: number; height: number; channels: 1 | 2 | 3 | 4 };

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
        options?: {
            model?: SmileAiImageModel | string;
            timeoutMs?: number;
            referenceImages?: Buffer[];
            signal?: AbortSignal;
            aspectRatio?: string;
            imageSize?: SmileAiImageSize;
        },
        onProgress?: SmileAiImageProgressCallback
    ): Promise<SmileAiImageResult> {
        if (!this.hasApiKey()) {
            throw this.createStageError('Smile AI Studio API Key 未配置', 'provider-validate');
        }

        const cleanPrompt = String(prompt || '').trim();
        if (!cleanPrompt) {
            throw this.createStageError('提示词不能为空', 'provider-validate');
        }

        const model = this.normalizeModel(options?.model);

        onProgress?.({ progress: 20, stage: 'provider-validate', message: '正在准备生成请求' });

        const image = openSource(sourceImage);
        const metadata = await image.metadata();
        const width = Math.max(1, metadata.width || 1024);
        const height = Math.max(1, metadata.height || 1024);

        const aspectRatio = this.resolveAspectRatio(options?.aspectRatio, width, height);
        const imageSize = options?.imageSize || this.inferImageSize(width, height);
        const timeoutMs = options?.timeoutMs || TIMEOUT_BY_SIZE[imageSize];

        const sourcePng = await image.png().toBuffer();
        const references = Array.isArray(options?.referenceImages)
            ? options!.referenceImages!.filter((buffer) => buffer instanceof Buffer && buffer.length > 0)
            : [];

        onProgress?.({ progress: 45, stage: 'provider-submit', message: '正在请求生成' });

        const resolved = await this.requestImage({
            model,
            prompt: cleanPrompt,
            images: [sourcePng, ...references],
            aspectRatio,
            imageSize,
            timeoutMs,
            signal: options?.signal,
            onProgress
        });

        return this.describeResult(resolved, model, aspectRatio, imageSize);
    }

    /**
     * 文生图：无源图，只有提示词。
     */
    async generateImage(
        prompt: string,
        options?: {
            model?: SmileAiImageModel | string;
            timeoutMs?: number;
            referenceImages?: Buffer[];
            signal?: AbortSignal;
            aspectRatio?: string;
            imageSize?: SmileAiImageSize;
        },
        onProgress?: SmileAiImageProgressCallback
    ): Promise<SmileAiImageResult> {
        if (!this.hasApiKey()) {
            throw this.createStageError('Smile AI Studio API Key 未配置', 'provider-validate');
        }

        const cleanPrompt = String(prompt || '').trim();
        if (!cleanPrompt) {
            throw this.createStageError('提示词不能为空', 'provider-validate');
        }

        const model = this.normalizeModel(options?.model);
        const aspectRatio = this.normalizeAspectRatio(options?.aspectRatio) || '1:1';
        const imageSize = options?.imageSize || '2K';
        const timeoutMs = options?.timeoutMs || TIMEOUT_BY_SIZE[imageSize];

        const references = Array.isArray(options?.referenceImages)
            ? options!.referenceImages!.filter((buffer) => buffer instanceof Buffer && buffer.length > 0)
            : [];

        onProgress?.({ progress: 40, stage: 'provider-submit', message: '正在请求生成' });

        const resolved = await this.requestImage({
            model,
            prompt: cleanPrompt,
            images: references,
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
        options: {
            model?: SmileAiImageModel | string;
            count?: number;
            timeoutMs?: number;
            referenceImages?: Buffer[];
            signal?: AbortSignal;
            aspectRatio?: string;
            imageSize?: SmileAiImageSize;
        } | undefined,
        onProgress?: SmileAiImageProgressCallback
    ): Promise<{ results: SmileAiImageResult[]; failures: Array<{ index: number; message: string }> }> {
        const requested = Number(options?.count);
        const count = Number.isFinite(requested) && requested > 1 ? Math.min(Math.floor(requested), 4) : 1;

        if (count === 1) {
            const single = await this.generateFromImage(prompt, sourceImage, options, onProgress);
            return { results: [single], failures: [] };
        }

        // 源图只编码一次，N 个请求共用——避免把 4K 源图重复编 N 遍。
        const prepared = await openSource(sourceImage).png().toBuffer();

        const settled = await Promise.allSettled(
            Array.from({ length: count }, (_unused, index) =>
                this.generateFromImage(
                    prompt,
                    prepared,
                    options,
                    // 只让第一路上报进度，避免 N 路进度互相覆盖导致进度条跳动
                    index === 0 ? onProgress : undefined
                )
            )
        );

        const results: SmileAiImageResult[] = [];
        const failures: Array<{ index: number; message: string }> = [];
        settled.forEach((entry, index) => {
            if (entry.status === 'fulfilled') {
                results.push(entry.value);
                return;
            }
            failures.push({ index, message: entry.reason?.message || String(entry.reason) });
        });

        return { results, failures };
    }

    // ────────────────────────── 内部实现 ──────────────────────────

    private normalizeModel(model?: string): SmileAiImageModel {
        const normalized = String(model || '').trim();
        if (SUPPORTED_MODELS.includes(normalized as SmileAiImageModel)) {
            return normalized as SmileAiImageModel;
        }
        return DEFAULT_MODEL;
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
        return (SMILE_AI_IMAGE_ASPECT_RATIOS as readonly string[]).includes(normalized)
            ? normalized
            : undefined;
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
            const download = await axios.get<ArrayBuffer>(first.url, {
                responseType: 'arraybuffer',
                timeout: input.timeoutMs,
                ...getAxiosProxyConfig()
            });
            return { image: Buffer.from(download.data), mimeType: 'image/png' };
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
        const response = await axios.post(url, body, {
            timeout: timeoutMs,
            signal,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.apiKey}`,
                ...(extraHeaders || {})
            },
            maxBodyLength: MAX_REQUEST_BYTES,
            maxContentLength: MAX_REQUEST_BYTES,
            validateStatus: () => true,
            ...getAxiosProxyConfig()
        });
        return this.unwrapResponse(response.status, response.data);
    }

    private async postForm(
        url: string,
        form: FormData,
        timeoutMs: number,
        signal?: AbortSignal
    ): Promise<Record<string, unknown>> {
        const response = await axios.post(url, form, {
            timeout: timeoutMs,
            signal,
            headers: { Authorization: `Bearer ${this.apiKey}` },
            maxBodyLength: MAX_REQUEST_BYTES,
            maxContentLength: MAX_REQUEST_BYTES,
            validateStatus: () => true,
            ...getAxiosProxyConfig()
        });
        return this.unwrapResponse(response.status, response.data);
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
                message
            );
        }
        if (/get_channel_failed|可用渠道不存在/i.test(`${code} ${message}`)) {
            throw this.createStageError(
                '当前 Key 的分组下没有该模型的可用渠道。请在网关控制台把该 Key 切换到支持此模型的分组，重试无法解决',
                'provider-submit',
                message
            );
        }
        if (/quota|余额|额度不足/i.test(`${code} ${message}`)) {
            throw this.createStageError('Smile AI Studio 账户余额不足，请充值后重试', 'provider-submit', message);
        }
        if (/deadlock/i.test(message)) {
            throw this.createStageError(
                '网关侧数据库繁忙（deadlock），稍后重试即可',
                'provider-submit',
                message
            );
        }
        throw this.createStageError(
            `Smile AI Studio 请求失败（HTTP ${status}）`,
            'provider-submit',
            message
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
        const metadata = await sharp(resolved.image).metadata();
        const actualWidth = metadata.width || 0;
        const actualHeight = metadata.height || 0;
        const longEdge = Math.max(actualWidth, actualHeight);
        const expected = EXPECTED_LONG_EDGE[imageSize];

        // 0.75 倍的放宽，避免不同比例下的正常尺寸差异被误报成降级
        const sizeDowngradeNotice = longEdge > 0 && longEdge < expected * 0.75
            ? `请求 ${imageSize} 档，实际输出 ${actualWidth}×${actualHeight}，上游未按档位出图`
            : undefined;

        const mimeType = resolved.mimeType === 'image/jpeg' || resolved.mimeType === 'image/webp'
            ? resolved.mimeType
            : 'image/png';

        return {
            image: resolved.image,
            model,
            mimeType,
            aspectRatio,
            imageSize,
            actualWidth,
            actualHeight,
            sizeDowngradeNotice
        };
    }

    private createStageError(message: string, stage: string, detail?: string): ServiceError {
        const error = new Error(message) as ServiceError;
        error.errorStage = stage;
        error.provider = 'smile-ai';
        if (detail) error.errorDetail = detail;
        return error;
    }
}

export const smileAiImageService = new SmileAiImageService();
