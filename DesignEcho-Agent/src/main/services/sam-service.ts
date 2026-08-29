/**
 * SAM (Segment Anything Model) 服务
 * 
 * 支持 Box Prompt 的交互式分割，用于选区抠图功能
 * 
 * 工作流程：
 * 1. Image Encoder: 将图像编码为特征向量（可缓存）
 * 2. Prompt Encoder + Mask Decoder: 根据 box/point prompt 生成蒙版
 * 
 * 模型版本：
 * - MobileSAM: 轻量级版本，~40MB，推理快
 * - SAM ViT-B: 标准版本，~375MB，精度更高
 */

import * as path from 'path';
import * as fs from 'fs';

// ==================== 类型定义 ====================

export interface SAMConfig {
    modelsDir?: string;
    modelType?: 'mobile_sam' | 'sam_vit_b' | 'sam2_large';
}

export interface BoxPrompt {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

export interface PointPrompt {
    x: number;
    y: number;
    label: 0 | 1;  // 0: 背景点, 1: 前景点
}

export interface SAMResult {
    success: boolean;
    mask?: Buffer;  // 灰度蒙版 (0-255)
    maskWidth?: number;
    maskHeight?: number;
    processingTime?: number;
    error?: string;
}

// ==================== 常量 ====================

const SAM_INPUT_SIZE = 1024;  // SAM 标准输入尺寸

/**
 * SAM 在语义抠图链路中只拥有“目标范围”，不拥有最终 alpha 边缘。
 * 官方 SAM mask threshold 是 logit > 0；负 logit 不能因为 Sigmoid 后仍大于 0
 * 就被转换成半透明前景，否则会把邻近皮肤、鞋和背景重新开放给细节模型。
 */
export function createSemanticScopeMaskFromLogits(
    logits: Float32Array,
    width: number,
    height: number
): Buffer {
    const expectedLength = width * height;
    if (!Number.isSafeInteger(width) || width <= 0
        || !Number.isSafeInteger(height) || height <= 0
        || logits.length !== expectedLength) {
        throw new Error(`SAM 语义范围尺寸无效：${width}x${height}, logits=${logits.length}`);
    }
    const mask = Buffer.alloc(expectedLength, 0);
    for (let index = 0; index < expectedLength; index++) {
        if (Number.isFinite(logits[index]) && logits[index] > 0) mask[index] = 255;
    }
    return mask;
}

export function resolveDecoderMaskCandidateCount(outputMetadata: unknown): number {
    const entries = Array.isArray(outputMetadata)
        ? outputMetadata
        : Object.entries(outputMetadata && typeof outputMetadata === 'object' ? outputMetadata : {})
            .map(([name, metadata]) => ({ ...(metadata as Record<string, unknown>), name }));
    const iouOutput = entries.find((entry: any) => String(entry?.name || '').includes('iou'));
    const shape = Array.isArray(iouOutput?.shape) ? iouOutput.shape : [];
    const candidateCount = shape.length > 0 ? Number(shape[shape.length - 1]) : 0;
    return Number.isSafeInteger(candidateCount) && candidateCount > 0 ? candidateCount : 0;
}

// ==================== SAM 服务类 ====================

export class SAMService {
    private modelsDir: string;
    private modelType: 'mobile_sam' | 'sam_vit_b' | 'sam2_large';
    
    // ONNX Runtime 和 Sharp
    private ort: any = null;
    private sharp: any = null;
    
    // SAM 模型 Sessions
    private encoderSession: any = null;
    /**
     * 静音深度：批量撒点时抑制逐点日志。
     * 用计数而不是布尔——两个批量调用交叠时，先结束的那个会把布尔提前置回，
     * 让后一个的日志重新刷屏。
     */
    private quietDepth: number = 0;
    private decoderSession: any = null;
    private decoderMaskCandidateCount: number = 0;
    
    // 图像嵌入缓存（同一图像多次选区可复用）
    private imageEmbeddingCache: Map<string, {
        embedding: any;
        originalWidth: number;
        originalHeight: number;
        /** 原图坐标 → encoder 输入坐标的缩放系数，prompt 坐标必须用同一个值 */
        promptScale: number;
        timestamp: number;
    }> = new Map();
    
    // 缓存过期时间（5分钟）
    private readonly CACHE_EXPIRY_MS = 5 * 60 * 1000;
    /**
     * 缓存条数上限。语义抠图会为每个目标区域各算一份嵌入，
     * MobileSAM 单份约 4MB，只靠 5 分钟过期回收，连续抠图时会堆到几百 MB。
     */
    private readonly MAX_CACHE_ENTRIES = 6;
    private cacheCleanupTimer: NodeJS.Timeout | null = null;
    
