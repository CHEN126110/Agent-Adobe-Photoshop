const fs = require('fs');
const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const {
  getSkillById
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'skills', 'skill-declarations.ts'));
const toolExecutor = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'tool-executor.service.ts'));
const {
  mainImageTemplateAuthoringExecutor
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'main-image-template-authoring.executor.ts'));
const {
  detailPageTemplateAuthoringExecutor
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'detail-page-template-authoring.executor.ts'));

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

function includesTitlePrefix(titles, prefix) {
  return titles.some((title) => title.startsWith(prefix));
}

function createPhotoshopMock(calls, options = {}) {
  let nextLayerId = 1000;
  return async (toolName, params) => {
    calls.push({ toolName, params });
    if (options.failCreateDocument && toolName === 'createDocument') {
      return { success: false, error: 'CREATE_DOCUMENT_FAILED' };
    }
    if (toolName === 'createDocument') {
      return {
        success: true,
        documentId: 101,
        name: params.name || '模板.psd',
        width: params.width,
        height: params.height,
        resolution: params.resolution
      };
    }
    if (toolName === 'createRectangle' || toolName === 'createEllipse' || toolName === 'createTextLayer') {
      nextLayerId += 1;
      return { success: true, layerId: nextLayerId, name: params.name };
    }
    if (toolName === 'createGroup') {
      nextLayerId += 1;
      return { success: true, layerId: nextLayerId, groupName: params.groupName };
    }
    if (toolName === 'getDocumentInfo') {
      return { success: true, id: 101, name: '模板.psd', width: 800, height: 800, resolution: 72 };
    }
    return { success: false, error: `unexpected tool ${toolName}` };
  };
}

async function runMainImageTemplateCase() {
  const skill = getSkillById('main-image-template-authoring');
  record(
    'main-image-template-authoring-skill-declaration',
    !!skill
      && skill.visibility === 'user-facing'
      && Array.isArray(skill.requiredTools)
      && skill.requiredTools.includes('createDocument')
      && skill.requiredTools.includes('createTextLayer'),
    skill
  );

  const steps = [];
  const calls = [];
  await withMockedToolExecutor(createPhotoshopMock(calls), async () => {
    const result = await mainImageTemplateAuthoringExecutor.execute({
      params: { userIntent: '帮我创建主图文档 并且建立主图模板', size: '800', imageType: 'click', density: 'simple' },
      callbacks: { onStep: (step) => steps.push(step) },
      context: { userInput: '帮我创建主图文档 并且建立主图模板' }
    });
    const titles = stepTitles(steps);
    record(
      'main-image-template-authoring-observable-success',
      result.success === true
        && calls.some((call) => call.toolName === 'createDocument')
        && calls.some((call) => call.toolName === 'createRectangle' || call.toolName === 'createEllipse')
        && calls.some((call) => call.toolName === 'createTextLayer')
        && calls.some((call) => call.toolName === 'createGroup')
        && calls.some((call) => call.toolName === 'getDocumentInfo')
        && titles.includes('主图模板蓝图已生成')
        && titles.includes('调用 Photoshop 工具：createDocument')
        && titles.includes('Photoshop 工具完成：createDocument')
        && includesTitlePrefix(titles, '创建主图模板形状 ')
        && includesTitlePrefix(titles, '创建主图文案占位 ')
        && titles.includes('主图模板创建结果已汇总'),
      { result, titles, calls }
    );
  });
}

async function runDetailPageTemplateCase() {
  const skill = getSkillById('detail-page-template-authoring');
  record(
    'detail-page-template-authoring-skill-declaration',
    !!skill
      && skill.visibility === 'user-facing'
      && Array.isArray(skill.requiredTools)
      && skill.requiredTools.includes('createDocument')
      && skill.requiredTools.includes('createGroup'),
    skill
  );

  const steps = [];
  const calls = [];
  await withMockedToolExecutor(createPhotoshopMock(calls), async () => {
    const result = await detailPageTemplateAuthoringExecutor.execute({
      params: { userIntent: '帮我新建一个详情页文档然后帮我制作一个详情页模板吧', screenCount: 2, width: 750, density: 'simple' },
      callbacks: { onStep: (step) => steps.push(step) },
      context: { userInput: '帮我新建一个详情页文档然后帮我制作一个详情页模板吧' }
    });
    const titles = stepTitles(steps);
    record(
      'detail-page-template-authoring-observable-success',
      result.success === true
        && calls.some((call) => call.toolName === 'createDocument')
        && calls.some((call) => call.toolName === 'createRectangle')
        && calls.some((call) => call.toolName === 'createTextLayer')
        && calls.some((call) => call.toolName === 'createGroup')
        && titles.includes('详情页模板蓝图已生成')
        && titles.includes('调用 Photoshop 工具：createDocument')
        && includesTitlePrefix(titles, '创建详情页屏结构 ')
        && includesTitlePrefix(titles, '详情页屏结构已创建 ')
        && titles.includes('详情页模板创建结果已汇总'),
      { result, titles, calls }
    );
  });
}

async function runFailureCase() {
  const steps = [];
  const calls = [];
  await withMockedToolExecutor(createPhotoshopMock(calls, { failCreateDocument: true }), async () => {
    const result = await mainImageTemplateAuthoringExecutor.execute({
      params: { userIntent: '帮我创建主图模板', size: '800', imageType: 'click' },
      callbacks: { onStep: (step) => steps.push(step) },
      context: { userInput: '帮我创建主图模板' }
    });
    const titles = stepTitles(steps);
    record(
      'template-authoring-create-document-failure-observable',
      result.success === false
        && calls.length === 1
        && calls[0].toolName === 'createDocument'
        && titles.includes('调用 Photoshop 工具：createDocument')
        && titles.includes('Photoshop 工具失败：createDocument'),
      { result, titles, calls, steps }
    );
  });
}

async function main() {
  await runMainImageTemplateCase();
  await runDetailPageTemplateCase();
  await runFailureCase();
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
  const jsonPath = path.join(tmpDir, 'template-authoring-observability-smoke.json');
  const mdPath = path.join(tmpDir, 'template-authoring-observability-smoke.md');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(
    mdPath,
    [
      '# Template Authoring Observability Smoke',
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
