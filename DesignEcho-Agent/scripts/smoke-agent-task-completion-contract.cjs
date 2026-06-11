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
const { buildTaskCompletionContract } = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-runtime', 'task-completion-contract.ts'));

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeReport(payload) {
  const outDir = path.join(__dirname, '..', 'tmp');
  ensureDir(outDir);
  const jsonPath = path.join(outDir, 'agent-task-completion-contract-smoke.json');
  const mdPath = path.join(outDir, 'agent-task-completion-contract-smoke.md');
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');

  const lines = [
    '# Agent Task Completion Contract Smoke',
    '',
    `- success: ${payload.success}`,
    ''
  ];
  for (const item of payload.cases) {
    lines.push(`## ${item.name}`);
    lines.push(`- status: ${item.status}`);
    if (item.details) lines.push(`- details: ${item.details}`);
    lines.push('');
  }
  fs.writeFileSync(mdPath, lines.join('\n'), 'utf8');
  return { json: jsonPath, md: mdPath };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

function createAgent({ callModel, executeTool, taskCompletionContext, maxIterations = 4 }) {
  return new Agent(
    {
      systemPrompt: 'Test agent. Use tools when needed.',
      tools: [
        { name: 'getAllTextLayers', description: 'Read text layers', inputSchema: { type: 'object', properties: {} } },
        { name: 'createTextLayer', description: 'Create text layer', inputSchema: { type: 'object', properties: {} } },
        { name: 'getScreenSnapshotsWithOverlay', description: 'Verify screen', inputSchema: { type: 'object', properties: {} } }
      ],
      modelId: 'test-model',
      maxIterations,
      taskCompletionContext,
      callbacks: {}
    },
    callModel,
    executeTool
  );
}

async function main() {
  const cases = [];

  cases.push(await runCase('text-typography-contract-completed-after-read-write-verify', async () => {
    const contract = buildTaskCompletionContract({
      task: '帮我把字体全部改成思源黑体',
      toolCallLog: [
        { name: 'getAllTextLayers', arguments: {}, result: { success: true } },
        {
          name: 'setTextStyle',
          arguments: { fontFamily: '思源黑体' },
          result: {
            success: true,
            acceptance: {
              enabled: true,
              verified: true,
              assertionStatus: 'passed',
              noDocumentChangeRisk: false
            }
          }
        },
        { name: 'getAllTextLayers', arguments: {}, result: { success: true } }
      ]
    });

    assert(contract, 'expected a contract');
    assert(contract.kind === 'text_typography_edit', `unexpected kind: ${contract.kind}`);
    assert(contract.status === 'completed', `expected completed, got ${contract.status}`);
    return { summary: contract.summary, requirements: contract.required.map((item) => item.status) };
  }));

  cases.push(await runCase('text-contract-needs-review-without-post-verification', async () => {
    const contract = buildTaskCompletionContract({
      task: '把标题文字改成新品上市',
      toolCallLog: [
        { name: 'getAllTextLayers', arguments: {}, result: { success: true } },
        { name: 'setTextContent', arguments: { text: '新品上市' }, result: { success: true } }
      ]
    });

    assert(contract, 'expected a contract');
    assert(contract.kind === 'text_content_edit', `unexpected kind: ${contract.kind}`);
    assert(contract.status === 'needs_review', `expected needs_review, got ${contract.status}`);
    assert(contract.warnings.some((item) => item.includes('缺少修改后复核')), `expected post verification warning: ${contract.warnings.join(';')}`);
    return { summary: contract.summary, warnings: contract.warnings };
  }));

  cases.push(await runCase('reference-contract-needs-review-without-visual-and-coverage', async () => {
    const contract = buildTaskCompletionContract({
      task: '根据参考图复刻这个文本排版',
      context: { imageCount: 1 },
      toolCallLog: [
        {
          name: 'createTextLayer',
          arguments: { text: '合格证' },
          result: {
            success: true,
            acceptance: {
              enabled: true,
              verified: true,
              assertionStatus: 'passed',
              noDocumentChangeRisk: false
            }
          }
        }
      ]
    });

    assert(contract, 'expected a contract');
    assert(contract.kind === 'reference_replication', `unexpected kind: ${contract.kind}`);
    assert(contract.status === 'needs_review', `expected needs_review, got ${contract.status}`);
    assert(contract.required.some((item) => item.id === 'visual-verified' && item.status === 'needs_review'), 'expected visual verification to need review');
    assert(contract.required.some((item) => item.id === 'reference-coverage' && item.status === 'needs_review'), 'expected coverage to need review');
    return { summary: contract.summary, required: contract.required };
  }));

  cases.push(await runCase('reference-contract-completed-with-visual-and-coverage', async () => {
    const contract = buildTaskCompletionContract({
      task: '根据参考图复刻这个文本排版',
      context: { imageCount: 1 },
      toolCallLog: [
        { name: 'createTextLayer', arguments: { text: '合格证' }, result: { success: true } },
        {
          name: 'getScreenSnapshotsWithOverlay',
          arguments: {},
          result: {
            success: true,
            data: {
              completionContract: {
                evidence: {
                  coverage: {
                    expected: 1,
                    applied: 1,
                    failed: 0,
                    skipped: 0
                  }
                }
              }
            }
          }
        }
      ]
    });

    assert(contract, 'expected a contract');
    assert(contract.status === 'completed', `expected completed, got ${contract.status}: ${contract.summary}`);
    return { summary: contract.summary, visual: contract.evidence.visual, coverage: contract.evidence.coverage };
  }));

  cases.push(await runCase('layer-order-contract-does-not-use-reference-replication', async () => {
    const contract = buildTaskCompletionContract({
      task: '把颜色图层按从浅到深从上到下调整图层顺序',
      toolCallLog: [
        { name: 'getLayerHierarchy', arguments: { includeHidden: true }, result: { success: true } },
        {
          name: 'reorderLayer',
          arguments: { layerId: 8, action: 'above', targetLayerId: 9 },
          result: {
            success: true,
            acceptance: {
              enabled: true,
              verified: true,
              assertionStatus: 'passed',
              noDocumentChangeRisk: false
            }
          }
        },
        { name: 'getLayerHierarchy', arguments: { includeHidden: true }, result: { success: true } }
      ]
    });

    assert(contract, 'expected a contract');
    assert(contract.kind === 'layer_order_edit', `unexpected kind: ${contract.kind}`);
    assert(contract.status === 'completed', `expected completed, got ${contract.status}: ${contract.summary}`);
    assert(!contract.summary.includes('参考图复刻'), `layer order task must not use reference contract: ${contract.summary}`);
    return { summary: contract.summary, requirements: contract.required.map((item) => item.status) };
  }));

  cases.push(await runCase('runtime-downgrades-optimistic-reference-final-response', async () => {
    let modelCalls = 0;
    const agent = createAgent({
      taskCompletionContext: { imageCount: 1 },
      callModel: async () => {
        modelCalls += 1;
        if (modelCalls === 1) {
          return {
            content: '',
            toolCalls: [{
              id: 'create-text-1',
              name: 'createTextLayer',
              arguments: { text: '合格证' }
            }]
          };
        }
        return { content: '已完成参考图复刻。', toolCalls: [] };
      },
      executeTool: async () => ({
        success: true,
        acceptance: {
          enabled: true,
          verified: true,
          assertionStatus: 'passed',
          noDocumentChangeRisk: false
        }
      })
    });

    const result = await agent.run('根据参考图复刻这个文本排版');
    assert(result.success === false, `expected false success, got ${result.success}`);
    assert(result.executionSummary?.status === 'needs_review', `expected needs_review, got ${result.executionSummary?.status}`);
    assert(result.executionSummary?.taskCompletion?.kind === 'reference_replication', 'expected reference task contract');
    assert(result.message.includes('任务完成契约'), `expected contract details in message: ${result.message}`);
    assert(result.message.includes('不作为完成结论'), `expected optimistic final response to be suppressed: ${result.message}`);
    assert(!result.message.includes('已完成参考图复刻。'), `optimistic completion text should not be exposed: ${result.message}`);
    return {
      modelCalls,
      stopReason: result.stopReason,
      executionStatus: result.executionSummary.status,
      contractSummary: result.executionSummary.taskCompletion.summary
    };
  }));

  const success = cases.every((item) => item.status === 'pass');
  const report = { success, cases, generatedAt: new Date().toISOString() };
  const files = writeReport(report);

  if (!success) {
    console.error(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  console.log(`Agent task completion contract smoke passed. Report: ${files.md}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
