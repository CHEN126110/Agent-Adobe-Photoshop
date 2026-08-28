// 目标词规范化纯逻辑测试：多目标拆分、修饰词组合、不猜、不依赖语言模型。
const path = require('path');
const root = path.resolve(__dirname, '..');
require('ts-node').register({ transpileOnly: true, project: path.join(root, 'tsconfig.main.json') });
const {
    resolveTargetPhrases,
    buildUnresolvedTargetHint
} = require(path.join(root, 'src/shared/semantic-target-vocabulary.ts'));

let failed = 0;
function check(name, cond, detail) {
    if (cond) { console.log(`✅ ${name}`); return; }
    failed += 1;
    console.log(`❌ ${name}${detail ? ' — ' + detail : ''}`);
}
const P = s => resolveTargetPhrases(s);

// ========== 真机失败案例 ==========
const multi = P('袜子、鞋子');
check(
    '真机案例：「袜子、鞋子」本地解析为两个目标（曾因此调用模型并失败）',
    JSON.stringify(multi.phrases) === '["sock","shoe"]' && multi.source === 'mapped',
    JSON.stringify(multi)
);

// ========== 多目标分隔 ==========
check('逗号分隔', JSON.stringify(P('袜子,鞋子').phrases) === '["sock","shoe"]');
check('中文逗号', JSON.stringify(P('袜子，鞋子').phrases) === '["sock","shoe"]');
check('“和”分隔', JSON.stringify(P('袜子和鞋子').phrases) === '["sock","shoe"]');
check('重复目标去重', JSON.stringify(P('袜子、袜子').phrases) === '["sock"]');
const overflow = P('袜子、鞋子、帽子、包、手表');
check(
    '数量上限 4 不静默丢弃第 5 项',
    overflow.phrases.length === 4
        && JSON.stringify(overflow.omitted) === '["手表"]'
        && overflow.source === 'partial',
    JSON.stringify(overflow)
);
check('超限提示要求拆分且明确本轮不做部分修改', /最多处理 4|拆成下一次/.test(buildUnresolvedTargetHint(overflow)) && /不会只处理其中一部分/.test(buildUnresolvedTargetHint(overflow)));

// ========== 单目标 ==========
check('英文直通', JSON.stringify(P('sock').phrases) === '["sock"]' && P('sock').source === 'direct');
check('英文多词短语不被空格拆开', JSON.stringify(P('red hand bag').phrases) === '["red hand bag"]');
check('中文单词', JSON.stringify(P('袜子').phrases) === '["sock"]');
check('运动鞋映射到更具体的词', JSON.stringify(P('运动鞋').phrases) === '["sneaker"]');
check('长筒袜与短袜区分', P('长筒袜').phrases[0] === 'stocking' && P('短袜').phrases[0] === 'sock');

// ========== 修饰词组合 ==========
check('颜色 + 主体', JSON.stringify(P('白色袜子').phrases) === '["white sock"]', JSON.stringify(P('白色袜子')));
check('材质 + 主体', JSON.stringify(P('皮鞋').phrases) === '["leather shoe"]');
check('方位 + 主体', JSON.stringify(P('左边的鞋子').phrases) === '["left shoe"]', JSON.stringify(P('左边的鞋子')));
check('长修饰词优先（米白不被“米”抢）', JSON.stringify(P('米白袜子').phrases) === '["off-white sock"]', JSON.stringify(P('米白袜子')));
check('赘词剥离', JSON.stringify(P('那只袜子').phrases) === '["sock"]', JSON.stringify(P('那只袜子')));

// ========== 不猜 ==========
const unknown = P('碎花堆堆袜');
check('生僻说法如实报未解析，不做子串猜测', unknown.phrases.length === 0 && unknown.source === 'unresolved', JSON.stringify(unknown));
check('未解析时给出可操作提示', /英文|通用/.test(buildUnresolvedTargetHint(unknown)));
check('提示不提及任何语言模型', !/模型|翻译|AI/.test(buildUnresolvedTargetHint(unknown).replace('语言模型', '')));

const partial = P('袜子、碎花堆堆袜');
check('部分解析：保留认识的，其余如实列出', JSON.stringify(partial.phrases) === '["sock"]' && partial.unresolved.length === 1 && partial.source === 'partial', JSON.stringify(partial));
check('部分解析提示明确不执行半份目标', /不会只处理其中一部分/.test(buildUnresolvedTargetHint(partial)));

const ambiguousNotebook = P('笔记本');
check(
    '歧义词不由本地词表替用户决定为电脑或纸本',
    ambiguousNotebook.phrases.length === 0
        && ambiguousNotebook.unresolved.includes('笔记本')
        && ambiguousNotebook.ambiguous.includes('笔记本'),
    JSON.stringify(ambiguousNotebook)
);
check(
    '歧义提示说明具体分歧而不是假装不认识',
    /笔记本电脑/.test(buildUnresolvedTargetHint(ambiguousNotebook))
        && /纸质笔记本/.test(buildUnresolvedTargetHint(ambiguousNotebook))
);
check('用户说清“笔记本电脑”后可确定解析', P('笔记本电脑').phrases[0] === 'laptop');
check('用户说清“纸质笔记本”后可确定解析', P('纸质笔记本').phrases[0] === 'notebook');

const ambiguousShoe = P('黑色单鞋');
check(
    '带颜色的歧义鞋型也不会被强行映射成平底鞋',
    ambiguousShoe.phrases.length === 0 && ambiguousShoe.ambiguous.includes('黑色单鞋'),
    JSON.stringify(ambiguousShoe)
);
check('明确平底单鞋后可确定解析', P('平底单鞋').phrases[0] === 'flat shoe');

// ========== 边界 ==========
check('空输入', P('').phrases.length === 0 && P('   ').phrases.length === 0);
check('纯分隔符', P('、、').phrases.length === 0);
check('保留原始输入', P('袜子').original === '袜子');
check('保留用户点名的目标片段用于完整性核对', JSON.stringify(P('袜子、鞋子').requested) === '["袜子","鞋子"]');

console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项未通过`);
process.exit(failed === 0 ? 0 : 1);
