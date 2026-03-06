/**
 * 记忆服务
 * 
 * 为 Agent 提供持久化记忆能力
 * 
 * 记忆类型：
 * 1. 用户偏好记忆 - 常用字体、配色、设计风格
 * 2. 操作模式记忆 - 频繁执行的任务序列
 * 3. 项目上下文记忆 - 当前项目的设计规范
 * 4. 短期记忆 - 当前对话的操作历史（用于撤销/重做）
 * 5. 实体记忆 - 提及过的图层、颜色等实体
 */

// ==================== 类型定义 ====================

/**
 * 用户偏好
 */
export interface UserPreferences {
    // 设计偏好
    design: {
        preferredFonts: string[];       // 常用字体
        preferredColors: string[];      // 常用颜色
        preferredStyles: string[];      // 设计风格（极简、现代、复古等）
        defaultAlignment: string;       // 默认对齐方式
        defaultSpacing: number;         // 默认间距
    };
    // 交互偏好
    interaction: {
        verbosity: 'concise' | 'normal' | 'detailed';  // 回复详细程度
        confirmBeforeExecute: boolean;   // 执行前是否确认
        autoSave: boolean;               // 自动保存
        showThinking: boolean;           // 显示思考过程
    };
    // 工作流偏好
    workflow: {
        defaultExportFormat: string;     // 默认导出格式
        defaultExportQuality: number;    // 默认导出质量
        autoBeautify: boolean;           // 自动美化
    };
}

/**
 * 操作模式 - 用户频繁执行的任务序列
 */
export interface OperationPattern {
    id: string;
    name: string;
    description?: string;
    triggers: string[];                  // 触发这个模式的关键词
    steps: Array<{
        tool: string;
        params: any;
    }>;
    frequency: number;                   // 执行次数
    lastUsed: number;                    // 最后使用时间
    createdAt: number;
}

/**
 * 项目上下文
 */
export interface ProjectContext {
    projectId: string;
    // 设计规范
    designSpecs: {
        brandColors?: string[];          // 品牌色
        fontFamily?: string;             // 主字体
        styleguide?: string;             // 设计规范描述
    };
    // 最近操作
    recentLayers: Array<{
        id: number;
        name: string;
        lastAccessed: number;
    }>;
    // 常用操作
    frequentTools: Array<{
        tool: string;
        count: number;
    }>;
}

/**
 * 短期记忆 - 当前会话的操作历史
 */
export interface ShortTermMemory {
    // 操作历史（用于撤销/重做）
    operationHistory: Array<{
        id: string;
        tool: string;
        params: any;
        result: any;
        timestamp: number;
        canUndo: boolean;
    }>;
    // 当前上下文变量
    contextVariables: {
        selectedLayerId?: number;
        selectedLayerName?: string;
        lastMentionedLayers?: Array<{ id: number; name: string }>;
        lastMentionedColor?: string;
        lastMentionedSize?: { width: number; height: number };
        currentTaskType?: string;
    };
    // 对话摘要
    conversationSummary: string;
    // 最后更新时间
    lastUpdated: number;
}

/**
 * 实体记忆 - 对话中提及的实体
 */
export interface EntityMemory {
    // 图层实体
    layers: Map<string, {
        id: number;
        name: string;
        mentions: number;
        lastMentioned: number;
    }>;
    // 颜色实体
    colors: Map<string, {
        value: string;
        name?: string;
        mentions: number;
    }>;
    // 尺寸实体
    sizes: Map<string, {
        width: number;
        height: number;
        name?: string;
        mentions: number;
    }>;
}

/**
 * 完整记忆状态
 */
export interface MemoryState {
    preferences: UserPreferences;
    patterns: OperationPattern[];
    projectContexts: Map<string, ProjectContext>;
    shortTerm: ShortTermMemory;
    entities: EntityMemory;
    version: number;
    lastSaved: number;
}

// ==================== 默认值 ====================

