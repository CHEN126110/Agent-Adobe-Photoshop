import type { DesignMemoryItem, DesignMemoryScope } from './design-memory-knowledge';

export type InteractiveCardVersion = 'interactive-card/v0';
export type InteractiveCardSubmissionVersion = 'interactive-card-submission/v0';
export type InteractiveCardMemoryMode = 'none' | 'approved_recipe' | 'approved_content';
export type InteractiveCardStatus = 'draft' | 'submitted' | 'cancelled';
export type InteractiveCardValidationSeverity = 'error' | 'warning';
export type InteractiveCardRunDisposition = 'blocks_execution' | 'post_execution_review';

export interface InteractiveCardSkillProviderOwner {
    type: 'skill-provider';
    skillId: string;
}

export interface InteractiveCardDecisionContext {
    /** 同一 TaskRun 中“正在向用户确认哪一类业务决定”的稳定身份。 */
    decisionFingerprint: string;
    /** 产卡时展示给用户的候选 / 草稿内容摘要。 */
    candidateFingerprint?: string;
    /** 用户提交后由领域 Provider 对规范化答案签发的摘要。 */
    answerFingerprint?: string;
}

export interface InteractiveCardValidationIssue {
    severity: InteractiveCardValidationSeverity;
    code: string;
    message: string;
    path?: string;
}

export interface InteractiveCardValidationResult<TValue = unknown> {
    valid: boolean;
    canSubmit: boolean;
    normalizedValue: TValue;
    issues: InteractiveCardValidationIssue[];
    blockers: string[];
    warnings: string[];
}

export interface InteractiveCardMemoryPolicy {
    enabled: boolean;
    mode: InteractiveCardMemoryMode;
    scope?: DesignMemoryScope;
    reviewRequired?: boolean;
}

export interface InteractiveCardDefinition<TPayload = unknown> {
    version: InteractiveCardVersion;
    id: string;
    kind: string;
    title: string;
    description?: string;
    payload: TPayload;
    /**
     * 业务卡片的领域 owner。通用卡不设置；Skill Provider 生成的卡必须设置，
     * continuation 会在暂停与恢复两端核对它，防止另一 Skill 借用相同 kind/payload。
     */
    interactionOwner?: InteractiveCardSkillProviderOwner;
    /**
     * Provider 对“正在向用户确认哪一个业务决定”的稳定指纹。
     * Harness 只比较相等性来识别同一 TaskRun 的无进展重问，不解释领域内容。
     */
    decisionFingerprint?: string;
    /** Provider 对当前候选内容的摘要；它与稳定的决定身份分离。 */
    candidateFingerprint?: string;
    /** 缺省为 blocks_execution；仅可信生产者可把产后发布复核声明为非阻塞。 */
    runDisposition?: InteractiveCardRunDisposition;
    status?: InteractiveCardStatus;
    submitAction?: string;
    memoryPolicy?: InteractiveCardMemoryPolicy;
}

export interface InteractiveCardSubmission<TValue = unknown> {
    version: InteractiveCardSubmissionVersion;
    cardId: string;
    kind: string;
    submittedAt: string;
    value: TValue;
    validation: InteractiveCardValidationResult<TValue>;
    decisionContext?: InteractiveCardDecisionContext;
    memoryCandidate?: DesignMemoryItem;
    execution?: {
        status: 'succeeded' | 'failed' | 'unknown';
        message?: string;
    };
}

