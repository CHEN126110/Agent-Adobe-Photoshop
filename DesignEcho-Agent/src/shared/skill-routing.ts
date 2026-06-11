import { getSkillById, SKILL_REGISTRY } from './skills/skill-declarations';
import type { SkillDeclaration } from './types/skill.types';

export interface SkillRoutingIntentMatch {
    skillId: string;
    mode?: string;
}

export interface FindSkillRoutingIntentOptions {
    excludeSkillIds?: string[];
    includeVisibilities?: SkillDeclaration['visibility'][];
}

export const SKILL_ID_ALIASES: Record<string, string> = {
    'main-image': 'main-image-design',
    'main-image-template': 'main-image-template-authoring',
    'detail-page': 'detail-page-design',
    'detail-page-template': 'detail-page-template-authoring',
    'text-font': 'text-font-replace',
    'document': 'document-management',
    'layer': 'layer-management',
    'layers': 'layer-management',
    'sku-setup': 'sku-config',
    'agent-panel': 'agent-panel-bridge',
    'save-template': 'save-current-template',
    'template-save': 'save-current-template'
};

export function normalizeSkillId(skillId?: string): string | undefined {
    const value = String(skillId || '').trim();
    if (!value) return undefined;
    return SKILL_ID_ALIASES[value] || value;
}

