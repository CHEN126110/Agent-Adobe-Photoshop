/**
 * Design Intelligence · KnowledgeNode 契约（Phase 0）
 *
 * 路线图依据：docs/design-intelligence-knowledge-system-roadmap-draft.md §5.1
 * 职责：统一描述一条「可引用的设计判断」（原则/方法/规则/案例/品牌…），
 *       而非单纯的信息堆积。所有知识必须可回答 What/Why/Scope/Boundary/Evidence/Confidence/Freshness。
 *
 * 边界（与项目架构原则一致）：
 * - KnowledgeNode 是可跨项目复用的「已验证/候选判断」，不是项目瞬时事实；
 *   项目事实归 Design Project State，这里不承接。
 * - 本文件是纯契约（类型 + 常量），无 IO、无环境依赖，可被 smoke 直接测试。
 * - Agent 只能提出 candidate，无权绕过 Gate 把 candidate 升为 validated/core。
 */

/**
 * 知识生命周期状态。
 * Agent 可产生 observation/candidate，但升级 validated/core 必须经过明确 Gate。
 */
export type KnowledgeStatus =
    | 'observation'
    | 'candidate'
    | 'validated'
    | 'core'
    | 'deprecated';

/** 知识种类：区分「方法论/规则/案例/失败模式/品牌…」以便按任务类型定向检索。 */
export type KnowledgeKind =
    | 'principle'
    | 'method'
    | 'rule'
    | 'case'
    | 'failure_mode'
    | 'brand'
    | 'product'
    | 'evaluation'
    | 'research'
    | 'learning';

/** 知识来源 Provider 类型：Obsidian 人写 / 内置硬编码 / 运行时学习。 */
export type KnowledgeProviderType = 'obsidian' | 'builtin' | 'runtime';

/** 知识新鲜度模式：稳定 / 中 / 易变，决定 reviewAfter 的默认间隔策略。 */
export type KnowledgeFreshnessMode = 'stable' | 'medium' | 'volatile';

/** 证据引用（由 evidence.types.ts 定义），此处仅作类型引用避免循环依赖。 */
import type { EvidenceRef } from './evidence.types';

export interface KnowledgeNode {
    /** 稳定资源 ID（跨 provider 唯一，如 dk_xxx） */
    id: string;
    kind: KnowledgeKind;
    title: string;

    status: KnowledgeStatus;
    /** 0~1 置信度 */
    confidence?: number;

    /** 适用的任务类型，如 main_image / detail_page / sku（品类属于参数，不属于工具身份） */
    applicableTaskTypes: string[];
    domains: string[];
    tags: string[];

    sourceRefs: EvidenceRef[];
    relatedIds: string[];

    /** 什么场景适用 */
    scope?: string;
    /** 什么场景不适用 */
    boundary?: string;

    freshness: {
        mode: KnowledgeFreshnessMode;
        /** ISO 时间；stable 且从未验证时可省略 */
        lastVerifiedAt?: string;
        /** 建议复审时间 */
        reviewAfter?: string;
    };

    provider: {
        type: KnowledgeProviderType;
        /** provider 内的定位符，如 Obsidian 文件路径 / builtin 模块 key / runtime 记录 id */
        locator: string;
    };

    version: number;
    /** 内容哈希，用于写回前的冲突检测 */
    contentHash: string;
}

/** 允许显式写入（升级/合并/废弃）的状态集合，用于 Gate 判定。 */
export const KNOWLEDGE_STATUS_WRITABLE: ReadonlyArray<KnowledgeStatus> = [
    'validated',
    'core',
    'deprecated'
];

/** 判断一条知识当前是否处于「可被 Agent 作为正式依据引用」的状态。 */
export function isKnowledgeUsable(node: Pick<KnowledgeNode, 'status'>): boolean {
    return node.status === 'validated' || node.status === 'core';
}
