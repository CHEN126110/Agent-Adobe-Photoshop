#!/usr/bin/env node

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const repoRoot = path.resolve(__dirname, '..');

const {
  buildEcommerceSocksStrategyCheckpoint
} = require(path.join(repoRoot, 'src', 'shared', 'ecommerce-socks-strategy-checkpoint.ts'));
const {
  buildEcommerceSocksChildStrategyPacketSet
} = require(path.join(repoRoot, 'src', 'shared', 'ecommerce-socks-child-strategy-packets.ts'));
const {
  buildEcommerceSocksChildStrategyReviewGate
} = require(path.join(repoRoot, 'src', 'shared', 'ecommerce-socks-child-strategy-review-gate.ts'));
const {
  buildMainImageAgentDraftPlan
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-agent-draft-plan.ts'));
const {
  buildMainImageStrategyInputs
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-strategy-input-builder.ts'));
const {
  buildMainImageAssetHeroStrategyEvidence
} = require(path.join(repoRoot, 'src', 'shared', 'main-image-asset-hero-strategy.ts'));

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

const parentStrategyInputs = {
  designStandards: true,
  knowledgeRecipeSource: true,
  assetUnderstanding: true,
  imagePlacementPlan: true,
  photoshopToolPlan: true,
  qaAcceptancePlan: true,
  performanceBudget: true
};

const readySizePlans = [{
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

const readyInput = {
  userText: '帮我用这张袜子图做主图 raw-image-payload data:image/png;base64,abc',
  imageType: 'click',
  currentDocument: { id: 1, name: 'SKU.psb', width: 1200, height: 1200 },
  selectedAsset: {
    id: 'asset-1',
    name: 'white-socks.jpg',
    path: 'C:/project/assets/white-socks.jpg',
    width: 1600,
    height: 1600,
    role: 'selected-project-image'
  },
  projectAssets: [
    { name: 'white-socks.jpg', path: 'C:/project/assets/white-socks.jpg', role: 'selected-project-image' },
    { name: '合格证.jpg', path: 'C:/project/assets/certificate.jpg', role: 'reference' },
    { name: 'detail-shot.jpg', path: 'C:/project/assets/detail-shot.jpg', role: 'project-image' }
  ],
  subjectBounds: { left: 170, top: 150, right: 930, bottom: 970, width: 760, height: 820 },
  sizePlans: readySizePlans,
  copyCandidates: ['轻薄透气，春夏出行更自在'],
  outputDir: 'C:/Exports',
  toolNames: ['getDocumentInfo', 'getLayerBounds'],
  visionSignal: {
    source: 'manual-annotation',
    productType: '堆堆袜',
    subjectSummary: '白色袜子主体，适合白底主图',
    backgroundSummary: '简洁浅色背景',
    confidence: 0.72,
    evidence: ['人工标注的商品类型与主体描述']
  }
};

function buildApprovedGate() {
  const checkpoint = buildEcommerceSocksStrategyCheckpoint({
    userCheckpointConfirmed: true,
    deliverables: ['main-image', 'detail-page', 'sku'],
    strategyInputsBySkill: {
      'main-image-design': parentStrategyInputs,
      'detail-page-design': parentStrategyInputs,
      'sku-batch': parentStrategyInputs
    }
  });
  const packetSet = buildEcommerceSocksChildStrategyPacketSet({ strategyCheckpoint: checkpoint });
  return buildEcommerceSocksChildStrategyReviewGate({
    packetSet,
    userReviewedStrategyPackets: true,
    acknowledgedStrategyBoundaries: true,
    approvedSkillIds: ['main-image-design', 'detail-page-design', 'sku-batch']
  });
}

function run() {
  const empty = buildMainImageAssetHeroStrategyEvidence({ userText: '帮我做主图' });
  assert(empty.version === 'main-image-asset-hero-strategy/v0', 'asset hero strategy version mismatch', empty);
  assert(empty.status === 'blocked_missing_asset', 'empty context should block on missing asset', empty);
  assert(empty.strategyInputPatch.assetSelectionPolicy === undefined, 'missing asset must not fabricate asset policy', empty);
  assert(empty.strategyInputPatch.heroSubjectPolicy === undefined, 'missing subject must not fabricate hero policy', empty);
  assert(empty.noPhotoshopWrites === true, 'asset hero strategy must be read-only', empty);
  assert(empty.mustNotExecutePhotoshop === true, 'asset hero strategy must not execute Photoshop', empty);
  assertNoRawPayload(empty, 'empty asset hero evidence');
  assertNoConfidenceField(empty, 'empty asset hero evidence');

  const metadataOnly = buildMainImageAssetHeroStrategyEvidence({
    ...readyInput,
    visionSignal: null
  });
  assert(metadataOnly.status === 'ready_metadata_only', 'metadata-only evidence should be ready but not visually grounded', metadataOnly);
  assert(metadataOnly.assetUnderstanding.visualGrounding === 'none', 'metadata-only evidence must not invent visual grounding', metadataOnly);
  assert(metadataOnly.heroSubjectSelection.productType === 'unknown', 'missing vision must keep product type unknown', metadataOnly);
  assert(metadataOnly.canClaimOutputQuality === false, 'metadata-only evidence cannot claim output quality', metadataOnly);
  assertNoRawPayload(metadataOnly, 'metadata-only asset hero evidence');
  assertNoConfidenceField(metadataOnly, 'metadata-only asset hero evidence');

  const visualGrounded = buildMainImageAssetHeroStrategyEvidence(readyInput);
  assert(visualGrounded.status === 'ready_visual_grounded', 'vision/manual grounded evidence should be ready_visual_grounded', visualGrounded);
  assert(visualGrounded.assetUnderstanding.selectedAssetName === 'white-socks.jpg', 'selected asset should be preserved', visualGrounded);
  assert(visualGrounded.assetUnderstanding.visualGrounding === 'manual-annotation', 'manual annotation should be recorded as grounding source', visualGrounded);
  assert(visualGrounded.heroSubjectSelection.productType === '堆堆袜', 'grounded product type should be preserved', visualGrounded);
  assert(visualGrounded.strategyInputPatch.assetSelectionPolicy, 'asset policy patch should exist when asset is grounded', visualGrounded);
  assert(visualGrounded.strategyInputPatch.heroSubjectPolicy, 'hero policy patch should exist when subject bounds are grounded', visualGrounded);
  assertNoRawPayload(visualGrounded, 'visual grounded asset hero evidence');
  assertNoConfidenceField(visualGrounded, 'visual grounded asset hero evidence');

  const withoutSubject = buildMainImageAssetHeroStrategyEvidence({
    ...readyInput,
    subjectBounds: null
  });
  assert(withoutSubject.status === 'blocked_missing_subject_bounds', 'asset without subject bounds should block hero selection', withoutSubject);
  assert(withoutSubject.strategyInputPatch.assetSelectionPolicy, 'asset policy can remain grounded without subject bounds', withoutSubject);
  assert(withoutSubject.strategyInputPatch.heroSubjectPolicy === undefined, 'missing subject bounds must not fabricate hero policy', withoutSubject);
  assertNoConfidenceField(withoutSubject, 'missing subject bounds asset hero evidence');

  const strategyInputs = buildMainImageStrategyInputs(readyInput);
  assert(strategyInputs.assetHeroStrategyEvidence, 'strategy input builder should expose asset hero strategy evidence', strategyInputs);
  assert(strategyInputs.strategyInputs.assetSelectionPolicy, 'builder should consume asset hero asset policy patch', strategyInputs);
  assert(strategyInputs.strategyInputs.heroSubjectPolicy, 'builder should consume asset hero subject policy patch', strategyInputs);
  assertNoRawPayload(strategyInputs.assetHeroStrategyEvidence, 'builder asset hero strategy evidence');
  assertNoConfidenceField(strategyInputs.assetHeroStrategyEvidence, 'builder asset hero strategy evidence');
  assertNoConfidenceField(strategyInputs.strategyInputs.heroSubjectPolicy, 'builder hero subject policy');

  const draft = buildMainImageAgentDraftPlan({
    ...readyInput,
    strategyReviewGate: buildApprovedGate()
  });
  assert(draft.mainImageStrategyInputEvidence.assetHeroStrategyEvidence, 'draft should expose asset hero evidence through strategy input evidence', draft);
  assert(draft.mainImageStrategyContract.status === 'ready_for_main_image_strategy_design', 'asset hero evidence should support ready strategy contract', draft.mainImageStrategyContract);
  assertNoRawPayload(draft.mainImageStrategyInputEvidence.assetHeroStrategyEvidence, 'draft asset hero evidence');
  assertNoConfidenceField(draft.mainImageStrategyInputEvidence.assetHeroStrategyEvidence, 'draft asset hero evidence');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'asset hero strategy helper is read-only and cannot execute Photoshop',
      'missing asset and missing subject bounds do not fabricate strategy inputs',
      'metadata-only asset evidence keeps product type unknown without vision/manual grounding',
      'manual or vision grounded signal enters asset understanding and hero subject policy',
      'strategy input builder and main-image draft expose assetHeroStrategyEvidence'
    ]
  }, null, 2));
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
