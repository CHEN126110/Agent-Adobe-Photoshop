/**
 * Design Project State 纯逻辑层（合并、校验、摘要）
 *
 * 主进程 IPC 与渲染侧工具共用；无 IO、无环境依赖，可被 smoke 直接测试。
 */

import {
    DESIGN_PROJECT_STATE_SCHEMA_VERSION,
    type DesignProjectState,
    type DesignProjectStatePatch
} from './types/design-project-state.types';
import {
    applyDesignProjectFactOperations,
    buildDesignProjectFactProvenanceSummary,
    canDesignProjectFactSupportEvaluation,
    listDesignProjectFactRecords,
    normalizeDesignProjectFactRecords
} from './design-project-fact-provenance';
import {
    applyDesignProjectRuleOperations,
    buildDesignProjectRulePolicy,
    normalizeDesignProjectRuleRecords
} from './design-project-rule-governance';
import { normalizeArtifactRefs } from './agent-runtime-v5/artifact-repository-contract';

/** 摘要注入提示词的总长上限 */
const MAX_SUMMARY_CHARS = 3500;
/** 数组字段保留上限（防状态文件无限膨胀） */
const MAX_LIST_ITEMS = 50;
const MAX_LEARNINGS = 100;
const MAX_VERSIONS = 100;

const DESIGN_PROJECT_STATE_ALLOWED_KEYS = [
    'schemaVersion',
    'projectId',
    'projectName',
    'taskType',
    'platform',
    'canvasSize',
    'brandStyle',
    'targetUser',
    'productFacts',
    'factRecords',
    'ruleRecords',
    'materialAssets',
    'painPoints',
    'competitorNotes',
    'sellingPoints',
    'copywriting',
    'visualDirection',
    'layoutPlan',
    'productionTasks',
    'reviewResult',
    'deliveryFiles',
    'artifactRefs',
    'learnings',
    'versionHistory',
    'updatedAt',
    'updatedBy'
] as const satisfies readonly (keyof DesignProjectState)[];

const DESIGN_PROJECT_STATE_SET_ALLOWED_KEYS = new Set<string>([
    'projectId',
    'projectName',
    'taskType',
    'platform',
    'canvasSize',
    'brandStyle',
    'targetUser',
    'productFacts',
    'materialAssets',
    'painPoints',
    'competitorNotes',
    'sellingPoints',
    'copywriting',
    'visualDirection',
    'layoutPlan',
    'productionTasks',
    'reviewResult',
    'deliveryFiles'
] as const satisfies readonly (keyof DesignProjectState)[]);

export function createEmptyDesignProjectState(): DesignProjectState {
    return { schemaVersion: DESIGN_PROJECT_STATE_SCHEMA_VERSION };
}

/** 读入的原始 JSON 规范化为合法状态（容忍历史/损坏数据，不抛错） */
export function normalizeDesignProjectState(raw: unknown): DesignProjectState {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return createEmptyDesignProjectState();
    }
    const source = raw as Record<string, unknown>;
    const state = createEmptyDesignProjectState();
    const target = state as unknown as Record<string, unknown>;
    for (const key of DESIGN_PROJECT_STATE_ALLOWED_KEYS) {
        if (key === 'schemaVersion' || !Object.prototype.hasOwnProperty.call(source, key)) continue;
        target[key] = source[key];
    }
    for (const key of ['productFacts', 'painPoints', 'competitorNotes', 'sellingPoints', 'deliveryFiles'] as const) {
        const value = state[key];
        if (value !== undefined && !Array.isArray(value)) delete (state as any)[key];
    }
    for (const key of ['materialAssets', 'copywriting', 'productionTasks', 'learnings', 'versionHistory'] as const) {
        const value = state[key];
        if (value !== undefined && !Array.isArray(value)) delete (state as any)[key];
    }
    state.factRecords = normalizeDesignProjectFactRecords(state.factRecords);
    if (state.factRecords.length === 0) delete state.factRecords;
    state.ruleRecords = normalizeDesignProjectRuleRecords(state.ruleRecords);
    if (state.ruleRecords.length === 0) delete state.ruleRecords;
    state.artifactRefs = normalizeArtifactRefs(state.artifactRefs);
    if (state.artifactRefs.length === 0) delete state.artifactRefs;
    return state;
}

