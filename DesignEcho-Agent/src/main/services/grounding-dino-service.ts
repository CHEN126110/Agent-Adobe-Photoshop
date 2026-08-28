/**
 * GroundingDINO 开放词汇检测服务（主进程）
 *
 * 职责：把一段文字（"sock"、"red handbag"）变成图像上的目标框。
 * 这是语义抠图的第一段；第二段"框 → 精确蒙版"由 SAMService 负责。
 *
 * 为什么是它而不是 YOLO-World：本机已有 yolov8s-worldv2，实测能检出 shoe(0.625)、
 * person、face，位置精确，但对 sock 三种场景全部零检出——它把"袜子"定位到了鞋上。
 * GroundingDINO 在同一张模特图上稳定框出两只白袜（0.272 / 0.261），位置准确。
 *
 * 边界：输出经过显式阈值、类内去重和机械预算处理的候选框，不做设计选定。
 * 若固定预算截断了已经通过检测后处理的实例，结果必须标记 incomplete，不能把
 * “最多返回 12 个”冒充“画面里只有 12 个”。
 */

import * as path from 'path';
import * as fs from 'fs';
import {
    BertWordPieceTokenizer,
    type BertTokenizerData,
    type PhraseSpan
} from '../../shared/bert-wordpiece-tokenizer';

/** 模型固定输入尺寸，来自 preprocessor_config.json */
const INPUT_SIZE = 800;
const IMAGENET_MEAN = [0.485, 0.456, 0.406];
const IMAGENET_STD = [0.229, 0.224, 0.225];
/** 默认判定阈值：实测真实模特图上袜子落在 0.26~0.28 */
const DEFAULT_BOX_THRESHOLD = 0.22;
const DEFAULT_NMS_IOU = 0.5;
/** 已接受的高分框有多大比例落在候选框内，就判定候选框是"目标+邻近物"的整体框 */
const CONTAINMENT_SUPPRESS_RATIO = 0.85;
/** 且候选框要明显更大才算整体框，避免把同尺寸的正常重复框误判 */
const CONTAINMENT_SIZE_FACTOR = 1.4;
/** 相对分数下限：低于本次最高分这个比例的候选多为噪声或误检 */
const RELATIVE_SCORE_FLOOR = 0.7;
/** 分数断层：后一个候选相对前一个候选跌幅达到这个比例，视为掉进了另一档 */
const SCORE_GAP_RATIO = 0.25;

/**
 * 同类实例的面积比容差。
 *
 * 分数低于相对下限的候选，若框面积与冠军框在这个倍数之内，就当作"同一类的
 * 另一个实例"保留（两只鞋、两只袜子），否则判为误检。真机依据：抠"袜子"时
 * 模特的腿框与袜子框差一个量级，而两只袜子的框大小接近。
 */
const SIBLING_AREA_RATIO = 2.5;

/** 总候选预算；应用时按短语轮转，不能让一个短语占满容量而抹掉其他短语事实 */
const MAX_RESULTS = 12;
/** 空闲多久释放会话：短于重载耗时的数倍没意义，太长又占着显存 */
const DEFAULT_IDLE_RELEASE_MS = 90 * 1000;

