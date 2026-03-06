/**
 * 设计师档案服务
 * 
 * 管理设计师个人偏好、工作流配置和学习数据
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import {
    DesignerProfile,
    DEFAULT_DESIGNER_PROFILE,
    StylePreferences,
    WorkflowPreferences,
    UIPreferences,
    RetrievalPreferences,
    LearningData
} from '../rag/types';

/**
 * 设计师档案服务类
 */
export class DesignerProfileService {
    private profilesDir: string;
    private profiles: Map<string, DesignerProfile> = new Map();
    private currentDesignerId: string | null = null;
    
    constructor() {
        this.profilesDir = path.join(app.getPath('userData'), 'designer-profiles');
        this.ensureDirectory();
        this.loadAllProfiles();
    }
    
    /**
     * 确保目录存在
     */
    private ensureDirectory(): void {
        if (!fs.existsSync(this.profilesDir)) {
            fs.mkdirSync(this.profilesDir, { recursive: true });
        }
    }
    
    /**
     * 加载所有设计师档案
     */
    private loadAllProfiles(): void {
        try {
            const files = fs.readdirSync(this.profilesDir);
            for (const file of files) {
                if (file.endsWith('.json')) {
                    const filePath = path.join(this.profilesDir, file);
                    const data = fs.readFileSync(filePath, 'utf-8');
                    const profile = JSON.parse(data) as DesignerProfile;
                    this.profiles.set(profile.designerId, profile);
                }
            }
            console.log(`[DesignerProfileService] 已加载 ${this.profiles.size} 个设计师档案`);
        } catch (error: any) {
            console.error('[DesignerProfileService] 加载档案失败:', error.message);
        }
    }
    
    /**
     * 保存设计师档案
     */
    private saveProfile(profile: DesignerProfile): void {
        try {
            const filePath = path.join(this.profilesDir, `${profile.designerId}.json`);
            fs.writeFileSync(filePath, JSON.stringify(profile, null, 2), 'utf-8');
        } catch (error: any) {
            console.error('[DesignerProfileService] 保存档案失败:', error.message);
        }
    }
    
    /**
     * 创建新设计师档案
     */
    createProfile(designerId: string, name: string): DesignerProfile {
        const now = new Date().toISOString();
        
        const profile: DesignerProfile = {
            designerId,
            name,
            createdAt: now,
            updatedAt: now,
            ...DEFAULT_DESIGNER_PROFILE
        };
        
        this.profiles.set(designerId, profile);
        this.saveProfile(profile);
        
        console.log(`[DesignerProfileService] 创建设计师档案: ${name} (${designerId})`);
        return profile;
    }
    
    /**
     * 获取设计师档案
     */
    getProfile(designerId: string): DesignerProfile | null {
        return this.profiles.get(designerId) || null;
    }
    
    /**
     * 获取或创建设计师档案
     */
    getOrCreateProfile(designerId: string, name?: string): DesignerProfile {
        const existing = this.profiles.get(designerId);
        if (existing) return existing;
        return this.createProfile(designerId, name || `设计师 ${designerId.slice(0, 6)}`);
    }
    
    /**
     * 获取所有设计师档案
     */
    getAllProfiles(): DesignerProfile[] {
        return Array.from(this.profiles.values());
    }
    
    /**
     * 更新设计师档案
     */
    updateProfile(designerId: string, updates: Partial<DesignerProfile>): DesignerProfile | null {
        const profile = this.profiles.get(designerId);
        if (!profile) return null;
        
        const updated: DesignerProfile = {
            ...profile,
            ...updates,
            updatedAt: new Date().toISOString()
        };
        
        this.profiles.set(designerId, updated);
        this.saveProfile(updated);
        
        return updated;
    }
    
    /**
     * 更新风格偏好
     */
    updateStylePreferences(designerId: string, updates: Partial<StylePreferences>): boolean {
        const profile = this.profiles.get(designerId);
        if (!profile) return false;
        
        profile.stylePreferences = {
            ...profile.stylePreferences,
            ...updates
        };
        profile.updatedAt = new Date().toISOString();
        
        this.saveProfile(profile);
        return true;
    }
    
