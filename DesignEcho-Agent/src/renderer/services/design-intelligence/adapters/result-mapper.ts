/**
 * Design Intelligence · 知识结果映射（纯函数，Phase 0）
 *
 * 路线图依据：docs/design-intelligence-knowledge-system-roadmap-draft.md §23/§36
 * 职责：把现有「硬编码 / 检索」知识结果（DesignKnowledgeResult）映射为统一契约
 *       KnowledgeNode，作为 Legacy → Knowledge Service 的 Adapter 转换层。
 *
 * 边界：
 * - 纯映射，无 IO，可被 smoke 直接测试。
 * - 不改变原结果内容，只做契约归一化；现有工具仍走原路径，行为不变。
 */

import type { DesignKnowledgeResult, DesignKnowledgeSourceType } from '../../../../shared/design-knowledge-search';
import type { KnowledgeNode, KnowledgeKind, KnowledgeStatus } from '../../../../shared/design-intelligence/knowledge.types';
import type { EvidenceRef } from '../../../../shared/design-intelligence/evidence.types';

/** 把现有 sourceType 归一到 KnowledgeKind（未知来源降级为 method，不阻断）。 */
export function mapSourceTypeToKind(sourceType: DesignKnowledgeSourceType): KnowledgeKind {
    switch (sourceType) {
        case 'local_recipe':
        case 'design_crawler':
        case 'web_page':
        case 'mimo_web_search':
        case 'local_case':
            return 'method';
        case 'manual_rule':
            return 'rule';
        case 'eagle_library':
            return 'case';
        default:
            return 'method';
    }
}

/**
 * 现有检索结果没有统一状态字段，必须按来源保守映射：
 * - 内置规则/配方由代码版本治理，可视为 validated；
 * - 人工复核后的 local_case 已经过现有 Memory Gate，可视为 validated；
 * - Web / crawler / Eagle 只是外部证据或候选，不能因「被搜到」冒充正式知识。
 */
function mapStatus(result: DesignKnowledgeResult): KnowledgeStatus {
    if (result.sourceType === 'local_recipe' || result.sourceType === 'manual_rule') {
        return 'validated';
    }
    if (result.sourceType === 'local_case') {
        return result.governance?.lifecycleStatus === 'active' ? 'validated' : 'candidate';
    }
    return 'observation';
}

function mapProviderType(result: DesignKnowledgeResult): KnowledgeNode['provider']['type'] {
    if (result.sourceType === 'local_recipe' || result.sourceType === 'manual_rule') {
        return 'builtin';
    }
    return 'runtime';
}

/** 现有结果摘要即证据定位；映射为一条 provider 定位的证据引用。 */
function buildProviderLocator(result: DesignKnowledgeResult): string {
    return result.sourceUrl || `${result.sourceType}:${result.id}`;
}

/**
 * 把单条 DesignKnowledgeResult 映射为 KnowledgeNode。
 * sourceRefs 保留来源可追溯；freshness 依来源类型给定默认模式。
 */
export function mapKnowledgeResultToNode(result: DesignKnowledgeResult): KnowledgeNode {
    const kind = mapSourceTypeToKind(result.sourceType);
    const isVolatile = result.sourceType === 'design_crawler'
        || result.sourceType === 'web_page'
        || result.sourceType === 'mimo_web_search';

    const evidence: EvidenceRef = {
        id: `${result.sourceType}:${result.id}`,
        provider: result.sourceType === 'eagle_library' ? 'eagle'
            : (result.sourceType === 'web_page' || result.sourceType === 'design_crawler' || result.sourceType === 'mimo_web_search') ? 'web'
                : 'local_file',
        locator: buildProviderLocator(result),
        title: result.title,
        role: 'source'
    };

    return {
        id: result.id,
        kind,
        title: result.title,
        status: mapStatus(result),
        confidence: 0.5,
        applicableTaskTypes: [],
        domains: [],
        tags: [...result.tags],
        sourceRefs: [evidence],
        relatedIds: [],
        scope: result.summary,
        boundary: undefined,
        freshness: {
            mode: isVolatile ? 'volatile' : 'stable',
            lastVerifiedAt: result.updatedAt
        },
        provider: {
            type: mapProviderType(result),
            locator: result.sourceUrl || result.id
        },
        version: 1,
        contentHash: `${result.id}:${result.summary}`
    };
}

/** 把一批 DesignKnowledgeResult 映射为 KnowledgeNode[]。 */
export function mapKnowledgeResultsToNodes(results: DesignKnowledgeResult[]): KnowledgeNode[] {
    return results.map(mapKnowledgeResultToNode);
}
