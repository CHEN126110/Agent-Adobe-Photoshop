/**
 * 设计评审器（design-evaluator）——「判断好不好看」的独立 advisory 评审，不让生成者自评。
 *
 * 依据 Anthropic 2026-03《Harness design for long-running application development》：
 *   把主观「好看」变成可打分的四条标准，权重放在整体感与原创性上，明确惩罚 AI slop；
 *   评审器与生成器分离、用少样本校准；输出分数 + 具体可执行批评，生成器据此改或转向。
 * 电商硬项由 design-fact-check（对不对）与几何测量提供，这里只做「好不好看」+ 汇总。
 *
 * 纯逻辑：提示词构造与结果解析；调用视觉模型的 IO 在主进程。
 */

export interface DesignEvaluationCriterionScore {
    key: 'coherence' | 'originality' | 'craft' | 'function';
    label: string;
    /** 0–10 */
    score: number;
    note: string;
}

export interface DesignEvaluationResult {
    version: 'design-evaluation/v1';
    /** 模型输出是否完整通过当前结构化协议；invalid 不能产生任务卡或学习副作用。 */
    protocolStatus: 'valid' | 'invalid';
    /** 独立视觉批评只提供改进证据，不拥有 canonical 质量或交付裁决权。 */
    authority: 'advisory_visual_critique';
    /** 0–10 加权总分 */
    overall: number;
    verdict: 'pass' | 'revise' | 'pivot';
    criteria: DesignEvaluationCriterionScore[];
    /** 具体、可执行的批评（最多 5 条，按影响排序） */
    critiques: string[];
    /** 保留什么、下一步改哪一两处 */
    nextMoves: string[];
    /** 与设计说明是否一致（说的和做的对不对得上） */
    intentAlignment?: string;
    /** 评审模式：reference=带参考对照（主模式），single=单图（2026-08-23 盲评实验：单图打分分辨力塌缩，仅作降级）。 */
    comparisonMode?: 'single' | 'reference';
    /** 对照模式下与参考的差距（对照是分数的锚）。 */
    referenceGap?: { gap: 'large' | 'medium' | 'small'; points: string[] };
    rawText?: string;
    model?: string;
}

export interface DesignEvaluationCalibrationSample {
    /** 好 / 差 */
    kind: 'good' | 'bad';
    /** 一句话为什么（用户原话） */
    why: string;
    /** 可选：路径或描述 */
    ref?: string;
}

const WEIGHTS: Record<DesignEvaluationCriterionScore['key'], number> = {
    coherence: 0.35,
    originality: 0.3,
    craft: 0.2,
    function: 0.15
};

const CRITERIA_LABEL: Record<DesignEvaluationCriterionScore['key'], string> = {
    coherence: '整体感',
    originality: '原创性',
    craft: '工艺',
    function: '功能'
};

