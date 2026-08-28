export type SkuIntentParams = {
    stage?: SkuSkillStage;
    comboSizes?: number[];
    countPerSize?: number;
    generateNotes?: boolean;
    onlyNotes?: boolean;
    sourceOnly?: boolean;
};

export type SkuSkillStage = 'full' | 'color-card' | 'template' | 'config';

/**
 * SKU Skill 在项目没有声明生产规格时使用的可撤回草稿规格。
 *
 * 这是当前 SKU Skill 的生产默认，不是通用 Agent / Harness 规则，也不是项目或用户
 * 已确认的业务事实。执行结果必须保留 draft provenance，并在正式发布前复核。
 */
export const SKU_FULL_PRODUCTION_DRAFT_COMBO_SIZES = Object.freeze([2, 3, 4]) as readonly number[];

type SkuDirectiveResourceScope = 'current_work' | 'external_readonly';

import { buildCategoryTermPattern } from './design-category-terms';

const SKU_DOMAIN_TERM_PATTERN = new RegExp(buildCategoryTermPattern('sku', {
    subset: [
        'SKU',
        'sku',
        'SKU\\s*备注',
        'sku\\s*备注',
        '规格备注',
        '自选备注',
        '备注图',
        '组合图',
        'SKU组合',
        'sku组合',
        '批量配色',
        '批量出图',
        '批量生成',
        '双装',
        '单双(?:装)?',
        '一\\s*双(?:装)?',
        '\\d{1,2}\\s*双'
    ],
    wrap: true
}));
// 礼貌词与愿望表达不是业务执行动作。“帮我打开 SKU”里的“帮我”不能把文档导航
// 升级成 SKU 批量生产；真正执行仍需命中做/生成/导出等可交付动作。
const SKU_EXECUTION_ACTION_PATTERN = /(?:再做|再生成|补|补一下|补充|做|完成|创建|新建|建立|整理|生成|制作|设计|修复|调整|修改|优化|处理|跑|出图|导出|批量生成|批量出图|开始|执行)/i;
const SKU_CONVERSATION_ONLY_DIRECTIVE_PATTERN = /(?:只|仅|先只)[^。！？!?；;\n]{0,12}(?:说明|解释|回答|分析|理解|描述|总结|复盘|聊聊|说说)/i;
const SKU_NEGATED_CONVERSATION_ONLY_DIRECTIVE_PATTERN = /(?:不要|别|不能|不应|并非|不是|禁止)[^，,。！？!?；;\n]{0,6}(?:只|仅|先只)[^，,。！？!?；;\n]{0,12}(?:说明|解释|回答|分析|理解|描述|总结|复盘|聊聊|说说)/i;
// 这里只识别“本轮不执行/不使用任何工具”。精确禁用 Skill 或 Photoshop 域由
// AgentCapabilityConstraint 收窄 provider，不得把完整 SKU 任务扩大成不可执行。
const SKU_TOOL_FORBIDDEN_DIRECTIVE_PATTERN = /(?:不要|别|先别|不需要|无需|禁止|不执行|不调用|不用)[^，,。！？!?；;\n]{0,18}(?:执行|调用|使用|跑|操作|改动|修改|写入|生成|导出|处理|工具)/i;
const SKU_COMPLETION_SCOPED_REPORTING_PATTERN = /(?:完成后|做完后|生成后|导出后|保存后|读回后|验收后)[^。！？!?；;\n]{0,64}(?:只|仅)[^。！？!?；;\n]{0,12}(?:说明|回答|汇报|告诉|描述|总结)/i;
const SKU_CURRENT_WORK_RESOURCE_SCOPE_PATTERN = /(?:当前|本次|本轮|正在编辑(?:的)?|已打开(?:的)?).{0,12}(?:项目|photoshop|ps|文档|画布)/i;
const SKU_EXTERNAL_READ_ONLY_RESOURCE_SCOPE_PATTERN = /(?:(?:只|仅)?(?:作为|用作|当作).{0,16}(?:只读)?(?:验证集|参考集|参考目录|参考项目|对照集|对照目录|对照项目)|(?:验证集|参考集|参考目录|参考项目|对照集|对照目录|对照项目).{0,16}(?:只读|仅供参考|只作参考|只用于验证)|只读.{0,8}(?:验证集|参考集|参考目录|参考项目|对照集|对照目录|对照项目))/i;
const SKU_EXTERNAL_RESOURCE_TARGET_PATTERN = /(?:(?:该|此|上述|这个|那个)(?:目录|路径|文件夹|项目|验证集|参考集|素材|资源|文档)|其中|其内|该处|此处)/i;
const SKU_PLANNING_OR_KNOWLEDGE_PATTERN = /[?？]|(?:怎么|如何|为什么|是否|能不能|能否|可不可以|可以吗|应该|方案|规划|计划|进度|还差|还缺|还剩|剩余|了解|聊聊|分析(?:一下)?|盘点|评估|可行性|建议|说明|讲解|检查|审查|审核|边界|流程|是什么|做法|最佳实践)/i;
const SKU_IMMEDIATE_EXECUTION_PATTERN = /(?:直接|马上|现在|立即)/i;
const SKU_STAGED_EXECUTION_PATTERN = /(?:先|先把|先帮我).{0,32}(?:确认|查看|检查|分析|理解|看).{0,48}(?:再|然后).{0,48}(?:整理|执行|生成|制作|做|导出|出图)|(?:完成后|做完后|生成后|导出后).{0,32}(?:读回|检查|验收|说明哪些文件|说明结果)/i;
const SKU_DOWNSTREAM_CONTEXT_PATTERN = /(?:后续会接到|后续会接入|后续接到|后续接入|后续会|后续再|后续|之后会|之后再|之后|后面会|后面再|后面|接下来会|接下来再)[^。！？!?；;\n]*/gi;
const SKU_COMBO_CONFIRMATION_CARD_PATTERN = /(?:组合候选|候选组合|确认卡片|卡片.{0,12}确认|让我确认|确认.{0,16}(?:SKU|sku)?.{0,16}组合|(?:SKU|sku)?.{0,16}组合.{0,16}确认)/i;
const SKU_READ_ONLY_INSPECTION_PATTERN = /(?:(?:查看|看看|看一下|检查|检查一下|识别|分析|理解|统计|列出|读取|获取).{0,20}(?:SKU|sku|自选备注|备注图|组合图).{0,24}(?:配置|素材|文件|文档|颜色|颜色组合|规格|规格组合|组合|数量|占位符|占位组|目录|结构)?|(?:SKU|sku|自选备注|备注图|组合图).{0,24}(?:配置|素材|文件|文档|颜色|颜色组合|规格|规格组合|组合|数量|占位符|占位组|目录|结构).{0,20}(?:查看|看看|看一下|检查|检查一下|识别|分析|理解|统计|列出|读取|获取)|(?:SKU|sku|自选备注|备注图|组合图).{0,24}(?:有哪些|有什么))/i;
const SKU_READ_ONLY_EXECUTION_NEGATIVE_PATTERN = /(?:做|生成|制作|设计|修复|调整|修改|处理|跑|出图|导出|批量生成|批量出图|开始|执行|创建|新建|建立|整理|准备|完成|交付|产出).{0,24}(?:SKU|sku|自选备注|备注图|组合图|色卡素材|排版模板|卡片模板|色卡模板|占位符|占位组)|(?:SKU|sku|自选备注|备注图|组合图|色卡素材|排版模板|卡片模板|色卡模板|占位符|占位组).{0,24}(?:做|生成|制作|设计|修复|调整|修改|处理|跑|出图|导出|开始|执行|创建|新建|建立|整理|准备|完成|交付|产出)/i;
const SKU_CAPABILITY_OR_PROCEDURE_QUESTION_PATTERN = /(?:你|agent|智能体|模型|我问你|我想问|问一下|请问).{0,16}(?:会不会|会|能不能|能否|可不可以|可以不可以|可以|能|支持|支不支持|支持不支持).{0,24}(?:SKU|sku|自选备注|备注图|组合图|颜色组合|规格组合|能力)|(?:SKU|sku|自选备注|备注图|组合图|颜色组合|规格组合).{0,24}(?:会不会|会|能不能|能否|可不可以|可以不可以|可以|能|支持|支不支持|支持不支持|怎么做|如何做|怎么处理|如何处理)|支持哪些.{0,16}(?:SKU|sku).{0,8}能力|(?:SKU|sku).{0,16}能力.{0,12}(?:哪些|有什么|支持)/i;
const SKU_CARD_SOURCE_ONLY_PATTERN = /(?:(?:创建|新建|建立|整理|准备|制作|生成|做).{0,32}(?:SKU|sku).{0,32}(?:色卡素材|色卡源|源文档|源文件|卡片源|颜色组)|(?:SKU|sku).{0,32}(?:色卡素材|色卡源文档|色卡源文件|卡片源文档|卡片素材|颜色组源文档)|(?:色卡素材|色卡源文档|卡片源文档).{0,32}(?:SKU|sku))/i;
const SKU_TEMPLATE_DESIGN_PATTERN = /(?:(?:SKU|sku).{0,32}(?:模板|模版|排版模板|卡片模板|色卡模板|模板设计|设计模板|模板方案|版式模板|版式设计)|(?:排版模板|卡片模板|色卡模板|模板设计|设计模板|模板方案|版式模板|版式设计).{0,32}(?:SKU|sku)|(?:做|创建|新建|建立|设计|制作|生成|修复|调整|修改|优化|重做|改版).{0,32}(?:模板|排版模板|卡片模板|色卡模板|版式模板|占位结构).{0,32}(?:SKU|sku)|(?:创建|新建|建立|设计|修复|调整|修改|优化|重做|改版).{0,32}(?:SKU|sku).{0,32}(?:模板|排版模板|卡片模板|色卡模板|版式模板|占位结构)|(?:创建|新建|建立|设计|修复|调整|修改|优化|重做|改版).{0,32}(?:SKU|sku).{0,24}(?:排版|版式|占位结构))/i;
const SKU_EXISTING_SOURCE_HINT_PATTERN = /(?:已有|现有|现成|已经准备好|已准备好|已准备|项目已有|项目中已有|项目中存在|项目里已有|已经有|已存在|基于已有|基于现有|基于我们项目中|基于项目中).{0,48}(?:SKU|sku).{0,48}(?:色卡素材|色卡源|源文档|源文件|卡片源|SKU\.psb|PSD\/SKU|PSD\\SKU)|(?:存在|有|包含|包括).{0,36}(?:SKU|sku).{0,36}(?:色卡素材|色卡源|源文档|源文件|卡片源|SKU\.psb|PSD\/SKU|PSD\\SKU)|(?:基于|使用|复用|沿用|优先使用|用).{0,48}(?:项目中|当前项目|项目里|我们项目|已有|现有|现成|已准备|项目已有).{0,48}(?:SKU|sku).{0,36}(?:色卡素材|色卡源|源文档|源文件|卡片源)/i;
const SKU_EXISTING_TEMPLATE_CLAIM_PATTERN = /(?:(?:已有|现有|现成|已经准备好|已准备好|已经有(?:可用)?|已存在|项目(?:中|里|内)(?:已经)?(?:有|存在|包含)|当前项目(?:中|里|内)?(?:已经)?(?:有|存在|包含)).{0,32}(?:SKU|sku)?.{0,24}(?:排版模板|卡片模板|色卡模板|版式模板|模板文件|模板)|(?:使用|复用|沿用|基于|按|优先使用).{0,36}(?:项目中|项目里|项目内|当前项目|已有|现有|现成).{0,24}(?:SKU|sku)?.{0,24}(?:排版模板|卡片模板|色卡模板|版式模板|模板文件|模板)|(?:排版模板|卡片模板|色卡模板|版式模板|模板文件|模板).{0,24}(?:已经)?(?:在|位于).{0,16}(?:项目中|项目里|项目内|当前项目))/i;
const SKU_TEMPLATE_UNAVAILABLE_PATTERN = /(?:(?:没有|缺少|缺失|无(?:可用)?|还没(?:有|准备好)?|未有|未准备好|不存在)(?:(?:可用|现成|对应|当前|新的?)(?:的)?|一个|一份|一套|\d{1,2}\s*双(?:装)?|SKU|sku|\s){0,6}(?:排版模板|卡片模板|色卡模板|版式模板|模板文件|模板)|缺(?:一个|一份|一套|对应)?(?:排版模板|卡片模板|色卡模板|版式模板|模板文件|模板)|(?:排版模板|卡片模板|色卡模板|版式模板|模板文件|模板)[：:，,。；;\s]{0,4}(?:缺失|不存在|不可用|未准备好))/i;
const SKU_TEMPLATE_MISSING_OR_CREATE_PATTERN = /(?:(?:没有|缺少|缺失|无(?:可用)?|还没(?:有|准备好)?|未有|未准备好|不存在)(?:(?:可用|现成|对应|当前|新的?)(?:的)?|一个|一份|一套|\d{1,2}\s*双(?:装)?|SKU|sku|\s){0,6}(?:模板|排版模板|卡片模板|色卡模板|版式)|缺(?:一个|一份|一套|对应)?(?:模板|排版模板|卡片模板|色卡模板|版式)|(?:模板|排版模板|卡片模板|色卡模板|版式)[：:，,。；;\s]{0,4}(?:缺失|不存在|不可用|未准备好)|(?:需要|要|还要|还需要|先|先把).{0,24}(?:做|创建|新建|建立|设计|制作|生成).{0,24}(?:模板|排版模板|卡片模板|色卡模板|版式))/i;
const SKU_TEMPLATE_REFERENCE_ONLY_PATTERN = /(?:不要|别|不使用|不用|无需|禁止).{0,36}(?:模板|排版模板|卡片模板|色卡模板|双装模板|自选备注).{0,36}(?:作为|当作|识别为|使用为).{0,16}(?:SKU|sku).{0,12}(?:源|素材|色卡|文档)?/i;
const SKU_EXPLICIT_TEMPLATE_AUTHORING_PATTERN = /(?:(?:创建|新建|建立|重新设计|修复|调整|修改|优化|重做|改版|另做|另外设计|再设计).{0,36}(?:SKU|sku)?.{0,24}(?:排版模板|卡片模板|色卡模板|模板设计|设计模板|模板方案|版式模板|版式设计|模板|排版|版式|占位结构)|(?:做|制作|生成).{0,12}(?:一个|一份|一套|新版|新的|新).{0,24}(?:SKU|sku)?.{0,24}(?:模板|排版模板|卡片模板|色卡模板|版式模板)|(?:排版模板|卡片模板|色卡模板|模板设计|模板方案|版式模板|版式设计|占位结构|模板|版式).{0,36}(?:创建|新建|建立|重新设计|修复|调整|修改|优化|重做|改版|另做|另外设计|再设计))/i;
const SKU_PLACEHOLDER_STRUCTURE_EDIT_PATTERN = /(?:(?:修复|调整|修改|优化|重排|重做).{0,24}(?:SKU|sku)?.{0,24}(?:占位符|占位组|占位结构)|(?:SKU|sku)?.{0,24}(?:占位符|占位组|占位结构).{0,24}(?:修复|调整|修改|优化|重排|重做))/i;
const NON_SKU_DOCUMENT_TARGET_PATTERN = /(?:创建|新建|建立|制作|生成).{0,48}(?:详情页|长图|主图|首图|白底图|点击图|转化图).{0,24}(?:文档|文件|画布|psd|psb)|(?:详情页|长图|主图|首图|白底图|点击图|转化图).{0,24}(?:文档|文件|画布|psd|psb).{0,48}(?:创建|新建|建立|制作|生成)/i;
const SKU_DOCUMENT_CREATE_PATTERN = /(?:创建|新建|建立|制作|生成).{0,48}(?:SKU|sku).{0,24}(?:文档|文件|画布|psd|psb)|(?:SKU|sku).{0,24}(?:文档|文件|画布|psd|psb).{0,48}(?:创建|新建|建立|制作|生成)/i;
const SKU_PRODUCTION_DOCUMENT_HINT_PATTERN = /(?:色卡素材|色卡源|源文档|源文件|卡片源|卡片素材|排版模板|卡片模板|色卡模板|模板设计|组合图|自选备注|备注图|批量|双装|\d{1,2}\s*双)/i;

