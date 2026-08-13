'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const root = path.resolve(__dirname, '..');
const runtimeRoot = path.join(root, 'src', 'shared', 'agent-runtime-v5');
const rendererRuntimeRoot = path.join(root, 'src', 'renderer', 'services', 'agent-runtime');
const executorRoot = path.join(root, 'src', 'renderer', 'services', 'skill-executors');

const { listSkillManifests } = require(path.join(runtimeRoot, 'skill-runtime.ts'));
const { buildRuntimeContractBundleForAgentTask } = require(path.join(runtimeRoot, 'runtime-contract-bundle.ts'));
const {
  DETAIL_PAGE_EVALUATION_PROFILE_ID,
  DETAIL_PAGE_CREATE_NEW_EVALUATION_PROFILE_ID,
  DETAIL_PAGE_SCOPED_EDIT_EVALUATION_PROFILE_ID,
  GENERAL_DESIGN_EVALUATION_PROFILE_ID,
  GENERAL_DESIGN_SCOPED_EDIT_EVALUATION_PROFILE_ID,
  MAIN_IMAGE_EVALUATION_PROFILE_ID,
  MAIN_IMAGE_SCOPED_EDIT_EVALUATION_PROFILE_ID,
  SINGLE_CANVAS_VISUAL_EVALUATION_PROFILE_ID,
  SINGLE_CANVAS_VISUAL_SCOPED_EDIT_EVALUATION_PROFILE_ID,
  getDesignEvaluationProfileVlmAssertions
} = require(path.join(runtimeRoot, 'design-evaluation-profiles.ts'));
const {
  SCOPED_EDIT_INITIAL_CAPABILITY_IDS,
  SCOPED_EDIT_CAPABILITY_CEILING
} = require(path.join(runtimeRoot, 'scoped-edit-runtime-policy.ts'));
const { validateSkillPackageContracts } = require(path.join(runtimeRoot, 'skill-package-contract.ts'));
const { SKILL_REGISTRY } = require(path.join(root, 'src', 'shared', 'skills', 'skill-declarations.ts'));
const { buildAgentPerformancePolicy } = require(path.join(root, 'src', 'shared', 'agent-performance-policy.ts'));
const {
  classifyAgentToolExecution
} = require(path.join(root, 'src', 'shared', 'agent-tool-execution-preflight.ts'));
const {
  buildAgentCapabilityBaseline,
  buildRecommendedSkillFastPathBaseline,
  createAgentCapabilitySession,
  RECOMMENDED_SKILL_BOOTSTRAP_CAPABILITY_IDS,
  REQUEST_AGENT_CAPABILITIES_TOOL_NAME
} = require(path.join(rendererRuntimeRoot, 'capability-session.ts'));
const {
  DELEGATE_TOOL,
  TEAM_PIPELINE_TOOL,
  getDefaultAgentTools
} = require(path.join(rendererRuntimeRoot, 'tool-schemas.ts'));
const { buildSkillToolSchemas } = require(path.join(executorRoot, 'skill-tools.ts'));
const {
  resolveAutonomousCapabilityRuntime
} = require(path.join(executorRoot, 'autonomous-agent.executor.ts'));

const manifests = listSkillManifests();
const workflowBridgeTools = buildSkillToolSchemas();
const candidateTools = [
  ...getDefaultAgentTools(),
  DELEGATE_TOOL,
  TEAM_PIPELINE_TOOL,
  ...workflowBridgeTools
];
const workflowBridgeNames = workflowBridgeTools.map((tool) => tool.name);
const resolutions = new Map(manifests.map((manifest) => {
  const session = createAgentCapabilitySession({
    candidateTools,
    workflowBridgeNames,
    requestedTaskType: manifest.task_type,
    manifest
  });
  return [manifest.skill_id, session.getResolution()];
}));

const report = validateSkillPackageContracts({
  manifests,
  declarations: SKILL_REGISTRY,
  resolutions
});

assert.strictEqual(report.version, 'skill-package-contract-report/v0');
assert.strictEqual(report.status, 'valid', JSON.stringify(report.issues, null, 2));
assert.strictEqual(report.packageCount, manifests.length);
assert.strictEqual(report.validPackageCount, manifests.length);
assert.strictEqual(report.invalidPackageCount, 0);
assert(report.results.every((result) => result.requestedCapabilityKinds.length === 6));
assert(report.results.every((result) => result.boundaries.manifestIsSource === true));
assert(report.results.every((result) => result.boundaries.createsRegistry === false));
assert(report.results.every((result) => result.boundaries.claimsLiveE2E === false));

