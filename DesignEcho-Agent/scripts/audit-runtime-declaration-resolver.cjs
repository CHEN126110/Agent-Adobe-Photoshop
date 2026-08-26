'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const runtimeRoot = path.resolve(__dirname, '..', 'src', 'shared', 'agent-runtime-v5');
const {
  buildRuntimeDeclarationProfileCatalog,
  listDeclarableRuntimeTaskTypes,
  listDeclarableRuntimeWorkModes,
  resolveRuntimeDeclarationForAgentTask
} = require(path.join(runtimeRoot, 'runtime-declaration-resolver.ts'));
const {
  LEGACY_TOOL_CAPABILITY_MAP
} = require(path.join(runtimeRoot, 'tool-capability-bridge.ts'));
const {
  createSkillRuntimeRegistry,
  listSkillManifests
} = require(path.join(runtimeRoot, 'skill-runtime.ts'));
const {
  evaluateDesignEvaluationProfile,
  GENERAL_DESIGN_EVALUATION_PROFILE_ID,
  getDesignEvaluationProfileVlmAssertions,
  validateDesignEvaluationProfile
} = require(path.join(runtimeRoot, 'design-evaluation-profiles.ts'));
const {
  buildDesignMethodKnowledgeRuntimeContext,
  SKU_TEMPLATE_METHOD_KNOWLEDGE_ID
} = require(path.join(runtimeRoot, 'design-method-knowledge.ts'));
const {
  buildDesignTaskTypePromptSection,
  getDesignTaskTypeSpec
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'design-task-types.ts'));
const {
  getSkillById
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'skills', 'skill-declarations.ts'));
const {
  buildRuntimeReferenceEvaluationContext
} = require(path.join(runtimeRoot, 'runtime-reference-context.ts'));
const {
  createRuntimeDeclarationSiblingTurn,
  resolveRuntimeDeclarationSiblingPolicy
} = require(path.resolve(
  __dirname,
  '..',
  'src',
  'shared',
  'runtime-declaration-sibling-policy.ts'
));
const {
  projectManifestBoundRuntimeDeliveryReceipt,
  readRuntimeDeliveryProofKinds,
  verifyRuntimeDelivery
} = require(path.join(runtimeRoot, 'runtime-delivery-receipt.ts'));
const {
  resolveRuntimeExecutionTarget
} = require(path.join(runtimeRoot, 'runtime-execution-target.ts'));
const {
  resolveRuntimeStagePlanEffectiveContract
} = require(path.join(runtimeRoot, 'runtime-stage-plan.ts'));
const {
  buildDeclareDesignStrategyToolSchema,
  buildRuntimeDesignStrategyDigest,
  validateRuntimeDesignStrategyDeclaration
} = require(path.join(runtimeRoot, 'runtime-design-strategy-declaration.ts'));
const {
  getDefaultAgentTools
} = require(path.resolve(
  __dirname,
  '..',
  'src',
  'renderer',
  'services',
  'agent-runtime',
  'tool-schemas.ts'
));
const {
  consumePerformanceToolCallBudget,
  createPerformanceLedgerState,
  isInMutationExecutionReserveZone,
  readPerformanceBudgetExhaustion,
  resolveExecutionSupplyReserve,
  takeObservationReserveAdvice
} = require(path.resolve(
  __dirname,
  '..',
  'src',
  'renderer',
  'services',
  'agent-runtime',
  'performance-ledger.ts'
));
const {
  buildRecommendedSkillFastPathBaseline,
  createAgentCapabilitySession,
  REQUEST_AGENT_CAPABILITIES_TOOL_NAME
} = require(path.resolve(
  __dirname,
  '..',
  'src',
  'renderer',
  'services',
  'agent-runtime',
  'capability-session.ts'
));
const {
  buildSkillToolSchemas,
  buildSkillWorkflowBridgeObservation
} = require(path.resolve(
  __dirname,
  '..',
  'src',
  'renderer',
  'services',
  'skill-executors',
  'skill-tools.ts'
));
const {
  Agent
} = require(path.resolve(
  __dirname,
  '..',
  'src',
  'renderer',
  'services',
  'agent-runtime',
  'agent.ts'
));
const {
  runFinalQualityModelProtocol
} = require(path.resolve(
  __dirname,
  '..',
  'src',
  'renderer',
  'services',
  'agent-runtime',
  'final-quality-model-protocol.ts'
));
const {
  buildModelVisualPresentationReceipt,
  projectSerializedVisualImageDataUrl
} = require(path.resolve(
  __dirname,
  '..',
  'src',
  'shared',
  'model-visual-presentation-receipt.ts'
));
const {
  clearDynamicModels,
  getDynamicModels,
  setDynamicModels
} = require(path.resolve(
  __dirname,
  '..',
  'src',
  'shared',
  'config',
  'dynamic-model-registry.ts'
));
const {
  DESIGN_ASSERTIONS,
  TASK_NEUTRAL_DESIGN_ASSERTIONS
} = require(path.resolve(
  __dirname,
  '..',
  'src',
  'shared',
  'design-quality-assertion.ts'
));
const {
  buildAgentIntentControlPlaneDecision,
  buildAutonomousExecutionDecisionForEngine
} = require(path.resolve(
  __dirname,
  '..',
  'src',
  'shared',
  'agent-intent-control-plane.ts'
));
const {
  buildAgentTaskPlanningContract
} = require(path.resolve(
  __dirname,
  '..',
  'src',
  'shared',
  'agent-task-planning-contract.ts'
));
const {
  resolveBareContinuationResumeDecision
} = require(path.resolve(
  __dirname,
  '..',
  'src',
  'shared',
  'agent-bare-continuation-resume.ts'
));
const {
  buildAgentToolDecisionContract
} = require(path.resolve(
  __dirname,
  '..',
  'src',
  'shared',
  'agent-tool-decision-contract.ts'
));
const {
  bindRuntimeSessionIdentity,
  acknowledgeRuntimeSessionWorkflowDocumentReobservation,
  advanceRuntimeSessionGeneration,
  canReleaseRuntimeSessionDocumentWriter,
  claimRuntimeTaskRunWriterBinding,
  claimRuntimeSessionDocumentWriter,
  createRuntimeSession,
  createRuntimeSessionIdentity,
  evaluateRuntimeSessionToolExecutionGate,
  finalizeRuntimeSession,
  markRuntimeSessionSkillEffectUnknown,
  observeRuntimeSessionDocumentRevision,
  recordRuntimeSessionSkillRevisionTransition,
  releaseRuntimeTaskRunWriterBinding,
  suspendRuntimeSessionForInteraction
} = require(path.join(runtimeRoot, 'runtime-session.ts'));
const {
  RUNTIME_INTERACTIVE_CHECKPOINT_VERSION,
  RUNTIME_INTERACTIVE_HANDOFF_IDENTITY_VERSION,
  createRuntimeInteractiveBoundaries,
  shouldDeferRuntimeArtifactFinalizationForInteraction
} = require(path.join(runtimeRoot, 'runtime-interactive-reentry.ts'));
const {
  refreshActiveRuntimeInteractivePendingReentry,
  registerActiveRuntimeInteractiveCheckpoint
} = require(path.resolve(
  __dirname,
  '..',
  'src',
  'renderer',
  'services',
  'agent-runtime',
  'active-runtime-interactive-continuation.ts'
));
const {
  abortRuntimeInteractiveResumeToPersistentRecovery,
  adoptRuntimeInteractiveResume,
  buildRuntimeInteractivePostSkillRecovery,
  buildRuntimeInteractiveSkillExecutionLineage,
  cancelRuntimeInteractiveResume,
  commitRuntimeInteractiveResume,
  prepareRuntimeInteractiveResume,
  resolveRuntimeInteractiveHandoff,
  stageRuntimeInteractiveReentry
} = require(path.resolve(
  __dirname,
  '..',
  'src',
  'renderer',
  'services',
  'design-agent',
  'interactive-continuation-reentry-controller.ts'
));
const {
  reconcileRuntimeSkillEffectBeforeAgentAction,
  resolveRuntimeInteractiveAgentReentryState
} = require(path.resolve(
  __dirname,
  '..',
  'src',
  'renderer',
  'services',
  'agent-runtime',
  'runtime-interactive-reentry-adapter.ts'
));
const {
  markPrimaryVisualObservationsConsumed,
  writeAgentVisualObservation,
  writeAgentVisualObservationReceipt
} = require(path.resolve(
  __dirname,
  '..',
  'src',
  'renderer',
  'services',
  'agent-runtime',
  'visual-observation-strategy.ts'
));
const {
  compactPostWriteImagePayloadForRuntimeLog,
  extractImageFromToolResult
} = require(path.resolve(
  __dirname,
  '..',
  'src',
  'renderer',
  'services',
  'agent-runtime',
  'tool-result-sanitizer.ts'
));
const {
  VISUAL_OBSERVATION_RECEIPT_VERSION
} = require(path.resolve(
  __dirname,
  '..',
  'src',
  'shared',
  'visual-observation-bundle.ts'
));
const {
  resolveRuntimeInteractiveAgentContinuationStatus,
  runRuntimeInteractiveContinuation
} = require(path.resolve(
  __dirname,
  '..',
  'src',
  'renderer',
  'services',
  'design-agent',
  'interactive-continuation-reentry-runner.ts'
));
const {
  appendRuntimeActionPlanExecutionObservation,
  createRuntimeActionPlanExecutionJournal
} = require(path.join(runtimeRoot, 'runtime-action-plan-observation.ts'));
const {
  attachSkillExecutionEffectReceipt,
  readSkillExecutionEffectReceipt
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'skill-execution-effect.ts'));
const {
  beginRuntimeOwnedSkillToolLedgerScope,
  completeRuntimeOwnedSkillToolLedgerScope,
  createGuardedAtomicToolExecutor
} = require(path.resolve(
  __dirname,
  '..',
  'src',
  'shared',
  'agent-skill-atomic-tool-execution.ts'
));
const {
  decideStageIncompleteRecovery
} = require(path.resolve(
  __dirname,
  '..',
  'src',
  'shared',
  'agent-stage-incomplete-recovery.ts'
));
const {
  buildDesignReviewSetFromSingleSurface
} = require(path.resolve(
  __dirname,
  '..',
  'src',
  'shared',
  'visual-observation-bundle.ts'
));
const {
  extractFreshDesignSurfaceSnapshotFromToolResults
} = require(path.resolve(
  __dirname,
  '..',
  'src',
  'shared',
  'design-surface-snapshot-normalizer.ts'
));

const executableToolNames = Array.from(new Set([
  ...Object.values(LEGACY_TOOL_CAPABILITY_MAP).flat(),
  'sku-batch',
  'detail-page-design',
  'main-image-design'
]));

