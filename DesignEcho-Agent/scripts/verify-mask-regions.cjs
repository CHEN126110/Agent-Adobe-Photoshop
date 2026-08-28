// 蒙版连通域拆分纯逻辑测试：显著性定位段的基础能力
const path = require('path');
const root = path.resolve(__dirname, '..');
require('ts-node').register({ transpileOnly: true, project: path.join(root, 'tsconfig.main.json') });
const {
    extractMaskRegions,
    measureMaskTargetCoverage,
    DEFAULT_MASK_REGION_OPTIONS
} = require(path.join(root, 'src/shared/mask-regions.ts'));

let failed = 0;
function check(name, cond, detail) {
    if (cond) { console.log(`✅ ${name}`); return; }
    failed += 1;
    console.log(`❌ ${name}${detail ? ' — ' + detail : ''}`);
}

const W = 100, H = 100;
const blank = () => new Uint8Array(W * H);
function fill(m, x1, y1, x2, y2) {
    for (let y = y1; y < y2; y++) for (let x = x1; x < x2; x++) m[y * W + x] = 255;
}

// 两个分离主体
const m1 = blank();
fill(m1, 5, 5, 35, 45);      // 1200px
fill(m1, 60, 10, 95, 60);    // 1750px
const r1 = extractMaskRegions(m1, W, H);
check('拆出 2 个分离主体', r1.length === 2, JSON.stringify(r1));
check('按面积降序', r1[0].area === 1750 && r1[1].area === 1200);
check('框坐标正确', r1[0].x1 === 60 && r1[0].y1 === 10 && r1[0].x2 === 95 && r1[0].y2 === 60, JSON.stringify(r1[0]));

// 相接的两块算一个
const m2 = blank();
fill(m2, 10, 10, 40, 40);
fill(m2, 40, 10, 70, 40);
check('相接的块合成一个', extractMaskRegions(m2, W, H).length === 1);

// 碎片过滤
const m3 = blank();
fill(m3, 5, 5, 45, 45);
fill(m3, 90, 90, 93, 93);    // 9px，低于 0.4% 下限
check('碎片被过滤', extractMaskRegions(m3, W, H).length === 1, JSON.stringify(extractMaskRegions(m3, W, H)));

// 数量上限
const m4 = blank();
for (let i = 0; i < 8; i++) fill(m4, i * 12 + 1, 1, i * 12 + 10, 40);
check('数量上限生效', extractMaskRegions(m4, W, H, { ...DEFAULT_MASK_REGION_OPTIONS, maxRegions: 3 }).length === 3);

// 边界与降级
check('空蒙版返回空', extractMaskRegions(blank(), W, H).length === 0);
check('尺寸非法安全返回', extractMaskRegions(blank(), 0, 0).length === 0);
check('缓冲区过短安全返回', extractMaskRegions(new Uint8Array(10), W, H).length === 0);

// 整图前景（常见于纯色背景已被去除的图层）
const m5 = blank();
fill(m5, 0, 0, W, H);
const r5 = extractMaskRegions(m5, W, H);
check('整图前景返回一个满幅框', r5.length === 1 && r5[0].x2 === W && r5[0].y2 === H, JSON.stringify(r5));

// union mask 必须覆盖每个声明目标，不能只成功一部分
const targetMask = blank();
fill(targetMask, 5, 5, 20, 20);
fill(targetMask, 60, 60, 80, 80);
const completeCoverage = measureMaskTargetCoverage(targetMask, W, H, [
    { x1: 0, y1: 0, x2: 25, y2: 25 },
    { x1: 55, y1: 55, x2: 85, y2: 85 }
]);
check('每个目标框都有前景时完整覆盖', completeCoverage.coveredCount === 2 && completeCoverage.uncoveredIndexes.length === 0, JSON.stringify(completeCoverage));
const partialCoverage = measureMaskTargetCoverage(targetMask, W, H, [
    { x1: 0, y1: 0, x2: 25, y2: 25 },
    { x1: 30, y1: 30, x2: 50, y2: 50 }
]);
check('第二个目标没前景时显式报告部分覆盖', partialCoverage.coveredCount === 1 && JSON.stringify(partialCoverage.uncoveredIndexes) === '[1]', JSON.stringify(partialCoverage));
const invalidCoverage = measureMaskTargetCoverage(targetMask, W, H, [
    { x1: 10, y1: 10, x2: 10, y2: 20 },
    { x1: Number.NaN, y1: 0, x2: 5, y2: 5 }
]);
check('退化或非有限目标框不会被夹成成功', JSON.stringify(invalidCoverage.invalidIndexes) === '[0,1]' && invalidCoverage.coveredCount === 0, JSON.stringify(invalidCoverage));
const shortCoverage = measureMaskTargetCoverage(new Uint8Array(10), W, H, [{ x1: 0, y1: 0, x2: 10, y2: 10 }]);
check('蒙版缓冲区不足时目标标记为无效', JSON.stringify(shortCoverage.invalidIndexes) === '[0]');

console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项未通过`);
process.exit(failed === 0 ? 0 : 1);
