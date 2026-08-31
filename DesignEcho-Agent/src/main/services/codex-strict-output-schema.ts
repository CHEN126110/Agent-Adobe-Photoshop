type JsonSchema = Record<string, unknown>;

const UNSUPPORTED_STRICT_SCHEMA_KEYS = new Set([
    'allOf',
    'else',
    'if',
    'not',
    'oneOf',
    'then'
]);

const DIRECTLY_SUPPORTED_SCHEMA_KEYS = new Set([
    '$ref',
    'const',
    'description',
    'enum',
    'exclusiveMaximum',
    'exclusiveMinimum',
    'format',
    'maxItems',
    'maxLength',
    'maximum',
    'minItems',
    'minLength',
    'minimum',
    'multipleOf',
    'pattern',
    'type'
]);

function isRecord(value: unknown): value is JsonSchema {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readProperties(schema: JsonSchema): Record<string, JsonSchema> | undefined {
    if (!isRecord(schema.properties)) return undefined;
    const properties: Record<string, JsonSchema> = {};
    for (const [key, value] of Object.entries(schema.properties)) {
        if (isRecord(value)) properties[key] = value;
    }
    return properties;
}

function readRequired(schema: JsonSchema): Set<string> {
    return new Set(
        Array.isArray(schema.required)
            ? schema.required.filter((value): value is string => typeof value === 'string')
            : []
    );
}

function isObjectSchema(schema: JsonSchema): boolean {
    const type = schema.type;
    return type === 'object'
        || (Array.isArray(type) && type.includes('object'))
        || isRecord(schema.properties);
}

function isExplicitlyOpenObjectSchema(schema: JsonSchema): boolean {
    if (!isObjectSchema(schema)) return false;
    if (schema.additionalProperties === true || isRecord(schema.additionalProperties)) return true;
    return !isRecord(schema.properties) && schema.additionalProperties !== false;
}

function resolveLocalSchemaRef(ref: string, rootSchema: JsonSchema): JsonSchema | undefined {
    if (ref === '#') return rootSchema;
    if (!ref.startsWith('#/')) return undefined;
    let current: unknown = rootSchema;
    for (const encodedPart of ref.slice(2).split('/')) {
        if (!isRecord(current)) return undefined;
        const part = encodedPart.replace(/~1/g, '/').replace(/~0/g, '~');
        current = current[part];
    }
    return isRecord(current) ? current : undefined;
}

function schemaAllowsNull(
    schema: JsonSchema,
    rootSchema: JsonSchema,
    visitedRefs: Set<string> = new Set()
): boolean {
    if (schema.const === null) return true;
    if (Array.isArray(schema.enum) && schema.enum.includes(null)) return true;
    const type = schema.type;
    if (type === 'null' || (Array.isArray(type) && type.includes('null'))) return true;
    for (const key of ['anyOf', 'oneOf'] as const) {
        const branches = schema[key];
        if (
            Array.isArray(branches)
            && branches.some((branch) => isRecord(branch) && schemaAllowsNull(branch, rootSchema, visitedRefs))
        ) {
            return true;
        }
    }
    const ref = typeof schema.$ref === 'string' ? schema.$ref : '';
    if (!ref || visitedRefs.has(ref)) return false;
    const resolved = resolveLocalSchemaRef(ref, rootSchema);
    if (!resolved) return false;
    const nextVisited = new Set(visitedRefs);
    nextVisited.add(ref);
    return schemaAllowsNull(resolved, rootSchema, nextVisited);
}

function copySupportedScalarKeywords(source: JsonSchema): JsonSchema {
    const result: JsonSchema = {};
    for (const [key, value] of Object.entries(source)) {
        if (UNSUPPORTED_STRICT_SCHEMA_KEYS.has(key)) continue;
        if (DIRECTLY_SUPPORTED_SCHEMA_KEYS.has(key)) result[key] = value;
    }
    return result;
}

// ---------------------------------------------------------------------------
// strict wire 丢弃的条件约束不能静默消失：allOf/if/then/else/not
// 与对象级 oneOf 被投影删除后，模型只看得到字段、看不到互斥关系，会产出被主机
// AJV 拒绝的组合。这里把被丢弃的条件转译成简洁、确定、长度受限的英文提示，附在
// 投影节点 description 上。提示只是信息补偿：原 AJV schema 仍是唯一执行校验，
// 提示不授予权限、不当完成依据、也绝不复制整份 JSON。
// ---------------------------------------------------------------------------

const MAX_STRICT_CONSTRAINT_HINT_NODE_CHARS = 600;
// 总量上限覆盖“全部工具拼成一个联合 schema”的一次投影：预算按节点顺序消费，
// 必须容得下位于联合后段的条件工具（如 placeImage），同时保持总量有界。
const MAX_STRICT_CONSTRAINT_HINT_TOTAL_CHARS = 6000;
const MIN_STRICT_CONSTRAINT_HINT_CHARS = 80;
const HOST_CHECKED_CONDITION = 'a host-checked condition';

export interface StrictConstraintHintBudget {
    remainingChars: number;
}

export function createStrictConstraintHintBudget(): StrictConstraintHintBudget {
    return { remainingChars: MAX_STRICT_CONSTRAINT_HINT_TOTAL_CHARS };
}

function formatConstraintValue(value: unknown): string {
    if (typeof value === 'string') {
        return value.length > 24 ? `${value.slice(0, 24)}…` : value;
    }
    if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
        return String(value);
    }
    return '…';
}

