import type { SkillExecutor, SkillExecuteParams } from './types';
import type { AgentResult } from '../unified-agent.service';
import { executeToolCall } from '../tool-executor.service';

type EditAction =
    | 'locate'
    | 'select'
    | 'setText'
    | 'move'
    | 'scale'
    | 'setOpacity'
    | 'setBlendMode'
    | 'replaceImage';

interface CanvasElement {
    id: number;
    name: string;
    type: string;
    visible: boolean;
    position?: string;
    parentGroup?: string;
    textContent?: string;
}

interface RankedCandidate {
    element: CanvasElement;
    score: number;
    reason: string[];
}

const DEFAULT_MIN_SCORE = 35;
const DEFAULT_MIN_MARGIN = 8;

function tokenize(input: string): string[] {
    const tokens = (input || '').toLowerCase().match(/[a-z0-9]+|[\u4e00-\u9fa5]{1,}/g) || [];
    return Array.from(new Set(tokens.filter(Boolean)));
}

function containsAny(text: string, keywords: string[]): boolean {
    const lower = text.toLowerCase();
    return keywords.some(k => lower.includes(k));
}

function scoreCandidate(
    element: CanvasElement,
    action: EditAction,
    targetTokens: string[]
): RankedCandidate {
    let score = 0;
    const reason: string[] = [];
    const searchText = `${element.name || ''} ${element.parentGroup || ''} ${element.position || ''} ${element.textContent || ''}`.toLowerCase();

    let tokenHit = 0;
    for (const token of targetTokens) {
        if (searchText.includes(token)) tokenHit++;
    }
    if (targetTokens.length > 0) {
        const tokenScore = (tokenHit / targetTokens.length) * 45;
        score += tokenScore;
        if (tokenHit > 0) reason.push(`关键词命中 ${tokenHit}/${targetTokens.length}`);
    }

    const type = (element.type || '').toLowerCase();
    const isTextLike = type.includes('text');
    const isImageLike = type.includes('pixel') || type.includes('smart');
    const isShapeLike = type.includes('shape') || type.includes('vector');
    const nameText = (element.name || '').toLowerCase();

    if ((action === 'setText') && isTextLike) {
        score += 30;
        reason.push('文本图层匹配');
    }
    if ((action === 'replaceImage') && isImageLike) {
        score += 30;
        reason.push('图片图层匹配');
    }
    if ((action === 'setOpacity' || action === 'setBlendMode' || action === 'move' || action === 'scale') && (isImageLike || isShapeLike || isTextLike)) {
        score += 10;
    }

    if (containsAny(nameText, ['icon', '图标']) && containsAny(targetTokens.join(' '), ['icon', '图标'])) {
        score += 18;
        reason.push('图标语义匹配');
    }
    if (containsAny(nameText, ['文案', '标题', 'title', 'text']) && (action === 'setText' || containsAny(targetTokens.join(' '), ['文案', '标题', 'text']))) {
        score += 15;
        reason.push('文案语义匹配');
    }
    if (containsAny(nameText, ['图片', '主图', 'image', 'photo']) && (action === 'replaceImage' || containsAny(targetTokens.join(' '), ['图片', '主图', 'image', 'photo']))) {
        score += 15;
        reason.push('图片语义匹配');
    }

    if (element.visible) {
        score += 5;
    }

    return { element, score: Math.round(score * 10) / 10, reason };
}

function normalizeAction(raw: unknown): EditAction {
    const value = String(raw || 'locate').trim();
    const lower = value.toLowerCase();
    if (lower === 'select') return 'select';
    if (lower === 'settext') return 'setText';
    if (lower === 'move') return 'move';
    if (lower === 'scale') return 'scale';
    if (lower === 'setopacity') return 'setOpacity';
    if (lower === 'setblendmode') return 'setBlendMode';
    if (lower === 'replaceimage') return 'replaceImage';
    return 'locate';
}

function topN(candidates: RankedCandidate[], n: number): RankedCandidate[] {
    return candidates.sort((a, b) => b.score - a.score).slice(0, Math.max(1, n));
}

async function runEditAction(action: EditAction, layerId: number, params: Record<string, any>): Promise<any> {
    switch (action) {
        case 'locate':
        case 'select':
            return executeToolCall('selectLayer', { layerId });
        case 'setText': {
            const content = String(params.text ?? params.content ?? '').trim();
            if (!content) {
                return { success: false, error: '缺少 text/content 参数' };
            }
            return executeToolCall('setTextContent', {
                updates: [{ layerId, content }]
            });
        }
        case 'move': {
            const hasDelta = Number.isFinite(Number(params.dx)) || Number.isFinite(Number(params.dy));
            if (hasDelta) {
                return executeToolCall('moveLayer', {
                    layerId,
                    x: Number(params.dx) || 0,
                    y: Number(params.dy) || 0,
                    relative: true
                });
            }
            if (!Number.isFinite(Number(params.x)) || !Number.isFinite(Number(params.y))) {
                return { success: false, error: 'move 缺少坐标参数（x/y 或 dx/dy）' };
            }
            return executeToolCall('moveLayer', {
                layerId,
                x: Number(params.x),
                y: Number(params.y),
                relative: false
            });
        }
        case 'scale': {
            const percent = Number(params.scalePercent ?? params.percent);
            if (!Number.isFinite(percent)) {
                return { success: false, error: 'scale 缺少 scalePercent/percent 参数' };
            }
            return executeToolCall('transformLayer', { layerId, scaleUniform: percent });
        }
        case 'setOpacity': {
            const opacity = Number(params.opacity);
            if (!Number.isFinite(opacity)) {
                return { success: false, error: 'setOpacity 缺少 opacity 参数' };
            }
            return executeToolCall('setLayerOpacity', { layerId, opacity });
        }
        case 'setBlendMode': {
            const blendMode = String(params.blendMode || '').trim();
            if (!blendMode) {
                return { success: false, error: 'setBlendMode 缺少 blendMode 参数' };
            }
            return executeToolCall('setBlendMode', { layerId, blendMode });
        }
        case 'replaceImage': {
            const filePath = String(params.filePath || '').trim();
            if (!filePath) {
                return { success: false, error: 'replaceImage 缺少 filePath 参数' };
            }
            return executeToolCall('replaceLayerContent', { layerId, filePath });
        }
        default:
            return { success: false, error: `不支持的操作: ${action}` };
    }
}

