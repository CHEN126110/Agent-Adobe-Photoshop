/**
 * Photoshop 短时忙碌（瞬态）失败判定：纯逻辑，供通用工具执行层与车间执行器共用。
 *
 * 纪律：只有明确的短时忙碌才允许自动重试；以下情况必须交回 Agent 观察，绝不自动重试——
 * - 原生弹窗 / 模态状态：重试不会解除阻塞，且可能掩盖需要用户处理的界面状态；
 * - 写入状态未知：重放写入有重复副作用风险，由未知写状态 reconciliation 机制负责。
 */

function collectFailureText(result: unknown): string {
    if (!result || typeof result !== 'object') {
        return '';
    }
    const record = result as Record<string, unknown>;
    const parts: unknown[] = [record.error, record.message];
    if (Array.isArray(record.errors)) {
        for (const item of record.errors) {
            if (item && typeof item === 'object') {
                parts.push((item as Record<string, unknown>).error);
            }
        }
    }
    return parts.filter((item): item is string => typeof item === 'string' && item.length > 0).join('；');
}

/** 明确不可重试的失败：原生弹窗、模态状态、写入状态未知。 */
export function isNonRetryablePhotoshopFailure(result: unknown): boolean {
    const text = collectFailureText(result);
    return /photoshop_native_modal_suspected|原生弹窗|模态状态|host is in a modal state|写入状态未知/i.test(text);
}

/** 可安全重试的 Photoshop 短时忙碌失败（已排除弹窗 / 模态 / 未知写状态）。 */
export function isTransientPhotoshopBusyFailure(result: unknown): boolean {
    if (isNonRetryablePhotoshopFailure(result)) {
        return false;
    }
    const text = collectFailureText(result);
    return /Photoshop 可能正忙|仍在处理上一步|文档状态暂时无法确认|busy/i.test(text);
}
