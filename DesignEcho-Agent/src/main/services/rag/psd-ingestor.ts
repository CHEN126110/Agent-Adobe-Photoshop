import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import * as agPsd from 'ag-psd';
import type { EmbeddingService } from './embedding-service';
import type { VectorStore } from './vector-store';
import type { KnowledgeEntry, KnowledgeMetadata, KnowledgeSource } from './types';
import { encodeLayoutSignature, LayoutBox } from './layout-signature';
import { EdgeStore, DesignGraphRecord, GraphNodeRecord, GraphEdgeRecord } from './edge-store';

/** ag-psd 与 Node.js Buffer 限制，超过此大小需使用 header-only 解析 */
const LARGE_FILE_THRESHOLD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB

export interface DocumentStructure {
    name: string;
    width: number;
    height: number;
    children: any[]; // 兼容 ag-psd 节点结构
}

export interface PsdIngestOptions {
    projectId?: string;
    author?: string;
    categories?: string[];
    source?: KnowledgeSource;
    includeComponents?: boolean;
    maxComponents?: number;
}

export interface PsdIngestResult {
    filePath: string;
    sceneId?: string;
    ingested: number;
    componentCount: number;
    errors: string[];
    /** 大文件(>2GB)仅元数据入库 */
    largeFileStub?: boolean;
}

function sha1(input: string): string {
    return crypto.createHash('sha1').update(input).digest('hex');
}

function nowIso(): string {
    return new Date().toISOString();
}

function safeString(v: any): string {
    if (typeof v === 'string') return v;
    if (v === null || v === undefined) return '';
    return String(v);
}

function collectTextLayers(node: any, out: string[]): void {
    if (!node) return;
    const text = node.text || node.textData?.text;
    if (typeof text === 'string' && text.trim().length > 0) {
        out.push(text.trim());
    }
    const name = node.name;
    if (typeof name === 'string' && name.trim().length > 0) {
        if (node.children) out.push(`组:${name.trim()}`);
    }
    const children = node.children;
    if (Array.isArray(children)) {
        for (const child of children) collectTextLayers(child, out);
    }
}

function countLayers(node: any): number {
    if (!node) return 0;
    const children = node.children;
    if (!Array.isArray(children) || children.length === 0) return 1;
    return children.reduce((sum: number, c: any) => sum + countLayers(c), 0);
}

function collectAllLayerNames(node: any, out: string[], maxLen: number): void {
    if (!node || out.length >= maxLen) return;
    const name = typeof node?.name === 'string' ? node.name.trim() : '';
    if (name) out.push(name);
    const children = node?.children;
    if (Array.isArray(children)) {
        for (const c of children) collectAllLayerNames(c, out, maxLen);
    }
}

function buildSceneText(fileName: string, psd: any): string {
    const pieces: string[] = [];
    pieces.push(`文件:${fileName}`);
    const w = psd?.width;
    const h = psd?.height;
    if (typeof w === 'number' && typeof h === 'number') pieces.push(`画布:${w}x${h}`);

    const texts: string[] = [];
    collectTextLayers(psd, texts);
    // 增加文本数量上限，避免详情页长图截断
    if (texts.length > 0) pieces.push(`文本:${texts.slice(0, 200).join(' | ')}`);

    const layerNames: string[] = [];
    collectAllLayerNames(psd, layerNames, 200);
    if (layerNames.length > 0) pieces.push(`图层:${layerNames.join(' | ')}`);

    const groups: string[] = [];
    if (Array.isArray(psd?.children)) {
        for (const child of psd.children) {
            if (child?.children && typeof child?.name === 'string' && child.name.trim()) {
                groups.push(child.name.trim());
            }
        }
    }
    if (groups.length > 0) pieces.push(`顶层组:${groups.join(' | ')}`);
    return pieces.join('\n');
}

function buildComponentText(group: any): string {
    const pieces: string[] = [];
    const name = typeof group?.name === 'string' ? group.name.trim() : '';
    if (name) pieces.push(`组件:${name}`);
    const texts: string[] = [];
    collectTextLayers(group, texts);
    // 增加组件内文本数量上限
    if (texts.length > 0) pieces.push(`内容:${texts.slice(0, 120).join(' | ')}`);
    const childNames: string[] = [];
    collectAllLayerNames(group, childNames, 80);
    if (childNames.length > 0) pieces.push(`子图层:${childNames.join(' | ')}`);
    return pieces.join('\n');
}

