/**
 * 裸确认（继续/ack/公开计划确认）与 Run Record 续接身份的裁决（GATE-SIMPLIFY-007）。
 *
 * 背景：预算熔断/无进展停机后，用户最自然的「继续」曾命中轻量意图降级——
 * confirmed_tool_required 被降为 candidate_only，续跑失去写权限（真机 #228/#229
 * 零写入）。Run Record 续接机制（agent-run-resume）本身已能在同一会话分支找到
 * 未完成档案并注入续接上下文，缺的只是「有续接身份时别再降级」这一步裁决。
 *
 * 安全边界：写权限保留只发生在「同会话分支 + 未完成 + 未过期」档案存在时；
 * 新会话、已完成、跨分支、无档案一律维持降级（不恢复历史写权限）。
 * 所有执行点约束（读后写/预检/事务 runner）不变。
 */

export interface BareContinuationResumeDecisionInput {
    /** 输入是否为裸确认形态（ack/continuation 或公开计划确认）。 */
    unboundAcknowledgement: boolean;
    /** 当前意图签发的执行授权。 */
    executionAuthorization?: string;
    /** 同会话分支是否存在可续接的未完成运行档案（由调用方经 Run Record 查询得到）。 */
    resumableRecordAvailable: boolean;
}

export interface BareContinuationResumeDecision {
    /** true 时按旧契约降级为 candidate_only（不恢复历史写权限）。 */
    demote: boolean;
    reason: string;
    matchedSignal?: string;
}

export function resolveBareContinuationResumeDecision(
    input: BareContinuationResumeDecisionInput
): BareContinuationResumeDecision {
    if (!input.unboundAcknowledgement) {
        return {
            demote: false,
            reason: '当前消息不是裸确认形态，不进入降级裁决。'
        };
    }
    if (input.executionAuthorization !== 'confirmed_tool_required') {
        return {
            demote: false,
            reason: '当前执行授权本就不是确认级写授权，无需裁决。'
        };
    }
    if (input.resumableRecordAvailable) {
        return {
            demote: false,
            reason: '同会话分支存在可续接的未完成运行档案；裸继续是明确的续做意图，保留写权限并接入 Run Record 续接（执行点约束不变）。',
            matchedSignal: 'bare_continuation_resume_identity'
        };
    }
    return {
        demote: true,
        reason: '当前消息只是未绑定任务身份的确认、继续或公开计划确认；允许 Agent 理解上下文和只读观察，但不恢复历史写权限。'
    };
}
