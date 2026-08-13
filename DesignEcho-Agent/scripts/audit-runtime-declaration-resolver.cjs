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
  buildAutonomousExecutionDecisionForEngine
} = require(path.resolve(
  __dirname,
  '..',
  'src',
  'shared',
  'agent-intent-control-plane.ts'
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
    toolDecisionContext: {
      intentControlPlane: buildAutonomousExecutionDecisionForEngine('runtime-declaration-audit'),
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
  assert.strictEqual(agent.performanceModelCallCount, 1);
  assert.notStrictEqual(result.stopReason, 'provider_output_truncated');
}

async function runBehaviorAssertions() {
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
  await assertProviderTruncationRecoveryDoesNotSpendTaskModelBudget();
  console.log(
    `[runtime-declaration-resolver] ${catalog.declarableProfiles.length} profiles ready, `
    + `${catalog.blockedProfiles.length} profiles blocked; live Agent declaration behavior passed.`
  );
}

runBehaviorAssertions().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
