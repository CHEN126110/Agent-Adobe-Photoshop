import type { AgentToolExecutionPreflight } from '../../../shared/agent-tool-execution-preflight';
import type { ToolCall } from './types';

/**
 * 把 Harness 已确认的活动文档身份绑定到画布快照。
 *
 * 这里只增加只读断言，不选择或切换 Photoshop 文档。模型显式提供的
 * expectedDocumentId / documentId 原样交给 UXP，由最终执行边界校验或拒绝。
 */
export function bindCanvasSnapshotExpectedDocumentId(
    call: ToolCall,
    executionArguments: Record<string, any>,
    preflight?: AgentToolExecutionPreflight
): Record<string, any> {
    if (call.name !== 'getCanvasSnapshot'
        || Object.prototype.hasOwnProperty.call(executionArguments, 'expectedDocumentId')
        || Object.prototype.hasOwnProperty.call(executionArguments, 'documentId')) {
        return executionArguments;
    }
    const targetGuard = preflight?.preconditions.targetGuard;
    if (preflight?.status !== 'ready' || preflight.ready !== true || !targetGuard) {
        return executionArguments;
    }
    return { ...executionArguments, expectedDocumentId: targetGuard.expectedDocumentId };
}
