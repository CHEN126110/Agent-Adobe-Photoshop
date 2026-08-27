// 语义抠图目标框纯逻辑测试：模型返回解析、坐标反归一化、可信度校验、候选取舍。
// 覆盖"抠取目标"（袜子/鞋子…）→ 目标框这一段，不依赖模型和模型文件。
const path = require('path');
const root = path.resolve(__dirname, '..');
require('ts-node').register({ transpileOnly: true, project: path.join(root, 'tsconfig.main.json') });
const {
    SEMANTIC_TARGET_GRID,
    DEFAULT_SEMANTIC_TARGET_SELECTION,
    parseSemanticTargetResponse,
    denormalizeSemanticTargetBoxes,
    isPlausibleSemanticTargetBox,
    semanticTargetBoxIoU,
    selectSemanticTargetBoxes
} = require(path.join(root, 'src/shared/semantic-target-boxes.ts'));

let failed = 0;
function check(name, condition, detail) {
    if (condition) { console.log(`✅ ${name}`); return; }
    failed += 1;
    console.log(`❌ ${name}${detail ? ' — ' + detail : ''}`);
}

// ========== 解析 ==========

const clean = parseSemanticTargetResponse(
    '{"found":true,"targets":[{"label":"袜子","x1":120,"y1":300,"x2":480,"y2":760,"confidence":0.92}]}'
);
check('标准返回解析出 1 个框', clean.boxes.length === 1 && !clean.parseError, JSON.stringify(clean));
check('解析保留标签与置信度', clean.boxes[0].label === '袜子' && clean.boxes[0].confidence === 0.92);

const wrapped = parseSemanticTargetResponse(
    '我在图中找到了两只袜子。\n```json\n{"found":true,"targets":['
    + '{"label":"袜子","x1":100,"y1":200,"x2":300,"y2":600,"confidence":0.9},'
    + '{"label":"袜子","x1":500,"y1":210,"x2":700,"y2":610,"confidence":0.88}]}\n```'
);
check('能跳过解释文字与代码块围栏', wrapped.boxes.length === 2, JSON.stringify(wrapped));

const nested = parseSemanticTargetResponse(
    '{"found":true,"targets":[{"label":"袜子","box":{"x1":10,"y1":20,"x2":300,"y2":400},"confidence":0.8}]}'
);
check('兼容嵌套 box 对象', nested.boxes.length === 1 && nested.boxes[0].x2 === 300, JSON.stringify(nested));

const arrayBox = parseSemanticTargetResponse(
    '{"found":true,"targets":[{"label":"鞋子","box":[10,20,300,400],"confidence":70}]}'
);
check('兼容 box 数组写法', arrayBox.boxes.length === 1 && arrayBox.boxes[0].y2 === 400, JSON.stringify(arrayBox));
check('置信度 0-100 归一到 0-1', Math.abs(arrayBox.boxes[0].confidence - 0.7) < 1e-9, String(arrayBox.boxes[0].confidence));

const flipped = parseSemanticTargetResponse(
    '{"found":true,"targets":[{"label":"袜子","x1":480,"y1":760,"x2":120,"y2":300}]}'
);
check('左上右下写反时自动归位', flipped.boxes[0].x1 === 120 && flipped.boxes[0].y2 === 760, JSON.stringify(flipped.boxes[0]));

const notFound = parseSemanticTargetResponse('{"found":false,"targets":[]}');
check('明确未找到不算解析失败', notFound.notFound === true && !notFound.parseError, JSON.stringify(notFound));

check('空返回如实报错', !!parseSemanticTargetResponse('').parseError);
check('非 JSON 返回如实报错', !!parseSemanticTargetResponse('图里好像有一只袜子在左边').parseError);
check('坏 JSON 如实报错', !!parseSemanticTargetResponse('{"targets":[{"x1":1,"y1":').parseError);

const outOfGrid = parseSemanticTargetResponse(
    '{"found":true,"targets":[{"label":"袜子","x1":120,"y1":300,"x2":2400,"y2":1900}]}'
);
check(
    '越界坐标按解析失败处理而不是硬裁剪',
    outOfGrid.boxes.length === 0 && /网格/.test(outOfGrid.parseError || ''),
    JSON.stringify(outOfGrid)
);

// ========== 反归一化 ==========

const pixels = denormalizeSemanticTargetBoxes(
    [{ x1: 0, y1: 0, x2: 500, y2: 1000, label: '袜子', confidence: 0.9 }],
    2000,
    1000,
    SEMANTIC_TARGET_GRID
);
check(
    '网格坐标按图像尺寸换算',
    pixels[0].x1 === 0 && pixels[0].x2 === 1000 && pixels[0].y2 === 1000,
    JSON.stringify(pixels[0])
);

const clamped = denormalizeSemanticTargetBoxes(
    [{ x1: -5, y1: 0, x2: 1000, y2: 1000, label: '袜子', confidence: 0.5 }],
    800,
    600
);
check('换算结果不会超出图像边界', clamped[0].x1 === 0 && clamped[0].x2 === 800 && clamped[0].y2 === 600);

// ========== 可信度校验 ==========

