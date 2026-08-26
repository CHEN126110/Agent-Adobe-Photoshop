/**
 * R2 reference context resolution。
 *
 * Skill Manifest 决定不同工作模式是否需要参考；模型声明选择和可复用洞察；Harness
 * 只核对 R1 workMode、已取得的参考上下文、搜索预算和降级边界。该声明用于确认
 * R2 参考上下文是否足以进入策略阶段，不执行 Tool，也不承担执行授权或质量评价。
 */

import type {
    RuntimeDesignWorkMode,
    RuntimeReferenceRequirement,
    RuntimeReferenceSourceKind,
    SkillRuntimeReferencePolicy
} from './contracts';

export const DECLARE_REFERENCE_BRIEF_TOOL_NAME = 'declareReferenceBrief';
/** Provider Tool 适配表集中在参考契约层；Agent 核心只问语义，不维护品类分支。 */
export const RUNTIME_REFERENCE_SEARCH_TOOL_NAMES: readonly string[] = Object.freeze([
    'searchEagleReferences'
]);
export const RUNTIME_REFERENCE_VISUAL_TOOL_NAMES: readonly string[] = Object.freeze([
    'analyzeEagleReference'
]);

export type RuntimeReferenceDecision = 'search_new' | 'reuse_existing' | 'skip_not_needed';
export type RuntimeReferenceReadiness = 'ready' | 'degraded' | 'waived';
export type RuntimeReferenceInsightAspect =
    | 'composition'
    | 'layout'
    | 'placement'
    | 'color'
    | 'typography'
    | 'lighting'
    | 'retouching';

export interface RuntimeReferenceSourceEntry {
    kind: RuntimeReferenceSourceKind;
    sourceRefs: string[];
}

export interface RuntimeReferenceInsight {
    aspect: RuntimeReferenceInsightAspect;
    observation: string;
    application: string;
    observationRefs: string[];
}

export interface RuntimeReferenceBriefDeclaration {
    version: 'runtime-reference-brief/v0';
    source: 'model_tool_call';
    workMode: RuntimeDesignWorkMode;
    requirement: RuntimeReferenceRequirement;
    decision: RuntimeReferenceDecision;
    readiness: RuntimeReferenceReadiness;
    sources: RuntimeReferenceSourceEntry[];
    insights: RuntimeReferenceInsight[];
    limitations: string[];
    boundaries: {
        modelAuthored: true;
        harnessValidatedOnly: true;
        skillPolicyIsSourceOfTruth: true;
        categoryNeutral: true;
        executesTools: false;
    };
}

export interface RuntimeReferenceBriefDigest {
    version: 'runtime-reference-brief-digest/v0';
    workMode: RuntimeDesignWorkMode;
    requirement: RuntimeReferenceRequirement;
    decision: RuntimeReferenceDecision;
    readiness: RuntimeReferenceReadiness;
    sourceKinds: RuntimeReferenceSourceKind[];
    insightCount: number;
    searchAttemptCount: number;
    searchFailureCount: number;
    visualAnalysisFailureCount: number;
    limitationCount: number;
    boundaries: {
        digestOnly: true;
    };
}

export interface RuntimeReferenceBriefValidationResult {
    ok: boolean;
    readiness: 'invalid' | RuntimeReferenceReadiness;
    declaration?: RuntimeReferenceBriefDeclaration;
    issues: Array<{ code: string; path: string }>;
}

export interface RuntimeReferenceContextState {
    allowedContextRefs: string[];
    visualObservations: RuntimeReferenceContextObservation[];
    searchAttemptCount: number;
    searchFailureCount: number;
    visualAnalysisFailureCount: number;
}

export interface RuntimeReferenceContextObservation {
    ref: string;
    summary: string;
    aspects: Array<{
        aspect: RuntimeReferenceInsightAspect;
        observation: string;
    }>;
}

/**
 * Manifest reference_policy 的运行时只读投影。它保留原契约语义，但不会成为第二个
 * Policy owner；Agent 只能消费，不能在运行中改写要求、来源或降级行为。
 */
