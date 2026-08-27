import {
    findLatestObservedPhotoshopMutationIndex
} from '../../../shared/agent-operation-document-timeline';
import {
    isAgentDocumentContextBarrier
} from '../../../shared/agent-tool-execution-preflight';
import {
    readPhotoshopHistoryStateRef,
    type PhotoshopHistoryStateRef
} from '../../../shared/photoshop-history-state-ref';
import type { AgentToolCallLogEntry } from './types';

/**
 * 返回最后一次内容 mutation 之后，最新仍有效的质量闭合版本。
 *
 * 后续无副作用的预算拒绝、取消或读取失败只保留诊断，不能撤销同 revision 的成功
 * 证据；后续真实 mutation 或成功的文档上下文切换则使旧闭合证据失效。
 */
export function resolveLatestClosedDesignQualityHistoryStateRef(
    toolCallLog: readonly AgentToolCallLogEntry[]
): PhotoshopHistoryStateRef | undefined {
    const latestMutationIndex = findLatestObservedPhotoshopMutationIndex(toolCallLog);
    for (let index = toolCallLog.length - 1; index > latestMutationIndex; index -= 1) {
        const entry = toolCallLog[index];
        if (entry.result?.success !== false
            && isAgentDocumentContextBarrier(entry.name, entry.arguments)) {
            return undefined;
        }
        if (entry.origin !== 'harness_quality_verification'
            || (entry.qualityVerificationPhase !== 'post_judge'
                && entry.qualityVerificationPhase !== 'final_summary')
            || !entry.result
            || entry.result.success === false
            || entry.result.policyGate === true
            || entry.result.cancelled === true) {
            continue;
        }
        const historyStateRef = readPhotoshopHistoryStateRef(entry.result);
        if (historyStateRef) return historyStateRef;
    }
    return undefined;
}
