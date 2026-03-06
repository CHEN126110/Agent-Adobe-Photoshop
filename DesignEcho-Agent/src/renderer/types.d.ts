export interface DownloadProgress {
    modelId: string;
    percent: number;
    downloaded: number;
    total: number;
}

export interface DesignEchoAPI {
    setApiKeys: (keys: {
        anthropic?: string;
        google?: string;
        openai?: string;
        openrouter?: string;
        ollamaUrl?: string;
        ollamaApiKey?: string;
        bfl?: string;
        volcengineAccessKeyId?: string;
        volcengineSecretAccessKey?: string;
    }) => Promise<void>;

    setModelPreferences?: (prefs: {
        mode?: 'local' | 'cloud' | 'auto';
        autoFallback?: boolean;
        preferredLocalModels?: { layoutAnalysis: string; textOptimize: string; visualAnalyze: string };
        preferredCloudModels?: { layoutAnalysis: string; textOptimize: string; visualAnalyze: string };
    }) => Promise<void>;

    sendToPlugin: (method: string, params?: any, timeout?: number) => Promise<any>;
    
    getConnectionStatus: () => Promise<{ connected: boolean }>;

    onPluginConnected: (callback: () => void) => () => void;
    onPluginDisconnected: (callback: () => void) => () => void;
    onPluginMessage: (callback: (message: any) => void) => () => void;

    executeTask: (taskType: string, input: any) => Promise<any>;
    chat: (modelId: string, messages: any[], options?: any) => Promise<any>;
    
    getAvailableTools: () => { name: string; description: string; parameters: any }[];

    // 模型下载
    downloadModel: (modelId: string, downloadUrl: string, targetPath: string) => Promise<{
        success: boolean;
        modelId?: string;
        path?: string;
        size?: number;
        error?: string;
    }>;
    
    onDownloadProgress: (callback: (progress: DownloadProgress) => void) => () => void;
    
    checkModelExists: (modelPath: string) => Promise<{
        exists: boolean;
        path: string;
    }>;

    // 文件系统操作
    selectFolder: (title?: string) => Promise<string | null>;
    readDirectory: (path: string, options?: { recursive?: boolean }) => Promise<{
        name: string;
        path: string;
        type: 'file' | 'directory';
    }[] | null>;
    openPath: (path: string) => Promise<void>;
    
    // 日志
    writeLog: (level: 'info' | 'warn' | 'error', message: string, data?: any) => Promise<{ success: boolean }>;
    getRecentLogs: (lines?: number) => Promise<string>;
    getLogPath: () => Promise<string>;
    clearLogs: () => Promise<{ success: boolean }>;
    
    // ===== 素材库管理 =====
    setProjectRoot: (rootPath: string) => Promise<{ success: boolean; projectRoot: string }>;
    getProjectRoot: () => Promise<string | null>;
    scanDirectory: (dirPath?: string, options?: {
        recursive?: boolean;
        includeDesignFiles?: boolean;
        maxDepth?: number;
        generateThumbnails?: boolean;
    }) => Promise<any>;
    searchResources: (query: string, options?: {
        directory?: string;
        type?: 'image' | 'design' | 'all';
        limit?: number;
    }) => Promise<any>;
    getResourceStructure: (directory?: string, maxDepth?: number) => Promise<any>;
    getResourceSummary: (directory?: string) => Promise<{
        totalFiles: number;
        imageCount?: number;
        [key: string]: any;
    }>;
    getResourcesByCategory: (directory?: string) => Promise<{
        products?: any[];
        backgrounds?: any[];
        elements?: any[];
        references?: any[];
        others?: any[];
    }>;
    getResourcePreview: (imagePath: string, maxSize?: number) => Promise<{
        success: boolean;
        base64?: string;
        imageData?: string;
        dimensions?: { width: number; height: number };
        error?: string;
    } | null>;
    readImageBase64: (imagePath: string) => Promise<string | null>;
    analyzeAssetContent: (imagePath: string) => Promise<any>;
    recommendAssets: (params: {
        requirement: string;
        maxResults?: number;
        category?: string;
        deterministic?: boolean;
    }) => Promise<any[]>;
    getAssetDetails: (imagePath: string) => Promise<any>;
    
    // ===== Matting 配置 =====
    setMattingSettings: (settings: {
        activeModels?: {
            textGrounding?: string;
            objectDetection?: string;
            segmentation?: string;
            edgeRefine?: string;
        };
    }) => Promise<{ success: boolean }>;
    
    // ===== 模型导入 =====
    importModel: (sourcePath: string, targetModelId: string) => Promise<{
        success: boolean;
        targetPath?: string;
        error?: string;
    }>;
    
    // ===== 形态统一设置 =====
    setMorphingSettings?: (settings: {
        subjectDetectionModel?: 'u2netp' | 'u2net' | 'silueta' | 'isnet' | 'birefnet';
        contourPrecision?: 'fast' | 'balanced' | 'quality';
        scaleThreshold?: number;
        positionThreshold?: number;
    }) => Promise<{ success: boolean }>;
    