    constructor(config: SAMConfig = {}) {
        this.modelsDir = config.modelsDir || path.join(process.cwd(), 'models');
        
        // 自动检测最佳可用模型
        if (config.modelType) {
            this.modelType = config.modelType;
        } else {
            // 优先使用 SAM2.1-Large（如果可用）
            const sam2EncoderPath = path.join(this.modelsDir, 'sam2', 'vision_encoder_fp16.onnx');
            const sam2DecoderPath = path.join(this.modelsDir, 'sam2', 'prompt_encoder_mask_decoder_fp16.onnx');
            
            if (fs.existsSync(sam2EncoderPath) && fs.existsSync(sam2DecoderPath)) {
                this.modelType = 'sam2_large';
                console.log('[SAMService] 检测到 SAM2.1-Large 模型，优先使用');
            } else {
                this.modelType = 'mobile_sam';
            }
        }
    }
    
    /**
     * 初始化 SAM 服务
     */
    async initialize(): Promise<boolean> {
        try {
            // 动态导入依赖
            this.ort = require('onnxruntime-node');
            this.sharp = require('sharp');
            
            // 检查模型文件
            const encoderPath = this.getEncoderPath();
            const decoderPath = this.getDecoderPath();
            
            if (!fs.existsSync(encoderPath)) {
                console.log(`[SAMService] Encoder 模型不存在: ${encoderPath}`);
                return false;
            }
            
            if (!fs.existsSync(decoderPath)) {
                console.log(`[SAMService] Decoder 模型不存在: ${decoderPath}`);
                return false;
            }
            
            console.log('[SAMService] 正在加载 SAM 模型...');
            
            // 加载 Encoder
            const encoderStart = Date.now();
            this.encoderSession = await this.ort.InferenceSession.create(encoderPath, {
                executionProviders: ['cpu'],
                graphOptimizationLevel: 'all',
                logSeverityLevel: 3  // 抑制警告，只显示错误
            });
            console.log(`[SAMService] ✅ Encoder 加载完成 (${Date.now() - encoderStart}ms)`);
            
            // 加载 Decoder
            const decoderStart = Date.now();
            this.decoderSession = await this.ort.InferenceSession.create(decoderPath, {
                executionProviders: ['cpu'],
                graphOptimizationLevel: 'all',
                logSeverityLevel: 3  // 抑制警告，只显示错误
            });
            console.log(`[SAMService] ✅ Decoder 加载完成 (${Date.now() - decoderStart}ms)`);

            if (this.modelType === 'mobile_sam') {
                this.decoderMaskCandidateCount = resolveDecoderMaskCandidateCount(
                    this.decoderSession.outputMetadata
                );
                if (this.decoderMaskCandidateCount < 4) {
                    console.error(
                        `[SAMService] MobileSAM Decoder 只有 ${this.decoderMaskCandidateCount || '未知'} 个候选，`
                        + '语义范围需要配套的 4 候选 decoder。'
                    );
                    await this.disposeSessions();
                    return false;
                }
            }
            
            // 启动缓存清理定时器
            this.startCacheCleanup();
            
            const modelName = this.modelType === 'sam2_large' ? 'SAM2.1-Large' : 
                             this.modelType === 'mobile_sam' ? 'MobileSAM' : 'SAM ViT-B';
            console.log(`[SAMService] ✅ SAM 服务初始化完成，使用 ${modelName}`);
            return true;
            
        } catch (error: any) {
            console.error('[SAMService] 初始化失败:', error.message);
            return false;
        }
    }
    
    /**
     * 检查模型是否已加载
     */
    isReady(): boolean {
        return this.encoderSession !== null && this.decoderSession !== null;
    }
    
    /**
     * 检查模型文件是否存在
     */
    checkModelsExist(): { encoder: boolean; decoder: boolean } {
        return {
            encoder: fs.existsSync(this.getEncoderPath()),
            decoder: fs.existsSync(this.getDecoderPath())
        };
    }
    
