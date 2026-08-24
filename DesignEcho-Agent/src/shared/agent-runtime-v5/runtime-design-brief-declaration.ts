/**
 * R1 Runtime Design Brief Declaration。
 *
 * Brief 的语义内容由模型通过结构化控制工具提交；Harness 使用当前 Skill manifest 的
 * required_inputs / optional_inputs 生成并归一输入覆盖，把运行时已解析来源绑定到对应 inputKey。
 * Harness 不推断品类、不生成设计策略、不执行 Tool，也不授予任何权限。
 */

import {
    RUNTIME_DESIGN_WORK_MODES,
    type RuntimeDesignWorkMode,
    type SkillRuntimeInputSourceKind,
    type SkillRuntimeInputSourceMap
} from './contracts';

export const DECLARE_DESIGN_BRIEF_TOOL_NAME = 'declareDesignBrief';

export type RuntimeDesignBriefInputStatus = 'provided' | 'missing' | 'assumed';

export interface RuntimeDesignBriefInputCoverage {
    inputKey: string;
    status: RuntimeDesignBriefInputStatus;
    contextRefs: string[];
    note?: string;
}

/** Harness 在当前运行中实际发现的输入来源，不包含原始内容。 */
export interface RuntimeDesignBriefAvailableInputSource {
    sourceKind: SkillRuntimeInputSourceKind;
    /** structured_input 等只允许绑定到已解析出的精确字段；省略表示可按 Manifest 类型匹配。 */
    inputKeys?: readonly string[];
}

/** Harness 根据 Manifest 将实际来源绑定到具体 inputKey 后生成；模型不提交该内部引用。 */
export interface RuntimeDesignBriefResolvedInput {
    inputKey: string;
    sourceKind: SkillRuntimeInputSourceKind;
    contextRef: string;
}

export interface RuntimeDesignBriefDeclarationPayload {
    /** 由模型声明；存在 reference_policy 或 work_mode_contracts 时必填。 */
    workMode?: RuntimeDesignWorkMode;
    taskGoal: string;
    deliverables: string[];
    targetAudience?: string;
    channel?: string;
    outputRequirements: string[];
    constraints: string[];
    inputCoverage: RuntimeDesignBriefInputCoverage[];
    contextRefs: string[];
}

export interface RuntimeDesignBriefDeclaration {
    version: 'runtime-design-brief-declaration/v0';
    source: 'model_tool_call';
    readiness: 'ready' | 'needs_input';
    payload: RuntimeDesignBriefDeclarationPayload;
    boundaries: {
        modelAuthored: true;
        harnessValidatedOnly: true;
        harnessResolvesInputBindings: true;
        harnessNormalizesInputCoverage: true;
        manifestInputsAreSourceOfTruth: true;
        categoryNeutral: true;
        executesTools: false;
        grantsPermission: false;
        autoActivatesCapabilities: false;
        countsAsTaskProgress: false;
        countsAsQualityPass: false;
    };
}

export interface RuntimeDesignBriefDigest {
    version: 'runtime-design-brief-digest/v0';
    readiness: RuntimeDesignBriefDeclaration['readiness'];
    workMode?: RuntimeDesignWorkMode;
    taskGoal: string;
    deliverables: string[];
    requiredInputCount: number;
    providedRequiredInputCount: number;
    missingRequiredInputKeys: string[];
    assumedRequiredInputKeys: string[];
    contextRefs: string[];
    constraintCount: number;
    boundaries: {
        digestOnly: true;
        modelAuthored: true;
        changesTaskResult: false;
        grantsPermission: false;
    };
}

export interface RuntimeDesignBriefValidationIssue {
    code: string;
    path: string;
}

export interface RuntimeDesignBriefValidationResult {
    ok: boolean;
    readiness: 'invalid' | RuntimeDesignBriefDeclaration['readiness'];
    declaration?: RuntimeDesignBriefDeclaration;
    issues: RuntimeDesignBriefValidationIssue[];
}

export interface RuntimeDesignBriefToolSchema {
    name: typeof DECLARE_DESIGN_BRIEF_TOOL_NAME;
    description: string;
    inputSchema: {
        type: 'object';
        properties: Record<string, any>;
        required: string[];
        additionalProperties: false;
    };
}

