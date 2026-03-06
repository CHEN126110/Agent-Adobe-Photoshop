/**
 * SKU 组合知识库服务
 * 
 * 功能：
 * 1. 存储和管理用户自定义的 SKU 颜色组合
 * 2. 按规格（2双装、3双装、4双装）分类
 * 3. 支持 CSV 导入
 * 4. 与项目关联
 */

import { app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { 
    SKUComboKnowledge, 
    TemplateConfig, 
    ColorCombo, 
    CSVImportRow, 
    ImportResult,
    ComboSize,
    SockType
} from '../../shared/types/sku-combo.types';

export class SKUKnowledgeService {
    private dataDir: string;
    private knowledgeFile: string;
    private knowledge: Map<string, SKUComboKnowledge> = new Map();
    
    constructor() {
        // 存储在用户数据目录
        this.dataDir = path.join(app.getPath('userData'), 'sku-knowledge');
        this.knowledgeFile = path.join(this.dataDir, 'sku-combos.json');
    }
    
    /**
     * 初始化服务
     */
    async initialize(): Promise<void> {
        try {
            // 确保目录存在
            await fs.mkdir(this.dataDir, { recursive: true });
            
            // 加载已有数据
            await this.load();
            
            console.log(`[SKUKnowledge] 初始化完成，已加载 ${this.knowledge.size} 个知识库`);
        } catch (error: any) {
            console.error(`[SKUKnowledge] 初始化失败: ${error.message}`);
        }
    }
    
    /**
     * 从文件加载知识库
     */
    private async load(): Promise<void> {
        try {
            const data = await fs.readFile(this.knowledgeFile, 'utf-8');
            const parsed = JSON.parse(data);
            
            if (Array.isArray(parsed)) {
                this.knowledge.clear();
                for (const item of parsed) {
                    this.knowledge.set(item.id, item);
                }
            }
        } catch (error: any) {
            if (error.code !== 'ENOENT') {
                console.error(`[SKUKnowledge] 加载失败: ${error.message}`);
            }
            // 文件不存在时使用空数据
        }
    }
    
    /**
     * 保存知识库到文件
     */
    private async save(): Promise<void> {
        try {
            const data = Array.from(this.knowledge.values());
            await fs.writeFile(this.knowledgeFile, JSON.stringify(data, null, 2), 'utf-8');
        } catch (error: any) {
            console.error(`[SKUKnowledge] 保存失败: ${error.message}`);
            throw error;
        }
    }
    
    /**
     * 生成唯一 ID
     */
    private generateId(): string {
        return `sku-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
    
    /**
     * 获取所有知识库
     */
    getAll(): SKUComboKnowledge[] {
        return Array.from(this.knowledge.values());
    }
    
    /**
     * 根据 ID 获取知识库
     */
    getById(id: string): SKUComboKnowledge | undefined {
        return this.knowledge.get(id);
    }
    
    /**
     * 根据项目路径获取知识库
     */
    getByProjectPath(projectPath: string): SKUComboKnowledge | undefined {
        for (const kb of this.knowledge.values()) {
            if (kb.projectPath === projectPath) {
                return kb;
            }
        }
        return undefined;
    }
    
    /**
     * 创建新的知识库
     */
    async create(name: string, projectPath?: string): Promise<SKUComboKnowledge> {
        const now = new Date().toISOString();
        const kb: SKUComboKnowledge = {
            id: this.generateId(),
            name,
            projectPath,
            availableColors: [],
            templates: [],
            createdAt: now,
            updatedAt: now
        };
        
        this.knowledge.set(kb.id, kb);
        await this.save();
        
        return kb;
    }
    
    /**
     * 删除知识库
     */
    async delete(id: string): Promise<boolean> {
        const deleted = this.knowledge.delete(id);
        if (deleted) {
            await this.save();
        }
        return deleted;
    }
    
    /**
     * 添加可用颜色
     */
    async addAvailableColors(kbId: string, colors: string[]): Promise<void> {
        const kb = this.knowledge.get(kbId);
        if (!kb) throw new Error('知识库不存在');
        
        const uniqueColors = new Set([...kb.availableColors, ...colors]);
        kb.availableColors = Array.from(uniqueColors);
        kb.updatedAt = new Date().toISOString();
        
        await this.save();
    }
    
    /**
     * 添加模板配置
     */
    async addTemplate(
        kbId: string, 
        config: {
            name: string;
            templateFile: string;
            comboSize: ComboSize;
            sockType: SockType;
            description?: string;
        }
    ): Promise<TemplateConfig> {
        const kb = this.knowledge.get(kbId);
        if (!kb) throw new Error('知识库不存在');
        
        const now = new Date().toISOString();
        const template: TemplateConfig = {
            id: this.generateId(),
            name: config.name,
            templateFile: config.templateFile,
            comboSize: config.comboSize,
            sockType: config.sockType,
            description: config.description,
            combos: [],
            createdAt: now,
            updatedAt: now
        };
        
        kb.templates.push(template);
        kb.updatedAt = now;
        
        await this.save();
        return template;
    }
    
    /**
     * 删除模板配置
     */
    async deleteTemplate(kbId: string, templateId: string): Promise<boolean> {
        const kb = this.knowledge.get(kbId);
        if (!kb) return false;
        
        const index = kb.templates.findIndex(t => t.id === templateId);
        if (index === -1) return false;
        
        kb.templates.splice(index, 1);
        kb.updatedAt = new Date().toISOString();
        
        await this.save();
        return true;
    }
    
    /**
     * 添加颜色组合到模板
     */
    async addCombo(
        kbId: string, 
        templateId: string, 
        colors: string[], 
        remark?: string
    ): Promise<ColorCombo> {
        const kb = this.knowledge.get(kbId);
        if (!kb) throw new Error('知识库不存在');
        
        const template = kb.templates.find(t => t.id === templateId);
        if (!template) throw new Error('模板不存在');
        
        if (colors.length !== template.comboSize) {
            throw new Error(`颜色数量必须等于规格 (${template.comboSize} 双装)`);
        }
        
        const combo: ColorCombo = {
            id: this.generateId(),
            colors,
            remark
        };
        
        template.combos.push(combo);
        template.updatedAt = new Date().toISOString();
        kb.updatedAt = new Date().toISOString();
        
        await this.save();
        return combo;
    }
    
    /**
     * 删除颜色组合
     */
    async deleteCombo(kbId: string, templateId: string, comboId: string): Promise<boolean> {
        const kb = this.knowledge.get(kbId);
        if (!kb) return false;
        
        const template = kb.templates.find(t => t.id === templateId);
        if (!template) return false;
        
        const index = template.combos.findIndex(c => c.id === comboId);
        if (index === -1) return false;
        
        template.combos.splice(index, 1);
        template.updatedAt = new Date().toISOString();
        kb.updatedAt = new Date().toISOString();
        
        await this.save();
        return true;
    }
    
    /**
     * 从 CSV 导入颜色组合
     * 
     * CSV 格式：
     * 模板,规格,颜色1,颜色2,颜色3,颜色4,备注
     * 4双装.tif,4,白色,浅粉,浅蓝,浅灰,
     */
    async importFromCSV(kbId: string, csvContent: string): Promise<ImportResult> {
        const kb = this.knowledge.get(kbId);
        if (!kb) {
            return { success: false, imported: 0, skipped: 0, errors: ['知识库不存在'] };
        }
        
        const result: ImportResult = {
            success: true,
            imported: 0,
            skipped: 0,
            errors: []
        };
        
        const lines = csvContent.split('\n').map(line => line.trim()).filter(line => line);
        
        // 跳过表头
        const dataLines = lines.slice(1);
        
        for (let i = 0; i < dataLines.length; i++) {
            const line = dataLines[i];
            const parts = line.split(',').map(p => p.trim());
            
            if (parts.length < 3) {
                result.errors.push(`行 ${i + 2}: 格式错误`);
                result.skipped++;
                continue;
            }
            
            const templateName = parts[0];
            const comboSize = parseInt(parts[1], 10) as ComboSize;
            const colors: string[] = [];
            let remark: string | undefined;
            
            // 提取颜色（从第3列开始，数量等于规格）
            for (let j = 2; j < 2 + comboSize && j < parts.length; j++) {
                if (parts[j]) {
                    colors.push(parts[j]);
                }
            }
            
            // 备注在最后一列
            if (parts.length > 2 + comboSize) {
                remark = parts[2 + comboSize];
            }
            
            if (colors.length !== comboSize) {
                result.errors.push(`行 ${i + 2}: 颜色数量 (${colors.length}) 与规格 (${comboSize}) 不匹配`);
                result.skipped++;
                continue;
            }
            
            // 查找或创建模板
            let template = kb.templates.find(t => 
                t.templateFile === templateName || t.name === templateName.replace(/\.[^.]+$/, '')
            );
            
            if (!template) {
                // 自动创建模板
                const now = new Date().toISOString();
                template = {
                    id: this.generateId(),
                    name: templateName.replace(/\.[^.]+$/, ''),
                    templateFile: templateName,
                    comboSize: comboSize,
                    sockType: '其他',
                    combos: [],
                    createdAt: now,
                    updatedAt: now
                };
                kb.templates.push(template);
            }
            
            // 检查是否重复
            const isDuplicate = template.combos.some(c => 
                c.colors.length === colors.length && 
                c.colors.every((color, idx) => color === colors[idx])
            );
            
            if (isDuplicate) {
                result.skipped++;
                continue;
            }
            
            // 添加组合
            template.combos.push({
                id: this.generateId(),
                colors,
                remark
            });
            
            // 添加到可用颜色列表
            for (const color of colors) {
                if (!kb.availableColors.includes(color)) {
                    kb.availableColors.push(color);
                }
            }
            
            result.imported++;
        }
        
        kb.updatedAt = new Date().toISOString();
        await this.save();
        
        return result;
    }
    
    /**
     * 导出为 CSV
     */
    exportToCSV(kbId: string): string {
        const kb = this.knowledge.get(kbId);
        if (!kb) return '';
        
        const lines: string[] = [];
        
        // 表头
        lines.push('模板,规格,颜色1,颜色2,颜色3,颜色4,颜色5,颜色6,备注');
        
        for (const template of kb.templates) {
            for (const combo of template.combos) {
                const row = [
                    template.templateFile,
                    template.comboSize.toString(),
                    ...combo.colors,
                    // 填充空列
                    ...Array(6 - combo.colors.length).fill(''),
                    combo.remark || ''
                ];
                lines.push(row.join(','));
            }
        }
        
        return lines.join('\n');
    }
    
    /**
     * 获取指定规格的所有组合
     * 用于模型生成 SKU 时参考
     */
    getCombosBySize(kbId: string, comboSize: ComboSize): ColorCombo[] {
        const kb = this.knowledge.get(kbId);
        if (!kb) return [];
        
        const combos: ColorCombo[] = [];
        for (const template of kb.templates) {
            if (template.comboSize === comboSize) {
                combos.push(...template.combos);
            }
        }
        
        return combos;
    }
    
    /**
     * 根据袜子类型和规格获取模板配置
     */
    getTemplatesByFilter(
        kbId: string, 
        filter: { sockType?: SockType; comboSize?: ComboSize }
    ): TemplateConfig[] {
        const kb = this.knowledge.get(kbId);
        if (!kb) return [];
        
        return kb.templates.filter(t => {
            if (filter.sockType && t.sockType !== filter.sockType) return false;
            if (filter.comboSize && t.comboSize !== filter.comboSize) return false;
            return true;
        });
    }
}

// 单例
let instance: SKUKnowledgeService | null = null;

export function getSKUKnowledgeService(): SKUKnowledgeService {
    if (!instance) {
        instance = new SKUKnowledgeService();
    }
    return instance;
}