function nodeToBox(id: string, node: any): LayoutBox | null {
    const left = node?.left;
    const top = node?.top;
    const right = node?.right;
    const bottom = node?.bottom;
    if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(right) || !Number.isFinite(bottom)) return null;
    if (right <= left || bottom <= top) return null;
    return { id, left, top, right, bottom };
}

function collectImmediateChildBoxes(node: any, maxCount: number): LayoutBox[] {
    const out: LayoutBox[] = [];
    const children = node?.children;
    if (!Array.isArray(children) || children.length === 0) return out;
    for (let i = 0; i < children.length && out.length < maxCount; i++) {
        const b = nodeToBox(`child-${i}`, children[i]);
        if (b) out.push(b);
    }
    return out;
}

/**
 * 仅读取 PSD/PSB 文件头（26 字节），用于 >2GB 大文件
 * 格式：4 签名 + 2 版本 + 6 保留 + 2 通道 + 4 高 + 4 宽 + 2 深度 + 2 色彩模式
 */
async function readPsdHeaderOnly(filePath: string): Promise<{ width: number; height: number; isValid: boolean }> {
    const fd = await fs.open(filePath, 'r');
    try {
        const buf = Buffer.alloc(26);
        await fd.read(buf, 0, 26, 0);
        if (buf.toString('ascii', 0, 4) !== '8BPS') {
            return { width: 0, height: 0, isValid: false };
        }
        const height = buf.readUInt32BE(14);
        const width = buf.readUInt32BE(18);
        return { width, height, isValid: width > 0 && height > 0 };
    } finally {
        await fd.close();
    }
}

/** 递归收集可索引的组（含嵌套，最大深度 4） */
function collectIndexableGroups(node: any, depth: number, maxDepth: number, out: any[]): void {
    if (depth > maxDepth || !node) return;
    const children = node?.children;
    if (!Array.isArray(children)) return;
    for (const c of children) {
        const name = typeof c?.name === 'string' ? c.name.trim() : '';
        const hasChildren = Array.isArray(c?.children) && c.children.length > 0;
        
        // 关键改动：只要是组（有子图层），且有名字，就视为潜在组件
        if (hasChildren && name) {
            out.push(c);
            // 继续递归，寻找嵌套的组件（如详情页里的“卖点模块”）
            collectIndexableGroups(c, depth + 1, maxDepth, out);
        } else if (name && (c?.left != null || c?.right != null)) {
            // 具名图层，也暂存（视情况可放宽）
            // out.push(c); // 暂时不把单图层当组件，避免碎片化
        }
    }
}

export class PsdIngestor {
    constructor(
        private embeddingService: EmbeddingService,
        private vectorStore: VectorStore
    ) {}

    private edgeStore = new EdgeStore();

    /**
     * 从 PSD 缩略图提取视觉向量（最佳努力，不阻断主流程）
     */
    private async tryBuildPsdVisualEmbedding(psd: any, filePath: string): Promise<Float32Array | undefined> {
        try {
            const raw = psd?.imageResources?.thumbnailRaw?.data;
            if (!raw) return undefined;

            const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
            if (!bytes || bytes.length === 0) return undefined;

            const previewDir = path.join(path.dirname(filePath), '.designecho', 'cache', 'rag-previews');
            await fs.mkdir(previewDir, { recursive: true });
            const previewPath = path.join(previewDir, `${sha1(filePath)}-thumb.jpg`);
            await fs.writeFile(previewPath, bytes);

            return await this.embeddingService.embedImage(previewPath);
        } catch (e: any) {
            console.warn(`[PsdIngestor] 视觉向量提取失败(已降级): ${e?.message || String(e)}`);
            return undefined;
        }
    }

    /** 大文件(>2GB)仅元数据入库，避免 ag-psd/Buffer 限制 */
    private async ingestLargeFileStub(
        filePath: string,
        fileName: string,
        opts: { source: KnowledgeSource; categories: string[]; projectId: string; author: string }
    ): Promise<PsdIngestResult> {
        const header = await readPsdHeaderOnly(filePath);
        if (!header.isValid) {
            return { filePath, ingested: 0, componentCount: 0, errors: ['大文件头解析失败'] };
        }
        const sceneId = `psd-scene-${sha1(filePath)}`;
        const text = `文件:${fileName}\n画布:${header.width}x${header.height}\n大文件(>2GB)仅元数据，图层结构未解析`;
        const entry: KnowledgeEntry = {
            id: sceneId,
            type: 'case' as any,
            title: fileName,
            text,
            description: '',
            metadata: {
                source: opts.source,
                categories: [...opts.categories, 'large-file'],
                keywords: ['大文件', '元数据'],
                priority: 2,
                createdAt: nowIso(),
                usageCount: 0,
                extra: {
                    designKind: 'scene',
                    filePath,
                    projectId: opts.projectId,
                    author: opts.author,
                    width: header.width,
                    height: header.height,
                    largeFileStub: true
                }
            } as KnowledgeMetadata
        };
        try {
            const embedding = await this.embeddingService.embed(text);
            await this.vectorStore.upsert([{ entry, embedding }]);
            return { filePath, sceneId, ingested: 1, componentCount: 0, errors: [], largeFileStub: true };
        } catch (e: any) {
            return { filePath, ingested: 0, componentCount: 0, errors: [`大文件入库失败: ${e?.message}`] };
        }
    }