export type RuntimeReferencePolicyProjection = Readonly<Omit<
    SkillRuntimeReferencePolicy,
    'work_mode_requirements' | 'allowed_sources'
>> & {
    readonly work_mode_requirements: Readonly<SkillRuntimeReferencePolicy['work_mode_requirements']>;
    readonly allowed_sources: readonly RuntimeReferenceSourceKind[];
};

export type RuntimeReferenceFailureCategory =
    | 'source_unavailable'
    | 'no_results'
    | 'reference_not_found'
    | 'search_budget_exhausted'
    | 'invalid_input'
    | 'permission_denied'
    | 'safety_blocked'
    | 'protocol_error'
    | 'cancelled'
    | 'unknown';

export interface RuntimeReferenceFailureDispositionInput {
    policy?: RuntimeReferencePolicyProjection;
    workMode?: RuntimeDesignWorkMode;
    toolName: unknown;
    result: unknown;
    /** required + continue_degraded 只有在既有 R2 声明确实校验为 degraded 后才可降级记账。 */
    referenceReadiness?: RuntimeReferenceReadiness;
}

const WORK_MODES: readonly RuntimeDesignWorkMode[] = [
    'create_new',
    'redesign',
    'template_fill',
    'edit_existing',
    'analyze_only',
    'export_only'
];
const REQUIREMENTS: readonly RuntimeReferenceRequirement[] = ['required', 'reuse_or_optional', 'not_required'];
const SOURCE_KINDS: readonly RuntimeReferenceSourceKind[] = ['user_reference', 'brand_template', 'project_case', 'eagle', 'web'];
const DECISIONS: readonly RuntimeReferenceDecision[] = ['search_new', 'reuse_existing', 'skip_not_needed'];
const READINESS_VALUES: readonly RuntimeReferenceReadiness[] = ['ready', 'degraded', 'waived'];
const INSIGHT_ASPECTS: readonly RuntimeReferenceInsightAspect[] = [
    'composition',
    'layout',
    'placement',
    'color',
    'typography',
    'lighting',
    'retouching'
];
const MAX_TEXT = 360;
const MAX_ISSUES = 32;

const NON_DEGRADABLE_INVALID_INPUT_PATTERN = /(?:^|_)(?:invalid_(?:argument|arguments|input|param|params|parameter|parameters|request|schema|json)|schema_(?:invalid|mismatch|validation_failed)|validation_(?:failed|error)|missing_(?:required_)?(?:argument|field|param|parameter)|bad_request|malformed_(?:argument|arguments|request|json))(?:_|$)/;
const NON_DEGRADABLE_PERMISSION_PATTERN = /(?:^|_)(?:permission(?:_denied)?|forbidden|unauthorized|not_authorized|access_denied)(?:_|$)/;
const NON_DEGRADABLE_SAFETY_PATTERN = /(?:^|_)(?:safety|security|unsafe|policy_blocked|blocked_by_policy)(?:_|$)/;
const NON_DEGRADABLE_PROTOCOL_PATTERN = /(?:^|_)(?:protocol|invalid_json|parse_error|response_schema|malformed_response)(?:_|$)/;
const CANCELLED_FAILURE_PATTERN = /(?:^|_)(?:cancelled|canceled|aborted)(?:_|$)/;
const DEGRADABLE_SOURCE_UNAVAILABLE_TOKENS = new Set([
    'unavailable',
    'disabled',
    'offline',
    'timeout',
    'timed_out',
    'service_unavailable',
    'source_unavailable',
    'provider_unavailable',
    'connection_failed',
    'rate_limited'
]);
const DEGRADABLE_NO_RESULT_TOKENS = new Set(['no_results', 'empty_results']);
const DEGRADABLE_NOT_FOUND_TOKENS = new Set(['not_found', 'reference_not_found', 'resource_not_found']);
const DEGRADABLE_SEARCH_BUDGET_TOKENS = new Set([
    'runtime_reference_search_budget_exhausted',
    'reference_search_budget_exhausted'
]);

function normalizeStructuredFailureToken(value: unknown): string {
    return String(value || '')
        .trim()
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase();
}