export interface RuntimeDesignBriefWorkModeInputContract {
    requiredInputKeys: readonly string[];
    optionalInputKeys: readonly string[];
}

export type RuntimeDesignBriefWorkModeInputContracts = Partial<
    Record<RuntimeDesignWorkMode, RuntimeDesignBriefWorkModeInputContract>
>;

const MAX_TEXT = 480;
const MAX_LIST = 16;
const MAX_ISSUES = 40;
/** 校验器能自动归一、不该驳回整张简报的问题（只随结果作提醒返回）。 */
const ADVISORY_ISSUE_CODES = new Set([
    'array_too_long',
    'text_too_long',
    'array_items_duplicate',
    'unknown_field',
    'implementation_detail_forbidden',
    'input_key_not_in_manifest',
    'context_ref_not_available'
]);
const LOCAL_PATH_PATTERN = /(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/]|\/(?:Users|home|tmp|var|private)\/)/;
const DATA_URL_PATTERN = /data:[^;,]{1,80}(?:;base64)?,/i;
const BASE64_PATTERN = /[A-Za-z0-9+/]{180,}={0,2}/;
const DESIGN_WORK_MODES: readonly RuntimeDesignWorkMode[] = RUNTIME_DESIGN_WORK_MODES;
const DESIGN_WORK_MODE_SEMANTICS: Readonly<Record<RuntimeDesignWorkMode, string>> = {
    create_new: 'create a new design or document rather than modifying an existing design',
    redesign: 'substantially redesign an existing document or design system',
    template_fill: 'populate a reusable template across its intended content slots while preserving the template structure',
    edit_existing: 'make a bounded local change to an existing document or target while leaving unrelated content intact',
    analyze_only: 'inspect and report without changing the design',
    export_only: 'deliver or export an existing result without editing its content'
};

function isObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 把校验 issue 翻译成模型能照着改的话：每条说清「哪个字段、哪条限制、允许值是什么」。
 * 只报 `array_too_long (inputCoverage)` 这种裸码，模型只能盲试——真机连撞 7 次即由此而来。
 */
export function describeRuntimeDesignBriefValidationIssues(
    issues: readonly RuntimeDesignBriefValidationIssue[],
    context: {
        allowedContextRefs?: readonly string[];
        allowedWorkModes?: readonly string[];
    } = {}
): string {
    if (issues.length === 0) return '未知校验问题';
    const refs = (context.allowedContextRefs || []).slice(0, 12).join(', ');
    const modes = (context.allowedWorkModes || []).join(' / ');
    const explain = (issue: RuntimeDesignBriefValidationIssue): string => {
        const field = issue.path.split('[')[0].split('.')[0];
        switch (issue.code) {
            case 'array_too_long':
                if (field === 'deliverables') return `${issue.path}：最多 8 项`;
                if (field === 'outputRequirements') return `${issue.path}：最多 12 项`;
                return `${issue.path}：最多 ${MAX_LIST} 项`;
            case 'array_required':
                return `${issue.path}：需要是数组`;
            case 'array_items_missing':
                return `${issue.path}：至少要有 1 项非空文本`;
            case 'array_items_duplicate':
                return `${issue.path}：有重复项，请去重`;
            case 'text_required':
                return `${issue.path}：需要非空文本`;
            case 'text_too_long':
                return `${issue.path}：单条不超过 ${MAX_TEXT} 字`;
            case 'context_ref_not_available':
                return `${issue.path}：不是当前可引用的上下文${refs ? `，可用：${refs}` : ''}`;
            case 'work_mode_required':
            case 'work_mode_invalid':
            case 'work_mode_mismatch':
                return `${issue.path || 'workMode'}：${issue.code}${modes ? `，允许：${modes}` : ''}`;
            case 'sensitive_payload_forbidden':
                return `${issue.path}：不要写本地路径 / data URL / base64`;
            case 'implementation_detail_forbidden':
                return `${issue.path}：这里写设计意图，不写工具名 / 图层编号 / 坐标`;
            case 'unknown_field':
                return `${issue.path}：不是本表单的字段，请删除`;
            default:
                return `${issue.path || '(root)'}：${issue.code}`;
        }
    };
    return issues.slice(0, 6).map(explain).join('；');
}