const skuManifest = manifests.find((manifest) => manifest.task_type === 'ecommerce.sku_batch.v1');
assert(skuManifest, 'sku-batch manifest missing');
assert.strictEqual(skuManifest.performance_profile?.budget.max_model_calls, 16);
assert.strictEqual(skuManifest.performance_profile?.budget.max_tool_calls, 50);
assert.strictEqual(skuManifest.performance_profile?.budget.max_iterations, 30);
assert.strictEqual(skuManifest.performance_profile?.budget.max_vision_candidates, 6);
assert.strictEqual(skuManifest.performance_profile?.budget.max_visual_analyses, 2);
assert.strictEqual(skuManifest.performance_profile?.budget.soft_time_budget_ms, 420_000);
const skuSession = createAgentCapabilitySession({
  candidateTools,
  workflowBridgeNames,
  baselineCapabilityIds: buildAgentCapabilityBaseline(true),
  requestedTaskType: skuManifest.task_type,
  manifest: skuManifest
});
assert.strictEqual(skuSession.getResolution().status, 'resolved');
const skuActiveToolNames = new Set(skuSession.activeTools.map((tool) => tool.name));
for (const requiredToolName of [
  'sku-batch',
  'listProjectResources',
  'searchProjectResources',
  'analyzeProjectContactSheetOverview',
  'createDocument',
  'createRectangle',
  'createTextLayer',
  'createSkuPlaceholders',
  'getLayerBounds',
  'getCanvasSnapshot',
  'transformLayer',
  'saveDocument',
  'getAcceptanceSnapshot'
]) {
  assert(skuActiveToolNames.has(requiredToolName), `sku template continuation missing Tool: ${requiredToolName}`);
}
assert(!skuActiveToolNames.has('deleteLayer'), 'sku template continuation unexpectedly exposes deleteLayer');