function capList<T>(list: T[] | undefined, max: number): T[] | undefined {
    if (!Array.isArray(list)) return undefined;
    return list.length > max ? list.slice(list.length - max) : list;
}

/**
 * 应用增量更新：set 按字段整体替换；learnings / versionHistory 只追加。
 * 返回新对象，不修改入参。
 */
export function applyDesignProjectStatePatch(
    current: DesignProjectState,
    patch: DesignProjectStatePatch
): DesignProjectState {
    const now = new Date().toISOString();
    const next: DesignProjectState = { ...normalizeDesignProjectState(current) };

    if (patch.set && typeof patch.set === 'object') {
        for (const [key, value] of Object.entries(patch.set)) {
            if (value === undefined || value === null) continue;
            // set 采用正向清单；未知字段与 Repository / 追加型 / 元数据字段一律不进入项目记忆。
            if (!DESIGN_PROJECT_STATE_SET_ALLOWED_KEYS.has(key)) continue;
            (next as unknown as Record<string, unknown>)[key] = value;
        }
    }

    if (Array.isArray(patch.upsertFacts) || Array.isArray(patch.reviewFacts)) {
        next.factRecords = applyDesignProjectFactOperations({
            current: next.factRecords,
            upsertFacts: patch.upsertFacts,
            reviewFacts: patch.reviewFacts,
            authority: patch.factWriteAuthority,
            updatedBy: patch.updatedBy,
            now
        });
        if (next.factRecords.length === 0) delete next.factRecords;
    }

    if (Array.isArray(patch.upsertRules) || Array.isArray(patch.reviewRules)) {
        next.ruleRecords = applyDesignProjectRuleOperations({
            current: next.ruleRecords,
            upsertRules: patch.upsertRules,
            reviewRules: patch.reviewRules,
            authority: patch.ruleWriteAuthority,
            updatedBy: patch.updatedBy,
            now
        });
        if (next.ruleRecords.length === 0) delete next.ruleRecords;
    }

    if (patch.appendLearning && String(patch.appendLearning).trim()) {
        next.learnings = capList([
            ...(next.learnings || []),
            {
                note: String(patch.appendLearning).trim(),
                timestamp: now,
                ...(patch.updatedBy ? { source: patch.updatedBy } : {})
            }
        ], MAX_LEARNINGS);
    }

    if (patch.appendVersion && String(patch.appendVersion.reason || '').trim()) {
        const versions = next.versionHistory || [];
        const autoVersion = `V${String(versions.length + 1).padStart(2, '0')}`;
        next.versionHistory = capList([
            ...versions,
            {
                version: String(patch.appendVersion.version || autoVersion),
                reason: String(patch.appendVersion.reason).trim(),
                timestamp: now,
                ...(patch.updatedBy ? { author: patch.updatedBy } : {})
            }
        ], MAX_VERSIONS);
    }

    // 列表字段封顶
    for (const key of ['productFacts', 'painPoints', 'competitorNotes', 'sellingPoints', 'deliveryFiles', 'materialAssets', 'copywriting', 'productionTasks'] as const) {
        if (Array.isArray(next[key])) {
            (next as any)[key] = capList(next[key] as any[], MAX_LIST_ITEMS);
        }
    }

    next.updatedAt = now;
    if (patch.updatedBy) next.updatedBy = String(patch.updatedBy);
    return next;
}

function basenameOf(value: unknown): string {
    const normalized = String(value || '').trim().replace(/\\/g, '/');
    const segments = normalized.split('/').filter(Boolean);
    return segments.length > 0 ? segments[segments.length - 1] : normalized;
}

function summaryLine(label: string, value: string | undefined): string | null {
    const text = String(value || '').trim();
    return text ? `- ${label}：${text}` : null;
}

function summaryList(label: string, list: string[] | undefined, max = 8): string | null {
    if (!Array.isArray(list) || list.length === 0) return null;
    const shown = list.slice(0, max).join('；');
    const suffix = list.length > max ? `（共 ${list.length} 条）` : '';
    return `- ${label}：${shown}${suffix}`;
}

