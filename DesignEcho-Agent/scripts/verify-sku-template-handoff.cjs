// SKU 缺模板 handoff 契约纯逻辑测试：模板定义、色卡只读、先找现成、版式建议几何。
const path = require('path');
const root = path.resolve(__dirname, '..');
require('ts-node').register({ transpileOnly: true, project: path.join(root, 'tsconfig.main.json') });
const {
    buildSkuTemplateDesignHandoffContract,
    buildSkuTemplateLayoutSuggestion
} = require(path.join(root, 'src/shared/sku-template-design-loop.ts'));

let failed = 0;
function check(condition, label, detail) {
    if (condition) {
        console.log(`  ✓ ${label}`);
        return;
    }
    failed += 1;
    console.error(`  ✗ ${label}${detail ? `：${detail}` : ''}`);
}

console.log('[1] handoff 契约文本');
const handoff = buildSkuTemplateDesignHandoffContract({
    missingTargets: [
        { size: 2, mode: 'combo', expectedItemCount: 2 },
        { size: 3, mode: 'combo', expectedItemCount: 3 },
        { size: 4, mode: 'combo', expectedItemCount: 4 }
    ],
    colorCount: 5,
    sourceDocumentName: 'SKU.psb',
    sourceCanvas: { width: 800, height: 800 },
    sourceCardAspectRatio: 154 / 234
});
const msg = handoff.message;
check(/独立的新文档/.test(msg) && /不置入任何颜色图/.test(msg), '定义：独立新文档 + 不置入颜色图');
check(/「SKU\.psb」是只读的颜色来源/.test(msg) && /不要与它同名/.test(msg), '色卡只读、不同名');
check(/先找现成再新建/.test(msg) && /importEagleAssetToProject/.test(msg) && /inspectTemplateLayout/.test(msg), '先找现成 + 合适判据分两半');
check(/regionCapacities：数组/.test(msg), 'region_composition 参数要求写明');
check(handoff.templateDesignToolNames.includes('openTemplate') && handoff.templateDesignToolNames.includes('importEagleAssetToProject'), '工具面含 openTemplate / importEagleAssetToProject');
check(!/模板方向已确认/.test(msg), '缺模板 handoff 不声称方向已确认');
check(handoff.templateLayoutSuggestions.length === 3, '三份版式建议', String(handoff.templateLayoutSuggestions.length));
check(/版式起点/.test(msg) && /三份共用同一套/.test(msg), '版式建议进入 message 且强调三份一致');

console.log('[2] 版式建议几何');
function inside(a, b) { return a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height; }
function overlap(a, b) { return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height; }
for (const suggestion of handoff.templateLayoutSuggestions) {
    const canvasBox = { x: 0, y: 0, width: 800, height: 800 };
    check(suggestion.slots.length === suggestion.size, `${suggestion.size}双装 槽位数 = 双数`);
    check(suggestion.slots.every((s) => inside(s, suggestion.cardFrame)), `${suggestion.size}双装 槽位都在卡片框内`, JSON.stringify(suggestion.slots));
    check(inside(suggestion.cardFrame, canvasBox), `${suggestion.size}双装 卡片框在画布内`);
    let anyOverlap = false;
    for (let i = 0; i < suggestion.slots.length; i += 1) {
        for (let j = i + 1; j < suggestion.slots.length; j += 1) {
            if (overlap(suggestion.slots[i], suggestion.slots[j])) anyOverlap = true;
        }
    }
    check(!anyOverlap, `${suggestion.size}双装 槽位互不重叠`);
    const lastSlotBottom = Math.max(...suggestion.slots.map((s) => s.y + s.height));
    check(suggestion.titleBox.y >= lastSlotBottom, `${suggestion.size}双装 标题在槽位下方`);
    check(suggestion.subtitleBox.y + suggestion.subtitleBox.height <= suggestion.cardFrame.y + suggestion.cardFrame.height, `${suggestion.size}双装 副标题不出卡片框`);
    check(suggestion.slots.every((s) => s.width >= 100), `${suggestion.size}双装 槽位不至于太窄（≥100）`, JSON.stringify(suggestion.slots[0]));
}
const tokens = handoff.templateLayoutSuggestions.map((s) => JSON.stringify(s.tokens));
check(new Set(tokens).size === 1, '三份共用同一套刻度');

console.log('[3] 自选备注 5 色分两行 / 缺尺寸不建议');
const note = buildSkuTemplateLayoutSuggestion({ size: 3, mode: 'self_select_note', slotCount: 5, canvas: { width: 800, height: 800 } });
check(Boolean(note) && note.slots.length === 5 && new Set(note.slots.map((s) => s.y)).size === 2, '5 个槽位分两行', note && JSON.stringify(note.slots.map((s) => s.y)));
check(buildSkuTemplateLayoutSuggestion({ size: 2, canvas: { width: 0, height: 0 } }) === undefined, '缺画布尺寸不给建议');
const repair = buildSkuTemplateDesignHandoffContract({
    repairTargets: [{ size: 3, templateName: '3双装.psb', expectedItemCount: 3, issue: '没有识别到可解析的 SKU 占位符。' }],
    colorCount: 3
});
check(repair.templateLayoutSuggestions.length === 0 && /占位结构需要修复/.test(repair.message) && repair.completionChecklist.some((item) => item.includes('重新 inspect')), '修复路径不给新建版式、保留修复口径');

if (failed > 0) {
    console.error(`\n[FAIL] SKU 模板 handoff：${failed} 项断言失败`);
    process.exit(1);
}
console.log('\n[OK] SKU 模板 handoff 纯逻辑测试通过');