function addIssue(
    issues: RuntimeDesignBriefValidationIssue[],
    code: string,
    path: string
): void {
    if (issues.length >= MAX_ISSUES) return;
    if (issues.some((issue) => issue.code === code && issue.path === path)) return;
    issues.push({ code, path });
}

function validateKeys(
    value: Record<string, unknown>,
    allowed: readonly string[],
    path: string,
    issues: RuntimeDesignBriefValidationIssue[]
): void {
    const allowedSet = new Set(allowed);
    for (const key of Object.keys(value)) {
        if (!allowedSet.has(key)) addIssue(issues, 'unknown_field', `${path}.${key}`);
    }
}

function cleanInputKey(value: unknown): string {
    const key = String(value || '').trim();
    return /^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/.test(key) ? key : '';
}

function hasSensitivePayload(value: string): boolean {
    return LOCAL_PATH_PATTERN.test(value)
        || DATA_URL_PATTERN.test(value)
        || BASE64_PATTERN.test(value);
}

function hasImplementationDetail(value: string): boolean {
    return /\b(?:layerId|layerName|toolId|toolName|actionDescriptor|executeTool|batchPlay)\b/i.test(value)
        || /\b(?:create|set|get|move|render|export|delete|duplicate|select)[A-Z][A-Za-z0-9]+\b/.test(value)
        || /(?:Photoshop\s*命令|UXP\s*命令|图层编号|工具调用)/i.test(value)
        || /\b(?:x|y|width|height)\s*[:=]\s*-?\d/i.test(value);
}

function readText(input: {
    value: unknown;
    path: string;
    issues: RuntimeDesignBriefValidationIssue[];
    required?: boolean;
    maxLength?: number;
}): string {
    if (typeof input.value !== 'string') {
        if (input.required || input.value !== undefined) addIssue(input.issues, 'text_required', input.path);
        return '';
    }
    const rawText = input.value.trim();
    const maxLength = input.maxLength || MAX_TEXT;
    if (input.required && !rawText) addIssue(input.issues, 'text_required', input.path);
    if (rawText.length > maxLength) addIssue(input.issues, 'text_too_long', input.path);
    // 超长只截断作提醒（advisory），不驳回整张简报
    const text = rawText.length > maxLength ? rawText.slice(0, maxLength) : rawText;
    if (hasSensitivePayload(text)) addIssue(input.issues, 'sensitive_payload_forbidden', input.path);
    if (hasImplementationDetail(text)) addIssue(input.issues, 'implementation_detail_forbidden', input.path);
    return text;
}

function readTextList(input: {
    value: unknown;
    path: string;
    issues: RuntimeDesignBriefValidationIssue[];
    requiredItems?: number;
    maxItems?: number;
}): string[] {
    if (!Array.isArray(input.value)) {
        addIssue(input.issues, 'array_required', input.path);
        return [];
    }
    const maxItems = input.maxItems || MAX_LIST;
    if (input.value.length > maxItems) addIssue(input.issues, 'array_too_long', input.path);
    const values = input.value.slice(0, maxItems).map((item, index) => readText({
        value: item,
        path: `${input.path}[${index}]`,
        issues: input.issues,
        required: true
    })).filter(Boolean);
    if (values.length < (input.requiredItems || 0)) addIssue(input.issues, 'array_items_missing', input.path);
    if (new Set(values).size !== values.length) addIssue(input.issues, 'array_items_duplicate', input.path);
    // 重复项去重后照收（advisory）
    return Array.from(new Set(values));
}

function readContextRefs(input: {
    value: unknown;
    path: string;
    issues: RuntimeDesignBriefValidationIssue[];
    allowedContextRefs: ReadonlySet<string>;
    requiredItems?: number;
}): string[] {
    const refs = readTextList({
        value: input.value,
        path: input.path,
        issues: input.issues,
        requiredItems: input.requiredItems,
        maxItems: 16
    });
    refs.forEach((ref, index) => {
        if (!input.allowedContextRefs.has(ref)) {
            addIssue(input.issues, 'context_ref_not_available', `${input.path}[${index}]`);
        }
    });
    // 引用不到的 ref 丢弃后照收（advisory），不为一个错 ref 驳回整张简报
    return refs.filter((ref) => input.allowedContextRefs.has(ref));
}

