/**
 * R3 Runtime Design Strategy Declaration。
 *
 * 这是现有 immutable CreativeStrategy artifact 的运行时声明桥：复用其通用字段类型，
 * 但不伪造 artifact meta/contextSnapshotRef/contentHash，也不带品类专属 contentModules。
 * 内容由模型通过结构化 Tool call 提交；Harness 只校验，不生成、不补默认、不评价审美。
 */

import type { Assumption, MissingInput } from './contracts/common';
import type { CreativeStrategy, StrategyVariant } from './contracts/creative-strategy';

export const DECLARE_DESIGN_STRATEGY_TOOL_NAME = 'declareDesignStrategy';

export type RuntimeDesignStrategyObjective = CreativeStrategy['payload']['objective'];
export type RuntimeDesignStrategyMessageArchitecture = CreativeStrategy['payload']['messageArchitecture'];
export type RuntimeDesignStrategyCopyDirection = CreativeStrategy['payload']['copyDirection'];
export type RuntimeDesignStrategyVisualDirection = CreativeStrategy['payload']['visualDirection'];

export interface RuntimeDesignStrategyDeclarationPayload {
    stageGoal: string;
    objective: RuntimeDesignStrategyObjective;
    messageArchitecture: RuntimeDesignStrategyMessageArchitecture;
    copyDirection: RuntimeDesignStrategyCopyDirection;
    visualDirection: RuntimeDesignStrategyVisualDirection;
    /**
     * 开放创意存在真实方向不确定性时，模型可提交 2–3 个低成本文字方向用于比较。
     * 确定性生产、局部修改或方向已明确时应省略；Harness 不生成候选，也不强制探索。
     */
    directionExploration?: StrategyVariant[];
    /** 模型比较后选择的方向；提交 directionExploration 时必填，Harness 不会默认选择第一项。 */
    selectedDirectionId?: string;
    /** 可选的模型选择依据；仅记录判断，不构成质量通过、权限或阶段推进证据。 */
    selectionRationale?: string;
    constraints: string[];
    contextRefs: string[];
    assumptions: Assumption[];
    missingInputs: MissingInput[];
}

export interface RuntimeDesignStrategyDeclaration {
    version: 'runtime-design-strategy-declaration/v0';
    source: 'model_tool_call';
    readiness: 'ready' | 'needs_input';
    payload: RuntimeDesignStrategyDeclarationPayload;
    boundaries: {
        modelAuthored: true;
        harnessValidatedOnly: true;
        artifactPublished: false;
        executesTools: false;
        grantsPermission: false;
        countsAsTaskProgress: false;
        countsAsQualityPass: false;
        categoryNeutral: true;
    };
}

export interface RuntimeDesignStrategyDigest {
    version: 'runtime-design-strategy-digest/v0';
    readiness: RuntimeDesignStrategyDeclaration['readiness'];
    stageGoal: string;
    primaryGoal: string;
    targetAudienceSummary: string;
    primaryMessage: string;
    moodKeywords: string[];
    compositionIntent: string[];
    directionExploration?: StrategyVariant[];
    selectedDirectionId?: string;
    selectionRationale?: string;
    contextRefs: string[];
    constraintCount: number;
    assumptionCount: number;
    missingInputCount: number;
    boundaries: {
        digestOnly: true;
        modelAuthored: true;
        artifactPublished: false;
        changesTaskResult: false;
    };
}

export interface RuntimeDesignStrategyValidationIssue {
    code: string;
    path: string;
}

export interface RuntimeDesignStrategyValidationResult {
    ok: boolean;
    readiness: 'invalid' | RuntimeDesignStrategyDeclaration['readiness'];
    declaration?: RuntimeDesignStrategyDeclaration;
    issues: RuntimeDesignStrategyValidationIssue[];
}

export interface RuntimeDesignStrategyToolSchema {
    name: typeof DECLARE_DESIGN_STRATEGY_TOOL_NAME;
    description: string;
    inputSchema: {
        type: 'object';
        properties: Record<string, any>;
        required: string[];
        additionalProperties: false;
    };
}

