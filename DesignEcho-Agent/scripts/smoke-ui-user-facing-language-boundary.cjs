#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

const guardedFiles = [
  'src/renderer/components/DesignAgentWorkbench.tsx',
  'src/renderer/components/SettingsModal.tsx',
  'src/renderer/components/message/blocks/ToolResultBlock.tsx',
  'src/renderer/components/message/parser.ts',
  'src/renderer/services/agent-runtime/agent.ts',
  'src/renderer/services/design-agent/engine.ts',
  'src/renderer/services/design-skills/detail-page-template-authoring.skill.ts',
  'src/renderer/services/skill-executors/layout-replication-completion.ts',
  'src/renderer/services/skill-executors/layout-replication.executor.ts',
  'src/renderer/services/skill-executors/layout-replication-qa.ts',
  'src/renderer/services/skill-executors/business-skill-visual-evidence-gate.ts',
  'src/shared/business-skill-visual-evidence-feedback.ts',
  'src/shared/detail-page-skill-readiness.ts',
  'src/shared/design-result-review-panel.ts'
];

const forbiddenProductPhrases = [
  '项目证据',
  '素材证据',
  '过程诊断',
  '审查边界',
  '来源证据',
  '设计知识证据',
  '开发诊断',
  '证据屏',
  '证据型文案',
  '视觉证据:',
  'Overlay 证据:',
  '结构/证据',
  '诊断证据',
  '无截图证据',
  '截图证据',
  '证据:',
  '边界:',
  '基于已有证据',
  '当前缺少项目视觉证据',
  '项目视觉证据，允许',
  '可审计的设计计划',
  '项目概览',
  '项目结构详情',
  '业务素材概览',
  '审查线索',
  '项目视觉证据可用',
  '项目视觉证据不完整',
  '当前任务不需要项目视觉证据',
  '项目视觉证据需要复核',
  '已有候选图片，但视觉理解证据不足',
  '缺少证据',
  '类证据',
  '只读执行/QA 证据',
  '执行/QA 证据'
];

function main() {
  const failures = [];

  for (const file of guardedFiles) {
    const source = read(file);
    for (const phrase of forbiddenProductPhrases) {
      if (source.includes(phrase)) {
        failures.push({ file, phrase });
      }
    }
  }

  assert(
    failures.length === 0,
    'User-facing product language must not expose evidence/diagnostic terminology by default.',
    failures
  );

  const workbench = read('src/renderer/components/DesignAgentWorkbench.tsx');
  assert(
    workbench.includes('对话')
      && workbench.includes('素材')
      && !workbench.includes('当前项目')
      && !workbench.includes('当前任务')
      && !workbench.includes('连接与验收')
      && !workbench.includes('交付进度')
      && !workbench.includes('<summary>任务详情</summary>')
      && !workbench.includes('<summary>更多信息</summary>')
      && !workbench.includes('项目结构详情')
      && !workbench.includes('业务素材概览')
      && !workbench.includes('审查线索'),
    'Workbench should keep the default user surface focused on chat and assets only.'
  );

  const packageJson = read('package.json');
  assert(
    packageJson.includes('"smoke:ui:user-facing-language-boundary"'),
    'package should expose smoke:ui:user-facing-language-boundary'
  );

  console.log(JSON.stringify({
    success: true,
    checks: [
      'guarded user-facing files do not expose evidence/diagnostic terminology by default',
      'Workbench default surface does not expose the former right rail',
      'structured tool result placeholders do not mention developer diagnostics',
      'layout replication user report uses check result language instead of evidence report language',
      'package exposes a focused smoke for this boundary'
    ]
  }, null, 2));
}

main();