export interface GroundedBox {
    phrase: string;
    confidence: number;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

export interface GroundingDetectResult {
    success: boolean;
    boxes: GroundedBox[];
    error?: string;
    processingTime?: number;
    /** 本次推理见到的最高分，定位失败时用于给出可操作的提示 */
    maxScore?: number;
    /** 分数与 NMS 后、应用结果预算前的有效候选数量。 */
    candidateCountBeforeLimit?: number;
    /** 实际返回给上层的区域数量。 */
    returnedRegionCount?: number;
    /** 仅指被执行预算截断的已知有效候选，不包含分数/NMS 淘汰。 */
    truncatedRegionCount?: number;
    truncationReason?: 'result_budget';
    /** false 表示 Provider 已知还有有效候选未返回，上层不得签发完整语义写入。 */
    complete?: boolean;
}

export interface GroundingDinoConfig {
    modelsDir: string;
    /** 与 MattingService 一致的执行提供程序选择 */
    executionProviders?: string[];
    /**
     * 空闲多久后释放会话（毫秒）。
     * 实测本模型加载占 757MB 显存、单次推理再占 1332MB——它只在检测那一瞬间需要，
     * 却会一直压着 2GB 不放。8GB 显卡上同时开着浏览器等应用时会直接顶满。
     * 设 0 表示常驻不释放。
     */
    idleReleaseMs?: number;
}

interface GroundingDinoSessionLease {
    session: any;
    tokenizer: BertWordPieceTokenizer;
    ort: any;
}

/**
 * 按分数断层筛除弱候选。
 *
 * 两个分数条件同时满足才进入弱档筛选，避免把"同类的第三个实例"误杀：
 * 1. 相对前一名跌幅达到 SCORE_GAP_RATIO（掉进了另一档）；
 * 2. 且绝对值已低于最高分的 RELATIVE_SCORE_FLOOR（确实是弱候选）。
 * 若弱候选与冠军框面积同量级，则作为可能的另一实例保留。这里只保留候选事实，
 * 不替上层或用户作语义选定。
 */
export function filterByScoreGap<T extends {
    confidence: number;
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
}>(
    candidates: T[],
    maxScore: number
): T[] {
    if (candidates.length === 0) return [];

    const sorted = [...candidates].sort((a, b) => b.confidence - a.confidence);
    const floor = maxScore * RELATIVE_SCORE_FLOOR;
    const kept: T[] = [];
    let enteredWeakTier = false;

    const areaOf = (box: T): number | null => {
        if (box.x1 === undefined || box.y1 === undefined
            || box.x2 === undefined || box.y2 === undefined) return null;
        const area = (box.x2 - box.x1) * (box.y2 - box.y1);
        return area > 0 ? area : null;
    };
    const topArea = areaOf(sorted[0]);

    for (let index = 0; index < sorted.length; index++) {
        const current = sorted[index];
        if (current.confidence >= floor) {
            kept.push(current);
            continue;
        }

        const previous = sorted[index - 1];
        const relativeGap = previous && previous.confidence > 0
            ? (previous.confidence - current.confidence) / previous.confidence
            : 0;
        if (relativeGap >= SCORE_GAP_RATIO) enteredWeakTier = true;
        if (!enteredWeakTier) {
            kept.push(current);
            continue;
        }

        // 分数掉到相对下限之下不代表就是误检——同一类的第二个实例常因遮挡或
        // 角度拿到低得多的分。真机 2026-08-28 抠"鞋子"时图里有两只鞋，
        // 冠军 0.697 把下限抬到 0.488，另一只鞋直接被这条硬下限丢掉，
        // 用户看到的是"整只鞋没抠出来"。
        //
        // 真正出现断层后再用尺寸判一次：同类实例的框是同一量级（两只鞋、
        // 两只袜子），而"腿"这类误检与目标差一个量级。进入弱档后逐项检查，
        // 非同尺度误检不能连带抹掉排在它后面的另一个真实实例。
        const area = areaOf(current);
        const sameScale = topArea !== null && area !== null
            && area <= topArea * SIBLING_AREA_RATIO
            && area >= topArea / SIBLING_AREA_RATIO;
        if (sameScale) kept.push(current);
    }

    return kept;
}

function sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-x));
}