function formatConstraintEnum(values: unknown[]): string {
    const rendered = values.slice(0, 5).map(formatConstraintValue);
    const suffix = values.length > 5 ? ',…' : '';
    return `{${rendered.join(',')}${suffix}}`;
}

function readStringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : [];
}

function describeConstraintPropertyCondition(
    name: string,
    propSchema: JsonSchema,
    depth: number
): string {
    if (Array.isArray(propSchema.enum)) {
        return `${name} in ${formatConstraintEnum(propSchema.enum)}`;
    }
    if (propSchema.const !== undefined) {
        return `${name}=${formatConstraintValue(propSchema.const)}`;
    }
    const negated = propSchema.not;
    if (isRecord(negated) && Array.isArray(negated.enum)) {
        return `${name} not in ${formatConstraintEnum(negated.enum)}`;
    }
    if (isRecord(negated)) {
        return `${name} fails ${HOST_CHECKED_CONDITION}`;
    }
    if (isRecord(propSchema.properties) || Array.isArray(propSchema.required)) {
        const inner = describeConstraintCondition(propSchema, depth + 1);
        return inner === HOST_CHECKED_CONDITION
            ? `${name} matches ${HOST_CHECKED_CONDITION}`
            : `${name}(${inner})`;
    }
    return `${name} matches ${HOST_CHECKED_CONDITION}`;
}

function describeConstraintCondition(schema: JsonSchema, depth: number): string {
    if (depth > 4) return HOST_CHECKED_CONDITION;
    const parts: string[] = [];
    const required = readStringArray(schema.required);
    const properties = isRecord(schema.properties) ? schema.properties : undefined;
    const refined = new Set(properties ? Object.keys(properties) : []);
    const bareRequired = required.filter((name) => !refined.has(name));
    if (bareRequired.length > 0) parts.push(`non-null ${bareRequired.join(' & ')}`);
    if (properties) {
        for (const [name, propSchema] of Object.entries(properties)) {
            if (!isRecord(propSchema)) continue;
            parts.push(describeConstraintPropertyCondition(name, propSchema, depth));
        }
    }
    if (Array.isArray(schema.anyOf)) {
        const branches = schema.anyOf
            .filter(isRecord)
            .map((branch) => describeConstraintCondition(branch, depth + 1));
        if (branches.length > 0) parts.push(`any of [${branches.join(' | ')}]`);
    }
    if (isRecord(schema.not)) {
        parts.push(`not(${describeConstraintCondition(schema.not, depth + 1)})`);
    }
    return parts.length > 0 ? parts.join(' and ') : HOST_CHECKED_CONDITION;
}

