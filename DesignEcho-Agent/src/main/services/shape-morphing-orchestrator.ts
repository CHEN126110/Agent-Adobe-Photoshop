/**
 * 形态统一编排服务
 * 
 * 职责：协调形态统一流程的各个步骤（决策层）
 * 原则：
 * 1. 单一职责：仅负责流程编排，不包含具体算法实现
 * 2. 原子化：每个方法完成一个明确的子任务
 * 3. 层级隔离：决策逻辑在此，执行逻辑在 Tool/Service
 */

import { WebSocketServer } from '../websocket/server';
import { MattingService } from './matting-service';
import { LayoutRulesService } from './layout-rules-service';
import { OptimizedMorphingService } from './morphing/optimized-morphing-service';

// ==================== 类型定义 ====================

export interface ShapeMorphingParams {
    referenceShapeId: number;
    productLayerIds: number[];
    step?: 'align' | 'contour' | 'analyze' | 'morph' | 'all';
    
    // 开关控制
    preAlign?: boolean;           // 位置对齐开关（默认 true）
    shapeMatch?: boolean;         // 形态吻合开关（默认 true）
    
    // 变形强度参数
    edgeStrength?: number;        // 边缘变形强度 0-100（默认 70）
    contentProtection?: number;   // 内容保护强度 0-100（默认 80）
    smoothness?: number;          // 变形平滑度 0-100（默认 50）
    
    // 分区控制
    selectedRegions?: string[];   // 参与变形的区域 ['cuff', 'leg', 'heel', 'body', 'toe']
    regionControl?: { cuff?: number; leg?: number; heel?: number; body?: number; toe?: number; };
    
    // 款式信息
    sockStyle?: string;           // 袜子款式：crew, ankle, knee-high, no-show
    cuffType?: string;            // 袜口类型：plain, ribbed, folded, decorated
    cuffProtected?: boolean;      // 袜口是否受保护（装饰袜口）
    
    // 技术选项
    quality?: 'fast' | 'balanced' | 'high';
    useAdvancedDetection?: boolean;
    useOptimizedMorphing?: boolean;
    forceRedetect?: boolean;
    
    // 兼容旧参数
    intensity?: number;           // 已废弃，使用 edgeStrength
}

export interface LayerBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

export interface Point2D {
    x: number;
    y: number;
}

export interface AlignmentResult {
    layerId: number;
    success: boolean;
    error?: string;
    method?: string;
    scale?: { x: number; y: number };
}

export interface ShapeMorphingResult {
    success: boolean;
    results: AlignmentResult[];
    message?: string;
    error?: string;
}

export interface ContourData {
    points: Point2D[];
    width: number;
    height: number;
}

export interface MorphResult {
    layerId: number;
    success: boolean;
    error?: string;
    processingTime?: number;
}

// ==================== 原子函数：参考形状处理 ====================

/**
 * 获取参考形状的边界和中心
 * 原子函数：单一职责，仅获取参考形状信息
 */
async function fetchReferenceShapeBounds(
    wsServer: WebSocketServer,
    refShapeId: number
): Promise<{ bounds: LayerBounds; center: Point2D } | null> {
    console.log(`[形态统一] 获取参考形状边界 (ID: ${refShapeId})`);
    
    const result = await wsServer.sendRequest('getLayerBounds', { layerId: refShapeId });
    
    if (!result?.success || !result?.bounds) {
        console.error(`[形态统一] ✗ 无法获取参考形状边界`);
        return null;
    }
    
    const bounds = result.bounds;
    const center: Point2D = {
        x: bounds.left + bounds.width / 2,
        y: bounds.top + bounds.height / 2
    };
    
    console.log(`[形态统一] ✓ 参考形状: 中心(${center.x.toFixed(0)}, ${center.y.toFixed(0)}), 尺寸${bounds.width.toFixed(0)}x${bounds.height.toFixed(0)}`);
    
    return { bounds, center };
}

// ==================== 原子函数：图层信息获取 ====================

/**
 * 获取产品图层的边界信息
 * 原子函数：单一职责，仅获取图层边界
 */
