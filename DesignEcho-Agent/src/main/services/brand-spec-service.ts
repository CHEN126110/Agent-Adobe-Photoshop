/**
 * 品牌规范服务
 * 
 * 管理用户自定义的品牌设计规范（品牌色、字体、排版规则、调性）。
 * 支持项目级规范（.designecho/brand-spec.json）和全局规范。
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

// ==================== 类型定义 ====================

export interface BrandColors {
    primary: string;
    secondary: string;
    accent: string;
    background: string[];
    text: string;
    forbidden: string[];
}

export interface BrandTypography {
    headlineFont: string;
    bodyFont: string;
    headlineSize: { min: number; max: number };
    bodySize: { min: number; max: number };
    labelSize: { min: number; max: number };
}

export interface BrandLayout {
    productRatio: { min: number; max: number };
    whitespaceStyle: 'generous' | 'balanced' | 'compact';
    alignment: 'center' | 'left' | 'right';
}

export interface BrandSpec {
    id: string;
    name: string;
    colors: BrandColors;
    typography: BrandTypography;
    layout: BrandLayout;
    tone: string;
    platform: string;
    category: string;
    keywords: string[];
    createdAt: string;
    updatedAt: string;
}

const DEFAULT_BRAND_SPEC: BrandSpec = {
    id: 'default',
    name: '默认品牌规范',
    colors: {
        primary: '#333333',
        secondary: '#666666',
        accent: '#FF4D4F',
        background: ['#FFFFFF', '#F5F5F5'],
        text: '#333333',
        forbidden: []
    },
    typography: {
        headlineFont: '阿里巴巴普惠体',
        bodyFont: 'PingFang SC',
        headlineSize: { min: 48, max: 120 },
        bodySize: { min: 24, max: 36 },
        labelSize: { min: 18, max: 32 }
    },
    layout: {
        productRatio: { min: 0.55, max: 0.75 },
        whitespaceStyle: 'balanced',
        alignment: 'center'
    },
    tone: '专业品质',
    platform: 'taobao',
    category: '',
    keywords: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
};

// ==================== 服务类 ====================

export class BrandSpecService {
    private static instance: BrandSpecService;
    private globalSpecsDir: string;
    private globalSpecs: Map<string, BrandSpec> = new Map();

    private constructor() {
        this.globalSpecsDir = path.join(app.getPath('userData'), 'brand-specs');
        this.ensureDir(this.globalSpecsDir);
        this.loadGlobalSpecs();
    }

    static getInstance(): BrandSpecService {
        if (!BrandSpecService.instance) {
            BrandSpecService.instance = new BrandSpecService();
        }
        return BrandSpecService.instance;
    }

    private ensureDir(dir: string): void {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    private loadGlobalSpecs(): void {
        try {
            const files = fs.readdirSync(this.globalSpecsDir).filter(f => f.endsWith('.json'));
            for (const file of files) {
                const data = fs.readFileSync(path.join(this.globalSpecsDir, file), 'utf-8');
                const spec = JSON.parse(data) as BrandSpec;
                this.globalSpecs.set(spec.id, spec);
            }
            console.log(`[BrandSpecService] 已加载 ${this.globalSpecs.size} 个全局品牌规范`);
        } catch (e: any) {
            console.warn('[BrandSpecService] 加载全局规范失败:', e.message);
        }
    }

    // ==================== 项目级规范 ====================

    /**
     * 获取项目的品牌规范
     */
    async getProjectBrandSpec(projectPath: string): Promise<BrandSpec | null> {
        const specPath = path.join(projectPath, '.designecho', 'brand-spec.json');
        try {
            if (fs.existsSync(specPath)) {
                const data = fs.readFileSync(specPath, 'utf-8');
                return JSON.parse(data) as BrandSpec;
            }
        } catch (e: any) {
            console.warn('[BrandSpecService] 读取项目品牌规范失败:', e.message);
        }
        return null;
    }

    /**
     * 保存项目品牌规范
     */
    async saveProjectBrandSpec(projectPath: string, spec: BrandSpec): Promise<void> {
        const configDir = path.join(projectPath, '.designecho');
        this.ensureDir(configDir);
        spec.updatedAt = new Date().toISOString();
        fs.writeFileSync(
            path.join(configDir, 'brand-spec.json'),
            JSON.stringify(spec, null, 2),
            'utf-8'
        );
        console.log(`[BrandSpecService] 项目品牌规范已保存: ${projectPath}`);
    }

    // ==================== 全局规范 ====================

    /**
     * 获取全局品牌规范
     */
    getGlobalBrandSpec(specId: string): BrandSpec | null {
        return this.globalSpecs.get(specId) || null;
    }

    /**
     * 列出所有全局品牌规范
     */
    listGlobalBrandSpecs(): BrandSpec[] {
        return Array.from(this.globalSpecs.values());
    }

    /**
     * 保存全局品牌规范
     */
    saveGlobalBrandSpec(spec: BrandSpec): void {
        if (!spec.id) {
            spec.id = `brand-${Date.now()}`;
        }
        if (!spec.createdAt) {
            spec.createdAt = new Date().toISOString();
        }
        spec.updatedAt = new Date().toISOString();

        this.globalSpecs.set(spec.id, spec);
        fs.writeFileSync(
            path.join(this.globalSpecsDir, `${spec.id}.json`),
            JSON.stringify(spec, null, 2),
            'utf-8'
        );
        console.log(`[BrandSpecService] 全局品牌规范已保存: ${spec.name} (${spec.id})`);
    }

    /**
     * 删除全局品牌规范
     */
    deleteGlobalBrandSpec(specId: string): boolean {
        if (!this.globalSpecs.has(specId)) return false;
        this.globalSpecs.delete(specId);
        const filePath = path.join(this.globalSpecsDir, `${specId}.json`);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        return true;
    }

    // ==================== 智能获取 ====================

    /**
     * 获取当前生效的品牌规范（项目级优先，否则全局，否则默认）
     */
    async getEffectiveBrandSpec(projectPath?: string): Promise<BrandSpec> {
        if (projectPath) {
            const projectSpec = await this.getProjectBrandSpec(projectPath);
            if (projectSpec) return projectSpec;
        }

        const globals = this.listGlobalBrandSpecs();
        if (globals.length > 0) {
            return globals[0];
        }

        return { ...DEFAULT_BRAND_SPEC };
    }

    /**
     * 获取默认品牌规范模板
     */
    getDefaultTemplate(): BrandSpec {
        return { ...DEFAULT_BRAND_SPEC, id: `brand-${Date.now()}`, createdAt: new Date().toISOString() };
    }

    /**
     * 将品牌规范转为 LLM 可理解的上下文字符串
     */
    toPromptContext(spec: BrandSpec): string {
        const lines: string[] = [
            `## 品牌设计规范: ${spec.name}`,
            '',
            `**品牌调性**: ${spec.tone}`,
            `**目标平台**: ${spec.platform}`,
            `**产品类目**: ${spec.category}`,
            '',
            '**品牌色**:',
            `- 主色: ${spec.colors.primary}`,
            `- 辅色: ${spec.colors.secondary}`,
            `- 强调色: ${spec.colors.accent}`,
            `- 背景色: ${spec.colors.background.join(', ')}`,
        ];

        if (spec.colors.forbidden.length > 0) {
            lines.push(`- 禁用色: ${spec.colors.forbidden.join(', ')}`);
        }

        lines.push(
            '',
            '**字体规范**:',
            `- 标题: ${spec.typography.headlineFont} (${spec.typography.headlineSize.min}-${spec.typography.headlineSize.max}px)`,
            `- 正文: ${spec.typography.bodyFont} (${spec.typography.bodySize.min}-${spec.typography.bodySize.max}px)`,
            '',
            '**排版规范**:',
            `- 产品占比: ${Math.round(spec.layout.productRatio.min * 100)}%-${Math.round(spec.layout.productRatio.max * 100)}%`,
            `- 留白风格: ${spec.layout.whitespaceStyle}`,
            `- 对齐方式: ${spec.layout.alignment}`
        );

        return lines.join('\n');
    }
}

export const brandSpecService = BrandSpecService.getInstance();
