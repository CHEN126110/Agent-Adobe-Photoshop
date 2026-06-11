#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    target: 'ES2020',
    module: 'CommonJS',
    moduleResolution: 'node',
    esModuleInterop: true,
    skipLibCheck: true
  }
});

const {
  projectContextSnapshotService
} = require('../src/main/services/project-context-snapshot-service.ts');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertNoMojibake(value, label) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const signals = ['\u9359', '\u93c8', '\u951b', '\u95c8', '\u7f01', '\u20ac', '\ufffd'];
  for (const signal of signals) {
    assert(!text.includes(signal), `${label} contains mojibake signal ${JSON.stringify(signal)}`);
  }
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function buildFixture(root) {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });

  writeFile(path.join(root, '.designecho', 'project.json'), JSON.stringify({
    version: '1.0',
    createdAt: '2026-05-14T00:00:00.000Z',
    lastOpenedAt: '2026-05-14T00:00:00.000Z',
    projectPath: root,
    projectName: 'runtime-context-smoke',
    folderMappings: {
      '原图': 'source',
      'SKU': 'sku',
      '主图': 'mainImage',
      '模板文件': 'psd'
    },
    imageClassifications: {}
  }, null, 2));

  writeFile(path.join(root, '原图', 'C82602', 'YYC_0294.jpg'), 'not-a-real-jpg');
  writeFile(path.join(root, '原图', 'C82602', '白色.jpg'), 'not-a-real-jpg');
  writeFile(path.join(root, 'SKU', '2双装', '白色+黑色.png'), 'not-a-real-png');
  writeFile(path.join(root, '主图', '800', '主图01.jpg'), 'not-a-real-jpg');
  writeFile(path.join(root, '模板文件', 'SKU.psb'), 'not-a-real-psb');
  writeFile(path.join(root, 'SKU配置.csv'), '模板,组合\nSKU.psb,白色+黑色\nSKU.psb,米白+奶白\n');
}

async function main() {
  const agentRoot = path.resolve(__dirname, '..');
  const fixtureRoot = path.join(agentRoot, 'tmp', 'smoke-project-context-runtime');
  assert(
    fixtureRoot.startsWith(path.join(agentRoot, 'tmp')),
    'fixture root must stay inside agent tmp directory'
  );
  buildFixture(fixtureRoot);

  const result = await projectContextSnapshotService.build({
    projectPath: fixtureRoot,
    selectedAssetPaths: [path.join(fixtureRoot, '原图', 'C82602', '白色.jpg')],
    userConstraints: ['runtime smoke only'],
    visualSamplingScenario: 'sku'
  });

  assert(result.success === true, 'runtime snapshot should succeed');
  assert(result.source === 'runtime-project-service', 'snapshot source should be runtime service');
  assert(result.contextSnapshot.snapshotVersion === 'context-snapshot/v0', 'snapshot version should be stable');
  assert(result.assetIndex.indexVersion === 'project-asset-index/v0', 'asset index version should be stable');
  assert(result.visualSamplingPlan.planVersion === 'project-visual-sampling/v0', 'visual sampling plan version should be stable');
  assert(result.visualSamplingPlan.scenario === 'sku', 'runtime snapshot should honor requested sku visual sampling scenario');
  assert(
    result.contextSnapshot.visualSamplingPlan?.planVersion === 'project-visual-sampling/v0',
    'context snapshot should carry visual sampling plan'
  );
  assert(
    result.contextSnapshot.visualSamplingPlan?.scenario === 'sku',
    'context snapshot should preserve requested sku visual sampling scenario'
  );
  assert(result.assetIndex.summary.totalImages >= 4, 'asset index should include image candidates');
  assert(result.assetIndex.summary.totalDesignDocuments >= 1, 'asset index should include design documents');
  assert(result.assetIndex.summary.skuConfigCount >= 2, 'asset index should parse SKU CSV rows');
  assert(
    result.visualSamplingPlan.selectedCandidates.length > 0,
    'runtime visual sampling should select bounded candidates'
  );
  assert(
    result.visualSamplingPlan.selectedCandidates[0]?.role === 'color-single',
    'sku visual sampling should prioritize color-single assets when they exist'
  );

  const mainImageResult = await projectContextSnapshotService.build({
    projectPath: fixtureRoot,
    selectedAssetPaths: [path.join(fixtureRoot, '原图', 'C82602', '白色.jpg')],
    visualSamplingScenario: 'main-image',
    usePersistedVisualInsightCache: false
  });
  assert(mainImageResult.visualSamplingPlan.scenario === 'main-image', 'runtime snapshot should honor requested main-image scenario');
  assert(
    mainImageResult.visualSamplingPlan.selectedCandidates[0]?.role === 'raw-model-wear',
    'main-image visual sampling should prioritize model wearing assets when they exist'
  );
  assert(
    result.visualSamplingPlan.limitations.some((item) => item.includes('不读取图片像素')),
    'visual sampling plan must not claim pixel reads'
  );
  assert(
    result.contextSnapshot.selectedAssetPaths.some((item) => item.includes('白色.jpg')),
    'snapshot should preserve selected asset evidence'
  );
  assert(
    result.contextSnapshot.limitations.some((item) => item.includes('不是 Photoshop 执行结果')),
    'snapshot must not claim Photoshop execution'
  );
  assert(
    result.contextSnapshot.unverifiedItems.some((item) => item.includes('视觉模型') || item.includes('人工确认')),
    'snapshot should keep visual sampling unverified'
  );
  assertNoMojibake(result, 'runtime context snapshot result');

  console.log(JSON.stringify({
    ok: true,
    source: result.source,
    totalImages: result.assetIndex.summary.totalImages,
    totalDesignDocuments: result.assetIndex.summary.totalDesignDocuments,
    skuConfigCount: result.assetIndex.summary.skuConfigCount,
    readiness: result.contextSnapshot.readiness,
    visualSamplingCandidates: result.visualSamplingPlan.selectedCandidates.length,
    visualSamplingCache: result.visualSamplingPlan.cacheSummary
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