function readInputCoverage(input: {
    value: unknown;
    requiredInputKeys: readonly string[];
    optionalInputKeys: readonly string[];
    resolvedInputs: readonly RuntimeDesignBriefResolvedInput[];
    issues: RuntimeDesignBriefValidationIssue[];
}): RuntimeDesignBriefInputCoverage[] {
    // inputCoverage 是「可选的模型备注」（见 schema 描述）：事实性的覆盖状态由 Harness 从真实
    // 来源推导。因此这里**只做宽容读取**——不在 manifest 里的 key、超出条数、重复项、非法
    // status 一律忽略，不能因为备注写得不合格式而驳回整份简报。
    // 真机 2026-08-17：`array_too_long (inputCoverage)`（manifest 未登记 input 时上限为 0）与
    // `input_key_not_in_manifest` 让模型连撞 7 次，零写入。
    const rawItems = Array.isArray(input.value) ? input.value : [];
    const knownKeys = new Set([...input.requiredInputKeys, ...input.optionalInputKeys]);
    const declaredCoverage = new Map<string, {
        status?: RuntimeDesignBriefInputStatus;
        note?: string;
    }>();
    rawItems.slice(0, MAX_LIST).forEach((item, index) => {
        if (!isObject(item)) return;
        const path = `inputCoverage[${index}]`;
        const record = item;
        const inputKey = cleanInputKey(record.inputKey);
        const statusText = record.status !== undefined ? String(record.status || '').trim() : '';
        const note = readText({
            value: record.note,
            path: `${path}.note`,
            issues: input.issues,
            maxLength: 240
        });
        if (!inputKey || !knownKeys.has(inputKey) || declaredCoverage.has(inputKey)) return;
        declaredCoverage.set(inputKey, {
            ...(['provided', 'missing', 'assumed'].includes(statusText)
                ? { status: statusText as RuntimeDesignBriefInputStatus }
                : {}),
            ...(note ? { note } : {})
        });
    });
    const resolvedKeys = new Set(input.resolvedInputs.map((resolved) => resolved.inputKey));
    const outputKeys = [...input.requiredInputKeys, ...input.optionalInputKeys].filter((inputKey) => (
        input.requiredInputKeys.includes(inputKey)
        || resolvedKeys.has(inputKey)
        || declaredCoverage.has(inputKey)
    ));
    return outputKeys.map((inputKey) => {
        const declared = declaredCoverage.get(inputKey);
        const contextRefs = Array.from(new Set(
            input.resolvedInputs
                .filter((resolved) => resolved.inputKey === inputKey)
                .map((resolved) => resolved.contextRef)
        ));
        // 输入是否已提供是 Harness 从当前运行真实来源得出的事实。模型可以补充
        // assumed 语义和备注，但不能把已观察来源降级，也不能把无来源输入升级为 provided。
        let status: RuntimeDesignBriefInputStatus = 'missing';
        if (contextRefs.length > 0) {
            status = 'provided';
        } else if (declared?.status === 'assumed') {
            status = 'assumed';
        }
        return {
            inputKey,
            status,
            contextRefs,
            ...(declared?.note ? { note: declared.note } : {})
        };
    });
}

function normalizeInputKeys(values: readonly string[]): string[] {
    return Array.from(new Set(values.map(cleanInputKey).filter(Boolean)));
}

function buildResolvedInputContextRef(
    inputKey: string,
    sourceKind: SkillRuntimeInputSourceKind
): string {
    return `input:${inputKey}:${sourceKind}`;
}

export function resolveRuntimeDesignBriefInputs(input: {
    inputSources: SkillRuntimeInputSourceMap;
    availableSources: readonly RuntimeDesignBriefAvailableInputSource[];
}): RuntimeDesignBriefResolvedInput[] {
    const resolved: RuntimeDesignBriefResolvedInput[] = [];
    const seen = new Set<string>();
    for (const [rawInputKey, acceptedSourceKinds] of Object.entries(input.inputSources)) {
        const inputKey = cleanInputKey(rawInputKey);
        if (!inputKey) continue;
        for (const source of input.availableSources) {
            if (!acceptedSourceKinds.includes(source.sourceKind)) continue;
            const limitedKeys = normalizeInputKeys(source.inputKeys || []);
            if (limitedKeys.length > 0 && !limitedKeys.includes(inputKey)) continue;
            const contextRef = buildResolvedInputContextRef(inputKey, source.sourceKind);
            if (seen.has(contextRef)) continue;
            seen.add(contextRef);
            resolved.push({ inputKey, sourceKind: source.sourceKind, contextRef });
        }
    }
    return resolved;
}

