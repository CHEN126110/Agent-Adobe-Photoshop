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
const executorPath = path.join(
  root,
  'src',
  'renderer',
  'services',
  'skill-executors',
  'autonomous-agent.executor.ts'
);
const contextCompilerPath = path.join(runtimeRoot, 'runtime-context-compiler.ts');
const contextCapacityPath = path.join(root, 'src', 'shared', 'agent-context-allocation.ts');
const agentPath = path.join(root, 'src', 'renderer', 'services', 'agent-runtime', 'agent.ts');
const toolSchemasPath = path.join(root, 'src', 'renderer', 'services', 'agent-runtime', 'tool-schemas.ts');
const { validatePromptCapabilityGovernance } = require(
  path.join(runtimeRoot, 'prompt-capability-governance.ts')
);
const { compileRuntimeContext } = require(contextCompilerPath);
const { buildAgentContextCapacityPlan } = require(contextCapacityPath);
const { buildAgentOperatingProfilePromptSection } = require(
  path.join(runtimeRoot, 'agent-operating-profile.ts')
);
const { buildDesignerAgentAutonomyPrinciplesPromptSection } = require(
  path.join(root, 'src', 'shared', 'designer-agent-autonomy-principles.ts')
);
const { buildPrimaryVisualObservationReviewInstruction } = require(
  path.join(root, 'src', 'renderer', 'services', 'agent-runtime', 'visual-observation-strategy.ts')
);
const { buildAgentToolPreflightUserProcess } = require(
  path.join(root, 'src', 'shared', 'agent-user-visible-state.ts')
);

function declaration(promptId, input) {
  return {
    promptId,
    version: '1.0.0',
    fixedSequence: false,
    createsIndependentRuntimeState: false,
    grantsToolPermission: false,
    executesTools: false,
    advancesRuntimeStage: false,
    declaresCompletion: false,
    ...input
  };
}

