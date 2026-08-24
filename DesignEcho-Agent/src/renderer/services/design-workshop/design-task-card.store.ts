/**
 * 设计任务卡的会话内账本：卡由模型写，打勾由这里核对收据。
 *
 * 证据来源：executeToolCall 每次成功调用后 `noteToolForTaskCardEvidence` 记一笔（观察 / 写入 / 问用户），
 * 模型调用 updateDesignTaskCard 时按该项的证据窗口核对（事实：立卡 / 上次打勾以来看过或问过；
 * 出图：有未被认领的成功写入），核对不过不改状态。
 * 每张卡绑定请求级 scope；不同任务、项目或并行运行之间不共享 activeCard。
 */

import {
    applyDesignTaskItemUpdate,
    createDesignTaskCard,
    deriveDesignTaskCompletion,
    renderDesignTaskCardText,
    type DesignTaskCard,
    type DesignTaskEvidence
} from '../../../shared/design-task-card';
import { classifyAgentToolExecution } from '../../../shared/agent-tool-execution-preflight';
import { classifyRunToolActivity } from '../../../shared/agent-run-record';
import type { PhotoshopHistoryStateRef } from '../../../shared/photoshop-history-state-ref';

/**
 * 证据账本：按顺序号记「最近一次观察 / 提问发生在第几笔」和「未被认领的成功写入」。
 * 事实项按各自的基线核对（基线 = 立卡时或该项上次打勾时的顺序号）：同一次看图可以同时支撑几条事实；
 * 出图项认领写入后写入计数清零（一次写入只算一张画面的收据）。
 */
interface EvidenceLedger {
    seq: number;
    lastObservationSeq: number;
    lastAskSeq: number;
    successfulWritesSinceLastClaim: number;
    lastWriteTool?: string;
    lastWriteSeq?: number;
    lastWriteImageRef?: string;
    /** 事实项核对基线：itemId → 顺序号 */
    factBaselineSeq: Record<string, number>;
}

interface DesignTaskCardSession {
    card: DesignTaskCard;
    ledger: EvidenceLedger;
    /**
     * 评审连续性属于当前任务卡会话，并按 Photoshop 文档隔离。
     * historyStateId 只用于确认两次评审之间确实出现了不同修订；缺失身份时不猜。
     */
    evaluationCheckpoints: Map<number, DesignTaskEvaluationCheckpoint>;
    updatedAt: number;
}

interface DesignTaskEvaluationCheckpoint {
    historyStateId: number;
    topCritique: string;
}

export interface DesignTaskEvaluationObservation {
    historyStateRef?: PhotoshopHistoryStateRef;
    topCritique?: string;
    verdict?: 'pass' | 'revise' | 'pivot';
}

export interface DesignTaskEvaluationRecordResult {
    repeatedTopCritique: boolean;
}

const MAX_TASK_CARD_SESSIONS = 24;
const sessions = new Map<string, DesignTaskCardSession>();

function freshLedger(): EvidenceLedger {
    return { seq: 0, lastObservationSeq: 0, lastAskSeq: 0, successfulWritesSinceLastClaim: 0, factBaselineSeq: {} };
}

function normalizeScope(scope: unknown): string {
    return String(scope || '').trim().slice(0, 240);
}

function pruneSessions(protectedScope: string): void {
    if (sessions.size <= MAX_TASK_CARD_SESSIONS) return;
    const oldest = Array.from(sessions.entries())
        .filter(([scope]) => scope !== protectedScope)
        .sort((left, right) => left[1].updatedAt - right[1].updatedAt)[0];
    if (oldest) sessions.delete(oldest[0]);
}

function evidenceForItem(session: DesignTaskCardSession, itemId: string): DesignTaskEvidence {
    const baseline = session.ledger.factBaselineSeq[itemId] || 0;
    return {
        observedSinceLastUpdate: session.ledger.lastObservationSeq > baseline,
        askedUserSinceLastUpdate: session.ledger.lastAskSeq > baseline,
        successfulWritesSinceLastUpdate: session.ledger.successfulWritesSinceLastClaim,
        lastWriteTool: session.ledger.lastWriteTool,
        lastWriteSeq: session.ledger.lastWriteSeq,
        lastWriteImageRef: session.ledger.lastWriteImageRef
    };
}