export const findEditElementExecutor: SkillExecutor = {
    skillId: 'find-and-edit-element',

    async execute({ params, callbacks }: SkillExecuteParams): Promise<AgentResult> {
        const action = normalizeAction(params.action);
        const targetDescription = String(
            params.targetDescription || params.target || params.query || ''
        ).trim();

        if (!targetDescription && !Number.isFinite(Number(params.layerId))) {
            return {
                success: false,
                message: '❌ 缺少目标描述。请告诉我要改哪个元素，例如“右上角价格文案”。',
                error: 'Missing target description'
            };
        }

        callbacks?.onMessage?.('🎯 正在定位画布元素...');

        const docInfo = await executeToolCall('getDocumentInfo', {});
        if (!docInfo?.success) {
            return {
                success: false,
                message: '❌ 请先打开 Photoshop 文档。',
                error: 'No document open'
            };
        }

        const elementResult = await executeToolCall('getElementMapping', {
            includeHidden: true,
            includeGroups: true,
            sortBy: 'position'
        });
        const elements: CanvasElement[] = Array.isArray(elementResult?.elements)
            ? elementResult.elements
            : [];

        if (!elementResult?.success || elements.length === 0) {
            return {
                success: false,
                message: '❌ 没有找到可编辑图层。',
                error: elementResult?.error || 'No elements'
            };
        }

        const tokens = tokenize(targetDescription);
        const ranked = topN(elements.map(el => scoreCandidate(el, action, tokens)), 5);
        const top = ranked[0];
        const second = ranked[1];

        let selectedLayerId = Number.isFinite(Number(params.layerId)) ? Number(params.layerId) : top?.element?.id;
        const minScore = Number.isFinite(Number(params.minScore)) ? Number(params.minScore) : DEFAULT_MIN_SCORE;
        const minMargin = Number.isFinite(Number(params.minMargin)) ? Number(params.minMargin) : DEFAULT_MIN_MARGIN;
        const margin = top && second ? top.score - second.score : (top?.score || 0);
        const selectionMode = String(params.selectionMode || 'auto').toLowerCase();

        const needUserSelection =
            !Number.isFinite(Number(params.layerId)) &&
            (selectionMode === 'suggest' || (selectionMode !== 'force' && ((top?.score || 0) < minScore || margin < minMargin)));

        if (needUserSelection) {
            return {
                success: false,
                message: `⚠️ 找到候选图层，但我不想盲改。请确认要改哪一个。`,
                data: {
                    selectionRequired: true,
                    action,
                    targetDescription,
                    threshold: { minScore, minMargin },
                    candidates: ranked.map((c, idx) => ({
                        rank: idx + 1,
                        layerId: c.element.id,
                        layerName: c.element.name,
                        layerType: c.element.type,
                        parentGroup: c.element.parentGroup,
                        position: c.element.position,
                        score: c.score,
                        reason: c.reason.join('；')
                    }))
                }
            };
        }

        if (!selectedLayerId) {
            return {
                success: false,
                message: '❌ 没有找到可用图层。',
                error: 'No selected layer id'
            };
        }

        const selectResult = await executeToolCall('selectLayer', { layerId: selectedLayerId });
        if (selectResult?.success === false) {
            return {
                success: false,
                message: `❌ 选中图层失败: ${selectResult.error || '未知错误'}`,
                error: selectResult.error || 'Select layer failed'
            };
        }

        const actionResult = await runEditAction(action, selectedLayerId, params);
        if (actionResult?.success === false) {
            return {
                success: false,
                message: `❌ 执行失败: ${actionResult.error || '未知错误'}`,
                error: actionResult.error || 'Action failed',
                data: {
                    selectedLayerId,
                    selectedLayerName: top?.element?.name
                }
            };
        }

        const selected = ranked.find(c => c.element.id === selectedLayerId)?.element || top?.element;
        const successLine = action === 'locate' || action === 'select'
            ? '已定位并选中目标图层。'
            : '已完成元素修改。';

        return {
            success: true,
            message: `✅ ${successLine}\n\n图层：${selected?.name || selectedLayerId} (ID: ${selectedLayerId})`,
            toolResults: [
                { toolName: 'selectLayer', result: selectResult },
                { toolName: action, result: actionResult }
            ],
            data: {
                action,
                targetDescription,
                selectedLayerId,
                selectedLayerName: selected?.name,
                score: ranked.find(c => c.element.id === selectedLayerId)?.score,
                topCandidates: ranked.map((c, idx) => ({
                    rank: idx + 1,
                    layerId: c.element.id,
                    layerName: c.element.name,
                    layerType: c.element.type,
                    score: c.score
                }))
            }
        };
    }
};