const detailManifest = manifests.find((manifest) => manifest.task_type === 'ecommerce.detail_page.v1');
assert(detailManifest, 'detail-page manifest missing');
const detailEditCeiling = detailManifest.work_mode_contracts?.edit_existing?.capability_ceiling;
assert(Array.isArray(detailEditCeiling) && detailEditCeiling.length > 0, 'detail edit capability ceiling missing');
const detailEditCeilingSet = new Set(detailEditCeiling);
const detailEditInitialCapabilityIds = detailManifest.work_mode_contracts?.edit_existing?.initial_capabilities;
assert.deepStrictEqual(
  detailEditInitialCapabilityIds,
  [...SCOPED_EDIT_INITIAL_CAPABILITY_IDS],
  'detail edit initial Capability seed drifted'
);
const detailEditSession = createAgentCapabilitySession({
  candidateTools,
  workflowBridgeNames,
  baselineCapabilityIds: buildAgentCapabilityBaseline(true),
  requestedTaskType: detailManifest.task_type,
  manifest: detailManifest,
  workMode: 'edit_existing'
});
const detailEditResolution = detailEditSession.getResolution();
assert.strictEqual(detailEditResolution.status, 'resolved', JSON.stringify(detailEditResolution.issues, null, 2));
assert.deepStrictEqual(new Set(detailEditResolution.capabilityCeilingIds), detailEditCeilingSet);
for (const capabilityId of [
  ...detailEditResolution.selectedCapabilityIds,
  ...detailEditResolution.onDemandCapabilityIds
]) {
  assert(detailEditCeilingSet.has(capabilityId), `detail edit leaked capability: ${capabilityId}`);
}
for (const forbiddenCapabilityId of [
  'agent.team.collaborate',
  'project.listResources',
  'project.searchResources',
  'eagle.read.searchReferences',
  'photoshop.sandbox.createDocument',
  'preview.renderStoryboard',
  'delivery.saveDocument',
  'delivery.exportSlices',
  'skill.detail-page-design',
  'photoshop.apply.fixDetailPageTemplate',
  'photoshop.apply.matchDetailPageContent',
  'photoshop.apply.fillDetailPageTemplate'
]) {
  assert(!detailEditResolution.selectedCapabilityIds.includes(forbiddenCapabilityId));
  assert(!detailEditResolution.onDemandCapabilityIds.includes(forbiddenCapabilityId));
}
const detailEditToolNames = new Set(detailEditSession.activeTools.map((tool) => tool.name));
for (const forbiddenToolName of [
  'delegateToAgent',
  'runDesignTeamPipeline',
  'searchEagleReferences',
  'listProjectResources',
  'searchProjectResources',
  'createDocument',
  'renderLayout',
  'saveDocument',
  'exportDetailPageSlices',
  'detail-page-design',
  'fixLayerIssues',
  'matchDetailPageContent',
  'fillDetailPage',
  'listDocuments',
  'switchDocument',
  'getDocumentSnapshot',
  'getAnnotatedSnapshot',
  'getScreenSnapshots',
  'parseDetailPageTemplate',
  'detectLayerIssues'
]) {
  assert(!detailEditToolNames.has(forbiddenToolName), `detail edit leaked tool: ${forbiddenToolName}`);
}
for (const requiredToolName of [
  'getDocumentInfo',
  'getAcceptanceSnapshot',
  'setTextContent'
]) {
  assert(detailEditToolNames.has(requiredToolName), `detail edit missing leaf tool: ${requiredToolName}`);
}
const activeBeforeForbiddenRequest = detailEditSession.activeTools.map((tool) => tool.name);
const forbiddenActivation = detailEditSession.requestCapabilities(['photoshop.sandbox.createDocument']);
assert.strictEqual(forbiddenActivation.status, 'rejected');
assert(forbiddenActivation.issues.some((issue) => issue.code === 'requested_capability_forbidden'));
assert.deepStrictEqual(
  detailEditSession.activeTools.map((tool) => tool.name),
  activeBeforeForbiddenRequest,
  'forbidden activation changed the active tool surface'
);
const scopedReadActivation = detailEditSession.requestCapabilities([
  'photoshop.read.getLayerHierarchy',
  'photoshop.read.getCanvasSnapshot'
]);
assert.strictEqual(scopedReadActivation.status, 'activated');
assert(detailEditSession.activeTools.some((tool) => tool.name === 'getLayerHierarchy'));
assert(detailEditSession.activeTools.some((tool) => tool.name === 'getCanvasSnapshot'));
const activeBeforeUnsupportedWrite = detailEditSession.activeTools.map((tool) => tool.name);
for (const unsupportedCapabilityBatch of [
  [
    'photoshop.write.renameLayer',
    'photoshop.write.setLayerOpacity',
    'photoshop.write.replaceSmartObjectContents'
  ],
  [
    'photoshop.write.replaceImagePlaceholder',
    'photoshop.write.transformLayer'
  ]
]) {
  const unsupportedWriteActivation = detailEditSession.requestCapabilities(unsupportedCapabilityBatch);
  assert.strictEqual(unsupportedWriteActivation.status, 'rejected');
  assert(unsupportedWriteActivation.issues.every((issue) => issue.code === 'requested_capability_forbidden'));
}
assert.deepStrictEqual(
  detailEditSession.activeTools.map((tool) => tool.name),
  activeBeforeUnsupportedWrite,
  'unsupported scoped write activation changed the active tool surface'
);
const lateBoundSession = createAgentCapabilitySession({
  candidateTools,
  workflowBridgeNames
});
const broadDiscoverySkillNames = new Set(workflowBridgeNames);
const broadDiscoveryInitialSkillNames = lateBoundSession.activeTools
  .map((tool) => tool.name)
  .filter((toolName) => broadDiscoverySkillNames.has(toolName));
assert.deepStrictEqual(
  broadDiscoveryInitialSkillNames,
  [],
  'broad discovery without one recommendation exposed every Skill schema'
);
for (const workflowBridgeName of workflowBridgeNames) {
  assert(
    lateBoundSession.getResolution().onDemandCapabilityIds.includes(`skill.${workflowBridgeName}`),
    `broad discovery lost on-demand Skill reachability: ${workflowBridgeName}`
  );
  assert(
    lateBoundSession.buildPromptSection().includes(`skill.${workflowBridgeName}`),
    `broad discovery prompt lost compact Skill discovery id: ${workflowBridgeName}`
  );
}

