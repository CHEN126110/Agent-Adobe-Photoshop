import axios from 'axios';
import { getAxiosProxyConfig } from './network-proxy';
import sharp from 'sharp';

export type SeedreamModel =
    | 'doubao-seedream-5-0-pro-260628'
    | 'doubao-seedream-5-0-260128'
    | 'doubao-seedream-5-0-lite-260128'
    | 'doubao-seedream-4-5-251128'
    | 'doubao-seedream-4-0-250828';

export type SeedreamSizePreset = '1K' | '1.5K' | '2K' | '3K' | '4K';

/**
 * 组图上限的全局硬约束：输入参考图数量 + 最终生成图片数量 ≤ 15。
 * 依据：火山方舟《图片生成 API》sequential_image_generation_options.max_images 说明。
 */
const SEEDREAM_SEQUENTIAL_TOTAL_LIMIT = 15;

/**
 * 并发拼多张时的在飞请求上限。
 *
 * 不支持组图的模型（5.0 / 5.0 pro）靠并发多次单图请求凑够张数。这里用窗口而不是
 * 全量并发：provider 对图片生成有并发与 QPS 限制，一次全开容易集体 429，
 * 结果比串行还慢。3 是兼顾吞吐与稳妥的默认值。
 */
const SEEDREAM_PARALLEL_REQUEST_LIMIT = 3;

/** 单张请求撞上限流后的重试次数（指数退避），非限流错误不重试。 */
const SEEDREAM_RATE_LIMIT_RETRIES = 2;

/** 并发拼图时的张数上限：与组图路径保持同一口径，避免两条路径给出不同的能力承诺。 */
const SEEDREAM_PARALLEL_TOTAL_LIMIT = 9;

// 火山方舟 Seedream 图生图输入限制（基于 2026 官方文档 + DMX 镜像）
const SEEDREAM_INPUT_LIMITS = {
    // 上游硬限 10 MiB；本地预留 0.5 MiB 余量给 multipart/form-data 包头与 JSON 字段
    maxFileBytes: 10 * 1024 * 1024,
    softFileBytes: Math.floor(9.5 * 1024 * 1024),
    maxTotalPixels: 6000 * 6000,
    minEdgePx: 15,
    minAspectRatio: 1 / 16,
    maxAspectRatio: 16
} as const;

// Seedream 5.0 本身参考图限制偏保守（10 张），5.0 lite / 4.5 / 4.0 放宽到 14 张
const SEEDREAM_REFERENCE_LIMIT: Record<SeedreamModel, number> = {
    'doubao-seedream-5-0-pro-260628': 10,
    'doubao-seedream-5-0-260128': 10,
    'doubao-seedream-5-0-lite-260128': 14,
    'doubao-seedream-4-5-251128': 14,
    'doubao-seedream-4-0-250828': 14
};

// 入图 mime 白名单：jpeg/png 全部接受；webp/bmp/tiff/gif 仅 5.0-lite/4.5/4.0
const SEEDREAM_BASE_MIME_WHITELIST: ReadonlyArray<string> = ['image/jpeg', 'image/jpg', 'image/png'];
const SEEDREAM_EXTRA_MIME_WHITELIST: ReadonlyArray<string> = [
    'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/bmp', 'image/tiff', 'image/gif'
];

function getAllowedMimeForModel(model: SeedreamModel): ReadonlyArray<string> {
    return model === 'doubao-seedream-5-0-260128' || model === 'doubao-seedream-5-0-pro-260628'
        ? SEEDREAM_BASE_MIME_WHITELIST
        : SEEDREAM_EXTRA_MIME_WHITELIST;
}

const BASE64_CHAR_REGEX = /^[A-Za-z0-9+/]*={0,2}$/;
const DATA_URL_REGEX = /^data:([^;]+);base64,(.+)$/i;

export interface SeedreamGenerateProgressEvent {
    progress: number;
    stage:
        | 'provider-validate'
        | 'provider-submit'
        | 'provider-waiting'
        | 'provider-ready'
        | 'provider-download';
    message: string;
}

export type SeedreamGenerateProgressCallback = (event: SeedreamGenerateProgressEvent) => void;

type SeedreamResponseFormat = 'b64_json' | 'url';

/** 单张生成结果。组图场景下 data[] 的每个元素对应一张图或一次失败。 */
export interface SeedreamGeneratedImage {
    image: Buffer;
    /** provider 回报的实际宽高，格式 `<宽>x<高>`；provider 未回报时为 undefined。 */
    size?: string;
}

/** 组图中单张失败的记录。审核不通过时后续图仍会继续生成，所以失败不等于整单失败。 */
export interface SeedreamImageFailure {
    index: number;
    code?: string;
    message: string;
}