function describeConstraintForbiddenFields(negated: JsonSchema, depth: number): string {
    const required = readStringArray(negated.required);
    const hasOnlyRequired = !isRecord(negated.properties) && !Array.isArray(negated.anyOf);
    if (required.length === 1 && hasOnlyRequired) {
        return `forbid non-null ${required[0]}`;
    }
    if (required.length > 1 && hasOnlyRequired) {
        return `never combine non-null ${required.join(' & ')}`;
    }
    if (Array.isArray(negated.anyOf)) {
        const forbiddenNames: string[] = [];
        let simple = true;
        for (const branch of negated.anyOf) {
            const branchRequired = isRecord(branch) ? readStringArray(branch.required) : [];
            if (isRecord(branch) && branchRequired.length === 1 && !isRecord(branch.properties)) {
                forbiddenNames.push(branchRequired[0]);
            } else {
                simple = false;
                break;
            }
        }
        if (simple && forbiddenNames.length > 0) {
            return `forbid non-null: ${forbiddenNames.join(', ')}`;
        }
    }
    return `never(${describeConstraintCondition(negated, depth + 1)})`;
}

function describeConstraintRequirement(schema: JsonSchema, depth: number): string {
    if (depth > 4) return `satisfy ${HOST_CHECKED_CONDITION}`;
    const parts: string[] = [];
    const required = readStringArray(schema.required);
    if (required.length > 0) parts.push(`require non-null: ${required.join(', ')}`);
    const properties = isRecord(schema.properties) ? schema.properties : undefined;
    if (properties) {
        for (const [name, propSchema] of Object.entries(properties)) {
            if (!isRecord(propSchema)) continue;
            parts.push(describeConstraintPropertyCondition(name, propSchema, depth));
        }
    }
    if (isRecord(schema.not)) parts.push(describeConstraintForbiddenFields(schema.not, depth));
    if (Array.isArray(schema.anyOf)) {
        const branches = schema.anyOf
            .filter(isRecord)
            .map((branch) => describeConstraintRequirement(branch, depth + 1));
        if (branches.length > 0) parts.push(`satisfy any of [${branches.join(' | ')}]`);
    }
    return parts.length > 0 ? parts.join('; ') : `satisfy ${HOST_CHECKED_CONDITION}`;
}

function collectDroppedConstraintClauses(source: JsonSchema): string[] {
    const clauses: string[] = [];
    const conditionalNodes: JsonSchema[] = [];
    if (isRecord(source.if)) conditionalNodes.push(source);
    if (Array.isArray(source.allOf)) {
        for (const branch of source.allOf) {
            if (isRecord(branch)) conditionalNodes.push(branch);
        }
    }
    for (const node of conditionalNodes) {
        if (isRecord(node.if)) {
            const condition = describeConstraintCondition(node.if, 0);
            let clause = isRecord(node.then)
                ? `if(${condition}) then(${describeConstraintRequirement(node.then, 0)})`
                : '';
            if (isRecord(node.else)) {
                const alternative = describeConstraintRequirement(node.else, 0);
                clause = clause
                    ? `${clause} else(${alternative})`
                    : `if not(${condition}) then(${alternative})`;
            }
            if (clause) clauses.push(clause);
        } else if (isRecord(node.not)) {
            clauses.push(describeConstraintForbiddenFields(node.not, 0));
        } else if (node !== source) {
            clauses.push(describeConstraintRequirement(node, 0));
        }
    }
    if (isRecord(source.not) && !isRecord(source.if)) {
        clauses.push(describeConstraintForbiddenFields(source.not, 0));
    }
    const oneOfDroppedByProjection = Array.isArray(source.oneOf)
        && (isObjectSchema(source) || source.type !== undefined || source.items !== undefined);
    if (oneOfDroppedByProjection && Array.isArray(source.oneOf)) {
        const branches = source.oneOf
            .filter(isRecord)
            .map((branch) => describeConstraintCondition(branch, 0));
        if (branches.length > 0) {
            clauses.push(`exactly one variant must hold: [${branches.join('] / [')}]`);
        }
    }
    return clauses;
}

