/**
 * 项目索引器
 *
 * 扫描用户项目目录，提取设计作品并索引到 RAG 知识库
 * - 图片（主图/详情页/SKU）：文本描述 + BGE 向量化
 * - PSD 文件：通过 PsdIngestor 解析，产出文本 + layout_signature 向量
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { getEmbeddingService } from './rag/embedding-service';
import { getVectorStore } from './rag/vector-store';
import { getRAGService } from './rag/rag-service';
import type { KnowledgeEntry } from './rag/types';

/**
 * 递归扫描目录中匹配扩展名的文件
 */
async function scanFiles(dir: string, extensions: string[], recursive = true): Promise<string[]> {
    const results: string[] = [];
    
    try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            
            if (entry.isDirectory() && recursive) {
                const subFiles = await scanFiles(fullPath, extensions, recursive);
                results.push(...subFiles.map(f => path.join(entry.name, f)));
            } else if (entry.isFile()) {
                const ext = path.extname(entry.name).toLowerCase();
                if (extensions.includes(ext)) {
                    results.push(entry.name);
                }
            }
        }
    } catch (e) {
        // 目录读取失败，返回空数组
    }
    
    return results;
}

/**
 * 项目条目
 */
export interface ProjectItem {
    id: string;
    projectId: string;
    type: 'main_image' | 'detail_page_slice' | 'sku' | 'psd' | 'config' | 'unknown';
    filePath: string;
    relativePath: string;
    tags: string[];
    sizeBytes: number;
    createdAt: string;
    updatedAt: string;
}

/**
 * 索引统计
 */
export interface IndexStats {
    totalProjects: number;
    totalFiles: number;
    indexed: number;
    failed: number;
    skipped: number;
    visionFallbacks: number;
    duration: number;
}

/**
 * 项目索引器类
 */
export class ProjectIndexer {
    private embeddingService = getEmbeddingService();
    private vectorStore = getVectorStore();
    
    /**
     * 扫描单个项目目录
     */
    async scanProject(projectPath: string): Promise<ProjectItem[]> {
        console.log(`[ProjectIndexer] 扫描项目: ${projectPath}`);
        
        if (!await fs.pathExists(projectPath)) {
            throw new Error(`项目路径不存在: ${projectPath}`);
        }
        
        const projectId = path.basename(projectPath);
        const items: ProjectItem[] = [];
        
        // 扫描主图
        const mainImageDir = path.join(projectPath, '主图');
        if (await fs.pathExists(mainImageDir)) {
            const mainImages = await scanFiles(mainImageDir, ['.jpg', '.jpeg', '.png'], true);
            for (const file of mainImages) {
                const fullPath = path.join(mainImageDir, file);
                const stats = await fs.stat(fullPath);
                items.push({
                    id: `${projectId}:主图/${file}`,
                    projectId,
                    type: 'main_image',
                    filePath: fullPath,
                    relativePath: `主图/${file}`,
                    tags: ['main-image'],
                    sizeBytes: stats.size,
                    createdAt: stats.birthtime.toISOString(),
                    updatedAt: stats.mtime.toISOString()
                });
            }
        }
        
        // 扫描详情页切片
        const detailPageDir = path.join(projectPath, 'images');
        if (await fs.pathExists(detailPageDir)) {
            const allImages = await scanFiles(detailPageDir, ['.jpg', '.jpeg', '.png'], false);
            const detailPages = allImages.filter(f => f.startsWith('详情页'));
            for (const file of detailPages) {
                const fullPath = path.join(detailPageDir, file);
                const stats = await fs.stat(fullPath);
                items.push({
                    id: `${projectId}:images/${file}`,
                    projectId,
                    type: 'detail_page_slice',
                    filePath: fullPath,
                    relativePath: `images/${file}`,
                    tags: ['detail-page'],
                    sizeBytes: stats.size,
                    createdAt: stats.birthtime.toISOString(),
                    updatedAt: stats.mtime.toISOString()
                });
            }
        }
        
        // 扫描 SKU
        const skuDir = path.join(projectPath, 'SKU');
        if (await fs.pathExists(skuDir)) {
            const skus = await scanFiles(skuDir, ['.jpg', '.jpeg', '.png'], true);
            for (const file of skus) {
                const fullPath = path.join(skuDir, file);
                const stats = await fs.stat(fullPath);
                items.push({
                    id: `${projectId}:SKU/${file}`,
                    projectId,
                    type: 'sku',
                    filePath: fullPath,
                    relativePath: `SKU/${file}`,
                    tags: ['sku'],
                    sizeBytes: stats.size,
                    createdAt: stats.birthtime.toISOString(),
                    updatedAt: stats.mtime.toISOString()
                });
            }
        }
        
        // 扫描 PSD
        const psdDir = path.join(projectPath, 'PSD');
        if (await fs.pathExists(psdDir)) {
            const psds = await scanFiles(psdDir, ['.psd', '.psb'], false);
            for (const file of psds) {
                const fullPath = path.join(psdDir, file);
                const stats = await fs.stat(fullPath);
                items.push({
                    id: `${projectId}:PSD/${file}`,
                    projectId,
                    type: 'psd',
                    filePath: fullPath,
                    relativePath: `PSD/${file}`,
                    tags: ['psd'],
                    sizeBytes: stats.size,
                    createdAt: stats.birthtime.toISOString(),
                    updatedAt: stats.mtime.toISOString()
                });
            }
        }
        
        console.log(`[ProjectIndexer] 扫描完成: ${items.length} 个文件`);
        return items;
    }
    
