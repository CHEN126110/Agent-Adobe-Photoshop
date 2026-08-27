/**
 * 语义目标定位服务（主进程）
 *
 * 职责：把抠图面板"抠取目标"里的自然语言（袜子 / 鞋子 / 吊牌…）落到图像上的具体物体。
 *
 * 两条路，主次分明：
 * 1. selectFromCandidates（主路）——画面已由分割模型拆成候选物体，标号后让模型选编号。
 *    真机验证过一个反例：claude-subscription-opus 看懂了图（描述准确），却按对话习惯
 *    回了一整段设计分析而不是坐标 JSON。通用对话模型画框普遍不稳，但做选择题很稳。
 * 2. locate（降级）——前景拆不出候选时（目标不显著、与背景同色），才让模型直接给坐标。
 *
 * 为什么不用本地 YOLO-World：
 * 本机 yolov8s-worldv2.onnx 的输入是 ['images', 'txt_feats']，txt_feats 需要 CLIP
 * 文本嵌入（512 维）才能构造，而本地 CLIP 模型文件已损坏、且需要额外实现 BPE
 * tokenizer。在补齐这条本地链路之前，用用户已配置的多模态模型定位是唯一真实可用的
 * 开放词汇通道——它不受固定类表限制（COCO 80 类里没有"袜子"）。
 *
 * 边界：定位失败就如实失败。不退回全图分割——那会让用户以为语义抠图生效了，
 * 实际拿到的却是显著性主体（历史上正是这个静默回退掩盖了语义分支从未跑通的事实）。
 */

import type { ModelService, ModelMessage } from './model-service';
import {
    DEFAULT_SEMANTIC_TARGET_SELECTION,
    SEMANTIC_TARGET_GRID,
    denormalizeSemanticTargetBoxes,
    parseSemanticTargetResponse,
    selectSemanticTargetBoxes,
    type SemanticTargetBox,
    type SemanticTargetSelectionOptions
} from '../../shared/semantic-target-boxes';
import {
    parseCandidateSelection,
    type SemanticCandidate
} from '../../shared/semantic-target-candidates';

/** 送入定位模型的图像长边上限：更大的图不会提升定位精度，只增加 token 与延迟 */
const LOCATOR_MAX_EDGE = 1024;
const LOCATOR_TIMEOUT_MS = 90 * 1000;
const LOCATOR_MAX_TOKENS = 1200;
/** 透明区域的填充色：中性灰对浅色和深色商品都留有对比，避免白袜子贴白底 */
const LOCATOR_FLATTEN_BACKGROUND = { r: 128, g: 128, b: 128 };

export interface SemanticLocateOptions {
    /** 候选取舍参数，默认 DEFAULT_SEMANTIC_TARGET_SELECTION */
    selection?: SemanticTargetSelectionOptions;
    /** 进度回调，用于把定位阶段反馈到面板 */
    onProgress?: (progress: number, message: string) => void;
}

export interface SemanticLocateResult {
    success: boolean;
    /** 原图像素坐标系下的目标框 */
    boxes: SemanticTargetBox[];
    /** 模型明确表示图中没有该目标（与"调用失败"区分开） */
    notFound: boolean;
    error?: string;
    modelId?: string;
    processingTime?: number;
}

/** 标注框的配色：高对比且彼此可区分，避免与常见商品色撞色导致编号看不清 */
const CANDIDATE_COLORS = [
    '#FF3B30', '#00C853', '#2979FF', '#FFD600', '#D500F9',
    '#00E5FF', '#FF6D00', '#76FF03', '#F50057', '#1DE9B6',
    '#FF9100', '#651FFF'
];

function buildSelectPrompt(targetPrompt: string, candidateCount: number): string {
    return [
        `图中已用彩色方框标出 ${candidateCount} 个物体，方框左上角是编号（1 到 ${candidateCount}）。`,
        '',
        `请判断：哪些编号对应的物体是「${targetPrompt}」？`,
        '',
        '规则：',
        '1. 只输出 JSON，不要描述图片、不要解释理由。',
        '2. 有多个符合就都列出；只有一个就列一个。',
        `3. 没有任何一个是「${targetPrompt}」时，输出 {"selected": []}。`,
        '',
        '输出格式：',
        '{"selected": [1, 3]}'
    ].join('\n');
}