function pickImageRef(result: any): string | undefined {
    const candidates = [
        result?.snapshot?.imageData,
        result?.snapshot?.snapshot?.base64,
        result?.snapshot?.base64,
        result?.saved?.path,
        result?.path,
        result?.filePath
    ];
    for (const value of candidates) {
        if (typeof value === 'string' && value.length > 0) {
            return value.length > 200 && !/^data:/.test(value) ? `data:image/jpeg;base64,${value}` : value;
        }
    }
    return undefined;
}

/** 每次工具调用后记一笔证据（只记成功的；卡片工具自身不算）。 */
export function noteToolForTaskCardEvidence(scope: string, toolName: string, params: any, result: any): void {
    const session = sessions.get(normalizeScope(scope));
    if (!session || result?.success === false) return;
    if (/^(planDesignTaskCard|updateDesignTaskCard|getDesignTaskCard)$/.test(toolName)) return;
    session.ledger.seq += 1;
    session.updatedAt = Date.now();
    if (toolName === 'createInteractiveCard' || toolName === 'askUser') {
        session.ledger.lastAskSeq = session.ledger.seq;
        return;
    }
    const kind = classifyAgentToolExecution(toolName, params || {});
    const activity = classifyRunToolActivity(toolName, kind);
    if (activity === 'mutation') {
        session.ledger.successfulWritesSinceLastClaim += 1;
        session.ledger.lastWriteTool = toolName;
        session.ledger.lastWriteSeq = session.ledger.seq;
        const imageRef = pickImageRef(result);
        if (imageRef) session.ledger.lastWriteImageRef = imageRef;
    } else if (activity === 'observation') {
        session.ledger.lastObservationSeq = session.ledger.seq;
    }
}

export function getActiveDesignTaskCard(scope: string): DesignTaskCard | null {
    return sessions.get(normalizeScope(scope))?.card || null;
}

/**
 * 评审器把一句摘要写进当前卡的「验」栏，并在当前 TaskRun 内记录文档修订级评审连续性。
 * 没有任务卡、文档身份或修订身份时只写摘要（若有卡），不推断“改了但没解决”。
 */
export function recordDesignTaskEvaluation(
    scope: string,
    summary: string,
    observation?: DesignTaskEvaluationObservation
): DesignTaskEvaluationRecordResult {
    const session = sessions.get(normalizeScope(scope));
    const text = String(summary || '').trim();
    if (!session) return { repeatedTopCritique: false };
    if (text) {
        session.card = { ...session.card, evaluation: text, updatedAt: Date.now() };
    }
    session.updatedAt = Date.now();

    const historyStateRef = observation?.historyStateRef;
    const topCritique = String(observation?.topCritique || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60);
    if (!historyStateRef
        || !Number.isSafeInteger(historyStateRef.documentId)
        || historyStateRef.documentId <= 0
        || !Number.isSafeInteger(historyStateRef.historyStateId)
        || historyStateRef.historyStateId <= 0) {
        return { repeatedTopCritique: false };
    }

    const previous = session.evaluationCheckpoints.get(historyStateRef.documentId);
    const repeatedTopCritique = Boolean(
        topCritique
        && observation?.verdict !== 'pass'
        && previous?.topCritique === topCritique
        && previous.historyStateId !== historyStateRef.historyStateId
    );
    session.evaluationCheckpoints.delete(historyStateRef.documentId);
    session.evaluationCheckpoints.set(historyStateRef.documentId, {
        historyStateId: historyStateRef.historyStateId,
        topCritique: observation?.verdict === 'pass' ? '' : topCritique
    });
    while (session.evaluationCheckpoints.size > 12) {
        const oldestDocumentId = session.evaluationCheckpoints.keys().next().value;
        if (oldestDocumentId === undefined) break;
        session.evaluationCheckpoints.delete(oldestDocumentId);
    }
    return { repeatedTopCritique };
}

