// 「对不对」核对器纯逻辑测试：真机病例（别品模板文案「1双小花+1双条纹」/ 别品模板图 / 重复色组合）必须被发现并给出可执行建议。
const path = require('path');
const root = path.resolve(__dirname, '..');
require('ts-node').register({ transpileOnly: true, project: path.join(root, 'tsconfig.main.json') });
const {
    buildProductFactSheet, extractCopyClaimTerms, checkCopyAgainstFacts, checkTemplateAssetSources, checkSkuCombosDistinctColors, describeFactCheckFindings
} = require(path.join(root, 'src/shared/design-fact-check.ts'));

let failed = 0;
function check(name, condition, detail) { if (condition) { console.log(`✅ ${name}`); return; } failed += 1; console.log(`❌ ${name}${detail ? ' — ' + detail : ''}`); }

const facts = buildProductFactSheet({
    colorNames: ['白色', '浅灰', '深灰', '浅咖', '深咖'],
    productTerms: ['直板木耳边微压', '中筒袜', '木耳边'],
    specTerms: ['2双装', '3双装', '4双装']
});

const terms = extractCopyClaimTerms('备注格式例如：1双小花+1双条纹');
check('抽出别品款式词', terms.includes('小花') && terms.includes('条纹'), terms.join(','));

const bad = checkCopyAgainstFacts([{ layerName: '备注示例', text: '备注格式例如：1双小花+1双条纹' }], facts);
check('别品文案被发现且为硬项', bad.length === 1 && bad[0].severity === 'hard' && /小花、条纹/.test(bad[0].message), JSON.stringify(bad));
check('建议给出本品可用词与示例', /1双白色\+1双浅灰/.test(bad[0].suggestion), bad[0].suggestion);

const good = checkCopyAgainstFacts([{ text: '备注格式例如：1双浅咖+1双深灰' }, { text: '留言备注 自选2双' }, { text: '木耳边花边袜口 微压条纹' }], facts);
check('本品文案不误报（含「微压条纹」这类本品词）', good.length === 0, JSON.stringify(good));

const noFacts = checkCopyAgainstFacts([{ text: '1双小花+1双条纹' }], buildProductFactSheet({}));
check('无事实表时不判定（不瞎报）', noFacts.length === 0);

const tpl = checkTemplateAssetSources([{ layerName: '2026-07-07 124018', sourceName: '2026-07-07 124018.jpg' }, { layerName: '浅咖', sourceName: '浅咖.jpg' }], ['浅咖.jpg', '深咖.jpg', '白色.jpg']);
check('别品模板图被发现，本品图不报', tpl.length === 1 && tpl[0].code === 'template_asset_not_from_project' && /2026-07-07 124018/.test(tpl[0].message), JSON.stringify(tpl));

const combos = checkSkuCombosDistinctColors([{ size: 3, colors: ['白色', '深咖', '深咖'] }, { size: 3, colors: ['白色', '白色', '浅灰'] }, { size: 2, colors: ['白色', '浅灰'] }]);
check('重复色组合被发现 2 组', combos.length === 2 && /深咖/.test(combos[0].message) && /白色/.test(combos[1].message), JSON.stringify(combos));
check('明说允许重复时不报', checkSkuCombosDistinctColors([{ size: 3, colors: ['白色', '白色', '浅灰'] }], { allowDuplicate: true }).length === 0);

// ④ 功能词有来源（真机：主图写「3D立体编织 / 透气亲肤 / 舒适不勒脚」而事实里只有木耳边 / 微压 / 五色）
const { checkFunctionalClaims } = require(path.join(root, 'src/shared/design-fact-check.ts'));
const claims = checkFunctionalClaims([{ layerName: '卖点-1', text: '3D立体编织' }, { text: '透气亲肤' }, { text: '舒适不勒脚' }, { text: '木耳花边袜口' }, { text: '微压条纹' }], ['木耳花边袜口', '微压条纹', '五色可选', '不勒脚']);
check('无来源功能词被抓（3D立体 / 透气 / 亲肤），有来源的（微压 / 不勒脚）不报', claims.length === 2 && /3D|立体/.test(claims[0].message) && /透气|亲肤/.test(claims[1].message), JSON.stringify(claims.map((c) => c.message)));
check('无事实表时功能词一律要来源', checkFunctionalClaims([{ text: '抗菌防臭' }], []).length === 1);

const text = describeFactCheckFindings([...bad, ...combos]);
check('汇总文本含条数与建议', /发现 3 处/.test(text) && /建议：/.test(text), text);

if (failed > 0) { console.log(`\n${failed} 项失败`); process.exit(1); }
console.log('\n全部通过');
