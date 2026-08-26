/**
 * 设计经验候选区：把「运行时观察」与「正式经验」隔离。
 *
 * 边界：
 * - Agent / 评审器 / 参考学习只能写 candidate；候选不进入任何生产提示词或评审校准。
 * - 用户明确的留 / 改 / 弃可以发布为当前项目的 evaluation_calibration。
 * - 原则、配方、Skill 草案和事实不能在在线运行里自行发布；新参考学习走既有长期知识人工审核队列，
 *   本账本中的同类只为 v1 历史兼容保留。
 * - Harness 只负责候选的生命周期、版本、作用域与发布记录，不拥有经验正文。
 *
 * 纯逻辑、无 IO。项目落盘位置为 `.designecho/learning-candidates.json`。
 */

export type DesignLearningCandidateKind =
    | 'evaluation_finding'
    | 'principle'
    | 'recipe'
    | 'calibration_sample'
    | 'skill_draft'
    // Agent 从样板 PSD 推理出的 skill 手册改进提议（2026-08-24）：只进候选，用户批准后才由 Harness 写入。
    | 'skill_improvement'
    | 'fact';

/** skill 手册改进提议的载荷：精确的查找替换 + 证据；写入由主进程原子执行（备份可回滚）。 */
export interface SkillImprovementProposal {
    /** skill 包 id（如 sku-production）。 */
    skillId: string;
    /** 目标文件：'SKILL.md' 或 'references/<name>.md'。 */
    file: string;
    /** 现有原文片段（精确匹配；找不到写入拒绝，不做模糊替换）。 */
    find: string;
    /** 替换后的文字。 */
    replace: string;
}
export type DesignLearningCandidateStatus = 'candidate' | 'provisional' | 'published' | 'rejected';

/** 运行结局（行为事实）：稿件被导出交付 = 正向；被用户否决 = 负向。晋升验证的唯一依据。 */
export interface DesignLearningRunOutcome {
    kind: 'delivered' | 'rejected';
    runScope: string;
    at: number;
}
export type DesignLearningCandidateOrigin =
    | 'evaluation_model'
    | 'reference_study'
    | 'user_feedback'
    | 'manual_review'
    | 'legacy';
export type DesignExperienceScopeKind = 'project' | 'user' | 'brand' | 'global';
export type DesignExperiencePublicationTarget =
    | 'evaluation_calibration'
    | 'design_memory'
    | 'design_knowledge'
    | 'design_recipe'
    | 'skill_patch'
    | 'project_fact'
    | 'engineering_issue';

export interface DesignExperienceScope {
    kind: DesignExperienceScopeKind;
    /** project 文件内默认不重复保存绝对路径；跨项目 / 品牌发布时才需要稳定 id。 */
    id?: string;
}

export interface DesignEvaluationCalibration {
    verdict: 'keep' | 'revise' | 'discard';
    polarity: 'good' | 'bad';
    rationale: string;
    ref?: string;
}

export interface DesignExperiencePublication {
    version: 'design-experience-publication/v1';
    target: DesignExperiencePublicationTarget;
    scope: DesignExperienceScope;
    publisher: {
        kind: 'user' | 'human_reviewer' | 'offline_publisher' | 'system_migration';
        id?: string;
    };
    sourceCandidateId: string;
    publishedAt: number;
}

export interface DesignLearningCandidate {
    id: string;
    kind: DesignLearningCandidateKind;
    /** 观察或建议本身；不因进入候选区就变成通用原则。 */
    text: string;
    /** 来源证据：运行 id / 评审摘要 / 用户原话 / 参考来源。 */
    evidence: string[];
    /** 同一作用域里重复出现的次数，仅用于排序，不自动授予发布资格。 */
    support: number;
    status: DesignLearningCandidateStatus;
    origin: DesignLearningCandidateOrigin;
    scope: DesignExperienceScope;
    calibration?: DesignEvaluationCalibration;
    /** kind='skill_improvement' 时的结构化提议；批准后由主进程按此执行写入。 */
    improvement?: SkillImprovementProposal;
    publication?: DesignExperiencePublication;
    /** 关联运行的行为结局（导出交付 / 用户否决）；自动晋升规则的验证依据。 */
    outcomes?: DesignLearningRunOutcome[];
    createdAt: number;
    updatedAt: number;
    /** 驳回 / 发布 / 迁移时的人话说明。 */
    decisionNote?: string;
}