function validateResolvedInputs(input: {
    resolvedInputs: readonly RuntimeDesignBriefResolvedInput[];
    inputSources: SkillRuntimeInputSourceMap;
    knownInputKeys: ReadonlySet<string>;
    issues: RuntimeDesignBriefValidationIssue[];
}): RuntimeDesignBriefResolvedInput[] {
    const valid: RuntimeDesignBriefResolvedInput[] = [];
    const seen = new Set<string>();
    input.resolvedInputs.forEach((item, index) => {
        const path = `resolvedInputs[${index}]`;
        const inputKey = cleanInputKey(item.inputKey);
        // 同一 Manifest 可包含多个 workMode 的输入来源；当前模式只消费自己的完整替换契约。
        if (!inputKey || !input.knownInputKeys.has(inputKey)) return;
        const acceptedSourceKinds = input.inputSources[inputKey] || [];
        if (!acceptedSourceKinds.includes(item.sourceKind)) {
            addIssue(input.issues, 'resolved_input_source_not_allowed', `${path}.sourceKind`);
            return;
        }
        const expectedContextRef = buildResolvedInputContextRef(inputKey, item.sourceKind);
        if (item.contextRef !== expectedContextRef) {
            addIssue(input.issues, 'resolved_input_ref_invalid', `${path}.contextRef`);
            return;
        }
        if (seen.has(expectedContextRef)) return;
        seen.add(expectedContextRef);
        valid.push({ inputKey, sourceKind: item.sourceKind, contextRef: expectedContextRef });
    });
    return valid;
}

function describeWorkModeRequirement(input: {
    workModeRequired?: boolean;
    expectedWorkMode?: RuntimeDesignWorkMode;
}): string {
    if (!input.workModeRequired) {
        return 'workMode is optional because the selected Skill has no mode-dependent contract.';
    }
    if (input.expectedWorkMode) {
        return `Confirm the upstream-selected workMode ${input.expectedWorkMode}; R1 cannot replace it with another mode.`;
    }
    return 'Declare workMode explicitly; the selected Skill contract uses it and the Harness will not infer it from keywords.';
}

function describeWorkModeSemantics(): string {
    const definitions = DESIGN_WORK_MODES.map((workMode) => (
        `${workMode}: ${DESIGN_WORK_MODE_SEMANTICS[workMode]}`
    )).join('; ');
    return [
        `Work-mode semantics: ${definitions}.`,
        'For a bounded change inside an existing document choose edit_existing; choose template_fill only when populating the reusable template across its intended content slots.'
    ].join(' ');
}