const candidateMappings = [
  declaration('P-01', { owner: 'model', implementation: 'model_prompt', authority: 'declarative', scope: 'capability', activation: 'runtime_conditioned', stages: ['R1'], capabilityKinds: ['skill'] }),
  declaration('P-02', { owner: 'runtime', implementation: 'deterministic_code', authority: 'declarative', scope: 'capability', activation: 'runtime_conditioned', stages: ['R0'], capabilityKinds: ['skill', 'policy'] }),
  declaration('P-03', { owner: 'model', implementation: 'model_prompt', authority: 'declarative', scope: 'capability', activation: 'runtime_conditioned', stages: ['R4'], capabilityKinds: ['skill', 'policy'] }),
  declaration('P-04', { owner: 'model', implementation: 'model_prompt', authority: 'declarative', scope: 'capability', activation: 'on_demand', stages: ['R2'], capabilityKinds: ['knowledge', 'tool'] }),
  declaration('P-05', { owner: 'memory', implementation: 'hybrid', authority: 'advisory', scope: 'capability', activation: 'on_demand', stages: ['R2', 'R3'], capabilityKinds: ['knowledge', 'memory', 'policy'] }),
  declaration('P-06', { owner: 'skill', implementation: 'model_prompt', authority: 'declarative', scope: 'capability', activation: 'runtime_conditioned', stages: ['R3'], capabilityKinds: ['knowledge', 'skill'] }),
  declaration('P-07', { owner: 'skill', implementation: 'model_prompt', authority: 'declarative', scope: 'capability', activation: 'runtime_conditioned', stages: ['R3'], capabilityKinds: ['knowledge', 'skill'] }),
  declaration('P-08', { owner: 'skill', implementation: 'model_prompt', authority: 'declarative', scope: 'capability', activation: 'runtime_conditioned', stages: ['R4'], capabilityKinds: ['skill', 'evaluation'] }),
  declaration('P-09', { owner: 'skill', implementation: 'model_prompt', authority: 'declarative', scope: 'skill', activation: 'on_demand', stages: ['R3', 'R4'], capabilityKinds: ['knowledge', 'skill', 'evaluation'], skillIds: ['ecommerce.main_image'] }),
  declaration('P-10', { owner: 'skill', implementation: 'model_prompt', authority: 'declarative', scope: 'skill', activation: 'on_demand', stages: ['R3', 'R4'], capabilityKinds: ['knowledge', 'skill', 'evaluation'], skillIds: ['ecommerce.detail_page'] }),
  declaration('P-11', { owner: 'skill', implementation: 'model_prompt', authority: 'declarative', scope: 'skill', activation: 'on_demand', stages: ['R3', 'R4'], capabilityKinds: ['knowledge', 'skill', 'evaluation'], skillIds: ['ecommerce.sku_batch'] }),
  declaration('P-12', { owner: 'skill', implementation: 'model_prompt', authority: 'declarative', scope: 'skill', activation: 'on_demand', stages: ['R3', 'R4'], capabilityKinds: ['knowledge', 'skill', 'evaluation'], skillIds: ['candidate.brand_kv'] }),
  declaration('P-13', { owner: 'model', implementation: 'model_prompt', authority: 'declarative', scope: 'capability', activation: 'runtime_conditioned', stages: ['R4'], capabilityKinds: ['skill', 'tool', 'policy'] }),
  declaration('P-14', { owner: 'runtime', implementation: 'deterministic_code', authority: 'execution', scope: 'capability', activation: 'on_demand', stages: ['E1'], capabilityKinds: ['tool', 'policy'], executesTools: true, advancesRuntimeStage: true }),
  declaration('P-15', { owner: 'runtime', implementation: 'hybrid', authority: 'declarative', scope: 'capability', activation: 'on_demand', stages: ['E1'], capabilityKinds: ['tool', 'evaluation'] }),
  declaration('P-16', { owner: 'evaluation', implementation: 'model_prompt', authority: 'declarative', scope: 'capability', activation: 'runtime_conditioned', stages: ['R5'], capabilityKinds: ['evaluation', 'policy'] }),
  declaration('P-17', { owner: 'model', implementation: 'model_prompt', authority: 'advisory', scope: 'capability', activation: 'runtime_conditioned', stages: ['R5', 'R4'], capabilityKinds: ['skill', 'evaluation'] }),
  declaration('P-18', { owner: 'runtime', implementation: 'deterministic_code', authority: 'completion', scope: 'capability', activation: 'runtime_conditioned', stages: ['E2'], capabilityKinds: ['evaluation', 'policy'], advancesRuntimeStage: true, declaresCompletion: true }),
  declaration('P-19', { owner: 'memory', implementation: 'hybrid', authority: 'advisory', scope: 'capability', activation: 'on_demand', stages: ['E2'], capabilityKinds: ['memory', 'policy'] }),
  declaration('P-20', { owner: 'runtime', implementation: 'hybrid', authority: 'advisory', scope: 'capability', activation: 'runtime_conditioned', stages: ['R1', 'R2', 'R3', 'R4', 'E1', 'R5', 'E2'], capabilityKinds: ['memory', 'policy'] })
];

const report = validatePromptCapabilityGovernance({ declarations: candidateMappings });
assert.strictEqual(report.status, 'valid', JSON.stringify(report.issues, null, 2));
assert.strictEqual(report.declarationCount, 20);
assert.strictEqual(report.validCount, 20);
assert.strictEqual(report.invalidCount, 0);
assert.strictEqual(report.boundaries.createsPromptRegistry, false);
assert.strictEqual(report.boundaries.createsWorkflowRuntime, false);
assert.strictEqual(report.boundaries.createsCapabilityResolver, false);
assert.strictEqual(report.boundaries.grantsPermission, false);
assert.strictEqual(report.boundaries.executesTools, false);
assert.strictEqual(report.boundaries.declaresCompletion, false);