/**
 * 把当前节点上会被 strict 投影丢弃的条件约束（allOf/if/then/else/not、对象级
 * oneOf）压缩成一段确定、长度受限的英文提示。同时明确 strict wire 的 null 在
 * 主机校验前会被恢复为“原可选字段缺失”，让模型知道用 null 表达“不提供”。
 * 单节点上限 MAX_STRICT_CONSTRAINT_HINT_NODE_CHARS；budget 控制整棵 schema
 * 的提示总量，超出后剩余节点不再产出提示（原 AJV 校验不受影响）。
 */
export function summarizeStrictWireDroppedConstraints(
    source: JsonSchema,
    budget: StrictConstraintHintBudget
): string | undefined {
    const clauses = collectDroppedConstraintClauses(source);
    if (clauses.length === 0) return undefined;
    if (budget.remainingChars < MIN_STRICT_CONSTRAINT_HINT_CHARS) return undefined;
    const hint = 'Host-enforced conditions (checked after null-restore; on this strict wire '
        + 'optional fields are nullable and null is removed before host validation, '
        + `i.e. null = field absent): ${clauses.join('; ')}.`;
    const nodeCap = Math.min(MAX_STRICT_CONSTRAINT_HINT_NODE_CHARS, budget.remainingChars);
    const bounded = hint.length > nodeCap ? `${hint.slice(0, nodeCap - 1)}…` : hint;
    budget.remainingChars -= bounded.length;
    return bounded;
}

function appendConstraintHint(projected: JsonSchema, hint: string | undefined): void {
    if (!hint) return;
    const existing = typeof projected.description === 'string' ? projected.description : '';
    projected.description = existing ? `${existing} ${hint}` : hint;
}

function describeOpaqueObject(source: JsonSchema): string {
    const original = typeof source.description === 'string' ? source.description.trim() : '';
    const wireNote = 'Return this free-form object as one JSON-encoded object string. The host restores and validates it before tool execution.';
    return original ? `${original} ${wireNote}` : wireNote;
}

function isStandaloneUnionSchema(source: JsonSchema): boolean {
    return source.type === undefined
        && source.items === undefined
        && !isRecord(source.properties)
        && typeof source.$ref !== 'string';
}

function unionBranchNeedsWireRestore(branch: JsonSchema): boolean {
    if (isObjectSchema(branch) || isExplicitlyOpenObjectSchema(branch)) return true;
    if (typeof branch.$ref === 'string') return true;
    if (branch.type === 'array' || (Array.isArray(branch.type) && branch.type.includes('array'))) {
        return isRecord(branch.items);
    }
    return false;
}

interface RecoverableDiscriminatedObjectUnion {
    discriminatorKey: string;
    branchesByValue: Map<string, JsonSchema>;
}

/**
 * A standalone object union is recoverable when every branch is a closed object and the
 * same required property carries a unique string const. The wire restorer can then select
 * exactly one original branch before removing nullable placeholders for optional fields.
 */
function readRecoverableDiscriminatedObjectUnion(
    source: JsonSchema
): RecoverableDiscriminatedObjectUnion | undefined {
    if (!isStandaloneUnionSchema(source) || !Array.isArray(source.anyOf) || source.anyOf.length === 0) {
        return undefined;
    }
    const branches = source.anyOf.filter((branch): branch is JsonSchema => isRecord(branch));
    if (branches.length !== source.anyOf.length
        || branches.some((branch) => !isObjectSchema(branch) || branch.additionalProperties !== false)) {
        return undefined;
    }

    const firstProperties = readProperties(branches[0]) || {};
    const firstRequired = readRequired(branches[0]);
    for (const [key, propertySchema] of Object.entries(firstProperties)) {
        if (!firstRequired.has(key) || typeof propertySchema.const !== 'string') continue;
        const branchesByValue = new Map<string, JsonSchema>();
        let valid = true;
        for (const branch of branches) {
            const properties = readProperties(branch) || {};
            const discriminator = properties[key];
            const value = discriminator?.const;
            if (!readRequired(branch).has(key)
                || typeof value !== 'string'
                || branchesByValue.has(value)) {
                valid = false;
                break;
            }
            branchesByValue.set(value, branch);
        }
        if (valid && branchesByValue.size === branches.length) {
            return { discriminatorKey: key, branchesByValue };
        }
    }
    return undefined;
}