async function fetchLayerBounds(
    wsServer: WebSocketServer,
    layerId: number
): Promise<LayerBounds | null> {
    const result = await wsServer.sendRequest('getLayerBounds', { 
        layerId,
        includeEffects: true
    });
    
    if (!result?.success) {
        console.error(`[形态统一] ✗ 无法获取图层 ${layerId} 的边界`);
        return null;
    }
    
    // 优先使用 boundsNoEffects
    return result.boundsNoEffects || result.bounds;
}

/**
 * 导出图层为 Base64 图像
 * 原子函数：单一职责，仅导出图像
 */
async function exportLayerAsImage(
    wsServer: WebSocketServer,
    layerId: number,
    maxSize: number = 1024
): Promise<{ base64: string; width: number; height: number } | null> {
    const result = await wsServer.sendRequest('exportLayerAsBase64', {
        layerId,
        format: 'png',
        maxSize
    });
    
    if (!result?.success || !result?.data?.base64) {
        console.error(`[形态统一] ✗ 图层 ${layerId} 导出失败`);
        return null;
    }
    
    // 解析可能包含 alpha 通道的数据
    let imageBase64 = result.data.base64;
    if (imageBase64.includes('|||ALPHA:')) {
        const parts = imageBase64.split('|||');
        imageBase64 = parts[0]; // 提取纯图像数据
    }
    
    return {
        base64: imageBase64,
        width: result.data.width,
        height: result.data.height
    };
}

// ==================== 原子函数：主体检测 ====================

/**
 * 检测图层中的主体位置和尺寸
 * 原子函数：单一职责，使用 YOLO 检测主体边界
 */
async function detectSubjectBounds(
    mattingService: MattingService,
    imageBase64: string,
    layerBounds: LayerBounds,
    exportedWidth: number,
    exportedHeight: number
): Promise<{ center: Point2D; size: { width: number; height: number } } | null> {
    console.log(`[形态统一] 检测主体位置...`);
    
    const yoloDetections = await mattingService.detectWithYoloWorld(
        imageBase64,
        '袜子 socks clothing'
    );
    
    if (!yoloDetections || yoloDetections.length === 0) {
        console.error(`[形态统一] ✗ 未检测到主体`);
        return null;
    }
    
    // 选择置信度最高的检测结果
    const bestDetection = yoloDetections.sort((a, b) => b.confidence - a.confidence)[0];
    
    // 计算检测框尺寸和中心（导出图像坐标系）
    const detectionWidth = bestDetection.x2 - bestDetection.x1;
    const detectionHeight = bestDetection.y2 - bestDetection.y1;
    const detectionCenterX = bestDetection.x1 + detectionWidth / 2;
    const detectionCenterY = bestDetection.y1 + detectionHeight / 2;
    
    // 坐标转换：从导出图像坐标系 → 画布坐标系
    const scaleX = layerBounds.width / exportedWidth;
    const scaleY = layerBounds.height / exportedHeight;
    
    const canvasSubjectCenter: Point2D = {
        x: layerBounds.left + detectionCenterX * scaleX,
        y: layerBounds.top + detectionCenterY * scaleY
    };
    
    const canvasSubjectSize = {
        width: detectionWidth * scaleX,
        height: detectionHeight * scaleY
    };
    
    console.log(`[形态统一] ✓ 主体中心: (${canvasSubjectCenter.x.toFixed(0)}, ${canvasSubjectCenter.y.toFixed(0)}), 尺寸: ${canvasSubjectSize.width.toFixed(0)}x${canvasSubjectSize.height.toFixed(0)}`);
    
    return { center: canvasSubjectCenter, size: canvasSubjectSize };
}

// ==================== 原子函数：缩放计算 ====================

/**
 * 计算对齐所需的缩放比例
 * 原子函数：单一职责，基于参考形状和主体尺寸计算缩放
 */