    /**
     * 更新工作流偏好
     */
    updateWorkflowPreferences(designerId: string, updates: Partial<WorkflowPreferences>): boolean {
        const profile = this.profiles.get(designerId);
        if (!profile) return false;
        
        profile.workflowPreferences = {
            ...profile.workflowPreferences,
            ...updates
        };
        profile.updatedAt = new Date().toISOString();
        
        this.saveProfile(profile);
        return true;
    }
    
    /**
     * 更新 UI 偏好
     */
    updateUIPreferences(designerId: string, updates: Partial<UIPreferences>): boolean {
        const profile = this.profiles.get(designerId);
        if (!profile) return false;
        
        profile.uiPreferences = {
            ...profile.uiPreferences,
            ...updates
        };
        profile.updatedAt = new Date().toISOString();
        
        this.saveProfile(profile);
        return true;
    }
    
    /**
     * 更新检索偏好
     */
    updateRetrievalPreferences(designerId: string, updates: Partial<RetrievalPreferences>): boolean {
        const profile = this.profiles.get(designerId);
        if (!profile) return false;
        
        profile.retrievalPreferences = {
            ...profile.retrievalPreferences,
            ...updates
        };
        profile.updatedAt = new Date().toISOString();
        
        this.saveProfile(profile);
        return true;
    }
    
    /**
     * 记录搜索查询 (用于学习)
     */
    recordSearch(designerId: string, query: string): void {
        const profile = this.profiles.get(designerId);
        if (!profile) return;
        
        const searches = profile.learningData.frequentSearches;
        const existing = searches.find(s => s.query === query);
        
        if (existing) {
            existing.count++;
            existing.lastSearched = new Date().toISOString();
        } else {
            searches.push({
                query,
                count: 1,
                lastSearched: new Date().toISOString()
            });
        }
        
        // 保留最近 100 条搜索
        if (searches.length > 100) {
            searches.sort((a, b) => b.count - a.count);
            searches.length = 100;
        }
        
        this.saveProfile(profile);
    }
    
    /**
     * 记录知识点击 (用于学习)
     */
    recordKnowledgeClick(designerId: string, knowledgeId: string): void {
        const profile = this.profiles.get(designerId);
        if (!profile) return;
        
        const clicks = profile.learningData.clickedResults;
        const existing = clicks.find(c => c.knowledgeId === knowledgeId);
        
        if (existing) {
            existing.count++;
            existing.lastClicked = new Date().toISOString();
        } else {
            clicks.push({
                knowledgeId,
                count: 1,
                lastClicked: new Date().toISOString()
            });
        }
        
        // 保留最近 200 条点击
        if (clicks.length > 200) {
            clicks.sort((a, b) => b.count - a.count);
            clicks.length = 200;
        }
        
        this.saveProfile(profile);
    }
    
    /**
     * 记录知识应用
     */
    recordKnowledgeApplied(designerId: string, knowledgeId: string): void {
        const profile = this.profiles.get(designerId);
        if (!profile) return;
        
        if (!profile.learningData.appliedKnowledge.includes(knowledgeId)) {
            profile.learningData.appliedKnowledge.push(knowledgeId);
            
            // 保留最近 500 条
            if (profile.learningData.appliedKnowledge.length > 500) {
                profile.learningData.appliedKnowledge.shift();
            }
            
            this.saveProfile(profile);
        }
    }
    
    /**
     * 记录会话统计
     */
    recordSession(designerId: string, durationMs: number): void {
        const profile = this.profiles.get(designerId);
        if (!profile) return;
        
        const stats = profile.learningData.sessionStats;
        const totalDuration = stats.avgSessionDuration * stats.totalSessions + durationMs;
        stats.totalSessions++;
        stats.avgSessionDuration = totalDuration / stats.totalSessions;
        stats.lastSessionAt = new Date().toISOString();
        
        this.saveProfile(profile);
    }
    
