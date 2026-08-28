#!/usr/bin/env node
/** MobileSAM 后处理与缓存边界纯逻辑回归，不加载 ONNX 权重。 */
const path = require('path');

const root = path.resolve(__dirname, '..');
require('ts-node').register({
    transpileOnly: true,
    project: path.join(root, 'tsconfig.main.json')
});

const { SAMService } = require(path.join(root, 'src/main/services/sam-service.ts'));

let passed = 0;
const failures = [];
function check(name, condition, detail) {
    if (condition) {
        passed += 1;
        console.log(`✅ ${name}`);
        return;
    }
    failures.push(`${name}${detail ? `：${detail}` : ''}`);
}

const service = new SAMService({ modelsDir: 'unused-for-pure-logic-test' });
const width = 9;
const height = 9;

const multiPointPrompts = service.preparePrompts(
    { x1: 1, y1: 2, x2: 3, y2: 4 },
    [
        { x: 5, y: 6, label: 1 },
        { x: 7, y: 8, label: 0 }
    ],
    100,
    50,
    2
);
check(
    'Box Prompt 后可同时附加 Agent 前景点与背景点',
    JSON.stringify(Array.from(multiPointPrompts.pointCoords)) === JSON.stringify([2, 4, 6, 8, 10, 12, 14, 16])
        && JSON.stringify(Array.from(multiPointPrompts.pointLabels)) === JSON.stringify([2, 3, 1, 0]),
    JSON.stringify({
        coords: Array.from(multiPointPrompts.pointCoords),
        labels: Array.from(multiPointPrompts.pointLabels)
    })
);
const legacySinglePointPrompts = service.preparePrompts(
    { x1: 1, y1: 2, x2: 3, y2: 4 },
    { x: 5, y: 6, label: 1 },
    100,
    50,
    2
);
check(
    '历史单点调用保持兼容，不改变既有 Box 标签顺序',
    JSON.stringify(Array.from(legacySinglePointPrompts.pointLabels)) === JSON.stringify([2, 3, 1])
);
let invalidGuidanceRejected = false;
try {
    service.preparePrompts(
        { x1: 1, y1: 2, x2: 3, y2: 4 },
        [{ x: Number.NaN, y: 6, label: 1 }],
        100,
        50,
        2
    );
} catch (error) {
    invalidGuidanceRejected = /无效坐标或标签/.test(String(error?.message || error));
}
check('Provider 不会静默丢弃无效引导点', invalidGuidanceRejected);

function refine(points, holes) {
    const mask = holes ? Buffer.alloc(width * height, 255) : Buffer.alloc(width * height, 0);
    for (const [x, y] of points) mask[y * width + x] = holes ? 0 : 255;
    return service.refineMaskWithProbabilityThreshold(mask, width, height);
}

const isolated = refine([[4, 4]], false);
check('单个孤立噪点被清除', isolated[4 * width + 4] === 0);

const thinDetailPoints = [[3, 4], [4, 4], [5, 4]];
const thinDetail = refine(thinDetailPoints, false);
check(
    '三个相连像素不会被 5x5 密度阈值整体抹掉',
    thinDetailPoints.every(([x, y]) => thinDetail[y * width + x] > 0)
        && thinDetail[4 * width + 4] >= 128,
    JSON.stringify(thinDetailPoints.map(([x, y]) => thinDetail[y * width + x]))
);

const pinhole = refine([[4, 4]], true);
check('被前景完全包围的单像素孔洞会填充', pinhole[4 * width + 4] === 255);

const openGap = refine([[3, 4], [4, 4], [5, 4]], true);
check(
    '三像素缝隙不会被高阈值全部填死',
    [3, 4, 5].some(x => openGap[4 * width + x] < 128),
    JSON.stringify([3, 4, 5].map(x => openGap[4 * width + x]))
);

for (let index = 0; index < 7; index++) {
    service.rememberEmbedding(`image-${index}`, { index }, 10, 10, 1);
}
check(
    '嵌入缓存硬上限为 6 条并淘汰最旧条目',
    service.imageEmbeddingCache.size === 6
        && !service.imageEmbeddingCache.has('image-0')
        && service.imageEmbeddingCache.has('image-6'),
    `size=${service.imageEmbeddingCache.size}`
);

let encoderReleased = 0;
let decoderReleased = 0;
service.encoderSession = { async release() { encoderReleased += 1; } };
service.decoderSession = { async release() { decoderReleased += 1; } };

async function main() {
    await service.dispose();
    check(
        'dispose 释放两个 ONNX session 并清空缓存',
        encoderReleased === 1
            && decoderReleased === 1
            && service.encoderSession === null
            && service.decoderSession === null
            && service.imageEmbeddingCache.size === 0,
        `encoder=${encoderReleased}, decoder=${decoderReleased}, cache=${service.imageEmbeddingCache.size}`
    );

    if (failures.length > 0) {
        console.error('\nSAM 后处理校验失败：');
        for (const failure of failures) console.error(`  - ${failure}`);
        process.exit(1);
    }
    console.log(`\n全部通过（${passed} 项）`);
}

main().catch((error) => {
    console.error('SAM 后处理校验异常：', error);
    process.exit(1);
});
