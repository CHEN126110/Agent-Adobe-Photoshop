export const DEFAULT_IMAGE_TO_IMAGE_MODEL = 'doubao-seedream-5-0-260128';
export const DEFAULT_IMAGE_TO_IMAGE_SIZE_PRESET = '2K';
export const JIMENG_IMAGE_TO_IMAGE_MODEL = 'jimeng-seedream-4-6';

const JIMENG_IMAGE_TO_IMAGE_CAPTURE_MAX_EDGE = 4096;

const IMAGE_TO_IMAGE_MODEL_SIZE_CAPABILITIES: Record<string, { defaultSize: string; supportedSizes: string[] }> = {
    'doubao-seedream-5-0-260128': {
        defaultSize: '3K',
        supportedSizes: ['2K', '3K']
    },
    // Pro（260628）：方舟仅接受 1K / 2K 分辨率档位；与 Agent/WebView 能力表保持一致。
    'doubao-seedream-5-0-pro-260628': {
        defaultSize: '2K',
        supportedSizes: ['1K', '2K']
    },
    'doubao-seedream-5-0-lite-260128': {
        defaultSize: '3K',
        supportedSizes: ['2K', '3K', '4K']
    },
    'doubao-seedream-4-5-251128': {
        defaultSize: '2K',
        supportedSizes: ['2K', '4K']
    },
    'doubao-seedream-4-0-250828': {
        defaultSize: '2K',
        supportedSizes: ['1K', '2K', '4K']
    },
    [JIMENG_IMAGE_TO_IMAGE_MODEL]: {
        defaultSize: '2K',
        supportedSizes: ['1K', '2K', '4K']
    },
    // OpenRouter Gemini 图像模型：输出走 aspect_ratio + image_size 档位（1K/2K/4K），
    // 比例档位由 Agent 端服务吸附，这里只约束档位下拉与抓图边长。
    //
    // 档位取值来自**图像 API 的 supported_parameters**（/api/v1/images/models，公开免鉴权），
    // 四个 Gemini 图像条目的 resolution 都含 4K。512 档暂不开放（面板没有这一档）。
    //
    // 两个已修正的历史错误，别再退回去：
    // 1. 模型 id 用不带日期后缀的写法。`...-preview-20251120` 不是 OpenRouter 的模型 id，
    //    而是条目创建日期 / Google 上游快照名，发出去会被宽松匹配解析回本体。
    // 2. 分辨率走图像 API 的顶层 `resolution`，不是 chat 路径上的 `image_config.image_size`——
    //    后者是 Google 原生字段名，OpenRouter 不认，档位因此从未生效（恒出该比例的 1K 档）。
    // Agent 侧另有 capImageSize 钳制与 legacy 别名解析，三处要保持一致。
    'google/gemini-3-pro-image-preview': {
        defaultSize: '2K',
        supportedSizes: ['1K', '2K', '4K']
    },
    'google/gemini-3-pro-image': {
        defaultSize: '2K',
        supportedSizes: ['1K', '2K', '4K']
    },
    'google/gemini-3.1-flash-image-preview': {
        defaultSize: '2K',
        supportedSizes: ['1K', '2K', '4K']
    },
    'google/gemini-3.1-flash-image': {
        defaultSize: '2K',
        supportedSizes: ['1K', '2K', '4K']
    },
    // Smile AI Studio 网关（New API）。与上面 OpenRouter 的同名模型是**两条独立通道**，
    // 前缀 smile-ai/ 用于区分，别把两者的档位表混用：
    // - 档位由**模型名后缀**（-1k/-2k/-4k）决定，不是请求参数，Agent 侧 service 负责拼；
    //   实测 aspectRatio=1:1 时分别出 1024²、2048²、4096²，三档都真实生效。
    // - 比例由 imageConfig.aspectRatio 参数级精确控制（实测 16:9→1376x768、4:5→928x1152），
    //   这点强于走 chat 端点的路线——那条路比例只能靠提示词引导，锁不住。
    'smile-ai/gemini-3-pro-image-preview': {
        defaultSize: '2K',
        supportedSizes: ['1K', '2K', '4K']
    },
    'smile-ai/gemini-3.1-flash-image-preview': {
        defaultSize: '2K',
        supportedSizes: ['1K', '2K', '4K']
    },
    // gpt-image-2 走网关的 OpenAI 图像端点，没有档位概念，尺寸由 size 参数映射。
    // 只给一档，避免面板出现选了也不起作用的选项（与下方 openai/ 系同一处理）。
    'smile-ai/gpt-image-2': {
        defaultSize: '2K',
        supportedSizes: ['2K']
    },
    // OpenAI 系没有分辨率档位（images API 不声明 resolution），尺寸由模型自己定。
    // 只给一档，避免面板出现选了也不起作用的选项。
    'openai/gpt-image-2': {
        defaultSize: '2K',
        supportedSizes: ['2K']
    },
    'openai/gpt-5.4-image-2': {
        defaultSize: '2K',
        supportedSizes: ['2K']
    }
};

