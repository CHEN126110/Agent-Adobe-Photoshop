"use strict";
/**
 * 知识库包服务
 *
 * 支持:
 * - 从文件夹导入知识库包
 * - 管理已安装的知识库包
 * - 合并多个知识库
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.knowledgePackService = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const electron_1 = require("electron");
class KnowledgePackService {
    packsDir;
    installedPacksFile;
    installedPacks = [];
    constructor() {
        this.packsDir = path.join(electron_1.app.getPath('userData'), 'knowledge-packs');
        this.installedPacksFile = path.join(this.packsDir, 'installed.json');
        this.ensureDirectory();
        this.loadInstalledPacks();
        this.installBuiltInPacksIfNeeded();
    }
    installBuiltInPacksIfNeeded() {
        if (this.installedPacks.length > 0) {
            console.log('[KnowledgePack] 已有已安装的知识包，跳过内置包安装');
            return;
        }
        const builtInPacksDir = path.join(__dirname, '..', '..', '..', '..', 'resources', 'knowledge-packs');
        const devPacksDir = path.join(process.cwd(), 'resources', 'knowledge-packs');
        let packsDirToUse = '';
        if (fs.existsSync(builtInPacksDir)) {
            packsDirToUse = builtInPacksDir;
        }
        else if (fs.existsSync(devPacksDir)) {
            packsDirToUse = devPacksDir;
        }
        else {
            console.log('[KnowledgePack] 未找到内置知识包目录');
            return;
        }
        console.log(`[KnowledgePack] 正在从 ${packsDirToUse} 安装内置知识包...`);
        try {
            const entries = fs.readdirSync(packsDirToUse, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const packPath = path.join(packsDirToUse, entry.name);
                    const packJsonPath = path.join(packPath, 'pack.json');
                    if (fs.existsSync(packJsonPath)) {
                        console.log(`[KnowledgePack] 安装内置包: ${entry.name}`);
                        this.installPack(packPath).then(result => {
                            if (result.success) {
                                console.log(`[KnowledgePack] ✓ 内置包 ${entry.name} 安装成功`);
                            }
                            else {
                                console.error(`[KnowledgePack] ✗ 内置包 ${entry.name} 安装失败:`, result.error);
                            }
                        });
                    }
                }
            }
        }
        catch (e) {
            console.error('[KnowledgePack] 安装内置知识包失败:', e);
        }
    }
    ensureDirectory() {
        if (!fs.existsSync(this.packsDir)) {
            fs.mkdirSync(this.packsDir, { recursive: true });
        }
    }
    loadInstalledPacks() {
        try {
            if (fs.existsSync(this.installedPacksFile)) {
                this.installedPacks = JSON.parse(fs.readFileSync(this.installedPacksFile, 'utf-8'));
            }
        }
        catch (e) {
            console.error('[KnowledgePack] 加载已安装包列表失败:', e);
            this.installedPacks = [];
        }
    }
    saveInstalledPacks() {
        try {
            fs.writeFileSync(this.installedPacksFile, JSON.stringify(this.installedPacks, null, 2), 'utf-8');
        }
        catch (e) {
            console.error('[KnowledgePack] 保存已安装包列表失败:', e);
        }
    }
    validatePackFolder(folderPath) {
        try {
            const packJsonPath = path.join(folderPath, 'pack.json');
            if (!fs.existsSync(packJsonPath)) {
                return { valid: false, error: '缺少 pack.json 文件' };
            }
            const meta = JSON.parse(fs.readFileSync(packJsonPath, 'utf-8'));
            if (!meta.id || !meta.name || !meta.version) {
                return { valid: false, error: 'pack.json 缺少必要字段 (id, name, version)' };
            }
            const hasContent = fs.existsSync(path.join(folderPath, 'selling-points.json')) ||
                fs.existsSync(path.join(folderPath, 'pain-points.json')) ||
                fs.existsSync(path.join(folderPath, 'color-schemes.json')) ||
                fs.existsSync(path.join(folderPath, 'categories.json')) ||
                fs.existsSync(path.join(folderPath, 'copy-templates.json'));
            if (!hasContent) {
                return { valid: false, error: '知识库包中没有任何知识文件' };
            }
            return { valid: true, meta };
        }
        catch (e) {
            return { valid: false, error: `验证失败: ${e.message}` };
        }
    }
    readPack(folderPath) {
        const validation = this.validatePackFolder(folderPath);
        if (!validation.valid || !validation.meta) {
            console.error('[KnowledgePack] 无效的知识库包:', validation.error);
            return null;
        }
        const readJsonFile = (filename) => {
            const filePath = path.join(folderPath, filename);
            if (fs.existsSync(filePath)) {
                try {
                    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                }
                catch (e) {
                    console.error(`[KnowledgePack] 读取 ${filename} 失败:`, e);
                    return [];
                }
            }
            return [];
        };
        return {
            meta: validation.meta,
            sellingPoints: readJsonFile('selling-points.json'),
            painPoints: readJsonFile('pain-points.json'),
            colorSchemes: readJsonFile('color-schemes.json'),
            categories: readJsonFile('categories.json'),
            copyTemplates: readJsonFile('copy-templates.json'),
        };
    }
    async installPack(sourceFolderPath) {
        const validation = this.validatePackFolder(sourceFolderPath);
        if (!validation.valid || !validation.meta) {
            return { success: false, error: validation.error };
        }
        const meta = validation.meta;
        const existingIndex = this.installedPacks.findIndex(p => p.id === meta.id);
        const targetDir = path.join(this.packsDir, meta.id);
        try {
            if (fs.existsSync(targetDir)) {
                fs.rmSync(targetDir, { recursive: true });
            }
            fs.mkdirSync(targetDir, { recursive: true });
            const files = fs.readdirSync(sourceFolderPath);
            for (const file of files) {
                if (file.endsWith('.json')) {
                    const src = path.join(sourceFolderPath, file);
                    const dest = path.join(targetDir, file);
                    fs.copyFileSync(src, dest);
                }
            }
            const installedPack = {
                id: meta.id,
                name: meta.name,
                version: meta.version,
                path: targetDir,
                installedAt: new Date().toISOString(),
                enabled: true,
            };
            if (existingIndex >= 0) {
                this.installedPacks[existingIndex] = installedPack;
            }
            else {
                this.installedPacks.push(installedPack);
            }
            this.saveInstalledPacks();
            console.log(`[KnowledgePack] 已安装: ${meta.name} v${meta.version}`);
            return { success: true, pack: installedPack };
        }
        catch (e) {
            return { success: false, error: `安装失败: ${e.message}` };
        }
    }
    getInstalledPacks() {
        return this.installedPacks;
    }
    togglePack(packId, enabled) {
        const pack = this.installedPacks.find(p => p.id === packId);
        if (pack) {
            pack.enabled = enabled;
            this.saveInstalledPacks();
            return true;
        }
        return false;
    }
    uninstallPack(packId) {
        const index = this.installedPacks.findIndex(p => p.id === packId);
        if (index === -1)
            return false;
        const pack = this.installedPacks[index];
        try {
            if (fs.existsSync(pack.path)) {
                fs.rmSync(pack.path, { recursive: true });
            }
        }
        catch (e) {
            console.error('[KnowledgePack] 删除包目录失败:', e);
        }
        this.installedPacks.splice(index, 1);
        this.saveInstalledPacks();
        return true;
    }
    uninstallAll() {
        const packs = [...this.installedPacks];
        for (const p of packs) {
            this.uninstallPack(p.id);
        }
    }
    getMergedKnowledge() {
        const merged = {
            sellingPoints: [],
            painPoints: [],
            colorSchemes: [],
            categories: [],
            copyTemplates: [],
        };
        const enabledPacks = this.installedPacks.filter(p => p.enabled);
        for (const pack of enabledPacks) {
            const content = this.readPack(pack.path);
            if (!content)
                continue;
            merged.sellingPoints.push(...content.sellingPoints);
            merged.painPoints.push(...content.painPoints);
            merged.colorSchemes.push(...content.colorSchemes);
            merged.categories.push(...content.categories);
            merged.copyTemplates.push(...content.copyTemplates);
        }
        return merged;
    }
    getPacksDirectory() {
        return this.packsDir;
    }
}
exports.knowledgePackService = new KnowledgePackService();
//# sourceMappingURL=knowledge-pack-service.js.map