function buildLocatePrompt(targetPrompt: string, grid: number): string {
    return [
        `你是图像目标定位器。请在这张图片中找出：${targetPrompt}`,
        '',
        '要求：',
        '1. 只输出 JSON，不要任何解释文字、不要 Markdown 代码块。',
        `2. 坐标使用 0 到 ${grid} 的整数网格：x 从左到右，y 从上到下，与图片实际像素尺寸无关。`,
        '3. 每个目标给出左上角 (x1, y1) 与右下角 (x2, y2)。',
        '4. 框要紧贴目标本身，不要把背景、投影、其他商品包进去。',
        '5. 图中有多个同类目标时逐个列出，不要合并成一个大框。',
        '6. 图中确实没有该目标时，返回 {"found": false, "targets": []}。',
        '',
        '输出格式：',
        `{"found": true, "targets": [{"label": "${targetPrompt}", "x1": 120, "y1": 300, "x2": 480, "y2": 760, "confidence": 0.9}]}`
    ].join('\n');
}

export class SemanticTargetLocatorService {
    private modelService: ModelService;
    private resolveModelId: () => string;
    private sharp: any = null;

    constructor(modelService: ModelService, resolveModelId: () => string) {
        this.modelService = modelService;
        this.resolveModelId = resolveModelId;
    }

    private async ensureSharp(): Promise<boolean> {
        if (this.sharp) return true;
        const loaded = await import('sharp').then(m => m.default).catch(() => null);
        if (!loaded) return false;
        this.sharp = loaded;
        return true;
    }

    /**
     * 把图层图像压到定位模型能高效处理的尺寸，并展平透明区域。
     * 返回 base64（不含 data URI 前缀）。
     */
    private async prepareImageForLocator(imageBuffer: Buffer): Promise<{ base64: string; width: number; height: number }> {
        const metadata = await this.sharp(imageBuffer).metadata();
        const width = metadata.width || 0;
        const height = metadata.height || 0;
        const longestEdge = Math.max(width, height);

        let pipeline = this.sharp(imageBuffer);
        if (longestEdge > LOCATOR_MAX_EDGE) {
            pipeline = pipeline.resize(LOCATOR_MAX_EDGE, LOCATOR_MAX_EDGE, {
                fit: 'inside',
                withoutEnlargement: true
            });
        }

        const jpegBuffer = await pipeline
            .flatten({ background: LOCATOR_FLATTEN_BACKGROUND })
            .jpeg({ quality: 85 })
            .toBuffer();

        return { base64: jpegBuffer.toString('base64'), width, height };
    }

