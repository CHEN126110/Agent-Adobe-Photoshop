#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { TextDecoder } = require('util');

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
  buildContextSnapshot,
  buildProjectAssetIndex,
  parseSkuConfigCsv
} = require('../src/shared/project-asset-index.ts');
const { planDesignTask } = require('../src/shared/design-planner.ts');

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.bmp', '.gif']);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertNoMojibake(value, label) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const signals = [
    '\u9359',
    '\u93c8',
    '\u951b',
    '\u95c8',
    '\u7f01',
    '\u20ac',
    '\ufffd'
  ];
  for (const signal of signals) {
    assert(!text.includes(signal), `${label} contains mojibake signal ${JSON.stringify(signal)}`);
  }
}

function fixtureFiles() {
  return [
    {
      path: 'C:/fixture/C82602/YYC_0294.jpg',
      relativePath: 'C82602/YYC_0294.jpg',
      width: 5464,
      height: 8192,
      sizeBytes: 12_000_000
    },
    {
      path: 'C:/fixture/C82602/ZQL_0631.jpg',
      relativePath: 'C82602/ZQL_0631.jpg',
      width: 6720,
      height: 4480,
      sizeBytes: 10_000_000
    },
    {
      path: 'C:/fixture/C82602/新建文件夹/白色.jpg',
      relativePath: 'C82602/新建文件夹/白色.jpg',
      width: 6720,
      height: 4480
    },
    {
      path: 'C:/fixture/主图/800/主图01.jpg',
      relativePath: '主图/800/主图01.jpg',
      width: 1500,
      height: 1500
    },
    {
      path: 'C:/fixture/SKU/2双装/白色+黑色.jpg',
      relativePath: 'SKU/2双装/白色+黑色.jpg',
      width: 2000,
      height: 2000
    },
    {
      path: 'C:/fixture/images/详情页_01.jpg',
      relativePath: 'images/详情页_01.jpg',
      width: 1000,
      height: 1022
    },
    {
      path: 'C:/fixture/模板文件/2双装.tif',
      relativePath: '模板文件/2双装.tif',
      width: 2000,
      height: 2000
    },
    {
      path: 'C:/fixture/PSD/详情页.psb',
      relativePath: 'PSD/详情页.psb',
      sizeBytes: 2_700_000_000
    },
    {
      path: 'C:/fixture/配置文件/C-661配置文件.csv',
      relativePath: '配置文件/C-661配置文件.csv',
      sizeBytes: 256
    }
  ];
}

function fixtureFolderMappings() {
  return {
    PSD: 'psd',
    SKU: 'sku',
    主图: 'mainImage',
    主图视频: 'mainImage',
    images: 'source',
    模板文件: 'template',
    配置文件: 'config'
  };
}

function runSyntheticFixture() {
  const skuRows = parseSkuConfigCsv('模板,配置\n2双装.tif,1+1\n2双装.tif,白色+黑色\n');
  const index = buildProjectAssetIndex({
    projectName: 'fixture',
    projectPath: 'C:/fixture',
    folderMappings: fixtureFolderMappings(),
    files: fixtureFiles(),
    skuConfigRows: skuRows
  });

  assert(index.indexVersion === 'project-asset-index/v0', 'project asset index version mismatch');
  assert(index.summary.totalFiles === 9, 'fixture should index all files');
  assert(index.summary.totalImages === 7, 'fixture should count images');
  assert(index.summary.totalDesignDocuments === 1, 'fixture should count PSB');
  assert(index.summary.roleCounts['raw-model-wear'] === 1, 'fixture should classify YYC as model wear');
  assert(index.summary.roleCounts['raw-product-still'] === 1, 'fixture should classify ZQL as product still');
  assert(index.summary.roleCounts['color-single'] === 1, 'fixture should classify color single');
  assert(index.summary.roleCounts['main-image-output'] === 1, 'fixture should classify main image output');
  assert(index.summary.roleCounts['sku-output'] === 1, 'fixture should classify SKU output');
  assert(index.summary.roleCounts['detail-page-slice'] === 1, 'fixture should classify detail page slice');
  assert(index.summary.roleCounts.template === 1, 'fixture should classify template');
  assert(index.summary.roleCounts.psd === 1, 'fixture should classify PSB');
  assert(index.summary.roleCounts.config === 1, 'fixture should classify config');
  assert(index.summary.colorNames.includes('白色'), 'fixture should extract color name');
  assert(index.summary.skuConfigCount === 2, 'fixture should parse SKU config rows');
  assert(index.visionCandidates.some((item) => item.role === 'raw-model-wear'), 'vision candidates should include raw model wear');
  assert(!index.visionCandidates.some((item) => item.role === 'sku-output'), 'vision candidates should exclude existing SKU output');
  assert(index.limitations.some((item) => item.includes('不做审美判断')), 'limitations should state no aesthetic judgement');

  const mainImageReadiness = index.skillReadiness.find((item) => item.skill === 'main-image');
  assert(mainImageReadiness?.status === 'needs_visual_sampling', 'main image should need visual sampling');

  const snapshot = buildContextSnapshot({
    projectPath: 'C:/fixture',
    projectName: 'fixture',
    assetIndex: index,
    userConstraints: ['先理解图片，再选择能力']
  });
  assert(snapshot.snapshotVersion === 'context-snapshot/v0', 'context snapshot version mismatch');
  assert(snapshot.assetIndex.summary.totalImages === 7, 'snapshot should include asset index');
  assert(snapshot.readiness === 'needs_visual_sampling', 'snapshot should request visual sampling');

  const plannerOutput = planDesignTask({
    userText: '帮我做主图',
    projectContext: {
      projectPath: 'C:/fixture',
      assetIndex: index
    }
  });
  assert(plannerOutput.readiness === 'ready', 'planner should become ready when assetIndex supplies assets');
  assert(plannerOutput.selectedContext.assetIndex.totalImages === 7, 'planner should expose assetIndex summary');
  assert(
    JSON.stringify(plannerOutput.executionPlan.steps).includes('ProjectAssetIndex candidate evidence'),
    'planner steps should require ProjectAssetIndex candidate evidence'
  );
  assertNoMojibake(index, 'synthetic project asset index');

  return index;
}

