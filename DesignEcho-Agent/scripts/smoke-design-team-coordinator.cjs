#!/usr/bin/env node

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
  DesignTeamCoordinator
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'design-teams', 'coordinator.ts'));
const {
  listDesignTeammateDefinitions,
  getDesignTeammateDefinition
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'design-teams', 'registry.ts'));
const {
  buildDesignTeamRuntimeBudget
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-performance-policy.ts'));

const tmpDir = path.resolve(__dirname, '..', 'tmp');
fs.mkdirSync(tmpDir, { recursive: true });

const cases = [];

function record(name, passed, details) {
  cases.push({ name, status: passed ? 'pass' : 'fail', details });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const definitions = listDesignTeammateDefinitions();
  const roles = definitions.map((item) => item.role).sort();
  record(
    'teammate-definitions',
    JSON.stringify(roles) === JSON.stringify(['critic', 'design-strategist', 'executor', 'scene-analyst']),
    { roles }
  );

  const iterationDefaults = Object.fromEntries(definitions.map((item) => [item.role, item.maxIterations]));
  record(
    'teammate-runtime-budgets-from-policy',
    iterationDefaults['scene-analyst'] === buildDesignTeamRuntimeBudget({ role: 'scene-analyst' }).maxIterations
      && iterationDefaults['design-strategist'] === buildDesignTeamRuntimeBudget({ role: 'design-strategist' }).maxIterations
      && iterationDefaults.executor === buildDesignTeamRuntimeBudget({ role: 'executor' }).maxIterations
      && iterationDefaults.critic === buildDesignTeamRuntimeBudget({ role: 'critic' }).maxIterations
      && iterationDefaults.executor === 12
      && iterationDefaults.critic === 8,
    { iterationDefaults }
  );

  const critic = getDesignTeammateDefinition('critic');
  const executor = getDesignTeammateDefinition('executor');
  record(
    'tool-boundaries',
    critic.canWriteToPhotoshop === false
      && !critic.allowedTools.includes('setTextStyle')
      && executor.canWriteToPhotoshop === true
      && executor.allowedTools.includes('setTextStyle'),
    {
      criticCanWrite: critic.canWriteToPhotoshop,
      criticWriteTool: critic.allowedTools.includes('setTextStyle'),
      executorCanWrite: executor.canWriteToPhotoshop,
      executorWriteTool: executor.allowedTools.includes('setTextStyle')
    }
  );

  let modelCalls = 0;
  const toolCalls = [];
  const modelToolNames = [];
  const coordinator = new DesignTeamCoordinator({
    resolveDefaultModelId: () => 'test-model',
    executeTool: async (toolName, params) => {
      toolCalls.push({ toolName, params });
      return { success: true, documentName: '测试文档', params };
    },
    callModel: async (_modelId, _messages, tools) => {
      modelCalls += 1;
      modelToolNames.push(tools.map((tool) => tool.name));
      if (modelCalls === 1) {
        return {
          content: '',
          toolCalls: [{
            id: 'inspect-1',
            name: 'getDocumentInfo',
            arguments: {}
          }]
        };
      }
      return {
        content: '场景结构已检查，当前文档可继续设计。',
        toolCalls: []
      };
    }
  });

  const result = await coordinator.runTeammateTask({
    role: 'scene-analyst',
    task: '检查当前 Photoshop 场景结构',
    context: '只读检查，不允许修改 Photoshop。',
    maxIterations: 4
  });

  record(
    'coordinator-task-lifecycle',
    result.success === true
      && result.status === 'completed'
      && result.role === 'scene-analyst'
      && result.outputType === 'scene_summary'
      && result.messages.some((message) => message.type === 'task_status' && message.payload?.status === 'pending')
      && result.messages.some((message) => message.type === 'task_status' && message.payload?.status === 'running')
      && result.messages.some((message) => message.type === 'task_status' && message.payload?.status === 'completed'),
    {
      status: result.status,
      role: result.role,
      outputType: result.outputType,
      messageTypes: result.messages.map((message) => message.type)
    }
  );

  record(
    'coordinator-tool-scope',
    toolCalls.length === 1
      && toolCalls[0].toolName === 'getDocumentInfo'
      && modelToolNames[0].includes('getDocumentInfo')
      && !modelToolNames[0].includes('setTextStyle'),
    {
      toolCalls,
      firstModelTools: modelToolNames[0]
    }
  );

  assert(cases.every((item) => item.status === 'pass'), 'one or more design-team smoke cases failed');
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
  const jsonPath = path.join(tmpDir, 'design-team-coordinator-smoke.json');
  const mdPath = path.join(tmpDir, 'design-team-coordinator-smoke.md');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(
    mdPath,
    [
      '# Design Team Coordinator Smoke',
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
