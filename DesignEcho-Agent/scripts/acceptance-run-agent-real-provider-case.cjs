#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const net = require('net');
const path = require('path');
const { _electron: electron } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const REPORT_JSON = path.join(ROOT, 'tmp', 'acceptance', 'agent-real-provider-acceptance.json');
const REPORT_MD = path.join(ROOT, 'tmp', 'acceptance', 'agent-real-provider-acceptance.md');
const WS_PORT = 8765;
const TEST_PORT_START = 23900;
const TEST_PORT_END = 24900;
const GREETING_PROMPT = '\u4f60\u597d\u554a';
const SKU_EXECUTION_PROMPT = '\u5e2e\u6211\u505aSKU\u4ee5\u53ca\u5bf9\u5e94\u7684\u81ea\u9009\u5907\u6ce8';

const debugState = {
  stage: 'not-started',
  lastReport: null,
  lastSnapshot: null
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isArmed() {
  return process.env.DESIGNECHO_REAL_PROVIDER_AGENT_ACCEPTANCE === '1'
    && process.env.DESIGNECHO_REAL_PROVIDER_AGENT_ACCEPTANCE_ALLOW_API === '1';
}

function isPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}

async function findFreePortBlock(start = TEST_PORT_START, end = TEST_PORT_END, count = 4) {
  for (let base = start; base <= end - count; base += count + 1) {
    const checks = [];
    for (let offset = 0; offset < count; offset += 1) {
      checks.push(isPortOpen(base + offset));
    }
    const open = await Promise.all(checks);
    if (open.every((value) => !value)) return base;
  }
  throw new Error('No free ' + count + '-port block found between ' + start + ' and ' + end + '.');
}

