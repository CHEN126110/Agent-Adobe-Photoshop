// SKU 缺模板 handoff 契约与执行器回归：模板定义、阶段解析、零写入恢复出口。
const path = require('path');
const root = path.resolve(__dirname, '..');
require('ts-node').register({ transpileOnly: true, project: path.join(root, 'tsconfig.main.json') });
const {
    buildSkuTemplateDesignHandoffContract,
    buildSkuTemplateLayoutSuggestion
} = require(path.join(root, 'src/shared/sku-template-design-loop.ts'));

let failed = 0;
function check(condition, label, detail) {
    if (condition) {
        console.log(`  ✓ ${label}`);
        return;
    }
    failed += 1;
    console.error(`  ✗ ${label}${detail ? `：${detail}` : ''}`);
}

console.log('[1] handoff 契约文本');
const handoff = buildSkuTemplateDesignHandoffContract({
    missingTargets: [
        { size: 2, mode: 'combo', expectedItemCount: 2 },
        { size: 3, mode: 'combo', expectedItemCount: 3 },
        { size: 4, mode: 'combo', expectedItemCount: 4 }
    ],
    colorCount: 5,
    sourceDocumentName: 'SKU.psb',
    sourceCanvas: { width: 800, height: 800 },
    sourceCardAspectRatio: 154 / 234
});
const msg = handoff.message;
check(/独立的新文档/.test(msg) && /不置入任何颜色图/.test(msg), '定义：独立新文档 + 不置入颜色图');
check(/「SKU\.psb」是只读的颜色来源/.test(msg) && /不要与它同名/.test(msg), '色卡只读、不同名');
check(/是否查看 Eagle.*信息增益/.test(msg) && /没有合适参考时可以自主新建设计/.test(msg), '参考按信息增益决定');
check(/regionCapacities：数组/.test(msg), 'region_composition 参数要求写明');
check(handoff.templateDesignToolNames.includes('openTemplate') && handoff.templateDesignToolNames.includes('importEagleAssetToProject'), '工具面含 openTemplate / importEagleAssetToProject');
check(!/模板方向已确认/.test(msg), '缺模板 handoff 不声称方向已确认');
check(handoff.templateLayoutSuggestions.length === 0, '普通设计 handoff 不注入机械版式建议', String(handoff.templateLayoutSuggestions.length));
check(!/按顺序执行|项目模板目录\s*→\s*Eagle|版式起点/.test(msg), 'handoff 不固定行动顺序或版式起点');
check(
    handoff.agentReActContinuation.recovery?.purpose === 'execute'
        && handoff.agentReActContinuation.recovery.allowedToolNames.includes('evaluateDesign')
        && handoff.agentReActContinuation.recovery.allowedToolNames.includes('composeDesign')
        && !handoff.agentReActContinuation.recovery.toolArgumentConstraints?.skuLayout,
    'staged 父任务只限制创意子任务副作用范围，不固定版式工具顺序'
);

console.log('[2] 版式建议几何');
const mechanicalHandoff = buildSkuTemplateDesignHandoffContract({
    missingTargets: [
        { size: 2, mode: 'combo', expectedItemCount: 2 },
        { size: 3, mode: 'combo', expectedItemCount: 3 },
        { size: 4, mode: 'combo', expectedItemCount: 4 }
    ],
    sourceCanvas: { width: 800, height: 800 },
    sourceCardAspectRatio: 154 / 234,
    includeMechanicalLayoutCandidate: true
});
function inside(a, b) { return a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height; }
function overlap(a, b) { return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height; }
check(mechanicalHandoff.templateLayoutSuggestions.length === 3, '显式请求时返回三份机械线框候选');
check(/机械线框候选/.test(mechanicalHandoff.message) && /不是正式版式答案/.test(mechanicalHandoff.message), '线框候选明确不冒充设计答案');
for (const suggestion of mechanicalHandoff.templateLayoutSuggestions) {
    const canvasBox = { x: 0, y: 0, width: 800, height: 800 };
    check(suggestion.slots.length === suggestion.size, `${suggestion.size}双装 槽位数 = 双数`);
    check(suggestion.slots.every((s) => inside(s, suggestion.cardFrame)), `${suggestion.size}双装 槽位都在卡片框内`, JSON.stringify(suggestion.slots));
    check(inside(suggestion.cardFrame, canvasBox), `${suggestion.size}双装 卡片框在画布内`);
    let anyOverlap = false;
    for (let i = 0; i < suggestion.slots.length; i += 1) {
        for (let j = i + 1; j < suggestion.slots.length; j += 1) {
            if (overlap(suggestion.slots[i], suggestion.slots[j])) anyOverlap = true;
        }
    }
    check(!anyOverlap, `${suggestion.size}双装 槽位互不重叠`);
    const lastSlotBottom = Math.max(...suggestion.slots.map((s) => s.y + s.height));
    check(suggestion.titleBox.y >= lastSlotBottom, `${suggestion.size}双装 标题在槽位下方`);
    check(suggestion.subtitleBox.y + suggestion.subtitleBox.height <= suggestion.cardFrame.y + suggestion.cardFrame.height, `${suggestion.size}双装 副标题不出卡片框`);
    check(suggestion.slots.every((s) => s.width >= 100), `${suggestion.size}双装 槽位不至于太窄（≥100）`, JSON.stringify(suggestion.slots[0]));
}
const tokens = mechanicalHandoff.templateLayoutSuggestions.map((s) => JSON.stringify(s.tokens));
check(new Set(tokens).size === 1, '三份共用同一套刻度');

