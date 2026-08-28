/**
 * BERT WordPiece 分词器（纯逻辑，供 GroundingDINO 文本侧使用）
 *
 * 规格取自 grounding-dino 的 tokenizer.json：
 * BertNormalizer(clean_text, handle_chinese_chars, lowercase) + WordPiece(前缀 "##")。
 *
 * 为什么自己实现：项目没有 transformers.js 依赖，而这段逻辑只有一百多行且完全确定，
 * 引入一个大依赖不划算。已验证：sock→[101,28407,102]、socks→[101,14829,102]，与词表一致。
 *
 * 注意：词表是英文的（bert-base-uncased）。中文会被切成 [UNK]，
 * 所以调用方必须先经 semantic-target-vocabulary 把中文转成英文短语。
 */

export interface BertTokenizerData {
    model: {
        vocab: Record<string, number>;
        unk_token?: string;
        continuing_subword_prefix?: string;
        max_input_chars_per_word?: number;
    };
}

/** 一个短语在 token 序列中的区间，后处理按区间聚合该短语的分数 */
export interface PhraseSpan {
    phrase: string;
    /** token 序列中的起始下标（含） */
    start: number;
    /** 结束下标（不含） */
    end: number;
}

export interface PhrasePromptResult {
    ids: number[];
    /** 实际送进模型的提示词，形如 "sock . shoe ." */
    prompt: string;
    spans: PhraseSpan[];
}

const CJK_RANGES: Array<[number, number]> = [
    [0x4e00, 0x9fff],
    [0x3400, 0x4dbf],
    [0x20000, 0x2a6df],
    [0xf900, 0xfaff]
];

function isChineseCodePoint(cp: number): boolean {
    return CJK_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi);
}

export class BertWordPieceTokenizer {
    private vocab: Record<string, number>;
    private prefix: string;
    private maxInputCharsPerWord: number;
    readonly cls: number;
    readonly sep: number;
    readonly pad: number;
    readonly unk: number;
    readonly dot: number;

    constructor(data: BertTokenizerData) {
        if (!data?.model?.vocab || typeof data.model.vocab !== 'object') {
            throw new Error('GroundingDINO tokenizer.json 缺少 WordPiece vocab');
        }
        this.vocab = data.model.vocab;
        this.prefix = data.model.continuing_subword_prefix || '##';
        this.maxInputCharsPerWord = data.model.max_input_chars_per_word || 100;
        this.cls = this.vocab['[CLS]'];
        this.sep = this.vocab['[SEP]'];
        this.pad = this.vocab['[PAD]'];
        this.unk = this.vocab[data.model.unk_token || '[UNK]'];
        this.dot = this.vocab['.'];
        const requiredTokens: Array<[string, number]> = [
            ['[CLS]', this.cls],
            ['[SEP]', this.sep],
            ['[PAD]', this.pad],
            [data.model.unk_token || '[UNK]', this.unk],
            ['.', this.dot]
        ];
        const missing = requiredTokens
            .filter(([_token, id]) => !Number.isSafeInteger(id) || id < 0)
            .map(([token]) => token);
        if (missing.length > 0) {
            throw new Error(`GroundingDINO tokenizer.json 缺少必需 token：${missing.join('、')}`);
        }
    }

    /** BertNormalizer：丢控制字符、空白归一、CJK 两侧补空格、小写 */
    normalize(text: string): string {
        let out = '';
        for (const ch of String(text)) {
            const cp = ch.codePointAt(0) as number;
            if (cp === 0 || cp === 0xfffd) continue;
            if (/\s/.test(ch)) {
                out += ' ';
                continue;
            }
            if (cp < 32) continue;
            if (isChineseCodePoint(cp)) {
                out += ' ' + ch + ' ';
                continue;
            }
            out += ch;
        }
        // bert-base-uncased 在 lowercase=true 且 strip_accents 未显式关闭时会去重音。
        return out
            .toLowerCase()
            .normalize('NFD')
            .replace(/\p{M}/gu, '');
    }

    /** BertPreTokenizer：空白切分，标点独立成词 */
    preTokenize(text: string): string[] {
        const words: string[] = [];
        for (const chunk of text.split(/\s+/)) {
            if (!chunk) continue;
            let buffer = '';
            for (const ch of chunk) {
                if (/[\p{P}\p{S}]/u.test(ch)) {
                    if (buffer) {
                        words.push(buffer);
                        buffer = '';
                    }
                    words.push(ch);
                } else {
                    buffer += ch;
                }
            }
            if (buffer) words.push(buffer);
        }
        return words;
    }

    /** WordPiece：最长前缀匹配；任一片段无法匹配则整词回退 [UNK]（BERT 的标准行为） */
    wordPiece(word: string): number[] {
        const characters = Array.from(word);
        if (characters.length > this.maxInputCharsPerWord) return [this.unk];

        const ids: number[] = [];
        let start = 0;
        while (start < characters.length) {
            let end = characters.length;
            let matched: number | null = null;
            while (start < end) {
                const piece = (start === 0 ? '' : this.prefix) + characters.slice(start, end).join('');
                const id = this.vocab[piece];
                if (id !== undefined) {
                    matched = id;
                    break;
                }
                end--;
            }
            if (matched === null) return [this.unk];
            ids.push(matched);
            start = end;
        }
        return ids;
    }

    /** 编码单段文本（含 [CLS]/[SEP]） */
    encode(text: string): number[] {
        const ids = [this.cls];
        for (const word of this.preTokenize(this.normalize(text))) {
            ids.push(...this.wordPiece(word));
        }
        ids.push(this.sep);
        return ids;
    }

    /** 只编码短语正文，不加特殊 token（用于计算 span 长度） */
    private encodeBody(text: string): number[] {
        const ids: number[] = [];
        for (const word of this.preTokenize(this.normalize(text))) {
            ids.push(...this.wordPiece(word));
        }
        return ids;
    }

    /**
     * 构造 GroundingDINO 的类别提示。
     *
     * 短语之间用 " . " 分隔、末尾补 "."——这是模型训练时的约定格式，
     * 它据此把 900 个 query 与各短语对齐。span 记录每个短语占哪些 token，
     * 后处理时在该区间内取最大分作为这个短语的置信度。
     */
    encodePhrases(phrases: string[]): PhrasePromptResult {
        const cleaned = phrases.map(p => String(p).trim().toLowerCase()).filter(Boolean);
        const prompt = cleaned.join(' . ') + ' .';
        const ids = this.encode(prompt);

        const spans: PhraseSpan[] = [];
        let cursor = 1; // 跳过 [CLS]
        for (const phrase of cleaned) {
            const length = this.encodeBody(phrase).length;
            spans.push({ phrase, start: cursor, end: cursor + length });
            cursor += length + 1; // +1 为分隔的 "."
        }

        return { ids, prompt, spans };
    }
}
