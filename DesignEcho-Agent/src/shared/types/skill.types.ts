/**
 * Skill 能力声明类型定义
 * 
 * 核心设计理念：
 * - Skill 是"能力声明"，不是"执行代码"
 * - AI 通过阅读 Skill 描述来决定使用哪个
 * - Skill 执行由独立的执行器完成
 * 
 * 架构：
 * 用户需求 → AI 理解 → AI 选择 Skill → 执行器执行 → AI 验证
 */

// ==================== Skill 参数定义 ====================

/**
 * 参数类型定义（类似 JSON Schema）
 */
export interface SkillParameter {
    /** 参数名 */
    name: string;
    /** 类型 */
    type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'image';
    /** 描述（给 AI 看的） */
    description: string;
    /** 是否必需 */
    required: boolean;
    /** 默认值 */
    default?: any;
    /** 枚举值（如果是固定选项） */
    enum?: string[];
    /** 示例值 */
    examples?: any[];
}

export type SkillCategory =
    | 'image'
    | 'layout'
    | 'text'
    | 'batch'
    | 'analysis'
    | 'export'
    | 'morphing'
    | 'replication'
    | 'ecommerce'
    | 'document';

export type SkillKind = 'workflow' | 'operation' | 'debug';

export type SkillVisibility = 'user-facing' | 'internal-debug' | 'system-only';

export interface SkillRoutingMetadata {
    /** 强信号：当用户话术出现这些语义时，应优先考虑该 skill；可用 regex: 前缀表达受控正则信号 */
    intentSignals?: string[];
    /** 分组信号：每组内满足任一项即可，但所有分组都必须命中；可用 regex: 前缀表达受控正则信号 */
    intentSignalGroups?: string[][];
    /** 负信号：当用户话术出现这些语义时，应避免误路由到该 skill */
    negativeSignals?: string[];
    /** 执行前提：帮助分类器判断当前上下文是否足够 */
    preconditions?: string[];
    /** skill 支持的模式，例如 inspect / execute / authoring */
    supportedModes?: string[];
    /** 参数抽取提示：帮助分类器从自然语言里提取 skillParams */
    parameterExtractionHints?: string[];
    /** 路由模式信号：例如 inspect / execute */
    modeSignals?: Record<string, string[]>;
    /** 续作策略：用户说“再改一下”时如何继承上一轮任务 */
    retryPolicy?: 'inherit_previous' | 're-evaluate' | 'fresh';
    /** 当上下文不足时，优先澄清的问题方向 */
    clarificationHints?: string[];
    /** 容易混淆场景下的决策提示，供分类器直接消费 */
    decisionGuidance?: string[];
    /** 路由阶段的状态摘要文案，不代表模型思考 */
    routeStatusMessages?: Partial<{
        deterministic: string;
        autonomous: string;
    }>;
}

// ==================== Skill 能力声明 ====================

/**
 * Skill 能力声明
 * 
 * AI 通过阅读这个声明来理解：
 * - 这个技能能做什么
 * - 需要什么输入
 * - 会产生什么输出
 * - 什么场景下使用
 */
export interface SkillDeclaration {
    /** 唯一标识 */
    id: string;
    
    /** 技能名称（给 AI 和用户看的） */
    name: string;
    
    /** 技能分类 */
    category: SkillCategory;

    /** 技能层级：完整工作流 / 单步操作 / 调试能力 */
    kind: SkillKind;

    /** 可见性边界：普通用户、内部调试、系统内部 */
    visibility: SkillVisibility;
    
    /** 详细描述（给 AI 看的，用于理解能力边界） */
    description: string;
    
    /** 使用场景说明（帮助 AI 判断是否适用） */
    whenToUse: string[];
    
    /** 不适用场景（防止 AI 误用） */
    whenNotToUse?: string[];

    /** 路由元数据：用于意图识别、歧义消解、参数抽取 */
    routing?: SkillRoutingMetadata;
    
    /** 输入参数定义 */
    parameters: SkillParameter[];
    
    /** 输出描述 */
    output: {
        /** 输出类型 */
        type: 'layer' | 'layers' | 'document' | 'files' | 'data' | 'none';
        /** 输出说明 */
        description: string;
    };
    
    /** 依赖的底层工具（MCP Tools） */
    requiredTools: string[];
    
    /** 示例用法（给 AI 看的） */
    examples: Array<{
        /** 用户说的话 */
        userSays: string;
        /** AI 应该传递的参数 */
        parameters: Record<string, any>;
    }>;
    
    /** 预计执行时间（秒） */
    estimatedTime?: number;
    
    /** 是否需要 AI 决策点（执行中可能需要回调 AI） */
    hasDecisionPoints?: boolean;
}

// ==================== Skill 执行相关 ====================

/**
 * Skill 执行上下文
 */
export interface SkillExecutionContext {
    /** 调用底层工具 */
    callTool: (toolName: string, params: any) => Promise<any>;
    
