/**
 * Tool 结果来源账本。
 *
 * 复合 Skill 可以返回任意 JSON 形状，因此嵌套 `toolResults[]` 本身不能证明对应原子
 * Tool 真正执行过。只有统一执行分发器返回的同一对象实例会被登记；视觉回执等
 * Runtime 验收只能消费这份对象身份来源，序列化、克隆或手造对象均失败关闭。
 */

export interface ExecutedToolResultProvenance {
    toolName: string;
}

const EXECUTED_TOOL_RESULT_PROVENANCE = new WeakMap<object, ExecutedToolResultProvenance>();

export function markExecutedToolResultProvenance(
    toolName: string,
    result: unknown
): void {
    if (!result || typeof result !== 'object') return;
    EXECUTED_TOOL_RESULT_PROVENANCE.set(result, {
        toolName: String(toolName || '').trim()
    });
}

export function readExecutedToolResultProvenance(
    result: unknown
): ExecutedToolResultProvenance | undefined {
    if (!result || typeof result !== 'object') return undefined;
    const provenance = EXECUTED_TOOL_RESULT_PROVENANCE.get(result);
    if (!provenance?.toolName) return undefined;
    return provenance;
}