    async ingestFile(filePath: string, options?: PsdIngestOptions): Promise<PsdIngestResult> {
        const errors: string[] = [];
        const fileName = path.basename(filePath);
        const source: KnowledgeSource = options?.source || 'import';
        const categories = options?.categories?.length ? options.categories : ['design'];
        const projectId = options?.projectId || '';
        const author = options?.author || '';
        const includeComponents = options?.includeComponents !== false;
        const maxComponents = options?.maxComponents ?? 150;

        const stats = await fs.stat(filePath).catch(() => null);
        const isLargeFile = stats && stats.size >= LARGE_FILE_THRESHOLD_BYTES;

        if (isLargeFile) {
            return this.ingestLargeFileStub(filePath, fileName, { source, categories, projectId, author });
        }

        let psd: any;
        try {
            const buffer = await fs.readFile(filePath);
            psd = agPsd.readPsd(buffer, {
                skipLayerImageData: true,
                skipCompositeImageData: true,
                skipThumbnail: false,
                useRawThumbnail: true
            });
        } catch (e: any) {
            return {
                filePath,
                ingested: 0,
                componentCount: 0,
                errors: [`解析失败: ${e?.message || String(e)}`]
            };
        }

        return this.processDocument(psd, fileName, filePath, {
            source,
            categories,
            projectId,
            author,
            includeComponents,
            maxComponents
        });
    }

    async ingestFromObject(doc: DocumentStructure, options?: PsdIngestOptions): Promise<PsdIngestResult> {
        const source: KnowledgeSource = options?.source || 'uxp';
        const categories = options?.categories?.length ? options.categories : ['design'];
        const projectId = options?.projectId || '';
        const author = options?.author || '';
        const includeComponents = options?.includeComponents !== false;
        const maxComponents = options?.maxComponents ?? 150;
        
        // 虚拟路径，用于生成 ID
        const filePath = `uxp://${doc.name}`;

        return this.processDocument(doc, doc.name, filePath, {
            source,
            categories,
            projectId,
            author,
            includeComponents,
            maxComponents
        });
    }

