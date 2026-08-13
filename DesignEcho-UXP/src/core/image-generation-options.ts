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
