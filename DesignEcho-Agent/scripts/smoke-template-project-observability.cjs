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
  useAppStore
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'stores', 'app.store.ts'));
const {
  templateSaveExecutor
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'template-save.executor.ts'));
const {
  projectImageAnalysisExecutor
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'project-image-analysis.executor.ts'));

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

function installWindowBridge(overrides = {}) {
  global.window = {
    designEcho: {
      getProjectRoot: async () => 'C:/UXP/DesignEchoProject',
      invoke: async (channel, ...args) => {
        if (channel === 'state:setPersistedValue' || channel === 'state:removePersistedValue') {
          return { success: true };
        }
        const payload = args[0] || {};
        return {
          id: 'template-1',
          name: String(payload?.documentName || '当前文档').replace(/\.[^.]+$/, ''),
          type: payload?.type || 'other'
        };
      },
      analyzeAssetContent: async (imagePath) => ({
        success: true,
        analysis: {
          description: `样本 ${path.basename(imagePath)}`,
          mainSubject: '袜子',
          colors: ['混色'],
          style: '基础商品拍摄',
          suggestedPlacement: '材质细节'
        }
      }),
      chat: async () => ({
        text: '1. 款式判断：袜子。\n2. 主要特征：混色与针织质感。\n3. 详情页可以怎么做：展示材质、袜口和上脚效果。\n4. 还缺什么信息：尺码和卖点。'
      }),
      ...overrides
    }
  };
}

async function runTemplateSaveCases() {
  const route = fastDeterministicRoute('帮我把当前文档保存为模板并加入设计库');
  record(
    'route-save-current-template',
    route && route.skillId === 'save-current-template',
    route
  );

  const skill = getSkillById('save-current-template');
  record(
    'template-save-skill-declaration',
    !!skill
      && skill.visibility === 'user-facing'
      && Array.isArray(skill.requiredTools)
      && skill.requiredTools.includes('listDocuments'),
    skill
  );

  installWindowBridge();
  const successSteps = [];
  await withMockedToolExecutor(async (toolName) => {
    if (toolName !== 'listDocuments') return { success: false, error: `unexpected tool ${toolName}` };
    return {
      success: true,
      documents: [
        {
          id: 7,
          name: '详情页模板.psd',
          path: 'C:/UXP/DesignEchoProject/templates/详情页模板.psd',
          isActive: true
        }
      ]
    };
  }, async () => {
    const result = await templateSaveExecutor.execute({
      params: { templateIntent: '详情页模板', tags: ['详情页'] },
      callbacks: {
        onStep: (step) => successSteps.push(step)
      },
      context: { userInput: '保存详情页模板' }
    });
    const titles = stepTitles(successSteps);
    record(
      'template-save-success-observable-steps',
      result.success === true
        && titles.includes('调用 Photoshop 工具：listDocuments')
        && titles.includes('Photoshop 工具完成：listDocuments')
        && titles.includes('确定模板保存上下文')
        && titles.includes('识别模板类型')
        && titles.includes('写入模板库')
        && titles.includes('模板已保存'),
      { result, titles }
    );
  });

  const failedSteps = [];
  await withMockedToolExecutor(async () => ({ success: true, documents: [] }), async () => {
    const result = await templateSaveExecutor.execute({
      params: {},
      callbacks: {
        onStep: (step) => failedSteps.push(step)
      },
      context: {}
    });
    const titles = stepTitles(failedSteps);
    record(
      'template-save-no-document-is-observable',
      result.success === false
        && titles.includes('未找到可保存文档')
        && failedSteps.some((step) => step.status === 'error' && String(step.issue || '').includes('No active Photoshop document')),
      { result, titles, failedSteps }
    );
  });
}

