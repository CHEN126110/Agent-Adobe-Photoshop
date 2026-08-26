const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
require('ts-node').register({ transpileOnly: true, project: path.join(root, 'tsconfig.main.json') });
const {
    normalizeContactSheetObservation
} = require(path.join(root, 'src/main/services/resource-manager-service.ts'));
const {
    extractImagesFromToolResult
} = require(path.join(root, 'src/renderer/services/agent-runtime/tool-result-sanitizer.ts'));
const {
    hasValidDetailAssetSelectionReceipt,
    resolveDetailImageExecutionDeferral
} = require(path.join(root, 'src/renderer/services/skill-executors/detail-page-plan-utils.ts'));
const {
    matchDetailPageContentPlans
} = require(path.join(root, 'src/renderer/services/skill-executors/detail-page-asset-ranker.ts'));
const {
    solveLayout,
    solveRegionLayout,
    validateModelAuthoredLayout
} = require(path.join(root, 'src/shared/layout/layout-engine.ts'));
const {
    buildRenderLayoutStackPlan
} = require(path.join(root, 'src/shared/layout/render-layout-stack-plan.ts'));
const {
    buildSkuColorCardPlan
} = require(path.join(root, 'src/shared/sku-color-card-skill.ts'));
const {
    bindSkuColorCardRuntimeSelection,
    createSkuColorCardRuntimeSelectionReceipt
} = require(path.join(root, 'src/shared/sku-color-card-runtime-selection.ts'));
const {
    buildVisibleAgentActivityFromProgress,
    buildVisibleAgentActivityFromStepEvent,
    formatAgentProcessEventContent,
    isVisibleAgentProcessEvent
} = require(path.join(root, 'src/renderer/services/agent-visible-feedback.ts'));

