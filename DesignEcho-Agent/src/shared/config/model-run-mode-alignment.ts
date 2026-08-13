/**
 * 运行模式 ↔ 模型分工 对齐（纯逻辑，无 IO）
 *
 * 修复的真实缺陷：设置页「运行模式」与「模型分工」原本是两份互不影响的状态。
 * 切到本地模式只会过滤下拉的 optgroup，从不改写已选的 primaryModel / visualModel；
 * 而运行时 resolvePrimaryModelForPreferences 是「显式配置的 primaryModel 优先」，
 * 于是出现「已选本地模式，界面仍显示云端模型、实际也仍在调用云端 API」。
 *
 * 本模块只负责：给定运行模式与当前两个模型槽，算出对齐后的模型 + 面向用户的变更说明。
 * 不发网络请求、不读 store，可被设置页 UI 与后续校验共用。
 *
 * 两条硬约束：
 * 1. 禁静默降级 —— 切换只发生在用户显式点击运行模式时，且每次切换都要产出可展示的中文说明。
 * 2. 三态原则（见 CLAUDE.md）—— 只有「确定属于另一侧渠道」的模型才会被换掉；
 *    模型 id 在注册表里查不到（unknown）时一律保留用户选择，不猜、不阻断。
 */

import {
    DEFAULT_MODEL_PREFERENCES,
    LOCAL_MODELS,
    getModelById,
    isConversationModelConfig,
    type ModelPreferences
} from './models.config';

export type ModelRunMode = ModelPreferences['mode'];

/** 模型分工的两个槽位；与设置页「主模型 / 视觉模型」一一对应。 */
export type ModelSlot = 'primary' | 'visual';

/** 模型所属渠道；unknown = 注册表里查不到，按三态原则保留不动。 */
export type ModelChannel = 'local' | 'cloud' | 'unknown';

/** 某个本地模型作为候选时的判断依据（installed 来自 Ollama /api/tags）。 */
export interface LocalModelCandidate {
    id: string;
    name: string;
    apiModelId: string;
    supportsVision: boolean;
    recommended: boolean;
    installed: boolean;
}

export interface ModelSlotSelection {
    primaryModel: string;
    visualModel: string;
}

/** 用户在各运行模式下最后一次的选择；切回该模式时优先恢复，避免来回切丢配置。 */
export type ModelRunModeSelectionMemory = Partial<Record<ModelRunMode, Partial<ModelSlotSelection>>>;

export interface ModelRunModeChange {
    slot: ModelSlot;
    fromModelId: string;
    toModelId: string;
    /** 面向用户的中文说明，可直接展示 */
    reason: string;
}

export interface ModelRunModeMismatch {
    slot: ModelSlot;
    modelId: string;
    modelName: string;
    /** 该模型实际所属渠道（与当前运行模式冲突的那一侧） */
    channel: 'local' | 'cloud';
    /** 面向用户的中文说明，说明「实际会调用哪一侧」 */
    reason: string;
}

export interface ModelRunModeAlignment extends ModelSlotSelection {
    /** 本次实际发生的模型切换（用于给用户可见回执） */
    changes: ModelRunModeChange[];
    /** 对齐后仍然冲突的槽位（挑不出可用候选时保留原模型，只如实告警） */
    mismatches: ModelRunModeMismatch[];
}

const SLOT_LABEL: Record<ModelSlot, string> = {
    primary: '主模型',
    visual: '视觉模型'
};

const MODE_LABEL: Record<ModelRunMode, string> = {
    local: '本地模式',
    cloud: '云端模式'
};

const CHANNEL_LABEL: Record<'local' | 'cloud', string> = {
    local: '本地 Ollama',
    cloud: '云端 API'
};

/** 运行模式与渠道现在是一一对应的（'auto' 已取消）。 */
function getRequiredChannelForMode(mode: ModelRunMode): 'local' | 'cloud' {
    return mode;
}

export function getModelDisplayName(modelId: string): string {
    const id = String(modelId || '').trim();
    if (!id) return '';
    return getModelById(id)?.name || id;
}

export function resolveModelChannel(modelId: string): ModelChannel {
    const id = String(modelId || '').trim();
    if (!id) return 'unknown';
    const model = getModelById(id);
    if (!model) return 'unknown';
    if (model.source === 'local') return 'local';
    if (model.source === 'cloud') return 'cloud';
    return 'unknown';
}

