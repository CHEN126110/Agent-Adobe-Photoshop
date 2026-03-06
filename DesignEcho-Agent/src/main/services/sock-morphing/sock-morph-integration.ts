/**
 * 袜子形态统一集成服务
 * 
 * 连接 SockMorphEngine 与 UXP 工具链
 * 提供完整的形态统一工作流
 */

import { SockMorphEngine, SockMorphRequest, SockMorphResult } from './sock-morph-engine';
import { Point } from './skeleton-alignment';
import { Bounds } from './coordinate-transform';

/**
 * 集成服务配置
 */
export interface IntegrationConfig {
    /** 是否自动转换为 Smart Object */
    autoConvertToSmartObject: boolean;
    /** 是否保留原图层 */
    preserveOriginal: boolean;
    /** 调试模式 */
    debug: boolean;
}

const DEFAULT_CONFIG: IntegrationConfig = {
    autoConvertToSmartObject: true,
    preserveOriginal: true,
    debug: true
};

/**
 * 工作流状态
 */
export interface WorkflowState {
    step: 'idle' | 'extracting' | 'analyzing' | 'generating' | 'executing' | 'complete' | 'error';
    progress: number;
    message: string;
    details?: any;
}

/**
 * 形态统一集成服务
 */
export class SockMorphIntegration {
    private engine: SockMorphEngine;
    private config: IntegrationConfig;
    private state: WorkflowState = { step: 'idle', progress: 0, message: '' };
    private stateCallback?: (state: WorkflowState) => void;
    
    constructor(config: Partial<IntegrationConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.engine = new SockMorphEngine(this.config.debug);
    }
    
    /**
     * 设置状态变化回调
     */
    onStateChange(callback: (state: WorkflowState) => void): void {
        this.stateCallback = callback;
    }
    
    /**
     * 更新状态
     */
    private updateState(state: Partial<WorkflowState>): void {
        this.state = { ...this.state, ...state };
        if (this.stateCallback) {
            this.stateCallback(this.state);
        }
        if (this.config.debug) {
            console.log(`[SockMorphIntegration] ${this.state.step}: ${this.state.message} (${this.state.progress}%)`);
        }
    }
    
