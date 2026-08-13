/**
 * Design Intelligence · TaskContextSnapshot 契约（Phase 0）
 *
 * 路线图依据：docs/design-intelligence-knowledge-system-roadmap-draft.md §10
 * 职责：每次设计任务生成可审计的 Context Snapshot，明确「本次任务真正使用了哪些
 *       规则、案例、品牌约束、项目状态、用户固定内容」，从而回答：
 *       - 为什么检索到这条规则？
 *       - 为什么选这几张 Eagle 图？
 *       - 哪些内容是用户固定的？
 *       - 哪一条知识影响了最终设计？
 *
 * 三类 Context：
 * - hardConstraints：代码/契约强制（袜型不变、品牌 Logo 不改、SKU 数量满足规格）。
 * - pinnedItems：用户固定（选中的方法论、固定的 Eagle 参考、品牌规范），Agent 不得自动移除。
 * - retrievedKnowledge / visualReferences / projectStateRefs：Agent 本轮自动检索，允许用户移除。
 *
 * 边界：TaskContextSnapshot 生命周期只覆盖当前任务/当前阶段（Working Memory），
 *       不是长期知识存储。纯契约，无 IO。
 */

/** 上下文条目的优先级。 */
export type ContextPriority = 'critical' | 'high' | 'normal' | 'low';

/** 上下文条目的选择方：用户（固定）/ Agent（检索）/ 系统（注入）。 */
export type ContextSelector = 'user' | 'agent' | 'system';

/**
 * 面向用户与 Agent 的生命周期语义。它不是知识状态机的第二份状态，
 * 只把不同资源投影成「已验证 / 候选参考 / 用户固定 / 项目状态」四类可理解标签。
 */
export type ContextLifecycle = 'verified' | 'candidate' | 'pinned' | 'project_state';

export interface ContextItem {
    resourceId: string;
    resourceType: string;

    /** 用户可读标题；不要让 UI 只能展示内部 resourceId。 */
    title?: string;

    /**
     * 真正进入本次上下文的有界内容摘要。只放决策所需片段，禁止原文全文、base64 与本地路径。
     */
    excerpt?: string;

    /** 来源的人话标签，例如「内置方法论」「长期知识」「Eagle 素材库」。 */
    sourceLabel?: string;

    /** 面向展示的生命周期投影，不承担正式知识状态迁移。 */
    lifecycle?: ContextLifecycle;

    /** 为什么这条被选入本任务上下文 */
    reason: string;

    priority: ContextPriority;

    selectedBy: ContextSelector;

    /** true = 用户固定，Agent 不得自动移除 */
    pinned: boolean;
}

export interface TaskContextSnapshot {
    id: string;
    taskId: string;

    hardConstraints: ContextItem[];
    pinnedItems: ContextItem[];
    retrievedKnowledge: ContextItem[];
    visualReferences: ContextItem[];
    projectStateRefs: ContextItem[];

    createdAt: string;
    /** 检索时依赖的索引版本，用于失效判断 */
    knowledgeIndexVersion: string;
}

/** 判断一条上下文条目是否属于「硬约束」（用户/代码固定，不可由 Agent 移除）。 */
export function isHardOrPinnedContext(item: Pick<ContextItem, 'pinned' | 'selectedBy'>): boolean {
    return item.selectedBy === 'user' || item.pinned === true;
}