assert(workflowBridgeTools.length >= 2, 'first-turn Skill surface audit needs at least two user-facing Skills');
const recommendedWorkflowBridge = workflowBridgeTools[0];
const onDemandWorkflowBridge = workflowBridgeTools[1];
const recommendedSession = createAgentCapabilitySession({
  candidateTools,
  workflowBridgeNames,
  baselineCapabilityIds: buildRecommendedSkillFastPathBaseline(
    `skill.${recommendedWorkflowBridge.name}`
  )
});
const recommendedResolution = recommendedSession.getResolution();
const recommendedInitialSkillNames = recommendedSession.activeTools
  .map((tool) => tool.name)
  .filter((toolName) => broadDiscoverySkillNames.has(toolName));
assert.deepStrictEqual(
  recommendedInitialSkillNames,
  [recommendedWorkflowBridge.name],
  'a unique advisory recommendation did not seed exactly one Skill schema'
);
assert.strictEqual(recommendedResolution.manifestRef, undefined, 'advisory recommendation bound a Runtime Manifest');
assert(
  recommendedResolution.onDemandCapabilityIds.includes(`skill.${onDemandWorkflowBridge.name}`),
  'a non-recommended Skill is no longer available on demand'
);
assert(
  recommendedSession.buildPromptSection().includes(`skill.${onDemandWorkflowBridge.name}`),
  'a non-recommended Skill id is missing from the compact capability catalog'
);
for (const readOnlyBootstrapTool of [
  'getDocumentInfo',
  'getCanvasSnapshot',
  'getLayerHierarchy',
  'listProjectResources',
  'searchProjectResources'
]) {
  assert(
    recommendedSession.activeTools.some((tool) => tool.name === readOnlyBootstrapTool),
    `recommended Skill fast path lost a readonly bootstrap Tool: ${readOnlyBootstrapTool}`
  );
}
for (const capabilityId of RECOMMENDED_SKILL_BOOTSTRAP_CAPABILITY_IDS) {
  const inventoryEntry = recommendedSession.inventory.find((entry) => entry.capabilityId === capabilityId);
  assert(inventoryEntry, `recommended Skill bootstrap Capability is unavailable: ${capabilityId}`);
  assert.strictEqual(
    inventoryEntry.providerToolNames.length,
    1,
    `recommended Skill bootstrap Capability fan-out grew: ${capabilityId}`
  );
  assert.strictEqual(
    classifyAgentToolExecution(inventoryEntry.providerToolNames[0]),
    'read_only_observation',
    `recommended Skill bootstrap provider is no longer readonly: ${capabilityId}`
  );
}
assert(
  recommendedSession.activeTools.length < 12,
  `recommended Skill first-turn Tool count exceeded fast-path budget: ${recommendedSession.activeTools.length}`
);
for (const activeTool of recommendedSession.activeTools) {
  if (activeTool.name === recommendedWorkflowBridge.name
    || activeTool.name === REQUEST_AGENT_CAPABILITIES_TOOL_NAME) {
    continue;
  }
  assert.strictEqual(
    classifyAgentToolExecution(activeTool.name),
    'read_only_observation',
    `recommended Skill fast path exposed a generic non-read Tool: ${activeTool.name}`
  );
}
const candidateSchemaBytes = Buffer.byteLength(JSON.stringify(candidateTools), 'utf8');
const firstTurnSchemaBytes = Buffer.byteLength(JSON.stringify(recommendedSession.activeTools), 'utf8');
assert(
  firstTurnSchemaBytes < candidateSchemaBytes * 0.15,
  `first-turn schema did not contract materially: ${firstTurnSchemaBytes}/${candidateSchemaBytes}`
);
const onDemandSkillActivation = recommendedSession.requestCapabilities([
  `skill.${onDemandWorkflowBridge.name}`
]);
assert.strictEqual(onDemandSkillActivation.status, 'activated');
assert(
  recommendedSession.activeTools.some((tool) => tool.name === onDemandWorkflowBridge.name),
  'a non-recommended Skill could not be loaded on demand'
);