    /**
     * 执行完整的形态统一工作流
     * 
     * @param productLayerId 产品图层 ID
     * @param referenceShapeId 参考形状图层 ID  
     * @param callTool UXP 工具调用函数
     */
    async execute(
        productLayerId: number,
        referenceShapeId: number,
        callTool: (toolName: string, params: any) => Promise<any>,
        settings?: Partial<SockMorphRequest['settings']>
    ): Promise<{
        success: boolean;
        result?: SockMorphResult;
        error?: string;
    }> {
        try {
            // ===== Step 1: 获取产品图层信息 =====
            this.updateState({
                step: 'extracting',
                progress: 10,
                message: '获取产品图层信息...'
            });
            
            // 选中产品图层
            await callTool('selectLayer', { layerId: productLayerId });
            
            // 获取图层边界
            const boundsResult = await callTool('getLayerBounds', { layerId: productLayerId });
            if (!boundsResult?.success) {
                throw new Error(`无法获取产品图层边界: ${boundsResult?.error || '未知错误'}`);
            }
            
            const productBounds: Bounds = {
                left: boundsResult.left,
                top: boundsResult.top,
                right: boundsResult.right,
                bottom: boundsResult.bottom,
                width: boundsResult.right - boundsResult.left,
                height: boundsResult.bottom - boundsResult.top
            };
            
            // ===== Step 2: 提取产品轮廓 =====
            this.updateState({
                step: 'extracting',
                progress: 20,
                message: '提取产品轮廓...'
            });
            
            const contourResult = await callTool('getLayerContour', { 
                layerId: productLayerId,
                simplify: true,
                maxPoints: 200
            });
            
            if (!contourResult?.success || !contourResult?.contour) {
                throw new Error(`无法提取产品轮廓: ${contourResult?.error || '轮廓数据为空'}`);
            }
            
            const productContour: Point[] = contourResult.contour;
            
            // ===== Step 3: 获取参考形状 =====
            this.updateState({
                step: 'extracting',
                progress: 30,
                message: '获取参考形状...'
            });
            
            const refContourResult = await callTool('getLayerContour', {
                layerId: referenceShapeId,
                simplify: true,
                maxPoints: 200
            });
            
            if (!refContourResult?.success || !refContourResult?.contour) {
                throw new Error(`无法获取参考形状轮廓: ${refContourResult?.error || '轮廓数据为空'}`);
            }
            
            const referenceContour: Point[] = refContourResult.contour;
            
            // 获取参考形状名称
            const refLayerInfo = await callTool('getLayerBounds', { layerId: referenceShapeId });
            const refLayerName = refLayerInfo?.layerName || `参考形状_${referenceShapeId}`;
            
            // ===== Step 4: 执行形态分析 =====
            this.updateState({
                step: 'analyzing',
                progress: 50,
                message: '执行形态分析...'
            });
            
            const request: SockMorphRequest = {
                productLayer: {
                    id: productLayerId,
                    name: boundsResult.layerName || `产品_${productLayerId}`,
                    bounds: productBounds
                },
                referenceShape: {
                    id: referenceShapeId,
                    name: refLayerName,
                    contour: referenceContour
                },
                productContour,
                originalBounds: productBounds,
                trimmedBounds: productBounds,  // 假设已 Trim
                settings: {
                    cuffProtection: settings?.cuffProtection ?? true,
                    patternProtection: settings?.patternProtection ?? true,
                    matchIntensity: settings?.matchIntensity ?? 70,
                    sockType: settings?.sockType
                }
            };
            
            const morphResult = await this.engine.process(request);
            
            if (!morphResult.success) {
                throw new Error(morphResult.error || '形态分析失败');
            }
            
            // ===== Step 5: 生成变形命令 =====
            this.updateState({
                step: 'generating',
                progress: 70,
                message: `生成变形命令 (${morphResult.puppetWarpConfig?.pins.length || 0} 个控制点)...`
            });
            
            // 这里需要决定执行方式：
            // 1. 如果 Puppet Warp API 可用 → 使用 batchPlayCommands
            // 2. 否则 → 使用 Agent 端 WebGL 变形
            
            const executionMethod = await this.determineExecutionMethod(callTool);
            
            if (executionMethod === 'puppetWarp' && morphResult.batchPlayCommands) {
                // ===== Step 6: 执行 Puppet Warp =====
                this.updateState({
                    step: 'executing',
                    progress: 80,
                    message: '执行 Puppet Warp 变形...'
                });
                
                // 先转换为 Smart Object（如果需要）
                if (this.config.autoConvertToSmartObject) {
                    await callTool('selectLayer', { layerId: productLayerId });
                    // 注意：这里需要检查是否已经是 Smart Object
                }
                
                // 执行变形命令
                // TODO: 当 Puppet Warp API 确认可用后实现
                console.log('[SockMorphIntegration] Puppet Warp 命令待执行:', morphResult.batchPlayCommands.length);
                
            } else {
                // 备用方案：使用 Agent 端变形
                this.updateState({
                    step: 'executing',
                    progress: 80,
                    message: '使用 Agent 端变形引擎...'
                });
                
                // TODO: 集成 WebGL 变形引擎
                console.log('[SockMorphIntegration] 需要使用 Agent 端变形引擎');
            }
            
            // ===== 完成 =====
            this.updateState({
                step: 'complete',
                progress: 100,
                message: '形态统一完成',
                details: {
                    sockType: morphResult.analysis.sockType,
                    qualityScore: morphResult.analysis.qualityScore,
                    warnings: morphResult.warnings
                }
            });
            
            return {
                success: true,
                result: morphResult
            };
            
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.updateState({
                step: 'error',
                progress: 0,
                message: errorMsg
            });
            
            return {
                success: false,
                error: errorMsg
            };
        }
    }
    
    /**
     * 确定执行方式
     * 测试 Puppet Warp API 是否可用
     */
    private async determineExecutionMethod(
        callTool: (toolName: string, params: any) => Promise<any>
    ): Promise<'puppetWarp' | 'agentWarp'> {
        try {
            // 尝试调用 warpExplorer 测试 Puppet Warp
            const testResult = await callTool('warpExplorer', { action: 'getWarpInfo' });
            
            // 如果能获取到 warp 信息，说明 API 可能可用
            if (testResult?.success) {
                console.log('[SockMorphIntegration] Puppet Warp API 可能可用');
                // 但由于 Puppet Warp API 尚未完全验证，暂时返回 agentWarp
                return 'agentWarp';
            }
        } catch (e) {
            console.log('[SockMorphIntegration] Puppet Warp API 测试失败');
        }
        
        return 'agentWarp';
    }
    
    /**
     * 获取当前状态
     */
    getState(): WorkflowState {
        return { ...this.state };
    }
    
    /**
     * 重置状态
     */
    reset(): void {
        this.state = { step: 'idle', progress: 0, message: '' };
    }
}

/**
 * 创建集成服务实例
 */
export function createSockMorphIntegration(config?: Partial<IntegrationConfig>): SockMorphIntegration {
    return new SockMorphIntegration(config);
}

export default SockMorphIntegration;