async function main() {
const failures = [];

function source(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function check(name, condition, detail = '') {
    if (condition) {
        console.log(`✅ ${name}`);
        return;
    }
    failures.push(`${name}${detail ? `: ${detail}` : ''}`);
    console.error(`❌ ${failures[failures.length - 1]}`);
}

const toolExecutor = source('src/renderer/services/tool-executor.service.ts');
const toolSchemas = source('src/renderer/services/agent-runtime/tool-schemas.ts');
const composeExecutor = source('src/renderer/services/design-workshop/compose-design.executor.ts');
const scalingPolicy = source('src/shared/design-smart-scaling-policy.ts');
const mainImagePlacement = source('src/shared/main-image-variant-placement-strategy.ts');
const skillDeclarations = source('src/shared/skills/skill-declarations.ts');
const referenceStyleRecipes = source('src/shared/reference-replication-style-recipes.ts');
const referenceApply = source('src/renderer/services/skill-executors/layout-replication-apply.ts');
const composeSpec = source('src/shared/design-workshop/compose-design-spec.ts');
const prompts = source('src/shared/prompts/index.ts');
const mainImageManifest = source('src/shared/agent-runtime-v5/manifests/main-image.manifest.ts');
const detailPageManifest = source('src/shared/agent-runtime-v5/manifests/detail-page.manifest.ts');
const observationCard = source('src/shared/agent-runtime-v5/visual-observation-card.ts');
const taskCompletion = source('src/renderer/services/agent-runtime/task-completion-contract.ts');
const codexSubscription = source('src/main/services/codex-subscription-service.ts');
const codexStrictOutputSchema = source('src/main/services/codex-strict-output-schema.ts');
const capabilitySession = source('src/renderer/services/agent-runtime/capability-session.ts');
const autonomousExecutor = source('src/renderer/services/skill-executors/autonomous-agent.executor.ts');
const designAgentEngineSource = source('src/renderer/services/design-agent/engine.ts');
const skillRoutingSource = source('src/shared/skill-routing.ts');
const agentRuntime = source('src/renderer/services/agent-runtime/agent.ts');
const agentMessageContext = source('src/renderer/services/agent-runtime/message-context.ts');
const mcpHostClient = source('src/renderer/services/mcp-host.client.ts');
const preloadSource = source('src/main/preload.ts');
const detailPageAssetRanker = source('src/renderer/services/skill-executors/detail-page-asset-ranker.ts');
const detailPageExecutor = source('src/renderer/services/skill-executors/detail-page.executor.ts');
const detailPagePlanUtils = source('src/renderer/services/skill-executors/detail-page-plan-utils.ts');
const uxpDetailPageFiller = source('../DesignEcho-UXP/src/tools/layout/detail-page-filler.ts');
const mainImageProjectStyleStrategy = source('src/shared/main-image-project-style-strategy.ts');
const skuTemplateManifest = source('src/shared/agent-runtime-v5/manifests/sku-template.manifest.ts');
const skuTemplateDesignLoop = source('src/shared/sku-template-design-loop.ts');
const modelProviderFailureBoundary = source('src/renderer/services/agent-runtime/model-provider-failure-boundary.ts');
const modelProviderTransportPolicy = source('src/shared/model-provider-transport-policy.ts');
const failureBreaker = source('src/renderer/services/agent-runtime/tool-failure-breaker.ts');
const messageRendererCss = source('src/renderer/components/message/MessageRenderer.css');
const designerAutonomyPrinciples = source('src/shared/designer-agent-autonomy-principles.ts');
const designerDecisionContractSource = source('src/shared/designer-agent-decision-contract.ts');
const designMethodKnowledgeSource = source('src/shared/agent-runtime-v5/design-method-knowledge.ts');
const designArtifactKnowledgeSource = source('src/shared/knowledge/design-artifact-knowledge.ts');
const designPrinciplesSource = source('src/shared/knowledge/design-principles.ts');
const projectVisualSamplingSource = source('src/shared/project-visual-sampling.ts');
const resourceManagerSource = source('src/main/services/resource-manager-service.ts');
const toolResultSanitizerSource = source('src/renderer/services/agent-runtime/tool-result-sanitizer.ts');
const uxpTemplateTool = source('../DesignEcho-UXP/src/tools/layout/template-tool.ts');
const layoutEngineSource = source('src/shared/layout/layout-engine.ts');
const skuBatchExecutorSource = source('src/renderer/services/skill-executors/sku-batch.executor.ts');
const skuColorCardExecutorSource = source('src/renderer/services/skill-executors/sku-color-card.executor.ts');
const skuColorCardContractSource = source('src/shared/sku-color-card-skill.ts');
const skuCardSourcePreparationSource = source('src/shared/sku-card-source-preparation-plan.ts');
const manualSkuColorCardBridgeSource = source('src/renderer/services/manual-sku-color-card-bridge.ts');
const skillToolsSource = source('src/renderer/services/skill-executors/skill-tools.ts');
const chatPanelSource = source('src/renderer/components/ChatPanel.tsx');

const skuSourcePreparationSlice = skuBatchExecutorSource.slice(
    skuBatchExecutorSource.indexOf('const executeSkuCardSourcePreparationPlan = async'),
    skuBatchExecutorSource.indexOf('const executeSkuCardTemplatePreparationPlan = async')
);

const interactionOwnerResolverSource = autonomousExecutor.slice(
    autonomousExecutor.indexOf('function resolveProviderOwnedInteractionSkillIds('),
    autonomousExecutor.indexOf('function buildWorkflowMenuLines(')
);
check(
    '普通文字推荐不能在模型理解前绑定 Runtime Skill 身份',
    designAgentEngineSource.includes('buildRuntimeSelectedSkillHandoffFromUserSelection({')
        && !designAgentEngineSource.includes('buildRuntimeSelectedSkillHandoffFromRecommendation')
        && !skillRoutingSource.includes('function buildRuntimeSelectedSkillHandoffFromRecommendation')
        && skillRoutingSource.includes('bindsRuntimeIdentity: false')
);
check(
    '未绑定的 Skill 推荐不能抢占通用交互卡所有权',
    interactionOwnerResolverSource.includes('capabilitySession?.getResolution().manifestRef')
        && !interactionOwnerResolverSource.includes('skillRoutingRecommendation')
        && !interactionOwnerResolverSource.includes('recommendation.skillId')
);
check(
    'Provider 截断恢复保留真实故障但不冒充用户可见设计回复',
    !agentRuntime.includes('回复未完整，继续整理')
        && agentRuntime.includes("title: 'Provider 输出截断，后台续接'")
        && agentRuntime.includes("audience: 'debug'")
        && !agentRuntime.includes('如 sourceDirectory')
        && agentRuntime.includes('这次没有拿到完整结果')
);
const providerTruncationDebugEvent = {
    kind: 'warning',
    title: 'Provider 输出截断，后台续接',
    detail: '保留已完成内容并请求有界续接；残缺 Tool 调用不会执行。',
    status: 'running',
    audience: 'debug',
    issue: 'provider_output_truncated'
};
const providerTruncationResultSlice = agentRuntime.slice(
    agentRuntime.indexOf('private async buildProviderOutputTruncatedResult('),
    agentRuntime.indexOf('private async requestForcedFinalResponse(')
);
const guardedProviderProcessText = formatAgentProcessEventContent({
    ...providerTruncationDebugEvent,
    audience: 'user',
    visibility: 'user_process',
    status: 'error'
});
check(
    '成功的 Provider 截断续接不会进入普通 UI，连续失败仍以写入事实区分最终结果',
    buildVisibleAgentActivityFromStepEvent(providerTruncationDebugEvent) === null
        && isVisibleAgentProcessEvent(providerTruncationDebugEvent) === false
        && buildVisibleAgentActivityFromProgress('Provider 输出截断，后台续接') === null
        && buildVisibleAgentActivityFromProgress('本轮消耗 4096 token，后台续接') === null
        && guardedProviderProcessText === '当前处理条件还不完整，暂时不能确认画面结果。'
        && !/token|轮次|Provider|Harness|后台续接/u.test(guardedProviderProcessText)
        && providerTruncationResultSlice.includes('const hasPhotoshopMutation = this.hasObservedTaskMutation()')
        && providerTruncationResultSlice.includes('photoshopMutationPreserved: hasPhotoshopMutation')
        && providerTruncationResultSlice.includes('前面的 Photoshop 改动已保留')
        && providerTruncationResultSlice.includes('尚未修改 Photoshop 画面')
        && providerTruncationResultSlice.includes('success: false')
        && providerTruncationResultSlice.includes("stopReason: 'provider_output_truncated'")
        && !/token|轮次|Provider|Harness|后台续接/u.test(
            '这次没有拿到完整结果。前面的 Photoshop 改动已保留，但任务还没有完成。为避免用残缺内容继续修改画面，我已停止本轮。'
        )
        && chatPanelSource.includes('const activity = buildVisibleAgentActivityFromStepEvent(event)')
        && chatPanelSource.includes('if (event?.title && isVisibleAgentProcessEvent(event))')
        && chatPanelSource.includes('buildVisibleAgentActivityFromProgress(message, current) || current')
        && chatPanelSource.includes('const resultVisibleMessage = resolvedVisibleResult.content')
        && chatPanelSource.includes('const formattedFailureContent = formatFailureContent(')
);

const skuColorCardSources = [{
    filePath: 'C:\\fixture\\粉色.jpg',
    colorName: '粉色',
    colorNameSource: 'provided'
}, {
    filePath: 'C:\\fixture\\咖色.jpg',
    colorName: '咖色',
    colorNameSource: 'provided'
}];
const missingSkuColorCardDesign = buildSkuColorCardPlan({
    sources: skuColorCardSources,
    outputPath: 'C:\\fixture\\PSD\\SKU.psb'
});
check(
    '正常 SKU 色卡缺少 Agent 设计声明时保持零写入计划',
    missingSkuColorCardDesign.canExecute === false
        && missingSkuColorCardDesign.status === 'blocked_missing_design_spec'
        && missingSkuColorCardDesign.canvas === null
        && missingSkuColorCardDesign.cardStyle === null
        && missingSkuColorCardDesign.imagePlacement === null
        && missingSkuColorCardDesign.slots.length === 0
);
const forgedLegacySkuColorCardDesign = buildSkuColorCardPlan({
    sources: skuColorCardSources,
    outputPath: 'C:\\fixture\\PSD\\SKU.psb',
    designSpec: {
        provenance: 'explicit_legacy_profile'
    }
});
check(
    '模型参数不能伪造手工面板 legacy Profile 授权',
    forgedLegacySkuColorCardDesign.canExecute === false
        && forgedLegacySkuColorCardDesign.status === 'blocked_invalid_design_spec'
        && skuColorCardExecutorSource.includes('MANUAL_SKU_COLOR_CARD_LEGACY_PROFILE_CAPABILITY')
        && skuColorCardExecutorSource.includes('trustedCapabilities.manualLegacyProfile === MANUAL_SKU_COLOR_CARD_LEGACY_PROFILE_CAPABILITY')
        && !skuColorCardExecutorSource.includes('params.__manualPanelLegacyProfileAuthorized')
        && manualSkuColorCardBridgeSource.includes('MANUAL_SKU_COLOR_CARD_LEGACY_PROFILE_CAPABILITY')
        && !manualSkuColorCardBridgeSource.includes('__manualPanelLegacyProfileAuthorized: true')
        && skillToolsSource.includes("'__manualPanelLegacyProfileAuthorized'")
);

const authoredSkuColorCardDesignSpec = {
        provenance: 'agent_authored',
        presentationMode: 'card',
        canvasWidth: 1200,
        canvasHeight: 900,
        canvasBackground: 'transparent',
        cardWidth: 220,
        cardHeight: 320,
        cardCornerRadius: 18,
        columns: 2,
        columnGap: 56,
        rowGap: 44,
        gridAlignment: {
            horizontal: 'end',
            vertical: 'start',
            lastRow: 'center'
        },
        showIndexNumbers: false,
        cardFillColorHex: '#F4EFE8',
        labelFillColorHex: '#FFFFFF',
        labelTextColorHex: '#3A302B',
        internalLabel: {
            xRatio: 0.1,
            yRatio: 0.78,
            widthRatio: 0.8,
            heightRatio: 0.14,
            cornerRadiusToWidthRatio: 0.04,
            fontSizeToHeightRatio: 0.52
        },
        labelTypography: {
            fontName: 'Noto Sans CJK SC',
            tracking: 24,
            leadingToFontSizeRatio: 1.15,
            alignment: 'right',
            horizontalPaddingRatio: 0.1,
            verticalPaddingRatio: 0.08
        },
        imagePlacement: {
            subjectFillRatio: 0.74,
            anchor: 'bottom-center'
        }
};
const authoredSkuColorCardDesign = buildSkuColorCardPlan({
    sources: skuColorCardSources,
    outputPath: 'C:\\fixture\\PSD\\SKU.psb',
    designSpec: authoredSkuColorCardDesignSpec
});
check(
    'Agent 声明的 SKU 画布、对齐、排版、配色、主体占比与锚点原样进入计划',
    authoredSkuColorCardDesign.canExecute === true
        && authoredSkuColorCardDesign.designProvenance === 'agent_authored'
        && authoredSkuColorCardDesign.presentationMode === 'card'
        && authoredSkuColorCardDesign.canvas?.width === 1200
        && authoredSkuColorCardDesign.canvas?.backgroundColor === 'transparent'
        && authoredSkuColorCardDesign.slots[0]?.cardBounds.x === 704
        && authoredSkuColorCardDesign.slots[0]?.cardBounds.y === 0
        && authoredSkuColorCardDesign.slots[0]?.cardBounds.width === 220
        && authoredSkuColorCardDesign.cardStyle?.cornerRadius === 18
        && authoredSkuColorCardDesign.cardStyle?.fillColorHex === '#F4EFE8'
        && authoredSkuColorCardDesign.cardStyle?.labelTextColorHex === '#3A302B'
        && authoredSkuColorCardDesign.cardStyle?.labelTypography.fontName === 'Noto Sans CJK SC'
        && authoredSkuColorCardDesign.cardStyle?.labelTypography.alignment === 'right'
        && authoredSkuColorCardDesign.imagePlacement?.subjectFillRatio === 0.74
        && authoredSkuColorCardDesign.imagePlacement?.anchor === 'bottom-center'
        && authoredSkuColorCardDesign.indexReference.enabled === false
);
const runtimeSelectionReceipt = createSkuColorCardRuntimeSelectionReceipt([{
    assetId: 'asset-selected-by-agent',
    filePath: 'C:\\fixture\\DSC0001.jpg',
    relativePath: '摄影图/DSC0001.jpg'
}]);
const runtimeSelectionBinding = bindSkuColorCardRuntimeSelection([{
    assetId: 'asset-selected-by-agent',
    filePath: 'C:\\fixture\\DSC0001.jpg',
    colorName: '浅灰',
    colorNameSource: 'inferred_candidate'
}], runtimeSelectionReceipt);
check(
    'Runtime assetId 选择收据精确绑定路径，色名不能再次替 Agent 换图',
    runtimeSelectionBinding.applied === true
        && runtimeSelectionBinding.blockers.length === 0
        && runtimeSelectionBinding.sources[0]?.filePath === 'C:\\fixture\\DSC0001.jpg'
        && skuBatchExecutorSource.includes('createSkuColorCardRuntimeSelectionReceipt(')
        && skuColorCardExecutorSource.includes('runtimeSelectionBinding.applied')
        && skuColorCardExecutorSource.includes("method: 'runtime_asset_selection'")
);
const forgedRuntimeSelectionBinding = bindSkuColorCardRuntimeSelection([{
    assetId: 'asset-forged-by-model',
    filePath: 'C:\\fixture\\浅灰.jpg',
    colorName: '浅灰'
}], runtimeSelectionReceipt);
check(
    '模型参数不能伪造或改写 Runtime SKU 素材选择收据',
    forgedRuntimeSelectionBinding.applied === true
        && forgedRuntimeSelectionBinding.sources.length === 0
        && forgedRuntimeSelectionBinding.blockers.length > 0
);
const flatSkuColorCardDesign = buildSkuColorCardPlan({
    sources: skuColorCardSources,
    outputPath: 'C:\\fixture\\PSD\\SKU-flat.psb',
    designSpec: {
        ...authoredSkuColorCardDesignSpec,
        presentationMode: 'flat'
    }
});
check(
    'SKU flat/card 视觉结构由 Agent 显式声明，retouch 结果不再暗中选版式',
    flatSkuColorCardDesign.canExecute === true
        && flatSkuColorCardDesign.presentationMode === 'flat'
        && skuColorCardExecutorSource.includes("if (plan.presentationMode === 'flat')")
        && skuColorCardExecutorSource.includes("'blocked_flat_assets_not_ready'")
        && !skuColorCardExecutorSource.includes('if (isPreparedSkuRetouchSource(earlyRetouchSource))')
        && skuColorCardExecutorSource.includes('retouchedCardImageBounds')
        && !skuColorCardExecutorSource.includes('本子分支实际不可达')
        && !skuColorCardContractSource.includes('C-1183')
        && !skuColorCardContractSource.includes('C-1248')
        && skuColorCardContractSource.includes('presentationQualityCriteria')
        && skillDeclarations.includes("strParam('presentationMode'")
);
check(
    'SKU 文件名与保存边界不再绕过事实和版本安全',
    skuColorCardExecutorSource.includes("name.normalize('NFKC').toLocaleLowerCase('zh-Hans-CN')")
        && skuColorCardExecutorSource.includes("conflictPolicy: 'fail_if_exists'")
        && skuColorCardExecutorSource.includes('afterColorName')
        && skuColorCardExecutorSource.includes("'verify-flat-label-text-fit'")
        && !skuColorCardExecutorSource.includes('labelTextFitVerified: true')
);
const indexedSkuColorCardDesign = buildSkuColorCardPlan({
    sources: skuColorCardSources,
    outputPath: 'C:\\fixture\\PSD\\SKU-indexed.psb',
    designSpec: {
        ...authoredSkuColorCardDesignSpec,
        columns: 3,
        showIndexNumbers: true,
        indexStyle: {
            colorHex: '#6A5147',
            fontName: 'Noto Sans CJK SC',
            tracking: 40,
            leadingToFontSizeRatio: 1.1,
            fontSizeToCardWidthRatio: 0.18,
            xRatio: 0.5,
            yRatio: -0.2,
            alignment: 'center'
        }
    }
});
check(
    'Agent 声明的 SKU 序号样式与位置进入计划，Harness 不再写死大小与颜色',
    indexedSkuColorCardDesign.canExecute === true
        && indexedSkuColorCardDesign.indexReference.style?.colorHex === '#6A5147'
        && indexedSkuColorCardDesign.indexReference.style?.fontSizeToCardWidthRatio === 0.18
        && indexedSkuColorCardDesign.slots[0]?.cardBounds.x === 566
        && indexedSkuColorCardDesign.slots[0]?.indexText?.fontSize === 40
        && indexedSkuColorCardDesign.slots[0]?.indexText?.y === -64
);
check(
    '普通 SKU source preparation 不再写死视觉首稿',
    skuSourcePreparationSlice.includes('colorCardDesignSpec,')
        && skuSourcePreparationSlice.includes('requestedSourceAssetIds')
        && !/canvasWidth:\s*1500|canvasHeight:\s*1500|cardWidth:\s*250|cardHeight:\s*380|cardCornerRadius:\s*10/.test(skuSourcePreparationSlice)
        && skuBatchExecutorSource.includes("status: 'needs_agent_design_spec'")
        && skuBatchExecutorSource.includes('toolResults: []')
        && skuColorCardExecutorSource.includes('subjectFillRatio: plan.imagePlacement.subjectFillRatio')
        && skuColorCardExecutorSource.includes('anchor: plan.imagePlacement.anchor')
        && skuColorCardExecutorSource.includes('targetAnchor: plan.imagePlacement.anchor')
        && !/targetFit:\s*'contain',\s*layerOrder:/.test(skuColorCardExecutorSource)
        && !skuColorCardContractSource.includes('const DEFAULT_CANVAS_WIDTH')
        && skuColorCardContractSource.includes('backgroundColor: designSpec.canvasBackground')
        && skuColorCardContractSource.includes('gridAlignment: { ...designSpec.gridAlignment }')
        && skuColorCardExecutorSource.includes('fontName: plan.cardStyle.labelTypography.fontName')
        && skuColorCardExecutorSource.includes('colorHex: plan.indexReference.style.colorHex')
        && !skuColorCardExecutorSource.includes('colorCardFormatPriority')
        && !skuColorCardExecutorSource.includes('dedupedImages.push(sorted[0])')
        && skuColorCardExecutorSource.includes("status: 'needs_agent_source_selection'")
        && !skillDeclarations.includes("boolParam('colorNamesFromFilename'")
        && !skillDeclarations.includes("numParam('canvasWidth', 'stage=color-card only")
        && skuCardSourcePreparationSource.includes("status: 'ready_for_design_decision'")
        && skuCardSourcePreparationSource.includes('canRunPhotoshopWrites: false')
        && !skuCardSourcePreparationSource.includes('toolRequests')
        && !skuCardSourcePreparationSource.includes("toolName: 'createRectangle'")
        && !skuCardSourcePreparationSource.includes('right.score - left.score')
);

check(
    '内置版式配方实现已删除',
    !fs.existsSync(path.join(root, 'src/shared/layout/layout-recipes.ts'))
);
check(
    '布局引擎不再按 role 固定层级或无条件吸附文字区域',
    !layoutEngineSource.includes('const ROLE_Z')
        && !layoutEngineSource.includes('shouldSnapRegionToColumns(')
        && layoutEngineSource.includes('columnPlacement')
        && toolExecutor.includes('moveModelAuthoredLayerByStackLedger')
        && toolExecutor.includes("position: 'inside-top'")
);
const authoredRegionOrder = solveRegionLayout({
    canvas: { width: 1_000, height: 1_000 },
    regions: [
        { id: '文字在底', role: 'title', content: '标题', hAlign: 'left', bounds: { x: 0.1, y: 0.1, width: 0.3, height: 0.1 } },
        { id: '图片在中', role: 'main-image', content: 'C:/fixture/product.jpg', bounds: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 } },
        { id: '装饰在顶', role: 'decoration', content: 'C:/fixture/decor.png', bounds: { x: 0.7, y: 0.05, width: 0.2, height: 0.2 } },
        { id: '背景', role: 'background', content: '#ffffff', bounds: { x: 0, y: 0, width: 1, height: 1 } }
    ]
});
check(
    '二维正式布局按 Agent 数组顺序叠放非背景图层，背景仅作为公开机械底层例外',
    authoredRegionOrder.blocks.map((block) => block.id).join('|') === '背景|文字在底|图片在中|装饰在顶',
    JSON.stringify(authoredRegionOrder.blocks.map((block) => ({ id: block.id, z: block.z })))
);
const lateBackgroundValidation = validateModelAuthoredLayout({
    mode: 'regions',
    regions: [
        { id: '标题', role: 'title', content: '标题', hAlign: 'left', bounds: { x: 0.1, y: 0.1, width: 0.3, height: 0.1 } },
        { id: '背景', role: 'background', content: '#ffffff', bounds: { x: 0, y: 0, width: 1, height: 1 } }
    ]
});
check(
    'model_authored 背景若不是数组底层会写前失败，不由 Harness 静默重排',
    lateBackgroundValidation.valid === false
        && lateBackgroundValidation.issues.includes('regions[1].role:background_must_precede_visual_layers'),
    JSON.stringify(lateBackgroundValidation)
);
const boundsOwnedRegion = {
    id: '自由标题',
    role: 'title',
    content: '自由构图',
    hAlign: 'left',
    bounds: { x: 0.123, y: 0.15, width: 0.333, height: 0.12 }
};
const noColumnPlacement = solveRegionLayout({
    canvas: { width: 1_000, height: 1_000 },
    columns: 4,
    marginScale: 2,
    gutterScale: 2,
    regions: [boundsOwnedRegion]
});
const explicitColumnPlacement = solveRegionLayout({
    canvas: { width: 1_000, height: 1_000 },
    columns: 4,
    marginScale: 2,
    gutterScale: 2,
    regions: [{ ...boundsOwnedRegion, columnPlacement: { start: 2, span: 2 } }]
});
check(
    'columns 只建立网格；没有 columnPlacement 时 Harness 不改 Agent 的 x/width',
    noColumnPlacement.blocks[0]?.x === 123
        && noColumnPlacement.blocks[0]?.width === 333
        && explicitColumnPlacement.blocks[0]?.x !== 123
        && explicitColumnPlacement.blocks[0]?.width !== 333,
    JSON.stringify({ noColumnPlacement, explicitColumnPlacement })
);
const invalidColumnPlacement = validateModelAuthoredLayout({
    mode: 'regions',
    columns: 4,
    marginScale: 2,
    gutterScale: 2,
    regions: [{ ...boundsOwnedRegion, columnPlacement: { start: 4, span: 2 } }]
});
check(
    '显式列落位越界会在写前失败，不由执行层猜最近列',
    invalidColumnPlacement.valid === false
        && invalidColumnPlacement.issues.includes('regions[0].columnPlacement:must_fit_declared_columns'),
    JSON.stringify(invalidColumnPlacement)
);
const authoredBlockOrder = solveLayout({
    canvas: { width: 1_000, height: 1_000 },
    marginScale: 2,
    gapScale: 2,
    blocks: [
        { id: '装饰先叠', role: 'decoration', content: 'C:/fixture/decor.png', heightRatio: 0.1, widthRatio: 0.2 },
        { id: '主体后叠', role: 'main-image', content: 'C:/fixture/product.jpg', heightRatio: 0.6, widthRatio: 0.8 },
        { id: '标题最上', role: 'title', content: '标题', heightRatio: 0.1, widthRatio: 0.8, hAlign: 'left' }
    ]
});
check(
    '垂直 blocks 的非背景层序同样保持 Agent 数组顺序',
    authoredBlockOrder.blocks.map((block) => block.id).join('|') === '装饰先叠|主体后叠|标题最上'
);
const stackPlan = buildRenderLayoutStackPlan([
    { blockId: '已置入摄影主体', stackOrder: 0, layerIdsBottomToTop: [10] },
    { blockId: '实底卖点', stackOrder: 2, layerIdsBottomToTop: [20, 21] },
    { blockId: '裁切图片', stackOrder: 1, layerIdsBottomToTop: [30, 31] }
]);
check(
    'model_authored 堆叠账本同时保持区域顺序和裁切/底块原子内部关系',
    stackPlan.valid
        && stackPlan.layerIdsBottomToTop.join(',') === '10,30,31,20,21'
        && stackPlan.layerIdsTopToBottom.join(',') === '21,20,31,30,10',
    JSON.stringify(stackPlan)
);

function simulateModelAuthoredStackLedger(input) {
    const plan = buildRenderLayoutStackPlan(input.units);
    const actualLayerIdsTopToBottom = [...(input.initialLayerIdsTopToBottom || [])];
    const moveCalls = [];
    let failedMove;

    if (plan.valid) {
        for (const layerId of plan.layerIdsBottomToTop) {
            const call = {
                layerId,
                targetGroupId: input.targetGroupId,
                position: 'inside-top'
            };
            moveCalls.push(call);
            if (layerId === input.failOnLayerId) {
                failedMove = call;
                break;
            }
            const previousIndex = actualLayerIdsTopToBottom.indexOf(layerId);
            if (previousIndex >= 0) actualLayerIdsTopToBottom.splice(previousIndex, 1);
            actualLayerIdsTopToBottom.unshift(layerId);
        }
    }

    const movesCompleted = plan.valid && !failedMove;
    const readbackRequested = movesCompleted;
    const readbackLayerIdsTopToBottom = readbackRequested
        ? [...(input.readbackLayerIdsTopToBottom || actualLayerIdsTopToBottom)]
        : [];
    const orderVerified = readbackRequested
        && readbackLayerIdsTopToBottom.length === plan.layerIdsTopToBottom.length
        && readbackLayerIdsTopToBottom.every((layerId, index) => (
            layerId === plan.layerIdsTopToBottom[index]
        ));

    return {
        plan,
        moveCalls,
        failedMove,
        movesCompleted,
        readbackRequested,
        actualLayerIdsTopToBottom,
        readbackLayerIdsTopToBottom,
        orderVerified
    };
}

const stackLedgerUnits = [
    { blockId: '摄影主体', stackOrder: 0, layerIdsBottomToTop: [101] },
    { blockId: '裁切复合块', stackOrder: 1, layerIdsBottomToTop: [201, 202] },
    { blockId: '模型已拥有图层', stackOrder: 2, layerIdsBottomToTop: [301] }
];
const successfulStackLedgerRun = simulateModelAuthoredStackLedger({
    units: stackLedgerUnits,
    targetGroupId: 900,
    initialLayerIdsTopToBottom: [301]
});
check(
    'model-authored stack ledger 把复合 block 与 owned layer 合成唯一底到顶账本',
    successfulStackLedgerRun.plan.unitsBottomToTop[1]?.blockId === '裁切复合块'
        && successfulStackLedgerRun.plan.unitsBottomToTop[1]?.layerIdsBottomToTop.join(',') === '201,202'
        && successfulStackLedgerRun.plan.unitsBottomToTop[2]?.layerIdsBottomToTop.join(',') === '301'
        && successfulStackLedgerRun.plan.layerIdsBottomToTop.join(',') === '101,201,202,301',
    JSON.stringify(successfulStackLedgerRun)
);
check(
    'stack ledger 按底到顶顺序逐层 inside-top 移动后得到期望的顶到底读回',
    successfulStackLedgerRun.moveCalls.every((call) => (
        call.targetGroupId === 900 && call.position === 'inside-top'
    ))
        && successfulStackLedgerRun.moveCalls.map((call) => call.layerId).join(',') === '101,201,202,301'
        && successfulStackLedgerRun.actualLayerIdsTopToBottom.join(',') === '301,202,201,101'
        && successfulStackLedgerRun.orderVerified,
    JSON.stringify(successfulStackLedgerRun)
);

const interruptedStackLedgerRun = simulateModelAuthoredStackLedger({
    units: stackLedgerUnits,
    targetGroupId: 900,
    initialLayerIdsTopToBottom: [301],
    failOnLayerId: 202
});
check(
    'stack ledger 移动中途失败会立即停止，不继续移动 owned layer 或伪造完整读回',
    interruptedStackLedgerRun.movesCompleted === false
        && interruptedStackLedgerRun.failedMove?.layerId === 202
        && interruptedStackLedgerRun.moveCalls.map((call) => call.layerId).join(',') === '101,201,202'
        && !interruptedStackLedgerRun.moveCalls.some((call) => call.layerId === 301)
        && interruptedStackLedgerRun.readbackRequested === false
        && interruptedStackLedgerRun.orderVerified === false,
    JSON.stringify(interruptedStackLedgerRun)
);

const wrongReadbackStackLedgerRun = simulateModelAuthoredStackLedger({
    units: stackLedgerUnits,
    targetGroupId: 900,
    initialLayerIdsTopToBottom: [301],
    readbackLayerIdsTopToBottom: [301, 201, 202, 101]
});
check(
    'stack ledger 即使所有 inside-top 移动成功，读回顺序错误仍不得通过',
    wrongReadbackStackLedgerRun.movesCompleted
        && wrongReadbackStackLedgerRun.readbackRequested
        && wrongReadbackStackLedgerRun.readbackLayerIdsTopToBottom.join(',') === '301,201,202,101'
        && wrongReadbackStackLedgerRun.plan.layerIdsTopToBottom.join(',') === '301,202,201,101'
        && wrongReadbackStackLedgerRun.orderVerified === false,
    JSON.stringify(wrongReadbackStackLedgerRun)
);
check(
    'renderLayout 不再动态展开 recipe',
    !/expandLayoutRecipe|describeLayoutRecipesForModel|recipeExpansion/.test(toolExecutor)
);
check(
    '工具 schema 不再暴露固定版式 id',
    !/headline-top-left-subject-right|four-grid|closeup-caption-bottom/.test(toolSchemas)
);
check(
    '主体缩放不再包含品类、角色或意图预设表',
    !/DESIGN_PRESETS|ROLE_PRESETS|INTENT_PRESETS|DEFAULT_SMART_SCALING_PRESET/.test(scalingPolicy)
        && /presetOverride: SmartScalingPreset/.test(scalingPolicy)
);
check(
    '主图变体不再按点击/转化类型偷偷改主体尺寸或预留文案区',
    !/0\.78|0\.56|0\.22|1\.04|0\.94/.test(mainImagePlacement)
        && /使用 Agent 或上游计划显式声明的主体区域/.test(mainImagePlacement)
);
check(
    '智能布局 Skill 不再注入主体占比和居中默认',
    !/numParam\('fillRatio',[\s\S]{0,120}default:/.test(skillDeclarations)
        && !/strParam\('alignment',[\s\S]{0,120}default:/.test(skillDeclarations)
);
check(
    '参考复刻不再伪造统一阴影和描边参数',
    !/opacity:\s*28|angle:\s*120|referenceSize \* 0\.012|position:\s*'inside',/.test(referenceStyleRecipes)
        && /不使用内置阴影配方/.test(referenceStyleRecipes)
        && /不使用内置描边配方/.test(referenceStyleRecipes)
);
check(
    '参考缺项不再补固定彩色占位块或角色坐标',
    !/createSupplementalPlaceholderByRole|#BFD7EA|#C7E9B4|#E8DFF5/.test(referenceApply)
        && /未用固定坐标、颜色或占位文案补造/.test(referenceApply)
);
check(
    'composeDesign 不再把阴影标签和颜色名换成内置视觉参数',
    !/SHADOW_KINDS|NAMED_COLORS|opacity:\s*32|angle:\s*120/.test(composeSpec)
        && /完整 drop-shadow 参数/.test(composeSpec)
);
check(
    '活动 Prompt 不再注入固定栅格、字号比例或任意 batchPlay 方案',
    !/3:1\.5:1|batchPlayCommands/.test(prompts)
        && !/必须(?:使用|遵循).*8px|8px grid:/.test(prompts)
);
check(
    'agentic 主图与详情页 Manifest 不再绑定内置标准模板',
    /template_families:\s*\[\]/.test(mainImageManifest)
        && /template_families:\s*\[\]/.test(detailPageManifest)
        && !/main_image\.standard|detail_page\.standard/.test(`${mainImageManifest}\n${detailPageManifest}`)
);
check(
    '开放主体缩放缺显式占比时会失败',
    toolExecutor.includes('Harness 不再按品类套用内置占比')
        && toolExecutor.includes('Harness 不替 Agent 选择视觉重心')
);
check(
    'composeDesign 不再隐藏调用独立评审',
    !/executeToolCall\(['"]evaluateDesign['"]/.test(composeExecutor)
);
check(
    'composeDesign 不再固定轮询 Photoshop 落定',
    !/等待 Photoshop 落定/.test(composeExecutor)
);
check(
    'composeDesign 在首次 Photoshop 写入前完成视觉样式预检',
    composeExecutor.includes('resolveRenderLayoutVisualStyle')
        && composeExecutor.indexOf('resolveRenderLayoutVisualStyle({') < composeExecutor.indexOf("run('建画布'")
);
check(
    '默认正式保存使用用户可读文档名，恢复点与交付目录隔离',
    toolExecutor.includes('return `${root}\\\\${safeName}.${ext}`')
        && toolExecutor.includes('\\\\.designecho`')
        && toolExecutor.includes('countsAsDelivery: false')
        && !toolExecutor.includes('_autosave_')
);
check(
    '内部恢复点不向 Agent 暴露路径且不能写入正式目录',
    toolSchemas.includes("name: 'smartSave'")
        && !/name: 'smartSave',[\s\S]{0,400}path:\s*\{/.test(toolSchemas)
        && toolExecutor.includes("if (toolName === 'smartSave'")
        && toolExecutor.includes('normalizeRecoverySaveFormat')
        && autonomousExecutor.includes("const AGENT_INTERNAL_PROVIDER_TOOL_NAMES = new Set(['smartSave'])")
);
check(
    '设计基础能力直接包含建档与图层读回，不预载固定方法论或交付工具',
    capabilitySession.includes("'photoshop.read.getLayerHierarchy'")
        && capabilitySession.includes("'photoshop.sandbox.createDocument'")
        && !capabilitySession.includes("'knowledge.read.getDesignPrinciples'")
        && !capabilitySession.includes("'delivery.export.saveDocument'")
        && !capabilitySession.includes("'delivery.export.quickExport'")
);
check(
    'composeDesign 不用结构/几何通过冒充视觉终审并污染近期成稿记忆',
    composeExecutor.includes("reviewStatus: 'candidate_unreviewed'")
        && composeExecutor.includes('candidateFingerprint: fingerprint')
        && composeExecutor.includes('composeDesign 只生产候选，不拥有视觉终审')
        && !composeExecutor.includes("invokeMain('designWorkshop:writeRecentDesigns'")
);
check(
    '内部恢复点不能满足正式交付完成条件',
    /const DOCUMENT_SAVE_TOOLS = new Set\(\[\s*'saveDocument',\s*'quickExport'/m.test(taskCompletion)
        && !/const DOCUMENT_SAVE_TOOLS = new Set\(\[[\s\S]{0,180}'smartSave'/m.test(taskCompletion)
);
check(
    '订阅模型用 name.const 原生参数对象消除二次 JSON 编码，Tool 级修复仍同线程并累计真实用量',
    codexSubscription.includes('REPAIRABLE_STRUCTURED_OUTPUT_ERROR_CODES')
        && codexSubscription.includes('buildCodexStructuredOutputRepairInput(error)')
        && codexSubscription.includes('buildCodexDirectToolArgumentsRepairInput(')
        && codexSubscription.includes('outputSchema: buildDirectToolArgumentsOutputSchema(tool)')
        && codexSubscription.includes('buildCodexStrictOutputSchema(input.outputSchema)')
        && codexSubscription.includes('restoreCodexStrictOutputValue(wireValue, outputSchema)')
        && codexSubscription.includes('anyOf: tools.map(buildStructuredToolCallOutputSchema)')
        && codexSubscription.includes('buildCodexHostEnvelopeOutputSchema(tools)')
        && codexSubscription.includes('arguments: Record<string, unknown>')
        && codexStrictOutputSchema.includes('readRecoverableDiscriminatedObjectUnion(')
        && codexSubscription.includes('combineTokenUsage(firstUsage, repairedUsage)')
        && !codexSubscription.includes('argumentsJson')
        && !codexSubscription.includes('codex-tool-arguments-local-repair')
        && !codexSubscription.includes('JSON5.parse')
        && codexSubscription.includes('if (!isRepairableCodexStructuredOutputError(error) || signal?.aborted) throw error;')
);
check(
    '订阅桥按持续进度刷新空闲超时并保留独立总上限',
    codexSubscription.includes("notification.method.endsWith('/delta')")
        && codexSubscription.includes(
            'const accepted = this.refreshActiveTurnIdleDeadline(active, notification.method);'
        )
        && codexSubscription.includes('if (!accepted) return;')
        && codexSubscription.includes('this.scheduleActiveTurnIdleCheck(active);')
        && codexSubscription.includes('MAX_TURN_WALL_CLOCK_TIMEOUT_MS')
        && codexSubscription.includes('codex_subscription_turn_idle_timeout')
        && codexSubscription.includes('codex_subscription_turn_wall_clock_timeout')
);
check(
    '相同 content 与 text block 不会重复送入订阅模型',
    codexSubscription.includes('const seen = new Set<string>()')
        && codexSubscription.includes('if (!text || seen.has(text)) return;')
);
check(
    'Provider 失败保持结构化归因，不再被循环压成普通质量返工',
    agentRuntime.includes('rethrowKnownModelProviderFailure(this.config.modelId, error)')
        && modelProviderFailureBoundary.includes("if (providerFailure.kind !== 'unknown')")
        && autonomousExecutor.includes('shouldRetryAutonomousModelTransport({')
        && modelProviderTransportPolicy.includes("code === CODEX_SUBSCRIPTION_WALL_CLOCK_TIMEOUT) return false")
        && modelProviderTransportPolicy.includes('code === CODEX_SUBSCRIPTION_IDLE_TIMEOUT')
        && autonomousExecutor.includes("if (result.stopReason === 'error') break;")
);
check(
    '已完成成品的审美建议不会被 Harness 改写成红色自动返工失败',
    !autonomousExecutor.includes('自动调整无法安全接着进行')
);
check(
    '新成品任务不因当前正好打开旧稿就默认续做',
    !designerAutonomyPrinciples.includes('设计文件优先续做')
        && designerAutonomyPrinciples.includes('新成品请求应把旧稿作为可选参考并建立独立新稿')
        && designerAutonomyPrinciples.includes('不按文件名、分辨率排名或当前画面惯性代替看图')
);
check(
    '生产提示不再要求设计开始或首次写入前例行公开说明',
    !autonomousExecutor.includes('视觉设计开始前，用一句自然的设计语言')
        && !autonomousExecutor.includes('首次进行会改变设计结果的动作前')
        && !designerAutonomyPrinciples.includes('首次写入前，用一小段面向用户的说明')
        && !autonomousExecutor.includes("title: '设计判断准备'")
        && !autonomousExecutor.includes("title: '专业团队准备'")
);
check(
    '通用设计决策契约不再内置 SKU 路径或品类预设',
    !designerDecisionContractSource.includes('buildSkuDecisionOptions')
        && !designerDecisionContractSource.includes('通用 SKU 模板默认推进方式')
        && !designerDecisionContractSource.includes('2/3/4 双装')
);
check(
    '通用设计知识不再把候选短名单冒充对象理解',
    designMethodKnowledgeSource.includes('候选短名单只回答')
        && designArtifactKnowledgeSource.includes('候选短名单只是在一个已声明需求或素材角色下比较可用性')
        && designPrinciplesSource.includes('一次素材候选结果只证明若干图对某个已声明角色的相对适配')
        && toolSchemas.includes('one selected image is not evidence of project-wide understanding')
        && toolSchemas.includes('use context, intended audience, variant system')
);
check(
    '参考一瞥挂定方向前（2026-08-23 用户裁决），保留豁免出口且不形成强制仪式',
    designMethodKnowledgeSource.includes('是否检索 Eagle 或其他参考资源由 Agent 按信息增益判断')
        && designArtifactKnowledgeSource.includes('是否调用 Eagle 等参考工具、查什么以及何时停止由 Agent 决定')
        && designPrinciplesSource.includes('参考研究由 Agent 按信息增益决定')
        && toolSchemas.includes('no explicit reference, governed brand material or relevant project work already answers it')
        && toolSchemas.includes('optional evidence, not a fixed opening ritual')
        && !toolSchemas.includes('七步思考脚手架')
        && !toolSchemas.includes('先说明要解决的构图、色彩、字体或表达问题')
);
check(
    '回复纪律不再把 Eagle 或其他参考来源变成固定开工步骤',
    agentMessageContext.includes('参考研究由你按信息增益决定')
        && agentMessageContext.includes('不把任何参考来源变成固定开工步骤')
        && !agentMessageContext.includes('先检索 Eagle 同品类参考并真看一两张画面再定方向')
);
check(
    '隔离 Runtime 的连接事实与实际 Photoshop 调用绑定同一个 owner',
    preloadSource.includes("ipcRenderer.invoke('runtime:getMcpHostEndpoint') as Promise<string>")
        && !preloadSource.includes("from './config/network-ports'")
        && mcpHostClient.includes('fetch(await resolveMcpHostEndpoint()')
        && mcpHostClient.includes('Electron 内必须对当前 Runtime owner fail closed')
        && !mcpHostClient.includes("const MCP_HOST_ENDPOINT = 'http://127.0.0.1:8768/mcp'")
);
check(
    '详情页素材排序只生成候选，缺少 Agent / 用户选择收据不能进入 Photoshop',
    detailPageAssetRanker.includes('buildDetailAssetCandidateSet(')
        && detailPageAssetRanker.includes('findExplicitDetailAssetSelection(')
        && detailPageAssetRanker.includes('requiresModelAssetDecision: !explicitSelection')
        && detailPageAssetRanker.includes('排序第一名不是生产选定')
        && !detailPageAssetRanker.includes('selectDetailAssetCandidate(')
        && detailPageExecutor.includes('buildDetailAssetSelectionHandoffResult({')
        && detailPagePlanUtils.includes('hasValidDetailAssetSelectionReceipt(')
        && toolExecutor.includes("code: 'detail_asset_selection_receipt_required'")
        && uxpDetailPageFiller.includes("'asset_selection_required'")
        && uxpDetailPageFiller.includes('hasValidAssetSelectionReceipt(item, screenId)')
);
const detailCandidateSetId = 'detail-candidates:7:42:fixture';
const detailAssetCandidates = [
    {
        candidateSetId: detailCandidateSetId,
        candidateId: `${detailCandidateSetId}:1`,
        imagePath: 'C:/fixture/first.jpg'
    },
    {
        candidateSetId: detailCandidateSetId,
        candidateId: `${detailCandidateSetId}:2`,
        imagePath: 'C:/fixture/second.jpg'
    }
];
const explicitlySelectedSecondDetailAsset = {
    layerId: 42,
    layerName: '商品图片区',
    imagePath: 'C:/fixture/second.jpg',
    fillMode: 'contain',
    assetType: 'product',
    assetCandidates: detailAssetCandidates,
    selectionReceipt: {
        version: 'detail-asset-selection-receipt/v0',
        screenId: 7,
        placeholderLayerId: 42,
        candidateSetId: detailCandidateSetId,
        candidateId: `${detailCandidateSetId}:2`,
        selectedAssetPath: 'C:/fixture/second.jpg',
        selectedBy: 'agent',
        decisionId: 'agent-choice-second'
    }
};
check(
    '详情页 Agent 明确选择第二候选时，Harness 尊重该选择而不是改回规则第一名',
    hasValidDetailAssetSelectionReceipt(explicitlySelectedSecondDetailAsset, 7)
        && resolveDetailImageExecutionDeferral(explicitlySelectedSecondDetailAsset, 7) === null
        && !detailPageAssetRanker.includes('candidate.score >= 0.55\n                    && assetUsageDecision.automaticPlacementEligible'),
    JSON.stringify(explicitlySelectedSecondDetailAsset)
);
const forgedDetailAssetPath = {
    ...explicitlySelectedSecondDetailAsset,
    imagePath: 'C:/fixture/unlisted.jpg'
};
check(
    '详情页选择收据不能被换路径、旧屏或候选集外素材复用',
    hasValidDetailAssetSelectionReceipt(forgedDetailAssetPath, 7) === false
        && hasValidDetailAssetSelectionReceipt(explicitlySelectedSecondDetailAsset, 8) === false
        && resolveDetailImageExecutionDeferral(forgedDetailAssetPath, 7)?.code === 'asset_selection_required'
);
const multiSlotScreen = {
    id: 17,
    name: '多图片区稳定候选测试',
    type: 'PRODUCT',
    copyPlaceholders: [],
    imagePlaceholders: [101, 102, 103].map((layerId) => ({
        layerId,
        layerName: `图片区 ${layerId}`,
        bounds: { left: 0, top: 0, right: 320, bottom: 320 }
    }))
};
const multiSlotAssets = ['a', 'b', 'c'].map((name, index) => ({
    path: `C:/fixture/detail-${name}.jpg`,
    type: 'model',
    width: 1_200,
    height: 1_200,
    sizeBytes: 10_000 + index,
    modifiedTimeMs: 1_700_000_000_000 + index,
    visionSignal: {
        visualObserved: true,
        assetNature: 'raw_photo',
        shotType: 'on_model',
        backgroundType: 'scene'
    }
}));
const multiSlotBaseDecision = {
    screenId: 17,
    screenName: multiSlotScreen.name,
    screenRole: 'hero',
    mainMessage: '展示商品',
    supportingPoints: [],
    copyStrategy: 'none',
    imageStrategy: 'hero',
    visualPriority: 'image-first'
};
const multiSlotBasePlan = {
    ...multiSlotBaseDecision,
    decisionSource: 'agent',
    requiresModelDecision: false,
    confidence: 1,
    agentDecision: { ...multiSlotBaseDecision }
};
const firstMultiSlotMatch = await matchDetailPageContentPlans({
    screens: [multiSlotScreen],
    projectAssets: { images: multiSlotAssets },
    screenPlans: [multiSlotBasePlan],
    aiCopyGeneration: false
});
const firstMultiSlotImages = firstMultiSlotMatch.plans[0]?.images || [];
const imageSelections = firstMultiSlotImages.map((image, index) => {
    const candidates = image.assetCandidates || [];
    const selected = candidates[(index + 1) % candidates.length];
    return {
        placeholderLayerId: image.layerId,
        candidateSetId: selected.candidateSetId,
        candidateId: selected.candidateId,
        imagePath: selected.imagePath,
        decisionId: `agent-multi-slot-${image.layerId}`,
        rationale: '按各图片区叙事职责一次性完成选择'
    };
});
const secondMultiSlotMatch = await matchDetailPageContentPlans({
    screens: [multiSlotScreen],
    projectAssets: { images: multiSlotAssets },
    screenPlans: [{
        ...multiSlotBasePlan,
        agentDecision: {
            ...multiSlotBaseDecision,
            imageSelections
        }
    }],
    aiCopyGeneration: false
});
const secondMultiSlotImages = secondMultiSlotMatch.plans[0]?.images || [];
check(
    '详情页 3 个图片区首轮签发稳定候选，第二轮一次提交全部选择后全部晋升',
    firstMultiSlotImages.length === 3
        && imageSelections.length === 3
        && secondMultiSlotImages.length === 3
        && secondMultiSlotImages.every((image, index) => (
            image.requiresModelAssetDecision === false
            && image.executionDeferred === false
            && image.imagePath === imageSelections[index].imagePath
            && image.selectionReceipt?.candidateSetId === imageSelections[index].candidateSetId
        ))
        && secondMultiSlotMatch.plans.every((plan) => (
            !(plan.images || []).some((image) => image.requiresModelAssetDecision === true)
        )),
    JSON.stringify({ imageSelections, secondMultiSlotImages })
);
check(
    '主图风格策略不再把项目扫描列表第一项冒充已选素材',
    mainImageProjectStyleStrategy.includes('项目素材存在不等于已经选定')
        && !mainImageProjectStyleStrategy.includes('return normalizeAssets(input.projectAssets)[0]')
);
check(
    'SKU 模板以 agentic 执行并且普通 handoff 不注入固定参考顺序或版式数值',
    skuTemplateManifest.includes("execution_model: 'agentic'")
        && skuTemplateDesignLoop.includes('input.includeMechanicalLayoutCandidate !== true')
        && skuTemplateDesignLoop.includes('顺序和工具由你决定')
        && skuTemplateDesignLoop.includes('Harness 不提供默认版式数值')
        && !skuTemplateDesignLoop.includes('先找现成再新建：')
        && !skuTemplateDesignLoop.includes('项目模板目录 → Eagle')
);
check(
    '图片 contain/cover 的验收框来自 Agent 选择的 fit 与真实宽高比，不强迫填满占位框',
    uxpTemplateTool.includes('let plannedRect = destinationRect;')
        && uxpTemplateTool.includes('plannedRect = {\n                        left: desiredLeft,')
        && !uxpTemplateTool.includes(': transformVisibleRect || targetBounds;')
);
check(
    '思考步骤左侧缩进计入可用宽度，不再固定横向溢出 4px',
    /\.thinking-steps\s*\{[\s\S]*?width:\s*auto;[\s\S]*?inline-size:\s*auto;/.test(messageRendererCss)
        && !/\.thinking-steps\s*\{[\s\S]*?width:\s*100%;[\s\S]*?margin-left:\s*4px;/.test(messageRendererCss)
);
check(
    '失败熔断只累计相同原因，不再按工具名误杀逐步修正',
    failureBreaker.includes('areEquivalentToolFailureReasons')
        && agentRuntime.includes('areEquivalentToolFailureReasons(this.lastToolFailureReasonByName.get(name), failureReason) ? failures + 1 : 1')
);
check(
    '摄影优先的纯图片设计可只整理既有图层，不逼 Agent 虚构文字区域',
    toolExecutor.includes('const ownedLayerOnlyMode = specBlocks.length === 0')
        && toolExecutor.includes('if (specBlocks.length === 0 && !ownedLayerOnlyMode)')
        && toolExecutor.includes('if (ownedLayerOnlyMode)')
        && toolExecutor.includes('createdLayerIds.push(ownedLayer.layerId)')
        && toolExecutor.includes('requiresVisualReview: retainedCreatedLayerIds.length > 0')
        && composeExecutor.includes('layoutRendered: steps.some((item) => item.ok && item.tool === \'renderLayout\')')
);
check(
    'composeDesign 新建文档按真实模式与部分成功回执记账',
    taskCompletion.includes("if (documentMode !== 'new') return false;")
        && taskCompletion.includes('item.result?.data?.createdDocument === true')
        && taskCompletion.includes('timeline.entries[index]?.photoshopMutationObserved === true')
        && composeExecutor.includes('...latestMutationEvidence')
);
const placePathTransportBlock = toolExecutor.slice(
    toolExecutor.indexOf('// 项目内显式路径直接交给 UXP 创建会话 token'),
    toolExecutor.indexOf('// replaceLayerContent 预处理')
);
check(
    '项目图片路径不再转成超大 Base64 文本帧，未知置入只做读回结算',
    placePathTransportBlock.includes('sourcePath: finalParams.sourcePath || resolvedFilePath')
        && !placePathTransportBlock.includes('readImageBase64')
        && toolExecutor.includes("if (toolName === 'placeImage') {")
        && toolExecutor.includes('captureAcceptanceAfterUnknownOperation')
        && toolExecutor.includes('photoshop_place_image_reconciled_applied')
);
check(
    '用户界面不再承诺一次成稿或替 Agent 宣布固定检查步骤',
    !source('src/renderer/services/tool-display-info.ts').includes("composeDesign: { name: '一次成稿'")
        && source('src/renderer/services/tool-display-info.ts').includes("composeDesign: { name: '制作首稿'")
        && !source('src/renderer/services/agent-visible-feedback.ts').includes('正在检查当前项目与 Photoshop 状态')
);
check(
    '视觉观察卡不再提供固定详情页结构草案',
    !/VIEW_STRUCTURE_SKELETON|structure-only\.skeleton/.test(observationCard)
        && !fs.existsSync(path.join(root, 'src/shared/agent-runtime-v5/manifests/detail-page.structure-preset.ts'))
);

const { resolveRenderLayoutVisualStyle } = require(path.join(root, 'src/shared/layout/render-layout-style.ts'));
const { buildAgentToolExecutionPreflight } = require(path.join(root, 'src/shared/agent-tool-execution-preflight.ts'));
const { sanitizeUserVisibleDiagnosticText } = require(path.join(root, 'src/shared/chat-response-cleaner.ts'));
const { getDefaultAgentTools } = require(path.join(root, 'src/renderer/services/agent-runtime/tool-schemas.ts'));
const { areEquivalentToolFailureReasons } = require(path.join(root, 'src/renderer/services/agent-runtime/tool-failure-breaker.ts'));
const { classifyPlaceImageOperationReconciliation } = require(path.join(root, 'src/shared/place-image-operation-reconciliation.ts'));
const {
    decideQualityAwareReflexionReentry,
    evaluateCompletedReflexionWriteFreshness,
    evaluateReflexionReviewProvenance
} = require(path.join(root, 'src/shared/reflexion-reentry-policy.ts'));
const {
    DESIGN_ASSERTIONS,
    buildVlmJudgeContextMessage,
    scoreDesignAssertions
} = require(path.join(root, 'src/shared/design-quality-assertion.ts'));
const { diversifyAssetRecommendationShortlist } = require(path.join(root, 'src/shared/asset-recommendation-shortlist.ts'));
const { selectMainImageAssetCandidate } = require(path.join(root, 'src/shared/main-image-asset-selection.ts'));
const { buildAgentCapabilityBaseline, createAgentCapabilitySession } = require(path.join(root, 'src/renderer/services/agent-runtime/capability-session.ts'));
const { buildDesignerAgentDecisionContract } = require(path.join(root, 'src/shared/designer-agent-decision-contract.ts'));
const {
    DESIGN_ART_DIRECTION_KNOWLEDGE_ID,
    DESIGN_CONTENT_STRATEGY_KNOWLEDGE_ID,
    buildDesignMethodKnowledgeContext
} = require(path.join(root, 'src/shared/agent-runtime-v5/design-method-knowledge.ts'));
const generalDesignMethodContext = buildDesignMethodKnowledgeContext({
    knowledgeRefs: [
        DESIGN_CONTENT_STRATEGY_KNOWLEDGE_ID,
        DESIGN_ART_DIRECTION_KNOWLEDGE_ID
    ],
    manifestSkillId: 'design.general'
});
check(
    '计划中立的通用方法上下文会把对象理解与参考信息增益交给模型',
    generalDesignMethodContext.issues.length === 0
        && generalDesignMethodContext.boundaries.advisoryOnly === true
        && generalDesignMethodContext.boundaries.grantsPermission === false
        && generalDesignMethodContext.content.includes('候选短名单只回答')
        && generalDesignMethodContext.content.includes('是否检索 Eagle 或其他参考资源由 Agent 按信息增益判断')
        && generalDesignMethodContext.content.includes('无需按固定格式公开'),
    JSON.stringify(generalDesignMethodContext)
);
const defaultAgentTools = getDefaultAgentTools();
const recommendAssetsDescription = defaultAgentTools.find((tool) => tool.name === 'recommendAssets')?.description || '';
const searchEagleReferencesDescription = defaultAgentTools.find((tool) => tool.name === 'searchEagleReferences')?.description || '';
check(
    '素材候选与 Eagle 工具各自保留模型所有的判断边界',
    recommendAssetsDescription.includes('one selected image is not evidence of project-wide understanding')
        && recommendAssetsDescription.includes('numbered candidate sheet to the main Agent')
        && recommendAssetsDescription.includes('by expected information gain')
        && searchEagleReferencesDescription.includes('A search hit is not visual understanding')
        && searchEagleReferencesDescription.includes('optional evidence, not a fixed opening ritual'),
    JSON.stringify({ recommendAssetsDescription, searchEagleReferencesDescription })
);
check(
    'recommendAssets 把同一候选联系表交给主 Agent，最终短名单保持来源覆盖但不替模型选赢家',
    resourceManagerSource.includes('sheet?: ProjectContactSheetOverviewResult[\'sheet\']')
        && resourceManagerSource.includes('agentSelectsFinalAsset: true')
        && resourceManagerSource.includes("visualConsumptionOwner?: 'calling_agent'")
        && resourceManagerSource.includes("if (visualConsumptionOwner !== 'calling_agent')")
        && resourceManagerSource.includes("...(visualConsumptionOwner === 'calling_agent' && comparisonSheet")
        && resourceManagerSource.includes('recommendations: modelVisibleRecommendations')
        && resourceManagerSource.includes('diversifyAssetRecommendationShortlist(')
        && toolExecutor.includes("visualConsumptionOwner: 'calling_agent' as const")
        && toolExecutor.includes('内部模型调用为 0')
        && toolResultSanitizerSource.includes("'sheet'")
        && !resourceManagerSource.includes('selectedAsset: modelVisibleRecommendations[0]')
);
check(
    '素材扫描缓存覆盖全部行为参数，候选编号只表示身份而非排名',
    resourceManagerSource.includes('`${targetPath}:${recursive}:${includeDesignFiles}:${maxDepth}:${generateThumbnails}`')
        && resourceManagerSource.includes('编号只用于绑定图片身份，不表示推荐顺序、排名或优先级')
        && recommendAssetsDescription.includes('A01/A02 are identity labels only, never rank or priority')
);
const liftedContactSheetImages = extractImagesFromToolResult({
    success: true,
    sheet: {
        imageData: 'A'.repeat(600),
        mediaType: 'image/jpeg',
        width: 960,
        height: 720
    }
}, 3);
check(
    '项目总览观察只在 Agent 调用边界把 sheet 交给当前多模态模型，避免 Tool 内重复看图',
    toolExecutor.includes("options.visualConsumptionOwner === 'calling_agent'")
        && toolExecutor.includes('const contactSheet = await designEcho.createProjectContactSheetOverview?.({')
        && toolExecutor.includes('...(presentationSheet ? { sheet: presentationSheet } : {})')
        && toolExecutor.includes("owner: 'calling_agent'")
        && liftedContactSheetImages.length === 1
        && liftedContactSheetImages[0].mediaType === 'image/jpeg',
    JSON.stringify(liftedContactSheetImages.map((item) => ({ mediaType: item.mediaType, resultPath: item.resultPath })))
);
check(
    'placeImage 只执行 Agent 明确选择的来源，不能在工具内部把推荐 Top1 变成设计决定',
    toolSchemas.includes('This execution tool never scans, ranks, or chooses project assets')
        && !toolSchemas.includes("autoSelect: { type: 'boolean', description: 'true 时按 requirement/designRole 自动匹配候选置入")
        && toolExecutor.includes('function resolveExplicitPlaceImageSource')
        && toolExecutor.includes('__placeImageSourceBlocked: true')
        && toolExecutor.includes("nextTool: 'recommendAssets'")
        && !toolExecutor.includes('autoResolvePlaceImageSource')
        && !toolExecutor.includes('filePath: topCandidate.path')
);
check(
    '项目总览在截断前按角色和桶内跨度稳定抽样，不再把目录 first-N 当成重要性排序',
    toolExecutor.includes('const uniqueCandidates = selectDiverseProjectVisualCandidates(')
        && toolExecutor.includes('const images = selectDiverseProjectVisualCandidates(uniqueCandidates, maxImages)')
        && toolExecutor.includes('candidateUniverseCount: uniqueCandidates.length')
        && projectVisualSamplingSource.includes('doesNotRank: true')
        && projectVisualSamplingSource.includes('doesNotSelectWinner: true')
        && !/filter\(\(file: any\) => file\?\.type === 'image'[\s\S]{0,160}\.slice\(0, params\.maxImages \|\| 40\)/.test(toolExecutor)
);
const heuristicMainImageSelection = selectMainImageAssetCandidate({
    userText: '帮我做一张主图',
    projectAssets: [
        { path: 'D:/project/平铺细节/A01.jpg', role: 'raw-product-still' },
        { path: 'D:/project/模特场景/B01.jpg', role: 'raw-model-wear' }
    ]
});
const explicitMainImageSelection = selectMainImageAssetCandidate({
    userText: '用我选中的图片做主图',
    selectedAsset: { path: 'D:/project/模特场景/B01.jpg', role: 'selected-project-image' },
    projectAssets: [{ path: 'D:/project/平铺细节/A01.jpg', role: 'raw-product-still' }]
});
const currentDocumentMainImageSelection = selectMainImageAssetCandidate({
    userText: '做一张新主图',
    currentDocument: { name: '旧稿.psd', path: 'D:/project/旧稿.psd' }
});
check(
    '主图 Skill 不再把规则第一名或当前旧文档冒充 Agent 选图，明确选择仍可直接承接',
    heuristicMainImageSelection.requiresModelAssetDecision === true
        && heuristicMainImageSelection.selectedAsset === undefined
        && heuristicMainImageSelection.readiness === 'needs_context'
        && heuristicMainImageSelection.preflightGate === 'needs_input'
        && heuristicMainImageSelection.candidates.length === 2
        && currentDocumentMainImageSelection.requiresModelAssetDecision === true
        && currentDocumentMainImageSelection.selectedAsset === undefined
        && currentDocumentMainImageSelection.selectionMode === 'active-document-fallback'
        && currentDocumentMainImageSelection.readiness === 'needs_context'
        && currentDocumentMainImageSelection.preflightGate === 'needs_input'
        && explicitMainImageSelection.selectedAsset?.path.endsWith('/B01.jpg')
        && explicitMainImageSelection.requiresModelAssetDecision === false,
    JSON.stringify({ heuristicMainImageSelection, currentDocumentMainImageSelection, explicitMainImageSelection })
);
const composeDesignSchema = defaultAgentTools.find((tool) => tool.name === 'composeDesign')?.inputSchema;
const composeDesignProperties = composeDesignSchema?.properties || {};
const composeRegionSchema = composeDesignProperties.layout?.properties?.regions?.items;
const unstructuredDecisionSupport = buildDesignerAgentDecisionContract({
    userTask: '用项目摄影图做一张新的视觉设计。',
    scenario: 'general-design'
});
const partialDecisionSupport = buildDesignerAgentDecisionContract({
    userTask: '用项目摄影图做一张新的视觉设计。',
    scenario: 'general-design',
    agentDecision: {
        source: 'model-agent',
        designGoal: '让摄影主体成为第一视觉',
        hierarchy: {
            primarySubject: '摄影主体'
        }
    }
});
check(
    '缺少预填设计表或项目视觉缓存不再构成自主执行门禁',
    unstructuredDecisionSupport.status === 'ready'
        && unstructuredDecisionSupport.blockers.length === 0
        && unstructuredDecisionSupport.publicObservationGoals.length === 0
        && partialDecisionSupport.status === 'ready'
        && partialDecisionSupport.blockers.length === 0
        && partialDecisionSupport.publicDesignIntent.includes('让摄影主体成为第一视觉')
        && !partialDecisionSupport.promptSection.includes('先补齐设计判断')
        && !partialDecisionSupport.promptSection.includes('工具阶段和验收标准'),
    JSON.stringify(partialDecisionSupport)
);
check(
    '移除准备门禁后仍保留目标、revision、权限与写后必要读回边界',
    partialDecisionSupport.toolUseGuidance.some((item) => item.includes('目标文档') && item.includes('revision'))
        && partialDecisionSupport.toolUseGuidance.some((item) => item.includes('权限') && item.includes('写入目标'))
        && partialDecisionSupport.toolUseGuidance.some((item) => item.includes('画面修改后') && item.includes('必要结构或画面读回'))
);
check(
    'composeDesign 模型说明书覆盖执行器真实嵌套必填项',
    ['width', 'height'].every((key) => composeDesignProperties.canvas?.required?.includes(key))
        && composeDesignProperties.subject?.oneOf?.some((branch) => (
            ['treatment', 'shadow'].every((key) => branch.required?.includes(key))
                && branch.properties?.treatment?.enum?.includes('photo')
                && !branch.required?.includes('fillRatio')
        ))
        && composeDesignProperties.subject?.oneOf?.some((branch) => ['treatment', 'shadow', 'cutout'].every((key) => branch.required?.includes(key)))
        && ['mode', 'regions', 'groupName', 'visualStyle'].every((key) => composeDesignProperties.layout?.required?.includes(key))
        && ['id', 'role', 'content', 'bounds'].every((key) => composeRegionSchema?.required?.includes(key))
        && ['x', 'y', 'width', 'height'].every((key) => composeRegionSchema?.properties?.bounds?.required?.includes(key))
        && ['backgroundHex', 'textHex'].every((key) => composeDesignProperties.palette?.required?.includes(key))
        && ['angle', 'purpose', 'claim', 'materials', 'structure']
            .every((key) => composeDesignProperties.rationale?.properties?.[key]?.type === 'string')
        && /只有需要精确控制商品主体占比时才填写 fillRatio/.test(composeDesignProperties.subject?.properties?.treatment?.description || '')
        && /声明后执行前必须取得可靠主体框/.test(composeDesignProperties.subject?.properties?.fillRatio?.description || ''),
    JSON.stringify(composeDesignSchema)
);
check(
    'composeDesign 把设计意图带入候选收据，并区分另建候选与当前文档修订',
    /进入收据与候选比较/.test(composeDesignProperties.rationale?.description || '')
        && /mode=new 会另建候选/.test(composeDesignProperties.document?.properties?.name?.description || '')
        && /另建文档产生独立候选/.test(defaultAgentTools.find((tool) => tool.name === 'composeDesign')?.description || '')
        && composeExecutor.includes("version: 'compose-design-artifact-facts/v1'")
        && composeExecutor.includes("code: 'candidate_structural_reduction_not_compared'")
        && composeExecutor.includes("closureKind: 'comparison'")
        && taskCompletion.includes("entry.name === 'renderLayout' || entry.name === 'composeDesign'")
        && taskCompletion.includes("entry.name === 'evaluateDesign'")
        && taskCompletion.includes("entry.result?.evaluationAuthority === 'advisory_visual_critique'"),
    JSON.stringify(composeDesignProperties.document)
);
check(
    'composeDesign 把 regions 暴露为可重复的多视觉元素，而不是单素材固定槽位',
    composeDesignProperties.layout?.properties?.regions?.type === 'array'
        && composeDesignProperties.layout?.properties?.regions?.maxItems === undefined
        && composeDesignProperties.layout?.properties?.regions?.uniqueItems !== true
        && composeRegionSchema?.properties?.role?.enum?.includes('main-image')
        && composeRegionSchema?.properties?.imagePlacement?.type === 'object'
        && /从下到上/.test(composeDesignProperties.layout?.properties?.regions?.description || '')
        && /不限制 regions/.test(composeDesignProperties.subject?.description || ''),
    JSON.stringify(composeDesignProperties.layout?.properties?.regions)
);
check(
    'composeDesign 要求模型给用户可读语义图层名，不由 Harness 生成实现标识',
    /用户可读/.test(composeRegionSchema?.properties?.id?.description || '')
        && /headline/.test(composeRegionSchema?.properties?.id?.description || '')
        && /Harness 不会代为改名/.test(composeRegionSchema?.properties?.id?.description || '')
        && /IMPLEMENTATION_REGION_ID/.test(composeSpec)
        && composeExecutor.includes('const photoLayerName = String(spec.layout.regions[primarySubjectRegionIndex]!.id).trim()')
        && composeExecutor.includes('name: photoLayerName')
        && !composeExecutor.includes("`主视觉·${sourceStem || '摄影素材'}`"),
    composeRegionSchema?.properties?.id?.description || ''
);
check(
    '摄影主素材只消费自己的定位区域，其他独立 main-image 不再被整批过滤',
    composeExecutor.includes('index !== primarySubjectRegionIndex')
        && !composeExecutor.includes("renderRegions.filter((region) => region.role !== 'main-image')")
        && composeExecutor.includes('const regionSources = spec.layout.regions'),
    composeExecutor.slice(composeExecutor.indexOf('const renderRegions'), composeExecutor.indexOf('const renderLayoutParams'))
);
check(
    '不同校验问题代表修正进展，相同问题才计入重复失败',
    areEquivalentToolFailureReasons('缺少阴影', '缺少主体占比') === false
        && areEquivalentToolFailureReasons('缺少阴影', '  缺少阴影  ') === true
);
check(
    '设计参数校验不会把工具名与字段路径直接展示给用户',
    sanitizeUserVisibleDiagnosticText('composeDesign 设计稿不完整：layout.regions[2]：需要 role 与 content')
        === '设计方案还不完整：排版方案中的第 3 个区域还没有说明用途和内容'
);
const completedAestheticAssertions = DESIGN_ASSERTIONS
    .filter((assertion) => assertion.method === 'vlm_judge')
    .slice(0, 2);
const completedAestheticScorecard = scoreDesignAssertions(
    completedAestheticAssertions.map((assertion) => ({
        id: assertion.id,
        status: 'pass',
        score: 0.96,
        confidence: 0.95,
        reason: '当前版本事实交付完成，但仍有一条可靠定向观察。'
    })),
    {
        assertions: completedAestheticAssertions,
        passThreshold: 85,
        minCoverage: 0.8
    }
);
const completedAestheticDecision = decideQualityAwareReflexionReentry({
    handoff: {
        status: 'reflexion_required',
        sourceOwner: 'R5',
        targetStage: 'R4',
        trigger: 'completed_aesthetic_improvement',
        reviewBinding: {
            documentId: 23,
            historyStateId: 45,
            observationKeys: ['observation:hero']
        },
        issueConstraints: [{
            issueId: 'focus-1',
            description: '陪体略抢眼',
            expectedFix: '由 Agent 判断如何收弱陪体并保留主体',
            observationKey: 'observation:hero'
        }],
        failureAnalysis: ['陪体略抢眼'],
        strategyAdjustments: ['泛化策略不得进入 completed handoff-only'],
        nextRoundConstraints: ['泛化 warning 不得重复进入 completed handoff-only']
    },
    priorReentryCount: 0,
    scorecardHistory: [completedAestheticScorecard],
    stopReason: 'final_response',
    constraintMode: 'handoff_only'
});
check(
    '已完成版本的可靠审美观察只唤醒 Agent 一次，不由 Harness 选择或扩大修改内容',
    completedAestheticDecision.shouldReenter === true
        && completedAestheticDecision.reason === 'reentry'
        && completedAestheticDecision.injectedConstraints.length === 1
        && completedAestheticDecision.injectedConstraints[0]
            === '问题 focus-1；陪体略抢眼；对应修法：由 Agent 判断如何收弱陪体并保留主体',
    JSON.stringify(completedAestheticDecision)
);
const completedAestheticHandoff = {
    status: 'reflexion_required',
    sourceOwner: 'R5',
    targetStage: 'R4',
    trigger: 'completed_aesthetic_improvement',
    reviewBinding: {
        documentId: 23,
        historyStateId: 45,
        observationKeys: ['observation:hero']
    },
    issueConstraints: [{
        issueId: 'focus-1',
        description: '陪体略抢眼',
        expectedFix: '由 Agent 判断如何收弱陪体并保留主体',
        observationKey: 'observation:hero'
    }]
};
const trustedReviewProvenance = evaluateReflexionReviewProvenance({
    handoff: completedAestheticHandoff,
    artifact: {
        historyStateRef: { documentId: 23, historyStateId: 45 },
        observationKeys: ['observation:hero']
    }
});
const forgedReviewProvenance = evaluateReflexionReviewProvenance({
    handoff: completedAestheticHandoff,
    artifact: {
        historyStateRef: { documentId: 23, historyStateId: 46 },
        observationKeys: ['observation:hero']
    }
});
check(
    '完成态审美反馈只接受与可信 ReviewSet 完全一致的版本来源',
    trustedReviewProvenance.valid === true
        && trustedReviewProvenance.status === 'match'
        && forgedReviewProvenance.valid === false
        && forgedReviewProvenance.status === 'revision_mismatch'
);
const unboundCompletedAestheticDecision = decideQualityAwareReflexionReentry({
    handoff: {
        ...completedAestheticHandoff,
        reviewBinding: undefined
    },
    priorReentryCount: 0,
    scorecardHistory: [completedAestheticScorecard],
    stopReason: 'final_response',
    constraintMode: 'handoff_only'
});
check(
    '缺少结构化版本绑定的完成态反馈不能靠描述文字触发返工',
    unboundCompletedAestheticDecision.shouldReenter === false
        && unboundCompletedAestheticDecision.reason === 'no_actionable_constraints'
);
const sameRevisionFirstWrite = evaluateCompletedReflexionWriteFreshness({
    handoff: completedAestheticHandoff,
    executionKind: 'photoshop_write',
    hasGenerationMutation: false,
    targetRevision: { documentId: 23, historyStateId: 45 }
});
const staleRevisionFirstWrite = evaluateCompletedReflexionWriteFreshness({
    handoff: completedAestheticHandoff,
    executionKind: 'photoshop_write',
    hasGenerationMutation: false,
    targetRevision: { documentId: 23, historyStateId: 46 }
});
const reobservedRevisionFirstWrite = evaluateCompletedReflexionWriteFreshness({
    handoff: completedAestheticHandoff,
    executionKind: 'photoshop_write',
    hasGenerationMutation: false,
    targetRevision: { documentId: 23, historyStateId: 46 },
    currentVisualReview: {
        historyStateRef: { documentId: 23, historyStateId: 46 },
        observationKeys: ['observation:current'],
        fullyReviewed: true
    }
});
const subsequentGenerationWrite = evaluateCompletedReflexionWriteFreshness({
    handoff: completedAestheticHandoff,
    executionKind: 'photoshop_write',
    hasGenerationMutation: true,
    targetRevision: { documentId: 23, historyStateId: 46 }
});
check(
    '旧画面反馈只约束下一代第一项写入，版本变化后由 Agent 完整重看即可重新判断',
    sameRevisionFirstWrite.allowed === true
        && staleRevisionFirstWrite.allowed === false
        && staleRevisionFirstWrite.status === 'current_revision_observation_required'
        && reobservedRevisionFirstWrite.allowed === true
        && reobservedRevisionFirstWrite.status === 'current_revision_reobserved'
        && subsequentGenerationWrite.allowed === true
        && subsequentGenerationWrite.status === 'subsequent_generation_write'
);
const implicitBriefJudgeContext = buildVlmJudgeContextMessage({
    task: '帮我用项目里的素材做一张主图。',
    brief: ''
});
check(
    '缺少结构化 Brief 时只按用户原文评审，不把未要求信息判成缺项',
    implicitBriefJudgeContext.includes('用户未明确要求的信息、文案、渠道或尺寸不是缺失项')
        && implicitBriefJudgeContext.includes('帮我用项目里的素材做一张主图')
);
function acceptanceLayer(id, name, kind) {
    return {
        id,
        name,
        kind,
        visible: true,
        locked: false,
        depth: 0,
        index: id,
        parentId: null,
        parentName: null,
        path: name,
        selected: false,
        bounds: { left: 0, top: 0, right: 800, bottom: 800, width: 800, height: 800 }
    };
}
function acceptanceSnapshot(documentId, historyStateId, layers) {
    return {
        success: true,
        hasDocument: true,
        document: { id: documentId, name: '置入读回测试', width: 800, height: 800 },
        historyStateRef: { documentId, historyStateId },
        layers,
        selectedLayerIds: [],
        summary: {
            totalLayers: layers.length,
            selectedLayers: 0,
            hiddenLayers: 0,
            lockedLayers: 0,
            textLayers: 0,
            groupLayers: 0,
            smartObjectLayers: layers.filter((layer) => layer.kind === 'smartObject').length,
            shapeLayers: 0,
            pixelLayers: layers.filter((layer) => layer.kind === 'pixel').length,
            truncated: false
        },
        warnings: []
    };
}
const beforePlaceImage = acceptanceSnapshot(41, 100, [acceptanceLayer(1, '背景', 'pixel')]);
const afterPlaceImage = acceptanceSnapshot(41, 103, [
    acceptanceLayer(2, '商品摄影', 'smartObject'),
    acceptanceLayer(1, '背景', 'pixel')
]);
const appliedPlaceImage = classifyPlaceImageOperationReconciliation({
    before: beforePlaceImage,
    after: afterPlaceImage
});
const unchangedPlaceImage = classifyPlaceImageOperationReconciliation({
    before: beforePlaceImage,
    after: beforePlaceImage
});
const ambiguousPlaceImage = classifyPlaceImageOperationReconciliation({
    before: beforePlaceImage,
    after: acceptanceSnapshot(41, 104, [
        acceptanceLayer(3, '商品摄影 B', 'smartObject'),
        acceptanceLayer(2, '商品摄影 A', 'smartObject'),
        acceptanceLayer(1, '背景', 'pixel')
    ])
});
check(
    '未知 placeImage 只在同文档唯一新增图片层时结算成功，不会盲目重放',
    appliedPlaceImage.classification === 'applied'
        && appliedPlaceImage.layer?.id === 2
        && unchangedPlaceImage.classification === 'not_applied'
        && ambiguousPlaceImage.classification === 'ambiguous',
    JSON.stringify({ appliedPlaceImage, unchangedPlaceImage, ambiguousPlaceImage })
);
const missingStyle = resolveRenderLayoutVisualStyle({ backgroundHex: '#FFFFFF' });
const explicitWireframe = resolveRenderLayoutVisualStyle({
    backgroundHex: '#FFFFFF',
    visualStyle: { mode: 'neutral_wireframe' }
});
check(
    '缺失 visualStyle 时 fail closed',
    missingStyle.ok === false && missingStyle.issues.includes('visualStyle:required_use_model_authored_or_explicit_neutral_wireframe'),
    JSON.stringify(missingStyle)
);
check(
    '显式结构预览仍可使用 neutral_wireframe',
    explicitWireframe.ok === true && explicitWireframe.style?.mode === 'neutral_wireframe',
    JSON.stringify(explicitWireframe)
);
const newDocumentComposePreflight = buildAgentToolExecutionPreflight({
    assistantContent: '我会新建独立文档完成首稿，完成后读取图层与画面复核。',
    toolCalls: [{ name: 'composeDesign', arguments: { document: { mode: 'new', name: '主图' } } }],
    completedToolCalls: []
});
const activeDocumentComposePreflight = buildAgentToolExecutionPreflight({
    assistantContent: '我会继续修改当前文档，完成后读取图层与画面复核。',
    toolCalls: [{ name: 'composeDesign', arguments: { document: { mode: 'active', name: '主图' } } }],
    completedToolCalls: []
});
check(
    '新建独立文档的 composeDesign 不被旧画面检查越权拦截',
    newDocumentComposePreflight.ready === true
        && activeDocumentComposePreflight.ready === false,
    JSON.stringify({ newDocumentComposePreflight, activeDocumentComposePreflight })
);
const invalidTypography = resolveRenderLayoutVisualStyle({
    backgroundHex: '#FFFFFF',
    visualStyle: {
        mode: 'model_authored',
        palette: {
            primaryTextColorHex: '#111111',
            secondaryTextColorHex: '#333333',
            accentColorHex: '#AA5500',
            placeholderFillColorHex: '#EEEEEE',
            sellingPointTextColorHex: '#111111'
        },
        typography: {
            title: { fontSizeRatio: 1.2, minFontSizeRatio: 0.2, fitMode: 'none', tracking: 0, leadingRatio: 1.1 },
            subtitle: { fontSizeRatio: 0.3, minFontSizeRatio: 0.1, fitMode: 'none', tracking: 0, leadingRatio: 1.1 },
            body: { fontSizeRatio: 0.3, minFontSizeRatio: 0.1, fitMode: 'none', tracking: 0, leadingRatio: 1.1 },
            sellingPoint: { fontSizeRatio: 0.3, minFontSizeRatio: 0.1, fitMode: 'none', tracking: 0, leadingRatio: 1.1 }
        },
        sellingPoint: { treatment: 'text_only', cornerRadiusRatio: 0, paddingRatio: 0 }
    }
});
check(
    '模型可见范围与运行时字号范围一致',
    invalidTypography.ok === false
        && invalidTypography.issues.includes('visualStyle.typography.title.fontSizeRatio:out_of_range'),
    JSON.stringify(invalidTypography)
);

const diversifiedShortlist = diversifyAssetRecommendationShortlist([
    ...Array.from({ length: 8 }, (_, index) => ({
        file: { relativePath: `图片素材/平铺/flat-${index}.jpg`, dimensions: { width: 4284, height: 4284 } },
        score: 90 - index
    })),
    ...Array.from({ length: 8 }, (_, index) => ({
        file: { relativePath: `图片素材/模特/model-${index}.jpg`, dimensions: { width: 3024, height: 4032 } },
        score: 70 - index
    }))
], 6);
check(
    '素材联系表按来源轮转，不让高分辨率平铺图垄断 Agent 视野',
    diversifiedShortlist.filter((item) => item.file.relativePath.includes('/平铺/')).length === 3
        && diversifiedShortlist.filter((item) => item.file.relativePath.includes('/模特/')).length === 3,
    JSON.stringify(diversifiedShortlist.map((item) => item.file.relativePath))
);

const designCapabilitySession = createAgentCapabilitySession({
    candidateTools: getDefaultAgentTools(),
    baselineCapabilityIds: buildAgentCapabilityBaseline(true)
});
const hierarchySearchResult = designCapabilitySession.searchCapabilities('读取图层结构', 8);
const activeHierarchyMatch = hierarchySearchResult.matches
    .find((match) => match.providerToolNames.includes('getLayerHierarchy'));
const projectOverviewTool = designCapabilitySession.activeTools
    .find((tool) => tool.name === 'analyzeProjectContactSheetOverview');
const recommendAssetsTool = designCapabilitySession.activeTools
    .find((tool) => tool.name === 'recommendAssets');
const evaluateDesignTool = designCapabilitySession.activeTools
    .find((tool) => tool.name === 'evaluateDesign');
const projectOverviewContract = defaultAgentTools
    .find((tool) => tool.name === 'analyzeProjectContactSheetOverview');
const recommendAssetsContract = defaultAgentTools
    .find((tool) => tool.name === 'recommendAssets');
const evaluateDesignContract = defaultAgentTools
    .find((tool) => tool.name === 'evaluateDesign');
const localRevisionToolNames = new Set(designCapabilitySession.activeTools.map((tool) => tool.name));
check(
    '项目总览、候选比较、独立评价与最小局部修订手柄首轮可见，但仍由 Agent 决定是否和何时使用',
    activeHierarchyMatch?.availability === 'active'
        && Boolean(projectOverviewTool)
        && Boolean(recommendAssetsTool)
        && Boolean(evaluateDesignTool)
        && projectOverviewTool?.description.includes('bounded visual inventory')
        && projectOverviewContract?.description.includes('not a mandatory first step')
        && projectOverviewContract?.description.includes('does not prove the project is complete, choose a hero, prescribe a design direction')
        && recommendAssetsContract?.description.includes('does not establish the project\'s complete inventory')
        && recommendAssetsContract?.description.includes('not a required sequence')
        && evaluateDesignContract?.description.includes('首轮可见不表示固定开工或强制验收')
        && evaluateDesignContract?.description.includes('只在隔离批评比直接修订或参考比较更有信息增益时调用')
        && ['placeImage', 'transformLayer', 'createRectangle', 'createEllipse', 'setTextStyle']
            .every((toolName) => localRevisionToolNames.has(toolName)),
    JSON.stringify({
        hierarchySearchResult,
        activeTools: designCapabilitySession.activeTools.map((tool) => tool.name),
        contractDescriptions: {
            projectOverview: projectOverviewContract?.description,
            recommendAssets: recommendAssetsContract?.description,
            evaluateDesign: evaluateDesignContract?.description
        }
    })
);

const normalizedProjectVisualInventory = normalizeContactSheetObservation(JSON.stringify({
    productResolution: {
        status: 'resolved',
        primaryProduct: '商品 A',
        candidates: ['商品 A'],
        basisImageIds: ['A99']
    },
    sellingPoints: [],
    imageRoles: [
        { id: 'A01', role: '场景' },
        { id: 'A02', role: '不应采用失败编号' },
        { id: 'A99', role: '不应采用不存在编号' }
    ],
    visualInventory: {
        visibleSubjectGroups: [
            { label: '主体组', visibleTraits: ['正面'], basisImageIds: ['a01', 'A99'], certainty: 'clear' },
            { label: '无证据主体', visibleTraits: [], basisImageIds: ['A99'], certainty: 'clear' }
        ],
        visibleVariantGroups: [
            { label: '颜色变体', visibleVariants: ['浅色', '深色'], basisImageIds: ['A01'], certainty: 'tentative' }
        ],
        shootingCoverage: [
            { shotType: 'scene', description: '场景展示', basisImageIds: ['A01'], certainty: 'clear' },
            { shotType: 'hero', description: '非法类型', basisImageIds: ['A01'], certainty: 'clear' }
        ],
        uncertainCoverage: [
            { topic: '变体是否齐全', reason: '总览不能证明完整库存', basisImageIds: [] }
        ]
    },
    nextSingleImageChecks: ['A01', 'A02', 'A99']
}), [
    { id: 'A01', status: 'rendered' },
    { id: 'A02', status: 'failed' }
]);
check(
    '项目视觉库存只接受本次成功渲染编号，并把无有效依据的 resolved 降为 ambiguous',
    normalizedProjectVisualInventory.productResolution.status === 'ambiguous'
        && normalizedProjectVisualInventory.productResolution.primaryProduct === undefined
        && normalizedProjectVisualInventory.productResolution.basisImageIds.length === 0
        && normalizedProjectVisualInventory.imageRoles.length === 1
        && normalizedProjectVisualInventory.visualInventory?.scope.renderedImageIds.join(',') === 'A01'
        && normalizedProjectVisualInventory.visualInventory?.scope.failedImageIds.join(',') === 'A02'
        && normalizedProjectVisualInventory.visualInventory?.visibleSubjectGroups.length === 1
        && normalizedProjectVisualInventory.visualInventory.visibleSubjectGroups[0].basisImageIds.join(',') === 'A01'
        && normalizedProjectVisualInventory.visualInventory.visibleVariantGroups.length === 1
        && normalizedProjectVisualInventory.visualInventory.shootingCoverage.length === 1
        && normalizedProjectVisualInventory.visualInventory.shootingCoverage[0].shotType === 'scene'
        && normalizedProjectVisualInventory.visualInventory.uncertainCoverage.length === 1
        && normalizedProjectVisualInventory.nextSingleImageChecks.join(',') === 'A01',
    JSON.stringify(normalizedProjectVisualInventory)
);

if (failures.length > 0) {
    console.error(`\n设计作者权边界验证失败：${failures.length} 项`);
    process.exit(1);
}

console.log('\n设计作者权边界验证通过。');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
