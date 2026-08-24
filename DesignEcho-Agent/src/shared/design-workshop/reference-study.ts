/**
 * 看参考（reference-study）——像设计师那样带着目的看一张参考：
 *   ① 好在哪 / 差在哪（说得出）② 推演它是怎么做的（构图分区、色板、字体气质、背景处理、主体处理）
 *   ③ 换成我们的产品该怎么改（哪里可以更好，如字体 / 排版）④ 好的沉淀成候选，差的写成改进
 * 输出里带一份可直接喂给 composeDesign 的自由构图 regions（归一化），让「推演」变成可执行的起手式。
 * 纯逻辑：提示词与解析；看图 IO 在主进程。
 */

export interface ReferenceStudyResult {
    version: 'reference-study/v1';
    /** 一句话：这张参考在做什么、气质是什么 */
    summary: string;
    strengths: string[];
    weaknesses: string[];
    /** 推演：怎么做的 */
    howItWasMade: {
        composition: string;
        palette: string[];
        typography: string;
        background: string;
        subjectTreatment: string;
    };
    /** 换成我们的产品 / 目的时的改进点 */
    improvements: string[];
    /** 可执行起手式：归一化区域（role/content 占位/bounds/hAlign） */
    suggestedRegions: Array<{ role: string; content: string; bounds: { x: number; y: number; width: number; height: number }; hAlign?: 'left' | 'center' | 'right' }>;
    /** 值得沉淀的原则（一句一条） */
    takeaways: string[];
    rawText?: string;
    model?: string;
}

export function buildReferenceStudyPrompt(input: { purpose?: string; deliverable?: string; productContext?: string }): string {
    const lines = [
        '你是一位资深电商视觉设计师，正在带着明确目的看一张参考图。不要泛泛夸，要说得出、推得出、改得动。',
        input.purpose ? `看它的目的：${input.purpose}` : '',
        input.deliverable ? `我要做的交付物：${input.deliverable}` : '',
        input.productContext ? `我的产品 / 项目背景：${input.productContext}` : '',
        '',
        '请回答：',
        '1. summary：它在做什么、气质是什么（一句）。',
        '2. strengths：好在哪，最多 4 条，每条指向画面上的具体处理（如「标题住左上留白、只占 40% 宽」）。',
        '3. weaknesses：差在哪 / 哪里可以更好，最多 4 条，同样具体（如「卖点行字距太松、与标题字重冲突」）。',
        '4. howItWasMade：推演它怎么做的——composition（分区与主体占比、视线路径）、palette（3–5 个 #RRGGBB）、typography（字体气质 / 字重 / 层级 / 字距）、background（底的材质 / 光 / 处理）、subjectTreatment（主体抠图 / 阴影 / 尺度）。',
        '5. improvements：换成我的产品和目的时，我该怎么改得更好，最多 4 条（如「字体换成更圆润的黑体呼应木耳边」）。',
        '6. suggestedRegions：把它的构图翻译成归一化区域（0..1），role 取 title/subtitle/selling-point/tag/main-image/decoration，content 用占位（如「主标题」「主体」），文字区域不得与 main-image 相交，给 hAlign。',
        '7. takeaways：值得沉淀成通用原则的话，最多 3 条，一句一条，不带品类词。',
        '',
        '只返回 JSON：{"summary":"","strengths":[""],"weaknesses":[""],"howItWasMade":{"composition":"","palette":["#RRGGBB"],"typography":"","background":"","subjectTreatment":""},"improvements":[""],"suggestedRegions":[{"role":"title","content":"主标题","bounds":{"x":0,"y":0,"width":0,"height":0},"hAlign":"left"}],"takeaways":[""]}'
    ];
    return lines.filter((line) => line !== null && line !== undefined && line !== '').join('\n');
}

function extractJson(text: string): any | null {
    const source = String(text || '');
    const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1] : source;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try { return JSON.parse(candidate.slice(start, end + 1)); } catch { return null; }
}

const list = (value: unknown, max: number): string[] => (Array.isArray(value) ? value : [])
    .map((item) => String(item || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, max);

const HEX = /^#[0-9a-fA-F]{6}$/;

export function parseReferenceStudy(text: string, model?: string): ReferenceStudyResult {
    const json = extractJson(text);
    if (!json || typeof json !== 'object') {
        return {
            version: 'reference-study/v1',
            summary: '',
            strengths: [], weaknesses: [],
            howItWasMade: { composition: '', palette: [], typography: '', background: '', subjectTreatment: '' },
            improvements: ['看参考的模型输出无法解析为 JSON；请重试或换支持读图的模型。'],
            suggestedRegions: [],
            takeaways: [],
            rawText: String(text || '').slice(0, 2000),
            model
        };
    }
    const how = json.howItWasMade || {};
    const regions = (Array.isArray(json.suggestedRegions) ? json.suggestedRegions : [])
        .map((region: any) => {
            const b = region?.bounds || {};
            const x = Number(b.x); const y = Number(b.y); const w = Number(b.width); const h = Number(b.height);
            if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0 || x < 0 || y < 0 || x + w > 1.001 || y + h > 1.001) return null;
            const role = String(region?.role || '').trim();
            if (!['title', 'subtitle', 'selling-point', 'tag', 'main-image', 'decoration'].includes(role)) return null;
            return {
                role,
                content: String(region?.content || (role === 'main-image' ? 'subject' : role)).trim(),
                bounds: { x, y, width: w, height: h },
                ...(region?.hAlign === 'center' || region?.hAlign === 'right' || region?.hAlign === 'left' ? { hAlign: region.hAlign } : {})
            };
        })
        .filter(Boolean) as ReferenceStudyResult['suggestedRegions'];
    return {
        version: 'reference-study/v1',
        summary: String(json.summary || '').trim(),
        strengths: list(json.strengths, 4),
        weaknesses: list(json.weaknesses, 4),
        howItWasMade: {
            composition: String(how.composition || '').trim(),
            palette: list(how.palette, 6).filter((hex) => HEX.test(hex)),
            typography: String(how.typography || '').trim(),
            background: String(how.background || '').trim(),
            subjectTreatment: String(how.subjectTreatment || '').trim()
        },
        improvements: list(json.improvements, 4),
        suggestedRegions: regions,
        takeaways: list(json.takeaways, 3),
        model
    };
}

/** 给模型 / 界面看的紧凑文本 */
export function renderReferenceStudy(result: ReferenceStudyResult): string {
    const lines = [
        `看参考：${result.summary || '（无摘要）'}`,
        result.strengths.length ? `好在：${result.strengths.map((s, i) => `${i + 1}.${s}`).join(' ')}` : '',
        result.weaknesses.length ? `差在 / 可更好：${result.weaknesses.map((s, i) => `${i + 1}.${s}`).join(' ')}` : '',
        `怎么做的：构图 ${result.howItWasMade.composition || '—'}；色板 ${result.howItWasMade.palette.join(' ') || '—'}；字 ${result.howItWasMade.typography || '—'}；底 ${result.howItWasMade.background || '—'}；主体 ${result.howItWasMade.subjectTreatment || '—'}`,
        result.improvements.length ? `换成我们该怎么改：${result.improvements.map((s, i) => `${i + 1}.${s}`).join(' ')}` : '',
        result.suggestedRegions.length ? `起手式：${result.suggestedRegions.length} 个区域已按归一化坐标给出（可直接作 composeDesign 的 layout.regions）` : '',
        result.takeaways.length ? `沉淀：${result.takeaways.join('；')}` : ''
    ];
    return lines.filter(Boolean).join('\n');
}
