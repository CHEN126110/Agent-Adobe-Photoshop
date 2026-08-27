// 语义抠图候选物体纯逻辑测试：连通域拆分、编号连续性、labels 一致性、模型选择解析。
const path = require('path');
const root = path.resolve(__dirname, '..');
require('ts-node').register({ transpileOnly: true, project: path.join(root, 'tsconfig.main.json') });
const {
    DEFAULT_CANDIDATE_EXTRACTION,
    buildCandidatePointGrid,
    extractMaskComponents,
    findUncoveredPoint,
    maskIoU,
    parseCandidateSelection,
    resolveGridShape
} = require(path.join(root, 'src/shared/semantic-target-candidates.ts'));

let failed = 0;
function check(name, condition, detail) {
    if (condition) { console.log(`✅ ${name}`); return; }
    failed += 1;
    console.log(`❌ ${name}${detail ? ' — ' + detail : ''}`);
}

// 构造一张 100x100 蒙版：左上小块、右上大块、中间细线（噪点）
const W = 100, H = 100;
function blankMask() { return new Uint8Array(W * H); }
function fillRect(mask, x1, y1, x2, y2, value = 255) {
    for (let y = y1; y < y2; y++) for (let x = x1; x < x2; x++) mask[y * W + x] = value;
}

// ========== 连通域拆分 ==========

const mask = blankMask();
fillRect(mask, 5, 5, 25, 25);      // 400px
fillRect(mask, 60, 5, 95, 40);     // 1225px
fillRect(mask, 50, 90, 52, 92);    // 4px 噪点，应被面积下限过滤

const { candidates, labels } = extractMaskComponents(mask, W, H, DEFAULT_CANDIDATE_EXTRACTION);

check('拆出 2 个候选（噪点被过滤）', candidates.length === 2, JSON.stringify(candidates));
check('按面积从大到小排序', candidates[0].area === 1225 && candidates[1].area === 400, JSON.stringify(candidates));
check('编号从 1 开始且连续', candidates.map(c => c.id).join(',') === '1,2', candidates.map(c => c.id).join(','));
check(
    '最大候选的框正确',
    candidates[0].x1 === 60 && candidates[0].y1 === 5 && candidates[0].x2 === 95 && candidates[0].y2 === 40,
    JSON.stringify(candidates[0])
);
check(
    'labels 与候选编号一致',
    labels[10 * W + 70] === 1 && labels[10 * W + 10] === 2,
    `大块=${labels[10 * W + 70]} 小块=${labels[10 * W + 10]}`
);
check('被过滤的噪点在 labels 中归零', labels[91 * W + 51] === 0, String(labels[91 * W + 51]));
check('背景像素为 0', labels[50 * W + 50] === 0);

const touching = blankMask();
fillRect(touching, 10, 10, 30, 30);
fillRect(touching, 30, 10, 50, 30);   // 与上一块相邻，4 邻域下应连成一个
check(
    '相接的两块按连通性合成一个候选',
    extractMaskComponents(touching, W, H).candidates.length === 1,
    JSON.stringify(extractMaskComponents(touching, W, H).candidates)
);

const many = blankMask();
for (let i = 0; i < 8; i++) fillRect(many, i * 12 + 1, 1, i * 12 + 11, 40);
const limited = extractMaskComponents(many, W, H, { ...DEFAULT_CANDIDATE_EXTRACTION, maxCandidates: 3 });
check('超出 maxCandidates 时截断', limited.candidates.length === 3, String(limited.candidates.length));
check('截断后编号仍连续', limited.candidates.map(c => c.id).join(',') === '1,2,3');
check(
    '截断后 labels 不残留超限编号',
    limited.labels.every(v => v >= 0 && v <= 3),
    '存在越界 label'
);

check('空蒙版返回空候选', extractMaskComponents(blankMask(), W, H).candidates.length === 0);
check('尺寸非法时安全返回', extractMaskComponents(blankMask(), 0, 0).candidates.length === 0);

// ========== 模型选择解析 ==========

const ids = [1, 2, 3];

check(
    '标准 JSON 选择',
    JSON.stringify(parseCandidateSelection('{"selected":[1,3]}', ids).selected) === '[1,3]'
);
check(
    '带解释文字的 JSON 仍可解析',
    JSON.stringify(parseCandidateSelection('我看了图。\n```json\n{"selected":[2]}\n```', ids).selected) === '[2]'
);
check(
    '越界编号被剔除',
    JSON.stringify(parseCandidateSelection('{"selected":[1,9,3]}', ids).selected) === '[1,3]'
);
check(
    '重复编号去重并排序',
    JSON.stringify(parseCandidateSelection('{"selected":[3,1,3]}', ids).selected) === '[1,3]'
);
check(
    '空数组按"都不是"处理',
    parseCandidateSelection('{"selected":[]}', ids).noneMatched === true
);
check(
    '自然语言作答可兜底提取编号',
    JSON.stringify(parseCandidateSelection('编号 1 和 3 是袜子。', ids).selected) === '[1,3]',
    JSON.stringify(parseCandidateSelection('编号 1 和 3 是袜子。', ids))
);
check(
    '自然语言说都不是',
    parseCandidateSelection('图中没有一个是袜子。', ids).noneMatched === true,
    JSON.stringify(parseCandidateSelection('图中没有一个是袜子。', ids))
);
check('空返回如实报错', !!parseCandidateSelection('', ids).parseError);
check(
    '完全无关的回答如实报错',
    !!parseCandidateSelection('这张图的构图很好看，光影柔和。', ids).parseError,
    JSON.stringify(parseCandidateSelection('这张图的构图很好看，光影柔和。', ids))
);

