export interface ExplicitGeneratedPublicPlanApprovalRecord {
    sourceMessageId?: string;
    requestId?: string;
    sourceRequestId?: string;
    sourceRequestStatus?: string;
}

/**
 * generated public-plan 的批准只能来自一条可追溯的待确认计划和显式 UI 事件。
 * 普通文本、意图分类、Photoshop 连接状态或交付措辞都不属于批准记录。
 */
export function hasExplicitGeneratedPublicPlanApproval(
    approval: ExplicitGeneratedPublicPlanApprovalRecord
): boolean {
    const requestId = String(approval.requestId || '').trim();
    const sourceRequestId = String(approval.sourceRequestId || '').trim();
    return Boolean(String(approval.sourceMessageId || '').trim())
        && Boolean(requestId)
        && requestId === sourceRequestId
        && approval.sourceRequestStatus === 'blocked_pending_user_confirmation';
}
