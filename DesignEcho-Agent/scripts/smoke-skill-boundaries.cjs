const fs = require('fs');
const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const {
  getSkillById,
  getUserFacingSkills
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'skills', 'skill-declarations.ts'));
const {
  fastDeterministicRoute
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-orchestration', 'routing.ts'));
const {
  getSkillExecutor
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'index.ts'));
const {
  applySharedSkillParamDefaults
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'skill-param-defaults.ts'));

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeReport(payload) {
  const outDir = path.join(__dirname, '..', 'tmp');
  ensureDir(outDir);
  const jsonPath = path.join(outDir, 'skill-boundaries-smoke.json');
  const mdPath = path.join(outDir, 'skill-boundaries-smoke.md');
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');

  const lines = [
    '# Skill Boundaries Smoke',
    '',
    `- success: ${payload.success}`,
    ''
  ];

  for (const testCase of payload.cases) {
    lines.push(`## ${testCase.name}`);
    lines.push(`- status: ${testCase.status}`);
    if (testCase.details) {
      lines.push(`- details: ${testCase.details}`);
    }
    lines.push('');
  }

  fs.writeFileSync(mdPath, lines.join('\n'), 'utf8');
  return { json: jsonPath, md: mdPath };
}

function run() {
  const cases = [];

  const bridgeSkill = getSkillById('agent-panel-bridge');
  cases.push({
    name: 'agent-panel-bridge-is-internal-debug',
    status:
      bridgeSkill
      && bridgeSkill.visibility === 'internal-debug'
      && bridgeSkill.kind === 'debug'
        ? 'pass'
        : 'fail',
    details: bridgeSkill ? JSON.stringify({ visibility: bridgeSkill.visibility, kind: bridgeSkill.kind }) : 'missing skill'
  });

  const autonomousSkill = getSkillById('autonomous-agent');
  cases.push({
    name: 'autonomous-agent-is-system-only',
    status:
      autonomousSkill
      && autonomousSkill.visibility === 'system-only'
        ? 'pass'
        : 'fail',
    details: autonomousSkill ? JSON.stringify({ visibility: autonomousSkill.visibility, kind: autonomousSkill.kind }) : 'missing skill'
  });

  const documentSkill = getSkillById('document-management');
  cases.push({
    name: 'document-management-is-user-facing-operation',
    status:
      documentSkill
      && documentSkill.visibility === 'user-facing'
      && documentSkill.kind === 'operation'
        ? 'pass'
        : 'fail',
    details: documentSkill ? JSON.stringify({ visibility: documentSkill.visibility, kind: documentSkill.kind }) : 'missing skill'
  });

  const shapeMorphingSkill = getSkillById('shape-morphing');
  cases.push({
    name: 'shape-morphing-is-system-only-operation',
    status:
      shapeMorphingSkill
      && shapeMorphingSkill.visibility === 'system-only'
      && shapeMorphingSkill.kind === 'operation'
        ? 'pass'
        : 'fail',
    details: shapeMorphingSkill ? JSON.stringify({ visibility: shapeMorphingSkill.visibility, kind: shapeMorphingSkill.kind }) : 'missing skill'
  });

  const shapeMorphingExecutor = getSkillExecutor('shape-morphing');
  cases.push({
    name: 'shape-morphing-has-no-agent-executor',
    status: !shapeMorphingExecutor ? 'pass' : 'fail',
    details: shapeMorphingExecutor ? 'executor still registered' : 'not registered'
  });

  const visibleSkillIds = new Set(getUserFacingSkills().map((skill) => skill.id));
  cases.push({
    name: 'user-facing-skill-list-excludes-internal-and-system',
    status:
      !visibleSkillIds.has('agent-panel-bridge')
      && !visibleSkillIds.has('autonomous-agent')
      && !visibleSkillIds.has('shape-morphing')
        ? 'pass'
        : 'fail',
    details: JSON.stringify(Array.from(visibleSkillIds).slice(0, 20))
  });

  const mainImageSkill = getSkillById('main-image-design');
  const mainImageSizeParam = mainImageSkill?.parameters?.find((param) => param.name === 'size');
  const defaultMainImageParams = applySharedSkillParamDefaults({
    skillId: 'main-image-design',
    userInput: '帮我做主图',
    mode: 'execute',
    params: {}
  });
  const explicitMainImageSizeParams = applySharedSkillParamDefaults({
    skillId: 'main-image-design',
    userInput: '帮我做一张800主图',
    mode: 'execute',
    params: { size: '800' }
  });
  cases.push({
    name: 'main-image-default-entry-plans-three-delivery-sizes',
    status:
      mainImageSkill
      && mainImageSizeParam
      && mainImageSizeParam.default === undefined
      && JSON.stringify(defaultMainImageParams.sizes) === JSON.stringify(['800', '750', '1200'])
      && defaultMainImageParams.size === undefined
      && defaultMainImageParams.mainImageExecutionMode === 'strategy-only'
      && defaultMainImageParams.executionScope === 'disposable-document'
        ? 'pass'
        : 'fail',
    details: JSON.stringify({
      sizeParamDefault: mainImageSizeParam?.default,
      defaultMainImageParams
    })
  });
  cases.push({
    name: 'main-image-explicit-single-size-does-not-expand-to-three-sizes',
    status:
      explicitMainImageSizeParams.size === '800'
      && explicitMainImageSizeParams.sizes === undefined
        ? 'pass'
        : 'fail',
    details: JSON.stringify(explicitMainImageSizeParams)
  });

  const mainImageRoute = fastDeterministicRoute('帮我做主图');
  cases.push({
    name: 'main-image-natural-language-routes-to-safe-strategy-only-three-specs',
    status:
      mainImageRoute
      && mainImageRoute.skillId === 'main-image-design'
      && JSON.stringify(mainImageRoute.skillParams?.sizes) === JSON.stringify(['800', '750', '1200'])
      && mainImageRoute.skillParams?.size === undefined
      && mainImageRoute.skillParams?.mainImageExecutionMode === 'strategy-only'
      && mainImageRoute.skillParams?.executionScope === 'disposable-document'
      && mainImageRoute.skillParams?.approvedLiveExecution === false
      && mainImageRoute.skillParams?.approvedLiveAdapterRun === false
        ? 'pass'
        : 'fail',
    details: mainImageRoute ? JSON.stringify({
      skillId: mainImageRoute.skillId,
      skillParams: mainImageRoute.skillParams
    }) : 'no route'
  });

  const whiteBgMainImageRoute = fastDeterministicRoute('帮我做白底图');
  cases.push({
    name: 'main-image-white-background-intent-routes-with-white-bg-type',
    status:
      whiteBgMainImageRoute
      && whiteBgMainImageRoute.skillId === 'main-image-design'
      && whiteBgMainImageRoute.skillParams?.imageType === 'white-bg'
      && JSON.stringify(whiteBgMainImageRoute.skillParams?.sizes) === JSON.stringify(['800', '750', '1200'])
        ? 'pass'
        : 'fail',
    details: whiteBgMainImageRoute ? JSON.stringify({
      skillId: whiteBgMainImageRoute.skillId,
      skillParams: whiteBgMainImageRoute.skillParams
    }) : 'no route'
  });

  const closeRoute = fastDeterministicRoute('帮我关闭文档不保存');
  cases.push({
    name: 'document-close-does-not-route-to-bridge',
    status:
      closeRoute
      && closeRoute.skillId === 'document-management'
      && closeRoute.skillParams?.action === 'close'
      && closeRoute.skillParams?.save === false
        ? 'pass'
        : 'fail',
    details: closeRoute ? JSON.stringify(closeRoute.skillParams) : 'no route'
  });

  const saveDetailPageRoute = fastDeterministicRoute('帮我把详情页文档保存到项目的PSD中');
  cases.push({
    name: 'save-detail-page-document-routes-to-document-save',
    status:
      saveDetailPageRoute
      && saveDetailPageRoute.skillId === 'document-management'
      && saveDetailPageRoute.skillParams?.action === 'save'
      && saveDetailPageRoute.skillParams?.format === 'psd'
      && saveDetailPageRoute.skillParams?.saveAs === true
      && saveDetailPageRoute.skillParams?.projectSubdir === 'PSD'
        ? 'pass'
        : 'fail',
    details: saveDetailPageRoute ? JSON.stringify({
      skillId: saveDetailPageRoute.skillId,
      skillParams: saveDetailPageRoute.skillParams
    }) : 'no route'
  });

  const exportDetailPageRoute = fastDeterministicRoute('帮我把详情页文档导出成PNG');
  cases.push({
    name: 'export-detail-page-document-routes-to-document-save',
    status:
      exportDetailPageRoute
      && exportDetailPageRoute.skillId === 'document-management'
      && exportDetailPageRoute.skillParams?.action === 'save'
      && exportDetailPageRoute.skillParams?.format === 'png'
      && exportDetailPageRoute.skillParams?.saveAs === true
        ? 'pass'
        : 'fail',
    details: exportDetailPageRoute ? JSON.stringify({
      skillId: exportDetailPageRoute.skillId,
      skillParams: exportDetailPageRoute.skillParams
    }) : 'no route'
  });

  const bridgeRoute = fastDeterministicRoute('帮我和面板一起调试详情页文案溢出');
  cases.push({
    name: 'explicit-debug-still-routes-to-bridge',
    status:
      bridgeRoute
      && bridgeRoute.skillId === 'agent-panel-bridge'
        ? 'pass'
        : 'fail',
    details: bridgeRoute ? JSON.stringify(bridgeRoute.skillParams) : 'no route'
  });

  const bridgeExecutorPath = path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'agent-panel-bridge.executor.ts');
  const bridgeExecutorSource = fs.readFileSync(bridgeExecutorPath, 'utf8');
  cases.push({
    name: 'agent-panel-bridge-message-no-longer-dumps-debug-payload',
    status:
      !bridgeExecutorSource.includes('**面板消息（可直接发送）**')
      && !bridgeExecutorSource.includes('**MCP工具总数**')
        ? 'pass'
        : 'fail',
    details: JSON.stringify({
      dumpsPanelMessage: bridgeExecutorSource.includes('**面板消息（可直接发送）**'),
      dumpsToolCount: bridgeExecutorSource.includes('**MCP工具总数**')
    })
  });

  const chatPanelPath = path.resolve(__dirname, '..', 'src', 'renderer', 'components', 'ChatPanel.tsx');
  const chatPanelSource = fs.readFileSync(chatPanelPath, 'utf8');
  cases.push({
    name: 'chat-panel-does-not-promote-reasoning-to-user-content',
    status:
      !chatPanelSource.includes('if (json.reasoning) return json.reasoning;')
        ? 'pass'
        : 'fail',
    details: JSON.stringify({
      promotesReasoning: chatPanelSource.includes('if (json.reasoning) return json.reasoning;')
    })
  });

  const parserPath = path.resolve(__dirname, '..', 'src', 'renderer', 'components', 'message', 'parser.ts');
  const thinkingBlockPath = path.resolve(__dirname, '..', 'src', 'renderer', 'components', 'message', 'blocks', 'ThinkingBlock.tsx');
  const thinkingProcessPath = path.resolve(__dirname, '..', 'src', 'renderer', 'components', 'ThinkingProcess.tsx');
  const legacySystemPromptPath = path.resolve(__dirname, '..', 'src', 'renderer', 'prompts', 'agent-system-prompt.ts');
  const parserSource = fs.readFileSync(parserPath, 'utf8');
  const thinkingBlockSource = fs.readFileSync(thinkingBlockPath, 'utf8');
  const thinkingProcessSource = fs.readFileSync(thinkingProcessPath, 'utf8');
  const legacySystemPromptSource = fs.readFileSync(legacySystemPromptPath, 'utf8');
  cases.push({
    name: 'thinking-ui-uses-neutral-chinese-labels',
    status:
      !parserSource.includes("title: hasRealThinking ? 'Pondering' : 'Processing'")
      && !thinkingBlockSource.includes("block.title || 'Pondering'")
      && !thinkingProcessSource.includes("const panelTitle = hasRealThinking ? 'Thinking' : 'Processing';")
        ? 'pass'
        : 'fail',
    details: JSON.stringify({
      parserHasOldTitle: parserSource.includes("title: hasRealThinking ? 'Pondering' : 'Processing'"),
      blockHasOldTitle: thinkingBlockSource.includes("block.title || 'Pondering'"),
      processHasOldTitle: thinkingProcessSource.includes("const panelTitle = hasRealThinking ? 'Thinking' : 'Processing';")
    })
  });

  cases.push({
    name: 'legacy-renderer-agent-system-prompt-does-not-require-think-tags',
    status:
      !legacySystemPromptSource.includes('你必须先展示你的思维过程')
      && !legacySystemPromptSource.includes('<think>')
        ? 'pass'
        : 'fail',
    details: JSON.stringify({
      requiresThinkingDisplay: legacySystemPromptSource.includes('你必须先展示你的思维过程'),
      containsThinkTag: legacySystemPromptSource.includes('<think>')
    })
  });

  const success = cases.every((item) => item.status === 'pass');
  const payload = { success, cases };
  const report = writeReport(payload);
  console.log(JSON.stringify({ ...payload, report }, null, 2));
  process.exit(success ? 0 : 1);
}

run();
