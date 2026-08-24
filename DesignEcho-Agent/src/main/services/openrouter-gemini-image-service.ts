import axios from 'axios';
import sharp from 'sharp';
import { getAxiosProxyConfig } from './network-proxy';

export type OpenRouterGeminiImageModel =
    | 'google/gemini-3-pro-image-preview'
    | 'google/gemini-3-pro-image'
    | 'google/gemini-3.1-flash-image-preview'
    | 'google/gemini-3.1-flash-image'
    | 'openai/gpt-image-2'
    | 'openai/gpt-5.4-image-2'
    | 'openai/gpt-5-image'
    | 'openai/gpt-5-image-mini';

/**
 * 曾经用过的"带日期后缀"写法 → OpenRouter 真实模型 ID。
 *
 * 这些后缀**从来不是 OpenRouter 的模型 ID**，而是该模型条目的 created 日期
 * （`gemini-3-pro-image-preview` 建于 2025-11-20，`gemini-3.1-flash-image-preview`
 * 建于 2026-02-26），以及 Google 上游快照名——它们出现在 OpenRouter 透传的 400
 * 报文里，被误当成可直接请求的 ID 写进了代码。
 *
 * 代价：OpenRouter 对这种不存在的 ID 做宽松匹配、解析回本体再执行，
 * `image_config` 在这一步被丢弃——真机表现就是选了 4K 却只出 896×1200，
 * 且响应回报的 model 是不带日期的本体（2026-08-17 实测坐实）。
 *
 * 保留映射是为了兼容用户设置里已持久化的旧值：解析到它本就指向的模型不算"静默换模型"，
 * 而是把 OpenRouter 私下在做的归一化显式化，并留下日志。
 */
const LEGACY_MODEL_ALIASES: Record<string, OpenRouterGeminiImageModel> = {
    'google/gemini-3-pro-image-preview-20251120': 'google/gemini-3-pro-image-preview',
    'google/gemini-3.1-flash-image-preview-20260226': 'google/gemini-3.1-flash-image-preview'
};

export interface OpenRouterGeminiImageProgressEvent {
    progress: number;
    stage:
        | 'provider-validate'
        | 'provider-submit'
        /** 上传源图的过程——整条链路上唯一有真实百分比可报的一段 */
        | 'provider-upload-progress'
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
    /** 本次**请求**的档位。上游是否照做要看 actualWidth/actualHeight，别把它当成事实。 */
    imageSize: '1K' | '2K' | '4K';
    /** 上游实际出图的像素尺寸——判断档位有没有真生效的唯一依据 */
    actualWidth: number;
    actualHeight: number;
    /** OpenRouter 响应里回报的实际模型 / 上游 provider，用来识别静默路由与降级 */
    upstreamModel?: string;
    upstreamProvider?: string;
    /** 实际分辨率明显低于所请求档位时的人话说明；档位如实生效时为 undefined */
    sizeDowngradeNotice?: string;
}

/**
 * 各档位期望的输出长边（像素）。用于判断"请求了 4K 但上游没照做"。
 *
 * 取值按 Gemini 图像模型公开的档位口径：1K≈1024、2K≈2048、4K≈3840 长边。
 * 判据放宽到 0.75 倍，避免把不同比例下的正常尺寸差异误报成降级。
 */
const IMAGE_SIZE_EXPECTED_LONG_EDGE: Record<'1K' | '2K' | '4K', number> = {
    '1K': 1024,
    '2K': 2048,
    '4K': 3840
};

/**
 * OpenRouter 图像 API 的响应体。
 *
 * 图片以 base64 返回（不是 URL），`media_type` 在能识别格式时一定存在，
 * `usage.cost` 给出这次调用的实际花费——落进日志后"这次生成花了多少钱"才有据可查。
 */
type OpenRouterImageResponse = {
    created?: number;
    data?: Array<{
        b64_json?: string;
        media_type?: string;
        /** 未在文档中承诺，但若某个 provider 返回 URL 而非 base64，这里兜一下 */
        url?: string;
    }>;
    usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        cost?: number;
    };
    /** 部分错误形态会带这两个字段，用于诊断实际路由到了谁 */
    model?: string;
    provider?: string;
    error?: {
        message?: string;
        code?: string;
    };
};

/**
 * 图像源：要么是已编码的图片字节，要么是**未编码的 raw RGBA**。
 *
 * 支持后者是为了把链路上一次多余的往返减掉：UXP 直传的就是 raw RGBA，
 * 原先要先在 handler 里编成 PNG（3072×4096 实测耗时 2.2~3.4 秒），
 * 传进来后再被解码、再编码一次。PNG 无损所以数值没变，但这一编一解纯属白做——
 * 直接把 raw 拿进来，最终只编一次。
 */
export type OpenRouterImageSource =
    | Buffer
    | { raw: Buffer; width: number; height: number; channels: 1 | 2 | 3 | 4 };

/** 把图像源统一成 sharp 实例，调用方不必关心它是哪种形态 */
function openSource(source: OpenRouterImageSource): sharp.Sharp {
    if (Buffer.isBuffer(source)) {
        return sharp(source);
    }
    return sharp(source.raw, {
        raw: { width: source.width, height: source.height, channels: source.channels }
    });
}

type ServiceError = Error & {
    errorStage?: string;
    errorCode?: string;
    errorDetail?: string;
    provider?: 'openrouter';
};

/**
 * OpenRouter **图像专用**端点。
 *
 * 这里曾经用的是 `/api/v1/chat/completions`，那是本次 4K 失效的真正根因：
 * chat 路径**没有分辨率这个概念**，我们发的 `image_config: { image_size }` 是
 * Google 原生 API 的字段名（camelCase `imageConfig` 的 snake 版），OpenRouter 的
 * OpenAI 兼容层不认识它，只是把未知字段透传给上游——所以偶尔能看到 Google 自己
 * 校验 image_size 报的 400，但**档位从来没有真正生效过**，输出恒为该比例的 1K 档
 * （3:4 → 896×1200，与真机 5 次记录完全一致）。
 *
 * 正确契约（2026-08-17 用 models API + 端点 schema 校验逐项核实，未花费任何调用）：
 *   POST /api/v1/images
 *   { model, prompt, resolution:'512'|'1K'|'2K'|'4K', aspect_ratio, output_format,
 *     n, input_references:[{ type:'image_url', image_url:{ url } }] }
 * → { created, data:[{ b64_json, media_type }], usage:{ cost, ... } }
 *
 * 分辨率参数名是顶层 `resolution`，图生图的输入图走 `input_references`（最多 14 张）。
 */
const OPENROUTER_IMAGES_ENDPOINT = 'https://openrouter.ai/api/v1/images';
// 默认用 OpenRouter models API 里真实存在的 ID（已核对官方清单，见 LEGACY_MODEL_ALIASES 注释）。
// 这一条对应 Google 快照 gemini-3-pro-image-preview-20251120，是 400 报文列出的 4K 白名单成员。
const DEFAULT_MODEL: OpenRouterGeminiImageModel = 'google/gemini-3-pro-image-preview';
/**
 * 请求超时，**按输出档位分档**。
 *
 * 两次真机数据定的值：
 * - 2K：15:46 提交 → 45 秒返回，300 秒绰绰有余
 * - 4K：15:46:34 提交 → 300 秒耗尽仍未返回（`timeout of 300000ms exceeded`）
 *
 * 4K 会先跑一遍"思考过程"再出图，且输出像素是 2K 的四倍，几分钟是正常水平，
 * 不是卡死。原先 180 秒更是连 2K 都保不住，而超时发生在上游已经开始计费之后——
 * 那是一次白付钱的调用，宁可多等也不能提前掐断。
 *
 * 调用方（UXP）的超时必须**比这里更长**，否则它先到期，Agent 这边那句带 provider
 * 原文的错误就没机会传回面板，用户只能看到无信息量的"请求超时"。
 */