/**
 * Ollama 的 tag 名（如 `qwen2.5:14b`、`llava:13b:latest`）与配置里的 apiModelId 对齐用。
 * 只做大小写与 `:latest` 后缀归一，不做模糊匹配，避免把不同规格的模型认成同一个。
 */
function normalizeOllamaTag(tag: string): string {
    return String(tag || '')
        .trim()
        .toLowerCase()
        .replace(/:latest$/u, '');
}

/**
 * 列出某个槽位在本地模式下的候选模型。
 * 视觉槽只收 supportsVision 的模型；主模型槽收全部本地对话模型。
 */
export function listLocalSlotCandidates(
    slot: ModelSlot,
    installedModelTags?: readonly string[]
): LocalModelCandidate[] {
    const installed = new Set((installedModelTags || []).map(normalizeOllamaTag).filter(Boolean));
    return LOCAL_MODELS
        .filter(model => isConversationModelConfig(model))
        .filter(model => slot !== 'visual' || model.supportsVision === true)
        .map(model => ({
            id: model.id,
            name: model.name,
            apiModelId: model.apiModelId,
            supportsVision: model.supportsVision === true,
            recommended: model.recommended === true,
            installed: installed.has(normalizeOllamaTag(model.apiModelId))
        }));
}

/**
 * 本地模式下为某槽位挑一个默认模型。
 *
 * 排序策略（越靠前越优先）：
 * 1. 用户在本地模式下上次用过的模型（仍在候选里）—— 来回切模式不丢配置；
 * 2. 已安装 + 配置里标了推荐 —— 装好了又是设计场景首选，开箱即用；
 * 3. 已安装 —— 至少不用先下模型；
 * 4. 标了推荐 —— Ollama 离线或没装模型时给出最合理的目标；
 * 5. 候选表首项。
 *
 * 返回 null 表示确实挑不出（该槽位没有任何本地候选），调用方保留原模型并如实告警。
 */
export function pickLocalModelForSlot(input: {
    slot: ModelSlot;
    candidates: readonly LocalModelCandidate[];
    preferredModelId?: string;
}): string | null {
    const candidates = input.candidates;
    if (candidates.length === 0) return null;

    const preferred = String(input.preferredModelId || '').trim();
    if (preferred && candidates.some(candidate => candidate.id === preferred)) {
        return preferred;
    }

    const installedRecommended = candidates.find(c => c.installed && c.recommended);
    if (installedRecommended) return installedRecommended.id;

    const installedAny = candidates.find(c => c.installed);
    if (installedAny) return installedAny.id;

    // 走到这里说明：一个已安装的候选都没有（Ollama 离线，或该槽位的模型都还没 pull 下来）。
    // 此时挑谁取决于这台机器的显存和使用习惯，配置表本身判断不了。
    // TODO(human): 决定「没有任何已安装模型时」的兜底挑选策略
    const recommended = candidates.find(c => c.recommended);
    if (recommended) return recommended.id;

    return candidates[0].id;
}

/**
 * 云端模式下为某槽位挑一个默认模型。
 * 云端候选是动态的（各 provider 列表 + 用户配置的 key），这里不做能力猜测：
 * 只在「用户上次的云端选择」与「出厂默认」之间取，且必须确实是云端对话模型。
 * 视觉槽额外要求 supportsVision，避免把纯文本模型塞进读图位置。
 */
export function pickCloudModelForSlot(input: {
    slot: ModelSlot;
    preferredModelId?: string;
}): string | null {
    const fallback = input.slot === 'visual'
        ? DEFAULT_MODEL_PREFERENCES.visualModel
        : DEFAULT_MODEL_PREFERENCES.primaryModel;

    for (const candidateId of [String(input.preferredModelId || '').trim(), fallback]) {
        if (!candidateId) continue;
        const model = getModelById(candidateId);
        if (!model || model.source !== 'cloud') continue;
        if (!isConversationModelConfig(model)) continue;
        if (input.slot === 'visual' && model.supportsVision !== true) continue;
        return candidateId;
    }
    return null;
}

function buildMismatch(slot: ModelSlot, modelId: string, mode: ModelRunMode): ModelRunModeMismatch | null {
    const channel = resolveModelChannel(modelId);
    if (channel === 'unknown') return null;
    if (channel === getRequiredChannelForMode(mode)) return null;

    return {
        slot,
        modelId,
        modelName: getModelDisplayName(modelId),
        channel,
        reason: `当前是${MODE_LABEL[mode]}，但${SLOT_LABEL[slot]}「${getModelDisplayName(modelId)}」属于${CHANNEL_LABEL[channel]}，实际仍会调用${CHANNEL_LABEL[channel]}。`
    };
}