async function runProjectImageAnalysisCases() {
  const route = fastDeterministicRoute('理解一下项目中的图片，分析款式特征和详情页方向');
  record(
    'route-project-image-analysis',
    route && route.skillId === 'project-image-analysis',
    route
  );

  const inventoryRoute = fastDeterministicRoute('你可以帮我看看这个项目都有什么');
  record(
    'route-project-inventory-overview-stays-fast',
    inventoryRoute
      && inventoryRoute.skillId === 'project-image-analysis'
      && inventoryRoute.skillParams?.analysisMode === 'inventory'
      && inventoryRoute.skillParams?.sampleSize === 0,
    inventoryRoute
  );

  const skill = getSkillById('project-image-analysis');
  record(
    'project-image-analysis-skill-declaration',
    !!skill
      && skill.visibility === 'user-facing'
      && Array.isArray(skill.requiredTools)
      && skill.requiredTools.includes('analyzeAssetContent'),
    skill
  );

  installWindowBridge();
  useAppStore.setState({
    ecommerceStructure: {
      summary: { totalImages: 2 },
      folders: [
        {
          type: 'source',
          images: [
            { path: 'C:/Project/原图/BK9A7874.jpg', relativePath: '原图/BK9A7874.jpg', name: 'BK9A7874.jpg', type: 'product' },
            { path: 'C:/Project/原图/BK9A7875.jpg', relativePath: '原图/BK9A7875.jpg', name: 'BK9A7875.jpg', type: 'detail' }
          ]
        }
      ]
    }
  });

  const successSteps = [];
  const result = await projectImageAnalysisExecutor.execute({
    params: { sampleSize: 2, focus: 'style-and-detail-page' },
    callbacks: {
      onStep: (step) => successSteps.push(step)
    },
    context: {
      userInput: '理解项目图片',
      projectContext: {
        projectPath: 'C:/Project',
        projectImageCount: 2,
        sampleImagePaths: ['C:/Project/原图/BK9A7874.jpg']
      }
    }
  });
  const titles = stepTitles(successSteps);
  record(
    'project-image-analysis-success-observable-steps',
    result.success === true
      && result.data?.analyzedSampleCount === 2
      && titles.includes('读取项目图片上下文')
      && titles.includes('选择分析样本')
      && titles.includes('分析图片样本 1/2')
      && titles.includes('图片样本已分析 1/2')
      && titles.includes('汇总图片分析结果')
      && titles.includes('项目图片分析完成'),
    { result, titles }
  );

  let inventoryAnalyzeCallCount = 0;
  installWindowBridge({
    analyzeAssetContent: async () => {
      inventoryAnalyzeCallCount += 1;
      return { success: false, error: 'inventory overview must not call analyzeAssetContent' };
    }
  });
  useAppStore.setState({
    ecommerceStructure: {
      summary: { totalImages: 3 },
      folders: [
        {
          type: 'source',
          name: '原图',
          images: [
            { path: 'C:/Project/原图/a.jpg', relativePath: '原图/a.jpg', name: 'a.jpg', type: 'product' },
            { path: 'C:/Project/原图/b.jpg', relativePath: '原图/b.jpg', name: 'b.jpg', type: 'detail' }
          ],
          children: [
            {
              type: 'sku',
              name: 'SKU',
              images: [
                { path: 'C:/Project/SKU/sku.psd', relativePath: 'SKU/sku.psd', name: 'sku.psd', type: 'psd' }
              ]
            }
          ]
        }
      ]
    }
  });
  const inventorySteps = [];
  const inventoryResult = await projectImageAnalysisExecutor.execute({
    params: inventoryRoute.skillParams,
    callbacks: {
      onStep: (step) => inventorySteps.push(step)
    },
    context: {
      userInput: '你可以帮我看看这个项目都有什么',
      projectContext: {
        projectPath: 'C:/Project',
        projectImageCount: 3
      }
    }
  });
  const inventoryTitles = stepTitles(inventorySteps);
  record(
    'project-inventory-overview-does-not-call-visual-analysis',
    inventoryResult.success === true
      && inventoryResult.data?.analysisMode === 'inventory'
      && inventoryResult.data?.analyzedSampleCount === 0
      && inventoryAnalyzeCallCount === 0
      && inventoryTitles.includes('读取项目资源索引')
      && inventoryTitles.includes('项目资源概览完成')
      && !inventoryTitles.some((title) => title.includes('分析图片样本'))
      && String(inventoryResult.message || '').includes('项目资源概览'),
    { inventoryResult, inventoryAnalyzeCallCount, inventoryTitles }
  );

  const failedSteps = [];
  const noProject = await projectImageAnalysisExecutor.execute({
    params: {},
    callbacks: {
      onStep: (step) => failedSteps.push(step)
    },
    context: {}
  });
  record(
    'project-image-analysis-missing-project-is-observable',
    noProject.success === false
      && stepTitles(failedSteps).includes('项目图片分析未开始')
      && failedSteps.some((step) => step.status === 'error' && String(step.issue || '').includes('Missing project context')),
    { result: noProject, titles: stepTitles(failedSteps), failedSteps }
  );
}

async function main() {
  await runTemplateSaveCases();
  await runProjectImageAnalysisCases();
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
  const jsonPath = path.join(tmpDir, 'template-project-observability-smoke.json');
  const mdPath = path.join(tmpDir, 'template-project-observability-smoke.md');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(
    mdPath,
    [
      '# Template And Project Image Observability Smoke',
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
