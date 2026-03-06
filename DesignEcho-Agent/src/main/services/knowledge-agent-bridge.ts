/**
 * 知识库-Agent 桥接服务
 * 
 * 将知识库内容转换为 AI 可理解的格式，并提供 AI 可调用的工具
 */

import { userKnowledgeService } from './user-knowledge-service';

// ===== 类型定义 =====

export interface DesignContext {
    category?: string;      // 产品类目
    season?: string;        // 季节
    targetAudience?: string;// 目标人群
    style?: string;         // 风格
    keywords?: string[];    // 关键词
}

export interface KnowledgePrompt {
    systemContext: string;  // 注入到系统提示词的知识上下文
    availableTools: AgentTool[]; // 可用的知识库工具
}

export interface AgentTool {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: Record<string, { type: string; description: string }>;
        required: string[];
    };
    handler: (params: any) => Promise<any>;
}

// ===== 桥接服务 =====

class KnowledgeAgentBridge {
    /**
     * 获取知识库上下文（注入到 AI 系统提示词）
     */
    async getKnowledgeContext(designContext?: DesignContext): Promise<string> {
        const knowledge = userKnowledgeService.getGlobalKnowledge();
        
        if (knowledge.sellingPoints.length === 0 && 
            knowledge.painPoints.length === 0 && 
            knowledge.colorSchemes.length === 0) {
            return `
## 知识库状态
⚠️ 当前没有导入任何用户知识。请先导入 JSON/CSV 或手动添加知识后再进行设计。
`;
        }

        // 根据上下文过滤相关知识
        const relevantSP = this.filterByCategory(knowledge.sellingPoints, designContext?.category);
        const relevantPP = this.filterByCategory(knowledge.painPoints, designContext?.category);
        const relevantCS = this.filterByCategory(knowledge.colorSchemes, designContext?.category);

        // 构建知识上下文
        const lines: string[] = [
            `## 📚 设计知识库`,
            ``,
            `你拥有以下专业知识，请在设计时灵活运用：`,
            ``,
            `### 🏷️ 可用卖点 (${relevantSP.length}条)`,
            ...relevantSP.slice(0, 10).map(sp => 
                `- **${sp.title}**: ${sp.description}` + 
                (sp.priority >= 4 ? ' ⭐' : '')
            ),
            relevantSP.length > 10 ? `- ...还有 ${relevantSP.length - 10} 条` : '',
            ``,
            `### ⚠️ 用户痛点 (${relevantPP.length}条)`,
            ...relevantPP.slice(0, 5).map(pp => 
                `- **${pp.title}**: ${pp.scenario || pp.description}` +
                ` → 解决: ${pp.solutionTitle || '待定'}`
            ),
            ``,
            `### 🎨 推荐配色 (${relevantCS.length}套)`,
            ...relevantCS.slice(0, 5).map(cs => 
                `- **${cs.name}**: 主色 ${cs.primary?.hex || cs.primary} ` +
                (cs.emotions?.length ? `| 情感: ${cs.emotions.join('、')}` : '')
            ),
            ``,
            `### 💡 知识应用原则`,
            `1. 选择 2-3 个核心卖点，避免信息过载`,
            `2. 用痛点引起共鸣，用卖点给出解决方案`,
            `3. 配色需与产品定位和目标人群匹配`,
            `4. 文案要简洁有力，突出差异化`,
        ];

        return lines.filter(Boolean).join('\n');
    }

