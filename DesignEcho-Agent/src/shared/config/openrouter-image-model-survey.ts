/**
 * OpenRouter 出图模型体检。
 *
 * 这个模块要回答的不是"挑哪个模型好看"，而是一个很具体、能证伪的问题：
 * **OpenRouter 的 chat completions 接口面上，有没有哪个出图模型真的暴露了蒙版通道？**
 *
 * 背景：我们的局部重绘走 OpenRouter 时，"只改选区"完全靠自己撑——
 * 裁上下文窗、画红框引导图、回贴时用 alpha 卡边界。这套绕法存在的唯一理由，
 * 就是 chat completions 的请求体里没有地方表达"哪些像素可编辑"。
 * 一旦某个模型在 supported_parameters 里声明了 mask / inpaint 之类的参数，
 * 这套绕法就该让位给原生能力——所以这里把线索原样挑出来，而不是替人下结论。
 *
 * 纯逻辑：输入是 listProviderModels 标准化后的结果，不发请求、不碰 UI，可离线测。
 */

import type { FetchedProviderModel } from './provider-model-merge';

/**
 * 判定"这条声明是不是在讲蒙版"的词根。
 *
 * 刻意只收这两个：mask 和 inpaint 在图像模型语境里指向明确。
 * 不收 edit / image——OpenRouter 的 supported_parameters 里到处是它们，
 * 收进来会把整份清单都标成"疑似支持蒙版"，等于没筛。
 */
const MASK_SIGNAL_TOKENS = ['mask', 'inpaint'];

export interface OpenRouterImageModelEntry {
    apiModelId: string;
    name: string;
    /** 能吃图输入 → 有图生图/编辑的潜力；只出不进的是纯文生图，做不了局部重绘 */
    acceptsImageInput: boolean;
    /** 声明里命中蒙版词根的条目，原样保留便于人工核对 */
    maskSignals: string[];
    /** 模型自报的参数与能力（主要来自 OpenRouter 的 supported_parameters） */
    declaredCapabilities: string[];
}

export interface OpenRouterImageModelSurvey {
    /** 本次拉到的模型总数（含非出图模型） */
    scannedCount: number;
    /** 出图模型（output_modalities 含 image） */
    imageModels: OpenRouterImageModelEntry[];
    /** 其中还能吃图输入的：具备图生图/编辑潜力的子集 */
    imageEditModels: OpenRouterImageModelEntry[];
    /**
     * 其中声明里出现蒙版线索的。
     * 空数组不等于"绝对没有"，但它是我们能拿到的最直接证据——
     * 说明按模型自报的参数看，没有原生蒙版通道可用。
     */
    maskCapableModels: OpenRouterImageModelEntry[];
}

function normalizeList(values?: string[]): string[] {
    if (!Array.isArray(values)) return [];
    return values
        .map((value) => String(value ?? '').trim())
        .filter((value) => value.length > 0);
}

function hasImageModality(values?: string[]): boolean {
    return normalizeList(values).some((value) => value.toLowerCase() === 'image');
}

/** 把模型自报的各类声明汇成一份去重清单，供蒙版线索检索与人工核对 */
function collectDeclarations(model: FetchedProviderModel): string[] {
    const declarations = [
        ...normalizeList(model.capabilityNames),
        ...normalizeList(model.supportedMethods),
        ...(model.declaredKind ? [String(model.declaredKind).trim()] : [])
    ].filter(Boolean);

    return Array.from(new Set(declarations));
}

function findMaskSignals(declarations: string[]): string[] {
    return declarations.filter((declaration) => {
        const lowered = declaration.toLowerCase();
        return MASK_SIGNAL_TOKENS.some((token) => lowered.includes(token));
    });
}

function toEntry(model: FetchedProviderModel): OpenRouterImageModelEntry {
    const declarations = collectDeclarations(model);
    return {
        apiModelId: String(model.apiModelId || '').trim(),
        name: String(model.name || model.apiModelId || '').trim(),
        acceptsImageInput: hasImageModality(model.inputModalities),
        maskSignals: findMaskSignals(declarations),
        declaredCapabilities: declarations
    };
}

/**
 * 体检一份 OpenRouter 模型清单。
 *
 * 排序：能吃图输入的排前面（它们才是局部重绘的候选），同组内按名称排，
 * 保证同一份输入每次得到同样的顺序——清单要能拿来对比两次拉取的差异。
 */
export function surveyOpenRouterImageModels(
    models: FetchedProviderModel[] | undefined | null
): OpenRouterImageModelSurvey {
    const list = Array.isArray(models) ? models : [];

    const imageModels = list
        .filter((model) => hasImageModality(model.outputModalities))
        .map(toEntry)
        .filter((entry) => entry.apiModelId.length > 0)
        .sort((a, b) => {
            if (a.acceptsImageInput !== b.acceptsImageInput) {
                return a.acceptsImageInput ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });

    return {
        scannedCount: list.length,
        imageModels,
        imageEditModels: imageModels.filter((entry) => entry.acceptsImageInput),
        maskCapableModels: imageModels.filter((entry) => entry.maskSignals.length > 0)
    };
}

/**
 * 把体检结果讲成一句人话。
 *
 * 措辞刻意保守：模型清单只能反映"模型自报了什么"，
 * 说成"OpenRouter 一定不支持蒙版"是过度推断，所以只讲证据说了什么。
 */
export function describeOpenRouterImageModelSurvey(survey: OpenRouterImageModelSurvey): string {
    if (survey.imageModels.length === 0) {
        return `已扫描 ${survey.scannedCount} 个模型，其中没有声明出图能力的模型。`;
    }

    const base = `已扫描 ${survey.scannedCount} 个模型：出图模型 ${survey.imageModels.length} 个，`
        + `其中 ${survey.imageEditModels.length} 个能接受图片输入（可做图生图/编辑）。`;

    if (survey.maskCapableModels.length > 0) {
        return `${base} 有 ${survey.maskCapableModels.length} 个模型声明了蒙版相关参数，`
            + '值得接原生局部重绘——详见下方标注。';
    }

    return `${base} 按模型自报的参数看，没有任何一个暴露蒙版通道，`
        + '所以局部重绘仍需靠裁剪窗 + 引导图的方案限定区域。';
}
