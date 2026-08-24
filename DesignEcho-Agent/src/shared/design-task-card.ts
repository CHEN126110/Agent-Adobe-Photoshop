/**
 * 设计任务卡（Design Task Card）——「自己规划」的可见产物，也是完成契约。
 *
 * 形态照用户日常的任务卡（2026-08-18）：
 *   角色与为什么（这张图在转化链路里干什么）→ 判断与含义（产品 / 风格 ⇒ 设计上意味着什么）
 *   → 清单：要弄清的事实（fact）/ 要做的决定（decision）/ 要出的画面（deliverable）。
 *
 * 分工：卡由模型写（判断与规划归模型）；打勾由 Harness 记账核对——每一项打勾都要有收据：
 *   fact 要一句「弄清了什么」且这期间真的看过 / 问过；decision 要一句决定；deliverable 要真的有成功写入。
 *   模型不能空口说「好了」。完成 = 清单里的 deliverable 与 fact 全部 done（decision 允许留白但会列出）。
 *
 * 纯逻辑、无 IO、无品类词。
 */

export type DesignTaskItemKind = 'fact' | 'decision' | 'deliverable';
export type DesignTaskItemStatus = 'todo' | 'doing' | 'done' | 'skipped';

export interface DesignTaskItemReceipt {
    /** 打勾依据的一句话（弄清了什么 / 决定了什么 / 出了什么） */
    note: string;
    /** 支撑收据的工具与顺序号（Harness 记账时填） */
    toolName?: string;
    toolSeq?: number;
    /** 画面收据（缩略图 data URL 或文件路径），deliverable 项尽量有 */
    imageRef?: string;
    at: number;
}

export interface DesignTaskItem {
    id: string;
    kind: DesignTaskItemKind;
    text: string;
    status: DesignTaskItemStatus;
    receipt?: DesignTaskItemReceipt;
    /** deliverable 可带数量（如 5 个方案 / 4 张），done 的判据是 producedCount ≥ count */
    count?: number;
    producedCount?: number;
}

export interface DesignTaskCard {
    version: 'design-task-card/v1';
    id: string;
    /** 卡片标题：交付物名（如 SKU / 详情页 / 点击图 / 转化图） */
    title: string;
    /** 角色与为什么 */
    role: string;
    /** 对产品 / 风格的判断及其设计含义 */
    judgment: string;
    items: DesignTaskItem[];
    /** 「验」栏：最近一次评审摘要（评审器写入） */
    evaluation?: string;
    createdAt: number;
    updatedAt: number;
}

export interface DesignTaskCardInput {
    title: string;
    role: string;
    judgment: string;
    items: Array<{ id?: string; kind: DesignTaskItemKind | string; text: string; count?: number }>;
}

export interface DesignTaskCardNormalization {
    ok: boolean;
    issues: string[];
    card?: DesignTaskCard;
}

const KINDS: DesignTaskItemKind[] = ['fact', 'decision', 'deliverable'];
const KIND_LABEL: Record<DesignTaskItemKind, string> = { fact: '弄清', decision: '决定', deliverable: '出图' };
const STATUS_MARK: Record<DesignTaskItemStatus, string> = { todo: '☐', doing: '◐', done: '☑', skipped: '⊘' };