function isReasonableSkuSize(value: number): boolean {
    return Number.isInteger(value) && value >= 1 && value <= 50;
}

function uniqueSorted(values: number[]): number[] {
    return Array.from(new Set(values.filter(isReasonableSkuSize))).sort((a, b) => a - b);
}

export function extractSkuComboSizesFromText(input: string): number[] {
    const text = String(input || '');
    const matched: number[] = [];

    const explicitDuals = text.match(/(\d{1,2})\s*双/g) || [];
    for (const token of explicitDuals) {
        const value = Number(String(token).match(/\d+/)?.[0] || 0);
        if (isReasonableSkuSize(value)) matched.push(value);
    }

    const grouped = text.match(/\d+(?:\s*[-/、，,]\s*\d+)+/g) || [];
    for (const token of grouped) {
        const parts = token.match(/\d+/g) || [];
        for (const part of parts) {
            const value = Number(part);
            if (isReasonableSkuSize(value)) matched.push(value);
        }
    }

    if (/(?:单|一)\s*双(?:装|自选备注|备注|sku|SKU)?/.test(text)) {
        matched.push(1);
    }

    return uniqueSorted(matched);
}

export function hasSkuNoteRequest(input: string): boolean {
    const text = String(input || '');
    return /自选备注|备注图|(?:SKU|sku)\s*备注|备注\s*(?:SKU|sku)|规格备注|(?:单双(?:装)?|一\s*双(?:装)?|\d{1,2}\s*双(?:装)?)\s*(?:SKU|sku)?\s*备注/.test(text);
}

