import type { SkillExecutor, SkillExecuteParams } from './types';
import type { AgentResult } from '../unified-agent.service';
import { executeToolCall } from '../tool-executor.service';
import { emitSkillStep, executeObservedSkillTool } from './skill-step-events';
import {
    buildControlledPhotoshopLayerLightnessSortPlan,
    buildControlledPhotoshopLayerLightnessSortToolCallPlan,
    buildControlledPhotoshopScriptBenchmarkReport,
    executeControlledPhotoshopToolCallPlan
} from '../../../shared/photoshop-controlled-script-execution';
import type {
    ControlledPhotoshopScriptExecutionAdapter,
    ControlledPhotoshopScriptLayerTarget
} from '../../../shared/photoshop-controlled-script-execution';

type LayerAction =
    | 'select'
    | 'rename'
    | 'delete'
    | 'duplicate'
    | 'group'
    | 'ungroup'
    | 'move-to-group'
    | 'reorder'
    | 'inspect';

type ReorderAction = 'up' | 'down' | 'top' | 'bottom' | 'above' | 'below';
type LightnessDirection = 'light-to-dark' | 'dark-to-light';

interface LayerRef {
    id?: number;
    name: string;
    kind?: string;
    visible?: boolean;
    parentName?: string;
    depth: number;
    raw: any;
}

interface LightnessLayer extends LayerRef {
    lightness: number;
    lightnessReason: string;
}

function normalizeAction(value: unknown): LayerAction {
    const text = String(value || '').trim().toLowerCase();
    if (['select', 'rename', 'delete', 'duplicate', 'group', 'ungroup', 'move-to-group', 'reorder', 'inspect'].includes(text)) {
        return text as LayerAction;
    }
    return 'inspect';
}

function normalizeReorderAction(value: unknown): ReorderAction | undefined {
    const text = String(value || '').trim().toLowerCase();
    if (['up', 'down', 'top', 'bottom', 'above', 'below'].includes(text)) {
        return text as ReorderAction;
    }
    return undefined;
}

function getResultLayers(result: any): any[] {
    const candidates = [
        result?.layers,
        result?.data?.layers,
        result?.hierarchy,
        result?.data?.hierarchy,
        result?.layerTree,
        result?.data?.layerTree
    ];
    for (const candidate of candidates) {
        if (Array.isArray(candidate)) return candidate;
    }
    return [];
}

function getLayerId(layer: any): number | undefined {
    const id = Number(layer?.id ?? layer?.layerId ?? layer?._id);
    return Number.isFinite(id) ? id : undefined;
}

function getChildren(layer: any): any[] {
    for (const key of ['children', 'layers', 'items']) {
        const value = layer?.[key];
        if (Array.isArray(value)) return value;
    }
    return [];
}

function flattenLayers(layers: any[], parentName?: string, depth = 0): LayerRef[] {
    const flat: LayerRef[] = [];
    for (const layer of layers || []) {
        const ref: LayerRef = {
            id: getLayerId(layer),
            name: String(layer?.name || layer?.layerName || '').trim(),
            kind: String(layer?.kind || layer?.type || layer?.layerKind || '').trim(),
            visible: layer?.visible !== false,
            parentName,
            depth,
            raw: layer
        };
        if (ref.name || Number.isFinite(ref.id)) {
            flat.push(ref);
        }
        const children = getChildren(layer);
        if (children.length > 0) {
            flat.push(...flattenLayers(children, ref.name || parentName, depth + 1));
        }
    }
    return flat;
}

