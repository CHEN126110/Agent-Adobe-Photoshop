/**
 * 学习候选区的渲染进程门面：读 / 合并 / 写项目 .designecho/learning-candidates.json。
 * 自动观察只写候选；用户明确的「留 / 改 / 弃」立即发布为当前项目评审校准。
 */

import {
    addDesignLearningCandidate,
    applyAutoPromotionRules,
    curateProvisionalExperience,
    candidateFromUserVerdict,
    candidatesFromEvaluation,
    createDesignLearningLedger,
    decideDesignLearningCandidate,
    listPromotableCandidates,
    normalizeDesignLearningLedger,
    recordDesignRunOutcome,
    renderDesignLearningTimeline,
    type DesignLearningLedger
} from '../../../shared/design-learning-candidates';

type Invoke = (channel: string, ...args: any[]) => Promise<any>;

async function readLedger(invoke: Invoke, projectPath: string): Promise<DesignLearningLedger> {
    const result = await invoke('designWorkshop:readLearningLedger', { projectPath });
    if (!result?.success) {
        throw new Error(String(result?.error || '读取学习候选区失败'));
    }
    return result.ledger ? normalizeDesignLearningLedger(result.ledger) : createDesignLearningLedger();
}

async function writeLedger(invoke: Invoke, projectPath: string, ledger: DesignLearningLedger): Promise<string> {
    const result = await invoke('designWorkshop:writeLearningLedger', { projectPath, ledger });
    if (!result?.success) {
        throw new Error(String(result?.error || '写入学习候选区失败'));
    }
    return String(result.filePath || '');
}

/** 评审后：把批评作为一次 evaluation_finding 写进候选区（不阻断评审结果，也不校准评审器）。
 * runId 建议传运行作用域（taskCardScope）——它是行为结局回写与自动晋升验证的关联键。 */
export async function recordEvaluationLearnings(invoke: Invoke, projectPath: string | undefined, input: {
    critiques: string[]; runId?: string; deliverable?: string;
}): Promise<{ added: number; merged: number; error?: string } | undefined> {
    if (!projectPath) return undefined;
    try {
        let ledger = await readLedger(invoke, projectPath);
        let added = 0;
        let merged = 0;
        for (const candidate of candidatesFromEvaluation(input)) {
            const outcome = addDesignLearningCandidate(ledger, candidate);
            ledger = outcome.ledger;
            if (outcome.merged) merged += 1; else added += 1;
        }
        await writeLedger(invoke, projectPath, ledger);
        return { added, merged };
    } catch (error: any) {
        const message = error?.message || String(error);
        console.warn('[DesignLearning] 评审观察写入候选区失败：', message);
        return { added: 0, merged: 0, error: message };
    }
}

/**
 * 参考观察入池（自主沉淀 P1.5，2026-08-23 用户拍板「看参考要沉淀为经验」）：
 * analyzeEagleReference 的可迁移启发写为候选（origin=reference_study，带 run / eagle 证据），
 * 与评审观察吃同一套行为验证晋升——启发被用于的稿子被导出交付才有资格进 provisional。
 * 治理边界：候选不进任何生产消费面；参考解读依旧不能直接教评审器。
 */
export async function recordReferenceLearnings(invoke: Invoke, projectPath: string | undefined, input: {
    observations: string[]; runScope?: string; eagleItemId?: string;
}): Promise<void> {
    if (!projectPath || input.observations.length === 0) return;
    try {
        let ledger = await readLedger(invoke, projectPath);
        const evidence = [
            input.runScope ? `run:${input.runScope}` : '',
            input.eagleItemId ? `eagle:${input.eagleItemId}` : ''
        ].filter(Boolean);
        for (const observation of input.observations.slice(0, 3)) {
            const text = observation.trim();
            if (text.length < 8) continue;
            ledger = addDesignLearningCandidate(ledger, {
                kind: 'evaluation_finding',
                text,
                evidence,
                origin: 'reference_study',
                scope: { kind: 'project' }
            }).ledger;
        }
        await writeLedger(invoke, projectPath, ledger);
    } catch (error: any) {
        console.warn('[DesignLearning] 参考观察入池失败：', error?.message || String(error));
    }
}

/**
 * 稿件导出交付的正向结局回写（自主沉淀 P1）：给本次运行关联的观察候选记 delivered，
 * 随后跑保守自动晋升规则。fire-and-forget 语义：失败只记 warning，不影响导出结果。
 */