/** 给视觉模型的评审提示（中文；要求 JSON）。 */
export function buildDesignEvaluationPrompt(input: {
    rationale?: string;
    deliverable?: string;
    hardFindings?: string[];
    /** 与同项目近期稿的雷同点（配方 / 底色 / 标题 / 照片 / 角度），计入原创性 */
    sameness?: string[];
    calibration?: DesignEvaluationCalibrationSample[];
    /** 对照参考：有它评审进入对照模式（2026-08-23 盲评实验：模型成对比较 4/4 判对且理由具体，单图打分全挤 6-7 分）。 */
    reference?: { kind: 'user_reference' | 'previous_version'; note?: string };
    /** 是否附带当前稿的列表尺寸缩略图（多尺度复核：主图的真实使用场景就是搜索列表缩略）。 */
    thumbnail?: boolean;
}): string {
    const lines: string[] = [
        '你是一位挑剔的电商视觉总监，正在评审另一位设计师刚做的一张画面。不要客气，不要泛泛表扬；只说画面上看得见的事实。',
        ''
    ];
    if (input.reference) {
        const referenceLabel = input.reference.kind === 'previous_version' ? '这张稿的上一个版本' : '一张对照参考（用户认可的方向）';
        lines.push(
            `你会看到${input.thumbnail ? '三' : '两'}张图：第一张是被评审的当前稿，第二张是${referenceLabel}${input.reference.note ? `（${input.reference.note}）` : ''}。`,
            '对照是评审的主要依据：先逐项说出当前稿与第二张图的具体差距（构图 / 光影 / 文案层级 / 场景感 / 质感），再打分——当前稿哪一项不如参考，就压低对应标准的分数；比参考好的地方也要如实说。',
            '注意：对照的目的是校准差距，不是要求照抄参考。参考的构图可以不同，但它体现的专业水准（层级清晰、光影真实、场景带入）是打分的锚。',
            ''
        );
    } else if (input.thumbnail) {
        lines.push('你会看到两张图：第一张是被评审的当前稿。', '');
    }
    if (input.thumbnail) {
        lines.push(
            '最后一张图是当前稿缩到搜索列表尺寸的缩略图——这是买家第一眼真正看到的状态。必须单独检查：缩略状态下主体是否仍然可辨、标题是否仍然可读、层级是否仍然成立；在缩略里塌掉的层级或消失的信息要在 critiques 里点名。',
            ''
        );
    }
    lines.push(
        '按四条标准各打 0–10 分：',
        '1. 整体感（coherence）：像一件完整作品，还是零件堆在一起？色彩、字体、版式、图片是否形成一种明确的气质。',
        '2. 原创性（originality）：看得出人的判断，还是模板 / 默认 / AI 味（如无来由的紫色渐变、居中大字堆砌、和产品无关的装饰）？',
        '3. 工艺（craft）：层级、间距、对齐、字距、对比度、抠图边缘、阴影自然度。基本功错误要点名。',
        '4. 功能（function）：一眼看懂卖什么、主张是什么、下一步该干什么；文字可读；主体在实际使用尺寸下可辨，尺度、留白与裁切服务当前任务。',
        '',
        '整体感与原创性权重更高。给出 advisory verdict：pass（当前画面暂无明确修改建议，不代表正式质量通过或可交付）/ revise（方向可用，但需要解决仍在损害目标的视觉关系）/ pivot（核心素材、构图机制或方向本身没有解决任务）。',
        '每个 criteria.note 必须写一条非空的画面依据；不得省略四个维度，也不得用字符串或越界数字表示 score。',
        'critiques 最多 5 条，必须按对用户目标的影响从高到低排列，不得因为字号、间距或边缘更容易描述就把它们放在方向、素材角色或主焦点失效之前。每条都要指向可见关系和预期效果，不要抽象词。',
        'pass 时 critiques 必须是空数组；revise 或 pivot 时 critiques 至少一条。nextMoves 始终为 1–3 条：先说必须保留的有效关系，再给出能解决最高影响根因的语义级修订。如果根因是素材或方向，应明确说替换关系或换方向，不要用局部移动、缩放或叠加掩盖。'
    );
    if (input.deliverable) lines.push('', `交付物：${input.deliverable}`);
    if (input.rationale) {
        lines.push('', '设计师自述的设计说明（评审要对照：说的和做的对不对得上）：', input.rationale);
    }
    if (input.hardFindings && input.hardFindings.length > 0) {
        lines.push('', '设计师希望你重点核对的画面疑点（这些是待验证假设，不是规则事实；只有当像素真实显示问题时才可计入分数，不得因其被提及就优先扣分）：', ...input.hardFindings.map((item) => `- ${item}`));
    }
    if (input.sameness && input.sameness.length > 0) {
        lines.push('', '与这位设计师同一项目近期几稿对照发现的雷同（计入 originality 扣分；如果这稿说不出自己的角度、和上一稿差在哪，就在 critiques 里点名「又是这套」并建议换角度）：', ...input.sameness.map((item) => `- ${item}`));
    }
    if (input.calibration && input.calibration.length > 0) {
        lines.push('', '这位用户的品味校准样本（他觉得好 / 不好的原因，评审口味要向它靠）：');
        for (const sample of input.calibration.slice(0, 10)) {
            lines.push(`- ${sample.kind === 'good' ? '好' : '差'}：${sample.why}${sample.ref ? `（${sample.ref}）` : ''}`);
        }
    }
    if (input.reference) {
        lines.push(
            '',
            '只返回 JSON，不要其它文字：',
            '{"referenceGap":{"gap":"large|medium|small","points":["与参考的具体差距"]},"criteria":{"coherence":{"score":0,"note":"整体关系的可见依据"},"originality":{"score":0,"note":"原创判断的可见依据"},"craft":{"score":0,"note":"工艺判断的可见依据"},"function":{"score":0,"note":"功能判断的可见依据"}},"verdict":"pass|revise|pivot","critiques":[],"nextMoves":["必须保留或优先修改的关系"],"intentAlignment":"设计说明与画面的对应关系"}'
        );
    } else {
        lines.push(
            '',
            '只返回 JSON，不要其它文字：',
            '{"criteria":{"coherence":{"score":0,"note":"整体关系的可见依据"},"originality":{"score":0,"note":"原创判断的可见依据"},"craft":{"score":0,"note":"工艺判断的可见依据"},"function":{"score":0,"note":"功能判断的可见依据"}},"verdict":"pass|revise|pivot","critiques":[],"nextMoves":["必须保留或优先修改的关系"],"intentAlignment":"设计说明与画面的对应关系"}'
        );
    }
    return lines.join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function extractJson(text: string): unknown {
    const source = String(text || '');
    const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1] : source;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
        return JSON.parse(candidate.slice(start, end + 1));
    } catch {
        return null;
    }
}

function parseReferenceGap(value: unknown): DesignEvaluationResult['referenceGap'] {
    if (!isRecord(value)) return undefined;
    const record = value;
    const gapRaw = String(record.gap || '').toLowerCase();
    if (gapRaw !== 'large' && gapRaw !== 'medium' && gapRaw !== 'small') return undefined;
    const gap: 'large' | 'medium' | 'small' = gapRaw;
    const points = (Array.isArray(record.points) ? record.points : [])
        .map((item) => String(item || '').trim()).filter(Boolean).slice(0, 5);
    if (points.length === 0) return undefined;
    return { gap, points };
}

