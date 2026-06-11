#!/usr/bin/env node

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const repoRoot = path.resolve(__dirname, '..');

const {
  buildMainImageProjectStyleStrategyEvidence
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-project-style-strategy.ts'));
const {
  buildMainImageDesignStandardsEvidence
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-design-standards-evidence.ts'));
const {
  buildMainImageStrategyInputs
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-strategy-input-builder.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function assertNoRawPayload(value, label) {
  const serialized = JSON.stringify(value);
  const forbidden = ['raw-image-payload', 'base64-image-payload', 'data:image/'];
  const found = forbidden.filter((token) => serialized.includes(token));
  assert(found.length === 0, `${label} must not retain raw image-like payloads: ${found.join(', ')}`, value);
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
  subjectSummary: '白色堆堆袜，松弛褶皱感，适合春夏清爽穿搭主图 raw-image-payload data:image/png;base64,abc',
  backgroundSummary: '浅色背景，模特脚部局部露出',
  confidence: 0.82,
  evidence: ['人工标注：白色堆堆袜', '人工标注：褶皱袜筒和清爽穿搭氛围']
};

const sizePlans = [{
  sizeKey: 'tmall-1x1-main-image',
  targetSize: { width: 1440, height: 1440 },
  subjectSize: { width: 1180, height: 720 },
  scale: 0.72,
  targetX: 130,
  targetY: 420,
  decisionReason: '1:1 square main image source size',
  smartLayoutPlanned: true,
  quickExportPlanned: true
}];

function run() {
  const metadataOnlyStyle = buildMainImageProjectStyleStrategyEvidence({
    userText: '根据项目图片做袜子点击图和转化图',
    projectAssets,
    selectedAsset
  });
  const blocked = buildMainImageDesignStandardsEvidence({
    projectStyleStrategyEvidence: metadataOnlyStyle
  });

  assert(blocked.version === 'main-image-design-standards-evidence/v0', 'version mismatch', blocked);
  assert(blocked.status === 'blocked_needs_visual_grounding', 'metadata-only style must block design standards readiness', blocked);
  assert(blocked.canGuideDesignPlan === false, 'blocked standards must not guide design plan', blocked);
  assert(blocked.rules.length > 0, 'blocked standards should still expose generic review rules', blocked);
  assert(blocked.rules.every((rule) => rule.source !== 'project-style-evidence'), 'metadata-only evidence must not be treated as style-grounded rules', blocked);
  assert(blocked.canClaimDesignComplete === false, 'standards evidence cannot claim design completion', blocked);
  assert(blocked.canClaimOutputQuality === false, 'standards evidence cannot claim output quality', blocked);
  assert(blocked.noPhotoshopWrites === true, 'standards evidence must stay read-only', blocked);
  assert(blocked.mustNotExecutePhotoshop === true, 'standards evidence must not execute Photoshop', blocked);
  assertNoRawPayload(blocked, 'blocked design standards evidence');

  const groundedStyle = buildMainImageProjectStyleStrategyEvidence({
    userText: '看项目图片理解袜子款式，制作多个点击图和转化图',
    projectAssets,
    selectedAsset,
    visionSignal: visualSignal,
    desiredClickImageCount: 2,
    desiredConversionImageCount: 2
  });
  const ready = buildMainImageDesignStandardsEvidence({
    projectStyleStrategyEvidence: groundedStyle
  });

  assert(ready.status === 'ready_for_design_strategy', 'visual grounded style should enable design standards', ready);
  assert(ready.canGuideDesignPlan === true, 'ready standards can guide future design plan', ready);
  assert(ready.product.productType === '堆堆袜', 'ready standards should preserve grounded product type', ready);
  assert(ready.clickImageGoals.length > 0, 'ready standards should define click image goals', ready);
  assert(ready.conversionImageGoals.length > 0, 'ready standards should define conversion image goals', ready);
  assert(ready.rules.some((rule) => rule.appliesTo === 'click-image'), 'ready standards should include click image rules', ready);
  assert(ready.rules.some((rule) => rule.appliesTo === 'conversion-image'), 'ready standards should include conversion image rules', ready);
  assert(ready.recipeCandidates.length >= 2, 'ready standards should provide recipe candidates', ready);
  assert(ready.requiredKnowledge.some((item) => item.status === 'missing'), 'ready standards should surface knowledge gaps instead of fabricating sources', ready);
  assert(ready.canClaimDesignComplete === false, 'ready standards still cannot claim design completion', ready);
  assertNoRawPayload(ready, 'ready design standards evidence');

  const strategyInputs = buildMainImageStrategyInputs({
    userText: '看项目图片理解袜子款式，制作多个点击图和转化图',
    imageType: 'click',
    selectedAsset,
    projectAssets,
    subjectBounds: { left: 250, top: 360, right: 1330, bottom: 980, width: 1080, height: 620 },
    sizePlans,
    copyCandidates: ['轻薄堆叠，春夏更自在'],
    outputDir: 'C:/Exports',
    toolNames: ['getDocumentInfo', 'getLayerHierarchy', 'getAcceptanceSnapshot'],
    visionSignal: visualSignal
  });

  assert(strategyInputs.designStandardsEvidence, 'strategy input builder should expose design standards evidence', strategyInputs);
  assert(strategyInputs.designStandardsEvidence.status === 'ready_for_design_strategy', 'strategy builder should carry ready design standards evidence', strategyInputs.designStandardsEvidence);
  assert(strategyInputs.strategyInputs.copyRolePolicy.designStandardsStatus === 'ready_for_design_strategy', 'copy policy should reference design standards status', strategyInputs.strategyInputs.copyRolePolicy);
  assertNoRawPayload(strategyInputs.designStandardsEvidence, 'builder design standards evidence');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'metadata-only project style blocks main-image design standards readiness',
      'visual/manual grounding enables click and conversion standards',
      'design standards expose recipes and knowledge gaps without pretending sources exist',
      'design standards are read-only and cannot claim output quality',
      'main-image strategy input builder exposes designStandardsEvidence'
    ]
  }, null, 2));
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