const catalog = buildRuntimeDeclarationProfileCatalog();
assert.strictEqual(catalog.version, 'runtime-declaration-profile-catalog/v0');
assert(catalog.declarableProfiles.length > 0, 'declarable profile catalog is empty');
const registryCoreSource = fs.readFileSync(
  path.join(runtimeRoot, 'skill-runtime-registry.ts'),
  'utf8'
);
const skillRuntimeFacadeSource = fs.readFileSync(
  path.join(runtimeRoot, 'skill-runtime.ts'),
  'utf8'
);
assert(
  !/from\s+['"]\.\/manifests\//.test(registryCoreSource),
  'generic Skill Runtime registry core imports a built-in business manifest'
);
assert(
  skillRuntimeFacadeSource.includes(
    'createSkillRuntimeRegistry(BUILT_IN_SKILL_MANIFESTS)'
  ),
  'default Skill Runtime facade does not compose the immutable registry factory'
);
assert(
  !skillRuntimeFacadeSource.includes('function buildUniqueManifestIndex'),
  'default Skill Runtime facade still owns registry indexing logic'
);
const methodTaskTypes = listSkillManifests()
  .filter((manifest) => manifest.planning_role === 'method')
  .map((manifest) => manifest.task_type);
assert.deepStrictEqual(catalog.excludedMethodTaskTypes, methodTaskTypes);

const profileIds = catalog.declarableProfiles.map((profile) => profile.profileId);
assert.strictEqual(new Set(profileIds).size, profileIds.length, 'declarable profile id duplicated');
assert(profileIds.includes('ecommerce.sku_batch.v1#default'));
assert(profileIds.includes('ecommerce.sku_color_card.v1#default'));
assert(profileIds.includes('ecommerce.sku_template.v1#default'));
assert(!profileIds.includes('ecommerce.detail_page.v1#analyze_only'));
assert(!profileIds.includes('ecommerce.detail_page.v1#export_only'));

const blockedIssueByProfileId = new Map(catalog.blockedProfiles.map((profile) => (
  [profile.profileId, profile.issues.map((issue) => issue.code)]
)));
assert(!blockedIssueByProfileId.has('ecommerce.sku_template.v1#default'));
assert(blockedIssueByProfileId.get('ecommerce.detail_page.v1#analyze_only')
  .includes('analyze_only_contract_not_read_only'));
assert(blockedIssueByProfileId.get('ecommerce.detail_page.v1#export_only')
  .includes('export_only_contract_not_delivery_only'));

const detailPageManifest = listSkillManifests()
  .find((manifest) => manifest.task_type === 'ecommerce.detail_page.v1');
assert(detailPageManifest, 'detail-page manifest is missing');
const incompleteDetailPageManifest = {
  ...detailPageManifest,
  work_mode_contracts: {
    ...detailPageManifest.work_mode_contracts,
    redesign: {
      ...detailPageManifest.work_mode_contracts.redesign,
      production_obligation: undefined
    }
  }
};
const incompleteProductionCatalog = buildRuntimeDeclarationProfileCatalog([
  incompleteDetailPageManifest
]);
const incompleteRedesign = incompleteProductionCatalog.blockedProfiles
  .find((profile) => profile.profileId === 'ecommerce.detail_page.v1#redesign');
assert(incompleteRedesign, 'production profile without obligation was published');
assert(incompleteRedesign.issues
  .some((issue) => issue.code === 'production_obligation_missing'));

const skuBatchManifest = listSkillManifests()
  .find((manifest) => manifest.task_type === 'ecommerce.sku_batch.v1');
assert(skuBatchManifest, 'SKU batch manifest is missing');
const incompleteDefaultProductionCatalog = buildRuntimeDeclarationProfileCatalog([{
  ...skuBatchManifest,
  production_obligation: undefined
}]);
const incompleteSkuDefault = incompleteDefaultProductionCatalog.blockedProfiles
  .find((profile) => profile.profileId === 'ecommerce.sku_batch.v1#default');
assert(incompleteSkuDefault, 'default production profile without obligation was published');
assert(incompleteSkuDefault.issues.some((issue) => (
  issue.code === 'production_obligation_missing' && issue.path === 'production_obligation'
)));
const nonProducingSkuDefaultCatalog = buildRuntimeDeclarationProfileCatalog([{
  ...skuBatchManifest,
  production_obligation: 'none'
}]);
const nonProducingSkuDefault = nonProducingSkuDefaultCatalog.blockedProfiles
  .find((profile) => profile.profileId === 'ecommerce.sku_batch.v1#default');
assert(nonProducingSkuDefault, 'write-capable default profile declared as non-producing was published');
assert(nonProducingSkuDefault.issues.some((issue) => (
  issue.code === 'production_obligation_incompatible'
)));

const injectedManifestSource = [skuBatchManifest];
const isolatedRegistry = createSkillRuntimeRegistry(injectedManifestSource);
injectedManifestSource.push(detailPageManifest);
assert(Object.isFrozen(isolatedRegistry), 'injected Skill Runtime registry is mutable');
assert(Object.isFrozen(isolatedRegistry.manifests), 'injected manifest list is mutable');
assert.strictEqual(isolatedRegistry.manifests.length, 1);
assert.strictEqual(
  isolatedRegistry.getManifestBySkillId(skuBatchManifest.skill_id),
  skuBatchManifest
);
assert.strictEqual(
  isolatedRegistry.getManifestByTaskType(skuBatchManifest.task_type),
  skuBatchManifest
);
assert.strictEqual(
  isolatedRegistry.getManifestByLegacySkillId('sku-batch'),
  skuBatchManifest
);
assert.strictEqual(
  isolatedRegistry.getManifestByTaskType(detailPageManifest.task_type),
  undefined,
  'injected registry leaked a built-in manifest outside its composition input'
);
assert.strictEqual(
  isolatedRegistry.resolveManifestSelection({ taskType: skuBatchManifest.task_type }).status,
  'resolved'
);
assert.strictEqual(
  Object.prototype.hasOwnProperty.call(isolatedRegistry, 'register'),
  false,
  'Skill Runtime registry exposes side-effect registration'
);
assert.throws(
  () => createSkillRuntimeRegistry([
    skuBatchManifest,
    {
      ...detailPageManifest,
      task_type: skuBatchManifest.task_type
    }
  ]),
  /Skill manifest task_type 重复/,
  'injected registry did not reject conflicting manifest identities'
);

assert.deepStrictEqual(
  listDeclarableRuntimeWorkModes('ecommerce.sku_batch.v1', catalog),
  []
);
assert.deepStrictEqual(
  listDeclarableRuntimeWorkModes('ecommerce.main_image.v1', catalog),
  ['create_new', 'redesign', 'edit_existing']
);
assert(listDeclarableRuntimeTaskTypes(catalog).includes('ecommerce.sku_batch.v1'));
assert(listDeclarableRuntimeTaskTypes(catalog).includes('ecommerce.sku_template.v1'));

const declarationTool = getDefaultAgentTools().find((tool) => tool.name === 'declareDesignIntent');
assert(declarationTool, 'declareDesignIntent is missing from the default Agent tool catalog');
const declarationProperties = declarationTool.inputSchema.properties;
assert.deepStrictEqual(
  declarationProperties.taskTypeId.enum,
  listDeclarableRuntimeTaskTypes(catalog),
  'declareDesignIntent taskTypeId enum drifted from the Manifest-derived catalog'
);
const publishedWorkModes = Array.from(new Set(
  catalog.declarableProfiles.map((profile) => profile.workMode).filter(Boolean)
));
assert.deepStrictEqual(
  declarationProperties.workMode.enum,
  publishedWorkModes,
  'declareDesignIntent workMode enum exposes a blocked or unregistered mode'
);
assert(!declarationProperties.workMode.enum.includes('analyze_only'));
assert(!declarationProperties.workMode.enum.includes('export_only'));
for (const profileId of profileIds) {
  assert(
    declarationTool.description.includes(profileId),
    `declareDesignIntent description does not publish profile ${profileId}`
  );
}

const executorSource = fs.readFileSync(path.resolve(
  __dirname,
  '..',
  'src',
  'renderer',
  'services',
  'skill-executors',
  'autonomous-agent.executor.ts'
), 'utf8');

function extractNamedFunctionSource(source, functionName) {
  const marker = `function ${functionName}(`;
  const start = source.indexOf(marker);
  assert(start >= 0, `production function ${functionName} is missing`);
  const bodyStart = source.indexOf('{', start + marker.length);
  assert(bodyStart >= 0, `production function ${functionName} has no body`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const character = source[index];
    if (character === '{') depth += 1;
    if (character !== '}') continue;
    depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`production function ${functionName} has an unterminated body`);
}

const mainImageTaskProfile = getDesignTaskTypeSpec('ecommerce.main_image.v1');
assert(mainImageTaskProfile, 'main-image Task Profile is missing');
const mainImageRoleGuidance = String(mainImageTaskProfile.declarationGuidance || '');
assert(mainImageRoleGuidance.length > 0 && mainImageRoleGuidance.length <= 420,
  'main-image role guidance is missing or would be truncated in the pre-binding menu');
assert(mainImageRoleGuidance.includes('只委托一张泛称商品主图'));
assert(mainImageRoleGuidance.includes('按搜索或推荐列表的点击入口理解'));
assert(mainImageRoleGuidance.includes('不能单独决定素材或方案赢家'));
assert(
  !/(?:模特|平铺|真人|场景图|白底图|静物)|(?:固定|指定)(?:风格|版式|模板|工具|步骤)|(?:composeDesign|renderLayout|Tool)|工具顺序|(?:必须|只能|优先)(?:使用|选择|调用|采用)/iu.test(mainImageRoleGuidance),
  'main-image role guidance prescribed an asset winner, style, layout or Tool order'
);

// Execute the actual production menu function in a dependency-bounded VM. This avoids a
// source-token-only false green: the first model turn must receive the Task Profile guidance
// before declareDesignIntent can bind the full agentic contract.
const buildWorkflowMenuLinesForAudit = vm.runInNewContext(
  `(${extractNamedFunctionSource(executorSource, 'buildWorkflowMenuLines')
    .replace('function buildWorkflowMenuLines(): string[]', 'function buildWorkflowMenuLines()')})`,
  { listSkillManifests, getSkillById, getDesignTaskTypeSpec }
);
const preBindingWorkflowMenuLines = buildWorkflowMenuLinesForAudit();
const preBindingMainImageLine = preBindingWorkflowMenuLines.find((line) => (
  String(line).includes('Profile：ecommerce.main_image.v1')
));
assert(preBindingMainImageLine, 'pre-binding workflow menu omitted the main-image Profile');
assert(
  preBindingMainImageLine.includes(mainImageRoleGuidance),
  'pre-binding workflow menu did not expose the complete main-image Task Profile guidance'
);
const toolExecutorSource = fs.readFileSync(path.resolve(
  __dirname,
  '..',
  'src',
  'renderer',
  'services',
  'tool-executor.service.ts'
), 'utf8');
const agentSource = fs.readFileSync(path.resolve(
  __dirname,
  '..',
  'src',
  'renderer',
  'services',
  'agent-runtime',
  'agent.ts'
), 'utf8');
const agentTypesSource = fs.readFileSync(path.resolve(
  __dirname,
  '..',
  'src',
  'renderer',
  'services',
  'agent-runtime',
  'types.ts'
), 'utf8');
assert(executorSource.includes('resolveRuntimeDeclarationForAgentTask({'));
assert(executorSource.includes("Object.prototype.hasOwnProperty.call(data, 'declaredDesignTaskTypeId')"));
assert(
  executorSource.includes('runtimeContractStatus: input.runtimeContractStatus,'),
  'RunRecord builder input dropped the resolved Runtime Contract status'
);
assert.strictEqual(
  (executorSource.match(/runtimeSessionIdentity: [^,\n]+,\r?\n\s+runtimeContractStatus,/g) || []).length,
  4,
  'not every normal, cancelled, reflexion or provider-failure RunRecord path preserves Runtime Contract status'
);
assert(executorSource.includes("code: 'runtime_design_intent_declaration_invalid'"));
assert(executorSource.includes("code: 'runtime_design_intent_configuration_error'"));
assert(!executorSource.includes("code: 'runtime_declared_manifest_missing'"));
assert(
  executorSource.includes('rebuildGenerationRuntimeContextItems(agenticCandidate);'),
  'agentic late binding did not compile method knowledge from the candidate Manifest atomically'
);
assert(
  executorSource.includes('const knowledgeBundle = input.knowledgeBundle || resolveKnowledgeBundle();'),
  'runtime context compiler cannot consume an uncommitted agentic Manifest candidate'
);
assert(toolExecutorSource.includes('validatedByRuntimeResolver: false'));
assert(!toolExecutorSource.includes('声明设计意图失败：workMode'));
assert(!toolExecutorSource.includes('声明设计意图失败：taskTypeId'));
assert(agentSource.includes("code: 'tool_deferred_after_runtime_declaration'"));
assert(agentSource.includes('createRuntimeDeclarationSiblingTurn(response.toolCalls'));
assert(agentSource.includes('runtimeDeclarationTurn.recordResult(call, output)'));
assert(agentSource.includes('const hasPhotoshopChange = this.hasObservedTaskMutation();'));
assert(agentSource.includes('const hasViewableVersion = hasPhotoshopChange || hasSavedOrExportedFile;'));
assert(!agentSource.includes('const hasRecordedMutation = Number(summary.successfulMutationCalls || 0) > 0;'));
assert(agentSource.includes('当前状态：还没有可看的设计版本'));
assert(agentSource.includes('不读取 summaryText、blockers'));
assert(!agentSource.includes('这稿先做到这里，你看看现在的效果。本轮执行预算已用完'));
assert(agentSource.includes("failureDisposition: 'control_turn_deferred' as const"));
assert(agentSource.includes("entry.failureDisposition !== 'control_turn_deferred'"));
assert(agentTypesSource.includes("'control_turn_deferred'"));
assert(/if \(output === undefined\s+&& !isAgentHarnessControlTool\(call\.name\)\s+&& !isAgentCapabilityControlTool\(call\.name\)/.test(agentSource));
assert(agentSource.includes('const MAX_RUNTIME_DESIGN_INTENT_REPAIR_ATTEMPTS = 1'));
assert(agentSource.includes("'runtime_design_intent_declaration_invalid'"));
assert(agentSource.includes("code === 'runtime_design_intent_configuration_error'"));

assert.deepStrictEqual(resolveRuntimeDeclarationSiblingPolicy({
  declarationPresent: true,
  isDeclarationCall: false,
  declarationSucceeded: true,
  visibleAfterBinding: true,
  executionKind: 'knowledge_search',
  isHarnessControlTool: false,
  isCapabilityControlTool: false
}), {
  disposition: 'execute_after_binding',
  reason: 'compatible_read_only_call'
});
assert.strictEqual(resolveRuntimeDeclarationSiblingPolicy({
  declarationPresent: true,
  isDeclarationCall: false,
  declarationSucceeded: true,
  visibleAfterBinding: true,
  executionKind: 'photoshop_write',
  isHarnessControlTool: false,
  isCapabilityControlTool: false
}).disposition, 'defer');
assert.strictEqual(resolveRuntimeDeclarationSiblingPolicy({
  declarationPresent: true,
  isDeclarationCall: false,
  declarationSucceeded: true,
  visibleAfterBinding: false,
  executionKind: 'read_only_observation',
  isHarnessControlTool: false,
  isCapabilityControlTool: false
}).disposition, 'defer');

for (const profile of catalog.declarableProfiles) {
  const result = resolveRuntimeDeclarationForAgentTask({
    taskType: profile.taskType,
    workMode: profile.workMode,
    executableToolNames
  });
  assert.strictEqual(
    result.status,
    'resolved',
    `${profile.profileId}: ${JSON.stringify(result, null, 2)}`
  );
  assert.strictEqual(result.profile.profileId, profile.profileId);
  assert.strictEqual(result.bundle.artifactManifest?.task_type, profile.taskType);
  assert(result.bundle.evaluationProfile, `${profile.profileId}: evaluation profile missing`);
}

const skuDefault = resolveRuntimeDeclarationForAgentTask({
  taskType: 'ecommerce.sku_batch.v1',
  executableToolNames
});
assert.strictEqual(skuDefault.status, 'resolved');
assert.deepStrictEqual(skuDefault.canonicalDeclaration, {
  taskType: 'ecommerce.sku_batch.v1'
});
assert.strictEqual(skuDefault.bundle.manifest.performance_profile?.budget.max_tool_calls, 100);
assert.strictEqual(
  skuDefault.bundle.stagePlan.productionObligation,
  'photoshop_mutation_with_readback',
  'SKU batch must retain its mutation-with-readback obligation in the effective StagePlan'
);
assert.strictEqual(
  getDesignEvaluationProfileVlmAssertions(skuDefault.bundle.evaluationProfile).length,
  0,
  'SKU batch must not reserve a generic final VLM Judge that its Evaluation Profile does not require'
);

function createRuntimeStatusAuditSession(nonce, revision) {
  const identity = createRuntimeSessionIdentity({
    now: '2026-08-24T06:00:00.000Z',
    nonce,
    skillId: skuDefault.bundle.stagePlan.skillId,
    taskType: skuDefault.bundle.stagePlan.taskType
  });
  const observedSession = observeRuntimeSessionDocumentRevision({
    session: createRuntimeSession({
      identity,
      plan: skuDefault.bundle.stagePlan
    }),
    revision,
    now: '2026-08-24T06:00:01.000Z'
  });
  return {
    ...observedSession,
    stageState: {
      ...observedSession.stageState,
      status: 'active',
      currentStage: 'E1'
    }
  };
}

const runtimeStatusRevision = { documentId: 701, historyStateId: 9001 };
const runtimeStatusNextRevision = { documentId: 701, historyStateId: 9002 };
let runtimeStatusOwner = createRuntimeStatusAuditSession(
  'runtime-status-owner',
  runtimeStatusRevision
);
const runtimeStatusOwnerClaim = claimRuntimeSessionDocumentWriter({
  session: runtimeStatusOwner,
  expectedRevision: runtimeStatusRevision,
  now: '2026-08-24T06:00:02.000Z'
});
assert.strictEqual(runtimeStatusOwnerClaim.decision.status, 'acquired');
runtimeStatusOwner = runtimeStatusOwnerClaim.session;

const runtimeRevisionConflict = claimRuntimeSessionDocumentWriter({
  session: runtimeStatusOwner,
  expectedRevision: runtimeStatusNextRevision,
  now: '2026-08-24T06:00:03.000Z'
});
assert.strictEqual(runtimeRevisionConflict.decision.code, 'runtime_task_run_revision_conflict');
assert.strictEqual(runtimeRevisionConflict.session.taskRun.status, 'needs_reobserve');
assert.strictEqual(
  runtimeRevisionConflict.session.taskRun.documentBinding?.conflict?.kind,
  'external_revision_changed'
);
assert.strictEqual(evaluateRuntimeSessionToolExecutionGate({
  session: runtimeRevisionConflict.session,
  toolName: 'sku-batch',
  toolKind: 'photoshop_write'
}).code, 'runtime_task_run_revision_reobserve_required');
const finalizedRevisionConflict = finalizeRuntimeSession({
  session: runtimeRevisionConflict.session,
  plan: skuDefault.bundle.stagePlan,
  executionSummary: { status: 'failed' }
});
assert.strictEqual(finalizedRevisionConflict.taskRun.status, 'needs_reobserve');
assert.strictEqual(finalizedRevisionConflict.finalized, false);

let runtimeStatusContender = createRuntimeStatusAuditSession(
  'runtime-status-contender',
  runtimeStatusRevision
);
assert.strictEqual(evaluateRuntimeSessionToolExecutionGate({
  session: runtimeStatusContender,
  toolName: 'sku-batch',
  toolKind: 'photoshop_write'
}).allowed, true, 'normal E1 gate must reach the atomic writer claim');
const runtimeStatusContenderClaim = claimRuntimeSessionDocumentWriter({
  session: runtimeStatusContender,
  expectedRevision: runtimeStatusRevision,
  now: '2026-08-24T06:00:04.000Z'
});
assert.strictEqual(runtimeStatusContenderClaim.decision.code, 'runtime_task_run_writer_conflict');
assert.strictEqual(runtimeStatusContenderClaim.session.taskRun.status, 'writer_conflict');
assert.strictEqual(
  runtimeStatusContenderClaim.session.taskRun.documentBinding?.conflict?.kind,
  'writer_conflict'
);
assert.strictEqual(
  runtimeStatusContenderClaim.session.taskRun.documentBinding?.conflict?.observedRevision,
  undefined,
  'writer conflict must not masquerade as a Photoshop history change'
);
const runtimeWriterConflictGate = evaluateRuntimeSessionToolExecutionGate({
  session: runtimeStatusContenderClaim.session,
  toolName: 'sku-batch',
  toolKind: 'photoshop_write'
});
assert.strictEqual(runtimeWriterConflictGate.code, 'runtime_task_run_writer_conflict');

const observedWriterConflict = observeRuntimeSessionDocumentRevision({
  session: runtimeStatusContenderClaim.session,
  revision: runtimeStatusNextRevision,
  now: '2026-08-24T06:00:05.000Z'
});
assert.strictEqual(observedWriterConflict.taskRun.status, 'writer_conflict');
assert.strictEqual(
  observedWriterConflict.taskRun.documentBinding?.conflict?.kind,
  'writer_conflict'
);
const writerConflictAtR2 = {
  ...observedWriterConflict,
  stageState: {
    ...observedWriterConflict.stageState,
    status: 'active',
    currentStage: 'R2'
  }
};
const falselyAcknowledgedWriterConflict = acknowledgeRuntimeSessionWorkflowDocumentReobservation({
  session: writerConflictAtR2,
  plan: skuDefault.bundle.stagePlan,
  observedRevision: runtimeStatusNextRevision
});
assert.strictEqual(falselyAcknowledgedWriterConflict.taskRun.status, 'writer_conflict');
assert.strictEqual(
  falselyAcknowledgedWriterConflict.taskRun.documentBinding?.conflict?.kind,
  'writer_conflict'
);
const finalizedWriterConflict = finalizeRuntimeSession({
  session: runtimeStatusContenderClaim.session,
  plan: skuDefault.bundle.stagePlan,
  executionSummary: { status: 'failed' }
});
assert.strictEqual(finalizedWriterConflict.taskRun.status, 'writer_conflict');
assert.strictEqual(finalizedWriterConflict.finalized, false);
releaseRuntimeTaskRunWriterBinding({
  taskRunId: runtimeStatusOwner.taskRun.taskRunId,
  runId: runtimeStatusOwner.identity.runId,
  generation: runtimeStatusOwner.identity.generation
});
const releasedOwnerGate = evaluateRuntimeSessionToolExecutionGate({
  session: finalizedWriterConflict,
  toolName: 'sku-batch',
  toolKind: 'photoshop_write'
});
assert.strictEqual(
  releasedOwnerGate.allowed,
  true,
  'released writer owner must let the contender reach the atomic claim'
);
const recoveredWriterClaim = claimRuntimeSessionDocumentWriter({
  session: finalizedWriterConflict,
  expectedRevision: runtimeStatusRevision,
  now: '2026-08-24T06:00:06.000Z'
});
assert.strictEqual(recoveredWriterClaim.decision.status, 'acquired');
assert.strictEqual(recoveredWriterClaim.session.taskRun.status, 'active');
assert.strictEqual(recoveredWriterClaim.session.taskRun.documentBinding?.status, 'owned');
assert.strictEqual(recoveredWriterClaim.session.taskRun.documentBinding?.conflict, undefined);
const sameTaskStaleConflictProjection = {
  ...recoveredWriterClaim.session,
  taskRun: {
    ...recoveredWriterClaim.session.taskRun,
    status: 'writer_conflict',
    documentBinding: {
      ...recoveredWriterClaim.session.taskRun.documentBinding,
      status: 'conflict',
      conflict: {
        kind: 'writer_conflict',
        expectedRevision: runtimeStatusRevision,
        observedTaskRunId: recoveredWriterClaim.session.taskRun.taskRunId,
        recordedAt: '2026-08-24T06:00:06.500Z'
      }
    }
  }
};
assert.strictEqual(evaluateRuntimeSessionToolExecutionGate({
  session: sameTaskStaleConflictProjection,
  toolName: 'sku-batch',
  toolKind: 'photoshop_write'
}).allowed, true, 'same TaskRun writer projection must reach the retaining claim');
releaseRuntimeTaskRunWriterBinding({
  taskRunId: recoveredWriterClaim.session.taskRun.taskRunId,
  runId: recoveredWriterClaim.session.identity.runId,
  generation: recoveredWriterClaim.session.identity.generation
});

const runtimeGenerationRevision = { documentId: 703, historyStateId: 31 };
const runtimeGenerationOne = createRuntimeStatusAuditSession(
  'runtime-writer-generation-one',
  runtimeGenerationRevision
);
const runtimeGenerationOneClaim = claimRuntimeSessionDocumentWriter({
  session: runtimeGenerationOne,
  expectedRevision: runtimeGenerationRevision,
  now: '2026-08-24T06:01:00.000Z'
});
assert.strictEqual(runtimeGenerationOneClaim.decision.status, 'acquired');
const finalizedRuntimeGenerationOne = finalizeRuntimeSession({
  session: runtimeGenerationOneClaim.session,
  plan: skuDefault.bundle.stagePlan,
  executionSummary: { status: 'failed', stopReason: 'bounded_generation_reentry' },
  reflexionHandoff: {
    version: 'quality-gate-reflexion-handoff/v0',
    status: 'reflexion_required',
    sourceOwner: 'Runtime',
    targetStage: 'E1',
    reenterLoop: 'react',
    failureAnalysis: ['当前 generation 的有界运行结束。'],
    strategyAdjustments: ['由下一 generation 继续同一 TaskRun。'],
    nextRoundConstraints: ['沿用已验证的文档 writer 身份。']
  }
});
assert.strictEqual(finalizedRuntimeGenerationOne.finalized, true);
const runtimeGenerationTwoIdentity = createRuntimeSessionIdentity({
  now: '2026-08-24T06:01:01.000Z',
  nonce: 'runtime-writer-generation-two',
  generation: 2,
  sessionId: finalizedRuntimeGenerationOne.identity.sessionId,
  parentRunId: finalizedRuntimeGenerationOne.identity.runId,
  skillId: skuDefault.bundle.stagePlan.skillId,
  taskType: skuDefault.bundle.stagePlan.taskType
});
const runtimeGenerationTwo = advanceRuntimeSessionGeneration({
  previous: finalizedRuntimeGenerationOne,
  identity: runtimeGenerationTwoIdentity,
  plan: skuDefault.bundle.stagePlan
});
assert.strictEqual(
  runtimeGenerationTwo.taskRun.documentBinding?.writer?.runId,
  runtimeGenerationTwoIdentity.runId,
  'advanceRuntimeSessionGeneration must be the explicit writer owner transfer'
);
assert.strictEqual(
  runtimeGenerationTwo.taskRun.documentBinding?.writer?.generation,
  2
);

const staleGenerationCardClaim = claimRuntimeTaskRunWriterBinding({
  taskRunId: finalizedRuntimeGenerationOne.taskRun.taskRunId,
  runId: finalizedRuntimeGenerationOne.identity.runId,
  generation: finalizedRuntimeGenerationOne.identity.generation,
  expectedRevision: runtimeGenerationRevision,
  now: '2026-08-24T06:01:02.000Z'
});
assert.strictEqual(
  staleGenerationCardClaim.status,
  'conflict',
  'an old card must not retain or overwrite the same TaskRun writer after generation transfer'
);
assert.strictEqual(staleGenerationCardClaim.claim?.runId, runtimeGenerationTwoIdentity.runId);
assert.strictEqual(staleGenerationCardClaim.claim?.generation, 2);
const staleGenerationSessionClaim = claimRuntimeSessionDocumentWriter({
  session: finalizedRuntimeGenerationOne,
  expectedRevision: runtimeGenerationRevision,
  now: '2026-08-24T06:01:02.500Z'
});
assert.strictEqual(staleGenerationSessionClaim.session.taskRun.status, 'writer_conflict');
assert.strictEqual(evaluateRuntimeSessionToolExecutionGate({
  session: staleGenerationSessionClaim.session,
  toolName: 'sku-batch',
  toolKind: 'photoshop_write'
}).code, 'runtime_task_run_writer_conflict',
  'the gate must treat another generation of the same TaskRun as a live competing writer');
assert.strictEqual(releaseRuntimeTaskRunWriterBinding({
  taskRunId: finalizedRuntimeGenerationOne.taskRun.taskRunId,
  runId: finalizedRuntimeGenerationOne.identity.runId,
  generation: finalizedRuntimeGenerationOne.identity.generation,
  documentId: runtimeGenerationRevision.documentId
}), false, 'an old card must not release the new generation writer');

const retainedRuntimeGenerationTwo = claimRuntimeTaskRunWriterBinding({
  taskRunId: runtimeGenerationTwo.taskRun.taskRunId,
  runId: runtimeGenerationTwo.identity.runId,
  generation: runtimeGenerationTwo.identity.generation,
  expectedRevision: runtimeGenerationRevision,
  now: '2026-08-24T06:01:03.000Z'
});
assert.strictEqual(retainedRuntimeGenerationTwo.status, 'retained');
const staleGenerationProjection = recordRuntimeSessionSkillRevisionTransition({
  session: finalizedRuntimeGenerationOne,
  projectionId: 'stale-generation-history-projection',
  workflowToolName: 'sku-batch',
  transition: {
    source: 'history_transition',
    before: runtimeGenerationRevision,
    after: {
      documentId: runtimeGenerationRevision.documentId,
      historyStateId: runtimeGenerationRevision.historyStateId + 1
    },
    toolActionCompleted: true
  },
  now: '2026-08-24T06:01:03.500Z'
});
assert.strictEqual(
  staleGenerationProjection.taskRun.status,
  'writer_conflict',
  'an old generation Skill receipt must not revive or move a writer owned by the new generation'
);
assert.strictEqual(
  shouldDeferRuntimeArtifactFinalizationForInteraction(staleGenerationProjection),
  true,
  'writer_conflict must retain Artifact finalization authorization'
);
assert.strictEqual(
  staleGenerationProjection.taskRun.skillRevisionProjections[0].source,
  'history_transition'
);
assert.strictEqual(claimRuntimeTaskRunWriterBinding({
  taskRunId: runtimeGenerationTwo.taskRun.taskRunId,
  runId: runtimeGenerationTwo.identity.runId,
  generation: runtimeGenerationTwo.identity.generation,
  expectedRevision: runtimeGenerationRevision,
  now: '2026-08-24T06:01:03.700Z'
}).status, 'retained', 'stale projection must leave the new generation writer untouched');
assert.strictEqual(releaseRuntimeTaskRunWriterBinding({
  taskRunId: runtimeGenerationTwo.taskRun.taskRunId,
  runId: runtimeGenerationTwo.identity.runId,
  generation: runtimeGenerationTwo.identity.generation,
  documentId: runtimeGenerationRevision.documentId
}), true, 'only the exact new generation owner may release its writer');

const runtimeWaitingSession = suspendRuntimeSessionForInteraction({
  session: createRuntimeStatusAuditSession(
    'runtime-status-waiting',
    { documentId: 702, historyStateId: 1 }
  ),
  interactionId: 'runtime-status-waiting-interaction'
}).session;
assert.strictEqual(evaluateRuntimeSessionToolExecutionGate({
  session: runtimeWaitingSession,
  toolName: 'sku-batch',
  toolKind: 'photoshop_write'
}).code, 'runtime_task_run_waiting_user');
assert.strictEqual(finalizeRuntimeSession({
  session: runtimeWaitingSession,
  plan: skuDefault.bundle.stagePlan,
  executionSummary: { status: 'failed' }
}).taskRun.status, 'waiting_user');

const noBindingUnknownSession = markRuntimeSessionSkillEffectUnknown({
  session: createRuntimeSession({
    identity: createRuntimeSessionIdentity({
      now: '2026-08-24T06:09:00.000Z',
      nonce: 'runtime-no-binding-unknown',
      skillId: skuDefault.bundle.stagePlan.skillId,
      taskType: skuDefault.bundle.stagePlan.taskType
    }),
    plan: skuDefault.bundle.stagePlan
  }),
  workflowToolName: 'sku-batch',
  observedRevision: { documentId: 0, historyStateId: -1 }
});
assert.strictEqual(
  noBindingUnknownSession.taskRun.status,
  'active',
  'an unknown environment fact without any bound document must not create an unacknowledgeable reobserve lock'
);
assert.strictEqual(noBindingUnknownSession.taskRun.documentBinding, undefined);
assert.strictEqual(noBindingUnknownSession.taskRun.sideEffectState?.status, 'unknown');
assert.strictEqual(evaluateRuntimeSessionToolExecutionGate({
  session: noBindingUnknownSession,
  toolName: 'createDocument',
  toolKind: 'photoshop_write',
  hasOpenDocument: false,
  taskRequiresOpenDocument: false
}).code, 'runtime_task_run_side_effect_unknown',
  'unknown Skill side effects must block later writes even when there is no Photoshop document binding');
assert.strictEqual(evaluateRuntimeSessionToolExecutionGate({
  session: noBindingUnknownSession,
  toolName: 'updateDesignProjectState',
  toolKind: 'stateful_context'
}).code, 'runtime_task_run_side_effect_unknown',
  'unknown Skill side effects must block other stateful writes until reconciliation');
assert.strictEqual(evaluateRuntimeSessionToolExecutionGate({
  session: noBindingUnknownSession,
  toolName: 'getDocumentInfo',
  toolKind: 'read_only_observation'
}).allowed, true,
  'unknown Skill side effects must still allow observation-only reconciliation');
assert.strictEqual(
  shouldDeferRuntimeArtifactFinalizationForInteraction(noBindingUnknownSession),
  true,
  'unknown Skill side effects without a document binding must retain Artifact authorization'
);
assert.strictEqual(finalizeRuntimeSession({
  session: noBindingUnknownSession,
  plan: skuDefault.bundle.stagePlan,
  executionSummary: { status: 'failed' }
}).finalized, false,
  'unknown Skill side effects without a document binding must not finalize or release the TaskRun');
assert(noBindingUnknownSession.issues.includes('runtime_skill_effect_unknown_observation_invalid'));
assert.strictEqual(canReleaseRuntimeSessionDocumentWriter({
  session: noBindingUnknownSession,
  ownerHasExecutionControl: true,
  outcome: 'executed',
  mutationState: 'none'
}), false, 'side-effect unknown must retain writer even when a caller reports a nominal terminal result');
assert.strictEqual(canReleaseRuntimeSessionDocumentWriter({
  session: createRuntimeStatusAuditSession(
    'runtime-safe-writer-release',
    { documentId: 704, historyStateId: 1 }
  ),
  ownerHasExecutionControl: true,
  outcome: 'failed',
  mutationState: 'none'
}), true, 'a non-structural terminal zero-write failure may release its exact writer identity');

function buildInteractiveAuditCase(suffix, revision) {
  const continuationId = `runtime-interactive-${suffix}`;
  const session = revision
    ? createRuntimeStatusAuditSession(`runtime-interactive-${suffix}`, revision)
    : createRuntimeSession({
      identity: createRuntimeSessionIdentity({
        now: '2026-08-24T06:10:00.000Z',
        nonce: `runtime-interactive-${suffix}`,
        skillId: skuDefault.bundle.stagePlan.skillId,
        taskType: skuDefault.bundle.stagePlan.taskType
      }),
      plan: skuDefault.bundle.stagePlan
    });
  const suspension = suspendRuntimeSessionForInteraction({
    session,
    interactionId: continuationId,
    continuationId,
    cardId: `card-${suffix}`,
    ...(revision ? { expectedRevision: revision } : {}),
    now: '2026-08-24T06:10:00.000Z'
  });
  registerActiveRuntimeInteractiveCheckpoint({
    version: RUNTIME_INTERACTIVE_CHECKPOINT_VERSION,
    continuationId,
    workflowToolName: 'sku-batch',
    sourceTask: '帮我做 SKU 编排',
    taskRunBinding: suspension.binding,
    session: suspension.session,
    plan: skuDefault.bundle.stagePlan,
    declarations: {},
    workflowHandoff: {
      version: RUNTIME_INTERACTIVE_HANDOFF_IDENTITY_VERSION,
      workflowToolName: 'sku-batch',
      workflowCallId: `workflow-call-${suffix}`,
      binding: {
        sessionId: suspension.session.identity.sessionId,
        runId: suspension.session.identity.runId,
        generation: suspension.session.identity.generation,
        stage: suspension.session.stageState.currentStage
      }
    },
    registeredAt: new Date().toISOString(),
    boundaries: createRuntimeInteractiveBoundaries()
  });
  const submission = {
    version: 'interactive-card-submission/v0',
    cardId: `card-${suffix}`,
    kind: 'sku-combo-confirmation',
    submittedAt: '2026-08-24T06:10:02.000Z',
    value: { colors: ['米白', '浅粉', '浅灰', '深灰'], sizes: [2, 3, 4] },
    validation: {
      valid: true,
      canSubmit: true,
      normalizedValue: { colors: ['米白', '浅粉', '浅灰', '深灰'], sizes: [2, 3, 4] },
      issues: [],
      blockers: [],
      warnings: []
    }
  };
  return {
    continuationId,
    suspension,
    resolution: {
      status: 'accepted',
      continuation: { id: continuationId },
      submission,
      sourceMessageId: `message-${suffix}`,
      card: { id: submission.cardId },
      skillId: 'sku-batch',
      params: {},
      taskRunBinding: suspension.binding
    }
  };
}

function buildInteractiveHandoffResult(
  preparation,
  resolution,
  toolResults,
  readTrustedToolName,
  receiptOptions = {}
) {
  const base = {
    success: false,
    nonFatal: true,
    message: '模板仍需由 Agent 继续设计。',
    toolResults: toolResults || [],
    data: {
      agentReActContinuation: {
        status: 'needs_repair',
        summary: '确认已完成，继续制作模板。',
        details: ['保留四个已确认颜色并继续模板设计。'],
        nextAction: 'repair',
        recovery: {
          mode: 'allowlist',
          purpose: 'repair',
          allowedToolNames: ['createDocument', 'createTextLayer', 'getDocumentInfo'],
          reason: '只继续模板设计与复核，不重复确认旧卡片。'
        }
      }
    }
  };
  return attachSkillExecutionEffectReceipt(base, {
    skillId: 'sku-batch',
    executionStarted: true,
    outcomeStatus: 'partial',
    readTrustedToolName,
    runtimeLineage: buildRuntimeInteractiveSkillExecutionLineage({ preparation, resolution }),
    ...receiptOptions
  });
}

function buildTrustedReadOnlyInteractiveHandoffResult(preparation, resolution, revision) {
  const toolResult = { success: true, historyStateRef: revision };
  return buildInteractiveHandoffResult(
    preparation,
    resolution,
    [{ name: 'getDocumentInfo', result: toolResult }],
    (candidate) => candidate === toolResult ? 'getDocumentInfo' : undefined,
    { declaredProviderToolNames: ['getDocumentInfo'] }
  );
}

const noneEffectCase = buildInteractiveAuditCase(
  'none',
  { documentId: 711, historyStateId: 1 }
);
const nonePreparation = prepareRuntimeInteractiveResume({
  continuationId: noneEffectCase.continuationId,
  taskRunBinding: noneEffectCase.suspension.binding,
  photoshopObservation: { status: 'revision', revision: { documentId: 711, historyStateId: 1 } }
});
assert.strictEqual(nonePreparation.status, 'ready');
const noneHandoff = resolveRuntimeInteractiveHandoff({
  preparation: nonePreparation,
  resolution: noneEffectCase.resolution,
  result: buildTrustedReadOnlyInteractiveHandoffResult(
    nonePreparation,
    noneEffectCase.resolution,
    { documentId: 711, historyStateId: 1 }
  ),
  photoshopObservationAfterSkill: { status: 'revision', revision: { documentId: 711, historyStateId: 1 } }
});
assert.strictEqual(noneHandoff.effect, 'none');
assert(noneHandoff.reentry, 'none effect handoff must re-enter the active Runtime');
assert.strictEqual(noneHandoff.reentry.session.identity.runId, noneEffectCase.suspension.session.identity.runId);
assert.strictEqual(noneHandoff.reentry.session.identity.generation, noneEffectCase.suspension.session.identity.generation);
assert.strictEqual(noneHandoff.reentry.session.taskRun.taskRunId, noneEffectCase.suspension.session.taskRun.taskRunId);
assert.strictEqual(noneHandoff.reentry.session.taskRun.status, 'active');
assert(noneHandoff.reentryTask.includes('米白'));
assert(noneHandoff.reentryTask.includes('冻结事实'));
assert(noneHandoff.reentryTask.includes('不要重新询问'));
assert.strictEqual(shouldDeferRuntimeArtifactFinalizationForInteraction(
  noneEffectCase.suspension.session
), true);
assert.strictEqual(shouldDeferRuntimeArtifactFinalizationForInteraction(
  noneHandoff.reentry.session
), false);
const noDocumentCase = buildInteractiveAuditCase('no-document', undefined);
const noDocumentPreparation = prepareRuntimeInteractiveResume({
  continuationId: noDocumentCase.continuationId,
  taskRunBinding: noDocumentCase.suspension.binding,
  photoshopObservation: { status: 'no_document' }
});
assert.strictEqual(noDocumentPreparation.status, 'ready');
assert.strictEqual(noDocumentPreparation.mode, 'execute_skill');
const noDocumentReadResult = { success: true, hasDocument: false };
const noDocumentHandoff = resolveRuntimeInteractiveHandoff({
  preparation: noDocumentPreparation,
  resolution: noDocumentCase.resolution,
  result: buildInteractiveHandoffResult(
    noDocumentPreparation,
    noDocumentCase.resolution,
    [{ name: 'getDocumentInfo', result: noDocumentReadResult }],
    (candidate) => candidate === noDocumentReadResult ? 'getDocumentInfo' : undefined,
    { declaredProviderToolNames: ['getDocumentInfo'] }
  ),
  photoshopObservationAfterSkill: { status: 'no_document' }
});
assert.strictEqual(noDocumentHandoff.effect, 'none');
assert.strictEqual(noDocumentHandoff.reentry.session.taskRun.status, 'active');
assert.strictEqual(
  noDocumentHandoff.reentry.session.taskRun.documentBinding,
  undefined,
  'a proven zero-write no-document handoff must remain able to create its first Photoshop document'
);
const noDocumentReservation = stageRuntimeInteractiveReentry({
  reservation: noDocumentPreparation.reservation,
  reentry: noDocumentHandoff.reentry,
  reentryTask: noDocumentHandoff.reentryTask
});
assert(noDocumentReservation);
assert.strictEqual(adoptRuntimeInteractiveResume(noDocumentReservation), true);
const unknownNoDocumentCase = buildInteractiveAuditCase('unknown-no-document', undefined);
const unknownNoDocumentPreparation = prepareRuntimeInteractiveResume({
  continuationId: unknownNoDocumentCase.continuationId,
  taskRunBinding: unknownNoDocumentCase.suspension.binding,
  photoshopObservation: { status: 'no_document' }
});
const unknownNoDocumentHandoff = resolveRuntimeInteractiveHandoff({
  preparation: unknownNoDocumentPreparation,
  resolution: unknownNoDocumentCase.resolution,
  result: buildInteractiveHandoffResult(
    unknownNoDocumentPreparation,
    unknownNoDocumentCase.resolution,
    [],
    undefined
  ),
  photoshopObservationAfterSkill: { status: 'no_document' }
});
assert.strictEqual(unknownNoDocumentHandoff.reentry.session.taskRun.sideEffectState?.status, 'unknown');
const noDocumentReconciledSession = reconcileRuntimeSkillEffectBeforeAgentAction({
  session: unknownNoDocumentHandoff.reentry.session,
  reentry: unknownNoDocumentHandoff.reentry,
  toolCallLog: [
    {
      name: 'getDocumentInfo',
      arguments: {},
      result: { success: true, hasDocument: false },
      origin: 'model_tool_call',
      modelTurn: 0
    },
    {
      name: 'listDocuments',
      arguments: {},
      result: { success: true, documents: [] },
      origin: 'model_tool_call',
      modelTurn: 0
    }
  ],
  nextToolName: 'createDocument',
  nextToolKind: 'photoshop_write',
  nextToolIsSkill: false,
  currentModelTurn: 1
});
assert.strictEqual(noDocumentReconciledSession.taskRun.sideEffectState, undefined);
assert.strictEqual(noDocumentReconciledSession.taskRun.status, 'active');
assert.strictEqual(commitRuntimeInteractiveResume(unknownNoDocumentPreparation.reservation), true);
const mismatchPreparation = prepareRuntimeInteractiveResume({
  continuationId: noneEffectCase.continuationId,
  taskRunBinding: {
    ...noneEffectCase.suspension.binding,
    taskRunId: 'runtime-task-run-other'
  },
  photoshopObservation: { status: 'revision', revision: { documentId: 711, historyStateId: 1 } }
});
assert.strictEqual(mismatchPreparation.status, 'checkpoint_missing');
assert.throws(
  () => resolveRuntimeInteractiveHandoff({
    preparation: nonePreparation,
    resolution: {
      ...noneEffectCase.resolution,
      submission: {
        ...noneEffectCase.resolution.submission,
        cardId: 'card-from-another-interaction'
      }
    },
    result: buildTrustedReadOnlyInteractiveHandoffResult(
      nonePreparation,
      noneEffectCase.resolution,
      { documentId: 711, historyStateId: 1 }
    ),
    photoshopObservationAfterSkill: { status: 'revision', revision: { documentId: 711, historyStateId: 1 } }
  }),
  /runtime_interactive_reentry_card_binding_mismatch/,
  'Runtime reentry must close over the exact pending card binding'
);

const noneExternalChangeCase = buildInteractiveAuditCase(
  'none-external-change',
  { documentId: 714, historyStateId: 10 }
);
const noneExternalChangePreparation = prepareRuntimeInteractiveResume({
  continuationId: noneExternalChangeCase.continuationId,
  taskRunBinding: noneExternalChangeCase.suspension.binding,
  photoshopObservation: { status: 'revision', revision: { documentId: 714, historyStateId: 10 } }
});
const noneExternalChangeHandoff = resolveRuntimeInteractiveHandoff({
  preparation: noneExternalChangePreparation,
  resolution: noneExternalChangeCase.resolution,
  result: buildTrustedReadOnlyInteractiveHandoffResult(
    noneExternalChangePreparation,
    noneExternalChangeCase.resolution,
    { documentId: 714, historyStateId: 10 }
  ),
  photoshopObservationAfterSkill: { status: 'revision', revision: { documentId: 714, historyStateId: 11 } }
});
assert.strictEqual(noneExternalChangeHandoff.effect, 'none');
assert.strictEqual(noneExternalChangeHandoff.reentry.session.taskRun.status, 'needs_reobserve');
assert.strictEqual(
  noneExternalChangeHandoff.reentry.session.taskRun.documentBinding.expectedRevision.historyStateId,
  10,
  'zero-write Skill must not rebind the old plan to an external Photoshop revision'
);
assert.strictEqual(
  noneExternalChangeHandoff.reentry.session.taskRun.documentBinding.conflict.kind,
  'external_revision_changed'
);
assert.strictEqual(
  shouldDeferRuntimeArtifactFinalizationForInteraction(noneExternalChangeHandoff.reentry.session),
  true,
  'needs_reobserve must retain the one-time Artifact finalization authorization'
);
const externalChangeReentryState = resolveRuntimeInteractiveAgentReentryState({
  config: {
    runtimeInteractiveReentry: noneExternalChangeHandoff.reentry,
    runtimeSessionSeed: noneExternalChangeHandoff.reentry.session,
    runtimeStagePlan: noneExternalChangeHandoff.reentry.plan,
    tools: [
      { name: 'sku-batch' },
      { name: 'createDocument' },
      { name: 'createTextLayer' },
      { name: 'getDocumentInfo' }
    ],
    toolCapabilityBridge: { workflowEntryTools: ['sku-batch'] }
  },
  session: noneExternalChangeHandoff.reentry.session
});
assert.strictEqual(
  externalChangeReentryState.runtime.workflowContinuationScope.binding.stage,
  noneExternalChangeHandoff.reentry.session.stageState.currentStage,
  'restored scope must bind the current reobserve stage, not impersonate its original E1 source stage'
);
assert.strictEqual(
  externalChangeReentryState.runtime.pendingDirectWorkflowHandoff,
  undefined,
  'an R2 reobserve session must not restore an executable E1 direct repair handoff'
);

const terminalDecision = resolveRuntimeInteractiveHandoff({
  preparation: nonePreparation,
  resolution: noneEffectCase.resolution,
  result: { success: true, message: '已完成', skillOutcome: { status: 'completed' } }
});
assert.strictEqual(terminalDecision.reentry, undefined, 'terminal Skill result must not re-enter Agent');

const twoPhaseCase = buildInteractiveAuditCase(
  'two-phase',
  { documentId: 716, historyStateId: 10 }
);
const twoPhasePreparation = prepareRuntimeInteractiveResume({
  continuationId: twoPhaseCase.continuationId,
  taskRunBinding: twoPhaseCase.suspension.binding,
  photoshopObservation: { status: 'revision', revision: { documentId: 716, historyStateId: 10 } }
});
assert.strictEqual(twoPhasePreparation.status, 'ready');
assert.strictEqual(twoPhasePreparation.mode, 'execute_skill');
assert.strictEqual(claimRuntimeTaskRunWriterBinding({
  taskRunId: twoPhaseCase.suspension.binding.taskRunId,
  runId: twoPhaseCase.suspension.binding.runId,
  generation: twoPhaseCase.suspension.binding.generation,
  expectedRevision: { documentId: 716, historyStateId: 10 }
}).status, 'acquired');
const duplicatePreparation = prepareRuntimeInteractiveResume({
  continuationId: twoPhaseCase.continuationId,
  taskRunBinding: twoPhaseCase.suspension.binding,
  photoshopObservation: { status: 'revision', revision: { documentId: 716, historyStateId: 10 } }
});
assert.strictEqual(duplicatePreparation.status, 'resume_rejected');
assert.strictEqual(duplicatePreparation.code, 'runtime_interactive_checkpoint_busy');
assert.strictEqual(resolveRuntimeInteractiveAgentContinuationStatus({
  result: {
    success: true,
    message: '兼容路径提前返回',
    data: { executionSummary: { status: 'completed', successfulMutationCalls: 0 } }
  },
  adopted: false
}).continuationStatus, 'failed', 'an unadopted compatibility return must never consume the pending reentry as completed');
assert.strictEqual(claimRuntimeTaskRunWriterBinding({
  taskRunId: twoPhaseCase.suspension.binding.taskRunId,
  runId: twoPhaseCase.suspension.binding.runId,
  generation: twoPhaseCase.suspension.binding.generation,
  expectedRevision: { documentId: 716, historyStateId: 10 }
}).status, 'retained', 'a rejected duplicate must not release the active same-generation writer');
const twoPhaseHandoff = resolveRuntimeInteractiveHandoff({
  preparation: twoPhasePreparation,
  resolution: twoPhaseCase.resolution,
  result: buildTrustedReadOnlyInteractiveHandoffResult(
    twoPhasePreparation,
    twoPhaseCase.resolution,
    { documentId: 716, historyStateId: 10 }
  ),
  photoshopObservationAfterSkill: { status: 'revision', revision: { documentId: 716, historyStateId: 10 } }
});
const twoPhaseReservation = stageRuntimeInteractiveReentry({
  reservation: twoPhasePreparation.reservation,
  reentry: twoPhaseHandoff.reentry,
  reentryTask: twoPhaseHandoff.reentryTask
});
assert(twoPhaseReservation, 'post-Skill handoff must atomically stage a non-replayable reentry');
assert.strictEqual(twoPhaseReservation.mode, 'resume_agent');
assert.throws(() => refreshActiveRuntimeInteractivePendingReentry({
  reservation: twoPhaseReservation,
  pendingReentry: {
    reentry: {
      ...twoPhaseHandoff.reentry,
      continuationId: 'runtime-interactive-another-owner'
    },
    reentryTask: twoPhaseHandoff.reentryTask
  }
}), /runtime_interactive_/, 'a reserved checkpoint must reject a pending reentry from another binding');
assert.strictEqual(cancelRuntimeInteractiveResume(twoPhaseReservation), true);
const retryAfterAgentInitFailure = prepareRuntimeInteractiveResume({
  continuationId: twoPhaseCase.continuationId,
  taskRunBinding: twoPhaseCase.suspension.binding,
  photoshopObservation: { status: 'revision', revision: { documentId: 716, historyStateId: 11 } }
});
assert.strictEqual(retryAfterAgentInitFailure.status, 'ready');
assert.strictEqual(
  retryAfterAgentInitFailure.mode,
  'resume_agent',
  'a failed first Agent request must retry the staged Agent handoff, never the consumed Skill'
);
assert.strictEqual(retryAfterAgentInitFailure.reentry.session.taskRun.status, 'needs_reobserve');
assert.strictEqual(
  retryAfterAgentInitFailure.reentry.session.taskRun.documentBinding.conflict.observedRevision.historyStateId,
  11,
  'pending reentry must reconcile the latest Photoshop revision on every retry'
);
assert.strictEqual(cancelRuntimeInteractiveResume(retryAfterAgentInitFailure.reservation), true);
const retryWithoutEnvironmentObservation = prepareRuntimeInteractiveResume({
  continuationId: twoPhaseCase.continuationId,
  taskRunBinding: twoPhaseCase.suspension.binding,
  photoshopObservation: { status: 'unavailable' }
});
assert.strictEqual(retryWithoutEnvironmentObservation.status, 'ready');
assert.strictEqual(retryWithoutEnvironmentObservation.mode, 'resume_agent');
assert.strictEqual(
  retryWithoutEnvironmentObservation.reentry.session.taskRun.documentBinding.conflict.kind,
  'operation_state_unknown'
);
assert.strictEqual(cancelRuntimeInteractiveResume(retryWithoutEnvironmentObservation.reservation), true);
const adoptableRetry = prepareRuntimeInteractiveResume({
  continuationId: twoPhaseCase.continuationId,
  taskRunBinding: twoPhaseCase.suspension.binding,
  photoshopObservation: { status: 'revision', revision: { documentId: 716, historyStateId: 10 } }
});
assert.strictEqual(adoptableRetry.mode, 'resume_agent');
assert.strictEqual(
  adoptableRetry.reentry.session.taskRun.status,
  'needs_reobserve',
  'later Undo to the old expected revision must not revive a reentry already tightened by conflict'
);
assert.strictEqual(
  adoptableRetry.reentry.session.taskRun.documentBinding.conflict.kind,
  'operation_state_unknown'
);
assert.strictEqual(adoptRuntimeInteractiveResume(adoptableRetry.reservation), true);
assert.strictEqual(releaseRuntimeTaskRunWriterBinding({
  taskRunId: twoPhaseCase.suspension.binding.taskRunId,
  runId: twoPhaseCase.suspension.binding.runId,
  generation: twoPhaseCase.suspension.binding.generation,
  documentId: 716
}), true);
assert.strictEqual(prepareRuntimeInteractiveResume({
  continuationId: twoPhaseCase.continuationId,
  taskRunBinding: twoPhaseCase.suspension.binding,
  photoshopObservation: { status: 'revision', revision: { documentId: 716, historyStateId: 10 } }
}).status, 'checkpoint_missing');

const appliedEffectCase = buildInteractiveAuditCase(
  'applied',
  { documentId: 712, historyStateId: 10 }
);
const appliedPreparation = prepareRuntimeInteractiveResume({
  continuationId: appliedEffectCase.continuationId,
  taskRunBinding: appliedEffectCase.suspension.binding,
  photoshopObservation: { status: 'revision', revision: { documentId: 712, historyStateId: 10 } }
});
const appliedProof = {
  version: 'photoshop-mutation-commit/v1',
  basis: 'same_execute_as_modal',
  bindingStrength: 'document_revision',
  before: { documentId: 712, historyStateId: 10, activeLayerId: null },
  after: { documentId: 712, historyStateId: 11, activeLayerId: 99 },
  toolActionCompleted: true,
  mutationObserved: true,
  documentChanged: false
};
const appliedToolResult = { success: true, photoshopMutationCommit: appliedProof };
const appliedHandoff = resolveRuntimeInteractiveHandoff({
  preparation: appliedPreparation,
  resolution: appliedEffectCase.resolution,
  result: buildInteractiveHandoffResult(
    appliedPreparation,
    appliedEffectCase.resolution,
    [{ name: 'placeImage', result: appliedToolResult }],
    (candidate) => candidate === appliedToolResult ? 'placeImage' : undefined
  ),
  photoshopObservationAfterSkill: { status: 'revision', revision: { documentId: 712, historyStateId: 11 } }
});
assert.strictEqual(appliedHandoff.effect, 'partial');
assert.strictEqual(
  appliedHandoff.reentry.session.taskRun.documentBinding.expectedRevision.historyStateId,
  11,
  'trusted applied/partial receipt must advance the same TaskRun revision before reentry'
);
assert.strictEqual(
  appliedHandoff.reentry.session.taskRun.operationResults.length,
  0,
  'Skill revision proof must not be forged into a same-modal PhotoshopOperationResult'
);
assert.strictEqual(
  appliedHandoff.reentry.session.taskRun.skillRevisionProjections[0].source,
  'mutation_commit',
  'the Runtime projection must preserve the original Host proof source'
);
const currentAppliedLineage = buildRuntimeInteractiveSkillExecutionLineage({
  preparation: appliedPreparation,
  resolution: appliedEffectCase.resolution
});
const staleGenerationHandoff = resolveRuntimeInteractiveHandoff({
  preparation: appliedPreparation,
  resolution: appliedEffectCase.resolution,
  result: buildInteractiveHandoffResult(
    appliedPreparation,
    appliedEffectCase.resolution,
    [{ name: 'placeImage', result: appliedToolResult }],
    (candidate) => candidate === appliedToolResult ? 'placeImage' : undefined,
    {
      runtimeLineage: {
        ...currentAppliedLineage,
        runId: 'run-stale-generation',
        generation: currentAppliedLineage.generation + 1
      }
    }
  ),
  photoshopObservationAfterSkill: {
    status: 'revision',
    revision: { documentId: 712, historyStateId: 11 }
  }
});
assert.strictEqual(staleGenerationHandoff.effect, 'missing');
assert.strictEqual(
  staleGenerationHandoff.reentry.session.taskRun.skillRevisionProjections?.length || 0,
  0,
  'a signed receipt from another generation must not project revisions into this TaskRun'
);
assert.strictEqual(
  staleGenerationHandoff.reentry.session.taskRun.sideEffectState?.status,
  'unknown'
);

const mixedRevisionCase = buildInteractiveAuditCase(
  'mixed-revision-unknown',
  { documentId: 718, historyStateId: 20 }
);
const mixedRevisionPreparation = prepareRuntimeInteractiveResume({
  continuationId: mixedRevisionCase.continuationId,
  taskRunBinding: mixedRevisionCase.suspension.binding,
  photoshopObservation: { status: 'revision', revision: { documentId: 718, historyStateId: 20 } }
});
const incompleteMutationResult = {
  success: false,
  photoshopMutationCommit: {
    ...appliedProof,
    before: { documentId: 718, historyStateId: 20, activeLayerId: null },
    after: { documentId: 718, historyStateId: 21, activeLayerId: 81 },
    toolActionCompleted: false
  }
};
const laterCompletedMutationResult = {
  success: true,
  photoshopMutationCommit: {
    ...appliedProof,
    before: { documentId: 718, historyStateId: 21, activeLayerId: 81 },
    after: { documentId: 718, historyStateId: 22, activeLayerId: 82 },
    toolActionCompleted: true
  }
};
const mixedRevisionHandoff = resolveRuntimeInteractiveHandoff({
  preparation: mixedRevisionPreparation,
  resolution: mixedRevisionCase.resolution,
  result: buildInteractiveHandoffResult(
    mixedRevisionPreparation,
    mixedRevisionCase.resolution,
    [
      { name: 'placeImage', result: incompleteMutationResult },
      { name: 'createTextLayer', result: laterCompletedMutationResult }
    ],
    (candidate) => {
      if (candidate === incompleteMutationResult) return 'placeImage';
      if (candidate === laterCompletedMutationResult) return 'createTextLayer';
      return undefined;
    }
  ),
  photoshopObservationAfterSkill: {
    status: 'revision',
    revision: { documentId: 718, historyStateId: 22 }
  }
});
assert.strictEqual(mixedRevisionHandoff.effect, 'partial');
assert.strictEqual(
  mixedRevisionHandoff.reentry.session.taskRun.documentBinding.conflict.kind,
  'operation_state_unknown',
  'a later completed revision in the same receipt must not clear an earlier unknown transition'
);
assert.strictEqual(
  mixedRevisionHandoff.reentry.session.taskRun.sideEffectState?.status,
  'unknown'
);
const metadataOnlyUnknownSession = reconcileRuntimeSkillEffectBeforeAgentAction({
  session: mixedRevisionHandoff.reentry.session,
  reentry: mixedRevisionHandoff.reentry,
  toolCallLog: [{
    name: 'getDocumentInfo',
    arguments: {},
    result: {
      success: true,
      historyStateRef: { documentId: 718, historyStateId: 22 }
    },
    origin: 'model_tool_call',
    modelTurn: 0
  }],
  nextToolName: 'createTextLayer',
  nextToolKind: 'photoshop_write',
  nextToolIsSkill: false,
  currentModelTurn: 1
});
assert.strictEqual(
  metadataOnlyUnknownSession.taskRun.sideEffectState?.status,
  'unknown',
  'ordinary document metadata must not clear an unknown Skill effect'
);
const visualUnknownObservation = {
  name: 'getCanvasSnapshot',
  arguments: {},
  result: {
    success: true,
    historyStateRef: { documentId: 718, historyStateId: 22 },
    snapshot: {
      base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZcR0AAAAASUVORK5CYII=' + 'A'.repeat(600),
      format: 'png'
    }
  },
  origin: 'model_tool_call'
};
const sameTurnVisualSession = reconcileRuntimeSkillEffectBeforeAgentAction({
  session: mixedRevisionHandoff.reentry.session,
  reentry: mixedRevisionHandoff.reentry,
  toolCallLog: [{ ...visualUnknownObservation, modelTurn: 1 }],
  nextToolName: 'createTextLayer',
  nextToolKind: 'photoshop_write',
  nextToolIsSkill: false,
  currentModelTurn: 1
});
assert.strictEqual(
  sameTurnVisualSession.taskRun.sideEffectState?.status,
  'unknown',
  'a snapshot executed earlier in the same provider response was not yet seen by the model'
);
const rawPixelOnlyVisualSession = reconcileRuntimeSkillEffectBeforeAgentAction({
  session: mixedRevisionHandoff.reentry.session,
  reentry: mixedRevisionHandoff.reentry,
  toolCallLog: [{ ...visualUnknownObservation, modelTurn: 0 }],
  nextToolName: 'createTextLayer',
  nextToolKind: 'photoshop_write',
  nextToolIsSkill: false,
  currentModelTurn: 1
});
assert.strictEqual(
  rawPixelOnlyVisualSession.taskRun.sideEffectState?.status,
  'unknown',
  'raw pixels alone cannot impersonate a Runtime-owned primary-model observation receipt'
);
const visualObservationIdentity = {
  outer: 'getCanvasSnapshot',
  resultPath: '$.snapshot',
  document: '718',
  history: '22',
  sourceKind: 'canvas',
  sourceId: 'active-canvas'
};
writeAgentVisualObservationReceipt(visualUnknownObservation.result, {
  version: VISUAL_OBSERVATION_RECEIPT_VERSION,
  document: '718',
  history: '22',
  sourceTool: 'getCanvasSnapshot'
});
const presentedUnknownObservation = writeAgentVisualObservation(visualUnknownObservation.result, {
  status: 'presented_to_primary',
  reviewed: false,
  observer: 'primary_model',
  strategy: 'primary-self',
  toolName: 'getCanvasSnapshot',
  observationIdentity: visualObservationIdentity,
  presentedModelTurn: 1
});
assert(presentedUnknownObservation);
const presentedOnlyVisualSession = reconcileRuntimeSkillEffectBeforeAgentAction({
  session: mixedRevisionHandoff.reentry.session,
  reentry: mixedRevisionHandoff.reentry,
  toolCallLog: [{ ...visualUnknownObservation, modelTurn: 0 }],
  nextToolName: 'createTextLayer',
  nextToolKind: 'photoshop_write',
  nextToolIsSkill: false,
  currentModelTurn: 1
});
assert.strictEqual(
  presentedOnlyVisualSession.taskRun.sideEffectState?.status,
  'unknown',
  'adding pixels to a pending provider message is not enough until that model turn completes'
);
markPrimaryVisualObservationsConsumed({
  observations: [presentedUnknownObservation],
  modelTurn: 1,
  consumed: true
});
compactPostWriteImagePayloadForRuntimeLog(visualUnknownObservation.result);
assert.strictEqual(
  extractImageFromToolResult(visualUnknownObservation.result),
  null,
  'runtime log compaction must remove pixels while preserving the signed observation annotation'
);
const visuallyReconciledSession = reconcileRuntimeSkillEffectBeforeAgentAction({
  session: mixedRevisionHandoff.reentry.session,
  reentry: mixedRevisionHandoff.reentry,
  toolCallLog: [{ ...visualUnknownObservation, modelTurn: 0 }],
  nextToolName: 'createTextLayer',
  nextToolKind: 'photoshop_write',
  nextToolIsSkill: false,
  currentModelTurn: 1
});
assert.strictEqual(visuallyReconciledSession.taskRun.sideEffectState, undefined);
assert.strictEqual(visuallyReconciledSession.taskRun.status, 'active');
assert.strictEqual(
  evaluateRuntimeSessionToolExecutionGate({
    session: visuallyReconciledSession,
    toolName: 'createTextLayer',
    toolKind: 'photoshop_write'
  }).code,
  undefined,
  'a visually reconciled current revision may continue through the ordinary Runtime gate'
);
const budgetSkippedVisualResult = {
  success: true,
  historyStateRef: { documentId: 718, historyStateId: 22 }
};
writeAgentVisualObservationReceipt(budgetSkippedVisualResult, {
  version: VISUAL_OBSERVATION_RECEIPT_VERSION,
  document: '718',
  history: '22',
  sourceTool: 'getCanvasSnapshot'
});
writeAgentVisualObservation(budgetSkippedVisualResult, {
  status: 'not_observed',
  reviewed: false,
  observer: 'none',
  strategy: 'primary-self',
  toolName: 'getCanvasSnapshot',
  observationIdentity: visualObservationIdentity,
  reason: 'vision_candidate_budget_exhausted'
});
const budgetSkippedVisualSession = reconcileRuntimeSkillEffectBeforeAgentAction({
  session: mixedRevisionHandoff.reentry.session,
  reentry: mixedRevisionHandoff.reentry,
  toolCallLog: [{
    name: 'getCanvasSnapshot',
    arguments: {},
    result: budgetSkippedVisualResult,
    origin: 'model_tool_call',
    modelTurn: 0
  }],
  nextToolName: 'createTextLayer',
  nextToolKind: 'photoshop_write',
  nextToolIsSkill: false,
  currentModelTurn: 1
});
assert.strictEqual(
  budgetSkippedVisualSession.taskRun.sideEffectState?.status,
  'unknown',
  'a budget-skipped image must not unlock an unknown Photoshop side effect'
);
const mixedRevisionReservation = stageRuntimeInteractiveReentry({
  reservation: mixedRevisionPreparation.reservation,
  reentry: mixedRevisionHandoff.reentry,
  reentryTask: mixedRevisionHandoff.reentryTask
});
assert(mixedRevisionReservation);
assert.strictEqual(adoptRuntimeInteractiveResume(mixedRevisionReservation), true);

const preservedExecutionJournal = appendRuntimeActionPlanExecutionObservation({
  journal: createRuntimeActionPlanExecutionJournal(),
  observation: {
    capabilityRefs: ['photoshop.read.document'],
    toolKind: 'read_only_observation',
    outcome: 'succeeded',
    iteration: 3
  }
});
const journalBoundReentry = {
  ...appliedHandoff.reentry,
  declarations: {
    ...appliedHandoff.reentry.declarations,
    actionPlan: {
      version: 'runtime-action-plan-declaration/v0',
      source: 'model_tool_call',
      readiness: 'ready'
    }
  },
  actionPlanExecutionJournal: {
    planRevision: appliedHandoff.reentry.session.taskRun.planRevision,
    journal: preservedExecutionJournal
  }
};
const journalReentryState = resolveRuntimeInteractiveAgentReentryState({
  config: {
    runtimeInteractiveReentry: journalBoundReentry,
    runtimeSessionSeed: journalBoundReentry.session,
    runtimeStagePlan: journalBoundReentry.plan,
    tools: [
      { name: 'sku-batch' },
      { name: 'createDocument' },
      { name: 'createTextLayer' },
      { name: 'getDocumentInfo' }
    ],
    toolCapabilityBridge: { workflowEntryTools: ['sku-batch'] }
  },
  session: journalBoundReentry.session
});
assert.strictEqual(
  journalReentryState.planning.runtimeActionPlanExecutionJournal,
  preservedExecutionJournal,
  'same-planRevision reentry must restore the real execution journal instead of creating an empty one'
);
const planlessReentryState = resolveRuntimeInteractiveAgentReentryState({
  config: {
    runtimeInteractiveReentry: noneHandoff.reentry,
    runtimeSessionSeed: noneHandoff.reentry.session,
    runtimeStagePlan: noneHandoff.reentry.plan,
    tools: [
      { name: 'sku-batch' },
      { name: 'createDocument' },
      { name: 'createTextLayer' },
      { name: 'getDocumentInfo' }
    ],
    toolCapabilityBridge: { workflowEntryTools: ['sku-batch'] }
  },
  session: noneHandoff.reentry.session
});
assert.strictEqual(
  planlessReentryState.planning.runtimeActionPlanExecutionJournal,
  undefined,
  'reentry without a carried Action Plan must not synthesize an empty journal'
);
assert.strictEqual(
  planlessReentryState.runtime.workflowContinuationScope.workflowCallId,
  noneHandoff.reentry.workflowHandoff.workflowCallId,
  'the first reentry turn must retain the original workflow handoff identity'
);
assert.strictEqual(
  planlessReentryState.runtime.pendingDirectWorkflowHandoff.workflowCallId,
  noneHandoff.reentry.workflowHandoff.workflowCallId,
  'compact Runtime must expose the restored handoff to structural recovery on the first zero-Tool turn'
);

const appliedStagedReservation = stageRuntimeInteractiveReentry({
  reservation: appliedPreparation.reservation,
  reentry: appliedHandoff.reentry,
  reentryTask: appliedHandoff.reentryTask
});
assert(appliedStagedReservation);
assert.strictEqual(cancelRuntimeInteractiveResume(appliedStagedReservation), true);
const appliedAgentInitRetry = prepareRuntimeInteractiveResume({
  continuationId: appliedEffectCase.continuationId,
  taskRunBinding: appliedEffectCase.suspension.binding,
  photoshopObservation: { status: 'revision', revision: { documentId: 712, historyStateId: 11 } }
});
assert.strictEqual(appliedAgentInitRetry.mode, 'resume_agent');
assert.strictEqual(
  appliedAgentInitRetry.reentry.session.taskRun.documentBinding.expectedRevision.historyStateId,
  11,
  'an applied Skill must resume from the post-Skill Session without executing the Skill again'
);
assert.strictEqual(adoptRuntimeInteractiveResume(appliedAgentInitRetry.reservation), true);

const appliedExternalChangeCase = buildInteractiveAuditCase(
  'applied-external-change',
  { documentId: 715, historyStateId: 10 }
);
const appliedExternalChangePreparation = prepareRuntimeInteractiveResume({
  continuationId: appliedExternalChangeCase.continuationId,
  taskRunBinding: appliedExternalChangeCase.suspension.binding,
  photoshopObservation: { status: 'revision', revision: { documentId: 715, historyStateId: 10 } }
});
const appliedExternalProof = {
  ...appliedProof,
  before: { documentId: 715, historyStateId: 10, activeLayerId: null },
  after: { documentId: 715, historyStateId: 11, activeLayerId: 99 }
};
const appliedExternalToolResult = {
  success: true,
  photoshopMutationCommit: appliedExternalProof
};
const appliedExternalChangeHandoff = resolveRuntimeInteractiveHandoff({
  preparation: appliedExternalChangePreparation,
  resolution: appliedExternalChangeCase.resolution,
  result: buildInteractiveHandoffResult(
    appliedExternalChangePreparation,
    appliedExternalChangeCase.resolution,
    [{ name: 'placeImage', result: appliedExternalToolResult }],
    (candidate) => candidate === appliedExternalToolResult ? 'placeImage' : undefined
  ),
  photoshopObservationAfterSkill: { status: 'revision', revision: { documentId: 715, historyStateId: 12 } }
});
assert.strictEqual(appliedExternalChangeHandoff.effect, 'partial');
assert.strictEqual(appliedExternalChangeHandoff.reentry.session.taskRun.status, 'needs_reobserve');
assert.strictEqual(
  appliedExternalChangeHandoff.reentry.session.taskRun.documentBinding.expectedRevision.historyStateId,
  11,
  'trusted Skill revision must be projected before checking for a later external change'
);
assert.strictEqual(
  appliedExternalChangeHandoff.reentry.session.taskRun.documentBinding.conflict.observedRevision.historyStateId,
  12
);
assert.strictEqual(
  appliedExternalChangeHandoff.reentry.session.taskRun.documentBinding.conflict.kind,
  'external_revision_changed'
);

const unknownEffectCase = buildInteractiveAuditCase(
  'unknown',
  { documentId: 713, historyStateId: 20 }
);
const unknownPreparation = prepareRuntimeInteractiveResume({
  continuationId: unknownEffectCase.continuationId,
  taskRunBinding: unknownEffectCase.suspension.binding,
  photoshopObservation: { status: 'revision', revision: { documentId: 713, historyStateId: 20 } }
});
const unknownHandoff = resolveRuntimeInteractiveHandoff({
  preparation: unknownPreparation,
  resolution: unknownEffectCase.resolution,
  result: buildInteractiveHandoffResult(
    unknownPreparation,
    unknownEffectCase.resolution,
    [{ name: 'placeImage', result: { success: false } }],
    () => undefined
  ),
  photoshopObservationAfterSkill: { status: 'revision', revision: { documentId: 713, historyStateId: 21 } }
});
assert.strictEqual(unknownHandoff.effect, 'unknown');
assert.strictEqual(unknownHandoff.reentry.session.taskRun.status, 'needs_reobserve');
assert.strictEqual(
  unknownHandoff.reentry.session.taskRun.documentBinding.conflict.kind,
  'operation_state_unknown',
  'unknown effect must never continue with the stale pre-confirmation revision'
);
assert.strictEqual(
  shouldDeferRuntimeArtifactFinalizationForInteraction(unknownHandoff.reentry.session),
  true,
  'operation_state_unknown must not consume Artifact finalization authorization'
);
const unknownStagedReservation = stageRuntimeInteractiveReentry({
  reservation: unknownPreparation.reservation,
  reentry: unknownHandoff.reentry,
  reentryTask: unknownHandoff.reentryTask
});
assert(unknownStagedReservation);
assert.strictEqual(cancelRuntimeInteractiveResume(unknownStagedReservation), true);
const unknownAgentInitRetry = prepareRuntimeInteractiveResume({
  continuationId: unknownEffectCase.continuationId,
  taskRunBinding: unknownEffectCase.suspension.binding,
  photoshopObservation: { status: 'revision', revision: { documentId: 713, historyStateId: 21 } }
});
assert.strictEqual(unknownAgentInitRetry.mode, 'resume_agent');
assert.strictEqual(
  unknownAgentInitRetry.reentry.session.taskRun.documentBinding.conflict.kind,
  'operation_state_unknown',
  'an unknown Skill effect must preserve its reconciliation requirement across Agent init failure'
);
assert.strictEqual(adoptRuntimeInteractiveResume(unknownAgentInitRetry.reservation), true);

async function assertPostSkillExceptionRetainsRecoverableAgentOwner() {
  const recoveryCase = buildInteractiveAuditCase(
    'post-skill-exception-recovery',
    { documentId: 719, historyStateId: 30 }
  );
  const preparation = prepareRuntimeInteractiveResume({
    continuationId: recoveryCase.continuationId,
    taskRunBinding: recoveryCase.suspension.binding,
    photoshopObservation: {
      status: 'revision',
      revision: { documentId: 719, historyStateId: 30 }
    }
  });
  assert.strictEqual(preparation.status, 'ready');
  assert.strictEqual(preparation.mode, 'execute_skill');
  const previousWindow = global.window;
  let skillExecutionCount = 0;
  global.window = {
    designEcho: {
      invoke: async (channel) => {
        if (channel === 'interactiveContinuation:begin') {
          return {
            success: true,
            code: 'interactive_continuation_operation_started',
            message: 'started',
            record: { status: 'running' }
          };
        }
        if (channel === 'interactiveContinuation:settle') {
          return {
            success: true,
            code: 'interactive_continuation_operation_unknown_after_execution_failure',
            message: 'unknown',
            record: { status: 'unknown', mutationState: 'unknown' }
          };
        }
        throw new Error(`unexpected interactive ledger channel: ${channel}`);
      }
    }
  };
  try {
    const runResult = await runRuntimeInteractiveContinuation({
      requestId: 'request-post-skill-exception-recovery',
      operationIdentity: {
        continuationId: recoveryCase.continuationId,
        sourceMessageId: recoveryCase.resolution.sourceMessageId,
        cardId: recoveryCase.resolution.submission.cardId,
        submissionFingerprint: 'post-skill-exception-recovery-fingerprint'
      },
      resolution: recoveryCase.resolution,
      preparation,
      executeSkill: async () => {
        skillExecutionCount += 1;
        throw new Error('simulated post-skill exception');
      },
      readPhotoshopObservation: async () => ({
        status: 'revision',
        revision: { documentId: 719, historyStateId: 31 }
      }),
      executeAgentReentry: async ({ reentry }) => {
        assert.strictEqual(
          reentry.session.taskRun.documentBinding.conflict.kind,
          'operation_state_unknown'
        );
        return {
          success: false,
          message: 'Agent 初始化失败，稍后沿 pending reentry 重试。',
          data: {
            executionSummary: {
              status: 'failed',
              successfulMutationCalls: 0
            }
          }
        };
      }
    });
    assert.strictEqual(runResult.kind, 'agent_result');
    assert.strictEqual(runResult.adopted, false);
    assert.strictEqual(skillExecutionCount, 1);
    const retry = prepareRuntimeInteractiveResume({
      continuationId: recoveryCase.continuationId,
      taskRunBinding: recoveryCase.suspension.binding,
      photoshopObservation: {
        status: 'revision',
        revision: { documentId: 719, historyStateId: 31 }
      }
    });
    assert.strictEqual(retry.status, 'ready');
    assert.strictEqual(
      retry.mode,
      'resume_agent',
      'post-Skill exception retry must resume reconciliation and never replay the Skill'
    );
    assert.strictEqual(retry.reentry.session.taskRun.documentBinding.conflict.kind, 'operation_state_unknown');
    assert.strictEqual(adoptRuntimeInteractiveResume(retry.reservation), true);
    assert.strictEqual(releaseRuntimeTaskRunWriterBinding({
      taskRunId: recoveryCase.suspension.binding.taskRunId,
      runId: recoveryCase.suspension.binding.runId,
      generation: recoveryCase.suspension.binding.generation,
      documentId: 719
    }), true);
  } finally {
    if (previousWindow === undefined) {
      delete global.window;
    } else {
      global.window = previousWindow;
    }
  }
}

async function assertChainedConfirmationKeepsSameRuntimeOwner() {
  const chainedCase = buildInteractiveAuditCase(
    'chained-confirmation',
    { documentId: 720, historyStateId: 40 }
  );
  const preparation = prepareRuntimeInteractiveResume({
    continuationId: chainedCase.continuationId,
    taskRunBinding: chainedCase.suspension.binding,
    photoshopObservation: {
      status: 'revision',
      revision: { documentId: 720, historyStateId: 40 }
    }
  });
  assert.strictEqual(preparation.status, 'ready');
  assert.strictEqual(preparation.mode, 'execute_skill');
  const nextCard = {
    version: 'interactive-card/v0',
    id: 'card-chained-confirmation-second',
    kind: 'sku-second-confirmation',
    title: '继续确认下一项',
    payload: { step: 2 },
    status: 'draft'
  };
  const nextContinuation = {
    version: 'pending-interactive-continuation/v0',
    id: 'runtime-interactive-chained-confirmation-second',
    createdAt: '2026-08-24T06:20:00.000Z',
    sourceTask: '帮我做 SKU 编排',
    scope: { photoshopDocumentId: 720 },
    operation: {
      kind: 'skill_execution',
      skillId: 'sku-batch',
      params: { step: 2 }
    },
    card: nextCard,
    oneTime: true
  };
  const previousWindow = global.window;
  global.window = {
    designEcho: {
      invoke: async (channel) => {
        if (channel === 'interactiveContinuation:begin') {
          return {
            success: true,
            code: 'interactive_continuation_operation_started',
            message: 'started',
            record: { status: 'running' }
          };
        }
        if (channel === 'interactiveContinuation:settle') {
          return {
            success: true,
            code: 'interactive_continuation_operation_succeeded',
            message: 'succeeded',
            record: { status: 'succeeded', mutationState: 'none' }
          };
        }
        throw new Error(`unexpected interactive ledger channel: ${channel}`);
      }
    }
  };
  try {
    const runResult = await runRuntimeInteractiveContinuation({
      requestId: 'request-chained-confirmation',
      operationIdentity: {
        continuationId: chainedCase.continuationId,
        sourceMessageId: chainedCase.resolution.sourceMessageId,
        cardId: chainedCase.resolution.submission.cardId,
        submissionFingerprint: 'chained-confirmation-fingerprint'
      },
      resolution: chainedCase.resolution,
      preparation,
      executeSkill: async (runtimeLineage) => attachSkillExecutionEffectReceipt({
        success: true,
        message: '第一项已确认，等待下一项确认。',
        skillOutcome: {
          version: 'skill-execution-outcome/v0',
          status: 'awaiting_confirmation',
          summary: '等待下一项确认。',
          outputs: [],
          blockers: [],
          warnings: []
        },
        data: {
          interactiveCards: [nextCard],
          awaitingUserConfirmation: true,
          pendingInteractiveContinuation: nextContinuation
        }
      }, {
        skillId: 'sku-batch',
        executionStarted: false,
        outcomeStatus: 'awaiting_confirmation',
        runtimeLineage
      }),
      readPhotoshopObservation: async () => ({
        status: 'revision',
        revision: { documentId: 720, historyStateId: 40 }
      }),
      executeAgentReentry: async () => {
        throw new Error('awaiting_confirmation must not enter Agent reentry');
      }
    });
    assert.strictEqual(runResult.kind, 'direct_result');
    assert.strictEqual(runResult.settlementStatus, 'awaiting_confirmation');
    const boundContinuation = runResult.result.data.pendingInteractiveContinuation;
    assert.strictEqual(boundContinuation.id, nextContinuation.id);
    assert.strictEqual(
      boundContinuation.taskRunBinding.taskRunId,
      chainedCase.suspension.binding.taskRunId,
      'a chained card must remain in the same TaskRun instead of becoming an unbound historical card'
    );
    assert.strictEqual(prepareRuntimeInteractiveResume({
      continuationId: chainedCase.continuationId,
      taskRunBinding: chainedCase.suspension.binding,
      photoshopObservation: {
        status: 'revision',
        revision: { documentId: 720, historyStateId: 40 }
      }
    }).status, 'checkpoint_missing',
      'atomic chained swap must consume the old checkpoint in the same store transition');
    const nextPreparation = prepareRuntimeInteractiveResume({
      continuationId: boundContinuation.id,
      taskRunBinding: boundContinuation.taskRunBinding,
      photoshopObservation: {
        status: 'revision',
        revision: { documentId: 720, historyStateId: 40 }
      }
    });
    assert.strictEqual(nextPreparation.status, 'ready');
    assert.strictEqual(nextPreparation.mode, 'execute_skill');
    assert.strictEqual(commitRuntimeInteractiveResume(nextPreparation.reservation), true);
    assert.strictEqual(releaseRuntimeTaskRunWriterBinding({
      taskRunId: chainedCase.suspension.binding.taskRunId,
      runId: chainedCase.suspension.binding.runId,
      generation: chainedCase.suspension.binding.generation,
      documentId: 720
    }), true);
  } finally {
    if (previousWindow === undefined) {
      delete global.window;
    } else {
      global.window = previousWindow;
    }
  }
}

async function assertSucceededUnknownStillStagesRecovery() {
  const unknownSuccessCase = buildInteractiveAuditCase(
    'succeeded-unknown-recovery',
    { documentId: 721, historyStateId: 50 }
  );
  const preparation = prepareRuntimeInteractiveResume({
    continuationId: unknownSuccessCase.continuationId,
    taskRunBinding: unknownSuccessCase.suspension.binding,
    photoshopObservation: {
      status: 'revision',
      revision: { documentId: 721, historyStateId: 50 }
    }
  });
  const previousWindow = global.window;
  let skillExecutionCount = 0;
  global.window = {
    designEcho: {
      invoke: async (channel) => {
        if (channel === 'interactiveContinuation:begin') {
          return { success: true, code: 'started', message: 'started', record: { status: 'running' } };
        }
        if (channel === 'interactiveContinuation:settle') {
          return {
            success: true,
            code: 'succeeded',
            message: 'ledger accepted a succeeded result with unknown mutation state',
            record: { status: 'succeeded', mutationState: 'unknown' }
          };
        }
        throw new Error(`unexpected interactive ledger channel: ${channel}`);
      }
    }
  };
  try {
    const runResult = await runRuntimeInteractiveContinuation({
      requestId: 'request-succeeded-unknown-recovery',
      operationIdentity: {
        continuationId: unknownSuccessCase.continuationId,
        sourceMessageId: unknownSuccessCase.resolution.sourceMessageId,
        cardId: unknownSuccessCase.resolution.submission.cardId,
        submissionFingerprint: 'succeeded-unknown-recovery-fingerprint'
      },
      resolution: unknownSuccessCase.resolution,
      preparation,
      executeSkill: async () => {
        skillExecutionCount += 1;
        return { success: true, message: 'Skill 返回成功，但没有可信 mutation receipt。' };
      },
      readPhotoshopObservation: async () => ({
        status: 'revision',
        revision: { documentId: 721, historyStateId: 51 }
      }),
      executeAgentReentry: async ({ reentry }) => {
        assert.strictEqual(reentry.session.taskRun.sideEffectState?.status, 'unknown');
        return {
          success: false,
          message: 'Agent 初始化失败，保留 recovery。',
          data: { executionSummary: { status: 'failed', successfulMutationCalls: 0 } }
        };
      }
    });
    assert.strictEqual(runResult.kind, 'agent_result');
    assert.strictEqual(runResult.adopted, false);
    assert.strictEqual(skillExecutionCount, 1);
    const retry = prepareRuntimeInteractiveResume({
      continuationId: unknownSuccessCase.continuationId,
      taskRunBinding: unknownSuccessCase.suspension.binding,
      photoshopObservation: {
        status: 'revision',
        revision: { documentId: 721, historyStateId: 51 }
      }
    });
    assert.strictEqual(retry.status, 'ready');
    assert.strictEqual(retry.mode, 'resume_agent',
      'mutationState=unknown must never direct-commit even when ledger status is succeeded');
    assert.strictEqual(adoptRuntimeInteractiveResume(retry.reservation), true);
    assert.strictEqual(releaseRuntimeTaskRunWriterBinding({
      taskRunId: unknownSuccessCase.suspension.binding.taskRunId,
      runId: unknownSuccessCase.suspension.binding.runId,
      generation: unknownSuccessCase.suspension.binding.generation,
      documentId: 721
    }), true);
  } finally {
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
}

async function assertBeginFailureDoesNotReleaseRetainedWriter() {
  const retainedCase = buildInteractiveAuditCase(
    'begin-failure-retained-writer',
    { documentId: 722, historyStateId: 60 }
  );
  const preparation = prepareRuntimeInteractiveResume({
    continuationId: retainedCase.continuationId,
    taskRunBinding: retainedCase.suspension.binding,
    photoshopObservation: {
      status: 'revision',
      revision: { documentId: 722, historyStateId: 60 }
    }
  });
  assert.strictEqual(claimRuntimeTaskRunWriterBinding({
    taskRunId: retainedCase.suspension.binding.taskRunId,
    runId: retainedCase.suspension.binding.runId,
    generation: retainedCase.suspension.binding.generation,
    expectedRevision: { documentId: 722, historyStateId: 60 }
  }).status, 'acquired');
  const previousWindow = global.window;
  global.window = {
    designEcho: {
      invoke: async (channel) => {
        if (channel === 'interactiveContinuation:begin') {
          return { success: false, code: 'begin_rejected', message: 'begin rejected' };
        }
        throw new Error(`unexpected interactive ledger channel: ${channel}`);
      }
    }
  };
  try {
    const runResult = await runRuntimeInteractiveContinuation({
      operationIdentity: {
        continuationId: retainedCase.continuationId,
        sourceMessageId: retainedCase.resolution.sourceMessageId,
        cardId: retainedCase.resolution.submission.cardId,
        submissionFingerprint: 'begin-failure-retained-writer-fingerprint'
      },
      resolution: retainedCase.resolution,
      preparation,
      executeSkill: async () => {
        throw new Error('begin failure must not execute Skill');
      },
      readPhotoshopObservation: async () => ({ status: 'unavailable' }),
      executeAgentReentry: async () => {
        throw new Error('begin failure must not enter Agent');
      }
    });
    assert.strictEqual(runResult.kind, 'blocked');
    assert.strictEqual(runResult.phase, 'ledger_begin');
    assert.strictEqual(claimRuntimeTaskRunWriterBinding({
      taskRunId: retainedCase.suspension.binding.taskRunId,
      runId: retainedCase.suspension.binding.runId,
      generation: retainedCase.suspension.binding.generation,
      expectedRevision: { documentId: 722, historyStateId: 60 }
    }).status, 'retained', 'begin failure must not release a writer retained from the waiting TaskRun');
    const cleanup = prepareRuntimeInteractiveResume({
      continuationId: retainedCase.continuationId,
      taskRunBinding: retainedCase.suspension.binding,
      photoshopObservation: {
        status: 'revision',
        revision: { documentId: 722, historyStateId: 60 }
      }
    });
    assert.strictEqual(cleanup.status, 'ready');
    assert.strictEqual(commitRuntimeInteractiveResume(cleanup.reservation), true);
    assert.strictEqual(releaseRuntimeTaskRunWriterBinding({
      taskRunId: retainedCase.suspension.binding.taskRunId,
      runId: retainedCase.suspension.binding.runId,
      generation: retainedCase.suspension.binding.generation,
      documentId: 722
    }), true);
  } finally {
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
}

async function assertFailedChainedSwapFallsBackToOldRecoveryOwner() {
  const swapFailureCase = buildInteractiveAuditCase(
    'chained-swap-failure',
    { documentId: 723, historyStateId: 70 }
  );
  const preparation = prepareRuntimeInteractiveResume({
    continuationId: swapFailureCase.continuationId,
    taskRunBinding: swapFailureCase.suspension.binding,
    photoshopObservation: {
      status: 'revision',
      revision: { documentId: 723, historyStateId: 70 }
    }
  });
  const invalidNextCard = {
    version: 'interactive-card/v0',
    id: 'card-chained-swap-failure-next',
    kind: 'sku-next-confirmation',
    title: '下一确认项',
    payload: {},
    status: 'draft'
  };
  const invalidNextContinuation = {
    version: 'pending-interactive-continuation/v0',
    id: swapFailureCase.continuationId,
    createdAt: '2026-08-24T06:30:00.000Z',
    sourceTask: '帮我做 SKU 编排',
    scope: { photoshopDocumentId: 723 },
    operation: { kind: 'skill_execution', skillId: 'sku-batch', params: {} },
    card: invalidNextCard,
    oneTime: true
  };
  const previousWindow = global.window;
  global.window = {
    designEcho: {
      invoke: async (channel) => {
        if (channel === 'interactiveContinuation:begin') {
          return { success: true, code: 'started', message: 'started', record: { status: 'running' } };
        }
        if (channel === 'interactiveContinuation:settle') {
          return {
            success: true,
            code: 'succeeded',
            message: 'succeeded',
            record: { status: 'succeeded', mutationState: 'none' }
          };
        }
        throw new Error(`unexpected interactive ledger channel: ${channel}`);
      }
    }
  };
  try {
    const runResult = await runRuntimeInteractiveContinuation({
      operationIdentity: {
        continuationId: swapFailureCase.continuationId,
        sourceMessageId: swapFailureCase.resolution.sourceMessageId,
        cardId: swapFailureCase.resolution.submission.cardId,
        submissionFingerprint: 'chained-swap-failure-fingerprint'
      },
      resolution: swapFailureCase.resolution,
      preparation,
      executeSkill: async (runtimeLineage) => attachSkillExecutionEffectReceipt({
        success: true,
        skillOutcome: {
          version: 'skill-execution-outcome/v0',
          status: 'awaiting_confirmation',
          summary: '等待下一项确认。',
          outputs: [], blockers: [], warnings: []
        },
        data: {
          interactiveCards: [invalidNextCard],
          awaitingUserConfirmation: true,
          pendingInteractiveContinuation: invalidNextContinuation
        }
      }, {
        skillId: 'sku-batch',
        executionStarted: false,
        outcomeStatus: 'awaiting_confirmation',
        runtimeLineage
      }),
      readPhotoshopObservation: async () => ({
        status: 'revision',
        revision: { documentId: 723, historyStateId: 70 }
      }),
      executeAgentReentry: async ({ reentry }) => {
        assert.strictEqual(reentry.session.taskRun.sideEffectState?.status, 'unknown');
        return {
          success: false,
          message: '保留旧 interaction 的 recovery owner。',
          data: { executionSummary: { status: 'failed', successfulMutationCalls: 0 } }
        };
      }
    });
    assert.strictEqual(runResult.kind, 'agent_result');
    assert.strictEqual(runResult.adopted, false);
    const retry = prepareRuntimeInteractiveResume({
      continuationId: swapFailureCase.continuationId,
      taskRunBinding: swapFailureCase.suspension.binding,
      photoshopObservation: {
        status: 'revision',
        revision: { documentId: 723, historyStateId: 70 }
      }
    });
    assert.strictEqual(retry.status, 'ready');
    assert.strictEqual(retry.mode, 'resume_agent',
      'failed chained swap must preserve the old reservation as a non-replayable recovery owner');
    assert.strictEqual(adoptRuntimeInteractiveResume(retry.reservation), true);
    assert.strictEqual(releaseRuntimeTaskRunWriterBinding({
      taskRunId: swapFailureCase.suspension.binding.taskRunId,
      runId: swapFailureCase.suspension.binding.runId,
      generation: swapFailureCase.suspension.binding.generation,
      documentId: 723
    }), true);
  } finally {
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
}

function assertAbortToPersistentRecoveryPreservesCheckpointOwner() {
  const recoveryCase = buildInteractiveAuditCase(
    'abort-to-persistent-recovery',
    { documentId: 724, historyStateId: 80 }
  );
  const preparation = prepareRuntimeInteractiveResume({
    continuationId: recoveryCase.continuationId,
    taskRunBinding: recoveryCase.suspension.binding,
    photoshopObservation: {
      status: 'revision',
      revision: { documentId: 724, historyStateId: 80 }
    }
  });
  const recovery = buildRuntimeInteractivePostSkillRecovery({
    preparation,
    resolution: recoveryCase.resolution,
    message: 'simulated staging failure',
    photoshopObservationAfterSkill: {
      status: 'revision',
      revision: { documentId: 724, historyStateId: 81 }
    }
  });
  assert.strictEqual(abortRuntimeInteractiveResumeToPersistentRecovery({
    reservation: preparation.reservation,
    reentry: recovery.reentry,
    reentryTask: recovery.reentryTask
  }), true);
  const retry = prepareRuntimeInteractiveResume({
    continuationId: recoveryCase.continuationId,
    taskRunBinding: recoveryCase.suspension.binding,
    photoshopObservation: {
      status: 'revision',
      revision: { documentId: 724, historyStateId: 81 }
    }
  });
  assert.strictEqual(retry.status, 'ready');
  assert.strictEqual(retry.mode, 'resume_agent',
    'abort-to-recovery must preserve the old checkpoint as a non-replayable Agent owner');
  assert.strictEqual(adoptRuntimeInteractiveResume(retry.reservation), true);
}

async function assertLostCheckpointPersistsOperationUnknown() {
  const lostCheckpointCase = buildInteractiveAuditCase(
    'lost-checkpoint-persistent-unknown',
    { documentId: 725, historyStateId: 90 }
  );
  const preparation = prepareRuntimeInteractiveResume({
    continuationId: lostCheckpointCase.continuationId,
    taskRunBinding: lostCheckpointCase.suspension.binding,
    photoshopObservation: {
      status: 'revision',
      revision: { documentId: 725, historyStateId: 90 }
    }
  });
  const previousWindow = global.window;
  let markUnknownCount = 0;
  global.window = {
    designEcho: {
      invoke: async (channel) => {
        if (channel === 'interactiveContinuation:begin') {
          return { success: true, code: 'started', message: 'started', record: { status: 'running' } };
        }
        if (channel === 'interactiveContinuation:settle') {
          return {
            success: true,
            code: 'succeeded',
            message: 'succeeded',
            record: { status: 'succeeded', mutationState: 'unknown' }
          };
        }
        if (channel === 'interactiveContinuation:markUnknown') {
          markUnknownCount += 1;
          return {
            success: true,
            code: 'interactive_continuation_operation_marked_unknown',
            message: 'persisted unknown',
            record: { status: 'unknown', mutationState: 'unknown' }
          };
        }
        throw new Error(`unexpected interactive ledger channel: ${channel}`);
      }
    }
  };
  try {
    const runResult = await runRuntimeInteractiveContinuation({
      operationIdentity: {
        continuationId: lostCheckpointCase.continuationId,
        sourceMessageId: lostCheckpointCase.resolution.sourceMessageId,
        cardId: lostCheckpointCase.resolution.submission.cardId,
        submissionFingerprint: 'lost-checkpoint-persistent-unknown-fingerprint'
      },
      resolution: lostCheckpointCase.resolution,
      preparation,
      executeSkill: async () => {
        assert.strictEqual(commitRuntimeInteractiveResume(preparation.reservation), true,
          'fixture must simulate checkpoint loss after Skill execution begins');
        return buildInteractiveHandoffResult([], () => undefined);
      },
      readPhotoshopObservation: async () => ({
        status: 'revision',
        revision: { documentId: 725, historyStateId: 91 }
      }),
      executeAgentReentry: async () => {
        throw new Error('lost checkpoint must stop before Agent reentry');
      }
    });
    assert.strictEqual(runResult.kind, 'blocked');
    assert.strictEqual(runResult.recoveryStatus, 'operation_unknown_persisted');
    assert.strictEqual(markUnknownCount, 1);
    assert.strictEqual(claimRuntimeTaskRunWriterBinding({
      taskRunId: lostCheckpointCase.suspension.binding.taskRunId,
      runId: lostCheckpointCase.suspension.binding.runId,
      generation: lostCheckpointCase.suspension.binding.generation,
      expectedRevision: { documentId: 725, historyStateId: 90 }
    }).status, 'retained',
      'post-Skill persistent-unknown fallback must not release even a writer acquired by this run');
    assert.strictEqual(releaseRuntimeTaskRunWriterBinding({
      taskRunId: lostCheckpointCase.suspension.binding.taskRunId,
      runId: lostCheckpointCase.suspension.binding.runId,
      generation: lostCheckpointCase.suspension.binding.generation,
      documentId: 725
    }), true);
  } finally {
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
}

async function assertPersistencePendingRetriesBeforeAgentResume() {
  const persistenceCase = buildInteractiveAuditCase(
    'persistence-pending-retry',
    { documentId: 726, historyStateId: 100 }
  );
  const firstPreparation = prepareRuntimeInteractiveResume({
    continuationId: persistenceCase.continuationId,
    taskRunBinding: persistenceCase.suspension.binding,
    photoshopObservation: {
      status: 'revision',
      revision: { documentId: 726, historyStateId: 100 }
    }
  });
  const previousWindow = global.window;
  let markUnknownCount = 0;
  let skillExecutionCount = 0;
  let agentExecutionCount = 0;
  global.window = {
    designEcho: {
      invoke: async (channel) => {
        if (channel === 'interactiveContinuation:begin') {
          return { success: true, code: 'started', message: 'started', record: { status: 'running' } };
        }
        if (channel === 'interactiveContinuation:settle') {
          return {
            success: false,
            code: 'ledger_temporarily_unavailable',
            message: 'settlement unavailable'
          };
        }
        if (channel === 'interactiveContinuation:markUnknown') {
          markUnknownCount += 1;
          if (markUnknownCount < 3) {
            return {
              success: false,
              code: 'unknown_persistence_temporarily_unavailable',
              message: 'retry later'
            };
          }
          return {
            success: true,
            code: 'interactive_continuation_operation_marked_unknown',
            message: 'persisted unknown',
            record: { status: 'unknown', mutationState: 'unknown' }
          };
        }
        throw new Error(`unexpected interactive ledger channel: ${channel}`);
      }
    }
  };
  const operationIdentity = {
    continuationId: persistenceCase.continuationId,
    sourceMessageId: persistenceCase.resolution.sourceMessageId,
    cardId: persistenceCase.resolution.submission.cardId,
    submissionFingerprint: 'persistence-pending-retry-fingerprint'
  };
  try {
    const firstRun = await runRuntimeInteractiveContinuation({
      operationIdentity,
      resolution: persistenceCase.resolution,
      preparation: firstPreparation,
      executeSkill: async () => {
        skillExecutionCount += 1;
        throw new Error('simulated post-Skill exception');
      },
      readPhotoshopObservation: async () => ({
        status: 'revision',
        revision: { documentId: 726, historyStateId: 101 }
      }),
      executeAgentReentry: async () => {
        agentExecutionCount += 1;
        throw new Error('persistence pending must block Agent');
      }
    });
    assert.strictEqual(firstRun.kind, 'blocked');
    assert.strictEqual(firstRun.recoveryStatus, 'persistence_pending');
    assert.strictEqual(agentExecutionCount, 0);

    const secondPreparation = prepareRuntimeInteractiveResume({
      continuationId: persistenceCase.continuationId,
      taskRunBinding: persistenceCase.suspension.binding,
      photoshopObservation: {
        status: 'revision',
        revision: { documentId: 726, historyStateId: 101 }
      }
    });
    assert.strictEqual(secondPreparation.status, 'ready');
    assert.strictEqual(secondPreparation.mode, 'resume_agent');
    const secondRun = await runRuntimeInteractiveContinuation({
      operationIdentity,
      resolution: persistenceCase.resolution,
      preparation: secondPreparation,
      executeSkill: async () => {
        skillExecutionCount += 1;
        throw new Error('resume_agent must never replay Skill');
      },
      readPhotoshopObservation: async () => ({ status: 'unavailable' }),
      executeAgentReentry: async () => {
        agentExecutionCount += 1;
        throw new Error('failed unknown persistence must still block Agent');
      }
    });
    assert.strictEqual(secondRun.kind, 'blocked');
    assert.strictEqual(secondRun.recoveryStatus, 'persistence_pending');
    assert.strictEqual(agentExecutionCount, 0);

    const thirdPreparation = prepareRuntimeInteractiveResume({
      continuationId: persistenceCase.continuationId,
      taskRunBinding: persistenceCase.suspension.binding,
      photoshopObservation: {
        status: 'revision',
        revision: { documentId: 726, historyStateId: 101 }
      }
    });
    assert.strictEqual(thirdPreparation.status, 'ready');
    assert.strictEqual(thirdPreparation.mode, 'resume_agent');
    const thirdRun = await runRuntimeInteractiveContinuation({
      operationIdentity,
      resolution: persistenceCase.resolution,
      preparation: thirdPreparation,
      executeSkill: async () => {
        skillExecutionCount += 1;
        throw new Error('resume_agent must never replay Skill');
      },
      readPhotoshopObservation: async () => ({ status: 'unavailable' }),
      executeAgentReentry: async ({ adopt }) => {
        agentExecutionCount += 1;
        assert.strictEqual(adopt(), true);
        return {
          success: false,
          message: 'Agent 已在持久化 unknown 后接管恢复。',
          data: { executionSummary: { status: 'failed', successfulMutationCalls: 0 } }
        };
      }
    });
    assert.strictEqual(thirdRun.kind, 'agent_result');
    assert.strictEqual(thirdRun.adopted, true);
    assert.strictEqual(skillExecutionCount, 1);
    assert.strictEqual(agentExecutionCount, 1);
    assert.strictEqual(markUnknownCount, 3);
    assert.strictEqual(releaseRuntimeTaskRunWriterBinding({
      taskRunId: persistenceCase.suspension.binding.taskRunId,
      runId: persistenceCase.suspension.binding.runId,
      generation: persistenceCase.suspension.binding.generation,
      documentId: 726
    }), true);
  } finally {
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
}

const stageRecoveryInput = {
  obligation: 'runtime_stage_incomplete',
  stageState: {
    currentStage: 'E1',
    stages: [{
      stage: 'E1',
      status: 'awaiting_outcomes',
      missingOutcomes: ['photoshop_mutation']
    }]
  },
  attempt: 1
};
const structuralRecoveryCases = [
  [{ taskRunStatus: 'waiting_user' }, 'waiting_user'],
  [{ hasPendingInteraction: true }, 'pending_interaction'],
  [{ taskRunStatus: 'writer_conflict' }, 'writer_conflict'],
  [{ documentConflictKind: 'writer_conflict' }, 'writer_conflict'],
  [{ taskRunStatus: 'needs_reobserve' }, 'needs_reobserve'],
  [{ documentBindingStatus: 'needs_reobserve' }, 'needs_reobserve'],
  [{ hasAgentHandoff: true }, 'agent_handoff']
];
for (const [runtimeState, expectedCode] of structuralRecoveryCases) {
  const decision = decideStageIncompleteRecovery({
    ...stageRecoveryInput,
    runtimeState
  });
  assert.strictEqual(decision.disposition, 'defer_to_structural_owner');
  assert.strictEqual(decision.structuralBlockerCode, expectedCode);
  assert.strictEqual(decision.shouldRetry, false);
  assert.strictEqual(decision.shouldEscalate, false);
  assert.strictEqual(decision.countsAsRecoveryAttempt, false);
  assert.strictEqual(decision.modelDirective, '');
  assert.strictEqual(decision.escalationMessage, '');
}
const ordinaryStageRecovery = decideStageIncompleteRecovery(stageRecoveryInput);
assert.strictEqual(ordinaryStageRecovery.disposition, 'retry_model');
assert.strictEqual(ordinaryStageRecovery.shouldRetry, true);
assert.strictEqual(ordinaryStageRecovery.countsAsRecoveryAttempt, true);
const exhaustedStageRecovery = decideStageIncompleteRecovery({
  ...stageRecoveryInput,
  attempt: 3
});
assert.strictEqual(exhaustedStageRecovery.disposition, 'escalate');
assert.strictEqual(exhaustedStageRecovery.shouldEscalate, true);

const missingTaskType = resolveRuntimeDeclarationForAgentTask({
  executableToolNames
});
assert.strictEqual(missingTaskType.status, 'repair_required');
assert.strictEqual(missingTaskType.code, 'task_type_missing');

const unregisteredTaskType = resolveRuntimeDeclarationForAgentTask({
  taskType: 'ecommerce.not_registered.v1',
  executableToolNames
});
assert.strictEqual(unregisteredTaskType.status, 'repair_required');
assert.strictEqual(unregisteredTaskType.code, 'task_type_unregistered');

const unregisteredSkillId = resolveRuntimeDeclarationForAgentTask({
  taskType: 'ecommerce.sku_batch.v1',
  skillId: 'missing-skill',
  executableToolNames
});
assert.strictEqual(unregisteredSkillId.status, 'repair_required');
assert.strictEqual(unregisteredSkillId.code, 'skill_id_unregistered');

const conflictingArtifactIdentity = resolveRuntimeDeclarationForAgentTask({
  taskType: 'ecommerce.sku_batch.v1',
  skillId: 'ecommerce.main_image',
  executableToolNames
});
assert.strictEqual(conflictingArtifactIdentity.status, 'repair_required');
assert.strictEqual(conflictingArtifactIdentity.code, 'artifact_identity_conflict');

const skuModeMismatch = resolveRuntimeDeclarationForAgentTask({
  taskType: 'ecommerce.sku_batch.v1',
  workMode: 'create_new',
  executableToolNames
});
assert.strictEqual(skuModeMismatch.status, 'repair_required');
assert.strictEqual(skuModeMismatch.code, 'work_mode_not_applicable');
assert.deepStrictEqual(skuModeMismatch.supportedWorkModes, []);

const skuInventedMode = resolveRuntimeDeclarationForAgentTask({
  taskType: 'ecommerce.sku_batch.v1',
  workMode: 'invented_mode',
  executableToolNames
});
assert.strictEqual(skuInventedMode.status, 'repair_required');
assert.strictEqual(skuInventedMode.code, 'work_mode_not_applicable');

const mainModeMissing = resolveRuntimeDeclarationForAgentTask({
  taskType: 'ecommerce.main_image.v1',
  executableToolNames
});
assert.strictEqual(mainModeMissing.status, 'repair_required');
assert.strictEqual(mainModeMissing.code, 'work_mode_required');
assert.deepStrictEqual(mainModeMissing.supportedWorkModes, [
  'create_new',
  'redesign',
  'edit_existing'
]);

const mainModeUnsupported = resolveRuntimeDeclarationForAgentTask({
  taskType: 'ecommerce.main_image.v1',
  workMode: 'template_fill',
  executableToolNames
});
assert.strictEqual(mainModeUnsupported.status, 'repair_required');
assert.strictEqual(mainModeUnsupported.code, 'work_mode_unsupported');

const invalidMode = resolveRuntimeDeclarationForAgentTask({
  taskType: 'ecommerce.main_image.v1',
  workMode: 'invented_mode',
  executableToolNames
});
assert.strictEqual(invalidMode.status, 'repair_required');
assert.strictEqual(invalidMode.code, 'work_mode_invalid');

const unsafeAnalyze = resolveRuntimeDeclarationForAgentTask({
  taskType: 'ecommerce.detail_page.v1',
  workMode: 'analyze_only',
  executableToolNames
});
assert.strictEqual(unsafeAnalyze.status, 'configuration_error');
assert.strictEqual(unsafeAnalyze.code, 'runtime_profile_not_declarable');
assert(unsafeAnalyze.issues.some((issue) => issue.code === 'analyze_only_contract_not_read_only'));

const skuTemplate = resolveRuntimeDeclarationForAgentTask({
  taskType: 'ecommerce.sku_template.v1',
  executableToolNames
});
assert.strictEqual(skuTemplate.status, 'resolved');
assert.strictEqual(skuTemplate.bundle.evaluationProfile?.profileId, GENERAL_DESIGN_EVALUATION_PROFILE_ID);
assert.strictEqual(validateDesignEvaluationProfile(skuTemplate.bundle.evaluationProfile).valid, true);
assert(
  skuTemplate.bundle.manifest.knowledge_refs.includes(SKU_TEMPLATE_METHOD_KNOWLEDGE_ID),
  'SKU template must load its task-specific comparison and template-system design method'
);
assert.deepStrictEqual(
  skuTemplate.bundle.toolCapabilityBridge.workflowEntryTools,
  ['sku-batch'],
  'SKU template task must enter the unified SKU Skill without teaching the Agent core SKU stages'
);
assert.deepStrictEqual(skuTemplate.bundle.stagePlan.deliveryOutputs, [
  'editable_sku_template_document',
  'preview',
  'delivery_record'
]);
assert.deepStrictEqual(skuTemplate.bundle.stagePlan.deliveryOutputBindings, {
  editable_sku_template_document: {
    capability_refs: ['delivery.saveDocument'],
    proof_kind: 'saved_editable_document'
  }
});

const skuTemplateVlmAssertions = getDesignEvaluationProfileVlmAssertions(
  skuTemplate.bundle.evaluationProfile
);
assert(skuTemplateVlmAssertions.length > 0, 'SKU template R5 has no real visual evaluation assertions');
const skuTemplateR5 = evaluateDesignEvaluationProfile({
  profile: skuTemplate.bundle.evaluationProfile,
  assertionResults: skuTemplateVlmAssertions.map((assertion) => ({
    ...assertion,
    status: 'pass',
    score: 1,
    confidence: 1,
    rationale: 'audit:trusted-final-visual-review'
  })),
  verificationRecords: [
    {
      key: 'fresh_structure_snapshot',
      status: 'passed',
      source: 'runtime_observation',
      verificationRef: 'audit:fresh-structure-snapshot'
    },
    {
      key: 'fresh_visual_evaluation',
      status: 'passed',
      source: 'runtime_observation',
      verificationRef: 'audit:fresh-visual-evaluation'
    }
  ]
});
assert.strictEqual(skuTemplateR5.status, 'passed', JSON.stringify(skuTemplateR5, null, 2));
assert.strictEqual(skuTemplateR5.scorecard.gate, 'passed');

const referenceDeclarationBase = {
  version: 'runtime-reference-brief/v0',
  source: 'model_tool_call',
  workMode: 'create_new',
  requirement: 'reuse_or_optional',
  sources: [],
  boundaries: {
    modelAuthored: true,
    harnessValidatedOnly: true,
    skillPolicyIsSourceOfTruth: true,
    categoryNeutral: true,
    executesTools: false
  }
};
const readyReferenceEvaluationContext = buildRuntimeReferenceEvaluationContext({
  ...referenceDeclarationBase,
  decision: 'reuse_existing',
  readiness: 'ready',
  insights: [{
    aspect: 'composition',
    observation: '主商品与文字共享一条明确的负空间边界',
    application: '保留商品完整轮廓，并把标题放入右侧负空间',
    observationRefs: ['reference:1']
  }],
  limitations: []
});
assert(readyReferenceEvaluationContext.includes('参考洞察1·composition'));
assert(readyReferenceEvaluationContext.includes('主商品与文字共享一条明确的负空间边界'));
assert(readyReferenceEvaluationContext.includes('把标题放入右侧负空间'));
const degradedReferenceEvaluationContext = buildRuntimeReferenceEvaluationContext({
  ...referenceDeclarationBase,
  decision: 'search_new',
  readiness: 'degraded',
  insights: [{
    aspect: 'color',
    observation: '不应进入 degraded 投影',
    application: '不应进入 degraded 投影',
    observationRefs: ['reference:2']
  }],
  limitations: ['Eagle 视觉观察不可用']
});
assert(degradedReferenceEvaluationContext.includes('Eagle 视觉观察不可用'));
assert(!degradedReferenceEvaluationContext.includes('不应进入 degraded 投影'));
assert.strictEqual(buildRuntimeReferenceEvaluationContext({
  ...referenceDeclarationBase,
  decision: 'skip_not_needed',
  readiness: 'waived',
  insights: [],
  limitations: []
}), '');
const unsafeReferenceEvaluationContext = buildRuntimeReferenceEvaluationContext({
  ...referenceDeclarationBase,
  decision: 'reuse_existing',
  readiness: 'ready',
  insights: [{
    aspect: 'layout',
    observation: 'C:\\private\\reference.png',
    application: 'data:image/png;base64,unsafe',
    observationRefs: ['reference:3']
  }],
  limitations: []
});
assert(!unsafeReferenceEvaluationContext.includes('C:\\private'));
assert(!unsafeReferenceEvaluationContext.includes('data:image'));

const templateHistoryStateRef = { documentId: 71, historyStateId: 12 };
const templateTarget = resolveRuntimeExecutionTarget({
  result: { documentId: 71 }
});
assert(templateTarget, 'SKU template delivery target could not be constructed');
const savedTemplateResult = {
  success: true,
  format: 'psb',
  savedPath: 'C:/audit/SKU.psb',
  sourceHistoryStateRef: templateHistoryStateRef,
  editableDocumentArtifact: {
    version: 'runtime-editable-document-artifact/v1',
    basis: 'uxp_post_save_file_metadata',
    path: 'C:/audit/SKU.psb',
    format: 'psb',
    byteLength: 4096,
    modifiedAt: 1,
    documentId: 71,
    canvas: { width: 800, height: 800 }
  }
};
const templateProofKinds = readRuntimeDeliveryProofKinds(savedTemplateResult);
assert.deepStrictEqual(templateProofKinds, ['saved_editable_document']);
const templateDeliveryProjection = projectManifestBoundRuntimeDeliveryReceipt({
  requiredOutputs: skuTemplate.bundle.stagePlan.deliveryOutputs,
  outputBindings: skuTemplate.bundle.stagePlan.deliveryOutputBindings,
  proofs: [{
    resultRef: 'audit-save-template',
    capabilityRefs: ['delivery.saveDocument'],
    proofKinds: templateProofKinds,
    sourceHistoryStateRef: templateHistoryStateRef,
    target: templateTarget
  }],
  reviewedPreviewTarget: templateTarget,
  reviewedPreviewHistoryStateRef: templateHistoryStateRef
});
assert(templateDeliveryProjection, 'SKU template delivery projection was not created');
const templateDeliveryVerification = verifyRuntimeDelivery({
  requiredOutputs: skuTemplate.bundle.stagePlan.deliveryOutputs,
  receipt: templateDeliveryProjection.receipt,
  receiptTarget: templateDeliveryProjection.receiptTarget,
  reviewedPreviewTarget: templateTarget,
  reviewedPreviewHistoryStateRef: templateHistoryStateRef
});
assert.strictEqual(
  templateDeliveryVerification.status,
  'passed',
  JSON.stringify(templateDeliveryVerification, null, 2)
);

const methodAsArtifact = resolveRuntimeDeclarationForAgentTask({
  taskType: 'design.reference_replication.v1',
  executableToolNames
});
assert.strictEqual(methodAsArtifact.status, 'repair_required');
assert.strictEqual(methodAsArtifact.code, 'task_type_not_declarable');

const methodOverlay = resolveRuntimeDeclarationForAgentTask({
  taskType: 'ecommerce.detail_page.v1',
  workMode: 'create_new',
  skillId: 'design.reference_replication',
  executableToolNames
});
assert.strictEqual(methodOverlay.status, 'resolved');
assert.strictEqual(methodOverlay.bundle.methodManifests.length, 1);
assert.strictEqual(methodOverlay.bundle.methodManifests[0].skill_id, 'design.reference_replication');

const skuVariant = resolveRuntimeDeclarationForAgentTask({
  taskType: 'ecommerce.sku_color_card.v1',
  skillId: 'sku-batch',
  executableToolNames
});
assert.strictEqual(skuVariant.status, 'resolved');
assert.strictEqual(skuVariant.bundle.artifactManifest?.task_type, 'ecommerce.sku_color_card.v1');

function requireAgentTool(toolName) {
  const tool = getDefaultAgentTools().find((candidate) => candidate.name === toolName);
  assert(tool, `Agent Tool ${toolName} is missing`);
  return tool;
}

function createPlanNeutralIdentity(label) {
  return createRuntimeSessionIdentity({
    now: new Date().toISOString(),
    nonce: `runtime-declaration-audit-${label}`
  });
}

function buildAgentTestConfig(input) {
  return {
    systemPrompt: input.systemPrompt || 'Runtime declaration behavior audit.',
    tools: input.tools,
    modelId: 'runtime-declaration-audit-model',
    maxIterations: input.maxIterations,
    openingCanvasObservationMode: input.openingCanvasObservationMode || 'document_identity',
    ...(input.getDynamicOperatingContext
      ? { getDynamicOperatingContext: input.getDynamicOperatingContext }
      : {}),
    ...(input.runtimeSessionIdentity
      ? { runtimeSessionIdentity: input.runtimeSessionIdentity }
      : {}),
    ...(input.agentTaskPlan ? { agentTaskPlan: input.agentTaskPlan } : {}),
    ...(input.performanceBudget ? { performanceBudget: input.performanceBudget } : {}),
    toolDecisionContext: {
      intentControlPlane: input.intentControlPlane
        || buildAutonomousExecutionDecisionForEngine('runtime-declaration-audit'),
      photoshopConnected: true,
      hasDocument: true,
      currentDocumentUse: 'active_target'
    },
    callbacks: input.callbacks || {}
  };
}

function buildDocumentObservation() {
  return {
    success: true,
    documentState: 'present',
    document: {
      id: 71,
      name: 'SKU.psb',
      width: 800,
      height: 800,
      layerCount: 7
    },
    historyStateRef: {
      documentId: 71,
      historyStateId: 9
    }
  };
}

function buildRepairFailure(resolution) {
  assert.strictEqual(resolution.status, 'repair_required');
  return {
    success: false,
    code: 'runtime_design_intent_declaration_invalid',
    error: 'SKU default Profile 必须省略 workMode。',
    issues: [{ code: resolution.code, path: 'workMode' }],
    declarableTaskTypes: [...resolution.declarableTaskTypes],
    supportedWorkModes: [...resolution.supportedWorkModes],
    correctedShape: { workMode: 'omit' }
  };
}

function activateSkuRuntime(input) {
  const resolution = resolveRuntimeDeclarationForAgentTask({
    taskType: input.arguments.taskTypeId,
    workMode: input.arguments.workMode,
    executableToolNames
  });
  if (resolution.status !== 'resolved') return buildRepairFailure(resolution);
  const bundle = resolution.bundle;
  const boundIdentity = bindRuntimeSessionIdentity({
    identity: input.identity,
    skillId: bundle.stagePlan.skillId,
    taskType: bundle.stagePlan.taskType
  });
  input.agent.activateRuntimeContractFromDeclaration({
    runtimeSessionIdentity: boundIdentity,
    runtimeLoopContract: bundle.runtimeLoopContract,
    runtimeStagePlan: bundle.stagePlan,
    runtimeStageContextItems: [],
    runtimeDesignBriefAvailableInputSources: [{ sourceKind: 'user_goal' }],
    taskPlanPresentationScope: {
      conversationId: 'runtime-declaration-audit',
      projectId: 'runtime-declaration-audit'
    },
    toolCapabilityBridge: bundle.toolCapabilityBridge,
    evaluationProfile: bundle.evaluationProfile,
    getCapabilityResolution: () => undefined,
    getActiveCapabilityIdsForTool: () => [],
    getOnDemandActivatedCapabilityIds: () => [],
    finalizeRuntimeArtifacts: async () => undefined,
    performanceBudget: {
      maxModelCalls: 16,
      maxToolCalls: 50,
      maxVisionCandidates: 6,
      maxInitialVisionCandidates: 0,
      maxVisualAnalyses: 2,
      maxFullResolutionImageReads: 0,
      softTimeBudgetMs: 420_000
    },
    maxIterations: input.maxIterations
  });
  input.tools.splice(
    0,
    input.tools.length,
    ...(input.nextTools || [requireAgentTool('getDocumentInfo')])
  );
  return { success: true };
}

function activateMainImageAgenticRuntime(input) {
  const resolution = resolveRuntimeDeclarationForAgentTask({
    taskType: input.arguments.taskTypeId,
    workMode: input.arguments.workMode,
    executableToolNames
  });
  assert.strictEqual(resolution.status, 'resolved');
  const effectiveContract = resolveRuntimeStagePlanEffectiveContract(
    resolution.bundle.stagePlan,
    input.arguments.workMode
  );
  assert(effectiveContract, 'main-image agentic effective contract is missing');
  const methodKnowledge = buildDesignMethodKnowledgeRuntimeContext({
    knowledgeRefs: resolution.bundle.manifest.knowledge_refs || [],
    manifestSkillId: resolution.bundle.manifest.skill_id
  });
  assert.deepStrictEqual(methodKnowledge.issues, []);
  input.agent.activateAgenticRuntimeContractFromDeclaration({
    artifactContract: {
      version: 'agentic-artifact-completion-contract/v0',
      skillId: resolution.bundle.manifest.skill_id,
      taskType: resolution.bundle.manifest.task_type,
      workMode: effectiveContract.workMode,
      productionObligation: effectiveContract.productionObligation,
      deliveryOutputs: [...effectiveContract.deliveryOutputs],
      exitCriteria: [...effectiveContract.exitCriteria],
      reviewRubricRef: effectiveContract.reviewRubricRef
    },
    referencePolicy: resolution.bundle.stagePlan.referencePolicy,
    runtimeStageContextItems: methodKnowledge.items.map((item) => {
      const { applicableStages: _applicableStages, ...stageAgnosticItem } = item;
      return stageAgnosticItem;
    }),
    evaluationProfile: resolution.bundle.evaluationProfile,
    performanceBudget: {
      maxModelCalls: 36,
      maxToolCalls: 120,
      maxVisionCandidates: 16,
      maxInitialVisionCandidates: 8,
      maxVisualAnalyses: 6,
      maxFullResolutionImageReads: 0,
      softTimeBudgetMs: 900_000
    },
    reasoningEffort: 'high',
    maxIterations: input.maxIterations || 60
  });
  return { success: true };
}

async function assertSuccessfulDeclarationPreservesAutonomyAndCarriesR2() {
  const identity = createPlanNeutralIdentity('successful-bind');
  const tools = [
    requireAgentTool('declareDesignIntent'),
    requireAgentTool('getDocumentInfo')
  ];
  const modelToolSurfaces = [];
  const executedToolNames = [];
  let modelCallCount = 0;
  let agent;
  agent = new Agent(
    buildAgentTestConfig({
      tools,
      maxIterations: 2,
      runtimeSessionIdentity: identity
    }),
    async (_modelId, _messages, visibleTools) => {
      modelCallCount += 1;
      modelToolSurfaces.push(visibleTools.map((tool) => tool.name));
      if (modelCallCount === 1) {
        assert.deepStrictEqual(
          executedToolNames,
          ['getDocumentInfo'],
          'plan-neutral Agent must receive the generic opening fact before choosing a Runtime'
        );
        assert(visibleTools.some((tool) => tool.name === 'declareDesignIntent'));
        assert(visibleTools.some((tool) => tool.name === 'getDocumentInfo'));
        return {
          toolCalls: [{
            id: 'declare-sku-default',
            name: 'declareDesignIntent',
            arguments: { taskTypeId: 'ecommerce.sku_batch.v1' }
          }]
        };
      }
      assert.deepStrictEqual(
        executedToolNames,
        ['getDocumentInfo', 'declareDesignIntent'],
        'late binding repeated the opening document read before the next model decision'
      );
      return { content: 'Runtime 已绑定，继续执行。', stopReason: 'end_turn' };
    },
    async (toolName, arguments_) => {
      executedToolNames.push(toolName);
      if (toolName === 'declareDesignIntent') {
        return activateSkuRuntime({
          agent,
          identity,
          tools,
          arguments: arguments_,
          maxIterations: 2
        });
      }
      return buildDocumentObservation();
    }
  );
  const result = await agent.run('请完成 SKU 生产');
  assert(modelToolSurfaces[0].includes('declareDesignIntent'));
  assert(modelToolSurfaces[0].includes('getDocumentInfo'));
  assert(!modelToolSurfaces[1].includes('declareDesignIntent'), 'declaration Tool remained visible after binding');
  assert(modelToolSurfaces[1].includes('getDocumentInfo'), 'R2 observation Tool was not exposed after binding');
  assert.deepStrictEqual(executedToolNames.slice(0, 2), [
    'getDocumentInfo',
    'declareDesignIntent',
  ]);
  assert.strictEqual(result.executionSummary?.runtimeStageState?.currentStage, 'E1');
}

async function assertRuntimeDeclarationSiblingPolicyFailsClosed() {
  const declaration = {
    id: 'policy-declaration',
    name: 'declareDesignIntent',
    arguments: { taskTypeId: 'ecommerce.main_image.v1', workMode: 'create_new' }
  };
  const read = { id: 'policy-read', name: 'searchEagleReferences', arguments: { query: '主图' } };
  const readyDecision = buildAutonomousExecutionDecisionForEngine('runtime-sibling-policy-ready');
  let visibleSurfaceReads = 0;
  const turn = createRuntimeDeclarationSiblingTurn([read, declaration], {
    readVisibleToolsAfterBinding: async () => {
      visibleSurfaceReads += 1;
      return [read];
    },
    isCapabilityControlTool: () => false,
    decisionContext: {
      userInput: '读取主图参考',
      intentControlPlane: readyDecision,
      completedToolCalls: [],
      runtime: { photoshopConnected: true, hasDocument: true }
    }
  });
  assert.deepStrictEqual(turn.orderedCalls.map((call) => call.id), [declaration.id, read.id]);
  await turn.recordResult(declaration, {});
  assert.strictEqual(turn.shouldDefer(read), true, 'missing explicit declaration success leaked a sibling read');
  assert.strictEqual(visibleSurfaceReads, 0, 'failed declaration should not build a post-binding Tool surface');
  await turn.recordResult(declaration, { success: true });
  assert.strictEqual(visibleSurfaceReads, 1);
  assert.strictEqual(turn.shouldDefer(read), false, 'valid compatible read was not carried after explicit success');

  const hiddenTurn = createRuntimeDeclarationSiblingTurn([declaration, read], {
    readVisibleToolsAfterBinding: async () => [],
    isCapabilityControlTool: () => false,
    decisionContext: {
      userInput: '读取主图参考', intentControlPlane: readyDecision, completedToolCalls: [],
      runtime: { photoshopConnected: true, hasDocument: true }
    }
  });
  await hiddenTurn.recordResult(declaration, { success: true });
  assert.strictEqual(hiddenTurn.shouldDefer(read), true, 'post-binding hidden Tool leaked through carry-over');

  const unreadableSurfaceTurn = createRuntimeDeclarationSiblingTurn([declaration, read], {
    readVisibleToolsAfterBinding: async () => { throw new Error('surface unavailable'); },
    isCapabilityControlTool: () => false,
    decisionContext: {
      userInput: '读取主图参考', intentControlPlane: readyDecision, completedToolCalls: [],
      runtime: { photoshopConnected: true, hasDocument: true }
    }
  });
  await unreadableSurfaceTurn.recordResult(declaration, { success: true });
  assert.strictEqual(unreadableSurfaceTurn.shouldDefer(read), true, 'unreadable post-binding surface failed open');

  const planOnlyIntent = {
    ...readyDecision,
    requestKind: 'plan_only',
    toolScope: 'none',
    executionAuthorization: 'none'
  };
  const decisionBlockedTurn = createRuntimeDeclarationSiblingTurn([declaration, read], {
    readVisibleToolsAfterBinding: async () => [read],
    isCapabilityControlTool: () => false,
    decisionContext: {
      userInput: '只做方案，不调用工具', intentControlPlane: planOnlyIntent, completedToolCalls: [],
      runtime: { photoshopConnected: true, hasDocument: true }
    }
  });
  await decisionBlockedTurn.recordResult(declaration, { success: true });
  assert.strictEqual(decisionBlockedTurn.shouldDefer(read), true, 'Tool Decision blocker was bypassed after declaration');

  const secondDeclaration = {
    id: 'policy-declaration-2',
    name: 'declareDesignIntent',
    arguments: { taskTypeId: 'ecommerce.sku_batch.v1' }
  };
  const ambiguousTurn = createRuntimeDeclarationSiblingTurn([declaration, secondDeclaration, read], {
    readVisibleToolsAfterBinding: async () => [read],
    isCapabilityControlTool: () => false,
    decisionContext: {
      userInput: '设计商品图', intentControlPlane: readyDecision, completedToolCalls: [],
      runtime: { photoshopConnected: true, hasDocument: true }
    }
  });
  assert.strictEqual(ambiguousTurn.ambiguousDeclaration, true);
  assert.strictEqual(ambiguousTurn.declarationCall, undefined);
  assert(ambiguousTurn.orderedCalls.every((call) => ambiguousTurn.shouldDefer(call)));

  const duplicateIdTurn = createRuntimeDeclarationSiblingTurn([
    declaration,
    { ...read, id: declaration.id }
  ], {
    readVisibleToolsAfterBinding: async () => [read],
    isCapabilityControlTool: () => false,
    decisionContext: {
      userInput: '读取主图参考', intentControlPlane: readyDecision, completedToolCalls: [],
      runtime: { photoshopConnected: true, hasDocument: true }
    }
  });
  assert.strictEqual(duplicateIdTurn.invalidCallIdentity, true);
  assert.strictEqual(duplicateIdTurn.orderedCalls.length, 2, 'duplicate Call ID silently dropped a sibling');
  assert(duplicateIdTurn.orderedCalls.every((call) => duplicateIdTurn.shouldDefer(call)));
}

async function assertDeclarationCarriesCompatibleReadsWithoutHijackingSiblingCalls() {
  const identity = createPlanNeutralIdentity('same-turn-compatible-reads');
  const declarationTool = requireAgentTool('declareDesignIntent');
  const recommendTool = requireAgentTool('recommendAssets');
  const eagleTool = requireAgentTool('searchEagleReferences');
  const writeTool = requireAgentTool('createRectangle');
  const tools = [declarationTool, recommendTool, eagleTool, writeTool];
  const executedToolNames = [];
  let modelCallCount = 0;
  let agent;
  agent = new Agent(
    buildAgentTestConfig({
      tools,
      maxIterations: 2,
      runtimeSessionIdentity: identity,
      openingCanvasObservationMode: 'none'
    }),
    async () => {
      modelCallCount += 1;
      if (modelCallCount === 1) {
        // 复刻 r18 Provider 顺序：两个读取在声明之前，另带一个不可顺带放行的写调用。
        return {
          toolCalls: [
            { id: 'same-turn-recommend', name: 'recommendAssets', arguments: { limit: 6 } },
            { id: 'same-turn-eagle', name: 'searchEagleReferences', arguments: { query: '袜子 主图' } },
            {
              id: 'same-turn-write',
              name: 'createRectangle',
              arguments: { x: 0, y: 0, width: 100, height: 100, fillColorHex: '#FFFFFF' }
            },
            {
              id: 'same-turn-declare',
              name: 'declareDesignIntent',
              arguments: { taskTypeId: 'ecommerce.main_image.v1', workMode: 'create_new' }
            }
          ]
        };
      }
      return { content: '已读取当前素材与参考事实。', stopReason: 'end_turn' };
    },
    async (toolName, arguments_) => {
      executedToolNames.push(toolName);
      if (toolName === 'declareDesignIntent') {
        return activateMainImageAgenticRuntime({
          agent,
          arguments: arguments_,
          maxIterations: 2
        });
      }
      if (toolName === 'recommendAssets') {
        return { success: true, candidates: [{ path: 'E:/project/product.jpg' }] };
      }
      if (toolName === 'searchEagleReferences') {
        return { success: true, items: [{ id: 'eagle-reference-1' }] };
      }
      throw new Error(`声明同轮不应执行写工具：${toolName}`);
    }
  );

  await agent.run('整理主图设计所需的素材与参考事实');
  assert.strictEqual(modelCallCount, 2, 'compatible reads still forced an extra model turn');
  assert.deepStrictEqual(
    executedToolNames.slice(0, 3),
    ['declareDesignIntent', 'recommendAssets', 'searchEagleReferences'],
    'Harness did not preserve the model-authored compatible reads or leaked the sibling write'
  );
  assert(!executedToolNames.includes('createRectangle'), 'runtime declaration leaked a sibling Photoshop write');
  const recommendEntry = agent.toolCallLog.find((entry) => entry.callId === 'same-turn-recommend');
  const eagleEntry = agent.toolCallLog.find((entry) => entry.callId === 'same-turn-eagle');
  const writeEntry = agent.toolCallLog.find((entry) => entry.callId === 'same-turn-write');
  assert.strictEqual(recommendEntry?.result?.success, true);
  assert.strictEqual(eagleEntry?.result?.success, true);
  assert.notStrictEqual(recommendEntry?.failureDisposition, 'control_turn_deferred');
  assert.notStrictEqual(eagleEntry?.failureDisposition, 'control_turn_deferred');
  assert.strictEqual(writeEntry?.result?.code, 'tool_deferred_after_runtime_declaration');
  assert.strictEqual(writeEntry?.failureDisposition, 'control_turn_deferred');
  const historyAssistant = agent.messages.find((message) => (
    message.role === 'assistant'
    && message.toolCalls?.some((call) => call.id === 'same-turn-declare')
  ));
  const historyToolResult = agent.messages.find((message) => (
    message.role === 'tool_result'
    && message.toolResults?.some((result) => result.callId === 'same-turn-declare')
  ));
  const expectedCallIds = [
    'same-turn-declare',
    'same-turn-recommend',
    'same-turn-eagle',
    'same-turn-write'
  ];
  assert.deepStrictEqual(historyAssistant?.toolCalls?.map((call) => call.id), expectedCallIds);
  assert.deepStrictEqual(historyToolResult?.toolResults?.map((result) => result.callId), expectedCallIds);
  assert.strictEqual(new Set(historyToolResult?.toolResults?.map((result) => result.callId)).size, 4);
}

async function assertAgentRuntimeDeclarationFailureAndAmbiguityStayFailClosed() {
  const declarationTool = requireAgentTool('declareDesignIntent');
  const readTool = requireAgentTool('searchEagleReferences');
  for (const declarationOutput of [{ success: false }, {}]) {
    let modelCalls = 0;
    const executed = [];
    const agent = new Agent(
      buildAgentTestConfig({
        tools: [declarationTool, readTool],
        maxIterations: 2,
        openingCanvasObservationMode: 'none'
      }),
      async () => {
        modelCalls += 1;
        if (modelCalls === 1) {
          return {
            toolCalls: [
              { id: 'failed-declaration-read', name: 'searchEagleReferences', arguments: { query: '主图' } },
              {
                id: 'failed-declaration',
                name: 'declareDesignIntent',
                arguments: { taskTypeId: 'ecommerce.main_image.v1', workMode: 'create_new' }
              }
            ]
          };
        }
        return { content: '声明没有成功，未执行同轮读取。', stopReason: 'end_turn' };
      },
      async (toolName) => {
        executed.push(toolName);
        assert.strictEqual(toolName, 'declareDesignIntent');
        return declarationOutput;
      }
    );
    await agent.run('准备主图设计');
    assert.deepStrictEqual(executed, ['declareDesignIntent']);
    assert.strictEqual(
      agent.toolCallLog.find((entry) => entry.callId === 'failed-declaration-read')?.failureDisposition,
      'control_turn_deferred'
    );
  }

  let ambiguousExecutorCalls = 0;
  let ambiguousModelCalls = 0;
  const ambiguousAgent = new Agent(
    buildAgentTestConfig({
      tools: [declarationTool, readTool],
      maxIterations: 2,
      openingCanvasObservationMode: 'none'
    }),
    async () => {
      ambiguousModelCalls += 1;
      if (ambiguousModelCalls === 1) {
        return {
          toolCalls: [
            {
              id: 'ambiguous-main',
              name: 'declareDesignIntent',
              arguments: { taskTypeId: 'ecommerce.main_image.v1', workMode: 'create_new' }
            },
            {
              id: 'ambiguous-sku',
              name: 'declareDesignIntent',
              arguments: { taskTypeId: 'ecommerce.sku_batch.v1' }
            },
            { id: 'ambiguous-read', name: 'searchEagleReferences', arguments: { query: '商品图' } }
          ]
        };
      }
      return { content: '检测到互相冲突的任务声明，本轮没有绑定任一 Runtime。', stopReason: 'end_turn' };
    },
    async () => {
      ambiguousExecutorCalls += 1;
      return { success: true };
    }
  );
  await ambiguousAgent.run('设计商品图');
  assert.strictEqual(ambiguousExecutorCalls, 0, 'ambiguous declarations arbitrarily committed the first profile');
  assert(
    ambiguousAgent.toolCallLog
      .filter((entry) => ['ambiguous-main', 'ambiguous-sku', 'ambiguous-read'].includes(entry.callId))
      .every((entry) => entry.failureDisposition === 'control_turn_deferred')
  );
}

async function assertStagedDeclarationUsesTruePostBindingToolSurface() {
  const identity = createPlanNeutralIdentity('staged-hidden-sibling');
  const declarationTool = requireAgentTool('declareDesignIntent');
  const recommendTool = requireAgentTool('recommendAssets');
  const tools = [declarationTool, recommendTool];
  const executed = [];
  let modelCalls = 0;
  let agent;
  agent = new Agent(
    buildAgentTestConfig({
      tools,
      maxIterations: 2,
      runtimeSessionIdentity: identity,
      openingCanvasObservationMode: 'none'
    }),
    async () => {
      modelCalls += 1;
      if (modelCalls === 1) {
        return {
          toolCalls: [
            { id: 'staged-hidden-recommend', name: 'recommendAssets', arguments: { limit: 4 } },
            {
              id: 'staged-hidden-declaration',
              name: 'declareDesignIntent',
              arguments: { taskTypeId: 'ecommerce.sku_batch.v1' }
            }
          ]
        };
      }
      return { content: '已按绑定后的 SKU 阶段继续。', stopReason: 'end_turn' };
    },
    async (toolName, arguments_) => {
      executed.push(toolName);
      assert.strictEqual(toolName, 'declareDesignIntent');
      return activateSkuRuntime({
        agent,
        identity,
        tools,
        arguments: arguments_,
        maxIterations: 2,
        nextTools: [recommendTool]
      });
    }
  );
  await agent.run('完成 SKU 生产');
  assert.deepStrictEqual(executed, ['declareDesignIntent']);
  assert.strictEqual(
    agent.toolCallLog.find((entry) => entry.callId === 'staged-hidden-recommend')?.failureDisposition,
    'control_turn_deferred'
  );
}

async function assertAgenticDeclarationActivatesArtifactContractWithoutStageRuntime() {
  const resolution = resolveRuntimeDeclarationForAgentTask({
    taskType: 'ecommerce.main_image.v1',
    workMode: 'create_new',
    executableToolNames
  });
  assert.strictEqual(resolution.status, 'resolved');
  assert(
    resolution.bundle.manifest.required_model_profiles.includes('reasoning.quality'),
    'quality-first main-image Manifest must request the same model at a quality reasoning profile'
  );
  assert.deepStrictEqual(
    resolution.bundle.evaluationProfile.finalReview?.requiredViews,
    ['native_surface', 'list_thumbnail'],
    'main-image Final Judge must receive both native and real list-thumbnail views'
  );
  const effectiveContract = resolveRuntimeStagePlanEffectiveContract(
    resolution.bundle.stagePlan,
    'create_new'
  );
  assert(effectiveContract, 'main-image agentic effective contract is missing');
  const artifactContract = {
    version: 'agentic-artifact-completion-contract/v0',
    skillId: resolution.bundle.manifest.skill_id,
    taskType: resolution.bundle.manifest.task_type,
    workMode: effectiveContract.workMode,
    productionObligation: effectiveContract.productionObligation,
    deliveryOutputs: [...effectiveContract.deliveryOutputs],
    exitCriteria: [...effectiveContract.exitCriteria],
    reviewRubricRef: effectiveContract.reviewRubricRef
  };
  const methodKnowledge = buildDesignMethodKnowledgeRuntimeContext({
    knowledgeRefs: resolution.bundle.manifest.knowledge_refs || [],
    manifestSkillId: resolution.bundle.manifest.skill_id
  });
  assert.deepStrictEqual(methodKnowledge.issues, []);
  const agenticRuntimeContextItems = methodKnowledge.items.map((item) => {
    const { applicableStages: _applicableStages, ...stageAgnosticItem } = item;
    return stageAgnosticItem;
  });
  assert(agenticRuntimeContextItems.length > 0, 'main-image agentic method context is empty');
  assert(agenticRuntimeContextItems.every((item) => item.applicableStages === undefined));
  const taskProfilePrompt = buildDesignTaskTypePromptSection(mainImageTaskProfile, {
    hasPhotoshopDocument: true,
    hasProjectAssets: true,
    hasEagle: true
  });
  const tools = [
    requireAgentTool('declareDesignIntent'),
    requireAgentTool('getDocumentInfo'),
    requireAgentTool('analyzeEagleReference'),
    requireAgentTool('createRectangle')
  ];
  const agent = new Agent(
    buildAgentTestConfig({
      tools,
      maxIterations: 4,
      openingCanvasObservationMode: 'none',
      getDynamicOperatingContext: () => taskProfilePrompt
    }),
    async () => ({ content: 'unused' }),
    async () => ({ success: true })
  );
  const beforeTools = await agent.buildModelVisibleToolsForIteration();
  assert(beforeTools.some((tool) => tool.name === 'declareDesignIntent'));
  agent.activateAgenticRuntimeContractFromDeclaration({
    artifactContract,
    referencePolicy: resolution.bundle.stagePlan.referencePolicy,
    runtimeStageContextItems: agenticRuntimeContextItems,
    evaluationProfile: resolution.bundle.evaluationProfile,
    performanceBudget: {
      maxModelCalls: 36,
      maxToolCalls: 120,
      maxVisionCandidates: 16,
      maxInitialVisionCandidates: 8,
      maxVisualAnalyses: 6,
      maxFullResolutionImageReads: 0,
      softTimeBudgetMs: 900_000
    },
    reasoningEffort: 'high',
    maxIterations: 60
  });
  const afterTools = await agent.buildModelVisibleToolsForIteration();
  assert.strictEqual(agent.runtimeSession, undefined, 'agentic declaration created a Runtime Session');
  assert.strictEqual(agent.config.runtimeStagePlan, undefined, 'agentic declaration activated Stage gating');
  assert.strictEqual(agent.config.agenticArtifactContract?.skillId, 'ecommerce.main_image');
  assert.strictEqual(
    agent.config.evaluationProfile?.profileId,
    resolution.bundle.evaluationProfile.profileId
  );
  assert.strictEqual(agent.config.maxIterations, 60);
  assert.strictEqual(agent.config.reasoningEffort, 'high');
  const postBindingSystemPrompt = agent.buildSystemPromptWithRuntimeContract();
  assert(
    postBindingSystemPrompt.includes(mainImageRoleGuidance),
    'agentic binding lost the Task Profile role guidance from the live operating context'
  );
  assert(
    postBindingSystemPrompt.includes('先区分点击图与转化图'),
    'agentic binding did not inject the Manifest-owned main-image method knowledge'
  );
  assert(
    !postBindingSystemPrompt.includes('当前设计进度：'),
    'agentic binding exposed a staged Runtime progress prompt'
  );
  assert(!afterTools.some((tool) => tool.name === 'declareDesignIntent'));
  assert(afterTools.some((tool) => tool.name === 'getDocumentInfo'));
  assert(afterTools.some((tool) => tool.name === 'createRectangle'));
  assert(!afterTools.some((tool) => tool.name === 'declareReferenceBrief'), 'agentic reference declaration became a mandatory opening ritual');
  agent.toolCallLog = [{
    callId: 'agentic-reference-observation',
    modelTurn: 1,
    name: 'analyzeEagleReference',
    arguments: { itemId: 'agent-selected-reference' },
    result: {
      success: true,
      item: { id: 'agent-selected-reference' },
      observation: {
        summary: '参考通过更明确的主体关系建立第一眼焦点。',
        strengths: [{ aspect: 'composition', observation: '主体关系在缩略图中仍然清楚。' }]
      }
    },
    origin: 'model_tool_call'
  }];
  const afterObservationTools = await agent.buildModelVisibleToolsForIteration();
  const referenceDeclarationTool = afterObservationTools.find((tool) => (
    tool.name === 'declareReferenceBrief'
  ));
  assert(referenceDeclarationTool, 'agentic task cannot bind a reference it already chose and observed');
  assert.strictEqual(agent.runtimeSession, undefined, 'optional agentic reference binding created a Runtime Session');
  const referenceDeclaration = agent.executeReferenceBriefDeclaration({
    decision: 'reuse_existing',
    readiness: 'ready',
    sources: [{
      kind: 'eagle',
      sourceRefs: ['context:reference_visual:agent-selected-reference']
    }],
    insights: [{
      aspect: 'composition',
      application: '只迁移主体关系和焦点层级，不复制参考表面内容。',
      observationRefs: ['context:reference_visual:agent-selected-reference']
    }],
    limitations: []
  });
  assert.strictEqual(referenceDeclaration.success, true);
  assert.strictEqual(referenceDeclaration.executesPhotoshop, false);
  assert.strictEqual(referenceDeclaration.grantsPermission, false);
  const afterReferenceDeclarationTools = await agent.buildModelVisibleToolsForIteration();
  assert(
    !afterReferenceDeclarationTools.some((tool) => tool.name === 'declareReferenceBrief'),
    'resolved agentic reference declaration remained visible and encouraged repeated control calls'
  );
}

async function assertSkuModeGetsOneStructuredRepair() {
  const identity = createPlanNeutralIdentity('mode-repair');
  const tools = [requireAgentTool('declareDesignIntent')];
  let modelCallCount = 0;
  let declarationCallCount = 0;
  let observedSchemaRepairCount = 0;
  let observedRepairLimitCount = 0;
  const agent = new Agent(
    buildAgentTestConfig({
      tools,
      maxIterations: 3,
      runtimeSessionIdentity: identity,
      openingCanvasObservationMode: 'none'
    }),
    async (_modelId, messages) => {
      modelCallCount += 1;
      observedSchemaRepairCount = Math.max(
        observedSchemaRepairCount,
        messages.filter((message) => (
          message.contextMetadata?.source === 'harness-control-schema-repair'
          && message.contextMetadata?.scope === 'harness-control-repair:declareDesignIntent'
        )).length
      );
      observedRepairLimitCount = Math.max(
        observedRepairLimitCount,
        messages.filter((message) => (
          message.contextMetadata?.source === 'harness-control-repair-limit'
          && message.contextMetadata?.scope === 'harness-control-repair:declareDesignIntent'
        )).length
      );
      if (modelCallCount > 2) {
        return { content: 'Runtime declaration repair audit complete.' };
      }
      return {
        toolCalls: [{
          id: `declare-sku-${modelCallCount}`,
          name: 'declareDesignIntent',
          arguments: {
            taskTypeId: 'ecommerce.sku_batch.v1',
            workMode: 'create_new'
          }
        }]
      };
    },
    async (toolName, arguments_) => {
      assert.strictEqual(toolName, 'declareDesignIntent');
      declarationCallCount += 1;
      const resolution = resolveRuntimeDeclarationForAgentTask({
        taskType: arguments_.taskTypeId,
        workMode: arguments_.workMode,
        executableToolNames
      });
      return buildRepairFailure(resolution);
    }
  );
  await agent.run('请完成 SKU 生产');
  assert.strictEqual(declarationCallCount, 2, 'SKU default mode mismatch must allow only one corrected declaration');
  assert.strictEqual(observedSchemaRepairCount, 1, 'SKU mode mismatch must receive exactly one structured repair');
  assert.strictEqual(observedRepairLimitCount, 1, 'second invalid SKU mode must stop structured repair');
}

async function assertPureFirstToolResponseDoesNotCallAuxiliaryModel() {
  const tools = [requireAgentTool('getDocumentInfo')];
  const steps = [];
  let modelCallCount = 0;
  let auxiliaryModelCallCount = 0;
  let toolCallCount = 0;
  const agent = new Agent(
    buildAgentTestConfig({
      tools,
      maxIterations: 2,
      openingCanvasObservationMode: 'none',
      callbacks: {
        onThinking() {},
        onStep(step) {
          steps.push(step);
        }
      }
    }),
    async (_modelId, _messages, visibleTools) => {
      modelCallCount += 1;
      if (modelCallCount === 1) {
        return {
          toolCalls: [{
            id: 'read-document-first-turn',
            name: 'getDocumentInfo',
            arguments: {}
          }]
        };
      }
      if ((visibleTools || []).length === 0 && toolCallCount === 0) {
        auxiliaryModelCallCount += 1;
        return { content: '不应发生的额外过程说明调用。' };
      }
      return { content: '已读取当前文档状态。', stopReason: 'end_turn' };
    },
    async (toolName) => {
      assert.strictEqual(toolName, 'getDocumentInfo');
      toolCallCount += 1;
      return buildDocumentObservation();
    }
  );

  await agent.run('读取当前文档状态并汇报');
  assert.strictEqual(auxiliaryModelCallCount, 0, 'pure first ToolCall triggered an auxiliary prose model request');
  assert.strictEqual(modelCallCount, 2, 'pure first ToolCall should need only action selection plus final response');
  assert.strictEqual(toolCallCount, 1);
  const disclosureStep = steps.find((step) => step.issue === 'harness_pre_action_disclosure');
  assert(disclosureStep, 'pure first ToolCall did not emit deterministic progress disclosure');
  assert(
    String(disclosureStep.detail || '').includes('读取当前文档状态并汇报'),
    'deterministic progress disclosure omitted the user goal'
  );
  assert(
    String(disclosureStep.detail || '').includes('读取文档'),
    'deterministic progress disclosure omitted Tool display information'
  );
}

function buildRecommendedFastPathFixture(recommendedSkillName) {
  const workflowBridgeTools = buildSkillToolSchemas();
  const recommendedSkill = workflowBridgeTools.find((tool) => tool.name === recommendedSkillName);
  assert(recommendedSkill, `recommended fast-path fixture Skill is missing: ${recommendedSkillName}`);
  const candidateTools = [
    ...getDefaultAgentTools(),
    ...workflowBridgeTools
  ];
  const capabilitySession = createAgentCapabilitySession({
    candidateTools,
    workflowBridgeNames: workflowBridgeTools.map((tool) => tool.name),
    baselineCapabilityIds: buildRecommendedSkillFastPathBaseline(
      `skill.${recommendedSkillName}`
    )
  });
  return {
    capabilitySession,
    recommendedSkill,
    workflowBridgeTools
  };
}

async function assertCorrectRecommendationCanCallSkillOnFirstTurn() {
  const recommendedSkillName = 'design-reference-search';
  const fixture = buildRecommendedFastPathFixture(recommendedSkillName);
  const workflowBridgeNames = new Set(fixture.workflowBridgeTools.map((tool) => tool.name));
  const executedToolNames = [];
  const modelToolSurfaces = [];
  let modelCallCount = 0;
  const agent = new Agent(
    buildAgentTestConfig({
      tools: fixture.capabilitySession.activeTools,
      maxIterations: 3,
      openingCanvasObservationMode: 'none'
    }),
    async (_modelId, _messages, visibleTools) => {
      modelCallCount += 1;
      modelToolSurfaces.push(visibleTools.map((tool) => tool.name));
      if (modelCallCount === 1) {
        return {
          toolCalls: [{
            id: 'recommended-skill-first-turn',
            name: recommendedSkillName,
            arguments: { query: 'minimal product poster reference' }
          }]
        };
      }
      return { content: '已使用匹配能力完成参考检索。', stopReason: 'end_turn' };
    },
    async (toolName) => {
      executedToolNames.push(toolName);
      return { success: true, items: [{ title: 'fixture reference' }] };
    }
  );

  await agent.run('查找适合当前设计目标的参考');
  assert(modelToolSurfaces[0].length < 12, 'recommended first-turn Tool surface exceeded the fast-path budget');
  assert.deepStrictEqual(
    modelToolSurfaces[0].filter((toolName) => workflowBridgeNames.has(toolName)),
    [recommendedSkillName],
    'correct recommendation did not expose exactly one Skill on the first turn'
  );
  assert.strictEqual(
    executedToolNames[0],
    recommendedSkillName,
    'correct recommendation did not call the Skill directly on the first turn'
  );
  assert(!executedToolNames.includes(REQUEST_AGENT_CAPABILITIES_TOOL_NAME));
}

async function assertWrongRecommendationRecoversWithOneCapabilityRequest() {
  const recommendedSkillName = 'visual-analysis';
  const replacementSkillName = 'design-reference-search';
  const fixture = buildRecommendedFastPathFixture(recommendedSkillName);
  const modelToolSurfaces = [];
  const executedToolNames = [];
  let modelCallCount = 0;
  let capabilityRequestCount = 0;
  const agent = new Agent(
    buildAgentTestConfig({
      tools: fixture.capabilitySession.activeTools,
      maxIterations: 4,
      openingCanvasObservationMode: 'none'
    }),
    async (_modelId, _messages, visibleTools) => {
      modelCallCount += 1;
      modelToolSurfaces.push(visibleTools.map((tool) => tool.name));
      if (modelCallCount === 1) {
        return {
          toolCalls: [{
            id: 'request-replacement-skill',
            name: REQUEST_AGENT_CAPABILITIES_TOOL_NAME,
            arguments: { capabilityIds: [`skill.${replacementSkillName}`] }
          }]
        };
      }
      if (modelCallCount === 2) {
        return {
          toolCalls: [{
            id: 'use-replacement-skill',
            name: replacementSkillName,
            arguments: { query: 'minimal product poster reference' }
          }]
        };
      }
      return { content: '已按需切换到更匹配的能力。', stopReason: 'end_turn' };
    },
    async (toolName, arguments_) => {
      executedToolNames.push(toolName);
      if (toolName === REQUEST_AGENT_CAPABILITIES_TOOL_NAME) {
        capabilityRequestCount += 1;
        const activation = fixture.capabilitySession.requestCapabilities(
          arguments_.capabilityIds || []
        );
        return {
          success: activation.status !== 'rejected',
          data: {
            ...activation,
            changesModelVisibleSchemasOnly: true,
            executesPhotoshop: false,
            grantsPermission: false
          }
        };
      }
      return { success: true, items: [{ title: 'fixture reference' }] };
    }
  );

  await agent.run('查找适合当前设计目标的参考');
  assert(!modelToolSurfaces[0].includes(replacementSkillName), 'non-recommended Skill leaked into the first turn');
  assert(modelToolSurfaces[1].includes(replacementSkillName), 'requested replacement Skill was not visible on the next turn');
  assert.deepStrictEqual(
    executedToolNames.slice(0, 2),
    [REQUEST_AGENT_CAPABILITIES_TOOL_NAME, replacementSkillName],
    'wrong recommendation did not recover through exactly one on-demand request'
  );
  assert.strictEqual(capabilityRequestCount, 1);
  assert.strictEqual(
    fixture.capabilitySession.getResolution().manifestRef,
    undefined,
    'advisory recovery unexpectedly bound a Runtime Manifest'
  );
}

function projectSkillWorkflowResult(skillId, result) {
  return {
    ...result,
    data: {
      ...(result.data || {}),
      agentReActObservation: buildSkillWorkflowBridgeObservation(skillId, result)
    }
  };
}

/**
 * 合法 nonFatal Workflow handoff 是“修复后重入”的控制流，不是工具故障。
 * 真实 Agent loop 连续经历三次 handoff 后，第四次 owner 调用仍必须真正到达
 * executor；否则同名工具三连败熔断会把多模板修复误杀。
 */
async function assertDeclaredWorkflowHandoffsDoNotTripFailureBreaker() {
  const skillName = 'sku-batch';
  const tools = [
    buildSkillToolSchemas().find((tool) => tool.name === skillName),
    requireAgentTool('getDocumentInfo'),
    requireAgentTool('getLayerHierarchy'),
    requireAgentTool('getLayerProperties')
  ];
  assert(tools.every(Boolean), 'workflow handoff liveness fixture is missing a Tool schema');
  const ownerExecutions = [];
  const executedToolNames = [];
  let modelCallCount = 0;
  const readCalls = [
    { id: 'repair-read-1', name: 'getDocumentInfo', arguments: {} },
    { id: 'repair-read-2', name: 'getLayerHierarchy', arguments: {} },
    { id: 'repair-read-3', name: 'getLayerProperties', arguments: { layerId: 3 } }
  ];
  const agent = new Agent(
    buildAgentTestConfig({
      tools,
      maxIterations: 6,
      openingCanvasObservationMode: 'none'
    }),
    async () => {
      modelCallCount += 1;
      if (modelCallCount === 1) {
        return {
          toolCalls: [{
            id: 'workflow-owner-1',
            name: skillName,
            arguments: { stage: 'full', userIntent: 'handoff liveness audit' }
          }]
        };
      }
      if (modelCallCount >= 2 && modelCallCount <= 4) {
        const ownerNumber = modelCallCount;
        return {
          toolCalls: [
            readCalls[modelCallCount - 2],
            {
              id: `workflow-owner-${ownerNumber}`,
              name: skillName,
              arguments: { stage: 'full', userIntent: 'handoff liveness audit' }
            }
          ]
        };
      }
      return { content: '工作流已完成修复并重入。', stopReason: 'end_turn' };
    },
    async (toolName, arguments_) => {
      executedToolNames.push(toolName);
      if (toolName !== skillName) {
        return {
          success: true,
          document: { id: 71, name: 'SKU.psb' },
          layer: { id: Number(arguments_?.layerId || 3) },
          historyStateRef: {
            documentId: 71,
            historyStateId: 20 + executedToolNames.length
          }
        };
      }
      ownerExecutions.push(toolName);
      if (ownerExecutions.length === 4) {
        return projectSkillWorkflowResult(skillName, {
          success: true,
          message: '结构化 Workflow 已完成。',
          skillOutcome: {
            version: 'skill-execution-outcome/v0',
            status: 'completed',
            summary: '结构化 Workflow 已完成。',
            outputs: [],
            blockers: [],
            warnings: []
          }
        });
      }
      return projectSkillWorkflowResult(skillName, {
        success: false,
        nonFatal: true,
        error: '需要先完成声明的原子修复。',
        data: {
          status: 'pending_fixture_repair',
          agentReActContinuation: {
            status: 'needs_repair',
            summary: '继续修复后重入原 Workflow。',
            nextAction: 'repair',
            recovery: {
              mode: 'allowlist',
              purpose: 'repair',
              allowedToolNames: [
                'getDocumentInfo',
                'getLayerHierarchy',
                'getLayerProperties'
              ],
              reason: '需要读取并修复当前目标后重入。'
            }
          }
        }
      });
    }
  );

  const result = await agent.run('验证声明式 Workflow 多轮修复活性');
  assert.strictEqual(
    ownerExecutions.length,
    4,
    `valid nonFatal handoffs tripped the same-tool failure breaker: ${JSON.stringify(result)}`
  );
  assert.deepStrictEqual(
    executedToolNames.filter((name) => name === skillName),
    [skillName, skillName, skillName, skillName]
  );
  assert(
    !result.toolCallLog?.some((entry) => entry.result?.blockedByFailureBreaker === true),
    'declared workflow handoff was reported as a consecutive Tool failure'
  );
}

/**
 * 仅有 runner 投影和 nonFatal 标记仍不构成 Workflow handoff：没有声明
 * recovery allowlist 时必须继续计入同名工具失败，并在第三次真实失败后直接停止，
 * 不再额外购买一个只用于生成阻断结果的模型回合。
 */
async function assertProjectedBareNonFatalStillTripsFailureBreaker() {
  const skillName = 'sku-batch';
  const tools = [
    buildSkillToolSchemas().find((tool) => tool.name === skillName),
    requireAgentTool('getDocumentInfo'),
    requireAgentTool('getLayerHierarchy')
  ];
  assert(tools.every(Boolean), 'projected bare nonFatal fixture is missing a Tool schema');
  const ownerExecutions = [];
  let modelCallCount = 0;
  const readCalls = [
    { id: 'bare-read-1', name: 'getDocumentInfo', arguments: {} },
    { id: 'bare-read-2', name: 'getLayerHierarchy', arguments: {} }
  ];
  const agent = new Agent(
    buildAgentTestConfig({
      tools,
      maxIterations: 6,
      openingCanvasObservationMode: 'none'
    }),
    async () => {
      modelCallCount += 1;
      if (modelCallCount === 1) {
        return {
          toolCalls: [{
            id: 'bare-owner-1',
            name: skillName,
            arguments: { stage: 'full', userIntent: 'projected bare nonFatal audit' }
          }]
        };
      }
      if (modelCallCount === 2 || modelCallCount === 3) {
        return {
          toolCalls: [
            readCalls[modelCallCount - 2],
            {
              id: `bare-owner-${modelCallCount}`,
              name: skillName,
              arguments: { stage: 'full', userIntent: 'projected bare nonFatal audit' }
            }
          ]
        };
      }
      return {
        toolCalls: [{
          id: `bare-owner-${modelCallCount}`,
          name: skillName,
          arguments: { stage: 'full', userIntent: 'projected bare nonFatal audit' }
        }]
      };
    },
    async (toolName) => {
      if (toolName !== skillName) {
        return {
          success: true,
          document: { id: 71, name: 'SKU.psb' },
          historyStateRef: { documentId: 71, historyStateId: 30 + modelCallCount }
        };
      }
      ownerExecutions.push(toolName);
      return projectSkillWorkflowResult(skillName, {
        success: false,
        nonFatal: true,
        error: 'bare nonFatal 没有声明可执行 recovery allowlist。'
      });
    }
  );

  const result = await agent.run('验证 bare nonFatal 不能绕过同名工具失败熔断');
  const ownerLogs = result.toolCallLog?.filter((entry) => entry.name === skillName) || [];
  assert.strictEqual(ownerExecutions.length, 3, 'projected bare nonFatal reached the owner more than three times');
  assert.strictEqual(modelCallCount, 3, 'projected bare nonFatal bought an extra breaker-only model turn');
  assert.strictEqual(result.stopReason, 'no_progress');
  assert.strictEqual(ownerLogs.length, 3, 'projected bare nonFatal created a synthetic fourth owner record');
}

/**
 * 原始 executor continuation 不是 Harness 能力真相源。即使形状包含 repair allowlist，
 * 没有 agent-react-observation/v0 投影也必须在第三次 owner 失败后以 no_progress 停止。
 */
async function assertUnprojectedRawContinuationStillTripsFailureBreaker() {
  const skillName = 'sku-batch';
  const tools = [
    buildSkillToolSchemas().find((tool) => tool.name === skillName),
    requireAgentTool('getDocumentInfo'),
    requireAgentTool('getLayerHierarchy')
  ];
  assert(tools.every(Boolean), 'raw continuation fixture is missing a Tool schema');
  const ownerExecutions = [];
  let modelCallCount = 0;
  const readCalls = [
    { id: 'raw-read-1', name: 'getDocumentInfo', arguments: {} },
    { id: 'raw-read-2', name: 'getLayerHierarchy', arguments: {} }
  ];
  const agent = new Agent(
    buildAgentTestConfig({
      tools,
      maxIterations: 6,
      openingCanvasObservationMode: 'none'
    }),
    async () => {
      modelCallCount += 1;
      if (modelCallCount === 1) {
        return {
          toolCalls: [{
            id: 'raw-owner-1',
            name: skillName,
            arguments: { stage: 'full', userIntent: 'raw continuation audit' }
          }]
        };
      }
      if (modelCallCount === 2 || modelCallCount === 3) {
        return {
          toolCalls: [
            readCalls[modelCallCount - 2],
            {
              id: `raw-owner-${modelCallCount}`,
              name: skillName,
              arguments: { stage: 'full', userIntent: 'raw continuation audit' }
            }
          ]
        };
      }
      return {
        toolCalls: [{
          id: `raw-owner-${modelCallCount}`,
          name: skillName,
          arguments: { stage: 'full', userIntent: 'raw continuation audit' }
        }]
      };
    },
    async (toolName) => {
      if (toolName !== skillName) {
        return {
          success: true,
          document: { id: 71, name: 'SKU.psb' },
          historyStateRef: { documentId: 71, historyStateId: 40 + modelCallCount }
        };
      }
      ownerExecutions.push(toolName);
      return {
        success: false,
        nonFatal: true,
        error: '原始 continuation 尚未经过 runner 投影。',
        data: {
          agentReActContinuation: {
            status: 'needs_repair',
            nextAction: 'repair',
            recovery: {
              mode: 'allowlist',
              purpose: 'repair',
              allowedToolNames: ['getDocumentInfo'],
              reason: '原始 executor 声明不能直接取得 Harness 信任。'
            }
          }
        }
      };
    }
  );

  const result = await agent.run('验证未投影 continuation 不能绕过同名工具失败熔断');
  const ownerLogs = result.toolCallLog?.filter((entry) => entry.name === skillName) || [];
  assert.strictEqual(ownerExecutions.length, 3, 'raw continuation reached the owner more than three times');
  assert.strictEqual(modelCallCount, 3, 'raw continuation did not stop on the third failed owner turn');
  assert.strictEqual(result.stopReason, 'no_progress');
  assert.strictEqual(ownerLogs.length, 3, 'raw continuation unexpectedly created a fourth owner call');
}

/**
 * 取消是立即终止信号。即使结果同时携带原本合法的投影 handoff，cancelled=true
 * 也必须在首轮停止，不能继续循环或进入同名工具失败计数。
 */
async function assertCancelledProjectedWorkflowHandoffStopsImmediately() {
  const skillName = 'sku-batch';
  const workflowTool = buildSkillToolSchemas().find((tool) => tool.name === skillName);
  assert(workflowTool, 'cancelled Workflow handoff fixture is missing the Skill schema');
  const projectedHandoff = projectSkillWorkflowResult(skillName, {
    success: false,
    nonFatal: true,
    error: '取消前原本需要继续修复。',
    data: {
      status: 'pending_fixture_repair',
      agentReActContinuation: {
        status: 'needs_repair',
        nextAction: 'repair',
        recovery: {
          mode: 'allowlist',
          purpose: 'repair',
          allowedToolNames: ['getDocumentInfo'],
          reason: '这是一个原本合法、但随后被取消的投影 handoff。'
        }
      }
    }
  });
  let modelCallCount = 0;
  let ownerExecutionCount = 0;
  const agent = new Agent(
    buildAgentTestConfig({
      tools: [workflowTool],
      maxIterations: 6,
      openingCanvasObservationMode: 'none'
    }),
    async () => {
      modelCallCount += 1;
      return {
        toolCalls: [{
          id: `cancelled-owner-${modelCallCount}`,
          name: skillName,
          arguments: { stage: 'full', userIntent: 'cancelled projected handoff audit' }
        }]
      };
    },
    async () => {
      ownerExecutionCount += 1;
      return {
        ...projectedHandoff,
        cancelled: true,
        error: '任务已取消。'
      };
    }
  );

  const result = await agent.run('验证取消优先于 Workflow handoff 与失败熔断');
  assert.strictEqual(modelCallCount, 1, 'cancelled Workflow handoff requested another model turn');
  assert.strictEqual(ownerExecutionCount, 1, 'cancelled Workflow handoff executed the owner again');
  assert.strictEqual(result.cancelled, true);
  assert.strictEqual(result.stopReason, 'cancelled');
  assert.strictEqual(result.toolCallLog?.length, 1, 'cancelled Workflow handoff logged later Tool calls');
}

async function assertDirectRuntimeRepairStaysInE1UntilOwnerAccepts(handoffSuccess) {
  const identity = createPlanNeutralIdentity(
    `workflow-repair-e1-obligation-${handoffSuccess ? 'successful' : 'nonfatal'}`
  );
  const workflowTool = buildSkillToolSchemas().find((tool) => tool.name === 'sku-batch');
  assert(workflowTool, 'SKU workflow Tool schema is missing');
  const runtimeTools = [
    requireAgentTool('getDocumentInfo'),
    workflowTool,
    requireAgentTool('createRectangle'),
    requireAgentTool('getLayerHierarchy')
  ];
  const tools = [
    requireAgentTool('declareDesignIntent'),
    requireAgentTool('getDocumentInfo')
  ];
  const executedToolNames = [];
  const stagesBeforeModel = [];
  let modelCallCount = 0;
  let agent;
  agent = new Agent(
    buildAgentTestConfig({
      tools,
      maxIterations: 12,
      runtimeSessionIdentity: identity
    }),
    async (_modelId, _messages, visibleTools) => {
      modelCallCount += 1;
      stagesBeforeModel.push(agent.runtimeSession?.stageState?.currentStage);
      if (modelCallCount === 1) {
        return {
          toolCalls: [{
            id: 'declare-workflow-repair-runtime',
            name: 'declareDesignIntent',
            arguments: { taskTypeId: 'ecommerce.sku_batch.v1' }
          }]
        };
      }
      if (modelCallCount === 2) {
        assert.strictEqual(agent.runtimeSession?.stageState?.currentStage, 'E1');
        return {
          toolCalls: [{
            id: 'workflow-repair-handoff',
            name: 'sku-batch',
            arguments: { stage: 'full', userIntent: 'workflow repair audit' }
          }]
        };
      }
      if (modelCallCount === 3) {
        assert.strictEqual(
          agent.runtimeSession?.stageState?.currentStage,
          'E1',
          'declared repair handoff advanced compact Runtime before any repair'
        );
        assert(
          !visibleTools.some((tool) => tool.name === 'sku-batch'),
          'Workflow owner remained visible before the repair epoch produced a mutation'
        );
        assert(visibleTools.some((tool) => tool.name === 'createRectangle'));
        return {
          content: '我会先完成可逆结构修复。',
          toolCalls: [{
            id: 'workflow-atomic-repair-1',
            name: 'createRectangle',
            arguments: { x: 20, y: 20, width: 120, height: 80, name: '修复占位一' }
          }]
        };
      }
      if (modelCallCount === 4) {
        assert.strictEqual(
          agent.runtimeSession?.stageState?.currentStage,
          'E1',
          'atomic repair mutation incorrectly completed the whole Workflow E1'
        );
        assert(
          !visibleTools.some((tool) => tool.name === 'sku-batch'),
          'Workflow owner became visible before the latest mutation had an exact readback'
        );
        return {
          toolCalls: [{
            id: 'workflow-repair-readback-1',
            name: 'getLayerHierarchy',
            arguments: {}
          }]
        };
      }
      if (modelCallCount === 5) {
        assert.strictEqual(
          agent.runtimeSession?.stageState?.currentStage,
          'E1',
          'atomic repair readback incorrectly advanced the whole Workflow to R5'
        );
        assert(
          visibleTools.some((tool) => tool.name === 'sku-batch'),
          'Workflow owner did not become visible after the exact repair readback'
        );
        return {
          toolCalls: [{
            id: 'workflow-owner-second-handoff',
            name: 'sku-batch',
            arguments: { stage: 'full', userIntent: 'workflow repair audit' }
          }]
        };
      }
      if (modelCallCount === 6) {
        assert.strictEqual(
          agent.runtimeSession?.stageState?.currentStage,
          'E1',
          'a new repair handoff incorrectly advanced the compact Runtime'
        );
        assert(
          !visibleTools.some((tool) => tool.name === 'sku-batch'),
          'a new repair epoch reused old evidence to expose its owner'
        );
        assert.strictEqual(agent.pendingDirectWorkflowHandoff?.currentEpochMutationCount, 0);
        assert.strictEqual(agent.pendingDirectWorkflowHandoff?.mutationEvidence.length, 1);
        assert.strictEqual(
          agent.pendingDirectWorkflowHandoff?.mutationEvidence[0].verifiedReadback,
          true,
          'new repair epoch discarded the prior exact readback evidence'
        );
        return {
          toolCalls: [{
            id: 'workflow-atomic-repair-2',
            name: 'createRectangle',
            arguments: { x: 180, y: 20, width: 120, height: 80, name: '修复占位二' }
          }]
        };
      }
      if (modelCallCount === 7) {
        assert.strictEqual(agent.runtimeSession?.stageState?.currentStage, 'E1');
        assert(
          !visibleTools.some((tool) => tool.name === 'sku-batch'),
          'Workflow owner became visible before the second epoch latest mutation readback'
        );
        return {
          toolCalls: [{
            id: 'workflow-repair-readback-2',
            name: 'getLayerHierarchy',
            arguments: {}
          }]
        };
      }
      if (modelCallCount === 8) {
        assert.strictEqual(agent.runtimeSession?.stageState?.currentStage, 'E1');
        assert(
          visibleTools.some((tool) => tool.name === 'sku-batch'),
          'Workflow owner did not become visible after the second epoch exact readback'
        );
        return {
          toolCalls: [{
            id: 'workflow-owner-accept-repair',
            name: 'sku-batch',
            arguments: { stage: 'full', userIntent: 'workflow repair audit' }
          }]
        };
      }
      if (modelCallCount === 9) {
        assert.strictEqual(
          agent.runtimeSession?.stageState?.currentStage,
          'E1',
          'completed owner mutation incorrectly bypassed its exact readback'
        );
        assert.strictEqual(agent.pendingDirectWorkflowHandoff?.ownerAccepted, true);
        assert(
          !visibleTools.some((tool) => tool.name === 'sku-batch'),
          'accepted Workflow owner remained visible while its final mutation awaited readback'
        );
        assert(
          visibleTools.some((tool) => tool.name === 'getLayerHierarchy'),
          'accepted Workflow owner lost its declared exact-readback tool'
        );
        return {
          toolCalls: [{
            id: 'workflow-owner-final-mutation-readback',
            name: 'getLayerHierarchy',
            arguments: {}
          }]
        };
      }
      return { content: '修复已由工作流验收。', stopReason: 'end_turn' };
    },
    async (toolName, arguments_) => {
      executedToolNames.push(toolName);
      if (toolName === 'declareDesignIntent') {
        return activateSkuRuntime({
          agent,
          identity,
          tools,
          arguments: arguments_,
          maxIterations: 12,
          nextTools: runtimeTools
        });
      }
      if (toolName === 'sku-batch') {
        const ownerCount = executedToolNames.filter((name) => name === 'sku-batch').length;
        if (ownerCount <= 2) {
          return projectSkillWorkflowResult('sku-batch', {
            success: handoffSuccess,
            ...(handoffSuccess ? {} : { nonFatal: true }),
            message: '模板结构已完成检查，仍需要原子修复。',
            data: {
              status: 'pending_fixture_repair',
              agentReActContinuation: {
                status: 'needs_repair',
                summary: '完成原子修复与读回后重入。',
                nextAction: 'repair',
                recovery: {
                  mode: 'allowlist',
                  purpose: 'repair',
                  allowedToolNames: ['createRectangle', 'getLayerHierarchy'],
                  reason: '修复模板结构并在同文档读回。'
                }
              }
            }
          });
        }
        return projectSkillWorkflowResult('sku-batch', {
          success: true,
          message: 'Workflow 已验收原子修复。',
          skillOutcome: {
            version: 'skill-execution-outcome/v0',
            status: 'completed',
            summary: 'Workflow 已验收原子修复。',
            outputs: [],
            blockers: [],
            warnings: []
          },
          toolResults: [{
            toolName: 'createRectangle',
            result: {
              success: true,
              photoshopMutationCommit: {
                version: 'photoshop-mutation-commit/v1',
                basis: 'same_execute_as_modal',
                bindingStrength: 'document_revision',
                before: { documentId: 71, historyStateId: 11, activeLayerId: 89 },
                after: { documentId: 71, historyStateId: 12, activeLayerId: 90 },
                toolActionCompleted: true,
                mutationObserved: true,
                documentChanged: false
              },
              photoshopOperationResult: {
                version: 'photoshop-operation-result/v1',
                operationId: 'workflow-owner-final-production-operation',
                toolName: 'createRectangle',
                status: 'verified',
                applicationStatus: 'applied',
                transactionState: 'committed',
                effect: 'applied',
                rollback: { attempted: false, verified: false },
                before: { documentId: 71, historyStateId: 11 },
                after: { documentId: 71, historyStateId: 12 }
              }
            }
          }]
        });
      }
      if (toolName === 'createRectangle') {
        const mutationCount = executedToolNames.filter((name) => name === 'createRectangle').length;
        const beforeRevision = mutationCount === 1 ? 9 : 10;
        const afterRevision = mutationCount === 1 ? 10 : 11;
        const layerId = mutationCount === 1 ? 88 : 89;
        return {
          success: true,
          layerId,
          documentId: 71,
          historyStateRef: { documentId: 71, historyStateId: afterRevision },
          photoshopMutationCommit: {
            version: 'photoshop-mutation-commit/v1',
            basis: 'same_execute_as_modal',
            bindingStrength: 'document_revision',
            before: { documentId: 71, historyStateId: beforeRevision, activeLayerId: 3 },
            after: { documentId: 71, historyStateId: afterRevision, activeLayerId: layerId },
            toolActionCompleted: true,
            mutationObserved: true,
            documentChanged: false
          },
          photoshopOperationResult: {
            version: 'photoshop-operation-result/v1',
            operationId: `workflow-atomic-repair-operation-${mutationCount}`,
            toolName: 'createRectangle',
            status: 'verified',
            applicationStatus: 'applied',
            transactionState: 'committed',
            effect: 'applied',
            rollback: { attempted: false, verified: false },
            before: { documentId: 71, historyStateId: beforeRevision },
            after: { documentId: 71, historyStateId: afterRevision }
          }
        };
      }
      if (toolName === 'getLayerHierarchy') {
        const ownerCount = executedToolNames.filter((name) => name === 'sku-batch').length;
        const mutationCount = executedToolNames.filter((name) => name === 'createRectangle').length;
        let historyStateId = mutationCount === 1 ? 10 : 11;
        let layerId = mutationCount === 1 ? 88 : 89;
        if (ownerCount >= 3) {
          historyStateId = 12;
          layerId = 90;
        }
        return {
          success: true,
          documentId: 71,
          layers: [{ id: layerId, name: '修复占位', kind: 'shape' }],
          historyStateRef: { documentId: 71, historyStateId }
        };
      }
      return buildDocumentObservation();
    }
  );

  const runResult = await agent.run('验证 Workflow 修复不会提前结束精简 Runtime');
  assert.strictEqual(
    agent.runtimeSession?.stageState?.currentStage,
    'R5',
    `Workflow owner accepted a mutation/readback repair but compact Runtime did not enter R5: ${JSON.stringify(runResult.toolCallLog)}`
  );
  assert.deepStrictEqual(
    executedToolNames.filter((name) => name === 'sku-batch'),
    ['sku-batch', 'sku-batch', 'sku-batch']
  );
  assert.deepStrictEqual(
    stagesBeforeModel.slice(1, 10),
    ['E1', 'E1', 'E1', 'E1', 'E1', 'E1', 'E1', 'E1', 'R5']
  );
  assert.strictEqual(agent.pendingDirectWorkflowHandoff, undefined);
  assert.strictEqual(agent.workflowContinuationScope, undefined);
}

function assertDirectRuntimeRepairRequiresExactMutationRevision() {
  const agent = new Agent(
    buildAgentTestConfig({ tools: [requireAgentTool('getLayerHierarchy')] }),
    async () => ({ content: 'unused', stopReason: 'end_turn' }),
    async () => ({ success: true })
  );
  agent.pendingDirectWorkflowHandoff = {
    workflowToolName: 'fixture-workflow-owner',
    workflowCallId: 'exact-revision-handoff',
    binding: { sessionId: 'session', runId: 'run', generation: 1, stage: 'E1' },
    currentEpochMutationCount: 2,
    ownerAccepted: false,
    mutationEvidence: [
      {
        target: { documentId: '71' },
        after: { documentId: 71, historyStateId: 10 },
        verifiedReadback: false
      },
      {
        target: { documentId: '72' },
        after: { documentId: 72, historyStateId: 20 },
        verifiedReadback: false
      }
    ]
  };

  const staleCredit = agent.resolveDirectRuntimeE1VerificationCredit(
    { id: 'stale-read', name: 'getLayerHierarchy', arguments: {} },
    { success: true, documentId: 71, historyStateRef: { documentId: 71, historyStateId: 9 } }
  );
  assert.strictEqual(staleCredit.outcome, 'missing_required_outcomes');
  assert.strictEqual(
    agent.pendingDirectWorkflowHandoff.mutationEvidence[0].verifiedReadback,
    false,
    'same-document stale history was incorrectly accepted as repair readback'
  );

  agent.resolveDirectRuntimeE1VerificationCredit(
    { id: 'exact-read', name: 'getLayerHierarchy', arguments: {} },
    { success: true, documentId: 71, historyStateRef: { documentId: 71, historyStateId: 10 } }
  );
  assert.strictEqual(
    agent.pendingDirectWorkflowHandoff.mutationEvidence[0].verifiedReadback,
    true,
    'exact mutation-after revision was not accepted as repair readback'
  );
  assert.strictEqual(
    agent.isPendingDirectWorkflowOwnerReentryReady(),
    false,
    'one exact document readback incorrectly satisfied a two-document repair epoch'
  );

  agent.resolveDirectRuntimeE1VerificationCredit(
    { id: 'second-stale-read', name: 'getLayerHierarchy', arguments: {} },
    { success: true, documentId: 72, historyStateRef: { documentId: 72, historyStateId: 19 } }
  );
  assert.strictEqual(
    agent.pendingDirectWorkflowHandoff.mutationEvidence[1].verifiedReadback,
    false,
    'second document stale history was incorrectly accepted as repair readback'
  );

  agent.resolveDirectRuntimeE1VerificationCredit(
    { id: 'second-exact-read', name: 'getLayerHierarchy', arguments: {} },
    { success: true, documentId: 72, historyStateRef: { documentId: 72, historyStateId: 20 } }
  );
  assert.strictEqual(
    agent.isPendingDirectWorkflowOwnerReentryReady(),
    true,
    'two-document exact latest revisions did not make the owner eligible for reentry'
  );

  const completionCredit = agent.resolveDirectRuntimeE1VerificationCredit(
    { id: 'fixture-owner-completion', name: 'fixture-workflow-owner', arguments: {} },
    {
      success: true,
      skillOutcome: {
        version: 'skill-execution-outcome/v0',
        status: 'completed',
        summary: 'fixture owner accepted both documents',
        outputs: [],
        blockers: [],
        warnings: []
      }
    }
  );
  assert.strictEqual(completionCredit.outcome, 'passed');
  assert.strictEqual(agent.pendingDirectWorkflowHandoff, undefined);
}

async function assertGeneralDesignUnknownWriteKeepsBoundedReadbackAlive() {
  const resolution = resolveRuntimeDeclarationForAgentTask({
    taskType: 'design.generic.v1',
    workMode: 'create_new',
    executableToolNames
  });
  assert.strictEqual(resolution.status, 'resolved');
  const capabilitySession = createAgentCapabilitySession({
    candidateTools: getDefaultAgentTools(),
    requestedTaskType: 'design.generic.v1',
    manifest: resolution.bundle.manifest,
    workMode: 'create_new'
  });
  const shapeActivation = capabilitySession.requestCapabilities([
    'photoshop.sandbox.createShape'
  ]);
  assert.strictEqual(shapeActivation.status, 'activated');

  const modelToolSurfaces = [];
  const executedToolNames = [];
  let modelCallCount = 0;
  const agent = new Agent(
    {
      ...buildAgentTestConfig({
        tools: capabilitySession.activeTools,
        maxIterations: 4,
        openingCanvasObservationMode: 'document_identity'
      }),
      toolCapabilityBridge: resolution.bundle.toolCapabilityBridge,
      getActiveCapabilityIdsForTool: (toolName) => (
        capabilitySession.getActiveCapabilityIdsForTool(toolName)
      ),
      getOnDemandActivatedCapabilityIds: () => (
        capabilitySession.getOnDemandActivatedCapabilityIds()
      )
    },
    async (_modelId, _messages, visibleTools) => {
      modelCallCount += 1;
      modelToolSurfaces.push(visibleTools.map((tool) => tool.name));
      if (modelCallCount === 1) {
        return {
          toolCalls: [{
            id: 'unknown-write',
            name: 'createRectangle',
            arguments: { x: 10, y: 10, width: 100, height: 100 }
          }]
        };
      }
      if (modelCallCount === 2) {
        return {
          toolCalls: [{ id: 'first-generic-readback', name: 'getDocumentInfo', arguments: {} }]
        };
      }
      if (modelCallCount === 3) {
        return {
          toolCalls: [{ id: 'second-generic-readback', name: 'getLayerHierarchy', arguments: {} }]
        };
      }
      return { content: '写入状态仍无法确认，已保留现场。', stopReason: 'end_turn' };
    },
    async (toolName) => {
      executedToolNames.push(toolName);
      if (toolName === 'createRectangle') {
        return {
          success: false,
          documentId: 71,
          error: 'transport status unknown',
          photoshopOperationResult: {
            version: 'photoshop-operation-result/v1',
            operationId: 'general-design-unknown-write',
            toolName,
            status: 'unknown',
            applicationStatus: 'unknown',
            transactionState: 'transport_unknown',
            effect: 'unknown',
            rollback: { attempted: false, verified: false },
            before: { documentId: 71, historyStateId: 9 }
          }
        };
      }
      if (toolName === 'getLayerHierarchy') {
        return {
          success: true,
          documentId: 71,
          layers: [{ id: 3, name: 'Background', kind: 'pixel' }],
          historyStateRef: { documentId: 71, historyStateId: 10 }
        };
      }
      return {
        ...buildDocumentObservation(),
        historyStateRef: { documentId: 71, historyStateId: 10 }
      };
    }
  );

  await agent.run('制作一个通用视觉设计');
  assert.deepStrictEqual(executedToolNames.slice(0, 4), [
    'getDocumentInfo',
    'createRectangle',
    'getDocumentInfo',
    'getLayerHierarchy'
  ]);
  assert.deepStrictEqual(
    modelToolSurfaces[1],
    ['getDocumentInfo', 'getLayerHierarchy'],
    'general-design getDocumentSummary providers were not exposed for unknown-write recovery'
  );
  assert.deepStrictEqual(
    modelToolSurfaces[2],
    ['getLayerHierarchy'],
    'the first generic readback produced an empty Tool surface instead of the alternate provider'
  );
  assert.strictEqual(agent.pendingRuntimeActionMutationReadback?.genericReadbackAttemptCount, 2);
  assert.strictEqual(agent.pendingRuntimeActionMutationReadback?.genericReadbackExhausted, true);
  assert.strictEqual(agent.runtimeActionMutationWriteLocked, true);
  assert.strictEqual(agent.runtimeActionProviderRecoveryBlocked, true);
  assert.strictEqual(
    executedToolNames.filter((toolName) => toolName === 'createRectangle').length,
    1,
    'unknown write was automatically replayed during recovery'
  );
}

async function assertGeneralDesignUnknownWriteUnchangedReadbackRestoresOtherWrites() {
  const resolution = resolveRuntimeDeclarationForAgentTask({
    taskType: 'design.generic.v1',
    workMode: 'create_new',
    executableToolNames
  });
  assert.strictEqual(resolution.status, 'resolved');
  const capabilitySession = createAgentCapabilitySession({
    candidateTools: getDefaultAgentTools(),
    requestedTaskType: 'design.generic.v1',
    manifest: resolution.bundle.manifest,
    workMode: 'create_new'
  });
  const shapeActivation = capabilitySession.requestCapabilities([
    'photoshop.sandbox.createShape'
  ]);
  assert.strictEqual(shapeActivation.status, 'activated');

  const modelToolSurfaces = [];
  const executedToolNames = [];
  let modelCallCount = 0;
  const agent = new Agent(
    {
      ...buildAgentTestConfig({
        tools: capabilitySession.activeTools,
        maxIterations: 4,
        openingCanvasObservationMode: 'document_identity'
      }),
      toolCapabilityBridge: resolution.bundle.toolCapabilityBridge,
      getActiveCapabilityIdsForTool: (toolName) => (
        capabilitySession.getActiveCapabilityIdsForTool(toolName)
      ),
      getOnDemandActivatedCapabilityIds: () => (
        capabilitySession.getOnDemandActivatedCapabilityIds()
      )
    },
    async (_modelId, _messages, visibleTools) => {
      modelCallCount += 1;
      modelToolSurfaces.push(visibleTools.map((tool) => tool.name));
      if (modelCallCount === 1) {
        return {
          toolCalls: [{
            id: 'unknown-write-no-change',
            name: 'createRectangle',
            arguments: { x: 10, y: 10, width: 100, height: 100 }
          }]
        };
      }
      if (modelCallCount === 2) {
        return {
          toolCalls: [{ id: 'unchanged-readback', name: 'getDocumentInfo', arguments: {} }]
        };
      }
      if (modelCallCount === 3) {
        assert.ok(
          visibleTools.some((tool) => tool.name === 'createEllipse'),
          'an unchanged same-document readback did not restore an alternate write provider'
        );
        assert.ok(
          !visibleTools.some((tool) => tool.name === 'createRectangle'),
          'the unknown write provider was exposed for replay after unchanged readback'
        );
        return {
          toolCalls: [{
            id: 'alternate-write-after-readback',
            name: 'createEllipse',
            arguments: { x: 20, y: 20, width: 80, height: 80 }
          }]
        };
      }
      return { content: '已改用其他方法继续。', stopReason: 'end_turn' };
    },
    async (toolName) => {
      executedToolNames.push(toolName);
      if (toolName === 'createRectangle') {
        return {
          success: false,
          documentId: 71,
          error: 'transport status unknown',
          photoshopOperationResult: {
            version: 'photoshop-operation-result/v1',
            operationId: 'general-design-unknown-write-no-change',
            toolName,
            status: 'unknown',
            applicationStatus: 'unknown',
            transactionState: 'transport_unknown',
            effect: 'unknown',
            rollback: { attempted: false, verified: false },
            before: { documentId: 71, historyStateId: 9 }
          }
        };
      }
      if (toolName === 'createEllipse') {
        return {
          success: true,
          documentId: 71,
          historyStateRef: { documentId: 71, historyStateId: 10 },
          photoshopOperationResult: {
            version: 'photoshop-operation-result/v1',
            operationId: 'general-design-alternate-write',
            toolName,
            status: 'verified',
            applicationStatus: 'applied',
            transactionState: 'committed',
            effect: 'applied',
            rollback: { attempted: false, verified: false },
            before: { documentId: 71, historyStateId: 9 },
            after: { documentId: 71, historyStateId: 10 }
          }
        };
      }
      return buildDocumentObservation();
    }
  );

  await agent.run('制作一个通用视觉设计');
  assert.deepStrictEqual(executedToolNames.slice(0, 4), [
    'getDocumentInfo',
    'createRectangle',
    'getDocumentInfo',
    'createEllipse'
  ]);
  assert.deepStrictEqual(
    modelToolSurfaces[1],
    ['getDocumentInfo', 'getLayerHierarchy'],
    'unknown-write recovery did not expose safe readback providers'
  );
  assert.strictEqual(agent.pendingRuntimeActionMutationReadback, undefined);
  assert.strictEqual(agent.runtimeActionMutationWriteLocked, false);
  assert.strictEqual(agent.runtimeActionProviderRecoveryBlocked, false);
  assert.strictEqual(
    executedToolNames.filter((toolName) => toolName === 'createRectangle').length,
    1,
    'unknown write was replayed after unchanged readback'
  );
}

async function assertKnownNotAppliedWriteDoesNotBlockFollowingSerialWrite() {
  const resolution = resolveRuntimeDeclarationForAgentTask({
    taskType: 'design.generic.v1',
    workMode: 'create_new',
    executableToolNames
  });
  assert.strictEqual(resolution.status, 'resolved');
  const capabilitySession = createAgentCapabilitySession({
    candidateTools: getDefaultAgentTools(),
    requestedTaskType: 'design.generic.v1',
    manifest: resolution.bundle.manifest,
    workMode: 'create_new'
  });
  const shapeActivation = capabilitySession.requestCapabilities([
    'photoshop.sandbox.createShape'
  ]);
  assert.strictEqual(shapeActivation.status, 'activated');

  const executedToolNames = [];
  let modelCallCount = 0;
  const agent = new Agent(
    {
      ...buildAgentTestConfig({
        tools: capabilitySession.activeTools,
        maxIterations: 2,
        openingCanvasObservationMode: 'document_identity'
      }),
      toolCapabilityBridge: resolution.bundle.toolCapabilityBridge,
      getActiveCapabilityIdsForTool: (toolName) => (
        capabilitySession.getActiveCapabilityIdsForTool(toolName)
      ),
      getOnDemandActivatedCapabilityIds: () => (
        capabilitySession.getOnDemandActivatedCapabilityIds()
      )
    },
    async () => {
      modelCallCount += 1;
      if (modelCallCount === 1) {
        // 同一模型响应中的两个写调用必须串行执行。第一个结果由 Host 明确证明
        // not_applied；它不能污染同批次第二个、彼此独立的写调用。
        return {
          toolCalls: [
            {
              id: 'known-not-applied-write',
              name: 'createRectangle',
              arguments: { x: 10, y: 10, width: 80, height: 80 }
            },
            {
              id: 'following-independent-write',
              name: 'createEllipse',
              arguments: { x: 120, y: 20, width: 60, height: 60 }
            }
          ]
        };
      }
      return { content: '已按可用方法完成后续写入。', stopReason: 'end_turn' };
    },
    async (toolName) => {
      executedToolNames.push(toolName);
      if (toolName === 'createRectangle') {
        return {
          success: false,
          documentId: 71,
          code: 'fixture_parameter_rejected_before_mutation',
          error: 'fixture parameter rejected before mutation',
          photoshopOperationResult: {
            version: 'photoshop-operation-result/v1',
            operationId: 'known-not-applied-write',
            toolName,
            status: 'failed',
            applicationStatus: 'not_applied',
            transactionState: 'not_started',
            effect: 'none',
            rollback: { attempted: false, verified: false },
            before: { documentId: 71, historyStateId: 9 }
          }
        };
      }
      if (toolName === 'createEllipse') {
        return {
          success: true,
          documentId: 71,
          photoshopOperationResult: {
            version: 'photoshop-operation-result/v1',
            operationId: 'following-independent-write',
            toolName,
            status: 'verified',
            applicationStatus: 'applied',
            transactionState: 'committed',
            effect: 'applied',
            rollback: { attempted: false, verified: false },
            before: { documentId: 71, historyStateId: 9 },
            after: { documentId: 71, historyStateId: 10 }
          }
        };
      }
      return buildDocumentObservation();
    }
  );

  await agent.run('制作一个通用视觉设计');
  assert.deepStrictEqual(
    executedToolNames.slice(0, 3),
    ['getDocumentInfo', 'createRectangle', 'createEllipse'],
    'a proven not_applied write blocked the next independent serial write'
  );
  assert.strictEqual(
    agent.currentBatchMutationWriteLocked,
    false,
    'a proven not_applied result incorrectly established the current-batch mutation lock'
  );
  assert.strictEqual(
    agent.pendingRuntimeActionMutationReadback,
    undefined,
    'a proven not_applied result incorrectly created a mutation-readback obligation'
  );
  assert.strictEqual(
    agent.runtimeActionMutationWriteLocked,
    false,
    'a proven not_applied result incorrectly established the runtime mutation lock'
  );
}

/**
 * 设计路径宪法（2026-08-17）：status=applied 且带同一 modal history 前进证明
 * （photoshopMutationCommit.before→after）的成功写入，**不**建立写后读回义务，也**不**
 * 锁住同一模型响应里的下一个串行写入。写入事实已在结果里，再让模型花一轮读回是把同一件事
 * 买两次（真机 run 469：14 轮只写 6 层）。unknown / verification_failed / 无证明仍锁。
 */
async function assertProvenAppliedWriteDoesNotLockFollowingSerialWrite() {
  const executedToolNames = [];
  let modelCallCount = 0;
  const agent = new Agent(
    buildAgentTestConfig({
      tools: [
        requireAgentTool('getDocumentInfo'),
        requireAgentTool('createRectangle'),
        requireAgentTool('createEllipse')
      ],
      maxIterations: 3,
      openingCanvasObservationMode: 'document_identity'
    }),
    async () => {
      modelCallCount += 1;
      if (modelCallCount === 1) {
        return {
          toolCalls: [
            { id: 'applied-write-1', name: 'createRectangle', arguments: { x: 10, y: 10, width: 80, height: 80 } },
            { id: 'applied-write-2', name: 'createEllipse', arguments: { x: 120, y: 20, width: 60, height: 60 } }
          ]
        };
      }
      return { content: '两处形状已画好。', stopReason: 'end_turn' };
    },
    async (toolName) => {
      executedToolNames.push(toolName);
      if (toolName === 'createRectangle' || toolName === 'createEllipse') {
        const beforeId = toolName === 'createRectangle' ? 9 : 10;
        return {
          success: true,
          documentId: 71,
          photoshopOperationResult: {
            version: 'photoshop-operation-result/v1',
            operationId: `${toolName}-op`,
            toolName,
            status: 'applied',
            applicationStatus: 'applied',
            transactionState: 'committed',
            effect: 'applied',
            rollback: { attempted: false, verified: false },
            before: { documentId: 71, historyStateId: beforeId },
            after: { documentId: 71, historyStateId: beforeId + 1 }
          },
          photoshopMutationCommit: {
            version: 'photoshop-mutation-commit/v1',
            basis: 'same_execute_as_modal',
            bindingStrength: 'document_revision',
            before: { documentId: 71, historyStateId: beforeId, activeLayerId: null },
            after: { documentId: 71, historyStateId: beforeId + 1, activeLayerId: 4000 + beforeId },
            toolActionCompleted: true,
            mutationObserved: true,
            documentChanged: false
          }
        };
      }
      return buildDocumentObservation();
    }
  );

  await agent.run('在当前画布画两个形状');
  assert.deepStrictEqual(
    executedToolNames.slice(0, 3),
    ['getDocumentInfo', 'createRectangle', 'createEllipse'],
    'a proven applied write must not block the next independent serial write in the same turn'
  );
  assert.strictEqual(
    agent.pendingRuntimeActionMutationReadback,
    undefined,
    'a proven applied result must not create a model-turn readback obligation'
  );
  assert.strictEqual(
    agent.runtimeActionMutationWriteLocked,
    false,
    'a proven applied result must not establish the runtime mutation lock'
  );
}

async function assertConfirmedProductionNarrowsAfterBoundedObservation() {
  const intentControlPlane = buildAutonomousExecutionDecisionForEngine(
    'runtime-declaration-audit:confirmed-production'
  );
  const agentTaskPlan = buildAgentTaskPlanningContract({
    userInput: '制作一张主图并在当前画布真实写入',
    intentControlPlane,
    route: 'autonomous_agent',
    skillId: 'autonomous-agent',
    requiresTaskProgress: true
  });
  const tools = [
    requireAgentTool('getDocumentInfo'),
    requireAgentTool('getLayerHierarchy'),
    requireAgentTool('createRectangle')
  ];
  const modelToolSurfaces = [];
  const executedToolNames = [];
  let modelCallCount = 0;
  let maxAdviceMessagesInOneCall = 0;
  const agent = new Agent(
    {
      ...buildAgentTestConfig({
        tools,
        maxIterations: 10,
        openingCanvasObservationMode: 'none',
        agentTaskPlan
      }),
      toolDecisionContext: {
        intentControlPlane,
        photoshopConnected: true,
        hasDocument: true,
        currentDocumentUse: 'active_target'
      }
    },
    async (_modelId, messages, visibleTools) => {
      modelCallCount += 1;
      modelToolSurfaces.push(visibleTools.map((tool) => tool.name));
      const adviceMessages = messages.filter((message) => (
        message?.contextMetadata?.source === 'observation-reserve-advice'
      )).length;
      maxAdviceMessagesInOneCall = Math.max(maxAdviceMessagesInOneCall, adviceMessages);
      if (modelCallCount <= 7) {
        return {
          toolCalls: [{
            id: `pre-delivery-read-${modelCallCount}`,
            name: modelCallCount % 2 === 1 ? 'getDocumentInfo' : 'getLayerHierarchy',
            arguments: {}
          }]
        };
      }
      if (modelCallCount === 8) {
        // 设计路径宪法（2026-08-17）：写前观察超限只提醒不拦截、也不收窄工具面——
        // 第 8 轮模型仍应看见完整工具面（读 + 写），由它自己决定开始写入。
        assert.deepStrictEqual(
          [...visibleTools.map((tool) => tool.name)].sort(),
          ['createRectangle', 'getDocumentInfo', 'getLayerHierarchy'],
          'observation limit must not narrow the tool surface (advisory only)'
        );
        return {
          toolCalls: [{
            id: 'pre-delivery-write-1',
            name: 'createRectangle',
            arguments: { x: 20, y: 20, width: 120, height: 80 }
          }]
        };
      }
      return { content: '已开始真实制作，后续按现有读回契约继续。', stopReason: 'end_turn' };
    },
    async (toolName) => {
      executedToolNames.push(toolName);
      if (toolName !== 'createRectangle') return buildDocumentObservation();
      return {
        success: true,
        documentId: 71,
        photoshopOperationResult: {
          version: 'photoshop-operation-result/v1',
          operationId: 'pre-delivery-write-1',
          toolName,
          status: 'verified',
          applicationStatus: 'applied',
          transactionState: 'committed',
          effect: 'applied',
          rollback: { attempted: false, verified: false },
          before: { documentId: 71, historyStateId: 9 },
          after: { documentId: 71, historyStateId: 10 }
        }
      };
    }
  );

  await agent.run('制作一张主图并在当前画布真实写入');
  assert.deepStrictEqual(
    executedToolNames.slice(0, 8),
    [
      'getDocumentInfo',
      'getLayerHierarchy',
      'getDocumentInfo',
      'getLayerHierarchy',
      'getDocumentInfo',
      'getLayerHierarchy',
      'getDocumentInfo',
      'createRectangle'
    ],
    'all seven pre-delivery observations must execute (advisory contract), then the model writes'
  );
  assert(modelToolSurfaces[0].includes('getDocumentInfo'));
  assert(modelToolSurfaces[1].includes('getLayerHierarchy'));
  assert(
    !modelToolSurfaces.some((surface) => surface.length === 1 && surface[0] === 'createRectangle'),
    'the observation limit must never collapse the tool surface to a single write tool'
  );
  assert.strictEqual(
    maxAdviceMessagesInOneCall,
    1,
    `the start-writing advice must reach the model exactly once, saw ${maxAdviceMessagesInOneCall}`
  );
}

async function assertObservationObligationRequiresRealReadButNotMutation() {
  const intentControlPlane = buildAutonomousExecutionDecisionForEngine(
    'runtime-declaration-audit:observation-progress'
  );
  const agentTaskPlan = buildAgentTaskPlanningContract({
    userInput: '检查当前文档状态',
    intentControlPlane,
    route: 'autonomous_agent',
    skillId: 'autonomous-agent',
    requiresTaskProgress: true,
    taskProgressObligation: 'observation'
  });
  const executedToolNames = [];
  let modelCallCount = 0;
  const agent = new Agent(
    {
      ...buildAgentTestConfig({
        tools: [requireAgentTool('getDocumentInfo')],
        maxIterations: 4,
        openingCanvasObservationMode: 'none',
        agentTaskPlan
      }),
      toolDecisionContext: {
        intentControlPlane,
        photoshopConnected: true,
        hasDocument: true,
        currentDocumentUse: 'active_target'
      }
    },
    async () => {
      modelCallCount += 1;
      if (modelCallCount === 1) {
        return { content: '检查结果正常，无需修改。', stopReason: 'end_turn' };
      }
      if (modelCallCount === 2) {
        return {
          toolCalls: [{ id: 'observation-progress-read', name: 'getDocumentInfo', arguments: {} }]
        };
      }
      return { content: '已读取当前文档：文档存在，当前状态可继续使用。', stopReason: 'end_turn' };
    },
    async (toolName) => {
      executedToolNames.push(toolName);
      return buildDocumentObservation();
    }
  );

  const result = await agent.run('检查当前文档状态');
  assert.strictEqual(result.success, true);
  assert(modelCallCount >= 3 && modelCallCount <= 4);
  assert.deepStrictEqual(executedToolNames, ['getDocumentInfo']);
  assert(
    executedToolNames.every((toolName) => toolName === 'getDocumentInfo'),
    'observation-only progress was incorrectly upgraded to a mutation requirement'
  );
}

async function assertProviderTruncationRecoveryDoesNotSpendTaskModelBudget() {
  const requestedMaxTokens = [];
  let modelCallCount = 0;
  const agent = new Agent(
    {
      ...buildAgentTestConfig({
        tools: [],
        maxIterations: 3,
        openingCanvasObservationMode: 'none'
      }),
      performanceBudget: {
        maxModelCalls: 1,
        maxToolCalls: 1,
        maxVisionCandidates: 0,
        maxInitialVisionCandidates: 0,
        maxVisualAnalyses: 0,
        maxFullResolutionImageReads: 0,
        softTimeBudgetMs: 60_000,
        maxPrimaryOutputTokens: 1200
      }
    },
    async (_modelId, _messages, _visibleTools, options) => {
      modelCallCount += 1;
      requestedMaxTokens.push(options?.maxTokens);
      if (modelCallCount <= 2) {
        return { content: `截断片段 ${modelCallCount}`, stopReason: 'max_tokens' };
      }
      return { content: '已完整说明当前结果。', stopReason: 'end_turn' };
    },
    async () => {
      throw new Error('truncation recovery fixture must not execute Tools');
    }
  );

  const result = await agent.run('简要说明当前状态');
  assert.strictEqual(modelCallCount, 3);
  assert.deepStrictEqual(requestedMaxTokens, [1200, 2400, 4800]);
  assert.strictEqual(agent.performanceLedger.modelCallCount, 1);
  assert.notStrictEqual(result.stopReason, 'provider_output_truncated');
}

async function assertBareCompletionClaimsCannotBypassTextExits() {
  const expectedMessage = '这次只给出一句完成声明，没有真正做出内容，也没有给出可以查看的结果，所以不能算完成。';
  const directMessages = [];
  const directAgent = new Agent(
    buildAgentTestConfig({
      tools: [],
      maxIterations: 1,
      openingCanvasObservationMode: 'none',
      callbacks: { onMessage: (message) => directMessages.push(message) }
    }),
    async () => ({ content: '这张卡片已经完成，可以查看。', stopReason: 'end_turn' }),
    async () => {
      throw new Error('bare completion fixture must not execute Tools');
    }
  );
  const directResult = await directAgent.run('给我一份可执行的视觉方案');
  assert.strictEqual(directResult.success, false);
  assert.strictEqual(directResult.stopReason, 'plan_execution_mismatch');
  assert.strictEqual(directResult.error, 'unsupported_bare_completion_claim');
  assert.strictEqual(directResult.message, expectedMessage);
  assert.deepStrictEqual(
    directMessages,
    [],
    'candidate final text must stay internal until run settlement returns result.message'
  );
  assert.strictEqual(directResult.messages.at(-1)?.content, expectedMessage);

  const noToolConfig = buildAgentTestConfig({
    tools: [requireAgentTool('createRectangle')],
    maxIterations: 2,
    openingCanvasObservationMode: 'none'
  });
  noToolConfig.toolDecisionContext.intentControlPlane = buildAgentIntentControlPlaneDecision({
    userInput: '你好',
    hasImageInput: false,
    hasDocument: true,
    photoshopConnected: true
  });
  let noToolModelCalls = 0;
  let noToolExecutorCalls = 0;
  const noToolAgent = new Agent(
    noToolConfig,
    async () => {
      noToolModelCalls += 1;
      if (noToolModelCalls === 1) {
        return {
          toolCalls: [{
            id: 'blocked-create-rectangle',
            name: 'createRectangle',
            arguments: { x: 0, y: 0, width: 20, height: 20 }
          }]
        };
      }
      return { content: '主图已完成，请审阅。', stopReason: 'end_turn' };
    },
    async () => {
      noToolExecutorCalls += 1;
      return { success: true };
    }
  );
  const noToolResult = await noToolAgent.run('你好');
  assert.strictEqual(noToolModelCalls, 2);
  assert.strictEqual(noToolExecutorCalls, 0);
  assert.strictEqual(noToolResult.success, false);
  assert.strictEqual(noToolResult.error, 'unsupported_bare_completion_claim');
  assert.strictEqual(noToolResult.message, expectedMessage);

  let readOnlyModelCalls = 0;
  const readOnlyBareAgent = new Agent(
    buildAgentTestConfig({
      tools: [requireAgentTool('getDocumentInfo')],
      maxIterations: 3,
      openingCanvasObservationMode: 'none'
    }),
    async () => {
      readOnlyModelCalls += 1;
      if (readOnlyModelCalls === 1) {
        return {
          toolCalls: [{ id: 'bare-claim-read', name: 'getDocumentInfo', arguments: {} }]
        };
      }
      return { content: '检查搞定咯，请查看。', stopReason: 'end_turn' };
    },
    async () => buildDocumentObservation()
  );
  const readOnlyBareResult = await readOnlyBareAgent.run('检查当前文档并告诉我结果');
  assert.strictEqual(readOnlyBareResult.success, false);
  assert.strictEqual(readOnlyBareResult.error, 'unsupported_bare_completion_claim');
  assert.strictEqual(readOnlyBareResult.message, expectedMessage);

  for (const [task, content] of [
    ['现在可以开始讨论字体搭配了吗？', '可以了。'],
    ['你现在状态好了吗？', '好了。'],
    ['给我一份字体搭配方案', '字体搭配建议：标题使用粗黑体，正文使用中性无衬线体。']
  ]) {
    const responseAgent = new Agent(
      buildAgentTestConfig({
        tools: [],
        maxIterations: 1,
        openingCanvasObservationMode: 'none'
      }),
      async () => ({ content, stopReason: 'end_turn' }),
      async () => {
        throw new Error('substantive text fixture must not execute Tools');
      }
    );
    const responseResult = await responseAgent.run(task);
    assert.strictEqual(responseResult.success, true, `${task} was mistaken for a bare completion claim`);
    assert.strictEqual(responseResult.message, content);
  }
}

/**
 * 治理切片 2（执行供给预留）纯账本断言：预留区边界、写入前观察 allowance、
 * 超限观察转执行指令、交付动作尝试后开闸、硬预算耗尽兜底。
 */
function assertExecutionSupplyReservePureAccounting() {
  const budget = {
    maxModelCalls: 16,
    maxToolCalls: 50,
    maxVisionCandidates: 6,
    maxVisualAnalyses: 2,
    maxFullResolutionImageReads: 0,
    softTimeBudgetMs: 300_000
  };
  assert.strictEqual(
    resolveExecutionSupplyReserve(budget),
    6,
    'reserve must be min(fixed cap, 20% of tool budget)'
  );
  assert.strictEqual(resolveExecutionSupplyReserve(undefined), 0);
  assert.strictEqual(
    isInMutationExecutionReserveZone({
      ledger: createPerformanceLedgerState(),
      budget,
      authorizedMutationExpectation: false
    }),
    false,
    'unauthorized runs must never enter the reserve zone'
  );

  const ledger = createPerformanceLedgerState();
  ledger.toolCallCount = 44;
  assert.strictEqual(
    isInMutationExecutionReserveZone({ ledger, budget, authorizedMutationExpectation: true }),
    true
  );

  const reserveContext = {
    authorizedMutationExpectation: true,
    attemptedDeliveryAction: false,
    reservesFinalQualityJudge: false,
    hasObservedTaskMutation: false
  };
  const firstRead = consumePerformanceToolCallBudget({
    ledger,
    budget,
    reserveContext,
    toolName: 'getLayerHierarchy',
    toolArguments: {}
  });
  assert.strictEqual(firstRead, undefined, 'first reserve-zone observation must pass for read-before-write');
  const secondRead = consumePerformanceToolCallBudget({
    ledger,
    budget,
    reserveContext,
    toolName: 'getCanvasSnapshot',
    toolArguments: {}
  });
  assert.strictEqual(secondRead, undefined, 'second reserve-zone observation must pass');
  // GATE-SIMPLIFY-001：allowance 由 2 放宽到 4——真实读后写准备序列需要 3-4 次写入前读取，
  // 第三、四次观察必须放行，只有超出 allowance 的第五次才转为执行指令。
  const thirdRead = consumePerformanceToolCallBudget({
    ledger,
    budget,
    reserveContext,
    toolName: 'getLayerBounds',
    toolArguments: {}
  });
  assert.strictEqual(thirdRead, undefined, 'third reserve-zone observation must pass (allowance 4)');
  const fourthRead = consumePerformanceToolCallBudget({
    ledger,
    budget,
    reserveContext,
    toolName: 'getDocumentInfo',
    toolArguments: {}
  });
  assert.strictEqual(fourthRead, undefined, 'fourth reserve-zone observation must pass (allowance 4)');
  // 设计路径宪法（2026-08-17）：超出 allowance 的观察**不再被拦截**——照常执行、照常记账，
  // 账本只生成一次「该动手了」提醒交给模型（拦「看多了」必须降级为提示）。
  assert.strictEqual(ledger.observationReserveAdviceDue, false, 'no advice before allowance is exceeded');
  const excessRead = consumePerformanceToolCallBudget({
    ledger,
    budget,
    reserveContext,
    toolName: 'getLayerHierarchy',
    toolArguments: {}
  });
  assert.strictEqual(excessRead, undefined, 'excess reserve-zone observation must still execute (advisory, not a gate)');
  assert.strictEqual(ledger.toolCallCount, 49, 'executed observation consumes tool budget');
  assert.strictEqual(ledger.observationReserveAdviceDue, true, 'excess observation must schedule the one-time advice');
  const advice = takeObservationReserveAdvice(ledger);
  assert(advice && advice.includes('直接'), 'advice must tell the model it can start writing now');
  assert.strictEqual(takeObservationReserveAdvice(ledger), null, 'advice is taken exactly once');

  const writeAttempt = consumePerformanceToolCallBudget({
    ledger,
    budget,
    reserveContext,
    toolName: 'renameLayer',
    toolArguments: { layerId: 1 }
  });
  assert.strictEqual(writeAttempt, undefined, 'write-class tools must pass the reserve gate');
  // 写后读回必须永远放行：另起一本未耗尽的账本，避免与上面「观察照常记账」的硬预算耗尽混淆。
  const postAttemptLedger = createPerformanceLedgerState();
  postAttemptLedger.toolCallCount = 49;
  const readAfterAttempt = consumePerformanceToolCallBudget({
    ledger: postAttemptLedger,
    budget,
    reserveContext: { ...reserveContext, attemptedDeliveryAction: true },
    toolName: 'getLayerHierarchy',
    toolArguments: {}
  });
  assert.strictEqual(readAfterAttempt, undefined, 'post-delivery-attempt readback must always pass');

  // GATE-SIMPLIFY-001：合并后的写前观察总次数上限（6 次调用）独立于预留区生效——
  // 原 agent.ts 轮级守卫的职责已并入账本单一 owner，同一指令码、不再依赖预算尾部。
  const totalLimitLedger = createPerformanceLedgerState();
  for (let index = 0; index < 6; index += 1) {
    const read = consumePerformanceToolCallBudget({
      ledger: totalLimitLedger,
      budget,
      reserveContext,
      toolName: 'getDocumentInfo',
      toolArguments: {}
    });
    assert.strictEqual(
      read,
      undefined,
      `pre-delivery observation #${index + 1} must pass under the merged total limit of 6`
    );
  }
  const overLimitRead = consumePerformanceToolCallBudget({
    ledger: totalLimitLedger,
    budget,
    reserveContext,
    toolName: 'getDocumentInfo',
    toolArguments: {}
  });
  assert.strictEqual(overLimitRead, undefined, 'seventh pre-delivery observation still executes (advisory only)');
  assert.strictEqual(
    totalLimitLedger.toolCallCount,
    7,
    'executed observation consumes tool budget'
  );
  assert.strictEqual(totalLimitLedger.observationReserveAdviceDue, true, 'total limit schedules the one-time advice');
  assert(takeObservationReserveAdvice(totalLimitLedger), 'advice can be taken once');
  const eighthRead = consumePerformanceToolCallBudget({
    ledger: totalLimitLedger,
    budget,
    reserveContext,
    toolName: 'getDocumentInfo',
    toolArguments: {}
  });
  assert.strictEqual(eighthRead, undefined, 'later observations still execute');
  assert.strictEqual(totalLimitLedger.observationReserveAdviceDue, false, 'advice is issued at most once per run');

  const exhaustedLedger = createPerformanceLedgerState();
  exhaustedLedger.toolCallCount = 50;
  const exhaustion = consumePerformanceToolCallBudget({
    ledger: exhaustedLedger,
    budget,
    reserveContext,
    toolName: 'getDocumentInfo',
    toolArguments: {}
  });
  assert(exhaustion, 'hard tool budget must still stop all calls');
  assert.strictEqual(exhaustion.code, 'agent_tool_call_budget_exhausted');
}

/**
 * 治理切片 1（完成所有权前移）真实循环断言：已授权写入的运行零业务动作停话时，
 * 必须被完成契约有界推回，推回耗尽后诚实停止（plan_execution_mismatch），
 * 不允许吞成 final_response。
 */
async function assertZeroProgressWriteAuthorizedStopIsPushedBackAndEndsHonestly() {
  const tools = [requireAgentTool('getDocumentInfo')];
  let modelCallCount = 0;
  let observedContractRemediationCount = 0;
  const agent = new Agent(
    buildAgentTestConfig({
      tools,
      maxIterations: 10,
      openingCanvasObservationMode: 'none'
    }),
    async (_modelId, messages) => {
      modelCallCount += 1;
      for (const message of messages) {
        if (JSON.stringify(message).includes('task-completion-remediation')) {
          observedContractRemediationCount += 1;
        }
      }
      return { content: '我先看了一下现状，暂时只能先到这里。', stopReason: 'end_turn' };
    },
    async () => {
      throw new Error('zero-progress fixture must not execute Tools');
    }
  );
  const result = await agent.run('帮我做SKU');
  assert.strictEqual(result.success, false, 'zero-write stop must not report success');
  assert.strictEqual(
    result.stopReason,
    'plan_execution_mismatch',
    'zero-write stop must end honestly instead of final_response'
  );
  assert.strictEqual(result.error, 'completion_contract_unsatisfied_zero_progress');
  assert(modelCallCount >= 3, `expected bounded push-back rounds, saw ${modelCallCount} model calls`);
  assert(
    observedContractRemediationCount >= 1,
    'the model must receive the completion-gap directive before the honest stop'
  );
}

/**
 * 治理切片 2（执行供给预留）真实循环断言（GATE-SIMPLIFY-001 合并后的契约）：
 * 已授权写入且零交付动作的运行，写前观察限量由账本单一 owner 承载——
 * 总次数上限 6 次调用（不再按轮），超过即转执行指令且不真正执行；
 * 预留区小于 allowance 时不得误拦。
 */
async function assertExecutionSupplyReserveGatesObservationInLiveLoop() {
  // 场景 A：6 次写前观察（新契约总上限内）全部放行，不产生任何执行指令。
  {
    const tools = [requireAgentTool('getLayerBounds')];
    let executedReads = 0;
    let readRequests = 0;
    let observedReserveDirectiveCount = 0;
    const agent = new Agent(
      buildAgentTestConfig({
        tools,
        maxIterations: 30,
        openingCanvasObservationMode: 'none',
        performanceBudget: {
          maxModelCalls: 30,
          maxToolCalls: 15,
          maxVisionCandidates: 0,
          maxVisualAnalyses: 0,
          maxFullResolutionImageReads: 0,
          softTimeBudgetMs: 300_000
        }
      }),
      async (_modelId, messages) => {
        readRequests += 1;
        for (const message of messages) {
          if (JSON.stringify(message).includes('agent_observation_budget_reserved')) {
            observedReserveDirectiveCount += 1;
          }
        }
        if (readRequests <= 6) {
          return {
            toolCalls: [{
              id: `reserve-read-${readRequests}`,
              name: 'getLayerBounds',
              arguments: { layerId: readRequests }
            }]
          };
        }
        return { content: '就到这里。', stopReason: 'end_turn' };
      },
      async (toolName) => {
        assert.strictEqual(toolName, 'getLayerBounds');
        executedReads += 1;
        return { success: true, bounds: { left: 0, top: 0, right: 10, bottom: 10 } };
      }
    );
    await agent.run('帮我做SKU');
    assert.strictEqual(
      executedReads,
      6,
      `merged total limit (6) must allow a full read-before-write preparation sequence, saw ${executedReads}`
    );
    assert.strictEqual(
      observedReserveDirectiveCount,
      0,
      'no execution directive may fire within the merged total limit'
    );
  }

  // 场景 B（设计路径宪法 2026-08-17）：第 7 次及之后的写前观察**照常执行**——观察超限是
  // 「看多了」不是「做错」，只允许提醒不允许拦截。账本在超限那一轮向模型发**一次**
  // 「该动手了」提醒（harness control message，source=observation-reserve-advice），
  // 之后不再重复；运行不得因观察次数本身停机。
  {
    const tools = [requireAgentTool('getLayerBounds')];
    let executedReads = 0;
    let readRequests = 0;
    let maxAdviceMessagesInOneCall = 0;
    const agent = new Agent(
      buildAgentTestConfig({
        tools,
        maxIterations: 30,
        openingCanvasObservationMode: 'none',
        performanceBudget: {
          maxModelCalls: 30,
          maxToolCalls: 15,
          maxVisionCandidates: 0,
          maxVisualAnalyses: 0,
          maxFullResolutionImageReads: 0,
          softTimeBudgetMs: 300_000
        }
      }),
      async (_modelId, messages) => {
        readRequests += 1;
        const adviceMessages = messages.filter((message) => (
          message?.contextMetadata?.source === 'observation-reserve-advice'
        )).length;
        maxAdviceMessagesInOneCall = Math.max(maxAdviceMessagesInOneCall, adviceMessages);
        for (const message of messages) {
          assert(
            !JSON.stringify(message).includes('agent_observation_budget_reserved'),
            'observation reserve must never surface as a blocking directive code'
          );
        }
        if (readRequests <= 8) {
          return {
            toolCalls: [{
              id: `reserve-read-${readRequests}`,
              name: 'getLayerBounds',
              arguments: { layerId: readRequests }
            }]
          };
        }
        return { content: '就到这里。', stopReason: 'end_turn' };
      },
      async (toolName) => {
        assert.strictEqual(toolName, 'getLayerBounds');
        executedReads += 1;
        return { success: true, bounds: { left: 0, top: 0, right: 10, bottom: 10 } };
      }
    );
    await agent.run('帮我做SKU');
    assert.strictEqual(
      executedReads,
      8,
      `observations beyond the pre-delivery limit must still execute (advisory only), saw ${executedReads} of ${readRequests}`
    );
    assert.strictEqual(
      maxAdviceMessagesInOneCall,
      1,
      `the "start writing" advice must reach the model exactly once, saw ${maxAdviceMessagesInOneCall}`
    );
  }
}

/**
 * 治理护栏反面断言（防 07-31 门禁事故复发）：聊天、只读分析、计划类请求
 * 不得进入完成推回或执行供给预留——它们没有写入授权，也不得因此被饿死。
 */
async function assertChatReadOnlyAndPlanRequestsNeverEnterGovernanceGates() {
  const chatOnlyIntent = {
    ...buildAutonomousExecutionDecisionForEngine('guard-audit'),
    requestKind: 'chat_only',
    toolScope: 'none',
    executionAuthorization: 'none'
  };
  const readOnlyIntent = {
    ...buildAutonomousExecutionDecisionForEngine('guard-audit'),
    requestKind: 'read_only_inspect',
    toolScope: 'read_only'
  };
  const planOnlyIntent = {
    ...buildAutonomousExecutionDecisionForEngine('guard-audit'),
    requestKind: 'plan_only',
    toolScope: 'none',
    executionAuthorization: 'none'
  };

  let chatRemediationCount = 0;
  const chatProgressMessages = [];
  const chatAgent = new Agent(
    buildAgentTestConfig({
      tools: [],
      maxIterations: 3,
      openingCanvasObservationMode: 'none',
      intentControlPlane: chatOnlyIntent,
      callbacks: { onMessage: (message) => chatProgressMessages.push(message) }
    }),
    async (_modelId, messages) => {
      for (const message of messages) {
        if (JSON.stringify(message).includes('task-completion-remediation')) {
          chatRemediationCount += 1;
        }
      }
      return { content: '可以了。', stopReason: 'end_turn' };
    },
    async () => {
      throw new Error('chat fixture must not execute Tools');
    }
  );
  const chatResult = await chatAgent.run('你好');
  assert.strictEqual(chatResult.success, true, 'chat reply must succeed untouched');
  assert.strictEqual(chatResult.stopReason, 'final_response', 'chat must end as a plain final response');
  assert.strictEqual(chatResult.message, '可以了。', 'chat final text must still be delivered through result.message');
  assert.deepStrictEqual(
    chatProgressMessages,
    [],
    'plain chat final text must not be duplicated through the pre-settlement progress callback'
  );
  assert.strictEqual(chatRemediationCount, 0, 'chat must never receive completion remediation');

  let readOnlyRemediationCount = 0;
  let readOnlyReads = 0;
  let readOnlyModelCalls = 0;
  const readOnlyAgent = new Agent(
    buildAgentTestConfig({
      tools: [requireAgentTool('getDocumentInfo')],
      maxIterations: 4,
      openingCanvasObservationMode: 'none',
      intentControlPlane: readOnlyIntent
    }),
    async (_modelId, messages) => {
      readOnlyModelCalls += 1;
      for (const message of messages) {
        if (JSON.stringify(message).includes('task-completion-remediation')) {
          readOnlyRemediationCount += 1;
        }
      }
      if (readOnlyModelCalls === 1) {
        return {
          toolCalls: [{ id: 'guard-read-doc', name: 'getDocumentInfo', arguments: {} }]
        };
      }
      return { content: '文档状态正常，检查完成。', stopReason: 'end_turn' };
    },
    async (toolName) => {
      assert.strictEqual(toolName, 'getDocumentInfo');
      readOnlyReads += 1;
      return buildDocumentObservation();
    }
  );
  const readOnlyResult = await readOnlyAgent.run('检查当前文档并告诉我结果');
  assert.strictEqual(readOnlyReads, 1, 'read-only inspection must execute its read');
  assert(
    readOnlyResult.stopReason !== 'plan_execution_mismatch',
    'read-only inspection must not be pushed back'
  );
  assert.strictEqual(readOnlyRemediationCount, 0, 'read-only inspection must never receive completion remediation');

  // 只读分析不得被执行供给预留饿死：同一预算形状下，观察全部放行。
  let inspectReads = 0;
  let inspectModelCalls = 0;
  let inspectReserveDirectiveCount = 0;
  const inspectAgent = new Agent(
    buildAgentTestConfig({
      tools: [requireAgentTool('getLayerBounds')],
      maxIterations: 20,
      openingCanvasObservationMode: 'none',
      intentControlPlane: readOnlyIntent,
      performanceBudget: {
        maxModelCalls: 20,
        maxToolCalls: 15,
        maxVisionCandidates: 0,
        maxVisualAnalyses: 0,
        maxFullResolutionImageReads: 0,
        softTimeBudgetMs: 300_000
      }
    }),
    async (_modelId, messages) => {
      inspectModelCalls += 1;
      for (const message of messages) {
        if (JSON.stringify(message).includes('agent_observation_budget_reserved')
          || message?.contextMetadata?.source === 'observation-reserve-advice') {
          inspectReserveDirectiveCount += 1;
        }
      }
      if (inspectModelCalls <= 14) {
        return {
          toolCalls: [{
            id: `inspect-read-${inspectModelCalls}`,
            name: 'getLayerBounds',
            arguments: { layerId: inspectModelCalls }
          }]
        };
      }
      return { content: '图层结构检查完成。', stopReason: 'end_turn' };
    },
    async (toolName) => {
      assert.strictEqual(toolName, 'getLayerBounds');
      inspectReads += 1;
      return { success: true, bounds: { left: 0, top: 0, right: 10, bottom: 10 } };
    }
  );
  await inspectAgent.run('请检查当前文档的图层结构并汇报');
  assert.strictEqual(
    inspectReads,
    14,
    `read-only analysis must never be starved by the reserve zone (executed ${inspectReads})`
  );
  assert.strictEqual(
    inspectReserveDirectiveCount,
    0,
    'read-only analysis must never receive the execution directive or the start-writing advice'
  );

  let planRemediationCount = 0;
  const planAgent = new Agent(
    buildAgentTestConfig({
      tools: [],
      maxIterations: 3,
      openingCanvasObservationMode: 'none',
      intentControlPlane: planOnlyIntent
    }),
    async (_modelId, messages) => {
      for (const message of messages) {
        if (JSON.stringify(message).includes('task-completion-remediation')) {
          planRemediationCount += 1;
        }
      }
      return { content: '先这样规划，稍后细化。', stopReason: 'end_turn' };
    },
    async () => {
      throw new Error('plan fixture must not execute Tools');
    }
  );
  const planResult = await planAgent.run('帮我规划一下主图方案');
  assert.strictEqual(planResult.stopReason, 'final_response', 'plan-only request must end as a plain final response');
  assert.strictEqual(planRemediationCount, 0, 'plan-only request must never receive completion remediation');
}

/**
 * Tool 结果中的 nextRequiredToolOptions 只报告可行出口，不取得下一轮规划权。
 * 写保护仍由执行点硬拦，但 Agent 必须保留完整能力面，自主选择切换、打开、新建、
 * 补充观察或向用户确认，不能被下游补偿逻辑锁进恢复 allowlist。
 */
async function assertToolResultRecoveryOptionsDoNotConstrainAgentToolChoice() {
  let modelCallCount = 0;
  let secondTurnToolNames = [];
  const agent = new Agent(
    buildAgentTestConfig({
      tools: [
        requireAgentTool('switchDocument'),
        requireAgentTool('openProjectFile'),
        requireAgentTool('createDocument'),
        requireAgentTool('getDocumentInfo'),
        requireAgentTool('getCanvasSnapshot')
      ],
      maxIterations: 3,
      openingCanvasObservationMode: 'none'
    }),
    async (_modelId, _messages, visibleTools) => {
      modelCallCount += 1;
      if (modelCallCount === 1) {
        return {
          toolCalls: [{
            id: 'protected-write-observation',
            name: 'getDocumentInfo',
            arguments: {}
          }]
        };
      }
      if (modelCallCount === 2) {
        secondTurnToolNames = visibleTools.map((tool) => tool.name);
      }
      return { content: '当前目标受保护，我会根据任务目标重新选择安全路线。', stopReason: 'end_turn' };
    },
    async (toolName) => {
      assert.strictEqual(toolName, 'getDocumentInfo');
      return {
        success: false,
        policyGate: true,
        code: 'current_document_write_protected',
        message: '用户明确要求保护当前文档「详情页.psb」，已阻止对它执行修改、保存或导出。',
        error: '用户明确要求保护当前文档「详情页.psb」，已阻止对它执行修改、保存或导出。',
        nextRequiredTool: 'switchDocument',
        nextRequiredToolOptions: ['switchDocument', 'openProjectFile', 'createDocument'],
        nextRequiredToolReason: '当前结果只报告安全出口，不替 Agent 选择下一步。'
      };
    }
  );
  await agent.run('检查受保护文档并决定安全的后续路线');
  assert(modelCallCount >= 2, 'Tool result recovery context did not reach the next Agent decision');
  assert(
    secondTurnToolNames.includes('getCanvasSnapshot'),
    `Tool result options incorrectly removed unrelated observation capability: ${JSON.stringify(secondTurnToolNames)}`
  );
  assert(secondTurnToolNames.includes('switchDocument'), 'Tool result options hid a valid target-switch capability');
  assert(secondTurnToolNames.includes('openProjectFile'), 'Tool result options hid a valid target-open capability');
  assert(secondTurnToolNames.includes('createDocument'), 'Tool result options hid a valid target-create capability');
}

/**
 * R3 通用方向探索契约：多方向只在模型认为存在开放创意不确定性时可选提交，
 * 不把确定性工作强制成多候选，也不允许 Harness 默认选择第一项或据此授予完成信用。
 */
function assertDesignDirectionExplorationIsOptionalAndNonAuthoritative() {
  const contextRef = 'context:design-brief';
  const baseStrategy = {
    stageGoal: '形成可执行的视觉表达方向',
    objective: {
      primaryGoal: '突出商品质感与核心卖点',
      secondaryGoals: ['保持信息清晰'],
      targetAudienceSummary: '重视舒适感与审美一致性的消费者'
    },
    messageArchitecture: {
      primaryMessage: '舒适与精致可以同时成立',
      supportingMessages: ['材质观感柔和', '信息层级简洁'],
      supportingFacts: ['用户提供了商品素材'],
      objectionsToResolve: []
    },
    copyDirection: {
      toneKeywords: ['自然', '克制'],
      headlineOptions: ['把舒适穿进日常'],
      subtitleOptions: [],
      tagOptions: [],
      prohibitedClaims: []
    },
    visualDirection: {
      moodKeywords: ['温暖', '轻盈'],
      paletteIntent: ['低饱和暖色为主'],
      typographyIntent: ['标题明确，辅助信息克制'],
      compositionIntent: ['商品主体成为第一视觉焦点'],
      imageTreatment: ['保留真实材质细节'],
      density: 'low'
    },
    constraints: ['不得虚构商品事实'],
    contextRefs: [contextRef],
    assumptions: [],
    missingInputs: []
  };
  const schema = buildDeclareDesignStrategyToolSchema([contextRef]);
  for (const optionalField of [
    'directionExploration',
    'selectedDirectionId',
    'selectionRationale'
  ]) {
    assert(
      schema.inputSchema.properties[optionalField],
      `R3 schema is missing optional field ${optionalField}`
    );
    assert(
      !schema.inputSchema.required.includes(optionalField),
      `R3 direction field ${optionalField} must not become a hard prerequisite`
    );
  }
  assert.strictEqual(schema.inputSchema.properties.directionExploration.minItems, 2);
  assert.strictEqual(schema.inputSchema.properties.directionExploration.maxItems, 3);

  const singleDirection = validateRuntimeDesignStrategyDeclaration({
    value: baseStrategy,
    allowedContextRefs: [contextRef]
  });
  assert.strictEqual(singleDirection.ok, true, 'a clear single direction must remain valid');
  assert.strictEqual(singleDirection.readiness, 'ready');
  assert(singleDirection.declaration);
  assert.strictEqual(singleDirection.declaration.payload.directionExploration, undefined);
  assert.strictEqual(singleDirection.declaration.payload.selectedDirectionId, undefined);

  const directionExploration = [
    {
      variantId: 'warm-editorial',
      label: '温暖编辑感',
      intent: '以生活方式氛围承接舒适感',
      messageOverride: '让日常舒适更有质感',
      visualOverride: ['暖色留白', '自然光感']
    },
    {
      variantId: 'clean-product',
      label: '清爽商品感',
      intent: '以清晰商品信息建立购买信心'
    }
  ];
  const explorationOnly = validateRuntimeDesignStrategyDeclaration({
    value: {
      ...baseStrategy,
      directionExploration
    },
    allowedContextRefs: [contextRef]
  });
  assert.strictEqual(
    explorationOnly.ok,
    false,
    'an explored direction set without an explicit selection must not become ready'
  );
  assert.strictEqual(explorationOnly.readiness, 'invalid');
  assert.strictEqual(explorationOnly.declaration, undefined);
  assert.strictEqual(
    explorationOnly.issues.some((issue) => (
      issue.code === 'selected_direction_required'
      && issue.path === 'selectedDirectionId'
    )),
    true,
    'Harness must require the model to select without defaulting to the first direction'
  );

  const selectedDirection = validateRuntimeDesignStrategyDeclaration({
    value: {
      ...baseStrategy,
      directionExploration,
      selectedDirectionId: 'clean-product',
      selectionRationale: '当前素材更适合让商品细节与信息效率优先。'
    },
    allowedContextRefs: [contextRef]
  });
  assert.strictEqual(selectedDirection.ok, true, 'a selected explored direction must validate');
  assert(selectedDirection.declaration);
  assert.strictEqual(selectedDirection.declaration.payload.selectedDirectionId, 'clean-product');
  assert.strictEqual(
    selectedDirection.declaration.boundaries.grantsPermission,
    false,
    'direction selection must not grant execution permission'
  );
  assert.strictEqual(
    selectedDirection.declaration.boundaries.countsAsTaskProgress,
    false,
    'direction selection must not count as task progress'
  );
  assert.strictEqual(
    selectedDirection.declaration.boundaries.countsAsQualityPass,
    false,
    'direction selection must not count as a quality pass'
  );
  assert.strictEqual(selectedDirection.declaration.boundaries.categoryNeutral, true);
  const selectedDigest = buildRuntimeDesignStrategyDigest(selectedDirection.declaration);
  assert.strictEqual(selectedDigest.directionExploration.length, 2);
  assert.strictEqual(selectedDigest.selectedDirectionId, 'clean-product');
  assert.strictEqual(
    selectedDigest.selectionRationale,
    '当前素材更适合让商品细节与信息效率优先。'
  );
  assert.strictEqual(
    selectedDigest.boundaries.changesTaskResult,
    false,
    'persisted direction context must remain non-authoritative'
  );

  const incompleteExploration = validateRuntimeDesignStrategyDeclaration({
    value: {
      ...baseStrategy,
      directionExploration: [
        {
          variantId: 'only-one',
          label: '唯一方向',
          intent: '这不是有效的多方向探索'
        }
      ]
    },
    allowedContextRefs: [contextRef]
  });
  assert.strictEqual(
    incompleteExploration.ok,
    false,
    'opting into exploration requires an actual 2–3 direction comparison set'
  );
  assert(
    incompleteExploration.issues.some((issue) => (
      issue.code === 'direction_variants_missing'
      && issue.path === 'directionExploration'
    )),
    'an incomplete exploration set must produce a stable validation issue'
  );

  const unknownSelection = validateRuntimeDesignStrategyDeclaration({
    value: {
      ...baseStrategy,
      directionExploration,
      selectedDirectionId: 'not-a-candidate'
    },
    allowedContextRefs: [contextRef]
  });
  assert.strictEqual(unknownSelection.ok, false, 'selection must reference a submitted direction');
  assert(
    unknownSelection.issues.some((issue) => (
      issue.code === 'selected_direction_not_found'
      && issue.path === 'selectedDirectionId'
    )),
    'unknown selectedDirectionId must produce a stable validation issue'
  );
}

/**
 * 治理切片 2（GATE-SIMPLIFY-002）：纯「看看这个链接的设计」评审问句不得命中写入授权——
 * 真机 run#242 曾因它被推回 plan_execution_mismatch；复合委托（看看…然后照着做）不受影响。
 */
async function assertLinkReviewRequestsStayReadOnly() {
  const pureReview = buildAgentIntentControlPlaneDecision({
    userInput: '你帮我看看这个淘宝链接的设计 https://item.taobao.com/item.htm?id=927423493569',
    hasImageInput: false,
    hasDocument: true,
    photoshopConnected: true
  });
  assert.strictEqual(
    pureReview.requestKind,
    'read_only_inspect',
    'a pure link-review question must be classified as read-only inspection'
  );
  assert.notStrictEqual(
    pureReview.toolScope,
    'write_photoshop',
    'link review must never mint write scope'
  );

  const noUrlReview = buildAgentIntentControlPlaneDecision({
    userInput: '帮我看看这个链接的设计怎么样',
    hasImageInput: false,
    hasDocument: true,
    photoshopConnected: true
  });
  assert.strictEqual(
    noUrlReview.requestKind,
    'read_only_inspect',
    'a link-review question without a raw URL must still be read-only inspection'
  );

  const compoundDelegation = buildAgentIntentControlPlaneDecision({
    userInput: '帮我看看这个淘宝链接的设计，然后照着做一张主图 https://item.taobao.com/item.htm?id=927423493569',
    hasImageInput: false,
    hasDocument: true,
    photoshopConnected: true
  });
  assert.strictEqual(
    compoundDelegation.requestKind,
    'autonomous_execution',
    'a compound "review the link then design from it" request must keep execution authorization'
  );

  // 循环级回归：零写入的链接评审运行不得被完成契约推回（run#242 回归）。
  const intentControlPlane = buildAgentIntentControlPlaneDecision({
    userInput: '帮我看看这个淘宝链接的设计',
    hasImageInput: false,
    hasDocument: true,
    photoshopConnected: true
  });
  const reviewConfig = buildAgentTestConfig({
    tools: [requireAgentTool('getDocumentInfo')],
    maxIterations: 4,
    openingCanvasObservationMode: 'none'
  });
  reviewConfig.toolDecisionContext.intentControlPlane = intentControlPlane;
  let reviewModelCalls = 0;
  const reviewAgent = new Agent(
    reviewConfig,
    async () => {
      reviewModelCalls += 1;
      if (reviewModelCalls === 1) {
        return {
          toolCalls: [{ id: 'link-review-read-1', name: 'getDocumentInfo', arguments: {} }]
        };
      }
      return { content: '我先看一下这个链接的页面，再给你分析要点。', stopReason: 'end_turn' };
    },
    async () => buildDocumentObservation()
  );
  const reviewResult = await reviewAgent.run('帮我看看这个淘宝链接的设计');
  assert.notStrictEqual(
    reviewResult.stopReason,
    'plan_execution_mismatch',
    'a zero-write link-review run must never be pushed back as an unfinished production task'
  );
  assert.notStrictEqual(
    reviewResult.error,
    'completion_contract_unsatisfied_zero_progress',
    'the completion contract must not treat link review as zero progress on a write task'
  );
}

/**
 * 终局质量 Judge 不进入可跨代恢复的普通任务预算；真正到终审时拥有独立的一次调用机会，
 * 避免普通额度刚好用满后无法验收修订稿。物理软时限仍共享，Judge 仍只允许一次。
 */
function assertFinalQualityJudgeReservationRemovedButHardCapStays() {
  const budget = {
    maxModelCalls: 4,
    maxToolCalls: 50,
    maxVisionCandidates: 6,
    maxVisualAnalyses: 2,
    maxFullResolutionImageReads: 0,
    softTimeBudgetMs: 300_000
  };
  // 纯账本：模型调用数达到 budget-1 时，普通任务预算不得再提前判耗尽（旧契约会扣 1）。
  const ledger = createPerformanceLedgerState();
  ledger.modelCallCount = 3;
  assert.strictEqual(
    readPerformanceBudgetExhaustion({
      ledger,
      budget,
      elapsedMs: 1000,
      scope: 'model',
      hasObservedTaskMutation: false
    }),
    undefined,
    'task-class model budget must no longer be pre-deducted for the final quality judge'
  );

  // 普通池已用 5 个候选时仍可发终审图片；终审只记 generation-local hard cap，
  // 不得污染下一 generation 恢复的普通模型、候选、分析或 evidence keys。
  const config = buildAgentTestConfig({
    tools: [requireAgentTool('getDocumentInfo')],
    maxIterations: 2,
    openingCanvasObservationMode: 'none'
  });
  config.performanceBudget = budget;
  const agent = new Agent(
    config,
    async () => ({ content: 'x', stopReason: 'end_turn' }),
    async () => buildDocumentObservation()
  );
  agent.performanceLedger.modelCallCount = config.performanceBudget.maxModelCalls;
  agent.performanceLedger.visionCandidateCount = 5;
  agent.beginPerformanceModelCall(
    true,
    'final_quality_judge',
    1,
    ['judge-critical-image'],
    true
  );
  assert.strictEqual(
    agent.performanceLedger.modelCallCount,
    config.performanceBudget.maxModelCalls,
    'the dedicated final judge must remain callable after ordinary model-call budget exhaustion'
  );
  assert.deepStrictEqual({
    candidates: agent.performanceLedger.visionCandidateCount,
    analyses: agent.performanceLedger.visualAnalysisCount,
    judges: agent.performanceLedger.finalQualityJudgeCallCount
  }, { candidates: 5, analyses: 0, judges: 1 },
  'the image-bearing Judge must not contaminate the cross-generation ordinary vision pool');
  let secondJudgeRejected = false;
  try {
    agent.beginPerformanceModelCall(true, 'final_quality_judge', 1, ['judge-second-image'], true);
  } catch (error) {
    secondJudgeRejected = error && error.code === 'agent_final_quality_judge_budget_exhausted';
  }
  assert(secondJudgeRejected, 'the one-call hard cap on the final quality judge must remain');
  agent.beginPerformanceModelCall(
    true,
    'final_quality_diagnosis_repair',
    1,
    ['judge-critical-image'],
    true
  );
  assert.deepStrictEqual({
    candidates: agent.performanceLedger.visionCandidateCount,
    analyses: agent.performanceLedger.visualAnalysisCount,
    judges: agent.performanceLedger.finalQualityJudgeCallCount,
    repairs: agent.performanceLedger.finalQualityDiagnosisRepairCallCount
  }, { candidates: 5, analyses: 0, judges: 1, repairs: 1 },
  'the one-shot repair allowance must remain reachable without charging the ordinary vision pool');

  const overflowAgent = new Agent(
    config,
    async () => ({ content: 'x', stopReason: 'end_turn' }),
    async () => buildDocumentObservation()
  );
  overflowAgent.performanceLedger.visionCandidateCount = 5;
  const oversizedFinalJudgeKeys = Array.from(
    { length: budget.maxVisionCandidates + 1 },
    (_, index) => `judge-overflow-${index + 1}`
  );
  assert.throws(
    () => overflowAgent.beginPerformanceModelCall(
      true,
      'final_quality_judge',
      oversizedFinalJudgeKeys.length,
      oversizedFinalJudgeKeys,
      true
    ),
    (error) => error && error.code === 'agent_vision_candidate_budget_exhausted',
    'a Judge presentation must not exceed its own per-event candidate hard limit'
  );
  assert.deepStrictEqual({
    candidates: overflowAgent.performanceLedger.visionCandidateCount,
    analyses: overflowAgent.performanceLedger.visualAnalysisCount,
    judges: overflowAgent.performanceLedger.finalQualityJudgeCallCount
  }, { candidates: 5, analyses: 0, judges: 0 }, 'a rejected Judge must not partially charge the ledger');

  const repairBudget = {
    ...budget,
    maxVisionCandidates: 8,
    maxVisualAnalyses: 4
  };
  const repairConfig = buildAgentTestConfig({
    tools: [requireAgentTool('getDocumentInfo')],
    maxIterations: 2,
    openingCanvasObservationMode: 'none'
  });
  repairConfig.performanceBudget = repairBudget;
  const orphanRepairAgent = new Agent(
    repairConfig,
    async () => ({ content: 'x', stopReason: 'end_turn' }),
    async () => buildDocumentObservation()
  );
  assert.throws(
    () => orphanRepairAgent.beginPerformanceModelCall(
      true,
      'final_quality_diagnosis_repair',
      1,
      ['orphan-repair-fixture'],
      true
    ),
    (error) => error && error.code === 'agent_final_quality_diagnosis_repair_without_judge',
    'diagnosis repair must be unavailable until a full final Judge result exists'
  );
  const repairAgent = new Agent(
    repairConfig,
    async () => ({ content: 'x', stopReason: 'end_turn' }),
    async () => buildDocumentObservation()
  );
  repairAgent.performanceLedger.modelCallCount = repairBudget.maxModelCalls;
  repairAgent.beginPerformanceModelCall(
    true,
    'final_quality_judge',
    1,
    ['repair-fixture'],
    true
  );
  repairAgent.beginPerformanceModelCall(
    true,
    'final_quality_diagnosis_repair',
    1,
    ['repair-fixture'],
    true
  );
  assert.deepStrictEqual({
    modelCalls: repairAgent.performanceLedger.modelCallCount,
    candidates: repairAgent.performanceLedger.visionCandidateCount,
    analyses: repairAgent.performanceLedger.visualAnalysisCount,
    judges: repairAgent.performanceLedger.finalQualityJudgeCallCount,
    repairs: repairAgent.performanceLedger.finalQualityDiagnosisRepairCallCount
  }, {
    modelCalls: repairBudget.maxModelCalls,
    candidates: 0,
    analyses: 0,
    judges: 1,
    repairs: 1
  }, 'diagnosis repair must keep its generation-local cap without consuming ordinary task budget');
  assert.throws(
    () => repairAgent.beginPerformanceModelCall(
      true,
      'final_quality_diagnosis_repair',
      1,
      ['repair-fixture'],
      true
    ),
    (error) => error && error.code === 'agent_final_quality_diagnosis_repair_budget_exhausted',
    'diagnosis protocol repair must remain single-use per Agent generation'
  );

  const mismatchedEvidenceAgent = new Agent(
    repairConfig,
    async () => ({ content: 'x', stopReason: 'end_turn' }),
    async () => buildDocumentObservation()
  );
  mismatchedEvidenceAgent.beginPerformanceModelCall(
    true,
    'final_quality_judge',
    1,
    ['judge-bound-evidence'],
    true
  );
  assert.throws(
    () => mismatchedEvidenceAgent.beginPerformanceModelCall(
      true,
      'final_quality_diagnosis_repair',
      1,
      ['different-evidence'],
      true
    ),
    (error) => error && error.code === 'agent_final_quality_diagnosis_repair_evidence_mismatch',
    'the repair allowance must not be reused for a different image set'
  );
  assert.strictEqual(
    mismatchedEvidenceAgent.performanceLedger.finalQualityDiagnosisRepairCallCount,
    0,
    'evidence-mismatched repair must not partially charge the dedicated slot'
  );

  const expiredRepairAgent = new Agent(
    repairConfig,
    async () => ({ content: 'x', stopReason: 'end_turn' }),
    async () => buildDocumentObservation()
  );
  expiredRepairAgent.performanceLedger.runStartedAtMs = Date.now() - repairBudget.softTimeBudgetMs - 10;
  expiredRepairAgent.performanceLedger.finalQualityJudgeCallCount = 1;
  expiredRepairAgent.performanceLedger.finalQualityJudgeVisionCandidateCount = 1;
  expiredRepairAgent.performanceLedger.finalQualityJudgeVisionCandidateKeys = ['expired-repair-fixture'];
  assert.throws(
    () => expiredRepairAgent.beginPerformanceModelCall(
      true,
      'final_quality_diagnosis_repair',
      1,
      ['expired-repair-fixture'],
      true
    ),
    (error) => error && error.code === 'agent_soft_time_budget_exhausted',
    'diagnosis repair must not bypass the physical soft-time deadline'
  );
}

function buildDiagnosisRepairFixture() {
  return {
    visualFinding: {
      scope: 'global',
      target: '当前画布',
      description: '主体与外围留白的比例偏弱',
      relationship: '主体识别力度低于商品主图目标',
      affectedRoles: ['subject']
    },
    causalExplanation: {
      goalRelation: 'conflicts',
      mechanism: '过多外围留白削弱了缩略图中的商品识别'
    },
    revision: {
      action: '重新判断主体与留白的视觉关系',
      expectedEffect: '商品在缩略图中更快被识别',
      preserve: ['完整商品轮廓'],
      verify: ['按真实展示尺寸复核主体识别']
    }
  };
}

async function assertFinalQualityDiagnosisRepairModelProtocol() {
  const pending = DESIGN_ASSERTIONS.filter((assertion) => assertion.method === 'vlm_judge').slice(0, 2);
  assert.strictEqual(pending.length, 2, 'diagnosis repair fixture requires two VLM assertions');
  const firstJudgeResponse = JSON.stringify([
    { id: pending[0].id, applicable: true, score: 0.7, confidence: 0.92, reason: '主体力度不足' },
    { id: pending[1].id, applicable: true, score: 0.9, confidence: 0.9, reason: '当前关系稳定' }
  ]);
  const repairResponse = JSON.stringify([
    { id: pending[0].id, diagnosis: buildDiagnosisRepairFixture() }
  ]);
  const historyStateRef = { documentId: 42, historyStateId: 77 };
  const calls = [];
  let historyReads = 0;
  const successful = await runFinalQualityModelProtocol({
    judgeSystemPrompt: 'judge-protocol',
    targetBindingInstruction: 'single-surface-target',
    contextMessage: 'same-review-context',
    contentBlocks: [{ type: 'image', data: 'same-review-image', mediaType: 'image/png' }],
    visualPresentationCandidateKeys: ['fixture-image'],
    pending,
    expectedHistoryStateRef: historyStateRef,
    configuredSoftTimeBudgetMs: 100_000,
    maxRequestTimeoutMs: 90_000,
    readActiveElapsedMs: () => 1000,
    callJudge: async (request) => {
      calls.push({ kind: 'judge', request });
      return { content: firstJudgeResponse };
    },
    callDiagnosisRepair: async (request) => {
      calls.push({ kind: 'repair', request });
      return { content: repairResponse };
    },
    readPostModelHistoryStateRef: async () => {
      historyReads += 1;
      return historyStateRef;
    }
  });
  assert.strictEqual(successful.status, 'completed');
  assert.strictEqual(successful.diagnosisRepairStatus, 'repaired');
  assert.strictEqual(calls.map((call) => call.kind).join(','), 'judge,repair');
  assert.strictEqual(historyReads, 2, 'the same Photoshop revision must be checked after Judge and repair');
  assert.deepStrictEqual(
    Object.keys(calls[1].request).sort(),
    ['maxTokens', 'messages', 'temperature', 'timeoutMs'],
    'diagnosis repair request must not expose a Tool or execution channel'
  );
  assert(calls[1].request.messages[0].content.includes('不是在重新评价画面'));
  assert(calls[1].request.messages[1].contentBlocks.some((block) => block.data === 'same-review-image'));
  assert.strictEqual(successful.results[0].score, 0.7, 'repair must preserve the first Judge score');
  assert.strictEqual(successful.results[0].confidence, 0.92, 'repair must preserve confidence');
  assert.strictEqual(successful.results[0].status, 'needs_review', 'repair must preserve status');
  assert(successful.results[0].diagnosis, 'valid diagnosis-only response must be merged');

  let failedHistoryReads = 0;
  const failed = await runFinalQualityModelProtocol({
    judgeSystemPrompt: 'judge-protocol',
    contextMessage: 'same-review-context',
    contentBlocks: [{ type: 'image', data: 'same-review-image', mediaType: 'image/png' }],
    visualPresentationCandidateKeys: ['fixture-image'],
    pending,
    expectedHistoryStateRef: historyStateRef,
    configuredSoftTimeBudgetMs: 100_000,
    maxRequestTimeoutMs: 90_000,
    readActiveElapsedMs: () => 1000,
    callJudge: async () => ({ content: firstJudgeResponse }),
    callDiagnosisRepair: async () => { throw new Error('repair unavailable'); },
    readPostModelHistoryStateRef: async () => {
      failedHistoryReads += 1;
      return historyStateRef;
    }
  });
  assert.strictEqual(failed.status, 'completed');
  assert.strictEqual(failed.diagnosisRepairStatus, 'call_failed');
  assert.strictEqual(failed.results[0].score, 0.7, 'failed repair must retain the first reliable score');
  assert.strictEqual(failed.results[0].diagnosis, undefined, 'failed repair must not fabricate a diagnosis');
  assert.strictEqual(failedHistoryReads, 2, 'failed repair may retain scores only after a second history reconciliation');

  let staleHistoryReads = 0;
  const stale = await runFinalQualityModelProtocol({
    judgeSystemPrompt: 'judge-protocol',
    contextMessage: 'same-review-context',
    contentBlocks: [{ type: 'image', data: 'same-review-image', mediaType: 'image/png' }],
    visualPresentationCandidateKeys: ['fixture-image'],
    pending,
    expectedHistoryStateRef: historyStateRef,
    configuredSoftTimeBudgetMs: 100_000,
    maxRequestTimeoutMs: 90_000,
    readActiveElapsedMs: () => 1000,
    callJudge: async () => ({ content: firstJudgeResponse }),
    callDiagnosisRepair: async () => ({ content: repairResponse }),
    readPostModelHistoryStateRef: async () => {
      staleHistoryReads += 1;
      return staleHistoryReads === 1
        ? historyStateRef
        : { documentId: historyStateRef.documentId, historyStateId: historyStateRef.historyStateId + 1 };
    }
  });
  assert.strictEqual(stale.status, 'judge_stale');
  assert.strictEqual(stale.results, null, 'a stale repair interval must invalidate the whole visual score batch');

  const invalidMultiTarget = await runFinalQualityModelProtocol({
    judgeSystemPrompt: 'judge-protocol',
    targetBindingInstruction: 'target must be screen-a or screen-b',
    contextMessage: 'same-review-context',
    contentBlocks: [{ type: 'image', data: 'same-review-image', mediaType: 'image/png' }],
    visualPresentationCandidateKeys: ['fixture-image'],
    allowedDiagnosisTargets: ['screen-a', 'screen-b'],
    pending,
    expectedHistoryStateRef: historyStateRef,
    configuredSoftTimeBudgetMs: 100_000,
    maxRequestTimeoutMs: 90_000,
    readActiveElapsedMs: () => 1000,
    callJudge: async () => ({ content: firstJudgeResponse }),
    callDiagnosisRepair: async () => ({ content: repairResponse }),
    readPostModelHistoryStateRef: async () => historyStateRef
  });
  assert.strictEqual(invalidMultiTarget.status, 'completed');
  assert.strictEqual(invalidMultiTarget.diagnosisRepairStatus, 'invalid');
  assert.strictEqual(
    invalidMultiTarget.results[0].diagnosis,
    undefined,
    'a diagnosis outside the current multi-surface target set must not be marked repaired'
  );

  let unverifiedRepairCalled = false;
  const requiredReceiptMissing = await runFinalQualityModelProtocol({
    judgeSystemPrompt: 'judge-protocol',
    contextMessage: 'same-review-context',
    contentBlocks: [{ type: 'image', data: 'aGVsbG8=', mediaType: 'image/png' }],
    visualPresentationCandidateKeys: ['fixture-image'],
    visualPresentationReceiptPolicy: 'required',
    pending,
    expectedHistoryStateRef: historyStateRef,
    maxRequestTimeoutMs: 90_000,
    readActiveElapsedMs: () => 1000,
    callJudge: async () => ({ content: firstJudgeResponse }),
    callDiagnosisRepair: async () => {
      unverifiedRepairCalled = true;
      return { content: repairResponse };
    },
    readPostModelHistoryStateRef: async () => historyStateRef
  });
  assert.strictEqual(requiredReceiptMissing.status, 'judge_unavailable');
  assert.strictEqual(requiredReceiptMissing.results, null, 'required receipt missing must discard text-only visual scores');
  assert.strictEqual(unverifiedRepairCalled, false, 'unverified Judge scores must not trigger diagnosis repair');

  const serializedFixtureImage = projectSerializedVisualImageDataUrl('data:image/png;base64,aGVsbG8=');
  assert(serializedFixtureImage);
  const wrongPresentationReceipt = buildModelVisualPresentationReceipt({
    provider: 'openai-codex',
    attemptId: 'c'.repeat(64),
    candidateKeys: ['wrong-image'],
    serializedImages: [serializedFixtureImage]
  });
  assert(wrongPresentationReceipt);
  const requiredReceiptMismatch = await runFinalQualityModelProtocol({
    judgeSystemPrompt: 'judge-protocol',
    contextMessage: 'same-review-context',
    contentBlocks: [{ type: 'image', data: 'aGVsbG8=', mediaType: 'image/png' }],
    visualPresentationCandidateKeys: ['fixture-image'],
    visualPresentationReceiptPolicy: 'required',
    pending,
    expectedHistoryStateRef: historyStateRef,
    maxRequestTimeoutMs: 90_000,
    readActiveElapsedMs: () => 1000,
    callJudge: async () => ({
      content: firstJudgeResponse,
      visualPresentationReceipt: wrongPresentationReceipt,
      transportAttempts: [{
        durationMs: 1,
        succeeded: true,
        visualPresentationReceiptRef: {
          attemptId: wrongPresentationReceipt.attemptId,
          manifestSha256: wrongPresentationReceipt.manifestSha256
        }
      }]
    }),
    callDiagnosisRepair: async () => ({ content: repairResponse }),
    readPostModelHistoryStateRef: async () => historyStateRef
  });
  assert.strictEqual(requiredReceiptMismatch.status, 'judge_unavailable');
  assert.strictEqual(requiredReceiptMismatch.results, null, 'wrong image key/order/digest must not earn visual evidence credit');
}

/**
 * 终局质量事实闭环回归：最后一次写入后只有同 revision 的全画布像素时，pre_judge
 * 必须用一份同 revision 的完整 AcceptanceSnapshot 补齐画布与层级，再调用一次 advisory VLM。
 * Agent 没有主动调用 evaluateDesign 不得使终局 Judge 永久不可达；Harness 只补事实，不产审美答案。
 */
async function assertFinalQualityJudgeClosesFreshStructureBeforeEvaluation() {
  const documentId = 71;
  const historyStateId = 102;
  const historyStateRef = { documentId, historyStateId };
  const mutationCommit = {
    version: 'photoshop-mutation-commit/v1',
    basis: 'same_execute_as_modal',
    bindingStrength: 'document_revision',
    before: { documentId, historyStateId: historyStateId - 1 },
    after: historyStateRef,
    toolActionCompleted: true,
    mutationObserved: true
  };
  const layerHierarchy = [{
    id: 12,
    name: '商品主体',
    kind: 'smartObject',
    visible: true,
    bounds: { left: 80, top: 100, right: 720, bottom: 760 }
  }];
  const baseLog = [
    {
      name: 'deleteLayer',
      arguments: { layerId: 9 },
      result: {
        success: true,
        documentId,
        historyStateRef,
        photoshopMutationCommit: mutationCommit
      }
    },
    {
      name: 'getCanvasSnapshot',
      arguments: { expectedDocumentId: documentId },
      result: { success: true, documentId, historyStateRef }
    }
  ];
  const builtReviewSet = buildDesignReviewSetFromSingleSurface({
    identity: {
      outer: 'getCanvasSnapshot',
      resultPath: '$',
      document: String(documentId),
      history: String(historyStateId),
      sourceKind: 'canvas',
      sourceId: `document:${documentId}`
    },
    image: {
      base64: 'aGVsbG8=',
      mediaType: 'image/png',
      format: 'png'
    }
  });
  assert.strictEqual(builtReviewSet.status, 'ready');

  const judgePending = TASK_NEUTRAL_DESIGN_ASSERTIONS.filter((assertion) => assertion.method === 'vlm_judge');
  const judgeResponse = JSON.stringify(judgePending.map((assertion, index) => ({
    id: assertion.id,
    applicable: true,
    score: index === 0 ? 0.7 : 0.9,
    confidence: 0.9,
    reason: index === 0 ? '主体力度不足' : '当前关系稳定'
  })));
  const diagnosisResponse = JSON.stringify([{
    id: judgePending[0].id,
    diagnosis: buildDiagnosisRepairFixture()
  }]);
  let judgeCallCount = 0;
  let judgeMessages;
  let repairMessages;
  const modelRequestOptions = [];
  const hostToolNames = [];
  const codexJudgeModelId = 'test-codex-vision';
  const previousDynamicModels = getDynamicModels();
  clearDynamicModels();
  setDynamicModels([{
    id: codexJudgeModelId,
    name: 'Test Codex Vision',
    source: 'cloud',
    provider: 'openai-codex',
    apiModelId: 'gpt-test',
    usageKind: 'conversation',
    usageConfidence: 'declared',
    roles: ['general', 'vision'],
    capabilities: ['text-generation', 'vision'],
    supportsVision: true,
    supportsToolUse: true,
    supportsStreaming: false,
    maxTokens: 8192
  }]);
  const config = buildAgentTestConfig({
    tools: [requireAgentTool('getDocumentInfo'), requireAgentTool('getAcceptanceSnapshot')],
    maxIterations: 2,
    openingCanvasObservationMode: 'none',
    performanceBudget: {
      maxModelCalls: 10,
      maxToolCalls: 20,
      maxVisionCandidates: 6,
      maxVisualAnalyses: 2,
      maxFullResolutionImageReads: 0,
      softTimeBudgetMs: 300_000
    }
  });
  config.modelId = codexJudgeModelId;
  const agent = new Agent(
    config,
    async (_modelId, messages, tools, options) => {
      judgeCallCount += 1;
      modelRequestOptions.push({ tools, options });
      if (judgeCallCount === 1) {
        judgeMessages = messages;
        const serializedImages = messages
          .flatMap((message) => Array.isArray(message.contentBlocks) ? message.contentBlocks : [])
          .filter((block) => block.type === 'image')
          .map((block) => projectSerializedVisualImageDataUrl(
            `data:${block.mediaType};base64,${block.data}`
          ));
        assert(serializedImages.every(Boolean), 'the fixture images must serialize into exact outgoing projections');
        const visualPresentationReceipt = buildModelVisualPresentationReceipt({
          provider: 'openai-codex',
          attemptId: 'b'.repeat(64),
          candidateKeys: options?.visualPresentationCandidateKeys,
          serializedImages
        });
        assert(visualPresentationReceipt, 'the first Judge call must return a matching Provider presentation receipt');
        return {
          content: judgeResponse,
          visualPresentationReceipt,
          transportAttempts: [{
            durationMs: 1,
            succeeded: true,
            visualPresentationReceiptRef: {
              attemptId: visualPresentationReceipt.attemptId,
              manifestSha256: visualPresentationReceipt.manifestSha256
            }
          }]
        };
      }
      repairMessages = messages;
      const serializedImages = messages
        .flatMap((message) => Array.isArray(message.contentBlocks) ? message.contentBlocks : [])
        .filter((block) => block.type === 'image')
        .map((block) => projectSerializedVisualImageDataUrl(
          `data:${block.mediaType};base64,${block.data}`
        ));
      assert(serializedImages.every(Boolean));
      const visualPresentationReceipt = buildModelVisualPresentationReceipt({
        provider: 'openai-codex',
        attemptId: 'd'.repeat(64),
        candidateKeys: options?.visualPresentationCandidateKeys,
        serializedImages
      });
      assert(visualPresentationReceipt, 'diagnosis repair must sign its own matching presentation receipt');
      return {
        content: diagnosisResponse,
        visualPresentationReceipt,
        transportAttempts: [{
          durationMs: 1,
          succeeded: true,
          visualPresentationReceiptRef: {
            attemptId: visualPresentationReceipt.attemptId,
            manifestSha256: visualPresentationReceipt.manifestSha256
          }
        }]
      };
    },
    async (toolName) => {
      hostToolNames.push(toolName);
      if (toolName === 'getAcceptanceSnapshot') {
        return {
          success: true,
          hasDocument: true,
          document: { id: documentId, width: 800, height: 800 },
          historyStateRef,
          summary: { totalLayers: layerHierarchy.length, truncated: false },
          layers: layerHierarchy
        };
      }
      return {
        success: true,
        documentId,
        document: { id: documentId, width: 800, height: 800 },
        historyStateRef
      };
    }
  );
  agent.currentTask = '帮我做一张商品主图';
  agent.toolCallLog = baseLog;
  agent.performanceLedger.visionCandidateCount = 5;
  agent.latestDesignVisualJudgeSingleReviewSet = {
    reviewSet: builtReviewSet.reviewSet,
    images: [{ data: 'aGVsbG8=', mediaType: 'image/png' }],
    historyStateRef,
    receipt: {
      version: 'visual-observation-receipt/v1',
      document: String(documentId),
      history: String(historyStateId),
      sourceTool: 'getCanvasSnapshot'
    },
    sourceOutput: {}
  };

  const assertions = await agent.evaluateDesignQualityVlmAssertions('final_response');
  assert.strictEqual(judgeCallCount, 2, 'a missing diagnosis must remain repairable after the independent Judge event');
  assert(
    judgeMessages?.[1]?.contentBlocks?.some((block) => block.type === 'image' && block.data === 'aGVsbG8='),
    'the critical-budget regression must reach the provider with the actual ReviewSet image'
  );
  assert(
    judgeMessages?.[0]?.content?.includes('final_bound_supporting_source')
      && !judgeMessages?.[0]?.content?.includes('selected_source'),
    'the Judge protocol must describe the source label that the final payload actually emits'
  );
  assert(
    repairMessages?.[0]?.content?.includes('不是在重新评价画面')
      && repairMessages?.[1]?.contentBlocks?.some((block) => block.type === 'image' && block.data === 'aGVsbG8='),
    'diagnosis repair must reuse the same ReviewSet while forbidding rescoring'
  );
  assert(modelRequestOptions.every((request) => (
    Array.isArray(request.tools)
      && request.tools.length === 0
      && !Object.prototype.hasOwnProperty.call(request.options || {}, 'messages')
  )), 'Judge / repair messages must be passed once, never duplicated inside provider options');
  assert.strictEqual(
    modelRequestOptions[0]?.options?.visualPresentationCandidateKeys?.length,
    1,
    'the first Judge must bind the outgoing image receipt to its exact presentation keys'
  );
  assert.strictEqual(
    modelRequestOptions[1]?.options?.visualPresentationCandidateKeys?.length,
    1,
    'diagnosis repair must independently prove that it replayed the same visual presentation'
  );
  assert.deepStrictEqual({
    candidates: agent.performanceLedger.visionCandidateCount,
    analyses: agent.performanceLedger.visualAnalysisCount,
    judges: agent.performanceLedger.finalQualityJudgeCallCount,
    repairs: agent.performanceLedger.finalQualityDiagnosisRepairCallCount
  }, { candidates: 5, analyses: 0, judges: 1, repairs: 1 },
  'Judge and repair hard caps must not contaminate the cross-generation ordinary vision pool');
  assert.deepStrictEqual(
    hostToolNames,
    ['getAcceptanceSnapshot', 'getDocumentInfo', 'getDocumentInfo'],
    'pre-Judge, post-Judge and post-repair Host revisions must all be reconciled'
  );
  assert(Array.isArray(assertions) && assertions.length > 0, 'the final Judge result must enter the existing scorecard path');
  assert(assertions.some((assertion) => assertion.id === judgePending[0].id && assertion.diagnosis));
  assert.deepStrictEqual(
    agent.toolCallLog.slice(-3).map((entry) => entry.qualityVerificationPhase),
    ['pre_judge', 'post_judge', 'post_judge'],
    'the terminal version checks must remain distinguishable in the run ledger'
  );
  assert.deepStrictEqual(agent.finalQualityModelProtocolDigest, {
    judgeStatus: 'completed',
    diagnosisRepairStatus: 'repaired',
    diagnosisRepairTargetCount: 1,
    actionableDiagnosisCount: 1,
    evidenceScope: {
      finalArtifactObserved: true,
      selectedSourceCompared: false,
      declaredReferenceCompared: false,
      candidateSetCompared: false
    }
  }, 'final quality diagnostics must retain only the bounded protocol and input-scope facts');
  const summaryWithFinalQualityDigest = agent.buildExecutionSummary(
    'final_response',
    1,
    assertions
  );
  assert.deepStrictEqual(
    summaryWithFinalQualityDigest.finalQualityModelProtocolDigest,
    agent.finalQualityModelProtocolDigest,
    'executionSummary must project the diagnostic digest without changing the quality result'
  );

  const noReceiptConfig = buildAgentTestConfig({
    tools: [requireAgentTool('getDocumentInfo'), requireAgentTool('getAcceptanceSnapshot')],
    maxIterations: 2,
    openingCanvasObservationMode: 'none',
    performanceBudget: config.performanceBudget
  });
  noReceiptConfig.modelId = codexJudgeModelId;
  const noReceiptAgent = new Agent(
    noReceiptConfig,
    async () => ({ content: judgeResponse }),
    async (toolName) => toolName === 'getAcceptanceSnapshot'
      ? {
          success: true,
          hasDocument: true,
          document: { id: documentId, width: 800, height: 800 },
          historyStateRef,
          summary: { totalLayers: layerHierarchy.length, truncated: false },
          layers: layerHierarchy
        }
      : {
          success: true,
          documentId,
          document: { id: documentId, width: 800, height: 800 },
          historyStateRef
        }
  );
  noReceiptAgent.currentTask = '帮我做一张商品主图';
  noReceiptAgent.toolCallLog = baseLog;
  noReceiptAgent.performanceLedger.visionCandidateCount = 5;
  noReceiptAgent.latestDesignVisualJudgeSingleReviewSet = agent.latestDesignVisualJudgeSingleReviewSet;
  const noReceiptAssertions = await noReceiptAgent.evaluateDesignQualityVlmAssertions('final_response');
  assert.strictEqual(noReceiptAssertions, null, 'Codex 未签逐图回执时不得让文字评分进入 fresh_visual');
  assert.strictEqual(noReceiptAgent.finalQualityModelProtocolDigest?.judgeStatus, 'unavailable');
  assert.strictEqual(
    noReceiptAgent.finalQualityModelProtocolDigest?.evidenceScope.finalArtifactObserved,
    false,
    '缺失逐图回执不得取得最终成品观察信用'
  );

  const summaryHostToolNames = [];
  const summaryAgent = new Agent(
    buildAgentTestConfig({
      tools: [requireAgentTool('getDocumentInfo'), requireAgentTool('getAcceptanceSnapshot')],
      maxIterations: 2,
      openingCanvasObservationMode: 'none'
    }),
    async () => ({ content: 'x', stopReason: 'end_turn' }),
    async (toolName) => {
      summaryHostToolNames.push(toolName);
      if (toolName === 'getAcceptanceSnapshot') {
        return {
          success: true,
          hasDocument: true,
          document: { id: documentId, width: 800, height: 800 },
          historyStateRef,
          summary: { totalLayers: layerHierarchy.length, truncated: false },
          layers: layerHierarchy
        };
      }
      return {
        success: true,
        documentId,
        historyStateRef,
        hierarchy: layerHierarchy
      };
    }
  );
  summaryAgent.toolCallLog = [baseLog[0]];
  const closedHistoryStateRef = await summaryAgent.readCurrentPhotoshopHistoryStateRefForQualityVerification(
    'final_summary'
  );
  const finalSurface = extractFreshDesignSurfaceSnapshotFromToolResults(summaryAgent.toolCallLog, {
    requiredHistoryStateRef: closedHistoryStateRef
  });
  assert.deepStrictEqual(
    summaryHostToolNames,
    ['getAcceptanceSnapshot'],
    'final_summary must collect one complete same-revision AcceptanceSnapshot'
  );
  assert.deepStrictEqual(closedHistoryStateRef, historyStateRef);
  assert(finalSurface, 'final_summary must not report missing structure when same-revision dimensions and hierarchy both exist');
  setDynamicModels(previousDynamicModels);
}

/**
 * plan-neutral Reflexion 不能因为换了 Agent 实例就重新购买模型、Tool、视觉或时间预算。
 * Seed 只来自上一实例的 PerformanceLedger 投影；有余额时继续累计，没余额时必须原地停机。
 */
async function assertPlanNeutralReflexionCarriesRequestPerformanceUsage() {
  const planNeutralIdentity = createPlanNeutralIdentity('performance-seed');
  const chatIntent = buildAgentIntentControlPlaneDecision({
    userInput: '你好',
    hasImageInput: false,
    hasDocument: false,
    photoshopConnected: true
  });
  const seed = {
    modelCalls: 2,
    toolCalls: 7,
    iterations: 2,
    visionCandidates: 2,
    visualAnalyses: 1,
    activeElapsedMs: 45_000,
    observationKeys: ['canvas:71@101', 'canvas:71@102']
  };
  let continuedProviderCalls = 0;
  const continuedConfig = buildAgentTestConfig({
    tools: [],
    maxIterations: 8,
    openingCanvasObservationMode: 'none',
    runtimeSessionIdentity: planNeutralIdentity,
    intentControlPlane: chatIntent,
    performanceBudget: {
      maxModelCalls: 4,
      maxToolCalls: 12,
      maxVisionCandidates: 4,
      maxVisualAnalyses: 2,
      maxFullResolutionImageReads: 0,
      softTimeBudgetMs: 300_000
    }
  });
  continuedConfig.requestPerformanceUsageSeed = seed;
  const continuedAgent = new Agent(
    continuedConfig,
    async () => {
      continuedProviderCalls += 1;
      return { content: '你好，我在。', stopReason: 'end_turn' };
    },
    async () => {
      throw new Error('plan-neutral budget fixture must not execute Tools');
    }
  );
  await continuedAgent.run('你好');
  const continuedUsage = continuedAgent.readRequestPerformanceUsageSnapshot();
  assert.strictEqual(continuedProviderCalls, 1, 'a plan-neutral reentry with remaining budget must continue once');
  assert.strictEqual(continuedUsage.modelCalls, 3, 'the reentry must add to, not reset, prior model calls');
  assert.strictEqual(continuedUsage.toolCalls, seed.toolCalls);
  assert(continuedUsage.iterations >= seed.iterations);
  assert.strictEqual(continuedUsage.visionCandidates, seed.visionCandidates);
  assert.strictEqual(continuedUsage.visualAnalyses, seed.visualAnalyses);
  assert(continuedUsage.activeElapsedMs >= seed.activeElapsedMs);
  assert.deepStrictEqual(continuedUsage.observationKeys, seed.observationKeys);

  let exhaustedProviderCalls = 0;
  const exhaustedConfig = buildAgentTestConfig({
    tools: [],
    maxIterations: 8,
    openingCanvasObservationMode: 'none',
    runtimeSessionIdentity: planNeutralIdentity,
    intentControlPlane: chatIntent,
    performanceBudget: {
      maxModelCalls: 2,
      maxToolCalls: 12,
      maxVisionCandidates: 4,
      maxVisualAnalyses: 2,
      maxFullResolutionImageReads: 0,
      softTimeBudgetMs: 300_000
    }
  });
  exhaustedConfig.requestPerformanceUsageSeed = seed;
  const exhaustedAgent = new Agent(
    exhaustedConfig,
    async () => {
      exhaustedProviderCalls += 1;
      return { content: '不应调用', stopReason: 'end_turn' };
    },
    async () => {
      throw new Error('exhausted plan-neutral fixture must not execute Tools');
    }
  );
  const exhaustedResult = await exhaustedAgent.run('你好');
  assert.strictEqual(exhaustedProviderCalls, 0, 'an exhausted request seed must not buy another model call');
  assert.strictEqual(exhaustedResult.stopReason, 'performance_budget');
  assert.strictEqual(
    exhaustedAgent.readRequestPerformanceUsageSnapshot().modelCalls,
    seed.modelCalls,
    'budget stop must preserve the inherited cumulative usage'
  );

  const anonymousConfig = buildAgentTestConfig({
    tools: [],
    maxIterations: 8,
    openingCanvasObservationMode: 'none',
    intentControlPlane: chatIntent,
    performanceBudget: exhaustedConfig.performanceBudget
  });
  anonymousConfig.requestPerformanceUsageSeed = seed;
  const anonymousAgent = new Agent(
    anonymousConfig,
    async () => ({ content: '不应调用', stopReason: 'end_turn' }),
    async () => {
      throw new Error('anonymous performance seed fixture must not execute Tools');
    }
  );
  await assert.rejects(
    () => anonymousAgent.run('你好'),
    /request_performance_usage_seed_requires_task_run_identity/,
    'a request ledger seed must never float without the same TaskRun identity'
  );
}

/**
 * 治理切片 4（GATE-SIMPLIFY-004）：普通视觉候选/分析共用运行级视觉池；独立 Final Judge
 * 继续使用单次事件硬上限。池上限 = 候选硬上限 + 分析上限；(0,0) 零视觉语义不变。
 */
function assertRunLevelVisionPoolMergesKindBudgets() {
  const poolBudget = {
    maxModelCalls: 30,
    maxToolCalls: 50,
    maxVisionCandidates: 6,
    maxVisualAnalyses: 2,
    maxFullResolutionImageReads: 0,
    softTimeBudgetMs: 300_000
  };
  const config = buildAgentTestConfig({
    tools: [requireAgentTool('getDocumentInfo')],
    maxIterations: 2,
    openingCanvasObservationMode: 'none',
    performanceBudget: poolBudget
  });
  const agent = new Agent(
    config,
    async () => ({ content: 'x', stopReason: 'end_turn' }),
    async () => buildDocumentObservation()
  );
  const mixedAgent = new Agent(
    config,
    async () => ({ content: 'x', stopReason: 'end_turn' }),
    async () => buildDocumentObservation()
  );
  mixedAgent.performanceLedger.visionCandidateCount = 3;
  mixedAgent.performanceLedger.visualAnalysisCount = 2;
  assert.strictEqual(
    mixedAgent.getPerformanceVisionCandidateLimit(),
    4,
    'pool remaining is incremental capacity and must be converted back to an absolute candidate limit'
  );
  assert.strictEqual(
    mixedAgent.consumePerformanceVisionCandidate('mixed-pool-fourth-candidate'),
    true,
    'one remaining ordinary candidate must not be rejected by comparing cumulative count to pool remaining'
  );
  // 池 = 6 + 2 = 8：连续 8 次视觉分析放行（旧契约第 3 次即拒绝），第 9 次拒绝。
  for (let index = 0; index < 8; index += 1) {
    agent.beginPerformanceModelCall(true, 'task');
  }
  assert.strictEqual(
    agent.resolvePerformanceVisionBudget().runLevelLimit,
    8,
    'merged pool limit must equal candidate hard limit plus configured analysis limit'
  );
  assert.strictEqual(
    agent.getPerformanceVisionCandidateLimit(),
    0,
    'candidate allowance must shrink to zero once the merged pool is exhausted by analyses'
  );
  let ninthAnalysisRejected = false;
  try {
    agent.beginPerformanceModelCall(true, 'task');
  } catch (error) {
    ninthAnalysisRejected = error && error.code === 'agent_visual_analysis_budget_exhausted';
  }
  assert(ninthAnalysisRejected, 'the ninth vision event must exhaust the merged pool');

  // (0,0) 零视觉配置语义不变：池为 0，第一次视觉分析即拒绝。
  const zeroVisionConfig = buildAgentTestConfig({
    tools: [requireAgentTool('getDocumentInfo')],
    maxIterations: 2,
    openingCanvasObservationMode: 'none',
    performanceBudget: {
      maxModelCalls: 30,
      maxToolCalls: 50,
      maxVisionCandidates: 0,
      maxVisualAnalyses: 0,
      maxFullResolutionImageReads: 0,
      softTimeBudgetMs: 300_000
    }
  });
  const zeroVisionAgent = new Agent(
    zeroVisionConfig,
    async () => ({ content: 'x', stopReason: 'end_turn' }),
    async () => buildDocumentObservation()
  );
  let zeroVisionRejected = false;
  try {
    zeroVisionAgent.beginPerformanceModelCall(true, 'task');
  } catch (error) {
    zeroVisionRejected = error && error.code === 'agent_visual_analysis_budget_exhausted';
  }
  assert(zeroVisionRejected, 'zero-vision budgets must still reject the first vision event');
}

/** 按需目录不常驻 Prompt；每个能力家族必须经生产只读搜索入口可发现。 */
function assertOnDemandCatalogShowsEveryCapabilityFamilyWithDetailRepresentatives() {
  const session = createAgentCapabilitySession({
    candidateTools: getDefaultAgentTools()
  });
  const prompt = session.buildPromptSection();
  const onDemandIds = session.getResolution().onDemandCapabilityIds;
  const families = new Set(onDemandIds.map((id) => {
    const segments = String(id).split('.');
    return segments.length >= 3 ? `${segments[0]}.${segments[1]}` : segments[0];
  }));
  for (const family of families) {
    const search = session.searchCapabilities(family, 8);
    assert(
      search.matches.some((match) => match.family === family),
      `capability family ${family} must be discoverable through the on-demand search Tool`
    );
  }
  assert(
    prompt.includes('searchAgentCapabilities'),
    'the compact prompt must direct the Agent to the production capability search Tool'
  );
  assert(
    !Array.from(families).some((family) => prompt.includes(`- ${family}.`)),
    'the compact prompt must not duplicate the complete capability directory'
  );
}

/**
 * 治理切片 7（GATE-SIMPLIFY-007）：裸「继续」的写权限裁决——
 * 同会话分支有可续接档案时保留写权限（resume 路径）；无档案维持降级不恢复写权限。
 */
function assertBareContinuationResumeDecision() {
  const withResume = resolveBareContinuationResumeDecision({
    unboundAcknowledgement: true,
    executionAuthorization: 'confirmed_tool_required',
    resumableRecordAvailable: true
  });
  assert.strictEqual(
    withResume.demote,
    false,
    'a bare continuation with a resumable same-conversation record must keep the write envelope'
  );
  assert.strictEqual(
    withResume.matchedSignal,
    'bare_continuation_resume_identity',
    'the resume identity signal must be recorded for the continued run'
  );

  const withoutResume = resolveBareContinuationResumeDecision({
    unboundAcknowledgement: true,
    executionAuthorization: 'confirmed_tool_required',
    resumableRecordAvailable: false
  });
  assert.strictEqual(
    withoutResume.demote,
    true,
    'a bare continuation without a resumable record must still demote to candidate_only'
  );

  const notAcknowledgement = resolveBareContinuationResumeDecision({
    unboundAcknowledgement: false,
    executionAuthorization: 'confirmed_tool_required',
    resumableRecordAvailable: true
  });
  assert.strictEqual(notAcknowledgement.demote, false, 'non-acknowledgement input must not demote');
  assert.strictEqual(
    notAcknowledgement.matchedSignal,
    undefined,
    'non-acknowledgement input must not mint the resume signal'
  );

  const noWriteAuthorization = resolveBareContinuationResumeDecision({
    unboundAcknowledgement: true,
    executionAuthorization: 'candidate_only',
    resumableRecordAvailable: true
  });
  assert.strictEqual(
    noWriteAuthorization.demote,
    false,
    'already-demoted authorization needs no further demotion decision'
  );
}

/**
 * 治理切片 8（GATE-SIMPLIFY-008）：授权不足拦截带结构化升级出口——
 * 模型收到具体解锁选项（只读先行/确认卡/重新授权），不再空转；已授权路径不受影响。
 */
function assertExecutionAuthorizationBlockerCarriesUnlockOptions() {
  const writeIntent = buildAutonomousExecutionDecisionForEngine('gate-simplify-008');
  const blockedContract = buildAgentToolDecisionContract({
    userInput: '帮我把这个图层往上移一点',
    intentControlPlane: {
      ...writeIntent,
      toolScope: 'write_photoshop',
      executionAuthorization: 'candidate_only'
    },
    toolCalls: [{ id: 'blocked-write-1', name: 'moveLayer', arguments: { layerId: 1, x: 0, y: -10 } }],
    completedToolCalls: [],
    runtime: {
      availableTools: ['moveLayer'],
      photoshopConnected: true,
      hasDocument: true
    }
  });
  assert.strictEqual(blockedContract.status, 'blocked');
  const authorizationBlocker = blockedContract.blockers.find(
    (item) => item.code === 'execution_authorization_required'
  );
  assert(authorizationBlocker, 'write tool under candidate_only must hit the authorization blocker');
  assert(
    Array.isArray(authorizationBlocker.unlockOptions) && authorizationBlocker.unlockOptions.length >= 3,
    'the authorization blocker must carry structured unlock options'
  );
  assert(
    authorizationBlocker.unlockOptions.some((option) => option.includes('askUserToChoose')),
    'unlock options must include the user-confirmation card path'
  );

  const authorizedContract = buildAgentToolDecisionContract({
    userInput: '帮我把这个图层往上移一点',
    intentControlPlane: {
      ...writeIntent,
      toolScope: 'write_photoshop',
      executionAuthorization: 'confirmed_tool_required'
    },
    toolCalls: [{ id: 'allowed-write-1', name: 'moveLayer', arguments: { layerId: 1, x: 0, y: -10 } }],
    completedToolCalls: [],
    runtime: {
      availableTools: ['moveLayer'],
      photoshopConnected: true,
      hasDocument: true
    }
  });
  assert.strictEqual(
    authorizedContract.status,
    'ready',
    'a confirmed write call must stay authorized and unaffected by the unlock-option change'
  );
}

async function assertRuntimeOwnedSkillLedgerIsRequiredForVisibleReadNone() {
  const executor = createGuardedAtomicToolExecutor({
    executeTool: async () => ({ success: true, hasDocument: false })
  });
  const scope = beginRuntimeOwnedSkillToolLedgerScope(executor);
  await executor('getDocumentInfo', {});
  const ledger = await completeRuntimeOwnedSkillToolLedgerScope(scope);
  assert(ledger?.complete === true);
  assert.strictEqual(ledger.entries.length, 1);
  const result = attachSkillExecutionEffectReceipt({ success: true }, {
    skillId: 'fixture.runtime-ledger-read',
    executionStarted: true,
    runtimeOwnedCompleteToolLedger: ledger
  });
  assert.strictEqual(readSkillExecutionEffectReceipt(result)?.effect, 'none');
  const clonedLedgerResult = attachSkillExecutionEffectReceipt({ success: true }, {
    skillId: 'fixture.cloned-ledger-read',
    executionStarted: true,
    runtimeOwnedCompleteToolLedger: JSON.parse(JSON.stringify(ledger))
  });
  assert.strictEqual(readSkillExecutionEffectReceipt(clonedLedgerResult)?.effect, 'unknown');
}

async function runBehaviorAssertions() {
  await assertRuntimeOwnedSkillLedgerIsRequiredForVisibleReadNone();
  await assertPostSkillExceptionRetainsRecoverableAgentOwner();
  await assertChainedConfirmationKeepsSameRuntimeOwner();
  await assertSucceededUnknownStillStagesRecovery();
  await assertBeginFailureDoesNotReleaseRetainedWriter();
  await assertFailedChainedSwapFallsBackToOldRecoveryOwner();
  assertAbortToPersistentRecoveryPreservesCheckpointOwner();
  await assertLostCheckpointPersistsOperationUnknown();
  await assertPersistencePendingRetriesBeforeAgentResume();
  await assertToolResultRecoveryOptionsDoNotConstrainAgentToolChoice();
  assertDesignDirectionExplorationIsOptionalAndNonAuthoritative();
  assertExecutionSupplyReservePureAccounting();
  assertFinalQualityJudgeReservationRemovedButHardCapStays();
  await assertFinalQualityDiagnosisRepairModelProtocol();
  await assertFinalQualityJudgeClosesFreshStructureBeforeEvaluation();
  await assertPlanNeutralReflexionCarriesRequestPerformanceUsage();
  assertRunLevelVisionPoolMergesKindBudgets();
  assertOnDemandCatalogShowsEveryCapabilityFamilyWithDetailRepresentatives();
  assertBareContinuationResumeDecision();
  assertExecutionAuthorizationBlockerCarriesUnlockOptions();
  await assertZeroProgressWriteAuthorizedStopIsPushedBackAndEndsHonestly();
  await assertExecutionSupplyReserveGatesObservationInLiveLoop();
  await assertChatReadOnlyAndPlanRequestsNeverEnterGovernanceGates();
  await assertSuccessfulDeclarationPreservesAutonomyAndCarriesR2();
  await assertRuntimeDeclarationSiblingPolicyFailsClosed();
  await assertDeclarationCarriesCompatibleReadsWithoutHijackingSiblingCalls();
  await assertAgentRuntimeDeclarationFailureAndAmbiguityStayFailClosed();
  await assertStagedDeclarationUsesTruePostBindingToolSurface();
  await assertAgenticDeclarationActivatesArtifactContractWithoutStageRuntime();
  await assertSkuModeGetsOneStructuredRepair();
  await assertPureFirstToolResponseDoesNotCallAuxiliaryModel();
  await assertCorrectRecommendationCanCallSkillOnFirstTurn();
  await assertWrongRecommendationRecoversWithOneCapabilityRequest();
  await assertDeclaredWorkflowHandoffsDoNotTripFailureBreaker();
  await assertProjectedBareNonFatalStillTripsFailureBreaker();
  await assertUnprojectedRawContinuationStillTripsFailureBreaker();
  await assertCancelledProjectedWorkflowHandoffStopsImmediately();
  await assertDirectRuntimeRepairStaysInE1UntilOwnerAccepts(true);
  await assertDirectRuntimeRepairStaysInE1UntilOwnerAccepts(false);
  assertDirectRuntimeRepairRequiresExactMutationRevision();
  await assertGeneralDesignUnknownWriteKeepsBoundedReadbackAlive();
  await assertGeneralDesignUnknownWriteUnchangedReadbackRestoresOtherWrites();
  await assertKnownNotAppliedWriteDoesNotBlockFollowingSerialWrite();
  await assertProvenAppliedWriteDoesNotLockFollowingSerialWrite();
  await assertConfirmedProductionNarrowsAfterBoundedObservation();
  await assertLinkReviewRequestsStayReadOnly();
  await assertObservationObligationRequiresRealReadButNotMutation();
  await assertProviderTruncationRecoveryDoesNotSpendTaskModelBudget();
  await assertBareCompletionClaimsCannotBypassTextExits();
  console.log(
    `[runtime-declaration-resolver] ${catalog.declarableProfiles.length} profiles ready, `
    + `${catalog.blockedProfiles.length} profiles blocked; live Agent declaration behavior passed.`
  );
}

runBehaviorAssertions().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