const TIMEOUT_MS_BY_IMAGE_SIZE: Record<'1K' | '2K' | '4K', number> = {
    '1K': 300_000,
    '2K': 300_000,
    '4K': 900_000
};

/**
 * 所有内联图片（源图 + 引导图 + 参考图）**合计**的二进制上限。
 *
 * 这个值原先是单张 7MB，一行光秃秃的常量、没有任何依据，而它直接决定了源图要不要
 * 降采样——也就是直接决定清晰度损失。实测把真实上限测出来了（2026-08-17，
 * 未鉴权梯度探测，Zod/网关校验在鉴权之前，所以零调用花费）：
 *
 *   请求体 49.3MB → 401（通过大小校验，只差鉴权）
 *   请求体 50.7MB → 413 请求体过大
 *
 * 即上限是 **50MB 请求体**（base64 膨胀 4/3，约合 37MB 二进制）。原来的 7MB 低了五倍多，
 * 白白把 3072×4096 这类源图降采样成了 1568×2090。
 *
 * 这里取 30MB（约 40MB 请求体，实测通过且留出足够余量给 prompt 与网络抖动），
 * 并且改成**合计**预算而不是单张：局部重绘会带源图 + 引导图 + 参考图，
 * 单张各判 7MB 时四张就是 28MB，真实上限一提高就会撞 413。
 */
const MAX_TOTAL_INLINE_IMAGE_BYTES = 30 * 1024 * 1024;

/**
 * 4K 档下源图长边的上限。**取值由真实调用实测定死**（2026-08-17，三次对照）：
 *
 *   源图 512  → 4K 出图 37.0 秒
 *   源图 2048 → 4K 出图 36.3 秒   ← 与 512 无差别，说明 2048 留足余量
 *   源图 3072 → 跑满 900 秒不返回（连续三次）
 *
 * 2048 与 3072 之间存在一个陡崖：按 Gemini 的 768×768 分块，前者约 12 块、
 * 后者约 24 块，翻一倍之后耗时从 36 秒跳到 900 秒以上，不是线性变慢，
 * 更像是撞上了上游的某个处理边界。取 2048 是在实测安全区内。
 */
const SOURCE_MAX_EDGE_FOR_4K = 2048;

/** 一次最多并发出几张。与面板的数量选项（1/2/4/6/9）对齐。 */
const MAX_PARALLEL_IMAGE_COUNT = 9;
/** 每批并发几个请求。这些模型有并发限流，一次全打出去容易整批被拒。 */
const PARALLEL_IMAGE_BATCH_SIZE = 3;

const SUPPORTED_MODELS: OpenRouterGeminiImageModel[] = [
    'google/gemini-3-pro-image-preview',
    'google/gemini-3-pro-image',
    'google/gemini-3.1-flash-image-preview',
    'google/gemini-3.1-flash-image',
    'openai/gpt-image-2',
    'openai/gpt-5.4-image-2',
    'openai/gpt-5-image',
    'openai/gpt-5-image-mini'
];

/**
 * 在图像 API 的 supported_parameters 里声明了 `resolution` / `aspect_ratio` 的模型。
 *
 * 这两个参数不是所有图像模型都收：端点用 Zod 严格校验，发给没声明的模型会直接 400。
 * 所以按模型判断要不要带上，而不是无条件塞进请求体。
 * （OpenAI 系图像模型走另一套参数，本服务不给它们下发这两项。）
 */
/**
 * 各模型声明支持的比例集（数据源同上：images API 的 supported_parameters）。
 *
 * 必须按模型过滤，不能用一份全局清单：OpenAI 系**不支持 4:5 / 5:4**，
 * 发过去会被 Zod 直接 400。Gemini 那边则没有 21:9 之外的额外档。
 */
const MODEL_ASPECT_RATIOS: Record<string, readonly string[]> = {
    // 新一代（9 档）
    'openai/gpt-image-2': ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9'],
    'openai/gpt-5.4-image-2': ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9'],
    // 上一代只有 3 档可用比例，连 4:3 / 3:4 都没有——按模型如实配，
    // 少配一个就会在用户选中它时被上游 400 掉
    'openai/gpt-5-image': ['1:1', '3:2', '2:3'],
    'openai/gpt-5-image-mini': ['1:1', '3:2', '2:3']
};

/**
 * 声明支持 `quality` 的模型（auto/low/medium/high）。
 *
 * OpenAI 系用它控制生成质量档，high 是最强档。Gemini 系不声明这个参数，
 * 之前实测给 Gemini 发 quality 也不生效（收益 0.045%、体积四倍），所以只发给声明支持的。
 */
const MODELS_WITH_QUALITY_PARAM: OpenRouterGeminiImageModel[] = [
    'openai/gpt-image-2',
    'openai/gpt-5.4-image-2',
    'openai/gpt-5-image',
    'openai/gpt-5-image-mini'
];

/**
 * 单次请求能出几张（`n` 的上限）。
 *
 * Gemini 系是 1——要多张只能并发多次请求，每次都单独计费。
 * OpenAI 系是 10，一次请求就能出多张，**又快又省**，不该走并发那条路。
 */
const MODEL_NATIVE_BATCH_LIMIT: Record<string, number> = {
    'openai/gpt-image-2': 10,
    'openai/gpt-5.4-image-2': 10,
    'openai/gpt-5-image': 10,
    'openai/gpt-5-image-mini': 10
};

const MODELS_WITH_RESOLUTION_PARAMS: OpenRouterGeminiImageModel[] = [
    'google/gemini-3-pro-image-preview',
    'google/gemini-3-pro-image',
    'google/gemini-3.1-flash-image-preview',
    'google/gemini-3.1-flash-image'
];

/**
 * 各模型当前实际支持的 image_size 档位，依据真实执行结果维护。
 *
 * 数据源是**图像 API 的 supported_parameters**（`/api/v1/images/models`，公开免鉴权），
 * 它按 endpoint 逐项声明 `resolution` 的取值集合，是这条调用路径上唯一权威的口径：
 *   gemini-3-pro-image-preview     resolution: 1K / 2K / 4K
 *   gemini-3-pro-image (GA)        resolution: 1K / 2K / 4K
 *   gemini-3.1-flash-image-preview resolution: 512 / 1K / 2K / 4K
 *   gemini-3.1-flash-image         resolution: 512 / 1K / 2K / 4K
 *
 * 注意 GA 这一行与旧注释相反：此前"GA 不支持 4K"的结论来自 chat/completions 路径上
 * 透传给 Google 的 400 报文，那条路径压根不管分辨率，其报文不能用来推断 images API 的能力。
 * 512 档暂不开放——面板没有这一档，加它要动三处能力表，收益不足。
 *
 * 这张表声明的是"允许发出该档位请求"，不是"上游保证照做"。
 * 后者只有响应里的 actualWidth/actualHeight 能回答——档位被静默降级是发生过的事。
 */