function compactText(value: unknown): string {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

function findLayer(layers: LayerRef[], params: Record<string, any>, keyPrefix = ''): LayerRef | undefined {
    const layerId = Number(params[`${keyPrefix}layerId`] ?? params.layerId);
    if (Number.isFinite(layerId)) {
        return layers.find((layer) => layer.id === layerId);
    }

    const name = String(params[`${keyPrefix}layerName`] ?? params.layerName ?? '').trim();
    if (name) {
        const compactName = compactText(name);
        return layers.find((layer) => compactText(layer.name) === compactName)
            || layers.find((layer) => compactText(layer.name).includes(compactName));
    }

    const description = String(params.targetDescription || '').trim();
    if (description) {
        const compactDescription = compactText(description);
        return layers.find((layer) => compactText(layer.name).includes(compactDescription));
    }

    return undefined;
}

function findTargetGroup(layers: LayerRef[], params: Record<string, any>): LayerRef | undefined {
    const groupId = Number(params.targetGroupId ?? params.targetLayerId);
    if (Number.isFinite(groupId)) {
        return layers.find((layer) => layer.id === groupId);
    }

    const name = String(params.targetGroupName ?? params.targetLayerName ?? params.groupName ?? '').trim();
    if (!name) return undefined;
    const compactName = compactText(name);
    return layers.find((layer) => compactText(layer.name) === compactName)
        || layers.find((layer) => compactText(layer.name).includes(compactName));
}

function uniqueLayerIds(params: Record<string, any>): number[] {
    const ids = Array.isArray(params.layerIds) ? params.layerIds : [];
    const normalized = ids
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id));
    const single = Number(params.layerId);
    if (Number.isFinite(single)) normalized.push(single);
    return Array.from(new Set(normalized));
}

function shouldUseCurrentSelection(params: Record<string, any>): boolean {
    return params.useCurrentSelection === true
        || /当前选中|当前选择|选中的|已选中|当前图层/.test(String(params.userIntent || ''));
}

function isToolFailure(result: any): boolean {
    return result?.success === false;
}

function getToolError(result: any, fallback: string): string {
    return String(result?.error || fallback);
}

function normalizeLightnessDirection(value: unknown): LightnessDirection {
    return value === 'dark-to-light' ? 'dark-to-light' : 'light-to-dark';
}

function formatLightnessDirection(direction: LightnessDirection): string {
    return direction === 'light-to-dark' ? '从浅到深' : '从深到浅';
}

function compareLightnessLayers(direction: LightnessDirection): (a: LightnessLayer, b: LightnessLayer) => number {
    return direction === 'light-to-dark'
        ? (a, b) => b.lightness - a.lightness
        : (a, b) => a.lightness - b.lightness;
}

function buildSelectLayerParams(layerIds: number[], selectedLayerId: number | undefined, layerName: unknown): Record<string, any> {
    if (layerIds.length > 1) return { layerIds };
    if (selectedLayerId) return { layerId: selectedLayerId };

    const normalizedLayerName = String(layerName || '').trim();
    if (normalizedLayerName) return { layerName: normalizedLayerName };

    return {};
}

function formatGroupSuccessMessage(layerCount: number): string {
    return layerCount > 0 ? `已编组 ${layerCount} 个图层。` : '已编组当前选中的图层。';
}

function lightnessFromName(name: string): { lightness: number; reason: string } | null {
    const text = compactText(name);
    if (!text) return null;
    if (/背景|矩形选取|选区|蒙版|mask|参考|guide/.test(text)) return null;

    let base: number | null = null;
    let reason = '';

    if (/黑|black/.test(text)) {
        base = 5;
        reason = '黑色系';
    } else if (/藏青|navy/.test(text)) {
        base = 18;
        reason = '藏青/海军蓝色系';
    } else if (/白|奶|米|乳|象牙|white|ivory|cream/.test(text)) {
        base = 94;
        reason = '白色/浅白色系';
    } else if (/卡其|khaki/.test(text)) {
        base = 70;
        reason = '卡其色系';
    } else if (/灰|grey|gray/.test(text)) {
        base = 58;
        reason = '灰色系';
    } else if (/黄|杏|beige|yellow/.test(text)) {
        base = 72;
        reason = '黄色/米杏色系';
    } else if (/粉|pink|rose/.test(text)) {
        base = 66;
        reason = '粉色系';
    } else if (/蓝|blue/.test(text)) {
        base = 56;
        reason = '蓝色系';
    } else if (/青|cyan|teal/.test(text)) {
        base = 45;
        reason = '青色系';
    } else if (/绿|green/.test(text)) {
        base = 50;
        reason = '绿色系';
    } else if (/棕|咖|褐|brown|coffee/.test(text)) {
        base = 36;
        reason = '棕咖色系';
    }

    if (base === null) return null;

    if (/浅|淡|light/.test(text)) {
        base = Math.max(base, 78);
        reason = `浅色修饰：${reason}`;
    }
    if (/中|medium/.test(text)) {
        base = Math.min(base, 55);
        reason = `中色修饰：${reason}`;
    }
    if (/深|dark/.test(text)) {
        base = Math.min(base, 28);
        reason = `深色修饰：${reason}`;
    }

    return { lightness: base, reason };
}