export interface DesignLearningLedger {
    version: 'design-learning-candidates/v2';
    candidates: DesignLearningCandidate[];
    updatedAt: number;
}

export interface DesignLearningCandidateInput {
    kind: DesignLearningCandidateKind;
    text: string;
    evidence?: string | string[];
    origin?: DesignLearningCandidateOrigin;
    scope?: DesignExperienceScope;
    calibration?: DesignEvaluationCalibration;
    /** kind='skill_improvement' 时必带（已经 normalizeSkillImprovement 归一）。 */
    improvement?: SkillImprovementProposal;
}

function normalizeText(value: unknown): string {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeEvidence(value: unknown): string[] {
    const raw = Array.isArray(value) ? value : [value];
    return raw.map(normalizeText).filter(Boolean).slice(0, 12);
}

function normalizeScope(value: unknown): DesignExperienceScope {
    if (!value || typeof value !== 'object') return { kind: 'project' };
    const raw = value as Record<string, unknown>;
    const kind = normalizeText(raw.kind);
    const valid: DesignExperienceScopeKind[] = ['project', 'user', 'brand', 'global'];
    const resolvedKind = valid.includes(kind as DesignExperienceScopeKind)
        ? kind as DesignExperienceScopeKind
        : 'project';
    const id = normalizeText(raw.id);
    return id ? { kind: resolvedKind, id } : { kind: resolvedKind };
}

function scopeKey(scope: DesignExperienceScope): string {
    return `${scope.kind}:${scope.id || ''}`;
}

function keyOf(kind: string, text: string, scope: DesignExperienceScope): string {
    const normalized = normalizeText(text).replace(/[，。；、,.;!！?？「」“”"']/g, '').toLowerCase();
    return `${scopeKey(scope)}:${kind}:${normalized}`;
}

function isCandidateKind(value: string): value is DesignLearningCandidateKind {
    return [
        'evaluation_finding',
        'principle',
        'recipe',
        'calibration_sample',
        'skill_draft',
        'skill_improvement',
        'fact'
    ].includes(value);
}

const SAFE_SKILL_FILE = /^(?:SKILL\.md|references\/[a-z0-9][a-z0-9-]{0,63}\.md)$/;

/** skill 改进提议载荷归一：字段缺失或文件路径不合法则整体丢弃（该候选不合格）。 */
export function normalizeSkillImprovement(raw: unknown): SkillImprovementProposal | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const value = raw as Record<string, unknown>;
    const skillId = String(value.skillId || '').trim().toLowerCase();
    const file = String(value.file || '').trim();
    const find = String(value.find || '');
    const replace = String(value.replace || '');
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(skillId)) return undefined;
    if (!SAFE_SKILL_FILE.test(file)) return undefined;
    if (!find.trim() || !replace.trim() || find === replace) return undefined;
    return { skillId, file, find, replace };
}

function inferLegacyOrigin(kind: DesignLearningCandidateKind, evidence: string[]): DesignLearningCandidateOrigin {
    if (evidence.some((item) => item === 'user' || item.startsWith('user:'))) return 'user_feedback';
    if (evidence.some((item) => item.startsWith('run:') || item.startsWith('deliverable:'))) return 'evaluation_model';
    if (evidence.some((item) => item.startsWith('file:') || item.startsWith('purpose:'))) return 'reference_study';
    if (kind === 'evaluation_finding') return 'evaluation_model';
    return 'legacy';
}

function normalizeCalibration(value: unknown, text: string): DesignEvaluationCalibration | undefined {
    if (value && typeof value === 'object') {
        const raw = value as Record<string, unknown>;
        const verdict = normalizeText(raw.verdict);
        const polarity = normalizeText(raw.polarity);
        const rationale = normalizeText(raw.rationale);
        if (
            ['keep', 'revise', 'discard'].includes(verdict)
            && ['good', 'bad'].includes(polarity)
            && rationale
        ) {
            const ref = normalizeText(raw.ref);
            return {
                verdict: verdict as DesignEvaluationCalibration['verdict'],
                polarity: polarity as DesignEvaluationCalibration['polarity'],
                rationale,
                ...(ref ? { ref } : {})
            };
        }
    }
    const match = normalizeText(text).match(/^(好|差|改|弃|不行)[：:]\s*(.+)$/u);
    if (!match) return undefined;
    let verdict: DesignEvaluationCalibration['verdict'] = 'revise';
    if (match[1] === '好') verdict = 'keep';
    if (match[1] === '差' || match[1] === '弃' || match[1] === '不行') verdict = 'discard';
    return {
        verdict,
        polarity: verdict === 'keep' ? 'good' : 'bad',
        rationale: normalizeText(match[2])
    };
}

function normalizeOrigin(value: unknown, kind: DesignLearningCandidateKind, evidence: string[]): DesignLearningCandidateOrigin {
    const raw = normalizeText(value);
    const valid: DesignLearningCandidateOrigin[] = [
        'evaluation_model',
        'reference_study',
        'user_feedback',
        'manual_review',
        'legacy'
    ];
    if (valid.includes(raw as DesignLearningCandidateOrigin)) return raw as DesignLearningCandidateOrigin;
    return inferLegacyOrigin(kind, evidence);
}

function normalizePublication(value: unknown, candidateId: string): DesignExperiencePublication | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const raw = value as Record<string, any>;
    const targets: DesignExperiencePublicationTarget[] = [
        'evaluation_calibration',
        'design_memory',
        'design_knowledge',
        'design_recipe',
        'skill_patch',
        'project_fact',
        'engineering_issue'
    ];
    const target = normalizeText(raw.target) as DesignExperiencePublicationTarget;
    const publisherKind = normalizeText(raw.publisher?.kind);
    if (!targets.includes(target)) return undefined;
    if (!['user', 'human_reviewer', 'offline_publisher', 'system_migration'].includes(publisherKind)) return undefined;
    const publishedAt = Number(raw.publishedAt);
    return {
        version: 'design-experience-publication/v1',
        target,
        scope: normalizeScope(raw.scope),
        publisher: {
            kind: publisherKind as DesignExperiencePublication['publisher']['kind'],
            ...(normalizeText(raw.publisher?.id) ? { id: normalizeText(raw.publisher.id) } : {})
        },
        sourceCandidateId: normalizeText(raw.sourceCandidateId) || candidateId,
        publishedAt: Number.isFinite(publishedAt) && publishedAt > 0 ? publishedAt : Date.now()
    };
}

