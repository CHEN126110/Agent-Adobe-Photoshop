/**
 * SKU 批量生成技能执行器
 * @description 审美知识驱动的 SKU 颜色组合生成 + 批量排版导出
 */

import type { SkillExecutor, SkillExecuteParams } from './types';
import type { AgentResult } from '../unified-agent.service';
import { executeToolCall } from '../tool-executor.service';
import { useAppStore } from '../../stores/app.store';
import { getEffectiveBrandSpec } from './knowledge-query';

// ==================== 色彩和谐度 ====================

/**
 * 颜色色系分类（基于名称关键词推断）
 */
type ColorFamily = 'warm' | 'cool' | 'neutral' | 'accent';

const COLOR_FAMILY_KEYWORDS: Record<ColorFamily, string[]> = {
    warm: ['红', '粉', '橙', '杏', '棕', '咖', '焦', '驼', '酒', '玫', '珊', '樱', '桃', '砖', 'red', 'pink', 'orange', 'brown', 'coral'],
    cool: ['蓝', '绿', '青', '湖', '薄荷', '翠', '靛', '藏', 'blue', 'green', 'teal', 'mint', 'navy', 'cyan'],
    neutral: ['白', '黑', '灰', '米', '卡', '奶', '杂', '麻', 'white', 'black', 'gray', 'grey', 'beige', 'ivory'],
    accent: ['紫', '黄', '金', '银', '亮', 'purple', 'yellow', 'gold', 'silver']
};

function inferColorFamily(colorName: string): ColorFamily {
    const lower = colorName.toLowerCase();
    for (const [family, keywords] of Object.entries(COLOR_FAMILY_KEYWORDS)) {
        if (keywords.some(kw => lower.includes(kw))) return family as ColorFamily;
    }
    return 'neutral';
}

/**
 * 色系和谐度评分矩阵
 * 同色系搭配得正分（协调），对比色搭配得轻微正分（视觉张力），
 * 中性色与任何色搭配都是正分（百搭）
 */
const FAMILY_HARMONY: Record<string, number> = {
    'warm-warm': 1.5,
    'cool-cool': 1.5,
    'neutral-neutral': 0.8,
    'accent-accent': -0.5,
    'warm-cool': 0.6,
    'warm-neutral': 1.2,
    'cool-neutral': 1.2,
    'warm-accent': 0.4,
    'cool-accent': 0.4,
    'neutral-accent': 1.0
};

function getHarmonyScore(familyA: ColorFamily, familyB: ColorFamily): number {
    const key1 = `${familyA}-${familyB}`;
    const key2 = `${familyB}-${familyA}`;
    return FAMILY_HARMONY[key1] ?? FAMILY_HARMONY[key2] ?? 0;
}

/**
 * 加载审美配色知识并构建色系映射
 */
async function loadColorHarmonyContext(): Promise<{ loaded: boolean; colorKnowledge: any[] }> {
    try {
        const result = await window.designEcho?.invoke?.('aesthetic:getColorKnowledge');
        if (result?.success && Array.isArray(result.knowledge)) {
            return { loaded: true, colorKnowledge: result.knowledge };
        }
    } catch (e) {
        console.warn('[SKU-Batch] 配色知识加载失败，使用内置色系规则:', e);
    }
    return { loaded: false, colorKnowledge: [] };
}

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
    source: 'project-folder' | 'local-library' | 'knowledge-library';
    sourcePriority: number;
};

const TEMPLATE_FILE_PATTERN = /\.(psd|psb|tif|tiff)$/i;
const NOTE_TEMPLATE_KEYWORD = '自选备注';

function normalizeNameWithoutExt(input: string): string {
    return String(input || '').replace(/\.[^.]+$/, '').toLowerCase();
}

