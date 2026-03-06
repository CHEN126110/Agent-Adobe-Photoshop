/**
 * 优化形态变形服务
 * 
 * 使用 JFA 距离场 + 稀疏位移场 + 智能袜口检测
 * 相比原版本提升约 6x 速度
 */

import sharp from 'sharp';
import * as crypto from 'crypto';
import {
    Point2D,
    BoundingBox,
    MorphingConfig,
    DisplacementField,
    SparseDisplacementField,
    CuffDetectionResult,
    DEFAULT_MORPHING_CONFIG,
    QUALITY_PRESETS,
    MorphingLogEntry
} from './types';
import { JFADistanceField } from './jfa-distance-field';
import { MLSDeformation } from './mls-deformation';
import { SmartCuffDetector } from './smart-cuff-detector';
import { compressDisplacementField, serializeSparseDisplacement } from './sparse-displacement';

/**
 * 优化版形态变形请求
 */
export interface OptimizedMorphRequest {
    // 源轮廓和目标轮廓 (不需要传输图像)
    sourceContour: Point2D[];
    targetContour: Point2D[];
    
    // 图像尺寸
    width: number;
    height: number;
    
    // 可选: 源图像 (用于袜口检测)
    sourceImageBase64?: string;
    
    // 配置
    config?: Partial<MorphingConfig>;
}

/**
 * 优化版形态变形结果
 */
export interface OptimizedMorphResult {
    success: boolean;
    
    // 稀疏位移场 (用于传输)
    sparseDisplacement?: string;  // 序列化后的 SPARSE:xxx 格式
    
    // 袜口检测结果
    cuffInfo?: CuffDetectionResult;
    
    // 统计信息
    processingTime: number;
    stats?: {
        jfaTime: number;
        mlsTime: number;
        cuffDetectionTime: number;
        compressionTime: number;
        pixelCount: number;
        compressionRatio: number;
    };
    
    error?: string;
}

/**
 * 优化形态变形服务
 */
export class OptimizedMorphingService {
    private jfaDistanceField: JFADistanceField;
    private mlsDeformation: MLSDeformation;
    private cuffDetector: SmartCuffDetector;
    private logs: MorphingLogEntry[] = [];
    
    constructor() {
        this.jfaDistanceField = new JFADistanceField();
        this.mlsDeformation = new MLSDeformation();
        this.cuffDetector = new SmartCuffDetector();
        
        console.log('[OptimizedMorphing] 服务已初始化');
    }
    
