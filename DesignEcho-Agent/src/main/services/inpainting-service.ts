/**
 * 局部重绘服务 (Inpainting Service)
 * 
 * 功能：
 * - 用户选区 + 文本描述 → AI 重绘
 * - 支持云服务（OpenAI DALL-E, Stability AI）
 * - 支持本地模型（LaMa ONNX）
 * 
 * 流程：
 * 1. 预处理：Mask 膨胀 + 边缘羽化
 * 2. 调用 AI 模型生成新内容
 * 3. 后处理：色调匹配 + 边缘融合
 */

import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import OpenAI from 'openai';

export interface InpaintingRequest {
    image: string;          // Base64 原图
    mask: string;           // Base64 蒙版（白色=重绘区域）
    prompt: string;         // 用户描述
    negativePrompt?: string; // 负面描述
    mode?: 'cloud' | 'local'; // 使用模式
    provider?: 'openai' | 'stability' | 'lama'; // 具体服务商
    strength?: number;      // 重绘强度 (0-1)
}

export interface InpaintingResult {
    success: boolean;
    image?: string;         // Base64 重绘结果
    error?: string;
    processingTime?: number;
    provider?: string;
}

interface InpaintingConfig {
    openaiApiKey?: string;
    stabilityApiKey?: string;
    modelsDir: string;
}

export class InpaintingService {
    private config: InpaintingConfig;
    private sharp: any = null;
    private ort: any = null;
    private lamaSession: any = null;
    private initialized = false;

    constructor(config?: Partial<InpaintingConfig>) {
        this.config = {
            modelsDir: path.join(app.getPath('userData'), 'models'),
            ...config
        };
        console.log('[InpaintingService] 初始化，模型目录:', this.config.modelsDir);
    }

    /**
     * 更新配置
     */
    updateConfig(config: Partial<InpaintingConfig>): void {
        this.config = { ...this.config, ...config };
        console.log('[InpaintingService] 配置已更新');
    }

    /**
     * 确保依赖已加载
     */
    private async ensureInitialized(): Promise<boolean> {
        if (this.initialized) return true;

        try {
            this.sharp = require('sharp');
            this.ort = require('onnxruntime-node');
            this.initialized = true;
            console.log('[InpaintingService] 依赖加载成功');
            return true;
        } catch (error: any) {
            console.error('[InpaintingService] 依赖加载失败:', error.message);
            return false;
        }
    }

    /**
     * 主入口：执行局部重绘
     */
    async inpaint(request: InpaintingRequest): Promise<InpaintingResult> {
        const startTime = Date.now();
        console.log('[InpaintingService] ======== 开始局部重绘 ========');
        console.log('[InpaintingService] Prompt:', request.prompt);
        console.log('[InpaintingService] Mode:', request.mode || 'cloud');
        console.log('[InpaintingService] Provider:', request.provider || 'openai');

        try {
            if (!await this.ensureInitialized()) {
                return { success: false, error: '服务初始化失败' };
            }

            // 预处理 Mask
            const { processedMask, roi } = await this.preprocessMask(
                request.mask,
                request.image
            );

            let result: InpaintingResult;

            // 选择处理模式
            const mode = request.mode || 'cloud';
            const provider = request.provider || 'openai';

            if (mode === 'cloud') {
                switch (provider) {
                    case 'openai':
                        result = await this.inpaintWithOpenAI(request.image, processedMask, request.prompt);
                        break;
                    case 'stability':
                        result = await this.inpaintWithStability(request.image, processedMask, request.prompt);
                        break;
                    default:
                        result = await this.inpaintWithOpenAI(request.image, processedMask, request.prompt);
                }
            } else {
                // 本地模型
                result = await this.inpaintWithLaMa(request.image, processedMask);
            }

            if (result.success && result.image) {
                // 后处理：边缘融合
                result.image = await this.postprocess(
                    request.image,
                    result.image,
                    processedMask
                );
            }

            result.processingTime = Date.now() - startTime;
            result.provider = provider;

            console.log(`[InpaintingService] ======== 重绘完成 (${result.processingTime}ms) ========`);
            return result;

        } catch (error: any) {
            console.error('[InpaintingService] 重绘失败:', error.message);
            return {
                success: false,
                error: error.message,
                processingTime: Date.now() - startTime
            };
        }
    }

