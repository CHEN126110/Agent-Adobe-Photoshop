type SkillParamDefaultsInput = {
    skillId: string;
    userInput: string;
    mode?: 'inspect' | 'execute' | null;
    params?: Record<string, any>;
};

import { getSkillById } from './skills/skill-declarations';
import { inferSkuIntentParamsFromText } from './sku-intent-params';
import { MAIN_IMAGE_DELIVERY_DOCUMENTS } from './main-image-design-core';

const MAIN_IMAGE_DEFAULT_SIZE_KEYS = MAIN_IMAGE_DELIVERY_DOCUMENTS.map((doc) => doc.folderKey);

function extractFontName(userInput: string): string | undefined {
    const match = String(userInput || '').match(/(?:改成|换成|改为|换为)\s*([^\n，。,.!！?？]+)/i);
    const fontName = String(match?.[1] || '').trim();
    return fontName || undefined;
}

function hasOwnParam(params: Record<string, any>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(params, key);
}

function getDeclaredSkillParamDefaults(skillId: string): Record<string, any> {
    const skill = getSkillById(skillId);
    if (!skill) return {};

    return skill.parameters.reduce<Record<string, any>>((acc, param) => {
        if (param.default === undefined) return acc;
        acc[param.name] = param.default;
        return acc;
    }, {});
}

function buildModeOverrides(input: SkillParamDefaultsInput): Record<string, any> {
    if (input.skillId !== 'detail-page-design' || input.mode !== 'inspect') {
        return {};
    }

    return {
        inspectOnly: true,
        autoFix: false,
        structureMode: 'inspect',
        visualValidation: false
    };
}

function inferMainImageExplicitSize(userInput: string): string | undefined {
    const text = String(userInput || '');
    if (/(^|[^\d])800([^\d]|$)/.test(text)) return '800';
    if (/(^|[^\d])750([^\d]|$)/.test(text)) return '750';
    if (/(^|[^\d])1200([^\d]|$)/.test(text)) return '1200';
    if (/1\s*[:：x×]\s*1|方图|方形/i.test(text)) return '800';
    if (/3\s*[:：x×]\s*4|竖版|竖图/i.test(text)) return '750';
    if (/9\s*[:：x×]\s*16|长竖图|长图/i.test(text)) return '1200';
    return undefined;
}

function inferMainImageType(userInput: string): 'click' | 'conversion' | 'white-bg' | undefined {
    const text = String(userInput || '');
    if (/白底图|白底|white[-\s]?bg|white background/i.test(text)) return 'white-bg';
    const asksClick = /点击图|click/i.test(text);
    const asksConversion = /转化图|conversion/i.test(text);
    if (asksClick && !asksConversion) return 'click';
    if (asksConversion && !asksClick) return 'conversion';
    return undefined;
}

function buildMainImageFallbacks(input: SkillParamDefaultsInput): Record<string, any> {
    const params = input.params && typeof input.params === 'object' ? input.params : {};
    const fallback: Record<string, any> = {};
    const hasSizeParam = hasOwnParam(params, 'size') || hasOwnParam(params, 'sizes');
    const inferredSize = inferMainImageExplicitSize(input.userInput);

    if (!hasSizeParam) {
        if (inferredSize) {
            fallback.size = inferredSize;
        } else {
            fallback.sizes = [...MAIN_IMAGE_DEFAULT_SIZE_KEYS];
        }
    }

    if (!hasOwnParam(params, 'imageType')) {
        const inferredImageType = inferMainImageType(input.userInput);
        if (inferredImageType) {
            fallback.imageType = inferredImageType;
        }
    }

    return fallback;
}

function buildSkillSpecificFallbacks(input: SkillParamDefaultsInput): Record<string, any> {
    const skillId = String(input.skillId || '').trim();
    if (skillId === 'sku-batch') {
        return {
            countPerSize: 5,
            generateNotes: true
        };
    }

    if (skillId === 'main-image-design') {
        return buildMainImageFallbacks(input);
    }

    return {};
}

function buildIntentBoundParams(input: SkillParamDefaultsInput): Record<string, any> {
    const skill = getSkillById(input.skillId);
    if (!skill) return {};

    const params = input.params && typeof input.params === 'object' ? input.params : {};
    const paramNames = new Set(skill.parameters.map((param) => param.name));
    const userInput = String(input.userInput || '').trim();
    const bound: Record<string, any> = {};

    if (paramNames.has('userIntent') && !hasOwnParam(params, 'userIntent')) {
        bound.userIntent = userInput;
    }

    if (paramNames.has('templateIntent') && !hasOwnParam(params, 'templateIntent')) {
        bound.templateIntent = userInput;
    }

    if (input.skillId === 'agent-panel-bridge' && paramNames.has('goal') && !hasOwnParam(params, 'goal')) {
        bound.goal = userInput;
    }

    if (input.skillId === 'text-font-replace' && paramNames.has('fontName') && !String(params.fontName || '').trim()) {
        const inferredFontName = extractFontName(userInput);
        if (inferredFontName) {
            bound.fontName = inferredFontName;
        }
    }

    if (input.skillId === 'sku-batch') {
        const inferred = inferSkuIntentParamsFromText(userInput);

        if (paramNames.has('comboSizes') && !hasOwnParam(params, 'comboSizes') && inferred.comboSizes?.length) {
            bound.comboSizes = inferred.comboSizes;
        }

        if (paramNames.has('countPerSize') && !hasOwnParam(params, 'countPerSize') && typeof inferred.countPerSize === 'number') {
            bound.countPerSize = inferred.countPerSize;
        }

        if (paramNames.has('generateNotes') && !hasOwnParam(params, 'generateNotes')) {
            bound.generateNotes = inferred.generateNotes === true;
        }

        if (paramNames.has('onlyNotes') && !hasOwnParam(params, 'onlyNotes') && inferred.onlyNotes === true) {
            bound.onlyNotes = true;
        }
    }

    return bound;
}

export function applySharedSkillParamDefaults(input: SkillParamDefaultsInput): Record<string, any> {
    const skillId = String(input.skillId || '').trim();
    const params = input.params && typeof input.params === 'object' ? input.params : {};
    const declaredDefaults = getDeclaredSkillParamDefaults(skillId);
    const modeOverrides = buildModeOverrides(input);
    const skillSpecificFallbacks = buildSkillSpecificFallbacks({
        ...input,
        skillId
    });
    const intentBoundParams = buildIntentBoundParams(input);

    return {
        ...declaredDefaults,
        ...modeOverrides,
        ...skillSpecificFallbacks,
        ...params,
        ...intentBoundParams
    };
}