export function hasSkuNoteDisableIntent(input: string): boolean {
    return resolveSkuDeliverableDisposition(input, 'note') === 'excluded';
}

type SkuDeliverableKind = 'combo' | 'note';
type SkuDeliverableDisposition = 'required' | 'excluded' | 'unspecified';

interface SkuDeliverableRelationEvent {
    disposition: Exclude<SkuDeliverableDisposition, 'unspecified'>;
    index: number;
    end: number;
    specificity: number;
}

interface SkuDeliverableRelationRule {
    disposition: Exclude<SkuDeliverableDisposition, 'unspecified'>;
    pattern: RegExp;
    specificity: number;
}

const SKU_COMBO_DELIVERABLE_SOURCE = '(?:(?:SKU|sku)\\s*)?(?:组合图|颜色组合|配色组合|(?:SKU|sku)\\s*组合|组合)';
const SKU_NOTE_DELIVERABLE_SOURCE = '(?:(?:SKU|sku)\\s*)?(?:自选备注|备注图|规格备注|备注)';
const SKU_DELIVERABLE_NEGATION_SOURCE = '(?:不要|别|不应|不能|不可|不许|不准|勿)';
const SKU_DELIVERABLE_OMISSION_SOURCE = '(?:漏(?:掉)?|遗漏|少(?:了)?|忘(?:记)?|缺(?:少)?|排除(?:掉)?|跳过|省略|取消)';
const SKU_DELIVERABLE_PRODUCTION_SOURCE = '(?:做|生成|制作|导出|出(?:图)?|完成|交付|产出)';
const SKU_DELIVERABLE_EXCLUSIVE_ACTION_SOURCE = '(?:是|做|生成|制作|要|需要|保留|导出|出|补(?:充)?|再补|再做|再生成|修改|调整)';
const SKU_DELIVERABLE_CLAUSE_LEAD_SOURCE = '(?:^|[，,。！？!?；;\\n\\s]|后来|然后|最后|最终|改为|转而|接着)';
const SKU_DELIVERABLE_LIST_CONNECTOR_SOURCE = '(?:和|与|及|以及|、|跟|还有)';
const SKU_COMPOUND_COORDINATED_DELIVERABLE_SOURCE = `(?:${SKU_COMBO_DELIVERABLE_SOURCE}\\s*${SKU_DELIVERABLE_LIST_CONNECTOR_SOURCE}\\s*${SKU_NOTE_DELIVERABLE_SOURCE}|${SKU_NOTE_DELIVERABLE_SOURCE}\\s*${SKU_DELIVERABLE_LIST_CONNECTOR_SOURCE}\\s*${SKU_COMBO_DELIVERABLE_SOURCE})`;
const SKU_COMPOUND_COMMA_DELIVERABLE_SOURCE = `(?:${SKU_COMBO_DELIVERABLE_SOURCE}\\s*[，,]\\s*${SKU_NOTE_DELIVERABLE_SOURCE}|${SKU_NOTE_DELIVERABLE_SOURCE}\\s*[，,]\\s*${SKU_COMBO_DELIVERABLE_SOURCE})`;
const SKU_COMPOUND_PREFIX_DELIVERABLE_SOURCE = `(?:${SKU_COMPOUND_COORDINATED_DELIVERABLE_SOURCE}|${SKU_COMPOUND_COMMA_DELIVERABLE_SOURCE})`;
const SKU_COMPOUND_SUFFIX_DELIVERABLE_SOURCE = `(?:${SKU_COMPOUND_COORDINATED_DELIVERABLE_SOURCE}|${SKU_COMPOUND_COMMA_DELIVERABLE_SOURCE}(?=\\s*(?:都|一起|一并|同时|均)))`;

function getSkuDeliverableSource(deliverable: SkuDeliverableKind): string {
    return deliverable === 'combo'
        ? SKU_COMBO_DELIVERABLE_SOURCE
        : SKU_NOTE_DELIVERABLE_SOURCE;
}