/**
 * 读取边界兼容 v1：旧 `promoted` 不再被无条件信任。
 * 只有能够证明来自用户原话的校准样本迁移为已发布；其余降回候选等待正式发布器。
 */
export function normalizeDesignLearningLedger(value: unknown, now: number = Date.now()): DesignLearningLedger {
    if (!value || typeof value !== 'object') return createDesignLearningLedger(now);
    const rawLedger = value as Record<string, any>;
    const rawCandidates = Array.isArray(rawLedger.candidates) ? rawLedger.candidates : [];
    const candidates: DesignLearningCandidate[] = [];
    for (const rawValue of rawCandidates) {
        if (!rawValue || typeof rawValue !== 'object') continue;
        const raw = rawValue as Record<string, any>;
        const text = normalizeText(raw.text);
        const rawKind = normalizeText(raw.kind);
        if (!text || !isCandidateKind(rawKind)) continue;
        const evidence = normalizeEvidence(raw.evidence);
        const origin = normalizeOrigin(raw.origin, rawKind, evidence);
        const scope = normalizeScope(raw.scope);
        const id = normalizeText(raw.id) || `lc-${now.toString(36)}-${Math.abs(hash(keyOf(rawKind, text, scope))).toString(36)}`;
        const calibration = rawKind === 'calibration_sample'
            ? normalizeCalibration(raw.calibration, text)
            : undefined;
        const improvement = rawKind === 'skill_improvement'
            ? normalizeSkillImprovement(raw.improvement)
            : undefined;
        if (rawKind === 'skill_improvement' && !improvement) continue;
        const publication = normalizePublication(raw.publication, id);
        const legacyPromoted = raw.status === 'promoted';
        const userCalibrationCanMigrate = legacyPromoted
            && rawKind === 'calibration_sample'
            && origin === 'user_feedback'
            && Boolean(calibration);
        let status: DesignLearningCandidateStatus = 'candidate';
        if (raw.status === 'rejected') status = 'rejected';
        if (raw.status === 'provisional') status = 'provisional';
        if (raw.status === 'published' && publication) status = 'published';
        if (userCalibrationCanMigrate) status = 'published';
        const outcomes: DesignLearningRunOutcome[] = (Array.isArray(raw.outcomes) ? raw.outcomes : [])
            .map((item: any) => ({
                kind: item?.kind === 'rejected' ? 'rejected' as const : 'delivered' as const,
                runScope: normalizeText(item?.runScope),
                at: Number(item?.at) || now
            }))
            .filter((item: DesignLearningRunOutcome) => item.runScope.length > 0)
            .slice(0, 24);
        const createdAt = Number(raw.createdAt);
        const updatedAt = Number(raw.updatedAt);
        const migratedPublication: DesignExperiencePublication | undefined = userCalibrationCanMigrate
            ? {
                version: 'design-experience-publication/v1',
                target: 'evaluation_calibration',
                scope,
                publisher: { kind: 'system_migration' },
                sourceCandidateId: id,
                publishedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : now
            }
            : undefined;
        let decisionNote = normalizeText(raw.decisionNote) || undefined;
        if (legacyPromoted && !userCalibrationCanMigrate) {
            decisionNote = decisionNote
                ? `${decisionNote}；旧版转正记录缺少可验证发布来源，已迁回候选`
                : '旧版转正记录缺少可验证发布来源，已迁回候选';
        }
        candidates.push({
            id,
            kind: rawKind,
            text,
            evidence,
            support: Math.max(1, Math.floor(Number(raw.support) || 1)),
            status,
            origin,
            scope,
            ...(calibration ? { calibration } : {}),
            ...(improvement ? { improvement } : {}),
            ...(publication || migratedPublication ? { publication: publication || migratedPublication } : {}),
            ...(outcomes.length > 0 ? { outcomes } : {}),
            createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : now,
            updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : now,
            ...(decisionNote ? { decisionNote } : {})
        });
    }
    const updatedAt = Number(rawLedger.updatedAt);
    return {
        version: 'design-learning-candidates/v2',
        candidates,
        updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : now
    };
}

