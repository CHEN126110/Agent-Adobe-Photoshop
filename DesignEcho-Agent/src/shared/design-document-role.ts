import {
    normalizeDesignDimensionSpec,
    type DesignDimensionSpec
} from './design-dimension-spec';
import type { RuntimeDesignWorkMode } from './agent-runtime-v5/contracts';
import { resolveReferenceReplicationOutputIntent } from './reference-replication-output-intent';
import {
    SKU_NAME_BOUNDARY_PATTERN,
    buildCategoryTermPattern,
    type DesignCategoryId
} from './design-category-terms';

// 文档角色判定词条子集（来源 design-category-terms 词条库）：
// name 判定用精确别名（含 detail-page / product\s*detail / main-image），
// task 判定用宽泛词（含 白底图 / 产品详情 / 长详情）。子集声明即该阶段用途说明。
const DOCUMENT_ROLE_NAME_TERMS: Record<DesignCategoryId, readonly string[]> = {
    detailPage: ['详情页', '商品详情', 'detail\\s*page', 'detail-page', 'product\\s*detail'],
    sku: ['色卡', '组合图', '规格图', '自选备注', '备注图'],
    mainImage: ['主图', '点击图', '转化图', 'main\\s*image', 'main-image', 'hero\\s*image'],
    poster: ['海报', '宣传图', '活动图', 'poster'],
    banner: ['banner', '横幅', '店铺头图', '活动横幅'],
    generalArtifact: []
};

export type DesignDocumentRole = 'detailPage' | 'sku' | 'mainImage' | 'poster' | 'banner' | 'unknown';

export type CurrentDocumentUseMode =
    | 'none'
    | 'reuse'
    | 'advisory'
    | 'observe_only'
    | 'protected'
    | 'separate_target';

export interface DesignDocumentRoleContext {
    targetRole: DesignDocumentRole;
    currentRole: DesignDocumentRole;
    currentDocumentName: string;
    currentDocumentUse: CurrentDocumentUseMode;
    canReuseCurrentDocument: boolean;
    shouldObserveCurrentDocument: boolean;
    agentInstruction: string;
}

export interface CreateDocumentTargetBoundaryDecision {
    allowed: boolean;
    code: 'create_document_target_allowed'
        | 'create_document_would_fork_existing_target'
        | 'create_document_target_unresolved';
    message: string;
    nextRequiredTool?: 'listDocuments';
}

export function isCreateDocumentOperation(
    toolName: string,
    params: Record<string, any> = {}
): boolean {
    if (toolName === 'createDocument') return true;
    return toolName === 'document-management'
        && String(params.action || '').trim().toLowerCase() === 'create';
}

export interface UserExplicitDocumentOverrides {
    name?: string;
    width?: number;
    height?: number;
}

export interface DesignDocumentNormalizationOptions {
    canonicalName?: boolean;
    canonicalDimensions?: boolean;
    dimensionSpec?: Partial<DesignDimensionSpec> | null;
    userOverrides?: UserExplicitDocumentOverrides;
}

function normalizePositiveDimension(value: unknown): number | undefined {
    const dimension = Number(value);
    if (!Number.isFinite(dimension) || dimension <= 0) return undefined;
    return Math.round(dimension);
}

/**
 * 只提取用户在本轮文本里明确声明的文档参数。
 * 这些值的优先级高于模型生成参数、角色默认值和用户设置中的默认规范。
 */