function buildSkuDeliverableRelationRules(targetSource: string): SkuDeliverableRelationRule[] {
    return [
        {
            disposition: 'required',
            specificity: 120,
            pattern: new RegExp(`${SKU_DELIVERABLE_NEGATION_SOURCE}\\s*(?:再\\s*)?${SKU_DELIVERABLE_OMISSION_SOURCE}\\s*(?:了\\s*)?(?:${SKU_DELIVERABLE_PRODUCTION_SOURCE}\\s*)?${targetSource}`, 'gi')
        },
        {
            disposition: 'required',
            specificity: 120,
            pattern: new RegExp(`${targetSource}\\s*(?:也\\s*)?${SKU_DELIVERABLE_NEGATION_SOURCE}\\s*(?:再\\s*)?${SKU_DELIVERABLE_OMISSION_SOURCE}(?:\\s*${SKU_DELIVERABLE_PRODUCTION_SOURCE})?`, 'gi')
        },
        {
            disposition: 'required',
            specificity: 80,
            pattern: new RegExp(`${SKU_DELIVERABLE_CLAUSE_LEAD_SOURCE}(?:我\\s*)?(?:(?:还|也|仍然|还是|必须)\\s*)?(?:要|需要|保留|包含|恢复|加回|补回|补|补充|继续(?:做|生成|制作|导出)?|照常(?:做|生成|制作|导出)?|${SKU_DELIVERABLE_PRODUCTION_SOURCE})\\s*${targetSource}`, 'gi')
        },
        {
            disposition: 'required',
            specificity: 80,
            pattern: new RegExp(`${targetSource}\\s*(?:(?:也|还|都|仍然|还是|必须|一起|一并)\\s*)?(?:要|需要|保留|包含|恢复|加回|补回|继续(?:做|生成|制作|导出)?|照常(?:做|生成|制作|导出)?|${SKU_DELIVERABLE_PRODUCTION_SOURCE})`, 'gi')
        },
        {
            disposition: 'excluded',
            specificity: 90,
            pattern: new RegExp(`(?:而不是|而非|不是)\\s*${targetSource}`, 'gi')
        },
        {
            disposition: 'excluded',
            specificity: 85,
            pattern: new RegExp(`(?:无需|不需要|不用|不必)\\s*(?:再\\s*)?(?:${SKU_DELIVERABLE_PRODUCTION_SOURCE}\\s*)?${targetSource}`, 'gi')
        },
        {
            disposition: 'excluded',
            specificity: 85,
            pattern: new RegExp(`(?:不要|别|不许|不准|禁止)\\s*(?:再\\s*)?(?:${SKU_DELIVERABLE_PRODUCTION_SOURCE}\\s*)?${targetSource}`, 'gi')
        },
        {
            disposition: 'excluded',
            specificity: 85,
            pattern: new RegExp(`(?:不做|不生成|不制作|不导出|不出(?:图)?)\\s*${targetSource}`, 'gi')
        },
        {
            disposition: 'excluded',
            specificity: 70,
            pattern: new RegExp(`(?:跳过|排除|省略|取消|去掉)\\s*${targetSource}`, 'gi')
        },
        {
            disposition: 'excluded',
            specificity: 85,
            pattern: new RegExp(`${targetSource}\\s*(?:先\\s*)?(?:不要|别|不许|不准|禁止)\\s*(?:再\\s*)?${SKU_DELIVERABLE_PRODUCTION_SOURCE}(?:了)?`, 'gi')
        },
        {
            disposition: 'excluded',
            specificity: 85,
            pattern: new RegExp(`${targetSource}\\s*(?:无需|不需要|不用|不必)(?:\\s*${SKU_DELIVERABLE_PRODUCTION_SOURCE})?`, 'gi')
        },
        {
            disposition: 'excluded',
            specificity: 80,
            pattern: new RegExp(`${targetSource}\\s*(?:不做|不生成|不制作|不导出|不出(?:图)?|跳过|排除|省略|取消|去掉)`, 'gi')
        },
        {
            disposition: 'excluded',
            specificity: 75,
            pattern: new RegExp(`${targetSource}\\s*(?:先\\s*)?(?:不要|别|不许|不准)(?:了)?(?=\\s*(?:$|[，,。！？!?；;\\n]|但是|不过|后来|然后|最后|最终|改为|转而|接着))`, 'gi')
        }
    ];
}

function buildSkuCompoundDeliverableRelationRules(): SkuDeliverableRelationRule[] {
    return [
        {
            disposition: 'required',
            specificity: 160,
            pattern: new RegExp(`${SKU_DELIVERABLE_NEGATION_SOURCE}\\s*(?:再\\s*)?${SKU_DELIVERABLE_OMISSION_SOURCE}\\s*(?:了\\s*)?(?:${SKU_DELIVERABLE_PRODUCTION_SOURCE}\\s*)?${SKU_COMPOUND_PREFIX_DELIVERABLE_SOURCE}`, 'gi')
        },
        {
            disposition: 'required',
            specificity: 160,
            pattern: new RegExp(`${SKU_COMPOUND_SUFFIX_DELIVERABLE_SOURCE}\\s*(?:都|一起|一并|同时|均)?\\s*${SKU_DELIVERABLE_NEGATION_SOURCE}\\s*(?:再\\s*)?${SKU_DELIVERABLE_OMISSION_SOURCE}(?:\\s*${SKU_DELIVERABLE_PRODUCTION_SOURCE})?`, 'gi')
        },
        {
            disposition: 'required',
            specificity: 140,
            pattern: new RegExp(`${SKU_DELIVERABLE_CLAUSE_LEAD_SOURCE}(?:我\\s*)?(?:(?:只|仅|单独|还|也|仍然|还是|必须)\\s*)?(?:要|需要|保留|包含|恢复|加回|补回|继续(?:做|生成|制作|导出)?|照常(?:做|生成|制作|导出)?|${SKU_DELIVERABLE_PRODUCTION_SOURCE})\\s*${SKU_COMPOUND_PREFIX_DELIVERABLE_SOURCE}`, 'gi')
        },
        {
            disposition: 'required',
            specificity: 140,
            pattern: new RegExp(`${SKU_COMPOUND_SUFFIX_DELIVERABLE_SOURCE}\\s*(?:(?:都|也|还|一起|一并|同时|均|仍然|还是|必须)\\s*)?(?:要|需要|保留|包含|恢复|加回|补回|继续(?:做|生成|制作|导出)?|照常(?:做|生成|制作|导出)?|${SKU_DELIVERABLE_PRODUCTION_SOURCE})`, 'gi')
        },
        {
            disposition: 'excluded',
            specificity: 140,
            pattern: new RegExp(`(?:无需|不需要|不用|不必)\\s*(?:再\\s*)?(?:${SKU_DELIVERABLE_PRODUCTION_SOURCE}\\s*)?${SKU_COMPOUND_PREFIX_DELIVERABLE_SOURCE}`, 'gi')
        },
        {
            disposition: 'excluded',
            specificity: 140,
            pattern: new RegExp(`(?:不要|别|不许|不准|禁止)\\s*(?:再\\s*)?(?:${SKU_DELIVERABLE_PRODUCTION_SOURCE}\\s*)?${SKU_COMPOUND_PREFIX_DELIVERABLE_SOURCE}`, 'gi')
        },
        {
            disposition: 'excluded',
            specificity: 140,
            pattern: new RegExp(`(?:不做|不生成|不制作|不导出|不出(?:图)?|跳过|排除|省略|取消|去掉)\\s*${SKU_COMPOUND_PREFIX_DELIVERABLE_SOURCE}`, 'gi')
        },
        {
            disposition: 'excluded',
            specificity: 140,
            pattern: new RegExp(`${SKU_COMPOUND_SUFFIX_DELIVERABLE_SOURCE}\\s*(?:都|一起|一并|同时|均)?\\s*(?:(?:无需|不需要|不用|不必|不要|别|不许|不准|禁止)\\s*(?:(?:再|继续)\\s*)?${SKU_DELIVERABLE_PRODUCTION_SOURCE}|不(?:(?:再|继续)\\s*)?(?:做|生成|制作|导出|出(?:图)?)|跳过|排除|省略|取消|去掉)`, 'gi')
        },
        {
            disposition: 'excluded',
            specificity: 135,
            pattern: new RegExp(`${SKU_COMPOUND_SUFFIX_DELIVERABLE_SOURCE}\\s*(?:都|一起|一并|同时|均)?\\s*(?:无需|不需要|不用|不必|不要|别|不许|不准)(?:了)?(?=\\s*(?:$|[，,。！？!?；;\\n]|但是|不过|后来|然后|最后|最终|改为|转而|接着))`, 'gi')
        }
    ];
}

