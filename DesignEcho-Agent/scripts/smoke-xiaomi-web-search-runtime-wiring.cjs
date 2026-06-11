#!/usr/bin/env node

process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS',
  moduleResolution: 'Node'
});
require('ts-node/register/transpile-only');

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

const { OpenAIAdapter } = require('../src/main/services/provider-adapters/openai-adapter.ts');
const {
  buildProviderNativeToolPlan
} = require('../src/shared/provider-native-tools.ts');

const plan = buildProviderNativeToolPlan({
  provider: 'xiaomi',
  modelId: 'mimo-v2.5-pro',
  requestedTools: [
    {
      type: 'web_search',
      enabled: true,
      forceSearch: true,
      maxKeyword: 4,
      limit: 6,
      userLocation: 'China'
    }
  ]
});

assert(plan.status === 'ready', 'test fixture should prepare Xiaomi native web_search', plan);

const xiaomiAdapter = new OpenAIAdapter('xiaomi');
const formatted = xiaomiAdapter.formatMessages(
  [{ role: 'user', content: '请搜索近期电商袜子详情页设计趋势。' }],
  [
    {
      name: 'getDocumentInfo',
      description: 'Read current Photoshop document.',
      inputSchema: { type: 'object', properties: {} }
    }
  ],
  {
    nativeTools: plan.nativeTools,
    maxTokens: 1024,
    temperature: 0.2
  }
);

assert(Array.isArray(formatted.tools), 'formatted request should include tools array', formatted);
assert(formatted.tools.some((tool) => tool.type === 'function'), 'function tools should be preserved', formatted.tools);
assert(formatted.tools.some((tool) => tool.type === 'web_search'), 'Xiaomi web_search should be injected as provider-native tool', formatted.tools);
assert(!formatted.tools.some((tool) => tool.type === 'function' && tool.function?.name === 'web_search'), 'web_search must not be converted into function tool', formatted.tools);
assert(
  formatted.tools.find((tool) => tool.type === 'web_search')?.force_search === true,
  'provider-native web_search options should be preserved',
  formatted.tools
);

const formattedWithoutNativeTools = xiaomiAdapter.formatMessages(
  [{ role: 'user', content: '只读文档。' }],
  [
    {
      name: 'getDocumentInfo',
      description: 'Read current Photoshop document.',
      inputSchema: { type: 'object', properties: {} }
    }
  ],
  { maxTokens: 1024 }
);

assert(
  !formattedWithoutNativeTools.tools.some((tool) => tool.type === 'web_search'),
  'web_search should not be injected unless options.nativeTools is present',
  formattedWithoutNativeTools.tools
);

const parsed = xiaomiAdapter.parseResponse({
  choices: [
    {
      finish_reason: 'stop',
      message: {
        content: '可以参考近期袜子详情页趋势。',
        annotations: [
          {
            type: 'url_citation',
            url_citation: {
              url: 'https://example.com/socks-design',
              title: 'Socks Design Reference'
            }
          }
        ]
      }
    }
  ],
  usage: {
    prompt_tokens: 10,
    completion_tokens: 20,
    web_search_usage: {
      request_count: 1
    }
  }
});

assert(parsed.citations?.length === 1, 'Xiaomi url_citation annotations should normalize into ProviderResponse.citations', parsed);
assert(parsed.citations[0].provider === 'xiaomi', 'citation provider should be Xiaomi', parsed.citations);
assert(parsed.nativeToolUsage?.length === 1, 'Xiaomi web_search_usage should normalize into ProviderResponse.nativeToolUsage', parsed);
assert(parsed.nativeToolUsage[0].toolType === 'web_search', 'native tool usage should identify web_search', parsed.nativeToolUsage);

const serviceSource = read('src/main/services/model-service.ts');
assert(serviceSource.includes('nativeTools: options?.nativeTools'), 'ModelService should forward options.nativeTools into adapter.formatMessages');

const streamTypes = read('src/shared/agent-tool-stream.ts');
assert(streamTypes.includes('nativeTools?: ProviderNativeToolRequest[]'), 'Agent stream request options should allow provider-native tools');

const autonomousExecutor = read('src/renderer/services/skill-executors/autonomous-agent.executor.ts');
assert(autonomousExecutor.includes('buildDesignKnowledgeRuntimeCapabilitySummary'), 'autonomous agent should build design knowledge runtime capability summary');
assert(autonomousExecutor.includes('designKnowledgeSettings'), 'autonomous agent should read design knowledge settings from store');
assert(autonomousExecutor.includes('nativeTools: providerNativeWebSearch.nativeTools'), 'autonomous agent should pass planned native tools to provider options');

console.log(JSON.stringify({
  success: true,
  checks: [
    'Xiaomi provider-native web_search can be merged with function tools without conversion',
    'web_search is absent unless nativeTools is explicitly provided',
    'Xiaomi url_citation annotations and web_search_usage normalize into ProviderResponse',
    'ModelService forwards nativeTools into both non-stream and stream adapter formatting',
    'Agent stream request options can carry provider-native tools',
    'autonomous agent derives nativeTools from explicit design knowledge settings'
  ]
}, null, 2));
