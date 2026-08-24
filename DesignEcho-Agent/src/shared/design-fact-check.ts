/**
 * 「对不对」核对器（design-fact-check）——先判对不对，再判好不好看。
 *
 * 产品事实表：色卡颜色名、产品名 / 系列、用户给的规格、素材上观察到的词。
 * 硬项（有唯一正确答案，可确定性判定）：
 *   ① 文案与本品一致：画面文字里提到的颜色 / 款式 / 图案词，必须能在事实表里找到；
 *      找不到（如别品模板遗留的「小花 / 条纹」）就是发现，并给出可用词。
 *   ② 模板来源：模板里的产品图不是本项目素材 ⇒ 占位须替换。
 *   ③ SKU 组合：默认不重复色（除非用户明说）。
 * 纯逻辑、无 IO、无品类词——词表来自事实表与调用方，不写死品类。
 */

export interface ProductFactSheet {
    /** 色卡颜色名（如 白色 / 浅灰 / 深咖） */
    colorNames: string[];
    /** 产品名 / 系列 / 款式词（如 木耳边、微压、中筒袜） */
    productTerms: string[];
    /** 用户给的规格 / 数量词（如 2双装 / 3双装） */
    specTerms: string[];
    /** 素材观察到的词（analyzeAssetContent 等） */
    observedTerms: string[];
}

export interface FactCheckFinding {
    code: 'copy_term_not_in_facts' | 'template_asset_not_from_project' | 'sku_combo_duplicate_color' | 'placeholder_not_filled';
    severity: 'hard' | 'advice';
    message: string;
    /** 可执行建议（用什么词替换 / 换哪张图 / 改哪组） */
    suggestion?: string;
    subject?: string;
}

const CN_COLOR_HINT = /(白|黑|灰|咖|棕|米|杏|粉|红|橙|黄|绿|青|蓝|紫|藏青|卡其|驼|奶|奶白|藕|豆沙|墨绿|军绿|酒红|杏色|肤色|裸色)/u;
const PATTERN_HINT = /(条纹|小花|碎花|波点|格子|格纹|印花|卡通|字母|爱心|星星|云朵|花边|木耳边|蕾丝|提花|刺绣|渐变|纯色|素色)/u;

function clean(value: unknown): string {
    return String(value ?? '').replace(/\s+/g, '').trim();
}

export function buildProductFactSheet(input: Partial<ProductFactSheet>): ProductFactSheet {
    const uniq = (values?: unknown[]) => Array.from(new Set((values || []).map(clean).filter(Boolean)));
    return {
        colorNames: uniq(input.colorNames),
        productTerms: uniq(input.productTerms),
        specTerms: uniq(input.specTerms),
        observedTerms: uniq(input.observedTerms)
    };
}

function allFactTerms(facts: ProductFactSheet): string[] {
    return [...facts.colorNames, ...facts.productTerms, ...facts.specTerms, ...facts.observedTerms];
}

/**
 * 从一段文案里抽「像颜色 / 款式 / 图案」的词（2–4 字），交给事实表核对。
 * 只抽带提示字的词，避免把「留言备注」这类通用词当款式。
 */
export function extractCopyClaimTerms(text: string): string[] {
    const source = String(text || '');
    const found = new Set<string>();
    // 「1双小花+1双条纹」这类：数量 + 词
    for (const match of source.matchAll(/\d+\s*(?:双|件|条|只|个)\s*([一-龥]{1,4})/gu)) {
        const term = clean(match[1]);
        if (term) found.add(term);
    }
    // 显式颜色 / 图案词
    for (const match of source.matchAll(/[一-龥]{2,4}/gu)) {
        const term = match[0];
        if (CN_COLOR_HINT.test(term) || PATTERN_HINT.test(term)) found.add(term);
    }
    return Array.from(found);
}

/** 文案词是否能在事实表里找到（互相包含即算命中：「浅咖」命中「浅咖色」）。 */
export function isTermInFacts(term: string, facts: ProductFactSheet): boolean {
    const t = clean(term);
    if (!t) return true;
    const factTerms = allFactTerms(facts);
    if (factTerms.some((fact) => fact.includes(t) || t.includes(fact))) return true;
    // 复合词只要有 ≥2 字与事实重叠即算本品词（「微压条纹」与「直板木耳边微压」共享「微压」）；
    // 单独的「条纹」「小花」没有任何 2 字片段命中，仍算外来词。
    for (let len = Math.min(t.length, 4); len >= 2; len -= 1) {
        for (let start = 0; start + len <= t.length; start += 1) {
            const piece = t.slice(start, start + len);
            if (factTerms.some((fact) => fact.includes(piece))) return true;
        }
    }
    return false;
}

/** ① 文案与本品一致 */
export function checkCopyAgainstFacts(texts: Array<{ layerName?: string; text: string }>, facts: ProductFactSheet): FactCheckFinding[] {
    const findings: FactCheckFinding[] = [];
    const hasFacts = allFactTerms(facts).length > 0;
    if (!hasFacts) return findings;
    for (const entry of texts) {
        const claims = extractCopyClaimTerms(entry.text);
        const foreign = claims.filter((term) => !isTermInFacts(term, facts));
        if (foreign.length === 0) continue;
        findings.push({
            code: 'copy_term_not_in_facts',
            severity: 'hard',
            subject: entry.layerName || entry.text.slice(0, 20),
            message: `文案「${entry.text.replace(/\s+/g, ' ').slice(0, 40)}」提到「${foreign.join('、')}」，本项目产品事实里没有这些词——很可能是别的产品 / 模板遗留文案`,
            suggestion: facts.colorNames.length > 0
                ? `本品可用词：${[...facts.colorNames, ...facts.productTerms].slice(0, 8).join('、')}；示例应改成本品的组合（如「1双${facts.colorNames[0]}+1双${facts.colorNames[1] || facts.colorNames[0]}」）`
                : `请按本品的颜色 / 款式改写`
        });
    }
    return findings;
}

