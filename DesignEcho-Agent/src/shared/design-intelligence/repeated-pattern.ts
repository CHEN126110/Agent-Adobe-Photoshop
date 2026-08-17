/**
 * Design Intelligence · Repeated Pattern → Candidate（Phase 5）
 *
 * 路线图依据：docs/design-intelligence-knowledge-system-roadmap-draft.md
 *   §17 Post-Task Learning / §17.1 不直接写知识 / Phase 5 Design Feedback Learning Loop
 *
 * 职责：纯逻辑把一批 LearningEvent 聚合成「重复模式」，并生成候选知识提案
 *       （如「最近 8 个任务中出现 6 次相同修改」）。生成的候选是 pending 状态，
 *       Agent 无权自行升级，必须经用户 Review Gate。
 *
 * 边界：
 * - 只生成 Candidate（propose_candidate），不直接写正式知识。
 * - 「Agent 修改了什么」被接受且重复发生才足以沉淀为候选；单次反馈不自动升级为全局规则。
 * - 纯契约 + 纯函数，无 IO。
 */

import type { LearningEvent, LearningEventSource } from './learning-event.types';
import type { EvidenceRef } from './evidence.types';
import type { CandidateKnowledge, CandidateOrigin } from './candidate.types';

/** 重复模式检测的输入选项。 */
export interface RepeatedPatternOptions {
    /** 判定重复的最小事件数，默认 3 */
    minCount?: number;
    /** 判定重复的最小重复率（count / 窗口事件数），默认 0.5 */
    minRatio?: number;
}

/** 一个被检测到的重复模式。 */
export interface RepeatedPattern {
    /** 规范化后的模式键（用于归并同一类修改） */
    patternKey: string;
    /** 命中的事件 id */
    eventIds: string[];
    /** 事件来源（task_feedback / critic 等） */
    source: LearningEventSource;
    /** 生成的候选知识（pending，未升级） */
    proposedCandidate: CandidateKnowledge;
}

/** 把一条学习事件归一化成模式键：提取「任务类型 + 修改动作」，忽略具体措辞。 */
export function normalizePatternKey(event: Pick<LearningEvent, 'description' | 'taskId'>): string {
    // 取描述中核心动词短语（中文/英文词），去掉数量词与编号
    const tokens = (event.description.match(/[\u4e00-\u9fa5]{2,}|[a-z]{3,}/gi) ?? [])
        .join(' ')
        .toLowerCase();
    return tokens;
}

/** 判断一条事件是否「被接受」——accepted 三态中仅显式 true 视为接受。 */
function isAccepted(event: LearningEvent): boolean {
    return event.accepted === true;
}

/**
 * 检测重复模式：统计相同 patternKey 的事件，数量 ≥ minCount 且占比 ≥ minRatio 时，
 * 生成一条 propose_candidate 候选。仅统计「被接受或未显式拒绝」的事件，避免把用户不满沉淀为规则。
 */
export function detectRepeatedPatterns(
    events: readonly LearningEvent[],
    options: RepeatedPatternOptions = {}
): RepeatedPattern[] {
    const minCount = options.minCount ?? 3;
    const minRatio = options.minRatio ?? 0.5;

    const byKey = new Map<string, LearningEvent[]>();
    for (const event of events) {
        if (event.status === 'dismissed') continue;
        if (event.accepted === false) continue; // 用户显式拒绝 → 不沉淀
        const key = normalizePatternKey(event);
        if (!key) continue;
        const list = byKey.get(key) ?? [];
        list.push(event);
        byKey.set(key, list);
    }

    const result: RepeatedPattern[] = [];
    for (const [patternKey, list] of byKey) {
        if (list.length < minCount) continue;
        const ratio = list.length / events.length;
        if (ratio < minRatio) continue;

        const source = list[0].source;
        const origin: CandidateOrigin = source === 'critic' ? 'critic' : 'task_feedback';
        const eventIds = list.map((e) => e.id);

        const evidenceRefs: EvidenceRef[] = list
            .map((e) => e.evidenceRefs)
            .flat()
            .map((ref, i) => ({ ...ref, id: `${ref.id}-${i}` }));

        const proposedTitle = `重复模式：${patternKey}`;
        const proposedContent =
            `最近 ${events.length} 个任务中有 ${list.length} 次出现相同修改「${patternKey}」。` +
            `建议沉淀为可复用设计规则，但需经用户确认后才升级为 Validated。`;

        const proposedCandidate: CandidateKnowledge = {
            id: `cand-${patternKey.slice(0, 16)}-${Date.now()}`,
            proposedKind: 'rule',
            proposedTitle,
            proposedContent,
            evidenceRefs,
            generatedFrom: origin,
            confidence: Math.min(0.95, list.length / events.length + 0.5),
            decision: 'pending'
        };

        result.push({ patternKey, eventIds, source, proposedCandidate });
    }
    return result;
}