function inferSortableLightnessLayers(layers: LayerRef[]): LightnessLayer[] {
    const sortable: LightnessLayer[] = [];
    for (const layer of layers) {
        if (!layer.name || !Number.isFinite(layer.id)) continue;
        const inferred = lightnessFromName(layer.name);
        if (!inferred) continue;
        sortable.push({
            ...layer,
            lightness: inferred.lightness,
            lightnessReason: inferred.reason
        });
    }
    return sortable;
}

function buildColorLayerReport(layers: LayerRef[], direction: LightnessDirection = 'light-to-dark'): {
    colorLayers: LightnessLayer[];
    skippedLayers: LayerRef[];
    hiddenCount: number;
    visibleCount: number;
} {
    const colorLayers = inferSortableLightnessLayers(layers)
        .sort(compareLightnessLayers(direction));
    const colorIds = new Set(colorLayers.map((layer) => layer.id));
    const skippedLayers = layers.filter((layer) => !colorIds.has(layer.id));
    return {
        colorLayers,
        skippedLayers,
        hiddenCount: colorLayers.filter((layer) => layer.visible === false).length,
        visibleCount: colorLayers.filter((layer) => layer.visible !== false).length
    };
}

function buildControlledLayerTargets(layers: LightnessLayer[]): ControlledPhotoshopScriptLayerTarget[] {
    return layers.map((layer) => ({
        layerId: Number(layer.id),
        layerName: layer.name,
        lightness: layer.lightness,
        lightnessSource: 'inferred-layer-name',
        locked: layer.raw?.locked === true || layer.raw?.allLocked === true,
        visible: layer.visible !== false,
        parentPath: layer.parentName ? [layer.parentName] : []
    }));
}

function getTargetTopToBottomLayerIds(layers: LayerRef[], targetLayerIds: number[]): number[] {
    const targetIdSet = new Set(targetLayerIds.map(Number));
    return layers
        .filter((layer) => layer.id !== undefined && targetIdSet.has(Number(layer.id)))
        .map((layer) => Number(layer.id));
}

async function callTool(callbacks: SkillExecuteParams['callbacks'], toolName: string, params: Record<string, any>, detail: string): Promise<any> {
    return executeObservedSkillTool(callbacks, toolName, params, executeToolCall, detail);
}

async function verifyLayerState(callbacks: SkillExecuteParams['callbacks'], detail: string): Promise<any> {
    return callTool(callbacks, 'getAcceptanceSnapshot', {
        includeHidden: true,
        includeText: false,
        includeBounds: false,
        maxLayers: 120
    }, detail);
}

function createControlledLayerReorderAdapter(
    callbacks: SkillExecuteParams['callbacks'],
    toolResults: Array<{ toolName: string; result: any }>,
    targetLayerIds: number[]
): ControlledPhotoshopScriptExecutionAdapter {
    return {
        runToolCall: async (toolCall) => {
            const result = await callTool(
                callbacks,
                toolCall.tool,
                toolCall.params,
                `受控执行图层排序: ${toolCall.params.layerId} -> ${toolCall.params.action}。`
            );
            toolResults.push({ toolName: toolCall.tool, result });
            return {
                success: !isToolFailure(result),
                error: isToolFailure(result) ? getToolError(result, `${toolCall.tool} failed`) : undefined,
                data: result
            };
        },
        readTargetTopToBottomLayerIds: async () => {
            const result = await callTool(callbacks, 'getLayerHierarchy', {
                includeHidden: true
            }, '受控排序后读取图层层级进行复核。');
            toolResults.push({ toolName: 'getLayerHierarchy', result });
            if (isToolFailure(result)) {
                throw new Error(getToolError(result, 'getLayerHierarchy failed'));
            }
            return getTargetTopToBottomLayerIds(flattenLayers(getResultLayers(result)), targetLayerIds);
        }
    };
}