const MODEL_IMAGE_SIZE_CAPS: Partial<Record<OpenRouterGeminiImageModel, Array<'1K' | '2K' | '4K'>>> = {
    'google/gemini-3-pro-image-preview': ['1K', '2K', '4K'],
    'google/gemini-3-pro-image': ['1K', '2K', '4K'],
    'google/gemini-3.1-flash-image-preview': ['1K', '2K', '4K'],
    'google/gemini-3.1-flash-image': ['1K', '2K', '4K']
};

/** 面板/处理器用它判断一个模型 id 是否归 OpenRouter 图像服务管，而不是靠字符串前缀猜。 */
export function isOpenRouterImageModelId(model?: string): boolean {
    return SUPPORTED_MODELS.includes(String(model || '').trim() as OpenRouterGeminiImageModel);
}

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
            /** 用户点「停止生成」时中断在途请求 */
            signal?: AbortSignal;
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

        onProgress?.({
            progress: 28,
            stage: 'provider-validate',
            message: '正在准备局部重绘请求'
        });

        const sourceMetadata = await sharp(sourceImage).metadata();
        const width = Math.max(1, sourceMetadata.width || 1024);
        const height = Math.max(1, sourceMetadata.height || 1024);
        const aspectRatio = this.resolveAspectRatio(width, height);
        const imageSize = this.capImageSize(model, this.resolveImageSize(width, height));
        // 超时要在档位定下来之后算：4K 与 2K 的实际耗时差一个量级
        const timeoutMs = this.resolveTimeoutMs(imageSize, options?.timeoutMs);

        const normalizedMask = await this.normalizeMask(maskImage);
        const guideImage = await this.buildGuideImage(sourceImage, normalizedMask);

        const referenceBuffers = Array.isArray(options?.referenceImages)
            ? options!.referenceImages!.filter((buffer) => buffer instanceof Buffer && buffer.length > 0)
            : [];

        // 源图 + 引导图 + 参考图共用合计预算，先按张数分摊再逐张编码
        const perImageBudget = this.resolvePerImageBudget(2 + referenceBuffers.length);

        // 二值蒙版不作为参考图发送：Gemini 这类指令式编辑模型没有蒙版通道，
        // 收到一张纯黑白图会当成风格参考融进结果里（典型症状就是生成物带白底）。
        // 蒙版只用来生成"选区外侧描边"的引导图，以及最终合成时的 alpha。
        const sourceDataUrl = await this.encodeImageDataUrl(sourceImage, 'source', perImageBudget);
        const guideDataUrl = await this.encodeImageDataUrl(guideImage, 'guide', perImageBudget);

        const referenceDataUrls: string[] = [];
        for (const reference of referenceBuffers) {
            referenceDataUrls.push(await this.encodeImageDataUrl(reference, 'reference', perImageBudget));
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

        const resolved = await this.requestImage(requestBody, timeoutMs, onProgress, options?.signal);

        return this.describeGeneratedImage({
            image: resolved.image,
            mimeType: resolved.mimeType,
            payload: resolved.payload,
            model,
            aspectRatio,
            imageSize
        });
    }

    /**
     * 整图重生（image-to-image）：源图 + 文字描述直接再生成，无蒙版、无引导图。
     *
     * 与 editImage 的区别只在输入契约：局部重绘靠"选区描边引导图"告诉模型改哪里，
     * 整图重生是全图变换，多一张引导图反而会被当成风格参考融进结果。
     */
    async generateFromImage(
        prompt: string,
        sourceImage: OpenRouterImageSource,
        options?: {
            model?: OpenRouterGeminiImageModel | string;
            timeoutMs?: number;
            /** 用户提供的效果参考图（风格/材质/指定物件），原样转发给模型 */
            referenceImages?: Buffer[];
            /** 用户点「停止生成」时中断在途请求 */
            signal?: AbortSignal;
            /** 用户显式选定的输出比例，必须在支持清单内；缺省按源图比例吸附到最近档位 */
            aspectRatio?: string;
            /** 输出档位；缺省按源图尺寸推断 */
            imageSize?: '1K' | '2K' | '4K';
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
        const hasSource = Buffer.isBuffer(sourceImage)
            ? sourceImage.length > 0
            : !!sourceImage?.raw?.length;
        if (!hasSource) {
            throw this.createStageError('Source image is required', 'provider-validate');
        }

        const model = this.normalizeModel(options?.model);

        onProgress?.({
            progress: 28,
            stage: 'provider-validate',
            message: '正在准备生成请求'
        });

        const prepared = await this.prepareGenerationRequest(cleanPrompt, sourceImage, options, onProgress);
        const { body: requestBody, timeoutMs, aspectRatio, imageSize } = prepared;

        const resolved = await this.requestImage(requestBody, timeoutMs, onProgress, options?.signal);

        return this.describeGeneratedImage({
            image: resolved.image,
            mimeType: resolved.mimeType,
            payload: resolved.payload,
            model,
            aspectRatio,
            imageSize
        });
    }

    /**
     * 场景底生成（composeDesign 车间用）：参照图只提供光线 / 色温 / 氛围，
     * 产出一张**不含产品、不含文字**的空场景底，供车间在其上合成真实产品与可编辑文字。
     *
     * 与 generateFromImage 的区别只在指令：那条路径要求「保留源图主体与构图」，
     * 这条路径明确要求「不要源图里的物件、只要一块干净的场景」。
     */
    async generateBackdropFromReference(
        prompt: string,
        referenceImage: Buffer,
        options?: {
            model?: OpenRouterGeminiImageModel | string;
            timeoutMs?: number;
            signal?: AbortSignal;
            aspectRatio?: string;
            imageSize?: '1K' | '2K' | '4K';
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
        if (!(referenceImage instanceof Buffer) || referenceImage.length === 0) {
            throw this.createStageError('Reference image is required', 'provider-validate');
        }
        const model = this.normalizeModel(options?.model);
        const sourceMetadata = await sharp(referenceImage).metadata();
        const width = Math.max(1, sourceMetadata.width || 1024);
        const height = Math.max(1, sourceMetadata.height || 1024);
        const aspectRatio = this.resolveRequestedAspectRatio(options?.aspectRatio, width, height);
        const imageSize = this.capImageSize(model, this.resolveRequestedImageSize(options?.imageSize, width, height));
        const timeoutMs = this.resolveTimeoutMs(imageSize, options?.timeoutMs);
        const perImageBudget = this.resolvePerImageBudget(1);
        const preparedSource = await this.limitSourceForHeavyTier(referenceImage, imageSize);
        const sourceDataUrl = await this.encodeImageDataUrl(preparedSource, 'source', perImageBudget);
        const instruction = [
            'You are generating an EMPTY product-photography backdrop.',
            'Image 1 is only a lighting and mood reference: borrow its light direction, color temperature, depth of field, materials and atmosphere.',
            `Task: ${cleanPrompt}`,
            '',
            'Hard requirements:',
            '- Return ONE image.',
            '- Do NOT include the product, object, person, hand or any item shown in the reference image — the scene must be empty.',
            '- Do NOT render any text, letters, numbers, logos, labels, watermarks or borders.',
            '- Keep the requested empty area clean, evenly lit and low in detail so a headline can be placed on it later.',
            '- Photorealistic; natural soft shadows on surfaces are welcome; no heavy vignette.'
        ].join('\n');
        const requestBody = this.buildGenerationRequestBody({
            model,
            instruction,
            sourceDataUrl,
            referenceDataUrls: [],
            aspectRatio,
            imageSize
        });
        const resolved = await this.requestImage(requestBody, timeoutMs, onProgress, options?.signal);
        return this.describeGeneratedImage({
            image: resolved.image,
            mimeType: resolved.mimeType,
            payload: resolved.payload,
            model,
            aspectRatio,
            imageSize
        });
    }

    /**
     * 把"一次整图重生请求"准备好：定档位、定比例、编码所有图、拼请求体。
     *
     * 单张与并发多张共用这一份。抽出来的直接原因是**源图编码很贵**（4K 源图实测数秒），
     * 出 N 张时请求必须发 N 次，但编码只该做一次；顺带也消掉了两条路径各写一遍
     * 参数决策逻辑的隐患——那种重复迟早会在一边改了、另一边没改时露馅。
     */
    private async prepareGenerationRequest(
        cleanPrompt: string,
        sourceImage: OpenRouterImageSource,
        options: {
            model?: OpenRouterGeminiImageModel | string;
            timeoutMs?: number;
            referenceImages?: Buffer[];
            aspectRatio?: string;
            imageSize?: '1K' | '2K' | '4K';
        } | undefined,
        onProgress?: OpenRouterGeminiImageProgressCallback,
        count: number = 1
    ): Promise<{
        body: Record<string, unknown>;
        timeoutMs: number;
        model: OpenRouterGeminiImageModel;
        aspectRatio: string;
        imageSize: '1K' | '2K' | '4K';
    }> {
        const model = this.normalizeModel(options?.model);
        const sourceMetadata = await openSource(sourceImage).metadata();
        const width = Math.max(1, sourceMetadata.width || 1024);
        const height = Math.max(1, sourceMetadata.height || 1024);
        const aspectRatio = this.resolveRequestedAspectRatio(options?.aspectRatio, width, height, model);
        const imageSize = this.capImageSize(model, this.resolveRequestedImageSize(options?.imageSize, width, height));
        // 超时要在档位定下来之后算：4K 与 2K 的实际耗时差一个量级
        const timeoutMs = this.resolveTimeoutMs(imageSize, options?.timeoutMs);

        const referenceBuffers = Array.isArray(options?.referenceImages)
            ? options!.referenceImages!.filter((buffer) => buffer instanceof Buffer && buffer.length > 0)
            : [];

        // 整图重生没有引导图：源图 + 参考图共用合计预算
        const perImageBudget = this.resolvePerImageBudget(1 + referenceBuffers.length);

        const preparedSource = await this.limitSourceForHeavyTier(sourceImage, imageSize);
        const sourceDataUrl = await this.encodeImageDataUrl(preparedSource, 'source', perImageBudget);
        const referenceDataUrls: string[] = [];
        for (const reference of referenceBuffers) {
            referenceDataUrls.push(await this.encodeImageDataUrl(reference, 'reference', perImageBudget));
        }

        const body = this.buildGenerationRequestBody({
            model,
            instruction: this.buildRegenerationInstruction(cleanPrompt, referenceDataUrls.length),
            sourceDataUrl,
            referenceDataUrls,
            aspectRatio,
            imageSize,
            count
        });

        return { body, timeoutMs, model, aspectRatio, imageSize };
    }

    /**
     * 并发出多张：这些模型单次只能出 1 张（图像 API 的 supported_parameters 里
     * `n` 的 min/max 都是 1），要多张只能发多次请求。
     *
     * 关键在于**源图只编码一次**。若简单地把 generateFromImage 调 N 遍，
     * 那张 4K 源图就会被重复编码 N 次（实测单次就要几秒）——请求数是必须的，
     * 编码次数不是。
     *
     * 结果按请求序号落位而不是按完成先后收集：并发完成顺序不定，
     * 直接 push 会让"第几张"和界面上的位置对不上。
     */
    async generateBatchFromImage(
        prompt: string,
        sourceImage: OpenRouterImageSource,
        options: {
            model?: OpenRouterGeminiImageModel | string;
            count?: number;
            timeoutMs?: number;
            referenceImages?: Buffer[];
            signal?: AbortSignal;
            aspectRatio?: string;
            imageSize?: '1K' | '2K' | '4K';
        } | undefined,
        onProgress?: OpenRouterGeminiImageProgressCallback
    ): Promise<{
        results: OpenRouterGeminiImageResult[];
        failures: Array<{ index: number; message: string }>;
    }> {
        const requested = Number(options?.count);
        const count = Number.isFinite(requested) && requested > 1
            ? Math.min(Math.floor(requested), MAX_PARALLEL_IMAGE_COUNT)
            : 1;

        if (count === 1) {
            const single = await this.generateFromImage(prompt, sourceImage, options, onProgress);
            return { results: [single], failures: [] };
        }

        // 先把请求体准备好——包含唯一一次源图编码。后面 N 个请求共用它。
        const prepared = await this.prepareGenerationRequest(prompt, sourceImage, options, onProgress, count);

        // 模型原生支持一次出多张时，一个请求就够了：比并发 N 次更快，
        // 也更省——并发是按次计费的，原生多张只算一次调用。
        const nativeLimit = MODEL_NATIVE_BATCH_LIMIT[prepared.model] || 1;
        if (nativeLimit > 1) {
            onProgress?.({
                progress: 46,
                stage: 'provider-submit',
                message: `正在生成 ${count} 张（模型原生支持一次多张）`
            });
            const resolved = await this.requestImage(prepared.body, prepared.timeoutMs, onProgress, options?.signal);
            const results = await Promise.all(
                resolved.images.map((image) => this.describeGeneratedImage({
                    image,
                    mimeType: resolved.mimeType,
                    payload: resolved.payload,
                    model: prepared.model,
                    aspectRatio: prepared.aspectRatio,
                    imageSize: prepared.imageSize
                }))
            );
            const missing = count - results.length;
            return {
                results,
                failures: missing > 0
                    ? [{ index: results.length, message: `请求了 ${count} 张，上游只返回 ${results.length} 张` }]
                    : []
            };
        }

        onProgress?.({
            progress: 46,
            stage: 'provider-submit',
            message: `正在并发生成 ${count} 张`
        });

        const slots: Array<OpenRouterGeminiImageResult | null> = new Array(count).fill(null);
        const failures: Array<{ index: number; message: string }> = [];
        let finished = 0;

        const runOne = async (index: number): Promise<void> => {
            try {
                const resolved = await this.requestImage(prepared.body, prepared.timeoutMs, undefined, options?.signal);
                slots[index] = await this.describeGeneratedImage({
                    image: resolved.image,
                    mimeType: resolved.mimeType,
                    payload: resolved.payload,
                    model: prepared.model,
                    aspectRatio: prepared.aspectRatio,
                    imageSize: prepared.imageSize
                });
            } catch (error: any) {
                failures.push({ index, message: `第 ${index + 1} 张生成失败：${error?.message || '未知错误'}` });
            } finally {
                finished += 1;
                onProgress?.({
                    progress: 46 + Math.round((finished / count) * 40),
                    stage: 'provider-ready',
                    message: `已完成 ${finished}/${count} 张`
                });
            }
        };

        // 分批并发而不是一次全发：这些模型对并发有限流，一次全打出去容易整批被拒。
        for (let start = 0; start < count; start += PARALLEL_IMAGE_BATCH_SIZE) {
            const batch: Promise<void>[] = [];
            for (let i = start; i < Math.min(start + PARALLEL_IMAGE_BATCH_SIZE, count); i++) {
                batch.push(runOne(i));
            }
            await Promise.all(batch);
        }

        const results = slots.filter((item): item is OpenRouterGeminiImageResult => item !== null);
        if (results.length === 0) {
            throw this.createStageError(
                `${count} 张全部生成失败。${failures[0]?.message || ''}`.trim(),
                'provider-ready'
            );
        }
        return { results, failures };
    }

    /**
     * 整图重生的请求体。与 buildRequestBody（局部重绘）分开维护：
     * 那次 imageUrl 静默丢图的 bug 教训是"图块字段名必须逐路径钉死"，
     * 两条路径各自显式构造，谁改了字段名都会在契约测试里立刻暴露。
     */
    buildGenerationRequestBody(input: {
        model: OpenRouterGeminiImageModel;
        instruction: string;
        sourceDataUrl: string;
        referenceDataUrls: string[];
        aspectRatio: string;
        imageSize: '1K' | '2K' | '4K';
        count?: number;
    }): Record<string, unknown> {
        return this.buildImagesApiBody({
            model: input.model,
            prompt: input.instruction,
            // 源图放第一张，与提示词里"Image 1 is the source image"的编号约定一致
            imageDataUrls: [input.sourceDataUrl, ...input.referenceDataUrls],
            aspectRatio: input.aspectRatio,
            imageSize: input.imageSize,
            count: input.count
        });
    }

    /**
     * 图像 API 的请求体。两条路径（局部重绘 / 整图重生）只在提示词与参考图顺序上不同，
     * 参数形状完全一致，所以收在这里一处构造——分辨率参数写错一次的代价是每次调用都白付钱。
     *
     * 关键字段：
     * - `resolution`：顶层参数，取值 512/1K/2K/4K。**不是** `image_config.image_size`，
     *   后者是 Google 原生字段名，OpenRouter 不认，发过去等于没发（4K 失效的根因）。
     * - `output_format: 'png'`：显式要无损 PNG。chat 路径没有这个开关，上游一直回 JPEG
     *   （有损 + 无 ICC），是色差链条上的最后一环；这里直接从源头断掉。
     * - `input_references`：图生图的输入图，接受 base64 data URL，上限 14 张。
     * - `n: 1`：这些模型的 supported_parameters 里 n 的 min/max 都是 1，不留误传空间。
     */
    buildImagesApiBody(input: {
        model: OpenRouterGeminiImageModel;
        prompt: string;
        imageDataUrls: string[];
        aspectRatio: string;
        imageSize: '1K' | '2K' | '4K';
        /** 单次请求要几张；只有声明原生多张的模型会真的用到 */
        count?: number;
    }): Record<string, unknown> {
        const body: Record<string, unknown> = {
            model: input.model,
            prompt: input.prompt,
            // 单次张数按模型能力给：OpenAI 系原生支持 1-10，一次请求出多张比并发多次
            // 又快又省；Gemini 系只能 1，多张走并发。
            n: Math.max(1, Math.min(input.count || 1, MODEL_NATIVE_BATCH_LIMIT[input.model] || 1)),
            // 要无损 PNG。注意：这个字段被 schema 接受，但**这条上游实测不照做**，
            // 五次调用全部返回 image/jpeg（同一面板里 Seedream 返回的就是 png）。
            // 仍然发它——哪天上游支持了就自动生效，而且它不会引发 400。
            output_format: 'png'
        };
        // 这里**刻意不发** quality / output_compression。两个参数确实被 schema 识别，
        // 但实测（拿真实结果图对照三种 JPEG 设置）顶格与默认的色彩差距只有 0.045%——
        // 肉眼不可见，而 q100 会把体积从 3MB 抬到 13MB、下载慢四倍。
        // 用四倍代价换不可见的收益，是净亏。真正的色调变化不在编码这一层（见下）。

        if (input.imageDataUrls.length > 0) {
            body.input_references = input.imageDataUrls.map((url) => ({
                type: 'image_url',
                image_url: { url }
            }));
        }

        // 档位与比例只对声明支持的模型下发：发给不认识的模型会被 Zod 校验直接 400。
        if (MODELS_WITH_RESOLUTION_PARAMS.includes(input.model)) {
            body.resolution = input.imageSize;
            body.aspect_ratio = input.aspectRatio;
        } else if (MODEL_ASPECT_RATIOS[input.model]) {
            // OpenAI 系不支持 resolution（输出尺寸由模型决定），但支持 aspect_ratio
            body.aspect_ratio = input.aspectRatio;
        }

        // quality 只发给声明支持的模型。给 Gemini 发过实测无效（收益 0.045%、体积四倍），
        // 所以不做无差别下发——参数发给不认识它的模型，最好的结果也只是被忽略。
        if (MODELS_WITH_QUALITY_PARAM.includes(input.model)) {
            body.quality = 'high';
        }

        return body;
    }

    /** 用户显式选的比例只在支持清单内才放行；不认识的显式报错，不静默换档。 */
    private resolveRequestedAspectRatio(
        requested: string | undefined,
        width: number,
        height: number,
        model?: OpenRouterGeminiImageModel
    ): string {
        // 比例集按模型取：OpenAI 系不支持 4:5 / 5:4，发过去会被直接 400
        const allowed = (model && MODEL_ASPECT_RATIOS[model]) || SUPPORTED_ASPECT_RATIOS;
        const normalized = String(requested || '').trim();
        if (!normalized) {
            return this.resolveAspectRatio(width, height, allowed);
        }
        if ((allowed as readonly string[]).includes(normalized)) {
            return normalized;
        }
        throw this.createStageError(
            `图像比例「${normalized}」不在当前模型的支持清单内。可用：${allowed.join('、')}`,
            'provider-validate'
        );
    }

    private resolveRequestedImageSize(
        requested: '1K' | '2K' | '4K' | undefined,
        width: number,
        height: number
    ): '1K' | '2K' | '4K' {
        if (requested === '1K' || requested === '2K' || requested === '4K') {
            return requested;
        }
        return this.resolveImageSize(width, height);
    }

    private buildRegenerationInstruction(prompt: string, referenceCount: number): string {
        const lines = [
            'You are regenerating an image (image-to-image), like the image variation tools in Photoshop.',
            'Image 1 is the source image to transform.',
            referenceCount > 0
                ? `The remaining ${referenceCount} image(s) are appearance references supplied by the user: match the subject, material, color and styling shown there.`
                : '',
            `Task: ${prompt}`,
            '',
            'Hard requirements:',
            '- Return ONE image.',
            '- Keep the source image\'s subject, composition, framing and camera position unless the task explicitly asks to change them.',
            '- Do not re-compose, zoom, pan or rotate on your own.',
            '- Keep text, logos and key visual elements intact and legible unless the task says to replace them.',
            '- Match the source image\'s photographic properties (light direction, color temperature, depth of field, grain) for anything you add or change.',
            '',
            'Never do:',
            '- Never invent a new scene unrelated to the source image.',
            '- Never place the subject on a white, gray, gradient or studio background unless the task asks for it.',
            '- Never add watermarks, borders, labels or annotations to the result.'
        ];

        return lines.filter((line) => line !== '').join('\n');
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
        return this.buildImagesApiBody({
            model: input.model,
            prompt: input.instruction,
            // 顺序即提示词里的编号：Image 1 = 工作图，Image 2 = 选区描边引导图，其后为用户参考图
            imageDataUrls: [input.sourceDataUrl, input.guideDataUrl, ...input.referenceDataUrls],
            aspectRatio: input.aspectRatio,
            imageSize: input.imageSize
        });
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

        // 旧的带日期写法：解析成它本就指向的正式 ID。这不是"静默换模型"——
        // OpenRouter 本来就在私下做同一件事，只是它那条路径会把 image_config 丢掉。
        // 在我们这边显式做掉，才能让 4K 真正发出去。
        const resolved = LEGACY_MODEL_ALIASES[normalized];
        if (resolved) {
            console.log(
                `[OpenRouter] 模型 id「${normalized}」带日期后缀，不是 OpenRouter 的真实模型 id，` +
                `已解析为「${resolved}」（该后缀实为该模型条目的创建日期 / Google 上游快照名）`
            );
            return resolved;
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
        // 目前不追加额外规则：上面的通用摄影一致性要求已覆盖当前的失败模式。
        // 需要补品类专属纪律时在这里加，每条一行、以 '- ' 开头。
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

    private resolveAspectRatio(
        width: number,
        height: number,
        candidates: readonly string[] = SUPPORTED_ASPECT_RATIOS
    ): string {
        const ratio = width / height;
        let best: string = candidates[0];
        let bestDelta = Number.POSITIVE_INFINITY;

        for (const candidate of candidates) {
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

    /**
     * 把推断/用户指定的档位钳到模型当前真实支持的档位（MODEL_IMAGE_SIZE_CAPS）。
     * 只向下压不向上抬：用户要 4K 而模型只到 2K 时给 2K，
     * 实际用哪一档会随结果如实回传面板，不静默假装出了 4K。
     */
    private capImageSize(
        model: OpenRouterGeminiImageModel,
        size: '1K' | '2K' | '4K'
    ): '1K' | '2K' | '4K' {
        const caps = MODEL_IMAGE_SIZE_CAPS[model];
        if (!caps || caps.includes(size)) return size;
        const order: Array<'1K' | '2K' | '4K'> = ['1K', '2K', '4K'];
        for (let index = order.indexOf(size) - 1; index >= 0; index--) {
            if (caps.includes(order[index])) return order[index];
        }
        return caps[caps.length - 1];
    }

    /**
     * 把图片编码成 inline data URL——预算内**绝不做有损压缩**。
     *
     * 这里的取舍是「分辨率可以降，色度不能压」，与原实现相反。理由与实测代价：
     *
     * 1. 原实现超预算时走"保持分辨率、降 WebP 质量"的降档循环。sharp 的有损 WebP
     *    **强制 YUV420 色度子采样且无法关闭**，色度分辨率直接减半。同仓库的 Seedream
     *    路径反而做对了——用 mozjpeg + chromaSubsampling:'4:4:4' 保住色度（见 fitToUploadLimit）。
     * 2. 这个损伤**高度依赖画面内容**，实测（3072×4096 合成图 + 真实结果图对照）：
     *    - 平滑照片内容：有损 q92 的色偏很小（RGB 平均偏差约 1.06，无损为 0.77），差距不大
     *    - 高饱和硬边界（撞色条纹、色块、文字 logo）：色度子采样让饱和度畸变达 **+6.48%**
     *    电商产品图恰恰是后一类，所以这条路必须断掉。
     * 3. 降采样也**不是零代价**：Lanczos3 的低通效应实测让平均饱和度降约 0.58%。
     *    但它是可控、可预期、且不伤色度分辨率的，比有损压缩的色彩混叠更可接受。
     *    所以顺序是「先尽力保住原分辨率的无损编码，真超限了才降采样」，而不是一上来就缩。
     * 4. 输入分辨率不决定输出分辨率——图像 API 按顶层 aspect_ratio + resolution 出图，
     *    把源图从 4096 降到 2700 不会让结果变小；模型内部本就会把输入缩到千级像素。
     * 5. .rotate() 按 EXIF 转正、.keepIccProfile() 保留色彩配置文件，两者都不能丢。
     */
    private async encodeImageDataUrl(
        imageBuffer: OpenRouterImageSource,
        role: 'source' | 'guide' | 'reference',
        budgetBytes: number
    ): Promise<string> {
        // 第一级：原分辨率无损 PNG（色彩与细节都最保真）
        const pngOutput = await openSource(imageBuffer)
            .rotate()
            .keepIccProfile()
            .png({ compressionLevel: 6, adaptiveFiltering: true })
            .toBuffer();

        if (pngOutput.length <= budgetBytes) {
            return this.toDataUrl(pngOutput, 'image/png');
        }

        // 第二级：原分辨率无损 WebP（比 PNG 小 ~25%，同样零损失）
        const losslessWebpOutput = await openSource(imageBuffer)
            .rotate()
            .keepIccProfile()
            .webp({ lossless: true })
            .toBuffer();

        if (losslessWebpOutput.length <= budgetBytes) {
            console.log(
                `[OpenRouter] ${role} 图原分辨率 PNG 超预算（${Math.round(pngOutput.length / 1024 / 1024)}MB ` +
                `> ${Math.round(budgetBytes / 1024 / 1024)}MB），改用无损 WebP` +
                `（${Math.round(losslessWebpOutput.length / 1024 / 1024)}MB），像素零损失`
            );
            return this.toDataUrl(losslessWebpOutput, 'image/webp');
        }

        // 第三级：降分辨率 + 保持无损。绝不降色彩质量。
        return this.encodeDownscaledLossless(imageBuffer, role, losslessWebpOutput.length, budgetBytes);
    }

    /**
     * 把合计预算分摊到每张图。
     *
     * 局部重绘会带源图 + 引导图 + 参考图，整图重生带源图 + 参考图。
     * 均分是最简单且不会撞上限的分法：真正需要保真的是源图，而源图通常也是最大的一张，
     * 均分后它拿到的额度仍远高于原先固定的 7MB。
     */
    private resolvePerImageBudget(imageCount: number): number {
        return Math.floor(MAX_TOTAL_INLINE_IMAGE_BYTES / Math.max(1, imageCount));
    }

    /**
     * 4K 档下把源图长边压到 SOURCE_MAX_EDGE_FOR_4K。
     *
     * **这是 4K 卡死的根因修复，由真实调用实测确认**（见 SOURCE_MAX_EDGE_FOR_4K 的数据）：
     * 同样的模型、档位、比例，只把源图从 3072 换成 2048，就从"跑满 900 秒不返回"
     * 变成"36 秒出图"。
     *
     * 不牺牲输出质量：输出分辨率由顶层 resolution 决定、与输入尺寸无关——
     * 实测两次都稳定出 3584×4800（3:4 的 4K），源图 512 和 2048 出的尺寸完全一样。
     *
     * 只对 4K 生效：1K/2K 用同样的大源图跑得很好（Flash 2K 全程 31 秒、
     * Pro 2K 45 秒），是 4K 这一档才会撞上边界，没有理由连带限制它们。
     */
    private async limitSourceForHeavyTier(
        sourceImage: OpenRouterImageSource,
        imageSize: '1K' | '2K' | '4K'
    ): Promise<OpenRouterImageSource> {
        if (imageSize !== '4K') {
            return sourceImage;
        }

        const metadata = await openSource(sourceImage).metadata();
        const width = Math.max(1, metadata.width || 1);
        const height = Math.max(1, metadata.height || 1);
        const longEdge = Math.max(width, height);
        if (longEdge <= SOURCE_MAX_EDGE_FOR_4K) {
            return sourceImage;
        }

        const scale = SOURCE_MAX_EDGE_FOR_4K / longEdge;
        const targetWidth = Math.max(16, Math.round(width * scale));
        const targetHeight = Math.max(16, Math.round(height * scale));
        console.log(
            `[OpenRouter] 4K 档源图降到 ${targetWidth}×${targetHeight}（原 ${width}×${height}）：` +
            `输出分辨率由 resolution 决定，不受输入尺寸影响，缩小只是减轻上游的输入处理量`
        );

        return openSource(sourceImage)
            .rotate()
            .resize(targetWidth, targetHeight, { kernel: 'lanczos3', fit: 'inside', withoutEnlargement: true })
            .keepIccProfile()
            .png({ compressionLevel: 6 })
            .toBuffer();
    }

    /**
     * 按输出档位取超时。调用方显式指定时以它为准（但不低于 30 秒）。
     *
     * 导出成 public 是为了让 UXP 侧能算出**比这里更长**的等待时间：
     * 谁先超时决定了用户看到哪条错误信息，而 Agent 这边的报文才带 provider 原文。
     */
    resolveTimeoutMs(imageSize: '1K' | '2K' | '4K', requestedMs?: number): number {
        if (Number.isFinite(requestedMs) && (requestedMs as number) > 0) {
            return Math.max(30_000, requestedMs as number);
        }
        return TIMEOUT_MS_BY_IMAGE_SIZE[imageSize] ?? TIMEOUT_MS_BY_IMAGE_SIZE['2K'];
    }

    /**
     * 原分辨率无损编码超预算时，逐级降采样直到进预算——全程无损编码。
     *
     * 目标像素数用"实测字节/像素"反推而不是拍固定档位：无损 WebP 的体积近似正比于
     * 像素数，用第一次实测的 bytesPerPixel 一步就能算到接近预算的尺寸，
     * 后续几轮只是收敛兜底（照片纹理复杂度会让首次估算偏乐观）。
     */
    private async encodeDownscaledLossless(
        imageBuffer: OpenRouterImageSource,
        role: 'source' | 'guide' | 'reference',
        fullSizeLosslessBytes: number,
        budgetBytes: number
    ): Promise<string> {
        const metadata = await openSource(imageBuffer).rotate().metadata();
        const originalWidth = Math.max(1, metadata.width || 1);
        const originalHeight = Math.max(1, metadata.height || 1);
        const originalPixels = originalWidth * originalHeight;

        // 留 8% 余量给 prompt 等其余请求体字段
        const budget = budgetBytes * 0.92;
        const bytesPerPixel = fullSizeLosslessBytes / originalPixels;

        let targetPixels = Math.floor(budget / bytesPerPixel);

        for (let attempt = 0; attempt < 5; attempt += 1) {
            const scale = Math.sqrt(targetPixels / originalPixels);
            if (scale >= 1) {
                targetPixels = Math.floor(originalPixels * 0.8);
                continue;
            }

            const width = Math.max(16, Math.round(originalWidth * scale));
            const height = Math.max(16, Math.round(originalHeight * scale));

            const resized = await openSource(imageBuffer)
                .rotate()
                .resize(width, height, { kernel: 'lanczos3', fit: 'inside', withoutEnlargement: true })
                .keepIccProfile()
                .webp({ lossless: true })
                .toBuffer();

            if (resized.length <= budgetBytes) {
                console.log(
                    `[OpenRouter] ${role} 图降采样 ${originalWidth}×${originalHeight} → ${width}×${height} ` +
                    `（${Math.round(resized.length / 1024)}KB，无损 WebP：不做色度压缩，` +
                    `代价是重采样的轻微低通效应）`
                );
                return this.toDataUrl(resized, 'image/webp');
            }

            // 按这一轮的实测比例重估，比固定步长收敛快
            targetPixels = Math.floor(targetPixels * (budget / resized.length));
        }

        throw this.createStageError(
            `${role === 'source' ? '源图' : role === 'reference' ? '参考图' : '引导图'}` +
            `无法在不损失色彩的前提下压进 ${Math.round(budgetBytes / 1024 / 1024)}MB 的内联额度` +
            `（原图 ${originalWidth}×${originalHeight}，无损编码 ${Math.round(fullSizeLosslessBytes / 1024 / 1024)}MB）。` +
            `请把源图层尺寸改小后重试——本服务不会用有损压缩换通过率，那正是色差的来源。`,
            'provider-validate'
        );
    }

    private toDataUrl(buffer: Buffer, mimeType: string): string {
        return `data:${mimeType};base64,${buffer.toString('base64')}`;
    }

    /**
     * 把"请求了什么"和"上游实际给了什么"对齐成一份结果，并在两者不符时如实说明。
     *
     * 存在的理由是一次真实事故：面板选 4K、请求体确实带了 image_size:'4K'，
     * 上游却连续三次返回 896×1200，而链路里**没有任何一处记录上游实际出了多大**，
     * 用户只能看到"选了 4K 但不清晰"，排查时也无从判断是被忽略、被降级还是被路由到别的
     * provider。档位不生效不该只留在用户的主观感受里。
     */
    private async describeGeneratedImage(input: {
        image: Buffer;
        mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
        payload: OpenRouterImageResponse;
        model: OpenRouterGeminiImageModel;
        aspectRatio: string;
        imageSize: '1K' | '2K' | '4K';
    }): Promise<OpenRouterGeminiImageResult> {
        const metadata = await sharp(input.image).metadata();
        const actualWidth = Math.max(0, metadata.width || 0);
        const actualHeight = Math.max(0, metadata.height || 0);
        const upstreamModel = String(input.payload?.model || '').trim() || undefined;
        const upstreamProvider = String(input.payload?.provider || '').trim() || undefined;
        const cost = input.payload?.usage?.cost;

        const actualLongEdge = Math.max(actualWidth, actualHeight);
        const expectedLongEdge = IMAGE_SIZE_EXPECTED_LONG_EDGE[input.imageSize];
        const isDowngraded = actualLongEdge > 0 && actualLongEdge < expectedLongEdge * 0.75;

        // 上游给的是有损 JPEG（output_format:'png' 发了但不生效）。色度子采样是这类图
        // 色偏的主要来源：4:2:0 会把色度分辨率减半，对撞色/硬边界的电商图伤害最大。
        // 记下来才能判断 quality / output_compression 这两个参数到底有没有起作用。
        const chroma = String((metadata as any).chromaSubsampling || '').trim();
        const jpegQualityHint = chroma ? `，色度采样 ${chroma}` : '';

        console.log(
            `[OpenRouter] 出图结果：${actualWidth}×${actualHeight} ${input.mimeType}${jpegQualityHint}，` +
            `请求 resolution=${input.imageSize} @ aspect_ratio=${input.aspectRatio}，` +
            `模型=${input.model}` +
            `${upstreamModel && upstreamModel !== input.model ? `（上游回报 ${upstreamModel}）` : ''}` +
            `${upstreamProvider ? `，provider=${upstreamProvider}` : ''}` +
            `${typeof cost === 'number' ? `，本次花费 $${cost}` : ''}`
        );

        // 面板上这句话给设计师看，所以只讲"要的是什么、实际拿到什么、能怎么办"。
        // 诊断细节（实际路由到的模型、参数下发情况）走上面那行日志，不往界面上倒。
        let sizeDowngradeNotice: string | undefined;
        if (isDowngraded) {
            sizeDowngradeNotice =
                `选的是 ${input.imageSize}，但这次模型只给了 ${actualWidth}×${actualHeight}` +
                `（${input.imageSize} 应该在 ${expectedLongEdge}px 左右）。` +
                `换成另一个模型再试一次就能知道是这个模型的限制，还是平台这次没给足。`;
            console.warn(
                `[OpenRouter] 档位未生效：请求 resolution=${input.imageSize}，实际 ${actualWidth}×${actualHeight}，` +
                `请求模型=${input.model}，上游回报=${upstreamModel || '(未回报)'}`
            );
        }

        return {
            image: input.image,
            model: input.model,
            mimeType: input.mimeType,
            aspectRatio: input.aspectRatio,
            imageSize: input.imageSize,
            actualWidth,
            actualHeight,
            upstreamModel,
            upstreamProvider,
            sizeDowngradeNotice
        };
    }

    /**
     * 统一发送图像 API 请求并取出图片字节。
     *
     * 图像 API 直接返回 base64（`data[0].b64_json`），不像 chat 路径那样可能给出一个
     * 需要二次下载的 URL。仍保留 url 兜底：万一某个 provider 返回链接，报错好过静默丢图。
     */
    private async requestImage(
        body: Record<string, unknown>,
        timeoutMs: number,
        onProgress?: OpenRouterGeminiImageProgressCallback,
        signal?: AbortSignal
    ): Promise<{
        image: Buffer;
        images: Buffer[];
        mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
        payload: OpenRouterImageResponse;
    }> {
        onProgress?.({
            progress: 46,
            stage: 'provider-submit',
            message: '已提交，等待模型出图'
        });

        // 上传与"等模型出图"必须分开计时。真机遇到 Pro+4K 跑满 900 秒无结果，
        // 而同样大小的源图在 Flash 2K 上 31 秒就走完全程——只看总耗时无法判断
        // 时间花在传图还是模型算图上，也就没法决定该限制源图尺寸还是换模型。
        const submittedAt = Date.now();
        let uploadFinishedAt = 0;
        let lastReportedUploadPercent = -1;

        let response;
        try {
            response = await axios.post<OpenRouterImageResponse>(
                OPENROUTER_IMAGES_ENDPOINT,
                body,
                {
                    timeout: timeoutMs,
                    signal,
                    ...getAxiosProxyConfig(),
                    headers: {
                        Authorization: `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json',
                        'HTTP-Referer': 'https://designecho.app',
                        'X-Title': 'DesignEcho Agent'
                    },
                    // 上传阶段是**唯一有真实进度可报**的一段（等模型出图那段上游不给任何事件）。
                    // 报给面板时压到 46→64 这个区间，后面留给"等模型"。
                    onUploadProgress: (event: any) => {
                        const total = Number(event?.total) || 0;
                        const loaded = Number(event?.loaded) || 0;
                        if (total <= 0) return;

                        const uploadPercent = Math.min(100, Math.round((loaded / total) * 100));
                        if (uploadPercent === lastReportedUploadPercent) return;
                        lastReportedUploadPercent = uploadPercent;

                        if (uploadPercent >= 100 && uploadFinishedAt === 0) {
                            uploadFinishedAt = Date.now();
                            console.log(
                                `[OpenRouter] 上传完成：${(total / 1024 / 1024).toFixed(1)}MB 用了 ` +
                                `${((uploadFinishedAt - submittedAt) / 1000).toFixed(1)} 秒，开始等模型出图`
                            );
                        }

                        onProgress?.({
                            progress: 46 + Math.round(uploadPercent * 0.18),
                            stage: 'provider-upload-progress',
                            message: `正在发送原图 ${uploadPercent}%`
                        });
                    }
                }
            );
        } catch (error: any) {
            // 取消是用户主动行为，不是故障，要和真正的失败区分开
            if (signal?.aborted || error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError') {
                throw this.createStageError('已停止本次生成', 'provider-canceled');
            }
            const waitedSeconds = ((Date.now() - submittedAt) / 1000).toFixed(1);
            const uploadSeconds = uploadFinishedAt > 0
                ? ((uploadFinishedAt - submittedAt) / 1000).toFixed(1)
                : '未完成';
            console.warn(
                `[OpenRouter] 请求失败：共等待 ${waitedSeconds} 秒（其中上传 ${uploadSeconds} 秒）`
            );
            throw this.wrapAxiosError(error);
        }

        // 成功路径也把两段耗时记下来：这是判断"该限源图尺寸还是该换模型"的唯一依据
        const totalSeconds = (Date.now() - submittedAt) / 1000;
        const uploadSeconds = uploadFinishedAt > 0 ? (uploadFinishedAt - submittedAt) / 1000 : 0;
        console.log(
            `[OpenRouter] 耗时构成：上传 ${uploadSeconds.toFixed(1)} 秒 + ` +
            `模型出图 ${(totalSeconds - uploadSeconds).toFixed(1)} 秒 = 共 ${totalSeconds.toFixed(1)} 秒`
        );

        const payload = response.data;
        const items = Array.isArray(payload?.data) ? payload.data : [];
        const first = items[0];
        const base64 = String(first?.b64_json || '').trim();

        if (!base64) {
            const fallbackUrl = String(first?.url || '').trim();
            const detail = fallbackUrl
                ? `上游返回的是图片链接而不是 base64（${fallbackUrl.slice(0, 80)}…），本服务只处理 base64 响应`
                : String(payload?.error?.message || '').trim() || '响应里没有 data[0].b64_json';
            throw this.createStageError(`OpenRouter 没有返回可用图片：${detail}`, 'provider-ready');
        }

        onProgress?.({
            progress: 88,
            stage: 'provider-ready',
            message: '模型已出图，正在取回'
        });

        // n>1 时上游一次返回多张，全部取回——只读 data[0] 会把已经付过钱的图丢掉
        const images = items
            .map((item) => String(item?.b64_json || '').trim())
            .filter((b64) => b64.length > 0)
            .map((b64) => Buffer.from(b64, 'base64'));

        return {
            image: images[0],
            images,
            mimeType: this.normalizeMimeType(first?.media_type),
            payload
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