const MAX_TEXT = 320;
const MAX_LONG_TEXT = 600;
const MAX_LIST = 12;
const MIN_DIRECTION_VARIANTS = 2;
const MAX_DIRECTION_VARIANTS = 3;
const MAX_ISSUES = 30;
const LOCAL_PATH_PATTERN = /(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/]|\/(?:Users|home|tmp|var|private)\/)/;
const DATA_URL_PATTERN = /data:[^;,]{1,80}(?:;base64)?,/i;
const BASE64_PATTERN = /[A-Za-z0-9+/]{180,}={0,2}/;

function isObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function addIssue(
    issues: RuntimeDesignStrategyValidationIssue[],
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
    issues: RuntimeDesignStrategyValidationIssue[]
): void {
    const allowedSet = new Set(allowed);
    for (const key of Object.keys(value)) {
        if (!allowedSet.has(key)) addIssue(issues, 'unknown_field', `${path}.${key}`);
    }
}

function hasSensitivePayload(value: string): boolean {
    return LOCAL_PATH_PATTERN.test(value)
        || DATA_URL_PATTERN.test(value)
        || BASE64_PATTERN.test(value);
}

function hasImplementationDetail(value: string): boolean {
    return /\b(?:layerId|layerName|toolId|toolName|actionDescriptor|executeTool)\b/i.test(value)
        || /\b(?:create|set|get|move|render|export|delete|duplicate|select)[A-Z][A-Za-z0-9]+\b/.test(value)
        || /\b(?:Photoshop|UXP|PSD API|PS API)\b/i.test(value)
        || /(?:图层名|工具编号|工具调用|Photoshop\s*命令)/i.test(value)
        || /\b(?:x|y|width|height)\s*[:=]\s*-?\d/i.test(value);
}

function readText(input: {
    value: unknown;
    path: string;
    issues: RuntimeDesignStrategyValidationIssue[];
    required?: boolean;
    maxLength?: number;
}): string {
    if (typeof input.value !== 'string') {
        if (input.required || input.value !== undefined) addIssue(input.issues, 'text_required', input.path);
        return '';
    }
    const text = input.value.trim();
    if (input.required && !text) addIssue(input.issues, 'text_required', input.path);
    if (text.length > (input.maxLength || MAX_TEXT)) addIssue(input.issues, 'text_too_long', input.path);
    if (hasSensitivePayload(text)) addIssue(input.issues, 'sensitive_payload_forbidden', input.path);
    if (hasImplementationDetail(text)) addIssue(input.issues, 'implementation_detail_forbidden', input.path);
    return text;
}

function readTextList(input: {
    value: unknown;
    path: string;
    issues: RuntimeDesignStrategyValidationIssue[];
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
    }));
    if (values.filter(Boolean).length < (input.requiredItems || 0)) {
        addIssue(input.issues, 'array_items_missing', input.path);
    }
    if (new Set(values.filter(Boolean)).size !== values.filter(Boolean).length) {
        addIssue(input.issues, 'array_items_duplicate', input.path);
    }
    return values.filter(Boolean);
}

function readObjective(value: unknown, issues: RuntimeDesignStrategyValidationIssue[]): RuntimeDesignStrategyObjective {
    const record = isObject(value) ? value : {};
    if (!isObject(value)) addIssue(issues, 'object_required', 'objective');
    validateKeys(record, ['primaryGoal', 'secondaryGoals', 'targetAudienceSummary'], 'objective', issues);
    return {
        primaryGoal: readText({ value: record.primaryGoal, path: 'objective.primaryGoal', issues, required: true }),
        secondaryGoals: readTextList({ value: record.secondaryGoals, path: 'objective.secondaryGoals', issues, maxItems: 6 }),
        targetAudienceSummary: readText({
            value: record.targetAudienceSummary,
            path: 'objective.targetAudienceSummary',
            issues,
            required: true
        })
    };
}