export function validateRuntimeDesignBriefDeclaration(input: {
    value: unknown;
    requiredInputKeys: readonly string[];
    optionalInputKeys: readonly string[];
    allowedContextRefs: readonly string[];
    inputSources: SkillRuntimeInputSourceMap;
    resolvedInputs: readonly RuntimeDesignBriefResolvedInput[];
    workModeRequired?: boolean;
    expectedWorkMode?: RuntimeDesignWorkMode;
}): RuntimeDesignBriefValidationResult {
    const issues: RuntimeDesignBriefValidationIssue[] = [];
    const record = isObject(input.value) ? input.value : {};
    if (!isObject(input.value)) addIssue(issues, 'object_required', 'brief');
    validateKeys(
        record,
        [
            'workMode',
            'taskGoal',
            'deliverables',
            'targetAudience',
            'channel',
            'outputRequirements',
            'constraints',
            'inputCoverage',
            'contextRefs'
        ],
        'brief',
        issues
    );
    const requiredInputKeys = normalizeInputKeys(input.requiredInputKeys);
    const optionalInputKeys = normalizeInputKeys(input.optionalInputKeys)
        .filter((key) => !requiredInputKeys.includes(key));
    const knownInputKeys = new Set([...requiredInputKeys, ...optionalInputKeys]);
    const resolvedInputs = validateResolvedInputs({
        resolvedInputs: input.resolvedInputs,
        inputSources: input.inputSources,
        knownInputKeys,
        issues
    });
    const allowedContextRefs = new Set([
        ...input.allowedContextRefs.map((ref) => String(ref || '').trim()).filter(Boolean),
        ...resolvedInputs.map((item) => item.contextRef)
    ]);
    const workModeText = String(record.workMode || '').trim() as RuntimeDesignWorkMode;
    if (input.workModeRequired && !workModeText) addIssue(issues, 'work_mode_required', 'workMode');
    if (workModeText && !DESIGN_WORK_MODES.includes(workModeText)) {
        addIssue(issues, 'work_mode_invalid', 'workMode');
    }
    if (workModeText && input.expectedWorkMode && workModeText !== input.expectedWorkMode) {
        addIssue(issues, 'work_mode_identity_mismatch', 'workMode');
    }
    const declaredContextRefs = readContextRefs({
        value: record.contextRefs,
        path: 'contextRefs',
        issues,
        allowedContextRefs,
        requiredItems: 1
    });
    const inputCoverage = readInputCoverage({
        value: record.inputCoverage,
        requiredInputKeys,
        optionalInputKeys,
        resolvedInputs,
        issues
    });
    const contextRefs = Array.from(new Set([
        ...declaredContextRefs,
        ...inputCoverage.flatMap((item) => item.contextRefs)
    ]));
    const payload: RuntimeDesignBriefDeclarationPayload = {
        ...(workModeText && DESIGN_WORK_MODES.includes(workModeText) ? { workMode: workModeText } : {}),
        taskGoal: readText({ value: record.taskGoal, path: 'taskGoal', issues, required: true }),
        deliverables: readTextList({
            value: record.deliverables,
            path: 'deliverables',
            issues,
            requiredItems: 1,
            maxItems: 8
        }),
        ...(readText({ value: record.targetAudience, path: 'targetAudience', issues })
            ? { targetAudience: String(record.targetAudience).trim() }
            : {}),
        ...(readText({ value: record.channel, path: 'channel', issues })
            ? { channel: String(record.channel).trim() }
            : {}),
        outputRequirements: readTextList({
            value: record.outputRequirements,
            path: 'outputRequirements',
            issues,
            maxItems: 12
        }),
        constraints: readTextList({ value: record.constraints, path: 'constraints', issues, maxItems: 16 }),
        inputCoverage,
        contextRefs
    };
    // 表单洁癖不当门票（真机 08-14→08-18：array_too_long / input_key_not_in_manifest / unknown_field 把模型
    // 正确的设计判断连拒 4–7 次）：能自动归一的（超长截断、重复去重、多余字段丢弃、多写的 inputKey 忽略、
    // 引用不可用的 ref 丢弃、措辞里带工具词）只作提醒；只有真缺东西（目标 / 交付物 / workMode）才驳回。
    const blockingIssues = issues.filter((issue) => !ADVISORY_ISSUE_CODES.has(issue.code));
    if (blockingIssues.length > 0) {
        return { ok: false, readiness: 'invalid', issues: blockingIssues };
    }
    const requiredCoverage = new Map(
        inputCoverage
            .filter((item) => requiredInputKeys.includes(item.inputKey))
            .map((item) => [item.inputKey, item.status])
    );
    const readiness: RuntimeDesignBriefDeclaration['readiness'] = requiredInputKeys.every(
        (key) => requiredCoverage.get(key) === 'provided'
    ) ? 'ready' : 'needs_input';
    return {
        ok: true,
        readiness,
        declaration: {
            version: 'runtime-design-brief-declaration/v0',
            source: 'model_tool_call',
            readiness,
            payload,
            boundaries: {
                modelAuthored: true,
                harnessValidatedOnly: true,
                harnessResolvesInputBindings: true,
                harnessNormalizesInputCoverage: true,
                manifestInputsAreSourceOfTruth: true,
                categoryNeutral: true,
                executesTools: false,
                grantsPermission: false,
                autoActivatesCapabilities: false,
                countsAsTaskProgress: false,
                countsAsQualityPass: false
            }
        },
        issues: []
    };
}

