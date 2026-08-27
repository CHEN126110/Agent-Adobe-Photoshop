/**
 * 智能分割服务 - 本地 ONNX 模型
 * 
 * v6.0 - 完整的 文本定位 + 目标检测 + 精确分割 + 边缘细化 流程
 * 
 * 功能：
 * 1. 语义分割 - 识别画布中所有主体（类似 PS "选择主体"）
 * 2. 文本定位分割 - 根据文本描述定位并分割目标（如"袜子"、"鞋子"）
 * 3. 选区分割 - 识别选区范围内的主体
 * 
 * 使用模型：
 * - YOLO-World ONNX (~48MB) - 开放词汇目标检测，支持任意文本描述定位
 * - BiRefNet ONNX (~176MB) - 高精度边缘分割，毛发级别细节
 * 
 * 处理流程：
 * 1. 文本定位：YOLO-World 根据用户描述检测目标边界框
 * 2. 精确分割：BiRefNet 对检测区域进行高精度分割
 * 3. 边缘细化：BiRefNet 自带的双向信息融合机制优化边缘
 * 
 * 技术栈：
 * - onnxruntime-node - ONNX 推理
 * - sharp - 图像预处理/后处理
 */

import * as path from 'path';
import * as fs from 'fs';
import { 
    BinaryImageData, 
    isBinaryImageData, 
    binaryImageDataToBase64 
} from '../../shared/binary-protocol';
import {
    DEFAULT_CANDIDATE_EXTRACTION,
    buildCandidatePointGrid,
    extractMaskComponents,
    findUncoveredPoint,
    maskIoU,
    type CandidateExtractionOptions,
    type SemanticCandidate
} from '../../shared/semantic-target-candidates';

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
}

// ==================== 模型配置 ====================

