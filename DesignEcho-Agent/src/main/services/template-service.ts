/**
 * 模板管理服务
 * 
 * 负责模板的加载、解析、管理和渲染
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import type {
    Template,
    TemplateMetadata,
    TemplatePack,
    TemplateListItem,
    TemplateType,
    Placeholder,
    TemplateBindings,
    RenderContext,
    RenderResult
} from '../../shared/types/template';
import { templateParserService } from './template-parser-service';

// ===== 常量 =====

const TEMPLATES_DIR_NAME = 'templates';
const TEMPLATE_JSON = 'template.json';
const PACK_JSON = 'pack.json';
const PREVIEW_IMAGE = 'preview.jpg';

// ===== 模板服务类 =====

class TemplateService {
    private templatesDir: string;
    private loadedTemplates: Map<string, Template> = new Map();
    private installedPacks: TemplatePack[] = [];

    constructor() {
        // 模板存储目录
        this.templatesDir = path.join(app.getPath('userData'), TEMPLATES_DIR_NAME);
        this.ensureDirectories();
        this.loadInstalledPacks();
    }

    /**
     * 确保目录存在
     */
    private ensureDirectories(): void {
        if (!fs.existsSync(this.templatesDir)) {
            fs.mkdirSync(this.templatesDir, { recursive: true });
            console.log(`[TemplateService] 创建模板目录: ${this.templatesDir}`);
        }
    }

    /**
     * 加载已安装的模板包
     */
    private loadInstalledPacks(): void {
        try {
            const entries = fs.readdirSync(this.templatesDir, { withFileTypes: true });
            
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const packPath = path.join(this.templatesDir, entry.name, PACK_JSON);
                    if (fs.existsSync(packPath)) {
                        try {
                            const packData = JSON.parse(fs.readFileSync(packPath, 'utf-8'));
                            this.installedPacks.push({
                                ...packData,
                                _path: path.join(this.templatesDir, entry.name)
                            });
                        } catch (e) {
                            console.error(`[TemplateService] 加载模板包失败: ${packPath}`, e);
                        }
                    }
                }
            }

            console.log(`[TemplateService] 已加载 ${this.installedPacks.length} 个模板包`);
        } catch (e) {
            console.error('[TemplateService] 扫描模板目录失败:', e);
        }
    }

    /**
     * 获取模板目录
     */
    getTemplatesDirectory(): string {
        return this.templatesDir;
    }

    /**
     * 获取已安装的模板包列表
     */
    getInstalledPacks(): TemplatePack[] {
        return this.installedPacks;
    }

    /**
     * 安装模板包
     */
    async installPack(sourcePath: string): Promise<{ success: boolean; error?: string }> {
        try {
            // 验证模板包
            const packJsonPath = path.join(sourcePath, PACK_JSON);
            if (!fs.existsSync(packJsonPath)) {
                return { success: false, error: '无效的模板包：缺少 pack.json' };
            }

            const packData = JSON.parse(fs.readFileSync(packJsonPath, 'utf-8')) as TemplatePack;
            
            // 检查是否已安装
            const existingPack = this.installedPacks.find(p => p.id === packData.id);
            if (existingPack) {
                return { success: false, error: `模板包 "${packData.name}" 已安装` };
            }

            // 复制到模板目录
            const targetPath = path.join(this.templatesDir, packData.id);
            await this.copyDirectory(sourcePath, targetPath);

            // 更新已安装列表
            this.installedPacks.push({
                ...packData,
                _path: targetPath
            } as any);

            console.log(`[TemplateService] 安装模板包: ${packData.name}`);
            return { success: true };
        } catch (e: any) {
            console.error('[TemplateService] 安装模板包失败:', e);
            return { success: false, error: e.message };
        }
    }

    /**
     * 卸载模板包
     */
    async uninstallPack(packId: string): Promise<{ success: boolean; error?: string }> {
        try {
            const packIndex = this.installedPacks.findIndex(p => p.id === packId);
            if (packIndex === -1) {
                return { success: false, error: '模板包未找到' };
            }

            const pack = this.installedPacks[packIndex] as any;
            const packPath = pack._path;

            // 删除目录
            if (packPath && fs.existsSync(packPath)) {
                fs.rmSync(packPath, { recursive: true });
            }

            // 从列表移除
            this.installedPacks.splice(packIndex, 1);

            // 清除缓存的模板
            for (const [key] of this.loadedTemplates) {
                if (key.startsWith(packId)) {
                    this.loadedTemplates.delete(key);
                }
            }

            console.log(`[TemplateService] 卸载模板包: ${packId}`);
            return { success: true };
        } catch (e: any) {
            console.error('[TemplateService] 卸载模板包失败:', e);
            return { success: false, error: e.message };
        }
    }

    /**
     * 获取模板列表
     */
    getTemplateList(type?: TemplateType): TemplateListItem[] {
        const list: TemplateListItem[] = [];

        for (const pack of this.installedPacks) {
            const packPath = (pack as any)._path;
            if (!packPath) continue;

            // 主图模板
            if ((!type || type === 'mainImage') && pack.templates.mainImage) {
                for (const templateId of pack.templates.mainImage) {
                    const template = this.loadTemplateMetadata(packPath, 'main-image', templateId);
                    if (template) {
                        list.push(this.toListItem(template));
                    }
                }
            }

            // SKU 模板
            if ((!type || type === 'sku') && pack.templates.sku) {
                for (const templateId of pack.templates.sku) {
                    const template = this.loadTemplateMetadata(packPath, 'sku', templateId);
                    if (template) {
                        list.push(this.toListItem(template));
                    }
                }
            }

            // 详情页模板
            if ((!type || type === 'detailPage') && pack.templates.detailPage) {
                for (const [module, templateIds] of Object.entries(pack.templates.detailPage)) {
                    for (const templateId of templateIds) {
                        const template = this.loadTemplateMetadata(packPath, `detail-page/${module}`, templateId);
                        if (template) {
                            list.push(this.toListItem(template));
                        }
                    }
                }
            }
        }

        return list;
    }

    /**
     * 加载模板元数据
     */
    private loadTemplateMetadata(packPath: string, category: string, templateId: string): TemplateMetadata | null {
        try {
            const templatePath = path.join(packPath, category, templateId, TEMPLATE_JSON);
            if (!fs.existsSync(templatePath)) {
                return null;
            }

            const data = JSON.parse(fs.readFileSync(templatePath, 'utf-8'));
            
            // 检查预览图
            const previewPath = path.join(packPath, category, templateId, PREVIEW_IMAGE);
            if (fs.existsSync(previewPath)) {
                data.previewImage = previewPath;
            }

            return data as TemplateMetadata;
        } catch (e) {
            console.error(`[TemplateService] 加载模板元数据失败: ${templateId}`, e);
            return null;
        }
    }

    /**
     * 加载完整模板
     */
    async loadTemplate(templateId: string): Promise<Template | null> {
        // 检查缓存
        if (this.loadedTemplates.has(templateId)) {
            return this.loadedTemplates.get(templateId)!;
        }

        // 在所有模板包中查找
        for (const pack of this.installedPacks) {
            const packPath = (pack as any)._path;
            if (!packPath) continue;

            const template = await this.findAndLoadTemplate(packPath, templateId);
            if (template) {
                this.loadedTemplates.set(templateId, template);
                return template;
            }
        }

        console.warn(`[TemplateService] 模板未找到: ${templateId}`);
        return null;
    }

    /**
     * 在模板包中查找并加载模板
     */
    private async findAndLoadTemplate(packPath: string, templateId: string): Promise<Template | null> {
        const searchPaths = [
            path.join(packPath, 'main-image', templateId),
            path.join(packPath, 'sku', templateId),
        ];

        // 添加详情页子目录
        const detailPagePath = path.join(packPath, 'detail-page');
        if (fs.existsSync(detailPagePath)) {
            const modules = fs.readdirSync(detailPagePath, { withFileTypes: true });
            for (const mod of modules) {
                if (mod.isDirectory()) {
                    searchPaths.push(path.join(detailPagePath, mod.name, templateId));
                }
            }
        }

        for (const templatePath of searchPaths) {
            const jsonPath = path.join(templatePath, TEMPLATE_JSON);
            if (fs.existsSync(jsonPath)) {
                try {
                    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as Template;
                    
                    // 补充路径信息
                    data.psdPath = path.join(templatePath, 'template.psd');
                    data.assetsPath = path.join(templatePath, 'assets');
                    
                    if (fs.existsSync(path.join(templatePath, PREVIEW_IMAGE))) {
                        data.previewImage = path.join(templatePath, PREVIEW_IMAGE);
                    }

                    return data;
                } catch (e) {
                    console.error(`[TemplateService] 解析模板失败: ${jsonPath}`, e);
                }
            }
        }

        return null;
    }

    /**
     * 转换为列表项
     */
    private toListItem(metadata: TemplateMetadata): TemplateListItem {
        return {
            id: metadata.id,
            name: metadata.name,
            type: metadata.type,
            category: metadata.category,
            previewImage: metadata.previewImage,
            tags: metadata.tags
        };
    }

    /**
     * 获取模板占位符
     */
    async getTemplatePlaceholders(templateId: string): Promise<Placeholder[]> {
        const template = await this.loadTemplate(templateId);
        if (!template) {
            return [];
        }
        return template.placeholders;
    }

    /**
     * 验证绑定数据
     */
    validateBindings(template: Template, bindings: TemplateBindings): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        for (const placeholder of template.placeholders) {
            if (placeholder.required && !bindings[placeholder.id]) {
                errors.push(`缺少必需的占位符数据: ${placeholder.name}`);
            }
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * 生成渲染指令（供 UXP 执行）
     */
    generateRenderInstructions(context: RenderContext): object[] {
        const instructions: object[] = [];
        const { template, bindings, conditions } = context;

        for (const placeholder of template.placeholders) {
            // 检查条件
            const parsed = templateParserService.parseLayerName(placeholder.layerPath.split('/').pop() || '');
            if (parsed?.condition && conditions && !conditions[parsed.condition]) {
                // 条件不满足，隐藏图层
                instructions.push({
                    action: 'hideLayer',
                    layerPath: placeholder.layerPath
                });
                continue;
            }

            const binding = bindings[placeholder.id];
            if (!binding) continue;

            switch (placeholder.type) {
                case 'IMG':
                    if (binding.type === 'image') {
                        instructions.push({
                            action: 'replaceImage',
                            layerPath: placeholder.layerPath,
                            source: binding.source,
                            path: binding.path,
                            url: binding.url,
                            data: binding.data,
                            options: placeholder.options
                        });
                    }
                    break;

                case 'TEXT':
                    if (binding.type === 'text') {
                        instructions.push({
                            action: 'replaceText',
                            layerPath: placeholder.layerPath,
                            value: binding.value,
                            maxLength: placeholder.options.maxLength
                        });
                    }
                    break;

                case 'SO':
                    if (binding.type === 'image') {
                        instructions.push({
                            action: 'replaceSmartObject',
                            layerPath: placeholder.layerPath,
                            source: binding.source,
                            path: binding.path,
                            url: binding.url,
                            data: binding.data
                        });
                    }
                    break;

                case 'STYLE':
                    if (binding.type === 'style') {
                        instructions.push({
                            action: 'applyStyle',
                            layerPath: placeholder.layerPath,
                            property: binding.property,
                            value: binding.value
                        });
                    }
                    break;
            }
        }

        return instructions;
    }

    /**
     * 复制目录
     */
    private async copyDirectory(src: string, dest: string): Promise<void> {
        fs.mkdirSync(dest, { recursive: true });
        const entries = fs.readdirSync(src, { withFileTypes: true });

        for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);

            if (entry.isDirectory()) {
                await this.copyDirectory(srcPath, destPath);
            } else {
                fs.copyFileSync(srcPath, destPath);
            }
        }
    }

    /**
     * 创建示例模板包结构
     */
    async createSampleTemplatePack(): Promise<string> {
        const samplePackId = 'sample-socks-v1';
        const samplePackPath = path.join(this.templatesDir, samplePackId);

        if (fs.existsSync(samplePackPath)) {
            return samplePackPath;
        }

        // 创建目录结构
        const dirs = [
            '',
            'main-image/simple-01',
            'main-image/simple-01/assets',
            'sku/standard-01',
            'sku/standard-01/assets',
            'shared-assets'
        ];

        for (const dir of dirs) {
            fs.mkdirSync(path.join(samplePackPath, dir), { recursive: true });
        }

        // 创建 pack.json
        const packJson: TemplatePack = {
            id: samplePackId,
            name: '袜子示例模板包',
            version: '1.0.0',
            category: 'socks',
            author: 'DesignEcho',
            description: '包含主图和 SKU 的示例模板',
            templates: {
                mainImage: ['simple-01'],
                sku: ['standard-01']
            }
        };

        fs.writeFileSync(
            path.join(samplePackPath, PACK_JSON),
            JSON.stringify(packJson, null, 2)
        );

        // 创建主图模板 template.json
        const mainImageTemplate: Partial<Template> = {
            id: 'simple-01',
            name: '简约白底主图',
            version: '1.0.0',
            type: 'mainImage',
            category: 'socks',
            dimensions: { width: 800, height: 800, unit: 'px' },
            author: 'DesignEcho',
            tags: ['简约', '白底', '居中'],
            placeholders: [
                {
                    id: 'product',
                    type: 'IMG',
                    name: '产品主体',
                    layerPath: '产品层/[IMG:产品主体]',
                    options: { fit: 'contain', align: 'center' },
                    required: true,
                    description: '产品主体图片，建议使用抠图后的透明底图'
                },
                {
                    id: 'background',
                    type: 'SO',
                    name: '背景',
                    layerPath: '[SO:背景]',
                    options: { fit: 'fill' },
                    required: false,
                    default: 'assets/background.png'
                },
                {
                    id: 'title',
                    type: 'TEXT',
                    name: '主标题',
                    layerPath: '文字层/[TEXT:标题]',
                    options: { source: 'input', maxLength: 15 },
                    required: false
                },
                {
                    id: 'sellingPoint1',
                    type: 'TEXT',
                    name: '卖点1',
                    layerPath: '卖点组/[TEXT:卖点1]',
                    options: { source: 'knowledge', maxLength: 8 },
                    required: false
                },
                {
                    id: 'sellingPoint2',
                    type: 'TEXT',
                    name: '卖点2',
                    layerPath: '卖点组/[TEXT:卖点2]',
                    options: { source: 'knowledge', maxLength: 8 },
                    required: false
                },
                {
                    id: 'sellingPoint3',
                    type: 'TEXT',
                    name: '卖点3',
                    layerPath: '卖点组/[TEXT:卖点3]',
                    options: { source: 'knowledge', maxLength: 8 },
                    required: false
                }
            ],
            styles: {
                primaryColor: '#1E3A5F',
                secondaryColor: '#F5F5F5',
                accentColor: '#FF6B35',
                fontFamily: '思源黑体'
            },
            exportSettings: {
                formats: ['jpg', 'png'],
                quality: 90,
                sizes: [
                    { name: '标准', width: 800, height: 800 },
                    { name: '高清', width: 1200, height: 1200 }
                ]
            }
        };

        fs.writeFileSync(
            path.join(samplePackPath, 'main-image/simple-01', TEMPLATE_JSON),
            JSON.stringify(mainImageTemplate, null, 2)
        );

        // 创建 SKU 模板 template.json
        const skuTemplate: Partial<Template> = {
            id: 'standard-01',
            name: '标准 SKU 模板',
            version: '1.0.0',
            type: 'sku',
            category: 'socks',
            dimensions: { width: 800, height: 800, unit: 'px' },
            author: 'DesignEcho',
            tags: ['标准', '纯色背景'],
            placeholders: [
                {
                    id: 'product',
                    type: 'IMG',
                    name: '产品缩略图',
                    layerPath: '[IMG:产品缩略图]',
                    options: { fit: 'contain', align: 'center' },
                    required: true
                },
                {
                    id: 'colorName',
                    type: 'TEXT',
                    name: '颜色名称',
                    layerPath: '[TEXT:颜色名称]',
                    options: { source: 'input', maxLength: 10 },
                    required: true
                },
                {
                    id: 'sizeName',
                    type: 'TEXT',
                    name: '规格',
                    layerPath: '[TEXT:规格]',
                    options: { source: 'input', maxLength: 10 },
                    required: false
                }
            ],
            styles: {
                backgroundColor: '#FFFFFF',
                fontFamily: '思源黑体'
            },
            exportSettings: {
                formats: ['jpg'],
                quality: 90,
                sizes: [
                    { name: '标准', width: 800, height: 800 }
                ]
            }
        };

        fs.writeFileSync(
            path.join(samplePackPath, 'sku/standard-01', TEMPLATE_JSON),
            JSON.stringify(skuTemplate, null, 2)
        );

        // 重新加载模板包
        this.installedPacks = [];
        this.loadInstalledPacks();

        console.log(`[TemplateService] 创建示例模板包: ${samplePackPath}`);
        return samplePackPath;
    }
}

// ===== 导出单例 =====

export const templateService = new TemplateService();
