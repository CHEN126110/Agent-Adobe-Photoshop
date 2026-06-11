const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.json'),
  compilerOptions: {
    module: 'CommonJS',
    moduleResolution: 'node'
  }
});

const { Agent } = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-runtime', 'agent.ts'));
const {
  buildAgentToolExecutionPreflight,
  classifyAgentToolExecution
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-tool-execution-preflight.ts'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeReport(payload) {
  const outDir = path.join(__dirname, '..', 'tmp');
  ensureDir(outDir);
  const jsonPath = path.join(outDir, 'agent-tool-execution-preflight-smoke.json');
  const mdPath = path.join(outDir, 'agent-tool-execution-preflight-smoke.md');
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
  fs.writeFileSync(mdPath, [
    '# Agent Tool Execution Preflight Smoke',
    '',
    `- success: ${payload.success}`,
    '',
    ...payload.cases.flatMap((item) => [
      `## ${item.name}`,
      `- status: ${item.status}`,
      item.details ? `- details: ${item.details}` : '',
      ''
    ])
  ].join('\n'), 'utf8');
  return { json: jsonPath, md: mdPath };
}

async function runCase(name, fn) {
  try {
    const details = await fn();
    return { name, status: 'pass', details: JSON.stringify(details) };
  } catch (error) {
    return {
      name,
      status: 'fail',
      details: error && error.stack ? error.stack : String(error)
    };
  }
}

function createAgent({ callModel, executeTool, callbacks = {}, maxIterations = 4 }) {
  return new Agent(
    {
      systemPrompt: 'Test autonomous agent.',
      tools: [
        { name: 'getDocumentInfo', description: 'Read document info', inputSchema: { type: 'object', properties: {} } },
        { name: 'getLayerHierarchy', description: 'Read layer tree', inputSchema: { type: 'object', properties: {} } },
        { name: 'createTextLayer', description: 'Create text', inputSchema: { type: 'object', properties: {} } },
        { name: 'saveDocument', description: 'Save document', inputSchema: { type: 'object', properties: {} } },
        { name: 'generateImage', description: 'Generate image', inputSchema: { type: 'object', properties: {} } }
      ],
      modelId: 'test-model',
      maxIterations,
      requireInitialToolCall: false,
      callbacks
    },
    callModel,
    executeTool || (async (name, params) => ({ success: true, name, params }))
  );
}