function formatProductionTaskStatus(status: unknown): string {
    switch (status) {
        case 'in_progress': return '进行中';
        case 'done': return '已完成';
        case 'blocked': return '受阻';
        default: return '待做';
    }
}

/**
 * 长任务的模型侧续接提醒。事实类进度（看过哪些素材、图上有什么、用了哪个版面、
 * 文档与图层组、导出文件、版本）由 Harness 在每次运行结束时自动记进项目记忆；
 * 模型只负责记它自己才知道的判断，不为维护状态推迟实际制作。
 *
 * 旧写法「只有即将暂停时才记录」在自然完成的运行里永远不成立——真机 472 次运行 9% 写过记忆。
 */
export function buildTaskStateDisciplineSection(): string {
    return [
        '## 项目记忆怎么用',
        '- 先理解和制作，不要为了记录进度而推迟第一版设计。',
        '- 看过哪些素材、图上有什么、用了哪个版面、文档和导出文件这些事实会在每次运行结束时自动记进项目记忆，不用你重复记录。',
        '- 只有你才知道的判断请随手记一句：为什么选这张图、这个方向为什么成立、用户拍板了什么、下一步打算做什么（updateDesignProjectState 的 visualDirection / productionTasks / appendLearning）。',
        '- 系统提示里的「当前项目摘要」已经是最新记忆；只有摘要里没写全、需要细看某项时才调用 getDesignProjectState。',
        '- 继续任务时先确认当前文档和画面仍是上次保留的内容，然后从未完成处接着做；不要重复已经完成的制作。'
    ].join('\n');
}

/**
 * 生成注入主循环 / 队友系统提示的状态摘要（有界）。
 * 空状态返回空字符串（调用方据此跳过注入）。
 */