    /**
     * 获取 AI 可调用的知识库工具
     */
    getKnowledgeTools(): AgentTool[] {
        return [
            {
                name: 'searchSellingPoints',
                description: '搜索卖点库，获取与关键词相关的产品卖点',
                parameters: {
                    type: 'object',
                    properties: {
                        keyword: { type: 'string', description: '搜索关键词，如"纯棉"、"抗菌"' },
                        category: { type: 'string', description: '产品类目，如"船袜"、"中筒袜"' },
                        limit: { type: 'number', description: '返回数量限制，默认5' }
                    },
                    required: ['keyword']
                },
                handler: async (params) => {
                    const knowledge = userKnowledgeService.getGlobalKnowledge();
                    let results = knowledge.sellingPoints;
                    
                    if (params.keyword) {
                        const kw = params.keyword.toLowerCase();
                        results = results.filter(sp => 
                            sp.title?.toLowerCase().includes(kw) ||
                            sp.description?.toLowerCase().includes(kw) ||
                            sp.keywords?.some((k: string) => k.toLowerCase().includes(kw))
                        );
                    }
                    
                    if (params.category) {
                        results = results.filter(sp => 
                            sp.categories?.includes(params.category) ||
                            sp.categories?.includes('all')
                        );
                    }
                    
                    return results.slice(0, params.limit || 5).map(sp => ({
                        title: sp.title,
                        description: sp.description,
                        detail: sp.detail,
                        priority: sp.priority
                    }));
                }
            },
            {
                name: 'getPainPoints',
                description: '获取用户痛点及解决方案，用于文案共鸣',
                parameters: {
                    type: 'object',
                    properties: {
                        category: { type: 'string', description: '产品类目' },
                        type: { type: 'string', description: '痛点类型：comfort舒适/durability耐用/fit合脚/quality品质/hygiene卫生' }
                    },
                    required: []
                },
                handler: async (params) => {
                    const knowledge = userKnowledgeService.getGlobalKnowledge();
                    let results = knowledge.painPoints;
                    
                    if (params.category) {
                        results = results.filter(pp => 
                            pp.categories?.includes(params.category) ||
                            pp.categories?.includes('all')
                        );
                    }
                    
                    if (params.type) {
                        results = results.filter(pp => (pp as any).type === params.type);
                    }
                    
                    return results.slice(0, 5).map(pp => ({
                        title: pp.title,
                        scenario: pp.scenario,
                        userVoice: pp.userVoice,
                        solution: pp.solutionTitle,
                        solutionDetail: pp.solutionDescription
                    }));
                }
            },
            {
                name: 'recommendColorScheme',
                description: '根据场景和情感推荐配色方案',
                parameters: {
                    type: 'object',
                    properties: {
                        emotion: { type: 'string', description: '情感关键词，如"清新"、"高端"、"活力"' },
                        category: { type: 'string', description: '产品类目' },
                        season: { type: 'string', description: '季节：spring/summer/autumn/winter' }
                    },
                    required: []
                },
                handler: async (params) => {
                    const knowledge = userKnowledgeService.getGlobalKnowledge();
                    let results = knowledge.colorSchemes;
                    
                    if (params.emotion) {
                        const emotion = params.emotion.toLowerCase();
                        results = results.filter(cs => 
                            cs.name?.toLowerCase().includes(emotion) ||
                            cs.description?.toLowerCase().includes(emotion)
                        );
                    }
                    
                    if (params.category) {
                        results = results.filter(cs => (cs as any).categories?.includes(params.category));
                    }
                    
                    return results.slice(0, 3).map(cs => ({
                        name: cs.name,
                        description: cs.description,
                        primary: (cs as any).primary?.hex || (cs as any).primary || cs.primary,
                        secondary: (cs as any).secondary?.hex || (cs as any).secondary || cs.secondary,
                        accent: (cs as any).accent?.hex || (cs as any).accent || cs.accent,
                        emotions: (cs as any).emotions
                    }));
                }
            },
            {
                name: 'generateCopywriting',
                description: '基于知识库生成电商文案建议',
                parameters: {
                    type: 'object',
                    properties: {
                        type: { type: 'string', description: '文案类型：title标题/subtitle副标题/tag卖点标签/description描述' },
                        category: { type: 'string', description: '产品类目' },
                        keywords: { type: 'string', description: '产品关键词，逗号分隔' }
                    },
                    required: ['type']
                },
                handler: async (params) => {
                    const knowledge = userKnowledgeService.getGlobalKnowledge();
                    
                    // 获取相关卖点
                    let sellingPoints = knowledge.sellingPoints;
                    if (params.category) {
                        sellingPoints = sellingPoints.filter(sp => 
                            sp.categories?.includes(params.category) || 
                            sp.categories?.includes('all')
                        );
                    }
                    
                    // 排序取 top
                    sellingPoints.sort((a, b) => (b.priority || 0) - (a.priority || 0));
                    const topSP = sellingPoints.slice(0, 5);
                    
                    // 根据类型生成建议
                    const suggestions: string[] = [];
                    
                    if (params.type === 'title') {
                        topSP.forEach(sp => {
                            suggestions.push(`${sp.title} | 专业品质`);
                            suggestions.push(`${sp.title}，${sp.description?.split('，')[0] || '舒适体验'}`);
                        });
                    } else if (params.type === 'tag') {
                        topSP.forEach(sp => {
                            suggestions.push(sp.title);
                        });
                    } else if (params.type === 'subtitle') {
                        topSP.forEach(sp => {
                            suggestions.push(sp.description || sp.title);
                        });
                    }
                    
                    return {
                        type: params.type,
                        suggestions: suggestions.slice(0, 6),
                        basedOn: topSP.map(sp => sp.title)
                    };
                }
            }
        ];
    }