function assertStandaloneUnionIsRecoverable(source: JsonSchema): void {
    if (!isStandaloneUnionSchema(source)) return;
    let branches: unknown[] = [];
    if (Array.isArray(source.anyOf)) {
        branches = source.anyOf;
    } else if (Array.isArray(source.oneOf)) {
        branches = source.oneOf;
    }
    if (branches.some((branch) => isRecord(branch) && unionBranchNeedsWireRestore(branch))
        && !readRecoverableDiscriminatedObjectUnion(source)) {
        throw new Error(
            'Codex strict output schema cannot safely project a standalone union whose branch requires wire restoration.'
        );
    }
}

function projectSchemaNode(
    source: JsonSchema,
    rootSchema: JsonSchema,
    hintBudget: StrictConstraintHintBudget
): JsonSchema {
    assertStandaloneUnionIsRecoverable(source);
    const constraintHint = summarizeStrictWireDroppedConstraints(source, hintBudget);
    if (isExplicitlyOpenObjectSchema(source)) {
        const opaqueProjection: JsonSchema = {
            type: 'string',
            description: describeOpaqueObject(source)
        };
        appendConstraintHint(opaqueProjection, constraintHint);
        return schemaAllowsNull(source, rootSchema)
            ? { anyOf: [opaqueProjection, { type: 'null' }] }
            : opaqueProjection;
    }

    const projected = copySupportedScalarKeywords(source);
    appendConstraintHint(projected, constraintHint);
    const definitions = isRecord(source.$defs) ? source.$defs : undefined;
    if (definitions) {
        projected.$defs = Object.fromEntries(
            Object.entries(definitions)
                .filter((entry): entry is [string, JsonSchema] => isRecord(entry[1]))
                .map(([key, value]) => [key, projectSchemaNode(value, rootSchema, hintBudget)])
        );
    }

    if (Array.isArray(source.anyOf)) {
        projected.anyOf = source.anyOf
            .filter((branch): branch is JsonSchema => isRecord(branch))
            .map((branch) => projectSchemaNode(branch, rootSchema, hintBudget));
    } else if (
        Array.isArray(source.oneOf)
        && !isObjectSchema(source)
        && source.type === undefined
        && source.items === undefined
    ) {
        // Strict Structured Outputs supports anyOf, not oneOf. A standalone union can be
        // projected safely; object-level partial oneOf constraints stay solely in the
        // original host validator because closing those partial branches would reject
        // sibling properties from the parent object.
        projected.anyOf = source.oneOf
            .filter((branch): branch is JsonSchema => isRecord(branch))
            .map((branch) => projectSchemaNode(branch, rootSchema, hintBudget));
    }

    if (isObjectSchema(source)) {
        const properties = readProperties(source) || {};
        const originalRequired = readRequired(source);
        const projectedProperties: Record<string, JsonSchema> = {};
        for (const [key, propertySchema] of Object.entries(properties)) {
            const projectedProperty = projectSchemaNode(propertySchema, rootSchema, hintBudget);
            projectedProperties[key] = originalRequired.has(key)
                ? projectedProperty
                : makeSchemaNullable(projectedProperty, propertySchema, rootSchema);
        }
        projected.type = 'object';
        projected.properties = projectedProperties;
        projected.required = Object.keys(projectedProperties);
        projected.additionalProperties = false;
    } else if (source.type === 'array' || (Array.isArray(source.type) && source.type.includes('array'))) {
        if (isRecord(source.items)) {
            projected.items = projectSchemaNode(source.items, rootSchema, hintBudget);
        }
    }

    if (
        schemaAllowsNull(source, rootSchema)
        && (isObjectSchema(source) || source.type === 'array')
    ) {
        return { anyOf: [projected, { type: 'null' }] };
    }
    return projected;
}

