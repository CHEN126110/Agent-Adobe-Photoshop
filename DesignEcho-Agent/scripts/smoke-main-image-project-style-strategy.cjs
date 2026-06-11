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

function collectFieldPaths(value, fieldName, pathLabel = '$') {
  if (!value || typeof value !== 'object') return [];
  const paths = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      paths.push(...collectFieldPaths(item, fieldName, `${pathLabel}[${index}]`));
    });
    return paths;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${pathLabel}.${key}`;
    if (key === fieldName) paths.push(childPath);
    paths.push(...collectFieldPaths(child, fieldName, childPath));
  }
  return paths;
}

function assertNoConfidenceField(value, label) {
  const paths = collectFieldPaths(value, 'confidence');
  assert(paths.length === 0, `${label} output JSON must not contain confidence fields`, { paths, value });
}

const projectAssets = [
  {
    id: 'asset-1',
    name: 'white-slouch-socks-01.jpg',
    path: 'C:/project/assets/white-slouch-socks-01.jpg',
    role: 'project-image',
    width: 1600,
    height: 1600
  },
  {
    id: 'asset-2',
    name: 'model-foot-detail.jpg',
    path: 'C:/project/assets/model-foot-detail.jpg',
    role: 'project-image',
    width: 1600,
    height: 1200
  }
];

const visualSignal = {
  source: 'manual-annotation',
  productType: '堆堆袜',
  subjectSummary: '白色堆堆袜，松弛褶皱感，适合春夏清爽穿搭主图',
  backgroundSummary: '浅色背景，模特脚部局部露出',
  styleHints: ['白色', '褶皱袜筒'],
  agentDecision: {
    styleKeywords: ['松弛堆叠', '浅色干净'],
    recommendedTone: '模型决策：清爽、可信、低广告感',
    backgroundDirection: '模型决策：浅色干净背景，保留足够留白。',
    clickVisualHooks: ['罗口轮廓', '上脚氛围', '颜色与轮廓'],
    conversionVisualHooks: ['透气纹理', '袜口舒适感'],
    clickLayoutFocus: '模型决策：主体靠中上，标题避开袜口细节。',
    conversionLayoutFocus: '模型决策：主体与卖点分区，保留材质细节放大位。',
    clickCopyRole: '模型决策：短标题强调第一眼清爽感。',
    conversionCopyRole: '模型决策：说明透气纹理和袜口舒适体验。',
    referenceQueries: ['模型决策：白色堆堆袜 主图 参考']
  },
  evidence: ['人工标注：白色堆堆袜', '人工标注：褶皱袜筒和清爽穿搭氛围']
};

const sizePlans = [{
  sizeKey: '800',
  targetSize: { width: 800, height: 800 },
  subjectSize: { width: 760, height: 820 },
  scale: 0.67,
  targetX: 118,
  targetY: 92,
  decisionReason: 'main image guideline scale 67%',
  smartLayoutPlanned: true,
  quickExportPlanned: true
}];

function run() {
  const metadataOnly = buildMainImageProjectStyleStrategyEvidence({
    userText: '根据项目图片做几张袜子点击图和转化图 raw-image-payload data:image/png;base64,abc',
    projectAssets,
    selectedAsset: projectAssets[0],
    desiredClickImageCount: 2,
    desiredConversionImageCount: 2
  });

  assert(metadataOnly.version === 'main-image-project-style-strategy/v0', 'version mismatch', metadataOnly);
  assert(metadataOnly.status === 'needs_vision', 'metadata-only project style must require vision before style claims', metadataOnly);
  assert(metadataOnly.projectStyleUnderstanding.productType === 'unknown', 'metadata-only must not guess product type', metadataOnly);
  assert(metadataOnly.variantPlan.clickImages.length === 0, 'metadata-only must not generate click image variants', metadataOnly);
  assert(metadataOnly.variantPlan.conversionImages.length === 0, 'metadata-only must not generate conversion image variants', metadataOnly);
  assert(metadataOnly.referenceResearchPlan.status === 'planned_not_run', 'reference search must be a plan, not a fabricated result', metadataOnly);
  assert(metadataOnly.noPhotoshopWrites === true, 'style strategy must be read-only', metadataOnly);
  assert(metadataOnly.mustNotExecutePhotoshop === true, 'style strategy must not execute Photoshop', metadataOnly);
  assertNoRawPayload(metadataOnly, 'metadata-only project style evidence');
  assertNoConfidenceField(metadataOnly, 'metadata-only project style evidence');

  const grounded = buildMainImageProjectStyleStrategyEvidence({
    userText: '看项目图片理解袜子款式，查找参考，制作多个点击图和转化图',
    projectAssets,
    selectedAsset: projectAssets[0],
    visionSignal: visualSignal,
    desiredClickImageCount: 3,
    desiredConversionImageCount: 2,
    referenceHints: [
      { title: '清爽白袜电商主图参考', source: 'manual-reference-note', url: 'https://example.com/ref' }
    ]
  });

  assert(grounded.status === 'ready_visual_grounded', 'visual grounded style evidence should be ready', grounded);
  assert(grounded.projectStyleUnderstanding.productType === '堆堆袜', 'visual product type should be preserved', grounded);
  assert(grounded.projectStyleUnderstanding.visualGrounding === 'manual-annotation', 'visual grounding source should be preserved', grounded);
  assert(grounded.designDirection.objectives.includes('click-image'), 'design direction should include click-image objective', grounded);
  assert(grounded.designDirection.objectives.includes('conversion-image'), 'design direction should include conversion-image objective', grounded);
  assert(grounded.designDirection.styleKeywords[0] === visualSignal.agentDecision.styleKeywords[0], 'style keywords must come from agent decision', grounded.designDirection);
  assert(grounded.designDirection.recommendedTone === visualSignal.agentDecision.recommendedTone, 'recommended tone must come from agent decision', grounded.designDirection);
  assert(grounded.referenceResearchPlan.querySeeds[0] === visualSignal.agentDecision.referenceQueries[0], 'reference query must use agent decision when provided', grounded.referenceResearchPlan);
  assert(grounded.variantPlan.clickImages.length === 3, 'should plan requested click image variants', grounded);
  assert(grounded.variantPlan.conversionImages.length === 2, 'should plan requested conversion image variants', grounded);
  assert(grounded.variantPlan.clickImages.every((item) => item.imageType === 'click'), 'click variants should be typed', grounded);
  assert(grounded.variantPlan.conversionImages.every((item) => item.imageType === 'conversion'), 'conversion variants should be typed', grounded);
  assert(grounded.variantPlan.clickImages[0].visualHook === visualSignal.agentDecision.clickVisualHooks[0], 'click visual hook must come from agent decision', grounded.variantPlan.clickImages[0]);
  assert(grounded.variantPlan.conversionImages[0].copyRole === visualSignal.agentDecision.conversionCopyRole, 'conversion copy role must come from agent decision', grounded.variantPlan.conversionImages[0]);
  assert(grounded.canClaimDesignComplete === false, 'variant strategy cannot claim design complete', grounded);
  assert(grounded.canClaimOutputQuality === false, 'variant strategy cannot claim output quality', grounded);
  assertNoRawPayload(grounded, 'grounded project style evidence');
  assertNoConfidenceField(grounded, 'grounded project style evidence');

  const strategyInputs = buildMainImageStrategyInputs({
    userText: '做几张点击图和转化图',
    imageType: 'click',
    selectedAsset: projectAssets[0],
    projectAssets,
    subjectBounds: { left: 170, top: 150, right: 930, bottom: 970, width: 760, height: 820 },
    sizePlans,
    copyCandidates: ['清爽堆叠，春夏更自在'],
    outputDir: 'C:/Exports',
    toolNames: ['getDocumentInfo', 'getSubjectBounds', 'smartLayout[800]'],
    visionSignal: visualSignal
  });

  assert(strategyInputs.projectStyleStrategyEvidence, 'strategy input builder should expose project style evidence', strategyInputs);
  assert(strategyInputs.projectStyleStrategyEvidence.status === 'ready_visual_grounded', 'strategy builder should carry grounded style evidence', strategyInputs);
  assert(strategyInputs.strategyInputs.copyRolePolicy.projectStyleStrategyStatus === 'ready_visual_grounded', 'copy policy should reference project style status', strategyInputs.strategyInputs.copyRolePolicy);
  assertNoRawPayload(strategyInputs.projectStyleStrategyEvidence, 'builder project style evidence');
  assertNoConfidenceField(strategyInputs.projectStyleStrategyEvidence, 'builder project style evidence');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'metadata-only project images cannot produce sock style claims or variants',
      'visual/manual grounding can produce click and conversion image variant plans',
      'reference research is planned evidence, not fabricated search results',
      'project style strategy is read-only and cannot execute Photoshop',
      'main-image strategy input builder exposes projectStyleStrategyEvidence'
    ]
  }, null, 2));
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
