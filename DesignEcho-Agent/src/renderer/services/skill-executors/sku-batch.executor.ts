/**
 * SKU 批量生成技能执行器
 * @description 规则驱动的 SKU 颜色组合生成 + 批量排版导出
 */

import type { SkillExecutor, SkillExecuteParams } from './types';
import type { AgentResult } from '../unified-agent.service';
import { executeToolCall } from '../tool-executor.service';
import { useAppStore } from '../../stores/app.store';
import { decideSkuSelfSelectNoteGeneration } from '../../../shared/sku-self-select-note-policy';
import {
    buildSkuDesignAgentOsEvidence,
    type SkuBatchPlanEvidence
} from '../../../shared/design-agent-os-contracts';
import { buildSkuBatchPlannerEvidence } from './design-planner-evidence';
import { emitSkillStep } from './skill-step-events';
// ==================== 辅助函数 ====================

async function getProjectContext(): Promise<{ projectPath?: string } | null> {
    const currentProject = useAppStore.getState().currentProject;
    if (currentProject?.path) {
        return { projectPath: currentProject.path };
    }
    return null;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, stage: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_, reject) => {
                timer = setTimeout(() => reject(new Error(`${stage} timeout after ${timeoutMs}ms`)), timeoutMs);
            })
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

type TemplateLibraryItem = {
    id: string;
    name: string;
    filePath: string;
    description?: string;
    metadata?: {
        comboSize?: number;
    };
    source: 'project-folder' | 'local-library' | 'template-library';
    sourcePriority: number;
};

type ProjectSkuSourceFile = {
    name: string;
    path: string;
    relativePath?: string;
};

type SkuIntentPlan = {
    mode: 'default' | 'specified-only' | 'append';
    countPerSize?: number;
    generateNotes?: boolean;
    specifiedCombos?: string[][];
    appendMonochromeColors?: string[];
    targetSizes?: number[];
    reasoning?: string;
};

const TEMPLATE_FILE_PATTERN = /\.(psd|psb|tif|tiff)$/i;
const NOTE_TEMPLATE_KEYWORD = '自选备注';

function normalizeNameWithoutExt(input: string): string {
    return String(input || '').replace(/\.[^.]+$/, '').toLowerCase();
}

function normalizeDocumentPathBasename(input: string): string {
    const raw = String(input || '').trim();
    if (!raw) return '';
    const base = raw.split(/[/\\]/).pop() || raw;
    return normalizeNameWithoutExt(base);
}

