#!/usr/bin/env node
'use strict';

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    target: 'ES2020',
    module: 'CommonJS',
    moduleResolution: 'node',
    esModuleInterop: true,
    skipLibCheck: true
  }
});

const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const ts = require('typescript');
const {
  auditSkuPrerequisiteRepairBehavior
} = require('./lib/sku-prerequisite-repair-audit.cjs');

const root = path.resolve(__dirname, '..');
const {
  promoteStagedFileSet
} = require(path.join(root, 'src', 'main', 'services', 'staged-file-promotion.ts'));
const {
  captureSkuStagingDestinationBaselines,
  issueSkuStagingTransaction,
  removeSkuStagingParentIfEmpty,
  removeSkuStagingTransactionRoot
} = require(path.join(root, 'src', 'main', 'services', 'sku-staging-transaction.service.ts'));
const {
  beginRuntimeOwnedSkillToolLedgerScope,
  createGuardedAtomicToolExecutor,
  createRuntimeOwnedSkillDeliveryPlanAuthority
} = require(path.join(root, 'src', 'shared', 'agent-skill-atomic-tool-execution.ts'));
const {
  finalizeSkuStagingCleanup,
  joinSkuExportPath,
  normalizeSkuExportPathForCompare,
  promoteSkuStagedDeliverySet,
  validateSkuStagedRasterExports
} = require(path.join(
  root,
  'src',
  'renderer',
  'services',
  'skill-executors',
  'sku-export-transaction.service.ts'
));
const performancePolicyPath = path.join(root, 'src', 'shared', 'agent-performance-policy.ts');
const projectAssetIndexPath = path.join(root, 'src', 'shared', 'project-asset-index.ts');
const visualSamplingPath = path.join(root, 'src', 'shared', 'project-visual-sampling.ts');
const defaultsPath = path.join(root, 'src', 'shared', 'skill-param-defaults.ts');
const promptPath = path.join(root, 'src', 'shared', 'designer-agent-autonomy-principles.ts');
const agentWorkflowContinuationScopePath = path.join(
  root,
  'src',
  'shared',
  'agent-workflow-continuation-scope.ts'
);
const agentReActObservationContractPath = path.join(
  root,
  'src',
  'shared',
  'agent-react-observation-contract.ts'
);
const planningContractPath = path.join(root, 'src', 'shared', 'agent-task-planning-contract.ts');
const taskProgressIdentityPath = path.join(root, 'src', 'shared', 'agent-task-progress-identity.ts');
const manifestSchemaPath = path.join(root, 'schemas', 'skill-runtime-manifest.schema.json');
const runtimeBundlePath = path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-contract-bundle.ts');
const runtimeStagePlanPath = path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-stage-plan.ts');
const runtimeDesignBriefPath = path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-design-brief-declaration.ts');
const runtimeReferenceContextPath = path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-reference-context.ts');
const runtimeScopedChangeRecordsPath = path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-scoped-change-records.ts');
const scopedEditRuntimePolicyPath = path.join(root, 'src', 'shared', 'agent-runtime-v5', 'scoped-edit-runtime-policy.ts');
const runtimeMethodKnowledgePath = path.join(root, 'src', 'shared', 'agent-runtime-v5', 'design-method-knowledge.ts');
const runtimeContextCompilerPath = path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-context-compiler.ts');
const runtimeStageStatePath = path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-stage-state.ts');
const runtimeSessionPath = path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-session.ts');
const pendingInteractiveContinuationPath = path.join(
  root,
  'src',
  'shared',
  'pending-interactive-continuation.ts'
);
const interactiveContinuationOperationPath = path.join(
  root,
  'src',
  'shared',
  'interactive-continuation-operation.ts'
);
const interactiveCardContractPath = path.join(root, 'src', 'shared', 'interactive-card-contract.ts');
const agentRuntimeLivenessPolicyPath = path.join(root, 'src', 'shared', 'agent-runtime-liveness-policy.ts');
const agentReadResultCachePath = path.join(root, 'src', 'shared', 'agent-read-result-cache.ts');
const visualObservationBundlePath = path.join(root, 'src', 'shared', 'visual-observation-bundle.ts');
const designVisualJudgeObservationPath = path.join(root, 'src', 'shared', 'design-visual-judge-observation.ts');
const designerAgentTeamConsultationPath = path.join(
  root,
  'src',
  'shared',
  'designer-agent-team-consultation-contract.ts'
);
const taskProfilePath = path.join(root, 'src', 'shared', 'design-task-types.ts');
const artifactKnowledgePath = path.join(root, 'src', 'shared', 'knowledge', 'design-artifact-knowledge.ts');
const photoshopCraftRecipesPath = path.join(root, 'src', 'shared', 'knowledge', 'photoshop-craft-recipes.ts');
const designKnowledgeSearchPath = path.join(root, 'src', 'shared', 'design-knowledge-search.ts');
const designMemoryKnowledgePath = path.join(root, 'src', 'shared', 'design-memory-knowledge.ts');
const designLearningMemoryReviewPath = path.join(root, 'src', 'shared', 'design-learning-memory-review.ts');
const designLearningExperiencePath = path.join(root, 'src', 'shared', 'design-learning-experience.ts');
const projectMemoryScopePath = path.join(root, 'src', 'shared', 'project-memory-scope.ts');
const skuComboInteractiveCardPath = path.join(root, 'src', 'shared', 'sku-combo-interactive-card.ts');
const editableConfirmationInteractiveCardPath = path.join(
  root,
  'src',
  'shared',
  'editable-confirmation-interactive-card.ts'
);
const subjectFitPath = path.join(root, 'src', 'shared', 'subject-fit.ts');
const layoutEnginePath = path.join(root, 'src', 'shared', 'layout', 'layout-engine.ts');
const renderLayoutStylePath = path.join(root, 'src', 'shared', 'layout', 'render-layout-style.ts');
const composeDesignSpecPath = path.join(root, 'src', 'shared', 'design-workshop', 'compose-design-spec.ts');
const jpegExportQualitySemanticsPath = path.join(root, 'src', 'shared', 'jpeg-export-quality-semantics.ts');
const toolExecutorPath = path.join(root, 'src', 'renderer', 'services', 'tool-executor.service.ts');
const publicPlanPhotoshopAdapterPath = path.join(
  root,
  'src',
  'renderer',
  'services',
  'agent-orchestration',
  'public-plan-photoshop-adapter.ts'
);
const composeDesignExecutorPath = path.join(root, 'src', 'renderer', 'services', 'design-workshop', 'compose-design.executor.ts');
const screenshotHandlersPath = path.join(root, 'src', 'main', 'ipc-handlers', 'screenshot-handlers.ts');
const uxpCreateTextLayerPath = path.resolve(
  root,
  '..',
  'DesignEcho-UXP',
  'src',
  'tools',
  'text',
  'create-text-layer.ts'
);
const memoryServicePath = path.join(root, 'src', 'renderer', 'services', 'memory.service.ts');
const executorPath = path.join(root, 'src', 'renderer', 'services', 'skill-executors', 'autonomous-agent.executor.ts');
const designPlannerContextPath = path.join(
  root,
  'src',
  'renderer',
  'services',
  'skill-executors',
  'design-planner-context.ts'
);
const projectImageAnalysisExecutorPath = path.join(
  root,
  'src',
  'renderer',
  'services',
  'skill-executors',
  'project-image-analysis.executor.ts'
);
const agentRuntimePath = path.join(root, 'src', 'renderer', 'services', 'agent-runtime', 'agent.ts');
const terminalClosureCheckpointPath = path.join(
  root,
  'src',
  'renderer',
  'services',
  'agent-runtime',
  'terminal-closure-checkpoint.ts'
);
const mutationBoundDesignIntentPath = path.join(
  root,
  'src',
  'renderer',
  'services',
  'agent-runtime',
  'mutation-bound-design-intent.ts'
);
const designFinalReviewEvidencePath = path.join(
  root,
  'src',
  'renderer',
  'services',
  'agent-runtime',
  'design-final-review-evidence.ts'
);
const designFinalComparisonEvidencePath = path.join(
  root,
  'src',
  'renderer',
  'services',
  'agent-runtime',
  'design-final-comparison-evidence.ts'
);
const trustedFinalComparisonEvidencePath = path.join(
  root,
  'src',
  'renderer',
  'services',
  'agent-runtime',
  'trusted-final-comparison-evidence.ts'
);
const agentModelTransportPolicyPath = path.join(
  root,
  'src',
  'shared',
  'agent-model-transport-policy.ts'
);
const finalQualityModelProtocolPath = path.join(
  root,
  'src',
  'renderer',
  'services',
  'agent-runtime',
  'final-quality-model-protocol.ts'
);
const finalQualityReviewRuntimePath = path.join(
  root,
  'src',
  'renderer',
  'services',
  'agent-runtime',
  'final-quality-review-runtime.ts'
);
const modelVisualPresentationReceiptPath = path.join(
  root,
  'src',
  'shared',
  'model-visual-presentation-receipt.ts'
);
const designSurfaceSnapshotNormalizerPath = path.join(
  root,
  'src',
  'shared',
  'design-surface-snapshot-normalizer.ts'
);
const runtimeReferenceAdapterPath = path.join(
  root,
  'src',
  'renderer',
  'services',
  'agent-runtime',
  'runtime-reference-adapter.ts'
);
const capabilitySessionPath = path.join(
  root,
  'src',
  'renderer',
  'services',
  'agent-runtime',
  'capability-session.ts'
);
const designTeamCoordinatorPath = path.join(root, 'src', 'renderer', 'services', 'design-teams', 'coordinator.ts');
const trustedVisualReviewArtifactPath = path.join(
  root,
  'src',
  'renderer',
  'services',
  'agent-runtime',
  'trusted-visual-review-artifact.ts'
);
const visualObservationStrategyPath = path.join(
  root,
  'src',
  'renderer',
  'services',
  'agent-runtime',
  'visual-observation-strategy.ts'
);
const toolResultSanitizerPath = path.join(
  root,
  'src',
  'renderer',
  'services',
  'agent-runtime',
  'tool-result-sanitizer.ts'
);
const toolResultProvenancePath = path.join(
  root,
  'src',
  'renderer',
  'services',
  'agent-runtime',
  'tool-result-provenance.ts'
);
const agentRuntimeTypesPath = path.join(root, 'src', 'renderer', 'services', 'agent-runtime', 'types.ts');
const agentUserResultProjectionPath = path.join(root, 'src', 'renderer', 'services', 'agent-runtime', 'agent-user-result-projection.ts');
const agentActionEventProjectionPath = path.join(root, 'src', 'renderer', 'services', 'agent-runtime', 'agent-action-event-projection.ts');
const agentOrchestrationTypesPath = path.join(
  root,
  'src',
  'renderer',
  'services',
  'agent-orchestration',
  'types.ts'
);
const taskCompletionContractPath = path.join(root, 'src', 'renderer', 'services', 'agent-runtime', 'task-completion-contract.ts');
const agentOperationLedgerPath = path.join(root, 'src', 'shared', 'agent-operation-ledger.ts');
const designTaskPolicyPath = path.join(root, 'src', 'renderer', 'services', 'agent-policies', 'design-task-policy.ts');
const designQualityVerdictPath = path.join(root, 'src', 'shared', 'design-quality-verdict-bundle.ts');
const designQualityAssertionPath = path.join(root, 'src', 'shared', 'design-quality-assertion.ts');
const reflexionReentryPolicyPath = path.join(root, 'src', 'shared', 'reflexion-reentry-policy.ts');
const reflexionWriteFreshnessPath = path.join(
  root,
  'src',
  'renderer',
  'services',
  'agent-runtime',
  'reflexion-write-freshness.ts'
);
const runtimeReflexionContractPath = path.join(
  root,
  'src',
  'shared',
  'agent-runtime-v5',
  'reflexion-contract.ts'
);
const designEvaluationProfilesPath = path.join(
  root,
  'src',
  'shared',
  'agent-runtime-v5',
  'design-evaluation-profiles.ts'
);
const skuConfigExecutorPath = path.join(root, 'src', 'renderer', 'services', 'skill-executors', 'sku-config.executor.ts');
const skuBatchExecutorPath = path.join(root, 'src', 'renderer', 'services', 'skill-executors', 'sku-batch.executor.ts');
const skuExportTransactionPath = path.join(root, 'src', 'renderer', 'services', 'skill-executors', 'sku-export-transaction.service.ts');
const stagedDeliveryPromotionPath = path.join(root, 'src', 'renderer', 'services', 'skill-executors', 'staged-delivery-promotion.service.ts');
const runtimeStagedDeliveryPath = path.join(root, 'src', 'renderer', 'services', 'skill-executors', 'runtime-staged-delivery.service.ts');
const rendererStagedFileTransactionPath = path.join(root, 'src', 'renderer', 'services', 'skill-executors', 'staged-file-transaction.service.ts');
const stagedFilePromotionPath = path.join(root, 'src', 'main', 'services', 'staged-file-promotion.ts');
const skuStagingTransactionServicePath = path.join(root, 'src', 'main', 'services', 'sku-staging-transaction.service.ts');
const skillToolsPath = path.join(root, 'src', 'renderer', 'services', 'skill-executors', 'skill-tools.ts');
const skuExportReadbackPath = path.join(root, 'src', 'shared', 'sku-export-readback.ts');
const skuDeliverySummaryPath = path.join(root, 'src', 'shared', 'sku-delivery-summary.ts');
const agentDiagnosticRecordPath = path.join(root, 'src', 'shared', 'agent-diagnostic-record.ts');
const skuHumanReviewPath = path.join(root, 'src', 'shared', 'sku-human-review.ts');
const skuColorCardExecutorPath = path.join(root, 'src', 'renderer', 'services', 'skill-executors', 'sku-color-card.executor.ts');
const ecommerceSocksDesignExecutorPath = path.join(
  root,
  'src',
  'renderer',
  'services',
  'skill-executors',
  'ecommerce-socks-design.executor.ts'
);
const detailPageExecutorPath = path.join(root, 'src', 'renderer', 'services', 'skill-executors', 'detail-page.executor.ts');
const detailPageAgentIntakePath = path.join(root, 'src', 'shared', 'detail-page-agent-intake.ts');
const detailPageAssetRankerPath = path.join(root, 'src', 'renderer', 'services', 'skill-executors', 'detail-page-asset-ranker.ts');
const detailPageDesignSkillPath = path.join(root, 'src', 'renderer', 'services', 'skill-executors', 'detail-page-design.skill.ts');
const skillExecutorIndexPath = path.join(root, 'src', 'renderer', 'services', 'skill-executors', 'index.ts');
const skuColorCardContractPath = path.join(root, 'src', 'shared', 'sku-color-card-skill.ts');
const skuArtifactRolesPath = path.join(root, 'src', 'shared', 'sku-artifact-roles.ts');
const skuTemplateDesignLoopPath = path.join(root, 'src', 'shared', 'sku-template-design-loop.ts');
const deterministicConsistencyPath = path.join(root, 'src', 'shared', 'deterministic-consistency-verification.ts');
const skuAutoLayoutExecutorPolicyPath = path.join(root, 'src', 'shared', 'sku-auto-layout-executor-policy.ts');
const skuTemplateContentConsistencyPath = path.join(root, 'src', 'shared', 'sku-template-content-consistency.ts');
const skuTemplateSelectionPath = path.join(root, 'src', 'shared', 'sku-template-selection.ts');
const designPlacementIntelligencePath = path.join(root, 'src', 'shared', 'design-placement-intelligence.ts');
const skillRoutingPath = path.join(root, 'src', 'shared', 'skill-routing.ts');
const skillDeclarationsPath = path.join(root, 'src', 'shared', 'skills', 'skill-declarations.ts');
const skuIntentParamsPath = path.join(root, 'src', 'shared', 'sku-intent-params.ts');
const toolSchemasPath = path.join(root, 'src', 'renderer', 'services', 'agent-runtime', 'tool-schemas.ts');
const performanceLedgerPath = path.join(root, 'src', 'renderer', 'services', 'agent-runtime', 'performance-ledger.ts');
const performanceVisionPolicyPath = path.join(
  root,
  'src',
  'renderer',
  'services',
  'agent-runtime',
  'performance-vision-policy.ts'
);
const activeRuntimeAccountingPath = path.join(root, 'src', 'renderer', 'services', 'agent-runtime', 'active-runtime-accounting.ts');
const runtimeAccountingPath = path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-accounting.ts');
const enginePath = path.join(root, 'src', 'renderer', 'services', 'design-agent', 'engine.ts');
const agentToolExecutionPreflightPath = path.join(root, 'src', 'shared', 'agent-tool-execution-preflight.ts');
const agentSkillAtomicToolExecutionPath = path.join(root, 'src', 'shared', 'agent-skill-atomic-tool-execution.ts');
const agentProviderTruncationRecoveryPath = path.join(root, 'src', 'shared', 'agent-provider-truncation-recovery.ts');
const agentToolFailureDiagnosticPath = path.join(root, 'src', 'shared', 'agent-tool-failure-diagnostic.ts');
const agentToolDecisionContractPath = path.join(root, 'src', 'shared', 'agent-tool-decision-contract.ts');
const documentOptionalToolsPath = path.join(root, 'src', 'shared', 'document-optional-tools.ts');
const routingPath = path.join(root, 'src', 'renderer', 'services', 'agent-orchestration', 'routing.ts');
const modelProviderFailurePath = path.join(root, 'src', 'shared', 'model-provider-failure.ts');
const modelProviderTransportPolicyPath = path.join(
  root,
  'src',
  'shared',
  'model-provider-transport-policy.ts'
);
const codexTurnProgressPath = path.join(root, 'src', 'shared', 'codex-turn-progress.ts');
const designDocumentRolePath = path.join(root, 'src', 'shared', 'design-document-role.ts');
const toolAcceptancePath = path.join(root, 'src', 'shared', 'acceptance', 'tool-acceptance.ts');
const policyGateRepeatGuardPath = path.join(root, 'src', 'shared', 'policy-gate-repeat-guard.ts');
const conversationalUnavailableMessagePath = path.join(
  root,
  'src',
  'shared',
  'conversational-unavailable-message.ts'
);
const agentRunRecordPath = path.join(root, 'src', 'shared', 'agent-run-record.ts');
const agentRunResumePath = path.join(root, 'src', 'shared', 'agent-run-resume.ts');
const chatComposerContentPath = path.join(root, 'src', 'shared', 'chat-composer-content.ts');
const eagleComposerTransferPath = path.join(root, 'src', 'shared', 'eagle-composer-transfer.ts');
const eagleReadonlyKnowledgeServicePath = path.join(
  root,
  'src',
  'main',
  'services',
  'eagle-readonly-knowledge-service.ts'
);
const agentMessageContextPath = path.join(
  root,
  'src',
  'renderer',
  'services',
  'agent-runtime',
  'message-context.ts'
);
const agentVisibleFeedbackPath = path.join(
  root,
  'src',
  'renderer',
  'services',
  'agent-visible-feedback.ts'
);
const chatPanelPath = path.join(root, 'src', 'renderer', 'components', 'ChatPanel.tsx');
const designAgentWorkbenchPath = path.join(root, 'src', 'renderer', 'components', 'DesignAgentWorkbench.tsx');
const eagleLibraryPagePath = path.join(root, 'src', 'renderer', 'components', 'EagleLibraryPage.tsx');
const inlineMultimodalComposerPath = path.join(
  root,
  'src',
  'renderer',
  'components',
  'chat',
  'InlineMultimodalComposer.tsx'
);
const appStorePath = path.join(root, 'src', 'renderer', 'stores', 'app.store.ts');
const messageParserPath = path.join(root, 'src', 'renderer', 'components', 'message', 'parser.ts');
const chatResponseCleanerPath = path.join(root, 'src', 'shared', 'chat-response-cleaner.ts');
const messageRendererPath = path.join(root, 'src', 'renderer', 'components', 'message', 'MessageRenderer.tsx');
const messageRendererCssPath = path.join(root, 'src', 'renderer', 'components', 'message', 'MessageRenderer.css');
const settingsModalPath = path.join(root, 'src', 'renderer', 'components', 'SettingsModal.tsx');
const modelServicePath = path.join(root, 'src', 'main', 'services', 'model-service.ts');
const codexSubscriptionServicePath = path.join(
  root,
  'src',
  'main',
  'services',
  'codex-subscription-service.ts'
);
const agentToolStreamServicePath = path.join(
  root,
  'src',
  'renderer',
  'services',
  'agent-tool-stream.service.ts'
);
const resourceManagerServicePath = path.join(root, 'src', 'main', 'services', 'resource-manager-service.ts');
const templateKnowledgeServicePath = path.join(root, 'src', 'main', 'services', 'template-knowledge.service.ts');
const interactiveContinuationOperationStorePath = path.join(
  root,
  'src',
  'main',
  'services',
  'interactive-continuation-operation-store.ts'
);
const preloadPath = path.join(root, 'src', 'main', 'preload.ts');
const mainIndexPath = path.join(root, 'src', 'main', 'index.ts');
const debugBridgeServicePath = path.join(root, 'src', 'main', 'services', 'debug-bridge-service.ts');
const debugBridgeChatContractPath = path.join(root, 'src', 'shared', 'debug-bridge-chat.ts');
const designReliabilityCliPath = path.join(root, 'scripts', 'design-reliability.cjs');
const fileSystemHandlersPath = path.join(root, 'src', 'main', 'ipc-handlers', 'file-system-handlers.ts');
const rendererTypesPath = path.join(root, 'src', 'renderer', 'types.d.ts');
const websocketHandlersPath = path.join(root, 'src', 'main', 'ipc-handlers', 'websocket-handlers.ts');
const retiredPreflightPath = path.join(
  root,
  'src',
  'renderer',
  'services',
  'agent-orchestration',
  'document-structure-preflight.ts'
);
const uxpRoot = path.resolve(root, '..', 'DesignEcho-UXP');
const uxpSkuLayoutPath = path.join(uxpRoot, 'src', 'tools', 'layout', 'sku-layout-tool.ts');
const uxpSkuAutoLayoutPlanPath = path.join(uxpRoot, 'src', 'tools', 'sku', 'sku-auto-layout-plan.ts');
const uxpListDocumentsPath = path.join(uxpRoot, 'src', 'tools', 'canvas', 'list-documents.ts');
const uxpSetTextContentPath = path.join(uxpRoot, 'src', 'tools', 'text', 'set-text-content.ts');

const protectedBusinessPattern = /main[-_ ]?image|detail[-_ ]?page|sku[-_ ]?(?:batch|color)|reference[-_ ]?replication|ecommerce\.(?:main_image|detail_page|sku_)/i;
const sensitiveAuthorizationFields = new Set([
  'approvedLiveExecution',
  'approvedLiveAdapterRun',
  'userCheckpointApproved',
  'explicitProjectWriteApproval',
  'allowPhotoshopWrites'
]);
// 棘轮语义：拦「新增品类特性/分支」。修正既有品类误判、且只复用已有信号函数的改动，
// 允许在留痕后上调基线——否则棘轮会连 bug 修复一起拦死，变成阻碍而不是护栏。
// 每次上调都必须写明原因与增量来源，禁止无说明地抬基线。
const TRANSITIONAL_BUSINESS_REFERENCE_BASELINES = Object.freeze([
  { file: 'src/shared/agent-intent-control-plane.ts', baseline: 22 },
  // 53→55（2026-07-30）：修正「主图详情页SKU 三类并列点名」被判成单一品类、
  // 进而把 SKU 曲解成主图素材来源的真机缺陷。增量＝listsAllPrimaryDeliverableKinds 里
  // 对既有 hasMainImageSignal / hasDetailPageSignal 的两次复用，未引入任何新品类概念或分支。
  // 55→51（2026-08-01）：普通 autonomous 计划改为中性任务目标，SKU/模板等自然语言
  // 由主 Agent 声明意图，不再由计划层预造业务场景；同步锁住本轮已减少的耦合。
  { file: 'src/shared/agent-task-planning-contract.ts', baseline: 51 },
  { file: 'src/shared/agent-design-execution-preflight.ts', baseline: 40 },
  { file: 'src/renderer/services/agent-orchestration/conversational.ts', baseline: 14 }
]);

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function parse(filePath) {
  return ts.createSourceFile(
    filePath,
    read(filePath),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
}

function collectNodes(node, predicate) {
  const matches = [];
  function visit(current) {
    if (predicate(current)) matches.push(current);
    ts.forEachChild(current, visit);
  }
  if (node) visit(node);
  return matches;
}

function findFunction(sourceFile, name) {
  return collectNodes(sourceFile, (node) => (
    ts.isFunctionDeclaration(node) && node.name?.text === name
  ))[0];
}

function findMethod(sourceFile, name) {
  return collectNodes(sourceFile, (node) => (
    ts.isMethodDeclaration(node) && propertyName(node.name) === name
  ))[0];
}

function findVariableDeclaration(sourceFile, name) {
  return collectNodes(sourceFile, (node) => (
    ts.isVariableDeclaration(node)
    && ts.isIdentifier(node.name)
    && node.name.text === name
  ))[0];
}

function findPropertyAssignment(sourceFile, name) {
  return collectNodes(sourceFile, (node) => (
    ts.isPropertyAssignment(node) && propertyName(node.name) === name
  ))[0];
}

function findInterfaceDeclaration(sourceFile, name) {
  return collectNodes(sourceFile, (node) => (
    ts.isInterfaceDeclaration(node) && node.name.text === name
  ))[0];
}

function parseTsx(filePath) {
  return ts.createSourceFile(
    filePath,
    read(filePath),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
}

async function inspectSkuTemplateFixtureWithMockHost(filePath, document, expectedItemCount) {
  const Module = require('module');
  const originalLoad = Module._load;
  const photoshop = {
    app: {
      documents: [document],
      activeDocument: document
    },
    core: {
      executeAsModal: async (callback) => await callback()
    },
    action: {
      batchPlay: async () => []
    }
  };
  const uxp = {
    storage: {
      localFileSystem: {},
      formats: { utf8: 'utf8' }
    }
  };

  let SKULayoutTool;
  Module._load = function loadUxpAuditDependency(request, parent, isMain) {
    if (request === 'photoshop') return photoshop;
    if (request === 'uxp') return uxp;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve(filePath)];
    ({ SKULayoutTool } = require(filePath));
  } finally {
    Module._load = originalLoad;
  }

  return await new SKULayoutTool().execute({
    action: 'inspectTemplateLayout',
    templateDocName: document.name,
    expectedItemCount
  });
}

async function exerciseSkuLayoutActionWithMockHost(filePath, params) {
  const Module = require('module');
  const originalLoad = Module._load;
  const calls = [];
  let modalCallCount = 0;
  const photoshop = {
    app: {
      documents: [],
      activeDocument: null
    },
    core: {
      executeAsModal: async (callback) => {
        modalCallCount += 1;
        return await callback();
      }
    },
    action: {
      batchPlay: async (commands) => {
        calls.push(...(Array.isArray(commands) ? commands : []));
        return [];
      }
    }
  };
  const uxp = {
    storage: {
      localFileSystem: {},
      formats: { utf8: 'utf8' }
    }
  };

  let SKULayoutTool;
  Module._load = function loadUxpActionAuditDependency(request, parent, isMain) {
    if (request === 'photoshop') return photoshop;
    if (request === 'uxp') return uxp;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve(filePath)];
    ({ SKULayoutTool } = require(filePath));
  } finally {
    Module._load = originalLoad;
  }

  const tool = new SKULayoutTool();
  const result = await tool.execute(params);
  return { calls, modalCallCount, result, schema: tool.schema };
}

function loadInstrumentedSkuDeleteHelper(filePath, photoshop) {
  const Module = require('module');
  const sourceText = read(filePath);
  const exportMarker = 'export { deleteCopiedSkuLayers as __auditDeleteCopiedSkuLayers };';
  const transpiled = ts.transpileModule(`${sourceText}\n${exportMarker}\n`, {
    fileName: filePath,
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      esModuleInterop: true,
      skipLibCheck: true
    }
  });
  const auditModule = new Module(filePath, module);
  auditModule.filename = filePath;
  auditModule.paths = Module._nodeModulePaths(path.dirname(filePath));

  const originalLoad = Module._load;
  const uxp = {
    storage: {
      localFileSystem: {},
      formats: { utf8: 'utf8' }
    }
  };
  Module._load = function loadUxpDeleteAuditDependency(request, parent, isMain) {
    if (request === 'photoshop') return photoshop;
    if (request === 'uxp') return uxp;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    auditModule._compile(transpiled.outputText, filePath);
  } finally {
    Module._load = originalLoad;
  }

  const deleteHelper = auditModule.exports.__auditDeleteCopiedSkuLayers;
  if (typeof deleteHelper !== 'function') {
    throw new Error('无法加载 SKU deleteCopiedSkuLayers 生产函数。');
  }
  return deleteHelper;
}

function loadInstrumentedSkuMutationHelpers(filePath, photoshop) {
  const Module = require('module');
  const sourceText = read(filePath);
  const exportMarker = [
    'export {',
    '  applySkuAutoLayoutPlan as __auditApplySkuAutoLayoutPlan,',
    '  batchPlayResize as __auditBatchPlayResize,',
    '  batchPlayTranslate as __auditBatchPlayTranslate',
    '};'
  ].join('\n');
  const transpiled = ts.transpileModule(`${sourceText}\n${exportMarker}\n`, {
    fileName: filePath,
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      esModuleInterop: true,
      skipLibCheck: true
    }
  });
  const auditModule = new Module(`${filePath}#sku-mutation-audit`, module);
  auditModule.filename = filePath;
  auditModule.paths = Module._nodeModulePaths(path.dirname(filePath));

  const originalLoad = Module._load;
  const uxp = {
    storage: {
      localFileSystem: {},
      formats: { utf8: 'utf8' }
    }
  };
  Module._load = function loadUxpMutationAuditDependency(request, parent, isMain) {
    if (request === 'photoshop') return photoshop;
    if (request === 'uxp') return uxp;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    auditModule._compile(transpiled.outputText, filePath);
  } finally {
    Module._load = originalLoad;
  }

  const resize = auditModule.exports.__auditBatchPlayResize;
  const translate = auditModule.exports.__auditBatchPlayTranslate;
  const apply = auditModule.exports.__auditApplySkuAutoLayoutPlan;
  if (typeof resize !== 'function' || typeof translate !== 'function' || typeof apply !== 'function') {
    throw new Error('无法加载 SKU applySkuAutoLayoutPlan/batchPlayResize/batchPlayTranslate 生产函数。');
  }
  return { apply, resize, translate };
}

function readAuditDescriptorTargetId(descriptor, reference) {
  const target = Array.isArray(descriptor?._target) ? descriptor._target : [];
  const item = target.find((candidate) => candidate?._ref === reference);
  return Number(item?._id);
}

function removeAuditLayerById(layers, layerId) {
  if (!Array.isArray(layers)) return false;
  const directIndex = layers.findIndex((layer) => Number(layer?.id) === Number(layerId));
  if (directIndex >= 0) {
    layers.splice(directIndex, 1);
    return true;
  }
  for (const layer of layers) {
    if (removeAuditLayerById(layer?.layers, layerId)) return true;
  }
  return false;
}

async function exerciseSkuDeleteHelper(filePath, deleteMode) {
  const targetLayerId = 901;
  const targetDocumentId = 7101;
  const decoyDocumentId = 7102;
  const targetDocument = {
    id: targetDocumentId,
    name: 'sku-delete-target-audit.psb',
    layers: [{ id: targetLayerId, name: '目标文档颜色卡' }]
  };
  const decoyDocument = {
    id: decoyDocumentId,
    name: 'sku-delete-decoy-audit.psb',
    layers: [{ id: targetLayerId, name: '重复 layerId 干扰层' }]
  };
  const calls = [];
  const photoshop = {
    app: {
      documents: [decoyDocument, targetDocument],
      activeDocument: decoyDocument
    },
    core: {
      executeAsModal: async (callback) => await callback()
    },
    action: {
      batchPlay: async (commands) => {
        const command = commands?.[0] || {};
        calls.push(command);
        const documentId = readAuditDescriptorTargetId(command, 'document');
        const layerId = readAuditDescriptorTargetId(command, 'layer');
        const document = photoshop.app.documents.find((item) => Number(item?.id) === documentId);
        const layerExists = Boolean(findAuditLayerById(document?.layers, layerId));

        if (command?._obj === 'get') {
          if (layerExists) return [{ _obj: 'layer', layerID: layerId }];
          return [{
            _obj: 'error',
            result: -25922,
            message: 'The object could not be found.'
          }];
        }
        if (command?._obj === 'delete') {
          if (deleteMode === 'error_descriptor') {
            return [{
              _obj: 'error',
              result: -25922,
              message: 'Delete failed in audit fixture.'
            }];
          }
          if (deleteMode === 'no_effect') return [{}];
          removeAuditLayerById(document?.layers, layerId);
          return [{}];
        }
        return [{}];
      }
    }
  };
  const deleteHelper = loadInstrumentedSkuDeleteHelper(filePath, photoshop);
  const pendingLayerIds = [targetLayerId];
  let result;
  let error = null;
  try {
    result = await deleteHelper(targetDocumentId, pendingLayerIds, 'SKU 删除回归');
  } catch (caughtError) {
    error = caughtError;
  }
  return {
    calls,
    error,
    result,
    pendingLayerIds,
    targetLayerStillExists: Boolean(findAuditLayerById(targetDocument.layers, targetLayerId)),
    decoyLayerStillExists: Boolean(findAuditLayerById(decoyDocument.layers, targetLayerId)),
    targetDocumentId,
    decoyDocumentId,
    targetLayerId
  };
}

async function exerciseSkuMutationHelper(filePath, operation, mode) {
  const targetLayerId = 902;
  const targetDocumentId = 7201;
  const decoyDocumentId = 7202;
  const targetCounters = { scale: 0, resize: 0, translate: 0 };
  const decoyCounters = { scale: 0, resize: 0, translate: 0 };
  const calls = [];
  let selectedTarget = null;

  const targetLayer = {
    id: targetLayerId,
    name: '目标文档颜色卡',
    translate: async () => {
      targetCounters.translate += 1;
    },
    resize: async () => {
      targetCounters.resize += 1;
    }
  };
  if (mode !== 'fallback_transform' && mode !== 'transform_error') {
    targetLayer.scale = async () => {
      targetCounters.scale += 1;
    };
  }
  const decoyLayer = {
    id: targetLayerId,
    name: '重复 layerId 干扰层',
    scale: async () => {
      decoyCounters.scale += 1;
    },
    resize: async () => {
      decoyCounters.resize += 1;
    },
    translate: async () => {
      decoyCounters.translate += 1;
    }
  };
  const targetDocument = {
    id: targetDocumentId,
    name: 'sku-mutation-target-audit.psb',
    layers: [targetLayer]
  };
  const decoyDocument = {
    id: decoyDocumentId,
    name: 'sku-mutation-decoy-audit.psb',
    layers: [decoyLayer]
  };
  const photoshop = {
    app: {
      documents: [decoyDocument, targetDocument],
      activeDocument: decoyDocument
    },
    core: {
      executeAsModal: async (callback) => await callback()
    },
    action: {
      batchPlay: async (commands) => {
        const command = commands?.[0] || {};
        calls.push(command);
        const documentId = readAuditDescriptorTargetId(command, 'document');
        const layerId = readAuditDescriptorTargetId(command, 'layer');

        if (command?._obj === 'get') {
          return documentId === targetDocumentId && layerId === targetLayerId
            ? [{ _obj: 'layer', layerID: targetLayerId }]
            : [{ _obj: 'error', result: -25922, message: 'Mutation target not found.' }];
        }
        if (command?._obj === 'select') {
          selectedTarget = { documentId, layerId };
          if (mode === 'select_error') {
            return [{ _obj: 'error', result: -25922, message: 'Select failed in audit fixture.' }];
          }
          return [{}];
        }
        if (command?._obj === 'transform') {
          if (mode === 'transform_error') {
            return [{ _obj: 'error', result: -25922, message: 'Transform failed in audit fixture.' }];
          }
          return [{}];
        }
        return [{}];
      }
    }
  };
  const helpers = loadInstrumentedSkuMutationHelpers(filePath, photoshop);
  let error = null;
  try {
    if (operation === 'resize') {
      await helpers.resize(targetDocumentId, targetLayerId, 80);
    } else {
      await helpers.translate(targetDocumentId, targetLayerId, 12, -8);
    }
  } catch (caughtError) {
    error = caughtError;
  }
  return {
    calls,
    error,
    selectedTarget,
    targetCounters,
    decoyCounters,
    targetDocumentId,
    decoyDocumentId,
    targetLayerId,
    activeDocumentId: Number(photoshop.app.activeDocument?.id)
  };
}

async function exerciseSkuAutoLayoutApplication(filePath, plan, mode) {
  const targetLayerId = Number(plan?.placements?.[0]?.layerId);
  const targetDocumentId = 7301;
  const decoyDocumentId = 7302;
  const initialBounds = { left: 0, top: 0, right: 100, bottom: 200 };
  const liveBounds = { ...initialBounds };
  const counters = { scale: 0, resize: 0, translate: 0 };
  const decoyCounters = { scale: 0, resize: 0, translate: 0 };
  const calls = [];

  function scaleLiveBounds(scaleX, scaleY) {
    const factorX = Number(scaleX) / 100;
    const factorY = Number(scaleY) / 100;
    const centerX = (liveBounds.left + liveBounds.right) / 2;
    const centerY = (liveBounds.top + liveBounds.bottom) / 2;
    const width = (liveBounds.right - liveBounds.left) * factorX;
    const height = (liveBounds.bottom - liveBounds.top) * factorY;
    liveBounds.left = centerX - width / 2;
    liveBounds.right = centerX + width / 2;
    liveBounds.top = centerY - height / 2;
    liveBounds.bottom = centerY + height / 2;
  }

  const targetLayer = {
    id: targetLayerId,
    name: '待排版颜色卡',
    scale: async (scaleX, scaleY) => {
      counters.scale += 1;
      if (mode !== 'scale_silent_noop') scaleLiveBounds(scaleX, scaleY);
    },
    resize: async () => {
      counters.resize += 1;
    },
    translate: async (offsetX, offsetY) => {
      counters.translate += 1;
      if (mode === 'translate_silent_noop') return;
      liveBounds.left += Number(offsetX);
      liveBounds.right += Number(offsetX);
      liveBounds.top += Number(offsetY);
      liveBounds.bottom += Number(offsetY);
    }
  };
  const decoyLayer = {
    id: targetLayerId,
    name: '同 ID 干扰层',
    scale: async () => {
      decoyCounters.scale += 1;
    },
    resize: async () => {
      decoyCounters.resize += 1;
    },
    translate: async () => {
      decoyCounters.translate += 1;
    }
  };
  const targetDocument = {
    id: targetDocumentId,
    name: 'sku-apply-target-audit.psb',
    layers: [targetLayer]
  };
  const decoyDocument = {
    id: decoyDocumentId,
    name: 'sku-apply-decoy-audit.psb',
    layers: [decoyLayer]
  };
  const photoshop = {
    app: {
      documents: [decoyDocument, targetDocument],
      activeDocument: decoyDocument
    },
    core: {
      executeAsModal: async (callback) => await callback()
    },
    action: {
      batchPlay: async (commands) => {
        const command = commands?.[0] || {};
        calls.push(command);
        const documentId = readAuditDescriptorTargetId(command, 'document');
        const layerId = readAuditDescriptorTargetId(command, 'layer');
        if (command?._obj === 'get') {
          if (documentId !== targetDocumentId || layerId !== targetLayerId) {
            return [{ _obj: 'error', result: -25922, message: 'Apply target not found.' }];
          }
          return [{
            _obj: 'layer',
            layerID: targetLayerId,
            bounds: { ...liveBounds },
            boundsNoEffects: { ...liveBounds }
          }];
        }
        if (command?._obj === 'select') return [{}];
        if (command?._obj === 'transform') {
          return [{ _obj: 'error', result: -25922, message: 'Unexpected transform fallback.' }];
        }
        return [{}];
      }
    }
  };
  const helpers = loadInstrumentedSkuMutationHelpers(filePath, photoshop);
  let result;
  let error = null;
  try {
    result = await helpers.apply(targetDocument, plan, {
      expectedItemCount: 1,
      expectedTopLevelLayerIds: [targetLayerId]
    });
  } catch (caughtError) {
    error = caughtError;
  }
  return {
    calls,
    counters,
    decoyCounters,
    error,
    result,
    liveBounds: { ...liveBounds },
    targetDocumentId,
    decoyDocumentId,
    targetLayerId
  };
}

function findAuditLayerById(layers, layerId) {
  if (!Array.isArray(layers)) return null;
  for (const layer of layers) {
    if (Number(layer?.id) === Number(layerId)) return layer;
    const nested = findAuditLayerById(layer?.layers, layerId);
    if (nested) return nested;
  }
  return null;
}

function skuDeleteAuditOutcomeFailed(auditRun) {
  if (auditRun?.error) return true;
  const result = auditRun?.result;
  if (result === false) return true;
  if (Array.isArray(result)) return result.length > 0;
  if (!result || typeof result !== 'object') return false;
  if (result.success === false || result.ok === false) return true;
  if (Array.isArray(result.failedLayerIds) && result.failedLayerIds.length > 0) return true;
  return Array.isArray(result.warnings) && result.warnings.length > 0;
}

function loadStandaloneAuditFunction(functionText, functionName, filePath) {
  if (!functionText || !functionName) return null;
  const Module = require('module');
  const transpiled = ts.transpileModule(`export ${functionText}\n`, {
    fileName: filePath,
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      esModuleInterop: true,
      skipLibCheck: true
    }
  });
  const auditModule = new Module(`${filePath}#${functionName}`, module);
  auditModule.filename = filePath;
  auditModule.paths = Module._nodeModulePaths(path.dirname(filePath));
  auditModule._compile(transpiled.outputText, filePath);
  const loadedFunction = auditModule.exports[functionName];
  return typeof loadedFunction === 'function' ? loadedFunction : null;
}

function loadStandaloneAuditFunctions(functionTexts, functionNames, filePath) {
  const Module = require('module');
  const sourceText = functionTexts.filter(Boolean).join('\n\n');
  const exportsText = `export { ${functionNames.join(', ')} };`;
  const transpiled = ts.transpileModule(`${sourceText}\n${exportsText}\n`, {
    fileName: filePath,
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      esModuleInterop: true,
      skipLibCheck: true
    }
  });
  const auditModule = new Module(`${filePath}#standalone-functions-audit`, module);
  auditModule.filename = filePath;
  auditModule.paths = Module._nodeModulePaths(path.dirname(filePath));
  auditModule._compile(transpiled.outputText, filePath);
  return Object.fromEntries(functionNames.map((functionName) => [
    functionName,
    typeof auditModule.exports[functionName] === 'function'
      ? auditModule.exports[functionName]
      : null
  ]));
}

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 220);
}

function cssRuleBody(source, selector) {
  const marker = `${selector} {`;
  const start = source.indexOf(marker);
  if (start < 0) return '';
  const bodyStart = start + marker.length;
  const end = source.indexOf('}', bodyStart);
  return end < 0 ? '' : source.slice(bodyStart, end);
}

function literalText(node, sourceFile) {
  return collectNodes(node, (current) => (
    ts.isStringLiteralLike(current)
    || current.kind === ts.SyntaxKind.RegularExpressionLiteral
  )).map((current) => current.getText(sourceFile));
}

function propertyName(node) {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
  return '';
}

function authorizationMintingViolations(sourceFile) {
  const violations = [];
  collectNodes(sourceFile, (node) => (
    ts.isBinaryExpression(node)
    && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    && node.right.kind === ts.SyntaxKind.TrueKeyword
  )).forEach((node) => {
    const name = propertyName(node.left);
    if (sensitiveAuthorizationFields.has(name)) {
      violations.push(`${name}: ${compact(node.getText(sourceFile))}`);
    }
  });
  collectNodes(sourceFile, (node) => (
    ts.isPropertyAssignment(node)
    && node.initializer.kind === ts.SyntaxKind.TrueKeyword
  )).forEach((node) => {
    const name = propertyName(node.name);
    if (sensitiveAuthorizationFields.has(name)) {
      violations.push(`${name}: ${compact(node.getText(sourceFile))}`);
    }
  });
  return [...new Set(violations)];
}

function countBusinessReferences(filePath) {
  if (!fs.existsSync(filePath)) return 0;
  return (read(filePath).match(new RegExp(protectedBusinessPattern.source, 'gi')) || []).length;
}

async function exerciseStagedFilePromotion() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'designecho-staged-promotion-'));
  const destinationRoot = path.join(tempRoot, '客户交付', '色卡成品');
  const containmentProjectRoot = path.join(tempRoot, 'contained-project');
  const escapedDestinationRoot = path.join(tempRoot, 'outside-project', 'SKU');
  fs.mkdirSync(containmentProjectRoot, { recursive: true });
  const escapedTransactionIssue = await issueSkuStagingTransaction(
    escapedDestinationRoot,
    containmentProjectRoot
  );
  const projectContainmentRejected = escapedTransactionIssue.success === false
    && !fs.existsSync(escapedDestinationRoot);
  const readBaseline = (filePath) => {
    if (!fs.existsSync(filePath)) return { exists: false };
    const stat = fs.statSync(filePath);
    return {
      exists: true,
      modifiedTimeMs: Math.round(stat.mtimeMs),
      byteLength: stat.size
    };
  };
  const buildItem = (sourcePath, destinationPath, baseline = readBaseline(destinationPath)) => ({
    sourcePath,
    destinationPath,
    expectedDestinationBaseline: baseline
  });
  const issueTransaction = async () => {
    const issued = await issueSkuStagingTransaction(destinationRoot, tempRoot);
    if (issued.success !== true
      || !issued.transactionToken
      || !issued.transactionId
      || !issued.stagingRoot
      || !issued.stagingParent
      || !issued.outputDir) {
      throw new Error(`SKU staging issue failed in audit: ${JSON.stringify(issued)}`);
    }
    return {
      transactionToken: issued.transactionToken,
      transactionId: issued.transactionId,
      stagingRoot: issued.stagingRoot,
      stagingParent: issued.stagingParent,
      outputDir: issued.outputDir
    };
  };
  const bindMainBaselines = async (transactionToken, items) => {
    const captured = await captureSkuStagingDestinationBaselines({
      transactionToken,
      destinationPaths: items.map((item) => item.destinationPath)
    });
    if (captured.success !== true || captured.baselines?.length !== items.length) {
      throw new Error(`SKU baseline capture failed in audit: ${JSON.stringify(captured)}`);
    }
    return items.map((item, index) => ({
      ...item,
      expectedDestinationBaseline: {
        exists: captured.baselines[index].exists,
        ...(captured.baselines[index].exists ? {
          modifiedTimeMs: captured.baselines[index].modifiedTimeMs,
          byteLength: captured.baselines[index].byteLength,
          sha256: captured.baselines[index].sha256
        } : {})
      }
    }));
  };
  const cleanupTransaction = async (transactionToken) => {
    const rootCleanup = await removeSkuStagingTransactionRoot(transactionToken);
    if (rootCleanup.success !== true) return rootCleanup;
    return removeSkuStagingParentIfEmpty(transactionToken);
  };
  const sha256Text = (value) => crypto.createHash('sha256').update(value).digest('hex');
  const createCommittedCrashFixture = (name, tamperDestination = false) => {
    const crashDestinationRoot = path.join(tempRoot, name, 'SKU');
    const stagingParent = path.join(crashDestinationRoot, '.designecho-staging');
    const transactionId = crypto.randomUUID();
    const stagingRoot = path.join(stagingParent, transactionId);
    const rollbackRoot = path.join(stagingRoot, `.rollback-${transactionId}`);
    const sourcePath = path.join(stagingRoot, 'JPG', '01.jpg');
    const destinationPath = path.join(crashDestinationRoot, 'JPG', '01.jpg');
    const backupPath = path.join(rollbackRoot, '000.bak');
    const sourceContent = 'committed-new-content';
    const baselineContent = 'committed-old-content';
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.mkdirSync(rollbackRoot, { recursive: true });
    fs.writeFileSync(
      destinationPath,
      tamperDestination ? 'tampered-new-content' : sourceContent,
      'utf8'
    );
    fs.writeFileSync(backupPath, baselineContent, 'utf8');
    const now = new Date().toISOString();
    fs.writeFileSync(path.join(stagingRoot, '.designecho-transaction-owner.json'), `${JSON.stringify({
      version: 'sku-staging-owner/v1',
      transactionId,
      createdAt: now,
      updatedAt: now,
      phase: 'promoting',
      stagingRoot,
      stagingParent,
      destinationRoot: crashDestinationRoot
    }, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(rollbackRoot, 'transaction-manifest.json'), `${JSON.stringify({
      version: 'staged-file-transaction-manifest/v1',
      transactionId,
      createdAt: now,
      stagingRoot,
      destinationRoot: crashDestinationRoot,
      items: [{
        index: 0,
        sourcePath,
        destinationPath,
        backupPath,
        sourceByteLength: Buffer.byteLength(sourceContent),
        sourceSha256: sha256Text(sourceContent),
        expectedDestinationBaseline: {
          exists: true,
          byteLength: Buffer.byteLength(baselineContent),
          sha256: sha256Text(baselineContent)
        }
      }]
    }, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(rollbackRoot, 'transaction-journal.jsonl'), [
      JSON.stringify({ phase: 'prepared', transactionId, itemCount: 1, at: now }),
      JSON.stringify({ phase: 'committed', transactionId, itemCount: 1, at: now })
    ].join('\n') + '\n', 'utf8');
    return {
      destinationRoot: crashDestinationRoot,
      stagingRoot,
      destinationPath
    };
  };
  const makePairedFiles = (stagingRoot, count, prefix) => {
    const items = [];
    for (let index = 0; index < count; index += 1) {
      const kind = index % 2 === 0 ? 'JPG' : 'PSB';
      const extension = kind === 'JPG' ? '.jpg' : '.psb';
      const relative = path.join(kind, `${String(index).padStart(3, '0')}${extension}`);
      const sourcePath = path.join(stagingRoot, relative);
      const destinationPath = path.join(destinationRoot, relative);
      fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
      fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
      fs.writeFileSync(destinationPath, `old-${prefix}-${index}`, 'utf8');
      fs.writeFileSync(sourcePath, `new-${prefix}-${index}`, 'utf8');
      items.push(buildItem(sourcePath, destinationPath));
    }
    return items;
  };
  try {
    const atomicTransaction = await issueTransaction();
    const stagingRoot = atomicTransaction.stagingRoot;
    const atomicItems = await bindMainBaselines(
      atomicTransaction.transactionToken,
      makePairedFiles(stagingRoot, 38, 'atomic')
    );
    const committed = await promoteStagedFileSet({
      transactionToken: atomicTransaction.transactionToken,
      items: atomicItems
    });
    const atomicCommitVerified = committed.success === true
      && committed.committedPaths.length === 38
      && committed.committedFiles.length === 38
      && committed.replacedPaths.length === 38
      && atomicItems.every((item, index) => (
        fs.readFileSync(item.destinationPath, 'utf8') === `new-atomic-${index}`
        && committed.committedFiles[index]?.path === item.destinationPath
        && committed.committedFiles[index]?.byteLength === Buffer.byteLength(`new-atomic-${index}`)
        && committed.committedFiles[index]?.sha256 === sha256Text(`new-atomic-${index}`)
        && !fs.existsSync(item.sourcePath)
      ));
    const atomicCleanup = await cleanupTransaction(atomicTransaction.transactionToken);
    const subsetTransaction = await issueTransaction();
    const subsetItems = await bindMainBaselines(
      subsetTransaction.transactionToken,
      makePairedFiles(subsetTransaction.stagingRoot, 2, 'subset')
    );
    const subsetPromotion = await promoteStagedFileSet({
      transactionToken: subsetTransaction.transactionToken,
      items: subsetItems.slice(0, 1)
    });
    const subsetRejectedBeforeWrite = subsetPromotion.success === false
      && subsetItems.every((item, index) => (
        fs.existsSync(item.sourcePath)
        && fs.readFileSync(item.destinationPath, 'utf8') === `old-subset-${index}`
      ));
    const subsetCleanup = await cleanupTransaction(subsetTransaction.transactionToken);
    const escapedTransaction = await issueTransaction();
    const escapedSource = path.join(escapedTransaction.stagingRoot, 'escape.jpg');
    fs.mkdirSync(path.dirname(escapedSource), { recursive: true });
    fs.writeFileSync(escapedSource, 'escape', 'utf8');
    const escaped = await promoteStagedFileSet({
      transactionToken: escapedTransaction.transactionToken,
      items: [buildItem(escapedSource, path.join(tempRoot, 'outside.jpg'), { exists: false })]
    });
    const escapedSourcePreserved = fs.existsSync(escapedSource);
    const escapedCleanup = await cleanupTransaction(escapedTransaction.transactionToken);
    const relativeItemTransaction = await issueTransaction();
    const relativeItemSource = path.join(relativeItemTransaction.stagingRoot, 'relative-item.jpg');
    fs.writeFileSync(relativeItemSource, 'relative-item', 'utf8');
    const relativeItemDestination = path.join(destinationRoot, 'relative-item.jpg');
    const relativeItem = await promoteStagedFileSet({
      transactionToken: relativeItemTransaction.transactionToken,
      items: [{
        sourcePath: path.relative(process.cwd(), relativeItemSource),
        destinationPath: relativeItemDestination,
        expectedDestinationBaseline: { exists: false }
      }]
    });
    const relativeItemSourcePreserved = fs.existsSync(relativeItemSource);
    const relativeItemCleanup = await cleanupTransaction(relativeItemTransaction.transactionToken);
    const invalidTokenTransaction = await issueTransaction();
    const relativeRootSource = path.join(invalidTokenTransaction.stagingRoot, 'relative-root.jpg');
    fs.writeFileSync(relativeRootSource, 'relative-root', 'utf8');
    const relativeRootDestination = path.join(destinationRoot, 'relative-root.jpg');
    const relativeRoot = await promoteStagedFileSet({
      transactionToken: 'relative-token-is-not-authority',
      items: [buildItem(relativeRootSource, relativeRootDestination, { exists: false })]
    });
    const invalidTokenSourcePreserved = fs.existsSync(relativeRootSource);
    const invalidTokenCleanup = await cleanupTransaction(invalidTokenTransaction.transactionToken);

    const driftTransaction = await issueTransaction();
    const driftStagingRoot = driftTransaction.stagingRoot;
    const driftSource = path.join(driftStagingRoot, 'JPG', 'drift.jpg');
    const driftDestination = path.join(destinationRoot, 'JPG', 'drift.jpg');
    fs.mkdirSync(path.dirname(driftSource), { recursive: true });
    fs.mkdirSync(path.dirname(driftDestination), { recursive: true });
    fs.writeFileSync(driftSource, 'new-drift', 'utf8');
    fs.writeFileSync(driftDestination, 'old-drift', 'utf8');
    const [driftItem] = await bindMainBaselines(
      driftTransaction.transactionToken,
      [buildItem(driftSource, driftDestination)]
    );
    fs.writeFileSync(driftDestination, 'concurrent-user-change', 'utf8');
    const driftTime = new Date(Date.now() + 5000);
    fs.utimesSync(driftDestination, driftTime, driftTime);
    const drifted = await promoteStagedFileSet({
      transactionToken: driftTransaction.transactionToken,
      items: [driftItem]
    });
    const driftSourcePreserved = fs.existsSync(driftSource);
    const driftCleanup = await cleanupTransaction(driftTransaction.transactionToken);
    const appearedTransaction = await issueTransaction();
    const appearedStagingRoot = appearedTransaction.stagingRoot;
    const appearedSource = path.join(appearedStagingRoot, 'JPG', 'appeared.jpg');
    const appearedDestination = path.join(destinationRoot, 'JPG', 'appeared.jpg');
    fs.mkdirSync(path.dirname(appearedSource), { recursive: true });
    fs.writeFileSync(appearedSource, 'new-appeared', 'utf8');
    const [appearedItem] = await bindMainBaselines(
      appearedTransaction.transactionToken,
      [buildItem(appearedSource, appearedDestination, { exists: false })]
    );
    fs.writeFileSync(appearedDestination, 'external-created', 'utf8');
    const appeared = await promoteStagedFileSet({
      transactionToken: appearedTransaction.transactionToken,
      items: [appearedItem]
    });
    const appearedSourcePreserved = fs.existsSync(appearedSource);
    const appearedCleanup = await cleanupTransaction(appearedTransaction.transactionToken);

    const forgedBaselineTransaction = await issueTransaction();
    const forgedBaselineSource = path.join(forgedBaselineTransaction.stagingRoot, 'JPG', 'forged.jpg');
    const forgedBaselineDestination = path.join(destinationRoot, 'Forged', 'forged.jpg');
    fs.mkdirSync(path.dirname(forgedBaselineSource), { recursive: true });
    fs.mkdirSync(path.dirname(forgedBaselineDestination), { recursive: true });
    fs.writeFileSync(forgedBaselineSource, 'forged-new-output', 'utf8');
    fs.writeFileSync(forgedBaselineDestination, 'baseline-before-capture', 'utf8');
    const [mainFrozenItem] = await bindMainBaselines(
      forgedBaselineTransaction.transactionToken,
      [buildItem(forgedBaselineSource, forgedBaselineDestination)]
    );
    fs.writeFileSync(forgedBaselineDestination, 'concurrent-after-capture', 'utf8');
    const forgedStat = fs.statSync(forgedBaselineDestination);
    const rendererForgedItem = {
      ...mainFrozenItem,
      expectedDestinationBaseline: {
        exists: true,
        modifiedTimeMs: Math.trunc(forgedStat.mtimeMs),
        byteLength: forgedStat.size,
        sha256: sha256Text('concurrent-after-capture')
      }
    };
    const forgedBaselinePromotion = await promoteStagedFileSet({
      transactionToken: forgedBaselineTransaction.transactionToken,
      items: [rendererForgedItem]
    });
    const mainFrozenBaselineAuthoritative = forgedBaselinePromotion.success === false
      && fs.readFileSync(forgedBaselineDestination, 'utf8') === 'concurrent-after-capture'
      && fs.readFileSync(forgedBaselineSource, 'utf8') === 'forged-new-output';
    const forgedBaselineCleanup = await cleanupTransaction(
      forgedBaselineTransaction.transactionToken
    );

    const concurrentTransaction = await issueTransaction();
    const concurrentSource = path.join(concurrentTransaction.stagingRoot, 'JPG', 'concurrent.jpg');
    const concurrentDestination = path.join(destinationRoot, 'Concurrent', 'concurrent.jpg');
    fs.mkdirSync(path.dirname(concurrentSource), { recursive: true });
    fs.writeFileSync(concurrentSource, 'concurrent-new', 'utf8');
    const [concurrentItem] = await bindMainBaselines(
      concurrentTransaction.transactionToken,
      [buildItem(concurrentSource, concurrentDestination, { exists: false })]
    );
    const concurrentResults = await Promise.all([
      promoteStagedFileSet({
        transactionToken: concurrentTransaction.transactionToken,
        items: [concurrentItem]
      }),
      promoteStagedFileSet({
        transactionToken: concurrentTransaction.transactionToken,
        items: [concurrentItem]
      })
    ]);
    const concurrentPromotionSingleOwner = concurrentResults.filter((result) => result.success).length === 1
      && concurrentResults.filter((result) => !result.success).length === 1
      && fs.readFileSync(concurrentDestination, 'utf8') === 'concurrent-new'
      && !fs.existsSync(concurrentSource);
    const concurrentCleanup = await cleanupTransaction(concurrentTransaction.transactionToken);

    const fullRollbackTransaction = await issueTransaction();
    const fullRollbackRoot = fullRollbackTransaction.stagingRoot;
    const fullRollbackItems = await bindMainBaselines(
      fullRollbackTransaction.transactionToken,
      makePairedFiles(fullRollbackRoot, 38, 'rollback')
    );
    const originalLink = fs.promises.link;
    const injectedInstallSource = fullRollbackItems[16].sourcePath;
    const injectedInstallDestination = fullRollbackItems[16].destinationPath;
    let installFailureInjected = false;
    fs.promises.link = async (sourcePath, destinationPath) => {
      if (!installFailureInjected
        && String(sourcePath) === injectedInstallSource
        && String(destinationPath) === injectedInstallDestination) {
        installFailureInjected = true;
        const injected = new Error('injected item 17 install failure');
        injected.code = 'EACCES';
        throw injected;
      }
      return originalLink.call(fs.promises, sourcePath, destinationPath);
    };
    let fullRollback;
    try {
      fullRollback = await promoteStagedFileSet({
        transactionToken: fullRollbackTransaction.transactionToken,
        items: fullRollbackItems
      });
    } finally {
      fs.promises.link = originalLink;
    }
    const fullRollbackRestored = fullRollback.success === false
      && fullRollback.rollbackComplete === true
      && fullRollbackItems.every((item, index) => (
        fs.readFileSync(item.destinationPath, 'utf8') === `old-rollback-${index}`
        && fs.readFileSync(item.sourcePath, 'utf8') === `new-rollback-${index}`
      ));
    const fullRollbackCleanup = await cleanupTransaction(fullRollbackTransaction.transactionToken);

    const committedCrashFixture = createCommittedCrashFixture('crash-committed-valid');
    const committedCrashIssue = await issueSkuStagingTransaction(
      committedCrashFixture.destinationRoot
    );
    const committedCrashReconciled = committedCrashIssue.success === true
      && Boolean(committedCrashIssue.transactionToken)
      && !fs.existsSync(committedCrashFixture.stagingRoot)
      && fs.readFileSync(committedCrashFixture.destinationPath, 'utf8') === 'committed-new-content';
    const committedCrashCleanup = committedCrashIssue.transactionToken
      ? await cleanupTransaction(committedCrashIssue.transactionToken)
      : { success: false };
    const tamperedCrashFixture = createCommittedCrashFixture('crash-committed-tampered', true);
    const tamperedCrashIssue = await issueSkuStagingTransaction(
      tamperedCrashFixture.destinationRoot
    );
    const freshProcessReconciliationFailClosed = committedCrashReconciled
      && committedCrashCleanup.success === true
      && tamperedCrashIssue.success === false
      && tamperedCrashIssue.code === 'staging_recovery_required'
      && path.resolve(String(tamperedCrashIssue.recoveryPath || ''))
        === path.resolve(tamperedCrashFixture.stagingRoot)
      && fs.existsSync(tamperedCrashFixture.stagingRoot)
      && fs.readFileSync(tamperedCrashFixture.destinationPath, 'utf8') === 'tampered-new-content';

    const backupRaceDestinationRoot = path.join(tempRoot, 'backup-race', 'SKU');
    fs.mkdirSync(backupRaceDestinationRoot, { recursive: true });
    const backupRaceIssued = await issueSkuStagingTransaction(backupRaceDestinationRoot);
    if (!backupRaceIssued.success
      || !backupRaceIssued.transactionToken
      || !backupRaceIssued.stagingRoot) {
      throw new Error(`backup race transaction issue failed: ${JSON.stringify(backupRaceIssued)}`);
    }
    const backupRaceSource = path.join(backupRaceIssued.stagingRoot, 'JPG', 'race.jpg');
    const backupRaceDestination = path.join(backupRaceDestinationRoot, 'JPG', 'race.jpg');
    fs.mkdirSync(path.dirname(backupRaceSource), { recursive: true });
    fs.mkdirSync(path.dirname(backupRaceDestination), { recursive: true });
    fs.writeFileSync(backupRaceSource, 'race-new-output', 'utf8');
    fs.writeFileSync(backupRaceDestination, 'race-baseline-old', 'utf8');
    const backupRaceCaptured = await captureSkuStagingDestinationBaselines({
      transactionToken: backupRaceIssued.transactionToken,
      destinationPaths: [backupRaceDestination]
    });
    if (backupRaceCaptured.success !== true || backupRaceCaptured.baselines?.length !== 1) {
      throw new Error(`backup race baseline capture failed: ${JSON.stringify(backupRaceCaptured)}`);
    }
    const backupRaceItem = {
      sourcePath: backupRaceSource,
      destinationPath: backupRaceDestination,
      expectedDestinationBaseline: {
        exists: true,
        modifiedTimeMs: backupRaceCaptured.baselines[0].modifiedTimeMs,
        byteLength: backupRaceCaptured.baselines[0].byteLength,
        sha256: backupRaceCaptured.baselines[0].sha256
      }
    };
    const originalRenameForBackupRace = fs.promises.rename;
    let backupRaceInjected = false;
    fs.promises.rename = async (sourcePath, destinationPath) => {
      if (!backupRaceInjected
        && String(sourcePath) === backupRaceDestination
        && String(destinationPath).includes('.rollback-')) {
        backupRaceInjected = true;
        fs.writeFileSync(backupRaceDestination, 'race-concurrent-user-file', 'utf8');
      }
      return originalRenameForBackupRace.call(fs.promises, sourcePath, destinationPath);
    };
    let backupRacePromotion;
    try {
      backupRacePromotion = await promoteStagedFileSet({
        transactionToken: backupRaceIssued.transactionToken,
        items: [backupRaceItem]
      });
    } finally {
      fs.promises.rename = originalRenameForBackupRace;
    }
    const backupMoveRacePreservesExternalFile = backupRaceInjected
      && backupRacePromotion.success === false
      && backupRacePromotion.rollbackComplete === false
      && Boolean(backupRacePromotion.recoveryPath)
      && fs.readFileSync(backupRaceDestination, 'utf8') === 'race-concurrent-user-file'
      && fs.readFileSync(backupRaceSource, 'utf8') === 'race-new-output'
      && fs.existsSync(String(backupRacePromotion.recoveryPath));

    const restoreRaceDestinationRoot = path.join(tempRoot, 'restore-race', 'SKU');
    fs.mkdirSync(restoreRaceDestinationRoot, { recursive: true });
    const restoreRaceIssued = await issueSkuStagingTransaction(restoreRaceDestinationRoot);
    if (!restoreRaceIssued.success
      || !restoreRaceIssued.transactionToken
      || !restoreRaceIssued.stagingRoot) {
      throw new Error(`restore race transaction issue failed: ${JSON.stringify(restoreRaceIssued)}`);
    }
    const restoreRaceSource = path.join(restoreRaceIssued.stagingRoot, 'JPG', 'restore-race.jpg');
    const restoreRaceDestination = path.join(restoreRaceDestinationRoot, 'JPG', 'restore-race.jpg');
    fs.mkdirSync(path.dirname(restoreRaceSource), { recursive: true });
    fs.mkdirSync(path.dirname(restoreRaceDestination), { recursive: true });
    fs.writeFileSync(restoreRaceSource, 'restore-race-new-output', 'utf8');
    fs.writeFileSync(restoreRaceDestination, 'restore-race-baseline', 'utf8');
    const restoreRaceCaptured = await captureSkuStagingDestinationBaselines({
      transactionToken: restoreRaceIssued.transactionToken,
      destinationPaths: [restoreRaceDestination]
    });
    if (restoreRaceCaptured.success !== true || restoreRaceCaptured.baselines?.length !== 1) {
      throw new Error(`restore race baseline capture failed: ${JSON.stringify(restoreRaceCaptured)}`);
    }
    const restoreRaceItem = {
      sourcePath: restoreRaceSource,
      destinationPath: restoreRaceDestination,
      expectedDestinationBaseline: {
        exists: true,
        modifiedTimeMs: restoreRaceCaptured.baselines[0].modifiedTimeMs,
        byteLength: restoreRaceCaptured.baselines[0].byteLength,
        sha256: restoreRaceCaptured.baselines[0].sha256
      }
    };
    let restoreInstallFailed = false;
    let restoreLinkRaceInjected = false;
    fs.promises.link = async (sourcePath, destinationPath) => {
      if (!restoreInstallFailed
        && String(sourcePath) === restoreRaceSource
        && String(destinationPath) === restoreRaceDestination) {
        restoreInstallFailed = true;
        const injected = new Error('injected install failure before baseline restore');
        injected.code = 'EACCES';
        throw injected;
      }
      if (!restoreLinkRaceInjected
        && String(sourcePath).includes('.rollback-')
        && String(sourcePath).endsWith('000.bak')
        && String(destinationPath) === restoreRaceDestination) {
        restoreLinkRaceInjected = true;
        fs.writeFileSync(restoreRaceDestination, 'restore-race-external-target', 'utf8');
      }
      return originalLink.call(fs.promises, sourcePath, destinationPath);
    };
    let restoreRacePromotion;
    try {
      restoreRacePromotion = await promoteStagedFileSet({
        transactionToken: restoreRaceIssued.transactionToken,
        items: [restoreRaceItem]
      });
    } finally {
      fs.promises.link = originalLink;
    }
    const restoreRaceBackupPath = restoreRacePromotion?.recoveryPath
      ? path.join(restoreRacePromotion.recoveryPath, '000.bak')
      : '';
    const rollbackRestoreNoReplace = restoreInstallFailed
      && restoreLinkRaceInjected
      && restoreRacePromotion.success === false
      && restoreRacePromotion.rollbackComplete === false
      && Boolean(restoreRacePromotion.recoveryPath)
      && fs.readFileSync(restoreRaceDestination, 'utf8') === 'restore-race-external-target'
      && fs.readFileSync(restoreRaceSource, 'utf8') === 'restore-race-new-output'
      && fs.existsSync(restoreRaceBackupPath)
      && fs.readFileSync(restoreRaceBackupPath, 'utf8') === 'restore-race-baseline';

    const rollbackTransaction = await issueTransaction();
    const rollbackStagingRoot = rollbackTransaction.stagingRoot;
    const rollbackSource = path.join(rollbackStagingRoot, '4双', '自选备注.jpg');
    const rollbackDestination = path.join(destinationRoot, '4双', '自选备注.jpg');
    fs.mkdirSync(path.dirname(rollbackSource), { recursive: true });
    fs.mkdirSync(path.dirname(rollbackDestination), { recursive: true });
    fs.writeFileSync(rollbackSource, 'new-four-note', 'utf8');
    fs.writeFileSync(rollbackDestination, 'old-four-note', 'utf8');
    const [rollbackItem] = await bindMainBaselines(
      rollbackTransaction.transactionToken,
      [buildItem(rollbackSource, rollbackDestination)]
    );
    const rollbackBaseline = rollbackItem.expectedDestinationBaseline;
    fs.promises.link = async (sourcePath, destinationPath) => {
      if (String(sourcePath) === rollbackSource && String(destinationPath) === rollbackDestination) {
        fs.writeFileSync(rollbackDestination, 'concurrent-user-file', 'utf8');
      }
      return originalLink.call(fs.promises, sourcePath, destinationPath);
    };
    let failedRollback;
    try {
      failedRollback = await promoteStagedFileSet({
        transactionToken: rollbackTransaction.transactionToken,
        items: [rollbackItem]
      });
    } finally {
      fs.promises.link = originalLink;
    }
    const preservedBackupPath = failedRollback?.recoveryPath
      ? path.join(failedRollback.recoveryPath, '000.bak')
      : '';
    const recoveryManifestPath = failedRollback?.recoveryPath
      ? path.join(failedRollback.recoveryPath, 'transaction-manifest.json')
      : '';
    const recoveryManifest = recoveryManifestPath && fs.existsSync(recoveryManifestPath)
      ? JSON.parse(fs.readFileSync(recoveryManifestPath, 'utf8'))
      : null;

    const expectedItem = {
      id: 'note:4:1',
      path: rollbackDestination,
      editablePath: path.join(destinationRoot, '可编辑', '4双', '自选备注.psb')
    };
    const editableSource = path.join(rollbackStagingRoot, '可编辑', '4双', '自选备注.psb');
    fs.mkdirSync(path.dirname(editableSource), { recursive: true });
    fs.writeFileSync(editableSource, 'new-editable', 'utf8');
    const rasterArtifact = {
      tempPath: rollbackSource,
      tempPathKey: normalizeSkuExportPathForCompare(rollbackSource),
      finalPath: rollbackDestination,
      finalPathKey: normalizeSkuExportPathForCompare(rollbackDestination)
    };
    const editableArtifact = {
      stagedPath: editableSource,
      finalPath: expectedItem.editablePath
    };
    const destinationBaselines = new Map([
      [normalizeSkuExportPathForCompare(rollbackDestination), rollbackBaseline],
      [
        normalizeSkuExportPathForCompare(expectedItem.editablePath),
        { path: expectedItem.editablePath, exists: false }
      ]
    ]);
    const guardedDeliveryExecutor = createGuardedAtomicToolExecutor({
      executeTool: async () => ({ success: true })
    });
    const deliveryLedgerScope = beginRuntimeOwnedSkillToolLedgerScope(guardedDeliveryExecutor);
    const deliveryAuthority = createRuntimeOwnedSkillDeliveryPlanAuthority({
      scope: deliveryLedgerScope,
      executor: guardedDeliveryExecutor
    });
    const deliveryPlanFreeze = deliveryAuthority?.freeze({
      projectPath: tempRoot,
      convention: {
        version: 'skill-delivery-convention/v0',
        provenance: 'skill_fallback',
        supportRefs: [],
        editable: {
          projectRelativeRoot: '客户交付/色卡成品/可编辑',
          fileNamePattern: '{defaultName}',
          format: 'psb'
        },
        raster: {
          projectRelativeRoot: '客户交付/色卡成品',
          fileNamePattern: '{defaultName}',
          format: 'jpg'
        },
        pairing: 'one_editable_per_raster',
        versionPolicy: 'fail_if_exists'
      },
      artifacts: [{
        artifactId: `sku:${expectedItem.id}:raster`,
        kind: 'raster_export',
        pairId: expectedItem.id,
        order: 0,
        path: expectedItem.path,
        format: 'jpg',
        sourceHistoryRole: 'per_artifact_revision'
      }, {
        artifactId: `sku:${expectedItem.id}:editable`,
        kind: 'editable_document',
        pairId: expectedItem.id,
        order: 1,
        path: expectedItem.editablePath,
        format: 'psb',
        sourceHistoryRole: 'per_artifact_revision'
      }]
    });
    if (!deliveryPlanFreeze || deliveryPlanFreeze.status === 'rejected') {
      throw new Error(`SKU Runtime delivery plan fixture failed: ${JSON.stringify(deliveryPlanFreeze)}`);
    }
    const runtimeDeliveryPlanBinding = deliveryPlanFreeze.binding;
    const rendererHostCalls = [];
    const rendererHost = {
      promoteStagedFileSet: async () => {
        rendererHostCalls.push('promoteStagedFileSet');
        return {
          success: false,
          committedPaths: [],
          committedFiles: [],
          replacedPaths: [],
          cleanupWarnings: [],
          rollbackComplete: false,
          recoveryPath: path.join(rollbackStagingRoot, '.rollback-renderer'),
          error: 'injected renderer rollback failure'
        };
      },
      removeSkuStagingTransactionRoot: async () => {
        rendererHostCalls.push('removeSkuStagingTransactionRoot');
        return { success: true };
      },
      removeSkuStagingParentIfEmpty: async () => {
        rendererHostCalls.push('removeSkuStagingParentIfEmpty');
        return { success: true };
      }
    };
    const previousAuditWindow = global.window;
    global.window = { designEcho: rendererHost };
    const rendererPromotion = await promoteSkuStagedDeliverySet({
      expectedItems: [expectedItem],
      rasterArtifacts: new Map([[expectedItem.id, rasterArtifact]]),
      editableArtifacts: new Map([[expectedItem.id, editableArtifact]]),
      destinationBaselines,
      transaction: rollbackTransaction,
      runtimeDeliveryPlanBinding
    });
    const rendererCleanup = await finalizeSkuStagingCleanup({
      transaction: rollbackTransaction,
      preserveStagingRoot: rendererPromotion.preserveStagingRoot === true,
      recoveryPath: rendererPromotion.recoveryPath,
      host: rendererHost
    });
    const rejectedHostCalls = [];
    const rejectedHost = {
      promoteStagedFileSet: async () => {
        rejectedHostCalls.push('promoteStagedFileSet');
        throw new Error('injected lost IPC response');
      },
      removeSkuStagingTransactionRoot: async () => {
        rejectedHostCalls.push('removeSkuStagingTransactionRoot');
        return { success: true };
      },
      removeSkuStagingParentIfEmpty: async () => {
        rejectedHostCalls.push('removeSkuStagingParentIfEmpty');
        return { success: true };
      }
    };
    global.window = { designEcho: rejectedHost };
    const rejectedPromotion = await promoteSkuStagedDeliverySet({
      expectedItems: [expectedItem],
      rasterArtifacts: new Map([[expectedItem.id, rasterArtifact]]),
      editableArtifacts: new Map([[expectedItem.id, editableArtifact]]),
      destinationBaselines,
      transaction: rollbackTransaction,
      runtimeDeliveryPlanBinding
    });
    await finalizeSkuStagingCleanup({
      transaction: rollbackTransaction,
      preserveStagingRoot: rejectedPromotion.preserveStagingRoot === true,
      host: rejectedHost
    });
    const malformedHostCalls = [];
    const malformedHost = {
      promoteStagedFileSet: async () => {
        malformedHostCalls.push('promoteStagedFileSet');
        return undefined;
      },
      removeSkuStagingTransactionRoot: async () => {
        malformedHostCalls.push('removeSkuStagingTransactionRoot');
        return { success: true };
      },
      removeSkuStagingParentIfEmpty: async () => {
        malformedHostCalls.push('removeSkuStagingParentIfEmpty');
        return { success: true };
      }
    };
    global.window = { designEcho: malformedHost };
    const malformedPromotion = await promoteSkuStagedDeliverySet({
      expectedItems: [expectedItem],
      rasterArtifacts: new Map([[expectedItem.id, rasterArtifact]]),
      editableArtifacts: new Map([[expectedItem.id, editableArtifact]]),
      destinationBaselines,
      transaction: rollbackTransaction,
      runtimeDeliveryPlanBinding
    });
    const mismatchedSuccessCalls = [];
    const mismatchedSuccessHost = {
      promoteStagedFileSet: async (input) => {
        mismatchedSuccessCalls.push('promoteStagedFileSet');
        return {
          success: true,
          committedPaths: input.items.map((item) => item.destinationPath),
          committedFiles: [],
          replacedPaths: [],
          cleanupWarnings: [],
          rollbackComplete: true
        };
      },
      removeSkuStagingTransactionRoot: async () => {
        mismatchedSuccessCalls.push('removeSkuStagingTransactionRoot');
        return { success: true };
      },
      removeSkuStagingParentIfEmpty: async () => {
        mismatchedSuccessCalls.push('removeSkuStagingParentIfEmpty');
        return { success: true };
      }
    };
    global.window = { designEcho: mismatchedSuccessHost };
    const mismatchedSuccessPromotion = await promoteSkuStagedDeliverySet({
      expectedItems: [expectedItem],
      rasterArtifacts: new Map([[expectedItem.id, rasterArtifact]]),
      editableArtifacts: new Map([[expectedItem.id, editableArtifact]]),
      destinationBaselines,
      transaction: rollbackTransaction,
      runtimeDeliveryPlanBinding
    });
    await finalizeSkuStagingCleanup({
      transaction: rollbackTransaction,
      preserveStagingRoot: mismatchedSuccessPromotion.preserveStagingRoot === true,
      host: mismatchedSuccessHost
    });
    global.window = previousAuditWindow;
    const cleanupRejectCalls = [];
    const cleanupRejectResult = await finalizeSkuStagingCleanup({
      transaction: rollbackTransaction,
      preserveStagingRoot: false,
      host: {
        removeSkuStagingTransactionRoot: async () => {
          cleanupRejectCalls.push('removeSkuStagingTransactionRoot');
          throw new Error('injected cleanup transport failure');
        },
        removeSkuStagingParentIfEmpty: async () => {
          cleanupRejectCalls.push('removeSkuStagingParentIfEmpty');
          return { success: true };
        }
      }
    });
    const parentCleanupRejectCalls = [];
    const parentCleanupRejectResult = await finalizeSkuStagingCleanup({
      transaction: rollbackTransaction,
      preserveStagingRoot: false,
      host: {
        removeSkuStagingTransactionRoot: async () => {
          parentCleanupRejectCalls.push('removeSkuStagingTransactionRoot');
          return { success: true };
        },
        removeSkuStagingParentIfEmpty: async () => {
          parentCleanupRejectCalls.push('removeSkuStagingParentIfEmpty');
          throw new Error('injected parent cleanup transport failure');
        }
      }
    });
    await finalizeSkuStagingCleanup({
      transaction: rollbackTransaction,
      preserveStagingRoot: malformedPromotion.preserveStagingRoot === true,
      host: malformedHost
    });
    const validRasterValidation = await validateSkuStagedRasterExports([rasterArtifact], {
      probeImageFile: async () => ({
        success: true,
        status: 'ok',
        rawImagesRedacted: true,
        dimensions: { width: 1000, height: 1000 },
        visualMetrics: {
          sampleSize: { width: 100, height: 100 },
          nonWhitePixelRatio: 0.5,
          nonWhiteBounds: { x: 10, y: 10, width: 80, height: 80, centerX: 0.5, centerY: 0.5, widthRatio: 0.8, heightRatio: 0.8 },
          edgeOccupancy: { top: 0, right: 0, bottom: 0, left: 0 },
          rawImagesRedacted: true
        }
      })
    });
    const duplicateRasterValidation = await validateSkuStagedRasterExports([
      rasterArtifact,
      { ...rasterArtifact }
    ], {
      probeImageFile: async () => ({ success: true, status: 'ok', rawImagesRedacted: true })
    });
    const missingRasterValidation = await validateSkuStagedRasterExports([rasterArtifact], {
      probeImageFile: async () => null
    });
    const rollbackResiduePaths = [];
    const scanRollbackResidue = (directoryPath) => {
      if (!fs.existsSync(directoryPath)) return;
      for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const entryPath = path.join(directoryPath, entry.name);
        if (entry.name.startsWith('.rollback-')) rollbackResiduePaths.push(path.resolve(entryPath));
        scanRollbackResidue(entryPath);
      }
    };
    scanRollbackResidue(destinationRoot);
    const expectedRecoveryPath = failedRollback?.recoveryPath
      ? path.resolve(failedRollback.recoveryPath)
      : '';
    const rollbackResidueCount = rollbackResiduePaths.length === 1
      && rollbackResiduePaths[0] === expectedRecoveryPath
      ? 0
      : rollbackResiduePaths.length + 1;
    return {
      transactionOwnerCreatedDirectory: fs.existsSync(destinationRoot),
      projectContainmentRejected,
      overwriteCommitted: atomicCommitVerified && atomicCleanup.success === true,
      subsetRejectedBeforeWrite: subsetRejectedBeforeWrite && subsetCleanup.success === true,
      escapedPathRejected: escaped.success === false
        && escapedSourcePreserved
        && escapedCleanup.success === true
        && !fs.existsSync(path.join(tempRoot, 'outside.jpg')),
      relativePathsRejected: relativeItem.success === false
        && relativeRoot.success === false
        && relativeItemSourcePreserved
        && invalidTokenSourcePreserved
        && relativeItemCleanup.success === true
        && invalidTokenCleanup.success === true
        && !fs.existsSync(relativeItemDestination)
        && !fs.existsSync(relativeRootDestination),
      destinationDriftRejected: drifted.success === false
        && drifted.code === 'destination_changed_since_baseline'
        && fs.readFileSync(driftDestination, 'utf8') === 'concurrent-user-change'
        && driftSourcePreserved
        && driftCleanup.success === true
        && appeared.success === false
        && appeared.code === 'destination_changed_since_baseline'
        && fs.readFileSync(appearedDestination, 'utf8') === 'external-created'
        && appearedSourcePreserved
        && appearedCleanup.success === true,
      mainFrozenBaselineAuthoritative: mainFrozenBaselineAuthoritative
        && forgedBaselineCleanup.success === true,
      concurrentPromotionSingleOwner: concurrentPromotionSingleOwner
        && concurrentCleanup.success === true,
      fullRollbackRestored: fullRollbackRestored && fullRollbackCleanup.success === true,
      freshProcessReconciliationFailClosed,
      backupMoveRacePreservesExternalFile,
      rollbackRestoreNoReplace,
      failedRollbackBackupPreserved: failedRollback?.success === false
        && failedRollback.rollbackComplete === false
        && Boolean(failedRollback.recoveryPath)
        && fs.existsSync(preservedBackupPath)
        && fs.readFileSync(preservedBackupPath, 'utf8') === 'old-four-note'
        && fs.existsSync(rollbackSource)
        && fs.readFileSync(rollbackDestination, 'utf8') === 'concurrent-user-file',
      recoveryManifestMapped: recoveryManifest?.version === 'staged-file-transaction-manifest/v1'
        && recoveryManifest.items?.length === 1
        && recoveryManifest.items[0]?.sourcePath === rollbackSource
        && recoveryManifest.items[0]?.destinationPath === rollbackDestination
        && recoveryManifest.items[0]?.backupPath === preservedBackupPath
        && fs.existsSync(path.join(failedRollback.recoveryPath, 'transaction-journal.jsonl')),
      rendererPreservesFailedRollbackStaging: rendererPromotion.success === false
        && rendererPromotion.preserveStagingRoot === true
        && Boolean(rendererPromotion.recoveryPath)
        && rendererCleanup.success === true
        && rendererCleanup.preserveStagingRoot === true
        && rendererHostCalls.length === 1
        && rendererHostCalls[0] === 'promoteStagedFileSet',
      rendererPreservesUnknownTransactionState: rejectedPromotion.success === false
        && rejectedPromotion.preserveStagingRoot === true
        && rejectedHostCalls.length === 1
        && rejectedHostCalls[0] === 'promoteStagedFileSet'
        && malformedPromotion.success === false
        && malformedPromotion.preserveStagingRoot === true
        && malformedHostCalls.length === 1
        && malformedHostCalls[0] === 'promoteStagedFileSet',
      rendererPreservesMismatchedSuccessReceipt: mismatchedSuccessPromotion.success === false
        && mismatchedSuccessPromotion.preserveStagingRoot === true
        && mismatchedSuccessCalls.length === 1
        && mismatchedSuccessCalls[0] === 'promoteStagedFileSet',
      cleanupTransportErrorsAreNormalized: cleanupRejectResult.success === false
        && cleanupRejectCalls.join(',') === 'removeSkuStagingTransactionRoot'
        && parentCleanupRejectResult.success === false
        && parentCleanupRejectCalls.join(',') === 'removeSkuStagingTransactionRoot,removeSkuStagingParentIfEmpty',
      stagedRasterValidationStrict: validRasterValidation.success === true
        && duplicateRasterValidation.success === false
        && missingRasterValidation.success === false,
      rollbackResidueCount
    };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function run() {
  const performanceText = read(performancePolicyPath);
  const performanceLedgerText = read(performanceLedgerPath);
  const performanceVisionPolicyText = read(performanceVisionPolicyPath);
  const {
    canQueueRunLevelVisualPresentation,
    consumePerformanceModelCallUsage,
    createPerformanceLedgerState,
    projectPerformanceLedgerUsage,
    readRunLevelVisualBudgetConsumed,
    restorePerformanceLedgerUsage,
    shouldIssuePerformanceBudgetDisciplineDirective
  } = require(performanceLedgerPath);
  const activeRuntimeAccountingText = read(activeRuntimeAccountingPath);
  const runtimeAccountingText = read(runtimeAccountingPath);
  const performanceSource = parse(performancePolicyPath);
  const decisionFunctionNames = [
    'inferTaskClass',
    'budgetForTaskClass',
    'verificationTierForTaskClass',
    'costProfileForTaskClass',
    'requiresContextSnapshotForTask',
    'shouldAllowVisionModel'
  ];
  const businessDecisionLiterals = decisionFunctionNames.flatMap((name) => {
    const declaration = findFunction(performanceSource, name);
    if (!declaration) return [`missing-function:${name}`];
    return literalText(declaration, performanceSource)
      .filter((value) => protectedBusinessPattern.test(value))
      .map((value) => `${name}:${compact(value)}`);
  });

  const defaultsSource = parse(defaultsPath);
  const defaultsText = read(defaultsPath);
  const authorizationViolations = authorizationMintingViolations(defaultsSource);
  const promptText = read(promptPath);
  const planningContractText = read(planningContractPath);
  const manifestSchema = JSON.parse(read(manifestSchemaPath));
  const executorText = read(executorPath);
  const designTeamCoordinatorText = read(designTeamCoordinatorPath);
  const executorSource = parse(executorPath);
  const performanceResolverText = findFunction(executorSource, 'resolveAutonomousPerformancePolicy')?.getText(executorSource) || '';
  const agentRuntimeText = read(agentRuntimePath);
  const terminalClosureCheckpointText = read(terminalClosureCheckpointPath);
  const designFinalReviewEvidenceText = read(designFinalReviewEvidencePath);
  const designFinalComparisonEvidenceText = read(designFinalComparisonEvidencePath);
  const trustedFinalComparisonEvidenceText = read(trustedFinalComparisonEvidencePath);
  const agentModelTransportPolicyText = read(agentModelTransportPolicyPath);
  const finalQualityModelProtocolText = read(finalQualityModelProtocolPath);
  const finalQualityReviewRuntimeText = read(finalQualityReviewRuntimePath);
  const modelVisualPresentationReceiptText = read(modelVisualPresentationReceiptPath);
  const runtimeReferenceAdapterText = read(runtimeReferenceAdapterPath);
  const capabilitySessionText = read(capabilitySessionPath);
  const designEvaluationProfilesText = read(designEvaluationProfilesPath);
  const agentRuntimeSource = parse(agentRuntimePath);
  const agentRuntimeTypesText = read(agentRuntimeTypesPath);
  const agentUserResultProjectionText = read(agentUserResultProjectionPath);
  const agentActionEventProjectionText = read(agentActionEventProjectionPath);
  const runtimeBundleText = read(runtimeBundlePath);
  const runtimeStagePlanText = read(runtimeStagePlanPath);
  const runtimeDesignBriefText = read(runtimeDesignBriefPath);
  const runtimeReferenceContextText = read(runtimeReferenceContextPath);
  const runtimeSessionText = read(runtimeSessionPath);
  const runtimeStageStateText = read(runtimeStageStatePath);
  const agentRuntimeLivenessPolicyText = read(agentRuntimeLivenessPolicyPath);
  const agentReadResultCacheText = read(agentReadResultCachePath);
  const agentReActObservationContractText = read(agentReActObservationContractPath);
  const runtimeScopedChangeRecordsText = read(runtimeScopedChangeRecordsPath);
  const runtimeMethodKnowledgeText = read(runtimeMethodKnowledgePath);
  const taskProfileText = read(taskProfilePath);
  const artifactKnowledgeText = read(artifactKnowledgePath);
  const photoshopCraftRecipesText = read(photoshopCraftRecipesPath);
  const designKnowledgeSearchText = read(designKnowledgeSearchPath);
  const designMemoryKnowledgeText = read(designMemoryKnowledgePath);
  const designPlannerContextSource = parse(designPlannerContextPath);
  const designMemoryKnowledgeBuilderText = findFunction(
    designPlannerContextSource,
    'buildDesignMemoryKnowledgeResultsForSkill'
  )?.getText(designPlannerContextSource) || '';
  const toolExecutorText = read(toolExecutorPath);
  const publicPlanPhotoshopAdapterText = read(publicPlanPhotoshopAdapterPath);
  const composeDesignSpecText = read(composeDesignSpecPath);
  const composeDesignExecutorText = read(composeDesignExecutorPath);
  const photoshopTransientErrorText = read(path.join(root, 'src', 'shared', 'photoshop-transient-error.ts'));
  const screenshotHandlersText = read(screenshotHandlersPath);
  const uxpCreateTextLayerSource = parse(uxpCreateTextLayerPath);
  const uxpCreateTextLayerText = read(uxpCreateTextLayerPath);
  const uxpNormalizeTextContentText = findFunction(
    uxpCreateTextLayerSource,
    'normalizeTextContent'
  )?.getText(uxpCreateTextLayerSource) || '';
  const memoryServiceSource = parse(memoryServicePath);
  const preferenceMemoryConversionText = findFunction(
    memoryServiceSource,
    'preferenceItemToDesignMemoryItem'
  )?.getText(memoryServiceSource) || '';
  const projectImageAnalysisExecutorText = read(projectImageAnalysisExecutorPath);
  const skuConfigExecutorText = read(skuConfigExecutorPath);
  const skuBatchExecutorSource = parse(skuBatchExecutorPath);
  const skuBatchExecutorText = read(skuBatchExecutorPath);
  const skuExportTransactionText = read(skuExportTransactionPath);
  const stagedDeliveryPromotionText = read(stagedDeliveryPromotionPath);
  const runtimeStagedDeliveryText = read(runtimeStagedDeliveryPath);
  const rendererStagedFileTransactionText = read(rendererStagedFileTransactionPath);
  const stagedFilePromotionText = read(stagedFilePromotionPath);
  const skuStagingTransactionServiceSource = parse(skuStagingTransactionServicePath);
  const skuStagingTransactionServiceText = read(skuStagingTransactionServicePath);
  const skuColorResolutionFunctionNames = [
    'escapeRegExp',
    'normalizeColorKey',
    'buildColorAliasEntries',
    'isNumericColorAlias',
    'matchesNumericColorToken',
    'collectUniqueColorAliasMatches',
    'resolveColorToken'
  ];
  const skuColorResolutionFunctionTexts = skuColorResolutionFunctionNames.map((functionName) => (
    findFunction(skuBatchExecutorSource, functionName)?.getText(skuBatchExecutorSource) || ''
  ));
  const skuColorResolutionFunctions = skuColorResolutionFunctionTexts.every(Boolean)
    ? loadStandaloneAuditFunctions(
      skuColorResolutionFunctionTexts,
      skuColorResolutionFunctionNames,
      skuBatchExecutorPath
    )
    : {};
  const terminalSkuLayerCleanupFailureReaderText = findFunction(
    skuBatchExecutorSource,
    'readTerminalSkuLayerCleanupFailure'
  )?.getText(skuBatchExecutorSource) || '';
  const skuBatchExecuteMethodText = findMethod(
    skuBatchExecutorSource,
    'execute'
  )?.getText(skuBatchExecutorSource) || '';
  const fileSystemHandlersSource = parse(fileSystemHandlersPath);
  const fileSystemHandlersText = read(fileSystemHandlersPath);
  const resolveLocalStagingPathText = findFunction(
    skuStagingTransactionServiceSource,
    'resolveRequiredLocalAbsolutePath'
  )?.getText(skuStagingTransactionServiceSource) || '';
  const reparseSegmentGuardText = findFunction(
    skuStagingTransactionServiceSource,
    'assertNoReparsePointInExistingSegments'
  )?.getText(skuStagingTransactionServiceSource) || '';
  const validatedTransactionRemovalText = findFunction(
    skuStagingTransactionServiceSource,
    'removeValidatedTransactionRoot'
  )?.getText(skuStagingTransactionServiceSource) || '';
  const transactionIssueText = findFunction(
    skuStagingTransactionServiceSource,
    'issueSkuStagingTransactionUnlocked'
  )?.getText(skuStagingTransactionServiceSource) || '';
  const transactionRootCleanupText = findFunction(
    skuStagingTransactionServiceSource,
    'removeSkuStagingTransactionRoot'
  )?.getText(skuStagingTransactionServiceSource) || '';
  const transactionParentCleanupText = findFunction(
    skuStagingTransactionServiceSource,
    'removeSkuStagingParentIfEmpty'
  )?.getText(skuStagingTransactionServiceSource) || '';
  const skillToolsText = read(skillToolsPath);
  const skuDeliverySummaryText = read(skuDeliverySummaryPath);
  const interactiveContinuationOperationStoreText = read(interactiveContinuationOperationStorePath);
  const agentDiagnosticRecordText = read(agentDiagnosticRecordPath);
  const skuHumanReviewText = read(skuHumanReviewPath);
  const skuPrerequisiteRepairViolations = auditSkuPrerequisiteRepairBehavior({
    root,
    executorText: skuBatchExecutorText
  });
  const skuColorCardExecutorText = read(skuColorCardExecutorPath);
  const detailPageExecutorText = read(detailPageExecutorPath);
  const detailPageAssetRankerText = read(detailPageAssetRankerPath);
  const detailPageDesignSkillText = read(detailPageDesignSkillPath);
  const skillExecutorIndexText = read(skillExecutorIndexPath);
  const skuColorCardContractText = read(skuColorCardContractPath);
  const skuTemplateDesignLoopText = read(skuTemplateDesignLoopPath);
  const {
    buildSkuTemplateDesignHandoffContract,
    resolveSkuTemplatePreparationRoute,
    shouldDesignTemplateWithoutAsking
  } = require(skuTemplateDesignLoopPath);
  const { buildSkillWorkflowBridgeObservation } = require(skillToolsPath);
  const {
    evaluateAgentWorkflowContinuationToolAccess,
    isDeclaredNonFatalAgentWorkflowHandoff,
    resolveAgentWorkflowContinuationScopeUpdate,
    selectAgentWorkflowContinuationToolNames
  } = require(agentWorkflowContinuationScopePath);
  const {
    readAgentReActRecoveryToolNames
  } = require(agentReActObservationContractPath);
  const {
    hasExplicitReversibleDesignDecisionDelegation
  } = require(promptPath);
  const { applySharedSkillParamDefaults } = require(defaultsPath);
  const { fastDeterministicRoute } = require(routingPath);
  const { buildAgentToolDecisionContract } = require(agentToolDecisionContractPath);
  const {
    BASE_DOCUMENT_OPTIONAL_TOOLS,
    canAgentToolStartWithoutOpenDocument
  } = require(documentOptionalToolsPath);
  const {
    buildAgentToolExecutionPreflight
  } = require(agentToolExecutionPreflightPath);
  const {
    buildGuardedAtomicToolExecutionDecision
  } = require(agentSkillAtomicToolExecutionPath);
  const {
    resolveProviderTruncationMaxTokens
  } = require(agentProviderTruncationRecoveryPath);
  const {
    ensureAgentToolFailureDiagnostics
  } = require(agentToolFailureDiagnosticPath);
  const deterministicConsistencyText = read(deterministicConsistencyPath);
  const skuTemplateContentConsistencyText = read(skuTemplateContentConsistencyPath);
  const skuTemplateSelectionText = read(skuTemplateSelectionPath);
  const designPlacementIntelligenceText = read(designPlacementIntelligencePath);
  const skillRoutingText = read(skillRoutingPath);
  const skillDeclarationsText = read(skillDeclarationsPath);
  const skuIntentParamsText = read(skuIntentParamsPath);
  const toolSchemasText = read(toolSchemasPath);
  const genericCardSchemaStart = toolSchemasText.indexOf("name: 'createInteractiveCard'");
  const genericCardSchemaEnd = toolSchemasText.indexOf("name: 'createDocument'", genericCardSchemaStart);
  const genericCardSchemaText = genericCardSchemaStart >= 0 && genericCardSchemaEnd > genericCardSchemaStart
    ? toolSchemasText.slice(genericCardSchemaStart, genericCardSchemaEnd)
    : '';
  const designKnowledgeSchemaStart = toolSchemasText.indexOf("name: 'getDesignKnowledge'");
  const designKnowledgeSchemaEnd = toolSchemasText.indexOf("name: 'getDesignPrinciples'", designKnowledgeSchemaStart);
  const designKnowledgeSchemaText = designKnowledgeSchemaStart >= 0 && designKnowledgeSchemaEnd > designKnowledgeSchemaStart
    ? toolSchemasText.slice(designKnowledgeSchemaStart, designKnowledgeSchemaEnd)
    : '';
  const engineText = read(enginePath);
  const agentToolExecutionPreflightText = read(agentToolExecutionPreflightPath);
  const agentSkillAtomicToolExecutionText = read(agentSkillAtomicToolExecutionPath);
  const routingText = read(routingPath);
  const visualSamplingText = read(visualSamplingPath);
  const modelProviderFailureText = read(modelProviderFailurePath);
  const modelProviderTransportPolicyText = read(modelProviderTransportPolicyPath);
  const codexTurnProgressText = read(codexTurnProgressPath);
  const reflexionReentryPolicyText = read(reflexionReentryPolicyPath);
  const reflexionWriteFreshnessText = read(reflexionWriteFreshnessPath);
  const runtimeReflexionContractText = read(runtimeReflexionContractPath);
  const { classifyModelProviderFailure } = require(modelProviderFailurePath);
  const {
    isHarnessManagedSubscriptionTimeout,
    shouldRetryAutonomousModelTransport
  } = require(modelProviderTransportPolicyPath);
  const {
    codexNotificationMatchesActiveTurn,
    evaluateCodexTurnIdleProgress,
    ownsCodexTurnSlot
  } = require(codexTurnProgressPath);
  const { restoreAgentToolStreamError } = require(agentToolStreamServicePath);
  const { ActiveRuntimeAccounting } = require(activeRuntimeAccountingPath);
  const { validateRuntimeAccountingDigest } = require(runtimeAccountingPath);
  const subscriptionUsageLimitFailure = classifyModelProviderFailure(Object.assign(
    new Error("GPT 订阅模型运行错误：You've hit your usage limit. Purchase more credits or try again at Aug 28th, 2026 9:01 AM."),
    { code: 'codex_subscription_turn_not_completed' }
  ));
  const subscriptionInvalidToolJsonFailure = classifyModelProviderFailure(Object.assign(
    new Error('GPT 订阅模型为工具返回了无效 JSON 参数。'),
    { code: 'codex_subscription_tool_arguments_invalid_json' }
  ));
  const restoredSubscriptionIdleTimeout = restoreAgentToolStreamError({
    type: 'error',
    error: 'DesignEcho 订阅桥连续 180 秒未收到新的模型进度，已中断本轮。',
    errorCode: 'codex_subscription_turn_idle_timeout',
    errorName: 'Error'
  });
  const restoredSubscriptionWallTimeout = restoreAgentToolStreamError({
    type: 'error',
    error: 'DesignEcho 订阅桥等待本轮完成已达到总时限，已中断。',
    errorCode: 'codex_subscription_turn_wall_clock_timeout',
    errorName: 'Error'
  });
  const classifiedSubscriptionIdleTimeout = classifyModelProviderFailure(
    restoredSubscriptionIdleTimeout
  );
  const classifiedSubscriptionWallTimeout = classifyModelProviderFailure(
    restoredSubscriptionWallTimeout
  );
  const retrySubscriptionIdleTimeout = shouldRetryAutonomousModelTransport({
    failure: classifiedSubscriptionIdleTimeout,
    attempt: 1,
    maxAttempts: 2,
    hasEmittedStreamPayload: false
  });
  const retrySubscriptionWallTimeout = shouldRetryAutonomousModelTransport({
    failure: classifiedSubscriptionWallTimeout,
    attempt: 1,
    maxAttempts: 2,
    hasEmittedStreamPayload: false
  });
  const retryAfterVisiblePayload = shouldRetryAutonomousModelTransport({
    failure: classifiedSubscriptionIdleTimeout,
    attempt: 1,
    maxAttempts: 2,
    hasEmittedStreamPayload: true
  });
  const freshCodexProgress = evaluateCodexTurnIdleProgress({
    lastProgressAtMs: 1_000,
    nowMs: 180_999,
    idleTimeoutMs: 180_000
  });
  const expiredCodexProgress = evaluateCodexTurnIdleProgress({
    lastProgressAtMs: 1_000,
    nowMs: 181_000,
    idleTimeoutMs: 180_000
  });
  const oldTurnSlot = { threadId: 'thread-reused', turnId: 'turn-old' };
  const newTurnSlot = { threadId: 'thread-reused', turnId: 'turn-new' };
  const activeTurnSlots = new Map([[oldTurnSlot.threadId, oldTurnSlot]]);
  const oldTurnOwnedBeforeReplacement = ownsCodexTurnSlot(activeTurnSlots, oldTurnSlot);
  activeTurnSlots.set(newTurnSlot.threadId, newTurnSlot);
  if (ownsCodexTurnSlot(activeTurnSlots, oldTurnSlot)) {
    activeTurnSlots.delete(oldTurnSlot.threadId);
  }
  const lateOldTurnCallbackPreservedNewTurn = activeTurnSlots.get(newTurnSlot.threadId) === newTurnSlot;
  const matchingTurnNotificationAccepted = codexNotificationMatchesActiveTurn({
    activeTurnId: newTurnSlot.turnId,
    notificationTurnId: newTurnSlot.turnId
  });
  const staleTurnNotificationRejected = codexNotificationMatchesActiveTurn({
    activeTurnId: newTurnSlot.turnId,
    notificationTurnId: oldTurnSlot.turnId
  });
  const transportAttemptAccounting = new ActiveRuntimeAccounting();
  transportAttemptAccounting.beginRun(1_000, undefined);
  transportAttemptAccounting.recordModelCall(undefined, {
    durationMs: 999,
    succeeded: true,
    outcome: {
      transportAttempts: [
        {
          durationMs: 180_000,
          succeeded: false,
          failureKind: 'timeout',
          providerCode: 'codex_subscription_turn_idle_timeout',
          status: 504,
          diagnostic: '不得进入账本的错误正文',
          stack: '不得进入账本的堆栈'
        },
        {
          durationMs: 12_000,
          succeeded: true,
          usage: { inputTokens: 40_000, outputTokens: 600 }
        }
      ]
    }
  });
  const transportAttemptAccountingDigest = transportAttemptAccounting.readDigest();
  const transportAttemptAccountingJson = JSON.stringify(transportAttemptAccountingDigest);
  const transportAttemptAccountingValidation = validateRuntimeAccountingDigest(
    transportAttemptAccountingDigest
  );
  const pollutedTransportAttemptAccountingDigest = JSON.parse(transportAttemptAccountingJson);
  pollutedTransportAttemptAccountingDigest.modelFailureSamples[0].diagnostic = '不允许持久化';
  const pollutedTransportAttemptAccountingValidation = validateRuntimeAccountingDigest(
    pollutedTransportAttemptAccountingDigest
  );
  const designDocumentRoleText = read(designDocumentRolePath);
  const toolAcceptanceText = read(toolAcceptancePath);
  const policyGateRepeatGuardText = read(policyGateRepeatGuardPath);
  const conversationalUnavailableMessageText = read(conversationalUnavailableMessagePath);
  const agentRunRecordText = read(agentRunRecordPath);
  const agentRunResumeText = read(agentRunResumePath);
  const chatComposerContentText = read(chatComposerContentPath);
  const eagleComposerTransferText = read(eagleComposerTransferPath);
  const agentMessageContextText = read(agentMessageContextPath);
  const agentVisibleFeedbackSource = parse(agentVisibleFeedbackPath);
  const chatPanelText = read(chatPanelPath);
  const chatPanelSource = parseTsx(chatPanelPath);
  const designAgentWorkbenchText = read(designAgentWorkbenchPath);
  const designAgentWorkbenchSource = parseTsx(designAgentWorkbenchPath);
  const eagleLibraryPageText = read(eagleLibraryPagePath);
  const eagleLibraryPageSource = parseTsx(eagleLibraryPagePath);
  const inlineMultimodalComposerText = read(inlineMultimodalComposerPath);

  const memoryTruthSourceViolations = [];
  const {
    buildStableProjectPathFingerprint,
    resolveStableProjectMemoryIdentity
  } = require(projectMemoryScopePath);
  const { resolveAgentProjectMemoryScope } = require(agentOrchestrationTypesPath);
  const {
    buildDesignMemoryItemsFromUserPreferences,
    designMemoryItemToKnowledgeResult,
    searchDesignMemoryKnowledge
  } = require(designMemoryKnowledgePath);
  const { reviewDesignLearningMemoryCandidate } = require(designLearningMemoryReviewPath);
  const { buildWorkshopReferenceLearningCandidate } = require(designLearningExperiencePath);
  const { buildSkuComboEditorInteractiveCard } = require(skuComboInteractiveCardPath);
  const { buildEditableConfirmationInteractiveCard } = require(editableConfirmationInteractiveCardPath);

  const authoritativeProjectScope = resolveAgentProjectMemoryScope({
    projectId: 'project-audit-stable-id',
    projectPath: 'C:\\Workspace\\Ignored-Path'
  });
  const fingerprintProjectScope = resolveAgentProjectMemoryScope({
    projectPath: 'C:\\Workspace\\Catalog-A\\'
  });
  const equivalentFingerprintProjectScope = resolveAgentProjectMemoryScope({
    projectPath: 'c:/workspace/catalog-a'
  });
  const fileUrlFingerprintProjectScope = resolveAgentProjectMemoryScope({
    projectPath: 'file:///C:/Workspace/Catalog-A/'
  });
  const differentFingerprintProjectScope = resolveAgentProjectMemoryScope({
    projectPath: 'C:\\Workspace\\Catalog-B'
  });
  const redactedProjectScope = resolveAgentProjectMemoryScope({
    projectId: '[redacted-local-path]'
  });
  const redactedWithPathFallbackScope = resolveAgentProjectMemoryScope({
    projectId: '[redacted-local-path]',
    projectPath: 'C:\\Workspace\\Catalog-A'
  });
  const rawProjectPathFingerprint = buildStableProjectPathFingerprint('C:\\Workspace\\Catalog-A');
  const resolvedProjectIdentity = resolveStableProjectMemoryIdentity({
    projectId: 'project-audit-stable-id',
    projectPath: 'C:\\Workspace\\Catalog-A'
  });
  if (authoritativeProjectScope.type !== 'project'
    || authoritativeProjectScope.id !== 'project-audit-stable-id'
    || resolvedProjectIdentity?.source !== 'project_id'
    || fingerprintProjectScope.type !== 'project'
    || !/^project-path-sha256-v1:[a-f0-9]{64}$/.test(fingerprintProjectScope.id || '')
    || fingerprintProjectScope.id !== equivalentFingerprintProjectScope.id
    || fingerprintProjectScope.id !== fileUrlFingerprintProjectScope.id
    || fingerprintProjectScope.id === differentFingerprintProjectScope.id
    || fingerprintProjectScope.id !== rawProjectPathFingerprint
    || /workspace|catalog|[\\/]/i.test(fingerprintProjectScope.id || '')
    || redactedProjectScope.type !== 'user'
    || redactedWithPathFallbackScope.id !== fingerprintProjectScope.id) {
    memoryTruthSourceViolations.push('project-memory-scope:stable-id-path-fingerprint-or-redaction-boundary-regressed');
  }

  const skuScopeCard = buildSkuComboEditorInteractiveCard({
    colorSlots: [
      { slot: 1, colorIdentity: 'test-white', label: '白色' },
      { slot: 2, colorIdentity: 'test-gray', label: '灰色' }
    ],
    requiredSizes: [2],
    memoryScope: fingerprintProjectScope
  });
  const skuRawPathCard = buildSkuComboEditorInteractiveCard({
    colorSlots: [
      { slot: 1, colorIdentity: 'test-white', label: '白色' },
      { slot: 2, colorIdentity: 'test-gray', label: '灰色' }
    ],
    requiredSizes: [2],
    projectId: 'C:\\Workspace\\Catalog-A'
  });
  const skuLegacyRedactedCard = buildSkuComboEditorInteractiveCard({
    colorSlots: [
      { slot: 1, colorIdentity: 'test-white', label: '白色' },
      { slot: 2, colorIdentity: 'test-gray', label: '灰色' }
    ],
    requiredSizes: [2],
    projectId: '[redacted-local-path]'
  });
  const templateScopeCard = buildEditableConfirmationInteractiveCard({
    title: '确认 SKU 模板方向',
    fields: [{ id: 'direction', label: '方向', type: 'short_text', value: '清晰留白' }],
    memoryEnabled: true,
    memoryScope: fingerprintProjectScope
  });
  if (skuScopeCard.memoryPolicy?.scope?.type !== 'project'
    || skuScopeCard.memoryPolicy.scope.id !== fingerprintProjectScope.id
    || skuScopeCard.payload.productHints?.projectId !== fingerprintProjectScope.id
    || skuRawPathCard.memoryPolicy?.scope?.type !== 'user'
    || skuRawPathCard.payload.productHints?.projectId
    || skuLegacyRedactedCard.memoryPolicy?.scope?.type !== 'user'
    || skuLegacyRedactedCard.payload.productHints?.projectId
    || templateScopeCard.memoryPolicy?.scope?.type !== 'project'
    || templateScopeCard.memoryPolicy.scope.id !== fingerprintProjectScope.id) {
    memoryTruthSourceViolations.push('sku-interactive-card:display-path-or-redacted-placeholder-became-memory-identity');
  }

  const inferredPreferenceMemory = buildDesignMemoryItemsFromUserPreferences({
    design: { preferredFonts: ['Audit Font'] }
  }, { now: '2026-08-14T00:00:00.000Z' })[0];
  const activeButUnreviewedMemory = {
    ...inferredPreferenceMemory,
    id: 'memory-active-with-unreviewed-source-note',
    status: 'active',
    source: 'manual_setting',
    sourceNotes: [{
      source: 'audit-unreviewed-source',
      summary: '尚未复核。',
      status: 'needs_review'
    }]
  };
  const reviewedManualMemory = {
    ...activeButUnreviewedMemory,
    id: 'memory-reviewed-manual-setting',
    sourceNotes: [{
      source: 'audit-manual-review',
      summary: '用户已在设置中明确确认。',
      status: 'active'
    }]
  };
  const unreviewedKnowledge = designMemoryItemToKnowledgeResult(activeButUnreviewedMemory);
  const reviewedManualKnowledge = designMemoryItemToKnowledgeResult(reviewedManualMemory);
  const learningCandidate = {
    id: 'design-learning-memory-audit',
    kind: 'visual_case',
    scope: { type: 'user' },
    status: 'needs_review',
    source: 'imported_case',
    title: '商品主体留白案例',
    summary: '主体边缘保留稳定留白。',
    sourceNotes: [{
      source: 'design-learning-experience',
      summary: 'review=pending',
      status: 'needs_review'
    }],
    tags: ['design-learning', '留白'],
    appliesTo: ['reference'],
    allowedUses: ['prompt_context'],
    sourceRank: 0
  };
  const approvedLearningReview = reviewDesignLearningMemoryCandidate({
    candidate: learningCandidate,
    decision: 'approved',
    reviewer: 'user',
    notes: ['确认可作为参考'],
    reviewedAt: '2026-08-14T00:10:00.000Z'
  });
  const approvedLearningKnowledge = designMemoryItemToKnowledgeResult(approvedLearningReview.reviewedItem);
  const workshopReferenceCandidate = buildWorkshopReferenceLearningCandidate({
    title: '点击图参考学习',
    summary: '主体清晰，文字集中在右侧留白。',
    whatLooksGood: ['主体与文字没有互相遮挡'],
    whyItWorks: ['缩略图下仍能快速识别商品'],
    reusableHeuristics: ['先按素材留白方向决定文字区'],
    suitableScenarios: ['电商点击图'],
    analysisSource: 'audit-visual-model',
    userCuratedReference: true,
    now: '2026-08-14T00:05:00.000Z'
  });
  const unreviewedWorkshopKnowledge = workshopReferenceCandidate
    ? designMemoryItemToKnowledgeResult(workshopReferenceCandidate)
    : undefined;
  const reviewedWorkshopCandidate = workshopReferenceCandidate
    ? reviewDesignLearningMemoryCandidate({
        candidate: workshopReferenceCandidate,
        decision: 'approved',
        reviewer: 'user',
        notes: ['确认该方法可进入长期知识。'],
        reviewedAt: '2026-08-14T00:10:00.000Z'
      })
    : undefined;
  const reviewedWorkshopKnowledge = reviewedWorkshopCandidate
    ? designMemoryItemToKnowledgeResult(reviewedWorkshopCandidate.reviewedItem)
    : undefined;
  if (!inferredPreferenceMemory
    || inferredPreferenceMemory.status !== 'needs_review'
    || unreviewedKnowledge !== undefined
    || reviewedManualKnowledge?.governance?.provenance !== 'local_reviewed'
    || approvedLearningReview.status !== 'promoted_active'
    || approvedLearningReview.reviewedItem.status !== 'active'
    || !approvedLearningReview.reviewedItem.sourceNotes.every((note) => note.status === 'active')
    || approvedLearningKnowledge?.governance?.provenance !== 'local_reviewed'
    || !workshopReferenceCandidate
    || workshopReferenceCandidate.status !== 'needs_review'
    || unreviewedWorkshopKnowledge !== undefined
    || reviewedWorkshopCandidate?.status !== 'promoted_active'
    || reviewedWorkshopKnowledge?.governance?.provenance !== 'local_reviewed') {
    memoryTruthSourceViolations.push('design-memory-review:top-level-or-source-note-review-truth-was-bypassed');
  }

  const relevantLowRankMemory = {
    ...reviewedManualMemory,
    id: 'memory-relevant-sku-composition',
    title: 'SKU 组合留白规则',
    summary: 'SKU 组合卡应保持商品间距与边缘留白。',
    tags: ['sku', '组合', '留白'],
    sourceRank: 58
  };
  const weakHighRankMemory = {
    ...reviewedManualMemory,
    id: 'memory-weak-sku-mention',
    title: '历史任务备注',
    summary: '曾在一个 SKU 任务中使用。',
    tags: ['历史任务'],
    sourceRank: 99
  };
  const unrelatedHighRankMemory = {
    ...reviewedManualMemory,
    id: 'memory-unrelated-font',
    title: '品牌字体偏好',
    summary: '标题使用指定衬线字体。',
    tags: ['字体', '排版'],
    sourceRank: 100
  };
  const hiddenUnreviewedRelevantMemory = {
    ...relevantLowRankMemory,
    id: 'memory-hidden-unreviewed-sku',
    sourceRank: 100,
    sourceNotes: [{
      source: 'audit-unreviewed-source',
      summary: 'SKU 组合候选尚未复核。',
      status: 'needs_review'
    }]
  };
  const relevanceResults = searchDesignMemoryKnowledge({
    query: '请帮我做 SKU 组合',
    sourceTypes: ['local_case'],
    limit: 4
  }, [
    unrelatedHighRankMemory,
    weakHighRankMemory,
    hiddenUnreviewedRelevantMemory,
    relevantLowRankMemory
  ]);
  const relevanceResultIds = relevanceResults.map((item) => item.id);
  if (relevanceResultIds[0] !== 'local-memory:memory-relevant-sku-composition'
    || relevanceResultIds.includes('local-memory:memory-unrelated-font')
    || relevanceResultIds.includes('local-memory:memory-hidden-unreviewed-sku')) {
    memoryTruthSourceViolations.push(`design-memory-search:relevance-or-reviewed-only-order-regressed:${relevanceResultIds.join(',')}`);
  }

  const forbiddenDomainExpansionTerms = [
    '用户偏好', '设计风格', '字体', '排版', '颜色', '配色', '文案', '工作流', '主图', '详情页', 'SKU'
  ].filter((term) => designMemoryKnowledgeBuilderText.includes(`'${term}'`));
  if (forbiddenDomainExpansionTerms.length > 0
    || !designMemoryKnowledgeText.includes('scoreDesignMemoryKnowledgeRelevance')
    || !preferenceMemoryConversionText.includes('resolveInitialDesignMemoryStatus(source)')
    || !skuBatchExecutorText.includes('const skuProjectMemoryScope = resolveAgentProjectMemoryScope({')
    || !skuBatchExecutorText.includes('memoryScope: skuProjectMemoryScope')
    || skuBatchExecutorText.includes('projectId: projectContext?.projectPath')) {
    memoryTruthSourceViolations.push(
      `design-memory-wiring:scope-review-or-neutral-query-owner-missing:${forbiddenDomainExpansionTerms.join(',')}`
    );
  }

  const skuAutonomousTemplateViolations = [];
  const fullStageMissingTemplateRoute = resolveSkuTemplatePreparationRoute({
    userInput: '请直接完成 2、3、4 双装 SKU 组合设计',
    templateDesignConfirmed: false,
    stage: 'full'
  });
  const explicitTemplateStageRoute = resolveSkuTemplatePreparationRoute({
    userInput: '请单独设计一套 SKU 模板',
    templateDesignConfirmed: false,
    stage: 'template'
  });
  const explicitlyReviewedTemplateRoute = resolveSkuTemplatePreparationRoute({
    userInput: '先让我确认 SKU 模板方向再开始设计',
    templateDesignConfirmed: false,
    stage: 'template'
  });
  const explicitFallbackRoute = resolveSkuTemplatePreparationRoute({
    userInput: '先用默认占位模板快速出一版',
    templateDesignConfirmed: false,
    stage: 'full'
  });
  if (!shouldDesignTemplateWithoutAsking({
    userInput: '帮我完成 SKU',
    templateDesignConfirmed: false
  }) || fullStageMissingTemplateRoute.route !== 'agent_design_handoff') {
    skuAutonomousTemplateViolations.push('sku-template:full-stage-still-asks-user-before-autonomous-design');
  }
  if (!shouldDesignTemplateWithoutAsking({
    userInput: '请单独设计一套 SKU 模板',
    templateDesignConfirmed: false,
    stage: 'template'
  }) || explicitTemplateStageRoute.route !== 'agent_design_handoff') {
    skuAutonomousTemplateViolations.push('sku-template:standalone-reversible-design-still-asks-by-default');
  }
  if (shouldDesignTemplateWithoutAsking({
    userInput: '先让我确认 SKU 模板方向再开始设计',
    templateDesignConfirmed: false,
    stage: 'template'
  }) || explicitlyReviewedTemplateRoute.route !== 'confirmation_required') {
    skuAutonomousTemplateViolations.push('sku-template:explicit-direction-review-request-was-ignored');
  }
  if (explicitFallbackRoute.route !== 'placeholder_preparation') {
    skuAutonomousTemplateViolations.push('sku-template:explicit-placeholder-fallback-no-longer-has-priority');
  }
  const writeIntentControlPlane = {
    toolScope: 'write_photoshop',
    executionAuthorization: 'confirmed_tool_required'
  };
  const skuWithoutDocumentDecision = buildAgentToolDecisionContract({
    userInput: '请完成 2、3、4 双装 SKU 组合设计',
    intentControlPlane: writeIntentControlPlane,
    toolCalls: [{ id: 'sku-without-document', name: 'sku-batch', arguments: { stage: 'full' } }],
    runtime: {
      availableTools: ['sku-batch'],
      photoshopConnected: true,
      hasDocument: false
    }
  });
  const ordinaryWriteWithoutDocumentDecision = buildAgentToolDecisionContract({
    userInput: '修改当前文字',
    intentControlPlane: writeIntentControlPlane,
    toolCalls: [{ id: 'text-without-document', name: 'setTextContent', arguments: { layerId: 1, content: '新文字' } }],
    runtime: {
      availableTools: ['setTextContent'],
      photoshopConnected: true,
      hasDocument: false
    }
  });
  const declaredBootstrapSkillPreflight = buildAgentToolExecutionPreflight({
    toolCalls: [{ name: 'layout-replication', arguments: { mode: 'local', filePath: 'D:/ref/layout.jpg' } }],
    completedToolCalls: [],
    requiresUserVisiblePreActionRationale: false
  });
  const ordinaryWriteSkillPreflight = buildAgentToolExecutionPreflight({
    toolCalls: [{ name: 'smart-layout', arguments: { layerId: 1 } }],
    completedToolCalls: [],
    requiresUserVisiblePreActionRationale: false
  });
  if (BASE_DOCUMENT_OPTIONAL_TOOLS.has('sku-batch')
    || BASE_DOCUMENT_OPTIONAL_TOOLS.has('layout-replication')
    || !canAgentToolStartWithoutOpenDocument('sku-batch')
    || !canAgentToolStartWithoutOpenDocument('layout-replication')
    || canAgentToolStartWithoutOpenDocument('smart-layout')
    || skuWithoutDocumentDecision.status !== 'ready'
    || skuWithoutDocumentDecision.allowedToolCalls[0]?.name !== 'sku-batch') {
    skuAutonomousTemplateViolations.push('sku-batch:no-document-entry-still-blocked');
  }
  if (ordinaryWriteWithoutDocumentDecision.status !== 'blocked'
    || !ordinaryWriteWithoutDocumentDecision.blockers.some((item) => (
      item.code === 'photoshop_document_required' && item.toolName === 'setTextContent'
    ))) {
    skuAutonomousTemplateViolations.push('document-optional:ordinary-write-was-broadened-with-sku-batch');
  }
  if (declaredBootstrapSkillPreflight.status !== 'ready'
    || declaredBootstrapSkillPreflight.ready !== true
    || declaredBootstrapSkillPreflight.blockers.length !== 0) {
    skuAutonomousTemplateViolations.push('document-bootstrap:declared-skill-was-blocked-without-prior-read');
  }
  if (ordinaryWriteSkillPreflight.status !== 'blocked'
    || ordinaryWriteSkillPreflight.ready !== false
    || !ordinaryWriteSkillPreflight.blockers.some((item) => item.includes('尚未读取目标 Photoshop 文档'))) {
    skuAutonomousTemplateViolations.push('document-bootstrap:ordinary-write-skill-bypassed-prior-read');
  }

  const skillAtomicTargetBindingViolations = [];
  const agentPanelBridgeExecutorText = read(path.join(
    root,
    'src/renderer/services/skill-executors/agent-panel-bridge.executor.ts'
  ));
  const guardedMoveDecision = buildGuardedAtomicToolExecutionDecision({
    toolName: 'moveLayer',
    params: {
      layerId: 42,
      x: 120,
      y: 80,
      relative: false,
      __designEchoTargetGuard: {
        expectedDocumentId: 999,
        expectedHistoryStateRef: { documentId: 999, historyStateId: 999 }
      }
    },
    completedToolCalls: [{
      name: 'getLayerBounds',
      arguments: { layerId: 42 },
      result: {
        success: true,
        documentId: 7,
        layerId: 42,
        bounds: { left: 0, top: 0, right: 100, bottom: 100 },
        historyStateRef: { documentId: 7, historyStateId: 11 }
      }
    }]
  });
  const guardedMoveTarget = guardedMoveDecision.executionArguments?.__designEchoTargetGuard;
  if (!guardedMoveDecision.ready
    || guardedMoveDecision.businessArguments.__designEchoTargetGuard !== undefined
    || guardedMoveTarget?.expectedDocumentId !== 7
    || guardedMoveTarget?.expectedHistoryStateRef?.historyStateId !== 11) {
    skillAtomicTargetBindingViolations.push('skill-atomic-owner:readback-did-not-replace-untrusted-guard');
  }
  const moveToDocumentRootDecision = buildGuardedAtomicToolExecutionDecision({
    toolName: 'moveLayerToGroup',
    params: { layerId: 42, targetGroupId: 0, position: 'inside' },
    completedToolCalls: [{
      name: 'getLayerBounds',
      arguments: { layerId: 42 },
      result: {
        success: true,
        documentId: 7,
        layerId: 42,
        bounds: { left: 0, top: 0, right: 100, bottom: 100 },
        historyStateRef: { documentId: 7, historyStateId: 11 }
      }
    }]
  });
  if (!moveToDocumentRootDecision.ready) {
    skillAtomicTargetBindingViolations.push('skill-atomic-owner:document-root-sentinel-treated-as-unknown-layer');
  }

  const createWithoutDocumentDecision = buildGuardedAtomicToolExecutionDecision({
    toolName: 'createDocument',
    params: { name: 'SKU.psb', width: 800, height: 800 },
    completedToolCalls: []
  });
  if (!createWithoutDocumentDecision.ready
    || createWithoutDocumentDecision.executionArguments?.__designEchoTargetGuard !== undefined) {
    skillAtomicTargetBindingViolations.push('skill-atomic-owner:document-bootstrap-was-not-preserved');
  }
  const createCommit = {
    success: true,
    documentId: 17,
    photoshopMutationCommit: {
      version: 'photoshop-mutation-commit/v1',
      basis: 'same_execute_as_modal',
      bindingStrength: 'unguarded',
      changeKind: 'document_creation',
      beforeOpenDocumentIds: [3],
      createdDocumentId: 17,
      after: { documentId: 17, historyStateId: 2, activeLayerId: null },
      toolActionCompleted: true,
      mutationObserved: true,
      documentChanged: true
    }
  };
  const writeAfterCreateDecision = buildGuardedAtomicToolExecutionDecision({
    toolName: 'createGroup',
    params: { groupName: '01 咖色' },
    completedToolCalls: [{
      name: 'createDocument',
      arguments: { name: 'SKU.psb', width: 800, height: 800 },
      result: createCommit
    }]
  });
  const writeAfterCreateGuard = writeAfterCreateDecision.executionArguments?.__designEchoTargetGuard;
  if (!writeAfterCreateDecision.ready
    || writeAfterCreateGuard?.expectedDocumentId !== 17
    || writeAfterCreateGuard?.expectedHistoryStateRef?.historyStateId !== 2) {
    skillAtomicTargetBindingViolations.push('skill-atomic-owner:create-commit-did-not-mint-next-write-binding');
  }

  const switchedWithoutReadDecision = buildGuardedAtomicToolExecutionDecision({
    toolName: 'createRectangle',
    params: { name: '占位', x: 0, y: 0, width: 100, height: 100 },
    completedToolCalls: [
      {
        name: 'getDocumentInfo',
        arguments: {},
        result: {
          success: true,
          documentId: 17,
          historyStateRef: { documentId: 17, historyStateId: 2 }
        }
      },
      {
        name: 'switchDocument',
        arguments: { documentId: 18 },
        result: { success: true, documentId: 18 }
      }
    ]
  });
  if (switchedWithoutReadDecision.ready
    || switchedWithoutReadDecision.blockedResult?.code !== 'skill_atomic_tool_execution_preflight_blocked') {
    skillAtomicTargetBindingViolations.push('skill-atomic-owner:document-barrier-reused-stale-binding');
  }
  const reboundAfterSwitchDecision = buildGuardedAtomicToolExecutionDecision({
    toolName: 'createRectangle',
    params: { name: '占位', x: 0, y: 0, width: 100, height: 100 },
    completedToolCalls: [
      {
        name: 'switchDocument',
        arguments: { documentId: 18 },
        result: { success: true, documentId: 18 }
      },
      {
        name: 'getDocumentInfo',
        arguments: {},
        result: {
          success: true,
          documentId: 18,
          historyStateRef: { documentId: 18, historyStateId: 5 }
        }
      }
    ]
  });
  const reboundAfterSwitchGuard = reboundAfterSwitchDecision.executionArguments?.__designEchoTargetGuard;
  if (!reboundAfterSwitchDecision.ready
    || reboundAfterSwitchGuard?.expectedDocumentId !== 18
    || reboundAfterSwitchGuard?.expectedHistoryStateRef?.historyStateId !== 5) {
    skillAtomicTargetBindingViolations.push('skill-atomic-owner:fresh-read-did-not-rebind-after-document-barrier');
  }
  const reboundLayerMoveDecision = buildGuardedAtomicToolExecutionDecision({
    toolName: 'moveLayerToGroup',
    params: { layerId: 52, targetGroupId: 51, position: 'inside' },
    completedToolCalls: [
      {
        name: 'switchDocument',
        arguments: { documentId: 18 },
        result: { success: true, documentId: 18 }
      },
      {
        name: 'getDocumentInfo',
        arguments: {},
        result: {
          success: true,
          documentId: 18,
          historyStateRef: { documentId: 18, historyStateId: 5 }
        }
      },
      {
        name: 'getLayerHierarchy',
        arguments: {},
        result: {
          success: true,
          documentId: 18,
          historyStateRef: { documentId: 18, historyStateId: 5 },
          layers: [{
            id: 51,
            name: '颜色组',
            kind: 'group',
            children: [{ id: 52, name: '色卡智能对象', kind: 'smartObject' }]
          }]
        }
      }
    ]
  });
  if (!reboundLayerMoveDecision.ready
    || reboundLayerMoveDecision.executionArguments?.__designEchoTargetGuard?.expectedDocumentId !== 18) {
    skillAtomicTargetBindingViolations.push('skill-atomic-owner:layer-lineage-not-restored-by-fresh-hierarchy-read');
  }
  if (!agentSkillAtomicToolExecutionText.includes('buildAgentToolExecutionPreflight({')
    || !agentSkillAtomicToolExecutionText.includes('let executionQueue: Promise<void> = Promise.resolve()')
    || !executorText.includes('createGuardedAtomicToolExecutor({')
    || !executorText.includes('guardedAtomicToolExecutor,')
    || !skillToolsText.includes('guardedAtomicToolExecutor: options.guardedAtomicToolExecutor')
    || !skuColorCardExecutorText.includes('await guardedAtomicToolExecutor(toolName, toolParams)')
    || !skuColorCardExecutorText.includes("'rebind-main-layers-after-switch'")
    || skuColorCardExecutorText.includes("import { executeToolCall } from '../tool-executor.service'")
    || !skuBatchExecutorText.includes('guardedAtomicToolExecutor')
    || !skillDeclarationsText.includes("'getDocumentInfo', 'getLayerHierarchy', 'createDocument'")) {
    skillAtomicTargetBindingViolations.push('skill-atomic-owner:harness-wiring-or-sku-migration-missing');
  }
  if (!agentPanelBridgeExecutorText.includes('guardedAtomicToolExecutor(mcpToolName, p.mcpArguments || {})')
    || !agentPanelBridgeExecutorText.includes(': callPhotoshopMcpTool(mcpToolName, p.mcpArguments || {}, { signal })')) {
    skillAtomicTargetBindingViolations.push('skill-atomic-owner:agent-panel-bridge-bypassed-guarded-executor');
  }

  const providerRecoveryDiagnosticViolations = [];
  const recoveryWindows = [0, 1, 2].map((recoveryAttempt) => (
    resolveProviderTruncationMaxTokens({ baseMaxTokens: 1200, recoveryAttempt })
  ));
  if (JSON.stringify(recoveryWindows) !== JSON.stringify([1200, 2400, 4800])) {
    providerRecoveryDiagnosticViolations.push(`provider-truncation:unexpected-windows:${JSON.stringify(recoveryWindows)}`);
  }
  const configuredHardCapWindow = resolveProviderTruncationMaxTokens({
    baseMaxTokens: 1200,
    configuredMaxTokens: 4096,
    recoveryAttempt: 2
  });
  if (configuredHardCapWindow !== 4096) {
    providerRecoveryDiagnosticViolations.push(`provider-truncation:configured-hard-cap-not-enforced:${configuredHardCapWindow}`);
  }
  const successfulToolResult = { success: true, value: 1 };
  const successfulDiagnosticResult = ensureAgentToolFailureDiagnostics({
    toolName: 'getDocumentInfo',
    result: successfulToolResult
  });
  if (successfulDiagnosticResult !== successfulToolResult
    || Object.prototype.hasOwnProperty.call(successfulToolResult, 'code')) {
    providerRecoveryDiagnosticViolations.push('tool-failure-diagnostic:successful-result-was-mutated');
  }
  const existingFailureResult = {
    success: false,
    code: 'existing_failure',
    error: '原始失败原因'
  };
  const existingFailureDiagnostic = ensureAgentToolFailureDiagnostics({
    toolName: 'moveLayer',
    result: existingFailureResult
  });
  if (existingFailureDiagnostic !== existingFailureResult
    || existingFailureResult.code !== 'existing_failure') {
    providerRecoveryDiagnosticViolations.push('tool-failure-diagnostic:identity-or-existing-code-was-lost');
  }
  const bareFailureResult = { success: false };
  const bareFailureDiagnostic = ensureAgentToolFailureDiagnostics({
    toolName: 'moveLayer',
    result: bareFailureResult
  });
  if (bareFailureDiagnostic !== bareFailureResult
    || bareFailureResult.code !== 'tool_failure_diagnostic_missing'
    || !/[\u4e00-\u9fff]/.test(String(bareFailureResult.summary || ''))) {
    providerRecoveryDiagnosticViolations.push('tool-failure-diagnostic:bare-failure-not-normalized-in-place');
  }
  const nonFatalFailureResult = { success: false, nonFatal: true };
  const cancelledFailureResult = { success: false, cancelled: true };
  ensureAgentToolFailureDiagnostics({
    toolName: 'sku-batch',
    toolKind: 'skill',
    result: nonFatalFailureResult
  });
  ensureAgentToolFailureDiagnostics({
    toolName: 'moveLayer',
    result: cancelledFailureResult
  });
  if (nonFatalFailureResult.success !== false
    || nonFatalFailureResult.nonFatal !== true
    || cancelledFailureResult.success !== false
    || cancelledFailureResult.cancelled !== true) {
    providerRecoveryDiagnosticViolations.push('tool-failure-diagnostic:nonfatal-or-cancelled-control-semantics-changed');
  }
  const templateHandoff = buildSkuTemplateDesignHandoffContract({
    missingSizes: [2, 3, 4],
    colorCount: 3
  });
  const templateRepairHandoff = buildSkuTemplateDesignHandoffContract({
    repairTargets: [{
      size: 3,
      templateName: '3双装.psb',
      expectedItemCount: 3,
      issue: '没有识别到可解析的 SKU 占位符。'
    }],
    colorCount: 3
  });
  const templateContinuationAvailableTools = [
    'sku-batch',
    ...templateHandoff.requiredReferenceObservationTools,
    ...templateHandoff.templateDesignToolNames,
    'deleteLayer'
  ];
  const rawTemplateHandoffResult = {
    success: false,
    nonFatal: true,
    error: 'SKU 模板尚未完成。',
    data: {
      status: templateHandoff.status,
      agentReActContinuation: templateHandoff.agentReActContinuation
    }
  };
  const projectedTemplateObservation = buildSkillWorkflowBridgeObservation(
    'sku-batch',
    rawTemplateHandoffResult
  );
  const projectedTemplateResult = {
    ...rawTemplateHandoffResult,
    data: {
      ...rawTemplateHandoffResult.data,
      agentReActObservation: projectedTemplateObservation
    }
  };
  const templateContinuationUpdate = resolveAgentWorkflowContinuationScopeUpdate({
    workflowEntryTools: [],
    toolCalls: [{ id: 'sku-template-handoff', name: 'sku-batch', arguments: { stage: 'full' } }],
    toolResults: [{
      callId: 'sku-template-handoff',
      output: projectedTemplateResult
    }],
    availableToolNames: templateContinuationAvailableTools
  });
  const templateContinuationTools = templateContinuationUpdate.kind === 'activate'
    ? selectAgentWorkflowContinuationToolNames({
      scope: templateContinuationUpdate.scope,
      availableToolNames: templateContinuationAvailableTools
    })
    : [];
  const templateContinuationScope = templateContinuationUpdate.kind === 'activate'
    ? templateContinuationUpdate.scope
    : undefined;
  const requiredAutonomousTemplateTools = [
    'sku-batch',
    'evaluateDesign',
    'composeDesign',
    'skuLayout',
    'switchDocument',
    'createDocument',
    'createSkuPlaceholders',
    'getCanvasSnapshot',
    'transformLayer',
    'saveDocument',
    'getAcceptanceSnapshot'
  ];
  const projectedTemplateRecoveryToolNames = readAgentReActRecoveryToolNames(
    projectedTemplateResult
  );
  if (templateContinuationUpdate.kind !== 'activate'
    || templateContinuationUpdate.scope.purpose !== 'execute'
    || templateContinuationUpdate.scope.source !== 'declared'
    || !requiredAutonomousTemplateTools.every((toolName) => (
      toolName === 'sku-batch'
      || projectedTemplateRecoveryToolNames.includes(toolName)
    ))
    || !requiredAutonomousTemplateTools.every((toolName) => templateContinuationTools.includes(toolName))
    || templateContinuationTools.includes('deleteLayer')) {
    skuAutonomousTemplateViolations.push('sku-template:declared-repair-continuation-cannot-complete-editable-template');
  }
  const inspectSkuLayoutAccess = evaluateAgentWorkflowContinuationToolAccess({
    scope: templateContinuationScope,
    toolName: 'skuLayout',
    args: { action: 'inspectTemplateLayout', templateDocName: '3双装.psb' }
  });
  const executeSkuLayoutAccess = evaluateAgentWorkflowContinuationToolAccess({
    scope: templateContinuationScope,
    toolName: 'skuLayout',
    args: { action: 'execute', combos: [['咖色', '奶白']] }
  });
  const unsafeTemplateSaveAccess = evaluateAgentWorkflowContinuationToolAccess({
    scope: templateContinuationScope,
    toolName: 'saveDocument',
    args: { path: 'E:/project/模板文件/3双装.psb' }
  });
  const versionedTemplateSaveAccess = evaluateAgentWorkflowContinuationToolAccess({
    scope: templateContinuationScope,
    toolName: 'saveDocument',
    args: {
      path: 'E:/project/模板文件/3双装-DesignEcho候选.psb',
      conflictPolicy: 'fail_if_exists'
    }
  });
  if (!inspectSkuLayoutAccess.allowed
    || !executeSkuLayoutAccess.allowed
    || unsafeTemplateSaveAccess.allowed
    || !versionedTemplateSaveAccess.allowed) {
    skuAutonomousTemplateViolations.push('sku-template:repair-argument-constraints-not-enforced');
  }
  if (!isDeclaredNonFatalAgentWorkflowHandoff({
    workflowToolName: 'sku-batch',
    output: projectedTemplateResult
  }) || isDeclaredNonFatalAgentWorkflowHandoff({
    workflowToolName: 'sku-batch',
    output: rawTemplateHandoffResult
  }) || isDeclaredNonFatalAgentWorkflowHandoff({
    workflowToolName: 'sku-batch',
    output: {
      ...projectedTemplateResult,
      cancelled: true
    }
  })) {
    skuAutonomousTemplateViolations.push('workflow-handoff:nonfatal-control-transfer-trust-boundary-invalid');
  }
  if (templateHandoff.agentReActContinuation.recovery?.purpose !== 'execute'
    || templateHandoff.message.includes('模板方向已确认')
    || /按顺序执行|项目模板目录\s*→\s*Eagle|版式起点/.test(templateHandoff.message)
    || templateHandoff.templateLayoutSuggestions.length !== 0
    || !templateRepairHandoff.message.includes('占位结构需要修复')
    || templateRepairHandoff.agentReActContinuation.recovery?.purpose !== 'repair'
    || !templateRepairHandoff.templateDesignToolNames.includes('skuLayout')
    || !templateRepairHandoff.templateDesignToolNames.includes('transformLayer')
    || !templateRepairHandoff.completionChecklist.some((item) => item.includes('重新 inspect'))) {
    skuAutonomousTemplateViolations.push('sku-template:handoff-still-claims-user-confirmation-or-observation-only');
  }
  const compactE1WorkflowOwnerViolations = [];
  const runtimeSkillHandoffViolations = [];
  const workflowContinuationSourceText = read(agentWorkflowContinuationScopePath);
  if (/buildDeterministicCompactE1WorkflowOwnerCall|selectInitialAgentWorkflowToolNames/.test(
    `${agentRuntimeText}\n${workflowContinuationSourceText}`
  ) || agentRuntimeText.includes('harness_compact_workflow_owner')) {
    compactE1WorkflowOwnerViolations.push('compact-e1-workflow-owner:harness-still-selects-or-fabricates-tool-call');
  }
  const delegationBoundaryViolations = [];
  const delegatedSkuRequest = '请自行识别产品款式与颜色，判断哪些组合适合 INS 风格、哪些适合纯色展示。';
  if (!hasExplicitReversibleDesignDecisionDelegation(delegatedSkuRequest)) {
    delegationBoundaryViolations.push('sku-delegation:real-user-request-not-recognized');
  }
  if (hasExplicitReversibleDesignDecisionDelegation('不要自行判断组合，先给我确认。')) {
    delegationBoundaryViolations.push('sku-delegation:explicit-revocation-ignored');
  }
  if (hasExplicitReversibleDesignDecisionDelegation('根据项目配置完成 2、3、4 双装 SKU。')) {
    delegationBoundaryViolations.push('sku-delegation:ordinary-production-request-promoted-to-delegation');
  }
  const bareSkuSkillParams = applySharedSkillParamDefaults({
    skillId: 'sku-batch',
    userInput: '帮我做SKU',
    mode: 'execute',
    params: { stage: 'full', userIntent: '帮我做SKU' }
  });
  if (Object.prototype.hasOwnProperty.call(bareSkuSkillParams, 'comboSizes')
    || Object.prototype.hasOwnProperty.call(bareSkuSkillParams, 'requireSkuComboConfirmation')) {
    delegationBoundaryViolations.push('sku-delegation:shared-defaults-injected-a-size-plan-or-user-confirmation');
  }
  const explicitSkuReviewParams = applySharedSkillParamDefaults({
    skillId: 'sku-batch',
    userInput: '先给我确认 SKU 组合再出图',
    mode: 'execute',
    params: { stage: 'full', userIntent: '先给我确认 SKU 组合再出图' }
  });
  const autonomousTemplateParams = applySharedSkillParamDefaults({
    skillId: 'sku-batch',
    userInput: '请单独设计一套 SKU 模板',
    mode: 'execute',
    params: { stage: 'template', userIntent: '请单独设计一套 SKU 模板' }
  });
  const explicitTemplateReviewParams = applySharedSkillParamDefaults({
    skillId: 'sku-batch',
    userInput: '先让我确认 SKU 模板方向再开始设计',
    mode: 'execute',
    params: { stage: 'template', userIntent: '先让我确认 SKU 模板方向再开始设计' }
  });
  if (Object.prototype.hasOwnProperty.call(autonomousTemplateParams, 'comboSizes')
    || Object.prototype.hasOwnProperty.call(explicitTemplateReviewParams, 'comboSizes')) {
    delegationBoundaryViolations.push('sku-delegation:template-stage-inherited-full-production-size-draft');
  }
  const {
    inferSkuIntentParamsFromText,
    isSkuAutonomousProductionDraftRequestText,
    isSkuComboReviewRequestedText,
    isSkuComboReviewSkippedText,
    isSkuTemplateReviewRequestedText,
    shouldRequestSkuComboConfirmation
  } = require(skuIntentParamsPath);
  if (!isSkuAutonomousProductionDraftRequestText('帮我做SKU')
    || isSkuComboReviewRequestedText('帮我做SKU')
    || !isSkuComboReviewRequestedText('先给我确认 SKU 组合再出图')
    || isSkuAutonomousProductionDraftRequestText('先给我确认 SKU 组合再出图')
    || !isSkuComboReviewSkippedText('SKU 组合不用确认卡，直接按当前候选做')
    || Object.prototype.hasOwnProperty.call(explicitSkuReviewParams, 'requireSkuComboConfirmation')) {
    delegationBoundaryViolations.push('sku-delegation:explicit-review-and-autonomous-production-were-not-separated');
  }
  if (isSkuTemplateReviewRequestedText('请单独设计一套 SKU 模板')
    || Object.prototype.hasOwnProperty.call(
      autonomousTemplateParams,
      'requireSkuCardTemplateDesignConfirmation'
    )
    || !isSkuTemplateReviewRequestedText('先让我确认 SKU 模板方向再开始设计')
    || Object.prototype.hasOwnProperty.call(
      explicitTemplateReviewParams,
      'requireSkuCardTemplateDesignConfirmation'
    )) {
    delegationBoundaryViolations.push('sku-delegation:template-design-and-explicit-direction-review-were-not-separated');
  }
  const skuNoteOnlyPositiveCases = [
    '帮我做自选备注而不是组合',
    '只做自选备注',
    '不要组合图，只生成自选备注',
    '我只需要自选备注，不要组合图',
    '帮我做自选备注，不做组合',
    '不要组合，只要备注图',
    '自选备注就行，不要组合',
    '组合图也要，后来不要组合图，只做自选备注',
    '先组合图也要后来只做自选备注',
    '组合图不要生成，只做备注图',
    '组合图不要删，只补自选备注',
    '不要修改已有组合图，只补自选备注'
  ];
  const skuNoteOnlyNegativeCases = [
    '不要只做自选备注，组合图也要',
    '不是只做自选备注，组合图也要',
    '组合图和自选备注都做',
    '只做组合图，不要自选备注',
    '不要漏掉组合图，自选备注也要',
    '组合图不要漏，自选备注也要',
    '组合图不要少，自选备注也要',
    '别忘了组合图，自选备注也做',
    '不要排除组合图，自选备注也要',
    '不要组合图，后来组合图也要，自选备注也做',
    '先只做自选备注后来组合图也要'
  ];
  for (const userInput of skuNoteOnlyPositiveCases) {
    const inferred = inferSkuIntentParamsFromText(userInput);
    const rebound = applySharedSkillParamDefaults({
      skillId: 'sku-batch',
      userInput,
      mode: 'execute',
      params: { stage: 'full', onlyNotes: false, generateNotes: false }
    });
    if (inferred.onlyNotes !== true
      || inferred.generateNotes !== true
      || rebound.onlyNotes !== true
      || rebound.generateNotes !== true) {
      delegationBoundaryViolations.push(`sku-note-only:explicit-note-only-request-expanded-to-combo:${userInput}`);
    }
  }
  for (const userInput of skuNoteOnlyPositiveCases.slice(0, 3)) {
    const route = fastDeterministicRoute(userInput);
    if (route?.skillId !== 'sku-batch'
      || route.skillParams?.onlyNotes !== true
      || route.skillParams?.generateNotes !== true) {
      delegationBoundaryViolations.push(`sku-note-only:explicit-request-not-routed-as-note-only:${userInput}`);
    }
  }
  const skuDeliverableRouteCases = [
    {
      userInput: '先组合图也要后来只做自选备注',
      expectedOnlyNotes: true,
      expectedGenerateNotes: true
    },
    {
      userInput: '先只做自选备注后来组合图和自选备注都做',
      expectedOnlyNotes: false,
      expectedGenerateNotes: true
    },
    {
      userInput: '先不要自选备注后来还是要自选备注，组合图也做',
      expectedOnlyNotes: false,
      expectedGenerateNotes: true
    }
  ];
  for (const routeCase of skuDeliverableRouteCases) {
    const route = fastDeterministicRoute(routeCase.userInput);
    if (route?.skillId !== 'sku-batch'
      || route.skillParams?.onlyNotes !== routeCase.expectedOnlyNotes
      || route.skillParams?.generateNotes !== routeCase.expectedGenerateNotes) {
      delegationBoundaryViolations.push(`sku-deliverable-polarity:route-dropped-final-user-relation:${routeCase.userInput}`);
    }
  }
  for (const userInput of skuNoteOnlyNegativeCases) {
    const inferred = inferSkuIntentParamsFromText(userInput);
    if (inferred.onlyNotes !== false) {
      delegationBoundaryViolations.push(`sku-note-only:mixed-or-combo-request-collapsed-to-note-only:${userInput}`);
    }
  }
  const skuDeliverablePolarityCases = [
    {
      userInput: '先不要自选备注后来还是要自选备注，组合图也做',
      expectedOnlyNotes: false,
      expectedGenerateNotes: true
    },
    {
      userInput: '先要自选备注后来不要自选备注，只做组合图',
      expectedOnlyNotes: false,
      expectedGenerateNotes: false
    },
    {
      userInput: '不要组合图，也不要自选备注',
      expectedOnlyNotes: false,
      expectedGenerateNotes: false
    },
    {
      userInput: '不要漏掉组合图，自选备注也要',
      expectedOnlyNotes: false,
      expectedGenerateNotes: true
    },
    {
      userInput: '先组合图也要后来只做自选备注',
      expectedOnlyNotes: true,
      expectedGenerateNotes: true
    },
    {
      userInput: '先不要组合图，改为组合图和自选备注都做',
      expectedOnlyNotes: false,
      expectedGenerateNotes: true
    },
    {
      userInput: '先不要自选备注，后来要组合图和自选备注',
      expectedOnlyNotes: false,
      expectedGenerateNotes: true
    },
    {
      userInput: '组合图、自选备注都不做',
      expectedOnlyNotes: false,
      expectedGenerateNotes: false
    },
    {
      userInput: '不要组合图和自选备注',
      expectedOnlyNotes: false,
      expectedGenerateNotes: false
    },
    {
      userInput: '只做组合图和自选备注',
      expectedOnlyNotes: false,
      expectedGenerateNotes: true
    },
    {
      userInput: '单独做自选备注与组合图',
      expectedOnlyNotes: false,
      expectedGenerateNotes: true
    },
    {
      userInput: '组合图和自选备注都不要删，继续做SKU',
      expectedOnlyNotes: false,
      expectedGenerateNotes: true
    },
    {
      userInput: '组合图与自选备注都不要修改，继续生成SKU',
      expectedOnlyNotes: false,
      expectedGenerateNotes: true
    },
    {
      userInput: '组合图、自选备注同时不要覆盖，再做一版SKU',
      expectedOnlyNotes: false,
      expectedGenerateNotes: true
    },
    {
      userInput: '组合图和自选备注都不要再生成',
      expectedOnlyNotes: false,
      expectedGenerateNotes: false
    },
    {
      userInput: '组合图和自选备注都不用继续做',
      expectedOnlyNotes: false,
      expectedGenerateNotes: false
    },
    {
      userInput: '组合图和自选备注都做后来组合图和自选备注都不再生成',
      expectedOnlyNotes: false,
      expectedGenerateNotes: false
    }
  ];
  for (const polarityCase of skuDeliverablePolarityCases) {
    const inferred = inferSkuIntentParamsFromText(polarityCase.userInput);
    const rebound = applySharedSkillParamDefaults({
      skillId: 'sku-batch',
      userInput: polarityCase.userInput,
      mode: 'execute',
      params: { stage: 'full', onlyNotes: false, generateNotes: false }
    });
    if (inferred.onlyNotes !== polarityCase.expectedOnlyNotes
      || inferred.generateNotes !== polarityCase.expectedGenerateNotes
      || rebound.onlyNotes !== polarityCase.expectedOnlyNotes
      || rebound.generateNotes !== polarityCase.expectedGenerateNotes) {
      delegationBoundaryViolations.push(`sku-deliverable-polarity:relation-order-or-negation-was-not-preserved:${polarityCase.userInput}`);
    }
  }
  const comboConfirmationCases = [
    {
      label: 'explicit-note-only',
      input: {
        onlyNotes: true,
        lacksAuthoritativeCombinationSpecification: true,
        userExplicitlyRequestsReview: false,
        userExplicitlySkipsReview: false,
        confirmationApproved: false
      },
      expected: false
    },
    {
      label: 'bare-candidate',
      input: {
        onlyNotes: false,
        lacksAuthoritativeCombinationSpecification: true,
        userExplicitlyRequestsReview: false,
        userExplicitlySkipsReview: false,
        confirmationApproved: false
      },
      expected: true
    },
    {
      label: 'explicit-review-with-project-plan',
      input: {
        onlyNotes: false,
        lacksAuthoritativeCombinationSpecification: false,
        userExplicitlyRequestsReview: true,
        userExplicitlySkipsReview: false,
        confirmationApproved: false
      },
      expected: true
    },
    {
      label: 'explicit-skip',
      input: {
        onlyNotes: false,
        lacksAuthoritativeCombinationSpecification: true,
        userExplicitlyRequestsReview: false,
        userExplicitlySkipsReview: true,
        confirmationApproved: false
      },
      expected: false
    },
    {
      label: 'confirmed-continuation',
      input: {
        onlyNotes: false,
        lacksAuthoritativeCombinationSpecification: true,
        userExplicitlyRequestsReview: false,
        userExplicitlySkipsReview: false,
        confirmationApproved: true
      },
      expected: false
    },
    {
      label: 'authoritative-plan',
      input: {
        onlyNotes: false,
        lacksAuthoritativeCombinationSpecification: false,
        userExplicitlyRequestsReview: false,
        userExplicitlySkipsReview: false,
        confirmationApproved: false
      },
      expected: false
    }
  ];
  for (const testCase of comboConfirmationCases) {
    if (shouldRequestSkuComboConfirmation(testCase.input) !== testCase.expected) {
      delegationBoundaryViolations.push(`sku-combo-card:${testCase.label}-decision-invalid`);
    }
  }
  const skuCombinationProvenanceResolverStart = skuBatchExecutorText.indexOf(
    'function resolveSkuCombinationProvenance(input:'
  );
  const skuCombinationProvenanceResolverEnd = skuBatchExecutorText.indexOf(
    'function formatSkuCardSourceLocation(',
    skuCombinationProvenanceResolverStart
  );
  const skuCombinationProvenanceResolverSource = skuCombinationProvenanceResolverStart >= 0
    && skuCombinationProvenanceResolverEnd > skuCombinationProvenanceResolverStart
    ? skuBatchExecutorText.slice(
      skuCombinationProvenanceResolverStart,
      skuCombinationProvenanceResolverEnd
    )
    : '';
  if (!skuCombinationProvenanceResolverSource.includes(
    'userDelegatedReversibleCombinationChoice: boolean;'
  )
    || !skuCombinationProvenanceResolverSource.includes(
      'if (input.userDelegatedReversibleCombinationChoice)'
    )
    || !skuCombinationProvenanceResolverSource.includes("source: 'agent_delegated_draft'")
    || !skuCombinationProvenanceResolverSource.includes('authoritativeBusinessFact: false')
    || !skuCombinationProvenanceResolverSource.includes('requiresReviewBeforePublishing: true')
    || !skuBatchExecutorText.includes('hasExplicitReversibleDesignDecisionDelegation(trustedUserInput)')
    || !skuBatchExecutorText.includes(
      'const skuCombinationProvenance = resolveSkuCombinationProvenance({'
    )
    || !skuBatchExecutorText.includes('userDelegatedReversibleCombinationChoice\n        });')
    || !skuBatchExecutorText.includes('const requiresSkuComboConfirmation = shouldRequestSkuComboConfirmation({')
    || skuBatchExecutorText.includes('(lacksAuthoritativeCombinationSpecification && !userDelegatedReversibleCombinationChoice)')) {
    delegationBoundaryViolations.push('sku-delegation:draft-provenance-or-trusted-user-wiring-missing');
  }
  const inlineMultimodalComposerSource = parseTsx(inlineMultimodalComposerPath);
  const appStoreText = read(appStorePath);
  const appStoreSource = parse(appStorePath);
  const messageParserText = read(messageParserPath);
  // 通用「当前版本」状态卡开关（用户 2026-08-18 要求关闭）；相关断言按开关分档。
  const executionSummaryCardDisabled = messageParserText.includes('const SHOW_EXECUTION_SUMMARY_CARD = false;');
  const chatResponseCleanerText = read(chatResponseCleanerPath);
  const messageRendererText = read(messageRendererPath);
  const messageRendererSource = parseTsx(messageRendererPath);
  const messageRendererCssText = read(messageRendererCssPath);
  const settingsModalText = read(settingsModalPath);
  const modelServiceText = read(modelServicePath);
  const codexSubscriptionServiceText = read(codexSubscriptionServicePath);
  const agentToolStreamServiceText = read(agentToolStreamServicePath);
  const resourceManagerServiceText = read(resourceManagerServicePath);
  const templateKnowledgeServiceText = read(templateKnowledgeServicePath);
  const preloadText = read(preloadPath);
  const mainIndexText = read(mainIndexPath);
  const debugBridgeServiceText = read(debugBridgeServicePath);
  const debugBridgeChatContractText = read(debugBridgeChatContractPath);
  const designReliabilityCliText = read(designReliabilityCliPath);
  const rendererTypesText = read(rendererTypesPath);
  const debugBridgePreflightSafetyViolations = [];
  if (!preloadText.includes('onDebugBridgeChatPreflight:')
    || !rendererTypesText.includes('onDebugBridgeChatPreflight?:')
    || !debugBridgeServiceText.includes('onChatSubmitPreflight')
    || !chatPanelText.includes('selectedProvider: String(selectedModel?.provider || \'\').trim()')
    || !chatPanelText.includes('selectedApiModelId: String(selectedModel?.apiModelId || \'\').trim()')
    || !chatPanelText.includes('projectPath: String(state.currentProject?.path || \'\').trim()')
    || chatPanelText.includes('apiKeys: state.apiKeys')) {
    debugBridgePreflightSafetyViolations.push(
      'debug-preflight:renderer-model-project-snapshot-is-missing-or-not-redacted'
    );
  }
  const handleSendStageIndex = chatPanelText.indexOf("executionStage = 'handle_send_started'");
  const debugReferenceScopeCallIndex = chatPanelText.indexOf(
    'await runWithDebugProjectReferenceTransportScope({',
    handleSendStageIndex
  );
  const handleSendCallIndex = chatPanelText.indexOf(
    'operation: () => handleSend({',
    debugReferenceScopeCallIndex
  );
  if (handleSendStageIndex < 0
    || debugReferenceScopeCallIndex <= handleSendStageIndex
    || handleSendCallIndex <= debugReferenceScopeCallIndex
    || !chatPanelText.slice(handleSendStageIndex, debugReferenceScopeCallIndex).includes('writePossible = true')
    || !chatPanelText.includes('return await submitAndWait();')
    || !chatPanelText.includes('return await runWithSkillBridgesSuppressed(submitAndWait);')
    || !debugBridgeChatContractText.includes("| 'before_handle_send'")
    || !mainIndexText.includes('readDebugBridgeChatExecutionFailure(payload)')
    || !preloadText.includes('readPreloadDebugBridgeChatFailureEnvelope(result)')
    || !debugBridgeServiceText.includes('error: failure.message,')) {
    debugBridgePreflightSafetyViolations.push(
      'debug-preflight:execution-stage-or-write-possibility-is-not-preserved-end-to-end'
    );
  }
  const runLivePreflightIndex = designReliabilityCliText.indexOf(
    'const preflight = await buildPreflight'
  );
  const runLiveArmedIndex = designReliabilityCliText.indexOf(
    'const armedAttempt = writeLiveAttemptEvent',
    runLivePreflightIndex
  );
  if (runLivePreflightIndex < 0
    || runLiveArmedIndex <= runLivePreflightIndex
    || !designReliabilityCliText.includes('renderer_model_mismatch')
    || !designReliabilityCliText.includes('renderer_provider_mismatch')
    || !designReliabilityCliText.includes('renderer_project_not_bound_to_fixture')
    || !designReliabilityCliText.includes('classifyUntrustedDebugBridgeFailure(error)')) {
    debugBridgePreflightSafetyViolations.push(
      'debug-preflight:run-live-arms-before-renderer-identity-or-guesses-safe-rejection'
    );
  }
  const websocketHandlersText = read(websocketHandlersPath);
  const uxpSkuLayoutSource = parse(uxpSkuLayoutPath);
  const uxpSkuLayoutText = read(uxpSkuLayoutPath);
  const skuAutoLayoutApplicationText = findFunction(
    uxpSkuLayoutSource,
    'applySkuAutoLayoutPlan'
  )?.getText(uxpSkuLayoutSource) || '';
  const skuMutationTargetAssertionText = findFunction(
    uxpSkuLayoutSource,
    'assertSkuMutationTarget'
  )?.getText(uxpSkuLayoutSource) || '';
  const skuBatchPlayResizeText = findFunction(
    uxpSkuLayoutSource,
    'batchPlayResize'
  )?.getText(uxpSkuLayoutSource) || '';
  const skuBatchPlayTranslateText = findFunction(
    uxpSkuLayoutSource,
    'batchPlayTranslate'
  )?.getText(uxpSkuLayoutSource) || '';
  const skuReadLiveLayerBoundsText = findFunction(
    uxpSkuLayoutSource,
    'readLiveSkuLayerBounds'
  )?.getText(uxpSkuLayoutSource) || '';
  const skuAssertBatchPlayCommandSucceededText = findFunction(
    uxpSkuLayoutSource,
    'assertSkuBatchPlayCommandSucceeded'
  )?.getText(uxpSkuLayoutSource) || '';
  const skuExecuteComboLayoutText = findMethod(
    uxpSkuLayoutSource,
    'executeComboLayout'
  )?.getText(uxpSkuLayoutSource) || '';
  const skuDeleteCopiedLayersText = findFunction(
    uxpSkuLayoutSource,
    'deleteCopiedSkuLayers'
  )?.getText(uxpSkuLayoutSource) || '';
  const skuBatchPlayDescriptorErrorText = findFunction(
    uxpSkuLayoutSource,
    'readSkuBatchPlayDescriptorError'
  )?.getText(uxpSkuLayoutSource) || '';
  const skuConfirmLayerAbsentText = findFunction(
    uxpSkuLayoutSource,
    'confirmSkuLayerAbsent'
  )?.getText(uxpSkuLayoutSource) || '';
  const skuRemoveConfirmedLayerIdText = findFunction(
    uxpSkuLayoutSource,
    'removeConfirmedSkuLayerId'
  )?.getText(uxpSkuLayoutSource) || '';
  const skuCreateLayerCleanupFailureText = findFunction(
    uxpSkuLayoutSource,
    'createSkuLayerCleanupFailure'
  )?.getText(uxpSkuLayoutSource) || '';
  const skuCleanupCopiedLayersText = findFunction(
    uxpSkuLayoutSource,
    'cleanupCopiedSkuLayersAfterModal'
  )?.getText(uxpSkuLayoutSource) || '';
  const skuDeleteCopiedLayerCalls = collectNodes(uxpSkuLayoutSource, (node) => (
    ts.isCallExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === 'deleteCopiedSkuLayers'
  ));
  const skuCleanupCopiedLayerCalls = collectNodes(uxpSkuLayoutSource, (node) => (
    ts.isCallExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === 'cleanupCopiedSkuLayersAfterModal'
  ));
  const uxpSkuAutoLayoutPlanText = read(uxpSkuAutoLayoutPlanPath);
  const uxpListDocumentsText = read(uxpListDocumentsPath);
  const uxpSetTextContentText = read(uxpSetTextContentPath);
  const setTextTargetPreconditionMethodStart = uxpSetTextContentText.indexOf(
    'private readTargetPreconditionError('
  );
  const setTextTargetPreconditionMethodEnd = uxpSetTextContentText.indexOf(
    'private buildTextContentFailure(',
    setTextTargetPreconditionMethodStart
  );
  const setTextTargetPreconditionMethod = setTextTargetPreconditionMethodStart >= 0
    && setTextTargetPreconditionMethodEnd > setTextTargetPreconditionMethodStart
    ? uxpSetTextContentText.slice(
      setTextTargetPreconditionMethodStart,
      setTextTargetPreconditionMethodEnd
    )
    : '';
  const setTextTargetPreconditionBoundaryComplete = (
    /this\.readTargetPreconditionError\(\s*params\s*,\s*doc\s*\)/s.test(
      uxpSetTextContentText
    )
    && /owner\.readTargetPreconditionError\(\s*input\.params\s*,\s*scope\.document\s*\)/s.test(
      uxpSetTextContentText
    )
    && /private readTargetPreconditionError\(\s*params:\s*SetTextContentParams\s*,\s*document:\s*any\s*\)/s.test(
      setTextTargetPreconditionMethod
    )
    && setTextTargetPreconditionMethod.includes('params.expectedDocumentId')
    && setTextTargetPreconditionMethod.includes('activeDocumentId !== params.expectedDocumentId')
    && setTextTargetPreconditionMethod.includes('params.expectedHistoryStateRef')
    && /sameHistoryStateRef\(\s*params\.expectedHistoryStateRef\s*,\s*readActiveHistoryStateRef\(document\)\s*\)/s.test(
      setTextTargetPreconditionMethod
    )
  );
  const {
    listSkillManifests,
    resolveSkillRuntimeManifestSelection
  } = require(path.join(
    root,
    'src',
    'shared',
    'agent-runtime-v5',
    'skill-runtime.ts'
  ));
  const {
    EXACT_PROPERTY_EXECUTION_CONTEXT_TOOLS,
    classifyAgentToolExecution,
    isAgentDocumentContextBarrier,
    isAgentPhotoshopDocumentObservation,
    isAgentReadCacheInvalidatingContext,
    normalizeExactPropertyReplacementToolCall,
    resolveAuthorizedExactPropertyReplacementExecutionScope,
    resolveExactPropertyReplacementTarget,
    resolveExactPropertyReplacementWriteToolScope
  } = require(agentToolExecutionPreflightPath);
  const {
    buildDesignDocumentRoleContext,
    evaluateCreateDocumentTargetBoundary
  } = require(designDocumentRolePath);
  const { buildToolAcceptanceVerification } = require(toolAcceptancePath);
  const {
    buildRuntimeScopedChangeVerificationRecords
  } = require(runtimeScopedChangeRecordsPath);
  const {
    evaluateScopedEditExecutionScope
  } = require(scopedEditRuntimePolicyPath);
  const {
    POLICY_GATE_REPEAT_BLOCK_LIMIT,
    createPolicyGateRepeatState,
    recordPolicyGateBlockRound,
    resolvePolicyGateBlockSignature
  } = require(policyGateRepeatGuardPath);
  const { buildTaskCompletionContract } = require(taskCompletionContractPath);
  const { buildAgentOperationLedger } = require(agentOperationLedgerPath);
  const { buildDesignTaskContractRemediationDirective } = require(designTaskPolicyPath);
  const { buildDesignVerdict, isDesignVerdictDeliverable } = require(designQualityVerdictPath);
  const {
    isDeterministicConsistencyReportFresh
  } = require(deterministicConsistencyPath);
  const {
    buildSkuTemplatePackCountRepairProposal,
    verifySkuTemplateContentConsistency
  } = require(skuTemplateContentConsistencyPath);
  const {
    buildSkuTemplateAggregatePreflightDecision,
    buildSkuTemplateLayoutPreflightFromRuntimeInspection
  } = require(skuAutoLayoutExecutorPolicyPath);
  const {
    collectSkuTemplateSizes,
    pickBestSkuTemplateCandidate,
    pickSkuTemplateCandidateWithValidatedGeneratedPriority,
    validateDesignEchoSkuTemplateCandidate
  } = require(skuTemplateSelectionPath);
  const {
    buildSkuBoundedRegionLayoutPlan,
    buildSkuExplicitSingleRowLayoutPlan,
    verifySkuAutoLayoutResult
  } = require(uxpSkuAutoLayoutPlanPath);
  const {
    buildSkuExpectedExportInventory,
    buildSkuExportReadback,
    evaluateSkuRequestedOutputCompletion,
    resolveSkuBatchDeliveryOutcome,
    sanitizeSkuToolResultsForPublicResult
  } = require(skuExportReadbackPath);
  const {
    buildSkuColorCardUniformScalePlacementReceipt
  } = require(skuColorCardContractPath);
  const {
    DESIGN_EVALUATION_RESULT_ADAPTER_CONTRIBUTIONS
  } = require(path.join(
    root,
    'src',
    'shared',
    'agent-runtime-v5',
    'design-evaluation-result-adapter-contributions.ts'
  ));
  const {
    buildSkuDeliverySummary,
    isSkuDeliveryPresentationSummary
  } = require(skuDeliverySummaryPath);
  const { convertLegacyMessage } = require(messageParserPath);
  const { buildSkillRoutingRecommendation } = require(skillRoutingPath);
  const {
    buildAgentIntentControlPlaneDecision,
    buildAutonomousExecutionDecisionForEngine,
    extractExplicitUserCapabilityConstraint
  } = require(path.join(
    root,
    'src',
    'shared',
    'agent-intent-control-plane.ts'
  ));
  const {
    resolveAgentTaskProgressIdentity,
    resolveAgentTaskSpeechAct
  } = require(taskProgressIdentityPath);
  const {
    buildAgentRunRecord,
    validateAgentRunRecordForPersist
  } = require(agentRunRecordPath);
  const { buildRunRecordResumeBrief } = require(agentRunResumePath);
  const { resolveAutonomousCapabilityRuntime } = require(executorPath);
  const {
    getSkillInternalToolOwnerIds,
    getSkillInternalToolNames,
    isSkillProviderInteractionOwner
  } = require(skillDeclarationsPath);
  const { buildSkuColorCardSourceReceipt } = require(skuArtifactRolesPath);
  const { evaluateDesignAssetAutoPlacement } = require(designPlacementIntelligencePath);
  const {
    buildChatComposerModelText,
    buildChatComposerPlainText,
    normalizeChatComposerContentParts,
    stripChatComposerReferenceMarkers
  } = require(chatComposerContentPath);
  const {
    EAGLE_COMPOSER_DRAG_MAX_BYTES,
    EAGLE_COMPOSER_DRAG_MIME,
    EAGLE_COMPOSER_DRAG_VERSION,
    normalizeEagleComposerAssetRefs,
    parseEagleComposerDragPayload,
    serializeEagleComposerDragPayload
  } = require(eagleComposerTransferPath);
  const { EagleReadonlyKnowledgeService } = require(eagleReadonlyKnowledgeServicePath);
  const {
    preserveJpegQualityAcrossToolRedirect
  } = require(jpegExportQualitySemanticsPath);
  const {
    createPublicPlanPhotoshopAdapter
  } = require(publicPlanPhotoshopAdapterPath);
  const { resolveDetailAssetUsageDecision } = require(detailPageAssetRankerPath);
  const { buildDetailPageAgentIntake } = require(detailPageAgentIntakePath);
  const { buildProjectAssetIndex } = require(projectAssetIndexPath);
  const {
    buildProjectContactSheetCandidateCoverage,
    buildProjectImageAnalysisCloseupPlan,
    buildProjectVisualSamplingPlan,
    buildProjectVisualSamplingCacheKey,
    cacheStatusForEntry,
    projectVisualCacheEntryMatchesCurrentAsset,
    reconcileProjectContactSheetCandidateCoverage,
    selectDiverseProjectVisualCandidates
  } = require(visualSamplingPath);
  const {
    DESIGN_ASSERTIONS,
    buildVlmJudgeDiagnosisRepairPrompt,
    buildVlmJudgeContextMessage,
    buildVlmJudgeSystemPrompt,
    evaluateVlmJudgeDiagnosisCoverage,
    getVlmJudgeAssertions,
    isReliableVlmJudgeBatchComplete,
    mergeVlmJudgeDiagnosisRepairs,
    parseVlmJudgeDiagnosisRepairResponse,
    parseVlmJudgeResponse,
    scoreDesignAssertions
  } = require(designQualityAssertionPath);
  const {
    extractFreshDesignSurfaceSnapshotFromToolResults
  } = require(designSurfaceSnapshotNormalizerPath);
  const {
    appendMutationBoundDesignIntent,
    formatMutationBoundDesignIntentForReview
  } = require(mutationBoundDesignIntentPath);
  const {
    projectDesignFinalReviewStructureVerification
  } = require(designFinalReviewEvidencePath);
  const {
    decideQualityAwareReflexionReentry,
    evaluateCompletedReflexionWriteFreshness,
    evaluateReflexionReviewProvenance,
    isCompletedAestheticImprovementHandoff,
    shouldStopWarningOnlyNeedsReviewReflexion
  } = require(reflexionReentryPolicyPath);
  const { buildReflexionHandoffFromReviewReport } = require(runtimeReflexionContractPath);
  const { buildRuntimeStagePlan } = require(runtimeStagePlanPath);
  const {
    applyRuntimeStageEvaluation,
    buildRuntimeStageStateFromEvaluation
  } = require(runtimeStageStatePath);
  const {
    acknowledgeRuntimeSessionWorkflowDocumentReobservation,
    advanceRuntimeSessionGeneration,
    beginRuntimeSessionNodeExecution,
    bindRuntimeSessionActionPlan,
    createRuntimeSession,
    createRuntimeSessionIdentity,
    evaluateRuntimeSessionToolExecutionGate,
    finalizeRuntimeSession,
    observeRuntimeSessionDocumentRevision,
    projectRuntimeSessionCompletion,
    readRuntimeSessionPerformanceUsage,
    recordRuntimeSessionPerformanceUsage,
    reconcileRuntimeSessionDocumentRevision,
    releaseRuntimeTaskRunWriterBinding,
    suspendRuntimeSessionForInteraction,
    synchronizeRuntimeSessionActionPlanNodes
  } = require(runtimeSessionPath);
  const {
    resolveInteractiveContinuationOperationRequest,
    resolvePendingInteractiveContinuationPauseRevision
  } = require(pendingInteractiveContinuationPath);
  const pendingInteractiveContinuationText = read(pendingInteractiveContinuationPath);
  const interactiveContinuationOperationText = read(interactiveContinuationOperationPath);
  const {
    buildInteractiveCardSubmissionFingerprint,
    buildInteractiveIntegrityFingerprint,
    stableInteractiveCardHash
  } = require(interactiveCardContractPath);
  const {
    buildAgentRuntimeProgressKey,
    buildUnfinishedContinuationKey,
    isBareAgentCompletionClaim
  } = require(agentRuntimeLivenessPolicyPath);
  const {
    AgentReadResultCache,
    buildAgentRevisionScopedReadCacheParams,
    buildCachedReadResult,
    isAgentReadResultCacheHit,
    isCacheableReadTool
  } = require(agentReadResultCachePath);
  const {
    DETAIL_PAGE_SCOPED_EDIT_EVALUATION_PROFILE_ID,
    MAIN_IMAGE_EVALUATION_PROFILE_ID,
    SKU_BATCH_EVALUATION_PROFILE_ID,
    evaluateDesignEvaluationProfile,
    getDesignEvaluationProfileById,
    getDesignEvaluationProfileScoringAssertions,
    getDesignEvaluationProfileVlmAssertions
  } = require(designEvaluationProfilesPath);
  const directPlacementCandidate = {
    score: 88,
    visualObserved: true,
    directUseSuitability: 'suitable',
    sourceTreatment: 'clip_to_container'
  };
  const strongDirectPlacementDecision = evaluateDesignAssetAutoPlacement({
    mode: 'auto',
    designRole: 'detail-page-hero',
    minScore: 72,
    minMargin: 8,
    candidates: [directPlacementCandidate, { ...directPlacementCandidate, score: 76 }]
  });
  const unobservedPlacementDecision = evaluateDesignAssetAutoPlacement({
    mode: 'auto',
    designRole: 'detail-page-hero',
    minScore: 72,
    minMargin: 8,
    candidates: [{
      score: 91,
      visualObserved: false,
      directUseSuitability: 'unsuitable',
      sourceTreatment: 'requires_visual_review'
    }]
  });
  const recompositionPlacementDecision = evaluateDesignAssetAutoPlacement({
    mode: 'auto',
    designRole: 'detail-page-hero',
    minScore: 72,
    minMargin: 8,
    candidates: [{
      score: 92,
      visualObserved: true,
      directUseSuitability: 'conditional',
      sourceTreatment: 'matte_and_recompose'
    }]
  });
  const ambiguousPlacementDecision = evaluateDesignAssetAutoPlacement({
    mode: 'auto',
    designRole: 'detail-page-hero',
    minScore: 72,
    minMargin: 8,
    candidates: [directPlacementCandidate, { ...directPlacementCandidate, score: 84 }]
  });
  const unprovenForcePlacementDecision = evaluateDesignAssetAutoPlacement({
    mode: 'force',
    designRole: 'detail-page-hero',
    minScore: 72,
    minMargin: 8,
    candidates: [directPlacementCandidate]
  });
  const userDirectedForcePlacementDecision = evaluateDesignAssetAutoPlacement({
    mode: 'force',
    designRole: 'detail-page-hero',
    minScore: 72,
    minMargin: 8,
    candidates: [directPlacementCandidate],
    forceDecisionSource: 'user',
    forceReason: '用户明确指定使用该素材作为首屏主体图'
  });
  const forgedForcePlacementDecision = evaluateDesignAssetAutoPlacement({
    mode: 'force',
    designRole: 'detail-page-hero',
    minScore: 72,
    minMargin: 8,
    candidates: [{
      score: 99,
      visualObserved: false,
      directUseSuitability: 'unsuitable',
      sourceTreatment: 'requires_visual_review'
    }],
    forceDecisionSource: 'user',
    forceReason: '模型声称用户已经选择'
  });
  const harnessReceiptForcePlacementDecision = evaluateDesignAssetAutoPlacement({
    mode: 'force',
    designRole: 'detail-page-hero',
    minScore: 72,
    minMargin: 8,
    candidates: [{
      score: 1,
      visualObserved: false,
      directUseSuitability: 'unsuitable',
      sourceTreatment: 'requires_visual_review'
    }],
    forceSelectionReceipt: {
      authority: 'harness',
      receiptId: 'user-selection-receipt-1',
      source: 'user',
      reason: '用户通过受控素材选择卡确认该文件'
    }
  });
  const visualCacheNowMs = Date.parse('2026-08-10T04:00:00.000Z');
  const currentVisualAssetVersion = { modifiedTimeMs: 1000, sizeBytes: 2048 };
  const currentVisualCacheEntry = {
    cacheKey: 'project-visual:current',
    path: 'C:/project/current.jpg',
    assetVersion: currentVisualAssetVersion,
    updatedAt: '2026-08-10T03:00:00.000Z',
    expiresAt: '2026-08-11T03:00:00.000Z',
    insight: {
      assetId: 'asset-1',
      path: 'C:/project/current.jpg',
      summary: '已观察当前素材',
      productType: '袜子'
    }
  };
  const expiredVisualCacheEntry = {
    ...currentVisualCacheEntry,
    expiresAt: '2026-08-10T03:30:00.000Z'
  };
  const changedVisualAssetVersion = { modifiedTimeMs: 2000, sizeBytes: 2048 };
  const visualCacheKeyBeforeEdit = buildProjectVisualSamplingCacheKey({
    id: 'asset-1', path: 'C:/project/current.jpg', role: 'raw-product-still',
    sizeBytes: 2048, modifiedTimeMs: 1000, width: 1000, height: 1000
  });
  const visualCacheKeyAfterEdit = buildProjectVisualSamplingCacheKey({
    id: 'asset-1', path: 'C:/project/current.jpg', role: 'raw-product-still',
    sizeBytes: 2048, modifiedTimeMs: 2000, width: 1000, height: 1000
  });
  const projectImageAnalysisCandidates = [
    {
      path: 'C:/project/产品/模特/001.jpg',
      relativePath: '产品/模特/001.jpg',
      folderType: '模特',
      imageType: 'model'
    },
    {
      path: 'C:/project/产品/模特/002.jpg',
      relativePath: '产品/模特/002.jpg',
      folderType: '模特',
      imageType: 'model'
    },
    {
      path: 'C:/project/产品/平铺/001.jpg',
      relativePath: '产品/平铺/001.jpg',
      folderType: '平铺',
      imageType: 'product'
    },
    {
      path: 'C:/project/产品/平铺/002.jpg',
      relativePath: '产品/平铺/002.jpg',
      folderType: '平铺',
      imageType: 'product'
    },
    {
      path: 'C:/project/产品/细节/001.jpg',
      relativePath: '产品/细节/001.jpg',
      folderType: '细节',
      imageType: 'detail'
    }
  ];
  const resolvedContactSheetPlan = buildProjectImageAnalysisCloseupPlan({
    candidates: projectImageAnalysisCandidates,
    contactSheetSucceeded: true,
    contactSheetResolutionStatus: 'resolved',
    scenario: 'sku',
    requestedSampleSize: 12,
    authoritativeMaxCandidates: 4
  });
  const requestedContactSheetPlan = buildProjectImageAnalysisCloseupPlan({
    candidates: projectImageAnalysisCandidates,
    contactSheetRequestedCandidates: projectImageAnalysisCandidates,
    contactSheetSucceeded: true,
    contactSheetResolutionStatus: 'ambiguous',
    scenario: 'sku',
    requestedSampleSize: 12,
    authoritativeMaxCandidates: 4
  });
  const fallbackContactSheetPlan = buildProjectImageAnalysisCloseupPlan({
    candidates: projectImageAnalysisCandidates,
    contactSheetSucceeded: false,
    scenario: 'sku',
    requestedSampleSize: 12,
    authoritativeMaxCandidates: 4
  });
  const hardLimitedContactSheetPlan = buildProjectImageAnalysisCloseupPlan({
    candidates: projectImageAnalysisCandidates,
    contactSheetRequestedCandidates: projectImageAnalysisCandidates,
    contactSheetSucceeded: true,
    contactSheetResolutionStatus: 'ambiguous',
    scenario: 'sku',
    requestedSampleSize: 12,
    authoritativeMaxCandidates: 2
  });
  const diverseNumericFilenameSelection = selectDiverseProjectVisualCandidates(
    projectImageAnalysisCandidates,
    2
  );
  const fullBucketSpanCandidates = Array.from({ length: 9 }, (_, index) => ({
    path: `C:/project/6049/平铺/${String(index + 1).padStart(3, '0')}.jpg`,
    relativePath: `6049/平铺/${String(index + 1).padStart(3, '0')}.jpg`,
    folderType: '平铺',
    imageType: 'product'
  }));
  const fullBucketSpanSelection = selectDiverseProjectVisualCandidates(
    fullBucketSpanCandidates,
    4
  );
  const reversedBucketSpanSelection = selectDiverseProjectVisualCandidates(
    [...fullBucketSpanCandidates].reverse(),
    4
  );
  const sampledContactSheetCoverage = buildProjectContactSheetCandidateCoverage({
    candidateUniverseCount: fullBucketSpanCandidates.length,
    displayedCandidateCount: fullBucketSpanSelection.length,
    universeScope: 'project_scan'
  });
  const completeContactSheetCoverage = buildProjectContactSheetCandidateCoverage({
    candidateUniverseCount: 4,
    attemptedCandidateCount: 4,
    displayedCandidateCount: 4,
    universeScope: 'provided_candidates'
  });
  const failedTileContactSheetCoverage = reconcileProjectContactSheetCandidateCoverage({
    plannedCoverage: completeContactSheetCoverage,
    renderedItems: [
      { status: 'rendered' },
      { status: 'failed' },
      { status: 'rendered' },
      { status: 'rendered' }
    ],
    sheetAvailable: true
  });
  const realSkuSamplingFiles = [
    ...Array.from({ length: 20 }, (_, index) => ({
      path: `C:/project/6049/模特场景/${String(index + 1).padStart(3, '0')}.jpg`,
      relativePath: `6049/模特场景/${String(index + 1).padStart(3, '0')}.jpg`,
      name: `${String(index + 1).padStart(3, '0')}.jpg`
    })),
    ...Array.from({ length: 21 }, (_, index) => ({
      path: `C:/project/6049/平铺细节/${String(index + 1).padStart(3, '0')}.jpg`,
      relativePath: `6049/平铺细节/${String(index + 1).padStart(3, '0')}.jpg`,
      name: `${String(index + 1).padStart(3, '0')}.jpg`
    }))
  ];
  const realSkuAssetIndex = buildProjectAssetIndex({
    projectPath: 'C:/project',
    projectName: '真实三款袜子项目',
    files: realSkuSamplingFiles
  });
  const realSkuSamplingPlan = buildProjectVisualSamplingPlan({
    assetIndex: realSkuAssetIndex,
    scenario: 'sku',
    maxCandidates: 4,
    nowIso: '2026-08-11T12:00:00.000Z'
  });
  const realGeneralSamplingPlan = buildProjectVisualSamplingPlan({
    assetIndex: realSkuAssetIndex,
    scenario: 'general-design',
    maxCandidates: 4,
    nowIso: '2026-08-11T12:00:00.000Z'
  });
  const detailHeroPlan = { screenRole: 'hero', imageStrategy: 'hero' };
  const whiteStudioHeroDecision = resolveDetailAssetUsageDecision({
    path: 'white-studio.jpg',
    type: 'product',
    visionSignal: {
      visualObserved: true,
      assetNature: 'raw_photo',
      shotType: 'flat_lay',
      backgroundType: 'white_studio',
      mainImageSuitability: 'suitable'
    }
  }, detailHeroPlan);
  const sceneHeroDecision = resolveDetailAssetUsageDecision({
    path: 'on-model-scene.jpg',
    type: 'model',
    visionSignal: {
      visualObserved: true,
      assetNature: 'raw_photo',
      shotType: 'on_model',
      backgroundType: 'scene'
    }
  }, detailHeroPlan);
  const detailOnlyHeroDecision = resolveDetailAssetUsageDecision({
    path: 'material-closeup.jpg',
    type: 'detail',
    visionSignal: {
      visualObserved: true,
      assetNature: 'raw_photo',
      shotType: 'detail_closeup',
      backgroundType: 'scene'
    }
  }, detailHeroPlan);
  const finishedDesignHeroDecision = resolveDetailAssetUsageDecision({
    path: 'finished-main-image.jpg',
    type: 'product',
    visionSignal: {
      visualObserved: true,
      assetNature: 'finished_design',
      backgroundType: 'designed_composite'
    }
  }, detailHeroPlan);
  const unobservedHeroDecision = resolveDetailAssetUsageDecision({
    path: 'metadata-only.jpg',
    type: 'product'
  }, detailHeroPlan);
  const whiteStudioComparisonDecision = resolveDetailAssetUsageDecision({
    path: 'white-studio-product-card.jpg',
    type: 'product',
    visionSignal: {
      visualObserved: true,
      assetNature: 'raw_photo',
      shotType: 'flat_lay',
      backgroundType: 'white_studio',
      mainImageSuitability: 'suitable'
    }
  }, {
    screenRole: 'parameter',
    imageStrategy: 'comparison',
    requiresModelDecision: false
  });
  const whiteStudioUndecidedSupportingDecision = resolveDetailAssetUsageDecision({
    path: 'white-studio-undecided.jpg',
    type: 'product',
    visionSignal: {
      visualObserved: true,
      assetNature: 'raw_photo',
      shotType: 'other',
      backgroundType: 'white_studio'
    }
  }, {
    screenRole: 'selling-point',
    imageStrategy: 'context',
    requiresModelDecision: false
  });
  const missingScreenDecision = resolveDetailAssetUsageDecision({
    path: 'observed-scene-without-role.jpg',
    type: 'background',
    visionSignal: {
      visualObserved: true,
      assetNature: 'raw_photo',
      shotType: 'scene',
      backgroundType: 'scene'
    }
  });
  const unresolvedScreenDecision = resolveDetailAssetUsageDecision({
    path: 'observed-scene-with-ambiguous-role.jpg',
    type: 'background',
    visionSignal: {
      visualObserved: true,
      assetNature: 'raw_photo',
      shotType: 'scene',
      backgroundType: 'scene'
    }
  }, {
    screenRole: 'hero',
    imageStrategy: 'hero',
    requiresModelDecision: true
  });
  const typeCharacterAssertion = DESIGN_ASSERTIONS.find((item) => item.id === 'type.character');
  const alignmentAssertion = DESIGN_ASSERTIONS.find((item) => item.id === 'comp.alignment');
  const structureIntentAssertion = DESIGN_ASSERTIONS.find((item) => (
    item.id === 'craft.structure-intent-coherence'
  ));
  const aestheticProtocolViolations = [];
  if (!typeCharacterAssertion || !alignmentAssertion || !structureIntentAssertion) {
    aestheticProtocolViolations.push('assertion-catalog:required-fixtures-missing');
  } else {
    const legacyPassResults = parseVlmJudgeResponse(JSON.stringify([
      {
        id: typeCharacterAssertion.id,
        applicable: true,
        pass: true,
        score: 0.8,
        confidence: 0.92,
        reason: '文字关系仍可改进'
      },
      {
        id: alignmentAssertion.id,
        applicable: true,
        pass: false,
        score: 0.9,
        confidence: 0.91,
        reason: '对齐关系服务版式'
      }
    ]), [typeCharacterAssertion, alignmentAssertion]);
    const legacyTypeResult = legacyPassResults.find((item) => item.id === typeCharacterAssertion.id);
    const legacyAlignmentResult = legacyPassResults.find((item) => item.id === alignmentAssertion.id);
    if (legacyTypeResult?.status !== 'needs_review' || legacyTypeResult?.score !== 0.8) {
      aestheticProtocolViolations.push('legacy-pass:true-overrode-score:0.8');
    }
    if (legacyAlignmentResult?.status !== 'pass' || legacyAlignmentResult?.score !== 0.9) {
      aestheticProtocolViolations.push('legacy-pass:false-overrode-score:0.9');
    }

    const scorelessResults = parseVlmJudgeResponse(JSON.stringify([{
      id: alignmentAssertion.id,
      applicable: true,
      confidence: 0.95,
      reason: '缺少可靠数值评分'
    }]), [alignmentAssertion]);
    const scorelessScorecard = scoreDesignAssertions(scorelessResults, {
      assertions: [alignmentAssertion],
      minCoverage: 0.8
    });
    if (scorelessResults[0]?.status !== 'needs_review'
      || scorelessResults[0]?.score !== undefined
      || scorelessScorecard.coverage.evaluated !== 0
      || scorelessScorecard.coverage.ratio !== 0
      || scorelessScorecard.gate !== 'incomplete_verification') {
      aestheticProtocolViolations.push('scoreless-needs-review-contaminated-numeric-coverage');
    }

    const allowedNaResults = parseVlmJudgeResponse(JSON.stringify([{
      id: typeCharacterAssertion.id,
      applicable: false,
      confidence: 0.94,
      reason: '画面无文字且 Brief 不要求文字'
    }]), [typeCharacterAssertion]);
    const disallowedNaResults = parseVlmJudgeResponse(JSON.stringify([{
      id: alignmentAssertion.id,
      applicable: false,
      confidence: 0.94,
      reason: '错误地逃避通用构图评价'
    }]), [alignmentAssertion]);
    const allNaScorecard = scoreDesignAssertions(allowedNaResults, {
      assertions: [typeCharacterAssertion],
      minCoverage: 0.8
    });
    if (allowedNaResults[0]?.status !== 'not_applicable'
      || !isReliableVlmJudgeBatchComplete(allowedNaResults, [typeCharacterAssertion])) {
      aestheticProtocolViolations.push('allowed-not-applicable-was-not-reliable');
    }
    if (disallowedNaResults[0]?.status !== 'needs_review') {
      aestheticProtocolViolations.push('disallowed-not-applicable-bypassed-evaluation');
    }
    if (allNaScorecard.passed
      || allNaScorecard.gate !== 'incomplete_verification'
      || allNaScorecard.coverage.notApplicable !== 1) {
      aestheticProtocolViolations.push('all-not-applicable-auto-passed');
    }

    const judgePrompt = buildVlmJudgeSystemPrompt([typeCharacterAssertion, alignmentAssertion]);
    if (!judgePrompt.includes('最多只给 3 个')
      || !judgePrompt.includes('若存在 score<0.85 的适用项')
      || !judgePrompt.includes('只有全部适用项 score>=0.85 时才可以不返回 diagnosis')
      || !judgePrompt.includes('不要另返 pass 字段')
      || !judgePrompt.includes('商品可识别、照片清晰或没有破图只是基础条件')
      || !judgePrompt.includes('evidenceRefs 原样列出已消费的 concern evidenceId')
      || !judgePrompt.includes('final_bound_supporting_source')
      || judgePrompt.includes('selected_source')
      || !judgePrompt.includes('真实使用尺寸与观看情境')
      || !judgePrompt.includes('不要因为小字、边缘或间距更容易描述')) {
      aestheticProtocolViolations.push('judge-prompt-lost-single-score-or-top-three-diagnosis-contract');
    }
    const taskNeutralJudgeAssertionIds = getVlmJudgeAssertions().map((item) => item.id);
    if (!taskNeutralJudgeAssertionIds.includes('impact.squint')
      || !taskNeutralJudgeAssertionIds.includes('comp.subject-ratio')
      || !taskNeutralJudgeAssertionIds.includes('craft.asset-integration')
      || !taskNeutralJudgeAssertionIds.includes('craft.structure-intent-coherence')
      || taskNeutralJudgeAssertionIds.includes('sell.visualized')
      || taskNeutralJudgeAssertionIds.includes('overall.above-baseline')) {
      aestheticProtocolViolations.push('task-neutral-judge-lost-delivery-size-effectiveness-boundary');
    }
    const structureConcernRef = 'structure:abandoned-visible-content-after-failed-clear:document-90:layer-4';
    const missingStructureEvidence = parseVlmJudgeResponse(JSON.stringify([{
      id: structureIntentAssertion.id,
      applicable: true,
      score: 0.96,
      confidence: 0.96,
      reason: '结构与画面一致'
    }]), [structureIntentAssertion], {
      requiredEvidenceRefsByAssertion: {
        [structureIntentAssertion.id]: [structureConcernRef]
      }
    });
    const consumedStructureEvidence = parseVlmJudgeResponse(JSON.stringify([{
      id: structureIntentAssertion.id,
      applicable: true,
      score: 0.72,
      confidence: 0.95,
      reason: '残留文字不承担明确画面作用',
      evidenceRefs: [structureConcernRef]
    }]), [structureIntentAssertion], {
      requiredEvidenceRefsByAssertion: {
        [structureIntentAssertion.id]: [structureConcernRef]
      }
    });
    if (missingStructureEvidence[0]?.status !== 'needs_review'
      || missingStructureEvidence[0]?.score !== undefined
      || consumedStructureEvidence[0]?.status !== 'needs_review'
      || consumedStructureEvidence[0]?.score !== 0.72
      || !consumedStructureEvidence[0]?.evidenceRefs?.includes(structureConcernRef)) {
      aestheticProtocolViolations.push('structure-concern-could-be-ignored-by-canonical-judge');
    }
    const acceptanceSurface = extractFreshDesignSurfaceSnapshotFromToolResults([{
      name: 'createDocument',
      arguments: { width: 1440, height: 1440 },
      result: { success: true, historyStateRef: { documentId: 90, historyStateId: 96 } }
    }, {
      name: 'getAcceptanceSnapshot',
      arguments: { includeHidden: true, includeBounds: true, includeText: true },
      result: {
        success: true,
        hasDocument: true,
        historyStateRef: { documentId: 90, historyStateId: 97 },
        document: { id: 90, width: 1440, height: 1440 },
        summary: { totalLayers: 1, truncated: false },
        layers: [{
          id: 4,
          name: '说明',
          kind: 'text',
          visible: true,
          locked: false,
          depth: 0,
          index: 0,
          parentId: null,
          parentName: null,
          path: '说明',
          selected: false,
          bounds: { left: 10, top: 10, right: 20, bottom: 12, width: 10, height: 2 },
          text: { content: '保留真实结构事实', length: 8, style: { fontSize: 1 } }
        }]
      }
    }], {
      requiredHistoryStateRef: { documentId: 90, historyStateId: 97 }
    });
    if (acceptanceSurface?.canvas.width !== 1440
      || acceptanceSurface?.layers[0]?.kind !== 'text'
      || acceptanceSurface?.layers[0]?.fontSize !== 1) {
      aestheticProtocolViolations.push('acceptance-snapshot-did-not-feed-final-structure-measurement');
    }
    const wrappedAcceptanceSurface = extractFreshDesignSurfaceSnapshotFromToolResults([{
      name: 'createDocument',
      arguments: { width: 1440, height: 1440 },
      result: { success: true, historyStateRef: { documentId: 91, historyStateId: 96 } }
    }, {
      name: 'getAcceptanceSnapshot',
      arguments: { includeHidden: true, includeBounds: true, includeText: true },
      result: {
        success: true,
        historyStateRef: { documentId: 91, historyStateId: 97 },
        snapshot: {
          success: true,
          hasDocument: true,
          historyStateRef: { documentId: 91, historyStateId: 97 },
          document: { id: 91, width: 1440, height: 1440 },
          summary: { totalLayers: 1, truncated: false },
          layers: [{
            id: 5,
            name: '包装层中的说明',
            kind: 'text',
            visible: true,
            locked: false,
            depth: 0,
            index: 0,
            parentId: null,
            parentName: null,
            path: '包装层中的说明',
            selected: false,
            bounds: { left: 12, top: 12, right: 32, bottom: 16, width: 20, height: 4 },
            text: { content: '包装结果也应进入测量', length: 10, style: { fontSize: 2 } }
          }]
        }
      }
    }], {
      requiredHistoryStateRef: { documentId: 91, historyStateId: 97 }
    });
    if (wrappedAcceptanceSurface?.canvas.width !== 1440
      || wrappedAcceptanceSurface?.layers[0]?.kind !== 'text'
      || wrappedAcceptanceSurface?.layers[0]?.fontSize !== 2) {
      aestheticProtocolViolations.push('wrapped-acceptance-snapshot-did-not-feed-final-structure-measurement');
    }
    const boundIntents = appendMutationBoundDesignIntent({
      current: [],
      modelTurn: 3,
      publicText: '我保留摄影关系，只调整裁切与标题层级。',
      toolCalls: [
        { id: 'read-1', name: 'getDocumentInfo', arguments: {} },
        { id: 'write-1', name: 'setTextStyle', arguments: { layerId: 4, fontSize: 96 } }
      ],
      toolResults: [
        { callId: 'read-1', success: true, output: { success: true } },
        {
          callId: 'write-1',
          success: true,
          output: {
            success: true,
            photoshopHistoryTransition: {
              version: 'photoshop-history-transition/v1',
              basis: 'acceptance_snapshot_pair',
              before: { documentId: 90, historyStateId: 97 },
              after: { documentId: 90, historyStateId: 98 },
              mutationObserved: true,
              documentChanged: false
            }
          }
        }
      ]
    });
    if (boundIntents.length !== 1
      || boundIntents[0]?.committedCalls.map((call) => call.callId).join(',') !== 'write-1'
      || boundIntents[0]?.committedCalls[0]?.target.documentId !== 90
      || boundIntents[0]?.committedCalls[0]?.target.historyStateId !== 98
      || !formatMutationBoundDesignIntentForReview(boundIntents, 90).includes('保留摄影关系')) {
      aestheticProtocolViolations.push('public-design-intent-was-not-bound-to-real-mutation');
    }
    const uncommittedIntent = appendMutationBoundDesignIntent({
      current: [],
      modelTurn: 4,
      publicText: '这一轮只分析方向，没有真实写入。',
      toolCalls: [
        { id: 'delegate-1', name: 'delegateToAgent', arguments: { role: 'design-strategist' } }
      ],
      toolResults: [
        { callId: 'delegate-1', success: true, output: { success: true, report: '完成分析' } }
      ]
    });
    if (uncommittedIntent.length !== 0) {
      aestheticProtocolViolations.push('public-design-intent-accepted-without-host-mutation-proof');
    }
    const diagnosisAssertions = DESIGN_ASSERTIONS
      .filter((item) => item.method === 'vlm_judge')
      .slice(0, 4);
    const diagnosisScores = [0.6, 0.3, 0.5, 0.4];
    const overDiagnosedResults = parseVlmJudgeResponse(JSON.stringify(
      diagnosisAssertions.map((assertion, index) => ({
        id: assertion.id,
        applicable: true,
        score: diagnosisScores[index],
        confidence: 0.95,
        reason: `问题 ${index + 1}`,
        diagnosis: {
          visualFinding: {
            scope: 'global',
            target: `区域 ${index + 1}`,
            description: '可见关系需要微调',
            relationship: '当前关系削弱目标表达',
            affectedRoles: ['subject']
          },
          causalExplanation: {
            goalRelation: 'conflicts',
            mechanism: '使当前目标的识别顺序变弱'
          },
          revision: {
            action: '只调整这一处关系',
            expectedEffect: '目标更清晰',
            preserve: ['保留其它已成立关系'],
            verify: ['复核调整区域']
          }
        }
      }))
    ), diagnosisAssertions);
    const diagnosedResults = overDiagnosedResults.filter((item) => Boolean(item.diagnosis));
    const highestScoreId = diagnosisAssertions[0]?.id;
    if (diagnosedResults.length !== 3
      || diagnosedResults.some((item) => item.id === highestScoreId)) {
      aestheticProtocolViolations.push('parser-did-not-enforce-top-three-diagnosis-boundary');
    }
    const repairMissingResults = parseVlmJudgeResponse(JSON.stringify(
      diagnosisAssertions.map((assertion, index) => ({
        id: assertion.id,
        applicable: true,
        score: diagnosisScores[index],
        confidence: 0.95,
        reason: `冻结问题 ${index + 1}`
      }))
    ), diagnosisAssertions);
    const missingDiagnosisCoverage = evaluateVlmJudgeDiagnosisCoverage(
      repairMissingResults,
      diagnosisAssertions
    );
    const expectedRepairTargetIds = [
      diagnosisAssertions[1]?.id,
      diagnosisAssertions[3]?.id,
      diagnosisAssertions[2]?.id
    ].filter(Boolean);
    const repairPrompt = buildVlmJudgeDiagnosisRepairPrompt(
      missingDiagnosisCoverage.missingTargets
    );
    const repairResponseItems = missingDiagnosisCoverage.missingTargets.map((target, index) => ({
      id: target.id,
      diagnosis: {
        visualFinding: {
          scope: 'region',
          target: `待修区域 ${index + 1}`,
          description: '主体与周边留白关系削弱首要信息',
          relationship: '当前尺度关系使首要对象在使用尺寸下偏弱',
          normalizedBounds: { x: 0.1, y: 0.1, width: 0.7, height: 0.7 },
          affectedRoles: ['subject']
        },
        causalExplanation: {
          goalRelation: 'conflicts',
          mechanism: '首要对象的识别入口弱于任务目标'
        },
        revision: {
          action: '重新平衡主体与留白的视觉关系',
          expectedEffect: '真实使用尺寸下首要对象更明确',
          preserve: ['保留已成立的商品信息'],
          verify: ['在缩略使用尺寸复核首要对象']
        }
      }
    }));
    const validDiagnosisRepair = parseVlmJudgeDiagnosisRepairResponse(
      JSON.stringify(repairResponseItems),
      missingDiagnosisCoverage.missingTargets
    );
    const mergedDiagnosisResults = mergeVlmJudgeDiagnosisRepairs(
      repairMissingResults,
      validDiagnosisRepair
    );
    const satisfiedDiagnosisCoverage = evaluateVlmJudgeDiagnosisCoverage(
      mergedDiagnosisResults,
      diagnosisAssertions
    );
    const originalRepairResultById = new Map(repairMissingResults.map((result) => [result.id, result]));
    const repairPreservedFrozenFields = mergedDiagnosisResults.every((result) => {
      const original = originalRepairResultById.get(result.id);
      return original
        && result.score === original.score
        && result.confidence === original.confidence
        && result.status === original.status
        && result.rationale === original.rationale
        && result.expectedFix === original.expectedFix
        && JSON.stringify(result.evidenceRefs) === JSON.stringify(original.evidenceRefs);
    });
    const extraFieldRepairItems = repairResponseItems.map((item, index) => (
      index === 0
        ? {
          ...item,
          score: 0.99
        }
        : item
    ));
    const extraFieldDiagnosisRepair = parseVlmJudgeDiagnosisRepairResponse(
      JSON.stringify(extraFieldRepairItems),
      missingDiagnosisCoverage.missingTargets
    );
    const outOfBoundsRepairItems = repairResponseItems.map((item, index) => (
      index === 0
        ? {
          ...item,
          diagnosis: {
            ...item.diagnosis,
            visualFinding: {
              ...item.diagnosis.visualFinding,
              normalizedBounds: { x: 0.9, y: 0.1, width: 0.2, height: 0.7 }
            }
          }
        }
        : item
    ));
    const outOfBoundsDiagnosisRepair = parseVlmJudgeDiagnosisRepairResponse(
      JSON.stringify(outOfBoundsRepairItems),
      missingDiagnosisCoverage.missingTargets
    );
    const implementationDetailRepairItems = repairResponseItems.map((item, index) => (
      index === 0
        ? {
          ...item,
          diagnosis: {
            ...item.diagnosis,
            revision: {
              ...item.diagnosis.revision,
              action: '调用 setTextStyle 修改该区域'
            }
          }
        }
        : item
    ));
    const implementationDetailDiagnosisRepair = parseVlmJudgeDiagnosisRepairResponse(
      JSON.stringify(implementationDetailRepairItems),
      missingDiagnosisCoverage.missingTargets
    );
    const unknownTargetDiagnosisRepair = parseVlmJudgeDiagnosisRepairResponse(
      JSON.stringify(repairResponseItems.map((item, index) => (
        index === 0 ? { ...item, id: 'unknown.assertion' } : item
      ))),
      missingDiagnosisCoverage.missingTargets
    );
    const invalidRepairMerge = mergeVlmJudgeDiagnosisRepairs(
      repairMissingResults,
      outOfBoundsDiagnosisRepair
    );
    const passOnlyDiagnosisCoverage = evaluateVlmJudgeDiagnosisCoverage(
      parseVlmJudgeResponse(JSON.stringify(diagnosisAssertions.map((assertion) => ({
        id: assertion.id,
        applicable: true,
        score: 0.91,
        confidence: 0.95,
        reason: '冻结结果已通过'
      }))), diagnosisAssertions),
      diagnosisAssertions
    );
    if (missingDiagnosisCoverage.status !== 'missing'
      || missingDiagnosisCoverage.reliableNonPassCount !== 4
      || missingDiagnosisCoverage.selectedTargets.length !== 3
      || missingDiagnosisCoverage.missingTargets.length !== 3
      || missingDiagnosisCoverage.selectedTargets.map((target) => target.id).join(',')
        !== expectedRepairTargetIds.join(',')) {
      aestheticProtocolViolations.push('diagnosis-repair-coverage-was-not-bounded-and-deterministic');
    }
    if (!repairPrompt.includes('每个数组项顶层只能有 id 与 diagnosis 两个字段')
      || !repairPrompt.includes('不得改变、重算或返回原 score')
      || !repairPrompt.includes('不得指定固定 Tool')
      || !repairPrompt.includes('具体执行动作仍由 Agent')
      || repairPrompt.includes('setTextStyle')
      || repairPrompt.includes('transformLayer')) {
      aestheticProtocolViolations.push('diagnosis-repair-prompt-crossed-design-or-tool-ownership');
    }
    if (validDiagnosisRepair.status !== 'valid'
      || validDiagnosisRepair.repairs.length !== 3
      || satisfiedDiagnosisCoverage.status !== 'satisfied'
      || satisfiedDiagnosisCoverage.missingTargets.length !== 0
      || !repairPreservedFrozenFields) {
      aestheticProtocolViolations.push('diagnosis-repair-did-not-only-fill-validated-diagnosis');
    }
    if (extraFieldDiagnosisRepair.status !== 'invalid'
      || extraFieldDiagnosisRepair.repairs.length !== 0
      || outOfBoundsDiagnosisRepair.status !== 'invalid'
      || outOfBoundsDiagnosisRepair.repairs.length !== 0
      || implementationDetailDiagnosisRepair.status !== 'invalid'
      || implementationDetailDiagnosisRepair.repairs.length !== 0
      || unknownTargetDiagnosisRepair.status !== 'invalid'
      || unknownTargetDiagnosisRepair.repairs.length !== 0
      || invalidRepairMerge.some((result) => Boolean(result.diagnosis))
      || invalidRepairMerge.some((result) => (
        result.expectedFix !== originalRepairResultById.get(result.id)?.expectedFix
      ))) {
      aestheticProtocolViolations.push('invalid-diagnosis-repair-created-partial-fix-or-handoff-input');
    }
    if (passOnlyDiagnosisCoverage.status !== 'not_required'
      || passOnlyDiagnosisCoverage.selectedTargets.length !== 0
      || buildVlmJudgeDiagnosisRepairPrompt([]) !== '') {
      aestheticProtocolViolations.push('diagnosis-repair-ran-without-reliable-non-pass-target');
    }
    const diagnosedScorecard = scoreDesignAssertions(overDiagnosedResults, {
      assertions: diagnosisAssertions,
      passThreshold: 85,
      minCoverage: 0.8
    });
    const diagnosedOnlyConstraint = '只修复已有可靠三层诊断指出的关系';
    const diagnosedOnlyReentry = decideQualityAwareReflexionReentry({
      handoff: {
        status: 'reflexion_required',
        sourceOwner: 'R5',
        targetStage: 'R4',
        failureAnalysis: ['终局审美仍有可改进项'],
        nextRoundConstraints: [diagnosedOnlyConstraint]
      },
      priorReentryCount: 0,
      scorecardHistory: [diagnosedScorecard],
      stopReason: 'final_response',
      constraintMode: 'handoff_only'
    });
    if (!diagnosedOnlyReentry.shouldReenter
      || diagnosedOnlyReentry.injectedConstraints.length !== 1
      || diagnosedOnlyReentry.injectedConstraints[0] !== diagnosedOnlyConstraint) {
      aestheticProtocolViolations.push('aesthetic-reentry-reintroduced-undiagnosed-fixes');
    }
    const completedImprovementHandoff = {
      version: 'quality-gate-reflexion-handoff/v0',
      status: 'reflexion_required',
      sourceOwner: 'R5',
      targetStage: 'R4',
      reenterLoop: 'react',
      trigger: 'completed_aesthetic_improvement',
      reviewBinding: {
        documentId: 71,
        historyStateId: 103,
        observationKeys: ['review:current-revision-focus']
      },
      issueConstraints: [{
        issueId: 'current-revision-focus',
        description: '当前画面的首要对象不够清楚',
        expectedFix: '由 Agent 根据当前像素判断一个最小调整并复核',
        observationKey: 'review:current-revision-focus'
      }],
      failureAnalysis: ['终局审美仍有可改进项'],
      strategyAdjustments: ['泛化策略不得进入 completed handoff-only'],
      nextRoundConstraints: [diagnosedOnlyConstraint]
    };
    const completedImprovementPerformanceCapacity = {
      usage: {
        modelCalls: 2,
        toolCalls: 3,
        iterations: 2,
        visionCandidates: 0,
        visualAnalyses: 0,
        activeElapsedMs: 1_000,
        observationKeys: []
      },
      budget: {
        maxModelCalls: 10,
        maxToolCalls: 12,
        maxIterations: 10,
        maxVisionCandidates: 4,
        maxInitialVisionCandidates: 0,
        maxVisualAnalyses: 3,
        maxFullResolutionImageReads: 0,
        softTimeBudgetMs: 1_000_000
      }
    };
    const pairedCompletedConstraint = '问题 current-revision-focus；当前画面的首要对象不够清楚；对应修法：由 Agent 根据当前像素判断一个最小调整并复核';
    const passedImprovementScorecard = scoreDesignAssertions(
      diagnosisAssertions.map((assertion) => ({
        id: assertion.id,
        status: 'passed',
        score: 0.96,
        confidence: 0.95,
        reason: '已通过，仅保留一次有诊断的定向提升'
      })),
      {
        assertions: diagnosisAssertions,
        passThreshold: 85,
        minCoverage: 0.8
      }
    );
    const firstPassedImprovementReentry = decideQualityAwareReflexionReentry({
      handoff: completedImprovementHandoff,
      priorReentryCount: 0,
      scorecardHistory: [passedImprovementScorecard],
      stopReason: 'final_response',
      constraintMode: 'handoff_only',
      performanceCapacity: completedImprovementPerformanceCapacity
    });
    const needsReviewImprovementReentry = decideQualityAwareReflexionReentry({
      handoff: completedImprovementHandoff,
      priorReentryCount: 0,
      scorecardHistory: [diagnosedScorecard],
      stopReason: 'final_response',
      constraintMode: 'handoff_only',
      performanceCapacity: completedImprovementPerformanceCapacity
    });
    const secondPassedImprovementReentry = decideQualityAwareReflexionReentry({
      handoff: completedImprovementHandoff,
      priorReentryCount: 1,
      scorecardHistory: [passedImprovementScorecard],
      stopReason: 'final_response',
      constraintMode: 'handoff_only',
      performanceCapacity: completedImprovementPerformanceCapacity
    });
    if (!firstPassedImprovementReentry.shouldReenter
      || firstPassedImprovementReentry.reason !== 'reentry'
      || firstPassedImprovementReentry.injectedConstraints.length !== 1
      || firstPassedImprovementReentry.injectedConstraints[0] !== pairedCompletedConstraint
      || !needsReviewImprovementReentry.shouldReenter
      || needsReviewImprovementReentry.injectedConstraints.length !== 1
      || needsReviewImprovementReentry.injectedConstraints[0] !== pairedCompletedConstraint
      || secondPassedImprovementReentry.shouldReenter) {
      aestheticProtocolViolations.push('passed-completed-aesthetic-improvement-was-not-agent-owned-exactly-once');
    }
    const invalidCompletedHandoffs = [
      { ...completedImprovementHandoff, reviewBinding: undefined },
      {
        ...completedImprovementHandoff,
        reviewBinding: {
          documentId: 71,
          historyStateId: 103,
          observationKeys: ['review:duplicate', 'review:duplicate']
        }
      },
      {
        ...completedImprovementHandoff,
        issueConstraints: completedImprovementHandoff.issueConstraints.map((issue) => ({
          ...issue,
          observationKey: 'review:not-in-current-set'
        }))
      }
    ];
    for (const invalidHandoff of invalidCompletedHandoffs) {
      const invalidDecision = decideQualityAwareReflexionReentry({
        handoff: invalidHandoff,
        priorReentryCount: 0,
        scorecardHistory: [passedImprovementScorecard],
        stopReason: 'final_response',
        constraintMode: 'handoff_only'
      });
      if (invalidDecision.shouldReenter || invalidDecision.reason !== 'no_actionable_constraints') {
        aestheticProtocolViolations.push('completed-aesthetic-invalid-review-binding-reentered');
        break;
      }
    }
    const trustedProvenance = evaluateReflexionReviewProvenance({
      handoff: completedImprovementHandoff,
      artifact: {
        historyStateRef: { documentId: 71, historyStateId: 103 },
        observationKeys: ['review:current-revision-focus']
      }
    });
    const mismatchedProvenance = evaluateReflexionReviewProvenance({
      handoff: completedImprovementHandoff,
      artifact: {
        historyStateRef: { documentId: 71, historyStateId: 104 },
        observationKeys: ['review:current-revision-focus']
      }
    });
    if (!trustedProvenance.valid
      || trustedProvenance.status !== 'match'
      || mismatchedProvenance.valid
      || mismatchedProvenance.status !== 'revision_mismatch') {
      aestheticProtocolViolations.push('completed-aesthetic-handoff-not-bound-to-trusted-review-artifact');
    }
    const sameRevisionWrite = evaluateCompletedReflexionWriteFreshness({
      handoff: completedImprovementHandoff,
      executionKind: 'photoshop_write',
      hasGenerationMutation: false,
      targetRevision: { documentId: 71, historyStateId: 103 }
    });
    const staleUnobservedWrite = evaluateCompletedReflexionWriteFreshness({
      handoff: completedImprovementHandoff,
      executionKind: 'photoshop_write',
      hasGenerationMutation: false,
      targetRevision: { documentId: 71, historyStateId: 104 }
    });
    const staleReobservedWrite = evaluateCompletedReflexionWriteFreshness({
      handoff: completedImprovementHandoff,
      executionKind: 'photoshop_write',
      hasGenerationMutation: false,
      targetRevision: { documentId: 71, historyStateId: 104 },
      currentVisualReview: {
        historyStateRef: { documentId: 71, historyStateId: 104 },
        observationKeys: ['review:current-104'],
        fullyReviewed: true
      }
    });
    const postMutationWrite = evaluateCompletedReflexionWriteFreshness({
      handoff: completedImprovementHandoff,
      executionKind: 'photoshop_write',
      hasGenerationMutation: true,
      targetRevision: { documentId: 71, historyStateId: 104 }
    });
    if (!sameRevisionWrite.allowed
      || staleUnobservedWrite.allowed
      || staleUnobservedWrite.status !== 'current_revision_observation_required'
      || !staleReobservedWrite.allowed
      || staleReobservedWrite.status !== 'current_revision_reobserved'
      || !postMutationWrite.allowed
      || postMutationWrite.status !== 'subsequent_generation_write') {
      aestheticProtocolViolations.push('completed-aesthetic-first-write-freshness-boundary-invalid');
    }
    const completedNoiseOnlyReentry = decideQualityAwareReflexionReentry({
      handoff: {
        ...completedImprovementHandoff,
        issueConstraints: []
      },
      priorReentryCount: 0,
      scorecardHistory: [passedImprovementScorecard],
      stopReason: 'final_response',
      constraintMode: 'handoff_only',
      performanceCapacity: completedImprovementPerformanceCapacity
    });
    if (completedNoiseOnlyReentry.shouldReenter
      || completedNoiseOnlyReentry.reason !== 'no_actionable_constraints') {
      aestheticProtocolViolations.push('completed-aesthetic-warning-without-paired-diagnosis-reentered');
    }
    if (!agentRuntimeText.includes('const reflexionSummaryWarningIssues = completedAestheticImprovementEligible')
      || !reflexionReentryPolicyText.includes('const advisoryOnly = isCompletedAestheticImprovementReflexionHandoff(handoff)')
      || !agentRuntimeText.includes('buildCompletedReflexionWriteFreshnessBlock({')
      || !reflexionWriteFreshnessText.includes('evaluateCompletedReflexionWriteFreshness({')
      || !reflexionWriteFreshnessText.includes("code: missingTargetRevision")
      || !reflexionWriteFreshnessText.includes('executesPhotoshop: false')
      || !reflexionWriteFreshnessText.includes('grantsPermission: false')
      || !reflexionWriteFreshnessText.includes('countsAsTaskProgress: false')
      || !executorText.includes('evaluateReflexionReviewProvenance({')
      || !executorText.includes('readTrustedVisualReviewArtifact(result)')
      || !runtimeReflexionContractText.includes('reviewBinding?: ReflexionReviewBinding')
      || !runtimeReflexionContractText.includes('observationKey?: string')
      || !executorText.includes('failureAnalysis: []')
      || !executorText.includes('strategyAdjustments: []')
      || !executorText.includes('nextRoundConstraints: []')
      || !executorText.includes('performanceCapacity: {')
      || !executorText.includes('usage: currentPerformanceUsage')
      || !reflexionReentryPolicyText.includes('AGENT_COMPLETED_ARTIFACT_REENTRY_MINIMUM')) {
      aestheticProtocolViolations.push('completed-aesthetic-handoff-expanded-beyond-paired-advisory-observations');
    }
    const capacityExhaustionCases = [
      {
        dimension: 'model_calls',
        usage: { ...completedImprovementPerformanceCapacity.usage, modelCalls: 8 }
      },
      {
        dimension: 'tool_calls',
        usage: { ...completedImprovementPerformanceCapacity.usage, toolCalls: 9 }
      },
      {
        dimension: 'iterations',
        usage: { ...completedImprovementPerformanceCapacity.usage, iterations: 8 }
      },
      {
        dimension: 'vision_candidates',
        usage: { ...completedImprovementPerformanceCapacity.usage, visionCandidates: 4 }
      },
      {
        dimension: 'visual_analyses',
        usage: { ...completedImprovementPerformanceCapacity.usage, visualAnalyses: 3 }
      },
      {
        dimension: 'active_time_ms',
        usage: { ...completedImprovementPerformanceCapacity.usage, activeElapsedMs: 500_000 }
      },
      {
        dimension: 'invalid_usage',
        usage: { ...completedImprovementPerformanceCapacity.usage, activeElapsedMs: Number.NaN }
      }
    ];
    for (const capacityCase of capacityExhaustionCases) {
      const capacityDecision = decideQualityAwareReflexionReentry({
        handoff: completedImprovementHandoff,
        priorReentryCount: 0,
        scorecardHistory: [passedImprovementScorecard],
        stopReason: 'final_response',
        constraintMode: 'handoff_only',
        performanceCapacity: {
          usage: capacityCase.usage,
          budget: completedImprovementPerformanceCapacity.budget
        }
      });
      if (capacityDecision.shouldReenter
        || capacityDecision.reason !== 'resource_budget_exhausted') {
        aestheticProtocolViolations.push(
          `completed-aesthetic-insufficient-${capacityCase.dimension}-reentered`
        );
      }
    }
    const missingCapacityDecision = decideQualityAwareReflexionReentry({
      handoff: completedImprovementHandoff,
      priorReentryCount: 0,
      scorecardHistory: [passedImprovementScorecard],
      stopReason: 'final_response',
      constraintMode: 'handoff_only'
    });
    if (missingCapacityDecision.shouldReenter
      || missingCapacityDecision.reason !== 'resource_budget_exhausted') {
      aestheticProtocolViolations.push('completed-aesthetic-missing-capacity-proof-reentered');
    }
    const exhaustedBudgetReentry = decideQualityAwareReflexionReentry({
      handoff: completedImprovementHandoff,
      priorReentryCount: 0,
      scorecardHistory: [passedImprovementScorecard],
      stopReason: 'performance_budget',
      constraintMode: 'handoff_only'
    });
    if (exhaustedBudgetReentry.shouldReenter
      || exhaustedBudgetReentry.reason !== 'resource_budget_exhausted') {
      aestheticProtocolViolations.push('resource-budget-stop-reentered-reflexion');
    }
    const runtimeImprovementPlan = {
      version: 'runtime-stage-plan/v0',
      skillId: 'audit-completed-aesthetic-improvement',
      taskType: 'creative_design',
      requiredInputs: [],
      optionalInputs: [],
      inputSources: {},
      deliveryOutputs: [],
      steps: [
        {
          stage: 'R4',
          owner: 'R4',
          objective: '完成生产',
          requiredOutcomes: ['production_complete'],
          allowedToolCapabilities: [],
          failureTarget: 'continue_react'
        },
        {
          stage: 'R5',
          owner: 'R5',
          objective: '完成复核',
          requiredOutcomes: ['stage_evaluation'],
          allowedToolCapabilities: [],
          failureTarget: 'reflexion'
        }
      ],
      onDemandCapabilityExpansionAllowed: true,
      exitCriteria: []
    };
    const projectedImprovementState = buildRuntimeStageStateFromEvaluation({
      plan: runtimeImprovementPlan,
      observedEvents: [{
        stage: 'R4',
        outcome: 'passed',
        observedOutcomes: ['production_complete']
      }],
      executionSummary: {
        status: 'completed',
        stopReason: 'final_response',
        blockers: []
      },
      reflexionHandoff: completedImprovementHandoff
    });
    const completedImprovementProjection = projectRuntimeSessionCompletion({
      executionStatus: 'completed',
      stageState: projectedImprovementState,
      reflexionHandoff: completedImprovementHandoff
    });
    const ordinaryFailureHandoff = {
      ...completedImprovementHandoff,
      trigger: undefined
    };
    const ordinaryFailureState = buildRuntimeStageStateFromEvaluation({
      plan: runtimeImprovementPlan,
      observedEvents: [{
        stage: 'R4',
        outcome: 'passed',
        observedOutcomes: ['production_complete']
      }],
      executionSummary: {
        status: 'completed',
        stopReason: 'final_response',
        blockers: []
      },
      reflexionHandoff: ordinaryFailureHandoff
    });
    const ordinaryFailureProjection = projectRuntimeSessionCompletion({
      executionStatus: 'completed',
      stageState: ordinaryFailureState,
      reflexionHandoff: ordinaryFailureHandoff
    });
    const unknownSideEffectProjection = projectRuntimeSessionCompletion({
      executionStatus: 'completed',
      stageState: projectedImprovementState,
      sideEffectState: 'unknown',
      reflexionHandoff: completedImprovementHandoff
    });
    const markerSurvivesRuntimeProjection = isCompletedAestheticImprovementHandoff({
      handoff: completedImprovementHandoff,
      stopReason: 'final_response',
      alreadyReentered: false
    });
    const secondImprovementIsStopped = !isCompletedAestheticImprovementHandoff({
      handoff: completedImprovementHandoff,
      stopReason: 'final_response',
      alreadyReentered: true
    });
    const improvementR5 = projectedImprovementState.stages.find((stage) => stage.stage === 'R5');
    const ordinaryFailureR5 = ordinaryFailureState.stages.find((stage) => stage.stage === 'R5');
    if (projectedImprovementState.status !== 'reflexion_required'
      || projectedImprovementState.currentStage !== 'R4'
      || improvementR5?.status !== 'needs_review'
      || completedImprovementProjection.status !== 'completed'
      || completedImprovementProjection.changed
      || completedImprovementProjection.blocker
      || ordinaryFailureR5?.status !== 'failed'
      || ordinaryFailureProjection.status !== 'needs_review'
      || !ordinaryFailureProjection.blocker
      || unknownSideEffectProjection.status !== 'needs_review'
      || !unknownSideEffectProjection.blocker
      || !markerSurvivesRuntimeProjection
      || !secondImprovementIsStopped) {
      aestheticProtocolViolations.push('completed-aesthetic-marker-did-not-preserve-completion-or-bound-reentry');
    }
    if (!agentRuntimeText.includes('(!runtimeDeliveryStageRequired || deliveryEvidencePassed)')
      || !agentRuntimeText.includes('deliveryStageEvidence.deliveryEvidencePassed')
      || !agentRuntimeText.includes('deliveryEvidencePassed: false')
      || !agentRuntimeText.includes('deliveryEvidencePassed: true')) {
      aestheticProtocolViolations.push('completed-aesthetic-marker-can-bypass-current-delivery-evidence');
    }
    const judgeContext = buildVlmJudgeContextMessage({
      measurements: {
        subjectAreaRatio: 0.5,
        alignmentScore: 0.75,
        backgroundIsPlainDefault: true,
        layoutBaselineOnly: true
      }
    });
    if (!judgeContext.includes('structuralHeuristicSignals')
      || !judgeContext.includes('structural_heuristic_not_pixel_fact')
      || !judgeContext.includes('用户未明确要求的信息、文案、渠道或尺寸不是缺失项')
      || judgeContext.includes('backgroundIsPlainDefault')
      || judgeContext.includes('layoutBaselineOnly')) {
      aestheticProtocolViolations.push('structural-heuristics-were-misrepresented-as-pixel-facts');
    }
  }
  const skuCompletionPublicationViolations = [];
  const skuBatchProfile = getDesignEvaluationProfileById(SKU_BATCH_EVALUATION_PROFILE_ID);
  const scopedEditProfile = getDesignEvaluationProfileById(
    DETAIL_PAGE_SCOPED_EDIT_EVALUATION_PROFILE_ID
  );
  if (!skuBatchProfile || getDesignEvaluationProfileVlmAssertions(skuBatchProfile).length !== 0) {
    aestheticProtocolViolations.push('sku-batch-zero-vision-profile-still-requires-vlm');
  }
  if (!scopedEditProfile || getDesignEvaluationProfileVlmAssertions(scopedEditProfile).length !== 0) {
    aestheticProtocolViolations.push('scoped-edit-without-region-provenance-still-scores-full-canvas');
  }
  const scoringIsolationProfile = getDesignEvaluationProfileById(MAIN_IMAGE_EVALUATION_PROFILE_ID);
  if (scoringIsolationProfile) {
    const mainImageSellingPointAssertion = getDesignEvaluationProfileVlmAssertions(
      scoringIsolationProfile
    ).find((assertion) => assertion.id === 'sell.visualized');
    if (!scoringIsolationProfile.capabilityGoal.includes('点击理由')
      || !scoringIsolationProfile.capabilityGoal.includes('纯摄影可以成立')
      || !mainImageSellingPointAssertion?.judgeCriterion.includes('用户没有逐字写出卖点不等于本项自动不适用')
      || !mainImageSellingPointAssertion?.judgeCriterion.includes('不要求补文案、场景、装饰或固定风格')) {
      aestheticProtocolViolations.push('main-image-profile-lost-commercial-goal-without-prescriptive-design');
    }
    const scoringAssertions = getDesignEvaluationProfileScoringAssertions(scoringIsolationProfile);
    const stableVlmResults = scoringAssertions.map((assertion) => ({
      id: assertion.id,
      dimension: assertion.dimension,
      status: 'pass',
      score: 0.86,
      confidence: 1,
      method: assertion.method,
      severity: assertion.severity,
      owner: assertion.owner,
      rationale: '同一组 VLM 评价结果。',
      expectedFix: assertion.expectedFix
    }));
    const missingVerificationResult = evaluateDesignEvaluationProfile({
      profile: scoringIsolationProfile,
      assertionResults: stableVlmResults,
      verificationRecords: []
    });
    const passedVerificationRecords = scoringIsolationProfile.checks
      .filter((check) => check.required && check.completionScope === 'artifact_completion')
      .map((check) => ({
        key: check.key,
        status: 'passed',
        source: check.allowedSources[0],
        verificationRef: `audit:${check.key}:passed`
      }));
    const passedVerificationResult = evaluateDesignEvaluationProfile({
      profile: scoringIsolationProfile,
      assertionResults: stableVlmResults,
      verificationRecords: passedVerificationRecords
    });
    const softAestheticFindingResults = stableVlmResults.map((result) => (
      result.id === 'sell.visualized'
        ? {
            ...result,
            status: 'needs_review',
            score: 0.78,
            rationale: '产物事实已闭合，仍有非阻断审美改进空间。'
          }
        : result
    ));
    const softAestheticFindingResult = evaluateDesignEvaluationProfile({
      profile: scoringIsolationProfile,
      assertionResults: softAestheticFindingResults,
      verificationRecords: passedVerificationRecords
    });
    const softAestheticFindingContract = {
      kind: 'skill_evaluation_profile',
      status: 'completed',
      required: scoringIsolationProfile.checks
        .filter((check) => check.required && check.completionScope === 'artifact_completion')
        .map((check) => ({ id: check.id, label: check.label, status: 'passed' })),
      blockers: [],
      warnings: [],
      completion: softAestheticFindingResult.completion,
      summary: '产物必需检查已经闭合。'
    };
    const softAestheticFindingVerdict = buildDesignVerdict({
      contract: softAestheticFindingContract,
      scorecard: softAestheticFindingResult.scorecard,
      designKinds: ['skill_evaluation_profile']
    });
    const incompleteStructureVerification = projectDesignFinalReviewStructureVerification({
      version: 'design-artifact-structure-concerns/v1',
      coverage: {
        status: 'incomplete',
        observedLayerCount: 1000,
        reportedLayerCount: 1000,
        truncated: true,
        reasonCodes: ['layer_list_truncated']
      },
      concerns: [],
      boundaries: {
        observationOnly: true,
        doesNotMutateDocument: true,
        doesNotChooseDesignOutcome: true,
        requiresJudgeInterpretation: true,
        rawToolPayloadExcluded: true,
        filesystemPathsExcluded: true
      }
    });
    const unavailableStructureVerification = projectDesignFinalReviewStructureVerification({
      version: 'design-artifact-structure-concerns/v1',
      coverage: {
        status: 'unavailable',
        observedLayerCount: 0,
        truncated: false,
        reasonCodes: ['snapshot_unavailable']
      },
      concerns: [],
      boundaries: {
        observationOnly: true,
        doesNotMutateDocument: true,
        doesNotChooseDesignOutcome: true,
        requiresJudgeInterpretation: true,
        rawToolPayloadExcluded: true,
        filesystemPathsExcluded: true
      }
    });
    const incompleteStructureResult = evaluateDesignEvaluationProfile({
      profile: scoringIsolationProfile,
      assertionResults: stableVlmResults.map((result) => ({ ...result, score: 0.95 })),
      verificationRecords: passedVerificationRecords.map((record) => (
        record.key === 'fresh_structure_snapshot'
          ? {
              ...record,
              status: incompleteStructureVerification.status,
              verificationRef: incompleteStructureVerification.verificationRef
            }
          : record
      ))
    });
    const needsReviewVerificationResult = evaluateDesignEvaluationProfile({
      profile: scoringIsolationProfile,
      assertionResults: stableVlmResults,
      verificationRecords: passedVerificationRecords.map((record, index) => (
        index === 0
          ? { ...record, status: 'needs_review', verificationRef: `${record.verificationRef}:review` }
          : record
      ))
    });
    const failedVerificationResult = evaluateDesignEvaluationProfile({
      profile: scoringIsolationProfile,
      assertionResults: stableVlmResults,
      verificationRecords: passedVerificationRecords.map((record, index) => (
        index === 0
          ? { ...record, status: 'failed', verificationRef: `${record.verificationRef}:failed` }
          : record
      ))
    });
    const verificationCheckIds = new Set(scoringIsolationProfile.checks.map((check) => check.id));
    const verificationScoreLeak = passedVerificationResult.scorecard.results.some((result) => (
      verificationCheckIds.has(result.id)
      && Object.prototype.hasOwnProperty.call(result, 'score')
    ));
    if (scoringAssertions.map((assertion) => assertion.id).join('|')
        !== scoringIsolationProfile.assertionRefs.join('|')
      || missingVerificationResult.scorecard.overallScore !== 86
      || passedVerificationResult.scorecard.overallScore !== 86
      || needsReviewVerificationResult.scorecard.overallScore !== 86
      || failedVerificationResult.scorecard.overallScore !== 86
      || JSON.stringify(missingVerificationResult.scorecard.dimensionScores)
        !== JSON.stringify(passedVerificationResult.scorecard.dimensionScores)
      || JSON.stringify(missingVerificationResult.scorecard.coverage)
        !== JSON.stringify(passedVerificationResult.scorecard.coverage)
      || passedVerificationResult.scorecard.coverage.total !== scoringAssertions.length
      || passedVerificationResult.scorecard.coverage.deterministicEvaluated !== 0
      || missingVerificationResult.status !== 'incomplete_verification'
      || passedVerificationResult.status !== 'passed'
      || needsReviewVerificationResult.status !== 'needs_review'
      || failedVerificationResult.status !== 'failed'
      || softAestheticFindingResult.status !== 'needs_review'
      || softAestheticFindingResult.completion.artifactStatus !== 'artifact_completed'
      || softAestheticFindingContract.status !== 'completed'
      || softAestheticFindingVerdict.status !== 'needs_review'
      || !isDesignVerdictDeliverable(softAestheticFindingVerdict)
      || incompleteStructureVerification.status !== 'needs_review'
      || unavailableStructureVerification.status !== 'needs_review'
      || incompleteStructureResult.status !== 'needs_review'
      || incompleteStructureResult.completion.artifactStatus !== 'artifact_incomplete'
      || incompleteStructureResult.scorecard.overallScore !== 95
      || missingVerificationResult.coverage.ratio !== 0
      || passedVerificationResult.coverage.ratio !== 1
      || verificationScoreLeak) {
      aestheticProtocolViolations.push('profile-verification-checks-still-pollute-aesthetic-scoring');
    }
  } else {
    aestheticProtocolViolations.push('profile-verification-scoring-isolation-profile-missing');
  }
  if (skuBatchProfile) {
    const artifactChecks = skuBatchProfile.checks.filter((check) => (
      check.completionScope === 'artifact_completion'
    ));
    const publicationReviewChecks = skuBatchProfile.checks.filter((check) => (
      check.completionScope === 'publication_review'
    ));
    if (publicationReviewChecks.length !== 2
      || publicationReviewChecks.some((check) => (
        !check.required
        || check.allowedSources.length !== 1
        || check.allowedSources[0] !== 'human_review'
      ))) {
      skuCompletionPublicationViolations.push('sku-publication-review:not-human-only-or-not-separated');
    }

    const artifactPassedRecords = artifactChecks.map((check) => ({
      key: check.key,
      status: 'passed',
      source: check.allowedSources[0],
      verificationRef: `audit:${check.key}:passed`
    }));
    const pendingPublicationResult = evaluateDesignEvaluationProfile({
      profile: skuBatchProfile,
      assertionResults: [],
      verificationRecords: artifactPassedRecords
    });
    const pendingPublicationContract = buildTaskCompletionContract({
      task: '完成 SKU 批量生产并导出。',
      context: {
        agentTaskPlan: {
          requestKind: 'execute',
          allowedToolScope: 'write_photoshop',
          designBrief: { workMode: 'export_only' },
          executionPlan: { mode: 'execute' }
        }
      },
      toolCallLog: [],
      evaluationProfile: skuBatchProfile,
      evaluationProfileResult: pendingPublicationResult
    });
    const pendingPublicationVerdict = buildDesignVerdict({
      contract: pendingPublicationContract,
      scorecard: pendingPublicationResult.scorecard,
      designKinds: ['skill_evaluation_profile']
    });
    if (pendingPublicationResult.status !== 'passed'
      || pendingPublicationResult.completion.artifactStatus !== 'artifact_completed'
      || pendingPublicationResult.completion.publicationReviewStatus !== 'publication_review_pending'
      || pendingPublicationResult.completion.approvedPublicationReviewCheckCount !== 0
      || pendingPublicationResult.completion.pendingPublicationReviewCheckKeys.length !== 2
      || pendingPublicationResult.verification.missingRequiredCheckKeys.length !== 0
      || pendingPublicationContract?.status !== 'completed'
      || pendingPublicationContract?.completion?.artifactStatus !== 'artifact_completed'
      || pendingPublicationContract?.completion?.publicationReviewStatus !== 'publication_review_pending'
      || pendingPublicationContract.required.some((requirement) => (
        publicationReviewChecks.some((check) => check.id === requirement.id)
      ))
      || pendingPublicationVerdict.status !== 'passed') {
      skuCompletionPublicationViolations.push('sku-artifact:pending-publication-review-still-blocks-r5-completion');
    }

    const approvedPublicationResult = evaluateDesignEvaluationProfile({
      profile: skuBatchProfile,
      assertionResults: [],
      verificationRecords: [
        ...artifactPassedRecords,
        ...publicationReviewChecks.map((check) => ({
          key: check.key,
          status: 'passed',
          source: 'human_review',
          verificationRef: `audit:${check.key}:human-approved`
        }))
      ]
    });
    if (approvedPublicationResult.completion.publicationReviewStatus !== 'publication_review_approved'
      || approvedPublicationResult.completion.approvedPublicationReviewCheckCount !== publicationReviewChecks.length) {
      skuCompletionPublicationViolations.push('sku-publication-review:fresh-human-pass-not-projected');
    }

    const spoofedPublicationResult = evaluateDesignEvaluationProfile({
      profile: skuBatchProfile,
      assertionResults: [],
      verificationRecords: [
        ...artifactPassedRecords,
        ...publicationReviewChecks.map((check) => ({
          key: check.key,
          status: 'passed',
          source: 'quality_adapter',
          verificationRef: `audit:${check.key}:spoofed-machine-pass`
        }))
      ]
    });
    if (spoofedPublicationResult.completion.publicationReviewStatus !== 'publication_review_pending'
      || !spoofedPublicationResult.issueCodes.includes('verification_source_not_allowed')) {
      skuCompletionPublicationViolations.push('sku-publication-review:machine-source-fabricated-human-pass');
    }

    const rejectedPublicationResult = evaluateDesignEvaluationProfile({
      profile: skuBatchProfile,
      assertionResults: [],
      verificationRecords: [
        ...artifactPassedRecords,
        ...publicationReviewChecks.map((check) => ({
          key: check.key,
          status: 'failed',
          source: 'human_review',
          verificationRef: `audit:${check.key}:human-rejected`
        }))
      ]
    });
    if (rejectedPublicationResult.status !== 'passed'
      || rejectedPublicationResult.completion.artifactStatus !== 'artifact_completed'
      || rejectedPublicationResult.completion.publicationReviewStatus !== 'publication_review_rejected') {
      skuCompletionPublicationViolations.push('sku-publication-review:rejection-was-conflated-with-artifact-completion');
    }

    const failedArtifactResult = evaluateDesignEvaluationProfile({
      profile: skuBatchProfile,
      assertionResults: [],
      verificationRecords: artifactPassedRecords.map((record) => (
        record.key === 'sku_export_readback'
          ? { ...record, status: 'failed', verificationRef: 'audit:sku_export_readback:failed' }
          : record
      ))
    });
    if (failedArtifactResult.completion.artifactStatus !== 'artifact_incomplete'
      || failedArtifactResult.status === 'passed') {
      skuCompletionPublicationViolations.push('sku-artifact:machine-export-failure-was-weakened');
    }
  }
  if (!skuHumanReviewText.includes("runDisposition: 'post_execution_review'")
    || !agentRuntimeText.includes("card.runDisposition !== 'post_execution_review'")) {
    skuCompletionPublicationViolations.push('sku-publication-review:post-execution-card-still-suspends-production-run');
  }
  const evaluateScopedOptionalCheck = (optionalStatus) => scopedEditProfile
    ? evaluateDesignEvaluationProfile({
      profile: scopedEditProfile,
      assertionResults: [],
      verificationRecords: [
        ...scopedEditProfile.checks
          .filter((check) => check.required)
          .map((check) => ({
            key: check.key,
            status: 'passed',
            source: 'runtime_observation',
            verificationRef: `audit:${check.key}`
          })),
        {
          key: 'fresh_visual_evaluation',
          status: optionalStatus,
          source: 'runtime_observation',
          verificationRef: 'audit:fresh_visual_evaluation'
        }
      ]
    })
    : undefined;
  const scopedOptionalEvaluationResult = evaluateScopedOptionalCheck('needs_review');
  const scopedOptionalFailedEvaluationResult = evaluateScopedOptionalCheck('failed');
  if (!scopedOptionalEvaluationResult
    || scopedOptionalEvaluationResult.status !== 'passed'
    || scopedOptionalEvaluationResult.scorecard.gate !== 'passed'
    || !scopedOptionalEvaluationResult.verification.needsReviewCheckKeys.includes('fresh_visual_evaluation')
    || scopedOptionalEvaluationResult.verification.requiredNeedsReviewCheckKeys.length !== 0) {
    aestheticProtocolViolations.push('optional-scoped-visual-review-still-downgraded-profile-status');
  }
  if (!scopedOptionalFailedEvaluationResult
    || scopedOptionalFailedEvaluationResult.status !== 'passed'
    || scopedOptionalFailedEvaluationResult.scorecard.gate !== 'passed'
    || !scopedOptionalFailedEvaluationResult.verification.failedCheckKeys.includes('fresh_visual_evaluation')) {
    aestheticProtocolViolations.push('optional-scoped-visual-failure-still-downgraded-profile-status');
  }
  const delegatedCreateDocumentVariants = [
    '再新建一个文档，尺寸随意都行。',
    '帮我另开一张画布，大小你决定。',
    '新建一份空白文件，按常用规格就行。',
    '再做一个新的，尺寸合适就可以。'
  ];
  const delegatedCreateDocumentViolations = delegatedCreateDocumentVariants.flatMap((userInput, index) => {
    const context = buildDesignDocumentRoleContext({
      userInput,
      currentDocumentName: '当前参考文件.psd'
    });
    const decision = evaluateCreateDocumentTargetBoundary(context);
    return decision.allowed
      ? []
      : [`variant-${index + 1}:${decision.code}`];
  });
  const lexicalSkuDocumentContext = buildDesignDocumentRoleContext({
    userInput: '帮我做 SKU',
    currentDocumentName: '详情页.psb'
  });
  const lexicalSkuCreateDecision = evaluateCreateDocumentTargetBoundary(lexicalSkuDocumentContext);
  const explicitProtectedDocumentContext = buildDesignDocumentRoleContext({
    userInput: '帮我做 SKU，但不要修改当前文档。',
    currentDocumentName: '详情页.psb'
  });
  const structuredCreateDocumentContext = buildDesignDocumentRoleContext({
    userInput: '帮我做 SKU',
    currentDocumentName: '详情页.psb',
    workMode: 'create_new'
  });
  const structuredEditDocumentContext = buildDesignDocumentRoleContext({
    userInput: '调整当前 SKU 文档',
    currentDocumentName: '任意名称.psb',
    workMode: 'edit_existing'
  });
  const protectedAlternateTargetCases = [
    '不要修改当前文档，另建一张主图',
    '保持当前画布不变，新建一版主图',
    '不要覆盖当前 PSD，在副本完成详情页',
    '不要操作当前画面，创建新文档',
    '别修改当前文档，切到另一个文档继续',
    '禁止写入当前文档，在副本上完成',
    '不要在当前文档中进行任何修改，新建文档',
    '禁止改当前画布，创建新画布',
    '别碰当前文件，复制一份再改',
    '不要写当前PSD，另存一个版本',
    '不要修改当前文档另建一张主图',
    '不要改源稿另建主图',
    '当前文档保持不变创建新文档继续'
  ];
  const protectedAlternateTargetViolations = protectedAlternateTargetCases.flatMap((userInput) => {
    const context = buildDesignDocumentRoleContext({
      userInput,
      currentDocumentName: '源稿.psd'
    });
    const constraint = extractExplicitUserCapabilityConstraint(userInput);
    return context.currentDocumentUse === 'protected'
      && constraint.toolScopeCeiling === undefined
      && context.agentInstruction.includes('可以只读观察')
      && context.agentInstruction.includes('禁止修改、保存或关闭')
      ? []
      : [`document-authority:protected-source-alternate-target-was-global-read-only:${userInput}`];
  });
  const globalReadOnlyConstraint = extractExplicitUserCapabilityConstraint(
    '本轮不要对任何文档进行修改，只检查当前详情页'
  );
  const unnamedProtectedDocumentContext = buildDesignDocumentRoleContext({
    userInput: '不要修改当前文档，另建一张主图',
    hasCurrentDocument: true
  });
  const currentDocumentReuseAfterAlternateNegation = buildDesignDocumentRoleContext({
    userInput: '不要动新文档而是继续修改当前文档',
    currentDocumentName: '当前稿.psd'
  });
  const currentDocumentReuseWithoutPunctuation = buildDesignDocumentRoleContext({
    userInput: '不要新建文档继续修改当前文档',
    currentDocumentName: '当前稿.psd'
  });
  const currentDocumentReuseConstraint = extractExplicitUserCapabilityConstraint(
    '不要新建文档继续修改当前文档'
  );
  const documentAuthorityViolations = [
    ...protectedAlternateTargetViolations,
    ...(globalReadOnlyConstraint.toolScopeCeiling === 'read_only'
      ? []
      : ['document-authority:global-no-write-lost-read-only-ceiling']),
    ...(lexicalSkuDocumentContext.currentDocumentUse === 'advisory'
      && lexicalSkuDocumentContext.shouldObserveCurrentDocument === true
      && lexicalSkuCreateDecision.allowed === true
      ? []
      : ['document-authority:category-or-filename-became-permission']),
    ...(explicitProtectedDocumentContext.currentDocumentUse === 'protected'
      ? []
      : ['document-authority:explicit-user-protection-was-not-enforced']),
    ...(unnamedProtectedDocumentContext.currentDocumentUse === 'protected'
      ? []
      : ['document-authority:protected-document-required-a-file-name']),
    ...(currentDocumentReuseAfterAlternateNegation.currentDocumentUse === 'reuse'
      ? []
      : ['document-authority:alternate-document-negation-locked-current-document']),
    ...(currentDocumentReuseWithoutPunctuation.currentDocumentUse === 'reuse'
      && currentDocumentReuseConstraint.toolScopeCeiling === undefined
      && currentDocumentReuseConstraint.deniedProviderToolNames.includes('createDocument')
      ? []
      : ['document-authority:unpunctuated-alternate-denial-locked-or-lost-current-reuse']),
    ...(structuredCreateDocumentContext.currentDocumentUse === 'separate_target'
      ? []
      : ['document-authority:structured-create-new-mode-was-lost']),
    ...(structuredEditDocumentContext.currentDocumentUse === 'reuse'
      ? []
      : ['document-authority:structured-edit-existing-mode-was-lost']),
    ...(executorText.includes("designDocumentRoleContext.currentDocumentUse === 'protected'")
      && !executorText.includes("designDocumentRoleContext.currentDocumentUse === 'separate_target'")
      && executorText.includes('disciplineContext.spec?.runtimeHints.documentRole')
      ? []
      : ['document-authority:executor-restored-lexical-write-lock-or-normalization'])
  ];
  const emptyAcceptanceSummary = {
    totalLayers: 0,
    selectedLayers: 0,
    hiddenLayers: 0,
    lockedLayers: 0,
    textLayers: 0,
    groupLayers: 0,
    smartObjectLayers: 0,
    shapeLayers: 0,
    pixelLayers: 0,
    truncated: false
  };
  const beforeCreateDocumentCapture = {
    snapshot: {
      success: false,
      hasDocument: false,
      documentState: 'absent',
      layers: [],
      summary: emptyAcceptanceSummary,
      error: '当前没有打开的 Photoshop 文档'
    },
    error: '当前没有打开的 Photoshop 文档'
  };
  const afterCreateDocumentCapture = {
    snapshot: {
      success: true,
      hasDocument: true,
      documentState: 'present',
      historyStateRef: { documentId: 128, historyStateId: 129 },
      document: {
        id: 128,
        name: '新文档',
        width: 1080,
        height: 1080,
        resolution: 72
      },
      selectedLayerIds: [1],
      summary: {
        ...emptyAcceptanceSummary,
        totalLayers: 1,
        selectedLayers: 1,
        pixelLayers: 1
      },
      layers: [{
        id: 1,
        name: '背景',
        kind: 'pixel',
        visible: true,
        locked: false,
        depth: 0,
        index: 0,
        parentId: null,
        parentName: null,
        path: '背景',
        selected: true
      }],
      warnings: []
    }
  };
  const createDocumentAcceptance = buildToolAcceptanceVerification({
    toolName: 'createDocument',
    params: { name: '新文档', width: 1080, height: 1080, resolution: 72 },
    result: { success: true, documentId: 128 },
    before: beforeCreateDocumentCapture,
    after: afterCreateDocumentCapture
  });
  const mismatchedCreateDocumentAcceptance = buildToolAcceptanceVerification({
    toolName: 'createDocument',
    params: { name: '新文档', width: 800, height: 800, resolution: 72 },
    result: { success: true, documentId: 128 },
    before: beforeCreateDocumentCapture,
    after: afterCreateDocumentCapture
  });
  const scopedTextLayer = {
    id: 701,
    name: '标题',
    kind: 'text',
    visible: true,
    locked: false,
    depth: 0,
    index: 0,
    parentId: null,
    parentName: null,
    path: '标题',
    selected: true,
    bounds: { left: 80, top: 60, right: 420, bottom: 140, width: 340, height: 80 },
    text: {
      content: '旧标题',
      length: 3,
      style: { fontName: 'ArialMT', fontSize: 48, tracking: 0, leading: 56 }
    }
  };
  const scopedTextSibling = {
    ...scopedTextLayer,
    id: 702,
    name: '副标题',
    path: '副标题',
    selected: false,
    bounds: { left: 80, top: 160, right: 420, bottom: 210, width: 340, height: 50 },
    text: {
      content: '保持不变',
      length: 4,
      style: { fontName: 'ArialMT', fontSize: 28, tracking: 0, leading: 34 }
    }
  };
  const scopedTextSnapshot = (historyStateId, titleContent, siblingContent = '保持不变') => ({
    success: true,
    hasDocument: true,
    documentState: 'present',
    historyStateRef: { documentId: 700, historyStateId },
    document: { id: 700, name: '局部文字.psd', width: 1080, height: 1080, resolution: 72 },
    selectedLayerIds: [701],
    summary: {
      ...emptyAcceptanceSummary,
      totalLayers: 2,
      selectedLayers: 1,
      textLayers: 2
    },
    layers: [
      {
        ...scopedTextLayer,
        text: { ...scopedTextLayer.text, content: titleContent, length: titleContent.length }
      },
      {
        ...scopedTextSibling,
        text: { ...scopedTextSibling.text, content: siblingContent, length: siblingContent.length }
      }
    ],
    warnings: []
  });
  const scopedTextAcceptance = buildToolAcceptanceVerification({
    toolName: 'setTextContent',
    params: { layerId: 701, content: '新标题' },
    result: { success: true },
    before: { snapshot: scopedTextSnapshot(40, '旧标题') },
    after: { snapshot: scopedTextSnapshot(41, '新标题') }
  });
  const scopedTextRecords = buildRuntimeScopedChangeVerificationRecords([{
    name: 'setTextContent',
    result: { success: true, acceptance: scopedTextAcceptance }
  }]);
  const scopedTextOutsideMutationAcceptance = buildToolAcceptanceVerification({
    toolName: 'setTextContent',
    params: { layerId: 701, content: '新标题' },
    result: { success: true },
    before: { snapshot: scopedTextSnapshot(50, '旧标题') },
    after: { snapshot: scopedTextSnapshot(51, '新标题', '被意外改动') }
  });
  const scopedTextOutsideMutationRecords = buildRuntimeScopedChangeVerificationRecords([{
    name: 'setTextContent',
    result: { success: true, acceptance: scopedTextOutsideMutationAcceptance }
  }]);
  const exactTextExecutionScope = {
    version: 'exact-property-execution-scope/v0',
    kind: 'exact_property_replacement',
    replacement: { from: '旧标题', to: '新标题', hint: 'text_content' },
    allowedWriteTools: ['setTextContent']
  };
  const exactTextPreWriteObservation = {
    name: 'getAcceptanceSnapshot',
    arguments: {
      includeHidden: true,
      includeText: true,
      includeBounds: false,
      maxLayers: 1000
    },
    result: scopedTextSnapshot(40, '旧标题')
  };
  const exactTextArguments = {
    layerId: 701,
    content: '新标题',
    expectedCurrentContent: '旧标题',
    expectedDocumentId: 700,
    expectedHistoryStateRef: { documentId: 700, historyStateId: 40 }
  };
  const exactTextScopedRecords = buildRuntimeScopedChangeVerificationRecords([
    exactTextPreWriteObservation,
    {
      name: 'setTextContent',
      arguments: exactTextArguments,
      result: { success: true, acceptance: scopedTextAcceptance }
    }
  ], {
    exactPropertyScope: exactTextExecutionScope,
    requiredHistoryStateRef: { documentId: 700, historyStateId: 41 }
  });
  const staleFinalHistoryRecords = buildRuntimeScopedChangeVerificationRecords([
    exactTextPreWriteObservation,
    {
      name: 'setTextContent',
      arguments: exactTextArguments,
      result: { success: true, acceptance: scopedTextAcceptance }
    }
  ], {
    exactPropertyScope: exactTextExecutionScope,
    requiredHistoryStateRef: { documentId: 700, historyStateId: 42 }
  });
  const missingFinalHistoryRecords = buildRuntimeScopedChangeVerificationRecords([
    exactTextPreWriteObservation,
    {
      name: 'setTextContent',
      arguments: exactTextArguments,
      result: { success: true, acceptance: scopedTextAcceptance }
    }
  ], {
    exactPropertyScope: exactTextExecutionScope
  });
  const staleScopedProfileEvaluation = scopedEditProfile
    ? evaluateDesignEvaluationProfile({
      profile: scopedEditProfile,
      assertionResults: [],
      verificationRecords: staleFinalHistoryRecords
    })
    : undefined;
  const longExactText = '新'.repeat(100);
  const longTextScope = {
    ...exactTextExecutionScope,
    replacement: { from: '旧标题', to: longExactText, hint: 'text_content' }
  };
  const longTextAcceptance = buildToolAcceptanceVerification({
    toolName: 'setTextContent',
    params: { layerId: 701, content: longExactText },
    result: { success: true },
    before: { snapshot: scopedTextSnapshot(40, '旧标题') },
    after: { snapshot: scopedTextSnapshot(41, longExactText) }
  });
  const longTextScopedRecords = buildRuntimeScopedChangeVerificationRecords([
    exactTextPreWriteObservation,
    {
      name: 'setTextContent',
      arguments: { ...exactTextArguments, content: longExactText },
      result: { success: true, acceptance: longTextAcceptance }
    }
  ], {
    exactPropertyScope: longTextScope,
    requiredHistoryStateRef: { documentId: 700, historyStateId: 41 }
  });
  const multilineOldText = '第一行\r第二行';
  const multilineNewText = '新一行\n新二行';
  const multilineScope = {
    ...exactTextExecutionScope,
    replacement: { from: '第一行\n第二行', to: multilineNewText, hint: 'text_content' }
  };
  const multilinePreWriteObservation = {
    ...exactTextPreWriteObservation,
    result: scopedTextSnapshot(40, multilineOldText)
  };
  const multilineAcceptance = buildToolAcceptanceVerification({
    toolName: 'setTextContent',
    params: { layerId: 701, content: multilineNewText },
    result: { success: true },
    before: { snapshot: scopedTextSnapshot(40, multilineOldText) },
    after: { snapshot: scopedTextSnapshot(41, multilineNewText) }
  });
  const multilineScopedRecords = buildRuntimeScopedChangeVerificationRecords([
    multilinePreWriteObservation,
    {
      name: 'setTextContent',
      arguments: {
        ...exactTextArguments,
        content: multilineNewText,
        expectedCurrentContent: multilineOldText
      },
      result: { success: true, acceptance: multilineAcceptance }
    }
  ], {
    exactPropertyScope: multilineScope,
    requiredHistoryStateRef: { documentId: 700, historyStateId: 41 }
  });
  const wrongValueAcceptance = buildToolAcceptanceVerification({
    toolName: 'setTextContent',
    params: { layerId: 701, content: '错误标题' },
    result: { success: true },
    before: { snapshot: scopedTextSnapshot(40, '旧标题') },
    after: { snapshot: scopedTextSnapshot(41, '错误标题') }
  });
  const wrongValueScopedRecords = buildRuntimeScopedChangeVerificationRecords([
    exactTextPreWriteObservation,
    {
      name: 'setTextContent',
      arguments: { ...exactTextArguments, content: '错误标题' },
      result: { success: true, acceptance: wrongValueAcceptance }
    }
  ], { exactPropertyScope: exactTextExecutionScope });
  const wrongLayerAcceptance = buildToolAcceptanceVerification({
    toolName: 'setTextContent',
    params: { layerId: 702, content: '新标题' },
    result: { success: true },
    before: { snapshot: scopedTextSnapshot(40, '旧标题') },
    after: { snapshot: scopedTextSnapshot(41, '旧标题', '新标题') }
  });
  const wrongLayerScopedRecords = buildRuntimeScopedChangeVerificationRecords([
    exactTextPreWriteObservation,
    {
      name: 'setTextContent',
      arguments: {
        ...exactTextArguments,
        layerId: 702,
        expectedCurrentContent: '保持不变'
      },
      result: { success: true, acceptance: wrongLayerAcceptance }
    }
  ], { exactPropertyScope: exactTextExecutionScope });
  const failedOuterWrongLayerRecords = buildRuntimeScopedChangeVerificationRecords([
    exactTextPreWriteObservation,
    {
      name: 'setTextContent',
      arguments: {
        ...exactTextArguments,
        layerId: 702,
        expectedCurrentContent: '保持不变'
      },
      result: { success: false, acceptance: wrongLayerAcceptance }
    }
  ], { exactPropertyScope: exactTextExecutionScope });
  const scopedEditExecutionScopeDecisions = {
    missing: evaluateScopedEditExecutionScope({ executionScopeKind: 'exact_text_replacement' }),
    layerName: evaluateScopedEditExecutionScope({
      executionScopeKind: 'exact_text_replacement',
      exactPropertyScope: {
        ...exactTextExecutionScope,
        replacement: { ...exactTextExecutionScope.replacement, hint: 'layer_name' },
        allowedWriteTools: ['renameLayer']
      }
    }),
    unspecified: evaluateScopedEditExecutionScope({
      executionScopeKind: 'exact_text_replacement',
      exactPropertyScope: {
        ...exactTextExecutionScope,
        replacement: { ...exactTextExecutionScope.replacement, hint: 'unspecified' },
        allowedWriteTools: ['renameLayer', 'setTextContent']
      }
    }),
    text: evaluateScopedEditExecutionScope({
      executionScopeKind: 'exact_text_replacement',
      exactPropertyScope: exactTextExecutionScope
    })
  };
  const repeatedPolicyGateState = createPolicyGateRepeatState();
  let repeatedPolicyGateVerdict = null;
  for (let attempt = 0; attempt < POLICY_GATE_REPEAT_BLOCK_LIMIT; attempt += 1) {
    repeatedPolicyGateVerdict = recordPolicyGateBlockRound(repeatedPolicyGateState, [{
      toolName: 'createDocument',
      result: {
        success: false,
        policyGate: true,
        code: 'create_document_target_unresolved',
        message: `当前文档「测试-${attempt}」尚未绑定。`
      }
    }]) || repeatedPolicyGateVerdict;
  }
  const hitlPolicyGateSignature = resolvePolicyGateBlockSignature('closeDocument', {
    success: false,
    policyGate: true,
    safetyBlock: true,
    message: '等待用户确认'
  });
  // 真机病例 2026-08-14：runtime session 门禁漏标 policyGate，同一堵墙挡下 createTextLayer
  // 7 次仍未停机（上限 5），最后死于 performance_budget、零写入。账本必须靠结构字段识别门禁，
  // 不能依赖每个拦截点记得自报身份。
  const unmarkedGateSignature = resolvePolicyGateBlockSignature('createTextLayer', {
    success: false,
    code: 'runtime_task_run_revision_reobserve_required',
    blockedTool: 'createTextLayer',
    error: 'Photoshop 文档或历史版本已经变化；重新观察并明确决策前，不会自动重放旧写入。'
  });
  const disciplineGateSignature = resolvePolicyGateBlockSignature('placeImage', {
    success: false,
    nextRequiredTool: 'getAnnotatedSnapshot',
    message: '当前阶段已经连续写入多次但还没有复核真实画面。'
  });
  // 反向：普通工具执行失败没有门禁结构字段，不得被误计入撞墙账本，
  // 否则同一个真实错误重复 5 次就会被当成门禁死锁提前掐断。
  const ordinaryFailureSignature = resolvePolicyGateBlockSignature('getLayerBounds', {
    success: false,
    error: '未找到图层 ID: 12'
  });
  // 真机病例 2026-08-17：declareDesignBrief 结构校验驳回一次 run 内连撞 7 次不停机、零写入。
  // 声明表单驳回（*_declaration_invalid）同样是「Harness 拒绝模型」，必须上账。
  const declarationRejectionSignature = resolvePolicyGateBlockSignature('declareDesignBrief', {
    success: false,
    code: 'runtime_design_brief_declaration_invalid',
    error: 'runtime_design_brief_declaration_invalid: array_too_long (deliverables)'
  });
  const exactPropertyWriteScopeCases = [
    {
      id: 'layer-name-only',
      input: '请把图层名称“待修改标题”改成“已完成”，画面文字不要动。',
      expected: ['renameLayer']
    },
    {
      id: 'visible-text-only',
      input: '麻烦把画面文字“旧标题”换成“新标题”，其余图层保持不变。',
      expected: ['setTextContent']
    },
    {
      id: 'property-needs-observation',
      input: '把“旧标题”改为“新标题”，其他内容别动。',
      expected: ['renameLayer', 'setTextContent']
    },
    {
      id: 'compound-mutation-must-not-be-narrowed',
      input: '把图层名称“旧标题”改为“新标题”，然后新建一个矩形背景。',
      expected: undefined
    },
    {
      id: 'compound-after-preservation-clause-must-not-be-narrowed',
      input: '把图层名称“旧标题”改为“新标题”，不要改画面文字，然后新建一个矩形背景。',
      expected: undefined
    },
    {
      id: 'compound-save-must-not-be-narrowed',
      input: '把图层名称“旧标题”改为“新标题”并保存文档。',
      expected: undefined
    }
  ];
  const exactPropertyWriteScopeViolations = exactPropertyWriteScopeCases.flatMap((testCase) => {
    const actual = resolveExactPropertyReplacementWriteToolScope(testCase.input);
    return JSON.stringify(actual) === JSON.stringify(testCase.expected)
      ? []
      : [`${testCase.id}:expected=${JSON.stringify(testCase.expected)}:actual=${JSON.stringify(actual)}`];
  });
  const unauthorizedExactPropertyScopeViolations = [
    {
      id: 'question-cannot-mint-write-identity',
      scope: resolveAuthorizedExactPropertyReplacementExecutionScope({
        userRequest: '“A”改成“B”是什么意思？',
        toolScope: 'answer_only',
        executionAuthorization: 'answer_only'
      }),
      expectedReady: false
    },
    {
      id: 'retrospective-cannot-mint-write-identity',
      scope: resolveAuthorizedExactPropertyReplacementExecutionScope({
        userRequest: '你为什么把“A”改成“B”？',
        toolScope: 'read_only',
        executionAuthorization: 'candidate_only'
      }),
      expectedReady: false
    },
    {
      id: 'confirmed-write-can-be-narrowed',
      scope: resolveAuthorizedExactPropertyReplacementExecutionScope({
        userRequest: '请把画面文字“A”改成“B”，其他内容不变。',
        toolScope: 'write_photoshop',
        executionAuthorization: 'confirmed_tool_required'
      }),
      expectedReady: true
    }
  ].flatMap((testCase) => Boolean(testCase.scope) === testCase.expectedReady
    ? []
    : [`${testCase.id}:scope=${JSON.stringify(testCase.scope)}`]);
  const makeExactAcceptanceLog = (layers, options = {}) => [{
    name: 'getAcceptanceSnapshot',
    arguments: {
      includeHidden: true,
      includeText: true,
      includeBounds: false,
      maxLayers: 1000
    },
    result: {
      success: true,
      document: { id: 7, name: 'exact.psb' },
      historyStateRef: { documentId: 7, historyStateId: 11 },
      summary: {
        totalLayers: layers.length,
        truncated: options.truncated === true
      },
      layers,
      warnings: options.warnings || []
    }
  }];
  const exactTextReplacement = { from: '旧标题', to: '新标题', hint: 'text_content' };
  const uniqueExactLog = makeExactAcceptanceLog([
    { id: 41, name: '标题层', visible: false, text: { content: ' 旧标题 ' } },
    { id: 42, name: '说明层', visible: true, text: { content: '说明' } }
  ]);
  const uniqueExactTarget = resolveExactPropertyReplacementTarget({
    replacement: exactTextReplacement,
    completedToolCalls: uniqueExactLog
  });
  const canonicalExactCall = normalizeExactPropertyReplacementToolCall({
    userRequest: '请把画面文字“旧标题”改成“新标题”，其他内容不变。',
    toolCall: { name: 'renameLayer', arguments: { layerId: 999, newName: '新标题' } },
    completedToolCalls: uniqueExactLog
  });
  const ambiguousExactTarget = resolveExactPropertyReplacementTarget({
    replacement: exactTextReplacement,
    completedToolCalls: makeExactAcceptanceLog([
      { id: 41, name: '标题一', text: { content: '旧标题' } },
      { id: 42, name: '标题二', text: { content: '旧标题' } }
    ])
  });
  const sameLayerDualPropertyTarget = resolveExactPropertyReplacementTarget({
    replacement: { from: '旧标题', to: '新标题', hint: 'unspecified' },
    completedToolCalls: makeExactAcceptanceLog([
      { id: 41, name: '旧标题', text: { content: '旧标题' } }
    ])
  });
  const incompleteExactTarget = resolveExactPropertyReplacementTarget({
    replacement: exactTextReplacement,
    completedToolCalls: makeExactAcceptanceLog([
      { id: 41, name: '标题层', text: { content: '旧标题' } }
    ], { truncated: true })
  });
  const exactTargetResolutionViolations = [
    ...(JSON.stringify(EXACT_PROPERTY_EXECUTION_CONTEXT_TOOLS) === JSON.stringify([
      'getDocumentInfo',
      'getAcceptanceSnapshot',
      'createInteractiveCard'
    ])
      && executorText.includes('new Set(EXACT_PROPERTY_EXECUTION_CONTEXT_TOOLS)')
      ? []
      : [`exact-context-tool-surface-not-minimal:${JSON.stringify(EXACT_PROPERTY_EXECUTION_CONTEXT_TOOLS)}`]),
    ...(uniqueExactTarget.status === 'ready'
      && uniqueExactTarget.layerId === 41
      && uniqueExactTarget.property === 'text_content'
      && uniqueExactTarget.currentValue === ' 旧标题 '
      ? []
      : [`unique-hidden-text-not-resolved:${JSON.stringify(uniqueExactTarget)}`]),
    ...(canonicalExactCall.name === 'setTextContent'
      && canonicalExactCall.arguments?.layerId === 41
      && canonicalExactCall.arguments?.content === '新标题'
      && canonicalExactCall.arguments?.expectedCurrentContent === ' 旧标题 '
      && canonicalExactCall.arguments?.expectedDocumentId === 7
      && canonicalExactCall.arguments?.expectedHistoryStateRef?.historyStateId === 11
      ? []
      : [`canonical-set-text-cas-missing:${JSON.stringify(canonicalExactCall)}`]),
    ...(ambiguousExactTarget.status === 'ambiguous'
      ? []
      : [`duplicate-text-not-ambiguous:${JSON.stringify(ambiguousExactTarget)}`]),
    ...(sameLayerDualPropertyTarget.status === 'ambiguous'
      ? []
      : [`same-layer-dual-property-not-ambiguous:${JSON.stringify(sameLayerDualPropertyTarget)}`]),
    ...(incompleteExactTarget.status === 'incomplete'
      ? []
      : [`truncated-snapshot-not-rejected:${JSON.stringify(incompleteExactTarget)}`])
  ];
  const {
    AGENT_COMPOUND_FINALIZATION_RESERVE,
    AGENT_FINALIZATION_TIME_RESERVE_MS,
    AGENT_GLOBAL_SKILL_BUDGET_LIMITS,
    DESIGN_TEAM_ROLE_EXECUTION_MINIMUMS,
    buildAgentPerformancePolicy,
    buildAgentUnboundAutonomousPerformancePolicy,
    buildAutonomousAgentRuntimeBudget,
    buildDesignTeamChildExecutionReservation,
    buildDesignTeamSingleRoleExecutionReservation,
    resolveDeclaredRuntimeMaxIterations,
    resolveDesignTeamRequiredBaseRoles,
    sumDesignTeamRoleExecutionRequirements
  } = require(performancePolicyPath);
  const compoundParentBudget = {
    maxModelCalls: 30,
    maxToolCalls: 40,
    maxVisionCandidates: 5,
    maxInitialVisionCandidates: 0,
    maxVisualAnalyses: 5,
    maxFullResolutionImageReads: 0,
    softTimeBudgetMs: 600_000
  };
  const compoundParentUsage = {
    modelCalls: 2,
    toolCalls: 3,
    visualAnalyses: 1,
    visionCandidates: 1,
    iterations: 4
  };
  const compoundReservationInput = {
    parentBudget: compoundParentBudget,
    parentMaxIterations: 30,
    parentUsage: compoundParentUsage,
    parentActiveElapsedMs: 100_000,
    maxRevisions: 1,
    nowMs: 1_100_000
  };
  const baseTeamRoles = resolveDesignTeamRequiredBaseRoles(undefined);
  const specialistTeamRoles = resolveDesignTeamRequiredBaseRoles([
    'market-researcher',
    'copywriter'
  ]);
  const baseTeamRequirement = sumDesignTeamRoleExecutionRequirements(baseTeamRoles);
  const specialistTeamRequirement = sumDesignTeamRoleExecutionRequirements(specialistTeamRoles);
  const readyCompoundReservation = buildDesignTeamChildExecutionReservation(
    compoundReservationInput
  );
  const readyDirectDelegateReservation = buildDesignTeamSingleRoleExecutionReservation({
    ...compoundReservationInput,
    role: 'executor'
  });
  const lightweightDirectDelegateReservation = buildDesignTeamSingleRoleExecutionReservation({
    ...compoundReservationInput,
    parentBudget: {
      ...compoundParentBudget,
      maxPrimaryOutputTokens: 1200,
      allowProviderThinking: false
    },
    role: 'executor'
  });
  const specialistCompoundReservation = buildDesignTeamChildExecutionReservation({
    ...compoundReservationInput,
    plannedRoles: ['market-researcher', 'copywriter']
  });
  const weightedModelBlockedReservation = buildDesignTeamChildExecutionReservation({
    ...compoundReservationInput,
    parentBudget: {
      ...compoundParentBudget,
      maxModelCalls: 14
    }
  });
  const weightedToolBlockedReservation = buildDesignTeamChildExecutionReservation({
    ...compoundReservationInput,
    parentBudget: {
      ...compoundParentBudget,
      maxToolCalls: 10
    }
  });
  const expiredCompoundReservation = buildDesignTeamChildExecutionReservation({
    ...compoundReservationInput,
    parentActiveElapsedMs: 510_000,
    nowMs: 1_510_000
  });
  const waitedButInactiveCompoundReservation = buildDesignTeamChildExecutionReservation({
    ...compoundReservationInput,
    nowMs: 10_000_000
  });
  const childAllowanceKeys = readyCompoundReservation.status === 'ready'
    ? Object.keys(readyCompoundReservation.allowance).sort()
    : [];
  const expectedChildAllowanceKeys = [
    'deadlineAtMs',
    'maxAgentCalls',
    'maxModelCalls',
    'maxToolCalls',
    'maxVisionCandidates',
    'maxVisualAnalyses'
  ].sort();
  const compoundBudgetReservationViolations = [
    ...(AGENT_FINALIZATION_TIME_RESERVE_MS === 90_000
      && AGENT_COMPOUND_FINALIZATION_RESERVE.timeMs === AGENT_FINALIZATION_TIME_RESERVE_MS
      && performanceText.includes('timeMs: AGENT_FINALIZATION_TIME_RESERVE_MS')
      ? []
      : ['compound-budget:finalization-time-reserve-not-shared']),
    ...(DESIGN_TEAM_ROLE_EXECUTION_MINIMUMS.executor.modelCalls === 4
      && DESIGN_TEAM_ROLE_EXECUTION_MINIMUMS.executor.toolCalls === 3
      ? []
      : ['compound-budget:executor-minimum-is-not-read-write-readback-finalize']),
    ...(baseTeamRequirement.agentCalls === 4
      && baseTeamRequirement.modelCalls === 10
      && baseTeamRequirement.toolCalls === 6
      ? []
      : [`compound-budget:base-weight-drift:${JSON.stringify(baseTeamRequirement)}`]),
    ...(specialistTeamRequirement.agentCalls === 6
      && specialistTeamRequirement.modelCalls === 14
      && specialistTeamRequirement.toolCalls === 8
      ? []
      : [`compound-budget:specialist-weight-drift:${JSON.stringify(specialistTeamRequirement)}`]),
    ...(readyCompoundReservation.status === 'ready'
      && readyCompoundReservation.requiredBaseAgentCalls === 4
      && readyCompoundReservation.plannedAgentCallCeiling === 8
      && readyCompoundReservation.allowance.maxAgentCalls === 8
      && readyCompoundReservation.allowance.maxModelCalls === 24
      && readyCompoundReservation.allowance.maxToolCalls === 35
      && readyCompoundReservation.allowance.maxVisualAnalyses === 1
      && readyCompoundReservation.allowance.maxVisionCandidates === 1
      && readyCompoundReservation.allowance.deadlineAtMs === 1_510_000
      && readyCompoundReservation.parentFinalizationLimits.maxModelCalls === 5
      && readyCompoundReservation.parentFinalizationLimits.maxToolCalls === 5
      && readyCompoundReservation.parentFinalizationLimits.maxIterations === 6
      ? []
      : [`compound-budget:ready-partition-invalid:${JSON.stringify(readyCompoundReservation)}`]),
    ...(readyDirectDelegateReservation.status === 'ready'
      && readyDirectDelegateReservation.allowance.maxAgentCalls === 1
      && readyDirectDelegateReservation.allowance.maxModelCalls === 4
      && readyDirectDelegateReservation.allowance.maxToolCalls === 3
      && readyDirectDelegateReservation.parentFinalizationLimits.maxModelCalls
        === compoundParentBudget.maxModelCalls - 4
      && readyDirectDelegateReservation.parentFinalizationLimits.maxToolCalls
        === compoundParentBudget.maxToolCalls - 3
      ? []
      : [`compound-budget:direct-delegate-not-prepartitioned:${JSON.stringify(readyDirectDelegateReservation)}`]),
    ...(lightweightDirectDelegateReservation.status === 'ready'
      && lightweightDirectDelegateReservation.allowance.maxPrimaryOutputTokens === 1200
      && lightweightDirectDelegateReservation.allowance.allowProviderThinking === false
      && designTeamCoordinatorText.includes('maxPrimaryOutputTokens: childAllowance.maxPrimaryOutputTokens')
      && executorText.includes('maxPrimaryOutputTokens: childAllowance.maxPrimaryOutputTokens')
      ? []
      : [`compound-budget:child-restored-expensive-model-policy:${JSON.stringify(lightweightDirectDelegateReservation)}`]),
    ...(JSON.stringify(childAllowanceKeys) === JSON.stringify(expectedChildAllowanceKeys)
      ? []
      : [`compound-budget:child-allowance-leaks-parent-fields:${JSON.stringify(childAllowanceKeys)}`]),
    ...(specialistCompoundReservation.status === 'ready'
      && specialistCompoundReservation.requiredBaseAgentCalls === 6
      && specialistCompoundReservation.allowance.maxAgentCalls === 10
      ? []
      : [`compound-budget:planned-role-count-not-consumed:${JSON.stringify(specialistCompoundReservation)}`]),
    ...(weightedModelBlockedReservation.status === 'blocked'
      && weightedModelBlockedReservation.code === 'design_team_child_allowance_insufficient'
      ? []
      : [`compound-budget:weighted-model-shortage-not-blocked:${JSON.stringify(weightedModelBlockedReservation)}`]),
    ...(weightedToolBlockedReservation.status === 'blocked'
      && weightedToolBlockedReservation.code === 'design_team_child_allowance_insufficient'
      ? []
      : [`compound-budget:weighted-tool-shortage-not-blocked:${JSON.stringify(weightedToolBlockedReservation)}`]),
    ...(expiredCompoundReservation.status === 'blocked'
      && expiredCompoundReservation.code === 'design_team_child_deadline_unavailable'
      ? []
      : [`compound-budget:expired-child-deadline-not-blocked:${JSON.stringify(expiredCompoundReservation)}`]),
    ...(waitedButInactiveCompoundReservation.status === 'ready'
      ? []
      : [`compound-budget:inactive-wait-counted-as-execution-time:${JSON.stringify(waitedButInactiveCompoundReservation)}`]),
    ...(executorText.includes('singleRole: delegatedRole')
      && executorText.includes('stagePerformanceBudget: {')
      && agentRuntimeText.includes('this.commitDesignTeamChildAllowance(reservation.allowance)')
      && agentRuntimeText.includes('this.performanceLedger.visionCandidateCount = Math.max(')
      && agentRuntimeText.includes(') + allowance.maxVisionCandidates;')
      ? []
      : ['compound-budget:direct-delegate-production-wiring-incomplete'])
  ];
  const {
    getDesignTaskTypeSpec,
    listDesignTaskProfileCrosswalks
  } = require(taskProfilePath);
  const {
    buildDesignArtifactKnowledgeRuntimeItem,
    getDesignArtifactKnowledge,
    listDesignArtifactIds
  } = require(artifactKnowledgePath);
  const { ecommerceSocksDesignExecutor } = require(ecommerceSocksDesignExecutorPath);
  const manifestOwnedChildDispatchViolations = [];
  const modelOwnedVisualStyleViolations = [];
  const environmentRecoveryViolations = [];
  const verifiedChildCalls = [];
  const verifiedParentResult = await ecommerceSocksDesignExecutor.execute({
    params: {
      userIntent: '请完成这套袜子电商设计，包含主图、详情页和 SKU。',
      deliverables: ['main-image', 'detail-page', 'sku']
    },
    context: {
      userInput: '请完成这套袜子电商设计，包含主图、详情页和 SKU。',
      conversationHistory: [],
      isPluginConnected: true
    },
    runSkill: async (skillId, childExecuteParams) => {
      verifiedChildCalls.push({ skillId, params: childExecuteParams.params });
      return {
        success: true,
        message: '测试子 Runtime 已完成并通过质量验收。',
        data: {
          status: 'completed',
          canClaimOutputQuality: true,
          outputCount: 1
        }
      };
    }
  });
  const expectedManifestOwnedChildren = [
    ['main-image-design', 'ecommerce.main_image.v1'],
    ['detail-page-design', 'ecommerce.detail_page.v1'],
    ['sku-batch', 'ecommerce.sku_batch.v1']
  ];
  if (verifiedChildCalls.length !== expectedManifestOwnedChildren.length) {
    manifestOwnedChildDispatchViolations.push(
      `parent-workflow:unexpected-child-call-count:${verifiedChildCalls.length}`
    );
  }
  expectedManifestOwnedChildren.forEach(([declaredSkillId, declaredTaskType], index) => {
    const call = verifiedChildCalls[index];
    if (!call
      || call.skillId !== 'autonomous-agent'
      || call.params?.declaredSkillId !== declaredSkillId
      || call.params?.declaredTaskType !== declaredTaskType
      || call.params?.runtimeSelectedSkillHandoff?.skillId !== declaredSkillId
      || call.params?.runtimeSelectedSkillHandoff?.source !== 'controlled_route_react_handoff') {
      manifestOwnedChildDispatchViolations.push(
        `parent-workflow:manifest-owned-child-bypassed:${declaredSkillId}:${JSON.stringify(call || null)}`
      );
    }
  });
  const mainImageChildParams = verifiedChildCalls.find((call) => (
    call.params?.declaredSkillId === 'main-image-design'
  ))?.params;
  if (!mainImageChildParams
    || mainImageChildParams.declaredWorkMode !== 'create_new'
    || mainImageChildParams.mainImageExecutionMode === 'product-disposable-live'
    || mainImageChildParams.approvedLiveExecution === true
    || mainImageChildParams.approvedLiveAdapterRun === true
    || mainImageChildParams.userCheckpointApproved === true) {
    manifestOwnedChildDispatchViolations.push(
      `parent-workflow:main-image-default-minted-legacy-authority:${JSON.stringify(mainImageChildParams || null)}`
    );
  }
  if (verifiedParentResult.success !== true
    || verifiedParentResult.data?.ecommerceSocksChildReportAggregation?.canClaimDesignComplete !== true) {
    manifestOwnedChildDispatchViolations.push(
      `parent-workflow:verified-child-results-not-aggregated:${JSON.stringify(verifiedParentResult)}`
    );
  }
  const unverifiedParentResult = await ecommerceSocksDesignExecutor.execute({
    params: {
      userIntent: '请完成这套袜子电商设计，包含主图、详情页和 SKU。',
      deliverables: ['main-image', 'detail-page', 'sku']
    },
    context: {
      userInput: '请完成这套袜子电商设计，包含主图、详情页和 SKU。',
      conversationHistory: [],
      isPluginConnected: true
    },
    runSkill: async (_skillId, childExecuteParams) => {
      const isMainImage = childExecuteParams.params?.declaredSkillId === 'main-image-design';
      return {
        success: true,
        message: isMainImage ? '主图仍需复核。' : '子交付已通过。',
        data: {
          status: isMainImage ? 'needs_review' : 'completed',
          canClaimOutputQuality: !isMainImage,
          outputCount: 1
        }
      };
    }
  });
  if (unverifiedParentResult.success !== false
    || unverifiedParentResult.data?.ecommerceSocksChildReportAggregation?.status !== 'blocked_quality_unverified') {
    manifestOwnedChildDispatchViolations.push(
      `parent-workflow:unverified-main-image-was-reported-success:${JSON.stringify(unverifiedParentResult)}`
    );
  }
  const mainImageEvaluationProfile = getDesignEvaluationProfileById(MAIN_IMAGE_EVALUATION_PROFILE_ID);
  const mainImageLegacyQaCheck = mainImageEvaluationProfile?.checks.find((check) => (
    check.key === 'main_image_qa_report'
  ));
  if (!mainImageEvaluationProfile
    || !mainImageEvaluationProfile.assertionRefs.includes('req.brief-coverage')
    || !mainImageEvaluationProfile.assertionRefs.includes('craft.asset-integration')
    || mainImageLegacyQaCheck?.required !== false
    || mainImageEvaluationProfile.checks.find((check) => check.key === 'fresh_structure_snapshot')?.required !== true
    || mainImageEvaluationProfile.checks.find((check) => check.key === 'fresh_visual_evaluation')?.required !== true) {
    manifestOwnedChildDispatchViolations.push('main-image-profile:autonomous-quality-owner-incomplete');
  }
  const mainImageArtifactKnowledgeItem = buildDesignArtifactKnowledgeRuntimeItem({
    taskTypeId: 'ecommerce.main_image.v1',
    manifestSkillId: 'ecommerce.main_image'
  });
  if (!String(mainImageArtifactKnowledgeItem?.content || '').includes('点击图结构与版式原则')
    || !String(mainImageArtifactKnowledgeItem?.content || '').includes('主图评审检查标准')) {
    manifestOwnedChildDispatchViolations.push('main-image-knowledge:runtime-only-received-overview');
  }
  const {
    solveLayout,
    validateModelAuthoredLayout
  } = require(layoutEnginePath);
  const {
    fitRenderLayoutTextToWidth,
    resolveRenderLayoutVisualStyle
  } = require(renderLayoutStylePath);
  const neutralLayoutStyle = resolveRenderLayoutVisualStyle({ backgroundHex: '#FFFFFF' });
  const explicitNeutralLayoutStyle = resolveRenderLayoutVisualStyle({
    backgroundHex: '#FFFFFF',
    visualStyle: { mode: 'neutral_wireframe' }
  });
  if (neutralLayoutStyle.ok
    || !neutralLayoutStyle.issues?.includes('visualStyle:required_use_model_authored_or_explicit_neutral_wireframe')
    || !explicitNeutralLayoutStyle.ok
    || explicitNeutralLayoutStyle.style?.mode !== 'neutral_wireframe') {
    modelOwnedVisualStyleViolations.push(
      `render-layout-style:implicit-style-did-not-fail-closed:${JSON.stringify(neutralLayoutStyle)}`
    );
  }
  const modelAuthoredLayoutStyle = resolveRenderLayoutVisualStyle({
    backgroundHex: '#FFF8F0',
    visualStyle: {
      mode: 'model_authored',
      palette: {
        primaryTextColorHex: '#2B1712',
        secondaryTextColorHex: '#69463C',
        accentColorHex: '#C85D37',
        placeholderFillColorHex: '#D8B49B',
        sellingPointTextColorHex: '#FFF8F0',
        sellingPointFillColorHex: '#8D351F'
      },
      typography: {
        title: { fontName: 'SourceHanSansCN-Bold', fontSizeRatio: 0.52, minFontSizeRatio: 0.2, fitMode: 'none', tracking: -20, leadingRatio: 1.05 },
        subtitle: { fontName: 'SourceHanSansCN-Regular', fontSizeRatio: 0.34, minFontSizeRatio: 0.16, fitMode: 'shrink_to_width', tracking: 10, leadingRatio: 1.2 },
        body: { fontName: 'SourceHanSansCN-Regular', fontSizeRatio: 0.28, minFontSizeRatio: 0.14, fitMode: 'shrink_to_width', tracking: 0, leadingRatio: 1.35 },
        sellingPoint: { fontName: 'SourceHanSansCN-Medium', fontSizeRatio: 0.36, minFontSizeRatio: 0.16, fitMode: 'shrink_to_width', tracking: 15, leadingRatio: 1.1 }
      },
      sellingPoint: { treatment: 'text_only', cornerRadiusRatio: 0, paddingRatio: 0.02 }
    }
  });
  if (!modelAuthoredLayoutStyle.ok
    || modelAuthoredLayoutStyle.style?.mode !== 'model_authored'
    || modelAuthoredLayoutStyle.style?.provenance !== 'model_authored_visual_style'
    || modelAuthoredLayoutStyle.style?.sellingPointTreatment !== 'text_only'
    || modelAuthoredLayoutStyle.style?.typography.title.fontSizeRatio !== 0.52
    || modelAuthoredLayoutStyle.style?.typography.title.minFontSizeRatio !== 0.2
    || modelAuthoredLayoutStyle.style?.typography.title.fitMode !== 'none'
    || modelAuthoredLayoutStyle.style?.typography.title.tracking !== -20
    || modelAuthoredLayoutStyle.style?.typography.title.fontName !== 'SourceHanSansCN-Bold'
    || modelAuthoredLayoutStyle.style?.sellingPointPaddingRatio !== 0.02
    || modelAuthoredLayoutStyle.style?.pageTextColorHex !== '#2B1712') {
    modelOwnedVisualStyleViolations.push(
      `render-layout-style:model-authored-style-was-overwritten:${JSON.stringify(modelAuthoredLayoutStyle)}`
    );
  }
  const incompleteModelAuthoredLayoutStyle = resolveRenderLayoutVisualStyle({
    backgroundHex: '#FFFFFF',
    visualStyle: { mode: 'model_authored' }
  });
  if (incompleteModelAuthoredLayoutStyle.ok
    || !incompleteModelAuthoredLayoutStyle.issues.some((issue) => issue.includes('visualStyle.palette'))
    || !incompleteModelAuthoredLayoutStyle.issues.some((issue) => issue.includes('minFontSizeRatio'))
    || !incompleteModelAuthoredLayoutStyle.issues.some((issue) => issue.includes('paddingRatio'))) {
    modelOwnedVisualStyleViolations.push(
      `render-layout-style:incomplete-model-style-used-hidden-defaults:${JSON.stringify(incompleteModelAuthoredLayoutStyle)}`
    );
  }
  const solidBoxWithoutFillLayoutStyle = resolveRenderLayoutVisualStyle({
    backgroundHex: '#FFFFFF',
    visualStyle: {
      mode: 'model_authored',
      palette: {
        primaryTextColorHex: '#101010',
        secondaryTextColorHex: '#303030',
        accentColorHex: '#804020',
        placeholderFillColorHex: '#D0D0D0',
        sellingPointTextColorHex: '#FFFFFF'
      },
      typography: {
        title: { fontSizeRatio: 0.5, minFontSizeRatio: 0.2, fitMode: 'none', tracking: 0, leadingRatio: 1.1 },
        subtitle: { fontSizeRatio: 0.35, minFontSizeRatio: 0.16, fitMode: 'none', tracking: 0, leadingRatio: 1.2 },
        body: { fontSizeRatio: 0.3, minFontSizeRatio: 0.14, fitMode: 'none', tracking: 0, leadingRatio: 1.3 },
        sellingPoint: { fontSizeRatio: 0.35, minFontSizeRatio: 0.16, fitMode: 'none', tracking: 0, leadingRatio: 1.1 }
      },
      sellingPoint: { treatment: 'solid_box', cornerRadiusRatio: 0.1, paddingRatio: 0.05 }
    }
  });
  if (solidBoxWithoutFillLayoutStyle.ok
    || !solidBoxWithoutFillLayoutStyle.issues.some((issue) => issue.includes('sellingPointFillColorHex'))) {
    modelOwnedVisualStyleViolations.push(
      `render-layout-style:solid-box-used-hidden-fill:${JSON.stringify(solidBoxWithoutFillLayoutStyle)}`
    );
  }
  const explicitContainPlacement = {
    fit: 'contain',
    anchor: 'center',
    scale: 1,
    rotation: 0,
    mask: 'none',
    overflow: 'visible',
    cropPolicy: 'avoid-crop'
  };
  const missingFormalBlockFields = validateModelAuthoredLayout({
    mode: 'blocks',
    blocks: [{ id: '标题', role: 'title', content: '明确主张' }]
  });
  const validFormalBlocks = validateModelAuthoredLayout({
    mode: 'blocks',
    marginScale: 2,
    gapScale: 1,
    blocks: [
      { id: '背景', role: 'background', content: '#FFFFFF' },
      { id: '标题', role: 'title', content: '明确主张', heightRatio: 0.2, widthRatio: 0.63, hAlign: 'right' },
      { id: '主体', role: 'main-image', content: 'asset.png', heightRatio: 0.7, widthRatio: 0.72, imagePlacement: explicitContainPlacement }
    ]
  });
  const missingFormalImagePlacement = validateModelAuthoredLayout({
    mode: 'blocks',
    marginScale: 2,
    gapScale: 1,
    blocks: [
      { id: '背景', role: 'background', content: '#FFFFFF' },
      { id: '主体', role: 'main-image', content: 'asset.png', heightRatio: 0.7, widthRatio: 0.72 }
    ]
  });
  const validImageDecorationWithoutAlignment = validateModelAuthoredLayout({
    mode: 'blocks',
    marginScale: 2,
    gapScale: 1,
    blocks: [{
      id: '图片装饰',
      role: 'decoration',
      content: 'badge.webp',
      heightRatio: 0.2,
      widthRatio: 0.2,
      imagePlacement: explicitContainPlacement
    }]
  });
  const missingTextDecorationAlignment = validateModelAuthoredLayout({
    mode: 'blocks',
    marginScale: 2,
    gapScale: 1,
    blocks: [{
      id: '文字装饰',
      role: 'decoration',
      content: '新品',
      heightRatio: 0.2,
      widthRatio: 0.2
    }]
  });
  const missingFormalBackgroundColor = validateModelAuthoredLayout({
    mode: 'blocks',
    marginScale: 2,
    gapScale: 1,
    blocks: [{ id: '背景', role: 'background' }]
  });
  const validFormalSolve = solveLayout({
    canvas: { width: 1000, height: 1000 },
    marginScale: 2,
    gapScale: 1,
    blocks: [
      { id: '标题', role: 'title', content: '明确主张', heightRatio: 0.2, widthRatio: 0.63, hAlign: 'right' },
      { id: '主体', role: 'main-image', content: 'asset.png', heightRatio: 0.7, widthRatio: 0.72, hAlign: 'center' }
    ]
  });
  const solvedFormalTitle = validFormalSolve.blocks.find((block) => block.id === '标题');
  if (missingFormalBlockFields.valid
    || !missingFormalBlockFields.issues.some((issue) => issue.startsWith('marginScale:'))
    || !missingFormalBlockFields.issues.some((issue) => issue.startsWith('gapScale:'))
    || !missingFormalBlockFields.issues.some((issue) => issue.includes('.heightRatio:'))
    || !missingFormalBlockFields.issues.some((issue) => issue.includes('.widthRatio:'))
    || !missingFormalBlockFields.issues.some((issue) => issue.includes('.hAlign:'))
    || !validFormalBlocks.valid
    || missingFormalImagePlacement.valid
    || !missingFormalImagePlacement.issues.some((issue) => issue.includes('.imagePlacement:'))
    || !validImageDecorationWithoutAlignment.valid
    || missingTextDecorationAlignment.valid
    || !missingTextDecorationAlignment.issues.some((issue) => issue.includes('.hAlign:'))
    || missingFormalBackgroundColor.valid
    || !missingFormalBackgroundColor.issues.some((issue) => issue.includes('.content:'))
    || solvedFormalTitle?.hAlign !== 'right'
    || solvedFormalTitle?.width !== Math.round((validFormalSolve.grid?.liveArea.width || 0) * 0.63)) {
    modelOwnedVisualStyleViolations.push(
      `render-layout-structure:model-authored-block-contract-drift:${JSON.stringify({
        missingFormalBlockFields,
        validFormalBlocks,
        missingFormalImagePlacement,
        validImageDecorationWithoutAlignment,
        missingTextDecorationAlignment,
        missingFormalBackgroundColor,
        solvedFormalTitle
      })}`
    );
  }
  const missingFormalRegionAlignment = validateModelAuthoredLayout({
    mode: 'regions',
    regions: [{
      id: '标题',
      role: 'title',
      content: '明确主张',
      bounds: { x: 0.1, y: 0.1, width: 0.8, height: 0.16 }
    }]
  });
  const validFormalRegionsWithoutColumns = validateModelAuthoredLayout({
    mode: 'regions',
    regions: [{
      id: '标题',
      role: 'title',
      content: '明确主张',
      hAlign: 'right',
      bounds: { x: 0.1, y: 0.1, width: 0.8, height: 0.16 }
    }]
  });
  const missingFormalRegionGridScales = validateModelAuthoredLayout({
    mode: 'regions',
    columns: 2,
    regions: [{
      id: '标题',
      role: 'title',
      content: '明确主张',
      hAlign: 'left',
      bounds: { x: 0.1, y: 0.1, width: 0.35, height: 0.16 }
    }]
  });
  const validFormalRegionsWithColumns = validateModelAuthoredLayout({
    mode: 'regions',
    columns: 2,
    marginScale: 2,
    gutterScale: 1,
    regions: [{
      id: '标题',
      role: 'title',
      content: '明确主张',
      hAlign: 'left',
      bounds: { x: 0.1, y: 0.1, width: 0.35, height: 0.16 }
    }]
  });
  const overflowingFormalRegion = validateModelAuthoredLayout({
    mode: 'regions',
    regions: [{
      id: '越界标题',
      role: 'title',
      content: '不能静默夹回',
      hAlign: 'left',
      bounds: { x: 0.8, y: 0.1, width: 0.4, height: 0.16 }
    }]
  });
  const validImageRegionWithoutAlignment = validateModelAuthoredLayout({
    mode: 'regions',
    regions: [{
      id: '图片标签',
      role: 'tag',
      content: 'badge.png',
      bounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.16 },
      imagePlacement: explicitContainPlacement
    }]
  });
  if (missingFormalRegionAlignment.valid
    || !missingFormalRegionAlignment.issues.some((issue) => issue.includes('.hAlign:'))
    || missingFormalRegionAlignment.issues.some((issue) => issue.startsWith('marginScale:') || issue.startsWith('gutterScale:'))
    || !validFormalRegionsWithoutColumns.valid
    || missingFormalRegionGridScales.valid
    || !missingFormalRegionGridScales.issues.some((issue) => issue.startsWith('marginScale:'))
    || !missingFormalRegionGridScales.issues.some((issue) => issue.startsWith('gutterScale:'))
    || !validFormalRegionsWithColumns.valid
    || overflowingFormalRegion.valid
    || !overflowingFormalRegion.issues.some((issue) => issue.includes('x_plus_width'))
    || !validImageRegionWithoutAlignment.valid) {
    modelOwnedVisualStyleViolations.push(
      `render-layout-structure:model-authored-region-contract-drift:${JSON.stringify({
        missingFormalRegionAlignment,
        validFormalRegionsWithoutColumns,
        missingFormalRegionGridScales,
        validFormalRegionsWithColumns,
        overflowingFormalRegion,
        validImageRegionWithoutAlignment
      })}`
    );
  }
  const exactNoFitText = fitRenderLayoutTextToWidth({
    content: '一个不会被隐藏最小字号覆盖的长标题',
    maxWidth: 20,
    desiredFontSize: 12,
    minFontSize: 6,
    fitMode: 'none',
    tracking: 120
  });
  const noTrackingFit = fitRenderLayoutTextToWidth({
    content: 'ABCDE',
    maxWidth: 70,
    desiredFontSize: 20,
    minFontSize: 5,
    fitMode: 'shrink_to_width',
    tracking: 0
  });
  const trackedFit = fitRenderLayoutTextToWidth({
    content: 'ABCDE',
    maxWidth: 70,
    desiredFontSize: 20,
    minFontSize: 5,
    fitMode: 'shrink_to_width',
    tracking: 200
  });
  const exactWhitespaceText = '  标题  \n副标题  ';
  const exactWhitespaceFit = fitRenderLayoutTextToWidth({
    content: exactWhitespaceText,
    maxWidth: 10,
    desiredFontSize: 20,
    minFontSize: 8,
    fitMode: 'none',
    tracking: 0
  });
  const wrappedWhitespaceText = 'A  B\nC D';
  const wrappedWhitespaceFit = fitRenderLayoutTextToWidth({
    content: wrappedWhitespaceText,
    maxWidth: 18,
    desiredFontSize: 20,
    minFontSize: 20,
    fitMode: 'shrink_to_width',
    tracking: 0
  });
  const stripLineBreaks = (value) => String(value).replace(/\r\n|\r|\n/g, '');
  if (exactNoFitText.fontSize !== 12
    || exactNoFitText.content !== '一个不会被隐藏最小字号覆盖的长标题'
    || exactNoFitText.fitApplied
    || noTrackingFit.fontSize !== 20
    || !(trackedFit.fontSize < noTrackingFit.fontSize)
    || trackedFit.fontSize < 5
    || exactWhitespaceFit.content !== exactWhitespaceText
    || exactWhitespaceFit.fitApplied
    || stripLineBreaks(wrappedWhitespaceFit.content) !== stripLineBreaks(wrappedWhitespaceText)
    || !wrappedWhitespaceFit.wrapped
    || (wrappedWhitespaceFit.content.match(/\r\n|\r|\n/g) || []).length
      < (wrappedWhitespaceText.match(/\r\n|\r|\n/g) || []).length) {
    modelOwnedVisualStyleViolations.push(
      `render-layout-typography:model-values-were-silently-rewritten:${JSON.stringify({
        exactNoFitText,
        noTrackingFit,
        trackedFit,
        exactWhitespaceFit,
        wrappedWhitespaceFit
      })}`
    );
  }
  const { generateToolSchemas } = require(toolSchemasPath);
  const renderLayoutSchema = generateToolSchemas().find((tool) => tool.name === 'renderLayout')?.inputSchema;
  const skuLayoutPublicSchema = generateToolSchemas().find((tool) => tool.name === 'skuLayout')?.inputSchema;
  const visualStyleSchema = renderLayoutSchema?.properties?.visualStyle;
  const modelStyleSchemaBranch = visualStyleSchema?.oneOf?.find((branch) => (
    branch?.properties?.mode?.enum?.includes('model_authored')
  ));
  const typographyRequired = visualStyleSchema?.properties?.typography?.properties?.title?.required || [];
  const sellingPointRequired = visualStyleSchema?.properties?.sellingPoint?.required || [];
  const solidBoxFillRule = visualStyleSchema?.allOf?.find((rule) => (
    rule?.if?.properties?.sellingPoint?.properties?.treatment?.enum?.includes('solid_box')
  ));
  const modelAuthoredRegionSchemaBranch = renderLayoutSchema?.allOf?.find((branch) => (
    branch?.if?.required?.includes('regions')
  ));
  const modelAuthoredBlockSchemaBranch = renderLayoutSchema?.allOf?.find((branch) => (
    branch?.if?.required?.includes('blocks')
  ));
  const modelAuthoredBlockItemRules = modelAuthoredBlockSchemaBranch
    ?.then?.properties?.blocks?.items?.allOf || [];
  const modelAuthoredRegionItemRules = modelAuthoredRegionSchemaBranch
    ?.then?.properties?.regions?.items?.allOf || [];
  const modelAuthoredRegionColumnRule = modelAuthoredRegionSchemaBranch?.then?.allOf?.[0];
  const imagePlacementSchema = renderLayoutSchema?.properties?.blocks?.items?.properties?.imagePlacement;
  const regionBoundsSchema = renderLayoutSchema?.properties?.regions?.items?.properties?.bounds;
  const hasRequiredRuleForRoles = (rules, roles, requiredField) => rules.some((rule) => {
    const ruleRoles = rule?.if?.properties?.role?.enum || [];
    return roles.every((role) => ruleRoles.includes(role))
      && rule?.then?.required?.includes(requiredField);
  });
  const hasBackgroundColorRule = (rules) => rules.some((rule) => (
    rule?.if?.properties?.role?.enum?.includes('background')
    && rule?.then?.required?.includes('content')
    && rule?.then?.properties?.content?.pattern === '^#[0-9a-fA-F]{6}$'
  ));
  if (!modelStyleSchemaBranch?.required?.includes('palette')
    || !modelStyleSchemaBranch?.required?.includes('typography')
    || !modelStyleSchemaBranch?.required?.includes('sellingPoint')
    || !typographyRequired.includes('minFontSizeRatio')
    || !typographyRequired.includes('fitMode')
    || !sellingPointRequired.includes('cornerRadiusRatio')
    || !sellingPointRequired.includes('paddingRatio')
    || !solidBoxFillRule?.then?.properties?.palette?.required?.includes('sellingPointFillColorHex')
    || !Array.isArray(renderLayoutSchema?.allOf)
    || !modelAuthoredBlockItemRules.some((rule) => rule?.then?.required?.includes('heightRatio'))
    || !modelAuthoredBlockItemRules.some((rule) => rule?.then?.required?.includes('widthRatio'))
    || !hasRequiredRuleForRoles(modelAuthoredBlockItemRules, ['title', 'subtitle', 'selling-point'], 'hAlign')
    || !hasRequiredRuleForRoles(modelAuthoredBlockItemRules, ['main-image', 'tag', 'decoration'], 'imagePlacement')
    || !hasBackgroundColorRule(modelAuthoredBlockItemRules)
    || !modelAuthoredRegionItemRules.some((rule) => rule?.then?.required?.includes('bounds'))
    || !hasRequiredRuleForRoles(modelAuthoredRegionItemRules, ['title', 'subtitle', 'selling-point'], 'hAlign')
    || !hasRequiredRuleForRoles(modelAuthoredRegionItemRules, ['main-image', 'tag', 'decoration'], 'imagePlacement')
    || !hasBackgroundColorRule(modelAuthoredRegionItemRules)
    || !modelAuthoredRegionColumnRule?.if?.required?.includes('columns')
    || !modelAuthoredRegionColumnRule?.then?.required?.includes('marginScale')
    || !modelAuthoredRegionColumnRule?.then?.required?.includes('gutterScale')
    || !['fit', 'anchor', 'scale', 'rotation', 'mask', 'overflow'].every((field) => (
      imagePlacementSchema?.required?.includes(field)
    ))
    || regionBoundsSchema?.properties?.x?.minimum !== 0
    || regionBoundsSchema?.properties?.x?.maximum !== 1
    || regionBoundsSchema?.properties?.width?.exclusiveMinimum !== 0
    || !['x', 'y', 'width', 'height'].every((field) => regionBoundsSchema?.required?.includes(field))) {
    modelOwnedVisualStyleViolations.push('render-layout-schema:model-authored-schema-runtime-contract-drift');
  }
  const unreadableLayoutStyle = resolveRenderLayoutVisualStyle({
    backgroundHex: '#FFFFFF',
    visualStyle: {
      mode: 'model_authored',
      palette: {
        primaryTextColorHex: '#EEEEEE',
        secondaryTextColorHex: '#DDDDDD',
        accentColorHex: '#CCCCCC',
        sellingPointTextColorHex: '#EEEEEE',
        sellingPointFillColorHex: '#FFFFFF'
      },
      typography: {
        title: { fontSizeRatio: 0.5, minFontSizeRatio: 0.2, fitMode: 'none', tracking: 0, leadingRatio: 1.1 },
        subtitle: { fontSizeRatio: 0.35, minFontSizeRatio: 0.16, fitMode: 'shrink_to_width', tracking: 0, leadingRatio: 1.2 },
        body: { fontSizeRatio: 0.3, minFontSizeRatio: 0.14, fitMode: 'shrink_to_width', tracking: 0, leadingRatio: 1.3 },
        sellingPoint: { fontSizeRatio: 0.35, minFontSizeRatio: 0.16, fitMode: 'shrink_to_width', tracking: 0, leadingRatio: 1.1 }
      },
      sellingPoint: { treatment: 'solid_box', cornerRadiusRatio: 0.1, paddingRatio: 0.05 }
    }
  });
  if (unreadableLayoutStyle.ok
    || !unreadableLayoutStyle.issues.some((issue) => issue.includes('contrast_below_3'))) {
    modelOwnedVisualStyleViolations.push(
      `render-layout-style:unreadable-model-style-was-accepted:${JSON.stringify(unreadableLayoutStyle)}`
    );
  }
  const mainImageCreativeManifest = listSkillManifests().find((manifest) => (
    manifest.skill_id === 'ecommerce.main_image'
  ));
  const requiredMainImageCreativeCapabilities = [
    'knowledge.read.designFoundation',
    'memory.designProjectState',
    'photoshop.sandbox.createShape',
    'photoshop.sandbox.manageLayers',
    'photoshop.sandbox.editSmartObject'
  ];
  if (!mainImageCreativeManifest
    || mainImageCreativeManifest.reference_policy?.work_mode_requirements?.create_new !== 'reuse_or_optional'
    || requiredMainImageCreativeCapabilities.some((capability) => (
      !mainImageCreativeManifest.available_tools.includes(capability)
    ))) {
    modelOwnedVisualStyleViolations.push('main-image-manifest:model-creative-capability-surface-incomplete');
  }
  if (!toolExecutorText.includes('resolveRenderLayoutVisualStyle({')
    || !toolExecutorText.includes('validateModelAuthoredLayout({')
    || !toolExecutorText.includes('rendersLayoutBlockAsImage')
    || !toolExecutorText.includes("mode: regionMode ? 'regions' : 'blocks'")
    || !toolExecutorText.includes('fitRenderLayoutTextToWidth({')
    || !toolExecutorText.includes('textFitReceipts: textFitReceipts.length > 0')
    || !toolExecutorText.includes("version: 'render-layout-owner/v1'")
    || !toolExecutorText.includes('names.add(id);')
    || !toolExecutorText.includes('names.add(`${id}-占位`);')
    || !toolExecutorText.includes("code: 'render_layout_neutral_wireframe_unresolved'")
    || !toolExecutorText.includes("provenance: style.provenance")
    || toolExecutorText.includes('Math.max(18, Math.round(b.height *')
    || toolExecutorText.includes('fitLayoutTextToWidth(')
    || uxpNormalizeTextContentText.includes('.trim()')
    || !uxpNormalizeTextContentText.includes('normalizePhotoshopTextContent(content)')
    || !uxpCreateTextLayerText.includes('if (!content.trim())')
    || toolExecutorText.indexOf('resolveRenderLayoutVisualStyle({') > toolExecutorText.indexOf('deletePreviousStageGroup')) {
    modelOwnedVisualStyleViolations.push('render-layout-style:production-wiring-does-not-validate-before-mutation');
  }
  if (!composeDesignSpecText.includes("export type ComposeDesignLayoutMode = 'agent_authored'")
    || !composeDesignSpecText.includes('内置版式配方已移除')
    || !composeDesignSpecText.includes('Harness 不按底色派生字色')
    || composeDesignExecutorText.includes("executeToolCall('evaluateDesign'")
    || composeDesignExecutorText.includes('等待 Photoshop 落定')
    || !composeDesignExecutorText.includes('visualStyle: spec.layout.visualStyle')
    || !composeDesignExecutorText.includes('groupName: spec.layout.groupName')
    || !toolExecutorText.includes('内置版式配方已移除')
    || /expandLayoutRecipe|recipeExpansion/.test(toolExecutorText)
    || !toolExecutorText.includes("version: 'render-layout-layer-structure/v1'")
    || toolSchemasText.includes('【首稿首选 recipe 模式】')) {
    modelOwnedVisualStyleViolations.push('compose-design:harness-can-still-impersonate-design-authorship');
  }
  const composeDisablesAutomaticBusyRetry = !composeDesignExecutorText.includes('isRetryablePhotoshopBusyFailure')
    && !composeDesignExecutorText.includes('isTransientPhotoshopBusyFailure')
    && !composeDesignExecutorText.includes('（忙碌后重试）')
    && !composeDesignExecutorText.includes('await sleep(2000)');
  const composePreservesModalRecoveryEvidence = composeDesignExecutorText.includes(
    'readComposeEnvironmentRecoveryEvidence'
  )
    && composeDesignExecutorText.includes('readPhotoshopModalRecoveryEvidence')
    && agentReActObservationContractText.includes("environmentState: 'photoshop_native_modal_suspected'")
    && agentReActObservationContractText.includes("capability: 'capturePhotoshopWindow'")
    && agentReActObservationContractText.includes("scope: 'adobe_photoshop_application_window'")
    && agentReActObservationContractText.includes("record?.success !== false")
    && agentReActObservationContractText.includes("record.recoveryRequired !== true")
    && toolExecutorText.includes('const modalRecoveryResult = isPhotoshopNativeModalTimeout(errorMessage)')
    && toolExecutorText.includes('readPhotoshopModalRecoveryEvidence(modalRecoveryResult)')
    && toolExecutorText.includes('environmentObservation: modalRecovery.environmentObservation')
    && toolExecutorText.includes('attachPhotoshopModalRecoveryEvidenceIfUnresolved(')
    && composeDesignExecutorText.includes('settlementEnvironmentRecovery');
  if (!toolSchemasText.includes("name: 'capturePhotoshopWindow'")
    || !toolExecutorText.includes("toolName === 'capturePhotoshopWindow'")
    || !toolExecutorText.includes("environmentState: 'photoshop_native_modal_suspected'")
    || !toolExecutorText.includes("capability: 'capturePhotoshopWindow'")
    // 复合设计写不能因“busy”重放整单；失败必须把真实 modal 观察出口投影回 Agent。
    || !composeDisablesAutomaticBusyRetry
    || !composePreservesModalRecoveryEvidence
    // 普通只读观察的瞬态退避仍只消费 shared 单一真相源，写类不进入该重试路径。
    || !toolExecutorText.includes('isTransientPhotoshopBusyFailure(result)')
    || !photoshopTransientErrorText.includes('photoshop_native_modal_suspected')
    || !screenshotHandlersText.includes("types: ['window']")
    || !screenshotHandlersText.includes("source: 'photoshop-window'")
    || !toolSchemasText.includes('It is not a canvas-quality check')
    || !toolSchemasText.includes('must not become a generic task-opening screenshot')
    || !agentToolExecutionPreflightText.includes("'capturePhotoshopWindow'")) {
    environmentRecoveryViolations.push('photoshop-modal:agent-visible-window-observation-or-no-blind-retry-boundary-missing');
  }
  const { buildDesignMethodKnowledgeRuntimeContext } = require(runtimeMethodKnowledgePath);
  const {
    buildPhotoshopCraftRecipeRuntimeItems,
    listPhotoshopCraftRecipes,
    listGeneralPhotoshopCraftRecipes
  } = require(photoshopCraftRecipesPath);
  const { searchLocalDesignKnowledge } = require(designKnowledgeSearchPath);
  const { computeSubjectFitToRegion, verifySubjectFitResult } = require(subjectFitPath);
  const {
    buildGenerationScopedDataContextItems,
    canReenterAfterGenerationProjectStateRefresh,
    compileRuntimeContext,
    hasSuccessfulGenerationProjectStateUpdate,
    readLatestOwnerConfirmedGenerationProjectState,
    selectRuntimeContextItemsForStage
  } = require(runtimeContextCompilerPath);
  const {
    buildDesignReviewSetFromBundle,
    buildDesignReviewSetFromSingleSurface,
    VISUAL_OBSERVATION_BUNDLE_VERSION
  } = require(visualObservationBundlePath);
  const {
    countUnbilledDesignReviewImages,
    planDesignReviewImages,
    resolveDirectVisionCandidateCharge,
    resolveFinalQualityVisionCandidateReserve,
    resolveVisionCandidateLimitForFinalQuality,
    resolveDesignReviewSetItemForDiagnosis,
    selectDesignReviewSetForFinalJudge
  } = require(designVisualJudgeObservationPath);
  const {
    findLatestRuntimeVisualReviewEvidence,
    resolveDesignTeamStageVisualBudget
  } = require(designTeamCoordinatorPath);
  const {
    readTrustedVisualReviewArtifact,
    transferTrustedVisualReviewArtifact,
    writeTrustedVisualReviewArtifact
  } = require(trustedVisualReviewArtifactPath);
  const {
    deriveAgentVisualObservationReceipt,
    writeAgentVisualObservation,
    writeAgentVisualObservationReceipt
  } = require(visualObservationStrategyPath);
  const {
    buildToolResultImageFromVisualObservationItem,
    collectImagesFromToolResult,
    projectSkillWorkflowOutputForModel,
    sanitizeToolOutputForModel
  } = require(toolResultSanitizerPath);
  const { markExecutedToolResultProvenance } = require(toolResultProvenancePath);
  const {
    prepareAgentMessagesForModel,
    retireDeliveredAgentMessageImages
  } = require(agentMessageContextPath);
  const {
    buildDesignerAgentTeamConsultationContract,
    buildDesignerAgentTeamConsultationProgress
  } = require(designerAgentTeamConsultationPath);
  const {
    classifyRuntimeReferenceFailure,
    projectRuntimeReferencePolicy,
    resolveRuntimeReferenceFailureDisposition
  } = require(runtimeReferenceContextPath);
  const runtimeReferenceFailurePolicyViolations = [];
  const optionalReferencePolicy = projectRuntimeReferencePolicy({
    version: 'skill-reference-policy/v0',
    work_mode_requirements: {
      create_new: 'reuse_or_optional',
      redesign: 'reuse_or_optional',
      template_fill: 'reuse_or_optional',
      edit_existing: 'not_required',
      analyze_only: 'not_required',
      export_only: 'not_required'
    },
    allowed_sources: ['user_reference', 'brand_template', 'project_case', 'eagle', 'web'],
    max_search_rounds: 2,
    unavailable_behavior: 'continue_degraded'
  });
  const requiredContinueReferencePolicy = projectRuntimeReferencePolicy({
    ...optionalReferencePolicy,
    work_mode_requirements: {
      ...optionalReferencePolicy.work_mode_requirements,
      create_new: 'required'
    },
    allowed_sources: [...optionalReferencePolicy.allowed_sources]
  });
  const requiredBlockReferencePolicy = projectRuntimeReferencePolicy({
    ...requiredContinueReferencePolicy,
    work_mode_requirements: { ...requiredContinueReferencePolicy.work_mode_requirements },
    allowed_sources: [...requiredContinueReferencePolicy.allowed_sources],
    unavailable_behavior: 'block'
  });
  function expectReferenceFailureDisposition(label, input, expected) {
    const actual = resolveRuntimeReferenceFailureDisposition(input);
    if (actual !== expected) {
      runtimeReferenceFailurePolicyViolations.push(`${label}:${String(actual)}!=${String(expected)}`);
    }
  }
  const unavailableReferenceFailure = {
    success: false,
    status: 'unavailable',
    code: 'tool_execution_failed',
    elapsedMs: 321
  };
  const unavailableReferenceFailureSnapshot = JSON.stringify(unavailableReferenceFailure);
  expectReferenceFailureDisposition('optional-search-unavailable', {
    policy: optionalReferencePolicy,
    workMode: 'create_new',
    toolName: 'searchEagleReferences',
    result: unavailableReferenceFailure
  }, 'non_blocking_observation');
  expectReferenceFailureDisposition('all-modes-optional-before-work-mode-declaration', {
    policy: optionalReferencePolicy,
    toolName: 'searchEagleReferences',
    result: unavailableReferenceFailure
  }, 'non_blocking_observation');
  expectReferenceFailureDisposition('mixed-required-modes-await-work-mode-declaration', {
    policy: requiredContinueReferencePolicy,
    toolName: 'searchEagleReferences',
    result: unavailableReferenceFailure
  }, undefined);
  expectReferenceFailureDisposition('not-required-visual-not-found', {
    policy: optionalReferencePolicy,
    workMode: 'edit_existing',
    toolName: 'analyzeEagleReference',
    result: { success: false, status: 'not_found' }
  }, 'non_blocking_observation');
  expectReferenceFailureDisposition('required-awaits-degraded-declaration', {
    policy: requiredContinueReferencePolicy,
    workMode: 'create_new',
    toolName: 'searchEagleReferences',
    result: { success: false, status: 'unavailable' }
  }, undefined);
  expectReferenceFailureDisposition('required-validated-degraded', {
    policy: requiredContinueReferencePolicy,
    workMode: 'create_new',
    toolName: 'searchEagleReferences',
    result: { success: false, status: 'unavailable' },
    referenceReadiness: 'degraded'
  }, 'non_blocking_observation');
  expectReferenceFailureDisposition('required-block-never-degrades', {
    policy: requiredBlockReferencePolicy,
    workMode: 'create_new',
    toolName: 'searchEagleReferences',
    result: { success: false, status: 'unavailable' },
    referenceReadiness: 'degraded'
  }, undefined);
  [
    ['invalid-input', 'invalid_argument'],
    ['permission', 'permission_denied'],
    ['safety', 'safety_blocked'],
    ['protocol', 'provider_protocol_error']
  ].forEach(([label, code]) => {
    expectReferenceFailureDisposition(label, {
      policy: optionalReferencePolicy,
      workMode: 'create_new',
      toolName: 'searchEagleReferences',
      result: { success: false, status: 'unavailable', code }
    }, undefined);
  });
  expectReferenceFailureDisposition('unregistered-reference-provider', {
    policy: optionalReferencePolicy,
    workMode: 'create_new',
    toolName: 'someOtherSearchTool',
    result: { success: false, status: 'unavailable' }
  }, undefined);
  expectReferenceFailureDisposition('unclassified-failure', {
    policy: optionalReferencePolicy,
    workMode: 'create_new',
    toolName: 'searchEagleReferences',
    result: { success: false, code: 'tool_execution_failed' }
  }, undefined);
  if (classifyRuntimeReferenceFailure({
    success: false,
    status: 'unavailable',
    code: 'provider_protocol_error'
  }) !== 'protocol_error') {
    runtimeReferenceFailurePolicyViolations.push('structured-protocol-category-not-fail-closed');
  }
  if (!optionalReferencePolicy
    || !Object.isFrozen(optionalReferencePolicy)
    || !Object.isFrozen(optionalReferencePolicy.work_mode_requirements)
    || !Object.isFrozen(optionalReferencePolicy.allowed_sources)) {
    runtimeReferenceFailurePolicyViolations.push('manifest-reference-policy-projection-not-deep-frozen');
  }
  if (JSON.stringify(unavailableReferenceFailure) !== unavailableReferenceFailureSnapshot
    || unavailableReferenceFailure.success !== false
    || unavailableReferenceFailure.elapsedMs !== 321) {
    runtimeReferenceFailurePolicyViolations.push('reference-disposition-mutated-real-failure-facts');
  }
  const eagleFallbackCalls = [];
  const eagleFallbackResponse = await EagleReadonlyKnowledgeService.search({
    query: '电商 主图',
    limit: 4,
    preferAiSearch: true
  }, {
    settings: {
      enabled: true,
      endpoint: 'http://eagle-audit.invalid',
      timeoutMs: 5000
    },
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      const tool = body.name || body.tool;
      const args = body.arguments || body.params || {};
      eagleFallbackCalls.push({ tool, query: args.query, limit: args.limit });
      let result = [];
      if (tool === 'ai_search_status') result = { status: 'starting' };
      if (tool === 'item_query' && args.query === '电商') {
        result = [1, 2, 3, 4].map((index) => ({
          id: `eagle-commerce-${index}`,
          name: `电商候选 ${index}`,
          ext: 'jpg',
          tags: ['分类:电商'],
          folders: [],
          width: 1000,
          height: 1000,
          filePath: `C:\\private\\commerce-${index}.jpg`
        }));
      }
      if (tool === 'item_query' && args.query === '主图') {
        result = [1, 2, 3, 4].map((index) => ({
          id: index === 1 ? 'eagle-commerce-1' : `eagle-main-image-${index}`,
          name: `主图候选 ${index}`,
          ext: 'jpg',
          tags: ['分类:主图参考'],
          folders: [],
          width: 1000,
          height: 1000,
          thumbnailPath: `D:\\private\\main-image-${index}.jpg`
        }));
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ result })
      };
    }
  });
  const eagleAiReadyCalls = [];
  const eagleAiReadyResponse = await EagleReadonlyKnowledgeService.search({
    query: '专业袜子主图',
    limit: 3,
    preferAiSearch: true
  }, {
    settings: {
      enabled: true,
      endpoint: 'http://eagle-audit.invalid',
      timeoutMs: 5000
    },
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      const tool = body.name || body.tool;
      const args = body.arguments || body.params || {};
      eagleAiReadyCalls.push({ tool, query: args.query, limit: args.limit });
      const result = tool === 'ai_search_status'
        ? { status: 'ready' }
        : [{
          id: 'eagle-ai-ready-reference',
          name: 'AI 语义参考',
          ext: 'jpg',
          tags: ['分类:主图参考'],
          folders: [],
          width: 1200,
          height: 1200,
          filePath: 'C:\\private\\ai-ready-reference.jpg'
        }];
      return {
        ok: true,
        status: 200,
        json: async () => ({ result })
      };
    }
  });
  const eagleAiStatusTimeoutCalls = [];
  let eagleAiStatusAttempted = false;
  const eagleAiStatusTimeoutResponse = await EagleReadonlyKnowledgeService.search({
    query: '主图',
    limit: 2,
    preferAiSearch: true
  }, {
    settings: {
      enabled: true,
      endpoint: 'http://eagle-audit.invalid',
      timeoutMs: 5000
    },
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      const tool = body.name || body.tool;
      const args = body.arguments || body.params || {};
      eagleAiStatusTimeoutCalls.push({ tool, query: args.query });
      if (tool === 'ai_search_status') {
        eagleAiStatusAttempted = true;
        throw new Error('simulated AI status timeout');
      }
      if (tool === 'item_query') {
        if (eagleAiStatusAttempted) {
          throw new Error('item_query was incorrectly deferred until after AI status');
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            result: [{
              id: 'eagle-keyword-before-status',
              name: '关键词主图参考',
              ext: 'jpg',
              tags: ['分类:主图参考'],
              folders: [],
              width: 1000,
              height: 1000,
              filePath: 'C:\\private\\keyword-before-status.jpg'
            }]
          })
        };
      }
      throw new Error(`unexpected Eagle tool: ${tool}`);
    }
  });
  const eagleAiSemanticTimeoutCalls = [];
  let eagleAiSemanticAttempted = false;
  const eagleAiSemanticTimeoutResponse = await EagleReadonlyKnowledgeService.search({
    query: '主图',
    limit: 2,
    preferAiSearch: true
  }, {
    settings: {
      enabled: true,
      endpoint: 'http://eagle-audit.invalid',
      timeoutMs: 5000
    },
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      const tool = body.name || body.tool;
      const args = body.arguments || body.params || {};
      eagleAiSemanticTimeoutCalls.push({ tool, query: args.query });
      if (tool === 'item_query') {
        if (eagleAiSemanticAttempted) {
          throw new Error('item_query was incorrectly deferred until after AI semantic search');
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            result: [{
              id: 'eagle-keyword-before-semantic',
              name: '关键词语义降级参考',
              ext: 'jpg',
              tags: ['分类:主图参考'],
              folders: [],
              width: 1000,
              height: 1000,
              thumbnailPath: 'D:\\private\\keyword-before-semantic.jpg'
            }]
          })
        };
      }
      if (tool === 'ai_search_status') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ result: { status: 'ready' } })
        };
      }
      if (tool === 'ai_search_by_text') {
        eagleAiSemanticAttempted = true;
        throw new Error('simulated AI semantic timeout');
      }
      throw new Error(`unexpected Eagle tool: ${tool}`);
    }
  });

  const jpegRedirectSemanticsViolations = [];
  const saveDocumentDefaultRedirect = preserveJpegQualityAcrossToolRedirect({
    sourceTool: 'saveDocument',
    targetFormat: 'jpg',
    requestedQuality: undefined,
    redirectedParams: { format: 'jpg', outputPath: 'C:\\project\\主图' }
  });
  const quickExportDefaultRedirect = preserveJpegQualityAcrossToolRedirect({
    sourceTool: 'quickExport',
    targetFormat: 'jpg',
    requestedQuality: undefined,
    redirectedParams: { format: 'jpg', path: 'C:\\project\\主图\\成品.jpg' }
  });
  const explicitNativeRedirect = preserveJpegQualityAcrossToolRedirect({
    sourceTool: 'saveDocument',
    targetFormat: 'jpg',
    requestedQuality: 6,
    redirectedParams: { format: 'jpg', outputPath: 'C:\\project\\主图' }
  });
  const pngRedirect = preserveJpegQualityAcrossToolRedirect({
    sourceTool: 'quickExport',
    targetFormat: 'png',
    requestedQuality: undefined,
    redirectedParams: { format: 'png', path: 'C:\\project\\主图\\成品.png' }
  });
  if (saveDocumentDefaultRedirect.quality !== 12) {
    jpegRedirectSemanticsViolations.push('saveDocument-default-was-replaced-by-quickExport-default');
  }
  if (quickExportDefaultRedirect.quality !== 80) {
    jpegRedirectSemanticsViolations.push('quickExport-default-was-replaced-by-saveDocument-default');
  }
  if (explicitNativeRedirect.quality !== 6) {
    jpegRedirectSemanticsViolations.push('explicit-native-quality-was-reinterpreted-during-redirect');
  }
  if (Object.prototype.hasOwnProperty.call(pngRedirect, 'quality')) {
    jpegRedirectSemanticsViolations.push('jpeg-default-leaked-into-png-redirect');
  }
  const publicPlanCalls = [];
  const publicPlanAdapter = createPublicPlanPhotoshopAdapter({
    approvedLiveAdapterRun: true,
    executionScope: 'disposable-document',
    projectPath: 'C:\\project',
    executeTool: async (toolName, params) => {
      publicPlanCalls.push({ toolName, params });
      return { success: true };
    }
  }).adapter;
  if (!publicPlanAdapter) {
    jpegRedirectSemanticsViolations.push('public-plan-adapter-not-created-for-quality-regression');
  } else {
    await publicPlanAdapter.runWriteOperation({
      toolName: 'saveDocument',
      params: {
        format: 'jpg',
        projectSubdir: '主图',
        fileName: '成品'
      }
    });
    const redirectedCall = publicPlanCalls[0];
    if (redirectedCall?.toolName !== 'quickExport'
      || redirectedCall?.params?.quality !== 12) {
      jpegRedirectSemanticsViolations.push('public-plan-saveDocument-redirect-lost-native12-default');
    }
  }
  if (!toolExecutorText.includes("sourceTool: 'quickExport'")
    || !toolExecutorText.includes("sourceTool: 'saveDocument'")
    || !publicPlanPhotoshopAdapterText.includes("sourceTool: 'saveDocument'")) {
    jpegRedirectSemanticsViolations.push('renderer-redirect-path-not-wired-to-originating-quality-semantics');
  }
  if (eagleFallbackResponse.status !== 'ok'
    || eagleFallbackResponse.results.length !== 4
    || new Set(eagleFallbackResponse.results.map((result) => result.id)).size !== 4
    || !eagleFallbackResponse.results.some((result) => result.id.includes('eagle-commerce-'))
    || !eagleFallbackResponse.results.some((result) => result.id.includes('eagle-main-image-'))
    || !eagleFallbackResponse.warnings.some((warning) => warning.includes('宽松只读召回'))
    || eagleFallbackCalls.map((call) => `${call.tool}:${call.query || ''}`).join('|')
      !== 'item_query:电商 主图|item_query:电商|item_query:主图|ai_search_status:'
    || eagleFallbackCalls
      .filter((call) => call.tool === 'item_query' && call.query !== '电商 主图')
      .some((call) => call.limit !== 4)) {
    runtimeReferenceFailurePolicyViolations.push('eagle-not-ready-fallback-did-not-round-robin-bounded-token-candidates');
  }
  if (JSON.stringify(eagleFallbackResponse).includes('commerce-1.jpg')
    || JSON.stringify(eagleFallbackResponse).includes('main-image-2.jpg')
    || eagleAiReadyResponse.status !== 'ok'
    || eagleAiReadyResponse.results.length !== 1
    || eagleAiReadyCalls.map((call) => `${call.tool}:${call.query || ''}:${call.limit || ''}`).join('|')
      !== 'item_query:专业袜子主图:3|ai_search_status::|ai_search_by_text:专业袜子主图:3'
    || JSON.stringify(eagleAiReadyResponse).includes('ai-ready-reference.jpg')) {
    runtimeReferenceFailurePolicyViolations.push('eagle-fallback-changed-ai-ready-path-or-leaked-local-path');
  }
  if (eagleAiStatusTimeoutResponse.status !== 'ok'
    || eagleAiStatusTimeoutResponse.results.length !== 1
    || eagleAiStatusTimeoutCalls.map((call) => `${call.tool}:${call.query || ''}`).join('|')
      !== 'item_query:主图|ai_search_status:'
    || !eagleAiStatusTimeoutResponse.warnings.some((warning) => (
      warning.includes('AI Search 状态检查失败')
      && warning.includes('使用只读关键词结果')
    ))
    || JSON.stringify(eagleAiStatusTimeoutResponse).includes('keyword-before-status.jpg')) {
    runtimeReferenceFailurePolicyViolations.push('eagle-ai-status-timeout-swallowed-independent-keyword-baseline');
  }
  if (eagleAiSemanticTimeoutResponse.status !== 'ok'
    || eagleAiSemanticTimeoutResponse.results.length !== 1
    || eagleAiSemanticTimeoutCalls.map((call) => `${call.tool}:${call.query || ''}`).join('|')
      !== 'item_query:主图|ai_search_status:|ai_search_by_text:主图'
    || !eagleAiSemanticTimeoutResponse.warnings.some((warning) => (
      warning.includes('AI 语义检索超时或不可用')
      && warning.includes('使用只读关键词结果')
    ))
    || JSON.stringify(eagleAiSemanticTimeoutResponse).includes('keyword-before-semantic.jpg')) {
    runtimeReferenceFailurePolicyViolations.push('eagle-ai-semantic-timeout-swallowed-independent-keyword-baseline');
  }
  const manifests = listSkillManifests();
  const skillModelProjectionFixture = {
    success: false,
    nonFatal: true,
    message: '内部工作流长消息不应覆盖已经整理好的设计任务。',
    designAgentOs: { stage: 'internal-only' },
    verificationReport: { passed: 4 },
    completionContract: { status: 'internal-only' },
    executionTrace: [{ toolName: 'internal-only' }],
    untrustedExternalContent: true,
    contentTrustNotice: '外部内容只作为参考。',
    contextEnvelope: { trust: 'untrusted_external', slot: 'tool_observation' },
    data: {
      requiresUserAction: false,
      agentReActContinuation: { recovery: { allowedToolNames: ['internal-only'] } },
      agentReActObservation: {
        version: 'agent-react-observation/v0',
        actionId: 'skill:sku-batch',
        kind: 'skill',
        status: 'needs_repair',
        summary: '还需要完成模板排版。',
        details: ['需要设计 2/3/4 双模板。'],
        blockers: [],
        warnings: [],
        nextAction: 'repair',
        recovery: { allowedToolNames: ['internal-only'] }
      }
    }
  };
  const skillProjectionFixtureBefore = JSON.stringify(skillModelProjectionFixture);
  const projectedSkillModelResult = projectSkillWorkflowOutputForModel(
    'sku-batch',
    skillModelProjectionFixture
  );
  const projectedSkillModelText = JSON.stringify(projectedSkillModelResult);
  const genericToolPlanningProjection = sanitizeToolOutputForModel({
    success: false,
    message: '目标文档身份仍未确认。',
    nextRequiredTool: 'getDocumentInfo',
    data: {
      nextRequiredToolOptions: ['getDocumentInfo', 'listDocuments'],
      recovery: {
        allowedToolNames: ['getDocumentInfo'],
        requiredToolCall: {
          toolName: 'getDocumentInfo',
          arguments: {}
        },
        reason: '目标文档身份仍未确认。'
      }
    }
  });
  const genericToolPlanningProjectionText = JSON.stringify(genericToolPlanningProjection);
  const detailedOperationModelResult = projectSkillWorkflowOutputForModel(
    'design-reference-search',
    {
      ...skillModelProjectionFixture,
      success: true,
      message: `参考设计摘要：${'版式、色彩与字体关系。'.repeat(30)}`,
      data: {
        agentReActObservation: {
          ...skillModelProjectionFixture.data.agentReActObservation,
          actionId: 'skill:design-reference-search',
          status: 'completed',
          summary: '已整理相关设计参考。',
          details: ['已执行 skill：design-reference-search', '参考方向已整理。'],
          nextAction: 'finish'
        }
      }
    },
    { includeDetailedResult: true }
  );
  const mismatchedSkillProjection = projectSkillWorkflowOutputForModel('sku-batch', {
    ...skillModelProjectionFixture,
    data: {
      agentReActObservation: {
        ...skillModelProjectionFixture.data.agentReActObservation,
        actionId: 'skill:another-skill'
      }
    }
  });
  const skillModelProjectionViolations = [
    ...(projectedSkillModelResult?.workResult?.summary === '还需要完成模板排版。'
      && projectedSkillModelResult?.workResult?.state === '需要继续设计'
      && projectedSkillModelResult?.workResult?.details?.[0] === '需要设计 2/3/4 双模板。'
      && projectedSkillModelResult?.workResult?.nextStep === undefined
      && projectedSkillModelResult?.untrustedExternalContent === true
      && projectedSkillModelResult?.contentTrustNotice === '外部内容只作为参考。'
      && projectedSkillModelResult?.contextEnvelope?.trust === 'untrusted_external'
      && !projectedSkillModelText.includes('designAgentOs')
      && !projectedSkillModelText.includes('verificationReport')
      && !projectedSkillModelText.includes('completionContract')
      && !projectedSkillModelText.includes('executionTrace')
      && !projectedSkillModelText.includes('allowedToolNames')
      && !projectedSkillModelText.includes('nextAction')
      && projectedSkillModelText.length < 8192
      ? []
      : ['skill-model-projection:internal-runtime-accounting-leaked-into-designer-context']),
    ...(detailedOperationModelResult?.workResult?.result?.startsWith('参考设计摘要：')
      && detailedOperationModelResult?.workResult?.details?.length === 1
      && detailedOperationModelResult.workResult.details[0] === '参考方向已整理。'
      ? []
      : ['skill-model-projection:operation-design-result-was-lost-or-internal-skill-label-leaked']),
    ...(JSON.stringify(skillModelProjectionFixture) === skillProjectionFixtureBefore
      ? []
      : ['skill-model-projection:projection-mutated-runtime-result']),
    ...(!/nextRequiredTool|allowedToolNames|requiredToolCall|getDocumentInfo/.test(
      genericToolPlanningProjectionText
    ) && genericToolPlanningProjection?.data?.recovery?.reason === '目标文档身份仍未确认。'
      ? []
      : ['tool-model-projection:internal-next-tool-authority-leaked']),
    ...(!mismatchedSkillProjection?.workResult
      && mismatchedSkillProjection?.designAgentOs?.stage === 'internal-only'
      ? []
      : ['skill-model-projection:untrusted-or-mismatched-receipt-triggered-projection']),
    ...(agentRuntimeText.includes('getSkillById(toolName)')
      && agentRuntimeText.includes('projectSkillWorkflowOutputForModel(toolName, output, {')
      ? []
      : ['skill-model-projection:registered-skill-trust-boundary-missing'])
  ];
  const skuTaskProfileManifests = manifests.filter((manifest) => (
    String(manifest.task_type || '').startsWith('ecommerce.sku_')
  ));
  const taskProfileCrosswalks = listDesignTaskProfileCrosswalks();
  const artifactKnowledgeIds = new Set(listDesignArtifactIds());
  const artifactOwnerManifests = manifests.filter((manifest) => manifest.planning_role !== 'method');
  const taskProfileCrosswalkByManifest = new Map(
    taskProfileCrosswalks
      .filter((crosswalk) => crosswalk.manifestSkillId)
      .map((crosswalk) => [crosswalk.manifestSkillId, crosswalk])
  );
  const detailManifest = manifests.find((manifest) => manifest.skill_id === 'ecommerce.detail_page');
  const mainImageManifest = manifests.find((manifest) => manifest.skill_id === 'ecommerce.main_image');
  const mainImageDeclarationGuidance = String(
    getDesignTaskTypeSpec('ecommerce.main_image.v1')?.declarationGuidance || ''
  );
  const observationLivenessViolations = [];
  const autonomousDesignLoopViolations = [];
  if (!shouldStopWarningOnlyNeedsReviewReflexion({
    status: 'needs_review',
    blockers: [],
    hasActionableRequiredProfileIssue: false
  })
    || !shouldStopWarningOnlyNeedsReviewReflexion({
      status: 'needs_review',
      blockers: [],
      // r17 具备可靠审美 diagnosis；该事实不应改变 warning-only 终态边界。
      hasActionableVlmDiagnosis: true,
      hasActionableRequiredProfileIssue: false
    })
    || shouldStopWarningOnlyNeedsReviewReflexion({
      status: 'needs_review',
      blockers: [],
      hasActionableRequiredProfileIssue: true
    })
    || shouldStopWarningOnlyNeedsReviewReflexion({
      status: 'needs_review',
      blockers: ['缺少必需交付物'],
      hasActionableRequiredProfileIssue: false
    })
    || !agentRuntimeText.includes('shouldStopWarningOnlyNeedsReviewReflexion({')) {
    autonomousDesignLoopViolations.push('reflexion:warning-only-needs-review-replayed-original-task');
  }
  const mainImagePerformanceBudgetFixture = {
    maxModelCalls: 36,
    maxToolCalls: 120,
    maxIterations: 60,
    maxVisionCandidates: 16,
    maxVisualAnalyses: 6,
    maxFullResolutionImageReads: 0,
    softTimeBudgetMs: 900000
  };
  if (canQueueRunLevelVisualPresentation({
    limit: 22,
    consumed: 21,
    visualAnalysisAlreadyPending: false
  }) !== false
    || canQueueRunLevelVisualPresentation({
      limit: 22,
      consumed: 20,
      visualAnalysisAlreadyPending: false
  }) !== true
    || canQueueRunLevelVisualPresentation({
      limit: 22,
      consumed: 21,
      visualAnalysisAlreadyPending: true
    }) !== false
    || canQueueRunLevelVisualPresentation({
      limit: 22,
      consumed: 20,
      visualAnalysisAlreadyPending: true
    }) !== true
    || !agentRuntimeText.includes('!this.canQueuePrimaryVisualPresentation()')
    || agentRuntimeText.indexOf('!this.canQueuePrimaryVisualPresentation()')
      > agentRuntimeText.indexOf('const visionCandidateLimit = this.getPerformanceVisionCandidateLimit();')) {
    autonomousDesignLoopViolations.push('visual-budget:presentation-and-next-analysis-not-reserved-atomically');
  }
  const finalQualityAccountingLedger = createPerformanceLedgerState();
  const ordinaryObservationKeys = Array.from(
    { length: 7 },
    (_, index) => `ordinary-review:${index + 1}`
  );
  const finalQualityObservationKeys = Array.from(
    { length: 7 },
    (_, index) => `final-review:${index + 1}`
  );
  [3, 1, 1, 1, 1].forEach((candidateCount, index) => {
    consumePerformanceModelCallUsage(finalQualityAccountingLedger, 'task', {
      visualAnalysis: true,
      billedVisionCandidateCount: candidateCount,
      visionCandidateKeys: ordinaryObservationKeys.slice(
        index === 0 ? 0 : index + 2,
        index === 0 ? 3 : index + 3
      )
    });
  });
  consumePerformanceModelCallUsage(finalQualityAccountingLedger, 'final_quality_judge', {
    visualAnalysis: true,
    billedVisionCandidateCount: 7,
    visionCandidateKeys: finalQualityObservationKeys
  });
  consumePerformanceModelCallUsage(
    finalQualityAccountingLedger,
    'final_quality_diagnosis_repair',
    {
      visualAnalysis: true,
      billedVisionCandidateCount: 7,
      visionCandidateKeys: finalQualityObservationKeys
    }
  );
  const projectedOrdinaryVisualUsage = projectPerformanceLedgerUsage(
    finalQualityAccountingLedger,
    5,
    1
  );
  const restoredOrdinaryVisualLedger = restorePerformanceLedgerUsage(
    createPerformanceLedgerState(),
    0,
    projectedOrdinaryVisualUsage
  );
  if (projectedOrdinaryVisualUsage.modelCalls !== 5
    || projectedOrdinaryVisualUsage.visionCandidates !== 7
    || projectedOrdinaryVisualUsage.visualAnalyses !== 5
    || projectedOrdinaryVisualUsage.observationKeys.length !== 7
    || finalQualityAccountingLedger.finalQualityJudgeCallCount !== 1
    || finalQualityAccountingLedger.finalQualityDiagnosisRepairCallCount !== 1
    || readRunLevelVisualBudgetConsumed(finalQualityAccountingLedger) !== 12
    || restoredOrdinaryVisualLedger.ledger.visionCandidateCount !== 7
    || restoredOrdinaryVisualLedger.ledger.visualAnalysisCount !== 5
    || restoredOrdinaryVisualLedger.ledger.finalQualityJudgeCallCount !== 0
    || restoredOrdinaryVisualLedger.ledger.finalQualityDiagnosisRepairCallCount !== 0
    || !agentRuntimeText.includes('consumePerformanceModelCallUsage(this.performanceLedger')) {
    autonomousDesignLoopViolations.push('visual-budget:final-quality-event-contaminated-restored-ordinary-pool');
  }
  const imminentBudgetDirectiveDue = shouldIssuePerformanceBudgetDisciplineDirective({
    budget: mainImagePerformanceBudgetFixture,
    ledger: { modelCallCount: 26, budgetDisciplineDirectiveIssued: false },
    activeElapsedMs: 743000,
    imminentModelCalls: 1,
    requestTimeoutMs: 180000
  });
  const distantBudgetDirectiveNotDue = shouldIssuePerformanceBudgetDisciplineDirective({
    budget: mainImagePerformanceBudgetFixture,
    ledger: { modelCallCount: 8, budgetDisciplineDirectiveIssued: false },
    activeElapsedMs: 240000,
    imminentModelCalls: 1,
    requestTimeoutMs: 180000
  });
  const duplicateBudgetDirectiveNotDue = shouldIssuePerformanceBudgetDisciplineDirective({
    budget: mainImagePerformanceBudgetFixture,
    ledger: { modelCallCount: 26, budgetDisciplineDirectiveIssued: true },
    activeElapsedMs: 743000,
    imminentModelCalls: 1,
    requestTimeoutMs: 180000
  });
  const primaryRequestMethodStart = agentRuntimeText.indexOf(
    'private async requestModelWithOptionalStream('
  );
  const primaryRequestDirectiveIndex = agentRuntimeText.indexOf(
    'this.maybePushBudgetDisciplineDirective(1);',
    primaryRequestMethodStart
  );
  const primaryRequestSnapshotIndex = agentRuntimeText.indexOf(
    'const governedMessages = prepareAgentMessagesForModel(messages);',
    primaryRequestMethodStart
  );
  if (!imminentBudgetDirectiveDue
    || distantBudgetDirectiveNotDue
    || duplicateBudgetDirectiveNotDue
    || primaryRequestMethodStart < 0
    || primaryRequestDirectiveIndex < primaryRequestMethodStart
    || primaryRequestSnapshotIndex < primaryRequestDirectiveIndex) {
    autonomousDesignLoopViolations.push('performance-budget:closure-directive-arrives-after-request-snapshot');
  }
  const requestScaledCostViolations = [];
  const userActivityProjectionViolations = [];
  const visibleStepActivityFunction = findFunction(
    agentVisibleFeedbackSource,
    'buildVisibleAgentActivityFromStepEvent'
  )?.getText(agentVisibleFeedbackSource) || '';
  const visibleProgressActivityFunction = findFunction(
    agentVisibleFeedbackSource,
    'buildVisibleAgentActivityFromProgress'
  )?.getText(agentVisibleFeedbackSource) || '';
  const wrapperAuthorizationIndex = visibleStepActivityFunction.indexOf('canRenderStepAsUserFacing(event)');
  const teammateProjectionIndex = visibleStepActivityFunction.indexOf('isTeammateWrapperToolEvent(event)');
  if (wrapperAuthorizationIndex < 0
    || teammateProjectionIndex < 0
    || wrapperAuthorizationIndex > teammateProjectionIndex) {
    userActivityProjectionViolations.push('activity:skill-or-teammate-wrapper-bypassed-user-process-authorization');
  }
  if (!visibleProgressActivityFunction.includes('^处理进度\\s*\\d+')
    || executorText.includes('callbacks?.onProgress?.(`处理进度 ${iteration}/${max}`')) {
    userActivityProjectionViolations.push('activity:iteration-count-leaked-through-progress-callback');
  }
  if (!/buildVisibleAgentActivityFromProgress\(message, current\)\s*\|\|\s*current/u.test(chatPanelText)) {
    userActivityProjectionViolations.push('activity:hidden-progress-cleared-last-designer-facing-activity');
  }
  if (executorText.includes("title: '自动返工停止：缺少成本账本'")
    || executorText.includes("title: '质量返工停止：已达最大轮数'")
    || executorText.includes('let reentryTitle = `复盘后自动返工（第 ${reflexionReentryCount} 次）`')
    || !executorText.includes('message: qualityHaltUserNotice')) {
    userActivityProjectionViolations.push('activity:runtime-reflexion-diagnostic-entered-user-copy');
  }
  if (!agentRuntimeText.includes("title: '等待你确认'")
    || !agentRuntimeText.includes("stopReason: 'awaiting_user_confirmation'")
    || !chatPanelText.includes('const interactiveCardsFromData = Array.isArray((result as any).data?.interactiveCards)')
    || !chatPanelText.includes('const interactiveCardsFromTools = Array.isArray(result.toolResults)')
    || !chatPanelText.includes('pendingInteractiveContinuation')) {
    userActivityProjectionViolations.push('activity:confirmation-card-or-resume-channel-was-hidden-with-wrapper-events');
  }
  const oneShotImageMessages = [
    {
      role: 'user',
      content: '请参考附件修改设计。',
      contentBlocks: [
        { type: 'text', text: '附件一' },
        { type: 'image', data: 'current-user-pixels', mediaType: 'image/png' }
      ],
      contextMetadata: {
        source: 'current-user-input',
        authority: 'user',
        origin: 'current_user_instruction',
        retention: 'pinned',
        scope: 'current-user-goal'
      }
    },
    {
      role: 'user',
      content: '',
      contentBlocks: [
        { type: 'text', text: 'observationKey=doc-7-history-11' },
        { type: 'image', data: 'tool-result-pixels', mediaType: 'image/png' }
      ],
      contextMetadata: {
        source: 'tool-image-observation',
        authority: 'data_only',
        origin: 'visual_observation',
        retention: 'ephemeral',
        scope: 'tool-visual:snapshot'
      }
    }
  ];
  const firstPreparedImageMessages = prepareAgentMessagesForModel(oneShotImageMessages);
  const firstPreparedImageCount = firstPreparedImageMessages
    .flatMap((message) => message.contentBlocks || [])
    .filter((block) => block.type === 'image').length;
  const preparedObservationText = firstPreparedImageMessages[1]?.contentBlocks
    ?.filter((block) => block.type === 'text')
    .map((block) => String(block.text || ''))
    .join('\n') || '';
  const retiredImageCount = retireDeliveredAgentMessageImages(oneShotImageMessages);
  const secondPreparedBlocks = prepareAgentMessagesForModel(oneShotImageMessages)
    .flatMap((message) => message.contentBlocks || []);
  const secondRetirementCount = retireDeliveredAgentMessageImages(oneShotImageMessages);
  if (firstPreparedImageCount !== 2
    || retiredImageCount !== 2
    || secondPreparedBlocks.some((block) => block.type === 'image')
    || !secondPreparedBlocks.some((block) => String(block.text || '').includes('不重复附带 Base64'))
    || secondRetirementCount !== 0) {
    requestScaledCostViolations.push(`request-cost:image-payload-was-not-one-shot:${JSON.stringify({
      firstPreparedImageCount,
      retiredImageCount,
      secondPreparedBlocks,
      secondRetirementCount
    })}`);
  }
  if (!preparedObservationText.includes('【实际观察】')
    || !preparedObservationText.includes('【实际观察开始】')
    || !preparedObservationText.includes('> observationKey=doc-7-history-11')
    || /HARNESS_CONTROL|DATA_ONLY|<runtime_message|\sauthority=|\sorigin=/u.test(preparedObservationText)) {
    requestScaledCostViolations.push(`message-context:internal-envelope-entered-designer-context:${preparedObservationText}`);
  }
  const bootstrapPolicy = buildAgentUnboundAutonomousPerformancePolicy();
  // 设计路径宪法（2026-08-17）：未绑定清单的自主设计预算必须是「设计师干活量级」的下限，
  // 只许往上不许再缩回聊天助理量级（真机 run 469 在 14 轮 6 写入零失败时被 16 次上限掐断）。
  if (bootstrapPolicy.budget.maxModelCalls < 32
    || bootstrapPolicy.budget.maxToolCalls < 120
    || bootstrapPolicy.budget.maxIterations < 60
    || bootstrapPolicy.budget.maxVisionCandidates < 8
    || bootstrapPolicy.budget.maxVisualAnalyses < 4
    || bootstrapPolicy.budget.softTimeBudgetMs < 900_000
    || bootstrapPolicy.budget.maxPrimaryOutputTokens !== 8192
    || bootstrapPolicy.budget.allowProviderThinking !== true
    || bootstrapPolicy.profileSource.ref !== 'agent-unbound-autonomous/v0') {
    requestScaledCostViolations.push(`unbound-autonomous:budget-cannot-complete-design:${JSON.stringify(bootstrapPolicy)}`);
  }
  if (executorText.includes("code: 'runtime_design_identity_required_before_write'")
    || executorText.includes('shouldBlockPlanNeutralDesignWrite')
    || capabilitySessionText.includes('requiresRuntimeDesignIdentityBeforeWrite')
    || capabilitySessionText.includes('shouldBlockPlanNeutralDesignWrite')) {
    requestScaledCostViolations.push('unbound-autonomous:runtime-declaration-became-start-permission');
  }
  if (!executorText.includes('先判断当前任务是否匹配已注册 Skill：匹配就直接使用')
    || !executorText.includes('不匹配就自己规划')) {
    requestScaledCostViolations.push('unbound-autonomous:skill-first-or-agent-plan-contract-missing');
  }
  if (executorText.includes("code: 'runtime_design_identity_required_before_costly_observation'")
    || executorText.includes('hasPendingRuntimeDesignWorkflowRecommendation(')
    || executorText.includes('requiredControlTool')
    || executorText.includes('deferSkillBridgesUntilManifest')) {
    requestScaledCostViolations.push('bootstrap:advisory-workflow-recommendation-became-a-runtime-control-gate');
  }
  const planNeutralRuntimeBudget = buildAutonomousAgentRuntimeBudget({
    defaultMaxIterations: bootstrapPolicy.budget.maxIterations,
    defaultSource: 'stage-autonomous-agent-default'
  });
  const explicitRuntimeBudget = buildAutonomousAgentRuntimeBudget({
    requestedMaxIterations: 5,
    defaultMaxIterations: bootstrapPolicy.budget.maxIterations,
    defaultSource: 'stage-autonomous-agent-default'
  });
  if (resolveDeclaredRuntimeMaxIterations({
    runtimeBudget: planNeutralRuntimeBudget,
    manifestMaxIterations: 70
  }) !== 70) {
    requestScaledCostViolations.push('bootstrap:manifest-creative-budget-did-not-expand-after-declaration');
  }
  if (resolveDeclaredRuntimeMaxIterations({
    runtimeBudget: explicitRuntimeBudget,
    manifestMaxIterations: 70
  }) !== 5) {
    requestScaledCostViolations.push('bootstrap:explicit-user-iteration-ceiling-was-not-deny-wins');
  }
  const detailScopedEditPolicy = buildAgentPerformancePolicy({
    taskType: detailManifest?.task_type,
    skillId: 'design.reference_replication',
    workMode: 'edit_existing',
    requiresPhotoshop: true
  });
  if (detailScopedEditPolicy.budget.maxModelCalls !== 6
    || detailScopedEditPolicy.budget.maxToolCalls !== 12
    || detailScopedEditPolicy.budget.maxIterations !== 8
    || detailScopedEditPolicy.budget.maxVisionCandidates !== 1
    || detailScopedEditPolicy.budget.maxInitialVisionCandidates !== 0
    || detailScopedEditPolicy.budget.maxVisualAnalyses !== 1
    || detailScopedEditPolicy.budget.maxPrimaryOutputTokens !== 1200
    || detailScopedEditPolicy.budget.allowProviderThinking !== false
    || !detailScopedEditPolicy.profileSource.ref.endsWith('#edit_existing')) {
    requestScaledCostViolations.push(`detail-edit:method-overlay-expanded-cost:${JSON.stringify(detailScopedEditPolicy)}`);
  }
  const detailScopedEditPlan = detailManifest
    ? buildRuntimeStagePlan(detailManifest, 'edit_existing')
    : undefined;
  const detailScopedEditStages = detailScopedEditPlan?.steps.map((step) => step.stage) || [];
  if (JSON.stringify(detailScopedEditStages) !== JSON.stringify(['R0', 'R1', 'R2', 'E1', 'R5'])) {
    requestScaledCostViolations.push(`detail-edit:full-creative-stages-not-removed:${detailScopedEditStages.join('>')}`);
  }
  const conflictingDetailWorkModeIntake = buildDetailPageAgentIntake({
    params: {
      agentMode: 'execute',
      workMode: 'template_fill',
      existingDocument: 'detail.psb',
      targetScope: 'screen:7',
      requestedChange: '只修改第 7 屏标题',
      editContentMode: 'copy_only'
    },
    context: {
      photoshopContext: { hasDocument: true, documentName: 'detail.psb' }
    },
    runtimeDesignBriefDeclaration: {
      readiness: 'ready',
      payload: {
        workMode: 'edit_existing',
        taskGoal: '只修改第 7 屏标题',
        inputCoverage: [],
        contextRefs: []
      }
    }
  });
  if (conflictingDetailWorkModeIntake.canStart
    || conflictingDetailWorkModeIntake.workMode !== 'edit_existing'
    || conflictingDetailWorkModeIntake.identityIssue?.code !== 'runtime_work_mode_identity_mismatch') {
    requestScaledCostViolations.push(
      `detail-edit:workflow-params-switched-runtime-work-mode:${JSON.stringify(conflictingDetailWorkModeIntake)}`
    );
  }
  if (detailScopedEditPlan) {
    const generationOneIdentity = createRuntimeSessionIdentity({
      now: '2026-08-11T01:00:00.000Z',
      nonce: 'request-cost-ledger-g1',
      skillId: detailScopedEditPlan.skillId,
      taskType: detailScopedEditPlan.taskType
    });
    let generationOneSession = createRuntimeSession({
      identity: generationOneIdentity,
      plan: detailScopedEditPlan
    });
    generationOneSession = recordRuntimeSessionPerformanceUsage({
      session: generationOneSession,
      usage: {
        modelCalls: 4,
        toolCalls: 7,
        iterations: 5,
        visionCandidates: 2,
        visualAnalyses: 1,
        activeElapsedMs: 45_000,
        observationKeys: ['screen:1@h11', 'screen:2@h11']
      }
    });
    generationOneSession = finalizeRuntimeSession({
      session: generationOneSession,
      plan: detailScopedEditPlan,
      executionSummary: { status: 'needs_review', stopReason: 'quality_gate' }
    });
    const generationTwoIdentity = createRuntimeSessionIdentity({
      now: '2026-08-11T01:01:00.000Z',
      nonce: 'request-cost-ledger-g2',
      generation: 2,
      sessionId: generationOneIdentity.sessionId,
      parentRunId: generationOneIdentity.runId,
      skillId: detailScopedEditPlan.skillId,
      taskType: detailScopedEditPlan.taskType
    });
    let generationTwoCreateRejected = false;
    try {
      createRuntimeSession({
        identity: generationTwoIdentity,
        plan: detailScopedEditPlan
      });
    } catch (error) {
      generationTwoCreateRejected = String(error?.message || error)
        .includes('runtime_session_generation_requires_advance');
    }
    let generationTwoSession = advanceRuntimeSessionGeneration({
      previous: generationOneSession,
      identity: generationTwoIdentity,
      plan: detailScopedEditPlan
    });
    const inheritedUsage = readRuntimeSessionPerformanceUsage(generationTwoSession);
    generationTwoSession = recordRuntimeSessionPerformanceUsage({
      session: generationTwoSession,
      usage: {
        ...inheritedUsage,
        modelCalls: inheritedUsage.modelCalls + 1,
        visionCandidates: inheritedUsage.visionCandidates + 1,
        activeElapsedMs: inheritedUsage.activeElapsedMs + 15_000,
        observationKeys: [...inheritedUsage.observationKeys, 'screen:3@h12']
      }
    });
    const updatedUsage = readRuntimeSessionPerformanceUsage(generationTwoSession);
    if (inheritedUsage.modelCalls !== 4
      || inheritedUsage.toolCalls !== 7
      || inheritedUsage.iterations !== 5
      || inheritedUsage.visionCandidates !== 2
      || inheritedUsage.visualAnalyses !== 1
      || inheritedUsage.activeElapsedMs !== 45_000
      || updatedUsage.modelCalls !== 5
      || updatedUsage.visionCandidates !== 3
      || updatedUsage.activeElapsedMs !== 60_000
      || updatedUsage.observationKeys.length !== 3
      || !generationTwoCreateRejected) {
      requestScaledCostViolations.push(`reflexion:request-budget-reset-between-generations:${JSON.stringify({
        inheritedUsage,
        updatedUsage
      })}`);
    }
    if (!agentRuntimeText.includes('return projectPerformanceLedgerUsage(this.performanceLedger, this.iteration)')
      || !performanceLedgerText.includes('activeElapsedMs: readPerformanceActiveElapsedMs(ledger, nowMs)')
      || !performanceLedgerText.includes('nonNegativeInteger(usage.activeElapsedMs)')
      || agentRuntimeText.includes('this.performanceLedger.runStartedAtMs = sessionStartedAtMs')
      || performanceText.includes('parentRunStartedAtMs')
      || !agentRuntimeText.includes("throw new Error('runtime_session_generation_seed_required')")
      || !agentRuntimeText.includes('readRequestPerformanceUsageSnapshot(): RuntimePerformanceUsage')
      || !agentRuntimeText.includes('private readonly runtimeAccounting = new ActiveRuntimeAccounting();')
      || !agentRuntimeText.includes('readRuntimeAccountingDigest(): RuntimeAccountingDigest | undefined')
      || !agentRuntimeText.includes('accountingSeed: this.runtimeAccounting.readUnboundLedgerForTransfer()')
      || !agentRuntimeText.includes('this.runtimeAccounting.releaseUnboundLedgerAfterBinding();')
      || !agentRuntimeText.includes('this.runtimeAccounting.recordToolCall(this.runtimeSession')
      || !activeRuntimeAccountingText.includes('private unboundLedger: RuntimeAccountingLedger | undefined;')
      || !activeRuntimeAccountingText.includes('recordRuntimeModelCall({ ledger: this.unboundLedger, ...accountingInput })')
      || !activeRuntimeAccountingText.includes('recordRuntimeToolCall({ ledger: this.unboundLedger, ...input })')
      || !runtimeAccountingText.includes('export function cloneRuntimeAccountingLedger(')
      || !runtimeAccountingText.includes('export function validateRuntimeAccountingDigest(')
      || !runtimeAccountingText.includes('projectPerformanceUsageForDigest(input.ledger.performanceUsage)')
      || !agentRunRecordText.includes('validateRuntimeAccountingDigest(r.runtimeAccounting)')
      || !agentRunRecordText.includes('runtimeAccountingDigestOnly?: true;')
      || !agentRunRecordText.includes('const standaloneAccountingCandidate = !runtimeSessionDigest')
      || !agentRunRecordText.includes('staged Runtime Session 不得重复持有顶层 runtimeAccounting')
      || !executorText.includes('const runtimeAccountingDigest = activeAutonomousAgent?.readRuntimeAccountingDigest();')
      || executorText.includes('const standaloneRuntimeAccountingDigest = !runtimeContractBundle')
      || performanceLedgerText.includes('modelDurationMs')
      || performanceLedgerText.includes('toolDurationMs')
      || performanceLedgerText.includes('promptShapeSamples')
      || !agentRuntimeText.includes('restorePerformanceLedgerUsage(this.performanceLedger, this.iteration, this.config.requestPerformanceUsageSeed)')
      || !executorText.includes('.readRequestPerformanceUsageSnapshot();')
      || !executorText.includes('? { requestPerformanceUsageSeed }')
      || executorText.includes('本次运行没有可承接的请求级成本账本')
      || !executorText.includes('function resolveRuntimeRunRecordIdentity(')
      || !executorText.includes('return runtimeContractBundle ? runtimeSessionIdentity : undefined;')
      || !agentRunRecordText.includes('parent:${input.parentRunId}')
      || !executorText.includes("console.warn('[AutonomousAgent] 自动调整停止:'")) {
      requestScaledCostViolations.push('reflexion:active-execution-time-was-not-generation-scoped');
    }
  }
  const pairedReflexionHandoff = buildReflexionHandoffFromReviewReport({
    payload: {
      qualityPassed: false,
      gateStatus: 'failed',
      issues: [
        { issueId: 'screen-7', description: '第 7 屏标题拥挤', expectedFix: '只缩短第 7 屏标题' },
        { issueId: 'screen-9', description: '第 9 屏图片偏右', expectedFix: '只左移第 9 屏图片' }
      ],
      rollbackTarget: { runtimeUnit: 'R4', reason: '定向修正两处问题' }
    }
  });
  if (JSON.stringify(pairedReflexionHandoff.issueConstraints) !== JSON.stringify([
    { issueId: 'screen-7', description: '第 7 屏标题拥挤', expectedFix: '只缩短第 7 屏标题' },
    { issueId: 'screen-9', description: '第 9 屏图片偏右', expectedFix: '只左移第 9 屏图片' }
  ])) {
    requestScaledCostViolations.push(`reflexion:issue-fix-pairing-lost:${JSON.stringify(pairedReflexionHandoff)}`);
  }

  const makeReviewItem = (sourceId, options = {}) => ({
    identity: {
      outer: 'detail-page-design',
      resultPath: `$.items[${sourceId}]`,
      document: String(options.document || '7'),
      history: String(options.history || '11'),
      sourceKind: options.sourceKind || 'detail-screen',
      sourceId
    },
    captured: options.captured !== false,
    ...(options.image === false ? {} : {
      image: { base64: `pixels:${sourceId}`, mediaType: 'image/png', format: 'png' }
    })
  });
  const reviewSourceIds = Array.from({ length: 12 }, (_, index) => `screen:${index + 1}`);
  const completeReviewBundle = {
    version: VISUAL_OBSERVATION_BUNDLE_VERSION,
    expectedObservationCount: reviewSourceIds.length,
    expectedTargets: reviewSourceIds.map((sourceId) => ({
      sourceKind: 'detail-screen',
      sourceId
    })),
    items: reviewSourceIds.map((sourceId) => makeReviewItem(sourceId))
  };
  const completeReviewSet = buildDesignReviewSetFromBundle(completeReviewBundle);
  if (completeReviewSet.status !== 'ready'
    || completeReviewSet.reviewSet.items.length !== 12
    || completeReviewSet.reviewSet.expectedTargets.length !== 12) {
    autonomousDesignLoopViolations.push(`review-set:complete-multi-surface-rejected:${JSON.stringify(completeReviewSet)}`);
  }
  if (completeReviewSet.status === 'ready') {
    const planned = planDesignReviewImages(completeReviewSet.reviewSet, { maxTotalImages: 12 });
    const overBudget = planDesignReviewImages(completeReviewSet.reviewSet, { maxTotalImages: 11 });
    const selected = selectDesignReviewSetForFinalJudge(completeReviewSet.reviewSet, {
      currentVersion: { document: '7', history: '11' },
      requireMultiSurface: true,
      requiredSourceKind: 'detail-screen'
    });
    if (planned.status !== 'ready' || planned.totalImages !== 12) {
      autonomousDesignLoopViolations.push(`review-set:whole-set-budget-plan-invalid:${JSON.stringify(planned)}`);
    }
    if (overBudget.status !== 'budget_exceeded' || overBudget.requiredImages !== 12) {
      autonomousDesignLoopViolations.push(`review-set:partial-budget-not-rejected:${JSON.stringify(overBudget)}`);
    }
    if (selected.status !== 'ready') {
      autonomousDesignLoopViolations.push(`review-set:same-version-final-selection-rejected:${JSON.stringify(selected)}`);
    }
    const billedReviewKeys = new Set(
      completeReviewSet.reviewSet.items.slice(0, 10).map((item) => item.observationKey)
    );
    if (countUnbilledDesignReviewImages(completeReviewSet.reviewSet, billedReviewKeys) !== 2) {
      autonomousDesignLoopViolations.push('review-set:unique-evidence-key-count-invalid');
    }
    const directVisionKeys = completeReviewSet.reviewSet.items.map((item) => item.observationKey);
    const uniqueEvidenceCharge = resolveDirectVisionCandidateCharge({
      directVisionCandidateCount: directVisionKeys.length,
      directVisionCandidateKeys: directVisionKeys,
      billedObservationKeys: new Set([directVisionKeys[0]]),
      billByProviderPresentation: false
    });
    const providerPresentationCharge = resolveDirectVisionCandidateCharge({
      directVisionCandidateCount: directVisionKeys.length,
      directVisionCandidateKeys: directVisionKeys,
      billedObservationKeys: new Set([directVisionKeys[0]]),
      billByProviderPresentation: true
    });
    if (uniqueEvidenceCharge.billedCandidateCount !== directVisionKeys.length - 1
      || providerPresentationCharge.billedCandidateCount !== directVisionKeys.length
      || providerPresentationCharge.normalizedObservationKeys.length !== directVisionKeys.length) {
      autonomousDesignLoopViolations.push(`review-set:provider-image-presentation-cost-was-deduped-by-evidence-key:${JSON.stringify({
        uniqueEvidenceCharge,
        providerPresentationCharge
      })}`);
    }
    const seventhReviewItem = completeReviewSet.reviewSet.items[6];
    if (resolveDesignReviewSetItemForDiagnosis(
      completeReviewSet.reviewSet,
      seventhReviewItem.identity.sourceId
    )?.observationKey !== seventhReviewItem.observationKey
      || resolveDesignReviewSetItemForDiagnosis(
        completeReviewSet.reviewSet,
        seventhReviewItem.observationKey
      )?.identity.sourceId !== seventhReviewItem.identity.sourceId
      || resolveDesignReviewSetItemForDiagnosis(completeReviewSet.reviewSet, '第七屏附近') !== undefined
      || resolveDesignReviewSetItemForDiagnosis(completeReviewSet.reviewSet, '') !== undefined) {
      autonomousDesignLoopViolations.push('review-set:multi-surface-diagnosis-target-was-not-exact');
    }
    completeReviewBundle.items[0].image.base64 = '';
    if (!String(completeReviewSet.reviewSet.items[0].image.base64 || '').startsWith('pixels:')) {
      autonomousDesignLoopViolations.push('review-set:sanitizer-safe-pixel-copy-missing');
    }
  }
  const longReviewSourceIds = Array.from({ length: 30 }, (_, index) => `screen:${index + 1}`);
  const longReviewBundle = {
    version: VISUAL_OBSERVATION_BUNDLE_VERSION,
    expectedObservationCount: longReviewSourceIds.length,
    expectedTargets: longReviewSourceIds.map((sourceId) => ({
      sourceKind: 'detail-screen',
      sourceId
    })),
    items: longReviewSourceIds.map((sourceId) => makeReviewItem(sourceId, {
      image: true
    })).map((item) => ({
      ...item,
      image: { base64: 'A'.repeat(800), mediaType: 'image/png', format: 'png' }
    }))
  };
  const longReviewSet = buildDesignReviewSetFromBundle(longReviewBundle);
  if (longReviewSet.status !== 'ready'
    || longReviewSet.reviewSet.items
      .map(buildToolResultImageFromVisualObservationItem)
      .filter(Boolean).length !== 30) {
    autonomousDesignLoopViolations.push(`review-set:more-than-24-screens-were-truncated:${JSON.stringify(longReviewSet)}`);
  }
  const longNestedSnapshotResult = {
    success: true,
    historyStateRef: { documentId: 7, historyStateId: 11 },
    snapshots: longReviewSourceIds.map((sourceId, index) => ({
      screenId: index + 1,
      screenName: sourceId,
      base64: 'A'.repeat(800),
      mediaType: 'image/png',
      format: 'png',
      documentId: 7,
      historyStateId: 11
    }))
  };
  markExecutedToolResultProvenance('getScreenSnapshots', longNestedSnapshotResult);
  const longCompositeResult = {
    success: true,
    historyStateRef: { documentId: 7, historyStateId: 11 },
    data: { visualObservationBundle: longReviewBundle },
    toolResults: [{
      toolName: 'getScreenSnapshots',
      success: true,
      result: longNestedSnapshotResult
    }]
  };
  const longRuntimeReceipt = deriveAgentVisualObservationReceipt({
    toolResult: longCompositeResult,
    outerToolName: 'detail-page-design',
    isTrustedObservationTool: (toolName) => toolName === 'getScreenSnapshots'
  });
  const boundedModelCollection = collectImagesFromToolResult(
    longCompositeResult,
    24,
    'detail-page-design'
  );
  if (longRuntimeReceipt?.document !== '7'
    || longRuntimeReceipt?.history !== '11'
    || boundedModelCollection.images.length !== 24
    || boundedModelCollection.overflow?.extractedCount !== 24
    || boundedModelCollection.overflow?.expectedCount !== 30) {
    autonomousDesignLoopViolations.push(`review-set:30-screen-runtime-receipt-path-invalid:${JSON.stringify({ longRuntimeReceipt, boundedModelCollection })}`);
  }
  if (longReviewSet.status === 'ready' && longRuntimeReceipt) {
    const trustedOwner = {};
    const firstReviewedKey = longReviewSet.reviewSet.items[0].observationKey;
    const wroteTrustedArtifact = writeTrustedVisualReviewArtifact(trustedOwner, {
      receipt: longRuntimeReceipt,
      reviewSet: longReviewSet.reviewSet,
      historyStateRef: { documentId: 7, historyStateId: 11 },
      observationKeys: longReviewSet.reviewSet.items.map((item) => item.observationKey),
      reviewedObservationKeys: [firstReviewedKey],
      // producer 不能自行把部分复核抬成完整复核；reader 必须重新派生。
      fullyReviewed: true,
      supportingSourcePlacements: [{
        version: 'design-run-supporting-source-placement/v0',
        path: 'E:\\review-assets\\parent-source.jpg',
        sourceTool: 'placeImage',
        sourceSlot: 'direct_placement',
        layerId: 701,
        documentId: 7,
        callId: 'raw-tool-call-must-not-cross-generation',
        modelTurn: 9,
        usage: 'supporting_source',
        boundaries: {
          extractedFromSuccessfulToolCall: true,
          ranksCandidates: false,
          selectsWinner: false,
          countsAsFinalSurface: false,
          countsAsDeliveryEvidence: false
        }
      }]
    });
    const trustedArtifact = readTrustedVisualReviewArtifact(trustedOwner);
    const forwardedOwner = {};
    const transferred = transferTrustedVisualReviewArtifact(trustedOwner, forwardedOwner);
    const forwardedArtifact = readTrustedVisualReviewArtifact(forwardedOwner);
    const clonedOwner = { ...trustedOwner };
    const parentFinalReviewReserve = resolveFinalQualityVisionCandidateReserve({
      reviewSet: longReviewSet.reviewSet
    });
    const finalReviewWithSupportingSourceReserve = resolveFinalQualityVisionCandidateReserve({
      reviewSet: longReviewSet.reviewSet,
      supportingImageReserve: 1
    });
    const preEvidenceVisionLimit = resolveVisionCandidateLimitForFinalQuality({
      hardLimit: 37,
      maxInitialVisionCandidates: 5,
      requiresMultiSurface: true
    });
    const zeroReviewedVisionLimit = resolveVisionCandidateLimitForFinalQuality({
      hardLimit: 37,
      maxInitialVisionCandidates: 5,
      requiresMultiSurface: true,
      reviewSet: longReviewSet.reviewSet
    });
    const oneReviewedVisionLimit = resolveVisionCandidateLimitForFinalQuality({
      hardLimit: 37,
      maxInitialVisionCandidates: 5,
      requiresMultiSurface: true,
      reviewSet: longReviewSet.reviewSet
    });
    if (!wroteTrustedArtifact
      || trustedArtifact?.reviewSet.items.length !== 30
      || trustedArtifact?.reviewedObservationKeys.length !== 1
      || trustedArtifact?.fullyReviewed !== false
      || !transferred
      || forwardedArtifact?.reviewSet.items.length !== 30
      || forwardedArtifact?.supportingSourcePlacements?.length !== 1
      || forwardedArtifact?.supportingSourcePlacements?.[0]?.path !== 'E:\\review-assets\\parent-source.jpg'
      || forwardedArtifact?.supportingSourcePlacements?.[0]?.callId !== undefined
      || forwardedArtifact?.supportingSourcePlacements?.[0]?.modelTurn !== undefined
      || parentFinalReviewReserve !== 30
      || finalReviewWithSupportingSourceReserve !== 31
      || preEvidenceVisionLimit !== 6
      || zeroReviewedVisionLimit !== 7
      || oneReviewedVisionLimit !== 7
      || readTrustedVisualReviewArtifact(clonedOwner) !== undefined
      || readTrustedVisualReviewArtifact({
        receipt: longRuntimeReceipt,
        reviewSet: longReviewSet.reviewSet
      }) !== undefined) {
      autonomousDesignLoopViolations.push('review-set:trusted-team-artifact-identity-or-coverage-invalid');
    }

    const fullyReviewedOwner = {};
    writeTrustedVisualReviewArtifact(fullyReviewedOwner, {
      receipt: longRuntimeReceipt,
      reviewSet: longReviewSet.reviewSet,
      historyStateRef: { documentId: 7, historyStateId: 11 },
      observationKeys: longReviewSet.reviewSet.items.map((item) => item.observationKey),
      reviewedObservationKeys: longReviewSet.reviewSet.items.map((item) => item.observationKey),
      fullyReviewed: false
    });
    if (readTrustedVisualReviewArtifact(fullyReviewedOwner)?.fullyReviewed !== true) {
      autonomousDesignLoopViolations.push('review-set:trusted-team-full-review-not-derived-from-exact-key-coverage');
    }
  }
  const sceneVisualBudget = resolveDesignTeamStageVisualBudget({
    role: 'scene-analyst',
    availableVisualAnalyses: 2,
    availableVisionCandidates: 2,
    preserveForLaterCritic: 1
  });
  const criticVisualBudget = resolveDesignTeamStageVisualBudget({
    role: 'critic',
    availableVisualAnalyses: 1,
    availableVisionCandidates: 1,
    preserveForLaterCritic: 0
  });
  const singleSlotSceneVisualBudget = resolveDesignTeamStageVisualBudget({
    role: 'scene-analyst',
    availableVisualAnalyses: 1,
    availableVisionCandidates: 1,
    preserveForLaterCritic: 1
  });
  if (sceneVisualBudget.visualAnalyses !== 1
    || sceneVisualBudget.visionCandidates !== 1
    || criticVisualBudget.visualAnalyses !== 1
    || criticVisualBudget.visionCandidates !== 1
    || singleSlotSceneVisualBudget.visualAnalyses !== 0
    || singleSlotSceneVisualBudget.visionCandidates !== 0) {
    autonomousDesignLoopViolations.push(`design-team:advisory-visual-stage-budget-invalid:${JSON.stringify({ sceneVisualBudget, criticVisualBudget, singleSlotSceneVisualBudget })}`);
  }

  const missingReviewSet = buildDesignReviewSetFromBundle({
    ...completeReviewBundle,
    items: reviewSourceIds.map((sourceId, index) => (
      index === 6 ? makeReviewItem(sourceId, { captured: false, image: false }) : makeReviewItem(sourceId)
    ))
  });
  if (missingReviewSet.status !== 'incomplete_evidence'
    || !missingReviewSet.reasons.includes('missing_image')) {
    autonomousDesignLoopViolations.push(`review-set:missing-screen-not-rejected:${JSON.stringify(missingReviewSet)}`);
  }
  const duplicateReviewSet = buildDesignReviewSetFromBundle({
    ...completeReviewBundle,
    items: reviewSourceIds.map((sourceId, index) => (
      index === 11 ? makeReviewItem('screen:11') : makeReviewItem(sourceId)
    ))
  });
  if (duplicateReviewSet.status !== 'incomplete_evidence'
    || !duplicateReviewSet.reasons.includes('duplicate_source')) {
    autonomousDesignLoopViolations.push(`review-set:duplicate-screen-not-rejected:${JSON.stringify(duplicateReviewSet)}`);
  }
  const mixedHistoryReviewSet = buildDesignReviewSetFromBundle({
    ...completeReviewBundle,
    items: reviewSourceIds.map((sourceId, index) => (
      index === 7 ? makeReviewItem(sourceId, { history: '12' }) : makeReviewItem(sourceId)
    ))
  });
  if (mixedHistoryReviewSet.status !== 'incomplete_evidence'
    || !mixedHistoryReviewSet.reasons.includes('mixed_history')) {
    autonomousDesignLoopViolations.push(`review-set:mixed-history-not-rejected:${JSON.stringify(mixedHistoryReviewSet)}`);
  }
  const overflowReviewSet = buildDesignReviewSetFromBundle({
    version: VISUAL_OBSERVATION_BUNDLE_VERSION,
    expectedObservationCount: 2,
    expectedTargets: [
      { sourceKind: 'detail-screen', sourceId: 'screen:1' },
      { sourceKind: 'detail-screen', sourceId: 'screen:2' }
    ],
    items: [makeReviewItem('screen:1')],
    overflow: { omittedCount: 1, reason: 'producer_limit', sourceIds: ['screen:2'] }
  });
  if (overflowReviewSet.status !== 'incomplete_evidence'
    || !overflowReviewSet.reasons.includes('overflow')) {
    autonomousDesignLoopViolations.push(`review-set:overflow-not-rejected:${JSON.stringify(overflowReviewSet)}`);
  }
  const singleReviewSet = buildDesignReviewSetFromSingleSurface({
    identity: {
      outer: 'getCanvasSnapshot',
      resultPath: '$',
      document: '7',
      history: '11',
      sourceKind: 'canvas',
      sourceId: 'document:7'
    },
    image: { base64: 'single-pixels', mediaType: 'image/png' }
  });
  if (singleReviewSet.status !== 'ready') {
    autonomousDesignLoopViolations.push(`review-set:single-surface-rejected:${JSON.stringify(singleReviewSet)}`);
  } else {
    const detailSelection = selectDesignReviewSetForFinalJudge(singleReviewSet.reviewSet, {
      currentVersion: { document: '7', history: '11' },
      requireMultiSurface: true
    });
    if (detailSelection.status !== 'incomplete_evidence') {
      autonomousDesignLoopViolations.push('review-set:single-surface-impersonated-detail-review');
    }
    if (resolveDesignReviewSetItemForDiagnosis(singleReviewSet.reviewSet, '')?.identity.sourceId !== 'document:7') {
      autonomousDesignLoopViolations.push('review-set:single-surface-diagnosis-was-not-deterministically-bound');
    }
  }
  const legacySelfDerivedReviewSet = buildDesignReviewSetFromBundle({
    version: VISUAL_OBSERVATION_BUNDLE_VERSION,
    expectedObservationCount: reviewSourceIds.length,
    items: reviewSourceIds.map((sourceId) => makeReviewItem(sourceId))
  });
  if (legacySelfDerivedReviewSet.status !== 'ready') {
    autonomousDesignLoopViolations.push(`review-set:legacy-builder-regressed:${JSON.stringify(legacySelfDerivedReviewSet)}`);
  } else {
    const legacySelection = selectDesignReviewSetForFinalJudge(legacySelfDerivedReviewSet.reviewSet, {
      currentVersion: { document: '7', history: '11' },
      requireMultiSurface: true,
      requiredSourceKind: 'detail-screen'
    });
    if (legacySelection.status !== 'incomplete_evidence'
      || !legacySelection.reasons.includes('undeclared_targets')) {
      autonomousDesignLoopViolations.push(`review-set:self-derived-targets-impersonated-complete-coverage:${JSON.stringify(legacySelection)}`);
    }
  }
  const unrelatedRegionReviewSet = buildDesignReviewSetFromBundle({
    version: VISUAL_OBSERVATION_BUNDLE_VERSION,
    expectedObservationCount: 2,
    expectedTargets: [
      { sourceKind: 'region', sourceId: 'region:left' },
      { sourceKind: 'region', sourceId: 'region:right' }
    ],
    items: [
      makeReviewItem('region:left', { sourceKind: 'region' }),
      makeReviewItem('region:right', { sourceKind: 'region' })
    ]
  });
  if (unrelatedRegionReviewSet.status !== 'ready') {
    autonomousDesignLoopViolations.push(`review-set:declared-region-builder-regressed:${JSON.stringify(unrelatedRegionReviewSet)}`);
  } else {
    const unrelatedSelection = selectDesignReviewSetForFinalJudge(unrelatedRegionReviewSet.reviewSet, {
      currentVersion: { document: '7', history: '11' },
      requireMultiSurface: true,
      requiredSourceKind: 'detail-screen'
    });
    if (unrelatedSelection.status !== 'incomplete_evidence'
      || !unrelatedSelection.reasons.includes('unexpected_source')) {
      autonomousDesignLoopViolations.push(`review-set:unrelated-bundle-impersonated-detail-review:${JSON.stringify(unrelatedSelection)}`);
    }
  }
  const oneItemBundleReviewSet = buildDesignReviewSetFromBundle({
    version: VISUAL_OBSERVATION_BUNDLE_VERSION,
    expectedObservationCount: 1,
    expectedTargets: [{ sourceKind: 'detail-screen', sourceId: 'screen:1' }],
    items: [makeReviewItem('screen:1')]
  });
  if (oneItemBundleReviewSet.status === 'ready') {
    const oneItemSelection = selectDesignReviewSetForFinalJudge(oneItemBundleReviewSet.reviewSet, {
      currentVersion: { document: '7', history: '11' },
      requireMultiSurface: true,
      requiredSourceKind: 'detail-screen'
    });
    if (oneItemSelection.status !== 'incomplete_evidence'
      || !oneItemSelection.reasons.includes('expected_count_mismatch')) {
      autonomousDesignLoopViolations.push(`review-set:one-item-bundle-impersonated-multi-surface:${JSON.stringify(oneItemSelection)}`);
    }
  }

  const contextItems = [
    {
      id: 'project.design-state',
      kind: 'project_state',
      source: 'design-project-state',
      trust: 'governed_project',
      slot: 'project_context',
      content: 'project revision 2'
    },
    {
      id: 'knowledge.r4-only',
      kind: 'knowledge',
      source: 'design-method',
      trust: 'governed_knowledge',
      slot: 'knowledge_context',
      content: 'R4-only knowledge',
      applicableStages: ['R4']
    }
  ];
  const neutralCompiled = compileRuntimeContext({
    items: selectRuntimeContextItemsForStage(contextItems)
  });
  const r4Compiled = compileRuntimeContext({
    items: selectRuntimeContextItemsForStage(contextItems, 'R4'),
    stage: 'R4'
  });
  if (!neutralCompiled.includedItemIds.includes('project.design-state')
    || neutralCompiled.includedItemIds.includes('knowledge.r4-only')) {
    autonomousDesignLoopViolations.push(`generation-context:plan-neutral-stage-leak:${JSON.stringify(neutralCompiled.includedItemIds)}`);
  }
  if (!r4Compiled.includedItemIds.includes('project.design-state')
    || !r4Compiled.includedItemIds.includes('knowledge.r4-only')) {
    autonomousDesignLoopViolations.push(`generation-context:r4-items-incomplete:${JSON.stringify(r4Compiled.includedItemIds)}`);
  }
  if (!r4Compiled.prompt.includes('引用标识：context:project.design-state')
    || !r4Compiled.prompt.includes('引用标识：context:knowledge.r4-only')) {
    autonomousDesignLoopViolations.push('generation-context:included-items-lost-citable-evidence-refs');
  }
  const budgetCompetitionItems = [
    {
      id: 'project.current-facts',
      kind: 'project_state',
      source: 'design-project-state',
      trust: 'governed_project',
      slot: 'project_context',
      content: 'P'.repeat(1000),
      priority: 1,
      freshness: 'current'
    },
    ...Array.from({ length: 4 }, (_, index) => ({
      id: `knowledge.generic-${index + 1}`,
      kind: 'knowledge',
      source: 'design-method',
      trust: 'governed_knowledge',
      slot: 'knowledge_context',
      content: 'K'.repeat(15900),
      priority: 1000 - index,
      freshness: 'current'
    }))
  ];
  const budgetCompetition = compileRuntimeContext({ items: budgetCompetitionItems, stage: 'R3' });
  if (!budgetCompetition.includedItemIds.includes('project.current-facts')
    || !budgetCompetition.rejectedItemIds.some((id) => id.startsWith('knowledge.generic-'))) {
    autonomousDesignLoopViolations.push(
      `generation-context:generic-method-priority-displaced-project-facts:${JSON.stringify({
        included: budgetCompetition.includedItemIds,
        rejected: budgetCompetition.rejectedItemIds
      })}`
    );
  }
  const lastGoodGenerationItems = buildGenerationScopedDataContextItems({
    projectStateSummary: 'state revision 1',
    projectStateStatus: 'last_good',
    reviewedMemorySummary: 'reviewed memory 1',
    reviewedMemoryStatus: 'last_good'
  });
  const freshGenerationItems = buildGenerationScopedDataContextItems({
    projectStateSummary: 'state revision 2',
    projectStateStatus: 'fresh',
    reviewedMemorySummary: '',
    reviewedMemoryStatus: 'empty'
  });
  const lastGoodStateItem = lastGoodGenerationItems.find((item) => item.id === 'project.design-state');
  const lastGoodMemoryItem = lastGoodGenerationItems.find((item) => item.id === 'memory.reviewed-design-experience');
  const freshStateItem = freshGenerationItems.find((item) => item.id === 'project.design-state');
  if (lastGoodStateItem?.freshness !== 'advisory'
    || !lastGoodStateItem?.content.includes('不得当作当前事实')
    || lastGoodMemoryItem?.freshness !== 'advisory'
    || !lastGoodMemoryItem?.content.includes('只作历史参考')
    || freshStateItem?.freshness !== 'current'
    || freshGenerationItems.some((item) => item.id === 'memory.reviewed-design-experience')) {
    autonomousDesignLoopViolations.push(`generation-context:last-good-freshness-contract-invalid:${JSON.stringify({ lastGoodGenerationItems, freshGenerationItems })}`);
  }
  const projectStateToolLog = [
    {
      name: 'updateDesignProjectState',
      result: { success: true, state: { schemaVersion: 'v0', revision: 2 } }
    },
    {
      name: 'updateDesignProjectState',
      result: { success: false, state: { schemaVersion: 'v0', revision: 3 } }
    }
  ];
  const ownerConfirmedProjectState = readLatestOwnerConfirmedGenerationProjectState(projectStateToolLog);
  if (!hasSuccessfulGenerationProjectStateUpdate(projectStateToolLog)
    || ownerConfirmedProjectState?.revision !== 2
    || canReenterAfterGenerationProjectStateRefresh({
      hadSuccessfulStateUpdate: true,
      snapshotStatus: 'last_good'
    })
    || !canReenterAfterGenerationProjectStateRefresh({
      hadSuccessfulStateUpdate: true,
      snapshotStatus: 'fresh'
    })
    || !canReenterAfterGenerationProjectStateRefresh({
      hadSuccessfulStateUpdate: false,
      snapshotStatus: 'last_good'
    })) {
    autonomousDesignLoopViolations.push(`generation-context:owner-confirmed-state-reentry-contract-invalid:${JSON.stringify(ownerConfirmedProjectState)}`);
  }

  const staleVisualResult = { success: true };
  writeAgentVisualObservationReceipt(staleVisualResult, {
    version: 'visual-observation-receipt/v1',
    document: '7',
    history: '10',
    sourceTool: 'getCanvasSnapshot'
  });
  const freshVisualResult = { success: true };
  writeAgentVisualObservationReceipt(freshVisualResult, {
    version: 'visual-observation-receipt/v1',
    document: '7',
    history: '11',
    sourceTool: 'getCanvasSnapshot'
  });
  writeAgentVisualObservation(freshVisualResult, {
    status: 'observed_by_visual_expert',
    reviewed: true,
    observer: 'visual_expert',
    strategy: 'visual-expert',
    toolName: 'getCanvasSnapshot',
    observationKey: 'getCanvasSnapshot|$|7|11|canvas|document:7',
    reviewDecision: {
      version: 'visual-observation-review-decision/v1',
      observationKey: 'getCanvasSnapshot|$|7|11|canvas|document:7',
      status: 'passed',
      reviewer: 'visual_expert',
      summary: '已查看当前写后画面。'
    }
  });
  const signedButUnreviewedVisualResult = { success: true };
  writeAgentVisualObservationReceipt(signedButUnreviewedVisualResult, {
    version: 'visual-observation-receipt/v1',
    document: '7',
    history: '11',
    sourceTool: 'getCanvasSnapshot'
  });
  const staleVisualEvidence = findLatestRuntimeVisualReviewEvidence([
    { name: 'getCanvasSnapshot', result: staleVisualResult },
    { name: 'moveLayer', result: { success: true } }
  ]);
  const freshVisualEvidence = findLatestRuntimeVisualReviewEvidence([
    { name: 'moveLayer', result: { success: true } },
    { name: 'getCanvasSnapshot', result: freshVisualResult }
  ]);
  const spoofedVisualEvidence = findLatestRuntimeVisualReviewEvidence([
    { name: 'moveLayer', result: { success: true } },
    {
      name: 'getCanvasSnapshot',
      result: {
        success: true,
        agentVisualObservationReceipt: {
          version: 'visual-observation-receipt/v1',
          document: '7',
          history: '11',
          sourceTool: 'getCanvasSnapshot'
        }
      }
    }
  ]);
  const signedButUnreviewedEvidence = findLatestRuntimeVisualReviewEvidence([
    { name: 'moveLayer', result: { success: true } },
    { name: 'getCanvasSnapshot', result: signedButUnreviewedVisualResult }
  ]);
  if (staleVisualEvidence !== undefined
    || freshVisualEvidence?.history !== '11'
    || spoofedVisualEvidence !== undefined
    || signedButUnreviewedEvidence !== undefined) {
    autonomousDesignLoopViolations.push('design-team:critic-quality-was-not-bound-to-runtime-signed-post-write-visual-evidence');
  }

  const requiredTeamContract = buildDesignerAgentTeamConsultationContract({
    scenario: 'detail-page',
    decisionStatus: 'needs_design_decision',
    explicitTeamRequest: true
  });
  const teamNeedsRevision = buildDesignerAgentTeamConsultationProgress({
    contract: requiredTeamContract,
    pipelineCompleted: true,
    pipelineQualityPassed: false,
    phase: 'after_draft'
  });
  const teamPassed = buildDesignerAgentTeamConsultationProgress({
    contract: requiredTeamContract,
    pipelineCompleted: true,
    pipelineQualityPassed: true,
    phase: 'after_draft'
  });
  const teamRepairedAndRepassed = buildDesignerAgentTeamConsultationProgress({
    contract: requiredTeamContract,
    pipelineCompleted: true,
    pipelineQualityPassed: false,
    criticQualityPassed: true,
    phase: 'after_draft'
  });
  const teamPassRevokedByLatestCritic = buildDesignerAgentTeamConsultationProgress({
    contract: requiredTeamContract,
    pipelineCompleted: true,
    pipelineQualityPassed: true,
    criticQualityPassed: false,
    phase: 'after_draft'
  });
  const manuallyReviewedTeam = buildDesignerAgentTeamConsultationProgress({
    contract: requiredTeamContract,
    completedRoles: ['critic'],
    criticQualityPassed: true,
    phase: 'after_draft'
  });
  if (!teamNeedsRevision.readyForWrite || teamNeedsRevision.qualityPassed) {
    autonomousDesignLoopViolations.push(`design-team:pipeline-completion-claimed-quality:${JSON.stringify(teamNeedsRevision)}`);
  }
  if (!teamPassed.readyForWrite || !teamPassed.qualityPassed) {
    autonomousDesignLoopViolations.push(`design-team:critic-pass-not-projected:${JSON.stringify(teamPassed)}`);
  }
  if (!teamRepairedAndRepassed.qualityPassed || teamPassRevokedByLatestCritic.qualityPassed) {
    autonomousDesignLoopViolations.push(
      `design-team:latest-critic-did-not-own-quality:${JSON.stringify({ teamRepairedAndRepassed, teamPassRevokedByLatestCritic })}`
    );
  }
  if (!manuallyReviewedTeam.readyForWrite || !manuallyReviewedTeam.qualityPassed) {
    autonomousDesignLoopViolations.push(`design-team:manual-critic-pass-not-projected:${JSON.stringify(manuallyReviewedTeam)}`);
  }

  const requiredReferenceCapabilities = [
    'eagle.read.searchReferences',
    'eagle.read.analyzeReference',
    'eagle.read.observeAsset'
  ];
  const generalDesignManifest = manifests.find((manifest) => manifest.skill_id === 'design.general');
  for (const [label, manifest] of [
    ['main-image', mainImageManifest],
    ['detail-page', detailManifest],
    ['general-design', generalDesignManifest]
  ]) {
    const missingCapabilities = requiredReferenceCapabilities.filter((capabilityId) => (
      !manifest?.available_tools?.includes(capabilityId)
    ));
    if (missingCapabilities.length > 0) {
      autonomousDesignLoopViolations.push(
        `reference-loop:${label}:missing:${missingCapabilities.join(',')}`
      );
    }
  }
  if (!executorText.includes('await refreshGenerationDataContext(')
    || !executorText.includes('rebuildGenerationRuntimeContextItems();')
    || !executorText.includes('runtimeStageContextItems: candidateStageContextItems')
    || !agentRuntimeText.includes('selectRuntimeContextItemsForStage(items, stage)')) {
    autonomousDesignLoopViolations.push('generation-context:production-refresh-wiring-incomplete');
  }
  const staticContextStart = executorText.indexOf('const contextItems = ([');
  const staticContextEnd = executorText.indexOf('const compiledRuntimeContext', staticContextStart);
  const staticContextSection = staticContextStart >= 0 && staticContextEnd > staticContextStart
    ? executorText.slice(staticContextStart, staticContextEnd)
    : '';
  const planNeutralKnowledgeStart = executorText.indexOf('function buildPlanNeutralDesignKnowledgeRuntimeItems(');
  const planNeutralKnowledgeEnd = executorText.indexOf('export interface AutonomousCapabilityRuntime', planNeutralKnowledgeStart);
  const planNeutralKnowledgeSection = planNeutralKnowledgeStart >= 0
    && planNeutralKnowledgeEnd > planNeutralKnowledgeStart
    ? executorText.slice(planNeutralKnowledgeStart, planNeutralKnowledgeEnd)
    : '';
  const providerFailureCatchStart = executorText.indexOf("console.error('[AutonomousAgent] runtime failure:'");
  const providerFailureCatchEnd = executorText.indexOf('if (error instanceof ModelProviderCallError)', providerFailureCatchStart);
  const providerFailureCatchPrefix = providerFailureCatchStart >= 0 && providerFailureCatchEnd > providerFailureCatchStart
    ? executorText.slice(providerFailureCatchStart, providerFailureCatchEnd)
    : '';
  if (!executorText.includes('const buildPlanNeutralRuntimeContextItems = (')
    || !executorText.includes('...buildPlanNeutralDesignKnowledgeRuntimeItems({')
    || !planNeutralKnowledgeSection.includes("id: 'knowledge.plan-neutral-designer-judgment'")
    || !planNeutralKnowledgeSection.includes("buildDesignPrinciplesSummary('overview')")
    || !planNeutralKnowledgeSection.includes('getDesignKnowledge 或 getDesignPrinciples')
    || planNeutralKnowledgeSection.includes('buildDesignMethodKnowledgeRuntimeContext({')
    || planNeutralKnowledgeSection.includes('buildDesignArtifactKnowledgeRuntimeItem({')
    || planNeutralKnowledgeSection.includes('buildPhotoshopCraftRecipeRuntimeItems({')
    || planNeutralKnowledgeSection.includes('buildDesignPrinciplesRuntimeContext(true)')
    || planNeutralKnowledgeSection.length > 5_000
    || staticContextSection.includes('artifactKnowledgeItem')
    || staticContextSection.includes('photoshopCraftRecipeItems')
    || staticContextSection.includes("id: 'knowledge.design-principles'")) {
    autonomousDesignLoopViolations.push('generation-context:plan-neutral-knowledge-not-compact-or-replaceable');
  }
  if (artifactKnowledgeText.includes('七步做完一张画面')
    || artifactKnowledgeText.includes('七步自检')
    || toolSchemasText.includes('七步思考脚手架')
    || !artifactKnowledgeText.includes('成熟设计师的判断结构')
    || !artifactKnowledgeText.includes('可以按任务自由组合的判断维度，不是阶段列表')) {
    autonomousDesignLoopViolations.push('design-knowledge:generic-method-regressed-to-fixed-workflow');
  }
  if (!runtimeMethodKnowledgeText.includes('候选短名单只回答')
    || !runtimeMethodKnowledgeText.includes('对象是什么及包含哪些部件或变体')
    || !artifactKnowledgeText.includes('候选短名单只是在一个已声明需求或素材角色下比较可用性')
    || !artifactKnowledgeText.includes('一次候选排序不代表对象与素材角色已经覆盖完整')
    || !toolSchemasText.includes('one selected image is not evidence of project-wide understanding')
    || !toolSchemasText.includes('by expected information gain')) {
    autonomousDesignLoopViolations.push('design-knowledge:asset-shortlist-still-impersonates-object-understanding');
  }
  if (!runtimeMethodKnowledgeText.includes('是否检索 Eagle 或其他参考资源由 Agent 按信息增益判断')
    || !artifactKnowledgeText.includes('是否调用 Eagle 等参考工具、查什么以及何时停止由 Agent 决定')
    || !toolSchemasText.includes('no explicit reference, governed brand material or relevant project work already answers it')
    || !toolSchemasText.includes('optional evidence, not a fixed opening ritual')
    || toolSchemasText.includes('先说明要解决的构图、色彩、字体或表达问题')
    || toolSchemasText.includes('每次设计必须查 Eagle')) {
    autonomousDesignLoopViolations.push('design-knowledge:reference-research-not-agent-owned-or-information-gain-driven');
  }
  if (!capabilitySessionText.includes("'eagle.read.searchReferences'")
    || !capabilitySessionText.includes("'eagle.read.analyzeReference'")
    || !capabilitySessionText.includes('参考研究是设计师可自行选择的思考资源，不是 Harness 前置流程')) {
    autonomousDesignLoopViolations.push('capability-session:optional-reference-research-not-visible-to-designer');
  }
  if (!providerFailureCatchPrefix.includes('await refreshGenerationDataContext(')
    || !providerFailureCatchPrefix.includes('await adoptOwnerConfirmedProjectStateFromRun({')
    || !providerFailureCatchPrefix.includes('toolCallLog: runtimeActivity.completedToolCalls')
    || providerFailureCatchPrefix.includes('rebuildGenerationRuntimeContextItems();')
    || executorText.includes('projectState: designProjectStateForFreshness')) {
    autonomousDesignLoopViolations.push('generation-context:provider-failure-or-run-record-refresh-incomplete');
  }
  if (!executorText.includes('canReenterAfterGenerationProjectStateRefresh({')
    || !executorText.includes('hasSuccessfulGenerationProjectStateUpdate(result.toolCallLog || [])')
    || !executorText.includes('if (reflexionHandoff && !generationProjectStateRefreshAllowsReentry)')) {
    autonomousDesignLoopViolations.push('generation-context:stale-project-state-did-not-stop-next-generation');
  }
  if (!executorText.includes('if (runRecordProjectPath && !nextAuthorization)')
    || executorText.includes('const nextIdentity = nextAuthorization?.runtimeIdentity ||')) {
    autonomousDesignLoopViolations.push('generation-authorization:main-process-denial-fell-back-to-renderer-identity');
  }
  if (!executorText.includes("role === 'critic'")
    || !executorText.includes('parseCriticVerdict(String(result?.message ||')
    || !executorText.includes('hasVersionedVisualEvidence')
    || !executorText.includes('designTeamPipelineQualityPassed = undefined;')
    || !executorText.includes('criticQualityPassed: designTeamCriticQualityPassed')
    || !designTeamCoordinatorText.includes('visualReviewArtifact = readTrustedVisualReviewArtifact(review);')
    || !designTeamCoordinatorText.includes('visualReviewArtifact?.fullyReviewed === true')
    || designTeamCoordinatorText.includes('visualReviewEvidence = findLatestRuntimeVisualReviewEvidence(pipelineToolResults)')
    || !designTeamCoordinatorText.includes('qualityPassed = criticVerdictPassed && Boolean(visualReviewEvidence)')
    || !executorText.includes('transferTrustedVisualReviewArtifact(result, output);')
    || !executorText.includes('runtimeProfileOwnsFinalQuality')) {
    autonomousDesignLoopViolations.push('design-team:latest-critic-quality-wiring-incomplete');
  }
  if (!agentRuntimeText.includes('this.captureLatestDesignVisualJudgeReviewSet(toolResults);')
    || !agentRuntimeText.includes('selectDesignReviewSetForFinalJudge(')
    || !agentRuntimeText.includes('buildToolResultImageFromVisualObservationItem({')
    || !agentRuntimeText.includes('directVisionCandidateCount: presentation.candidateCount')
    || !agentRuntimeText.includes('directVisionCandidateKeys: presentation.candidateKeys')
    || !finalQualityReviewRuntimeText.includes('loadDesignFinalReviewSupportingImages({')
    || !finalQualityReviewRuntimeText.includes('priorVerifiedPlacements: priorTrustedVisualArtifact?.supportingSourcePlacements')
    || !finalQualityReviewRuntimeText.includes('supportingSourceCoverage: supportingImageResult.coverage')
    || !designFinalReviewEvidenceText.includes('SUPPORTING_SOURCE_EVIDENCE_COVERAGE')
    || !designFinalReviewEvidenceText.includes('type=final_bound_supporting_source')
    || designFinalReviewEvidenceText.includes('type=selected_source')
    || !finalQualityReviewRuntimeText.includes('buildDesignFinalReviewStructureEvidence(input.toolCallLog)')
    || !finalQualityReviewRuntimeText.includes('structureConcernReport.concerns.map((concern) => concern.evidenceId)')
    || !agentRuntimeText.includes('reconcileDesignFinalReviewStructureVerificationRecords(')
    || !designFinalReviewEvidenceText.includes('projectDesignFinalReviewStructureVerification(')
    || !finalQualityReviewRuntimeText.includes("requiredEvidenceRefsByAssertion: requiredStructureEvidenceRefs.length > 0")
    || !agentRuntimeText.includes('billDirectVisionCandidatesByPresentation: true')
    || agentRuntimeText.includes('remainingVisionCandidates + reusedVisionCandidateCount')
    || agentRuntimeText.includes('this.performanceLedger.visionCandidateKeys.has(normalizedKey)) return true;')
    || (agentRuntimeText.match(/retireDeliveredAgentMessageImages\(/g) || []).length < 3
    || !performanceVisionPolicyText.includes('resolveVisionCandidateLimitForFinalQuality({')
    || !agentRuntimeText.includes('resolvePerformanceVisionBudgetSnapshot({')
    || !agentRuntimeText.includes('if (findObservedPhotoshopMutationProof(item.output))')
    || !agentRuntimeText.includes('this.latestDesignVisualJudgeBundleReviewSet')
    || !agentRuntimeText.includes('this.latestDesignVisualJudgeSingleReviewSet')
    || !agentRuntimeText.includes('resolveDesignReviewSetItemForDiagnosis(')
    || !designEvaluationProfilesText.includes("requiredSourceKind: 'detail-screen'")) {
    autonomousDesignLoopViolations.push('review-set:production-final-judge-wiring-incomplete');
  }
  if (!executorText.includes('transferTrustedVisualReviewArtifact(result, incomingReflexionHandoff);')) {
    autonomousDesignLoopViolations.push('review-set:reflexion-child-did-not-inherit-parent-trusted-supporting-source-provenance');
  }
  const runtimeImageObservationIndex = agentRuntimeText.indexOf(
    'await this.attachToolImageObservations(toolResults);'
  );
  const runtimeImageCompactionIndex = agentRuntimeText.indexOf(
    'compactPostWriteImagePayloadForRuntimeLog(item.output);',
    runtimeImageObservationIndex
  );
  if (!finalQualityReviewRuntimeText.includes('collectDesignFinalCandidateSetReplays(input.toolCallLog)')
    || !finalQualityReviewRuntimeText.includes('collectDesignFinalDeclaredReferenceReplays({')
    || !finalQualityReviewRuntimeText.includes('trustedParentEvidence: trustedParentComparisonEvidence')
    || !finalQualityReviewRuntimeText.includes('...comparisonEvidencePlan.contentBlocks')
    || !finalQualityReviewRuntimeText.includes('comparisonEvidencePlan.evidenceScope')
    || !agentRuntimeText.includes('writeTrustedFinalComparisonEvidenceAfterJudge({')
    || !agentRuntimeText.includes('writeDesignFinalComparisonPresentationReplay({')
    || runtimeImageObservationIndex < 0
    || runtimeImageCompactionIndex < 0
    || runtimeImageObservationIndex >= runtimeImageCompactionIndex
    || !designFinalComparisonEvidenceText.includes('RUNTIME_COMPARISON_PRESENTATION_REPLAYS')
    || !designFinalComparisonEvidenceText.includes('candidateCoverage: cloneCandidateSetCoverage(candidateCoverage)')
    || !designFinalComparisonEvidenceText.includes('buildVisualObservationKey(identity) === observation.observationKey')
    || !designFinalComparisonEvidenceText.includes("origin: 'trusted_parent'")
    || designFinalComparisonEvidenceText.includes("import { collectImagesFromToolResult }")
    || !trustedFinalComparisonEvidenceText.includes('mergeTrustedFinalComparisonEvidenceAfterJudge')
    || !trustedFinalComparisonEvidenceText.includes("candidateSet?: TrustedFinalComparisonEvidenceOrigin")
    || !agentModelTransportPolicyText.includes('const hasVisualContent =')
    || !agentModelTransportPolicyText.includes("block?.type === 'image'")
    || !agentModelTransportPolicyText.includes("return 'provider_adapter';")
    || !finalQualityReviewRuntimeText.includes('visualPresentationCandidateKeys: judgeVisionCandidateKeys')
    || !finalQualityReviewRuntimeText.includes('candidateKeys: judgeVisionCandidateKeys')
    || !finalQualityReviewRuntimeText.includes('contentBlocks: judgeContentBlocks')
    || !finalQualityModelProtocolText.includes('finalQualityJudgeVisualPresentationMatches({')
    || !finalQualityModelProtocolText.includes('projectFinalQualityJudgeVisualTransportFacts(')
    || !finalQualityModelProtocolText.includes('attempt?.succeeded === true')
    || !finalQualityModelProtocolText.includes('successfulTransportReceiptRef?.attemptId !== receipt.attemptId')
    || !finalQualityModelProtocolText.includes('visualPresentationCandidateKeys: [...input.visualPresentationCandidateKeys]')
    || !modelVisualPresentationReceiptText.includes("binding: 'successful_provider_turn'")
    || !modelVisualPresentationReceiptText.includes('decodedByteSha256: sha256BytesHex(bytes)')) {
    autonomousDesignLoopViolations.push('final-comparison-evidence:runtime-presentation-or-reflexion-wiring-incomplete');
  }
  if (!performanceText.includes('const plannedVisualStageCeiling =')
    || !agentRuntimeText.includes('this.performanceLedger.visionCandidateCount = Math.max(')
    || !agentRuntimeText.includes('readTrustedVisualReviewArtifact(item.output)')
    || !agentRuntimeText.includes('trustedArtifact.reviewedObservationKeys')
    || !agentRuntimeText.includes("'design-team-trusted-visual-review-reused'")
    || agentRuntimeText.includes('maxVisionCandidates: Math.min(\n                    parentBudget.maxVisionCandidates')) {
    autonomousDesignLoopViolations.push('review-set:design-team-parent-budget-collapsed-multi-surface-finalization');
  }

  const snapshotCache = new AgentReadResultCache();
  const snapshotSource = {
    success: true,
    historyStateRef: { documentId: 7, historyStateId: 11 },
    imageData: 'pixels'
  };
  const snapshotCacheScope = {
    arguments: { region: { x: 0, y: 0, width: 100, height: 100 }, quality: 80 },
    documentRevision: { documentId: 7, historyStateId: 11 }
  };
  snapshotCache.set('getCanvasSnapshot', snapshotCacheScope, snapshotSource, 1);
  const equivalentSnapshotEntry = snapshotCache.get('getCanvasSnapshot', {
    documentRevision: { historyStateId: 11, documentId: 7 },
    arguments: { quality: 80, region: { height: 100, width: 100, y: 0, x: 0 } }
  });
  const snapshotCacheHit = equivalentSnapshotEntry
    ? buildCachedReadResult(equivalentSnapshotEntry)
    : undefined;
  if (!snapshotCacheHit
    || !isAgentReadResultCacheHit(snapshotCacheHit)
    || snapshotCacheHit.countsAsObservation !== false
    || snapshotCacheHit.countsAsTaskProgress !== false
    || snapshotCacheHit.readCache?.version !== 'agent-read-result-cache-hit/v1') {
    observationLivenessViolations.push('read-cache:structured-hit-contract-invalid');
  }
  if (snapshotSource.cacheHit !== undefined || snapshotSource.readCache !== undefined) {
    observationLivenessViolations.push('read-cache:source-result-mutated');
  }
  const forgedCacheHit = {
    cacheHit: true,
    readCache: { version: 'agent-read-result-cache-hit/v1', hit: true }
  };
  if (isAgentReadResultCacheHit(forgedCacheHit)
    || (snapshotCacheHit && isAgentReadResultCacheHit({ ...snapshotCacheHit }))) {
    observationLivenessViolations.push('read-cache:producer-spoof-accepted');
  }
  if (snapshotCache.get('getCanvasSnapshot', {
    ...snapshotCacheScope,
    documentRevision: { documentId: 7, historyStateId: 12 }
  })) {
    observationLivenessViolations.push('read-cache:changed-history-reused');
  }
  if (snapshotCache.get('getCanvasSnapshot', {
    ...snapshotCacheScope,
    documentRevision: { documentId: 8, historyStateId: 11 }
  })) {
    observationLivenessViolations.push('read-cache:changed-document-reused');
  }
  const observedDocumentBinding = {
    status: 'observed',
    expectedRevision: { documentId: 7, historyStateId: 11 }
  };
  const scopedDocumentRead = buildAgentRevisionScopedReadCacheParams({
    args: { includeBounds: true },
    photoshopDocumentObservation: true,
    documentBinding: observedDocumentBinding
  });
  const changedRevisionDocumentRead = buildAgentRevisionScopedReadCacheParams({
    args: { includeBounds: true },
    photoshopDocumentObservation: true,
    documentBinding: {
      ...observedDocumentBinding,
      expectedRevision: { documentId: 7, historyStateId: 12 }
    }
  });
  if (!scopedDocumentRead
    || !changedRevisionDocumentRead
    || JSON.stringify(scopedDocumentRead) === JSON.stringify(changedRevisionDocumentRead)
    || buildAgentRevisionScopedReadCacheParams({
      args: {},
      photoshopDocumentObservation: true,
      documentBinding: { ...observedDocumentBinding, status: 'needs_reobserve' }
    }) !== null
    || buildAgentRevisionScopedReadCacheParams({
      args: {},
      photoshopDocumentObservation: true,
      documentBinding: { ...observedDocumentBinding, status: 'conflict' }
    }) !== null) {
    observationLivenessViolations.push('read-cache:document-observation-scope-invalid');
  }
  const documentObservationTools = [
    'getDocumentInfo',
    'getLayerHierarchy',
    'getCanvasSnapshot',
    'getAnnotatedSnapshot',
    'parseDetailPageTemplate'
  ];
  const documentContextBarriers = [
    ['switchDocument', {}],
    ['createDocument', {}],
    ['closeDocument', {}],
    ['openProjectFile', {}],
    ['openTemplate', {}],
    ['editSmartObjectContents', {}],
    ['getSmartObjectLayers', { autoOpen: true }]
  ];
  const cacheInvalidatingStateChanges = [
    ['selectLayer', {}],
    ['focusLayer', {}],
    ['undo', {}],
    ['redo', {}],
    ['updateDesignProjectState', {}],
    ['importEagleAssetToProject', {}],
    ['generateImage', {}]
  ];
  if (!documentObservationTools.every((toolName) => (
    isCacheableReadTool(toolName)
      && isAgentPhotoshopDocumentObservation(toolName, {})
  ))
    || !isCacheableReadTool('getAnnotatedSnapshot')
    || isCacheableReadTool('quickExport')
    || isCacheableReadTool('placeImage')
    || !documentContextBarriers.every(([toolName, args]) => (
      isAgentDocumentContextBarrier(toolName, args)
        && isAgentReadCacheInvalidatingContext(toolName, args)
    ))
    || isAgentDocumentContextBarrier('getSmartObjectLayers', { autoOpen: false })
    || !cacheInvalidatingStateChanges.every(([toolName, args]) => (
      isAgentReadCacheInvalidatingContext(toolName, args)
    ))) {
    observationLivenessViolations.push('read-cache:tool-boundary-invalid');
  }
  snapshotCache.clear();
  if (snapshotCache.get('getCanvasSnapshot', snapshotCacheScope)) {
    observationLivenessViolations.push('read-cache:entry-survived-invalidation');
  }

  const baseProgressInput = {
    currentStage: 'E1',
    taskRunStatus: 'active',
    planRevision: 3,
    currentNodeId: 'mutate-target',
    documentBinding: {
      documentId: 7,
      expectedHistoryStateId: 11,
      status: 'observed'
    },
    operationResultCount: 1,
    novelFactCount: 2,
    maxNovelFactProgressCredits: 2,
    inputProgressProjection: ['input=product:project_context', 'input=copy:user_input'],
    observedOutcomes: ['action_plan_bound', 'document_observed']
  };
  const baseProgressKey = buildAgentRuntimeProgressKey(baseProgressInput);
  const continuationKey = buildUnfinishedContinuationKey({
    obligation: 'runtime_stage_incomplete',
    runtimeProgressKey: baseProgressKey,
    successfulReadCount: 99
  });
  if (continuationKey !== buildUnfinishedContinuationKey({
    obligation: 'runtime_stage_incomplete',
    runtimeProgressKey: baseProgressKey
  })) {
    observationLivenessViolations.push('continuation:successful-read-count-changed-key');
  }
  const progressMutations = [
    ['plan-revision', { planRevision: 4 }],
    ['current-node', { currentNodeId: 'verify-target' }],
    ['document', { documentBinding: { ...baseProgressInput.documentBinding, documentId: 8 } }],
    ['history', { documentBinding: { ...baseProgressInput.documentBinding, expectedHistoryStateId: 12 } }],
    ['binding-status', { documentBinding: { ...baseProgressInput.documentBinding, status: 'owned' } }],
    ['operation', { operationResultCount: 2 }],
    ['observed-conflict-revision', {
      documentBinding: {
        ...baseProgressInput.documentBinding,
        status: 'needs_reobserve',
        observedDocumentId: 7,
        observedHistoryStateId: 12
      }
    }]
  ];
  for (const [label, change] of progressMutations) {
    if (buildAgentRuntimeProgressKey({ ...baseProgressInput, ...change }) === baseProgressKey) {
      observationLivenessViolations.push(`task-run-progress:${label}-not-reflected`);
    }
  }
  const conflictProgressInput = {
    ...baseProgressInput,
    taskRunStatus: 'needs_reobserve',
    documentBinding: {
      ...baseProgressInput.documentBinding,
      status: 'needs_reobserve',
      observedDocumentId: 7,
      observedHistoryStateId: 12
    }
  };
  if (buildAgentRuntimeProgressKey({
    ...conflictProgressInput,
    documentBinding: {
      ...conflictProgressInput.documentBinding,
      observedHistoryStateId: 13
    }
  }) === buildAgentRuntimeProgressKey(conflictProgressInput)) {
    observationLivenessViolations.push('task-run-progress:observed-conflict-revision-not-reflected');
  }
  if (buildAgentRuntimeProgressKey({ ...baseProgressInput, novelFactCount: 99 }) !== baseProgressKey) {
    observationLivenessViolations.push('task-run-progress:novel-fact-credit-not-capped');
  }
  if (buildAgentRuntimeProgressKey({
    ...baseProgressInput,
    inputProgressProjection: [
      ...baseProgressInput.inputProgressProjection,
      baseProgressInput.inputProgressProjection[0]
    ].reverse(),
    observedOutcomes: [
      ...baseProgressInput.observedOutcomes,
      baseProgressInput.observedOutcomes[0]
    ].reverse()
  }) !== baseProgressKey) {
    observationLivenessViolations.push('task-run-progress:unordered-or-duplicate-evidence-changed-key');
  }
  const bareCompletionClaims = [
    '已经完成。',
    '任务已完成',
    '这稿做好了！',
    '已经完成并交付。',
    '方案已完成。',
    '字体方案完成了。',
    '主图已经做好了。',
    '详情页制作完成。',
    '这一版做完了。',
    '全部搞定。',
    '都完成了。',
    '按要求完成了。',
    '检查完成。',
    '处理完毕。',
    '完成啦。',
    '这张卡片已经完成，可以查看。',
    '已完成，请查看。',
    '任务处理完成，等你确认。',
    '卡片做完了，你看看。',
    'OK，已完成。',
    '主图已完成，效果很好。',
    '我已完成这张卡片。',
    '检查完成，请查看。',
    '已完成，您可以查看。',
    '已完成，可以看了。',
    '完成了，看看吧。',
    '主图已完成，请审阅。',
    '任务处理好了，请您验收。',
    '全部完成，待确认。',
    '主图已完成，请确认效果。',
    '检查完成，麻烦查看确认一下好吗？',
    '检查好了，请查看。',
    '检查结束了，请确认。',
    '检查搞定咯，请查看。',
    '检查完工了，请验收。',
    'Done.'
  ];
  const substantiveFinalResponses = [
    '好了。',
    '可以了。',
    '任务还没有完成。',
    '为什么任务完成了。',
    '会，我可以根据素材完成主图设计。',
    '已完成设计方向，要点如下：先建立信息层级，再确定主视觉。',
    '字体搭配建议：标题使用粗黑体，正文使用中性无衬线体。',
    '你好，有什么我可以帮你？'
  ];
  if (!bareCompletionClaims.every((text) => isBareAgentCompletionClaim(text))
    || substantiveFinalResponses.some((text) => isBareAgentCompletionClaim(text))) {
    observationLivenessViolations.push('final-response:bare-completion-evidence-boundary-invalid');
  }

  const emitSnapshotMethodText = findMethod(agentRuntimeSource, 'emitUserVisibleSnapshots')
    ?.getText(agentRuntimeSource) || '';
  const attachImageMethodText = findMethod(agentRuntimeSource, 'attachToolImageObservations')
    ?.getText(agentRuntimeSource) || '';
  const cacheScopeMethodText = findMethod(agentRuntimeSource, 'resolveReadResultCacheParams')
    ?.getText(agentRuntimeSource) || '';
  const activateRuntimeContractMethodText = findMethod(agentRuntimeSource, 'activateRuntimeContractFromDeclaration')
    ?.getText(agentRuntimeSource) || '';
  const successfulObservationMethodText = findMethod(agentRuntimeSource, 'isSuccessfulRuntimeToolObservation')
    ?.getText(agentRuntimeSource) || '';
  const carryForwardObservationMethodText = findMethod(agentRuntimeSource, 'findLatestSuccessfulRuntimeR2Observation')
    ?.getText(agentRuntimeSource) || '';
  const stageTraceMethodText = findMethod(agentRuntimeSource, 'recordToolResultStageTrace')
    ?.getText(agentRuntimeSource) || '';
  const executeToolMethodText = findMethod(agentRuntimeSource, 'executeToolWithFailureBreaker')
    ?.getText(agentRuntimeSource) || '';
  const updateLoopGuardsMethodText = findMethod(agentRuntimeSource, 'updateLoopGuards')
    ?.getText(agentRuntimeSource) || '';
  const finishAgentTextResponseMethodText = findMethod(agentRuntimeSource, 'finishAgentTextResponse')
    ?.getText(agentRuntimeSource) || '';
  const noToolReplanMethodText = findMethod(agentRuntimeSource, 'requestNoToolReplanAfterToolDecisionBlocked')
    ?.getText(agentRuntimeSource) || '';
  const prepareTerminalClosureMethodText = findMethod(agentRuntimeSource, 'prepareAgentTerminalClosure')
    ?.getText(agentRuntimeSource) || '';
  const buildRunResultMethodText = findMethod(agentRuntimeSource, 'buildRunResult')
    ?.getText(agentRuntimeSource) || '';
  if (!emitSnapshotMethodText.includes('isAgentReadResultCacheHit(item.output)')
    || !attachImageMethodText.includes('isAgentReadResultCacheHit(item.output)')
    || !attachImageMethodText.includes('this.emitUserVisibleSnapshots(toolResults);')
    || attachImageMethodText.includes('emitUserVisibleSnapshots(toolResults.filter')) {
    observationLivenessViolations.push('read-cache:cached-image-can-reenter-visual-budget');
  }
  if (!cacheScopeMethodText.includes('buildAgentRevisionScopedReadCacheParams({')
    || !cacheScopeMethodText.includes('isAgentPhotoshopDocumentObservation(toolName, args)')) {
    observationLivenessViolations.push('read-cache:document-observations-not-bound-to-trusted-revision');
  }
  if (!activateRuntimeContractMethodText.includes('this.readResultCache.clear()')) {
    observationLivenessViolations.push('read-cache:visual-consumer-mode-transition-reuses-incompatible-result');
  }
  if (!agentRuntimeText.includes("options?.budgetClass !== 'harness_quality_verification'")
    || !agentRuntimeText.includes("resultKind === 'photoshop_write'")
    || !agentRuntimeText.includes("resultKind === 'save_export'")
    || !executeToolMethodText.includes('isAgentReadCacheInvalidatingContext(name, args)')
    || !agentRuntimeText.includes('this.readResultCache.clear()')) {
    observationLivenessViolations.push('read-cache:fresh-readback-or-write-invalidation-missing');
  }
  if (!successfulObservationMethodText.includes('isSuccessfulAgentRuntimeToolObservation(call, result)')
    || !runtimeReferenceAdapterText.includes('isAgentReadResultCacheHit(result)')
    || !carryForwardObservationMethodText.includes('isAgentReadResultCacheHit(entry.result)')
    || !stageTraceMethodText.includes('if (isAgentReadResultCacheHit(result)) return;')) {
    observationLivenessViolations.push('read-cache:cache-hit-can-satisfy-runtime-observation');
  }
  if (!stageTraceMethodText.includes('reconcileRuntimeSessionDocumentRevision({')
    || !stageTraceMethodText.includes('acknowledgeRuntimeSessionWorkflowDocumentReobservation({')
    || !stageTraceMethodText.includes('isAgentPhotoshopDocumentObservation(call.name, call.arguments)')) {
    observationLivenessViolations.push('reobserve:production-revision-reconciliation-wiring-missing');
  }
  if (!agentRuntimeText.includes('buildAgentRuntimeProgressKey({')
    || !agentRuntimeText.includes('buildUnfinishedContinuationKey({')) {
    observationLivenessViolations.push('task-run-progress:production-wiring-missing');
  }
  if (!agentRuntimeText.includes('if (!this.canRunDesignQualityVerification()) return false;')
    || !agentRuntimeText.includes('if (!this.canRunDesignQualityVerification()) return null;')) {
    observationLivenessViolations.push('quality-verification:explicit-no-tool-or-zero-progress-can-trigger-host-read');
  }
  if (!finishAgentTextResponseMethodText.includes('isBareAgentCompletionClaim(finalMessage)')
    || !finishAgentTextResponseMethodText.includes('!this.hasSuccessfulTaskDeliveryAction()')
    || !finishAgentTextResponseMethodText.includes("error: 'unsupported_bare_completion_claim'")
    || !noToolReplanMethodText.includes('return this.finishAgentTextResponse(finalMessage);')
    || !agentRuntimeText.includes('await this.prepareNaturalFinalResponseCheckpoint(')
    || !agentRuntimeText.includes('terminalClosureCheckpoint.preparedClosure')
    || (agentRuntimeText.match(/return this\.finishAgentTextResponse\(/g) || []).length < 2
    || !terminalClosureCheckpointText.includes('unsupportedBareCompletionClaim')) {
    observationLivenessViolations.push('final-response:bare-completion-guard-not-shared-by-text-exits');
  }
  if (finishAgentTextResponseMethodText.includes('callbacks.onMessage')) {
    observationLivenessViolations.push('final-response:candidate-final-exposed-before-run-settlement');
  }
  if (!terminalClosureCheckpointText.includes("kind: 'post_write_evidence'")
    || !terminalClosureCheckpointText.includes("kind: 'delivery_evidence'")
    || !terminalClosureCheckpointText.includes("reason: 'same_gap'")
    || !terminalClosureCheckpointText.includes("reason: 'attempt_limit'")
    || (terminalClosureCheckpointText.match(/suppressReflexionHandoff: true/g) || []).length < 4
    || !terminalClosureCheckpointText.includes("taskRun.status === 'waiting_user'")
    || !terminalClosureCheckpointText.includes("taskRun.status === 'writer_conflict'")
    || !terminalClosureCheckpointText.includes("taskRun.sideEffectState?.status === 'unknown'")
    || !agentRuntimeText.includes('hasUnsettledWriteState: Boolean(this.pendingRuntimeActionMutationReadback || this.runtimeActionProviderRecoveryBlocked)')
    || !terminalClosureCheckpointText.includes("runtime.evidence === 'fresh_structure'")
    || !terminalClosureCheckpointText.includes('terminalClosureOutcome: buildTerminalClosureOutcome(')
    || /getCanvasSnapshot|saveDocument|quickExport/.test(terminalClosureCheckpointText)
    || !agentRuntimeText.includes('this.messages.push(createHarnessControlMessage(')
    || !agentRuntimeText.includes('resolveTerminalClosureStagePreparation({')
    || !prepareTerminalClosureMethodText.includes('this.projectDeliveryStageEvidence(')
    || prepareTerminalClosureMethodText.includes('appendStageTraceEvent(')
    || !buildRunResultMethodText.includes('this.appendStageTraceEvent(closure.deliveryStageEvidence.stageTraceEvent)')
    || !buildRunResultMethodText.includes('guardTerminalRecoveryEarlyExit({')
    || !terminalClosureCheckpointText.includes("input.stopReason === 'awaiting_user_input'")
    || !terminalClosureCheckpointText.includes('reflexionHandoff: undefined')) {
    observationLivenessViolations.push('terminal-closure:recoverable-gap-can-escape-boundary-or-prescribe-tool');
  }
  if (!updateLoopGuardsMethodText.includes('options.stageProgressChanged || madeDurableExecutionProgress')
    || !updateLoopGuardsMethodText.includes('result.output?.countsAsTaskProgress === false')
    || !updateLoopGuardsMethodText.includes("kind === 'stateful_context' && !isReadOnlyAgentContextTool(call.name)")
    || updateLoopGuardsMethodText.includes('if (anySuccessfulTool) {\n            this.unfinishedTurnContinuationAttempts = 0;')) {
    observationLivenessViolations.push('continuation:successful-read-can-reset-attempt-budget');
  }
  const retiredTextRecoveryTokens = [
    'applyExplicitMissingActionRecoveryDirective',
    'buildExplicitMissingActionRecovery',
    'explicit-required-action-recovery',
    'const needsExport ='
  ].filter((token) => agentRuntimeText.includes(token));
  if (retiredTextRecoveryTokens.length > 0) {
    observationLivenessViolations.push(
      `text-recovery:retired-owner-returned:${retiredTextRecoveryTokens.join(',')}`
    );
  }

  if (!detailManifest) {
    observationLivenessViolations.push('reobserve:detail-manifest-fixture-missing');
  } else {
    try {
      const reobservePlan = buildRuntimeStagePlan(detailManifest);
      const runtimeIdentity = createRuntimeSessionIdentity({
        now: '2026-08-11T00:00:00.000Z',
        nonce: 'observation-liveness-audit',
        skillId: reobservePlan.skillId,
        taskType: reobservePlan.taskType
      });
      const actionPlanDeclaration = {
        version: 'runtime-action-plan-declaration/v0',
        source: 'model_tool_call',
        readiness: 'ready',
        payload: {
          planGoal: '修改目标并验证结果',
          strategyRef: 'current:r3_design_strategy',
          contextRefs: ['current:r2_observation'],
          steps: [{
            stepId: 'mutate-target',
            kind: 'mutate',
            goal: '修改目标',
            dependsOn: [],
            capabilityRefs: ['photoshop.layer.transform'],
            inputContextRefs: ['current:r2_observation'],
            expectedOutcomes: ['document_change'],
            completionCriteria: ['目标发生可验证变化'],
            failurePolicy: 'replan'
          }],
          deliverableCoverage: [],
          missingInputs: []
        },
        missingCapabilityRefs: [],
        graph: {
          acyclic: true,
          rootStepIds: ['mutate-target'],
          terminalStepIds: ['mutate-target'],
          parallelGroups: []
        },
        boundaries: {
          modelAuthored: true,
          harnessValidatedOnly: true,
          strategyAligned: true,
          categoryNeutral: true,
          semanticDslOnly: true,
          resumeMappingModelAuthored: true,
          shadowOnly: true,
          executable: false,
          schedulerAuthority: false,
          autoActivatesCapabilities: false,
          executesTools: false,
          grantsPermission: false,
          countsAsTaskProgress: false,
          countsAsQualityPass: false
        }
      };
      const oldRevision = { documentId: 7, historyStateId: 11 };
      const newRevision = { documentId: 7, historyStateId: 12 };
      const pauseBoundaryRevision = { documentId: 457, historyStateId: 495 };
      const resolvedPauseBoundaryRevision = resolvePendingInteractiveContinuationPauseRevision({
        version: 'pending-interactive-continuation/v0',
        id: 'continuation-pause-revision-audit',
        createdAt: '2026-08-14T04:38:38.638Z',
        sourceTask: '帮我做SKU',
        scope: { photoshopDocumentId: 457 },
        scopeObservation: {
          version: 'pending-interactive-continuation-scope-observation/v0',
          observedAt: '2026-08-14T04:38:38.635Z',
          source: 'pause_boundary_get_document_info',
          photoshopDocumentState: 'present',
          photoshopDocumentId: 457,
          photoshopHistoryStateRef: pauseBoundaryRevision
        },
        operation: { kind: 'skill_execution', skillId: 'sku-batch', params: {} },
        card: { id: 'sku-combo-card-audit', kind: 'sku_combo_editor', payload: {} },
        oneTime: true
      });
      const mismatchedPauseBoundaryRevision = resolvePendingInteractiveContinuationPauseRevision({
        version: 'pending-interactive-continuation/v0',
        id: 'continuation-mismatched-pause-revision-audit',
        createdAt: '2026-08-14T04:38:38.638Z',
        sourceTask: '帮我做SKU',
        scope: { photoshopDocumentId: 457 },
        scopeObservation: {
          version: 'pending-interactive-continuation-scope-observation/v0',
          observedAt: '2026-08-14T04:38:38.635Z',
          source: 'pause_boundary_get_document_info',
          photoshopDocumentState: 'present',
          photoshopDocumentId: 458,
          photoshopHistoryStateRef: { documentId: 458, historyStateId: 495 }
        },
        operation: { kind: 'skill_execution', skillId: 'sku-batch', params: {} },
        card: { id: 'sku-combo-card-audit', kind: 'sku_combo_editor', payload: {} },
        oneTime: true
      });
      const pauseCard = {
        id: 'sku-combo-card-persisted-binding-audit',
        kind: 'sku_combo_editor',
        interactionOwner: { type: 'skill-provider', skillId: 'sku-batch' },
        decisionFingerprint: 'sku-combo-specification/v0',
        candidateFingerprint: 'sku-combo-candidate-persisted-binding-audit',
        payload: {}
      };
      const pauseSubmission = {
        version: 'interactive-card-submission/v0',
        cardId: pauseCard.id,
        kind: pauseCard.kind,
        submittedAt: '2026-08-14T04:39:22.893Z',
        value: {},
        validation: {
          valid: true,
          canSubmit: true,
          issues: [],
          blockers: [],
          warnings: []
        },
        decisionContext: {
          decisionFingerprint: pauseCard.decisionFingerprint,
          candidateFingerprint: pauseCard.candidateFingerprint,
          answerFingerprint: pauseCard.candidateFingerprint
        }
      };
      const persistedStaleBindingContinuation = {
        version: 'pending-interactive-continuation/v0',
        id: 'continuation-persisted-binding-audit',
        createdAt: '2026-08-14T04:38:38.638Z',
        sourceTask: '帮我做SKU',
        scope: { photoshopDocumentId: 457 },
        scopeObservation: {
          version: 'pending-interactive-continuation-scope-observation/v0',
          observedAt: '2026-08-14T04:38:38.635Z',
          source: 'pause_boundary_get_document_info',
          photoshopDocumentState: 'present',
          photoshopDocumentId: 457,
          photoshopHistoryStateRef: pauseBoundaryRevision
        },
        operation: { kind: 'skill_execution', skillId: 'sku-batch', params: {} },
        taskRunBinding: {
          version: 'runtime-task-run-interaction-binding/v0',
          taskRunId: 'runtime-persisted-binding-audit',
          runId: 'run-persisted-binding-audit',
          generation: 1,
          interactionId: 'continuation-persisted-binding-audit',
          planRevision: 0,
          expectedRevision: { documentId: 1465, historyStateId: 1510 },
          issuedAt: '2026-08-14T04:38:38.638Z',
          boundaries: {
            identityOnly: true,
            resumesExistingTaskRunOnly: true,
            grantsPermission: false,
            executesTools: false
          }
        },
        card: pauseCard,
        oneTime: true
      };
      const pauseRequest = {
        continuationId: persistedStaleBindingContinuation.id,
        cardId: pauseCard.id,
        sourceCardFingerprint: buildInteractiveIntegrityFingerprint(pauseCard),
        submissionFingerprint: buildInteractiveCardSubmissionFingerprint(pauseSubmission),
        sourceMessageId: 'message-persisted-binding-audit'
      };
      const legacyCollisionLeft = {
        version: 'sku-color-source/v1',
        stableSourceIdentity: 'qu88uye07t7o3dvuclh6v'
      };
      const legacyCollisionRight = {
        version: 'sku-color-source/v1',
        stableSourceIdentity: 'oxts63ez4pa6q54arvq1jm'
      };
      const rejectedLegacySourceFingerprint = resolveInteractiveContinuationOperationRequest({
        continuation: persistedStaleBindingContinuation,
        submission: pauseSubmission,
        request: {
          ...pauseRequest,
          sourceCardFingerprint: stableInteractiveCardHash(pauseCard)
        }
      });
      const rejectedLegacySubmissionFingerprint = resolveInteractiveContinuationOperationRequest({
        continuation: persistedStaleBindingContinuation,
        submission: pauseSubmission,
        request: {
          ...pauseRequest,
          submissionFingerprint: stableInteractiveCardHash(pauseSubmission)
        }
      });
      const oldBranchContinuation = {
        ...persistedStaleBindingContinuation,
        id: 'continuation-old-conversation-branch-audit',
        scope: {
          ...persistedStaleBindingContinuation.scope,
          conversationId: 'conversation-branch-audit',
          conversationBranchId: 'branch-before-edit-audit'
        }
      };
      const oldBranchRequest = {
        ...pauseRequest,
        continuationId: oldBranchContinuation.id
      };
      const rejectedOldConversationBranch = resolveInteractiveContinuationOperationRequest({
        continuation: oldBranchContinuation,
        submission: pauseSubmission,
        request: oldBranchRequest,
        conversationId: 'conversation-branch-audit',
        conversationBranchId: 'branch-after-edit-audit',
        photoshopDocumentId: 457,
        photoshopHistoryStateRef: pauseBoundaryRevision
      });
      const resumedPersistedBinding = resolveInteractiveContinuationOperationRequest({
        continuation: persistedStaleBindingContinuation,
        submission: pauseSubmission,
        request: pauseRequest,
        photoshopDocumentId: 457,
        photoshopHistoryStateRef: pauseBoundaryRevision
      });
      const rejectedRealDrift = resolveInteractiveContinuationOperationRequest({
        continuation: persistedStaleBindingContinuation,
        submission: pauseSubmission,
        request: pauseRequest,
        photoshopDocumentId: 457,
        photoshopHistoryStateRef: { documentId: 457, historyStateId: 496 }
      });
      const rejectedMissingLiveRevision = resolveInteractiveContinuationOperationRequest({
        continuation: persistedStaleBindingContinuation,
        submission: pauseSubmission,
        request: pauseRequest,
        photoshopDocumentId: 457,
        photoshopHistoryStateRef: undefined
      });
      const runtimeOwnedDrift = resolveInteractiveContinuationOperationRequest({
        continuation: persistedStaleBindingContinuation,
        submission: pauseSubmission,
        request: pauseRequest,
        photoshopDocumentId: 999,
        photoshopHistoryStateRef: { documentId: 999, historyStateId: 1 },
        photoshopStateOwner: 'runtime_session'
      });
      const missingPauseRevisionContinuation = {
        ...persistedStaleBindingContinuation,
        id: 'continuation-missing-pause-revision-audit',
        scopeObservation: {
          ...persistedStaleBindingContinuation.scopeObservation,
          photoshopHistoryStateRef: undefined
        }
      };
      const missingPauseRevisionRequest = {
        ...pauseRequest,
        continuationId: missingPauseRevisionContinuation.id
      };
      const rejectedMissingPauseRevision = resolveInteractiveContinuationOperationRequest({
        continuation: missingPauseRevisionContinuation,
        submission: pauseSubmission,
        request: missingPauseRevisionRequest,
        photoshopDocumentId: 457,
        photoshopHistoryStateRef: pauseBoundaryRevision
      });
      const unknownPauseObservationContinuation = {
        ...persistedStaleBindingContinuation,
        id: 'continuation-unknown-pause-observation-audit',
        scope: {},
        scopeObservation: {
          version: 'pending-interactive-continuation-scope-observation/v0',
          observedAt: '2026-08-14T04:38:38.635Z',
          source: 'pause_boundary_get_document_info',
          photoshopDocumentState: 'unknown'
        },
        taskRunBinding: undefined
      };
      const unknownPauseObservationRequest = {
        ...pauseRequest,
        continuationId: unknownPauseObservationContinuation.id
      };
      const rejectedUnknownPauseObservation = resolveInteractiveContinuationOperationRequest({
        continuation: unknownPauseObservationContinuation,
        submission: pauseSubmission,
        request: unknownPauseObservationRequest
      });
      const absentPauseObservationContinuation = {
        ...unknownPauseObservationContinuation,
        id: 'continuation-absent-pause-observation-audit',
        scopeObservation: {
          ...unknownPauseObservationContinuation.scopeObservation,
          photoshopDocumentState: 'absent'
        }
      };
      const absentPauseObservationRequest = {
        ...pauseRequest,
        continuationId: absentPauseObservationContinuation.id
      };
      const rejectedAbsentPauseObservation = resolveInteractiveContinuationOperationRequest({
        continuation: absentPauseObservationContinuation,
        submission: pauseSubmission,
        request: absentPauseObservationRequest
      });
      const pauseOnlyContinuation = {
        ...persistedStaleBindingContinuation,
        id: 'continuation-pause-only-audit',
        taskRunBinding: undefined
      };
      const pauseOnlyRequest = {
        ...pauseRequest,
        continuationId: pauseOnlyContinuation.id
      };
      const rejectedPauseOnlyDrift = resolveInteractiveContinuationOperationRequest({
        continuation: pauseOnlyContinuation,
        submission: pauseSubmission,
        request: pauseOnlyRequest,
        photoshopDocumentId: 457,
        photoshopHistoryStateRef: { documentId: 457, historyStateId: 496 }
      });
      const pauseIdentity = createRuntimeSessionIdentity({
        now: '2026-08-14T04:36:34.539Z',
        nonce: 'interactive-pause-revision-audit',
        skillId: reobservePlan.skillId,
        taskType: reobservePlan.taskType
      });
      let pauseSession = createRuntimeSession({ identity: pauseIdentity, plan: reobservePlan });
      pauseSession = observeRuntimeSessionDocumentRevision({
        session: pauseSession,
        revision: { documentId: 1465, historyStateId: 1510 }
      });
      const paused = suspendRuntimeSessionForInteraction({
        session: pauseSession,
        interactionId: 'continuation-pause-revision-audit',
        expectedRevision: resolvedPauseBoundaryRevision
      });
      if (resolvedPauseBoundaryRevision?.documentId !== 457
        || resolvedPauseBoundaryRevision.historyStateId !== 495
        || mismatchedPauseBoundaryRevision !== undefined
        || paused.binding.expectedRevision?.documentId !== 457
        || paused.binding.expectedRevision?.historyStateId !== 495
        || paused.session.taskRun.documentBinding?.documentId !== 457
        || paused.session.taskRun.documentBinding?.expectedRevision.historyStateId !== 495
        || paused.session.taskRun.status !== 'waiting_user'
        || resumedPersistedBinding.status !== 'accepted'
        || resumedPersistedBinding.taskRunBinding?.expectedRevision?.documentId !== 457
        || resumedPersistedBinding.taskRunBinding?.expectedRevision?.historyStateId !== 495
        || rejectedRealDrift.status !== 'rejected'
        || rejectedRealDrift.code !== 'interactive_continuation_photoshop_revision_mismatch'
         || rejectedMissingLiveRevision.status !== 'rejected'
         || rejectedMissingLiveRevision.code !== 'interactive_continuation_photoshop_revision_mismatch'
         || runtimeOwnedDrift.status !== 'accepted'
        || rejectedMissingPauseRevision.status !== 'rejected'
        || rejectedMissingPauseRevision.code !== 'interactive_continuation_photoshop_revision_unavailable'
        || rejectedUnknownPauseObservation.status !== 'rejected'
        || rejectedUnknownPauseObservation.code !== 'interactive_continuation_photoshop_revision_unavailable'
        || rejectedAbsentPauseObservation.status !== 'rejected'
        || rejectedAbsentPauseObservation.code !== 'interactive_continuation_photoshop_revision_unavailable'
        || rejectedPauseOnlyDrift.status !== 'rejected'
        || rejectedPauseOnlyDrift.code !== 'interactive_continuation_photoshop_revision_mismatch'
        || rejectedOldConversationBranch.status !== 'rejected'
        || rejectedOldConversationBranch.code !== 'interactive_continuation_conversation_branch_mismatch') {
        observationLivenessViolations.push('interactive-continuation:pause-boundary-revision-not-authoritative');
      }
      if (stableInteractiveCardHash(legacyCollisionLeft) !== stableInteractiveCardHash(legacyCollisionRight)
        || buildInteractiveIntegrityFingerprint(legacyCollisionLeft)
          === buildInteractiveIntegrityFingerprint(legacyCollisionRight)
        || rejectedLegacySourceFingerprint.status !== 'rejected'
        || rejectedLegacySourceFingerprint.code
          !== 'interactive_continuation_source_card_fingerprint_version_unsupported'
        || rejectedLegacySubmissionFingerprint.status !== 'rejected'
        || rejectedLegacySubmissionFingerprint.code
          !== 'interactive_continuation_submission_fingerprint_version_unsupported') {
        observationLivenessViolations.push(
          'interactive-continuation:legacy-32-bit-integrity-still-authoritative'
        );
      }
      if (/stableInteractiveCardHash/.test(pendingInteractiveContinuationText)
        || /stableInteractiveCardHash/.test(interactiveContinuationOperationText)
        || /stableInteractiveCardHash/.test(agentRuntimeText)
        || /stableInteractiveCardHash/.test(chatPanelText)) {
        observationLivenessViolations.push(
          'interactive-continuation:execution-binding-still-uses-fast-ui-hash'
        );
      }
      if (!agentRuntimeText.includes('resolvePendingInteractiveContinuationPauseRevision(')
        || !agentRuntimeText.includes('pendingInteractiveContinuation.scopeObservation')
        || !agentRuntimeText.includes('pauseRevision || legacyRuntimeRevision')
        || !agentRuntimeText.includes('inheritSessionExpectedRevision: false')) {
        observationLivenessViolations.push('interactive-continuation:agent-still-suspends-with-stale-opening-revision');
      }
      if (!pendingInteractiveContinuationText.includes('...(pauseRevision ? { expectedRevision: pauseRevision } : {})')
        || !pendingInteractiveContinuationText.includes('const taskRunBinding = resolution.taskRunBinding;')
        || !pendingInteractiveContinuationText.includes("photoshopStateOwner?: 'continuation_envelope' | 'runtime_session'")) {
        observationLivenessViolations.push('interactive-continuation:persisted-stale-binding-not-normalized-on-resume');
      }
      let reobserveSession = createRuntimeSession({ identity: runtimeIdentity, plan: reobservePlan });
      reobserveSession = observeRuntimeSessionDocumentRevision({
        session: reobserveSession,
        revision: oldRevision,
        now: '2026-08-11T00:00:01.000Z'
      });
      reobserveSession = bindRuntimeSessionActionPlan({
        session: reobserveSession,
        declaration: actionPlanDeclaration
      });
      const oldPlanRevision = reobserveSession.taskRun.planRevision;
      reobserveSession = {
        ...reobserveSession,
        stageState: { ...reobserveSession.stageState, status: 'active', currentStage: 'E1' }
      };
      reobserveSession = reconcileRuntimeSessionDocumentRevision({
        session: reobserveSession,
        plan: reobservePlan,
        revision: newRevision,
        now: '2026-08-11T00:00:02.000Z'
      });
      if (reobserveSession.taskRun.status !== 'needs_reobserve'
        || reobserveSession.taskRun.documentBinding?.conflict?.observedRevision?.historyStateId !== 12) {
        observationLivenessViolations.push('reobserve:revision-change-not-recorded');
      }
      if (reobserveSession.stageState.currentStage !== 'R2'
        || reobserveSession.taskRun.status !== 'needs_reobserve') {
        observationLivenessViolations.push('reobserve:old-plan-not-returned-to-observation-owner');
      }
      const r2Snapshot = reobserveSession.stageState.stages.find((stage) => stage.stage === 'R2');
      let secondDriftSession = {
        ...reobserveSession,
        stageState: applyRuntimeStageEvaluation({
          plan: reobservePlan,
          state: reobserveSession.stageState,
          event: {
            stage: 'R2',
            outcome: 'passed',
            observedOutcomes: r2Snapshot?.requiredOutcomes || [],
            reason: '正式审计：revision 12 已完成 R2 观察。'
          }
        })
      };
      const revisionThirteen = { documentId: 7, historyStateId: 13 };
      secondDriftSession = reconcileRuntimeSessionDocumentRevision({
        session: secondDriftSession,
        plan: reobservePlan,
        revision: revisionThirteen,
        now: '2026-08-11T00:00:02.500Z'
      });
      if (secondDriftSession.stageState.currentStage !== 'R2'
        || secondDriftSession.taskRun.documentBinding?.conflict?.observedRevision?.historyStateId !== 13) {
        observationLivenessViolations.push('reobserve:second-revision-drift-did-not-invalidate-old-r2');
      }
      const secondDriftTransitionCount = secondDriftSession.stageState.transitions.length;
      const sameRevisionSession = reconcileRuntimeSessionDocumentRevision({
        session: secondDriftSession,
        plan: reobservePlan,
        revision: revisionThirteen,
        now: '2026-08-11T00:00:02.600Z'
      });
      if (sameRevisionSession.stageState.transitions.length !== secondDriftTransitionCount) {
        observationLivenessViolations.push('reobserve:same-revision-reentered-stage-again');
      }
      const prematurePlanBind = bindRuntimeSessionActionPlan({
        session: reobserveSession,
        declaration: actionPlanDeclaration
      });
      if (prematurePlanBind.taskRun.documentBinding?.status !== 'needs_reobserve'
        || prematurePlanBind.taskRun.documentBinding?.expectedRevision.historyStateId !== 11) {
        observationLivenessViolations.push('reobserve:non-r4-plan-accepted-new-revision');
      }
      reobserveSession = {
        ...reobserveSession,
        stageState: { ...reobserveSession.stageState, status: 'active', currentStage: 'R4' }
      };
      let reboundSession = bindRuntimeSessionActionPlan({
        session: reobserveSession,
        declaration: actionPlanDeclaration
      });
      if (reboundSession.taskRun.status !== 'active'
        || reboundSession.taskRun.planRevision !== oldPlanRevision + 1
        || reboundSession.taskRun.documentBinding?.status !== 'observed'
        || reboundSession.taskRun.documentBinding?.expectedRevision.historyStateId !== 12
        || reboundSession.taskRun.documentBinding?.conflict) {
        observationLivenessViolations.push('reobserve:new-plan-did-not-bind-observed-revision');
      }
      reboundSession = {
        ...reboundSession,
        stageState: { ...reboundSession.stageState, status: 'active', currentStage: 'E1' }
      };
      reboundSession = synchronizeRuntimeSessionActionPlanNodes({
        session: reboundSession,
        steps: [{ stepId: 'mutate-target', status: 'ready' }]
      });
      const executionRefBase = {
        envelopeId: 'envelope-observation-audit',
        packVersion: 'runtime-action-execution-pack/v0',
        packId: 'pack-observation-audit',
        capabilityRef: 'photoshop.layer.transform',
        providerName: 'transformLayer',
        providerCallId: 'provider-call-observation-audit',
        argumentFingerprint: 'argument-fingerprint-observation-audit',
        planRevision: reboundSession.taskRun.planRevision,
        compiledAt: '2026-08-11T00:00:03.000Z'
      };
      const oldRevisionStart = beginRuntimeSessionNodeExecution({
        session: reboundSession,
        nodeId: 'mutate-target',
        planRevision: reboundSession.taskRun.planRevision,
        planFingerprint: reboundSession.taskRun.planFingerprint,
        expectedRevision: oldRevision,
        executionRef: { ...executionRefBase, target: oldRevision }
      });
      if (oldRevisionStart.decision.allowed
        || oldRevisionStart.decision.code !== 'runtime_task_run_node_revision_mismatch') {
        observationLivenessViolations.push('reobserve:old-revision-write-replayed');
      }
      const newRevisionStart = beginRuntimeSessionNodeExecution({
        session: reboundSession,
        nodeId: 'mutate-target',
        planRevision: reboundSession.taskRun.planRevision,
        planFingerprint: reboundSession.taskRun.planFingerprint,
        expectedRevision: newRevision,
        executionRef: { ...executionRefBase, target: newRevision }
      });
      if (!newRevisionStart.decision.allowed) {
        observationLivenessViolations.push(
          `reobserve:new-revision-write-not-reenabled:${newRevisionStart.decision.code || 'unknown'}`
        );
      }
      releaseRuntimeTaskRunWriterBinding({
        taskRunId: reboundSession.taskRun.taskRunId,
        runId: reboundSession.identity.runId,
        generation: reboundSession.identity.generation
      });
    } catch (error) {
      observationLivenessViolations.push(`reobserve:fixture-failed:${compact(error?.message || error)}`);
    }
  }
  const workflowReobserveManifestIds = new Set([
    'ecommerce.sku_batch',
    'ecommerce.sku_color_card'
  ]);
  const workflowReobserveManifests = manifests.filter((manifest) => (
    workflowReobserveManifestIds.has(manifest.skill_id)
  ));
  if (workflowReobserveManifests.length !== workflowReobserveManifestIds.size) {
    observationLivenessViolations.push('reobserve:sku-workflow-manifest-fixture-missing');
  }
  for (const manifest of workflowReobserveManifests) {
    try {
      const workflowPlan = buildRuntimeStagePlan(manifest);
      const workflowIdentity = createRuntimeSessionIdentity({
        now: '2026-08-11T01:00:00.000Z',
        nonce: `workflow-reobserve-${manifest.skill_id}`,
        skillId: workflowPlan.skillId,
        taskType: workflowPlan.taskType
      });
      const oldRevision = { documentId: 21, historyStateId: 31 };
      const newRevision = { documentId: 21, historyStateId: 32 };
      let workflowSession = createRuntimeSession({
        identity: workflowIdentity,
        plan: workflowPlan
      });
      workflowSession = observeRuntimeSessionDocumentRevision({
        session: workflowSession,
        revision: oldRevision,
        now: '2026-08-11T01:00:01.000Z'
      });
      const initialR2 = workflowSession.stageState.stages.find((stage) => stage.stage === 'R2');
      workflowSession = {
        ...workflowSession,
        stageState: applyRuntimeStageEvaluation({
          plan: workflowPlan,
          state: workflowSession.stageState,
          event: {
            stage: 'R2',
            outcome: 'passed',
            observedOutcomes: initialR2?.requiredOutcomes || [],
            reason: '正式审计：SKU 初始 R2 观察通过。'
          }
        })
      };
      workflowSession = reconcileRuntimeSessionDocumentRevision({
        session: workflowSession,
        plan: workflowPlan,
        revision: newRevision,
        now: '2026-08-11T01:00:02.000Z'
      });
      const blockedBeforeAcknowledgement = evaluateRuntimeSessionToolExecutionGate({
        session: workflowSession,
        toolName: 'sku-batch',
        toolKind: 'photoshop_write'
      });
      if (workflowSession.stageState.currentStage !== 'R2'
        || workflowSession.taskRun.status !== 'needs_reobserve'
        || blockedBeforeAcknowledgement.allowed
        || blockedBeforeAcknowledgement.code !== 'runtime_task_run_revision_reobserve_required') {
        observationLivenessViolations.push(
          `reobserve:${manifest.skill_id}:workflow-change-not-blocked-at-r2`
        );
      }
      const staleAcknowledgement = acknowledgeRuntimeSessionWorkflowDocumentReobservation({
        session: workflowSession,
        plan: workflowPlan,
        observedRevision: oldRevision
      });
      if (staleAcknowledgement.taskRun.status !== 'needs_reobserve') {
        observationLivenessViolations.push(
          `reobserve:${manifest.skill_id}:stale-workflow-revision-acknowledged`
        );
      }
      let returnedRevisionSession = reconcileRuntimeSessionDocumentRevision({
        session: workflowSession,
        plan: workflowPlan,
        revision: oldRevision,
        now: '2026-08-11T01:00:02.500Z'
      });
      if (returnedRevisionSession.taskRun.status !== 'needs_reobserve'
        || returnedRevisionSession.stageState.currentStage !== 'R2'
        || returnedRevisionSession.taskRun.documentBinding?.conflict?.observedRevision?.historyStateId !== 31) {
        observationLivenessViolations.push(
          `reobserve:${manifest.skill_id}:return-to-expected-revision-not-recorded`
        );
      }
      const staleNewRevisionAcknowledgement = acknowledgeRuntimeSessionWorkflowDocumentReobservation({
        session: returnedRevisionSession,
        plan: workflowPlan,
        observedRevision: newRevision
      });
      if (staleNewRevisionAcknowledgement.taskRun.status !== 'needs_reobserve') {
        observationLivenessViolations.push(
          `reobserve:${manifest.skill_id}:superseded-conflict-revision-acknowledged`
        );
      }
      returnedRevisionSession = acknowledgeRuntimeSessionWorkflowDocumentReobservation({
        session: returnedRevisionSession,
        plan: workflowPlan,
        observedRevision: oldRevision
      });
      const returnedRevisionR2 = returnedRevisionSession.stageState.stages.find(
        (stage) => stage.stage === 'R2'
      );
      returnedRevisionSession = {
        ...returnedRevisionSession,
        stageState: applyRuntimeStageEvaluation({
          plan: workflowPlan,
          state: returnedRevisionSession.stageState,
          event: {
            stage: 'R2',
            outcome: 'passed',
            observedOutcomes: returnedRevisionR2?.requiredOutcomes || [],
            reason: '正式审计：真实现场回到 expected revision 后重新完成 R2。'
          }
        })
      };
      const returnedRevisionGate = evaluateRuntimeSessionToolExecutionGate({
        session: returnedRevisionSession,
        toolName: 'sku-batch',
        toolKind: 'photoshop_write'
      });
      if (returnedRevisionSession.taskRun.documentBinding?.expectedRevision.historyStateId !== 31
        || returnedRevisionSession.taskRun.documentBinding?.status !== 'observed'
        || returnedRevisionSession.stageState.currentStage !== 'E1'
        || !returnedRevisionGate.allowed) {
        observationLivenessViolations.push(
          `reobserve:${manifest.skill_id}:return-to-expected-revision-not-reenabled`
        );
      }
      workflowSession = acknowledgeRuntimeSessionWorkflowDocumentReobservation({
        session: workflowSession,
        plan: workflowPlan,
        observedRevision: newRevision
      });
      const reobservedR2 = workflowSession.stageState.stages.find((stage) => stage.stage === 'R2');
      workflowSession = {
        ...workflowSession,
        stageState: applyRuntimeStageEvaluation({
          plan: workflowPlan,
          state: workflowSession.stageState,
          event: {
            stage: 'R2',
            outcome: 'passed',
            observedOutcomes: reobservedR2?.requiredOutcomes || [],
            reason: '正式审计：SKU 新 revision R2 观察通过。'
          }
        })
      };
      const allowedAfterAcknowledgement = evaluateRuntimeSessionToolExecutionGate({
        session: workflowSession,
        toolName: 'sku-batch',
        toolKind: 'photoshop_write'
      });
      if (workflowSession.stageState.currentStage !== 'E1'
        || workflowSession.taskRun.status !== 'active'
        || workflowSession.taskRun.documentBinding?.status !== 'observed'
        || workflowSession.taskRun.documentBinding?.expectedRevision.historyStateId !== 32
        || !allowedAfterAcknowledgement.allowed) {
        observationLivenessViolations.push(
          `reobserve:${manifest.skill_id}:workflow-revision-not-reenabled`
        );
      }
      releaseRuntimeTaskRunWriterBinding({
        taskRunId: workflowSession.taskRun.taskRunId,
        runId: workflowSession.identity.runId,
        generation: workflowSession.identity.generation
      });
    } catch (error) {
      observationLivenessViolations.push(
        `reobserve:sku-workflow-fixture-failed:${manifest.skill_id}:${compact(error?.message || error)}`
      );
    }
  }
  const mainImageMethodContext = buildDesignMethodKnowledgeRuntimeContext({
    knowledgeRefs: mainImageManifest?.knowledge_refs || [],
    manifestSkillId: mainImageManifest?.skill_id || ''
  });
  const mainImageR0Knowledge = compileRuntimeContext({ items: mainImageMethodContext.items, stage: 'R0' });
  const mainImageR3Knowledge = compileRuntimeContext({ items: mainImageMethodContext.items, stage: 'R3' });
  const mainImageR4Knowledge = compileRuntimeContext({ items: mainImageMethodContext.items, stage: 'R4' });
  const structuredMainImageKnowledge = buildDesignArtifactKnowledgeRuntimeItem({
    taskTypeId: 'ecommerce.main_image.v1'
  });
  const singleCanvasPosterKnowledge = buildDesignArtifactKnowledgeRuntimeItem({
    taskTypeId: 'design.single_canvas_visual.v1',
    requestedArtifactId: 'poster'
  });
  const singleCanvasInvalidKnowledge = buildDesignArtifactKnowledgeRuntimeItem({
    taskTypeId: 'design.single_canvas_visual.v1',
    requestedArtifactId: 'detail-page'
  });
  const photoshopCraftRecipes = listPhotoshopCraftRecipes();
  const generalPhotoshopCraftRecipes = listGeneralPhotoshopCraftRecipes();
  const ordinaryNaturalLanguageCraftRecipeItems = buildPhotoshopCraftRecipeRuntimeItems({});
  const ordinaryCraftPhrasingVariants = [
    '把图片里原来的字换成新文案',
    '这段字已经和图片合并了，帮我改一下',
    '图上那行不能直接编辑的文字替换掉',
    '旧字是像素，不是文字图层，重新合成新的可编辑文字'
  ].map(() => buildPhotoshopCraftRecipeRuntimeItems({ taskTypeId: '   ' }));
  const flattenedRasterTextRecipe = photoshopCraftRecipes.find((recipe) => (
    recipe.recipeId === 'photoshop-craft.flattened-raster-text-replacement'
  ));
  const subjectFitPlan = computeSubjectFitToRegion({
    subjectBounds: { left: 100, top: 100, right: 300, bottom: 500 },
    layerBounds: { left: 0, top: 0, right: 400, bottom: 600 },
    targetRegion: { x: 0, y: 0, width: 1000, height: 1000 },
    subjectFillRatio: 0.7,
    anchor: 'top-center',
    visualBiasY: 0
  });
  const subjectFitVerification = subjectFitPlan.ok
    ? verifySubjectFitResult({
        actualSubjectBounds: subjectFitPlan.projectedSubject,
        targetRegion: { x: 0, y: 0, width: 1000, height: 1000 },
        requestedFillRatio: subjectFitPlan.resolved.subjectFillRatio,
        anchor: subjectFitPlan.resolved.anchor,
        visualBiasY: subjectFitPlan.resolved.visualBiasY,
        projectedSubject: subjectFitPlan.projectedSubject
      })
    : undefined;
  const shiftedSubjectFitVerification = subjectFitPlan.ok
    ? verifySubjectFitResult({
        actualSubjectBounds: {
          left: subjectFitPlan.projectedSubject.left + 100,
          top: subjectFitPlan.projectedSubject.top,
          right: subjectFitPlan.projectedSubject.right + 100,
          bottom: subjectFitPlan.projectedSubject.bottom
        },
        targetRegion: { x: 0, y: 0, width: 1000, height: 1000 },
        requestedFillRatio: subjectFitPlan.resolved.subjectFillRatio,
        anchor: subjectFitPlan.resolved.anchor,
        visualBiasY: subjectFitPlan.resolved.visualBiasY,
        projectedSubject: subjectFitPlan.projectedSubject
      })
    : undefined;
  const mainImageCraftRecipeItems = buildPhotoshopCraftRecipeRuntimeItems({
    taskTypeId: 'ecommerce.main_image.v1'
  });
  const mainImageR3CraftRecipes = compileRuntimeContext({
    items: mainImageCraftRecipeItems,
    stage: 'R3'
  });
  const mainImageR4CraftRecipes = compileRuntimeContext({
    items: mainImageCraftRecipeItems,
    stage: 'R4'
  });
  const mainImageR5CraftRecipes = compileRuntimeContext({
    items: mainImageCraftRecipeItems,
    stage: 'R5'
  });
  const skuBatchCraftRecipeItems = buildPhotoshopCraftRecipeRuntimeItems({
    taskTypeId: 'ecommerce.sku_batch.v1'
  });
  const photoshopCraftRecipeSearch = searchLocalDesignKnowledge({
    query: '可编辑单画布 Photoshop 工艺',
    intents: ['recipe'],
    sourceTypes: ['local_recipe'],
    limit: 8
  });
  const localRasterTextRecipeSearch = searchLocalDesignKnowledge({
    query: 'photoshop-craft.flattened-raster-text-replacement',
    intents: ['recipe'],
    sourceTypes: ['local_recipe'],
    limit: 1
  });
  const subjectAwarePlacementRecipeSearch = searchLocalDesignKnowledge({
    query: 'photoshop-craft.subject-aware-image-placement',
    intents: ['recipe'],
    sourceTypes: ['local_recipe'],
    limit: 1
  });
  const detailEditContract = detailManifest?.work_mode_contracts?.edit_existing;
  const detailCreateContract = detailManifest?.work_mode_contracts?.create_new;
  const missingPerformanceProfiles = manifests
    .filter((manifest) => !manifest.performance_profile)
    .map((manifest) => manifest.skill_id);
  const budgetLimitByKey = {
    max_model_calls: AGENT_GLOBAL_SKILL_BUDGET_LIMITS.maxModelCalls,
    max_tool_calls: AGENT_GLOBAL_SKILL_BUDGET_LIMITS.maxToolCalls,
    max_iterations: AGENT_GLOBAL_SKILL_BUDGET_LIMITS.maxIterations,
    max_vision_candidates: AGENT_GLOBAL_SKILL_BUDGET_LIMITS.maxVisionCandidates,
    max_visual_analyses: AGENT_GLOBAL_SKILL_BUDGET_LIMITS.maxVisualAnalyses,
    max_full_resolution_image_reads: AGENT_GLOBAL_SKILL_BUDGET_LIMITS.maxFullResolutionImageReads,
    soft_time_budget_ms: AGENT_GLOBAL_SKILL_BUDGET_LIMITS.softTimeBudgetMs
  };
  function validatePerformanceProfile(manifest, profile, scope) {
    if (!profile) return [];
    const problems = [];
    if (profile.version !== 'skill-runtime-performance-profile/v0') {
      problems.push('version');
    }
    if (profile.budget.max_full_resolution_image_reads !== 0) {
      problems.push('full-resolution-read-grant');
    }
    for (const [key, value] of Object.entries(profile.budget)) {
      if (!Number.isFinite(value) || value < 0) problems.push(`invalid-budget:${key}`);
    }
    for (const [key, limit] of Object.entries(budgetLimitByKey)) {
      if (profile.budget[key] > limit) problems.push(`exceeds-agent-global-cap:${key}`);
    }
    if (profile.vision_policy === 'disabled' && (
      profile.budget.max_vision_candidates !== 0
      || profile.budget.max_visual_analyses !== 0
      || [...(manifest.required_model_profiles || []), ...(manifest.optional_model_profiles || [])]
        .some((modelProfile) => modelProfile.startsWith('vision.'))
    )) {
      problems.push('disabled-vision-profile-is-inconsistent');
    }
    if (profile.vision_policy === 'disabled'
      && (manifest.available_tools || []).includes('photoshop.read.getVisualSnapshot')) {
      problems.push('disabled-vision-profile-exposes-visual-capability');
    }
    return problems.map((problem) => `${manifest.skill_id}${scope}:${problem}`);
  }
  const invalidPerformanceProfiles = manifests.flatMap((manifest) => (
    validatePerformanceProfile(manifest, manifest.performance_profile, '')
  ));
  const invalidWorkModePerformanceProfiles = manifests.flatMap((manifest) => {
    return Object.entries(manifest.work_mode_contracts || {}).flatMap(([workMode, contract]) => (
      validatePerformanceProfile(manifest, contract?.performance_profile, `#${workMode}`)
    ));
  });
  const sameIdentity = resolveSkillRuntimeManifestSelection({
    skillId: 'detail-page-design',
    taskType: 'ecommerce.detail_page.v1'
  });
  const composedIdentity = resolveSkillRuntimeManifestSelection({
    skillId: 'layout-replication',
    taskType: 'ecommerce.detail_page.v1'
  });
  const conflictingIdentity = resolveSkillRuntimeManifestSelection({
    skillId: 'main-image-design',
    taskType: 'ecommerce.detail_page.v1'
  });
  const unknownIdentity = resolveSkillRuntimeManifestSelection({
    skillId: 'main-image-design',
    taskType: 'design.unknown.v1'
  });
  const transitionalDebt = TRANSITIONAL_BUSINESS_REFERENCE_BASELINES.map(({ file, baseline }) => {
    const businessReferenceCount = countBusinessReferences(path.join(root, file));
    return {
      file,
      baseline,
      businessReferenceCount,
      status: businessReferenceCount <= baseline ? 'not_grown' : 'grown',
      policy: 'compatibility-debt; do-not-expand; migrate to manifest/provider'
    };
  });

  const successfulOperation = (name, args, result = {}) => {
    const photoshopWrite = classifyAgentToolExecution(name, args) === 'photoshop_write';
    return {
      name,
      arguments: args,
      result: {
        success: true,
        activeDocumentId: 41,
        historyStateRef: { documentId: 41, historyStateId: 102 },
        ...(photoshopWrite
          ? {
              photoshopMutationCommit: {
                version: 'photoshop-mutation-commit/v1',
                basis: 'same_execute_as_modal',
                bindingStrength: 'document_revision',
                before: { documentId: 41, historyStateId: 101, activeLayerId: 7 },
                after: { documentId: 41, historyStateId: 102, activeLayerId: 7 },
                toolActionCompleted: true,
                mutationObserved: true,
                documentChanged: false
              }
            }
          : {}),
        ...result
      }
    };
  };
  const currentDocumentRead = successfulOperation(
    'getDocumentInfo',
    { documentId: 41 },
    {
      documentId: 41,
      activeDocumentName: '当前海报.psd',
      historyStateRef: { documentId: 41, historyStateId: 101 }
    }
  );
  const currentLayerReadback = successfulOperation(
    'getLayerHierarchy',
    { documentId: 41 },
    { documentId: 41 }
  );
  const buildCreativeCompletionCase = (task, mutations, context) => buildTaskCompletionContract({
    task,
    context,
    toolCallLog: [currentDocumentRead, ...mutations, currentLayerReadback]
  });
  const requirementById = (contract, id) => contract?.required.find((item) => item.id === id);

  const noTextTask = '做一张海报：极简白底产品画面，不要任何文字，直接在当前画布修改，不要新建文档。';
  const noTextContract = buildCreativeCompletionCase(noTextTask, [
    successfulOperation('setLayerFill', { documentId: 41, layerId: 7, color: '#FFFFFF' })
  ]);
  const verifiedNoTextContract = buildCreativeCompletionCase(noTextTask, [
    successfulOperation('setLayerFill', { documentId: 41, layerId: 7, color: '#FFFFFF' }),
    successfulOperation('getAllTextLayers', { documentId: 41 }, { textLayers: [] })
  ]);
  const noTextPolicy = buildDesignTaskContractRemediationDirective({
    task: noTextTask,
    toolCallLog: [
      currentDocumentRead,
      successfulOperation('setLayerFill', { documentId: 41, layerId: 7, color: '#FFFFFF' }),
      currentLayerReadback
    ]
  });
  const restoredNoTextContract = buildCreativeCompletionCase(noTextTask, [
    successfulOperation('createTextLayer', { documentId: 41, text: '误加标题' }, { layerId: 19 }),
    successfulOperation('setTextContent', { documentId: 41, layerId: 19, text: '' }),
    successfulOperation('getAllTextLayers', { documentId: 41 }, { textLayers: [] })
  ]);

  const typographyContract = buildCreativeCompletionCase(
    '做一张纯排版海报，只使用文字和留白，直接在当前画布完成，不要新建文档。',
    [successfulOperation('createTextLayer', {
      documentId: 41,
      text: '留白，也是一种表达'
    }), successfulOperation('getAllTextLayers', { documentId: 41 }, {
      textLayers: [{ kind: 'text', text: '留白，也是一种表达' }]
    })]
  );

  const editExistingTask = '设计一张海报，调整当前文档的配色和排版。';
  const editExistingPlan = {
    requestKind: 'autonomous_execution',
    designBrief: {
      goal: editExistingTask,
      workMode: 'edit_existing',
      deliverables: ['editable_design_document'],
      constraints: []
    },
    executionPlan: {
      mode: 'tool_execution',
      canExecuteTools: true,
      requiresUserApproval: false,
      steps: [],
      verificationTargets: ['same_document_readback']
    }
  };
  const editExistingContract = buildCreativeCompletionCase(
    editExistingTask,
    [successfulOperation('moveLayer', { documentId: 41, layerId: 7, x: 80, y: 120 })],
    { agentTaskPlan: editExistingPlan }
  );
  const placeholderFinding = {
    code: 'main_image_placeholder_unresolved',
    severity: 'repair',
    closureKind: 'mutation',
    blockId: '主视觉',
    role: 'main-image',
    layerId: 808,
    recommendedAction: {
      toolName: 'replaceImagePlaceholder',
      params: { placeholderLayerId: 808 }
    }
  };
  function successfulOperationInDocument(
    name,
    args,
    documentId,
    beforeHistoryStateId,
    afterHistoryStateId,
    result = {}
  ) {
    const photoshopWrite = classifyAgentToolExecution(name, args) === 'photoshop_write';
    return {
      name,
      arguments: { ...args, documentId },
      result: {
        success: true,
        activeDocumentId: documentId,
        historyStateRef: { documentId, historyStateId: afterHistoryStateId },
        ...(photoshopWrite
          ? {
              photoshopMutationCommit: {
                version: 'photoshop-mutation-commit/v1',
                basis: 'same_execute_as_modal',
                bindingStrength: 'document_revision',
                before: { documentId, historyStateId: beforeHistoryStateId, activeLayerId: 7 },
                after: { documentId, historyStateId: afterHistoryStateId, activeLayerId: 7 },
                toolActionCompleted: true,
                mutationObserved: true,
                documentChanged: false
              }
            }
          : {}),
        ...result
      }
    };
  }
  function buildLegacyPlaceholderReviewSnapshot(
    status,
    documentId = 41,
    historyStateId = 102,
    keySuffix = '',
    region,
    summaryOverride,
    comparisonReason
  ) {
    const snapshot = successfulOperationInDocument(
      'getCanvasSnapshot',
      region ? { region } : {},
      documentId,
      historyStateId,
      historyStateId
    );
    const observationKey = `audit-placeholder-review-${status || 'unknown'}-${documentId}-${keySuffix}`;
    writeAgentVisualObservationReceipt(snapshot.result, {
      version: 'visual-observation-receipt/v1',
      document: String(documentId),
      history: String(historyStateId),
      sourceTool: 'getCanvasSnapshot'
    });
    writeAgentVisualObservation(snapshot.result, {
      status: 'observed_by_visual_expert',
      reviewed: Boolean(status),
      observer: 'visual_expert',
      strategy: 'visual-expert',
      toolName: 'getCanvasSnapshot',
      observationKey,
      ...(status ? {
        reviewDecision: {
          version: 'visual-observation-review-decision/v1',
          observationKey,
          status,
          reviewer: comparisonReason ? 'primary_model' : 'visual_expert',
          summary: summaryOverride || (status === 'passed'
            ? '占位已精确替换，最终画面通过复核。'
            : (status === 'needs_fix'
              ? '占位已替换，但最终画面仍需修订。'
              : '最终画面无法读取。')),
          ...(comparisonReason ? { comparisonReason } : {}),
          ...(status === 'passed' ? {} : { issues: ['视觉复核未通过'] })
        }
      } : {})
    });
    return snapshot;
  }
  function buildLegacyPlaceholderClosureContract(reviewStatus) {
    return buildCreativeCompletionCase(editExistingTask, [
      successfulOperation('renderLayout', { documentId: 41 }, {
        qualityState: 'needs_repair',
        qualityFindings: [placeholderFinding]
      }),
      successfulOperation('replaceImagePlaceholder', {
        documentId: 41,
        placeholderLayerId: 808,
        imagePath: 'C:\\audit\\subject.png'
      }),
      buildLegacyPlaceholderReviewSnapshot(reviewStatus)
    ], { agentTaskPlan: editExistingPlan });
  }
  const legacyPlaceholderNeedsFixContract = buildLegacyPlaceholderClosureContract('needs_fix');
  const legacyPlaceholderUnreadableContract = buildLegacyPlaceholderClosureContract('unreadable');
  const legacyPlaceholderUnknownContract = buildLegacyPlaceholderClosureContract(undefined);
  const legacyPlaceholderPassedContract = buildLegacyPlaceholderClosureContract('passed');
  function buildStagedRenderLayout(
    stageId,
    qualityState,
    qualityFindings,
    documentId = 41,
    beforeHistoryStateId = 101,
    afterHistoryStateId = 102,
    screenRegion
  ) {
    const canvas = screenRegion ? { width: 1000, height: 2000 } : undefined;
    const normalizedScreenRegion = screenRegion
      ? { x: 0, y: screenRegion.y, width: canvas.width, height: screenRegion.height }
      : undefined;
    return successfulOperationInDocument(
      'renderLayout',
      {
        ...(stageId ? { stagePlan: { currentStage: { id: stageId } } } : {}),
        ...(screenRegion ? { canvas, screenRegion } : {})
      },
      documentId,
      beforeHistoryStateId,
      afterHistoryStateId,
      {
        qualityState,
        qualityFindings,
        ownerReceipt: {
          version: 'render-layout-owner/v1',
          stageId: stageId || undefined,
          screenRegion: normalizedScreenRegion
        }
      }
    );
  }
  const stageAUnresolvedStageBPassedContract = buildCreativeCompletionCase(editExistingTask, [
    buildStagedRenderLayout('stage-a', 'needs_repair', [placeholderFinding]),
    buildStagedRenderLayout('stage-b', 'passed', []),
    buildLegacyPlaceholderReviewSnapshot('passed', 41, 102, 'stage-b')
  ], { agentTaskPlan: editExistingPlan });
  const sameStageCleanRerenderContract = buildCreativeCompletionCase(editExistingTask, [
    buildStagedRenderLayout('stage-a', 'needs_repair', [placeholderFinding]),
    buildStagedRenderLayout('stage-a', 'passed', []),
    buildLegacyPlaceholderReviewSnapshot('passed', 41, 102, 'stage-a-rerender')
  ], { agentTaskPlan: editExistingPlan });
  const document42Read = successfulOperationInDocument(
    'getDocumentInfo',
    {},
    42,
    201,
    201,
    { documentId: 42, activeDocumentName: '审计文档-42.psd' }
  );
  const document42Readback = successfulOperationInDocument(
    'getLayerHierarchy',
    {},
    42,
    202,
    202,
    { documentId: 42 }
  );
  const differentDocumentPassedRenderContract = buildTaskCompletionContract({
    task: editExistingTask,
    context: { agentTaskPlan: editExistingPlan },
    toolCallLog: [
      currentDocumentRead,
      buildStagedRenderLayout('stage-a', 'needs_repair', [placeholderFinding]),
      document42Read,
      buildStagedRenderLayout('stage-a', 'passed', [], 42, 201, 202),
      buildLegacyPlaceholderReviewSnapshot('passed', 42, 202, 'other-document'),
      document42Readback
    ]
  });
  const topScreenRegion = { y: 0, height: 900 };
  const bottomScreenRegion = { y: 900, height: 900 };
  const topCoverage = { x: 0, y: 0, width: 1000, height: 900 };
  const bottomCoverage = { x: 0, y: 900, width: 1000, height: 900 };
  const crossOwnerReviewContract = buildTaskCompletionContract({
    task: editExistingTask,
    context: { agentTaskPlan: editExistingPlan },
    toolCallLog: [
      currentDocumentRead,
      buildStagedRenderLayout('stage-a', 'needs_repair', [placeholderFinding], 41, 101, 102, topScreenRegion),
      successfulOperationInDocument(
        'replaceImagePlaceholder',
        { placeholderLayerId: 808, imagePath: 'C:\\audit\\subject.png' },
        41,
        102,
        103
      ),
      buildStagedRenderLayout('stage-b', 'passed', [], 41, 103, 104, bottomScreenRegion),
      buildLegacyPlaceholderReviewSnapshot('passed', 41, 104, 'stage-b-only', bottomCoverage),
      successfulOperationInDocument('getLayerHierarchy', {}, 41, 104, 104, { documentId: 41 })
    ]
  });
  const latestRevisionReviewContract = buildTaskCompletionContract({
    task: editExistingTask,
    context: { agentTaskPlan: editExistingPlan },
    toolCallLog: [
      currentDocumentRead,
      buildStagedRenderLayout('stage-a', 'needs_repair', [placeholderFinding], 41, 101, 102, topScreenRegion),
      successfulOperationInDocument(
        'replaceImagePlaceholder',
        { placeholderLayerId: 808, imagePath: 'C:\\audit\\subject.png' },
        41,
        102,
        103
      ),
      buildLegacyPlaceholderReviewSnapshot('needs_fix', 41, 103, 'before-transform', topCoverage),
      successfulOperationInDocument(
        'transformLayer',
        { layerId: 909, x: 20, y: 30, width: 800, height: 700 },
        41,
        103,
        104
      ),
      buildLegacyPlaceholderReviewSnapshot('passed', 41, 104, 'after-transform', topCoverage),
      successfulOperationInDocument('getLayerHierarchy', {}, 41, 104, 104, { documentId: 41 })
    ]
  });
  const unscopedTopBottomContract = buildTaskCompletionContract({
    task: editExistingTask,
    context: { agentTaskPlan: editExistingPlan },
    toolCallLog: [
      currentDocumentRead,
      buildStagedRenderLayout('', 'needs_repair', [placeholderFinding], 41, 101, 102, topScreenRegion),
      buildStagedRenderLayout('', 'passed', [], 41, 102, 103, bottomScreenRegion),
      buildLegacyPlaceholderReviewSnapshot('passed', 41, 103, 'unscoped-bottom', bottomCoverage),
      successfulOperationInDocument('getLayerHierarchy', {}, 41, 103, 103, { documentId: 41 })
    ]
  });
  const unscopedRetiredDraftContract = buildTaskCompletionContract({
    task: editExistingTask,
    context: { agentTaskPlan: editExistingPlan },
    toolCallLog: [
      currentDocumentRead,
      successfulOperationInDocument('renderLayout', {}, 41, 101, 102, {
        qualityState: 'needs_repair',
        qualityFindings: [placeholderFinding],
        createdLayerIds: [808],
        ownerReceipt: { version: 'render-layout-owner/v1' }
      }),
      successfulOperationInDocument('renderLayout', {}, 41, 102, 103, {
        qualityState: 'passed',
        qualityFindings: [],
        createdLayerIds: [909],
        stageRefreshActions: [{
          action: 'deleteReusableDraftLayer',
          layerId: 808,
          success: true
        }],
        ownerReceipt: { version: 'render-layout-owner/v1' }
      }),
      buildLegacyPlaceholderReviewSnapshot('passed', 41, 103, 'unscoped-retired'),
      successfulOperationInDocument('getLayerHierarchy', {}, 41, 103, 103, { documentId: 41 })
    ]
  });
  const candidateComparisonFinding = {
    code: 'candidate_structural_reduction_not_compared',
    severity: 'review',
    closureKind: 'comparison',
    blockId: '纯商品主图',
    role: 'layout',
    message: '同素材另建候选由三个声明元素减少为一个；这是变化证据，不是更优证据。'
  };
  function buildNewComposeCandidate(
    documentId,
    documentName,
    before,
    afterHistoryStateId,
    qualityState,
    qualityFindings
  ) {
    return {
      name: 'composeDesign',
      arguments: {
        document: { mode: 'new', name: documentName },
        canvas: { width: 1440, height: 1440 },
        layout: { regions: [{ id: '主体·商品摄影', role: 'main-image', content: 'subject' }] }
      },
      result: {
        success: true,
        status: qualityState === 'passed' ? 'completed' : qualityState,
        qualityState,
        qualityFindings,
        documentId,
        historyStateRef: { documentId, historyStateId: afterHistoryStateId },
        createdLayerIds: [documentId * 10 + 1],
        photoshopHistoryTransition: {
          version: 'photoshop-history-transition/v1',
          basis: 'acceptance_snapshot_pair',
          before,
          after: { documentId, historyStateId: afterHistoryStateId },
          toolActionCompleted: true,
          mutationObserved: true,
          documentChanged: before.documentId !== documentId
        }
      }
    };
  }
  const composeCandidateA = buildNewComposeCandidate(
    301,
    '运动袜主图-A',
    { documentId: 41, historyStateId: 101 },
    10,
    'passed',
    []
  );
  const composeCandidateB = buildNewComposeCandidate(
    302,
    '运动袜主图-B',
    { documentId: 301, historyStateId: 10 },
    20,
    'needs_review',
    [candidateComparisonFinding]
  );
  const candidateBLayerReadback = successfulOperationInDocument(
    'getLayerHierarchy',
    {},
    302,
    20,
    20,
    { documentId: 302 }
  );
  const unresolvedComposeAlternativeContract = buildTaskCompletionContract({
    task: '用项目素材重新做一张商品主图。',
    toolCallLog: [currentDocumentRead, composeCandidateA, composeCandidateB, candidateBLayerReadback]
  });
  const genericReviewedComposeAlternativeContract = buildTaskCompletionContract({
    task: '用项目素材重新做一张商品主图。',
    toolCallLog: [
      currentDocumentRead,
      composeCandidateA,
      composeCandidateB,
      buildLegacyPlaceholderReviewSnapshot('passed', 302, 20, 'compose-generic-review'),
      candidateBLayerReadback
    ]
  });
  const reviewedComposeAlternativeContract = buildTaskCompletionContract({
    task: '用项目素材重新做一张商品主图。',
    toolCallLog: [
      currentDocumentRead,
      composeCandidateA,
      composeCandidateB,
      buildLegacyPlaceholderReviewSnapshot(
        'passed',
        302,
        20,
        'compose-comparison',
        undefined,
        '当前画面已完成同文档复核。',
        '前一候选的文字与主体争抢；当前候选减少文字后，商品成为唯一视觉焦点，更符合本次主图目标。'
      ),
      candidateBLayerReadback
    ]
  });
  const criticComposeAlternativeContract = buildTaskCompletionContract({
    task: '用项目素材重新做一张商品主图。',
    toolCallLog: [
      currentDocumentRead,
      composeCandidateA,
      composeCandidateB,
      successfulOperationInDocument('evaluateDesign', {}, 302, 20, 20, {
        evaluationAuthority: 'advisory_visual_critique',
        evaluation: { verdict: 'pass' }
      }),
      candidateBLayerReadback
    ]
  });

  const explicitCopyTask = '制作一张海报，必须包含标题“夏日上新”，直接在当前画布完成。';
  const missingExplicitCopyContract = buildCreativeCompletionCase(explicitCopyTask, [
    successfulOperation('createRectangle', { documentId: 41, x: 0, y: 0, width: 1080, height: 1080 }),
    successfulOperation('getAllTextLayers', { documentId: 41 }, { textLayers: [] })
  ]);
  const unverifiedExplicitCopyContract = buildCreativeCompletionCase(explicitCopyTask, [
    successfulOperation('createTextLayer', { documentId: 41, text: '夏日上新' })
  ]);
  const unverifiedExplicitCopyPolicy = buildDesignTaskContractRemediationDirective({
    task: explicitCopyTask,
    toolCallLog: [
      currentDocumentRead,
      successfulOperation('createTextLayer', { documentId: 41, text: '夏日上新' }),
      currentLayerReadback
    ]
  });
  const presentExplicitCopyContract = buildCreativeCompletionCase(explicitCopyTask, [
    successfulOperation('createTextLayer', { documentId: 41, text: '夏日上新' }),
    successfulOperation('getAllTextLayers', { documentId: 41 }, {
      textLayers: [{ kind: 'text', text: '夏日上新' }]
    })
  ]);
  const readOnlyPlan = {
    ...editExistingPlan,
    requestKind: 'read_only_inspect',
    allowedToolScope: 'read_only',
    designBrief: {
      ...editExistingPlan.designBrief,
      goal: '只读检查当前海报，不要修改。'
    },
    executionPlan: {
      ...editExistingPlan.executionPlan,
      mode: 'read_only',
      canExecuteTools: false
    }
  };
  const readOnlyMutationContract = buildCreativeCompletionCase(
    '只读检查当前海报，不要修改。',
    [successfulOperation('setLayerFill', { documentId: 41, layerId: 7, color: '#FFFFFF' })],
    { agentTaskPlan: readOnlyPlan }
  );
  const evaluationProfile = {
    profileId: 'design.single_canvas_visual.evaluation/v0',
    capabilityGoal: '测试评价 Profile 与事实完成条件合并。',
    checks: [{
      id: 'fixture.fresh-result',
      key: 'fixture_fresh_result',
      label: '当前版本结构与画面已读回',
      required: true,
      completionScope: 'artifact_completion',
      expectedFix: '读取当前版本。'
    }]
  };
  const evaluationProfileResult = {
    profileId: evaluationProfile.profileId,
    // 软审美 finding 可保留 needs_review；产物完成轴由下方必需检查独立闭合。
    status: 'needs_review',
    verification: {
      missingRequiredCheckKeys: [],
      failedCheckKeys: [],
      needsReviewCheckKeys: [],
      requiredNeedsReviewCheckKeys: []
    },
    scorecard: { blockers: [] },
    completion: {
      artifactStatus: 'artifact_completed',
      publicationReviewStatus: 'publication_review_not_required',
      publicationReviewCheckCount: 0,
      approvedPublicationReviewCheckCount: 0,
      pendingPublicationReviewCheckKeys: [],
      rejectedPublicationReviewCheckKeys: [],
      boundaries: {
        artifactCompletionUsesPublicationReview: false,
        humanApprovalCanBeInferred: false
      }
    }
  };
  const profileZeroWriteContract = buildTaskCompletionContract({
    task: editExistingTask,
    context: { agentTaskPlan: editExistingPlan },
    toolCallLog: [currentDocumentRead, currentLayerReadback],
    evaluationProfile,
    evaluationProfileResult
  });
  const profileProductionToolLog = [
    currentDocumentRead,
    successfulOperation('createRectangle', {
      documentId: 41,
      x: 0,
      y: 0,
      width: 1080,
      height: 1080
    }),
    currentLayerReadback
  ];
  const profileCategoryTextVariants = [
    '设计 SKU，不要文字。',
    '设计详情页，必须包含标题“夏日上新”。',
    '设计主图，只调整当前文档。'
  ];
  const profileCategoryContracts = profileCategoryTextVariants.map((task) => buildTaskCompletionContract({
    task,
    context: { agentTaskPlan: editExistingPlan },
    toolCallLog: profileProductionToolLog,
    evaluationProfile,
    evaluationProfileResult
  }));
  const profileCategorySignatures = profileCategoryContracts.map((contract) => JSON.stringify({
    kind: contract?.kind,
    status: contract?.status,
    required: contract?.required.map((requirement) => ({
      id: requirement.id,
      status: requirement.status,
      method: requirement.method
    }))
  }));
  const profileCompletionIsCategoryInvariant = new Set(profileCategorySignatures).size === 1;
  const agenticMainImageArtifactContract = {
    version: 'agentic-artifact-completion-contract/v0',
    skillId: 'ecommerce.main_image',
    taskType: 'ecommerce.main_image.v1',
    workMode: 'create_new',
    productionObligation: 'photoshop_mutation_with_readback',
    deliveryOutputs: ['main_image_psd', 'main_image_preview', 'delivery_manifest'],
    exitCriteria: ['advisory-only'],
    reviewRubricRef: evaluationProfile.profileId
  };
  const agenticMainImageProductionLog = [
    currentDocumentRead,
    successfulOperation('createDocument', {
      documentId: 41,
      name: '审计主图'
    }),
    successfulOperation('createRectangle', {
      documentId: 41,
      x: 0,
      y: 0,
      width: 1440,
      height: 1440
    }),
    currentLayerReadback
  ];
  const buildAgenticMainImageProfileContract = (task, deliveryOperations = []) => (
    buildTaskCompletionContract({
      task,
      context: { agenticArtifactContract: agenticMainImageArtifactContract },
      toolCallLog: [...agenticMainImageProductionLog, ...deliveryOperations],
      evaluationProfile,
      evaluationProfileResult
    })
  );
  const agenticMainImageUnsavedContract = buildAgenticMainImageProfileContract(
    '请完成当前设计。'
  );
  const agenticMainImageRasterOnlyContract = buildAgenticMainImageProfileContract(
    '做主图。',
    [successfulOperation('quickExport', { documentId: 41, format: 'png' }, {
      outputPath: 'main-image.png'
    })]
  );
  const agenticMainImageCompleteContract = buildAgenticMainImageProfileContract(
    '生成一个单画布视觉。',
    [
      successfulOperation('quickExport', { documentId: 41, format: 'png' }, {
        outputPath: 'main-image.png'
      }),
      successfulOperation('saveDocument', { documentId: 41, format: 'psd' }, {
        filePath: 'main-image.psd'
      })
    ]
  );
  const agenticMainImageCategoryInvariantContract = buildAgenticMainImageProfileContract(
    '把它说成详情页或 SKU 也不能改变当前已经绑定的主图交付事实。',
    [
      successfulOperation('quickExport', { documentId: 41, format: 'png' }, {
        outputPath: 'main-image.png'
      }),
      successfulOperation('saveDocument', { documentId: 41, format: 'psd' }, {
        filePath: 'main-image.psd'
      })
    ]
  );
  const agenticMainImageUnsavedRemediation = buildDesignTaskContractRemediationDirective({
    task: '请完成当前设计。',
    context: { agenticArtifactContract: agenticMainImageArtifactContract },
    toolCallLog: agenticMainImageProductionLog
  });
  const agenticMainImageCompleteRemediation = buildDesignTaskContractRemediationDirective({
    task: '生成一个单画布视觉。',
    context: { agenticArtifactContract: agenticMainImageArtifactContract },
    toolCallLog: [
      ...agenticMainImageProductionLog,
      successfulOperation('quickExport', { documentId: 41, format: 'png' }, {
        outputPath: 'main-image.png'
      }),
      successfulOperation('saveDocument', { documentId: 41, format: 'psd' }, {
        filePath: 'main-image.psd'
      })
    ]
  });
  const scopedOptionalCompletionContract = scopedEditProfile && scopedOptionalEvaluationResult
    ? buildTaskCompletionContract({
      task: '只读投影局部修改评价结果，不执行新的写入。',
      context: { agentTaskPlan: readOnlyPlan },
      toolCallLog: [],
      evaluationProfile: scopedEditProfile,
      evaluationProfileResult: scopedOptionalEvaluationResult
    })
    : undefined;
  const scopedOptionalFailedCompletionContract = scopedEditProfile && scopedOptionalFailedEvaluationResult
    ? buildTaskCompletionContract({
      task: '只读投影局部修改评价结果，不执行新的写入。',
      context: { agentTaskPlan: readOnlyPlan },
      toolCallLog: [],
      evaluationProfile: scopedEditProfile,
      evaluationProfileResult: scopedOptionalFailedEvaluationResult
    })
    : undefined;
  const explicitDeliveryTask = '设计一张海报并完成计划声明的文件交付。';
  const explicitDeliveryPlan = {
    ...editExistingPlan,
    designBrief: {
      ...editExistingPlan.designBrief,
      goal: explicitDeliveryTask,
      deliverables: ['main_image_exports', 'main_image_psd']
    }
  };
  const partialDeliveryContract = buildCreativeCompletionCase(
    explicitDeliveryTask,
    [
      successfulOperation('createRectangle', { documentId: 41, x: 0, y: 0, width: 1080, height: 1080 }),
      successfulOperation('quickExport', { documentId: 41, format: 'png' }, { outputPath: 'main-image.png' })
    ],
    { agentTaskPlan: explicitDeliveryPlan }
  );
  const completeDeliveryContract = buildCreativeCompletionCase(
    explicitDeliveryTask,
    [
      successfulOperation('createRectangle', { documentId: 41, x: 0, y: 0, width: 1080, height: 1080 }),
      successfulOperation('quickExport', { documentId: 41, format: 'png' }, { outputPath: 'main-image.png' }),
      successfulOperation('saveDocument', { documentId: 41, format: 'psd' }, { filePath: 'main-image.psd' })
    ],
    { agentTaskPlan: explicitDeliveryPlan }
  );
  const editableOnlyDeliveryPlan = {
    ...explicitDeliveryPlan,
    designBrief: {
      ...explicitDeliveryPlan.designBrief,
      deliverables: ['main_image_psd']
    }
  };
  const unverifiedSmartSaveContract = buildCreativeCompletionCase(
    explicitDeliveryTask,
    [
      successfulOperation('createRectangle', { documentId: 41, x: 0, y: 0, width: 1080, height: 1080 }),
      successfulOperation('smartSave', { documentId: 41, exportFormat: 'psd' }, {
        message: 'Saved',
        savedPath: '当前海报'
      })
    ],
    { agentTaskPlan: editableOnlyDeliveryPlan }
  );
  const pathBearingSmartSaveContract = buildCreativeCompletionCase(
    explicitDeliveryTask,
    [
      successfulOperation('createRectangle', { documentId: 41, x: 0, y: 0, width: 1080, height: 1080 }),
      successfulOperation('smartSave', { documentId: 41, exportFormat: 'psd' }, {
        message: 'Saved: C:\\deliveries\\main-image.psd',
        savedPath: 'C:\\deliveries\\main-image.psd'
      })
    ],
    { agentTaskPlan: editableOnlyDeliveryPlan }
  );
  const nestedWorkflowMutation = successfulOperation(
    'createRectangle',
    { documentId: 41, x: 0, y: 0, width: 1080, height: 1080 }
  );
  nestedWorkflowMutation.result.acceptance = {
    enabled: true,
    verified: true,
    assertionStatus: 'passed',
    before: { historyStateRef: { documentId: 41, historyStateId: 101 } },
    after: { historyStateRef: { documentId: 41, historyStateId: 102 } }
  };
  const nestedWorkflowReadback = successfulOperation(
    'getLayerHierarchy',
    { documentId: 41 },
    { documentId: 41, historyStateRef: { documentId: 41, historyStateId: 102 } }
  );
  const genericNestedWorkflowToolLog = [{
    name: 'layout-replication',
    arguments: {},
    result: {
      success: true,
      data: {
        agentReActObservation: {
          version: 'agent-react-observation/v0',
          actionId: 'skill:layout-replication',
          kind: 'skill'
        },
        toolResults: [{
          toolName: 'generic-subflow',
          result: {
            success: true,
            output: {
              toolCallLog: [currentDocumentRead, nestedWorkflowMutation, nestedWorkflowReadback]
            }
          }
        }]
      }
    }
  }];
  const genericNestedWorkflowContract = buildTaskCompletionContract({
    task: editExistingTask,
    context: { agentTaskPlan: editExistingPlan },
    toolCallLog: genericNestedWorkflowToolLog
  });
  const expandedGenericNestedWorkflow = buildAgentOperationLedger(genericNestedWorkflowToolLog);
  const unverifiedNestedWorkflowContract = buildTaskCompletionContract({
    task: editExistingTask,
    context: { agentTaskPlan: editExistingPlan },
    toolCallLog: [{
      name: 'layout-replication',
      arguments: {},
      result: {
        success: true,
        data: {
          agentReActObservation: {
            version: 'agent-react-observation/v0',
            actionId: 'skill:layout-replication',
            kind: 'skill'
          }
        },
        toolResults: [{
          toolName: 'createRectangle',
          result: { success: true, activeDocumentId: 41 }
        }, nestedWorkflowReadback]
      }
    }]
  });
  const mutationWithoutAcceptance = successfulOperation(
    'createRectangle',
    { documentId: 41, x: 0, y: 0, width: 1080, height: 1080 }
  );
  const wrongHistoryNestedWorkflowContract = buildTaskCompletionContract({
    task: editExistingTask,
    context: { agentTaskPlan: editExistingPlan },
    toolCallLog: [{
      name: 'layout-replication',
      arguments: {},
      result: {
        success: true,
        data: {
          agentReActObservation: {
            version: 'agent-react-observation/v0',
            actionId: 'skill:layout-replication',
            kind: 'skill'
          }
        },
        toolResults: [mutationWithoutAcceptance, {
          toolName: 'getLayerHierarchy',
          result: {
            success: true,
            activeDocumentId: 41,
            historyStateRef: { documentId: 41, historyStateId: 103 }
          }
        }]
      }
    }]
  });
  const wrongDocumentNestedWorkflowContract = buildTaskCompletionContract({
    task: editExistingTask,
    context: { agentTaskPlan: editExistingPlan },
    toolCallLog: [{
      name: 'layout-replication',
      arguments: {},
      result: {
        success: true,
        data: {
          agentReActObservation: {
            version: 'agent-react-observation/v0',
            actionId: 'skill:layout-replication',
            kind: 'skill'
          }
        },
        toolResults: [mutationWithoutAcceptance, {
          toolName: 'getLayerHierarchy',
          result: {
            success: true,
            activeDocumentId: 42,
            historyStateRef: { documentId: 42, historyStateId: 102 }
          }
        }]
      }
    }]
  });
  const publicProviderOperation = sanitizeSkuToolResultsForPublicResult([{
    toolName: 'skuLayout-2双-1/2',
    providerToolName: 'skuLayout',
    arguments: { action: 'execute', documentId: 41 },
    operationLabel: '2双批次 1/2',
    result: mutationWithoutAcceptance.result
  }]);
  const providerIdentityLedger = buildAgentOperationLedger([{
    name: 'layout-replication',
    arguments: {},
    result: {
      success: true,
      toolResults: publicProviderOperation,
      data: {
        agentReActObservation: {
          version: 'agent-react-observation/v0',
          actionId: 'skill:layout-replication',
          kind: 'skill'
        }
      }
    }
  }]);
  const ordinaryToolInjectedLedger = buildAgentOperationLedger([{
    name: 'getDocumentInfo',
    arguments: { documentId: 41 },
    result: {
      success: true,
      activeDocumentId: 41,
      historyStateRef: { documentId: 41, historyStateId: 101 },
      toolResults: [mutationWithoutAcceptance]
    }
  }]);
  const emptySkillLedgerWithOuterMutationLog = [{
    name: 'layout-replication',
    arguments: {},
    result: {
      ...mutationWithoutAcceptance.result,
      success: true,
      data: {
        agentReActObservation: {
          version: 'agent-react-observation/v0',
          actionId: 'skill:layout-replication',
          kind: 'skill'
        }
      }
    }
  }];
  const emptySkillLedgerWithOuterMutation = buildAgentOperationLedger(
    emptySkillLedgerWithOuterMutationLog
  );
  const emptySkillOuterMutationContract = buildTaskCompletionContract({
    task: editExistingTask,
    context: { agentTaskPlan: editExistingPlan },
    toolCallLog: emptySkillLedgerWithOuterMutationLog
  });
  const genericNestedProfileContract = buildTaskCompletionContract({
    task: editExistingTask,
    context: { agentTaskPlan: editExistingPlan },
    toolCallLog: genericNestedWorkflowToolLog,
    evaluationProfile,
    evaluationProfileResult
  });
  const missingExplicitCopyVerdict = buildDesignVerdict({
    contract: missingExplicitCopyContract
  });
  const unqualifiedAestheticVerdict = buildDesignVerdict({
    contract: {
      kind: 'creative_design',
      status: 'failed',
      required: [{
        id: 'creative-layout-quality',
        label: '构图仍需调整',
        status: 'failed',
        reason: '视觉层级仍可优化。'
      }],
      blockers: ['视觉层级仍可优化。'],
      warnings: [],
      summary: '构图待复核。'
    }
  });
  const creativeCompletionViolations = [
    ...(noTextContract?.kind === 'creative_design'
      ? []
      : [`no-text:wrong-kind:${noTextContract?.kind || 'missing'}`]),
    ...(requirementById(noTextContract, 'creative-document')
      ? ['no-text:unexpected-create-document-requirement']
      : []),
    ...(requirementById(noTextContract, 'creative-copy')
      ? ['no-text:unexpected-copy-requirement']
      : []),
    ...(requirementById(noTextContract, 'creative-copy-constraint')?.status === 'needs_review'
      ? []
      : ['no-text:missing-text-readback-did-not-stay-needs-review']),
    ...(requirementById(verifiedNoTextContract, 'creative-copy-constraint')?.status === 'passed'
      ? []
      : ['no-text:verified-empty-final-state-not-passed']),
    ...(requirementById(restoredNoTextContract, 'creative-copy-constraint')?.status === 'passed'
      ? []
      : ['no-text:restored-final-state-remains-sealed-by-old-write']),
    ...(/用\s*placeImage|用\s*createTextLayer|background、main-image、title、selling-point|深色背景配浅色字|恢复本轮误加/.test(noTextPolicy?.directive || '')
      ? ['no-text:remediation-reintroduced-hard-coded-content']
      : []),
    ...(requirementById(typographyContract, 'creative-copy')?.status === 'passed'
      ? []
      : ['typography:explicit-text-obligation-not-satisfied']),
    ...(requirementById(typographyContract, 'creative-visual')
      ? ['typography:subject-image-requirement-restored']
      : []),
    ...(requirementById(typographyContract, 'creative-document')
      ? ['typography:unexpected-create-document-requirement']
      : []),
    ...(requirementById(editExistingContract, 'creative-document')
      ? ['edit-existing:unexpected-create-document-requirement']
      : []),
    ...(requirementById(editExistingContract, 'creative-target')?.status === 'passed'
      ? []
      : ['edit-existing:target-fact-not-passed']),
    ...(requirementById(editExistingContract, 'creative-readback')?.status === 'passed'
      ? []
      : ['edit-existing:same-target-readback-not-passed']),
    ...(legacyPlaceholderNeedsFixContract?.status !== 'completed'
      && requirementById(legacyPlaceholderNeedsFixContract, 'creative-layout-quality')?.status === 'needs_review'
      && requirementById(legacyPlaceholderNeedsFixContract, 'creative-layout-quality')?.actual?.verifiedClosureCount === 0
      && requirementById(legacyPlaceholderNeedsFixContract, 'creative-layout-quality')?.actual?.unresolvedFindingCount === 1
      && requirementById(legacyPlaceholderNeedsFixContract, 'creative-review')?.actual?.needsFixCount === 1
      && legacyPlaceholderNeedsFixContract?.verification?.visual?.blockers?.some((item) => item.includes('需要修订'))
      ? []
      : ['render-layout-closure:legacy-needs-fix-review-closed-placeholder-finding']),
    ...(legacyPlaceholderUnreadableContract?.status !== 'completed'
      && requirementById(legacyPlaceholderUnreadableContract, 'creative-layout-quality')?.status === 'needs_review'
      && requirementById(legacyPlaceholderUnreadableContract, 'creative-review')?.actual?.unreadableCount === 1
      ? []
      : ['render-layout-closure:legacy-unreadable-review-closed-placeholder-finding']),
    ...(legacyPlaceholderUnknownContract?.status !== 'completed'
      && requirementById(legacyPlaceholderUnknownContract, 'creative-layout-quality')?.status === 'needs_review'
      && requirementById(legacyPlaceholderUnknownContract, 'creative-review')?.actual?.unreviewedCount === 1
      && legacyPlaceholderUnknownContract?.verification?.visual?.blockers?.some((item) => item.includes('没有有效'))
      ? []
      : ['render-layout-closure:legacy-unknown-review-closed-placeholder-finding']),
    ...(legacyPlaceholderPassedContract?.status === 'completed'
      && requirementById(legacyPlaceholderPassedContract, 'creative-layout-quality')?.status === 'passed'
      && requirementById(legacyPlaceholderPassedContract, 'creative-layout-quality')?.actual?.verifiedClosureCount === 1
      && requirementById(legacyPlaceholderPassedContract, 'creative-layout-quality')?.actual?.unresolvedFindingCount === 0
      && requirementById(legacyPlaceholderPassedContract, 'creative-layout-quality')?.actual?.ownerCount === 1
      && requirementById(legacyPlaceholderPassedContract, 'creative-layout-quality')?.actual?.unresolvedOwnerCount === 0
      && requirementById(legacyPlaceholderPassedContract, 'creative-review')?.status === 'passed'
      ? []
      : ['render-layout-closure:legacy-passed-review-did-not-close-placeholder-finding']),
    ...(stageAUnresolvedStageBPassedContract?.status !== 'completed'
      && requirementById(stageAUnresolvedStageBPassedContract, 'creative-layout-quality')?.status === 'needs_review'
      && requirementById(stageAUnresolvedStageBPassedContract, 'creative-layout-quality')?.actual?.ownerCount === 2
      && requirementById(stageAUnresolvedStageBPassedContract, 'creative-layout-quality')?.actual?.unresolvedOwnerCount === 1
      && requirementById(stageAUnresolvedStageBPassedContract, 'creative-layout-quality')?.actual?.unresolvedFindingCount === 1
      && requirementById(stageAUnresolvedStageBPassedContract, 'creative-layout-quality')?.actual?.findings?.length === 1
      ? []
      : ['render-layout-owner:later-stage-erased-unresolved-earlier-stage']),
    ...(sameStageCleanRerenderContract?.status === 'completed'
      && requirementById(sameStageCleanRerenderContract, 'creative-layout-quality')?.status === 'passed'
      && requirementById(sameStageCleanRerenderContract, 'creative-layout-quality')?.actual?.ownerCount === 1
      && requirementById(sameStageCleanRerenderContract, 'creative-layout-quality')?.actual?.unresolvedOwnerCount === 0
      && requirementById(sameStageCleanRerenderContract, 'creative-layout-quality')?.actual?.findings?.length === 0
      ? []
      : ['render-layout-owner:same-stage-clean-rerender-did-not-supersede-old-state']),
    ...(differentDocumentPassedRenderContract?.status !== 'completed'
      && requirementById(differentDocumentPassedRenderContract, 'creative-layout-quality')?.status === 'needs_review'
      && requirementById(differentDocumentPassedRenderContract, 'creative-layout-quality')?.actual?.ownerCount === 2
      && requirementById(differentDocumentPassedRenderContract, 'creative-layout-quality')?.actual?.unresolvedOwnerCount === 1
      && requirementById(differentDocumentPassedRenderContract, 'creative-layout-quality')?.actual?.unresolvedFindingCount === 1
      ? []
      : ['render-layout-owner:different-document-render-erased-unresolved-owner']),
    ...(crossOwnerReviewContract?.status !== 'completed'
      && requirementById(crossOwnerReviewContract, 'creative-layout-quality')?.status === 'needs_review'
      && requirementById(crossOwnerReviewContract, 'creative-layout-quality')?.actual?.ownerCount === 2
      && requirementById(crossOwnerReviewContract, 'creative-layout-quality')?.actual?.unresolvedOwnerCount === 1
      && requirementById(crossOwnerReviewContract, 'creative-layout-quality')?.actual?.verifiedClosureCount === 0
      ? []
      : ['render-layout-owner:later-owner-visual-review-closed-earlier-owner']),
    ...(latestRevisionReviewContract?.status === 'completed'
      && requirementById(latestRevisionReviewContract, 'creative-layout-quality')?.status === 'passed'
      && requirementById(latestRevisionReviewContract, 'creative-layout-quality')?.actual?.ownerCount === 1
      && requirementById(latestRevisionReviewContract, 'creative-layout-quality')?.actual?.verifiedClosureCount === 1
      && requirementById(latestRevisionReviewContract, 'creative-layout-quality')?.actual?.unresolvedFindingCount === 0
      ? []
      : ['render-layout-owner:latest-same-target-revision-did-not-supersede-old-review']),
    ...(unscopedTopBottomContract?.status !== 'completed'
      && requirementById(unscopedTopBottomContract, 'creative-layout-quality')?.status === 'needs_review'
      && requirementById(unscopedTopBottomContract, 'creative-layout-quality')?.actual?.ownerCount === 2
      && requirementById(unscopedTopBottomContract, 'creative-layout-quality')?.actual?.unresolvedOwnerCount === 1
      ? []
      : ['render-layout-owner:unscoped-different-screen-region-was-merged']),
    ...(unscopedRetiredDraftContract?.status === 'completed'
      && requirementById(unscopedRetiredDraftContract, 'creative-layout-quality')?.status === 'passed'
      && requirementById(unscopedRetiredDraftContract, 'creative-layout-quality')?.actual?.ownerCount === 1
      && requirementById(unscopedRetiredDraftContract, 'creative-layout-quality')?.actual?.unresolvedOwnerCount === 0
      ? []
      : ['render-layout-owner:verified-unscoped-draft-retirement-did-not-supersede']),
    ...(unresolvedComposeAlternativeContract?.status !== 'completed'
      && requirementById(unresolvedComposeAlternativeContract, 'creative-layout-quality')?.status === 'needs_review'
      && requirementById(unresolvedComposeAlternativeContract, 'creative-layout-quality')?.actual?.ownerCount === 2
      && requirementById(unresolvedComposeAlternativeContract, 'creative-layout-quality')?.actual?.unresolvedOwnerCount === 1
      && requirementById(unresolvedComposeAlternativeContract, 'creative-layout-quality')?.actual?.unresolvedFindingCount === 1
      && requirementById(unresolvedComposeAlternativeContract, 'creative-layout-quality')?.actual?.verifiedClosureCount === 0
      && requirementById(unresolvedComposeAlternativeContract, 'creative-layout-quality')?.actual?.criticClosureCount === 0
      ? []
      : ['compose-design-comparison:unreviewed-structural-change-was-treated-as-better']),
    ...(genericReviewedComposeAlternativeContract?.status !== 'completed'
      && requirementById(genericReviewedComposeAlternativeContract, 'creative-layout-quality')?.status === 'needs_review'
      && requirementById(genericReviewedComposeAlternativeContract, 'creative-layout-quality')?.actual?.unresolvedFindingCount === 1
      && requirementById(genericReviewedComposeAlternativeContract, 'creative-layout-quality')?.actual?.verifiedClosureCount === 0
      ? []
      : ['compose-design-comparison:generic-looks-good-review-closed-comparison-without-reason']),
    ...(requirementById(reviewedComposeAlternativeContract, 'creative-layout-quality')?.status === 'passed'
      && requirementById(reviewedComposeAlternativeContract, 'creative-layout-quality')?.actual?.ownerCount === 2
      && requirementById(reviewedComposeAlternativeContract, 'creative-layout-quality')?.actual?.unresolvedOwnerCount === 0
      && requirementById(reviewedComposeAlternativeContract, 'creative-layout-quality')?.actual?.unresolvedFindingCount === 0
      && requirementById(reviewedComposeAlternativeContract, 'creative-layout-quality')?.actual?.verifiedClosureCount === 1
      && requirementById(reviewedComposeAlternativeContract, 'creative-layout-quality')?.actual?.criticClosureCount === 0
      ? []
      : ['compose-design-comparison:same-document-visual-review-did-not-close-comparison']),
    ...(criticComposeAlternativeContract?.status === 'completed'
      && requirementById(criticComposeAlternativeContract, 'creative-review')?.status === 'passed'
      && requirementById(criticComposeAlternativeContract, 'creative-review')?.actual?.independentCriticReviewCount === 1
      && requirementById(criticComposeAlternativeContract, 'creative-layout-quality')?.status === 'passed'
      && requirementById(criticComposeAlternativeContract, 'creative-layout-quality')?.actual?.ownerCount === 2
      && requirementById(criticComposeAlternativeContract, 'creative-layout-quality')?.actual?.unresolvedOwnerCount === 0
      && requirementById(criticComposeAlternativeContract, 'creative-layout-quality')?.actual?.unresolvedFindingCount === 0
      && requirementById(criticComposeAlternativeContract, 'creative-layout-quality')?.actual?.verifiedClosureCount === 1
      && requirementById(criticComposeAlternativeContract, 'creative-layout-quality')?.actual?.criticClosureCount === 1
      ? []
      : ['compose-design-comparison:version-bound-critic-did-not-close-comparison']),
    ...(requirementById(missingExplicitCopyContract, 'creative-copy')?.status === 'failed'
      && requirementById(missingExplicitCopyContract, 'creative-copy')?.method === 'deterministic'
      && requirementById(missingExplicitCopyContract, 'creative-copy')?.blockerKind === 'required_artifact_missing'
      && Boolean(requirementById(missingExplicitCopyContract, 'creative-copy')?.proofRef)
      ? []
      : ['explicit-copy:missing-case-not-qualified']),
    ...(missingExplicitCopyVerdict.status === 'failed'
      && missingExplicitCopyVerdict.contractFailedRequirementIds.includes('creative-copy')
      ? []
      : [`explicit-copy:missing-case-not-hard-failed:${missingExplicitCopyVerdict.status}`]),
    ...(requirementById(presentExplicitCopyContract, 'creative-copy')?.status === 'passed'
      && requirementById(presentExplicitCopyContract, 'creative-copy')?.actual?.contentCorrectnessVerified === false
      ? []
      : ['explicit-copy:nonempty-text-existence-was-misreported-as-content-correctness']),
    ...(requirementById(unverifiedExplicitCopyContract, 'creative-copy')?.status === 'needs_review'
      ? []
      : ['explicit-copy:write-without-final-text-readback-did-not-stay-needs-review']),
    ...((unverifiedExplicitCopyPolicy?.directive || '').includes('尚未验证')
      && !(unverifiedExplicitCopyPolicy?.directive || '').includes('getAllTextLayers')
      && /不指定下一工具/.test(unverifiedExplicitCopyPolicy?.directive || '')
      ? []
      : ['explicit-copy:completion-gap-selected-a-recovery-tool']),
    ...(requirementById(readOnlyMutationContract, 'creative-read-only-constraint')?.status === 'failed'
      && requirementById(readOnlyMutationContract, 'creative-read-only-constraint')?.method === 'deterministic'
      ? []
      : ['read-only-plan:photoshop-write-disappeared-from-completion']),
    ...(profileZeroWriteContract?.kind === 'skill_evaluation_profile'
      && requirementById(profileZeroWriteContract, 'production-execution')?.status === 'failed'
      && !requirementById(profileZeroWriteContract, 'creative-execution')
      ? []
      : ['evaluation-profile:manifest-neutral-production-evidence-was-short-circuited']),
    ...(profileCompletionIsCategoryInvariant
      ? []
      : ['evaluation-profile:bound-completion-still-depends-on-category-task-text']),
    ...(agenticMainImageUnsavedContract?.status === 'failed'
      && requirementById(agenticMainImageUnsavedContract, 'production-delivery')?.status === 'failed'
      ? []
      : ['agentic-delivery:photoshop-write-and-readback-bypassed-file-obligations']),
    ...(agenticMainImageRasterOnlyContract?.status === 'failed'
      && requirementById(agenticMainImageRasterOnlyContract, 'production-delivery')?.status === 'failed'
      ? []
      : ['agentic-delivery:raster-only-bypassed-editable-document-obligation']),
    ...(agenticMainImageCompleteContract?.status === 'completed'
      && requirementById(agenticMainImageCompleteContract, 'production-delivery')?.status === 'passed'
      ? []
      : ['agentic-delivery:psd-and-preview-receipts-did-not-complete-profile-task']),
    ...(agenticMainImageUnsavedRemediation
      && /保存可编辑文档与预览图片/.test(agenticMainImageUnsavedRemediation.shortReason)
      && !/(quickExport|saveDocument)/.test(agenticMainImageUnsavedRemediation.directive)
      && !/保存可编辑文档与预览图片/.test(
        agenticMainImageCompleteRemediation?.shortReason || ''
      )
      ? []
      : ['agentic-delivery:pre-terminal-same-instance-remediation-missing-or-selected-tool']),
    ...(JSON.stringify(agenticMainImageCompleteContract) === JSON.stringify(
      agenticMainImageCategoryInvariantContract
    )
      ? []
      : ['agentic-delivery:structured-contract-still-depends-on-category-task-text']),
    ...(scopedOptionalCompletionContract?.status === 'completed'
      && scopedOptionalCompletionContract.warnings.some((warning) => (
        warning.includes('局部修改视觉复核') && warning.includes('可选复核项')
      ))
      ? []
      : ['evaluation-profile:optional-needs-review-still-downgraded-completion-or-lost-warning']),
    ...(scopedOptionalFailedCompletionContract?.status === 'completed'
      && scopedOptionalFailedCompletionContract.warnings.some((warning) => (
        warning.includes('局部修改视觉复核') && warning.includes('明确未通过')
      ))
      ? []
      : ['evaluation-profile:optional-failure-still-downgraded-completion-or-lost-warning']),
    ...(requirementById(partialDeliveryContract, 'creative-delivery')?.status === 'failed'
      ? []
      : ['explicit-delivery:raster-only-shortcut-not-rejected']),
    ...(requirementById(completeDeliveryContract, 'creative-delivery')?.status === 'passed'
      ? []
      : ['explicit-delivery:declared-raster-and-editable-files-not-passed']),
    ...(requirementById(unverifiedSmartSaveContract, 'creative-delivery')?.status === 'failed'
      ? []
      : ['explicit-delivery:smart-save-tool-name-or-input-format-forged-editable-artifact']),
    ...(requirementById(pathBearingSmartSaveContract, 'creative-delivery')?.status === 'failed'
      ? []
      : ['explicit-delivery:internal-smart-save-was-accepted-as-final-delivery']),
    ...(requirementById(genericNestedWorkflowContract, 'creative-execution')?.status === 'passed'
      && requirementById(genericNestedWorkflowContract, 'creative-target')?.status === 'passed'
      && requirementById(genericNestedWorkflowContract, 'creative-readback')?.status === 'passed'
      && genericNestedWorkflowContract?.verification?.toolAcceptance?.verified === 1
      ? []
      : ['operation-ledger:nested-write-readback-and-acceptance-not-projected']),
    ...(expandedGenericNestedWorkflow.map((entry) => entry.name).join('|')
        === 'layout-replication|generic-subflow|getDocumentInfo|createRectangle|getLayerHierarchy'
      && expandedGenericNestedWorkflow[0]?.operationLedgerProvenance?.role === 'workflow_envelope'
      && expandedGenericNestedWorkflow[1]?.operationLedgerProvenance?.role === 'workflow_envelope'
      && expandedGenericNestedWorkflow.slice(2).every((entry) => (
        entry.operationLedgerProvenance?.role === 'nested_operation'
      ))
      ? []
      : ['operation-ledger:nested-data-wrapper-order-or-provenance-lost']),
    ...(requirementById(unverifiedNestedWorkflowContract, 'creative-execution')?.status === 'failed'
      && unverifiedNestedWorkflowContract?.verification?.toolAcceptance?.verified === 0
      ? []
      : ['operation-ledger:nested-success-without-host-proof-gained-mutation-credit']),
    ...(requirementById(wrongHistoryNestedWorkflowContract, 'creative-execution')?.status === 'passed'
      && requirementById(wrongHistoryNestedWorkflowContract, 'creative-readback')?.status === 'failed'
      ? []
      : ['operation-ledger:wrong-history-readback-was-accepted']),
    ...(requirementById(wrongDocumentNestedWorkflowContract, 'creative-execution')?.status === 'passed'
      && requirementById(wrongDocumentNestedWorkflowContract, 'creative-readback')?.status === 'failed'
      ? []
      : ['operation-ledger:wrong-document-readback-was-accepted']),
    ...(publicProviderOperation[0]?.providerToolName === 'skuLayout'
      && publicProviderOperation[0]?.toolName === 'skuLayout-2双-1/2'
      && publicProviderOperation[0]?.arguments?.action === 'execute'
      && publicProviderOperation[0]?.operationLabel === '2双批次 1/2'
      && providerIdentityLedger[1]?.name === 'skuLayout'
      && providerIdentityLedger[1]?.arguments?.action === 'execute'
      && providerIdentityLedger[1]?.succeeded === true
      ? []
      : ['operation-ledger:canonical-provider-name-was-lost-behind-display-label']),
    ...(ordinaryToolInjectedLedger.length === 1
      && ordinaryToolInjectedLedger[0]?.name === 'getDocumentInfo'
      && ordinaryToolInjectedLedger[0]?.operationLedgerProvenance?.role === 'top_level_operation'
      ? []
      : ['operation-ledger:ordinary-tool-result-injected-fake-nested-ledger']),
    ...(emptySkillLedgerWithOuterMutation.length === 1
      && emptySkillLedgerWithOuterMutation[0]?.succeeded === false
      && emptySkillLedgerWithOuterMutation[0]?.operationLedgerProvenance?.role === 'workflow_envelope'
      && requirementById(emptySkillOuterMutationContract, 'creative-execution')?.status === 'failed'
      ? []
      : ['operation-ledger:empty-skill-envelope-outer-commit-gained-mutation-credit']),
    ...(genericNestedProfileContract?.kind === 'skill_evaluation_profile'
      && requirementById(genericNestedProfileContract, 'production-execution')?.status === 'passed'
      && requirementById(genericNestedProfileContract, 'production-target')?.status === 'passed'
      && requirementById(genericNestedProfileContract, 'production-readback')?.status === 'passed'
      ? []
      : ['operation-ledger:profile-completion-did-not-use-shared-nested-ledger']),
    ...(unqualifiedAestheticVerdict.status === 'needs_review'
      && unqualifiedAestheticVerdict.blockers.length === 0
      ? []
      : [`aesthetic:unqualified-failure-became-hard:${unqualifiedAestheticVerdict.status}`])
  ];

  function evaluateSkuTemplateConsistencyCase({
    expectedItemCount,
    templateName,
    slotCount,
    textCount,
    structureRepresentsItemCount = true,
    withRevision = true
  }) {
    const textObservations = textCount === undefined
      ? []
      : [{
        layerId: 11,
        name: '数量标签',
        contents: `限量 ${textCount}双装 组合`,
        contentsTruncated: false,
        visible: true
      }];
    return verifySkuTemplateContentConsistency({
      expectedItemCount,
      templateName,
      executionPlanProofRef: `audit:sku-plan:${expectedItemCount}`,
      structureRepresentsItemCount,
      inspection: {
        schema: 'sku-template-layout-inspection/v3',
        ...(withRevision
          ? { historyStateRef: { documentId: 71, historyStateId: 101 } }
          : {}),
        slotCount,
        textObservations,
        textObservationCount: textObservations.length,
        textObservationsTruncated: false
      }
    });
  }

  const repairableSkuTemplateConsistency = evaluateSkuTemplateConsistencyCase({
    expectedItemCount: 3,
    templateName: '3双装.tif',
    slotCount: 3,
    textCount: 4
  });
  const repairableSkuTemplateProposal = buildSkuTemplatePackCountRepairProposal(
    repairableSkuTemplateConsistency
  );
  const structuralSkuTemplateConflict = evaluateSkuTemplateConsistencyCase({
    expectedItemCount: 3,
    templateName: '3双装.tif',
    slotCount: 4,
    textCount: 4
  });
  const filenameOnlySkuTemplateWarning = evaluateSkuTemplateConsistencyCase({
    expectedItemCount: 4,
    templateName: '3双装.tif',
    slotCount: 4,
    textCount: 4
  });
  const noPackTextSkuTemplateConsistency = evaluateSkuTemplateConsistencyCase({
    expectedItemCount: 3,
    templateName: '3双装.tif',
    slotCount: 3
  });
  const revisionlessSkuTemplateConsistency = evaluateSkuTemplateConsistencyCase({
    expectedItemCount: 3,
    templateName: '3双装.tif',
    slotCount: 3,
    textCount: 4,
    withRevision: false
  });
  const legacyRegionSkuTemplateConsistency = evaluateSkuTemplateConsistencyCase({
    expectedItemCount: 3,
    templateName: '3双装.tif',
    slotCount: 1,
    textCount: 4,
    structureRepresentsItemCount: false
  });
  const legacyRegionSkuTemplateProposal = buildSkuTemplatePackCountRepairProposal(
    legacyRegionSkuTemplateConsistency
  );
  const oldSchemaSkuTemplateConsistency = verifySkuTemplateContentConsistency({
    expectedItemCount: 3,
    templateName: '3双装.tif',
    executionPlanProofRef: 'audit:sku-plan:old-schema',
    inspection: {
      schema: 'sku-template-layout-inspection/v2',
      historyStateRef: { documentId: 71, historyStateId: 101 },
      slotCount: 3,
      textObservations: [],
      textObservationCount: 0,
      textObservationsTruncated: false
    }
  });
  const truncatedSkuTemplateConsistency = verifySkuTemplateContentConsistency({
    expectedItemCount: 3,
    templateName: '3双装.tif',
    executionPlanProofRef: 'audit:sku-plan:truncated-text',
    inspection: {
      schema: 'sku-template-layout-inspection/v3',
      historyStateRef: { documentId: 71, historyStateId: 101 },
      slotCount: 3,
      textObservations: [{
        layerId: 11,
        name: '数量标签',
        contents: '限量 4双装',
        contentsTruncated: true,
        visible: true
      }],
      textObservationCount: 2,
      textObservationsTruncated: true
    }
  });
  const multiplePackCountsInOneLayer = verifySkuTemplateContentConsistency({
    expectedItemCount: 3,
    templateName: '3双装.tif',
    executionPlanProofRef: 'audit:sku-plan:multiple-counts',
    inspection: {
      schema: 'sku-template-layout-inspection/v3',
      historyStateRef: { documentId: 71, historyStateId: 101 },
      slotCount: 3,
      textObservations: [{
        layerId: 11,
        name: '数量标签',
        contents: '3双装与4双装可选',
        contentsTruncated: false,
        visible: true
      }],
      textObservationCount: 1,
      textObservationsTruncated: false
    }
  });
  const hiddenPackCountSkuTemplateConsistency = verifySkuTemplateContentConsistency({
    expectedItemCount: 3,
    templateName: '3双装.tif',
    executionPlanProofRef: 'audit:sku-plan:hidden-text',
    inspection: {
      schema: 'sku-template-layout-inspection/v3',
      historyStateRef: { documentId: 71, historyStateId: 101 },
      slotCount: 3,
      textObservations: [{
        layerId: 12,
        name: '停用数量标签',
        contents: '4双装',
        contentsTruncated: false,
        visible: false
      }],
      textObservationCount: 1,
      textObservationsTruncated: false
    }
  });
  const skuRoutingOptions = {
    includeVisibilities: ['user-facing'],
    includeRouteClasses: ['business-workflow'],
    modelDirectExecution: 'forbidden'
  };
  const runtimeSkillRecommendationCases = [
    ['帮我做 SKU', 'sku-batch'],
    ['帮我做SKU编排', 'sku-batch'],
    ['帮我完成SKU编排', 'sku-batch'],
    ['帮我做详情页', 'detail-page-design'],
    ['帮我做主图', 'main-image-design']
  ];
  for (const [text, expectedSkillId] of runtimeSkillRecommendationCases) {
    const decision = buildAutonomousExecutionDecisionForEngine(
      '审计：自然语言生产请求仍由模型选择工作方法。'
    );
    const recommendation = buildSkillRoutingRecommendation(text, skuRoutingOptions);
    if (recommendation?.skillId !== expectedSkillId
      || recommendation.advisoryOnly !== true
      || recommendation.bindsRuntimeIdentity !== false
      || recommendation.grantsPermission !== false) {
      runtimeSkillHandoffViolations.push(
        `runtime-skill-handoff:text-recommendation-not-advisory:${text}:${recommendation?.skillId || 'none'}`
      );
      continue;
    }
    const runtime = resolveAutonomousCapabilityRuntime({
      agentIntentControlPlane: decision,
      skillRoutingRecommendation: recommendation
    }, {});
    const status = runtime.runtimeContractStatus;
    if (status.status !== 'no_skill_selected'
      || status.manifestSkillId
      || runtime.capabilitySession.getResolution().manifestRef) {
      runtimeSkillHandoffViolations.push(
        `runtime-skill-handoff:text-recommendation-bound-runtime-owner:${text}:${JSON.stringify(status)}`
      );
    }
  }
  const runtimeSkillDeferredOwnerCases = [
    '用详情页素材做一版主图',
    '先做主图，再做详情页',
    '可以用这批素材给我出一个主图吗'
  ];
  for (const text of runtimeSkillDeferredOwnerCases) {
    const semanticDecision = buildAutonomousExecutionDecisionForEngine(
      '审计：未静态选择 owner 的明确生产请求仍进入普通 Agent。'
    );
    const recommendation = buildSkillRoutingRecommendation(text, skuRoutingOptions);
    if (recommendation) {
      runtimeSkillHandoffViolations.push(
        `runtime-skill-handoff:ambiguous-or-noncanonical-request-selected-static-owner:${text}:${recommendation.skillId}`
      );
      continue;
    }
    const runtime = resolveAutonomousCapabilityRuntime({
      userTask: text,
      agentIntentControlPlane: semanticDecision
    }, {});
    const activeToolNames = runtime.capabilitySession.activeTools.map((tool) => tool.name);
    const legacyActivation = runtime.capabilitySession.requestCapabilities([
      'skill.main-image-design',
      'skill.detail-page-design',
      'skill.sku-batch'
    ]);
    if (!activeToolNames.includes('createDocument')
      || !activeToolNames.includes('composeDesign')) {
      runtimeSkillHandoffViolations.push(
        `runtime-skill-handoff:unbound-production-lost-atomic-write-baseline:${text}`
      );
    }
    if (legacyActivation.status !== 'rejected'
      || legacyActivation.activatedCapabilityIds.length !== 0
      || !['skill.main-image-design', 'skill.detail-page-design', 'skill.sku-batch'].every(
        (capabilityId) => legacyActivation.issues.some((issue) => (
          issue.code === 'requested_capability_forbidden'
          && issue.capabilityId === capabilityId
        ))
      )) {
      runtimeSkillHandoffViolations.push(
        `runtime-skill-handoff:legacy-business-skill-activated-before-manifest:${text}`
      );
    }
  }
  const runtimeSkillHandoffNegativeCases = [
    '帮我看一下详情页',
    '你会做主图吗？',
    '帮我做长图'
  ];
  for (const text of runtimeSkillHandoffNegativeCases) {
    const recommendation = buildSkillRoutingRecommendation(text, skuRoutingOptions);
    const decision = buildAgentIntentControlPlaneDecision({
      userInput: text,
      hasImageInput: false,
      hasDocument: true,
      photoshopConnected: true
    });
    const runtime = resolveAutonomousCapabilityRuntime({
      userTask: text,
      agentIntentControlPlane: decision,
      ...(recommendation ? { skillRoutingRecommendation: recommendation } : {})
    }, {});
    if (runtime.runtimeContractStatus.status !== 'no_skill_selected'
      || runtime.capabilitySession.getResolution().manifestRef) {
      runtimeSkillHandoffViolations.push(
        `runtime-skill-handoff:non-production-or-ambiguous-request-bound-owner:${text}:${recommendation?.skillId || 'none'}`
      );
    }
  }
  const explicitSkillDeny = extractExplicitUserCapabilityConstraint('不要用 Skill');
  if (explicitSkillDeny.skillBridgePolicy !== 'forbid') {
    runtimeSkillHandoffViolations.push(
      'runtime-skill-handoff:explicit-skill-deny-not-preserved'
    );
  }
  const deferredExecutionConstraint = extractExplicitUserCapabilityConstraint(
    '本轮先不要动手，分析当前主图有哪些问题'
  );
  const allToolsDeniedConstraint = extractExplicitUserCapabilityConstraint(
    '本轮不要使用任何工具，只回答我的问题'
  );
  if (deferredExecutionConstraint.toolScopeCeiling !== 'read_only'
    || allToolsDeniedConstraint.toolScopeCeiling !== 'none') {
    runtimeSkillHandoffViolations.push(
      'runtime-skill-handoff:deferred-execution-and-all-tool-deny-ceilings-conflated'
    );
  }
  for (const text of ['检查详情页，有问题直接改']) {
    const recommendation = buildSkillRoutingRecommendation(text, skuRoutingOptions);
    const runtime = resolveAutonomousCapabilityRuntime({
      userTask: text,
      agentIntentControlPlane: buildAutonomousExecutionDecisionForEngine(
        '审计：条件修复不等于文本推荐获得 Runtime owner。'
      ),
      ...(recommendation ? { skillRoutingRecommendation: recommendation } : {})
    }, {});
    if (runtime.runtimeContractStatus.status !== 'no_skill_selected') {
      runtimeSkillHandoffViolations.push(
        `runtime-skill-handoff:conditional-inspection-gained-unconditional-production-obligation:${text}`
      );
    }
  }
  const skuProductionRecommendation = buildSkillRoutingRecommendation(
    '按已确认组合批量出 SKU',
    skuRoutingOptions
  );
  const realSkuCombinationRequest = '请基于当前项目 E:\\WERKE\\C-1245 里的真实产品资料，自主完成 2双、3双、4双 SKU 组合设计。每个规格都要做两种方向：一组偏 INS 风格，一组偏纯色简洁风格；请自行识别项目里的产品信息、颜色和可用素材，缺少源文件或模板时自行创建，不要反复扫描已经看过的素材，不要只给方案或说明，必须在当前 Photoshop 文档中真实写入并导出可核验成品。D:\\A1 neveralone旗舰店 只作为只读验证集，用来判断成品是否接近成熟店铺效果，禁止把其中素材、模板、文案或项目事实作为输入，也禁止向该目录写入。全过程优先复用已观察证据并控制模型调用、图片读取和 token 成本。';
  const explicitProductionProgressCases = [
    '帮我做主图',
    '帮我做 SKU',
    '帮我做详情页',
    '给这个产品做一套详情页',
    '把主图完成',
    '用详情页素材做一版主图',
    '先做主图，再做详情页',
    '可以用这批素材给我出一个主图吗',
    '帮我制作一张促销海报',
    '帮我制作一张商品陈列图',
    '帮我设计一个商品对比页',
    '帮我做一张社交媒体配图',
    '请为新品做一张上市宣传视觉',
    '帮我做一张活动卡片',
    '请为这个品牌做一套品牌启动物料',
    '帮我做一张视觉规范样张',
    '帮我做一套店铺装饰素材',
    '帮我做一个商品展示卡',
    '帮我做一个促销角标',
    '帮我做一张直播间贴片',
    '帮我完成这个设计',
    '请你完成排版工作',
    '我想让你修改现有画面',
    '麻烦你执行这项设计工作',
    '请你生成最终交付稿',
    '帮我重做当前版本',
    '交给你落地这版方案',
    '检查详情页，然后直接改',
    '帮我做主图，如果素材不够就告诉我',
    '把文案改成“安全守护每一天”',
    '创建一个新的空白文档',
    '添加一个红色矩形',
    '帮我绘制一个红色矩形',
    '生成一个新图层',
    '删掉当前图层',
    '存一下当前文档',
    '另存一份',
    '给标题加粗',
    '颜色调成红色',
    '把详情页里的白底图换掉',
    '帮我执行“把标题改成红色”',
    '把字体换成微软雅黑',
    '帮我做一张主图，有什么风险也告诉我',
    '检查详情页，然后无论结果如何都完成新版详情页',
    '帮我修改当前详情页，可以吗？',
    '请帮我做一张主图，行吗？',
    '帮我修改当前详情页，方便吗？',
    '请帮我做一张主图，好不好？',
    '请帮我做一张主图，没问题吧？',
    '帮我做一张主图，可以吧？',
    '帮我把标题换掉，行不行？',
    '请替我完成这版，可以不可以？',
    '麻烦帮我做一张主图，可以么？',
    '帮我做一张主图，你看行吗？',
    '不要用 Photoshop，但可以用图像生成工具，帮我做一张主图',
    realSkuCombinationRequest
  ];
  const nonProductionProgressCases = [
    '你会做主图吗？',
    '主图应该怎么做？',
    '做主图有什么风险？',
    '做一张风险提示海报有什么要求？',
    '你能帮我修改当前详情页吗？',
    '你可以帮我修改当前详情页吗？',
    '你是否愿意帮我修改当前详情页？',
    '你愿不愿意替我保存当前文档？',
    '你有没有办法帮我做一张主图？',
    '保存当前文档可以吗？',
    '删除当前图层可以吗？',
    '帮我制作一个字体搭配方案',
    '帮我分析一下如何完成这个主图',
    '我正在学习做一张详情页',
    '我正在学习做一张社交媒体配图',
    '我喜欢设计一个商品对比页',
    '别人让我做一张详情页',
    '我打算做一张社交媒体配图',
    '我们讨论做一张主图',
    '我想知道如何制作一张商品陈列图',
    '请评价制作一张商品陈列图',
    '制作主图的流程',
    '请评价别人制作的主图',
    '删掉当前图层有什么风险',
    '怎么把标题换掉',
    '不要删除当前图层',
    '我喜欢把背景换掉后的样子',
    '当前文档保存状态',
    '你能完成排版工作吗？',
    '你能落地这版方案吗？',
    '生成三个标题候选',
    '制作三个标题候选',
    '生成三个字体搭配候选',
    '生成三个配色候选',
    '生成三个构图候选',
    '如果我说“不要修改当前文档，另建一张主图”，你会怎么处理？',
    '如果用户说不要修改当前文档而是另建主图，你会怎么做？',
    '你能否执行“不要修改当前文档，另建一张主图”？',
    '不要执行“不要修改当前文档，另建一张主图”',
    '假设要创建主图，权限会怎样？',
    '别误会，我没有委托你做主图',
    '“不要修改当前文档，另建一张主图”这句话是什么意思？',
    '我没有让你删除当前图层',
    '我没让你保存当前文档',
    '并没有要求你做主图',
    '不要真的执行，我只是问：不要修改当前文档，另建主图会怎么处理？',
    '帮我做主图，但不要使用任何工具'
  ];
  const observationProgressCases = [
    '检查详情页',
    '检查详情页，有问题直接改',
    '只检查当前图层，不删除',
    '请视情况修改详情页',
    '帮我在需要时调整详情页',
    '请评审版式，必要时再调整',
    '分析当前画面',
    '判断当前版式是否合理',
    '确认当前文档有没有问题',
    '比较当前两版主图'
  ];
  for (const [expectedObligation, cases] of [
    ['delivery', explicitProductionProgressCases],
    ['observation', observationProgressCases],
    ['none', nonProductionProgressCases]
  ]) {
    cases.forEach((text) => {
      const capabilityConstraint = extractExplicitUserCapabilityConstraint(text);
      const identity = resolveAgentTaskProgressIdentity({
        userInput: text,
        runtimeDecision: buildAutonomousExecutionDecisionForEngine(
          '审计：TaskPlan 进展身份不选择 Skill，也不授予 Tool。'
        ),
        semanticDecision: buildAgentIntentControlPlaneDecision({
          userInput: text,
          hasDocument: true,
          photoshopConnected: true
        }),
        capabilityConstraint
      });
      const expected = expectedObligation !== 'none';
      if (identity.requiresTaskProgress !== expected
        || identity.progressObligation !== expectedObligation) {
        runtimeSkillHandoffViolations.push(
          `task-progress-identity:unexpected-verdict:${expectedObligation}:${text}:${JSON.stringify(identity)}`
        );
      }
    });
  }
  if (resolveAgentTaskSpeechAct('把标题改成“怎么选都好看”').speechAct !== 'explicit_execution'
    || resolveAgentTaskSpeechAct('保存当前文档有什么风险').speechAct !== 'non_execution') {
    runtimeSkillHandoffViolations.push(
      'task-progress-identity:quoted-payload-or-question-speech-act-drifted'
    );
  }
  const nonExecutionAssertionCases = [
    '如果我说“不要修改当前文档，另建一张主图”，你会怎么处理？',
    '“不要修改当前文档，另建一张主图”这句话是什么意思？',
    '我没有让你删除当前图层',
    '我没让你保存当前文档',
    '并没有要求你做主图',
    '不要真的执行，我只是问：不要修改当前文档，另建主图会怎么处理？',
    '如果用户说不要修改当前文档而是另建主图，你会怎么做？',
    '你能否执行“不要修改当前文档，另建一张主图”？',
    '不要执行“不要修改当前文档，另建一张主图”',
    '假设要创建主图，权限会怎样？',
    '别误会，我没有委托你做主图',
    '你可以帮我修改当前详情页吗？',
    '你是否愿意帮我修改当前详情页？',
    '你愿不愿意替我保存当前文档？',
    '你有没有办法帮我做一张主图？'
  ];
  nonExecutionAssertionCases.forEach((text) => {
    const decision = buildAgentIntentControlPlaneDecision({
      userInput: text,
      hasDocument: true,
      photoshopConnected: true
    });
    const constraint = extractExplicitUserCapabilityConstraint(text);
    if (decision.toolScope !== 'none'
      || decision.executionDisposition !== 'non_execution'
      || constraint.toolScopeCeiling !== 'none') {
      runtimeSkillHandoffViolations.push(
        `task-progress-identity:meta-or-denied-assertion-gained-tool-authority:${text}`
      );
    }
  });
  const explicitCapabilityConstraintCases = [
    ['这次别碰任何工具，帮我保存文档', 'none', 'allow', undefined],
    ['no tools，帮我做主图', 'none', 'allow', undefined],
    ['do not use any tools，帮我做主图', 'none', 'allow', undefined],
    ['不允许动用业务工作流 Skill，帮我做一张主图', undefined, 'forbid', undefined],
    ['不要走 Skill，用普通原子工具帮我做主图', undefined, 'forbid', undefined],
    ['不使用 Skill 来完成 SKU', undefined, 'forbid', undefined],
    ['不要碰 PS，帮我生成一张主图', undefined, 'allow', 'photoshop']
  ];
  explicitCapabilityConstraintCases.forEach(([text, expectedCeiling, expectedSkillPolicy, expectedDomain]) => {
    const constraint = extractExplicitUserCapabilityConstraint(text);
    if (constraint.toolScopeCeiling !== expectedCeiling
      || constraint.skillBridgePolicy !== expectedSkillPolicy
      || (expectedDomain && !constraint.deniedToolDomains.includes(expectedDomain))) {
      runtimeSkillHandoffViolations.push(
        `capability-constraint:explicit-deny-relation-drifted:${text}:${JSON.stringify(constraint)}`
      );
    }
  });
  const safetyOperationDenyCases = [
    ['不要删', 'deleteLayer', 'none'],
    ['千万别删当前图层', 'deleteLayer', 'none'],
    ['当前图层别删', 'deleteLayer', 'none'],
    ['我不允许你删除文字层', 'deleteLayer', 'none'],
    ['当前图层别删，帮我改标题', 'deleteLayer', 'delivery'],
    ['我没有让你删图层，而是请你修改标题', 'deleteLayer', 'delivery'],
    ['别把当前图层删掉，只改标题', 'deleteLayer', 'delivery'],
    ['不要真的执行删除图层；现在请你修改标题', 'deleteLayer', 'delivery'],
    ['当前图层不要删除', 'deleteLayer', 'none'],
    ['新文档不要创建', 'createDocument', 'none'],
    ['当前文档不许保存', 'saveDocument', 'none'],
    ['不可以关闭当前文档', 'closeDocument', 'none'],
    ['当前文档不许保存，继续修改标题', 'saveDocument', 'delivery']
  ];
  safetyOperationDenyCases.forEach(([text, deniedToolName, expectedObligation]) => {
    const semanticDecision = buildAgentIntentControlPlaneDecision({
      userInput: text,
      hasDocument: true,
      photoshopConnected: true
    });
    const constraint = extractExplicitUserCapabilityConstraint(text);
    const identity = resolveAgentTaskProgressIdentity({
      userInput: text,
      runtimeDecision: buildAutonomousExecutionDecisionForEngine(
        '审计：危险原子动作 deny 只收窄能力，不反向签执行义务。'
      ),
      semanticDecision,
      capabilityConstraint: constraint
    });
    if (!constraint.deniedProviderToolNames.includes(deniedToolName)
      || identity.progressObligation !== expectedObligation
      || (expectedObligation === 'none' && constraint.toolScopeCeiling !== 'none')) {
      runtimeSkillHandoffViolations.push(
        `capability-constraint:safety-operation-deny-drifted:${text}:${JSON.stringify({ constraint, identity })}`
      );
    }
  });
  const openSkuDesignRecommendation = buildSkillRoutingRecommendation(
    realSkuCombinationRequest,
    skuRoutingOptions
  );
  const authoritativeSkuProductionRecommendation = buildSkillRoutingRecommendation(
    '按用户确认过的组合表批量导出 SKU 组合图',
    skuRoutingOptions
  );
  const bareSkuExecutionRecommendation = buildSkillRoutingRecommendation(
    '帮我做 SKU',
    skuRoutingOptions
  );
  const skuTemplateExecutionRecommendation = buildSkillRoutingRecommendation(
    '设计一套 SKU 模板',
    skuRoutingOptions
  );
  const skuColorCardExecutionRecommendation = buildSkillRoutingRecommendation(
    '做一个 SKU 色卡',
    skuRoutingOptions
  );
  const skuReadOnlyRecommendation = buildSkillRoutingRecommendation(
    '帮我检查SKU有哪些颜色',
    skuRoutingOptions
  );
  const skuReadOnlyAndPlanningRecommendations = [
    '帮我做个SKU分析',
    '做一下SKU素材盘点',
    '做个SKU模板检查',
    '帮我做SKU可行性评估',
    '帮我做SKU规划，只给建议',
    '帮我做SKU怎么做的说明'
  ].map((text) => buildSkillRoutingRecommendation(text, skuRoutingOptions));
  const realSkuEngineDecision = buildAutonomousExecutionDecisionForEngine(
    'business-audit:real-sku-production-request'
  );
  const planNeutralSkuCapabilityRuntime = resolveAutonomousCapabilityRuntime({
    agentIntentControlPlane: realSkuEngineDecision,
    skillRoutingRecommendation: authoritativeSkuProductionRecommendation
  }, {});
  const skillFreeSkuConstraint = extractExplicitUserCapabilityConstraint(
    '不使用 Skill 来完成 SKU'
  );
  const skillFreeSkuCapabilityRuntime = resolveAutonomousCapabilityRuntime({
    agentIntentControlPlane: realSkuEngineDecision,
    skillRoutingRecommendation: authoritativeSkuProductionRecommendation,
    skillBridgePolicy: skillFreeSkuConstraint.skillBridgePolicy,
    agentCapabilityConstraint: skillFreeSkuConstraint
  }, {});
  const defaultSkuResolution = planNeutralSkuCapabilityRuntime.capabilitySession.getResolution();
  const skillFreeSkuSession = skillFreeSkuCapabilityRuntime.capabilitySession;
  const skillFreeSkuBefore = skillFreeSkuSession.getResolution();
  const internalSkuCapabilityId = skillFreeSkuSession.inventory.find((entry) => (
    entry.kind === 'tool' && entry.providerToolNames.includes('skuLayout')
  ))?.capabilityId;
  const skillFreeSkuActivation = internalSkuCapabilityId
    ? skillFreeSkuSession.requestCapabilities([internalSkuCapabilityId])
    : undefined;
  const skillFreeSkuAfter = skillFreeSkuSession.getResolution();
  const internalSkuToolNames = getSkillInternalToolNames();
  const filenameOnlyArtifactRole = buildSkuColorCardSourceReceipt({
    documentName: 'SKU.psb',
    documentId: 41,
    observedColorNames: []
  });
  const observedColorCardRole = buildSkuColorCardSourceReceipt({
    documentName: 'SKU.psb',
    documentId: 41,
    filePath: 'E:/project/PSD/SKU.psb',
    projectRelativePath: 'PSD/SKU.psb',
    observedColorNames: ['黑色', '奶白', '黑色']
  });
  if (skillFreeSkuConstraint.skillBridgePolicy !== 'forbid'
    || getSkillInternalToolOwnerIds('skuLayout').join(',') !== 'sku-batch'
    || !internalSkuToolNames.includes('skuLayout')
    || !isSkillProviderInteractionOwner('sku-batch')
    || !internalSkuCapabilityId
    || defaultSkuResolution.selectedToolNames.includes('skuLayout')
    || defaultSkuResolution.onDemandCapabilityIds.includes(internalSkuCapabilityId)
    || !skillFreeSkuBefore.onDemandCapabilityIds.includes(internalSkuCapabilityId)
    || skillFreeSkuBefore.selectedCapabilityIds.some((capabilityId) => capabilityId.startsWith('skill.'))
    || skillFreeSkuActivation?.status !== 'activated'
    || !skillFreeSkuAfter.selectedToolNames.includes('skuLayout')
    || filenameOnlyArtifactRole !== undefined
    || observedColorCardRole?.role !== 'color_card_source'
    || observedColorCardRole?.lifecycle?.mutationPolicy !== 'read_only_source'
    || observedColorCardRole?.evidence?.observedColorCount !== 2
    || !skuBatchExecutorText.includes('skuArtifactRoles.push(skuColorCardSourceReceipt)')) {
    skuAutonomousTemplateViolations.push(
      'sku-boundary:default-owner-isolation-or-explicit-skill-free-atomic-path-drifted'
    );
  }
  const skuContinuationCapabilityRuntime = resolveAutonomousCapabilityRuntime({
    agentIntentControlPlane: realSkuEngineDecision,
    skillRoutingRecommendation: authoritativeSkuProductionRecommendation
  }, {});
  const skuContinuationSession = skuContinuationCapabilityRuntime.capabilitySession;
  const skuBatchManifest = manifests.find((manifest) => manifest.skill_id === 'ecommerce.sku_batch');
  if (skuBatchManifest) {
    skuContinuationSession.bindManifest(skuBatchManifest);
  } else {
    skuAutonomousTemplateViolations.push('sku-template:sku-batch-manifest-missing-before-continuation-activation');
  }
  const skuContinuationBefore = skuContinuationSession.getResolution();
  const declaredContinuationToolNames = new Set(projectedTemplateRecoveryToolNames);
  const expectedContinuationCapabilityIds = skuContinuationSession.inventory
    .filter((entry) => (
      entry.kind === 'tool'
      && skuContinuationBefore.onDemandCapabilityIds.includes(entry.capabilityId)
      && entry.providerToolNames.some((toolName) => declaredContinuationToolNames.has(toolName))
    ))
    .map((entry) => entry.capabilityId);
  const activatedContinuationCapabilityIds = skuContinuationSession
    .activateToolsForContinuation(projectedTemplateRecoveryToolNames);
  const skuContinuationAfter = skuContinuationSession.getResolution();
  const projectedToolsReachableBeforeActivation = projectedTemplateRecoveryToolNames.every((toolName) => (
    skuContinuationBefore.selectedToolNames.includes(toolName)
    || skuContinuationSession.inventory.some((entry) => (
      entry.kind === 'tool'
      && entry.providerToolNames.includes(toolName)
      && skuContinuationBefore.onDemandCapabilityIds.includes(entry.capabilityId)
    ))
  ));
  const criticalTemplateRecoveryTools = [
    'switchDocument',
    'createDocument',
    'createSkuPlaceholders',
    'transformLayer',
    'saveDocument',
    'getAcceptanceSnapshot'
  ];
  const skuLayoutCapability = skuContinuationSession.inventory.find((entry) => (
    entry.kind === 'tool'
    && entry.capabilityId === 'photoshop.write.skuLayout'
    && entry.providerToolNames.includes('skuLayout')
  ));
  const hasBoundSkuManifestIdentity = Boolean(
    skuBatchManifest
    && skuContinuationBefore.manifestRef?.skillId === 'ecommerce.sku_batch'
    && skuContinuationBefore.manifestRef?.version === skuBatchManifest.version
    && skuContinuationBefore.manifestRef?.taskType === 'ecommerce.sku_batch.v1'
  );
  if (!hasBoundSkuManifestIdentity
    || readAgentReActRecoveryToolNames(rawTemplateHandoffResult).length !== 0
    || expectedContinuationCapabilityIds.length === 0
    || !projectedToolsReachableBeforeActivation
    || !expectedContinuationCapabilityIds.every((capabilityId) => (
      activatedContinuationCapabilityIds.includes(capabilityId)
      && skuContinuationAfter.selectedCapabilityIds.includes(capabilityId)
    ))
    || !projectedTemplateRecoveryToolNames.every((toolName) => (
      skuContinuationAfter.selectedToolNames.includes(toolName)
    ))
    || !criticalTemplateRecoveryTools.every((toolName) => (
      skuContinuationAfter.selectedToolNames.includes(toolName)
    ))
    || skuContinuationBefore.selectedToolNames.includes('skuLayout')
    || !skuLayoutCapability
    || !skuContinuationBefore.onDemandCapabilityIds.includes(skuLayoutCapability.capabilityId)
    || !activatedContinuationCapabilityIds.includes(skuLayoutCapability.capabilityId)
    || !skuContinuationAfter.selectedToolNames.includes('skuLayout')
    || skuContinuationAfter.selectedToolNames.includes('deleteLayer')) {
    skuAutonomousTemplateViolations.push('sku-template:skill-continuation-did-not-expose-declared-atomic-tools');
  }
  if (!/activateToolsForContinuation\(\s*readAgentReActRecoveryToolNames\(result\)\s*\)/s.test(executorText)
    || executorText.includes('readSkillContinuationToolNames')) {
    skuAutonomousTemplateViolations.push('workflow-continuation:production-reader-to-capability-session-wiring-drifted');
  }
  const planNeutralSkuActiveToolsIdentity = planNeutralSkuCapabilityRuntime.capabilitySession.activeTools;
  const planNeutralSkuResolution = planNeutralSkuCapabilityRuntime.capabilitySession.getResolution();
  const planNeutralSkuActivationAttempt = planNeutralSkuCapabilityRuntime.capabilitySession
    .requestCapabilities(['skill.sku-batch']);
  if (skuBatchManifest) {
    planNeutralSkuCapabilityRuntime.capabilitySession.bindManifest(skuBatchManifest);
  }
  const boundSkuResolution = planNeutralSkuCapabilityRuntime.capabilitySession.getResolution();
  const boundSkuActiveSkillCapabilities = boundSkuResolution.selectedCapabilityIds.filter(
    (capabilityId) => capabilityId.startsWith('skill.')
  );
  const manifestSkillOwnerBehavior = manifests.map((manifest) => {
    const runtime = resolveAutonomousCapabilityRuntime({
      agentIntentControlPlane: realSkuEngineDecision,
      skillRoutingRecommendation: authoritativeSkuProductionRecommendation
    }, {});
    const session = runtime.capabilitySession;
    const activeToolsIdentity = session.activeTools;
    session.bindManifest(manifest);
    const bound = session.getResolution();
    const expectedOwners = Array.from(new Set(
      (manifest.workflow_entry_skill_ids || []).map((id) => `skill.${id}`)
    )).sort();
    const selectedSkills = bound.selectedCapabilityIds
      .filter((id) => id.startsWith('skill.'))
      .sort();
    const onDemandSkills = bound.onDemandCapabilityIds
      .filter((id) => id.startsWith('skill.'));
    const wrongSkill = session.inventory.find((entry) => (
      entry.kind === 'skill' && !expectedOwners.includes(entry.capabilityId)
    ))?.capabilityId;
    const wrongAttempt = wrongSkill
      ? session.requestCapabilities([wrongSkill])
      : undefined;
    const declareAttempt = session.requestCapabilities(['agent.intent.declareDesignTask']);
    session.bindManifest(manifest);
    const rebound = session.getResolution();
    const reboundSkills = rebound.selectedCapabilityIds
      .filter((id) => id.startsWith('skill.'))
      .sort();

    return {
      taskType: manifest.task_type,
      ok: session.activeTools === activeToolsIdentity
        && JSON.stringify(selectedSkills) === JSON.stringify(expectedOwners)
        && onDemandSkills.length === 0
        && !bound.onDemandCapabilityIds.includes('agent.intent.declareDesignTask')
        && (!wrongSkill || (wrongAttempt?.status === 'rejected'
          && wrongAttempt.issues.some((issue) => (
            issue.code === 'requested_capability_forbidden'
            && issue.capabilityId === wrongSkill
          ))))
        && declareAttempt.status === 'rejected'
        && declareAttempt.issues.some((issue) => (
          issue.code === 'requested_capability_forbidden'
          && issue.capabilityId === 'agent.intent.declareDesignTask'
        ))
        && JSON.stringify(reboundSkills) === JSON.stringify(expectedOwners)
        && !session.getOnDemandActivatedCapabilityIds().some((id) => (
          id.startsWith('skill.')
          || id === 'agent.intent.declareDesignTask'
        ))
    };
  });
  const sharedTemplateSelectionCandidates = [
    {
      id: 'user-3-tif',
      name: '3双装.tif',
      filePath: 'D:/templates/3双装.tif',
      source: 'local-library',
      sourcePriority: 0
    },
    {
      id: 'generated-3-v4',
      name: '3双卡片模板v4.psb',
      filePath: 'D:/templates/3双卡片模板v4.psb',
      source: 'local-library',
      sourcePriority: 0
    },
    {
      id: 'user-4-psd',
      name: '4双装.psd',
      filePath: 'D:/templates/4双装.psd',
      source: 'local-library',
      sourcePriority: 2
    },
    {
      id: 'note-3-psd',
      name: '3双装自选备注.psd',
      filePath: 'D:/templates/3双装自选备注.psd',
      source: 'local-library',
      sourcePriority: 1
    }
  ];
  const selectedSharedUserTemplate = pickBestSkuTemplateCandidate(
    sharedTemplateSelectionCandidates,
    { comboSize: 3, noteMode: false }
  );
  const selectedSharedNoteTemplate = pickBestSkuTemplateCandidate(
    sharedTemplateSelectionCandidates,
    { comboSize: 3, noteMode: true }
  );
  const selectedSharedPriorityTemplate = pickBestSkuTemplateCandidate([
    {
      id: 'lower-priority',
      name: '3双装-a.tif',
      filePath: 'D:/second/3双装-a.tif',
      source: 'local-library',
      sourcePriority: 2
    },
    {
      id: 'higher-priority',
      name: '3双装-b.tif',
      filePath: 'D:/first/3双装-b.tif',
      source: 'local-library',
      sourcePriority: 0
    }
  ], { comboSize: 3, noteMode: false });
  const unknownSizeTemplate = pickBestSkuTemplateCandidate([{
    id: 'unknown-800-psd',
    name: '800.psd',
    filePath: 'D:/templates/800.psd',
    source: 'local-library',
    sourcePriority: 0
  }], { comboSize: 2, noteMode: false });
  const oldRejectedSkuTemplateCandidate = {
    id: 'old-broken-3',
    name: '3双装卡片模板.psd',
    filePath: 'E:/project/模板文件/3双装卡片模板.psd',
    source: 'project-folder',
    sourcePriority: 0
  };
  const savedDesignEchoSkuTemplateCandidate = {
    id: 'generated-candidate-3',
    name: '3双装-DesignEcho候选.psb',
    filePath: 'E:/project/模板文件/3双装-DesignEcho候选.psb',
    source: 'project-folder',
    sourcePriority: 0
  };
  const validatedSavedSkuTemplateCandidate = validateDesignEchoSkuTemplateCandidate({
    candidate: savedDesignEchoSkuTemplateCandidate,
    openedDocument: {
      id: 73,
      path: 'E:\\project\\模板文件\\3双装-DesignEcho候选.psb'
    },
    expectedItemCount: 3,
    runtimeInspection: {
      schema: 'sku-template-layout-inspection/v3',
      historyStateRef: { documentId: 73, historyStateId: 108 }
    },
    preflight: {
      expectedItemCount: 3,
      skuPlaceholderInspectionStatus: 'inspected',
      hasReliableSkuPlaceholders: true,
      layoutPlan: { status: 'ready' }
    },
    contentConsistencyStatus: 'consistent',
    hasContentRepairProposal: false
  });
  const preferredValidatedSavedSkuTemplate = pickSkuTemplateCandidateWithValidatedGeneratedPriority({
    generatedCandidates: [{
      candidate: savedDesignEchoSkuTemplateCandidate,
      validation: validatedSavedSkuTemplateCandidate
    }],
    fallbackCandidate: oldRejectedSkuTemplateCandidate
  });
  const rejectedSavedSkuTemplateCandidate = validateDesignEchoSkuTemplateCandidate({
    candidate: savedDesignEchoSkuTemplateCandidate,
    openedDocument: {
      id: 73,
      path: 'E:/project/模板文件/3双装-DesignEcho候选.psb'
    },
    expectedItemCount: 3,
    runtimeInspection: null,
    preflight: {
      expectedItemCount: 3,
      skuPlaceholderInspectionStatus: 'unknown',
      hasReliableSkuPlaceholders: undefined
    },
    readError: 'inspectTemplateLayout failed'
  });
  const failedSavedCandidateFallback = pickSkuTemplateCandidateWithValidatedGeneratedPriority({
    generatedCandidates: [{
      candidate: savedDesignEchoSkuTemplateCandidate,
      validation: rejectedSavedSkuTemplateCandidate
    }],
    fallbackCandidate: oldRejectedSkuTemplateCandidate
  });
  const failedSavedCandidateBlock = pickSkuTemplateCandidateWithValidatedGeneratedPriority({
    generatedCandidates: [{
      candidate: savedDesignEchoSkuTemplateCandidate,
      validation: rejectedSavedSkuTemplateCandidate
    }],
    fallbackCandidate: null
  });
  const sharedSkuTemplateScorerStart = skuTemplateSelectionText.indexOf(
    'export function pickBestSkuTemplateCandidate'
  );
  const sharedSkuTemplateScorerEnd = skuTemplateSelectionText.indexOf(
    'export function collectSkuTemplateSizes',
    sharedSkuTemplateScorerStart
  );
  const sharedSkuTemplateScorerText = sharedSkuTemplateScorerStart >= 0
    && sharedSkuTemplateScorerEnd > sharedSkuTemplateScorerStart
    ? skuTemplateSelectionText.slice(sharedSkuTemplateScorerStart, sharedSkuTemplateScorerEnd)
    : '';
  const setTextContentSchemaStart = toolSchemasText.indexOf("name: 'setTextContent'");
  const setTextContentSchemaEnd = toolSchemasText.indexOf("name: 'getTextStyle'", setTextContentSchemaStart);
  const setTextContentSchemaText = setTextContentSchemaStart >= 0 && setTextContentSchemaEnd > setTextContentSchemaStart
    ? toolSchemasText.slice(setTextContentSchemaStart, setTextContentSchemaEnd)
    : '';
  const failedSkuTemplateInspectionPreflight = buildSkuTemplateLayoutPreflightFromRuntimeInspection({
    templateDoc: { id: 21, name: '2双装.psb' },
    inspection: null,
    expectedItemCount: 2
  });
  const explicitlyUnreliableSkuTemplateInspectionPreflight = buildSkuTemplateLayoutPreflightFromRuntimeInspection({
    templateDoc: { id: 21, name: '2双装.psb' },
    inspection: {
      schema: 'sku-template-layout-inspection/v3',
      hasReliableInspection: false,
      historyStateRef: { documentId: 21, historyStateId: 7 },
      mode: 'ordered_slots',
      slotCount: 2,
      blockers: [],
      warnings: []
    },
    expectedItemCount: 2
  });
  const failedInspectionAggregateDecision = buildSkuTemplateAggregatePreflightDecision({
    inspectionStatuses: [failedSkuTemplateInspectionPreflight.skuPlaceholderInspectionStatus],
    terminalBlockerCount: 0,
    layoutRepairTargetCount: 1,
    contentRepairTargetKeys: ['combo:2:2双装.psb']
  });
  const laterTerminalTemplateAggregateDecision = buildSkuTemplateAggregatePreflightDecision({
    inspectionStatuses: ['inspected', 'inspected'],
    terminalBlockerCount: 1,
    layoutRepairTargetCount: 0,
    contentRepairTargetKeys: ['combo:2:2双装.psb']
  });
  const skuReadOnlyTemplatePreflightStart = skuBatchExecutorText.indexOf(
    'const preflightSkuTemplateLayout = async'
  );
  const skuDeferredContentRepairStart = skuBatchExecutorText.indexOf(
    'const applySkuTemplateContentRepairAfterAggregatePreflight = async',
    skuReadOnlyTemplatePreflightStart
  );
  const skuReadOnlyTemplatePreflightText = skuReadOnlyTemplatePreflightStart >= 0
    && skuDeferredContentRepairStart > skuReadOnlyTemplatePreflightStart
    ? skuBatchExecutorText.slice(skuReadOnlyTemplatePreflightStart, skuDeferredContentRepairStart)
    : '';
  const skuAggregateTerminalBlockStart = skuBatchExecutorText.indexOf(
    'if (terminalTemplateLayouts.length > 0)',
    skuDeferredContentRepairStart
  );
  const skuDeferredContentRepairExecutionStart = skuBatchExecutorText.indexOf(
    'for (const repairTarget of deferredTemplateContentRepairs)',
    skuAggregateTerminalBlockStart
  );
  const skuConsistencyViolations = [
    ...(failedSkuTemplateInspectionPreflight.skuPlaceholderInspectionStatus === 'unknown'
      && failedSkuTemplateInspectionPreflight.skuPlaceholderReliability === 'unknown'
      && failedSkuTemplateInspectionPreflight.layoutPlan === undefined
      && failedInspectionAggregateDecision.status === 'blocked_unreliable_inspection'
      && failedInspectionAggregateDecision.executableContentRepairTargetKeys.length === 0
      && failedInspectionAggregateDecision.boundaries.writesPhotoshop === false
      && failedInspectionAggregateDecision.boundaries.grantsPermission === false
      ? []
      : ['sku-consistency:failed-inspection-authorized-mutation-or-repair-handoff']),
    ...(explicitlyUnreliableSkuTemplateInspectionPreflight.skuPlaceholderInspectionStatus === 'unknown'
      && explicitlyUnreliableSkuTemplateInspectionPreflight.layoutPlan === undefined
      && explicitlyUnreliableSkuTemplateInspectionPreflight.hasReliableSkuPlaceholders === undefined
      ? []
      : ['sku-consistency:explicitly-unreliable-inspection-became-inspected']),
    ...(laterTerminalTemplateAggregateDecision.status === 'blocked_terminal_template'
      && laterTerminalTemplateAggregateDecision.executableContentRepairTargetKeys.length === 0
      ? []
      : ['sku-consistency:earlier-repair-target-mutated-before-later-terminal-template']),
    ...(repairableSkuTemplateConsistency.report.status === 'conflict'
      && repairableSkuTemplateProposal?.layerId === 11
      && repairableSkuTemplateProposal.previousContent === '限量 4双装 组合'
      && repairableSkuTemplateProposal.replacementContent === '限量 3双装 组合'
      && repairableSkuTemplateProposal.boundaries.selectsTool === false
      && repairableSkuTemplateProposal.boundaries.writesPhotoshop === false
      && repairableSkuTemplateProposal.boundaries.grantsPermission === false
      ? []
      : ['sku-consistency:single-text-conflict-not-safely-repairable']),
    ...(structuralSkuTemplateConflict.report.status === 'conflict'
      && structuralSkuTemplateConflict.report.checks[0]?.repairEligibility?.status === 'ineligible'
      && structuralSkuTemplateConflict.report.checks[0]?.repairEligibility?.reason === 'multiple_conflicting_observations'
      && buildSkuTemplatePackCountRepairProposal(structuralSkuTemplateConflict) === undefined
      ? []
      : ['sku-consistency:structure-and-text-conflict-was-reduced-to-text-repair']),
    ...(filenameOnlySkuTemplateWarning.report.status === 'warning'
      && buildSkuTemplatePackCountRepairProposal(filenameOnlySkuTemplateWarning) === undefined
      ? []
      : ['sku-consistency:filename-drift-became-photoshop-write-gate']),
    ...(noPackTextSkuTemplateConsistency.report.status === 'consistent'
      ? []
      : ['sku-consistency:no-pack-text-template-was-treated-as-missing-observation']),
    ...(revisionlessSkuTemplateConsistency.report.status === 'invalid_input'
      && buildSkuTemplatePackCountRepairProposal(revisionlessSkuTemplateConsistency) === undefined
      ? []
      : ['sku-consistency:revisionless-observation-produced-repair']),
    ...(legacyRegionSkuTemplateConsistency.report.status === 'conflict'
      && legacyRegionSkuTemplateConsistency.slotCount === undefined
      && legacyRegionSkuTemplateProposal?.replacementContent === '限量 3双装 组合'
      ? []
      : ['sku-consistency:legacy-region-count-was-misread-as-item-count-or-lost-text-repair']),
    ...(!isDeterministicConsistencyReportFresh(repairableSkuTemplateConsistency.report, {
      targetRef: 'photoshop-document:71',
      revisionRef: 'photoshop-history:102'
    })
      ? []
      : ['sku-consistency:old-report-remained-fresh-after-history-change']),
    ...(oldSchemaSkuTemplateConsistency.applicable === true
      && oldSchemaSkuTemplateConsistency.evidenceCompleteness.inspectionSchemaCompatible === false
      && oldSchemaSkuTemplateConsistency.report.status === 'needs_observation'
      && buildSkuTemplatePackCountRepairProposal(oldSchemaSkuTemplateConsistency) === undefined
      ? []
      : ['sku-consistency:old-inspection-schema-silently-passed-without-text-evidence']),
    ...(truncatedSkuTemplateConsistency.report.status === 'needs_observation'
      && truncatedSkuTemplateConsistency.evidenceCompleteness.textObservationsComplete === false
      && buildSkuTemplatePackCountRepairProposal(truncatedSkuTemplateConsistency) === undefined
      ? []
      : ['sku-consistency:truncated-text-evidence-became-repairable']),
    ...(multiplePackCountsInOneLayer.report.status === 'conflict'
      && buildSkuTemplatePackCountRepairProposal(multiplePackCountsInOneLayer) === undefined
      ? []
      : ['sku-consistency:ambiguous-multiple-count-text-became-repairable']),
    ...(hiddenPackCountSkuTemplateConsistency.report.status === 'consistent'
      && hiddenPackCountSkuTemplateConsistency.textEvidence.length === 0
      && buildSkuTemplatePackCountRepairProposal(hiddenPackCountSkuTemplateConsistency) === undefined
      ? []
      : ['sku-consistency:hidden-pack-count-text-affected-visible-design-facts']),
    ...(deterministicConsistencyText.includes('不授予权限')
      && skuTemplateContentConsistencyText.includes('selectsTool: false')
      && skuTemplateContentConsistencyText.includes('writesPhotoshop: false')
      && skuTemplateContentConsistencyText.includes('grantsPermission: false')
      ? []
      : ['sku-consistency:pure-contract-boundary-missing']),
    ...(skuBatchExecutorText.includes('verifySkuTemplateContentConsistency({')
      && skuBatchExecutorText.includes('buildSkuTemplatePackCountRepairProposal(contentEvaluation)')
      && skuBatchExecutorText.includes("repairProposal = inspected.preflight.layoutPlan?.status === 'ready'")
      && skuBatchExecutorText.includes('expectedCurrentContent: repairProposal.previousContent')
      && skuBatchExecutorText.includes('expectedHistoryStateRef: runtimeInspection.historyStateRef')
      && skuBatchExecutorText.includes("structureRepresentsItemCount: inspected.runtimeInspection?.mode === 'ordered_slots'")
      && skuBatchExecutorText.includes('postRepairTemplate = await preflightSkuTemplateLayout({')
      && skuBatchExecutorText.includes('buildSkuTemplateAggregatePreflightDecision({')
      && skuReadOnlyTemplatePreflightText.length > 0
      && !skuReadOnlyTemplatePreflightText.includes("'setTextContent'")
      && skuAggregateTerminalBlockStart >= 0
      && skuDeferredContentRepairExecutionStart > skuAggregateTerminalBlockStart
      && !skuBatchExecutorText.includes('skuTemplateLayoutPreflightCache')
      ? []
      : ['sku-consistency:executor-readonly-aggregate-preflight-or-repair-readback-chain-incomplete']),
    ...(uxpSkuLayoutText.includes("schema: 'sku-template-layout-inspection/v3'")
      && uxpSkuLayoutText.includes('historyStateRef')
      && uxpSkuLayoutText.includes('textObservations')
      && uxpSkuLayoutText.includes('contentsTruncated')
      && setTextContentSchemaText.includes('expectedCurrentContent')
      && setTextContentSchemaText.includes('expectedDocumentId')
      && setTextContentSchemaText.includes('expectedHistoryStateRef')
      && uxpSetTextContentText.includes('expectedCurrentContent')
      && uxpSetTextContentText.includes('expectedDocumentId')
      && uxpSetTextContentText.includes('expectedHistoryStateRef')
      && uxpSetTextContentText.includes('sameHistoryStateRef(')
      && setTextTargetPreconditionBoundaryComplete
      && uxpSetTextContentText.includes('已取消这次过期写入')
      ? []
      : ['sku-consistency:uxp-versioned-observation-or-compare-and-set-missing'])
  ];
  const skuPlaceholderFixtureInspection = await inspectSkuTemplateFixtureWithMockHost(
    uxpSkuLayoutPath,
    {
      id: 7701,
      name: 'sku-placeholder-boundary-audit.psb',
      width: 1000,
      height: 1000,
      activeHistoryState: { id: 8801 },
      layers: [
        {
          id: 101,
          name: '形状参考',
          kind: 'solidColorLayer',
          bounds: { left: 100, top: 150, right: 400, bottom: 850 },
          visible: true
        },
        {
          id: 102,
          name: '3',
          kind: 'group',
          bounds: { left: 0, top: 0, right: 1000, bottom: 1000 },
          visible: true,
          layers: [{
            id: 103,
            name: '数字装饰',
            kind: 'pixelLayer',
            bounds: { left: 20, top: 20, right: 980, bottom: 180 },
            visible: true
          }]
        }
      ]
    },
    1
  );
  const numericRegionSkuInspection = await inspectSkuTemplateFixtureWithMockHost(
    uxpSkuLayoutPath,
    {
      id: 7702,
      name: '4双装-numeric-region-audit.tif',
      width: 800,
      height: 800,
      activeHistoryState: { id: 8802 },
      layers: [
        {
          id: 201,
          name: '2',
          kind: 'solidColor',
          bounds: { left: 15, top: 15, right: 785, bottom: 395 },
          visible: false
        },
        {
          id: 202,
          name: '1',
          kind: 'solidColor',
          bounds: { left: 15, top: 405, right: 265, bottom: 785 },
          visible: false
        },
        {
          id: 203,
          name: '3',
          kind: 'group',
          bounds: { left: 0, top: 0, right: 800, bottom: 800 },
          visible: true,
          layers: [{
            id: 204,
            name: '数字装饰',
            kind: 'pixelLayer',
            bounds: { left: 0, top: 0, right: 800, bottom: 180 },
            visible: true
          }]
        }
      ]
    },
    4
  );
  const numericRegionSkuPreflight = buildSkuTemplateLayoutPreflightFromRuntimeInspection({
    templateDoc: { id: 7702, name: '4双装-numeric-region-audit.tif' },
    inspection: numericRegionSkuInspection?.data,
    expectedItemCount: 4
  });
  const readTerminalSkuLayerCleanupFailure = loadStandaloneAuditFunction(
    terminalSkuLayerCleanupFailureReaderText,
    'readTerminalSkuLayerCleanupFailure',
    skuBatchExecutorPath
  );
  const terminalSkuLayerCleanupFailureFixture = {
    success: true,
    data: {
      exportedCount: 1,
      exportedFiles: ['不得进入外层交付.jpg'],
      cleanupFailure: {
        schema: 'sku-layer-cleanup-failure/v1',
        reason: 'sku_layer_cleanup_not_confirmed',
        documentId: 7101,
        pendingLayerIds: [901],
        failures: [{ layerId: 901, stage: 'delete', message: 'Photoshop 返回错误描述符。' }]
      }
    }
  };
  const detectedTerminalSkuLayerCleanupFailure = readTerminalSkuLayerCleanupFailure?.(
    terminalSkuLayerCleanupFailureFixture
  );
  const ignoredNonCleanupFailure = readTerminalSkuLayerCleanupFailure?.({
    success: false,
    data: {
      cleanupFailure: {
        schema: 'unrelated-failure/v1',
        reason: 'unrelated_failure'
      }
    }
  });
  const skuDeleteErrorDescriptorAudit = await exerciseSkuDeleteHelper(
    uxpSkuLayoutPath,
    'error_descriptor'
  );
  const skuDeleteSuccessAudit = await exerciseSkuDeleteHelper(
    uxpSkuLayoutPath,
    'success'
  );
  const skuDeleteNoEffectAudit = await exerciseSkuDeleteHelper(
    uxpSkuLayoutPath,
    'no_effect'
  );
  const skuResizeDomAudit = await exerciseSkuMutationHelper(
    uxpSkuLayoutPath,
    'resize',
    'dom'
  );
  const skuResizeFallbackAudit = await exerciseSkuMutationHelper(
    uxpSkuLayoutPath,
    'resize',
    'fallback_transform'
  );
  const skuResizeSelectErrorAudit = await exerciseSkuMutationHelper(
    uxpSkuLayoutPath,
    'resize',
    'select_error'
  );
  const skuResizeTransformErrorAudit = await exerciseSkuMutationHelper(
    uxpSkuLayoutPath,
    'resize',
    'transform_error'
  );
  const skuTranslateDomAudit = await exerciseSkuMutationHelper(
    uxpSkuLayoutPath,
    'translate',
    'dom'
  );
  const skuTranslateSelectErrorAudit = await exerciseSkuMutationHelper(
    uxpSkuLayoutPath,
    'translate',
    'select_error'
  );
  const skuAutoLayoutApplicationPlan = buildSkuBoundedRegionLayoutPlan({
    region: {
      left: 200,
      top: 120,
      right: 500,
      bottom: 720,
      width: 300,
      height: 600
    },
    items: [{
      id: 'sku-live-write-readback-audit',
      layerId: 903,
      name: '实时写后读回审计色卡',
      bounds: {
        left: 0,
        top: 0,
        right: 100,
        bottom: 200,
        width: 100,
        height: 200
      }
    }]
  });
  const skuAutoLayoutApplySuccessAudit = await exerciseSkuAutoLayoutApplication(
    uxpSkuLayoutPath,
    skuAutoLayoutApplicationPlan,
    'success'
  );
  const skuAutoLayoutScaleNoopAudit = await exerciseSkuAutoLayoutApplication(
    uxpSkuLayoutPath,
    skuAutoLayoutApplicationPlan,
    'scale_silent_noop'
  );
  const skuAutoLayoutTranslateNoopAudit = await exerciseSkuAutoLayoutApplication(
    uxpSkuLayoutPath,
    skuAutoLayoutApplicationPlan,
    'translate_silent_noop'
  );
  const legacyExecuteOneAudit = await exerciseSkuLayoutActionWithMockHost(
    uxpSkuLayoutPath,
    { action: 'executeOne', templateIndex: 0, config: {} }
  );
  const legacyExecuteBatchAudit = await exerciseSkuLayoutActionWithMockHost(
    uxpSkuLayoutPath,
    { action: 'executeBatch', config: { items: [] } }
  );
  const skuLayoutCapabilitiesAudit = await exerciseSkuLayoutActionWithMockHost(
    uxpSkuLayoutPath,
    { action: 'getCapabilities' }
  );
  const skuParseConfigAudit = await exerciseSkuLayoutActionWithMockHost(
    uxpSkuLayoutPath,
    { action: 'parseConfig' }
  );
  const buildColorAliasEntriesForAudit = skuColorResolutionFunctions.buildColorAliasEntries;
  const resolveColorTokenForAudit = skuColorResolutionFunctions.resolveColorToken;
  const overlappingWhiteAliases = typeof buildColorAliasEntriesForAudit === 'function'
    ? buildColorAliasEntriesForAudit(['白', '奶白'])
    : [];
  const singleMilkWhiteAlias = typeof buildColorAliasEntriesForAudit === 'function'
    ? buildColorAliasEntriesForAudit(['奶白'])
    : [];
  const skuColorResolutionAudit = typeof resolveColorTokenForAudit === 'function'
    ? {
      exactMilkWhite: resolveColorTokenForAudit('奶白', overlappingWhiteAliases),
      colorSuffixMilkWhite: resolveColorTokenForAudit('奶白色', overlappingWhiteAliases),
      ambiguousWhite: resolveColorTokenForAudit('奶白偏白', overlappingWhiteAliases),
      uniqueFuzzyWhite: resolveColorTokenForAudit('偏白', overlappingWhiteAliases),
      uniqueFuzzyMilkWhite: resolveColorTokenForAudit('偏奶白', singleMilkWhiteAlias)
    }
    : null;
  const boundedSkuRegion = {
    left: 100,
    top: 80,
    right: 900,
    bottom: 620,
    width: 800,
    height: 540
  };
  const boundedSkuSourceSizes = [
    { width: 240, height: 360 },
    { width: 220, height: 330 },
    { width: 180, height: 400 },
    { width: 260, height: 390 }
  ];
  const boundedSkuItems = boundedSkuSourceSizes.map((size, index) => ({
    id: `sku-card-${index + 1}`,
    layerId: index + 101,
    name: `色卡${index + 1}`,
    bounds: {
      left: 0,
      top: 0,
      right: size.width,
      bottom: size.height,
      width: size.width,
      height: size.height
    }
  }));
  const boundedSkuRootLayerIds = boundedSkuItems.map((item) => item.layerId);
  const boundedSkuPlans = [2, 3, 4].map((itemCount) => buildSkuBoundedRegionLayoutPlan({
    region: boundedSkuRegion,
    items: boundedSkuItems.slice(0, itemCount)
  }));
  const boundedSkuNotePlan = buildSkuBoundedRegionLayoutPlan({
    region: boundedSkuRegion,
    items: boundedSkuItems,
    strategy: 'single-row',
    sizingPolicy: 'uniform-width-contain'
  });
  const boundedSkuPlanQa = boundedSkuPlans.map((plan) => verifySkuAutoLayoutResult({
    plan,
    actualPlacements: plan.placements.map((placement) => ({
      itemId: placement.itemId,
      layerId: placement.layerId,
      name: placement.name,
      destinationBox: placement.destinationBox,
      actualBounds: placement.destinationBox,
      actualSubjectBounds: placement.destinationBox
    }))
  }));
  const unmovedBoundedSkuQa = verifySkuAutoLayoutResult({
    plan: boundedSkuPlans[0],
    actualPlacements: boundedSkuPlans[0].placements.map((placement, index) => ({
      itemId: placement.itemId,
      layerId: placement.layerId,
      name: placement.name,
      destinationBox: placement.destinationBox,
      actualBounds: boundedSkuItems[index].bounds,
      actualSubjectBounds: boundedSkuItems[index].bounds
    })),
    expectedItemCount: 2,
    actualTopLevelItemCount: 2,
    expectedTopLevelLayerIds: boundedSkuRootLayerIds.slice(0, 2)
  });
  const boundedSkuNoteActualPlacements = boundedSkuNotePlan.placements.map((placement) => ({
    itemId: placement.itemId,
    layerId: placement.layerId,
    name: placement.name,
    destinationBox: placement.destinationBox,
    actualBounds: placement.destinationBox,
    actualSubjectBounds: placement.destinationBox
  }));
  const boundedSkuNoteQa = verifySkuAutoLayoutResult({
    plan: boundedSkuNotePlan,
    actualPlacements: boundedSkuNoteActualPlacements,
    expectedItemCount: 4,
    actualTopLevelItemCount: 4,
    expectedTopLevelLayerIds: boundedSkuRootLayerIds
  });
  const incompleteBoundedSkuQa = verifySkuAutoLayoutResult({
    plan: boundedSkuNotePlan,
    actualPlacements: boundedSkuNoteActualPlacements.slice(0, 3).map((placement) => ({
      itemId: placement.itemId,
      layerId: placement.layerId,
      name: placement.name,
      destinationBox: placement.destinationBox,
      actualBounds: placement.destinationBox,
      actualSubjectBounds: placement.destinationBox
    })),
    expectedItemCount: 4,
    actualTopLevelItemCount: 3,
    expectedTopLevelLayerIds: boundedSkuRootLayerIds
  });
  const mismatchedBoundedSkuRootQa = verifySkuAutoLayoutResult({
    plan: boundedSkuNotePlan,
    actualPlacements: boundedSkuNoteActualPlacements,
    expectedItemCount: 4,
    actualTopLevelItemCount: 4,
    expectedTopLevelLayerIds: [101, 102, 103, 999]
  });
  const invalidBoundedSkuExpectedCountQa = verifySkuAutoLayoutResult({
    plan: boundedSkuNotePlan,
    actualPlacements: boundedSkuNoteActualPlacements,
    expectedItemCount: 0,
    actualTopLevelItemCount: 4,
    expectedTopLevelLayerIds: boundedSkuRootLayerIds
  });
  const explicitTwoRegionCells = [
    { left: 100, top: 120, right: 280, bottom: 600, width: 180, height: 480 },
    { left: 300, top: 120, right: 480, bottom: 600, width: 180, height: 480 },
    { left: 520, top: 120, right: 700, bottom: 600, width: 180, height: 480 },
    { left: 720, top: 120, right: 900, bottom: 600, width: 180, height: 480 }
  ];
  const explicitTwoRegionNotePlan = buildSkuExplicitSingleRowLayoutPlan({
    cells: explicitTwoRegionCells,
    items: boundedSkuItems
  });
  const explicitTwoRegionNoteActual = explicitTwoRegionNotePlan.placements.map((placement) => ({
    itemId: placement.itemId,
    layerId: placement.layerId,
    name: placement.name,
    destinationBox: placement.destinationBox,
    actualBounds: placement.destinationBox,
    actualSubjectBounds: placement.destinationBox
  }));
  const explicitTwoRegionNoteQa = verifySkuAutoLayoutResult({
    plan: explicitTwoRegionNotePlan,
    actualPlacements: explicitTwoRegionNoteActual,
    expectedItemCount: 4,
    actualTopLevelItemCount: 4,
    expectedTopLevelLayerIds: boundedSkuRootLayerIds
  });
  const explicitOrderedSlotCells = [
    { left: 100, top: 100, right: 250, bottom: 610, width: 150, height: 510 },
    { left: 270, top: 120, right: 450, bottom: 600, width: 180, height: 480 },
    { left: 470, top: 90, right: 665, bottom: 620, width: 195, height: 530 },
    { left: 685, top: 110, right: 900, bottom: 605, width: 215, height: 495 }
  ];
  const explicitOrderedSlotNotePlan = buildSkuExplicitSingleRowLayoutPlan({
    cells: explicitOrderedSlotCells,
    items: boundedSkuItems
  });
  const explicitOrderedSlotNoteActual = explicitOrderedSlotNotePlan.placements.map((placement) => ({
    itemId: placement.itemId,
    layerId: placement.layerId,
    name: placement.name,
    destinationBox: placement.destinationBox,
    actualBounds: placement.destinationBox,
    actualSubjectBounds: placement.destinationBox
  }));
  const explicitOrderedSlotNoteQa = verifySkuAutoLayoutResult({
    plan: explicitOrderedSlotNotePlan,
    actualPlacements: explicitOrderedSlotNoteActual,
    expectedItemCount: 4,
    actualTopLevelItemCount: 4,
    expectedTopLevelLayerIds: boundedSkuRootLayerIds
  });
  const explicitTwoRowNotePlan = buildSkuExplicitSingleRowLayoutPlan({
    cells: [
      explicitTwoRegionCells[0],
      explicitTwoRegionCells[1],
      { left: 100, top: 660, right: 280, bottom: 1040, width: 180, height: 380 },
      { left: 300, top: 660, right: 480, bottom: 1040, width: 180, height: 380 }
    ],
    items: boundedSkuItems
  });
  const shrunkenExplicitNoteActual = explicitTwoRegionNotePlan.placements.map((placement, index) => {
    if (index !== 0) {
      return {
        itemId: placement.itemId,
        layerId: placement.layerId,
        name: placement.name,
        destinationBox: placement.destinationBox,
        actualBounds: placement.destinationBox,
        actualSubjectBounds: placement.destinationBox
      };
    }
    const target = placement.destinationBox;
    const centerX = target.left + target.width / 2;
    const centerY = target.top + target.height / 2;
    const actualBounds = {
      left: centerX - target.width / 4,
      top: centerY - target.height / 4,
      right: centerX + target.width / 4,
      bottom: centerY + target.height / 4,
      width: target.width / 2,
      height: target.height / 2
    };
    return {
      itemId: placement.itemId,
      layerId: placement.layerId,
      name: placement.name,
      destinationBox: placement.destinationBox,
      actualBounds,
      actualSubjectBounds: actualBounds
    };
  });
  const shrunkenExplicitNoteQa = verifySkuAutoLayoutResult({
    plan: explicitTwoRegionNotePlan,
    actualPlacements: shrunkenExplicitNoteActual,
    expectedItemCount: 4,
    actualTopLevelItemCount: 4,
    expectedTopLevelLayerIds: boundedSkuRootLayerIds
  });
  const mixedSkuOutputRequirements = [
    { size: 2, expectedComboRows: 1, expectedNoteRows: 1 },
    { size: 4, expectedComboRows: 0, expectedNoteRows: 1 }
  ];
  const missingNoteOnlySizeCompletion = evaluateSkuRequestedOutputCompletion({
    requirements: mixedSkuOutputRequirements,
    progress: [
      { size: 2, completedComboRows: 1, completedNoteRows: 1 },
      { size: 4, completedComboRows: 0, completedNoteRows: 0 }
    ]
  });
  const completeNoteOnlySizeCompletion = evaluateSkuRequestedOutputCompletion({
    requirements: mixedSkuOutputRequirements,
    progress: [
      { size: 2, completedComboRows: 1, completedNoteRows: 1 },
      { size: 4, completedComboRows: 0, completedNoteRows: 1 }
    ]
  });
  const duplicateNoteOnlySizeCompletion = evaluateSkuRequestedOutputCompletion({
    requirements: mixedSkuOutputRequirements,
    progress: [
      { size: 2, completedComboRows: 1, completedNoteRows: 1 },
      { size: 4, completedComboRows: 0, completedNoteRows: 2 }
    ]
  });
  const invalidStagedNoteReadback = buildSkuExportReadback({
    expectedExports: [{
      path: 'C:\\project\\SKU\\.designecho-staging\\sku-note-4-probe\\4双自选备注\\note.jpg',
      expectedDimensions: { width: 1000, height: 1000 }
    }],
    fileProbes: [{
      success: false,
      path: 'C:\\project\\SKU\\.designecho-staging\\sku-note-4-probe\\4双自选备注\\note.jpg',
      status: 'decode_failed'
    }]
  });
  const wrongSizeStagedNoteReadback = buildSkuExportReadback({
    expectedExports: [{
      path: 'C:\\project\\SKU\\.designecho-staging\\sku-note-4-probe\\4双自选备注\\note.jpg',
      expectedDimensions: { width: 1000, height: 1000 }
    }],
    fileProbes: [{
      success: true,
      path: 'C:\\project\\SKU\\.designecho-staging\\sku-note-4-probe\\4双自选备注\\note.jpg',
      status: 'ok',
      rawImagesRedacted: true,
      dimensions: { width: 800, height: 1000 }
    }]
  });
  const wrongPathSameCountReadback = buildSkuExportReadback({
    expectedExportPaths: [
      'C:\\project\\SKU\\2双\\combo-a.jpg',
      'C:\\project\\SKU\\2双\\combo-b.jpg'
    ],
    fileProbes: [{
      success: true,
      path: 'C:\\project\\SKU\\2双\\combo-a.jpg',
      status: 'ok',
      rawImagesRedacted: true,
      dimensions: { width: 1000, height: 1000 }
    }, {
      success: true,
      path: 'C:\\project\\SKU\\2双\\unrelated.jpg',
      status: 'ok',
      rawImagesRedacted: true,
      dimensions: { width: 1000, height: 1000 }
    }]
  });
  const duplicatePathProbeReadback = buildSkuExportReadback({
    expectedExportPaths: [
      'C:\\project\\SKU\\2双\\combo-a.jpg',
      'C:\\project\\SKU\\2双\\combo-b.jpg'
    ],
    fileProbes: [{
      success: true,
      path: 'C:\\project\\SKU\\2双\\combo-a.jpg',
      status: 'ok',
      rawImagesRedacted: true,
      dimensions: { width: 1000, height: 1000 }
    }, {
      success: true,
      path: 'c:/project/SKU/2双/combo-a.jpg',
      status: 'ok',
      rawImagesRedacted: true,
      dimensions: { width: 1000, height: 1000 }
    }]
  });
  const frozenSkuExportInventory = buildSkuExpectedExportInventory({
    outputDir: 'C:\\project\\SKU',
    specs: [{
      size: 2,
      combos: [['奶 白', '黑色'], ['浅咖', '深咖']],
      comboTemplateName: '2双组合.psd',
      comboExpectedDimensions: { width: 1000, height: 1000 },
      noteRows: [['奶白', '黑色'], ['浅咖', '深咖']],
      noteTemplateName: '2双自选备注.psb',
      noteExpectedDimensions: { width: 1000, height: 1000 }
    }, {
      size: 3,
      combos: [['奶白', '浅咖', '黑色']],
      comboTemplateName: '3双组合.tif',
      noteRows: [['奶白', '浅咖', '黑色']],
      noteTemplateName: '3双自选备注.psd'
    }, {
      size: 4,
      combos: [['奶白', '浅咖', '深咖', '黑色']],
      comboTemplateName: '4双组合.psb',
      noteRows: [['奶白', '浅咖', '深咖', '黑色']],
      noteTemplateName: '4双自选备注.tif'
    }]
  });
  const selectedSkuDeliveryConvention = {
    version: 'skill-delivery-convention/v0',
    provenance: 'agent_selected',
    supportRefs: ['project-file:SKU/参考成品/2双组合.psb'],
    raster: {
      projectRelativeRoot: '店铺交付/色卡成品',
      folderPattern: '{size}双成品',
      fileNamePattern: '{index}-{colors}',
      format: 'jpg'
    },
    editable: {
      projectRelativeRoot: '店铺交付/色卡成品/分层源稿',
      folderPattern: '{size}双成品',
      fileNamePattern: '{index}-{colors}-分层',
      format: 'psb'
    },
    pairing: 'one_editable_per_raster',
    versionPolicy: 'fail_if_exists'
  };
  const selectedConventionSkuInventory = buildSkuExpectedExportInventory({
    outputDir: 'C:\\project\\SKU',
    projectPath: 'C:\\project',
    deliveryConvention: selectedSkuDeliveryConvention,
    specs: [{
      size: 2,
      combos: [['奶白', '黑色']],
      comboTemplateName: '2双组合.psd'
    }]
  });
  const posixStagingPath = joinSkuExportPath(
    '/tmp/project/SKU/.designecho-staging/run-1',
    '可编辑\\2双组合',
    '1白+黑.psb'
  );
  const posixVolumeFallbackSkuInventory = buildSkuExpectedExportInventory({
    outputDir: '/Volumes/Design Disk/Project/SKU',
    specs: [{
      size: 2,
      combos: [['奶白', '黑色']],
      comboTemplateName: '2双组合.psd'
    }]
  });
  const windowsStagingIdentityMatches = normalizeSkuExportPathForCompare(
    'C:\\Project\\SKU\\A.jpg'
  ) === normalizeSkuExportPathForCompare('c:/project/sku/a.jpg');
  const posixStagingIdentityPreservesCase = normalizeSkuExportPathForCompare(
    '/Users/Designer/Project/SKU/A.jpg'
  ) !== normalizeSkuExportPathForCompare('/Users/Designer/Project/SKU/a.jpg');
  const unauthorizedReplaceSkuInventory = buildSkuExpectedExportInventory({
    outputDir: 'C:\\project\\SKU',
    projectPath: 'C:\\project',
    deliveryConvention: {
      ...selectedSkuDeliveryConvention,
      provenance: 'user',
      supportRefs: ['user-instruction:current-turn'],
      versionPolicy: 'replace_exact_set'
    },
    specs: [{
      size: 2,
      combos: [['奶白', '黑色']],
      comboTemplateName: '2双组合.psd'
    }]
  });
  const frozenSkuExpectedExports = frozenSkuExportInventory.items.map((item) => ({
    path: item.path,
    expectedDimensions: item.expectedDimensions
  }));
  const frozenSkuExpectedPaths = frozenSkuExportInventory.items.map((item) => item.path);
  const buildReadyFrozenSkuProbes = (freshnessVerified = true) => (
    frozenSkuExportInventory.items.map((item) => ({
      success: true,
      path: item.path,
      status: 'ok',
      rawImagesRedacted: true,
      dimensions: item.expectedDimensions || { width: 1000, height: 1000 },
      freshnessVerified,
      freshnessProof: freshnessVerified ? 'new_path' : 'unverified'
    }))
  );
  const exactFrozenSkuReadback = buildSkuExportReadback({
    expectedExports: frozenSkuExpectedExports,
    actualExportPaths: frozenSkuExpectedPaths,
    fileProbes: buildReadyFrozenSkuProbes(true)
  });
  const wrongActualSkuPaths = [...frozenSkuExpectedPaths];
  wrongActualSkuPaths[1] = 'C:\\project\\SKU\\2双组合\\2错误文件名.jpg';
  const wrongActualSameCountSkuReadback = buildSkuExportReadback({
    expectedExports: frozenSkuExpectedExports,
    actualExportPaths: wrongActualSkuPaths,
    fileProbes: buildReadyFrozenSkuProbes(true)
  });
  const duplicateActualSkuPaths = [...frozenSkuExpectedPaths];
  duplicateActualSkuPaths[1] = duplicateActualSkuPaths[0].toUpperCase();
  const duplicateActualSkuReadback = buildSkuExportReadback({
    expectedExports: frozenSkuExpectedExports,
    actualExportPaths: duplicateActualSkuPaths,
    fileProbes: buildReadyFrozenSkuProbes(true)
  });
  const staleFrozenSkuReadback = buildSkuExportReadback({
    expectedExports: frozenSkuExpectedExports,
    actualExportPaths: frozenSkuExpectedPaths,
    fileProbes: buildReadyFrozenSkuProbes(false)
  });
  const violatedFrozenSkuReadback = buildSkuExportReadback({
    expectedExports: frozenSkuExpectedExports,
    actualExportPaths: frozenSkuExpectedPaths,
    fileProbes: buildReadyFrozenSkuProbes(true),
    inventoryViolations: ['工具回执额外返回 1 个计划外文件。']
  });
  const placementReceiptBase = {
    sourceId: 'S01',
    placedLayerId: 81,
    documentId: 17,
    expectedDocumentId: 17,
    observedDocumentId: 17,
    asset: {
      path: 'C:\\project\\.designecho\\sku-retouch\\S01-product.png',
      sha256: 'a'.repeat(64),
      checksum: 'fnv1a32:1234abcd',
      byteLength: 4096,
      width: 800,
      height: 1200,
      alphaEnvelopeSafe: true
    },
    placedSource: {
      assetId: 'S01',
      checksum: 'fnv1a32:1234abcd',
      byteLength: 4096,
      identityProofVersion: 'place-image-source-identity/v1',
      identityVerified: true
    },
    targetBounds: { left: 100, top: 120, width: 400, height: 600 },
    actualBounds: { left: 100, top: 120, width: 400, height: 600 },
    smartObjectBounds: { left: 100, top: 120, width: 400, height: 600 },
    placementActualBounds: { left: 100, top: 120, width: 400, height: 600 },
    smartObjectFileReference: 'S01-product.png',
    editableSmartObject: true,
    layerBoundsReadSucceeded: true,
    placementGeometryVerified: true,
    outsideTargetFraction: 0,
    outsideTargetEdges: []
  };
  const validUniformScalePlacementReceipt = buildSkuColorCardUniformScalePlacementReceipt(
    placementReceiptBase
  );
  const wrongIdentityUniformScalePlacementReceipt = buildSkuColorCardUniformScalePlacementReceipt({
    ...placementReceiptBase,
    placedSource: {
      ...placementReceiptBase.placedSource,
      checksum: 'fnv1a32:deadbeef'
    }
  });
  const staleUxpUniformScalePlacementReceipt = buildSkuColorCardUniformScalePlacementReceipt({
    ...placementReceiptBase,
    placedSource: {
      ...placementReceiptBase.placedSource,
      identityProofVersion: '',
      identityVerified: false
    }
  });
  const missingDocumentIdentityPlacementReceipt = buildSkuColorCardUniformScalePlacementReceipt({
    ...placementReceiptBase,
    observedDocumentId: undefined
  });
  const croppedUniformScalePlacementReceipt = buildSkuColorCardUniformScalePlacementReceipt({
    ...placementReceiptBase,
    actualBounds: { left: 90, top: 120, width: 420, height: 630 },
    smartObjectBounds: { left: 90, top: 120, width: 420, height: 630 },
    placementActualBounds: { left: 90, top: 120, width: 420, height: 630 },
    outsideTargetFraction: 0.08,
    outsideTargetEdges: ['left', 'bottom']
  });
  const stretchedNarrowPlacementReceipt = buildSkuColorCardUniformScalePlacementReceipt({
    ...placementReceiptBase,
    asset: {
      ...placementReceiptBase.asset,
      width: 100,
      height: 1000
    },
    targetBounds: { left: 100, top: 120, width: 120, height: 1000 },
    actualBounds: { left: 100, top: 120, width: 120, height: 1000 },
    smartObjectBounds: { left: 100, top: 120, width: 120, height: 1000 },
    placementActualBounds: { left: 100, top: 120, width: 120, height: 1000 }
  });
  const skuColorCardEvaluationAdapter = DESIGN_EVALUATION_RESULT_ADAPTER_CONTRIBUTIONS.find(
    (contribution) => contribution.sourceToolName === 'sku-color-card'
  );
  const flatClippingRecords = skuColorCardEvaluationAdapter?.buildRecords({
    report: {
      version: 'sku-color-card-execution-report/v2',
      presentationMode: 'flat',
      checks: {
        finalStructureReadback: 'passed',
        sourceCoverage: 'passed',
        smartObjectEditability: 'passed',
        clippingStructure: 'not_applicable',
        labelTextFit: 'passed',
        visualComposition: 'needs_review'
      }
    }
  }) || [];
  const cardMissingClippingRecords = skuColorCardEvaluationAdapter?.buildRecords({
    report: {
      version: 'sku-color-card-execution-report/v2',
      presentationMode: 'card',
      checks: {
        finalStructureReadback: 'passed',
        sourceCoverage: 'passed',
        smartObjectEditability: 'passed',
        clippingStructure: 'not_applicable',
        labelTextFit: 'passed',
        visualComposition: 'needs_review'
      }
    }
  }) || [];
  const flatClippingRecord = flatClippingRecords.find(
    (record) => record.key === 'sku_color_card_clipping_structure'
  );
  const cardMissingClippingRecord = cardMissingClippingRecords.find(
    (record) => record.key === 'sku_color_card_clipping_structure'
  );
  const completedSkuDeliveryOutcome = resolveSkuBatchDeliveryOutcome({
    hasAnyProcessedOutput: true,
    allRequestedOutputsComplete: true,
    hasExecutionWarnings: false,
    exportReadbackStatus: 'ready_for_review'
  });
  const partialSkuDeliveryOutcome = resolveSkuBatchDeliveryOutcome({
    hasAnyProcessedOutput: true,
    allRequestedOutputsComplete: missingNoteOnlySizeCompletion.allRequestedOutputsComplete,
    hasExecutionWarnings: false,
    exportReadbackStatus: 'ready_for_review'
  });
  const blockedReadbackSkuDeliveryOutcome = resolveSkuBatchDeliveryOutcome({
    hasAnyProcessedOutput: true,
    allRequestedOutputsComplete: true,
    hasExecutionWarnings: false,
    exportReadbackStatus: 'blocked'
  });
  const publicSkuDeliverySummary = buildSkuDeliverySummary({
    status: 'partial',
    skuDocName: 'SKU.psb',
    processedSizes: ['2双 (1组)'],
    completedCombosBySize: { 2: [['奶白', '浅咖']] },
    exportedFileNames: ['2双/奶白+浅咖.jpg'],
    userWarnings: ['插件无法正确识别 3 双模板的占位结构，本次已停止该规格，避免排版错误。'],
    // 旧调用方即使误传内部字段，也不能进入用户明细。
    warnings: ['execution contract / Photoshop revision / runtime diagnostic']
  });
  const noisySkuWarnings = Array.from({ length: 49 }, (_, index) => (
    `${2 + (index % 3)}双第${1 + (index % 5)}组版面检查未通过，未计为完成。`
  ));
  const groupedFailureSkuDeliverySummary = buildSkuDeliverySummary({
    status: 'failed',
    skuDocName: 'SKU.psb',
    requestedSizes: [2, 3, 4],
    processedSizes: [],
    userWarnings: noisySkuWarnings,
    requestedOutputMismatches: [
      { size: 2, kind: 'combo', expected: 5, completed: 0 },
      { size: 3, kind: 'combo', expected: 5, completed: 0 },
      { size: 4, kind: 'combo', expected: 5, completed: 0 },
      { size: 2, kind: 'note', expected: 1, completed: 0 },
      { size: 3, kind: 'note', expected: 1, completed: 0 },
      { size: 4, kind: 'note', expected: 1, completed: 0 }
    ],
    exportReadbackStatus: 'no_exports'
  });
  const groupedFailureRenderedMessage = convertLegacyMessage({
    id: 'sku-grouped-failure-presentation-audit',
    role: 'assistant',
    content: `⚠️ ${groupedFailureSkuDeliverySummary.compactText}\n${noisySkuWarnings.join('\n')}`,
    skuDeliverySummary: groupedFailureSkuDeliverySummary,
    thinkingSteps: [{
      id: 'sku-grouped-failure-tool-result-audit',
      type: 'tool_result',
      status: 'error',
      toolName: 'sku-batch',
      content: noisySkuWarnings.join('\n')
    }]
  });
  const distinctWarningSkuDeliverySummary = buildSkuDeliverySummary({
    status: 'failed',
    skuDocName: 'SKU.psb',
    userWarnings: [
      '4双自选备注的版面检查发现位置或尺寸异常，该项未计为完成。',
      '3双自选备注的版面检查发现位置或尺寸异常，该项未计为完成。',
      'Photoshop 插件版本缺少自动排版能力，请重新加载插件。'
    ]
  });
  const malformedVersionSkuMessage = convertLegacyMessage({
    id: 'sku-malformed-version-presentation-audit',
    role: 'assistant',
    content: '',
    skuDeliverySummary: { version: 'bad' },
    executionSummary: {
      status: 'failed',
      stopReason: 'tool_error',
      userVisibleSummary: '真实失败：4双自选备注未生成。'
    }
  });
  const incompleteOwnedSkuMessage = convertLegacyMessage({
    id: 'sku-incomplete-owned-presentation-audit',
    role: 'assistant',
    content: '真实失败：4双自选备注未生成。',
    skuDeliverySummary: {
      version: 'sku-delivery-summary/v0',
      presentationMode: 'sku_delivery_owned'
    }
  });
  const damagedProjectionSkuSummary = {
    ...distinctWarningSkuDeliverySummary,
    primaryIssue: undefined,
    compactText: 'SKU 未完成。',
    detailText: '暂无明细。'
  };
  const damagedProjectionSkuMessage = convertLegacyMessage({
    id: 'sku-damaged-projection-presentation-audit',
    role: 'assistant',
    content: '不能丢失的真实失败正文。',
    skuDeliverySummary: damagedProjectionSkuSummary,
    thinkingSteps: [{
      id: 'sku-damaged-projection-tool-result-audit',
      type: 'tool_result',
      status: 'error',
      toolName: 'sku-batch',
      content: '真实工具失败：版面读回失败。'
    }]
  });
  const invalidIssueCodeSkuSummary = {
    ...groupedFailureSkuDeliverySummary,
    issueGroups: groupedFailureSkuDeliverySummary.issueGroups.map((group, index) => (
      index === 0 ? { ...group, code: 'not_a_real_issue_code' } : group
    ))
  };
  const invalidComboCountSkuSummary = {
    ...publicSkuDeliverySummary,
    totalCombos: 777
  };
  const emptyWarningSkuSummary = {
    ...publicSkuDeliverySummary,
    warnings: [''],
    warningCount: 1,
    warningGroups: [],
    warningGroupCount: 0,
    issueCount: publicSkuDeliverySummary.issueGroups.length,
    primaryIssue: publicSkuDeliverySummary.issueGroups[0]?.title,
    compactText: 'SKU 部分完成。',
    detailText: publicSkuDeliverySummary.detailText
  };
  const malformedVersionSkuBlocksText = JSON.stringify(malformedVersionSkuMessage.blocks);
  const incompleteOwnedSkuBlocksText = JSON.stringify(incompleteOwnedSkuMessage.blocks);
  const damagedProjectionSkuBlocksText = JSON.stringify(damagedProjectionSkuMessage.blocks);
  const completedSkuDeliveryWithCleanupAdvisory = buildSkuDeliverySummary({
    status: 'completed',
    skuDocName: 'SKU.psb',
    requestedSizes: [2, 3, 4],
    processedSizes: ['2双 (5组)', '3双 (5组)', '4双 (5组)'],
    completedCombosBySize: {
      2: Array.from({ length: 5 }, () => ['奶白', '浅咖']),
      3: Array.from({ length: 5 }, () => ['奶白', '浅咖', '深咖']),
      4: Array.from({ length: 5 }, () => ['奶白', '浅咖', '深咖', '黑色'])
    },
    generatedNoteSizes: [2, 3, 4],
    userAdvisories: ['2双自选备注已完成，但临时文件需要后续清理。'],
    exportedFileNames: Array.from({ length: 18 }, (_, index) => `SKU-${index + 1}.jpg`),
    exportReadbackStatus: 'ready_for_review'
  });
  const invalidExportCountSkuSummary = {
    ...completedSkuDeliveryWithCleanupAdvisory,
    exportCount: 999
  };
  const invalidNoteCountSkuSummary = {
    ...completedSkuDeliveryWithCleanupAdvisory,
    noteCount: 777
  };
  const missingProcessedSkuSummary = {
    ...publicSkuDeliverySummary,
    processedSizes: []
  };
  const phantomProcessedSkuSummary = {
    ...buildSkuDeliverySummary({
      status: 'failed',
      skuDocName: 'SKU.psb',
      requestedSizes: [2]
    }),
    processedSizes: ['2双 (1组)']
  };
  const offRequestNoteSkuSummary = {
    ...buildSkuDeliverySummary({
      status: 'partial',
      skuDocName: 'SKU.psb',
      requestedSizes: [2],
      processedSizes: ['2双 (自选备注)'],
      generatedNoteSizes: [2],
      exportedFileNames: ['2双自选备注.jpg']
    }),
    generatedNoteSizes: [2, 99],
    noteCount: 2
  };
  const completedWithoutOutputSkuSummary = buildSkuDeliverySummary({
    status: 'completed',
    skuDocName: 'SKU.psb',
    requestedSizes: [2]
  });
  const failedWithOutputSkuSummary = buildSkuDeliverySummary({
    status: 'failed',
    skuDocName: 'SKU.psb',
    requestedSizes: [2],
    processedSizes: ['2双 (1组)'],
    completedCombosBySize: { 2: [['奶白', '浅咖']] },
    exportedFileNames: ['2双-奶白+浅咖.jpg']
  });
  const partialWithoutIssueSkuSummary = buildSkuDeliverySummary({
    status: 'partial',
    skuDocName: 'SKU.psb',
    requestedSizes: [2],
    processedSizes: ['2双 (1组)'],
    completedCombosBySize: { 2: [['奶白', '浅咖']] },
    exportedFileNames: ['2双-奶白+浅咖.jpg']
  });
  const inspectedPlaceholderSlots = Array.isArray(skuPlaceholderFixtureInspection?.data?.slots)
    ? skuPlaceholderFixtureInspection.data.slots
    : [];
  const numericRegionSkuSlots = Array.isArray(numericRegionSkuInspection?.data?.slots)
    ? numericRegionSkuInspection.data.slots
    : [];
  const skuDeleteErrorCall = skuDeleteErrorDescriptorAudit.calls.find(
    (command) => command?._obj === 'delete'
  );
  const skuDeleteSuccessCallIndex = skuDeleteSuccessAudit.calls.findIndex(
    (command) => command?._obj === 'delete'
  );
  const skuDeleteSuccessPostDeleteGets = skuDeleteSuccessCallIndex >= 0
    ? skuDeleteSuccessAudit.calls.slice(skuDeleteSuccessCallIndex + 1).filter(
      (command) => command?._obj === 'get'
    )
    : [];
  const skuDeleteNoEffectCallIndex = skuDeleteNoEffectAudit.calls.findIndex(
    (command) => command?._obj === 'delete'
  );
  const skuDeleteNoEffectPostDeleteGets = skuDeleteNoEffectCallIndex >= 0
    ? skuDeleteNoEffectAudit.calls.slice(skuDeleteNoEffectCallIndex + 1).filter(
      (command) => command?._obj === 'get'
    )
    : [];
  const skuResizeDomSelectCall = skuResizeDomAudit.calls.find(
    (command) => command?._obj === 'select'
  );
  const skuResizeDomTransformCalls = skuResizeDomAudit.calls.filter(
    (command) => command?._obj === 'transform'
  );
  const skuResizeFallbackSelectCall = skuResizeFallbackAudit.calls.find(
    (command) => command?._obj === 'select'
  );
  const skuResizeFallbackTransformCalls = skuResizeFallbackAudit.calls.filter(
    (command) => command?._obj === 'transform'
  );
  const skuTranslateDomSelectCall = skuTranslateDomAudit.calls.find(
    (command) => command?._obj === 'select'
  );
  const skuComboCleanupCallIndex = skuExecuteComboLayoutText.indexOf(
    'await deleteCopiedSkuLayers('
  );
  const skuComboCleanupContinuationText = skuComboCleanupCallIndex >= 0
    ? skuExecuteComboLayoutText.slice(skuComboCleanupCallIndex, skuComboCleanupCallIndex + 1200)
    : '';
  const skuDeleteErrorWasReported = skuDeleteAuditOutcomeFailed(skuDeleteErrorDescriptorAudit);
  const skuDeleteSuccessWasReportedAsFailure = skuDeleteAuditOutcomeFailed(skuDeleteSuccessAudit);
  const skuDeleteNoEffectWasReported = skuDeleteAuditOutcomeFailed(skuDeleteNoEffectAudit);
  const skuDeleteErrorFailureData = skuDeleteErrorDescriptorAudit.error?.skuLayerCleanupFailure;
  const skuDeleteNoEffectFailureData = skuDeleteNoEffectAudit.error?.skuLayerCleanupFailure;
  const skuDeleteFailureStopsCombo = Boolean(skuDeleteErrorDescriptorAudit.error)
    && skuComboCleanupContinuationText.includes('await deleteCopiedSkuLayers(')
    && skuExecuteComboLayoutText.includes(
      'const originalCleanupFailure = extractSkuLayerCleanupFailureData(err)'
    )
    && skuExecuteComboLayoutText.includes('if (rollbackError || originalCleanupFailure)')
    && skuExecuteComboLayoutText.includes('throw await closeSkuTemplateAfterCleanupFailure({')
    && skuExecuteComboLayoutText.includes('success: false')
    && skuExecuteComboLayoutText.includes('data: cleanupFailure ? { cleanupFailure } : null');
  const agentComboCleanupFailureStart = skuBatchExecuteMethodText.indexOf(
    'const comboCleanupFailure = readTerminalSkuLayerCleanupFailure(executeResult)'
  );
  const agentComboDeliverableStart = skuBatchExecuteMethodText.indexOf(
    'const hasReadyComboQa = hasReadySkuComboAutoLayoutQa(executeResult)',
    Math.max(0, agentComboCleanupFailureStart)
  );
  const agentComboCleanupFailureBlock = agentComboCleanupFailureStart >= 0
    && agentComboDeliverableStart > agentComboCleanupFailureStart
    ? skuBatchExecuteMethodText.slice(agentComboCleanupFailureStart, agentComboDeliverableStart)
    : '';
  const agentNoteCleanupFailureStart = skuBatchExecuteMethodText.indexOf(
    'const noteCleanupFailure = readTerminalSkuLayerCleanupFailure(noteResult)'
  );
  const agentNoteDeliverableStart = skuBatchExecuteMethodText.indexOf(
    'const hasReadyNoteQa = hasReadySkuNoteAutoLayoutQa(noteResult, noteExpectedItemCount)',
    Math.max(0, agentNoteCleanupFailureStart)
  );
  const agentNoteCleanupFailureBlock = agentNoteCleanupFailureStart >= 0
    && agentNoteDeliverableStart > agentNoteCleanupFailureStart
    ? skuBatchExecuteMethodText.slice(agentNoteCleanupFailureStart, agentNoteDeliverableStart)
    : '';
  const skuStagingFileCleanupIndex = rendererStagedFileTransactionText.lastIndexOf(
    'const rootCleanup = await cleanupStagedFileRoot('
  );
  const skuStagingParentCleanupIndex = rendererStagedFileTransactionText.lastIndexOf(
    'return cleanupStagedFileParentIfEmpty(input.transaction.transactionToken, host)'
  );
  const skuProductionSafetyRegressionViolations = [
    ...(skuMutationTargetAssertionText.includes("{ _ref: 'document', _id: documentId }")
      && skuBatchPlayResizeText.includes('documentId: number')
      && skuBatchPlayResizeText.includes('assertSkuMutationTarget({')
      && skuBatchPlayResizeText.includes("{ _ref: 'document', _id: documentId }")
      && skuBatchPlayTranslateText.includes('documentId: number')
      && skuBatchPlayTranslateText.includes('assertSkuMutationTarget({')
      && skuBatchPlayTranslateText.includes("{ _ref: 'document', _id: documentId }")
      && skuDeleteCopiedLayersText.includes('documentId: number')
      && skuDeleteCopiedLayersText.includes('assertSkuMutationTarget({')
      && skuDeleteCopiedLayersText.includes("{ _ref: 'document', _id: documentId }")
      && skuCleanupCopiedLayersText.includes('documentId: number')
      && skuCleanupCopiedLayersText.includes('deleteCopiedSkuLayers(documentId, layerIds, label)')
      && skuAutoLayoutApplicationText.includes('batchPlayResize(documentId, layerId')
      && skuAutoLayoutApplicationText.includes('batchPlayTranslate(documentId, layerId')
      && skuDeleteCopiedLayerCalls.length > 0
      && skuDeleteCopiedLayerCalls.every((call) => call.arguments.length >= 3)
      && skuCleanupCopiedLayerCalls.length > 0
      && skuCleanupCopiedLayerCalls.every((call) => call.arguments.length >= 3)
      && !skuBatchPlayResizeText.includes('activeLayers[0]')
      && !skuBatchPlayResizeText.includes('activeLayers?.[0]')
      && !skuBatchPlayTranslateText.includes('activeLayers[0]')
      && !skuBatchPlayTranslateText.includes('activeLayers?.[0]')
      && !skuDeleteCopiedLayersText.includes('activeLayers[0]')
      && !skuDeleteCopiedLayersText.includes('activeLayers?.[0]')
      ? []
      : ['sku-layout:duplicate-layer-id-mutation-is-not-bound-to-explicit-document-id']),
    ...(!skuResizeDomAudit.error
      && skuResizeDomAudit.activeDocumentId === skuResizeDomAudit.targetDocumentId
      && readAuditDescriptorTargetId(skuResizeDomSelectCall, 'document')
        === skuResizeDomAudit.targetDocumentId
      && readAuditDescriptorTargetId(skuResizeDomSelectCall, 'layer')
        === skuResizeDomAudit.targetLayerId
      && skuResizeDomAudit.targetCounters.scale === 1
      && skuResizeDomAudit.targetCounters.resize === 0
      && skuResizeDomAudit.decoyCounters.scale === 0
      && skuResizeDomAudit.decoyCounters.resize === 0
      && skuResizeDomTransformCalls.length === 0
      && !skuResizeFallbackAudit.error
      && readAuditDescriptorTargetId(skuResizeFallbackSelectCall, 'document')
        === skuResizeFallbackAudit.targetDocumentId
      && readAuditDescriptorTargetId(skuResizeFallbackSelectCall, 'layer')
        === skuResizeFallbackAudit.targetLayerId
      && skuResizeFallbackAudit.targetCounters.scale === 0
      && skuResizeFallbackAudit.targetCounters.resize === 0
      && skuResizeFallbackAudit.decoyCounters.scale === 0
      && skuResizeFallbackAudit.decoyCounters.resize === 0
      && skuResizeFallbackTransformCalls.length === 1
      && !Object.prototype.hasOwnProperty.call(skuResizeFallbackTransformCalls[0], '_target')
      && skuBatchPlayResizeText.includes("typeof targetLayer?.scale === 'function'")
      && skuBatchPlayResizeText.includes('targetLayer.scale(scalePercent, scalePercent)')
      && !skuBatchPlayResizeText.includes('targetLayer.resize(')
      ? []
      : ['sku-layout:scale-does-not-use-official-dom-api-or-fallback-to-targetless-transform']),
    ...(!skuTranslateDomAudit.error
      && skuTranslateDomAudit.activeDocumentId === skuTranslateDomAudit.targetDocumentId
      && readAuditDescriptorTargetId(skuTranslateDomSelectCall, 'document')
        === skuTranslateDomAudit.targetDocumentId
      && readAuditDescriptorTargetId(skuTranslateDomSelectCall, 'layer')
        === skuTranslateDomAudit.targetLayerId
      && skuTranslateDomAudit.targetCounters.translate === 1
      && skuTranslateDomAudit.decoyCounters.translate === 0
      ? []
      : ['sku-layout:translate-did-not-mutate-the-exact-selected-document-layer']),
    ...(Boolean(skuResizeSelectErrorAudit.error)
      && skuResizeSelectErrorAudit.targetCounters.scale === 0
      && skuResizeSelectErrorAudit.targetCounters.resize === 0
      && !skuResizeSelectErrorAudit.calls.some((command) => command?._obj === 'transform')
      && Boolean(skuResizeTransformErrorAudit.error)
      && skuResizeTransformErrorAudit.calls.filter((command) => command?._obj === 'transform').length === 1
      && Boolean(skuTranslateSelectErrorAudit.error)
      && skuTranslateSelectErrorAudit.targetCounters.translate === 0
      && skuBatchPlayResizeText.includes(
        'assertSkuBatchPlayCommandSucceeded(selectionDescriptors'
      )
      && skuBatchPlayResizeText.includes(
        'assertSkuBatchPlayCommandSucceeded(transformDescriptors'
      )
      && skuBatchPlayTranslateText.includes(
        'assertSkuBatchPlayCommandSucceeded(selectionDescriptors'
      )
      && skuAssertBatchPlayCommandSucceededText.includes('readSkuBatchPlayDescriptorError(')
      ? []
      : ['sku-layout:select-or-transform-error-descriptor-can-be-treated-as-success']),
    ...(!skuAutoLayoutApplySuccessAudit.error
      && skuAutoLayoutApplySuccessAudit.result?.applied === 1
      && skuAutoLayoutApplySuccessAudit.result?.autoLayoutQa?.status === 'ready'
      && skuAutoLayoutApplySuccessAudit.counters.scale === 1
      && skuAutoLayoutApplySuccessAudit.counters.resize === 0
      && skuAutoLayoutApplySuccessAudit.counters.translate === 1
      && skuAutoLayoutApplySuccessAudit.decoyCounters.scale === 0
      && skuAutoLayoutApplySuccessAudit.decoyCounters.resize === 0
      && skuAutoLayoutApplySuccessAudit.decoyCounters.translate === 0
      ? []
      : ['sku-layout:production-apply-did-not-complete-after-real-scale-translate-readback']),
    ...(String(skuAutoLayoutScaleNoopAudit.error?.message || '').includes('缩放写入未生效')
      && skuAutoLayoutScaleNoopAudit.result === undefined
      && skuAutoLayoutScaleNoopAudit.counters.scale === 1
      && skuAutoLayoutScaleNoopAudit.counters.resize === 0
      && skuAutoLayoutScaleNoopAudit.counters.translate === 0
      ? []
      : ['sku-layout:silent-scale-noop-can-continue-past-live-geometry-readback']),
    ...(String(skuAutoLayoutTranslateNoopAudit.error?.message || '').includes('移动写入未生效')
      && skuAutoLayoutTranslateNoopAudit.result === undefined
      && skuAutoLayoutTranslateNoopAudit.counters.scale === 1
      && skuAutoLayoutTranslateNoopAudit.counters.resize === 0
      && skuAutoLayoutTranslateNoopAudit.counters.translate === 1
      ? []
      : ['sku-layout:silent-translate-noop-can-return-a-deliverable-result']),
    ...(skuReadLiveLayerBoundsText.includes("_obj: 'get'")
      && skuReadLiveLayerBoundsText.includes("{ _ref: 'layer', _id: layerId }")
      && skuReadLiveLayerBoundsText.includes("{ _ref: 'document', _id: documentId }")
      && skuReadLiveLayerBoundsText.includes('descriptorLayerId !== layerId')
      && (skuAutoLayoutApplicationText.match(/readLiveSkuLayerBounds\(documentId, layerId\)/g) || []).length >= 4
      && skuAutoLayoutApplicationText.includes('const afterScaleReadback = await readLiveSkuLayerBounds(')
      && skuAutoLayoutApplicationText.includes('SKU 图层 ${layerId} 缩放写入未生效')
      && skuAutoLayoutApplicationText.includes('const afterPositionReadback = await readLiveSkuLayerBounds(')
      && skuAutoLayoutApplicationText.includes('SKU 图层 ${layerId} 移动写入未生效')
      && skuAutoLayoutApplicationText.includes('const finalReadback = await readLiveSkuLayerBounds(')
      ? []
      : ['sku-layout:mutation-can-pass-without-exact-live-geometry-readback']),
    ...(skuDeleteCopiedLayersText.includes('Promise<SkuLayerCleanupResult>')
      && skuBatchPlayDescriptorErrorText.includes("objectType !== 'error'")
      && skuBatchPlayDescriptorErrorText.includes('resultCode >= 0')
      && !skuConfirmLayerAbsentText.includes("_obj: 'get'")
      && skuConfirmLayerAbsentText.includes('findLayerById(targetDocument.layers, layerId)')
      && skuConfirmLayerAbsentText.includes('if (domLayer)')
      && skuConfirmLayerAbsentText.includes('Number(app.activeDocument?.id) !== documentId')
      && skuDeleteCopiedLayersText.includes('!findLayerById(targetDocument.layers, layerId)')
      && skuRemoveConfirmedLayerIdText.includes('layerIds.splice(index, 1)')
      && skuDeleteCopiedLayersText.includes('removeConfirmedSkuLayerId(layerIds, layerId)')
      && skuCreateLayerCleanupFailureText.includes("schema: 'sku-layer-cleanup-failure/v1'")
      && skuCreateLayerCleanupFailureText.includes('pendingLayerIds: [...input.pendingLayerIds]')
      && skuCreateLayerCleanupFailureText.includes('failures: input.failures.map(')
      ? []
      : ['sku-delete:structured-failure-or-exact-absence-contract-is-not-wired']),
    ...(skuDeleteErrorWasReported
      && skuDeleteErrorDescriptorAudit.pendingLayerIds.includes(
        skuDeleteErrorDescriptorAudit.targetLayerId
      )
      && skuDeleteErrorDescriptorAudit.targetLayerStillExists
      && skuDeleteErrorDescriptorAudit.decoyLayerStillExists
      && skuDeleteErrorFailureData?.schema === 'sku-layer-cleanup-failure/v1'
      && skuDeleteErrorFailureData?.pendingLayerIds?.includes(
        skuDeleteErrorDescriptorAudit.targetLayerId
      )
      && skuDeleteErrorFailureData?.failures?.some((failure) => failure?.stage === 'delete')
      && readAuditDescriptorTargetId(skuDeleteErrorCall, 'document')
        === skuDeleteErrorDescriptorAudit.targetDocumentId
      && readAuditDescriptorTargetId(skuDeleteErrorCall, 'layer')
        === skuDeleteErrorDescriptorAudit.targetLayerId
      ? []
      : ['sku-delete:error-descriptor-was-treated-as-success-or-failed-id-was-forgotten']),
    ...(!skuDeleteSuccessWasReportedAsFailure
      && !skuDeleteSuccessAudit.pendingLayerIds.includes(skuDeleteSuccessAudit.targetLayerId)
      && !skuDeleteSuccessAudit.targetLayerStillExists
      && skuDeleteSuccessAudit.decoyLayerStillExists
      && skuDeleteSuccessPostDeleteGets.length === 0
      ? []
      : ['sku-delete:success-was-not-confirmed-by-target-document-dom-without-post-delete-get']),
    ...(skuDeleteNoEffectWasReported
      && skuDeleteNoEffectAudit.pendingLayerIds.includes(skuDeleteNoEffectAudit.targetLayerId)
      && skuDeleteNoEffectAudit.targetLayerStillExists
      && skuDeleteNoEffectAudit.decoyLayerStillExists
      && skuDeleteNoEffectFailureData?.schema === 'sku-layer-cleanup-failure/v1'
      && skuDeleteNoEffectFailureData?.pendingLayerIds?.includes(skuDeleteNoEffectAudit.targetLayerId)
      && skuDeleteNoEffectFailureData?.failures?.some((failure) => failure?.stage === 'verify')
      && skuDeleteNoEffectPostDeleteGets.length === 0
      ? []
      : ['sku-delete:no-op-delete-was-accepted-or-verified-by-popup-prone-missing-layer-get']),
    ...(skuColorResolutionAudit?.exactMilkWhite === '奶白'
      && skuColorResolutionAudit?.colorSuffixMilkWhite === '奶白'
      && skuColorResolutionAudit?.ambiguousWhite === null
      && skuColorResolutionAudit?.uniqueFuzzyWhite === '白'
      && skuColorResolutionAudit?.uniqueFuzzyMilkWhite === '奶白'
      ? []
      : ['sku-color:exact-match-lost-to-prefix-or-ambiguous-fuzzy-match-picked-first']),
    ...(Array.isArray(skuLayoutPublicSchema?.properties?.action?.enum)
      && !skuLayoutPublicSchema.properties.action.enum.includes('executeOne')
      && !skuLayoutPublicSchema.properties.action.enum.includes('executeBatch')
      && Array.isArray(skuLayoutCapabilitiesAudit.result?.data?.actions)
      && !skuLayoutCapabilitiesAudit.result.data.actions.includes('executeOne')
      && !skuLayoutCapabilitiesAudit.result.data.actions.includes('executeBatch')
      && !String(
        skuLayoutCapabilitiesAudit.schema?.parameters?.properties?.action?.description || ''
      ).includes('executeOne')
      && !String(
        skuLayoutCapabilitiesAudit.schema?.parameters?.properties?.action?.description || ''
      ).includes('executeBatch')
      && legacyExecuteOneAudit.result?.success === false
      && legacyExecuteBatchAudit.result?.success === false
      && String(legacyExecuteOneAudit.result?.error || '').includes('action=execute')
      && String(legacyExecuteBatchAudit.result?.error || '').includes('action=execute')
      && legacyExecuteOneAudit.calls.length === 0
      && legacyExecuteBatchAudit.calls.length === 0
      && legacyExecuteOneAudit.modalCallCount === 0
      && legacyExecuteBatchAudit.modalCallCount === 0
      && skuParseConfigAudit.result?.success === true
      && String(skuParseConfigAudit.result?.data?.note || '').includes('action=execute')
      && !String(skuParseConfigAudit.result?.data?.note || '').includes('executeOne')
      && !String(skuParseConfigAudit.result?.data?.note || '').includes('executeBatch')
      ? []
      : ['sku-layout:legacy-execute-action-was-reexposed-or-entered-the-no-qa-path']),
    ...(skuDeleteFailureStopsCombo
      && !skuDeleteCopiedLayersText.includes('layerIds.length = 0')
      && skuExecuteComboLayoutText.includes('errors.push(`组合 ${comboIndex + 1}:')
      && skuExecuteComboLayoutText.includes(
        'const allCombosExported = exportedFiles.length === config.combos.length'
      )
      && skuExecuteComboLayoutText.includes('&& editableDocumentsComplete')
      && skuExecuteComboLayoutText.includes('&& errors.length === 0')
      ? []
      : ['sku-delete:cleanup-failure-can-continue-or-report-the-current-combo-as-success']),
    ...(detectedTerminalSkuLayerCleanupFailure
      === terminalSkuLayerCleanupFailureFixture.data.cleanupFailure
      && detectedTerminalSkuLayerCleanupFailure?.schema === 'sku-layer-cleanup-failure/v1'
      && detectedTerminalSkuLayerCleanupFailure?.pendingLayerIds?.includes(901)
      && ignoredNonCleanupFailure === null
      && terminalSkuLayerCleanupFailureReaderText.includes('result?.data?.cleanupFailure')
      && terminalSkuLayerCleanupFailureReaderText.includes("schema !== 'sku-layer-cleanup-failure/v1'")
      ? []
      : ['sku-agent-batch:structured-cleanup-failure-is-not-recognized-as-terminal']),
    ...(agentComboCleanupFailureStart >= 0
      && agentComboDeliverableStart > agentComboCleanupFailureStart
      && agentComboCleanupFailureBlock.includes('if (comboCleanupFailure)')
      && agentComboCleanupFailureBlock.includes('shouldStopComboBatches = true')
      && agentComboCleanupFailureBlock.includes('break;')
      && agentComboCleanupFailureBlock.includes('appendUniqueDiagnostics(allCopyErrors')
      && agentComboCleanupFailureBlock.includes('避免污染后续组合')
      ? []
      : ['sku-agent-batch:combo-cleanup-failure-does-not-stop-before-delivery']),
    ...(agentNoteCleanupFailureStart >= 0
      && agentNoteDeliverableStart > agentNoteCleanupFailureStart
      && agentNoteCleanupFailureBlock.includes('if (noteCleanupFailure)')
      && agentNoteCleanupFailureBlock.includes('noteBatchFailed = true')
      && agentNoteCleanupFailureBlock.includes('break;')
      && agentNoteCleanupFailureBlock.includes('appendUniqueDiagnostics(allCopyErrors')
      && skuBatchExecuteMethodText.includes('&& !noteBatchFailed')
      && skuBatchExecuteMethodText.indexOf('const noteFiles = Array.isArray(noteResult?.data?.exportedFiles)')
        > agentNoteCleanupFailureStart
      && skuBatchExecuteMethodText.indexOf('const allStagedPairsReady =')
        > agentNoteCleanupFailureStart
      && skuBatchExecuteMethodText.indexOf('promoteSkuStagedDeliverySet({')
        > skuBatchExecuteMethodText.indexOf('const allStagedPairsReady =')
      ? []
      : ['sku-agent-batch:note-cleanup-failure-can-continue-or-promote-staged-artifacts']),
    ...(skuPlaceholderFixtureInspection?.success === true
      && skuPlaceholderFixtureInspection?.data?.schema === 'sku-template-layout-inspection/v3'
      && skuPlaceholderFixtureInspection?.data?.slotCount === 1
      && inspectedPlaceholderSlots.length === 1
      && inspectedPlaceholderSlots[0]?.name === '形状参考'
      && inspectedPlaceholderSlots[0]?.layerId === 101
      && !inspectedPlaceholderSlots.some((slot) => slot?.name === '3' || slot?.layerId === 102)
      ? []
      : [`sku-template-inspection:full-canvas-numeric-design-group-became-slot:${JSON.stringify(skuPlaceholderFixtureInspection)}`]),
    ...(numericRegionSkuInspection?.success === true
      && numericRegionSkuInspection?.data?.schema === 'sku-template-layout-inspection/v3'
      && numericRegionSkuInspection?.data?.mode === 'legacy_multi_regions'
      && numericRegionSkuInspection?.data?.placementMethod === 'region_composition'
      && numericRegionSkuInspection?.data?.slotCount === 2
      && numericRegionSkuSlots.map((slot) => slot?.layerId).join(',') === '201,202'
      && !numericRegionSkuSlots.some((slot) => slot?.layerId === 203 || slot?.layerId === 204)
      && (numericRegionSkuInspection?.data?.blockers || []).length === 0
      && numericRegionSkuPreflight.skuPlaceholderReliability === 'legacy_reliable'
      && numericRegionSkuPreflight.layoutPlan?.status === 'ready'
      && numericRegionSkuPreflight.layoutPlan?.confidence === 'high'
      && numericRegionSkuPreflight.layoutPlan?.requiresVisualConfirmation === false
      && JSON.stringify(numericRegionSkuPreflight.layoutPlan?.regionCapacities) === '[3,1]'
      ? []
      : [`sku-template-inspection:numeric-solid-color-regions-were-dropped:${JSON.stringify({
        inspection: numericRegionSkuInspection,
        preflight: numericRegionSkuPreflight
      })}`]),
    ...(unmovedBoundedSkuQa.status === 'blocked'
      && unmovedBoundedSkuQa.blockers.some((message) => message.includes('不能把计划框当作 Photoshop 执行结果'))
      && skuAutoLayoutApplicationText.includes('actualBounds: finalReadback.bounds')
      && !skuAutoLayoutApplicationText.includes('actualBounds: placement.destinationBox')
      ? []
      : ['sku-layout:unmoved-live-bounds-were-replaced-by-planned-destination']),
    ...(resolveLocalStagingPathText.includes('path.isAbsolute(rawPath)')
      && resolveLocalStagingPathText.includes('isUnsupportedPathNamespace(rawPath)')
      && resolveLocalStagingPathText.includes("segment.includes(':')")
      && resolveLocalStagingPathText.includes('/[. ]$/')
      && reparseSegmentGuardText.includes('currentStat.isSymbolicLink()')
      && validatedTransactionRemovalText.includes('findReparsePointInsideDirectory(stagingRoot)')
      && validatedTransactionRemovalText.includes('fsPromises.rm(stagingRoot, { recursive: true, force: false })')
      && transactionIssueText.includes('randomBytes(32).toString')
      && transactionIssueText.includes('writeDurableJsonExclusive(ownerMarkerPath(stagingRoot)')
      && transactionIssueText.includes('guardStagingParentAgainstUnresolvedTransactions(')
      && transactionRootCleanupText.includes("transaction.phase === 'promoting'")
      && transactionRootCleanupText.includes("transaction.phase === 'recovery_required'")
      && transactionRootCleanupText.includes('inspectTransactionForReconciliation(marker)')
      && transactionRootCleanupText.includes('removeValidatedTransactionRoot(transaction.stagingRoot)')
      && transactionParentCleanupText.includes("transaction.phase !== 'root_cleaned'")
      && transactionParentCleanupText.includes('fsPromises.rmdir(transaction.stagingParent)')
      && transactionParentCleanupText.includes("reason = 'not_empty'")
      && !transactionParentCleanupText.includes('recursive: true')
      && !skuStagingTransactionServiceText.includes('shell.trashItem(')
      && fileSystemHandlersText.includes("ipcMain.handle('fs:issueSkuStagingTransaction'")
      && fileSystemHandlersText.includes("ipcMain.handle('fs:captureSkuStagingDestinationBaselines'")
      && preloadText.includes('removeSkuStagingParentIfEmpty')
      && preloadText.includes("ipcRenderer.invoke('fs:removeSkuStagingParentIfEmpty'")
      && preloadText.includes('removeSkuStagingTransactionRoot')
      && preloadText.includes("ipcRenderer.invoke('fs:removeSkuStagingTransactionRoot'")
      && preloadText.includes('promoteStagedFileSet: (')
      && rendererTypesText.includes('removeSkuStagingParentIfEmpty')
      && rendererTypesText.includes('removeSkuStagingTransactionRoot')
      && rendererTypesText.includes('promoteStagedFileSet: (input: StagedFilePromotionInput)')
      && skuBatchExecutorText.includes('skuStagingTransaction = await issueSkuStagingTransaction(')
      && skuBatchExecutorText.includes("String(projectContext?.projectPath || '').trim()")
      && !skuBatchExecutorText.includes("'fs:createDirectory',\n                settledOutputDir")
      && skuBatchExecutorText.includes('skuStagingTransaction.transactionToken')
      && skuBatchExecutorText.includes('const finalizeSkuStagingOnce = async (): Promise<SkuStagedDeliveryResult> =>')
      && rendererStagedFileTransactionText.includes('result = await host.removeSkuStagingParentIfEmpty(')
      && rendererStagedFileTransactionText.includes('result = await host.removeSkuStagingTransactionRoot(')
      && rendererStagedFileTransactionText.includes('空临时文件目录清理响应中断')
      && rendererStagedFileTransactionText.includes('临时文件事务根清理响应中断')
      && rendererStagedFileTransactionText.includes("result?.reason === 'not_empty'")
      && rendererStagedFileTransactionText.includes('if (input.preserveStagingRoot)')
      && rendererStagedFileTransactionText.includes('preserveStagingRoot: true')
      && stagedDeliveryPromotionText.includes('result?.rollbackComplete !== true')
      && stagedDeliveryPromotionText.includes('文件状态未知，已保留恢复现场')
      && skuBatchExecutorText.includes('preserveSkuStagingRoot = promotion.preserveStagingRoot === true')
      && skuBatchExecutorText.includes('finalizeSkuStagingCleanup({')
      && skuBatchExecutorText.includes('preserveStagingRoot: preserveSkuStagingRoot')
      && skuStagingFileCleanupIndex >= 0
      && skuStagingParentCleanupIndex > skuStagingFileCleanupIndex
      && !skuBatchExecutorText.includes('noteStagingRoot')
      && !skuBatchExecutorText.includes('buildSkuStagingPaths')
      && !skuBatchExecutorText.includes('finalizeSkuNoteStagingCleanup')
      ? []
      : ['sku-staging:empty-parent-cleanup-is-not-atomic-non-recursive-and-wired-after-file-cleanup'])
  ];
  const skuWorkflowEfficiencyViolations = [
    ...(publicSkuDeliverySummary.warningCount === 1
      && publicSkuDeliverySummary.warnings.includes('插件无法正确识别 3 双模板的占位结构，本次已停止该规格，避免排版错误。')
      && publicSkuDeliverySummary.warningGroupCount === 1
      && publicSkuDeliverySummary.detailText.includes('执行提示（1类，原始1条）')
      && publicSkuDeliverySummary.detailText.includes('插件无法正确识别 3 双模板的占位结构，本次已停止该规格，避免排版错误。')
      && !publicSkuDeliverySummary.detailText.includes('execution contract')
      && !publicSkuDeliverySummary.detailText.includes('Photoshop revision')
      && !publicSkuDeliverySummary.detailText.includes('runtime diagnostic')
      && skuDeliverySummaryText.includes('userWarnings?: string[]')
      && skuDeliverySummaryText.includes('normalizeTextList(input.userWarnings)')
      && skuBatchExecutorText.includes('skuPrivateDiagnostics: buildSkuPrivateDiagnostics')
      && skuBatchExecutorText.includes('userWarnings: skuUserWarnings')
      && skuBatchExecutorText.includes('hasExecutionWarnings: hasWarnings')
      && agentDiagnosticRecordText.includes('skuPrivateDiagnostics?: unknown')
      && messageParserText.includes("{ label: '问题', value: issueValue }")
      ? []
      : ['sku-diagnostics:user-summary-and-private-diagnostic-channels-are-not-separated']),
    ...(groupedFailureSkuDeliverySummary.presentationMode === 'sku_delivery_owned'
      && groupedFailureSkuDeliverySummary.warningCount === 49
      && groupedFailureSkuDeliverySummary.warningGroupCount === 1
      && groupedFailureSkuDeliverySummary.warningGroups[0]?.count === 49
      && groupedFailureSkuDeliverySummary.warningGroups[0]?.sizes.join(',') === '2,3,4'
      && groupedFailureSkuDeliverySummary.issueCount === 3
      && groupedFailureSkuDeliverySummary.primaryIssue === '2双第1组版面检查未通过，未计为完成（同类49条）'
      && groupedFailureSkuDeliverySummary.compactText.length < 120
      && groupedFailureSkuDeliverySummary.compactText.includes('同类49条')
      && groupedFailureSkuDeliverySummary.detailText.includes('交付缺口（2类）')
      && groupedFailureSkuDeliverySummary.detailText.includes('执行提示（1类，原始49条）')
      && groupedFailureSkuDeliverySummary.detailText.includes(noisySkuWarnings[0])
      && groupedFailureSkuDeliverySummary.detailText.split(noisySkuWarnings[0]).length - 1 === 1
      && groupedFailureRenderedMessage.blocks.filter((block) => block.type === 'card').length === 1
      && groupedFailureRenderedMessage.blocks.filter((block) => block.type === 'collapsible').length === 1
      && groupedFailureRenderedMessage.blocks.filter((block) => block.type === 'text').length === 0
      && groupedFailureRenderedMessage.blocks.filter((block) => block.type === 'tool_result').length === 0
      && skuBatchExecutorText.includes('const successMessage = finalDeliverySuccess')
      && skuBatchExecutorText.includes(
        '? `${skuDeliverySummary.compactText} 同步生成 ${skuEditableDeliveryReadback.verifiedCount} 份逐行可编辑 PSB。`'
      )
      && skuBatchExecutorText.includes('最终文件集合未通过完整核对，本次未标记为完成。')
      && messageParserText.includes('function isSkuDeliveryPresentationOwned(')
      && !messageParserText.includes('normalizedContent === normalizedCompact')
      && !chatPanelText.includes("if (!finalization.committed || finalization.status !== 'succeeded')")
      && interactiveContinuationOperationStoreText.includes('outcomeSummary: input.summary')
      && interactiveContinuationOperationStoreText.includes('系统不会自动重复执行')
      && !interactiveContinuationOperationStoreText.includes('无法排除 Photoshop 已产生写入：${detail}')
      && !chatPanelText.includes('executionMessage = ledgerState.record?.outcomeSummary')
      ? []
      : ['sku-delivery-presentation:repeated-batch-diagnostics-were-not-grouped-under-one-owner']),
    ...(distinctWarningSkuDeliverySummary.warningGroupCount === 2
      && distinctWarningSkuDeliverySummary.detailText.includes('4双自选备注的版面检查发现位置或尺寸异常，该项未计为完成。')
      && distinctWarningSkuDeliverySummary.detailText.includes('Photoshop 插件版本缺少自动排版能力，请重新加载插件。')
      && isSkuDeliveryPresentationSummary(groupedFailureSkuDeliverySummary)
      && !isSkuDeliveryPresentationSummary({ version: 'bad' })
      && !isSkuDeliveryPresentationSummary({
        version: 'sku-delivery-summary/v0',
        presentationMode: 'sku_delivery_owned'
      })
      && !isSkuDeliveryPresentationSummary(damagedProjectionSkuSummary)
      && !isSkuDeliveryPresentationSummary(invalidIssueCodeSkuSummary)
      && !isSkuDeliveryPresentationSummary(invalidExportCountSkuSummary)
      && !isSkuDeliveryPresentationSummary(invalidComboCountSkuSummary)
      && !isSkuDeliveryPresentationSummary(invalidNoteCountSkuSummary)
      && !isSkuDeliveryPresentationSummary(missingProcessedSkuSummary)
      && !isSkuDeliveryPresentationSummary(phantomProcessedSkuSummary)
      && !isSkuDeliveryPresentationSummary(offRequestNoteSkuSummary)
      && !isSkuDeliveryPresentationSummary(completedWithoutOutputSkuSummary)
      && !isSkuDeliveryPresentationSummary(failedWithOutputSkuSummary)
      && !isSkuDeliveryPresentationSummary(partialWithoutIssueSkuSummary)
      && !isSkuDeliveryPresentationSummary(emptyWarningSkuSummary)
      // 2026-08-18 用户拍板关闭通用「当前版本」状态卡（SHOW_EXECUTION_SUMMARY_CARD=false）后，
      // 落到通用卡的 SKU 病态摘要不再渲染成卡片；真实失败正文由模型正文与运行档案承担。
      // 关卡开着时仍要求这些正文不丢；关卡关着时只要求不出现「SKU 交付状态」冒充。
      && (executionSummaryCardDisabled || malformedVersionSkuBlocksText.includes('真实失败：4双自选备注未生成。'))
      && (executionSummaryCardDisabled || incompleteOwnedSkuBlocksText.includes('真实失败：4双自选备注未生成。'))
      && !incompleteOwnedSkuBlocksText.includes('SKU 交付状态')
      && (executionSummaryCardDisabled || damagedProjectionSkuBlocksText.includes('不能丢失的真实失败正文。'))
      && (executionSummaryCardDisabled || damagedProjectionSkuBlocksText.includes('真实工具失败：版面读回失败。'))
      && !damagedProjectionSkuBlocksText.includes('SKU 交付状态')
      && messageParserText.includes('isSkuDeliveryPresentationSummary(summary)')
      && messageParserText.includes('const hasBusinessDeliveryResult = isSkuDeliveryPresentationOwned(')
      ? []
      : ['sku-delivery-presentation:warning-causes-or-malformed-summary-fail-open-were-lost']),
    ...(completedSkuDeliveryWithCleanupAdvisory.status === 'completed'
      && completedSkuDeliveryWithCleanupAdvisory.issueCount === 0
      && completedSkuDeliveryWithCleanupAdvisory.warningCount === 0
      && completedSkuDeliveryWithCleanupAdvisory.advisoryCount === 1
      && completedSkuDeliveryWithCleanupAdvisory.detailText.includes('不影响本次交付状态')
      && skuBatchExecutorText.includes('recordSkuAdvisory(')
      && skuBatchExecutorText.includes('userAdvisories: skuUserAdvisories')
      && !skuBatchExecutorText.includes("recordSkuDiagnostic(\n                                `${size}双自选备注临时目录清理失败")
      ? []
      : ['sku-delivery-presentation:post-delivery-cleanup-warning-downgraded-completed-output']),
    ...(boundedSkuPlans.every((plan, index) => (
      plan.status === 'ready'
      && plan.placements.length === index + 2
      && plan.placements.every((placement) => (
        placement.destinationBox.left >= boundedSkuRegion.left
        && placement.destinationBox.top >= boundedSkuRegion.top
        && placement.destinationBox.right <= boundedSkuRegion.right
        && placement.destinationBox.bottom <= boundedSkuRegion.bottom
      ))
    )) && boundedSkuPlanQa.every((qa) => qa.status === 'ready')
      ? []
      : ['sku-layout:bounded-region-subslots-do-not-cover-2-3-4-with-real-bounds-qa']),
    ...(boundedSkuNotePlan.status === 'ready'
      && boundedSkuNotePlan.strategy === 'single-row'
      && boundedSkuNotePlan.placements.length === 4
      && boundedSkuNoteQa.status === 'ready'
      && boundedSkuNotePlan.placements.every((placement, index) => (
        placement.row === 0
        && placement.column === index
        && placement.sizingPolicy === 'uniform-width-contain'
        && placement.destinationBox.left >= boundedSkuRegion.left
        && placement.destinationBox.top >= boundedSkuRegion.top
        && placement.destinationBox.right <= boundedSkuRegion.right
        && placement.destinationBox.bottom <= boundedSkuRegion.bottom
        && Math.abs(placement.cellBox.width - boundedSkuNotePlan.placements[0].cellBox.width) < 0.001
        && Math.abs(placement.destinationBox.width - boundedSkuNotePlan.placements[0].destinationBox.width) < 0.001
        && (
          index === 0
          || placement.destinationBox.left > boundedSkuNotePlan.placements[index - 1].destinationBox.left
        )
      ))
      ? []
      : ['sku-note:single-region-does-not-produce-four-equal-real-card-widths']),
    ...([explicitTwoRegionNotePlan, explicitOrderedSlotNotePlan].every((plan) => {
      const widths = plan.placements.map((placement) => placement.destinationBox.width);
      const centerYs = plan.placements.map((placement) => (
        placement.destinationBox.top + placement.destinationBox.height / 2
      ));
      return plan.status === 'ready'
        && plan.strategy === 'single-row'
        && plan.placements.length === 4
        && Math.max(...widths) - Math.min(...widths) < 0.001
        && Math.max(...centerYs) - Math.min(...centerYs) < 0.001
        && plan.placements.every((placement, index) => {
          const source = boundedSkuSourceSizes[index];
          const destinationRatio = placement.destinationBox.width / placement.destinationBox.height;
          return placement.row === 0
            && placement.column === index
            && placement.sizingPolicy === 'uniform-width-contain'
            && placement.destinationBox.left >= placement.cellBox.left
            && placement.destinationBox.top >= placement.cellBox.top
            && placement.destinationBox.right <= placement.cellBox.right
            && placement.destinationBox.bottom <= placement.cellBox.bottom
            && Math.abs(destinationRatio - source.width / source.height) < 0.000001
            && (index === 0 || placement.destinationBox.left > plan.placements[index - 1].destinationBox.left);
        });
    })
      && explicitTwoRegionNoteQa.status === 'ready'
      && explicitOrderedSlotNoteQa.status === 'ready'
      && explicitTwoRowNotePlan.status === 'blocked'
      && explicitTwoRowNotePlan.diagnostics.blockers.some((message) => message.includes('同一水平行'))
      && shrunkenExplicitNoteQa.status === 'blocked'
      && shrunkenExplicitNoteQa.blockers.some((message) => message.includes('外框尺寸'))
      ? []
      : ['sku-note:multi-region-or-ordered-slots-do-not-enforce-one-global-equal-width-row']),
    ...(incompleteBoundedSkuQa.status === 'blocked'
      && incompleteBoundedSkuQa.blockers.some((message) => message.includes('最终实时边界数量'))
      ? []
      : ['sku-layout:missing-copied-card-did-not-block-export-qa']),
    ...(mismatchedBoundedSkuRootQa.status === 'blocked'
      && mismatchedBoundedSkuRootQa.blockers.some((message) => message.includes('顶层颜色卡 ID 集合'))
      && invalidBoundedSkuExpectedCountQa.status === 'blocked'
      && invalidBoundedSkuExpectedCountQa.blockers.some((message) => message.includes('大于 0 的整数'))
      ? []
      : ['sku-note:root-layer-identity-or-expected-count-qa-can-be-bypassed']),
    ...(missingNoteOnlySizeCompletion.allRequestedOutputsComplete === false
      && missingNoteOnlySizeCompletion.incompleteOutputs.some((item) => (
        item.size === 4
        && item.kind === 'note'
        && item.expected === 1
        && item.completed === 0
      ))
      && completeNoteOnlySizeCompletion.allRequestedOutputsComplete === true
      && duplicateNoteOnlySizeCompletion.allRequestedOutputsComplete === false
      ? []
      : ['sku-delivery:note-only-size-with-empty-combos-was-vacuously-complete']),
    ...(invalidStagedNoteReadback.status === 'blocked'
      && invalidStagedNoteReadback.failedFileProbeCount > 0
      && wrongSizeStagedNoteReadback.status === 'blocked'
      && wrongSizeStagedNoteReadback.dimensionMismatchCount === 1
      && wrongPathSameCountReadback.status === 'blocked'
      && wrongPathSameCountReadback.missingFileProbeCount === 1
      && wrongPathSameCountReadback.blockers.some((message) => message.includes('不属于本次精确导出集合'))
      && duplicatePathProbeReadback.status === 'blocked'
      && duplicatePathProbeReadback.missingFileProbeCount === 1
      && duplicatePathProbeReadback.blockers.some((message) => message.includes('重复文件探针'))
      ? []
      : ['sku-delivery:file-probes-were-not-bound-one-to-one-to-exact-export-paths']),
    ...(frozenSkuExportInventory.status === 'ready'
      && frozenSkuExportInventory.items.length === 8
      && frozenSkuExportInventory.boundaries.frozenBeforeBatchExecution === true
      && frozenSkuExportInventory.boundaries.doesNotScanSourceDirectory === true
      && frozenSkuExportInventory.boundaries.doesNotAcceptObservedFilesAsExpectation === true
      && frozenSkuExportInventory.items.some((item) => item.path === 'C:\\project\\SKU\\2双组合\\1奶白+黑色.jpg')
      && frozenSkuExportInventory.items.some((item) => item.path === 'C:\\project\\SKU\\2双组合\\2浅咖+深咖.jpg')
      && frozenSkuExportInventory.items.some((item) => item.path === 'C:\\project\\SKU\\2双自选备注\\2双自选备注-1.jpg')
      && frozenSkuExportInventory.items.some((item) => item.path === 'C:\\project\\SKU\\2双自选备注\\2双自选备注-2.jpg')
      && frozenSkuExportInventory.items.some((item) => item.path === 'C:\\project\\SKU\\3双组合\\1奶白+浅咖+黑色.jpg')
      && frozenSkuExportInventory.items.some((item) => item.path === 'C:\\project\\SKU\\3双自选备注\\3双自选备注.jpg')
      && frozenSkuExportInventory.items.some((item) => item.path === 'C:\\project\\SKU\\4双组合\\1奶白+浅咖+深咖+黑色.jpg')
      && frozenSkuExportInventory.items.some((item) => item.path === 'C:\\project\\SKU\\4双自选备注\\4双自选备注.jpg')
      && exactFrozenSkuReadback.status === 'ready_for_review'
      && exactFrozenSkuReadback.actualExportCount === 8
      && exactFrozenSkuReadback.missingActualExportCount === 0
      && exactFrozenSkuReadback.unexpectedActualExportCount === 0
      && exactFrozenSkuReadback.duplicateActualExportCount === 0
      && exactFrozenSkuReadback.staleFileProbeCount === 0
      && wrongActualSameCountSkuReadback.status === 'blocked'
      && wrongActualSameCountSkuReadback.missingActualExportCount === 1
      && wrongActualSameCountSkuReadback.unexpectedActualExportCount === 1
      && duplicateActualSkuReadback.status === 'blocked'
      && duplicateActualSkuReadback.missingActualExportCount === 1
      && duplicateActualSkuReadback.duplicateActualExportCount === 1
      && staleFrozenSkuReadback.status === 'blocked'
      && staleFrozenSkuReadback.staleFileProbeCount === 8
      && violatedFrozenSkuReadback.status === 'blocked'
      && violatedFrozenSkuReadback.blockers.some((message) => message.includes('导出清单违例'))
      ? []
      : ['sku-delivery:frozen-export-inventory-did-not-bind-plan-results-probes-and-freshness']),
    ...(selectedConventionSkuInventory.status === 'ready'
      && selectedConventionSkuInventory.outputDir === 'C:\\project\\店铺交付\\色卡成品'
      && selectedConventionSkuInventory.editableOutputDir === 'C:\\project\\店铺交付\\色卡成品\\分层源稿'
      && selectedConventionSkuInventory.items[0]?.path === 'C:\\project\\店铺交付\\色卡成品\\2双成品\\1-奶白+黑色.jpg'
      && selectedConventionSkuInventory.items[0]?.editablePath === 'C:\\project\\店铺交付\\色卡成品\\分层源稿\\2双成品\\1-奶白+黑色-分层.psb'
      && selectedConventionSkuInventory.items[0]?.stagedRasterRelativePath === '2双组合\\1奶白+黑色.jpg'
      && selectedConventionSkuInventory.items[0]?.stagedEditableRelativePath === '可编辑\\2双组合\\1奶白+黑色.psb'
      && selectedConventionSkuInventory.deliveryPlanDigest?.startsWith('skill-delivery-plan/v1:')
      && /^skill-delivery-plan\/v1:[a-f0-9]{64}$/.test(selectedConventionSkuInventory.deliveryPlanDigest || '')
      && selectedConventionSkuInventory.deliveryPlan?.artifacts.length === 2
      && selectedConventionSkuInventory.boundaries.conventionContainsNoVisualDecisions === true
      && posixStagingPath === '/tmp/project/SKU/.designecho-staging/run-1/可编辑/2双组合/1白+黑.psb'
      && posixVolumeFallbackSkuInventory.status === 'ready'
      && posixVolumeFallbackSkuInventory.outputDir === '/Volumes/Design Disk/Project/SKU'
      && posixVolumeFallbackSkuInventory.items[0]?.path === '/Volumes/Design Disk/Project/SKU/2双组合/1奶白+黑色.jpg'
      && windowsStagingIdentityMatches
      && posixStagingIdentityPreservesCase
      && unauthorizedReplaceSkuInventory.status === 'blocked'
      && unauthorizedReplaceSkuInventory.deliveryPlanDigest === undefined
      && unauthorizedReplaceSkuInventory.blockers.some((message) => message.includes('不能授权覆盖同名文件'))
      && skuBatchExecutorText.indexOf('const deliveryConventionResolution = resolveSkuFullDeliveryConvention(params.deliveryConvention)')
        < skuBatchExecutorText.indexOf("if (skuStage === 'color-card')")
      && skuBatchExecutorText.includes("status: 'blocked_invalid_skill_delivery_convention'")
      && skuBatchExecutorText.includes('const fallbackOutputDir = projectContext?.projectPath')
      && !skuBatchExecutorText.includes('const outputDir = projectContext?.projectPath ? `${projectContext.projectPath}\\\\SKU`')
      && skuBatchExecutorText.includes("joinSkuExportPath(projectContext.projectPath, '模板文件')")
      && skuBatchExecutorText.includes("joinSkuExportPath(projectContext.projectPath, 'SKU')")
      && !skuBatchExecutorText.includes('`${projectContext.projectPath}\\\\SKU`')
      && skuBatchExecutorText.includes('deliveryConvention: params.deliveryConvention')
      && skuBatchExecutorText.includes('const settledOutputDir = String(expectedExportInventory.outputDir || \'\').trim()')
      && skuBatchExecutorText.includes('expectedStagedPath: joinSkuExportPath(')
      && skuBatchExecutorText.includes('expectedDeliveryPlan: expectedExportInventory.deliveryPlanDigest')
      && skuBatchExecutorText.includes("status: 'sku_source_prerequisite_prepared'")
      && skuBatchExecutorText.includes("status: 'sku_template_prerequisite_prepared'")
      && skuBatchExecutorText.includes("status: 'sku_template_repair_prerequisite_completed'")
      ? []
      : ['sku-delivery:skill-selected-convention-did-not-compile-and-bind-exact-artifacts']),
    ...(validUniformScalePlacementReceipt.verified === true
      && validUniformScalePlacementReceipt.doesNotClaimAestheticQuality === true
      && wrongIdentityUniformScalePlacementReceipt.verified === false
      && wrongIdentityUniformScalePlacementReceipt.checks.sourceIdentity === false
      && staleUxpUniformScalePlacementReceipt.verified === false
      && staleUxpUniformScalePlacementReceipt.checks.sourceIdentity === false
      && missingDocumentIdentityPlacementReceipt.verified === false
      && missingDocumentIdentityPlacementReceipt.checks.documentIdentity === false
      && croppedUniformScalePlacementReceipt.verified === false
      && croppedUniformScalePlacementReceipt.checks.containedWithoutFrameCrop === false
      && stretchedNarrowPlacementReceipt.verified === false
      && stretchedNarrowPlacementReceipt.checks.assetAspectRatioPreserved === false
      ? []
      : ['sku-color-card:uniform-scale-placement-was-not-bound-to-source-bounds-and-alpha-facts']),
    ...(flatClippingRecord?.status === 'passed'
      && flatClippingRecord.verificationRef === 'quality-adapter:sku-color-card-clipping:not-applicable-flat'
      && cardMissingClippingRecord?.status === 'needs_review'
      ? []
      : ['sku-color-card:flat-clipping-not-applicable-was-missing-or-falsely-applied-to-card']),
    ...(completedSkuDeliveryOutcome.success === true
      && completedSkuDeliveryOutcome.status === 'completed'
      && partialSkuDeliveryOutcome.success === false
      && partialSkuDeliveryOutcome.status === 'partial'
      && blockedReadbackSkuDeliveryOutcome.success === false
      && blockedReadbackSkuDeliveryOutcome.status === 'blocked_export_readback'
      ? []
      : ['sku-delivery:partial-or-blocked-readback-was-reported-success']),
    ...(uxpSkuAutoLayoutPlanText.includes('buildSkuBoundedRegionLayoutPlan')
      && uxpSkuAutoLayoutPlanText.includes('buildSkuExplicitSingleRowLayoutPlan')
      && uxpSkuLayoutText.includes('buildSkuBoundedRegionLayoutPlan({')
      && uxpSkuLayoutText.includes('buildSkuExplicitSingleRowLayoutPlan({')
      && uxpSkuLayoutText.includes('validLayerIds.length !== regionColors.length')
      && uxpSkuLayoutText.includes('assertCopiedSkuLayerStructure({')
      && uxpSkuLayoutText.includes('const notePlannerLayerIds: number[] = []')
      && uxpSkuLayoutText.includes('const uniqueNotePlannerLayerIds = Array.from(new Set(notePlannerLayerIds))')
      && uxpSkuLayoutText.includes('readLiveSkuLayerBounds(documentId, layerId)')
      && uxpSkuLayoutText.includes('expectedTopLevelLayerIds: uniqueNotePlannerLayerIds')
      && uxpSkuLayoutText.includes("mode: 'bounded_note_region'")
      && uxpSkuLayoutText.includes("mode: useGlobalFourCardNoteLayout")
      && uxpSkuLayoutText.includes("strategy: 'single-row'")
      && uxpSkuLayoutText.includes("'uniform-width-contain'")
      && uxpSkuLayoutText.includes("actions: ['inspectTemplateLayout', 'execute', 'arrangeDynamic']")
      && skuBatchExecutorText.includes('skuRuntimeReadiness.result || skuLayoutCapabilitiesResult')
      && skuBatchExecutorText.includes("'arrangeDynamic'")
      && skuBatchExecutorText.includes("regionCapacities: noteLayoutPlan?.placementMethod === 'region_composition'")
      && skuBatchExecutorText.includes('const noteBatchDeliverable = noteResult?.success === true')
      && skuBatchExecutorText.includes('&& hasReadyNoteQa')
      && skuBatchExecutorText.includes('noteResult?.data?.exportedCount === 1')
      && skuBatchExecutorText.includes('&& noteFiles.length === 1')
      && !skuBatchExecutorText.includes('if (!onlyNotes && combos.length === 0) continue;')
      && skuBatchExecutorText.includes('for (const resolvedAssets of resolvedSkuAssetsBySize.values())')
      && skuBatchExecutorText.includes('if (!shouldRunCombo && !shouldRunNote) continue;')
      && skuBatchExecutorText.includes('if (shouldRunCombo && templateDoc)')
      && skuBatchExecutorText.includes('if (shouldRunNote)')
      && skuBatchExecutorText.includes('const requestedOutputRequirements = Array.from(resolvedSkuAssetsBySize.values())')
      && skuBatchExecutorText.includes('const expectedExportInventory = buildSkuExpectedExportInventory({')
      && skuBatchExecutorText.includes('skuStagingTransaction = await issueSkuStagingTransaction(')
      && skuBatchExecutorText.includes('const allDestinationBaselines = await captureSkuExportPathBaselines(')
      && skuBatchExecutorText.includes('skuStagingTransaction.transactionToken')
      && skuBatchExecutorText.includes('const expectedExportItemsById = new Map(')
      && skuBatchExecutorText.includes('expectedExportItemsById.get(`combo:${size}:${batch.rowStartIndex + comboIndex + 1}`)')
      && skuBatchExecutorText.includes('expectedExportItemsById.get(')
      && skuBatchExecutorText.includes('`note:${size}:${batch.rowStartIndex + 1}`')
      && skuBatchExecutorText.includes('expectedFinalPath: expectedNoteItem.path')
      && skuBatchExecutorText.includes('actualExportPaths: allFinalFiles')
      && skuBatchExecutorText.includes('expectedExports: expectedExportInventory.items.map((item) => ({')
      && skuBatchExecutorText.includes('inventoryViolations: exportInventoryViolations')
      && skuBatchExecutorText.includes('freshnessVerified: freshness.verified')
      && !skuBatchExecutorText.includes('expectedExportPaths: allFinalFiles')
      && !skuBatchExecutorText.includes('expectedExports: allFinalExportRecords')
      && skuBatchExecutorText.includes('const pendingRasterArtifactsByItemId = new Map<string, SkuStagedRasterExport>()')
      && skuBatchExecutorText.includes('const provisionalEditableDeliveryReceipts = new Map<string, SkuEditableDeliveryReceipt>()')
      && skuBatchExecutorText.includes('outputDir: skuStagingRoot')
      && skuBatchExecutorText.includes('editableOutputDir: editableStagingOutputDir')
      && skuBatchExecutorText.includes('parseSkuStagedRasterExport({')
      && skuBatchExecutorText.includes('const allStagedPairsReady = pendingRasterArtifactsByItemId.size')
      && skuBatchExecutorText.includes('pendingRasterArtifactsByItemId.size')
      && skuBatchExecutorText.includes('provisionalEditableDeliveryReceipts.size')
      && skuBatchExecutorText.includes('validateSkuStagedRasterExports(stagedRasterArtifacts)')
      && skuExportTransactionText.includes("readback.status !== 'ready_for_review'")
      && skuBatchExecutorText.indexOf('validateSkuStagedRasterExports(stagedRasterArtifacts)')
        < skuBatchExecutorText.indexOf('promoteSkuStagedDeliverySet({')
      && skuBatchExecutorText.includes('promoteSkuStagedDeliverySet({')
      && skuBatchExecutorText.includes('transaction: skuStagingTransaction')
      && stagedDeliveryPromotionText.includes('result = await host.promoteStagedFileSet({')
      && skuExportTransactionText.includes('transactionToken: input.transaction.transactionToken')
      && skuBatchExecutorText.includes('finalizeSkuStagingCleanup({')
      && skuBatchExecutorText.includes('preserveSkuStagingRoot = promotion.preserveStagingRoot === true')
      && rendererStagedFileTransactionText.includes('if (input.preserveStagingRoot)')
      && stagedDeliveryPromotionText.includes('result?.rollbackComplete !== true')
      && skuBatchExecutorText.indexOf('const stagingCleanup = await finalizeSkuStagingOnce()')
        < skuBatchExecutorText.indexOf('const skuDeliverySummary = buildSkuDeliverySummary({')
      && skuBatchExecutorText.includes('appendUniqueDiagnostics(skuUserAdvisories, [cleanupNotice])')
      && skuBatchExecutorText.includes('evaluateSkuRequestedOutputCompletion({')
      && skuBatchExecutorText.includes('const allRequestedOutputsComplete = requestedOutputCompletion.allRequestedOutputsComplete')
      && skuBatchExecutorText.includes('const runtimeArtifactSetExact = runtimeDeliveryArtifacts.length')
      && skuBatchExecutorText.includes('const finalDeliverySuccess = deliveryOutcome.success')
      && skuBatchExecutorText.includes('&& runtimeDeliveryPlanCommitBound;')
      && skuBatchExecutorText.includes('runtimeDeliveryPlanAuthority.freeze({')
      && skuBatchExecutorText.includes('runtimeDeliveryPlanAuthority.acceptExternalCommit({')
      && stagedDeliveryPromotionText.includes('runtimeDeliveryCommitReceipt: issueRuntimeOwnedSkillExternalDeliveryCommitReceipt({')
      && fileSystemHandlersText.includes("ipcMain.handle('fs:promoteStagedFileSet'")
      && skuStagingTransactionServiceText.includes('destinationBaselines: Map<string, SkuStagingDestinationBaseline>')
      && skuStagingTransactionServiceText.includes('readSkuStagingFrozenDestinationBaseline(')
      && stagedFilePromotionText.includes('await fsPromises.rename(item.destinationPath, item.backupPath)')
      && stagedFilePromotionText.includes('readSkuStagingFrozenDestinationBaseline(')
      && stagedFilePromotionText.includes('sameDestinationBaseline(rendererBaseline, expectedDestinationBaseline)')
      && stagedFilePromotionText.includes('await fsPromises.link(item.sourcePath, item.destinationPath)')
      && stagedFilePromotionText.includes('installedIdentity.sha256 !== item.sourceSha256')
      && stagedFilePromotionText.includes('const rollbackErrors = await rollbackPromotion(')
      && stagedFilePromotionText.includes("path.join(rollbackRoot, 'transaction-manifest.json')")
      && stagedFilePromotionText.includes("path.join(rollbackRoot, 'transaction-journal.jsonl')")
      && skuBatchExecutorText.includes('function hasReadySkuNoteAutoLayoutQa(result: any, expectedItemCount: number): boolean')
      && skuBatchExecutorText.includes('actualLayerIds.size === expected')
      && skuBatchExecutorText.includes('hasReadySkuNoteAutoLayoutQa(noteResult, noteExpectedItemCount)')
      && skuBatchExecutorText.includes('resolveSkuBatchDeliveryOutcome({')
      && skuBatchExecutorText.includes('success: finalDeliverySuccess')
      ? []
      : ['sku-layout:bounded-region-or-delivery-outcome-production-wiring-incomplete']),
    ...(skuProductionRecommendation?.skillId === 'sku-batch'
      && skuProductionRecommendation.advisoryOnly === true
      && skuProductionRecommendation.bindsRuntimeIdentity === false
      && skuProductionRecommendation.grantsPermission === false
      && authoritativeSkuProductionRecommendation?.skillId === 'sku-batch'
      && openSkuDesignRecommendation?.skillId === 'sku-batch'
      && bareSkuExecutionRecommendation?.skillId === 'sku-batch'
      && skuTemplateExecutionRecommendation?.skillId === 'sku-batch'
      && skuColorCardExecutionRecommendation?.skillId === 'sku-batch'
      && [
        openSkuDesignRecommendation,
        bareSkuExecutionRecommendation,
        skuTemplateExecutionRecommendation,
        skuColorCardExecutionRecommendation
      ].every((recommendation) => (
        recommendation?.advisoryOnly === true
        && recommendation.bindsRuntimeIdentity === false
        && recommendation.grantsPermission === false
      ))
      && skuReadOnlyRecommendation === undefined
      && skuReadOnlyAndPlanningRecommendations.every((recommendation) => recommendation === undefined)
      ? []
      : ['sku-skill:execution-recommendation-is-not-advisory-or-overroutes-readonly']),
    ...(skillRoutingText.includes("source: 'unique_declared_routing_match'")
      && engineText.includes('skillRoutingRecommendation')
      && executorText.includes('isSkillRoutingRecommendation(params.skillRoutingRecommendation)')
      && executorText.includes('skillRoutingRecommendation && exposeSkillRoutingRecommendation')
      && executorText.includes('const exposeSkillRoutingRecommendation = Boolean(')
      && executorText.includes("intentControlPlane?.toolScope !== 'none'")
      && executorText.includes('candidateTools.some((tool) => tool.name === skillRoutingRecommendation.skillId)')
      && executorText.includes('当前任务可能适合')
      && executorText.includes('相符就直接使用')
      && executorText.includes('如果并不匹配')
      && !executorText.includes('hasPendingRuntimeDesignWorkflowRecommendation(')
      && !executorText.includes('deferSkillBridgesUntilManifest')
      && !executorText.includes('requiredControlTool')
      && !engineText.includes('declaredSkillId: skillRoutingRecommendation.skillId')
      && realSkuEngineDecision.toolScope === 'write_photoshop'
      && realSkuEngineDecision.executionAuthorization === 'confirmed_tool_required'
      && !planNeutralSkuResolution.selectedCapabilityIds.includes('skill.sku-batch')
      && planNeutralSkuResolution.selectedCapabilityIds.includes('agent.intent.declareDesignTask')
      && planNeutralSkuResolution.selectedToolNames.includes('declareDesignIntent')
      && !planNeutralSkuResolution.onDemandCapabilityIds.includes('agent.intent.declareDesignTask')
      && !planNeutralSkuResolution.selectedToolNames.includes('sku-batch')
      && !planNeutralSkuResolution.onDemandCapabilityIds.includes('skill.sku-batch')
      && planNeutralSkuResolution.deniedCapabilityIds.includes('skill.sku-batch')
      && planNeutralSkuActivationAttempt.status === 'rejected'
      && planNeutralSkuActivationAttempt.activatedCapabilityIds.length === 0
      && planNeutralSkuActivationAttempt.issues.some((issue) => (
        issue.code === 'requested_capability_forbidden'
        && issue.capabilityId === 'skill.sku-batch'
      ))
      && Boolean(skuBatchManifest)
      && planNeutralSkuCapabilityRuntime.capabilitySession.activeTools === planNeutralSkuActiveToolsIdentity
      && boundSkuActiveSkillCapabilities.length === 1
      && boundSkuActiveSkillCapabilities[0] === 'skill.sku-batch'
      && boundSkuResolution.selectedToolNames.includes('sku-batch')
      && !boundSkuResolution.selectedToolNames.includes('main-image-design')
      && !boundSkuResolution.selectedToolNames.includes('detail-page-design')
      && !boundSkuResolution.selectedToolNames.includes('project-image-analysis')
      && manifestSkillOwnerBehavior.every((row) => row.ok)
      ? []
      : ['sku-workflow:advisory-recommendation-did-not-remain-visible-and-non-authoritative']),
    ...(validatedSavedSkuTemplateCandidate.status === 'validated'
      && preferredValidatedSavedSkuTemplate.status === 'validated_generated_candidate'
      && preferredValidatedSavedSkuTemplate.candidate?.id === 'generated-candidate-3'
      && preferredValidatedSavedSkuTemplate.boundaries.writesPhotoshop === false
      && preferredValidatedSavedSkuTemplate.boundaries.grantsPermission === false
      ? []
      : ['sku-template-selection:validated-saved-candidate-did-not-outrank-old-template']),
    ...(rejectedSavedSkuTemplateCandidate.status === 'rejected'
      && rejectedSavedSkuTemplateCandidate.reasonCode === 'candidate_read_failed'
      && failedSavedCandidateFallback.status === 'fallback_candidate'
      && failedSavedCandidateFallback.candidate?.id === 'old-broken-3'
      && failedSavedCandidateFallback.diagnostics.some((item) => item.includes('inspectTemplateLayout failed'))
      && failedSavedCandidateBlock.status === 'blocked_no_validated_candidate'
      && failedSavedCandidateBlock.candidate === null
      ? []
      : ['sku-template-selection:failed-saved-candidate-was-blindly-selected-or-not-diagnostic']),
    ...(skuBatchExecutorText.includes('resolveValidatedDesignEchoTemplateCandidate')
      && skuBatchExecutorText.includes('isExactTemplateDocument(doc, candidate.filePath)')
      && skuBatchExecutorText.includes('validateDesignEchoSkuTemplateCandidate({')
      && skuBatchExecutorText.includes('pickSkuTemplateCandidateWithValidatedGeneratedPriority({')
      && skuBatchExecutorText.includes('skuTemplateCandidateValidations.push({')
      && skuBatchExecutorText.includes('!isDesignEchoSkuTemplateCandidateDiscovery(candidate)')
      && sharedSkuTemplateScorerText.length > 0
      && !sharedSkuTemplateScorerText.includes('isDesignEchoSkuTemplateCandidateDiscovery')
      && !sharedSkuTemplateScorerText.includes('validated_generated_candidate')
      ? []
      : ['sku-template-selection:saved-candidate-validation-is-not-skill-owned-or-leaked-into-filename-score']),
    ...(selectedSharedUserTemplate?.id === 'user-3-tif'
      && selectedSharedNoteTemplate?.id === 'note-3-psd'
      && selectedSharedPriorityTemplate?.id === 'higher-priority'
      && pickBestSkuTemplateCandidate([
        sharedTemplateSelectionCandidates.find((item) => item.id === 'user-4-psd')
      ].filter(Boolean), { comboSize: 3, noteMode: false }) === null
      && unknownSizeTemplate === null
      && JSON.stringify(collectSkuTemplateSizes(sharedTemplateSelectionCandidates)) === JSON.stringify([3, 4])
      ? []
      : ['sku-template-selection:shared-scorer-does-not-preserve-user-template-spec-note-or-priority-semantics']),
    ...(skuTemplateSelectionText.includes('单一评分 owner')
      && skuBatchExecutorText.includes("from '../../../shared/sku-template-selection'")
      && templateKnowledgeServiceText.includes("from '../../shared/sku-template-selection'")
      && templateKnowledgeServiceText.includes('pickBestSkuTemplateCandidate(this.getSKUTemplateCandidates()')
      && !templateKnowledgeServiceText.includes('const scored = this.getSKUTemplateCandidates()')
      ? []
      : ['sku-template-selection:main-and-renderer-still-own-different-scorers']),
    ...(skuBatchExecutorText.includes('localLibrarySpecs = Array.from(new Set(localSkuTemplates')
      && !skuBatchExecutorText.includes('loadLocalLibrarySpecs')
      && skuBatchExecutorText.includes('ordinaryLocalTemplates = localSkuTemplates.filter')
      && skuBatchExecutorText.indexOf('pickBestTemplateFromLibrary(ordinaryLocalTemplates')
        < skuBatchExecutorText.indexOf("'template-knowledge:findTemplateForSKU'")
      ? []
      : ['sku-efficiency:template-inventory-is-rescanned-for-specs-or-common-matching']),
    ...(uxpListDocumentsText.includes('includePaths')
      && uxpListDocumentsText.includes('includeDimensions')
      && uxpListDocumentsText.includes('includeLayerCount')
      && skuBatchExecutorText.includes('includeLayerCount: false')
      && !skuBatchExecutorText.includes('listDocuments\', { includeDetails: true')
      ? []
      : ['sku-efficiency:document-polling-still-recursively-counts-all-layers']),
    ...(skillDeclarationsText.includes("'createTextLayer', 'setTextContent', 'createGroup'")
      ? []
      : ['sku-consistency:sku-workflow-does-not-declare-text-repair-capability'])
  ];

  function createEagleComposerAssetFixture(index) {
    return {
      schemaVersion: 'eagle-asset-ref/v0',
      libraryId: 'library-safe',
      libraryName: '设计素材库',
      itemId: `item-${index}`,
      name: `参考素材 ${index}`,
      ext: 'jpg',
      fileKind: 'image',
      role: 'reference',
      tags: ['首屏参考'],
      folderPaths: ['详情页 / 首屏'],
      width: 800,
      height: 1200,
      selectedAt: '2026-08-11T00:00:00.000Z'
    };
  }

  function buildRawEagleComposerPayload(assets, version = EAGLE_COMPOSER_DRAG_VERSION) {
    return JSON.stringify({
      version,
      kind: 'eagle_asset_refs',
      assets
    });
  }

  const eagleTransferAssetA = createEagleComposerAssetFixture(1);
  const eagleTransferAssetB = createEagleComposerAssetFixture(2);
  const eagleSafeSerialized = serializeEagleComposerDragPayload([
    eagleTransferAssetA,
    eagleTransferAssetB
  ]);
  const eagleSafeRoundTrip = eagleSafeSerialized
    ? parseEagleComposerDragPayload(eagleSafeSerialized)
    : null;
  const eagleDedupedSerialized = serializeEagleComposerDragPayload([
    eagleTransferAssetA,
    { ...eagleTransferAssetA },
    eagleTransferAssetB
  ]);
  const eagleDedupedRoundTrip = eagleDedupedSerialized
    ? parseEagleComposerDragPayload(eagleDedupedSerialized)
    : null;
  const eagleTwentyAssetRefs = Array.from(
    { length: 20 },
    (_, index) => createEagleComposerAssetFixture(index + 1)
  );
  const eagleCappedNormalized = normalizeEagleComposerAssetRefs(eagleTwentyAssetRefs);
  const eagleCappedSerialized = serializeEagleComposerDragPayload(eagleTwentyAssetRefs);
  const eagleCappedRoundTrip = eagleCappedSerialized
    ? parseEagleComposerDragPayload(eagleCappedSerialized)
    : null;
  const eaglePathFieldPayload = buildRawEagleComposerPayload([{
    ...eagleTransferAssetA,
    libraryPath: 'C:\\private\\design.library'
  }]);
  const eagleAllowedFieldPathPayload = buildRawEagleComposerPayload([{
    ...eagleTransferAssetA,
    name: 'C:\\private\\asset.jpg'
  }]);
  const eagleDataPayload = buildRawEagleComposerPayload([{
    ...eagleTransferAssetA,
    name: 'data:image/png;base64,AAAA'
  }]);
  const eagleBlobPayload = buildRawEagleComposerPayload([{
    ...eagleTransferAssetA,
    name: 'blob:https://example.invalid/asset-preview'
  }]);
  const eagleWrongVersionPayload = buildRawEagleComposerPayload(
    [eagleTransferAssetA],
    'eagle-composer-drag/v999'
  );
  const eagleOversizedPayload = 'x'.repeat(EAGLE_COMPOSER_DRAG_MAX_BYTES + 1);

  const eagleApplySelectionText = findFunction(eagleLibraryPageSource, 'applySelection')
    ?.getText(eagleLibraryPageSource) || '';
  const eagleHandleSelectItemText = findFunction(eagleLibraryPageSource, 'handleSelectItem')
    ?.getText(eagleLibraryPageSource) || '';
  const eagleAddAssetRefsText = findFunction(eagleLibraryPageSource, 'addAssetRefsToConversation')
    ?.getText(eagleLibraryPageSource) || '';
  const eagleAddCurrentSelectionText = findFunction(eagleLibraryPageSource, 'addCurrentSelectionToConversation')
    ?.getText(eagleLibraryPageSource) || '';
  const eagleHandleDragStartText = findFunction(eagleLibraryPageSource, 'handleAssetDragStart')
    ?.getText(eagleLibraryPageSource) || '';
  const workbenchAddEagleAssetsText = findVariableDeclaration(
    designAgentWorkbenchSource,
    'handleAddEagleAssetsToConversation'
  )?.getText(designAgentWorkbenchSource) || '';
  const workbenchConsumeEagleAssetsText = findVariableDeclaration(
    designAgentWorkbenchSource,
    'handleConsumeEagleComposerInsertRequest'
  )?.getText(designAgentWorkbenchSource) || '';
  const chatPanelPropsText = findInterfaceDeclaration(chatPanelSource, 'ChatPanelProps')
    ?.getText(chatPanelSource) || '';
  const chatInsertEagleRefsText = findVariableDeclaration(
    chatPanelSource,
    'insertEagleAssetRefsIntoComposer'
  )?.getText(chatPanelSource) || '';
  const chatHandleDropText = findVariableDeclaration(chatPanelSource, 'handleDrop')
    ?.getText(chatPanelSource) || '';
  const chatResolveDragKindText = findFunction(chatPanelSource, 'resolveComposerDragKind')
    ?.getText(chatPanelSource) || '';
  const buildEditableComposerPayloadText = findFunction(
    chatPanelSource,
    'buildEditableComposerPayload'
  )?.getText(chatPanelSource) || '';
  const handleStartMessageEditText = findVariableDeclaration(
    chatPanelSource,
    'handleStartEdit'
  )?.getText(chatPanelSource) || '';
  const handleConfirmMessageEditText = findVariableDeclaration(
    chatPanelSource,
    'handleConfirmMessageEdit'
  )?.getText(chatPanelSource) || '';
  const handleSendNode = findVariableDeclaration(chatPanelSource, 'handleSend');
  const handleSendText = handleSendNode?.getText(chatPanelSource) || '';
  const inlineEditCommitIf = collectNodes(handleSendNode, (node) => (
    ts.isIfStatement(node)
    && node.expression.getText(chatPanelSource).includes('inlineMessageEdit')
    && node.thenStatement.getText(chatPanelSource).includes('replaceUserMessageAndTruncate')
  ))[0];
  const inlineEditCommitBranchText = inlineEditCommitIf
    ?.thenStatement.getText(chatPanelSource) || '';
  const messageEditorText = findVariableDeclaration(chatPanelSource, 'messageEditor')
    ?.getText(chatPanelSource) || '';
  const inlineComposerPropsText = findInterfaceDeclaration(
    inlineMultimodalComposerSource,
    'InlineMultimodalComposerProps'
  )?.getText(inlineMultimodalComposerSource) || '';
  const inlineComposerComponentText = findVariableDeclaration(
    inlineMultimodalComposerSource,
    'InlineMultimodalComposer'
  )?.getText(inlineMultimodalComposerSource) || '';
  const messageRendererPropsText = findInterfaceDeclaration(
    messageRendererSource,
    'MessageRendererProps'
  )?.getText(messageRendererSource) || '';
  const messageRendererComponentText = findVariableDeclaration(
    messageRendererSource,
    'MessageRendererComponent'
  )?.getText(messageRendererSource) || '';
  const replaceUserMessageText = findPropertyAssignment(
    appStoreSource,
    'replaceUserMessageAndTruncate'
  )?.getText(appStoreSource) || '';
  const replaceUserMessageSetCount = (
    replaceUserMessageText.match(/\bset\s*\(\s*\{/g) || []
  ).length;
  const replaceUserMessageSaveCount = (
    replaceUserMessageText.match(/\bdebouncedSaveConversations\s*\(/g) || []
  ).length;
  const designAgentWorkbenchPropsText = findInterfaceDeclaration(
    designAgentWorkbenchSource,
    'DesignAgentWorkbenchProps'
  )?.getText(designAgentWorkbenchSource) || '';
  const userTextBubbleRuleText = cssRuleBody(
    messageRendererCssText,
    '.multimodal-message.user .text-block'
  );
  const userComposerBubbleRuleText = cssRuleBody(
    messageRendererCssText,
    '.multimodal-message.user .composer-content-block'
  );
  const userEditingBodyRuleText = cssRuleBody(
    messageRendererCssText,
    '.multimodal-message.user.is-editing .message-body'
  );
  const eagleOnAddInvocationCount = (
    eagleLibraryPageText.match(/onAddToConversation\s*\(/g) || []
  ).length;
  const eagleCardClickHandlerCount = (
    eagleLibraryPageText.match(/onClick=\{\(event\) => handleSelectItem\(item, event\)\}/g) || []
  ).length;
  const eagleComposerTransferViolations = [
    ...(EAGLE_COMPOSER_DRAG_MIME === 'application/x-designecho-eagle-assets+json'
      && eagleSafeSerialized
      && eagleSafeRoundTrip?.length === 2
      && eagleSafeRoundTrip[0].itemId === 'item-1'
      && eagleSafeRoundTrip[1].itemId === 'item-2'
      && !/(?:libraryPath|sourceFilePath|data:image|base64|blob:)/i.test(eagleSafeSerialized)
      ? []
      : ['eagle-transfer:safe-round-trip-order-or-payload-redaction-regressed']),
    ...(eagleDedupedRoundTrip?.length === 2
      && eagleDedupedRoundTrip[0].itemId === 'item-1'
      && eagleDedupedRoundTrip[1].itemId === 'item-2'
      ? []
      : ['eagle-transfer:duplicate-asset-refs-are-not-deduplicated-in-order']),
    ...(eagleCappedNormalized.length === 12
      && eagleCappedNormalized[0].itemId === 'item-1'
      && eagleCappedNormalized[11].itemId === 'item-12'
      && eagleCappedRoundTrip?.length === 12
      ? []
      : ['eagle-transfer:asset-ref-cap-is-not-twelve-or-order-was-lost']),
    ...(parseEagleComposerDragPayload(eaglePathFieldPayload) === null
      && parseEagleComposerDragPayload(eagleAllowedFieldPathPayload) === null
      ? []
      : ['eagle-transfer:path-bearing-payload-was-accepted']),
    ...(parseEagleComposerDragPayload(eagleDataPayload) === null
      && parseEagleComposerDragPayload(eagleBlobPayload) === null
      ? []
      : ['eagle-transfer:embedded-data-or-blob-preview-was-accepted']),
    ...(parseEagleComposerDragPayload(eagleWrongVersionPayload) === null
      ? []
      : ['eagle-transfer:wrong-version-payload-was-accepted']),
    ...(Buffer.byteLength(eagleOversizedPayload, 'utf8') > EAGLE_COMPOSER_DRAG_MAX_BYTES
      && parseEagleComposerDragPayload(eagleOversizedPayload) === null
      ? []
      : ['eagle-transfer:payload-over-64kib-was-accepted']),
    ...(eagleApplySelectionText.includes('setSelectedIds(nextIds)')
      && eagleApplySelectionText.includes('setSelectedItem(primaryItem)')
      && eagleApplySelectionText.includes('setSelectionAnchorId(anchorId)')
      && !eagleApplySelectionText.includes('onAddToConversation')
      && !eagleHandleSelectItemText.includes('onAddToConversation')
      && !eagleHandleSelectItemText.includes('addAssetRefsToConversation')
      && eagleCardClickHandlerCount === 2
      && !eagleLibraryPageText.includes('onSelectionChange')
      && !eagleLibraryPageText.includes('selectedItemId')
      ? []
      : ['eagle-library:ordinary-card-click-is-not-local-selection-only']),
    ...(eagleOnAddInvocationCount === 1
      && eagleAddAssetRefsText.includes('onAddToConversation(assetRefs)')
      && eagleAddCurrentSelectionText.includes('addAssetRefsToConversation(')
      && eagleHandleDragStartText.includes('serializeEagleComposerDragPayload(assetRefs)')
      && eagleHandleDragStartText.includes('dataTransfer.setData(EAGLE_COMPOSER_DRAG_MIME')
      && !eagleHandleDragStartText.includes('onAddToConversation')
      && eagleLibraryPageText.includes('onClick={addCurrentSelectionToConversation}')
      && eagleLibraryPageText.includes('onClick={() => addAssetRefsToConversation(contextMenu.assetRefs)}')
      ? []
      : ['eagle-library:conversation-insertion-is-not-limited-to-explicit-drag-menu-or-cta']),
    ...(designAgentWorkbenchText.includes('useState<EagleComposerInsertRequest | null>(null)')
      && designAgentWorkbenchText.includes('const eagleComposerInsertRevisionRef = useRef(0)')
      && workbenchAddEagleAssetsText.includes('eagleComposerInsertRevisionRef.current += 1')
      && workbenchAddEagleAssetsText.includes('setEagleComposerInsertRequest({')
      && workbenchConsumeEagleAssetsText.includes('current?.revision === revision ? null : current')
      && designAgentWorkbenchText.includes('onAddToConversation={handleAddEagleAssetsToConversation}')
      && designAgentWorkbenchText.includes('eagleComposerInsertRequest={eagleComposerInsertRequest}')
      && !designAgentWorkbenchText.includes('selectedEagleLibraryAsset')
      && !designAgentWorkbenchText.includes('selectedEagleAssetGroup')
      ? []
      : ['eagle-workbench:explicit-insert-request-is-not-independent-and-revision-bound']),
    ...(chatResolveDragKindText.indexOf('types.includes(EAGLE_COMPOSER_DRAG_MIME)') >= 0
      && chatResolveDragKindText.indexOf('types.includes(EAGLE_COMPOSER_DRAG_MIME)')
        < chatResolveDragKindText.indexOf("types.includes('Files')")
      ? []
      : ['eagle-composer:custom-eagle-mime-does-not-take-priority-over-files']),
    ...(chatPanelText.includes('insertEagleAssetRefsIntoComposer(request.assetRefs)')
      && chatHandleDropText.includes('parseEagleComposerDragPayload(')
      && chatHandleDropText.includes('insertEagleAssetRefsIntoComposer(assetRefs)')
      && chatInsertEagleRefsText.includes('insertComposerReference(reference, {')
      && !chatInsertEagleRefsText.includes('composerImages')
      && !chatInsertEagleRefsText.includes('addComposerImage')
      && !chatInsertEagleRefsText.includes('setComposerImages')
      ? []
      : ['eagle-composer:request-and-drop-do-not-share-reference-only-insert-helper']),
    ...(chatInsertEagleRefsText.includes("purpose: 'composer_ui'")
      && chatInsertEagleRefsText.includes('libraryId: assetRef.libraryId')
      && chatInsertEagleRefsText.includes('updateReferencePreview(reference.referenceId, result.dataUrl)')
      && !chatInsertEagleRefsText.includes("purpose: 'eagle_library_ui'")
      ? []
      : ['eagle-composer:preview-is-not-resolved-by-safe-composer-ui-reference']),
    ...(chatPanelPropsText.includes('eagleComposerInsertRequest?: EagleComposerInsertRequest | null')
      && chatPanelPropsText.includes('onConsumeEagleComposerInsertRequest?: (revision: number) => void')
      && !chatPanelPropsText.includes('selectedEagleLibraryAsset')
      && !chatPanelPropsText.includes('selectedEagleAssetGroup')
      ? []
      : ['eagle-composer:live-eagle-browse-selection-reentered-chat-panel-props']),
    ...(eagleComposerTransferText.includes("const EAGLE_COMPOSER_PAYLOAD_KEYS = new Set(['version', 'kind', 'assets'])")
      && eagleComposerTransferText.includes('hasOnlyKeys(candidate, EAGLE_ASSET_REF_KEYS)')
      && !eagleComposerTransferText.includes('libraryPath,')
      && !eagleComposerTransferText.includes('sourceFilePath,')
      ? []
      : ['eagle-transfer:drag-contract-is-no-longer-strictly-whitelisted'])
  ];

  const inlineMessageEditViolations = [
    ...(!chatPanelText.includes('editingComposerMessageId')
      && !chatPanelText.includes('composer-edit-banner')
      && !chatPanelText.includes('handleConfirmEdit')
      ? []
      : ['message-edit:retired-bottom-composer-edit-path-returned']),
    ...(chatPanelText.includes('const messageEditComposerRef = useRef<InlineMultimodalComposerHandle>(null)')
      && chatPanelText.includes('const messageEditRuntimeReferencesRef = useRef(new Map<string, ComposerRuntimeReference>())')
      && chatPanelText.includes('const messageEditImagesRef = useRef<DesignImageInput[]>([])')
      && handleStartMessageEditText.includes('messageEditRuntimeReferencesRef.current =')
      && handleStartMessageEditText.includes('messageEditImagesRef.current =')
      && handleStartMessageEditText.includes('setMessageEditSession({')
      && !/\bcomposerRef\.current/.test(handleStartMessageEditText)
      && !/\bcomposerRuntimeReferencesRef\.current/.test(handleStartMessageEditText)
      && !/\bcomposerImagesRef\.current/.test(handleStartMessageEditText)
      && !handleStartMessageEditText.includes('inputAreaRef')
      && !handleStartMessageEditText.includes('scrollIntoView')
      ? []
      : ['message-edit:sent-message-draft-is-not-isolated-from-bottom-composer']),
    ...(handleStartMessageEditText.includes('initialParts: payload.parts')
      && chatPanelText.includes('messageEditComposerRef.current?.replaceContent(')
      && chatPanelText.includes('messageEditSession.initialParts')
      && !handleStartMessageEditText.includes('buildChatComposerModelText')
      && !handleStartMessageEditText.includes('buildChatComposerReferenceMarker')
      && !buildEditableComposerPayloadText.includes('buildChatComposerModelText')
      && !buildEditableComposerPayloadText.includes('buildChatComposerReferenceMarker')
      ? []
      : ['message-edit:visible-editor-was-initialized-from-model-marker-projection']),
    ...(handleConfirmMessageEditText.includes('messageEditComposerRef.current?.getSnapshot()')
      && handleConfirmMessageEditText.includes('messageEditImagesRef.current')
      && handleConfirmMessageEditText.includes('messageEditRuntimeReferencesRef.current')
      && handleConfirmMessageEditText.includes('buildFrozenComposerSubmission({')
      && handleConfirmMessageEditText.includes('validateFrozenComposerImageBudget(frozen.images)')
      && handleConfirmMessageEditText.includes('const send = handleSendRef.current')
      && handleConfirmMessageEditText.includes('inlineMessageEdit: {')
      && handleConfirmMessageEditText.includes('expectedConversationId: session.conversationId')
      && handleConfirmMessageEditText.includes('expectedProjectId: session.projectId')
      && handleConfirmMessageEditText.includes('expectedProjectPath: session.projectPath')
      && !handleConfirmMessageEditText.includes('handleUnifiedAgent(')
      && !handleConfirmMessageEditText.includes('removeMessagesFrom(')
      && !handleConfirmMessageEditText.includes('addMessage(')
      ? []
      : ['message-edit:confirmation-bypasses-frozen-unified-send-path']),
    ...(handleSendText.includes('const inlineMessageEdit =')
      && handleSendText.includes('normalizeChatComposerContentParts(inlineMessageEdit.parts)')
      && handleSendText.includes('runtimeReferences = inlineMessageEdit.runtimeReferences')
      && handleSendText.indexOf('buildFrozenComposerSubmission({')
        < handleSendText.indexOf('replaceUserMessageAndTruncate(')
      && inlineEditCommitBranchText.includes('replaceUserMessageAndTruncate(')
      && inlineEditCommitBranchText.includes('contentParts: frozenSubmission.parts')
      && inlineEditCommitBranchText.includes('images: toChatMessageImages(frozenSubmission.images)')
      && !inlineEditCommitBranchText.includes('removeMessagesFrom(')
      && !inlineEditCommitBranchText.includes('addMessage(')
      ? []
      : ['message-edit:inline-commit-is-not-frozen-or-uses-delete-then-append']),
    ...(appStoreText.includes('replaceUserMessageAndTruncate: (')
      && replaceUserMessageText.includes('resolveConversationOwner({')
      && replaceUserMessageText.includes("currentMessage.role !== 'user'")
      && replaceUserMessageText.includes('contentParts: replacement.contentParts')
      && replaceUserMessageText.includes('images: replacement.images')
      && replaceUserMessageText.includes('image: undefined')
      && replaceUserMessageText.includes('targetMessages.slice(0, messageIndex)')
      && replaceUserMessageSetCount === 1
      && replaceUserMessageSaveCount === 1
      && !replaceUserMessageText.includes('removeMessagesFrom(')
      && !replaceUserMessageText.includes('addMessage(')
      ? []
      : ['message-edit:store-replacement-is-not-a-single-owner-scoped-transaction']),
    ...(messageRendererPropsText.includes('editor?: React.ReactNode')
      && messageRendererPropsText.includes('isEditing?: boolean')
      && messageRendererComponentText.includes("isEditing ? 'is-editing' : ''")
      && messageRendererComponentText.includes('isEditing && editor ?')
      && messageRendererComponentText.includes('className="message-editor-slot"')
      && messageRendererText.includes('prevProps.isEditing === nextProps.isEditing')
      && messageRendererText.includes('prevProps.editor === nextProps.editor')
      ? []
      : ['message-edit:message-renderer-does-not-own-a-memo-safe-editor-slot']),
    ...(inlineComposerPropsText.includes('className?: string')
      && inlineComposerPropsText.includes('testId?: string')
      && inlineComposerPropsText.includes('ariaLabel?: string')
      && inlineComposerPropsText.includes("submitMode?: 'enter' | 'modifier-enter'")
      && inlineComposerComponentText.includes('data-testid={testId}')
      && inlineComposerComponentText.includes('aria-label={ariaLabel}')
      && inlineComposerComponentText.includes("submitMode === 'modifier-enter'")
      && inlineComposerComponentText.includes('(event.ctrlKey || event.metaKey)')
      && messageEditorText.includes('className="message-edit-composer"')
      && messageEditorText.includes('testId={`chat-message-edit-input-${msg.id}`}')
      && messageEditorText.includes('ariaLabel="编辑用户消息。按 Ctrl 或 Command 加 Enter 发送，按 Esc 取消"')
      && messageEditorText.includes('submitMode="modifier-enter"')
      && messageEditorText.includes('onCancel={() => resetMessageEditSession(true)}')
      ? []
      : ['message-edit:inline-editor-identity-aria-or-modifier-submit-regressed']),
    ...(buildEditableComposerPayloadText.includes('let appendedOrphanImage = false')
      && buildEditableComposerPayloadText.includes('appendedOrphanImage = true')
      && buildEditableComposerPayloadText.includes(
        'exactOrderRecovered: hasPersistedParts && !appendedOrphanImage'
      )
      ? []
      : ['message-edit:orphan-image-still-claims-exact-order-recovery']),
    ...(userTextBubbleRuleText.includes('font-size: 13px')
      && userTextBubbleRuleText.includes('line-height: 1.55')
      && userComposerBubbleRuleText.includes('font-size: 13px')
      && userComposerBubbleRuleText.includes('line-height: 1.55')
      && userEditingBodyRuleText.includes('min(82%, 520px)')
      && userEditingBodyRuleText.includes('align-items: stretch')
      && messageRendererCssText.includes('.multimodal-message.user.is-editing .message-editor-slot')
      && messageRendererCssText.includes('.multimodal-message.user.is-editing .message-edit-footer')
      && !messageEditorText.includes('Enter 换行')
      && messageEditorText.includes("messageEditSubmitting ? '发送中…' : '发送'")
      ? []
      : ['message-edit:user-bubble-density-or-inline-edit-width-regressed']),
    ...(designAgentWorkbenchPropsText.includes('onOpenPage?: (page: WorkspacePageKind) => void')
      && chatPanelPropsText.includes("onRequestOpenWorkspacePage?: (page: 'assets' | 'eagle' | 'knowledge') => void")
      && designAgentWorkbenchText.includes('onRequestOpenWorkspacePage={(page) => onOpenPage?.(page)}')
      && chatPanelText.includes("onRequestOpenWorkspacePage?.('eagle')")
      && chatPanelText.includes("onRequestOpenWorkspacePage?.('knowledge')")
      && chatPanelText.includes("onRequestOpenWorkspacePage?.('assets')")
      ? []
      : ['message-edit:workbench-page-navigation-override-is-not-wired'])
  ];

  const composerFixtureParts = [
    { type: 'text', text: '先看这张图：' },
    {
      type: 'reference',
      reference: {
        version: 'chat-composer-reference/v0',
        referenceId: 'ref-image-1',
        label: '参考图.png',
        sourceLabel: '图片附件',
        mediaKind: 'image',
        source: {
          kind: 'uploaded_image',
          imageId: 'image-1',
          mediaType: 'image/png'
        },
        addedAt: '2026-08-11T00:00:00.000Z'
      }
    },
    { type: 'text', text: '，并结合这条知识：' },
    {
      type: 'reference',
      reference: {
        version: 'chat-composer-reference/v0',
        referenceId: 'ref-knowledge-1',
        label: '详情页首屏选图原则',
        sourceLabel: '知识库',
        mediaKind: 'knowledge',
        source: {
          kind: 'knowledge_selection',
          bindingRef: 'knowledge:hero-image',
          resultId: 'result-hero-image',
          title: '详情页首屏选图原则',
          sourceRevision: 'revision-1',
          contentFingerprint: 'fingerprint-1'
        },
        addedAt: '2026-08-11T00:00:01.000Z'
      }
    },
    { type: 'text', text: '重新设计首屏。' }
  ];
  const normalizedComposerFixture = normalizeChatComposerContentParts(composerFixtureParts);
  const composerFixturePlainText = buildChatComposerPlainText(composerFixtureParts);
  const composerFixtureModelText = buildChatComposerModelText(composerFixtureParts);
  const strippedComposerFixture = stripChatComposerReferenceMarkers(
    `有问题${composerFixtureModelText}`
  );
  const composerFixtureTypeOrder = normalizedComposerFixture.map((part) => part.type).join('>');
  const composerFixtureImageReference = normalizedComposerFixture.find((part) => (
    part.type === 'reference' && part.reference.referenceId === 'ref-image-1'
  ));
  const composerFixtureKnowledgeReference = normalizedComposerFixture.find((part) => (
    part.type === 'reference' && part.reference.referenceId === 'ref-knowledge-1'
  ));
  const composerFixtureModelPositions = [
    composerFixtureModelText.indexOf('先看这张图：'),
    composerFixtureModelText.indexOf('【引用1：参考图.png'),
    composerFixtureModelText.indexOf('，并结合这条知识：'),
    composerFixtureModelText.indexOf('【引用2：详情页首屏选图原则'),
    composerFixtureModelText.indexOf('重新设计首屏。')
  ];
  const composerFixtureOrderPreserved = composerFixtureModelPositions.every((position) => position >= 0)
    && composerFixtureModelPositions.every((position, index, positions) => (
      index === 0 || positions[index - 1] < position
    ));
  const multimodalComposerViolations = [
    ...(composerFixtureTypeOrder === 'text>reference>text>reference>text'
      ? []
      : ['composer-contract:normalization-reordered-text-and-references']),
    ...(composerFixturePlainText === '先看这张图：，并结合这条知识：重新设计首屏。'
      && !composerFixturePlainText.includes('【引用')
      ? []
      : ['composer-contract:plain-text-projection-leaked-model-reference-markers']),
    ...(strippedComposerFixture.removed === true
      && strippedComposerFixture.content === '有问题先看这张图： ，并结合这条知识： 重新设计首屏。'
      ? []
      : ['composer-contract:legacy-internal-reference-markers-are-not-safely-stripped']),
    ...(composerFixtureOrderPreserved
      && !composerFixtureModelText.includes('【引用3：')
      ? []
      : ['composer-contract:model-projection-lost-order-or-global-reference-numbering']),
    ...(composerFixtureImageReference?.type === 'reference'
      && composerFixtureImageReference.reference.source.kind === 'uploaded_image'
      && composerFixtureImageReference.reference.source.imageId === 'image-1'
      && composerFixtureKnowledgeReference?.type === 'reference'
      && composerFixtureKnowledgeReference.reference.source.kind === 'knowledge_selection'
      && composerFixtureKnowledgeReference.reference.source.bindingRef === 'knowledge:hero-image'
      ? []
      : ['composer-contract:normalization-lost-reference-source-identity']),
    ...(chatComposerContentText.includes('buildChatComposerPlainText')
      && chatComposerContentText.includes('buildChatComposerModelText')
      && chatComposerContentText.includes('buildChatComposerReferenceMarker')
      && !inlineMultimodalComposerText.includes('buildChatComposerModelText')
      && !inlineMultimodalComposerText.includes('buildChatComposerReferenceMarker')
      ? []
      : ['composer-ui:model-only-marker-projection-entered-visible-editor']),
    ...(chatComposerContentText.includes('function stripChatComposerReferenceMarkers')
      && buildEditableComposerPayloadText.includes('stripChatComposerReferenceMarkers(message.content)')
      && buildEditableComposerPayloadText.includes(
        'exactOrderRecovered: hasPersistedParts && !appendedOrphanImage'
      )
      && buildEditableComposerPayloadText.includes('removedInternalMarkers')
      && chatPanelText.includes('messageEditComposerRef.current?.replaceContent(')
      && handleStartMessageEditText.includes('needsLegacyOrderWarning')
      && handleStartMessageEditText.includes('这条旧消息没有保存原始行内顺序')
      && handleStartMessageEditText.includes('这条旧消息没有保存完整的行内顺序')
      ? []
      : ['composer-edit:legacy-marker-or-order-recovery-is-not-explicit']),
    ...(messageParserText.includes('const hasComposerContent = normalizedComposerParts.length > 0')
      && messageParserText.includes("type: 'composer_content'")
      && messageParserText.includes('&& !hasComposerContent')
      && messageParserText.includes('stripChatComposerReferenceMarkers(message.content).content')
      && messageParserText.includes('function buildChatMessageImagesHash')
      && !messageParserText.includes('JSON.stringify(message.images)')
      ? []
      : ['composer-render:rich-message-marker-suppression-or-lightweight-cache-missing']),
    ...(appStoreText.includes('contentParts?: ChatComposerContentPart[]')
      && appStoreText.includes('images?: ChatMessageImage[]')
      && appStoreText.includes('normalizeChatComposerContentParts(message.contentParts)')
      && appStoreText.includes('sanitizeMessageForPersistence(message)')
      && appStoreText.includes('sanitizeConversationsForPersistence')
      && appStoreText.includes('contentParts: undefined')
      && appStoreText.includes('images: undefined')
      && appStoreText.includes('buildConversationTitleFromUserMessage(safeMessage)')
      ? []
      : ['composer-persistence:rich-message-payload-or-safe-title-projection-missing']),
    ...(agentMessageContextText.includes("origin: 'current_user_instruction'")
      && agentMessageContextText.includes("authority: 'user'")
      && agentMessageContextText.includes("retention: 'pinned'")
      && chatPanelText.includes("message.contextMetadata?.origin === 'current_user_instruction'")
      && chatPanelText.includes("message.contextMetadata?.authority === 'policy'")
      && chatPanelText.includes("message.contextMetadata?.authority === 'data_only'")
      && !chatPanelText.includes("lastIndexOf('user')")
      ? []
      : ['composer-provenance:ordered-injection-can-target-harness-user-message']),
    ...(chatPanelText.includes('currentUserContentParts: frozenSubmission?.parts || []')
      && engineText.includes('initialUserContentParts: context.currentUserContentParts')
      && executorText.includes('initialUserContentParts: runtimeParams.initialUserContentParts')
      && agentRuntimeTypesText.includes('initialUserContentParts?: readonly ChatComposerContentPart[]')
      && agentRuntimeText.includes('this.config.initialUserContentParts || []')
      && agentRuntimeText.includes("part.reference.source.kind !== 'uploaded_image'")
      && agentRuntimeText.includes('imagesById.get(part.reference.source.imageId)')
      && agentRuntimeText.includes('createCurrentUserMessage({ content, contentBlocks: blocks })')
      ? []
      : ['composer-agent-bridge:ordered-parts-do-not-reach-budgeted-initial-user-message']),
    ...(chatPanelText.includes('? (orderedMessages || msgs)')
      && !chatPanelText.includes('orderedMessages || injectImagesIntoLastUserMessage')
      && chatPanelText.includes('if (frozenSubmission) {\n            submissionSelectedAssetContext')
      && chatPanelText.includes('const submissionSelectedEagleLibraryAsset = frozenSubmission?.selectedEagleLibraryAsset')
      && chatPanelText.includes('const submissionSelectedEagleAssetGroup = frozenSubmission?.selectedEagleAssetGroup?.length')
      && chatPanelText.includes('const submissionKnowledgeReferences = frozenSubmission')
      ? []
      : ['composer-freeze:frozen-empty-selection-falls-back-to-live-state-or-legacy-image-injection']),
    ...(chatPanelText.includes('currentImages.length + pendingComposerImageBytesRef.current.size')
      && chatPanelText.includes('committedBytes + pendingBytes + file.size')
      && chatPanelText.indexOf('pendingComposerImageBytesRef.current.set(imageId, file.size)')
        < chatPanelText.indexOf('reader.readAsDataURL(file)')
      && chatPanelText.includes('if (!pendingComposerImageBytesRef.current.has(imageId)) return')
      && chatPanelText.includes('otherPendingBytes')
      && chatPanelText.includes('pendingComposerImageBytesRef.current.size > 0')
      && chatPanelText.includes('function validateFrozenComposerImageBudget')
      && chatPanelText.includes('validateFrozenComposerImageBudget(frozenSubmission.images)')
      ? []
      : ['composer-budget:pending-or-final-send-image-budget-can-be-bypassed'])
  ];

  const runResumeBranchViolations = [];
  const runEndedAt = '2026-08-14T06:00:00.000Z';
  const currentConversationScope = {
    conversationId: 'conversation-edit-branch-audit',
    branchId: 'branch-current-audit'
  };
  const scopedUnfinishedRun = buildAgentRunRecord({
    now: runEndedAt,
    goal: '完成当前设计',
    projectPath: 'C:\\audit-project',
    conversationScope: currentConversationScope,
    result: {
      success: false,
      iterations: 1,
      stopReason: 'max_iterations',
      toolCallLog: []
    }
  });
  const scopedRecordValidation = validateAgentRunRecordForPersist(scopedUnfinishedRun);
  const sameBranchResume = buildRunRecordResumeBrief({
    records: [scopedUnfinishedRun],
    nowMs: Date.parse(runEndedAt) + 60_000,
    conversationScope: currentConversationScope
  });
  const editedBranchResume = buildRunRecordResumeBrief({
    records: [scopedUnfinishedRun],
    nowMs: Date.parse(runEndedAt) + 60_000,
    conversationScope: {
      conversationId: currentConversationScope.conversationId,
      branchId: 'branch-after-edit-audit'
    }
  });
  const differentConversationResume = buildRunRecordResumeBrief({
    records: [scopedUnfinishedRun],
    nowMs: Date.parse(runEndedAt) + 60_000,
    conversationScope: {
      conversationId: 'conversation-other-audit',
      branchId: currentConversationScope.branchId
    }
  });
  const missingScopeResume = buildRunRecordResumeBrief({
    records: [scopedUnfinishedRun],
    nowMs: Date.parse(runEndedAt) + 60_000
  });
  const legacyUnscopedRun = {
    ...scopedUnfinishedRun,
    conversationScope: undefined,
    boundaries: {
      ...scopedUnfinishedRun.boundaries,
      conversationScopeIdentityOnly: undefined
    }
  };
  const legacyAutomaticResume = buildRunRecordResumeBrief({
    records: [legacyUnscopedRun],
    nowMs: Date.parse(runEndedAt) + 60_000,
    conversationScope: currentConversationScope
  });
  const exactLegacyResume = buildRunRecordResumeBrief({
    records: [legacyUnscopedRun],
    nowMs: Date.parse(runEndedAt) + 60_000,
    preferredSourceRunId: legacyUnscopedRun.runId,
    conversationScope: currentConversationScope
  });
  const wrongBranchExactResume = buildRunRecordResumeBrief({
    records: [scopedUnfinishedRun],
    nowMs: Date.parse(runEndedAt) + 60_000,
    preferredSourceRunId: scopedUnfinishedRun.runId,
    conversationScope: {
      conversationId: currentConversationScope.conversationId,
      branchId: 'branch-after-edit-audit'
    }
  });
  if (!scopedRecordValidation.ok
    || scopedUnfinishedRun.conversationScope?.branchId !== currentConversationScope.branchId
    || scopedUnfinishedRun.boundaries.conversationScopeIdentityOnly !== true) {
    runResumeBranchViolations.push(
      `run-record:conversation-branch-scope-not-persistable:${JSON.stringify(scopedRecordValidation)}`
    );
  }
  if (sameBranchResume.applicable !== true
    || editedBranchResume.applicable !== false
    || differentConversationResume.applicable !== false
    || missingScopeResume.applicable !== false
    || legacyAutomaticResume.applicable !== false
    || exactLegacyResume.applicable !== true
    || wrongBranchExactResume.applicable !== false) {
    runResumeBranchViolations.push('run-resume:conversation-edit-branch-isolation-regressed');
  }
  if (!appStoreText.includes('branchId: crypto.randomUUID()')
    || !replaceUserMessageText.includes('branchId: crypto.randomUUID()')
    || !chatPanelText.includes('conversationBranchId: runConversationBranchId || undefined')
    || !executorText.includes('conversationScope: runRecordConversationScope')
    || !agentRunResumeText.includes('matchesConversationScope(')) {
    runResumeBranchViolations.push('run-resume:conversation-branch-identity-not-wired-end-to-end');
  }

  const skillExecutorDirectory = path.join(root, 'src', 'renderer', 'services', 'skill-executors');
  const externalDeliveryCommitIssuer = 'issueRuntimeOwnedSkillExternalDeliveryCommitReceipt';
  const stagingLeaseIssuer = 'issueRuntimeOwnedSkillStagingLease';
  const workflowDeliveryReentryPeek = 'peekRuntimeWorkflowDeliveryReentry';
  const workflowDeliveryReentryConsume = 'consumeRuntimeWorkflowDeliveryReentry';
  const collectProductionTypeScriptFiles = (directoryPath) => fs.readdirSync(
    directoryPath,
    { withFileTypes: true }
  ).flatMap((entry) => {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) return collectProductionTypeScriptFiles(entryPath);
    return /\.tsx?$/i.test(entry.name) ? [entryPath] : [];
  });
  const allowedExternalCommitIssuerFiles = new Set([
    path.resolve(agentSkillAtomicToolExecutionPath),
    path.resolve(stagedDeliveryPromotionPath)
  ]);
  const unauthorizedExternalCommitIssuers = collectProductionTypeScriptFiles(path.join(root, 'src'))
    .filter((filePath) => read(filePath).includes(externalDeliveryCommitIssuer))
    .filter((filePath) => !allowedExternalCommitIssuerFiles.has(path.resolve(filePath)))
    .map((filePath) => path.relative(root, filePath));
  const allowedStagingLeaseIssuerFiles = new Set([
    path.resolve(agentSkillAtomicToolExecutionPath),
    path.resolve(runtimeStagedDeliveryPath)
  ]);
  const unauthorizedStagingLeaseIssuers = collectProductionTypeScriptFiles(path.join(root, 'src'))
    .filter((filePath) => read(filePath).includes(stagingLeaseIssuer))
    .filter((filePath) => !allowedStagingLeaseIssuerFiles.has(path.resolve(filePath)))
    .map((filePath) => path.relative(root, filePath));
  const allowedWorkflowReentryPeekFiles = new Set([
    path.resolve(path.join(root, 'src', 'shared', 'agent-workflow-continuation-scope.ts')),
    path.resolve(skillToolsPath)
  ]);
  const unauthorizedWorkflowReentryPeekFiles = collectProductionTypeScriptFiles(path.join(root, 'src'))
    .filter((filePath) => read(filePath).includes(workflowDeliveryReentryPeek))
    .filter((filePath) => !allowedWorkflowReentryPeekFiles.has(path.resolve(filePath)))
    .map((filePath) => path.relative(root, filePath));
  const allowedWorkflowReentryConsumeFiles = new Set([
    path.resolve(path.join(root, 'src', 'shared', 'agent-workflow-continuation-scope.ts')),
    path.resolve(detailPageExecutorPath)
  ]);
  const unauthorizedWorkflowReentryConsumeFiles = collectProductionTypeScriptFiles(path.join(root, 'src'))
    .filter((filePath) => read(filePath).includes(workflowDeliveryReentryConsume))
    .filter((filePath) => !allowedWorkflowReentryConsumeFiles.has(path.resolve(filePath)))
    .map((filePath) => path.relative(root, filePath));
  const skuExportTransactionServiceText = read(path.join(
    skillExecutorDirectory,
    'sku-export-transaction.service.ts'
  ));

  const stagedFilePromotionAudit = await exerciseStagedFilePromotion();
  const checks = [
    {
      id: 'runtime-external-delivery-commit-issuer-is-transaction-owned',
      description: '外部文件提交信用只能由独立 transaction owner 在精确 readback 后签发；业务 executor 不得自签。',
      violations: [
        ...(unauthorizedExternalCommitIssuers.length === 0
          ? []
          : unauthorizedExternalCommitIssuers.map((fileName) => (
            `runtime-delivery:executor-can-self-issue-external-commit:${fileName}`
          ))),
        ...(stagedDeliveryPromotionText.includes(externalDeliveryCommitIssuer)
          && stagedDeliveryPromotionText.includes('validateCommittedFiles({')
          && stagedDeliveryPromotionText.includes('isRuntimeOwnedSkillDeliveryPlanBinding(binding)')
          && stagedDeliveryPromotionText.includes('typeof host.promoteStagedFileSet')
          ? []
          : ['runtime-delivery:trusted-transaction-issuer-not-bound-to-main-commit-readback'])
      ]
    },
    {
      id: 'runtime-staging-lease-issuer-is-transaction-owned',
      description: '暂存路径租约只能由通用 Runtime 文件事务在绑定冻结计划和 Main 事务后签发。',
      violations: [
        ...unauthorizedStagingLeaseIssuers.map((fileName) => (
          `runtime-delivery:unauthorized-staging-lease-issuer:${fileName}`
        )),
        ...(runtimeStagedDeliveryText.includes(stagingLeaseIssuer)
          && runtimeStagedDeliveryText.includes('isRuntimeOwnedSkillDeliveryPlanBinding(binding)')
          && runtimeStagedDeliveryText.includes('opaqueTransactionState: true')
          ? []
          : ['runtime-delivery:staging-lease-not-bound-to-opaque-runtime-transaction'])
      ]
    },
    {
      id: 'workflow-delivery-reentry-is-single-use-and-owner-consumed',
      description: '视觉复核后的交付复入由路由层只读检查，仅最终 workflow owner 可一次性消费。',
      violations: [
        ...unauthorizedWorkflowReentryPeekFiles.map((fileName) => (
          `workflow-reentry:unauthorized-peek-owner:${fileName}`
        )),
        ...unauthorizedWorkflowReentryConsumeFiles.map((fileName) => (
          `workflow-reentry:unauthorized-consume-owner:${fileName}`
        )),
        ...(detailPageExecutorText.includes(workflowDeliveryReentryConsume)
          && !detailPageExecutorText.includes(workflowDeliveryReentryPeek)
          && read(skillToolsPath).includes(workflowDeliveryReentryPeek)
          && !read(skillToolsPath).includes(workflowDeliveryReentryConsume)
          ? []
          : ['workflow-reentry:peek-consume-responsibility-drifted'])
      ]
    },
    {
      id: 'sku-staged-export-transaction-supports-safe-rerun',
      description: 'SKU 全部 JPG/PSB 以同卷单事务替换旧交付；目标基线漂移零写入，完整回滚恢复全组，失败恢复保留可映射清单。',
      violations: [
        ...(!stagedFilePromotionAudit.transactionOwnerCreatedDirectory
          ? ['sku-staged-promotion:transaction-owner-did-not-safely-create-output-directory']
          : []),
        ...(!stagedFilePromotionAudit.projectContainmentRejected
          ? ['sku-staged-promotion:project-containment-was-not-enforced-before-directory-create']
          : []),
        ...(!stagedFilePromotionAudit.overwriteCommitted
          ? ['sku-staged-promotion:existing-output-was-not-atomically-replaced']
          : []),
        ...(!stagedFilePromotionAudit.subsetRejectedBeforeWrite
          ? ['sku-staged-promotion:subset-commit-was-not-rejected-before-write']
          : []),
        ...(!stagedFilePromotionAudit.escapedPathRejected
          ? ['sku-staged-promotion:path-escape-was-not-rejected']
          : []),
        ...(!stagedFilePromotionAudit.relativePathsRejected
          ? ['sku-staged-promotion:relative-path-was-not-rejected']
          : []),
        ...(!stagedFilePromotionAudit.destinationDriftRejected
          ? ['sku-staged-promotion:destination-baseline-drift-was-overwritten']
          : []),
        ...(!stagedFilePromotionAudit.mainFrozenBaselineAuthoritative
          ? ['sku-staged-promotion:renderer-could-replace-main-frozen-baseline']
          : []),
        ...(!stagedFilePromotionAudit.concurrentPromotionSingleOwner
          ? ['sku-staged-promotion:same-token-concurrent-owner-was-not-exclusive']
          : []),
        ...(!stagedFilePromotionAudit.fullRollbackRestored
          ? ['sku-staged-promotion:paired-set-was-not-fully-restored']
          : []),
        ...(!stagedFilePromotionAudit.freshProcessReconciliationFailClosed
          ? ['sku-staged-promotion:crash-residue-reconciliation-was-not-hash-bound']
          : []),
        ...(!stagedFilePromotionAudit.backupMoveRacePreservesExternalFile
          ? ['sku-staged-promotion:backup-move-race-lost-concurrent-user-file']
          : []),
        ...(!stagedFilePromotionAudit.rollbackRestoreNoReplace
          ? ['sku-staged-promotion:rollback-restore-overwrote-concurrent-target']
          : []),
        ...(!stagedFilePromotionAudit.failedRollbackBackupPreserved
          ? ['sku-staged-promotion:failed-rollback-backup-was-not-preserved']
          : []),
        ...(!stagedFilePromotionAudit.recoveryManifestMapped
          ? ['sku-staged-promotion:recovery-backups-have-no-durable-mapping']
          : []),
        ...(!stagedFilePromotionAudit.rendererPreservesFailedRollbackStaging
          ? ['sku-staged-promotion:renderer-cleanup-removed-recovery-backup']
          : []),
        ...(!stagedFilePromotionAudit.rendererPreservesUnknownTransactionState
          ? ['sku-staged-promotion:unknown-write-state-cleaned-staging']
          : []),
        ...(!stagedFilePromotionAudit.rendererPreservesMismatchedSuccessReceipt
          ? ['sku-staged-promotion:mismatched-success-receipt-cleaned-staging']
          : []),
        ...(!stagedFilePromotionAudit.cleanupTransportErrorsAreNormalized
          ? ['sku-staged-promotion:cleanup-transport-error-escaped-finally']
          : []),
        ...(!stagedFilePromotionAudit.stagedRasterValidationStrict
          ? ['sku-staged-promotion:raster-staging-validation-is-not-exact']
          : []),
        ...(stagedFilePromotionAudit.rollbackResidueCount !== 0
          ? [`sku-staged-promotion:rollback-residue=${stagedFilePromotionAudit.rollbackResidueCount}`]
          : [])
      ]
    },
    {
      id: 'skill-results-project-design-work-without-runtime-accounting',
      description: 'Skill 原始结果继续供 Runtime、续跑与诊断使用；设计模型只接收工作结果和实际问题，不接收 nextAction、OS、验收报告、执行轨迹或能力 allowlist。',
      violations: skillModelProjectionViolations
    },
    {
      id: 'eagle-library-browse-selection-and-composer-transfer-are-decoupled',
      description: 'Eagle 普通点击只更新本地浏览选择；只有拖拽、右键或显式按钮能把不透明引用送入对话。拖拽载荷必须按白名单、版本、64KiB 与 12 项上限校验，不携带路径或预览数据；右键请求与 drop 共用 reference-only 插入函数，UI 预览不冒充 Agent 视觉观察。',
      violations: eagleComposerTransferViolations
    },
    {
      id: 'multimodal-composer-order-provenance-and-budget-boundary',
      description: '多模态消息以有序 parts 为唯一表达：编辑器不显示模型内部引用标记，旧消息诚实降级，发送快照不吸入实时选择，默认 Agent 在视觉预算内按原顺序接收图文，异步图片与编辑重发都必须经过最终大小门禁。',
      violations: multimodalComposerViolations
    },
    {
      id: 'inline-user-message-edit-is-local-frozen-and-transactional',
      description: '已发送用户消息必须在原气泡内用独立多模态编辑状态修改：可见编辑不使用模型标记投影，不覆盖底部草稿；确认先冻结图文与引用，再由统一发送入口调用 conversation-owner 约束的单事务替换并截断后续回复。',
      violations: inlineMessageEditViolations
    },
    {
      id: 'edited-message-creates-a-new-run-resume-branch',
      description: '编辑重发必须旋转会话消息树分支；Run Record 只在同一对话、同一分支自动续接。旧记录保留审计，但跨对话、旧编辑分支和无身份历史记录不得自动注入。',
      violations: runResumeBranchViolations
    },
    {
      id: 'design-memory-uses-stable-project-scope-reviewed-provenance-and-neutral-relevance',
      description: '项目记忆优先使用稳定 projectId、缺失时使用不可逆路径指纹；脱敏显示文本不参与归属。自动设计记忆只消费顶层与来源均已复核的 active 记录，并按当前任务相关度而非全领域固定词或 sourceRank 选取。',
      violations: memoryTruthSourceViolations
    },
    {
      id: 'sku-template-facts-use-revision-bound-deterministic-discovery-and-bounded-repair',
      description: 'SKU 模板在生产前对账执行计划、文件名、占位结构与可见文字；只有单一可编辑文字冲突且文件名/结构旁证一致时才比较后写入，并在新 Photoshop 修订上复验。',
      violations: skuConsistencyViolations
    },
    {
      id: 'sku-workflow-entry-and-fixed-observation-costs-are-bounded',
      description: '唯一声明式匹配让 Agent 直接看到并调用完整 SKU Skill；候选不自行授权，真实执行仍由通用 Tool preflight 约束。模板 inventory 单次复用，文档轮询不再递归统计所有图层。',
      violations: skuWorkflowEfficiencyViolations
    },
    {
      id: 'sku-production-layout-and-staging-regressions-are-fail-closed',
      description: 'SKU 多文档变换按 documentId/layerId 精确定位；模板检查不把全画布数字设计组当占位；QA 只信实时 bounds；暂存父目录只用原子非递归空目录删除。',
      violations: skuProductionSafetyRegressionViolations
    },
    {
      id: 'aesthetic-judge-protocol-is-brief-relative-and-non-blocking-by-default',
      description: '审美 Judge 以 score 为唯一裁决值；无分结果不污染覆盖率，N/A 受断言白名单约束，结构启发信号不冒充像素事实，诊断强制 top-3，缺诊断只接受 diagnosis-only 原子协议修复；completed 的可靠诊断只在同一请求内唤醒 Agent 一次，Harness 不选择或直接执行修改；零视觉/局部编辑 Profile 不强跑全局 VLM。',
      violations: aestheticProtocolViolations
    },
    {
      id: 'sku-artifact-completion-is-independent-from-publication-review',
      description: 'SKU 真实生成、导出、同目标读回和机器检查通过后可完成 R5；商品真实性与批量一致性保持内容哈希绑定的人审发布状态，待审或拒绝都不得伪造 human pass，也不得反向抹掉产物完成。',
      violations: skuCompletionPublicationViolations
    },
    {
      id: 'creative-completion-projects-factual-obligations-without-aesthetic-recipe',
      description: '通用 creative Completion 只硬校验真实写入、正确目标、同目标读回与显式交付义务；无字、纯排版和编辑现有文档不得被固定配方反向加内容。',
      violations: creativeCompletionViolations
    },
    {
      id: 'document-authority-is-structured-not-category-lexical',
      description: '品类词与文件名只能提供 Planner 建议；真实写保护只来自用户显式保护，create/edit 等目标语义来自结构化 workMode，Runtime 目标仍由 documentId/revision 校验。',
      violations: documentAuthorityViolations
    },
    {
      id: 'skill-manifest-owns-performance-profile',
      description: '每个已注册 Runtime Manifest 必须拥有自己的成本、视觉和最低验收画像。',
      violations: [
        ...missingPerformanceProfiles,
        ...invalidPerformanceProfiles,
        ...invalidWorkModePerformanceProfiles
      ]
    },
    {
      id: 'manifest-schema-recognizes-boundary-fields',
      description: 'TypeScript Manifest 与 JSON Schema 必须同时声明性能所有权和规划角色，避免运行时与机器校验漂移。',
      violations: [
        ...(manifestSchema.properties?.performance_profile ? [] : ['schema:performance_profile']),
        ...(manifestSchema.properties?.planning_role ? [] : ['schema:planning_role']),
        ...(manifestSchema.properties?.work_mode_contracts ? [] : ['schema:work_mode_contracts']),
        ...(manifestSchema.$defs?.workModeContract?.properties?.review_rubric_ref
          ? []
          : ['schema:work-mode-review-rubric']),
        ...(manifestSchema.$defs?.workModeContract?.properties?.performance_profile
          ? []
          : ['schema:work-mode-performance-profile']),
        ...(manifestSchema.$defs?.workModeContract?.properties?.initial_capabilities
          ? []
          : ['schema:work-mode-initial-capabilities']),
        ...(manifestSchema.$defs?.workModeContract?.properties?.capability_ceiling
          ? []
          : ['schema:work-mode-capability-ceiling']),
        ...(manifestSchema.$defs?.workModeContract?.properties?.runtime_stages
          ? []
          : ['schema:work-mode-runtime-stages']),
        ...(manifestSchema.$defs?.workModeContract?.properties?.execution_scope_kind
          ? []
          : ['schema:work-mode-execution-scope-kind'])
      ]
    },
    {
      id: 'generic-performance-policy-consumes-manifest',
      description: '通用性能策略只解析 Manifest profile，并把截断后的模型、工具与时间预算交给真实 Agent Runtime 强制执行。',
      violations: [
        ...(performanceText.includes('resolveSkillRuntimeManifestSelection') ? [] : ['missing:resolveSkillRuntimeManifestSelection']),
        ...(performanceText.includes('manifest.performance_profile') ? [] : ['missing:manifest.performance_profile']),
        ...(performanceText.includes('work_mode_contracts?.[workMode') ? [] : ['missing:work-mode.performance_profile']),
        ...(performanceText.includes('normalizeRuntimeDesignWorkMode') ? [] : ['missing:work-mode-normalization']),
        ...(performanceText.includes('AGENT_GLOBAL_SKILL_BUDGET_LIMITS') ? [] : ['missing:AGENT_GLOBAL_SKILL_BUDGET_LIMITS']),
        ...(executorText.includes('performanceBudget:') ? [] : ['executor:performance-budget-handoff']),
        ...(executorText.includes('maxVisionCandidates: autonomousPerformancePolicy.budget.maxVisionCandidates')
          ? []
          : ['executor:vision-candidate-budget-not-handed-off']),
        ...(executorText.includes('maxVisualAnalyses: autonomousPerformancePolicy.budget.maxVisualAnalyses')
          ? []
          : ['executor:visual-analysis-budget-not-handed-off']),
        ...(executorText.includes('maxFullResolutionImageReads: autonomousPerformancePolicy.budget.maxFullResolutionImageReads')
          ? []
          : ['executor:full-resolution-read-budget-not-handed-off']),
        ...(agentRuntimeText.includes('beginPerformanceModelCall') ? [] : ['runtime:max-model-calls-not-enforced']),
        ...(agentRuntimeText.includes('consumePerformanceToolCallBudget') ? [] : ['runtime:max-tool-calls-not-enforced']),
        ...(agentRuntimeText.includes('consumePerformanceVisionCandidate')
          ? []
          : ['runtime:max-vision-candidates-not-enforced']),
        ...(agentRuntimeText.includes('agent_visual_analysis_budget_exhausted')
          ? []
          : ['runtime:max-visual-analyses-not-enforced']),
        ...(agentRuntimeText.includes('softTimeBudgetMs') ? [] : ['runtime:soft-time-budget-not-enforced']),
        ...businessDecisionLiterals
      ]
    },
    {
      id: 'request-complexity-scales-model-stages-and-reflexion-cost',
      description: '未绑定请求拥有足以完成普通自主设计的总上限，匹配 Skill 时仍应直接调用；局部 edit_existing 由模式清单缩短阶段，预算耗尽不得自动购买下一 generation，返工问题与对应修法必须成对传递。',
      violations: requestScaledCostViolations
    },
    {
      id: 'user-activity-projects-design-progress-not-runtime-diagnostics',
      description: 'Skill 包装事件必须显式获得用户过程授权；轮次、代际和成本诊断保留在运行日志，普通界面只显示自然设计进度。',
      violations: userActivityProjectionViolations
    },
    {
      id: 'compound-design-team-budget-is-prepartitioned-and-role-weighted',
      description: '复合 Design Team 启动前必须保留父级收尾额度，child allowance 只携带子执行上限；基础充分性按共享角色权重而非平均调用数判定。',
      violations: compoundBudgetReservationViolations
    },
    {
      id: 'manifest-identity-resolves-once-and-fails-closed',
      description: 'skillId 与 taskType 通过同一 Resolver 形成 artifact/method 角色；冲突或未知结构化身份不得自行选边。',
      violations: [
        ...(sameIdentity.status === 'resolved' && sameIdentity.manifests.length === 1 ? [] : ['same-identity-not-deduplicated']),
        ...(composedIdentity.status === 'resolved'
          && composedIdentity.artifactManifest?.skill_id === 'ecommerce.detail_page'
          && composedIdentity.methodManifests.some((manifest) => manifest.skill_id === 'design.reference_replication')
          ? []
          : ['artifact-method-composition-invalid']),
        ...(conflictingIdentity.status === 'conflict' ? [] : ['artifact-conflict-not-blocked']),
        ...(unknownIdentity.status === 'unresolved_task_type' ? [] : ['unknown-task-type-fell-back'])
      ]
    },
    {
      id: 'project-sampling-not-agent-business-routing',
      description: '项目素材抽样策略归项目视觉能力所有：联系表已足够时不得为凑数逐图复读；只有联系表点名的疑难图或总览失败才在任务预算内做语义多样化近看，不能在 Agent 性能核心按品类选路线。',
      violations: [
        ...(performanceText.includes('buildAgentVisualSamplingBudget') ? ['legacy:buildAgentVisualSamplingBudget'] : []),
        ...(visualSamplingText.includes('buildProjectVisualSamplingBudget') ? [] : ['missing:buildProjectVisualSamplingBudget']),
        ...(resolvedContactSheetPlan.contactSheetSufficient
          && resolvedContactSheetPlan.selectionSource === 'contact-sheet-sufficient'
          && resolvedContactSheetPlan.selectedCandidates.length === 0
          ? []
          : ['project-image-analysis:resolved-contact-sheet-still-forced-closeups']),
        ...(requestedContactSheetPlan.selectionSource === 'contact-sheet-request'
          && requestedContactSheetPlan.maxCloseups === 4
          && requestedContactSheetPlan.selectedCandidates.length === 4
          && requestedContactSheetPlan.selectedCandidates.some((candidate) => candidate.relativePath.includes('/模特/'))
          && requestedContactSheetPlan.selectedCandidates.some((candidate) => candidate.relativePath.includes('/平铺/'))
          ? []
          : ['project-image-analysis:explicit-closeups-not-budgeted-or-diverse']),
        ...(fallbackContactSheetPlan.selectionSource === 'bounded-fallback'
          && fallbackContactSheetPlan.selectedCandidates.length === 4
          && fallbackContactSheetPlan.selectedCandidates.some((candidate) => candidate.relativePath.includes('/模特/'))
          && fallbackContactSheetPlan.selectedCandidates.some((candidate) => candidate.relativePath.includes('/平铺/'))
          ? []
          : ['project-image-analysis:fallback-not-budgeted-or-diverse']),
        ...(hardLimitedContactSheetPlan.maxCloseups === 2
          && hardLimitedContactSheetPlan.selectedCandidates.length === 2
          ? []
          : ['project-image-analysis:authoritative-budget-not-enforced']),
        ...(diverseNumericFilenameSelection.length === 2
          && diverseNumericFilenameSelection.some((candidate) => candidate.folderType === '模特')
          && diverseNumericFilenameSelection.some((candidate) => candidate.folderType === '平铺')
          ? []
          : ['project-image-analysis:numeric-filenames-collapsed-folder-diversity']),
        ...(fullBucketSpanSelection.map((candidate) => (
          candidate.relativePath.split('/').pop()
        )).join(',') === '001.jpg,004.jpg,006.jpg,009.jpg'
          ? []
          : ['project-contact-sheet:role-bucket-still-samples-filesystem-head']),
        ...(reversedBucketSpanSelection.map((candidate) => candidate.relativePath).join(',')
          === fullBucketSpanSelection.map((candidate) => candidate.relativePath).join(',')
          ? []
          : ['project-contact-sheet:span-sampling-depends-on-filesystem-order']),
        ...(sampledContactSheetCoverage.candidateUniverseCount === 9
          && sampledContactSheetCoverage.attemptedCandidateCount === 4
          && sampledContactSheetCoverage.displayedCandidateCount === 4
          && sampledContactSheetCoverage.failedRenderCount === 0
          && sampledContactSheetCoverage.samplingOmittedCandidateCount === 5
          && sampledContactSheetCoverage.omittedCandidateCount === 5
          && sampledContactSheetCoverage.status === 'sampled'
          && sampledContactSheetCoverage.universeScope === 'project_scan'
          && sampledContactSheetCoverage.doesNotRank === true
          && sampledContactSheetCoverage.doesNotSelectWinner === true
          ? []
          : ['project-contact-sheet:sampled-coverage-facts-or-authorship-boundary-invalid']),
        ...(completeContactSheetCoverage.candidateUniverseCount === 4
          && completeContactSheetCoverage.attemptedCandidateCount === 4
          && completeContactSheetCoverage.displayedCandidateCount === 4
          && completeContactSheetCoverage.failedRenderCount === 0
          && completeContactSheetCoverage.samplingOmittedCandidateCount === 0
          && completeContactSheetCoverage.omittedCandidateCount === 0
          && completeContactSheetCoverage.status === 'complete'
          && completeContactSheetCoverage.universeScope === 'provided_candidates'
          ? []
          : ['project-contact-sheet:complete-coverage-facts-invalid']),
        ...(failedTileContactSheetCoverage.candidateUniverseCount === 4
          && failedTileContactSheetCoverage.attemptedCandidateCount === 4
          && failedTileContactSheetCoverage.displayedCandidateCount === 3
          && failedTileContactSheetCoverage.failedRenderCount === 1
          && failedTileContactSheetCoverage.samplingOmittedCandidateCount === 0
          && failedTileContactSheetCoverage.omittedCandidateCount === 1
          && failedTileContactSheetCoverage.status === 'sampled'
          ? []
          : ['project-contact-sheet:failed-tile-still-counted-as-displayed']),
        ...((toolExecutorText.match(/reconcileProjectContactSheetCandidateCoverage\(\{/g) || []).length >= 2
          && (toolExecutorText.match(/maxImages: prepared\.maxImages/g) || []).length >= 2
          && toolExecutorText.includes('candidateUniverseCount: uniqueCandidates.length')
          && toolExecutorText.includes("item?.status === 'rendered'")
          ? []
          : ['project-contact-sheet:coverage-disclosure-not-exposed-by-both-tools']),
        ...(realSkuAssetIndex.visionCandidates.length === 12
          && realSkuAssetIndex.visionCandidates.some((candidate) => candidate.role === 'raw-model-wear')
          && realSkuAssetIndex.visionCandidates.some((candidate) => candidate.role === 'raw-product-still')
          ? []
          : ['project-asset-index:vision-candidate-cap-collapsed-to-one-role']),
        ...(realSkuSamplingPlan.selectedCandidates.length === 4
          && realSkuSamplingPlan.selectedCandidates.filter((candidate) => candidate.role === 'raw-product-still').length >= 3
          && realSkuSamplingPlan.selectedCandidates.some((candidate) => candidate.role === 'raw-model-wear')
          ? []
          : ['project-visual-sampling:sku-did-not-prioritize-product-variants-with-scene-context']),
        ...(realGeneralSamplingPlan.selectedCandidates.length === 4
          && realGeneralSamplingPlan.selectedCandidates.some((candidate) => candidate.role === 'raw-product-still')
          && realGeneralSamplingPlan.selectedCandidates.some((candidate) => candidate.role === 'raw-model-wear')
          ? []
          : ['project-visual-sampling:general-design-collapsed-to-one-role']),
        ...(projectImageAnalysisExecutorText.includes('buildProjectImageAnalysisCloseupPlan({')
          ? []
          : ['project-image-analysis:production-closeup-plan-not-wired']),
        ...(projectImageAnalysisExecutorText.includes('summarizeAnalyses(')
          ? ['project-image-analysis:redundant-summary-model-call-restored']
          : []),
        ...(projectImageAnalysisExecutorText.includes('for (const role of input.overview?.observation?.imageRoles')
          ? ['project-image-analysis:all-contact-sheet-roles-forced-into-closeups']
          : []),
        ...(projectImageAnalysisExecutorText.includes('...overviewSelectedImages, ...buildPreferredImages')
          ? ['project-image-analysis:model-request-refilled-after-contact-sheet']
          : [])
      ]
    },
    {
      id: 'generic-prompt-has-no-detail-page-method',
      description: '通用设计提示只保留跨品类纪律，详情页套版和结构方法由详情页 Skill/Knowledge 提供。',
      violations: [
        ...(['【详情页项目级策略】', 'DESIGN_DISCIPLINE_TASK_PRINCIPLES', 'designDisciplineTask']
          .filter((value) => promptText.includes(value))),
        ...(executorText.includes('designDisciplineTask:') ? ['executor:designDisciplineTask'] : [])
      ]
    },
    {
      id: 'business-parser-runs-after-skill-selection',
      description: '通用 Engine/Router 不得在 R0 选 Skill 前调用详情页解析器或依据屏数猜业务身份。',
      violations: [
        ...(fs.existsSync(retiredPreflightPath) ? ['file:document-structure-preflight.ts'] : []),
        ...(engineText.includes('buildCurrentDocumentStructureRouteOptions') ? ['engine:structure-preflight'] : []),
        ...(engineText.includes('parseDetailPageTemplate') ? ['engine:parseDetailPageTemplate'] : []),
        ...(routingText.includes('detailPageTemplateDetected') ? ['routing:detailPageTemplateDetected'] : []),
        ...(routingText.includes('detailPageTemplateScreenCount') ? ['routing:detailPageTemplateScreenCount'] : [])
      ]
    },
    {
      id: 'defaults-cannot-mint-authorization',
      description: '业务参数默认器可以补规格，但不得把执行、适配器或用户检查点批准设为 true。',
      violations: authorizationViolations
    },
    {
      id: 'sku-full-production-can-enter-without-document-and-design-missing-templates-autonomously',
      description: 'SKU 完整生产不依赖预先打开的 Photoshop 文档；缺模板时由 Agent 自主设计并续跑，只有用户明确要求模板方向 checkpoint 时才停下确认，普通原子写入仍不得绕过无文档门禁。',
      violations: skuAutonomousTemplateViolations
    },
    {
      id: 'skill-internal-atomic-tools-use-one-harness-target-binding-owner',
      description: '工作流 Skill 内部原子工具由 Harness 串行执行，复用统一 preflight 推进 document/revision，拒绝业务参数伪造 guard；文档 barrier 后必须真实读回再写。',
      violations: skillAtomicTargetBindingViolations
    },
    {
      id: 'provider-truncation-recovery-and-tool-failure-diagnostics-preserve-hard-boundaries',
      description: '截断恢复按有界窗口扩容且不越过配置硬上限；失败诊断保留结果对象身份、既有 code 与 nonFatal/cancelled 控制语义。',
      violations: providerRecoveryDiagnosticViolations
    },
    {
      id: 'text-skill-recommendation-remains-advisory-until-agent-or-user-selection',
      description: '自然语言命中的 business-workflow 只能作为模型可忽略的候选；只有用户显式选择或模型声明 Profile 才能绑定 Runtime owner，推荐不执行 Skill、不授予权限也不抢占交互 owner。',
      violations: runtimeSkillHandoffViolations
    },
    {
      id: 'compact-e1-owner-remains-model-selected',
      description: '紧凑 Runtime 可以在执行点要求既定 workflow owner 先行，但 Harness 不得合成 Tool call、把首轮工具面裁成 owner，或把模型文字回复改写成确定性执行。',
      violations: compactE1WorkflowOwnerViolations
    },
    {
      id: 'sku-model-parameters-cannot-mint-user-authority',
      description: 'SKU 模型参数只能提出组合、色名和模板候选；用户授权与权威业务事实必须来自原始用户消息、绑定确认回执或可追溯项目事实。用户明确委托可逆设计判断时允许继续制作，但只能标记为发布前待复核的非权威草稿。',
      violations: [
        ...delegationBoundaryViolations,
        ...([
          'params.skuComboConfirmationApproved === true',
          'params.skuCardTemplateDesignApproved === true',
          'params.skuPlaceholderTemplateFallbackApproved === true'
        ].filter((token) => (
          skuBatchExecutorText.includes(token)
          || skuTemplateDesignLoopText.includes(token)
        )).map((token) => `model-self-authorization:${token}`)),
        ...(skillDeclarationsText.includes("boolParam('skuPlaceholderTemplateFallbackApproved'")
          ? ['skill-schema-exposes-placeholder-fallback-approval']
          : []),
        ...(skuBatchExecutorText.includes("const trustedUserInput = String(_context?.userInput || '')")
          ? []
          : ['sku-batch:trusted-user-input-boundary-missing']),
        ...(skuBatchExecutorText.includes('const hasStrongComboSyntax = /[+＋]/.test(clause)')
          && skuBatchExecutorText.includes('const hasSizedComboLabel = /\\d{1,2}\\s*双装?\\s*[:：]/.test(clause)')
          ? []
          : ['sku-batch:explicit-combo-syntax-not-constrained']),
        ...(skuBatchExecutorText.includes('|| confirmedResumeCombos.length > 0')
          ? []
          : ['sku-batch:confirmed-combo-must-contain-validated-combos']),
        ...(skuColorCardExecutorText.includes('const userInput = clean(context?.userInput);')
          ? []
          : ['sku-color-card:filename-label-authorization-not-bound-to-context']),
        ...(skuColorCardExecutorText.includes('source.colorName || source.name')
          ? ['sku-color-card:generic-source-name-promoted-to-color-truth']
          : []),
        ...(skuColorCardExecutorText.includes("if (input.colorName) return 'inferred_candidate';")
          ? []
          : ['sku-color-card:model-color-name-not-marked-as-candidate']),
        ...(skuColorCardExecutorText.includes("card.colorNameSource !== 'provided'")
          ? []
          : ['sku-color-card:unverified-color-name-does-not-require-review']),
        ...(skuColorCardContractText.includes("if (hasProvidedColorName) return 'inferred_candidate';")
          ? []
          : ['sku-color-card-contract:missing-provenance-defaults-to-authoritative']),
        ...(skuTemplateDesignLoopText.includes('if (hasExplicitSkuPlaceholderTemplateFallbackText(userInput))')
          ? []
          : ['sku-template:placeholder-fallback-not-bound-to-user-text']),
        ...(skuIntentParamsText.includes('noteRequested || genericSkuBatch')
          ? ['sku-batch:generic-request-expands-delivery-to-notes']
          : []),
        ...(skuIntentParamsText.includes('let generateNotes = noteRequested;')
          && skuIntentParamsText.includes("if (noteDisposition === 'required')")
          && skuIntentParamsText.includes("else if (noteDisposition === 'excluded')")
          ? []
          : ['sku-batch:note-generation-not-bound-to-explicit-note-request']),
        ...(defaultsText.includes('generateNotes: sourceOnly ? false : true')
          ? ['sku-batch:defaults-expand-delivery-to-notes']
          : []),
        ...(engineText.includes('sanitized.generateNotes = true')
          ? ['engine:controlled-sku-expands-delivery-to-notes']
          : []),
      ]
    },
    {
      id: 'task-type-reaches-profile-resolver',
      description: '生产 Executor 从已解析 Runtime Bundle 传递 artifact/method/taskType/workMode 性能身份，不用 autonomous-agent 覆盖业务组合。',
      violations: [
        ...(performanceText.includes('taskType?: string') ? [] : ['performance-input:taskType']),
        ...(performanceResolverText.includes('runtimeContractBundle?.methodManifests[0]?.skill_id')
          ? []
          : ['executor:method-skill-identity-not-from-runtime-bundle']),
        ...(performanceResolverText.includes('runtimeContractBundle?.artifactManifest?.task_type')
          ? []
          : ['executor:artifact-task-identity-not-from-runtime-bundle']),
        ...(performanceResolverText.includes('taskType: performanceTaskType') ? [] : ['executor:taskType-handoff']),
        ...(performanceResolverText.includes('workMode: runtimeContractBundle?.stagePlan.expectedWorkMode')
          ? []
          : ['executor:expected-work-mode-not-handed-off']),
        // 设计路径宪法（2026-08-17）：agentic 清单不建 Stage 机但仍贡献预算画像，
        // 因此启动预算解析接受 resolveKnowledgeBundle()（= runtimeContractBundle || agenticManifestBundle）。
        ...(/resolveAutonomousPerformancePolicy\([\s\S]{0,320}(?:runtimeContractBundle|resolveKnowledgeBundle\(\))\s*\)/.test(executorText)
          && executorText.includes('runtimeContractBundle || agenticManifestBundle')
          ? []
          : ['executor:runtime-bundle-not-passed-to-performance-resolver'])
      ]
    },
    {
      id: 'work-mode-identity-is-upstream-locked',
      description: '上游结构化 workMode 是 Runtime 身份的一部分：R1 只能确认，不能把 edit_existing 改成 create_new。',
      violations: [
        ...(runtimeBundleText.includes('buildRuntimeStagePlan(manifest, expectedWorkMode)')
          ? []
          : ['runtime-bundle:expected-work-mode-not-bound-to-stage-plan']),
        ...(runtimeStagePlanText.includes('plan.expectedWorkMode || normalizeRuntimeDesignWorkMode(workMode)')
          ? []
          : ['runtime-stage-plan:declared-mode-can-override-expected-mode']),
        ...(runtimeDesignBriefText.includes("addIssue(issues, 'work_mode_identity_mismatch', 'workMode')")
          ? []
          : ['runtime-design-brief:work-mode-mismatch-not-rejected']),
        ...(runtimeDesignBriefText.includes('enum: input.expectedWorkMode ? [input.expectedWorkMode]')
          ? []
          : ['runtime-design-brief:schema-does-not-lock-expected-mode'])
      ]
    },
    {
      id: 'task-planning-consumes-selected-manifest',
      description: '请求级计划从已选 Manifest 读取交付物、必要输入、来源引用、必要观察与 taskType，不在 Agent 核心复制业务清单。',
      violations: [
        ...(planningContractText.includes('resolvePlanningManifest') ? [] : ['planning:resolvePlanningManifest']),
        ...(planningContractText.includes('manifest.delivery_outputs') ? [] : ['planning:manifest.delivery_outputs']),
        ...(planningContractText.includes('buildManifestRequiredInputs') ? [] : ['planning:manifest-required-inputs']),
        ...(planningContractText.includes('manifest.required_inputs') ? [] : ['planning:manifest-required-input-source']),
        ...(planningContractText.includes('manifest.knowledge_refs') ? [] : ['planning:manifest-source-refs']),
        ...(planningContractText.includes("needsVisualObservation ? 'visual_observation'") ? [] : ['planning:manifest-required-observations']),
        ...(planningContractText.includes('taskType: manifest?.task_type') ? [] : ['planning:manifest-task-type-handoff'])
      ]
    },
    {
      id: 'detail-work-mode-contract-does-not-promote-edit-to-create',
      description: '详情页局部编辑使用完整替换契约；建立新详情页结构时保留 storyboard 专业步骤，但不得默认制造人工确认点。',
      violations: [
        ...(detailEditContract ? [] : ['detail:missing-edit-existing-contract']),
        ...(detailCreateContract ? [] : ['detail:missing-create-new-contract']),
        ...(detailEditContract?.required_inputs.includes('product') ? ['detail:edit-requires-product'] : []),
        ...(detailEditContract?.required_inputs.includes('asset_source') ? ['detail:edit-requires-asset-source'] : []),
        ...(detailEditContract?.review_rubric_ref === 'rubrics/detail-page-scoped-edit.v1'
          ? []
          : ['detail:edit-missing-scoped-evaluation-profile']),
        ...(detailEditContract?.performance_profile?.budget?.max_tool_calls < detailManifest?.performance_profile?.budget?.max_tool_calls
          ? []
          : ['detail:edit-performance-profile-not-scoped']),
        ...(detailManifest?.reference_policy?.work_mode_requirements?.edit_existing === 'not_required'
          ? []
          : ['detail:edit-reference-policy-not-scoped']),
        ...(['create_new', 'redesign'].filter((workMode) => (
          detailManifest?.reference_policy?.work_mode_requirements?.[workMode] !== 'reuse_or_optional'
        )).map((workMode) => `detail:${workMode}-reference-must-be-optional`)),
        ...(detailEditContract?.exit_criteria.some((item) => item.includes('storyboard 已生成且经用户确认'))
          ? ['detail:edit-inherits-storyboard-approval']
          : []),
        ...(detailCreateContract?.required_inputs.includes('product') ? [] : ['detail:create-missing-product']),
        ...(detailCreateContract?.exit_criteria.some((item) => item.includes('storyboard 已生成并由 Agent'))
          ? []
          : ['detail:create-missing-storyboard-self-review']),
        ...(detailCreateContract?.exit_criteria.some((item) => item.includes('storyboard 已生成且经用户确认'))
          ? ['detail:create-defaults-to-manual-storyboard-approval']
          : []),
        ...(planningContractText.includes('resolveSkillRuntimeEffectiveContract')
          ? []
          : ['planning:missing-work-mode-contract-resolver'])
      ]
    },
    {
      id: 'agent-observation-reuse-and-semantic-liveness',
      description: '重复只读与缓存快照不得刷新 TaskRun 活性或重复消耗视觉预算；目标 revision 变化后必须废弃旧计划、回到观察/规划并只允许新 revision 写入。',
      violations: [
        ...observationLivenessViolations,
        ...(agentReadResultCacheText.includes('issuedAgentReadResultCacheHits')
          && agentReadResultCacheText.includes('countsAsObservation: false')
          && agentReadResultCacheText.includes('countsAsTaskProgress: false')
          ? []
          : ['read-cache:harness-owner-or-credit-boundary-missing']),
        ...(agentRuntimeLivenessPolicyText.includes('buildAgentRuntimeProgressKey')
          && agentRuntimeLivenessPolicyText.includes('buildUnfinishedContinuationKey')
          && !agentRuntimeLivenessPolicyText.includes('successfulReadCount')
          ? []
          : ['task-run-progress:liveness-owner-incomplete']),
        ...(runtimeStageStateText.includes('reobserveRuntimeStageAfterDocumentChange')
          && runtimeSessionText.includes('reenterRuntimeSessionAfterDocumentChange')
          && runtimeSessionText.includes('reconcileRuntimeSessionDocumentRevision')
          && runtimeSessionText.includes('acknowledgeRuntimeSessionWorkflowDocumentReobservation')
          && runtimeSessionText.includes('runtime_task_run_document_revision_replanned')
          && runtimeSessionText.includes('runtime_task_run_document_revision_reobserved')
          ? []
          : ['reobserve:state-transition-owner-missing']),
        ...(!agentRuntimeText.includes('const readFailureReason = failedTaskResults')
          && !agentRuntimeText.includes('请按原始错误建议换路径')
          && agentRuntimeText.includes('这次没有读到可用内容。')
          && agentRuntimeText.includes('不要在同一目标上重复读取')
          ? []
          : ['read-failure:raw-provider-reason-entered-user-process'])
      ]
    },
    {
      id: 'autonomous-task-continuity-and-local-recovery',
      description: '自主 Agent 必须通过有界历史承接同一会话的具体交付目标；可选只读观察失败不得冒充交付失败，已声明为生产型设计任务时零写入不得通过。',
      violations: [
        ...(executorText.includes('selectAgentConversationContext')
          && executorText.includes('buildAgentConversationHistoryRuntimeItem')
          && executorText.includes('messages: context?.conversationHistory || []')
          && executorText.includes("source: 'autonomous-agent-history'")
          ? []
          : ['autonomous-agent:bounded-conversation-continuity-missing']),
        ...(executorText.includes('同一会话里已经明确且尚未完成的交付物')
          && executorText.includes('不要用反复搜索素材代替任务澄清')
          ? []
          : ['autonomous-agent:task-grounding-discipline-missing']),
        ...(promptText.includes('【知识冷启动】')
          && promptText.includes('知识库、项目记忆或参考检索未命中，不代表你不会做')
          && promptText.includes('模型先验只能提供方法与待验证假设')
          && promptText.includes('项目观察或工具读回')
          && executorText.includes('没有命中时使用模型已有知识冷启动')
          ? []
          : ['autonomous-agent:model-native-knowledge-cold-start-boundary-missing']),
        ...(toolSchemasText.includes('它不是通用设计开工前置，不能用来发现任务目标')
          && toolExecutorText.includes('【可选参考构图测量】')
          ? []
          : ['reference-measurement:still-presented-as-mandatory-preflight']),
        ...(agentRuntimeTypesText.includes('failureDisposition?:')
          && agentRuntimeTypesText.includes("'non_blocking_observation'")
          && agentRuntimeTypesText.includes("'control_turn_deferred'")
          && agentRuntimeText.includes("entry.failureDisposition = 'non_blocking_observation'")
          && agentRuntimeText.includes('if (entry.failureDisposition) continue;')
          ? []
          : ['agent-runtime:non-blocking-observation-failure-accounting-missing']),
        ...runtimeReferenceFailurePolicyViolations.map((item) => (
          `agent-runtime:reference-failure-policy:${item}`
        )),
        ...(agentRuntimeTypesText.includes('agenticReferencePolicy?: RuntimeReferencePolicyProjection')
          && executorText.includes('agenticReferencePolicy: projectRuntimeReferencePolicy(')
          && executorText.includes('referencePolicy: projectRuntimeReferencePolicy(')
          && agentRuntimeText.includes('return resolveAgentActiveReferencePolicy(this.config);')
          && runtimeReferenceAdapterText.includes('config.runtimeStagePlan?.referencePolicy || config.agenticReferencePolicy')
          && runtimeReferenceAdapterText.includes('resolveRuntimeReferenceFailureDisposition({')
          && agentRuntimeText.includes('resolveAgentReferenceFailureDisposition({')
          && agentRuntimeText.includes('this.reconcileReferenceFailureDispositions();')
          && runtimeReferenceContextText.includes('只读取 Tool 返回的结构化 code/status/category')
          && runtimeReferenceContextText.includes("requirement === 'reuse_or_optional' || requirement === 'not_required'")
          && runtimeReferenceContextText.includes("input.referenceReadiness === 'degraded'")
          && !agentRuntimeText.includes("toolName === 'searchEagleReferences'")
          ? []
          : ['agent-runtime:manifest-reference-policy-not-atomically-projected']),
        ...(agentRuntimeText.includes("runtimeBriefRequiresDelivery")
          && agentRuntimeText.includes("productionObligation === 'photoshop_mutation_with_readback'")
          && agentRuntimeText.includes('!requiresAgentTaskProgress(plan)')
          && agentRuntimeText.includes('!runtimeBriefRequiresDelivery')
          ? []
          : ['agent-runtime:declared-production-obligation-not-enforced']),
        ...(agentUserResultProjectionText.includes('buildAgentOperationLedger(toolCallLog)')
          && agentUserResultProjectionText.includes('findObservedPhotoshopMutationProof(entry.result)')
          && agentUserResultProjectionText.includes('isDesignDisciplineMutationTool(entry.name)')
          && agentUserResultProjectionText.includes("entry.name === 'createDocument'")
          && agentUserResultProjectionText.includes('const hasViewableVersion = input.hasViewableDesignChange || input.hasSavedOrExportedFile;')
          && !agentRuntimeText.includes('const hasRecordedMutation = Number(summary.successfulMutationCalls || 0) > 0;')
          && agentUserResultProjectionText.includes("versionState = '当前状态：还没有可看的设计版本。';")
          && agentUserResultProjectionText.includes("title = hasViewableVersion ? '当前改动已保留' : '这次还没做出版本';")
          ? []
          : ['agent-runtime:unproven-write-can-claim-viewable-version']),
        ...(agentRuntimeText.includes("const awaitingInteractiveConfirmation = input.stopReason === 'awaiting_user_confirmation';")
          && agentRuntimeText.includes("const awaitingUserInput = input.stopReason === 'awaiting_user_input';")
          // 2026-08-18：用户正文永远是模型自己的话（不再被状态口播替换）；提问态自然也不会被投影吞掉。
          && agentRuntimeText.includes("let rawVisibleMessage = String(input.message || '').trim()")
          && agentUserResultProjectionText.includes("const awaitingInteractiveConfirmation = summary.stopReason === 'awaiting_user_confirmation';")
          && agentUserResultProjectionText.includes("const awaitingUserInput = summary.stopReason === 'awaiting_user_input';")
          && agentUserResultProjectionText.includes('需要你回答上面的问题；收到后会从当前状态继续。')
          ? []
          : ['agent-runtime:plain-user-question-collapsed-into-confirmation-card']),
        ...(!agentRuntimeText.includes('if (error) return `失败原因: ${error}`;')
          && agentRuntimeText.includes('return `${displayName}没有拿到可确认的完成结果。`;')
          && agentActionEventProjectionText.includes("issue: 'tool_attempt_failed'")
          && agentActionEventProjectionText.includes('userVisible: false')
          && agentRuntimeText.includes("audience: actionEvent.userVisible ? 'user' : 'debug'")
          ? []
          : ['agent-runtime:raw-tool-error-entered-user-process']),
        ...(agentRuntimeText.includes('private buildVerificationStepDetail(projection: UserResultProjection): string')
          && agentRuntimeText.includes('detail: this.buildVerificationStepDetail(userResultProjection)')
          // 2026-08-18：投影只进 executionSummary（诊断），正文以模型原话为准、投影仅兜底空回复。
          && agentRuntimeText.includes("let rawVisibleMessage = String(input.message || '').trim()")
          && agentRuntimeText.includes('executionSummary.userVisibleSummary = userResultProjection.summary;')
          && messageParserText.includes("safeDiagnosticText(summary.userVisibleSummary || '')")
          && messageParserText.includes("safeDiagnosticText(summary.userVisibleNextStep || '')")
          && !messageParserText.includes('message.executionSummary?.summaryText')
          && !messageParserText.includes('summary?.summaryText')
          && chatPanelText.includes('summary?.userVisibleSummary || \'\'')
          && chatPanelText.includes('summary?.userVisibleNextStep || \'\'')
          && !chatPanelText.includes('input.executionSummary?.summaryText')
          && !/formatFailureContent\(\s*resultVisibleMessage,\s*result\.error,/u.test(chatPanelText)
          && !chatPanelText.includes('summaryText: summary?.summaryText')
          && !chatPanelText.includes('executionResultSummary?.successfulMutationCalls')
          && !chatResponseCleanerText.includes('return `错误: ${cleaned}`;')
          && !chatResponseCleanerText.includes('summaryText?: string;')
          && !chatResponseCleanerText.includes('successfulMutationCalls?: number;')
          ? []
          : ['agent-runtime:user-result-projection-consumes-internal-completion-text'])
      ]
    },
    {
      id: 'delivery-and-scoped-edit-verification-cannot-be-shortcut',
      description: '有声明交付物时原始 save 不能绕过 E2 receipt；单文档收据后续 save/写入、多文档收据后续内容 mutation 必须使其失效；局部修改必须验证目标达成且范围外未受影响。',
      violations: [
        ...(agentRuntimeText.includes('if (requiredOutputs.length === 0)')
          ? []
          : ['delivery:raw-save-can-bypass-declared-outputs']),
        ...(agentRuntimeText.includes('const laterContentMutationExists = findLatestObservedPhotoshopMutationIndex(laterEntries) >= 0;')
          && agentRuntimeText.includes("receipt.settlementScope === 'multi_document_task'")
          && agentRuntimeText.includes('laterSaveExportExists || laterContentMutationExists')
          && agentRuntimeText.includes('if (laterMutationExists) continue;')
          ? []
          : ['delivery:post-receipt-write-does-not-invalidate-receipt']),
        ...(runtimeScopedChangeRecordsText.includes("key: 'requested_change_applied' | 'outside_scope_preserved'")
          ? []
          : ['scoped-edit:acceptance-verification-keys-missing']),
        ...(agentRuntimeText.includes('buildRuntimeScopedChangeVerificationRecords(this.toolCallLog, {')
          && agentRuntimeText.includes('exactPropertyScope: this.config.runtimeExactPropertyScope')
          && agentRuntimeText.includes('surfaceSnapshot && !evaluatesScopedChanges')
          ? []
          : ['scoped-edit:verification-not-built-from-live-tool-log']),
        ...(scopedTextAcceptance.verified === true
          && scopedTextAcceptance.assertionStatus === 'passed'
          && scopedTextRecords.find((record) => record.key === 'requested_change_applied')?.status !== 'passed'
          && scopedTextRecords.find((record) => record.key === 'outside_scope_preserved')?.status !== 'passed'
          ? []
          : [`scoped-edit:unsigned-self-consistent-acceptance-was-trusted:${JSON.stringify({
            acceptance: scopedTextAcceptance,
            records: scopedTextRecords
          })}`]),
        ...(scopedTextOutsideMutationRecords.find((record) => record.key === 'requested_change_applied')?.status !== 'passed'
          && scopedTextOutsideMutationRecords.find((record) => record.key === 'outside_scope_preserved')?.status !== 'passed'
          ? []
          : [`scoped-edit:unsigned-outside-scope-mutation-was-trusted:${JSON.stringify({
            acceptance: scopedTextOutsideMutationAcceptance,
            records: scopedTextOutsideMutationRecords
          })}`]),
        ...(exactTextScopedRecords.find((record) => record.key === 'requested_change_applied')?.status === 'passed'
          && exactTextScopedRecords.find((record) => record.key === 'outside_scope_preserved')?.status === 'passed'
          && exactTextScopedRecords.find((record) => record.key === 'fresh_structure_snapshot')?.status === 'passed'
          ? []
          : [`scoped-edit:signed-exact-text-scope-did-not-close:${JSON.stringify(exactTextScopedRecords)}`]),
        ...(staleFinalHistoryRecords.some((record) => (
          record.key === 'fresh_structure_snapshot' && record.status === 'passed'
        ))
          ? [`scoped-edit:stale-acceptance-after-history-was-reused:${JSON.stringify(staleFinalHistoryRecords)}`]
          : []),
        ...(missingFinalHistoryRecords.some((record) => (
          record.key === 'fresh_structure_snapshot' && record.status === 'passed'
        ))
          ? [`scoped-edit:missing-final-history-was-treated-as-fresh:${JSON.stringify(missingFinalHistoryRecords)}`]
          : []),
        ...(staleScopedProfileEvaluation?.status === 'passed'
          || staleScopedProfileEvaluation?.scorecard.gate === 'passed'
          ? [`scoped-edit:stale-acceptance-was-combined-with-current-surface-to-pass:${JSON.stringify(staleScopedProfileEvaluation)}`]
          : []),
        ...(longTextScopedRecords.find((record) => record.key === 'requested_change_applied')?.status === 'passed'
          ? []
          : [`scoped-edit:long-valid-text-was-rejected-by-summary-truncation:${JSON.stringify(longTextScopedRecords)}`]),
        ...(multilineScopedRecords.find((record) => record.key === 'requested_change_applied')?.status === 'passed'
          ? []
          : [`scoped-edit:photoshop-cr-multiline-text-was-rejected:${JSON.stringify(multilineScopedRecords)}`]),
        ...(wrongValueScopedRecords.find((record) => record.key === 'requested_change_applied')?.status !== 'passed'
          && wrongValueScopedRecords.find((record) => record.key === 'outside_scope_preserved')?.status === 'passed'
          ? []
          : [`scoped-edit:self-consistent-wrong-value-was-accepted:${JSON.stringify(wrongValueScopedRecords)}`]),
        ...(wrongLayerScopedRecords.find((record) => record.key === 'requested_change_applied')?.status !== 'passed'
          && wrongLayerScopedRecords.find((record) => record.key === 'outside_scope_preserved')?.status === 'failed'
          ? []
          : [`scoped-edit:self-consistent-wrong-layer-was-accepted:${JSON.stringify(wrongLayerScopedRecords)}`]),
        ...(failedOuterWrongLayerRecords.find((record) => record.key === 'requested_change_applied')?.status !== 'passed'
          && failedOuterWrongLayerRecords.find((record) => record.key === 'outside_scope_preserved')?.status === 'failed'
          ? []
          : [`scoped-edit:host-proven-wrong-layer-mutation-was-hidden-by-outer-failure:${JSON.stringify(failedOuterWrongLayerRecords)}`]),
        ...(scopedEditExecutionScopeDecisions.missing.status === 'missing'
          && scopedEditExecutionScopeDecisions.layerName.status === 'mismatch'
          && scopedEditExecutionScopeDecisions.unspecified.status === 'mismatch'
          && scopedEditExecutionScopeDecisions.text.status === 'ready'
          ? []
          : [`scoped-edit:execution-scope-boundary-invalid:${JSON.stringify(scopedEditExecutionScopeDecisions)}`]),
        ...(executorText.indexOf('const startupExecutionScope = validateRuntimeExecutionScope') >= 0
          && executorText.indexOf('const startupExecutionScope = validateRuntimeExecutionScope')
            < executorText.indexOf('const createAutonomousAgent = () => new Agent')
          && executorText.indexOf('const candidateExecutionScope = validateRuntimeExecutionScope') >= 0
          && executorText.indexOf('const candidateExecutionScope = validateRuntimeExecutionScope')
            < executorText.indexOf('currentAgent.activateRuntimeContractFromDeclaration')
          && executorText.indexOf('const candidateExecutionScope = validateRuntimeExecutionScope')
            < executorText.indexOf('capabilitySession.bindManifest')
          && executorText.includes('evaluateScopedEditExecutionScope')
          ? []
          : ['scoped-edit:startup-or-late-bind-execution-scope-gate-missing'])
      ]
    },
    {
      id: 'exact-property-request-write-scope-cannot-expand',
      description: '单一精确属性替换必须复用请求级写范围；任务类型或模型后续声明不能扩张写能力，复合请求也不能被局部解析器误收窄。',
      violations: [
        ...exactPropertyWriteScopeViolations,
        ...unauthorizedExactPropertyScopeViolations,
        ...exactTargetResolutionViolations,
        ...(agentToolExecutionPreflightText.includes('resolveExactPropertyReplacementWriteToolScope')
          && agentToolExecutionPreflightText.includes('OTHER_EXPLICIT_MUTATION_PATTERN.test(remainder)')
          ? []
          : ['exact-property-scope:resolver-or-compound-request-boundary-missing']),
        ...(engineText.includes('resolveAuthorizedExactPropertyReplacementExecutionScope')
          && engineText.includes('runtimeAllowedWriteTools: exactPropertyExecutionScope.allowedWriteTools')
          && engineText.includes('runtimeExactPropertyScope: exactPropertyExecutionScope')
          ? []
          : ['exact-property-scope:engine-request-scope-wiring-missing']),
        ...(executorText.includes('filterRuntimeCandidateTools')
          && executorText.includes("kind !== 'photoshop_write' && kind !== 'save_export'")
          ? []
          : ['exact-property-scope:model-visible-write-filter-missing']),
        ...(agentRuntimeText.includes('evaluateRuntimeWriteToolScope')
          && agentRuntimeText.includes('allowedWriteTools: this.config.runtimeWriteToolAllowlist')
          ? []
          : ['exact-property-scope:final-execution-deny-wins-missing']),
        ...(executorText.includes('runtimeExactPropertyScope')
          && (agentRuntimeText.split('exactPropertyScope: this.config.runtimeExactPropertyScope').length - 1) >= 2
          ? []
          : ['exact-property-scope:signed-scope-not-projected-into-agent-runtime'])
      ]
    },
    {
      id: 'sku-single-skill-entry',
      description: 'SKU 领域只注册一个完整 sku-batch Skill；色卡、模板与批量 Task Profile 都由该 Skill 承接，通用 Agent/Harness 不复制 SKU 阶段或猜占位数量。',
      violations: [
        ...(skillRoutingText.includes("normalizedSkillId === 'sku-batch'")
          || skillRoutingText.includes('SKU_DOCUMENT_CREATE_PATTERN')
          || skillRoutingText.includes('isExplicitSkuCombinationProductionRoutingIntent')
          || skillRoutingText.includes('resolveSkuRoutingIntentVerdict')
          ? ['agent-core:generic-skill-matcher-still-contains-sku-business-branches']
          : []),
        ...(!genericCardSchemaText
          || /sku-batch|SKU\s*(不得|必须)/i.test(genericCardSchemaText)
          ? ['agent-core:generic-confirmation-card-still-routes-sku-workflow']
          : []),
        ...(!designKnowledgeSchemaText
          || /(必须|优先|只能).{0,24}(调用|路由|进入).{0,24}sku-batch|统一\s*SKU\s*Skill|stage\s*=/i.test(designKnowledgeSchemaText)
          ? ['agent-core:generic-knowledge-tool-still-routes-sku-workflow']
          : []),
        ...(skillDeclarationsText.includes("id: 'sku-config'") ? ['skill-registry:sku-config-still-declared'] : []),
        ...(skillDeclarationsText.includes("id: 'sku-color-card'") ? ['skill-registry:sku-color-card-still-declared'] : []),
        ...(skillExecutorIndexText.includes('registerSkillExecutorInRegistry(skuConfigExecutor)')
          ? ['skill-registry:sku-config-still-registered']
          : []),
        ...(skillExecutorIndexText.includes('registerSkillExecutorInRegistry(skuColorCardExecutor)')
          ? ['skill-registry:sku-color-card-still-registered']
          : []),
        ...(skuBatchExecutorText.includes("runSkill('sku-color-card'")
          ? ['sku-batch:color-card-still-runs-as-child-skill']
          : []),
        ...(skuBatchExecutorText.includes('executeSkuColorCardStrategy(')
          ? []
          : ['sku-batch:internal-color-card-strategy-missing']),
        ...(skuBatchExecutorText.includes('executeSkuConfigurationStrategy(')
          ? []
          : ['sku-batch:internal-configuration-strategy-missing']),
        ...(skuConfigExecutorText.includes('params?.placeholderCount || 5')
          ? ['sku-config:placeholder-count-still-defaulted']
          : []),
        ...(skuTaskProfileManifests.length === 3
          ? []
          : [`sku-runtime:expected-three-task-profiles:${skuTaskProfileManifests.length}`]),
        ...skuTaskProfileManifests.flatMap((manifest) => {
          const entrySkillIds = Array.from(new Set(manifest.workflow_entry_skill_ids || []));
          const validEntry = entrySkillIds.length === 1 && entrySkillIds[0] === 'sku-batch';
          return validEntry
            ? []
            : [`sku-runtime:${manifest.task_type}:workflow-entry=${entrySkillIds.join(',') || 'missing'}`];
        }),
        ...(manifestSchema?.properties?.workflow_entry_skill_ids
          ? []
          : ['sku-runtime:schema-missing-workflow-entry-skill-ids']),
        ...(manifestSchema?.properties?.task_type_variants
          ? []
          : ['sku-runtime:schema-missing-task-type-variants']),
        ...(planningContractText.includes('manifest.workflow_entry_skill_ids')
          ? []
          : ['sku-runtime:planning-does-not-consume-workflow-entry'])
      ]
    },
    {
      id: 'design-intent-schema-follows-runtime-profile-catalog',
      description: 'declareDesignIntent 的合法 taskTypeId/workMode 与首轮任务角色语义必须动态来自已通过发布校验的 Runtime Profile / Task Profile 目录；匹配 Skill 时直接调用，只有系统给出精确 Profile 且无匹配 Skill 时才声明。',
      violations: [
        ...(toolSchemasText.includes('buildRuntimeDeclarationProfileCatalog')
          ? []
          : ['tool-schema:missing-runtime-declaration-profile-catalog']),
        ...(toolSchemasText.includes('enum: DECLARABLE_DESIGN_TASK_TYPE_IDS')
          ? []
          : ['tool-schema:missing-dynamic-task-type-enum']),
        ...(toolSchemasText.includes('enum: DECLARABLE_RUNTIME_WORK_MODES')
          ? []
          : ['tool-schema:missing-dynamic-work-mode-enum']),
        ...(toolSchemasText.includes('If a matching Skill tool is already visible, call that Skill directly')
          && toolSchemasText.includes('only when the system prompt explicitly names the exact Profile id')
          && toolSchemasText.includes('pass that id as taskTypeId')
          && executorText.includes('declareDesignIntent({ taskTypeId: <Profile> })')
          && !executorText.includes('declareDesignIntent({ taskType:')
          && !toolSchemasText.includes('with that taskType to bind it')
          ? []
          : ['tool-schema:declare-design-intent-skill-or-profile-rule-drifted']),
        ...(executorText.includes('getDesignTaskTypeSpec(manifest.task_type)?.declarationGuidance')
          && executorText.includes('const declarationGuidance = taskProfileGuidance || whenToUse;')
          && executorText.includes('declarationGuidance.slice(0, 420)')
          ? []
          : ['runtime-profile-menu:task-profile-guidance-not-consumed-before-binding']),
        ...(mainImageDeclarationGuidance.includes('只委托一张泛称商品主图')
          && mainImageDeclarationGuidance.includes('按搜索或推荐列表的点击入口理解')
          && mainImageDeclarationGuidance.includes('不能单独决定素材或方案赢家')
          && mainImageDeclarationGuidance.length <= 420
          ? []
          : ['main-image-task-profile:generic-single-image-role-not-disambiguated']),
        ...(/(?:模特|平铺|真人|场景图|白底图|静物)|(?:固定|指定)(?:风格|版式|模板|工具|步骤)|(?:composeDesign|renderLayout|Tool)|工具顺序|(?:必须|只能|优先)(?:使用|选择|调用|采用)/iu.test(mainImageDeclarationGuidance)
          ? ['main-image-task-profile:role-guidance-prescribes-design-answer']
          : [])
      ]
    },
    {
      id: 'task-profile-owns-design-knowledge-crosswalk',
      description: 'Task Profile 是 taskType、Manifest、旧 Skill、文档角色与交付物知识的唯一 crosswalk；知识注册表不再自行解析 namespaced taskType。',
      violations: [
        ...taskProfileCrosswalks.flatMap((crosswalk) => (
          crosswalk.artifactKnowledgeIds
            .filter((artifactId) => !artifactKnowledgeIds.has(artifactId))
            .map((artifactId) => `${crosswalk.taskTypeId}:unknown-artifact-knowledge:${artifactId}`)
        )),
        ...artifactOwnerManifests.flatMap((manifest) => {
          const crosswalk = taskProfileCrosswalkByManifest.get(manifest.skill_id);
          if (!crosswalk) return [`${manifest.skill_id}:task-profile-crosswalk-missing`];
          return crosswalk.taskTypeId === manifest.task_type
            ? []
            : [`${manifest.skill_id}:task-type-mismatch:${crosswalk.taskTypeId}`];
        }),
        ...(taskProfileText.includes('resolveDesignTaskProfileArtifactKnowledgeId')
          ? []
          : ['task-profile:artifact-crosswalk-resolver-missing']),
        ...(artifactKnowledgeText.includes('resolveDesignTaskProfileArtifactKnowledgeId')
          ? []
          : ['artifact-knowledge:task-profile-crosswalk-not-consumed']),
        ...(getDesignArtifactKnowledge('ecommerce.main_image.v1')?.artifactId === 'main-image'
          ? []
          : ['artifact-knowledge:task-type-resolution-failed']),
        ...(getDesignArtifactKnowledge('mainImage')?.artifactId === 'main-image'
          ? []
          : ['artifact-knowledge:document-role-resolution-failed']),
        ...(getDesignArtifactKnowledge('sku')?.artifactId === 'sku'
          ? []
          : ['artifact-knowledge:sku-disambiguation-missing']),
        ...(structuredMainImageKnowledge?.id === 'knowledge.artifact.main-image'
          ? []
          : ['artifact-knowledge:structured-runtime-item-missing']),
        ...(singleCanvasPosterKnowledge?.id === 'knowledge.artifact.poster'
          ? []
          : ['artifact-knowledge:allowed-artifact-kind-not-selected']),
        ...(singleCanvasInvalidKnowledge?.id === 'knowledge.artifact.generic'
          ? []
          : ['artifact-knowledge:invalid-artifact-kind-not-defaulted']),
        ...(/\(\?:ecommerce\|design\)\\\./.test(artifactKnowledgeText)
          ? ['artifact-knowledge:owns-namespaced-task-normalization']
          : [])
      ]
    },
    {
      id: 'design-knowledge-is-stage-bound-and-available-without-skill',
      description: 'Manifest 方法论必须保留 applicableStages；Task Profile 知识在结构化运行中按阶段注入，未结构化声明后立即回填，不依赖业务 Skill Executor。',
      violations: [
        ...(runtimeMethodKnowledgeText.includes('buildDesignMethodKnowledgeRuntimeContext')
          && runtimeMethodKnowledgeText.includes('applicableStages: [...definition.applicableStages]')
          ? []
          : ['method-knowledge:stage-bound-runtime-items-missing']),
        ...(mainImageMethodContext.issues.length === 0 ? [] : mainImageMethodContext.issues),
        ...(mainImageR0Knowledge.includedItemIds.length === 0
          ? []
          : ['method-knowledge:r0-received-later-stage-methods']),
        ...(mainImageR3Knowledge.includedItemIds.some((id) => id.includes('content-strategy'))
          && mainImageR3Knowledge.includedItemIds.some((id) => id.includes('art-direction'))
          && mainImageR3Knowledge.includedItemIds.some((id) => id.includes('main-image'))
          && !mainImageR3Knowledge.includedItemIds.some((id) => id.includes('layout-planning'))
          ? []
          : ['method-knowledge:r3-selection-invalid']),
        ...(mainImageR4Knowledge.includedItemIds.some((id) => id.includes('layout-planning'))
          && mainImageR4Knowledge.includedItemIds.some((id) => id.includes('main-image'))
          && !mainImageR4Knowledge.includedItemIds.some((id) => id.includes('content-strategy'))
          && !mainImageR4Knowledge.includedItemIds.some((id) => id.includes('art-direction'))
          ? []
          : ['method-knowledge:r4-selection-invalid']),
        ...(agentRuntimeText.includes('selectRuntimeContextItemsForStage(items, stage)')
          && agentRuntimeText.includes('compileRuntimeContext({')
          && agentRuntimeText.includes('items: applicableItems')
          && agentRuntimeText.includes('stage,')
          && agentRuntimeText.includes('maxTotalCharacters: this.runtimeContextCharacterBudget')
          && agentRuntimeText.includes('refreshPrimarySystemMessage()')
          ? []
          : ['agent:stage-context-not-refreshed']),
        ...(executorText.includes('runtimeStageContextItems')
          && executorText.includes('buildDesignArtifactKnowledgeRuntimeItem')
          ? []
          : ['executor:task-profile-knowledge-not-handed-off']),
        ...(executorText.includes('buildDynamicDesignTaskOperatingContext')
          && executorText.includes('buildDesignTaskTypePromptSection(spec')
          && executorText.includes('getDynamicOperatingContext: () => [')
          && agentRuntimeText.includes('this.config.getDynamicOperatingContext?.()')
          ? []
          : ['agent:declared-task-profile-not-refreshed-into-live-context']),
        ...(toolExecutorText.includes('knowledgeInjectedByRuntimeCompiler: true')
          && !toolExecutorText.includes('designKnowledge: {')
          ? []
          : ['declare-design-intent:knowledge-runtime-compiler-boundary-missing'])
      ]
    },
    {
      id: 'photoshop-craft-recipe-is-governed-stage-knowledge',
      description: 'Craft Recipe 只能是版本化、可选择的 Knowledge；必须引用真实 Tool、按 R4/R5 装载，并在无 Skill Task Profile 声明后可达。',
      violations: [
        ...(photoshopCraftRecipes.length > 0 ? [] : ['craft-recipe:missing']),
        ...photoshopCraftRecipes.flatMap((recipe) => {
          const problems = [];
          if (recipe.schemaVersion !== 'photoshop-craft-recipe/v0') problems.push('schema-version');
          if (!recipe.recipeId || !recipe.version) problems.push('identity');
          if (recipe.provenance?.lifecycle !== 'active') problems.push('lifecycle');
          if (!recipe.provenance?.sourceRevision) problems.push('source-revision');
          if (!Array.isArray(recipe.requiredObservations) || recipe.requiredObservations.length === 0) {
            problems.push('required-observations');
          }
          if (!Array.isArray(recipe.parameterSources) || recipe.parameterSources.length === 0) {
            problems.push('parameter-sources');
          }
          if (!Array.isArray(recipe.toolOptions) || recipe.toolOptions.length === 0) {
            problems.push('tool-options');
          }
          for (const option of recipe.toolOptions || []) {
            if (!toolSchemasText.includes(`name: '${option.toolName}'`)) {
              problems.push(`unknown-tool:${option.toolName}`);
            }
          }
          if (!recipe.boundaries?.advisoryOnly
            || recipe.boundaries?.grantsPermission !== false
            || recipe.boundaries?.executesTools !== false
            || recipe.boundaries?.advancesStage !== false
            || recipe.boundaries?.provesCompletion !== false) {
            problems.push('authority-boundary');
          }
          return problems.map((problem) => `${recipe.recipeId}:${problem}`);
        }),
        ...(mainImageR3CraftRecipes.includedItemIds.length === 0
          ? []
          : ['craft-recipe:r3-loaded-before-action-planning']),
        ...(mainImageR4CraftRecipes.includedItemIds.some((id) => id.includes('editable-single-canvas-composition'))
          ? []
          : ['craft-recipe:r4-not-loaded']),
        ...(mainImageR5CraftRecipes.includedItemIds.some((id) => id.includes('editable-single-canvas-composition'))
          ? []
          : ['craft-recipe:r5-not-loaded']),
        ...(skuBatchCraftRecipeItems.length === 0
          ? []
          : ['craft-recipe:single-canvas-leaked-to-sku-batch']),
        ...(generalPhotoshopCraftRecipes.length > 0
          && generalPhotoshopCraftRecipes.every((recipe) => (
            recipe.applicableTaskTypes.includes('design.generic.v1')
          ))
          ? []
          : ['craft-recipe:general-foundation-selection-invalid']),
        ...(['photoshop-craft.flattened-raster-text-replacement', 'photoshop-craft.subject-aware-image-placement']
          .filter((recipeId) => !ordinaryNaturalLanguageCraftRecipeItems.some((item) => (
            item.id.includes(recipeId)
            && String(item.content || '').includes('候选工艺')
            && String(item.content || '').includes('不是必须逐项调用的试探顺序')
            && String(item.content || '').includes('不为寻找方法重新搜索项目或参考')
          )))
          .map((recipeId) => `craft-recipe:ordinary-natural-language-run-missing-fast-path:${recipeId}`)),
        ...(ordinaryCraftPhrasingVariants.every((items) => (
          JSON.stringify(items.map((item) => item.id))
            === JSON.stringify(ordinaryNaturalLanguageCraftRecipeItems.map((item) => item.id))
        ))
          ? []
          : ['craft-recipe:ordinary-fallback-depends-on-user-phrasing']),
        ...(ordinaryNaturalLanguageCraftRecipeItems.every((item) => String(item.content || '').length <= 900)
          && ordinaryNaturalLanguageCraftRecipeItems.reduce((sum, item) => (
            sum + String(item.content || '').length
          ), 0) <= 2600
          ? []
          : ['craft-recipe:ordinary-fast-path-context-budget-exceeded']),
        ...(flattenedRasterTextRecipe
          && flattenedRasterTextRecipe.doNotUseWhen.some((rule) => (
            rule.includes('纹理') && rule.includes('选区能力') && rule.includes('needs_review')
          ))
          && ['getLayerHierarchy', 'getCanvasSnapshot', 'createRectangle', 'createTextLayer']
            .every((toolName) => flattenedRasterTextRecipe.toolOptions.some((option) => (
              option.toolName === toolName
            )))
          && flattenedRasterTextRecipe.doNotUseWhen.some((rule) => rule.includes('setTextContent'))
          ? []
          : ['craft-recipe:flattened-text-decision-boundary-incomplete']),
        ...(executorText.includes('buildPhotoshopCraftRecipeRuntimeItems')
          && executorText.includes('...photoshopCraftRecipeItems')
          ? []
          : ['executor:craft-recipe-not-handed-off']),
        ...(toolExecutorText.includes('knowledgeInjectedByRuntimeCompiler: true')
          && !toolExecutorText.includes('photoshopCraftRecipes: photoshopCraftRecipePayloads')
          ? []
          : ['declare-design-intent:craft-recipe-runtime-compiler-boundary-missing']),
        ...(designKnowledgeSearchText.includes('PHOTOSHOP_CRAFT_RECIPES')
          && designKnowledgeSearchText.includes('photoshopCraftRecipeToKnowledgeResult')
          ? []
          : ['knowledge-search:craft-recipe-not-indexed']),
        ...(photoshopCraftRecipeSearch.results.some((result) => (
          result.id.includes('photoshop-craft.editable-single-canvas-composition')
          && result.governance?.lifecycleStatus === 'active'
        ))
          ? []
          : ['knowledge-search:craft-recipe-not-retrievable-or-governed']),
        ...(['photoshop-craft.flattened-raster-text-replacement', 'photoshop-craft.subject-aware-image-placement']
          .filter((recipeId) => !photoshopCraftRecipes.some((recipe) => recipe.recipeId === recipeId))
          .map((recipeId) => `craft-recipe:required-generic-recipe-missing:${recipeId}`)),
        ...(localRasterTextRecipeSearch.results.some((result) => (
          result.id.includes('photoshop-craft.flattened-raster-text-replacement')
          && result.governance?.lifecycleStatus === 'active'
        ))
          ? []
          : ['knowledge-search:local-raster-text-recipe-not-retrievable-or-governed']),
        ...(subjectAwarePlacementRecipeSearch.results.some((result) => (
          result.id.includes('photoshop-craft.subject-aware-image-placement')
          && result.governance?.lifecycleStatus === 'active'
        ))
          ? []
          : ['knowledge-search:subject-aware-placement-recipe-not-retrievable-or-governed']),
        ...(mainImageCraftRecipeItems.every((item) => (
          String(item.content || '').includes('Photoshop Craft Recipe 索引')
          && String(item.content || '').includes('searchDesignKnowledge')
        ))
          ? []
          : ['craft-recipe:runtime-context-must-use-compact-on-demand-index']),
        ...(/class\s+\w*RecipeRegistry|RecipeRegistry\s*=/.test(photoshopCraftRecipesText)
          ? ['craft-recipe:parallel-registry-detected']
          : [])
      ]
    },
    {
      id: 'subject-aware-fit-has-semantic-anchor-and-write-readback-verdict',
      description: '主体适配的视觉占比与锚点必须由 Agent 或已选参考显式提供；Harness 只求解几何、读回结果并区分几何通过与明显偏移，不把几何裁决冒充审美通过。',
      violations: [
        ...(!subjectFitPlan.ok
          ? [`subject-fit:plan-blocked:${subjectFitPlan.reason}`]
          : []),
        ...(subjectFitPlan.ok && subjectFitPlan.resolved.anchor !== 'top-center'
          ? [`subject-fit:anchor-not-preserved:${subjectFitPlan.resolved.anchor}`]
          : []),
        ...(subjectFitVerification?.status === 'passed'
          ? []
          : [`subject-fit:expected-pass:${subjectFitVerification?.status || 'missing'}`]),
        ...(shiftedSubjectFitVerification?.status === 'failed'
          ? []
          : [`subject-fit:large-shift-not-failed:${shiftedSubjectFitVerification?.status || 'missing'}`]),
        ...(toolSchemasText.includes('主体视觉占比必须由 Agent 显式声明')
          && toolSchemasText.includes('anchor 必须由 Agent 根据本稿构图声明')
          && toolSchemasText.includes('返回写后 geometryVerification')
          && toolExecutorText.includes('【主体感知缩放与定位】')
          && toolExecutorText.includes('Harness 不再按品类套用内置占比')
          && toolExecutorText.includes('Harness 不替 Agent 选择视觉重心')
          ? []
          : ['subject-fit:tool-catalog-semantics-drifted'])
      ]
    },
    {
      id: 'delegated-reversible-choice-does-not-deadlock-delivery',
      description: '用户把尺寸等可逆选择委托给 Agent 时不得按缺输入处理；新建独立文档不能被未知角色锁死，且“无文档→新文档”的真实读回必须可验收。',
      violations: [
        ...delegatedCreateDocumentViolations,
        ...(promptText.includes('随意、你决定、看着办、按常用规格、合适就行')
          && promptText.includes('不因审美选择可撤回而停工')
          ? []
          : ['autonomy:delegated-reversible-choice-principle-missing']),
        ...(!designDocumentRoleText.includes("context.currentDocumentUse === 'observe_only' && context.targetRole === 'unknown'")
          ? []
          : ['create-document:static-unknown-role-deadlock-restored']),
        ...(createDocumentAcceptance.verified === true
          && createDocumentAcceptance.assertionStatus === 'passed'
          && createDocumentAcceptance.diff?.comparable === true
          ? []
          : [`create-document:valid-empty-to-document-readback-rejected:${JSON.stringify(createDocumentAcceptance)}`]),
        ...(mismatchedCreateDocumentAcceptance.verified === false
          && mismatchedCreateDocumentAcceptance.assertionStatus === 'failed'
          ? []
          : ['create-document:metadata-mismatch-not-rejected']),
        ...(toolAcceptanceText.includes('allowNoDocumentBefore: documentCreatedFromEmptyState')
          && toolAcceptanceText.includes("id: 'create-document-metadata'")
          ? []
          : ['create-document:acceptance-contract-incomplete']),
        ...(agentRuntimeText.includes('private hasAttemptedTaskDeliveryAction(): boolean')
          && agentRuntimeText.includes('const hasAttemptedDeliveryAction = this.hasAttemptedTaskDeliveryAction();')
          && agentRuntimeText.includes('|| hasAttemptedDeliveryAction')
          && agentRuntimeText.includes("return hasSuccessfulDeliveryAction ? undefined : 'delivery_action_missing'")
          ? []
          : ['completion:failed-delivery-attempt-can-still-be-completed']),
        ...(repeatedPolicyGateVerdict?.count === POLICY_GATE_REPEAT_BLOCK_LIMIT
          && repeatedPolicyGateVerdict?.toolName === 'createDocument'
          && hitlPolicyGateSignature === null
          ? []
          : ['policy-gate:repeat-deadlock-or-hitl-accounting-invalid']),
        ...(agentRuntimeText.includes('recordPolicyGateBlockRound(')
          && agentRuntimeText.includes('private policyGateRepeatState: PolicyGateRepeatState')
          && agentRuntimeText.includes('result: result.output')
          && agentRuntimeText.includes('!isPolicyGateResult(result.output)')
          && policyGateRepeatGuardText.includes('这是系统门禁路径问题，不代表你的需求描述错误')
          && !policyGateRepeatGuardText.includes('TODO(human)')
          ? []
          : ['policy-gate:repeat-guard-not-wired-or-incomplete']),
        // 账本覆盖面：漏标 policyGate 的门禁必须照样上账（结构识别），
        // 普通工具失败必须照样不上账（避免误停正当重试）。
        ...(typeof unmarkedGateSignature === 'string'
          && unmarkedGateSignature.includes('runtime_task_run_revision_reobserve_required')
          && typeof disciplineGateSignature === 'string'
          && ordinaryFailureSignature === null
          && policyGateRepeatGuardText.includes('export function isLedgerAccountableGate')
          ? []
          : ['policy-gate:unmarked-gate-escapes-repeat-ledger']),
        // 声明表单驳回必须上账：同一表单被连续驳回到上限就是模型看不懂表单要求，不能无限盲试。
        ...(typeof declarationRejectionSignature === 'string'
          && declarationRejectionSignature.includes('runtime_design_brief_declaration_invalid')
          ? []
          : ['policy-gate:declaration-rejection-escapes-repeat-ledger'])
      ]
    },
    {
      id: 'model-provider-failure-provenance-and-real-settings-test',
      description: 'Provider 失败必须由真实请求边界归因；403 不得默认成 Key 失效；设置页必须真实验证 Key 与当前模型访问权；Run Record 只保存脱敏摘要。',
      violations: [
        ...(modelProviderFailureText.includes("| 'model_access'")
          && modelProviderFailureText.includes("| 'protocol'")
          ? []
          : ['provider-failure:failure-kinds-incomplete']),
        ...(modelProviderFailureText.includes("if (status === 403) {")
          && modelProviderFailureText.includes("return buildFailure('model_access'")
          && !modelProviderFailureText.includes('status === 401 || status === 403')
          ? []
          : ['provider-failure:403-still-collapsed-into-auth']),
        ...(subscriptionUsageLimitFailure.kind === 'billing'
          && subscriptionUsageLimitFailure.basis === 'code'
          && conversationalUnavailableMessageText.includes('订阅用量或重置时间')
          ? []
          : ['provider-failure:subscription-usage-limit-not-classified-or-explained']),
        ...(subscriptionInvalidToolJsonFailure.kind === 'protocol'
          && subscriptionInvalidToolJsonFailure.basis === 'code'
          ? []
          : ['provider-failure:subscription-invalid-tool-json-not-classified-as-protocol']),
        ...(conversationalUnavailableMessageText.includes("kind === 'model_access'")
          && conversationalUnavailableMessageText.includes('API Key 不一定有问题')
          ? []
          : ['provider-failure:model-access-user-guidance-missing']),
        ...(chatPanelText.includes('纯字符串是模型正文')
          && !chatPanelText.includes('looksLikeProviderFailureText(payload.text')
          && !chatPanelText.includes('const text = compactModelFailureText(payload.text')
          ? []
          : ['provider-failure:normal-model-text-can-be-reclassified']),
        ...(modelServiceText.includes('async testOllamaCloud(')
          && modelServiceText.includes("`${OLLAMA_CLOUD_BASE_URL}/api/chat`")
          && modelServiceText.includes('createModelProviderHttpError(')
          && modelServiceText.includes('请先在主模型或视觉模型中选择一个 Ollama Cloud 模型')
          && !modelServiceText.includes("`${OLLAMA_CLOUD_BASE_URL}/api/tags`")
          ? []
          : ['ollama-cloud:real-key-and-model-test-missing']),
        ...(websocketHandlersText.includes("ipcMain.handle('model:testOllamaCloud'")
          && preloadText.includes("ipcRenderer.invoke('model:testOllamaCloud'")
          && rendererTypesText.includes('testOllamaCloud?:')
          && settingsModalText.includes('designEcho.testOllamaCloud(apiKey, selectedOllamaCloudModelId)')
          ? []
          : ['ollama-cloud:settings-test-bridge-incomplete']),
        ...(!settingsModalText.includes('testOllamaCloudApi')
          ? []
          : ['ollama-cloud:fake-local-test-still-present']),
        ...(agentRunRecordText.includes('providerFailureDigestOnly?: true')
          && agentRunRecordText.includes('sanitizeModelProviderDiagnostic')
          && agentRunRecordText.includes('model-provider-failure-digest/v0')
          && executorText.includes('modelProviderFailureDigest: {')
          ? []
          : ['provider-failure:run-record-provenance-missing']),
        ...(classifiedSubscriptionIdleTimeout.kind === 'timeout'
          && classifiedSubscriptionIdleTimeout.basis === 'code'
          && classifiedSubscriptionIdleTimeout.providerCode === 'codex_subscription_turn_idle_timeout'
          && classifiedSubscriptionWallTimeout.kind === 'timeout'
          && classifiedSubscriptionWallTimeout.basis === 'code'
          && isHarnessManagedSubscriptionTimeout(classifiedSubscriptionIdleTimeout) === true
          && isHarnessManagedSubscriptionTimeout(classifiedSubscriptionWallTimeout) === true
          && retrySubscriptionIdleTimeout === true
          && retrySubscriptionWallTimeout === false
          && retryAfterVisiblePayload === false
          && modelServiceText.includes('buildAgentToolStreamErrorChunk(error)')
          && modelServiceText.includes('errorCode: failure.providerCode')
          && agentToolStreamServiceText.includes('restoreAgentToolStreamError(data.chunk)')
          && executorText.includes('shouldRetryAutonomousModelTransport({')
          ? []
          : ['provider-failure:structured-stream-identity-or-bounded-retry-invalid']),
        ...(freshCodexProgress.expired === false
          && freshCodexProgress.remainingMs === 1
          && expiredCodexProgress.expired === true
          && expiredCodexProgress.elapsedMs === 180_000
          && codexTurnProgressText.includes('调用方必须在接受一个新进展事件之前先评价旧空窗')
          && codexSubscriptionServiceText.includes(
            'const accepted = this.refreshActiveTurnIdleDeadline(active, notification.method);'
          )
          && codexSubscriptionServiceText.includes('if (!accepted) return;')
          && codexSubscriptionServiceText.includes('this.scheduleActiveTurnIdleCheck(active);')
          ? []
          : ['provider-failure:idle-watchdog-can-be-erased-by-late-progress']),
        ...(oldTurnOwnedBeforeReplacement === true
          && lateOldTurnCallbackPreservedNewTurn === true
          && matchingTurnNotificationAccepted === true
          && staleTurnNotificationRejected === false
          && codexSubscriptionServiceText.includes(
            'if (!ownsCodexTurnSlot(this.activeTurns, active)) return;'
          )
          && codexSubscriptionServiceText.includes(
            'if (!ownsCodexTurnSlot(this.activeImageTurns, active)) return;'
          )
          && !codexSubscriptionServiceText.includes(
            'if (!this.activeTurns.has(active.threadId)) return;'
          )
          && codexSubscriptionServiceText.includes(
            'codexNotificationMatchesActiveTurn({'
          )
          ? []
          : ['provider-failure:late-old-turn-callback-can-affect-reused-thread-slot']),
        ...(codexSubscriptionServiceText.includes(
          "if (!this.settleActiveTurnIdleDeadline(active)) return;"
        )
          && codexSubscriptionServiceText.includes(
            "'codex_subscription_turn_idle_timeout'"
          )
          && codexSubscriptionServiceText.includes(
            'notification.method === \'turn/completed\''
          )
          ? []
          : ['provider-failure:terminal-event-bypasses-strict-idle-deadline']),
        ...(agentRuntimeText.includes('outcome: response')
          && activeRuntimeAccountingText.includes('const candidateAttempts = (input.outcome as {')
          && activeRuntimeAccountingText.includes('currentSession = this.recordRecoveryAttempt(currentSession);')
          && executorText.includes('transportAttempts.push(buildModelTransportAttempt(')
          && executorText.includes('throw attachModelTransportAttempts(wrappedError, transportAttempts)')
          && transportAttemptAccountingDigest?.modelCallCount === 2
          && transportAttemptAccountingDigest?.modelFailureCount === 1
          && transportAttemptAccountingDigest?.modelDurationMs === 192_000
          && transportAttemptAccountingDigest?.inputTokens === 40_000
          && transportAttemptAccountingDigest?.outputTokens === 600
          && transportAttemptAccountingDigest?.unreportedUsageCallCount === 1
          && transportAttemptAccountingDigest?.recoveryAttemptCount === 1
          && transportAttemptAccountingDigest?.modelFailureSamples?.length === 1
          && transportAttemptAccountingDigest?.modelFailureSamples?.[0]?.failureKind === 'timeout'
          && transportAttemptAccountingDigest?.modelFailureSamples?.[0]?.providerCode
            === 'codex_subscription_turn_idle_timeout'
          && transportAttemptAccountingDigest?.modelFailureSamples?.[0]?.status === 504
          && !transportAttemptAccountingJson.includes('不得进入账本')
          && !transportAttemptAccountingJson.includes('diagnostic')
          && !transportAttemptAccountingJson.includes('stack')
          && transportAttemptAccountingValidation.ok === true
          && pollutedTransportAttemptAccountingValidation.ok === false
          && runtimeAccountingText.includes('MAX_MODEL_FAILURE_SAMPLES = 32')
          && executorText.includes('failureKind: failure.kind')
          ? []
          : ['provider-failure:transport-retry-not-accounted']),
        ...(executorText.includes('executionSummary: failureExecutionSummary')
          && conversationalUnavailableMessageText.includes('服务当前繁忙或暂时不可用')
          ? []
          : ['provider-failure:truthful-conversation-summary-missing'])
      ]
    },
    {
      id: 'asset-auto-placement-requires-visual-role-and-direct-use-evidence',
      description: '自动选图只能消费已视觉观察、角色明确且可直接使用的候选；需去底重组、候选接近或来源不明时不得静默写入 Photoshop。',
      violations: [
        ...(strongDirectPlacementDecision.eligible === true
          && strongDirectPlacementDecision.code === 'ready'
          ? []
          : [`asset-placement:strong-direct-evidence-rejected:${JSON.stringify(strongDirectPlacementDecision)}`]),
        ...(unobservedPlacementDecision.eligible === false
          && unobservedPlacementDecision.code === 'visual_selection_evidence_required'
          ? []
          : [`asset-placement:metadata-only-candidate-auto-placed:${JSON.stringify(unobservedPlacementDecision)}`]),
        ...(recompositionPlacementDecision.eligible === false
          && recompositionPlacementDecision.code === 'candidate_requires_recomposition'
          ? []
          : [`asset-placement:matting-requirement-bypassed:${JSON.stringify(recompositionPlacementDecision)}`]),
        ...(ambiguousPlacementDecision.eligible === false
          && ambiguousPlacementDecision.code === 'candidate_margin_below_threshold'
          ? []
          : [`asset-placement:ambiguous-top1-auto-placed:${JSON.stringify(ambiguousPlacementDecision)}`]),
        ...(unprovenForcePlacementDecision.eligible === true
          && unprovenForcePlacementDecision.code === 'ready'
          && unprovenForcePlacementDecision.authority === 'agent_judgment'
          ? []
          : [`asset-placement:unreceipted-force-did-not-use-normal-visual-boundary:${JSON.stringify(unprovenForcePlacementDecision)}`]),
        ...(userDirectedForcePlacementDecision.eligible === true
          && userDirectedForcePlacementDecision.code === 'ready'
          && userDirectedForcePlacementDecision.authority === 'agent_judgment'
          ? []
          : [`asset-placement:model-authored-user-claim-gained-authority:${JSON.stringify(userDirectedForcePlacementDecision)}`]),
        ...(forgedForcePlacementDecision.eligible === false
          && forgedForcePlacementDecision.code === 'visual_selection_evidence_required'
          && forgedForcePlacementDecision.authority === 'agent_judgment'
          ? []
          : [`asset-placement:forged-force-bypassed-visual-check:${JSON.stringify(forgedForcePlacementDecision)}`]),
        ...(harnessReceiptForcePlacementDecision.eligible === true
          && harnessReceiptForcePlacementDecision.authority === 'harness_receipt'
          ? []
          : [`asset-placement:harness-receipt-not-distinguished:${JSON.stringify(harnessReceiptForcePlacementDecision)}`]),
        ...(!toolExecutorText.includes('product hero image white background')
          ? []
          : ['asset-placement:hidden-white-background-default-restored']),
        ...(toolExecutorText.includes('function resolveExplicitPlaceImageSource')
          && toolExecutorText.includes('params?.imageData || params?.filePath || params?.fileToken')
          && toolExecutorText.includes('__placeImageSourceBlocked: true')
          && toolExecutorText.includes("nextTool: 'recommendAssets'")
          && toolSchemasText.includes('This execution tool never scans, ranks, or chooses project assets')
          && !toolSchemasText.includes("autoSelect: { type: 'boolean', description: 'true 时按 requirement/designRole 自动匹配候选置入")
          && !toolExecutorText.includes('autoResolvePlaceImageSource')
          && !toolExecutorText.includes('filePath: topCandidate.path')
          ? []
          : ['asset-placement:place-image-still-selects-a-candidate-inside-the-execution-tool']),
        ...(!toolSchemasText.includes('selectionDecisionSource:')
          && designPlacementIntelligenceText.includes("authority: 'harness'")
          && designPlacementIntelligenceText.includes("? 'agent_judgment'")
          ? []
          : ['asset-placement:model-force-provenance-still-self-authorizing']),
        ...(composeDesignExecutorText.includes("version: 'compose-design-source-audit/v1'")
          && composeDesignExecutorText.includes("projectAffinity === 'outside_current_project'")
          && composeDesignExecutorText.includes('temporaryStoragePath:')
          ? []
          : ['asset-placement:compose-design-source-affinity-audit-missing'])
      ]
    },
    {
      id: 'project-visual-cache-requires-fresh-current-asset-version',
      description: '详情页视觉信号只能消费未过期且与当前素材版本一致的缓存；缓存缺失或 mtime 变化时使用一次候选联系表补看，不回退为逐图多次分析。',
      violations: [
        ...(cacheStatusForEntry(expiredVisualCacheEntry, visualCacheNowMs) === 'stale'
          ? []
          : ['visual-cache:expired-entry-reported-as-hit']),
        ...(projectVisualCacheEntryMatchesCurrentAsset({
          entry: currentVisualCacheEntry,
          assetVersion: currentVisualAssetVersion,
          nowMs: visualCacheNowMs
        }) === true
          ? []
          : ['visual-cache:current-version-rejected']),
        ...(projectVisualCacheEntryMatchesCurrentAsset({
          entry: currentVisualCacheEntry,
          assetVersion: changedVisualAssetVersion,
          nowMs: visualCacheNowMs
        }) === false
          ? []
          : ['visual-cache:changed-source-version-reused']),
        ...(projectVisualCacheEntryMatchesCurrentAsset({
          entry: expiredVisualCacheEntry,
          assetVersion: currentVisualAssetVersion,
          nowMs: visualCacheNowMs
        }) === false
          ? []
          : ['visual-cache:expired-current-version-reused']),
        ...(projectVisualCacheEntryMatchesCurrentAsset({
          entry: { ...currentVisualCacheEntry, assetVersion: { sizeBytes: 2048 } },
          assetVersion: { sizeBytes: 2048 },
          nowMs: visualCacheNowMs
        }) === false
          ? []
          : ['visual-cache:size-only-identity-treated-as-current']),
        ...(visualCacheKeyBeforeEdit !== visualCacheKeyAfterEdit
          ? []
          : ['visual-cache:mtime-does-not-change-cache-key']),
        ...(toolExecutorText.includes('projectVisualCacheEntryMatchesCurrentAsset({')
          && toolExecutorText.includes('buildDetailPageVisionSignalIndex(projectPath, projectAssets.images)')
          && visualSamplingText.includes('Boolean(assetVersion?.modifiedTimeMs)')
          ? []
          : ['visual-cache:detail-index-not-version-aware']),
        ...(toolExecutorText.includes('detailPageContactSheetObservationByInventory = new WeakMap')
          && toolExecutorText.includes('observeDetailPageCandidatesWithContactSheet({')
          && toolExecutorText.includes('candidateFiles: unresolved.map((image) => ({')
          && resourceManagerServiceText.includes('providedCandidates.length > 0 ? undefined : await this.scanDirectory()')
          ? []
          : ['visual-cache:cold-start-does-not-use-one-reused-contact-sheet'])
      ]
    },
    {
      id: 'detail-page-asset-usage-is-role-aware-recomposition-safe-and-scan-bounded',
      description: '详情页 Ranker 必须区分场景直用、白底去底重组、细节辅图、设计成品与未观察候选；前置素材库存必须复用，避免同一规划阶段再次扫描项目。',
      violations: [
        ...(whiteStudioHeroDecision.automaticPlacementEligible === false
          && whiteStudioHeroDecision.sourceTreatment === 'matte_and_recompose'
          ? []
          : [`detail-asset:white-studio-directly-promoted:${JSON.stringify(whiteStudioHeroDecision)}`]),
        ...(sceneHeroDecision.automaticPlacementEligible === true
          && sceneHeroDecision.sourceTreatment === 'clip_to_container'
          ? []
          : [`detail-asset:scene-hero-not-executable:${JSON.stringify(sceneHeroDecision)}`]),
        ...(detailOnlyHeroDecision.automaticPlacementEligible === false
          && detailOnlyHeroDecision.sourceTreatment === 'supporting_only'
          ? []
          : [`detail-asset:detail-closeup-promoted-to-hero:${JSON.stringify(detailOnlyHeroDecision)}`]),
        ...(finishedDesignHeroDecision.automaticPlacementEligible === false
          && finishedDesignHeroDecision.sourceTreatment === 'reject'
          ? []
          : [`detail-asset:finished-design-reused-as-raw-source:${JSON.stringify(finishedDesignHeroDecision)}`]),
        ...(unobservedHeroDecision.automaticPlacementEligible === false
          && unobservedHeroDecision.sourceTreatment === 'requires_visual_review'
          ? []
          : [`detail-asset:metadata-only-candidate-executed:${JSON.stringify(unobservedHeroDecision)}`]),
        ...(whiteStudioComparisonDecision.automaticPlacementEligible === true
          && whiteStudioComparisonDecision.sourceTreatment === 'clip_to_container'
          ? []
          : [`detail-asset:non-hero-white-product-card-forced-to-matting:${JSON.stringify(whiteStudioComparisonDecision)}`]),
        ...(whiteStudioUndecidedSupportingDecision.automaticPlacementEligible === false
          && whiteStudioUndecidedSupportingDecision.sourceTreatment === 'requires_visual_review'
          ? []
          : [`detail-asset:white-background-fact-became-unconditional-treatment:${JSON.stringify(whiteStudioUndecidedSupportingDecision)}`]),
        ...(missingScreenDecision.automaticPlacementEligible === false
          && missingScreenDecision.sourceTreatment === 'requires_visual_review'
          ? []
          : [`detail-asset:missing-screen-role-auto-executed:${JSON.stringify(missingScreenDecision)}`]),
        ...(unresolvedScreenDecision.automaticPlacementEligible === false
          && unresolvedScreenDecision.sourceTreatment === 'requires_visual_review'
          ? []
          : [`detail-asset:unresolved-screen-role-auto-executed:${JSON.stringify(unresolvedScreenDecision)}`]),
        ...(detailPageAssetRankerText.includes('buildDetailAssetCandidateSet(')
          && detailPageAssetRankerText.includes('findExplicitDetailAssetSelection(')
          && detailPageAssetRankerText.includes("assetSelectionSource: images.some((image) => image.requiresModelAssetDecision === true)")
          && detailPageAssetRankerText.includes('排序第一名不是生产选定')
          && detailPageExecutorText.includes('buildDetailAssetSelectionHandoffResult({')
          && toolExecutorText.includes("code: 'detail_asset_selection_receipt_required'")
          && !detailPageAssetRankerText.includes("needsMatting: assetType === 'product'")
          ? []
          : ['detail-asset:ranker-usage-contract-incomplete']),
        ...(detailPageExecutorText.includes('preScannedProjectAssets = buildDetailProjectAssetsFromAnalysis(assetAnalysis)')
          && detailPageExecutorText.includes('readTrustedDetailPageProjectAssetsFromAnalysis(result)')
          && detailPageDesignSkillText.includes('projectAssets,')
          && detailPageExecutorText.includes('projectAssets: preScannedProjectAssets')
          && toolExecutorText.includes('trustedDetailPageProjectAssetReceipt')
          && toolExecutorText.includes('isTrustedDetailPageProjectAssets(params.projectAssets, projectPath)')
          && toolExecutorText.includes('忽略没有 Harness 身份 receipt 的 projectAssets')
          && toolExecutorText.includes('registerTrustedDetailPageProjectAssets(projectAssets, projectPath)')
          && toolExecutorText.includes('复用带 Harness 身份 receipt 的前置素材库存')
          && !toolExecutorText.includes('designEcho.getResourceSummary?.(projectDir)')
          && resourceManagerServiceText.includes('categorizeResourceFiles(scanResult.files)')
          && !resourceManagerServiceText.includes('const categories = await this.getResourcesByCategory(directory)')
          ? []
          : ['detail-asset:pre-scanned-inventory-not-reused'])
      ]
    },
    {
      id: 'parent-workflow-preserves-manifest-owned-child-entry',
      description: '整套袜品父 workflow 只下发 Manifest-owned 子 Runtime，不直调 legacy 主图/详情页/SKU executor；占位主视觉不得通过布局质量门。',
      violations: [
        ...manifestOwnedChildDispatchViolations,
        ...(toolExecutorText.includes("code: 'main_image_placeholder_unresolved'")
          && toolExecutorText.includes("placeholder: true")
          && toolExecutorText.includes("sourceKind: 'placeholder'")
          && toolExecutorText.includes("toolName: 'replaceImagePlaceholder'")
          && toolExecutorText.includes('params: { placeholderLayerId }')
          && toolExecutorText.includes("closureKind: placeholderLayerId ? 'mutation' : 'replan'")
          ? []
          : ['main-image-layout:placeholder-repair-lacks-exact-replacement-evidence']),
        ...(taskCompletionContractPath
          && read(taskCompletionContractPath).includes('collectLatestRenderLayoutQualityState')
          && read(taskCompletionContractPath).includes('unresolvedFindingCount')
          ? []
          : ['main-image-layout:structured-repair-finding-not-consumed-by-completion'])
      ]
    },
    {
      id: 'model-owns-visual-style-while-harness-owns-layout-safety',
      description: '模型声明品类中立的视觉样式与方向，Harness 只验证范围、可读性和几何；中性线框不得冒充正式设计。',
      violations: modelOwnedVisualStyleViolations
    },
    {
      id: 'photoshop-modal-recovery-is-observable-and-agent-owned',
      description: 'Harness 结构化报告 Photoshop 原生弹窗嫌疑并提供整窗观察；Agent 看真实窗口后决定恢复，写状态未知时不得盲目重试。',
      violations: environmentRecoveryViolations
    },
    {
      id: 'jpeg-export-redirect-preserves-public-tool-defaults',
      description: 'Renderer 跨 saveDocument / quickExport 重定向时，JPEG 默认值仍由用户调用的公开工具拥有；内部传输工具不得改写默认质量。',
      violations: jpegRedirectSemanticsViolations
    },
    {
      id: 'autonomous-design-loop-refreshes-governed-context-and-reviews-complete-visual-sets',
      description: '自主设计运行按 generation 刷新 Project State/已审核记忆；终审消费同版本完整 ReviewSet，团队执行完成不冒充质量通过。',
      violations: autonomousDesignLoopViolations
    },
    {
      id: 'sku-full-production-repairs-prerequisites-after-real-inventory-check',
      description: 'SKU full 仅由结构化阶段开启缺源/缺模板修复；执行器先查项目 PSD/PSB，确认缺失后才准备，inspect 与显式禁用保持 fail-closed。',
      violations: skuPrerequisiteRepairViolations
    },
    {
      id: 'debug-live-case-preflight-is-redacted-and-write-state-is-structured',
      description: '正式 Debug Case 在 armed 前核对 Renderer 当前模型、Provider 与项目；只暴露脱敏身份，并按结构化 stage/writePossible 区分安全拒绝与未知写状态。',
      violations: debugBridgePreflightSafetyViolations
    },
    {
      id: 'transitional-business-coupling-ratchet',
      description: '尚未迁出的 Agent 核心业务字面量只许减少不得增长，逐步迁往 Manifest/Provider。',
      violations: transitionalDebt
        .filter((item) => item.status === 'grown')
        .map((item) => `${item.file}:${item.businessReferenceCount}>${item.baseline}`)
    }
  ];

  const violationCount = checks.reduce((sum, check) => sum + check.violations.length, 0);
  const payload = {
    success: violationCount === 0,
    boundary: {
      agent: '理解目标、选择 Skill、编排、执行、观察、恢复与应用全局安全上限。',
      skill: '业务方法、阶段、输入输出、预算画像、最低验收与专业评价。',
      tool: 'Photoshop 原子读写动作；不决定业务工作流。',
      authorization: '只来自控制面或显式批准记录；参数默认器不得生成。'
    },
    registeredManifestCount: manifests.length,
    violationCount,
    checks,
    transitionalDebt
  };
  const outputDirectory = path.join(root, 'tmp');
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(outputDirectory, 'agent-business-boundaries-audit.json'),
    `${JSON.stringify(payload, null, 2)}\n`,
    'utf8'
  );
  console.log(JSON.stringify(payload, null, 2));
  process.exit(payload.success ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