function buildInvalidDesignEvaluation(
    text: string,
    model: string | undefined,
    reason: string
): DesignEvaluationResult {
    return {
        version: 'design-evaluation/v1',
        protocolStatus: 'invalid',
        authority: 'advisory_visual_critique',
        overall: 0,
        verdict: 'revise',
        criteria: [],
        critiques: [reason],
        nextMoves: ['重新评审一次；若仍失败，检查视觉模型的结构化输出和读图能力。'],
        rawText: String(text || '').slice(0, 2000),
        model
    };
}

function readStrictStringList(value: unknown, max: number): string[] | undefined {
    if (!Array.isArray(value) || value.length > max) return undefined;
    if (value.some((item) => typeof item !== 'string' || !item.trim())) return undefined;
    return value.map((item) => String(item).trim());
}

/** 解析模型输出为结构化评审；解析失败时给出「无法解析」的诚实结果而不是伪分。 */
export function parseDesignEvaluation(text: string, model?: string): DesignEvaluationResult {
    const json = extractJson(text);
    if (!isRecord(json)) {
        return buildInvalidDesignEvaluation(
            text,
            model,
            '评审器输出无法解析为 JSON；本次没有可用分数。'
        );
    }
    if (!isRecord(json.criteria)) {
        return buildInvalidDesignEvaluation(text, model, '评审协议缺少完整 criteria 对象；本次没有可用分数。');
    }
    const criteria: DesignEvaluationCriterionScore[] = [];
    for (const key of Object.keys(WEIGHTS) as Array<DesignEvaluationCriterionScore['key']>) {
        const raw = json.criteria[key];
        if (!isRecord(raw)
            || typeof raw.score !== 'number'
            || !Number.isFinite(raw.score)
            || raw.score < 0
            || raw.score > 10
            || typeof raw.note !== 'string'
            || !raw.note.trim()) {
            return buildInvalidDesignEvaluation(
                text,
                model,
                `评审协议中的 ${key} 必须包含 0–10 数字分数和非空说明；本次没有可用分数。`
            );
        }
        criteria.push({
            key,
            label: CRITERIA_LABEL[key],
            score: Math.round(raw.score * 10) / 10,
            note: raw.note.trim()
        });
    }
    const overall = Math.round(criteria.reduce((sum, item) => sum + item.score * WEIGHTS[item.key], 0) * 10) / 10;
    const verdictRaw = String(json.verdict || '').toLowerCase();
    if (verdictRaw !== 'pass' && verdictRaw !== 'revise' && verdictRaw !== 'pivot') {
        return buildInvalidDesignEvaluation(text, model, '评审协议的 verdict 非法；本次没有可用分数。');
    }
    const verdict = verdictRaw as DesignEvaluationResult['verdict'];
    const critiques = readStrictStringList(json.critiques, 5);
    const nextMoves = readStrictStringList(json.nextMoves, 3);
    if (!critiques
        || !nextMoves
        || nextMoves.length === 0
        || (verdict === 'pass' && critiques.length > 0)
        || (verdict !== 'pass' && critiques.length === 0)) {
        return buildInvalidDesignEvaluation(
            text,
            model,
            '评审协议的 critiques、nextMoves 与 verdict 不一致；本次没有可用分数。'
        );
    }
    const referenceGap = parseReferenceGap(json.referenceGap);
    if (json.referenceGap !== undefined && !referenceGap) {
        return buildInvalidDesignEvaluation(text, model, '评审协议的 referenceGap 不完整；本次没有可用分数。');
    }
    if (json.intentAlignment !== undefined && typeof json.intentAlignment !== 'string') {
        return buildInvalidDesignEvaluation(text, model, '评审协议的 intentAlignment 类型非法；本次没有可用分数。');
    }
    return {
        version: 'design-evaluation/v1',
        protocolStatus: 'valid',
        authority: 'advisory_visual_critique',
        overall,
        verdict,
        criteria,
        critiques,
        nextMoves,
        intentAlignment: String(json.intentAlignment || '').trim() || undefined,
        ...(referenceGap ? { referenceGap } : {}),
        rawText: undefined,
        model
    };
}

/** 一句话 advisory 摘要，进任务卡「验」栏与运行档案；不得冒充 canonical 质量结论。 */
export function summarizeDesignEvaluation(result: DesignEvaluationResult): string {
    if (result.criteria.length === 0) return `独立视觉评审：${result.critiques[0] || '无结果'}`;
    const parts = result.criteria.map((item) => `${item.label} ${item.score}`).join(' / ');
    let verdictLabel = '建议沿当前方向调整';
    if (result.verdict === 'pass') verdictLabel = '暂无明确修改建议（不代表正式质量通过）';
    else if (result.verdict === 'pivot') verdictLabel = '建议换方向';
    return `独立视觉评审 ${result.overall}/10（${parts}）· ${verdictLabel}${result.critiques[0] ? ` · 首要问题：${result.critiques[0]}` : ''}`;
}