const DEFAULT_PREFERENCES: UserPreferences = {
    design: {
        preferredFonts: [],
        preferredColors: [],
        preferredStyles: [],
        defaultAlignment: 'centerHorizontal',
        defaultSpacing: 20
    },
    interaction: {
        verbosity: 'normal',
        confirmBeforeExecute: false,
        autoSave: true,
        showThinking: true
    },
    workflow: {
        defaultExportFormat: 'png',
        defaultExportQuality: 90,
        autoBeautify: false
    }
};

const DEFAULT_SHORT_TERM: ShortTermMemory = {
    operationHistory: [],
    contextVariables: {},
    conversationSummary: '',
    lastUpdated: Date.now()
};

// ==================== 存储键 ====================

const STORAGE_KEY = 'designecho-memory';
const MAX_OPERATION_HISTORY = 50;
const MAX_PATTERNS = 20;
const MAX_RECENT_LAYERS = 10;

function getVerbosityLabel(verbosity: UserPreferences['interaction']['verbosity']): string {
    if (verbosity === 'concise') {
        return '简洁';
    }
    if (verbosity === 'detailed') {
        return '详细';
    }
    return '正常';
}

// ==================== 记忆服务类 ====================

class MemoryService {
    private state: MemoryState;
    private saveDebounceTimer: NodeJS.Timeout | null = null;
    
    constructor() {
        this.state = this.loadFromStorage();
        console.log('[MemoryService] 初始化完成，加载了', this.state.patterns.length, '个操作模式');
    }
    
    // ========== 存储管理 ==========
    