export async function recordDesignRunDeliveryOutcome(
    invoke: Invoke,
    projectPath: string | undefined,
    runScope: string | undefined
): Promise<void> {
    if (!projectPath || !runScope) return;
    try {
        let ledger = await readLedger(invoke, projectPath);
        const outcome = recordDesignRunOutcome(ledger, runScope, 'delivered');
        if (outcome.touched === 0) return;
        const promotion = applyAutoPromotionRules(outcome.ledger);
        // P3 有界策展：晋升后立即策展（30 天衰减 + 总量上限），防试用知识无界膨胀自我中毒。
        const curation = curateProvisionalExperience(promotion.ledger);
        await writeLedger(invoke, projectPath, curation.ledger);
        if (promotion.promoted.length > 0) {
            console.info(`[DesignLearning] ${promotion.promoted.length} 条观察经行为验证进入试用（provisional）。`);
        }
        if (curation.demoted.length > 0) {
            console.info(`[DesignLearning] ${curation.demoted.length} 条试用经验被策展降回候选（衰减/上限）。`);
        }
    } catch (error: any) {
        console.warn('[DesignLearning] 交付结局回写失败：', error?.message || String(error));
    }
}

export async function executeRecordDesignVerdict(invoke: Invoke, projectPath: string | undefined, params: any, runScope?: string): Promise<any> {
    const verdict = String(params?.verdict || '').trim() as 'keep' | 'revise' | 'discard';
    if (!['keep', 'revise', 'discard'].includes(verdict)) {
        return { success: false, error: 'recordDesignVerdict：verdict 取 keep（留）/ revise（改）/ discard（弃）' };
    }
    if (!projectPath) return { success: false, error: 'recordDesignVerdict：当前没有打开的项目，无法记录' };
    const candidate = candidateFromUserVerdict({ verdict, why: params?.why, ref: params?.ref });
    if (!candidate) {
        return { success: false, error: 'recordDesignVerdict：请附一句「为什么」（why）——这句话就是校准评审器口味的种子' };
    }
    let ledger = await readLedger(invoke, projectPath);
    const outcome = addDesignLearningCandidate(ledger, candidate);
    ledger = decideDesignLearningCandidate(
        outcome.ledger,
        outcome.candidate.id,
        'published',
        '用户明确给出的留 / 改 / 弃反馈'
    );
    // 否决 = 负向行为结局：本次运行关联的观察候选记 rejected，试用知识一票回退（自主沉淀 P1）。
    if (verdict === 'discard' && runScope) {
        ledger = recordDesignRunOutcome(ledger, runScope, 'rejected').ledger;
    }
    const filePath = await writeLedger(invoke, projectPath, ledger);
    const published = ledger.candidates.find((item) => item.id === outcome.candidate.id);
    return {
        success: true,
        candidate: published,
        merged: outcome.merged,
        filePath,
        message: `已记下并发布为当前项目的评审校准：${outcome.candidate.text}`
    };
}

export async function executeGetDesignLearningTimeline(invoke: Invoke, projectPath: string | undefined, params: any): Promise<any> {
    if (!projectPath) return { success: false, error: 'getDesignLearningTimeline：当前没有打开的项目' };
    let ledger = await readLedger(invoke, projectPath);
    const decisionId = String(params?.decideId || '').trim();
    const decision = String(params?.decision || '').trim();
    if (decisionId && ['published', 'promoted', 'rejected'].includes(decision)) {
        try {
            const normalizedDecision = decision === 'promoted' ? 'published' : decision as 'published' | 'rejected';
            ledger = decideDesignLearningCandidate(ledger, decisionId, normalizedDecision, params?.note);
            await writeLedger(invoke, projectPath, ledger);
        } catch (error: any) {
            return {
                success: false,
                error: `学习候选处理失败：${error?.message || String(error)}`
            };
        }
    }
    const reviewable = listPromotableCandidates(ledger);
    return {
        success: true,
        timeline: renderDesignLearningTimeline(ledger, Number(params?.limit) > 0 ? Number(params.limit) : 30),
        reviewable: reviewable.slice(0, 10),
        /** 兼容旧调用方；含义已收紧为「值得送审」，不是可直接进入生产。 */
        promotable: reviewable.slice(0, 10),
        total: ledger.candidates.length,
        message: `学习候选区共 ${ledger.candidates.length} 条，${reviewable.length} 条值得送审；只有已发布的用户校准会进入评审器。`
    };
}