function calculateScalePercent(
    refBounds: LayerBounds,
    subjectSize: { width: number; height: number },
    layoutRulesService?: LayoutRulesService
): { scalePercent: number; source: string; explanation: string } {
    // 默认：匹配参考形状高度
    const uniformScale = refBounds.height / subjectSize.height;
    let scalePercent = uniformScale * 100;
    let source = 'reference';
    let explanation = `匹配参考形状高度 (${refBounds.height.toFixed(0)}px)`;
    
    // 可选：使用布局规则服务的审美缩放
    // 暂时保留参考形状缩放模式
    // 未来可扩展为审美缩放
    
    console.log(`[形态统一] 缩放计算: ${scalePercent.toFixed(1)}% (来源: ${source})`);
    
    return { scalePercent, source, explanation };
}

// ==================== 原子函数：对齐执行 ====================

/**
 * 执行图层对齐（缩放 + 移动）
 * 原子函数：单一职责，调用 UXP 工具执行对齐
 */
async function alignLayerToReference(
    wsServer: WebSocketServer,
    layerId: number,
    scalePercent: number,
    targetCenter: Point2D,
    subjectCenter: Point2D,
    layerCenter: Point2D
): Promise<boolean> {
    const subjectOffsetX = subjectCenter.x - layerCenter.x;
    const subjectOffsetY = subjectCenter.y - layerCenter.y;
    
    console.log(`[形态统一] 对齐图层 ${layerId}: 缩放${scalePercent.toFixed(1)}%, 目标中心(${targetCenter.x.toFixed(0)}, ${targetCenter.y.toFixed(0)})`);
    
    const alignResult = await wsServer.sendRequest('alignToReference', {
        layerId,
        scalePercent,
        targetCenterX: targetCenter.x,
        targetCenterY: targetCenter.y,
        subjectOffsetX,
        subjectOffsetY
    });
    
    if (!alignResult?.success) {
        console.error(`[形态统一] ✗ 对齐失败: ${alignResult?.error}`);
        return false;
    }
    
    console.log(`[形态统一] ✓ 对齐完成`);
    return true;
}

// ==================== 原子函数：轮廓提取 ====================

/**
 * 提取参考形状的轮廓
 * 原子函数：调用 UXP 提取形状路径
 */
async function extractReferenceContour(
    wsServer: WebSocketServer,
    refShapeId: number
): Promise<ContourData | null> {
    console.log(`[形态统一] 提取参考形状 ID=${refShapeId} 轮廓...`);
    
    const result = await wsServer.sendRequest('extractShapePath', { 
        layerId: refShapeId,
        samplePoints: 100  // 采样点数
    });
    
    // 调试：打印完整响应
    console.log(`[形态统一] extractShapePath 响应:`, JSON.stringify(result, null, 2).substring(0, 500));
    
    // UXP extractShapePath 返回 sampledPoints 字段
    const points = result?.sampledPoints || result?.points;
    
    if (!result?.success) {
        console.error(`[形态统一] ✗ 参考轮廓提取失败: ${result?.error || 'UXP 返回失败'}`);
        return null;
    }
    
    if (!points || points.length === 0) {
        console.error(`[形态统一] ✗ 参考轮廓数据为空: sampledPoints=${result?.sampledPoints?.length}, points=${result?.points?.length}`);
        return null;
    }
    
    // 获取边界框尺寸
    const boundingBox = result?.contour?.boundingBox;
    const width = boundingBox ? boundingBox.width : 800;
    const height = boundingBox ? boundingBox.height : 800;
    
    console.log(`[形态统一] ✓ 参考轮廓: ${points.length} 个点, 尺寸: ${width}×${height}`);
    
    return {
        points,
        width,
        height
    };
}

/**
 * 提取产品图层的轮廓
 * 原子函数：调用 UXP 获取图层轮廓
 */