export function buildRuntimeDesignBriefDigest(input: {
    declaration: RuntimeDesignBriefDeclaration;
    requiredInputKeys: readonly string[];
}): RuntimeDesignBriefDigest {
    const requiredInputKeys = normalizeInputKeys(input.requiredInputKeys);
    const coverage = new Map(input.declaration.payload.inputCoverage.map((item) => [item.inputKey, item.status]));
    const missingRequiredInputKeys = requiredInputKeys.filter((key) => coverage.get(key) === 'missing');
    const assumedRequiredInputKeys = requiredInputKeys.filter((key) => coverage.get(key) === 'assumed');
    return {
        version: 'runtime-design-brief-digest/v0',
        readiness: input.declaration.readiness,
        ...(input.declaration.payload.workMode ? { workMode: input.declaration.payload.workMode } : {}),
        taskGoal: input.declaration.payload.taskGoal,
        deliverables: input.declaration.payload.deliverables.slice(0, 8),
        requiredInputCount: requiredInputKeys.length,
        providedRequiredInputCount: requiredInputKeys.filter((key) => coverage.get(key) === 'provided').length,
        missingRequiredInputKeys,
        assumedRequiredInputKeys,
        contextRefs: input.declaration.payload.contextRefs.slice(0, 16),
        constraintCount: input.declaration.payload.constraints.length,
        boundaries: {
            digestOnly: true,
            modelAuthored: true,
            changesTaskResult: false,
            grantsPermission: false
        }
    };
}