function makeSchemaNullable(
    projected: JsonSchema,
    original: JsonSchema,
    rootSchema: JsonSchema
): JsonSchema {
    if (schemaAllowsNull(original, rootSchema)) return projected;
    if (
        Object.prototype.hasOwnProperty.call(projected, 'const')
        || projected.$ref
        || Array.isArray(projected.enum)
    ) {
        return { anyOf: [projected, { type: 'null' }] };
    }
    const type = projected.type;
    if (typeof type === 'string' && type !== 'object' && type !== 'array') {
        const result: JsonSchema = { ...projected, type: [type, 'null'] };
        return result;
    }
    if (Array.isArray(type)) {
        const result: JsonSchema = {
            ...projected,
            type: type.includes('null') ? [...type] : [...type, 'null']
        };
        return result;
    }
    return { anyOf: [projected, { type: 'null' }] };
}

function restoreOpaqueObject(value: unknown): unknown {
    if (typeof value !== 'string') return value;
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

function restoreSchemaNode(
    value: unknown,
    schema: JsonSchema,
    rootSchema: JsonSchema,
    visitedRefs: Set<string>
): unknown {
    const ref = typeof schema.$ref === 'string' ? schema.$ref : '';
    if (ref && !visitedRefs.has(ref)) {
        const resolved = resolveLocalSchemaRef(ref, rootSchema);
        if (resolved) {
            const nextVisited = new Set(visitedRefs);
            nextVisited.add(ref);
            return restoreSchemaNode(value, resolved, rootSchema, nextVisited);
        }
    }
    const discriminatedUnion = readRecoverableDiscriminatedObjectUnion(schema);
    if (discriminatedUnion && isRecord(value)) {
        const discriminatorValue = value[discriminatedUnion.discriminatorKey];
        if (typeof discriminatorValue === 'string') {
            const branch = discriminatedUnion.branchesByValue.get(discriminatorValue);
            if (branch) {
                return restoreSchemaNode(value, branch, rootSchema, visitedRefs);
            }
        }
        // Never guess a branch. The host envelope or original Tool validator rejects the
        // unknown/ambiguous discriminator after restoration.
        return value;
    }
    if (isExplicitlyOpenObjectSchema(schema)) return restoreOpaqueObject(value);
    if (Array.isArray(value) && isRecord(schema.items)) {
        return value.map((item) => restoreSchemaNode(item, schema.items as JsonSchema, rootSchema, visitedRefs));
    }
    if (!isRecord(value) || !isObjectSchema(schema)) return value;

    const properties = readProperties(schema) || {};
    const required = readRequired(schema);
    const restored: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
        const propertySchema = properties[key];
        if (!propertySchema) {
            restored[key] = nestedValue;
            continue;
        }
        if (
            nestedValue === null
            && !required.has(key)
            && !schemaAllowsNull(propertySchema, rootSchema)
        ) {
            continue;
        }
        restored[key] = restoreSchemaNode(
            nestedValue,
            propertySchema,
            rootSchema,
            visitedRefs
        );
    }
    return restored;
}

/**
 * Codex outputSchema uses OpenAI strict Structured Outputs. Tool input schemas are more
 * permissive: optional keys may be omitted and some objects intentionally accept free-form
 * payloads. This projection is wire-only and never replaces the original Tool validator.
 */
export function buildCodexStrictOutputSchema(source: JsonSchema): JsonSchema {
    return projectSchemaNode(source, source, createStrictConstraintHintBudget());
}

/** Restore wire-only nullable omissions and opaque objects before original Tool validation. */
export function restoreCodexStrictOutputValue(value: unknown, source: JsonSchema): unknown {
    return restoreSchemaNode(value, source, source, new Set());
}

export function restoreCodexStrictOutputJson(text: string, source: JsonSchema): string {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return text;
    }
    return JSON.stringify(restoreCodexStrictOutputValue(parsed, source));
}
