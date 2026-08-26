/**
 * Provider text Tool-call markup compatibility.
 *
 * Some OpenAI-compatible models occasionally emit their internal DSML Tool
 * protocol in `content` instead of the native `tool_calls` field. This module
 * only decodes the transport shape. The Agent must still intersect recovered
 * names with the current model-visible Tool surface and run normal schema,
 * Tool Decision and execution-preflight checks.
 */

export interface TextEncodedToolCallCandidate {
    name: string;
    arguments: Record<string, unknown>;
}

/**
 * 协议前缀里的竖线同时接受半角 `|` 与全角 `｜`(U+FF5C)，且允许连写多个。
 *
 * DeepSeek 系模型的特殊 token 用的是全角竖线且成对出现（真机样本：
 * `<｜｜DSML｜｜invoke name="searchProjectResources">`）。只认半角单竖线时，
 * 标记识别、工具恢复与用户正文清洗三条路径会同时失效——协议原文直接显示给用户，
 * 工具却一个也没执行。这里放宽的是分隔符形态，不是协议结构：仍要求完整的
 * `<…DSML…invoke/parameter…>` 配对，正文中孤立的全角竖线不会被误伤。
 */
const DSML_PREFIX_PATTERN = String.raw`\s*[|｜]+\s*DSML\s*[|｜]+\s*`;
const DSML_INVOKE_PATTERN = new RegExp(
    `<${DSML_PREFIX_PATTERN}invoke\\s+name\\s*=\\s*(["'])([^"']+)\\1[^>]*>([\\s\\S]*?)<\\/${DSML_PREFIX_PATTERN}invoke\\s*>`,
    'giu'
);
const DSML_PARAMETER_PATTERN = new RegExp(
    `<${DSML_PREFIX_PATTERN}parameter\\s+name\\s*=\\s*(["'])([^"']+)\\1([^>]*)>([\\s\\S]*?)<\\/${DSML_PREFIX_PATTERN}parameter\\s*>`,
    'giu'
);
const DSML_PROTOCOL_MARKER_PATTERN = new RegExp(
    `<\\s*\\/?${DSML_PREFIX_PATTERN}(?:tool_calls?|function_calls?|invoke|parameter|画面处理)(?=\\s|>)`,
    'iu'
);
const DSML_COMPLETE_CONTAINER_PATTERN = new RegExp(
    `<${DSML_PREFIX_PATTERN}(?:tool_calls?|function_calls?|画面处理)(?=\\s|>)[^>]*>[\\s\\S]*?<\\/${DSML_PREFIX_PATTERN}(?:tool_calls?|function_calls?|画面处理)\\s*>`,
    'giu'
);
const DSML_COMPLETE_INVOKE_PATTERN = new RegExp(
    `<${DSML_PREFIX_PATTERN}invoke(?=\\s|>)[^>]*>[\\s\\S]*?<\\/${DSML_PREFIX_PATTERN}invoke\\s*>`,
    'giu'
);
const DSML_COMPLETE_PARAMETER_PATTERN = new RegExp(
    `<${DSML_PREFIX_PATTERN}parameter(?=\\s|>)[^>]*>[\\s\\S]*?<\\/${DSML_PREFIX_PATTERN}parameter\\s*>`,
    'giu'
);
const DSML_TAG_PATTERN = new RegExp(
    `<\\s*\\/?${DSML_PREFIX_PATTERN}(?:tool_calls?|function_calls?|invoke|parameter|画面处理)(?=\\s|>)[^>]*>`,
    'giu'
);
const DSML_STRUCTURAL_TAG_PATTERN = new RegExp(
    `<\\s*(\\/?)${DSML_PREFIX_PATTERN}(tool_calls?|function_calls?|invoke|parameter|画面处理)(?=\\s|>)[^>]*>`,
    'giu'
);

const MAX_DSML_CALLS = 4;
const MAX_DSML_PARAMETERS = 32;
const MAX_DSML_TEXT_LENGTH = 120_000;
const TOOL_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u;
const PARAMETER_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$.-]{0,127}$/u;

function decodeXmlEntities(value: string): string {
    return value
        .replace(/&quot;/giu, '"')
        .replace(/&apos;/giu, "'")
        .replace(/&lt;/giu, '<')
        .replace(/&gt;/giu, '>')
        .replace(/&amp;/giu, '&');
}