export function createDesignLearningLedger(now: number = Date.now()): DesignLearningLedger {
    return { version: 'design-learning-candidates/v2', candidates: [], updatedAt: now };
}

/** 同 kind、同作用域、同文本只在 candidate 状态合并；已发布记录保持不可变。 */
export function addDesignLearningCandidate(
    sourceLedger: DesignLearningLedger,
    input: DesignLearningCandidateInput,
    now: number = Date.now()
): { ledger: DesignLearningLedger; candidate: DesignLearningCandidate; merged: boolean } {
    const ledger = normalizeDesignLearningLedger(sourceLedger, now);
    const text = normalizeText(input.text);
    if (!text) throw new Error('学习候选不能为空');
    const evidence = normalizeEvidence(input.evidence);
    const scope = normalizeScope(input.scope);
    const origin = input.origin || 'legacy';
    const key = `${origin}:${keyOf(input.kind, text, scope)}`;
    // provisional（试用）候选再次被观察到时继续合并累计，避免同一观察分裂成重复条目。
    const existing = ledger.candidates.find((item) => (
        (item.status === 'candidate' || item.status === 'provisional')
        && item.origin === origin
        && `${item.origin}:${keyOf(item.kind, item.text, item.scope)}` === key
    ));
    if (existing) {
        const merged: DesignLearningCandidate = {
            ...existing,
            support: existing.support + 1,
            evidence: Array.from(new Set([...existing.evidence, ...evidence])).slice(0, 12),
            updatedAt: now
        };
        return {
            ledger: {
                ...ledger,
                updatedAt: now,
                candidates: ledger.candidates.map((item) => (item.id === existing.id ? merged : item))
            },
            candidate: merged,
            merged: true
        };
    }
    const candidate: DesignLearningCandidate = {
        id: `lc-${now.toString(36)}-${Math.abs(hash(key)).toString(36)}`,
        kind: input.kind,
        text,
        evidence,
        support: 1,
        status: 'candidate',
        origin,
        scope,
        ...(input.calibration ? { calibration: input.calibration } : {}),
        ...(input.improvement ? { improvement: input.improvement } : {}),
        createdAt: now,
        updatedAt: now
    };
    return {
        ledger: { ...ledger, updatedAt: now, candidates: [...ledger.candidates, candidate] },
        candidate,
        merged: false
    };
}