    /**
     * 扫描多个项目目录
     */
    async scanProjects(basePath: string): Promise<Map<string, ProjectItem[]>> {
        console.log(`[ProjectIndexer] 扫描根目录: ${basePath}`);
        
        if (!await fs.pathExists(basePath)) {
            throw new Error(`根目录不存在: ${basePath}`);
        }
        
        const projectMap = new Map<string, ProjectItem[]>();
        
        // 查找所有项目目录 (假设以 C- 开头)
        const entries = await fs.readdir(basePath, { withFileTypes: true });
        const projectDirs = entries
            .filter(e => e.isDirectory() && (e.name.startsWith('C-') || e.name.startsWith('c-')))
            .map(e => path.join(basePath, e.name));
        
        console.log(`[ProjectIndexer] 找到 ${projectDirs.length} 个项目目录`);
        
        for (const projectDir of projectDirs) {
            try {
                const items = await this.scanProject(projectDir);
                const projectId = path.basename(projectDir);
                projectMap.set(projectId, items);
            } catch (error: any) {
                console.error(`[ProjectIndexer] 扫描项目失败 ${projectDir}:`, error.message);
            }
        }
        
        return projectMap;
    }
    
    /**
     * 生成图片的文本描述（使用 VLM）
     */
    async generateImageDescription(
        imagePath: string,
        type: ProjectItem['type'],
        visionModelFn: (imagePath: string, prompt: string) => Promise<string>
    ): Promise<{ description: string; fallback: boolean }> {
        const prompts: Record<ProjectItem['type'], string> = {
            'main_image': '请简要描述这张主图的布局、文字内容、产品位置和设计风格（50字以内）',
            'detail_page_slice': '请描述这个详情页屏的内容结构、卖点信息和视觉元素（50字以内）',
            'sku': '请描述这个SKU图中的产品颜色、数量和排列方式（30字以内）',
            'psd': 'PSD 源文件',
            'config': '配置文件',
            'unknown': '未知文件'
        };
        
        const prompt = prompts[type] || prompts['unknown'];
        
        try {
            const description = await visionModelFn(imagePath, prompt);
            return { description: description.trim(), fallback: false };
        } catch (error: any) {
            console.warn(`[ProjectIndexer] VLM 描述生成失败: ${error.message}`);
            // 降级：使用文件名和类型
            return { description: `${type}: ${path.basename(imagePath)}`, fallback: true };
        }
    }
    
