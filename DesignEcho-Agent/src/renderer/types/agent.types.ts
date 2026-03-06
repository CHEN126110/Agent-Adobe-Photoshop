
export interface PhotoshopContext {
    hasDocument: boolean;
    documentName?: string;
    canvasSize?: { width: number; height: number };
    activeLayerName?: string;
    layerCount?: number;
}

export interface ProjectContext {
    projectPath?: string;
    hasSkuFiles?: boolean;
    hasTemplates?: boolean;
    availableColors?: string[];
}

export interface AgentContext {
    /** 用户原始输入 */
    userInput: string;
    /** 对话历史 */
    conversationHistory: Array<{ role: string; content: string }>;
    /** Photoshop 是否连接 */
    isPluginConnected: boolean;
    /** 当前 Photoshop 状态 */
    photoshopContext?: PhotoshopContext;
    /** 项目上下文 */
    projectContext?: ProjectContext;
    /** 用户是否附带了图片（用于视觉分析） */
    hasAttachedImage?: boolean;
    /** 用户附带的图片数据（base64） */
    attachedImageData?: string;
}

export interface AgentDecision {
    /** 决策类型 */
    type: 'tool_call' | 'skill_execution' | 'direct_response' | 'clarification_needed';
    /** 工具调用列表（当 type 为 tool_call 时） */
    toolCalls?: Array<{ toolName: string; params: any; reason: string }>;
    /** 技能 ID（当 type 为 skill_execution 时） */
    skillId?: string;
    /** 技能参数 */
    skillParams?: Record<string, any>;
    /** 直接回复内容（当 type 为 direct_response 时） */
    directResponse?: string;
    /** 澄清问题（当 type 为 clarification_needed 时） */
    clarificationQuestion?: string;
    /** AI 的思考过程（可选） */
    reasoning?: string;
    /** 后续动作 - 工具执行完成后继续执行（多步骤任务） */
    followUpAction?: {
        type: 'skill_execution' | 'tool_call';
        skillId?: string;
        skillParams?: Record<string, any>;
        toolCalls?: Array<{ toolName: string; params: any; reason: string }>;
    };
}

export interface AgentResult {
    success: boolean;
    message: string;
    toolResults?: any[];
    error?: string;
    /** 附加数据（如模板解析结果等） */
    data?: any;
}

export interface ExecutionCallbacks {
    onProgress?: (message: string, percent: number) => void;
    onToolStart?: (toolName: string) => void;
    onToolComplete?: (toolName: string, result: any) => void;
    onMessage?: (message: string) => void;
    onThinking?: (thinking: string) => void;  // 模型的思维过程
}
