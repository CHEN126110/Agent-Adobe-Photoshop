/**
 * 智能分割服务 - 本地 ONNX 模型
 * 
 * 本地分割 Provider：显著性抠图与开放词汇语义抠图共用的模型执行层。
 * 
 * 功能：
 * 1. 语义分割 - 识别画布中所有主体（类似 PS "选择主体"）
 * 2. 文本定位分割 - 根据文本描述定位并分割目标（如"袜子"、"鞋子"）
 * 3. 选区分割 - 识别选区范围内的主体
 * 
 * 使用模型：
 * - GroundingDINO - 语义目标词到候选框（由独立 Provider 调用）
 * - MobileSAM - 按框圈定目标范围
 * - BiRefNet lite/full/matting - 显著性与高分辨率边缘细化
 * 
 * 处理流程：
 * 1. 文本定位：GroundingDINO 产生带 phrase 的目标候选框
 * 2. 范围分割：MobileSAM 按框确定目标归属
 * 3. 边缘细化：BiRefNet 在局部高分辨率图上恢复真实边缘
 * 
 * 技术栈：
 * - onnxruntime-node - ONNX 推理
 * - sharp - 图像预处理/后处理
 */

import * as path from 'path';
import * as fs from 'fs';
import type { SharpConstructor } from 'sharp';
import { 
    BinaryImageData, 
    isBinaryImageData, 
    binaryImageDataToBase64 
} from '../../shared/binary-protocol';
import {
    DEFAULT_MASK_REGION_OPTIONS,
    extractMaskRegions,
    extractMaskRegionsWithLabels,
    measureMaskTargetCoverage,
    type MaskRegion,
    type MaskRegionOptions
} from '../../shared/mask-regions';
import {
    planGuidedFilterExecution,
    refineMaskWithGuidedFilter
} from '../../shared/guided-filter';

// ==================== 类型定义 ====================

export type QualityLevel = 'fast' | 'balanced' | 'quality';

export interface MattingConfig {
    /** 模型目录 */
    modelsDir?: string;
    /** 默认质量等级 */
    defaultQuality?: QualityLevel;
    /** GPU 加速模式：'auto' 自动检测，'cuda' 强制 CUDA，'directml' 强制 DirectML，'cpu' 仅 CPU */
    gpuMode?: 'auto' | 'cuda' | 'directml' | 'cpu';
}

export type ExecutionProvider = 'cuda' | 'dml' | 'cpu';

export interface GPUStatus {
    available: boolean;
    provider: ExecutionProvider;
    deviceName?: string;
    memory?: number;
}

export interface MattingResult {
    success: boolean;
    /** 抠图后的图像 (Base64 PNG with transparency) */
    mattedImage?: string;
    /** 蒙版图像 (RAW_MASK 格式: "RAW_MASK:width:height:base64") */
    maskImage?: string;
    /** 原始蒙版（兼容旧接口） */
    mask?: string;
    /** RAW_MASK 解码后的二进制蒙版。 */
    maskBuffer?: Buffer;
    maskWidth?: number;
    maskHeight?: number;
    /** 处理耗时 (ms) */
    processingTime?: number;
    /** 使用的模型 */
    usedModel?: string;
    /** 错误信息 */
    error?: string;
    /** 分析结果 */
    analysis?: string;
    /** 处理流程信息 */
    pipeline?: {
        mode?: 'local' | 'onnx';
    };
    /** 语义局部分割的确定性完整性收据；缺任一目标时不得把 union mask 应用到 Photoshop。 */
    targetCompleteness?: {
        schema: 'semantic-matting-target-completeness/v1';
        requestedRegionCount: number;
        requestedTargetCount: number;
        segmentedRegionCount: number;
        segmentedTargetCount: number;
        scopeVerificationRequired: boolean;
        scopeVerifiedTargetCount: number;
        scopeVerificationComplete: boolean;
        failedRegionIndexes: number[];
        complete: boolean;
    };
}

// ==================== 模型配置 ====================

// BiRefNet 模型配置
// 注意：当前 ONNX 模型为固定输入尺寸 1024x1024，不支持动态分辨率
/** 权重超过这个体积就认定是完整档：lite 约 214MB，完整版约 928MB */
/**
 * BiRefNet 权重档位。
 *
 * full / lite 是**容量**档（按文件大小分），matting 是**能力**档：
 * 官方 matting 权重用 alpha 回归训练，输出真正的半透明过渡；
 * general/DIS 权重用二值 GT 训练，天生给不出毛发级边缘。
 * 两者同架构同输入（[1,3,1024,1024]、logits 输出），只是权重不同。
 */
type BiRefNetVariant = 'matting' | 'full' | 'lite';

/** 某档缺失时的降级顺序：能力档退回分割档，容量档在分割档内互退 */
const BIREFNET_FALLBACK_ORDER: Record<BiRefNetVariant, BiRefNetVariant[]> = {
    matting: ['full', 'lite'],
    full: ['lite', 'matting'],
    lite: ['full', 'matting']
};

/**
 * 按文件名与大小判定权重档位。
 *
 * matting 只能靠文件名识别——它与 general 权重同架构、体积也接近（972MB vs 928MB），
 * 大小区分不开。官方发布名是 BiRefNet-matting-epoch_100.onnx，匹配 matting 字样即可。
 */
function classifyBiRefNetWeight(fileName: string, size: number): BiRefNetVariant {
    if (/matting/i.test(fileName)) return 'matting';
    return size >= BIREFNET_FULL_MIN_BYTES ? 'full' : 'lite';
}

const BIREFNET_FULL_MIN_BYTES = 500 * 1024 * 1024;
/** 小于这个体积的多半是下载残留的半截文件 */
const BIREFNET_MIN_VALID_BYTES = 20 * 1024 * 1024;

const BIREFNET_DEFAULT_INPUT_SIZE = 1024;
const BIREFNET_BALANCED_INPUT_SIZE = 1024;
const BIREFNET_FAST_INPUT_SIZE = 1024;
const IMAGENET_MEAN = [0.485, 0.456, 0.406];
const IMAGENET_STD = [0.229, 0.224, 0.225];

// YOLO-World 模型配置
const YOLO_INPUT_SIZE = 640;  // YOLO-World 模型原生分辨率，不可更改
const YOLO_CONF_THRESHOLD = 0.10;  // detection confidence threshold
const YOLO_IOU_THRESHOLD = 0.45;   // NMS IoU threshold

// 框内分割配置（语义抠图的分割段）
/** BiRefNet 降级路径裁剪时的外扩比例：给模型一点上下文才能判断物体边界 */
const BOX_SEGMENT_PADDING_RATIO = 0.12;
const BOX_SEGMENT_MIN_PADDING = 8;
const BOX_SEGMENT_MAX_PADDING = 64;
/**
 * BiRefNet 空闲多久后释放。比 GroundingDINO 长：它是每次抠图的主力，
 * 反复重载（约 2.2 秒）不划算，但停手几分钟后没理由继续占着显存。
 */
const BIREFNET_IDLE_RELEASE_MS = 180 * 1000;
/**
 * SAM 范围蒙版外扩多少再与细节蒙版相交，用局部图长边的比例表示。
 *
 * 这里的分工是「SAM 定范围、BiRefNet 定边缘」。但相交是逐像素与，
 * SAM 说背景的地方 BiRefNet 的边缘一律清零——不外扩的话，最终边界
 * 其实是 SAM 那条 256 网格上采样出来的粗边，BiRefNet 白算。
 *
 * 曾经按「边缘复杂度」测量后定为 0，那个指标是错的：它把 BiRefNet 的
 * 软过渡带算成细节下降，而软过渡恰恰是边缘压在真实轮廓上的证据。
 * 改用「边缘处原图梯度」（越高说明边界越贴真实轮廓）+「硬边占比」重测
 * （袜子+鞋，局部图 1536×853，纯 detail 上限 梯度 36.7 / 硬边 0%）：
 *   0px  → 梯度 31.1，硬边 84.7%   ← 与纯 SAM 的 30.6 几乎一样
 *   2px  → 梯度 36.4，硬边 43.8%
 *   4px  → 梯度 36.5，硬边 25.9%，面积 +2.8%
 *   12px → 梯度 35.9，硬边 17.4%，面积 +4.8%
 * 4px 时边缘位置已贴住 detail 上限，再放大只换来递减的硬边改善和更多面积。
 * 剩下那约 26% 硬边来自物体与邻近物的交界（袜子↔腿），detail 在那里本就
 * 连续，只能由 scope 切开，属于语义边界而非精度损失。
 *
 * 用比例而非固定像素：BiRefNet 固定 1024 输入，过渡带宽度随局部图尺寸等比变化。
 */
const SCOPE_DILATE_RATIO = 4 / 1536;
const SCOPE_DILATE_MIN_PIXELS = 2;
const SCOPE_DILATE_MAX_PIXELS = 8;

/** alpha 达到这个值就算实心前景，外扩带里不再捞它（避免把邻近物整片带进来） */
const SOLID_ALPHA_THRESHOLD = 248;

/**
 * 按局部图尺寸换算语义范围的机械不确定带。
 * 权重档位不能扩大语义权限：matting 的 alpha 过渡更宽，不代表范围外的半透明
 * 像素属于目标；邻近皮肤、鞋和背景边缘同样会产生半透明像素。
 */
export function resolveSemanticScopeRefinementRadius(
    width: number,
    height: number
): number {
    const longSide = Math.max(width, height);
    const scaled = Math.round(longSide * SCOPE_DILATE_RATIO);
    return Math.min(SCOPE_DILATE_MAX_PIXELS, Math.max(SCOPE_DILATE_MIN_PIXELS, scaled));
}

/** 多目标范围之间的窄缝用多大半径合上：只需盖住 SAM 边界的量化误差 */
const SCOPE_GAP_CLOSE_PIXELS = 6;
/** 蒙版贴边超过这个比例，就判定目标被取像范围切断 */
const BORDER_CONTACT_WARN_RATIO = 0.25;
/** 独立部件有多大比例落在目标框内，就认定它属于目标（例如与鞋身断开的鞋带） */
const TARGET_COMPONENT_KEEP_RATIO = 0.6;
/** 判定"框内确实分割出了东西"的灰度阈值 */
const BOX_SEGMENT_FOREGROUND_THRESHOLD = 32;

const YOLO_CLASS_NAMES = [
    'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat',
    'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat', 'dog',
    'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe', 'backpack', 'umbrella',
    'handbag', 'tie', 'suitcase', 'frisbee', 'skis', 'snowboard', 'sports ball', 'kite',
    'baseball bat', 'baseball glove', 'skateboard', 'surfboard', 'tennis racket', 'bottle',
    'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple', 'sandwich',
    'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair', 'couch',
    'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse', 'remote',
    'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink', 'refrigerator', 'book',
    'clock', 'vase', 'scissors', 'teddy bear', 'hair drier', 'toothbrush'
] as const;
const YOLO_PROMPT_CLASS_ALIASES: Record<string, string[]> = {
    person: ['person', 'people', 'human', 'model', '\u4eba', '\u4eba\u50cf', '\u6a21\u7279'],
    bicycle: ['bicycle', 'bike', '\u81ea\u884c\u8f66', '\u5355\u8f66'],
    car: ['car', 'auto', '\u6c7d\u8f66'],
    motorcycle: ['motorcycle', 'motorbike', '\u6469\u6258\u8f66'],
    bus: ['bus', '\u516c\u4ea4\u8f66', '\u5df4\u58eb'],
    train: ['train', '\u706b\u8f66'],
    truck: ['truck', '\u5361\u8f66'],
    boat: ['boat', 'ship', '\u8239'],
    bird: ['bird', '\u9e1f'],
    cat: ['cat', '\u732b'],
    dog: ['dog', '\u72d7'],
    horse: ['horse', '\u9a6c'],
    backpack: ['backpack', '\u80cc\u5305', '\u53cc\u80a9\u5305'],
    umbrella: ['umbrella', '\u96e8\u4f1e'],
    handbag: ['handbag', 'bag', 'purse', '\u624b\u63d0\u5305', '\u5305'],
    tie: ['tie', '\u9886\u5e26'],
    suitcase: ['suitcase', 'luggage', '\u884c\u674e\u7bb1', '\u7bb1\u5b50'],
    bottle: ['bottle', '\u74f6\u5b50'],
    cup: ['cup', 'mug', '\u676f\u5b50'],
    bowl: ['bowl', '\u7897'],
    chair: ['chair', '\u6905\u5b50'],
    couch: ['couch', 'sofa', '\u6c99\u53d1'],
    'potted plant': ['plant', 'potted plant', '\u690d\u7269', '\u76c6\u683d'],
    bed: ['bed', '\u5e8a'],
    tv: ['tv', 'monitor', '\u7535\u89c6', '\u663e\u793a\u5668'],
    laptop: ['laptop', 'notebook', '\u7b14\u8bb0\u672c', '\u7535\u8111'],
    mouse: ['mouse', '\u9f20\u6807'],
    keyboard: ['keyboard', '\u952e\u76d8'],
    'cell phone': ['phone', 'cell phone', 'mobile phone', '\u624b\u673a'],
    book: ['book', '\u4e66'],
    vase: ['vase', '\u82b1\u74f6'],
    scissors: ['scissors', '\u526a\u5200'],
    toothbrush: ['toothbrush', '\u7259\u5237'],
    'hair drier': ['hair drier', 'hair dryer', '\u5439\u98ce\u673a']
};

// ==================== 检测结果类型 ====================

export interface DetectionBox {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    confidence: number;
    label: string;
}

/**
 * 框内分割器（由 SAMService 实现并在主进程注入）。
 * MattingService 只依赖这个最小形状，不反向依赖 SAM 实现细节。
 */
export interface BoxSegmenter {
    isReady(): boolean;
    segmentWithBox(
        imageBuffer: Buffer,
        box: { x1: number; y1: number; x2: number; y2: number },
        guidancePoints?: BoxSegmenterPointPrompt[]
    ): Promise<{
        success: boolean;
        mask?: Buffer;
        maskWidth?: number;
        maskHeight?: number;
        error?: string;
    }>;
}

export interface BoxSegmenterPointPrompt {
    x: number;
    y: number;
    label: 0 | 1;
}

// ==================== 智能分割服务类 ====================

export class MattingService {
    private static readonly SIGMOID_LUT_MIN = -16;
    private static readonly SIGMOID_LUT_MAX = 16;
    private static readonly SIGMOID_LUT_STEP = 1 / 128;
    private static sigmoidLut: Uint8Array | null = null;

    private config: MattingConfig;
    private modelsDir: string;
    private initialized: boolean = false;

    // 最近一次失败的真实原因（用于给用户分层的、可操作的错误信息，而不是笼统的"模型未安装"）
    private lastDependencyError: string | null = null;
    private lastBiRefNetLoadError: { kind: 'dependency' | 'model-missing' | 'load-failed'; detail: string } | null = null;

    // ONNX Runtime 和 Sharp（延迟加载）
    private ort: typeof import('onnxruntime-node') | null = null;
    private sharp: SharpConstructor | null = null;
    
    // 模型会话缓存
    // BiRefNet 双档：full（birefnet.onnx，~970MB，边缘最优但慢）/ lite（birefnet_lite|_old.onnx，~220MB，3-5 倍速）
    // birefnetSession 始终指向当前激活档位的会话（保持既有推理代码不变）
    private birefnetSession: any = null;
    private birefnetSessionByTier: Record<BiRefNetVariant, any | null> = { matting: null, full: null, lite: null };
    private birefnetActiveTier: BiRefNetVariant | null = null;
    private yoloWorldSession: any = null;

    // 框内分割器（SAM）：语义抠图优先用它在目标框内分割，未注入时降级为裁剪 + BiRefNet
    private boxSegmenter: BoxSegmenter | null = null;

    // 空闲释放：BiRefNet 常驻约占 627MB 显存，停手后应归还
    private idleTimer: NodeJS.Timeout | null = null;
    private inFlightInference = 0;
    /** 防止 CPU 重跑再次失败时无限递归 */
    private cpuRetryInFlight = false;

    // GPU 加速状态
    private gpuStatus: GPUStatus = { available: false, provider: 'cpu' };
    private activeExecutionProvider: ExecutionProvider = 'cpu';

    constructor(config?: Partial<MattingConfig>) {
        this.config = { 
            defaultQuality: 'balanced',
            gpuMode: 'auto',  // 默认自动检测
            ...config 
        };
        
        // 定位 models 目录
        // 优先级：显式配置的 modelsDir > 工程内相对目录（开发/工作目录探测）
        // 运行时由 index.ts 传入 app.getPath('userData')/models，与模型下载(model-download-handlers)、
        // 设置页列模型(matting-handlers)保持同一目录；未显式配置时回退相对目录，兼容测试与开发场景。
        if (this.config.modelsDir) {
            this.modelsDir = this.config.modelsDir;
        } else {
            const possiblePaths = [
                path.join(__dirname, '../../../../models'),     // 开发模式
                path.join(__dirname, '../../../models'),        // 备选
                path.join(process.cwd(), 'models'),             // 工作目录
            ];
            this.modelsDir = possiblePaths.find(p => fs.existsSync(p)) || possiblePaths[0];
        }
        console.log(`[MattingService] 模型目录: ${this.modelsDir}`);
        console.log(`[MattingService] GPU 模式: ${this.config.gpuMode}`);
        console.log('[MattingService] 本地分割服务实例已创建，模型按实际任务与可用文件延迟加载');
    }

    private isVerboseLoggingEnabled(): boolean {
        return process.env.DESIGNECHO_MATTING_DEBUG === '1';
    }

    private debugLog(message: string, ...args: any[]): void {
        if (!this.isVerboseLoggingEnabled()) {
            return;
        }
        console.log(message, ...args);
    }

    // ==================== 初始化 ====================

    /**
     * 确保依赖已加载
     */
    private async ensureInitialized(): Promise<boolean> {
        if (this.initialized) return true;

        try {
            this.ort = await import('onnxruntime-node');
            this.sharp = (await import('sharp')).default;

            // 检测并配置 GPU 加速
            await this.detectAndConfigureGPU();

            this.initialized = true;
            this.lastDependencyError = null;
            console.log('[MattingService] ✅ 依赖加载完成');
            return true;
        } catch (e: any) {
            this.lastDependencyError = e.message || String(e);
            console.error('[MattingService] ❌ 依赖加载失败:', e.message);
            return false;
        }
    }
    
