#!/usr/bin/env node

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const repoRoot = path.resolve(__dirname, '..');

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

function assertNoConfidence(value, label) {
  const serialized = JSON.stringify(value);
  assert(!serialized.includes('"confidence"') && !serialized.includes('置信'), `${label} must not expose confidence fields`, value);
}

function createLocalStorageMock() {
  const data = new Map();
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
    clear() {
      data.clear();
    }
  };
}

global.localStorage = createLocalStorageMock();

const {
  buildAgentResponseKnowledgeBundle,
  renderAgentResponseKnowledgePromptSection
} = require(path.join(repoRoot, 'src', 'shared', 'agent-response-knowledge.ts'));
const { getMemoryService } = require(path.join(repoRoot, 'src', 'renderer', 'services', 'memory.service.ts'));
const conversational = require(path.join(repoRoot, 'src', 'renderer', 'services', 'agent-orchestration', 'conversational.ts'));

function runSharedContractChecks() {
  const bundle = buildAgentResponseKnowledgeBundle({
    userText: '用户请求 raw-image-payload data:image/png;base64,abc',
    skillFacts: [
      { id: 'main-image-design', name: 'Main Image Design', visibility: 'user-facing', enabled: true },
      { id: 'sku-batch', name: 'SKU Batch', visibility: 'user-facing', enabled: true },
      { id: 'autonomous-agent', name: '自主智能体', visibility: 'system-only', enabled: true },
      { id: 'detail-page-design', name: 'Detail Page Design', visibility: 'user-facing', enabled: false }
    ],
    preferenceItems: [
      {
        id: 'explicit-font',
        category: 'font',
        value: '阿里巴巴普惠体',
        label: '标题字体偏好',
        sourceType: 'explicit',
        status: 'active',
        evidenceSummary: '用户明确设置标题优先使用阿里巴巴普惠体。'
      },
      {
        id: 'inferred-font',
        category: 'font',
        value: '思源黑体',
        label: '推断字体',
        sourceType: 'inferred',
        status: 'needs_review',
        evidenceSummary: '从历史操作推断，不能直接使用。'
      },
      {
        id: 'disabled-style',
        category: 'style',
        value: '复古',
        label: '已禁用风格',
        sourceType: 'explicit',
        status: 'disabled',
        evidenceSummary: '用户已禁用。'
      },
      {
        id: 'legacy-color',
        category: 'color',
        value: '奶白',
        label: '旧版颜色',
        sourceType: 'deprecated',
        status: 'active',
        evidenceSummary: '来自旧字段。'
      }
    ],
    knowledgeResults: [
      {
        id: 'local-memory:explicit-font',
        title: '标题字体偏好',
        intent: 'rule',
        sourceType: 'local_case',
        summary: '用户明确设置标题优先使用阿里巴巴普惠体。',
        evidence: ['来源：explicit_user_feedback'],
        tags: ['design-memory', 'user_preference', 'font', 'explicit_user_feedback'],
        allowedUses: ['prompt_context', 'user_reference'],
        evidenceLevel: 'local_case',
        sourceRank: 88
      },
      {
        id: 'local-memory:inferred-font',
        title: '推断字体',
        intent: 'rule',
        sourceType: 'local_case',
        summary: '从历史操作推断。',
        evidence: ['来源：inferred_from_operations'],
        tags: ['design-memory', 'user_preference', 'font', 'inferred_from_operations'],
        allowedUses: ['prompt_context'],
        evidenceLevel: 'local_case',
        sourceRank: 52
      },
      {
        id: 'local-memory:direct-action',
        title: '直接动作',
        intent: 'rule',
        sourceType: 'local_case',
        summary: '只能用于 Photoshop 写入动作。',
        evidence: ['direct action only'],
        tags: ['design-memory'],
        allowedUses: ['direct_photoshop_action'],
        evidenceLevel: 'local_case',
        sourceRank: 100
      }
    ],
    projectContext: {
      projectPath: 'C:/project/C-1160',
      projectImageCount: 12,
      selectedProjectImageName: 'white-socks.jpg'
    }
  });

  assert(bundle.version === 'agent-response-knowledge/v0', 'response knowledge bundle version mismatch', bundle);
  assert(bundle.guardrails.noPhotoshopExecution === true, 'response bundle must be read-only', bundle.guardrails);
  assert(bundle.guardrails.noToolSimulation === true, 'response bundle must prevent tool simulation', bundle.guardrails);
  assert(bundle.guardrails.noConfidence === true, 'response bundle must disallow confidence', bundle.guardrails);
  assert(bundle.capabilities.enabledUserFacingSkills.includes('Main Image Design'), 'enabled user-facing skill should be visible', bundle.capabilities);
  assert(bundle.capabilities.enabledUserFacingSkills.includes('SKU Batch'), 'second enabled user-facing skill should be visible', bundle.capabilities);
  assert(!bundle.capabilities.enabledUserFacingSkills.includes('自主智能体'), 'system-only skill must not enter user capability facts', bundle.capabilities);
  assert(!bundle.capabilities.enabledUserFacingSkills.includes('Detail Page Design'), 'disabled skill must not enter user capability facts', bundle.capabilities);
  assert(bundle.preferences.activeExplicitPreferences.some((item) => item.value === '阿里巴巴普惠体'), 'active explicit preference should be included', bundle.preferences);
  assert(bundle.preferences.activeExplicitPreferences.every((item) => item.value !== '思源黑体'), 'needs_review inferred preference must not become active response preference', bundle.preferences);
  assert(bundle.preferences.activeExplicitPreferences.every((item) => item.value !== '复古'), 'disabled preference must not become active response preference', bundle.preferences);
  assert(bundle.preferences.activeExplicitPreferences.every((item) => item.value !== '奶白'), 'deprecated preference must not become active response preference', bundle.preferences);
  assert(bundle.preferences.excludedPreferenceCount === 3, 'excluded preference count should reflect non-active-explicit items', bundle.preferences);
  assert(bundle.knowledge.contextItems.length === 1, 'only safe local prompt_context knowledge should be included', bundle.knowledge);
  assert(bundle.knowledge.contextItems[0].title === '标题字体偏好', 'safe explicit knowledge should be preserved', bundle.knowledge);
  assert(bundle.knowledge.excludedKnowledgeCount === 2, 'unsafe or unreviewed knowledge should be excluded', bundle.knowledge);
  assert(bundle.project.availableProjectImages === 12, 'project image count should be summarized', bundle.project);
  assertNoRawPayload(bundle, 'response knowledge bundle');
  assertNoConfidence(bundle, 'response knowledge bundle');

  const promptSection = renderAgentResponseKnowledgePromptSection(bundle);
  assert(promptSection.includes('Agent response knowledge bundle'), 'prompt section should have a stable heading', promptSection);
  assert(promptSection.includes('阿里巴巴普惠体'), 'prompt section should include active explicit preference', promptSection);
  assert(promptSection.includes('Main Image Design'), 'prompt section should include live skill facts', promptSection);
  assert(!promptSection.includes('思源黑体'), 'prompt section must not include unreviewed inferred preference', promptSection);
  assert(!promptSection.includes('复古'), 'prompt section must not include disabled preference', promptSection);
  assert(!promptSection.includes('奶白'), 'prompt section must not include deprecated preference', promptSection);
  assertNoRawPayload(promptSection, 'response knowledge prompt section');
  assertNoConfidence(promptSection, 'response knowledge prompt section');
}

