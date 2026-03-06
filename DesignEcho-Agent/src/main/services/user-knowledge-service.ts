/**
 * 用户知识管理服务
 * 
 * 管理用户自定义的知识内容（卖点、痛点、文案、配色）
 * 支持导入/导出、持久化存储
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import {
    UserKnowledge,
    UserSellingPoint,
    UserPainPoint,
    UserCopyTemplate,
    UserColorScheme,
    EMPTY_USER_KNOWLEDGE,
    importFromJSON,
    importSellingPointsFromCSV,
    parseCSV,
    ImportResult,
    SELLING_POINT_CSV_TEMPLATE,
    COPY_TEMPLATE_CSV_TEMPLATE,
    JSON_IMPORT_EXAMPLE
} from '../../shared/knowledge/user-knowledge';

export class UserKnowledgeService {
    private userDataPath: string;
    private globalKnowledgePath: string;
    private globalKnowledge: UserKnowledge;
    private projectKnowledge: Map<string, UserKnowledge> = new Map();

    constructor() {
        // 全局知识存储在用户数据目录
        this.userDataPath = app.getPath('userData');
        this.globalKnowledgePath = path.join(this.userDataPath, 'user-knowledge.json');
        this.globalKnowledge = this.loadGlobalKnowledge();
        
        console.log('[UserKnowledgeService] 初始化完成');
        console.log(`[UserKnowledgeService] 全局知识路径: ${this.globalKnowledgePath}`);
        console.log(`[UserKnowledgeService] 已加载: ${this.globalKnowledge.sellingPoints.length} 卖点, ${this.globalKnowledge.copyTemplates.length} 文案模板`);
    }

    // ===== 全局知识管理 =====

    /**
     * 加载全局知识库
     */
    private loadGlobalKnowledge(): UserKnowledge {
        try {
            if (fs.existsSync(this.globalKnowledgePath)) {
                const data = fs.readFileSync(this.globalKnowledgePath, 'utf-8');
                return JSON.parse(data);
            }
        } catch (e) {
            console.error('[UserKnowledgeService] 加载全局知识失败:', e);
        }
        return { ...EMPTY_USER_KNOWLEDGE };
    }

    /**
     * 保存全局知识库
     */
    private saveGlobalKnowledge(): void {
        try {
            this.globalKnowledge.lastUpdated = new Date().toISOString();
            fs.writeFileSync(
                this.globalKnowledgePath, 
                JSON.stringify(this.globalKnowledge, null, 2),
                'utf-8'
            );
        } catch (e) {
            console.error('[UserKnowledgeService] 保存全局知识失败:', e);
        }
    }

    /**
     * 获取全局知识库
     */
    getGlobalKnowledge(): UserKnowledge {
        return this.globalKnowledge;
    }

    // ===== 项目级知识管理 =====

    /**
     * 加载项目知识库
     */
    loadProjectKnowledge(projectPath: string): UserKnowledge {
        const knowledgePath = path.join(projectPath, '.designecho', 'knowledge.json');
        
        try {
            if (fs.existsSync(knowledgePath)) {
                const data = fs.readFileSync(knowledgePath, 'utf-8');
                const knowledge = JSON.parse(data);
                this.projectKnowledge.set(projectPath, knowledge);
                return knowledge;
            }
        } catch (e) {
            console.error('[UserKnowledgeService] 加载项目知识失败:', e);
        }
        
        const emptyKnowledge = { ...EMPTY_USER_KNOWLEDGE };
        this.projectKnowledge.set(projectPath, emptyKnowledge);
        return emptyKnowledge;
    }

    /**
     * 保存项目知识库
     */
    saveProjectKnowledge(projectPath: string, knowledge: UserKnowledge): void {
        const designEchoDir = path.join(projectPath, '.designecho');
        const knowledgePath = path.join(designEchoDir, 'knowledge.json');
        
        try {
            if (!fs.existsSync(designEchoDir)) {
                fs.mkdirSync(designEchoDir, { recursive: true });
            }
            
            knowledge.lastUpdated = new Date().toISOString();
            fs.writeFileSync(knowledgePath, JSON.stringify(knowledge, null, 2), 'utf-8');
            this.projectKnowledge.set(projectPath, knowledge);
        } catch (e) {
            console.error('[UserKnowledgeService] 保存项目知识失败:', e);
        }
    }

    /**
     * 获取项目知识库
     */
    getProjectKnowledge(projectPath: string): UserKnowledge {
        if (!this.projectKnowledge.has(projectPath)) {
            return this.loadProjectKnowledge(projectPath);
        }
        return this.projectKnowledge.get(projectPath)!;
    }

    /**
     * 清空所有用户知识
     */
    clearAll(): boolean {
        try {
            // 清空全局知识
            this.globalKnowledge = { ...EMPTY_USER_KNOWLEDGE, lastUpdated: new Date().toISOString() };
            this.saveGlobalKnowledge();

            // 清空项目知识缓存（不删除文件，只重置内存）
            this.projectKnowledge.clear();

            console.log('[UserKnowledgeService] 已清空所有用户知识');
            return true;
        } catch (e) {
            console.error('[UserKnowledgeService] 清空失败:', e);
            return false;
        }
    }

    // ===== 卖点管理 =====

    /**
     * 添加卖点
     */
    addSellingPoint(point: Omit<UserSellingPoint, 'id' | 'createdAt' | 'updatedAt'>, scope: 'global' | { project: string } = 'global'): UserSellingPoint {
        const now = new Date().toISOString();
        const newPoint: UserSellingPoint = {
            ...point,
            id: `user-sp-${Date.now()}`,
            createdAt: now,
            updatedAt: now,
            source: point.source || 'manual'
        };
        
        if (scope === 'global') {
            this.globalKnowledge.sellingPoints.push(newPoint);
            this.saveGlobalKnowledge();
        } else {
            const knowledge = this.getProjectKnowledge(scope.project);
            knowledge.sellingPoints.push(newPoint);
            this.saveProjectKnowledge(scope.project, knowledge);
        }
        
        return newPoint;
    }

    /**
     * 更新卖点
     */
    updateSellingPoint(id: string, updates: Partial<UserSellingPoint>, scope: 'global' | { project: string } = 'global'): boolean {
        const knowledge = scope === 'global' 
            ? this.globalKnowledge 
            : this.getProjectKnowledge(scope.project);
        
        const index = knowledge.sellingPoints.findIndex(p => p.id === id);
        if (index === -1) return false;
        
        knowledge.sellingPoints[index] = {
            ...knowledge.sellingPoints[index],
            ...updates,
            updatedAt: new Date().toISOString()
        };
        
        if (scope === 'global') {
            this.saveGlobalKnowledge();
        } else {
            this.saveProjectKnowledge(scope.project, knowledge);
        }
        
        return true;
    }

    /**
     * 删除卖点
     */
    deleteSellingPoint(id: string, scope: 'global' | { project: string } = 'global'): boolean {
        const knowledge = scope === 'global' 
            ? this.globalKnowledge 
            : this.getProjectKnowledge(scope.project);
        
        const index = knowledge.sellingPoints.findIndex(p => p.id === id);
        if (index === -1) return false;
        
        knowledge.sellingPoints.splice(index, 1);
        
        if (scope === 'global') {
            this.saveGlobalKnowledge();
        } else {
            this.saveProjectKnowledge(scope.project, knowledge);
        }
        
        return true;
    }

    /**
     * 搜索卖点（合并全局和项目）
     */
    searchSellingPoints(keyword: string, projectPath?: string): UserSellingPoint[] {
        const keywordLower = keyword.toLowerCase();
        const results: UserSellingPoint[] = [];
        
        // 搜索全局卖点
        results.push(...this.globalKnowledge.sellingPoints.filter(p => 
            p.title.toLowerCase().includes(keywordLower) ||
            p.description.toLowerCase().includes(keywordLower) ||
            p.keywords?.some(k => k.toLowerCase().includes(keywordLower))
        ));
        
        // 搜索项目卖点
        if (projectPath) {
            const projectKnowledge = this.getProjectKnowledge(projectPath);
            results.push(...projectKnowledge.sellingPoints.filter(p => 
                p.title.toLowerCase().includes(keywordLower) ||
                p.description.toLowerCase().includes(keywordLower) ||
                p.keywords?.some(k => k.toLowerCase().includes(keywordLower))
            ));
        }
        
        return results;
    }

    // ===== 文案模板管理 =====

    /**
     * 添加文案模板
     */
    addCopyTemplate(template: Omit<UserCopyTemplate, 'id' | 'createdAt' | 'updatedAt'>, scope: 'global' | { project: string } = 'global'): UserCopyTemplate {
        const now = new Date().toISOString();
        const newTemplate: UserCopyTemplate = {
            ...template,
            id: `user-ct-${Date.now()}`,
            createdAt: now,
            updatedAt: now,
            source: template.source || 'manual'
        };
        
        if (scope === 'global') {
            this.globalKnowledge.copyTemplates.push(newTemplate);
            this.saveGlobalKnowledge();
        } else {
            const knowledge = this.getProjectKnowledge(scope.project);
            knowledge.copyTemplates.push(newTemplate);
            this.saveProjectKnowledge(scope.project, knowledge);
        }
        
        return newTemplate;
    }

    /**
     * 根据类型获取文案模板
     */
    getCopyTemplatesByType(type: UserCopyTemplate['type'], projectPath?: string): UserCopyTemplate[] {
        const results: UserCopyTemplate[] = [];
        
        results.push(...this.globalKnowledge.copyTemplates.filter(t => t.type === type));
        
        if (projectPath) {
            const projectKnowledge = this.getProjectKnowledge(projectPath);
            results.push(...projectKnowledge.copyTemplates.filter(t => t.type === type));
        }
        
        return results;
    }

    /**
     * 应用文案模板（替换变量）
     */
    applyCopyTemplate(templateId: string, variables: Record<string, string>, projectPath?: string): string | null {
        // 查找模板
        let template = this.globalKnowledge.copyTemplates.find(t => t.id === templateId);
        
        if (!template && projectPath) {
            const projectKnowledge = this.getProjectKnowledge(projectPath);
            template = projectKnowledge.copyTemplates.find(t => t.id === templateId);
        }
        
        if (!template) return null;
        
        // 替换变量
        let result = template.content;
        for (const [name, value] of Object.entries(variables)) {
            result = result.replace(new RegExp(`{{${name}}}`, 'g'), value);
        }
        
        return result;
    }

    // ===== 配色方案管理 =====

    /**
     * 添加配色方案
     */
    addColorScheme(scheme: Omit<UserColorScheme, 'id' | 'createdAt' | 'updatedAt'>, scope: 'global' | { project: string } = 'global'): UserColorScheme {
        const now = new Date().toISOString();
        const newScheme: UserColorScheme = {
            ...scheme,
            id: `user-cs-${Date.now()}`,
            createdAt: now,
            updatedAt: now,
            source: scheme.source || 'manual'
        };
        
        if (scope === 'global') {
            this.globalKnowledge.colorSchemes.push(newScheme);
            this.saveGlobalKnowledge();
        } else {
            const knowledge = this.getProjectKnowledge(scope.project);
            knowledge.colorSchemes.push(newScheme);
            this.saveProjectKnowledge(scope.project, knowledge);
        }
        
        return newScheme;
    }

    /**
     * 获取所有用户配色方案
     */
    getAllColorSchemes(projectPath?: string): UserColorScheme[] {
        const results = [...this.globalKnowledge.colorSchemes];
        
        if (projectPath) {
            const projectKnowledge = this.getProjectKnowledge(projectPath);
            results.push(...projectKnowledge.colorSchemes);
        }
        
        return results;
    }

    // ===== 导入导出 =====

    /**
     * 从 JSON 文件导入
     */
    importFromJSONFile(filePath: string, scope: 'global' | { project: string } = 'global'): ImportResult {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const result = importFromJSON(content);
            
            if (result.success && result.data) {
                const knowledge = scope === 'global' 
                    ? this.globalKnowledge 
                    : this.getProjectKnowledge(scope.project);
                
                // 合并数据
                if (result.data.sellingPoints) {
                    knowledge.sellingPoints.push(...result.data.sellingPoints);
                }
                if (result.data.painPoints) {
                    knowledge.painPoints.push(...result.data.painPoints);
                }
                if (result.data.copyTemplates) {
                    knowledge.copyTemplates.push(...result.data.copyTemplates);
                }
                if (result.data.colorSchemes) {
                    knowledge.colorSchemes.push(...result.data.colorSchemes);
                }
                
                if (scope === 'global') {
                    this.saveGlobalKnowledge();
                } else {
                    this.saveProjectKnowledge(scope.project, knowledge);
                }
            }
            
            return result;
        } catch (e) {
            return {
                success: false,
                imported: 0,
                skipped: 0,
                errors: [{ row: 0, message: `文件读取失败: ${e}` }]
            };
        }
    }

    /**
     * 从 CSV 文件导入卖点
     */
    importSellingPointsFromCSVFile(filePath: string, scope: 'global' | { project: string } = 'global'): ImportResult {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const result = importSellingPointsFromCSV(content);
            
            // CSV 解析后需要手动添加到知识库
            // 这里简化处理，直接解析并添加
            const rows = parseCSV(content).slice(1);
            const knowledge = scope === 'global' 
                ? this.globalKnowledge 
                : this.getProjectKnowledge(scope.project);
            
            rows.forEach((row, i) => {
                if (row.length >= 2 && row[0] && row[1]) {
                    knowledge.sellingPoints.push({
                        id: `user-sp-${Date.now()}-${i}`,
                        title: row[0].trim(),
                        description: row[1].trim(),
                        detail: row[2]?.trim(),
                        categories: row[3]?.split(/[,，]/).map(s => s.trim()),
                        keywords: row[4]?.split(/[,，]/).map(s => s.trim()),
                        priority: parseInt(row[5]) || 3,
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                        source: 'import'
                    });
                }
            });
            
            if (scope === 'global') {
                this.saveGlobalKnowledge();
            } else {
                this.saveProjectKnowledge(scope.project, knowledge);
            }
            
            return result;
        } catch (e) {
            return {
                success: false,
                imported: 0,
                skipped: 0,
                errors: [{ row: 0, message: `文件读取失败: ${e}` }]
            };
        }
    }

    /**
     * 导出全局知识为 JSON
     */
    exportToJSON(scope: 'global' | { project: string } = 'global'): string {
        const knowledge = scope === 'global' 
            ? this.globalKnowledge 
            : this.getProjectKnowledge(scope.project);
        
        return JSON.stringify(knowledge, null, 2);
    }

    /**
     * 保存导出文件
     */
    exportToFile(filePath: string, scope: 'global' | { project: string } = 'global'): boolean {
        try {
            const content = this.exportToJSON(scope);
            fs.writeFileSync(filePath, content, 'utf-8');
            return true;
        } catch (e) {
            console.error('[UserKnowledgeService] 导出失败:', e);
            return false;
        }
    }

    // ===== 模板下载 =====

    /**
     * 获取 CSV 导入模板
     */
    getCSVTemplates(): { sellingPoints: string; copyTemplates: string } {
        return {
            sellingPoints: SELLING_POINT_CSV_TEMPLATE,
            copyTemplates: COPY_TEMPLATE_CSV_TEMPLATE
        };
    }

    /**
     * 获取 JSON 导入示例
     */
    getJSONExample(): object {
        return JSON_IMPORT_EXAMPLE;
    }

    // ===== 统计 =====

    /**
     * 获取用户知识统计
     */
    getStats(projectPath?: string): {
        global: { sellingPoints: number; painPoints: number; copyTemplates: number; colorSchemes: number };
        project?: { sellingPoints: number; painPoints: number; copyTemplates: number; colorSchemes: number };
    } {
        const stats: any = {
            global: {
                sellingPoints: this.globalKnowledge.sellingPoints.length,
                painPoints: this.globalKnowledge.painPoints.length,
                copyTemplates: this.globalKnowledge.copyTemplates.length,
                colorSchemes: this.globalKnowledge.colorSchemes.length
            }
        };
        
        if (projectPath) {
            const projectKnowledge = this.getProjectKnowledge(projectPath);
            stats.project = {
                sellingPoints: projectKnowledge.sellingPoints.length,
                painPoints: projectKnowledge.painPoints.length,
                copyTemplates: projectKnowledge.copyTemplates.length,
                colorSchemes: projectKnowledge.colorSchemes.length
            };
        }
        
        return stats;
    }
}

// 单例
export const userKnowledgeService = new UserKnowledgeService();
export default userKnowledgeService;