function readMessageArchitecture(
    value: unknown,
    issues: RuntimeDesignStrategyValidationIssue[]
): RuntimeDesignStrategyMessageArchitecture {
    const record = isObject(value) ? value : {};
    if (!isObject(value)) addIssue(issues, 'object_required', 'messageArchitecture');
    validateKeys(
        record,
        ['primaryMessage', 'supportingMessages', 'supportingFacts', 'objectionsToResolve'],
        'messageArchitecture',
        issues
    );
    return {
        primaryMessage: readText({
            value: record.primaryMessage,
            path: 'messageArchitecture.primaryMessage',
            issues,
            required: true,
            maxLength: MAX_LONG_TEXT
        }),
        supportingMessages: readTextList({
            value: record.supportingMessages,
            path: 'messageArchitecture.supportingMessages',
            issues,
            maxItems: 8
        }),
        supportingFacts: readTextList({
            value: record.supportingFacts,
            path: 'messageArchitecture.supportingFacts',
            issues,
            maxItems: 8
        }),
        objectionsToResolve: readTextList({
            value: record.objectionsToResolve,
            path: 'messageArchitecture.objectionsToResolve',
            issues,
            maxItems: 8
        })
    };
}

function readCopyDirection(
    value: unknown,
    issues: RuntimeDesignStrategyValidationIssue[]
): RuntimeDesignStrategyCopyDirection {
    const record = isObject(value) ? value : {};
    if (!isObject(value)) addIssue(issues, 'object_required', 'copyDirection');
    validateKeys(
        record,
        ['toneKeywords', 'headlineOptions', 'subtitleOptions', 'tagOptions', 'prohibitedClaims'],
        'copyDirection',
        issues
    );
    return {
        toneKeywords: readTextList({ value: record.toneKeywords, path: 'copyDirection.toneKeywords', issues, maxItems: 8 }),
        headlineOptions: readTextList({ value: record.headlineOptions, path: 'copyDirection.headlineOptions', issues, maxItems: 6 }),
        subtitleOptions: readTextList({ value: record.subtitleOptions, path: 'copyDirection.subtitleOptions', issues, maxItems: 6 }),
        tagOptions: readTextList({ value: record.tagOptions, path: 'copyDirection.tagOptions', issues, maxItems: 8 }),
        prohibitedClaims: readTextList({
            value: record.prohibitedClaims,
            path: 'copyDirection.prohibitedClaims',
            issues,
            maxItems: 8
        })
    };
}

function readVisualDirection(
    value: unknown,
    issues: RuntimeDesignStrategyValidationIssue[]
): RuntimeDesignStrategyVisualDirection {
    const record = isObject(value) ? value : {};
    if (!isObject(value)) addIssue(issues, 'object_required', 'visualDirection');
    validateKeys(
        record,
        ['moodKeywords', 'paletteIntent', 'typographyIntent', 'compositionIntent', 'imageTreatment', 'density'],
        'visualDirection',
        issues
    );
    const density = String(record.density || '').trim();
    if (!['low', 'medium', 'high'].includes(density)) addIssue(issues, 'density_invalid', 'visualDirection.density');
    return {
        moodKeywords: readTextList({
            value: record.moodKeywords,
            path: 'visualDirection.moodKeywords',
            issues,
            requiredItems: 1,
            maxItems: 8
        }),
        paletteIntent: readTextList({ value: record.paletteIntent, path: 'visualDirection.paletteIntent', issues, maxItems: 8 }),
        typographyIntent: readTextList({
            value: record.typographyIntent,
            path: 'visualDirection.typographyIntent',
            issues,
            maxItems: 8
        }),
        compositionIntent: readTextList({
            value: record.compositionIntent,
            path: 'visualDirection.compositionIntent',
            issues,
            requiredItems: 1,
            maxItems: 8
        }),
        imageTreatment: readTextList({ value: record.imageTreatment, path: 'visualDirection.imageTreatment', issues, maxItems: 8 }),
        density: ['low', 'medium', 'high'].includes(density)
            ? density as RuntimeDesignStrategyVisualDirection['density']
            : 'medium'
    };
}

