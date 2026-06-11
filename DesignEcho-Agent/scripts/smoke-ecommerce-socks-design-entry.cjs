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

const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const {
  getSkillById,
  getUserFacingSkills
} = require(path.join(ROOT, 'src', 'shared', 'skills', 'skill-declarations.ts'));
const {
  fastDeterministicRoute,
  inferSkillHint
} = require(path.join(ROOT, 'src', 'renderer', 'services', 'agent-orchestration', 'routing.ts'));
const {
  getSkillExecutor
} = require(path.join(ROOT, 'src', 'renderer', 'services', 'skill-executors', 'index.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function assertNoPseudoThinking(value, label) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const forbidden = ['正在思考', '等待响应', '请求已发送', '正在准备', '稍等'];
  const found = forbidden.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} contains pseudo-thinking copy: ${found.join(', ')}`);
}

async function run() {
  const skill = getSkillById('ecommerce-socks-design');
  assert(skill, 'ecommerce-socks-design skill should be declared');
  assert(skill.visibility === 'user-facing', 'parent skill should be user-facing', skill);
  assert(skill.kind === 'workflow', 'parent skill should be workflow kind', skill);
  assert(skill.category === 'ecommerce', 'parent skill should be ecommerce category', skill);
  assert(
    skill.routing?.intentSignals?.includes('电商袜子设计'),
    'parent skill should expose stable routing signal',
    skill.routing
  );
  assert(
    skill.parameters.some((item) => item.name === 'deliverables'),
    'parent skill should accept deliverables parameter',
    skill.parameters
  );
  assert(
    skill.requiredTools.length === 0,
    'parent skill should not directly own Photoshop tools in entry MVP',
    skill.requiredTools
  );

  const visibleSkillIds = new Set(getUserFacingSkills().map((item) => item.id));
  assert(visibleSkillIds.has('ecommerce-socks-design'), 'parent skill should be visible to router model');

  const combinedRoute = fastDeterministicRoute('帮我规划一套电商袜子设计，包含主图、详情页和SKU');
  assert(
    combinedRoute?.skillId === 'ecommerce-socks-design',
    'combined ecommerce socks request should route to parent skill',
    combinedRoute
  );
  assert(
    JSON.stringify(combinedRoute.skillParams?.deliverables) === JSON.stringify(['main-image', 'detail-page', 'sku']),
    'combined route should extract all three child deliverables',
    combinedRoute
  );

  const directSkuRoute = fastDeterministicRoute('帮我做3双装的SKU');
  assert(
    directSkuRoute?.skillId === 'sku-batch',
    'direct SKU request should keep existing child route before business-strategy checkpoint',
    directSkuRoute
  );
  assert(
    inferSkillHint('帮我做整套袜子电商设计') === 'ecommerce-socks-design',
    'combined design hint should point to parent skill'
  );

  const executor = getSkillExecutor('ecommerce-socks-design');
  assert(executor, 'ecommerce-socks-design executor should be registered');

  const steps = [];
  const result = await executor.execute({
    params: {
      userIntent: '帮我规划一套电商袜子设计，包含主图、详情页和SKU',
      deliverables: ['main-image', 'detail-page', 'sku']
    },
    callbacks: {
      onStep: (event) => steps.push(event),
      onMessage: () => undefined,
      onProgress: () => undefined
    },
    context: {
      userInput: '帮我规划一套电商袜子设计，包含主图、详情页和SKU',
      isPluginConnected: true,
      conversationHistory: [],
      projectContext: {
        projectPath: 'D:/demo/socks-project',
        projectImageCount: 12
      },
      photoshopContext: {
        hasDocument: true,
        documentName: 'SKU.psb'
      }
    }
  });

  assert(result.success === true, 'parent entry should return a successful plan-only result', result);
  assert(
    result.data?.ecommerceSocksDesign?.version === 'ecommerce-socks-design/v0',
    'result should expose stable parent evidence version',
    result.data
  );
  assert(
    result.data.ecommerceSocksDesign.executionMode === 'plan-only',
    'entry MVP should be plan-only by default',
    result.data.ecommerceSocksDesign
  );
  assert(
    result.data.ecommerceSocksDesign.canClaimDesignComplete === false,
    'parent evidence must not claim design completion',
    result.data.ecommerceSocksDesign
  );
  assert(
    result.data.ecommerceSocksDesign.mustNotChangeChildBusinessStrategy === true,
    'parent evidence must preserve child skill strategy',
    result.data.ecommerceSocksDesign
  );
  assert(
    JSON.stringify(result.data.ecommerceSocksDesign.childSkills.map((item) => item.skillId))
      === JSON.stringify(['main-image-design', 'detail-page-design', 'sku-batch']),
    'parent plan should map deliverables to current child skill ids',
    result.data.ecommerceSocksDesign.childSkills
  );
  assert(
    steps.some((item) => item.toolName === 'ecommerce-socks-design'),
    'parent executor should emit visible activity event',
    steps
  );
  assertNoPseudoThinking(result, 'ecommerce socks result');
  assertNoPseudoThinking(steps, 'ecommerce socks steps');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'parent skill declaration exists and is user-facing',
      'combined ecommerce socks request routes to parent skill',
      'direct SKU route remains child route before checkpoint',
      'parent executor returns plan-only child skill orchestration evidence',
      'parent evidence does not claim design completion or change child strategy'
    ]
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
