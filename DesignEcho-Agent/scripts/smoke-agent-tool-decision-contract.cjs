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

const {
  buildAgentToolDecisionContract,
  formatAgentToolDecisionContractBlocker
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-tool-decision-contract.ts'));
const {
  buildAgentIntentControlPlaneDecision
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-intent-control-plane.ts'));
const {
  Agent
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-runtime', 'agent.ts'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeReport(payload) {
  const outDir = path.join(__dirname, '..', 'tmp');
  ensureDir(outDir);
  const jsonPath = path.join(outDir, 'agent-tool-decision-contract-smoke.json');
  const mdPath = path.join(outDir, 'agent-tool-decision-contract-smoke.md');
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
  fs.writeFileSync(mdPath, [
    '# Agent Tool Decision Contract Smoke',
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

function decisionFor(userInput) {
  return buildAgentIntentControlPlaneDecision({ userInput });
}

function baseRuntime(overrides = {}) {
  return {
    availableTools: ['getDocumentInfo', 'getLayerHierarchy', 'createTextLayer', 'saveDocument', 'generateImage'],
    photoshopConnected: true,
    hasDocument: true,
    ...overrides
  };
}

async function main() {
  const cases = [];

  cases.push(await runCase('chat-only-intent-blocks-tool-candidates', async () => {
    const contract = buildAgentToolDecisionContract({
      userInput: '你可以做什么？',
      intentControlPlane: decisionFor('你可以做什么？'),
      assistantContent: '我会查看当前文档。',
      toolCalls: [{ name: 'getDocumentInfo', arguments: {} }],
      runtime: baseRuntime()
    });
    assert(contract.status === 'blocked', `expected blocked, got ${contract.status}`);
    assert(contract.nextAction === 'model_replan_without_tools', `expected model_replan_without_tools, got ${contract.nextAction}`);
    assert(contract.blockers.some((item) => item.code === 'intent_scope_disallows_tools'), `missing scope blocker: ${JSON.stringify(contract)}`);
    assert(formatAgentToolDecisionContractBlocker(contract).includes('当前意图不允许调用工具'), 'formatted blocker should explain intent scope');
    return contract;
  }));

  cases.push(await runCase('read-only-intent-blocks-write-tool', async () => {
    const contract = buildAgentToolDecisionContract({
      userInput: '帮我看看当前文档有多少个图层',
      intentControlPlane: decisionFor('帮我看看当前文档有多少个图层'),
      assistantContent: '我会先查看图层，然后创建文字并检查结果。',
      toolCalls: [{ name: 'createTextLayer', arguments: { content: '备注', x: 10, y: 10 } }],
      runtime: baseRuntime()
    });
    assert(contract.status === 'blocked', `expected blocked, got ${contract.status}`);
    assert(contract.blockers.some((item) => item.code === 'tool_scope_exceeds_intent'), `missing scope blocker: ${JSON.stringify(contract)}`);
    return contract;
  }));

  cases.push(await runCase('unknown-tool-is-blocked-before-runtime-execution', async () => {
    const contract = buildAgentToolDecisionContract({
      userInput: '帮我生成SKU',
      intentControlPlane: decisionFor('帮我生成SKU'),
      assistantContent: '我会先读取项目，再执行 SKU。',
      toolCalls: [{ name: 'nonExistingTool', arguments: {} }],
      runtime: baseRuntime()
    });
    assert(contract.status === 'blocked', `expected blocked, got ${contract.status}`);
    assert(contract.blockers.some((item) => item.code === 'tool_unavailable'), `missing unavailable blocker: ${JSON.stringify(contract)}`);
    return contract;
  }));

  cases.push(await runCase('photoshop-write-blocks-when-photoshop-disconnected', async () => {
    const contract = buildAgentToolDecisionContract({
      userInput: '帮我把文字改成新品上市',
      intentControlPlane: decisionFor('帮我把文字改成新品上市'),
      assistantContent: '我会修改文字并回读结果。',
      toolCalls: [{ name: 'createTextLayer', arguments: { content: '新品上市' } }],
      runtime: baseRuntime({ photoshopConnected: false, hasDocument: false })
    });
    assert(contract.status === 'blocked', `expected blocked, got ${contract.status}`);
    assert(contract.blockers.some((item) => item.code === 'photoshop_not_connected'), `missing photoshop blocker: ${JSON.stringify(contract)}`);
    return contract;
  }));

  cases.push(await runCase('write-tool-requires-public-plan-and-verification-target', async () => {
    const contract = buildAgentToolDecisionContract({
      userInput: '帮我加一个备注文字',
      intentControlPlane: decisionFor('帮我加一个备注文字'),
      assistantContent: '',
      toolCalls: [{ name: 'createTextLayer', arguments: { content: '备注' } }],
      runtime: baseRuntime(),
      completedToolCalls: [{ name: 'getDocumentInfo', result: { success: true } }]
    });
    assert(contract.status === 'blocked', `expected blocked, got ${contract.status}`);
    assert(contract.blockers.some((item) => item.code === 'missing_public_plan'), `missing public plan blocker: ${JSON.stringify(contract)}`);
    assert(contract.blockers.some((item) => item.code === 'missing_verification_target'), `missing verification blocker: ${JSON.stringify(contract)}`);
    return contract;
  }));

  cases.push(await runCase('read-then-write-with-plan-and-evidence-is-ready', async () => {
    const contract = buildAgentToolDecisionContract({
      userInput: '帮我加一个备注文字',
      intentControlPlane: decisionFor('帮我加一个备注文字'),
      assistantContent: '我会先读取当前文档，再创建备注文字，完成后回读图层结果并截图复核。',
      toolCalls: [
        { name: 'getDocumentInfo', arguments: {} },
        { name: 'createTextLayer', arguments: { content: '备注' } }
      ],
      runtime: baseRuntime()
    });
    assert(contract.status === 'ready', `expected ready, got ${contract.status}: ${JSON.stringify(contract.blockers)}`);
    assert(contract.allowedToolCalls.length === 2, `expected two allowed calls, got ${contract.allowedToolCalls.length}`);
    assert(contract.nextAction === 'execute_tools', `expected execute_tools, got ${contract.nextAction}`);
    return contract;
  }));

  cases.push(await runCase('write-before-read-does-not-count-as-evidence', async () => {
    const contract = buildAgentToolDecisionContract({
      userInput: '帮我加一个备注文字',
      intentControlPlane: decisionFor('帮我加一个备注文字'),
      assistantContent: '我会创建备注文字，然后读取当前文档并截图复核。',
      toolCalls: [
        { name: 'createTextLayer', arguments: { content: '备注' } },
        { name: 'getDocumentInfo', arguments: {} }
      ],
      runtime: baseRuntime()
    });
    assert(contract.status === 'blocked', `expected blocked, got ${contract.status}`);
    assert(contract.blockers.some((item) => item.code === 'missing_prior_document_evidence'), `missing prior evidence blocker: ${JSON.stringify(contract)}`);
    return contract;
  }));

  cases.push(await runCase('external-generation-is-separated-from-photoshop-write', async () => {
    const contract = buildAgentToolDecisionContract({
      userInput: '帮我生成一个背景参考图',
      intentControlPlane: decisionFor('帮我生成一个背景参考图'),
      assistantContent: '我会生成一张背景参考图，完成后让你确认是否采用。',
      toolCalls: [{ name: 'generateImage', arguments: { prompt: 'clean product background' } }],
      runtime: baseRuntime({ photoshopConnected: false, hasDocument: false })
    });
    assert(contract.status === 'ready', `expected ready, got ${contract.status}: ${JSON.stringify(contract.blockers)}`);
    assert(contract.warnings.some((item) => item.includes('external_generation')), `expected external generation warning: ${JSON.stringify(contract)}`);
    return contract;
  }));

  cases.push(await runCase('agent-runtime-blocks-chat-only-tool-call-before-executor', async () => {
    let executedToolCount = 0;
    const agent = new Agent(
      {
        systemPrompt: 'Test agent.',
        tools: [{
          name: 'getDocumentInfo',
          description: 'Read document info',
          inputSchema: { type: 'object', properties: {} }
        }],
        modelId: 'test-model',
        maxIterations: 2,
        requireInitialToolCall: true,
        toolDecisionContext: {
          intentControlPlane: decisionFor('你可以做什么？'),
          photoshopConnected: true,
          hasDocument: true
        },
        callbacks: {}
      },
      async () => ({
        content: '我会先查看当前文档。',
        toolCalls: [{ id: 'call-1', name: 'getDocumentInfo', arguments: {} }]
      }),
      async () => {
        executedToolCount += 1;
        return { success: true };
      }
    );
    const result = await agent.run('你可以做什么？');
    assert(executedToolCount === 0, `tool executor should not run, got ${executedToolCount}`);
    assert(result.success === false, `expected failed result, got ${result.success}`);
    assert(result.stopReason === 'tool_preflight_blocked', `expected tool_preflight_blocked, got ${result.stopReason}`);
    assert(result.error === 'agent_tool_decision_contract_blocked', `expected decision contract error, got ${result.error}`);
    assert(result.message.includes('当前意图不允许调用工具'), `expected intent blocker message: ${result.message}`);
    return {
      stopReason: result.stopReason,
      executedToolCount,
      error: result.error
    };
  }));

  const payload = { success: cases.every((item) => item.status === 'pass'), cases };
  const serialized = JSON.stringify(payload);
  const forbiddenWords = [String.fromCharCode(99, 111, 110, 102, 105, 100, 101), String.fromCharCode(32622, 20449)];
  assert(!forbiddenWords.some((word) => serialized.includes(word)), `contract output must not expose unsupported decision score wording: ${serialized}`);
  assert(!serialized.includes(String.fromCodePoint(0xfffd)), 'report should not contain replacement characters');
  const report = writeReport(payload);
  console.log(JSON.stringify({ ...payload, report }, null, 2));
  process.exit(payload.success ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