function readDirectionExploration(
    value: unknown,
    issues: RuntimeDesignStrategyValidationIssue[]
): StrategyVariant[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) {
        addIssue(issues, 'array_required', 'directionExploration');
        return [];
    }
    if (value.length < MIN_DIRECTION_VARIANTS) {
        addIssue(issues, 'direction_variants_missing', 'directionExploration');
    }
    if (value.length > MAX_DIRECTION_VARIANTS) {
        addIssue(issues, 'array_too_long', 'directionExploration');
    }
    const ids = new Set<string>();
    return value.slice(0, MAX_DIRECTION_VARIANTS).map((item, index) => {
        const path = `directionExploration[${index}]`;
        const record = isObject(item) ? item : {};
        if (!isObject(item)) addIssue(issues, 'object_required', path);
        validateKeys(
            record,
            ['variantId', 'label', 'intent', 'messageOverride', 'visualOverride'],
            path,
            issues
        );
        const variantId = readText({
            value: record.variantId,
            path: `${path}.variantId`,
            issues,
            required: true
        });
        if (ids.has(variantId)) addIssue(issues, 'id_duplicate', `${path}.variantId`);
        ids.add(variantId);
        const messageOverride = readText({
            value: record.messageOverride,
            path: `${path}.messageOverride`,
            issues,
            maxLength: MAX_LONG_TEXT
        });
        const visualOverride = record.visualOverride === undefined
            ? undefined
            : readTextList({
                value: record.visualOverride,
                path: `${path}.visualOverride`,
                issues,
                maxItems: 8
            });
        return {
            variantId,
            label: readText({ value: record.label, path: `${path}.label`, issues, required: true }),
            intent: readText({
                value: record.intent,
                path: `${path}.intent`,
                issues,
                required: true,
                maxLength: MAX_LONG_TEXT
            }),
            ...(messageOverride ? { messageOverride } : {}),
            ...(visualOverride ? { visualOverride } : {})
        };
    });
}

function readAssumptions(value: unknown, issues: RuntimeDesignStrategyValidationIssue[]): Assumption[] {
    if (!Array.isArray(value)) {
        addIssue(issues, 'array_required', 'assumptions');
        return [];
    }
    if (value.length > 8) addIssue(issues, 'array_too_long', 'assumptions');
    const ids = new Set<string>();
    return value.slice(0, 8).map((item, index) => {
        const path = `assumptions[${index}]`;
        const record = isObject(item) ? item : {};
        if (!isObject(item)) addIssue(issues, 'object_required', path);
        validateKeys(record, ['assumptionId', 'statement', 'confidence', 'requiresConfirmation'], path, issues);
        const assumptionId = readText({ value: record.assumptionId, path: `${path}.assumptionId`, issues, required: true });
        if (ids.has(assumptionId)) addIssue(issues, 'id_duplicate', `${path}.assumptionId`);
        ids.add(assumptionId);
        const confidence = Number(record.confidence);
        if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
            addIssue(issues, 'confidence_invalid', `${path}.confidence`);
        }
        if (typeof record.requiresConfirmation !== 'boolean') {
            addIssue(issues, 'boolean_required', `${path}.requiresConfirmation`);
        }
        return {
            assumptionId,
            statement: readText({ value: record.statement, path: `${path}.statement`, issues, required: true }),
            confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0,
            requiresConfirmation: record.requiresConfirmation === true
        };
    });
}

function readMissingInputs(value: unknown, issues: RuntimeDesignStrategyValidationIssue[]): MissingInput[] {
    if (!Array.isArray(value)) {
        addIssue(issues, 'array_required', 'missingInputs');
        return [];
    }
    if (value.length > 8) addIssue(issues, 'array_too_long', 'missingInputs');
    const ids = new Set<string>();
    return value.slice(0, 8).map((item, index) => {
        const path = `missingInputs[${index}]`;
        const record = isObject(item) ? item : {};
        if (!isObject(item)) addIssue(issues, 'object_required', path);
        validateKeys(record, ['inputId', 'field', 'question', 'severity', 'defaultPolicy'], path, issues);
        const inputId = readText({ value: record.inputId, path: `${path}.inputId`, issues, required: true });
        if (ids.has(inputId)) addIssue(issues, 'id_duplicate', `${path}.inputId`);
        ids.add(inputId);
        const severity = String(record.severity || '').trim();
        if (!['blocking', 'degradable', 'optional'].includes(severity)) {
            addIssue(issues, 'severity_invalid', `${path}.severity`);
        }
        const defaultPolicy = readText({ value: record.defaultPolicy, path: `${path}.defaultPolicy`, issues });
        return {
            inputId,
            field: readText({ value: record.field, path: `${path}.field`, issues, required: true }),
            question: readText({ value: record.question, path: `${path}.question`, issues, required: true }),
            severity: ['blocking', 'degradable', 'optional'].includes(severity)
                ? severity as MissingInput['severity']
                : 'blocking',
            ...(defaultPolicy ? { defaultPolicy } : {})
        };
    });
}