    /**
     * 预处理 Mask：膨胀 + 羽化
     */
    private async preprocessMask(
        maskBase64: string,
        imageBase64: string
    ): Promise<{ processedMask: string; roi: { x: number; y: number; width: number; height: number } }> {
        console.log('[InpaintingService] 预处理 Mask...');

        // 解码 mask
        const maskBuffer = Buffer.from(maskBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        const metadata = await this.sharp(maskBuffer).metadata();
        const width = metadata.width!;
        const height = metadata.height!;

        // 转换为 raw 数据
        const rawMask = await this.sharp(maskBuffer)
            .grayscale()
            .raw()
            .toBuffer();

        const maskData = new Uint8Array(rawMask);

        // 第一步：膨胀 5 像素
        const DILATE_RADIUS = 5;
        const dilatedMask = new Uint8Array(width * height);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                let isWhite = false;

                for (let dy = -DILATE_RADIUS; dy <= DILATE_RADIUS && !isWhite; dy++) {
                    for (let dx = -DILATE_RADIUS; dx <= DILATE_RADIUS && !isWhite; dx++) {
                        if (dx * dx + dy * dy <= DILATE_RADIUS * DILATE_RADIUS) {
                            const ny = y + dy, nx = x + dx;
                            if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
                                if (maskData[ny * width + nx] > 127) {
                                    isWhite = true;
                                }
                            }
                        }
                    }
                }
                dilatedMask[idx] = isWhite ? 255 : 0;
            }
        }

        // 第二步：计算 ROI
        let minX = width, minY = height, maxX = 0, maxY = 0;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (dilatedMask[y * width + x] > 0) {
                    minX = Math.min(minX, x);
                    minY = Math.min(minY, y);
                    maxX = Math.max(maxX, x);
                    maxY = Math.max(maxY, y);
                }
            }
        }

        const roi = {
            x: Math.max(0, minX - 20),
            y: Math.max(0, minY - 20),
            width: Math.min(width, maxX - minX + 40),
            height: Math.min(height, maxY - minY + 40)
        };

        console.log(`[InpaintingService] ROI: (${roi.x},${roi.y}) ${roi.width}x${roi.height}`);

        // 第三步：边缘羽化（高斯模糊）
        const processedMaskBuffer = await this.sharp(Buffer.from(dilatedMask), {
            raw: { width, height, channels: 1 }
        })
            .blur(3)  // 羽化边缘
            .png()
            .toBuffer();

        const processedMask = `data:image/png;base64,${processedMaskBuffer.toString('base64')}`;

        console.log('[InpaintingService] Mask 预处理完成');
        return { processedMask, roi };
    }

    /**
     * OpenAI DALL-E Inpainting
     */
    private async inpaintWithOpenAI(
        imageBase64: string,
        maskBase64: string,
        prompt: string
    ): Promise<InpaintingResult> {
        console.log('[InpaintingService] 调用 OpenAI DALL-E...');

        if (!this.config.openaiApiKey) {
            return { success: false, error: 'OpenAI API Key 未配置' };
        }

        try {
            const openai = new OpenAI({ apiKey: this.config.openaiApiKey });

            // 准备图像文件
            const imageBuffer = Buffer.from(imageBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
            const maskBuffer = Buffer.from(maskBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');

            // 确保图像是 PNG 格式且尺寸符合要求
            const processedImage = await this.sharp(imageBuffer)
                .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                .png()
                .toBuffer();

            const processedMask = await this.sharp(maskBuffer)
                .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                .png()
                .toBuffer();

            // 创建临时文件（OpenAI SDK 需要文件）
            const tempDir = app.getPath('temp');
            const imagePath = path.join(tempDir, 'inpaint_image.png');
            const maskPath = path.join(tempDir, 'inpaint_mask.png');

            fs.writeFileSync(imagePath, processedImage);
            fs.writeFileSync(maskPath, processedMask);

            // 调用 OpenAI API
            const response = await openai.images.edit({
                model: 'dall-e-2',
                image: fs.createReadStream(imagePath) as any,
                mask: fs.createReadStream(maskPath) as any,
                prompt: prompt,
                n: 1,
                size: '1024x1024',
                response_format: 'b64_json'
            });

            // 清理临时文件
            fs.unlinkSync(imagePath);
            fs.unlinkSync(maskPath);

            if (response.data && response.data[0]?.b64_json) {
                console.log('[InpaintingService] OpenAI 重绘成功');
                return {
                    success: true,
                    image: `data:image/png;base64,${response.data[0].b64_json}`
                };
            }

            return { success: false, error: 'OpenAI 返回数据无效' };

        } catch (error: any) {
            console.error('[InpaintingService] OpenAI 调用失败:', error.message);
            return { success: false, error: `OpenAI 错误: ${error.message}` };
        }
    }

    /**
     * Stability AI Inpainting
     */
    private async inpaintWithStability(
        imageBase64: string,
        maskBase64: string,
        prompt: string
    ): Promise<InpaintingResult> {
        console.log('[InpaintingService] 调用 Stability AI...');

        if (!this.config.stabilityApiKey) {
            return { success: false, error: 'Stability AI API Key 未配置' };
        }

        try {
            const imageBuffer = Buffer.from(imageBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
            const maskBuffer = Buffer.from(maskBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');

            // 准备 multipart/form-data
            const FormData = require('form-data');
            const formData = new FormData();
            formData.append('image', imageBuffer, { filename: 'image.png', contentType: 'image/png' });
            formData.append('mask', maskBuffer, { filename: 'mask.png', contentType: 'image/png' });
            formData.append('prompt', prompt);
            formData.append('output_format', 'png');

            const response = await fetch('https://api.stability.ai/v2beta/stable-image/edit/inpaint', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.config.stabilityApiKey}`,
                    'Accept': 'application/json',
                    ...formData.getHeaders()
                },
                body: formData
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Stability API 错误: ${response.status} - ${errorText}`);
            }

            const result = await response.json() as any;

            if (result.image) {
                console.log('[InpaintingService] Stability AI 重绘成功');
                return {
                    success: true,
                    image: `data:image/png;base64,${result.image}`
                };
            }

            return { success: false, error: 'Stability AI 返回数据无效' };

        } catch (error: any) {
            console.error('[InpaintingService] Stability AI 调用失败:', error.message);
            return { success: false, error: `Stability AI 错误: ${error.message}` };
        }
    }

    /**
     * 本地 LaMa 模型 Inpainting
     */
    private async inpaintWithLaMa(
        imageBase64: string,
        maskBase64: string
    ): Promise<InpaintingResult> {
        console.log('[InpaintingService] 使用本地 LaMa 模型...');

        try {
            // 加载 LaMa 模型
            if (!this.lamaSession) {
                const modelPath = path.join(this.config.modelsDir, 'lama', 'lama.onnx');
                
                if (!fs.existsSync(modelPath)) {
                    return { 
                        success: false, 
                        error: 'LaMa 模型未安装。请在设置中下载 LaMa 模型。',
                    };
                }

                console.log('[InpaintingService] 加载 LaMa 模型...');
                this.lamaSession = await this.ort.InferenceSession.create(modelPath, {
                    executionProviders: ['cuda', 'dml', 'cpu'],  // onnxruntime-node 使用小写名称
                    logSeverityLevel: 3  // 抑制警告，只显示错误
                });
                console.log('[InpaintingService] LaMa 模型加载成功');
            }

            // 解码图像
            const imageBuffer = Buffer.from(imageBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
            const maskBuffer = Buffer.from(maskBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');

            // 获取原始尺寸
            const metadata = await this.sharp(imageBuffer).metadata();
            const originalWidth = metadata.width!;
            const originalHeight = metadata.height!;

            // LaMa 模型输入尺寸（通常是 512x512 或动态）
            const inputSize = 512;

            // 预处理图像
            const resizedImage = await this.sharp(imageBuffer)
                .resize(inputSize, inputSize, { fit: 'fill' })
                .removeAlpha()
                .raw()
                .toBuffer();

            const resizedMask = await this.sharp(maskBuffer)
                .resize(inputSize, inputSize, { fit: 'fill' })
                .grayscale()
                .raw()
                .toBuffer();

            // 构建输入张量
            // LaMa 输入: image [1, 3, H, W], mask [1, 1, H, W]
            const imageTensor = new Float32Array(3 * inputSize * inputSize);
            const maskTensor = new Float32Array(1 * inputSize * inputSize);

            for (let i = 0; i < inputSize * inputSize; i++) {
                // 归一化到 [-1, 1] 或 [0, 1] 取决于模型
                imageTensor[i] = resizedImage[i * 3] / 255.0;
                imageTensor[inputSize * inputSize + i] = resizedImage[i * 3 + 1] / 255.0;
                imageTensor[2 * inputSize * inputSize + i] = resizedImage[i * 3 + 2] / 255.0;
                
                maskTensor[i] = resizedMask[i] / 255.0;
            }

            // 推理
            const feeds: Record<string, any> = {
                'image': new this.ort.Tensor('float32', imageTensor, [1, 3, inputSize, inputSize]),
                'mask': new this.ort.Tensor('float32', maskTensor, [1, 1, inputSize, inputSize])
            };

            console.log('[InpaintingService] 开始 LaMa 推理...');
            const inferStart = Date.now();
            const results = await this.lamaSession.run(feeds);
            console.log(`[InpaintingService] LaMa 推理完成: ${Date.now() - inferStart}ms`);

            // 处理输出
            const output = results[this.lamaSession.outputNames[0]];
            const outputData = output.data as Float32Array;

            // 转换为图像
            const outputImage = new Uint8Array(inputSize * inputSize * 3);
            for (let i = 0; i < inputSize * inputSize; i++) {
                outputImage[i * 3] = Math.min(255, Math.max(0, Math.round(outputData[i] * 255)));
                outputImage[i * 3 + 1] = Math.min(255, Math.max(0, Math.round(outputData[inputSize * inputSize + i] * 255)));
                outputImage[i * 3 + 2] = Math.min(255, Math.max(0, Math.round(outputData[2 * inputSize * inputSize + i] * 255)));
            }

            // 调整回原始尺寸
            const resultBuffer = await this.sharp(Buffer.from(outputImage), {
                raw: { width: inputSize, height: inputSize, channels: 3 }
            })
                .resize(originalWidth, originalHeight, { fit: 'fill' })
                .png()
                .toBuffer();

            console.log('[InpaintingService] LaMa 重绘成功');
            return {
                success: true,
                image: `data:image/png;base64,${resultBuffer.toString('base64')}`
            };

        } catch (error: any) {
            console.error('[InpaintingService] LaMa 处理失败:', error.message);
            return { success: false, error: `LaMa 错误: ${error.message}` };
        }
    }

    /**
     * 后处理：边缘融合
     */
    private async postprocess(
        originalBase64: string,
        resultBase64: string,
        maskBase64: string
    ): Promise<string> {
        console.log('[InpaintingService] 后处理：边缘融合...');

        try {
            const originalBuffer = Buffer.from(originalBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
            const resultBuffer = Buffer.from(resultBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
            const maskBuffer = Buffer.from(maskBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');

            const metadata = await this.sharp(originalBuffer).metadata();
            const width = metadata.width!;
            const height = metadata.height!;

            // 确保所有图像尺寸一致
            const originalRaw = await this.sharp(originalBuffer)
                .resize(width, height)
                .removeAlpha()
                .raw()
                .toBuffer();

            const resultRaw = await this.sharp(resultBuffer)
                .resize(width, height)
                .removeAlpha()
                .raw()
                .toBuffer();

            const maskRaw = await this.sharp(maskBuffer)
                .resize(width, height)
                .grayscale()
                .raw()
                .toBuffer();

            // Alpha 混合
            const blendedRaw = new Uint8Array(width * height * 3);
            for (let i = 0; i < width * height; i++) {
                const alpha = maskRaw[i] / 255.0;
                
                blendedRaw[i * 3] = Math.round(originalRaw[i * 3] * (1 - alpha) + resultRaw[i * 3] * alpha);
                blendedRaw[i * 3 + 1] = Math.round(originalRaw[i * 3 + 1] * (1 - alpha) + resultRaw[i * 3 + 1] * alpha);
                blendedRaw[i * 3 + 2] = Math.round(originalRaw[i * 3 + 2] * (1 - alpha) + resultRaw[i * 3 + 2] * alpha);
            }

            const blendedBuffer = await this.sharp(Buffer.from(blendedRaw), {
                raw: { width, height, channels: 3 }
            })
                .png()
                .toBuffer();

            console.log('[InpaintingService] 后处理完成');
            return `data:image/png;base64,${blendedBuffer.toString('base64')}`;

        } catch (error: any) {
            console.error('[InpaintingService] 后处理失败:', error.message);
            return resultBase64; // 失败时返回原始结果
        }
    }

    /**
     * 检查 LaMa 模型是否已安装
     */
    isLamaInstalled(): boolean {
        const modelPath = path.join(this.config.modelsDir, 'lama', 'lama.onnx');
        return fs.existsSync(modelPath);
    }

    /**
     * 获取可用的 inpainting 提供商
     */
    getAvailableProviders(): string[] {
        const providers: string[] = [];
        
        if (this.config.openaiApiKey) {
            providers.push('openai');
        }
        if (this.config.stabilityApiKey) {
            providers.push('stability');
        }
        if (this.isLamaInstalled()) {
            providers.push('lama');
        }
        
        return providers;
    }
}
