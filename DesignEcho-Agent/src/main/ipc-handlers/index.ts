/**
 * IPC Handlers 注册入口
 * 将原本集中在 index.ts 的 54 个 IPC handlers 拆分为独立模块注册
 */

import { registerConfigHandlers, getMorphingSettingsCache, getUserMattingConfig } from './config-handlers';
import { registerLogHandlers } from './log-handlers';
import { registerMattingHandlers } from './matting-handlers';
import { registerWebSocketHandlers } from './websocket-handlers';
import { registerOllamaHandlers } from './ollama-handlers';
import { registerFileSystemHandlers } from './file-system-handlers';
import { registerResourceHandlers } from './resource-handlers';
import { registerDesignStateHandlers } from './design-state-handlers';
import { registerRunRecordHandlers } from './run-record-handlers';
import { registerArtifactRepositoryHandlers } from './artifact-repository-handlers';
import { registerInteractiveContinuationOperationHandlers } from './interactive-continuation-operation-handlers';
import { registerPsdDesignSourceHandlers } from './psd-design-source-handlers';
import { registerModelDownloadHandlers } from './model-download-handlers';
import { registerEcommerceProjectHandlers } from './ecommerce-project-handlers';

import { registerDesignSpecHandlers } from './design-spec-handlers';
import { registerSKUHandlers } from './sku-handlers';
import { registerSkuRetouchHandlers } from './sku-retouch-handlers';
import { registerSmartLayoutHandlers, setMattingService } from './smart-layout-handlers';
import { registerBFLHandlers } from './bfl-handlers';
import { registerTemplateKnowledgeHandlers } from './template-knowledge-handlers';
import { registerDesignNotesHandlers } from './design-notes-handlers';
import { registerMCPHandlers } from './mcp-handlers';
import { registerInpaintingHandlers } from './inpainting-handlers';
import { registerDesignWorkshopHandlers } from './design-workshop-handlers';
import { registerVisualThinkingHandlers } from './visual-thinking-handlers';
import { registerWebPageHandlers } from './web-page-handlers';
import { registerBrowserBridgeHandlers } from './browser-bridge-handlers';
import { registerScreenshotHandlers } from './screenshot-handlers';
import { registerConversationHandlers } from './conversation-handlers';
import { registerStreamHandlers } from './stream-handlers';
import { registerDesignKnowledgeHandlers } from './design-knowledge-handlers';
import { registerEagleKnowledgeHandlers } from './eagle-knowledge-handlers';
import { registerSkillPackageHandlers } from './skill-package-handlers';
import { registerEagleLibraryHandlers } from './eagle-library-handlers';
import { registerWebSearchHandlers } from './web-search-handlers';
import { registerModelListingHandlers } from './model-listing-handlers';
import { registerAppUpdateHandlers } from './app-update-handlers';
import { registerClaudeSubscriptionHandlers } from './claude-subscription-handlers';
import { registerCodexSubscriptionHandlers } from './codex-subscription-handlers';
import { registerRuntimeHandlers } from './runtime-handlers';
import type { IPCContext } from './types';

export { IPCContext } from './types';
export { getMorphingSettingsCache, getUserMattingConfig };

/**
 * 注册所有 IPC handlers
 */
export function setupIPCHandlers(context: IPCContext): void {
    // 当前 Main Runtime 身份与本地端点；必须先于任何 Renderer MCP 调用注册。
    registerRuntimeHandlers(context);

    // 配置管理
    registerConfigHandlers(context);
    
    // 日志管理
    registerLogHandlers(context);
    
    // 抠图（Matting）服务
    registerMattingHandlers(context);
    
    // WebSocket 服务
    registerWebSocketHandlers(context);

    // 模型流式输出服务。preload 已暴露 chatStream/abortStream，这里必须注册对应 IPC。
    if (context.modelService) {
        registerStreamHandlers(context.modelService);
    } else {
        console.warn('[IPC] Model service is unavailable; stream handlers were not registered');
    }
    
    // Ollama 本地模型服务
    registerOllamaHandlers(context);
    
    // 文件系统操作
    registerFileSystemHandlers(context);
    
    // 资源管理服务
    registerResourceHandlers(context);

    // Design Project State（共享设计项目状态）
    registerDesignStateHandlers();
    registerArtifactRepositoryHandlers(context);
    registerRunRecordHandlers();
    registerInteractiveContinuationOperationHandlers();

    // 设计源解析（PSD 知识库 P0：离线读设计师 PSD/PSB 结构，只读不落盘）
    registerPsdDesignSourceHandlers();

    // 模型下载服务
    registerModelDownloadHandlers(context);
    
    // 电商项目管理服务
    registerEcommerceProjectHandlers(context);
    
    // 设计规格处理服务
    registerDesignSpecHandlers(context);
    
    // SKU 生成管理
    registerSKUHandlers(context);
    registerSkuRetouchHandlers(context);
    
    // 智能排版服务
    registerSmartLayoutHandlers();
    // 注入 MattingService（如果有）
    if (context.mattingService) {
        setMattingService(context.mattingService);
    }

    // Black Forest Labs (FLUX) 图像生成服务
    registerBFLHandlers();
    
    // 模板库服务
    registerTemplateKnowledgeHandlers();

    // 设计知识笔记（用户与 Agent 共写的 Markdown 笔记库，Obsidian 兼容）
    registerDesignNotesHandlers();
    
    // 以上为核心业务 handlers，以下为扩展功能
    
    // MCP 外部工具集成服务（网页抓取、Behance 等）
    registerMCPHandlers();

    // 网页自动化处理服务（Playwright）
    registerWebPageHandlers();

    // 浏览器扩展桥（Agent 操作用户真实浏览器，见 docs/browser-extension-bridge.md）
    registerBrowserBridgeHandlers();

    // 截图服务（供 Agent 内部视觉验证使用）
    registerScreenshotHandlers();
    
    // 局部重绘服务
    registerInpaintingHandlers(context);

    // composeDesign 车间：生成场景底（参照图定光线，产出不含产品 / 文字的空场景）
    registerDesignWorkshopHandlers(context);

    // 视觉思考服务（将 Photoshop 截图发送给多模态模型进行视觉分析）
    registerVisualThinkingHandlers(context);

    // 对话持久化（独立文件存储）
    registerConversationHandlers(context);

    // 设计知识设置与只读健康检查（注入 modelService 让搜索能用小米 web_search 作主力）
    registerDesignKnowledgeHandlers(context.modelService);
    registerEagleKnowledgeHandlers(context);
    registerSkillPackageHandlers();
    registerEagleLibraryHandlers(context);

    // 通用联网搜索（DeepSeek 原生 web_search，复用已配置的 DeepSeek provider key）
    registerWebSearchHandlers(context.modelService);

    // Provider 列模型服务（从各 provider 官方接口拉取最新模型 id，合并进设置可选列表）
    registerModelListingHandlers(context);

    // ChatGPT 订阅登录、目录与限额；协议和凭据不向 renderer 暴露。
    registerCodexSubscriptionHandlers(context);
    registerClaudeSubscriptionHandlers(context);

    // 应用自更新（electron-updater 泛化静态源）：注册即启动周期检查；
    // 更新源是主进程常量，Renderer 只读状态并显式触发安装。
    registerAppUpdateHandlers(context);

}