function collectSkuDeliverableRelationEvents(
    text: string,
    deliverable: SkuDeliverableKind
): SkuDeliverableRelationEvent[] {
    const targetSource = getSkuDeliverableSource(deliverable);
    const events: SkuDeliverableRelationEvent[] = [];
    for (const rule of buildSkuCompoundDeliverableRelationRules()) {
        for (const match of text.matchAll(rule.pattern)) {
            const index = match.index;
            if (typeof index !== 'number' || !match[0]) continue;
            events.push({
                disposition: rule.disposition,
                index,
                end: index + match[0].length,
                specificity: rule.specificity
            });
        }
    }
    for (const rule of buildSkuDeliverableRelationRules(targetSource)) {
        for (const match of text.matchAll(rule.pattern)) {
            const index = match.index;
            if (typeof index !== 'number' || !match[0]) continue;
            events.push({
                disposition: rule.disposition,
                index,
                end: index + match[0].length,
                specificity: rule.specificity
            });
        }
    }

    const exclusiveTargetSource = getSkuDeliverableSource(deliverable === 'combo' ? 'note' : 'combo');
    const exclusivePattern = new RegExp(`(?:只|仅|单独)\\s*${SKU_DELIVERABLE_EXCLUSIVE_ACTION_SOURCE}?\\s*(?:\\d+(?:\\s*[-/、，,]\\s*\\d+)*\\s*双?)?(?:的)?\\s*${exclusiveTargetSource}`, 'gi');
    for (const match of text.matchAll(exclusivePattern)) {
        const index = match.index;
        if (typeof index !== 'number' || !match[0]) continue;
        const prefix = text.slice(Math.max(0, index - 8), index);
        if (/(?:不要|别|不能|不应|不再|并非|不是|不)\\s*$/.test(prefix)) continue;
        events.push({
            disposition: 'excluded',
            index,
            end: index + match[0].length,
            specificity: 110
        });
    }

    const selectedOnlyPattern = new RegExp(`(?:只|仅|单独)\\s*${SKU_DELIVERABLE_EXCLUSIVE_ACTION_SOURCE}?\\s*(?:\\d+(?:\\s*[-/、，,]\\s*\\d+)*\\s*双?)?(?:的)?\\s*${targetSource}`, 'gi');
    for (const match of text.matchAll(selectedOnlyPattern)) {
        const index = match.index;
        if (typeof index !== 'number' || !match[0]) continue;
        const prefix = text.slice(Math.max(0, index - 8), index);
        if (/(?:不要|别|不能|不应|不再|并非|不是|不)\\s*$/.test(prefix)) continue;
        events.push({
            disposition: 'required',
            index,
            end: index + match[0].length,
            specificity: 110
        });
    }
    return events;
}

function resolveSkuDeliverableDisposition(
    input: string,
    deliverable: SkuDeliverableKind
): SkuDeliverableDisposition {
    const text = String(input || '').trim();
    if (!text) return 'unspecified';

    const events = collectSkuDeliverableRelationEvents(text, deliverable);
    const nonShadowedEvents = events.filter((event) => !events.some((candidate) => (
        candidate !== event
        && candidate.specificity > event.specificity
        && candidate.index <= event.index
        && candidate.end >= event.end
    )));
    nonShadowedEvents.sort((left, right) => (
        left.end - right.end
        || left.specificity - right.specificity
        || left.index - right.index
    ));
    const latestEvent = nonShadowedEvents[nonShadowedEvents.length - 1];
    return latestEvent?.disposition || 'unspecified';
}

function hasSkuComboWorkRequest(input: string): boolean {
    const text = String(input || '');
    if (!text.trim()) return false;

    if (/组合图|颜色组合|配色组合|SKU组合|sku组合|组合|批量配色|批量出图|批量生成/.test(text)) {
        return true;
    }

    if (/(?:排版模板|卡片模板|色卡模板|SKU\s*模板|sku\s*模板|模板).{0,24}(?:规格|双装|组合|自选备注|备注图)|(?:规格|双装|组合|自选备注|备注图).{0,24}(?:排版模板|卡片模板|色卡模板|SKU\s*模板|sku\s*模板|模板)/i.test(text)) {
        return true;
    }

    if (/(?:规格|规格是|规格为|需要|目标).{0,24}\d+(?:\s*[-/、，,]\s*\d+)+\s*双(?:装)?/i.test(text)) {
        return true;
    }

    if (/每(?:个规格|规格|个|款)?(?:需要|生成|做|出)?\s*\d{1,3}\s*(?:个|组|张|款)/.test(text)) {
        return true;
    }

    if (
        /(?:做|生成|制作|处理|跑|出|创建|新建|建立|整理|准备|导出|出图|完成|交付|产出).{0,12}(?:SKU|sku)(?!\s*(?:自选备注|备注图|备注))/.test(text)
        && !hasSkuPlanningOrKnowledgeIntent(text)
    ) {
        return true;
    }

    if (/(?:SKU|sku).{0,12}(?:批量|组合|配色|出图|每个规格|每规格)/.test(text)) {
        return true;
    }

    return false;
}

function hasSkuDomainTerm(input: string): boolean {
    return SKU_DOMAIN_TERM_PATTERN.test(String(input || ''));
}

export function stripSkuDownstreamContextText(input: string): string {
    return String(input || '')
        .replace(SKU_DOWNSTREAM_CONTEXT_PATTERN, '')
        .replace(/\s+/g, ' ')
        .trim();
}

export function isSkuSourceForNonSkuDocumentTargetText(input: string): boolean {
    const text = String(input || '').trim();
    if (!text || !/sku/i.test(text)) return false;
    if (!NON_SKU_DOCUMENT_TARGET_PATTERN.test(text)) return false;
    return /(?:SKU|sku).{0,24}(?:素材|色卡素材|源文件|来源|作为|当作)|(?:基于|使用|用|复用|沿用).{0,36}(?:SKU|sku)/i.test(text);
}

export function isPlainSkuDocumentCreateText(input: string): boolean {
    const text = String(input || '').trim();
    if (!text || !/sku/i.test(text)) return false;
    if (!SKU_DOCUMENT_CREATE_PATTERN.test(text)) return false;
    return !SKU_PRODUCTION_DOCUMENT_HINT_PATTERN.test(text);
}

function resolveSkuDirectiveResourceScope(clause: string): SkuDirectiveResourceScope | undefined {
    if (SKU_EXTERNAL_READ_ONLY_RESOURCE_SCOPE_PATTERN.test(clause)) {
        return 'external_readonly';
    }
    if (SKU_CURRENT_WORK_RESOURCE_SCOPE_PATTERN.test(clause)) {
        return 'current_work';
    }
    return undefined;
}

function hasSkuToolForbiddenDirective(input: string): boolean {
    const sentences = String(input || '').split(/[。！？!?；;\n]+/);
    for (const sentence of sentences) {
        let resourceScope: SkuDirectiveResourceScope | undefined;
        const clauses = sentence.split(/[，,]+/);
        for (const clause of clauses) {
            const declaredScope = resolveSkuDirectiveResourceScope(clause);
            const effectiveScope = declaredScope || resourceScope;
            if (SKU_TOOL_FORBIDDEN_DIRECTIVE_PATTERN.test(clause)) {
                const isExternalResourceDirective = effectiveScope === 'external_readonly'
                    && SKU_EXTERNAL_RESOURCE_TARGET_PATTERN.test(clause);
                if (!isExternalResourceDirective) return true;
            }
            if (declaredScope) resourceScope = declaredScope;
        }
    }
    return false;
}

