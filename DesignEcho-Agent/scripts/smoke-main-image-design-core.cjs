#!/usr/bin/env node

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const repoRoot = path.resolve(__dirname, '..');

const {
  buildMainImageDesignCoreEvidence
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-design-core.ts'));
const {
  buildMainImageProjectStyleStrategyEvidence
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-project-style-strategy.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function assertEqual(actual, expected, message, details) {
  assert(actual === expected, `${message}: expected ${expected}, got ${actual}`, details);
}

function assertArrayEqual(actual, expected, message, details) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    details
  );
}

function assertNoConfidence(value, label) {
  const serialized = JSON.stringify(value);
  const forbidden = ['"confidence"', '置信'];
  const found = forbidden.filter((token) => serialized.includes(token));
  assert(found.length === 0, `${label} must not serialize confidence fields or labels: ${found.join(', ')}`, value);
}

function assertDocumentSpec(documents, expected) {
  const document = documents.find((item) => item.folderKey === expected.folderKey);
  assert(document, `missing delivery document ${expected.folderKey}`, documents);
  assertEqual(document.ratio, expected.ratio, `${expected.folderKey} ratio mismatch`, document);
  assertEqual(document.canvasSize.width, expected.width, `${expected.folderKey} canvas width mismatch`, document);
  assertEqual(document.canvasSize.height, expected.height, `${expected.folderKey} canvas height mismatch`, document);
  assertEqual(document.sourceDocumentPath, expected.sourceDocumentPath, `${expected.folderKey} source document mismatch`, document);
  assertEqual(document.exportFolder, expected.exportFolder, `${expected.folderKey} export folder mismatch`, document);
  assertArrayEqual(document.includedImageTypes, expected.includedImageTypes, `${expected.folderKey} included image types mismatch`, document);
  assertArrayEqual(document.excludedImageTypes, expected.excludedImageTypes, `${expected.folderKey} excluded image types mismatch`, document);
}

const selectedAsset = {
  id: 'asset-1',
  name: 'white-slouch-socks-01.jpg',
  path: 'C:/project/assets/white-slouch-socks-01.jpg',
  role: 'project-image',
  width: 1600,
  height: 1600
};

const projectAssets = [selectedAsset];

const visualSignal = {
  source: 'manual-annotation',
  productType: '堆堆袜',
  subjectSummary: '白色堆堆袜，松弛褶皱感，适合春夏清爽穿搭主图',
  backgroundSummary: '浅色背景，模特脚部局部露出',
  confidence: 0.82,
  evidence: ['人工标注：白色堆堆袜', '人工标注：褶皱袜筒和清爽穿搭氛围']
};

function buildReadyStyle() {
  return buildMainImageProjectStyleStrategyEvidence({
    userText: '看项目图片理解袜子款式，制作多个点击图和转化图',
    projectAssets,
    selectedAsset,
    visionSignal: visualSignal,
    desiredClickImageCount: 2,
    desiredConversionImageCount: 2
  });
}

