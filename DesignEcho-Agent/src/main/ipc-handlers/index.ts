/**
 * IPC Handlers 统一注册入口
 * 将原本集中在 index.ts 中的 54 个 IPC handlers 按功能模块化
 */

import { registerConfigHandlers, getMorphingSettingsCache, getUserMattingConfig } from './config-handlers';
import { registerLogHandlers } from './log-handlers';
import { registerMattingHandlers } from './matting-handlers';
import { registerWebSocketHandlers } from './websocket-handlers';
import { registerOllamaHandlers } from './ollama-handlers';
import { registerFileSystemHandlers } from './file-system-handlers';
import { registerResourceHandlers } from './resource-handlers';
import { registerModelDownloadHandlers } from './model-download-handlers';
import { registerEcommerceProjectHandlers } from './ecommerce-project-handlers';
import { registerKnowledgeHandlers } from './knowledge-handlers';
import { registerUserKnowledgeHandlers } from './user-knowledge-handlers';
import { registerKnowledgeBridgeHandlers } from './knowledge-bridge-handlers';
import { registerTemplateHandlers } from './template-handlers';
import { registerDesignSpecHandlers } from './design-spec-handlers';
import { registerSKUHandlers } from './sku-handlers';
import { registerSmartLayoutHandlers, setMattingService } from './smart-layout-handlers';
import { registerHarmonizationHandlers } from './harmonization-handlers';
import { registerSKUKnowledgeHandlers } from './sku-knowledge-handlers';
import { registerBFLHandlers } from './bfl-handlers';
import { registerTemplateKnowledgeHandlers } from './template-knowledge-handlers';
import { registerAestheticHandlers, setModelServiceForAesthetic } from './aesthetic-handlers';
import { registerMCPHandlers } from './mcp-handlers';
import { registerKnowledgeManagementHandlers } from './knowledge-management-handlers';
import { registerInpaintingHandlers } from './inpainting-handlers';
import { registerBrandSpecHandlers } from './brand-spec-handlers';
import { registerVisualThinkingHandlers } from './visual-thinking-handlers';
import { registerWebPageHandlers } from './web-page-handlers';
import { registerScreenshotHandlers } from './screenshot-handlers';
import { registerConversationHandlers } from './conversation-handlers';
import type { IPCContext } from './types';

export { IPCContext } from './types';
export { getMorphingSettingsCache, getUserMattingConfig };
export { setModelServiceForAesthetic };

/**
 * 注册所有 IPC handlers
 */
export function setupIPCHandlers(context: IPCContext): void {
    // 配置相关
    registerConfigHandlers(context);
    
    // 日志相关
    registerLogHandlers(context);
    
    // 抠图服务相关
    registerMattingHandlers(context);
    
    // WebSocket 相关
    registerWebSocketHandlers(context);
    
    // Ollama 模型管理
    registerOllamaHandlers(context);
    
    // 文件系统相关
    registerFileSystemHandlers(context);
    
    // 资源管理相关
    registerResourceHandlers(context);
    
    // 模型下载相关
    registerModelDownloadHandlers(context);
    
    // 电商项目相关
    registerEcommerceProjectHandlers(context);
    
    // 知识库相关
    registerKnowledgeHandlers(context);
    
    // 用户自定义知识
    registerUserKnowledgeHandlers(context);
    
    // 知识桥接（供 Agent 使用）
    registerKnowledgeBridgeHandlers(context);
    
    // 模板系统
    registerTemplateHandlers(context);
    
    // 设计规范引擎
    registerDesignSpecHandlers(context);
    
    // SKU 批量生成
    registerSKUHandlers(context);
    
    // 智能布局服务
    registerSmartLayoutHandlers();
    // 注入 MattingService（如果有）
    if (context.mattingService) {
        setMattingService(context.mattingService);
    }
    
    // 图像协调服务
    registerHarmonizationHandlers();
    
    // SKU 组合知识库
    registerSKUKnowledgeHandlers();
    
    // BFL (Black Forest Labs) 图像生成
    registerBFLHandlers();
    
    // 模板知识库
    registerTemplateKnowledgeHandlers();
    
    // 审美知识库与决策服务
    registerAestheticHandlers();
    
    // MCP 设计平台爬虫 (花瓣/站酷/Behance)
    registerMCPHandlers();

    // 网页内容提取 (Playwright)
    registerWebPageHandlers();

    // 截图能力（Agent窗口与桌面）
    registerScreenshotHandlers();
    
    // 知识库管理（清空数据等）
    registerKnowledgeManagementHandlers();

    // 局部重绘服务
    registerInpaintingHandlers(context);

    // 品牌规范
    registerBrandSpecHandlers();

    // 视觉分析（支持本地图片）
    registerVisualThinkingHandlers(context);

    // 对话持久化（独立文件存储）
    registerConversationHandlers(context);
}
