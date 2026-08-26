import type { UXPContext } from './types';
import sharp from 'sharp';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { volcengineSeedreamService, SeedreamInputError } from '../services/volcengine-seedream-service';
import { volcengineJimengImageService } from '../services/volcengine-jimeng-image-service';
import {
    isOpenRouterImageModelId,
    openRouterGeminiImageService
} from '../services/openrouter-gemini-image-service';
import { BinaryMessageType, getBinaryTypeName } from '../../shared/binary-protocol';
import {
    normalizeImageGenerationResultFormat,
    type ImageGenerationResultFormat
} from '../../shared/image-generation-result-format';

/** data URL（或裸 base64）→ Buffer；OpenRouter 图像服务只吃 Buffer，字符串归字符串的归处是火山系服务。 */
function dataUrlToBuffer(value: string): Buffer {
    const text = String(value || '').trim();
    const base64 = text.startsWith('data:') ? text.slice(text.indexOf(',') + 1) : text;
    return Buffer.from(base64, 'base64');
}

/**
 * 等待二进制 raw RGBA 帧到达（处理 ws 帧到达顺序晚于 JSON 请求的情况）
 */
async function waitForBinarySource(
    wsServer: UXPContext['wsServer'],
    requestId: number,
    expectedType: BinaryMessageType,
    timeoutMs: number = 8000
): Promise<{ buffer: Buffer; width: number; height: number; type: number }> {
    const received = await wsServer.waitForBinaryData(requestId, timeoutMs);
    if (received.header.type !== expectedType) {
        throw new Error(
            `Unexpected binary source type: requestId=${requestId}, expected=${getBinaryTypeName(expectedType)}, actual=${getBinaryTypeName(received.header.type)}`
        );
    }
    return {
        buffer: received.imageData,
        width: received.header.width,
        height: received.header.height,
        type: received.header.type
    };
}

/**
 * 把 UXP 直传的 raw RGBA 字节包装成 PNG dataURL
 *   - 用 sharp.raw({ width, height, channels: 4 }) → png({ compressionLevel: 6 })
 *   - 不做缩放、不做质量损失，由下游 fitToUploadLimit 做大小自适应
 */
async function rawRgbaToPngDataUrl(rawBuffer: Buffer, width: number, height: number): Promise<string> {
    if (!Buffer.isBuffer(rawBuffer) || rawBuffer.length === 0) {
        throw new Error('Raw RGBA buffer is empty');
    }
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
        throw new Error(`Invalid raw RGBA dimensions: ${width}x${height}`);
    }
    const expectedSize = width * height * 4;
    if (rawBuffer.length !== expectedSize) {
        throw new Error(`Raw RGBA buffer size mismatch: got ${rawBuffer.length}, expected ${expectedSize} (${width}x${height}x4)`);
    }
    const pngBuffer = await sharp(rawBuffer, {
        raw: { width, height, channels: 4 }
    })
        .png({ compressionLevel: 6, adaptiveFiltering: true })
        .toBuffer();
    return `data:image/png;base64,${pngBuffer.toString('base64')}`;
}

const IMAGE_TO_IMAGE_TEMP_DIR = path.join(os.tmpdir(), 'designecho-agent', 'image-to-image');
const IMAGE_TO_IMAGE_TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

async function ensureImageToImageTempDir(): Promise<string> {
    await fs.mkdir(IMAGE_TO_IMAGE_TEMP_DIR, { recursive: true });
    return IMAGE_TO_IMAGE_TEMP_DIR;
}

async function pruneImageToImageTempDir(): Promise<void> {
    try {
        const tempDir = await ensureImageToImageTempDir();
        const entries = await fs.readdir(tempDir, { withFileTypes: true });
        const now = Date.now();
        await Promise.all(entries.map(async (entry) => {
            if (!entry.isFile()) return;
            const fullPath = path.join(tempDir, entry.name);
            try {
                const stat = await fs.stat(fullPath);
                if (now - stat.mtimeMs > IMAGE_TO_IMAGE_TEMP_MAX_AGE_MS) {
                    await fs.unlink(fullPath);
                }
            } catch {
                // Ignore cleanup failures for stale temp files.
            }
        }));
    } catch {
        // Ignore temp directory cleanup failures so generation can continue.
    }
}

