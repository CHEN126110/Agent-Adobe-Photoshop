import * as assert from 'assert';
import { createHash } from 'crypto';

import { alignSkuRetouchPose } from '../../src/main/services/sku-retouch/pose-alignment';

interface PoseFixture {
    raster: {
        data: Buffer;
        width: number;
        height: number;
        channels: 3;
    };
    mask: Buffer;
}

interface FixtureOptions {
    width?: number;
    height?: number;
    top?: number;
    bottom?: number;
    centerAt: (progress: number) => number;
    halfWidthAt?: (progress: number) => number;
}

function createPoseFixture(options: FixtureOptions): PoseFixture {
    const width = options.width ?? 240;
    const height = options.height ?? 360;
    const top = options.top ?? 24;
    const bottom = options.bottom ?? 336;
    const mask = Buffer.alloc(width * height);
    const rgb = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const index = y * width + x;
            rgb[index * 3] = (x * 3 + y) % 256;
            rgb[index * 3 + 1] = (y * 2) % 256;
            rgb[index * 3 + 2] = (Math.floor(y / 12) % 2) * 150 + 60;
        }
    }
    for (let y = top; y < bottom; y += 1) {
        const progress = (y - top) / Math.max(1, bottom - top - 1);
        const center = options.centerAt(progress);
        let halfWidth = options.halfWidthAt?.(progress) ?? 36;
        if (progress < 0.12) halfWidth += 8 * (1 - progress / 0.12);
        if (progress > 0.92) {
            const toeProgress = (progress - 0.92) / 0.08;
            halfWidth *= Math.sqrt(Math.max(0, 1 - toeProgress * toeProgress));
        }
        const left = Math.max(0, Math.ceil(center - halfWidth));
        const right = Math.min(width - 1, Math.floor(center + halfWidth));
        for (let x = left; x <= right; x += 1) {
            mask[y * width + x] = 255;
        }
    }
    return {
        raster: { data: rgb, width, height, channels: 3 },
        mask
    };
}

function hashBuffers(...values: Buffer[]): string {
    const hash = createHash('sha256');
    for (const value of values) hash.update(value);
    return hash.digest('hex');
}

function countMaskChangesInRows(
    source: Buffer,
    output: Buffer,
    width: number,
    top: number,
    bottom: number
): number {
    let changes = 0;
    for (let y = top; y < bottom; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const index = y * width + x;
            if ((source[index] >= 104) !== (output[index] >= 104)) changes += 1;
        }
    }
    return changes;
}

function testModerateCurveAcceptedAndDeterministic(): void {
    const fixture = createPoseFixture({
        centerAt(progress) {
            const t = progress * 2 - 1;
            return 120 + 16 * t + 14 * t * t;
        }
    });
    const options = { strength: 0.9, cuffLockRatio: 0.15, maxIterations: 3 };
    const first = alignSkuRetouchPose({ ...fixture, options });
    const second = alignSkuRetouchPose({ ...fixture, options });
    assert.strictEqual(first.report.status, 'applied');
    assert.strictEqual(first.report.applied, true);
    assert.deepStrictEqual(first.report.sourceSize, { width: 240, height: 360 });
    assert.deepStrictEqual(first.report.options, options);
    assert.ok(first.report.iterations >= 1 && first.report.iterations <= 3);
    assert.strictEqual(first.report.checks.noFoldover, 'passed');
    assert.strictEqual(first.report.checks.canvasSafety, 'passed');
    assert.strictEqual(first.report.checks.foregroundRetention, 'passed');
    assert.strictEqual(first.report.checks.bendReduction, 'passed');
    assert.strictEqual(first.report.checks.cuffStability, 'passed');
    assert.ok(first.report.metrics.bendReductionRatio >= 0.495);
    assert.ok(first.report.metrics.foregroundRetentionRatio >= 0.92);
    assert.ok(first.report.metrics.foregroundRetentionRatio <= 1.08);
    assert.ok(first.report.metrics.minJacobianDeterminant >= 0.18);
    assert.ok((first.report.metrics.cuffDriftRatio ?? 1) <= 0.06);
    assert.strictEqual(
        hashBuffers(first.raster.data, first.mask),
        hashBuffers(second.raster.data, second.mask),
        '相同输入与参数必须得到逐字节一致的姿态产物'
    );
    assert.deepStrictEqual(first.report, second.report);
}

function testStraightPoseReturnsOriginal(): void {
    const fixture = createPoseFixture({
        centerAt() {
            return 120;
        }
    });
    const result = alignSkuRetouchPose({
        ...fixture,
        options: { strength: 1, cuffLockRatio: 0.15 }
    });
    assert.strictEqual(result.report.status, 'not_needed');
    assert.strictEqual(result.report.reasonCode, 'pose_already_aligned');
    assert.strictEqual(result.raster, fixture.raster);
    assert.strictEqual(result.mask, fixture.mask);
}