export class GroundingDinoService {
    private modelsDir: string;
    private executionProviders: string[];
    private ort: any = null;
    private sharp: any = null;
    private session: any = null;
    private tokenizer: BertWordPieceTokenizer | null = null;
    private lastLoadError: string | null = null;
    private activeProvider: string | null = null;
    private idleReleaseMs: number;
    private idleTimer: NodeJS.Timeout | null = null;
    private sessionLoadPromise: Promise<boolean> | null = null;
    /** 从预处理开始到候选整理完成都持有引用，idle release 不能越过这个边界 */
    private activeSessionReferences = 0;
    /** 显式释放撞上活跃引用或加载任务时，等最后一个引用退出再执行 */
    private releaseRequested = false;
    private disposed = false;
    /**
     * GroundingDINO 单次 DirectML 推理峰值较高；同一会话并发 run 会叠加输入张量、
     * 预处理缓存和 DML 工作区。这里串行化完整的预处理 + 推理区间，等待者尚未分配
     * 800x800 Float32 输入。生命周期引用和推理并发是两件事，不能只修 release 竞态。
     */
    private inferenceSlotActive = false;
    private inferenceWaiters: Array<(acquired: boolean) => void> = [];

    constructor(config: GroundingDinoConfig) {
        this.modelsDir = config.modelsDir;
        // 默认 DirectML 优先、CPU 兜底：实测 DML 195ms vs CPU 2806ms
        this.executionProviders = config.executionProviders || ['dml', 'cpu'];
        // 默认 90 秒：连续抠图时不会反复重载（重载约 2 秒），停手后把显存还回去
        this.idleReleaseMs = config.idleReleaseMs ?? DEFAULT_IDLE_RELEASE_MS;
    }

    private getModelPath(): string {
        return path.join(this.modelsDir, 'grounding-dino', 'model.onnx');
    }

    private getTokenizerPath(): string {
        return path.join(this.modelsDir, 'grounding-dino', 'tokenizer.json');
    }

    checkModelsExist(): { model: boolean; tokenizer: boolean } {
        return {
            model: fs.existsSync(this.getModelPath()),
            tokenizer: fs.existsSync(this.getTokenizerPath())
        };
    }

    isReady(): boolean {
        return !this.disposed && this.session !== null && this.tokenizer !== null;
    }

    getLastLoadError(): string | null {
        return this.lastLoadError;
    }

    async initialize(): Promise<boolean> {
        if (this.isReady()) return true;

        if (this.disposed) {
            this.lastLoadError = '服务已释放，不能重新初始化';
            return false;
        }

        if (this.sessionLoadPromise) return this.sessionLoadPromise;

        // initialize() 是公开入口，首次并发调用必须共享同一个加载任务；否则 DML
        // 会同时创建多份大模型会话，既浪费显存，也会让后完成者覆盖前一会话。
        const sharedLoadPromise = this.initializeOnce()
            .catch((error: any) => {
                this.lastLoadError = error?.message || String(error);
                console.error(`[GroundingDino] ❌ 模型加载异常: ${this.lastLoadError}`);
                return false;
            })
            .then((loaded) => {
                if (this.sessionLoadPromise === sharedLoadPromise) {
                    this.sessionLoadPromise = null;
                }

                if (this.releaseRequested && this.activeSessionReferences === 0) {
                    this.releaseCurrentSession();
                } else {
                    this.scheduleIdleRelease();
                }

                return loaded && this.isReady();
            });

        this.sessionLoadPromise = sharedLoadPromise;
        return sharedLoadPromise;
    }