    /**
     * 索引单个项目到 RAG
     * - 图片：文本描述 + BGE 向量化
     * - PSD：通过 PsdIngestor 解析（文本 + layout_signature）
     */
    async indexProject(
        projectId: string,
        items: ProjectItem[],
        visionModelFn?: (imagePath: string, prompt: string) => Promise<string>,
        onProgress?: (current: number, total: number, item: ProjectItem) => void
    ): Promise<{ success: number; failed: number; visionFallbacks: number }> {
        console.log(`[ProjectIndexer] 开始索引项目: ${projectId} (${items.length} 个文件)`);
        
        let success = 0;
        let failed = 0;
        let visionFallbacks = 0;
        
        const imageItems = items.filter(item =>
            item.type === 'main_image' ||
            item.type === 'detail_page_slice' ||
            item.type === 'sku'
        );
        const psdItems = items.filter(item => item.type === 'psd');
        const totalItems = imageItems.length + psdItems.length;
        let processed = 0;

        // 1. PSD 文件：通过 PsdIngestor 摄入（文本 + layout 向量）
        if (psdItems.length > 0) {
            const rag = getRAGService();
            for (const item of psdItems) {
                try {
                    processed++;
                    onProgress?.(processed, totalItems, item);
                    const result = await rag.ingestPsdFile(item.filePath, {
                        projectId,
                        source: 'import',
                        categories: ['design', projectId, 'psd'],
                        includeComponents: true,
                        maxComponents: 150
                    });
                    if (result.ingested > 0) {
                        success += result.ingested;
                        const suffix = (result as any).largeFileStub ? ' (大文件仅元数据)' : '';
                        console.log(`[ProjectIndexer] PSD 摄入: ${item.relativePath} -> ${result.ingested} 条${suffix}`);
                    } else {
                        failed++;
                        if (result.errors.length > 0) {
                            console.warn(`[ProjectIndexer] PSD 跳过 ${item.relativePath}:`, result.errors[0]);
                        }
                    }
                    await new Promise(r => setTimeout(r, 80));
                } catch (e: any) {
                    console.error(`[ProjectIndexer] PSD 摄入失败 ${item.id}:`, e.message);
                    failed++;
                }
            }
        }

        // 2. 图片文件：文本描述 + BGE 向量化
        for (let i = 0; i < imageItems.length; i++) {
            const item = imageItems[i];
            processed++;
            try {
                onProgress?.(processed, totalItems, item);
                
                // 生成文本描述
                let description = '';
                if (visionModelFn) {
                    const generated = await this.generateImageDescription(item.filePath, item.type, visionModelFn);
                    description = generated.description;
                    if (generated.fallback) visionFallbacks++;
                } else {
                    // 降级：使用元数据
                    description = `${item.type}: ${item.relativePath} (${item.projectId})`;
                }
                
                // 生成 embedding
                const embedding = await this.embeddingService.embed(description);
                let visualEmbedding: Float32Array | undefined;
                try {
                    visualEmbedding = await this.embeddingService.embedImage(item.filePath);
                } catch (e: any) {
                    console.warn(`[ProjectIndexer] 视觉向量生成失败(已降级): ${e?.message || String(e)}`);
                }
                
                // 构建知识条目（使用 'case' 类型存储项目素材）
                const entry: KnowledgeEntry = {
                    id: item.id,
                    text: description,
                    title: `${projectId} - ${item.relativePath}`,
                    type: 'case',  // 项目素材统一使用 'case' 类型
                    metadata: {
                        source: 'user',  // 用户导入
                        categories: [item.type, projectId],  // 实际类型存储在 categories 中
                        keywords: item.tags,
                        priority: 5,
                        createdAt: item.createdAt,
                        usageCount: 0,
                        // 扩展元数据存储在 extra 中
                        extra: {
                            filePath: item.filePath,
                            projectId: item.projectId,
                            sizeBytes: item.sizeBytes,
                            assetType: item.type  // 保存原始类型
                        }
                    }
                };
                
                // 写入向量库
                await this.vectorStore.upsert([{ entry, embedding, visualEmbedding }]);
                
                success++;
                
                // 防止过快
                await new Promise(resolve => setTimeout(resolve, 100));
                
            } catch (error: any) {
                console.error(`[ProjectIndexer] 索引失败 ${item.id}:`, error.message);
                failed++;
            }
        }
        
        console.log(`[ProjectIndexer] 项目索引完成: 成功 ${success}, 失败 ${failed}`);
        return { success, failed, visionFallbacks };
    }
    
    /**
     * 批量索引多个项目
     */
    async indexProjects(
        projectMap: Map<string, ProjectItem[]>,
        visionModelFn?: (imagePath: string, prompt: string) => Promise<string>,
        onProgress?: (projectId: string, current: number, total: number) => void
    ): Promise<IndexStats> {
        const startTime = Date.now();
        const stats: IndexStats = {
            totalProjects: projectMap.size,
            totalFiles: 0,
            indexed: 0,
            failed: 0,
            skipped: 0,
            visionFallbacks: 0,
            duration: 0
        };
        
        let projectIndex = 0;
        
        for (const [projectId, items] of projectMap.entries()) {
            projectIndex++;
            onProgress?.(projectId, projectIndex, projectMap.size);
            
            stats.totalFiles += items.length;
            
            const result = await this.indexProject(projectId, items, visionModelFn);
            stats.indexed += result.success;
            stats.failed += result.failed;
            stats.visionFallbacks += result.visionFallbacks || 0;
        }
        
        stats.duration = Date.now() - startTime;
        
        console.log(`[ProjectIndexer] 批量索引完成:`, stats);
        return stats;
    }
    
    /**
     * 清空项目索引
     */
    async clearProjectIndex(projectId: string): Promise<number> {
        console.log(`[ProjectIndexer] 清空项目索引: ${projectId}`);
        
        // 查找所有该项目的记录 ID
        const allRecords = await this.vectorStore.search(
            new Float32Array(512).fill(0),  // 空查询
            { limit: 10000 }
        );
        
        const projectRecordIds = allRecords
            .filter(r => r.id.startsWith(`${projectId}:`))
            .map(r => r.id);
        
        if (projectRecordIds.length > 0) {
            await this.vectorStore.delete(projectRecordIds);
            console.log(`[ProjectIndexer] 已删除 ${projectRecordIds.length} 条记录`);
        }
        
        return projectRecordIds.length;
    }
}

// 单例实例
let projectIndexerInstance: ProjectIndexer | null = null;

/**
 * 获取项目索引器单例
 */
export function getProjectIndexer(): ProjectIndexer {
    if (!projectIndexerInstance) {
        projectIndexerInstance = new ProjectIndexer();
    }
    return projectIndexerInstance;
}

export default ProjectIndexer;