async function runConversationalIntegrationChecks() {
  const memory = getMemoryService();
  memory.learnPreference('font', '思源黑体');
  memory.upsertExplicitPreference({
    category: 'font',
    value: '阿里巴巴普惠体',
    label: '标题字体偏好',
    evidenceSummary: '用户明确要求标题优先使用阿里巴巴普惠体。'
  });

  let capturedSystemPrompt = '';
  let capturedOptions = null;
  const reply = await conversational.tryConversationalModelReply(
    {
      userInput: '你会做什么？',
      conversationHistory: [],
      isPluginConnected: true,
      photoshopContext: { hasDocument: true, documentName: 'demo.psd', layerCount: 8 },
      projectContext: { projectPath: 'C:/project/C-1160', projectImageCount: 6 }
    },
    async (messages, options) => {
      capturedSystemPrompt = String(messages?.[0]?.content || '');
      capturedOptions = options;
      return { text: '我可以基于项目素材、设计知识和已确认偏好来规划主图、详情页和 SKU。' };
    }
  );

  assert(reply.includes('项目素材'), 'model reply should be returned as text', reply);
  assert(capturedOptions?.purpose === 'direct_response', 'conversational model call must stay direct_response', capturedOptions);
  assert(capturedSystemPrompt.includes('Agent response knowledge bundle'), 'conversation prompt should include response knowledge bundle', capturedSystemPrompt);
  assert(capturedSystemPrompt.includes('阿里巴巴普惠体'), 'conversation prompt should include active explicit preference', capturedSystemPrompt);
  assert(!capturedSystemPrompt.includes('思源黑体'), 'conversation prompt must not include unreviewed inferred preference', capturedSystemPrompt);
  assert(!capturedSystemPrompt.includes('"confidence"') && !capturedSystemPrompt.includes('置信'), 'conversation prompt must not ask for confidence', capturedSystemPrompt);
  assert(capturedSystemPrompt.includes('不要输出 JSON'), 'conversation prompt should still forbid JSON replies', capturedSystemPrompt);
}

async function run() {
  runSharedContractChecks();
  await runConversationalIntegrationChecks();
  console.log(JSON.stringify({
    success: true,
    checks: [
      'response knowledge bundle keeps persona, capability, project and preference facts structured',
      'active explicit preferences enter response context',
      'inferred, disabled and deprecated preferences are excluded from active response preferences',
      'unsafe knowledge cannot become response context',
      'conversational prompt receives the response knowledge bundle without Photoshop execution'
    ]
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