    getMorphingSettings?: () => Promise<{
        subjectDetectionModel: string;
        contourPrecision: string;
        scaleThreshold: number;
        positionThreshold: number;
    }>;
    
    // ===== 电商项目管理 =====
    scanEcommerceProject?: (projectPath: string) => Promise<{
        projectPath: string;
        projectName: string;
        folders: any[];
        summary: {
            totalImages: number;
            totalFolders: number;
            byFolderType: Record<string, number>;
            byImageType: Record<string, number>;
        };
        config?: any;
    }>;
    
    updateFolderType?: (projectPath: string, folderName: string, type: string) => Promise<void>;
    updateImageType?: (projectPath: string, imageRelativePath: string, type: string) => Promise<void>;
    loadEcommerceConfig?: (projectPath: string) => Promise<any>;
    saveEcommerceConfig?: (projectPath: string, config: any) => Promise<void>;
    
    // ===== 知识库查询 =====
    knowledge?: {
        getAllSellingPoints: () => Promise<any[]>;
        getAllPainPoints: () => Promise<any[]>;
        getAllColorSchemes: () => Promise<any[]>;
        searchSellingPoints: (params: { keyword?: string; category?: string; limit?: number }) => Promise<any[]>;
        getPainPoints: (params: { category?: string; type?: string }) => Promise<any[]>;
        recommendColorScheme: (params: { emotion?: string; category?: string; season?: string }) => Promise<any>;
    };
    
    // ===== 项目索引进度 =====
    onProjectIndexProgress?: (callback: (data: { projectId: string; current: number; total: number; phase?: 'project' | 'file'; fileName?: string }) => void) => () => void;

    // ===== 项目设计知识学习 =====
    ingestProjectDesigns?: (params: {
        projectPath: string;
        projectId?: string;
        options?: {
            author?: string;
            categories?: string[];
            source?: 'system' | 'user' | 'learned' | 'import' | 'uxp';
            includeComponents?: boolean;
            maxComponents?: number;
        };
    }) => Promise<{
        success: boolean;
        data?: {
            projectId: string;
            totalFiles: number;
            indexed: number;
            failed: number;
            errors: Array<{ filePath: string; error: string }>;
        };
        error?: string;
    }>;
    onRAGProjectIngestProgress?: (callback: (data: { projectId: string; current: number; total: number; filePath: string }) => void) => () => void;

    // ===== RAG 知识库索引进度 =====
    onRAGIndexProgress?: (callback: (data: { phase: string; current: number; total: number; message: string }) => void) => () => void;

    // ===== 通用 IPC 调用 =====
    invoke: (channel: string, ...args: any[]) => Promise<any>;
    
    // ===== 火山引擎 局部重绘 =====
    volcengine?: {
        testCredentials: (accessKeyId: string, secretAccessKey: string) => Promise<{
            success: boolean;
            message?: string;
            error?: string;
        }>;
    };
    
    // ===== BFL (Black Forest Labs) 图片生成 =====
    bfl: {
        // 文生图: (model, prompt, options)
        text2image: (
            model: string,
            prompt: string,
            options?: {
                width?: number;
                height?: number;
                seed?: number;
                outputFormat?: 'png' | 'jpeg';
                steps?: number;
                guidance?: number;
            }
        ) => Promise<{
            success: boolean;
            data?: { id: string; url: string; width: number; height: number };
            error?: string;
        }>;
        
        // 图生图: (model, prompt, inputImage, options)
        image2image: (
            model: string,
            prompt: string,
            inputImage: string,  // base64
            options?: {
                width?: number;
                height?: number;
                additionalImages?: string[];
            }
        ) => Promise<{
            success: boolean;
            data?: { id: string; url: string; width: number; height: number };
            error?: string;
        }>;
        
        // 局部重绘: (prompt, inputImage, maskImage, options)
        inpaint: (
            prompt: string,
            inputImage: string,  // base64
            maskImage: string,   // base64
            options?: {
                width?: number;
                height?: number;
            }
        ) => Promise<{
            success: boolean;
            data?: { id: string; url: string; width: number; height: number };
            error?: string;
        }>;
        
        // 下载图像
        downloadImage: (url: string) => Promise<{
            success: boolean;
            data?: string;  // base64
            error?: string;
        }>;
        
        // 测试 API Key
        testApiKey: (apiKey: string) => Promise<{
            success: boolean;
            error?: string;
        }>;
        
        // 检查是否已配置 API Key
        hasApiKey: () => Promise<boolean>;
    };
    
    captureAgentWindowScreenshot?: () => Promise<{
        success: boolean;
        imageBase64?: string;
        mimeType?: string;
        source?: string;
        error?: string;
    }>;

    captureDesktopScreenshot?: () => Promise<{
        success: boolean;
        imageBase64?: string;
        mimeType?: string;
        source?: string;
        error?: string;
    }>;

    testBflApi?: () => Promise<{ success: boolean; error?: string }>;
}

declare global {
    interface Window {
        designEcho: DesignEchoAPI;
    }
}
