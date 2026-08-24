/**
 * 「让用户帮我选」——Agent 拿不准时给用户列几个选项（用户 2026-08-19）。
 *
 * 一次可以问 1–3 个问题（设计师接需求时把只有客户才知道的事一次问完，不是做到一半才一个个冒出来）：
 * 每个问题 2–5 个选项。偏好问题必须给出 Agent 自己倾向的选项；事实与授权问题不得在自动模式下猜测。
 * 与 Skill 确认卡（冻结一个待执行 Skill 操作、提交后续接）不同：这里不保存业务操作参数，
 * 只是 Agent 把问题和选项摆出来、暂停一轮；用户点选后以结构化内部恢复继续原任务。
 * 决策模式：ask（默认，弹选项让用户选）/ auto（全自动，用户不在场：Agent 按自己倾向的继续，把选择和理由说给用户听）。
 *
 * 纯逻辑，无 IO。
 */

export type AgentDecisionMode = 'ask' | 'auto';

export type UserChoiceDecisionKind = 'preference' | 'required_fact' | 'approval';
export type UserChoiceImpact = 'material' | 'high';

export interface UserChoiceOption {
    id: string;
    label: string;
    /** 一句话：选它意味着什么 / 为什么可能是对的 */
    detail?: string;
}

export interface UserChoiceQuestion {
    id: string;
    /** preference 可由 Agent 在自动模式采用推荐项；事实与授权必须由用户回答。 */
    decisionKind: UserChoiceDecisionKind;
    /** 只有会实质改变结果或权限边界的问题才允许进入交互卡。 */
    impact: UserChoiceImpact;
    /** 问题本身（一句） */
    question: string;
    /** 为什么必须由用户决定，以及不同答案怎样影响结果。 */
    why: string;
    options: UserChoiceOption[];
    /** 只有 preference 必填；事实和授权不能用模型推荐冒充用户确认。 */
    recommendedId?: string;
}

export interface UserChoiceRequest {
    version: 'user-choice-request/v2';
    id: string;
    /** 一句开场（可选）：为什么现在要问这几件事 */
    intro?: string;
    questions: UserChoiceQuestion[];
    /** 允许用户不选选项、直接写一句 */
    allowFreeText: boolean;
    createdAt: number;
}

export interface UserChoiceRequestNormalization {
    ok: boolean;
    issues: string[];
    request?: UserChoiceRequest;
}