function publishUserCalibrationCandidate(
    ledger: DesignLearningLedger,
    id: string,
    note: string | undefined,
    now: number
): DesignLearningLedger {
    const candidate = ledger.candidates.find((item) => item.id === id);
    if (!candidate) throw new Error(`找不到学习候选 ${id}`);
    if (candidate.status !== 'candidate') throw new Error(`学习候选 ${id} 当前状态是 ${candidate.status}，不能重复发布`);
    const isUserCalibration = candidate.kind === 'calibration_sample'
        && candidate.origin === 'user_feedback'
        && Boolean(candidate.calibration);
    // skill 改进提议的发布同样是用户人工拍板（时间线批准点击），与校准同级；写入由主进程另行执行。
    const isSkillImprovement = candidate.kind === 'skill_improvement' && Boolean(candidate.improvement);
    if (!isUserCalibration && !isSkillImprovement) {
        throw new Error('在线运行只允许发布用户明确给出的留 / 改 / 弃校准或用户批准的 skill 改进；原则、配方和模型观察必须经过离线评测与人审发布器');
    }
    const published: DesignLearningCandidate = {
        ...candidate,
        status: 'published',
        decisionNote: normalizeText(note) || (isSkillImprovement ? '用户批准，手册改进已写入' : '用户明确反馈，发布为当前项目评审校准'),
        publication: {
            version: 'design-experience-publication/v1',
            target: isSkillImprovement ? 'skill_patch' : 'evaluation_calibration',
            scope: candidate.scope,
            publisher: { kind: 'user' },
            sourceCandidateId: candidate.id,
            publishedAt: now
        },
        updatedAt: now
    };
    return {
        ...ledger,
        updatedAt: now,
        candidates: ledger.candidates.map((item) => (item.id === id ? published : item))
    };
}

export function decideDesignLearningCandidate(
    sourceLedger: DesignLearningLedger,
    id: string,
    decision: 'published' | 'promoted' | 'rejected',
    note?: string,
    now: number = Date.now()
): DesignLearningLedger {
    const ledger = normalizeDesignLearningLedger(sourceLedger, now);
    if (decision === 'published' || decision === 'promoted') {
        return publishUserCalibrationCandidate(ledger, id, note, now);
    }
    const found = ledger.candidates.some((item) => item.id === id);
    if (!found) throw new Error(`找不到学习候选 ${id}`);
    return {
        ...ledger,
        updatedAt: now,
        candidates: ledger.candidates.map((item) => {
            if (item.id !== id) return item;
            return {
                ...item,
                status: 'rejected',
                publication: undefined,
                decisionNote: normalizeText(note) || '已驳回',
                updatedAt: now
            };
        })
    };
}

