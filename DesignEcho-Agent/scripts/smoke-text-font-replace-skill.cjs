const fs = require('fs');
const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const {
  fastDeterministicRoute
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-orchestration', 'routing.ts'));
const {
  getSkillById
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'skills', 'skill-declarations.ts'));
const toolExecutor = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'tool-executor.service.ts'));
const {
  textFontReplaceExecutor
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'text-font-replace.executor.ts'));

const tmpDir = path.resolve(__dirname, '..', 'tmp');
fs.mkdirSync(tmpDir, { recursive: true });

const cases = [];

function record(name, passed, details) {
  cases.push({ name, status: passed ? 'pass' : 'fail', details });
}

async function withMockedToolExecutor(mock, fn) {
  const original = toolExecutor.executeToolCall;
  toolExecutor.executeToolCall = mock;
  try {
    return await fn();
  } finally {
    toolExecutor.executeToolCall = original;
  }
}

async function main() {
  const input = '帮我把字体全部改成思源黑体';
  const route = fastDeterministicRoute(input);
  record(
    'route-text-font-replace',
    route && route.skillId === 'text-font-replace' && route.skillParams && route.skillParams.fontName === '思源黑体',
    route
  );

  const skill = getSkillById('text-font-replace');
  record(
    'skill-declaration',
    !!skill && Array.isArray(skill.requiredTools) && skill.requiredTools.includes('getAllTextLayers') && skill.requiredTools.includes('setTextStyle'),
    skill
  );

  let successGetAllTextLayersCallCount = 0;
  let successSetTextStyleCallCount = 0;
  await withMockedToolExecutor(async (toolName, params) => {
    if (toolName === 'getAllTextLayers') {
      successGetAllTextLayersCallCount += 1;
      return {
        success: true,
        layers: [
          { id: 1, name: '标题', style: { fontName: successGetAllTextLayersCallCount === 1 ? '原字体' : '思源黑体' } },
          { id: 2, name: '副标题', style: { fontName: successGetAllTextLayersCallCount === 1 ? '原字体' : '思源黑体' } }
        ]
      };
    }
    if (toolName === 'setTextStyle') {
      successSetTextStyleCallCount += 1;
      return {
        success: true,
        verifiedFont: '思源黑体',
        resolvedFont: { name: '思源黑体', family: '思源黑体', postScriptName: 'SourceHanSansSC-Regular' },
        params
      };
    }
    return { success: false, error: `unexpected tool ${toolName}` };
  }, async () => {
    const result = await textFontReplaceExecutor.execute({
      params: { fontName: '思源黑体', includeHidden: false },
      callbacks: {},
      context: {}
    });
    record(
      'executor-success-requires-verified-fonts',
      result.success === true && result.message.includes('2 个文本图层'),
      result
    );
    record(
      'executor-uses-controlled-text-style-plan',
      result.success === true
        && successSetTextStyleCallCount === 2
        && result.data?.controlledTextStyleBatch?.plan?.status === 'ready_dry_run'
        && result.data?.controlledTextStyleBatch?.toolCallPlan?.status === 'ready_tool_call_plan'
        && result.data?.controlledTextStyleBatch?.execution?.status === 'completed_needs_verification'
        && result.data?.controlledTextStyleBatch?.benchmark?.canClaimDesignQuality === false,
      result.data?.controlledTextStyleBatch
    );
  });

  let partialFailureSetTextStyleCallCount = 0;
  await withMockedToolExecutor(async (toolName, params) => {
    if (toolName === 'getAllTextLayers') {
      return {
        success: true,
        layers: [
          { id: 1, name: '锁定标题', style: { fontName: '原字体' } },
          { id: 2, name: '副标题', style: { fontName: '思源黑体' } }
        ]
      };
    }
    if (toolName === 'setTextStyle') {
      partialFailureSetTextStyleCallCount += 1;
      if (Number(params.layerId) === 1) {
        return { success: false, error: 'layer is locked', params };
      }
      return {
        success: true,
        verifiedFont: '思源黑体',
        resolvedFont: { name: '思源黑体', family: '思源黑体', postScriptName: 'SourceHanSansSC-Regular' },
        params
      };
    }
    return { success: false, error: `unexpected tool ${toolName}` };
  }, async () => {
    const result = await textFontReplaceExecutor.execute({
      params: { fontName: '思源黑体', includeHidden: false },
      callbacks: {},
      context: {}
    });
    record(
      'executor-partial-tool-failure-still-attempts-remaining-layers',
      result.success === false
        && partialFailureSetTextStyleCallCount === 2
        && result.data?.controlledTextStyleBatch?.execution?.status === 'failed_tool_call'
        && result.data?.failures?.some((item) => item.layerId === 1),
      {
        partialFailureSetTextStyleCallCount,
        result
      }
    );
  });

  let getAllTextLayersCallCount = 0;
  await withMockedToolExecutor(async (toolName, params) => {
    if (toolName === 'getAllTextLayers') {
      getAllTextLayersCallCount += 1;
      if (getAllTextLayersCallCount === 1) {
        return {
          success: true,
          layers: [
            { id: 1, name: '标题', style: { fontName: '原字体' } },
            { id: 2, name: '副标题', style: { fontName: '原字体' } }
          ]
        };
      }
      return {
        success: true,
        layers: [
          { id: 1, name: '标题', style: { fontName: '思源黑体' } },
          { id: 2, name: '副标题', style: { fontName: '原字体' } }
        ]
      };
    }
    if (toolName === 'setTextStyle') {
      return {
        success: true,
        verifiedFont: '思源黑体',
        resolvedFont: { name: '思源黑体', family: '思源黑体', postScriptName: 'SourceHanSansSC-Regular' },
        params
      };
    }
    return { success: false, error: `unexpected tool ${toolName}` };
  }, async () => {
    const result = await textFontReplaceExecutor.execute({
      params: { fontName: '思源黑体', includeHidden: false },
      callbacks: {},
      context: {}
    });
    record(
      'executor-final-mismatch-is-not-success',
      result.success === false
        && result.message.includes('字体替换未完全成功')
        && result.data?.failures?.some((item) => item.layerId === 2),
      result
    );
  });
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

  const jsonPath = path.join(tmpDir, 'text-font-replace-skill-smoke.json');
  const mdPath = path.join(tmpDir, 'text-font-replace-skill-smoke.md');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(
    mdPath,
    [
      '# Text Font Replace Skill Smoke',
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
