#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNoPseudoThinking(source, label) {
  const forbidden = [
    '等待响应',
    '请求已发送',
    '正在准备',
    '稍等，正在准备处理你的需求'
  ];
  for (const marker of forbidden) {
    assert(!source.includes(marker), `${label} must not reintroduce local pseudo-thinking marker: ${marker}`);
  }
}

function main() {
  const pkg = JSON.parse(read('package.json'));
  const app = read('src/renderer/App.tsx');
  const chatPanel = read('src/renderer/components/ChatPanel.tsx');
  const chatPanelTestBridge = read('src/renderer/testing/chat-panel-test-bridge.ts');
  const changeBoundaries = read('scripts/report-change-boundaries.cjs');
  const maintenance = read('scripts/validate-maintenance-hygiene.cjs');

  assert(
    exists('src/renderer/components/DesignAgentWorkbench.tsx'),
    'DesignAgentWorkbench component should exist as the project-mode workspace shell'
  );
  assert(
    exists('src/renderer/components/DesignAgentWorkbench.css'),
    'DesignAgentWorkbench.css should exist so workbench layout tokens stay out of App.tsx'
  );

  const workbench = read('src/renderer/components/DesignAgentWorkbench.tsx');
  const workbenchCss = read('src/renderer/components/DesignAgentWorkbench.css');

  assert(
    pkg.scripts?.['smoke:ui:workbench-information-architecture'] === 'node scripts/smoke-ui-workbench-information-architecture.cjs',
    'package should expose smoke:ui:workbench-information-architecture'
  );
  assert(
    pkg.scripts?.['maintenance:preflight']?.includes('smoke:ui:workbench-information-architecture'),
    'maintenance:preflight should include the workbench IA smoke'
  );
  assert(
    app.includes("import { DesignAgentWorkbench } from './components/DesignAgentWorkbench';") &&
      app.includes('<DesignAgentWorkbench') &&
      app.includes('activeView={activeView}') &&
      app.includes('onActiveViewChange={setActiveView}'),
    'App should delegate project-mode view composition to DesignAgentWorkbench'
  );
  assert(
    !app.includes("import { Sidebar } from './components/Sidebar';") &&
      !app.includes("import { ChatPanel } from './components/ChatPanel';") &&
      !app.includes("import { AssetGallery } from './components/AssetGallery';"),
    'App should not own the chat/assets layout after workbench shell extraction'
  );

  assert(
    workbench.includes('data-testid="design-agent-workbench"') &&
      workbench.includes('data-testid="workbench-conversation-rail"') &&
      workbench.includes('data-testid="workbench-agent-canvas"') &&
      !workbench.includes('data-testid="workbench-evidence-inspector"') &&
      !workbench.includes('data-testid="workbench-project-overview"') &&
      !workbench.includes('data-testid="workbench-qa-panel"'),
    'Workbench should expose only the conversation rail and primary canvas by default'
  );
  assert(
    workbench.includes("import { Sidebar } from './Sidebar';") &&
      workbench.includes("import { ChatPanel } from './ChatPanel';") &&
      workbench.includes("import { AssetGallery } from './AssetGallery';"),
    'Workbench should compose existing Sidebar, ChatPanel and AssetGallery instead of duplicating them'
  );
  assert(
    workbench.includes('aria-label="工作台视图"') &&
      workbench.includes('aria-current={activeView ==='),
    'Workbench navigation should expose accessible labels and active state'
  );
  assert(
      !workbench.includes('当前项目') &&
      !workbench.includes('当前任务') &&
      !workbench.includes('连接与验收') &&
      !workbench.includes('交付进度') &&
      !workbench.includes('任务详情') &&
      !workbench.includes('项目证据') &&
      !workbench.includes('项目概览') &&
      !workbench.includes('项目结构详情') &&
      !workbench.includes('业务素材概览'),
    'Workbench should keep project status, QA and delivery diagnostics out of the default user surface'
  );
  assert(
    !workbench.includes('executeToolCall') &&
      !workbench.includes('processWithUnifiedAgent') &&
      !workbench.includes('streamChatAsync') &&
      !workbench.includes('window.designEcho'),
    'Workbench shell must remain presentational and must not call Agent, Photoshop or provider services'
  );

  assert(
    workbenchCss.includes('.design-agent-workbench') &&
      workbenchCss.includes('.workbench-shell') &&
      workbenchCss.includes('.workbench-primary') &&
      workbenchCss.includes('.workbench-chat-canvas') &&
      !workbenchCss.includes('.workbench-inspector') &&
      !workbenchCss.includes('grid-template-columns'),
    'Workbench CSS should define a single primary canvas without a right inspector column'
  );
  assert(
    !/font-size:\s*clamp\([^;]*vw|font-size:\s*\d+vw/.test(workbenchCss),
    'Workbench CSS must not scale text directly with viewport width'
  );
  assert(
    !/letter-spacing:\s*-\d/.test(workbenchCss),
    'Workbench CSS must not use negative letter spacing'
  );
  assertNoPseudoThinking(workbench, 'DesignAgentWorkbench');
  assertNoPseudoThinking(workbenchCss, 'DesignAgentWorkbench.css');

  assert(
    chatPanel.includes('installChatPanelTestBridge') &&
      chatPanelTestBridge.includes("CHAT_TEST_BRIDGE_KEY = '__DESIGNECHO_CHAT_TEST_BRIDGE__'") &&
      chatPanelTestBridge.includes('(window as any)[CHAT_TEST_BRIDGE_KEY]') &&
      !chatPanel.includes('workbench-evidence-inspector'),
    'Workbench extraction must not move or break ChatPanel test bridge ownership'
  );
  assert(
    changeBoundaries.includes('smoke:ui:workbench-information-architecture') &&
      changeBoundaries.includes('DesignAgentWorkbench'),
    'change boundary report should classify the workbench shell and its smoke'
  );
  assert(
    maintenance.includes("scripts/smoke-ui-workbench-information-architecture.cjs") &&
      maintenance.includes("'DesignEcho-Agent/src/renderer/components/DesignAgentWorkbench.tsx'") &&
      maintenance.includes("'DesignEcho-Agent/src/renderer/components/DesignAgentWorkbench.css'"),
    'maintenance hygiene should syntax-check and focused-diff the workbench shell'
  );

  console.log(JSON.stringify({
    success: true,
    checks: [
      'App delegates project-mode shell to DesignAgentWorkbench',
      'Workbench composes Sidebar, ChatPanel and AssetGallery without duplicating runtime logic',
      'Workbench exposes only the conversation rail and primary canvas by default',
      'Workbench shell has accessible navigation and responsive layout',
      'Workbench does not call Agent, provider, Photoshop or window.designEcho services',
      'Workbench does not reintroduce pseudo-thinking placeholders',
      'ChatPanel test bridge ownership remains in ChatPanel',
      'package, maintenance preflight, change boundaries and maintenance hygiene are wired'
    ]
  }, null, 2));
}

main();
