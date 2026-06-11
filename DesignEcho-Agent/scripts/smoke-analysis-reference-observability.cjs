const fs = require('fs');
const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const {
  getSkillById
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'skills', 'skill-declarations.ts'));
const toolExecutor = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'tool-executor.service.ts'));
const {
  designReferenceSearchExecutor
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'design-reference-search.executor.ts'));
const {
  visualAnalysisExecutor
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'visual-analysis.executor.ts'));

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

function stepTitles(steps) {
  return steps.map((step) => String(step.title || ''));
}

function installWindowBridge() {
  global.window = {
    designEcho: {
      invoke: async (channel) => {
        if (channel === 'visual:analyzeBase64Image' || channel === 'visual:analyzeLocalImage') {
          return {
            success: true,
            data: {
              style: '简洁商品风',
              composition: '居中构图',
              colorPalette: ['#ffffff', '#111111'],
              elements: ['标题', '产品图', '辅助文案'],
              suggestions: ['加强层级', '保留留白']
            }
          };
        }
        return { success: false, error: `unexpected channel ${channel}` };
      }
    }
  };
}

async function runDesignReferenceCases() {
  const skill = getSkillById('design-reference-search');
  record(
    'design-reference-skill-declaration',
    !!skill
      && skill.visibility === 'user-facing'
      && Array.isArray(skill.requiredTools)
      && skill.requiredTools.includes('searchDesigns')
      && skill.requiredTools.includes('fetchWebPageDesignContent'),
    skill
  );

  const searchSteps = [];
  await withMockedToolExecutor(async (toolName, params) => {
    if (toolName !== 'searchDesigns') return { success: false, error: `unexpected tool ${toolName}` };
    return {
      success: true,
      total: 2,
      results: [
        { title: '袜子详情页参考', url: 'https://example.com/a', platform: params.platform },
        { title: '针织材质排版', url: 'https://example.com/b', platform: params.platform }
      ]
    };
  }, async () => {
    const result = await designReferenceSearchExecutor.execute({
      params: { mode: 'search', query: '袜子 详情页', platform: 'all', limit: 2 },
      callbacks: {
        onStep: (step) => searchSteps.push(step)
      },
      context: {}
    });
    const titles = stepTitles(searchSteps);
    record(
      'design-reference-search-observable-steps',
      result.success === true
        && titles.includes('准备设计参考检索')
        && titles.includes('调用 Photoshop 工具：searchDesigns')
        && titles.includes('Photoshop 工具完成：searchDesigns')
        && titles.includes('设计参考检索完成')
        && Array.isArray(result.data?.knowledgeResults)
        && result.data.knowledgeResults.length === 2
        && result.data.knowledgeResults.every((item) => item.sourceType === 'design_crawler')
        && result.data.knowledgeResults.every((item) => !item.allowedUses.includes('direct_photoshop_action')),
      { result, titles }
    );
  });

  const fetchSteps = [];
  await withMockedToolExecutor(async (toolName, params) => {
    if (toolName !== 'fetchWebPageDesignContent') return { success: false, error: `unexpected tool ${toolName}` };
    return {
      success: true,
      title: '袜子详情页网页参考',
      description: '页面描述用于参考，不直接执行 Photoshop。',
      textContent: `参考 URL: ${params.url}\n强调材质、版式和卖点层级。`,
      images: [{ src: 'https://example.com/a.jpg' }]
    };
  }, async () => {
    const result = await designReferenceSearchExecutor.execute({
      params: { mode: 'fetchUrl', url: 'https://example.com/detail-reference', extractImages: true },
      callbacks: {
        onStep: (step) => fetchSteps.push(step)
      },
      context: {}
    });
    const titles = stepTitles(fetchSteps);
    record(
      'design-reference-fetch-url-knowledge-results',
      result.success === true
        && titles.includes('网页设计内容已获取')
        && Array.isArray(result.data?.knowledgeResults)
        && result.data.knowledgeResults.length === 1
        && result.data.knowledgeResults[0].sourceType === 'web_page'
        && result.data.knowledgeResults[0].sourceUrl === 'https://example.com/detail-reference'
        && !result.data.knowledgeResults[0].allowedUses.includes('direct_photoshop_action'),
      { result, titles }
    );
  });

  const missingQuerySteps = [];
  const missingQuery = await designReferenceSearchExecutor.execute({
    params: { mode: 'search' },
    callbacks: {
      onStep: (step) => missingQuerySteps.push(step)
    },
    context: {}
  });
  record(
    'design-reference-missing-query-is-observable',
    missingQuery.success === false
      && stepTitles(missingQuerySteps).includes('设计参考检索未开始')
      && missingQuerySteps.some((step) => step.status === 'error' && String(step.issue || '').includes('Query is required')),
    { result: missingQuery, titles: stepTitles(missingQuerySteps), missingQuerySteps }
  );
}

async function runVisualAnalysisCases() {
  const skill = getSkillById('visual-analysis');
  record(
    'visual-analysis-skill-declaration',
    !!skill
      && skill.visibility === 'user-facing'
      && Array.isArray(skill.requiredTools)
      && skill.requiredTools.includes('getCanvasSnapshot')
      && skill.requiredTools.includes('visual:analyzeBase64Image'),
    skill
  );

  installWindowBridge();
  const activeDocSteps = [];
  await withMockedToolExecutor(async (toolName) => {
    if (toolName !== 'getCanvasSnapshot') return { success: false, error: `unexpected tool ${toolName}` };
    return {
      success: true,
      snapshot: {
        base64: 'iVBORw0KGgo=',
        width: 800,
        height: 800
      }
    };
  }, async () => {
    const result = await visualAnalysisExecutor.execute({
      params: { sourceType: 'active_document', analysisFocus: 'layout' },
      callbacks: {
        onStep: (step) => activeDocSteps.push(step)
      },
      context: {}
    });
    const titles = stepTitles(activeDocSteps);
    record(
      'visual-analysis-active-document-observable-steps',
      result.success === true
        && titles.includes('准备视觉分析')
        && titles.includes('调用 Photoshop 工具：getCanvasSnapshot')
        && titles.includes('Photoshop 工具完成：getCanvasSnapshot')
        && titles.includes('调用视觉模型分析画布')
        && titles.includes('画布视觉分析完成')
        && titles.includes('视觉分析报告已生成'),
      { result, titles }
    );
  });

  const missingPathSteps = [];
  const missingPath = await visualAnalysisExecutor.execute({
    params: { sourceType: 'local_file' },
    callbacks: {
      onStep: (step) => missingPathSteps.push(step)
    },
    context: {}
  });
  record(
    'visual-analysis-missing-file-is-observable',
    missingPath.success === false
      && stepTitles(missingPathSteps).includes('视觉分析未开始')
      && missingPathSteps.some((step) => step.status === 'error' && String(step.issue || '').includes('File path is required')),
    { result: missingPath, titles: stepTitles(missingPathSteps), missingPathSteps }
  );
}

async function main() {
  await runDesignReferenceCases();
  await runVisualAnalysisCases();
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

  const tmpDir = path.resolve(__dirname, '..', 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const jsonPath = path.join(tmpDir, 'analysis-reference-observability-smoke.json');
  const mdPath = path.join(tmpDir, 'analysis-reference-observability-smoke.md');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(
    mdPath,
    [
      '# Analysis And Reference Observability Smoke',
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