export function validateRuntimeDesignStrategyDeclaration(input: {
    value: unknown;
    allowedContextRefs: readonly string[];
}): RuntimeDesignStrategyValidationResult {
    const issues: RuntimeDesignStrategyValidationIssue[] = [];
    const record = isObject(input.value) ? input.value : {};
    if (!isObject(input.value)) addIssue(issues, 'object_required', 'strategy');
    validateKeys(
        record,
        [
            'stageGoal',
            'objective',
            'messageArchitecture',
            'copyDirection',
            'visualDirection',
            'directionExploration',
            'selectedDirectionId',
            'selectionRationale',
            'constraints',
            'contextRefs',
            'assumptions',
            'missingInputs'
        ],
        'strategy',
        issues
    );

    const contextRefs = readTextList({
        value: record.contextRefs,
        path: 'contextRefs',
        issues,
        requiredItems: 1,
        maxItems: 12
    });
    const allowedContextRefs = new Set(input.allowedContextRefs.map((ref) => String(ref || '').trim()).filter(Boolean));
    for (let index = 0; index < contextRefs.length; index += 1) {
        if (!allowedContextRefs.has(contextRefs[index])) {
            addIssue(issues, 'context_ref_not_available', `contextRefs[${index}]`);
        }
    }

    const directionExploration = readDirectionExploration(record.directionExploration, issues);
    const selectedDirectionId = readText({
        value: record.selectedDirectionId,
        path: 'selectedDirectionId',
        issues
    });
    const selectionRationale = readText({
        value: record.selectionRationale,
        path: 'selectionRationale',
        issues,
        maxLength: MAX_LONG_TEXT
    });
    if (selectedDirectionId && !directionExploration) {
        addIssue(issues, 'direction_exploration_required', 'selectedDirectionId');
    }
    if (directionExploration && !selectedDirectionId) {
        addIssue(issues, 'selected_direction_required', 'selectedDirectionId');
    }
    if (selectionRationale && !selectedDirectionId) {
        addIssue(issues, 'selected_direction_required', 'selectionRationale');
    }
    if (selectedDirectionId
        && directionExploration
        && !directionExploration.some((variant) => variant.variantId === selectedDirectionId)) {
        addIssue(issues, 'selected_direction_not_found', 'selectedDirectionId');
    }

    const payload: RuntimeDesignStrategyDeclarationPayload = {
        stageGoal: readText({ value: record.stageGoal, path: 'stageGoal', issues, required: true }),
        objective: readObjective(record.objective, issues),
        messageArchitecture: readMessageArchitecture(record.messageArchitecture, issues),
        copyDirection: readCopyDirection(record.copyDirection, issues),
        visualDirection: readVisualDirection(record.visualDirection, issues),
        ...(directionExploration ? { directionExploration } : {}),
        ...(selectedDirectionId ? { selectedDirectionId } : {}),
        ...(selectionRationale ? { selectionRationale } : {}),
        constraints: readTextList({ value: record.constraints, path: 'constraints', issues, maxItems: 12 }),
        contextRefs,
        assumptions: readAssumptions(record.assumptions, issues),
        missingInputs: readMissingInputs(record.missingInputs, issues)
    };
    if (issues.length > 0) return { ok: false, readiness: 'invalid', issues };

    const readiness: RuntimeDesignStrategyDeclaration['readiness'] = payload.missingInputs
        .some((item) => item.severity === 'blocking')
        ? 'needs_input'
        : 'ready';
    return {
        ok: true,
        readiness,
        declaration: {
            version: 'runtime-design-strategy-declaration/v0',
            source: 'model_tool_call',
            readiness,
            payload,
            boundaries: {
                modelAuthored: true,
                harnessValidatedOnly: true,
                artifactPublished: false,
                executesTools: false,
                grantsPermission: false,
                countsAsTaskProgress: false,
                countsAsQualityPass: false,
                categoryNeutral: true
            }
        },
        issues: []
    };
}