    /**
     * 使用 Box Prompt 进行分割
     * 
     * @param imageBuffer - 输入图像 (PNG/JPEG Buffer)
     * @param box - 边界框提示 [x1, y1, x2, y2]
     * @param guidancePoints - 可选的前景/背景点提示；单点形状为历史兼容，多点用于 Agent 视觉引导
     */
    async segmentWithBox(
        imageBuffer: Buffer,
        box: BoxPrompt,
        guidancePoints?: PointPrompt | PointPrompt[]
    ): Promise<SAMResult> {
        if (!this.isReady()) {
            return { success: false, error: 'SAM 模型未加载' };
        }
        
        const startTime = Date.now();
        
        try {
            // 1. 获取图像元数据
            const metadata = await this.sharp(imageBuffer).metadata();
            const originalWidth = metadata.width!;
            const originalHeight = metadata.height!;
            
            console.log(`[SAMService] 输入图像: ${originalWidth}x${originalHeight}`);
            console.log(`[SAMService] Box Prompt: (${box.x1}, ${box.y1}) - (${box.x2}, ${box.y2})`);
            
            // 2. 生成图像哈希用于缓存
            const imageHash = this.hashBuffer(imageBuffer);
            
            // 3. 获取或计算图像嵌入（encoderOutputs 包含 image_embeddings 和 image_positional_embeddings）
            let encoderOutputs: Record<string, any>;
            let promptScale: number;
            const cached = this.imageEmbeddingCache.get(imageHash);

            if (cached && Date.now() - cached.timestamp < this.CACHE_EXPIRY_MS) {
                console.log('[SAMService] 使用缓存的图像嵌入');
                encoderOutputs = cached.embedding;
                promptScale = cached.promptScale;
            } else {
                console.log('[SAMService] 计算图像嵌入...');
                const encodeStart = Date.now();
                const encoded = await this.encodeImage(imageBuffer, originalWidth, originalHeight);
                encoderOutputs = encoded.outputs;
                promptScale = encoded.promptScale;
                console.log(`[SAMService] 图像嵌入完成 (${Date.now() - encodeStart}ms)`);

                // 缓存嵌入
                this.rememberEmbedding(imageHash, encoderOutputs, originalWidth, originalHeight, promptScale);
            }

            // 4. 准备 Prompt 输入
            const prompts = this.preparePrompts(box, guidancePoints, originalWidth, originalHeight, promptScale);
            
            // 5. 运行 Decoder
            console.log('[SAMService] 运行 Mask Decoder...');
            const decodeStart = Date.now();
            const maskData = await this.decodeMask(encoderOutputs, prompts, originalWidth, originalHeight);
            console.log(`[SAMService] Decoder 完成 (${Date.now() - decodeStart}ms)`);
            
            const processingTime = Date.now() - startTime;
            console.log(`[SAMService] 总处理时间: ${processingTime}ms`);
            
            return {
                success: true,
                mask: maskData.mask,
                maskWidth: originalWidth,
                maskHeight: originalHeight,
                processingTime
            };
            
        } catch (error: any) {
            console.error('[SAMService] 分割失败:', error.message);
            return { success: false, error: error.message };
        }
    }
    
    /** 受 quiet 控制的日志：批量撒点时不逐点刷屏 */
    private log(...args: unknown[]): void {
        if (this.quietDepth > 0) return;
        console.log(...(args as []));
    }

    /**
     * 批量点分割：同一张图上多个前景点，各自分割出所在物体。
     *
     * 用途：连通域拆不开相互接触的物体（模特腿部特写里腿、袜、鞋连成一块），
     * 撒点让 SAM 在块内部把它们切开。图像嵌入只算一次，之后每个点约 100ms。
     *
     * 逐点日志会刷屏，这里整体静音，只在结束时汇报一次。
     */
    async segmentWithPoints(
        imageBuffer: Buffer,
        points: Array<{ x: number; y: number }>
    ): Promise<Array<{ point: { x: number; y: number }; mask: Buffer } | null>> {
        if (!this.isReady() || points.length === 0) return [];

        const startTime = Date.now();
        const metadata = await this.sharp(imageBuffer).metadata();
        const originalWidth = metadata.width as number;
        const originalHeight = metadata.height as number;

        const imageHash = this.hashBuffer(imageBuffer);
        let encoderOutputs: Record<string, any>;
        let promptScale: number;
        const cached = this.imageEmbeddingCache.get(imageHash);

        if (cached && Date.now() - cached.timestamp < this.CACHE_EXPIRY_MS) {
            encoderOutputs = cached.embedding;
            promptScale = cached.promptScale;
        } else {
            const encoded = await this.encodeImage(imageBuffer, originalWidth, originalHeight);
            encoderOutputs = encoded.outputs;
            promptScale = encoded.promptScale;
            this.rememberEmbedding(imageHash, encoderOutputs, originalWidth, originalHeight, promptScale);
        }

        this.quietDepth++;
        const results: Array<{ point: { x: number; y: number }; mask: Buffer } | null> = [];

        try {
            for (const point of points) {
                const prompts = {
                    pointCoords: new Float32Array([point.x * promptScale, point.y * promptScale]),
                    pointLabels: new Float32Array([1]),
                    origImSize: new Float32Array([originalHeight, originalWidth])
                };

                const decoded = await this.decodeMask(encoderOutputs, prompts, originalWidth, originalHeight)
                    .catch((e: any) => {
                        console.error(`[SAMService] 点 (${point.x},${point.y}) 分割失败: ${e.message}`);
                        return null;
                    });

                results.push(decoded ? { point, mask: decoded.mask } : null);
            }
        } finally {
            this.quietDepth = Math.max(0, this.quietDepth - 1);
        }

        const succeeded = results.filter(Boolean).length;
        console.log(
            `[SAMService] 撒点分割完成: ${succeeded}/${points.length} 个点 (${Date.now() - startTime}ms)`
        );
        return results;
    }

