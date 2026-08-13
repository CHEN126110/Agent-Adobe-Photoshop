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
const path = require('path');
const ts = require('typescript');
const {
  auditSkuPrerequisiteRepairBehavior
} = require('./lib/sku-prerequisite-repair-audit.cjs');

const root = path.resolve(__dirname, '..');
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
const manifestSchemaPath = path.join(root, 'schemas', 'skill-runtime-manifest.schema.json');
const runtimeBundlePath = path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-contract-bundle.ts');
const runtimeStagePlanPath = path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-stage-plan.ts');
const runtimeDesignBriefPath = path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-design-brief-declaration.ts');
const runtimeScopedChangeRecordsPath = path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-scoped-change-records.ts');
const scopedEditRuntimePolicyPath = path.join(root, 'src', 'shared', 'agent-runtime-v5', 'scoped-edit-runtime-policy.ts');
const runtimeMethodKnowledgePath = path.join(root, 'src', 'shared', 'agent-runtime-v5', 'design-method-knowledge.ts');
const runtimeContextCompilerPath = path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-context-compiler.ts');
const runtimeStageStatePath = path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-stage-state.ts');
const runtimeSessionPath = path.join(root, 'src', 'shared', 'agent-runtime-v5', 'runtime-session.ts');
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
const subjectFitPath = path.join(root, 'src', 'shared', 'subject-fit.ts');
const toolExecutorPath = path.join(root, 'src', 'renderer', 'services', 'tool-executor.service.ts');
const executorPath = path.join(root, 'src', 'renderer', 'services', 'skill-executors', 'autonomous-agent.executor.ts');
const projectImageAnalysisExecutorPath = path.join(
  root,
  'src',
  'renderer',
  'services',
  'skill-executors',
  'project-image-analysis.executor.ts'
);
const agentRuntimePath = path.join(root, 'src', 'renderer', 'services', 'agent-runtime', 'agent.ts');
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
const taskCompletionContractPath = path.join(root, 'src', 'renderer', 'services', 'agent-runtime', 'task-completion-contract.ts');
const agentOperationLedgerPath = path.join(root, 'src', 'shared', 'agent-operation-ledger.ts');
const designTaskPolicyPath = path.join(root, 'src', 'renderer', 'services', 'agent-policies', 'design-task-policy.ts');
const designQualityVerdictPath = path.join(root, 'src', 'shared', 'design-quality-verdict-bundle.ts');
const designQualityAssertionPath = path.join(root, 'src', 'shared', 'design-quality-assertion.ts');
const reflexionReentryPolicyPath = path.join(root, 'src', 'shared', 'reflexion-reentry-policy.ts');
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
const skillToolsPath = path.join(root, 'src', 'renderer', 'services', 'skill-executors', 'skill-tools.ts');
const skuExportReadbackPath = path.join(root, 'src', 'shared', 'sku-export-readback.ts');
const skuDeliverySummaryPath = path.join(root, 'src', 'shared', 'sku-delivery-summary.ts');
const agentDiagnosticRecordPath = path.join(root, 'src', 'shared', 'agent-diagnostic-record.ts');
const skuHumanReviewPath = path.join(root, 'src', 'shared', 'sku-human-review.ts');
const skuColorCardExecutorPath = path.join(root, 'src', 'renderer', 'services', 'skill-executors', 'sku-color-card.executor.ts');
const detailPageExecutorPath = path.join(root, 'src', 'renderer', 'services', 'skill-executors', 'detail-page.executor.ts');
const detailPageAgentIntakePath = path.join(root, 'src', 'shared', 'detail-page-agent-intake.ts');
const detailPageAssetRankerPath = path.join(root, 'src', 'renderer', 'services', 'skill-executors', 'detail-page-asset-ranker.ts');
const detailPageDesignSkillPath = path.join(root, 'src', 'renderer', 'services', 'design-skills', 'detail-page-design.skill.ts');
const skillExecutorIndexPath = path.join(root, 'src', 'renderer', 'services', 'skill-executors', 'index.ts');
const skuColorCardContractPath = path.join(root, 'src', 'shared', 'sku-color-card-skill.ts');
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
const enginePath = path.join(root, 'src', 'renderer', 'services', 'design-agent', 'engine.ts');
const agentToolExecutionPreflightPath = path.join(root, 'src', 'shared', 'agent-tool-execution-preflight.ts');
const agentSkillAtomicToolExecutionPath = path.join(root, 'src', 'shared', 'agent-skill-atomic-tool-execution.ts');
const agentProviderTruncationRecoveryPath = path.join(root, 'src', 'shared', 'agent-provider-truncation-recovery.ts');
const agentToolFailureDiagnosticPath = path.join(root, 'src', 'shared', 'agent-tool-failure-diagnostic.ts');
const agentToolDecisionContractPath = path.join(root, 'src', 'shared', 'agent-tool-decision-contract.ts');
const documentOptionalToolsPath = path.join(root, 'src', 'shared', 'document-optional-tools.ts');
const routingPath = path.join(root, 'src', 'renderer', 'services', 'agent-orchestration', 'routing.ts');
const modelProviderFailurePath = path.join(root, 'src', 'shared', 'model-provider-failure.ts');
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
const chatComposerContentPath = path.join(root, 'src', 'shared', 'chat-composer-content.ts');
const eagleComposerTransferPath = path.join(root, 'src', 'shared', 'eagle-composer-transfer.ts');
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
const resourceManagerServicePath = path.join(root, 'src', 'main', 'services', 'resource-manager-service.ts');
const templateKnowledgeServicePath = path.join(root, 'src', 'main', 'services', 'template-knowledge.service.ts');
const preloadPath = path.join(root, 'src', 'main', 'preload.ts');
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

