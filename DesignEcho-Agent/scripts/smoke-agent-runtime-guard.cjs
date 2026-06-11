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

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeReport(payload) {
  const outDir = path.join(__dirname, '..', 'tmp');
  ensureDir(outDir);
  const jsonPath = path.join(outDir, 'agent-runtime-guard-smoke.json');
  const mdPath = path.join(outDir, 'agent-runtime-guard-smoke.md');
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');

  const lines = [
    '# Agent Runtime Guard Smoke',
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

function createAgent({ maxIterations = 6, callModel, executeTool, callbacks = {}, requireInitialToolCall }) {
  return new Agent(
    {
      systemPrompt: 'Test agent. Use tools only when needed.',
      tools: [
        {
          name: 'getDocumentInfo',
          description: 'Inspect current document',
          inputSchema: { type: 'object', properties: {} }
        }
      ],
      modelId: 'test-model',
      maxIterations,
      ...(requireInitialToolCall !== undefined ? { requireInitialToolCall } : {}),
      callbacks
    },
    callModel,
    executeTool || (async (_name, params) => ({ success: true, params }))
  );
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const cases = [];

  cases.push(await runCase('last-iteration-successful-tool-forces-final-response', async () => {
    let modelCalls = 0;
    let forcedFinalToolsLength = null;
    const agent = createAgent({
      maxIterations: 1,
      callModel: async (_modelId, messages, tools) => {
        modelCalls += 1;
        if (modelCalls > 1) {
          forcedFinalToolsLength = tools.length;
          return { content: '已完成所有操作。', toolCalls: [] };
        }
        return {
          content: '',
          toolCalls: [{
            id: `call-${modelCalls}`,
            name: 'getDocumentInfo',
            arguments: { request: modelCalls, messageCount: messages.length }
          }]
        };
      },
      executeTool: async () => ({
        success: true,
        message: 'Created text layer "白色".'
      })
    });

    const result = await agent.run('持续调用工具直到上限');
    assert(result.success === false, `expected false success, got ${result.success}`);
    assert(result.stopReason === 'tool_budget_final_response', `expected tool_budget_final_response, got ${result.stopReason}`);
    assert(result.executionSummary?.status === 'needs_review', `expected needs_review, got ${result.executionSummary?.status}`);
    assert(forcedFinalToolsLength === 0, `forced final response must be called with no tools, got ${forcedFinalToolsLength}`);
    assert(result.message.includes('工具预算已用尽'), `message should mark budget exhaustion: ${result.message}`);
    assert(!result.message.includes('最后错误: Created text layer'), `successful tool message must not be shown as last error: ${result.message}`);
    assert(!result.executionSummary?.lastError, `successful tool result must not set lastError: ${result.executionSummary?.lastError}`);
    assert(!result.message.includes('以上是已完成的工作'), `message must not fake completion: ${result.message}`);
    assert(!result.message.includes('已完成所有操作。'), `optimistic completion should not be exposed: ${result.message}`);
    return {
      modelCalls,
      iterations: result.iterations,
      stopReason: result.stopReason,
      message: result.message
    };
  }));

  cases.push(await runCase('tool-budget-forces-final-response-without-faking-completion', async () => {
    let modelCalls = 0;
    let forcedFinalToolsLength = null;
    const agent = createAgent({
      maxIterations: 5,
      callModel: async (_modelId, messages, tools) => {
        modelCalls += 1;
        if (tools.length === 0) {
          forcedFinalToolsLength = tools.length;
          return {
            content: '已完成所有操作。',
            toolCalls: []
          };
        }
        return {
          content: '',
          toolCalls: [{
            id: `budget-${modelCalls}`,
            name: 'getDocumentInfo',
            arguments: { request: modelCalls, messageCount: messages.length }
          }]
        };
      },
      executeTool: async () => ({ success: true })
    });

    const result = await agent.run('持续调用不同工具直到预算耗尽');
    assert(result.success === false, `expected false success, got ${result.success}`);
    assert(result.stopReason === 'tool_budget_final_response', `expected tool_budget_final_response, got ${result.stopReason}`);
    assert(result.executionSummary?.status === 'needs_review', `expected needs_review, got ${result.executionSummary?.status}`);
    assert(forcedFinalToolsLength === 0, `forced final response must be called with no tools, got ${forcedFinalToolsLength}`);
    assert(result.toolCallLog.length < 5, `forced finalization should stop tool execution before max tool rounds, got ${result.toolCallLog.length}`);
    assert(result.message.includes('工具预算已用尽'), `message should explain tool budget: ${result.message}`);
    assert(result.message.includes('不作为完成结论'), `completion claim should be suppressed: ${result.message}`);
    assert(!result.message.includes('已完成所有操作。'), `optimistic completion should not be exposed: ${result.message}`);
    return {
      modelCalls,
      iterations: result.iterations,
      stopReason: result.stopReason,
      executionStatus: result.executionSummary.status,
      toolCalls: result.toolCallLog.length
    };
  }));

  cases.push(await runCase('forced-final-empty-response-is-empty-final-response', async () => {
    let modelCalls = 0;
    const agent = createAgent({
      maxIterations: 1,
      callModel: async (_modelId, _messages, tools) => {
        modelCalls += 1;
        if (tools.length === 0) {
          return { content: '   ', toolCalls: [] };
        }
        return {
          content: '',
          toolCalls: [{
            id: 'force-empty-1',
            name: 'getDocumentInfo',
            arguments: { once: true }
          }]
        };
      },
      executeTool: async () => ({ success: true })
    });

    const result = await agent.run('最后一轮工具成功但强制总结为空');
    assert(result.success === false, `expected false success, got ${result.success}`);
    assert(result.stopReason === 'empty_final_response', `expected empty_final_response, got ${result.stopReason}`);
    assert(result.iterations === 1, `empty forced final should keep max iteration count, got ${result.iterations}`);
    assert(result.message.includes('没有给出可展示结果'), `message should explain empty final: ${result.message}`);
    return {
      modelCalls,
      iterations: result.iterations,
      stopReason: result.stopReason,
      message: result.message
    };
  }));

  cases.push(await runCase('forced-final-with-acceptance-failed-is-failed', async () => {
    let modelCalls = 0;
    const agent = createAgent({
      maxIterations: 1,
      callModel: async (_modelId, _messages, tools) => {
        modelCalls += 1;
        if (tools.length === 0) {
          return { content: '已完成并验证。', toolCalls: [] };
        }
        return {
          content: '',
          toolCalls: [{
            id: 'force-acceptance-failed-1',
            name: 'getDocumentInfo',
            arguments: { once: true }
          }]
        };
      },
      executeTool: async () => ({
        success: true,
        acceptance: {
          enabled: true,
          verified: false,
          assertionStatus: 'failed',
          noDocumentChangeRisk: false
        }
      })
    });

    const result = await agent.run('最后一轮验收失败但模型强制总结声称完成');
    assert(result.success === false, `expected false success, got ${result.success}`);
    assert(result.stopReason === 'tool_budget_final_response', `expected tool_budget_final_response, got ${result.stopReason}`);
    assert(result.executionSummary?.status === 'failed', `expected failed summary, got ${result.executionSummary?.status}`);
    assert(result.executionSummary.acceptanceFailed === 1, `expected one failed acceptance, got ${result.executionSummary.acceptanceFailed}`);
    assert(result.message.includes('验收失败 1 项'), `message should mention failed acceptance: ${result.message}`);
    assert(result.message.includes('不作为完成结论'), `message should reject optimistic completion claim: ${result.message}`);
    assert(!result.message.includes('已完成并验证。'), `optimistic completion should not be exposed: ${result.message}`);
    return {
      modelCalls,
      iterations: result.iterations,
      stopReason: result.stopReason,
      executionStatus: result.executionSummary.status,
      summaryText: result.executionSummary.summaryText
    };
  }));

  cases.push(await runCase('repeated-tool-batch-stops-before-limit', async () => {
    let modelCalls = 0;
    const agent = createAgent({
      maxIterations: 8,
      callModel: async () => {
        modelCalls += 1;
        return {
          content: '',
          toolCalls: [{
            id: `repeat-${modelCalls}`,
            name: 'getDocumentInfo',
            arguments: { same: true }
          }]
        };
      }
    });

    const result = await agent.run('重复读取同一个状态');
    assert(result.success === false, `expected false success, got ${result.success}`);
    assert(result.stopReason === 'no_progress', `expected no_progress, got ${result.stopReason}`);
    assert(result.iterations < 8, `should stop before max iterations, got ${result.iterations}`);
    assert(result.message.includes('连续重复相同工具调用'), `message should explain repeated calls: ${result.message}`);
    return {
      modelCalls,
      iterations: result.iterations,
      stopReason: result.stopReason,
      toolCalls: result.toolCallLog.length
    };
  }));

  cases.push(await runCase('final-response-after-tool-succeeds', async () => {
    let modelCalls = 0;
    const agent = createAgent({
      maxIterations: 5,
      callModel: async () => {
        modelCalls += 1;
        if (modelCalls === 1) {
          return {
            content: '',
            toolCalls: [{
              id: 'inspect-1',
              name: 'getDocumentInfo',
              arguments: { once: true }
            }]
          };
        }
        return { content: '已完成检查并确认结果。', toolCalls: [] };
      }
    });

    const result = await agent.run('检查一次后结束');
    assert(result.success === true, `expected success, got ${result.success}`);
    assert(result.stopReason === 'final_response', `expected final_response, got ${result.stopReason}`);
    assert(result.message === '已完成检查并确认结果。', `unexpected message: ${result.message}`);
    return {
      modelCalls,
      iterations: result.iterations,
      stopReason: result.stopReason,
      executionStatus: result.executionSummary && result.executionSummary.status
    };
  }));

  cases.push(await runCase('visible-reasoning-before-tool-call-is-model-generated', async () => {
    let modelCalls = 0;
    const timeline = [];
    const agent = createAgent({
      maxIterations: 5,
      callbacks: {
        onThinking: (thinking) => timeline.push({ type: 'thinking', text: thinking }),
        onToolStart: (toolName) => timeline.push({ type: 'tool_start', toolName })
      },
      callModel: async (_modelId, _messages, tools) => {
        modelCalls += 1;
        if (tools.length === 0) {
          return {
            content: '我会先确认当前文档和图层结构，再决定应修改哪些对象。',
            toolCalls: []
          };
        }
        if (modelCalls === 2) {
          return {
            content: '下一步需要读取文档信息，确认目标文档是否可编辑。',
            toolCalls: [{
              id: 'inspect-visible-reasoning',
              name: 'getDocumentInfo',
              arguments: { includeLayers: true }
            }]
          };
        }
        return { content: '已完成检查。', toolCalls: [] };
      }
    });

    const result = await agent.run('检查当前文档');
    const firstThinkingIndex = timeline.findIndex((item) => item.type === 'thinking');
    const firstToolIndex = timeline.findIndex((item) => item.type === 'tool_start');

    assert(result.success === true, `expected success, got ${result.success}`);
    assert(firstThinkingIndex >= 0, `expected visible reasoning event: ${JSON.stringify(timeline)}`);
    assert(firstToolIndex >= 0, `expected tool start event: ${JSON.stringify(timeline)}`);
    assert(firstThinkingIndex < firstToolIndex, `visible reasoning must appear before tool call: ${JSON.stringify(timeline)}`);
    assert(
      timeline.some((item) => item.type === 'thinking' && item.text.includes('先确认当前文档')),
      `missing pre-tool visible reasoning: ${JSON.stringify(timeline)}`
    );
    assert(
      timeline.some((item) => item.type === 'thinking' && item.text.includes('读取文档信息')),
      `assistant content alongside tool call should also be visible reasoning: ${JSON.stringify(timeline)}`
    );

    return {
      modelCalls,
      timeline,
      stopReason: result.stopReason
    };
  }));

  cases.push(await runCase('broken-thinking-is-not-forwarded-to-ui', async () => {
    const thinkingEvents = [];
    const agent = createAgent({
      maxIterations: 2,
      requireInitialToolCall: false,
      callbacks: {
        onThinking: (thinking) => thinkingEvents.push(thinking)
      },
      callModel: async () => ({
        thinking: '?'.repeat(5) + '...',
        content: '已给出普通回复。',
        toolCalls: []
      })
    });

    const result = await agent.run('测试损坏思考文本过滤');
    assert(result.success === true, `expected success, got ${result.success}`);
    assert(thinkingEvents.length === 0, `broken thinking should not be forwarded: ${JSON.stringify(thinkingEvents)}`);
    return {
      stopReason: result.stopReason,
      thinkingEvents
    };
  }));

  cases.push(await runCase('final-response-after-failed-tool-is-not-completed', async () => {
    let modelCalls = 0;
    const stepEvents = [];
    const agent = createAgent({
      maxIterations: 5,
      callbacks: {
        onStep: (step) => stepEvents.push(step)
      },
      callModel: async () => {
        modelCalls += 1;
        if (modelCalls === 1) {
          return {
            content: '',
            toolCalls: [{
              id: 'fail-tool-1',
              name: 'getDocumentInfo',
              arguments: { fail: true }
            }]
          };
        }
        return { content: '我已处理完成。', toolCalls: [] };
      },
      executeTool: async () => ({ success: false, error: '当前没有打开的 Photoshop 文档' })
    });

    const result = await agent.run('失败工具后模型错误声称完成');
    assert(result.success === false, `expected false success, got ${result.success}`);
    assert(result.stopReason === 'final_response', `expected final_response, got ${result.stopReason}`);
    assert(result.executionSummary?.status === 'failed', `expected failed summary, got ${result.executionSummary?.status}`);
    assert(result.message.startsWith(result.executionSummary.summaryText), `message should start from failed summary: ${result.message}`);
    assert(result.message.includes('不作为完成结论'), `message should reject optimistic completion claim: ${result.message}`);
    assert(!result.message.includes('我已处理完成。'), `message must not expose optimistic completion as final answer: ${result.message}`);
    assert(result.executionSummary.failedToolCalls === 1, `expected one failed tool, got ${result.executionSummary.failedToolCalls}`);
    const verificationStep = stepEvents.find((step) => step.kind === 'verification');
    assert(verificationStep, `verification step should be emitted: ${JSON.stringify(stepEvents)}`);
    assert(
      verificationStep.detail.includes('阻断原因：所有工具调用均未成功。'),
      `verification step should expose blockers before final report: ${verificationStep.detail}`
    );
    assert(
      verificationStep.detail.includes('复核提醒：最后错误: 当前没有打开的 Photoshop 文档'),
      `verification step should expose warning details before final report: ${verificationStep.detail}`
    );
    return {
      modelCalls,
      iterations: result.iterations,
      stopReason: result.stopReason,
      executionStatus: result.executionSummary.status,
      message: result.message,
      verificationStepDetail: verificationStep.detail
    };
  }));

  cases.push(await runCase('acceptance-failed-final-response-is-not-completed', async () => {
    let modelCalls = 0;
    const agent = createAgent({
      maxIterations: 5,
      callModel: async () => {
        modelCalls += 1;
        if (modelCalls === 1) {
          return {
            content: '',
            toolCalls: [{
              id: 'acceptance-failed-1',
              name: 'getDocumentInfo',
              arguments: { acceptance: true }
            }]
          };
        }
        return { content: '已完成并验证。', toolCalls: [] };
      },
      executeTool: async () => ({
        success: true,
        acceptance: {
          enabled: true,
          verified: false,
          assertionStatus: 'failed',
          noDocumentChangeRisk: false
        }
      })
    });

    const result = await agent.run('验收失败后模型错误声称完成');
    assert(result.success === false, `expected false success, got ${result.success}`);
    assert(result.executionSummary?.status === 'failed', `expected failed summary, got ${result.executionSummary?.status}`);
    assert(result.executionSummary.acceptanceFailed === 1, `expected one failed acceptance, got ${result.executionSummary.acceptanceFailed}`);
    assert(result.message.startsWith(result.executionSummary.summaryText), `message should start from failed summary: ${result.message}`);
    assert(result.message.includes('验收失败 1 项'), `message should mention failed acceptance: ${result.message}`);
    assert(result.message.includes('不作为完成结论'), `message should reject optimistic completion claim: ${result.message}`);
    assert(!result.message.includes('已完成并验证。'), `message must not expose optimistic completion as final answer: ${result.message}`);
    return {
      modelCalls,
      iterations: result.iterations,
      executionStatus: result.executionSummary.status,
      summaryText: result.executionSummary.summaryText
    };
  }));

  cases.push(await runCase('no-document-change-risk-needs-review', async () => {
    let modelCalls = 0;
    const agent = createAgent({
      maxIterations: 5,
      callModel: async () => {
        modelCalls += 1;
        if (modelCalls === 1) {
          return {
            content: '',
            toolCalls: [{
              id: 'no-change-1',
              name: 'getDocumentInfo',
              arguments: { noChange: true }
            }]
          };
        }
        return { content: '已完成。', toolCalls: [] };
      },
      executeTool: async () => ({
        success: true,
        acceptance: {
          enabled: true,
          verified: false,
          assertionStatus: 'needs_review',
          noDocumentChangeRisk: true
        }
      })
    });

    const result = await agent.run('无变化风险后模型错误声称完成');
    assert(result.success === false, `expected false success, got ${result.success}`);
    assert(result.executionSummary?.status === 'needs_review', `expected needs_review summary, got ${result.executionSummary?.status}`);
    assert(result.executionSummary.noDocumentChangeRisks === 1, `expected one no-change risk, got ${result.executionSummary.noDocumentChangeRisks}`);
    assert(result.message.startsWith(result.executionSummary.summaryText), `message should start from needs-review summary: ${result.message}`);
    assert(result.message.includes('执行状态：需复核'), `message should include needs-review summary: ${result.message}`);
    assert(result.message.includes('不作为完成结论'), `message should reject optimistic completion claim: ${result.message}`);
    assert(!result.message.includes('已完成。'), `message must not expose optimistic completion as final answer: ${result.message}`);
    return {
      modelCalls,
      iterations: result.iterations,
      executionStatus: result.executionSummary.status,
      summaryText: result.executionSummary.summaryText
    };
  }));

  cases.push(await runCase('empty-final-response-is-not-success', async () => {
    let modelCalls = 0;
    const agent = createAgent({
      maxIterations: 5,
      callModel: async () => {
        modelCalls += 1;
        if (modelCalls === 1) {
          return {
            content: '',
            toolCalls: [{
              id: 'inspect-empty',
              name: 'getDocumentInfo',
              arguments: { once: true }
            }]
          };
        }
        return { content: '   ', toolCalls: [] };
      }
    });

    const result = await agent.run('检查后空回答');
    assert(result.success === false, `expected false success, got ${result.success}`);
    assert(result.stopReason === 'empty_final_response', `expected empty_final_response, got ${result.stopReason}`);
    assert(result.message.includes('没有给出可展示的完成结果'), `message should explain empty final: ${result.message}`);
    return {
      modelCalls,
      iterations: result.iterations,
      stopReason: result.stopReason,
      message: result.message
    };
  }));

  const success = cases.every((item) => item.status === 'pass');
  const payload = { success, cases };
  const report = writeReport(payload);
  console.log(JSON.stringify({ ...payload, report }, null, 2));
  process.exit(success ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