    /**
     * 编码图像为特征向量
     * SlimSAM encoder 输出: image_embeddings, image_positional_embeddings
     */
    private async encodeImage(
        imageBuffer: Buffer,
        originalWidth: number,
        originalHeight: number
    ): Promise<{ outputs: Record<string, any>; promptScale: number }> {
        const inputNames = this.encoderSession.inputNames;
        this.log('[SAMService] Encoder 输入名称:', inputNames);

        // SAM 官方约定：按长边缩放到 1024（保持比例），右/下补零到 1024x1024。
        // decoder 的输出裁剪正是按这个约定反推有效区域的，换成拉伸填充会让蒙版映射错位。
        const promptScale = SAM_INPUT_SIZE / Math.max(originalWidth, originalHeight);
        const scaledWidth = Math.round(originalWidth * promptScale);
        const scaledHeight = Math.round(originalHeight * promptScale);

        const resizedBuffer = await this.sharp(imageBuffer)
            .resize(scaledWidth, scaledHeight, { fit: 'fill', kernel: 'lanczos3' })
            .removeAlpha()
            .raw()
            .toBuffer();

        const feeds: Record<string, any> = {};

        if (this.encoderExpectsHwcRawPixels()) {
            // mobile_sam_encoder.onnx：输入 [1024, 1024, 3]，接收 0-255 原始像素
            // （归一化烘焙在计算图内部）。实测：喂 ImageNet 0-1 归一化会让蒙版溢出目标框。
            const inputTensor = new Float32Array(SAM_INPUT_SIZE * SAM_INPUT_SIZE * 3);
            for (let y = 0; y < scaledHeight; y++) {
                const srcRow = y * scaledWidth * 3;
                const dstRow = y * SAM_INPUT_SIZE * 3;
                for (let x = 0; x < scaledWidth; x++) {
                    const src = srcRow + x * 3;
                    const dst = dstRow + x * 3;
                    inputTensor[dst] = resizedBuffer[src];
                    inputTensor[dst + 1] = resizedBuffer[src + 1];
                    inputTensor[dst + 2] = resizedBuffer[src + 2];
                }
            }
            feeds[inputNames[0]] = new this.ort.Tensor(
                'float32',
                inputTensor,
                [SAM_INPUT_SIZE, SAM_INPUT_SIZE, 3]
            );
        } else {
            // 其它导出（SAM2 / ViT-B）：[1, 3, 1024, 1024] + ImageNet 归一化。
            // 本机没有这些模型文件，此分支保持原有实现，未经实测。
            const mean = [0.485, 0.456, 0.406];
            const std = [0.229, 0.224, 0.225];
            const plane = SAM_INPUT_SIZE * SAM_INPUT_SIZE;
            const inputTensor = new Float32Array(3 * plane);

            for (let y = 0; y < scaledHeight; y++) {
                for (let x = 0; x < scaledWidth; x++) {
                    const src = (y * scaledWidth + x) * 3;
                    const dst = y * SAM_INPUT_SIZE + x;
                    inputTensor[dst] = (resizedBuffer[src] / 255 - mean[0]) / std[0];
                    inputTensor[plane + dst] = (resizedBuffer[src + 1] / 255 - mean[1]) / std[1];
                    inputTensor[2 * plane + dst] = (resizedBuffer[src + 2] / 255 - mean[2]) / std[2];
                }
            }
            feeds[inputNames[0]] = new this.ort.Tensor(
                'float32',
                inputTensor,
                [1, 3, SAM_INPUT_SIZE, SAM_INPUT_SIZE]
            );
        }

        const results = await this.encoderSession.run(feeds);

        const outputNames = this.encoderSession.outputNames;
        this.log('[SAMService] Encoder 输出名称:', outputNames);

        // 返回所有 encoder 输出（SlimSAM 有 image_embeddings 和 image_positional_embeddings）
        return { outputs: results, promptScale };
    }

