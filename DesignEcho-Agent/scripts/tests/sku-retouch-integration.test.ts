import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import sharp from 'sharp';

import type { MattingResult, MattingService } from '../../src/main/services/matting-service';
import {
    SkuRetouchService,
    assertSkuRetouchOutputBudget
} from '../../src/main/services/sku-retouch-service';

interface MaskShape {
    left: number;
    top: number;
    right: number;
    bottom: number;
    fringe: number;
}

class FakeMattingService {
    public callCount = 0;

    constructor(private readonly shapes: MaskShape[]) {}

    async removeBackground(
        _imageInput: string,
        options?: { originalWidth?: number; originalHeight?: number }
    ): Promise<MattingResult> {
        const width = Number(options?.originalWidth || 0);
        const height = Number(options?.originalHeight || 0);
        const shape = this.shapes[this.callCount % this.shapes.length];
        this.callCount += 1;
        const mask = Buffer.alloc(width * height);
        const fringeLeft = Math.max(0, shape.left - shape.fringe);
        const fringeTop = Math.max(0, shape.top - shape.fringe);
        const fringeRight = Math.min(width, shape.right + shape.fringe);
        const fringeBottom = Math.min(height, shape.bottom + shape.fringe);
        for (let y = fringeTop; y < fringeBottom; y += 1) {
            for (let x = fringeLeft; x < fringeRight; x += 1) {
                mask[y * width + x] = 18;
            }
        }
        for (let y = shape.top; y < shape.bottom; y += 1) {
            for (let x = shape.left; x < shape.right; x += 1) {
                mask[y * width + x] = 255;
            }
        }
        return {
            success: true,
            maskBuffer: mask,
            maskWidth: width,
            maskHeight: height
        };
    }
}

async function writeSource(filePath: string, color: { r: number; g: number; b: number }): Promise<void> {
    await sharp({
        create: {
            width: 256,
            height: 320,
            channels: 3,
            background: color
        }
    }).png({ compressionLevel: 0 }).toFile(filePath);
}

function asMattingService(value: FakeMattingService): MattingService {
    return value as unknown as MattingService;
}