function testCuffLockReducesTopRegionMutation(): void {
    const fixture = createPoseFixture({
        centerAt(progress) {
            const t = progress * 2 - 1;
            return 120 + 16 * t + 14 * t * t;
        }
    });
    const unlocked = alignSkuRetouchPose({
        ...fixture,
        options: { strength: 0.9, cuffLockRatio: 0, maxIterations: 3 }
    });
    const locked = alignSkuRetouchPose({
        ...fixture,
        options: { strength: 0.9, cuffLockRatio: 0.2, maxIterations: 3 }
    });
    assert.strictEqual(unlocked.report.status, 'applied');
    assert.strictEqual(locked.report.status, 'applied');
    const unlockedChanges = countMaskChangesInRows(fixture.mask, unlocked.mask, 240, 24, 86);
    const lockedChanges = countMaskChangesInRows(fixture.mask, locked.mask, 240, 24, 86);
    assert.ok(unlockedChanges > 0);
    assert.ok(
        lockedChanges < unlockedChanges * 0.7,
        `袜口锁定区变化没有显著下降：unlocked=${unlockedChanges}, locked=${lockedChanges}`
    );
}

function testZeroStrengthIsExplicitNoOp(): void {
    const fixture = createPoseFixture({
        centerAt(progress) {
            return 120 + 24 * Math.sin(progress * Math.PI);
        }
    });
    const result = alignSkuRetouchPose({
        ...fixture,
        options: { strength: 0, cuffLockRatio: 0.2 }
    });
    assert.strictEqual(result.report.status, 'not_needed');
    assert.strictEqual(result.report.reasonCode, 'strength_zero');
    assert.strictEqual(result.raster, fixture.raster);
    assert.strictEqual(result.mask, fixture.mask);
}

function testComplexSShapeRejectedWithoutCandidateLeak(): void {
    const fixture = createPoseFixture({
        centerAt(progress) {
            return 120 + 34 * Math.sin(progress * Math.PI * 2);
        }
    });
    const result = alignSkuRetouchPose({
        ...fixture,
        options: { strength: 1, cuffLockRatio: 0.15 }
    });
    assert.strictEqual(result.report.status, 'rejected');
    assert.ok([
        'excessive_skeleton_residual',
        'excessive_local_rotation',
        'warp_foldover_risk'
    ].includes(result.report.reasonCode || ''));
    assert.strictEqual(result.raster, fixture.raster);
    assert.strictEqual(result.mask, fixture.mask);
}

function testEdgeContactRejectedBeforeWarp(): void {
    const fixture = createPoseFixture({
        centerAt(progress) {
            const t = progress * 2 - 1;
            return 34 + 8 * t;
        }
    });
    const result = alignSkuRetouchPose({
        ...fixture,
        options: { strength: 1, cuffLockRatio: 0.1 }
    });
    assert.strictEqual(result.report.status, 'rejected');
    assert.strictEqual(result.report.reasonCode, 'insufficient_canvas_margin');
    assert.strictEqual(result.report.checks.canvasSafety, 'failed');
    assert.strictEqual(result.raster, fixture.raster);
    assert.strictEqual(result.mask, fixture.mask);
}

function testInvalidOptionsRejected(): void {
    const fixture = createPoseFixture({
        centerAt(progress) {
            return 120 + 10 * progress;
        }
    });
    const result = alignSkuRetouchPose({
        ...fixture,
        options: { strength: Number.NaN, cuffLockRatio: 0.5, maxIterations: 9 }
    });
    assert.strictEqual(result.report.status, 'rejected');
    assert.strictEqual(result.report.reasonCode, 'invalid_options');
    assert.strictEqual(result.report.checks.input, 'failed');
}

function testRasterContractFailsLoudly(): void {
    const fixture = createPoseFixture({
        centerAt() {
            return 120;
        }
    });
    assert.throws(
        () => alignSkuRetouchPose({
            raster: { ...fixture.raster, data: fixture.raster.data.subarray(0, -1) },
            mask: fixture.mask,
            options: { strength: 1, cuffLockRatio: 0 }
        }),
        /RGB 像素尺寸不一致/
    );
}

export async function runSkuPoseAlignmentTests(): Promise<void> {
    testModerateCurveAcceptedAndDeterministic();
    testStraightPoseReturnsOriginal();
    testCuffLockReducesTopRegionMutation();
    testZeroStrengthIsExplicitNoOp();
    testComplexSShapeRejectedWithoutCandidateLeak();
    testEdgeContactRejectedBeforeWarp();
    testInvalidOptionsRejected();
    testRasterContractFailsLoudly();
    console.log('✅ PASS │ SKU 姿态统一离线算法：改善、确定性、裁切、袜口、折叠与失败关闭');
}