    /**
     * encoder 是否是 [1024, 1024, 3] 原始像素输入的导出。
     *
     * 依据实测：本机 mobile_sam_encoder.onnx 的 input_image 是 rank 3 的 HWC，
     * 喂 rank 4 会被 ONNX Runtime 以 "Invalid rank for input" 直接拒绝。
     * SAM2 / ViT-B 导出是 rank 4，但本机没有模型文件，未经实测。
     * 形状判断错了会在推理时立即报错，不会静默产出错误蒙版。
     */
    private encoderExpectsHwcRawPixels(): boolean {
        return this.modelType === 'mobile_sam';
    }
    
    /**
     * 准备 Prompt 输入
     */
    private preparePrompts(
        box: BoxPrompt,
        guidancePoints: PointPrompt | PointPrompt[] | undefined,
        originalWidth: number,
        originalHeight: number,
        promptScale: number
    ): {
        pointCoords: Float32Array;
        pointLabels: Float32Array;
        origImSize: Float32Array;
    } {
        // 与 encodeImage 同一个缩放系数：图像按长边等比缩放后补零，x/y 不能各缩各的，
        // 否则 prompt 点会落在与图像内容错位的位置上。
        const scaleX = promptScale;
        const scaleY = promptScale;

        // Box Prompt: 转换为两个点（左上角和右下角）
        const boxPoints = [
            box.x1 * scaleX,
            box.y1 * scaleY,
            box.x2 * scaleX,
            box.y2 * scaleY
        ];
        
        const pointCoords: number[] = [...boxPoints];
        // SAM box prompt 标签: 2=左上角, 3=右下角
        // 这是 SAM 官方的 box prompt 编码
        const pointLabels: number[] = [2, 3];
        
        let normalizedGuidance: PointPrompt[] = [];
        if (Array.isArray(guidancePoints)) {
            normalizedGuidance = guidancePoints;
        } else if (guidancePoints) {
            normalizedGuidance = [guidancePoints];
        }
        for (const point of normalizedGuidance) {
            if (!Number.isFinite(point.x) || !Number.isFinite(point.y)
                || (point.label !== 0 && point.label !== 1)) {
                throw new Error('SAM 正负点引导包含无效坐标或标签。');
            }
            pointCoords.push(point.x * scaleX, point.y * scaleY);
            pointLabels.push(point.label);
        }

        console.log(`[SAMService] Box 坐标 (缩放后): [${boxPoints.map(v => v.toFixed(1)).join(', ')}]`);
        console.log(`[SAMService] Prompt 标签: [${pointLabels.join(', ')}]`);
        
        return {
            pointCoords: new Float32Array(pointCoords),
            pointLabels: new Float32Array(pointLabels),
            origImSize: new Float32Array([originalHeight, originalWidth])
        };
    }
    
