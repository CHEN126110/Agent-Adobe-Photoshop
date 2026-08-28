#!/usr/bin/env node
/**
 * 引导滤波纯逻辑校验：直接加载 TypeScript 源码，不依赖 dist、模型或 GPU。
 */
const path = require('path');

const root = path.resolve(__dirname, '..');
require('ts-node').register({
    transpileOnly: true,
    project: path.join(root, 'tsconfig.main.json')
});

const {
    DEFAULT_GUIDED_FILTER_MEMORY_BUDGET_BYTES,
    GuidedFilterMemoryBudgetError,
    countForeground,
    planGuidedFilterExecution,
    refineMaskWithGuidedFilter,
    resolveGuidedFilterRadius
} = require(path.join(root, 'src/shared/guided-filter.ts'));

let passed = 0;
const failures = [];

function check(name, condition, detail) {
    if (condition) {
        passed++;
        return;
    }
    failures.push(`${name}${detail ? `：${detail}` : ''}`);
}

function referenceBoxFilter(src, width, height, radius) {
    const stride = width + 1;
    const sum = new Float64Array(stride * (height + 1));
    for (let y = 0; y < height; y++) {
        let rowSum = 0;
        for (let x = 0; x < width; x++) {
            rowSum += src[y * width + x];
            sum[(y + 1) * stride + x + 1] = sum[y * stride + x + 1] + rowSum;
        }
    }

    const out = new Float64Array(width * height);
    for (let y = 0; y < height; y++) {
        const y0 = Math.max(0, y - radius);
        const y1 = Math.min(height - 1, y + radius);
        for (let x = 0; x < width; x++) {
            const x0 = Math.max(0, x - radius);
            const x1 = Math.min(width - 1, x + radius);
            const area = (y1 - y0 + 1) * (x1 - x0 + 1);
            const total = sum[(y1 + 1) * stride + x1 + 1]
                - sum[y0 * stride + x1 + 1]
                - sum[(y1 + 1) * stride + x0]
                + sum[y0 * stride + x0];
            out[y * width + x] = total / area;
        }
    }
    return out;
}

function referenceGuidedFilter(guide, mask, width, height, radius, epsilon) {
    const total = width * height;
    const guideNorm = new Float64Array(total);
    const maskNorm = new Float64Array(total);
    const guideSquared = new Float64Array(total);
    const guideMask = new Float64Array(total);
    for (let i = 0; i < total; i++) {
        guideNorm[i] = guide[i] / 255;
        maskNorm[i] = mask[i] / 255;
        guideSquared[i] = guideNorm[i] * guideNorm[i];
        guideMask[i] = guideNorm[i] * maskNorm[i];
    }

    const meanGuide = referenceBoxFilter(guideNorm, width, height, radius);
    const meanMask = referenceBoxFilter(maskNorm, width, height, radius);
    const meanGuideSquared = referenceBoxFilter(guideSquared, width, height, radius);
    const meanGuideMask = referenceBoxFilter(guideMask, width, height, radius);
    const coefficientA = new Float64Array(total);
    const coefficientB = new Float64Array(total);
    for (let i = 0; i < total; i++) {
        const variance = meanGuideSquared[i] - meanGuide[i] * meanGuide[i];
        const covariance = meanGuideMask[i] - meanGuide[i] * meanMask[i];
        coefficientA[i] = covariance / (variance + epsilon);
        coefficientB[i] = meanMask[i] - coefficientA[i] * meanGuide[i];
    }

    const meanA = referenceBoxFilter(coefficientA, width, height, radius);
    const meanB = referenceBoxFilter(coefficientB, width, height, radius);
    const output = new Uint8Array(total);
    for (let i = 0; i < total; i++) {
        const value = Math.round((meanA[i] * guideNorm[i] + meanB[i]) * 255);
        output[i] = value < 0 ? 0 : value > 255 ? 255 : value;
    }
    return output;
}

function maximumAbsoluteDifference(left, right, indexes) {
    let maximum = 0;
    if (indexes) {
        for (const index of indexes) maximum = Math.max(maximum, Math.abs(left[index] - right[index]));
        return maximum;
    }
    for (let i = 0; i < left.length; i++) {
        maximum = Math.max(maximum, Math.abs(left[i] - right[i]));
    }
    return maximum;
}

// 半径按长边推导并钳位
check('小图取下限半径', resolveGuidedFilterRadius(100, 80) === 4);
check('1536 长边得 8', resolveGuidedFilterRadius(1536, 853) === 8);
check('3072 长边得 16', resolveGuidedFilterRadius(3072, 2048) === 16);
check('超大图钳到上限', resolveGuidedFilterRadius(10000, 10000) === 24);

// 生产尺寸只检查纯逻辑计划，不在测试进程真实申请大图数组。
const productionPlan = planGuidedFilterExecution(3072, 3072);
check('3072 走全分辨率分块模式',
    productionPlan.status === 'ready'
        && productionPlan.executionMode === 'tiled_full_resolution'
        && productionPlan.tileCoreRows === 256);
check('3072 算法新增峰值低于 48 MiB',
    productionPlan.estimatedPeakBytes < 48 * 1024 * 1024,
    `实际 ${productionPlan.estimatedPeakBytes} 字节`);
check('3072 计划受默认预算约束',
    productionPlan.estimatedPeakBytes <= DEFAULT_GUIDED_FILTER_MEMORY_BUDGET_BYTES);

const constrainedProductionPlan = planGuidedFilterExecution(3072, 3072, {
    memoryBudgetBytes: 32 * 1024 * 1024
});
check('收紧预算时减小行块但保持全分辨率模式',
    constrainedProductionPlan.status === 'ready'
        && constrainedProductionPlan.executionMode === 'tiled_full_resolution'
        && constrainedProductionPlan.tileCoreRows < productionPlan.tileCoreRows
        && constrainedProductionPlan.estimatedPeakBytes <= 32 * 1024 * 1024);