    private async initializeOnce(): Promise<boolean> {
        if (this.isReady()) return true;

        const exists = this.checkModelsExist();
        if (!exists.model || !exists.tokenizer) {
            this.lastLoadError = `模型文件缺失（model=${exists.model}, tokenizer=${exists.tokenizer}）：${this.getModelPath()}`;
            console.log(`[GroundingDino] ${this.lastLoadError}`);
            return false;
        }

        if (!this.ort || !this.sharp || !this.tokenizer) {
            try {
                this.ort = await import('onnxruntime-node');
                this.sharp = (await import('sharp')).default;

                const tokenizerData = JSON.parse(
                    fs.readFileSync(this.getTokenizerPath(), 'utf8')
                ) as BertTokenizerData;
                this.tokenizer = new BertWordPieceTokenizer(tokenizerData);
            } catch (e: any) {
                this.lastLoadError = e?.message || String(e);
                console.error(`[GroundingDino] ❌ 依赖或词表加载失败: ${this.lastLoadError}`);
                return false;
            }
        }

        if (this.disposed) {
            this.tokenizer = null;
            this.lastLoadError = '服务已释放，取消模型加载';
            return false;
        }

        // GPU 优先：实测 DirectML 195ms vs CPU 2806ms（同一张图、同样的检测结果），
        // 差 14 倍。但复杂算子在部分驱动上可能不被支持，所以失败要能回退到 CPU。
        for (const provider of this.executionProviders) {
            const started = Date.now();
            console.log(`[GroundingDino] 正在加载模型 (${provider.toUpperCase()})...`);
            try {
                const createdSession = await this.ort.InferenceSession.create(this.getModelPath(), {
                    executionProviders: [provider],
                    graphOptimizationLevel: 'all',
                    logSeverityLevel: 3
                });

                if (this.disposed) {
                    void Promise.resolve(createdSession.release?.()).catch((error: any) => {
                        console.warn('[GroundingDino] 已释放服务的迟到会话清理失败:', error?.message || error);
                    });
                    this.lastLoadError = '服务已释放，取消模型加载';
                    return false;
                }

                this.session = createdSession;
                this.activeProvider = provider;
                this.lastLoadError = null;
                console.log(
                    `[GroundingDino] ✅ 模型加载完成 [${provider.toUpperCase()}] (${Date.now() - started}ms)`
                );
                return true;
            } catch (e: any) {
                this.lastLoadError = e?.message || String(e);
                console.warn(`[GroundingDino] ${provider.toUpperCase()} 加载失败: ${this.lastLoadError}`);
            }
        }

        console.error(`[GroundingDino] ❌ 所有执行提供程序都不可用：${this.lastLoadError}`);
        this.session = null;
        return false;
    }

    private clearIdleTimer(): void {
        if (!this.idleTimer) return;
        clearTimeout(this.idleTimer);
        this.idleTimer = null;
    }

    /** 重置空闲计时：有会话引用时不计时，最后一个引用退出后才开始倒数 */
    private scheduleIdleRelease(): void {
        this.clearIdleTimer();

        if (this.releaseRequested && this.activeSessionReferences === 0) {
            this.releaseCurrentSession();
            return;
        }
        if (this.idleReleaseMs <= 0 || this.activeSessionReferences > 0 || !this.session) return;

        this.idleTimer = setTimeout(() => {
            this.idleTimer = null;
            if (this.activeSessionReferences > 0 || !this.session) return;
            console.log(`[GroundingDino] 空闲 ${Math.round(this.idleReleaseMs / 1000)}s，释放会话以归还显存`);
            this.releaseSession();
        }, this.idleReleaseMs);
        // 空闲计时不应该拖住进程退出
        this.idleTimer.unref?.();
    }

    /**
     * 请求释放推理会话但保留词表：下次调用会自行重新加载（约 2 秒）。
     * 若预处理或推理已经取得引用，只登记请求，不能释放它正在使用的会话。
     */
    releaseSession(): void {
        this.clearIdleTimer();
        if (this.activeSessionReferences > 0 || this.sessionLoadPromise) {
            this.releaseRequested = true;
            return;
        }
        this.releaseCurrentSession();
    }

    private releaseCurrentSession(): void {
        this.releaseRequested = false;
        if (!this.session) return;
        const session = this.session;
        this.session = null;
        this.activeProvider = null;
        void Promise.resolve(session.release?.()).catch((error: any) => {
            console.warn('[GroundingDino] 会话释放失败:', error?.message || error);
        });
    }