/** ② 模板里的产品图来源：不是本项目素材就要提示替换 */
export function checkTemplateAssetSources(
    templateImages: Array<{ layerName?: string; sourcePath?: string; sourceName?: string }>,
    projectAssetNames: string[]
): FactCheckFinding[] {
    const names = new Set(projectAssetNames.map((name) => clean(name).toLowerCase()));
    if (names.size === 0) return [];
    const findings: FactCheckFinding[] = [];
    for (const image of templateImages) {
        const key = clean(image.sourceName || image.sourcePath?.split(/[\\/]/).pop() || '').toLowerCase();
        if (!key) continue;
        if (names.has(key)) continue;
        findings.push({
            code: 'template_asset_not_from_project',
            severity: 'hard',
            subject: image.layerName || key,
            message: `模板里的图「${image.layerName || key}」来自「${key}」，不是本项目素材——模板可能来自别的产品`,
            suggestion: '把该占位图替换为本项目的产品图后再出图'
        });
    }
    return findings;
}

/** ③ SKU 组合默认不重复色 */
export function checkSkuCombosDistinctColors(
    combos: Array<{ size: number; colors: string[] }>,
    options: { allowDuplicate?: boolean } = {}
): FactCheckFinding[] {
    if (options.allowDuplicate) return [];
    const findings: FactCheckFinding[] = [];
    combos.forEach((combo, index) => {
        const seen = new Set<string>();
        const dup = combo.colors.map(clean).filter((color) => (seen.has(color) ? true : (seen.add(color), false)));
        if (dup.length === 0) return;
        findings.push({
            code: 'sku_combo_duplicate_color',
            severity: 'hard',
            subject: `${combo.size}双 第${index + 1}组`,
            message: `${combo.size}双第${index + 1}组「${combo.colors.join('+')}」重复了「${Array.from(new Set(dup)).join('、')}」`,
            suggestion: '组合默认不重复色；确实要同色多双请在需求里明说'
        });
    });
    return findings;
}

const FUNCTION_CLAIM_HINT = /(3D|立体|抗菌|抑菌|防臭|除臭|防滑|吸汗|速干|透气|亲肤|不勒|无骨|弹力|塑形|保暖|加厚|加绒|抗起球|防起球|耐磨|恒温|凉感|冰丝|纯棉|精梳棉|羊毛|莫代尔|棉|银离子|石墨烯|远红外|A类|婴儿级|医用|压力|分压|微压)/u;

/**
 * ④ 文案功能词有来源：文案里的功能 / 材质 / 工艺词（透气、抗菌、3D 立体…）必须能在「产品事实」里找到
 *（产品图上看到的、用户给的、资料里的）；找不到 = 编的（真机：主图写「3D立体编织 / 透气亲肤」而产品事实里没有）。
 */
export function checkFunctionalClaims(
    texts: Array<{ layerName?: string; text: string }>,
    productFacts: string[]
): FactCheckFinding[] {
    const factText = productFacts.map(clean).filter(Boolean).join('|');
    const findings: FactCheckFinding[] = [];
    for (const entry of texts) {
        const source = String(entry.text || '');
        const claims = new Set<string>();
        for (const match of source.matchAll(/[A-Za-z0-9一-龥]{2,6}/gu)) {
            const term = match[0];
            if (FUNCTION_CLAIM_HINT.test(term)) claims.add(term);
        }
        const unsourced = Array.from(claims).filter((term) => {
            if (!factText) return true;
            const t = clean(term);
            if (factText.includes(t)) return false;
            // 复合词只要功能核心字（透气 / 抗菌 / 3D…）在事实里出现就算有来源
            const core = t.match(FUNCTION_CLAIM_HINT)?.[0];
            return !(core && factText.includes(core));
        });
        if (unsourced.length === 0) continue;
        findings.push({
            code: 'copy_term_not_in_facts',
            severity: 'hard',
            subject: entry.layerName || source.slice(0, 20),
            message: `文案「${source.replace(/\s+/g, ' ').slice(0, 30)}」里的功能 / 材质词「${unsourced.join('、')}」在产品事实里没有来源——画面看不出、用户没说的功能不能写`,
            suggestion: productFacts.length > 0
                ? `只写能从产品事实里找到依据的词（当前事实：${productFacts.slice(0, 6).join('、')}）；不确定就写看得见的（形态 / 颜色 / 款式）`
                : '先看产品图或问用户，把产品事实写进 rationale.copySource / productFacts，再写功能词'
        });
    }
    return findings;
}

/** 汇总成给模型 / 界面看的一段话 */
export function describeFactCheckFindings(findings: FactCheckFinding[]): string {
    if (findings.length === 0) return '对不对核对：未发现与本品不符之处。';
    return [
        `对不对核对：发现 ${findings.length} 处与本品不符（先改对，再谈好看）`,
        ...findings.map((finding, index) => `${index + 1}. ${finding.message}${finding.suggestion ? `。建议：${finding.suggestion}` : ''}`)
    ].join('\n');
}
