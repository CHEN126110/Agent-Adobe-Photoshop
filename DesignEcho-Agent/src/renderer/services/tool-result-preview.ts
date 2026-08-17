/**
 * 工具结果预览：把过程面板里"已查看/已读取"的工具结果整理成用户可展开查看的有界内容。
 *
 * 纪律：
 * - 有界——每节 ≤10 行、每行 ≤160 字、全文 ≤24 行，长列表给"…共 N 个"而不是全量倒出；
 * - 消毒——全部文本过 sanitizeUserVisibleDiagnosticText（去内部状态码/路径式诊断）；
 * - 只读——不改动工具结果，没有可展示内容时返回 undefined（UI 不渲染展开入口）。
 */

import { sanitizeUserVisibleDiagnosticText } from '../../shared/chat-response-cleaner';

export interface ToolResultPreviewSection {
    title?: string;
    lines: string[];
}

export interface ToolResultPreview {
    /** 一行摘要，紧跟步骤标题展示（可选）。 */
    summary?: string;
    sections: ToolResultPreviewSection[];
}

const MAX_SECTIONS = 3;
const MAX_LINES_PER_SECTION = 10;
const MAX_TOTAL_LINES = 24;
const MAX_LINE_LENGTH = 160;

function clean(value: unknown, limit = MAX_LINE_LENGTH): string {
    return sanitizeUserVisibleDiagnosticText(String(value ?? ''))
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, limit);
}

function baseName(value: unknown): string {
    const text = String(value ?? '').trim();
    if (!text) return '';
    return text.split(/[/\\]/).filter(Boolean).pop() || text;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}

function pickArray(record: Record<string, unknown> | undefined, keys: string[]): unknown[] {
    if (!record) return [];
    for (const key of keys) {
        const value = record[key];
        if (Array.isArray(value) && value.length > 0) return value;
    }
    return [];
}

function itemLabel(item: unknown): string {
    if (typeof item === 'string') return baseName(item);
    const record = asRecord(item);
    if (!record) return '';
    const candidate = record.name ?? record.fileName ?? record.title ?? record.relativePath ?? record.path ?? record.label;
    return typeof candidate === 'string' ? baseName(candidate) : '';
}

function listSection(title: string, items: unknown[], total?: number): ToolResultPreviewSection | undefined {
    const labels = items.map(itemLabel).filter(Boolean);
    if (labels.length === 0) return undefined;
    const shown = labels.slice(0, MAX_LINES_PER_SECTION - 1);
    const lines = [...shown];
    const totalCount = typeof total === 'number' && Number.isFinite(total) ? total : labels.length;
    if (totalCount > shown.length) lines.push(`…共 ${totalCount} 个`);
    return { title, lines };
}

function primitiveFieldsSection(
    record: Record<string, unknown>,
    fields: Array<{ key: string; label: string }>
): ToolResultPreviewSection | undefined {
    const lines: string[] = [];
    for (const field of fields) {
        const value = record[field.key];
        if (value === undefined || value === null || typeof value === 'object') continue;
        const text = typeof value === 'boolean' ? (value ? '是' : '否') : clean(value, 80);
        if (text) lines.push(`${field.label}：${text}`);
        if (lines.length >= MAX_LINES_PER_SECTION) break;
    }
    return lines.length > 0 ? { lines } : undefined;
}

function textListSection(title: string, values: unknown[], limit = 6): ToolResultPreviewSection | undefined {
    const lines = values
        .map((value) => clean(value, 120))
        .filter(Boolean)
        .slice(0, limit);
    return lines.length > 0 ? { title, lines } : undefined;
}

function buildFileListPreview(data: Record<string, unknown>, result: unknown): ToolResultPreview | undefined {
    const items = pickArray(data, ['resources', 'files', 'results', 'items', 'matches']);
    const fallbackItems = Array.isArray(result) ? result : [];
    const total = typeof data.totalFiles === 'number'
        ? data.totalFiles
        : typeof data.count === 'number'
            ? data.count
            : undefined;
    const section = listSection('文件', items.length > 0 ? items : fallbackItems, total);
    if (!section) return undefined;
    const summary = total !== undefined
        ? `共 ${total} 个文件`
        : `共 ${(items.length > 0 ? items : fallbackItems).length} 个文件`;
    return { summary, sections: [section] };
}

function buildObservationPreview(data: Record<string, unknown>): ToolResultPreview | undefined {
    const observation = asRecord(data.observation) || data;
    const sections: ToolResultPreviewSection[] = [];
    const summary = clean(observation.summary, 140);
    const strengths = pickArray(observation, ['strengths'])
        .map((item) => {
            const record = asRecord(item);
            return record ? clean(`${record.aspect ?? ''}：${record.observation ?? ''}`, 120) : '';
        })
        .filter(Boolean);
    const strengthsSection = textListSection('亮点', strengths, 4);
    if (strengthsSection) sections.push(strengthsSection);
    const heuristicsSection = textListSection(
        '可复用经验',
        pickArray(observation, ['reusableHeuristics']),
        4
    );
    if (heuristicsSection) sections.push(heuristicsSection);
    const scenariosSection = textListSection(
        '适用场景',
        pickArray(observation, ['suitableScenarios']),
        4
    );
    if (scenariosSection) sections.push(scenariosSection);
    if (!summary && sections.length === 0) return undefined;
    return { ...(summary ? { summary } : {}), sections: sections.slice(0, MAX_SECTIONS) };
}

