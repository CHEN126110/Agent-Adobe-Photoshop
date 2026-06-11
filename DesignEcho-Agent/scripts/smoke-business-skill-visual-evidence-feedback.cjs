#!/usr/bin/env node

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

const fs = require('fs');
const path = require('path');

const {
  buildBusinessSkillVisualEvidenceGate
} = require('../src/shared/business-skill-visual-evidence-gate.ts');
const {
  buildBusinessSkillVisualEvidenceFeedback
} = require('../src/shared/business-skill-visual-evidence-feedback.ts');
const {
  attachBusinessVisualEvidenceGateToResult,
  buildBusinessVisualEvidenceGateForSkill
} = require('../src/renderer/services/skill-executors/business-skill-visual-evidence-gate.ts');
const {
  convertLegacyMessage
} = require('../src/renderer/components/message/parser.ts');

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNoMojibake(value, label) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const suspiciousTokens = [
    0x93B4,
    0x93C9,
    0x7487,
    0x951B,
    0xFFFD
  ].map((codePoint) => String.fromCodePoint(codePoint));
  const found = suspiciousTokens.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} contains mojibake tokens: ${found.join(', ')}`);
}

function assertNoRawPayload(value, label) {
  const text = JSON.stringify(value);
  const forbidden = ['base64', 'rawImage', 'pixels', 'buffer', 'dataUrl'];
  const found = forbidden.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} contains raw payload markers: ${found.join(', ')}`);
}