    private loadFromStorage(): MemoryState {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                // 转换 Map 对象
                return {
                    ...parsed,
                    projectContexts: new Map(parsed.projectContexts || []),
                    entities: {
                        layers: new Map(parsed.entities?.layers || []),
                        colors: new Map(parsed.entities?.colors || []),
                        sizes: new Map(parsed.entities?.sizes || [])
                    }
                };
            }
        } catch (e) {
            console.error('[MemoryService] 加载存储失败:', e);
        }
        
        // 返回默认状态
        return {
            preferences: DEFAULT_PREFERENCES,
            patterns: [],
            projectContexts: new Map(),
            shortTerm: DEFAULT_SHORT_TERM,
            entities: {
                layers: new Map(),
                colors: new Map(),
                sizes: new Map()
            },
            version: 1,
            lastSaved: Date.now()
        };
    }
    
    private saveToStorage(): void {
        // 防抖：避免频繁写入
        if (this.saveDebounceTimer) {
            clearTimeout(this.saveDebounceTimer);
        }
        
        this.saveDebounceTimer = setTimeout(() => {
            try {
                const toSave = {
                    ...this.state,
                    projectContexts: Array.from(this.state.projectContexts.entries()),
                    entities: {
                        layers: Array.from(this.state.entities.layers.entries()),
                        colors: Array.from(this.state.entities.colors.entries()),
                        sizes: Array.from(this.state.entities.sizes.entries())
                    },
                    lastSaved: Date.now()
                };
                localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
            } catch (e) {
                console.error('[MemoryService] 保存存储失败:', e);
            }
        }, 500);
    }
    
    // ========== 用户偏好 ==========
    
    getPreferences(): UserPreferences {
        return this.state.preferences;
    }
    
    updatePreferences(updates: Partial<UserPreferences>): void {
        this.state.preferences = {
            ...this.state.preferences,
            ...updates,
            design: { ...this.state.preferences.design, ...updates.design },
            interaction: { ...this.state.preferences.interaction, ...updates.interaction },
            workflow: { ...this.state.preferences.workflow, ...updates.workflow }
        };
        this.saveToStorage();
    }
    
    /**
     * 学习用户偏好 - 从操作中自动推断
     */
    learnPreference(type: 'font' | 'color' | 'style', value: string): void {
        const prefs = this.state.preferences.design;
        
        switch (type) {
            case 'font':
                if (!prefs.preferredFonts.includes(value)) {
                    prefs.preferredFonts.unshift(value);
                    if (prefs.preferredFonts.length > 10) {
                        prefs.preferredFonts.pop();
                    }
                }
                break;
            case 'color':
                if (!prefs.preferredColors.includes(value)) {
                    prefs.preferredColors.unshift(value);
                    if (prefs.preferredColors.length > 20) {
                        prefs.preferredColors.pop();
                    }
                }
                break;
            case 'style':
                if (!prefs.preferredStyles.includes(value)) {
                    prefs.preferredStyles.push(value);
                }
                break;
        }
        
        this.saveToStorage();
    }
    
    // ========== 操作模式 ==========
    
    getPatterns(): OperationPattern[] {
        return this.state.patterns;
    }
    
    /**
     * 匹配操作模式
     */
    matchPattern(userInput: string): OperationPattern | null {
        const input = userInput.toLowerCase().trim();
        
        for (const pattern of this.state.patterns) {
            for (const trigger of pattern.triggers) {
                if (input.includes(trigger.toLowerCase())) {
                    return pattern;
                }
            }
        }
        
        return null;
    }
    
    /**
     * 记录操作序列为模式
     */
    recordPattern(name: string, triggers: string[], steps: Array<{ tool: string; params: any }>): string {
        const pattern: OperationPattern = {
            id: `pattern-${Date.now()}`,
            name,
            triggers,
            steps,
            frequency: 1,
            lastUsed: Date.now(),
            createdAt: Date.now()
        };
        
        this.state.patterns.unshift(pattern);
        
        // 限制数量
        if (this.state.patterns.length > MAX_PATTERNS) {
            this.state.patterns.pop();
        }
        
        this.saveToStorage();
        return pattern.id;
    }
    
    /**
     * 更新模式使用频率
     */
    usePattern(patternId: string): void {
        const pattern = this.state.patterns.find(p => p.id === patternId);
        if (pattern) {
            pattern.frequency++;
            pattern.lastUsed = Date.now();
            this.saveToStorage();
        }
    }
    
    /**
     * 删除操作模式
     */
    deletePattern(patternId: string): void {
        this.state.patterns = this.state.patterns.filter(p => p.id !== patternId);
        this.saveToStorage();
    }
    
    // ========== 项目上下文 ==========
    
    getProjectContext(projectId: string): ProjectContext | undefined {
        return this.state.projectContexts.get(projectId);
    }
    
    updateProjectContext(projectId: string, updates: Partial<ProjectContext>): void {
        const existing = this.state.projectContexts.get(projectId) || {
            projectId,
            designSpecs: {},
            recentLayers: [],
            frequentTools: []
        };
        
        this.state.projectContexts.set(projectId, {
            ...existing,
            ...updates
        });
        
        this.saveToStorage();
    }
    
    /**
     * 记录图层访问
     */
    recordLayerAccess(projectId: string, layerId: number, layerName: string): void {
        const ctx = this.getProjectContext(projectId) || {
            projectId,
            designSpecs: {},
            recentLayers: [],
            frequentTools: []
        };
        
        // 移除已有的相同图层
        ctx.recentLayers = ctx.recentLayers.filter(l => l.id !== layerId);
        
        // 添加到最前面
        ctx.recentLayers.unshift({
            id: layerId,
            name: layerName,
            lastAccessed: Date.now()
        });
        
        // 限制数量
        if (ctx.recentLayers.length > MAX_RECENT_LAYERS) {
            ctx.recentLayers.pop();
        }
        
        this.state.projectContexts.set(projectId, ctx);
        this.saveToStorage();
    }
    
    /**
     * 记录工具使用
     */
    recordToolUsage(projectId: string, toolName: string): void {
        const ctx = this.getProjectContext(projectId) || {
            projectId,
            designSpecs: {},
            recentLayers: [],
            frequentTools: []
        };
        
        const existing = ctx.frequentTools.find(t => t.tool === toolName);
        if (existing) {
            existing.count++;
        } else {
            ctx.frequentTools.push({ tool: toolName, count: 1 });
        }
        
        // 排序
        ctx.frequentTools.sort((a, b) => b.count - a.count);
        
        // 限制数量
        if (ctx.frequentTools.length > 20) {
            ctx.frequentTools = ctx.frequentTools.slice(0, 20);
        }
        
        this.state.projectContexts.set(projectId, ctx);
        this.saveToStorage();
    }
    
    // ========== 短期记忆 ==========
    
    getShortTermMemory(): ShortTermMemory {
        return this.state.shortTerm;
    }
    
    /**
     * 记录操作（用于撤销/重做）
     */
    recordOperation(tool: string, params: any, result: any, canUndo: boolean = true): void {
        this.state.shortTerm.operationHistory.push({
            id: `op-${Date.now()}`,
            tool,
            params,
            result,
            timestamp: Date.now(),
            canUndo
        });
        
        // 限制数量
        if (this.state.shortTerm.operationHistory.length > MAX_OPERATION_HISTORY) {
            this.state.shortTerm.operationHistory.shift();
        }
        
        this.state.shortTerm.lastUpdated = Date.now();
    }
    
    /**
     * 获取最后一个可撤销的操作
     */
    getLastUndoableOperation(): { tool: string; params: any; result: any } | null {
        for (let i = this.state.shortTerm.operationHistory.length - 1; i >= 0; i--) {
            const op = this.state.shortTerm.operationHistory[i];
            if (op.canUndo) {
                return { tool: op.tool, params: op.params, result: op.result };
            }
        }
        return null;
    }
    
    /**
     * 更新上下文变量
     */
    setContextVariable<K extends keyof ShortTermMemory['contextVariables']>(
        key: K,
        value: ShortTermMemory['contextVariables'][K]
    ): void {
        this.state.shortTerm.contextVariables[key] = value;
        this.state.shortTerm.lastUpdated = Date.now();
    }
    
    getContextVariable<K extends keyof ShortTermMemory['contextVariables']>(
        key: K
    ): ShortTermMemory['contextVariables'][K] {
        return this.state.shortTerm.contextVariables[key];
    }
    
    /**
     * 清空短期记忆（新对话时调用）
     */
    clearShortTermMemory(): void {
        this.state.shortTerm = DEFAULT_SHORT_TERM;
    }
    
    /**
     * 更新对话摘要
     */
    updateConversationSummary(summary: string): void {
        this.state.shortTerm.conversationSummary = summary;
        this.state.shortTerm.lastUpdated = Date.now();
    }
    
    // ========== 实体记忆 ==========
    
    /**
     * 记录提及的图层
     */
    rememberLayer(id: number, name: string): void {
        const key = `${id}`;
        const existing = this.state.entities.layers.get(key);
        
        if (existing) {
            existing.mentions++;
            existing.lastMentioned = Date.now();
        } else {
            this.state.entities.layers.set(key, {
                id,
                name,
                mentions: 1,
                lastMentioned: Date.now()
            });
        }
        
        // 同时更新短期记忆的 lastMentionedLayers
        const mentioned = this.state.shortTerm.contextVariables.lastMentionedLayers || [];
        const filtered = mentioned.filter(l => l.id !== id);
        this.state.shortTerm.contextVariables.lastMentionedLayers = [
            { id, name },
            ...filtered
        ].slice(0, 5);
    }
    
    /**
     * 记录提及的颜色
     */
    rememberColor(value: string, name?: string): void {
        const key = value.toLowerCase();
        const existing = this.state.entities.colors.get(key);
        
        if (existing) {
            existing.mentions++;
        } else {
            this.state.entities.colors.set(key, {
                value,
                name,
                mentions: 1
            });
        }
        
        this.state.shortTerm.contextVariables.lastMentionedColor = value;
    }
    
    /**
     * 解析"上一个"、"刚才的"等指代
     */
    resolveReference(reference: string): {
        type: 'layer' | 'color' | 'size' | 'unknown';
        value: any;
    } {
        const ref = reference.toLowerCase();
        
        // 图层指代
        if (ref.includes('这个') || ref.includes('它') || ref.includes('当前')) {
            const selectedId = this.state.shortTerm.contextVariables.selectedLayerId;
            const selectedName = this.state.shortTerm.contextVariables.selectedLayerName;
            if (selectedId) {
                return { type: 'layer', value: { id: selectedId, name: selectedName } };
            }
        }
        
        if (ref.includes('上一个') || ref.includes('刚才')) {
            const lastLayers = this.state.shortTerm.contextVariables.lastMentionedLayers;
            if (lastLayers && lastLayers.length > 0) {
                return { type: 'layer', value: lastLayers[0] };
            }
        }
        
        // 颜色指代
        if (ref.includes('那个颜色') || ref.includes('刚才的颜色')) {
            const lastColor = this.state.shortTerm.contextVariables.lastMentionedColor;
            if (lastColor) {
                return { type: 'color', value: lastColor };
            }
        }
        
        return { type: 'unknown', value: null };
    }
    
    // ========== 记忆摘要（供 Prompt 使用）==========
    
    /**
     * 生成记忆上下文（注入到系统提示词）
     */
    getMemoryContext(projectId?: string): string {
        const parts: string[] = [];
        
        // 1. 用户偏好摘要
        const prefs = this.state.preferences;
        if (prefs.design.preferredFonts.length > 0 || prefs.design.preferredColors.length > 0) {
            parts.push(`## 用户偏好
- 常用字体: ${prefs.design.preferredFonts.slice(0, 3).join('、') || '未设置'}
- 常用颜色: ${prefs.design.preferredColors.slice(0, 5).join('、') || '未设置'}
- 回复风格: ${getVerbosityLabel(prefs.interaction.verbosity)}`);
        }
        
        // 2. 项目上下文
        if (projectId) {
            const ctx = this.state.projectContexts.get(projectId);
            if (ctx) {
                const recentLayerNames = ctx.recentLayers.slice(0, 5).map(l => l.name).join('、');
                const frequentTools = ctx.frequentTools.slice(0, 5).map(t => t.tool).join('、');
                
                if (recentLayerNames || frequentTools) {
                    parts.push(`## 项目上下文
- 最近操作的图层: ${recentLayerNames || '无'}
- 常用工具: ${frequentTools || '无'}`);
                }
                
                if (ctx.designSpecs.brandColors?.length) {
                    parts.push(`- 品牌色: ${ctx.designSpecs.brandColors.join('、')}`);
                }
            }
        }
        
        // 3. 短期记忆
        const shortTerm = this.state.shortTerm;
        if (shortTerm.contextVariables.selectedLayerName) {
            parts.push(`## 当前状态
- 选中图层: "${shortTerm.contextVariables.selectedLayerName}"`);
        }
        
        if (shortTerm.operationHistory.length > 0) {
            const lastOps = shortTerm.operationHistory
                .slice(-3)
                .map(op => op.tool)
                .join(' → ');
            parts.push(`- 最近操作: ${lastOps}`);
        }
        
        if (shortTerm.conversationSummary) {
            parts.push(`- 对话摘要: ${shortTerm.conversationSummary}`);
        }
        
        return parts.length > 0 ? parts.join('\n\n') : '';
    }
    
    /**
     * 获取所有自定义操作模式（供快速动作使用）
     */
    getCustomActions(): Array<{
        id: string;
        name: string;
        triggers: string[];
        steps: Array<{ tool: string; params: any }>;
    }> {
        return this.state.patterns.map(p => ({
            id: p.id,
            name: p.name,
            triggers: p.triggers,
            steps: p.steps
        }));
    }
}

// ==================== 单例导出 ====================

let memoryServiceInstance: MemoryService | null = null;

export function getMemoryService(): MemoryService {
    if (!memoryServiceInstance) {
        memoryServiceInstance = new MemoryService();
    }
    return memoryServiceInstance;
}

export default MemoryService;
