/**
 * Design Intelligence · TaskContextBuilder 只读 V1（Phase 1 · DI-008）
 *
 * 路线图依据：docs/design-intelligence-knowledge-system-roadmap-draft.md
 *   §10 Task Context Snapshot / §20.2 v3 集成 / DI-008 Context Builder Read-only V1
 *
 * 职责：在设计任务开始时，把「本次任务真正会用到的知识 / 视觉参考 / 项目状态 / 用户固定内容」
 *       聚合为一份可审计的 TaskContextSnapshot，并压缩成一段可注入 autonomous loop 的
 *       文本摘要（taskContextSummary）。
 *
 * 边界：
 * - 只读聚合，不写知识、不沉淀记忆、不触碰 Photoshop。
 * - 品类（main_image/detail_page/sku）只是检索参数，不产生品类专属分支。
 * - 项目瞬时事实由 Design Project State 负责；本 Builder 只做引用指针（projectStateRefs），
 *   不重复搬运事实，避免与 engine 的 project 摘要重复。
 */

import type {
    TaskContextSnapshot,
    ContextItem
} from '../../../shared/design-intelligence/task-context.types';
import type { KnowledgeNode } from '../../../shared/design-intelligence/knowledge.types';
import type { KnowledgeService } from './knowledge-service';
import type { AssetService, VisualAssetRef } from './asset-service';

/** 构造 TaskContextBuilder 的参数。 */
export interface TaskContextBuilderOptions {
    knowledge: KnowledgeService;
    assets: AssetService;
    /** 当前知识索引版本；用于 snapshot 失效判断 */
    knowledgeIndexVersion?: string;
}

/** Builder 的输入：一次设计任务启动时的最小上下文。 */
export interface TaskContextBuildInput {
    taskId: string;
    userInput: string;
    taskType?: string;
    productCategory?: string;
    /** 用户固定的参考 id（如选定的 Eagle / 方法论），Agent 不得自动移除 */
    pinnedReferenceIds?: string[];
    /** 项目路径，用于 projectStateRefs 引用 */
    projectPath?: string;
    /** 需要的知识条数（默认 6） */
    knowledgeLimit?: number;
    /** 需要的视觉参考条数（默认 4） */
    visualLimit?: number;
    /** 是否自动检索知识。默认 true；显式 false 时只编译用户固定/项目引用。 */
    retrieveKnowledge?: boolean;
    /**
     * 是否在任务启动前自动检索 Eagle 候选。默认 false：视觉参考不是所有任务的前置，
     * 普通任务由 Agent 在确有未解决设计问题时调用 searchEagleReferences。
     */
    retrieveVisualReferences?: boolean;
}

/** Builder 的产物：快照 + 可注入摘要。 */
export interface TaskContextBuildResult {
    snapshot: TaskContextSnapshot;
    summary: string;
    warnings: string[];
}

/**
 * 把一条知识 / 视觉参考转成 ContextItem。
 */
function toContextItem(input: {
    resourceId: string;
    resourceType: string;
    title?: string;
    excerpt?: string;
    sourceLabel?: string;
    lifecycle?: ContextItem['lifecycle'];
    reason: string;
    priority: 'critical' | 'high' | 'normal' | 'low';
    pinned: boolean;
}): ContextItem {
    return {
        resourceId: input.resourceId,
        resourceType: input.resourceType,
        ...(input.title ? { title: compactText(input.title, 180) } : {}),
        ...(input.excerpt ? { excerpt: compactText(input.excerpt, 720) } : {}),
        ...(input.sourceLabel ? { sourceLabel: compactText(input.sourceLabel, 80) } : {}),
        ...(input.lifecycle ? { lifecycle: input.lifecycle } : {}),
        reason: input.reason,
        priority: input.priority,
        selectedBy: input.pinned ? 'user' : 'agent',
        pinned: input.pinned
    };
}

/** 从知识节点构造 ContextItem（agent 检索）。 */
function knowledgeToContextItem(node: KnowledgeNode, reason: string): ContextItem {
    return toContextItem({
        resourceId: node.id,
        resourceType: 'knowledge',
        title: node.title,
        excerpt: node.scope,
        sourceLabel: knowledgeSourceLabel(node),
        lifecycle: node.status === 'validated' || node.status === 'core' ? 'verified' : 'candidate',
        reason,
        priority: 'normal',
        pinned: false
    });
}

/** 从视觉参考构造 ContextItem（agent 检索）。 */
function assetToContextItem(asset: VisualAssetRef): ContextItem {
    return toContextItem({
        resourceId: asset.id,
        resourceType: 'visual_reference',
        title: asset.title || asset.id,
        excerpt: asset.analysis,
        sourceLabel: asset.provider === 'eagle' ? 'Eagle 素材库' : '本地素材',
        lifecycle: 'candidate',
        reason: '与当前任务主题相关的视觉候选；只有完成真实看图后才能形成视觉判断。',
        priority: 'normal',
        pinned: false
    });
}

/** 把用户固定的参考 id 构造为 pinned ContextItem（不查库，仅作引用）。 */
function pinnedToContextItem(refId: string): ContextItem {
    return toContextItem({
        resourceId: refId,
        resourceType: 'reference',
        title: refId,
        sourceLabel: '用户固定',
        lifecycle: 'pinned',
        reason: '用户固定参考',
        priority: 'high',
        pinned: true
    });
}