    /**
     * 检测并配置 GPU 加速
     * 优先级: CUDA > DirectML > CPU
     */
    private async detectAndConfigureGPU(): Promise<void> {
        if (!this.ort) return;
        
        const gpuMode = this.config.gpuMode || 'auto';
        
        // 强制 CPU 模式
        if (gpuMode === 'cpu') {
            this.activeExecutionProvider = 'cpu';
            this.gpuStatus = { available: false, provider: 'cpu' };
            console.log('[MattingService] 🖥️ 使用 CPU 模式（手动指定）');
            return;
        }
        
        // 检测可用的执行提供程序
        const availableProviders = this.getAvailableProviders();
        console.log('[MattingService] 可用的执行提供程序:', availableProviders);
        
        // 根据配置选择
        if (gpuMode === 'cuda' || (gpuMode === 'auto' && availableProviders.includes('cuda'))) {
            // 尝试 CUDA
            if (await this.testExecutionProvider('cuda')) {
                this.activeExecutionProvider = 'cuda';
                this.gpuStatus = { 
                    available: true, 
                    provider: 'cuda',
                    deviceName: 'NVIDIA GPU (CUDA)'
                };
                console.log('[MattingService] 🚀 启用 CUDA GPU 加速');
                return;
            }
        }
        
        if (gpuMode === 'directml' || (gpuMode === 'auto' && availableProviders.includes('dml'))) {
            // 尝试 DirectML
            if (await this.testExecutionProvider('dml')) {
                this.activeExecutionProvider = 'dml';
                this.gpuStatus = { 
                    available: true, 
                    provider: 'dml',
                    deviceName: 'GPU (DirectML)'
                };
                console.log('[MattingService] 🚀 启用 DirectML GPU 加速');
                return;
            }
        }
        
        // 回退到 CPU
        this.activeExecutionProvider = 'cpu';
        this.gpuStatus = { available: false, provider: 'cpu' };
        console.log('[MattingService] 🖥️ 使用 CPU 模式（GPU 不可用）');
    }
    
    /**
     * 获取可用的执行提供程序列表
     */
    private getAvailableProviders(): string[] {
        try {
            // onnxruntime-node 通过环境检测支持的提供程序
            const providers: string[] = ['cpu'];
            
            // 检查 CUDA 库是否存在（Windows: nvcuda.dll, Linux: libcuda.so）
            const isWindows = process.platform === 'win32';
            if (isWindows) {
                // Windows: 检查 CUDA
                try {
                    const cudaPath = process.env.CUDA_PATH;
                    if (cudaPath && fs.existsSync(path.join(cudaPath, 'bin', 'cudart64_12.dll'))) {
                        providers.push('cuda');
                    }
                } catch {}
                
                // DirectML 在 Windows 10+ 默认可用
                providers.push('dml');
            } else {
                // Linux/Mac: 检查 CUDA
                try {
                    if (fs.existsSync('/usr/local/cuda/lib64/libcudart.so')) {
                        providers.push('cuda');
                    }
                } catch {}
            }
            
            return providers;
        } catch {
            return ['cpu'];
        }
    }
    
    /**
     * 测试执行提供程序是否可用
     * 通过尝试加载一个简单模型来验证
     */
    private async testExecutionProvider(provider: ExecutionProvider): Promise<boolean> {
        if (!this.ort) return false;
        
        console.log(`[MattingService] 测试 ${provider} 执行提供程序...`);
        
        try {
            // 检查 ONNX Runtime 支持的执行提供程序
            // 注意：onnxruntime-node 1.16+ 在 Windows 上默认包含 DirectML
            
            // 构建会话选项
            const sessionOptions: any = {
                // 这个会话会被留作正式推理复用，优化级别必须与 getSessionOptions 一致，
                // 否则 provider 探测顺带把正式推理降级到 basic 优化
                graphOptimizationLevel: 'all',
                logSeverityLevel: 4  // 只显示错误
            };
            
            // onnxruntime-node 使用小写的后端名称
            if (provider === 'cuda') {
                sessionOptions.executionProviders = [{
                    name: 'cuda',
                    deviceId: 0
                }];
            } else if (provider === 'dml') {
                sessionOptions.executionProviders = [{
                    name: 'dml',
                    deviceId: 0
                }];
            } else {
                sessionOptions.executionProviders = ['cpu'];
            }
            
            // 用真实模型验证 provider，验证完直接留作正式会话复用——
            // 旧实现立即 release 后又加载同一模型，冷启动重复占用时间和峰值内存。
            //
            // 但加载哪个档位必须由默认质量解析，且按解析出的**实际**档位登记。
            // 曾经这里硬编码 birefnet.onnx（lite）却写死登记成 full 档，于是
            // loadBiRefNetModel('full') 一看 full 档已有会话就复用，真正的 full 权重
            // （BiRefNet-general 928MB）永远被挡在门外，quality 档跑的一直是 lite。
            const testTier = this.resolveBiRefNetTier(this.config.defaultQuality);
            const resolved = this.resolveBiRefNetModelPath(testTier);
            if (resolved) {
                const testSession = await this.ort.InferenceSession.create(resolved.path, sessionOptions);
                this.birefnetSession = testSession;
                this.birefnetSessionByTier[resolved.tier] = testSession;
                this.birefnetActiveTier = resolved.tier;
                console.log(
                    `[MattingService] ✅ ${provider} 执行提供程序可用，`
                    + `复用已加载的 BiRefNet ${resolved.tier} 会话`
                );
                return true;
            }
            
            // 如果模型不存在，假设提供程序可用（将在实际加载时验证）
            console.log(`[MattingService] ⚠️ ${provider} 无法验证（模型未找到），将在加载时确认`);
            return true;
        } catch (e: any) {
            console.log(`[MattingService] ❌ ${provider} 不可用: ${e.message}`);
            return false;
        }
    }
    
    /**
     * 获取当前 GPU 状态
     */
    getGPUStatus(): GPUStatus {
        return this.gpuStatus;
    }
    
    /**
     * 获取优化的会话选项
     */
    private getSessionOptions(): any {
        const options: any = {
            graphOptimizationLevel: 'all',
            enableCpuMemArena: true,
            enableMemPattern: true,
            // 抑制 ONNX Runtime 警告（logSeverityLevel: 3 = Error 级别，只显示错误和致命消息）
            // 这会抑制 "Some nodes were not assigned to the preferred execution providers" 警告
            // 该警告是正常的 - ORT 会将某些操作（如形状相关操作）分配到 CPU 以优化性能
            logSeverityLevel: 3
        };
        
        // 根据活动的执行提供程序配置
        // 注意：onnxruntime-node 使用小写的后端名称：cpu, dml, cuda, webgpu
        switch (this.activeExecutionProvider) {
            case 'cuda':
                options.executionProviders = [
                    {
                        name: 'cuda',
                        deviceId: 0,
                        cudnnConvAlgoSearch: 'DEFAULT',
                        gpuMemLimit: 2 * 1024 * 1024 * 1024  // 2GB 显存限制
                    },
                    'cpu'  // 备用
                ];
                break;
                
            case 'dml':
                options.executionProviders = [
                    {
                        name: 'dml',
                        deviceId: 0
                    },
                    'cpu'  // 备用
                ];
                break;
                
            default:
                options.executionProviders = ['cpu'];
                options.intraOpNumThreads = Math.max(1, Math.floor(require('os').cpus().length / 2));
        }
        
        return options;
    }

    /**
     * 归一化质量档位
     * - 字符串质量: fast / balanced / quality
     * - 数值质量: 0-100（>=85 视为 quality，>=60 视为 balanced，其余为 fast）
     */
    private normalizeQualityLevel(quality?: QualityLevel | number): QualityLevel {
        if (typeof quality === 'string') {
            if (quality === 'fast' || quality === 'balanced' || quality === 'quality') {
                return quality;
            }
            return this.config.defaultQuality || 'balanced';
        }

        if (typeof quality === 'number' && Number.isFinite(quality)) {
            if (quality >= 85) return 'quality';
            if (quality >= 60) return 'balanced';
            return 'fast';
        }

        return this.config.defaultQuality || 'balanced';
    }

    /**
     * 根据质量档位选择 BiRefNet 推理尺寸
     * 说明：
     * - 当前模型固定输入 1024x1024
     * - quality / balanced / fast 均回落到 1024
     */
    private resolveBiRefNetInputSize(quality?: QualityLevel | number): number {
        const level = this.normalizeQualityLevel(quality);
        if (level === 'quality') return BIREFNET_DEFAULT_INPUT_SIZE;
        if (level === 'fast') return BIREFNET_FAST_INPUT_SIZE;
        return BIREFNET_BALANCED_INPUT_SIZE;
    }

    /**
     * 归一化边缘细化模式
     */
    private normalizeEdgeRefineMode(mode?: string): 'none' | 'light' | 'standard' | 'hair' | 'product-hard' {
        const m = (mode || '').toLowerCase();
        if (m === 'none' || m === 'off' || m === 'refine-none') return 'none';
        if (m === 'light' || m === 'refine-light') return 'light';
        if (m === 'hair' || m === 'refine-hair') return 'hair';
        if (
            m === 'product-hard' ||
            m === 'product' ||
            m === 'hard' ||
            m === 'refine-product' ||
            m === 'refine-product-hard' ||
            m === 'goods'
        ) {
            return 'product-hard';
        }
        if (m === 'standard' || m === 'smart' || m === 'refine-standard' || m === 'refine-smart' || m === 'vitmatte' || m === 'refine-inspyrenet') {
            return 'standard';
        }
        return 'standard';
    }

    private projectBoxToMaskSpace(
        box: { x1: number; y1: number; x2: number; y2: number },
        sourceWidth: number,
        sourceHeight: number,
        targetWidth: number,
        targetHeight: number
    ): { x1: number; y1: number; x2: number; y2: number } | null {
        if (
            !Number.isFinite(sourceWidth) ||
            !Number.isFinite(sourceHeight) ||
            !Number.isFinite(targetWidth) ||
            !Number.isFinite(targetHeight) ||
            sourceWidth <= 0 ||
            sourceHeight <= 0 ||
            targetWidth <= 0 ||
            targetHeight <= 0
        ) {
            return null;
        }

        const scaleX = targetWidth / sourceWidth;
        const scaleY = targetHeight / sourceHeight;

        const projectedX1 = box.x1 * scaleX;
        const projectedY1 = box.y1 * scaleY;
        const projectedX2 = box.x2 * scaleX;
        const projectedY2 = box.y2 * scaleY;

        return {
            x1: Math.min(projectedX1, projectedX2),
            y1: Math.min(projectedY1, projectedY2),
            x2: Math.max(projectedX1, projectedX2),
            y2: Math.max(projectedY1, projectedY2)
        };
    }

    private constrainMaskToBoxes(
        maskBuffer: Buffer,
        width: number,
        height: number,
        boxes: Array<{ x1: number; y1: number; x2: number; y2: number }>,
        paddingRatio: number,
        minPadding: number,
        maxPadding: number
    ): Buffer {
        const constrainedMask = Buffer.alloc(width * height, 0);

        for (const box of boxes) {
            const boxWidth = Math.max(0, box.x2 - box.x1);
            const boxHeight = Math.max(0, box.y2 - box.y1);
            if (boxWidth <= 0 || boxHeight <= 0) {
                continue;
            }

            const padding = Math.max(
                minPadding,
                Math.min(maxPadding, Math.round(Math.min(boxWidth, boxHeight) * paddingRatio))
            );

            const x1 = Math.max(0, Math.round(box.x1 - padding));
            const y1 = Math.max(0, Math.round(box.y1 - padding));
            const x2 = Math.min(width, Math.round(box.x2 + padding));
            const y2 = Math.min(height, Math.round(box.y2 + padding));

            for (let y = y1; y < y2; y++) {
                const rowOffset = y * width;
                for (let x = x1; x < x2; x++) {
                    const idx = rowOffset + x;
                    constrainedMask[idx] = Math.max(constrainedMask[idx], maskBuffer[idx]);
                }
            }
        }

        return constrainedMask;
    }