function hasSkuConversationOnlyDirective(input: string): boolean {
    const clauses = String(input || '').split(/[，,。！？!?；;\n]+/);
    for (const clause of clauses) {
        if (!SKU_CONVERSATION_ONLY_DIRECTIVE_PATTERN.test(clause)) continue;
        if (SKU_NEGATED_CONVERSATION_ONLY_DIRECTIVE_PATTERN.test(clause)) continue;
        if (SKU_COMPLETION_SCOPED_REPORTING_PATTERN.test(clause)) continue;
        return true;
    }
    return false;
}

function hasSkuPlanningOrKnowledgeIntent(input: string): boolean {
    const sentences = String(input || '').split(/[。！？!?；;\n]+/);
    for (const sentence of sentences) {
        let resourceScope: SkuDirectiveResourceScope | undefined;
        const clauses = sentence.split(/[，,]+/);
        for (const clause of clauses) {
            const declaredScope = resolveSkuDirectiveResourceScope(clause);
            const effectiveScope = declaredScope || resourceScope;
            if (SKU_PLANNING_OR_KNOWLEDGE_PATTERN.test(clause)) {
                const isNegatedReportingOnly = SKU_NEGATED_CONVERSATION_ONLY_DIRECTIVE_PATTERN
                    .test(clause);
                const isExternalValidationPurpose = effectiveScope === 'external_readonly';
                if (!isNegatedReportingOnly && !isExternalValidationPurpose) return true;
            }
            if (declaredScope) resourceScope = declaredScope;
        }
    }
    return false;
}

function hasSkuNoToolDirective(input: string): boolean {
    const text = String(input || '');
    if (
        SKU_COMBO_CONFIRMATION_CARD_PATTERN.test(text)
        && !/(?:不要|别|无需|不用|禁止|不执行|不调用).{0,18}(?:执行|调用|工具|操作|改动|修改|写入)/i.test(text)
    ) {
        return false;
    }
    if (hasSkuToolForbiddenDirective(text)) return true;
    return hasSkuConversationOnlyDirective(text);
}

function hasSkuExecutionActionNearDomainTerm(input: string): boolean {
    const text = String(input || '');
    if (!SKU_EXECUTION_ACTION_PATTERN.test(text)) return false;
    return new RegExp(`${SKU_EXECUTION_ACTION_PATTERN.source}.{0,32}${SKU_DOMAIN_TERM_PATTERN.source}`, 'i').test(text)
        || new RegExp(`${SKU_DOMAIN_TERM_PATTERN.source}.{0,32}${SKU_EXECUTION_ACTION_PATTERN.source}`, 'i').test(text);
}

export function isSkuReadOnlyInspectionText(input: string): boolean {
    const text = String(input || '').trim();
    if (!text || !hasSkuDomainTerm(text)) return false;
    if (!SKU_READ_ONLY_INSPECTION_PATTERN.test(text)) return false;
    return !SKU_READ_ONLY_EXECUTION_NEGATIVE_PATTERN.test(text);
}

export function isSkuCardSourceOnlyText(input: string): boolean {
    const text = String(input || '').trim();
    if (!text || !/sku/i.test(text)) return false;
    if (SKU_COMBO_CONFIRMATION_CARD_PATTERN.test(text)) return false;
    if (!SKU_CARD_SOURCE_ONLY_PATTERN.test(text)) return false;
    return /(?:不生成|不导出|不继续|不要|无需|只做|仅做|本轮只做|单独)(?:[^。！？!?；;\n]{0,24})(?:组合图|成品\s*SKU|自选备注|备注图|批量出图|导出成品|生成\s*\d{1,2}\s*双)/i.test(text)
        || /(?:源文档|源文件|色卡素材|卡片源).{0,24}(?:保存|读回|验收快照|文档信息)/i.test(text);
}

/** 明确把 SKU 色卡本身作为本轮交付物；完整生产中提到色卡缺件不属于此阶段。 */
export function isSkuColorCardStageRequestText(input: string): boolean {
    const text = String(input || '').trim();
    if (!text || !/sku/i.test(text)) return false;
    if (!/(?:SKU|sku).{0,20}(?:色卡|颜色卡)|(?:色卡|颜色卡).{0,20}(?:SKU|sku)/i.test(text)) return false;
    if (/(?:组合图|批量出图|批量生成|自选备注|备注图|完整生产|整套)/i.test(text)) return false;
    if (isSkuTemplateDesignRequestText(text)) return false;
    return /(?:做|制作|创建|生成|整理|编排|设计|准备|create|make|generate)/i.test(text);
}

export function hasSkuExistingTemplateClaimText(input: string): boolean {
    const text = String(input || '').trim();
    if (!text || !/sku/i.test(text)) return false;
    if (SKU_TEMPLATE_UNAVAILABLE_PATTERN.test(text)) return false;
    return SKU_EXISTING_TEMPLATE_CLAIM_PATTERN.test(text);
}

export function isSkuTemplateDesignRequestText(input: string): boolean {
    const text = stripSkuDownstreamContextText(String(input || '').trim());
    if (!text || !/sku/i.test(text)) return false;
    if (isSkuCardSourceOnlyText(text)) return false;
    if (hasSkuNoToolDirective(text)) return false;
    if (isPlainSkuDocumentCreateText(text)) return false;

    const hasPlaceholderStructureEdit = SKU_PLACEHOLDER_STRUCTURE_EDIT_PATTERN.test(text);
    const hasTemplateDesignTarget = SKU_TEMPLATE_DESIGN_PATTERN.test(text) || hasPlaceholderStructureEdit;
    const hasExplicitTemplateAuthoring = SKU_EXPLICIT_TEMPLATE_AUTHORING_PATTERN.test(text)
        || hasPlaceholderStructureEdit;
    const hasExistingTemplateClaim = hasSkuExistingTemplateClaimText(text);
    const hasExistingSourceAndMissingTemplate =
        SKU_EXISTING_SOURCE_HINT_PATTERN.test(text)
        && SKU_TEMPLATE_MISSING_OR_CREATE_PATTERN.test(text);
    if (
        hasExistingTemplateClaim
        && !SKU_TEMPLATE_MISSING_OR_CREATE_PATTERN.test(text)
        && !hasExplicitTemplateAuthoring
    ) {
        return false;
    }
    if (
        hasTemplateDesignTarget
        && !hasExistingSourceAndMissingTemplate
        && SKU_COMBO_CONFIRMATION_CARD_PATTERN.test(text)
        && SKU_TEMPLATE_REFERENCE_ONLY_PATTERN.test(text)
        && !hasExplicitTemplateAuthoring
    ) {
        return false;
    }

    if (!hasTemplateDesignTarget && !hasExistingSourceAndMissingTemplate) {
        return false;
    }

    return /(?:帮我|请|需要|还需要|要|做|创建|新建|建立|设计|制作|生成|修复|调整|修改|优化|处理|完成|交付|产出)/i.test(text);
}

