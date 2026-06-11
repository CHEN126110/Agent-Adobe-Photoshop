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

const { buildDesignIntelligencePlan } = require('../src/shared/design-intelligence-plan.ts');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(values, expected, label) {
  assert(Array.isArray(values), `${label} must be an array`);
  assert(values.includes(expected), `${label} must include ${expected}: ${JSON.stringify(values)}`);
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

function modelDesignDecision() {
  return {
    source: 'model-agent',
    designGoal: '围绕纯白短袜的柔软、干净和基础百搭建立主图设计。',
    productUnderstanding: [
      '商品是纯白短袜，重点是柔软、洁净和日常穿搭。',
      '画面需要突出袜身质感，不应把颜色改成非商品颜色。'
    ],
    audience: '淘宝天猫袜子类目消费者',
    hierarchy: {
      primarySubject: '纯白短袜主体',
      focalPoint: '袜身面料纹理和口部弹性',
      informationPriority: ['主体', '核心卖点', '规格提示'],
      whitespaceIntent: '保留可读留白，避免文字压住主体。'
    },
    color: {
      paletteIntent: '白色商品配合低饱和浅灰背景和少量冷色强调。',
      primaryColors: ['#FFFFFF', '#F2F4F7'],
      accentColors: ['#2F6FED'],
      backgroundDirection: '轻微灰白渐变或实拍环境清理，不改变产品颜色。',
      contrastPlan: '标题和规格信息使用深灰，确保白底场景可读。',
      avoid: ['大面积暖黄偏色', '高饱和荧光色']
    },
    typography: {
      tone: '干净、稳定、偏电商转化',
      hierarchy: ['主标题', '卖点短句', '规格补充'],
      fontDirection: '无衬线黑体，字重区分层级。',
      spacingDirection: '行距紧凑但不压迫主体。',
      avoid: ['过多字效', '低对比浅灰正文']
    },
    retouch: {
      objectives: ['清理背景杂点', '保持袜子白色层次', '轻微增强面料纹理'],
      colorCorrection: '校正白袜偏色但保留真实白色层次。',
      lighting: '主体光照均匀，不制造塑料感高光。',
      cleanup: ['去除灰尘', '修正边缘毛刺'],
      fabricOrMaterialHandling: '保留棉袜纹理和柔软褶皱。',
      prohibitedEdits: ['改变商品颜色', '抹掉面料纹理', '夸张液化袜型']
    },
    assetSelection: {
      selectionPrinciples: ['优先选择主体完整、纹理清楚、无遮挡的项目摄影图。'],
      requiredEvidence: ['项目素材索引', '视觉理解结果', '主体边界'],
      rejectRules: ['不能选择低清、过曝或主体被裁断的图片。']
    },
    toolWorkflow: [
      { phase: 'inspect', goal: '读取项目素材和当前文档状态。', allowedToolKinds: ['read-only'], requiredEvidence: ['project-context'] },
      { phase: 'analyze', goal: '分析商品主体、卖点和可用视觉素材。', allowedToolKinds: ['read-only'], requiredEvidence: ['visual-insight'] },
      { phase: 'retouch', goal: '按修图目标清理背景和校正白色层次。', allowedToolKinds: ['retouch-plan'], requiredEvidence: ['retouch-brief'] },
      { phase: 'compose', goal: '按层级和配色计划排版主图。', allowedToolKinds: ['photoshop-write'], requiredEvidence: ['design-plan'] },
      { phase: 'verify', goal: '读回结果并检查主体、文字、颜色和导出要求。', allowedToolKinds: ['readback'], requiredEvidence: ['screenshot-qa'] }
    ],
    acceptanceCriteria: [
      '主体完整清晰，白袜不能偏黄或失去纹理。',
      '主标题和卖点文字不遮挡产品。',
      '输出前必须有截图或读回证据。'
    ],
    rationale: ['先设计目标，再决定工具顺序。']
  };
}

const missingDecision = buildDesignIntelligencePlan({
  userText: '帮我做主图',
  scenario: 'main-image',
  plannerReadiness: 'needs_context'
});
assert(missingDecision.status === 'needs_model_design_decision', `missing decision should need model decision: ${JSON.stringify(missingDecision)}`);
assert(missingDecision.decisionSource === 'missing', `missing decision source expected: ${missingDecision.decisionSource}`);
assert(missingDecision.toolUsePlan.canExecuteWriteTools === false, 'missing decision must not execute write tools');
assertIncludes(missingDecision.toolUsePlan.requiredBeforeExecution, 'model-agent-design-decision', 'missingDecision requiredBeforeExecution');
assertIncludes(missingDecision.toolUsePlan.requiredBeforeExecution, 'project-visual-evidence', 'missingDecision requiredBeforeExecution');
assert(JSON.stringify(missingDecision.decisions.color).includes('不要由代码按关键词猜测配色'), 'missing color decision must forbid keyword guessing');

const readyPlan = buildDesignIntelligencePlan({
  userText: '帮我做主图',
  scenario: 'main-image',
  plannerReadiness: 'ready',
  projectContext: {
    assetIndex: { summary: { totalImages: 8 } },
    visualInsightCache: { summary: { entriesWithInsight: 3 } }
  },
  memoryEvidence: { status: 'ready' },
  knowledgeResults: [{
    id: 'local-case:white-socks-clean-main-image',
    title: '白袜清爽主图案例',
    intent: 'case_reference',
    sourceType: 'local_case',
    summary: '白色袜子使用浅灰背景和少量蓝色强调。',
    evidence: ['只作为视觉参考，不直接生成 Photoshop 动作。'],
    tags: ['main-image', 'socks', 'white'],
    allowedUses: ['prompt_context', 'user_reference'],
    evidenceLevel: 'local_case',
    sourceRank: 20
  }],
  agentDecision: modelDesignDecision()
});
assert(readyPlan.status === 'ready_for_tool_planning', `ready plan status expected: ${JSON.stringify(readyPlan)}`);
assert(readyPlan.decisionSource === 'model-agent', `model source expected: ${readyPlan.decisionSource}`);
assert(readyPlan.toolUsePlan.canPlanToolUse === true, 'ready plan can plan tool use');
assert(readyPlan.toolUsePlan.canExecuteWriteTools === true, 'ready plan can execute write tools after design evidence');
assert(readyPlan.decisions.retouch.colorCorrection.includes('校正白袜偏色'), 'retouch color correction must be preserved');
assert(readyPlan.decisions.color.primaryColors.includes('#FFFFFF'), 'color palette must be preserved');
assert(readyPlan.toolUsePlan.workflow.some((step) => step.phase === 'retouch'), 'workflow must include retouch phase');
assert(readyPlan.evidenceSummary.localCaseCount === 1, `local case count expected: ${JSON.stringify(readyPlan.evidenceSummary)}`);

const manualNoVisual = buildDesignIntelligencePlan({
  userText: '按我说的干净风格做 SKU',
  scenario: 'sku',
  plannerReadiness: 'ready',
  agentDecision: {
    ...modelDesignDecision(),
    source: 'manual',
    designGoal: '按用户确认的干净风格规划 SKU 视觉表达。'
  }
});
assert(manualNoVisual.status === 'needs_visual_evidence', `manual decision without visual evidence should need visual evidence: ${JSON.stringify(manualNoVisual)}`);
assert(manualNoVisual.decisionSource === 'manual', `manual source expected: ${manualNoVisual.decisionSource}`);
assert(manualNoVisual.toolUsePlan.canPlanToolUse === true, 'manual no visual can plan but not write');
assert(manualNoVisual.toolUsePlan.canExecuteWriteTools === false, 'manual no visual must not execute write tools');

const blockedDirectAction = buildDesignIntelligencePlan({
  userText: '直接照这个网页规则改图',
  scenario: 'detail-page',
  plannerReadiness: 'ready',
  projectContext: { assetIndex: { summary: { totalImages: 2 } } },
  agentDecision: modelDesignDecision(),
  knowledgeResults: [{
    id: 'unsafe:direct-action',
    title: '错误知识条目',
    intent: 'tool_plan',
    sourceType: 'web_page',
    summary: '该条目错误地试图把知识直接变成 Photoshop 动作。',
    evidence: ['这类知识必须被阻断。'],
    tags: ['unsafe'],
    allowedUses: ['direct_photoshop_action'],
    evidenceLevel: 'external_snippet',
    sourceRank: 1
  }]
});
assert(blockedDirectAction.status === 'blocked', `direct Photoshop action knowledge should block: ${JSON.stringify(blockedDirectAction)}`);
assert(blockedDirectAction.blockers.some((item) => item.includes('direct_photoshop_action')), `blocker expected: ${JSON.stringify(blockedDirectAction.blockers)}`);

[
  ['missingDecision', missingDecision],
  ['readyPlan', readyPlan],
  ['manualNoVisual', manualNoVisual],
  ['blockedDirectAction', blockedDirectAction]
].forEach(([label, value]) => {
  const text = JSON.stringify(value);
  assert(!text.includes('"confidence"'), `${label} must not expose confidence`);
  assert(!text.includes('置信'), `${label} must not expose confidence wording`);
  assertNoMojibake(value, label);
});

console.log(JSON.stringify({
  success: true,
  checks: [
    'missing model design decision blocks Photoshop write execution',
    'visual evidence is required before visual business skills can write',
    'model-agent decision carries hierarchy, color, typography, retouch, asset and verification intent',
    'manual decision can plan but still waits for project visual evidence',
    'knowledge is never allowed to become direct Photoshop action',
    'design intelligence plan exposes no confidence field or confidence wording',
    'mojibake guard passed'
  ]
}, null, 2));