async function extractLayerContour(
    wsServer: WebSocketServer,
    layerId: number
): Promise<ContourData | null> {
    console.log(`[形态统一] 提取图层 ${layerId} 轮廓...`);
    
    const result = await wsServer.sendRequest('getLayerContour', { 
        layerId,
        method: 'mask',  // 从透明度/蒙版提取
        threshold: 128,
        samplePoints: 100
    });
    
    // 调试：打印完整响应
    console.log(`[形态统一] getLayerContour 响应:`, JSON.stringify(result, null, 2).substring(0, 500));
    
    // UXP getLayerContour 返回 sampledPoints 字段
    const points = result?.sampledPoints || result?.points;
    
    if (!result?.success) {
        console.error(`[形态统一] ✗ 轮廓提取失败: ${result?.error || 'UXP 返回失败'}`);
        return null;
    }
    
    if (!points || points.length === 0) {
        console.error(`[形态统一] ✗ 轮廓数据为空: sampledPoints=${result?.sampledPoints?.length}, points=${result?.points?.length}`);
        return null;
    }
    
    // 获取边界框尺寸
    const contour = result?.contour;
    const boundingBox = contour?.boundingBox;
    const width = boundingBox ? boundingBox.width : 800;
    const height = boundingBox ? boundingBox.height : 800;
    
    console.log(`[形态统一] ✓ 图层轮廓: ${points.length} 个点, 尺寸: ${width}×${height}`);
    
    return {
        points,
        width,
        height
    };
}

// ==================== 原子函数：变形计算与应用 ====================

/**
 * 变形参数接口
 */
interface MorphParams {
    edgeStrength: number;       // 边缘变形强度 0-1
    contentProtection: number;  // 内容保护强度 0-1
    smoothness: number;         // 变形平滑度 0-1
    selectedRegions: string[];  // 参与变形的区域
    cuffProtected: boolean;     // 袜口是否受保护
}

/**
 * 计算位移场
 * 原子函数：使用优化服务计算稀疏位移场
 */
async function computeDisplacementField(
    morphingService: OptimizedMorphingService,
    sourceContour: Point2D[],
    targetContour: Point2D[],
    width: number,
    height: number,
    morphParams?: MorphParams
): Promise<{ sparseDisplacement: string; processingTime: number } | null> {
    console.log(`[形态统一] 计算位移场...`);
    
    // 根据变形参数选择质量预设
    let qualityPreset: 'fast' | 'balanced' | 'quality' = 'balanced';
    if (morphParams) {
        const avgStrength = (morphParams.edgeStrength + morphParams.smoothness) / 2;
        if (avgStrength < 0.3) qualityPreset = 'fast';
        else if (avgStrength > 0.7) qualityPreset = 'quality';
    }
    
    // 记录变形参数（供后续扩展）
    if (morphParams) {
        console.log(`[形态统一] 变形参数: edge=${morphParams.edgeStrength.toFixed(2)}, content=${morphParams.contentProtection.toFixed(2)}, smooth=${morphParams.smoothness.toFixed(2)}`);
        if (morphParams.cuffProtected) {
            console.log(`[形态统一] 袜口保护已启用`);
        }
    }
    
    const result = await morphingService.computeDisplacement({
        sourceContour,
        targetContour,
        width,
        height,
        config: {
            qualityPreset,
            detectLace: true,
            // 注：当 MorphingConfig 扩展后，可传递更多参数
            patternProtection: morphParams?.contentProtection ?? 0.8
        }
    });
    
    if (!result.success || !result.sparseDisplacement) {
        console.error(`[形态统一] ✗ 位移场计算失败: ${result.error}`);
        return null;
    }
    
    console.log(`[形态统一] ✓ 位移场计算完成: ${result.processingTime.toFixed(0)}ms, 压缩比 ${result.stats?.compressionRatio?.toFixed(1)}x`);
    
    return {
        sparseDisplacement: result.sparseDisplacement,
        processingTime: result.processingTime
    };
}

/**
 * 应用位移场到图层
 * 原子函数：调用 UXP 应用变形
 */
async function applyDisplacementToLayer(
    wsServer: WebSocketServer,
    layerId: number,
    sparseDisplacement: string
): Promise<boolean> {
    console.log(`[形态统一] 应用位移场到图层 ${layerId}...`);
    
    const result = await wsServer.sendRequest('applyDisplacement', {
        layerId,
        sparseDisplacement
    }, 60000); // 60秒超时
    
    if (!result?.success) {
        console.error(`[形态统一] ✗ 应用位移场失败: ${result?.error}`);
        return false;
    }
    
    console.log(`[形态统一] ✓ 位移场已应用`);
    return true;
}

// ==================== 编排器类 ====================

export class ShapeMorphingOrchestrator {
    private morphingService: OptimizedMorphingService;
    
