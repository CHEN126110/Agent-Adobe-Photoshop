/**
 * 模板知识库服务
 * 
 * 负责模板的存储、检索和管理
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type {
    TemplateAsset,
    TemplateKnowledge,
    TemplateQuery,
    AddTemplateParams,
    AddTemplateFromPhotoshopParams,
    ResolvePhotoshopTemplateFileParams,
    FindSKUTemplateParams,
    GetAvailableSKUSpecsParams,
    SKUTemplateCandidate,
    TemplateResolverSettings,
    UpdateTemplateParams,
    TemplateType,
    TemplateFormat,
    TemplateSpecs
} from '../../shared/types/template.types';

// 存储路径
const getStoragePath = () => path.join(app.getPath('userData'), 'template-knowledge');
const getDataFile = () => path.join(getStoragePath(), 'templates.json');
const getThumbnailDir = () => path.join(getStoragePath(), 'thumbnails');
const getFilesDir = () => path.join(getStoragePath(), 'files');
const getResolverSettingsFile = () => path.join(getStoragePath(), 'resolver-settings.json');

// 全局知识库名称
const GLOBAL_KB_NAME = '模板知识库';
const SUPPORTED_TEMPLATE_EXTS = ['.psd', '.psb', '.tif', '.tiff'];
const SCAN_EXCLUDE_DIRS = new Set([
    '.git',
    '.idea',
    '.vscode',
    'node_modules',
    'dist',
    'build',
    'tmp',
    'temp'
]);

/**
 * 确保存储目录存在
 */
function ensureStorageDir(): void {
    const storagePath = getStoragePath();
    const thumbnailDir = getThumbnailDir();
    
    if (!fs.existsSync(storagePath)) {
        fs.mkdirSync(storagePath, { recursive: true });
    }
    if (!fs.existsSync(thumbnailDir)) {
        fs.mkdirSync(thumbnailDir, { recursive: true });
    }
}

/**
 * 读取知识库数据
 */
function readKnowledge(): TemplateKnowledge {
    ensureStorageDir();
    const dataFile = getDataFile();
    
    if (fs.existsSync(dataFile)) {
        try {
            const content = fs.readFileSync(dataFile, 'utf-8');
            return JSON.parse(content);
        } catch (e) {
            console.error('[TemplateKnowledge] 读取数据失败:', e);
        }
    }
    
    // 创建默认知识库
    const defaultKB: TemplateKnowledge = {
        id: crypto.randomUUID(),
        name: GLOBAL_KB_NAME,
        templates: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
    
    writeKnowledge(defaultKB);
    return defaultKB;
}

/**
 * 写入知识库数据
 */
function writeKnowledge(knowledge: TemplateKnowledge): void {
    ensureStorageDir();
    const dataFile = getDataFile();
    knowledge.updatedAt = Date.now();
    fs.writeFileSync(dataFile, JSON.stringify(knowledge, null, 2), 'utf-8');
}

/**
 * 检测文件格式
 */
function detectFormat(filePath: string): TemplateFormat {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.psd') return 'psd';
    if (ext === '.tif' || ext === '.tiff') return 'tif';
    if (ext === '.psb') return 'psb';
    return 'psd'; // 默认
}

function isSupportedTemplateFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return SUPPORTED_TEMPLATE_EXTS.includes(ext);
}

function normalizeName(input: string): string {
    return input.trim().replace(/\.[^.]+$/, '').toLowerCase();
}

