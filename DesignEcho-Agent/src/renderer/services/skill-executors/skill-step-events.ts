import type { ExecutionCallbacks } from '../unified-agent.service';
import type { AgentStepEvent } from '../agent-runtime/types';

export function emitSkillStep(
    callbacks: ExecutionCallbacks | undefined,
    step: AgentStepEvent
): void {
    callbacks?.onStep?.(step);
}

export async function executeObservedSkillTool<TParams extends Record<string, any>, TResult>(
    callbacks: ExecutionCallbacks | undefined,
    toolName: string,
    params: TParams,
    execute: (toolName: string, params: TParams) => Promise<TResult>,
    detail?: string
): Promise<TResult> {
    const toolCallId = `skill-tool-${toolName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    emitSkillStep(callbacks, {
        kind: 'tool_started',
        title: `调用 Photoshop 工具：${toolName}`,
        detail,
        status: 'running',
        toolName,
        toolCallId
    });

    try {
        const result = await execute(toolName, params);
        const success = (result as any)?.success !== false;
        emitSkillStep(callbacks, {
            kind: 'tool_completed',
            title: success ? `Photoshop 工具完成：${toolName}` : `Photoshop 工具失败：${toolName}`,
            detail: success ? undefined : String((result as any)?.error || '工具返回失败状态'),
            status: success ? 'success' : 'error',
            toolName,
            toolCallId
        });
        return result;
    } catch (error) {
        emitSkillStep(callbacks, {
            kind: 'tool_completed',
            title: `Photoshop 工具异常：${toolName}`,
            detail: error instanceof Error ? error.message : String(error),
            status: 'error',
            toolName,
            toolCallId
        });
        throw error;
    }
}