const operatingProfilePrompt = buildAgentOperatingProfilePromptSection();
assert(operatingProfilePrompt.includes('先说清能交付什么具体结果'));
assert(operatingProfilePrompt.includes('不把常识性边界写成免责声明'));
assert(operatingProfilePrompt.includes('资深商业视觉设计师'));
assert(operatingProfilePrompt.includes('创意与质量负责人'));
assert(operatingProfilePrompt.includes('Photoshop 和各项能力只是你的制作媒介，不是你的身份'));
assert(operatingProfilePrompt.includes('你要对画面有主见'));
assert(operatingProfilePrompt.includes('向用户表达时使用设计师语言'));
const autonomyPrinciplesPrompt = buildDesignerAgentAutonomyPrinciplesPromptSection();
assert(autonomyPrinciplesPrompt.includes('足以支撑成品质量的可逆路径'));
assert(autonomyPrinciplesPrompt.includes('省步骤或尽快停下都不是开放创意的目标'));
assert(!autonomyPrinciplesPrompt.includes('走最短可逆路径'));
assert(autonomyPrinciplesPrompt.includes('生成商品文案或把产品信息写入交付物时'));
assert(autonomyPrinciplesPrompt.includes('纯能力说明不需要主动罗列这些边界'));
assert(autonomyPrinciplesPrompt.includes('可编辑、无报错或看过截图只是制作与观察事实，不等于设计已经做好'));
assert(autonomyPrinciplesPrompt.includes('焦点与阅读顺序、比例与留白、字体与色彩、图像处理、缩略图识别'));
assert(autonomyPrinciplesPrompt.includes('孤立或无功能元素'));
assert(autonomyPrinciplesPrompt.includes('再次自我确认容易受既有方向锚定'));
assert(autonomyPrinciplesPrompt.includes('比较参考、隔离批评与直接修订的信息增益后自主选择'));
assert(autonomyPrinciplesPrompt.includes('不把其中任何一项变成固定工具顺序'));
const primaryDesignReviewPrompt = buildPrimaryVisualObservationReviewInstruction(
  'observation:test-design',
  'getCanvasSnapshot',
  'canvas'
);
assert(primaryDesignReviewPrompt.includes('从实际像素判断焦点与阅读顺序'));
assert(primaryDesignReviewPrompt.includes('它们是判断视角，不是固定打卡表'));
assert(primaryDesignReviewPrompt.includes('指出可观察的画面关系'));
assert(primaryDesignReviewPrompt.includes('summary":"可观察关系及其与当前目标的联系"'));
assert(primaryDesignReviewPrompt.includes('“已生成、可编辑、无报错、结构完整、看过画面”都不是设计质量依据'));
assert(primaryDesignReviewPrompt.includes('比较直接修订、相关参考与隔离批评哪一种最能减少当前不确定性'));
assert(primaryDesignReviewPrompt.includes('不要求固定顺序，也不要求三者都做'));
for (const fixedToolRequirement of ['必须调用 Eagle', '必须调用 evaluateDesign', '必须委派 critic']) {
  assert(!primaryDesignReviewPrompt.includes(fixedToolRequirement));
}
const structuralOrganizationReviewPrompt = buildPrimaryVisualObservationReviewInstruction(
  'observation:test-organization',
  'getCanvasSnapshot',
  'semantic-layer-organization-region'
);
assert(structuralOrganizationReviewPrompt.includes('只判断图片是否可读'));
assert(!structuralOrganizationReviewPrompt.includes('从实际像素判断焦点与阅读顺序'));
const preflightUserProcess = buildAgentToolPreflightUserProcess({
  toolDisplayName: '添加亮度/对比度调整',
  blockers: [
    '已有读取结果未包含可校验的 documentId，不能精确锁定 Photoshop 写入目标。需要先取得带文档身份的只读事实，具体观察方式由 Agent 从当前已授权能力中选择。'
  ]
});
assert.strictEqual(preflightUserProcess.title, '确认当前工作画面');
assert(preflightUserProcess.detail.includes('确保调整落在正确画面上'));
for (const internalTerm of ['documentId', '写入目标', '文档身份', '授权能力', 'Harness', '门禁']) {
  assert(!`${preflightUserProcess.title}\n${preflightUserProcess.detail}`.includes(internalTerm));
}