// BiRefNet 模型配置
// 注意：当前 ONNX 模型为固定输入尺寸 1024x1024，不支持动态分辨率
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
/** 最大连通域占前景多少比例时，判定为"粘连成一大块"，需要在块内再切 */
const REFINE_DOMINANT_RATIO = 0.7;
/** 块内撒点的目标数量：行列按物体长宽比分配，细长物体自动多行少列 */
const REFINE_TARGET_POINTS = 16;
/** 网格之外最多再补几个点（补在还没被覆盖的最大前景块中心） */
const REFINE_MAX_EXTRA_POINTS = 6;
/** 有效部件的面积占比区间：过小是毛刺，过大等于没切开 */
const REFINE_MIN_PART_RATIO = 0.03;
const REFINE_MAX_PART_RATIO = 0.92;
/** 两个部件蒙版 IoU 超过此值视为同一物体 */
const REFINE_DUPLICATE_IOU = 0.75;
/** 细分最多保留几个部件：给模型太多选项反而难选 */
const REFINE_MAX_PARTS = 8;

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
        box: { x1: number; y1: number; x2: number; y2: number }
    ): Promise<{
        success: boolean;
        mask?: Buffer;
        maskWidth?: number;
        maskHeight?: number;
        error?: string;
    }>;
    /**
     * 批量点分割：用于把相互接触、连通域拆不开的物体切开
     * （模特腿部特写里腿、袜、鞋连成一整块前景）。
     */
    segmentWithPoints?(
        imageBuffer: Buffer,
        points: Array<{ x: number; y: number }>
    ): Promise<Array<{ point: { x: number; y: number }; mask: Buffer } | null>>;
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
    private sharp: typeof import('sharp') | null = null;
    
    // 模型会话缓存
    // BiRefNet 双档：full（birefnet.onnx，~970MB，边缘最优但慢）/ lite（birefnet_lite|_old.onnx，~220MB，3-5 倍速）
    // birefnetSession 始终指向当前激活档位的会话（保持既有推理代码不变）
    private birefnetSession: any = null;
    private birefnetSessionByTier: { full: any | null; lite: any | null } = { full: null, lite: null };
    private birefnetActiveTier: 'full' | 'lite' | null = null;
    private yoloWorldSession: any = null;

    // 框内分割器（SAM）：语义抠图优先用它在目标框内分割，未注入时降级为裁剪 + BiRefNet
    private boxSegmenter: BoxSegmenter | null = null;

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
        console.log('[MattingService] 初始化完成，使用 YOLO-World + BiRefNet ONNX 模型');
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
                graphOptimizationLevel: 'basic',
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
            
            // 尝试加载一个真实的模型来验证
            // 使用 BiRefNet 模型作为测试（如果已下载）
            const testModelPath = path.join(this.modelsDir, 'birefnet', 'birefnet.onnx');
            if (fs.existsSync(testModelPath)) {
                const testSession = await this.ort.InferenceSession.create(testModelPath, sessionOptions);
                // 这次真实模型加载本身已经完成 provider 验证，直接作为 full 会话复用。
                // 旧实现立即 release 后又加载同一模型，冷启动会重复占用时间和峰值内存。
                this.birefnetSession = testSession;
                this.birefnetSessionByTier.full = testSession;
                this.birefnetActiveTier = 'full';
                console.log(`[MattingService] ✅ ${provider} 执行提供程序可用，复用已加载的 BiRefNet full 会话`);
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
    private resolveBiRefNetModelPath(tier: 'full' | 'lite'): { path: string; tier: 'full' | 'lite' } | null {
        const fullPath = path.join(this.modelsDir, 'birefnet', 'birefnet.onnx');
        const liteCandidates = [
            path.join(this.modelsDir, 'birefnet', 'birefnet_lite.onnx'),
            path.join(this.modelsDir, 'birefnet', 'birefnet_old.onnx')
        ];
        const litePath = liteCandidates.find(p => fs.existsSync(p)) || null;
        const fullExists = fs.existsSync(fullPath);

        if (tier === 'lite') {
            if (litePath) return { path: litePath, tier: 'lite' };
            if (fullExists) {
                console.warn('[MattingService] lite 档模型不存在（birefnet_lite/_old.onnx），回退 full 档');
                return { path: fullPath, tier: 'full' };
            }
            return null;
        }
        if (fullExists) return { path: fullPath, tier: 'full' };
        if (litePath) {
            console.warn('[MattingService] full 档模型不存在，回退 lite 档');
            return { path: litePath, tier: 'lite' };
        }
        return null;
    }

    /** 按质量档位选择 BiRefNet 档：fast/balanced → lite（速度优先），quality → full（边缘最优） */
    private resolveBiRefNetTier(quality?: QualityLevel | number): 'full' | 'lite' {
        const level = this.normalizeQualityLevel(quality);
        return level === 'quality' ? 'full' : 'lite';
    }

    private async loadBiRefNetModel(tier: 'full' | 'lite' = 'full'): Promise<boolean> {
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
        
        try {
            const providerName = this.activeExecutionProvider.toUpperCase();
            console.log(`[MattingService] 正在加载 BiRefNet 模型 (${providerName})...`);
            const startTime = Date.now();
            
            // 使用优化的会话选项（包含 GPU 加速配置）
            const sessionOptions = this.getSessionOptions();
            
            try {
                this.birefnetSession = await this.ort.InferenceSession.create(modelPath, sessionOptions);
            } catch (gpuError: any) {
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
            console.log(`[MattingService] ✅ BiRefNet 模型加载完成 [${resolved.tier}/${sizeMB}MB/${this.activeExecutionProvider.toUpperCase()}] (${loadTime}ms)`);
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
            const normalizedEdgeRefineMode = this.normalizeEdgeRefineMode(edgeRefineMode);
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
            return null;
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
                + '无法用它做开放词汇检测。语义目标定位请走 SemanticTargetLocatorService。'
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

        // 3. 目标框由调用方给出（语义定位在 SemanticTargetLocatorService 完成）。
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
     * 拆出画面里的候选物体（语义抠图的候选段）
     *
     * BiRefNet 回答"哪些像素是前景"，连通域回答"前景分成几个物体"——两者都不需要
     * 知道"袜子"是什么。谁是用户要的目标，交给模型在候选里选，Harness 不替它判断。
     *
     * 每个候选自带精确蒙版（见返回的 labels），选中后可直接取像素，不必二次分割。
     */
    async extractForegroundCandidates(
        imageInput: string | BinaryImageData,
        options?: {
            quality?: QualityLevel | number;
            edgeRefine?: string;
            extraction?: CandidateExtractionOptions;
            onProgress?: (progress: number, stage: string, message: string) => void;
        }
    ): Promise<{
        success: boolean;
        candidates: SemanticCandidate[];
        labels?: Int32Array;
        /** 由 SAM 块内细分得到的候选，其蒙版不在 labels 里，按 id 单独给出 */
        candidateMasks?: Map<number, Buffer>;
        mask?: Buffer;
        width?: number;
        height?: number;
        error?: string;
    }> {
        const sendProgress = options?.onProgress || ((_p: number, _s: string, _m: string) => {});

        if (!(await this.ensureInitialized())) {
            return {
                success: false,
                candidates: [],
                error: `推理依赖加载失败：${this.lastDependencyError || '未知原因'}`
            };
        }

        const normalizedQuality = this.normalizeQualityLevel(options?.quality);
        if (!(await this.loadBiRefNetModel(this.resolveBiRefNetTier(normalizedQuality)))) {
            return {
                success: false,
                candidates: [],
                error: `分割模型不可用：${this.lastBiRefNetLoadError?.detail || '模型未安装'}`
            };
        }

        const decoded = await this.decodeImageInput(imageInput);
        if (!decoded) {
            return { success: false, candidates: [], error: '无法解码图层图像' };
        }

        sendProgress(20, 'segmentation', '正在识别画面中的物体...');

        const inference = await this.runBiRefNetInference(
            decoded.buffer,
            this.resolveBiRefNetInputSize(normalizedQuality),
            decoded.width,
            decoded.height,
            options?.edgeRefine
        );

        if (!inference) {
            return { success: false, candidates: [], error: '分割模型推理失败，无法得到前景' };
        }

        const { candidates, labels } = extractMaskComponents(
            inference.maskBuffer,
            inference.width,
            inference.height,
            options?.extraction || DEFAULT_CANDIDATE_EXTRACTION
        );

        this.debugLog(`[MattingService] 前景拆出 ${candidates.length} 个连通域候选`);

        if (candidates.length === 0) {
            return {
                success: true,
                candidates,
                labels,
                mask: inference.maskBuffer,
                width: inference.width,
                height: inference.height
            };
        }

        // 判断前景是不是"一大块粘连物"：连通域只有一个，或最大块吃掉了绝大部分前景。
        // 这种形态下用户想要的往往是块里的某个部件（腿上的鞋、袜），必须再切一刀。
        const foregroundArea = candidates.reduce((sum, item) => sum + item.area, 0);
        const largest = candidates[0];
        const dominated = largest.area / Math.max(1, foregroundArea) >= REFINE_DOMINANT_RATIO;
        const canRefine = this.boxSegmenter?.isReady() === true
            && typeof this.boxSegmenter.segmentWithPoints === 'function';

        if (!canRefine || (candidates.length > 1 && !dominated)) {
            return {
                success: true,
                candidates,
                labels,
                mask: inference.maskBuffer,
                width: inference.width,
                height: inference.height
            };
        }

        sendProgress(40, 'segmentation', '画面里的物体连在一起，正在细分...');

        const parts = await this.refineCandidateWithPoints(
            decoded.buffer,
            inference.maskBuffer,
            labels,
            largest,
            inference.width,
            inference.height
        );

        // 只切出一个部件等于没切开，保持原候选不动，免得凭空多一层不必要的选项
        if (parts.length < 2) {
            return {
                success: true,
                candidates,
                labels,
                mask: inference.maskBuffer,
                width: inference.width,
                height: inference.height
            };
        }

        // 用部件替换被细分的那个大块，其余连通域候选保持原样，统一重新编号
        const others = candidates.filter(item => item.id !== largest.id);
        const merged: SemanticCandidate[] = [];
        const candidateMasks = new Map<number, Buffer>();

        for (const part of parts) {
            const id = merged.length + 1;
            merged.push({ id, area: part.area, x1: part.x1, y1: part.y1, x2: part.x2, y2: part.y2 });
            candidateMasks.set(id, part.mask);
        }

        const remapped = new Int32Array(labels.length);
        for (const other of others) {
            const id = merged.length + 1;
            merged.push({ ...other, id });
            for (let i = 0; i < labels.length; i++) {
                if (labels[i] === other.id) remapped[i] = id;
            }
        }

        this.debugLog(
            `[MattingService] 细分后候选: ${merged.length} 个（${parts.length} 个部件 + ${others.length} 个独立物体）`
        );

        return {
            success: true,
            candidates: merged,
            labels: remapped,
            candidateMasks,
            mask: inference.maskBuffer,
            width: inference.width,
            height: inference.height
        };
    }

    /**
     * 在一个粘连的大前景块内部，用 SAM 撒点把相互接触的物体切开。
     *
     * 连通域只能按"像素是否相连"分割，模特腿部特写里腿、袜、鞋是连在一起的，
     * 拆出来只有一块——用户要"鞋子"就会抠出整条腿。SAM 能在块内部按语义边界切开
     * （实测：腿/袜/鞋三段各自分出，面积与真值误差 < 2%）。
     *
     * @returns 切出的部件蒙版（已与前景取交集，去掉溢出到背景的部分）
     */
    private async refineCandidateWithPoints(
        imageBuffer: Buffer,
        foregroundMask: Buffer,
        labels: Int32Array,
        candidate: SemanticCandidate,
        width: number,
        height: number
    ): Promise<Array<{ mask: Buffer; area: number; x1: number; y1: number; x2: number; y2: number }>> {
        const segmenter = this.boxSegmenter;
        if (!segmenter?.segmentWithPoints) return [];

        const points = buildCandidatePointGrid(candidate, labels, width, {
            targetPoints: REFINE_TARGET_POINTS
        });

        if (points.length < 2) {
            this.debugLog('[MattingService] 可用采样点不足，跳过块内细分');
            return [];
        }

        const segmented = await segmenter.segmentWithPoints(imageBuffer, points);
        const parts: Array<{ mask: Buffer; area: number; x1: number; y1: number; x2: number; y2: number }> = [];
        // 记录哪些前景像素已被切出的部件覆盖，用于给漏掉的区域补点
        const covered = new Uint8Array(width * height);

        for (const item of segmented) {
            if (!item?.mask) continue;

            // 与前景取交集：SAM 可能把邻接的背景一起圈进来，
            // 前景蒙版是这一步唯一可信的边界依据。
            const clipped = Buffer.alloc(width * height, 0);
            let area = 0;
            let minX = width;
            let minY = height;
            let maxX = 0;
            let maxY = 0;

            for (let i = 0; i < clipped.length; i++) {
                if (labels[i] !== candidate.id) continue;
                const value = Math.min(item.mask[i] ?? 0, foregroundMask[i]);
                if (value < BOX_SEGMENT_FOREGROUND_THRESHOLD) continue;

                clipped[i] = value;
                area++;
                const x = i % width;
                const y = (i - x) / width;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }

            // 太小的是分割毛刺，太大的等于没切开——两者都不构成有效部件
            const ratio = area / Math.max(1, candidate.area);
            if (ratio < REFINE_MIN_PART_RATIO || ratio > REFINE_MAX_PART_RATIO) continue;

            parts.push({ mask: clipped, area, x1: minX, y1: minY, x2: maxX + 1, y2: maxY + 1 });
            for (let i = 0; i < clipped.length; i++) {
                if (clipped[i] >= BOX_SEGMENT_FOREGROUND_THRESHOLD) covered[i] = 1;
            }
        }

        // 网格总会漏掉细长或偏在一角的部件（真机：竖构图里脚上的鞋一个采样点都没采到）。
        // 对还没被覆盖的大块前景补点，比继续加密整张网格省得多。
        for (let round = 0; round < REFINE_MAX_EXTRA_POINTS; round++) {
            const uncovered = findUncoveredPoint(
                labels,
                candidate.id,
                covered,
                width,
                height,
                REFINE_MIN_PART_RATIO,
                candidate.area
            );
            if (!uncovered) break;

            const extra = await segmenter.segmentWithPoints(imageBuffer, [{ x: uncovered.x, y: uncovered.y }]);
            const extraMask = extra[0]?.mask;
            if (!extraMask) break;

            const clipped = Buffer.alloc(width * height, 0);
            let area = 0;
            let minX = width;
            let minY = height;
            let maxX = 0;
            let maxY = 0;

            for (let i = 0; i < clipped.length; i++) {
                if (labels[i] !== candidate.id) continue;
                const value = Math.min(extraMask[i] ?? 0, foregroundMask[i]);
                if (value < BOX_SEGMENT_FOREGROUND_THRESHOLD) continue;
                clipped[i] = value;
                area++;
                const x = i % width;
                const y = (i - x) / width;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }

            // 补点切出的东西无效时也要把该区域标记为已处理，否则会在同一处死循环
            for (let i = 0; i < clipped.length; i++) {
                if (clipped[i] >= BOX_SEGMENT_FOREGROUND_THRESHOLD) covered[i] = 1;
            }
            covered[uncovered.y * width + uncovered.x] = 1;

            const ratio = area / Math.max(1, candidate.area);
            if (ratio < REFINE_MIN_PART_RATIO || ratio > REFINE_MAX_PART_RATIO) continue;

            this.debugLog(`[MattingService] 补点 (${uncovered.x},${uncovered.y}) 切出部件 面积=${area}`);
            parts.push({ mask: clipped, area, x1: minX, y1: minY, x2: maxX + 1, y2: maxY + 1 });
        }

        // 同一物体上的多个采样点会切出几乎相同的蒙版，按 IoU 去重，保留面积更大的那个
        parts.sort((a, b) => b.area - a.area);
        const unique: typeof parts = [];
        for (const part of parts) {
            const duplicated = unique.some(
                kept => maskIoU(kept.mask, part.mask, BOX_SEGMENT_FOREGROUND_THRESHOLD) > REFINE_DUPLICATE_IOU
            );
            if (!duplicated) unique.push(part);
        }

        this.debugLog(
            `[MattingService] 块内细分: ${points.length} 个采样点 → ${parts.length} 个有效部件 → 去重后 ${unique.length} 个`
        );

        return unique.slice(0, REFINE_MAX_PARTS);
    }

    /**
     * 按选中的候选编号取出蒙版。
     *
     * 保留原蒙版灰度而不是二值化：分割模型在物体边缘给出的过渡灰度就是抗锯齿信息，
     * 二值化会让蒙版边缘出现锯齿。
     */
    buildMaskFromCandidates(
        mask: Buffer,
        labels: Int32Array,
        width: number,
        height: number,
        selectedIds: number[],
        candidateMasks?: Map<number, Buffer>
    ): { maskBuffer: Buffer; foregroundPixels: number } {
        const output = Buffer.alloc(width * height, 0);

        // 连通域候选按 labels 取像素；SAM 细分出来的部件带自己的蒙版
        const labelIds = new Set<number>();
        for (const id of selectedIds) {
            const partMask = candidateMasks?.get(id);
            if (!partMask) {
                labelIds.add(id);
                continue;
            }
            for (let i = 0; i < output.length; i++) {
                if (partMask[i] > output[i]) output[i] = partMask[i];
            }
        }

        if (labelIds.size > 0) {
            for (let i = 0; i < output.length; i++) {
                if (!labelIds.has(labels[i])) continue;
                if (mask[i] > output[i]) output[i] = mask[i];
            }
        }

        let foregroundPixels = 0;
        for (let i = 0; i < output.length; i++) {
            if (output[i] >= BOX_SEGMENT_FOREGROUND_THRESHOLD) foregroundPixels++;
        }

        return { maskBuffer: output, foregroundPixels };
    }

    /**
     * 把蒙版缩放到 Photoshop 需要的输出尺寸并包装成标准结果。
     */
    async finalizeCandidateMask(
        maskBuffer: Buffer,
        maskWidth: number,
        maskHeight: number,
        options: {
            originalWidth?: number;
            originalHeight?: number;
            binaryMaskOutput?: boolean;
            usedModel: string;
            analysis: string;
            processingTime: number;
        }
    ): Promise<MattingResult> {
        const targetWidth = Number(options.originalWidth) > 0
            ? Math.round(Number(options.originalWidth))
            : maskWidth;
        const targetHeight = Number(options.originalHeight) > 0
            ? Math.round(Number(options.originalHeight))
            : maskHeight;

        let finalMaskBuffer: Buffer = maskBuffer;
        if (targetWidth !== maskWidth || targetHeight !== maskHeight) {
            finalMaskBuffer = await this.sharp!(maskBuffer, {
                raw: { width: maskWidth, height: maskHeight, channels: 1 }
            })
                .resize(targetWidth, targetHeight, { fit: 'fill', kernel: 'lanczos3' })
                .raw()
                .toBuffer();
        }

        const shouldReturnBinaryMask = options.binaryMaskOutput === true;
        const maskBase64 = shouldReturnBinaryMask
            ? undefined
            : `RAW_MASK:${targetWidth}:${targetHeight}:${finalMaskBuffer.toString('base64')}`;

        return {
            success: true,
            maskImage: maskBase64,
            mask: maskBase64,
            maskBuffer: shouldReturnBinaryMask ? finalMaskBuffer : undefined,
            maskWidth: targetWidth,
            maskHeight: targetHeight,
            processingTime: options.processingTime,
            usedModel: options.usedModel,
            analysis: options.analysis,
            pipeline: { mode: 'onnx' }
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

        if (segmentedBoxCount === 0) {
            return {
                success: false,
                error: `在定位到的 ${clampedBoxes.length} 个目标区域内都没能分割出内容。\n\n`
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
        if (failures.length > 0) {
            analysisParts.push(`未完成：${failures.join('；')}`);
        }

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
        const birefnetPath = path.join(this.modelsDir, 'birefnet', 'birefnet.onnx');
        const yoloWorldPath = path.join(this.modelsDir, 'yolo-world', 'yolov8s-worldv2.onnx');
        
        const birefnetExists = fs.existsSync(birefnetPath);
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
        
        // 加载 BiRefNet（必需）
        const birefnetLoaded = await this.loadBiRefNetModel();
        
        // 尝试加载 YOLO-World（可选）
        const yoloLoaded = await this.loadYoloWorldModel();
        
        if (birefnetLoaded) {
            const gpuInfo = this.gpuStatus.available 
                ? `[${this.gpuStatus.provider.toUpperCase()}]` 
                : '[CPU]';
            console.log(`[MattingService] ✅ 模型初始化完成 ${gpuInfo}: BiRefNet${yoloLoaded ? ' + YOLO-World' : ''}`);
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
        this.birefnetSession = null;
        this.birefnetSessionByTier = { full: null, lite: null };
        this.birefnetActiveTier = null;
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
        this.birefnetSession = null;
        this.birefnetSessionByTier = { full: null, lite: null };
        this.birefnetActiveTier = null;
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
