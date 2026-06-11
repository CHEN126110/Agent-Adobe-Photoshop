const fs = require('fs');
const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const taskClassifier = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-orchestration', 'task-classifier.ts'));
const routing = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-orchestration', 'routing.ts'));
const conversational = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-orchestration', 'conversational.ts'));
const skillExecutors = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'index.ts'));
const { DesignAgentEngine } = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'design-agent', 'engine.ts'));
const {
  normalizeSkillId,
  findSkillRoutingIntent,
  matchesSkillRoutingIntent,
  resolveSkillRoutingMode,
  extractDocumentManagementRoutingParams
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'skill-routing.ts'));
const routeBoundaryPolicy = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-route-boundary-policy.ts'));

let intentControlPlane = null;
let intentControlPlaneLoadError = null;
try {
  intentControlPlane = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-intent-control-plane.ts'));
} catch (error) {
  intentControlPlaneLoadError = error;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeReport(payload) {
  const outDir = path.join(__dirname, '..', 'tmp');
  ensureDir(outDir);
  const jsonPath = path.join(outDir, 'agent-intent-engine-smoke.json');
  const mdPath = path.join(outDir, 'agent-intent-engine-smoke.md');
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');

  const lines = [
    '# Agent Intent Engine Smoke',
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

function createContext(userInput, overrides = {}) {
  const base = {
    userInput,
    conversationHistory: [],
    isPluginConnected: true,
    photoshopContext: {
      hasDocument: true,
      documentName: 'test.psd',
      activeLayerName: '图层 1',
      layerCount: 12
    },
    projectContext: {
      projectPath: 'C:/UXP/2.0/test-project',
      projectImageCount: 8,
      projectImageFolders: [],
      sampleImagePaths: []
    }
  };

  return {
    ...base,
    ...overrides,
    photoshopContext: {
      ...base.photoshopContext,
      ...(overrides.photoshopContext || {})
    },
    projectContext: {
      ...base.projectContext,
      ...(overrides.projectContext || {})
    }
  };
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sampleDesignDecision(goal = '生成 SKU 组合图并同步处理自选备注。') {
  return {
    designGoal: goal,
    productUnderstanding: ['SKU 任务需要准确表达颜色和规格组合。', '自选备注属于 SKU 交付的一部分，不是额外随机颜色组合。'],
    audience: '淘宝天猫袜子消费者',
    hierarchy: {
      primarySubject: 'SKU 商品颜色和规格信息',
      focalPoint: '颜色组合与规格备注的对应关系',
      informationPriority: ['颜色', '规格', '自选备注'],
      whitespaceIntent: '保留 SKU 名称和备注的清晰可读区域。',
      layoutNotes: ['组合信息优先，装饰退后。']
    },
    color: {
      paletteIntent: '沿用项目真实 SKU 颜色，不由代码猜测颜色。',
      primaryColors: ['#FFFFFF', '#111111'],
      accentColors: ['#2F6FED'],
      backgroundDirection: '保持干净背景，突出商品颜色。',
      contrastPlan: '文字与商品区域保持足够对比。',
      avoid: ['改变真实 SKU 颜色', '高饱和装饰抢主体']
    },
    typography: {
      tone: '清晰、直接、偏电商规格表达',
      hierarchy: ['SKU 名称', '规格', '自选备注'],
      fontDirection: '无衬线黑体，优先可读。',
      spacingDirection: '备注不挤压商品主体。',
      avoid: ['过小备注文字', '复杂字效']
    },
    retouch: {
      objectives: ['保持 SKU 商品边缘清晰', '校正素材轻微偏色'],
      colorCorrection: '只校正曝光和白平衡，不改变 SKU 真实颜色。',
      lighting: '保持统一光照。',
      cleanup: ['去除背景杂点'],
      fabricOrMaterialHandling: '保留袜子材质纹理。',
      prohibitedEdits: ['改变颜色', '抹掉纹理']
    },
    assetSelection: {
      selectionPrinciples: ['优先项目 SKU 文档和项目素材，不使用已打开但不属于项目的文档。'],
      requiredEvidence: ['项目素材索引', 'SKU 文件证据', '颜色图层证据'],
      rejectRules: ['拒绝不属于当前项目的打开文档。']
    },
    toolWorkflow: [
      { phase: 'inspect', goal: '读取项目 SKU 文件和素材证据。', allowedToolKinds: ['read-only'], requiredEvidence: ['project-context'] },
      { phase: 'analyze', goal: '确认颜色、规格和自选备注语义。', allowedToolKinds: ['read-only'], requiredEvidence: ['sku-evidence'] },
      { phase: 'compose', goal: '生成 SKU 组合和备注。', allowedToolKinds: ['photoshop-write'], requiredEvidence: ['design-plan'] },
      { phase: 'verify', goal: '检查导出结果与组合数量。', allowedToolKinds: ['readback'], requiredEvidence: ['result-summary'] }
    ],
    acceptanceCriteria: ['SKU 颜色和规格对应正确。', '自选备注已生成且文字可读。', '执行结果包含导出或结果状态证据。'],
    risks: ['不能把“自选备注”误解成额外颜色组合。'],
    rationale: ['先确认语义，再执行 SKU 工具。']
  };
}

async function run() {
  const cases = [];
  const engine = new DesignAgentEngine();

  const originalGetSkillExecutor = skillExecutors.getSkillExecutor;
  const originalExecuteSkillWithExecutor = skillExecutors.executeSkillWithExecutor;

  let executed = [];
  skillExecutors.getSkillExecutor = (skillId) => ({ id: skillId, execute: async () => ({ success: true }) });
  skillExecutors.executeSkillWithExecutor = async (skillId, payload) => {
    executed.push({ skillId, params: payload?.params || null });
    return { success: true, message: `executed:${skillId}` };
  };

  try {
    let capturedPrompt = '';
    await taskClassifier.classifyActionableIntent(
      createContext('帮我关闭文档不保存'),
      async (messages) => {
        capturedPrompt = String(messages?.[0]?.content || '');
        return {
          text: JSON.stringify({
            route: 'skill_execution',
            skillId: 'document-management',
            thinking: '这是文档关闭操作。',
            skillParams: { action: 'close', save: false }
          })
        };
      }
    );

    cases.push({
      name: 'classifier-prompt-uses-live-skill-registry',
      status:
        capturedPrompt.includes('Live skill registry summary:')
        && capturedPrompt.includes('- document-management [operation, user-facing]:')
        && capturedPrompt.includes('- detail-page-template-authoring [workflow, user-facing]:')
        && capturedPrompt.includes('intentSignals:')
        && capturedPrompt.includes('clarificationHints:')
        && !capturedPrompt.includes('"confidence": number')
        && !capturedPrompt.includes('"confidence"')
        && !capturedPrompt.includes('- matte-product [operation, user-facing]:')
        && !capturedPrompt.includes('- shape-morphing [operation, system-only]:')
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        hasRegistrySummary: capturedPrompt.includes('Live skill registry summary:'),
        hasDocumentSkill: capturedPrompt.includes('- document-management [operation, user-facing]:'),
        hasDetailTemplateSkill: capturedPrompt.includes('- detail-page-template-authoring [workflow, user-facing]:'),
        hasIntentSignals: capturedPrompt.includes('intentSignals:'),
        hasClarificationHints: capturedPrompt.includes('clarificationHints:'),
        requiresConfidence: capturedPrompt.includes('"confidence": number') || capturedPrompt.includes('"confidence"'),
        leaksMatteProduct: capturedPrompt.includes('- matte-product [operation, user-facing]:'),
        leaksShapeMorphing: capturedPrompt.includes('- shape-morphing [operation, system-only]:')
      })
    });

    const classifierSource = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-orchestration', 'task-classifier.ts'),
      'utf8'
    );
    const chatPanelSource = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'renderer', 'components', 'ChatPanel.tsx'),
      'utf8'
    );
    const appStoreSource = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'renderer', 'stores', 'app.store.ts'),
      'utf8'
    );
    const engineSource = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'design-agent', 'engine.ts'),
      'utf8'
    );

    cases.push({
      name: 'router-model-call-is-silent-and-non-streaming',
      status:
        classifierSource.includes("purpose: 'router'")
        && classifierSource.includes('silent: true')
        && classifierSource.includes('stream: false')
        && chatPanelSource.includes('const isRouterCall =')
        && chatPanelSource.includes("options?.purpose === 'router'")
        && chatPanelSource.includes('!isRouterCall && canUsePlainTextProviderStream')
        && chatPanelSource.includes('hasAttachedImage && !isRouterCall && !isVisibleReasoningCall')
        && chatPanelSource.includes("isRouterCall || isVisibleReasoningCall")
        && chatPanelSource.includes('const streamHasAttachedImage = isVisibleReasoningCall ? false : hasAttachedImage;')
        && classifierSource.includes('Return strict JSON only.')
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        classifierMarksRouter: classifierSource.includes("purpose: 'router'"),
        classifierSilent: classifierSource.includes('silent: true'),
        classifierNonStreaming: classifierSource.includes('stream: false'),
        chatPanelHasRouterGuard: chatPanelSource.includes('const isRouterCall ='),
        streamGuarded: chatPanelSource.includes('!isRouterCall && canUsePlainTextProviderStream'),
        imageInjectionGuarded: chatPanelSource.includes('hasAttachedImage && !isRouterCall && !isVisibleReasoningCall'),
        visibleReasoningUsesLogicTask: chatPanelSource.includes("isRouterCall || isVisibleReasoningCall"),
        visibleReasoningStreamTextOnly: chatPanelSource.includes('const streamHasAttachedImage = isVisibleReasoningCall ? false : hasAttachedImage;'),
        classifierIsJsonOnly: classifierSource.includes('Return strict JSON only.')
      })
    });

    const controlPlaneSource = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'shared', 'agent-intent-control-plane.ts'),
      'utf8'
    );
    const lifecycleSource = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'shared', 'agent-request-lifecycle.ts'),
      'utf8'
    );
    cases.push({
      name: 'agent-decision-chain-does-not-use-ungrounded-confidence',
      status:
        !controlPlaneSource.includes('confidence:')
        && !controlPlaneSource.includes('.confidence')
        && !classifierSource.includes('"confidence": number')
        && !classifierSource.includes('clampConfidence')
        && !engineSource.includes('intentControlPlane.confidence')
        && !engineSource.includes('modelDecision.confidence >=')
        && !engineSource.includes('置信度')
        && !lifecycleSource.includes('decision: {\n            source: input.routeSource,\n            route: input.route,\n            skillId: normalizeText(input.skillId) || undefined,\n            mode: normalizeText(input.mode) || undefined,\n            confidence')
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        controlPlaneHasConfidence: controlPlaneSource.includes('confidence:') || controlPlaneSource.includes('.confidence'),
        classifierRequiresConfidence: classifierSource.includes('"confidence": number') || classifierSource.includes('clampConfidence'),
        engineUsesControlPlaneConfidence: engineSource.includes('intentControlPlane.confidence'),
        engineUsesModelConfidenceThreshold: engineSource.includes('modelDecision.confidence >='),
        engineUserCopyMentionsConfidence: engineSource.includes('置信度'),
        lifecycleDecisionHasConfidence: lifecycleSource.includes('decision: {\n            source: input.routeSource,\n            route: input.route,\n            skillId: normalizeText(input.skillId) || undefined,\n            mode: normalizeText(input.mode) || undefined,\n            confidence')
      })
    });

    const visibleReasoningIndex = engineSource.indexOf('requestInitialVisibleIntentPreview(context, callModel, callbacks)');
    const documentPreflightIndex = engineSource.indexOf('const documentStructureRouteOptions = await buildCurrentDocumentStructureRouteOptions(context);');
    cases.push({
      name: 'visible-reasoning-is-requested-before-photoshop-document-preflight',
      status:
        visibleReasoningIndex >= 0
        && documentPreflightIndex >= 0
        && visibleReasoningIndex < documentPreflightIndex
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        visibleReasoningIndex,
        documentPreflightIndex
      })
    });

    cases.push({
      name: 'request-lifecycle-is-persisted-as-hidden-message-metadata',
      status:
        appStoreSource.includes('agentRequestLifecycle?: AgentRequestLifecycleEvidence')
        && chatPanelSource.includes('agentRequestLifecycle?: AgentRequestLifecycleEvidence')
        && chatPanelSource.includes('data?.agentRequestLifecycle')
        && chatPanelSource.includes('agentRequestLifecycle: options?.agentRequestLifecycle')
        && !chatPanelSource.includes("type: 'thinking',\n                                    content: agentRequestLifecycle")
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        storeMessageField: appStoreSource.includes('agentRequestLifecycle?: AgentRequestLifecycleEvidence'),
        chatPanelOptionsField: chatPanelSource.includes('agentRequestLifecycle?: AgentRequestLifecycleEvidence'),
        extractsLifecycle: chatPanelSource.includes('data?.agentRequestLifecycle'),
        persistsLifecycle: chatPanelSource.includes('agentRequestLifecycle: options?.agentRequestLifecycle')
      })
    });

    cases.push({
      name: 'skill-id-normalization-uses-shared-helper',
      status:
        normalizeSkillId('document') === 'document-management'
        && normalizeSkillId('template-save') === 'save-current-template'
        && normalizeSkillId('agent-panel') === 'agent-panel-bridge'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        document: normalizeSkillId('document'),
        templateSave: normalizeSkillId('template-save'),
        agentPanel: normalizeSkillId('agent-panel')
      })
    });

    cases.push({
      name: 'infer-skill-hint-shares-deterministic-matching',
      status:
        routing.inferSkillHint('帮我抠图') === undefined
        && routing.inferSkillHint('帮我做2-3-4的自选备注') === 'sku-batch'
        && routing.inferSkillHint('帮我把当前文档保存为模板') === 'save-current-template'
        && routing.inferSkillHint('参考图照着做生成同款版式') === 'layout-replication'
        && routing.inferSkillHint('帮我和面板一起调试详情页文案溢出') === 'agent-panel-bridge'
        && routing.inferSkillHint('帮我做转化图 在Adobe Photoshop文档中有800文档') === 'main-image-design'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        matte: routing.inferSkillHint('帮我抠图'),
        skuNotes: routing.inferSkillHint('帮我做2-3-4的自选备注'),
        saveTemplate: routing.inferSkillHint('帮我把当前文档保存为模板'),
        layoutReplication: routing.inferSkillHint('参考图照着做生成同款版式'),
        debugBridge: routing.inferSkillHint('帮我和面板一起调试详情页文案溢出'),
        mainImageConversion: routing.inferSkillHint('帮我做转化图 在Adobe Photoshop文档中有800文档')
      })
    });

    const skuComboRoute = routing.fastDeterministicRoute('帮我做4双的SKU组合，需要3个');
    const skuSingleNoteRoute = routing.fastDeterministicRoute('帮我做单双装自选备注');
    const skuMultiNoteRoute = routing.fastDeterministicRoute('帮我做2-3-4的自选备注');
    const attachedReferenceReplicationRoute = routing.fastDeterministicRoute(
      '在我们创建的文档中 帮我复刻其中的内容',
      { hasAttachedImage: true }
    );
    const ambiguousNoImageReplicationRoute = routing.fastDeterministicRoute(
      '在我们创建的文档中 帮我复刻其中的内容'
    );
    cases.push({
      name: 'sku-deterministic-route-extracts-size-count-and-note-policy',
      status:
        skuComboRoute?.skillId === 'sku-batch'
        && sameJson(skuComboRoute.skillParams.comboSizes, [4])
        && skuComboRoute.skillParams.countPerSize === 3
        && skuComboRoute.skillParams.generateNotes === true
        && skuSingleNoteRoute?.skillId === 'sku-batch'
        && skuSingleNoteRoute.skillParams.onlyNotes === true
        && sameJson(skuSingleNoteRoute.skillParams.comboSizes, [1])
        && skuSingleNoteRoute.skillParams.generateNotes === true
        && skuMultiNoteRoute?.skillId === 'sku-batch'
        && skuMultiNoteRoute.skillParams.onlyNotes === true
        && sameJson(skuMultiNoteRoute.skillParams.comboSizes, [2, 3, 4])
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        skuCombo: skuComboRoute,
        skuSingleNote: skuSingleNoteRoute,
        skuMultiNote: skuMultiNoteRoute
      })
    });

    cases.push({
      name: 'attached-image-replication-wording-routes-to-layout-replication',
      status:
        attachedReferenceReplicationRoute?.skillId === 'layout-replication'
        && attachedReferenceReplicationRoute.skillParams?.outputMode === 'apply'
        && attachedReferenceReplicationRoute.skillParams?.autoCreateDocument === true
        && attachedReferenceReplicationRoute.skillParams?.preserveReferenceCanvasSize === true
        && ambiguousNoImageReplicationRoute === null
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        attachedReferenceReplicationRoute,
        ambiguousNoImageReplicationRoute
      })
    });

    const simpleShortPathAllowed = [
      'document-management',
      'layer-management',
      'text-font-replace'
    ].map((skillId) => routeBoundaryPolicy.evaluateSimpleDeterministicRouteBoundary({
      skillId,
      hasVisibleModelReasoning: true,
      hasContextImage: false
    }));
    const simpleShortPathDenied = [
      'sku-batch',
      'main-image-design',
      'main-image-template-authoring',
      'detail-page-design',
      'detail-page-template-authoring',
      'layout-replication',
      'ecommerce-socks-design',
      'project-image-analysis',
      'autonomous-agent'
    ].map((skillId) => routeBoundaryPolicy.evaluateSimpleDeterministicRouteBoundary({
      skillId,
      hasVisibleModelReasoning: true,
      hasContextImage: false
    }));
    const shortPathNoVisibleReasoning = routeBoundaryPolicy.evaluateSimpleDeterministicRouteBoundary({
      skillId: 'document-management',
      hasVisibleModelReasoning: false,
      hasContextImage: false
    });
    const shortPathWithImage = routeBoundaryPolicy.evaluateSimpleDeterministicRouteBoundary({
      skillId: 'document-management',
      hasVisibleModelReasoning: true,
      hasContextImage: true
    });
    cases.push({
      name: 'route-boundary-policy-keeps-short-path-mechanical-only',
      status:
        simpleShortPathAllowed.every((item) => item.allowed && item.category === 'simple_mechanical_operation')
        && simpleShortPathDenied.every((item) => !item.allowed && item.category === 'business_or_open_design')
        && !shortPathNoVisibleReasoning.allowed
        && shortPathNoVisibleReasoning.category === 'insufficient_context'
        && !shortPathWithImage.allowed
        && shortPathWithImage.category === 'business_or_open_design'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        simpleShortPathAllowed,
        simpleShortPathDenied,
        shortPathNoVisibleReasoning,
        shortPathWithImage
      })
    });

    const documentVeto = routeBoundaryPolicy.evaluateDeterministicRouteVeto({
      deterministicSkillId: 'document-management',
      modelSkillId: 'detail-page-design',
      isDocumentManagementIntent: true
    });
    const layoutVeto = routeBoundaryPolicy.evaluateDeterministicRouteVeto({
      deterministicSkillId: 'layout-replication',
      modelSkillId: 'main-image-design',
      isLayoutReplicationIntent: true
    });
    const detailTemplateVeto = routeBoundaryPolicy.evaluateDeterministicRouteVeto({
      deterministicSkillId: 'detail-page-template-authoring',
      modelSkillId: 'detail-page-design',
      isDetailTemplateAuthoringIntent: true
    });
    const mainTemplateVeto = routeBoundaryPolicy.evaluateDeterministicRouteVeto({
      deterministicSkillId: 'main-image-template-authoring',
      modelSkillId: 'main-image-design',
      isMainImageTemplateAuthoringIntent: true
    });
    const retryVeto = routeBoundaryPolicy.evaluateDeterministicRouteVeto({
      deterministicSkillId: 'text-font-replace',
      modelSkillId: 'agent-panel-bridge',
      isRetryRoute: true
    });
    const skuVeto = routeBoundaryPolicy.evaluateDeterministicRouteVeto({
      deterministicSkillId: 'sku-batch',
      modelSkillId: 'main-image-design',
      isSkuIntent: true
    });
    const modelOverrideAllowed = routeBoundaryPolicy.evaluateDeterministicRouteVeto({
      deterministicSkillId: 'sku-batch',
      modelSkillId: 'ecommerce-socks-design',
      isSkuIntent: true
    });
    cases.push({
      name: 'route-boundary-policy-protects-only-critical-deterministic-routes',
      status:
        documentVeto.allowed
        && layoutVeto.allowed
        && detailTemplateVeto.allowed
        && mainTemplateVeto.allowed
        && retryVeto.allowed
        && skuVeto.allowed
        && !modelOverrideAllowed.allowed
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        documentVeto,
        layoutVeto,
        detailTemplateVeto,
        mainTemplateVeto,
        retryVeto,
        skuVeto,
        modelOverrideAllowed
      })
    });


    cases.push({
      name: 'shared-skill-signal-matcher-supports-core-routes',
      status:
        matchesSkillRoutingIntent('save-current-template', '帮我把当前文档加入模板库')
        && matchesSkillRoutingIntent('detail-page-template-authoring', '帮我从零做一个详情页模板')
        && matchesSkillRoutingIntent('main-image-template-authoring', '帮我从零做一个主图模板')
        && matchesSkillRoutingIntent('text-font-replace', '帮我把字体全部改成思源黑体')
        && matchesSkillRoutingIntent('layout-replication', '参考图照着做生成同款版式')
        && matchesSkillRoutingIntent('project-image-analysis', '理解一下项目中的图片，看看这款是什么款式，有哪些特征，后续详情页可以怎么做')
        && matchesSkillRoutingIntent('document-management', '帮我把详情页文档保存到项目的PSD中')
        && matchesSkillRoutingIntent('document-management', '帮我把详情页文档导出成PNG')
        && matchesSkillRoutingIntent('main-image-design', '帮我做转化图 在Adobe Photoshop文档中有800文档')
        && findSkillRoutingIntent('帮我做转化图 在Adobe Photoshop文档中有800文档')?.skillId === 'main-image-design'
        && !matchesSkillRoutingIntent('detail-page-design', '帮我把详情页文档导出成PNG')
        && !matchesSkillRoutingIntent('project-image-analysis', '分析一下这个款式有什么特征')
        && !matchesSkillRoutingIntent('project-image-analysis', '帮我分析上传图片的构图')
        && !matchesSkillRoutingIntent('agent-panel-bridge', '帮我关闭文档不保存')
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        saveTemplate: matchesSkillRoutingIntent('save-current-template', '帮我把当前文档加入模板库'),
        detailTemplate: matchesSkillRoutingIntent('detail-page-template-authoring', '帮我从零做一个详情页模板'),
        mainTemplate: matchesSkillRoutingIntent('main-image-template-authoring', '帮我从零做一个主图模板'),
        textFont: matchesSkillRoutingIntent('text-font-replace', '帮我把字体全部改成思源黑体'),
        layoutReplication: matchesSkillRoutingIntent('layout-replication', '参考图照着做生成同款版式'),
        projectImageAnalysis: matchesSkillRoutingIntent('project-image-analysis', '理解一下项目中的图片，看看这款是什么款式，有哪些特征，后续详情页可以怎么做'),
        documentSave: matchesSkillRoutingIntent('document-management', '帮我把详情页文档保存到项目的PSD中'),
        documentExport: matchesSkillRoutingIntent('document-management', '帮我把详情页文档导出成PNG'),
        mainImageConversion: matchesSkillRoutingIntent('main-image-design', '帮我做转化图 在Adobe Photoshop文档中有800文档'),
        sharedRoutingMatch: findSkillRoutingIntent('帮我做转化图 在Adobe Photoshop文档中有800文档'),
        detailExportHijack: matchesSkillRoutingIntent('detail-page-design', '帮我把详情页文档导出成PNG'),
        genericStyleQuestion: matchesSkillRoutingIntent('project-image-analysis', '分析一下这个款式有什么特征'),
        singleImageVisualAnalysis: matchesSkillRoutingIntent('project-image-analysis', '帮我分析上传图片的构图'),
        bridgeNegative: matchesSkillRoutingIntent('agent-panel-bridge', '帮我关闭文档不保存')
      })
    });

    cases.push({
      name: 'project-overview-phrasing-routes-to-project-image-analysis',
      status:
        matchesSkillRoutingIntent('project-image-analysis', '帮我看看当前是个什么项目')
        && matchesSkillRoutingIntent('project-image-analysis', '帮我看看当前是什么项目')
        && matchesSkillRoutingIntent('project-image-analysis', '当前是什么项目')
        && matchesSkillRoutingIntent('project-image-analysis', '你可以帮我看看这个项目都有什么')
        && matchesSkillRoutingIntent('project-image-analysis', '这个项目都有些什么')
        && matchesSkillRoutingIntent('project-image-analysis', '你可以帮我看看这个项目都有些什么')
        && matchesSkillRoutingIntent('project-image-analysis', '帮我看看当前项目图片是什么款式')
        && matchesSkillRoutingIntent('project-image-analysis', '你能看看这些图片是什么 你能描述一下吗 并总结一下内容')
        && findSkillRoutingIntent('帮我看看当前是个什么项目')?.skillId === 'project-image-analysis'
        && routing.detectLightweightIntent('当前是什么项目') === 'none'
        && routing.fastDeterministicRoute('当前是什么项目')?.skillId === 'project-image-analysis'
        && routing.fastDeterministicRoute('当前是什么项目')?.skillParams?.analysisMode === 'content'
        && routing.detectLightweightIntent('帮我看看当前是个什么项目') === 'none'
        && routing.fastDeterministicRoute('帮我看看当前是个什么项目')?.skillId === 'project-image-analysis'
        && routing.fastDeterministicRoute('你可以帮我看看这个项目都有什么')?.skillId === 'project-image-analysis'
        && routing.fastDeterministicRoute('你可以帮我看看这个项目都有什么')?.skillParams?.analysisMode === 'inventory'
        && routing.fastDeterministicRoute('你可以帮我看看这个项目都有什么')?.skillParams?.sampleSize === 0
        && routing.fastDeterministicRoute('这个项目都有些什么')?.skillId === 'project-image-analysis'
        && routing.fastDeterministicRoute('这个项目都有些什么')?.skillParams?.analysisMode === 'inventory'
        && routing.fastDeterministicRoute('这个项目都有些什么')?.skillParams?.sampleSize === 0
        && routing.fastDeterministicRoute('你可以帮我看看这个项目都有些什么')?.skillId === 'project-image-analysis'
        && routing.fastDeterministicRoute('你可以帮我看看这个项目都有些什么')?.skillParams?.analysisMode === 'inventory'
        && routing.fastDeterministicRoute('你可以帮我看看这个项目都有些什么')?.skillParams?.sampleSize === 0
        && routing.detectLightweightIntent('帮我看看当前项目图片是什么款式') === 'none'
        && routing.fastDeterministicRoute('帮我看看当前项目图片是什么款式')?.skillId === 'project-image-analysis'
        && routing.detectLightweightIntent('你能看看这些图片是什么 你能描述一下吗 并总结一下内容') === 'none'
        && routing.fastDeterministicRoute('你能看看这些图片是什么 你能描述一下吗 并总结一下内容')?.skillId === 'project-image-analysis'
        && !matchesSkillRoutingIntent('project-image-analysis', '看看我们是否可以开始做主图详情页了')
        && !matchesSkillRoutingIntent('project-image-analysis', '帮我处理一下')
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        overviewMatch: matchesSkillRoutingIntent('project-image-analysis', '帮我看看当前是个什么项目'),
        exactOverviewMatch: matchesSkillRoutingIntent('project-image-analysis', '帮我看看当前是什么项目'),
        bareOverviewMatch: matchesSkillRoutingIntent('project-image-analysis', '当前是什么项目'),
        inventoryMatch: matchesSkillRoutingIntent('project-image-analysis', '你可以帮我看看这个项目都有什么'),
        bareInventoryVariantMatch: matchesSkillRoutingIntent('project-image-analysis', '这个项目都有些什么'),
        inventoryVariantMatch: matchesSkillRoutingIntent('project-image-analysis', '你可以帮我看看这个项目都有些什么'),
        projectStyleMatch: matchesSkillRoutingIntent('project-image-analysis', '帮我看看当前项目图片是什么款式'),
        theseImagesMatch: matchesSkillRoutingIntent('project-image-analysis', '你能看看这些图片是什么 你能描述一下吗 并总结一下内容'),
        overviewSharedRoute: findSkillRoutingIntent('帮我看看当前是个什么项目'),
        bareOverviewLightweight: routing.detectLightweightIntent('当前是什么项目'),
        bareOverviewFastRoute: routing.fastDeterministicRoute('当前是什么项目'),
        overviewLightweight: routing.detectLightweightIntent('帮我看看当前是个什么项目'),
        overviewFastRoute: routing.fastDeterministicRoute('帮我看看当前是个什么项目'),
        inventoryFastRoute: routing.fastDeterministicRoute('你可以帮我看看这个项目都有什么'),
        bareInventoryVariantFastRoute: routing.fastDeterministicRoute('这个项目都有些什么'),
        inventoryVariantFastRoute: routing.fastDeterministicRoute('你可以帮我看看这个项目都有些什么'),
        projectStyleLightweight: routing.detectLightweightIntent('帮我看看当前项目图片是什么款式'),
        projectStyleFastRoute: routing.fastDeterministicRoute('帮我看看当前项目图片是什么款式'),
        theseImagesLightweight: routing.detectLightweightIntent('你能看看这些图片是什么 你能描述一下吗 并总结一下内容'),
        theseImagesFastRoute: routing.fastDeterministicRoute('你能看看这些图片是什么 你能描述一下吗 并总结一下内容'),
        planOnlyHijack: matchesSkillRoutingIntent('project-image-analysis', '看看我们是否可以开始做主图详情页了'),
        ambiguousHijack: matchesSkillRoutingIntent('project-image-analysis', '帮我处理一下')
      })
    });

    cases.push({
      name: 'detail-page-mode-signals-come-from-shared-metadata',
      status:
        matchesSkillRoutingIntent('detail-page-design', '帮我检查一下当前详情页结构')
        && resolveSkillRoutingMode('detail-page-design', '帮我检查一下当前详情页结构') === 'inspect'
        && resolveSkillRoutingMode('detail-page-design', '帮我设计并导出详情页') === 'execute'
        && !matchesSkillRoutingIntent('detail-page-design', '帮我把详情页文档导出成PNG')
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        inspectIntent: matchesSkillRoutingIntent('detail-page-design', '帮我检查一下当前详情页结构'),
        inspectMode: resolveSkillRoutingMode('detail-page-design', '帮我检查一下当前详情页结构'),
        executeMode: resolveSkillRoutingMode('detail-page-design', '帮我设计并导出详情页'),
        documentExportHijack: matchesSkillRoutingIntent('detail-page-design', '帮我把详情页文档导出成PNG')
      })
    });

    cases.push({
      name: 'document-action-signals-come-from-shared-metadata',
      status:
        matchesSkillRoutingIntent('document-management', '帮我关闭文档不保存')
        && resolveSkillRoutingMode('document-management', '帮我把详情页文档保存到项目的PSD中') === 'save'
        && resolveSkillRoutingMode('document-management', '帮我把详情页文档导出成PNG') === 'save'
        && resolveSkillRoutingMode('document-management', '帮我关闭文档不保存') === 'close'
        && resolveSkillRoutingMode('document-management', '帮我切换文档到 A.psd') === 'switch'
        && resolveSkillRoutingMode('document-management', '帮我列出当前文档') === 'list'
        && resolveSkillRoutingMode('document-management', '帮我新建文档') === 'create'
        && matchesSkillRoutingIntent('document-management', '帮我新建一个 800x800 的文档，名称 DesignEchoLiveAgentAcceptance')
        && resolveSkillRoutingMode('document-management', '帮我新建一个 800x800 的文档，名称 DesignEchoLiveAgentAcceptance') === 'create'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        save: resolveSkillRoutingMode('document-management', '帮我把详情页文档保存到项目的PSD中'),
        export: resolveSkillRoutingMode('document-management', '帮我把详情页文档导出成PNG'),
        close: resolveSkillRoutingMode('document-management', '帮我关闭文档不保存'),
        switch: resolveSkillRoutingMode('document-management', '帮我切换文档到 A.psd'),
        list: resolveSkillRoutingMode('document-management', '帮我列出当前文档'),
        create: resolveSkillRoutingMode('document-management', '帮我新建文档'),
        createSizedNamed: resolveSkillRoutingMode('document-management', '帮我新建一个 800x800 的文档，名称 DesignEchoLiveAgentAcceptance')
      })
    });

    cases.push({
      name: 'document-routing-params-use-shared-helper-safely',
      status:
        JSON.stringify(extractDocumentManagementRoutingParams('帮我关闭文档', 'close')) === JSON.stringify({ action: 'close' })
        && JSON.stringify(extractDocumentManagementRoutingParams('帮我关闭 A.psd 不保存', 'close')) === JSON.stringify({ action: 'close', documentName: 'A.psd', save: false })
        && JSON.stringify(extractDocumentManagementRoutingParams('帮我先保存再关闭 A.psd', 'close')) === JSON.stringify({ action: 'close', documentName: 'A.psd', save: true })
        && JSON.stringify(extractDocumentManagementRoutingParams('帮我切回 A.psd', 'switch')) === JSON.stringify({ action: 'switch', documentName: 'A.psd' })
        && JSON.stringify(extractDocumentManagementRoutingParams('帮我把详情页文档保存到项目的PSD中', 'save')) === JSON.stringify({ action: 'save', format: 'psd', saveAs: true, projectSubdir: 'PSD' })
        && JSON.stringify(extractDocumentManagementRoutingParams('帮我把详情页文档导出成PNG', 'save')) === JSON.stringify({ action: 'save', format: 'png', saveAs: true })
        && JSON.stringify(extractDocumentManagementRoutingParams('帮我新建一个 790x12000 名字叫详情页 的文档', 'create')) === JSON.stringify({ action: 'create', width: 790, height: 12000, name: '详情页' })
        && JSON.stringify(extractDocumentManagementRoutingParams('帮我新建一个 800x800 的文档，名称 DesignEchoLiveAgentAcceptance', 'create')) === JSON.stringify({ action: 'create', width: 800, height: 800, name: 'DesignEchoLiveAgentAcceptance' })
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        closeDefault: extractDocumentManagementRoutingParams('帮我关闭文档', 'close'),
        closeWithoutSaving: extractDocumentManagementRoutingParams('帮我关闭 A.psd 不保存', 'close'),
        closeWithSaving: extractDocumentManagementRoutingParams('帮我先保存再关闭 A.psd', 'close'),
        switchNamedDoc: extractDocumentManagementRoutingParams('帮我切回 A.psd', 'switch'),
        saveProjectPsd: extractDocumentManagementRoutingParams('帮我把详情页文档保存到项目的PSD中', 'save'),
        exportDocumentPng: extractDocumentManagementRoutingParams('帮我把详情页文档导出成PNG', 'save'),
        createSizedDoc: extractDocumentManagementRoutingParams('帮我新建一个 790x12000 名字叫详情页 的文档', 'create'),
        createSizedNamedDoc: extractDocumentManagementRoutingParams('帮我新建一个 800x800 的文档，名称 DesignEchoLiveAgentAcceptance', 'create')
      })
    });

    cases.push({
      name: 'routing-thinking-messages-stay-on-shared-skill-metadata',
      status:
        routing.buildDeterministicIntentMessage('document-management', '帮我关闭文档不保存') === '确认当前打开的文档后执行文档操作。'
        && routing.buildDeterministicIntentMessage('sku-batch', '帮我做2-3-4的自选备注') === '确认当前项目、SKU 文档和自选备注模板后生成备注。'
        && routing.buildAutonomousIntentMessage('帮我抠图', 'matte-product').includes('抠图能力当前暂不从 Agent 对话端执行')
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        documentDeterministic: routing.buildDeterministicIntentMessage('document-management', '帮我关闭文档不保存'),
        skuNoteOnlyDeterministic: routing.buildDeterministicIntentMessage('sku-batch', '帮我做2-3-4的自选备注'),
        matteAutonomous: routing.buildAutonomousIntentMessage('帮我抠图', 'matte-product')
      })
    });

    const autonomousAgentSource = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'autonomous-agent.executor.ts'),
      'utf8'
    );
    cases.push({
      name: 'autonomous-agent-prompt-includes-text-tool-semantics-with-boundary',
      status:
        autonomousAgentSource.includes('buildPhotoshopToolSemanticsSummary')
        && autonomousAgentSource.includes('Photoshop tool semantics available to this agent:')
        && autonomousAgentSource.includes('resolveFontName')
        && autonomousAgentSource.includes('does not prove screenshot-level typography quality')
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        hasSemanticsSummary: autonomousAgentSource.includes('buildPhotoshopToolSemanticsSummary'),
        hasPromptSection: autonomousAgentSource.includes('Photoshop tool semantics available to this agent:'),
        mentionsResolveFontName: autonomousAgentSource.includes('resolveFontName'),
        hasBoundary: autonomousAgentSource.includes('does not prove screenshot-level typography quality')
      })
    });

    cases.push({
      name: 'casual-greeting-particles-stay-conversational',
      status:
        routing.detectLightweightIntent('你好啊') === 'greeting'
        && routing.debugInferDecisionFromText('你好啊')?.type === 'direct_response'
        && routing.debugInferDecisionFromText('你好啊')?.reasoning === 'lightweight:greeting'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        intent: routing.detectLightweightIntent('你好啊'),
        decision: routing.debugInferDecisionFromText('你好啊')
      })
    });

    const actionableLayerQuestion = '你能把当前选中的图层置顶吗？';
    const hiddenLayerQuestion = '隐藏的图层你看不到吗？';
    const layerCountQuestion = '当前文档一共有几个图层？';
    const skuKnowledgeQuestion = 'SKU是什么？';
    const skuCapabilityQuestionVariants = [
      '我问你会做SKU吗',
      '你可以帮我做SKU吗？',
      '你会不会做SKU'
    ];
    const actionableLayerQuestionIntent = routing.detectLightweightIntent(actionableLayerQuestion);
    const hiddenLayerQuestionIntent = routing.detectLightweightIntent(hiddenLayerQuestion);
    const layerCountQuestionIntent = routing.detectLightweightIntent(layerCountQuestion);
    const skuQuestionIntent = routing.detectLightweightIntent(skuKnowledgeQuestion);
    const skuCapabilityQuestionResults = skuCapabilityQuestionVariants.map((input) => ({
      input,
      intent: routing.detectLightweightIntent(input),
      route: routing.fastDeterministicRoute(input),
      decision: routing.debugInferDecisionFromText(input)
    }));
    const actionableLayerQuestionRoute = routing.fastDeterministicRoute(actionableLayerQuestion);
    const hiddenLayerQuestionRoute = routing.fastDeterministicRoute(hiddenLayerQuestion);
    const layerCountQuestionRoute = routing.fastDeterministicRoute(layerCountQuestion);
    cases.push({
      name: 'actionable-photoshop-questions-override-lightweight-chat',
      status:
        actionableLayerQuestionIntent === 'none'
        && actionableLayerQuestionRoute?.skillId === 'layer-management'
        && actionableLayerQuestionRoute?.skillParams?.action === 'reorder'
        && actionableLayerQuestionRoute?.skillParams?.reorderAction === 'top'
        && hiddenLayerQuestionIntent === 'none'
        && hiddenLayerQuestionRoute?.skillId === 'layer-management'
        && hiddenLayerQuestionRoute?.skillParams?.action === 'inspect'
        && layerCountQuestionIntent === 'none'
        && layerCountQuestionRoute?.skillId === 'layer-management'
        && layerCountQuestionRoute?.skillParams?.action === 'inspect'
        && skuQuestionIntent === 'chat'
        && skuCapabilityQuestionResults.every((item) => (
          item.intent === 'chat'
          && item.route === null
          && item.decision?.type === 'direct_response'
        ))
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        actionableLayerQuestionIntent,
        actionableLayerQuestionRoute,
        hiddenLayerQuestionIntent,
        hiddenLayerQuestionRoute,
        layerCountQuestionIntent,
        layerCountQuestionRoute,
        skuQuestionIntent,
        skuCapabilityQuestionResults
      })
    });

    const controlPlaneMatrix = [
      {
        input: '看看我们是否可以开始做主图详情页了',
        expected: {
          requestKind: 'plan_only',
          toolScope: 'none',
          conversational: true,
          deterministic: false,
          router: false,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: '主图详情页还剩哪些问题',
        expected: {
          requestKind: 'plan_only',
          toolScope: 'none',
          conversational: true,
          deterministic: false,
          router: false,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: '我还有问题',
        expected: {
          requestKind: 'chat_only',
          toolScope: 'none',
          conversational: true,
          deterministic: false,
          router: false,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: '我问你会做SKU吗',
        expected: {
          requestKind: 'chat_only',
          toolScope: 'none',
          conversational: true,
          deterministic: false,
          router: false,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: '你会不会做SKU',
        expected: {
          requestKind: 'chat_only',
          toolScope: 'none',
          conversational: true,
          deterministic: false,
          router: false,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: '你都能帮我做什么',
        expected: {
          requestKind: 'chat_only',
          toolScope: 'none',
          conversational: true,
          deterministic: false,
          router: false,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: '帮我处理一下',
        expected: {
          requestKind: 'clarify',
          toolScope: 'none',
          conversational: false,
          deterministic: false,
          router: false,
          autonomous: false,
          clarification: true
        }
      },
      {
        input: '帮我抠图',
        expected: {
          requestKind: 'uxp_user_tool_only',
          toolScope: 'none',
          conversational: false,
          deterministic: false,
          router: false,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: '当前文档一共有几个图层？',
        expected: {
          requestKind: 'read_only_inspect',
          toolScope: 'read_only',
          conversational: false,
          deterministic: true,
          router: true,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: '帮我检查一下当前详情页结构',
        expected: {
          requestKind: 'read_only_inspect',
          toolScope: 'read_only',
          conversational: false,
          deterministic: true,
          router: true,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: '当前是什么项目',
        expected: {
          requestKind: 'read_only_inspect',
          toolScope: 'read_only',
          conversational: false,
          deterministic: true,
          router: true,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: '帮我看看当前是个什么项目',
        expected: {
          requestKind: 'read_only_inspect',
          toolScope: 'read_only',
          conversational: false,
          deterministic: true,
          router: true,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: '帮我看看当前项目图片是什么款式',
        expected: {
          requestKind: 'read_only_inspect',
          toolScope: 'read_only',
          conversational: false,
          deterministic: true,
          router: true,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: '你能看看这些图片是什么 你能描述一下吗 并总结一下内容',
        expected: {
          requestKind: 'read_only_inspect',
          toolScope: 'read_only',
          conversational: false,
          deterministic: true,
          router: true,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: '帮我做SKU以及对应的自选备注',
        expected: {
          requestKind: 'execute_skill',
          toolScope: 'write_photoshop',
          conversational: false,
          deterministic: true,
          router: true,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: '帮我做主图',
        expected: {
          requestKind: 'execute_skill',
          toolScope: 'write_photoshop',
          conversational: false,
          deterministic: true,
          router: true,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: '帮我做转化图 在Adobe Photoshop文档中有800文档',
        expected: {
          requestKind: 'execute_skill',
          toolScope: 'write_photoshop',
          conversational: false,
          deterministic: true,
          router: true,
          autonomous: false,
          clarification: false
        }
      },
      {
        input: '把这个画面整理得更高级一些并保留当前视觉重点',
        expected: {
          requestKind: 'autonomous_execution',
          toolScope: 'write_photoshop',
          conversational: false,
          deterministic: true,
          router: true,
          autonomous: true,
          clarification: false
        }
      }
    ];
    const controlPlaneResults = controlPlaneMatrix.map((item) => {
      const decision = intentControlPlane?.buildAgentIntentControlPlaneDecision
        ? intentControlPlane.buildAgentIntentControlPlaneDecision({ userInput: item.input })
        : null;
      return {
        input: item.input,
        expected: item.expected,
        actual: decision,
        ok:
          decision?.version === 'agent-intent-control-plane/v0'
          && decision?.requestKind === item.expected.requestKind
          && decision?.toolScope === item.expected.toolScope
          && decision?.shouldUseConversationalPath === item.expected.conversational
          && decision?.allowsDeterministicRoute === item.expected.deterministic
          && decision?.allowsRouterModel === item.expected.router
          && decision?.allowsAutonomousFallback === item.expected.autonomous
          && decision?.requiresClarificationBeforeTools === item.expected.clarification
          && !Object.prototype.hasOwnProperty.call(decision || {}, 'confidence')
      };
    });
    cases.push({
      name: 'intent-control-plane-classifies-tool-authorization-contract',
      status:
        intentControlPlaneLoadError === null
        && typeof intentControlPlane?.buildAgentIntentControlPlaneDecision === 'function'
        && controlPlaneResults.every((item) => item.ok)
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        loadError: intentControlPlaneLoadError ? String(intentControlPlaneLoadError.message || intentControlPlaneLoadError) : null,
        controlPlaneResults
      })
    });

    let callModelCount = 0;
    executed = [];
    let skuCapabilityConversationalPromptSeen = false;
    let skuCapabilityRouterPromptSeen = false;
    const skuCapabilityFallbackResult = await engine.run(createContext('我问你会做SKU吗'), {
      callModel: async (messages, options = {}) => {
        callModelCount += 1;
        const systemPrompt = String(messages?.[0]?.content || '');
        skuCapabilityConversationalPromptSeen = skuCapabilityConversationalPromptSeen || systemPrompt.includes('当前用户在进行对话咨询');
        skuCapabilityRouterPromptSeen = skuCapabilityRouterPromptSeen || systemPrompt.includes('intent router');
        if (options.purpose === 'direct_response_repair') {
          return { text: '我可以处理 SKU、主图、详情页、项目图片理解和受控 Photoshop 操作；如果只是问能力，我会先说明能力，不会直接执行工具。' };
        }
        return { text: '{}' };
      }
    });

    cases.push({
      name: 'engine-sku-capability-question-repairs-empty-model-reply-without-tools-or-fixed-template',
      status:
        callModelCount === 2
        && executed.length === 0
        && skuCapabilityConversationalPromptSeen
        && !skuCapabilityRouterPromptSeen
        && skuCapabilityFallbackResult?.success === true
        && !skuCapabilityFallbackResult?.error
        && String(skuCapabilityFallbackResult?.message || '').includes('SKU')
        && !String(skuCapabilityFallbackResult?.message || '').includes('Conversational reply unavailable')
        && !String(skuCapabilityFallbackResult?.message || '').includes('这是对话问题')
        && skuCapabilityFallbackResult?.data?.agentIntentControlPlane?.requestKind === 'chat_only'
        && skuCapabilityFallbackResult?.data?.agentIntentControlPlane?.toolScope === 'none'
        && skuCapabilityFallbackResult?.data?.agentRequestLifecycle?.decision?.route === 'direct_response'
        && skuCapabilityFallbackResult?.data?.agentRequestLifecycle?.execution?.kind === 'none'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        callModelCount,
        executed,
        skuCapabilityConversationalPromptSeen,
        skuCapabilityRouterPromptSeen,
        result: skuCapabilityFallbackResult
      })
    });

    callModelCount = 0;
    executed = [];
    let leakedToolCallRepairPromptSeen = false;
    const leakedToolCallConversationalResult = await engine.run(createContext('你可以做什么？'), {
      callModel: async (messages, options = {}) => {
        callModelCount += 1;
        const systemPrompt = String(messages?.[0]?.content || '');
        leakedToolCallRepairPromptSeen = leakedToolCallRepairPromptSeen
          || systemPrompt.includes('上一轮对话回复为空')
          || systemPrompt.includes('误返回');
        if (options.purpose === 'direct_response_repair') {
          return { text: '我可以说明当前能力、理解项目图片和在明确授权后执行受控 Photoshop 技能；这次只是能力询问，不会调用工具。' };
        }
        return {
          text: [
            '好的，我先分析一下。',
            '<tool_call>',
            '<function=visual_analysis>',
            '<parameter=analysis_type>content_overview</parameter>',
            '</function>',
            '</tool_call>'
          ].join('\n')
        };
      }
    });

    cases.push({
      name: 'conversational-tool-call-text-is-repaired-instead-of-rendered',
      status:
        callModelCount === 2
        && executed.length === 0
        && leakedToolCallRepairPromptSeen
        && leakedToolCallConversationalResult?.success === true
        && !String(leakedToolCallConversationalResult?.message || '').includes('<tool_call>')
        && !String(leakedToolCallConversationalResult?.message || '').includes('<function=')
        && !String(leakedToolCallConversationalResult?.message || '').includes('Conversational reply unavailable')
        && leakedToolCallConversationalResult?.data?.agentRequestLifecycle?.decision?.route === 'direct_response'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        callModelCount,
        executed,
        leakedToolCallRepairPromptSeen,
        result: leakedToolCallConversationalResult
      })
    });

    const localTemplateIntents = ['identity', 'model_compare', 'capability', 'greeting', 'thanks', 'ack'];
    const localTemplateResults = localTemplateIntents.map((intent) => ({
      intent,
      reply: conversational.buildLocalConversationalReply(intent, createContext('你好'))
    }));
    const noLocalFirstConversational = ['greeting', 'thanks', 'ack'].every((intent) => (
      routing.isLocalFirstConversationalIntent(intent) === false
    ));
    const noFixedPersonaReplies = localTemplateResults.every((item) => item.reply === null);

    cases.push({
      name: 'conversational-persona-and-capability-do-not-use-local-fixed-templates',
      status:
        noLocalFirstConversational
        && noFixedPersonaReplies
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        noLocalFirstConversational,
        localTemplateResults
      })
    });

    callModelCount = 0;
    executed = [];
    const capabilityNoModelResult = await engine.run(createContext('你都能帮我做什么'), {});

    cases.push({
      name: 'engine-capability-question-has-contextual-fallback-when-model-unavailable',
      status:
        callModelCount === 0
        && executed.length === 0
        && capabilityNoModelResult?.success === true
        && !capabilityNoModelResult?.error
        && String(capabilityNoModelResult?.message || '').includes('SKU')
        && String(capabilityNoModelResult?.message || '').includes('主图')
        && String(capabilityNoModelResult?.message || '').includes('详情页')
        && !String(capabilityNoModelResult?.message || '').includes('Conversational reply unavailable')
        && !String(capabilityNoModelResult?.message || '').includes('需要先明确要处理的目标')
        && !String(capabilityNoModelResult?.message || '').includes('Smart Layout')
        && !String(capabilityNoModelResult?.message || '').includes('Project Image Analysis')
        && capabilityNoModelResult?.data?.agentIntentControlPlane?.requestKind === 'chat_only'
        && capabilityNoModelResult?.data?.agentIntentControlPlane?.toolScope === 'none'
        && capabilityNoModelResult?.data?.agentRequestLifecycle?.decision?.route === 'direct_response'
        && capabilityNoModelResult?.data?.agentRequestLifecycle?.execution?.kind === 'none'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed, capabilityNoModelResult })
    });

    callModelCount = 0;
    executed = [];
    const greetingResult = await engine.run(createContext('你好啊'), {
      callModel: async () => {
        callModelCount += 1;
        return {
          text: '你好，我在。'
        };
      }
    });

    cases.push({
      name: 'engine-greeting-consults-model-when-provider-is-available',
      status:
        callModelCount === 1
        && executed.length === 0
        && greetingResult?.success === true
        && typeof greetingResult?.message === 'string'
        && greetingResult.message.includes('你好')
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed, greetingResult })
    });

    callModelCount = 0;
    executed = [];
    await engine.run(createContext('帮我新建一个详情页文档然后帮我制作一个详情页模板吧'), {
      callModel: async () => {
        callModelCount += 1;
        return {
          text: JSON.stringify({
            route: 'skill_execution',
            skillId: 'detail-page-template-authoring',
            thinking: '用户要先创建详情页模板骨架。',
            skillParams: { userIntent: '帮我新建一个详情页文档然后帮我制作一个详情页模板吧' }
          })
        };
      }
    });

    cases.push({
      name: 'engine-model-first-for-detail-template-authoring',
      status:
        callModelCount === 1
        && executed.length === 1
        && executed[0].skillId === 'detail-page-template-authoring'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed })
    });

    callModelCount = 0;
    executed = [];
    await engine.run(createContext('帮我新建一个详情页文档然后帮我制作一个详情页模板吧'), {
      callModel: async () => {
        callModelCount += 1;
        return {
          text: JSON.stringify({
            route: 'autonomous_agent',
            skillId: 'detail-page-design',
            mode: 'execute',
            thinking: '错误地把明确的模板创建任务当成开放式自主任务。',
            skillParams: { userIntent: '帮我新建一个详情页文档然后帮我制作一个详情页模板吧' }
          })
        };
      }
    });

    cases.push({
      name: 'deterministic-template-authoring-outranks-autonomous-router',
      status:
        callModelCount === 1
        && executed.length === 1
        && executed[0].skillId === 'detail-page-template-authoring'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed })
    });

    callModelCount = 0;
    executed = [];
    await engine.run(createContext('参考图照着做生成同款版式', {
      attachedImageData: 'base64-reference-image'
    }), {
      callModel: async () => {
        callModelCount += 1;
        return {
          text: JSON.stringify({
            route: 'skill_execution',
            skillId: 'main-image-design',
            thinking: '错误地把参考图复刻当成主图设计。',
            skillParams: { size: '800' }
          })
        };
      }
    });

    cases.push({
      name: 'reference-replication-consults-router-then-preserves-deterministic-safety',
      status:
        callModelCount === 1
        && executed.length === 1
        && executed[0].skillId === 'layout-replication'
        && executed[0].params?.outputMode === 'apply'
        && executed[0].params?.autoCreateDocument === true
        && executed[0].params?.preserveReferenceCanvasSize === true
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed })
    });

    callModelCount = 0;
    executed = [];
    await engine.run(createContext('在我们创建的文档中 帮我复刻其中的内容', {
      hasAttachedImage: true,
      attachedImageData: 'base64-reference-image'
    }), {
      callModel: async () => {
        callModelCount += 1;
        return { text: '' };
      }
    });

    cases.push({
      name: 'engine-attached-reference-replication-consults-router-before-fallback',
      status:
        callModelCount === 1
        && executed.length === 1
        && executed[0].skillId === 'layout-replication'
        && executed[0].params?.userIntent === '在我们创建的文档中 帮我复刻其中的内容'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed })
    });

    callModelCount = 0;
    executed = [];
    let identityConversationalPromptSeen = false;
    let identityRouterPromptSeen = false;
    const identityResult = await engine.run(createContext('我的意思是你是什么模型 不是执行任务'), {
      callModel: async (messages, options = {}) => {
        callModelCount += 1;
        const systemPrompt = String(messages?.[0]?.content || '');
        identityConversationalPromptSeen = identityConversationalPromptSeen || systemPrompt.includes('当前用户在进行对话咨询');
        identityRouterPromptSeen = identityRouterPromptSeen || systemPrompt.includes('intent router');
        if (options.purpose === 'direct_response_repair') {
          return { text: '我是当前接入 DesignEcho 的对话模型，会基于项目上下文回答，并在明确需要时才进入受控 Photoshop 能力。' };
        }
        return {
          text: systemPrompt.includes('当前用户在进行对话咨询')
            ? JSON.stringify({
              route: 'skill_execution',
              skillId: 'document-management',
              skillParams: { action: 'list' }
            })
            : 'unexpected-router-call'
        };
      }
    });

    cases.push({
      name: 'engine-model-identity-enters-conversation-and-does-not-fallback-to-fixed-template',
      status:
        callModelCount === 2
        && executed.length === 0
        && identityConversationalPromptSeen
        && !identityRouterPromptSeen
        && typeof identityResult?.message === 'string'
        && identityResult.success === true
        && !identityResult.error
        && identityResult.message.includes('DesignEcho')
        && !identityResult.message.includes('对话模型没有返回有效内容')
        && !identityResult.message.includes('skill_execution')
        && !identityResult.message.includes('document-management')
        && !identityResult.message.includes('不会去调用 Photoshop 执行链')
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        callModelCount,
        executed,
        identityConversationalPromptSeen,
        identityRouterPromptSeen,
        identityResult
      })
    });

    callModelCount = 0;
    executed = [];
    let conversationalPromptSeen = false;
    let routerPromptSeen = false;
    const modelCompareResult = await engine.run(createContext('下面是一个闲聊 Gemini-3.1-Pro-Preview 和GPT5.4哪个模型更强'), {
      callModel: async (messages) => {
        callModelCount += 1;
        const systemPrompt = String(messages?.[0]?.content || '');
        conversationalPromptSeen = conversationalPromptSeen || systemPrompt.includes('当前用户在进行对话咨询');
        routerPromptSeen = routerPromptSeen || systemPrompt.includes('intent router');
        return { text: '这是模型能力比较问题，应直接回答，不应读取或修改 Photoshop 文档。' };
      }
    });

    cases.push({
      name: 'engine-model-comparison-stays-conversational',
      status:
        callModelCount === 1
        && executed.length === 0
        && conversationalPromptSeen
        && !routerPromptSeen
        && modelCompareResult?.message === '这是模型能力比较问题，应直接回答，不应读取或修改 Photoshop 文档。'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed, conversationalPromptSeen, routerPromptSeen, modelCompareResult })
    });

    callModelCount = 0;
    executed = [];
    conversationalPromptSeen = false;
    routerPromptSeen = false;
    const pureChatResult = await engine.run(createContext('为什么电商详情页要分屏设计？'), {
      callModel: async (messages) => {
        callModelCount += 1;
        const systemPrompt = String(messages?.[0]?.content || '');
        conversationalPromptSeen = conversationalPromptSeen || systemPrompt.includes('当前用户在进行对话咨询');
        routerPromptSeen = routerPromptSeen || systemPrompt.includes('intent router');
        return { text: '分屏设计主要是为了控制信息节奏、突出卖点层级，并降低用户阅读负担。' };
      }
    });

    cases.push({
      name: 'engine-pure-chat-question-stays-conversational',
      status:
        callModelCount === 1
        && executed.length === 0
        && conversationalPromptSeen
        && !routerPromptSeen
        && pureChatResult?.message === '分屏设计主要是为了控制信息节奏、突出卖点层级，并降低用户阅读负担。'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed, conversationalPromptSeen, routerPromptSeen, pureChatResult })
    });

    const taskSummaryInput = '回顾上次我们的任务 进行一个总结';
    const taskSummaryIntent = routing.detectLightweightIntent(taskSummaryInput);
    const taskSummaryDebugDecision = routing.debugInferDecisionFromText(taskSummaryInput);
    cases.push({
      name: 'task-summary-intent-stays-conversational',
      status:
        taskSummaryIntent === 'task_summary'
        && taskSummaryDebugDecision?.type === 'direct_response'
        && taskSummaryDebugDecision?.reasoning === 'lightweight:task_summary'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        taskSummaryIntent,
        taskSummaryDebugDecision
      })
    });

    callModelCount = 0;
    executed = [];
    conversationalPromptSeen = false;
    routerPromptSeen = false;
    const taskSummaryResult = await engine.run(createContext(taskSummaryInput, {
      conversationHistory: [
        { role: 'user', content: '帮我做 SKU 以及对应的自选备注' },
        { role: 'assistant', content: '已生成 2/3/4 双 SKU，并导出对应图片。' }
      ]
    }), {
      callModel: async (messages) => {
        callModelCount += 1;
        const systemPrompt = String(messages?.[0]?.content || '');
        conversationalPromptSeen = conversationalPromptSeen || systemPrompt.includes('当前用户在进行对话咨询');
        routerPromptSeen = routerPromptSeen || systemPrompt.includes('intent router');
        return { text: '上次任务主要是 SKU 批量生成与自选备注处理，已导出对应文件；这次只是总结，不需要调用 Photoshop 工具。' };
      }
    });

    cases.push({
      name: 'engine-task-summary-does-not-enter-photoshop-tool-chain',
      status:
        callModelCount === 1
        && executed.length === 0
        && conversationalPromptSeen
        && !routerPromptSeen
        && taskSummaryResult?.message.includes('上次任务主要是 SKU 批量生成')
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        callModelCount,
        executed,
        conversationalPromptSeen,
        routerPromptSeen,
        taskSummaryResult
      })
    });

    const continuationInputs = ['继续', '好的继续', '继续下一项', '按照计划继续'];
    const continuationIntents = continuationInputs.map((input) => ({
      input,
      intent: routing.detectLightweightIntent(input),
      decision: routing.debugInferDecisionFromText(input)
    }));
    cases.push({
      name: 'continuation-phrases-are-model-first-contextual-not-local-ack',
      status: continuationIntents.every((item) => (
        item.intent === 'continuation'
        && item.decision?.type === 'direct_response'
        && item.decision?.reasoning === 'lightweight:continuation'
      ))
        ? 'pass'
        : 'fail',
      details: JSON.stringify({ continuationIntents })
    });

    callModelCount = 0;
    executed = [];
    conversationalPromptSeen = false;
    routerPromptSeen = false;
    const continuationResult = await engine.run(createContext('继续', {
      conversationHistory: [
        { role: 'user', content: '帮我回顾上次我们的任务，进行一个总结' },
        { role: 'assistant', content: '上次任务是总结最近工作，不应调用 Photoshop 工具。' }
      ]
    }), {
      callModel: async (messages) => {
        callModelCount += 1;
        const systemPrompt = String(messages?.[0]?.content || '');
        const serializedMessages = JSON.stringify(messages);
        conversationalPromptSeen = conversationalPromptSeen || systemPrompt.includes('当前用户在进行对话咨询');
        routerPromptSeen = routerPromptSeen || systemPrompt.includes('intent router');
        return {
          text: serializedMessages.includes('帮我回顾上次我们的任务')
            ? '继续上一轮总结上下文：先确认已完成的修复与验证，再列出剩余风险。'
            : 'missing-context'
        };
      }
    });

    cases.push({
      name: 'engine-continuation-consults-model-with-history-and-no-tools',
      status:
        callModelCount === 1
        && executed.length === 0
        && conversationalPromptSeen
        && !routerPromptSeen
        && continuationResult?.message.includes('继续上一轮总结上下文')
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        callModelCount,
        executed,
        conversationalPromptSeen,
        routerPromptSeen,
        continuationResult
      })
    });

    callModelCount = 0;
    executed = [];
    const clarificationResult = await engine.run(createContext('帮我处理一下详情页'), {
      callModel: async () => {
        callModelCount += 1;
        return {
          text: JSON.stringify({
            route: 'clarification_needed',
            thinking: '用户在说详情页，但没有说明是检查现有模板还是从零创建模板。',
            clarificationQuestion: '你是要检查当前详情页模板，还是从零新建一个详情页模板？'
          })
        };
      }
    });

    cases.push({
      name: 'engine-supports-clarification-needed',
      status:
        callModelCount === 1
        && executed.length === 0
        && String(clarificationResult?.message || '').includes('检查当前详情页模板')
        && clarificationResult?.data?.agentIntentControlPlane?.requestKind === 'execute_skill'
        && clarificationResult?.data?.agentIntentControlPlane?.matchedSignals?.includes('shared_skill_routing:detail-page-design')
        && clarificationResult?.data?.agentRequestLifecycle?.decision?.source === 'model_router'
        && clarificationResult?.data?.agentRequestLifecycle?.decision?.route === 'clarification_needed'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed, clarificationResult })
    });

    callModelCount = 0;
    executed = [];
    const thinkingEvents = [];
    const statusEvents = [];
    await engine.run(createContext('帮我关闭文档不保存'), {
      callModel: async (_messages, options = {}) => {
        callModelCount += 1;
        if (options.purpose === 'visible_reasoning') {
          return {
            text: '我先确认这是关闭当前 Photoshop 文档且不保存的操作，再判断是否需要调用文档管理能力。'
          };
        }
        return {
          text: JSON.stringify({
            route: 'skill_execution',
            skillId: 'document-management',
            mode: 'execute',
            intentSummary: '这是关闭当前文档且不保存的操作。',
            skillParams: { action: 'close', save: false }
          })
        };
      },
      callbacks: {
        onThinking: (thinking, meta) => thinkingEvents.push({ thinking, meta }),
        onStatus: (message) => statusEvents.push(message)
      }
    });

    cases.push({
      name: 'simple-operation-uses-visible-reasoning-plus-deterministic-short-path',
      status:
        callModelCount === 1
        && executed.length === 1
        && executed[0].skillId === 'document-management'
        && executed[0].params?.action === 'close'
        && executed[0].params?.save === false
        && thinkingEvents.length === 1
        && thinkingEvents[0].thinking.includes('先确认')
        && thinkingEvents[0].meta?.source === 'model_visible_reasoning'
        && !statusEvents.some((message) => message.includes('调用意图分类模型'))
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed, thinkingEvents, statusEvents })
    });

    callModelCount = 0;
    executed = [];
    const layerThinkingEvents = [];
    await engine.run(createContext('把图层的颜色从浅到深，从上到下调整图层顺序'), {
      callModel: async (_messages, options = {}) => {
        callModelCount += 1;
        if (options.purpose === 'visible_reasoning') {
          return {
            text: '我会先确认这是图层排序请求，再读取当前图层结构并按颜色明度调整顺序。'
          };
        }
        return {
          text: JSON.stringify({
            route: 'skill_execution',
            skillId: 'layer-management',
            mode: 'execute',
            intentSummary: '按颜色明度重新排序当前图层。',
            skillParams: {
              action: 'reorder',
              sortBy: 'lightness',
              sortDirection: 'light-to-dark'
            }
          })
        };
      },
      callbacks: {
        onThinking: (thinking, meta) => layerThinkingEvents.push({ thinking, meta })
      }
    });

    cases.push({
      name: 'layer-order-uses-visible-reasoning-plus-deterministic-short-path',
      status:
        callModelCount === 1
        && executed.length === 1
        && executed[0].skillId === 'layer-management'
        && executed[0].params?.action === 'reorder'
        && executed[0].params?.sortBy === 'lightness'
        && executed[0].params?.sortDirection === 'light-to-dark'
        && layerThinkingEvents.length === 1
        && layerThinkingEvents[0].thinking.includes('图层排序')
        && layerThinkingEvents[0].meta?.source === 'model_visible_reasoning'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed, layerThinkingEvents })
    });

    callModelCount = 0;
    executed = [];
    const skuThinkingEvents = [];
    await engine.run(createContext('帮我做SKU以及对应的自选备注'), {
      callModel: async (_messages, options = {}) => {
        callModelCount += 1;
        if (options.purpose === 'visible_reasoning') {
          return {
            text: '我会先判断这是 SKU 出图和自选备注请求，再确认项目素材、规格和模板是否满足执行条件。'
          };
        }
        if (options.purpose === 'design_execution_preflight') {
          return {
            text: JSON.stringify(sampleDesignDecision('生成 SKU 组合图，并同步生成对应自选备注。'))
          };
        }
        return {
          text: JSON.stringify({
            route: 'skill_execution',
            skillId: 'sku-batch',
            mode: 'execute',
            intentSummary: '用户需要生成 SKU 组合图，并同步生成对应自选备注。',
            skillParams: {
              generateNotes: true
            }
          })
        };
      },
      callbacks: {
        onThinking: (thinking, meta) => skuThinkingEvents.push({ thinking, meta })
      }
    });

    cases.push({
      name: 'sku-request-emits-model-visible-reasoning-before-skill-execution',
      status:
        callModelCount === 2
        && executed.length === 1
        && executed[0].skillId === 'sku-batch'
        && executed[0].params?.generateNotes === true
        && !executed[0].params?.designIntelligenceDecision
        && skuThinkingEvents.length >= 2
        && skuThinkingEvents[0].thinking.includes('SKU')
        && skuThinkingEvents[0].meta?.source === 'model_visible_reasoning'
        && skuThinkingEvents[1].thinking.includes('自选备注')
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed, skuThinkingEvents })
    });

    callModelCount = 0;
    executed = [];
    const explicitSkuRoute = routing.fastDeterministicRoute('帮我做一下SKU');
    const explicitSkuResult = await engine.run(createContext('帮我做一下SKU'), {
      callModel: async (_messages, options = {}) => {
        callModelCount += 1;
        if (options.purpose === 'visible_reasoning') {
          return {
            text: '我会先判断这是当前项目的 SKU 批量生成请求，再确认 SKU 文件、模板和配置。'
          };
        }
        if (options.purpose === 'design_execution_preflight') {
          return { text: '{}' };
        }
        return {
          text: JSON.stringify({
            route: 'skill_execution',
            skillId: 'main-image-design',
            mode: 'open-design',
            intentSummary: '用户需要进行电商主图设计。',
            skillParams: {
              requiresGenericDesignDecision: true
            }
          })
        };
      }
    });

    cases.push({
      name: 'explicit-sku-route-vetoes-generic-design-model-drift',
      status:
        callModelCount === 1
        && explicitSkuRoute?.skillId === 'sku-batch'
        && explicitSkuResult.success === true
        && executed.length === 1
        && executed[0].skillId === 'sku-batch'
        && explicitSkuResult.data?.agentDesignExecutionPreflight?.status !== 'needs_model_design_decision'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        callModelCount,
        deterministicRoute: explicitSkuRoute,
        executed,
        result: {
          success: explicitSkuResult.success,
          error: explicitSkuResult.error,
          message: explicitSkuResult.message,
          preflightStatus: explicitSkuResult.data?.agentDesignExecutionPreflight?.status,
          lifecycle: explicitSkuResult.data?.agentRequestLifecycle
        }
      })
    });

    callModelCount = 0;
    executed = [];
    const modelFirstOverrideInput = '帮我做4双SKU组合，需要3个，后续会接到主图和详情页流程里';
    const modelFirstKeywordRoute = routing.fastDeterministicRoute(modelFirstOverrideInput);
    const modelFirstEcommerceResult = await engine.run(createContext(modelFirstOverrideInput), {
      callModel: async () => {
        callModelCount += 1;
        return {
          text: JSON.stringify({
            route: 'skill_execution',
            skillId: 'ecommerce-socks-design',
            mode: 'execute',
            intentSummary: '用户不是只要 SKU，而是要整体规划袜子电商出图交付。',
            skillParams: {
              deliverables: ['sku', 'main-image', 'detail-page'],
              userIntent: modelFirstOverrideInput
            }
          })
        };
      }
    });

    cases.push({
      name: 'model-first-skill-choice-can-override-non-protected-keyword-route',
      status:
        callModelCount === 1
        && Boolean(modelFirstKeywordRoute?.skillId)
        && modelFirstKeywordRoute.skillId !== 'ecommerce-socks-design'
        && executed.length === 1
        && executed[0].skillId === 'ecommerce-socks-design'
        && modelFirstEcommerceResult.data?.agentRequestLifecycle?.decision?.source === 'model_router'
        && modelFirstEcommerceResult.data?.agentRequestLifecycle?.decision?.skillId === 'ecommerce-socks-design'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        callModelCount,
        keywordRoute: modelFirstKeywordRoute,
        executed,
        lifecycle: modelFirstEcommerceResult.data?.agentRequestLifecycle
      })
    });

    callModelCount = 0;
    executed = [];
    await engine.run(createContext('把当前选中的图层编组'), {
      callModel: async () => {
        callModelCount += 1;
        return {
          text: JSON.stringify({
            route: 'skill_execution',
            skillId: 'layer-management',
            mode: 'execute',
            intentSummary: '把当前选中的图层编组。',
            skillParams: {
              action: 'group',
              useCurrentSelection: true
            }
          })
        };
      }
    });

    cases.push({
      name: 'current-selection-group-consults-router-model-before-execution',
      status:
        callModelCount === 1
        && executed.length === 1
        && executed[0].skillId === 'layer-management'
        && executed[0].params?.action === 'group'
        && executed[0].params?.useCurrentSelection === true
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed })
    });

    callModelCount = 0;
    executed = [];
    await engine.run(createContext('你能把当前选中的图层置顶吗？'), {
      callModel: async () => {
        callModelCount += 1;
        return {
          text: JSON.stringify({
            route: 'skill_execution',
            skillId: 'layer-management',
            mode: 'execute',
            intentSummary: '把当前选中的图层移到最上方。',
            skillParams: {
              action: 'reorder',
              reorderAction: 'top',
              useCurrentSelection: true
            }
          })
        };
      }
    });

    cases.push({
      name: 'actionable-layer-question-consults-router-model-before-execution',
      status:
        callModelCount === 1
        && executed.length === 1
        && executed[0].skillId === 'layer-management'
        && executed[0].params?.action === 'reorder'
        && executed[0].params?.reorderAction === 'top'
        && executed[0].params?.useCurrentSelection === true
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed })
    });

    callModelCount = 0;
    executed = [];
    await engine.run(createContext('隐藏的图层你看不到吗？'), {
      callModel: async () => {
        callModelCount += 1;
        return {
          text: JSON.stringify({
            route: 'skill_execution',
            skillId: 'layer-management',
            mode: 'execute',
            intentSummary: '检查隐藏图层和当前图层层级。',
            skillParams: {
              action: 'inspect'
            }
          })
        };
      }
    });

    cases.push({
      name: 'hidden-layer-question-consults-router-model-before-inspect',
      status:
        callModelCount === 1
        && executed.length === 1
        && executed[0].skillId === 'layer-management'
        && executed[0].params?.action === 'inspect'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed })
    });

    callModelCount = 0;
    executed = [];
    const autonomousPlanningResult = await engine.run(createContext('把这个画面整理得更高级一些并保留当前视觉重点'), {
      callModel: async (_messages, requestOptions) => {
        callModelCount += 1;
        if (requestOptions?.purpose !== 'router') {
          return { text: '' };
        }
        return {
          text: JSON.stringify({
            route: 'autonomous_agent',
            skillId: 'detail-page-design',
            mode: 'execute',
            thinking: '这是开放式详情页整理任务，需要保留已识别的屏级意图。',
            skillParams: {
              autoFix: false,
              structureMode: 'guided',
              visualValidation: true,
              userIntent: '把这个画面整理得更高级一些并保留当前视觉重点'
            }
          })
        };
      }
    });

    cases.push({
      name: 'autonomous-agent-preserves-classifier-intent-context',
      status:
        callModelCount === 2
        && executed.length === 0
        && autonomousPlanningResult?.success === false
        && autonomousPlanningResult?.error === 'agent_task_plan_requires_model_planning'
        && autonomousPlanningResult?.data?.agentTaskPlan?.status === 'ready_for_model_planning'
        && autonomousPlanningResult?.data?.agentRequestLifecycle?.decision?.route === 'autonomous_agent'
        && autonomousPlanningResult?.data?.agentRequestLifecycle?.execution?.kind === 'autonomous_agent'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed, result: autonomousPlanningResult })
    });

    callModelCount = 0;
    executed = [];
    await engine.run(createContext('帮我关闭文档不保存'), {
      callModel: async () => {
        callModelCount += 1;
        return { text: '{}' };
      }
    });

    cases.push({
      name: 'deterministic-fallback-handles-document-close-when-router-is-empty',
      status:
        callModelCount === 1
        && executed.length === 1
        && executed[0].skillId === 'document-management'
        && executed[0].params?.action === 'close'
        && executed[0].params?.save === false
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed })
    });

    callModelCount = 0;
    executed = [];
    await engine.run(createContext('帮我关闭文档不保存'), {
      callModel: async () => {
        callModelCount += 1;
        return {
          text: JSON.stringify({
            route: 'skill_execution',
            skillId: 'agent-panel-bridge',
            thinking: '错误地当成调试桥接。',
            skillParams: { intent: 'debug_or_implement' }
          })
        };
      }
    });

    cases.push({
      name: 'internal-debug-bridge-cannot-hijack-ordinary-document-close',
      status:
        callModelCount === 1
        && executed.length === 1
        && executed[0].skillId === 'document-management'
        && executed[0].params?.action === 'close'
        && executed[0].params?.save === false
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed })
    });

    const bridgeHijackMatrix = [
      { input: '帮我检查一下当前详情页结构', expectedSkillId: 'detail-page-design' },
      { input: '帮我创建主图文档 并且建立主图模板', expectedSkillId: 'main-image-template-authoring' },
      { input: '帮我把字体全部改成思源黑体', expectedSkillId: 'text-font-replace' },
      { input: '参考图照着做生成同款版式', expectedSkillId: 'layout-replication' }
    ];
    const bridgeHijackResults = [];
    callModelCount = 0;
    for (const item of bridgeHijackMatrix) {
      executed = [];
      await engine.run(createContext(item.input), {
        callModel: async () => {
          callModelCount += 1;
          return {
            text: JSON.stringify({
              route: 'skill_execution',
              skillId: 'agent-panel-bridge',
              thinking: '错误地当成调试桥接。',
              skillParams: { intent: 'debug_or_implement' }
            })
          };
        }
      });
      bridgeHijackResults.push({
        input: item.input,
        expectedSkillId: item.expectedSkillId,
        executed: [...executed]
      });
    }

    cases.push({
      name: 'ordinary-user-facing-skills-cannot-be-hijacked-by-agent-panel-bridge',
      status:
        bridgeHijackResults.every((item) => item.executed.length === 1 && item.executed[0].skillId === item.expectedSkillId)
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, bridgeHijackResults })
    });

    callModelCount = 0;
    executed = [];
    const pausedMattingResult = await engine.run(createContext('帮我抠图'), {
      callModel: async () => {
        callModelCount += 1;
        return {
          text: JSON.stringify({
            route: 'skill_execution',
            skillId: 'matte-product',
            intentSummary: '用户想抠图。'
          })
        };
      }
    });

    cases.push({
      name: 'agent-matting-intent-is-paused-before-model-and-tools',
      status:
        callModelCount === 0
        && executed.length === 0
        && pausedMattingResult.success === false
        && pausedMattingResult.message.includes('抠图能力当前暂不从 Agent 对话端执行')
        && pausedMattingResult.data?.agentIntentControlPlane?.requestKind === 'uxp_user_tool_only'
        && pausedMattingResult.data?.agentIntentControlPlane?.toolScope === 'none'
        && pausedMattingResult.data?.agentRequestLifecycle?.decision?.skillId === 'matte-product'
        && pausedMattingResult.data?.agentRequestLifecycle?.execution?.kind === 'none'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed, pausedMattingResult })
    });

    callModelCount = 0;
    executed = [];
    await engine.run(createContext('好像没有改成功 再改一下', {
      conversationHistory: [
        { role: 'user', content: '帮我把字体全部改成思源黑体' },
        { role: 'assistant', content: '已尝试修改字体。' }
      ]
    }), {
      callModel: async () => {
        callModelCount += 1;
        return {
          text: JSON.stringify({
            route: 'skill_execution',
            skillId: 'agent-panel-bridge',
            thinking: '错误地当成调试桥接。',
            skillParams: { intent: 'debug_or_implement' }
          })
        };
      }
    });

    cases.push({
      name: 'retry-feedback-continues-previous-action-not-debug-bridge',
      status:
        callModelCount === 1
        && executed.length === 1
        && executed[0].skillId === 'text-font-replace'
        && executed[0].params?.retry === true
        && executed[0].params?.retryFeedback === '好像没有改成功 再改一下'
        && executed[0].params?.previousUserIntent === '帮我把字体全部改成思源黑体'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed })
    });

    callModelCount = 0;
    executed = [];
    await engine.run(createContext('帮我关闭文档'), {
      callModel: async () => {
        callModelCount += 1;
        return { text: '{}' };
      }
    });

    cases.push({
      name: 'deterministic-close-without-save-does-not-flip-to-save-true',
      status:
        callModelCount === 1
        && executed.length === 1
        && executed[0].skillId === 'document-management'
        && executed[0].params?.action === 'close'
        && executed[0].params?.save !== true
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed })
    });

    callModelCount = 0;
    executed = [];
    await engine.run(createContext('我想你理解一下项目中的图片'), {
      callModel: async () => {
        callModelCount += 1;
        return { text: '{}' };
      }
    });

    cases.push({
      name: 'deterministic-fallback-still-handles-project-image-analysis',
      status:
        callModelCount === 1
        && executed.length === 1
        && executed[0].skillId === 'project-image-analysis'
        && executed[0].params?.focus === 'style-and-detail-page'
        && executed[0].params?.sampleSize === 6
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed })
    });

    callModelCount = 0;
    executed = [];
    const readOnlyProjectOverviewResult = await engine.run(createContext('帮我看看当前是个什么项目'), {
      callModel: async () => {
        callModelCount += 1;
        return {
          text: JSON.stringify({
            route: 'autonomous_agent',
            thinking: '错误地把只读项目概览当成自主工具循环。'
          })
        };
      }
    });

    cases.push({
      name: 'engine-control-plane-keeps-project-overview-readonly-and-routed',
      status:
        callModelCount === 1
        && executed.length === 1
        && executed[0].skillId === 'project-image-analysis'
        && readOnlyProjectOverviewResult?.data?.agentIntentControlPlane?.requestKind === 'read_only_inspect'
        && readOnlyProjectOverviewResult?.data?.agentIntentControlPlane?.toolScope === 'read_only'
        && readOnlyProjectOverviewResult?.data?.agentRequestLifecycle?.decision?.source === 'deterministic_route'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed, result: readOnlyProjectOverviewResult })
    });

    callModelCount = 0;
    executed = [];
    const readOnlyProjectInventoryResult = await engine.run(createContext('你可以帮我看看这个项目都有什么'), {
      callModel: async () => {
        callModelCount += 1;
        return {
          text: JSON.stringify({
            route: 'autonomous_agent',
            thinking: '错误地把项目资源清单当成自主工具循环。'
          })
        };
      }
    });

    cases.push({
      name: 'engine-resource-decision-keeps-project-inventory-metadata-only',
      status:
        callModelCount === 1
        && executed.length === 1
        && executed[0].skillId === 'project-image-analysis'
        && executed[0].params?.analysisMode === 'inventory'
        && executed[0].params?.sampleSize === 0
        && readOnlyProjectInventoryResult?.data?.agentRequestLifecycle?.performancePolicy?.taskClass === 'project-inventory'
        && readOnlyProjectInventoryResult?.data?.agentRequestLifecycle?.resourceDecision?.path === 'metadata-only'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed, result: readOnlyProjectInventoryResult })
    });

    callModelCount = 0;
    executed = [];
    const planOnlyAutonomousHijackResult = await engine.run(createContext('看看我们是否可以开始做主图详情页了'), {
      callModel: async (messages) => {
        callModelCount += 1;
        const systemPrompt = String(messages?.[0]?.content || '');
        if (systemPrompt.includes('intent router')) {
          return {
            text: JSON.stringify({
              route: 'autonomous_agent',
              skillId: 'detail-page-design',
              thinking: '错误地把阶段准备度讨论当成详情页执行。'
            })
          };
        }
        return { text: '可以开始讨论主图和详情页，但需要先确认剩余缺口，不会直接执行工具。' };
      }
    });

    cases.push({
      name: 'engine-control-plane-blocks-plan-question-tool-hijack',
      status:
        callModelCount === 1
        && executed.length === 0
        && planOnlyAutonomousHijackResult?.success === true
        && planOnlyAutonomousHijackResult?.data?.agentIntentControlPlane?.requestKind === 'plan_only'
        && planOnlyAutonomousHijackResult?.data?.agentIntentControlPlane?.toolScope === 'none'
        && planOnlyAutonomousHijackResult?.data?.agentRequestLifecycle?.decision?.source === 'intent_control_plane'
        && planOnlyAutonomousHijackResult?.data?.agentRequestLifecycle?.execution?.kind === 'none'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed, result: planOnlyAutonomousHijackResult })
    });

    callModelCount = 0;
    executed = [];
    const ambiguousNoModelResult = await engine.run(createContext('帮我处理一下'), {});

    cases.push({
      name: 'engine-control-plane-clarifies-ambiguous-request-without-model-or-tools',
      status:
        callModelCount === 0
        && executed.length === 0
        && ambiguousNoModelResult?.success === true
        && String(ambiguousNoModelResult?.message || '').includes('需要先明确')
        && ambiguousNoModelResult?.data?.agentIntentControlPlane?.requestKind === 'clarify'
        && ambiguousNoModelResult?.data?.agentRequestLifecycle?.decision?.route === 'clarification_needed'
        && ambiguousNoModelResult?.data?.agentRequestLifecycle?.execution?.kind === 'none'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed, result: ambiguousNoModelResult })
    });

    callModelCount = 0;
    executed = [];
    let clarificationFollowupPromptSeen = false;
    const clarificationFollowupResult = await engine.run(createContext('比如呢', {
      conversationHistory: [
        { role: 'user', content: '帮我处理一下' },
        { role: 'assistant', content: '需要先明确要处理的目标、具体动作和交付结果，然后我才能安全执行 Photoshop 工具。请补充：要处理哪个图层或画面、想达到什么效果、是否允许修改当前文档。' }
      ]
    }), {
      callModel: async (messages) => {
        callModelCount += 1;
        const systemPrompt = String(messages?.[0]?.content || '');
        const serializedMessages = JSON.stringify(messages);
        clarificationFollowupPromptSeen = clarificationFollowupPromptSeen
          || (
            systemPrompt.includes('上一轮澄清')
            && systemPrompt.includes('不要用固定的工具禁用话术代替解释')
            && serializedMessages.includes('需要先明确要处理的目标')
          );
        return { text: '模型生成的澄清追问回答：请补目标对象、动作边界和交付范围，并给出贴合上一轮任务的表达样例。' };
      }
    });

    cases.push({
      name: 'engine-clarification-followup-consults-model-with-recent-context-without-tools',
      status:
        callModelCount === 1
        && executed.length === 0
        && clarificationFollowupResult?.success === true
        && clarificationFollowupPromptSeen
        && String(clarificationFollowupResult?.message || '').includes('模型生成的澄清追问回答')
        && !String(clarificationFollowupResult?.message || '').includes('这是对话问题')
        && clarificationFollowupResult?.data?.agentIntentControlPlane?.requestKind === 'chat_only'
        && clarificationFollowupResult?.data?.agentRequestLifecycle?.decision?.route === 'direct_response'
        && clarificationFollowupResult?.data?.agentRequestLifecycle?.execution?.kind === 'none'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed, clarificationFollowupPromptSeen, result: clarificationFollowupResult })
    });

    callModelCount = 0;
    executed = [];
    const ambiguousUnauthorizedAutonomousResult = await engine.run(createContext('帮我处理一下'), {
      callModel: async () => {
        callModelCount += 1;
        return {
          text: JSON.stringify({
            route: 'autonomous_agent',
            thinking: '信息不足但错误地准备工具循环。'
          })
        };
      }
    });

    cases.push({
      name: 'engine-control-plane-blocks-unauthorized-autonomous-fallback',
      status:
        callModelCount === 0
        && executed.length === 0
        && ambiguousUnauthorizedAutonomousResult?.success === true
        && ambiguousUnauthorizedAutonomousResult?.data?.agentIntentControlPlane?.requestKind === 'clarify'
        && ambiguousUnauthorizedAutonomousResult?.data?.agentIntentControlPlane?.toolScope === 'none'
        && ambiguousUnauthorizedAutonomousResult?.data?.agentRequestLifecycle?.decision?.route === 'clarification_needed'
        && ambiguousUnauthorizedAutonomousResult?.data?.agentRequestLifecycle?.execution?.kind === 'none'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed, result: ambiguousUnauthorizedAutonomousResult })
    });

    callModelCount = 0;
    executed = [];
    const readOnlyInspectResult = await engine.run(createContext('当前文档一共有几个图层？'), {
      callModel: async () => {
        callModelCount += 1;
        return {
          text: JSON.stringify({
            route: 'autonomous_agent',
            thinking: '错误地把只读问题当成自主工具循环。'
          })
        };
      }
    });

    cases.push({
      name: 'engine-control-plane-keeps-readonly-inspection-on-deterministic-skill',
      status:
        callModelCount === 1
        && executed.length === 1
        && executed[0].skillId === 'layer-management'
        && executed[0].params?.action === 'inspect'
        && readOnlyInspectResult?.data?.agentIntentControlPlane?.requestKind === 'read_only_inspect'
        && readOnlyInspectResult?.data?.agentIntentControlPlane?.toolScope === 'read_only'
        && readOnlyInspectResult?.data?.agentRequestLifecycle?.decision?.source === 'deterministic_route'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed, result: readOnlyInspectResult })
    });

    callModelCount = 0;
    executed = [];
    const mainImageConversionResult = await engine.run(createContext('帮我做转化图 在Adobe Photoshop文档中有800文档'), {
      callModel: async () => {
        callModelCount += 1;
        return {
          text: JSON.stringify({
            route: 'skill_execution',
            skillId: 'main-image-design',
            thinking: '用户明确要做转化图，并指出当前 Photoshop 中有 800 文档，应进入主图业务技能。',
            skillParams: {
              size: '800',
              imageType: 'conversion'
            }
          })
        };
      }
    });

    cases.push({
      name: 'engine-routes-main-image-conversion-request-without-generic-clarification',
      status:
        callModelCount === 1
        && executed.length === 1
        && executed[0].skillId === 'main-image-design'
        && executed[0].params?.size === '800'
        && executed[0].params?.imageType === 'conversion'
        && mainImageConversionResult?.data?.agentIntentControlPlane?.requestKind === 'execute_skill'
        && mainImageConversionResult?.data?.agentIntentControlPlane?.requiresClarificationBeforeTools === false
        && mainImageConversionResult?.data?.agentIntentControlPlane?.matchedSignals?.includes('shared_skill_routing:main-image-design')
        && mainImageConversionResult?.data?.agentRequestLifecycle?.decision?.source === 'model_router'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed, result: mainImageConversionResult })
    });

    callModelCount = 0;
    executed = [];
    const lifecycleCloseResult = await engine.run(createContext('帮我关闭文档不保存'), {
      callModel: async () => {
        callModelCount += 1;
        return { text: '{}' };
      }
    });
    const closeLifecycle = lifecycleCloseResult.data?.agentRequestLifecycle;

    cases.push({
      name: 'request-lifecycle-records-deterministic-document-route',
      status:
        callModelCount === 1
        && closeLifecycle?.version === 'agent-request-lifecycle/v0'
        && closeLifecycle?.decision?.source === 'deterministic_route'
        && closeLifecycle?.decision?.route === 'skill_execution'
        && closeLifecycle?.decision?.skillId === 'document-management'
        && closeLifecycle?.execution?.kind === 'deterministic_skill'
        && closeLifecycle?.execution?.requiresPhotoshop === true
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, lifecycle: closeLifecycle })
    });

    callModelCount = 0;
    executed = [];
    const lifecycleSaveResult = await engine.run(createContext('帮我把详情页文档保存到项目的PSD中'), {
      callModel: async () => {
        callModelCount += 1;
        return {
          text: JSON.stringify({
            route: 'skill_execution',
            skillId: 'detail-page-design',
            thinking: '错误地当成详情页执行。',
            skillParams: { mode: 'execute' }
          })
        };
      }
    });
    const saveLifecycle = lifecycleSaveResult.data?.agentRequestLifecycle;

    cases.push({
      name: 'request-lifecycle-keeps-save-request-on-document-management',
      status:
        executed.length === 1
        && executed[0].skillId === 'document-management'
        && executed[0].params?.action === 'save'
        && saveLifecycle?.decision?.source === 'deterministic_route'
        && saveLifecycle?.decision?.skillId === 'document-management'
        && saveLifecycle?.decision?.route === 'skill_execution'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed, lifecycle: saveLifecycle })
    });

    callModelCount = 0;
    executed = [];
    const lifecycleAutonomousResult = await engine.run(createContext('帮我根据当前画面做一个更高级的设计'), {
      callModel: async (_messages, requestOptions) => {
        callModelCount += 1;
        if (requestOptions?.purpose !== 'router') {
          return { text: '' };
        }
        return {
          text: JSON.stringify({
            route: 'autonomous_agent',
            intentSummary: '用户需要开放式设计执行，需要工具循环探索当前画面。',
            skillParams: { styleGoal: '更高级' }
          })
        };
      }
    });
    const autonomousLifecycle = lifecycleAutonomousResult.data?.agentRequestLifecycle;

    cases.push({
      name: 'request-lifecycle-records-model-autonomous-route',
      status:
        callModelCount === 2
        && executed.length === 0
        && lifecycleAutonomousResult?.success === false
        && lifecycleAutonomousResult?.error === 'agent_task_plan_requires_model_planning'
        && autonomousLifecycle?.decision?.source === 'model_router'
        && autonomousLifecycle?.decision?.route === 'autonomous_agent'
        && autonomousLifecycle?.execution?.kind === 'autonomous_agent'
        && lifecycleAutonomousResult?.data?.agentTaskPlan?.status === 'ready_for_model_planning'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ callModelCount, executed, lifecycle: autonomousLifecycle, result: lifecycleAutonomousResult })
    });
  } finally {
    skillExecutors.getSkillExecutor = originalGetSkillExecutor;
    skillExecutors.executeSkillWithExecutor = originalExecuteSkillWithExecutor;
  }

  const success = cases.every((item) => item.status === 'pass');
  const payload = { success, cases };
  const report = writeReport(payload);
  console.log(JSON.stringify({ ...payload, report }, null, 2));
  process.exit(success ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