function run() {
  const performanceText = read(performancePolicyPath);
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
  const capabilitySessionText = read(capabilitySessionPath);
  const designEvaluationProfilesText = read(designEvaluationProfilesPath);
  const agentRuntimeSource = parse(agentRuntimePath);
  const agentRuntimeTypesText = read(agentRuntimeTypesPath);
  const runtimeBundleText = read(runtimeBundlePath);
  const runtimeStagePlanText = read(runtimeStagePlanPath);
  const runtimeDesignBriefText = read(runtimeDesignBriefPath);
  const runtimeSessionText = read(runtimeSessionPath);
  const runtimeStageStateText = read(runtimeStageStatePath);
  const agentRuntimeLivenessPolicyText = read(agentRuntimeLivenessPolicyPath);
  const agentReadResultCacheText = read(agentReadResultCachePath);
  const runtimeScopedChangeRecordsText = read(runtimeScopedChangeRecordsPath);
  const runtimeMethodKnowledgeText = read(runtimeMethodKnowledgePath);
  const taskProfileText = read(taskProfilePath);
  const artifactKnowledgeText = read(artifactKnowledgePath);
  const photoshopCraftRecipesText = read(photoshopCraftRecipesPath);
  const designKnowledgeSearchText = read(designKnowledgeSearchPath);
  const toolExecutorText = read(toolExecutorPath);
  const projectImageAnalysisExecutorText = read(projectImageAnalysisExecutorPath);
  const skuConfigExecutorText = read(skuConfigExecutorPath);
  const skuBatchExecutorText = read(skuBatchExecutorPath);
  const skillToolsText = read(skillToolsPath);
  const skuDeliverySummaryText = read(skuDeliverySummaryPath);
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
    buildDeterministicCompactE1WorkflowOwnerCall,
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
  const designDocumentRoleText = read(designDocumentRolePath);
  const toolAcceptanceText = read(toolAcceptancePath);
  const policyGateRepeatGuardText = read(policyGateRepeatGuardPath);
  const conversationalUnavailableMessageText = read(conversationalUnavailableMessagePath);
  const agentRunRecordText = read(agentRunRecordPath);
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
    || templateContinuationUpdate.scope.purpose !== 'repair'
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
    || executeSkuLayoutAccess.allowed
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
  if (templateHandoff.agentReActContinuation.recovery?.purpose !== 'repair'
    || templateHandoff.message.includes('模板方向已确认')
    || !templateRepairHandoff.message.includes('占位结构需要修复')
    || !templateRepairHandoff.templateDesignToolNames.includes('skuLayout')
    || !templateRepairHandoff.templateDesignToolNames.includes('transformLayer')
    || !templateRepairHandoff.completionChecklist.some((item) => item.includes('重新 inspect'))) {
    skuAutonomousTemplateViolations.push('sku-template:handoff-still-claims-user-confirmation-or-observation-only');
  }
  const compactE1WorkflowOwnerViolations = [];
  const compactE1WorkflowOwnerInput = {
    currentStage: 'E1',
    runtimeStages: ['R0', 'R2', 'E1', 'R5'],
    workflowEntryTools: ['sku-batch'],
    visibleAllowedToolNames: ['sku-batch', 'getDocumentInfo'],
    attemptedToolNames: [],
    writeAuthorized: true,
    hasActiveContinuation: false,
    hasActionResult: false
  };
  const compactE1WorkflowOwnerCall = buildDeterministicCompactE1WorkflowOwnerCall(
    compactE1WorkflowOwnerInput
  );
  if (compactE1WorkflowOwnerCall?.name !== 'sku-batch'
    || Object.keys(compactE1WorkflowOwnerCall.arguments || {}).length !== 0) {
    compactE1WorkflowOwnerViolations.push('compact-e1-workflow-owner:sole-authorized-owner-not-selected');
  }
  const soleVisibleOwnerFromMultipleDeclared = buildDeterministicCompactE1WorkflowOwnerCall({
    ...compactE1WorkflowOwnerInput,
    workflowEntryTools: ['sku-batch', 'detail-page-design'],
    visibleAllowedToolNames: ['sku-batch']
  });
  if (soleVisibleOwnerFromMultipleDeclared?.name !== 'sku-batch') {
    compactE1WorkflowOwnerViolations.push('compact-e1-workflow-owner:current-visible-intersection-not-used');
  }
  const compactE1BlockedCases = [
    ['wrong-stage', { currentStage: 'R2' }],
    ['creative-r4', { runtimeStages: ['R0', 'R1', 'R3', 'R4', 'E1', 'R5'] }],
    ['multiple-visible-owners', {
      workflowEntryTools: ['sku-batch', 'detail-page-design'],
      visibleAllowedToolNames: ['sku-batch', 'detail-page-design']
    }],
    ['write-not-authorized', { writeAuthorized: false }],
    ['owner-already-attempted', { attemptedToolNames: ['sku-batch'] }],
    ['active-continuation', { hasActiveContinuation: true }],
    ['action-already-produced', { hasActionResult: true }],
    ['owner-not-currently-visible', { visibleAllowedToolNames: ['getDocumentInfo'] }],
    ['non-write-owner', {
      workflowEntryTools: ['searchDesignKnowledge'],
      visibleAllowedToolNames: ['searchDesignKnowledge']
    }]
  ];
  compactE1BlockedCases.forEach(([name, overrides]) => {
    const call = buildDeterministicCompactE1WorkflowOwnerCall({
      ...compactE1WorkflowOwnerInput,
      ...overrides
    });
    if (call) {
      compactE1WorkflowOwnerViolations.push(`compact-e1-workflow-owner:${name}-did-not-fail-closed`);
    }
  });
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
  if (JSON.stringify(bareSkuSkillParams.comboSizes) !== JSON.stringify([2, 3, 4])
    || Object.prototype.hasOwnProperty.call(bareSkuSkillParams, 'requireSkuComboConfirmation')) {
    delegationBoundaryViolations.push('sku-delegation:bare-production-did-not-use-autonomous-2-3-4-draft');
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
  const {
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
  const comboConfirmationCases = [
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
  if (!skuBatchExecutorText.includes("source: 'agent_delegated_draft' as const")
    || !skuBatchExecutorText.includes('authoritativeBusinessFact: false')
    || !skuBatchExecutorText.includes('requiresReviewBeforePublishing: true')
    || !skuBatchExecutorText.includes('hasExplicitReversibleDesignDecisionDelegation(trustedUserInput)')
    || !skuBatchExecutorText.includes('const requiresSkuComboConfirmation = shouldRequestSkuComboConfirmation({')
    || skuBatchExecutorText.includes('(lacksAuthoritativeCombinationSpecification && !userDelegatedReversibleCombinationChoice)')) {
    delegationBoundaryViolations.push('sku-delegation:draft-provenance-or-trusted-user-wiring-missing');
  }
  const inlineMultimodalComposerSource = parseTsx(inlineMultimodalComposerPath);
  const appStoreText = read(appStorePath);
  const appStoreSource = parse(appStorePath);
  const messageParserText = read(messageParserPath);
  const chatResponseCleanerText = read(chatResponseCleanerPath);
  const messageRendererText = read(messageRendererPath);
  const messageRendererSource = parseTsx(messageRendererPath);
  const messageRendererCssText = read(messageRendererCssPath);
  const settingsModalText = read(settingsModalPath);
  const modelServiceText = read(modelServicePath);
  const resourceManagerServiceText = read(resourceManagerServicePath);
  const templateKnowledgeServiceText = read(templateKnowledgeServicePath);
  const preloadText = read(preloadPath);
  const rendererTypesText = read(rendererTypesPath);
  const websocketHandlersText = read(websocketHandlersPath);
  const uxpSkuLayoutText = read(uxpSkuLayoutPath);
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
  const { buildDesignVerdict } = require(designQualityVerdictPath);
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
    verifySkuAutoLayoutResult
  } = require(uxpSkuAutoLayoutPlanPath);
  const {
    resolveSkuBatchDeliveryOutcome,
    sanitizeSkuToolResultsForPublicResult
  } = require(skuExportReadbackPath);
  const { buildSkuDeliverySummary } = require(skuDeliverySummaryPath);
  const { buildSkillRoutingRecommendation } = require(skillRoutingPath);
  const { buildAutonomousExecutionDecisionForEngine } = require(path.join(
    root,
    'src',
    'shared',
    'agent-intent-control-plane.ts'
  ));
  const { resolveAutonomousCapabilityRuntime } = require(executorPath);
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
  const { resolveDetailAssetUsageDecision } = require(detailPageAssetRankerPath);
  const { buildDetailPageAgentIntake } = require(detailPageAgentIntakePath);
  const { buildProjectAssetIndex } = require(projectAssetIndexPath);
  const {
    buildProjectImageAnalysisCloseupPlan,
    buildProjectVisualSamplingPlan,
    buildProjectVisualSamplingCacheKey,
    cacheStatusForEntry,
    projectVisualCacheEntryMatchesCurrentAsset,
    selectDiverseProjectVisualCandidates
  } = require(visualSamplingPath);
  const {
    DESIGN_ASSERTIONS,
    buildVlmJudgeContextMessage,
    buildVlmJudgeSystemPrompt,
    isReliableVlmJudgeBatchComplete,
    parseVlmJudgeResponse,
    scoreDesignAssertions
  } = require(designQualityAssertionPath);
  const {
    decideQualityAwareReflexionReentry,
    isCompletedAestheticImprovementHandoff
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
    synchronizeRuntimeSessionActionPlanNodes
  } = require(runtimeSessionPath);
  const {
    buildAgentRuntimeProgressKey,
    buildUnfinishedContinuationKey
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
    SKU_BATCH_EVALUATION_PROFILE_ID,
    evaluateDesignEvaluationProfile,
    getDesignEvaluationProfileById,
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
  const realSkuSamplingFiles = [
    ...Array.from({ length: 20 }, (_, index) => ({
      path: `C:/project/6049/模特/${String(index + 1).padStart(3, '0')}.jpg`,
      relativePath: `6049/模特/${String(index + 1).padStart(3, '0')}.jpg`,
      name: `${String(index + 1).padStart(3, '0')}.jpg`
    })),
    ...Array.from({ length: 21 }, (_, index) => ({
      path: `C:/project/6049/平铺/${String(index + 1).padStart(3, '0')}.jpg`,
      relativePath: `6049/平铺/${String(index + 1).padStart(3, '0')}.jpg`,
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
  const aestheticProtocolViolations = [];
  if (!typeCharacterAssertion || !alignmentAssertion) {
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
      || !judgePrompt.includes('不要另返 pass 字段')) {
      aestheticProtocolViolations.push('judge-prompt-lost-single-score-or-top-three-diagnosis-contract');
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
      aestheticProtocolViolations.push('completed-aesthetic-reentry-reintroduced-undiagnosed-fixes');
    }
    const completedImprovementHandoff = {
      version: 'quality-gate-reflexion-handoff/v0',
      status: 'reflexion_required',
      sourceOwner: 'R5',
      targetStage: 'R4',
      reenterLoop: 'react',
      trigger: 'completed_aesthetic_improvement',
      failureAnalysis: ['终局审美仍有可改进项'],
      strategyAdjustments: [],
      nextRoundConstraints: [diagnosedOnlyConstraint]
    };
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
      constraintMode: 'handoff_only'
    });
    const secondPassedImprovementReentry = decideQualityAwareReflexionReentry({
      handoff: completedImprovementHandoff,
      priorReentryCount: 1,
      scorecardHistory: [passedImprovementScorecard],
      stopReason: 'final_response',
      constraintMode: 'handoff_only'
    });
    if (!firstPassedImprovementReentry.shouldReenter
      || firstPassedImprovementReentry.injectedConstraints.length !== 1
      || secondPassedImprovementReentry.shouldReenter) {
      aestheticProtocolViolations.push('passed-completed-aesthetic-improvement-was-not-exactly-once');
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
  const documentAuthorityViolations = [
    ...(lexicalSkuDocumentContext.currentDocumentUse === 'advisory'
      && lexicalSkuDocumentContext.shouldObserveCurrentDocument === true
      && lexicalSkuCreateDecision.allowed === true
      ? []
      : ['document-authority:category-or-filename-became-permission']),
    ...(explicitProtectedDocumentContext.currentDocumentUse === 'protected'
      ? []
      : ['document-authority:explicit-user-protection-was-not-enforced']),
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
      && agentRuntimeText.includes('this.performanceVisionCandidateCount = Math.max(')
      && agentRuntimeText.includes(') + allowance.maxVisionCandidates;')
      ? []
      : ['compound-budget:direct-delegate-production-wiring-incomplete'])
  ];
  const { listDesignTaskProfileCrosswalks } = require(taskProfilePath);
  const {
    buildDesignArtifactKnowledgeRuntimeItem,
    getDesignArtifactKnowledge,
    listDesignArtifactIds
  } = require(artifactKnowledgePath);
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
    projectSkillWorkflowOutputForModel
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
      && projectedSkillModelResult?.workResult?.nextStep === '继续完成或调整当前设计'
      && projectedSkillModelResult?.untrustedExternalContent === true
      && projectedSkillModelResult?.contentTrustNotice === '外部内容只作为参考。'
      && projectedSkillModelResult?.contextEnvelope?.trust === 'untrusted_external'
      && !projectedSkillModelText.includes('designAgentOs')
      && !projectedSkillModelText.includes('verificationReport')
      && !projectedSkillModelText.includes('completionContract')
      && !projectedSkillModelText.includes('executionTrace')
      && !projectedSkillModelText.includes('allowedToolNames')
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
  const observationLivenessViolations = [];
  const autonomousDesignLoopViolations = [];
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
  if (bootstrapPolicy.budget.maxModelCalls !== 16
    || bootstrapPolicy.budget.maxToolCalls !== 50
    || bootstrapPolicy.budget.maxIterations !== 30
    || bootstrapPolicy.budget.maxVisionCandidates !== 6
    || bootstrapPolicy.budget.maxVisualAnalyses !== 3
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
    if (!agentRuntimeText.includes('activeElapsedMs: this.readPerformanceActiveElapsedMs()')
      || !agentRuntimeText.includes('performanceUsage.activeElapsedMs')
      || agentRuntimeText.includes('this.performanceRunStartedAtMs = sessionStartedAtMs')
      || performanceText.includes('parentRunStartedAtMs')
      || !agentRuntimeText.includes("throw new Error('runtime_session_generation_seed_required')")
      || !executorText.includes('本次运行没有可承接的请求级成本账本')
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
      fullyReviewed: true
    });
    const trustedArtifact = readTrustedVisualReviewArtifact(trustedOwner);
    const forwardedOwner = {};
    const transferred = transferTrustedVisualReviewArtifact(trustedOwner, forwardedOwner);
    const forwardedArtifact = readTrustedVisualReviewArtifact(forwardedOwner);
    const clonedOwner = { ...trustedOwner };
    const parentFinalReviewReserve = resolveFinalQualityVisionCandidateReserve({
      reviewSet: longReviewSet.reviewSet
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
      || parentFinalReviewReserve !== 30
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
  const providerFailureCatchStart = executorText.indexOf("console.error('[AutonomousAgent] runtime failure:'");
  const providerFailureCatchEnd = executorText.indexOf('if (error instanceof AutonomousAgentModelCallError)', providerFailureCatchStart);
  const providerFailureCatchPrefix = providerFailureCatchStart >= 0 && providerFailureCatchEnd > providerFailureCatchStart
    ? executorText.slice(providerFailureCatchStart, providerFailureCatchEnd)
    : '';
  if (!executorText.includes('const buildPlanNeutralRuntimeContextItems = (')
    || staticContextSection.includes('artifactKnowledgeItem')
    || staticContextSection.includes('photoshopCraftRecipeItems')
    || staticContextSection.includes("id: 'knowledge.design-principles'")) {
    autonomousDesignLoopViolations.push('generation-context:plan-neutral-knowledge-not-replaceable');
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
    || !agentRuntimeText.includes('directVisionCandidateCount: reviewImagePlan.totalImages')
    || !agentRuntimeText.includes('directVisionCandidateKeys: reviewVisionCandidateKeys')
    || !agentRuntimeText.includes('billDirectVisionCandidatesByPresentation: true')
    || agentRuntimeText.includes('remainingVisionCandidates + reusedVisionCandidateCount')
    || agentRuntimeText.includes('this.performanceVisionCandidateKeys.has(normalizedKey)) return true;')
    || (agentRuntimeText.match(/retireDeliveredAgentMessageImages\(/g) || []).length < 3
    || !agentRuntimeText.includes('resolveVisionCandidateLimitForFinalQuality({')
    || !agentRuntimeText.includes('if (findObservedPhotoshopMutationProof(item.output))')
    || !agentRuntimeText.includes('this.latestDesignVisualJudgeBundleReviewSet')
    || !agentRuntimeText.includes('this.latestDesignVisualJudgeSingleReviewSet')
    || !agentRuntimeText.includes('resolveDesignReviewSetItemForDiagnosis(')
    || !designEvaluationProfilesText.includes("requiredSourceKind: 'detail-screen'")) {
    autonomousDesignLoopViolations.push('review-set:production-final-judge-wiring-incomplete');
  }
  if (!performanceText.includes('const plannedVisualStageCeiling =')
    || !agentRuntimeText.includes('this.performanceVisionCandidateCount = Math.max(')
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

  const emitSnapshotMethodText = findMethod(agentRuntimeSource, 'emitUserVisibleSnapshots')
    ?.getText(agentRuntimeSource) || '';
  const attachImageMethodText = findMethod(agentRuntimeSource, 'attachToolImageObservations')
    ?.getText(agentRuntimeSource) || '';
  const cacheScopeMethodText = findMethod(agentRuntimeSource, 'resolveReadResultCacheParams')
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
  if (!agentRuntimeText.includes("options?.budgetClass !== 'harness_quality_verification'")
    || !agentRuntimeText.includes("resultKind === 'photoshop_write'")
    || !agentRuntimeText.includes("resultKind === 'save_export'")
    || !executeToolMethodText.includes('isAgentReadCacheInvalidatingContext(name, args)')
    || !agentRuntimeText.includes('this.readResultCache.clear()')) {
    observationLivenessViolations.push('read-cache:fresh-readback-or-write-invalidation-missing');
  }
  if (!successfulObservationMethodText.includes('isAgentReadResultCacheHit(result)')
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
      releaseRuntimeTaskRunWriterBinding({ taskRunId: reboundSession.taskRun.taskRunId });
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
      releaseRuntimeTaskRunWriterBinding({ taskRunId: workflowSession.taskRun.taskRunId });
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
    checks: []
  };
  const evaluationProfileResult = {
    profileId: evaluationProfile.profileId,
    status: 'passed',
    verification: {
      missingRequiredCheckKeys: [],
      failedCheckKeys: [],
      needsReviewCheckKeys: []
    },
    scorecard: { blockers: [] }
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
  const verifiedSmartSaveContract = buildCreativeCompletionCase(
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
    ...((unverifiedExplicitCopyPolicy?.directive || '').includes('getAllTextLayers')
      && !/只写入 TaskPlan|恢复本轮误加/.test(unverifiedExplicitCopyPolicy?.directive || '')
      ? []
      : ['explicit-copy:missing-readback-triggered-rewrite-instead-of-observation']),
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
    ...(requirementById(verifiedSmartSaveContract, 'creative-delivery')?.status === 'passed'
      ? []
      : ['explicit-delivery:returned-psd-save-path-not-recognized']),
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
  const skuProductionRecommendation = buildSkillRoutingRecommendation(
    '按已确认组合批量出 SKU',
    skuRoutingOptions
  );
  const realSkuCombinationRequest = '请基于当前项目 E:\\WERKE\\C-1245 里的真实产品资料，自主完成 2双、3双、4双 SKU 组合设计。每个规格都要做两种方向：一组偏 INS 风格，一组偏纯色简洁风格；请自行识别项目里的产品信息、颜色和可用素材，缺少源文件或模板时自行创建，不要反复扫描已经看过的素材，不要只给方案或说明，必须在当前 Photoshop 文档中真实写入并导出可核验成品。D:\\A1 neveralone旗舰店 只作为只读验证集，用来判断成品是否接近成熟店铺效果，禁止把其中素材、模板、文案或项目事实作为输入，也禁止向该目录写入。全过程优先复用已观察证据并控制模型调用、图片读取和 token 成本。';
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
    const expectedOwners = Array.from(new Set([
      ...(manifest.legacy_skill_ids || []),
      ...(manifest.workflow_entry_skill_ids || [])
    ].map((id) => `skill.${id}`))).sort();
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
  const boundedSkuRegion = {
    left: 100,
    top: 80,
    right: 900,
    bottom: 620,
    width: 800,
    height: 540
  };
  const boundedSkuItems = Array.from({ length: 4 }, (_, index) => ({
    id: `sku-card-${index + 1}`,
    layerId: index + 101,
    name: `色卡${index + 1}`,
    bounds: {
      left: 0,
      top: 0,
      right: 240,
      bottom: 360,
      width: 240,
      height: 360
    }
  }));
  const boundedSkuPlans = [2, 3, 4].map((itemCount) => buildSkuBoundedRegionLayoutPlan({
    region: boundedSkuRegion,
    items: boundedSkuItems.slice(0, itemCount)
  }));
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
  const incompleteBoundedSkuQa = verifySkuAutoLayoutResult({
    plan: boundedSkuPlans[2],
    actualPlacements: boundedSkuPlans[2].placements.slice(0, 3).map((placement) => ({
      itemId: placement.itemId,
      layerId: placement.layerId,
      name: placement.name,
      destinationBox: placement.destinationBox,
      actualBounds: placement.destinationBox,
      actualSubjectBounds: placement.destinationBox
    }))
  });
  const completedSkuDeliveryOutcome = resolveSkuBatchDeliveryOutcome({
    hasAnyProcessedOutput: true,
    allRequestedComboSizesComplete: true,
    hasExecutionWarnings: false,
    exportReadbackStatus: 'ready_for_review'
  });
  const partialSkuDeliveryOutcome = resolveSkuBatchDeliveryOutcome({
    hasAnyProcessedOutput: true,
    allRequestedComboSizesComplete: false,
    hasExecutionWarnings: false,
    exportReadbackStatus: 'ready_for_review'
  });
  const blockedReadbackSkuDeliveryOutcome = resolveSkuBatchDeliveryOutcome({
    hasAnyProcessedOutput: true,
    allRequestedComboSizesComplete: true,
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
  const skuWorkflowEfficiencyViolations = [
    ...(publicSkuDeliverySummary.warningCount === 1
      && publicSkuDeliverySummary.detailText.includes('插件无法正确识别')
      && !publicSkuDeliverySummary.detailText.includes('execution contract')
      && !publicSkuDeliverySummary.detailText.includes('Photoshop revision')
      && !publicSkuDeliverySummary.detailText.includes('runtime diagnostic')
      && skuDeliverySummaryText.includes('userWarnings?: string[]')
      && skuDeliverySummaryText.includes('normalizeTextList(input.userWarnings)')
      && skuBatchExecutorText.includes('skuPrivateDiagnostics: buildSkuPrivateDiagnostics')
      && skuBatchExecutorText.includes('userWarnings: skuUserWarnings')
      && skuBatchExecutorText.includes('hasExecutionWarnings: hasWarnings')
      && agentDiagnosticRecordText.includes('skuPrivateDiagnostics?: unknown')
      && messageParserText.includes("{ label: '留意', value: `${Math.max(0, summary.warningCount)}项` }")
      ? []
      : ['sku-diagnostics:user-summary-and-private-diagnostic-channels-are-not-separated']),
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
    ...(incompleteBoundedSkuQa.status === 'blocked'
      && incompleteBoundedSkuQa.blockers.some((message) => message.includes('缺少有效实际边界'))
      ? []
      : ['sku-layout:missing-copied-card-did-not-block-export-qa']),
    ...(completedSkuDeliveryOutcome.success === true
      && completedSkuDeliveryOutcome.status === 'completed'
      && partialSkuDeliveryOutcome.success === false
      && partialSkuDeliveryOutcome.status === 'partial'
      && blockedReadbackSkuDeliveryOutcome.success === false
      && blockedReadbackSkuDeliveryOutcome.status === 'blocked_export_readback'
      ? []
      : ['sku-delivery:partial-or-blocked-readback-was-reported-success']),
    ...(uxpSkuAutoLayoutPlanText.includes('buildSkuBoundedRegionLayoutPlan')
      && uxpSkuLayoutText.includes('buildSkuBoundedRegionLayoutPlan({')
      && uxpSkuLayoutText.includes('validLayerIds.length !== regionColors.length')
      && uxpSkuLayoutText.includes('assertCopiedSkuLayerStructure({')
      && skuBatchExecutorText.includes('resolveSkuBatchDeliveryOutcome({')
      && skuBatchExecutorText.includes('success: deliveryOutcome.success')
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
      && executorText.includes('const exposeSkillRoutingRecommendation = Boolean(skillRoutingRecommendation)')
      && executorText.includes('当前任务可能适合')
      && executorText.includes('相符就直接使用')
      && executorText.includes('如果并不匹配')
      && !executorText.includes('hasPendingRuntimeDesignWorkflowRecommendation(')
      && !executorText.includes('deferSkillBridgesUntilManifest')
      && !executorText.includes('requiredControlTool')
      && !engineText.includes('declaredSkillId: skillRoutingRecommendation.skillId')
      && realSkuEngineDecision.toolScope === 'write_photoshop'
      && realSkuEngineDecision.executionAuthorization === 'confirmed_tool_required'
      && planNeutralSkuResolution.selectedCapabilityIds.includes('skill.sku-batch')
      && !planNeutralSkuResolution.selectedToolNames.includes('declareDesignIntent')
      && planNeutralSkuResolution.onDemandCapabilityIds.includes('agent.intent.declareDesignTask')
      && planNeutralSkuResolution.selectedToolNames.includes('sku-batch')
      && planNeutralSkuActivationAttempt.status === 'rejected'
      && planNeutralSkuActivationAttempt.activatedCapabilityIds.length === 0
      && planNeutralSkuActivationAttempt.issues.some((issue) => (
        issue.code === 'requested_capability_already_active'
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

  const checks = [
    {
      id: 'skill-results-project-design-work-without-runtime-accounting',
      description: 'Skill 原始结果继续供 Runtime、续跑与诊断使用；设计模型只接收工作结果、实际问题和下一步，不接收 OS、验收报告、执行轨迹或能力 allowlist。',
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
      id: 'aesthetic-judge-protocol-is-brief-relative-and-non-blocking-by-default',
      description: '审美 Judge 以 score 为唯一裁决值；无分结果不污染覆盖率，N/A 受断言白名单约束，结构启发信号不冒充像素事实，诊断强制 top-3 且 completed 改进保持 handoff-only，零视觉/局部编辑 Profile 不强跑全局 VLM。',
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
      id: 'compact-e1-sole-workflow-owner-dispatches-on-text-only-turn',
      description: '无 R4 的紧凑 Runtime 到达 E1 后，只有一个当前可见且已授权的 workflow owner 时可确定性调用一次；创意 R4、多 owner、未授权、已尝试、已有动作或 continuation 均保持失败关闭。',
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
        ...(skuIntentParamsText.includes('!noteDisabled && noteRequested')
          ? []
          : ['sku-batch:note-generation-not-bound-to-explicit-note-request']),
        ...(defaultsText.includes('generateNotes: sourceOnly ? false : true')
          ? ['sku-batch:defaults-expand-delivery-to-notes']
          : []),
        ...(engineText.includes('sanitized.generateNotes = true')
          ? ['engine:controlled-sku-expands-delivery-to-notes']
          : []),
        ...(skuIntentParamsText.includes('(?:不要|别|不能|不应|不再|并非).{0,4}(?:只|仅|单独)')
          ? []
          : ['sku-batch:negative-note-only-intent-can-reverse-user-request'])
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
        ...(/resolveAutonomousPerformancePolicy\([\s\S]{0,240}runtimeContractBundle\s*\)/.test(executorText)
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
        ...(agentRuntimeText.includes("runtimeBriefRequiresDelivery")
          && agentRuntimeText.includes("productionObligation === 'photoshop_mutation_with_readback'")
          && agentRuntimeText.includes('!requiresAgentTaskProgress(plan)')
          && agentRuntimeText.includes('!runtimeBriefRequiresDelivery')
          ? []
          : ['agent-runtime:declared-production-obligation-not-enforced']),
        ...(agentRuntimeText.includes('const hasViewableVersion = hasPhotoshopChange || hasSavedOrExportedFile;')
          && !agentRuntimeText.includes('const hasRecordedMutation = Number(summary.successfulMutationCalls || 0) > 0;')
          && agentRuntimeText.includes("versionState = '当前状态：还没有可看的设计版本。';")
          && agentRuntimeText.includes('title = hasViewableVersion ? \'当前改动已保留\' : \'这次还没做出版本\';')
          ? []
          : ['agent-runtime:unproven-write-can-claim-viewable-version']),
        ...(agentRuntimeText.includes("const awaitingInteractiveConfirmation = input.stopReason === 'awaiting_user_confirmation';")
          && agentRuntimeText.includes("const awaitingUserInput = input.stopReason === 'awaiting_user_input';")
          && agentRuntimeText.includes('if (awaitingUserInput) {\n            rawVisibleMessage = input.message;')
          && agentRuntimeText.includes("const awaitingInteractiveConfirmation = summary.stopReason === 'awaiting_user_confirmation';")
          && agentRuntimeText.includes("const awaitingUserInput = summary.stopReason === 'awaiting_user_input';")
          && agentRuntimeText.includes('需要你回答上面的问题；收到后会从当前状态继续。')
          ? []
          : ['agent-runtime:plain-user-question-collapsed-into-confirmation-card']),
        ...(!agentRuntimeText.includes('if (error) return `失败原因: ${error}`;')
          && agentRuntimeText.includes('return `${displayName}没有拿到可确认的完成结果。`;')
          && agentRuntimeText.includes("issue: success ? undefined : 'tool_failed'")
          ? []
          : ['agent-runtime:raw-tool-error-entered-user-process']),
        ...(agentRuntimeText.includes('private buildVerificationStepDetail(projection: UserResultProjection): string')
          && agentRuntimeText.includes('detail: this.buildVerificationStepDetail(userResultProjection)')
          && agentRuntimeText.includes('let rawVisibleMessage = userResultProjection.message;')
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
      description: '有声明交付物时原始 save 不能绕过 E2 receipt；receipt 后再写入必须使其失效；局部修改必须验证目标达成且范围外未受影响。',
      violations: [
        ...(agentRuntimeText.includes('if (requiredOutputs.length === 0)')
          ? []
          : ['delivery:raw-save-can-bypass-declared-outputs']),
        ...(agentRuntimeText.includes('const laterMutationExists = this.toolCallLog.slice(receiptIndex + 1)')
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
      description: 'declareDesignIntent 的合法 taskType/workMode 必须动态来自已通过发布校验的 Runtime Profile 目录，不能暴露任务注册表中的不可达组合。',
      violations: [
        ...(toolSchemasText.includes('buildRuntimeDeclarationProfileCatalog')
          ? []
          : ['tool-schema:missing-runtime-declaration-profile-catalog']),
        ...(toolSchemasText.includes('enum: DECLARABLE_DESIGN_TASK_TYPE_IDS')
          ? []
          : ['tool-schema:missing-dynamic-task-type-enum']),
        ...(toolSchemasText.includes('enum: DECLARABLE_RUNTIME_WORK_MODES')
          ? []
          : ['tool-schema:missing-dynamic-work-mode-enum'])
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
          && agentRuntimeText.includes('compileRuntimeContext({ items: applicableItems, stage })')
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
      description: '主体适配必须按语义锚点求解，并能区分几何通过与明显偏移；几何裁决不代表审美通过。',
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
        ...(toolSchemasText.includes('工具会在同一次调用内完成写后主体读回并返回 geometryVerification')
          && toolExecutorText.includes('【主体感知缩放与定位】')
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
          && promptText.includes('不是缺少输入')
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
        ...(agentRuntimeText.includes('const hasAttemptedDeliveryAction = this.toolCallLog.some')
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
          : ['policy-gate:repeat-guard-not-wired-or-incomplete'])
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
        ...(executorText.includes('AUTONOMOUS_MODEL_TRANSPORT_MAX_ATTEMPTS = 2')
          && executorText.includes('!hasEmittedStreamPayload')
          && executorText.includes("error.providerFailure.kind === 'service_unavailable'")
          && executorText.includes("error.providerFailure.kind === 'network'")
          && executorText.includes("error.providerFailure.kind === 'timeout'")
          ? []
          : ['provider-failure:bounded-pre-output-retry-missing']),
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
        ...(toolExecutorText.includes('params?.autoSelect !== true')
          && toolExecutorText.includes('params?.imageData || params?.filePath || params?.fileToken')
          && designPlacementIntelligenceText.includes("top.sourceTreatment === 'matte_and_recompose'")
          && designPlacementIntelligenceText.includes("top.directUseSuitability !== 'suitable'")
          ? []
          : ['asset-placement:explicit-selection-or-direct-use-boundary-missing']),
        ...(!toolSchemasText.includes('selectionDecisionSource:')
          && designPlacementIntelligenceText.includes("authority: 'harness'")
          && designPlacementIntelligenceText.includes("? 'agent_judgment'")
          ? []
          : ['asset-placement:model-force-provenance-still-self-authorizing'])
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
        ...(detailPageAssetRankerText.includes('selectDetailAssetCandidate(')
          && detailPageAssetRankerText.includes('assetUsageDecision')
          && detailPageAssetRankerText.includes('executionDeferred: !executableSource')
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

run();