const negativeReport = validatePromptCapabilityGovernance({
  declarations: [
    declaration('NEG-FIXED', { owner: 'model', implementation: 'model_prompt', authority: 'declarative', scope: 'capability', activation: 'always', stages: ['R1'], capabilityKinds: ['skill'], fixedSequence: true, createsIndependentRuntimeState: true }),
    declaration('NEG-EXEC', { owner: 'model', implementation: 'model_prompt', authority: 'execution', scope: 'capability', activation: 'on_demand', stages: ['E1'], capabilityKinds: ['tool'], grantsToolPermission: true, executesTools: true, advancesRuntimeStage: true }),
    declaration('NEG-DONE', { owner: 'evaluation', implementation: 'hybrid', authority: 'completion', scope: 'capability', activation: 'runtime_conditioned', stages: ['E2'], capabilityKinds: ['evaluation'], declaresCompletion: true }),
    declaration('NEG-GLOBAL', { owner: 'skill', implementation: 'model_prompt', authority: 'declarative', scope: 'global', activation: 'always', stages: ['R3'], capabilityKinds: ['skill'], skillIds: ['ecommerce.main_image'] }),
    declaration('NEG-SKILL', { owner: 'skill', implementation: 'model_prompt', authority: 'declarative', scope: 'skill', activation: 'always', stages: ['R3'], capabilityKinds: ['skill'] })
  ]
});
const negativeIssueCodes = new Set(negativeReport.issues.map((issue) => issue.code));
for (const code of [
  'fixed_sequence_forbidden',
  'independent_runtime_state_forbidden',
  'model_prompt_execution_authority',
  'model_prompt_grants_permission',
  'model_prompt_executes_tools',
  'model_prompt_advances_stage',
  'execution_requires_deterministic_code',
  'model_prompt_completion_authority',
  'model_prompt_declares_completion',
  'completion_requires_deterministic_code',
  'global_prompt_skill_binding',
  'skill_scope_missing_skill_id',
  'skill_prompt_always_active'
]) {
  assert(negativeIssueCodes.has(code), `negative fixture must expose ${code}`);
}

const executorSource = fs.readFileSync(executorPath, 'utf8');
const toolSchemasSource = fs.readFileSync(toolSchemasPath, 'utf8');
const evaluateDesignSchemaStart = toolSchemasSource.indexOf("name: 'evaluateDesign'");
const evaluateDesignSchemaEnd = toolSchemasSource.indexOf("name: 'composeDesign'", evaluateDesignSchemaStart);
assert(evaluateDesignSchemaStart >= 0 && evaluateDesignSchemaEnd > evaluateDesignSchemaStart);
const evaluateDesignSchemaSource = toolSchemasSource.slice(evaluateDesignSchemaStart, evaluateDesignSchemaEnd);
assert(evaluateDesignSchemaSource.includes('可编辑、无报错或看过截图不等于设计成熟'));
assert(evaluateDesignSchemaSource.includes('孤立或无功能元素'));
assert(evaluateDesignSchemaSource.includes('隔离批评比直接修订或参考比较更有信息增益时调用'));
assert(!evaluateDesignSchemaSource.includes('必须调用'));
const systemPromptStart = executorSource.indexOf('function buildBaseSystemPrompt');
const capabilityPromptStart = executorSource.indexOf('function buildBaseCapabilityPolicyPrompt');
assert(systemPromptStart >= 0 && capabilityPromptStart > systemPromptStart);
const systemPromptSource = executorSource.slice(systemPromptStart, capabilityPromptStart);
for (const forbidden of [
  'runDesignTeamPipeline',
  'delegateToAgent',
  'scene-analyst',
  'searchProjectResources',
  'getAcceptanceSnapshot',
  'createTextLayer',
  'detail-page',
  'main-image',
  'SKU'
]) {
  assert(!systemPromptSource.includes(forbidden), `global System Prompt must not embed ${forbidden}`);
}
assert(executorSource.includes("id: 'policy.execution-discipline'"));
assert(executorSource.includes('content: baseCapabilityPolicyPrompt'));
assert(executorSource.includes("slot: 'capability_policy'"));

