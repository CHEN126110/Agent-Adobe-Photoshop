/**
 * Design Intelligence · ExternalSignal 契约（Phase 6）
 *
 * 路线图依据：docs/design-intelligence-knowledge-system-roadmap-draft.md
 *   §19 外部世界更新 / Phase 6 External Signals & Brainstorm
 *
 * 职责：描述来自外部世界的一条信号（网页/PDF/视频/论文/社媒/市场数据等）。
 *       External Signal **不直接成为知识**，必须经过
 *       Signal → Evidence → Candidate → Review → Knowledge 的收口链路。
 *
 * 边界：
 * - 本文件只定义信号载体（定位符 + 摘要），不搬运原文大体积内容。
 * - 信号本身无知识权威性；是否升格为证据/候选由上层（命题账本 + Review Gate）决定。
 */

/** 外部信号来源类型。 */
export type ExternalSignalKind =
    | 'web'
    | 'pdf'
    | 'video'
    | 'paper'
    | 'social'
    | 'market'
    | 'official_doc';

export interface ExternalSignal {
    id: string;
    kind: ExternalSignalKind;
    /** 标题 / 一句话主题 */
    title: string;
    /** 定位符（URL / 本地路径 / DOI 等，可空） */
    locator?: string;
    /** 信号摘要（人工或 Agent 生成，非原文全量） */
    summary: string;
    /** 涉及领域/任务，用于后续定向 */
    domains?: string[];
    applicableTaskTypes?: string[];
    /** 捕获时间 */
    capturedAt: string;
}

/** 信号是否已具备进入「命题账本」的资格（需有可读摘要，避免空转）。 */
export function isSignalUsable(signal: Pick<ExternalSignal, 'summary' | 'title'>): boolean {
    return signal.summary.trim().length > 0 && signal.title.trim().length > 0;
}