export function buildDeclareDesignBriefToolSchema(input: {
    requiredInputKeys: readonly string[];
    optionalInputKeys: readonly string[];
    allowedContextRefs: readonly string[];
    inputSources: SkillRuntimeInputSourceMap;
    resolvedInputs: readonly RuntimeDesignBriefResolvedInput[];
    workModeRequired?: boolean;
    workModeInputContracts?: RuntimeDesignBriefWorkModeInputContracts;
    expectedWorkMode?: RuntimeDesignWorkMode;
}): RuntimeDesignBriefToolSchema {
    const requiredInputKeys = normalizeInputKeys(input.requiredInputKeys);
    const optionalInputKeys = normalizeInputKeys(input.optionalInputKeys)
        .filter((key) => !requiredInputKeys.includes(key));
    const workModeInputContracts = Object.fromEntries(
        DESIGN_WORK_MODES.flatMap((workMode) => {
            const contract = input.workModeInputContracts?.[workMode];
            if (!contract) return [];
            return [[workMode, {
                requiredInputKeys: normalizeInputKeys(contract.requiredInputKeys),
                optionalInputKeys: normalizeInputKeys(contract.optionalInputKeys)
            }]];
        })
    ) as RuntimeDesignBriefWorkModeInputContracts;
    const workModeContractEntries = DESIGN_WORK_MODES.flatMap((workMode) => {
        const contract = workModeInputContracts[workMode];
        return contract ? [[workMode, contract] as const] : [];
    });
    const knownInputKeys = normalizeInputKeys([
        ...requiredInputKeys,
        ...optionalInputKeys,
        ...workModeContractEntries.flatMap(([, contract]) => [
            ...contract.requiredInputKeys,
            ...contract.optionalInputKeys
        ])
    ]);
    const schemaResolvedInputs = input.resolvedInputs.filter((item) => (
        knownInputKeys.includes(item.inputKey)
        && (input.inputSources[item.inputKey] || []).includes(item.sourceKind)
        && item.contextRef === buildResolvedInputContextRef(item.inputKey, item.sourceKind)
    ));
    const contextRefs = Array.from(new Set(
        input.allowedContextRefs
            .map((ref) => String(ref || '').trim())
            .filter((ref) => Boolean(ref) && !ref.startsWith('input:'))
    ));
    const requiredSummary = requiredInputKeys.length > 0 ? requiredInputKeys.join(', ') : 'none';
    const optionalSummary = optionalInputKeys.length > 0 ? optionalInputKeys.join(', ') : 'none';
    const workModeSummary = workModeContractEntries.map(([workMode, contract]) => {
        const required = contract.requiredInputKeys.length > 0
            ? contract.requiredInputKeys.join(', ')
            : 'none';
        const optional = contract.optionalInputKeys.length > 0
            ? contract.optionalInputKeys.join(', ')
            : 'none';
        return `${workMode}: required=[${required}], optional=[${optional}]`;
    }).join('; ');
    const usesWorkModeContracts = workModeContractEntries.length > 0;
    const resolvedInputSummary = knownInputKeys.map((inputKey) => {
        const refs = schemaResolvedInputs
            .filter((item) => item.inputKey === inputKey)
            .map((item) => item.contextRef);
        return `${inputKey}=[${refs.join(', ') || 'missing'}]`;
    }).join('; ');
    return {
        name: DECLARE_DESIGN_BRIEF_TOOL_NAME,
        description: [
            'Declare the current R1 design brief as model-authored structured context before strategy or execution.',
            describeWorkModeRequirement(input),
            describeWorkModeSemantics(),
            ...(usesWorkModeContracts
                ? [
                    `Work-mode input contracts from the selected Skill manifest: ${workModeSummary}.`,
                    'Select workMode first, then report the complete replacement contract for that mode; do not copy inputs from the default or another mode.'
                ]
                : [
                    `Required inputs from the selected Skill manifest: ${requiredSummary}.`,
                    `Optional inputs from the selected Skill manifest: ${optionalSummary}.`
                ]),
            `Harness-resolved input refs by inputKey: ${resolvedInputSummary || 'none'}.`,
            'inputCoverage is optional model guidance using inputKey, an advisory status and an optional note. The Harness emits the factual coverage for every required input from resolved runtime sources: an observed source is always provided, an unresolved source is missing, and omitted required keys are synthesized as missing. The model cannot downgrade observed sources or upgrade unresolved sources; do not copy internal input refs.',
            'Missing or assumed required inputs keep the brief in needs_input. First obtain any Manifest-allowed environment source with readonly tools. Ask the user only when the missing fact is user-owned and cannot be observed from the current document, project or approved knowledge sources.',
            'This control tool does not execute Photoshop, activate capabilities, grant permission, count as progress or prove design quality.'
        ].join(' '),
        inputSchema: {
            type: 'object',
            properties: {
                workMode: {
                    type: 'string',
                    enum: input.expectedWorkMode ? [input.expectedWorkMode] : [...DESIGN_WORK_MODES],
                    description: describeWorkModeSemantics()
                },
                taskGoal: { type: 'string', minLength: 1, maxLength: MAX_TEXT },
                deliverables: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 8,
                    items: { type: 'string', minLength: 1, maxLength: MAX_TEXT }
                },
                targetAudience: { type: 'string', maxLength: MAX_TEXT },
                channel: { type: 'string', maxLength: MAX_TEXT },
                outputRequirements: {
                    type: 'array',
                    maxItems: 12,
                    items: { type: 'string', minLength: 1, maxLength: MAX_TEXT }
                },
                constraints: {
                    type: 'array',
                    maxItems: 16,
                    items: { type: 'string', minLength: 1, maxLength: MAX_TEXT }
                },
                inputCoverage: {
                    type: 'array',
                    description: 'Optional model notes about inputs (may be omitted). Harness normalizes factual status and generates omitted required entries from resolved runtime sources; entries for unknown keys are ignored, never rejected.',
                    minItems: 0,
                    maxItems: MAX_LIST,
                    items: {
                        type: 'object',
                        properties: {
                            inputKey: {
                                type: 'string',
                                ...(knownInputKeys.length > 0 ? { enum: knownInputKeys } : {})
                            },
                            status: { type: 'string', enum: ['provided', 'missing', 'assumed'] },
                            note: { type: 'string', maxLength: 240 }
                        },
                        required: ['inputKey'],
                        additionalProperties: false
                    }
                },
                contextRefs: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 16,
                    items: {
                        type: 'string',
                        ...(contextRefs.length > 0 ? { enum: contextRefs } : {})
                    }
                }
            },
            required: [
                ...(input.workModeRequired ? ['workMode'] : []),
                'taskGoal',
                'deliverables',
                'outputRequirements',
                'constraints',
                'contextRefs'
            ],
            additionalProperties: false
        }
    };
}

export function isDesignBriefControlTool(value: unknown): boolean {
    return String(value || '').trim() === DECLARE_DESIGN_BRIEF_TOOL_NAME;
}