    /**
     * 在任何异步预处理开始前取得会话引用，并把实际使用对象冻结在局部 lease 中。
     * 这样即使稍后发生释放请求，当前 detect 也不会重新读取一个已变化的 this.session。
     */
    private async acquireSession(): Promise<GroundingDinoSessionLease | null> {
        this.clearIdleTimer();
        this.activeSessionReferences++;

        let lease: GroundingDinoSessionLease | null = null;
        try {
            if (!(await this.initialize())) return null;
            if (!this.session || !this.tokenizer || !this.ort) return null;

            lease = {
                session: this.session,
                tokenizer: this.tokenizer,
                ort: this.ort
            };
            return lease;
        } finally {
            if (!lease) this.releaseSessionReference();
        }
    }

    private releaseSessionReference(): void {
        if (this.activeSessionReferences <= 0) return;
        this.activeSessionReferences--;
        if (this.activeSessionReferences > 0) return;

        if (this.releaseRequested || this.disposed) {
            this.releaseCurrentSession();
            return;
        }
        this.scheduleIdleRelease();
    }

    private async acquireInferenceSlot(): Promise<boolean> {
        if (this.disposed) return false;
        if (!this.inferenceSlotActive) {
            this.inferenceSlotActive = true;
            return true;
        }
        return new Promise<boolean>((resolve) => {
            this.inferenceWaiters.push(resolve);
        });
    }

    private releaseInferenceSlot(): void {
        if (!this.inferenceSlotActive) return;
        while (this.inferenceWaiters.length > 0) {
            const next = this.inferenceWaiters.shift();
            if (!next) continue;
            if (this.disposed) {
                next(false);
                continue;
            }
            next(true);
            return;
        }
        this.inferenceSlotActive = false;
    }

    private cancelQueuedInferences(): void {
        const waiters = this.inferenceWaiters.splice(0);
        for (const resolve of waiters) resolve(false);
    }

    getActiveProvider(): string | null {
        return this.activeProvider;
    }

    /** 图像预处理：直接 resize 到 800x800 + ImageNet 归一化（模型的 preprocessor 就是这样） */
    private async preprocessImage(imageBuffer: Buffer): Promise<{
        tensor: Float32Array;
        width: number;
        height: number;
    } | null> {
        const metadata = await this.sharp(imageBuffer).metadata().catch(() => null);
        if (!metadata?.width || !metadata?.height) return null;

        const pixels = await this.sharp(imageBuffer)
            .resize(INPUT_SIZE, INPUT_SIZE, { fit: 'fill', kernel: 'lanczos3' })
            .removeAlpha()
            .raw()
            .toBuffer()
            .catch(() => null);

        if (!pixels) return null;

        const tensor = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
        const plane = INPUT_SIZE * INPUT_SIZE;
        for (let i = 0; i < plane; i++) {
            tensor[i] = (pixels[i * 3] / 255 - IMAGENET_MEAN[0]) / IMAGENET_STD[0];
            tensor[plane + i] = (pixels[i * 3 + 1] / 255 - IMAGENET_MEAN[1]) / IMAGENET_STD[1];
            tensor[2 * plane + i] = (pixels[i * 3 + 2] / 255 - IMAGENET_MEAN[2]) / IMAGENET_STD[2];
        }

        return { tensor, width: metadata.width, height: metadata.height };
    }