export function buildRuntimeDesignStrategyDigest(
    declaration: RuntimeDesignStrategyDeclaration
): RuntimeDesignStrategyDigest {
    return {
        version: 'runtime-design-strategy-digest/v0',
        readiness: declaration.readiness,
        stageGoal: declaration.payload.stageGoal,
        primaryGoal: declaration.payload.objective.primaryGoal,
        targetAudienceSummary: declaration.payload.objective.targetAudienceSummary,
        primaryMessage: declaration.payload.messageArchitecture.primaryMessage,
        moodKeywords: declaration.payload.visualDirection.moodKeywords.slice(0, 8),
        compositionIntent: declaration.payload.visualDirection.compositionIntent.slice(0, 8),
        ...(declaration.payload.directionExploration ? {
            directionExploration: declaration.payload.directionExploration.map((variant) => ({
                variantId: variant.variantId,
                label: variant.label,
                intent: variant.intent,
                ...(variant.messageOverride ? { messageOverride: variant.messageOverride } : {}),
                ...(variant.visualOverride
                    ? { visualOverride: variant.visualOverride.slice(0, 8) }
                    : {})
            }))
        } : {}),
        ...(declaration.payload.selectedDirectionId
            ? { selectedDirectionId: declaration.payload.selectedDirectionId }
            : {}),
        ...(declaration.payload.selectionRationale
            ? { selectionRationale: declaration.payload.selectionRationale }
            : {}),
        contextRefs: declaration.payload.contextRefs.slice(0, 12),
        constraintCount: declaration.payload.constraints.length,
        assumptionCount: declaration.payload.assumptions.length,
        missingInputCount: declaration.payload.missingInputs.length,
        boundaries: {
            digestOnly: true,
            modelAuthored: true,
            artifactPublished: false,
            changesTaskResult: false
        }
    };
}

