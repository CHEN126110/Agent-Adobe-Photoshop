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

function projectSchemaNode(source: JsonSchema, rootSchema: JsonSchema): JsonSchema {
    assertStandaloneUnionIsRecoverable(source);
    if (isExplicitlyOpenObjectSchema(source)) {
        const opaqueProjection: JsonSchema = {
            type: 'string',
            description: describeOpaqueObject(source)
        };
        return schemaAllowsNull(source, rootSchema)
            ? { anyOf: [opaqueProjection, { type: 'null' }] }
            : opaqueProjection;
    }

    const projected = copySupportedScalarKeywords(source);
    const definitions = isRecord(source.$defs) ? source.$defs : undefined;
    if (definitions) {
        projected.$defs = Object.fromEntries(
            Object.entries(definitions)
                .filter((entry): entry is [string, JsonSchema] => isRecord(entry[1]))
                .map(([key, value]) => [key, projectSchemaNode(value, rootSchema)])
        );
    }

    if (Array.isArray(source.anyOf)) {
        projected.anyOf = source.anyOf
            .filter((branch): branch is JsonSchema => isRecord(branch))
            .map((branch) => projectSchemaNode(branch, rootSchema));
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
            .map((branch) => projectSchemaNode(branch, rootSchema));
    }

    if (isObjectSchema(source)) {
        const properties = readProperties(source) || {};
        const originalRequired = readRequired(source);
        const projectedProperties: Record<string, JsonSchema> = {};
        for (const [key, propertySchema] of Object.entries(properties)) {
            const projectedProperty = projectSchemaNode(propertySchema, rootSchema);
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
            projected.items = projectSchemaNode(source.items, rootSchema);
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
    return projectSchemaNode(source, source);
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