export function executePlanDesignTaskCard(scope: string, params: any): any {
    const normalizedScope = normalizeScope(scope);
    if (!normalizedScope) {
        return { success: false, error: 'planDesignTaskCard 缺少当前 TaskRun 作用域，未创建跨任务共享卡片。' };
    }
    const created = createDesignTaskCard(params);
    if (!created.ok || !created.card) {
        return {
            success: false,
            error: `planDesignTaskCard 任务卡不完整：${created.issues.join('；')}`,
            issues: created.issues,
            message: '任务卡照设计师的写法：角色与为什么 → 判断与含义 → 清单（要弄清的事实 / 要做的决定 / 要出的画面）。'
        };
    }
    const session: DesignTaskCardSession = {
        card: created.card,
        ledger: freshLedger(),
        evaluationCheckpoints: new Map(),
        updatedAt: Date.now()
    };
    sessions.set(normalizedScope, session);
    pruneSessions(normalizedScope);
    const completion = deriveDesignTaskCompletion(session.card);
    return {
        success: true,
        card: session.card,
        cardText: renderDesignTaskCardText(session.card),
        completion,
        message: `任务卡已立：${session.card.title}，${session.card.items.length} 项。逐项做，做完一项用 updateDesignTaskCard 打勾（要带一句收据）；全部 fact / deliverable 打勾才算完成。`
    };
}

export function executeUpdateDesignTaskCard(scope: string, params: any): any {
    const session = sessions.get(normalizeScope(scope));
    if (!session) {
        return { success: false, error: 'updateDesignTaskCard：当前没有任务卡；先用 planDesignTaskCard 立卡。' };
    }
    const outcome = applyDesignTaskItemUpdate(
        session.card,
        params || {},
        evidenceForItem(session, String(params?.itemId || ''))
    );
    if (!outcome.ok) {
        return {
            success: false,
            error: `updateDesignTaskCard 未打勾：${outcome.issues.join('；')}`,
            issues: outcome.issues,
            card: session.card,
            cardText: renderDesignTaskCardText(session.card)
        };
    }
    session.card = outcome.card;
    session.updatedAt = Date.now();
    // 打勾成功只消费本项用到的那类证据（run 498：一次 composeDesign 之后先勾了「决定」，整本账被清空，
    // 紧接着的「出图」项就再也对不上那次写入——同一批观察 / 同一次写入本来就可能同时支撑几项）：
    //   deliverable done → 消费写入；fact done → 消费观察 / 提问；decision 与 doing / todo → 不动账。
    if (outcome.changed && (params?.status === 'done' || params?.status === 'skipped')) {
        if (outcome.changed.kind === 'deliverable') {
            session.ledger.successfulWritesSinceLastClaim = 0;
            session.ledger.lastWriteTool = undefined;
            session.ledger.lastWriteSeq = undefined;
            session.ledger.lastWriteImageRef = undefined;
        } else if (outcome.changed.kind === 'fact') {
            session.ledger.factBaselineSeq[outcome.changed.id] = session.ledger.seq;
        }
    }
    const completion = deriveDesignTaskCompletion(session.card);
    return {
        success: true,
        changed: outcome.changed,
        card: session.card,
        cardText: renderDesignTaskCardText(session.card),
        completion,
        message: completion.complete
            ? `${completion.summary}。可以收尾了：把成稿与设计说明交给用户。`
            : completion.summary
    };
}

export function executeGetDesignTaskCard(scope: string): any {
    const session = sessions.get(normalizeScope(scope));
    if (!session) {
        return { success: true, card: null, message: '当前没有任务卡。复杂、多交付物或需要跨轮续跑时可用 planDesignTaskCard 建立完成清单；简单任务可直接执行。' };
    }
    return {
        success: true,
        card: session.card,
        cardText: renderDesignTaskCardText(session.card),
        completion: deriveDesignTaskCompletion(session.card)
    };
}

export function releaseDesignTaskCardSession(scope: string): void {
    sessions.delete(normalizeScope(scope));
}