export function extractUserExplicitDocumentOverrides(userInput: unknown): UserExplicitDocumentOverrides {
    const text = String(userInput || '').trim();
    if (!text) return {};

    const output: UserExplicitDocumentOverrides = {};
    const dimensionPair = text.match(/(?:尺寸(?:是|为|[:：])?\s*)?(\d{2,5})\s*[x×*]\s*(\d{2,5})(?:\s*(?:px|像素))?/i);
    if (dimensionPair) {
        output.width = normalizePositiveDimension(dimensionPair[1]);
        output.height = normalizePositiveDimension(dimensionPair[2]);
    }

    const explicitWidth = text.match(/(?:画布|文档|图片|图像)?(?:宽度|宽)\s*(?:是|为|[:：])?\s*(\d{2,5})(?:\s*(?:px|像素))?/i);
    const explicitHeight = text.match(/(?:画布|文档|图片|图像)?(?:高度|高)\s*(?:是|为|[:：])?\s*(\d{2,5})(?:\s*(?:px|像素))?/i);
    if (explicitWidth) output.width = normalizePositiveDimension(explicitWidth[1]);
    if (explicitHeight) output.height = normalizePositiveDimension(explicitHeight[1]);

    const quotedName = text.match(/(?:名称|名字|命名)(?:必须)?(?:是|为|叫)?\s*[「『“\"']([^」』”\"'\r\n]{1,80})[」』”\"']/i);
    const plainName = text.match(/(?:名称|名字)(?:必须)?(?:是|为|叫)\s*([^\s，。；,;]{1,80})/i);
    const name = String(quotedName?.[1] || plainName?.[1] || '').trim();
    if (name) output.name = name;

    return output;
}

type ExplicitDocumentRelationTarget = 'current' | 'alternate';
type ExplicitDocumentRelationAction = 'mutate' | 'preserve' | 'create_or_switch';

interface ExplicitDocumentActionRelation {
    target: ExplicitDocumentRelationTarget;
    action: ExplicitDocumentRelationAction;
    polarity: 'affirmed' | 'negated';
    order: number;
}

const CURRENT_DOCUMENT_RELATION_SOURCE = '(?:(?:当前|现在|这个|这份|已打开|打开的)(?:的)?(?:文档|PSD|PSB|文件|图片|图像|画布|画面|稿)|(?:文档|PSD|PSB|文件|图片|图像|画布|画面|稿)(?:当前|现在|打开的)|源稿)';
const ALTERNATE_DOCUMENT_RELATION_SOURCE = '(?:新文档|新画布|新文件|新稿|另一个(?:文档|画布|文件|稿)|副本)';
const DOCUMENT_MUTATION_RELATION_SOURCE = '(?:改动|修改|改|编辑|覆盖|写入|写|操作|处理|碰|动|保存|关闭|继续)';
const DOCUMENT_CONTENT_MUTATION_RELATION_SOURCE = '(?:改动|修改|改|编辑|覆盖|写入|写|操作|处理|碰|动)';
const ALTERNATE_DOCUMENT_WORK_RELATION_SOURCE = '(?:改动|修改|改|编辑|覆盖|写入|写|操作|处理|碰|动|保存|关闭|继续|完成|制作|设计)';
const DOCUMENT_NEGATION_RELATION_SOURCE = '(?:不要|别|禁止|无需|不必|不准|不许|不允许|不可以|不用)';

function splitExplicitDocumentRelationSegments(userInput: string): string[] {
    const segments = String(userInput || '')
        .replace(/\s+/g, '')
        .split(/[，,。！？!?；;\n]+|而是|但是|不过|(?<!因)而(?=继续|直接|改|修改|编辑|处理|新建|另建|创建)/)
        .map((segment) => segment.trim())
        .filter(Boolean);
    return segments.flatMap((segment) => {
        // 无标点的“不要新建文档继续修改当前文档”包含两个方向相反的关系。
        // 在第二个明确动作（继续/直接 + mutation）处切开，避免前一段的否定跨过
        // alternate 对象错误绑定到 current 对象。
        const currentWorkTransition = segment.match(
            /(?:继续|直接)(?:修改|编辑|处理|改动|改|写入|写|操作|碰|动|保存|关闭)[^，,。！？!?；;\n]{0,20}(?:(?:当前|现在|这个|这份|已打开|打开的)(?:的)?(?:文档|PSD|PSB|文件|图片|图像|画布|画面|稿)|源稿)/i
        );
        if (currentWorkTransition && (currentWorkTransition.index ?? 0) > 0) {
            const prefix = segment.slice(0, currentWorkTransition.index);
            const hasAlternateSubject = new RegExp(ALTERNATE_DOCUMENT_RELATION_SOURCE, 'i').test(prefix)
                || /(?:另建|新建|创建|复制|拷贝|另存|切换)/i.test(prefix);
            if (hasAlternateSubject
                && new RegExp(DOCUMENT_NEGATION_RELATION_SOURCE, 'i').test(prefix)) {
                return [prefix, segment.slice(currentWorkTransition.index)].filter(Boolean);
            }
        }
        // “不要修改当前文档另建一张主图”没有标点，但“另建”已经开启了一个新的
        // 文档动作关系。只有前缀明确谈到当前文档，且同时表达保护/禁止修改时才切开，
        // 避免把普通的“不要新建文档”错误拆成肯定的新建请求。
        const alternateTransition = segment.match(
            /(?:另建|新建|创建)|(?:复制|拷贝)(?:一份|一个|一张|一版)?|另存(?:为)?(?:一份|一个版本|新版本)?|切(?:换)?到另一个(?:文档|画布|文件|稿)/i
        );
        if (!alternateTransition || (alternateTransition.index ?? 0) <= 0) return [segment];
        const prefix = segment.slice(0, alternateTransition.index);
        if (!prefix.match(new RegExp(CURRENT_DOCUMENT_RELATION_SOURCE, 'i'))) return [segment];
        const protectsCurrent = hasNegatedDocumentMutationRelation(
            prefix,
            CURRENT_DOCUMENT_RELATION_SOURCE
        ) || Boolean(prefix.match(new RegExp(
            `(?:保持|维持|保留|保护)[^，,。！？!?；;\\n]{0,16}${CURRENT_DOCUMENT_RELATION_SOURCE}[^，,。！？!?；;\\n]{0,12}(?:原样|不变)|${CURRENT_DOCUMENT_RELATION_SOURCE}[^，,。！？!?；;\\n]{0,16}(?:保持|维持|保留|保护)[^，,。！？!?；;\\n]{0,12}(?:原样|不变)`,
            'i'
        )));
        if (!protectsCurrent) return [segment];
        return [prefix, segment.slice(alternateTransition.index)].filter(Boolean);
    });
}

function hasNegatedDocumentMutationRelation(
    segment: string,
    targetSource: string,
    actionSource: string = DOCUMENT_MUTATION_RELATION_SOURCE
): boolean {
    const relations = [
        new RegExp(`${DOCUMENT_NEGATION_RELATION_SOURCE}[^，,。！？!?；;\\n]{0,16}${actionSource}[^，,。！？!?；;\\n]{0,16}${targetSource}`, 'i'),
        new RegExp(`${DOCUMENT_NEGATION_RELATION_SOURCE}[^，,。！？!?；;\\n]{0,12}${targetSource}[^，,。！？!?；;\\n]{0,20}${actionSource}`, 'i'),
        new RegExp(`${targetSource}[^，,。！？!?；;\\n]{0,16}${DOCUMENT_NEGATION_RELATION_SOURCE}[^，,。！？!?；;\\n]{0,12}${actionSource}`, 'i')
    ];
    return relations.some((pattern) => pattern.test(segment));
}

function hasAffirmedDocumentMutationRelation(
    segment: string,
    targetSource: string,
    actionSource: string = DOCUMENT_MUTATION_RELATION_SOURCE
): boolean {
    if (hasNegatedDocumentMutationRelation(segment, targetSource)) return false;
    if (targetSource === CURRENT_DOCUMENT_RELATION_SOURCE
        && /(?:保存|关闭|修改|编辑|处理)(?:状态|记录|历史|风险|影响|结果|情况|流程|方法|说明)$/.test(segment)) {
        return false;
    }
    const relations = [
        new RegExp(`${actionSource}[^，,。！？!?；;\\n]{0,20}${targetSource}`, 'i'),
        new RegExp(`${targetSource}[^，,。！？!?；;\\n]{0,20}${actionSource}`, 'i'),
        new RegExp(`(?:直接)?在${targetSource}(?:上|里|中)?[^，,。！？!?；;\\n]{0,12}${actionSource}`, 'i')
    ];
    return relations.some((pattern) => pattern.test(segment));
}

function extractExplicitDocumentActionRelations(
    userInput: string
): ExplicitDocumentActionRelation[] {
    const relations: ExplicitDocumentActionRelation[] = [];
    const segments = splitExplicitDocumentRelationSegments(userInput);
    segments.forEach((segment, order) => {
        const currentMutationNegated = hasNegatedDocumentMutationRelation(
            segment,
            CURRENT_DOCUMENT_RELATION_SOURCE
        );
        const alternateMutationNegated = hasNegatedDocumentMutationRelation(
            segment,
            ALTERNATE_DOCUMENT_RELATION_SOURCE
        );
        if (currentMutationNegated) {
            relations.push({ target: 'current', action: 'mutate', polarity: 'negated', order });
        } else if (hasAffirmedDocumentMutationRelation(segment, CURRENT_DOCUMENT_RELATION_SOURCE)) {
            relations.push({ target: 'current', action: 'mutate', polarity: 'affirmed', order });
        }
        if (alternateMutationNegated) {
            relations.push({ target: 'alternate', action: 'mutate', polarity: 'negated', order });
        } else if (hasAffirmedDocumentMutationRelation(
            segment,
            ALTERNATE_DOCUMENT_RELATION_SOURCE,
            ALTERNATE_DOCUMENT_WORK_RELATION_SOURCE
        )) {
            relations.push({ target: 'alternate', action: 'mutate', polarity: 'affirmed', order });
        }

        const preservesCurrent = new RegExp(`(?:保持|维持|保留|保护)[^，,。！？!?；;\\n]{0,16}${CURRENT_DOCUMENT_RELATION_SOURCE}[^，,。！？!?；;\\n]{0,12}(?:原样|不变)|${CURRENT_DOCUMENT_RELATION_SOURCE}[^，,。！？!?；;\\n]{0,16}(?:保持|维持|保留|保护)[^，,。！？!?；;\\n]{0,12}(?:原样|不变)`, 'i').test(segment);
        if (preservesCurrent) {
            relations.push({ target: 'current', action: 'preserve', polarity: 'affirmed', order });
        }

        const createOrSwitch = /(?:另建|新建|创建)|(?:复制|拷贝)(?:一份|一个|一张|一版)?|另存(?:为)?(?:一份|一个版本|新版本)?|切(?:换)?到另一个(?:文档|画布|文件|稿)/i;
        const createMatch = segment.match(createOrSwitch);
        if (createMatch) {
            const prefix = segment.slice(0, createMatch.index ?? 0);
            const negated = new RegExp(`${DOCUMENT_NEGATION_RELATION_SOURCE}[^，,。！？!?；;\\n]{0,10}$`, 'i').test(prefix);
            relations.push({
                target: 'alternate',
                action: 'create_or_switch',
                polarity: negated ? 'negated' : 'affirmed',
                order
            });
        }
    });
    return relations;
}

function resolveLatestExplicitDocumentRelation(
    userInput: string,
    target: ExplicitDocumentRelationTarget
): ExplicitDocumentActionRelation | undefined {
    return extractExplicitDocumentActionRelations(userInput)
        .filter((relation) => relation.target === target)
        .sort((left, right) => right.order - left.order)[0];
}

export function hasExplicitCurrentDocumentProtection(userInput: string): boolean {
    const latest = resolveLatestExplicitDocumentRelation(userInput, 'current');
    if (latest?.action === 'preserve' && latest.polarity === 'affirmed') return true;
    if (latest?.action === 'mutate' && latest.polarity === 'negated') {
        const hasContentWriteProtection = splitExplicitDocumentRelationSegments(userInput)
            .some((segment) => hasNegatedDocumentMutationRelation(
                segment,
                CURRENT_DOCUMENT_RELATION_SOURCE,
                DOCUMENT_CONTENT_MUTATION_RELATION_SOURCE
            ));
        if (hasContentWriteProtection) return true;
    }
    const text = String(userInput || '').replace(/\s+/g, '');
    return /do\s*not(?:modify|edit|overwrite)(?:the)?(?:current|open)(?:document|file)/i.test(text);
}

/**
 * 用户是否同时指定了独立交付目标。这里只识别文档关系，不判断业务品类，
 * 也不授予写权限；它用于区分“全程只读”与“保护源稿、在别处继续制作”。
 */
export function hasExplicitAlternateDocumentTarget(userInput: string): boolean {
    const latest = resolveLatestExplicitDocumentRelation(userInput, 'alternate');
    return latest?.polarity === 'affirmed';
}

export function hasExplicitCurrentDocumentReuse(userInput: string): boolean {
    const latest = resolveLatestExplicitDocumentRelation(userInput, 'current');
    if (latest?.action === 'mutate' && latest.polarity === 'affirmed') return true;
    const text = String(userInput || '').replace(/\s+/g, '');
    return /(?:modify|edit|continuein|workin)(?:the)?(?:current|open)(?:document|file)/i.test(text);
}

function hasExplicitCurrentSelectionReuse(userInput: string): boolean {
    const text = String(userInput || '').replace(/\s+/g, '');
    if (!text) return false;
    const editVerb = '(?:修改|编辑|替换|调整|优化|改写|重写|处理|改成|换成)';
    const selectedTarget = '(?:(?:当前|现在|刚才|已)?(?:选中|选择|选定)(?:的)?(?:图层组|图层|文字|文本|文案|标题|内容|元素|对象|区域|模块))';
    return new RegExp(`${editVerb}.{0,24}${selectedTarget}`, 'i').test(text)
        || new RegExp(`${selectedTarget}.{0,24}${editVerb}`, 'i').test(text)
        || /(?:modify|edit|replace|rewrite|adjust)(?:the)?(?:current|currently)?selected(?:layer|text|copy|element)/i.test(text);
}

function resolveCurrentDocumentUseMode(input: {
    userInput: string;
    currentDocumentName: string;
    hasCurrentDocument?: boolean;
    workMode?: RuntimeDesignWorkMode;
}): CurrentDocumentUseMode {
    if (!input.currentDocumentName && input.hasCurrentDocument !== true) return 'none';
    if (hasExplicitCurrentDocumentProtection(input.userInput)) return 'protected';
    if (input.workMode === 'create_new') return 'separate_target';
    if (input.workMode === 'edit_existing'
        || input.workMode === 'template_fill'
        || input.workMode === 'export_only') {
        return 'reuse';
    }
    if (input.workMode === 'analyze_only') return 'observe_only';
    if (hasExplicitCurrentSelectionReuse(input.userInput)) return 'reuse';
    if (hasExplicitCurrentDocumentReuse(input.userInput)) return 'reuse';

    // 品类词、文件名和多交付物命中都只是 Planner 的导航线索，不能成为文档权限来源。
    // 未收到显式用户目标或结构化 workMode 时保持 advisory：允许观察，也允许模型基于
    // documentId、revision 与真实文档状态选择继续当前文档、切换或新建。
    return 'advisory';
}

function buildDocumentRoleInstruction(input: {
    targetRole: DesignDocumentRole;
    targetRoles: DesignDocumentRole[];
    currentRole: DesignDocumentRole;
    currentDocumentName: string;
    currentDocumentUse: CurrentDocumentUseMode;
}): string {
    const targetLabel = formatDesignDocumentRole(input.targetRole);
    const targetRolesLabel = input.targetRoles.length > 1
        ? input.targetRoles.map(formatDesignDocumentRole).join('、')
        : targetLabel;
    const currentLabel = formatDesignDocumentRole(input.currentRole);
    const currentDocumentLabel = input.currentDocumentName || '未命名文档';
    const hasMultipleLexicalRoles = input.targetRoles.length > 1;

    if (input.currentDocumentUse === 'protected') {
        return `用户明确要求保护当前打开的 ${currentLabel} 文档「${currentDocumentLabel}」。可以只读观察它以取得完成任务所需的事实，但禁止修改、保存或关闭这份源文档；取得必要事实后，请创建或切换到另一个目标文档再执行写入或导出。`;
    }
    if (input.currentDocumentUse === 'separate_target') {
        if (hasMultipleLexicalRoles) {
            return `结构化 workMode 要求建立新的交付目标，但任务文本同时涉及多类视觉产物（${targetRolesLabel}）。这些词法角色不能决定当前要创建哪一类文档；请按已绑定的 TaskPlan / Manifest 处理当前交付节点，并用真实 documentId 与 revision 绑定新目标。`;
        }
        return `结构化 workMode 要求建立新的交付目标。当前打开的是 ${currentLabel} 文档「${currentDocumentLabel}」；请先创建新文档，并以实际 documentId 与 revision 确认后续写入目标。${targetLabel === '未知' ? '' : `“${targetLabel}”只作为默认命名与设计规划提示。`}`;
    }
    if (input.currentDocumentUse === 'reuse') {
        if (hasMultipleLexicalRoles) {
            return `用户明确指定当前打开的文档「${currentDocumentLabel}」或其中当前选中的内容参与本轮处理，但任务文本同时涉及多类视觉产物（${targetRolesLabel}）。不要把第一个品类词当成唯一交付目标；请结合 TaskPlan、当前 documentId/revision 与真实图层事实判断当前节点。`;
        }
        if (input.targetRole === 'unknown') {
            return `用户明确指定当前打开的 ${currentLabel} 文档「${currentDocumentLabel}」或其中当前选中的内容为写入目标。请继续在这个文档中定位并修改，不要另建文档。`;
        }
        return `目标是${targetLabel}文档，当前打开的是 ${currentLabel} 文档「${currentDocumentLabel}」，可以作为当前目标文档继续处理。`;
    }
    if (input.currentDocumentUse === 'observe_only') {
        return `结构化 workMode 是 analyze_only。当前打开的 ${currentLabel} 文档「${currentDocumentLabel}」只能作为只读上下文；不要修改、保存或导出。`;
    }
    if (input.currentDocumentUse === 'advisory') {
        let roleHint = '任务文本与当前文件名没有提供可靠的结构化目标身份';
        if (input.targetRoles.length > 1) {
            roleHint = `任务文本可能涉及多类交付物（${targetRolesLabel}）`;
        } else if (input.targetRole !== 'unknown' || input.currentRole !== 'unknown') {
            roleHint = `任务文本可能指向${targetLabel}，当前文件名可能指向${currentLabel}`;
        }
        return `${roleHint}。这些词法识别结果只用于规划和默认命名，不授予也不撤销写权限；请结合当前 documentId、revision、图层事实与用户目标，自主决定继续当前文档、切换文档或新建文档。`;
    }
    if (hasMultipleLexicalRoles) {
        return `当前没有打开文档，任务文本同时涉及多类视觉产物（${targetRolesLabel}）。这些词法角色只用于规划，不能把第一个品类词当成唯一目标；请先依据用户交付目标或已绑定 Manifest 确定当前节点，再创建对应文档。`;
    }
    if (input.targetRole === 'unknown') {
        return '当前没有可识别的目标文档角色。请先根据用户任务判断要处理的是详情页、SKU、主图还是其他设计产物。';
    }
    return `目标是${targetLabel}文档；当前没有打开文档，请创建名称属于${targetLabel}的文档后再写入。`;
}

export function inferDesignDocumentRoleFromName(documentName: string): DesignDocumentRole {
    const name = String(documentName || '').trim().toLowerCase();
    if (!name) return 'unknown';

    if (new RegExp(buildCategoryTermPattern('detailPage', { subset: DOCUMENT_ROLE_NAME_TERMS.detailPage })).test(name)) {
        return 'detailPage';
    }

    if (new RegExp(SKU_NAME_BOUNDARY_PATTERN).test(name)) {
        return 'sku';
    }

    if (new RegExp(buildCategoryTermPattern('mainImage', { subset: DOCUMENT_ROLE_NAME_TERMS.mainImage })).test(name)) {
        return 'mainImage';
    }

    if (new RegExp(buildCategoryTermPattern('poster', { subset: DOCUMENT_ROLE_NAME_TERMS.poster })).test(name)) {
        return 'poster';
    }

    if (new RegExp(buildCategoryTermPattern('banner', { subset: DOCUMENT_ROLE_NAME_TERMS.banner })).test(name)) {
        return 'banner';
    }

    return 'unknown';
}

export function inferDesignDocumentRoleFromTaskText(userInput: string): DesignDocumentRole {
    const roles = inferDesignDocumentRolesFromTaskText(userInput);
    return roles[0] || 'unknown';
}

/**
 * 从任务文本推断全部命中的交付物角色（支持多交付物任务）。
 *
 * 多角色集合仅供 Planner 理解任务、生成默认名称和组织交付物；它不是写权限或文档绑定依据。
 *
 * 复刻类输出意图（resolveReferenceReplicationOutputIntent）保持单一角色语义，
 * 不进本集合——参考来源不是交付物身份，输出角色由输出意图契约唯一决定。
 */
export function inferDesignDocumentRolesFromTaskText(userInput: string): DesignDocumentRole[] {
    const text = String(userInput || '').trim();
    if (!text) return [];
    if (/参考|复刻|仿照|照着|还原|复现|同款|临摹/i.test(text)) {
        const referenceOutput = resolveReferenceReplicationOutputIntent({ userIntent: text });
        if (referenceOutput.artifactKind !== 'generic') {
            return [referenceOutput.documentRole];
        }
    }
    const roles: DesignDocumentRole[] = [];
    const push = (role: DesignDocumentRole): void => {
        if (!roles.includes(role)) roles.push(role);
    };
    const taskDetailPageTerms = ['详情页', '商品详情', '产品详情', '详情长图', '长详情', 'detail\\s*page'];
    const taskSkuTerms = ['色卡', '组合图', '规格图', '自选备注', '备注图'];
    const taskMainImageTerms = ['主图', '点击图', '转化图', '白底图', 'main\\s*image', 'hero\\s*image'];
    if (new RegExp(buildCategoryTermPattern('poster')).test(text)) push('poster');
    if (new RegExp(buildCategoryTermPattern('banner')).test(text)) push('banner');
    if (new RegExp(buildCategoryTermPattern('detailPage', { subset: taskDetailPageTerms })).test(text)) push('detailPage');
    if (new RegExp(
        `${SKU_NAME_BOUNDARY_PATTERN}|${buildCategoryTermPattern('sku', { subset: taskSkuTerms })}`,
        'i'
    ).test(text)) push('sku');
    if (new RegExp(buildCategoryTermPattern('mainImage', { subset: taskMainImageTerms })).test(text)) push('mainImage');
    return roles;
}

export function isKnownNonDetailPageRole(role: DesignDocumentRole): boolean {
    return role === 'sku' || role === 'mainImage' || role === 'poster' || role === 'banner';
}

export function formatDesignDocumentRole(role: DesignDocumentRole): string {
    if (role === 'detailPage') return '详情页';
    if (role === 'sku') return 'SKU';
    if (role === 'mainImage') return '主图';
    if (role === 'poster') return '海报';
    if (role === 'banner') return '横幅';
    return '未知';
}

export function buildDesignDocumentRoleContext(input: {
    userInput?: unknown;
    currentDocumentName?: unknown;
    hasCurrentDocument?: boolean;
    workMode?: RuntimeDesignWorkMode;
}): DesignDocumentRoleContext {
    const userInput = String(input.userInput || '');
    const currentDocumentName = String(input.currentDocumentName || '').trim();
    const targetRoles = inferDesignDocumentRolesFromTaskText(userInput);
    const hasUnresolvedGeneralArtifact = new RegExp(
        buildCategoryTermPattern('generalArtifact'),
        'i'
    ).test(userInput);
    // 多角色可能表示多个交付物，也可能只是“用详情页素材做主图”这样的来源→目标关系。
    // “首图 / 封面”等通用产物也可能与来源品类同时出现；在没有结构化 TaskPlan /
    // Manifest 前，不能把唯一命中的来源词升级成目标文档身份。
    const targetRole = targetRoles.length === 1 && !hasUnresolvedGeneralArtifact
        ? targetRoles[0]
        : 'unknown';
    const currentRole = inferDesignDocumentRoleFromName(currentDocumentName);
    const currentDocumentUse = resolveCurrentDocumentUseMode({
        userInput,
        currentDocumentName,
        hasCurrentDocument: input.hasCurrentDocument,
        workMode: input.workMode
    });
    const canReuseCurrentDocument = currentDocumentUse === 'reuse'
        || currentDocumentUse === 'advisory';
    const shouldObserveCurrentDocument = currentDocumentUse === 'reuse'
        || currentDocumentUse === 'advisory'
        || currentDocumentUse === 'observe_only'
        || currentDocumentUse === 'protected';
    const agentInstruction = buildDocumentRoleInstruction({
        targetRole,
        targetRoles,
        currentRole,
        currentDocumentName,
        currentDocumentUse
    });

    return {
        targetRole,
        currentRole,
        currentDocumentName,
        currentDocumentUse,
        canReuseCurrentDocument,
        shouldObserveCurrentDocument,
        agentInstruction
    };
}

/**
 * 新建文档只能建立一个尚未绑定的交付目标，不能用来逃避既有目标上的定位或写入失败。
 * 这里消费已经解析好的文档角色，不读取模型提供的“确认”布尔值。
 */
export function evaluateCreateDocumentTargetBoundary(
    context: DesignDocumentRoleContext
): CreateDocumentTargetBoundaryDecision {
    if (context.currentDocumentUse === 'reuse') {
        return {
            allowed: false,
            code: 'create_document_would_fork_existing_target',
            message: `本任务的写入目标已经绑定到当前文档「${context.currentDocumentName || '未命名文档'}」。新建文档会把同一任务分叉到错误画布，已阻止；请继续定位并修改原目标。`
        };
    }
    // 只有显式用户目标或结构化复用模式会进入 reuse。advisory 的品类/文件名提示、
    // analyze_only 的只读上下文与 create_new 的独立目标都不在这里猜测绑定关系；
    // 已绑定目标的防分叉由上面的 reuse 分支负责。
    return {
        allowed: true,
        code: 'create_document_target_allowed',
        message: '当前任务允许建立独立目标文档。'
    };
}

export function normalizeCreateDocumentParamsForDesignRole(
    role: DesignDocumentRole,
    params: Record<string, any> = {},
    options: DesignDocumentNormalizationOptions = {}
): Record<string, any> {
    const next = { ...(params || {}) };
    const dimensionSpec = normalizeDesignDimensionSpec(options.dimensionSpec);
    const userOverrides = options.userOverrides || {};
    if (userOverrides.name) next.name = userOverrides.name;
    if (userOverrides.width) next.width = userOverrides.width;
    if (userOverrides.height) next.height = userOverrides.height;
    if (role === 'detailPage') {
        if (!userOverrides.name && (options.canonicalName || !String(next.name || '').trim())) {
            next.name = '详情页';
        }
        if (!String(next.preset || '').trim()) next.preset = 'detail-page';
        if (!userOverrides.width && options.canonicalDimensions) {
            next.width = dimensionSpec.detailPage.baseWidth;
        }
    } else if (role === 'sku') {
        if (!userOverrides.name && (options.canonicalName || !String(next.name || '').trim())) {
            next.name = 'SKU';
        }
    } else if (role === 'mainImage') {
        if (!userOverrides.name && (options.canonicalName || !String(next.name || '').trim())) {
            next.name = '主图';
        }
        if (!String(next.preset || '').trim()) next.preset = 'main-image';
        if (!userOverrides.width && options.canonicalDimensions) {
            next.width = dimensionSpec.mainImage.width;
        }
        if (!userOverrides.height && options.canonicalDimensions) {
            next.height = dimensionSpec.mainImage.height;
        }
    } else if (role === 'poster' || role === 'banner') {
        if (!userOverrides.name && (options.canonicalName || !String(next.name || '').trim())) {
            next.name = role === 'poster' ? '海报' : '横幅';
        }
    }
    return next;
}

export function normalizeLayoutParamsForDesignRole(
    role: DesignDocumentRole,
    params: Record<string, any> = {},
    options: DesignDocumentNormalizationOptions = {}
): Record<string, any> {
    const next = { ...(params || {}) };
    const dimensionSpec = normalizeDesignDimensionSpec(options.dimensionSpec);
    const userOverrides = options.userOverrides || {};
    const canvas = next.canvas && typeof next.canvas === 'object' && !Array.isArray(next.canvas)
        ? { ...next.canvas }
        : {};
    if (role === 'detailPage' && options.canonicalDimensions) {
        canvas.width = userOverrides.width || dimensionSpec.detailPage.baseWidth;
        if (userOverrides.height) canvas.height = userOverrides.height;
    } else if (role === 'mainImage' && options.canonicalDimensions) {
        canvas.width = userOverrides.width || dimensionSpec.mainImage.width;
        canvas.height = userOverrides.height || dimensionSpec.mainImage.height;
    } else {
        if (userOverrides.width) canvas.width = userOverrides.width;
        if (userOverrides.height) canvas.height = userOverrides.height;
    }
    if (Object.keys(canvas).length > 0) {
        next.canvas = canvas;
    }
    return next;
}
