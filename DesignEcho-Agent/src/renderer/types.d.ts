import type { ContextSnapshot, ProjectAssetIndex } from '../shared/project-asset-index';
import type { ProjectVisualInsightCacheReadResult } from '../shared/project-visual-insight-cache';
import type { DesignKnowledgeResult } from '../shared/design-knowledge-search';
import type {
    ProjectVisualSamplingCacheEntry,
    ProjectVisualSamplingPlan,
    ProjectVisualSamplingScenario
} from '../shared/project-visual-sampling';

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
        xiaomi?: string;
        openai?: string;
        gptsapi?: string;
        openrouter?: string;
        deepseek?: string;
        ollamaUrl?: string;
        ollamaApiKey?: string;
        bfl?: string;
        volcengineJimengAccessKeyId?: string;
        volcengineJimengSecretAccessKey?: string;
        volcengineSeedreamApiKey?: string;
        volcengineTosRegion?: string;
        volcengineTosEndpoint?: string;
        volcengineTosBucket?: string;
        volcengineTosPublicBaseUrl?: string;
        volcengineTosKeyPrefix?: string;
    }) => Promise<void>;

    testVolcengineJimengCredentials?: (accessKeyId: string, secretAccessKey: string) => Promise<{
        success: boolean;
        message?: string;
        error?: string;
    }>;

    testVolcengineSeedreamApiKey?: (apiKey: string) => Promise<{
        success: boolean;
        message?: string;
        error?: string;
        status?: number;
    }>;

    testDeepSeek?: (apiKey: string) => Promise<{
        success: boolean;
        message?: string;
        error?: string;
        status?: number;
        baseUrl?: string;
        model?: string;
        usage?: {
            inputTokens: number;
            outputTokens: number;
        };
    }>;

    probeDesignKnowledgeSearxng?: (settings: unknown) => Promise<{
        success: boolean;
        status?: 'disabled' | 'missing_endpoint' | 'ok' | 'unavailable';
        endpoint?: string;
        httpStatus?: number;
        warnings?: string[];
        error?: string;
    }>;

    probeDesignKnowledgeEagleReadonly?: (settings?: {
        enabled?: boolean;
        endpoint?: string;
        timeoutMs?: number;
    }) => Promise<{
        success: boolean;
        status: 'disabled' | 'ok' | 'unavailable';
        endpoint: string;
        app?: unknown;
        aiSearch?: unknown;
        warnings: string[];
        error?: string;
    }>;

    searchEagleReadonlyKnowledge?: (query: {
        query: string;
        limit?: number;
        preferAiSearch?: boolean;
        tags?: string[];
        folders?: string[];
        ext?: string;
        selectedOnly?: boolean;
    }, settings?: {
        enabled?: boolean;
        endpoint?: string;
        timeoutMs?: number;
    }) => Promise<{
        version: 'eagle-readonly-knowledge/v0';
        status: 'disabled' | 'ok' | 'unavailable';
        query: string;
        results: Array<DesignKnowledgeResult & { sourceType: 'eagle_library' | DesignKnowledgeResult['sourceType'] }>;
        providerSummary: {
            eagleLibrary: number;
        };
        warnings: string[];
        boundaries: {
            readonly: true;
            doesNotWriteEagle: true;
            doesNotRunPhotoshop: true;
            doesNotReturnRawImages: true;
            allowedTools: string[];
        };
    }>;

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
    chatWithTools?: (modelId: string, messages: any[], tools: any[], options?: any) => Promise<any>;
    chatStream?: (params: {
        requestId: string;
        modelId: string;
        messages: Array<{ role: string; content: string }>;
        options?: { maxTokens?: number; temperature?: number };
    }) => Promise<{ success: boolean; error?: string; requestId?: string }>;
    chatWithToolsStream?: (params: {
        requestId: string;
        modelId: string;
        messages: any[];
        tools: any[];
        options?: { maxTokens?: number; temperature?: number; nativeTools?: any[] };
    }) => Promise<{ success: boolean; error?: string; requestId?: string }>;
    abortStream?: (requestId: string) => Promise<{ success: boolean; error?: string }>;
    onStreamChunk?: (callback: (data: { requestId: string; chunk: any }) => void) => () => void;
    
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
    selectFile: (options?: { title?: string; filters?: { name: string; extensions: string[] }[] }) => Promise<string | null>;
    readFile: (path: string, encoding?: string) => Promise<string>;
    readDirectory: (path: string, options?: { recursive?: boolean; filter?: string[] }) => Promise<{
        name: string;
        path: string;
        type: 'file' | 'directory';
        ext?: string;
        size?: number;
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
    probeImageFile: (imagePath: string) => Promise<{
        success: boolean;
        path: string;
        status: 'ok' | 'missing' | 'not_file' | 'unsupported' | 'decode_failed';
        exists: boolean;
        isFile: boolean;
        byteLength?: number;
        format?: string;
        mimeType?: string;
        dimensions?: { width: number; height: number };
        sha256?: string;
        rawImagesRedacted: true;
        error?: string;
    }>;
    compareImageFiles: (referencePath: string, resultPath: string, options?: {
        targetSize?: { width?: number; height?: number };
        thresholds?: {
            maxMae?: number;
            maxHighDeltaRatio?: number;
            minDarkJaccard?: number;
            minSoftDarkJaccard?: number;
            softMaskBlurSigma?: number;
            softMaskDarkThreshold?: number;
        };
    }) => Promise<{
        success: boolean;
        status: 'ok' | 'watch' | 'unverified';
        mode: 'pixel-probe';
        referencePath: string;
        resultPath: string;
        width?: number;
        height?: number;
        mae?: number;
        rmse?: number;
        highDeltaRatio?: number;
        darkJaccard?: number;
        softDarkJaccard?: number;
        softMaskBlurSigma?: number;
        softMaskDarkThreshold?: number;
        referenceDarkPixels?: number;
        resultDarkPixels?: number;
        summary?: string;
        boundary: string;
        rawImagesRedacted: true;
        error?: string;
    }>;
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
    buildProjectContextSnapshot?: (options: string | {
        projectPath: string;
        projectName?: string;
        currentDocument?: any;
        selectedAssetPaths?: string[];
        userConstraints?: string[];
        taskHistory?: string[];
        unverifiedItems?: string[];
        visualSamplingScenario?: ProjectVisualSamplingScenario;
        maxVisualSamples?: number;
        visualSamplingCache?: ProjectVisualSamplingCacheEntry[];
        usePersistedVisualInsightCache?: boolean;
    }) => Promise<{
        success: true;
        source: 'runtime-project-service';
        projectPath: string;
        projectName: string;
        contextSnapshot: ContextSnapshot;
        assetIndex: ProjectAssetIndex;
        visualSamplingPlan: ProjectVisualSamplingPlan;
        visualInsightCache: ProjectVisualInsightCacheReadResult;
        warnings: string[];
        limitations: string[];
    }>;
    writeProjectVisualInsightCache?: (options: {
        projectPath: string;
        entries: ProjectVisualSamplingCacheEntry[];
        replace?: boolean;
        nowIso?: string;
    }) => Promise<{
        success: true;
        source: 'runtime-project-service';
        cachePath: string;
        manifest: any;
        readResult: ProjectVisualInsightCacheReadResult;
    }>;
    
    // ===== 项目索引进度 =====
    onProjectIndexProgress?: (callback: (data: { projectId: string; current: number; total: number; phase?: 'project' | 'file'; fileName?: string }) => void) => () => void;

    // ===== 通用 IPC 调用 =====
    invoke: (channel: string, ...args: any[]) => Promise<any>;
    
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
        __DESIGNECHO_CHAT_TEST_BRIDGE__?: {
            version: number;
            submit: (
                text: string,
                options?: {
                    image?: { data: string; type: string };
                    timeoutMs?: number;
                }
            ) => Promise<{
                isLoading: boolean;
                messageCount: number;
                messages: Array<{
                    id: string;
                    role: string;
                    contentPreview: string;
                    hasImage: boolean;
                    thinkingStepCount: number;
                    toolResultCount: number;
                }>;
            }>;
            getSnapshot: () => {
                isLoading: boolean;
                messageCount: number;
                messages: Array<{
                    id: string;
                    role: string;
                    contentPreview: string;
                    hasImage: boolean;
                    thinkingStepCount: number;
                    toolResultCount: number;
                }>;
            };
            waitForIdle: (timeoutMs?: number) => Promise<{
                isLoading: boolean;
                messageCount: number;
                messages: Array<{
                    id: string;
                    role: string;
                    contentPreview: string;
                    hasImage: boolean;
                    thinkingStepCount: number;
                    toolResultCount: number;
                }>;
            }>;
        };
    }
}