/**
 * 运行结局回写（行为事实验证层，2026-08-23 自主沉淀 P1）：
 * 把导出交付 / 用户否决的结局写到 evidence 里带 `run:<scope>` 标记的候选上。
 * 负向结局对 provisional 一票回退——试用知识关联到被否决的稿子就退回候选。
 */
export function recordDesignRunOutcome(
    sourceLedger: DesignLearningLedger,
    runScope: string,
    outcomeKind: DesignLearningRunOutcome['kind'],
    now: number = Date.now()
): { ledger: DesignLearningLedger; touched: number } {
    const ledger = normalizeDesignLearningLedger(sourceLedger, now);
    const scopeTag = `run:${normalizeText(runScope)}`;
    if (scopeTag === 'run:') return { ledger, touched: 0 };
    let touched = 0;
    const candidates = ledger.candidates.map((item) => {
        if (item.status !== 'candidate' && item.status !== 'provisional') return item;
        if (!item.evidence.includes(scopeTag)) return item;
        const existingOutcomes = item.outcomes || [];
        const alreadyRecorded = existingOutcomes.some(
            (outcome) => outcome.runScope === normalizeText(runScope) && outcome.kind === outcomeKind
        );
        if (alreadyRecorded) return item;
        touched += 1;
        const outcomes = [...existingOutcomes, { kind: outcomeKind, runScope: normalizeText(runScope), at: now }].slice(-24);
        if (outcomeKind === 'rejected' && item.status === 'provisional') {
            return {
                ...item,
                status: 'candidate' as const,
                outcomes,
                decisionNote: '试用知识关联稿件被用户否决，已退回候选。',
                updatedAt: now
            };
        }
        return { ...item, outcomes, updatedAt: now };
    });
    return { ledger: touched > 0 ? { ...ledger, updatedAt: now, candidates } : ledger, touched };
}

/**
 * 保守自动晋升（晋升层，2026-08-23 自主沉淀 P1）：观察在 ≥3 次评审中重复、来自 ≥2 次不同运行、
 * 关联稿件 ≥1 次导出交付且 0 次否决 → provisional 试用。依据全部是 Harness 采集的确定性行为事实，
 * 不是模型自评；provisional 不进入任何生产消费面（消费在 P2 单独治理），转正与回退仍受本账本管辖。
 */
export function applyAutoPromotionRules(
    sourceLedger: DesignLearningLedger,
    now: number = Date.now()
): { ledger: DesignLearningLedger; promoted: DesignLearningCandidate[] } {
    const ledger = normalizeDesignLearningLedger(sourceLedger, now);
    const promoted: DesignLearningCandidate[] = [];
    const candidates = ledger.candidates.map((item) => {
        if (item.status !== 'candidate' || item.kind !== 'evaluation_finding') return item;
        if (item.support < 3) return item;
        const runTags = new Set(item.evidence.filter((entry) => entry.startsWith('run:')));
        if (runTags.size < 2) return item;
        const outcomes = item.outcomes || [];
        const delivered = outcomes.filter((outcome) => outcome.kind === 'delivered').length;
        const rejected = outcomes.filter((outcome) => outcome.kind === 'rejected').length;
        if (delivered < 1 || rejected > 0) return item;
        const next: DesignLearningCandidate = {
            ...item,
            status: 'provisional',
            decisionNote: `行为事实达标自动进入试用：${item.support} 次观察 / ${runTags.size} 次运行 / ${delivered} 次交付 / 0 次否决。`,
            updatedAt: now
        };
        promoted.push(next);
        return next;
    });
    return {
        ledger: promoted.length > 0 ? { ...ledger, updatedAt: now, candidates } : ledger,
        promoted
    };
}