const recommendedRoutingRecord = {
  version: 'skill-routing-recommendation/v0',
  skillId: recommendedWorkflowBridge.name,
  capabilityId: `skill.${recommendedWorkflowBridge.name}`,
  source: 'unique_declared_routing_match',
  advisoryOnly: true,
  bindsRuntimeIdentity: false,
  grantsPermission: false
};
const productionFastPath = resolveAutonomousCapabilityRuntime({
  agentIntentControlPlane: {
    toolScope: 'write_photoshop',
    executionAuthorization: 'confirmed_tool_required'
  },
  skillRoutingRecommendation: recommendedRoutingRecord
}, {}).capabilitySession;
assert(productionFastPath.activeTools.length < 12, 'production recommendation fast path exceeded Tool budget');
assert.deepStrictEqual(
  productionFastPath.activeTools
    .map((tool) => tool.name)
    .filter((toolName) => broadDiscoverySkillNames.has(toolName)),
  [recommendedWorkflowBridge.name],
  'production recommendation fast path did not expose exactly one Skill'
);
const productionBroadDiscovery = resolveAutonomousCapabilityRuntime({
  agentIntentControlPlane: {
    toolScope: 'write_photoshop',
    executionAuthorization: 'confirmed_tool_required'
  }
}, {}).capabilitySession;
const invalidMultiRecommendation = resolveAutonomousCapabilityRuntime({
  agentIntentControlPlane: {
    toolScope: 'write_photoshop',
    executionAuthorization: 'confirmed_tool_required'
  },
  skillRoutingRecommendation: [recommendedRoutingRecord, recommendedRoutingRecord]
}, {}).capabilitySession;
assert(
  productionBroadDiscovery.activeTools.some((tool) => tool.name === 'createDocument'),
  'no-recommendation path no longer preserves broad discovery'
);
assert.deepStrictEqual(
  invalidMultiRecommendation.activeTools.map((tool) => tool.name),
  productionBroadDiscovery.activeTools.map((tool) => tool.name),
  'invalid or multi recommendation did not fall back to broad discovery'
);

const broadActivation = lateBoundSession.requestCapabilities([
  'agent.team.collaborate',
  'photoshop.read.getLayerBounds'
]);
assert.strictEqual(broadActivation.status, 'activated');
lateBoundSession.bindManifest(detailManifest, 'edit_existing');
assert.strictEqual(lateBoundSession.getResolution().status, 'resolved');
assert(!lateBoundSession.getResolution().selectedCapabilityIds.includes('agent.team.collaborate'));
assert(!lateBoundSession.getResolution().onDemandCapabilityIds.includes('agent.team.collaborate'));
assert(!lateBoundSession.getOnDemandActivatedCapabilityIds().includes('agent.team.collaborate'));
assert(!lateBoundSession.activeTools.some((tool) => tool.name === 'delegateToAgent'));
assert(lateBoundSession.getOnDemandActivatedCapabilityIds().includes('photoshop.read.getLayerBounds'));
assert(lateBoundSession.activeTools.some((tool) => tool.name === 'getLayerBounds'));

const detailMethodBundle = buildRuntimeContractBundleForAgentTask({
  taskType: detailManifest.task_type,
  skillId: 'design.reference_replication',
  workMode: 'edit_existing',
  executableToolNames: candidateTools.map((tool) => tool.name)
});
assert(detailMethodBundle, 'detail edit method-overlay bundle missing');
assert.strictEqual(detailMethodBundle.methodManifests.length, 1, 'detail edit method overlay was not resolved');
assert.strictEqual(detailMethodBundle.methodManifests[0]?.skill_id, 'design.reference_replication');
const detailMethodSession = createAgentCapabilitySession({
  candidateTools,
  workflowBridgeNames,
  manifest: detailMethodBundle.manifest,
  workMode: 'edit_existing'
});
for (const capabilityId of [
  ...detailMethodSession.getResolution().selectedCapabilityIds,
  ...detailMethodSession.getResolution().onDemandCapabilityIds
]) {
  assert(detailEditCeilingSet.has(capabilityId), `method overlay expanded detail edit ceiling: ${capabilityId}`);
}
const detailEditE1 = detailMethodBundle.stagePlan.steps.find((step) => step.stage === 'E1');
assert(detailEditE1, 'detail edit E1 stage missing');
assert.deepStrictEqual(new Set(detailEditE1.allowedToolCapabilities), detailEditCeilingSet);

