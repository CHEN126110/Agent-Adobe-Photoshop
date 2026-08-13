/**
 * 团队共享工作区（黑板模式）
 *
 * 同一次自主 Agent 运行（或一次团队流水线）内，队友的产出自动沉淀在这里，
 * 后续队友的系统提示会注入前序成果摘要——队友之间不再依赖主模型手工转述。
 */

import type {
    DesignTeammateRole,
    DesignTeamMessageType,
    DesignTeamWorkspaceEntry
} from '../../../shared/types/design-team.types';

/** 注入系统提示的摘要总长上限（避免撑爆子 Agent 上下文） */
const MAX_DIGEST_CHARS = 6000;
/** 单条产出在摘要中的长度上限 */
const MAX_ENTRY_CHARS = 2000;

/** 仅把可复用的专业产出注入后续队友；运行状态和模型路由仅供诊断。 */
const SHARED_PROFESSIONAL_OUTPUT_TYPES = new Set<DesignTeamMessageType>([
    'scene_summary',
    'market_research',
    'copy_strategy',
    'design_plan',
    'execution_report',
    'review_report',
    'revision_request'
]);

const STAGE_LABELS: Record<DesignTeamMessageType, string> = {
    scene_summary: '场景分析',
    market_research: '市场洞察',
    copy_strategy: '文案策略',
    design_plan: '设计计划',
    execution_report: '执行报告',
    review_report: '评审报告',
    revision_request: '修订要求',
    task_context: '任务上下文',
    task_status: '任务状态',
    model_dispatch_trace: '模型调度'
};

export class DesignTeamWorkspace {
    private readonly entries: DesignTeamWorkspaceEntry[] = [];

    record(entry: Omit<DesignTeamWorkspaceEntry, 'timestamp'>): void {
        this.entries.push({
            ...entry,
            content: String(entry.content || '').trim(),
            timestamp: new Date().toISOString()
        });
    }

    list(): DesignTeamWorkspaceEntry[] {
        return [...this.entries];
    }

    /** 最近一条指定类型的产出（如取最新设计计划） */
    latestOfType(outputType: DesignTeamMessageType): DesignTeamWorkspaceEntry | undefined {
        for (let i = this.entries.length - 1; i >= 0; i--) {
            if (this.entries[i].outputType === outputType && this.entries[i].success) {
                return this.entries[i];
            }
        }
        return undefined;
    }

    isEmpty(): boolean {
        return this.entries.length === 0;
    }

    /**
     * 生成注入后续队友系统提示的成果摘要。
     * 优先保留最新条目；超长条目截断并标注。
     */
    buildContextDigest(options?: { excludeRole?: DesignTeammateRole }): string {
        const visible = this.entries.filter((entry) => (
            entry.success
            && Boolean(entry.content)
            && SHARED_PROFESSIONAL_OUTPUT_TYPES.has(entry.outputType)
            && (!options?.excludeRole || entry.role !== options.excludeRole)
        ));
        if (visible.length === 0) return '';

        const retainedNewestFirst: string[] = [];
        let budget = MAX_DIGEST_CHARS;
        let omittedOlderCount = 0;

        for (let index = visible.length - 1; index >= 0; index--) {
            const entry = visible[index];
            let content = entry.content;
            if (content.length > MAX_ENTRY_CHARS) {
                content = `${content.slice(0, MAX_ENTRY_CHARS)}…[已截断，原长 ${entry.content.length} 字符]`;
            }
            const block = `\n### [${STAGE_LABELS[entry.outputType] || entry.outputType}] ${entry.stage}（${entry.role}）\n${content}`;
            if (block.length > budget) {
                omittedOlderCount = index + 1;
                break;
            }
            retainedNewestFirst.push(block);
            budget -= block.length;
        }

        if (retainedNewestFirst.length === 0) return '';

        const lines: string[] = ['## 团队已有成果（按时间先后，优先保留最新）'];
        if (omittedOlderCount > 0) {
            lines.push(`\n（${omittedOlderCount} 条更早的成果因长度限制省略）`);
        }
        lines.push(...retainedNewestFirst.reverse());
        return lines.join('\n');
    }
}