    constructor(
        private wsServer: WebSocketServer,
        private mattingService: MattingService,
        private layoutRulesService?: LayoutRulesService
    ) {
        this.morphingService = new OptimizedMorphingService();
    }
    
    /**
     * 执行形态统一 - 对齐步骤
     * 编排函数：协调各个原子函数完成对齐流程
     */
    async executeAlignment(params: ShapeMorphingParams): Promise<ShapeMorphingResult> {
        console.log('');
        console.log('╔════════════════════════════════════════╗');
        console.log('║     形态统一 - 对齐步骤                  ║');
        console.log('╚════════════════════════════════════════╝');
        
        const { referenceShapeId, productLayerIds, preAlign = true } = params;
        const results: AlignmentResult[] = [];
        
        // 记录参数
        console.log('[参数] preAlign:', preAlign);
        
        // 检查开关：如果位置对齐关闭，直接返回成功
        if (!preAlign) {
            console.log('[形态统一] 位置对齐已关闭，跳过对齐步骤');
            for (const layerId of productLayerIds) {
                results.push({ layerId, success: true, method: 'skipped' });
            }
            return { success: true, results, message: '对齐步骤已跳过' };
        }
        
        // 步骤 1: 获取参考形状
        const refShape = await fetchReferenceShapeBounds(this.wsServer, referenceShapeId);
        if (!refShape) {
            return { success: false, results, error: '无法获取参考形状边界' };
        }
        
        const { bounds: refBounds, center: refCenter } = refShape;
        
        // 步骤 2: 逐个处理产品图层
        for (const layerId of productLayerIds) {
            console.log(`\n[形态统一] ──── 处理图层 ${layerId} ────`);
            
            try {
                // 2.1 获取图层边界
                const layerBounds = await fetchLayerBounds(this.wsServer, layerId);
                if (!layerBounds) {
                    results.push({ layerId, success: false, error: '获取边界失败' });
                    continue;
                }
                
                // 2.2 导出图层图像
                const exportedImage = await exportLayerAsImage(this.wsServer, layerId);
                if (!exportedImage) {
                    results.push({ layerId, success: false, error: '图层导出失败' });
                    continue;
                }
                
                // 2.3 检测主体位置
                const subjectInfo = await detectSubjectBounds(
                    this.mattingService,
                    exportedImage.base64,
                    layerBounds,
                    exportedImage.width,
                    exportedImage.height
                );
                
                if (!subjectInfo) {
                    results.push({ layerId, success: false, error: '主体检测失败' });
                    continue;
                }
                
                // 2.4 计算缩放比例
                const scaleInfo = calculateScalePercent(
                    refBounds,
                    subjectInfo.size,
                    this.layoutRulesService
                );
                
                // 2.5 执行对齐
                const layerCenter: Point2D = {
                    x: layerBounds.left + layerBounds.width / 2,
                    y: layerBounds.top + layerBounds.height / 2
                };
                
                const success = await alignLayerToReference(
                    this.wsServer,
                    layerId,
                    scaleInfo.scalePercent,
                    refCenter,
                    subjectInfo.center,
                    layerCenter
                );
                
                if (success) {
                    results.push({
                        layerId,
                        success: true,
                        method: 'yolo-world',
                        scale: { x: scaleInfo.scalePercent, y: scaleInfo.scalePercent }
                    });
                } else {
                    results.push({ layerId, success: false, error: '对齐执行失败' });
                }
                
            } catch (error: any) {
                console.error(`[形态统一] ✗ 图层 ${layerId} 处理异常:`, error.message);
                results.push({ layerId, success: false, error: error.message });
            }
        }
        
        // 统计结果
        const successCount = results.filter(r => r.success).length;
        const message = `完成: ${successCount}/${productLayerIds.length} 个图层对齐成功`;
        
        console.log(`\n[形态统一] ${message}`);
        
        return {
            success: successCount > 0,
            results,
            message
        };
    }
    