    /**
     * 生成完整的知识增强提示词
     */
    async getKnowledgePrompt(designContext?: DesignContext): Promise<KnowledgePrompt> {
        return {
            systemContext: await this.getKnowledgeContext(designContext),
            availableTools: this.getKnowledgeTools()
        };
    }

    /**
     * 根据类目过滤知识条目
     */
    private filterByCategory(items: any[], category?: string): any[] {
        if (!category) return items;
        return items.filter(item => 
            item.categories?.includes(category) ||
            item.categories?.includes('all') ||
            !item.categories?.length
        );
    }

    /**
     * 为特定设计任务生成专用知识上下文
     */
    async getTaskKnowledge(task: 'mainImage' | 'detailPage' | 'sku', category?: string): Promise<string> {
        const knowledge = userKnowledgeService.getGlobalKnowledge();
        const filtered = this.filterByCategory(knowledge.sellingPoints, category);
        const painPoints = this.filterByCategory(knowledge.painPoints, category);
        
        const templates: Record<string, string> = {
            mainImage: `
## 主图设计知识

### 设计原则
- 主体占比 60-70%，背景简洁
- 突出 1-2 个核心卖点
- 使用强对比色吸引点击

### 推荐卖点 (选 1-2 个)
${filtered.slice(0, 5).map(sp => `- ${sp.title}: ${sp.description}`).join('\n')}

### 参考配色
${knowledge.colorSchemes.slice(0, 3).map(cs => `- ${cs.name}: ${(cs as any).primary?.hex || (cs as any).primary || cs.primary}`).join('\n')}
`,
            detailPage: `
## 详情页设计知识

### 模块规划
1. 首屏：核心卖点 + 促销信息
2. 痛点共鸣：用户问题 + 解决方案
3. 卖点展示：3-5 个核心卖点详细说明
4. 产品参数：规格、材质、尺码
5. 售后保障：退换政策、品质承诺

### 可用卖点
${filtered.slice(0, 8).map(sp => `- **${sp.title}**: ${sp.description}`).join('\n')}

### 痛点-解决方案
${painPoints.slice(0, 5).map(pp => `- 痛点: ${pp.title} → 解决: ${pp.solutionTitle}`).join('\n')}
`,
            sku: `
## SKU 图设计知识

### 设计要求
- 突出颜色/款式差异
- 保持统一的拍摄角度
- 白底或统一背景色
- 尺寸建议 800×800

### 颜色命名参考
${knowledge.colorSchemes.slice(0, 5).map(cs => `- ${cs.name}`).join('\n')}
`
        };

        return templates[task] || '';
    }
}

export const knowledgeAgentBridge = new KnowledgeAgentBridge();