const planNeutralKnowledgeStart = executorSource.indexOf('function buildPlanNeutralDesignKnowledgeRuntimeItems(');
const planNeutralKnowledgeEnd = executorSource.indexOf(
  'export interface AutonomousCapabilityRuntime',
  planNeutralKnowledgeStart
);
assert(planNeutralKnowledgeStart >= 0 && planNeutralKnowledgeEnd > planNeutralKnowledgeStart);
const planNeutralKnowledgeSource = executorSource.slice(planNeutralKnowledgeStart, planNeutralKnowledgeEnd);
assert(planNeutralKnowledgeSource.includes("id: 'knowledge.plan-neutral-designer-judgment'"));
assert(planNeutralKnowledgeSource.includes("buildDesignPrinciplesSummary('overview')"));
assert(planNeutralKnowledgeSource.includes('getDesignKnowledge 或 getDesignPrinciples'));
assert(planNeutralKnowledgeSource.includes('首稿可执行不等于完成'));
assert(planNeutralKnowledgeSource.includes('挑战首个安全方案'));
assert(planNeutralKnowledgeSource.length <= 5_000, 'plan-neutral design foundation must remain compact');
for (const fullKnowledgeInjection of [
  'buildDesignMethodKnowledgeRuntimeContext({',
  'buildDesignArtifactKnowledgeRuntimeItem({',
  'buildPhotoshopCraftRecipeRuntimeItems({',
  'buildDesignPrinciplesRuntimeContext(true)'
]) {
  assert(
    !planNeutralKnowledgeSource.includes(fullKnowledgeInjection),
    `plan-neutral context must fetch deep knowledge on demand instead of injecting ${fullKnowledgeInjection}`
  );
}

assert(!executorSource.includes('declareDesignIntent({ taskType:'));
assert(executorSource.includes('declareDesignIntent({ taskTypeId: <Profile> })'));
assert(executorSource.includes('当前工具列表已有匹配 Skill 时直接调用 Skill'));
assert(executorSource.includes('只有系统在下方明确给出对应 Profile、且当前工具列表没有匹配 Skill 时'));
assert(executorSource.includes('规格化生产有唯一答案时走最短确定路径'));
assert(executorSource.includes('开放创意以成品质量为先'));
assert(executorSource.includes('按结果风险与信息增益取得足够证据'));
assert(!executorSource.includes('理解目标后走最短可行路径'));
assert(!executorSource.includes('选择最短、足够的信息路径'));
assert(!executorSource.includes('需要建立新视觉结构时尽早做出可逆首稿'));
assert(!executorSource.includes('必须调用 Eagle'));
assert(!executorSource.includes('必须调用 evaluateDesign'));
const declareIntentSchemaStart = toolSchemasSource.indexOf("name: 'declareDesignIntent'");
const declareIntentSchemaEnd = toolSchemasSource.indexOf("name: 'searchDesignKnowledge'", declareIntentSchemaStart);
assert(declareIntentSchemaStart >= 0 && declareIntentSchemaEnd > declareIntentSchemaStart);
const declareIntentSchemaSource = toolSchemasSource.slice(declareIntentSchemaStart, declareIntentSchemaEnd);
assert(declareIntentSchemaSource.includes('pass that id as taskTypeId'));
assert(declareIntentSchemaSource.includes('If a matching Skill tool is already visible, call that Skill directly'));
assert(declareIntentSchemaSource.includes('only when the system prompt explicitly names the exact Profile id'));
assert(declareIntentSchemaSource.includes("}, ['taskTypeId'])"));
assert(!declareIntentSchemaSource.includes('with that taskType to bind it'));

const contextCompilerSource = fs.readFileSync(contextCompilerPath, 'utf8');
assert(contextCompilerSource.includes('policySeparatedFromData: true'));
assert(contextCompilerSource.includes('externalContentDataOnly: true'));
assert(contextCompilerSource.includes('grantsPermission: false'));
assert(contextCompilerSource.includes('executesTools: false'));