    /**
     * 执行完整形态统一流程
     * 编排函数：对齐 → 轮廓提取 → 变形计算 → 应用位移
     */
    async executeFullMorphing(params: ShapeMorphingParams): Promise<ShapeMorphingResult> {
        console.log('');
        console.log('╔════════════════════════════════════════╗');
        console.log('║     形态统一 - 完整流程                  ║');
        console.log('╚════════════════════════════════════════╝');
        
        const { 
            referenceShapeId, 
            productLayerIds,
            preAlign = true,
            shapeMatch = true,
            edgeStrength = 70,
            contentProtection = 80,
            smoothness = 50,
            selectedRegions = [],
            sockStyle = 'crew',
            cuffType = 'plain',
            cuffProtected = false
        } = params;
        
        const results: AlignmentResult[] = [];
        
        // 记录完整参数
        console.log('[参数] preAlign:', preAlign, 'shapeMatch:', shapeMatch);
        console.log('[参数] edgeStrength:', edgeStrength, 'contentProtection:', contentProtection, 'smoothness:', smoothness);
        console.log('[参数] selectedRegions:', selectedRegions);
        console.log('[参数] sockStyle:', sockStyle, 'cuffType:', cuffType, 'cuffProtected:', cuffProtected);
        
        // ========== 阶段 1: 对齐 ==========
        console.log('\n[阶段 1] 执行对齐...');
        const alignResult = await this.executeAlignment(params);
        
        if (!alignResult.success && preAlign) {
            return alignResult;
        }
        
        // 检查开关：如果形态吻合关闭，仅返回对齐结果
        if (!shapeMatch) {
            console.log('[形态统一] 形态吻合已关闭，跳过变形步骤');
            return {
                success: alignResult.success,
                results: alignResult.results,
                message: '仅完成对齐，形态吻合已跳过'
            };
        }
        
        // ========== 阶段 2: 提取参考轮廓 ==========
        console.log('\n[阶段 2] 提取参考轮廓...');
        const refContour = await extractReferenceContour(this.wsServer, referenceShapeId);
        
        if (!refContour) {
            return { 
                success: false, 
                results: alignResult.results, 
                error: '无法提取参考形状轮廓' 
            };
        }
        
        // ========== 阶段 3: 逐个处理产品图层变形 ==========
        console.log('\n[阶段 3] 执行形态变形...');
        
        // 计算变形参数
        const morphParams = {
            edgeStrength: edgeStrength / 100,        // 转换为 0-1 范围
            contentProtection: contentProtection / 100,
            smoothness: smoothness / 100,
            selectedRegions,
            cuffProtected
        };
        console.log('[变形参数]', morphParams);
        
        for (const layerId of productLayerIds) {
            console.log(`\n[形态统一] ──── 变形图层 ${layerId} ────`);
            
            try {
                // 3.1 提取图层轮廓
                const layerContour = await extractLayerContour(this.wsServer, layerId);
                
                if (!layerContour) {
                    results.push({ layerId, success: false, error: '提取轮廓失败' });
                    continue;
                }
                
                // 3.2 计算位移场（传入变形参数）
                const displacement = await computeDisplacementField(
                    this.morphingService,
                    layerContour.points,
                    refContour.points,
                    layerContour.width,
                    layerContour.height,
                    morphParams
                );
                
                if (!displacement) {
                    results.push({ layerId, success: false, error: '位移场计算失败' });
                    continue;
                }
                
                // 3.3 应用位移场
                const applied = await applyDisplacementToLayer(
                    this.wsServer,
                    layerId,
                    displacement.sparseDisplacement
                );
                
                if (applied) {
                    results.push({
                        layerId,
                        success: true,
                        method: 'optimized-morphing'
                    });
                } else {
                    results.push({ layerId, success: false, error: '应用位移场失败' });
                }
                
            } catch (error: any) {
                console.error(`[形态统一] ✗ 图层 ${layerId} 变形异常:`, error.message);
                results.push({ layerId, success: false, error: error.message });
            }
        }
        
        // 统计结果
        const successCount = results.filter(r => r.success).length;
        const message = `完成: ${successCount}/${productLayerIds.length} 个图层变形成功`;
        
        console.log(`\n[形态统一] ${message}`);
        
        return {
            success: successCount > 0,
            results,
            message
        };
    }
}