    /**
     * 运行 Mask Decoder
     * SlimSAM decoder 输入: input_points, input_labels, image_embeddings, image_positional_embeddings
     */
    private async decodeMask(
        encoderOutputs: Record<string, any>,
        prompts: {
            pointCoords: Float32Array;
            pointLabels: Float32Array;
            origImSize: Float32Array;
        },
        originalWidth: number,
        originalHeight: number
    ): Promise<{ mask: Buffer }> {
        const numPoints = prompts.pointCoords.length / 2;
        
        // 准备 Decoder 输入
        const feeds: Record<string, any> = {};
        const inputNames = this.decoderSession.inputNames;
        
        this.log('[SAMService] Decoder 输入名称:', inputNames);
        
        // 根据模型类型构建不同的输入:
        // SAM2.1: input_boxes (边界框直接输入)
        // MobileSAM/SlimSAM: input_points + input_labels
        const isSAM2 = this.modelType === 'sam2_large';
        
        this.log('[SAMService] 使用模型类型:', this.modelType, 'isSAM2:', isSAM2);
        
        for (const name of inputNames) {
            // SAM2.1 边界框输入: input_boxes [1, num_boxes, 4]
            if (name === 'input_boxes') {
                // prompts.pointCoords 包含 box 的两个点: [x1, y1, x2, y2]
                // SAM2 需要 [x1, y1, x2, y2] 格式
                const boxData = new Float32Array(4);
                boxData[0] = prompts.pointCoords[0];  // x1
                boxData[1] = prompts.pointCoords[1];  // y1
                boxData[2] = prompts.pointCoords[2];  // x2
                boxData[3] = prompts.pointCoords[3];  // y2
                
                feeds[name] = new this.ort.Tensor(
                    'float32',
                    boxData,
                    [1, 1, 4]  // [batch, num_boxes, 4]
                );
                this.log('[SAMService] input_boxes:', Array.from(boxData));
            }
            // 点坐标输入 (SlimSAM: input_points 需要4维)
            else if (name === 'input_points') {
                feeds[name] = new this.ort.Tensor(
                    'float32',
                    prompts.pointCoords,
                    [1, 1, numPoints, 2]  // SlimSAM 需要 4 维
                );
            }
            // MobileSAM 兼容: point_coords 使用 3 维
            else if (name.includes('point_coord') || name === 'point_coords') {
                feeds[name] = new this.ort.Tensor(
                    'float32',
                    prompts.pointCoords,
                    [1, numPoints, 2]
                );
            }
            // 点标签输入 (SlimSAM: input_labels 需要3维, int64类型)
            else if (name === 'input_labels') {
                // 转换为 BigInt64Array
                const labelsInt64 = new BigInt64Array(prompts.pointLabels.length);
                for (let i = 0; i < prompts.pointLabels.length; i++) {
                    labelsInt64[i] = BigInt(Math.round(prompts.pointLabels[i]));
                }
                feeds[name] = new this.ort.Tensor(
                    'int64',
                    labelsInt64,
                    [1, 1, numPoints]  // SlimSAM 需要 3 维
                );
            }
            // MobileSAM 兼容: point_labels 使用 2 维, float32
            else if (name.includes('point_label') || name === 'point_labels') {
                feeds[name] = new this.ort.Tensor(
                    'float32',
                    prompts.pointLabels,
                    [1, numPoints]
                );
            }
            // SAM2.1 图像嵌入: 精确匹配 image_embeddings.0, .1, .2
            else if (name.startsWith('image_embeddings')) {
                if (encoderOutputs[name]) {
                    feeds[name] = encoderOutputs[name];
                }
            }
            // 位置嵌入 (SlimSAM/MobileSAM 特有)
            else if (name === 'image_positional_embeddings' || name.includes('positional')) {
                const posKey = Object.keys(encoderOutputs).find(k => 
                    k === 'image_positional_embeddings' || k.includes('positional')
                );
                if (posKey) {
                    feeds[name] = encoderOutputs[posKey];
                }
            }
            // 原始图像尺寸
            else if (name.includes('orig_im_size')) {
                feeds[name] = new this.ort.Tensor(
                    'float32',
                    prompts.origImSize,
                    [2]
                );
            }
            // 蒙版输入标志
            else if (name.includes('has_mask') || name === 'has_mask_input') {
                feeds[name] = new this.ort.Tensor('float32', new Float32Array([0]), [1]);
            }
            // 空蒙版输入
            else if (name.includes('mask_input')) {
                feeds[name] = new this.ort.Tensor(
                    'float32',
                    new Float32Array(256 * 256).fill(0),
                    [1, 1, 256, 256]
                );
            }
            // SAM2.1 特有输入: high_res_feats_0, high_res_feats_1 等
            else if (name.startsWith('high_res_feats')) {
                if (encoderOutputs[name]) {
                    feeds[name] = encoderOutputs[name];
                }
            }
            // 通用: 尝试直接从 encoder 输出匹配同名输入
            else if (encoderOutputs[name]) {
                feeds[name] = encoderOutputs[name];
            }
        }
        
        // 检查是否有未提供的必需输入
        const missingInputs = inputNames.filter(n => !feeds[n]);
        if (missingInputs.length > 0) {
            this.log('[SAMService] 警告: 未匹配的输入:', missingInputs);
            this.log('[SAMService] Encoder 输出键:', Object.keys(encoderOutputs));
        }
        
        this.log('[SAMService] Decoder feeds 包含的输入:', Object.keys(feeds));
        
        // 运行 Decoder
        const results = await this.decoderSession.run(feeds);
        
        const outputNames = this.decoderSession.outputNames;
        this.log('[SAMService] Decoder 输出名称:', outputNames);
        
        // 获取蒙版输出和 IoU 分数
        let maskOutput: any = null;
        let iouScores: any = null;
        
        // 输出名优先级：masks / pred_masks 是原图尺寸的成品蒙版，low_res_masks 是 256x256 中间量。
        // 不能用 includes('mask') 一路覆盖——遍历到最后会被 low_res_masks 顶掉，
        // 拿到低分辨率蒙版再放大，边缘精度白白损失。
        const preferredMaskName = outputNames.find((name: string) => name === 'masks' || name === 'pred_masks')
            || outputNames.find((name: string) => name.includes('mask') && !name.includes('low_res'))
            || outputNames.find((name: string) => name.includes('mask'));

        if (preferredMaskName) {
            maskOutput = results[preferredMaskName];
            this.log(`[SAMService] 选用蒙版输出: ${preferredMaskName}`);
        }

        const iouName = outputNames.find((name: string) => name.includes('iou') || name === 'iou_scores');
        if (iouName) {
            iouScores = results[iouName];
        }
        
        if (!maskOutput) {
            throw new Error('未找到蒙版输出');
        }
        
        const maskData = maskOutput.data as Float32Array;
        const maskDims = maskOutput.dims;
        
        this.log('[SAMService] 蒙版输出形状:', maskDims);
        
        // SlimSAM 输出形状: [1, 1, 3, 256, 256] (batch, query, num_masks, H, W)
        const maskH = maskDims[maskDims.length - 2];
        const maskW = maskDims[maskDims.length - 1];
        const singleMaskSize = maskH * maskW;
        const numMasks = maskDims.length >= 3 ? maskDims[maskDims.length - 3] : 1;
        
        // 选择最佳蒙版：使用 IoU 分数或默认第二个（通常效果最好）
        let bestMaskIndex = 1;  // 默认使用第二个蒙版（根据官方示例）
        
        if (iouScores) {
            const scores = iouScores.data as Float32Array;
            this.log('[SAMService] IoU 分数:', Array.from(scores));
            
            // 找到最高分的蒙版
            let maxScore = -Infinity;
            for (let i = 0; i < Math.min(numMasks, scores.length); i++) {
                if (scores[i] > maxScore) {
                    maxScore = scores[i];
                    bestMaskIndex = i;
                }
            }
            this.log(`[SAMService] 选择蒙版 ${bestMaskIndex}，IoU=${maxScore.toFixed(4)}`);
        }
        
        // 计算最佳蒙版的偏移量
        const maskOffset = bestMaskIndex * singleMaskSize;
        
        this.log(`[SAMService] 提取蒙版: 尺寸=${maskW}x${maskH}, 索引=${bestMaskIndex}, 偏移=${maskOffset}`);
        
        // 记录原始 logits 范围
        let minLogit = Infinity, maxLogit = -Infinity;
        for (let i = 0; i < singleMaskSize; i++) {
            const logit = maskData[maskOffset + i];
            minLogit = Math.min(minLogit, logit);
            maxLogit = Math.max(maxLogit, logit);
        }
        this.log(`[SAMService] 原始蒙版 logits 范围: min=${minLogit.toFixed(2)}, max=${maxLogit.toFixed(2)}`);
        
        const selectedLogits = maskData.subarray(maskOffset, maskOffset + singleMaskSize);
        let upscaledLogits: Float32Array;
        if (maskW === originalWidth && maskH === originalHeight) {
            // 官方 ONNX 的 masks 已按 orig_im_size 输出；同尺寸再次双三次插值只会浪费时间。
            upscaledLogits = selectedLogits;
            this.log('[SAMService] 蒙版已是目标尺寸，跳过重复插值');
        } else {
            this.log(
                `[SAMService] 在 Logits 空间放大蒙版（双三次插值）: `
                + `${maskW}x${maskH} -> ${originalWidth}x${originalHeight}`
            );
            upscaledLogits = new Float32Array(originalWidth * originalHeight);
            const scaleX = maskW / originalWidth;
            const scaleY = maskH / originalHeight;

            function cubicWeight(t: number): number {
                const a = -0.5;
                const absT = Math.abs(t);
                if (absT <= 1) {
                    return (a + 2) * absT * absT * absT - (a + 3) * absT * absT + 1;
                }
                if (absT < 2) {
                    return a * absT * absT * absT - 5 * a * absT * absT + 8 * a * absT - 4 * a;
                }
                return 0;
            }

            const getLogit = (x: number, y: number): number => {
                const cx = Math.max(0, Math.min(maskW - 1, x));
                const cy = Math.max(0, Math.min(maskH - 1, y));
                return maskData[maskOffset + cy * maskW + cx];
            };

            for (let dstY = 0; dstY < originalHeight; dstY++) {
                for (let dstX = 0; dstX < originalWidth; dstX++) {
                    const srcX = dstX * scaleX;
                    const srcY = dstY * scaleY;
                    const intX = Math.floor(srcX);
                    const intY = Math.floor(srcY);
                    const fracX = srcX - intX;
                    const fracY = srcY - intY;
                    let sum = 0;
                    let weightSum = 0;

                    for (let j = -1; j <= 2; j++) {
                        for (let i = -1; i <= 2; i++) {
                            const weight = cubicWeight(fracX - i) * cubicWeight(fracY - j);
                            sum += getLogit(intX + i, intY + j) * weight;
                            weightSum += weight;
                        }
                    }
                    upscaledLogits[dstY * originalWidth + dstX] = sum / weightSum;
                }
            }
        }
        
        // SAM 只签语义范围；最终 alpha 由 MattingService 的细节 Provider 负责。
        // 使用官方 logit > 0 边界，不能把负置信区域改造成半透明前景。
        const finalMask = createSemanticScopeMaskFromLogits(
            upscaledLogits,
            originalWidth,
            originalHeight
        );
        this.log('[SAMService] 已按官方零阈值生成二值语义范围');
        return { mask: finalMask };
    }
    