async function persistImageToTempFile(imageBuffer: Buffer, extension: string = 'png'): Promise<string> {
    const tempDir = await ensureImageToImageTempDir();
    await pruneImageToImageTempDir();
    const safeExt = extension.replace(/^\./, '') || 'png';
    const filename = `image-to-image_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${safeExt}`;
    const fullPath = path.join(tempDir, filename);
    await fs.writeFile(fullPath, imageBuffer);
    return fullPath;
}

function parseImageToImageError(error: any): {
    message: string;
    stage: string;
    code?: string;
    detail?: string;
} {
    if (error instanceof SeedreamInputError) {
        const role = error.role || 'source';
        return {
            message: error.message,
            stage: role === 'source' ? 'validate-source-image' : 'validate-reference-image',
            code: 'SeedreamInputError',
            detail: `本地校验未通过（${role}），请确认：1）图像已用无损 PNG/JPEG 编码；2）单边 ≥15px、总像素 ≤6000×6000；3）宽高比在 [1/16, 16]；4）文件 ≤10MB`
        };
    }

    const rawMessage = String(error?.message || error || 'Unknown image-to-image error');
    const codeMatch = rawMessage.match(/code=([^)]+)/i);
    const code = codeMatch?.[1]?.trim();
    const providerMessageMatch = rawMessage.match(/Seedream request failed:\s*(.+?)(?:\s*\(code=.*\))?$/i);
    const providerMessage = providerMessageMatch?.[1]?.trim();

    if (/参考图数量超限|reference image count exceeds/i.test(rawMessage)) {
        return {
            message: rawMessage,
            stage: 'validate-reference-image',
            code: 'ReferenceLimitExceeded',
            detail: '参考图数量超过当前模型支持上限'
        };
    }

    if (/invalid base64 image_url/i.test(rawMessage)) {
        return {
            message: rawMessage,
            stage: 'validate-source-image',
            code: 'InvalidParameter',
            detail: '这张图在发送过程中出了问题，模型没能读取。请重新选一次图层后重试。'
        };
    }

    if (/api key is not configured/i.test(rawMessage)) {
        return {
            message: rawMessage,
            stage: 'provider-auth',
            code,
            detail: 'Seedream API Key is missing'
        };
    }

    // OpenRouter 图像服务的错误自带分级与中文摘要（provider-validate/submit/ready/download），
    // 原样透传给面板，不套 Seedream 的正则模式匹配——套上去只会落成 provider-unknown。
    if (error?.provider === 'openrouter' || /openrouter/i.test(rawMessage)) {
        return {
            message: rawMessage,
            stage: String(error?.errorStage || 'provider-submit'),
            code: String(error?.errorCode || '').trim() || code,
            detail: String(error?.errorDetail || '').trim() || undefined
        };
    }

    if (/即梦ai access key id \/ secret access key 未配置|jimeng.*access key/i.test(rawMessage)) {
        return {
            message: rawMessage,
            stage: 'provider-auth',
            code: code || 'JimengAuthMissing',
            detail: '即梦图生图缺少 Access Key ID / Secret Access Key'
        };
    }

    if (/即梦图生图缺少 tos 配置|tos 上传配置不完整/i.test(rawMessage)) {
        return {
            message: rawMessage,
            stage: 'provider-upload',
            code: code || 'JimengTosConfigMissing',
            detail: '即梦 4.6 图生图需要先配置 TOS 桶、Endpoint、Region 与公网访问地址'
        };
    }

    if (/prompt is required/i.test(rawMessage)) {
        return {
            message: rawMessage,
            stage: 'validate-prompt',
            code,
            detail: 'Prompt is required'
        };
    }

    if (/raw rgba binary frame did not arrive/i.test(rawMessage)) {
        return {
            message: rawMessage,
            stage: 'capture-source-layer',
            code: code || 'BinaryFrameMissing',
            detail: '图层画面没能传到 Agent。请重启一次 Agent，然后重试。'
        };
    }

    if (/failed to encode raw rgba to png/i.test(rawMessage)) {
        return {
            message: rawMessage,
            stage: 'capture-source-layer',
            code: code || 'RawRgbaEncodeFailed',
            detail: '这个图层的画面没能转成图片。建议换一个普通像素图层重试——形状层、文字层可能不支持。'
        };
    }

    if (/binaryimagestore is unavailable|sourceFromBinary=true but sourceBinaryRequestId is missing/i.test(rawMessage)) {
        return {
            message: rawMessage,
            stage: 'capture-source-layer',
            code: code || 'BinarySourceConfig',
            detail: '图片传输通道还没就绪。请完整重启 Agent（只重载插件不够），然后重试。'
        };
    }

    if (/source image is required/i.test(rawMessage)) {
        return {
            message: rawMessage,
            stage: 'validate-source-image',
            code,
            detail: 'Source image is required'
        };
    }

    if (/does not support size preset|不支持分辨率档位/i.test(rawMessage)) {
        return {
            message: rawMessage,
            stage: 'validate-size-preset',
            code: code || 'InvalidSizePreset',
            detail: '所选分辨率档位不受当前模型支持，请重新选择模型可用的档位'
        };
    }

    if (/parameter [`']?size[`']?.*(?:not valid|widthxheight|supported size preset)/i.test(rawMessage)) {
        return {
            message: '当前模型不支持所选输出分辨率',
            stage: 'validate-size-preset',
            code: code || 'InvalidSizePreset',
            detail: providerMessage || '请重新选择当前模型支持的分辨率档位后再试'
        };
    }

    if (/output_format.+not supported by the current model/i.test(rawMessage)) {
        return {
            message: rawMessage,
            stage: 'provider-request',
            code: code || 'InvalidParameter',
            detail: 'The selected Seedream model does not support the current output format parameter'
        };
    }

    if (/request failed/i.test(rawMessage)) {
        if (/\b401\b|\b403\b/.test(rawMessage)) {
            return {
                message: rawMessage,
                stage: 'provider-auth',
                code,
                detail: 'Ark API Key is invalid, unauthorized, or Seedream model access is not enabled'
            };
        }

        return {
            message: rawMessage,
            stage: 'provider-request',
            code,
            detail: providerMessage || 'Seedream provider request failed'
        };
    }

    if (/did not return any images|missing image data/i.test(rawMessage)) {
        return {
            message: rawMessage,
            stage: 'provider-result',
            code,
            detail: 'Seedream did not return a usable result image'
        };
    }

    if (/timeout|timed out|aborted/i.test(rawMessage)) {
        return {
            message: rawMessage,
            stage: 'provider-timeout',
            code,
            detail: 'The provider request timed out'
        };
    }

    return {
        message: rawMessage,
        stage: 'provider-unknown',
        code
    };
}