    /**
     * 自适应边缘细化（避免直接硬化导致锯齿）
     *
     * 设计思路（参考 PS Select & Mask）：
     * 1. 不做全局硬阈值，只在不确定区域（0<a<255）处理。
     * 2. 用局部 alpha 梯度区分硬边/软边。
     * 3. 硬边：轻微内收，减少背景残留。
     * 4. 软边（毛发/织物纤维）：保留半透明并轻微平滑，防止锯齿。
     */
    private refineMaskEdgesAdaptive(
        maskData: Uint8Array,
        width: number,
        height: number,
        mode?: string
    ): { mode: string; touched: number } {
        const refineMode = this.normalizeEdgeRefineMode(mode);
        if (refineMode === 'none') {
            return { mode: refineMode, touched: 0 };
        }

        const source = new Uint8Array(maskData);
        let touched = 0;

        const params = refineMode === 'hair'
            ? { lowClip: 4, highClip: 252, hardGrad: 70, softGrad: 30, hardBoost: 6, hardContract: 3, softBlend: 6 }
            : refineMode === 'light'
                ? { lowClip: 8, highClip: 248, hardGrad: 60, softGrad: 24, hardBoost: 8, hardContract: 6, softBlend: 5 }
                : refineMode === 'product-hard'
                    ? { lowClip: 18, highClip: 238, hardGrad: 42, softGrad: 12, hardBoost: 14, hardContract: 16, softBlend: 2 }
                    : { lowClip: 12, highClip: 244, hardGrad: 50, softGrad: 20, hardBoost: 10, hardContract: 8, softBlend: 4 };

        // 第一遍：轻量 clip，去掉极弱背景并固定强前景
        for (let i = 0; i < source.length; i++) {
            const a = source[i];
            if (a <= params.lowClip) {
                maskData[i] = 0;
            } else if (a >= params.highClip) {
                maskData[i] = 255;
            } else {
                maskData[i] = a;
            }
        }

        // 第二遍：只处理不确定边缘区
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = y * width + x;
                const a = source[idx];
                if (a <= params.lowClip || a >= params.highClip) continue;

                const l = source[idx - 1];
                const r = source[idx + 1];
                const u = source[idx - width];
                const d = source[idx + width];

                const grad = Math.abs(a - l) + Math.abs(a - r) + Math.abs(a - u) + Math.abs(a - d);

                let fgVotes = 0;
                let bgVotes = 0;
                if (l >= 200) fgVotes++;
                if (r >= 200) fgVotes++;
                if (u >= 200) fgVotes++;
                if (d >= 200) fgVotes++;
                if (l <= 40) bgVotes++;
                if (r <= 40) bgVotes++;
                if (u <= 40) bgVotes++;
                if (d <= 40) bgVotes++;

                let out = a;
                if (grad >= params.hardGrad) {
                    // 硬边：抑制背景残留，但避免全局硬化
                    out = fgVotes >= bgVotes
                        ? Math.min(255, a + params.hardBoost)
                        : Math.max(0, a - params.hardContract);
                } else if (grad <= params.softGrad) {
                    // 软边：保留毛发/纤维过渡，同时做轻微抗锯齿平滑
                    const avg4 = (l + r + u + d) >> 2;
                    out = Math.round((a * params.softBlend + avg4 * (8 - params.softBlend)) / 8);
                }

                if (out !== maskData[idx]) {
                    maskData[idx] = out;
                    touched++;
                }
            }
        }

        return { mode: refineMode, touched };
    }

    private getSigmoidLookupTable(): Uint8Array {
        if (MattingService.sigmoidLut) {
            return MattingService.sigmoidLut;
        }

        const min = MattingService.SIGMOID_LUT_MIN;
        const max = MattingService.SIGMOID_LUT_MAX;
        const step = MattingService.SIGMOID_LUT_STEP;
        const size = Math.floor((max - min) / step) + 1;
        const lut = new Uint8Array(size);

        for (let i = 0; i < size; i++) {
            const x = min + i * step;
            const sigmoid = 1 / (1 + Math.exp(-x));
            lut[i] = Math.round(sigmoid * 255);
        }

        MattingService.sigmoidLut = lut;
        return lut;
    }

    private logitsToMask(
        outputData: Float32Array,
        channelOffset: number,
        numPixels: number
    ): Uint8Array {
        const lut = this.getSigmoidLookupTable();
        const lutMin = MattingService.SIGMOID_LUT_MIN;
        const lutMax = MattingService.SIGMOID_LUT_MAX;
        const step = MattingService.SIGMOID_LUT_STEP;
        const invStep = 1 / step;
        const lutLast = lut.length - 1;
        const maskData = new Uint8Array(numPixels);

        for (let i = 0; i < numPixels; i++) {
            const v = outputData[channelOffset + i];

            if (v <= lutMin) {
                maskData[i] = 0;
                continue;
            }
            if (v >= lutMax) {
                maskData[i] = 255;
                continue;
            }

            const scaled = (v - lutMin) * invStep;
            const idx = Math.max(0, Math.min(lutLast - 1, Math.floor(scaled)));
            const frac = scaled - idx;
            const low = lut[idx];
            const high = lut[idx + 1];
            maskData[i] = Math.round(low + (high - low) * frac);
        }

        return maskData;
    }

    private cleanupResizedMaskEdges(
        maskData: Uint8Array,
        width: number,
        height: number,
        mode?: string
    ): { mode: string; touched: number } {
        const refineMode = this.normalizeEdgeRefineMode(mode);
        if (refineMode === 'none') {
            return { mode: refineMode, touched: 0 };
        }

        const source = new Uint8Array(maskData);
        let touched = 0;

        const params = refineMode === 'hair'
            ? { lowClip: 5, highClip: 250, bgSupportMax: 45, fgSupportMin: 210, push: 8, voteBoost: 4 }
            : refineMode === 'light'
                ? { lowClip: 8, highClip: 248, bgSupportMax: 52, fgSupportMin: 204, push: 12, voteBoost: 6 }
                : refineMode === 'product-hard'
                    ? { lowClip: 16, highClip: 240, bgSupportMax: 70, fgSupportMin: 186, push: 22, voteBoost: 12 }
                    : { lowClip: 10, highClip: 246, bgSupportMax: 58, fgSupportMin: 198, push: 15, voteBoost: 8 };

        for (let i = 0; i < source.length; i++) {
            const a = source[i];
            if (a <= params.lowClip) {
                if (maskData[i] !== 0) {
                    maskData[i] = 0;
                    touched++;
                }
                continue;
            }
            if (a >= params.highClip) {
                if (maskData[i] !== 255) {
                    maskData[i] = 255;
                    touched++;
                }
            }
        }

        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = y * width + x;
                const a = source[idx];
                if (a <= params.lowClip || a >= params.highClip) continue;

                const l = source[idx - 1];
                const r = source[idx + 1];
                const u = source[idx - width];
                const d = source[idx + width];

                let fgVotes = 0;
                let bgVotes = 0;
                if (l >= 205) fgVotes++;
                if (r >= 205) fgVotes++;
                if (u >= 205) fgVotes++;
                if (d >= 205) fgVotes++;
                if (l <= 50) bgVotes++;
                if (r <= 50) bgVotes++;
                if (u <= 50) bgVotes++;
                if (d <= 50) bgVotes++;

                const localMin = Math.min(a, l, r, u, d);
                const localMax = Math.max(a, l, r, u, d);
                let out = a;

                if (localMax <= params.bgSupportMax) {
                    out = Math.max(0, a - params.push);
                } else if (localMin >= params.fgSupportMin) {
                    out = Math.min(255, a + params.push);
                } else if (bgVotes >= 3 && a < 168) {
                    out = Math.max(0, a - (params.push + params.voteBoost));
                } else if (fgVotes >= 3 && a > 88) {
                    out = Math.min(255, a + (params.push + params.voteBoost));
                }

                if (out !== maskData[idx]) {
                    maskData[idx] = out;
                    touched++;
                }
            }
        }

        return { mode: refineMode, touched };
    }

    /**
     * 加载 BiRefNet 模型
     */
    /** 解析档位对应的模型文件；lite 档缺文件时回退 full（反之亦然），并如实记录 */
    /**
     * 在模型目录里按"文件多大"而不是"文件叫什么"来认档位。
     *
     * 起因：用户目录里的 birefnet.onnx 实际是 lite 版（与官方 BiRefNet_lite 哈希一致），
     * 而真正的完整版叫 BiRefNet-general-epoch_244.onnx 从没被加载过。
     * 靠文件名认档位时，系统一边打日志说"回退 full 档"一边加载 lite，
     * 对自己的能力撒了一整套自洽的谎——排查性能和显存问题时全被这个假前提带偏。
     *
     * 文件名由下载来源决定（HuggingFace 上都叫 model.onnx），本就不可靠；
     * 权重规模才是档位的真实标志。
     */
    private resolveBiRefNetModelPath(tier: BiRefNetVariant): { path: string; tier: BiRefNetVariant } | null {
        const dir = path.join(this.modelsDir, 'birefnet');
        if (!fs.existsSync(dir)) return null;

        const found: Array<{ path: string; size: number; tier: BiRefNetVariant }> = [];
        for (const name of fs.readdirSync(dir)) {
            if (!name.toLowerCase().endsWith('.onnx')) continue;
            const full = path.join(dir, name);
            const size = fs.statSync(full).size;
            if (size < BIREFNET_MIN_VALID_BYTES) continue;
            found.push({ path: full, size, tier: classifyBiRefNetWeight(name, size) });
        }
        if (found.length === 0) return null;

        // 同档位内取最大的那个（更完整的权重）
        const pick = (want: BiRefNetVariant) => found
            .filter(item => item.tier === want)
            .sort((a, b) => b.size - a.size)[0];

        const wanted = pick(tier);
        if (wanted) {
            this.debugLog(
                `[MattingService] ${tier} 档选用 ${path.basename(wanted.path)}`
                + `（${(wanted.size / 1048576).toFixed(0)}MB）`
            );
            return { path: wanted.path, tier };
        }

        // 有序降级：matting 缺失退 full，full 缺失退 lite，反向亦然。
        // 不用二选一是因为 matting 属于能力档，缺失时只能退回分割能力，没有第三种选择。
        const order: BiRefNetVariant[] = BIREFNET_FALLBACK_ORDER[tier];
        for (const candidate of order) {
            const other = pick(candidate);
            if (!other) continue;
            console.warn(
                `[MattingService] ${tier} 档模型不存在，改用 ${other.tier} 档 `
                + `${path.basename(other.path)}（${(other.size / 1048576).toFixed(0)}MB）`
            );
            return { path: other.path, tier: other.tier };
        }
        return null;
    }

    private resolveBiRefNetTier(quality?: QualityLevel | number): BiRefNetVariant {
        const level = this.normalizeQualityLevel(quality);
        // quality 档要的是"最好的边缘"，而 matting 权重是唯一能给出真 alpha 的一档；
        // 权重不在时 resolveBiRefNetModelPath 会按 BIREFNET_FALLBACK_ORDER 退回 full。
        return level === 'quality' ? 'matting' : 'lite';
    }

    private async loadBiRefNetModel(tier: BiRefNetVariant = 'full'): Promise<boolean> {
        // 已有目标档位会话：切换激活指针即可
        if (this.birefnetSessionByTier[tier]) {
            this.birefnetSession = this.birefnetSessionByTier[tier];
            this.birefnetActiveTier = tier;
            return true;
        }

        await this.ensureInitialized();
        if (!this.ort) {
            this.lastBiRefNetLoadError = {
                kind: 'dependency',
                detail: this.lastDependencyError || 'onnxruntime 依赖加载失败'
            };
            return false;
        }

        const resolved = this.resolveBiRefNetModelPath(tier);
        if (!resolved) {
            const expected = path.join(this.modelsDir, 'birefnet', 'birefnet.onnx');
            console.warn(`[MattingService] BiRefNet 模型未找到: ${expected}`);
            this.lastBiRefNetLoadError = { kind: 'model-missing', detail: expected };
            return false;
        }
        // 回退后的实际档位若已加载，直接复用
        if (this.birefnetSessionByTier[resolved.tier]) {
            this.birefnetSession = this.birefnetSessionByTier[resolved.tier];
            this.birefnetActiveTier = resolved.tier;
            return true;
        }
        const modelPath = resolved.path;
        
        // BiRefNet 一律走 CPU。这不是保守选择，是实测结论：
        //
        //   lite 权重(214MB)  DML 4.5s / 占 4808MiB   CPU 3.756s / 占 34MiB
        //   matting(928MB)    DML 19.1s / 占 4017MiB  CPU 16.3s  / 占 158MiB
        //
        // 显存空闲时两者速度本就接近，而 DML 要吃掉近 5GB——这些几乎全是
        // 1024x1024 的中间激活，与权重大小无关（214MB 和 928MB 占用一样多）。
        // 显存一旦被占满，DML 开始往共享内存换页，lite 单次直接掉到 12.9s，
        // 比 CPU 慢 3.4 倍。真机 RTX 3060 Ti 8GB 已实测到专用显存打满并溢出。
        //
        // 只改这一个会话的 provider，不动 this.activeExecutionProvider——
        // SAM 与 GroundingDINO 占用小、受益大，继续留在 GPU 上。
        const forceCpu = true;

        try {
            const providerName = forceCpu ? 'CPU(BiRefNet 固定)' : this.activeExecutionProvider.toUpperCase();
            console.log(`[MattingService] 正在加载 BiRefNet 模型 (${providerName})...`);
            const startTime = Date.now();
            
            // 使用优化的会话选项（包含 GPU 加速配置）
            const sessionOptions = forceCpu
                ? { executionProviders: ['cpu'], graphOptimizationLevel: 'all', logSeverityLevel: 3 }
                : this.getSessionOptions();
            
            try {
                this.birefnetSession = await this.ort.InferenceSession.create(modelPath, sessionOptions);
            } catch (gpuError: any) {
                if (forceCpu) throw gpuError;
                // GPU 加载失败，回退到 CPU
                if (this.activeExecutionProvider !== 'cpu') {
                    console.warn(`[MattingService] ${providerName} 加载失败，回退到 CPU: ${gpuError.message}`);
                    this.activeExecutionProvider = 'cpu';
                    this.gpuStatus = { available: false, provider: 'cpu' };
                    
                    this.birefnetSession = await this.ort.InferenceSession.create(modelPath, {
                        executionProviders: ['cpu'],
                        graphOptimizationLevel: 'all',
                        logSeverityLevel: 3  // 抑制警告
                    });
                } else {
                    throw gpuError;
                }
            }
            
            const loadTime = Date.now() - startTime;
            const sizeMB = Math.round(fs.statSync(modelPath).size / 1024 / 1024);
            // 用这个会话真正的 provider，不要用全局 activeExecutionProvider——
            // matting 档固定走 CPU 而全局仍是 DML，照抄全局会打出
            // "[matting/928MB/DML]" 这种自相矛盾的行，误导现场诊断。
            const sessionProvider = forceCpu ? 'CPU' : this.activeExecutionProvider.toUpperCase();
            console.log(`[MattingService] ✅ BiRefNet 模型加载完成 [${resolved.tier}/${sizeMB}MB/${sessionProvider}] (${loadTime}ms)`);
            this.birefnetSessionByTier[resolved.tier] = this.birefnetSession;
            this.birefnetActiveTier = resolved.tier;
            this.lastBiRefNetLoadError = null;
            return true;
        } catch (e: any) {
            console.error(`[MattingService] ❌ BiRefNet 模型加载失败 [${resolved.tier}]: ${e.message}`);
            this.lastBiRefNetLoadError = { kind: 'load-failed', detail: e.message || String(e) };
            return false;
        }
    }

    /**
     * 加载 YOLO-World 模型（开放词汇目标检测）
     */
    private async loadYoloWorldModel(): Promise<boolean> {
        if (this.yoloWorldSession) return true;
        
        await this.ensureInitialized();
        if (!this.ort) return false;
        
        const modelPath = path.join(this.modelsDir, 'yolo-world', 'yolov8s-worldv2.onnx');
        
        if (!fs.existsSync(modelPath)) {
            console.warn(`[MattingService] YOLO-World 模型未找到: ${modelPath}`);
            return false;
        }
        
        try {
            const providerName = this.activeExecutionProvider.toUpperCase();
            console.log(`[MattingService] 正在加载 YOLO-World 模型 (${providerName})...`);
            const startTime = Date.now();
            
            // 使用优化的会话选项（包含 GPU 加速配置）
            const sessionOptions = this.getSessionOptions();
            
            try {
                this.yoloWorldSession = await this.ort.InferenceSession.create(modelPath, sessionOptions);
            } catch (gpuError: any) {
                // GPU 加载失败，回退到 CPU
                if (this.activeExecutionProvider !== 'cpu') {
                    console.warn(`[MattingService] YOLO-World ${providerName} 加载失败，回退到 CPU`);
                    this.yoloWorldSession = await this.ort.InferenceSession.create(modelPath, {
                        executionProviders: ['cpu'],
                        graphOptimizationLevel: 'all',
                        logSeverityLevel: 3  // 抑制警告
                    });
                } else {
                    throw gpuError;
                }
            }
            
            const loadTime = Date.now() - startTime;
            console.log(`[MattingService] ✅ YOLO-World 模型加载完成 [${this.activeExecutionProvider.toUpperCase()}] (${loadTime}ms)`);
            return true;
        } catch (e: any) {
            console.error(`[MattingService] ❌ YOLO-World 模型加载失败: ${e.message}`);
            return false;
        }
    }

    // ==================== 核心推理 ====================

    /**
     * BiRefNet 推理 - 生成分割蒙版
     * 
     * @param imageBuffer - 输入图像 Buffer (PNG/JPEG)
     * @returns 分割蒙版 Buffer (灰度 RAW)
     */
    private async runBiRefNetInference(
        imageBuffer: Buffer,
        inputSize: number,
        targetWidth?: number,
        targetHeight?: number,
        edgeRefineMode?: string
    ): Promise<{
        maskBuffer: Buffer;
        width: number;
        height: number;
        sourceWidth: number;
        sourceHeight: number;
    } | null> {
        if (!this.birefnetSession || !this.sharp || !this.ort) {
            console.error('[MattingService] 模型或依赖未加载');
            return null;
        }

        // 记在途推理数：空闲释放要等所有推理跑完，否则会抽掉正在使用的会话
        this.inFlightInference++;
        try {
            // 1. 获取输入图像尺寸（imageBuffer 的实际尺寸，非 PS 原始尺寸）
            const metadata = await this.sharp(imageBuffer).metadata();
            const imgWidth = metadata.width!;
            const imgHeight = metadata.height!;
            
            this.debugLog(`[MattingService] 输入图像: ${imgWidth}x${imgHeight}, 目标输出: ${targetWidth || imgWidth}x${targetHeight || imgHeight}`);
            
            // 2. 预处理：保持纵横比 resize（contain）+ 归一化
            // 计算 contain 布局参数，用于推理后裁掉 padding 区域
            const scale = Math.min(inputSize / imgWidth, inputSize / imgHeight);
            const scaledW = Math.round(imgWidth * scale);
            const scaledH = Math.round(imgHeight * scale);
            const padLeft = Math.floor((inputSize - scaledW) / 2);
            const padTop = Math.floor((inputSize - scaledH) / 2);
            
            this.debugLog(`[MattingService] contain 布局: scale=${scale.toFixed(3)}, scaled=${scaledW}x${scaledH}, pad=(${padLeft},${padTop})`);
            
            const resizedBuffer = await this.sharp(imageBuffer)
                .resize(inputSize, inputSize, {
                    fit: 'contain',             // 保持纵横比，黑色填充
                    background: { r: 0, g: 0, b: 0 },
                    kernel: 'lanczos3'
                })
                .removeAlpha()
                .raw()
                .toBuffer();
            
            // 3. 转换为 Float32 张量 [1, 3, H, W] 并应用 ImageNet 标准化
            const inputTensor = new Float32Array(3 * inputSize * inputSize);
            
            for (let i = 0; i < inputSize * inputSize; i++) {
                const r = resizedBuffer[i * 3] / 255;
                const g = resizedBuffer[i * 3 + 1] / 255;
                const b = resizedBuffer[i * 3 + 2] / 255;
                
                // ImageNet 标准化: (x - mean) / std
                inputTensor[i] = (r - IMAGENET_MEAN[0]) / IMAGENET_STD[0];                                          // R 通道
                inputTensor[inputSize * inputSize + i] = (g - IMAGENET_MEAN[1]) / IMAGENET_STD[1];  // G 通道
                inputTensor[2 * inputSize * inputSize + i] = (b - IMAGENET_MEAN[2]) / IMAGENET_STD[2];  // B 通道
            }
            
            // 4. 创建 ONNX 输入张量
            const inputName = this.birefnetSession.inputNames[0];
            const feeds: Record<string, any> = {};
            feeds[inputName] = new this.ort.Tensor('float32', inputTensor, [1, 3, inputSize, inputSize]);
            
            // 5. 执行推理
            this.debugLog('[MattingService] 执行 BiRefNet 推理...');
            const startTime = Date.now();
            const results = await this.birefnetSession.run(feeds);
            this.debugLog(`[MattingService] 推理完成 (${Date.now() - startTime}ms)`);
            
            // 6. 获取输出（蒙版）
            const outputNames = this.birefnetSession.outputNames;
            this.debugLog('[MattingService] BiRefNet 输出名称:', outputNames);
            
            const outputName = outputNames[0];
            const output = results[outputName];
            const outputData = output.data as Float32Array;
            const outputShape = output.dims;
            
            this.debugLog('[MattingService] BiRefNet 输出形状:', outputShape);
            this.debugLog('[MattingService] BiRefNet 输出数据长度:', outputData.length);
            this.debugLog('[MattingService] 预期像素数:', inputSize * inputSize);
            
            // 7. 后处理：Sigmoid + 缩放到 0-255
            // 处理可能的多通道输出（取第一个通道或平均）
            const numPixels = inputSize * inputSize;
            const numChannels = outputData.length / numPixels;
            this.debugLog('[MattingService] 检测到通道数:', numChannels);
            
            // 诊断：输出原始 logit 值范围（均匀采样）
            {
                const diagStride = Math.max(1, Math.floor(outputData.length / 1000));
                let dMin = Infinity, dMax = -Infinity;
                for (let i = 0; i < outputData.length; i += diagStride) {
                    const v = outputData[i];
                    if (v < dMin) dMin = v;
                    if (v > dMax) dMax = v;
                }
                this.debugLog(`[MattingService] 原始 logit 范围: min=${dMin.toFixed(4)}, max=${dMax.toFixed(4)} (判断: ${dMax > 0 ? '有正值→有前景' : '全负值→可能全黑'})`);
            }
            
            const channelOffset = numChannels === 1 ? 0 : (numChannels - 1) * numPixels;
            if (channelOffset > 0) {
                this.debugLog('[MattingService] 使用最后一个通道，偏移量:', channelOffset);
            }
            const maskData = this.logitsToMask(outputData, channelOffset, numPixels);
            
            // 8. 边缘优化：自适应细化（硬边去残留，软边保细节）
            //
            // matting 档整条跳过。这个整形是为二值蒙版设计的：它按 lowClip/highClip
            // 把弱值压 0、强值提 255，再做硬边增强与收缩——作用在 alpha 上等于
            // 亲手削掉 alpha 最低的发梢，并把半透明过渡带推回两极，
            // 与换 matting 权重的目的完全相反。
            const normalizedEdgeRefineMode = this.birefnetActiveTier === 'matting'
                ? 'none'
                : this.normalizeEdgeRefineMode(edgeRefineMode);
            const refineStats = this.refineMaskEdgesAdaptive(
                maskData,
                inputSize,
                inputSize,
                normalizedEdgeRefineMode
            );
            this.debugLog(`[MattingService] 自适应边缘细化: mode=${refineStats.mode}, touched=${refineStats.touched}`);
            
            // 9. 从 padded 蒙版中提取实际图像区域，然后 resize 到目标尺寸
            // 目标尺寸优先使用 PS 原始图层尺寸（由调用方传入），回退到 imageBuffer 尺寸
            const finalWidth = targetWidth || imgWidth;
            const finalHeight = targetHeight || imgHeight;
            
            const resizeStart = Date.now();
            const resizedMaskBuffer = await this.sharp(Buffer.from(maskData), {
                raw: { width: inputSize, height: inputSize, channels: 1 }
            })
                .extract({ left: padLeft, top: padTop, width: scaledW, height: scaledH })
                // For alpha masks, cubic interpolation is less likely to introduce halo/ringing than lanczos.
                .resize(finalWidth, finalHeight, { kernel: 'cubic' })
                .grayscale()  // 必须保留：Sharp resize 后会扩展为 3 通道，需强制回单通道
                .raw()
                .toBuffer();

            // 直接复用 Sharp 输出的 ArrayBuffer，避免原尺寸蒙版再复制一份。
            const finalMaskData = new Uint8Array(
                resizedMaskBuffer.buffer,
                resizedMaskBuffer.byteOffset,
                resizedMaskBuffer.byteLength
            );
            // hair profile 已在 1024 推理空间完成温和细化。原尺寸再次去灰会截断发丝/织物软 Alpha，
            // 同时需要一份与 30MP 蒙版等大的 source copy，因此软边档直接保留 Sharp cubic 结果。
            const cleanupStats = normalizedEdgeRefineMode === 'hair'
                ? { mode: normalizedEdgeRefineMode, touched: 0 }
                : this.cleanupResizedMaskEdges(
                    finalMaskData,
                    finalWidth,
                    finalHeight,
                    normalizedEdgeRefineMode
                );
            this.debugLog(
                normalizedEdgeRefineMode === 'hair'
                    ? '[MattingService] 原尺寸软 Alpha 保留: mode=hair, skipped-post-resize-cleanup'
                    : `[MattingService] 边缘去灰化: mode=${cleanupStats.mode}, touched=${cleanupStats.touched}`
            );
            const resizedMask = Buffer.from(
                finalMaskData.buffer,
                finalMaskData.byteOffset,
                finalMaskData.byteLength
            );
            
            // 调试日志
            const expectedSize = finalWidth * finalHeight;
            this.debugLog(`[MattingService] 蒙版尺寸调整: ${inputSize}x${inputSize} → extract(${scaledW}x${scaledH}) → ${finalWidth}x${finalHeight} (${Date.now() - resizeStart}ms)`);
            this.debugLog(`[MattingService] 蒙版 Buffer 大小: ${resizedMask.length}, 预期单通道: ${expectedSize}, 通道数: ${(resizedMask.length / expectedSize).toFixed(2)}`);
            
            // 蒙版质量采样验证（均匀采样，避免只采样前 N 行导致漏检下部主体）
            const totalPixels = resizedMask.length;
            const sampleCount = Math.min(totalPixels, 50000);
            const stride = Math.max(1, Math.floor(totalPixels / sampleCount));
            let sMin = 255, sMax = 0, sSum = 0, sBlack = 0, sWhite = 0, sMid = 0;
            let actualSamples = 0;
            for (let i = 0; i < totalPixels; i += stride) {
                const v = resizedMask[i];
                if (v < sMin) sMin = v;
                if (v > sMax) sMax = v;
                sSum += v;
                if (v < 10) sBlack++;
                else if (v > 245) sWhite++;
                else sMid++;
                actualSamples++;
            }
            this.debugLog(`[MattingService] 蒙版均匀采样(${actualSamples}/${totalPixels}, stride=${stride}): min=${sMin}, max=${sMax}, avg=${(sSum / actualSamples).toFixed(1)}`);
            this.debugLog(`[MattingService] 蒙版分布: 黑(${sBlack}), 白(${sWhite}), 中(${sMid})`);
            
            return {
                maskBuffer: resizedMask,
                width: finalWidth,
                height: finalHeight,
                sourceWidth: imgWidth,
                sourceHeight: imgHeight
            };
            
        } catch (e: any) {
            console.error('[MattingService] BiRefNet 推理失败:', e.message);

            // GPU 推理失败通常是显存不够（真机：显存被其它应用占去大半时
            // DmlFusedNode 直接报错）。加载阶段有 dml→cpu 回退，推理阶段一直没有，
            // 失败就静默降级成"只用 SAM"，边缘质量掉一档还看不出原因。
            if (this.activeExecutionProvider !== 'cpu' && !this.cpuRetryInFlight) {
                console.warn('[MattingService] 尝试用 CPU 重跑这次推理');
                this.cpuRetryInFlight = true;
                try {
                    const cpuResult = await this.runBiRefNetInferenceOnCpu(
                        imageBuffer, inputSize, targetWidth, targetHeight, edgeRefineMode
                    );
                    if (cpuResult) console.log('[MattingService] CPU 重跑成功');
                    return cpuResult;
                } finally {
                    this.cpuRetryInFlight = false;
                }
            }
            return null;
        } finally {
            this.inFlightInference--;
            this.scheduleIdleRelease();
        }
    }

    /**
     * 用 CPU 会话重跑一次 BiRefNet。
     *
     * 独立会话、用完即弃：这是显存不足时的应急路径，不该长期占着内存；
     * 也不能改动 GPU 会话的状态，否则下次显存宽裕时又得重新探测。
     */
    private async runBiRefNetInferenceOnCpu(
        imageBuffer: Buffer,
        inputSize: number,
        targetWidth?: number,
        targetHeight?: number,
        edgeRefineMode?: string
    ): Promise<{
        maskBuffer: Buffer;
        width: number;
        height: number;
        sourceWidth: number;
        sourceHeight: number;
    } | null> {
        const resolved = this.resolveBiRefNetModelPath(this.resolveBiRefNetTier(this.config.defaultQuality));
        if (!resolved || !this.ort) return null;

        const gpuSession = this.birefnetSession;
        let cpuSession: any = null;
        try {
            cpuSession = await this.ort.InferenceSession.create(resolved.path, {
                executionProviders: ['cpu'],
                graphOptimizationLevel: 'all',
                logSeverityLevel: 3
            });
            // 临时顶替，让既有推理代码原样复用
            this.birefnetSession = cpuSession;
            return await this.runBiRefNetInference(
                imageBuffer, inputSize, targetWidth, targetHeight, edgeRefineMode
            );
        } catch (e: any) {
            console.error('[MattingService] CPU 重跑也失败:', e?.message);
            return null;
        } finally {
            this.birefnetSession = gpuSession;
            if (cpuSession) void Promise.resolve(cpuSession.release?.()).catch(() => { /* 应急会话，释放失败无碍 */ });
        }
    }

    /**
     * YOLO-World 推理 - 文本定位目标检测
     * 
     * 根据文本描述检测图像中的目标，返回边界框
     * 
     * @param imageBuffer - 输入图像 Buffer (PNG/JPEG)
     * @param textPrompt - 文本描述（如"袜子"、"鞋子"）
     * @returns 检测到的边界框数组
     */
    private resolveYoloTargetClassIndices(textPrompt: string): number[] | null {
        const normalized = textPrompt.trim().toLowerCase();
        if (!normalized) return null;

        const terms = new Set<string>();
        terms.add(normalized);
        terms.add(normalized.replace(/[\s_-]+/g, ' '));
        terms.add(normalized.replace(/[\s_-]+/g, ''));

        for (const token of normalized.split(/[\s,，、/|]+/)) {
            const trimmed = token.trim();
            if (trimmed) {
                terms.add(trimmed);
            }
        }

        const matched = new Set<number>();
        for (let i = 0; i < YOLO_CLASS_NAMES.length; i++) {
            const className = YOLO_CLASS_NAMES[i];
            if (terms.has(className) || normalized.includes(className)) {
                matched.add(i);
                continue;
            }

            const aliases = YOLO_PROMPT_CLASS_ALIASES[className];
            if (!aliases) continue;

            for (const alias of aliases) {
                if (terms.has(alias) || normalized.includes(alias)) {
                    matched.add(i);
                    break;
                }
            }
        }

        return matched.size > 0 ? Array.from(matched).sort((a, b) => a - b) : null;
    }

    private async runYoloWorldInference(
        imageBuffer: Buffer,
        textPrompt: string
    ): Promise<DetectionBox[] | null> {
        if (!this.yoloWorldSession || !this.sharp || !this.ort) {
            console.error('[MattingService] YOLO-World 模型或依赖未加载');
            return null;
        }

        // yolov8s-worldv2 的输入是 ['images', 'txt_feats']：txt_feats 是 CLIP 文本嵌入（512 维），
        // 缺了它 session.run 必然失败。本机没有可用的 CLIP 文本编码器，这条本地开放词汇链路
        // 尚未打通——明确失败并说明原因，不要再让调用方误以为"语义检测已生效"。
        if (this.yoloWorldSession.inputNames?.includes('txt_feats')) {
            console.error(
                '[MattingService] YOLO-World 需要 txt_feats 文本嵌入输入，当前没有可用的 CLIP 文本编码器，'
                + '无法用它做开放词汇检测。语义抠图的文本定位由 GroundingDinoService 承担。'
            );
            return null;
        }

        try {
            // 1. 获取原始图像尺寸
            const metadata = await this.sharp(imageBuffer).metadata();
            const originalWidth = metadata.width!;
            const originalHeight = metadata.height!;
            
            this.debugLog(`[MattingService] YOLO-World 输入: ${originalWidth}x${originalHeight}, 目标: "${textPrompt}"`);
            
            // 2. 预处理：调整尺寸到 640x640
            const resizedBuffer = await this.sharp(imageBuffer)
                .resize(YOLO_INPUT_SIZE, YOLO_INPUT_SIZE, {
                    fit: 'fill',
                    kernel: 'lanczos3'
                })
                .removeAlpha()
                .raw()
                .toBuffer();
            
            // 3. 转换为 Float32 张量 [1, 3, 640, 640]，归一化到 0-1
            const inputTensor = new Float32Array(3 * YOLO_INPUT_SIZE * YOLO_INPUT_SIZE);
            
            for (let i = 0; i < YOLO_INPUT_SIZE * YOLO_INPUT_SIZE; i++) {
                inputTensor[i] = resizedBuffer[i * 3] / 255;                                      // R
                inputTensor[YOLO_INPUT_SIZE * YOLO_INPUT_SIZE + i] = resizedBuffer[i * 3 + 1] / 255;  // G
                inputTensor[2 * YOLO_INPUT_SIZE * YOLO_INPUT_SIZE + i] = resizedBuffer[i * 3 + 2] / 255;  // B
            }
            
            // 4. 准备输入（注意：YOLO-World 可能需要额外的文本嵌入输入）
            const inputNames = this.yoloWorldSession.inputNames;
            this.debugLog('[MattingService] YOLO-World 输入名称:', inputNames);
            
            const feeds: Record<string, any> = {};
            feeds[inputNames[0]] = new this.ort.Tensor('float32', inputTensor, [1, 3, YOLO_INPUT_SIZE, YOLO_INPUT_SIZE]);
            
            // 5. 执行推理
            this.debugLog('[MattingService] 执行 YOLO-World 推理...');
            const startTime = Date.now();
            const results = await this.yoloWorldSession.run(feeds);
            this.debugLog(`[MattingService] YOLO-World 推理完成 (${Date.now() - startTime}ms)`);
            
            // 6. 解析输出
            const outputNames = this.yoloWorldSession.outputNames;
            this.debugLog('[MattingService] YOLO-World 输出名称:', outputNames);
            
            const output = results[outputNames[0]];
            const outputData = output.data as Float32Array;
            const outputShape = output.dims;
            
            this.debugLog('[MattingService] YOLO-World 输出形状:', outputShape);
            
            // 7. 后处理：解析检测框
            // YOLO 输出格式通常是 [1, num_boxes, 4+num_classes] 或 [1, 4+num_classes, num_boxes]
            const detections: DetectionBox[] = [];
            
            // 计算缩放因子
            const scaleX = originalWidth / YOLO_INPUT_SIZE;
            const scaleY = originalHeight / YOLO_INPUT_SIZE;
            const targetClassIndices = this.resolveYoloTargetClassIndices(textPrompt);
            if (!targetClassIndices || targetClassIndices.length === 0) {
                console.warn(`[MattingService] YOLO semantic prompt is not supported by current fixed-vocabulary model: "${textPrompt}"`);
                return null;
            }
            const targetClassNames = targetClassIndices.map(index => YOLO_CLASS_NAMES[index]);
            this.debugLog(`[MattingService] YOLO target classes: ${targetClassNames.join(", ")}`);
            // 简化处理：取置信度最高的检测框
            // 实际 YOLO-World 输出格式可能需要根据具体模型调整
            let globalMaxConf = 0;
            let totalBoxesChecked = 0;
            
            if (outputShape.length === 3) {
                const numBoxes = outputShape[2];
                const numFeatures = outputShape[1];
                
            this.debugLog(`[MattingService] YOLO-World 解析输出: numBoxes=${numBoxes}, numFeatures=${numFeatures}`);
                
                for (let i = 0; i < numBoxes; i++) {
                    // 假设格式为 [1, 4+num_classes, num_boxes]
                    // 前4个是 cx, cy, w, h
                    const cx = outputData[0 * numBoxes + i];
                    const cy = outputData[1 * numBoxes + i];
                    const w = outputData[2 * numBoxes + i];
                    const h = outputData[3 * numBoxes + i];
                    
                    // 类别置信度（从第5个开始）
                    let maxConf = 0;
                    for (let c = 4; c < numFeatures; c++) {
                        const conf = outputData[c * numBoxes + i];
                        if (conf > maxConf) maxConf = conf;
                    }
                    
                    totalBoxesChecked++;
                    if (maxConf > globalMaxConf) globalMaxConf = maxConf;
                    
                    if (maxConf > YOLO_CONF_THRESHOLD) {
                        // 转换为 x1, y1, x2, y2 并缩放回原始尺寸
                        const x1 = Math.max(0, (cx - w / 2) * scaleX);
                        const y1 = Math.max(0, (cy - h / 2) * scaleY);
                        const x2 = Math.min(originalWidth, (cx + w / 2) * scaleX);
                        const y2 = Math.min(originalHeight, (cy + h / 2) * scaleY);
                        
                    this.debugLog(`[MattingService] YOLO-World 发现目标: conf=${maxConf.toFixed(3)}, box=(${x1.toFixed(0)},${y1.toFixed(0)})-(${x2.toFixed(0)},${y2.toFixed(0)})`);
                        
                        detections.push({
                            x1: Math.round(x1),
                            y1: Math.round(y1),
                            x2: Math.round(x2),
                            y2: Math.round(y2),
                            confidence: maxConf,
                            label: textPrompt
                        });
                    }
                }
            }
            
            this.debugLog(`[MattingService] YOLO-World 检测统计: 检查了 ${totalBoxesChecked} 个框, 最高置信度=${globalMaxConf.toFixed(3)}, 阈值=${YOLO_CONF_THRESHOLD}`);
            if (detections.length === 0 && globalMaxConf > 0) {
                this.debugLog(`[MattingService] ⚠️ 最高置信度 ${globalMaxConf.toFixed(3)} < 阈值 ${YOLO_CONF_THRESHOLD}，建议降低阈值`);
            }
            
            // 8. NMS（非极大值抑制）
            const finalDetections = this.applyNMS(detections, YOLO_IOU_THRESHOLD);
            
            this.debugLog(`[MattingService] YOLO-World 检测到 ${finalDetections.length} 个目标`);
            return finalDetections;
            
        } catch (e: any) {
            console.error('[MattingService] YOLO-World 推理失败:', e.message);
            return null;
        }
    }

    /**
     * 公开的 YOLO-World 目标检测接口
     * @param imageBase64 - 输入图像的 Base64 数据
     * @param textPrompt - 文本描述（如"袜子"、"鞋子"）
     * @returns 检测到的边界框数组，或 null 如果失败
     */
    async detectWithYoloWorld(
        imageBase64: string,
        textPrompt: string
    ): Promise<DetectionBox[] | null> {
        // 确保模型已加载
        if (!this.yoloWorldSession) {
            const loaded = await this.loadYoloWorldModel();
            if (!loaded) {
                console.error('[MattingService] YOLO-World 模型未加载');
                return null;
            }
        }
        
        // 解析 base64 数据
        let imageBuffer: Buffer;
        try {
            let base64Data = imageBase64;
            if (base64Data.includes(',')) {
                base64Data = base64Data.split(',')[1];
            }
            imageBuffer = Buffer.from(base64Data, 'base64');
        } catch (e: any) {
            console.error('[MattingService] 图像解析失败:', e.message);
            return null;
        }
        
        return this.runYoloWorldInference(imageBuffer, textPrompt);
    }

    /**
     * 非极大值抑制（NMS）
     */
    private applyNMS(boxes: DetectionBox[], iouThreshold: number): DetectionBox[] {
        if (boxes.length === 0) return [];
        
        // 按置信度降序排序
        boxes.sort((a, b) => b.confidence - a.confidence);
        
        const selected: DetectionBox[] = [];
        const used = new Set<number>();
        
        for (let i = 0; i < boxes.length; i++) {
            if (used.has(i)) continue;
            
            selected.push(boxes[i]);
            
            for (let j = i + 1; j < boxes.length; j++) {
                if (used.has(j)) continue;
                
                const iou = this.calculateIoU(boxes[i], boxes[j]);
                if (iou > iouThreshold) {
                    used.add(j);
                }
            }
        }
        
        return selected;
    }

    /**
     * 计算两个边界框的 IoU
     */
    private calculateIoU(a: DetectionBox, b: DetectionBox): number {
        const x1 = Math.max(a.x1, b.x1);
        const y1 = Math.max(a.y1, b.y1);
        const x2 = Math.min(a.x2, b.x2);
        const y2 = Math.min(a.y2, b.y2);
        
        const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
        const areaA = (a.x2 - a.x1) * (a.y2 - a.y1);
        const areaB = (b.x2 - b.x1) * (b.y2 - b.y1);
        const union = areaA + areaB - intersection;
        
        return union > 0 ? intersection / union : 0;
    }

    /**
     * 把图层图像输入解码成 Buffer 并读出真实像素尺寸。
     *
     * 语义定位需要与分割完全同一个坐标系：导出图像可能已被 maxSize 缩放，
     * 与 PS 图层原始尺寸不同，定位框必须按解码后的实际尺寸换算。
     */
    async decodeImageInput(
        imageInput: string | BinaryImageData
    ): Promise<{ buffer: Buffer; width: number; height: number } | null> {
        if (!(await this.ensureInitialized())) return null;

        const decoded = await this.resolveImageBuffer(imageInput);
        if (!decoded.buffer) {
            console.error(`[MattingService] 图像解码失败: ${decoded.error}`);
            return null;
        }

        const metadata = await this.sharp!(decoded.buffer).metadata().catch((e: any) => {
            console.error(`[MattingService] 读取图像尺寸失败: ${e.message}`);
            return null;
        });

        if (!metadata?.width || !metadata?.height) return null;

        return { buffer: decoded.buffer, width: metadata.width, height: metadata.height };
    }

    /**
     * 真正释放 BiRefNet 会话。
     *
     * 只把引用置 null 不会归还显存——ONNX 的 GPU 内存要等 GC，而 GC 不保证时机。
     * 必须显式调用 session.release()。
     */
    private releaseBiRefNetSessions(): void {
        const sessions = [
            this.birefnetSessionByTier.matting,
            this.birefnetSessionByTier.full,
            this.birefnetSessionByTier.lite
        ].filter(Boolean);

        this.birefnetSession = null;
        this.birefnetSessionByTier = { matting: null, full: null, lite: null };
        this.birefnetActiveTier = null;

        for (const session of sessions) {
            void Promise.resolve(session.release?.()).catch(() => { /* 释放失败不影响重建 */ });
        }
    }

    /** 推理结束后开始倒数，超时把显存还给系统 */
    private scheduleIdleRelease(): void {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
        if (BIREFNET_IDLE_RELEASE_MS <= 0 || this.inFlightInference > 0 || !this.birefnetSession) return;

        this.idleTimer = setTimeout(() => {
            if (this.inFlightInference > 0) {
                this.scheduleIdleRelease();
                return;
            }
            console.log(
                `[MattingService] 空闲 ${Math.round(BIREFNET_IDLE_RELEASE_MS / 1000)}s，释放 BiRefNet 会话以归还显存`
            );
            this.releaseBiRefNetSessions();
        }, BIREFNET_IDLE_RELEASE_MS);
        this.idleTimer.unref?.();
    }

    /**
     * 注入框内分割器（SAM）。未注入时 segmentWithinBoxes 走裁剪 + BiRefNet 降级路径。
     */
    setBoxSegmenter(segmenter: BoxSegmenter | null): void {
        this.boxSegmenter = segmenter;
        console.log(
            `[MattingService] 框内分割器${segmenter ? '已注入' : '已清除'}`
            + (segmenter ? `（就绪=${segmenter.isReady()}）` : '')
        );
    }

    /**
     * 把外部输入（二进制 / Base64 / RAW:）统一解码成图像 Buffer。
     * removeBackground 与 segmentWithinBoxes 共用，避免两条链路各写一份解码分支。
     */
    private async resolveImageBuffer(
        imageInput: string | BinaryImageData
    ): Promise<{ buffer: Buffer | null; error?: string }> {
        try {
            if (isBinaryImageData(imageInput)) {
                const binaryData = imageInput;

                if (binaryData.format === 'raw_rgb' || binaryData.format === 'raw_rgba') {
                    // RAW 格式需要转换为 PNG
                    const channels = binaryData.channels || (binaryData.format === 'raw_rgba' ? 4 : 3);
                    const converted = await this.sharp!(binaryData.buffer, {
                        raw: { width: binaryData.width, height: binaryData.height, channels }
                    }).png().toBuffer();
                    this.debugLog(`[MattingService] 二进制输入: ${binaryData.format} ${binaryData.width}x${binaryData.height}`);
                    return { buffer: converted };
                }

                this.debugLog(`[MattingService] 二进制输入: ${binaryData.format} ${binaryData.width}x${binaryData.height}`);
                return { buffer: binaryData.buffer };
            }

            // Base64 字符串
            let base64Data = imageInput;

            // 处理 RAW 格式
            if (base64Data.startsWith('RAW:')) {
                const parts = base64Data.split(':');
                const width = parseInt(parts[1]);
                const height = parseInt(parts[2]);
                let channels: 3 | 4 = 4;
                let rawBase64: string;

                if (parts[3] === '3' || parts[3] === '4') {
                    channels = parseInt(parts[3]) as 3 | 4;
                    rawBase64 = parts.slice(4).join(':');
                } else {
                    rawBase64 = parts.slice(3).join(':');
                }

                const converted = await this.sharp!(Buffer.from(rawBase64, 'base64'), {
                    raw: { width, height, channels }
                }).png().toBuffer();
                return { buffer: converted };
            }

            if (base64Data.includes(',')) {
                base64Data = base64Data.split(',')[1];
            }
            return { buffer: Buffer.from(base64Data, 'base64') };
        } catch (e: any) {
            return { buffer: null, error: e.message };
        }
    }

    // ==================== 公共 API ====================

    /**
     * 执行智能分割
     * 
     * 支持两种模式：
     * 1. 语义分割（无 targetPrompt）：识别图像中的所有主体
     * 2. 文本定位分割（有 targetPrompt）：根据文本描述定位并分割目标
     * 
     * 完整流程：文本定位(YOLO-World) → 目标检测 → 精确分割(BiRefNet) → 边缘细化
     * 
     * @param imageInput - 图像数据（BinaryImageData 或 Base64 字符串）
     * @param options - 分割选项
     */
    async removeBackground(
        imageInput: string | BinaryImageData,
        options?: {
            quality?: QualityLevel | number;
            returnMask?: boolean;
            binaryMaskOutput?: boolean;
            targetPrompt?: string;
            /** 语义定位得到的目标框（图像像素坐标）；给出后蒙版会被限制在这些区域内 */
            detectedBoxes?: DetectionBox[];
            originalWidth?: number;
            originalHeight?: number;
            edgeRefine?: string;
            model?: string;
            selectionBox?: { x1: number; y1: number; x2: number; y2: number };
            selectionBoxSpaceWidth?: number;
            selectionBoxSpaceHeight?: number;
            onProgress?: (progress: number, stage: string, message: string, extra?: { edgeType?: string; usedModels?: string[] }) => void;
        }
    ): Promise<MattingResult> {
        const startTime = Date.now();
        const sendProgress = options?.onProgress || ((_p: number, _s: string, _m: string) => {});
        const targetPrompt = options?.targetPrompt?.trim();
        const useTextDetection = targetPrompt && targetPrompt.length > 0;

        const normalizedQuality = this.normalizeQualityLevel(options?.quality);
        const birefnetInputSize = this.resolveBiRefNetInputSize(normalizedQuality);

        sendProgress(
            5,
            'init',
            useTextDetection
                ? `初始化文本定位分割（${normalizedQuality}/${birefnetInputSize}px）...`
                : `初始化智能分割（${normalizedQuality}/${birefnetInputSize}px）...`
        );

        // 1. 确保 BiRefNet 模型已加载（必需）；按质量档位选择 full/lite 模型，
        //    失败时按真实原因分层报错，不一律说"模型未安装"
        const requestedTier = this.resolveBiRefNetTier(normalizedQuality);
        const birefnetLoaded = await this.loadBiRefNetModel(requestedTier);
        if (!birefnetLoaded) {
            const reason = this.lastBiRefNetLoadError;
            let error: string;
            if (reason?.kind === 'model-missing') {
                error = '分割模型未安装。\n\n请在设置 → 图像处理中下载 BiRefNet 模型。';
            } else if (reason?.kind === 'dependency') {
                error = `推理引擎初始化失败：${reason.detail}\n\n常见原因：系统 VC++ 运行库损坏或缺失。修复方式：安装/修复 Microsoft Visual C++ 2015-2022 (x64) 运行库后重启应用。`;
            } else {
                error = `分割模型加载失败：${reason?.detail || '未知原因'}\n\n模型文件可能损坏，可在设置 → 图像处理中重新下载 BiRefNet；若反复失败，请在设置中切换 GPU/CPU 模式后重试。`;
            }
            return {
                success: false,
                error,
                processingTime: Date.now() - startTime,
                usedModel: 'birefnet'
            };
        }

        sendProgress(10, 'preprocess', '预处理图像...');

        // 2. 处理输入格式
        const decoded = await this.resolveImageBuffer(imageInput);
        if (!decoded.buffer) {
            return {
                success: false,
                error: `图像预处理失败: ${decoded.error}`,
                processingTime: Date.now() - startTime
            };
        }
        const imageBuffer = decoded.buffer;

        // 3. 目标框由调用方给出（语义定位在 GroundingDinoService 完成）。
        //    这里不再自行做文本检测：本机 yolov8s-worldv2 需要 txt_feats 文本嵌入输入，
        //    旧实现只喂了 images，每次推理都失败并被静默吞掉，把"语义抠图"退化成全图分割。
        const detectedBoxes: DetectionBox[] = Array.isArray(options?.detectedBoxes)
            ? options!.detectedBoxes!
            : [];
        const usedModels: string[] = [];

        if (useTextDetection && detectedBoxes.length === 0) {
            this.debugLog(`[MattingService] 收到目标描述"${targetPrompt}"但未附带目标框，按全图分割处理`);
        }

        sendProgress(50, 'segmentation', 'BiRefNet 精确分割...');

        // 4. 执行 BiRefNet 推理（传递 PS 原始尺寸，由 Agent 侧 Sharp 直接 resize 到目标）
        const inferenceResult = await this.runBiRefNetInference(
            imageBuffer,
            birefnetInputSize,
            options?.originalWidth,
            options?.originalHeight,
            options?.edgeRefine
        );
        usedModels.push(`birefnet-${this.birefnetActiveTier || 'full'}`);
        
        if (!inferenceResult) {
            return {
                success: false,
                error: '智能分割推理失败',
                processingTime: Date.now() - startTime,
                usedModel: usedModels.join('+')
            };
        }

        sendProgress(75, 'refine', '边缘细化处理...');

        // 5. 如果有检测框，将蒙版限制在检测区域内
        let finalMaskBuffer = inferenceResult.maskBuffer;
        
        if (detectedBoxes.length > 0) {
            const projectedDetectionBoxes = detectedBoxes
                .map((box) => this.projectBoxToMaskSpace(
                    box,
                    inferenceResult.sourceWidth,
                    inferenceResult.sourceHeight,
                    inferenceResult.width,
                    inferenceResult.height
                ))
                .filter((box): box is { x1: number; y1: number; x2: number; y2: number } => box !== null);
            finalMaskBuffer = this.constrainMaskToBoxes(
                finalMaskBuffer,
                inferenceResult.width,
                inferenceResult.height,
                projectedDetectionBoxes,
                0.05,
                10,
                32
            );
            this.debugLog(`[MattingService] 蒙版已限制在 ${projectedDetectionBoxes.length} 个检测区域内`);
        }

        if (options?.selectionBox) {
            const projectedSelectionBox = this.projectBoxToMaskSpace(
                options.selectionBox,
                options.selectionBoxSpaceWidth || inferenceResult.width,
                options.selectionBoxSpaceHeight || inferenceResult.height,
                inferenceResult.width,
                inferenceResult.height
            );

            if (projectedSelectionBox) {
                finalMaskBuffer = this.constrainMaskToBoxes(
                    finalMaskBuffer,
                    inferenceResult.width,
                    inferenceResult.height,
                    [projectedSelectionBox],
                    0.02,
                    4,
                    12
                );
                this.debugLog('[MattingService] 蒙版已限制在用户选区范围内');
            }
        }

        sendProgress(90, 'postprocess', '生成分割结果...');

        // 6. 构建蒙版返回结构
        const maskWidth = inferenceResult.width;
        const maskHeight = inferenceResult.height;
        const shouldReturnBinaryMask = options?.returnMask === true && options?.binaryMaskOutput === true;
        const maskBase64 = shouldReturnBinaryMask
            ? undefined
            : `RAW_MASK:${maskWidth}:${maskHeight}:${finalMaskBuffer.toString('base64')}`;

        // 7. 生成抠图后的图像（可选）
            let mattedImage: string | undefined;
        
        if (options?.returnMask !== true) {
            try {
                // 应用蒙版生成透明图像
                const metadata = await this.sharp!(imageBuffer).metadata();
                const rgbaBuffer = await this.sharp!(imageBuffer).ensureAlpha().raw().toBuffer();
                
                const width = metadata.width!;
                const height = metadata.height!;
                const resultBuffer = Buffer.alloc(width * height * 4);
                
                for (let i = 0; i < width * height; i++) {
                    resultBuffer[i * 4] = rgbaBuffer[i * 4];         // R
                    resultBuffer[i * 4 + 1] = rgbaBuffer[i * 4 + 1]; // G
                    resultBuffer[i * 4 + 2] = rgbaBuffer[i * 4 + 2]; // B
                    resultBuffer[i * 4 + 3] = finalMaskBuffer[i];    // A (使用处理后的蒙版)
                }
                
                const pngBuffer = await this.sharp!(resultBuffer, {
                    raw: { width, height, channels: 4 }
                }).png().toBuffer();
                
                mattedImage = pngBuffer.toString('base64');
            } catch (e: any) {
                console.warn('[MattingService] 生成抠图图像失败:', e.message);
            }
        }

        sendProgress(100, 'complete', '智能分割完成');

        // 构建分析信息
        const analysisInfo = useTextDetection && detectedBoxes.length > 0
            ? `文本定位: "${targetPrompt}" → 检测到 ${detectedBoxes.length} 个目标 → BiRefNet 精确分割`
            : 'BiRefNet 全图分割 + 边缘细化';
            
            return {
                success: true,
                maskImage: maskBase64,
                mask: maskBase64,  // 兼容旧接口
                maskBuffer: shouldReturnBinaryMask ? finalMaskBuffer : undefined,
                maskWidth,
                maskHeight,
                mattedImage,
                processingTime: Date.now() - startTime,
            usedModel: usedModels.join('+'),
            analysis: analysisInfo,
            pipeline: { mode: 'onnx' }
        };
    }

    /**
     * 显著性定位：找出画面里的主体，返回各自的边界框。
     *
     * 这是"没填抠取目标"时的定位段，与语义抠图的 GroundingDINO 定位并列——
     * 两者出的都是框，之后共用同一个高分辨率精分段，所以边缘质量一致。
     *
     * 全程本地推理，不依赖 Photoshop 自带的选择主体。
     */
    async detectSubjectRegions(
        imageInput: string | BinaryImageData,
        options?: {
            quality?: QualityLevel | number;
            edgeRefine?: string;
            regionOptions?: MaskRegionOptions;
            onProgress?: (progress: number, stage: string, message: string) => void;
        }
    ): Promise<{
        success: boolean;
        regions: MaskRegion[];
        /** 定位所用的图像尺寸，调用方据此换算坐标 */
        width?: number;
        height?: number;
        error?: string;
    }> {
        const sendProgress = options?.onProgress || ((_p: number, _s: string, _m: string) => {});

        if (!(await this.ensureInitialized())) {
            return {
                success: false,
                regions: [],
                error: `推理依赖加载失败：${this.lastDependencyError || '未知原因'}`
            };
        }

        const normalizedQuality = this.normalizeQualityLevel(options?.quality);
        if (!(await this.loadBiRefNetModel(this.resolveBiRefNetTier(normalizedQuality)))) {
            return {
                success: false,
                regions: [],
                error: `分割模型不可用：${this.lastBiRefNetLoadError?.detail || '模型未安装'}`
            };
        }

        const decoded = await this.decodeImageInput(imageInput);
        if (!decoded) {
            return { success: false, regions: [], error: '无法解码图层图像' };
        }

        sendProgress(25, 'detection', '正在识别画面主体...');

        const inference = await this.runBiRefNetInference(
            decoded.buffer,
            this.resolveBiRefNetInputSize(normalizedQuality),
            decoded.width,
            decoded.height,
            options?.edgeRefine
        );

        if (!inference) {
            return { success: false, regions: [], error: '分割模型推理失败，无法定位主体' };
        }

        const regions = extractMaskRegions(
            inference.maskBuffer,
            inference.width,
            inference.height,
            options?.regionOptions || DEFAULT_MASK_REGION_OPTIONS
        );

        this.debugLog(
            `[MattingService] 显著性定位：${inference.width}x${inference.height} → ${regions.length} 个主体`
        );

        return {
            success: true,
            regions,
            width: inference.width,
            height: inference.height
        };
    }

    /**
     * 在高分辨率局部图上分割，再贴回全图坐标（语义抠图的精细分割段）
     *
     * 为什么必须这样做：整图导出会被压到 1024 长边，5322x7982 的图层压完只剩 683x1024，
     * 目标（一只袜子）在里面只有 141x236 像素。SAM 内部输出 256x256 网格覆盖整张图，
     * 落到目标上仅约 53x59 格，蒙版再放大 7.8 倍——边缘精度从源头就没了。
     * 按目标框单独取像后，同样的 256 网格只覆盖目标本身，有效精度提高数倍。
     *
     * @param regions 每块含：局部图、该局部在输出坐标系中的位置、目标框在局部图内的坐标
     */
    async segmentHighResRegions(
        regions: Array<{
            imageInput: string | BinaryImageData;
            /** 这块局部图对应输出蒙版的哪个矩形 */
            regionInOutput: { x1: number; y1: number; x2: number; y2: number };
            /**
             * 落在这张局部图里的目标框（局部图像素坐标）。
             * 相邻目标要放进同一张局部图：细节蒙版只算一次，交界处才不会出现拼接缝
             * （真机：鞋与袜各自取像分割再合并，交界带 3.6% 的像素上下是前景、自己是空的）。
             */
            boxesInRegion: Array<{ x1: number; y1: number; x2: number; y2: number }>;
            /** 与 boxesInRegion 一一对应；点坐标属于当前局部图，内容只能由调用方显式提供。 */
            guidancePointsByBox?: BoxSegmenterPointPrompt[][];
        }>,
        options: {
            outputWidth: number;
            outputHeight: number;
            quality?: QualityLevel | number;
            edgeRefine?: string;
            binaryMaskOutput?: boolean;
            /** 语义写路径必须要求逐目标范围 Provider 证明，不能用显著性连通域猜归属。 */
            requireVerifiedSemanticScope?: boolean;
            onProgress?: (progress: number, stage: string, message: string) => void;
        }
    ): Promise<MattingResult & { clippedRegionIndexes?: number[] }> {
        const startTime = Date.now();
        const sendProgress = options.onProgress || ((_p: number, _s: string, _m: string) => {});

        if (!regions || regions.length === 0) {
            return { success: false, error: '未提供高分辨率区域', processingTime: Date.now() - startTime };
        }

        if (!(await this.ensureInitialized())) {
            return {
                success: false,
                error: `推理依赖加载失败：${this.lastDependencyError || '未知原因'}`,
                processingTime: Date.now() - startTime
            };
        }

        const outputWidth = Math.round(options.outputWidth);
        const outputHeight = Math.round(options.outputHeight);
        if (outputWidth <= 0 || outputHeight <= 0) {
            return {
                success: false,
                error: `输出尺寸无效（${outputWidth}x${outputHeight}）`,
                processingTime: Date.now() - startTime
            };
        }

        const normalizedQuality = this.normalizeQualityLevel(options.quality);
        const fullMask = Buffer.alloc(outputWidth * outputHeight, 0);
        const usedModels: string[] = [];
        const failures: string[] = [];
        const warnings: string[] = [];
        const requestedTargetCount = regions.reduce(
            (sum, region) => sum + (Array.isArray(region.boxesInRegion) ? region.boxesInRegion.length : 0),
            0
        );
        let segmentedCount = 0;
        let segmentedTargetCount = 0;
        let scopeVerifiedTargetCount = 0;
        const failedRegionIndexes: number[] = [];
        const clippedRegionIndexes: number[] = [];
        let birefnetReady = false;

        const markRegionFailed = (index: number): void => {
            if (!failedRegionIndexes.includes(index)) failedRegionIndexes.push(index);
        };
        const buildTargetCompleteness = () => ({
            schema: 'semantic-matting-target-completeness/v1' as const,
            requestedRegionCount: regions.length,
            requestedTargetCount,
            segmentedRegionCount: segmentedCount,
            segmentedTargetCount,
            scopeVerificationRequired: options.requireVerifiedSemanticScope === true,
            scopeVerifiedTargetCount,
            scopeVerificationComplete: options.requireVerifiedSemanticScope !== true
                || scopeVerifiedTargetCount === requestedTargetCount,
            failedRegionIndexes: [...failedRegionIndexes],
            complete: segmentedCount === regions.length
                && segmentedTargetCount === requestedTargetCount
                && (options.requireVerifiedSemanticScope !== true
                    || scopeVerifiedTargetCount === requestedTargetCount)
                && failedRegionIndexes.length === 0
        });

        for (let i = 0; i < regions.length; i++) {
            const region = regions[i];
            const label = `目标 ${i + 1}/${regions.length}`;
            sendProgress(
                60 + Math.round((i / regions.length) * 30),
                'segmentation',
                `正在精细分割${label}...`
            );

            const decoded = await this.decodeImageInput(region.imageInput);
            if (!decoded) {
                failures.push(`${label} 局部图解码失败`);
                markRegionFailed(i);
                continue;
            }

            const boxes = (region.boxesInRegion || [])
                .map(raw => ({
                    x1: Math.max(0, Math.min(decoded.width - 1, Math.round(raw.x1))),
                    y1: Math.max(0, Math.min(decoded.height - 1, Math.round(raw.y1))),
                    x2: Math.max(1, Math.min(decoded.width, Math.round(raw.x2))),
                    y2: Math.max(1, Math.min(decoded.height, Math.round(raw.y2)))
                }))
                .filter(b => b.x2 - b.x1 >= 2 && b.y2 - b.y1 >= 2);

            if (boxes.length === 0) {
                failures.push(`${label} 目标框在局部图中无有效面积`);
                markRegionFailed(i);
                continue;
            }
            if (boxes.length !== (region.boxesInRegion || []).length) {
                failures.push(`${label} 有目标框在局部图中无有效面积`);
                markRegionFailed(i);
                continue;
            }
            const guidancePointsByBox = region.guidancePointsByBox || [];
            if (guidancePointsByBox.length > 0 && guidancePointsByBox.length !== boxes.length) {
                failures.push(`${label} 的语义引导与目标框数量不一致`);
                markRegionFailed(i);
                continue;
            }
            const normalizedGuidancePoints = boxes.map((_box, boxIndex) => {
                const rawPoints = guidancePointsByBox[boxIndex] || [];
                return rawPoints.filter(point => Number.isFinite(point.x)
                    && Number.isFinite(point.y)
                    && (point.label === 0 || point.label === 1));
            });
            if (normalizedGuidancePoints.some((points, boxIndex) => (
                points.length !== (guidancePointsByBox[boxIndex] || []).length
            ))) {
                failures.push(`${label} 含有无效的语义引导点`);
                markRegionFailed(i);
                continue;
            }
            // 局部蒙版：SAM 定范围 + BiRefNet 定边缘，两者结合。
            //
            // 单用任一个都不行，真机 2026-08-27 两头都撞过：
            // · 只用 BiRefNet：它是显著性分割，局部图里有腿有鞋时会把整个主体一起分出来，
            //   而腿/袜/鞋在蒙版上是一个连通域，按连通性也挑不开；
            // · 只用 SAM：能按框选对物体，但 mask decoder 固定 256x256 网格，
            //   放大后边缘圆润，细节（荷叶边、织物纹理）丢失。
            //
            // 所以让它们各做各擅长的：SAM 圈定"哪一块是目标"，BiRefNet 提供该块的精细边缘。
            let regionMask: Buffer | null = null;

            if (!birefnetReady) {
                birefnetReady = await this.loadBiRefNetModel(this.resolveBiRefNetTier(normalizedQuality));
            }

            let detailMask: Buffer | null = null;
            if (birefnetReady) {
                const cropped = await this.segmentBoxWithBiRefNet(
                    decoded.buffer,
                    { x1: 0, y1: 0, x2: decoded.width, y2: decoded.height },
                    decoded.width,
                    decoded.height,
                    this.resolveBiRefNetInputSize(normalizedQuality),
                    options.edgeRefine
                );
                if (cropped) {
                    const placed = Buffer.alloc(decoded.width * decoded.height, 0);
                    this.blendMaskRegion(
                        placed, decoded.width, decoded.height,
                        cropped.maskBuffer, cropped.width, cropped.height,
                        cropped.offsetX, cropped.offsetY,
                        { x1: 0, y1: 0, x2: decoded.width, y2: decoded.height }
                    );
                    detailMask = placed;
                    const tier = `birefnet-${this.birefnetActiveTier || 'full'}`;
                    if (!usedModels.includes(tier)) usedModels.push(tier);

                    // 引导精修：蒙版是在 1024 上算完再插值放大的，比放大倍数更细的
                    // 结构（绒毛、织物凸起）在这一步之前根本不存在。用局部图当引导
                    // 把边缘吸附回真实位置，才能把这些结构找回来。
                    // 只对 matting 档开启——分割档的边界本就是二值的，精修收益有限，
                    // 而改动已验证过的路径有回归风险。
                    if (this.birefnetActiveTier === 'matting') {
                        const refined = await this.refineDetailWithGuide(
                            detailMask, decoded.buffer, decoded.width, decoded.height, label
                        );
                        if (refined.mask) {
                            detailMask = refined.mask;
                            if (!usedModels.includes('guided-filter')) usedModels.push('guided-filter');
                        } else {
                            warnings.push(`${label} 引导精修未执行：${refined.reason || '原因未知'}`);
                        }
                    }
                }
            }

            // 每个目标各求一次范围再并起来：同一张局部图上的多个目标共用 detail，
            // 但各自的归属由各自的框决定
            let scopeMask: Buffer | null = null;
            const scopeProvider = this.boxSegmenter?.isReady() === true
                ? this.boxSegmenter
                : null;
            const scopeProviderReady = scopeProvider !== null;
            let scopedTargetCount = 0;
            if (scopeProvider) {
                for (let targetIndex = 0; targetIndex < boxes.length; targetIndex++) {
                    const target = boxes[targetIndex];
                    const guidancePoints = normalizedGuidancePoints[targetIndex];
                    const samResult = await scopeProvider.segmentWithBox(
                        decoded.buffer,
                        target,
                        guidancePoints.length > 0 ? guidancePoints : undefined
                    );
                    if (!samResult.success || !samResult.mask) {
                        failures.push(`${label} SAM 圈定范围失败：${samResult.error || '未返回蒙版'}`);
                        continue;
                    }
                    if (samResult.mask.length !== decoded.width * decoded.height) {
                        failures.push(
                            `${label} SAM 蒙版尺寸不符：期望 ${decoded.width * decoded.height}，实际 ${samResult.mask.length}`
                        );
                        continue;
                    }
                    const targetScopeCoverage = measureMaskTargetCoverage(
                        samResult.mask,
                        decoded.width,
                        decoded.height,
                        [target],
                        BOX_SEGMENT_FOREGROUND_THRESHOLD
                    );
                    if (targetScopeCoverage.coveredCount !== 1) {
                        failures.push(`${label} SAM 没有在当前目标框内产生前景`);
                        continue;
                    }
                    if (!scopeMask) {
                        scopeMask = Buffer.from(samResult.mask);
                    } else {
                        for (let p = 0; p < scopeMask.length; p++) {
                            if (samResult.mask[p] > scopeMask[p]) scopeMask[p] = samResult.mask[p];
                        }
                    }
                    scopedTargetCount++;
                    scopeVerifiedTargetCount++;
                    if (!usedModels.includes('mobile-sam')) usedModels.push('mobile-sam');
                }
            }

            // 每个 SAM 调用只能证明自己对应的目标。不能先把成功蒙版 union，随后再用
            // “每个框里碰巧有一点前景”把另一个失败目标补算成成功；相邻目标时该漏洞
            // 会把一份不完整蒙版写进 Photoshop。Provider 已就绪却少任一目标时整区域失败。
            if (scopeProviderReady && scopedTargetCount !== boxes.length) {
                markRegionFailed(i);
                continue;
            }

            // 无 SAM 时，单目标还可用 BiRefNet 连通域作可见降级；多个语义目标共用一张
            // 显著性蒙版则无法证明逐目标归属，必须由上层拆成单框区域或显式失败。
            if (!scopeProviderReady && (options.requireVerifiedSemanticScope === true || boxes.length > 1)) {
                failures.push(
                    `${label} 缺少逐目标范围分割能力，无法验证 ${boxes.length} 个语义目标都已处理`
                );
                markRegionFailed(i);
                continue;
            }

            // 多个目标并起来的范围之间会留窄缝，先合上再与细节相交
            if (scopeMask && boxes.length > 1) {
                scopeMask = this.closeScopeGaps(scopeMask, decoded.width, decoded.height, SCOPE_GAP_CLOSE_PIXELS);
            }

            if (detailMask && scopeMask) {
                // SAM 范围外扩几像素再取交集：它的边界本身就糙，不外扩会削掉
                // BiRefNet 好不容易保住的边缘细节
                const activeVariant = this.birefnetActiveTier || 'lite';
                regionMask = this.intersectWithScope(
                    detailMask, scopeMask, decoded.width, decoded.height,
                    resolveSemanticScopeRefinementRadius(decoded.width, decoded.height),
                    activeVariant === 'matting' ? 'transition-only' : 'solid'
                );
            } else if (detailMask) {
                regionMask = detailMask;
            } else if (scopeMask) {
                regionMask = scopeMask;
            }

            if (!regionMask) {
                failures.push(`${label} 两种分割方式都没能产出蒙版`);
                markRegionFailed(i);
                continue;
            }

            // 不论走融合还是降级路径，最终都按 Agent 选定的目标框做一次组件归属。
            // 这只移除与所有目标框都无归属关系的孤立碎片；每个目标各自保留重叠最多
            // 的主体组件，不能用“全图最大组件”把第二个目标误删。
            const ownedComponents = this.keepTargetComponents(
                regionMask,
                decoded.width,
                decoded.height,
                boxes
            );
            regionMask = ownedComponents.foreground > 0 ? ownedComponents.mask : null;
            if (!regionMask) {
                failures.push(`${label} 没有与选定目标框绑定的前景组件`);
                markRegionFailed(i);
                continue;
            }

            const targetCoverage = measureMaskTargetCoverage(
                regionMask,
                decoded.width,
                decoded.height,
                boxes,
                BOX_SEGMENT_FOREGROUND_THRESHOLD
            );
            const coveredTargetCount = targetCoverage.coveredCount;
            if (coveredTargetCount !== boxes.length) {
                failures.push(
                    `${label} 只有 ${coveredTargetCount}/${boxes.length} 个目标框内存在前景`
                    + `${targetCoverage.invalidIndexes.length > 0 ? `（无效框 ${targetCoverage.invalidIndexes.join('、')}）` : ''}`
                );
                markRegionFailed(i);
                continue;
            }

            // 局部蒙版缩放到它在输出坐标系中的实际尺寸，再贴回
            const target = {
                x1: Math.max(0, Math.round(region.regionInOutput.x1)),
                y1: Math.max(0, Math.round(region.regionInOutput.y1)),
                x2: Math.min(outputWidth, Math.round(region.regionInOutput.x2)),
                y2: Math.min(outputHeight, Math.round(region.regionInOutput.y2))
            };
            const targetW = target.x2 - target.x1;
            const targetH = target.y2 - target.y1;
            if (targetW <= 0 || targetH <= 0) {
                failures.push(`${label} 贴回区域超出输出范围`);
                markRegionFailed(i);
                continue;
            }

            const resized = targetW === decoded.width && targetH === decoded.height
                ? regionMask
                : await this.sharp!(regionMask, {
                    raw: { width: decoded.width, height: decoded.height, channels: 1 }
                })
                    .resize(targetW, targetH, { fit: 'fill', kernel: 'lanczos3' })
                    // 单通道必须显式声明，否则 sharp 按 sRGB 输出 3 通道
                    .toColourspace('b-w')
                    .raw()
                    .toBuffer();

            let written = 0;
            for (let y = 0; y < targetH; y++) {
                const srcRow = y * targetW;
                const dstRow = (target.y1 + y) * outputWidth + target.x1;
                for (let x = 0; x < targetW; x++) {
                    const value = resized[srcRow + x];
                    if (value > fullMask[dstRow + x]) fullMask[dstRow + x] = value;
                    if (value >= BOX_SEGMENT_FOREGROUND_THRESHOLD) written++;
                }
            }

            if (written > 0) {
                segmentedCount++;
                segmentedTargetCount += coveredTargetCount;
                const contact = this.measureBorderContact(regionMask, decoded.width, decoded.height);
                this.debugLog(
                    `[MattingService] ${label} 高分辨率分割：局部 ${decoded.width}x${decoded.height} → 输出 ${targetW}x${targetH}，前景 ${written}px`
                );
                // 贴边说明目标伸出了取像范围，这一侧会出现直线切口——必须让它可见
                if (contact.max >= BORDER_CONTACT_WARN_RATIO) {
                    clippedRegionIndexes.push(i);
                    console.warn(
                        `[MattingService] ${label} 目标伸出取像范围（${contact.sides}边连续贴边 `
                        + `${(contact.max * 100).toFixed(0)}%），该侧选区会是直线，需要更大的取像外扩`
                    );
                }
            } else {
                failures.push(`${label} 分割结果没有前景像素`);
                markRegionFailed(i);
            }
        }

        const targetCompleteness = buildTargetCompleteness();
        if (!targetCompleteness.complete) {
            return {
                success: false,
                error: `目标分割没有完整覆盖：区域 ${segmentedCount}/${regions.length}，目标 ${segmentedTargetCount}/${requestedTargetCount}。\n\n`
                    + failures.map(item => `· ${item}`).join('\n'),
                processingTime: Date.now() - startTime,
                usedModel: usedModels.join('+') || undefined,
                targetCompleteness
            };
        }

        sendProgress(95, 'complete', '精细分割完成');

        const shouldReturnBinaryMask = options.binaryMaskOutput === true;
        const maskBase64 = shouldReturnBinaryMask
            ? undefined
            : `RAW_MASK:${outputWidth}:${outputHeight}:${fullMask.toString('base64')}`;

        const analysisParts = [
            `高分辨率分割：${segmentedCount}/${regions.length} 个目标`,
            `模型：${usedModels.join('+') || '无'}`
        ];
        if (clippedRegionIndexes.length > 0) {
            analysisParts.push(`⚠ ${clippedRegionIndexes.length} 个目标伸出取像范围，边缘存在直线切口`);
        }
        if (warnings.length > 0) analysisParts.push(`质量提示：${warnings.join('；')}`);

        return {
            success: true,
            maskImage: maskBase64,
            mask: maskBase64,
            maskBuffer: shouldReturnBinaryMask ? fullMask : undefined,
            maskWidth: outputWidth,
            maskHeight: outputHeight,
            processingTime: Date.now() - startTime,
            usedModel: usedModels.join('+'),
            analysis: analysisParts.join(' | '),
            pipeline: { mode: 'onnx' },
            targetCompleteness,
            clippedRegionIndexes
        };
    }

    /**
     * 在指定目标框内分割（语义抠图的分割段）
     *
     * 与 removeBackground 的区别是本质性的：BiRefNet 是显著性分割，全图分割只会给出
     * "画面里最显著的主体"。当图中同时有鞋和袜子时，先全图分割再用袜子的框去裁剪，
     * 得到的是"袜子框内的鞋子局部"，而不是袜子。所以必须在框内重新做一次分割：
     * - 首选 SAM box prompt：它本身就是"给框、分割框内物体"的模型；
     * - 无 SAM 模型时降级为裁剪后 BiRefNet：把框外扩一点送去分割，再把结果限制回框内
     *   （外扩是为了让模型看见物体边界，限制回框是为了不把邻近物体带进来）。
     *
     * @param imageInput - 图层图像
     * @param boxes - 目标框，坐标必须与 imageInput 的像素尺寸同系
     */
    async segmentWithinBoxes(
        imageInput: string | BinaryImageData,
        boxes: Array<{ x1: number; y1: number; x2: number; y2: number }>,
        options?: {
            quality?: QualityLevel | number;
            edgeRefine?: string;
            /** 输出蒙版的目标尺寸（通常是 PS 图层原始像素尺寸） */
            originalWidth?: number;
            originalHeight?: number;
            binaryMaskOutput?: boolean;
            onProgress?: (progress: number, stage: string, message: string) => void;
        }
    ): Promise<MattingResult> {
        const startTime = Date.now();
        const sendProgress = options?.onProgress || ((_p: number, _s: string, _m: string) => {});

        if (!boxes || boxes.length === 0) {
            return {
                success: false,
                error: '未提供目标框，无法执行框内分割。',
                processingTime: Date.now() - startTime
            };
        }

        if (!(await this.ensureInitialized())) {
            return {
                success: false,
                error: `推理依赖加载失败：${this.lastDependencyError || '未知原因'}`,
                processingTime: Date.now() - startTime
            };
        }

        const normalizedQuality = this.normalizeQualityLevel(options?.quality);
        const birefnetInputSize = this.resolveBiRefNetInputSize(normalizedQuality);

        const decoded = await this.resolveImageBuffer(imageInput);
        if (!decoded.buffer) {
            return {
                success: false,
                error: `图像预处理失败: ${decoded.error}`,
                processingTime: Date.now() - startTime
            };
        }
        const imageBuffer = decoded.buffer;

        const metadata = await this.sharp!(imageBuffer).metadata();
        const imageWidth = metadata.width || 0;
        const imageHeight = metadata.height || 0;
        if (imageWidth <= 0 || imageHeight <= 0) {
            return {
                success: false,
                error: '无法读取图层图像尺寸，框内分割终止。',
                processingTime: Date.now() - startTime
            };
        }

        const clampedBoxes = boxes
            .map(box => ({
                x1: Math.max(0, Math.min(imageWidth - 1, Math.round(box.x1))),
                y1: Math.max(0, Math.min(imageHeight - 1, Math.round(box.y1))),
                x2: Math.max(1, Math.min(imageWidth, Math.round(box.x2))),
                y2: Math.max(1, Math.min(imageHeight, Math.round(box.y2)))
            }))
            .filter(box => box.x2 - box.x1 > 1 && box.y2 - box.y1 > 1);

        if (clampedBoxes.length === 0) {
            return {
                success: false,
                error: `目标框换算到图层 ${imageWidth}x${imageHeight} 后没有有效区域。`,
                processingTime: Date.now() - startTime
            };
        }

        const useSam = this.boxSegmenter !== null && this.boxSegmenter.isReady();
        const fullMask = Buffer.alloc(imageWidth * imageHeight, 0);
        const usedModels: string[] = [];
        const failures: string[] = [];
        let segmentedBoxCount = 0;

        // BiRefNet 降级路径需要模型；SAM 可用时按需加载，避免无谓的 1GB 模型载入
        let birefnetReady = false;

        for (let i = 0; i < clampedBoxes.length; i++) {
            const box = clampedBoxes[i];
            const boxLabel = `目标 ${i + 1}/${clampedBoxes.length}`;
            const progressBase = 45 + Math.round((i / clampedBoxes.length) * 40);
            sendProgress(progressBase, 'segmentation', `正在分割${boxLabel}...`);

            let written = 0;

            if (useSam) {
                const samResult = await this.boxSegmenter!.segmentWithBox(imageBuffer, box);
                if (samResult.success && samResult.mask) {
                    written = this.blendMaskRegion(
                        fullMask,
                        imageWidth,
                        imageHeight,
                        samResult.mask,
                        samResult.maskWidth || imageWidth,
                        samResult.maskHeight || imageHeight,
                        0,
                        0,
                        box
                    );
                    if (written > 0 && !usedModels.includes('mobile-sam')) {
                        usedModels.push('mobile-sam');
                    }
                } else {
                    failures.push(`${boxLabel} SAM 分割失败：${samResult.error || '未返回蒙版'}`);
                }
            }

            // SAM 不可用或没分割出内容时，用裁剪 + BiRefNet 兜住这一个框
            if (written === 0) {
                if (!birefnetReady) {
                    birefnetReady = await this.loadBiRefNetModel(this.resolveBiRefNetTier(normalizedQuality));
                    if (!birefnetReady) {
                        failures.push(
                            `${boxLabel} BiRefNet 不可用：${this.lastBiRefNetLoadError?.detail || '模型未安装'}`
                        );
                        continue;
                    }
                }

                const cropped = await this.segmentBoxWithBiRefNet(
                    imageBuffer,
                    box,
                    imageWidth,
                    imageHeight,
                    birefnetInputSize,
                    options?.edgeRefine
                );

                if (!cropped) {
                    failures.push(`${boxLabel} BiRefNet 裁剪分割失败`);
                    continue;
                }

                written = this.blendMaskRegion(
                    fullMask,
                    imageWidth,
                    imageHeight,
                    cropped.maskBuffer,
                    cropped.width,
                    cropped.height,
                    cropped.offsetX,
                    cropped.offsetY,
                    box
                );

                const tierLabel = `birefnet-${this.birefnetActiveTier || 'full'}`;
                if (written > 0 && !usedModels.includes(tierLabel)) {
                    usedModels.push(tierLabel);
                }
            }

            if (written > 0) {
                segmentedBoxCount++;
            } else {
                failures.push(`${boxLabel} 在框内没有分割出任何前景像素`);
            }
        }

        if (segmentedBoxCount !== clampedBoxes.length) {
            return {
                success: false,
                error: `框内分割没有完整覆盖全部目标：${segmentedBoxCount}/${clampedBoxes.length}。\n\n`
                    + failures.map(item => `· ${item}`).join('\n'),
                processingTime: Date.now() - startTime,
                usedModel: usedModels.join('+') || undefined
            };
        }

        sendProgress(90, 'postprocess', '正在合成分割结果...');

        // 输出到 PS 需要的目标尺寸
        const targetWidth = Number(options?.originalWidth) > 0 ? Math.round(Number(options!.originalWidth)) : imageWidth;
        const targetHeight = Number(options?.originalHeight) > 0 ? Math.round(Number(options!.originalHeight)) : imageHeight;

        let finalMaskBuffer: Buffer = fullMask;
        if (targetWidth !== imageWidth || targetHeight !== imageHeight) {
            finalMaskBuffer = await this.sharp!(fullMask, {
                raw: { width: imageWidth, height: imageHeight, channels: 1 }
            })
                .resize(targetWidth, targetHeight, { fit: 'fill', kernel: 'lanczos3' })
                // 必须显式声明单通道：sharp 从 raw 灰度输入 resize 后默认按 sRGB 输出，
                // .raw() 会吐出 3 通道，字节数刚好是期望的 3 倍
                // （真机 2026-08-27：5322x7982 图层收到 127440612 bytes，期望 42480204）。
                .toColourspace('b-w')
                .raw()
                .toBuffer();
        }

        const shouldReturnBinaryMask = options?.binaryMaskOutput === true;
        const maskBase64 = shouldReturnBinaryMask
            ? undefined
            : `RAW_MASK:${targetWidth}:${targetHeight}:${finalMaskBuffer.toString('base64')}`;

        sendProgress(95, 'complete', '框内分割完成');

        const analysisParts = [
            `框内分割：${segmentedBoxCount}/${clampedBoxes.length} 个目标区域成功`,
            `分割模型：${usedModels.join('+') || '无'}`
        ];
        return {
            success: true,
            maskImage: maskBase64,
            mask: maskBase64,
            maskBuffer: shouldReturnBinaryMask ? finalMaskBuffer : undefined,
            maskWidth: targetWidth,
            maskHeight: targetHeight,
            processingTime: Date.now() - startTime,
            usedModel: usedModels.join('+'),
            analysis: analysisParts.join(' | '),
            pipeline: { mode: 'onnx' }
        };
    }

    /**
     * 裁剪目标框区域后用 BiRefNet 分割（SAM 不可用时的降级路径）
     *
     * 外扩 padding 让模型看到物体的完整边界；返回的蒙版覆盖外扩后的区域，
     * 由调用方按原始框裁掉 padding 部分，避免把相邻物体一起抠出来。
     */
    private async segmentBoxWithBiRefNet(
        imageBuffer: Buffer,
        box: { x1: number; y1: number; x2: number; y2: number },
        imageWidth: number,
        imageHeight: number,
        inputSize: number,
        edgeRefineMode?: string
    ): Promise<{ maskBuffer: Buffer; width: number; height: number; offsetX: number; offsetY: number } | null> {
        const boxWidth = box.x2 - box.x1;
        const boxHeight = box.y2 - box.y1;
        const padding = Math.max(
            BOX_SEGMENT_MIN_PADDING,
            Math.min(BOX_SEGMENT_MAX_PADDING, Math.round(Math.min(boxWidth, boxHeight) * BOX_SEGMENT_PADDING_RATIO))
        );

        const left = Math.max(0, box.x1 - padding);
        const top = Math.max(0, box.y1 - padding);
        const right = Math.min(imageWidth, box.x2 + padding);
        const bottom = Math.min(imageHeight, box.y2 + padding);
        const cropWidth = right - left;
        const cropHeight = bottom - top;

        if (cropWidth <= 1 || cropHeight <= 1) return null;

        const cropBuffer = await this.sharp!(imageBuffer)
            .extract({ left, top, width: cropWidth, height: cropHeight })
            .png()
            .toBuffer()
            .catch((e: any) => {
                console.error(`[MattingService] 裁剪目标区域失败: ${e.message}`);
                return null;
            });

        if (!cropBuffer) return null;

        const inference = await this.runBiRefNetInference(
            cropBuffer,
            inputSize,
            cropWidth,
            cropHeight,
            edgeRefineMode
        );

        if (!inference) return null;

        return {
            maskBuffer: inference.maskBuffer,
            width: inference.width,
            height: inference.height,
            offsetX: left,
            offsetY: top
        };
    }

    /**
     * 检查蒙版是否贴着局部图的四条边。
     *
     * 贴边意味着目标延伸到了取像范围之外——那部分像素根本没被取到，
     * 分割结果必然在此处形成直线切口。这是"选区出现矩形直边"的真正来源，
     * 比"分割结果被硬裁回框"更早一步，连通域分析救不回来。
     */
    private measureBorderContact(
        mask: Buffer,
        width: number,
        height: number
    ): { max: number; sides: string } {
        // 用"最长连续贴边段"而不是"贴边像素总数"：
        // 目标恰好挨着取像边缘时会零星贴边，那不是被切；
        // 真被切断时，切口是一条连续的长直线。
        const longestRun = (length: number, at: (i: number) => number): number => {
            let best = 0;
            let run = 0;
            for (let i = 0; i < length; i++) {
                if (mask[at(i)] >= BOX_SEGMENT_FOREGROUND_THRESHOLD) {
                    run++;
                    if (run > best) best = run;
                } else {
                    run = 0;
                }
            }
            return best;
        };

        const top = longestRun(width, i => i) / Math.max(1, width);
        const bottom = longestRun(width, i => (height - 1) * width + i) / Math.max(1, width);
        const left = longestRun(height, i => i * width) / Math.max(1, height);
        const right = longestRun(height, i => i * width + width - 1) / Math.max(1, height);

        const sides = [
            top >= BORDER_CONTACT_WARN_RATIO ? '上' : '',
            bottom >= BORDER_CONTACT_WARN_RATIO ? '下' : '',
            left >= BORDER_CONTACT_WARN_RATIO ? '左' : '',
            right >= BORDER_CONTACT_WARN_RATIO ? '右' : ''
        ].filter(Boolean).join('');

        return { max: Math.max(top, bottom, left, right), sides };
    }

    /**
     * 用局部图作引导，把蒙版边缘吸附回原图的真实边缘。
     *
     * 尺寸不符或内存预算不足时返回明确原因，不抛出难以归因的通用异常，也不把
     * 未经引导精修的蒙版伪装成已经精修。调用方会把这次质量降级写入结果分析。
     */
    private async refineDetailWithGuide(
        detail: Buffer,
        imageBuffer: Buffer,
        width: number,
        height: number,
        label: string
    ): Promise<{ mask: Buffer | null; reason?: string }> {
        if (!this.sharp) return { mask: null, reason: '图像解码依赖未就绪' };

        const plan = planGuidedFilterExecution(width, height);
        if (plan.status !== 'ready') {
            console.warn(
                `[MattingService] ${label} 引导精修内存预算不足：`
                + `至少 ${plan.estimatedPeakBytes} bytes，预算 ${plan.memoryBudgetBytes} bytes`
            );
            return { mask: null, reason: '当前图像尺寸超过引导精修内存预算' };
        }

        const guide = await this.sharp(imageBuffer)
            .toColourspace('b-w')
            .raw()
            .toBuffer();
        if (guide.length !== width * height) {
            console.warn(
                `[MattingService] ${label} 引导图尺寸不符：期望 ${width * height}，实际 ${guide.length}`
            );
            return { mask: null, reason: '引导图灰度数据尺寸不符' };
        }

        const started = Date.now();
        const refined = refineMaskWithGuidedFilter(guide, detail, width, height);
        this.debugLog(
            `[MattingService] ${label} 引导精修完成（${width}x${height}，${Date.now() - started}ms）`
        );
        return { mask: Buffer.from(refined) };
    }

    /**
     * 合上范围蒙版里的窄缝（形态学闭运算：先膨胀后腐蚀）。
     *
     * 多个目标各求一次 SAM 范围再并起来时，两块之间常留一条几像素宽的缝——
     * SAM 的边界只有 256 网格精度，两个物体的范围不会严丝合缝地接上。
     * 细节蒙版在交界处本是连续的，却被这条缝挡掉，表现为选区里的残留空隙
     * （真机：共用局部图后仍有 1.2% 的交界像素上下是前景、自己是空的）。
     *
     * 只作用于 scope（范围指示），不碰 detail，所以不会牺牲边缘精度。
     */
    private closeScopeGaps(scope: Buffer, width: number, height: number, radius: number): Buffer {
        if (radius <= 0) return scope;
        const total = width * height;

        // 到最近前景的曼哈顿距离（两趟扫描）
        const distance = new Int32Array(total);
        const FAR = 1 << 20;
        for (let i = 0; i < total; i++) {
            distance[i] = scope[i] >= BOX_SEGMENT_FOREGROUND_THRESHOLD ? 0 : FAR;
        }
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = y * width + x;
                if (distance[i] === 0) continue;
                if (x > 0) distance[i] = Math.min(distance[i], distance[i - 1] + 1);
                if (y > 0) distance[i] = Math.min(distance[i], distance[i - width] + 1);
            }
        }
        for (let y = height - 1; y >= 0; y--) {
            for (let x = width - 1; x >= 0; x--) {
                const i = y * width + x;
                if (distance[i] === 0) continue;
                if (x < width - 1) distance[i] = Math.min(distance[i], distance[i + 1] + 1);
                if (y < height - 1) distance[i] = Math.min(distance[i], distance[i + width] + 1);
            }
        }

        // 膨胀：距离 <= radius 的背景并入前景
        const dilated = new Uint8Array(total);
        for (let i = 0; i < total; i++) dilated[i] = distance[i] <= radius ? 1 : 0;

        // 腐蚀：再算一次到"膨胀后背景"的距离，距离 <= radius 的退回背景
        const back = new Int32Array(total);
        for (let i = 0; i < total; i++) back[i] = dilated[i] === 0 ? 0 : FAR;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = y * width + x;
                if (back[i] === 0) continue;
                if (x > 0) back[i] = Math.min(back[i], back[i - 1] + 1);
                if (y > 0) back[i] = Math.min(back[i], back[i - width] + 1);
                // 图像边界当作背景，避免整块前景贴边时被误腐蚀
                if (x === 0 || y === 0) back[i] = Math.min(back[i], 1);
            }
        }
        for (let y = height - 1; y >= 0; y--) {
            for (let x = width - 1; x >= 0; x--) {
                const i = y * width + x;
                if (back[i] === 0) continue;
                if (x < width - 1) back[i] = Math.min(back[i], back[i + 1] + 1);
                if (y < height - 1) back[i] = Math.min(back[i], back[i + width] + 1);
                if (x === width - 1 || y === height - 1) back[i] = Math.min(back[i], 1);
            }
        }

        const output = Buffer.alloc(total, 0);
        for (let i = 0; i < total; i++) {
            if (dilated[i] === 1 && back[i] > radius) {
                // 原本就是前景的保留原灰度，填缝补上的给满值
                output[i] = scope[i] >= BOX_SEGMENT_FOREGROUND_THRESHOLD ? scope[i] : 255;
            }
        }
        return output;
    }

    /**
     * 用范围蒙版裁定细节蒙版：保留 detail 的灰度（边缘细节），只在 scope 覆盖处生效。
     *
     * scope 先做膨胀：它来自 SAM，边界只有 256 网格精度，直接相交会把 detail 的
     * 精细边缘削掉一圈——那正是我们要保住的东西。
     */
    private intersectWithScope(
        detail: Buffer,
        scope: Buffer,
        width: number,
        height: number,
        dilatePixels: number,
        dilateMode: 'solid' | 'transition-only' = 'solid'
    ): Buffer {
        const total = width * height;
        const radiusPixels = Math.max(0, Math.round(dilatePixels));

        // 不外扩时直接按范围取交集，省掉两趟距离扫描
        if (radiusPixels === 0) {
            const direct = Buffer.alloc(total, 0);
            for (let i = 0; i < total; i++) {
                if (scope[i] >= BOX_SEGMENT_FOREGROUND_THRESHOLD) direct[i] = detail[i];
            }
            return direct;
        }

        // 先二值化 scope，再按曼哈顿距离做一次廉价膨胀（两趟扫描）
        const near = new Uint8Array(total);
        for (let i = 0; i < total; i++) {
            near[i] = scope[i] >= BOX_SEGMENT_FOREGROUND_THRESHOLD ? 0 : 255;
        }
        const radius = radiusPixels;
        if (radius > 0) {
            // 正向扫描
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const i = y * width + x;
                    if (near[i] === 0) continue;
                    let best = near[i];
                    if (x > 0) best = Math.min(best, near[i - 1] + 1);
                    if (y > 0) best = Math.min(best, near[i - width] + 1);
                    near[i] = Math.min(255, best);
                }
            }
            // 反向扫描
            for (let y = height - 1; y >= 0; y--) {
                for (let x = width - 1; x >= 0; x--) {
                    const i = y * width + x;
                    if (near[i] === 0) continue;
                    let best = near[i];
                    if (x < width - 1) best = Math.min(best, near[i + 1] + 1);
                    if (y < height - 1) best = Math.min(best, near[i + width] + 1);
                    near[i] = Math.min(255, best);
                }
            }
        }

        const output = Buffer.alloc(total, 0);
        const transitionOnly = dilateMode === 'transition-only';
        for (let i = 0; i < total; i++) {
            // 范围内：原样保留，边缘完全由细节蒙版决定
            if (near[i] === 0) {
                output[i] = detail[i];
                continue;
            }
            if (near[i] > radius) continue;
            // 外扩带：transition-only 时只允许细节 Provider 在很窄的机械不确定带
            // 内补半透明边缘。半透明不等于目标归属，因此半径必须由上面的 2–8px
            // 通用上限约束，不能随 matting 过渡带宽度扩大。
            if (transitionOnly && detail[i] >= SOLID_ALPHA_THRESHOLD) continue;
            output[i] = detail[i];
        }
        return output;
    }

    /**
     * 从分割结果里保留每个目标拥有的组件，允许组件超出目标框。
     *
     * 为什么不能按框硬裁：框外扩 padding 正是为了容纳检测框的误差，裁回原框等于白扩。
     * 真机 2026-08-27：抠鞋子时鞋面比检测框高出一截，硬裁后选区在那里出现一条水平直角，
     * 看起来像把图片剪了一刀。
     *
     * 改按连通性判断：每个目标框各自保留重叠最多的连通域（哪怕伸出框外），
     * 与所有框都无归属关系的独立碎片排除。不能只挑全图最大连通域，否则多目标时
     * 第二个合法目标会被误删。
     */
    private keepTargetComponents(
        mask: Buffer,
        width: number,
        height: number,
        boxes: Array<{ x1: number; y1: number; x2: number; y2: number }>
    ): { mask: Buffer; foreground: number } {
        const { regions, labels } = extractMaskRegionsWithLabels(mask, width, height, {
            foregroundThreshold: BOX_SEGMENT_FOREGROUND_THRESHOLD,
            // 这里的候选是"目标的组成部分"，阈值要比整图定位宽松，
            // 否则鞋带、装饰这类小部件会被当碎片丢掉
            minAreaRatio: 0.0005,
            maxRegions: 24
        });

        if (regions.length === 0) {
            return { mask: Buffer.alloc(width * height, 0), foreground: 0 };
        }

        const keep = new Set<number>();
        for (const box of boxes) {
            // 统计每个连通域落在当前目标框内的像素数。
            const overlap = new Array(regions.length).fill(0);
            const clipX1 = Math.max(0, Math.floor(box.x1));
            const clipY1 = Math.max(0, Math.floor(box.y1));
            const clipX2 = Math.min(width, Math.ceil(box.x2));
            const clipY2 = Math.min(height, Math.ceil(box.y2));

            for (let y = clipY1; y < clipY2; y++) {
                const row = y * width;
                for (let x = clipX1; x < clipX2; x++) {
                    const label = labels[row + x];
                    if (label > 0) overlap[label - 1]++;
                }
            }

            let bestIndex = -1;
            let bestOverlap = 0;
            for (let index = 0; index < regions.length; index++) {
                if (overlap[index] > bestOverlap) {
                    bestOverlap = overlap[index];
                    bestIndex = index;
                }
            }
            if (bestIndex < 0) continue;

            keep.add(bestIndex + 1);
            // 主体之外，把同样与框高度重叠的部件一并保留（例如鞋带与鞋身断开）。
            for (let index = 0; index < regions.length; index++) {
                if (index === bestIndex) continue;
                const ratio = regions[index].area > 0 ? overlap[index] / regions[index].area : 0;
                if (ratio >= TARGET_COMPONENT_KEEP_RATIO) keep.add(index + 1);
            }
        }

        if (keep.size === 0) {
            return { mask: Buffer.alloc(width * height, 0), foreground: 0 };
        }

        const output = Buffer.alloc(width * height, 0);
        let foreground = 0;
        for (let i = 0; i < output.length; i++) {
            if (!keep.has(labels[i])) continue;
            output[i] = mask[i];
            if (mask[i] >= BOX_SEGMENT_FOREGROUND_THRESHOLD) foreground++;
        }

        return { mask: output, foreground };
    }

    /**
     * 把一块局部蒙版合并进全图蒙版，只写入 clip 框覆盖的像素（逐像素取较大值）。
     *
     * source 允许与 target 尺寸不同：按比例采样，用于 BiRefNet 裁剪块贴回，
     * 也用于 SAM 输出与全图尺寸一致时的直接合并。
     *
     * @returns 实际写入的前景像素数（用于判断这个框到底有没有分割出东西）
     */
    private blendMaskRegion(
        target: Buffer,
        targetWidth: number,
        targetHeight: number,
        source: Buffer,
        sourceWidth: number,
        sourceHeight: number,
        offsetX: number,
        offsetY: number,
        clip: { x1: number; y1: number; x2: number; y2: number }
    ): number {
        const clipX1 = Math.max(0, Math.min(targetWidth, clip.x1));
        const clipY1 = Math.max(0, Math.min(targetHeight, clip.y1));
        const clipX2 = Math.max(0, Math.min(targetWidth, clip.x2));
        const clipY2 = Math.max(0, Math.min(targetHeight, clip.y2));

        let written = 0;

        for (let y = clipY1; y < clipY2; y++) {
            const sourceY = y - offsetY;
            if (sourceY < 0 || sourceY >= sourceHeight) continue;
            const sourceRow = sourceY * sourceWidth;
            const targetRow = y * targetWidth;

            for (let x = clipX1; x < clipX2; x++) {
                const sourceX = x - offsetX;
                if (sourceX < 0 || sourceX >= sourceWidth) continue;

                const value = source[sourceRow + sourceX];
                if (value === undefined) continue;

                const targetIndex = targetRow + x;
                if (value > target[targetIndex]) {
                    target[targetIndex] = value;
                }
                if (value >= BOX_SEGMENT_FOREGROUND_THRESHOLD) {
                    written++;
                }
            }
        }

        return written;
    }

    /**
     * 智能对象检测 - 检测图像中的对象并返回边界框
     *
     * 核心功能：实现类似 Photoshop 对象选择工具的能力
     * - 当用户只框选了对象的一部分时，自动识别完整对象边界框
     * - 返回与用户选区重叠的所有对象，按重叠比例排序
     * 
     * @param imageBuffer - 输入图像 Buffer
     * @param userBox - 用户绘制的选区边界框 [x1, y1, x2, y2]（可选）
     * @returns 检测到的对象边界框数组，按与用户选区的重叠度排序
     */
    async detectObjectsInRegion(
        imageBuffer: Buffer,
        userBox?: [number, number, number, number]
    ): Promise<{
        success: boolean;
        objects: DetectionBox[];
        bestMatch?: DetectionBox;  // 与用户选区最匹配的对象
        expandedBox?: [number, number, number, number];  // 扩展后的完整对象边界框
        error?: string;
    }> {
        try {
            // 1. 确保 YOLO-World 模型已加载
            const yoloLoaded = await this.loadYoloWorldModel();
            if (!yoloLoaded) {
                console.log('[MattingService] YOLO-World 未加载，无法检测对象');
                return { success: false, objects: [], error: 'YOLO-World 模型未加载' };
            }
            
            // 2. 使用通用提示词检测所有对象
            // YOLO-World 支持开放词汇，这里使用通用描述
            const genericPrompts = ['object', 'item', 'thing', 'product'];
            let allDetections: DetectionBox[] = [];
            
            for (const prompt of genericPrompts) {
                const detections = await this.runYoloWorldInference(imageBuffer, prompt);
                if (detections && detections.length > 0) {
                    allDetections.push(...detections);
                    break;  // 找到对象后停止
                }
            }
            
            // 3. 如果没有用户选区，返回所有检测结果
            if (!userBox || userBox.length !== 4) {
                return {
                    success: true,
                    objects: allDetections,
                    bestMatch: allDetections[0],
                    expandedBox: allDetections[0] 
                        ? [allDetections[0].x1, allDetections[0].y1, allDetections[0].x2, allDetections[0].y2]
                        : undefined
                };
            }
            
            // 4. 计算每个检测框与用户选区的重叠度
            const userDetectionBox: DetectionBox = {
                x1: userBox[0],
                y1: userBox[1],
                x2: userBox[2],
                y2: userBox[3],
                confidence: 1,
                label: 'user_selection'
            };
            
            // 计算重叠度（IoU）并筛选有重叠的对象
            const overlappingObjects = allDetections
                .map(obj => ({
                    ...obj,
                    iou: this.calculateIoU(userDetectionBox, obj),
                    containsRatio: this.calculateContainsRatio(userDetectionBox, obj)
                }))
                .filter(obj => obj.iou > 0.05 || obj.containsRatio > 0.3)  // 至少 5% IoU 或 30% 包含
                .sort((a, b) => {
                    // 优先选择：包含用户选区更多的对象
                    const scoreA = a.containsRatio * 0.7 + a.iou * 0.3;
                    const scoreB = b.containsRatio * 0.7 + b.iou * 0.3;
                    return scoreB - scoreA;
                });
            
            console.log(`[MattingService] 检测到 ${allDetections.length} 个对象，${overlappingObjects.length} 个与选区重叠`);
            
            // 5. 选择最佳匹配
            const bestMatch = overlappingObjects[0];
            
            // 6. 计算扩展后的边界框（融合用户选区和检测框）
            let expandedBox: [number, number, number, number] | undefined;
            
            if (bestMatch) {
                // 使用检测到的完整对象边界框（而不是用户选区）
                // 这就是实现"部分框选也能识别完整对象"的关键
                expandedBox = [bestMatch.x1, bestMatch.y1, bestMatch.x2, bestMatch.y2];
                
                console.log(`[MattingService] 智能扩展边界框:`);
                console.log(`  用户选区: [${userBox.join(', ')}]`);
                console.log(`  扩展后: [${expandedBox.join(', ')}]`);
                console.log(`  检测置信度: ${bestMatch.confidence.toFixed(3)}`);
            }
            
            return {
                success: true,
                objects: overlappingObjects,
                bestMatch,
                expandedBox
            };
            
        } catch (error: any) {
            console.error('[MattingService] 对象检测失败:', error.message);
            return { success: false, objects: [], error: error.message };
        }
    }
    
    /**
     * 计算用户选区被对象包含的比例
     * 用于识别"用户只框选了对象的一部分"的场景
     */
    private calculateContainsRatio(userBox: DetectionBox, objectBox: DetectionBox): number {
        const x1 = Math.max(userBox.x1, objectBox.x1);
        const y1 = Math.max(userBox.y1, objectBox.y1);
        const x2 = Math.min(userBox.x2, objectBox.x2);
        const y2 = Math.min(userBox.y2, objectBox.y2);
        
        const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
        const userArea = (userBox.x2 - userBox.x1) * (userBox.y2 - userBox.y1);
        
        return userArea > 0 ? intersection / userArea : 0;
    }

    /**
     * 基于边界框的分割（选区模式）
     * 
     * 对选区内的图像进行分割
     */
    async removeBackgroundByBox(
        imageInput: string | BinaryImageData,
        box: [number, number, number, number],
        options?: {
            refineEdges?: boolean;
            onProgress?: (stage: string, progress: number, message: string) => void;
        }
    ): Promise<MattingResult> {
        // 选区分割：先裁剪选区，再进行分割
        console.log(`[MattingService] 选区分割，边界框: [${box.join(', ')}]`);
        
        // 直接调用主分割方法（选区裁剪由调用方处理）
        return this.removeBackground(imageInput, {
            onProgress: options?.onProgress 
                ? (p, s, m) => options.onProgress!(s, p, m) 
                : undefined
        });
    }

    // ==================== 模型状态查询 ====================

    /**
     * 获取模型状态（供 UI 显示）
     */
    getModelsStatus(): {
        birefnet: { exists: boolean; loaded: boolean; path: string; size: string };
        yoloWorld: { exists: boolean; loaded: boolean; path: string; size: string };
    } {
        const resolvedBiRefNet = this.resolveBiRefNetModelPath(
            this.resolveBiRefNetTier(this.config.defaultQuality)
        );
        const birefnetPath = resolvedBiRefNet?.path
            || path.join(this.modelsDir, 'birefnet', 'birefnet.onnx');
        const yoloWorldPath = path.join(this.modelsDir, 'yolo-world', 'yolov8s-worldv2.onnx');
        
        const birefnetExists = Boolean(resolvedBiRefNet);
        const yoloWorldExists = fs.existsSync(yoloWorldPath);
        
        // 获取文件大小
        let birefnetSize = '~176MB';
        let yoloWorldSize = '~48MB';
        
        try {
            if (birefnetExists) {
                const stats = fs.statSync(birefnetPath);
                birefnetSize = `${(stats.size / 1024 / 1024).toFixed(1)}MB`;
            }
            if (yoloWorldExists) {
                const stats = fs.statSync(yoloWorldPath);
                yoloWorldSize = `${(stats.size / 1024 / 1024).toFixed(1)}MB`;
            }
        } catch (e) {
            // 忽略错误，使用默认值
        }
        
        return {
            birefnet: {
                exists: birefnetExists,
                loaded: this.birefnetSession !== null,
                path: birefnetPath,
                size: birefnetSize
            },
            yoloWorld: {
                exists: yoloWorldExists,
                loaded: this.yoloWorldSession !== null,
                path: yoloWorldPath,
                size: yoloWorldSize
            }
        };
    }

    // ==================== 兼容旧 API ====================

    /**
     * 初始化服务（兼容旧 API）
     */
    async reinitializePythonBackend(): Promise<boolean> {
        console.log('[MattingService] 初始化本地 ONNX 模型...');
        
        // 加载 BiRefNet（必需）。按默认质量档加载，不要用 loadBiRefNetModel 的
        // 'full' 默认值——那会在启动时把 928MB 的 general 权重灌进 DML 占约 5GB 显存，
        // 而默认档位是 balanced，这个会话整轮都用不上（真机日志实测：探测已加载 lite，
        // 这里又加载一次 full，两个会话同时占着显存）。
        const birefnetLoaded = await this.loadBiRefNetModel(
            this.resolveBiRefNetTier(this.config.defaultQuality)
        );
        
        // 不再预加载 YOLO-World。语义定位早已改用 GroundingDINO，YOLO-World
        // 现在只剩 shape-morphing 一处使用，而 detectWithYoloWorld 自带懒加载
        // （yoloWorldSession 为空时会自行加载）。预加载只是让它白占一份显存——
        // 真机日志显示每轮抠图都在加载它，而整条抠图链路根本不调用它。
        if (birefnetLoaded) {
            const gpuInfo = this.gpuStatus.available 
                ? `[${this.gpuStatus.provider.toUpperCase()}]` 
                : '[CPU]';
            console.log(`[MattingService] ✅ 模型初始化完成 ${gpuInfo}: BiRefNet`);
        }
        
        return birefnetLoaded;
    }
    
    /**
     * 设置 GPU 模式
     */
    async setGPUMode(mode: 'auto' | 'cuda' | 'directml' | 'cpu'): Promise<GPUStatus> {
        console.log(`[MattingService] 切换 GPU 模式: ${mode}`);
        
        // 更新配置
        this.config.gpuMode = mode;
        
        // 重置状态
        this.initialized = false;
        this.releaseBiRefNetSessions();
        this.yoloWorldSession = null;

        // 重新初始化
        await this.ensureInitialized();
        
        return this.gpuStatus;
    }

    /**
     * 检查服务是否可用（兼容旧 API）
     */
    isPythonBackendAvailable(): boolean {
        return this.birefnetSession !== null;
    }
    
    // ==================== 公开的 YOLO-World 接口 ====================
    
    /**
     * 加载 YOLO-World 模型（公开方法）
     * 用于 SubjectDetectionService 调用
     */
    async loadYOLOWorldModel(): Promise<boolean> {
        return this.loadYoloWorldModel();
    }
    
    /**
     * 使用 YOLO-World 检测图像中的物体
     * @param imageBuffer - 图像 Buffer
     * @param textPrompt - 搜索关键词（如 "sock", "clothing"）
     * @returns 检测到的边界框数组
     */
    async detectWithYOLOWorld(imageBuffer: Buffer, textPrompt: string): Promise<DetectionBox[] | null> {
        return this.runYoloWorldInference(imageBuffer, textPrompt);
    }

    /**
     * 关闭服务
     */
    async shutdown(): Promise<void> {
        console.log('[MattingService] 关闭智能分割服务');
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
        this.releaseBiRefNetSessions();
        this.yoloWorldSession = null;
        this.initialized = false;
    }

    /**
     * 获取服务状态（兼容旧 API）
     */
    async getPythonBackendStatus(): Promise<{
        available: boolean;
        gpu: { available: boolean; count: number; devices: any[] } | null;
        models: string[];
        error?: string;
    }> {
        const status = this.getModelsStatus();
        
        const models: string[] = [];
        if (status.birefnet.exists) models.push('birefnet');
        if (status.yoloWorld.exists) models.push('yolo-world');
        
        const errors: string[] = [];
        if (!status.birefnet.exists) errors.push('BiRefNet 模型未安装');

        return {
            available: status.birefnet.exists && this.birefnetSession !== null,
            gpu: this.gpuStatus.available
                ? {
                    available: true,
                    count: 1,
                    devices: [{
                        provider: this.gpuStatus.provider,
                        name: this.gpuStatus.deviceName || this.gpuStatus.provider.toUpperCase(),
                        memory: this.gpuStatus.memory
                    }]
                }
                : null,
            models,
            error: errors.length > 0 ? errors.join('; ') : undefined
        };
    }
}