    private async processDocument(
        psd: any, 
        fileName: string, 
        filePath: string,
        opts: {
            source: KnowledgeSource;
            categories: string[];
            projectId: string;
            author: string;
            includeComponents: boolean;
            maxComponents: number;
        }
    ): Promise<PsdIngestResult> {
        const startTime = performance.now();
        const errors: string[] = [];
        const { source, categories, projectId, author, includeComponents, maxComponents } = opts;

        const createdAt = nowIso();
        const layerCount = countLayers(psd);
        
        console.log(`[PsdIngestor] 开始处理: ${fileName}`);
        console.log(`[PsdIngestor]   尺寸: ${psd?.width}x${psd?.height}, 图层数: ${layerCount}`);

        const sceneId = `psd-scene-${sha1(`${filePath}`)}`;
        const graphId = `graph-${sha1(`${filePath}`)}`;

        const sceneEntry: KnowledgeEntry = {
            id: sceneId,
            type: 'case' as any,
            title: fileName,
            text: buildSceneText(fileName, psd),
            description: '',
            metadata: {
                source,
                categories,
                keywords: [],
                priority: 3,
                createdAt,
                usageCount: 0,
                extra: {
                    designKind: 'scene',
                    filePath,
                    projectId,
                    author,
                    width: psd?.width,
                    height: psd?.height,
                    layerCount,
                    graphRef: graphId
                }
            } as KnowledgeMetadata
        };

        let ingested = 0;
        let componentCount = 0;
        const sceneVisualEmbedding = await this.tryBuildPsdVisualEmbedding(psd, filePath);

        try {
            const sceneEmbedding = await this.embeddingService.embed(sceneEntry.text);
            const sceneBoxes: LayoutBox[] = Array.isArray(psd?.children)
                ? psd.children
                    .filter((c: any) => Array.isArray(c?.children) && c.children.length > 0)
                    .map((c: any, idx: number) => nodeToBox(`group-${idx}`, c))
                    .filter(Boolean) as LayoutBox[]
                : [];
            const layoutEmbedding = encodeLayoutSignature(sceneBoxes, this.embeddingService.getDimension('text'));
            await this.vectorStore.upsert([{
                entry: sceneEntry,
                embedding: sceneEmbedding,
                visualEmbedding: sceneVisualEmbedding,
                layoutEmbedding
            }]);
            ingested += 1;
            console.log(`[PsdIngestor]   场景入库完成 (文本长度: ${sceneEntry.text.length})`);
        } catch (e: any) {
            errors.push(`场景入库失败: ${e?.message || String(e)}`);
            console.error(`[PsdIngestor]   场景入库失败:`, e);
        }

        const graphNodes: GraphNodeRecord[] = [
            { id: sceneId, kind: 'scene', name: fileName }
        ];
        const graphEdges: GraphEdgeRecord[] = [];

        if (includeComponents && Array.isArray(psd?.children) && psd.children.length > 0) {
            const groups: any[] = [];
            // 增加深度到 4，覆盖详情页深层结构
            collectIndexableGroups(psd, 0, 4, groups);
            
            console.log(`[PsdIngestor]   发现组件组: ${groups.length} 个 (最大深度: 4)`);
            
            const sliced = groups.slice(0, Math.max(0, maxComponents));
            const componentEntries: KnowledgeEntry[] = [];

            for (const g of sliced) {
                const gid = `psd-comp-${sha1(`${filePath}|${safeString(g?.name)}|${safeString(g?.top)}|${safeString(g?.left)}|${safeString(g?.right)}|${safeString(g?.bottom)}`)}`;
                const title = typeof g?.name === 'string' && g.name.trim() ? g.name.trim() : `${fileName}-组件`;
                componentEntries.push({
                    id: gid,
                    type: 'case' as any,
                    title,
                    text: buildComponentText(g),
                    description: '',
                    metadata: {
                        source,
                        categories: [...categories, 'component'],
                        keywords: [],
                        priority: 2,
                        createdAt,
                        usageCount: 0,
                        extra: {
                            designKind: 'component',
                            filePath,
                            projectId,
                            author,
                            groupName: title,
                            graphRef: graphId
                        }
                    }
                });

                const bbox = nodeToBox(gid, g);
                graphNodes.push({
                    id: gid,
                    kind: 'component',
                    name: title,
                    bbox: bbox ? { left: bbox.left, top: bbox.top, right: bbox.right, bottom: bbox.bottom } : undefined
                });
                graphEdges.push({ from: sceneId, to: gid, type: 'contains' });
            }

            if (componentEntries.length > 0) {
                try {
                    const embeddings = await this.embeddingService.embedBatch(componentEntries.map(e => e.text));
                    const vectorized = componentEntries.map((entry, i) => {
                        const g = sliced[i];
                        const childBoxes = collectImmediateChildBoxes(g, 60);
                        const layoutEmbedding = encodeLayoutSignature(childBoxes, this.embeddingService.getDimension('text'));
                        return { entry, embedding: embeddings[i], visualEmbedding: sceneVisualEmbedding, layoutEmbedding };
                    });
                    await this.vectorStore.upsert(vectorized);
                    ingested += componentEntries.length;
                    componentCount = componentEntries.length;
                    console.log(`[PsdIngestor]   组件入库完成: ${componentCount} 个`);
                } catch (e: any) {
                    errors.push(`组件入库失败: ${e?.message || String(e)}`);
                    console.error(`[PsdIngestor]   组件入库失败:`, e);
                }
            }
        }

        try {
            const graph: DesignGraphRecord = {
                id: graphId,
                version: 1,
                filePath,
                createdAt,
                nodes: graphNodes,
                edges: graphEdges
            };
            await this.edgeStore.writeGraph(graph);
            console.log(`[PsdIngestor]   图谱写入完成: ${graphNodes.length} 节点, ${graphEdges.length} 边`);
        } catch (e: any) {
            errors.push(`图谱写入失败: ${e?.message || String(e)}`);
            console.error(`[PsdIngestor]   图谱写入失败:`, e);
        }

        const elapsed = performance.now() - startTime;
        console.log(`[PsdIngestor] 处理完成: 耗时 ${elapsed.toFixed(0)}ms, 总计 ${ingested} 条目`);

        return {
            filePath,
            sceneId,
            ingested,
            componentCount,
            errors
        };
    }
}