async function testAlphaSafetyAndCacheIntegrity(tempRoot: string): Promise<void> {
    const sourcePath = path.join(tempRoot, 'source.png');
    const outputDir = path.join(tempRoot, 'output');
    await writeSource(sourcePath, { r: 248, g: 246, b: 242 });
    const matting = new FakeMattingService([{
        left: 80,
        top: 40,
        right: 176,
        bottom: 280,
        fringe: 6
    }]);
    const service = new SkuRetouchService(asMattingService(matting));
    const input = {
        sources: [{ sourceId: 'sock-a', filePath: sourcePath, colorName: '米白' }],
        outputDir,
        sourceMode: 'studio' as const,
        maxLongEdge: 1024
    };

    const first = await service.prepareAssets(input);
    const prepared = first.sources[0];
    assert.strictEqual(first.cacheHit, false);
    assert.strictEqual(first.checks.alphaPixelsPreserved, 'passed');
    assert.strictEqual(first.checks.alphaEdgesSafe, 'passed');
    assert.strictEqual(prepared.alphaSafety?.sourcePixelsPreserved, true);
    assert.strictEqual(prepared.alphaSafety?.outputEdgesClear, true);
    assert.ok((prepared.alphaSafety?.sourceAlphaPixelCount || 0) > 96 * 240);
    assert.ok(Object.values(prepared.alphaSafety?.safeInsets || {}).every((value) => value >= 2));
    assert.match(prepared.productSha256 || '', /^[a-f0-9]{64}$/);
    assert.match(prepared.productChecksum || '', /^fnv1a32:[a-f0-9]{8}$/);
    assert.match(prepared.previewSha256 || '', /^[a-f0-9]{64}$/);
    assert.strictEqual(prepared.productByteLength, (await fs.promises.lstat(prepared.productPath!)).size);
    assert.strictEqual(prepared.previewByteLength, (await fs.promises.lstat(prepared.previewPath!)).size);
    assert.match(first.cacheIdentity.sources[0].sourceSha256, /^[a-f0-9]{64}$/);

    const cached = await service.prepareAssets(input);
    assert.strictEqual(cached.cacheHit, true);
    assert.strictEqual(matting.callCount, 1);

    await fs.promises.writeFile(prepared.productPath!, Buffer.from('corrupted product'));
    const regeneratedAfterCorruption = await service.prepareAssets(input);
    assert.strictEqual(regeneratedAfterCorruption.cacheHit, false);
    assert.strictEqual(matting.callCount, 2);

    const currentProduct = regeneratedAfterCorruption.sources[0];
    await sharp({
        create: {
            width: currentProduct.width!,
            height: currentProduct.height!,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
    }).png().toFile(currentProduct.productPath!);
    const regeneratedAfterReplacement = await service.prepareAssets(input);
    assert.strictEqual(regeneratedAfterReplacement.cacheHit, false);
    assert.strictEqual(matting.callCount, 3);

    await fs.promises.writeFile(regeneratedAfterReplacement.reportPath, '{not-json', 'utf8');
    const regeneratedAfterBrokenReport = await service.prepareAssets(input);
    assert.strictEqual(regeneratedAfterBrokenReport.cacheHit, false);
    assert.strictEqual(matting.callCount, 4);

    const renamedIdentity = await service.prepareAssets({
        ...input,
        sources: [{ sourceId: 'sock-b', filePath: sourcePath, colorName: '奶油白' }]
    });
    assert.strictEqual(renamedIdentity.cacheHit, false);
    assert.notStrictEqual(renamedIdentity.outputDir, first.outputDir);
    assert.strictEqual(matting.callCount, 5);

    await writeSource(sourcePath, { r: 247, g: 245, b: 241 });
    const changedContent = await service.prepareAssets(input);
    assert.strictEqual(changedContent.cacheHit, false);
    assert.notStrictEqual(changedContent.cacheIdentity.sources[0].sourceSha256, first.cacheIdentity.sources[0].sourceSha256);
    assert.notStrictEqual(changedContent.outputDir, first.outputDir);
    assert.strictEqual(matting.callCount, 6);
}

async function testScaleAndPixelBudgets(tempRoot: string): Promise<void> {
    assert.throws(
        () => assertSkuRetouchOutputBudget({ canvasWidth: 4097, canvasHeight: 100, sourceCount: 1 }),
        /预算越界/
    );
    assert.throws(
        () => assertSkuRetouchOutputBudget({ canvasWidth: 4000, canvasHeight: 4000, sourceCount: 1 }),
        /预算越界/
    );
    assert.throws(
        () => assertSkuRetouchOutputBudget({ canvasWidth: 3001, canvasHeight: 2000, sourceCount: 12 }),
        /预算越界/
    );

    const referencePath = path.join(tempRoot, 'reference.png');
    const smallPath = path.join(tempRoot, 'small.png');
    await Promise.all([
        writeSource(referencePath, { r: 244, g: 244, b: 244 }),
        writeSource(smallPath, { r: 242, g: 242, b: 242 })
    ]);
    const matting = new FakeMattingService([
        { left: 88, top: 20, right: 168, bottom: 300, fringe: 4 },
        { left: 88, top: 130, right: 168, bottom: 190, fringe: 4 }
    ]);
    const service = new SkuRetouchService(asMattingService(matting));
    await assert.rejects(
        () => service.prepareAssets({
            sources: [
                { sourceId: 'reference', filePath: referencePath },
                { sourceId: 'small', filePath: smallPath }
            ],
            outputDir: path.join(tempRoot, 'scale-output'),
            sourceMode: 'studio',
            referenceSourcePath: referencePath,
            maxLongEdge: 1024
        }),
        /超出安全范围 0\.25×~4×/
    );
}

export async function runSkuRetouchIntegrationTests(): Promise<void> {
    const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'designecho-sku-retouch-'));
    try {
        await testAlphaSafetyAndCacheIntegrity(tempRoot);
        await testScaleAndPixelBudgets(tempRoot);
        console.log('✅ PASS │ SKU 统一尺度资产：柔边完整性、四边安全、缓存真实性与像素预算');
    } finally {
        await fs.promises.rm(tempRoot, { recursive: true, force: true });
    }
}
