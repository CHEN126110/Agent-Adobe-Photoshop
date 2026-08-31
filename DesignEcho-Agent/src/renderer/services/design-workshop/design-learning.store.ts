/**
 * 学习候选区的渲染进程门面：读 / 合并 / 写项目 .designecho/learning-candidates.json。
 * 自动观察与模型转述的「留 / 改 / 弃」都只写候选。生产发布必须由独立、可验证的
 * 用户审核入口完成；模型 Tool 与测试桥不能在这层签发 published 或改写 Skill 文件。
 */

import {
    addDesignLearningCandidate,
    applyAutoPromotionRules,
    curateProvisionalExperience,
    normalizeSkillImprovement,
    candidateFromUserVerdict,
    candidatesFromEvaluation,
    createDesignLearningLedger,
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

/**
 * Skill 手册改进提议只进入候选区，绝不直接写手册。独立的 UI-owned 审核与签名发布
 * 通道尚未实现；当前模型工具面不会暴露此能力，候选只能等待后续受审迁移。
 */
export async function executeProposeSkillImprovement(invoke: Invoke, projectPath: string | undefined, params: any): Promise<any> {
    if (!projectPath) return { success: false, error: 'proposeSkillImprovement：当前没有打开的项目，提议无处登记。' };
    const improvement = normalizeSkillImprovement({
        skillId: params?.skillId,
        file: params?.file,
        find: params?.find,
        replace: params?.replace
    });
    if (!improvement) {
        return { success: false, error: 'proposeSkillImprovement：提议不合格——需要 skillId（小写连字符）、file（SKILL.md 或 references/<名>.md）、find（现有原文片段）、replace（新文字），且 find≠replace。' };
    }
    const rationale = String(params?.rationale || '').trim();
    if (rationale.length < 12) {
        return { success: false, error: 'proposeSkillImprovement：请用 rationale 说清为什么要改（依据哪个样板文件的什么结构，至少一句完整的话）。' };
    }
    let ledger = await readLedger(invoke, projectPath);
    const outcome = addDesignLearningCandidate(ledger, {
        kind: 'skill_improvement',
        text: `【${improvement.skillId}/${improvement.file}】${rationale}`,
        evidence: Array.isArray(params?.evidence) ? params.evidence.map(String).slice(0, 6) : [],
        origin: 'reference_study',
        scope: { kind: 'project' },
        improvement
    });
    const filePath = await writeLedger(invoke, projectPath, outcome.ledger);
    return {
        success: true,
        candidateId: outcome.candidate.id,
        merged: outcome.merged,
        filePath,
        message: `手册改进提议已登记候选区（${improvement.skillId}/${improvement.file}）。它不会自动生效；独立用户审核入口尚未实现，当前不能发布或写入手册。`
    };
}

export async function executeRecordDesignVerdict(invoke: Invoke, projectPath: string | undefined, params: any): Promise<any> {
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
    ledger = outcome.ledger;
    const filePath = await writeLedger(invoke, projectPath, ledger);
    const recorded = ledger.candidates.find((item) => item.id === outcome.candidate.id);
    return {
        success: true,
        candidate: recorded,
        merged: outcome.merged,
        filePath,
        requiresUserReview: true,
        message: `已把这条留 / 改 / 弃反馈记入候选区，尚未发布为评审校准：${outcome.candidate.text}`
    };
}

export async function executeGetDesignLearningTimeline(invoke: Invoke, projectPath: string | undefined, params: any): Promise<any> {
    if (!projectPath) return { success: false, error: 'getDesignLearningTimeline：当前没有打开的项目' };
    const ledger = await readLedger(invoke, projectPath);
    const reviewable = listPromotableCandidates(ledger);
    return {
        success: true,
        timeline: renderDesignLearningTimeline(ledger, Number(params?.limit) > 0 ? Number(params.limit) : 30),
        reviewable: reviewable.slice(0, 10),
        /** 兼容旧调用方；含义已收紧为「值得送审」，不是可直接进入生产。 */
        promotable: reviewable.slice(0, 10),
        total: ledger.candidates.length,
        readOnly: true,
        message: `学习候选区共 ${ledger.candidates.length} 条，${reviewable.length} 条值得送审；这个模型工具只读，不能发布 /驳回候选或改写 Skill。`
    };
}