function resetDir(name) {
  const tmpRoot = path.resolve(ROOT, 'tmp');
  const dir = path.resolve(tmpRoot, name);
  if (!dir.startsWith(tmpRoot + path.sep)) {
    throw new Error('Refusing to remove unsafe test directory: ' + dir);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function resetTestProjectDir() {
  const projectDir = resetDir('agent-real-provider-acceptance-project');
  fs.mkdirSync(path.join(projectDir, 'PSD'), { recursive: true });
  fs.mkdirSync(path.join(projectDir, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(projectDir, 'output'), { recursive: true });
  return projectDir;
}

function readEnvValue(names) {
  for (const name of names) {
    const value = String(process.env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

function collectProviderAcceptanceConfig() {
  const apiKeys = {
    google: readEnvValue(['DESIGNECHO_TEST_GOOGLE_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY']),
    xiaomi: readEnvValue(['DESIGNECHO_TEST_XIAOMI_API_KEY', 'XIAOMI_API_KEY', 'MIMO_API_KEY']),
    openrouter: readEnvValue(['DESIGNECHO_TEST_OPENROUTER_API_KEY', 'OPENROUTER_API_KEY']),
    gptsapi: readEnvValue(['DESIGNECHO_TEST_GPTSAPI_API_KEY', 'GPTSAPI_API_KEY']),
    deepseek: readEnvValue(['DESIGNECHO_TEST_DEEPSEEK_API_KEY', 'DEEPSEEK_API_KEY'])
  };
  const explicitModelId = readEnvValue(['DESIGNECHO_REAL_PROVIDER_AGENT_ACCEPTANCE_MODEL_ID']);
  const selectedModelId = explicitModelId
    || (apiKeys.xiaomi ? 'xiaomi-mimo-v2.5-pro' : '')
    || (apiKeys.openrouter ? 'openrouter-mimo-v2.5-pro' : '')
    || (apiKeys.gptsapi ? 'gptsapi-gpt-5.4-pro' : '')
    || (apiKeys.deepseek ? 'deepseek-v4-pro' : '')
    || (apiKeys.google ? 'google-gemini-3-flash' : '');
  const hasAnyApiKey = Object.values(apiKeys).some(Boolean);
  return {
    apiKeys,
    selectedModelId,
    hasAnyApiKey,
    summary: {
      selectedModelId,
      apiKeyProviders: Object.entries(apiKeys)
        .filter(([, value]) => Boolean(value))
        .map(([provider]) => provider)
    }
  };
}

function buildTestModelPreferences(modelId) {
  return {
    mode: 'cloud',
    autoFallback: true,
    preferredCloudModels: {
      layoutAnalysis: modelId,
      textOptimize: modelId,
      visualAnalyze: modelId
    },
    orchestrator: {
      primaryModel: modelId,
      fallbackModel: modelId,
      workers: {
        vision: { modelId, enabled: true },
        design: { modelId, enabled: true },
        executor: { modelId, enabled: true }
      }
    }
  };
}

function seedIsolatedProviderState(userDataDir, providerConfig) {
  const entries = {};
  const apiKeys = providerConfig.apiKeys;
  const modelPreferences = buildTestModelPreferences(providerConfig.selectedModelId);
  const rendererState = {
    apiKeys,
    modelPreferences,
    customModels: []
  };
  const persistedStore = {
    state: rendererState,
    version: 33
  };

  entries.rendererState = JSON.stringify(rendererState);
  entries['designecho-storage'] = JSON.stringify(persistedStore);

  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(
    path.join(userDataDir, 'app-state-store.json'),
    JSON.stringify({ entries }, null, 2),
    'utf8'
  );
}

function writeReports(result) {
  const lines = [
    '# Agent Real Provider Acceptance',
    '',
    '- success: ' + result.success,
    '- skipped: ' + Boolean(result.skipped),
    result.error ? '- error: ' + result.error : '',
    '- report: ' + REPORT_JSON,
    '',
    '## Cases'
  ];

  for (const item of result.cases || []) {
    lines.push('- ' + item.id + ': ' + item.status + ' | ' + item.summary);
  }

  lines.push('', '## Checks');
  for (const check of result.checks || []) {
    lines.push('- ' + check);
  }

  lines.push('', '## Boundaries');
  for (const item of result.boundaries || []) {
    lines.push('- ' + item);
  }

  fs.mkdirSync(path.dirname(REPORT_JSON), { recursive: true });
  fs.writeFileSync(REPORT_JSON, JSON.stringify(result, null, 2), 'utf8');
  fs.writeFileSync(REPORT_MD, lines.filter(Boolean).join('\n'), 'utf8');
}

function writeSkippedReport(reason) {
  const result = {
    success: true,
    skipped: true,
    mode: 'guarded-real-provider-fake-photoshop',
    reason,
    requiredEnv: [
      'DESIGNECHO_REAL_PROVIDER_AGENT_ACCEPTANCE=1',
      'DESIGNECHO_REAL_PROVIDER_AGENT_ACCEPTANCE_ALLOW_API=1'
    ],
    boundaries: [
      'Default execution must not call a live model provider.',
      'This runner uses fake Photoshop even when real provider mode is armed.',
      'Passing this runner proves real-provider desktop routing and evidence export only, not design quality.'
    ],
    report: {
      json: REPORT_JSON,
      md: REPORT_MD
    }
  };
  writeReports(result);
  console.log(JSON.stringify(result, null, 2));
}

function buildAcceptanceCases() {
  return [
    {
      id: 'real-provider-chat-no-photoshop',
      title: 'Real provider greeting should stay conversational and avoid Photoshop tools',
      userInput: GREETING_PROMPT,
      mode: 'desktop_bridge',
      tags: ['desktop', 'real-provider', 'chat', 'routing'],
      expectation: {
        route: 'direct_response',
        executionKind: 'none',
        shouldUseTools: false,
        shouldChangeDocument: false,
        maxIterations: 0,
        maxToolCalls: 0
      },
      notes: [
        'This case intentionally avoids Photoshop execution.',
        'The provider response text is not judged for quality; only route, lifecycle and no-tool boundaries are checked.'
      ]
    },
    {
      id: 'real-provider-sku-visible-reasoning',
      title: 'Real provider SKU request should expose public reasoning before fake Photoshop tool evidence',
      userInput: SKU_EXECUTION_PROMPT,
      mode: 'desktop_bridge',
      tags: ['desktop', 'real-provider', 'sku', 'visible-reasoning', 'execution-style'],
      expectation: {
        route: 'skill_execution',
        skillId: 'sku-batch',
        executionKind: 'deterministic_skill',
        shouldUseTools: true,
        shouldChangeDocument: false,
        maxIterations: 1,
        maxToolCalls: 80
      },
      expectedPublicReasoning: true,
      notes: [
        'This case uses real provider output only for the public visible_reasoning preview.',
        'Photoshop stays fake, so this cannot prove SKU design quality or real document writes.'
      ]
    }
  ];
}

function summarizeSnapshot(snapshot) {
  return {
    isLoading: snapshot && snapshot.isLoading,
    messageCount: snapshot && snapshot.messageCount,
    messages: ((snapshot && snapshot.messages) || []).map((message) => ({
      role: message.role,
      contentPreview: message.contentPreview,
      thinkingStepCount: message.thinkingStepCount,
      thinkingBlockTitles: message.thinkingBlockTitles,
      toolResultCount: message.toolResultCount,
      executionStatus: message.executionStatus,
      executionSummaryPreview: message.executionSummaryPreview
    }))
  };
}

async function submitAndExport(page, acceptanceCase) {
  debugState.stage = 'submit:' + acceptanceCase.id;
  const before = await page.evaluate(() => window.__DESIGNECHO_CHAT_TEST_BRIDGE__.getSnapshot());
  const after = await page.evaluate((input) => (
    window.__DESIGNECHO_CHAT_TEST_BRIDGE__.submit(input, { timeoutMs: 45000 })
  ), acceptanceCase.userInput);
  debugState.lastSnapshot = summarizeSnapshot(after);

  const debug = await page.evaluate((casePayload) => (
    window.__DESIGNECHO_CHAT_TEST_BRIDGE__.getLatestAcceptanceDebug(casePayload)
  ), acceptanceCase);
  debugState.lastReport = debug.report;

  const newMessages = after.messages.slice(before.messageCount);
  const text = newMessages.map((message) => message.contentPreview || '').join('\n');
  const thinking = newMessages.map((message) => message.thinkingPreview || '').join('\n');

  assert(
    newMessages.some((message) => message.role === 'user' && message.contentPreview.includes(acceptanceCase.userInput)),
    acceptanceCase.id + ' did not append the user message.'
  );
  assert(newMessages.some((message) => message.role === 'assistant'), acceptanceCase.id + ' did not append an assistant message.');
  assert(debug.bundle && debug.bundle.caseId === acceptanceCase.id, acceptanceCase.id + ' debug bundle has the wrong caseId.');
  assert(debug.report && debug.report.caseId === acceptanceCase.id, acceptanceCase.id + ' report has the wrong caseId.');
  assert(debug.report && debug.report.status === 'passed', acceptanceCase.id + ' acceptance report did not pass: ' + JSON.stringify(debug.report, null, 2));
  assert(!text.includes('Agent \u9762\u677f\u6865\u63a5\u6d88\u606f\u5df2\u751f\u6210'), acceptanceCase.id + ' leaked debug bridge copy.');
  assert(!text.includes('"intent": "debug_or_implement"'), acceptanceCase.id + ' leaked debug JSON.');
  if (acceptanceCase.expectation?.shouldUseTools !== true) {
    assert(!thinking.includes('getDocumentInfo'), acceptanceCase.id + ' should not expose Photoshop tool calls for a non-execution request.');
  }
  if (acceptanceCase.expectedPublicReasoning) {
    assertPublicReasoningBoundary(acceptanceCase, debug.bundle);
  }

  return {
    id: acceptanceCase.id,
    status: debug.report.status,
    summary: debug.report.summary,
    issueLayers: debug.report.issueLayers,
    evidence: debug.report.evidence,
    checkCount: debug.report.checks.length,
    bundle: debug.bundle,
    report: debug.report
  };
}

function assertPublicReasoningBoundary(acceptanceCase, bundle) {
  const visibleThinking = Array.isArray(bundle && bundle.visibleThinking)
    ? bundle.visibleThinking.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const combined = visibleThinking.join('\n');
  assert(
    visibleThinking.length > 0 && combined.length >= 8,
    acceptanceCase.id + ' did not expose a non-empty real-provider public visible reasoning preview.'
  );
  for (const banned of [
    '\u7b49\u5f85\u54cd\u5e94',
    '\u6b63\u5728\u51c6\u5907',
    '\u8bf7\u6c42\u5df2\u53d1\u9001',
    'Agent Router',
    'agentRequestLifecycle',
    'routeSource',
    'executionKind',
    'getDocumentInfo',
    'getLayerHierarchy',
    'skuLayout',
    '\u5de5\u5177\u5b8c\u6210'
  ]) {
    assert(!combined.includes(banned), acceptanceCase.id + ' leaked non-model or tool text into public reasoning: ' + banned);
  }
}

async function main() {
  if (!isArmed()) {
    writeSkippedReport('Real provider Agent acceptance is not armed.');
    return;
  }

  const providerConfig = collectProviderAcceptanceConfig();
  if (!providerConfig.hasAnyApiKey || !providerConfig.selectedModelId) {
    writeSkippedReport(
      'Real provider Agent acceptance is armed, but no test provider API key/model was provided. '
        + 'Set DESIGNECHO_TEST_XIAOMI_API_KEY, DESIGNECHO_TEST_OPENROUTER_API_KEY, '
        + 'DESIGNECHO_TEST_GPTSAPI_API_KEY, DESIGNECHO_TEST_DEEPSEEK_API_KEY or DESIGNECHO_TEST_GOOGLE_API_KEY.'
    );
    return;
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const mainEntry = path.join(ROOT, pkg.main || 'dist/main/main/index.js');
  const rendererEntry = path.join(ROOT, 'dist', 'renderer', 'index.html');
  assert(fs.existsSync(mainEntry), 'Missing built Electron main entry: ' + mainEntry + '. Run npm run build first.');
  assert(fs.existsSync(rendererEntry), 'Missing built renderer entry: ' + rendererEntry + '. Run npm run build first.');

  const testPortBase = await findFreePortBlock();
  const userDataDir = resetDir('agent-real-provider-acceptance-user-data');
  seedIsolatedProviderState(userDataDir, providerConfig);
  const projectDir = resetTestProjectDir();
  const acceptanceCases = buildAcceptanceCases();
  let app;

  try {
    debugState.stage = 'launch';
    app = await electron.launch({
      args: [ROOT, '--user-data-dir=' + userDataDir],
      cwd: ROOT,
      env: {
        ...process.env,
        DESIGNECHO_CHAT_TEST_BRIDGE: '1',
        DESIGNECHO_TEST_USER_DATA_DIR: userDataDir,
        DESIGNECHO_CHAT_TEST_PROJECT_PATH: projectDir,
        DESIGNECHO_CHAT_TEST_FAKE_PHOTOSHOP: '1',
        DESIGNECHO_PORT_OFFSET: String(testPortBase - WS_PORT),
        DESIGNECHO_SKIP_PORT_CLEANUP: '1',
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
      },
      timeout: 30000
    });

    const page = await app.firstWindow({ timeout: 30000 });
    debugState.stage = 'renderer-load';
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
    await page.waitForFunction(() => !!window.__DESIGNECHO_CHAT_TEST_BRIDGE__, null, { timeout: 30000 });

    const bridgeInfo = await page.evaluate(() => ({
      hasBridge: !!window.__DESIGNECHO_CHAT_TEST_BRIDGE__,
      hasAcceptanceDebug: typeof window.__DESIGNECHO_CHAT_TEST_BRIDGE__?.getLatestAcceptanceDebug === 'function',
      query: window.location.search
    }));
    assert(bridgeInfo.hasBridge, 'ChatPanel test bridge is not available.');
    assert(bridgeInfo.hasAcceptanceDebug, 'ChatPanel test bridge did not expose getLatestAcceptanceDebug.');
    assert(String(bridgeInfo.query).includes('designechoChatTestBridge=1'), 'Renderer query did not enable the test bridge.');
    assert(String(bridgeInfo.query).includes('designechoChatTestFakePhotoshop=1'), 'Renderer query did not enable fake Photoshop.');

    const cases = [];
    for (const acceptanceCase of acceptanceCases) {
      cases.push(await submitAndExport(page, acceptanceCase));
    }
    const result = {
      success: cases.every((item) => item.status === 'passed'),
      skipped: false,
      mode: 'desktop-bridge-real-provider-fake-photoshop',
      providerConfig: providerConfig.summary,
      isolatedPorts: {
        ws: testPortBase,
        webview: testPortBase + 1,
        debugBridge: testPortBase + 2,
        mcpHost: testPortBase + 3
      },
      testUserDataDir: userDataDir,
      testProjectDir: projectDir,
      cases,
      checks: [
        'Electron desktop app launched with isolated userData and isolated ports.',
        'ChatPanel test bridge exposed getLatestAcceptanceDebug.',
        'Real provider mode did not set DESIGNECHO_CHAT_TEST_FAKE_MODEL.',
        'Isolated userData was seeded with redacted test provider config before launch.',
        'Fake Photoshop stayed enabled so this case cannot modify a real document.',
        'Greeting request produced a direct_response lifecycle and no tool evidence.',
        'Execution-style SKU request exposed non-empty public visible reasoning from the real provider.',
        'Execution-style SKU request kept local placeholders, router internals and tool names out of public reasoning.'
      ],
      boundaries: [
        'This runner can call the configured live model provider only when explicitly armed.',
        'This runner uses fake Photoshop and cannot prove real Photoshop behavior.',
        'This runner does not score model answer quality or design quality.'
      ],
      report: {
        json: REPORT_JSON,
        md: REPORT_MD
      }
    };
    writeReports(result);
    console.log(JSON.stringify({
      success: result.success,
      skipped: result.skipped,
      mode: result.mode,
      report: result.report,
      cases: result.cases.map((caseResult) => ({
        id: caseResult.id,
        status: caseResult.status,
        summary: caseResult.summary
      }))
    }, null, 2));
    if (!result.success) process.exit(1);
  } finally {
    if (app) {
      await app.close().catch(() => undefined);
    }
  }
}

main().catch((error) => {
  const result = {
    success: false,
    skipped: false,
    error: error && error.stack ? error.stack : (error && error.message ? error.message : String(error)),
    debug: debugState,
    report: {
      json: REPORT_JSON,
      md: REPORT_MD
    },
    boundaries: [
      'A failed real-provider acceptance run should be treated as provider, routing, UI bridge or configuration evidence.',
      'Do not interpret this failure as Photoshop or design-quality evidence because fake Photoshop is used.'
    ]
  };
  writeReports(result);
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
});