function collectFiles(root) {
  const files = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolutePath);
      } else if (entry.isFile()) {
        const stat = fs.statSync(absolutePath);
        const relativePath = path.relative(root, absolutePath).replace(/\\/g, '/');
        files.push({
          path: absolutePath.replace(/\\/g, '/'),
          relativePath,
          name: entry.name,
          extension: path.extname(entry.name),
          sizeBytes: stat.size
        });
      }
    }
  }
  return files;
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function decodeCsvBuffer(buffer) {
  try {
    return new TextDecoder('gb18030').decode(buffer);
  } catch {
    try {
      return require('iconv-lite').decode(buffer, 'gbk');
    } catch {
      return buffer.toString('utf8');
    }
  }
}

function readSkuConfigRows(projectRoot) {
  const configDir = path.join(projectRoot, '配置文件');
  if (!fs.existsSync(configDir)) return [];
  const csvFile = fs.readdirSync(configDir).find((name) => path.extname(name).toLowerCase() === '.csv');
  if (!csvFile) return [];
  const buffer = fs.readFileSync(path.join(configDir, csvFile));
  return parseSkuConfigCsv(decodeCsvBuffer(buffer));
}

function runLiveC1140IfAvailable() {
  const projectRoot = process.env.DESIGNECHO_C1140_PROJECT || 'D:/A1 neveralone旗舰店/C-1140';
  const requireLive = process.argv.includes('--require-live-c1140');
  if (!fs.existsSync(projectRoot)) {
    if (requireLive) {
      throw new Error(`C-1140 project missing: ${projectRoot}`);
    }
    return { available: false, projectRoot };
  }

  const projectJson = readJsonIfExists(path.join(projectRoot, '.designecho', 'project.json')) || {};
  const folderMappings = projectJson.folderMappings || fixtureFolderMappings();
  const files = collectFiles(projectRoot);
  const skuRows = readSkuConfigRows(projectRoot);
  const index = buildProjectAssetIndex({
    projectPath: projectRoot.replace(/\\/g, '/'),
    projectName: projectJson.projectName || path.basename(projectRoot),
    folderMappings,
    files,
    skuConfigRows: skuRows
  });

  assert(index.summary.totalFiles >= 100, 'C-1140 should expose project-level file evidence');
  assert(index.summary.totalImages >= 100, 'C-1140 should expose project-level image evidence');
  assert(index.summary.roleCounts['main-image-output'] > 0, 'C-1140 should classify existing main image outputs');
  assert(index.summary.roleCounts['sku-output'] > 0, 'C-1140 should classify existing SKU outputs');
  assert(index.summary.roleCounts['detail-page-slice'] > 0, 'C-1140 should classify detail page slices');
  assert(index.summary.roleCounts['color-single'] >= 6, 'C-1140 should classify color singles');
  assert(index.summary.totalDesignDocuments >= 3, 'C-1140 should expose PSB documents');
  assert(index.summary.skuConfigCount > 0, 'C-1140 should decode SKU CSV config rows');
  assert(index.visionCandidates.length > 0, 'C-1140 should provide visual sampling candidates');
  assert(index.skillReadiness.every((item) => item.status !== 'needs_assets'), 'C-1140 skill readiness should not need assets');
  assertNoMojibake(index, 'C-1140 project asset index');

  return {
    available: true,
    projectRoot,
    summary: index.summary,
    visionCandidateCount: index.visionCandidates.length,
    skillReadiness: index.skillReadiness
  };
}

function main() {
  const syntheticIndex = runSyntheticFixture();
  const liveC1140 = runLiveC1140IfAvailable();
  console.log(JSON.stringify({
    ok: true,
    synthetic: {
      totalImages: syntheticIndex.summary.totalImages,
      roleCounts: syntheticIndex.summary.roleCounts,
      visionCandidateCount: syntheticIndex.visionCandidates.length
    },
    liveC1140
  }, null, 2));
}

main();