/**
 * 检测已保存配置里的模式/模型冲突（打开设置页时用）。
 * 只报告、不改写：历史配置由用户自己决定是否对齐，避免开页即静默改配置。
 *
 * 只检查主模型：运行模式描述的就是主模型走哪条渠道。视觉模型是独立槽位，
 * 允许跨渠道搭配（云端主模型推理 + 本地视觉模型看图是合理组合，省钱且画面不外传），
 * 对它报「渠道不一致」是误报——用户刚在选择器里特意这么配的。
 */
export function detectRunModeMismatches(input: {
    mode: ModelRunMode;
    primaryModel: string;
}): ModelRunModeMismatch[] {
    const primary = buildMismatch('primary', input.primaryModel, input.mode);
    return primary ? [primary] : [];
}

function alignSlot(input: {
    slot: ModelSlot;
    mode: ModelRunMode;
    currentModelId: string;
    rememberedModelId?: string;
    installedLocalModelTags?: readonly string[];
}): { modelId: string; change: ModelRunModeChange | null; mismatch: ModelRunModeMismatch | null } {
    const current = String(input.currentModelId || '').trim();
    const required = getRequiredChannelForMode(input.mode);
    const channel = resolveModelChannel(current);
    // unknown 一律放行：注册表查不到不等于不可用，交给真实执行去验证
    if (channel === 'unknown' || channel === required) {
        return { modelId: current, change: null, mismatch: null };
    }

    const picked = required === 'local'
        ? pickLocalModelForSlot({
            slot: input.slot,
            candidates: listLocalSlotCandidates(input.slot, input.installedLocalModelTags),
            preferredModelId: input.rememberedModelId
        })
        : pickCloudModelForSlot({
            slot: input.slot,
            preferredModelId: input.rememberedModelId
        });

    if (!picked || picked === current) {
        return {
            modelId: current,
            change: null,
            mismatch: buildMismatch(input.slot, current, input.mode)
        };
    }

    return {
        modelId: picked,
        change: {
            slot: input.slot,
            fromModelId: current,
            toModelId: picked,
            reason: `${SLOT_LABEL[input.slot]}已按${MODE_LABEL[input.mode]}切换：${getModelDisplayName(current)} → ${getModelDisplayName(picked)}`
        },
        mismatch: null
    };
}

/**
 * 把两个模型槽对齐到目标运行模式。
 *
 * @param input.rememberedByMode 各模式下用户上次的选择；切回原模式时恢复，不做跨模式猜测
 * @param input.installedLocalModelTags Ollama /api/tags 返回的已安装模型名，仅用于候选排序
 */
export function alignModelSelectionToRunMode(input: {
    mode: ModelRunMode;
    primaryModel: string;
    visualModel: string;
    rememberedByMode?: ModelRunModeSelectionMemory;
    installedLocalModelTags?: readonly string[];
}): ModelRunModeAlignment {
    const remembered = input.rememberedByMode?.[input.mode];
    const primary = alignSlot({
        slot: 'primary',
        mode: input.mode,
        currentModelId: input.primaryModel,
        rememberedModelId: remembered?.primaryModel,
        installedLocalModelTags: input.installedLocalModelTags
    });
    const visual = alignSlot({
        slot: 'visual',
        mode: input.mode,
        currentModelId: input.visualModel,
        rememberedModelId: remembered?.visualModel,
        installedLocalModelTags: input.installedLocalModelTags
    });

    const changes: ModelRunModeChange[] = [];
    if (primary.change) changes.push(primary.change);
    if (visual.change) changes.push(visual.change);

    const mismatches: ModelRunModeMismatch[] = [];
    if (primary.mismatch) mismatches.push(primary.mismatch);
    if (visual.mismatch) mismatches.push(visual.mismatch);

    return {
        primaryModel: primary.modelId,
        visualModel: visual.modelId,
        changes,
        mismatches
    };
}

/** 记住当前模式下的选择，供切回来时恢复。 */
export function rememberRunModeSelection(
    memory: ModelRunModeSelectionMemory | undefined,
    mode: ModelRunMode,
    selection: ModelSlotSelection
): ModelRunModeSelectionMemory {
    return {
        ...(memory || {}),
        [mode]: {
            primaryModel: selection.primaryModel,
            visualModel: selection.visualModel
        }
    };
}