export function buildDeclareDesignStrategyToolSchema(
    allowedContextRefs: readonly string[]
): RuntimeDesignStrategyToolSchema {
    const contextRefs = Array.from(new Set(
        allowedContextRefs.map((ref) => String(ref || '').trim()).filter(Boolean)
    ));
    const textArray = (description: string): Record<string, any> => ({
        type: 'array',
        items: { type: 'string' },
        maxItems: MAX_LIST,
        description
    });
    return {
        name: DECLARE_DESIGN_STRATEGY_TOOL_NAME,
        description: [
            'Declare the current R3 design strategy as structured model-authored context before execution planning.',
            'This records goals, message hierarchy, visual direction, constraints, assumptions and missing inputs only.',
            'For open creative uncertainty, directionExploration may contain 2–3 model-authored StrategyVariant directions; omit it when the direction is already clear or the task is deterministic.',
            'When directionExploration is submitted, selectedDirectionId must explicitly choose one submitted variant; never auto-select the first direction. selectionRationale remains optional. These fields do not become a permission, progress or quality gate.',
            'It does not execute Photoshop, grant permission, complete the task or publish a CreativeStrategy artifact.',
            'Use only contextRefs from the provided enum. Do not include coordinates, layer names, Tool ids, commands or local paths.',
            'missingInputs.severity=blocking means the input can ONLY be supplied by the user; inputs you can obtain yourself via observation or search tools (project images, document structure, references) must be gathered BEFORE declaring and must NOT be marked blocking.'
        ].join(' '),
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                stageGoal: { type: 'string', maxLength: MAX_TEXT },
                objective: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        primaryGoal: { type: 'string', maxLength: MAX_TEXT },
                        secondaryGoals: textArray('Secondary design goals.'),
                        targetAudienceSummary: { type: 'string', maxLength: MAX_TEXT }
                    },
                    required: ['primaryGoal', 'secondaryGoals', 'targetAudienceSummary']
                },
                messageArchitecture: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        primaryMessage: { type: 'string', maxLength: MAX_LONG_TEXT },
                        supportingMessages: textArray('Supporting messages.'),
                        supportingFacts: textArray('Observed or supplied facts that support the message.'),
                        objectionsToResolve: textArray('Questions or objections the design should resolve.')
                    },
                    required: ['primaryMessage', 'supportingMessages', 'supportingFacts', 'objectionsToResolve']
                },
                copyDirection: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        toneKeywords: textArray('Copy tone keywords.'),
                        headlineOptions: textArray('Headline directions, not final unsupported claims.'),
                        subtitleOptions: textArray('Subtitle directions.'),
                        tagOptions: textArray('Optional tag directions.'),
                        prohibitedClaims: textArray('Claims the design must avoid.')
                    },
                    required: ['toneKeywords', 'headlineOptions', 'subtitleOptions', 'tagOptions', 'prohibitedClaims']
                },
                visualDirection: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        moodKeywords: textArray('At least one visual mood direction.'),
                        paletteIntent: textArray('Color relationships and intent, not hardcoded coordinates.'),
                        typographyIntent: textArray('Typography hierarchy and tone.'),
                        compositionIntent: textArray('At least one composition intent.'),
                        imageTreatment: textArray('Image treatment intent.'),
                        density: { type: 'string', enum: ['low', 'medium', 'high'] }
                    },
                    required: ['moodKeywords', 'paletteIntent', 'typographyIntent', 'compositionIntent', 'imageTreatment', 'density']
                },
                directionExploration: {
                    type: 'array',
                    minItems: MIN_DIRECTION_VARIANTS,
                    maxItems: MAX_DIRECTION_VARIANTS,
                    description: 'Optional 2–3 model-authored creative directions for genuine open-ended uncertainty. Omit for deterministic work, precise edits or an already clear direction.',
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            variantId: { type: 'string', maxLength: MAX_TEXT },
                            label: { type: 'string', maxLength: MAX_TEXT },
                            intent: { type: 'string', maxLength: MAX_LONG_TEXT },
                            messageOverride: { type: 'string', maxLength: MAX_LONG_TEXT },
                            visualOverride: {
                                type: 'array',
                                items: { type: 'string' },
                                maxItems: 8,
                                description: 'Optional visual-direction differences from the base strategy.'
                            }
                        },
                        required: ['variantId', 'label', 'intent']
                    }
                },
                selectedDirectionId: {
                    type: 'string',
                    maxLength: MAX_TEXT,
                    description: 'Model-selected variantId after comparison. Required when directionExploration is submitted; do not default to the first direction.'
                },
                selectionRationale: {
                    type: 'string',
                    maxLength: MAX_LONG_TEXT,
                    description: 'Optional model-authored rationale for the selected direction; advisory only and never quality evidence.'
                },
                constraints: textArray('User, brand, safety and delivery constraints.'),
                contextRefs: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 12,
                    uniqueItems: true,
                    items: {
                        type: 'string',
                        ...(contextRefs.length > 0 ? { enum: contextRefs } : {})
                    }
                },
                assumptions: {
                    type: 'array',
                    maxItems: 8,
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            assumptionId: { type: 'string' },
                            statement: { type: 'string', maxLength: MAX_TEXT },
                            confidence: { type: 'number', minimum: 0, maximum: 1 },
                            requiresConfirmation: { type: 'boolean' }
                        },
                        required: ['assumptionId', 'statement', 'confidence', 'requiresConfirmation']
                    }
                },
                missingInputs: {
                    type: 'array',
                    maxItems: 8,
                    description: 'Only inputs the user alone can supply may use severity=blocking; self-obtainable inputs (observation/search) must be gathered before declaring instead.',
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            inputId: { type: 'string' },
                            field: { type: 'string' },
                            question: { type: 'string', maxLength: MAX_TEXT },
                            severity: { type: 'string', enum: ['blocking', 'degradable', 'optional'] },
                            defaultPolicy: { type: 'string', maxLength: MAX_TEXT }
                        },
                        required: ['inputId', 'field', 'question', 'severity']
                    }
                }
            },
            required: [
                'stageGoal',
                'objective',
                'messageArchitecture',
                'copyDirection',
                'visualDirection',
                'constraints',
                'contextRefs',
                'assumptions',
                'missingInputs'
            ]
        }
    };
}

export function isDesignStrategyControlTool(value: unknown): boolean {
    return String(value || '').trim() === DECLARE_DESIGN_STRATEGY_TOOL_NAME;
}