async function main() {
  const cases = [];

  cases.push(await runCase('tool-classification-is-conservative', async () => {
    assert(classifyAgentToolExecution('getDocumentInfo') === 'read_only_evidence', 'getDocumentInfo should be read evidence');
    assert(classifyAgentToolExecution('createTextLayer') === 'photoshop_write', 'createTextLayer should be Photoshop write');
    assert(classifyAgentToolExecution('saveDocument') === 'save_export', 'saveDocument should be save/export');
    assert(classifyAgentToolExecution('exportGroup') === 'save_export', 'exportGroup should be save/export');
    assert(classifyAgentToolExecution('generateImage') === 'external_generation', 'generateImage should not be ordinary read-only');
    return {
      getDocumentInfo: classifyAgentToolExecution('getDocumentInfo'),
      createTextLayer: classifyAgentToolExecution('createTextLayer'),
      saveDocument: classifyAgentToolExecution('saveDocument'),
      generateImage: classifyAgentToolExecution('generateImage')
    };
  }));

  cases.push(await runCase('first-round-write-tool-without-evidence-is-blocked', async () => {
    let executeCalls = 0;
    const steps = [];
    const agent = createAgent({
      callbacks: {
        onStep: (step) => steps.push(step)
      },
      callModel: async () => ({
        content: '我会创建文字图层，并在完成后检查图层结果。',
        toolCalls: [{
          id: 'write-first',
          name: 'createTextLayer',
          arguments: { content: '自选备注', x: 100, y: 100 }
        }]
      }),
      executeTool: async () => {
        executeCalls += 1;
        return { success: true };
      }
    });

    const result = await agent.run('添加自选备注文字');
    assert(executeCalls === 0, `write tool must not execute, got ${executeCalls}`);
    assert(result.stopReason === 'tool_preflight_blocked', `expected tool_preflight_blocked, got ${result.stopReason}`);
    assert(result.message.includes('已阻止工具执行：createTextLayer'), `blocked message should name tool: ${result.message}`);
    assert(result.message.includes('缺少 Photoshop 文档或画面读取证据'), `blocked message should name missing evidence: ${result.message}`);
    assert(steps.some((step) => step.issue === 'agent_tool_execution_preflight_blocked'), `missing blocked step: ${JSON.stringify(steps)}`);
    return {
      stopReason: result.stopReason,
      executeCalls,
      message: result.message
    };
  }));

  cases.push(await runCase('read-only-tool-can-execute-before-write-gate', async () => {
    let executeCalls = 0;
    const agent = createAgent({
      callModel: async (_modelId, _messages, _tools) => {
        if (executeCalls === 0) {
          return {
            content: '',
            toolCalls: [{ id: 'inspect', name: 'getDocumentInfo', arguments: {} }]
          };
        }
        return { content: '已完成检查。', toolCalls: [] };
      },
      executeTool: async () => {
        executeCalls += 1;
        return { success: true, document: { name: 'test.psd' } };
      }
    });

    const result = await agent.run('只检查当前文档');
    assert(executeCalls === 1, `read-only tool should execute once, got ${executeCalls}`);
    assert(result.stopReason === 'final_response', `expected final_response, got ${result.stopReason}`);
    return {
      executeCalls,
      stopReason: result.stopReason
    };
  }));

  cases.push(await runCase('prior-evidence-without-public-plan-still-blocks-write', async () => {
    let modelCalls = 0;
    const executed = [];
    const agent = createAgent({
      callModel: async () => {
        modelCalls += 1;
        if (modelCalls === 1) {
          return { content: '', toolCalls: [{ id: 'inspect-first', name: 'getDocumentInfo', arguments: {} }] };
        }
        return { content: '', toolCalls: [{ id: 'write-after-evidence', name: 'createTextLayer', arguments: { content: '备注', x: 10, y: 10 } }] };
      },
      executeTool: async (name) => {
        executed.push(name);
        return { success: true, document: { name: 'test.psd' } };
      }
    });

    const result = await agent.run('读取后添加备注');
    assert(executed.join(',') === 'getDocumentInfo', `only read tool should execute, got ${executed.join(',')}`);
    assert(result.stopReason === 'tool_preflight_blocked', `expected tool_preflight_blocked, got ${result.stopReason}`);
    assert(result.message.includes('缺少给用户可见的执行计划'), `blocked message should require public plan: ${result.message}`);
    return {
      modelCalls,
      executed,
      stopReason: result.stopReason,
      message: result.message
    };
  }));

  cases.push(await runCase('same-batch-read-then-write-can-pass-after-evidence', async () => {
    let modelCalls = 0;
    const executed = [];
    const agent = createAgent({
      callModel: async () => {
        modelCalls += 1;
        if (modelCalls === 1) {
          return {
            content: '我会先读取文档信息，然后创建备注文字图层，完成后用工具验收图层结果。',
            toolCalls: [
              { id: 'batch-read', name: 'getDocumentInfo', arguments: {} },
              { id: 'batch-write', name: 'createTextLayer', arguments: { content: '自选备注', x: 120, y: 120 } }
            ]
          };
        }
        return { content: '已完成并复核。', toolCalls: [] };
      },
      executeTool: async (name) => {
        executed.push(name);
        if (name === 'createTextLayer') {
          return {
            success: true,
            layerId: 10,
            acceptance: {
              enabled: true,
              verified: true,
              assertionStatus: 'passed',
              noDocumentChangeRisk: false
            }
          };
        }
        return { success: true, document: { name: 'test.psd' } };
      }
    });

    const result = await agent.run('创建一个自选备注文字层');
    assert(executed.join(',') === 'getDocumentInfo,createTextLayer', `expected read then write, got ${executed.join(',')}`);
    assert(result.stopReason === 'final_response', `expected final_response, got ${result.stopReason}`);
    assert(result.toolCallLog.length === 2, `expected two executed tools, got ${result.toolCallLog.length}`);
    return {
      modelCalls,
      executed,
      stopReason: result.stopReason,
      executionStatus: result.executionSummary && result.executionSummary.status
    };
  }));

  cases.push(await runCase('save-export-requires-evidence-plan-and-verification', async () => {
    const preflight = buildAgentToolExecutionPreflight({
      assistantContent: '直接保存。',
      toolCalls: [{ name: 'saveDocument', arguments: { format: 'psd' } }],
      completedToolCalls: []
    });
    assert(preflight.status === 'blocked', `expected blocked, got ${preflight.status}`);
    assert(preflight.blockers.some((item) => item.includes('缺少 Photoshop 文档或画面读取证据')), `missing evidence blocker: ${JSON.stringify(preflight)}`);
    return {
      status: preflight.status,
      blockers: preflight.blockers
    };
  }));

  cases.push(await runCase('generate-image-is-not-ordinary-readonly-but-does-not-trigger-photoshop-write-gate', async () => {
    const preflight = buildAgentToolExecutionPreflight({
      assistantContent: '',
      toolCalls: [{ name: 'generateImage', arguments: { prompt: 'product background' } }],
      completedToolCalls: []
    });
    assert(preflight.status === 'ready', `expected ready, got ${preflight.status}`);
    assert(preflight.tools[0].kind === 'external_generation', `expected external_generation, got ${preflight.tools[0].kind}`);
    assert(preflight.warnings.some((item) => item.includes('不是普通只读证据工具')), `expected warning, got ${JSON.stringify(preflight.warnings)}`);
    return {
      status: preflight.status,
      kind: preflight.tools[0].kind,
      warnings: preflight.warnings
    };
  }));

  const payload = { success: cases.every((item) => item.status === 'pass'), cases };
  const serialized = JSON.stringify(payload);
  const forbiddenDecisionScoreWords = [String.fromCharCode(99, 111, 110, 102, 105, 100, 101, 110, 99, 101), String.fromCharCode(32622, 20449)];
  assert(!forbiddenDecisionScoreWords.some((word) => serialized.includes(word)), `preflight output must not expose decision score wording: ${serialized}`);
  assert(!serialized.includes(String.fromCodePoint(0xfffd)), 'report should not contain replacement characters');
  const report = writeReport(payload);
  console.log(JSON.stringify({ ...payload, report }, null, 2));
  process.exit(payload.success ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