console.log('[3] 自选备注 5 色分两行 / 缺尺寸不建议');
const note = buildSkuTemplateLayoutSuggestion({ size: 3, mode: 'self_select_note', slotCount: 5, canvas: { width: 800, height: 800 } });
check(Boolean(note) && note.slots.length === 5 && new Set(note.slots.map((s) => s.y)).size === 2, '5 个槽位分两行', note && JSON.stringify(note.slots.map((s) => s.y)));
check(buildSkuTemplateLayoutSuggestion({ size: 2, canvas: { width: 0, height: 0 } }) === undefined, '缺画布尺寸不给建议');
const repair = buildSkuTemplateDesignHandoffContract({
    repairTargets: [{ size: 3, templateName: '3双装.psb', expectedItemCount: 3, issue: '没有识别到可解析的 SKU 占位符。' }],
    colorCount: 3
});
check(repair.templateLayoutSuggestions.length === 0 && /占位结构需要修复/.test(repair.message) && repair.completionChecklist.some((item) => item.includes('重新 inspect')), '修复路径不给新建版式、保留修复口径');

console.log('[4] SKU 站点 stage 解析：变体归一化 / 非法字面量不静默改道');
const { resolveSkuSkillStage } = require(path.join(root, 'src/shared/sku-intent-params.ts'));
const run702Text = '帮我完成SKU色卡的制作并完成色卡模板设计与SKU编排';
for (const variant of ['color_card', 'Color-Card', 'colorCard', ' COLOR CARD ']) {
    const resolved = resolveSkuSkillStage({ stage: variant, userInput: run702Text });
    check(
        resolved.stage === 'color-card' && !resolved.invalidDeclaredStage,
        `声明变体「${variant}」归一化为 color-card 且不标记非法`,
        JSON.stringify(resolved)
    );
}
const invalidResolved = resolveSkuSkillStage({ stage: '色卡', userInput: run702Text });
check(
    invalidResolved.invalidDeclaredStage === '色卡',
    '无法识别的显式 stage 标记 invalidDeclaredStage，交执行器 fail-fast（2026-08-27 run702：静默落正则会把色卡意图改道）',
    JSON.stringify(invalidResolved)
);
const declaredTemplate = resolveSkuSkillStage({ stage: 'template', userInput: '帮我做SKU' });
check(
    declaredTemplate.stage === 'template' && !declaredTemplate.invalidDeclaredStage,
    '显式 stage=template 不被用户原话执行正则覆盖（2026-08-23 回归）',
    JSON.stringify(declaredTemplate)
);
const legacyInspect = resolveSkuSkillStage({ stage: 'Inspect', userInput: run702Text });
check(
    legacyInspect.stage === 'full'
        && legacyInspect.legacyInspectOnly === true
        && !legacyInspect.invalidDeclaredStage,
    '历史 stage=inspect 保留只读兼容入口，不被非法字面量门禁截断',
    JSON.stringify(legacyInspect)
);
const fallbackResolved = resolveSkuSkillStage({ userInput: run702Text });
check(
    !fallbackResolved.invalidDeclaredStage && ['full', 'color-card', 'template', 'config'].includes(fallbackResolved.stage),
    '未声明 stage 时按文本回落且不标记非法',
    JSON.stringify(fallbackResolved)
);