export interface SeedreamGenerateResult {
    /** 至少一张；一张都没成功时直接抛错而不是返回空数组。 */
    images: SeedreamGeneratedImage[];
    model: SeedreamModel;
    /** 本次实际下发的 size 值：档位（如 `2K`）或像素（如 `2048x1024`）。 */
    sizeSpec: string;
    /** 组图中失败的分项；全部成功时为空数组。 */
    failures: SeedreamImageFailure[];
    requestId?: string;
}

type SeedreamGenerationResponse = {
    created?: number;
    request_id?: string;
    data?: Array<{
        b64_json?: string;
        url?: string;
        size?: string;
        error?: {
            code?: string | number;
            message?: string;
        };
    }>;
    error?: {
        message?: string;
        type?: string;
        code?: string | number;
    };
};

const SEEDREAM_API_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
const DEFAULT_MODEL: SeedreamModel = 'doubao-seedream-5-0-260128';

/**
 * 各模型的尺寸与组图能力。
 *
 * 数据来源：火山方舟《图片生成 API》官方文档（2026-08-01 版）。
 * 官方对 size 明确规定「分辨率档位」与「宽高像素值」两种方式**不可混用**，
 * 且各模型的总像素区间不同——lite / 4.5 的像素下限（368 万）远高于 pro（92 万），
 * 所以同一组比例像素值不能跨模型通用，必须按模型各自校验。
 *
 * minTotalPixels / maxTotalPixels 仅约束「宽×高的乘积」，不约束单边长度。
 */
const SEEDREAM_MODEL_CAPABILITIES: Record<
    SeedreamModel,
    {
        defaultSize: SeedreamSizePreset;
        supportedSizes: SeedreamSizePreset[];
        supportsOutputFormat: boolean;
        /** 像素模式（宽x高）的总像素下限 */
        minTotalPixels: number;
        /** 像素模式（宽x高）的总像素上限 */
        maxTotalPixels: number;
        /** 是否支持组图（sequential_image_generation=auto）。官方仅 lite / 4.5 / 4.0 支持。 */
        supportsSequential: boolean;
    }
> = {
    // Pro（260628）：档位 1K / 1.5K / 2K；不支持组图，一次只能出一张。
    'doubao-seedream-5-0-pro-260628': {
        defaultSize: '2K',
        supportedSizes: ['1K', '1.5K', '2K'],
        supportsOutputFormat: true,
        minTotalPixels: 1280 * 720,          // 921600
        maxTotalPixels: 4624220,             // 2048x2048x1.1025
        supportsSequential: false
    },
    // 该 ID 未出现在官方《图片生成 API》的模型列表中（文档只列 5.0 pro / 5.0 lite / 4.5 / 4.0）。
    // 能力按最保守取值：沿用既有档位，像素区间取 lite 同档，组图一律不声明——
    // 宁可少给能力，也不虚报一个官方没背书的参数组合。
    'doubao-seedream-5-0-260128': {
        defaultSize: '2K',
        supportedSizes: ['2K', '3K'],
        supportsOutputFormat: true,
        minTotalPixels: 2560 * 1440,         // 3686400
        maxTotalPixels: 4096 * 4096,         // 16777216
        supportsSequential: false
    },
    'doubao-seedream-5-0-lite-260128': {
        defaultSize: '2K',
        supportedSizes: ['2K', '3K', '4K'],
        supportsOutputFormat: true,
        minTotalPixels: 2560 * 1440,
        maxTotalPixels: 4096 * 4096,
        supportsSequential: true
    },
    'doubao-seedream-4-5-251128': {
        defaultSize: '2K',
        supportedSizes: ['2K', '4K'],
        supportsOutputFormat: false,
        minTotalPixels: 2560 * 1440,
        maxTotalPixels: 4096 * 4096,
        supportsSequential: true
    },
    'doubao-seedream-4-0-250828': {
        defaultSize: '2K',
        supportedSizes: ['1K', '2K', '4K'],
        supportsOutputFormat: false,
        minTotalPixels: 1280 * 720,
        maxTotalPixels: 4096 * 4096,
        supportsSequential: true
    }
};

export function getSeedreamModelCapabilities(model: SeedreamModel) {
    return SEEDREAM_MODEL_CAPABILITIES[model];
}

export class VolcengineSeedreamService {
    private apiKey = '';

    setApiKey(apiKey?: string): void {
        this.apiKey = String(apiKey || '').trim();
    }

    hasApiKey(): boolean {
        return this.apiKey.length > 0;
    }