// Volcengine Seedream input hard limit: total pixels <= 6000 x 6000.
const SEEDREAM_MAX_TOTAL_PIXELS = 36_000_000;

export function normalizeImageToImageModel(model?: string): string {
    const normalized = String(model || '').trim();
    return normalized || DEFAULT_IMAGE_TO_IMAGE_MODEL;
}
export function resolveImageToImageSizePreset(model?: string, sizePreset?: string): string {
    const normalizedModel = normalizeImageToImageModel(model);
    const capabilities = IMAGE_TO_IMAGE_MODEL_SIZE_CAPABILITIES[normalizedModel]
        || IMAGE_TO_IMAGE_MODEL_SIZE_CAPABILITIES[DEFAULT_IMAGE_TO_IMAGE_MODEL];
    const normalizedSizePreset = String(sizePreset || '').trim().toUpperCase();
    if (capabilities.supportedSizes.includes(normalizedSizePreset)) {
        return normalizedSizePreset;
    }
    return capabilities.defaultSize;
}

/**
 * 等待 Agent 返回生成结果的超时（毫秒）。
 *
 * 必须**比 Agent 侧更长**：两侧谁先到期决定用户看到哪条错误。Agent 侧的报文带 provider
 * 原文（如 `timeout of 300000ms exceeded`），UXP 侧只能给出「请求超时: imageToImage.generate」，
 * 后者对排查毫无帮助。真机踩过这个坑：UXP 296 秒先到期，Agent 300 秒的具体错误没能传回面板。
 *
 * 档位对应 Agent 侧 TIMEOUT_MS_BY_IMAGE_SIZE，另加 60 秒余量覆盖 WebSocket 往返与落盘。
 * 4K 实测 300 秒不够（一次真机超时），给到 900 秒 + 余量。
 */
export function resolveImageToImageRequestTimeoutMs(sizePreset?: string): number {
    const normalized = String(sizePreset || '').trim().toUpperCase();
    const agentTimeoutMs = normalized === '4K' ? 900_000 : 300_000;
    return agentTimeoutMs + 60_000;
}

export function resolveImageToImageSnapshotMaxEdge(model?: string, sizePreset?: string): number {
    const normalizedModel = normalizeImageToImageModel(model);
    if (normalizedModel === JIMENG_IMAGE_TO_IMAGE_MODEL) {
        return JIMENG_IMAGE_TO_IMAGE_CAPTURE_MAX_EDGE;
    }

    const resolvedSizePreset = resolveImageToImageSizePreset(normalizedModel, sizePreset);
    const baseEdge = (() => {
        switch (resolvedSizePreset) {
            case '1K': return 1024;
            case '2K': return 2304;
            case '3K': return 3456;
            case '4K': return 4096;
            default: return 3456;
        }
    })();
    const totalPixelCap = Math.floor(Math.sqrt(SEEDREAM_MAX_TOTAL_PIXELS));
    return Math.max(14, Math.min(baseEdge, totalPixelCap));
}

/**
 * 像素模式（宽x高）下的抓图边长。
 *
 * 抓图边长决定送进模型的源图有多清晰。像素模式直接指定了输出尺寸，
 * 所以按输出长边取值最贴合；解析不出来时回落到档位推断，绝不无声地用一个更小的默认值——
 * 源图抓小了模型只能看到糊图，产出质量下降却没有任何报错线索。
 */
export function resolveImageToImageSnapshotMaxEdgeForExplicitSize(
    explicitSize: string,
    model?: string,
    sizePreset?: string
): number {
    const match = /^(\d{1,5})\s*x\s*(\d{1,5})$/i.exec(String(explicitSize || '').trim());
    if (!match) {
        return resolveImageToImageSnapshotMaxEdge(model, sizePreset);
    }

    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return resolveImageToImageSnapshotMaxEdge(model, sizePreset);
    }

    const longEdge = Math.max(width, height);
    const totalPixelCap = Math.floor(Math.sqrt(SEEDREAM_MAX_TOTAL_PIXELS));
    return Math.max(14, Math.min(longEdge, totalPixelCap));
}
