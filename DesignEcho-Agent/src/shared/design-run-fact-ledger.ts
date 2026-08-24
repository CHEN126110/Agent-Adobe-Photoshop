/**
 * 运行事实账本：一次运行结束后，由 Harness 把「有唯一答案的事实」记进
 * Design Project State，不再指望模型自己想起来写。
 *
 * 记什么（全部来自工具日志、可复核）：
 *  - materialAssets：看过 / 用过哪些素材，图上是什么、拍摄形态、主体占比、适不适合突出商品
 *  - factRecords（selling_point，unverified）：视觉分析在图上真实看到的卖点线索，带素材来源；
 *    已完成设计成品上的文字不进事实（设计文案 ≠ 产品事实）
 *  - layoutPlan：本次 Agent 声明的版面签名 + 标题 + 文档 + 图层组（只在模型没自己写过时代填，标「[自动记录]」）
 *  - canvasSize：本次新建文档的尺寸（现有为空时）
 *  - deliveryFiles：导出 / 保存得到的文件
 *  - versionHistory：本次有成功写入且模型没自己记版本时追加一条
 *
 * 不记什么：判断类内容（为什么这样选、方向、策略）——那是模型的话，留给它自己写。
 * 边界：只生成 patch，不做 IO；不含图像；权限沿用普通 Agent 提案（事实保持 unverified）。
 */

import type {
    DesignProjectFactUpsertInput,
    DesignProjectMaterialAsset,
    DesignProjectProductionTask,
    DesignProjectState,
    DesignProjectStatePatch
} from './types/design-project-state.types';
import {
    assetPathBasename,
    describeDesignRunToolLogFacts,
    extractDesignRunToolLogFacts,
    normalizeAssetPathKey,
    type DesignRunObservedAsset,
    type DesignRunToolLogEntryLike,
    type DesignRunToolLogFacts
} from './design-run-tool-log-facts';

export const DESIGN_RUN_FACT_LEDGER_UPDATED_BY = 'harness-run-ledger';
export const DESIGN_RUN_FACT_LEDGER_LAYOUT_PLAN_MARK = '[自动记录]';

const MAX_MATERIAL_ASSETS = 40;
const MAX_FACT_PROPOSALS = 12;
const MAX_DELIVERY_FILES = 30;
const MAX_NOTE_CHARS = 120;
const MAX_LAYOUT_PLAN_CHARS = 400;

export interface DesignRunFactLedgerInput {
    toolCallLog: readonly DesignRunToolLogEntryLike[];
    currentState?: DesignProjectState | null;
    goal?: string;
    now?: string;
    /** Completion 按用户原文逐项签发的进度；只写回现有 productionTasks，不另建任务状态。 */
    userDeclaredDeliverableProgress?: DesignRunUserDeliverableProgress[];
}

export interface DesignRunUserDeliverableProgress {
    deliverableId: string;
    label: string;
    status: 'passed' | 'failed' | 'needs_review';
    evidenceReference?: string;
    reason?: string;
}