function buildStatePreview(data: Record<string, unknown>): ToolResultPreview | undefined {
    const state = asRecord(data.state) || asRecord(data.designState) || asRecord(data.projectState) || data;
    const lines: string[] = [];
    const textFields: Array<{ key: string; label: string }> = [
        { key: 'goal', label: '目标' },
        { key: 'taskGoal', label: '目标' },
        { key: 'designGoal', label: '目标' },
        { key: 'layoutPlan', label: '版式方向' },
        { key: 'strategy', label: '策略' },
        { key: 'designDirection', label: '设计方向' },
        { key: 'styleDirection', label: '风格方向' },
        { key: 'copyDirection', label: '文案方向' },
        { key: 'currentFocus', label: '当前焦点' },
        { key: 'summary', label: '摘要' }
    ];
    for (const field of textFields) {
        const value = state[field.key];
        if (typeof value !== 'string' || !value.trim()) continue;
        lines.push(`${field.label}：${clean(value, 140)}`);
        if (lines.length >= MAX_LINES_PER_SECTION) break;
    }
    if (lines.length === 0) return undefined;
    return { summary: lines[0], sections: [{ title: '设计方向', lines }] };
}

function buildGenericPreview(toolName: string, result: unknown): ToolResultPreview | undefined {
    const data = asRecord(result);
    if (!data) {
        const text = clean(result, 140);
        return text ? { summary: text, sections: [] } : undefined;
    }
    if (typeof data.error === 'string' && data.error) {
        return { summary: clean(data.error, 140), sections: [] };
    }
    const target = asRecord(data.document) || asRecord(data.data) || data;
    const section = primitiveFieldsSection(target, [
        { key: 'name', label: '名称' },
        { key: 'documentName', label: '文档' },
        { key: 'width', label: '宽' },
        { key: 'height', label: '高' },
        { key: 'layerCount', label: '图层数' },
        { key: 'totalLayers', label: '图层数' },
        { key: 'activeLayerName', label: '当前图层' },
        { key: 'readiness', label: '就绪状态' },
        { key: 'workMode', label: '工作模式' },
        { key: 'stageGoal', label: '阶段目标' },
        { key: 'message', label: '消息' }
    ]);
    const digest = asRecord(data.briefDigest) || asRecord(data.strategyDigest) || asRecord(data.planDigest);
    const digestSection = digest
        ? primitiveFieldsSection(digest, [
            { key: 'readiness', label: '就绪状态' },
            { key: 'stageGoal', label: '阶段目标' },
            { key: 'goal', label: '目标' },
            { key: 'workMode', label: '工作模式' }
        ])
        : undefined;
    const layers = pickArray(target, ['layers']);
    const layersSection = layers.length > 0 && layers.every((item) => asRecord(item)?.name || typeof item === 'string')
        ? listSection('图层', layers, typeof target.totalLayers === 'number' ? target.totalLayers : undefined)
        : undefined;
    const sections = [digestSection, section, layersSection]
        .filter((item): item is ToolResultPreviewSection => Boolean(item))
        .slice(0, MAX_SECTIONS);
    if (sections.length === 0) return undefined;
    const firstLine = sections[0]?.lines[0];
    return { ...(firstLine ? { summary: firstLine } : {}), sections };
}

export function buildToolResultPreview(toolName: string, toolResult: unknown): ToolResultPreview | undefined {
    if (toolResult === null || toolResult === undefined) return undefined;
    let data: unknown = toolResult;
    if (typeof toolResult === 'string') {
        try {
            data = JSON.parse(toolResult);
        } catch {
            const text = clean(toolResult, 200);
            return text ? { summary: text, sections: [] } : undefined;
        }
    }
    const record = asRecord(data);
    let preview: ToolResultPreview | undefined;
    switch (toolName) {
        case 'listProjectResources':
        case 'searchProjectResources':
        case 'getResourcesByCategory':
            preview = record ? buildFileListPreview(record, data) : undefined;
            break;
        case 'getDesignProjectState':
            preview = record ? buildStatePreview(record) : undefined;
            break;
        case 'analyzeProjectContactSheetOverview':
        case 'analyzeEagleReference':
        case 'observeEagleAsset':
            preview = record ? buildObservationPreview(record) : undefined;
            break;
        case 'searchDesignKnowledge':
        case 'searchEagleReferences':
        case 'webSearch': {
            const results = pickArray(record, ['results', 'items', 'references', 'sources']);
            const section = listSection('结果', results);
            preview = section ? { sections: [section] } : buildGenericPreview(toolName, data);
            break;
        }
        default:
            preview = buildGenericPreview(toolName, data);
    }
    if (!preview) return undefined;
    const boundedSections = preview.sections
        .slice(0, MAX_SECTIONS)
        .map((section) => ({
            ...section,
            lines: section.lines.slice(0, MAX_LINES_PER_SECTION)
        }));
    const totalLines = boundedSections.reduce((sum, section) => sum + section.lines.length, 0);
    if (!preview.summary && totalLines === 0) return undefined;
    let remaining = MAX_TOTAL_LINES;
    const cappedSections = boundedSections.map((section) => {
        const lines = section.lines.slice(0, Math.max(0, remaining));
        remaining -= lines.length;
        return { ...section, lines };
    }).filter((section) => section.lines.length > 0);
    return {
        ...(preview.summary ? { summary: clean(preview.summary, 160) } : {}),
        sections: cappedSections
    };
}