/** 试用知识总量上限（P3 有界策展）：超出按支持度淘汰最弱，防无界记忆自我中毒。 */
export const PROVISIONAL_EXPERIENCE_CAP = 10;
/** 试用知识时间衰减窗口：超过该时长没有任何新支持/新结局，降回候选重新积累资格。 */
export const PROVISIONAL_STALE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * 自主沉淀 P3（2026-08-24）：有界策展。三条确定性规则，全部可逆（降级不删除，证据保留）：
 * ① 时间衰减：provisional 超过 30 天无更新 → 降回 candidate（decisionNote 记因）；
 * ② 总量上限：provisional 超过 10 条 → 按 support 升序把最弱的降回 candidate；
 * ③ 劣化回退由 recordDesignRunOutcome 的否决一票回退承担（已有）。
 * 挂在晋升之后调用；只动 provisional，published（用户拍板）永不被自动策展。
 */
export function curateProvisionalExperience(
    sourceLedger: DesignLearningLedger,
    now: number = Date.now()
): { ledger: DesignLearningLedger; demoted: DesignLearningCandidate[] } {
    const ledger = normalizeDesignLearningLedger(sourceLedger, now);
    const demoted: DesignLearningCandidate[] = [];
    let candidates = ledger.candidates.map((item) => {
        if (item.status !== 'provisional') return item;
        if (now - item.updatedAt <= PROVISIONAL_STALE_MS) return item;
        const next: DesignLearningCandidate = {
            ...item,
            status: 'candidate',
            decisionNote: '试用超过 30 天没有新的支持或交付结局，降回候选重新积累资格。',
            updatedAt: now
        };
        demoted.push(next);
        return next;
    });
    const provisional = candidates
        .filter((item) => item.status === 'provisional')
        .sort((a, b) => (a.support || 0) - (b.support || 0) || a.updatedAt - b.updatedAt);
    const overflow = provisional.length - PROVISIONAL_EXPERIENCE_CAP;
    if (overflow > 0) {
        const demoteIds = new Set(provisional.slice(0, overflow).map((item) => item.id));
        candidates = candidates.map((item) => {
            if (!demoteIds.has(item.id)) return item;
            const next: DesignLearningCandidate = {
                ...item,
                status: 'candidate',
                decisionNote: `试用总量超过上限 ${PROVISIONAL_EXPERIENCE_CAP} 条，按支持度淘汰最弱，降回候选。`,
                updatedAt: now
            };
            demoted.push(next);
            return next;
        });
    }
    return {
        ledger: demoted.length > 0 ? { ...ledger, updatedAt: now, candidates } : ledger,
        demoted
    };
}

/** 值得进入人工 / 离线评测队列，不等于可以直接注入生产上下文。 */
export function listPromotableCandidates(sourceLedger: DesignLearningLedger): DesignLearningCandidate[] {
    const ledger = normalizeDesignLearningLedger(sourceLedger);
    return ledger.candidates
        .filter((item) => {
            if (item.status !== 'candidate') return false;
            if (item.kind === 'fact') return false;
            if (item.kind === 'calibration_sample') {
                return item.origin === 'user_feedback' && Boolean(item.calibration);
            }
            return item.support >= 2;
        })
        .sort((a, b) => b.support - a.support || b.updatedAt - a.updatedAt);
}

/** 生产评审器唯一允许读取的经验出口：已发布到 evaluation_calibration 的结构化样本。 */
/**
 * 自主沉淀 P2（2026-08-24）：行为验证晋升的试用经验进入评审上下文的唯一出口。
 * 只回 provisional（≥3 次任务重复 + 关联稿件 ≥1 次交付 + 0 否决的行为事实验证），
 * 上限默认 3 条、按支持度降序；消费端必须标注「非用户拍板，仅作观察线索」。
 */
