/**
 * Design Intelligence · EvidenceRef 契约（Phase 0）
 *
 * 路线图依据：docs/design-intelligence-knowledge-system-roadmap-draft.md §5.2
 * 职责：描述一条知识背后的「证据来源」——Eagle 视觉资产、网页、本地文件、项目、
 *       用户反馈、Agent 执行、指标等。保证知识可追溯（Provenance）。
 *
 * 边界：
 * - EvidenceRef 只保存定位符（locator / asset_id 等），不搬运图片原文或大体积内容；
 *   图片原文件仍由素材库（Eagle / 本地资产）负责。
 * - 纯契约，无 IO。
 */

/** 证据来源 Provider 类型。 */
export type EvidenceProvider =
    | 'eagle'
    | 'web'
    | 'local_file'
    | 'project'
    | 'user_feedback'
    | 'agent_execution'
    | 'metric';

/** 证据在一条知识中扮演的角色：正例/反例/支撑/来源/观测… */
export type EvidenceRole =
    | 'source'
    | 'support'
    | 'counterexample'
    | 'positive_example'
    | 'negative_example'
    | 'observation';

export interface EvidenceRef {
    id: string;
    provider: EvidenceProvider;
    /** provider 内的定位符，如 Eagle asset_id / URL / 文件路径 / 项目引用 */
    locator: string;
    title?: string;

    /** 证据捕获时间（ISO） */
    capturedAt?: string;
    /** 内容哈希，用于追踪证据是否已变更 */
    contentHash?: string;

    role: EvidenceRole;
}
