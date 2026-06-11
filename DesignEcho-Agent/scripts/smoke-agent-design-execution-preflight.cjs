#!/usr/bin/env node

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
  buildAgentDesignExecutionPreflight,
  shouldApplyAgentDesignExecutionPreflight
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-design-execution-preflight.ts'));
const {
  DesignAgentEngine
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'design-agent', 'engine.ts'));
const skillExecutors = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'index.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function assertNoMojibake(value, label) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const suspiciousTokens = [
    0x93B4,
    0x93C9,
    0x951B,
    0x95C8,
    0xFFFD
  ].map((codePoint) => String.fromCodePoint(codePoint));
  const found = suspiciousTokens.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} contains mojibake tokens: ${found.join(', ')}`);
}

function designDecision() {
  return {
    source: 'model-agent',
    designGoal: '为纯白短袜建立干净、清爽、可转化的电商主图设计。',
    productUnderstanding: [
      '商品是纯白短袜，核心是柔软、洁净和基础百搭。',
      '设计必须保持商品真实白色和面料纹理。'
    ],
    audience: '淘宝天猫袜子消费者',
    hierarchy: {
      primarySubject: '纯白短袜主体',
      focalPoint: '袜身纹理和袜口弹性',
      informationPriority: ['商品主体', '核心卖点', '规格说明'],
      whitespaceIntent: '保留标题和卖点文字的安全留白。',
      layoutNotes: ['主体优先，不让装饰抢层级。']
    },
    color: {
      paletteIntent: '白色商品配浅灰背景和少量蓝色强调。',
      primaryColors: ['#FFFFFF', '#F3F5F8'],
      accentColors: ['#2F6FED'],
      backgroundDirection: '浅灰白背景，避免偏黄。',
      contrastPlan: '深灰文字保证白底可读。',
      avoid: ['大面积荧光色', '暖黄偏色']
    },
    typography: {
      tone: '清爽、稳定、偏转化',
      hierarchy: ['主标题', '卖点短句', '规格补充'],
      fontDirection: '无衬线黑体，字重区分层级。',
      spacingDirection: '紧凑但不遮挡主体。',
      avoid: ['过度字效', '过浅正文']
    },
    retouch: {
      objectives: ['清理背景', '校正白袜偏色', '增强面料纹理'],
      colorCorrection: '白色层次校正，不改变商品颜色。',
      lighting: '均匀自然，不制造塑料感。',
      cleanup: ['去除灰尘', '修边缘杂点'],
      fabricOrMaterialHandling: '保留棉袜纹理和柔软褶皱。',
      prohibitedEdits: ['改变商品颜色', '抹掉纹理']
    },
    assetSelection: {
      selectionPrinciples: ['优先主体完整、纹理清楚、无遮挡的项目摄影图。'],
      requiredEvidence: ['项目素材索引', '视觉理解结果'],
      rejectRules: ['拒绝主体裁断、过曝、低清素材。']
    },
    toolWorkflow: [
      { phase: 'inspect', goal: '读取项目和文档状态。', allowedToolKinds: ['read-only'], requiredEvidence: ['project-context'] },
      { phase: 'analyze', goal: '分析商品主体和可用素材。', allowedToolKinds: ['read-only'], requiredEvidence: ['visual-evidence'] },
      { phase: 'retouch', goal: '按修图目标清理和校色。', allowedToolKinds: ['retouch-plan'], requiredEvidence: ['retouch-brief'] },
      { phase: 'compose', goal: '按层级、配色和字体计划排版。', allowedToolKinds: ['photoshop-write'], requiredEvidence: ['design-plan'] },
      { phase: 'verify', goal: '读回结果并检查主体、文字和导出要求。', allowedToolKinds: ['readback'], requiredEvidence: ['screenshot-qa'] }
    ],
    acceptanceCriteria: [
      '白袜颜色真实且保留纹理。',
      '标题和卖点不遮挡主体。',
      '执行后必须有读回或截图证据。'
    ],
    risks: ['白色商品容易与背景粘连。'],
    rationale: ['先形成设计计划，再进入工具执行。']
  };
}

function makeContext(userInput, overrides = {}) {
  return {
    userInput,
    conversationHistory: [],
    isPluginConnected: true,
    photoshopContext: {
      hasDocument: true,
      documentName: '主图.psd',
      activeLayerName: '图层 1',
      layerCount: 12
    },
    projectContext: {
      projectPath: 'C:/UXP/2.0/test-project',
      projectImageCount: 6,
      sampleImagePaths: ['C:/UXP/2.0/test-project/素材/a.jpg'],
      visualInsightCache: { summary: { entriesWithInsight: 2 } }
    },
    ...overrides
  };
}

assert(shouldApplyAgentDesignExecutionPreflight('main-image-design') === true, 'main-image should be guarded');
assert(shouldApplyAgentDesignExecutionPreflight('detail-page-design') === true, 'detail-page should be guarded');
assert(shouldApplyAgentDesignExecutionPreflight('sku-batch') === true, 'SKU should be guarded');
assert(shouldApplyAgentDesignExecutionPreflight('layout-replication') === false, 'layout-replication keeps its reference-specific executor gate');
assert(shouldApplyAgentDesignExecutionPreflight('document-management') === false, 'document-management should not be guarded');

const nonBusiness = buildAgentDesignExecutionPreflight({
  userText: '帮我关闭文档',
  route: 'skill_execution',
  routeSource: 'model_router',
  skillId: 'document-management'
});
assert(nonBusiness.status === 'not_applicable' && nonBusiness.shouldExecute === true, 'non-business skill should pass', nonBusiness);

const inspectBypass = buildAgentDesignExecutionPreflight({
  userText: '先检查详情页结构',
  route: 'skill_execution',
  routeSource: 'model_router',
  skillId: 'detail-page-design',
  mode: 'inspect',
  params: { inspectOnly: true }
});
assert(inspectBypass.readOnlyBypass === true && inspectBypass.shouldExecute === true, 'inspect request should bypass write design gate', inspectBypass);

const missingDecision = buildAgentDesignExecutionPreflight({
  userText: '帮我做主图',
  route: 'skill_execution',
  routeSource: 'model_router',
  skillId: 'main-image-design',
  params: {},
  projectContext: { projectImageCount: 5 }
});
assert(missingDecision.status === 'needs_model_design_decision', 'business write should require model design decision', missingDecision);
assert(missingDecision.shouldExecute === false, 'missing decision must not execute', missingDecision);
assert(missingDecision.requiredBeforeExecution.includes('model-agent-design-decision'), 'missing decision should ask design decision', missingDecision);

const missingVisualEvidence = buildAgentDesignExecutionPreflight({
  userText: '帮我做主图',
  route: 'skill_execution',
  routeSource: 'model_router',
  skillId: 'main-image-design',
  params: { designIntelligenceDecision: designDecision() },
  projectContext: { projectImageCount: 0 }
});
assert(missingVisualEvidence.status === 'needs_visual_evidence', 'business write should require visual evidence', missingVisualEvidence);
assert(missingVisualEvidence.shouldExecute === false, 'missing visual evidence must not execute', missingVisualEvidence);

const skuProductionPlanner = buildAgentDesignExecutionPreflight({
  userText: '帮我做 SKU',
  route: 'skill_execution',
  routeSource: 'model_router',
  skillId: 'sku-batch',
  params: {},
  projectContext: { projectImageCount: 0 }
});
assert(skuProductionPlanner.status === 'ready_for_execution', 'SKU should use its controlled production planner instead of generic visual design gate', skuProductionPlanner);
assert(skuProductionPlanner.requiredBeforeExecution.includes('project-first-sku-source-resolution'), 'SKU planner should require project-first source resolution', skuProductionPlanner);
assert(skuProductionPlanner.requiredBeforeExecution.includes('sku-result-readback'), 'SKU planner should keep result readback requirement', skuProductionPlanner);

const ready = buildAgentDesignExecutionPreflight({
  userText: '帮我做主图',
  route: 'skill_execution',
  routeSource: 'model_router',
  skillId: 'main-image-design',
  params: { designIntelligenceDecision: designDecision() },
  projectContext: { projectImageCount: 5, visualInsightCache: { summary: { entriesWithInsight: 2 } } }
});
assert(ready.status === 'ready_for_execution', 'ready business write should pass', ready);
assert(ready.shouldExecute === true, 'ready business write should execute', ready);

const originalGetSkillExecutor = skillExecutors.getSkillExecutor;
const originalExecuteSkillWithExecutor = skillExecutors.executeSkillWithExecutor;

async function runEngineChecks() {
  const executed = [];
  skillExecutors.getSkillExecutor = () => ({ id: 'fake' });
  skillExecutors.executeSkillWithExecutor = async (skillId, input) => {
    executed.push({ skillId, params: input.params });
    return {
      success: true,
      message: `${skillId} done`,
      data: { receivedParams: input.params }
    };
  };

  const engine = new DesignAgentEngine();
  try {
    const blocked = await engine.run(makeContext('请基于项目素材生成主图'), {
      callModel: async (_messages, options = {}) => {
        if (options.purpose === 'visible_reasoning') return { text: '我会先理解主图目标，再判断是否具备执行证据。' };
        if (options.purpose === 'router') {
          return {
            text: JSON.stringify({
              route: 'skill_execution',
              skillId: 'main-image-design',
              intentSummary: '用户要生成主图。',
              skillParams: {
                mainImageExecutionMode: 'product-disposable-live',
                executionScope: 'disposable-document',
                approvedLiveExecution: true,
                approvedLiveAdapterRun: true
              }
            })
          };
        }
        if (options.purpose === 'design_execution_preflight') {
          return { text: JSON.stringify({ designGoal: '不完整设计决策' }) };
        }
        return { text: '{}' };
      }
    });
    assert(blocked.success === false, 'engine should block incomplete model design decision', blocked);
    assert(blocked.data?.agentDesignExecutionPreflight?.status === 'needs_model_design_decision', 'blocked result should expose preflight evidence', blocked.data);
    assert(executed.length === 0, 'blocked design preflight must not execute skill', executed);

    const passed = await engine.run(makeContext('请基于项目素材生成主图'), {
      callModel: async (_messages, options = {}) => {
        if (options.purpose === 'visible_reasoning') return { text: '我会先理解主图目标，再形成公开设计计划。' };
        if (options.purpose === 'router') {
          return {
            text: JSON.stringify({
              route: 'skill_execution',
              skillId: 'main-image-design',
              intentSummary: '用户要生成主图。',
              skillParams: {
                mainImageExecutionMode: 'product-disposable-live',
                executionScope: 'disposable-document',
                approvedLiveExecution: true,
                approvedLiveAdapterRun: true
              }
            })
          };
        }
        if (options.purpose === 'design_execution_preflight') {
          return { text: JSON.stringify(designDecision()) };
        }
        return { text: '{}' };
      }
    });
    assert(passed.success === true, 'engine should execute after complete design preflight', passed);
    assert(executed.length === 1, 'ready design preflight should execute once', executed);
    assert(executed[0].params.designIntelligenceDecision, 'engine should pass model design decision into skill params', executed[0]);
    assert(passed.data?.agentDesignExecutionPreflight?.status === 'ready_for_execution', 'passed result should expose ready preflight evidence', passed.data);

    const serialized = JSON.stringify({ blocked, passed, executed, ready });
    assert(!serialized.includes('"confidence"'), 'preflight output must not expose confidence fields');
    assert(!serialized.includes('置信'), 'preflight output must not expose confidence wording');
    assertNoMojibake(serialized, 'agent design execution preflight smoke output');

    return executed;
  } finally {
    skillExecutors.getSkillExecutor = originalGetSkillExecutor;
    skillExecutors.executeSkillWithExecutor = originalExecuteSkillWithExecutor;
  }
}

runEngineChecks().then((executed) => {
  console.log(JSON.stringify({
    success: true,
    executedCount: executed.length,
    checks: [
      'business design skills are guarded before execution',
      'non-business and inspect-only routes are not blocked',
      'missing model design decision blocks business writes',
      'missing visual evidence blocks business writes',
      'complete model design decision plus visual evidence allows execution',
      'engine requests design preflight before executing guarded business skill',
      'engine injects designIntelligenceDecision into skill params',
      'no confidence field or confidence wording is exposed',
      'mojibake guard passed'
    ]
  }, null, 2));
}).catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