const smallWindowPlan = buildAgentContextCapacityPlan({
  windowTokens: 8_000,
  requestedOutputTokens: 4_000
});
assert.strictEqual(smallWindowPlan.basis, 'model_window');
assert.strictEqual(smallWindowPlan.windowTokens, 8_000);
assert(smallWindowPlan.outputReserveTokens <= 1_600);
assert(smallWindowPlan.contextTokenCeiling < smallWindowPlan.windowTokens);
assert(smallWindowPlan.runtimeContextCharacterCeiling <= 9_000);
const unknownWindowPlan = buildAgentContextCapacityPlan({
  requestedOutputTokens: 32_000
});
assert.strictEqual(unknownWindowPlan.basis, 'unknown_window_fallback');
assert.strictEqual(unknownWindowPlan.windowTokens, null);
assert.strictEqual(unknownWindowPlan.contextTokenCeiling, 100_000);
assert(unknownWindowPlan.outputReserveTokens <= 8_192);

const agentSource = fs.readFileSync(agentPath, 'utf8');
assert(agentSource.includes('estimateToolSchemaTokens(iterationTools)'));
assert(agentSource.includes('this.contextManager.prepare('));
const contextManagerSource = fs.readFileSync(
  path.join(root, 'src', 'renderer', 'services', 'agent-runtime', 'context-manager.ts'),
  'utf8'
);
assert(contextManagerSource.includes("error.code = 'context_window_budget_exceeded'"));

const designerFacingContext = compileRuntimeContext({
  items: [
    {
      id: 'policy.design-principles',
      kind: 'policy',
      source: 'system',
      trust: 'trusted_system',
      slot: 'system_policy',
      content: '先理解作品，再自主推进。'
    },
    {
      id: 'project.current-state',
      kind: 'project_state',
      source: 'design-project-state',
      trust: 'governed_project',
      slot: 'project_context',
      content: '当前项目已有三张单品图。'
    },
    {
      id: 'reference.external',
      kind: 'reference',
      source: 'external-file',
      trust: 'untrusted_external',
      slot: 'external_reference',
      content: '参考简洁、留白充足的版式。'
    }
  ]
});
assert.strictEqual(designerFacingContext.metrics.characterBudget, 64_000);
const boundedContext = compileRuntimeContext({
  items: [
    {
      id: 'bounded.policy',
      kind: 'policy',
      source: 'system',
      trust: 'trusted_system',
      slot: 'system_policy',
      content: '必要规则。'
    }
  ],
  maxTotalCharacters: 1_000
});
assert.strictEqual(boundedContext.metrics.characterBudget, 1_000);
assert(designerFacingContext.prompt.includes('## 本次工作的基本原则'));
assert(designerFacingContext.prompt.includes('## 项目现状'));
assert(designerFacingContext.prompt.includes('## 外部参考'));
assert(designerFacingContext.prompt.includes('【参考资料开始】'));
assert(designerFacingContext.prompt.includes('【外部资料开始】'));
assert(designerFacingContext.prompt.includes('> 当前项目已有三张单品图。'));
assert.strictEqual(designerFacingContext.boundaries.externalContentDataOnly, true);
for (const internalToken of [
  'runtime_context_item',
  'DATA_ONLY',
  'trust=',
  'authority=',
  'Manifest',
  'Runtime context',
  'System policy',
  'Capability policy'
]) {
  assert(!designerFacingContext.prompt.includes(internalToken), `designer context must hide ${internalToken}`);
}

console.log(JSON.stringify({
  success: true,
  mappedPromptCandidates: report.declarationCount,
  validPromptCandidates: report.validCount,
  negativeIssueCodes: Array.from(negativeIssueCodes).sort(),
  productionBoundaries: {
    globalSystemPromptCategoryNeutral: true,
    capabilityPolicySeparated: true,
    contextTrustCompilerRequired: true,
    modelWindowOwnsRuntimeContextBudget: true,
    toolSchemasAndOutputReservedBeforeProviderCall: true,
    createsPromptRegistry: false,
    createsWorkflowRuntime: false,
    grantsPermission: false,
    executesTools: false,
    declaresCompletion: false
  }
}, null, 2));