    /**
     * 执行优化形态变形
     * 只返回稀疏位移场，不处理图像
     */
    async computeDisplacement(request: OptimizedMorphRequest): Promise<OptimizedMorphResult> {
        this.logs = [];
        this.log('info', 'start', '开始优化形态变形');
        const startTime = performance.now();
        
        try {
            const { sourceContour, targetContour, width, height } = request;
            const config = this.mergeConfig(request.config || {});
            
            this.log('info', 'config', '配置', {
                width, height,
                contourPoints: sourceContour.length,
                quality: config.qualityPreset
            });
            
            // 1. JFA 距离场计算
            const jfaStart = performance.now();
            this.log('info', 'jfa', '计算 JFA 距离场...');
            
            const distanceField = this.jfaDistanceField.compute(width, height, sourceContour);
            
            const jfaTime = performance.now() - jfaStart;
            this.log('perf', 'jfa', 'JFA 距离场完成', { duration: jfaTime });
            
            // 2. 袜口检测 (可选)
            let cuffInfo: CuffDetectionResult | undefined;
            let cuffDetectionTime = 0;
            
            if (config.detectLace) {
                const cuffStart = performance.now();
                this.log('info', 'cuff', '检测袜口...');
                
                const imageBounds: BoundingBox = { x: 0, y: 0, width, height };
                cuffInfo = this.cuffDetector.detect(sourceContour, imageBounds);
                
                cuffDetectionTime = performance.now() - cuffStart;
                this.log('perf', 'cuff', `袜口检测完成: ${cuffInfo.type}`, { duration: cuffDetectionTime });
            }
            
            // 3. 生成边缘带权重
            const weightsStart = performance.now();
            this.log('info', 'weights', '生成边缘带权重...');
            
            let weights = this.jfaDistanceField.generateWeightMap(
                distanceField,
                config.edgeBandWidth,
                config.transitionWidth
            );
            
            // 应用袜口保护
            if (cuffInfo && (cuffInfo.type === 'lace' || cuffInfo.type === 'double' || cuffInfo.type === 'ribbed')) {
                weights = this.applyCuffProtection(weights, width, height, cuffInfo);
            }
            
            this.log('perf', 'weights', '权重生成完成', { duration: performance.now() - weightsStart });
            
            // 4. MLS 位移场计算
            const mlsStart = performance.now();
            this.log('info', 'mls', '计算 MLS 位移场...');
            
            // 生成控制点对
            const controlPairs = this.mlsDeformation.generateControlPairs(
                sourceContour,
                targetContour,
                Math.max(30, sourceContour.length / 3)
            );
            
            // 计算位移场
            let displacement = this.mlsDeformation.computeDisplacementField(
                width, height,
                controlPairs,
                config.gridSize
            );
            
            // 应用权重
            displacement = this.mlsDeformation.applyWeightedDisplacement(displacement, weights);
            
            const mlsTime = performance.now() - mlsStart;
            this.log('perf', 'mls', `MLS 位移场完成, ${controlPairs.length} 控制点`, { duration: mlsTime });
            
            // 5. 压缩为稀疏格式
            const compressStart = performance.now();
            this.log('info', 'compress', '压缩位移场...');
            
            const sparseField = compressDisplacementField(displacement, weights);
            const serialized = serializeSparseDisplacement(sparseField);
            
            const compressionTime = performance.now() - compressStart;
            const originalSize = width * height * 8;
            const compressedSize = serialized.length;
            const compressionRatio = originalSize / compressedSize;
            
            this.log('perf', 'compress', `压缩完成: ${compressionRatio.toFixed(1)}x`, {
                duration: compressionTime,
                pixelCount: sparseField.pixelCount,
                originalSize: `${(originalSize / 1024).toFixed(0)}KB`,
                compressedSize: `${(compressedSize / 1024).toFixed(0)}KB`
            });
            
            // 完成
            const totalTime = performance.now() - startTime;
            this.log('info', 'complete', `✅ 变形计算完成`, { totalTime: totalTime.toFixed(2) });
            
            return {
                success: true,
                sparseDisplacement: serialized,
                cuffInfo,
                processingTime: totalTime,
                stats: {
                    jfaTime,
                    mlsTime,
                    cuffDetectionTime,
                    compressionTime,
                    pixelCount: sparseField.pixelCount,
                    compressionRatio
                }
            };
            
        } catch (error: any) {
            const totalTime = performance.now() - startTime;
            this.log('error', 'error', `变形失败: ${error.message}`);
            
            return {
                success: false,
                processingTime: totalTime,
                error: error.message
            };
        }
    }
    
    /**
     * 应用袜口保护
     */
    private applyCuffProtection(
        weights: Float32Array,
        width: number,
        height: number,
        cuffInfo: CuffDetectionResult
    ): Float32Array {
        const result = new Float32Array(weights);
        const region = cuffInfo.region;
        
        // 袜口区域权重设为 0 (不变形)
        for (let y = Math.floor(region.y); y < region.y + region.height && y < height; y++) {
            for (let x = Math.floor(region.x); x < region.x + region.width && x < width; x++) {
                if (x >= 0 && y >= 0) {
                    result[y * width + x] = 0;
                }
            }
        }
        
        this.log('info', 'cuffProtection', `应用袜口保护: ${region.width.toFixed(0)}×${region.height.toFixed(0)}`);
        return result;
    }
    
    /**
     * 合并配置
     */
    private mergeConfig(config: Partial<MorphingConfig>): MorphingConfig {
        const base = { ...DEFAULT_MORPHING_CONFIG };
        
        // 应用质量预设
        if (config.qualityPreset && QUALITY_PRESETS[config.qualityPreset]) {
            Object.assign(base, QUALITY_PRESETS[config.qualityPreset]);
        }
        
        return { ...base, ...config };
    }
    
    /**
     * 记录日志
     */
    private log(level: MorphingLogEntry['level'], step: string, message: string, data?: any): void {
        const entry: MorphingLogEntry = {
            timestamp: new Date().toISOString(),
            level,
            step,
            message,
            data,
            duration: data?.duration
        };
        
        this.logs.push(entry);
        
        const prefix = level === 'error' ? '❌' :
                       level === 'warn' ? '⚠️' :
                       level === 'perf' ? '⏱️' : 'ℹ️';
        
        const durationStr = data?.duration ? ` (${data.duration.toFixed(2)}ms)` : '';
        console.log(`[OptimizedMorphing] ${prefix} [${step}] ${message}${durationStr}`);
    }
    
    /**
     * 获取日志
     */
    getLogs(): MorphingLogEntry[] {
        return [...this.logs];
    }
}

// 单例
let optimizedMorphingServiceInstance: OptimizedMorphingService | null = null;

export function getOptimizedMorphingService(): OptimizedMorphingService {
    if (!optimizedMorphingServiceInstance) {
        optimizedMorphingServiceInstance = new OptimizedMorphingService();
    }
    return optimizedMorphingServiceInstance;
}