const scopedEditExpectations = [
  {
    taskType: 'ecommerce.detail_page.v1',
    skillId: 'ecommerce.detail_page',
    editProfileId: DETAIL_PAGE_SCOPED_EDIT_EVALUATION_PROFILE_ID,
    defaultProfileId: DETAIL_PAGE_EVALUATION_PROFILE_ID,
    createProfileId: DETAIL_PAGE_CREATE_NEW_EVALUATION_PROFILE_ID
  },
  {
    taskType: 'ecommerce.main_image.v1',
    skillId: 'ecommerce.main_image',
    editProfileId: MAIN_IMAGE_SCOPED_EDIT_EVALUATION_PROFILE_ID,
    defaultProfileId: MAIN_IMAGE_EVALUATION_PROFILE_ID,
    createProfileId: MAIN_IMAGE_EVALUATION_PROFILE_ID
  },
  {
    taskType: 'design.single_canvas_visual.v1',
    skillId: 'design.single_canvas_visual',
    editProfileId: SINGLE_CANVAS_VISUAL_SCOPED_EDIT_EVALUATION_PROFILE_ID,
    defaultProfileId: SINGLE_CANVAS_VISUAL_EVALUATION_PROFILE_ID,
    createProfileId: SINGLE_CANVAS_VISUAL_EVALUATION_PROFILE_ID
  },
  {
    taskType: 'design.generic.v1',
    skillId: 'design.general',
    editProfileId: GENERAL_DESIGN_SCOPED_EDIT_EVALUATION_PROFILE_ID,
    defaultProfileId: GENERAL_DESIGN_EVALUATION_PROFILE_ID,
    createProfileId: GENERAL_DESIGN_EVALUATION_PROFILE_ID
  }
];
const sharedScopedEditCeilingSet = new Set(SCOPED_EDIT_CAPABILITY_CEILING);
const sharedScopedEditInitialSet = new Set(SCOPED_EDIT_INITIAL_CAPABILITY_IDS);
for (const expectation of scopedEditExpectations) {
  const manifest = manifests.find((candidate) => candidate.task_type === expectation.taskType);
  assert(manifest, `scoped edit manifest missing: ${expectation.taskType}`);
  const modeContract = manifest.work_mode_contracts?.edit_existing;
  assert(modeContract, `scoped edit contract missing: ${expectation.taskType}`);
  assert.deepStrictEqual(
    new Set(modeContract.capability_ceiling),
    sharedScopedEditCeilingSet,
    `scoped edit ceiling drifted: ${expectation.taskType}`
  );
  assert.deepStrictEqual(
    new Set(modeContract.initial_capabilities),
    sharedScopedEditInitialSet,
    `scoped edit initial Capability seed drifted: ${expectation.taskType}`
  );
  assert.strictEqual(modeContract.production_obligation, 'photoshop_mutation_with_readback');
  assert.strictEqual(modeContract.execution_scope_kind, 'exact_text_replacement');
  assert.deepStrictEqual(modeContract.runtime_stages, ['R0', 'R1', 'R2', 'E1', 'R5']);
  assert.strictEqual(modeContract.performance_profile?.budget.max_model_calls, 6);
  assert.strictEqual(modeContract.performance_profile?.budget.max_tool_calls, 12);
  assert.strictEqual(modeContract.performance_profile?.budget.max_iterations, 8);
  assert.strictEqual(modeContract.performance_profile?.budget.max_vision_candidates, 1);
  assert.strictEqual(modeContract.performance_profile?.cost_profile.model_call_class, 'text-light');
  const editPerformancePolicy = buildAgentPerformancePolicy({
    taskType: expectation.taskType,
    workMode: 'edit_existing',
    requiresPhotoshop: true
  });
  assert.strictEqual(editPerformancePolicy.budget.maxModelCalls, 6);
  assert.strictEqual(editPerformancePolicy.budget.maxToolCalls, 12);
  assert.strictEqual(editPerformancePolicy.budget.maxIterations, 8);
  assert.strictEqual(editPerformancePolicy.budget.maxVisionCandidates, 1);
  assert.strictEqual(editPerformancePolicy.costProfile.modelCallClass, 'text-light');

  const editBundle = buildRuntimeContractBundleForAgentTask({
    taskType: expectation.taskType,
    workMode: 'edit_existing',
    executableToolNames: candidateTools.map((tool) => tool.name)
  });
  assert(editBundle, `scoped edit bundle missing: ${expectation.taskType}`);
  assert.strictEqual(editBundle.artifactManifest?.skill_id, expectation.skillId);
  assert.strictEqual(editBundle.evaluationProfile?.profileId, expectation.editProfileId);
  assert.strictEqual(editBundle.evaluationProfile?.skillId, expectation.skillId);
  assert.strictEqual(editBundle.evaluationProfile?.taskType, expectation.taskType);
  assert.strictEqual(
    getDesignEvaluationProfileVlmAssertions(editBundle.evaluationProfile).length,
    0,
    `scoped edit unexpectedly requires full-canvas VLM: ${expectation.taskType}`
  );
  assert.deepStrictEqual(
    editBundle.stagePlan.steps.map((step) => step.stage),
    ['R0', 'R1', 'R2', 'E1', 'R5']
  );
  assert.deepStrictEqual(
    new Set(editBundle.stagePlan.steps.find((step) => step.stage === 'E1')?.allowedToolCapabilities),
    sharedScopedEditCeilingSet
  );

  const editSession = createAgentCapabilitySession({
    candidateTools,
    workflowBridgeNames,
    baselineCapabilityIds: buildAgentCapabilityBaseline(true),
    requestedTaskType: expectation.taskType,
    manifest: editBundle.manifest,
    workMode: 'edit_existing'
  });
  const editResolution = editSession.getResolution();
  assert.strictEqual(editResolution.status, 'resolved', JSON.stringify(editResolution.issues, null, 2));
  assert.deepStrictEqual(
    new Set(editResolution.selectedCapabilityIds),
    sharedScopedEditInitialSet,
    `scoped edit startup exposed more than the minimal seed: ${expectation.taskType}`
  );
  for (const capabilityId of [
    ...editResolution.selectedCapabilityIds,
    ...editResolution.onDemandCapabilityIds
  ]) {
    assert(sharedScopedEditCeilingSet.has(capabilityId), `scoped edit leaked capability: ${expectation.taskType}:${capabilityId}`);
  }
  const editToolNames = new Set(editSession.activeTools.map((tool) => tool.name));
  for (const forbiddenToolName of [
    'delegateToAgent',
    'runDesignTeamPipeline',
    'searchEagleReferences',
    'listProjectResources',
    'searchProjectResources',
    'createDocument',
    'renderLayout',
    'saveDocument',
    'quickExport',
    'getScreenSnapshots',
    'parseDetailPageTemplate',
    'detectLayerIssues',
    'detail-page-design',
    'main-image-design'
  ]) {
    assert(!editToolNames.has(forbiddenToolName), `scoped edit leaked tool: ${expectation.taskType}:${forbiddenToolName}`);
  }
  for (const requiredToolName of [
    'getDocumentInfo',
    'getAcceptanceSnapshot',
    'setTextContent'
  ]) {
    assert(editToolNames.has(requiredToolName), `scoped edit missing leaf tool: ${expectation.taskType}:${requiredToolName}`);
  }

  const defaultBundle = buildRuntimeContractBundleForAgentTask({
    taskType: expectation.taskType,
    executableToolNames: candidateTools.map((tool) => tool.name)
  });
  assert(defaultBundle, `default bundle regressed: ${expectation.taskType}`);
  assert.strictEqual(defaultBundle.evaluationProfile?.profileId, expectation.defaultProfileId);
  assert.deepStrictEqual(
    defaultBundle.stagePlan.steps.map((step) => step.stage),
    ['R0', 'R1', 'R2', 'R3', 'R4', 'E1', 'R5', 'E2']
  );
  const defaultSession = createAgentCapabilitySession({
    candidateTools,
    workflowBridgeNames,
    requestedTaskType: expectation.taskType,
    manifest: defaultBundle.manifest
  });
  assert.strictEqual(defaultSession.getResolution().capabilityCeilingIds, undefined);

  for (const fullWorkMode of ['create_new', 'redesign']) {
    assert.strictEqual(
      manifest.work_mode_contracts?.[fullWorkMode]?.execution_scope_kind,
      undefined,
      `full design mode unexpectedly requires exact text scope: ${expectation.taskType}:${fullWorkMode}`
    );
    const fullModeBundle = buildRuntimeContractBundleForAgentTask({
      taskType: expectation.taskType,
      workMode: fullWorkMode,
      executableToolNames: candidateTools.map((tool) => tool.name)
    });
    assert(fullModeBundle, `${fullWorkMode} bundle regressed: ${expectation.taskType}`);
    assert.strictEqual(
      fullModeBundle.evaluationProfile?.profileId,
      fullWorkMode === 'create_new' ? expectation.createProfileId : expectation.defaultProfileId
    );
    assert.deepStrictEqual(
      fullModeBundle.stagePlan.steps.map((step) => step.stage),
      ['R0', 'R1', 'R2', 'R3', 'R4', 'E1', 'R5', 'E2']
    );
    const fullModeSession = createAgentCapabilitySession({
      candidateTools,
      workflowBridgeNames,
      requestedTaskType: expectation.taskType,
      manifest: fullModeBundle.manifest,
      workMode: fullWorkMode
    });
    assert.strictEqual(fullModeSession.getResolution().capabilityCeilingIds, undefined);
    const fullModePerformancePolicy = buildAgentPerformancePolicy({
      taskType: expectation.taskType,
      workMode: fullWorkMode,
      requiresPhotoshop: true
    });
    assert(
      fullModePerformancePolicy.budget.maxModelCalls > editPerformancePolicy.budget.maxModelCalls,
      `${fullWorkMode} was accidentally reduced to scoped-edit model budget: ${expectation.taskType}`
    );
    assert(
      fullModePerformancePolicy.budget.maxIterations > editPerformancePolicy.budget.maxIterations,
      `${fullWorkMode} was accidentally reduced to scoped-edit iteration budget: ${expectation.taskType}`
    );
  }
}

