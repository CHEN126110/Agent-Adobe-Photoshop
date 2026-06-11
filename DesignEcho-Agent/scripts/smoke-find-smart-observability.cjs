const fs = require('fs');
const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const {
  getSkillById
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'skills', 'skill-declarations.ts'));
const toolExecutor = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'tool-executor.service.ts'));
const {
  findEditElementExecutor
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'find-edit-element.executor.ts'));
const {
  smartLayoutExecutor
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'smart-layout.executor.ts'));
const {
  fastDeterministicRoute
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-orchestration', 'routing.ts'));

const cases = [];

function record(name, passed, details) {
  cases.push({ name, status: passed ? 'pass' : 'fail', details });
}

async function withMockedToolExecutor(mock, fn) {
  const original = toolExecutor.executeToolCall;
  toolExecutor.executeToolCall = mock;
  try {
    return await fn();
  } finally {
    toolExecutor.executeToolCall = original;
  }
}

function stepTitles(steps) {
  return steps.map((step) => String(step.title || ''));
}

async function runFindEditCases() {
  const skill = getSkillById('find-and-edit-element');
  record(
    'find-edit-skill-declaration',
    !!skill
      && skill.visibility === 'user-facing'
      && Array.isArray(skill.requiredTools)
      && skill.requiredTools.includes('getElementMapping')
      && skill.requiredTools.includes('selectLayer')
      && skill.routing
      && skill.routing.supportedModes.includes('setText'),
    skill
  );

  const textEditRoute = fastDeterministicRoute('把右上角价格文案改成 到手价 39');
  record(
    'find-edit-text-change-routes-deterministically',
    !!textEditRoute
      && textEditRoute.skillId === 'find-and-edit-element'
      && textEditRoute.skillParams.action === 'setText'
      && textEditRoute.skillParams.targetDescription === '右上角价格文案'
      && textEditRoute.skillParams.text === '到手价 39',
    textEditRoute
  );

  const layerOrderRoute = fastDeterministicRoute('把当前选中的图层置顶');
  record(
    'find-edit-does-not-steal-layer-stack-order',
    !!layerOrderRoute && layerOrderRoute.skillId === 'layer-management',
    layerOrderRoute
  );

  const steps = [];
  const calls = [];
  await withMockedToolExecutor(async (toolName, params) => {
    calls.push({ toolName, params });
    if (toolName === 'getDocumentInfo') return { success: true, name: '测试文档.psd' };
    if (toolName === 'getElementMapping') {
      return {
        success: true,
        elements: [
          { id: 7, name: '右上角价格文案', type: 'textLayer', visible: true, position: 'top-right', textContent: '原价 59' },
          { id: 8, name: '产品图', type: 'smartObject', visible: true, position: 'center' }
        ]
      };
    }
    if (toolName === 'selectLayer') return { success: true, layerId: params.layerId };
    if (toolName === 'setTextContent') return { success: true, updated: params.updates };
    return { success: false, error: `unexpected tool ${toolName}` };
  }, async () => {
    const result = await findEditElementExecutor.execute({
      params: { targetDescription: '右上角价格文案', action: 'setText', text: '到手价 39' },
      callbacks: { onStep: (step) => steps.push(step) },
      context: {}
    });
    const titles = stepTitles(steps);
    record(
      'find-edit-success-observable-steps',
      result.success === true
        && calls.some((call) => call.toolName === 'getDocumentInfo')
        && calls.some((call) => call.toolName === 'getElementMapping')
        && calls.some((call) => call.toolName === 'selectLayer')
        && calls.some((call) => call.toolName === 'setTextContent')
        && titles.includes('准备定位画布元素')
        && titles.includes('候选图层已排序')
        && titles.includes('调用 Photoshop 工具：getDocumentInfo')
        && titles.includes('调用 Photoshop 工具：getElementMapping')
        && titles.includes('调用 Photoshop 工具：setTextContent')
        && titles.includes('元素定位与操作完成'),
      { result, titles, calls }
    );
  });

  const missingSteps = [];
  const missing = await findEditElementExecutor.execute({
    params: {},
    callbacks: { onStep: (step) => missingSteps.push(step) },
    context: {}
  });
  record(
    'find-edit-missing-target-is-observable',
    missing.success === false
      && stepTitles(missingSteps).includes('缺少目标元素描述')
      && missingSteps.some((step) => step.status === 'error' && String(step.issue || '').includes('Missing target description')),
    { result: missing, titles: stepTitles(missingSteps), missingSteps }
  );
}

async function runSmartLayoutCases() {
  const skill = getSkillById('smart-layout');
  record(
    'smart-layout-skill-declaration',
    !!skill
      && skill.visibility === 'user-facing'
      && Array.isArray(skill.requiredTools)
      && skill.requiredTools.includes('smartLayout'),
    skill
  );

  const successSteps = [];
  await withMockedToolExecutor(async (toolName, params) => {
    if (toolName !== 'smartLayout') return { success: false, error: `unexpected tool ${toolName}` };
    return { success: true, message: '布局完成', params };
  }, async () => {
    const result = await smartLayoutExecutor.execute({
      params: { fillRatio: 0.85, alignment: 'center' },
      callbacks: { onStep: (step) => successSteps.push(step) },
      context: {}
    });
    const titles = stepTitles(successSteps);
    record(
      'smart-layout-success-observable-steps',
      result.success === true
        && titles.includes('准备智能布局参数')
        && titles.includes('调用 Photoshop 工具：smartLayout')
        && titles.includes('Photoshop 工具完成：smartLayout')
        && titles.includes('智能布局结果已返回'),
      { result, titles }
    );
  });

  const failedSteps = [];
  await withMockedToolExecutor(async () => ({ success: false, error: 'NO_LAYER_SELECTED' }), async () => {
    const result = await smartLayoutExecutor.execute({
      params: {},
      callbacks: { onStep: (step) => failedSteps.push(step) },
      context: {}
    });
    const titles = stepTitles(failedSteps);
    record(
      'smart-layout-failure-is-observable',
      result.success === false
        && titles.includes('智能布局未完成')
        && failedSteps.some((step) => step.status === 'error' && String(step.issue || '').includes('NO_LAYER_SELECTED')),
      { result, titles, failedSteps }
    );
  });
}

async function main() {
  await runFindEditCases();
  await runSmartLayoutCases();
}

main().catch((error) => {
  record('unexpected-exception', false, {
    message: error && error.message ? error.message : String(error),
    stack: error && error.stack ? error.stack : null
  });
}).finally(() => {
  const failed = cases.filter((item) => item.status !== 'pass');
  const report = {
    generatedAt: new Date().toISOString(),
    success: failed.length === 0,
    cases
  };

  const tmpDir = path.resolve(__dirname, '..', 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const jsonPath = path.join(tmpDir, 'find-smart-observability-smoke.json');
  const mdPath = path.join(tmpDir, 'find-smart-observability-smoke.md');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(
    mdPath,
    [
      '# Find/Edit And Smart Layout Observability Smoke',
      '',
      `success: ${report.success}`,
      '',
      ...cases.map((item) => `- ${item.name}: ${item.status}`)
    ].join('\n'),
    'utf8'
  );

  console.log(JSON.stringify({
    success: report.success,
    cases: cases.map(({ name, status }) => ({ name, status })),
    report: { json: jsonPath, md: mdPath }
  }, null, 2));

  process.exit(report.success ? 0 : 1);
});