export interface DesignRunFactLedgerOutcome {
    /** 没有任何可记的事实时为 undefined，调用方跳过写入 */
    patch?: DesignProjectStatePatch;
    facts: DesignRunToolLogFacts;
    /** 供日志与诊断：这次记了些什么 */
    recorded: {
        assets: number;
        factProposals: number;
        layoutPlan: boolean;
        canvasSize: boolean;
        deliveryFiles: number;
        productionTasks: number;
        version: boolean;
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stableHash(input: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

/** 事实来源引用必须满足 fact-provenance 的安全格式（字母数字），路径可能含中文，故用指纹。 */
export function buildAssetSourceRef(path: string): string {
    return `asset:${stableHash(normalizeAssetPathKey(path))}`;
}

function mapAssetCategory(asset: DesignRunObservedAsset): DesignProjectMaterialAsset['category'] | undefined {
    if (asset.assetNature === 'finished_design') return 'references';
    const text = String(asset.categoryText || '').toLowerCase();
    if (!text) return undefined;
    if (/背景|background/.test(text)) return 'backgrounds';
    if (/产品|商品|product|主体|货品/.test(text)) return 'products';
    if (/参考|reference|成品/.test(text)) return 'references';
    if (/元素|装饰|icon|图标|element/.test(text)) return 'elements';
    return undefined;
}

function buildAssetNote(asset: DesignRunObservedAsset, dateLabel: string): string {
    const parts = [
        asset.observation || '',
        asset.usedInLayout ? `已用于版面（${dateLabel}）` : ''
    ].filter(Boolean);
    const note = parts.join('；');
    return note.length > MAX_NOTE_CHARS ? `${note.slice(0, MAX_NOTE_CHARS - 1)}…` : note;
}

function mergeMaterialAssets(
    current: DesignProjectMaterialAsset[] | undefined,
    observed: DesignRunObservedAsset[],
    dateLabel: string
): { merged: DesignProjectMaterialAsset[]; changed: number } {
    const byKey = new Map<string, DesignProjectMaterialAsset>();
    for (const item of Array.isArray(current) ? current : []) {
        if (!isRecord(item) || typeof item.path !== 'string' || !item.path.trim()) continue;
        byKey.set(normalizeAssetPathKey(item.path), { ...item });
    }
    let changed = 0;
    for (const asset of observed) {
        const key = normalizeAssetPathKey(asset.path);
        if (!key) continue;
        const note = buildAssetNote(asset, dateLabel);
        const category = mapAssetCategory(asset);
        const existing = byKey.get(key);
        if (existing) {
            let touched = false;
            // 模型或用户写过的备注保留；只补空位，不覆盖别人的话。
            if (!String(existing.note || '').trim() && note) {
                existing.note = note;
                touched = true;
            }
            if (!existing.category && category) {
                existing.category = category;
                touched = true;
            }
            if (touched) changed += 1;
            continue;
        }
        if (!note && !category) continue;
        byKey.set(key, {
            path: asset.path,
            ...(category ? { category } : {}),
            ...(note ? { note } : {})
        });
        changed += 1;
    }
    const merged = Array.from(byKey.values());
    return {
        merged: merged.length > MAX_MATERIAL_ASSETS ? merged.slice(merged.length - MAX_MATERIAL_ASSETS) : merged,
        changed
    };
}

function buildFactProposals(
    assets: DesignRunObservedAsset[],
    now: string
): DesignProjectFactUpsertInput[] {
    const proposals: DesignProjectFactUpsertInput[] = [];
    const seen = new Set<string>();
    for (const asset of assets) {
        if (asset.assetNature === 'finished_design') continue;
        const sourceRef = buildAssetSourceRef(asset.path);
        for (const statement of asset.sellingPointObservations) {
            const key = statement.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            proposals.push({
                claimType: 'selling_point',
                statement,
                source: {
                    kind: 'project_asset_observation',
                    sourceRef,
                    supportRefs: [sourceRef],
                    observedAt: now
                }
            });
            if (proposals.length >= MAX_FACT_PROPOSALS) return proposals;
        }
    }
    return proposals;
}

function buildAutoLayoutPlan(facts: DesignRunToolLogFacts): string {
    const latest = facts.layouts[facts.layouts.length - 1];
    // 只记具备显式归一化几何的 Agent 版面签名。neutral_wireframe、缺 visualStyle 或无 regions / blocks
    // 的模糊写入不会产生签名，避免误导下一轮把结构预览或错误画布当成已确定设计。
    if (!latest?.layoutSignature) return '';
    const parts = [
        `Agent 版面签名「${latest.layoutSignature}」`,
        latest.headline.length > 0 ? `标题「${latest.headline.join(' / ')}」` : '',
        latest.subline ? `副标题「${latest.subline}」` : '',
        latest.subjectPath ? `主体素材 ${assetPathBasename(latest.subjectPath)}` : '',
        latest.documentName ? `文档「${latest.documentName}」` : '',
        latest.stageGroupName ? `图层组「${latest.stageGroupName}」` : ''
    ].filter(Boolean);
    const text = `${DESIGN_RUN_FACT_LEDGER_LAYOUT_PLAN_MARK} ${parts.join('；')}`;
    return text.length > MAX_LAYOUT_PLAN_CHARS ? `${text.slice(0, MAX_LAYOUT_PLAN_CHARS - 1)}…` : text;
}

function canOverwriteLayoutPlan(current: unknown): boolean {
    const text = String(current || '').trim();
    return !text || text.startsWith(DESIGN_RUN_FACT_LEDGER_LAYOUT_PLAN_MARK);
}

function mergeDeliveryFiles(current: unknown, incoming: string[]): { merged: string[]; added: number } {
    const list = Array.isArray(current) ? current.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
    const seen = new Set(list.map((item) => normalizeAssetPathKey(item)));
    let added = 0;
    for (const file of incoming) {
        const key = normalizeAssetPathKey(file);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        list.push(file);
        added += 1;
    }
    return {
        merged: list.length > MAX_DELIVERY_FILES ? list.slice(list.length - MAX_DELIVERY_FILES) : list,
        added
    };
}

function normalizeProductionTaskKey(value: unknown): string {
    return String(value || '')
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/^(?:用户)?交付[：:]\s*/u, '')
        .replace(/\s+/gu, '');
}

function buildDeliverableProgressNote(progress: DesignRunUserDeliverableProgress): string {
    if (progress.status === 'passed') {
        const evidenceName = assetPathBasename(progress.evidenceReference);
        return `[自动收据] 已取得独立交付收据${evidenceName ? `：${evidenceName}` : ''}`;
    }
    const reason = String(progress.reason || '').replace(/\s+/gu, ' ').trim();
    const fallback = progress.status === 'needs_review'
        ? '已有证据，但尚不能唯一归属到该交付物。'
        : '尚未取得真实交付收据。';
    return `[自动收据] ${reason || fallback}`.slice(0, MAX_NOTE_CHARS);
}

function mergeProductionTaskProgress(
    current: DesignProjectProductionTask[] | undefined,
    progressItems: readonly DesignRunUserDeliverableProgress[]
): { merged: DesignProjectProductionTask[]; changed: number } {
    const merged = (Array.isArray(current) ? current : [])
        .filter((item): item is DesignProjectProductionTask => (
            Boolean(item) && typeof item.title === 'string' && item.title.trim().length > 0
        ))
        .map((item) => ({ ...item }));
    const indexByKey = new Map<string, number>();
    for (let index = 0; index < merged.length; index += 1) {
        indexByKey.set(normalizeProductionTaskKey(merged[index].title), index);
    }

    let changed = 0;
    for (const progress of progressItems) {
        const label = String(progress.label || '').trim();
        const key = normalizeProductionTaskKey(label);
        if (!label || !key) continue;
        const status: DesignProjectProductionTask['status'] = progress.status === 'passed'
            ? 'done'
            : (progress.status === 'needs_review' ? 'in_progress' : 'pending');
        const autoNote = buildDeliverableProgressNote(progress);
        const existingIndex = indexByKey.get(key);
        if (existingIndex == null) {
            merged.push({ title: `交付：${label}`, status, note: autoNote });
            indexByKey.set(key, merged.length - 1);
            changed += 1;
            continue;
        }

        const existing = merged[existingIndex];
        const nextNote = !existing.note || existing.note.startsWith('[自动收据]')
            ? autoNote
            : existing.note;
        if (existing.status !== status || existing.note !== nextNote) {
            merged[existingIndex] = { ...existing, status, note: nextNote };
            changed += 1;
        }
    }
    return { merged, changed };
}

function formatDateLabel(now: string): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(now);
    return match ? `${match[1]}-${match[2]}-${match[3]}` : now.slice(0, 10);
}

/**
 * 从工具日志生成写回 Design Project State 的 patch。
 * 没有可记事实（纯问答 / 只读运行）时 patch 为 undefined。
 */
export function buildDesignRunFactLedgerPatch(input: DesignRunFactLedgerInput): DesignRunFactLedgerOutcome {
    const now = input.now || new Date().toISOString();
    const dateLabel = formatDateLabel(now);
    const facts = extractDesignRunToolLogFacts(input.toolCallLog || []);
    const current = input.currentState && isRecord(input.currentState) ? input.currentState : undefined;
    const set: NonNullable<DesignProjectStatePatch['set']> = {};
    const recorded: DesignRunFactLedgerOutcome['recorded'] = {
        assets: 0,
        factProposals: 0,
        layoutPlan: false,
        canvasSize: false,
        deliveryFiles: 0,
        productionTasks: 0,
        version: false
    };

    if (facts.assets.length > 0) {
        const merge = mergeMaterialAssets(current?.materialAssets, facts.assets, dateLabel);
        if (merge.changed > 0) {
            set.materialAssets = merge.merged;
            recorded.assets = merge.changed;
        }
    }

    const upsertFacts = buildFactProposals(facts.assets, now);
    recorded.factProposals = upsertFacts.length;

    const autoLayoutPlan = buildAutoLayoutPlan(facts);
    if (autoLayoutPlan && canOverwriteLayoutPlan(current?.layoutPlan) && current?.layoutPlan !== autoLayoutPlan) {
        set.layoutPlan = autoLayoutPlan;
        recorded.layoutPlan = true;
    }

    const created = facts.document.created;
    const currentCanvas = current?.canvasSize;
    const hasCurrentCanvas = Boolean(currentCanvas && (currentCanvas.width || currentCanvas.preset));
    if (created && !hasCurrentCanvas && (created.width && created.height || created.preset)) {
        set.canvasSize = {
            ...(created.width ? { width: created.width } : {}),
            ...(created.height ? { height: created.height } : {}),
            ...(created.preset ? { preset: created.preset } : {})
        };
        recorded.canvasSize = true;
    }

    if (facts.deliveryFiles.length > 0) {
        const merge = mergeDeliveryFiles(current?.deliveryFiles, facts.deliveryFiles);
        if (merge.added > 0) {
            set.deliveryFiles = merge.merged;
            recorded.deliveryFiles = merge.added;
        }
    }

    const deliverableProgress = Array.isArray(input.userDeclaredDeliverableProgress)
        ? input.userDeclaredDeliverableProgress
        : [];
    if (deliverableProgress.length > 0) {
        const merge = mergeProductionTaskProgress(current?.productionTasks, deliverableProgress);
        if (merge.changed > 0) {
            set.productionTasks = merge.merged;
            recorded.productionTasks = merge.changed;
        }
    }

    let appendVersion: DesignProjectStatePatch['appendVersion'];
    if (facts.successfulMutationCount > 0 && !facts.modelUpdatedProjectState) {
        const goal = String(input.goal || '').replace(/\s+/g, ' ').trim().slice(0, 40);
        const summary = describeDesignRunToolLogFacts(facts, { maxChars: 160 });
        appendVersion = {
            reason: `${goal ? `「${goal}」` : '本次运行'}写入 ${facts.successfulMutationCount} 处${summary ? `：${summary}` : ''}`
        };
        recorded.version = true;
    }

    const hasSet = Object.keys(set).length > 0;
    if (!hasSet && upsertFacts.length === 0 && !appendVersion) {
        return { facts, recorded };
    }
    return {
        facts,
        recorded,
        patch: {
            ...(hasSet ? { set } : {}),
            ...(upsertFacts.length > 0 ? { upsertFacts, factWriteAuthority: 'agent_proposal' } : {}),
            ...(appendVersion ? { appendVersion } : {}),
            updatedBy: DESIGN_RUN_FACT_LEDGER_UPDATED_BY
        }
    };
}