    /**
     * 在原图上画出候选框与编号，供模型看图作答。
     *
     * 直接叠加 SVG：编号放在框外上方，框内不遮挡物体本身——遮住物体会让模型
     * 难以判断它是什么。
     */
    async renderCandidateOverlay(
        imageBuffer: Buffer,
        candidates: SemanticCandidate[],
        imageWidth: number,
        imageHeight: number
    ): Promise<string | null> {
        if (!(await this.ensureSharp())) {
            console.error('[SemanticTargetLocator] sharp 未就绪，无法生成候选标注图');
            return null;
        }

        const scale = Math.min(1, LOCATOR_MAX_EDGE / Math.max(imageWidth, imageHeight));
        const viewWidth = Math.max(1, Math.round(imageWidth * scale));
        const viewHeight = Math.max(1, Math.round(imageHeight * scale));

        // 线宽与字号随图像尺寸走，小图上固定像素值会糊成一团
        const stroke = Math.max(2, Math.round(Math.min(viewWidth, viewHeight) * 0.006));
        const fontSize = Math.max(14, Math.round(Math.min(viewWidth, viewHeight) * 0.045));

        const shapes = candidates.map((candidate, index) => {
            const color = CANDIDATE_COLORS[index % CANDIDATE_COLORS.length];
            const x = Math.round(candidate.x1 * scale);
            const y = Math.round(candidate.y1 * scale);
            const w = Math.max(1, Math.round((candidate.x2 - candidate.x1) * scale));
            const h = Math.max(1, Math.round((candidate.y2 - candidate.y1) * scale));

            const badgeSize = Math.round(fontSize * 1.5);
            const badgeX = Math.max(0, Math.min(viewWidth - badgeSize, x));
            const badgeY = Math.max(0, y - badgeSize);

            return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${color}" stroke-width="${stroke}"/>`
                + `<rect x="${badgeX}" y="${badgeY}" width="${badgeSize}" height="${badgeSize}" fill="${color}"/>`
                + `<text x="${badgeX + badgeSize / 2}" y="${badgeY + badgeSize * 0.74}" `
                + `font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="bold" `
                + `fill="#FFFFFF" text-anchor="middle">${candidate.id}</text>`;
        }).join('');

        const overlay = Buffer.from(
            `<svg width="${viewWidth}" height="${viewHeight}" xmlns="http://www.w3.org/2000/svg">${shapes}</svg>`
        );

        const composed = await this.sharp(imageBuffer)
            .resize(viewWidth, viewHeight, { fit: 'fill' })
            .flatten({ background: LOCATOR_FLATTEN_BACKGROUND })
            .composite([{ input: overlay, top: 0, left: 0 }])
            .jpeg({ quality: 88 })
            .toBuffer()
            .catch((e: any) => {
                console.error('[SemanticTargetLocator] 候选标注图生成失败:', e?.message);
                return null;
            });

        return composed ? composed.toString('base64') : null;
    }

    /**
     * 让模型在已拆好的候选物体里选出目标。
     *
     * 这是语义抠图的主路径：模型只需回答编号，不必输出坐标。通用对话模型的
     * 视觉定位（画框）能力普遍不稳，但"这几个里哪个是袜子"是它的强项。
     */
    async selectFromCandidates(
        imageBuffer: Buffer,
        targetPrompt: string,
        candidates: SemanticCandidate[],
        imageWidth: number,
        imageHeight: number,
        options?: { onProgress?: (progress: number, message: string) => void }
    ): Promise<{
        success: boolean;
        selectedIds: number[];
        noneMatched: boolean;
        error?: string;
        modelId?: string;
        processingTime?: number;
    }> {
        const startTime = Date.now();
        const trimmedTarget = String(targetPrompt || '').trim();
        const sendProgress = options?.onProgress || ((_p: number, _m: string) => {});

        if (candidates.length === 0) {
            return { success: false, selectedIds: [], noneMatched: false, error: '没有候选物体可供选择。' };
        }

        const modelId = String(this.resolveModelId() || '').trim();
        if (!modelId) {
            return {
                success: false,
                selectedIds: [],
                noneMatched: false,
                error: `未配置可用的 Agent 模型，无法判断哪个是「${trimmedTarget}」。\n\n`
                    + '请在设置 → 模型中选择一个支持看图的模型；或清空"抠取目标"改用整体抠图。'
            };
        }

        if (!(await this.ensureSharp())) {
            return { success: false, selectedIds: [], noneMatched: false, error: '图像处理依赖 sharp 加载失败。' };
        }

        sendProgress(28, `正在判断哪个是「${trimmedTarget}」...`);

        const overlayBase64 = await this.renderCandidateOverlay(
            imageBuffer,
            candidates,
            imageWidth,
            imageHeight
        );

        if (!overlayBase64) {
            return {
                success: false,
                selectedIds: [],
                noneMatched: false,
                error: '候选标注图生成失败，无法让模型判断目标。'
            };
        }

        const messages: ModelMessage[] = [{
            role: 'user',
            content: [
                { type: 'text', text: buildSelectPrompt(trimmedTarget, candidates.length) },
                { type: 'image', image: { data: overlayBase64, mediaType: 'image/jpeg' } }
            ]
        }];

        const response = await this.modelService.chat(modelId, messages, {
            maxTokens: LOCATOR_MAX_TOKENS,
            temperature: 0,
            timeoutMs: LOCATOR_TIMEOUT_MS
        }).catch((e: any) => {
            console.error('[SemanticTargetLocator] 选择调用失败:', e?.message);
            return { text: '', __error: e?.message || '未知错误' } as any;
        });

        if ((response as any).__error) {
            return {
                success: false,
                selectedIds: [],
                noneMatched: false,
                modelId,
                processingTime: Date.now() - startTime,
                error: `调用模型 ${modelId} 判断目标失败：${(response as any).__error}`
            };
        }

        const validIds = candidates.map(item => item.id);
        const parsed = parseCandidateSelection(response.text || '', validIds);

        if (parsed.parseError) {
            return {
                success: false,
                selectedIds: [],
                noneMatched: false,
                modelId,
                processingTime: Date.now() - startTime,
                error: `模型 ${modelId} 没有给出可读的选择结果。\n\n${parsed.parseError}\n\n`
                    + '可在设置中更换模型，或改用"使用选区"模式手动框选。'
            };
        }

        if (parsed.selected.length === 0) {
            return {
                success: false,
                selectedIds: [],
                noneMatched: true,
                modelId,
                processingTime: Date.now() - startTime,
                error: `模型 ${modelId} 判断画面里的 ${candidates.length} 个物体都不是「${trimmedTarget}」。\n\n`
                    + '可以换一个更贴近画面的说法，确认选中的是正确图层，或改用"使用选区"模式手动框选。'
            };
        }

        console.log(
            `[SemanticTargetLocator] "${trimmedTarget}" 选中候选 [${parsed.selected.join(', ')}]/`
            + `${candidates.length} (模型=${modelId}, 耗时=${Date.now() - startTime}ms)`
        );

        return {
            success: true,
            selectedIds: parsed.selected,
            noneMatched: false,
            modelId,
            processingTime: Date.now() - startTime
        };
    }