function collectStructuredReferenceFailureTokens(value: unknown): string[] {
    if (!isObject(value)) return [];
    const records = [
        value,
        isObject(value.data) ? value.data : undefined,
        isObject(value.result) ? value.result : undefined,
        isObject(value.errorDetails) ? value.errorDetails : undefined
    ].filter((item): item is Record<string, unknown> => Boolean(item));
    return Array.from(new Set(records.flatMap((record) => [
        record.code,
        record.errorCode,
        record.status,
        record.failureCategory,
        record.errorCategory,
        record.category
    ].map(normalizeStructuredFailureToken).filter(Boolean))));
}
const LOCAL_PATH_PATTERN = /(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/]|\/(?:Users|home|tmp|var|private)\/)/;
const DATA_URL_PATTERN = /data:[^;,]{1,80}(?:;base64)?,/i;

function isObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function addIssue(issues: Array<{ code: string; path: string }>, code: string, path: string): void {
    if (issues.length >= MAX_ISSUES) return;
    if (!issues.some((issue) => issue.code === code && issue.path === path)) issues.push({ code, path });
}

function validateKeys(
    record: Record<string, unknown>,
    allowed: readonly string[],
    path: string,
    issues: Array<{ code: string; path: string }>
): void {
    const allowedSet = new Set(allowed);
    Object.keys(record).forEach((key) => {
        if (!allowedSet.has(key)) addIssue(issues, 'unknown_field', `${path}.${key}`);
    });
}

function readText(
    value: unknown,
    path: string,
    issues: Array<{ code: string; path: string }>,
    required = true
): string {
    const text = typeof value === 'string' ? value.trim() : '';
    if (required && !text) addIssue(issues, 'text_required', path);
    if (text.length > MAX_TEXT) addIssue(issues, 'text_too_long', path);
    if (LOCAL_PATH_PATTERN.test(text) || DATA_URL_PATTERN.test(text)) addIssue(issues, 'sensitive_payload_forbidden', path);
    return text;
}

function readAllowedRefs(input: {
    value: unknown;
    path: string;
    issues: Array<{ code: string; path: string }>;
    allowed: ReadonlySet<string>;
    required?: boolean;
}): string[] {
    if (!Array.isArray(input.value)) {
        addIssue(input.issues, 'array_required', input.path);
        return [];
    }
    if (input.value.length > 12) addIssue(input.issues, 'array_too_long', input.path);
    const refs = input.value.slice(0, 12).map((value, index) => (
        readText(value, `${input.path}[${index}]`, input.issues)
    )).filter(Boolean);
    if (input.required && refs.length === 0) addIssue(input.issues, 'context_ref_required', input.path);
    refs.forEach((ref, index) => {
        if (!input.allowed.has(ref)) addIssue(input.issues, 'context_ref_not_available', `${input.path}[${index}]`);
    });
    return Array.from(new Set(refs));
}

export function normalizeRuntimeReferenceContextObservation(
    ref: string,
    value: unknown
): RuntimeReferenceContextObservation | undefined {
    const record = isObject(value) ? value : {};
    const summary = typeof record.summary === 'string' ? record.summary.trim() : '';
    if (!summary) return undefined;
    const aspects = Array.isArray(record.strengths)
        ? record.strengths.map((value) => {
            const item = isObject(value) ? value : {};
            const aspect = String(item.aspect || '').trim() as RuntimeReferenceInsightAspect;
            const observation = typeof item.observation === 'string' ? item.observation.trim() : '';
            if (!INSIGHT_ASPECTS.includes(aspect) || !observation) return undefined;
            return { aspect, observation };
        }).filter(Boolean) as RuntimeReferenceContextObservation['aspects']
        : [];
    if (aspects.length === 0) return undefined;
    return {
        ref: String(ref || '').trim(),
        summary,
        aspects
    };
}

/**
 * 参考视觉 Tool 与后续模型声明共用的稳定 context ref。它只编码 Eagle/item 身份，
 * 不包含本地路径、像素或设计结论；fallback 仅用于旧结果确实没有 item id 的诊断兼容。
 */