export function listProvisionalExperienceNotes(
    sourceLedger: DesignLearningLedger,
    limit: number = 3
): string[] {
    const ledger = normalizeDesignLearningLedger(sourceLedger);
    return ledger.candidates
        .filter((item) => item.status === 'provisional' && item.kind === 'evaluation_finding')
        .sort((a, b) => (b.support || 0) - (a.support || 0))
        .slice(0, Math.max(0, limit))
        .map((item) => item.text);
}

export function listPublishedEvaluationCalibrationSamples(
    sourceLedger: DesignLearningLedger,
    limit: number = 10
): Array<{ kind: 'good' | 'bad'; why: string; ref?: string }> {
    const ledger = normalizeDesignLearningLedger(sourceLedger);
    return ledger.candidates
        .filter((item) => (
            item.status === 'published'
            && item.kind === 'calibration_sample'
            && item.publication?.target === 'evaluation_calibration'
            && Boolean(item.calibration)
        ))
        .sort((a, b) => (b.publication?.publishedAt || 0) - (a.publication?.publishedAt || 0))
        .slice(0, Math.max(0, limit))
        .map((item) => ({
            kind: item.calibration!.polarity,
            why: item.calibration!.rationale,
            ...(item.calibration!.ref ? { ref: item.calibration!.ref } : {})
        }));
}

/** 评审模型的批评只是一次观察，不能自动改写成通用设计原则。 */
export function candidatesFromEvaluation(input: {
    critiques: string[];
    runId?: string;
    deliverable?: string;
}): DesignLearningCandidateInput[] {
    const evidence = [
        input.runId ? `run:${input.runId}` : '',
        input.deliverable ? `deliverable:${input.deliverable}` : ''
    ].filter(Boolean);
    return input.critiques
        .map(normalizeText)
        .filter((text) => text.length >= 6)
        .slice(0, 5)
        .map((text) => ({
            kind: 'evaluation_finding',
            text,
            evidence,
            origin: 'evaluation_model',
            scope: { kind: 'project' }
        }));
}

/** 用户「留 / 改 / 弃」是明确的项目口味事实，可由记录入口立即发布为项目评审校准。 */
export function candidateFromUserVerdict(input: {
    verdict: 'keep' | 'revise' | 'discard';
    why?: string;
    ref?: string;
}): DesignLearningCandidateInput | null {
    const why = normalizeText(input.why);
    if (!why) return null;
    let label = '改';
    if (input.verdict === 'keep') label = '好';
    if (input.verdict === 'discard') label = '差';
    const ref = normalizeText(input.ref);
    return {
        kind: 'calibration_sample',
        text: `${label}：${why}`,
        evidence: ['user', ...(ref ? [`ref:${ref}`] : [])],
        origin: 'user_feedback',
        scope: { kind: 'project' },
        calibration: {
            verdict: input.verdict,
            polarity: input.verdict === 'keep' ? 'good' : 'bad',
            rationale: why,
            ...(ref ? { ref } : {})
        }
    };
}

export function renderDesignLearningTimeline(sourceLedger: DesignLearningLedger, limit: number = 30): string {
    const ledger = normalizeDesignLearningLedger(sourceLedger);
    const items = [...ledger.candidates].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
    if (items.length === 0) return '还没有学到东西（候选区为空）。';
    const mark: Record<DesignLearningCandidateStatus, string> = { candidate: '◐', provisional: '◑', published: '★', rejected: '✕' };
    return items.map((item) => {
        const publication = item.publication ? ` → ${item.publication.target}/${item.publication.scope.kind}` : '';
        const note = item.decisionNote ? ` — ${item.decisionNote}` : '';
        return `${mark[item.status]} [${item.kind}] ${item.text}（×${item.support}）${publication}${note}`;
    }).join('\n');
}

function hash(input: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < input.length; i += 1) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h | 0;
}
