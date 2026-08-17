/**
 * Design Intelligence · TaskContextBuilder 工厂（Phase 1 · DI-008）
 *
 * 路线图依据：docs/design-intelligence-knowledge-system-roadmap-draft.md §20.2
 * 职责：把渲染侧运行时 API（window.designEcho）接进 KnowledgeService / AssetService，
 *       再构建 TaskContextBuilder，供 autonomous-agent executor 在任务启动时调用。
 *
 * 边界：
 * - 工厂只做装配（依赖注入），不含业务逻辑；Builder 行为保持纯逻辑可测。
 * - 运行时 API 缺失时优雅降级（Builder 返回空快照），不阻断设计任务。
 */

import type { TaskContextBuilder } from './task-context-builder';
import { TaskContextBuilder as TaskContextBuilderImpl } from './task-context-builder';
import { CompositeKnowledgeService } from './composite-knowledge-service';
import { EagleLibraryAssetService } from './eagle-library-asset-service';

/**
 * 自动启动上下文只装配本地、受治理的知识。
 * 外部搜索成本和时效性不适合成为每个设计任务的隐式前置步骤；Agent 仍可按需显式搜索。
 */
const AUTOMATIC_TASK_CONTEXT_SOURCE_TYPES = [
    'local_recipe',
    'manual_rule',
    'local_case'
] as const;

/** 渲染侧运行时能力（window.designEcho）。 */
export interface RuntimeTaskContextApi {
    searchDesignKnowledge?: (query: unknown, settings?: unknown) => Promise<{
        success: boolean;
        results?: unknown[];
        warnings?: string[];
        error?: string;
    }>;
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

let cachedBuilder: TaskContextBuilder | null = null;

/**
 * 惰性构建并缓存 TaskContextBuilder。
 * 首次调用时用当前运行时 API 装配；运行时 API 变化（如 dev 重载）可通过 reset 重建。
 */
export function getTaskContextBuilder(
    api: RuntimeTaskContextApi,
    knowledgeIndexVersion?: string
): TaskContextBuilder {
    if (cachedBuilder) return cachedBuilder;

    const knowledgeService = new CompositeKnowledgeService({
        api: {
            searchDesignKnowledge: api.searchDesignKnowledge
        },
        indexVersion: knowledgeIndexVersion || 'phase1-v1',
        sourceTypes: [...AUTOMATIC_TASK_CONTEXT_SOURCE_TYPES]
    });

    const assetService = new EagleLibraryAssetService({
        api: {
            searchEagleReadonlyKnowledge: api.searchEagleReadonlyKnowledge
        }
    });

    cachedBuilder = new TaskContextBuilderImpl({
        knowledge: knowledgeService,
        assets: assetService,
        knowledgeIndexVersion: knowledgeIndexVersion || 'phase1-v1'
    });
    return cachedBuilder;
}

/** 重置缓存（运行时 API 重载时调用）。 */
export function resetTaskContextBuilder(): void {
    cachedBuilder = null;
}
