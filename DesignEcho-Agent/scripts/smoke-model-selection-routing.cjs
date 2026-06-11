#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
  detectConversationTaskType,
  getModelPriorityForConversationTask
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'model-selection.ts'));
const {
  DEFAULT_MODEL_PREFERENCES
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'config', 'models.config.ts'));

const repoRoot = path.resolve(__dirname, '..');
const sourceFiles = [
  path.join(repoRoot, 'src', 'shared', 'model-selection.ts'),
  path.join(repoRoot, 'src', 'renderer', 'hooks', 'useChatActions.ts')
];

const forbiddenFragments = [
  0x9352,
  0x93C2,
  0x7459,
  0x93B6,
  0x95AB,
  0x923F,
  0x93C8,
  0xFFFD
].map((codePoint) => String.fromCodePoint(codePoint));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function noMojibakeInModelSelectionSources() {
  for (const file of sourceFiles) {
    const content = fs.readFileSync(file, 'utf8');
    for (const fragment of forbiddenFragments) {
      assert(!content.includes(fragment), `${path.relative(repoRoot, file)} contains mojibake fragment: ${fragment}`);
    }
  }
}

function run() {
  const cases = [
    {
      input: '\u5e2e\u6211\u770b\u8fd9\u5f20\u53c2\u8003\u56fe\u5e76\u590d\u523b\u7248\u5f0f',
      hasImage: false,
      expected: 'visual'
    },
    {
      input: '\u5e2e\u6211\u751f\u6210\u4e09\u7248\u6807\u9898\u6587\u6848',
      hasImage: false,
      expected: 'copywriting'
    },
    {
      input: '\u5e2e\u6211\u628a\u8be6\u60c5\u9875\u6587\u6863\u4fdd\u5b58\u5230\u9879\u76ee\u7684PSD\u4e2d',
      hasImage: false,
      expected: 'logic'
    },
    {
      input: '\u4f60\u662f\u4ec0\u4e48\u6a21\u578b',
      hasImage: false,
      expected: 'general'
    },
    {
      input: '\u968f\u4fbf\u95ee\u5019\u4f46\u9644\u5e26\u56fe\u7247',
      hasImage: true,
      expected: 'visual'
    }
  ];

  for (const item of cases) {
    const actual = detectConversationTaskType(item.input, item.hasImage);
    assert(actual === item.expected, `${item.input} expected ${item.expected}, got ${actual}`);
  }

  const visualPriority = getModelPriorityForConversationTask(
    DEFAULT_MODEL_PREFERENCES,
    'visual',
    { requireVision: true }
  );
  assert(visualPriority.length > 0, 'visual model priority must not be empty');
  assert(!visualPriority.includes('deepseek-v4-pro'), 'text-only DeepSeek must not be routed as visual model');

  noMojibakeInModelSelectionSources();

  const report = {
    success: true,
    cases: cases.map((item) => ({
      expected: item.expected,
      actual: detectConversationTaskType(item.input, item.hasImage)
    })),
    visualPriority
  };
  const outPath = path.join(repoRoot, 'tmp', 'model-selection-routing-smoke.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`[smoke-model-selection-routing] ok -> ${outPath}`);
}

run();