export function buildRuntimeReferenceVisualContextRef(
    value: unknown,
    fallback: string | number
): string {
    const itemId = String(value || fallback)
        .trim()
        .replace(/[^A-Za-z0-9_.:-]/gu, '_')
        .slice(0, 96);
    return `context:reference_visual:${itemId || String(fallback)}`;
}

export function projectRuntimeReferencePolicy(
    policy: SkillRuntimeReferencePolicy | undefined
): RuntimeReferencePolicyProjection | undefined {
    if (!policy) return undefined;
    return Object.freeze({
        version: policy.version,
        work_mode_requirements: Object.freeze({ ...policy.work_mode_requirements }),
        allowed_sources: Object.freeze([...policy.allowed_sources]),
        max_search_rounds: policy.max_search_rounds,
        unavailable_behavior: policy.unavailable_behavior
    });
}

/**
 * 只读取 Tool 返回的结构化 code/status/category，不从错误文案猜失败性质。
 * 未分类失败保持 unknown，避免把参数、权限或协议错误误当成“参考源暂时不可用”。
 */
export function classifyRuntimeReferenceFailure(
    result: unknown
): RuntimeReferenceFailureCategory {
    if (!isObject(result) || result.success !== false) return 'unknown';
    if (result.cancelled === true) return 'cancelled';
    const tokens = collectStructuredReferenceFailureTokens(result);
    if (tokens.some((token) => CANCELLED_FAILURE_PATTERN.test(token))) return 'cancelled';
    if (tokens.some((token) => NON_DEGRADABLE_INVALID_INPUT_PATTERN.test(token))) return 'invalid_input';
    if (tokens.some((token) => NON_DEGRADABLE_PERMISSION_PATTERN.test(token))) return 'permission_denied';
    if (tokens.some((token) => NON_DEGRADABLE_SAFETY_PATTERN.test(token))) return 'safety_blocked';
    if (tokens.some((token) => NON_DEGRADABLE_PROTOCOL_PATTERN.test(token))) return 'protocol_error';
    if (tokens.some((token) => DEGRADABLE_SEARCH_BUDGET_TOKENS.has(token))) {
        return 'search_budget_exhausted';
    }
    if (tokens.some((token) => DEGRADABLE_NO_RESULT_TOKENS.has(token))) return 'no_results';
    if (tokens.some((token) => DEGRADABLE_NOT_FOUND_TOKENS.has(token))) return 'reference_not_found';
    if (tokens.some((token) => DEGRADABLE_SOURCE_UNAVAILABLE_TOKENS.has(token))) {
        return 'source_unavailable';
    }
    return 'unknown';
}

/**
 * 决定参考失败是否只作为“未取得可选观察”保留，而不进入交付失败计数。
 * Tool 结果本身不被改写：success=false、耗时与原始诊断继续留在运行日志中。
 */
export function resolveRuntimeReferenceFailureDisposition(
    input: RuntimeReferenceFailureDispositionInput
): 'non_blocking_observation' | undefined {
    if (!input.policy) return undefined;
    if (!isRuntimeReferenceSearchTool(input.toolName)
        && !isRuntimeReferenceVisualTool(input.toolName)) {
        return undefined;
    }
    const category = classifyRuntimeReferenceFailure(input.result);
    const degradable = category === 'source_unavailable'
        || category === 'no_results'
        || category === 'reference_not_found'
        || category === 'search_budget_exhausted';
    if (!degradable) return undefined;

    // Agentic tasks may not have declared workMode yet. If every mode in the selected Skill
    // explicitly says references are optional/not required, that missing mode cannot turn a
    // degradable read-only lookup failure into a delivery failure. If any mode requires a
    // reference, remain fail-closed until the model declares the mode.
    const requirements = Object.values(input.policy.work_mode_requirements);
    const requirement = input.workMode
        ? getReferenceRequirement(input.policy, input.workMode)
        : (requirements.every((item) => item === 'reuse_or_optional' || item === 'not_required')
            ? 'reuse_or_optional'
            : undefined);
    if (!requirement) return undefined;
    if (requirement === 'reuse_or_optional' || requirement === 'not_required') {
        return 'non_blocking_observation';
    }
    if (requirement === 'required'
        && input.policy.unavailable_behavior === 'continue_degraded'
        && input.referenceReadiness === 'degraded') {
        return 'non_blocking_observation';
    }
    return undefined;
}