    /** 日志输出 */
    log: (level: 'info' | 'warn' | 'error', message: string) => void;
    
    /** 更新进度 */
    updateProgress: (step: string, percent: number) => void;
    
    /** 回调 AI 做决策（核心！） */
    askAI: (question: string, options: string[]) => Promise<string>;
    
    /** 获取素材库资源 */
    getResources: (query: string) => Promise<any[]>;
    
    /** 获取 Photoshop 当前状态 */
    getPsState: () => Promise<any>;
    
    /** 取消信号 */
    signal?: AbortSignal;
}

/**
 * Skill 执行结果
 */
export interface SkillExecutionResult {
    /** 是否成功 */
    success: boolean;
    
    /** 结果消息（给用户看的） */
    message: string;
    
    /** 详细数据 */
    data?: any;
    
    /** 执行的工具调用次数 */
    toolCallCount: number;
    
    /** 执行耗时（毫秒） */
    duration: number;
    
    /** 如果失败，错误信息 */
    error?: string;
    
    /** 后续建议（AI 可以基于此继续操作） */
    suggestions?: string[];
}

/**
 * Skill 执行器接口
 */
export interface SkillExecutor {
    /** 执行技能 */
    execute: (
        skill: SkillDeclaration,
        params: Record<string, any>,
        context: SkillExecutionContext
    ) => Promise<SkillExecutionResult>;
}

// ==================== AI 选择 Skill 相关 ====================

/**
 * AI 选择 Skill 的请求
 */
export interface SkillSelectionRequest {
    /** 用户输入 */
    userInput: string;
    
    /** 对话历史 */
    conversationHistory?: Array<{ role: string; content: string }>;
    
    /** 当前 Photoshop 状态 */
    psContext?: {
        hasDocument: boolean;
        documentName?: string;
        selectedLayers?: string[];
        canvasSize?: { width: number; height: number };
    };
    
    /** 项目上下文 */
    projectContext?: {
        hasResources: boolean;
        resourceCategories?: string[];
    };
}

/**
 * AI 选择 Skill 的结果
 */
export interface SkillSelectionResult {
    /** 是否需要使用 Skill（也可能是简单对话） */
    needsSkill: boolean;
    
    /** 选择的 Skill ID */
    selectedSkillId?: string;
    
    /** 传递给 Skill 的参数 */
    parameters?: Record<string, any>;
    
    /** 如果不用 Skill，AI 的直接回复 */
    directResponse?: string;
    
    /** 选择理由（调试用） */
    reasoning?: string;
}

// ==================== Skill 注册表 ====================

/**
 * 生成给 AI 看的 Skill 摘要（用于系统提示词）
 */
export function generateSkillSummary(skills: SkillDeclaration[]): string {
    const visibleSkills = skills.filter((skill) => skill.visibility === 'user-facing');
    const lines: string[] = [
        '## 可用技能列表',
        '',
        '你可以使用以下技能来帮助用户完成设计任务。选择合适的技能并提供参数。',
        ''
    ];
    
    const byCategory: Record<string, SkillDeclaration[]> = {};
    for (const skill of visibleSkills) {
        if (!byCategory[skill.category]) {
            byCategory[skill.category] = [];
        }
        byCategory[skill.category].push(skill);
    }
    
    const categoryNames: Record<string, string> = {
        'image': '🖼️ 图像处理',
        'layout': '📐 布局排版',
        'text': '✏️ 文字处理',
        'batch': '📦 批量操作',
        'analysis': '🔍 分析诊断',
        'export': '💾 导出保存',
        'replication': '📋 布局复刻',
        'ecommerce': '🛍️ 电商设计',
        'document': '📄 文档操作'
    };
    
    for (const [category, categorySkills] of Object.entries(byCategory)) {
        lines.push(`### ${categoryNames[category] || category}`);
        lines.push('');
        
        for (const skill of categorySkills) {
            lines.push(`**${skill.name}** (\`${skill.id}\`)`);
            lines.push(`- ${skill.description}`);
            
            // 必需参数
            const requiredParams = skill.parameters.filter(p => p.required);
            if (requiredParams.length > 0) {
                lines.push(`- 参数: ${requiredParams.map(p => `\`${p.name}\``).join(', ')}`);
            }
            
            // 使用场景
            if (skill.whenToUse.length > 0) {
                lines.push(`- 场景: ${skill.whenToUse.slice(0, 2).join('；')}`);
            }
            
            lines.push('');
        }
    }
    
    return lines.join('\n');
}

/**
 * 生成给 AI 看的 Skill 调用指令格式
 */
export function generateSkillCallFormat(): string {
    return `
## 技能调用格式

当你决定使用技能时，请使用以下格式：

\`\`\`json
{
  "action": "use_skill",
  "skill_id": "技能ID",
  "parameters": {
    "参数名": "参数值"
  },
  "reasoning": "选择这个技能的原因"
}
\`\`\`

如果不需要使用技能，直接回复用户即可。
`;
}