const box = (x1, y1, x2, y2, confidence = 0.9, label = '袜子') => ({ x1, y1, x2, y2, confidence, label });

check('正常框通过校验', isPlausibleSemanticTargetBox(box(100, 100, 400, 500), 1000, 1000));
check('退化成一条线的框被拒', !isPlausibleSemanticTargetBox(box(100, 100, 101, 500), 1000, 1000));
check('几乎覆盖整图的框被拒', !isPlausibleSemanticTargetBox(box(0, 0, 1000, 1000), 1000, 1000));
check('极小噪点框被拒', !isPlausibleSemanticTargetBox(box(10, 10, 20, 20), 1000, 1000));

// ========== IoU ==========

check('完全重合 IoU=1', Math.abs(semanticTargetBoxIoU(box(0, 0, 100, 100), box(0, 0, 100, 100)) - 1) < 1e-9);
check('不相交 IoU=0', semanticTargetBoxIoU(box(0, 0, 100, 100), box(200, 200, 300, 300)) === 0);
check(
    '部分重叠 IoU 在 0-1 之间',
    (() => {
        const iou = semanticTargetBoxIoU(box(0, 0, 100, 100), box(50, 50, 150, 150));
        return iou > 0 && iou < 1;
    })()
);

// ========== 候选取舍 ==========

const mixed = [
    box(100, 100, 400, 500, 0.95),
    box(0, 0, 1000, 1000, 0.9),      // 覆盖整图，必须被剔除
    box(10, 10, 18, 18, 0.9),        // 噪点，必须被剔除
    box(600, 100, 900, 500, 0.88)
];
const selected = selectSemanticTargetBoxes(mixed, 1000, 1000, DEFAULT_SEMANTIC_TARGET_SELECTION);
check(
    '选出的框全部通过有效性校验',
    selected.every(b => isPlausibleSemanticTargetBox(b, 1000, 1000)),
    JSON.stringify(selected)
);
check(
    '不会凭空造出候选之外的框',
    selected.every(b => mixed.some(m => m.x1 === b.x1 && m.y1 === b.y1 && m.x2 === b.x2 && m.y2 === b.y2)),
    JSON.stringify(selected)
);
check('全部候选无效时返回空', selectSemanticTargetBoxes([box(0, 0, 1000, 1000)], 1000, 1000).length === 0);
check('空输入返回空', selectSemanticTargetBoxes([], 1000, 1000).length === 0);
check('越过图像边界的框被拒', !isPlausibleSemanticTargetBox(box(-1, 10, 200, 300), 1000, 1000));
check('非有限坐标被拒', !isPlausibleSemanticTargetBox(box(10, 10, Number.NaN, 300), 1000, 1000));
check(
    '严格服从 maxTargets 上限',
    selectSemanticTargetBoxes(
        Array.from({ length: 12 }).map((_, i) => box(i * 60, 100, i * 60 + 50, 400, 0.9)),
        1000,
        1000,
        DEFAULT_SEMANTIC_TARGET_SELECTION
    ).length === DEFAULT_SEMANTIC_TARGET_SELECTION.maxTargets
);

const confidenceFiltered = selectSemanticTargetBoxes([
    box(100, 100, 300, 400, 0.19, '低置信'),
    box(400, 100, 600, 400, 0, '未报告置信度'),
    box(700, 100, 900, 400, 0.8, '高置信')
], 1000, 1000, { maxTargets: 8, duplicateIoU: 0.75, minConfidence: 0.2 });
check(
    '过滤明确低置信候选但保留未报告置信度的候选',
    confidenceFiltered.map(item => item.label).join(',') === '高置信,未报告置信度',
    JSON.stringify(confidenceFiltered)
);

const deduplicated = selectSemanticTargetBoxes([
    box(105, 105, 405, 505, 0.7, '较低置信重复框'),
    box(100, 100, 400, 500, 0.95, '较高置信重复框'),
    box(600, 100, 900, 500, 0.8, '独立框')
], 1000, 1000, { maxTargets: 8, duplicateIoU: 0.75, minConfidence: 0.2 });
check(
    'IoU 重复框只保留置信度更高者',
    deduplicated.map(item => item.label).join(',') === '较高置信重复框,独立框',
    JSON.stringify(deduplicated)
);

const stableTies = selectSemanticTargetBoxes([
    box(600, 100, 900, 500, 0.8, '先出现'),
    box(100, 100, 400, 500, 0.8, '后出现')
], 1000, 1000, { maxTargets: 8, duplicateIoU: 0.75, minConfidence: 0.2 });
check(
    '同置信度候选保持来源顺序稳定',
    stableTies.map(item => item.label).join(',') === '先出现,后出现',
    JSON.stringify(stableTies)
);

const invalidOptionsFallback = selectSemanticTargetBoxes([
    box(100, 100, 300, 400, 0.9),
    box(400, 100, 600, 400, 0.8)
], 1000, 1000, { maxTargets: Number.NaN, duplicateIoU: Number.NaN, minConfidence: Number.NaN });
check('非法选择参数回退到受控默认值', invalidOptionsFallback.length === 2, JSON.stringify(invalidOptionsFallback));

console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项未通过`);
process.exit(failed === 0 ? 0 : 1);