/**
 * 生成可注入 autonomous loop 的压缩文本摘要。
 * 明确区分「用户固定 / 检索知识 / 视觉参考」，让 Agent 知道哪些不能自动移除。
 */
export function compileTaskContextSummary(snapshot: TaskContextSnapshot): string {
    const lines: string[] = [];

    const pinned = snapshot.pinnedItems.map((item) => item.title || item.resourceId);
    if (pinned.length > 0) {
        lines.push(`用户固定参考：${pinned.join('、')}（Agent 不得自动移除）`);
    }

    if (snapshot.retrievedKnowledge.length > 0) {
        lines.push('任务相关方法/规则：');
        for (const item of snapshot.retrievedKnowledge.slice(0, 6)) {
            lines.push(formatSummaryLine(item));
        }
    }

    if (snapshot.visualReferences.length > 0) {
        lines.push('任务相关视觉参考：');
        for (const item of snapshot.visualReferences.slice(0, 4)) {
            lines.push(formatSummaryLine(item));
        }
    }

    if (snapshot.projectStateRefs.length > 0) {
        lines.push('关联项目状态：见 Design Project State（此处仅引用，不搬运事实）。');
    }

    return lines.length > 0 ? lines.join('\n') : '（本次任务未注入额外知识上下文）';
}

/**
 * TaskContextBuilder · 只读 V1。
 * build() 并行检索知识 + 视觉参考，聚合为快照并产出可注入摘要。
 */
export class TaskContextBuilder {
    readonly kind = 'task-context-builder' as const;
    private readonly knowledge: KnowledgeService;
    private readonly assets: AssetService;
    private readonly indexVersion: string;

    constructor(options: TaskContextBuilderOptions) {
        this.knowledge = options.knowledge;
        this.assets = options.assets;
        this.indexVersion = options.knowledgeIndexVersion || 'phase1-v1';
    }

    async build(input: TaskContextBuildInput): Promise<TaskContextBuildResult> {
        const warnings: string[] = [];

        const pinnedItems = (input.pinnedReferenceIds || []).map(pinnedToContextItem);

        // 知识可按任务启动自动检索；视觉参考必须由调用方显式声明需要，避免把 Eagle
        // 变成所有设计任务的固定前置。两路都只读，不进入模型 Tool 并发批次。
        const retrieveKnowledge = input.retrieveKnowledge !== false;
        const retrieveVisualReferences = input.retrieveVisualReferences === true;
        const [knowledgeResp, assetResp] = await Promise.all([
            retrieveKnowledge ? this.knowledge.search({
                query: input.userInput,
                limit: input.knowledgeLimit || 6,
                filter: {
                    taskType: input.taskType,
                    productCategory: input.productCategory
                }
            }) : Promise.resolve({ query: input.userInput, hits: [], warnings: [], indexVersion: this.indexVersion }),
            retrieveVisualReferences ? this.assets.search({
                query: input.userInput,
                limit: input.visualLimit || 4,
                taskType: input.taskType
            }) : Promise.resolve({ query: input.userInput, results: [], warnings: [] })
        ]);

        warnings.push(...knowledgeResp.warnings, ...assetResp.warnings);

        const retrievedKnowledge = knowledgeResp.hits.map((hit) => knowledgeToContextItem(hit.node, hit.reason));
        const visualReferences = assetResp.results.map(assetToContextItem);

        const projectStateRefs: ContextItem[] = input.projectPath
            ? [toContextItem({
                resourceId: input.projectPath,
                resourceType: 'project_state',
                title: '当前设计项目',
                sourceLabel: 'Design Project State',
                lifecycle: 'project_state',
                reason: '当前设计项目',
                priority: 'normal',
                pinned: false
            })]
            : [];

        const snapshot: TaskContextSnapshot = {
            id: `tc-${input.taskId}`,
            taskId: input.taskId,
            hardConstraints: [],
            pinnedItems,
            retrievedKnowledge,
            visualReferences,
            projectStateRefs,
            createdAt: new Date().toISOString(),
            knowledgeIndexVersion: this.indexVersion
        };

        return {
            snapshot,
            summary: compileTaskContextSummary(snapshot),
            warnings: Array.from(new Set(warnings.filter(Boolean)))
        };
    }
}

function knowledgeSourceLabel(node: KnowledgeNode): string {
    switch (node.provider.type) {
        case 'obsidian':
            return 'Obsidian 知识源';
        case 'runtime':
            return node.sourceRefs.some((ref) => ref.provider === 'eagle') ? 'Eagle 素材库' : '运行时来源';
        case 'builtin':
        default:
            return '内置方法论';
    }
}

function formatSummaryLine(item: ContextItem): string {
    const title = item.title || item.resourceId;
    const source = item.sourceLabel ? ` · ${item.sourceLabel}` : '';
    const lifecycle = item.lifecycle === 'verified' ? '已验证' : item.lifecycle === 'candidate' ? '候选' : '';
    const lifecycleText = lifecycle ? ` · ${lifecycle}` : '';
    const excerpt = item.excerpt ? `：${item.excerpt}` : '';
    const reason = item.reason && item.reason !== title ? `（加入原因：${item.reason}）` : '';
    return `- ${title}${source}${lifecycleText}${excerpt}${reason}`;
}

function compactText(value: unknown, limit: number): string {
    return String(value || '')
        .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, '[已移除图片数据]')
        .replace(/\b[A-Za-z]:[\\/][^\s"'，,；;]+/g, '[已隐藏本地路径]')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, limit);
}