const invalidManifest = {
  ...manifests[0],
  skill_id: 'fixture.invalid',
  task_type: 'fixture.invalid.v1',
  version: 'latest',
  required_inputs: [],
  optional_inputs: [],
  // 同时触发两个负向 code：缺最小必需阶段 R5（runtime_stage_missing）+ R2 排在 R1 前（runtime_stage_order_invalid）。
  runtime_stages: ['R0', 'R2', 'R1', 'E1'],
  legacy_skill_ids: [],
  available_tools: ['unknown.action'],
  forbidden_tools: ['unknown.action'],
  knowledge_refs: [],
  primary_method_tool_ref: 'tool:fixture.missing',
  memory_refs: [],
  evaluation_refs: [],
  policy_refs: [],
  review_rubric_ref: undefined,
  work_mode_contracts: {
    edit_existing: {
      required_inputs: ['existing_document'],
      optional_inputs: [],
      delivery_outputs: ['updated_document'],
      exit_criteria: ['fixture only'],
      review_rubric_ref: 'rubrics/fixture-mode.v1',
      initial_capabilities: ['photoshop.sandbox.createDocument'],
      capability_ceiling: []
    }
  },
  delivery_outputs: [],
  exit_criteria: []
};
const invalidReport = validateSkillPackageContracts({
  manifests: [invalidManifest],
  declarations: SKILL_REGISTRY,
  resolutions: new Map()
});
assert.strictEqual(invalidReport.status, 'invalid');
const invalidCodes = new Set(invalidReport.issues.map((issue) => issue.code));
for (const expected of [
  'invalid_version',
  'required_input_missing',
  'runtime_stage_missing',
  'runtime_stage_order_invalid',
  'initial_capability_outside_ceiling',
  'capability_ceiling_empty',
  'tool_allow_deny_overlap',
  'capability_kind_missing',
  'primary_method_tool_unbound',
  'review_rubric_unbound',
  'delivery_contract_missing',
  'exit_criteria_missing',
  'capability_resolution_missing'
]) {
  assert(invalidCodes.has(expected), `missing negative issue: ${expected}`);
}
assert(invalidReport.issues.some((issue) => (
  issue.path === 'work_mode_contracts.edit_existing.review_rubric_ref'
  && issue.code === 'review_rubric_unbound'
)));

const validatorSource = fs.readFileSync(
  path.join(runtimeRoot, 'skill-package-contract.ts'),
  'utf8'
);
assert(!/main.?image|detail.?page|sku/i.test(validatorSource));
assert(!validatorSource.includes('executeTool('));
assert(!validatorSource.includes('new Map(input.manifests.map'));

console.log(JSON.stringify({
  success: true,
  packageCount: report.packageCount,
  validPackages: report.results.map((result) => ({
    skillId: result.skillId,
    taskType: result.taskType,
    declarationIds: result.declarationIds,
    capabilityKinds: result.requestedCapabilityKinds
  })),
  negativeIssueCodes: Array.from(invalidCodes).sort(),
  boundaries: report.boundaries
}, null, 2));