export function registerImageToImageHandlers(context: UXPContext): void {
    const { wsServer, logService } = context;

    /**
     * 当前在途的生成请求，用来支持"停止生成"。
     *
     * 只保留一个：面板一次只展示一轮结果，第二个请求的结果没有地方呈现。
     * 真机出现过 16:44 与 16:51 两次 4K 请求并行各自跑满超时——两次都在计费，
     * 而用户只可能看到一次结果。所以新请求进来时先取消上一个，既符合界面语义也不白花钱。
     */
    let activeGeneration: { abort: AbortController; startedAt: number } | null = null;

    function abortActiveGeneration(reason: string): boolean {
        if (!activeGeneration) return false;
        const waitedSeconds = ((Date.now() - activeGeneration.startedAt) / 1000).toFixed(1);
        logService?.logAgent('info', `[ImageToImage] ${reason}，已等待 ${waitedSeconds} 秒的请求被中断`);
        activeGeneration.abort.abort();
        activeGeneration = null;
        return true;
    }

    const imageToImageGenerateHandler = async (params: {
        image?: string;
        prompt: string;
        model?: string;
        sizePreset?: string;
        /** 像素模式尺寸 `<宽>x<高>`（比例选择的落点）。与 sizePreset 互斥，传了它就以它为准。 */
        size?: string;
        /** 本次最多生成几张；>1 时走 Seedream 组图。仅 lite / 4.5 / 4.0 支持。 */
        maxImages?: number;
        referenceImages?: string[];
        originalWidth?: number;
        originalHeight?: number;
        placementWidth?: number;
        placementHeight?: number;
        targetBounds?: { left?: number; top?: number };
        sourceKind?: 'layer' | 'document';
        /** v3 零闪烁：UXP 已通过 binary ws frame 直传 raw RGBA，下面这两个字段定位它 */
        sourceFromBinary?: boolean;
        sourceBinaryRequestId?: number;
        sourceBinaryWidth?: number;
        sourceBinaryHeight?: number;
        /** 用户显式选定的输出比例（如 16:9）；仅 OpenRouter 图像模型消费，缺省按源图吸附 */
        aspectRatio?: string;
    }) => {
        const model = params.model || 'doubao-seedream-5-0-260128';
        const isJimengModel = model === 'jimeng-seedream-4-6';
        const isOpenRouterModel = isOpenRouterImageModelId(model);
        logService?.logAgent(
            'info',
            `[ImageToImage] Start request, model=${model}, `
            + `size=${params.size || params.sizePreset || 'default'}, `
            + `maxImages=${params.maxImages || 1}, `
            + `sourceFromBinary=${params.sourceFromBinary === true}`
        );

        const sendProgress = (progress: number, message: string, stage?: string) => {
            wsServer.sendProgress('image-to-image', progress, message, stage);
            // 上传百分比每变一次就来一条，全量写日志会把日志刷爆，只留整十的档位
            const isNoisyUploadTick = stage === 'provider-upload-progress' && progress % 5 !== 0;
            if (!isNoisyUploadTick) {
                logService?.logAgent('info', `[ImageToImage] ${progress}% - ${message}${stage ? ` (${stage})` : ''}`);
            }
        };

        // 新请求顶掉上一个：两个请求并行时只有一个的结果能被展示，另一个纯属白花钱
        abortActiveGeneration('收到新的生成请求');
        const abortController = new AbortController();
        activeGeneration = { abort: abortController, startedAt: Date.now() };

        try {
            // v3 零闪烁分支：从 binary ws 缓存里拉取 raw RGBA，sharp 编 PNG，注入 params.image
            let resolvedSourceImage = typeof params.image === 'string' ? params.image : '';
            // UXP 直传的原始像素。OpenRouter 路径直接用它，不再经过中间 PNG。
            let rawSourcePixels: { raw: Buffer; width: number; height: number; channels: 4 } | null = null;
            logService?.logAgent('info', `[ImageToImage] Incoming payload summary: sourceFromBinary=${params.sourceFromBinary === true}, sourceBinaryRequestId=${params.sourceBinaryRequestId}, imageLen=${resolvedSourceImage.length}, refCount=${Array.isArray(params.referenceImages) ? params.referenceImages.length : 0}`);

            if (params.sourceFromBinary === true) {
                const requestId = Number(params.sourceBinaryRequestId);
                if (!Number.isFinite(requestId) || requestId <= 0) {
                    throw new Error('sourceFromBinary=true but sourceBinaryRequestId is missing/invalid');
                }
                sendProgress(12, '正在解码原始像素', 'decode-source-binary');
                let binaryEntry;
                try {
                    binaryEntry = await waitForBinarySource(
                        wsServer,
                        requestId,
                        BinaryMessageType.RAW_RGBA,
                        8000
                    );
                } catch (waitError: any) {
                    const cache = wsServer.getConnectionDiagnostics().binaryCache;
                    logService?.logAgent('error', `[ImageToImage] Binary wait failed. expected requestId=${requestId}, type=RAW_RGBA. cache=${JSON.stringify(cache)}`);
                    throw new Error(`Raw RGBA binary frame did not arrive (requestId=${requestId}): ${waitError?.message || waitError}`);
                }
                const width = Number(params.sourceBinaryWidth) > 0
                    ? Number(params.sourceBinaryWidth)
                    : binaryEntry.width;
                const height = Number(params.sourceBinaryHeight) > 0
                    ? Number(params.sourceBinaryHeight)
                    : binaryEntry.height;
                logService?.logAgent('info', `[ImageToImage] Decoding raw RGBA: ${width}x${height}, ${(binaryEntry.buffer.length / 1024).toFixed(0)}KB`);

                // 原始像素直接留着，交给下游只编码一次。
                //
                // 这里原本要先把 raw RGBA 编成 PNG（3072×4096 实测 2.2~3.4 秒），
                // 传给 service 后又被解码、再编码一次。PNG 无损所以数值没变，
                // 但这一编一解是纯粹白做的功——链路上少一个环节，就少一处出错的余地。
                rawSourcePixels = {
                    raw: binaryEntry.buffer,
                    width,
                    height,
                    channels: 4
                };

                // 火山系 provider 只吃 data URL，只有它们才需要现在就编 PNG；
                // OpenRouter 走 raw 直通，跳过这一步。
                if (!isOpenRouterModel) {
                    sendProgress(15, '正在生成无损 PNG', 'encode-source-png');
                    try {
                        resolvedSourceImage = await rawRgbaToPngDataUrl(binaryEntry.buffer, width, height);
                    } catch (encodeError: any) {
                        throw new Error(`Failed to encode raw RGBA to PNG: ${encodeError?.message || encodeError}`);
                    }
                    logService?.logAgent('info', `[ImageToImage] Raw RGBA → PNG dataUrl ${(resolvedSourceImage.length / 1024).toFixed(0)}KB`);
                }

                // 把源图体积如实报给面板：等待时长里有一段就是在传这张图（4K 源图能到 20MB+），
                // 用户看到"在传多大的东西"才判断得出这次慢是正常还是异常。
                const sourceMb = (binaryEntry.buffer.length / 1024 / 1024).toFixed(1);
                sendProgress(18, `原图已准备好（约 ${sourceMb}MB 像素），正在发送`, 'encode-source-png');
            }

            if (!resolvedSourceImage && !rawSourcePixels) {
                throw new Error('Source image is required');
            }

            // 即梦只出单图、Seedream 可出组图；在这里收敛成同一种「多图」形态，
            // 让下游（预览、落盘、UXP 置入）只需要处理一条路径。
            let generatedBuffers: Buffer[];
            let resolvedModel: string;
            let resolvedSizeSpec: string;
            let partialFailures: Array<{ index: number; code?: string; message: string }> = [];
            // 上游"接受了请求但没照做"时的说明（如请求 4K 实际只给 896×1200）。
            // 这类降级不是错误、不该中断流程，但必须让用户看见，否则只会体感成"这模型不清晰"。
            let providerNotice: string | undefined;

            if (isOpenRouterModel) {
                // OpenRouter 图像模型：整图重生，无蒙版。这些模型单次只能出 1 张
                // （图像 API 的 supported_parameters 里 n 的 min/max 都是 1），
                // 要多张就并发发多次——面板早就是这么写的（"2 张会并发 2 次请求"），
                // 但这里一直只调了一次，用户选 2 张只拿到 1 张。现在按 maxImages 真的发够。
                if (!openRouterGeminiImageService.hasApiKey()) {
                    throw {
                        message: 'OpenRouter API Key 未配置，请先在设置中填写后重试。',
                        errorStage: 'provider-auth'
                    };
                }
                const openRouterBatch = await openRouterGeminiImageService.generateBatchFromImage(
                    params.prompt,
                    rawSourcePixels || dataUrlToBuffer(resolvedSourceImage),
                    {
                        model,
                        count: params.maxImages,
                        signal: abortController.signal,
                        aspectRatio: params.aspectRatio,
                        imageSize: ['1K', '2K', '4K'].includes(String(params.sizePreset || '').toUpperCase())
                            ? String(params.sizePreset).toUpperCase() as '1K' | '2K' | '4K'
                            : undefined,
                        referenceImages: (Array.isArray(params.referenceImages) ? params.referenceImages : [])
                            .filter((item) => typeof item === 'string' && item.trim().length > 0)
                            .map(dataUrlToBuffer)
                    },
                    (event) => sendProgress(event.progress, event.message, event.stage)
                );
                const openRouterResult = openRouterBatch.results[0];
                generatedBuffers = openRouterBatch.results.map((item) => item.image);
                partialFailures = openRouterBatch.failures.map((item) => ({
                    index: item.index,
                    message: item.message
                }));
                resolvedModel = openRouterResult.model;
                resolvedSizeSpec = `${openRouterResult.imageSize} @ ${openRouterResult.aspectRatio}`;
                providerNotice = openRouterResult.sizeDowngradeNotice;
                if (openRouterBatch.results.length > 1) {
                    logService?.logAgent(
                        'info',
                        `[ImageToImage] OpenRouter 并发出图 ${openRouterBatch.results.length}/${params.maxImages} 张`
                        + (openRouterBatch.failures.length > 0 ? `，${openRouterBatch.failures.length} 张失败` : '')
                    );
                }
                logService?.logAgent(
                    'info',
                    `[ImageToImage] OpenRouter 实际出图 ${openRouterResult.actualWidth}x${openRouterResult.actualHeight}, `
                    + `请求档位=${openRouterResult.imageSize}, 上游模型=${openRouterResult.upstreamModel || '(未回报)'}`
                    + (openRouterResult.upstreamProvider ? `, provider=${openRouterResult.upstreamProvider}` : '')
                );
                if (providerNotice) {
                    logService?.logAgent('warn', `[ImageToImage] 档位未生效：${providerNotice}`);
                }
            } else if (isJimengModel) {
                const jimengResult = await volcengineJimengImageService.generateFromImage(
                    params.prompt,
                    resolvedSourceImage,
                    {
                        sizePreset: params.sizePreset,
                        referenceImages: Array.isArray(params.referenceImages) ? params.referenceImages : [],
                        forceSingle: true
                    },
                    (event) => sendProgress(event.progress, event.message, event.stage)
                );
                generatedBuffers = [jimengResult.image];
                resolvedModel = jimengResult.model;
                resolvedSizeSpec = jimengResult.sizePreset;
            } else {
                // 走批量入口：模型支持组图就一次请求出多张，不支持就并发多次单图拼够张数，
                // 上层不必关心用的是哪条路径
                const seedreamResult = await volcengineSeedreamService.generateBatchFromImage(
                    params.prompt,
                    resolvedSourceImage,
                    {
                        model: model as any,
                        sizePreset: params.sizePreset,
                        size: params.size,
                        count: params.maxImages,
                        referenceImages: Array.isArray(params.referenceImages) ? params.referenceImages : []
                    },
                    (event) => sendProgress(event.progress, event.message, event.stage)
                );
                generatedBuffers = seedreamResult.images.map((item) => item.image);
                resolvedModel = seedreamResult.model;
                resolvedSizeSpec = seedreamResult.sizeSpec;
                partialFailures = seedreamResult.failures;
            }

            sendProgress(96, '正在准备结果图', 'prepare-result-file');

            const prepared = await Promise.all(
                generatedBuffers.map(async (buffer) => {
                    const metadata = await sharp(buffer).metadata();

                    // 落盘只做**必需的那一步**，不做统一格式化。
                    //
                    // 唯一必须解决的问题是：Photoshop 置入不带 ICC 的图时会走"缺失配置文件"
                    // 策略——数值被直接采纳而不做色彩空间转换，文档不是 sRGB 时显示效果就和
                    // 模型给的不是一回事。所以**缺 ICC 才需要重编码补上**。
                    //
                    // 上游已经带了 ICC 的（实测 Gemini 的 JPEG 带 "sRGB IEC61966-2-1"），
                    // 原样落盘即可：PS 能直接读 JPEG 并按其 ICC 正确转换。
                    // 此前这里无论如何都解码再编成 PNG，那一次编解码对带 ICC 的图是纯粹白做的，
                    // 4096×4096 的 PNG 编码开销还不小——减掉它，像素一个字节都不会动。
                    const hasUpstreamIcc = !!metadata.icc;
                    const upstreamFormat = normalizeImageGenerationResultFormat(metadata.format);

                    let persistedImageBuffer: Buffer;
                    let outputFormat: ImageGenerationResultFormat;
                    if (hasUpstreamIcc && upstreamFormat) {
                        persistedImageBuffer = buffer;
                        outputFormat = upstreamFormat;
                    } else {
                        // 缺 ICC：必须重编码才能把配置文件写进去。顺带用无损 PNG，
                        // 因为 JPEG 重编码会在已有损失上再叠一层。
                        persistedImageBuffer = await sharp(buffer)
                            .png({ compressionLevel: 6, adaptiveFiltering: true })
                            .withIccProfile('srgb')
                            .toBuffer();
                        outputFormat = 'png';
                    }

                    console.log(
                        `[ImageToImage] 结果落盘：${metadata.width}x${metadata.height} ${metadata.format} → `
                        + (hasUpstreamIcc && upstreamFormat
                            ? `原样保留（自带 ICC，零重编码）`
                            : `png（上游无 ICC，重编码补标 sRGB）`)
                    );

                    const previewBuffer = await sharp(persistedImageBuffer)
                        .resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
                        .png()
                        .toBuffer();
                    return {
                        previewBase64: previewBuffer.toString('base64'),
                        imageFilePath: await persistImageToTempFile(persistedImageBuffer, outputFormat),
                        outputFormat,
                        width: metadata.width || 0,
                        height: metadata.height || 0,
                        bytes: persistedImageBuffer.length
                    };
                })
            );

            const primary = prepared[0];
            logService?.logAgent(
                'info',
                `[ImageToImage] Prepared ${prepared.length} result(s): `
                + prepared.map((p) => `${p.width}x${p.height}/${p.outputFormat}/${p.bytes}B`).join(', ')
                + (partialFailures.length > 0 ? ` | ${partialFailures.length} failed` : '')
            );

            return {
                success: true,
                images: prepared.map((p) => p.previewBase64),
                // 单数字段保留：老的「直接置入第一张」路径仍依赖它。
                imageFilePath: primary.imageFilePath,
                imageFilePaths: prepared.map((p) => p.imageFilePath),
                // 每张的真实尺寸，供面板按张显示与置入时定位。
                imageSizes: prepared.map((p) => ({ width: p.width, height: p.height })),
                partialFailures,
                providerNotice,
                meta: {
                    providerNotice,
                    provider: isOpenRouterModel ? 'openrouter' : (isJimengModel ? 'jimeng' : 'seedream'),
                    model: resolvedModel,
                    outputFormat: primary.outputFormat,
                    sizePreset: resolvedSizeSpec,
                    generatedCount: prepared.length,
                    requestedCount: Number(params.maxImages) > 1 ? Number(params.maxImages) : 1,
                    sourceKind: params.sourceKind || 'document',
                    originalWidth: params.originalWidth || 0,
                    originalHeight: params.originalHeight || 0,
                    outputWidth: primary.width || params.originalWidth || 0,
                    outputHeight: primary.height || params.originalHeight || 0,
                    referenceImageCount: Array.isArray(params.referenceImages) ? params.referenceImages.length : 0,
                    placementWidth: params.placementWidth || params.originalWidth || 0,
                    placementHeight: params.placementHeight || params.originalHeight || 0,
                    targetBounds: params.targetBounds || { left: 0, top: 0 }
                }
            };
        } catch (error: any) {
            const parsedError = parseImageToImageError(error);
            logService?.logAgent('error', `[ImageToImage] Failed: ${error?.message || String(error)}`);
            return {
                success: false,
                error: parsedError.message,
                errorStage: parsedError.stage,
                errorCode: parsedError.code,
                errorDetail: parsedError.detail
            };
        } finally {
            if (activeGeneration?.abort === abortController) {
                activeGeneration = null;
            }
        }
    };

    wsServer.registerHandler('imageToImage.generate', imageToImageGenerateHandler);

    /**
     * 停止当前生成。
     *
     * 只保证"不再等这次结果"，**不保证上游停止计费**——请求已经发出去，模型那边多半
     * 已经在算了。这一点必须如实告诉用户，不能让"停止"听起来像撤销订单。
     */
    wsServer.registerHandler('imageToImage.cancel', async () => {
        const aborted = abortActiveGeneration('用户点了停止生成');
        return {
            success: true,
            aborted,
            message: aborted
                ? '已停止等待这次生成。模型那边可能已经开始出图了，这次调用的费用不会退。'
                : '当前没有正在进行的生成。'
        };
    });
}