export function buildDesignProjectStateSummary(state: DesignProjectState | null | undefined): string {
    if (!state) return '';
    const normalized = normalizeDesignProjectState(state);
    const factRecords = listDesignProjectFactRecords(normalized);
    const factSummary = buildDesignProjectFactProvenanceSummary(normalized);
    const trustedFacts = factRecords.filter(canDesignProjectFactSupportEvaluation);
    // 图片观察得来的未确认线索单独列出：有来源（哪张图）但没经用户核对，是「待核」不是「已知」。
    const assetObservedFacts = factRecords.filter((fact) => (
        fact.status === 'active'
        && fact.confirmation === 'unverified'
        && fact.sources.some((source) => source.kind === 'project_asset_observation')
    ));
    const rulePolicy = buildDesignProjectRulePolicy(normalized, {
        taskType: normalized.taskType,
        channel: normalized.platform
    });

    const lines: Array<string | null> = [
        summaryLine('项目', [normalized.projectName, normalized.taskType, normalized.platform].filter(Boolean).join(' / ')),
        normalized.canvasSize && (normalized.canvasSize.width || normalized.canvasSize.preset)
            ? `- 画布：${normalized.canvasSize.preset || `${normalized.canvasSize.width}×${normalized.canvasSize.height}`}`
            : null,
        normalized.brandStyle ? `- 旧品牌风格参考（未确认）：${normalized.brandStyle}` : null,
        rulePolicy.applicableRules.length > 0
            ? `- 已确认项目/品牌规则：${rulePolicy.applicableRules.slice(0, 6).map((rule) => rule.statement).join('；')}`
            : null,
        rulePolicy.pendingRuleCount > 0
            ? '- 有些项目规则还没有确认，先作为参考；真正影响交付时再向用户确认'
            : null,
        rulePolicy.conflicts.length > 0
            ? '- 项目规则之间存在冲突，交付前需要确认采用哪一种'
            : null,
        rulePolicy.requiresApprovalBeforeDelivery
            ? '- 项目要求在正式交付前取得用户确认'
            : null,
        summaryLine('目标用户', normalized.targetUser),
        // 素材记忆：看过 / 用过哪些图、图上是什么。没有这一行，Harness 记的账模型看不见，下一轮又要重新看图。
        Array.isArray(normalized.materialAssets) && normalized.materialAssets.length > 0
            ? `- 已看过的素材：${normalized.materialAssets.slice(-6).map((asset) => (
                `${basenameOf(asset.path)}${asset.note ? `（${String(asset.note).slice(0, 60)}）` : ''}`
            )).join('；')}${normalized.materialAssets.length > 6 ? `（共 ${normalized.materialAssets.length} 张，其余用 getDesignProjectState 查看）` : ''}`
            : null,
        summaryList('产品事实', normalized.productFacts),
        trustedFacts.length > 0
            ? `- 已确认事实：${trustedFacts.slice(0, 8).map((fact) => fact.statement).join('；')}${trustedFacts.length > 8 ? `（共 ${trustedFacts.length} 条）` : ''}`
            : null,
        assetObservedFacts.length > 0
            ? `- 素材上看到的卖点线索（来自图片观察，未经用户确认，写进文案前先核对）：${assetObservedFacts.slice(0, 6).map((fact) => fact.statement).join('；')}${assetObservedFacts.length > 6 ? `（共 ${assetObservedFacts.length} 条）` : ''}`
            : null,
        factSummary.needsReview > assetObservedFacts.length
            ? '- 还有一些项目资料尚未确认；涉及关键文案或不可逆决定时不要自行当成确定信息'
            : null,
        summaryList('用户痛点', normalized.painPoints),
        summaryList('核心卖点', normalized.sellingPoints),
        summaryList('竞品观察', normalized.competitorNotes, 4),
        Array.isArray(normalized.copywriting) && normalized.copywriting.length > 0
            ? `- 文案方案：${normalized.copywriting.slice(0, 6).map(c => `[${c.slot}] ${c.text}`).join('；')}${normalized.copywriting.length > 6 ? `（共 ${normalized.copywriting.length} 条）` : ''}`
            : null,
        summaryLine('视觉方向', normalized.visualDirection),
        summaryLine('版式规划', normalized.layoutPlan ? normalized.layoutPlan.slice(0, 400) : undefined),
        // 任务清单是跨轮次的任务真相源（治"续跑轮把上一轮半成品当原有内容重做"）：
        // 摘要不显示它 = 机制半隐身，模型既不会维护也无法据此续跑。
        Array.isArray(normalized.productionTasks) && normalized.productionTasks.length > 0
            ? `- 任务清单：${normalized.productionTasks.slice(0, 8).map(t => `[${formatProductionTaskStatus(t.status)}] ${t.title}${t.note ? `（${String(t.note).slice(0, 60)}）` : ''}`).join('；')}${normalized.productionTasks.length > 8 ? `（共 ${normalized.productionTasks.length} 项）` : ''}`
            : null,
        normalized.reviewResult?.verdict
            ? `- 上次画面反馈：${normalized.reviewResult.issues?.slice(0, 3)
                .map((issue) => [issue.problem, issue.suggestion].filter(Boolean).join('，'))
                .filter(Boolean)
                .join('；') || '继续根据当前画面判断是否需要调整'}`
            : null,
        Array.isArray(normalized.artifactRefs) && normalized.artifactRefs.length > 0
            ? `- 项目里已有 ${normalized.artifactRefs.length} 项交付内容，使用前按当前项目文件确认`
            : null,
        Array.isArray(normalized.versionHistory) && normalized.versionHistory.length > 0
            ? `- 最新版本：${normalized.versionHistory[normalized.versionHistory.length - 1].version}（${normalized.versionHistory[normalized.versionHistory.length - 1].reason}）`
            : null,
        Array.isArray(normalized.learnings) && normalized.learnings.length > 0
            ? `- 历史复盘：${normalized.learnings.slice(-3).map(l => l.note).join('；')}`
            : null
    ];

    const body = lines.filter(Boolean).join('\n');
    if (!body) return '';

    const summary = [
        '## 当前项目摘要',
        body,
        '以上是项目之前保留的信息，用户当前要求优先。发现内容已经变化时，更新项目记录。'
    ].join('\n');

    return summary.length > MAX_SUMMARY_CHARS
        ? `${summary.slice(0, MAX_SUMMARY_CHARS)}…[状态摘要已截断]`
        : summary;
}