    async testApiKey(apiKey?: string): Promise<{ success: boolean; message?: string; error?: string; status?: number }> {
        const keyToTest = String(apiKey ?? this.apiKey ?? '').trim();
        if (!keyToTest) {
            return { success: false, error: '请先输入 Ark API Key' };
        }

        try {
            const response = await axios.post<SeedreamGenerationResponse>(
                `${SEEDREAM_API_BASE_URL}/images/generations`,
                {
                    model: DEFAULT_MODEL,
                    prompt: 'connectivity test',
                    image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0eQAAAAASUVORK5CYII=',
                    response_format: 'url',
                    output_format: 'png',
                    size: 'TEST',
                    watermark: false
                },
                {
                    timeout: 20_000,
                    validateStatus: () => true,
                    ...getAxiosProxyConfig(),
                    headers: {
                        Authorization: `Bearer ${keyToTest}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            if (response.status === 401 || response.status === 403) {
                return {
                    success: false,
                    status: response.status,
                    error: '当前 Ark API Key 无效、无权限，或对应账号未开通 Seedream 模型权限。当前服务地域：华北 2（北京）。'
                };
            }

            if (response.status >= 200 && response.status < 300) {
                return { success: true, status: response.status, message: '连接成功，Ark API Key 可用。' };
            }

            if (response.status === 400 || response.status === 422) {
                return {
                    success: true,
                    status: response.status,
                    message: '连通性正常，Ark 鉴权已通过。'
                };
            }

            const providerMessage = String(response.data?.error?.message || '').trim();
            return {
                success: false,
                status: response.status,
                error: providerMessage || `Ark 连通性测试失败 (${response.status})`
            };
        } catch (error: any) {
            return { success: false, error: error?.message || '网络连接失败' };
        }
    }

    async generateFromImage(
        prompt: string,
        imageDataUrl: string,
        options?: {
            model?: SeedreamModel;
            sizePreset?: SeedreamSizePreset | string;
            /**
             * 像素模式尺寸，格式 `<宽>x<高>`（如 `2048x1024`）。
             * 与 sizePreset 互斥——官方规定两种方式不可混用；同时传入时以本字段为准。
             */
            size?: string;
            /**
             * 本次最多生成几张（组图上限，不是精确张数——模型会自主判断实际返回数量）。
             * 省略或 ≤1 时走单图模式（sequential_image_generation=disabled）。
             */
            maxImages?: number;
            referenceImages?: string[];
            timeoutMs?: number;
        },
        onProgress?: SeedreamGenerateProgressCallback
    ): Promise<SeedreamGenerateResult> {
        if (!this.hasApiKey()) {
            throw new Error('Volcengine Seedream API Key is not configured');
        }

        const cleanPrompt = String(prompt || '').trim();
        if (!cleanPrompt) {
            throw new Error('Prompt is required');
        }

        const cleanImage = String(imageDataUrl || '').trim();
        if (!cleanImage) {
            throw new Error('Source image is required');
        }

        const model = this.normalizeModel(options?.model);
        const capabilities = SEEDREAM_MODEL_CAPABILITIES[model];
        // 像素模式优先：显式给了宽高就按宽高走，否则回落到档位。两者不可混用（官方约束）。
        const sizeSpec = options?.size
            ? this.resolveExplicitSize(model, options.size)
            : this.resolveSizePreset(model, options?.sizePreset);

        const referenceLimit = SEEDREAM_REFERENCE_LIMIT[model] ?? 10;
        const rawReferenceImages = Array.isArray(options?.referenceImages)
            ? options!.referenceImages
                .map((item) => String(item || '').trim())
                .filter(Boolean)
            : [];
        if (rawReferenceImages.length > referenceLimit) {
            throw new Error(
                `参考图数量超限：${model} 最多支持 ${referenceLimit} 张，当前传入 ${rawReferenceImages.length} 张`
            );
        }

        // 主图 + 参考图分别做严格校验（base64 合法性 / 解码 / 像素 / 宽高比 / 字节大小 / mime 白名单）
        const preparedSource = await this.prepareImageInput(cleanImage, model, 'source');
        const preparedReferences = await Promise.all(
            rawReferenceImages.map((item, idx) =>
                this.prepareImageInput(item, model, `reference-${idx + 1}`)
            )
        );

        const imagePayload = preparedReferences.length > 0
            ? [preparedSource.dataUrl, ...preparedReferences.map((ref) => ref.dataUrl)]
            : preparedSource.dataUrl;
        const responseFormat = this.resolveResponseFormat();
        // 参考图会占用 15 张的总额度：输入参考图数 + 生成数 ≤ 15。
        // 这里把「源图 + 参考图」都算进已占用额度，避免下发一个 provider 必然截断的上限。
        const consumedByInputs = 1 + preparedReferences.length;
        const maxImages = this.resolveMaxImages(model, options?.maxImages, consumedByInputs);
        const requestBody: Record<string, unknown> = {
            model,
            prompt: cleanPrompt,
            image: imagePayload,
            response_format: responseFormat,
            size: sizeSpec,
            watermark: false
        };
        if (capabilities?.supportsOutputFormat) {
            requestBody.output_format = 'png';
        }
        if (maxImages > 1) {
            // auto 是「模型自主判断是否出组图以及出几张」，max_images 只是上限而非精确张数。
            requestBody.sequential_image_generation = 'auto';
            requestBody.sequential_image_generation_options = { max_images: maxImages };
        }

        onProgress?.({
            progress: 12,
            stage: 'provider-validate',
            message: 'Validating Seedream request'
        });

        onProgress?.({
            progress: 30,
            stage: 'provider-submit',
            message: 'Submitting image edit request to Seedream'
        });

        const response = await axios.post<SeedreamGenerationResponse>(
            `${SEEDREAM_API_BASE_URL}/images/generations`,
            requestBody,
            {
                timeout: Math.max(30_000, options?.timeoutMs || 5 * 60 * 1000),
                validateStatus: () => true,
                ...getAxiosProxyConfig(),
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const payload = response.data;
        if (response.status >= 400 || payload?.error) {
            const providerMessage =
                payload?.error?.message ||
                (typeof payload === 'string' ? payload : '') ||
                `HTTP ${response.status}`;
            const providerCode = payload?.error?.code;
            const code = providerCode ? ` (code=${providerCode})` : '';
            throw new Error(`Seedream request failed: ${providerMessage}${code}`);
        }

        onProgress?.({
            progress: 78,
            stage: 'provider-waiting',
            message: 'Seedream returned result metadata'
        });

        const items = Array.isArray(payload?.data) ? payload.data : [];
        if (items.length === 0) {
            throw new Error('Seedream did not return any images');
        }

        // 组图场景下 data[] 的每个元素要么是一张图，要么是这一张的失败原因。
        // 审核不通过时后续图仍会继续生成，所以「部分失败」是正常态：
        // 收集成功项，把失败项单独记账回传，而不是让一张的失败吃掉整批结果。
        const images: SeedreamGeneratedImage[] = [];
        const failures: SeedreamImageFailure[] = [];
        const total = items.length;

        for (let index = 0; index < total; index += 1) {
            const item = items[index];
            if (item?.error?.message || item?.error?.code) {
                failures.push({
                    index,
                    code: item.error.code !== undefined ? String(item.error.code) : undefined,
                    message: String(item.error.message || '该张图片生成失败')
                });
                continue;
            }

            const progress = total > 1
                ? 78 + Math.round(((index + 1) / total) * 16)
                : 92;

            if (item?.b64_json) {
                onProgress?.({
                    progress,
                    stage: 'provider-ready',
                    message: total > 1
                        ? `Decoding Seedream result ${index + 1}/${total}`
                        : 'Decoding Seedream result'
                });
                images.push({ image: Buffer.from(item.b64_json, 'base64'), size: item.size });
                continue;
            }

            if (item?.url) {
                onProgress?.({
                    progress,
                    stage: 'provider-download',
                    message: total > 1
                        ? `Downloading Seedream result ${index + 1}/${total}`
                        : 'Downloading Seedream result'
                });
                try {
                    const imageResponse = await axios.get<ArrayBuffer>(item.url, {
                        responseType: 'arraybuffer',
                        timeout: 120_000,
                        ...getAxiosProxyConfig()
                    });
                    images.push({ image: Buffer.from(imageResponse.data), size: item.size });
                } catch (downloadError: any) {
                    // 结果链接 24 小时有效，下载失败通常是本机网络问题而非模型问题，
                    // 这里说清是「下载环节」失败，避免用户以为是提示词或模型的问题。
                    failures.push({
                        index,
                        code: 'DownloadFailed',
                        message: `第 ${index + 1} 张结果下载失败：${downloadError?.message || '网络错误'}`
                    });
                }
                continue;
            }

            failures.push({ index, code: 'EmptyPayload', message: `第 ${index + 1} 张结果既无图片数据也无下载链接` });
        }

        if (images.length > 0) {
            return {
                images,
                model,
                sizeSpec,
                failures,
                requestId: payload?.request_id
            };
        }

        if (failures.length > 0) {
            const detail = failures
                .map((f) => `#${f.index + 1}${f.code ? ` (${f.code})` : ''}: ${f.message}`)
                .join('; ');
            throw new Error(`Seedream request failed: 所有图片均生成失败 — ${detail}`);
        }

        throw new Error('Seedream result payload is missing image data');
    }

    /**
     * 生成 N 张，按模型能力自动选路径
     *
     *  - 支持组图的模型（lite / 4.5 / 4.0）：仍走官方 sequential，一次请求出多张，
     *    请求数和排队时间都更省。
     *  - 不支持组图的模型（5.0 / 5.0 pro）：并发多次单图请求拼出 N 张。请求体不带 seed，
     *    provider 每次随机，所以并发结果天然互不相同，不会拿到 N 张一样的图。
     *
     * 并发路径按张记账：某一张失败（限流、审核不通过、下载失败）不影响其余张，
     * 失败原因逐张回传给上层展示；一张都没成时才整体抛错。
     */
    async generateBatchFromImage(
        prompt: string,
        imageDataUrl: string,
        options?: {
            model?: SeedreamModel;
            sizePreset?: SeedreamSizePreset | string;
            size?: string;
            /** 期望张数。1 或省略走单图；>1 时按模型能力选组图或并发。 */
            count?: number;
            referenceImages?: string[];
            timeoutMs?: number;
        },
        onProgress?: SeedreamGenerateProgressCallback
    ): Promise<SeedreamGenerateResult> {
        const model = this.normalizeModel(options?.model);
        const capabilities = SEEDREAM_MODEL_CAPABILITIES[model];
        const requested = Number(options?.count);
        const count = Number.isFinite(requested) && requested > 1 ? Math.floor(requested) : 1;

        if (count === 1) {
            return this.generateFromImage(prompt, imageDataUrl, { ...options, maxImages: 1 }, onProgress);
        }

        if (capabilities.supportsSequential) {
            return this.generateFromImage(prompt, imageDataUrl, { ...options, maxImages: count }, onProgress);
        }

        if (count > SEEDREAM_PARALLEL_TOTAL_LIMIT) {
            throw new Error(
                `生成数量 ${count} 超出上限：${model} 需要并发拼图，单次最多 ${SEEDREAM_PARALLEL_TOTAL_LIMIT} 张。`
            );
        }

        // 结果按请求序号落位，而不是按完成先后 push——并发完成顺序不定，
        // 直接 push 会让「第几张」和界面上的位置对不上。
        const slots: Array<SeedreamGeneratedImage | null> = new Array(count).fill(null);
        const failures: SeedreamImageFailure[] = [];
        let sizeSpec = '';
        let requestId: string | undefined;
        let finished = 0;

        onProgress?.({
            progress: 20,
            stage: 'provider-submit',
            message: `Submitting ${count} parallel Seedream requests`
        });

        const runOne = async (index: number): Promise<void> => {
            try {
                const single = await this.generateSingleWithRateLimitRetry(prompt, imageDataUrl, options);
                slots[index] = single.images[0] || null;
                sizeSpec = single.sizeSpec || sizeSpec;
                requestId = requestId || single.requestId;
                if (!slots[index]) {
                    failures.push({ index, code: 'EmptyPayload', message: `第 ${index + 1} 张没有返回图片数据` });
                }
            } catch (error: any) {
                failures.push({
                    index,
                    code: this.isRateLimitError(error) ? 'RateLimited' : undefined,
                    message: `第 ${index + 1} 张生成失败：${error?.message || '未知错误'}`
                });
            } finally {
                finished += 1;
                onProgress?.({
                    // 30~92 之间按完成张数推进：并发下拿不到单张的细粒度进度，
                    // 报「完成几张」比报一个假的百分比诚实
                    progress: 30 + Math.round((finished / count) * 62),
                    stage: 'provider-waiting',
                    message: `Seedream parallel progress ${finished}/${count}`
                });
            }
        };

        const queue = Array.from({ length: count }, (_, index) => index);
        const workers = Array.from(
            { length: Math.min(SEEDREAM_PARALLEL_REQUEST_LIMIT, count) },
            async () => {
                while (queue.length > 0) {
                    const index = queue.shift();
                    if (index === undefined) {
                        break;
                    }
                    await runOne(index);
                }
            }
        );
        await Promise.all(workers);

        const images = slots.filter((item): item is SeedreamGeneratedImage => item !== null);
        if (images.length === 0) {
            const detail = failures
                .map((f) => `#${f.index + 1}${f.code ? ` (${f.code})` : ''}: ${f.message}`)
                .join('; ');
            throw new Error(`Seedream request failed: ${count} 张全部生成失败 — ${detail}`);
        }

        return {
            images,
            model,
            sizeSpec: sizeSpec || this.resolveSizePreset(model, options?.sizePreset),
            failures: failures.sort((a, b) => a.index - b.index),
            requestId
        };
    }

    /**
     * 单张请求 + 限流退避重试
     *
     * 只对限流类错误重试：审核不通过、参数非法这类错误重试多少次都是同一个结果，
     * 重试只会白烧配额和时间。
     */
    private async generateSingleWithRateLimitRetry(
        prompt: string,
        imageDataUrl: string,
        options?: {
            model?: SeedreamModel;
            sizePreset?: SeedreamSizePreset | string;
            size?: string;
            referenceImages?: string[];
            timeoutMs?: number;
        }
    ): Promise<SeedreamGenerateResult> {
        let lastError: any = null;

        for (let attempt = 0; attempt <= SEEDREAM_RATE_LIMIT_RETRIES; attempt += 1) {
            try {
                return await this.generateFromImage(prompt, imageDataUrl, { ...options, maxImages: 1 });
            } catch (error: any) {
                lastError = error;
                if (!this.isRateLimitError(error) || attempt === SEEDREAM_RATE_LIMIT_RETRIES) {
                    throw error;
                }
                await new Promise((resolve) => setTimeout(resolve, 800 * Math.pow(2, attempt)));
            }
        }

        throw lastError;
    }

    private isRateLimitError(error: any): boolean {
        const message = String(error?.message || '');
        return /\b429\b|rate.?limit|too many requests|qps|限流|流控/i.test(message);
    }

    private normalizeModel(model?: string): SeedreamModel {
        const normalized = String(model || '').trim() as SeedreamModel;
        return Object.prototype.hasOwnProperty.call(SEEDREAM_MODEL_CAPABILITIES, normalized)
            ? normalized
            : DEFAULT_MODEL;
    }

    private resolveSizePreset(model: SeedreamModel, requested?: string): SeedreamSizePreset {
        const capabilities = SEEDREAM_MODEL_CAPABILITIES[model];
        const normalized = String(requested || '').trim().toUpperCase() as SeedreamSizePreset;
        if (!normalized) {
            return capabilities.defaultSize;
        }
        if (capabilities.supportedSizes.includes(normalized)) {
            return normalized;
        }
        throw new Error(
            `当前模型 ${model} 不支持分辨率档位 ${requested}，支持：${capabilities.supportedSizes.join(' / ')}`
        );
    }

    /**
     * 校验并规范像素模式尺寸（`<宽>x<高>`）。
     *
     * 官方对像素模式有两条**同时生效**的限制：总像素落在模型区间内、宽高比 ∈ [1/16, 16]。
     * 报错要说清是哪一条没过、实际值多少、合法区间是多少——只说「尺寸非法」用户没法自己修。
     */
    private resolveExplicitSize(model: SeedreamModel, requested: string): string {
        const capabilities = SEEDREAM_MODEL_CAPABILITIES[model];
        const normalized = String(requested || '').trim().toLowerCase().replace(/\s+/g, '');
        const match = /^(\d{1,5})x(\d{1,5})$/.exec(normalized);
        if (!match) {
            throw new Error(
                `尺寸格式不合法：${requested}。像素模式请使用「宽x高」，例如 2048x1024。`
            );
        }

        const width = Number(match[1]);
        const height = Number(match[2]);
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
            throw new Error(`尺寸格式不合法：${requested}。宽和高都必须是正整数。`);
        }

        const totalPixels = width * height;
        if (totalPixels < capabilities.minTotalPixels || totalPixels > capabilities.maxTotalPixels) {
            throw new Error(
                `尺寸 ${width}x${height} 的总像素 ${totalPixels} 超出模型 ${model} 的允许范围 `
                + `[${capabilities.minTotalPixels}, ${capabilities.maxTotalPixels}]。`
                + `总像素是宽高相乘的结果，不是对单边的限制——可以在保持比例的前提下整体放大或缩小。`
            );
        }

        const aspectRatio = width / height;
        if (aspectRatio < SEEDREAM_INPUT_LIMITS.minAspectRatio || aspectRatio > SEEDREAM_INPUT_LIMITS.maxAspectRatio) {
            throw new Error(
                `尺寸 ${width}x${height} 的宽高比 ${aspectRatio.toFixed(3)} 超出允许范围 `
                + `[1/16, 16]，请调整为更接近方形的比例。`
            );
        }

        return `${width}x${height}`;
    }

    /**
     * 规范本次组图上限。
     *
     * 三条约束依次收敛：模型是否支持组图 → 官方 [1,15] 取值范围 → 参考图占用的额度。
     * 模型不支持组图时直接报错而不是静默降级成单图——用户以为在批量出图、实际只出一张，
     * 这种"看起来成功了"的静默降级比报错更难排查。
     */
    private resolveMaxImages(model: SeedreamModel, requested: number | undefined, consumedByInputs: number): number {
        const capabilities = SEEDREAM_MODEL_CAPABILITIES[model];
        const value = Number(requested);
        if (!Number.isFinite(value) || value <= 1) {
            return 1;
        }

        const rounded = Math.floor(value);
        if (!capabilities.supportsSequential) {
            throw new Error(
                `模型 ${model} 不支持一次生成多张（组图），当前请求了 ${rounded} 张。`
                + `请改用 Seedream 5.0 lite / 4.5 / 4.0，或把生成数量调回 1 张。`
            );
        }

        if (rounded > SEEDREAM_SEQUENTIAL_TOTAL_LIMIT) {
            throw new Error(
                `生成数量 ${rounded} 超出上限：单次最多 ${SEEDREAM_SEQUENTIAL_TOTAL_LIMIT} 张。`
            );
        }

        const remaining = SEEDREAM_SEQUENTIAL_TOTAL_LIMIT - consumedByInputs;
        if (remaining < 1) {
            throw new Error(
                `参考图数量过多：输入图片已占用 ${consumedByInputs} 张额度，`
                + `而「输入图片数 + 生成图片数」不能超过 ${SEEDREAM_SEQUENTIAL_TOTAL_LIMIT} 张，已无额度可生成。`
            );
        }

        return Math.min(rounded, remaining);
    }

    private resolveResponseFormat(): SeedreamResponseFormat {
        // Prefer URL results for every size so the provider response stays small and
        // the downstream Agent -> UXP path can work from a local temp file instead of
        // carrying large base64 payloads through JSON.
        return 'url';
    }

    /**
     * 对传入的图像进行完整校验并规范成合法 data URL。
     *
     * 校验项（按顺序失败抛错）：
     *  1. 字符串非空
     *  2. data URL 格式（或纯 base64）解析
     *  3. base64 字符集合法（A-Z a-z 0-9 + / =）
     *  4. base64 解码不报错
     *  5. 字节 ≤ 10MB
     *  6. sharp 能解析出宽高
     *  7. 单边 ≥ 15px，总像素 ≤ 36MP，宽高比 ∈ [1/16, 16]
     *  8. 最终 mime 属于当前模型允许列表（不在则按 sharp 元数据重新打 mime）
     */
    private async prepareImageInput(
        imageData: string,
        model: SeedreamModel,
        role: 'source' | `reference-${number}`
    ): Promise<{ dataUrl: string; mime: string; bytes: number; width: number; height: number }> {
        const trimmed = String(imageData || '').trim();
        if (!trimmed) {
            throw new SeedreamInputError(`${role} image is empty`, role);
        }

        let mime = 'image/png';
        let base64Raw = trimmed;
        const match = DATA_URL_REGEX.exec(trimmed);
        if (match) {
            mime = String(match[1] || '').trim().toLowerCase();
            base64Raw = String(match[2] || '').trim();
        }

        const base64Clean = base64Raw.replace(/\s+/g, '');
        if (!base64Clean) {
            throw new SeedreamInputError(`${role} image base64 is empty`, role);
        }
        if (!BASE64_CHAR_REGEX.test(base64Clean)) {
            const preview = base64Clean.slice(0, 48);
            throw new SeedreamInputError(
                `${role} image base64 contains illegal characters (preview="${preview}...")`,
                role
            );
        }
        if (base64Clean.length % 4 !== 0) {
            throw new SeedreamInputError(
                `${role} image base64 length (${base64Clean.length}) is not a multiple of 4`,
                role
            );
        }

        let buffer: Buffer;
        try {
            buffer = Buffer.from(base64Clean, 'base64');
        } catch (decodeError) {
            const message = decodeError instanceof Error ? decodeError.message : String(decodeError);
            throw new SeedreamInputError(`${role} image base64 decode failed: ${message}`, role);
        }

        if (buffer.length === 0) {
            throw new SeedreamInputError(`${role} image decoded to 0 bytes`, role);
        }

        let metadata: sharp.Metadata;
        try {
            metadata = await sharp(buffer).metadata();
        } catch (metaError) {
            const message = metaError instanceof Error ? metaError.message : String(metaError);
            throw new SeedreamInputError(`${role} image could not be decoded by sharp: ${message}`, role);
        }

        const width = Number(metadata.width) || 0;
        const height = Number(metadata.height) || 0;
        if (width <= 0 || height <= 0) {
            throw new SeedreamInputError(`${role} image has invalid dimensions (${width}x${height})`, role);
        }
        if (width < SEEDREAM_INPUT_LIMITS.minEdgePx || height < SEEDREAM_INPUT_LIMITS.minEdgePx) {
            throw new SeedreamInputError(
                `${role} image edge too small: ${width}x${height} (minimum ${SEEDREAM_INPUT_LIMITS.minEdgePx}px per side)`,
                role
            );
        }
        if (width * height > SEEDREAM_INPUT_LIMITS.maxTotalPixels) {
            throw new SeedreamInputError(
                `${role} image total pixels ${width * height} exceed 6000×6000 = ${SEEDREAM_INPUT_LIMITS.maxTotalPixels}`,
                role
            );
        }
        const aspect = width / height;
        if (aspect < SEEDREAM_INPUT_LIMITS.minAspectRatio || aspect > SEEDREAM_INPUT_LIMITS.maxAspectRatio) {
            throw new SeedreamInputError(
                `${role} image aspect ratio ${aspect.toFixed(3)} out of [1/16, 16]`,
                role
            );
        }

        const fitted = await this.fitToUploadLimit(buffer, mime, model, role);
        return {
            dataUrl: `data:${fitted.mime};base64,${fitted.base64}`,
            mime: fitted.mime,
            bytes: fitted.bytes,
            width,
            height
        };
    }

    /**
     * Volcengine 上传上限 10 MiB 是服务端硬性约束（不可调）。
     *
     * 适配规则（保持画质优先，无需用户感知）：
     *  1. 解码字节 ≤ 9.5 MiB → 直接以原 mime/原始 base64 发送（无损 PNG 优先）
     *  2. 否则按 mozjpeg q=92 重打（视觉无损，对 jpeg 白名单内的所有模型都合法）
     *  3. 还超就 q=82 重打（mozjpeg 在 q=82 仍接近视觉无损，几乎不会再失败）
     *  4. 都不行才抛 SeedreamInputError，由 UI 提示用户降低 size 档位或自行裁切
     *
     * 这里没有"原图替代品"概念——所有重打的产物都是合法、上传可用的；它本身就是
     * 最优路线，不属于 fallback。
     */
    private async fitToUploadLimit(
        rawBuffer: Buffer,
        rawMime: string,
        model: SeedreamModel,
        role: string
    ): Promise<{ base64: string; mime: string; bytes: number }> {
        const allowed = getAllowedMimeForModel(model);
        const allowsJpeg = allowed.includes('image/jpeg') || allowed.includes('image/jpg');
        const softLimit = SEEDREAM_INPUT_LIMITS.softFileBytes;
        const hardLimit = SEEDREAM_INPUT_LIMITS.maxFileBytes;

        if (rawBuffer.length <= softLimit) {
            const finalMime = this.resolveMimeForModel(model, rawMime, rawMime, role);
            return {
                base64: rawBuffer.toString('base64'),
                mime: finalMime,
                bytes: rawBuffer.length
            };
        }

        if (!allowsJpeg) {
            throw new SeedreamInputError(
                `${role} image is ${(rawBuffer.length / 1024 / 1024).toFixed(2)}MB and exceeds the 10MB upload limit; ` +
                `model ${model} does not accept JPEG so automatic recompression is unavailable`,
                role
            );
        }

        for (const quality of [92, 82]) {
            try {
                const repacked = await sharp(rawBuffer)
                    .jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:4:4' })
                    .toBuffer();
                if (repacked.length <= softLimit) {
                    return {
                        base64: repacked.toString('base64'),
                        mime: 'image/jpeg',
                        bytes: repacked.length
                    };
                }
            } catch (jpegError) {
                const message = jpegError instanceof Error ? jpegError.message : String(jpegError);
                throw new SeedreamInputError(
                    `${role} image JPEG repack failed at quality=${quality}: ${message}`,
                    role
                );
            }
        }

        const fallbackInfo = `${(rawBuffer.length / 1024 / 1024).toFixed(2)}MB original`;
        throw new SeedreamInputError(
            `${role} image still exceeds Volcengine ${(hardLimit / 1024 / 1024).toFixed(0)}MB upload limit ` +
            `after mozjpeg q=82 recompression (${fallbackInfo}); please switch the size preset to a lower tier ` +
            `(e.g. 2K) or simplify the layer content`,
            role
        );
    }

    private resolveMimeForModel(
        model: SeedreamModel,
        requested: string,
        detected: string,
        role: string
    ): string {
        const allow = getAllowedMimeForModel(model);
        const requestedNormalized = String(requested || '').trim().toLowerCase();
        const detectedNormalized = String(detected || '').trim().toLowerCase();

        if (allow.includes(requestedNormalized)) {
            return requestedNormalized;
        }
        if (allow.includes(detectedNormalized)) {
            return detectedNormalized;
        }
        throw new SeedreamInputError(
            `${role} image mime not allowed for ${model}: requested=${requestedNormalized || 'unknown'}, detected=${detectedNormalized || 'unknown'}, allowed=${allow.join('/')}`,
            role
        );
    }
}

export class SeedreamInputError extends Error {
    constructor(message: string, public readonly role: string) {
        super(message);
        this.name = 'SeedreamInputError';
    }
}

export const volcengineSeedreamService = new VolcengineSeedreamService();