function extractComboSizeFromName(input: string): number | undefined {
    const match = input.match(/(\d+)双/);
    if (!match) return undefined;
    const parsed = parseInt(match[1], 10);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function scoreMatchedFile(filePath: string, targetName: string): number {
    const fileName = path.basename(filePath);
    const base = normalizeName(fileName);
    const target = normalizeName(targetName);
    let score = 0;

    if (base === target) score += 100;
    if (base.startsWith(target)) score += 30;
    if (base.includes(target)) score += 20;
    if (target.includes(base)) score += 8;
    if (filePath.includes(`${path.sep}模板文件${path.sep}`)) score += 15;

    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.psd') score += 5;
    if (ext === '.psb') score += 3;

    return score;
}

function findTemplateFilesByName(rootDir: string, targetName: string, maxDepth = 6, maxCount = 80): string[] {
    if (!rootDir || !fs.existsSync(rootDir)) return [];

    const queue: Array<{ dir: string; depth: number }> = [{ dir: rootDir, depth: 0 }];
    const candidates: string[] = [];

    while (queue.length > 0 && candidates.length < maxCount) {
        const current = queue.shift()!;
        let entries: fs.Dirent[] = [];
        try {
            entries = fs.readdirSync(current.dir, { withFileTypes: true });
        } catch {
            continue;
        }

        for (const entry of entries) {
            const fullPath = path.join(current.dir, entry.name);
            if (entry.isDirectory()) {
                if (current.depth >= maxDepth) continue;
                if (SCAN_EXCLUDE_DIRS.has(entry.name.toLowerCase())) continue;
                queue.push({ dir: fullPath, depth: current.depth + 1 });
                continue;
            }

            if (!entry.isFile()) continue;
            if (!isSupportedTemplateFile(entry.name)) continue;

            const normalizedFileName = normalizeName(entry.name);
            const normalizedTarget = normalizeName(targetName);
            if (normalizedFileName === normalizedTarget ||
                normalizedFileName.includes(normalizedTarget) ||
                normalizedTarget.includes(normalizedFileName)) {
                candidates.push(fullPath);
            }
        }
    }

    return candidates
        .sort((a, b) => scoreMatchedFile(b, targetName) - scoreMatchedFile(a, targetName))
        .slice(0, maxCount);
}

function getDefaultResolverSettings(): TemplateResolverSettings {
    return {
        localLibraryDirs: []
    };
}

function readResolverSettings(): TemplateResolverSettings {
    ensureStorageDir();
    const settingsFile = getResolverSettingsFile();

    if (!fs.existsSync(settingsFile)) {
        const defaults = getDefaultResolverSettings();
        fs.writeFileSync(settingsFile, JSON.stringify(defaults, null, 2), 'utf-8');
        return defaults;
    }

    try {
        const content = fs.readFileSync(settingsFile, 'utf-8');
        const parsed = JSON.parse(content) as Partial<TemplateResolverSettings>;
        return {
            localLibraryDirs: Array.isArray(parsed.localLibraryDirs)
                ? parsed.localLibraryDirs.filter((dir): dir is string => typeof dir === 'string' && !!dir.trim())
                : []
        };
    } catch (error) {
        console.warn('[TemplateKnowledge] 读取解析设置失败，使用默认设置:', error);
        return getDefaultResolverSettings();
    }
}

function writeResolverSettings(settings: TemplateResolverSettings): TemplateResolverSettings {
    ensureStorageDir();
    const normalizedDirs = Array.from(
        new Set(
            (settings.localLibraryDirs || [])
                .map(dir => path.normalize(String(dir || '').trim()))
                .filter(dir => !!dir)
        )
    );

    const finalSettings: TemplateResolverSettings = {
        localLibraryDirs: normalizedDirs
    };

    fs.writeFileSync(getResolverSettingsFile(), JSON.stringify(finalSettings, null, 2), 'utf-8');
    return finalSettings;
}

function listTemplateFilesInDirectory(rootDir: string, maxDepth = 5, maxCount = 300): string[] {
    if (!rootDir || !fs.existsSync(rootDir)) return [];

    const queue: Array<{ dir: string; depth: number }> = [{ dir: rootDir, depth: 0 }];
    const files: string[] = [];

    while (queue.length > 0 && files.length < maxCount) {
        const current = queue.shift()!;
        let entries: fs.Dirent[] = [];
        try {
            entries = fs.readdirSync(current.dir, { withFileTypes: true });
        } catch {
            continue;
        }

        for (const entry of entries) {
            const fullPath = path.join(current.dir, entry.name);
            if (entry.isDirectory()) {
                if (current.depth >= maxDepth) continue;
                if (SCAN_EXCLUDE_DIRS.has(entry.name.toLowerCase())) continue;
                queue.push({ dir: fullPath, depth: current.depth + 1 });
                continue;
            }
            if (!entry.isFile()) continue;
            if (!isSupportedTemplateFile(entry.name)) continue;
            files.push(fullPath);
            if (files.length >= maxCount) break;
        }
    }

    return files;
}

/**
 * 复制模板文件到知识库目录
 */
function copyTemplateFile(sourcePath: string): string {
    ensureStorageDir();
    const fileName = `${crypto.randomUUID()}${path.extname(sourcePath)}`;
    const destPath = path.join(getFilesDir(), fileName);
    
    // 确保 files 目录存在
    const filesDir = getFilesDir();
    if (!fs.existsSync(filesDir)) {
        fs.mkdirSync(filesDir, { recursive: true });
    }
    
    fs.copyFileSync(sourcePath, destPath);
    return destPath;
}

/**
 * 模板知识库服务类
 */
export class TemplateKnowledgeService {
    /**
     * 获取模板库存储信息
     */
    static getStorageInfo(): {
        rootPath: string;
        filesPath: string;
        dataFile: string;
        totalTemplates: number;
        supportedFormats: string[];
    } {
        const templates = this.getAll();
        return {
            rootPath: getStoragePath(),
            filesPath: getFilesDir(),
            dataFile: getDataFile(),
            totalTemplates: templates.length,
            supportedFormats: [...SUPPORTED_TEMPLATE_EXTS]
        };
    }

    /**
     * 获取模板解析设置
     */
    static getResolverSettings(): TemplateResolverSettings {
        return readResolverSettings();
    }

    /**
     * 保存模板解析设置
     */
    static setResolverSettings(settings: Partial<TemplateResolverSettings>): TemplateResolverSettings {
        const current = readResolverSettings();
        return writeResolverSettings({
            localLibraryDirs: Array.isArray(settings.localLibraryDirs)
                ? settings.localLibraryDirs
                : current.localLibraryDirs
        });
    }

    /**
     * 获取 SKU 模板候选（顺序：用户本地库 -> 知识库）
     */
    static getSKUTemplateCandidates(): SKUTemplateCandidate[] {
        const settings = this.getResolverSettings();
        const candidates: SKUTemplateCandidate[] = [];
        const seen = new Set<string>();

        // 1) 用户设置的本地模板库
        settings.localLibraryDirs.forEach((dir, dirIndex) => {
            if (!dir || !fs.existsSync(dir)) return;
            const files = listTemplateFilesInDirectory(dir, 5, 300);
            for (const filePath of files) {
                const normalizedPath = path.normalize(filePath).toLowerCase();
                if (seen.has(normalizedPath)) continue;
                seen.add(normalizedPath);
                const fileName = path.basename(filePath, path.extname(filePath));
                candidates.push({
                    id: `local-${crypto.createHash('md5').update(normalizedPath).digest('hex')}`,
                    name: fileName,
                    filePath,
                    source: 'local-library',
                    sourcePriority: dirIndex
                });
            }
        });

        // 2) 已入库的模板知识（作为补充）
        const knowledgeTemplates = this.query({ type: 'sku' });
        for (const item of knowledgeTemplates) {
            const normalizedPath = path.normalize(item.filePath).toLowerCase();
            if (seen.has(normalizedPath)) continue;
            seen.add(normalizedPath);
            candidates.push({
                id: item.id,
                name: item.name,
                filePath: item.filePath,
                description: item.description,
                metadata: item.metadata ? { comboSize: item.metadata.comboSize } : undefined,
                source: 'knowledge-library',
                sourcePriority: 1000
            });
        }

        return candidates;
    }

    /**
     * 查找最匹配的 SKU 模板（顺序仍遵循 sourcePriority）
     */
    static findTemplateForSKU(params: FindSKUTemplateParams): SKUTemplateCandidate | null {
        const comboSize = Number(params.comboSize || 0);
        if (!Number.isFinite(comboSize) || comboSize <= 0) return null;

        const keyword = String(params.keyword || '').trim().toLowerCase();
        const noteMode = params.noteMode === true;
        const sourceSet = Array.isArray(params.sources) && params.sources.length > 0
            ? new Set(params.sources)
            : null;
        const sizeKeyword = `${comboSize}双`;
        const noteKeyword = '自选备注';

        const scored = this.getSKUTemplateCandidates()
            .filter(item => !sourceSet || sourceSet.has(item.source))
            .map((item) => {
                const name = normalizeName(item.name || path.basename(item.filePath));
                const description = String(item.description || '').toLowerCase();
                const hasNote = name.includes(noteKeyword);
                if (noteMode && !hasNote) return { item, score: -Infinity };
                if (!noteMode && hasNote) return { item, score: -Infinity };

                let score = 0;
                const inferredSize = item.metadata?.comboSize ?? extractComboSizeFromName(item.name) ?? extractComboSizeFromName(item.filePath);
                if (inferredSize === comboSize) score += 100;
                if (name.includes(sizeKeyword)) score += 60;
                if (keyword && (name.includes(keyword) || description.includes(keyword))) score += 25;
                if (name.includes('模板')) score += 8;
                if (/\.psd$/i.test(item.filePath)) score += 4;
                if (/\.psb$/i.test(item.filePath)) score += 2;

                // 同分时优先 sourcePriority 更小（即用户本地库优先）
                score += Math.max(0, 20 - item.sourcePriority / 100);
                return { item, score };
            })
            .filter(row => Number.isFinite(row.score))
            .sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                return a.item.sourcePriority - b.item.sourcePriority;
            });

        return scored.length > 0 ? scored[0].item : null;
    }

    /**
     * 获取可用 SKU 规格（从候选模板提取）
     */
    static getAvailableSKUSpecs(params?: GetAvailableSKUSpecsParams): number[] {
        const sources = params?.sources;
        const sourceSet = Array.isArray(sources) && sources.length > 0
            ? new Set(sources)
            : null;
        const noteKeyword = '自选备注';
        const specs = new Set<number>();
        for (const item of this.getSKUTemplateCandidates()) {
            if (sourceSet && !sourceSet.has(item.source)) continue;
            const name = normalizeName(item.name || '');
            if (name.includes(noteKeyword)) continue;
            const size = item.metadata?.comboSize ?? extractComboSizeFromName(item.name) ?? extractComboSizeFromName(item.filePath);
            if (size && size > 0) specs.add(size);
        }
        return Array.from(specs).sort((a, b) => a - b);
    }

    /**
     * 解析 Photoshop 文档对应的源文件路径
     */
    static resolvePhotoshopDocumentFile(params: ResolvePhotoshopTemplateFileParams): { filePath: string } {
        const documentName = (params.documentName || '').trim();
        if (!documentName) {
            throw new Error('缺少 documentName，无法解析模板源文件');
        }

        // 1) 如果 UXP 已提供文档路径，直接使用
        const docPath = params.documentPath?.trim();
        if (docPath && fs.existsSync(docPath) && isSupportedTemplateFile(docPath)) {
            return { filePath: docPath };
        }

        // 2) 在项目目录中尝试解析（优先“模板文件”目录）
        const projectPath = params.currentProjectPath?.trim();
        if (projectPath && fs.existsSync(projectPath)) {
            const targetBase = normalizeName(documentName);
            const targetExt = path.extname(documentName).toLowerCase();
            const roots = [
                path.join(projectPath, '模板文件'),
                projectPath
            ].filter((dirPath, index, arr) => arr.indexOf(dirPath) === index && fs.existsSync(dirPath));

            for (const root of roots) {
                // 先做 O(1) 直查（文件名完全匹配）
                const directCandidates: string[] = [];
                if (targetExt && SUPPORTED_TEMPLATE_EXTS.includes(targetExt)) {
                    directCandidates.push(path.join(root, documentName));
                }
                for (const ext of SUPPORTED_TEMPLATE_EXTS) {
                    directCandidates.push(path.join(root, `${targetBase}${ext}`));
                }

                const direct = directCandidates.find(candidate => fs.existsSync(candidate) && isSupportedTemplateFile(candidate));
                if (direct) {
                    return { filePath: direct };
                }

                // 再做有限深度扫描（支持“4双装-模板A”这类命名）
                const scanned = findTemplateFilesByName(root, documentName);
                if (scanned.length > 0) {
                    return { filePath: scanned[0] };
                }
            }
        }

        // 3) 在用户设置的本地模板库中查找
        const resolver = this.getResolverSettings();
        for (const localDir of resolver.localLibraryDirs) {
            if (!localDir || !fs.existsSync(localDir)) continue;
            const scanned = findTemplateFilesByName(localDir, documentName);
            if (scanned.length > 0) {
                return { filePath: scanned[0] };
            }
        }

        throw new Error('无法定位 Photoshop 文档对应的模板文件，请先保存文档或手动选择文件');
    }
    /**
     * 获取所有模板
     */
    static getAll(): TemplateAsset[] {
        const kb = readKnowledge();
        return kb.templates;
    }
    
    /**
     * 按条件查询模板
     */
    static query(params: TemplateQuery): TemplateAsset[] {
        const kb = readKnowledge();
        let templates = [...kb.templates];
        
        // 按类型筛选
        if (params.type) {
            templates = templates.filter(t => t.type === params.type);
        }
        
        // 按标签筛选
        if (params.tags && params.tags.length > 0) {
            templates = templates.filter(t => 
                t.tags?.some(tag => params.tags!.includes(tag))
            );
        }
        
        // 按类目筛选
        if (params.category) {
            templates = templates.filter(t => 
                t.metadata?.category === params.category
            );
        }
        
        // 按规格筛选
        if (params.comboSize !== undefined) {
            templates = templates.filter(t => 
                t.metadata?.comboSize === params.comboSize
            );
        }
        
        // 关键词搜索
        if (params.keyword) {
            const kw = params.keyword.toLowerCase();
            templates = templates.filter(t => 
                t.name.toLowerCase().includes(kw) ||
                t.description.toLowerCase().includes(kw) ||
                t.tags?.some(tag => tag.toLowerCase().includes(kw))
            );
        }
        
        return templates;
    }
    
    /**
     * 获取单个模板
     */
    static getById(id: string): TemplateAsset | null {
        const kb = readKnowledge();
        return kb.templates.find(t => t.id === id) || null;
    }
    
    /**
     * 按类型获取模板（供 AI 使用）
     */
    static getByType(type: TemplateType): TemplateAsset[] {
        return this.query({ type });
    }
    
    /**
     * 获取 SKU 模板（按规格）
     */
    static getSKUTemplate(comboSize: number): TemplateAsset | null {
        const templates = this.query({ type: 'sku', comboSize });
        return templates[0] || null;
    }
    
    /**
     * 添加模板
     */
    static async add(params: AddTemplateParams): Promise<TemplateAsset> {
        const kb = readKnowledge();
        
        // 检查文件是否存在
        if (!fs.existsSync(params.filePath)) {
            throw new Error(`模板文件不存在: ${params.filePath}`);
        }
        if (!isSupportedTemplateFile(params.filePath)) {
            throw new Error(`不支持的模板格式: ${path.extname(params.filePath)}`);
        }
        
        // 复制文件到知识库目录
        const storedPath = copyTemplateFile(params.filePath);
        
        // 检测文件格式
        const fileFormat = detectFormat(params.filePath);
        
        const template: TemplateAsset = {
            id: crypto.randomUUID(),
            name: params.name,
            type: params.type,
            filePath: storedPath,
            fileFormat,
            description: params.description,
            aiPrompt: params.aiPrompt,
            metadata: params.metadata,
            tags: params.tags,
            source: 'user',
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        
        kb.templates.push(template);
        writeKnowledge(kb);
        
        console.log(`[TemplateKnowledge] 添加模板: ${template.name} (${template.id})`);
        return template;
    }

    /**
     * 从 Photoshop 文档直接添加模板
     */
    static async addFromPhotoshop(params: AddTemplateFromPhotoshopParams): Promise<TemplateAsset> {
        const resolved = this.resolvePhotoshopDocumentFile({
            documentName: params.documentName,
            documentPath: params.documentPath,
            currentProjectPath: params.currentProjectPath
        });

        const defaultName = path.basename(params.documentName || resolved.filePath, path.extname(params.documentName || resolved.filePath));
        const comboSize = extractComboSizeFromName(params.documentName || defaultName);
        const mergedMetadata = {
            ...params.metadata,
            sourcePath: resolved.filePath,
            sourceDocumentName: params.documentName
        };

        if (params.type === 'sku' && !mergedMetadata.comboSize && comboSize) {
            mergedMetadata.comboSize = comboSize;
        }

        return this.add({
            name: defaultName,
            type: params.type,
            filePath: resolved.filePath,
            description: params.description?.trim() || `从 Photoshop 文档「${defaultName}」导入`,
            aiPrompt: params.aiPrompt,
            metadata: mergedMetadata,
            tags: params.tags
        });
    }
    
    /**
     * 更新模板
     */
    static update(params: UpdateTemplateParams): TemplateAsset {
        const kb = readKnowledge();
        const index = kb.templates.findIndex(t => t.id === params.id);
        
        if (index === -1) {
            throw new Error(`模板不存在: ${params.id}`);
        }
        
        const template = kb.templates[index];
        
        // 更新字段
        if (params.name !== undefined) template.name = params.name;
        if (params.description !== undefined) template.description = params.description;
        if (params.aiPrompt !== undefined) template.aiPrompt = params.aiPrompt;
        if (params.metadata !== undefined) template.metadata = { ...template.metadata, ...params.metadata };
        if (params.tags !== undefined) template.tags = params.tags;
        
        template.updatedAt = Date.now();
        
        kb.templates[index] = template;
        writeKnowledge(kb);
        
        console.log(`[TemplateKnowledge] 更新模板: ${template.name}`);
        return template;
    }
    
    /**
     * 删除模板
     */
    static delete(id: string): boolean {
        const kb = readKnowledge();
        const index = kb.templates.findIndex(t => t.id === id);
        
        if (index === -1) {
            return false;
        }
        
        const template = kb.templates[index];
        
        // 删除关联文件
        try {
            if (template.filePath && fs.existsSync(template.filePath)) {
                fs.unlinkSync(template.filePath);
            }
            if (template.thumbnail) {
                const thumbPath = path.join(getThumbnailDir(), `${template.id}.jpg`);
                if (fs.existsSync(thumbPath)) {
                    fs.unlinkSync(thumbPath);
                }
            }
        } catch (e) {
            console.warn('[TemplateKnowledge] 删除文件失败:', e);
        }
        
        kb.templates.splice(index, 1);
        writeKnowledge(kb);
        
        console.log(`[TemplateKnowledge] 删除模板: ${template.name}`);
        return true;
    }
    
    /**
     * 设置缩略图
     */
    static setThumbnail(id: string, thumbnailBase64: string): boolean {
        const kb = readKnowledge();
        const template = kb.templates.find(t => t.id === id);
        
        if (!template) return false;
        
        // 保存缩略图文件
        const thumbnailDir = getThumbnailDir();
        const thumbPath = path.join(thumbnailDir, `${id}.jpg`);
        
        // 去除 Base64 前缀
        const base64Data = thumbnailBase64.replace(/^data:image\/\w+;base64,/, '');
        fs.writeFileSync(thumbPath, Buffer.from(base64Data, 'base64'));
        
        template.thumbnail = `file://${thumbPath}`;
        template.updatedAt = Date.now();
        
        writeKnowledge(kb);
        return true;
    }
    
    /**
     * 设置模板规格
     */
    static setSpecs(id: string, specs: TemplateSpecs): boolean {
        const kb = readKnowledge();
        const template = kb.templates.find(t => t.id === id);
        
        if (!template) return false;
        
        template.specs = specs;
        template.updatedAt = Date.now();
        
        writeKnowledge(kb);
        return true;
    }
    
    /**
     * 获取模板描述（供 AI 使用）
     */
    static getTemplateDescriptionForAI(id: string): string {
        const template = this.getById(id);
        if (!template) return '';
        
        let description = `模板名称: ${template.name}\n`;
        description += `类型: ${template.type}\n`;
        description += `描述: ${template.description}\n`;
        
        if (template.aiPrompt) {
            description += `使用提示: ${template.aiPrompt}\n`;
        }
        
        if (template.metadata) {
            const meta = template.metadata;
            if (meta.comboSize) description += `规格: ${meta.comboSize}双装\n`;
            if (meta.category) description += `类目: ${meta.category}\n`;
            if (meta.placeholderLayers?.length) {
                description += `占位图层: ${meta.placeholderLayers.join(', ')}\n`;
            }
            if (meta.textLayers?.length) {
                description += `文字图层: ${meta.textLayers.join(', ')}\n`;
            }
            if (meta.layerStructure) {
                description += `图层结构: ${meta.layerStructure}\n`;
            }
        }
        
        if (template.specs) {
            description += `尺寸: ${template.specs.width}x${template.specs.height}px\n`;
        }
        
        return description;
    }
    
    /**
     * 获取所有模板的 AI 摘要
     */
    static getAllTemplatesForAI(): string {
        const templates = this.getAll();
        
        if (templates.length === 0) {
            return '当前知识库中没有模板。';
        }
        
        let summary = `知识库中共有 ${templates.length} 个模板:\n\n`;
        
        // 按类型分组
        const byType: Record<string, TemplateAsset[]> = {};
        for (const t of templates) {
            if (!byType[t.type]) byType[t.type] = [];
            byType[t.type].push(t);
        }
        
        const typeLabels: Record<string, string> = {
            'sku': 'SKU 排版模板',
            'detail-page': '详情页模板',
            'banner': 'Banner 模板',
            'main-image': '主图模板',
            'other': '其他模板'
        };
        
        for (const [type, list] of Object.entries(byType)) {
            summary += `【${typeLabels[type] || type}】\n`;
            for (const t of list) {
                summary += `- ${t.name}`;
                if (t.metadata?.comboSize) summary += ` (${t.metadata.comboSize}双装)`;
                summary += `: ${t.description}\n`;
            }
            summary += '\n';
        }
        
        return summary;
    }
    
    /**
     * 导出模板列表（JSON）
     */
    static exportJSON(): string {
        const templates = this.getAll();
        return JSON.stringify(templates, null, 2);
    }
    
    /**
     * 导入模板列表（JSON）
     */
    static importJSON(jsonContent: string): { imported: number; errors: string[] } {
        const errors: string[] = [];
        let imported = 0;
        
        try {
            const data = JSON.parse(jsonContent);
            const templates = Array.isArray(data) ? data : data.templates || [];
            
            for (const item of templates) {
                try {
                    if (!item.name || !item.filePath || !item.description) {
                        errors.push(`跳过无效模板: ${item.name || '未命名'}`);
                        continue;
                    }
                    
                    // 检查文件是否存在
                    if (!fs.existsSync(item.filePath)) {
                        errors.push(`文件不存在: ${item.filePath}`);
                        continue;
                    }
                    
                    this.add({
                        name: item.name,
                        type: item.type || 'other',
                        filePath: item.filePath,
                        description: item.description,
                        aiPrompt: item.aiPrompt,
                        metadata: item.metadata,
                        tags: item.tags
                    });
                    
                    imported++;
                } catch (e: any) {
                    errors.push(`导入失败: ${item.name} - ${e.message}`);
                }
            }
        } catch (e: any) {
            errors.push(`JSON 解析失败: ${e.message}`);
        }
        
        return { imported, errors };
    }
}

export default TemplateKnowledgeService;