// ========== 兜底解析的收紧（真机：模型全选 = 没选） ==========

const five = [1, 2, 3, 4, 5];
const prose = '看到了这张图：编号 1 是模特的腿，编号 2 是袜筒，编号 3 是袜口的荷叶边，'
    + '编号 4 是鞋面，编号 5 是鞋底。整体构图为竖版 683x1024，光影柔和。';
const proseResult = parseCandidateSelection(prose, five);
check(
    '长篇描述里逐个提到全部编号不算选择',
    proseResult.selected.length === 0 && !!proseResult.parseError,
    JSON.stringify(proseResult)
);

check(
    '短回答直接给编号可提取',
    JSON.stringify(parseCandidateSelection('3', five).selected) === '[3]'
);
check(
    '短回答给多个编号可提取',
    JSON.stringify(parseCandidateSelection('2, 3', five).selected) === '[2,3]'
);
check(
    '选择措辞后的编号可提取',
    JSON.stringify(parseCandidateSelection('我选择 2 和 4 这两个，它们是袜子的组成部分，其余都不是。', five).selected) === '[2,4]',
    JSON.stringify(parseCandidateSelection('我选择 2 和 4 这两个，它们是袜子的组成部分，其余都不是。', five))
);
check(
    'JSON 明确全选时仍然接受（图里可能真的全是目标）',
    JSON.stringify(parseCandidateSelection('{"selected":[1,2,3,4,5]}', five).selected) === '[1,2,3,4,5]'
);
check(
    '候选少于 3 个时不套用全选拦截',
    JSON.stringify(parseCandidateSelection('1, 2', [1, 2]).selected) === '[1,2]'
);
check(
    '无关长描述仍如实报错',
    !!parseCandidateSelection('这张图整体色调偏暖，背景干净，商品居中偏下，留白舒适，适合做主图使用。', five).parseError
);

// ========== 撒点网格（块内细分） ==========

const tall = resolveGridShape(130, 770, 16);
check('细长竖条分到多行少列', tall.rows > tall.columns && tall.rows >= 6, JSON.stringify(tall));
const wide = resolveGridShape(770, 130, 16);
check('细长横条分到多列少行', wide.columns > wide.rows && wide.columns >= 6, JSON.stringify(wide));
const square = resolveGridShape(400, 400, 16);
check('方形接近方阵', Math.abs(square.rows - square.columns) <= 1, JSON.stringify(square));
check('尺寸非法时安全返回', resolveGridShape(0, 0, 16).rows >= 1);

// 竖条候选：确认网格点覆盖到底部（真机漏掉鞋的那个 bug）
const stripMask = blankMask();
fillRect(stripMask, 40, 5, 60, 95);
const strip = extractMaskComponents(stripMask, W, H);
const stripPoints = buildCandidatePointGrid(strip.candidates[0], strip.labels, W, { targetPoints: 16 });
check('竖条采样点数量合理', stripPoints.length >= 6, String(stripPoints.length));
check(
    '采样点全部落在候选内',
    stripPoints.every(p => strip.labels[p.y * W + p.x] === strip.candidates[0].id),
    JSON.stringify(stripPoints.slice(0, 3))
);
check(
    '采样点覆盖到候选底部（不漏末端）',
    stripPoints.some(p => p.y > 5 + 90 * 0.8),
    '最低点 y=' + Math.max(...stripPoints.map(p => p.y))
);

// ========== 未覆盖区域补点 ==========

const cand = strip.candidates[0];
const noneCovered = new Uint8Array(W * H);
const firstGap = findUncoveredPoint(strip.labels, cand.id, noneCovered, W, H, 0.03, cand.area);
check('完全未覆盖时能找到补点', !!firstGap && strip.labels[firstGap.y * W + firstGap.x] === cand.id, JSON.stringify(firstGap));

const allCovered = new Uint8Array(W * H).fill(1);
check('全部覆盖时返回 null', findUncoveredPoint(strip.labels, cand.id, allCovered, W, H, 0.03, cand.area) === null);

const mostlyCovered = new Uint8Array(W * H).fill(1);
for (let y = 5; y < 8; y++) for (let x = 40; x < 43; x++) mostlyCovered[y * W + x] = 0;
check(
    '未覆盖块太小时不补点',
    findUncoveredPoint(strip.labels, cand.id, mostlyCovered, W, H, 0.2, cand.area) === null
);

const topCovered = new Uint8Array(W * H).fill(1);
for (let y = 60; y < 95; y++) for (let x = 40; x < 60; x++) topCovered[y * W + x] = 0;
const bottomGap = findUncoveredPoint(strip.labels, cand.id, topCovered, W, H, 0.03, cand.area);
check('补点落在未覆盖的那一块内', !!bottomGap && bottomGap.y >= 60 && bottomGap.y < 95, JSON.stringify(bottomGap));

// ========== 蒙版 IoU ==========

const maskA = new Uint8Array(100).fill(0); for (let i = 10; i < 50; i++) maskA[i] = 255;
const maskB = new Uint8Array(100).fill(0); for (let i = 10; i < 50; i++) maskB[i] = 255;
const maskC = new Uint8Array(100).fill(0); for (let i = 60; i < 90; i++) maskC[i] = 255;
check('相同蒙版 IoU=1', Math.abs(maskIoU(maskA, maskB, 128) - 1) < 1e-9);
check('不相交蒙版 IoU=0', maskIoU(maskA, maskC, 128) === 0);
check('空蒙版 IoU=0', maskIoU(new Uint8Array(100), new Uint8Array(100), 128) === 0);

console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项未通过`);
process.exit(failed === 0 ? 0 : 1);