    /**
     * 逐短语的类内去重：同一个短语的冗余框去掉，不同短语互不影响。
     *
     * 除了常规 IoU 去重，这里还必须处理"整体框"：检测器会同时给出目标本身和
     * 目标+邻近物的更大范围框。真机 2026-08-27：抠"鞋子"时除了两个纯鞋框
     * (0.52 / 0.49)，还给了两个从袜口一直到鞋底的整体框 (0.40 / 0.40)，
     * 它们与纯鞋框的 IoU 只有 0.45——低于常规 NMS 阈值，于是全部通过，
     * 选区就变成了"鞋 + 袜子"。
     *
     * 判据：一个**分数更低**的框如果几乎把已接受的高分框整个装进去，
     * 说明它框的是"目标 + 别的东西"，不是同一个目标的另一种画法。
     */
    private applyNMS(boxes: GroundedBox[], iouThreshold: number): GroundedBox[] {
        const sorted = [...boxes].sort((a, b) => b.confidence - a.confidence);
        const kept: GroundedBox[] = [];

        for (const box of sorted) {
            const boxArea = (box.x2 - box.x1) * (box.y2 - box.y1);
            if (boxArea <= 0) continue;

            const redundant = kept.some(accepted => {
                if (accepted.phrase !== box.phrase) return false;

                const ix1 = Math.max(box.x1, accepted.x1);
                const iy1 = Math.max(box.y1, accepted.y1);
                const ix2 = Math.min(box.x2, accepted.x2);
                const iy2 = Math.min(box.y2, accepted.y2);
                if (ix2 <= ix1 || iy2 <= iy1) return false;

                const inter = (ix2 - ix1) * (iy2 - iy1);
                const acceptedArea = (accepted.x2 - accepted.x1) * (accepted.y2 - accepted.y1);
                const union = boxArea + acceptedArea - inter;

                // 常规重复
                if (union > 0 && inter / union > iouThreshold) return true;

                // 整体框：已接受的高分框有 containment 比例以上落在当前框内，
                // 且当前框明显更大——它多包含的部分正是不该抠进来的邻近物
                const containment = acceptedArea > 0 ? inter / acceptedArea : 0;
                return containment >= CONTAINMENT_SUPPRESS_RATIO
                    && boxArea > acceptedArea * CONTAINMENT_SIZE_FACTOR;
            });

            if (!redundant) kept.push(box);
        }

        return kept;
    }

    /**
     * 在固定总预算内逐 phrase 轮转：先保留每个短语的最高分事实，再进入下一轮。
     * 这是对 phrase 的机械等权，不把全局分数排序升级成语义取舍。
     */
    private limitResultsByPhrase(
        boxes: GroundedBox[],
        phraseOrder: string[],
        maxResults: number = MAX_RESULTS
    ): GroundedBox[] {
        if (maxResults <= 0) return [];
        if (boxes.length <= maxResults) return boxes;

        const orderedPhrases = Array.from(new Set([
            ...phraseOrder,
            ...boxes.map(box => box.phrase)
        ]));
        const candidatesByPhrase = new Map<string, GroundedBox[]>(
            orderedPhrases.map(phrase => [phrase, boxes.filter(box => box.phrase === phrase)])
        );
        const limited: GroundedBox[] = [];
        let depth = 0;
        let addedAtDepth = true;
        while (limited.length < maxResults && addedAtDepth) {
            addedAtDepth = false;
            for (const phrase of orderedPhrases) {
                const candidate = candidatesByPhrase.get(phrase)?.[depth];
                if (!candidate) continue;
                limited.push(candidate);
                addedAtDepth = true;
                if (limited.length >= maxResults) break;
            }
            depth++;
        }

        return limited;
    }

