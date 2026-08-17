/**
 * Design Intelligence · AssetService 抽象（Phase 0）
 *
 * 路线图依据：docs/design-intelligence-knowledge-system-roadmap-draft.md §7/§16
 * 职责：统一访问视觉资产（Eagle Library / 本地资产）的只读能力：搜索、按 id 获取、
 *       预览、视觉理解。隐藏底层 Provider 细节（Eagle MCP / 本地库）。
 *
 * 边界：
 * - 视觉资产的 Source of Truth 是 Eagle Library；本服务只做检索投影。
 * - 不复制图片到知识库；知识只保存 asset_id / library_id / relation / analysis / role。
 * - AI Metadata（构图 / 主体占比 / 视觉显著性…）写 Runtime DB，不写回 Eagle 原始元数据。
 * - 本阶段为只读；所有写操作必须经过 Asset Service 的 Gate（后续 Phase）。
 */

/** 视觉资产搜索请求。 */
export interface AssetSearchRequest {
    query: string;
    limit?: number;
    /** 关联的任务类型，用于定向过滤 */
    taskType?: string;
}

/** 视觉资产条目（轻量投影，不含大体积像素）。 */
export interface VisualAssetRef {
    id: string;
    title?: string;
    provider: 'eagle' | 'local';
    locator: string;
    tags: string[];
    /** 可选：分析摘要（构图 / 主体占比 / 风格…） */
    analysis?: string;
}

/** 视觉资产搜索响应。 */
export interface AssetSearchResponse {
    query: string;
    results: VisualAssetRef[];
    warnings: string[];
}

/**
 * AssetService 抽象接口。
 * 本阶段为只读；写/沉淀案例等动作见后续 Phase 的 Asset Writeback Gate。
 */
export interface AssetService {
    readonly kind: 'asset';
    search(request: AssetSearchRequest): Promise<AssetSearchResponse>;
    get(id: string): Promise<VisualAssetRef | null>;
}
