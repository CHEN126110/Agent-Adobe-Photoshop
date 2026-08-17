'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

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
  projectManifestBoundRuntimeDeliveryReceipt,
  readRuntimeDeliveryProofKinds,
  verifyRuntimeDelivery
} = require(path.join(runtimeRoot, 'runtime-delivery-receipt.ts'));
const {
  resolveRuntimeExecutionTarget
} = require(path.join(runtimeRoot, 'runtime-execution-target.ts'));
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
  resolveExecutionSupplyReserve
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
  createRuntimeSessionIdentity
} = require(path.join(runtimeRoot, 'runtime-session.ts'));

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
assert(executorSource.includes("code: 'runtime_design_intent_declaration_invalid'"));
assert(executorSource.includes("code: 'runtime_design_intent_configuration_error'"));
assert(!executorSource.includes("code: 'runtime_declared_manifest_missing'"));
assert(toolExecutorSource.includes('validatedByRuntimeResolver: false'));
assert(!toolExecutorSource.includes('声明设计意图失败：workMode'));
assert(!toolExecutorSource.includes('声明设计意图失败：taskTypeId'));
assert(agentSource.includes("code: 'tool_deferred_after_runtime_declaration'"));
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
assert.strictEqual(skuDefault.bundle.manifest.performance_profile?.budget.max_tool_calls, 50);
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
    systemPrompt: 'Runtime declaration behavior audit.',
    tools: input.tools,
    modelId: 'runtime-declaration-audit-model',
    maxIterations: input.maxIterations,
    openingCanvasObservationMode: input.openingCanvasObservationMode || 'document_identity',
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
 * recovery allowlist 时必须继续计入同名工具失败。前三次 owner 真正执行，
 * Harness 允许一次失败关闭恢复后，第四次模型调用必须在 executor 前被 breaker 拦下。
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
  assert.strictEqual(modelCallCount, 4, 'projected bare nonFatal did not reach the breaker verification turn');
  assert.strictEqual(result.stopReason, 'no_progress');
  assert.strictEqual(ownerLogs.length, 4, 'projected bare nonFatal did not record the blocked fourth owner call');
  assert.strictEqual(
    ownerLogs[ownerLogs.length - 1]?.result?.blockedByFailureBreaker,
    true,
    'projected bare nonFatal was incorrectly trusted as a declared Workflow handoff'
  );
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
  const agent = new Agent(
    {
      ...buildAgentTestConfig({
        tools,
        maxIterations: 8,
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
    async (_modelId, _messages, visibleTools) => {
      modelCallCount += 1;
      modelToolSurfaces.push(visibleTools.map((tool) => tool.name));
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
        // GATE-SIMPLIFY-001：第 7 次写前观察被账本总上限（6）转为执行指令，
        // 本守卫把收窄消息交给 liveness 恢复，下一轮可见面只含已授权的交付动作。
        assert.deepStrictEqual(
          visibleTools.map((tool) => tool.name),
          ['createRectangle'],
          'merged pre-delivery observation limit did not narrow the next turn to an authorized production action'
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
    executedToolNames.slice(0, 7),
    [
      'getDocumentInfo',
      'getLayerHierarchy',
      'getDocumentInfo',
      'getLayerHierarchy',
      'getDocumentInfo',
      'getLayerHierarchy',
      'createRectangle'
    ],
    'confirmed production kept observing instead of reaching the first delivery action'
  );
  assert(modelToolSurfaces[0].includes('getDocumentInfo'));
  assert(modelToolSurfaces[1].includes('getLayerHierarchy'));
  assert(
    modelToolSurfaces.some((surface) => surface.length === 1 && surface[0] === 'createRectangle'),
    'the narrowed delivery-tool surface never reached the model'
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
  assert.deepStrictEqual(directMessages, [expectedMessage]);
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
  const blockedRead = consumePerformanceToolCallBudget({
    ledger,
    budget,
    reserveContext,
    toolName: 'getLayerHierarchy',
    toolArguments: {}
  });
  assert(blockedRead, 'excess reserve-zone observation must become an execution directive');
  assert.strictEqual(blockedRead.code, 'agent_observation_budget_reserved');
  assert.strictEqual(blockedRead.policyGate, true);
  assert.strictEqual(ledger.toolCallCount, 48, 'blocked observation must not consume tool budget');

  const writeAttempt = consumePerformanceToolCallBudget({
    ledger,
    budget,
    reserveContext,
    toolName: 'renameLayer',
    toolArguments: { layerId: 1 }
  });
  assert.strictEqual(writeAttempt, undefined, 'write-class tools must pass the reserve gate');
  const readAfterAttempt = consumePerformanceToolCallBudget({
    ledger,
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
  assert(overLimitRead, 'seventh pre-delivery observation must become an execution directive');
  assert.strictEqual(overLimitRead.code, 'agent_observation_budget_reserved');
  assert.strictEqual(
    totalLimitLedger.toolCallCount,
    6,
    'blocked observation must not consume tool budget'
  );

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

  // 场景 B：第 7 次写前观察被转为执行指令且不真正执行（总上限触发，独立于预算尾部）。
  // GATE-SIMPLIFY-001 新契约：本轮发出了指令后，若无交付工具可收窄（本场景只有读取工具），
  // 运行立即诚实停机（no_progress），不再继续把裸错误码回灌模型——模型不必收到指令原文。
  {
    const tools = [requireAgentTool('getLayerBounds')];
    let executedReads = 0;
    let readRequests = 0;
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
      async (_modelId, _messages) => {
        readRequests += 1;
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
    const runResult = await agent.run('帮我做SKU');
    assert.strictEqual(
      executedReads,
      6,
      `merged total limit must allow exactly 6 pre-delivery observations, saw ${executedReads} of ${readRequests}`
    );
    assert(readRequests >= 7, `the model must attempt the seventh observation, saw ${readRequests}`);
    assert.strictEqual(
      runResult.success,
      false,
      'a read-only-surface run that exhausts the observation allowance must stop honestly'
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
  const chatAgent = new Agent(
    buildAgentTestConfig({
      tools: [],
      maxIterations: 3,
      openingCanvasObservationMode: 'none',
      intentControlPlane: chatOnlyIntent
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
        if (JSON.stringify(message).includes('agent_observation_budget_reserved')) {
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
    'read-only analysis must never receive the execution directive'
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
 * 文档写保护兜底恢复（真机 2026-08-14）：技能包装层丢掉结构化 nextRequiredTool 字段时，
 * 失败 code=current_document_write_protected 必须仍能合成切换/打开/新建目标的恢复 allowlist，
 * 且普通失败不得误触发。
 */
async function assertProtectedDocumentWriteQueuesTargetSwitchRecovery() {
  const agent = new Agent(
    buildAgentTestConfig({
      tools: [
        requireAgentTool('switchDocument'),
        requireAgentTool('openProjectFile'),
        requireAgentTool('createDocument'),
        requireAgentTool('getDocumentInfo')
      ],
      maxIterations: 2,
      openingCanvasObservationMode: 'none'
    }),
    async () => ({ content: '未使用。', stopReason: 'end_turn' }),
    async () => {
      throw new Error('recovery fixture must not execute Tools');
    }
  );
  const protectedResult = {
    callId: 'protected-write-1',
    success: false,
    output: {
      success: false,
      policyGate: true,
      code: 'current_document_write_protected',
      message: '用户明确要求保护当前文档「详情页.psb」，已阻止对它执行修改、保存或导出。',
      error: '用户明确要求保护当前文档「详情页.psb」，已阻止对它执行修改、保存或导出。'
    }
  };
  const recovery = agent.resolveRequiredToolRecovery([protectedResult]);
  assert(recovery, 'protection-blocked write must produce a target-switch recovery');
  assert.strictEqual(recovery.isHandoff, false);
  assert.deepStrictEqual(
    [...recovery.toolNames].sort(),
    ['createDocument', 'openProjectFile', 'switchDocument'],
    'recovery must narrow to switch/open/create target'
  );

  const ordinaryFailure = {
    callId: 'ordinary-failure-1',
    success: false,
    output: { success: false, code: 'some_other_failure', error: '普通失败' }
  };
  const noRecovery = agent.resolveRequiredToolRecovery([ordinaryFailure]);
  assert.strictEqual(noRecovery, null, 'ordinary failures must not trigger the protection recovery');
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
 * 治理切片 3（GATE-SIMPLIFY-003）：终局质量 Judge 预留取消事前扣减，硬上限保留。
 * 普通任务预算不再被扣 1 次模型调用/90 秒/1 个视觉候选；Judge 仍只允许一次。
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

  // 硬上限保留：同一运行内第二次 final_quality_judge 预算类调用必须被拒绝。
  const config = buildAgentTestConfig({
    tools: [requireAgentTool('getDocumentInfo')],
    maxIterations: 2,
    openingCanvasObservationMode: 'none'
  });
  const agent = new Agent(
    config,
    async () => ({ content: 'x', stopReason: 'end_turn' }),
    async () => buildDocumentObservation()
  );
  agent.beginPerformanceModelCall(false, 'final_quality_judge');
  let secondJudgeRejected = false;
  try {
    agent.beginPerformanceModelCall(false, 'final_quality_judge');
  } catch (error) {
    secondJudgeRejected = error && error.code === 'agent_final_quality_judge_budget_exhausted';
  }
  assert(secondJudgeRejected, 'the one-call hard cap on the final quality judge must remain');
}

/**
 * 治理切片 4（GATE-SIMPLIFY-004）：视觉候选/分析/Judge 合并为单一运行级视觉池。
 * 池上限 = 候选硬上限 + 分析上限（总量不变、跨类互通）；(0,0) 零视觉语义不变。
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
  // 池 = 6 + 2 = 8：连续 8 次视觉分析放行（旧契约第 3 次即拒绝），第 9 次拒绝。
  for (let index = 0; index < 8; index += 1) {
    agent.beginPerformanceModelCall(true, 'task');
  }
  assert.strictEqual(
    agent.getRunLevelVisionBudgetLimit(),
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

/**
 * 治理切片 6（GATE-SIMPLIFY-006）：按需目录明细按能力家族分组截断——
 * 每个家族至少保留代表项明细，全局 40 行封顶不变；家族总览覆盖全部家族。
 */
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
    assert(
      prompt.includes(family),
      `capability family ${family} must be visible in the on-demand catalog`
    );
  }
  // 明细层每家族有代表：靠后家族（context.state=浏览器工具）不再被扁平 40 行截断吞掉。
  assert(
    /- context\.state\./m.test(prompt),
    'late families must keep detail representatives under per-family truncation'
  );
  assert(
    /- photoshop\.write\./m.test(prompt),
    'write families must keep detail representatives under per-family truncation'
  );
  // 全局封顶不变：仍有被省略的明细行并如实上报。
  assert(
    prompt.includes('项能力明细未展开'),
    'the global detail-line cap must remain and report omitted lines'
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
    authorizationBlocker.unlockOptions.some((option) => option.includes('createInteractiveCard')),
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

async function runBehaviorAssertions() {
  assertDesignDirectionExplorationIsOptionalAndNonAuthoritative();
  assertExecutionSupplyReservePureAccounting();
  assertFinalQualityJudgeReservationRemovedButHardCapStays();
  assertRunLevelVisionPoolMergesKindBudgets();
  assertOnDemandCatalogShowsEveryCapabilityFamilyWithDetailRepresentatives();
  assertBareContinuationResumeDecision();
  assertExecutionAuthorizationBlockerCarriesUnlockOptions();
  await assertZeroProgressWriteAuthorizedStopIsPushedBackAndEndsHonestly();
  await assertExecutionSupplyReserveGatesObservationInLiveLoop();
  await assertChatReadOnlyAndPlanRequestsNeverEnterGovernanceGates();
  await assertProtectedDocumentWriteQueuesTargetSwitchRecovery();
  await assertSuccessfulDeclarationPreservesAutonomyAndCarriesR2();
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