async function runExecutorBoundaryAssertions() {
    console.log('[5] SKU 执行器边界：规格事实 / 模板 handoff / 缺源出口 / inspect 只读');
    const toolExecutorPath = path.join(root, 'src/renderer/services/tool-executor.service.ts');
    const toolExecutorModule = require(toolExecutorPath);
    const originalExecuteToolCall = toolExecutorModule.executeToolCall;
    const previousWindow = global.window;
    const executedTools = [];
    let documentInventory = [];
    let projectSearchResults = [];
    const openedPaths = [];
    toolExecutorModule.executeToolCall = async (name) => {
        executedTools.push(name);
        if (name === 'listDocuments') return { success: true, documents: documentInventory };
        if (name === 'searchProjectResources') return { success: true, results: projectSearchResults };
        return { success: false, error: `unexpected tool in missing-source test: ${name}` };
    };
    global.window = {
        designEcho: {
            invoke: async () => [],
            readDirectory: async () => [],
            setProjectRoot: async () => true,
            openPath: async (filePath) => {
                openedPaths.push(filePath);
                throw new Error(`inspect must not open project source: ${filePath}`);
            }
        }
    };
    try {
        const { useAppStore } = require(path.join(root, 'src/renderer/stores/app.store.ts'));
        useAppStore.setState({ currentProject: null });
        const { skuBatchExecutor } = require(path.join(
            root,
            'src/renderer/services/skill-executors/sku-batch.executor.ts'
        ));
        const { applySharedSkillParamDefaults } = require(path.join(
            root,
            'src/shared/skill-param-defaults.ts'
        ));
        const normalizedMissingTemplateParams = applySharedSkillParamDefaults({
            skillId: 'sku-batch',
            userInput: '帮我设计 SKU 模板',
            mode: 'execute',
            params: { stage: 'template' }
        });
        check(
            !Object.prototype.hasOwnProperty.call(normalizedMissingTemplateParams, 'comboSizes'),
            '生产参数默认器不再把 full 的 2/3/4 草稿注入 template 阶段',
            JSON.stringify(normalizedMissingTemplateParams)
        );
        const missingTemplateSizesResult = await skuBatchExecutor.execute({
            params: normalizedMissingTemplateParams,
            callbacks: {},
            context: { userInput: '帮我设计 SKU 模板' }
        });
        check(
            missingTemplateSizesResult.success === false
                && missingTemplateSizesResult.nonFatal === true
                && missingTemplateSizesResult.data?.status === 'needs_sku_template_sizes'
                && missingTemplateSizesResult.data?.requiredInput?.kind === 'sku_template_sizes'
                && !missingTemplateSizesResult.data?.agentReActContinuation,
            '模板规格未知时停在必要事实，不签发 Photoshop 写能力',
            JSON.stringify(missingTemplateSizesResult)
        );
        check(
            executedTools.length === 0,
            '模板规格未知时在任何项目或 Photoshop 读取前停止',
            JSON.stringify(executedTools)
        );

        const normalizedTemplateParams = applySharedSkillParamDefaults({
            skillId: 'sku-batch',
            userInput: '帮我设计 2 双、3 双和 4 双装的 SKU 模板',
            mode: 'execute',
            params: { stage: 'template', comboSizes: [2, 3, 4] }
        });
        const templateResult = await skuBatchExecutor.execute({
            params: normalizedTemplateParams,
            callbacks: {},
            context: { userInput: '帮我设计 2 双、3 双和 4 双装的 SKU 模板' }
        });
        check(
            templateResult.success === false
                && templateResult.nonFatal === true
                && templateResult.data?.status === 'pending_sku_template_design_agent_decision'
                && Array.isArray(templateResult.data?.completionChecklist)
                && Array.isArray(templateResult.data?.templateLayoutSuggestions)
                && templateResult.data?.agentReActContinuation?.recovery?.purpose === 'execute',
            '项目零 PSD 时 template 直接返回完整同 TaskRun 设计 handoff',
            JSON.stringify(templateResult)
        );
        check(
            !/stage=|sku-batch|createProjectContactSheetOverview/.test(String(templateResult.message || '')),
            '模板缺源公开文案不泄漏内部调用协议',
            String(templateResult.message || '')
        );

        const normalizedInferredTemplateParams = applySharedSkillParamDefaults({
            skillId: 'sku-batch',
            userInput: '帮我设计 2 双、3 双和 4 双装的 SKU 模板',
            mode: 'execute',
            params: { stage: 'template' }
        });
        const inferredTemplateResult = await skuBatchExecutor.execute({
            params: normalizedInferredTemplateParams,
            callbacks: {},
            context: { userInput: '帮我设计 2 双、3 双和 4 双装的 SKU 模板' }
        });
        check(
            inferredTemplateResult.data?.status === 'pending_sku_template_design_agent_decision'
                && JSON.stringify(inferredTemplateResult.data?.comboSizes) === JSON.stringify([2, 3, 4]),
            '自然用户原文中的明确规格可直接形成具体模板目标，不额外打断用户',
            JSON.stringify(inferredTemplateResult)
        );

        const missingSourceResult = await skuBatchExecutor.execute({
            params: { stage: 'full', allowSkuCardSourcePreparation: false },
            callbacks: {},
            context: { userInput: '帮我完成 SKU 制作' }
        });
        check(
            missingSourceResult.success === false
                && /已有按颜色分好的 SKU 源 PSD\/PSB/.test(String(missingSourceResult.error || ''))
                && /stage='color-card'/.test(String(missingSourceResult.error || ''))
                && /可用的产品单色照片都没有/.test(String(missingSourceResult.error || ''))
                && missingSourceResult.data?.skuCardSourcePreparationPlan?.minimumSourceCount === 4,
            '禁止自动建源时返回现有源 / 色卡建源 / 缺照片三条可达出口',
            String(missingSourceResult.error || '')
        );
        check(
            missingSourceResult.data?.skuCardSourcePreparationPlan?.minimumSourceCount === 4,
            'bare full 未污染 params，但早期色卡容量仍覆盖 2/3/4 草稿中的最大 4 双装',
            JSON.stringify(missingSourceResult.data?.skuCardSourcePreparationPlan)
        );
        check(
            !/stage=|sku-batch|createProjectContactSheetOverview/.test(String(missingSourceResult.message || '')),
            '缺源公开文案保持自然，工程诊断留在 error 与私有收据',
            String(missingSourceResult.message || '')
        );

        documentInventory = [{
            id: 101,
            name: 'SKU.psb',
            path: 'C:\\project\\SKU.psb',
            width: 800,
            height: 800,
            isActive: true
        }];
        const inspectCases = [
            {
                label: "legacy stage='Inspect'",
                params: { stage: 'Inspect' },
                userInput: '检查当前 SKU 文件'
            },
            {
                label: "mode='inspect' 覆盖模板措辞",
                params: { stage: 'template', mode: 'inspect' },
                userInput: '使用默认占位模板检查 SKU'
            },
            {
                label: 'inspectOnly 覆盖 color-card 阶段',
                params: { stage: 'color-card', inspectOnly: true },
                userInput: '检查当前色卡'
            }
        ];
        for (const inspectCase of inspectCases) {
            const toolStart = executedTools.length;
            const inspectResult = await skuBatchExecutor.execute({
                params: inspectCase.params,
                callbacks: {},
                context: { userInput: inspectCase.userInput }
            });
            const inspectTools = executedTools.slice(toolStart);
            check(
                inspectResult.success === true
                    && inspectResult.data?.status === 'sku_inventory_inspected'
                    && inspectResult.data?.readOnly === true
                    && inspectResult.data?.source?.openedDocument?.id === 101,
                `${inspectCase.label} 返回真实只读库存`,
                JSON.stringify(inspectResult)
            );
            check(
                inspectTools.length === 1 && inspectTools[0] === 'listDocuments',
                `${inspectCase.label} 结构上不可进入模板、排版、保存或导出写链`,
                JSON.stringify(inspectTools)
            );
        }
        useAppStore.setState({
            currentProject: {
                id: 'sku-inspect-project',
                name: 'SKU inspect fixture',
                path: 'C:\\project',
                createdAt: 1,
                lastOpenedAt: 1,
                folders: {}
            }
        });
        documentInventory = [];
        projectSearchResults = [{
            name: 'SKU.psb',
            path: 'C:\\project\\PSD\\SKU.psb',
            relativePath: 'PSD\\SKU.psb'
        }];
        const diskInspectToolStart = executedTools.length;
        const diskInspectResult = await skuBatchExecutor.execute({
            params: { stage: 'config', inspectOnly: true },
            callbacks: {},
            context: { userInput: '只检查项目中的 SKU 文件和模板' }
        });
        const diskInspectTools = executedTools.slice(diskInspectToolStart);
        check(
            diskInspectResult.success === true
                && diskInspectResult.data?.status === 'sku_inventory_inspected'
                && diskInspectResult.data?.source?.openedDocument === null
                && diskInspectResult.data?.source?.projectFile?.relativePath === 'PSD\\SKU.psb',
            'config + inspectOnly 能报告项目磁盘源但不把它冒充已打开文档',
            JSON.stringify(diskInspectResult)
        );
        check(
            JSON.stringify(diskInspectTools) === JSON.stringify(['listDocuments', 'searchProjectResources'])
                && openedPaths.length === 0,
            '项目磁盘源存在但未打开时，inspect 只搜索库存且绝不调用 openPath',
            JSON.stringify({ diskInspectTools, openedPaths })
        );
        check(
            executedTools.every((name) => name === 'listDocuments' || name === 'searchProjectResources'),
            '缺源与只读路径只允许库存观察，没有 Photoshop 写入',
            JSON.stringify(executedTools)
        );
    } finally {
        toolExecutorModule.executeToolCall = originalExecuteToolCall;
        if (previousWindow === undefined) delete global.window;
        else global.window = previousWindow;
    }
}

runExecutorBoundaryAssertions().then(() => {
    if (failed > 0) {
        console.error(`\n[FAIL] SKU 模板 handoff：${failed} 项断言失败`);
        process.exit(1);
    }
    console.log('\n[OK] SKU 模板 handoff 契约与执行器回归通过');
}).catch((error) => {
    console.error('\n[FAIL] SKU 模板 handoff 执行器断言异常:', error);
    process.exit(1);
});