export function cleanInteractiveCardText(value: unknown): string {
    return String(value || '')
        .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, '[redacted-image-payload]')
        .replace(/\b[A-Za-z]:[\\/][^\s"'，,；;]+/g, '[redacted-local-path]')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * A card definition id describes stable business content, not one rendered
 * submission opportunity. The same unresolved review state can legitimately
 * produce the same card id in a later Agent message. Scope the UI idempotency
 * guard to the source message/block so a rapid double click is still blocked
 * while a newly rendered card remains actionable.
 */
export function buildInteractiveCardSubmissionInstanceKey(input: {
    cardId?: unknown;
    sourceMessageId?: unknown;
    sourceBlockId?: unknown;
}): string {
    const cardId = cleanInteractiveCardText(input.cardId).slice(0, 240);
    if (!cardId) return '';
    const sourceMessageId = cleanInteractiveCardText(input.sourceMessageId).slice(0, 240);
    const sourceBlockId = cleanInteractiveCardText(input.sourceBlockId).slice(0, 240);
    if (!sourceMessageId && !sourceBlockId) return cardId;
    return [sourceMessageId || 'message-unknown', sourceBlockId || 'block-unknown', cardId].join('::');
}

export function stableInteractiveCardHash(value: unknown): string {
    const text = (() => {
        try {
            return JSON.stringify(value);
        } catch {
            return String(value || '');
        }
    })();
    let hash = 5381;
    for (let index = 0; index < text.length; index += 1) {
        hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
    }
    return Math.abs(hash).toString(36);
}

/**
 * 提交指纹只描述会影响业务执行的确认内容。
 * submittedAt / memoryCandidate 属于记录元数据；把它们纳入指纹会让同一确认在崩溃恢复后
 * 因时间戳变化被误判成另一笔操作，破坏幂等承接。
 */
export function buildInteractiveCardSubmissionFingerprint(
    submission: InteractiveCardSubmission
): string {
    return stableInteractiveCardHash({
        version: submission.version,
        cardId: submission.cardId,
        kind: submission.kind,
        value: submission.validation?.normalizedValue ?? submission.value,
        validation: {
            valid: submission.validation?.valid === true,
            canSubmit: submission.validation?.canSubmit === true
        },
        decisionContext: submission.decisionContext
    });
}

function normalizeInteractiveCardSubmittedAt(value: string | number | Date | undefined): string {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'number') return new Date(value).toISOString();
    return cleanInteractiveCardText(value) || new Date().toISOString();
}

export function buildInteractiveCardSubmission<TValue>(input: {
    card: InteractiveCardDefinition;
    value: TValue;
    validation: InteractiveCardValidationResult<TValue>;
    memoryCandidate?: DesignMemoryItem;
    answerFingerprint?: string;
    submittedAt?: string | number | Date;
}): InteractiveCardSubmission<TValue> {
    const submittedAt = normalizeInteractiveCardSubmittedAt(input.submittedAt);
    const decisionFingerprint = cleanInteractiveCardText(input.card.decisionFingerprint);
    const candidateFingerprint = cleanInteractiveCardText(input.card.candidateFingerprint);
    const answerFingerprint = cleanInteractiveCardText(input.answerFingerprint);
    const decisionContext = decisionFingerprint
        ? {
            decisionFingerprint,
            ...(candidateFingerprint ? { candidateFingerprint } : {}),
            ...(answerFingerprint ? { answerFingerprint } : {})
        }
        : undefined;
    return {
        version: 'interactive-card-submission/v0',
        cardId: input.card.id,
        kind: input.card.kind,
        submittedAt,
        value: input.value,
        validation: input.validation,
        ...(decisionContext ? { decisionContext } : {}),
        memoryCandidate: input.memoryCandidate
    };
}

export function buildInteractiveCardValidationResult<TValue>(input: {
    normalizedValue: TValue;
    issues?: InteractiveCardValidationIssue[];
}): InteractiveCardValidationResult<TValue> {
    const issues = Array.isArray(input.issues) ? input.issues : [];
    const blockers = issues
        .filter((issue) => issue.severity === 'error')
        .map((issue) => issue.message);
    const warnings = issues
        .filter((issue) => issue.severity === 'warning')
        .map((issue) => issue.message);
    return {
        valid: blockers.length === 0,
        canSubmit: blockers.length === 0,
        normalizedValue: input.normalizedValue,
        issues,
        blockers,
        warnings
    };
}