function extractComboSize(input: string): number | null {
    const match = String(input || '').match(/(\d+)双/);
    if (!match) return null;
    const value = parseInt(match[1], 10);
    return Number.isFinite(value) ? value : null;
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
        source: item.source === 'knowledge-library' ? 'knowledge-library' : 'local-library',
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

/**
 * 生成指定大小的颜色组合（含色彩和谐度评分）
 * @param colorFamilies 每个颜色对应的色系（与 colors 等长），用于和谐度评分
 */
function generateCombinationsOfSize(
    colors: string[], size: number, count: number,
    colorFamilies?: ColorFamily[],
    brandPreferredColors?: string[]
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
    const contrastPairs = buildContrastPairs();

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

        // 色彩和谐度评分：基于色系搭配计算
        let harmonyBonus = 0;
        if (colorFamilies && colorFamilies.length === totalColors) {
            const activeIdxs = counts.map((c, i) => (c > 0 ? i : -1)).filter(i => i >= 0);
            if (activeIdxs.length >= 2) {
                let pairCount = 0;
                let totalHarmony = 0;
                for (let p = 0; p < activeIdxs.length; p++) {
                    for (let q = p + 1; q < activeIdxs.length; q++) {
                        totalHarmony += getHarmonyScore(
                            colorFamilies[activeIdxs[p]],
                            colorFamilies[activeIdxs[q]]
                        );
                        pairCount++;
                    }
                }
                harmonyBonus = pairCount > 0 ? (totalHarmony / pairCount) * 1.5 : 0;
            }
        }

        let brandBonus = 0;
        if (brandPreferredColors && brandPreferredColors.length > 0) {
            const preferred = brandPreferredColors
                .map((c: string) => String(c || '').trim().toLowerCase())
                .filter(Boolean);
            if (preferred.length > 0) {
                let matchedDistinct = 0;
                let matchedWeighted = 0;
                for (let i = 0; i < totalColors; i++) {
                    if (counts[i] <= 0) continue;
                    const colorName = String(colors[i] || '').toLowerCase();
                    const hit = preferred.some((p: string) => colorName.includes(p) || p.includes(colorName));
                    if (hit) {
                        matchedDistinct += 1;
                        matchedWeighted += counts[i];
                    }
                }
                brandBonus = matchedDistinct * 0.8 + matchedWeighted * 0.35;
                if (distinct > 0 && matchedDistinct === 0) brandBonus -= 0.6;
            }
        }

        return balanceScore + missingBonus + contrastBonus + patternBonus + harmonyBonus + brandBonus;
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
        callbacks?.onMessage?.('📋 正在分析项目结构...');

        // 并行加载配色知识、项目上下文、模板候选
        const [harmonyCtx, projectContext, skuTemplateCandidates, localLibrarySpecs] = await Promise.all([
            loadColorHarmonyContext(),
            getProjectContext(),
            loadSkuTemplateLibrary(),
            loadLocalLibrarySpecs()
        ]);
        const localSkuTemplates = skuTemplateCandidates.filter(item => item.source === 'local-library');
        if (harmonyCtx.loaded) {
            callbacks?.onMessage?.(`🎨 已加载配色知识 (${harmonyCtx.colorKnowledge.length} 条)`);
        }
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
        if (projectSkuTemplates.length > 0) {
            callbacks?.onMessage?.(`📁 项目模板目录识别到 ${projectSkuTemplates.length} 个模板文件`);
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
        
        // 1. 获取文档列表
        callbacks?.onToolStart?.('listDocuments');
        let docsResult = await executeToolCall('listDocuments', {});
        callbacks?.onToolComplete?.('listDocuments', docsResult);

        const refreshDocuments = async () => {
            docsResult = await executeToolCall('listDocuments', {});
            return docsResult;
        };

        const matchLibraryOpenedDoc = (template: TemplateLibraryItem, size: number, noteMode: boolean): any | null => {
            const docs = docsResult?.documents || [];
            const fileName = normalizeNameWithoutExt(template.filePath.split(/[/\\]/).pop() || '');
            const displayName = normalizeNameWithoutExt(template.name || '');

            return docs.find((d: any) => {
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
        
        // 2. 查找 SKU 文件
        let skuDoc = docsResult?.documents?.find((d: any) => 
            d.name.toLowerCase().includes(skuKeyword.toLowerCase())
        );
        
        // 如果没有 SKU 文件打开，尝试从项目目录查找并打开
        if (!skuDoc) {
            callbacks?.onMessage?.(`📂 未找到已打开的「${skuKeyword}」文件，正在从项目目录查找...`);
            
            if (projectContext?.projectPath) {
                await window.designEcho?.setProjectRoot?.(projectContext.projectPath);
                
                callbacks?.onToolStart?.('searchProjectResources');
                const searchResult = await safeToolCall('searchProjectResources', { 
                    query: skuKeyword, 
                    type: 'design',
                    directory: projectContext.projectPath
                }, 12000, 'search-sku-source-file');
                callbacks?.onToolComplete?.('searchProjectResources', searchResult);
                
                console.log('[SKU-Batch] 搜索结果:', searchResult);
                
                const skuFiles = searchResult?.results?.filter((f: any) => 
                    f.name.toLowerCase().includes(skuKeyword.toLowerCase()) && 
                    /\.(psd|psb)$/i.test(f.name)
                ) || [];
                
                if (skuFiles.length > 0) {
                    callbacks?.onMessage?.(`📂 找到文件: ${skuFiles[0].name}，正在打开...`);
                    callbacks?.onToolStart?.('openProjectFile');
                    const openResult = await safeToolCall('openProjectFile', { 
                        query: skuKeyword 
                    }, 20000, 'open-sku-source-file');
                    callbacks?.onToolComplete?.('openProjectFile', openResult);
                    
                    if (openResult?.success) {
                        await sleep(1000);
                        await refreshDocuments();
                        skuDoc = docsResult?.documents?.find((d: any) => 
                            d.name.toLowerCase().includes(skuKeyword.toLowerCase())
                        );
                    }
                }
                
                // 查找模板
                if (templateKeyword) {
                    const hasTemplate = docsResult?.documents?.some((d: any) => 
                        d.name.toLowerCase().includes(templateKeyword.toLowerCase())
                    );
                    
                    if (!hasTemplate) {
                        callbacks?.onMessage?.(`📂 正在查找「${templateKeyword}」模板...`);
                        const templateResult = await safeToolCall('openProjectFile', {
                            query: templateKeyword,
                            type: 'all'
                        }, 20000, 'open-template-by-keyword');
                        
                        if (templateResult?.success) {
                            await sleep(1000);
                            await refreshDocuments();
                        } else if (localSkuTemplates.length > 0) {
                            const keywordCandidate = localSkuTemplates.find((template) => {
                                const name = normalizeNameWithoutExt(template.name || template.filePath);
                                return name.includes(templateKeyword.toLowerCase()) && !name.includes(NOTE_TEMPLATE_KEYWORD);
                            });
                            if (keywordCandidate) {
                                callbacks?.onMessage?.(`📚 项目目录未命中，尝试打开本地模板库：${keywordCandidate.name}`);
                                try {
                                    await window.designEcho?.openPath?.(keywordCandidate.filePath);
                                    await sleep(900);
                                    await refreshDocuments();
                                } catch (error) {
                                    console.warn('[SKU-Batch] 本地模板库关键字打开失败:', error);
                                }
                            }
                        }
                    }
                }
            }
            
            if (!skuDoc) {
                return {
                    success: false,
                    message: `📂 **未找到「${skuKeyword}」素材文件**\n\n请确保：\n1. 项目目录中包含 SKU 素材文件\n2. 或者在 Photoshop 中打开该文件\n\n**当前打开的文档：**\n` + 
                        (docsResult?.documents?.map((d: any) => `- ${d.name}`).join('\n') || '无'),
                    error: 'SKU document not found'
                };
            }
        }
        
        // 3. 切换到 SKU 文件
        if (skuDoc) {
            callbacks?.onToolStart?.('switchDocument');
            await executeToolCall('switchDocument', { documentName: skuDoc.name });
            callbacks?.onToolComplete?.('switchDocument', { success: true });
        }
        
        // 4. 获取 SKU 文件的图层组（颜色）
        callbacks?.onToolStart?.('skuLayout');
        const layersResult = await executeToolCall('skuLayout', { action: 'listLayerSets' });
        callbacks?.onToolComplete?.('skuLayout', layersResult);
        
        if (!layersResult?.success || !layersResult?.data?.layerSets) {
            return {
                success: false,
                message: '⚠️ **无法读取图层组**\n\n请确保 SKU 素材 PSD 已打开且包含颜色图层组。',
                error: layersResult?.error || 'Failed to read layers'
            };
        }
        
        const allLayerNames = layersResult.data.layerSets.map((s: any) => s.name);
        
        // 过滤非颜色图层
        const defaultExcludes = ['详情', '模板', '背景', '参考', 'background', 'ref'];
        const excludeList = excludeColors.length > 0 ? excludeColors : defaultExcludes;
        
        const validColors = allLayerNames.filter((c: string) => 
            !excludeList.some(ex => c.toLowerCase().includes(ex.toLowerCase()))
        );
        
        console.log('[SKU-Batch] 图层组分析:', {
            all: allLayerNames,
            excludeList,
            validColors
        });
        
        const skuDocName = skuDoc?.name || '当前文档';
        
        if (validColors.length === 0) {
        return {
            success: false,
                message: `⚠️ **未找到颜色图层组**\n\n在「${skuDocName}」中发现的图层组：${allLayerNames.join('、')}\n\n请确保 SKU 素材 PSD 中的图层组以颜色命名。`,
                error: 'No valid color layer groups'
            };
        }
        
        // 5. 解析参数与自动推断规格
        let comboSizes = (params.comboSizes as number[]) || [];
        const countPerSize = Math.max(1, Number((params.countPerSize as number) || 5));
        const specifiedColors = params.specifiedColors as string[][] | undefined;
        const disableNotesByIntent = /不需要自选备注|不要自选备注|仅组合|只要组合|不生成备注/.test(String(_context?.userInput || ''));
        const generateNotes = (params.generateNotes as boolean | undefined) ?? !disableNotesByIntent;
        const onlyNotes = params.onlyNotes as boolean || false;
        
        // 如果未指定规格，尝试自动发现
        if (comboSizes.length === 0 && !params.comboSize) {
            callbacks?.onMessage?.('🔍 正在扫描项目模板与本地模板库以自动推断规格...');
            const foundSpecs = new Set<number>();
            
            // 1. 从当前打开的文档中推断
            docsResult?.documents?.forEach((d: any) => {
                const match = d.name.match(/(\d+)双/);
                if (match) foundSpecs.add(parseInt(match[1], 10));
            });
            
            // 2. 从项目模板目录推断（本地文件系统直扫，避免检索漏检）
            const projectSpecs = collectSizesFromLibrary(projectSkuTemplates);
            for (const size of projectSpecs) {
                foundSpecs.add(size);
            }
            if (projectSpecs.length > 0) {
                callbacks?.onMessage?.(`📁 项目模板目录识别到规格: ${projectSpecs.join(' / ')}双`);
            }

            // 3. 搜索索引结果作为补充
            if (projectContext?.projectPath) {
                const templateSearchResult = await safeToolCall('searchProjectResources', {
                    query: '双',
                    type: 'all',
                    directory: templateDir || projectContext.projectPath,
                    limit: 60
                }, 12000, 'scan-template-specs');

                if (templateSearchResult?.success && Array.isArray(templateSearchResult.results)) {
                    templateSearchResult.results.forEach((f: any) => {
                        const match = f.name.match(/(\d+)双/);
                        if (match && !f.name.toLowerCase().includes(skuKeyword.toLowerCase())) {
                            foundSpecs.add(parseInt(match[1], 10));
                        }
                    });
                } else if (templateSearchResult?.timeout) {
                    callbacks?.onMessage?.('⚠️ 模板目录索引扫描超时，先按已识别规格执行。');
                } else if (templateSearchResult?.error) {
                    callbacks?.onMessage?.(`⚠️ 模板目录索引扫描失败：${templateSearchResult.error}`);
                }
            }

            // 4. 从本地模板库推断
            const librarySpecs = localLibrarySpecs.length > 0
                ? localLibrarySpecs
                : collectSizesFromLibrary(localSkuTemplates);
            for (const size of librarySpecs) {
                foundSpecs.add(size);
            }
            if (librarySpecs.length > 0) {
                callbacks?.onMessage?.(`📚 本地模板库识别到规格: ${librarySpecs.join(' / ')}双`);
            }
            
            if (foundSpecs.size > 0) {
                comboSizes = Array.from(foundSpecs).sort((a, b) => a - b);
                callbacks?.onMessage?.(`✅ 自动发现可用规格: ${comboSizes.join(' / ')}双`);
            } else {
                comboSizes = [2]; // 默认降级
                callbacks?.onMessage?.(`⚠️ 未发现明确的规格模板，将默认尝试 2双规格${templateDir ? `（项目模板目录：${templateDir}）` : ''}`);
            }
        } else if (comboSizes.length === 0) {
            comboSizes = [params.comboSize || 2];
        }

        console.log('[SKU-Batch] 参数解析:', { comboSizes, countPerSize, specifiedColors, generateNotes, onlyNotes });
        
        if (onlyNotes) {
            callbacks?.onMessage?.(`📊 模式: 只生成自选备注, 规格=${comboSizes.join('/')}双`);
        } else {
            callbacks?.onMessage?.(`📊 解析参数: 规格=${comboSizes.join('/')}双, 每规格${countPerSize}个组合`);
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
                        return {
                            success: false,
                            message: `⚠️ SKU 批量生成失败\n\n未找到可用模板文件。\n请在「${templateDir}」中准备如「2双装 / 3双装 / 4双装」模板，或先在 Photoshop 打开对应模板后再执行。`,
                            error: probeError || 'Template files not found'
                        };
                    }
                    callbacks?.onMessage?.('📚 项目模板目录未命中，将切换到本地模板库继续执行。');
                }
            } else if (openedTemplateCount === 0 && !hasLibraryTemplate) {
                return {
                    success: false,
                    message: '⚠️ SKU 批量生成失败\n\n未找到可用模板。\n请先打开模板文件，或在模板知识库中配置本地模板库目录后重试。',
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
        } else if (specifiedColors && specifiedColors.length > 0) {
            for (const combo of specifiedColors) {
                const size = combo.length;
                if (!combosBySize[size]) combosBySize[size] = [];
                combosBySize[size].push(combo);
            }
        } else {
            // 加载品牌推荐色
            const brandSpec = await getEffectiveBrandSpec(projectContext?.projectPath);
            const brandRecommendedColors: string[] = [];
            if (brandSpec && brandSpec.id !== 'default') {
                callbacks?.onMessage?.(`🎨 品牌规范: ${brandSpec.name}`);
                const bKeywords = (brandSpec as any).keywords as string[] | undefined;
                if (bKeywords && bKeywords.length > 0) {
                    brandRecommendedColors.push(...bKeywords);
                    callbacks?.onMessage?.(`🎯 品牌优先色: ${bKeywords.slice(0, 6).join('、')}`);
                }
            }

            // 为每个颜色推断色系，用于和谐度评分
            const families: ColorFamily[] = validColors.map((c: string) => inferColorFamily(c));
            console.log('[SKU-Batch] 颜色色系映射:', validColors.map((c: string, i: number) => `${c}→${families[i]}`).join(', '));
            callbacks?.onMessage?.(`🎨 色系分析: ${validColors.map((c: string, i: number) => `${c}(${families[i]})`).join(', ')}`);

            for (const size of comboSizes) {
                const sizeCombos = generateCombinationsOfSize(validColors, size, countPerSize, families, brandRecommendedColors);
                if (sizeCombos.length < countPerSize) {
                    callbacks?.onMessage?.(`⚠️ ${size}双：请求 ${countPerSize} 个组合，但按“不重复（无序）”原则最多生成 ${sizeCombos.length} 个`);
                }
                combosBySize[size] = sizeCombos;
            }
        }
        
        // 7. 按规格循环处理
        const allFinalFiles: string[] = [];
        const allCopyErrors: string[] = [];
        const allToolResults: any[] = [
            { toolName: 'listDocuments', result: docsResult },
            { toolName: 'skuLayout-listLayerSets', result: layersResult }
        ];
        const processedSizes: string[] = [];
        
        for (const [sizeStr, combos] of Object.entries(combosBySize)) {
            const size = parseInt(sizeStr, 10);
            
            if (signal?.aborted) {
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
                
                docsResult = await executeToolCall('listDocuments', {});
                
                if (templateKeyword && !templateKeyword.toLowerCase().includes(excludeNoteKeyword)) {
                    templateDoc = docsResult?.documents?.find((d: any) => {
                        const name = d.name.toLowerCase();
                        return name.includes(templateKeyword.toLowerCase()) && name.includes(sizeKeyword) && !name.includes(excludeNoteKeyword);
                    });
                }
                
                if (!templateDoc) {
                    templateDoc = docsResult?.documents?.find((d: any) => {
                        const name = d.name.toLowerCase();
                        return !name.includes(excludeNoteKeyword) && (d.name.includes(`${size}双装`) || d.name.includes(`${size}双模板`));
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
                    if (!openResult?.success) {
                        callbacks?.onMessage?.(`⚠️ 未找到「${sizeKeyword}」模板，尝试搜索通用模板...`);
                        openResult = await safeToolCall('openProjectFile', {
                            query: '模板',
                            type: 'all',
                            directory: templateDir
                        }, 20000, `open-${sizeKeyword}-template-fallback`);
                    }
                    
                    if (openResult?.success) {
                        await sleep(1000);
                        await refreshDocuments();
                        
                        // 优先查找匹配规格的组合模板（排除自选备注）
                        templateDoc = docsResult?.documents?.find((d: any) => {
                            const name = d.name.toLowerCase();
                            return name.includes(sizeKeyword) && !name.includes(excludeNoteKeyword) &&
                                (d.name.includes(`${size}双装`) || d.name.includes(`${size}双模板`));
                        });
                        if (!templateDoc) {
                            templateDoc = docsResult?.documents?.find((d: any) => {
                                const name = d.name.toLowerCase();
                                return name.includes(sizeKeyword) && !name.includes(excludeNoteKeyword);
                            });
                        }
                        
                        // 如果没找到精确匹配，尝试使用任何非 SKU 素材、非自选备注的"模板"文件
                        if (!templateDoc) {
                            templateDoc = docsResult?.documents?.find((d: any) => {
                                const name = d.name.toLowerCase();
                                return name.includes('模板') && !name.includes(skuKeyword.toLowerCase()) && !name.includes(excludeNoteKeyword);
                            });
                            if (templateDoc) {
                                callbacks?.onMessage?.(`🤔 使用通用模板: ${templateDoc.name}`);
                            }
                        }
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
                    continue;
                }
                
                await executeToolCall('switchDocument', { documentName: templateDoc.name });
            }
            
            // 执行 SKU 排版（非 onlyNotes 模式）
            if (!onlyNotes) {
                callbacks?.onMessage?.(`🔧 正在执行 ${size}双 排版...`);
                
                const executeResult = await executeToolCall('skuLayout', {
                    action: 'execute',
                    combos: combos,
                    outputFormat: 'jpg',
                    quality: 12,
                    outputDir: outputDir
                });
                
                allToolResults.push({ toolName: `skuLayout-${size}双`, result: executeResult });
                
                if (executeResult?.success) {
                    const exportedFiles = executeResult.data?.exportedFiles || [];
                    
                    for (const fileInfo of exportedFiles) {
                        try {
                            const info = JSON.parse(fileInfo);
                            if (info.status === 'exported_to_temp' && info.tempPath) {
                                const correctTargetDir = outputDir || info.targetDir;
                                const targetPath = `${correctTargetDir}\\${size}双装\\${info.targetName}`;
                                
                                const copyFn = (window as any).designEcho?.copyFile;
                                if (copyFn) {
                                    const copyResult = await copyFn(info.tempPath, targetPath);
                                    if (copyResult?.success) {
                                        allFinalFiles.push(`${size}双装/${info.targetName}`);
                                        try {
                                            await (window as any).designEcho?.invoke?.('fs:deleteFile', info.tempPath);
                                        } catch (e) { /* 忽略 */ }
                                    } else {
                                        allCopyErrors.push(`${info.targetName}: ${copyResult?.error || '复制失败'}`);
                                    }
                                }
                            } else if (!info.status) {
                                allFinalFiles.push(fileInfo);
                            }
                        } catch (e) {
                            const fileName = fileInfo.split('\\').pop() || fileInfo.split('/').pop() || fileInfo;
                            allFinalFiles.push(fileName);
                        }
                    }
                    
                    processedSizes.push(`${size}双 (${combos.length}个)`);
                } else {
                    allCopyErrors.push(`${size}双排版失败: ${executeResult?.error || '未知错误'}`);
                }
            }
            
            // 生成自选备注
            if (generateNotes || onlyNotes) {
                callbacks?.onMessage?.(`📝 正在生成 ${size}双 自选备注...`);
                
                await refreshDocuments();
                let noteTemplateDoc = docsResult?.documents?.find((d: any) => {
                    const name = d.name.toLowerCase();
                    return name.includes(`${size}双`) && name.includes('自选备注');
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
                    noteTemplateDoc = docsResult?.documents?.find((d: any) => {
                        const name = d.name.toLowerCase();
                        return name.includes(`${size}双`) && name.includes('自选备注');
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
                    
                    const noteResult = await executeToolCall('skuLayout', {
                        action: 'arrangeDynamic',
                        combos: [validColors],
                        outputFormat: 'jpg',
                        quality: 12,
                        outputDir: outputDir,
                        noteFilePrefix: `${size}双自选备注`
                    });
                    
                    if (noteResult?.success) {
                        const noteFiles = noteResult.data?.exportedFiles || [];
                        
                        for (const fileInfo of noteFiles) {
                            try {
                                const info = JSON.parse(fileInfo);
                                if (info.status === 'exported_to_temp' && info.tempPath) {
                                    const correctTargetDir = outputDir || info.targetDir;
                                    const targetPath = `${correctTargetDir}\\${size}双自选备注\\${info.targetName}`;
                                    
                                    const copyFn = (window as any).designEcho?.copyFile;
                                    if (copyFn) {
                                        const copyResult = await copyFn(info.tempPath, targetPath);
                                        if (copyResult?.success) {
                                            allFinalFiles.push(`${size}双自选备注/${info.targetName}`);
                                            try {
                                                await (window as any).designEcho?.invoke?.('fs:deleteFile', info.tempPath);
                                            } catch (e) { /* 忽略 */ }
                                        } else {
                                            allCopyErrors.push(`${size}双自选备注: 复制失败`);
                                        }
                                    }
                                } else if (!info.status) {
                                    allFinalFiles.push(fileInfo);
                                }
                            } catch (e) {
                                allFinalFiles.push(`${size}双自选备注`);
                            }
                        }
                        
                        if (onlyNotes && !processedSizes.includes(`${size}双 (自选备注)`)) {
                            processedSizes.push(`${size}双 (自选备注)`);
                        }
                    } else {
                        allCopyErrors.push(`${size}双自选备注: 生成失败`);
                    }
                } else {
                    allCopyErrors.push(`${size}双自选备注: 未找到模板`);
                }
            }
        }
        
        // 8. 汇总结果
        const totalCombos = Object.values(combosBySize).reduce((sum, arr) => sum + arr.length, 0);
        const noteCount = generateNotes ? comboSizes.length : 0;
        
        const comboSummary = Object.entries(combosBySize)
            .map(([size, combos]) => {
                const comboList = combos.map((c, i) => `${i + 1}.${c.join('+')}`).join('、');
                let summary = `**${size}双装** (${combos.length}个)\n${comboList}`;
                if (generateNotes) {
                    summary += `\n+ 自选备注`;
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
        const noteInfo = generateNotes ? ` + ${noteCount}备注` : '';
        const templateRelatedFailure = allCopyErrors.some(e => e.includes('模板'));
        const templateHint = templateRelatedFailure
            ? `\n\n**排查建议**\n1. 在「${templateDir || '模板目录'}」下放入如「2双装/3双装/4双装」模板文件\n2. 或先在 Photoshop 打开对应规格模板后再执行\n3. 或在模板知识库中配置「本地模板库目录」（支持 PSD/PSB/TIF）`
            : '';
        
        const successMessage = processedSizes.length > 0
            ? `**素材**: ${skuDocName}\n**规格**: ${processedSizes.join(' / ')}\n**数量**: ${totalCombos}组合${noteInfo}\n\n${comboSummary}${exportSummary}${errorSummary}`
            : `⚠️ SKU 批量生成失败\n\n未能处理任何规格。${errorSummary}${templateHint}`;
        
        return {
            success: processedSizes.length > 0,
            message: successMessage,
            toolResults: allToolResults,
            data: {
                totalCombos,
                totalGenerated,
                processedSizes,
                exportCount: allFinalFiles.length,
                warningCount: allCopyErrors.length
            }
        };
    }
};