export function isSkuConfigurationRequestText(input: string): boolean {
    const text = String(input || '').trim();
    if (!text || !/sku/i.test(text)) return false;
    if (isSkuCardSourceOnlyText(text) || isSkuTemplateDesignRequestText(text)) return false;
    if (/(组合图|批量出图|批量生成|自选备注|备注图)/i.test(text)) return false;
    if (isSkuReadOnlyInspectionText(text)) return false;
    const exportsColorConfiguration = /(?:颜色配置|配色配置|颜色表|color config)/i.test(text)
        && /(?:导出|输出|保存|export)/i.test(text);
    const createsPlaceholders = /(?:占位符|占位组|placeholder)/i.test(text)
        && /(?:创建|生成|准备|建立|新增|create)/i.test(text);
    return exportsColorConfiguration || createsPlaceholders;
}

export type SkuConfigurationAction = 'exportColors' | 'createPlaceholders' | 'getPlaceholders';

export function inferSkuConfigurationActionFromText(input: string): SkuConfigurationAction | undefined {
    const text = String(input || '').trim();
    if (!isSkuConfigurationRequestText(text)) return undefined;
    if (/(?:占位符|占位组|placeholder)/i.test(text)) {
        if (/(?:获取|查看|检查|读取|有哪些|列表|get|inspect)/i.test(text)) return 'getPlaceholders';
        if (/(?:创建|生成|准备|建立|新增|create)/i.test(text)) return 'createPlaceholders';
    }
    if (/(?:颜色配置|配色配置|颜色表|color config)/i.test(text)) return 'exportColors';
    return undefined;
}

export function isSkuExecutionRequestText(input: string): boolean {
    const text = String(input || '').trim();
    if (!text || !hasSkuDomainTerm(text)) return false;
    const currentTaskText = stripSkuDownstreamContextText(text);
    if (isSkuSourceForNonSkuDocumentTargetText(text)) return false;
    if (isPlainSkuDocumentCreateText(text)) return false;
    if (SKU_CAPABILITY_OR_PROCEDURE_QUESTION_PATTERN.test(currentTaskText)) return false;
    if (hasSkuNoToolDirective(currentTaskText)) return false;
    if (isSkuReadOnlyInspectionText(currentTaskText)) return false;

    const cardSourceOnly = isSkuCardSourceOnlyText(currentTaskText);
    const hasExecutionAction = hasSkuExecutionActionNearDomainTerm(currentTaskText) || cardSourceOnly;
    if (!hasExecutionAction) return false;

    if (
        hasSkuPlanningOrKnowledgeIntent(currentTaskText)
        && !SKU_IMMEDIATE_EXECUTION_PATTERN.test(text)
        && !SKU_STAGED_EXECUTION_PATTERN.test(text)
        && !cardSourceOnly
    ) {
        return false;
    }

    return true;
}

/** 用户是否明确要求在生产前先查看或确认 SKU 组合。 */
export function isSkuComboReviewRequestedText(input: string): boolean {
    const text = String(input || '').trim();
    if (!text || !hasSkuDomainTerm(text)) return false;
    if (/(?:我已确认|已确认|确认使用|确认后的组合|基于确认后的组合).{0,48}(?:SKU|sku)?.{0,32}(?:组合|配方)/i.test(text)) {
        return false;
    }
    if (isSkuComboReviewSkippedText(text)) return false;
    return /(?:先|需要|让我|给我|我要).{0,10}(?:确认|审核|看|过目).{0,10}(?:SKU\s*)?组合|(?:SKU\s*)?组合.{0,10}(?:确认|审核|给我看|过目)/i.test(text);
}

/** 用户是否明确要求跳过组合卡，直接使用当前候选或权威配置继续生产。 */
export function isSkuComboReviewSkippedText(input: string): boolean {
    const text = String(input || '').trim();
    if (!text || !hasSkuDomainTerm(text)) return false;
    return /(?:无需|不用|不需要|不要|跳过).{0,18}(?:确认组合|组合确认|确认卡片|卡片确认)/i.test(text)
        || /(?:组合|配方).{0,12}(?:不用|无需|不需要|不要).{0,8}(?:确认|过目|卡片)/i.test(text);
}

/**
 * SKU 组合卡的唯一决定函数。它只处理领域交互顺序，不授予 Photoshop 权限：
 * 非权威候选默认先给用户确认；明确跳过、已确认或备注-only 才不暂停。
 */
export function shouldRequestSkuComboConfirmation(input: {
    onlyNotes: boolean;
    lacksAuthoritativeCombinationSpecification: boolean;
    userExplicitlyRequestsReview: boolean;
    userExplicitlySkipsReview: boolean;
    confirmationApproved: boolean;
}): boolean {
    if (input.onlyNotes || input.confirmationApproved || input.userExplicitlySkipsReview) {
        return false;
    }
    return input.lacksAuthoritativeCombinationSpecification || input.userExplicitlyRequestsReview;
}

/** 用户是否明确要求在模板设计前先看方向或确认版式。普通“做 SKU 模板”不是确认请求。 */
export function isSkuTemplateReviewRequestedText(input: string): boolean {
    const text = String(input || '').trim();
    if (!text || !hasSkuDomainTerm(text) || !/(?:模板|版式|排版)/i.test(text)) return false;
    if (/(?:我已确认|已确认|确认使用|确认后的|基于确认后的).{0,48}(?:SKU|sku)?.{0,32}(?:模板|版式|排版)/i.test(text)) {
        return false;
    }
    if (/(?:无需|不用|不需要|不要|跳过).{0,18}(?:模板确认|确认模板|方向确认|确认方向|版式确认|确认版式|确认卡片)/i.test(text)) {
        return false;
    }
    return /(?:先|需要|让我|给我|我要).{0,12}(?:确认|审核|看|过目).{0,12}(?:(?:SKU|sku).{0,8})?(?:模板|方向|版式|排版)|(?:(?:SKU|sku).{0,8})?(?:模板方向|模板版式|排版方向).{0,12}(?:确认|审核|给我看|过目)/i.test(text);
}

/**
 * 普通完整 SKU 执行命令本身即委托 Skill 完成可逆的前置设计与组合候选生成。
 * 该信号不等于用户确认候选组合；默认仍在批量生产前展示组合卡。
 * 它也不授予商品、价格、合规或正式上架规格等业务事实。
 */
export function isSkuAutonomousProductionDraftRequestText(input: string): boolean {
    return isSkuExecutionRequestText(input) && !isSkuComboReviewRequestedText(input);
}

export type SkuRoutingIntentVerdict = 'execute' | 'read_only' | 'ambiguous';

/**
 * SKU 声明式路由的唯一语义裁决。
 *
 * Skill declaration 的宽松正信号只能用于候选发现，不能把“分析/盘点/评估/说明”
 * 因为同时出现“做 + SKU”就升级成生产授权。只有本模块已确认的 execute 才可推荐
 * sku-batch；read_only 与 ambiguous 都继续留给通用 Agent，不预激活生产 workflow。
 */
export function resolveSkuRoutingIntentVerdict(input: string): SkuRoutingIntentVerdict {
    const text = String(input || '').trim();
    if (!text || !hasSkuDomainTerm(text)) return 'ambiguous';
    if (isSkuExecutionRequestText(text)) return 'execute';
    const currentTaskText = stripSkuDownstreamContextText(text);
    if (
        isSkuReadOnlyInspectionText(currentTaskText)
        || SKU_CAPABILITY_OR_PROCEDURE_QUESTION_PATTERN.test(currentTaskText)
        || hasSkuPlanningOrKnowledgeIntent(currentTaskText)
        || hasSkuNoToolDirective(currentTaskText)
    ) {
        return 'read_only';
    }
    return 'ambiguous';
}