const rejectedPlan = planGuidedFilterExecution(20000, 20000);
check('超预算尺寸在分配前拒绝',
    rejectedPlan.status === 'rejected_memory_budget'
        && rejectedPlan.executionMode === 'not_run'
        && rejectedPlan.fallback === 'caller_must_record_guided_filter_skip');

// 尺寸不符必须抛错，不允许静默产出错误蒙版
let threw = false;
try {
    refineMaskWithGuidedFilter(new Uint8Array(10), new Uint8Array(9), 3, 3);
} catch (error) {
    threw = true;
}
check('尺寸不符抛错', threw);

let memoryError = null;
try {
    refineMaskWithGuidedFilter(
        new Uint8Array(16),
        new Uint8Array(16),
        4,
        4,
        { radius: 1, memoryBudgetBytes: 1 }
    );
} catch (error) {
    memoryError = error;
}
check('预算不足显式抛出可识别错误',
    memoryError instanceof GuidedFilterMemoryBudgetError
        && memoryError.code === 'GUIDED_FILTER_MEMORY_BUDGET_EXCEEDED'
        && memoryError.plan.fallback === 'caller_must_record_guided_filter_skip');

// 构造：左半黑右半白的引导图，蒙版边界故意错位 6 像素
const W = 64;
const H = 32;
const guide = new Uint8Array(W * H);
const mask = new Uint8Array(W * H);
for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
        guide[y * W + x] = x < 32 ? 0 : 255;
        mask[y * W + x] = x < 38 ? 0 : 255;
    }
}
const refined = refineMaskWithGuidedFilter(guide, mask, W, H, { radius: 8, epsilon: 1e-4 });
check('输出长度一致', refined.length === W * H);

function edgeColumn(buffer) {
    const y = Math.floor(H / 2);
    for (let x = 1; x < W; x++) {
        if ((buffer[y * W + x - 1] >= 128) !== (buffer[y * W + x] >= 128)) return x;
    }
    return -1;
}

const before = edgeColumn(mask);
const after = edgeColumn(refined);
check('原始边界在 38', before === 38, `实际 ${before}`);
check('精修后边界向引导图靠拢',
    after >= 0 && Math.abs(after - 32) < Math.abs(before - 32),
    `精修前 ${before}，精修后 ${after}`);

// 引导图完全平坦时不应凭空造边（退化为局部均值，不得出现新的前景块）
const flatGuide = new Uint8Array(W * H).fill(128);
const flatRefined = refineMaskWithGuidedFilter(flatGuide, mask, W, H, {
    radius: 4,
    epsilon: 1e-4
});
check('平坦引导图不制造额外前景',
    countForeground(flatRefined) <= countForeground(mask),
    `原 ${countForeground(mask)}，精修后 ${countForeground(flatRefined)}`);

// 全前景蒙版精修后仍应是全前景（不塌陷）
const solid = new Uint8Array(W * H).fill(255);
const solidRefined = refineMaskWithGuidedFilter(guide, solid, W, H, {
    radius: 8,
    epsilon: 1e-4
});
check('实心蒙版不塌陷',
    countForeground(solidRefined) === W * H,
    `实际 ${countForeground(solidRefined)}/${W * H}`);

// 300 行会跨过默认 256 行块边界；用旧 Float64 积分图作小规模精度基准。
const precisionWidth = 67;
const precisionHeight = 300;
const precisionGuide = new Uint8Array(precisionWidth * precisionHeight);
const precisionMask = new Uint8Array(precisionWidth * precisionHeight);
for (let y = 0; y < precisionHeight; y++) {
    for (let x = 0; x < precisionWidth; x++) {
        const index = y * precisionWidth + x;
        precisionGuide[index] = (x * 17 + y * 13 + (x * y) % 31) % 256;
        precisionMask[index] = (x * 9 + y * 5 + ((x + 7) * (y + 3)) % 97) % 256;
    }
}
const precisionRadius = 8;
const precisionEpsilon = 1e-4;
const reference = referenceGuidedFilter(
    precisionGuide,
    precisionMask,
    precisionWidth,
    precisionHeight,
    precisionRadius,
    precisionEpsilon
);
const tiled = refineMaskWithGuidedFilter(
    precisionGuide,
    precisionMask,
    precisionWidth,
    precisionHeight,
    {
        radius: precisionRadius,
        epsilon: precisionEpsilon,
        memoryBudgetBytes: 100 * 1024
    }
);
const constrainedFixturePlan = planGuidedFilterExecution(
    precisionWidth,
    precisionHeight,
    { radius: precisionRadius, memoryBudgetBytes: 100 * 1024 }
);
check('小图真实执行覆盖预算自适应多行块',
    constrainedFixturePlan.status === 'ready'
        && constrainedFixturePlan.tileCoreRows > 0
        && constrainedFixturePlan.tileCoreRows < 256);
const precisionDifference = maximumAbsoluteDifference(reference, tiled);
check('分块结果保持 Float64 参考输出精度',
    precisionDifference <= 1,
    `最大字节差 ${precisionDifference}`);

const seamIndexes = [];
for (const y of [255, 256]) {
    for (let x = 0; x < precisionWidth; x++) seamIndexes.push(y * precisionWidth + x);
}
const seamDifference = maximumAbsoluteDifference(reference, tiled, seamIndexes);
check('行块边界不引入近似接缝', seamDifference <= 1, `最大字节差 ${seamDifference}`);

if (failures.length > 0) {
    console.error('引导滤波校验失败：');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
}
console.log(`全部通过（${passed} 项）`);