function clean(value: unknown): string {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeDecisionKind(value: unknown): UserChoiceDecisionKind | undefined {
    const kind = clean(value);
    if (kind === 'preference' || kind === 'required_fact' || kind === 'approval') return kind;
    return undefined;
}

function normalizeImpact(value: unknown): UserChoiceImpact | undefined {
    const impact = clean(value);
    if (impact === 'material' || impact === 'high') return impact;
    return undefined;
}

function normalizeQuestion(raw: any, index: number, issues: string[]): UserChoiceQuestion | null {
    const prefix = `questions[${index}]`;
    const decisionKind = normalizeDecisionKind(raw?.decisionKind);
    if (!decisionKind) {
        issues.push(`${prefix}.decisionKind：必须说明是 preference、required_fact 还是 approval`);
    }
    const impact = normalizeImpact(raw?.impact);
    if (!impact) {
        issues.push(`${prefix}.impact：只有会实质改变结果的 material / high 问题才应打断用户`);
    }
    const question = clean(raw?.question);
    if (question.length < 4) issues.push(`${prefix}.question：一句话把要用户帮忙定的事说清（如「主图用模特上脚图还是平铺图？」）`);
    const why = clean(raw?.why);
    if (why.length < 6) {
        issues.push(`${prefix}.why：说明为什么必须由用户决定，以及答案会怎样影响结果`);
    }
    const rawOptions: any[] = Array.isArray(raw?.options) ? raw.options : [];
    const options: UserChoiceOption[] = [];
    const seen = new Set<string>();
    rawOptions.forEach((item, optionIndex) => {
        const label = clean(typeof item === 'string' ? item : item?.label);
        if (!label) { issues.push(`${prefix}.options[${optionIndex}].label：不能为空`); return; }
        let id = clean(item?.id) || `opt-${optionIndex + 1}`;
        while (seen.has(id)) id = `${id}-${optionIndex}`;
        seen.add(id);
        const detail = clean(item?.detail || item?.why || item?.description);
        options.push({ id, label, ...(detail ? { detail } : {}) });
    });
    if (options.length < 2) issues.push(`${prefix}.options：至少给 2 个真实可选项（每项 label + 一句 detail 说明选它意味着什么）；只有一个答案就不用问`);
    if (options.length > 5) issues.push(`${prefix}.options：最多 5 个，多了用户也选不过来`);
    const recommendedRaw = clean(raw?.recommendedId || raw?.recommended);
    const recommendedId = recommendedRaw
        ? options.find((option) => option.id === recommendedRaw || option.label === recommendedRaw)?.id
        : undefined;
    if (recommendedRaw && !recommendedId) issues.push(`${prefix}.recommendedId：「${recommendedRaw}」不在 options 里`);
    if (decisionKind === 'preference' && !recommendedId) {
        issues.push(`${prefix}.recommendedId：偏好问题必须给出你倾向的选项，不能只把设计判断甩给用户`);
    }
    if (decisionKind !== 'preference' && recommendedRaw) {
        issues.push(`${prefix}.recommendedId：事实和授权必须由用户确认，不能预选模型推荐项`);
    }
    if (!decisionKind || !impact || !question || !why || options.length < 2) return null;
    return {
        id: clean(raw?.id) || `q-${index + 1}`,
        decisionKind,
        impact,
        question,
        why,
        options,
        ...(recommendedId ? { recommendedId } : {})
    };
}

/** 接受单问或多问（questions[]）；统一归成 1–3 个真正需要用户参与的问题。 */
export function normalizeUserChoiceRequest(params: any, now: number = Date.now()): UserChoiceRequestNormalization {
    const issues: string[] = [];
    const rawQuestions: any[] = Array.isArray(params?.questions) && params.questions.length > 0
        ? params.questions
        : [params];
    if (rawQuestions.length > 3) issues.push('questions：一次最多问 3 个；再多会增加沟通成本，只保留最影响结果且无法自行取得答案的');
    const questions: UserChoiceQuestion[] = [];
    const seenIds = new Set<string>();
    rawQuestions.slice(0, 3).forEach((raw, index) => {
        const normalized = normalizeQuestion(raw, index, issues);
        if (!normalized) return;
        while (seenIds.has(normalized.id)) normalized.id = `${normalized.id}-${index}`;
        seenIds.add(normalized.id);
        questions.push(normalized);
    });
    if (issues.length > 0 || questions.length === 0) return { ok: false, issues: issues.length ? issues : ['questions：至少一个问题'] };
    return {
        ok: true,
        issues,
        request: {
            version: 'user-choice-request/v2',
            id: `choice-${now.toString(36)}`,
            ...(clean(params?.intro) ? { intro: clean(params?.intro) } : {}),
            questions,
            allowFreeText: params?.allowFreeText !== false,
            createdAt: now
        }
    };
}

/** 自动模式只可替用户承担可逆的专业偏好判断；事实、授权仍必须等待用户。 */
export function canAutoResolveUserChoiceRequest(request: UserChoiceRequest): boolean {
    return request.questions.length > 0
        && request.questions.every((question) => (
            question.decisionKind === 'preference'
            && Boolean(question.recommendedId)
        ));
}

export interface UserChoiceAnswer {
    questionId: string;
    optionId?: string;
    freeText?: string;
}

function hasUserChoiceAnswer(answer: UserChoiceAnswer | undefined): boolean {
    return Boolean(answer?.optionId || clean(answer?.freeText));
}

export function canDelegateUserChoiceQuestion(question: UserChoiceQuestion): boolean {
    return question.decisionKind === 'preference';
}

/** required_fact / approval 必须得到显式答案；只有 preference 可以留给 Agent 决定。 */
export function canSubmitUserChoiceAnswers(
    request: UserChoiceRequest,
    answers: UserChoiceAnswer[]
): boolean {
    return request.questions.every((question) => (
        canDelegateUserChoiceQuestion(question)
        || hasUserChoiceAnswer(answers.find((answer) => answer.questionId === question.id))
    ));
}

/** 用户点选后发回对话的那段话（作为普通用户消息继续，不走任何续接账本）。 */
export function formatUserChoiceReply(request: UserChoiceRequest, answers: UserChoiceAnswer[]): string {
    const lines = request.questions.map((question) => {
        const answer = answers.find((item) => item.questionId === question.id);
        const option = answer?.optionId ? question.options.find((item) => item.id === answer.optionId) : undefined;
        const free = clean(answer?.freeText);
        let body: string;
        if (option && free) body = `我选「${option.label}」，补充：${free}`;
        else if (option) body = `我选「${option.label}」`;
        else if (free) body = free;
        else body = canDelegateUserChoiceQuestion(question) ? '你自己定' : '未回答';
        return `关于「${question.question}」：${body}`;
    });
    return lines.join('\n');
}

/** 全自动模式下工具的回话：不停下，按每题的推荐项继续。 */
export function describeAutoDecision(request: UserChoiceRequest): string {
    const picks = request.questions.map((question) => {
        const chosen = question.options.find((item) => item.id === question.recommendedId);
        if (!chosen) return `「${question.question}」→ 缺少可采用的专业推荐，必须等待用户回答`;
        return `「${question.question}」→ 按你倾向的「${chosen.label}」${chosen.detail ? `（${chosen.detail}）` : ''}`;
    });
    return `全自动模式，用户不在场：${picks.join('；')}。把这些选择和为什么用自己的话告诉用户，然后接着做；后面发现选错了可以再改。`;
}

/** 给模型看的问题回执（ask 模式）。 */
export function describeChoiceRequestForModel(request: UserChoiceRequest): string {
    return `已把 ${request.questions.length} 个问题和选项交给用户，本轮到此暂停等用户选；用户的回复会作为下一条消息到来，届时按它继续。不要再重复问同一批问题。`;
}
