/**
 * 审美决策 IPC Handlers
 * 
 * 暴露 AestheticKnowledgeService 和 AestheticDecisionService 给渲染进程和 AI Agent
 */

import { ipcMain, app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { 
    getAestheticKnowledgeService,
    getAestheticDecisionService,
    getProductLibraryService,
    getTrendSensingService,
    getVLMAestheticService,
    AestheticDecisionRequest,
    DesignType,
    DesignStyle,
    DesignAnalysisRequest
} from '../services/aesthetic';
import { ModelService } from '../services/model-service';

// ==================== 用户标记好设计存储 ====================

interface MarkedDesign {
    id: string;
    imageBase64: string;
    designType: DesignType;
    style?: DesignStyle;
    reason?: string;
    tags: string[];
    markedAt: string;
}

let markedDesigns: MarkedDesign[] = [];
let markedDesignsFile: string = '';

function initMarkedDesignsStorage(): void {
    markedDesignsFile = path.join(app.getPath('userData'), 'marked-designs.json');
    if (fs.existsSync(markedDesignsFile)) {
        try {
            markedDesigns = JSON.parse(fs.readFileSync(markedDesignsFile, 'utf-8'));
            console.log(`[AestheticHandlers] 已加载 ${markedDesigns.length} 个用户标记的好设计`);
        } catch (error) {
            console.warn('[AestheticHandlers] 加载标记设计失败，使用空列表');
            markedDesigns = [];
        }
    }
}

function saveMarkedDesigns(): void {
    fs.writeFileSync(markedDesignsFile, JSON.stringify(markedDesigns, null, 2), 'utf-8');
}

// 单例服务
let knowledgeServiceInitialized = false;
let productLibraryInitialized = false;
let trendServiceInitialized = false;
let vlmServiceInitialized = false;

// ModelService 引用（需要外部设置）
let modelServiceInstance: ModelService | null = null;

/**
 * 设置 ModelService 实例
 */
export function setModelServiceForAesthetic(modelService: ModelService): void {
    modelServiceInstance = modelService;
}

/**
 * 初始化审美知识库服务
 */
async function ensureKnowledgeServiceInitialized(): Promise<void> {
    if (!knowledgeServiceInitialized) {
        const service = getAestheticKnowledgeService();
        await service.initialize();
        knowledgeServiceInitialized = true;
    }
}

/**
 * 初始化产品库服务
 */
async function ensureProductLibraryInitialized(): Promise<void> {
    if (!productLibraryInitialized) {
        const service = getProductLibraryService();
        await service.initialize();
        productLibraryInitialized = true;
    }
}

/**
 * 注册审美决策相关的 IPC handlers
 */
export function registerAestheticHandlers(): void {
    console.log('[AestheticHandlers] 注册审美决策 IPC handlers...');
    
    // 初始化用户标记设计存储
    initMarkedDesignsStorage();

    // ==================== 知识库服务 ====================

    /**
     * 初始化审美知识库
     */
    ipcMain.handle('aesthetic:initialize', async () => {
        try {
            await ensureKnowledgeServiceInitialized();
            return { success: true };
        } catch (error: any) {
            console.error('[AestheticHandlers] 初始化失败:', error.message);
            return { success: false, error: error.message };
        }
    });

    /**
     * 获取设计类型的审美参考
     */
    ipcMain.handle('aesthetic:getReferences', async (_event, params: {
        designType: DesignType;
        style?: DesignStyle;
    }) => {
        try {
            await ensureKnowledgeServiceInitialized();
            const service = getAestheticKnowledgeService();
            const references = service.getReferencesForDesignType(params.designType, params.style);
            return { success: true, references };
        } catch (error: any) {
            console.error('[AestheticHandlers] getReferences 错误:', error.message);
            return { success: false, references: [], error: error.message };
        }
    });

    /**
     * 获取布局知识
     */
    ipcMain.handle('aesthetic:getLayoutKnowledge', async (_event, params: {
        designType?: DesignType;
        keywords?: string[];
    }) => {
        try {
            await ensureKnowledgeServiceInitialized();
            const service = getAestheticKnowledgeService();
            const knowledge = service.getLayoutKnowledge(params.designType, params.keywords);
            return { success: true, knowledge };
        } catch (error: any) {
            console.error('[AestheticHandlers] getLayoutKnowledge 错误:', error.message);
            return { success: false, knowledge: [], error: error.message };
        }
    });

    /**
     * 获取配色知识
     */
    ipcMain.handle('aesthetic:getColorKnowledge', async (_event, scenario?: string) => {
        try {
            await ensureKnowledgeServiceInitialized();
            const service = getAestheticKnowledgeService();
            const knowledge = service.getColorKnowledge(scenario);
            return { success: true, knowledge };
        } catch (error: any) {
            console.error('[AestheticHandlers] getColorKnowledge 错误:', error.message);
            return { success: false, knowledge: [], error: error.message };
        }
    });

    /**
     * 获取字体知识
     */
    ipcMain.handle('aesthetic:getTypographyKnowledge', async (_event, params: {
        purpose?: 'headline' | 'body' | 'accent' | 'label';
        designType?: DesignType;
    }) => {
        try {
            await ensureKnowledgeServiceInitialized();
            const service = getAestheticKnowledgeService();
            const knowledge = service.getTypographyKnowledge(params.purpose, params.designType);
            return { success: true, knowledge };
        } catch (error: any) {
            console.error('[AestheticHandlers] getTypographyKnowledge 错误:', error.message);
            return { success: false, knowledge: [], error: error.message };
        }
    });

    /**
     * 生成知识上下文（供 AI 使用）
     */
    ipcMain.handle('aesthetic:generateKnowledgeContext', async (_event, params: {
        designType: DesignType;
        style?: DesignStyle;
    }) => {
        try {
            await ensureKnowledgeServiceInitialized();
            const service = getAestheticKnowledgeService();
            const context = service.generateKnowledgeContext(params.designType, params.style);
            return { success: true, context };
        } catch (error: any) {
            console.error('[AestheticHandlers] generateKnowledgeContext 错误:', error.message);
            return { success: false, context: '', error: error.message };
        }
    });

    /**
     * 获取知识库统计信息
     */
    ipcMain.handle('aesthetic:getStatistics', async () => {
        try {
            await ensureKnowledgeServiceInitialized();
            const service = getAestheticKnowledgeService();
            const stats = service.getStatistics();
            return { success: true, stats };
        } catch (error: any) {
            console.error('[AestheticHandlers] getStatistics 错误:', error.message);
            return { success: false, stats: null, error: error.message };
        }
    });

    // ==================== 审美决策服务 ====================

    /**
     * 执行审美决策
     */
    ipcMain.handle('aesthetic:makeDecision', async (_event, request: AestheticDecisionRequest) => {
        try {
            await ensureKnowledgeServiceInitialized();
            const service = getAestheticDecisionService();
            const result = await service.makeDecision(request);
            return { success: true, result };
        } catch (error: any) {
            console.error('[AestheticHandlers] makeDecision 错误:', error.message);
            return { 
                success: false, 
                result: {
                    success: false,
                    confidence: 0,
                    scale: 1,
                    position: { x: 0, y: 0, anchor: 'center' as const },
                    reason: '决策失败: ' + error.message,
                    referencedKnowledge: [],
                    processingTime: 0
                },
                error: error.message 
            };
        }
    });

    /**
     * 批量审美决策
     */
    ipcMain.handle('aesthetic:makeMultipleDecisions', async (_event, requests: AestheticDecisionRequest[]) => {
        try {
            await ensureKnowledgeServiceInitialized();
            const service = getAestheticDecisionService();
            const results = await service.makeMultipleDecisions(requests);
            return { success: true, results };
        } catch (error: any) {
            console.error('[AestheticHandlers] makeMultipleDecisions 错误:', error.message);
            return { success: false, results: [], error: error.message };
        }
    });

    /**
     * 生成决策提示词（供 AI Agent 使用）
     */
    ipcMain.handle('aesthetic:generateDecisionPrompt', async (_event, params: {
        designType: DesignType;
        canvasSize: { width: number; height: number };
        assetInfo: { width: number; height: number; subjectRatio?: number };
        userIntent?: string;
    }) => {
        try {
            await ensureKnowledgeServiceInitialized();
            const service = getAestheticKnowledgeService();
            const prompt = service.generateDecisionPrompt(
                params.designType,
                params.canvasSize,
                params.assetInfo,
                params.userIntent
            );
            return { success: true, prompt };
        } catch (error: any) {
            console.error('[AestheticHandlers] generateDecisionPrompt 错误:', error.message);
            return { success: false, prompt: '', error: error.message };
        }
    });

    // ==================== 产品库服务 ====================

    /**
     * 初始化产品库
     */
    ipcMain.handle('productLibrary:initialize', async () => {
        try {
            await ensureProductLibraryInitialized();
            return { success: true };
        } catch (error: any) {
            console.error('[AestheticHandlers] 产品库初始化失败:', error.message);
            return { success: false, error: error.message };
        }
    });

    /**
     * 创建产品库
     */
    ipcMain.handle('productLibrary:create', async (_event, params: {
        name: string;
        assetRootPath: string;
        description?: string;
    }) => {
        try {
            await ensureProductLibraryInitialized();
            const service = getProductLibraryService();
            const library = await service.createLibrary(params.name, params.assetRootPath, params.description);
            return { success: true, library };
        } catch (error: any) {
            console.error('[AestheticHandlers] productLibrary:create 错误:', error.message);
            return { success: false, library: null, error: error.message };
        }
    });

    /**
     * 获取所有产品库
     */
    ipcMain.handle('productLibrary:getAll', async () => {
        try {
            await ensureProductLibraryInitialized();
            const service = getProductLibraryService();
            const libraries = service.getAllLibraries();
            return { success: true, libraries };
        } catch (error: any) {
            console.error('[AestheticHandlers] productLibrary:getAll 错误:', error.message);
            return { success: false, libraries: [], error: error.message };
        }
    });

    /**
     * 扫描文件夹创建产品库
     */
    ipcMain.handle('productLibrary:scanAndCreate', async (_event, params: {
        folderPath: string;
        libraryName: string;
        autoAnalyze?: boolean;
    }) => {
        try {
            await ensureProductLibraryInitialized();
            const service = getProductLibraryService();
            const library = await service.scanAndCreateLibrary(
                params.folderPath,
                params.libraryName,
                { autoAnalyze: params.autoAnalyze }
            );
            return { success: true, library };
        } catch (error: any) {
            console.error('[AestheticHandlers] productLibrary:scanAndCreate 错误:', error.message);
            return { success: false, library: null, error: error.message };
        }
    });

    /**
     * 根据卖点搜索产品图片
     */
    ipcMain.handle('productLibrary:searchBySellingPoint', async (_event, params: {
        libraryId: string;
        sellingPoint: string;
    }) => {
        try {
            await ensureProductLibraryInitialized();
            const service = getProductLibraryService();
            const results = await service.searchBySellingPoint(params.libraryId, params.sellingPoint);
            return { success: true, results };
        } catch (error: any) {
            console.error('[AestheticHandlers] productLibrary:searchBySellingPoint 错误:', error.message);
            return { success: false, results: [], error: error.message };
        }
    });

    /**
     * 根据设计类型推荐产品图片
     */
    ipcMain.handle('productLibrary:recommendForDesignType', async (_event, params: {
        libraryId: string;
        designType: DesignType;
        sellingPoints?: string[];
    }) => {
        try {
            await ensureProductLibraryInitialized();
            const service = getProductLibraryService();
            const assets = await service.recommendForDesignType(
                params.libraryId,
                params.designType,
                params.sellingPoints
            );
            return { success: true, assets };
        } catch (error: any) {
            console.error('[AestheticHandlers] productLibrary:recommendForDesignType 错误:', error.message);
            return { success: false, assets: [], error: error.message };
        }
    });

    /**
     * 从 CSV 导入产品信息
     */
    ipcMain.handle('productLibrary:importFromCSV', async (_event, params: {
        libraryId: string;
        csvContent: string;
    }) => {
        try {
            await ensureProductLibraryInitialized();
            const service = getProductLibraryService();
            const result = await service.importFromCSV(params.libraryId, params.csvContent);
            return { success: true, result };
        } catch (error: any) {
            console.error('[AestheticHandlers] productLibrary:importFromCSV 错误:', error.message);
            return { success: false, result: null, error: error.message };
        }
    });

    // ==================== 趋势感知服务 ====================

    /**
     * 初始化趋势服务
     */
    ipcMain.handle('trend:initialize', async () => {
        try {
            if (!trendServiceInitialized) {
                const service = getTrendSensingService();
                await service.initialize();
                trendServiceInitialized = true;
            }
            return { success: true };
        } catch (error: any) {
            console.error('[AestheticHandlers] 趋势服务初始化失败:', error.message);
            return { success: false, error: error.message };
        }
    });

    /**
     * 设置 Tavily API Key
     */
    ipcMain.handle('trend:setApiKey', async (_event, params: {
        provider: 'tavily' | 'serpapi';
        apiKey: string;
    }) => {
        try {
            const service = getTrendSensingService();
            service.setApiKey(params.provider, params.apiKey);
            return { success: true };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });

    /**
     * 获取当前设计趋势
     */
    ipcMain.handle('trend:getCurrentTrends', async (_event, forceRefresh: boolean = false) => {
        try {
            if (!trendServiceInitialized) {
                const service = getTrendSensingService();
                await service.initialize();
                trendServiceInitialized = true;
            }
            const service = getTrendSensingService();
            const trends = await service.getCurrentTrends(forceRefresh);
            return { success: true, trends };
        } catch (error: any) {
            console.error('[AestheticHandlers] trend:getCurrentTrends 错误:', error.message);
            return { success: false, trends: null, error: error.message };
        }
    });

    /**
     * 搜索设计趋势
     */
    ipcMain.handle('trend:search', async (_event, query: string) => {
        try {
            const service = getTrendSensingService();
            const results = await service.searchDesignTrends(query);
            return { success: true, results };
        } catch (error: any) {
            console.error('[AestheticHandlers] trend:search 错误:', error.message);
            return { success: false, results: [], error: error.message };
        }
    });

    /**
     * 检测设计是否过时
     */
    ipcMain.handle('trend:checkIfOutdated', async (_event, designFeatures: {
        style?: string;
        colors?: string[];
        layout?: string;
    }) => {
        try {
            const service = getTrendSensingService();
            const result = await service.checkIfOutdated(designFeatures);
            return { success: true, result };
        } catch (error: any) {
            console.error('[AestheticHandlers] trend:checkIfOutdated 错误:', error.message);
            return { success: false, result: null, error: error.message };
        }
    });

    // ==================== VLM 审美分析服务 ====================

    /**
     * 初始化 VLM 服务
     */
    ipcMain.handle('vlm:initialize', async () => {
        try {
            if (!vlmServiceInitialized) {
                const service = getVLMAestheticService();
                if (modelServiceInstance) {
                    service.setModelService(modelServiceInstance);
                }
                await service.initialize();
                vlmServiceInitialized = true;
            }
            return { success: true };
        } catch (error: any) {
            console.error('[AestheticHandlers] VLM 服务初始化失败:', error.message);
            return { success: false, error: error.message };
        }
    });

    /**
     * 设置视觉模型
     */
    ipcMain.handle('vlm:setVisionModel', async (_event, modelId: string) => {
        try {
            const service = getVLMAestheticService();
            service.setVisionModelId(modelId);
            return { success: true };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });

    /**
     * 分析设计图片
     */
    ipcMain.handle('vlm:analyzeDesign', async (_event, request: DesignAnalysisRequest) => {
        try {
            const service = getVLMAestheticService();
            if (!vlmServiceInitialized) {
                if (modelServiceInstance) {
                    service.setModelService(modelServiceInstance);
                }
                await service.initialize();
                vlmServiceInitialized = true;
            }
            const result = await service.analyzeDesign(request);
            return { success: true, result };
        } catch (error: any) {
            console.error('[AestheticHandlers] vlm:analyzeDesign 错误:', error.message);
            return { success: false, result: null, error: error.message };
        }
    });

    /**
     * 验证设计决策
     */
    ipcMain.handle('vlm:validateDecision', async (_event, params: {
        decision: any;
        designType: DesignType;
        context?: string;
        currentDesignImage?: string;
    }) => {
        try {
            const service = getVLMAestheticService();
            const result = await service.validateDecision(params);
            return { success: true, result };
        } catch (error: any) {
            console.error('[AestheticHandlers] vlm:validateDecision 错误:', error.message);
            return { success: false, result: null, error: error.message };
        }
    });

    /**
     * 对比两个设计
     */
    ipcMain.handle('vlm:compareDesigns', async (_event, params: {
        imageA: string;
        imageB: string;
        criteria?: ('aesthetics' | 'uniqueness' | 'marketFit')[];
    }) => {
        try {
            const service = getVLMAestheticService();
            const result = await service.compareDesigns(params);
            return { success: true, result };
        } catch (error: any) {
            console.error('[AestheticHandlers] vlm:compareDesigns 错误:', error.message);
            return { success: false, result: null, error: error.message };
        }
    });

    // ==================== 用户标记"好设计" ====================

    /**
     * 标记好设计
     */
    ipcMain.handle('aesthetic:markGoodDesign', async (_event, params: {
        imageBase64: string;
        designType: DesignType;
        style?: DesignStyle;
        reason?: string;
        tags?: string[];
    }) => {
        try {
            const newDesign: MarkedDesign = {
                id: crypto.randomUUID(),
                imageBase64: params.imageBase64,
                designType: params.designType,
                style: params.style,
                reason: params.reason,
                tags: params.tags || [],
                markedAt: new Date().toISOString()
            };
            
            markedDesigns.push(newDesign);
            saveMarkedDesigns();
            
            console.log(`[AestheticHandlers] ✅ 用户标记好设计: ${newDesign.id} (${params.designType})`);
            return { success: true, id: newDesign.id };
        } catch (error: any) {
            console.error('[AestheticHandlers] markGoodDesign 错误:', error.message);
            return { success: false, error: error.message };
        }
    });

    /**
     * 获取用户标记的好设计
     */
    ipcMain.handle('aesthetic:getUserMarkedDesigns', async (_event, params?: {
        designType?: DesignType;
        style?: DesignStyle;
        limit?: number;
    }) => {
        try {
            let results = [...markedDesigns];
            
            // 过滤
            if (params?.designType) {
                results = results.filter(d => d.designType === params.designType);
            }
            if (params?.style) {
                results = results.filter(d => d.style === params.style);
            }
            
            // 按时间倒序
            results.sort((a, b) => new Date(b.markedAt).getTime() - new Date(a.markedAt).getTime());
            
            // 限制数量
            if (params?.limit) {
                results = results.slice(0, params.limit);
            }
            
            return { success: true, designs: results };
        } catch (error: any) {
            console.error('[AestheticHandlers] getUserMarkedDesigns 错误:', error.message);
            return { success: false, designs: [], error: error.message };
        }
    });

    /**
     * 删除标记的好设计
     */
    ipcMain.handle('aesthetic:removeMarkedDesign', async (_event, designId: string) => {
        try {
            const index = markedDesigns.findIndex(d => d.id === designId);
            if (index !== -1) {
                markedDesigns.splice(index, 1);
                saveMarkedDesigns();
                return { success: true };
            }
            return { success: false, error: '设计不存在' };
        } catch (error: any) {
            console.error('[AestheticHandlers] removeMarkedDesign 错误:', error.message);
            return { success: false, error: error.message };
        }
    });

    console.log('[AestheticHandlers] ✅ 审美决策 IPC handlers 注册完成');
}
