'use strict';

/**
 * Static governance audit for Capability Resolver boundaries.
 *
 * This intentionally checks control-plane ownership, not business behavior:
 * no task-text category routing, no parallel registry, one production wiring
 * point, and capability loading stays distinct from execution authorization.
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const files = {
  resolver: 'src/shared/agent-runtime-v5/capability-resolver.ts',
  contract: 'src/shared/agent-runtime-v5/contracts/capability-resolution.ts',
  commonContract: 'src/shared/agent-runtime-v5/contracts/common.ts',
  creativeStrategyContract: 'src/shared/agent-runtime-v5/contracts/creative-strategy.ts',
  reviewReportContract: 'src/shared/agent-runtime-v5/contracts/review-report.ts',
  providerIdentities: 'src/shared/agent-runtime-v5/capability-provider-identities.ts',
  evaluationProfiles: 'src/shared/agent-runtime-v5/design-evaluation-profiles.ts',
  evaluationResultAdapters: 'src/shared/agent-runtime-v5/design-evaluation-result-adapters.ts',
  evaluationResultAdapterContributions: 'src/shared/agent-runtime-v5/design-evaluation-result-adapter-contributions.ts',
  detailPageContentVerification: 'src/shared/detail-page-content-verification.ts',
  projectFactProvenance: 'src/shared/design-project-fact-provenance.ts',
  projectFactReviewCard: 'src/shared/design-project-fact-review-card.ts',
  projectRuleGovernance: 'src/shared/design-project-rule-governance.ts',
  projectRuleReviewCard: 'src/shared/design-project-rule-review-card.ts',
  knowledgeGovernance: 'src/shared/design-knowledge-governance.ts',
  skuHumanReview: 'src/shared/sku-human-review.ts',
  humanReviewRecord: 'src/shared/human-review-record.ts',
  qualityAssertions: 'src/shared/design-quality-assertion.ts',
  reflexionPolicy: 'src/shared/reflexion-reentry-policy.ts',
  projectStateContract: 'src/shared/types/design-project-state.types.ts',
  qualityVerdict: 'src/shared/design-quality-verdict-bundle.ts',
  qualityCompletionContract: 'src/renderer/services/agent-runtime/task-completion-contract.ts',
  designTeamVerdict: 'src/shared/design-team-verdict.ts',
  designTeamRegistry: 'src/renderer/services/design-teams/registry.ts',
  designTeamCoordinator: 'src/renderer/services/design-teams/coordinator.ts',
  designDiscipline: 'src/shared/design-discipline-runtime.ts',
  toolSafety: 'src/shared/tool-safety-policy.ts',
  bundle: 'src/shared/agent-runtime-v5/runtime-contract-bundle.ts',
  stagePlan: 'src/shared/agent-runtime-v5/runtime-stage-plan.ts',
  skillRuntime: 'src/shared/agent-runtime-v5/skill-runtime.ts',
  skillRuntimeRegistry: 'src/shared/agent-runtime-v5/skill-runtime-registry.ts',
  scopedChangeRecords: 'src/shared/agent-runtime-v5/runtime-scoped-change-records.ts',
  session: 'src/renderer/services/agent-runtime/capability-session.ts',
  executor: 'src/renderer/services/skill-executors/autonomous-agent.executor.ts',
  engine: 'src/renderer/services/design-agent/engine.ts',
  agent: 'src/renderer/services/agent-runtime/agent.ts',
  agentTypes: 'src/renderer/services/agent-runtime/types.ts',
  toolExecutor: 'src/renderer/services/tool-executor.service.ts',
  skillTools: 'src/renderer/services/skill-executors/skill-tools.ts',
  skillExecutorTypes: 'src/renderer/services/skill-executors/types.ts',
  skuExecutor: 'src/renderer/services/skill-executors/sku-batch.executor.ts',
  decisionContract: 'src/shared/agent-tool-decision-contract.ts',
  preflight: 'src/shared/agent-tool-execution-preflight.ts',
  designBrief: 'src/shared/agent-runtime-v5/runtime-design-brief-declaration.ts',
  productUnderstanding: 'src/shared/project-product-understanding.ts',
  projectUnderstandingSummary: 'src/shared/project-design-understanding-summary.ts',
  strategy: 'src/shared/agent-runtime-v5/runtime-design-strategy-declaration.ts',
  actionPlan: 'src/shared/agent-runtime-v5/runtime-action-plan-declaration.ts',
  actionExecutionPack: 'src/shared/agent-runtime-v5/runtime-action-execution-pack.ts',
  actionPlanObservation: 'src/shared/agent-runtime-v5/runtime-action-plan-observation.ts',
  actionPlanReconciliation: 'src/shared/agent-runtime-v5/runtime-action-plan-reconciliation.ts',
  actionPlanResumeFreshness: 'src/shared/agent-runtime-v5/runtime-action-plan-resume-freshness.ts',
  actionPlanNoRedoShadow: 'src/shared/agent-runtime-v5/runtime-action-plan-no-redo-shadow.ts',
  selectedSkillHandoff: 'src/shared/agent-runtime-v5/runtime-selected-skill-handoff.ts',
  runtimeSession: 'src/shared/agent-runtime-v5/runtime-session.ts',
  pendingContinuation: 'src/shared/pending-interactive-continuation.ts',
  planningContext: 'src/shared/agent-runtime-v5/runtime-planning-context-seed.ts',
  noRedoProviderProbe: 'src/shared/agent-no-redo-provider-probe.ts',
  realProviderRunner: 'scripts/acceptance-run-agent-real-provider-case.cjs',
  runRecord: 'src/shared/agent-run-record.ts',
  runResume: 'src/shared/agent-run-resume.ts',
  generalManifest: 'src/shared/agent-runtime-v5/manifests/general-design.manifest.ts',
  toolCapabilityBridge: 'src/shared/agent-runtime-v5/tool-capability-bridge.ts',
  uxpRenameLayer: '../DesignEcho-UXP/src/tools/layout/rename-layer.ts',
  uxpGroupLayersSafely: '../DesignEcho-UXP/src/tools/layout/group-layers-safely.ts',
  uxpMoveLayer: '../DesignEcho-UXP/src/tools/layout/move-layer.ts',
  uxpLockLayer: '../DesignEcho-UXP/src/tools/layer/layer-properties.ts',
  uxpSetTextStyle: '../DesignEcho-UXP/src/tools/text/set-text-style.ts'
};

const source = Object.fromEntries(
  Object.entries(files).map(([key, file]) => [key, read(file)])
);
const violations = [];

function requireToken(fileKey, token, message) {
  if (!source[fileKey].includes(token)) violations.push(message);
}

function forbidPattern(fileKey, pattern, message) {
  if (pattern.test(source[fileKey])) violations.push(message);
}

requireToken('resolver', 'buildRuntimeCapabilityInventory', 'Resolver must consume runtime inventory.');
requireToken('resolver', 'LEGACY_TOOL_CAPABILITY_MAP', 'Resolver must reuse the existing legacy capability bridge.');
requireToken('resolver', 'getPhotoshopToolSkillSemantics', 'Resolver must reuse the shared Tool semantics source.');
requireToken('resolver', "source: 'tool_semantics'", 'Reviewed Tool semantics must remain explicit in runtime inventory.');
requireToken('resolver', 'semanticMetadata', 'Tool semantic metadata must be preserved for runtime governance.');
requireToken('resolver', "source: 'legacy_unclassified_tool'", 'Unclassified eligible tools must remain explicitly discoverable.');
requireToken('resolver', 'expandAgentCapabilities', 'Resolver must support Planner-requested on-demand expansion.');
requireToken('resolver', 'deniedToolNames', 'Forbidden capabilities must close over shared legacy provider Tools.');
requireToken('resolver', 'MAX_ON_DEMAND_CAPABILITY_REQUESTS', 'On-demand expansion must have a server-side batch budget.');
requireToken('resolver', 'initialCapabilityIds', 'Resolver must accept a work-mode-owned minimal initial Capability seed.');
requireToken('resolver', 'capabilityCeilingIds', 'Resolver must support a work-mode-owned Capability allow ceiling.');
requireToken('resolver', 'isWithinCapabilityCeiling', 'Manifest seeds and on-demand discovery must share the same ceiling membership check.');
requireToken('resolver', 'manifestOwnedDeniedCapabilityIds', 'Bound Manifest must deny non-owner Skill bridges across initial, on-demand and expansion.');
requireToken('resolver', 'manifestRetiredControlCapabilityIds', 'Bound Manifest must retire one-shot control capabilities after identity binding.');
requireToken('resolver', "'agent.intent.declareDesignTask'", 'Bound Manifest must retire the one-shot design declaration capability.');
requireToken('session', 'resolveSkillRuntimeInitialCapabilities', 'Capability Session must resolve the work-mode initial seed from the shared Skill Runtime owner.');
requireToken('session', 'resolveSkillRuntimeCapabilityCeiling', 'Capability Session must resolve the artifact work-mode ceiling from the shared Skill Runtime owner.');
requireToken('session', 'onDemandActivatedCapabilityIds.clear()', 'Manifest rebinding must discard previously activated capabilities outside the new ceiling.');
if (!/createAgentCapabilitySession\(\{[\s\S]{0,500}manifest:\s*runtimeContractBundle\?\.manifest,[\s\S]{0,160}workMode:\s*runtimeContractBundle\?\.stagePlan\.expectedWorkMode/.test(source.executor)) {
  violations.push('Production startup Capability Session must receive the pre-bound Runtime workMode ceiling.');
}
if (!/capabilitySession\.bindManifest\(\s*candidateBundle\.manifest,\s*candidateBundle\.stagePlan\.expectedWorkMode\s*\)/.test(source.executor)) {
  violations.push('Production late binding must apply the declared workMode ceiling to the existing Capability Session.');
}
forbidPattern('resolver', /deferSkillBridgesUntilManifest|deferredCapabilityIds/, 'Advisory workflow recommendations must not create a deferred Skill capability class.');
forbidPattern('resolver', /broadDiscoverySkillBridgeIds/, 'Broad discovery must not preload every user-facing Skill schema.');
forbidPattern('contract', /deferredCapabilityIds/, 'Capability Resolution must not encode advisory recommendations as a temporary deny boundary.');
forbidPattern('session', /deferSkillBridgesUntilManifest|shouldBlockPlanNeutralCostlyDesignCapability/, 'Capability Session must not convert an advisory recommendation into an observation gate.');
forbidPattern('agentTypes', /requiredControlTool/, 'Agent config must not contain a recommendation-derived mandatory control Tool.');
forbidPattern('executor', /hasPendingRuntimeDesignWorkflowRecommendation|requiredControlTool|runtime_design_identity_required_before_costly_observation/, 'Executor must not convert an advisory Skill recommendation into a mandatory Runtime declaration gate.');
forbidPattern('agent', /requiredControlTool/, 'Agent must not narrow its Tool surface from an advisory business recommendation.');
requireToken('executor', 'const exposeSkillRoutingRecommendation = Boolean(skillRoutingRecommendation);', 'Advisory workflow recommendation must remain visible without becoming a declaration obligation.');
requireToken('session', 'RECOMMENDED_SKILL_BOOTSTRAP_CAPABILITY_IDS', 'Unique Skill recommendation must reuse one generic readonly bootstrap seed.');
requireToken('session', 'buildRecommendedSkillFastPathBaseline', 'Unique Skill recommendation must have one stateless baseline builder.');
requireToken('executor', 'const useRecommendedSkillFastPath = Boolean(', 'Executor must select the recommendation fast path without a business branch.');
if (!/buildRecommendedSkillFastPathBaseline\(skillRoutingRecommendation\.capabilityId\)/.test(source.executor)) {
  violations.push('A unique advisory Skill recommendation must seed only its Capability plus the generic readonly bootstrap.');
}
const recommendedFastPathStart = source.executor.indexOf('const useRecommendedSkillFastPath = Boolean(');
const recommendedFastPathEnd = source.executor.indexOf('return {', recommendedFastPathStart);
const recommendedFastPath = recommendedFastPathStart >= 0 && recommendedFastPathEnd > recommendedFastPathStart
  ? source.executor.slice(recommendedFastPathStart, recommendedFastPathEnd)
  : '';
if (!recommendedFastPath.includes('!runtimeContractBundle')
  || !recommendedFastPath.includes('!areSkillBridgesForbidden(params)')) {
  violations.push('Recommendation fast path must remain advisory-only and must not replace a bound Manifest or bypass Skill denial.');
}
if (/SKU|详情页|主图|sku-batch|detail-page-design|main-image-design/i.test(recommendedFastPath)) {
  violations.push('Recommendation fast path contains a business-specific branch or label.');
}
requireToken('session', '还可按需加入的能力：', 'Non-prefetched Skills must remain discoverable through a compact on-demand id catalog.');
requireToken('agent', 'this.carryPlanNeutralObservationIntoBoundRuntime();', 'Late Runtime binding must carry the same-run opening observation instead of forcing a duplicate read.');
requireToken('agent', 'emitDeterministicPreActionDisclosureBeforeFirstToolResult', 'Pure first-turn Tool calls must use a deterministic Harness progress disclosure.');
forbidPattern('agent', /requestInitialVisibleReasoningIfNeeded/, 'Pure first-turn Tool calls must not trigger an auxiliary model request for progress prose.');
const deterministicDisclosureStart = source.agent.indexOf('private emitDeterministicPreActionDisclosureBeforeFirstToolResult(');
const deterministicDisclosureEnd = source.agent.indexOf(
  'private shouldRequireUserVisiblePreActionRationaleForToolCalls(',
  deterministicDisclosureStart
);
const deterministicDisclosure = deterministicDisclosureStart >= 0
  && deterministicDisclosureEnd > deterministicDisclosureStart
  ? source.agent.slice(deterministicDisclosureStart, deterministicDisclosureEnd)
  : '';
if (!deterministicDisclosure.includes('this.currentTask')
  || !deterministicDisclosure.includes('getToolDisplayInfo')
  || deterministicDisclosure.includes('callModelWithAccounting(')) {
  violations.push('Deterministic pre-action disclosure must use the user goal plus Tool/Skill display info without another model call.');
}
if (/SKU|详情页|主图|sku-batch|detail-page-design|main-image-design/i.test(deterministicDisclosure)) {
  violations.push('Deterministic pre-action disclosure contains a business-specific branch or label.');
}
const requiredControlNoCallIndex = source.agent.indexOf('this.handleRequiredToolNoCallConstraint(response)');
const genericNoToolCompletionIndex = source.agent.indexOf('const unfinishedTurnContinues = this.applyUnfinishedTurnContinuation({');
if (requiredControlNoCallIndex < 0
  || genericNoToolCompletionIndex < 0
  || requiredControlNoCallIndex > genericNoToolCompletionIndex) {
  violations.push('Required workflow recovery must run before generic no-Tool completion handling.');
}
const requiredControlHandlerStart = source.agent.indexOf('private handleRequiredToolNoCallConstraint(');
const requiredControlHandlerEnd = source.agent.indexOf('private recoverTextEncodedToolCalls(', requiredControlHandlerStart);
const requiredControlHandler = requiredControlHandlerStart >= 0 && requiredControlHandlerEnd > requiredControlHandlerStart
  ? source.agent.slice(requiredControlHandlerStart, requiredControlHandlerEnd)
  : '';
if (!requiredControlHandler.includes("source: 'required_tool_no_call'")
  || requiredControlHandler.includes("obligationClass: 'control' as const")) {
  violations.push('Required workflow recovery must stay bounded without reintroducing a recommendation-derived control obligation.');
}
if (/response\.toolCalls\s*=|String\(response\.content/.test(requiredControlHandler)) {
  violations.push('Required workflow recovery must not fabricate Tool calls or infer obligations from model response text.');
}
requireToken('resolver', "version: 'runtime-capability-reference-resolution/v0'", 'Resolver must emit the six-kind provider-backed reference contract.');
requireToken(
  'resolver',
  '不表示内容已读取、Skill 已执行、Policy 已触发或 Evaluation 已通过',
  'Provider identity must remain non-executing Runtime truth without being exposed as designer prompt prose.'
);
requireToken('resolver', "code: 'capability_reference_unavailable'", 'Missing manifest references must remain explicit.');
requireToken('resolver', "code: 'capability_reference_kind_mismatch'", 'Wrong-kind manifest references must remain explicit.');
requireToken('resolver', "code: 'capability_reference_scope_mismatch'", 'Profile providers referenced by the wrong Skill or task type must remain explicit.');
requireToken('resolver', 'listBuiltinNonExecutableCapabilityProviders', 'Resolver must reuse stable non-executable provider identities.');
requireToken('resolver', 'listDesignEvaluationProfileCapabilityProviders', 'Resolver must register Evaluation references from real Profile implementations.');
requireToken('resolver', "semantics?.capabilityKind !== 'knowledge_search'", 'Knowledge providers must be derived from existing Tool semantics.');
requireToken('resolver', "exposedAsToolSchema: forceExtensionSource ? false", 'Extension reference identity must not inject an executable schema.');
requireToken('resolver', 'containsSensitiveLabel', 'Extension provider identities must reject secret-like labels.');
requireToken('resolver', "value.includes('://')", 'Extension provider identities must reject URL-like payloads.');
forbidPattern('resolver', /CAPABILITY_REGISTRY/, 'Resolver must not create a parallel CAPABILITY_REGISTRY.');
forbidPattern('resolver', /taskText\s*[?:]|\.taskText/, 'Resolver must not accept or inspect taskText.');
forbidPattern('resolver', /详情页|主图|SKU|sku-batch|detail-page-design|main-image-design/i, 'Resolver must not contain category-specific control flow.');

requireToken('contract', "| 'knowledge'", 'Capability contract must retain Knowledge as a first-class kind.');
requireToken('contract', "| 'memory'", 'Capability contract must retain Memory as a first-class kind.');
requireToken('contract', "| 'evaluation'", 'Capability contract must retain Evaluation as a first-class kind.');
requireToken('contract', "| 'policy'", 'Capability contract must retain Policy as a first-class kind.');
requireToken('contract', 'referenceResolution: CapabilityReferenceResolution', 'Agent Resolution must include provider-backed reference resolution.');
requireToken('providerIdentities', 'listBuiltinNonExecutableCapabilityProviders', 'Non-executable providers must have one lightweight identity source.');
requireToken('providerIdentities', 'exposedAsToolSchema: false', 'Builtin Memory, Evaluation and Policy providers must never become Tool schemas.');
forbidPattern('providerIdentities', /rubrics\//i, 'Lightweight provider identities must not fabricate business rubric providers.');
forbidPattern('providerIdentities', /executeTool\(/, 'Provider identity catalog must not execute Tools.');
requireToken('projectStateContract', 'DESIGN_PROJECT_STATE_CAPABILITY_ID', 'Design Project State implementation must share the registered Memory identity.');
requireToken('qualityVerdict', 'DESIGN_QUALITY_VERDICT_CAPABILITY_ID', 'Design verdict implementation must share the registered Evaluation identity.');
requireToken('decisionContract', 'AGENT_TOOL_DECISION_POLICY_CAPABILITY_ID', 'Tool decision implementation must share the registered Policy identity.');
requireToken('designDiscipline', 'DESIGN_DISCIPLINE_POLICY_CAPABILITY_ID', 'Design discipline implementation must share the registered Policy identity.');
requireToken('toolSafety', 'TOOL_SAFETY_POLICY_CAPABILITY_ID', 'Tool safety implementation must share the registered Policy identity.');
requireToken('evaluationProfiles', "version: 'design-evaluation-profile/v0'", 'Evaluation providers must expose a versioned Profile contract.');
requireToken('evaluationProfiles', 'scoreDesignAssertions(scoringResults, {', 'Profiles must reuse the shared DesignScorecard implementation.');
requireToken('evaluationProfiles', 'nonScoringOptionalCheckIds', 'Optional Profile checks must stay advisory instead of entering the shared DesignScorecard gate.');
requireToken('evaluationProfiles', 'assertions: scoringAssertions', 'Profile scorecards must use the assertion set filtered by scoring authority.');
requireToken('evaluationProfiles', 'finalVerdictOwnedByProfile: false', 'Profiles must not create a parallel final verdict owner.');
requireToken('evaluationProfiles', "gate: 'insufficient_observations'", 'Insufficient Profile observations must not default to pass.');
requireToken('evaluationProfiles', 'verification_explicitly_failed', 'Explicit Profile verification failures must remain machine-readable.');
requireToken('evaluationProfiles', 'profile_check_blocker_evidence_invalid', 'Profile blocker checks must declare a validated blocker kind.');
requireToken('evaluationProfiles', 'proofRef: verification.verificationRef', 'Qualified Profile blockers must retain their validated verification reference.');
requireToken('evaluationProfiles', 'listDesignEvaluationProfileCapabilityProviders', 'Evaluation provider identities must derive from validated Profile implementations.');
requireToken('evaluationProfiles', 'applicableSkillIds: [profile.skillId]', 'Evaluation provider identities must retain explicit Skill scope.');
requireToken('evaluationProfiles', 'applicableTaskTypes: [profile.taskType]', 'Evaluation provider identities must retain explicit task-type scope.');
requireToken('evaluationProfiles', "profile.bindingPolicy === 'design_foundation'", 'Reusable design-foundation Evaluation providers must not publish a false business Skill scope.');
requireToken('evaluationProfiles', "surfaceMode: 'declared_multi_surface'", 'Multi-surface final review must be Profile metadata instead of an Agent Profile-id branch.');
requireToken('evaluationProfiles', "evidence: 'declared_plan_closure'", 'Plan-closure verification must be Check metadata instead of an Agent check-key branch.');
requireToken('evaluationProfiles', "trigger: 'post_write_observation_missing'", 'Post-write repair routing must be Check metadata instead of an Agent check-key branch.');
forbidPattern('evaluationProfiles', /taskText|userInput/, 'Evaluation Profile selection and evaluation must not inspect task text.');
forbidPattern('evaluationProfiles', /executeTool\(|callModel\(/, 'Evaluation Profiles must not execute Tools or call models.');
forbidPattern('evaluationProfiles', /mainImageVerdict|detailPageVerdict|skuVerdict/, 'Business Profiles must not create parallel final verdict engines.');
requireToken('evaluationResultAdapters', "version: 'design-evaluation-result-adapter/v0'", 'Business Evaluation result adapters must expose a versioned result contract.');
requireToken('evaluationResultAdapters', 'trustsToolSuccessAsQualityPass: false', 'Tool success must not become an automatic business quality pass.');
requireToken('evaluationResultAdapters', 'acceptsOnlyVersionedBusinessContracts: true', 'Result adapters must consume versioned business contracts only.');
requireToken('evaluationResultAdapters', 'staleRecordsCanPass: false', 'Records older than a later mutation must not pass.');
requireToken('evaluationResultAdapters', 'finalVerdictOwnedByAdapter: false', 'Result adapters must not create a parallel final verdict owner.');
requireToken('evaluationResultAdapters', 'createDesignEvaluationResultAdapterRegistry', 'The generic Evaluation result aggregator must resolve immutable adapter contributions through one registry factory.');
requireToken('evaluationResultAdapters', 'adapter.buildRecords(source.data)', 'The generic Evaluation result aggregator must delegate contract translation to the resolved contribution.');
requireToken('evaluationResultAdapters', 'byProfileId.has(profileId)', 'Duplicate Evaluation result adapter contributions must fail instead of silently overriding an existing Profile.');
requireToken('evaluationResultAdapterContributions', 'profileId: MAIN_IMAGE_EVALUATION_PROFILE_ID', 'Main-image Profile checks must retain an explicit contribution identity.');
requireToken('evaluationResultAdapterContributions', "sourceToolName: 'main-image-design'", 'Main-image Profile checks must retain an explicit Skill source boundary.');
requireToken('evaluationResultAdapterContributions', 'profileId: DETAIL_PAGE_EVALUATION_PROFILE_ID', 'Detail-page Profile checks must retain an explicit contribution identity.');
requireToken('evaluationResultAdapterContributions', "sourceToolName: 'detail-page-design'", 'Detail-page Profile checks must retain an explicit Skill source boundary.');
requireToken('evaluationResultAdapterContributions', 'profileId: SKU_BATCH_EVALUATION_PROFILE_ID', 'SKU Profile checks must retain an explicit contribution identity.');
requireToken('evaluationResultAdapterContributions', "sourceToolName: 'sku-batch'", 'SKU Profile checks must retain an explicit Skill source boundary.');
forbidPattern('evaluationResultAdapters', /SOURCE_TOOL_BY_PROFILE|buildRecordsForProfile|switch\s*\(\s*(?:input\.)?profile(?:\.profileId)?\s*\)|MAIN_IMAGE_EVALUATION_PROFILE_ID|DETAIL_PAGE_EVALUATION_PROFILE_ID|SKU_BATCH_EVALUATION_PROFILE_ID|main-image-design|detail-page-design|sku-batch|sku-color-card/i, 'The generic Evaluation result aggregator must not know business Profile IDs, Skill sources or category switches.');
forbidPattern('evaluationResultAdapters', /taskText|userInput|RegExp|\.test\(/, 'Result adapters must not route from task text or regex categories.');
forbidPattern('evaluationResultAdapters', /executeTool\(|callModel\(/, 'Result adapters must not execute Tools or call models.');
forbidPattern('evaluationResultAdapters', /mainImageVerdict|detailPageVerdict|skuVerdict/, 'Result adapters must not create business-specific verdict engines.');
forbidPattern('evaluationResultAdapterContributions', /taskText|userInput|RegExp|\.test\(|executeTool\(|callModel\(/, 'Evaluation result contributions must remain pure, structured-contract translators.');
requireToken('detailPageContentVerification', "version: 'detail-page-content-verification/v0'", 'Detail-page content verification must expose a versioned contract.');
requireToken('detailPageContentVerification', 'verificationPassed: status === \'passed\'', 'Detail-page content verification must pass only after every screen is grounded.');
requireToken('detailPageContentVerification', 'content_support_ref_unknown', 'Unknown detail-page fact refs must remain explicit.');
requireToken('detailPageContentVerification', 'applied_copy_not_supported', 'Applied copy must remain review-only when it has no confirmed source support.');
requireToken('detailPageContentVerification', 'containsFactStatements: false', 'Detail-page verification results must not retain fact statements.');
requireToken('detailPageContentVerification', 'performsSemanticInference: false', 'Detail-page verification must not guess semantic claim support.');
requireToken('detailPageContentVerification', 'claimsDesignQuality: false', 'Detail-page content verification must not claim final design quality.');
forbidPattern('detailPageContentVerification', /taskText|userInput|executeTool\(|callModel\(/, 'Detail-page content verification must remain pure and task-text independent.');
requireToken('projectFactProvenance', "version: 'design-project-fact/v0'", 'Project facts must expose a versioned provenance record.');
requireToken('projectFactProvenance', "authority !== 'agent_proposal'", 'Agent proposals must not self-confirm project facts.');
requireToken('projectFactProvenance', "confirmation === 'user_confirmed' || fact.confirmation === 'source_supported'", 'Only user-confirmed or source-supported facts may satisfy evaluation checks.');
requireToken('projectFactProvenance', 'legacy_unattributed', 'Legacy fact strings must remain explicitly unattributed.');
requireToken('projectFactProvenance', 'fact-integrity', 'Confirmed project facts must retain local integrity verification.');
requireToken('projectFactReviewCard', "kind: 'design_project_fact_review'", 'Project fact confirmation must use a dedicated deterministic review card.');
requireToken('projectFactReviewCard', "factWriteAuthority: 'user_review'", 'The fact review card must issue explicit user review authority.');
forbidPattern('projectFactProvenance', /executeTool\(|callModel\(/, 'Project fact provenance must remain pure and non-executing.');
requireToken('projectRuleGovernance', "version: 'design-project-rule/v0'", 'Project rules must expose a versioned governance record.');
requireToken('projectRuleGovernance', "authority === 'agent_proposal'", 'Agent-submitted project rules must remain proposals.');
requireToken('projectRuleGovernance', 'doesNotGrantToolPermission: true', 'Project rule Policy must never grant Tool permission.');
requireToken('projectRuleGovernance', 'findDesignProjectRuleConflicts', 'Confirmed project-rule conflicts must remain explicit.');
requireToken('projectRuleGovernance', 'rule-integrity', 'Confirmed project rules must retain local integrity verification.');
requireToken('projectRuleReviewCard', "kind: 'design_project_rule_review'", 'Project rule confirmation must use a dedicated deterministic review card.');
requireToken('projectRuleReviewCard', "ruleWriteAuthority: 'user_review'", 'The project rule review card must issue explicit user review authority.');
forbidPattern('projectRuleGovernance', /executeTool\(|callModel\(/, 'Project rule governance must remain pure and non-executing.');
requireToken('knowledgeGovernance', "version: 'design-knowledge-governance/v0'", 'Knowledge results must expose versioned governance bindings.');
requireToken('knowledgeGovernance', "version: 'design-knowledge-usage-snapshot/v0'", 'Knowledge use must emit a digest-only task snapshot.');
requireToken('knowledgeGovernance', 'contentFingerprint', 'Knowledge governance must bind the actual content version.');
requireToken('knowledgeGovernance', 'integrityFingerprint', 'Knowledge lifecycle and expiry metadata must retain local integrity verification.');
requireToken('knowledgeGovernance', "| 'withdrawn'", 'Withdrawn knowledge must remain an explicit lifecycle state.');
requireToken('knowledgeGovernance', "| 'legacy_unversioned'", 'Legacy unversioned knowledge must remain explicit and review-only.');
requireToken('knowledgeGovernance', 'doesNotGrantToolPermission: true', 'Knowledge snapshots must never grant Tool permission.');
requireToken('knowledgeGovernance', 'lifecycleStatus: DesignKnowledgeLifecycleStatus', 'Knowledge records must retain an explicit lifecycle status.');
requireToken('knowledgeGovernance', 'freshness: DesignKnowledgeFreshness', 'Knowledge bindings must expose the resolved freshness status.');
requireToken('knowledgeGovernance', 'allowedUses: DesignKnowledgeAllowedUse[]', 'Knowledge bindings must constrain how the selected content may be used.');
forbidPattern('knowledgeGovernance', /executeTool\(|callModel\(/, 'Knowledge governance must remain pure and non-executing.');
requireToken('skuHumanReview', "version: 'sku-human-review-target/v0'", 'SKU human review must expose a versioned content-addressed target.');
requireToken('skuHumanReview', "version: 'sku-human-review-binding/v0'", 'SKU human review must expose a versioned freshness binding.');
requireToken('skuHumanReview', 'blocked_missing_output_digest', 'SKU review must fail closed when export content hashes are missing.');
requireToken('skuHumanReview', 'stale_review_ignored', 'SKU review must explicitly invalidate records for another output batch.');
requireToken('skuHumanReview', 'doesNotClaimDesignQuality: true', 'SKU review binding must not claim final design quality.');
requireToken('humanReviewRecord', 'integrityFingerprint', 'Persisted human review records must retain an integrity fingerprint.');
forbidPattern('skuHumanReview', /executeTool\(|callModel\(/, 'SKU human review contracts must not execute Tools or call models.');
requireToken('qualityAssertions', 'assertions?: readonly DesignAssertion[]', 'The shared scorer must accept an explicit Profile assertion catalog.');
requireToken('qualityAssertions', 'options?.assertions || TASK_NEUTRAL_DESIGN_ASSERTIONS', 'Task-neutral scoring must remain the default when no Profile exists; task-specific marketing heuristics require an explicit Profile.');
requireToken('qualityAssertions', 'isQualifiedDesignQualityHardBlocker', 'Design quality hard blockers must use one evidence-qualified predicate.');
requireToken('qualityAssertions', "result.method === 'deterministic'", 'VLM findings must not qualify directly as hard blockers.');
requireToken('qualityAssertions', 'isValidDesignQualityProofRef(result.proofRef)', 'Quality hard blockers must carry a validated proof reference.');
requireToken('qualityAssertions', 'latest.blockers.some(isQualifiedDesignQualityHardBlocker)', 'Quality-loop escalation must not trust naked scorecard blockers.');
requireToken('qualityVerdict', 'scorecard.blockers.filter(isQualifiedDesignQualityHardBlocker)', 'DesignVerdict must not trust naked scorecard blocker severity.');
requireToken('qualityCompletionContract', 'qualifiedHardFailureIds', 'Profile completion must distinguish qualified blockers from review-only failed checks.');
requireToken('designTeamVerdict', 'scorecard.blockers.some(isQualifiedDesignQualityHardBlocker)', 'Critic verdict merging must not bypass qualified blocker evidence.');
const briefRelativeAestheticAssertionIds = [
  'comp.subject-ratio',
  'comp.alignment',
  'color.contrast',
  'color.background-designed',
  'hier.type-scale',
  'craft.precision',
  'overall.above-baseline',
  'impact.squint',
  'sell.visualized',
  'craft.depth'
];
for (const assertionId of briefRelativeAestheticAssertionIds) {
  const escapedId = assertionId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const block = source.qualityAssertions.match(
    new RegExp(`id: ['"]${escapedId}['"][\\s\\S]*?\\n\\s{4}\\}(?:,|\\n)`)
  )?.[0] || '';
  if (!block || !block.includes("method: 'vlm_judge'") || !block.includes('judgeCriterion:')) {
    violations.push(`Aesthetic assertion ${assertionId} must remain Brief-relative VLM judgment, not a deterministic style threshold.`);
  }
}
forbidPattern('qualityAssertions', /case ['"](?:comp\.subject-ratio|comp\.alignment|color\.contrast|hier\.type-scale|craft\.precision)['"]/, 'Style measurements must not regain hard-coded deterministic aesthetic thresholds.');
requireToken('qualityAssertions', 'structuralHeuristicSignals 来自与 Judge 图像同版本的新鲜图层结构，只是结构启发信号，不是像素事实或通用审美阈值', 'VLM judge must label structural measurements as heuristics rather than pixel facts.');
requireToken('qualityAssertions', "semantics: 'structural_heuristic_not_pixel_fact'", 'The Judge context must expose the measurement provenance boundary explicitly.');
forbidPattern('qualityAssertions', /structuralHeuristicSignals:[\s\S]{0,1000}(?:backgroundIsPlainDefault|layoutBaselineOnly)/, 'Unreliable default-background or baseline-layout signals must not be sent to the final Judge.');
requireToken('qualityAssertions', '白底、对称或极简本身都不是未完成证据', 'White, centered, symmetric and minimal directions must remain neutral until compared with the Brief.');
requireToken('qualityAssertions', '不得补造卖点', 'Quality evaluation must not fabricate selling-point obligations outside the Brief.');
requireToken('designTeamRegistry', '白底、极简、居中、对称或无背景本身都不是缺陷', 'Critic prompt must not contradict the Brief-relative aesthetic assertions.');
requireToken('designTeamRegistry', '字体排印与卖点文案维度视为 N/A', 'Critic must not invent typography or selling-point failures for no-copy briefs.');
const singleCanvasProfileBlock = source.evaluationProfiles.match(
  /const SINGLE_CANVAS_VISUAL_PROFILE[\s\S]*?const DETAIL_PAGE_PROFILE/
)?.[0] || '';
if (!singleCanvasProfileBlock || singleCanvasProfileBlock.includes("'overall.above-baseline'")) {
  violations.push('Single-canvas evaluation must not impose whole-artifact above-baseline marketing completion.');
}
const scopedEditProfileBlock = source.evaluationProfiles.match(
  /const DETAIL_PAGE_SCOPED_EDIT_PROFILE[\s\S]*?const SKU_BATCH_PROFILE/
)?.[0] || '';
if (!scopedEditProfileBlock || !scopedEditProfileBlock.includes('assertionRefs: []')) {
  violations.push('Scoped edit without changed-region provenance must not run full-canvas VLM assertions.');
}
const skuBatchProfileBlock = source.evaluationProfiles.match(
  /const SKU_BATCH_PROFILE[\s\S]*?const SKU_COLOR_CARD_PROFILE|const SKU_BATCH_PROFILE[\s\S]*?const DESIGN_EVALUATION_PROFILES/
)?.[0] || '';
if (!skuBatchProfileBlock || !skuBatchProfileBlock.includes('assertionRefs: []')) {
  violations.push('SKU batch with disabled vision policy must not require generic VLM assertions.');
}
requireToken('qualityAssertions', '不要另返 pass 字段', 'The final Judge must use score as its single decision value.');
requireToken('qualityAssertions', "status === 'not_applicable'", 'The final Judge protocol must preserve reliable N/A as an explicit status.');
requireToken('qualityAssertions', '最多只给 3 个', 'The single visual Judge batch must bound rich diagnoses to the most important findings.');
requireToken('qualityAssertions', 'MAX_VLM_JUDGE_DIAGNOSES = 3', 'The parser must enforce the same top-three diagnosis boundary even when the model ignores the prompt.');
requireToken('qualityAssertions', 'typeof result.score === \'number\'', 'Only results with finite scores may enter numeric score coverage.');
requireToken('agent', "budgetClass: 'final_quality_judge'", 'The final visual Judge must consume its dedicated reserved budget class.');
requireToken('agent', 'MAX_FINAL_QUALITY_JUDGE_CALLS = 1', 'The dedicated final Judge budget must be single-use per generation.');
requireToken('agent', 'AGENT_FINALIZATION_TIME_RESERVE_MS', 'Ordinary task work must preserve the shared finalization time window.');
requireToken('agent', 'completedAestheticImprovementEligible', 'A completed artifact may re-enter only through the qualified aesthetic-improvement path.');
requireToken('agent', 'onlyActionableReliableDiagnoses: true', 'Aesthetic re-entry constraints must include only reliable diagnosed findings.');
requireToken('executor', 'completedAestheticImprovementReentryUsed', 'Completed aesthetic improvement must be capped independently of ordinary retry scoring.');
requireToken('executor', "constraintMode: 'handoff_only'", 'Completed aesthetic improvement must preserve the Agent-filtered diagnosed-only constraint set.');
requireToken('reflexionPolicy', "input.constraintMode === 'handoff_only'", 'Quality-loop stopping may not reintroduce undiagnosed generic fixes into a completed-artifact improvement.');
requireToken('executor', 'buildDesignTeamGlobalEvaluationContext', 'The team pipeline must receive one bounded Brief/Strategy/Profile context projection.');
requireToken('executor', 'runtimeEvaluationProfile', 'The effective Evaluation Profile must enter the team context compiler.');
requireToken('designTeamCoordinator', 'const effectiveContext = [request.context, context]', 'Every teammate stage must merge the shared evaluation context through one runStage boundary.');

forbidPattern('bundle', /taskText/, 'Runtime bundle must not accept or inspect taskText.');
forbidPattern('bundle', /LEGACY_SKILL_ID_TO_TASK_TYPE/, 'Legacy Skill aliases must come from manifests, not a second map.');
forbidPattern('bundle', /RegExp|\.test\(/, 'Runtime bundle must not use regex category routing.');
requireToken('skillRuntimeRegistry', 'manifestByLegacySkillId', 'Manifest-owned legacy aliases must have one derived index in the generic Registry core.');

requireToken('session', 'activeTools.splice', 'Capability Session must update the existing Agent tool array in place.');
requireToken('session', 'REQUEST_AGENT_CAPABILITIES_TOOL_NAME', 'Capability Session must expose compact on-demand discovery.');
requireToken('session', 'maxItems: MAX_ON_DEMAND_CAPABILITY_REQUESTS', 'Capability request schema must expose the same batch budget.');
requireToken('session', 'getActiveCapabilityIdsForTool', 'Plan execution reconciliation must reuse the live Capability Session inventory.');
requireToken('session', 'selectedCapabilityIds.has(entry.capabilityId)', 'Tool attribution must be limited to currently active Capability ids.');
requireToken('session', '当前工具列表就是现在可以直接使用的动作', 'Capability Prompt must tell the Agent to act with the currently visible tools.');
requireToken('session', '只有下一步确实缺少动作时', 'Capability Prompt must keep on-demand discovery bounded to the next concrete action.');
requireToken('session', '不要用随机调用试探能力', 'Capability Prompt must prohibit Tool probing as capability discovery.');
requireToken('session', 'getResolution(): AgentCapabilityResolution', 'Structured capability resolution must remain available to Runtime and audits outside the model prompt.');
forbidPattern(
  'session',
  /Capability self-model:|Provider-backed refs:|Unavailable refs:|Explicitly denied capabilities:|Manifest:/,
  'Internal capability accounting must stay in Runtime state instead of the designer model prompt.'
);
requireToken('session', "'photoshop.write.removeBackground'", 'A design-execution session must know background removal as a generic Photoshop craft capability without requiring a business Skill.');
forbidPattern('agent', /applyPromisedToolNoCallRecoveryDirective|buildPromisedToolNoCallRecovery|resolvePromisedToolNameFromText/, 'Task continuation must not infer executable Tool ownership from assistant prose.');
requireToken('agent', 'R3 契约已经把 blocking 定义为「只能由用户提供」', 'R3 blocking inputs must remain user-owned instead of reopening project/reference search.');
requireToken('executor', 'buildDynamicDesignTaskOperatingContext', 'The autonomous executor must project the declared Task Profile as live operating context.');
requireToken('executor', 'buildDesignTaskTypePromptSection(spec', 'The live operating context must reuse the existing Task Profile owner.');
requireToken('executor', 'getDynamicOperatingContext: () => [', 'Capability and Task Profile context must be refreshed for each Agent iteration.');
requireToken('agent', 'this.config.getDynamicOperatingContext?.()', 'The production Agent must consume the live operating context on every system-prompt refresh.');
requireToken('bundle', 'getDesignEvaluationProfileById(evaluationRubricRef)', 'Runtime bundles must resolve the effective work-mode Evaluation Profile instead of ignoring its rubric ref.');
requireToken('bundle', 'buildRuntimeStagePlan(manifest, expectedWorkMode)', 'Runtime bundles must bind the upstream-selected work mode into the stage plan.');
requireToken('stagePlan', 'plan.expectedWorkMode || normalizeRuntimeDesignWorkMode(workMode)', 'The effective contract must prefer the upstream-selected work mode over an R1 replacement.');
requireToken('designBrief', "addIssue(issues, 'work_mode_identity_mismatch', 'workMode')", 'R1 must reject a work mode that conflicts with the upstream runtime identity.');
requireToken('executor', 'evaluationProfile: runtimeContractBundle.evaluationProfile', 'The default Agent path must receive the manifest-selected Evaluation Profile.');
requireToken('agent', 'const evaluationProfile = this.resolveRuntimeEvaluationProfile()', 'The Agent visual judge must resolve the work-mode-aware Evaluation Profile before judging.');
requireToken('agent', 'getDesignEvaluationProfileVlmAssertions(evaluationProfile)', 'The Agent visual judge must evaluate only assertions from the effective Profile.');
requireToken('agent', 'evaluateDesignEvaluationProfile({', 'The Agent summary must route Profile results through the shared scorecard provider.');
requireToken('agent', 'adaptDesignEvaluationRecordsFromToolResults({', 'The Agent summary must adapt versioned business results before Profile evaluation.');
requireToken('agent', '...adaptedBusinessResults.records', 'Adapted business verification records must enter the existing Profile check list.');
requireToken('agent', 'profile?.finalReview', 'The Agent must consume final-review surface requirements from Profile metadata.');
requireToken('agent', 'check.runtime?.repair?.trigger', 'The Agent must consume repair triggers from Check metadata.');
requireToken('agent', "check.runtime?.evidence === 'fresh_structure'", 'The Agent must produce generic runtime evidence from Check metadata.');
forbidPattern('agent', /DETAIL_PAGE_(?:CREATE_NEW_|SCOPED_EDIT_)?EVALUATION_PROFILE_ID/, 'The generic Agent must not branch on a business Evaluation Profile id.');
forbidPattern('agent', /whole_task_execution_closure|fresh_structure_snapshot|fresh_visual_evaluation|requested_change_applied|outside_scope_preserved|detail_page_screen_coverage|batch_coverage|required_profile_check/, 'The generic Agent must not branch on business Evaluation check keys.');
forbidPattern('agent', /requiredSourceKind\s*:\s*['"]detail-screen['"]/, 'The generic Agent must not hard-code a business final-review source kind.');
requireToken('evaluationResultAdapterContributions', "contentVerification?.version !== 'detail-page-content-verification/v0'", 'The detail-page Evaluation contribution must require the current versioned content verification contract.');
requireToken('evaluationResultAdapterContributions', "binding?.version !== 'sku-human-review-binding/v0'", 'The SKU Evaluation contribution must require freshness-verified review binding.');
requireToken('agent', 'scorecard: designScorecard', 'Profile scorecards must still flow into the single DesignVerdict chain.');
requireToken('agent', "designKinds: ['skill_evaluation_profile']", 'The single DesignVerdict chain must recognize the Skill-owned completion kind.');

requireToken('executor', 'const capabilityRuntime = resolveAutonomousCapabilityRuntime(runtimeParams, context);', 'Production executor must resolve capabilities once per run.');
requireToken('executor', "intentControlPlane?.toolScope === 'write_photoshop'", 'Generic design craft visibility must follow the structured write delegation, not a task-text category guess.');
requireToken('executor', "intentControlPlane.executionAuthorization === 'confirmed_tool_required'", 'Design craft schemas must not become visible from a candidate-only or non-authorizing intent.');
requireToken('executor', '|| designExecutionCapabilityBaselineRequested', 'Ordinary delegated work must know its design craft capabilities before a task-type declaration exists.');
requireToken('executor', "const structuredTaskType = String(params?.declaredTaskType || '').trim() || undefined;", 'Production Capability selection must use an explicit structured task type only.');
requireToken('executor', 'const structuredSkillId = runtimeSelectedSkillHandoff?.skillId', 'Production Capability selection must use an explicit structured selected-Skill handoff or Planner declaration only.');
forbidPattern('executor', /buildRuntimeContractBundleForAgentTask\([\s\S]{0,220}skillId:\s*String\(params\?\.skillId/, 'Legacy text-derived skillId must not select a Capability manifest.');
forbidPattern('executor', /const structuredTaskType\s*=\s*[^;]*(disciplineContext|spec\?\.id|resolveDesignTaskTypeSpec)/, 'Production Capability selection must not reuse text-derived design-discipline categories.');
requireToken('engine', 'const declaredSkillId = runtimeSelectedSkillHandoff?.skillId;', 'Only a provenance-bearing structured handoff may declare Runtime Skill identity.');
forbidPattern('engine', /const declaredSkillId\s*=\s*[^;]*decision\?\.skillId/, 'Router Skill hints must not become declared Runtime Skill identity.');
forbidPattern('engine', /buildRuntimeSelectedSkillHandoffForExecution/, 'Ordinary natural language must not synthesize a Runtime Skill handoff from Router or keyword routing.');
requireToken('engine', "'agent_first_natural_language'", 'Ordinary natural language must enter the generic Agent-owned capability path.');
requireToken('executor', "runtimeContractStatus.status === 'selected_manifest_missing'", 'Explicit Skill selection without a Manifest must fail closed before model or Photoshop execution.');
requireToken('selectedSkillHandoff', 'selectionRecordOnly: true', 'Selected-Skill handoff must remain an R0 selection record only.');
requireToken('selectedSkillHandoff', 'executesSkill: false', 'Selected-Skill handoff must not execute the selected Skill.');
requireToken('selectedSkillHandoff', 'grantsToolPermission: false', 'Selected-Skill handoff must not grant Tool permission.');
requireToken('selectedSkillHandoff', "'skill_declaration_unique_match'", 'Selected-Skill handoff must identify declaration-owned unique routing separately from model routing.');
requireToken('selectedSkillHandoff', "'controlled_route_react_handoff'", 'Selected-Skill handoff must preserve a protected controlled route with truthful provenance when it enters ReAct.');
requireToken('selectedSkillHandoff', "input.source === 'skill_declaration_unique_match'", 'Selected-Skill handoff must truthfully mark declaration routing as a task-text-derived selection record.');
forbidPattern('selectedSkillHandoff', /详情页|主图|SKU|sku-batch|detail-page-design|main-image-design/i, 'Selected-Skill handoff contract must remain category-neutral.');
requireToken('executor', 'tools: capabilitySession.activeTools', 'AgentConfig.tools must consume the Capability Session.');
requireToken('executor', 'runtimeLoopContract: runtimeContractBundle.runtimeLoopContract', 'Production Agent must receive the manifest loop contract.');
requireToken('executor', 'runtimeStagePlan: runtimeContractBundle.stagePlan', 'Production Agent must receive the runtime stage plan.');
requireToken('executor', 'createRuntimeSessionIdentity({', 'Production executor must issue the Runtime Session identity before Agent execution.');
requireToken('executor', 'advanceRuntimeSessionIdentity({', 'Reflexion must advance one stable Runtime Session lineage.');
requireToken('executor', 'advanceRuntimeSessionGeneration({', 'Reflexion must carry the prior Stage State into the next generation.');
requireToken('executor', 'runtimeSessionSeed', 'Production Agent must receive the carried Runtime Session generation state.');
requireToken('agent', 'applyRuntimeSessionStageEvaluation({', 'Production Agent must use the live Runtime Session reducer.');
requireToken('agent', 'finalizeRuntimeSession({', 'Production Agent must finalize the current generation instead of replaying a second Stage State.');
forbidPattern('agent', /buildRuntimeStageStateFromEvaluation/, 'Production Agent must not rebuild Stage State from Trace at shutdown.');
forbidPattern('agent', /createRuntimeSessionIdentity/, 'Agent must not silently mint a second Runtime Session identity when executor handoff is missing.');
requireToken('runtimeSession', 'appendRuntimeSessionObservation', 'Runtime Session observations must remain distinct from stage evaluations.');
requireToken('runtimeSession', 'applyRuntimeSessionStageEvaluation', 'Runtime Session must have one explicit trusted stage evaluation entry.');
requireToken('runtimeSession', 'runtime_session_evaluation_stage_mismatch', 'Out-of-order stage evaluations must fail closed without moving currentStage.');
requireToken('runtimeSession', 'runtime_session_r4_not_ready', 'Runtime Session must block state-changing Tools before R4 enters E1.');
requireToken('runtimeSession', '普通交互卡片不能推进到 E2', 'Ordinary confirmation cards must pause the current stage instead of jumping to E2.');
requireToken('runtimeSession', 'taskRun: createRuntimeTaskRunState(input.identity)', 'TaskRun state must be created inside the single Runtime Session owner.');
requireToken('runtimeSession', 'schedulerAuthority: false', 'X1 TaskRun state must not grant scheduler authority to R4.');
requireToken('runtimeSession', 'runtime_task_run_waiting_user', 'A suspended TaskRun must block state-changing Tools until its bound interaction resumes.');
requireToken('runtimeSession', 'runtime_task_run_revision_reobserve_required', 'Unknown or stale document revisions must require re-observation instead of replay.');
requireToken('runtimeSession', 'recordRuntimeSessionOperationResult', 'TaskRun progress must reference Host-owned Photoshop OperationResults.');
requireToken('runtimeSession', 'activeDocumentWriterClaims', 'The Runtime Session owner must enforce one active TaskRun writer per Photoshop document.');
requireToken('agent', 'claimRuntimeSessionDocumentWriter({', 'The production Agent must claim the TaskRun writer identity at the Photoshop write execution point.');
requireToken('agent', 'suspendRuntimeSessionForInteraction({', 'The production Agent must suspend the existing TaskRun at an interactive confirmation boundary.');
requireToken('agent', 'attachRuntimeTaskRunBindingToPendingContinuation({', 'The pending continuation must carry the exact suspended TaskRun identity.');
requireToken('executor', 'expectedHistoryStateRef', 'The autonomous Tool adapter must preserve the private Photoshop revision guard.');
requireToken('engine', 'photoshopHistoryStateRef: freshPhotoshopContext?.historyStateRef', 'Interactive resume must validate the live Photoshop revision before execution.');
requireToken('engine', 'claimRuntimeTaskRunWriterBinding({', 'Interactive resume must retain the same TaskRun writer identity.');
requireToken('pendingContinuation', 'interactive_continuation_photoshop_revision_mismatch', 'Interactive continuation must reject stale Photoshop revisions without replay.');
forbidPattern('runtimeSession', /详情页|主图|SKU|sku-batch|detail-page-design|main-image-design/i, 'Runtime Session contract must remain category-neutral.');
forbidPattern('runtimeSession', /executeTool\(/, 'Runtime Session must not become a Tool dispatcher.');
requireToken('runRecord', 'runtimeSessionIdentity?.runId', 'Run Record must reuse the pre-issued Runtime Session runId.');
requireToken('runRecord', 'runtime_session_run_record_identity_mismatch', 'Run Record must reject a conflicting Session identity.');
for (const fileKey of ['agent', 'executor', 'runtimeSession']) {
  forbidPattern(fileKey, /orchestrator\.archived|\bWorkflowRun\b/, 'Production Runtime Session must not revive the archived WorkflowRun/orchestrator.');
}
requireToken('executor', 'toolCapabilityBridge: runtimeContractBundle.toolCapabilityBridge', 'Production Agent must receive the same tool capability bridge.');
requireToken('executor', 'getCapabilityResolution: () => capabilitySession.getResolution()', 'R4 planning must validate against the live Capability Session instead of a copied registry.');
requireToken('executor', 'capabilitySession.getActiveCapabilityIdsForTool(toolName)', 'Production Agent reconciliation must consume the same Capability Session mapping.');
requireToken('executor', 'capabilitySession.requestCapabilities', 'Tool wrapper must route on-demand requests into the same session.');
requireToken('executor', 'executesPhotoshop: false', 'Capability request result must declare that it does not execute Photoshop.');
requireToken('executor', 'grantsPermission: false', 'Capability request result must not claim execution permission.');
requireToken('executor', 'countsAsObservation: false', 'Capability loading must not count as task observation.');
requireToken('executor', 'countsAsTaskProgress: false', 'Capability loading must not claim task progress.');
requireToken('executor', 'idempotentNoOp: alreadyActiveOnly', 'Already-active Capability requests must emit a structured idempotent no-op marker.');
requireToken('executor', "noOpCode: 'requested_capabilities_already_active'", 'Capability no-op results must expose a stable machine-readable reason.');
requireToken('agent', 'isIdempotentHarnessControlNoOpResult', 'Agent loop accounting must recognize structured Harness control no-ops.');
requireToken('agent', 'CONSECUTIVE_CONTROL_TOOL_NO_PROGRESS_ROUND_LIMIT', 'Harness control no-progress loops must have a bounded stop guard.');
requireToken('agent', '!options.suppressConsecutiveFailedRound || idempotentControlNoOps.length > 0', 'Idempotent Capability no-ops must not be exempted by control-repair suppression.');
requireToken('session', 'candidateToolNames: readonly string[]', 'In-loop Runtime binding must reuse the existing Capability Session candidate Tool surface.');
requireToken('executor', 'let runtimeContractBundle = capabilityRuntime.runtimeContractBundle;', 'The Runtime bundle reference must stay live so Reflexion sees an in-loop declaration binding.');
requireToken('executor', 'buildRuntimeStageContextItemsForBundle', 'Initial and in-loop Runtime binding must share one stage-context compiler path.');
requireToken('executor', 'executableToolNames: capabilitySession.candidateToolNames', 'In-loop bundle construction must not rescan or create a second Tool registry.');
requireToken('executor', 'identityRunId: currentIdentity.runId', 'In-loop Artifact authorization must bind the existing same-generation TaskRun identity.');
requireToken('executor', 'currentAgent.activateRuntimeContractFromDeclaration({', 'The running Agent must receive the complete declaration-bound Runtime contract.');
requireToken('executor', 'runtimeContractBundle = candidateBundle;', 'The Reflexion closure must commit the declaration-bound Runtime bundle.');
requireToken('executor', 'runtimeStageContextItems = candidateStageContextItems;', 'The Reflexion closure must commit declaration-bound stage context.');
requireToken('executor', 'autonomousPerformancePolicy = candidatePerformancePolicy;', 'The Reflexion closure must commit the declaration-bound performance profile.');
requireToken('executor', 'runtimeSessionIdentity = boundIdentity;', 'The Reflexion closure must retain the same bound TaskRun identity and generation.');
requireToken('agent', 'activateRuntimeContractFromDeclaration(input:', 'Agent must expose one complete in-loop Runtime activation boundary instead of a stage-plan-only patch.');
requireToken('agent', 'finalizeRuntimeArtifacts: input.finalizeRuntimeArtifacts', 'In-loop Runtime activation must install Artifact finalization on the current Agent.');
requireToken('agent', 'evaluationProfile: input.evaluationProfile', 'In-loop Runtime activation must install the manifest Evaluation Profile on the current Agent.');
requireToken('agent', 'performanceBudget: input.performanceBudget', 'In-loop Runtime activation must install the manifest performance budget on the current Agent.');
forbidPattern('agent', /activateRuntimeStagePlanFromDeclaration/, 'A stage-plan-only declaration binding must not return.');

requireToken('preflight', "'requestAgentCapabilities'", 'Capability request must have an explicit non-Photoshop execution classification.');
requireToken('preflight', 'AGENT_HARNESS_CONTROL_TOOL_NAMES', 'Harness control tools must have one explicit accounting policy.');
requireToken('preflight', "'declareDesignIntent'", 'Design-intent declaration must remain Harness control, not task progress.');
requireToken('toolExecutor', "'declareDesignIntent'", 'Design-intent declaration must remain locally executable instead of falling through to Photoshop UXP.');
requireToken('preflight', 'DECLARE_DESIGN_BRIEF_TOOL_NAME', 'R1 Design Brief declaration must remain Harness control, not an executable capability.');
requireToken('preflight', 'DECLARE_DESIGN_STRATEGY_TOOL_NAME', 'R3 strategy declaration must remain Harness control, not an executable capability.');
requireToken('preflight', 'DECLARE_RUNTIME_ACTION_PLAN_TOOL_NAME', 'R4 action-plan declaration must remain Harness control, not an executable capability.');
requireToken('designBrief', "source: 'model_tool_call'", 'R1 Design Brief content must remain model-authored.');
requireToken('designBrief', 'harnessValidatedOnly: true', 'Harness must validate but not author R1 Design Brief content.');
requireToken('designBrief', 'harnessResolvesInputBindings: true', 'Harness must own exact R1 input bindings instead of asking the model to copy internal refs.');
requireToken('designBrief', 'harnessNormalizesInputCoverage: true', 'Harness must own factual R1 input coverage instead of trusting model status labels.');
requireToken('designBrief', 'manifestInputsAreSourceOfTruth: true', 'R1 input coverage must derive from the selected Skill manifest.');
requireToken('designBrief', 'countsAsTaskProgress: false', 'R1 Design Brief declaration alone must not claim task progress.');
requireToken('designBrief', 'countsAsQualityPass: false', 'R1 Design Brief declaration alone must not claim quality pass.');
requireToken('designBrief', 'context_ref_not_available', 'R1 Design Brief context references must be validated against the available runtime context.');
requireToken('designBrief', 'const resolvedKeys = new Set', 'R1 factual coverage must derive from Harness-resolved runtime sources.');
requireToken('designBrief', 'input.requiredInputKeys.includes(inputKey)', 'R1 must synthesize omitted required manifest inputs instead of rejecting the declaration shape.');
forbidPattern('designBrief', /taskText|详情页|主图|SKU|sku-batch|detail-page-design|main-image-design|袜子|服装/i, 'R1 Design Brief declaration must not contain task-text or category-specific control flow.');
forbidPattern('designBrief', /executeTool\(/, 'R1 Design Brief declaration must not dispatch Tools.');
requireToken('agent', 'runtimeDesignBriefDeclaration: this.runtimeDesignBriefDeclaration', 'Agent must pass the validated R1 declaration into the selected Tool/Skill execution context.');
requireToken('executor', 'runtimeDesignBriefDeclaration: runtimeContext?.runtimeDesignBriefDeclaration', 'Autonomous Tool wrapper must forward the R1 context to the selected Skill bridge.');
requireToken('executor', 'runtimeDesignBriefDigest: runtimeContext?.runtimeDesignBriefDigest', 'Autonomous Tool wrapper must forward the Harness-owned R1 digest to the selected Skill bridge.');
requireToken('skillTools', 'runtimeDesignBriefDeclaration: options.runtimeDesignBriefDeclaration', 'Skill bridge must inject the R1 context into SkillExecuteParams.');
requireToken('skillTools', 'runtimeDesignBriefDigest: options.runtimeDesignBriefDigest', 'Skill bridge must inject the Harness-owned R1 digest into SkillExecuteParams.');
requireToken('skillExecutorTypes', 'runtimeDesignBriefDeclaration?: RuntimeDesignBriefDeclaration', 'Skill executors must have a typed optional R1 execution context.');
requireToken('skuExecutor', 'runtimeDesignBriefDigest', 'SKU Skill must consume the Harness-owned R1 digest as bounded governance context.');
forbidPattern('skuExecutor', /buildRuntimeDesignBriefDigest/, 'SKU Skill must not duplicate the Harness-owned R1 digest implementation.');
requireToken('skuExecutor', 'projectProductUnderstanding', 'SKU Skill must consume product observations separately from the task Brief.');
requireToken('productUnderstanding', "version: 'project-product-understanding/v1'", 'Product observations must use a versioned non-Brief contract.');
requireToken('productUnderstanding', "layer: 'observed_context'", 'Product observations must remain observed project context rather than task Brief authority.');
forbidPattern('productUnderstanding', /userRequirementText|taskText|userInput/, 'Product understanding must not inspect task text.');
forbidPattern('productUnderstanding', /inferCategory|buyerQuestions|designDirections|parseSkuComboSizes|袜子|服装|socks|apparel/i, 'Product understanding must not author category strategy or SKU requirements.');
forbidPattern('productUnderstanding', /executeTool\(/, 'Product understanding must not execute Tools.');
forbidPattern('projectUnderstandingSummary', /buyerQuestions|designDirections|groundedSellingAngles/, 'Generic project summary must not inject business strategy into Agent context.');
if (fs.existsSync(path.join(root, 'src/shared/ecommerce-product-design-brief.ts'))) {
  violations.push('Legacy ecommerce-product-design-brief source must not survive as a second R1 truth source.');
}
for (const fileKey of ['agent', 'executor', 'skillTools', 'skuExecutor', 'projectUnderstandingSummary']) {
  forbidPattern(fileKey, /ecommerce-product-design-brief|buildEcommerceProductDesignBrief|EcommerceProductDesignBrief/, 'Active runtime source must not consume the retired category Brief.');
}
requireToken('strategy', "source: 'model_tool_call'", 'R3 strategy content must remain model-authored.');
requireToken('strategy', 'harnessValidatedOnly: true', 'Harness must validate but not author R3 strategy content.');
requireToken('strategy', 'artifactPublished: false', 'Runtime strategy declaration must not impersonate an immutable artifact publication.');
requireToken('strategy', 'countsAsTaskProgress: false', 'R3 strategy declaration alone must not claim task progress.');
requireToken('strategy', 'countsAsQualityPass: false', 'R3 strategy declaration alone must not claim quality pass.');
requireToken('strategy', 'context_ref_not_available', 'R3 strategy context references must be validated against the available runtime context.');
requireToken('strategy', 'supportingFacts', 'R3 message architecture must keep supporting facts distinct from strategy prose.');
requireToken('creativeStrategyContract', 'sourceRefs: string[]', 'Creative strategy artifacts must declare sourceRefs explicitly.');
requireToken('creativeStrategyContract', 'supportingFacts: string[]', 'Creative strategy message architecture must declare supportingFacts explicitly.');
requireToken('reviewReportContract', 'checkRefs: string[]', 'Review reports must declare checkRefs explicitly.');
requireToken('commonContract', "'feature_detail'", 'Shared visual-role semantics must retain feature_detail as a first-class role.');
forbidPattern('strategy', /taskText|详情页|主图|SKU|sku-batch|detail-page-design|main-image-design/i, 'R3 strategy declaration must not contain task-text or category-specific control flow.');
requireToken('actionPlan', "source: 'model_tool_call'", 'R4 action-plan content must remain model-authored.');
requireToken('actionPlan', 'harnessValidatedOnly: true', 'Harness must validate but not author R4 action-plan content.');
requireToken('actionPlan', 'strategyAligned: true', 'R4 action plans must align with a validated R3 strategy.');
requireToken('actionPlan', 'semanticDslOnly: true', 'R4 Design DSL must remain semantic rather than a legacy Tool parameter envelope.');
requireToken('actionPlan', 'shadowOnly: true', 'R4 dependencies must remain non-authorizing declarations before DAG authorization.');
requireToken('actionPlan', 'schedulerAuthority: false', 'R4 declaration must not own scheduling authority.');
requireToken('actionPlan', 'autoActivatesCapabilities: false', 'R4 declaration must not auto-load Capability schemas.');
requireToken('actionPlan', 'countsAsTaskProgress: false', 'R4 declaration alone must not claim task progress.');
requireToken('actionPlan', 'countsAsQualityPass: false', 'R4 declaration alone must not claim quality pass.');
requireToken('actionPlan', 'capability_ref_not_discovered', 'R4 Capability refs must be validated against the real Resolution.');
requireToken('actionPlan', 'dependency_cycle', 'R4 dependency graphs must reject cycles before future DAG consideration.');
requireToken('actionPlan', 'validateSemanticLayout', 'R4 semantic DSL must reuse the shared LayoutRegion/ElementPlan validator.');
requireToken('actionPlan', 'resumeMappingModelAuthored: true', 'Cross-run step equivalence must remain model-authored rather than Harness-inferred.');
requireToken('actionPlan', 'resume_mapping_prior_step_pending', 'Pending resume steps must not impersonate freshness-verified completed steps.');
requireToken('actionPlan', 'resume_mapping_prior_step_duplicate', 'Prior completed steps must map one-to-one into the current plan.');
forbidPattern('actionPlan', /taskText|详情页|主图|SKU|sku-batch|detail-page-design|main-image-design/i, 'R4 action-plan declaration must not contain task-text or category-specific control flow.');
forbidPattern('actionPlan', /executeTool\(/, 'R4 action-plan declaration must not dispatch Tools.');
requireToken('actionPlanObservation', 'postDeclarationOnly: true', 'R4 execution observations must start at the active plan declaration boundary.');
requireToken('actionPlanObservation', 'containsToolNames: false', 'R4 execution observations must not persist legacy Tool names.');
requireToken('actionPlanObservation', 'containsToolArguments: false', 'R4 execution observations must not persist Tool arguments.');
requireToken('actionPlanObservation', 'containsToolResults: false', 'R4 execution observations must not persist Tool results.');
requireToken('actionPlanObservation', 'blocksTools: false', 'R4 observation capture must not block Tool execution.');
forbidPattern('actionPlanObservation', /taskText|详情页|主图|SKU|sku-batch|detail-page-design|main-image-design/i, 'R4 observations must remain category-neutral.');
forbidPattern('actionPlanObservation', /toolName\s*[?:]/, 'R4 observations must not add a legacy Tool-name field.');
requireToken('actionPlanReconciliation', 'deterministicAttributionOnly: true', 'R4 execution attribution must remain deterministic and refuse ambiguity.');
requireToken('actionPlanReconciliation', 'evaluatesExpectedOutcomesOnly: true', 'R4 execution reconciliation may only evaluate declared expected outcomes.');
requireToken('actionPlanReconciliation', 'evaluatesCompletionCriteriaText: false', 'Harness must not interpret model-authored completionCriteria prose as completed.');
requireToken('actionPlanReconciliation', 'executesFailurePolicy: false', 'R4 reconciliation must not execute model failurePolicy.');
requireToken('actionPlanReconciliation', 'schedulerAuthority: false', 'R4 reconciliation must not own DAG scheduling authority.');
requireToken('actionPlanReconciliation', "outcome: 'ambiguous'", 'Ambiguous Capability matches must remain explicitly unattributed.');
requireToken('actionPlanReconciliation', "outcome = 'dependency_blocked'", 'Out-of-order observations must remain explicitly unattributed.');
requireToken('actionPlanReconciliation', "outcome = 'repeat_after_completion'", 'Post-completion repeats must be detected without executing a no-redo gate.');
forbidPattern('actionPlanReconciliation', /taskText|详情页|主图|SKU|sku-batch|detail-page-design|main-image-design/i, 'R4 reconciliation must remain category-neutral.');
forbidPattern('actionPlanReconciliation', /executeTool\(/, 'R4 reconciliation must not dispatch Tools.');
requireToken('actionPlanResumeFreshness', 'index > lastMutationIndex', 'Resume document anchors must come from readonly observations after the last Photoshop mutation.');
requireToken('actionPlanResumeFreshness', "fidelity: complete ? 'structure' : 'partial_structure'", 'Full hierarchy and truncated hierarchy must remain distinguishable.');
requireToken('actionPlanResumeFreshness', "['structure', 'visual_structure'].includes(previousDocument.fidelity)", 'Summary-only document metadata must not verify strong cross-run freshness.');
requireToken('actionPlanResumeFreshness', "status = 'mismatch'", 'Document or project-state fingerprint drift must invalidate old resume advice.');
requireToken('actionPlanResumeFreshness', "status = 'insufficient_context'", 'Missing strong context must remain explicit rather than guessed fresh.');
requireToken('actionPlanResumeFreshness', "status = 'verified'", 'Matching strong document and project-state anchors must produce a machine-readable verified verdict.');
requireToken('actionPlanResumeFreshness', 'autoSkipsSteps: false', 'Freshness must not automatically skip plan nodes.');
requireToken('actionPlanResumeFreshness', 'autoRecoversSteps: false', 'Freshness must not automatically recover failed nodes.');
requireToken('actionPlanResumeFreshness', 'schedulerAuthority: false', 'Freshness must not own scheduling authority.');
forbidPattern('actionPlanResumeFreshness', /taskText|详情页|主图|SKU|sku-batch|detail-page-design|main-image-design/i, 'Cross-run freshness must remain category-neutral and task-text free.');
forbidPattern('actionPlanResumeFreshness', /executeTool\(/, 'Freshness contract must not dispatch Tools.');
requireToken('actionPlanNoRedoShadow', 'modelMappingRequired: true', 'No-redo shadow decisions must require explicit model mapping.');
requireToken('actionPlanNoRedoShadow', 'infersEquivalence: false', 'Harness must not infer cross-run step equivalence.');
requireToken('actionPlanNoRedoShadow', 'blocksTools: false', 'No-redo shadow decisions must not block Tool execution.');
requireToken('actionPlanNoRedoShadow', 'skipsTools: false', 'No-redo shadow decisions must not skip Tool execution.');
requireToken('actionPlanNoRedoShadow', 'schedulerAuthority: false', 'No-redo shadow decisions must not own DAG scheduling authority.');
requireToken('actionPlanNoRedoShadow', "entry.mapping.policy === 'redo_required'", 'Intentional redo must remain distinct from accidental repeat observation.');
forbidPattern('actionPlanNoRedoShadow', /taskText|详情页|主图|SKU|sku-batch|detail-page-design|main-image-design/i, 'No-redo shadow decisions must remain category-neutral and task-text free.');
forbidPattern('actionPlanNoRedoShadow', /executeTool\(/, 'No-redo shadow decisions must not dispatch Tools.');
requireToken('noRedoProviderProbe', 'containsRawArguments: false', 'No-redo provider reports must not retain Tool arguments.');
requireToken('noRedoProviderProbe', 'containsFullPlan: false', 'No-redo provider reports must not retain complete R4 plans.');
requireToken('noRedoProviderProbe', 'containsProviderText: false', 'No-redo provider reports must not retain provider prose or thinking.');
requireToken('noRedoProviderProbe', 'evaluatesFreeText: false', 'No-redo provider evaluation must use structured mappings rather than free text.');
requireToken('noRedoProviderProbe', "verdict: 'false_equivalence'", 'No-redo provider evaluation must detect incorrect equivalence mappings.');
requireToken('noRedoProviderProbe', "verdict: 'unsafe_tool_observed'", 'No-redo provider evaluation must reject any non-declaration Tool.');
forbidPattern('noRedoProviderProbe', /taskText|详情页|主图|SKU|sku-batch|detail-page-design|main-image-design/i, 'No-redo provider evaluation must remain category-neutral and task-text free.');
forbidPattern('noRedoProviderProbe', /executeTool\(/, 'No-redo provider evaluation must not execute Tools.');
requireToken('realProviderRunner', "process.argv.includes('--no-redo-probe')", 'The guarded real-provider runner must expose a dedicated no-redo probe mode.');
requireToken('realProviderRunner', 'tools: [runtime.tool]', 'The no-redo provider must see only the production R4 declaration schema.');
requireToken('realProviderRunner', 'validateRuntimeActionPlanDeclaration', 'Provider R4 output must pass the production validator in memory.');
requireToken('realProviderRunner', 'evaluateAgentNoRedoProviderProbe', 'Provider mapping output must pass the deterministic no-redo evaluator.');
requireToken('realProviderRunner', 'DESIGNECHO_REAL_PROVIDER_AGENT_ACCEPTANCE_ALLOW_API', 'No-redo provider calls must retain the existing double opt-in boundary.');
forbidPattern('realProviderRunner', /executeToolCall\(/, 'The focused real-provider runner must not execute returned Tools.');
requireToken('runRecord', 'buildRuntimeResumeContextAnchor', 'Run records must persist a digest-only final Context Anchor.');
requireToken('runRecord', 'contextAnchorDigestOnly: true', 'Context anchors must keep an explicit digest-only persistence boundary.');
requireToken('runRecord', 'resumeFreshnessDigestOnly: true', 'Freshness verdicts must keep an explicit digest-only persistence boundary.');
requireToken('runRecord', 'actionPlanNoRedoShadowDigestOnly: true', 'No-redo observations must keep an explicit digest-only persistence boundary.');
requireToken('runRecord', 'designBriefDigestOnly: true', 'R1 Design Brief must keep an explicit digest-only persistence boundary.');
requireToken('runRecord', 'planningContextCarryDigestOnly', 'Reflexion planning-context carry must remain digest-only in Run Record.');
requireToken('runResume', "freshness?.status === 'verified'", 'Only verified freshness may expose old node state as current resume advice.');
requireToken('runResume', 'record.designBrief', 'Run resume must preserve bounded R1 Brief readiness without copying full input coverage.');
requireToken('runResume', '不能据此跳过当前需要的制作', 'Unchecked or invalid freshness must revoke old skip advice in the model context.');
forbidPattern('runResume', /Runtime Session|Harness 控制|影子步骤|阶段状态覆盖|动作记录：写入\/导出成功/, 'Run resume must not expose the internal accounting dashboard to the design model.');
requireToken('agent', 'isAgentHarnessControlTool', 'Agent completion logic must distinguish all Harness control tools from task progress.');
requireToken('agent', 'buildModelVisibleToolsForIteration', 'Agent must expose the R3 control schema explicitly at the runtime boundary.');
requireToken('agent', 'executeDesignBriefDeclaration', 'Agent must handle R1 Design Brief inside Harness without external Tool dispatch.');
requireToken('agent', 'blockedByRuntimeDesignBrief', 'State-changing design actions must remain blocked until the manifest-bound Brief is ready.');
requireToken('agent', 'executeDesignStrategyDeclaration', 'Agent must handle R3 strategy declaration inside Harness without external Tool dispatch.');
requireToken('agent', 'executeRuntimeActionPlanDeclaration', 'Agent must handle R4 action-plan declaration inside Harness without external Tool dispatch.');
requireToken('agent', "source: 'action_plan_declaration'", 'Only a validated R4 declaration may create an R4 plan record.');
requireToken('agent', 'this.runtimeActionPlanModulePromise = import(', 'Heavy R4 schema/validator code must load on demand after R3 readiness.');
requireToken('agent', 'recordActionPlanExecutionObservation', 'Agent must capture post-plan execution observations at the real Tool-result boundary.');
requireToken('agent', 'runtimeActionPlanExecutionJournal = undefined', 'Strategy and run resets must invalidate stale reconciliation observations.');
requireToken('actionExecutionPack', 'LEGACY_TOOL_CAPABILITY_MAP', 'The V0 execution pack must reuse the single Capability-to-provider map.');
requireToken('actionExecutionPack', 'compileRuntimeActionExecutionEnvelope', 'The V0 execution pack must compile a bounded TaskRun/R4 execution envelope.');
requireToken('actionExecutionPack', 'exactLeafCapabilityRequired: true', 'The V0 execution pack must require one-to-one leaf Capabilities.');
requireToken('actionExecutionPack', 'defaultOffOutsideExactCapability: true', 'The V0 execution pack must remain off outside an explicitly selected leaf Capability.');
requireToken('actionExecutionPack', "executionOwner: 'PhotoshopTransactionRunner'", 'The V0 execution pack must preserve the unique mutation execution owner.');
requireToken('actionExecutionPack', 'bindsSchemaCheckedArguments: true', 'Compiled V0 envelopes must bind schema-checked provider arguments.');
requireToken('actionExecutionPack', 'bindsPreflightTargetRevision: true', 'Compiled V0 envelopes must bind the preflight document revision.');
requireToken('actionExecutionPack', 'requiresIndependentRuntimeGate: true', 'A compiled envelope must not bypass the existing Runtime execution gate.');
forbidPattern('actionExecutionPack', /taskText|详情页|主图|SKU|sku-batch|detail-page-design|main-image-design/i, 'The V0 execution pack must remain category-neutral and task-text free.');
forbidPattern('actionExecutionPack', /executeTool\(|callModel\(/, 'The V0 execution pack must not execute Tools or call a model.');
const v0MutationActions = [
  ['renameLayer', 'photoshop.write.renameLayer'],
  ['groupLayersSafely', 'photoshop.write.groupLayersSafely'],
  ['moveLayer', 'photoshop.write.moveLayer'],
  ['lockLayer', 'photoshop.write.lockLayer'],
  ['setTextStyle', 'photoshop.write.setTextStyle']
];
for (const [providerName, capabilityRef] of v0MutationActions) {
  requireToken(
    'toolCapabilityBridge',
    `'${capabilityRef}': ['${providerName}']`,
    `V0 provider ${providerName} must have one dedicated leaf Capability in the single bridge.`
  );
  requireToken(
    'actionExecutionPack',
    `'${providerName}'`,
    `V0 execution pack must certify ${providerName}.`
  );
}
requireToken('uxpRenameLayer', 'photoshopTransactionRunner.run<', 'renameLayer must execute through PhotoshopTransactionRunner.');
requireToken('uxpGroupLayersSafely', 'photoshopTransactionRunner.run<', 'groupLayersSafely must execute through PhotoshopTransactionRunner.');
requireToken('uxpMoveLayer', 'photoshopTransactionRunner.run<', 'moveLayer must execute through PhotoshopTransactionRunner.');
requireToken('uxpLockLayer', "name = 'lockLayer'", 'The audited layer-properties provider must contain lockLayer.');
requireToken('uxpLockLayer', 'photoshopTransactionRunner.run<', 'lockLayer must execute through PhotoshopTransactionRunner.');
requireToken('uxpSetTextStyle', 'photoshopTransactionRunner.run<', 'setTextStyle must execute through PhotoshopTransactionRunner.');
requireToken('runtimeSession', 'beginRuntimeSessionNodeExecution', 'TaskRun must atomically bind the compiled node dispatch and document writer.');
requireToken('runtimeSession', 'recordRuntimeSessionNodeResultUnbound', 'A compiled dispatch without a bindable OperationResult must remain failed-or-unknown explicitly.');
requireToken('runtimeSession', 'recordsExistingDispatchOnly: true', 'TaskRun node dispatch recording must not become a second scheduler.');
requireToken('agent', 'prepareRuntimeActionExecutionEnvelope', 'The production Agent must compile V0 execution at the existing E1 dispatch seam.');
requireToken('agent', 'beginRuntimeSessionNodeExecution', 'The production Agent must atomically record compiled node dispatch before Tool execution.');
requireToken('agent', 'runtimeActionExecutionEnvelopeByCallId', 'The production Agent must retain a bounded call-to-node binding until the real Tool result returns.');
requireToken('agent', 'executionEnvelope?.nodeId', 'Real PhotoshopOperationResult must prefer the compiled R4 node binding.');
requireToken('agent', 'recordRuntimeSessionNodeResultUnbound', 'Missing or mismatched OperationResult after a compiled dispatch must not be silently treated as success.');
requireToken('agent', 'validateRuntimePlanningContextSeed', 'Agent must validate Reflexion planning context before exposing it to the model.');
requireToken('agent', 'runtime_planning_context_seed_required', 'Generation >1 must fail closed when semantic planning context is missing.');
requireToken('agent', 'runtimeDesignStrategyDeclaration: this.runtimeDesignStrategyDeclaration', 'Validated R3 Strategy must cross the Skill runtime boundary.');
requireToken('agent', 'runtimeActionPlanDeclaration: this.runtimeActionPlanDeclaration', 'Validated R4 shadow Plan must cross the Skill runtime boundary.');
requireToken('agent', 'buildRuntimeActionPlanReconciliationDigest', 'Agent execution summary must expose digest-only R4 execution reconciliation.');
requireToken('agent', 'buildRuntimeActionPlanNoRedoShadowDecision', 'Agent must derive the no-redo shadow decision from the current declaration and reconciliation.');
requireToken('agent', 'if (requiredOutputs.length === 0)', 'A raw save may satisfy E2 only when the effective contract declares no delivery outputs.');
requireToken('agent', 'const laterMutationExists = this.toolCallLog.slice(receiptIndex + 1)', 'Delivery receipts must be checked for later Photoshop mutations.');
requireToken('agent', 'if (laterMutationExists) continue;', 'A post-receipt write or save must invalidate that stale delivery receipt.');
requireToken('scopedChangeRecords', "key: 'requested_change_applied' | 'outside_scope_preserved'", 'Scoped edits must produce explicit target-applied and outside-scope-preserved verification keys.');
requireToken('agent', 'buildRuntimeScopedChangeVerificationRecords(this.toolCallLog, {', 'The live Agent evaluation must derive scoped-edit verification from actual acceptance records.');
requireToken('agent', 'exactPropertyScope: this.config.runtimeExactPropertyScope', 'Scoped-edit verification must bind the Engine-signed exact property scope instead of trusting model-selected Tool arguments.');
requireToken('executor', 'buildRuntimeResumeFreshnessProbeRequest(candidate.contextAnchor)', 'Production resume must probe the prior anchor before final prompt injection.');
requireToken('executor', "classifyAgentToolExecution(probe.toolName, probe.arguments) === 'read_only_observation'", 'Production freshness probes must be runtime-checked as readonly.');
requireToken('executor', 'evaluateRuntimeActionPlanResumeFreshness', 'Production resume must produce a machine-readable freshness verdict.');
requireToken('executor', 'actionPlanResumeFreshness: runResumeFreshness', 'Production result data must expose the freshness verdict without changing Agent success.');
requireToken('executor', 'runtimeActionPlanResumeFreshness: runResumeFreshness', 'Production Agent must receive the already-probed freshness verdict for explicit R4 mapping.');
requireToken('executor', 'buildRuntimePlanningContextSeed', 'Production Reflexion must build a same-Session planning-context seed.');
requireToken('executor', 'runtimePlanningContextSeed = buildRuntimePlanningContextSeed({', 'Production Reflexion must bind the seed before starting the next Agent generation.');
requireToken('planningContext', 'targetAndDownstreamInvalidated: true', 'Planning-context carry must invalidate the rollback target and downstream declarations.');
requireToken('planningContext', 'activeSessionOnly: true', 'Full planning declarations must remain inside the active Runtime Session.');
requireToken('planningContext', 'persistedAsDigestOnly: true', 'Planning-context persistence must remain digest-only.');
requireToken('planningContext', 'schedulerAuthority: false', 'Carried R4 Plans must not gain scheduler authority.');
requireToken('planningContext', 'runtime_planning_context_source_declaration_invalid', 'Missing or invalid upstream declarations must fail closed.');
forbidPattern('planningContext', /taskText|详情页|主图|SKU|sku-batch|detail-page-design|main-image-design/i, 'Planning-context carry must remain category-neutral and task-text free.');
forbidPattern('planningContext', /executeTool\(|callModel\(/, 'Planning-context carry must not execute Tools or call models.');
forbidPattern('agent', /import\s*\{[\s\S]{0,260}buildDeclareRuntimeActionPlanToolSchema[\s\S]{0,260}from\s+['"][^'"]*runtime-action-plan-declaration/, 'Agent must not statically pull the heavy R4 declaration module into the initial renderer chunk.');
forbidPattern('agent', /source:\s*'model_tool_plan'/, 'Ordinary Tool calls must not masquerade as a structured R4 plan record.');
requireToken('agent', 'isAgentCapabilityControlTool', 'Per-iteration capability budget must remain specific to capability requests.');
requireToken('agent', '!this.hasTaskProgressToolCalls()', 'Capability loading alone must not satisfy the first real task action.');
requireToken('agent', "if (!this.hasTaskProgressToolCalls()) return 'R0';", 'Reflexion routing must treat control-only runs as no real task progress.');
requireToken('agent', 'capabilityControlCallExecutedThisIteration', 'Agent must enforce one capability-control call per model iteration.');
requireToken('decisionContract', "intentScope === 'knowledge_search'", 'Knowledge-search tasks must be able to request additional capabilities.');
requireToken('generalManifest', "task_type: 'design.generic.v1'", 'Generic design manifest must be selected by structured task type.');
forbidPattern('generalManifest', /matchSignals|taskText|\.test\(/, 'Generic manifest must not contain task-text matching logic.');

const report = {
  success: violations.length === 0,
  violationCount: violations.length,
  violations,
  checks: [
    'no parallel capability registry',
    'no task-text category routing in Resolver or runtime bundle',
    'manifest-owned legacy aliases',
    'shared Tool semantics are reused without a second metadata registry',
    'Knowledge, Skill, Tool, Memory, Evaluation and Policy references resolve against real provider identities',
    'missing and wrong-kind manifest references remain partial instead of silently resolved',
    'non-executable providers never inject Tool schemas or claim runtime use',
    'manifest-selected Evaluation Profiles reuse the single DesignScorecard and DesignVerdict chain',
    'final-review surfaces, runtime evidence and repair stages are Profile metadata rather than Agent business branches',
    'quality hard blockers require deterministic blockerKind plus validated proofRef across scorecard, completion, verdict and critic',
    'aesthetic assertions are Brief-relative VLM judgments; measurements are evidence, and white/minimal/no-copy directions remain neutral',
    'upstream workMode identity selects the effective contract and cannot be replaced by R1',
    'critical inputs missing, needs-review and explicit failure remain distinct without default pass',
    'versioned Skill-scoped business result adapters reject Tool-success shortcuts and stale post-mutation checks',
    'declared E2 outputs require a fresh structured receipt; raw saves and post-receipt writes cannot shortcut delivery',
    'scoped-edit evaluation proves the requested change and preservation outside the target scope',
    'detail-page content verification carries stable fact refs through execution and refuses ungrounded or unsafe claims',
    'Project facts retain source and confirmation levels while Agent proposals and legacy strings remain unverified',
    'Project and brand rules are versioned, conflict-aware, review-gated and never grant Tool permission',
    'Knowledge content is version-bound, freshness-filtered, withdrawal-aware and captured in non-authorizing digest snapshots',
    'SKU human review is content-addressed, integrity-checked and freshness-gated before Evaluation',
    'reviewed Tool metadata and future unknown fallback remain distinguishable',
    'explicit legacy-unclassified discovery',
    'production Agent consumes one capability session and one runtime bundle',
    'in-loop design intent declaration atomically binds the same TaskRun generation, Runtime bundle, stage context, Capability Session, Evaluation, budget and Artifact finalizer',
    'bounded required-workflow recovery cannot be recreated from advisory Skill recommendations or model prose',
    'capability loading is not execution permission, an observation, or task progress',
    'already-active Capability requests remain successful idempotent no-ops but stop after a bounded no-progress loop',
    'when an optional Runtime Profile is active, its R1 Design Brief remains model-authored and manifest-bound before governed state changes',
    'R3 strategy is model-authored, context-grounded Harness control rather than a Tool capability',
    'R4 action plan is model-authored, R3-grounded, Capability-validated context rather than a scheduler',
    'V0 execution envelopes require a certified leaf Capability, schema-bound arguments, TaskRun writer and preflight revision before the unique PhotoshopTransactionRunner is called',
    'Reflexion carries only validated upstream model declarations inside the same Session and invalidates the rollback target plus downstream context',
    'R4 execution reconciliation reuses live Capability inventory and refuses ambiguous, out-of-order, unmatched, failed and repeated observations without scheduling',
    'cross-run resume advice requires matching post-write readonly document and project-state fingerprints and remains advisory-only',
    'cross-run no-redo observation separates completed from pending nodes and requires model-explicit one-to-one mapping without blocking Tools',
    'real-provider no-redo probing is double-opt-in, structured, redacted and never executes returned Tools',
    'R4 schema and validator load on demand instead of inflating every conversation startup',
    'forbidden capability closes over shared legacy provider Tools',
    'work-mode Capability ceiling separately constrains startup seeds, on-demand discovery and late-bound Session state without alias deny closure',
    'on-demand batch size is bounded without reducing eventual reachability',
    'production Capability selection has no executor-inferred category fallback; unique text routing remains a declaration-owned selection record'
  ]
};

console.log(JSON.stringify(report, null, 2));
if (!report.success) process.exit(1);