    /**
     * 计算 Buffer 哈希（用于缓存键）
     */
    private hashBuffer(buffer: Buffer): string {
        const crypto = require('crypto');
        return crypto.createHash('md5').update(buffer).digest('hex');
    }
    
    /**
     * 启动缓存清理定时器
     */
    /** 写入嵌入缓存，超出条数上限时淘汰最旧的一条 */
    private rememberEmbedding(
        imageHash: string,
        embedding: any,
        originalWidth: number,
        originalHeight: number,
        promptScale: number
    ): void {
        this.imageEmbeddingCache.set(imageHash, {
            embedding,
            originalWidth,
            originalHeight,
            promptScale,
            timestamp: Date.now()
        });

        while (this.imageEmbeddingCache.size > this.MAX_CACHE_ENTRIES) {
            let oldestKey: string | null = null;
            let oldestAt = Infinity;
            for (const [key, value] of this.imageEmbeddingCache) {
                if (value.timestamp < oldestAt) {
                    oldestAt = value.timestamp;
                    oldestKey = key;
                }
            }
            if (!oldestKey) break;
            this.imageEmbeddingCache.delete(oldestKey);
        }
    }

    private startCacheCleanup(): void {
        if (this.cacheCleanupTimer) clearInterval(this.cacheCleanupTimer);
        this.cacheCleanupTimer = setInterval(() => {
            const now = Date.now();
            for (const [key, value] of this.imageEmbeddingCache) {
                if (now - value.timestamp > this.CACHE_EXPIRY_MS) {
                    this.imageEmbeddingCache.delete(key);
                    console.log('[SAMService] 清理过期缓存');
                }
            }
        }, 60 * 1000);
        this.cacheCleanupTimer.unref?.();
    }
    
