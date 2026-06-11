#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

try {
  require('ts-node').register({
    skipProject: true,
    transpileOnly: true,
    compilerOptions: {
      module: 'commonjs',
      moduleResolution: 'node',
      esModuleInterop: true
    }
  });
} catch (error) {
  console.error('[smoke-shape-morphing-pipeline] 缺少 ts-node 依赖');
  process.exit(1);
}

const { ShapeMorphingOrchestrator } = require('../src/main/services/shape-morphing-orchestrator');

function ensureTmpDir() {
  const dir = path.join(__dirname, '..', 'tmp');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function createRectContour(left, top, width, height, samplesPerEdge = 12) {
  const points = [];
  for (let i = 0; i < samplesPerEdge; i += 1) {
    const t = i / samplesPerEdge;
    points.push({ x: left + width * t, y: top });
  }
  for (let i = 0; i < samplesPerEdge; i += 1) {
    const t = i / samplesPerEdge;
    points.push({ x: left + width, y: top + height * t });
  }
  for (let i = 0; i < samplesPerEdge; i += 1) {
    const t = i / samplesPerEdge;
    points.push({ x: left + width * (1 - t), y: top + height });
  }
  for (let i = 0; i < samplesPerEdge; i += 1) {
    const t = i / samplesPerEdge;
    points.push({ x: left, y: top + height * (1 - t) });
  }
  return points;
}

function createMockWsServer(samplePngBase64) {
  const referenceBounds = { left: 100, top: 120, right: 320, bottom: 620, width: 220, height: 500 };
  const productBounds = {
    201: { left: 20, top: 40, right: 200, bottom: 420, width: 180, height: 380 },
    202: { left: 240, top: 60, right: 410, bottom: 430, width: 170, height: 370 }
  };
  const referenceContour = createRectContour(0, 0, 220, 500);
  const productContour = createRectContour(0, 0, 180, 380);

  return {
    async sendRequest(method, params) {
      switch (method) {
        case 'getLayerBounds': {
          if (params.layerId === 101) {
            return { success: true, bounds: referenceBounds, boundsNoEffects: referenceBounds };
          }
          const bounds = productBounds[params.layerId];
          return bounds
            ? { success: true, bounds, boundsNoEffects: bounds }
            : { success: false, error: 'unknown layer' };
        }
        case 'exportLayerAsBase64': {
          return {
            success: true,
            data: {
              base64: samplePngBase64,
              width: 180,
              height: 380
            }
          };
        }
        case 'extractShapePath': {
          return {
            success: true,
            sampledPoints: referenceContour,
            contour: { boundingBox: { width: 220, height: 500 } }
          };
        }
        case 'getLayerContour': {
          return {
            success: true,
            sampledPoints: productContour,
            contour: { boundingBox: { width: 180, height: 380 } }
          };
        }
        case 'alignToReference': {
          return { success: true, params };
        }
        case 'applyDisplacement': {
          return { success: true, layerId: params.layerId };
        }
        default:
          return { success: false, error: `unsupported method: ${method}` };
      }
    }
  };
}

function createMockMattingService() {
  return {
    async detectWithYoloWorld() {
      return [{ x1: 10, y1: 10, x2: 150, y2: 340, confidence: 0.93 }];
    }
  };
}

async function main() {
  const samplePngBase64 = await sharp({
    create: {
      width: 32,
      height: 64,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 }
    }
  }).png().toBuffer().then((buffer) => buffer.toString('base64'));

  const wsServer = createMockWsServer(samplePngBase64);
  const mattingService = createMockMattingService();
  const orchestrator = new ShapeMorphingOrchestrator(wsServer, mattingService);

  const alignment = await orchestrator.executeAlignment({
    referenceShapeId: 101,
    productLayerIds: [201, 202],
    step: 'align',
    preAlign: true
  });

  const morph = await orchestrator.executeFullMorphing({
    referenceShapeId: 101,
    productLayerIds: [201, 202],
    step: 'morph',
    preAlign: true,
    shapeMatch: true,
    edgeStrength: 70,
    contentProtection: 80,
    smoothness: 50,
    cuffProtected: true
  });

  const fastQualityMorph = await orchestrator.executeFullMorphing({
    referenceShapeId: 101,
    productLayerIds: [201],
    step: 'morph',
    preAlign: true,
    shapeMatch: true,
    edgeStrength: 70,
    contentProtection: 80,
    smoothness: 50,
    cuffProtected: true,
    selectedRegions: ['body', 'toe'],
    quality: 'fast'
  });

  const rejected = await orchestrator.executeFullMorphing({
    referenceShapeId: 101,
    productLayerIds: [201],
    step: 'morph',
    preAlign: true,
    shapeMatch: true,
    edgeStrength: 70,
    contentProtection: 80,
    smoothness: 50,
    cuffProtected: true,
    cuffType: 'decorated'
  });

  const summary = {
    alignment: {
      success: alignment.success,
      successCount: alignment.results.filter((item) => item.success).length,
      total: alignment.results.length,
      methods: alignment.results.map((item) => item.method || 'none')
    },
    morph: {
      success: morph.success,
      successCount: morph.results.filter((item) => item.success).length,
      total: morph.results.length,
      methods: morph.results.map((item) => item.method || 'none')
    },
    fastQualityMorph: {
      success: fastQualityMorph.success,
      method: fastQualityMorph.results[0]?.method || 'none',
      requestedQuality: fastQualityMorph.diagnostics?.requestedQuality || null,
      requestedSelectedRegions: fastQualityMorph.diagnostics?.requestedSelectedRegions || []
    },
    rejection: {
      success: rejected.success,
      rejectedCount: rejected.results.filter((item) => !item.success).length + (rejected.error ? 1 : 0),
      firstError: rejected.results.find((item) => !item.success)?.error || rejected.error || null
    }
  };

  const tmpDir = ensureTmpDir();
  const jsonPath = path.join(tmpDir, 'shape-morphing-pipeline-smoke.json');
  const mdPath = path.join(tmpDir, 'shape-morphing-pipeline-smoke.md');

  fs.writeFileSync(jsonPath, JSON.stringify({ alignment, morph, fastQualityMorph, summary }, null, 2), 'utf8');
  fs.writeFileSync(
    mdPath,
    [
      '# Shape Morphing Pipeline Smoke',
      '',
      `- alignment: ${summary.alignment.success ? 'pass' : 'fail'} (${summary.alignment.successCount}/${summary.alignment.total})`,
      `- alignment methods: ${summary.alignment.methods.join(', ')}`,
      `- morph: ${summary.morph.success ? 'pass' : 'fail'} (${summary.morph.successCount}/${summary.morph.total})`,
      `- methods: ${summary.morph.methods.join(', ')}`,
      `- fast quality morph: ${summary.fastQualityMorph.success ? 'pass' : 'fail'} (${summary.fastQualityMorph.method}, quality=${summary.fastQualityMorph.requestedQuality}, regions=${summary.fastQualityMorph.requestedSelectedRegions.join(',')})`,
      `- rejection gate: ${summary.rejection.rejectedCount > 0 && !summary.rejection.success ? 'pass' : 'fail'} (${summary.rejection.firstError || 'none'})`
    ].join('\n'),
    'utf8'
  );

  console.log(JSON.stringify(summary, null, 2));

  if (
    !summary.alignment.success ||
    !summary.alignment.methods.every((method) => method === 'skeleton-axis') ||
    !summary.morph.success ||
    !summary.morph.methods.every((method) => method.includes(':region-aware+skeleton') || method.includes(':contour')) ||
    !summary.fastQualityMorph.success ||
    !summary.fastQualityMorph.method.startsWith('optimized-morphing:fast:region-aware+skeleton') ||
    summary.fastQualityMorph.requestedQuality !== 'fast' ||
    summary.fastQualityMorph.requestedSelectedRegions.join(',') !== 'body,toe' ||
    !(summary.rejection.rejectedCount > 0 && !summary.rejection.success)
  ) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[smoke-shape-morphing-pipeline] failed:', error);
  process.exit(1);
});
