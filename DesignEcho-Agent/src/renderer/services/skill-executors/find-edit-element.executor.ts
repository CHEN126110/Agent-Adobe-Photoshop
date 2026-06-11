import type { SkillExecutor, SkillExecuteParams } from './types';
import type { AgentResult } from '../unified-agent.service';
import { executeToolCall } from '../tool-executor.service';
import { emitSkillStep, executeObservedSkillTool } from './skill-step-events';

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

async function runEditAction(action: EditAction, layerId: number, params: Record<string, any>, callbacks?: SkillExecuteParams['callbacks']): Promise<any> {
    switch (action) {
        case 'locate':
        case 'select':
            return executeObservedSkillTool(callbacks, 'selectLayer', { layerId }, executeToolCall, `目标图层 ID: ${layerId}`);
        case 'setText': {
            const content = String(params.text ?? params.content ?? '').trim();
            if (!content) {
                return { success: false, error: '缺少 text/content 参数' };
            }
            return executeObservedSkillTool(callbacks, 'setTextContent', {
                updates: [{ layerId, content }]
            }, executeToolCall, `目标图层 ID: ${layerId}；写入文本长度: ${content.length}`);
        }
        case 'move': {
            const hasDelta = Number.isFinite(Number(params.dx)) || Number.isFinite(Number(params.dy));
            if (hasDelta) {
                return executeObservedSkillTool(callbacks, 'moveLayer', {
                    layerId,
                    x: Number(params.dx) || 0,
                    y: Number(params.dy) || 0,
                    relative: true
                }, executeToolCall, `目标图层 ID: ${layerId}；相对移动 dx=${Number(params.dx) || 0}, dy=${Number(params.dy) || 0}`);
            }
            if (!Number.isFinite(Number(params.x)) || !Number.isFinite(Number(params.y))) {
                return { success: false, error: 'move 缺少坐标参数（x/y 或 dx/dy）' };
            }
            return executeObservedSkillTool(callbacks, 'moveLayer', {
                layerId,
                x: Number(params.x),
                y: Number(params.y),
                relative: false
            }, executeToolCall, `目标图层 ID: ${layerId}；移动到 x=${Number(params.x)}, y=${Number(params.y)}`);
        }
        case 'scale': {
            const percent = Number(params.scalePercent ?? params.percent);
            if (!Number.isFinite(percent)) {
                return { success: false, error: 'scale 缺少 scalePercent/percent 参数' };
            }
            return executeObservedSkillTool(callbacks, 'transformLayer', { layerId, scaleUniform: percent }, executeToolCall, `目标图层 ID: ${layerId}；等比缩放: ${percent}%`);
        }
        case 'setOpacity': {
            const opacity = Number(params.opacity);
            if (!Number.isFinite(opacity)) {
                return { success: false, error: 'setOpacity 缺少 opacity 参数' };
            }
            return executeObservedSkillTool(callbacks, 'setLayerOpacity', { layerId, opacity }, executeToolCall, `目标图层 ID: ${layerId}；透明度: ${opacity}`);
        }
        case 'setBlendMode': {
            const blendMode = String(params.blendMode || '').trim();
            if (!blendMode) {
                return { success: false, error: 'setBlendMode 缺少 blendMode 参数' };
            }
            return executeObservedSkillTool(callbacks, 'setBlendMode', { layerId, blendMode }, executeToolCall, `目标图层 ID: ${layerId}；混合模式: ${blendMode}`);
        }
        case 'replaceImage': {
            const filePath = String(params.filePath || '').trim();
            if (!filePath) {
                return { success: false, error: 'replaceImage 缺少 filePath 参数' };
            }
            return executeObservedSkillTool(callbacks, 'replaceLayerContent', { layerId, filePath }, executeToolCall, `目标图层 ID: ${layerId}；替换文件: ${filePath}`);
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
        emitSkillStep(callbacks, {
            kind: 'observation',
            title: '准备定位画布元素',
            detail: `动作: ${action}；目标描述: ${targetDescription || '按 layerId 直接定位'}；显式图层 ID: ${Number.isFinite(Number(params.layerId)) ? Number(params.layerId) : '未提供'}`,
            status: 'running',
            percent: 8
        });

        if (!targetDescription && !Number.isFinite(Number(params.layerId))) {
            emitSkillStep(callbacks, {
                kind: 'verification',
                title: '缺少目标元素描述',
                detail: '没有目标描述，也没有显式 layerId，不能安全选择或修改图层。',
                status: 'error',
                issue: 'Missing target description'
            });
            return {
                success: false,
                message: '缺少目标描述。请告诉我要改哪个元素，例如“右上角价格文案”。',
                error: 'Missing target description'
            };
        }

        callbacks?.onProgress?.('定位画布元素', 16);
        callbacks?.onMessage?.('正在定位画布元素。');

        const docInfo = await executeObservedSkillTool(callbacks, 'getDocumentInfo', {}, executeToolCall, '确认当前 Photoshop 文档是否可用。');
        if (!docInfo?.success) {
            emitSkillStep(callbacks, {
                kind: 'verification',
                title: '无法读取当前文档',
                detail: docInfo?.error || '当前没有可用 Photoshop 文档。',
                status: 'error',
                toolName: 'getDocumentInfo',
                issue: 'No document open'
            });
            return {
                success: false,
                message: '请先打开 Photoshop 文档。',
                error: 'No document open'
            };
        }

        const elementResult = await executeObservedSkillTool(callbacks, 'getElementMapping', {
            includeHidden: true,
            includeGroups: true,
            sortBy: 'position'
        }, executeToolCall, '读取画布元素、图层关系和可编辑对象映射。');
        const elements: CanvasElement[] = Array.isArray(elementResult?.elements)
            ? elementResult.elements
            : [];

        if (!elementResult?.success || elements.length === 0) {
            emitSkillStep(callbacks, {
                kind: 'verification',
                title: '没有找到可编辑图层',
                detail: elementResult?.error || '元素映射为空。',
                status: 'error',
                toolName: 'getElementMapping',
                issue: elementResult?.error || 'No elements'
            });
            return {
                success: false,
                message: '没有找到可编辑图层。',
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
        emitSkillStep(callbacks, {
            kind: 'observation',
            title: '候选图层已排序',
            detail: `候选数: ${ranked.length}；最佳: ${top?.element?.name || '无'}；分数: ${top?.score ?? 0}；第二名差距: ${margin}`,
            status: needUserSelection ? 'error' : 'success',
            percent: 54,
            issue: needUserSelection ? 'candidate_confirmation_required' : undefined
        });

        if (needUserSelection) {
            return {
                success: false,
                message: `找到候选图层，但我不想盲改。请确认要改哪一个。`,
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
            emitSkillStep(callbacks, {
                kind: 'verification',
                title: '没有可用目标图层',
                detail: '候选排序没有得到可执行 layerId。',
                status: 'error',
                issue: 'No selected layer id'
            });
            return {
                success: false,
                message: '没有找到可用图层。',
                error: 'No selected layer id'
            };
        }

        callbacks?.onProgress?.('选中目标图层', 68);
        const selectResult = await executeObservedSkillTool(callbacks, 'selectLayer', { layerId: selectedLayerId }, executeToolCall, `目标图层 ID: ${selectedLayerId}`);
        if (selectResult?.success === false) {
            emitSkillStep(callbacks, {
                kind: 'verification',
                title: '选中目标图层失败',
                detail: selectResult.error || '未知错误',
                status: 'error',
                toolName: 'selectLayer',
                issue: selectResult.error || 'Select layer failed'
            });
            return {
                success: false,
                message: `选中图层失败: ${selectResult.error || '未知错误'}`,
                error: selectResult.error || 'Select layer failed'
            };
        }

        callbacks?.onProgress?.('执行元素操作', 82);
        const actionResult = await runEditAction(action, selectedLayerId, params, callbacks);
        if (actionResult?.success === false) {
            emitSkillStep(callbacks, {
                kind: 'verification',
                title: '元素操作失败',
                detail: actionResult.error || '未知错误',
                status: 'error',
                issue: actionResult.error || 'Action failed'
            });
            return {
                success: false,
                message: `执行失败: ${actionResult.error || '未知错误'}`,
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
        emitSkillStep(callbacks, {
            kind: 'verification',
            title: '元素定位与操作完成',
            detail: `图层: ${selected?.name || selectedLayerId}；ID: ${selectedLayerId}；动作: ${action}`,
            status: 'success',
            percent: 100
        });

        return {
            success: true,
            message: `${successLine}\n\n图层：${selected?.name || selectedLayerId} (ID: ${selectedLayerId})`,
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