function readStringAttribute(attributes: string): boolean {
    const match = attributes.match(/\bstring\s*=\s*(["'])(true|false)\1/iu);
    return match?.[2]?.toLocaleLowerCase() === 'true';
}

function parseParameterValue(rawValue: string, attributes: string): unknown {
    const decodedValue = decodeXmlEntities(rawValue).trim();
    if (readStringAttribute(attributes)) return decodedValue;
    if (!decodedValue) return '';
    try {
        return JSON.parse(decodedValue);
    } catch {
        return decodedValue;
    }
}

function parseDsmlArguments(body: string): {
    arguments: Record<string, unknown>;
    parameterCount: number;
} | undefined {
    const args: Record<string, unknown> = {};
    const parameterNames = new Set<string>();
    let parameterCount = 0;
    let match: RegExpExecArray | null;
    DSML_PARAMETER_PATTERN.lastIndex = 0;
    while ((match = DSML_PARAMETER_PATTERN.exec(body)) !== null) {
        parameterCount += 1;
        if (parameterCount > MAX_DSML_PARAMETERS) return undefined;
        const parameterName = decodeXmlEntities(match[2]).trim();
        if (!PARAMETER_NAME_PATTERN.test(parameterName) || parameterNames.has(parameterName)) {
            return undefined;
        }
        parameterNames.add(parameterName);
        args[parameterName] = parseParameterValue(match[4], match[3] || '');
    }

    const unparsedBody = body
        .replace(DSML_COMPLETE_PARAMETER_PATTERN, '')
        .trim();
    if (unparsedBody && DSML_PROTOCOL_MARKER_PATTERN.test(unparsedBody)) return undefined;
    return { arguments: args, parameterCount };
}

export function containsDsmlToolCallMarkup(value: unknown): boolean {
    return DSML_PROTOCOL_MARKER_PATTERN.test(String(value || ''));
}

export function parseDsmlToolCallCandidates(
    value: unknown
): TextEncodedToolCallCandidate[] {
    const batch = parseDsmlToolCallBatch(value);
    return batch.valid ? batch.candidates : [];
}

export function parseDsmlToolCallBatch(value: unknown): {
    candidates: TextEncodedToolCallCandidate[];
    valid: boolean;
} {
    const text = String(value || '');
    if (!text || text.length > MAX_DSML_TEXT_LENGTH || !containsDsmlToolCallMarkup(text)) {
        return { candidates: [], valid: false };
    }

    const stack: string[] = [];
    let structuralTagCount = 0;
    let openingInvokeCount = 0;
    let openingParameterCount = 0;
    DSML_STRUCTURAL_TAG_PATTERN.lastIndex = 0;
    let structuralMatch: RegExpExecArray | null;
    while ((structuralMatch = DSML_STRUCTURAL_TAG_PATTERN.exec(text)) !== null) {
        structuralTagCount += 1;
        const closing = structuralMatch[1] === '/';
        const tagName = structuralMatch[2].toLocaleLowerCase();
        if (!closing) {
            stack.push(tagName);
            if (tagName === 'invoke') openingInvokeCount += 1;
            if (tagName === 'parameter') openingParameterCount += 1;
        } else if (stack.pop() !== tagName) {
            return { candidates: [], valid: false };
        }
    }
    const unmatchedProtocolText = text.replace(DSML_STRUCTURAL_TAG_PATTERN, '');
    if (structuralTagCount === 0 || stack.length > 0 || containsDsmlToolCallMarkup(unmatchedProtocolText)) {
        return { candidates: [], valid: false };
    }

    const calls: TextEncodedToolCallCandidate[] = [];
    let parsedParameterCount = 0;
    let match: RegExpExecArray | null;
    DSML_INVOKE_PATTERN.lastIndex = 0;
    while ((match = DSML_INVOKE_PATTERN.exec(text)) !== null) {
        const name = decodeXmlEntities(match[2]).trim();
        if (!TOOL_NAME_PATTERN.test(name)) return { candidates: [], valid: false };
        const parsedArguments = parseDsmlArguments(match[3]);
        if (!parsedArguments) return { candidates: [], valid: false };
        parsedParameterCount += parsedArguments.parameterCount;
        calls.push({ name, arguments: parsedArguments.arguments });
        if (calls.length > MAX_DSML_CALLS) return { candidates: [], valid: false };
    }
    const batchIsComplete = calls.length > 0
        && calls.length === openingInvokeCount
        && parsedParameterCount === openingParameterCount;
    return batchIsComplete
        ? { candidates: calls, valid: true }
        : { candidates: [], valid: false };
}

/**
 * Defense-in-depth user-text cleanup.
 *
 * Complete calls are removed. If a partial opening marker remains, everything
 * from that marker onward is discarded so a truncated Provider protocol cannot
 * become a user-facing answer. Ordinary text before the marker is preserved.
 */
export function removeDsmlToolCallMarkup(value: unknown): string {
    let text = String(value || '');
    if (!text || !containsDsmlToolCallMarkup(text)) return text;
    text = text
        .replace(DSML_COMPLETE_CONTAINER_PATTERN, '')
        .replace(DSML_COMPLETE_INVOKE_PATTERN, '')
        .replace(DSML_COMPLETE_PARAMETER_PATTERN, '');
    const partialMarkerIndex = text.search(DSML_PROTOCOL_MARKER_PATTERN);
    if (partialMarkerIndex >= 0) {
        text = text.slice(0, partialMarkerIndex);
    }
    return text
        .replace(DSML_TAG_PATTERN, '')
        .replace(/\n{3,}/gu, '\n\n')
        .trim();
}