/**
 * 兼容旧确定性路由时对“把 SKU 当作素材来源”的消歧。
 *
 * 这是 SKU 生产扩展自己的词法知识，不属于通用 Skill matcher。调用方只能把它
 * 用作 legacy route 的候选排除，不能据此绑定 Runtime、授权写入或判定完成。
 */
export function isAmbiguousSkuSourceExportText(input: string): boolean {
    const text = String(input || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!text || !/sku/i.test(text)) return false;

    const hasSkuSourceWording = /(sku\s*素材|sku\s*源文件|sku\s*来源|使用\s*sku|用\s*sku|sku.{0,8}(素材|源文件|来源)|素材.{0,8}sku)/i.test(text);
    if (!hasSkuSourceWording) return false;

    const hasExportOrUseAction = /(导出|输出|保存|出图|使用|用)/.test(text);
    if (!hasExportOrUseAction) return false;

    const hasExplicitSkuDeliverable = /(组合图|自选备注|备注图|批量配色|批量出图|批量生成|双装|单双装|\d{1,2}\s*双|做\s*sku|制作\s*sku|生成\s*sku|sku\s*组合|sku\s*自选)/i.test(text);
    if (hasExplicitSkuDeliverable) return false;

    const hasExplicitNonSkuTarget = /(白底图|自底图|白底|主图|点击图|转化图|详情页|png|jpg|jpeg|psd|psb|文档)/i.test(text);
    return !hasExplicitNonSkuTarget;
}

export function isSkuNoteOnlyText(input: string): boolean {
    const text = String(input || '');
    const noteRequested = hasSkuNoteRequest(text);
    const noteDisposition = resolveSkuDeliverableDisposition(text, 'note');
    if (!noteRequested && noteDisposition !== 'required') return false;
    if (noteDisposition === 'excluded') return false;
    const comboDisposition = resolveSkuDeliverableDisposition(text, 'combo');
    const explicitOnly = /(?:只|仅|单独)(?:做|生成|要)?(?:\s*\d+(?:\s*[-/、，,]\s*\d+)*\s*双?)?(?:的)?(?:(?:SKU|sku)\s*)?(?:自选备注|备注图|备注)|(?:补|补一下|补充|还需要|还要|需要|再补|再做|再生成|对应)(?:.{0,16})?(?:(?:SKU|sku)\s*)?(?:自选备注|备注图|备注)/.test(text)
        && /(?:SKU|sku|自选备注|备注图|规格备注|单双(?:装)?|一\s*双(?:装)?|\d{1,2}\s*双)/.test(text);
    if (comboDisposition === 'required') return false;
    if (comboDisposition === 'excluded') return true;
    const hasComboWork = hasSkuComboWorkRequest(text);
    if (hasComboWork) return false;
    if (explicitOnly) return true;
    return /(?:自选备注|备注图|(?:SKU|sku)\s*备注|规格备注)$/.test(text);
}

export function extractSkuCountPerSizeFromText(input: string): number | undefined {
    const text = String(input || '');
    const patterns = [
        /每(?:个规格|个|规格|款|双)?(?:需要|生成|做|出)?\s*(\d{1,3})\s*(?:个|组|张|款)/,
        /(?:需要|生成|做|出)\s*(\d{1,3})\s*(?:个|组|张|款)/
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (!match) continue;
        const value = Number(match[1]);
        if (Number.isFinite(value) && value > 0) {
            return Math.max(1, Math.floor(value));
        }
    }

    return undefined;
}

export function inferSkuIntentParamsFromText(input: string): SkuIntentParams {
    const text = String(input || '');
    const sourceOnly = isSkuCardSourceOnlyText(text);
    let stage: SkuSkillStage = 'full';
    if (sourceOnly || isSkuColorCardStageRequestText(text)) {
        stage = 'color-card';
    } else if (isSkuTemplateDesignRequestText(text)) {
        stage = 'template';
    } else if (isSkuConfigurationRequestText(text)) {
        stage = 'config';
    }
    const comboSizes = sourceOnly ? [] : extractSkuComboSizesFromText(text);
    const countPerSize = extractSkuCountPerSizeFromText(text);
    const noteRequested = hasSkuNoteRequest(text);
    const noteDisposition = resolveSkuDeliverableDisposition(text, 'note');
    const onlyNotes = isSkuNoteOnlyText(text);
    let generateNotes = noteRequested;
    if (noteDisposition === 'required') {
        generateNotes = true;
    } else if (noteDisposition === 'excluded') {
        generateNotes = false;
    }

    return {
        stage,
        ...(comboSizes.length > 0 ? { comboSizes } : {}),
        ...(typeof countPerSize === 'number' ? { countPerSize } : {}),
        generateNotes: sourceOnly ? false : generateNotes,
        onlyNotes,
        ...(sourceOnly ? { sourceOnly: true } : {})
    };
}

export interface SkuSkillStageResolution {
    stage: SkuSkillStage;
    /** 历史只读入口；不扩张公开 stage 枚举，也不能触发写入准备。 */
    legacyInspectOnly?: boolean;
    /**
     * 显式传入但无法识别的 stage 字面量。存在时 stage 只是文本回落猜测，
     * 执行器必须拒绝执行并点名合法值，不得按猜测结果静默改道。
     */
    invalidDeclaredStage?: string;
}

function canonicalizeSkuSkillStageLiteral(value: string): SkuSkillStage | 'inspect' | null {
    const canonical = value.toLowerCase().replace(/[^a-z]/g, '');
    if (canonical === 'full') return 'full';
    if (canonical === 'colorcard') return 'color-card';
    if (canonical === 'template') return 'template';
    if (canonical === 'config') return 'config';
    if (canonical === 'inspect') return 'inspect';
    return null;
}

/**
 * 解析唯一 SKU Skill 的内部阶段。显式结构化 stage 用于续跑且优先；只有未声明 stage 时才从可信用户原文回落，旧 sourceOnly 只作兼容输入。
 * 不从任意模型参数推断用户拥有的组合、颜色或备注事实。
 */
export function resolveSkuSkillStage(input: {
    stage?: unknown;
    sourceOnly?: unknown;
    userInput?: unknown;
}): SkuSkillStageResolution {
    // 模型显式声明的 stage 是第一权威：循环内模型按站③指引调 stage=template 时，
    // 不得被用户原话的正则猜测覆盖（2026-08-23 真机：'帮我做SKU' 命中执行正则，
    // 把模型三次 stage=template 全改道成 full，缺模板预检三连败熔断）。
    // 大小写 / 分隔符变体归一化后照常生效；无法识别的显式字面量标记为 invalid，
    // 由执行器 fail-fast（2026-08-27 真机 run702：非法字面量静默落进正则会把
    // 色卡意图改道成其他站点，模型对改道毫不知情）。文本正则只在没有显式声明时兜底。
    const declared = String(input.stage || '').trim();
    if (declared) {
        const canonical = canonicalizeSkuSkillStageLiteral(declared);
        if (canonical === 'inspect') {
            return { stage: 'full', legacyInspectOnly: true };
        }
        if (canonical) {
            return { stage: canonical };
        }
    }
    const userInput = String(input.userInput || '');
    let stage: SkuSkillStage = 'full';
    if (
        input.sourceOnly === true
        || isSkuCardSourceOnlyText(userInput)
        || isSkuColorCardStageRequestText(userInput)
    ) {
        stage = 'color-card';
    } else if (isSkuTemplateDesignRequestText(userInput)) {
        stage = 'template';
    } else if (isSkuConfigurationRequestText(userInput)) {
        stage = 'config';
    }
    return declared ? { stage, invalidDeclaredStage: declared } : { stage };
}
