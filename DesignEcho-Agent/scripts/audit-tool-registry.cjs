#!/usr/bin/env node
/**
 * 工具注册一致性校验
 *
 * 一个工具的"身份"目前散在多个文件：tool-schemas(模型可见的定义)、tool-display-info(显示名)、
 * agent-tool-execution-preflight + photoshop-tool-skill(权限 scope)、tool-executor(执行)。
 * 散布导致"漏登记 = 能力半隐身"——例如工具显示英文名(差体验)，或写操作漏了 scope 不受"读后写"保护。
 *
 * 本校验交叉检查 tool-schemas 里每个工具在「显示名 / 权限 scope」两个最易漏的切面是否都登记。
 * 退出码非 0 表示存在缺口，可接入构建/CI 防回归。
 *
 * 运行：node scripts/audit-tool-registry.cjs
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// 1. tool-schemas：模型能看到、能调用的工具
const schemas = read('src/renderer/services/agent-runtime/tool-schemas.ts');
const schemaTools = [...new Set([...schemas.matchAll(/name: ['"]([a-zA-Z][\w]*)['"]/g)].map((m) => m[1]))];
const schemaToolSet = new Set(schemaTools);

// Design Team 的 allowedTools 既是模型可见范围，也是运行时真实执行范围；声明漂移不得静默丢弃。
const designTeamRegistry = read('src/renderer/services/design-teams/registry.ts');
const designTeamCoordinator = read('src/renderer/services/design-teams/coordinator.ts');
const autonomousExecutor = read('src/renderer/services/skill-executors/autonomous-agent.executor.ts');
const agentRuntime = read('src/renderer/services/agent-runtime/agent.ts');
const agentPerformancePolicy = read('src/shared/agent-performance-policy.ts');
const designTeamConsultationContract = read('src/shared/designer-agent-team-consultation-contract.ts');
const missingDesignTeamAllowedTools = [];
for (const match of designTeamRegistry.matchAll(/role:\s*['"]([^'"]+)['"][\s\S]*?allowedTools:\s*\[([\s\S]*?)\]/g)) {
    const role = match[1];
    const allowedTools = [...match[2].matchAll(/['"]([a-zA-Z][\w]*)['"]/g)].map((item) => item[1]);
    for (const toolName of allowedTools) {
        if (!schemaToolSet.has(toolName)) missingDesignTeamAllowedTools.push(`${role}:${toolName}`);
    }
}
const designTeamRuntimeScopeViolations = [];
const designTeamRunStageControl = designTeamCoordinator.match(
    /const runStage = async \([\s\S]*?const cancelledResult/
)?.[0] || '';
const designTeamReviewControl = designTeamCoordinator.match(
    /const reviewOutcome = await runStage\([\s\S]*?verdict = parseCriticVerdict\(review\.message\);/
)?.[0] || '';
if (!designTeamCoordinator.includes('if (!allowedToolNames.has(toolName))')) {
    designTeamRuntimeScopeViolations.push('真实 executeTool 回调未校验 allowedTools');
}
if (!/this\.callModel,\s*scopedExecuteTool\s*\)/m.test(designTeamCoordinator)) {
    designTeamRuntimeScopeViolations.push('子 Agent 未使用受限 executeTool 回调');
}
if (!designTeamCoordinator.includes('plannedRoles')
    || !designTeamCoordinator.includes('includeMarketResearch')
    || !designTeamCoordinator.includes('includeCopywriting')) {
    designTeamRuntimeScopeViolations.push('团队流水线仍固定执行市场/文案阶段，未消费既有 rolePlan');
}
if (!designTeamCoordinator.includes("const includeMarketResearch = plannedRoles.has('market-researcher')")
    || !designTeamCoordinator.includes("const includeCopywriting = plannedRoles.has('copywriter')")
    || designTeamCoordinator.includes('const includeMarketResearch = !plannedRoles')
    || designTeamCoordinator.includes('const includeCopywriting = !plannedRoles')) {
    designTeamRuntimeScopeViolations.push('未声明 rolePlan 时仍会默认启动市场/文案阶段');
}
if (!schemas.includes('specialistRoles')
    || !autonomousExecutor.includes('requestedSpecialistRoles')
    || !designTeamConsultationContract.includes("specialistRoles.has('market-researcher')")
    || !designTeamConsultationContract.includes("specialistRoles.has('copywriter')")) {
    designTeamRuntimeScopeViolations.push('可选市场/文案角色没有从工具参数贯通到团队角色计划');
}
if (!autonomousExecutor.includes('designTeamPipelineAttempted')
    || !autonomousExecutor.includes('design_team_pipeline_already_attempted')) {
    designTeamRuntimeScopeViolations.push('同一自主运行仍可能重复启动完整团队流水线');
}
if (!autonomousExecutor.includes('qualityPassed: result.qualityPassed')
    || !autonomousExecutor.includes('childAgentUsage: result.childAgentUsage')) {
    designTeamRuntimeScopeViolations.push('团队流水线质量状态或子 Agent 用量未透传给父 Agent');
}
if (!designTeamRunStageControl.includes("result.status === 'cancelled'")
    || !designTeamRunStageControl.includes("return { status: 'cancelled' }")
    || !designTeamCoordinator.includes("status === 'cancelled') return cancelledResult()")) {
    designTeamRuntimeScopeViolations.push('子阶段取消未传播为 pipeline cancelledResult');
}
if (!designTeamReviewControl.includes('if (!review.success)')
    || !designTeamReviewControl.includes('success: false')
    || !designTeamReviewControl.includes('qualityPassed: false')) {
    designTeamRuntimeScopeViolations.push('critic 执行失败仍可能被包装为 pipeline success');
}
const teamReservationMethodStart = agentRuntime.indexOf('reserveDesignTeamChildExecution(input:');
const teamReservationMethodEnd = agentRuntime.indexOf(
    'private commitDesignTeamChildAllowance',
    teamReservationMethodStart
);
const teamReservationMethod = teamReservationMethodStart >= 0 && teamReservationMethodEnd > teamReservationMethodStart
    ? agentRuntime.slice(teamReservationMethodStart, teamReservationMethodEnd)
    : '';
const teamAllowanceCommitIndex = teamReservationMethod.indexOf(
    'this.commitDesignTeamChildAllowance(reservation.allowance)'
);
const teamReservationReadyReturnIndex = teamReservationMethod.lastIndexOf('return reservation;');
if (!teamReservationMethod.includes('buildDesignTeamChildExecutionReservation({')
    || teamAllowanceCommitIndex < 0
    || teamReservationReadyReturnIndex < teamAllowanceCommitIndex
    || !agentRuntime.includes(') + allowance.maxModelCalls;')
    || !agentRuntime.includes(') + allowance.maxToolCalls;')
    || !agentRuntime.includes(') + allowance.maxVisionCandidates;')
    || !agentRuntime.includes(') + allowance.maxVisualAnalyses;')
    || !agentRuntime.includes('this.synchronizeRuntimePerformanceUsage();')) {
    designTeamRuntimeScopeViolations.push('父 Agent 未在子流水线启动前预提交 child allowance 并保留 finalization reserve');
}
if (!autonomousExecutor.includes('designTeamPipelineAttempted = true;')
    || !autonomousExecutor.includes('const reservation = reserveDesignTeamChildExecution?.({')
    || !autonomousExecutor.includes('reservation.allowance')
    || autonomousExecutor.indexOf('designTeamPipelineAttempted = true;')
        > autonomousExecutor.indexOf('const reservation = reserveDesignTeamChildExecution?.({')) {
    designTeamRuntimeScopeViolations.push('完整团队流水线未先标记单次尝试并只下发 child allowance');
}
if (!agentPerformancePolicy.includes('DESIGN_TEAM_ROLE_EXECUTION_MINIMUMS')
    || !agentPerformancePolicy.includes('executor: Object.freeze({ modelCalls: 4, toolCalls: 3 })')
    || !designTeamCoordinator.includes('getDesignTeamRoleExecutionMinimum(role)')
    || !designTeamCoordinator.includes('sumDesignTeamRoleExecutionRequirements(requiredBaseRoles)')) {
    designTeamRuntimeScopeViolations.push('helper/coordinator 没有共用唯一角色权重，或 executor 缺少 read→write→readback→finalize 最小额度');
}
if (!designTeamCoordinator.includes('stageMaxIterations: stageBudget.maxIterations')
    || !designTeamCoordinator.includes('stagePerformanceBudget: stageBudget.performanceBudget')
    || !designTeamCoordinator.includes('const stageAbortController = new AbortController()')
    || !designTeamCoordinator.includes('childDeadlineAtMs - Date.now()')) {
    designTeamRuntimeScopeViolations.push('阶段事前切片或绝对 deadline 未真正注入子 Agent');
}
if (!designTeamCoordinator.includes('const effectiveContext = [request.context, context]')
    || !designTeamCoordinator.includes('values.indexOf(value) === index')
    || !designTeamCoordinator.includes('...(effectiveContext ? { context: effectiveContext } : {})')) {
    designTeamRuntimeScopeViolations.push('团队 Brief/Profile 上下文未去重后注入每个阶段');
}
if (!designTeamCoordinator.includes('remainingChildBudget.modelCalls < requiredBaseExecution.modelCalls')
    || !designTeamCoordinator.includes('remainingChildBudget.toolCalls < requiredBaseExecution.toolCalls')
    || !designTeamCoordinator.includes("error: 'design_team_child_allowance_exhausted'")) {
    designTeamRuntimeScopeViolations.push('基础阶段不足未按角色加权总额在启动前返回 success:false');
}
const atomicRevisionReservationIndex = designTeamCoordinator.indexOf(
    'const revisionRouteWithReview = [...route'
);
const atomicRevisionCommitIndex = designTeamCoordinator.indexOf(
    'reserveStageGroupBudgets(revisionRouteWithReview)',
    atomicRevisionReservationIndex
);
const atomicRevisionBlockIndex = designTeamCoordinator.indexOf(
    'if (!Array.isArray(revisionRouteReservations))',
    atomicRevisionCommitIndex
);
const firstRevisionStageIndex = designTeamCoordinator.indexOf(
    'for (let routeIndex = 0; routeIndex < route.length; routeIndex++)',
    atomicRevisionReservationIndex
);
const revisionRoundCommitIndex = designTeamCoordinator.indexOf(
    'revisionRounds++;',
    atomicRevisionReservationIndex
);
if (atomicRevisionReservationIndex < 0
    || atomicRevisionCommitIndex < atomicRevisionReservationIndex
    || atomicRevisionBlockIndex < atomicRevisionCommitIndex
    || revisionRoundCommitIndex < atomicRevisionBlockIndex
    || firstRevisionStageIndex < atomicRevisionBlockIndex
    || !designTeamCoordinator.includes("const revisionRouteWithReview = [...route, 'critic' as const]")
    || !designTeamCoordinator.includes('budgetExhaustedDuringRevision = true')
    || !designTeamCoordinator.includes('pendingRevisionReviewBudget = revisionRouteReservations[route.length]')) {
    designTeamRuntimeScopeViolations.push('needs_fix 后未在任何修订启动前原子提交实际 route + critic 复审额度');
}
const revisionCompletionIndex = designTeamCoordinator.indexOf(
    'const criticVerdictPassed = verdict?.status === \'pass\''
);
const revisionCompletionControl = revisionCompletionIndex >= 0
    ? designTeamCoordinator.slice(revisionCompletionIndex)
    : '';
if (!revisionCompletionControl.includes('success: true')
    || !designTeamCoordinator.includes('visualReviewArtifact = readTrustedVisualReviewArtifact(review)')
    || !designTeamCoordinator.includes('visualReviewEvidence = visualReviewArtifact?.fullyReviewed === true')
    || !designTeamCoordinator.includes('? visualReviewArtifact.receipt')
    || designTeamCoordinator.includes('visualReviewEvidence = findLatestRuntimeVisualReviewEvidence(pipelineToolResults)')
    || !revisionCompletionControl.includes('const qualityPassed = criticVerdictPassed && Boolean(visualReviewEvidence)')
    || !revisionCompletionControl.includes('qualityPassed,')
    || !revisionCompletionControl.includes('budgetExhaustedDuringRevision ? { budgetExhausted: true }')) {
    designTeamRuntimeScopeViolations.push('首次 critic 后修订额度不足时，未保留 success:true + qualityPassed:false + budgetExhausted:true 语义');
}
const childUsagePostDeductionPattern = /(performanceModelCallCount|performanceToolCallCount|performanceVisualAnalysisCount|performanceVisionCandidateCount)\s*(?:\+=|=)[^;\n]*childAgentUsage/;
if (childUsagePostDeductionPattern.test(agentRuntime)
    || childUsagePostDeductionPattern.test(autonomousExecutor)) {
    designTeamRuntimeScopeViolations.push('检测到子 Agent 实际用量返回后再倒扣父账本');
}

// 素材推荐是 recommendAssets → IPC/preload → renderer 的跨进程只读契约。
// 审计守住三件事：候选同屏只调用一次视觉模型、metadata-only 不冒充自动置入证据、
// shot/background 事实能够进入项目视觉缓存。
const resourceManager = read('src/main/services/resource-manager-service.ts');
const resourceHandlers = read('src/main/ipc-handlers/resource-handlers.ts');
const preload = read('src/main/preload.ts');
const rendererTypes = read('src/renderer/types.d.ts');
const toolExecutor = read('src/renderer/services/tool-executor.service.ts');
const toolSchemasSource = read('src/renderer/services/agent-runtime/tool-schemas.ts');
const detailPageDesignSkill = read('src/renderer/services/design-skills/detail-page-design.skill.ts');
const detailPageExecutor = read('src/renderer/services/skill-executors/detail-page.executor.ts');
const detailPageAssetRanker = read('src/renderer/services/skill-executors/detail-page-asset-ranker.ts');
const projectVisualSampling = read('src/shared/project-visual-sampling.ts');
const projectVisualInsightCacheFill = read('src/shared/project-visual-insight-cache-fill.ts');
const assetRecommendationContractViolations = [];
if (!resourceManager.includes('const contactSheet = await this.createProjectContactSheetOverview({')
    || !resourceManager.includes('normalizeAssetRecommendationVisionCandidates(response, renderedIds)')
    || !resourceManager.includes('const visionCandidateLimit = Math.min(12, Math.max(5, resultLimit))')
    || resourceManager.includes('for (const candidate of visionCandidates)')) {
    assetRecommendationContractViolations.push('recommendAssets 未收敛为一次 contact-sheet 候选比较');
}
if (!resourceManager.includes('visual.visualScore * 0.78 + candidate.heuristicScore * 0.22')) {
    assetRecommendationContractViolations.push('候选总分未保持视觉证据主导');
}
if (!resourceManager.includes('visualObserved: false')
    || !resourceManager.includes("directUseSuitability: 'unsuitable'")
    || !resourceManager.includes("sourceTreatment: 'requires_visual_review'")
    || !resourceManager.includes('尚未取得该素材的视觉内容证据，不能据此自动置入')) {
    assetRecommendationContractViolations.push('metadata-only 候选仍可能被误认作自动置入证据');
}
for (const field of ['visualObserved', 'visualRole', 'assetNature', 'backgroundType', 'directUseSuitability', 'sourceTreatment', 'reason', 'suggestedUse']) {
    if (!resourceManager.includes(field) || !rendererTypes.includes(field)) {
        assetRecommendationContractViolations.push(`素材推荐字段未贯通 resource/renderer 类型：${field}`);
    }
}
for (const field of ['deterministic', 'designRole', 'placementIntent']) {
    if (!resourceHandlers.includes(`${field}: params.${field}`)
        || !preload.includes(`${field}?:`)
        || !rendererTypes.includes(`${field}?:`)) {
        assetRecommendationContractViolations.push(`recommendAssets IPC 参数未贯通：${field}`);
    }
}
if (!resourceManager.includes("candidateFiles?: Array<Partial<ResourceFile> & Pick<ResourceFile, 'path'>>")
    || !resourceManager.includes('providedCandidates.length > 0 ? undefined : await this.scanDirectory()')
    || !resourceHandlers.includes('candidateFiles: params.candidateFiles')
    || !preload.includes('candidateFiles?: Array<{')
    || !rendererTypes.includes('candidateFiles?: Array<{')) {
    assetRecommendationContractViolations.push('详情页候选总览未复用本轮库存，仍可能重新递归扫描项目');
}
if (!toolExecutor.includes('detailPageContactSheetObservationByInventory = new WeakMap')
    || !toolExecutor.includes('trustedDetailPageProjectAssetReceipt = new WeakMap')
    || !toolExecutor.includes('trustedDetailPageProjectAssetsByAnalysis = new WeakMap')
    || !toolExecutor.includes('isTrustedDetailPageProjectAssets(params.projectAssets, projectPath)')
    || !detailPageExecutor.includes('readTrustedDetailPageProjectAssetsFromAnalysis(result)')
    || !toolExecutor.includes('observeDetailPageCandidatesWithContactSheet({')
    || !toolExecutor.includes('candidateFiles: unresolved.map((image) => ({')
    || !detailPageDesignSkill.includes('projectAssets,')
    || !detailPageExecutor.includes('projectAssets: preScannedProjectAssets')) {
    assetRecommendationContractViolations.push('详情页冷缓存未形成单次联系表观察并在单屏重建中复用');
}
if (!detailPageAssetRanker.includes('visualRole?: DesignAssetVisualRole;')
    || !detailPageAssetRanker.includes('assetNature?: ProjectVisualAssetNature;')
    || !toolExecutor.includes('...(item.assetNature ? { assetNature: item.assetNature } : {})')
    || !detailPageAssetRanker.includes("if (signal.visualRole && signal.visualRole !== 'unknown') return signal.visualRole;")) {
    assetRecommendationContractViolations.push('联系表视觉职责未进入详情页 task-relative 使用决策');
}
if (!detailPageAssetRanker.includes("if (visualRole === 'reference')")
    || !detailPageAssetRanker.includes("if (backgroundType === 'designed_composite')")) {
    assetRecommendationContractViolations.push('参考/设计成品/合成画面仍可能被自动升级为 direct/clip');
}
const recommendAssetsSchemaStart = toolSchemasSource.indexOf("name: 'recommendAssets'");
const recommendAssetsSchemaEnd = recommendAssetsSchemaStart >= 0
    ? toolSchemasSource.indexOf("name: '", recommendAssetsSchemaStart + 20)
    : -1;
let recommendAssetsSchemaBlock = '';
if (recommendAssetsSchemaStart >= 0) {
    const blockEnd = recommendAssetsSchemaEnd > recommendAssetsSchemaStart
        ? recommendAssetsSchemaEnd
        : recommendAssetsSchemaStart + 2400;
    recommendAssetsSchemaBlock = toolSchemasSource.slice(recommendAssetsSchemaStart, blockEnd);
}
if (recommendAssetsSchemaBlock.includes('candidateFiles')) {
    assetRecommendationContractViolations.push('Harness-only 候选库存被暴露进模型 recommendAssets Tool Schema');
}
const recommendAssetsToolCaseStart = toolExecutor.indexOf("case 'recommendAssets':");
const recommendAssetsToolCaseEnd = toolExecutor.indexOf("case 'measureReferenceComposition':", recommendAssetsToolCaseStart);
const recommendAssetsToolCase = recommendAssetsToolCaseStart >= 0 && recommendAssetsToolCaseEnd > recommendAssetsToolCaseStart
    ? toolExecutor.slice(recommendAssetsToolCaseStart, recommendAssetsToolCaseEnd)
    : '';
if (recommendAssetsToolCase.includes('candidateFiles')) {
    assetRecommendationContractViolations.push('模型 recommendAssets 工具分支可伪造 Harness-only 候选库存');
}
for (const field of ['shotType', 'backgroundType']) {
    if (!projectVisualSampling.includes(`${field}?:`)
        || !projectVisualInsightCacheFill.includes(`${field}?: string;`)
        || !resourceManager.includes(`"${field}"`)) {
        assetRecommendationContractViolations.push(`素材视觉事实未进入 composition/cache-fill：${field}`);
    }
}

// 2. 显示名 TOOL_NAME_MAP 的 key（4 空格缩进的 key: {）
const display = read('src/renderer/services/tool-display-info.ts');
const displayKeys = new Set([...display.matchAll(/^\s{4}([a-zA-Z]\w*):\s*\{/gm)].map((m) => m[1]));

// 3. 权限 scope：散在两个文件——preflight 的分类 Set + photoshop-tool-skill 的 PHOTOSHOP_WRITE_TOOLS
const preflight = read('src/shared/agent-tool-execution-preflight.ts');
const photoshopSkill = read('src/shared/photoshop-tool-skill.ts');
const scopeClassified = new Set([
    ...[...preflight.matchAll(/^\s{4}['"]([a-zA-Z][\w]*)['"],?\s*$/gm)].map((m) => m[1]),
    ...[...photoshopSkill.matchAll(/^\s{4}['"]([a-zA-Z][\w]*)['"],?\s*$/gm)].map((m) => m[1])
]);

// 少数工具的 scope 来自动态逻辑（getSkillById / acceptance evidence）而非静态 Set，列为已知例外避免误报
const DYNAMIC_SCOPE_EXEMPT = new Set([
    'delegateToAgent',
    // getPhotoshopToolSkillSemantics 对 skuLayout 按运行时 action 参数特判(buildSkuLayoutSemantics)，
    // 不进任何静态 Set，见 photoshop-tool-skill.ts
    'skuLayout'
]);

// 4. scope 分类散在两个文件，重叠的具名 Set 必须成员一致（否则会出现不同步隐患）
function extractNamedSet(src, setName) {
    const m = src.match(new RegExp(`const ${setName} = new Set\\(\\[([\\s\\S]*?)\\]\\)`));
    if (!m) return null;
    return new Set([...m[1].matchAll(/['"]([a-zA-Z][\w]*)['"]/g)].map((x) => x[1]));
}
const SHARED_SCOPE_SETS = ['KNOWLEDGE_SEARCH_TOOLS', 'SAVE_EXPORT_TOOLS', 'EXTERNAL_GENERATION_TOOLS'];
const setMismatches = [];
for (const setName of SHARED_SCOPE_SETS) {
    const a = extractNamedSet(preflight, setName);
    const b = extractNamedSet(photoshopSkill, setName);
    if (!a || !b) continue;
    const onlyA = [...a].filter((t) => !b.has(t));
    const onlyB = [...b].filter((t) => !a.has(t));
    if (onlyA.length || onlyB.length) {
        setMismatches.push(`${setName}: preflight 独有[${onlyA.join(', ')}] · photoshop-tool-skill 独有[${onlyB.join(', ')}]`);
    }
}

const missingDisplay = schemaTools.filter((t) => !displayKeys.has(t));
const missingScope = schemaTools.filter((t) => !scopeClassified.has(t) && !DYNAMIC_SCOPE_EXEMPT.has(t));

// 5. 反向校验：UXP DesignEcho-UXP/src/tools 下声明过 name 的工具，tool-schemas 里有没有漏收。
// 治理审计(2026-07-01)之前，本脚本的比对基准全部取自 Agent 侧文件互相校验，从未读取 UXP 侧
// 工具真实注册表，导致约 40 个已实现工具(形态变形/智能对象写操作/模板渲染/SKU配置等)长期
// 对模型不可见，而这份"全绿"报告完全没能发现。见项目记忆 design-agent-governance-audit-20260701。
//
// 已评审、故意不开放给模型的工具：新增时必须写明理由，不能只是图省事排除。
const EXPLICITLY_NOT_EXPOSED_TO_AGENT = new Map([
    ['applyDisplacement', 'Agent 内部专用二进制位移场协议(SPARSE:xxx)，普通模型无法生成合法参数值'],
    ['warpExplorer', '研究/调试用探索性工具，commands 参数允许执行任意未受限 batchPlay 命令'],
    ['rasterizeSmartObject', '当前实现无条件返回失败，暴露给模型只会产生误导性的失败调用'],
    ['harmonize_layer', '旧谐调链路从未完成像素导出且依赖不存在的 wsClient.request，Agent、面板与 UXP 实现已整体退役'],
    ['quick_harmonize', '同 harmonize_layer：旧包装入口随未接线的谐调链路整体退役']
]);

const UXP_TOOLS_ROOT = path.resolve(ROOT, '..', 'DesignEcho-UXP', 'src', 'tools');

function collectTsFiles(dir) {
    let results = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results = results.concat(collectTsFiles(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('.ts')) {
            results.push(fullPath);
        }
    }
    return results;
}

const uxpDeclaredTools = new Set();
const uxpNativeGetModalRisks = [];
const NATIVE_GET_DESCRIPTOR_WINDOW = 1200;
if (fs.existsSync(UXP_TOOLS_ROOT)) {
    for (const filePath of collectTsFiles(UXP_TOOLS_ROOT)) {
        const text = fs.readFileSync(filePath, 'utf8');
        const relativePath = path.relative(path.resolve(ROOT, '..'), filePath);
        // 覆盖 `readonly name = 'xxx'` 与 `name = 'xxx'` 两种最常见的工具类身份声明写法
        for (const m of text.matchAll(/(?:readonly\s+)?name\s*=\s*['"]([a-zA-Z][\w]*)['"]/g)) {
            uxpDeclaredTools.add(m[1]);
        }

        // Photoshop 对无效 Action get 不保证只返回 JS 错误；真机会弹出原生
        // “命令‘获取’当前不可用”并阻塞整个 UXP 调度线程。已确认的非法历史对象组合
        // 必须在静态审计阻断，即使描述符写了 dontDisplay 也不能放行。
        const invalidHistoryCount = /_obj:\s*['"]get['"][\s\S]{0,1200}?_property:\s*['"]count['"][\s\S]{0,400}?_ref:\s*['"]historyState['"]/g;
        for (const match of text.matchAll(invalidHistoryCount)) {
            const line = text.slice(0, match.index).split('\n').length;
            uxpNativeGetModalRisks.push(`${relativePath}:${line} 使用了非法 historyState.count get`);
        }

        // 所有仍需使用 batchPlay 的 get 都必须明确禁止展示宿主对话框。DOM 已公开的
        // 数据应优先使用 DOM；此检查只守住剩余原生描述符的最低安全边界。
        for (const match of text.matchAll(/_obj:\s*['"]get['"]/g)) {
            const descriptorWindow = text.slice(match.index, match.index + NATIVE_GET_DESCRIPTOR_WINDOW);
            if (!/_options\s*:\s*\{[\s\S]*?dialogOptions\s*:\s*['"]dontDisplay['"]/.test(descriptorWindow)) {
                const line = text.slice(0, match.index).split('\n').length;
                uxpNativeGetModalRisks.push(`${relativePath}:${line} 原生 get 缺少 dialogOptions: dontDisplay`);
            }
        }
    }
}
const missingFromAgent = [...uxpDeclaredTools]
    .filter((name) => !schemaToolSet.has(name) && !EXPLICITLY_NOT_EXPOSED_TO_AGENT.has(name))
    .sort();
const excludedFromAgent = [...uxpDeclaredTools]
    .filter((name) => EXPLICITLY_NOT_EXPOSED_TO_AGENT.has(name))
    .sort();

console.log(`工具总数 (tool-schemas): ${schemaTools.length}`);
console.log(`缺中文显示名: ${missingDisplay.length}${missingDisplay.length ? '  -> ' + missingDisplay.join(', ') : ''}`);
console.log(`缺权限 scope: ${missingScope.length}${missingScope.length ? '  -> ' + missingScope.join(', ') : ''}`);
console.log(`scope 两源不同步: ${setMismatches.length}`);
setMismatches.forEach((m) => console.log('  -> ' + m));
console.log(`UXP 已声明但 tool-schemas 未收录: ${missingFromAgent.length}${missingFromAgent.length ? '  -> ' + missingFromAgent.join(', ') : ''}`);
console.log(`Design Team allowedTools 缺 schema: ${missingDesignTeamAllowedTools.length}${missingDesignTeamAllowedTools.length ? '  -> ' + missingDesignTeamAllowedTools.join(', ') : ''}`);
console.log(`Design Team 运行时工具边界缺口: ${designTeamRuntimeScopeViolations.length}${designTeamRuntimeScopeViolations.length ? '  -> ' + designTeamRuntimeScopeViolations.join(', ') : ''}`);
console.log(`素材推荐视觉证据契约缺口: ${assetRecommendationContractViolations.length}${assetRecommendationContractViolations.length ? '  -> ' + assetRecommendationContractViolations.join(', ') : ''}`);
console.log(`已评审故意不开放给模型: ${excludedFromAgent.length}${excludedFromAgent.length ? '  -> ' + excludedFromAgent.join(', ') : ''}`);
console.log(`UXP 原生 get 弹窗风险: ${uxpNativeGetModalRisks.length}`);
uxpNativeGetModalRisks.forEach((risk) => console.log('  -> ' + risk));

if (missingDisplay.length || missingScope.length || setMismatches.length || missingFromAgent.length || missingDesignTeamAllowedTools.length || designTeamRuntimeScopeViolations.length || assetRecommendationContractViolations.length || uxpNativeGetModalRisks.length) {
    console.error('\n[FAIL] 工具注册存在缺口。新增/修改工具时请同步登记：');
    if (missingDisplay.length) console.error('  - 显示名 -> src/renderer/services/tool-display-info.ts (TOOL_NAME_MAP)');
    if (missingScope.length) console.error('  - 权限 scope -> src/shared/photoshop-tool-skill.ts 或 src/shared/agent-tool-execution-preflight.ts');
    if (setMismatches.length) console.error('  - scope 两源的同名 Set 必须保持成员一致(preflight ↔ photoshop-tool-skill)');
    if (missingFromAgent.length) console.error('  - UXP 已注册但模型不可见 -> src/renderer/services/agent-runtime/tool-schemas.ts (RAW_TOOL_CATALOG + DEFAULT_AGENT_TOOL_NAMES)，或加入本脚本 EXPLICITLY_NOT_EXPOSED_TO_AGENT 并写明理由');
    if (missingDesignTeamAllowedTools.length) console.error('  - Design Team allowedTools 必须引用真实存在的 Agent tool schema');
    if (designTeamRuntimeScopeViolations.length) console.error('  - Design Team 必须在 Agent 的真实 executeTool 回调再次强制 allowedTools');
    if (assetRecommendationContractViolations.length) console.error('  - recommendAssets 必须保持单次视觉比较、metadata-only 失败关闭与跨进程字段一致');
    if (uxpNativeGetModalRisks.length) console.error('  - UXP 原生 get 必须使用有效对象/属性组合并声明 dialogOptions: dontDisplay；DOM 已公开的数据优先改用 DOM');
    process.exit(1);
}
console.log('\n[OK] 工具注册一致性校验通过。');
