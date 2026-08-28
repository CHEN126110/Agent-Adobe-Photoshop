#!/usr/bin/env node
/** GroundingDINO 文本侧纯逻辑回归：规范化、WordPiece 与短语 span。 */
const path = require('path');

const root = path.resolve(__dirname, '..');
require('ts-node').register({
    transpileOnly: true,
    project: path.join(root, 'tsconfig.main.json')
});

const { BertWordPieceTokenizer } = require(
    path.join(root, 'src/shared/bert-wordpiece-tokenizer.ts')
);

let failed = 0;
let passed = 0;
function check(name, condition, detail) {
    if (condition) {
        passed += 1;
        console.log(`✅ ${name}`);
        return;
    }
    failed += 1;
    console.log(`❌ ${name}${detail ? ` — ${detail}` : ''}`);
}

const vocab = {
    '[PAD]': 0,
    '[UNK]': 100,
    '[CLS]': 101,
    '[SEP]': 102,
    '.': 1012,
    '-': 1011,
    sock: 2001,
    shoe: 2002,
    red: 2003,
    bag: 2004,
    cafe: 2005,
    note: 2006,
    '##book': 2007,
    t: 2008,
    shirt: 2009
};

const tokenizer = new BertWordPieceTokenizer({
    model: {
        vocab,
        unk_token: '[UNK]',
        continuing_subword_prefix: '##',
        max_input_chars_per_word: 12
    }
});

check('英文统一小写并去重音', tokenizer.normalize('  CAFÉ\t') === '  cafe ');
check('CJK 两侧补空格并最终进入未知词', tokenizer.encode('袜').join(',') === '101,100,102');
check('标点被拆成独立 token', tokenizer.encode('T-shirt').join(',') === '101,2008,1011,2009,102');
check('WordPiece 使用最长前缀', tokenizer.wordPiece('notebook').join(',') === '2006,2007');
check('任一片段无法匹配时整词回退 UNK', tokenizer.wordPiece('notepad').join(',') === '100');
check('超过单词长度上限时回退 UNK', tokenizer.wordPiece('sockssockssocks').join(',') === '100');

const phrases = tokenizer.encodePhrases(['red bag', 'shoe']);
check('短语提示使用 GroundingDINO 点号格式', phrases.prompt === 'red bag . shoe .');
check(
    '短语 token span 与最终 ids 精确对齐',
    phrases.ids.join(',') === '101,2003,2004,1012,2002,1012,102'
        && JSON.stringify(phrases.spans) === JSON.stringify([
            { phrase: 'red bag', start: 1, end: 3 },
            { phrase: 'shoe', start: 4, end: 5 }
        ]),
    JSON.stringify(phrases)
);

let missingTokenError = '';
try {
    new BertWordPieceTokenizer({ model: { vocab: { '[CLS]': 101 } } });
} catch (error) {
    missingTokenError = error?.message || String(error);
}
check(
    '损坏词表在构造时明确失败而不是推理时 BigInt(undefined)',
    /缺少必需 token/.test(missingTokenError),
    missingTokenError
);

if (failed > 0) {
    console.error(`\n${failed} 项未通过，${passed} 项通过`);
    process.exit(1);
}
console.log(`\n全部通过（${passed} 项）`);