    /**
     * 获取 Encoder 模型路径
     */
    private getEncoderPath(): string {
        if (this.modelType === 'sam2_large') {
            return path.join(this.modelsDir, 'sam2', 'vision_encoder_fp16.onnx');
        }
        const modelName = this.modelType === 'mobile_sam' 
            ? 'mobile_sam_image_encoder.onnx'
            : 'sam_vit_b_encoder.onnx';
        return path.join(this.modelsDir, 'sam', modelName);
    }
    
    /**
     * 获取 Decoder 模型路径
     */
    private getDecoderPath(): string {
        if (this.modelType === 'sam2_large') {
            return path.join(this.modelsDir, 'sam2', 'prompt_encoder_mask_decoder_fp16.onnx');
        }
        const modelName = this.modelType === 'mobile_sam'
            ? 'sam_mask_decoder_multi.onnx'
            : 'sam_vit_b_decoder.onnx';
        return path.join(this.modelsDir, 'sam', modelName);
    }
    
    /**
     * 获取当前使用的模型类型
     */
    getModelType(): string {
        return this.modelType;
    }
    
    /**
     * 清理资源
     */
    async dispose(): Promise<void> {
        if (this.cacheCleanupTimer) {
            clearInterval(this.cacheCleanupTimer);
            this.cacheCleanupTimer = null;
        }
        this.imageEmbeddingCache.clear();
        await this.disposeSessions();
        console.log('[SAMService] 资源已清理');
    }

    private async disposeSessions(): Promise<void> {
        const sessions = Array.from(new Set([
            this.encoderSession,
            this.decoderSession
        ].filter(Boolean)));
        this.encoderSession = null;
        this.decoderSession = null;
        this.decoderMaskCandidateCount = 0;
        await Promise.all(sessions.map(async (session) => {
            if (typeof session.release === 'function') await session.release();
        }));
    }
}

// 单例
let samServiceInstance: SAMService | null = null;

export function getSAMService(config?: SAMConfig): SAMService {
    if (!samServiceInstance) {
        samServiceInstance = new SAMService(config);
    }
    return samServiceInstance;
}