export const layerManagementExecutor: SkillExecutor = {
    skillId: 'layer-management',

    async execute({ params, callbacks }: SkillExecuteParams): Promise<AgentResult> {
        const action = normalizeAction(params.action);
        const toolResults: Array<{ toolName: string; result: any }> = [];

        emitSkillStep(callbacks, {
            kind: 'observation',
            title: '准备图层管理操作',
            detail: `动作: ${action}`,
            status: 'running',
            percent: 8
        });

        const docInfo = await callTool(callbacks, 'getDocumentInfo', {}, '确认当前 Photoshop 文档状态。');
        toolResults.push({ toolName: 'getDocumentInfo', result: docInfo });
        if (!docInfo?.success) {
            return {
                success: false,
                message: '请先打开 Photoshop 文档后再操作图层。',
                error: docInfo?.error || 'No document open',
                toolResults
            };
        }

        const hierarchy = await callTool(callbacks, 'getLayerHierarchy', { includeHidden: true }, '读取图层层级，避免盲改。');
        toolResults.push({ toolName: 'getLayerHierarchy', result: hierarchy });
        const layers = flattenLayers(getResultLayers(hierarchy));
        if (!hierarchy?.success || layers.length === 0) {
            return {
                success: false,
                message: '没有读取到可操作的图层层级。',
                error: hierarchy?.error || 'No layers',
                toolResults
            };
        }

        if (action === 'inspect' && params.inspectMode === 'color-layers') {
            const report = buildColorLayerReport(layers);
            return {
                success: true,
                message: `已读取颜色图层，共 ${report.colorLayers.length} 个；其中可见 ${report.visibleCount} 个，隐藏 ${report.hiddenCount} 个。`,
                toolResults,
                data: {
                    inspectMode: 'color-layers',
                    colorLayerCount: report.colorLayers.length,
                    visibleColorLayerCount: report.visibleCount,
                    hiddenColorLayerCount: report.hiddenCount,
                    colorLayers: report.colorLayers.map((layer, index) => ({
                        order: index + 1,
                        layerId: layer.id,
                        layerName: layer.name,
                        visible: layer.visible !== false,
                        lightness: layer.lightness,
                        reason: layer.lightnessReason
                    })),
                    skippedLayers: report.skippedLayers.slice(0, 40).map((layer) => ({
                        layerId: layer.id,
                        layerName: layer.name,
                        visible: layer.visible !== false,
                        kind: layer.kind
                    }))
                }
            };
        }

        if (action === 'inspect') {
            return {
                success: true,
                message: `已读取图层层级，共 ${layers.length} 个图层。`,
                toolResults,
                data: { layerCount: layers.length, layers: layers.slice(0, 60) }
            };
        }

        if (action === 'reorder' && params.sortBy === 'lightness') {
            const direction = normalizeLightnessDirection(params.sortDirection);
            const colorReport = buildColorLayerReport(layers, direction);
            const sortable = colorReport.colorLayers;

            emitSkillStep(callbacks, {
                kind: 'observation',
                title: '颜色图层已识别',
                detail: `可排序图层: ${sortable.length}；方向: ${direction}`,
                status: sortable.length >= 2 ? 'success' : 'error',
                percent: 42
            });

            if (sortable.length < 2) {
                return {
                    success: false,
                    message: '没有足够的可排序颜色图层。请确认图层名称包含颜色，或先选中需要排序的图层。',
                    error: 'Not enough sortable color layers',
                    toolResults,
                    data: {
                        sortableCandidates: sortable.map((layer) => ({
                            layerId: layer.id,
                            layerName: layer.name,
                            lightness: layer.lightness,
                            reason: layer.lightnessReason
                        }))
                    }
                };
            }

            const controlledDryRun = buildControlledPhotoshopLayerLightnessSortPlan({
                kind: 'layer-lightness-sort',
                direction,
                userIntent: params.userIntent,
                layers: buildControlledLayerTargets(sortable)
            });
            const controlledToolCallPlan = buildControlledPhotoshopLayerLightnessSortToolCallPlan(controlledDryRun);
            if (controlledToolCallPlan.status !== 'ready_tool_call_plan') {
                return {
                    success: false,
                    message: `受控图层排序未执行：${controlledToolCallPlan.blockers.join('；') || '计划未就绪'}。`,
                    error: controlledToolCallPlan.blockers.join('; ') || controlledDryRun.blockers.join('; ') || 'controlled layer order plan blocked',
                    toolResults,
                    data: {
                        action,
                        sortBy: 'lightness',
                        sortDirection: direction,
                        controlledDryRun,
                        controlledToolCallPlan,
                        sortedLayers: sortable
                    }
                };
            }

            const controlledExecution = await executeControlledPhotoshopToolCallPlan(
                controlledToolCallPlan,
                createControlledLayerReorderAdapter(
                    callbacks,
                    toolResults,
                    controlledToolCallPlan.verificationPlan.expectedTopToBottomLayerIds
                ),
                { liveExecutionApproved: true, executionTarget: 'user-approved-document' }
            );
            const controlledBenchmark = buildControlledPhotoshopScriptBenchmarkReport(
                controlledDryRun,
                controlledToolCallPlan,
                controlledExecution
            );
            if (controlledExecution.status !== 'completed_verified') {
                return {
                    success: false,
                    message: `受控图层排序未通过复核：${controlledExecution.blockers.join('；') || controlledExecution.status}。`,
                    error: controlledExecution.blockers.join('; ') || controlledExecution.status,
                    toolResults,
                    data: {
                        action,
                        sortBy: 'lightness',
                        sortDirection: direction,
                        controlledDryRun,
                        controlledToolCallPlan,
                        controlledExecution,
                        controlledBenchmark,
                        sortedLayers: sortable
                    }
                };
            }

            return {
                success: true,
                message: `已按${formatLightnessDirection(direction)}调整 ${sortable.length} 个颜色图层的堆叠顺序；其中隐藏颜色图层 ${colorReport.hiddenCount} 个。`,
                toolResults,
                data: {
                    action,
                    sortBy: 'lightness',
                    sortDirection: direction,
                    hiddenColorLayerCount: colorReport.hiddenCount,
                    visibleColorLayerCount: colorReport.visibleCount,
                    sortedLayers: sortable.map((layer, index) => ({
                        order: index + 1,
                        layerId: layer.id,
                        layerName: layer.name,
                        visible: layer.visible !== false,
                        lightness: layer.lightness,
                        reason: layer.lightnessReason
                    })),
                    skippedLayers: colorReport.skippedLayers.slice(0, 40).map((layer) => ({
                        layerId: layer.id,
                        layerName: layer.name,
                        visible: layer.visible !== false,
                        kind: layer.kind
                    })),
                    controlledDryRun,
                    controlledToolCallPlan,
                    controlledExecution,
                    controlledBenchmark,
                    reorderResults: controlledExecution.toolResults.map((result) => result.data)
                }
            };
        }

        const selected = findLayer(layers, params);
        const selectedLayerId = selected?.id;
        const layerIds = uniqueLayerIds(params);
        if (selectedLayerId && !layerIds.includes(selectedLayerId)) {
            layerIds.push(selectedLayerId);
        }
        const primaryLayerId = selectedLayerId ?? layerIds[0];
        const useCurrentSelection = shouldUseCurrentSelection(params);

        if (['rename', 'delete', 'duplicate', 'ungroup', 'move-to-group', 'reorder'].includes(action) && !primaryLayerId && !useCurrentSelection) {
            return {
                success: false,
                message: '目标图层不明确。请提供图层名称、图层 ID，或先选中目标图层。',
                error: 'Target layer missing',
                toolResults,
                data: {
                    candidates: layers.slice(0, 20).map((layer) => ({
                        layerId: layer.id,
                        layerName: layer.name,
                        parentName: layer.parentName,
                        kind: layer.kind
                    }))
                }
            };
        }

        if (action === 'select') {
            const selectParams = buildSelectLayerParams(layerIds, selectedLayerId, params.layerName);
            const result = await callTool(callbacks, 'selectLayer', selectParams, '选中目标图层。');
            toolResults.push({ toolName: 'selectLayer', result });
            return {
                success: !isToolFailure(result),
                message: isToolFailure(result) ? `选中图层失败: ${getToolError(result, '未知错误')}` : '已选中目标图层。',
                error: isToolFailure(result) ? getToolError(result, 'selectLayer failed') : undefined,
                toolResults,
                data: { selectedLayerIds: layerIds }
            };
        }

        if (action === 'rename') {
            const newName = String(params.newName || '').trim();
            if (!newName) {
                return { success: false, message: '重命名图层需要提供新名称。', error: 'newName missing', toolResults };
            }
            const result = await callTool(callbacks, 'renameLayer', { layerId: primaryLayerId, newName, useCurrentSelection }, `重命名图层为「${newName}」。`);
            toolResults.push({ toolName: 'renameLayer', result });
            const snapshot = await verifyLayerState(callbacks, '复核图层重命名结果。');
            toolResults.push({ toolName: 'getAcceptanceSnapshot', result: snapshot });
            return {
                success: !isToolFailure(result),
                message: isToolFailure(result) ? `重命名失败: ${getToolError(result, '未知错误')}` : `已重命名图层为「${newName}」。`,
                error: isToolFailure(result) ? getToolError(result, 'renameLayer failed') : undefined,
                toolResults
            };
        }

        if (action === 'delete') {
            const result = await callTool(callbacks, 'deleteLayer', { layerId: primaryLayerId, useCurrentSelection }, '删除目标图层。');
            toolResults.push({ toolName: 'deleteLayer', result });
            const snapshot = await verifyLayerState(callbacks, '复核图层删除结果。');
            toolResults.push({ toolName: 'getAcceptanceSnapshot', result: snapshot });
            return {
                success: !isToolFailure(result),
                message: isToolFailure(result) ? `删除图层失败: ${getToolError(result, '未知错误')}` : '已删除目标图层。',
                error: isToolFailure(result) ? getToolError(result, 'deleteLayer failed') : undefined,
                toolResults
            };
        }

        if (action === 'duplicate') {
            if (primaryLayerId) {
                const selectResult = await callTool(callbacks, 'selectLayer', { layerId: primaryLayerId }, '先选中需要复制的图层。');
                toolResults.push({ toolName: 'selectLayer', result: selectResult });
                if (isToolFailure(selectResult)) {
                    return { success: false, message: `选中图层失败: ${getToolError(selectResult, '未知错误')}`, error: getToolError(selectResult, 'selectLayer failed'), toolResults };
                }
            }
            const result = await callTool(callbacks, 'duplicateLayer', { layerId: primaryLayerId, newName: params.newName, useCurrentSelection }, '复制目标图层。');
            toolResults.push({ toolName: 'duplicateLayer', result });
            const snapshot = await verifyLayerState(callbacks, '复核图层复制结果。');
            toolResults.push({ toolName: 'getAcceptanceSnapshot', result: snapshot });
            return {
                success: !isToolFailure(result),
                message: isToolFailure(result) ? `复制图层失败: ${getToolError(result, '未知错误')}` : '已复制目标图层。',
                error: isToolFailure(result) ? getToolError(result, 'duplicateLayer failed') : undefined,
                toolResults
            };
        }

        if (action === 'group') {
            const ids = layerIds.length > 0 ? layerIds : uniqueLayerIds(params);
            if (ids.length === 0 && !useCurrentSelection) {
                return { success: false, message: '编组需要提供 layerIds 或先多选图层。', error: 'layerIds missing', toolResults };
            }
            const result = await callTool(callbacks, 'groupLayers', {
                ...(ids.length > 0 ? { layerIds: ids } : {}),
                ...(useCurrentSelection ? { useCurrentSelection: true } : {}),
                groupName: params.newName || params.groupName
            }, ids.length > 0 ? `编组 ${ids.length} 个图层。` : '编组当前选中的图层。');
            toolResults.push({ toolName: 'groupLayers', result });
            const snapshot = await verifyLayerState(callbacks, '复核图层编组结果。');
            toolResults.push({ toolName: 'getAcceptanceSnapshot', result: snapshot });
            const layerCount = ids.length || Number(result?.group?.layerCount) || Number(result?.layerCount) || 0;
            return {
                success: !isToolFailure(result),
                message: isToolFailure(result) ? `图层编组失败: ${getToolError(result, '未知错误')}` : formatGroupSuccessMessage(layerCount),
                error: isToolFailure(result) ? getToolError(result, 'groupLayers failed') : undefined,
                toolResults
            };
        }

        if (action === 'ungroup') {
            const result = await callTool(callbacks, 'ungroupLayers', { groupId: primaryLayerId, useCurrentSelection }, '解除目标图层组。');
            toolResults.push({ toolName: 'ungroupLayers', result });
            const snapshot = await verifyLayerState(callbacks, '复核解除编组结果。');
            toolResults.push({ toolName: 'getAcceptanceSnapshot', result: snapshot });
            return {
                success: !isToolFailure(result),
                message: isToolFailure(result) ? `解除编组失败: ${getToolError(result, '未知错误')}` : '已解除目标图层组。',
                error: isToolFailure(result) ? getToolError(result, 'ungroupLayers failed') : undefined,
                toolResults
            };
        }

        if (action === 'move-to-group') {
            const targetGroup = findTargetGroup(layers, params);
            if (!targetGroup?.id) {
                return {
                    success: false,
                    message: '目标图层组不明确。请提供 targetGroupId、targetGroupName，或说明要移入哪个组。',
                    error: 'Target group missing',
                    toolResults,
                    data: {
                        candidates: layers
                            .filter((layer) => layer.kind?.toLowerCase().includes('group') || getChildren(layer.raw).length > 0)
                            .slice(0, 20)
                            .map((layer) => ({
                                layerId: layer.id,
                                layerName: layer.name,
                                parentName: layer.parentName,
                                kind: layer.kind
                            }))
                    }
                };
            }

            const result = await callTool(callbacks, 'moveLayerToGroup', {
                layerId: primaryLayerId,
                targetGroupId: targetGroup.id,
                position: params.position || 'inside'
            }, `将目标图层移动到「${targetGroup.name}」组内。`);
            toolResults.push({ toolName: 'moveLayerToGroup', result });
            const snapshot = await verifyLayerState(callbacks, '复核图层父子层级调整结果。');
            toolResults.push({ toolName: 'getAcceptanceSnapshot', result: snapshot });
            return {
                success: !isToolFailure(result),
                message: isToolFailure(result) ? `移动到图层组失败: ${getToolError(result, '未知错误')}` : `已将图层移动到「${targetGroup.name}」组内。`,
                error: isToolFailure(result) ? getToolError(result, 'moveLayerToGroup failed') : undefined,
                toolResults,
                data: { layerId: primaryLayerId, targetGroupId: targetGroup.id }
            };
        }

        if (action === 'reorder') {
            const reorderAction = normalizeReorderAction(params.reorderAction) || 'top';
            const targetLayer = findLayer(layers, {
                layerId: params.targetLayerId,
                layerName: params.targetLayerName
            });
            const payload: Record<string, any> = {
                layerId: primaryLayerId,
                action: reorderAction,
                useCurrentSelection
            };
            if ((reorderAction === 'above' || reorderAction === 'below') && targetLayer?.id) {
                payload.targetLayerId = targetLayer.id;
            }
            const result = await callTool(callbacks, 'reorderLayer', payload, `执行图层堆叠顺序调整: ${reorderAction}。`);
            toolResults.push({ toolName: 'reorderLayer', result });
            const snapshot = await verifyLayerState(callbacks, '复核图层顺序调整结果。');
            toolResults.push({ toolName: 'getAcceptanceSnapshot', result: snapshot });
            return {
                success: !isToolFailure(result),
                message: isToolFailure(result) ? `图层顺序调整失败: ${getToolError(result, '未知错误')}` : '已调整图层堆叠顺序。',
                error: isToolFailure(result) ? getToolError(result, 'reorderLayer failed') : undefined,
                toolResults,
                data: { layerId: primaryLayerId, reorderAction, targetLayerId: targetLayer?.id }
            };
        }

        return {
            success: false,
            message: `不支持的图层管理动作: ${action}`,
            error: `Unsupported layer action: ${action}`,
            toolResults
        };
    }
};