function run() {
  const missingStyle = buildMainImageDesignCoreEvidence({});
  assertEqual(missingStyle.status, 'blocked_missing_project_style_strategy', 'missing style should block design core', missingStyle);
  assert(missingStyle.blockers.includes('main_image_project_style_strategy_required'), 'missing style blocker mismatch', missingStyle);
  assert(missingStyle.noPhotoshopWrites === true, 'missing style evidence must be read-only', missingStyle);
  assert(missingStyle.mustNotExecutePhotoshop === true, 'missing style evidence must not execute Photoshop', missingStyle);
  assertNoConfidence(missingStyle, 'missing-style design core evidence');

  const metadataOnlyStyle = buildMainImageProjectStyleStrategyEvidence({
    userText: '做袜子主图 raw-image-payload data:image/png;base64,abc',
    projectAssets,
    selectedAsset
  });
  const blockedVisualGrounding = buildMainImageDesignCoreEvidence({
    projectStyleStrategyEvidence: metadataOnlyStyle
  });
  assertEqual(blockedVisualGrounding.status, 'blocked_needs_visual_grounding', 'metadata-only style should block design core', blockedVisualGrounding);
  assert(
    blockedVisualGrounding.blockers.includes('main_image_visual_grounding_required_for_design_core'),
    'visual grounding blocker mismatch',
    blockedVisualGrounding
  );
  assert(blockedVisualGrounding.warnings.some((item) => item.includes('grounding')), 'blocked core should explain visual grounding requirement', blockedVisualGrounding);
  assertNoConfidence(blockedVisualGrounding, 'blocked visual-grounding design core evidence');

  const readyStyle = buildReadyStyle();
  const ready = buildMainImageDesignCoreEvidence({
    projectStyleStrategyEvidence: readyStyle,
    copyCandidates: ['轻薄堆叠，春夏更自在', '柔软袜口，不勒脚踝']
  });

  assertEqual(ready.version, 'main-image-design-core/v0', 'design core version mismatch', ready);
  assertEqual(ready.status, 'ready_design_core_plan', 'visual grounded style should produce ready design core', ready);
  assertEqual(ready.deliveryDocuments.length, 3, 'design core should expose three delivery documents', ready.deliveryDocuments);
  assert(ready.blockers.length === 0, 'ready design core should not have blockers', ready);
  assert(ready.noPhotoshopWrites === true, 'ready design core must be read-only', ready);
  assert(ready.mustNotExecutePhotoshop === true, 'ready design core must not execute Photoshop', ready);

  assertDocumentSpec(ready.deliveryDocuments, {
    folderKey: '800',
    ratio: '1:1',
    width: 1440,
    height: 1440,
    sourceDocumentPath: 'PSD/800.psb',
    exportFolder: '主图/800',
    includedImageTypes: ['click', 'conversion'],
    excludedImageTypes: []
  });
  assertDocumentSpec(ready.deliveryDocuments, {
    folderKey: '750',
    ratio: '3:4',
    width: 1440,
    height: 1920,
    sourceDocumentPath: 'PSD/750.psb',
    exportFolder: '主图/750',
    includedImageTypes: ['click', 'conversion'],
    excludedImageTypes: []
  });
  assertDocumentSpec(ready.deliveryDocuments, {
    folderKey: '1200',
    ratio: '9:16',
    width: 1440,
    height: 2560,
    sourceDocumentPath: 'PSD/1200.psb',
    exportFolder: '主图/1200',
    includedImageTypes: ['click'],
    excludedImageTypes: ['conversion']
  });

  const white = ready.whiteBackgroundSpec;
  assertEqual(white.sourceDocumentPath, 'PSD/SKU.psb', 'white background source document mismatch', white);
  assertEqual(white.outputPath, '主图/白底.jpg', 'white background output path mismatch', white);
  assertEqual(white.canvasSize.width, 800, 'white background canvas width mismatch', white);
  assertEqual(white.canvasSize.height, 800, 'white background canvas height mismatch', white);
  assertEqual(white.targetSubjectHeightPx, 760, 'white background target subject height mismatch', white);
  assertEqual(white.totalHorizontalMarginPx, 40, 'white background total horizontal margin mismatch', white);
  assert(white.rules.some((rule) => rule.includes('SKU')), 'white background rules should keep SKU source boundary', white);

  const serializedReady = JSON.stringify(ready);
  assert(!serializedReady.includes('raw-image-payload'), 'design core should not retain raw payload markers', ready);
  assert(!serializedReady.includes('data:image/'), 'design core should not retain image data URLs', ready);
  assertNoConfidence(ready, 'ready design core evidence');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'design core blocks when project style strategy is missing',
      'design core blocks when project style strategy is metadata-only',
      'visual grounded style produces ready design core',
      'delivery documents are exactly 800/750/1200',
      '1200 includes click and excludes conversion',
      'white background output uses PSD/SKU.psb and exports 主图/白底.jpg at 800x800',
      'serialized design core evidence does not contain confidence or 置信'
    ]
  }, null, 2));
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