    /**
     * 添加收藏配色
     */
    addFavoriteColorScheme(designerId: string, schemeId: string): boolean {
        const profile = this.profiles.get(designerId);
        if (!profile) return false;
        
        if (!profile.stylePreferences.favoriteColorSchemes.includes(schemeId)) {
            profile.stylePreferences.favoriteColorSchemes.push(schemeId);
            profile.updatedAt = new Date().toISOString();
            this.saveProfile(profile);
        }
        
        return true;
    }
    
    /**
     * 移除收藏配色
     */
    removeFavoriteColorScheme(designerId: string, schemeId: string): boolean {
        const profile = this.profiles.get(designerId);
        if (!profile) return false;
        
        const index = profile.stylePreferences.favoriteColorSchemes.indexOf(schemeId);
        if (index > -1) {
            profile.stylePreferences.favoriteColorSchemes.splice(index, 1);
            profile.updatedAt = new Date().toISOString();
            this.saveProfile(profile);
        }
        
        return true;
    }
    
    /**
     * 设置当前设计师
     */
    setCurrentDesigner(designerId: string): void {
        this.currentDesignerId = designerId;
    }
    
    /**
     * 获取当前设计师
     */
    getCurrentDesigner(): DesignerProfile | null {
        if (!this.currentDesignerId) return null;
        return this.profiles.get(this.currentDesignerId) || null;
    }
    
    /**
     * 删除设计师档案
     */
    deleteProfile(designerId: string): boolean {
        const profile = this.profiles.get(designerId);
        if (!profile) return false;
        
        try {
            const filePath = path.join(this.profilesDir, `${designerId}.json`);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            this.profiles.delete(designerId);
            
            if (this.currentDesignerId === designerId) {
                this.currentDesignerId = null;
            }
            
            console.log(`[DesignerProfileService] 已删除设计师档案: ${designerId}`);
            return true;
        } catch (error: any) {
            console.error('[DesignerProfileService] 删除档案失败:', error.message);
            return false;
        }
    }
    
    /**
     * 导出设计师档案
     */
    exportProfile(designerId: string): string | null {
        const profile = this.profiles.get(designerId);
        if (!profile) return null;
        return JSON.stringify(profile, null, 2);
    }
    
    /**
     * 导入设计师档案
     */
    importProfile(jsonData: string): DesignerProfile | null {
        try {
            const profile = JSON.parse(jsonData) as DesignerProfile;
            
            // 验证必要字段
            if (!profile.designerId || !profile.name) {
                throw new Error('缺少必要字段');
            }
            
            // 更新时间戳
            profile.updatedAt = new Date().toISOString();
            
            this.profiles.set(profile.designerId, profile);
            this.saveProfile(profile);
            
            console.log(`[DesignerProfileService] 导入设计师档案: ${profile.name}`);
            return profile;
        } catch (error: any) {
            console.error('[DesignerProfileService] 导入档案失败:', error.message);
            return null;
        }
    }
    
    /**
     * 获取设计师统计
     */
    getStats(): {
        totalProfiles: number;
        activeProfiles: number;
        avgSessionDuration: number;
    } {
        const profiles = Array.from(this.profiles.values());
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        
        const activeProfiles = profiles.filter(
            p => p.learningData.sessionStats.lastSessionAt > thirtyDaysAgo
        );
        
        const totalDuration = profiles.reduce(
            (sum, p) => sum + p.learningData.sessionStats.avgSessionDuration,
            0
        );
        
        return {
            totalProfiles: profiles.length,
            activeProfiles: activeProfiles.length,
            avgSessionDuration: profiles.length > 0 ? totalDuration / profiles.length : 0
        };
    }
}

// 单例实例
let designerProfileServiceInstance: DesignerProfileService | null = null;

/**
 * 获取设计师档案服务单例
 */
export function getDesignerProfileService(): DesignerProfileService {
    if (!designerProfileServiceInstance) {
        designerProfileServiceInstance = new DesignerProfileService();
    }
    return designerProfileServiceInstance;
}

export default DesignerProfileService;