export function normalizeRoutingText(text?: string): string {
    return String(text || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
}

function compactRoutingText(text?: string): string {
    return normalizeRoutingText(text).replace(/\s+/g, '');
}

const DOCUMENT_TARGET_PATTERNS = [
    /(?:切换到|切到|切回|切换回)\s*([^\n，。!！？?]+?)\s*(?:文档|文件)?(?:并且|然后|$)/i,
    /(?:关闭|关掉)\s*([^\n，。!！？?]+?)\s*(?:文档|文件)?(?:不保存|别保存|不要保存|保存后关闭|先保存再关闭|并且|然后|$)/i
];

const DOCUMENT_SAVE_FALSE_PATTERNS = [
    /不保存/i,
    /别保存/i,
    /不要保存/i,
    /without saving/i
];

const DOCUMENT_SAVE_TRUE_PATTERNS = [
    /保存后关闭/i,
    /保存并关闭/i,
    /先保存再关闭/i,
    /save and close/i,
    /close after saving/i
];

const DOCUMENT_SAVE_FORMATS = ['psd', 'psb', 'png', 'jpg', 'jpeg', 'tif', 'tiff', 'pdf'];
const DOCUMENT_CREATE_PATTERNS = [
    /(?:新建|创建|建立|create)(?!的).{0,24}(?:文档|文件|画布|document|canvas)/i,
    /(?:文档|文件|画布|document|canvas).{0,24}(?:新建|创建|建立|create)/i
];

function trimRoutingCapture(value?: string): string {
    return String(value || '')
        .trim()
        .replace(/^[`"'“”‘’]+|[`"'“”‘’]+$/g, '')
        .replace(/[.,，。!！？?]+$/g, '')
        .trim();
}

export function sanitizeDocumentTarget(value: string): string | undefined {
    const trimmed = trimRoutingCapture(value);
    if (!trimmed) return undefined;
    if (/^(文档|当前文档|当前打开(?:的)?文档|当前打开|当前|这个文档|该文档|这个文件|该文件|这个psd|当前这个psd|当前这个文档)$/i.test(trimmed)) {
        return undefined;
    }
    return trimmed;
}

function extractDocumentTarget(text: string): string | undefined {
    for (const pattern of DOCUMENT_TARGET_PATTERNS) {
        const match = String(text || '').match(pattern);
        const target = sanitizeDocumentTarget(String(match?.[1] || ''));
        if (target) return target;
    }
    return undefined;
}

function inferCloseSavePreference(text: string): boolean | undefined {
    if (DOCUMENT_SAVE_FALSE_PATTERNS.some((pattern) => pattern.test(text))) {
        return false;
    }
    if (DOCUMENT_SAVE_TRUE_PATTERNS.some((pattern) => pattern.test(text))) {
        return true;
    }
    return undefined;
}

function extractCreateDocumentParams(text: string): Record<string, any> {
    const params: Record<string, any> = {};
    const sizeMatch = String(text || '').match(/(\d{2,5})\s*[x×*]\s*(\d{2,5})/i);
    if (sizeMatch) {
        const width = Number(sizeMatch[1]);
        const height = Number(sizeMatch[2]);
        if (Number.isFinite(width) && width > 0) params.width = width;
        if (Number.isFinite(height) && height > 0) params.height = height;
    }

    const nameMatch = String(text || '').match(/(?:名字叫|名称叫|命名为|名称为|名称|名字|叫做|叫)\s*[:：=]?\s*([^\n，。!！？?]+)/i);
    const name = trimRoutingCapture(String(nameMatch?.[1] || '')).replace(/\s*的文档$/i, '').trim();
    if (name) {
        params.name = name;
    }

    const presetMatch = String(text || '').match(/(?:预设|preset)\s*([^\n，。!！？?]+)/i);
    const preset = trimRoutingCapture(String(presetMatch?.[1] || ''));
    if (preset) {
        params.preset = preset;
    }

    return params;
}

function isDocumentCreateIntentText(text: string): boolean {
    return DOCUMENT_CREATE_PATTERNS.some((pattern) => pattern.test(text));
}

function normalizeSaveFormat(format?: string): string | undefined {
    const value = String(format || '').trim().toLowerCase();
    if (!value) return undefined;
    if (value === 'tif') return 'tiff';
    if (DOCUMENT_SAVE_FORMATS.includes(value)) return value;
    return undefined;
}

function inferDocumentSaveFormat(text: string): string | undefined {
    const value = String(text || '');
    const extensionMatch = value.match(/\.(psd|psb|png|jpe?g|tiff?|pdf)\b/i);
    const fromExtension = normalizeSaveFormat(extensionMatch?.[1]);
    if (fromExtension) return fromExtension;

    if (/\bpsb\b/i.test(value) || /大型文档/i.test(value)) return 'psb';
    if (/\bpsd\b/i.test(value) || /PSD/i.test(value)) return 'psd';
    if (/\bpng\b/i.test(value)) return 'png';
    if (/\b(?:jpg|jpeg)\b/i.test(value)) return 'jpg';
    if (/\b(?:tif|tiff)\b/i.test(value)) return 'tiff';
    if (/\bpdf\b/i.test(value)) return 'pdf';
    return undefined;
}

function extractExplicitSavePath(text: string): string | undefined {
    const value = String(text || '');
    const quotedMatch = value.match(/["“”'‘’]([^"“”'‘’\n]+\.(?:psd|psb|png|jpe?g|tiff?|pdf))["“”'‘’]/i);
    const quotedPath = trimRoutingCapture(String(quotedMatch?.[1] || ''));
    if (quotedPath) return quotedPath;

    const windowsPathMatch = value.match(/[a-zA-Z]:[\\/][^\n，。!！？?]+?\.(?:psd|psb|png|jpe?g|tiff?|pdf)/i);
    const windowsPath = trimRoutingCapture(String(windowsPathMatch?.[0] || ''));
    if (windowsPath) return windowsPath;

    return undefined;
}

function extractSaveDocumentParams(text: string): Record<string, any> {
    const params: Record<string, any> = {};
    const value = String(text || '');
    const format = inferDocumentSaveFormat(text);
    if (format) {
        params.format = format;
    }

    const path = extractExplicitSavePath(text);
    if (path) {
        params.path = path;
        params.saveAs = true;
        const pathFormat = inferDocumentSaveFormat(path);
        if (pathFormat) params.format = pathFormat;
    } else if (/保存到项目|项目(?:的)?\s*(?:PSD|psd)|另存|导出|export|save as/i.test(value)) {
        params.saveAs = true;
    }

    if (/项目(?:的)?\s*(?:PSD|psd)|(?:PSD|psd)\s*(?:中|目录|文件夹)/i.test(value)) {
        params.projectSubdir = 'PSD';
        params.saveAs = true;
        if (!params.format) params.format = 'psd';
    }

    return params;
}

export function extractDocumentManagementRoutingParams(
    text: string,
    action?: string
): Record<string, any> {
    const normalizedAction = String(action || '').trim().toLowerCase();
    if (!normalizedAction) return {};

    const params: Record<string, any> = { action: normalizedAction };

    if (normalizedAction === 'switch' || normalizedAction === 'close') {
        const documentName = extractDocumentTarget(text);
        if (documentName) {
            params.documentName = documentName;
        }
    }

    if (normalizedAction === 'close') {
        const save = inferCloseSavePreference(text);
        if (typeof save === 'boolean') {
            params.save = save;
        }
    }

    if (normalizedAction === 'save') {
        Object.assign(params, extractSaveDocumentParams(text));
    }

    if (normalizedAction === 'create') {
        Object.assign(params, extractCreateDocumentParams(text));
    }

    return params;
}

export function textContainsRoutingSignal(text: string, signal: string): boolean {
    const rawSignal = String(signal || '').trim();
    if (rawSignal.startsWith('regex:')) {
        const source = rawSignal.slice('regex:'.length).trim();
        if (!source) return false;
        try {
            return new RegExp(source, 'i').test(normalizeRoutingText(text));
        } catch {
            return false;
        }
    }

    const normalizedSignal = normalizeRoutingText(signal);
    if (!normalizedSignal) return false;

    const normalizedText = normalizeRoutingText(text);
    const compactText = compactRoutingText(text);
    const compactSignal = compactRoutingText(signal);

    return normalizedText.includes(normalizedSignal)
        || (!!compactSignal && compactText.includes(compactSignal));
}

export function textContainsAnyRoutingSignal(text: string, signals?: string[]): boolean {
    if (!Array.isArray(signals) || signals.length === 0) return false;
    return signals.some((signal) => textContainsRoutingSignal(text, signal));
}

export function textMatchesAllRoutingSignalGroups(text: string, signalGroups?: string[][]): boolean {
    if (!Array.isArray(signalGroups) || signalGroups.length === 0) return false;

    return signalGroups.every((group) => (
        Array.isArray(group)
        && group.length > 0
        && textContainsAnyRoutingSignal(text, group)
    ));
}

export function matchesSkillRoutingIntent(skillId: string, text: string): boolean {
    if (normalizeSkillId(skillId) === 'document-management' && isDocumentCreateIntentText(text)) {
        return true;
    }

    const skill = getSkillById(skillId);
    const routing = skill?.routing;
    const hasGroupedSignals = Array.isArray(routing?.intentSignalGroups) && routing.intentSignalGroups.length > 0;
    const hasIntentSignals = Array.isArray(routing?.intentSignals) && routing.intentSignals.length > 0;

    if (!hasGroupedSignals && !hasIntentSignals) return false;

    if (hasGroupedSignals) {
        if (!textMatchesAllRoutingSignalGroups(text, routing?.intentSignalGroups)) {
            return false;
        }
    } else if (!textContainsAnyRoutingSignal(text, routing?.intentSignals)) {
        return false;
    }

    if (textContainsAnyRoutingSignal(text, routing.negativeSignals)) {
        return false;
    }

    return true;
}

export function findSkillRoutingIntent(
    text: string,
    options: FindSkillRoutingIntentOptions = {}
): SkillRoutingIntentMatch | undefined {
    const includeVisibilities = new Set(options.includeVisibilities || ['user-facing']);
    const excludeSkillIds = new Set(
        (options.excludeSkillIds || [])
            .map((skillId) => normalizeSkillId(skillId))
            .filter((skillId): skillId is string => Boolean(skillId))
    );

    for (const skill of SKILL_REGISTRY) {
        const skillId = normalizeSkillId(skill.id);
        if (!skillId || excludeSkillIds.has(skillId)) continue;
        if (!includeVisibilities.has(skill.visibility)) continue;
        if (!matchesSkillRoutingIntent(skillId, text)) continue;

        return {
            skillId,
            mode: resolveSkillRoutingMode(skillId, text)
        };
    }

    return undefined;
}

export function resolveSkillRoutingMode(skillId: string, text: string): string | undefined {
    if (normalizeSkillId(skillId) === 'document-management' && isDocumentCreateIntentText(text)) {
        return 'create';
    }

    const skill = getSkillById(skillId);
    const modeSignals = skill?.routing?.modeSignals;
    if (!modeSignals || typeof modeSignals !== 'object') return undefined;

    for (const [mode, signals] of Object.entries(modeSignals)) {
        if (textContainsAnyRoutingSignal(text, signals)) {
            return mode;
        }
    }

    return undefined;
}