export function getReferenceRequirement(
    policy: RuntimeReferencePolicyProjection,
    workMode: RuntimeDesignWorkMode
): RuntimeReferenceRequirement {
    return policy.work_mode_requirements[workMode];
}

export function validateSkillRuntimeReferencePolicy(
    policy: RuntimeReferencePolicyProjection | undefined
): string[] {
    if (!policy) return [];
    const issues: string[] = [];
    if (policy.version !== 'skill-reference-policy/v0') issues.push('reference_policy_version_invalid');
    WORK_MODES.forEach((mode) => {
        if (!REQUIREMENTS.includes(policy.work_mode_requirements?.[mode])) {
            issues.push(`reference_policy_work_mode_invalid:${mode}`);
        }
    });
    if (!Array.isArray(policy.allowed_sources) || policy.allowed_sources.length === 0) {
        issues.push('reference_policy_sources_missing');
    } else if (policy.allowed_sources.some((source) => !SOURCE_KINDS.includes(source))) {
        issues.push('reference_policy_source_invalid');
    }
    if (!Number.isInteger(policy.max_search_rounds)
        || policy.max_search_rounds < 1
        || policy.max_search_rounds > 4) {
        issues.push('reference_policy_search_budget_invalid');
    }
    if (!['continue_degraded', 'block'].includes(policy.unavailable_behavior)) {
        issues.push('reference_policy_unavailable_behavior_invalid');
    }
    return issues;
}