function assertNoPseudoThinking(value, label) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const forbidden = [
    '正在思考',
    '等待响应',
    '请求已发送',
    '正在准备',
    '稍等',
    '模型 / 工具真实事件',
    '真实事件'
  ];
  const found = forbidden.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} contains pseudo-thinking copy: ${found.join(', ')}`);
}

function buildProjectContext(options = {}) {
  return {
    projectPath: 'D:/demo-project',
    assetIndex: {
      indexVersion: 'project-asset-index/v0',
      generatedAt: '2026-05-15T00:00:00.000Z',
      projectPath: 'D:/demo-project',
      assets: [],
      visionCandidates: [
        {
          assetId: 'asset-1',
          path: 'D:/demo-project/source/asset-1.jpg',
          role: 'raw-product-still',
          priority: 80,
          reason: 'fixture'
        },
        {
          assetId: 'asset-2',
          path: 'D:/demo-project/source/asset-2.jpg',
          role: 'raw-product-still',
          priority: 70,
          reason: 'fixture'
        }
      ],
      summary: {
        totalFiles: 2,
        totalImages: 2,
        totalDesignDocuments: 0,
        roleCounts: {},
        folderRoleCounts: {},
        extensionCounts: {},
        colorNames: [],
        skuConfigCount: 0
      },
      skillReadiness: [],
      warnings: [],
      limitations: []
    },
    visualSamplingPlan: {
      planVersion: 'project-visual-sampling/v0',
      mode: 'bounded-metadata-plan',
      scenario: options.scenario || 'main-image',
      maxCandidates: 2,
      selectedCandidates: [
        {
          assetId: 'asset-1',
          path: 'D:/demo-project/source/asset-1.jpg',
          role: 'raw-product-still',
          priority: 80,
          score: 120,
          reason: 'fixture',
          cacheKey: 'project-visual:asset-1',
          cacheStatus: options.cacheHit ? 'hit' : 'miss',
          shouldAnalyze: !options.cacheHit,
          requiredEvidence: ['visual evidence'],
          cachedInsight: options.cacheHit ? {
            assetId: 'asset-1',
            path: 'D:/demo-project/source/asset-1.jpg',
            summary: '真实视觉摘要 fixture',
            productType: '袜子',
            evidence: []
          } : undefined,
          evidence: []
        }
      ],
      skippedCandidateCount: 1,
      cacheSummary: options.cacheHit
        ? { hit: 1, miss: 0, stale: 0, shouldAnalyze: 0 }
        : { hit: 0, miss: 1, stale: 0, shouldAnalyze: 1 },
      warnings: [],
      limitations: []
    },
    visualInsightCache: {
      cacheVersion: 'project-visual-insight-cache/v0',
      source: options.cacheHit ? 'persisted-project-cache' : 'missing',
      exists: Boolean(options.cacheHit),
      entries: options.cacheHit ? [{
        cacheKey: 'project-visual:asset-1',
        assetId: 'asset-1',
        path: 'D:/demo-project/source/asset-1.jpg',
        insight: {
          assetId: 'asset-1',
          path: 'D:/demo-project/source/asset-1.jpg',
          summary: '真实视觉摘要 fixture',
          productType: '袜子'
        }
      }] : [],
      summary: options.cacheHit
        ? { totalEntries: 1, entriesWithInsight: 1, entriesWithRawPayloadRemoved: 0 }
        : { totalEntries: 0, entriesWithInsight: 0, entriesWithRawPayloadRemoved: 0 },
      warnings: [],
      limitations: [],
      evidence: []
    }
  };
}

function verifyFeedback(label, feedback) {
  assert(feedback.feedbackVersion === 'business-skill-visual-evidence-feedback/v0', `${label} should use feedback contract`);
  assert(typeof feedback.title === 'string' && feedback.title.length > 0, `${label} should expose title`);
  assert(typeof feedback.summary === 'string' && feedback.summary.length > 0, `${label} should expose summary`);
  assert(typeof feedback.actionHint === 'string' && feedback.actionHint.length > 0, `${label} should expose action hint`);
  assert(Array.isArray(feedback.recommendedActions), `${label} should expose recommended actions`);
  assert(feedback.preflightStrategy && typeof feedback.preflightStrategy.canProceed === 'boolean', `${label} should expose preflight strategy`);
  assertNoMojibake(feedback, label);
  assertNoRawPayload(feedback, label);
  assertNoPseudoThinking(feedback, label);
}

function run() {
  const readyGate = buildBusinessSkillVisualEvidenceGate({
    scenario: 'main-image',
    projectPath: 'D:/demo-project',
    assetIndex: buildProjectContext({ cacheHit: true }).assetIndex,
    visualSamplingPlan: buildProjectContext({ cacheHit: true }).visualSamplingPlan,
    visualInsightCache: buildProjectContext({ cacheHit: true }).visualInsightCache
  });
  const readyFeedback = buildBusinessSkillVisualEvidenceFeedback(readyGate);
  verifyFeedback('readyFeedback', readyFeedback);
  assert(readyFeedback.userVisible === false, 'ready feedback should stay hidden from user-facing warning areas');
  assert(readyFeedback.severity === 'info', 'ready feedback should be informational');
  assert(readyFeedback.preflightStrategy.canProceed === true, 'ready feedback should allow existing execution');

  const missingGate = buildBusinessSkillVisualEvidenceGate({
    scenario: 'detail-page',
    enforcement: 'evidence-only',
    requiresVisualEvidence: true
  });
  const missingFeedback = buildBusinessSkillVisualEvidenceFeedback(missingGate);
  verifyFeedback('missingFeedback', missingFeedback);
  assert(missingFeedback.userVisible === true, 'missing context should be user visible');
  assert(missingFeedback.severity === 'warning', 'evidence-only missing context should be warning, not hard block');
  assert(missingFeedback.preflightStrategy.canProceed === true, 'evidence-only missing context must not alter execution');
  assert(missingFeedback.preflightStrategy.shouldRefreshProjectContext === true, 'missing context should request project context refresh');
  assert(missingFeedback.recommendedActions.includes('ask_user_to_select_images'), 'missing context should offer user image selection');

  const strictGate = buildBusinessSkillVisualEvidenceGate({
    scenario: 'main-image',
    enforcement: 'strict',
    requiresVisualEvidence: true
  });
  const strictFeedback = buildBusinessSkillVisualEvidenceFeedback(strictGate);
  verifyFeedback('strictFeedback', strictFeedback);
  assert(strictFeedback.severity === 'blocked', 'strict missing context should be blocked');
  assert(strictFeedback.preflightStrategy.canProceed === false, 'strict missing context should not proceed');

  const cacheMissGate = buildBusinessVisualEvidenceGateForSkill('sku-batch', {
    params: { sizes: [2, 3] },
    context: {
      userInput: '帮我做 SKU',
      conversationHistory: [],
      isPluginConnected: true,
      projectContext: buildProjectContext({ scenario: 'sku', cacheHit: false })
    }
  });
  assert(cacheMissGate?.status === 'needs_visual_insight', 'cache miss should need visual insight');
  const cacheMissFeedback = buildBusinessSkillVisualEvidenceFeedback(cacheMissGate);
  verifyFeedback('cacheMissFeedback', cacheMissFeedback);
  assert(cacheMissFeedback.preflightStrategy.shouldOfferVisualAnalysis === true, 'cache miss should offer visual analysis');
  assert(cacheMissFeedback.recommendedActions.includes('avoid_semantic_claims'), 'cache miss should avoid unsupported semantic claims');

  const params = { prompt: '帮我做主图', nested: { keep: true } };
  const beforeParams = JSON.stringify(params);
  const result = attachBusinessVisualEvidenceGateToResult(
    { success: true, message: 'ok', data: { existing: true } },
    cacheMissGate
  );
  assert(JSON.stringify(params) === beforeParams, 'feedback attachment must not mutate params');
  assert(result.data.existing === true, 'feedback attachment should preserve existing result data');
  assert(result.data.businessVisualEvidenceGate.status === 'needs_visual_insight', 'result should keep gate evidence');
  assert(result.data.businessVisualEvidenceFeedback.preflightStrategy.shouldOfferVisualAnalysis === true, 'result should expose feedback strategy');
  verifyFeedback('resultFeedback', result.data.businessVisualEvidenceFeedback);

  const noGateResult = attachBusinessVisualEvidenceGateToResult({ success: true, message: 'ok' }, undefined);
  assert(!noGateResult.data, 'non-business skill result should not receive feedback data');

  const wrapperSource = read('src/renderer/services/skill-executors/business-skill-visual-evidence-gate.ts');
  assert(wrapperSource.includes('businessVisualEvidenceFeedback'), 'wrapper should attach businessVisualEvidenceFeedback');
  assert(!wrapperSource.includes('analyzeAssetContent'), 'feedback wrapper must not call visual analyzer');
  assert(!wrapperSource.includes('writeProjectVisualInsightCache'), 'feedback wrapper must not write visual cache');
  assert(!wrapperSource.includes('executeToolCall'), 'feedback wrapper must not call Photoshop tools');
  assertNoPseudoThinking(wrapperSource, 'wrapperSource');

  const parsedMessage = convertLegacyMessage({
    id: 'message-business-visual-feedback',
    role: 'assistant',
    content: '需要补充图片证据后再判断。',
    timestamp: Date.now(),
    businessVisualEvidenceFeedback: result.data.businessVisualEvidenceFeedback
  });
  const feedbackCards = parsedMessage.blocks.filter((block) => (
    block.type === 'card'
    && String(block.title || '').includes('业务预检')
  ));
  const thinkingBlocks = parsedMessage.blocks.filter((block) => block.type === 'thinking');
  assert(feedbackCards.length === 1, 'message parser should render feedback as one business preflight card');
  assert(thinkingBlocks.length === 0, 'message parser must not render feedback as thinking block');
  assertNoPseudoThinking(parsedMessage, 'parsedMessage');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'business visual evidence feedback is derived from gate evidence only',
      'feedback exposes user-visible warning and preflight strategy without pretending to be model thinking',
      'evidence-only feedback does not change execution or mutate params',
      'strict feedback can express blocked state only when strict gate already blocks',
      'non-business skills do not receive feedback',
      'feedback wrapper does not call visual analyzer, cache writer or Photoshop tools',
      'message parser renders feedback as a card rather than a thinking block'
    ]
  }, null, 2));
}

run();