    /**
     * 定位图像中的语义目标。
     *
     * @param imageBuffer - 图层图像（PNG/JPEG Buffer）
     * @param targetPrompt - 用户输入的目标描述，如"袜子"
     * @param imageWidth/imageHeight - 目标框要还原到的坐标系尺寸（通常是 PS 图层原始像素尺寸）
     */
    async locate(
        imageBuffer: Buffer,
        targetPrompt: string,
        imageWidth: number,
        imageHeight: number,
        options?: SemanticLocateOptions
    ): Promise<SemanticLocateResult> {
        const startTime = Date.now();
        const trimmedTarget = String(targetPrompt || '').trim();
        const sendProgress = options?.onProgress || ((_p: number, _m: string) => {});

        if (!trimmedTarget) {
            return { success: false, boxes: [], notFound: false, error: '未填写抠取目标，无法执行语义定位。' };
        }

        const modelId = String(this.resolveModelId() || '').trim();
        if (!modelId) {
            return {
                success: false,
                boxes: [],
                notFound: false,
                error: '未配置可用的 Agent 模型，无法按"' + trimmedTarget + '"定位目标。\n\n'
                    + '请在设置 → 模型中选择一个支持看图的模型；或清空"抠取目标"改用整体抠图。'
            };
        }

        if (!(await this.ensureSharp())) {
            return {
                success: false,
                boxes: [],
                notFound: false,
                error: '图像处理依赖 sharp 加载失败，无法预处理定位图像。'
            };
        }

        if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) || imageWidth <= 0 || imageHeight <= 0) {
            return {
                success: false,
                boxes: [],
                notFound: false,
                error: `图层尺寸无效（${imageWidth}x${imageHeight}），无法把定位结果换算成像素坐标。`
            };
        }

        sendProgress(20, `正在按"${trimmedTarget}"定位目标...`);

        const prepared = await this.prepareImageForLocator(imageBuffer).catch((e: any) => {
            console.error('[SemanticTargetLocator] 图像预处理失败:', e?.message);
            return null;
        });

        if (!prepared) {
            return {
                success: false,
                boxes: [],
                notFound: false,
                error: '定位图像预处理失败：无法读取或压缩图层图像，请确认图层内容有效。'
            };
        }

        const messages: ModelMessage[] = [{
            role: 'user',
            content: [
                { type: 'text', text: buildLocatePrompt(trimmedTarget, SEMANTIC_TARGET_GRID) },
                { type: 'image', image: { data: prepared.base64, mediaType: 'image/jpeg' } }
            ]
        }];

        const response = await this.modelService.chat(modelId, messages, {
            maxTokens: LOCATOR_MAX_TOKENS,
            temperature: 0,
            timeoutMs: LOCATOR_TIMEOUT_MS
        }).catch((e: any) => {
            console.error('[SemanticTargetLocator] 模型调用失败:', e?.message);
            return { text: '', __error: e?.message || '未知错误' } as any;
        });

        if ((response as any).__error) {
            return {
                success: false,
                boxes: [],
                notFound: false,
                modelId,
                processingTime: Date.now() - startTime,
                error: `目标定位调用模型 ${modelId} 失败：${(response as any).__error}`
            };
        }

        sendProgress(35, '正在解析定位结果...');

        const parsed = parseSemanticTargetResponse(response.text || '', SEMANTIC_TARGET_GRID);

        if (parsed.parseError) {
            return {
                success: false,
                boxes: [],
                notFound: false,
                modelId,
                processingTime: Date.now() - startTime,
                error: `模型 ${modelId} 的定位结果无法解析：${parsed.parseError}\n\n`
                    + '该模型可能不支持看图或不擅长目标定位，可在设置中更换模型，或改用"使用选区"模式手动框选。'
            };
        }

        if (parsed.notFound || parsed.boxes.length === 0) {
            return {
                success: false,
                boxes: [],
                notFound: true,
                modelId,
                processingTime: Date.now() - startTime,
                error: `模型 ${modelId} 在当前图层中没有找到"${trimmedTarget}"。\n\n`
                    + '可以换一个更贴近画面的描述（例如"白色短袜"→"袜子"），确认选中的是正确图层，或改用"使用选区"模式手动框选。'
            };
        }

        const pixelBoxes = denormalizeSemanticTargetBoxes(
            parsed.boxes,
            imageWidth,
            imageHeight,
            SEMANTIC_TARGET_GRID
        );

        const selected = selectSemanticTargetBoxes(
            pixelBoxes,
            imageWidth,
            imageHeight,
            options?.selection || DEFAULT_SEMANTIC_TARGET_SELECTION
        );

        if (selected.length === 0) {
            return {
                success: false,
                boxes: [],
                notFound: false,
                modelId,
                processingTime: Date.now() - startTime,
                error: `模型 ${modelId} 返回了 ${parsed.boxes.length} 个"${trimmedTarget}"候选框，但换算到图层 `
                    + `${imageWidth}x${imageHeight} 后都不是有效区域（过小、越界或几乎覆盖整图）。\n\n`
                    + '可换用更具体的目标描述，或改用"使用选区"模式手动框选。'
            };
        }

        console.log(
            `[SemanticTargetLocator] "${trimmedTarget}" 定位到 ${selected.length} 个目标 `
            + `(模型=${modelId}, 耗时=${Date.now() - startTime}ms)`
        );

        return {
            success: true,
            boxes: selected,
            notFound: false,
            modelId,
            processingTime: Date.now() - startTime
        };
    }
}

let locatorInstance: SemanticTargetLocatorService | null = null;

export function createSemanticTargetLocator(
    modelService: ModelService,
    resolveModelId: () => string
): SemanticTargetLocatorService {
    locatorInstance = new SemanticTargetLocatorService(modelService, resolveModelId);
    return locatorInstance;
}

export function getSemanticTargetLocator(): SemanticTargetLocatorService | null {
    return locatorInstance;
}