export function validateRuntimeReferenceBriefDeclaration(input: {
    value: unknown;
    policy: RuntimeReferencePolicyProjection;
    workMode: RuntimeDesignWorkMode;
    context: RuntimeReferenceContextState;
}): RuntimeReferenceBriefValidationResult {
    const issues: Array<{ code: string; path: string }> = [];
    const record = isObject(input.value) ? input.value : {};
    if (!isObject(input.value)) addIssue(issues, 'object_required', 'referenceBrief');
    validateKeys(record, ['decision', 'readiness', 'sources', 'insights', 'limitations'], 'referenceBrief', issues);
    const decisionText = String(record.decision || '').trim() as RuntimeReferenceDecision;
    const readinessText = String(record.readiness || '').trim() as RuntimeReferenceReadiness;
    if (!DECISIONS.includes(decisionText)) addIssue(issues, 'reference_decision_invalid', 'decision');
    if (!READINESS_VALUES.includes(readinessText)) addIssue(issues, 'reference_readiness_invalid', 'readiness');
    const allowedRefs = new Set(input.context.allowedContextRefs);
    const visualObservations = new Map(
        input.context.visualObservations.map((item) => [item.ref, item])
    );
    const visualRefs = new Set(visualObservations.keys());
    const allowedSources = new Set(input.policy.allowed_sources);

    const sources: RuntimeReferenceSourceEntry[] = Array.isArray(record.sources)
        ? record.sources.slice(0, 8).map((value, index) => {
            const path = `sources[${index}]`;
            const source = isObject(value) ? value : {};
            if (!isObject(value)) addIssue(issues, 'object_required', path);
            validateKeys(source, ['kind', 'sourceRefs'], path, issues);
            const kind = String(source.kind || '').trim() as RuntimeReferenceSourceKind;
            if (!SOURCE_KINDS.includes(kind) || !allowedSources.has(kind)) {
                addIssue(issues, 'reference_source_not_allowed', `${path}.kind`);
            }
            return {
                kind,
                sourceRefs: readAllowedRefs({
                    value: source.sourceRefs,
                    path: `${path}.sourceRefs`,
                    issues,
                    allowed: allowedRefs,
                    required: true
                })
            };
        })
        : [];
    if (!Array.isArray(record.sources)) addIssue(issues, 'array_required', 'sources');

    const insights: RuntimeReferenceInsight[] = Array.isArray(record.insights)
        ? record.insights.slice(0, 12).map((value, index) => {
            const path = `insights[${index}]`;
            const insight = isObject(value) ? value : {};
            if (!isObject(value)) addIssue(issues, 'object_required', path);
            validateKeys(insight, ['aspect', 'application', 'observationRefs'], path, issues);
            const aspect = String(insight.aspect || '').trim() as RuntimeReferenceInsightAspect;
            if (!INSIGHT_ASPECTS.includes(aspect)) addIssue(issues, 'reference_insight_aspect_invalid', `${path}.aspect`);
            const observationRefs = readAllowedRefs({
                value: insight.observationRefs,
                path: `${path}.observationRefs`,
                issues,
                allowed: allowedRefs,
                required: true
            });
            observationRefs.forEach((ref, refIndex) => {
                if (!visualRefs.has(ref)) {
                    addIssue(issues, 'reference_visual_observation_required', `${path}.observationRefs[${refIndex}]`);
                }
            });
            const observedText = Array.from(new Set(observationRefs.flatMap((ref) => {
                const observation = visualObservations.get(ref);
                if (!observation) return [];
                const matching = observation.aspects
                    .filter((item) => item.aspect === aspect)
                    .map((item) => item.observation);
                return matching.length > 0 ? matching : [observation.summary];
            }).filter(Boolean))).join('；');
            if (!observedText) {
                addIssue(issues, 'reference_observation_content_missing', `${path}.observationRefs`);
            }
            return {
                aspect,
                observation: observedText,
                application: readText(insight.application, `${path}.application`, issues),
                observationRefs
            };
        })
        : [];
    if (!Array.isArray(record.insights)) addIssue(issues, 'array_required', 'insights');
    const limitations = Array.isArray(record.limitations)
        ? record.limitations.slice(0, 8).map((value, index) => (
            readText(value, `limitations[${index}]`, issues)
        )).filter(Boolean)
        : [];
    if (!Array.isArray(record.limitations)) addIssue(issues, 'array_required', 'limitations');

    const requirement = getReferenceRequirement(input.policy, input.workMode);
    if (readinessText === 'ready' && (sources.length === 0 || insights.length === 0)) {
        addIssue(issues, 'reference_ready_requires_visual_insight', 'readiness');
    }
    if (readinessText === 'ready' && decisionText === 'skip_not_needed') {
        addIssue(issues, 'reference_ready_decision_conflict', 'decision');
    }
    if (requirement === 'required' && readinessText === 'waived') {
        addIssue(issues, 'required_reference_cannot_be_waived', 'readiness');
    }
    if (requirement === 'not_required' && readinessText !== 'waived') {
        addIssue(issues, 'not_required_reference_must_be_waived', 'readiness');
    }
    if (readinessText === 'degraded') {
        if (requirement !== 'required' || input.policy.unavailable_behavior !== 'continue_degraded') {
            addIssue(issues, 'reference_degraded_not_allowed', 'readiness');
        }
        if (decisionText !== 'search_new') addIssue(issues, 'reference_degraded_requires_search', 'decision');
        const budgetExhausted = input.context.searchAttemptCount >= input.policy.max_search_rounds;
        if (!budgetExhausted) addIssue(issues, 'reference_search_budget_not_exhausted', 'readiness');
        if (input.context.searchFailureCount === 0 && input.context.visualAnalysisFailureCount === 0) {
            addIssue(issues, 'reference_degraded_without_failed_reference_attempt', 'readiness');
        }
        if (limitations.length === 0) addIssue(issues, 'reference_degraded_limitations_required', 'limitations');
    }
    if (readinessText === 'waived' && decisionText !== 'skip_not_needed') {
        addIssue(issues, 'reference_waived_decision_conflict', 'decision');
    }

    if (issues.length > 0) return { ok: false, readiness: 'invalid', issues };
    const declaration: RuntimeReferenceBriefDeclaration = {
        version: 'runtime-reference-brief/v0',
        source: 'model_tool_call',
        workMode: input.workMode,
        requirement,
        decision: decisionText,
        readiness: readinessText,
        sources,
        insights,
        limitations,
        boundaries: {
            modelAuthored: true,
            harnessValidatedOnly: true,
            skillPolicyIsSourceOfTruth: true,
            categoryNeutral: true,
            executesTools: false
        }
    };
    return { ok: true, readiness: declaration.readiness, declaration, issues: [] };
}

