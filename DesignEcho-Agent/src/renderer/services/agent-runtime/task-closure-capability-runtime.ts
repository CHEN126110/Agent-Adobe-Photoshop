/**
 * 设计内容形成后的通用交付能力生命周期。
 *
 * 本模块只在现有 Capability Session 内开放已经声明的 delivery schema；它不执行 Tool、
 * 不选择路径或格式，也不授予 Photoshop 写权限。实际调用仍经过 Agent 决策和统一 preflight。
 */

import { classifyAgentToolExecution } from '../../../shared/agent-tool-execution-preflight';
import { deriveAgentUserResultFacts } from './agent-user-result-projection';
import type { AgentConfig, AgentToolCallLogEntry } from './types';

export class TaskClosureCapabilityRuntime {
    private activated = false;

    constructor(private readonly config: Pick<
        AgentConfig,
        'tools' | 'activateTaskClosureCapabilities'
    >) {}

    reset(): void {
        this.activated = false;
    }

    ensureVisible(toolCallLog: readonly AgentToolCallLogEntry[]): string[] {
        if (!this.activated
            && this.config.activateTaskClosureCapabilities
            && deriveAgentUserResultFacts(toolCallLog).hasViewableDesignChange) {
            this.config.activateTaskClosureCapabilities();
            this.activated = true;
        }
        if (!this.activated) return [];
        return this.config.tools
            .filter((tool) => classifyAgentToolExecution(tool.name) === 'save_export')
            .map((tool) => tool.name)
            .filter((name, index, names) => names.indexOf(name) === index)
            .slice(0, 6);
    }
}

export function buildTaskClosureCapabilityDirective(toolNames: readonly string[]): string[] {
    if (toolNames.length === 0) return [];
    return [
        `当前已经可以直接使用的交付动作：${toolNames.join('、')}；不要再搜索或申请交付能力。具体保存哪些文件与路径仍由你依据当前交付义务决定。`
    ];
}
