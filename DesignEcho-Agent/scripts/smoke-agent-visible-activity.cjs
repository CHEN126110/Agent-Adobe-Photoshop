#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function loadVisibleFeedbackExports() {
  const filename = path.join(ROOT, 'src/renderer/services/agent-visible-feedback.ts');
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true
    },
    fileName: filename
  });

  const serviceModule = new Module(filename, module);
  serviceModule.filename = filename;
  serviceModule.paths = Module._nodeModulePaths(path.dirname(filename));

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '../../shared/agent-observation-channels') {
      const policyFilename = path.join(ROOT, 'src/shared/agent-observation-channels.ts');
      const policySource = fs.readFileSync(policyFilename, 'utf8');
      const policyCompiled = ts.transpileModule(policySource, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2020,
          esModuleInterop: true
        },
        fileName: policyFilename
      });
      const policyModule = new Module(policyFilename, module);
      policyModule.filename = policyFilename;
      policyModule.paths = Module._nodeModulePaths(path.dirname(policyFilename));
      policyModule._compile(policyCompiled.outputText, `${policyFilename}.js`);
      return policyModule.exports;
    }
    if (request === './tool-display-info') {
      return {
        getToolDisplayInfo: (toolName) => ({
          name: toolName,
          icon: 'T',
          description: toolName
        })
      };
    }
    if (request === '../../shared/skills/skill-declarations') {
      return {
        getSkillById: (skillId) => {
          const skills = {
            'sku-batch': { id: 'sku-batch', name: 'SKU Batch', visibility: 'user-facing' },
            'document-management': { id: 'document-management', name: 'Document Management', visibility: 'user-facing' },
            'autonomous-agent': { id: 'autonomous-agent', name: 'Autonomous Agent', visibility: 'system-only' }
          };
          return skills[skillId];
        }
      };
    }
    if (request === './design-teams') {
      return {
        getDesignTeammateDefinition: (role) => ({
          role,
          displayName: role === 'scene-analyst' ? 'Scene Analyst' : role
        })
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    serviceModule._compile(compiled.outputText, `${filename}.js`);
  } finally {
    Module._load = originalLoad;
  }

  return serviceModule.exports;
}

function assertVisibleActivityContract() {
  const {
    buildInitialVisibleAgentActivity,
    buildVisibleAgentActivityFromStepEvent
  } = loadVisibleFeedbackExports();

  assert(typeof buildInitialVisibleAgentActivity === 'function', 'initial visible activity helper is missing');
  assert(typeof buildVisibleAgentActivityFromStepEvent === 'function', 'step-event visible activity helper is missing');

  const initialActivity = buildInitialVisibleAgentActivity();
  assert(initialActivity && initialActivity.kind === 'request', 'initial activity must expose the request stage');
  assert(initialActivity.title === '当前响应', `initial activity should be titled 当前响应, got ${initialActivity.title}`);
  assert(initialActivity.agentLabel === 'DesignEcho Agent', `unexpected initial activity label: ${initialActivity.agentLabel}`);
  assert(initialActivity.source === 'initial', `unexpected initial activity source: ${initialActivity.source}`);
  assert(initialActivity.userVisible === true, 'initial activity must be user-visible');
  assert(initialActivity.showAsThinking === false, 'initial activity must not become provider thinking');
  assert(initialActivity.isProviderThinking === false, 'initial activity must not claim provider thinking');
  assert(initialActivity.canClaimModelReasoning === false, 'initial activity must not claim model reasoning');
  const initialText = `${initialActivity.title}\n${initialActivity.agentLabel}\n${initialActivity.detail || ''}`;
  for (const forbidden of ['正在思考', '等待响应', '请求已发送', '正在准备', '等待模型返回', '正在处理你的需求']) {
    assert(!initialText.includes(forbidden), `initial activity must not use fake waiting/thinking copy: ${forbidden}`);
  }

  const skuActivity = buildVisibleAgentActivityFromStepEvent({
    kind: 'tool_started',
    title: '开始能力：SKU Batch',
    detail: '能力 ID: sku-batch',
    status: 'running',
    toolName: 'sku-batch',
    toolCallId: 'skill-sku-batch-1'
  });
  assert(skuActivity && skuActivity.agentLabel === 'SKU Batch', 'skill wrapper event must expose SKU Batch activity identity');
  assert(skuActivity.kind === 'skill', `SKU Batch event should be skill activity, got ${skuActivity.kind}`);
  assert(skuActivity.showAsThinking === false, 'skill activity must not become provider thinking');

  const autonomousActivity = buildVisibleAgentActivityFromStepEvent({
    kind: 'tool_started',
    title: '开始能力：当前请求',
    detail: '能力 ID: autonomous-agent',
    status: 'running',
    toolName: 'autonomous-agent',
    toolCallId: 'skill-autonomous-agent-1'
  });
  assert(autonomousActivity && autonomousActivity.kind === 'autonomous_agent', 'autonomous-agent must expose autonomous activity kind');
  assert(autonomousActivity.agentLabel === 'Autonomous Agent', `unexpected autonomous label: ${autonomousActivity && autonomousActivity.agentLabel}`);

  const toolActivity = buildVisibleAgentActivityFromStepEvent({
    kind: 'tool_started',
    title: '调用 Photoshop 工具：getDocumentInfo',
    status: 'running',
    toolName: 'getDocumentInfo',
    toolCallId: 'tool-1'
  });
  assert(toolActivity === null, 'plain tool events must stay in tool-call UI, not become agent identity');
}

function assertChatPanelWiring() {
  const chatPanel = read('src/renderer/components/ChatPanel.tsx');
  const css = read('src/renderer/components/ThinkingProcess.css');

  assert(chatPanel.includes('buildInitialVisibleAgentActivity'), 'ChatPanel must import the initial request activity helper');
  assert(chatPanel.includes('setLiveActivity(buildInitialVisibleAgentActivity())'), 'ChatPanel must show an initial request activity while provider output has not arrived');
  assert(chatPanel.includes('buildVisibleAgentActivityFromStepEvent(event)'), 'ChatPanel must update visible agent identity from skill wrapper events');
  assert(chatPanel.includes('agent-activity-label'), 'Live activity UI must render the agent label');
  assert(!chatPanel.includes("const LIVE_ACTIVITY_THINKING_TITLE = '正在思考'"), 'ChatPanel must not use 正在思考 as local live placeholder');
  assert(!chatPanel.includes('setLiveActivity({ title: LIVE_ACTIVITY_THINKING_TITLE })'), 'ChatPanel must not set a local fake thinking placeholder');
  assert(!chatPanel.includes('pondering-dots'), 'Live activity must not mimic streaming thinking with animated dots');
  assert(css.includes('.agent-activity-label'), 'Live activity label must have dedicated styling');
}

function main() {
  assertVisibleActivityContract();
  assertChatPanelWiring();

  console.log(JSON.stringify({
    success: true,
    checks: [
      'initial request activity is visible without claiming provider thinking',
      'skill wrapper events update the visible activity identity',
      'plain Photoshop tool events remain tool-call events',
      'ChatPanel initializes a request activity before provider output and replaces it with real model/tool output',
      'live activity renders an agent label through dedicated UI styling'
    ]
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
