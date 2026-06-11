#!/usr/bin/env node

const path = require('path');
const fs = require('fs');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const repoRoot = path.resolve(__dirname, '..');
const localStorageData = new Map();
global.localStorage = {
  getItem: (key) => localStorageData.has(key) ? localStorageData.get(key) : null,
  setItem: (key, value) => localStorageData.set(key, String(value)),
  removeItem: (key) => localStorageData.delete(key),
  clear: () => localStorageData.clear()
};

const { mainImageExecutor } = require(path.join(repoRoot, 'src', 'renderer', 'services', 'skill-executors', 'main-image.executor.ts'));
const { getMemoryService } = require(path.join(repoRoot, 'src', 'renderer', 'services', 'memory.service.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function assertNoRawPayload(value, label) {
  const serialized = JSON.stringify(value);
  const forbidden = ['raw-image-payload', 'base64-image-payload', 'data:image/'];
  const found = forbidden.filter((token) => serialized.includes(token));
  assert(found.length === 0, `${label} leaked raw image payload markers: ${found.join(', ')}`, value);
}

function assertNoConfidence(value, label) {
  const serialized = JSON.stringify(value);
  assert(!serialized.includes('"confidence"') && !serialized.includes('置信'), `${label} should not expose confidence fields`, value);
}

const baseParams = {
  userIntent: 'raw-image-payload 看项目图片理解袜子款式，制作点击图和转化图 data:image/png;base64,abc',
  imageType: 'click',
  assetPath: 'C:/project/assets/white-slouch-socks-01.png',
  assetWidth: 1600,
  assetHeight: 1600,
  outputDir: 'C:/Exports',
  subjectBounds: {
    left: 250,
    top: 360,
    right: 1330,
    bottom: 980,
    width: 1080,
    height: 620
  },
  sizePlans: [
    {
      sizeKey: '800',
      targetSize: { width: 1440, height: 1440 },
      subjectSize: { width: 900, height: 620 },
      scale: 0.72,
      targetX: 396,
      targetY: 497,
      decisionReason: '1:1 controlled executor branch smoke',
      smartLayoutPlanned: true,
      quickExportPlanned: true
    },
    {
      sizeKey: '750',
      targetSize: { width: 1440, height: 1920 },
      subjectSize: { width: 900, height: 620 },
      scale: 0.72,
      targetX: 396,
      targetY: 737,
      decisionReason: '3:4 controlled executor branch smoke',
      smartLayoutPlanned: true,
      quickExportPlanned: true
    },
    {
      sizeKey: '1200',
      targetSize: { width: 1440, height: 2560 },
      subjectSize: { width: 900, height: 620 },
      scale: 0.72,
      targetX: 396,
      targetY: 1057,
      decisionReason: '9:16 controlled executor branch smoke',
      smartLayoutPlanned: true,
      quickExportPlanned: true
    }
  ],
  copyCandidates: ['轻薄堆叠，春夏更自在'],
  knowledgeResults: [
    {
      id: 'web:main-image-reference',
      title: '袜子主图参考',
      intent: 'reference',
      sourceType: 'web_page',
      summary: '浅色袜子主图常用干净背景、主体放大和短标题。',
      evidence: ['Source URL: https://example.com/socks-main-image'],
      tags: ['socks', 'main-image'],
      allowedUses: ['prompt_context', 'user_reference'],
      evidenceLevel: 'external_snippet',
      sourceRank: 58,
      sourceUrl: 'https://example.com/socks-main-image',
      updatedAt: '2026-05-26T00:00:00.000Z'
    }
  ],
  visionSignal: {
    source: 'manual-annotation',
    productType: '堆堆袜',
    subjectSummary: '白色堆堆袜，松弛褶皱感，适合春夏主图',
    backgroundSummary: '浅色背景',
    evidence: ['人工标注：白色堆堆袜']
  },
  userCheckpointApproved: true
};

async function execute(params) {
  const messages = [];
  const progress = [];
  const result = await mainImageExecutor.execute({
    params,
    callbacks: {
      onMessage: (message) => messages.push(String(message || '')),
      onProgress: (message, percent) => progress.push({ message, percent })
    },
    context: {
      userInput: params.userIntent,
      projectContext: {
        selectedProjectImagePath: params.assetPath,
        sampleImagePaths: [params.assetPath]
      }
    }
  });
  return { result, messages, progress };
}

async function run() {
  const executorSource = fs.readFileSync(path.join(repoRoot, 'src', 'renderer', 'services', 'skill-executors', 'main-image.executor.ts'), 'utf8');
  assert(executorSource.includes('extractMainImageControlledProductResultPaths'), 'controlled product branch should extract runner result paths for file probes');
  assert(executorSource.includes('probeMainImageResultFiles(controlledResultPaths)'), 'controlled product branch should probe exported result files after runner');
  assert(executorSource.includes('compareMainImageResultToReference'), 'controlled product branch should reuse pixel probe adapter when reference image is available');
  assert(executorSource.includes('resultFileProbeSummary'), 'controlled product branch response should expose file probe summary in the message');
  assert(executorSource.includes('buildMainImageControlledProductQaEvidence'), 'controlled product branch should bridge runner evidence into screenshot QA evidence');
  assert(executorSource.includes('buildMainImageAgentDraftPlan'), 'controlled product branch should build a real agent draft from controlled inputs before final QA');
  assert(executorSource.includes('mainImageAgentDraft: controlledAgentDraft'), 'controlled product branch should expose controlled agent draft data');
  assert(executorSource.includes('data.mainImageScreenshotQa'), 'controlled product branch should expose canonical mainImageScreenshotQa data');
  assert(executorSource.includes('data.mainImageScreenshotProbeReadiness'), 'controlled product branch should expose canonical mainImageScreenshotProbeReadiness data');
  assert(executorSource.includes('data.mainImageControlledProductQaBridge'), 'controlled product branch should expose redacted controlled product QA bridge data');
  assert(executorSource.includes('buildMainImageQaReport({'), 'controlled product branch should let final mainImageQaReport aggregate real controlled evidence');
  assert(executorSource.includes('data.mainImageQaReport = mainImageQaReport'), 'controlled product branch should expose final QA report only after controlled evidence is built');
  assert(!executorSource.includes('data.mainImageQaReport = controlledProductQaEvidence'), 'controlled product branch must not fake final mainImageQaReport from bridge evidence alone');

  const defaultRun = await execute(baseParams);
  assert(defaultRun.result.success === true, 'default main-image executor should return strategy-only evidence successfully', defaultRun.result);
  assert(defaultRun.result.data?.mainImageExecutionMode === 'strategy-only', 'default execution mode should be strategy-only', defaultRun.result.data);
  assert((defaultRun.result.toolResults || []).length === 0, 'default strategy-only branch must not call Photoshop tools', defaultRun.result.toolResults);
  assert(defaultRun.result.data?.mainImageStrategyInputEvidence?.status === 'ready_for_strategy_contract', 'strategy-only branch should expose strategy input evidence', defaultRun.result.data);
  assert(defaultRun.result.data?.mainImageDesignCoreEvidence === defaultRun.result.data?.mainImageStrategyInputEvidence?.designCoreEvidence, 'strategy-only branch should expose design core evidence as a stable top-level alias', defaultRun.result.data);
  assert(defaultRun.result.data?.mainImageDesignConceptPlan === defaultRun.result.data?.mainImageStrategyInputEvidence?.designConceptPlan, 'strategy-only branch should expose design concept plan as a stable top-level alias', defaultRun.result.data);
  assert(defaultRun.result.data?.mainImageCopyEvidence === defaultRun.result.data?.mainImageStrategyInputEvidence?.copyEvidence, 'strategy-only branch should expose copy evidence as a stable top-level alias', defaultRun.result.data);
  assert(defaultRun.result.data?.mainImageDesignConceptPlan?.status === 'ready_design_concept_plan', 'strategy-only concept plan should be ready when controlled inputs are grounded', defaultRun.result.data?.mainImageDesignConceptPlan);
  assert(defaultRun.result.data?.mainImageCopyEvidence?.status === 'ready_copy_evidence', 'strategy-only copy evidence should be ready when copy candidates and vision grounding are present', defaultRun.result.data?.mainImageCopyEvidence);
  assert(
    defaultRun.result.data?.mainImageStrategyInputEvidence?.projectStyleStrategyEvidence?.referenceResearchPlan?.referenceHintCount === 1,
    'strategy-only branch should pass knowledge results into main-image reference evidence',
    defaultRun.result.data?.mainImageStrategyInputEvidence?.projectStyleStrategyEvidence?.referenceResearchPlan
  );
  assert(
    defaultRun.result.data?.mainImageStrategyInputEvidence?.strategyInputs?.copyRolePolicy?.referenceCount === 1,
    'strategy-only copy role policy should expose mapped knowledge reference count',
    defaultRun.result.data?.mainImageStrategyInputEvidence?.strategyInputs?.copyRolePolicy
  );
  assertNoConfidence(
    defaultRun.result.data?.mainImageStrategyInputEvidence?.projectStyleStrategyEvidence?.referenceResearchPlan,
    'strategy-only mapped reference plan'
  );
  assert(defaultRun.result.data?.mainImageLiveExecutorRequestPackage?.status === 'ready_for_executor_dispatch', 'strategy-only branch may prepare request package without dispatching', defaultRun.result.data);
  assert(defaultRun.result.data?.mainImageControlledProductRunner === undefined, 'strategy-only branch must not run live runner', defaultRun.result.data);
  assertNoRawPayload(defaultRun.result, 'default strategy-only executor result');

  const memory = getMemoryService();
  memory.updatePreferences({
    design: {
      preferredFonts: ['阿里巴巴普惠体'],
      preferredColors: ['#f8f8f8'],
      preferredStyles: ['浅色干净']
    },
    workflow: {
      defaultExportFormat: 'jpg'
    }
  });
  const memoryOnlyRun = await execute({
    ...baseParams,
    knowledgeResults: undefined
  });
  const memoryReferencePlan = memoryOnlyRun.result.data?.mainImageStrategyInputEvidence?.projectStyleStrategyEvidence?.referenceResearchPlan;
  const memoryEvidence = memoryOnlyRun.result.data?.mainImageStrategyInputEvidence?.mainImageMemoryEvidence;
  const memoryCopyPolicy = memoryOnlyRun.result.data?.mainImageStrategyInputEvidence?.strategyInputs?.copyRolePolicy;
  assert(
    memoryReferencePlan?.referenceHintCount === 0,
    'renderer memory preferences should not be mixed into external reference evidence',
    memoryReferencePlan
  );
  assert(
    memoryEvidence?.status === 'available'
      && memoryEvidence.preferenceSummary?.stylePreferences?.includes('浅色干净')
      && memoryEvidence.preferenceSummary?.typographyPreferences?.includes('阿里巴巴普惠体'),
    'strategy-only branch should expose renderer memory preferences as structured mainImageMemoryEvidence',
    memoryEvidence
  );
  assert(
    memoryCopyPolicy?.designMemory?.sourceResultCount >= 1,
    'memory evidence should reach copyRolePolicy.designMemory without becoming referenceCount',
    memoryCopyPolicy
  );
  assert(memoryCopyPolicy?.referenceCount === 0, 'memory-only run should not inflate external reference count', memoryCopyPolicy);
  assertNoConfidence(memoryReferencePlan, 'memory-driven reference plan');
  assertNoConfidence(memoryEvidence, 'memory-driven structured evidence');

  const defaultThreeSpecParams = { ...baseParams };
  delete defaultThreeSpecParams.sizePlans;
  delete defaultThreeSpecParams.size;
  delete defaultThreeSpecParams.sizes;
  const defaultThreeSpecRun = await execute(defaultThreeSpecParams);
  const defaultThreeSpecDocuments = defaultThreeSpecRun.result.data?.mainImageStrategyInputEvidence?.productionExecutionPlanEvidence?.documents || [];
  const defaultThreeSpecSizeKeys = defaultThreeSpecDocuments
    .map((doc) => String(doc.sizeProfileId || '').match(/tmall-(800|750|1200)-main-image/)?.[1])
    .filter(Boolean);
  const defaultThreeSpecExportSpecs = defaultThreeSpecRun.result.data?.mainImageStrategyInputEvidence?.productionExecutionPlanEvidence?.exportSpecs || [];
  const exportTypes1200 = defaultThreeSpecExportSpecs
    .filter((spec) => String(spec.documentId || '').includes('1200'))
    .map((spec) => spec.imageType);
  const designCoreDocuments = defaultThreeSpecRun.result.data?.mainImageDesignCoreEvidence?.deliveryDocuments || [];
  const designCoreDocumentKeys = designCoreDocuments.map((doc) => doc.folderKey);
  const document1200 = designCoreDocuments.find((doc) => doc.folderKey === '1200');
  assert(
    JSON.stringify(defaultThreeSpecSizeKeys) === JSON.stringify(['800', '750', '1200']),
    'default strategy-only branch should infer all three production size plans when the user only says to make main images',
    defaultThreeSpecRun.result.data
  );
  assert(
    JSON.stringify(designCoreDocumentKeys) === JSON.stringify(['800', '750', '1200'])
      && document1200?.includedImageTypes?.length === 1
      && document1200.includedImageTypes[0] === 'click'
      && document1200.excludedImageTypes?.includes('conversion')
      && exportTypes1200.length > 0
      && exportTypes1200.every((imageType) => imageType === 'click'),
    'design core evidence should expose 800/750/1200 documents and forbid conversion image in 1200',
    {
      designCoreEvidence: defaultThreeSpecRun.result.data?.mainImageDesignCoreEvidence,
      exportTypes1200
    }
  );
  assert(
    defaultThreeSpecRun.result.data?.mainImageDesignCoreEvidence?.whiteBackgroundSpec?.sourceDocumentPath === 'PSD/SKU.psb'
      && defaultThreeSpecRun.result.data?.mainImageDesignCoreEvidence?.whiteBackgroundSpec?.outputPath === '主图/白底.jpg'
      && defaultThreeSpecRun.result.data?.mainImageDesignCoreEvidence?.whiteBackgroundSpec?.canvasSize?.width === 800
      && defaultThreeSpecRun.result.data?.mainImageDesignCoreEvidence?.whiteBackgroundSpec?.canvasSize?.height === 800,
    'design core evidence should expose white background export rules from SKU source document',
    defaultThreeSpecRun.result.data?.mainImageDesignCoreEvidence?.whiteBackgroundSpec
  );

  const staleExternalPlansRun = await execute({
    ...baseParams,
    sizePlans: [
      {
        sizeKey: 'tmall-1x1-main-image',
        targetSize: { width: 800, height: 800 },
        subjectSize: { width: 620, height: 420 },
        scale: 0.72,
        targetX: 90,
        targetY: 270,
        decisionReason: 'legacy external 1x1 plan',
        smartLayoutPlanned: true,
        quickExportPlanned: true
      },
      {
        sizeKey: 'tmall-3x4-main-image',
        targetSize: { width: 800, height: 1067 },
        subjectSize: { width: 620, height: 420 },
        scale: 0.72,
        targetX: 90,
        targetY: 380,
        decisionReason: 'legacy external 3x4 plan',
        smartLayoutPlanned: true,
        quickExportPlanned: true
      }
    ]
  });
  const normalizedExternalDocuments = staleExternalPlansRun.result.data?.mainImageStrategyInputEvidence?.productionExecutionPlanEvidence?.documents || [];
  const normalizedExternalKeys = normalizedExternalDocuments
    .map((doc) => String(doc.sizeProfileId || '').match(/tmall-(800|750|1200)-main-image/)?.[1])
    .filter(Boolean);
  assert(
    staleExternalPlansRun.result.data?.mainImageStrategyInputEvidence?.productionExecutionPlanEvidence?.status === 'ready_execution_plan'
      && JSON.stringify(normalizedExternalKeys) === JSON.stringify(['800', '750', '1200']),
    'external legacy sizePlans should be normalized and completed to the project 800/750/1200 delivery contract',
    staleExternalPlansRun.result.data?.mainImageStrategyInputEvidence?.productionExecutionPlanEvidence
  );

  const missingApproval = await execute({
    ...baseParams,
    mainImageExecutionMode: 'product-disposable-live',
    executionScope: 'disposable-document',
    approvedLiveExecution: true,
    approvedLiveAdapterRun: false,
    photoshopConnection: { connected: true, documentWriteAvailable: true, source: 'smoke' }
  });
  assert(missingApproval.result.success === false, 'missing live adapter approval should block product disposable live branch', missingApproval.result);
  assert(missingApproval.result.data?.mainImageExecutionMode === 'product-disposable-live', 'blocked result should expose requested mode', missingApproval.result.data);
  assert((missingApproval.result.toolResults || []).length === 0, 'blocked product branch must not call Photoshop tools', missingApproval.result.toolResults);
  assert(missingApproval.result.data?.mainImageControlledProductAdapter?.status === 'blocked_requires_explicit_live_approval', 'missing adapter approval should be explicit', missingApproval.result.data);

  const missingConnection = await execute({
    ...baseParams,
    mainImageExecutionMode: 'product-disposable-live',
    executionScope: 'disposable-document',
    approvedLiveExecution: true,
    approvedLiveAdapterRun: true,
    photoshopConnection: { connected: false, documentWriteAvailable: false, source: 'smoke' }
  });
  assert(missingConnection.result.success === false, 'missing Photoshop connection should block before adapter execution', missingConnection.result);
  assert((missingConnection.result.toolResults || []).length === 0, 'missing connection branch must not call Photoshop tools', missingConnection.result.toolResults);
  assert(missingConnection.result.data?.mainImageLiveExecutorCheckpoint?.status === 'blocked_photoshop_unavailable', 'checkpoint should report Photoshop unavailable', missingConnection.result.data);

  const activeScope = await execute({
    ...baseParams,
    mainImageExecutionMode: 'product-disposable-live',
    executionScope: 'active-document',
    approvedLiveExecution: true,
    approvedLiveAdapterRun: true,
    photoshopConnection: { connected: true, documentWriteAvailable: true, source: 'smoke' }
  });
  assert(activeScope.result.success === false, 'active-document scope should be blocked for controlled product branch', activeScope.result);
  assert((activeScope.result.toolResults || []).length === 0, 'active-document blocked branch must not call Photoshop tools', activeScope.result.toolResults);
  assert(activeScope.result.data?.mainImageLiveExecutorCheckpoint?.status === 'ready_for_live_executor_run', 'checkpoint may be ready before adapter scope guard', activeScope.result.data);
  assert(activeScope.result.data?.mainImageControlledProductAdapter?.status === 'blocked_non_disposable_scope', 'adapter should reject non-disposable scope', activeScope.result.data);

  console.log(JSON.stringify({
    success: true,
    checks: [
      'default main-image executor is strategy-only and does not call Photoshop',
      'strategy-only branch exposes request/checkpoint evidence without running the live runner',
      'product-disposable-live blocks without explicit adapter approval',
      'product-disposable-live blocks when Photoshop connection is unavailable',
      'product-disposable-live blocks non-disposable scopes before tool execution',
      'controlled product live branch is wired to result file probes and pixel probe adapter',
      'executor evidence redacts raw image-like payloads',
      'strategy-only branch can consume renderer memory preferences as structured memory evidence'
    ]
  }, null, 2));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