export function buildRuntimeReferenceBriefDigest(input: {
    declaration: RuntimeReferenceBriefDeclaration;
    context: RuntimeReferenceContextState;
}): RuntimeReferenceBriefDigest {
    return {
        version: 'runtime-reference-brief-digest/v0',
        workMode: input.declaration.workMode,
        requirement: input.declaration.requirement,
        decision: input.declaration.decision,
        readiness: input.declaration.readiness,
        sourceKinds: Array.from(new Set(input.declaration.sources.map((source) => source.kind))),
        insightCount: input.declaration.insights.length,
        searchAttemptCount: input.context.searchAttemptCount,
        searchFailureCount: input.context.searchFailureCount,
        visualAnalysisFailureCount: input.context.visualAnalysisFailureCount,
        limitationCount: input.declaration.limitations.length,
        boundaries: {
            digestOnly: true
        }
    };
}

function normalizeReferenceEvaluationText(value: unknown, maxLength: number): string {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    if (LOCAL_PATH_PATTERN.test(text) || DATA_URL_PATTERN.test(text)) {
        return '[reference_context_redacted]';
    }
    return text.slice(0, maxLength);
}

/**
 * 把已经通过 RuntimeReferenceBrief 校验的视觉参考结论投影给终局 Judge。
 * ready 才携带观察与迁移关系；degraded 只说明失败边界；waived 不伪装成参考依据。
 * 该投影只是有界 user data，不执行 Tool、不授权写入，也不拥有质量裁决。
 */
export function buildRuntimeReferenceEvaluationContext(
    declaration: RuntimeReferenceBriefDeclaration | undefined
): string {
    if (!declaration || declaration.readiness === 'waived') return '';
    const parts = [`参考决策：${declaration.decision}/${declaration.readiness}`];
    if (declaration.readiness === 'ready') {
        declaration.insights.slice(0, 8).forEach((insight, index) => {
            const observation = normalizeReferenceEvaluationText(insight.observation, 320);
            const application = normalizeReferenceEvaluationText(insight.application, 320);
            parts.push(
                `参考洞察${index + 1}·${insight.aspect}：观察=${observation}；迁移=${application}`
            );
        });
    }
    const limitations = declaration.limitations
        .slice(0, 8)
        .map((item) => normalizeReferenceEvaluationText(item, 120))
        .filter(Boolean);
    if (limitations.length > 0) parts.push(`参考限制：${limitations.join('、')}`);
    return parts.join('；').slice(0, 9000);
}