    /**
     * 按文字短语检测目标。
     *
     * @param imageBuffer 图层图像
     * @param phrases 英文短语（中文须先经 semantic-target-vocabulary 转换）
     */
    async detect(
        imageBuffer: Buffer,
        phrases: string[],
        options?: { boxThreshold?: number; nmsIoU?: number }
    ): Promise<GroundingDetectResult> {
        const startTime = Date.now();

        const cleaned = phrases.map(p => String(p || '').trim()).filter(Boolean);
        if (cleaned.length === 0) {
            return { success: false, boxes: [], error: '未提供检测短语' };
        }

        const inferenceSlotAcquired = await this.acquireInferenceSlot();
        if (!inferenceSlotAcquired) {
            return {
                success: false,
                boxes: [],
                error: '开放词汇检测服务已停止，本次排队推理没有执行'
            };
        }

        const lease = await this.acquireSession();
        if (!lease) {
            this.releaseInferenceSlot();
            return {
                success: false,
                boxes: [],
                error: `开放词汇检测模型不可用：${this.lastLoadError || '未知原因'}`
            };
        }

        try {
            const { ids, spans } = lease.tokenizer.encodePhrases(cleaned);

            const image = await this.preprocessImage(imageBuffer);
            if (!image) {
                return { success: false, boxes: [], error: '图像预处理失败：无法读取或缩放图层图像' };
            }

            const length = ids.length;
            const toInt64 = (values: number[]) => BigInt64Array.from(values.map(v => BigInt(v)));

            const feeds: Record<string, any> = {
                pixel_values: new lease.ort.Tensor('float32', image.tensor, [1, 3, INPUT_SIZE, INPUT_SIZE]),
                input_ids: new lease.ort.Tensor('int64', toInt64(ids), [1, length]),
                attention_mask: new lease.ort.Tensor('int64', toInt64(ids.map(() => 1)), [1, length]),
                token_type_ids: new lease.ort.Tensor('int64', toInt64(ids.map(() => 0)), [1, length]),
                // pixel_mask 标记哪些像素是真实图像；直接 resize 时全部有效
                pixel_mask: new lease.ort.Tensor(
                    'int64',
                    new BigInt64Array(INPUT_SIZE * INPUT_SIZE).fill(BigInt(1)),
                    [1, INPUT_SIZE, INPUT_SIZE]
                )
            };

            const outputs = await lease.session.run(feeds).catch((e: any) => {
                console.error('[GroundingDino] 推理失败:', e?.message);
                return null;
            });

            if (!outputs) {
                return {
                    success: false,
                    boxes: [],
                    error: '开放词汇检测推理失败',
                    processingTime: Date.now() - startTime
                };
            }

            const logits = outputs.logits;
            const predBoxes = outputs.pred_boxes;
            if (!logits || !predBoxes) {
                return { success: false, boxes: [], error: '检测模型未返回预期的 logits/pred_boxes' };
            }

            const numQueries = logits.dims[1];
            const textLen = logits.dims[2];
            const threshold = Number.isFinite(options?.boxThreshold)
                ? (options!.boxThreshold as number)
                : DEFAULT_BOX_THRESHOLD;

            const candidates: GroundedBox[] = [];
            let maxScore = 0;
            // 每个短语各自记最高分：分数只在同一个短语内部可比，
            // 用全局最高分去卡低分短语的候选，会把它整个短语的结果压没
            const maxScoreByPhrase = new Map<string, number>();

            for (let q = 0; q < numQueries; q++) {
                for (const span of spans) {
                    const score = this.scoreSpan(logits.data, q, textLen, span);
                    if (score > maxScore) maxScore = score;
                    if (score > (maxScoreByPhrase.get(span.phrase) ?? 0)) {
                        maxScoreByPhrase.set(span.phrase, score);
                    }
                    if (score < threshold) continue;

                    // pred_boxes 是归一化的 cx,cy,w,h
                    const cx = predBoxes.data[q * 4];
                    const cy = predBoxes.data[q * 4 + 1];
                    const w = predBoxes.data[q * 4 + 2];
                    const h = predBoxes.data[q * 4 + 3];

                    candidates.push({
                        phrase: span.phrase,
                        confidence: score,
                        x1: Math.max(0, Math.round((cx - w / 2) * image.width)),
                        y1: Math.max(0, Math.round((cy - h / 2) * image.height)),
                        x2: Math.min(image.width, Math.round((cx + w / 2) * image.width)),
                        y2: Math.min(image.height, Math.round((cy + h / 2) * image.height))
                    });
                }
            }

            // 相对分数下限 + 分数断层：同一个目标的多个实例分数彼此接近，
            // 误检往往明显掉一档。真机 2026-08-27 抠"袜子"时检出
            // 0.40 / 0.39（两只袜子）和 0.24（模特的腿）——后者与袜子框几乎不重叠，
            // 包含抑制拦不住，只能靠分数把它挡在外面。
            // 过滤始终逐 phrase 进行；一个短语的分数和候选数量不能改变另一个短语
            // 是否可见。去重只消除完全相同的 phrase，不引入任何语义优先级。
            const phraseOrder = Array.from(new Set(spans.map(span => span.phrase)));
            const survived = phraseOrder.flatMap(phrase => filterByScoreGap(
                candidates.filter(box => box.phrase === phrase),
                maxScoreByPhrase.get(phrase) ?? 0
            ));

            const afterNms = this.applyNMS(survived, options?.nmsIoU ?? DEFAULT_NMS_IOU);
            const validAfterNms = afterNms
                .filter(box => box.x2 - box.x1 > 1 && box.y2 - box.y1 > 1);
            const boxes = this.limitResultsByPhrase(validAfterNms, phraseOrder);
            const truncatedRegionCount = Math.max(0, validAfterNms.length - boxes.length);

            console.log(
                `[GroundingDino] "${cleaned.join(' / ')}" → ${boxes.length} 个目标 `
                + `(过阈值候选 ${candidates.length}，最高分 ${maxScore.toFixed(3)}, ${Date.now() - startTime}ms)`
            );

            // 被淘汰的候选要说清楚停在分数、NMS、无效尺寸还是结果限额，否则
            // 现场只能看到"→ 1 个目标"，分不清是模型没检出还是被这里挡掉了。
            // 真机 2026-08-28 就是因为这条信息缺失，排查绕了两轮。
            if (candidates.length > boxes.length) {
                const keptKeys = new Set(boxes.map(b => `${b.phrase}@${b.x1},${b.y1},${b.x2},${b.y2}`));
                const dropped = candidates
                    .filter(c => !keptKeys.has(`${c.phrase}@${c.x1},${c.y1},${c.x2},${c.y2}`))
                    .sort((a, b) => b.confidence - a.confidence)
                    .slice(0, 6)
                    .map(c => {
                        let stage = '结果限额';
                        if (!survived.includes(c)) {
                            stage = '分数/尺寸';
                        } else if (!afterNms.includes(c)) {
                            stage = 'NMS';
                        } else if (!validAfterNms.includes(c)) {
                            stage = '无效尺寸';
                        }
                        const area = (c.x2 - c.x1) * (c.y2 - c.y1);
                        return `${c.phrase} ${c.confidence.toFixed(3)} `
                            + `[${c.x1},${c.y1}-${c.x2},${c.y2}] 面积${area} 淘汰于${stage}`;
                    });
                console.log(`[GroundingDino] 淘汰 ${candidates.length - boxes.length} 个候选: ${dropped.join(' | ')}`);
            }

            return {
                success: true,
                boxes,
                maxScore,
                candidateCountBeforeLimit: validAfterNms.length,
                returnedRegionCount: boxes.length,
                truncatedRegionCount,
                truncationReason: truncatedRegionCount > 0 ? 'result_budget' : undefined,
                complete: truncatedRegionCount === 0,
                processingTime: Date.now() - startTime
            };
        } finally {
            this.releaseSessionReference();
            this.releaseInferenceSlot();
        }
    }

    /** 一个短语的得分 = 该短语所占 token 上的最大 sigmoid 分数 */
    private scoreSpan(data: Float32Array, query: number, textLen: number, span: PhraseSpan): number {
        let best = 0;
        const end = Math.min(span.end, textLen);
        for (let t = span.start; t < end; t++) {
            const score = sigmoid(data[query * textLen + t]);
            if (score > best) best = score;
        }
        return best;
    }

    dispose(): void {
        this.disposed = true;
        this.cancelQueuedInferences();
        this.clearIdleTimer();
        this.tokenizer = null;
        this.releaseSession();
    }
}

let instance: GroundingDinoService | null = null;

export function getGroundingDinoService(config: GroundingDinoConfig): GroundingDinoService {
    if (!instance) instance = new GroundingDinoService(config);
    return instance;
}