function clean(value: unknown): string {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function slug(text: string, index: number): string {
    return `${index + 1}-${text.replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 12) || 'item'}`;
}

/** 校验并建卡。问题按「哪一项 · 该怎么给」写，模型能一次改对。 */
export function createDesignTaskCard(input: DesignTaskCardInput | any, now: number = Date.now()): DesignTaskCardNormalization {
    const issues: string[] = [];
    const title = clean(input?.title);
    const role = clean(input?.role);
    const judgment = clean(input?.judgment);
    if (!title) issues.push('title：交付物名（如 点击图 / 详情页 / SKU）');
    if (role.length < 6) issues.push('role：这张图在链路里的角色与为什么（一两句，如「点击图是流量入口，要一眼抓住精准用户」）');
    if (judgment.length < 6) issues.push('judgment：对产品 / 风格的判断及其设计含义（如「ins 风格 ⇒ 不抠图、版式网感、先找参考」）');
    const rawItems = Array.isArray(input?.items) ? input.items : [];
    if (rawItems.length === 0) issues.push('items：至少一项，kind 取 fact（要弄清的事实）/ decision（要做的决定）/ deliverable（要出的画面，可带 count）');
    const items: DesignTaskItem[] = [];
    const seen = new Set<string>();
    rawItems.forEach((raw: any, index: number) => {
        const text = clean(raw?.text);
        const kind = clean(raw?.kind) as DesignTaskItemKind;
        if (!text) { issues.push(`items[${index}].text：不能为空`); return; }
        if (!KINDS.includes(kind)) { issues.push(`items[${index}].kind：「${kind || '空'}」不合法，取 fact / decision / deliverable`); return; }
        let id = clean(raw?.id) || slug(text, index);
        while (seen.has(id)) id = `${id}-${index}`;
        seen.add(id);
        const count = Number(raw?.count);
        items.push({
            id,
            kind,
            text,
            status: 'todo',
            ...(kind === 'deliverable' && Number.isFinite(count) && count > 1 ? { count: Math.round(count), producedCount: 0 } : {})
        });
    });
    if (issues.length > 0) return { ok: false, issues };
    return {
        ok: true,
        issues,
        card: {
            version: 'design-task-card/v1',
            id: `card-${now.toString(36)}`,
            title, role, judgment, items,
            createdAt: now,
            updatedAt: now
        }
    };
}

export interface DesignTaskItemUpdate {
    itemId: string;
    status: DesignTaskItemStatus;
    /** 弄清了什么 / 决定了什么 / 出了什么（done 必填） */
    note?: string;
    imageRef?: string;
    /** deliverable 本次新增产出数（默认 1） */
    produced?: number;
}

/**
 * Harness 记账时的证据：自上次打勾以来是否真的发生过观察 / 提问 / 成功写入。
 * 由调用方从工具日志算出后传入；纯逻辑只做核对。
 */
export interface DesignTaskEvidence {
    observedSinceLastUpdate: boolean;
    askedUserSinceLastUpdate: boolean;
    successfulWritesSinceLastUpdate: number;
    lastWriteTool?: string;
    lastWriteSeq?: number;
    lastWriteImageRef?: string;
}

export interface DesignTaskUpdateOutcome {
    ok: boolean;
    card: DesignTaskCard;
    issues: string[];
    changed?: DesignTaskItem;
}

/** 打勾要有收据：核对不过就不改状态，并说清缺什么。 */
export function applyDesignTaskItemUpdate(
    card: DesignTaskCard,
    update: DesignTaskItemUpdate,
    evidence: DesignTaskEvidence,
    now: number = Date.now()
): DesignTaskUpdateOutcome {
    const issues: string[] = [];
    const item = card.items.find((entry) => entry.id === clean(update?.itemId));
    if (!item) {
        return { ok: false, card, issues: [`itemId「${clean(update?.itemId) || '空'}」不在卡上；可选：${card.items.map((entry) => entry.id).join(' / ')}`] };
    }
    const status = clean(update?.status) as DesignTaskItemStatus;
    if (!['todo', 'doing', 'done', 'skipped'].includes(status)) {
        return { ok: false, card, issues: ['status：取 todo / doing / done / skipped'] };
    }
    const note = clean(update?.note);
    if (status === 'done' || status === 'skipped') {
        if (note.length < 2) issues.push(`「${item.text}」标 ${status} 需要 note：${item.kind === 'fact' ? '弄清了什么' : item.kind === 'decision' ? '决定了什么、为什么' : '出了什么'}`);
        if (status === 'done') {
            if (item.kind === 'fact' && !evidence.observedSinceLastUpdate && !evidence.askedUserSinceLastUpdate) {
                issues.push(`「${item.text}」是要弄清的事实，但这期间没有看过图 / 读过文档 / 问过用户——先去看或问，再打勾`);
            }
            if (item.kind === 'deliverable' && evidence.successfulWritesSinceLastUpdate <= 0) {
                issues.push(`「${item.text}」是要出的画面，但这期间没有任何成功写入——先出图，再打勾`);
            }
        }
    }
    if (issues.length > 0) return { ok: false, card, issues };

    const next: DesignTaskItem = { ...item, status };
    if (status === 'done' && item.kind === 'deliverable' && item.count && item.count > 1) {
        const produced = (item.producedCount || 0) + Math.max(1, Math.round(Number(update?.produced) || 1));
        next.producedCount = produced;
        if (produced < item.count) {
            next.status = 'doing';
        }
    }
    if (status === 'done' || status === 'skipped') {
        next.receipt = {
            note,
            toolName: item.kind === 'deliverable' ? evidence.lastWriteTool : undefined,
            toolSeq: item.kind === 'deliverable' ? evidence.lastWriteSeq : undefined,
            imageRef: clean(update?.imageRef) || (item.kind === 'deliverable' ? evidence.lastWriteImageRef : undefined),
            at: now
        };
    }
    const items = card.items.map((entry) => (entry.id === item.id ? next : entry));
    return { ok: true, issues, changed: next, card: { ...card, items, updatedAt: now } };
}

export interface DesignTaskCompletion {
    complete: boolean;
    doneCount: number;
    total: number;
    remaining: DesignTaskItem[];
    /** 一句话：做到哪了 / 还差什么 */
    summary: string;
}

/** 完成 = fact 与 deliverable 全部 done / skipped；decision 未决只列出不阻断。 */
export function deriveDesignTaskCompletion(card: DesignTaskCard): DesignTaskCompletion {
    const doneCount = card.items.filter((item) => item.status === 'done' || item.status === 'skipped').length;
    const remaining = card.items.filter((item) => item.status !== 'done' && item.status !== 'skipped');
    const blocking = remaining.filter((item) => item.kind !== 'decision');
    const complete = blocking.length === 0;
    const summary = complete
        ? `任务卡「${card.title}」${doneCount}/${card.items.length} 项完成${remaining.length ? `（${remaining.length} 项决定留白：${remaining.map((item) => item.text).join('、')}）` : ''}`
        : `任务卡「${card.title}」${doneCount}/${card.items.length}，还差：${blocking.map((item) => `${KIND_LABEL[item.kind]}·${item.text}${item.count ? `（${item.producedCount || 0}/${item.count}）` : ''}`).join('；')}`;
    return { complete, doneCount, total: card.items.length, remaining, summary };
}

/** 界面与过程归属用的清单顺序：先弄清事实 → 再做决定 → 最后出画面（同类内保持模型写的顺序）。 */
export function orderDesignTaskItems(card: DesignTaskCard): DesignTaskItem[] {
    return KINDS.flatMap((kind) => card.items.filter((item) => item.kind === kind));
}

/**
 * 「此刻在做哪一项」——用来把运行时的过程步骤挂到对应条目下、并给它扫光。
 * 模型明确标了 doing 就是它；没标时按顺序推定为第一条还没做完的（纯展示推定，不改卡上的状态）。
 * 全部做完返回 null。
 */
export function resolveCurrentDesignTaskItemId(card: DesignTaskCard): string | null {
    const ordered = orderDesignTaskItems(card);
    const doing = ordered.find((item) => item.status === 'doing');
    if (doing) return doing.id;
    const next = ordered.find((item) => item.status === 'todo');
    return next ? next.id : null;
}

/** 给模型 / 界面看的紧凑文本（三段：想 · 做 · 完成条件）。 */
export function renderDesignTaskCardText(card: DesignTaskCard): string {
    const completion = deriveDesignTaskCompletion(card);
    const lines = [
        `▣ ${card.title} · ${card.role}`,
        `  想 │ ${card.judgment}`,
        ...card.items.map((item, index) => `  ${index === 0 ? '做' : '  '} │ ${STATUS_MARK[item.status]} ${KIND_LABEL[item.kind]}·${item.text}${item.count ? `（${item.producedCount || 0}/${item.count}）` : ''}${item.receipt?.note ? ` ← ${item.receipt.note}` : ''}`),
        `  验 │ ${card.evaluation || '（未评审）'}`,
        `  完成 │ ${completion.complete ? '已达成' : completion.summary.replace(/^任务卡「[^」]*」/, '')}`
    ];
    return lines.join('\n');
}