export function buildDeclareReferenceBriefToolSchema(input: {
    policy: RuntimeReferencePolicyProjection;
    workMode: RuntimeDesignWorkMode;
    context: RuntimeReferenceContextState;
}): {
    name: typeof DECLARE_REFERENCE_BRIEF_TOOL_NAME;
    description: string;
    inputSchema: Record<string, unknown>;
} {
    const requirement = getReferenceRequirement(input.policy, input.workMode);
    const allowedRefs = Array.from(new Set(input.context.allowedContextRefs));
    const visualRefs = Array.from(new Set(input.context.visualObservations.map((item) => item.ref)));
    return {
        name: DECLARE_REFERENCE_BRIEF_TOOL_NAME,
        description: [
            `Declare the R2 reference decision for workMode=${input.workMode}; Skill requirement=${requirement}.`,
            'Prefer an explicit user reference, governed brand template, or relevant project case before searching Eagle or the web. Apply a reference to a named design aspect; never copy its surface style wholesale.',
            'Searching candidates is not visual understanding. readiness=ready requires at least one insight backed by structured output from a visual-reference tool.',
            'Choose an aspect and explain its application; the observation text is supplied by the Harness from that tool output and cannot be authored here.',
            'For an agentic task this declaration is optional and non-blocking. When an observed reference materially influenced the design or should be compared during final review, bind that exact visual observation with readiness=ready; otherwise do not invent a reference or add a declaration merely to satisfy a workflow.',
            `At most ${input.policy.max_search_rounds} reference search rounds are allowed.`,
            requirement === 'reuse_or_optional'
                ? 'References are optional for this mode. Search only when it materially reduces a design uncertainty; otherwise choose skip_not_needed with readiness=waived and continue from governed knowledge, project facts, and later visual review.'
                : requirement === 'not_required'
                    ? 'References are not required for this mode; choose skip_not_needed with readiness=waived.'
                    : input.policy.unavailable_behavior === 'continue_degraded'
                        ? 'This task explicitly requires a reference. If searches fail or the budget is exhausted, degraded is allowed only with explicit limitations.'
                        : 'This task explicitly requires a reference. Reference unavailability blocks progression; degraded is not allowed.',
            'This declaration can satisfy R2 reference-context readiness after validation. It does not search references, execute Photoshop, authorize writes, or evaluate design quality.'
        ].join(' '),
        inputSchema: {
            type: 'object',
            properties: {
                decision: { type: 'string', enum: [...DECISIONS] },
                readiness: { type: 'string', enum: [...READINESS_VALUES] },
                sources: {
                    type: 'array',
                    maxItems: 8,
                    items: {
                        type: 'object',
                        properties: {
                            kind: { type: 'string', enum: input.policy.allowed_sources },
                            sourceRefs: {
                                type: 'array',
                                minItems: 1,
                                maxItems: 12,
                                items: { type: 'string', ...(allowedRefs.length ? { enum: allowedRefs } : {}) }
                            }
                        },
                        required: ['kind', 'sourceRefs'],
                        additionalProperties: false
                    }
                },
                insights: {
                    type: 'array',
                    maxItems: 12,
                    items: {
                        type: 'object',
                        properties: {
                            aspect: { type: 'string', enum: [...INSIGHT_ASPECTS] },
                            application: { type: 'string', minLength: 1, maxLength: MAX_TEXT },
                            observationRefs: {
                                type: 'array',
                                minItems: 1,
                                maxItems: 8,
                                items: { type: 'string', ...(visualRefs.length ? { enum: visualRefs } : {}) }
                            }
                        },
                        required: ['aspect', 'application', 'observationRefs'],
                        additionalProperties: false
                    }
                },
                limitations: {
                    type: 'array',
                    maxItems: 8,
                    items: { type: 'string', minLength: 1, maxLength: MAX_TEXT }
                }
            },
            required: ['decision', 'readiness', 'sources', 'insights', 'limitations'],
            additionalProperties: false
        }
    };
}

export function isReferenceBriefControlTool(value: unknown): boolean {
    return String(value || '').trim() === DECLARE_REFERENCE_BRIEF_TOOL_NAME;
}

export function isRuntimeReferenceSearchTool(value: unknown): boolean {
    return RUNTIME_REFERENCE_SEARCH_TOOL_NAMES.includes(String(value || '').trim());
}

export function isRuntimeReferenceVisualTool(value: unknown): boolean {
    return RUNTIME_REFERENCE_VISUAL_TOOL_NAMES.includes(String(value || '').trim());
}

export function isRuntimeReferenceContextResolved(
    declaration: RuntimeReferenceBriefDeclaration | undefined
): boolean {
    return declaration?.readiness === 'ready'
        || declaration?.readiness === 'degraded'
        || declaration?.readiness === 'waived';
}

export function hasRuntimeReferenceVisualObservation(
    declaration: RuntimeReferenceBriefDeclaration | undefined
): boolean {
    return declaration?.readiness === 'ready'
        && declaration.insights.some((insight) => insight.observationRefs.length > 0 && Boolean(insight.observation));
}