function normalizePathForCompare(input: string): string {
    return String(input || '')
        .trim()
        .replace(/\//g, '\\')
        .replace(/\\+$/, '')
        .toLowerCase();
}

function isPathInsideDirectory(filePath?: string, directory?: string): boolean {
    const normalizedFile = normalizePathForCompare(filePath || '');
    const normalizedDir = normalizePathForCompare(directory || '');
    if (!normalizedFile || !normalizedDir) return false;
    return normalizedFile === normalizedDir || normalizedFile.startsWith(`${normalizedDir}\\`);
}

function isDocumentFromTemplateDirectory(doc: any, templateDir?: string): boolean {
    if (!templateDir) return true;
    return isPathInsideDirectory(doc?.path, templateDir);
}

function isExactTemplateDocument(doc: any, templateFilePath?: string): boolean {
    const normalizedDocPath = normalizePathForCompare(doc?.path || '');
    const normalizedTemplatePath = normalizePathForCompare(templateFilePath || '');
    if (!normalizedDocPath || !normalizedTemplatePath) return false;
    return normalizedDocPath === normalizedTemplatePath;
}

function matchesSkuDocument(
    doc: any,
    skuKeyword: string,
    options: {
        projectPath?: string;
        expectedPath?: string;
        allowPathlessProjectFallback?: boolean;
    } = {}
): boolean {
    const keyword = normalizeNameWithoutExt(String(skuKeyword || ''));
    if (!keyword) return false;

    const normalizedDocPath = normalizePathForCompare(doc?.path || '');
    const normalizedExpectedPath = normalizePathForCompare(options.expectedPath || '');
    if (normalizedDocPath && normalizedExpectedPath && normalizedDocPath === normalizedExpectedPath) {
        return true;
    }

    const docName = normalizeNameWithoutExt(doc?.name || '');
    const docBaseNameFromPath = normalizeDocumentPathBasename(doc?.path || '');

    const matchedByName = [docName, docBaseNameFromPath].some((candidate) => {
        if (!candidate) return false;
        return candidate === keyword || candidate.includes(keyword);
    });

    if (!matchedByName) return false;

    if (options.expectedPath) {
        const expectedBaseName = normalizeDocumentPathBasename(options.expectedPath);
        if (docName !== expectedBaseName && docBaseNameFromPath !== expectedBaseName) {
            return false;
        }
    }

    if (options.projectPath) {
        if (normalizedDocPath) {
            return isPathInsideDirectory(normalizedDocPath, options.projectPath);
        }
        return options.allowPathlessProjectFallback === true;
    }

    return true;
}

function isLikelyOpenedComboTemplate(doc: any, skuKeyword: string, templateDir?: string): boolean {
    const name = normalizeNameWithoutExt(doc?.name || '');
    if (!name) return false;
    if (name.includes(normalizeNameWithoutExt(skuKeyword))) return false;
    if (name.includes(NOTE_TEMPLATE_KEYWORD)) return false;

    const fromProjectTemplateDir = isDocumentFromTemplateDirectory(doc, templateDir);
    const looksLikeTemplateName = /模板|双装|双模板/.test(String(doc?.name || ''));

    return fromProjectTemplateDir || looksLikeTemplateName;
}

function collectSizesFromOpenedTemplateDocs(docs: any[], skuKeyword: string, templateDir?: string): number[] {
    const sizes = new Set<number>();
    for (const doc of Array.isArray(docs) ? docs : []) {
        if (!isLikelyOpenedComboTemplate(doc, skuKeyword, templateDir)) continue;
        const size = extractComboSize(String(doc?.name || '') || String(doc?.path || ''));
        if (size && size > 0) sizes.add(size);
    }
    return Array.from(sizes).sort((a, b) => a - b);
}

function formatComboForSummary(combo: string[]): string {
    const counts = new Map<string, number>();
    for (const color of combo) {
        counts.set(color, (counts.get(color) || 0) + 1);
    }
    return Array.from(counts.entries())
        .map(([color, count]) => `${color}x${count}`)
        .join('+');
}

function shouldAllowLibraryTemplateFallback(projectPath?: string, explicitFlag?: unknown, projectTemplateCount = 0): boolean {
    if (!projectPath) return true;
    if (projectTemplateCount <= 0) return true;
    return explicitFlag === true;
}

function isReasonableSkuSize(value: number): boolean {
    return Number.isInteger(value) && value >= 1 && value <= 50;
}

function normalizeColorKey(input: string): string {
    return String(input || '')
        .trim()
        .replace(/\s+/g, '')
        .toLowerCase();
}

function dedupeColorNames(names: string[]): { uniqueColors: string[]; duplicateColors: string[] } {
    const uniqueColors: string[] = [];
    const duplicateColors: string[] = [];
    const seen = new Set<string>();

    for (const rawName of names) {
        const normalized = normalizeColorKey(rawName);
        if (!normalized) continue;
        if (seen.has(normalized)) {
            duplicateColors.push(String(rawName || '').trim());
            continue;
        }
        seen.add(normalized);
        uniqueColors.push(String(rawName || '').trim());
    }

    return { uniqueColors, duplicateColors };
}

function extractComboSize(input: string): number | null {
    const text = String(input || '').replace(/\.[^.]+$/, '');
    const patterns = [
        /(?:^|[^\d])(\d{1,2})\s*(?:\u53cc\u88c5\u81ea\u9009\u5907\u6ce8|\u53cc\u81ea\u9009\u5907\u6ce8|\u53cc\u88c5|\u53cc\u6a21\u677f|\u53cc)(?!\d)/i,
        /(?:^|[^\d])(\d{1,2})\s*(?:\u7ec4|\u5957)(?!\d)/i
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (!match) continue;
        const value = parseInt(match[1], 10);
        if (isReasonableSkuSize(value)) return value;
    }

    return null;
}

function inferTemplateSize(template: TemplateLibraryItem): number | null {
    if (typeof template.metadata?.comboSize === 'number') return template.metadata.comboSize;
    const byName = extractComboSize(template.name);
    if (byName) return byName;
    return extractComboSize(template.filePath);
}

function pickBestTemplateFromLibrary(
    templates: TemplateLibraryItem[],
    options: { size: number; keyword?: string; noteMode: boolean }
): TemplateLibraryItem | null {
    const keyword = String(options.keyword || '').trim().toLowerCase();
    const sizeKeyword = `${options.size}双`;

    const scored = templates
        .map(template => {
            const fileName = normalizeNameWithoutExt(template.name || template.filePath.split(/[/\\]/).pop() || '');
            const isNote = fileName.includes(NOTE_TEMPLATE_KEYWORD);
            if (options.noteMode && !isNote) return { template, score: -Infinity };
            if (!options.noteMode && isNote) return { template, score: -Infinity };

            let score = 0;
            const inferredSize = inferTemplateSize(template);
            if (inferredSize === options.size) score += 100;
            if (fileName.includes(sizeKeyword)) score += 60;
            if (keyword && (fileName.includes(keyword) || String(template.description || '').toLowerCase().includes(keyword))) {
                score += 25;
            }
            if (fileName.includes('模板')) score += 8;
            if (TEMPLATE_FILE_PATTERN.test(template.filePath)) score += 5;
            if (/\.psd$/i.test(template.filePath)) score += 3;

            return { template, score };
        })
        .filter(item => Number.isFinite(item.score))
        .sort((a, b) => b.score - a.score);

    if (scored.length === 0) return null;
    return scored[0].template;
}

function collectSizesFromLibrary(templates: TemplateLibraryItem[]): number[] {
    const sizes = new Set<number>();
    for (const template of templates) {
        const fileName = normalizeNameWithoutExt(template.name || '');
        if (fileName.includes(NOTE_TEMPLATE_KEYWORD)) continue;
        const size = inferTemplateSize(template);
        if (size && size > 0) sizes.add(size);
    }
    return Array.from(sizes).sort((a, b) => a - b);
}

function escapeRegExp(input: string): string {
    return String(input || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildComboIdentity(combo: string[]): string {
    return combo
        .map(color => normalizeColorKey(color))
        .filter(Boolean)
        .sort()
        .join('|');
}

function dedupeCombosForSize(combos: string[][]): {
    uniqueCombos: string[][];
    removedCombos: string[][];
} {
    const uniqueCombos: string[][] = [];
    const removedCombos: string[][] = [];
    const seen = new Set<string>();

    for (const combo of combos) {
        const identity = buildComboIdentity(combo);
        if (!identity) continue;

        if (seen.has(identity)) {
            removedCombos.push(combo);
            continue;
        }

        seen.add(identity);
        uniqueCombos.push(combo);
    }

    return { uniqueCombos, removedCombos };
}

function dedupeAllCombosBySize(combosBySize: Record<number, string[][]>): Array<{
    size: number;
    removedCombos: string[][];
}> {
    const removals: Array<{ size: number; removedCombos: string[][] }> = [];

    for (const [sizeStr, combos] of Object.entries(combosBySize)) {
        const size = parseInt(sizeStr, 10);
        if (!Array.isArray(combos) || combos.length <= 1) continue;

        const { uniqueCombos, removedCombos } = dedupeCombosForSize(combos);
        combosBySize[size] = uniqueCombos;

        if (removedCombos.length > 0) {
            removals.push({ size, removedCombos });
        }
    }

    return removals;
}

function buildColorAliasEntries(availableColors: string[]): Array<{ actual: string; aliases: string[] }> {
    return availableColors.map(color => {
        const normalized = normalizeColorKey(color);
        const trimmed = String(color || '').trim();
        return {
            actual: color,
            aliases: Array.from(new Set([
                trimmed,
                trimmed.replace(/色$/u, ''),
                normalized,
                normalized.replace(/色$/u, '')
            ].filter(Boolean)))
        };
    });
}

function resolveColorToken(
    token: string,
    aliasEntries: Array<{ actual: string; aliases: string[] }>
): string | null {
    const normalizedToken = normalizeColorKey(token)
        .replace(/(这个|那个|组合|搭配|颜色|款式|帮我|做|生成|新增|增加|追加|再加|再做|只做|只要|一个|每个规格|规格|双装|双|全是|都是)/g, '')
        .trim();

    if (!normalizedToken) return null;

    for (const entry of aliasEntries) {
        if (entry.aliases.some(alias => alias && (normalizedToken === alias || normalizedToken.endsWith(alias) || normalizedToken.startsWith(alias)))) {
            return entry.actual;
        }
    }

    for (const entry of aliasEntries) {
        if (entry.aliases.some(alias => alias && normalizedToken.includes(alias))) {
            return entry.actual;
        }
    }

    return null;
}

function parseRequestedExplicitCombos(userInput: string, availableColors: string[]): string[][] {
    const text = String(userInput || '').trim();
    if (!text) return [];

    const aliasEntries = buildColorAliasEntries(availableColors);
    if (aliasEntries.length === 0) return [];

    const combos: string[][] = [];
    const clauses = text
        .replace(/[“”"'`]/g, '')
        .split(/[；;。！？!\n]/)
        .map(item => item.trim())
        .filter(Boolean);

    for (const clause of clauses) {
        if (!/[+＋、，,\/／|｜]/.test(clause)) continue;

        const tokens = clause
            .split(/[+＋、，,\/／|｜]/)
            .map(item => item.trim())
            .filter(Boolean);

        const resolved = tokens
            .map(token => resolveColorToken(token, aliasEntries))
            .filter((color): color is string => !!color);

        if (resolved.length >= 1) {
            combos.push(resolved);
        }
    }

    return combos;
}

function resolveRequestedTargetSizes(userInput: string, availableSizes: number[]): number[] {
    const text = String(userInput || '');
    const matches = Array.from(text.matchAll(/(\d{1,2})\s*双/g))
        .map(match => parseInt(match[1], 10))
        .filter(size => isReasonableSkuSize(size));

    const unique = Array.from(new Set(matches));
    if (unique.length === 0) return [];

    if (!Array.isArray(availableSizes) || availableSizes.length === 0) {
        return unique;
    }

    return unique.filter(size => availableSizes.includes(size));
}

function resolveRequestedMonochromeColors(userInput: string, availableColors: string[]): string[] {
    const text = String(userInput || '').trim();
    if (!text) return [];

    const asksExtraCombo = /(增加|新增|再加|再增加|额外)/.test(text)
        && /(组合|搭配|款式)/.test(text);

    if (!asksExtraCombo) return [];

    const resolved: string[] = [];
    const pushResolved = (color?: string | null) => {
        if (!color) return;
        if (!resolved.includes(color)) resolved.push(color);
    };

    for (const color of availableColors) {
        const normalized = normalizeColorKey(color);
        if (!normalized) continue;

        const aliases = Array.from(new Set([
            color,
            color.replace(/色$/u, ''),
            normalized,
            normalized.replace(/色$/u, '')
        ].filter(Boolean)));

        const matched = aliases.some(alias => {
            const pattern = new RegExp(`(?:全|纯)?${escapeRegExp(alias)}(?:色)?`);
            return pattern.test(text);
        });

        if (matched) {
            pushResolved(color);
        }
    }

    if (resolved.length === 0 && /(全白|纯白|白色\+白色|全是白色|都是白色)/.test(text)) {
        pushResolved(availableColors.find(color => /白/.test(color)));
    }

    return resolved;
}

function appendRequestedExtraCombos(
    combosBySize: Record<number, string[][]>,
    comboSizes: number[],
    requestedMonochromeColors: string[]
): { added: Array<{ size: number; combo: string[] }>; skipped: string[] } {
    const added: Array<{ size: number; combo: string[] }> = [];
    const skipped: string[] = [];

    for (const size of comboSizes) {
        if (!combosBySize[size]) combosBySize[size] = [];
        const existing = new Set(combosBySize[size].map(buildComboIdentity));

        for (const color of requestedMonochromeColors) {
            const combo = Array(size).fill(color);
            const comboKey = buildComboIdentity(combo);
            if (existing.has(comboKey)) {
                skipped.push(`${size}双=${combo.join('+')}`);
                continue;
            }

            combosBySize[size].push(combo);
            existing.add(comboKey);
            added.push({ size, combo });
        }
    }

    return { added, skipped };
}

function appendRequestedSpecificCombos(
    combosBySize: Record<number, string[][]>,
    requestedCombos: string[][]
): { added: Array<{ size: number; combo: string[] }>; skipped: string[] } {
    const added: Array<{ size: number; combo: string[] }> = [];
    const skipped: string[] = [];

    for (const combo of requestedCombos) {
        const size = combo.length;
        if (!isReasonableSkuSize(size)) continue;

        if (!combosBySize[size]) combosBySize[size] = [];
        const existing = new Set(combosBySize[size].map(buildComboIdentity));
        const comboKey = buildComboIdentity(combo);

        if (existing.has(comboKey)) {
            skipped.push(`${size}双=${combo.join('+')}`);
            continue;
        }

        combosBySize[size].push(combo);
        existing.add(comboKey);
        added.push({ size, combo });
    }

    return { added, skipped };
}

function parseJsonObject(text: string): any | null {
    const raw = String(text || '').trim();
    if (!raw) return null;

    try {
        return JSON.parse(raw);
    } catch {
        const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
        const candidate = fenced ? fenced[1].trim() : raw;
        try {
            return JSON.parse(candidate);
        } catch {
            const start = candidate.indexOf('{');
            const end = candidate.lastIndexOf('}');
            if (start >= 0 && end > start) {
                try {
                    return JSON.parse(candidate.slice(start, end + 1));
                } catch {
                    return null;
                }
            }
            return null;
        }
    }
}

async function resolveSkuPlanningModelId(): Promise<string> {
    try {
        const state = useAppStore.getState() as any;
        const prefs = state?.modelPreferences;
        const mode = String(prefs?.mode || '').toLowerCase();
        if (mode === 'local') {
            const localModel = String(prefs?.preferredLocalModels?.textOptimize || '').trim();
            if (localModel) return localModel;
        }
        const cloudModel = String(prefs?.preferredCloudModels?.textOptimize || '').trim();
        if (cloudModel) return cloudModel;
    } catch {}
    return 'google-gemini-3-flash';
}

function normalizePlannedCombos(rawCombos: unknown, availableColors: string[]): string[][] {
    if (!Array.isArray(rawCombos)) return [];
    const aliasEntries = buildColorAliasEntries(availableColors);

    return rawCombos
        .map((combo) => {
            if (!Array.isArray(combo)) return null;
            const resolved = combo
                .map(token => resolveColorToken(String(token || ''), aliasEntries))
                .filter((color): color is string => !!color);
            return resolved.length >= 1 ? resolved : null;
        })
        .filter((combo): combo is string[] => Array.isArray(combo) && combo.length >= 1);
}

function normalizePlannedMonochromeColors(rawColors: unknown, availableColors: string[]): string[] {
    if (!Array.isArray(rawColors)) return [];
    const aliasEntries = buildColorAliasEntries(availableColors);
    const resolved: string[] = [];

    for (const rawColor of rawColors) {
        const actual = resolveColorToken(String(rawColor || ''), aliasEntries);
        if (actual && !resolved.includes(actual)) {
            resolved.push(actual);
        }
    }

    return resolved;
}

function normalizePlannedTargetSizes(rawSizes: unknown, availableSizes: number[]): number[] {
    if (!Array.isArray(rawSizes)) return [];
    const normalized = rawSizes
        .map(value => Number(value))
        .filter(value => isReasonableSkuSize(value));

    const unique = Array.from(new Set(normalized));
    if (!availableSizes.length) return unique;
    return unique.filter(size => availableSizes.includes(size));
}

async function planSkuIntentWithModel(input: {
    userIntent: string;
    availableColors: string[];
    detectedSizes: number[];
    defaultCountPerSize: number;
    defaultGenerateNotes: boolean;
}): Promise<SkuIntentPlan | null> {
    const userIntent = String(input.userIntent || '').trim();
    if (!userIntent || !(window as any)?.designEcho?.chat) return null;

    const modelId = await resolveSkuPlanningModelId();
    const prompt = [
        '你是 DesignEcho 的 SKU 任务规划器。',
        '你要把用户的自然语言需求转换成 SKU 执行计划，不要直接写解释，只返回 JSON。',
        '',
        '规则：',
        '1. mode 只能是 default、specified-only、append。',
        '2. default 表示按默认规格批量生成。',
        '3. specified-only 表示只做用户明确指定的组合，不做整批默认组合。',
        '4. append 表示先按默认规格生成，再追加用户指定组合。',
        '5. specifiedCombos 必须是颜色数组列表，例如 [["白色"],["白色","黑色"],["白色","白色","白色"]]。',
        '6. appendMonochromeColors 只在用户要求给每个规格追加单色组合时填写，例如 ["白色"]。',
        '7. targetSizes 仅在用户明确限制规格时填写，例如 [4]；如果用户说“每个规格”，就留空数组。',
        `8. 默认每规格组合数是 ${input.defaultCountPerSize}，默认 generateNotes 是 ${input.defaultGenerateNotes ? 'true' : 'false'}。`,
        '9. 只能使用给定的颜色名和规格，不要发明不存在的颜色。',
        '',
        '返回 JSON 结构：',
        '{',
        '  "mode": "default" | "specified-only" | "append",',
        '  "countPerSize": number,',
        '  "generateNotes": boolean,',
        '  "specifiedCombos": string[][],',
        '  "appendMonochromeColors": string[],',
        '  "targetSizes": number[],',
        '  "reasoning": "一句简短中文，说明你理解到的用户要求"',
        '}',
        '',
        `可用颜色: ${input.availableColors.join(' / ') || '无'}`,
        `已检测规格: ${input.detectedSizes.join(' / ') || '无'}`,
        `用户需求: ${userIntent}`
    ].join('\n');

    try {
        const response = await (window as any).designEcho.chat(modelId, [
            { role: 'system', content: '你是 SKU 任务规划器，只输出严格 JSON。' },
            { role: 'user', content: prompt }
        ], { temperature: 0.1, maxTokens: 500 });

        const parsed = parseJsonObject(String(response?.text || ''));
        if (!parsed || typeof parsed !== 'object') return null;

        const mode = String((parsed as any).mode || '').trim();
        if (!['default', 'specified-only', 'append'].includes(mode)) return null;

        const countPerSize = Number((parsed as any).countPerSize);
        const generateNotes = typeof (parsed as any).generateNotes === 'boolean'
            ? (parsed as any).generateNotes
            : undefined;

        return {
            mode: mode as SkuIntentPlan['mode'],
            countPerSize: Number.isFinite(countPerSize) && countPerSize > 0 ? Math.max(1, Math.floor(countPerSize)) : undefined,
            generateNotes,
            specifiedCombos: normalizePlannedCombos((parsed as any).specifiedCombos, input.availableColors),
            appendMonochromeColors: normalizePlannedMonochromeColors((parsed as any).appendMonochromeColors, input.availableColors),
            targetSizes: normalizePlannedTargetSizes((parsed as any).targetSizes, input.detectedSizes),
            reasoning: String((parsed as any).reasoning || '').trim()
        };
    } catch {
        return null;
    }
}

function summarizeTemplateAvailability(options: {
    templateDir?: string;
    projectTemplates: TemplateLibraryItem[];
    localTemplates: TemplateLibraryItem[];
    localSpecs: number[];
}): string {
    const lines: string[] = [];
    const templateDir = String(options.templateDir || '').trim();
    const projectCount = options.projectTemplates.length;
    const localCount = options.localTemplates.length;
    const projectSpecs = collectSizesFromLibrary(options.projectTemplates);
    const localSpecs = options.localSpecs.length > 0
        ? options.localSpecs
        : collectSizesFromLibrary(options.localTemplates);

    if (templateDir) {
        if (projectCount > 0) {
            lines.push(`项目模板目录「${templateDir}」已识别 ${projectCount} 个模板文件`);
            if (projectSpecs.length > 0) {
                lines.push(`项目模板目录可用规格：${projectSpecs.join(' / ')}双`);
            }
        } else {
            lines.push(`项目模板目录「${templateDir}」递归扫描结果为空（未发现 PSD/PSB/TIF/TIFF）`);
        }
    }

    if (localCount > 0) {
        lines.push(`本地模板库可用模板：${localCount} 个`);
        if (localSpecs.length > 0) {
            lines.push(`本地模板库可用规格：${localSpecs.join(' / ')}双`);
        }
    } else {
        lines.push('本地模板库当前也没有可用 SKU 模板');
    }

    lines.push('支持的模板命名示例：2双装、3双装、4双装、2双模板');
    return lines.map(line => `- ${line}`).join('\n');
}

function normalizeTemplateCandidate(item: any): TemplateLibraryItem | null {
    if (!item || typeof item.filePath !== 'string' || !TEMPLATE_FILE_PATTERN.test(item.filePath)) {
        return null;
    }
    return {
        id: String(item.id || ''),
        name: String(item.name || ''),
        filePath: String(item.filePath || ''),
        description: typeof item.description === 'string' ? item.description : undefined,
        metadata: item.metadata && typeof item.metadata === 'object'
            ? { comboSize: typeof item.metadata.comboSize === 'number' ? item.metadata.comboSize : undefined }
            : undefined,
        source: item.source === 'template-library' ? 'template-library' : 'local-library',
        sourcePriority: typeof item.sourcePriority === 'number' ? item.sourcePriority : 0
    };
}

async function loadSkuTemplateLibrary(): Promise<TemplateLibraryItem[]> {
    try {
        const list = await window.designEcho?.invoke?.('template-knowledge:getSKUTemplateCandidates');
        if (!Array.isArray(list)) return [];
        return list
            .map(normalizeTemplateCandidate)
            .filter((item): item is TemplateLibraryItem => !!item);
    } catch (error) {
        console.warn('[SKU-Batch] 加载模板候选失败:', error);
        return [];
    }
}

async function loadLocalLibrarySpecs(): Promise<number[]> {
    try {
        const specs = await window.designEcho?.invoke?.('template-knowledge:getAvailableSKUSpecs', {
            sources: ['local-library']
        });
        if (!Array.isArray(specs)) return [];
        return specs
            .map((size: any) => Number(size))
            .filter((size: number) => Number.isFinite(size) && size > 0)
            .sort((a: number, b: number) => a - b);
    } catch (error) {
        console.warn('[SKU-Batch] 加载本地模板库规格失败:', error);
        return [];
    }
}

async function scanProjectTemplateFiles(templateDir?: string): Promise<TemplateLibraryItem[]> {
    const dir = String(templateDir || '').trim();
    if (!dir) return [];

    try {
        const entries = await window.designEcho?.readDirectory?.(dir, {
            recursive: true
        });
        if (!Array.isArray(entries)) return [];

        const result: TemplateLibraryItem[] = [];
        const seen = new Set<string>();
        for (const entry of entries) {
            if (!entry || entry.type !== 'file' || typeof entry.path !== 'string') continue;
            const filePath = String(entry.path);
            if (!TEMPLATE_FILE_PATTERN.test(filePath)) continue;
            const normalizedPath = filePath.toLowerCase();
            if (seen.has(normalizedPath)) continue;
            seen.add(normalizedPath);
            const fileName = filePath.split(/[/\\]/).pop() || filePath;
            result.push({
                id: `project-${normalizedPath}`,
                name: fileName.replace(/\.[^.]+$/, ''),
                filePath,
                source: 'project-folder',
                sourcePriority: 0
            });
        }
        return result;
    } catch (error) {
        console.warn('[SKU-Batch] 扫描项目模板目录失败:', error);
        return [];
    }
}

function isSkuSourceDesignFile(file: any, skuKeyword: string): file is ProjectSkuSourceFile {
    const filePath = String(file?.path || '').trim();
    const fileName = String(file?.name || filePath.split(/[/\\]/).pop() || '').trim();
    if (!filePath || !fileName || !/\.(psd|psb)$/i.test(fileName)) return false;

    const keyword = normalizeNameWithoutExt(skuKeyword || 'SKU');
    const baseName = normalizeNameWithoutExt(fileName);
    return Boolean(keyword && (baseName === keyword || baseName.includes(keyword)));
}

function scoreProjectSkuSourceFile(file: ProjectSkuSourceFile, skuKeyword: string, projectPath?: string): number {
    const keyword = normalizeNameWithoutExt(skuKeyword || 'SKU');
    const fileName = String(file.name || file.path.split(/[/\\]/).pop() || '');
    const baseName = normalizeNameWithoutExt(fileName);
    const normalizedPath = normalizePathForCompare(file.path);
    const normalizedRelative = normalizePathForCompare(file.relativePath || '');

    let score = 0;
    if (baseName === keyword) score += 100;
    else if (baseName.startsWith(keyword)) score += 70;
    else if (baseName.includes(keyword)) score += 45;

    if (projectPath && isPathInsideDirectory(file.path, projectPath)) score += 25;
    if (/(^|\\)psd(\\|$)/i.test(normalizedPath) || /(^|\\)psd(\\|$)/i.test(normalizedRelative)) score += 12;
    if (/\.psd$/i.test(fileName)) score += 6;
    if (/\.psb$/i.test(fileName)) score += 5;
    return score;
}

function pickBestProjectSkuSourceFile(
    files: any[],
    skuKeyword: string,
    projectPath?: string
): ProjectSkuSourceFile | null {
    const candidates = (Array.isArray(files) ? files : [])
        .filter((file) => isSkuSourceDesignFile(file, skuKeyword))
        .map((file) => ({
            name: String(file.name || file.path.split(/[/\\]/).pop() || ''),
            path: String(file.path || ''),
            relativePath: typeof file.relativePath === 'string' ? file.relativePath : undefined,
            score: scoreProjectSkuSourceFile(file, skuKeyword, projectPath)
        }))
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return a.name.localeCompare(b.name, 'zh-CN');
        });

    if (candidates.length === 0) return null;
    const { score: _score, ...candidate } = candidates[0];
    return candidate;
}

const SKU_CONTRAST_PAIR_SCORING_ENABLED = false;

/**
 * 生成指定大小的颜色组合（含组合模式评分）
 */
function generateCombinationsOfSize(
    colors: string[], size: number, count: number
): string[][] {
    const totalColors = colors.length;
    if (totalColors === 0 || size <= 0 || count <= 0) return [];

    const buildCountsKey = (counts: number[]) => counts.join(',');
    const countsToCombo = (counts: number[]) => {
        const combo: string[] = [];
        for (let i = 0; i < counts.length; i++) {
            for (let k = 0; k < counts[i]; k++) combo.push(colors[i]);
        }
        return combo;
    };

    const buildContrastPairs = () => {
        if (totalColors < 4) return new Set<string>();
        const dist = Math.floor(totalColors / 2);
        const pairs = new Set<string>();
        for (let i = 0; i < totalColors; i++) {
            const j = (i + dist) % totalColors;
            const a = Math.min(i, j);
            const b = Math.max(i, j);
            pairs.add(`${a}-${b}`);
        }
        return pairs;
    };

    const isStraight = (counts: number[]) => {
        const idxs = counts.map((c, i) => (c > 0 ? i : -1)).filter(i => i >= 0);
        if (idxs.length !== size) return false;
        idxs.sort((a, b) => a - b);
        let consecutive = true;
        for (let i = 1; i < idxs.length; i++) {
            if (idxs[i] !== idxs[i - 1] + 1) {
                consecutive = false;
                break;
            }
        }
        if (consecutive) return true;
        const wrapped = idxs[0] === 0 && idxs[idxs.length - 1] === totalColors - 1;
        if (!wrapped) return false;
        for (let i = 1; i < idxs.length; i++) {
            if (idxs[i] !== idxs[i - 1] + 1) return false;
        }
        return true;
    };

    const buildPatternCandidates = () => {
        const candidates: number[][] = [];
        const seen = new Set<string>();
        const push = (counts: number[]) => {
            const key = buildCountsKey(counts);
            if (seen.has(key)) return;
            seen.add(key);
            candidates.push(counts);
        };

        for (let i = 0; i < totalColors; i++) {
            const counts = new Array(totalColors).fill(0);
            counts[i] = size;
            push(counts);
        }

        if (totalColors >= size) {
            for (let start = 0; start < totalColors; start++) {
                const counts = new Array(totalColors).fill(0);
                for (let k = 0; k < size; k++) counts[(start + k) % totalColors] = 1;
                push(counts);
            }
        }

        if (size >= 2) {
            for (let i = 0; i < totalColors; i++) {
                for (let j = 0; j < totalColors; j++) {
                    if (j === i) continue;
                    const counts = new Array(totalColors).fill(0);
                    counts[i] = 2;
                    let remaining = size - 2;
                    for (let k = 0; k < totalColors && remaining > 0; k++) {
                        if (k === i) continue;
                        const add = Math.min(1, remaining);
                        counts[k] += add;
                        remaining -= add;
                    }
                    if (remaining > 0) counts[i] += remaining;
                    push(counts);
                }
            }
        }

        if (size >= 4) {
            for (let i = 0; i < totalColors; i++) {
                for (let j = i + 1; j < totalColors; j++) {
                    const counts = new Array(totalColors).fill(0);
                    counts[i] = 2;
                    counts[j] = 2;
                    let remaining = size - 4;
                    for (let k = 0; k < totalColors && remaining > 0; k++) {
                        if (k === i || k === j) continue;
                        counts[k] += 1;
                        remaining -= 1;
                    }
                    if (remaining > 0) counts[i] += remaining;
                    push(counts);
                }
            }
        }

        if (size >= 3) {
            for (let i = 0; i < totalColors; i++) {
                for (let j = 0; j < totalColors; j++) {
                    if (j === i) continue;
                    const counts = new Array(totalColors).fill(0);
                    counts[i] = 3;
                    let remaining = size - 3;
                    for (let k = 0; k < totalColors && remaining > 0; k++) {
                        if (k === i) continue;
                        const add = Math.min(1, remaining);
                        counts[k] += add;
                        remaining -= add;
                    }
                    if (remaining > 0) counts[i] += remaining;
                    push(counts);
                }
            }
        }

        const randomCounts = () => {
            const counts = new Array(totalColors).fill(0);
            for (let t = 0; t < size; t++) {
                counts[Math.floor(Math.random() * totalColors)] += 1;
            }
            return counts;
        };

        const extraTarget = Math.max(200, count * 60);
        let attempts = 0;
        while (candidates.length < extraTarget && attempts < extraTarget * 8) {
            push(randomCounts());
            attempts++;
        }

        return candidates;
    };

    const candidates = buildPatternCandidates();
    const contrastPairs = SKU_CONTRAST_PAIR_SCORING_ENABLED
        ? buildContrastPairs()
        : new Set<string>();

    const usage = new Array(totalColors).fill(0);
    const selected: number[][] = [];
    const usedKeys = new Set<string>();

    const scoreCandidate = (counts: number[]) => {
        const next = usage.map((u, i) => u + counts[i]);
        const mean = next.reduce((a, b) => a + b, 0) / next.length;
        const variance = next.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / next.length;
        const balanceScore = -Math.sqrt(variance);

        let missingBonus = 0;
        for (let i = 0; i < totalColors; i++) {
            if (usage[i] === 0 && counts[i] > 0) missingBonus += 2.5;
        }

        let contrastBonus = 0;
        if (contrastPairs.size > 0) {
            for (const pair of contrastPairs) {
                const [aStr, bStr] = pair.split('-');
                const a = parseInt(aStr, 10);
                const b = parseInt(bStr, 10);
                if (counts[a] > 0 && counts[b] > 0) {
                    contrastBonus += 1.2 + 0.2 * Math.min(counts[a], counts[b]);
                }
            }
        }

        const maxCount = Math.max(...counts);
        const distinct = counts.filter(c => c > 0).length;
        let patternBonus = 0;
        if (distinct === 1) patternBonus -= 1.5;
        if (isStraight(counts)) patternBonus += 1.6;
        if (maxCount >= 3) patternBonus += 1.2;
        const pairs = counts.filter(c => c === 2).length;
        if (pairs >= 2) patternBonus += 1.8;
        else if (pairs === 1) patternBonus += 0.9;

        return balanceScore + missingBonus + contrastBonus + patternBonus;
    };

    const pickBest = () => {
        let bestIdx = -1;
        let bestScore = -Infinity;
        for (let i = 0; i < candidates.length; i++) {
            const counts = candidates[i];
            const key = buildCountsKey(counts);
            if (usedKeys.has(key)) continue;
            const score = scoreCandidate(counts);
            if (score > bestScore) {
                bestScore = score;
                bestIdx = i;
            }
        }
        if (bestIdx === -1) return null;
        const chosen = candidates[bestIdx];
        usedKeys.add(buildCountsKey(chosen));
        for (let i = 0; i < totalColors; i++) usage[i] += chosen[i];
        selected.push(chosen);
        return chosen;
    };

    while (selected.length < count) {
        const chosen = pickBest();
        if (!chosen) break;
    }

    const missing = usage
        .map((u, i) => ({ u, i }))
        .filter(x => x.u === 0)
        .map(x => x.i);

    if (missing.length > 0 && selected.length > 0) {
        for (const missIdx of missing) {
            const replacement = candidates
                .filter(c => c[missIdx] > 0)
                .filter(c => !usedKeys.has(buildCountsKey(c)))
                .sort((a, b) => scoreCandidate(b) - scoreCandidate(a))[0];
            if (!replacement) continue;

            let worstIdx = -1;
            let worstScore = Infinity;
            for (let i = 0; i < selected.length; i++) {
                const s = scoreCandidate(selected[i]);
                if (s < worstScore) {
                    worstScore = s;
                    worstIdx = i;
                }
            }
            if (worstIdx >= 0) {
                usedKeys.delete(buildCountsKey(selected[worstIdx]));
                usedKeys.add(buildCountsKey(replacement));
                selected[worstIdx] = replacement;
            }
        }
    }

    return selected.map(countsToCombo);
}

// ==================== SKU 执行器 ====================

export const skuBatchExecutor: SkillExecutor = {
    skillId: 'sku-batch',
    
    async execute({ params, callbacks, signal, context: _context }: SkillExecuteParams): Promise<AgentResult> {
        const emitStep = (
            kind: Parameters<typeof emitSkillStep>[1]['kind'],
            title: string,
            detail?: string,
            status: Parameters<typeof emitSkillStep>[1]['status'] = 'running',
            percent?: number
        ) => emitSkillStep(callbacks, { kind, title, detail, status, percent });

        emitStep('observation', '准备执行 SKU 批量生成', '读取项目上下文、模板候选和 Photoshop 当前文档。', 'running', 0.03);
        callbacks?.onMessage?.('📋 正在分析项目结构...');

        // 并行加载项目上下文与模板候选
        const [projectContext, skuTemplateCandidates, localLibrarySpecs] = await Promise.all([
            getProjectContext(),
            loadSkuTemplateLibrary(),
            loadLocalLibrarySpecs()
        ]);
        const localSkuTemplates = skuTemplateCandidates.filter(item => item.source === 'local-library');
        if (localSkuTemplates.length > 0) {
            callbacks?.onMessage?.(`📚 已加载本地模板库 (${localSkuTemplates.length} 个 SKU 模板)`);
        }
        if (localLibrarySpecs.length > 0) {
            callbacks?.onMessage?.(`📚 本地模板库可用规格: ${localLibrarySpecs.join(' / ')}双`);
        }
        console.log('[SKU-Batch] 项目上下文:', projectContext);

        const templateDir = projectContext?.projectPath ? `${projectContext.projectPath}\\模板文件` : undefined;
        const outputDir = projectContext?.projectPath ? `${projectContext.projectPath}\\SKU` : undefined;
        const projectSkuTemplates = await scanProjectTemplateFiles(templateDir);
        const allowLibraryTemplateFallback = shouldAllowLibraryTemplateFallback(
            projectContext?.projectPath,
            params.allowLibraryTemplateFallback,
            projectSkuTemplates.length
        );
        if (projectSkuTemplates.length > 0) {
            callbacks?.onMessage?.(`📁 项目模板目录识别到 ${projectSkuTemplates.length} 个模板文件`);
        } else if (projectContext?.projectPath && localSkuTemplates.length > 0) {
            callbacks?.onMessage?.('📚 当前项目模板目录未识别到 SKU 模板，已允许回退到本地模板库。');
        }
        emitStep(
            'verification',
            'SKU 项目与模板上下文读取完成',
            `项目模板 ${projectSkuTemplates.length} 个，本地模板 ${localSkuTemplates.length} 个，本地规格 ${localLibrarySpecs.length} 个。`,
            'success',
            0.08
        );
        if (!allowLibraryTemplateFallback && projectContext?.projectPath) {
            callbacks?.onMessage?.('🧭 当前 SKU 任务已锁定在当前项目模板目录，不会跨项目借用模板。');
        }
        
        // 从 AI 决策中获取参数
        const skuKeyword = params.skuFileKeyword || 'SKU';
        const templateKeyword = params.templateKeyword || '';
        const excludeColors = params.excludeColors as string[] || [];
        
        console.log('[SKU-Batch] AI 提供的参数:', {
            skuKeyword, templateKeyword, excludeColors,
            comboSizes: params.comboSizes,
            countPerSize: params.countPerSize
        });

        const safeToolCall = async (
            toolName: string,
            toolParams: Record<string, any>,
            timeoutMs: number,
            stage: string
        ): Promise<any> => {
            try {
                return await withTimeout(executeToolCall(toolName, toolParams), timeoutMs, stage);
            } catch (error: any) {
                const message = error?.message || String(error);
                console.warn(`[SKU-Batch] ${stage} failed:`, message);
                return {
                    success: false,
                    timeout: /timeout/i.test(message),
                    error: message
                };
            }
        };

        const isModalStateError = (result: any): boolean =>
            /host is in a modal state/i.test(String(result?.error || result?.message || ''));

        const executeSkuLayoutWithModalRetry = async (
            toolParams: Record<string, any>,
            stage: string,
            timeoutMs = 5 * 60 * 1000
        ): Promise<any> => {
            let result = await safeToolCall('skuLayout', toolParams, timeoutMs, stage);
            if (!result?.success && isModalStateError(result)) {
                emitStep('warning', 'SKU 工具遇到 Photoshop modal state', '等待 Photoshop 释放状态后重试一次。', 'running', 0.68);
                await sleep(1800);
                try {
                    await refreshDocuments();
                } catch {}
                result = await safeToolCall('skuLayout', toolParams, timeoutMs, `${stage}-modal-retry`);
                if (result?.success) {
                    result = {
                        ...result,
                        retriedAfterModalState: true
                    };
                }
            }
            return result;
        };

        // 1. 获取文档列表
        callbacks?.onToolStart?.('listDocuments');
        let docsResult = await executeToolCall('listDocuments', { includeDetails: true });
        callbacks?.onToolComplete?.('listDocuments', docsResult);

        const refreshDocuments = async () => {
            docsResult = await executeToolCall('listDocuments', { includeDetails: true });
            return docsResult;
        };

        if (!docsResult?.success) {
            emitStep('warning', 'SKU 文档列表读取失败', String(docsResult?.error || 'listDocuments failed'), 'error', 0.12);
            return {
                success: false,
                message: `⚠️ **无法获取 Photoshop 文档列表**\n\n当前无法从 UXP 读取已打开文档，因此不能继续执行 SKU 批量任务。\n\n**工具错误：** ${docsResult?.error || 'listDocuments failed'}`,
                error: docsResult?.error || 'Failed to list Photoshop documents'
            };
        }

        const matchLibraryOpenedDoc = (template: TemplateLibraryItem, size: number, noteMode: boolean): any | null => {
            const docs = docsResult?.documents || [];
            const fileName = normalizeNameWithoutExt(template.filePath.split(/[/\\]/).pop() || '');
            const displayName = normalizeNameWithoutExt(template.name || '');

            return docs.find((d: any) => {
                if (template.source === 'project-folder' && !isDocumentFromTemplateDirectory(d, templateDir)) {
                    return false;
                }
                if (isExactTemplateDocument(d, template.filePath)) {
                    return true;
                }
                const name = normalizeNameWithoutExt(d?.name || '');
                if (!name) return false;
                if (name.includes(skuKeyword.toLowerCase())) return false;
                const hasNote = name.includes(NOTE_TEMPLATE_KEYWORD);
                if (noteMode && !hasNote) return false;
                if (!noteMode && hasNote) return false;

                if (name === fileName || name === displayName || name.includes(fileName) || name.includes(displayName)) {
                    return true;
                }

                const inferredSize = extractComboSize(name);
                if (inferredSize === size && name.includes('模板')) return true;
                return false;
            }) || null;
        };

        const findOpenedTemplateDocument = (options: {
            size: number;
            noteMode: boolean;
            templateKeyword?: string;
        }): any | null => {
            const docs = docsResult?.documents || [];
            const sizeKeyword = `${options.size}双`;
            const keyword = String(options.templateKeyword || '').trim().toLowerCase();

            return docs.find((d: any) => {
                if (!d?.name) return false;
                if (!isDocumentFromTemplateDirectory(d, templateDir)) return false;

                const name = String(d.name || '').toLowerCase();
                if (name.includes(skuKeyword.toLowerCase())) return false;

                const hasNote = name.includes(NOTE_TEMPLATE_KEYWORD);
                if (options.noteMode !== hasNote) return false;

                if (keyword && !name.includes(keyword)) return false;

                if (options.noteMode) {
                    return name.includes(sizeKeyword);
                }

                return name.includes(sizeKeyword) && (name.includes(`${options.size}双装`) || name.includes(`${options.size}双模板`) || name.includes('模板'));
            }) || null;
        };

        const tryOpenProjectTemplate = async (size: number, noteMode: boolean): Promise<{ success: boolean; templateDoc?: any; template?: TemplateLibraryItem; error?: string }> => {
            const candidate = pickBestTemplateFromLibrary(projectSkuTemplates, {
                size,
                keyword: templateKeyword,
                noteMode
            });

            if (!candidate) {
                return { success: false, error: noteMode ? `项目模板目录缺少 ${size}双自选备注模板` : `项目模板目录缺少 ${size}双模板` };
            }

            callbacks?.onMessage?.(`📁 使用项目模板目录文件：${candidate.name}`);

            try {
                await window.designEcho?.openPath?.(candidate.filePath);
            } catch (error: any) {
                return { success: false, error: error?.message || String(error) };
            }

            for (let i = 0; i < 8; i++) {
                await sleep(700);
                await refreshDocuments();
                const matched = matchLibraryOpenedDoc(candidate, size, noteMode);
                if (matched) {
                    return { success: true, templateDoc: matched, template: candidate };
                }
            }

            return { success: false, error: `已打开项目模板文件但未在文档列表中识别到：${candidate.name}` };
        };

        const tryOpenLibraryTemplate = async (size: number, noteMode: boolean): Promise<{ success: boolean; templateDoc?: any; template?: TemplateLibraryItem; error?: string }> => {
            if (!allowLibraryTemplateFallback) {
                return { success: false, error: '当前任务已锁定当前项目模板目录，未启用本地模板库回退' };
            }
            let candidate: TemplateLibraryItem | null = null;

            // 优先使用主进程模板服务的匹配逻辑，保证评分规则一致
            try {
                const serviceCandidate = await window.designEcho?.invoke?.('template-knowledge:findTemplateForSKU', {
                    comboSize: size,
                    keyword: templateKeyword || undefined,
                    noteMode,
                    sources: ['local-library']
                });
                candidate = normalizeTemplateCandidate(serviceCandidate);
            } catch (error) {
                console.warn('[SKU-Batch] 调用模板服务匹配失败，使用本地兜底匹配:', error);
            }

            // 兜底：前端本地候选内匹配
            if (!candidate) {
                candidate = pickBestTemplateFromLibrary(localSkuTemplates, {
                    size,
                    keyword: templateKeyword,
                    noteMode
                });
            }

            if (!candidate) {
                return { success: false, error: noteMode ? `本地模板库缺少 ${size}双自选备注模板` : `本地模板库缺少 ${size}双模板` };
            }

            callbacks?.onMessage?.(`📚 使用本地模板库模板：${candidate.name}`);

            try {
                await window.designEcho?.openPath?.(candidate.filePath);
            } catch (error: any) {
                return { success: false, error: error?.message || String(error) };
            }

            for (let i = 0; i < 8; i++) {
                await sleep(700);
                await refreshDocuments();
                const matched = matchLibraryOpenedDoc(candidate, size, noteMode);
                if (matched) {
                    return { success: true, templateDoc: matched, template: candidate };
                }
            }

            return { success: false, error: `已打开本地模板库文件但未在文档列表中识别到：${candidate.name}` };
        };

        const findOpenedSkuDocument = (options: {
            expectedPath?: string;
            allowPathlessProjectFallback?: boolean;
        } = {}): any | null => {
            const docs = docsResult?.documents || [];
            return docs.find((d: any) => matchesSkuDocument(d, skuKeyword, {
                projectPath: projectContext?.projectPath,
                expectedPath: options.expectedPath,
                allowPathlessProjectFallback: options.allowPathlessProjectFallback
            })) || null;
        };

        const waitForSkuDocument = async (expectedPath?: string): Promise<any | null> => {
            for (let i = 0; i < 10; i++) {
                await sleep(700);
                await refreshDocuments();
                const exact = findOpenedSkuDocument({ expectedPath });
                if (exact) return exact;
            }

            if (expectedPath) {
                await refreshDocuments();
                return findOpenedSkuDocument({
                    expectedPath,
                    allowPathlessProjectFallback: true
                });
            }

            return null;
        };

        const openProjectSkuSourceFile = async (candidate: ProjectSkuSourceFile): Promise<any | null> => {
            callbacks?.onMessage?.(`📂 使用当前项目 SKU 素材文件：${candidate.name}`);
            emitStep(
                'tool_planned',
                '准备打开项目 SKU 素材',
                `从当前项目选择：${candidate.path}`,
                'running',
                0.14
            );

            try {
                const openResult = await (window as any).designEcho?.openPath?.(candidate.path);
                if (openResult && openResult !== '' && openResult !== true) {
                    console.warn('[SKU-Batch] 打开项目 SKU 素材失败:', openResult);
                    return null;
                }
            } catch (error) {
                console.warn('[SKU-Batch] 打开项目 SKU 素材异常:', error);
                return null;
            }

            return await waitForSkuDocument(candidate.path);
        };

        const resolveProjectSkuSourceDocument = async (): Promise<{
            skuDoc: any | null;
            projectSkuSourceFile?: ProjectSkuSourceFile;
            error?: string;
        }> => {
            const projectPath = projectContext?.projectPath;

            if (projectPath) {
                await window.designEcho?.setProjectRoot?.(projectPath);

                callbacks?.onToolStart?.('searchProjectResources');
                const searchResult = await safeToolCall('searchProjectResources', {
                    query: skuKeyword,
                    type: 'design',
                    directory: projectPath,
                    limit: 50
                }, 12000, 'search-project-sku-source-file');
                callbacks?.onToolComplete?.('searchProjectResources', searchResult);

                const projectSkuSourceFile = pickBestProjectSkuSourceFile(
                    searchResult?.results || [],
                    skuKeyword,
                    projectPath
                );

                if (projectSkuSourceFile) {
                    const openedProjectDoc = findOpenedSkuDocument({
                        expectedPath: projectSkuSourceFile.path
                    });
                    if (openedProjectDoc) {
                        callbacks?.onMessage?.(`📂 已复用当前项目 SKU 素材文档：${openedProjectDoc.name}`);
                        return { skuDoc: openedProjectDoc, projectSkuSourceFile };
                    }

                    const openedDoc = await openProjectSkuSourceFile(projectSkuSourceFile);
                    if (openedDoc) {
                        return { skuDoc: openedDoc, projectSkuSourceFile };
                    }

                    return {
                        skuDoc: null,
                        projectSkuSourceFile,
                        error: `已找到当前项目 SKU 素材「${projectSkuSourceFile.name}」，但打开后无法在 Photoshop 文档列表中确认该文件。`
                    };
                }

                const openedProjectDoc = findOpenedSkuDocument();
                if (openedProjectDoc) {
                    callbacks?.onMessage?.(`📂 当前项目已有打开的 SKU 素材文档：${openedProjectDoc.name}`);
                    return { skuDoc: openedProjectDoc };
                }

                const pathlessFallback = findOpenedSkuDocument({ allowPathlessProjectFallback: true });
                if (pathlessFallback) {
                    callbacks?.onMessage?.(`⚠️ 未在当前项目目录找到 SKU PSD/PSB，临时使用已打开文档：${pathlessFallback.name}`);
                    return { skuDoc: pathlessFallback };
                }

                return { skuDoc: null, error: searchResult?.error ? String(searchResult.error) : undefined };
            }

            const openedDoc = (docsResult?.documents || []).find((d: any) => matchesSkuDocument(d, skuKeyword));
            if (openedDoc) {
                callbacks?.onMessage?.(`📂 未加载项目，使用已打开的 SKU 素材文档：${openedDoc.name}`);
            }
            return { skuDoc: openedDoc || null };
        };

        // 2. 查找 SKU 文件
        const skuSourceResolution = await resolveProjectSkuSourceDocument();
        let skuDoc = skuSourceResolution.skuDoc;

        if (!skuDoc) {
            emitStep(
                'warning',
                'SKU 素材文档未找到',
                `未找到当前项目中匹配「${skuKeyword}」的 PSD/PSB 文档。${skuSourceResolution.error ? ` ${skuSourceResolution.error}` : ''}`,
                'error',
                0.18
            );
            return {
                success: false,
                message: `📂 **未找到当前项目的「${skuKeyword}」素材文件**\n\n请确保当前项目目录中包含文件名带「${skuKeyword}」的 PSD/PSB 素材文件。为避免串项目，SKU skill 会优先使用当前项目文件，不会直接拿其他项目已打开的 SKU 文档。\n\n**当前打开的文档：**\n` +
                    (docsResult?.documents?.map((d: any) => `- ${d.name}${d.path ? ` (${d.path})` : ''}`).join('\n') || '无') +
                    (skuSourceResolution.error ? `\n\n**错误细节：** ${skuSourceResolution.error}` : ''),
                error: skuSourceResolution.error || 'SKU document not found'
            };
        }
        
        // 3. 切换到 SKU 文件
        if (skuDoc) {
            emitStep('verification', 'SKU 素材文档已定位', `当前素材文档：${skuDoc.name}`, 'success', 0.2);
            callbacks?.onToolStart?.('switchDocument');
            await executeToolCall('switchDocument', { documentName: skuDoc.name });
            callbacks?.onToolComplete?.('switchDocument', { success: true });
        }
        
        // 4. 获取 SKU 文件的图层组（颜色）
        callbacks?.onToolStart?.('skuLayout');
        const layersResult = await executeToolCall('skuLayout', { action: 'listLayerSets' });
        callbacks?.onToolComplete?.('skuLayout', layersResult);
        
        if (!layersResult?.success || !layersResult?.data?.layerSets) {
            emitStep(
                'warning',
                'SKU 颜色图层读取失败',
                String(layersResult?.error || 'skuLayout listLayerSets 未返回有效 layerSets。'),
                'error',
                0.24
            );
            return {
                success: false,
                message: '⚠️ **无法读取图层组**\n\n请确保 SKU 素材 PSD 已打开且包含颜色图层组。',
                error: layersResult?.error || 'Failed to read layers'
            };
        }
        
        const allLayerNames = layersResult.data.layerSets.map((s: any) => s.name);
        
        // Filter non-color groups, then collapse duplicate color names from the SKU source document.
        const defaultExcludes = ['参考组', '参考', '背景', '图层组', 'background', 'ref', 'group'];
        const excludeList = excludeColors.length > 0 ? excludeColors : defaultExcludes;
        
        const rawValidColors = allLayerNames.filter((c: string) =>
            !excludeList.some(ex => c.toLowerCase().includes(ex.toLowerCase()))
        );
        const { uniqueColors: validColors, duplicateColors } = dedupeColorNames(rawValidColors);
        
        console.log('[SKU-Batch] 颜色图层组分析:', {
            all: allLayerNames,
            excludeList,
            rawValidColors,
            validColors,
            duplicateColors
        });
        if (duplicateColors.length > 0) {
            callbacks?.onMessage?.(`检测到重复颜色图层组，已自动去重：${duplicateColors.join(' / ')}`);
        }

        const skuDocName = skuDoc?.name || '未知文档';
        if (validColors.length === 0) {
            emitStep(
                'warning',
                'SKU 颜色图层为空',
                `在「${skuDocName}」中没有识别到可用颜色图层组。`,
                'error',
                0.26
            );
            return {
                success: false,
                message: `⚠️ **未找到颜色图层组**\n\n在「${skuDocName}」中发现的图层组：${allLayerNames.join('、')}\n\n请确保 SKU 素材 PSD 中的图层组以颜色命名。`,
                error: 'No valid color layer groups'
            };
        }
        emitStep(
            'verification',
            'SKU 颜色图层读取完成',
            `识别到 ${validColors.length} 个可用颜色：${validColors.slice(0, 8).join(' / ')}${validColors.length > 8 ? ' ...' : ''}`,
            'success',
            0.28
        );
        
        // 5. 解析参数与自动推断规格
        let comboSizes = (params.comboSizes as number[]) || [];
        const countPerSize = Math.max(1, Number((params.countPerSize as number) || 5));
        const specifiedColors = params.specifiedColors as string[][] | undefined;
        const normalizedUserInput = String(params.userIntent || _context?.userInput || '');
        const disableNotesByIntent = /不需要自选备注|不要自选备注|无需自选备注|不用自选备注|仅组合|只要组合|不生成(?:自选)?备注|不要备注图/.test(normalizedUserInput);
        const explicitNotesIntent = /自选备注|备注图/.test(normalizedUserInput);
        const generateNotes = typeof params.generateNotes === 'boolean'
            ? params.generateNotes
            : (explicitNotesIntent && !disableNotesByIntent);
        const onlyNotes = params.onlyNotes as boolean || false;
        
        // 如果未指定规格，尝试自动发现
        if (comboSizes.length === 0 && !params.comboSize) {
            callbacks?.onMessage?.('🔍 正在扫描项目模板与本地模板库以自动推断规格...');
            const foundSpecs = new Set<number>();

            // 1. 从项目模板目录推断（本地文件系统直扫，避免检索漏检）
            const projectSpecs = collectSizesFromLibrary(projectSkuTemplates);
            for (const size of projectSpecs) {
                if (isReasonableSkuSize(size)) foundSpecs.add(size);
            }
            if (projectSpecs.length > 0) {
                callbacks?.onMessage?.(`📁 项目模板目录识别到规格: ${projectSpecs.join(' / ')}双`);
            }

            // 2. 从当前已打开的模板文档中补充推断，但只接受模板目录中的组合模板
            const openedTemplateSpecs = collectSizesFromOpenedTemplateDocs(
                docsResult?.documents || [],
                skuKeyword,
                templateDir
            );
            for (const size of openedTemplateSpecs) {
                if (isReasonableSkuSize(size)) foundSpecs.add(size);
            }
            if (openedTemplateSpecs.length > 0) {
                callbacks?.onMessage?.(`🗂️ 已打开模板识别到规格: ${openedTemplateSpecs.join(' / ')}双`);
            }

            // 3. 从本地模板库推断
            const librarySpecs = localLibrarySpecs.length > 0
                ? localLibrarySpecs
                : collectSizesFromLibrary(localSkuTemplates);
            for (const size of librarySpecs) {
                if (isReasonableSkuSize(size)) foundSpecs.add(size);
            }
            if (librarySpecs.length > 0) {
                callbacks?.onMessage?.(`📚 本地模板库识别到规格: ${librarySpecs.join(' / ')}双`);
            }
            
            if (foundSpecs.size > 0) {
                comboSizes = Array.from(foundSpecs).filter(isReasonableSkuSize).sort((a, b) => a - b);
                callbacks?.onMessage?.(`✅ 自动发现可用规格: ${comboSizes.join(' / ')}双`);
            } else {
                comboSizes = [2]; // 默认降级
                callbacks?.onMessage?.(`⚠️ 未发现明确的规格模板，将默认尝试 2双规格${templateDir ? `（项目模板目录：${templateDir}）` : ''}`);
            }
            if (projectSpecs.length > 0 || openedTemplateSpecs.length > 0) {
                comboSizes = Array.from(new Set([...projectSpecs, ...openedTemplateSpecs]))
                    .filter(isReasonableSkuSize)
                    .sort((a, b) => a - b);
            }
        } else if (comboSizes.length === 0) {
            comboSizes = [params.comboSize || 2].filter(isReasonableSkuSize);
        }

        const modelPlan = !onlyNotes
            ? await planSkuIntentWithModel({
                userIntent: normalizedUserInput,
                availableColors: validColors,
                detectedSizes: comboSizes,
                defaultCountPerSize: countPerSize,
                defaultGenerateNotes: generateNotes
            })
            : null;

        const requestedMonochromeColors = modelPlan?.appendMonochromeColors?.length
            ? modelPlan.appendMonochromeColors
            : resolveRequestedMonochromeColors(normalizedUserInput, validColors);
        const requestedExplicitCombos = modelPlan?.specifiedCombos?.length
            ? modelPlan.specifiedCombos
            : parseRequestedExplicitCombos(normalizedUserInput, validColors);

        const requestedTargetSizes = resolveRequestedTargetSizes(normalizedUserInput, comboSizes);
        const hasAppendIntent = /(在原有|原有基础|基础上|增加|新增|追加|再加|额外)/.test(normalizedUserInput);
        const hasSpecifiedOnlyIntent = /(只做|只要|单独做|单独生成|仅做|就做)/.test(normalizedUserInput);
        const runSpecifiedOnly = !onlyNotes
            && !specifiedColors
            && requestedExplicitCombos.length > 0
            && (
                modelPlan?.mode === 'specified-only'
                || (modelPlan?.mode !== 'append' && (hasSpecifiedOnlyIntent || !hasAppendIntent))
            );
        const effectiveSpecifiedColors = specifiedColors && specifiedColors.length > 0
            ? specifiedColors
            : (runSpecifiedOnly ? requestedExplicitCombos : undefined);
        const effectiveCountPerSize = modelPlan?.countPerSize && modelPlan.mode === 'default'
            ? modelPlan.countPerSize
            : countPerSize;
        const effectiveGenerateNotes = disableNotesByIntent
            ? false
            : (generateNotes || modelPlan?.generateNotes === true);
        const effectiveRequestedTargetSizes = modelPlan?.targetSizes?.length
            ? modelPlan.targetSizes
            : requestedTargetSizes;

        if (runSpecifiedOnly) {
            comboSizes = Array.from(new Set(requestedExplicitCombos.map(combo => combo.length)))
                .filter(isReasonableSkuSize)
                .sort((a, b) => a - b);
        }

        console.log('[SKU-Batch] 参数解析:', {
            comboSizes,
            countPerSize: effectiveCountPerSize,
            specifiedColors: effectiveSpecifiedColors,
            generateNotes: effectiveGenerateNotes,
            onlyNotes,
            requestedMonochromeColors,
            requestedExplicitCombos,
            requestedTargetSizes: effectiveRequestedTargetSizes,
            runSpecifiedOnly,
            modelPlan
        });
        
        if (onlyNotes) {
            callbacks?.onMessage?.(`📊 模式: 只生成自选备注, 规格=${comboSizes.join('/')}双`);
        } else {
            callbacks?.onMessage?.(`📊 解析参数: 规格=${comboSizes.join('/')}双, 每规格${effectiveCountPerSize}个组合`);
        }
        emitStep(
            'verification',
            'SKU 任务参数解析完成',
            onlyNotes
                ? `只生成自选备注，规格 ${comboSizes.join(' / ')} 双。`
                : `规格 ${comboSizes.join(' / ')} 双，每规格目标 ${effectiveCountPerSize} 个组合，生成备注：${effectiveGenerateNotes ? '是' : '否'}。`,
            'success',
            0.36
        );

        if (runSpecifiedOnly && requestedExplicitCombos.length > 0) {
            callbacks?.onMessage?.(`🎯 已识别为指定组合任务：只执行 ${requestedExplicitCombos.map(combo => combo.join('+')).join(' / ')}`);
        }
        if (modelPlan?.reasoning) {
            callbacks?.onMessage?.(`🧠 已理解你的 SKU 要求：${modelPlan.reasoning}`);
        }

        if (!onlyNotes && requestedMonochromeColors.length > 0) {
            callbacks?.onMessage?.(`🧩 已识别附加组合要求：每个规格追加 ${requestedMonochromeColors.join(' / ')} 单色组合`);
        }

        if (!onlyNotes) {
            const openedTemplateCount = (docsResult?.documents || []).filter((d: any) => {
                const name = String(d?.name || '').toLowerCase();
                return /(\d+)双/.test(name) && !name.includes(skuKeyword.toLowerCase());
            }).length;
            const hasLibraryTemplate = comboSizes.some(size =>
                !!pickBestTemplateFromLibrary(localSkuTemplates, {
                    size,
                    keyword: templateKeyword,
                    noteMode: false
                })
            );

            if (openedTemplateCount === 0 && templateDir) {
                let foundTemplateCount = projectSkuTemplates.length;
                let probeError: string | undefined;

                if (foundTemplateCount === 0) {
                    const probe = await safeToolCall('searchProjectResources', {
                        query: '模板',
                        type: 'all',
                        directory: templateDir,
                        limit: 20
                    }, 10000, 'probe-template-files');

                    const foundTemplateFiles = (probe?.results || []).filter((f: any) =>
                        TEMPLATE_FILE_PATTERN.test(String(f?.name || ''))
                    );
                    foundTemplateCount = foundTemplateFiles.length;
                    probeError = probe?.error;
                }

                if (foundTemplateCount === 0) {
                    if (!hasLibraryTemplate) {
                        const availabilitySummary = summarizeTemplateAvailability({
                            templateDir,
                            projectTemplates: projectSkuTemplates,
                            localTemplates: localSkuTemplates,
                            localSpecs: localLibrarySpecs
                        });
                        emitStep(
                            'warning',
                            'SKU 模板不可用',
                            `项目模板目录和本地模板库都没有命中所需规格：${comboSizes.join(' / ')} 双。`,
                            'error',
                            0.42
                        );
                        return {
                            success: false,
                            message: `⚠️ SKU 批量生成失败\n\n未找到可用模板文件。\n\n**当前检查结果**\n${availabilitySummary}\n\n**处理建议**\n1. 在「${templateDir}」下放入如「2双装 / 3双装 / 4双装」模板\n2. 或先在 Photoshop 打开对应规格模板后再执行\n3. 或在模板知识库中配置本地模板库目录`,
                            error: probeError || 'Template files not found'
                        };
                    }
                    callbacks?.onMessage?.('📚 项目模板目录未命中，将切换到本地模板库继续执行。');
                }
            } else if (openedTemplateCount === 0 && !hasLibraryTemplate) {
                const availabilitySummary = summarizeTemplateAvailability({
                    templateDir,
                    projectTemplates: projectSkuTemplates,
                    localTemplates: localSkuTemplates,
                    localSpecs: localLibrarySpecs
                });
                emitStep(
                    'warning',
                    'SKU 模板不可用',
                    `未找到已打开模板，也没有本地模板库可用模板：${comboSizes.join(' / ')} 双。`,
                    'error',
                    0.42
                );
                return {
                    success: false,
                    message: `⚠️ SKU 批量生成失败\n\n未找到可用模板。\n\n**当前检查结果**\n${availabilitySummary}\n\n请先打开模板文件，或在模板知识库中配置本地模板库目录后重试。`,
                    error: 'Template files not found'
                };
            }
        }
        
        // 6. 按规格分组生成颜色组合
        const combosBySize: Record<number, string[][]> = {};
        
        if (onlyNotes) {
            for (const size of comboSizes) {
                combosBySize[size] = [];
            }
        } else if (effectiveSpecifiedColors && effectiveSpecifiedColors.length > 0) {
            for (const combo of effectiveSpecifiedColors) {
                const size = combo.length;
                if (!combosBySize[size]) combosBySize[size] = [];
                combosBySize[size].push(combo);
            }
        } else {
            for (const size of comboSizes) {
                const sizeCombos = generateCombinationsOfSize(validColors, size, effectiveCountPerSize);
                if (sizeCombos.length < effectiveCountPerSize) {
                    callbacks?.onMessage?.(`⚠️ ${size}双：请求 ${effectiveCountPerSize} 个组合，但按“不重复（无序）”原则最多生成 ${sizeCombos.length} 个`);
                }
                combosBySize[size] = sizeCombos;
            }
        }

        if (!onlyNotes && !runSpecifiedOnly && requestedExplicitCombos.length > 0 && (modelPlan?.mode === 'append' || hasAppendIntent)) {
            const explicitComboResult = appendRequestedSpecificCombos(combosBySize, requestedExplicitCombos);
            if (explicitComboResult.added.length > 0) {
                callbacks?.onMessage?.(`✅ 已按要求追加指定组合：${explicitComboResult.added.map(item => `${item.size}双=${item.combo.join('+')}`).join(' / ')}`);
            }
            if (explicitComboResult.skipped.length > 0) {
                callbacks?.onMessage?.(`ℹ️ 以下指定组合原本已存在，未重复追加：${explicitComboResult.skipped.join(' / ')}`);
            }
        }

        if (!onlyNotes && requestedMonochromeColors.length > 0) {
            const targetSizes = effectiveRequestedTargetSizes.length > 0 ? effectiveRequestedTargetSizes : comboSizes;
            const extraComboResult = appendRequestedExtraCombos(combosBySize, targetSizes, requestedMonochromeColors);
            if (extraComboResult.added.length > 0) {
                const preview = extraComboResult.added
                    .slice(0, 6)
                    .map(item => `${item.size}双=${item.combo.join('+')}`)
                    .join(' / ');
                callbacks?.onMessage?.(`✅ 已追加指定组合：${preview}${extraComboResult.added.length > 6 ? ' ...' : ''}`);
            }
            if (extraComboResult.skipped.length > 0) {
                callbacks?.onMessage?.(`ℹ️ 以下指定组合原本已存在，未重复追加：${extraComboResult.skipped.join(' / ')}`);
            }
        }

        // 7. 按规格循环处理
        if (!onlyNotes) {
            const duplicateRemovals = dedupeAllCombosBySize(combosBySize);
            if (duplicateRemovals.length > 0) {
                const removalSummary = duplicateRemovals
                    .map(item => `${item.size}双去重 ${item.removedCombos.length} 组`)
                    .join(' / ');
                callbacks?.onMessage?.(`已自动去除重复 SKU 组合（包含顺序不同但颜色相同的重复）：${removalSummary}`);
            }
        }
        const plannedComboCount = Object.values(combosBySize).reduce((sum, combos) => sum + combos.length, 0);
        const plannedNoteSizes = comboSizes
            .filter(size => decideSkuSelfSelectNoteGeneration({
                comboSize: size,
                notesRequested: effectiveGenerateNotes,
                onlyNotes
            }).shouldGenerate);
        callbacks?.onMessage?.(
            `🧭 SKU 执行计划已确认：素材「${skuDocName}」，规格 ${comboSizes.join(' / ')} 双，` +
            `组合 ${plannedComboCount} 组，自选备注 ${plannedNoteSizes.length > 0 ? `${plannedNoteSizes.join(' / ')} 双` : '不生成或已跳过'}。`
        );
        emitStep(
            'tool_planned',
            'SKU 执行计划已确认',
            `规格 ${Object.keys(combosBySize).join(' / ')} 双，计划组合 ${plannedComboCount} 组，自选备注 ${plannedNoteSizes.join(' / ') || '无'}。`,
            'success',
            0.5
        );

        const allFinalFiles: string[] = [];
        const allCopyErrors: string[] = [];
        const allToolResults: any[] = [
            { toolName: 'listDocuments', result: docsResult },
            { toolName: 'skuLayout-listLayerSets', result: layersResult }
        ];
        const processedSizes: string[] = [];
        const completedComboSizes = new Set<number>();
        const generatedNoteSizes = new Set<number>();
        const skippedNoteSizes = new Set<number>();

        const resolveExportedFileRecord = async (
            rawFileInfo: string,
            relativeDirName: string
        ): Promise<{ success: boolean; record?: string; error?: string }> => {
            try {
                const info = JSON.parse(rawFileInfo);

                if (info.status === 'exported_to_temp' && info.tempPath) {
                    const correctTargetDir = outputDir || info.targetDir;
                    const targetPath = `${correctTargetDir}\\${relativeDirName}\\${info.targetName}`;

                    const copyFn = (window as any).designEcho?.copyFile;
                    if (!copyFn) {
                        return { success: false, error: `${info.targetName}: copyFile unavailable` };
                    }

                    const copyResult = await copyFn(info.tempPath, targetPath);
                    if (!copyResult?.success) {
                        return { success: false, error: `${info.targetName}: ${copyResult?.error || '复制失败'}` };
                    }

                    try {
                        await (window as any).designEcho?.invoke?.('fs:deleteFile', info.tempPath);
                    } catch (e) {
                        // ignore temp cleanup failures
                    }

                    return { success: true, record: targetPath };
                }

                if (info.status === 'exported_jsx') {
                    const exportedPath = String(info.path || '').trim();
                    if (exportedPath) {
                        return { success: true, record: exportedPath };
                    }
                    if (info.targetName) {
                        return {
                            success: true,
                            record: `${relativeDirName}\\${String(info.targetName).trim()}`
                        };
                    }
                }

                if (!info.status) {
                    return { success: true, record: rawFileInfo };
                }

                return { success: false, error: `${rawFileInfo}: unsupported export status ${info.status}` };
            } catch (e) {
                const fileName = rawFileInfo.split('\\').pop() || rawFileInfo.split('/').pop() || rawFileInfo;
                return { success: true, record: fileName };
            }
        };
        
        for (const [sizeStr, combos] of Object.entries(combosBySize)) {
            const size = parseInt(sizeStr, 10);
            emitStep(
                'observation',
                '准备处理 SKU 规格',
                onlyNotes ? `${size} 双自选备注。` : `${size} 双，组合 ${combos.length} 组。`,
                'running',
                0.52
            );
            
            if (signal?.aborted) {
                emitStep('stopped', 'SKU 批量生成已停止', '用户取消或信号中止。', 'error', 1);
                return {
                    success: true,
                    cancelled: true,
                    message: '⏹️ 已停止'
                };
            }
            
            if (!onlyNotes && combos.length === 0) continue;
            
            if (onlyNotes) {
                callbacks?.onMessage?.(`\n📐 正在处理 **${size}双** 自选备注...`);
            } else {
                callbacks?.onMessage?.(`\n📐 正在处理 **${size}双** 规格 (${combos.length}个组合)...`);
            }
            
            let templateDoc: any = null;
            
            // 查找/打开模板（非 onlyNotes 模式）
            // 关键：组合模板必须排除「自选备注」——自选备注模板用于展示全部颜色，组合模板用于具体颜色组合排版
            if (!onlyNotes) {
                const sizeKeyword = `${size}双`;
                const excludeNoteKeyword = '自选备注';
                
                docsResult = await executeToolCall('listDocuments', { includeDetails: true });

                if (templateKeyword && !templateKeyword.toLowerCase().includes(excludeNoteKeyword)) {
                    templateDoc = findOpenedTemplateDocument({
                        size,
                        noteMode: false,
                        templateKeyword
                    });
                }

                if (!templateDoc) {
                    templateDoc = findOpenedTemplateDocument({
                        size,
                        noteMode: false
                    });
                }
                
                console.log('[SKU-Batch] 组合模板选择:', {
                    sizeKeyword,
                    templateKeyword: templateKeyword || '(未指定)',
                    selected: templateDoc?.name ?? null,
                    excluded: '含「自选备注」的文档已排除'
                });
                
                if (!templateDoc) {
                    callbacks?.onMessage?.(`📂 正在打开「${sizeKeyword}装」模板...`);

                    let openResult: any = await safeToolCall('openProjectFile', {
                        query: `${sizeKeyword}装`,
                        type: 'all',
                        directory: templateDir
                    }, 20000, `open-${sizeKeyword}-template-primary`);
                    
                    if (!openResult?.success) {
                        openResult = await safeToolCall('openProjectFile', {
                            query: sizeKeyword,
                            type: 'all',
                            directory: templateDir
                        }, 20000, `open-${sizeKeyword}-template-secondary`);
                    }
                    
                    // 降级策略：如果找不到精确规格的模板，尝试搜索通用模板

                    
                    if (openResult?.success) {
                        await sleep(1000);
                        await refreshDocuments();
                        
                        // 优先查找匹配规格的组合模板（排除自选备注）
                        templateDoc = findOpenedTemplateDocument({
                            size,
                            noteMode: false
                        });

                        // 如果没找到精确匹配，尝试使用当前项目模板目录中任何非 SKU / 非自选备注模板

                    }

                    // openProjectFile 未命中时，尝试直接从项目模板目录按文件路径打开
                    if (!templateDoc) {
                        const projectResult = await tryOpenProjectTemplate(size, false);
                        if (projectResult.success && projectResult.templateDoc) {
                            templateDoc = projectResult.templateDoc;
                        }
                    }

                    // 项目模板目录仍未命中时，回退到本地模板库
                    if (!templateDoc) {
                        const libResult = await tryOpenLibraryTemplate(size, false);
                        if (libResult.success && libResult.templateDoc) {
                            templateDoc = libResult.templateDoc;
                        } else if (!openResult?.success) {
                            const reason = openResult?.error
                                ? String(openResult.error)
                                : (openResult?.timeout ? '打开模板超时' : '未找到模板文件');
                            const mergedReason = libResult.error ? `${reason}; 本地模板库: ${libResult.error}` : reason;
                            allCopyErrors.push(`${size}双模板: ${mergedReason}`);
                            continue;
                        }
                    }
                }
                
                if (!templateDoc) {
                    allCopyErrors.push(`${size}双: 模板不可用`);
                    emitStep('warning', 'SKU 规格模板不可用', `${size} 双没有找到可用组合模板。`, 'error', 0.62);
                    continue;
                }
                
                await executeToolCall('switchDocument', { documentName: templateDoc.name });
            }
            
            // 执行 SKU 排版（非 onlyNotes 模式）
            if (!onlyNotes) {
                callbacks?.onMessage?.(`🔧 正在执行 ${size}双 排版...`);
                
                const executeResult = await executeSkuLayoutWithModalRetry({
                    action: 'execute',
                    combos: combos,
                    skuDocName: skuDocName,
                    templateDocName: templateDoc.name,
                    outputFormat: 'jpg',
                    quality: 12,
                    outputDir: outputDir
                }, `sku-layout-${size}`);
                
                allToolResults.push({ toolName: `skuLayout-${size}双`, result: executeResult });
                
                if (executeResult?.success) {
                    const exportedFiles = executeResult.data?.exportedFiles || [];
                    let producedComboFiles = 0;
                    
                    for (const fileInfo of exportedFiles) {
                        const resolvedFile = await resolveExportedFileRecord(fileInfo, `${size}\u53cc`);
                        if (resolvedFile.success && resolvedFile.record) {
                            allFinalFiles.push(resolvedFile.record);
                            producedComboFiles += 1;
                        } else if (resolvedFile.error) {
                            allCopyErrors.push(resolvedFile.error);
                        }
                    }
                    
                    if (producedComboFiles > 0) {
                        completedComboSizes.add(size);
                        processedSizes.push(`${size}双 (${combos.length}组)`);
                        emitStep(
                            'verification',
                            'SKU 规格排版完成',
                            `${size} 双导出 ${producedComboFiles} 个组合文件。`,
                            'success',
                            0.72
                        );
                    } else {
                        allCopyErrors.push(`${size}双: 未导出任何文件`);
                        emitStep('warning', 'SKU 规格排版无导出', `${size} 双排版成功返回，但没有导出文件。`, 'error', 0.72);
                    }
                } else {
                    allCopyErrors.push(`${size}双: ${executeResult?.error || '排版失败'}`);
                    emitStep('warning', 'SKU 规格排版失败', `${size} 双：${String(executeResult?.error || '排版失败')}`, 'error', 0.72);
                }
            }
            
            // 生成自选备注
            if (effectiveGenerateNotes || onlyNotes) {
                const noteDecision = decideSkuSelfSelectNoteGeneration({
                    comboSize: size,
                    notesRequested: effectiveGenerateNotes,
                    onlyNotes
                });

                if (!noteDecision.shouldGenerate) {
                    skippedNoteSizes.add(size);
                    emitStep('verification', 'SKU 自选备注已跳过', `${size} 双：${noteDecision.message}`, 'success', 0.78);
                    callbacks?.onMessage?.(`ℹ️ 已跳过 ${size}双 自选备注：${noteDecision.message}。`);
                    if (onlyNotes && !processedSizes.includes(`${size}双 (自选备注已跳过)`)) {
                        processedSizes.push(`${size}双 (自选备注已跳过)`);
                    }
                    continue;
                }

                callbacks?.onMessage?.(`📝 正在生成 ${size}双 自选备注...`);
                
                await refreshDocuments();
                let noteTemplateDoc = findOpenedTemplateDocument({
                    size,
                    noteMode: true
                });
                
                if (!noteTemplateDoc) {
                    let noteOpenResult: any = await safeToolCall('openProjectFile', {
                        query: `${size}双自选备注`,
                        type: 'all',
                        directory: templateDir
                    }, 20000, `open-${size}note-template-primary`);
                    
                    if (!noteOpenResult?.success) {
                        noteOpenResult = await safeToolCall('openProjectFile', {
                            query: `${size}双装自选备注`,
                            type: 'all',
                            directory: templateDir
                        }, 20000, `open-${size}note-template-secondary`);
                    }
                    
                    await sleep(600);
                    await refreshDocuments();
                    noteTemplateDoc = findOpenedTemplateDocument({
                        size,
                        noteMode: true
                    });

                    if (!noteTemplateDoc) {
                        const noteProjectResult = await tryOpenProjectTemplate(size, true);
                        if (noteProjectResult.success && noteProjectResult.templateDoc) {
                            noteTemplateDoc = noteProjectResult.templateDoc;
                        }
                    }

                    if (!noteTemplateDoc) {
                        const noteLibResult = await tryOpenLibraryTemplate(size, true);
                        if (noteLibResult.success && noteLibResult.templateDoc) {
                            noteTemplateDoc = noteLibResult.templateDoc;
                        } else if (!noteOpenResult?.success && noteLibResult.error) {
                            allCopyErrors.push(`${size}双自选备注: ${noteLibResult.error}`);
                        }
                    }
                }
                
                if (noteTemplateDoc) {
                    await executeToolCall('switchDocument', { documentName: noteTemplateDoc.name });
                    
                    const noteResult = await executeSkuLayoutWithModalRetry({
                        action: 'arrangeDynamic',
                        combos: [validColors],
                        skuDocName: skuDocName,
                        templateDocName: noteTemplateDoc.name,
                        outputFormat: 'jpg',
                        quality: 12,
                        outputDir: outputDir,
                        noteFilePrefix: `${size}双自选备注`
                    }, `sku-note-${size}`);
                    
                    if (noteResult?.success) {
                        const noteFiles = noteResult.data?.exportedFiles || [];
                        let producedNoteFiles = 0;
                        
                        for (const fileInfo of noteFiles) {
                            const resolvedFile = await resolveExportedFileRecord(fileInfo, `${size}\u53cc\u81ea\u9009\u5907\u6ce8`);
                            if (resolvedFile.success && resolvedFile.record) {
                                allFinalFiles.push(resolvedFile.record);
                                producedNoteFiles += 1;
                            } else if (resolvedFile.error) {
                                allCopyErrors.push(resolvedFile.error);
                            }
                        }
                        
                        if (producedNoteFiles > 0) {
                            generatedNoteSizes.add(size);
                            emitStep('verification', 'SKU 自选备注生成完成', `${size} 双自选备注导出 ${producedNoteFiles} 个文件。`, 'success', 0.84);
                        } else {
                            allCopyErrors.push(`${size}双自选备注: 未导出任何文件`);
                            emitStep('warning', 'SKU 自选备注无导出', `${size} 双自选备注工具返回成功，但没有导出文件。`, 'error', 0.84);
                        }

                        if (onlyNotes && producedNoteFiles > 0 && !processedSizes.includes(`${size}双 (自选备注)`)) {
                            processedSizes.push(`${size}双 (自选备注)`);
                        }
                    } else {
                        allCopyErrors.push(`${size}双自选备注: 生成失败`);
                        emitStep('warning', 'SKU 自选备注生成失败', `${size} 双自选备注：${String(noteResult?.error || '生成失败')}`, 'error', 0.84);
                    }
                } else {
                    allCopyErrors.push(`${size}双自选备注: 未找到模板`);
                    emitStep('warning', 'SKU 自选备注模板不可用', `${size} 双没有找到自选备注模板。`, 'error', 0.84);
                }
            }
        }
        
        // 8. 汇总结果
        const completedCombosBySize = Object.fromEntries(
            Object.entries(combosBySize).filter(([size]) => completedComboSizes.has(Number(size)))
        ) as Record<string, string[][]>;
        const totalCombos = Object.values(completedCombosBySize).reduce((sum, arr) => sum + arr.length, 0);
        const noteCount = generatedNoteSizes.size;

        const comboSummary = Object.entries(completedCombosBySize)
            .map(([size, combos]) => {
                const comboList = combos.map((c, i) => `${i + 1}. ${formatComboForSummary(c)}`).join('\n');
                let summary = `**${size}双装** (${combos.length}组)\n${comboList}`;
                if (generatedNoteSizes.has(Number(size))) {
                    summary += `\n+ 已生成自选备注`;
                } else if (skippedNoteSizes.has(Number(size))) {
                    summary += `\n+ 已跳过自选备注（1双 SKU 已覆盖全部颜色）`;
                }
                return summary;
            }).join('\n\n');
        
        const exportFileNames = allFinalFiles.map(f => {
            const fileName = f.split(/[/\\]/).pop() || f;
            return fileName;
        });
        
        const exportSummary = exportFileNames.length > 0 
            ? `\n\n---\n**导出文件** (${exportFileNames.length}个)\n${exportFileNames.join('、')}`
            : '';
        
        const errorSummary = allCopyErrors.length > 0 
            ? `\n\n---\n**警告**\n${allCopyErrors.map(e => `• ${e}`).join('\n')}`
            : '';
        
        const totalGenerated = totalCombos + noteCount;
        const skippedNoteCount = skippedNoteSizes.size;
        const noteInfoParts: string[] = [];
        if (effectiveGenerateNotes || noteCount > 0) noteInfoParts.push(`${noteCount}备注`);
        if (skippedNoteCount > 0) noteInfoParts.push(`${skippedNoteCount}备注已跳过`);
        const noteInfo = noteInfoParts.length > 0 ? ` + ${noteInfoParts.join(' + ')}` : '';
        const templateRelatedFailure = allCopyErrors.some(e => e.includes('模板'));
        const hasProcessedSizes = processedSizes.length > 0;
        const hasWarnings = allCopyErrors.length > 0;
        const resultStatus = !hasProcessedSizes ? 'failed' : hasWarnings ? 'partial' : 'completed';
        const statusLine = resultStatus === 'partial'
            ? '**状态**: 部分完成（存在警告，请复核下方失败项）\n'
            : resultStatus === 'completed'
                ? '**状态**: 已完成\n'
                : '';
        const templateHint = templateRelatedFailure
            ? `\n\n**排查建议**\n${summarizeTemplateAvailability({
                templateDir,
                projectTemplates: projectSkuTemplates,
                localTemplates: localSkuTemplates,
                localSpecs: localLibrarySpecs
            })}\n1. 在「${templateDir || '模板目录'}」下放入如「2双装/3双装/4双装」模板文件\n2. 或先在 Photoshop 打开对应规格模板后再执行\n3. 或在模板知识库中配置「本地模板库目录」（支持 PSD/PSB/TIF）`
            : '';
        
        const successMessage = processedSizes.length > 0
            ? `${statusLine}**素材**: ${skuDocName}\n**规格**: ${processedSizes.join(' / ')}\n**数量**: ${totalCombos}组合${noteInfo}\n\n${comboSummary}${exportSummary}${errorSummary}`
            : `⚠️ SKU 批量生成失败\n\n未能处理任何规格。${errorSummary}${templateHint}`;
        const skuPlanEvidence: SkuBatchPlanEvidence[] = Object.entries(combosBySize)
            .map(([size, combos]) => ({
                size: Number(size),
                comboCount: Array.isArray(combos) ? combos.length : 0,
                noteGenerated: generatedNoteSizes.has(Number(size)),
                warnings: allCopyErrors.filter((error) => String(error).includes(`${size}双`))
            }))
            .filter((item) => Number.isFinite(item.size));
        const designAgentOs = buildSkuDesignAgentOsEvidence({
            userInput: String(params.userIntent || _context?.userInput || '').trim(),
            colorCount: validColors.length,
            totalCombinations: totalCombos,
            specs: skuPlanEvidence,
            toolResults: allToolResults,
            success: processedSizes.length > 0,
            warnings: allCopyErrors,
            blockers: processedSizes.length > 0 ? [] : ['未能处理任何 SKU 规格。']
        });
        const designPlanner = buildSkuBatchPlannerEvidence({
            userInput: String(params.userIntent || _context?.userInput || '').trim(),
            params,
            context: _context,
            projectPath: projectContext?.projectPath,
            comboSizes,
            colorCount: validColors.length,
            totalCombinations: totalCombos,
            processedSizeCount: processedSizes.length
        });
        emitStep(
            'finalizing',
            'SKU 批量生成结果已汇总',
            `处理规格 ${processedSizes.length} 个，组合 ${totalCombos} 个，导出文件 ${allFinalFiles.length} 个，警告 ${allCopyErrors.length} 条。`,
            processedSizes.length > 0 ? 'success' : 'error',
            1
        );
        
        return {
            success: processedSizes.length > 0,
            message: successMessage,
            toolResults: allToolResults,
            data: {
                totalCombos,
                totalGenerated,
                processedSizes,
                exportCount: allFinalFiles.length,
                warningCount: allCopyErrors.length,
                status: resultStatus,
                partial: resultStatus === 'partial',
                warnings: allCopyErrors,
                skippedNoteSizes: Array.from(skippedNoteSizes).sort((a, b) => a - b),
                designAgentOs,
                skuMemoryEvidence: designPlanner.businessSkillMemoryEvidence,
                businessSkillMemoryEvidence: designPlanner.businessSkillMemoryEvidence,
                skuDesignPlacementIntelligence: designPlanner.skuDesignPlacementIntelligence,
                businessSkillDesignPlacementIntelligence: designPlanner.businessSkillDesignPlacementIntelligence,
                designPlanner
            }
        };
    }
};
