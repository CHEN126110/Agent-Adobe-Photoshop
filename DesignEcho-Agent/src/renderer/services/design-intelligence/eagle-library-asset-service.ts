/**
 * Design Intelligence · EagleLibrary AssetService 实现（Phase 0）
 *
 * 路线图依据：docs/design-intelligence-knowledge-system-roadmap-draft.md §7/§16
 * 职责：把现有 Eagle 只读检索（searchEagleReadonlyKnowledge，MCP 端点 41596）
 *       包进统一 AssetService 契约。
 *
 * 边界：
 * - 只读：不写回 Eagle 原始元数据；AI Metadata 归 Runtime DB（后续 Phase）。
 * - 图片原文件由 Eagle Library 负责，本服务只返回轻量投影（VisualAssetRef）。
 * - 阶段 0 为 Wrapper，不改原 Agent 行为。
 */

import type { AssetService, VisualAssetRef, AssetSearchRequest, AssetSearchResponse } from './asset-service';

/** 渲染侧运行时能力（window.designEcho 上已暴露的方法签名）。 */
export interface EagleRuntimeApi {
    searchEagleReadonlyKnowledge?: (query: unknown, settings?: unknown) => Promise<{
        success: boolean;
        results?: Array<{
            id?: unknown;
            title?: unknown;
            tags?: unknown;
            summary?: unknown;
            sourceType?: unknown;
        }>;
        warnings?: string[];
        error?: string;
    }>;
}

/** 构造 Eagle AssetService 的参数。 */
export interface EagleLibraryAssetServiceOptions {
    api: EagleRuntimeApi;
}

/** 把 Eagle 只读结果映射为轻量 VisualAssetRef（纯函数，可测）。 */
export function mapEagleResultToAssetRef(input: {
    id?: unknown;
    title?: unknown;
    tags?: unknown;
    summary?: unknown;
}): VisualAssetRef {
    const id = String(input.id || '');
    return {
        id,
        title: String(input.title || ''),
        provider: 'eagle',
        locator: id,
        tags: Array.isArray(input.tags) ? input.tags.map(String) : [],
        analysis: typeof input.summary === 'string' ? input.summary : undefined
    };
}

/**
 * 基于现有 Eagle 只读通道的 AssetService 实现。
 * 仅当没有其他可用视觉源时，Eagle 检索作为主要视觉来源返回。
 */
export class EagleLibraryAssetService implements AssetService {
    readonly kind = 'asset' as const;
    private readonly api: EagleRuntimeApi;

    constructor(options: EagleLibraryAssetServiceOptions) {
        this.api = options.api;
    }

    async search(request: AssetSearchRequest): Promise<AssetSearchResponse> {
        const api = this.api.searchEagleReadonlyKnowledge;
        const warnings: string[] = [];
        if (!api) {
            warnings.push('当前桌面运行时未提供 Eagle 只读检索。');
            return { query: request.query, results: [], warnings };
        }
        try {
            const raw = await api({
                query: request.query,
                limit: request.limit || 8
            }, { enabled: true });
            if (!raw || !raw.success) {
                warnings.push(raw?.error || 'Eagle 只读检索没有返回可用结果。');
                return { query: request.query, results: [], warnings };
            }
            const results = (raw.results || []).map(mapEagleResultToAssetRef);
            warnings.push(...(raw.warnings || []));
            return { query: request.query, results, warnings: Array.from(new Set(warnings.filter(Boolean))) };
        } catch (error) {
            warnings.push(`Eagle 只读检索失败：${String(error)}`);
            return { query: request.query, results: [], warnings };
        }
    }

    async get(id: string): Promise<VisualAssetRef | null> {
        // 阶段 0 用检索兜底：命中同 id 返回，否则 null。
        const resp = await this.search({ query: id, limit: 8 });
        return resp.results.find((r) => r.id === id) || null;
    }
}
