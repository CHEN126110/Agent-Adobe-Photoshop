const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
require('ts-node').register({ transpileOnly: true, project: path.join(root, 'tsconfig.main.json') });

const {
    buildBackdropPrompt,
    describeTextSideForLayout,
    describeComposeDesignForModel,
    normalizeComposeDesignSpec,
    planPhotoFullBleedPlacement,
    planSubjectShadow
} = require(path.join(root, 'src/shared/design-workshop/compose-design-spec.ts'));
const {
    compareDesignVersions,
    findLatestComparableDesign
} = require(path.join(root, 'src/shared/design-workshop/recent-designs.ts'));
const {
    buildComposeDesignRationaleResultProjection,
    resolveMaterialSelectionReasonProjection
} = require(path.join(root, 'src/shared/design-workshop/compose-design-rationale-visibility.ts'));
const {
    executeComposeDesign
} = require(path.join(root, 'src/renderer/services/design-workshop/compose-design.executor.ts'));
const {
    normalizePhotoshopToolArguments
} = require(path.join(root, 'src/shared/photoshop-tool-parameter-normalizer.ts'));
const {
    resolveRenderLayoutVisualStyle
} = require(path.join(root, 'src/shared/layout/render-layout-style.ts'));
const {
    generateToolSchemas
} = require(path.join(root, 'src/renderer/services/agent-runtime/tool-schemas.ts'));

const toolExecutorSource = fs.readFileSync(
    path.join(root, 'src/renderer/services/tool-executor.service.ts'),
    'utf8'
);
const toolSchemasSource = fs.readFileSync(
    path.join(root, 'src/renderer/services/agent-runtime/tool-schemas.ts'),
    'utf8'
);
const uxpCreateTextSource = fs.readFileSync(
    path.join(root, '..', 'DesignEcho-UXP', 'src', 'tools', 'text', 'create-text-layer.ts'),
    'utf8'
);

let failed = 0;

function check(name, condition, detail = '') {
    if (condition) {
        console.log(`✅ ${name}`);
        return;
    }
    failed += 1;
    console.error(`❌ ${name}${detail ? `: ${detail}` : ''}`);
}

check(
    'renderLayout 遵守 createTextLayer 的可见边界坐标契约，不按段落对齐改写 x',
    toolExecutorSource.includes('x: b.x + paddingX,')
        && toolExecutorSource.includes('x: b.x,')
        && !toolExecutorSource.includes('resolvePointTextAnchorX')
);
check(
    'Agent schema 与 UXP 对 createTextLayer.x/y 只有一套最终 bounds 左上角语义',
    toolSchemasSource.includes('x/y are the requested visible text bounds top-left')
        && uxpCreateTextSource.includes('const deltaX = before.expectedX - currentX;')
        && uxpCreateTextSource.includes('const deltaY = before.expectedY - currentY;')
        && uxpCreateTextSource.includes('nearlyEqual(layer.bounds.left, before.expectedX)')
        && uxpCreateTextSource.includes('nearlyEqual(layer.bounds.top, before.expectedY)')
        && uxpCreateTextSource.includes('不随段落对齐方式改变语义')
);
check(
    '文字色穿过 Photoshop 参数归一化后保持 Agent 声明，不回落默认黑色',
    normalizePhotoshopToolArguments('createTextLayer', {
        content: '腊肠狗条纹袜',
        x: 101,
        y: 94,
        colorHex: '#6A3E2E'
    }).colorHex === '#6A3E2E'
        && normalizePhotoshopToolArguments('addDropShadow', {
            colorHex: '#6A3E2E'
        }).colorHex === undefined
);
const composeDesignToolSchema = generateToolSchemas()
    .find((tool) => tool.name === 'composeDesign')?.inputSchema;
const composeTypographySchema = composeDesignToolSchema
    ?.properties?.layout?.properties?.visualStyle?.properties?.typography;
check(
    'composeDesign 模型 schema 与执行校验同时要求背景决定和明确字体',
    composeDesignToolSchema?.required?.includes('background')
        && ['title', 'subtitle', 'body', 'sellingPoint'].every((role) => (
            composeTypographySchema?.properties?.[role]?.required?.includes('fontName')
        ))
);

const visualStyle = {
    mode: 'model_authored',
    palette: {
        primaryTextColorHex: '#231F20',
        secondaryTextColorHex: '#5A514A',
        accentColorHex: '#A56D45',
        placeholderFillColorHex: '#D8C8B7',
        sellingPointTextColorHex: '#231F20'
    },
    typography: {
        title: { fontName: 'Microsoft YaHei', fontSizeRatio: 0.42, minFontSizeRatio: 0.2, fitMode: 'shrink_to_width', tracking: -10, leadingRatio: 1.08 },
        subtitle: { fontName: 'Microsoft YaHei', fontSizeRatio: 0.28, minFontSizeRatio: 0.15, fitMode: 'shrink_to_width', tracking: 0, leadingRatio: 1.18 },
        body: { fontName: 'Microsoft YaHei', fontSizeRatio: 0.24, minFontSizeRatio: 0.13, fitMode: 'shrink_to_width', tracking: 0, leadingRatio: 1.25 },
        sellingPoint: { fontName: 'Microsoft YaHei', fontSizeRatio: 0.3, minFontSizeRatio: 0.14, fitMode: 'shrink_to_width', tracking: 0, leadingRatio: 1.15 }
    },
    sellingPoint: { treatment: 'text_only', cornerRadiusRatio: 0, paddingRatio: 0 }
};

const unresolvedFontStyle = resolveRenderLayoutVisualStyle({
    backgroundHex: '#F3EFE7',
    visualStyle: {
        ...visualStyle,
        typography: {
            ...visualStyle.typography,
            title: { ...visualStyle.typography.title, fontName: undefined }
        }
    }
});
check(
    '正式视觉样式缺少字体时失败，不沿用 Photoshop 当前默认字体',
    unresolvedFontStyle.ok === false
        && unresolvedFontStyle.issues.includes('visualStyle.typography.title.fontName:required_resolved_font'),
    JSON.stringify(unresolvedFontStyle)
);

const good = {
    canvas: { width: 800, height: 800 },
    document: { mode: 'new', name: '春日薄款主图' },
    background: { kind: 'solid', colorHex: '#F3EFE7' },
    subject: {
        filePath: 'E:/project/product.png',
        treatment: 'cutout',
        cutout: false,
        shadow: {
            kind: 'drop-shadow',
            colorHex: '#3A2418',
            opacity: 26,
            angle: 104,
            distance: 10,
            size: 24,
            spread: 2
        }
    },
    layout: {
        mode: 'agent_authored',
        groupName: '点击图·春日薄款',
        regions: [
            {
                id: '主体·产品摄影',
                role: 'main-image',
                content: 'subject',
                bounds: { x: 0.5, y: 0.08, width: 0.44, height: 0.84 },
                imagePlacement: { fit: 'contain', anchor: 'center', scale: 1, rotation: 0, mask: 'none', overflow: 'visible' }
            },
            {
                id: '标题·春日薄款',
                role: 'title',
                content: '春日薄款',
                bounds: { x: 0.06, y: 0.1, width: 0.36, height: 0.2 },
                hAlign: 'left'
            }
        ],
        visualStyle,
        marginScale: 2,
        gutterScale: 2
    },
    palette: { backgroundHex: '#F3EFE7', textHex: '#231F20', accentHex: '#A56D45' }
};

const ok = normalizeComposeDesignSpec(good);
check('完整 Agent 设计稿通过校验', ok.ok && ok.spec, JSON.stringify(ok.issues));
check('rationale 是可选工作笔记，不是写入门票', ok.ok && ok.spec.rationale.text === '');
check('颜色只做格式归一，没有派生字色', ok.spec.palette.textHex === '#231F20');
check('主体处理、抠图与投影保持显式选择', ok.spec.subject.treatment === 'cutout' && ok.spec.subject.cutout === false && ok.spec.subject.shadow.kind === 'drop-shadow' && ok.spec.subject.shadow.angle === 104);
check('中文设计名与语义图层名保持模型原文', ok.spec.document.name === '春日薄款主图' && ok.spec.layout.regions[0].id === '主体·产品摄影');

const selectionReason = '四双完整同框，花色辨识清楚，并且右侧留白能承接标题。';
const rationaleProjection = buildComposeDesignRationaleResultProjection({
    text: `选图：${selectionReason}\n结构：商品优先`,
    materials: `  ${selectionReason}  `
});
check(
    '选图依据作为独立可选字段保持模型原话，不与完整设计说明混在一起',
    rationaleProjection.materialSelectionReasonText === selectionReason
        && rationaleProjection.designRationaleText.includes('结构：商品优先')
);
check(
    '缺少选图依据不会补造内容或阻断设计说明结果',
    !Object.prototype.hasOwnProperty.call(
        buildComposeDesignRationaleResultProjection({ text: '结构：商品优先' }),
        'materialSelectionReasonText'
    )
);
check(
    '无关的长思考不能压掉本轮具体选图依据',
    resolveMaterialSelectionReasonProjection({
        reasonText: selectionReason,
        visibleContents: ['我已经完整理解任务，接下来会建立画布、安排构图、控制层级并检查最终结果，这段说明足够长但没有解释为什么选择这张素材。']
    }) === selectionReason
);
check(
    '本轮可见内容已覆盖同一选图依据时按内容去重',
    resolveMaterialSelectionReasonProjection({
        reasonText: selectionReason,
        visibleContents: [`选图：四双完整同框，花色辨识清楚，并且右侧留白能承接标题！`]
    }) === undefined
);

const unnamed = normalizeComposeDesignSpec({
    ...good,
    document: { mode: 'new' }
});
check(
    '新建设计缺少用户可读名称时失败，不生成尺寸或时间戳工程名',
    !unnamed.ok && unnamed.issues.some((issue) => /document\.name/.test(issue)),
    unnamed.issues.join(' | ')
);

const recipe = normalizeComposeDesignSpec({
    ...good,
    layout: { ...good.layout, mode: 'repeatable_recipe', recipeId: 'four-grid' }
});
check('内置版式配方被拒绝', !recipe.ok && recipe.issues.some((issue) => /内置版式配方已移除/.test(issue)), recipe.issues.join(' | '));

const noStyle = normalizeComposeDesignSpec({ ...good, layout: { ...good.layout, visualStyle: undefined } });
check('正式设计缺视觉样式时失败，不套默认稿', !noStyle.ok && noStyle.issues.some((issue) => /visualStyle/.test(issue)));

const guessedSubject = normalizeComposeDesignSpec({
    ...good,
    subject: { filePath: 'E:/project/product.jpg' }
});
check('Harness 不根据背景猜主体处理方式', !guessedSubject.ok && guessedSubject.issues.some((issue) => /subject\.treatment/.test(issue)));

const implicitCutout = normalizeComposeDesignSpec({
    ...good,
    subject: { filePath: 'E:/project/product.jpg', treatment: 'cutout', shadow: { kind: 'none' } }
});
check('cutout 是否抠图必须显式声明', !implicitCutout.ok && implicitCutout.issues.some((issue) => /subject\.cutout/.test(issue)));

const photoWithoutFill = normalizeComposeDesignSpec({
    ...good,
    background: { kind: 'none' },
    subject: { filePath: 'E:/project/photo.jpg', treatment: 'photo', shadow: { kind: 'none' } }
});
check('摄影主体占比必须由 Agent 声明', !photoWithoutFill.ok && photoWithoutFill.issues.some((issue) => /subject\.fillRatio/.test(issue)));

const photoWithoutBackgroundDecision = normalizeComposeDesignSpec({
    ...good,
    background: undefined,
    subject: {
        filePath: 'E:/project/photo.jpg',
        treatment: 'photo',
        shadow: { kind: 'none' },
        fillRatio: 0.82
    }
});
check(
    '摄影素材不会让 Harness 静默补成无背景满幅模式',
    !photoWithoutBackgroundDecision.ok
        && photoWithoutBackgroundDecision.issues.some((issue) => /background\.kind/.test(issue)),
    photoWithoutBackgroundDecision.issues.join(' | ')
);

const photoOnly = normalizeComposeDesignSpec({
    ...good,
    background: { kind: 'none' },
    subject: {
        filePath: 'E:/project/photo.jpg',
        treatment: 'photo',
        shadow: { kind: 'none' },
        fillRatio: 0.82
    },
    layout: {
        ...good.layout,
        groupName: '主图首稿·摄影主体',
        regions: [{
            id: '主体·摄影图',
            role: 'main-image',
            content: 'subject',
            bounds: { x: 0.08, y: 0.08, width: 0.84, height: 0.84 },
            imagePlacement: { fit: 'contain', anchor: 'center', scale: 1, rotation: 0, mask: 'none', overflow: 'visible' }
        }]
    }
});
check(
    'Agent 可明确选择只有商品图、不编造文字的有效设计',
    photoOnly.ok,
    photoOnly.issues.join(' | ')
);

const multiVisual = normalizeComposeDesignSpec({
    ...good,
    document: { mode: 'new', name: '瑜伽系列视觉实验' },
    subject: undefined,
    layout: {
        ...good.layout,
        groupName: '视觉实验·动静对照',
        regions: [
            {
                id: '场景·瑜伽动作',
                role: 'main-image',
                content: 'E:/project/yoga-scene.jpg',
                bounds: { x: 0.03, y: 0.04, width: 0.7, height: 0.92 },
                imagePlacement: { fit: 'cover', anchor: 'center', scale: 1, rotation: -4, mask: 'none', overflow: 'clip' }
            },
            {
                id: '细节·防滑纹理',
                role: 'decoration',
                content: 'E:/project/grip-detail.png',
                bounds: { x: 0.63, y: 0.56, width: 0.32, height: 0.34 },
                imagePlacement: { fit: 'cover', anchor: 'center', scale: 1.08, rotation: 3, mask: 'clipping', overflow: 'clip' }
            },
            {
                id: '标题·稳住每一步',
                role: 'title',
                content: '稳住每一步',
                bounds: { x: 0.62, y: 0.12, width: 0.32, height: 0.18 },
                hAlign: 'left'
            }
        ]
    }
});
check(
    '无 subject 也能声明多个独立视觉素材，不被单素材入口限制',
    multiVisual.ok
        && multiVisual.spec.subject === undefined
        && multiVisual.spec.layout.regions.filter((region) => /\.(?:jpe?g|png)$/i.test(region.content)).length === 2,
    multiVisual.issues.join(' | ')
);
check(
    '多个视觉元素的语义名称和各自定位声明保持原样',
    multiVisual.ok
        && multiVisual.spec.layout.regions[0].id === '场景·瑜伽动作'
        && multiVisual.spec.layout.regions[1].imagePlacement.rotation === 3
);
check(
    '图片型视觉元素不冒充文字区域影响构图事实',
    describeTextSideForLayout({
        regions: [
            {
                id: '图标·材质特写',
                role: 'tag',
                content: 'E:/project/material.png',
                bounds: { x: 0.7, y: 0.2, width: 0.2, height: 0.2 }
            },
            {
                id: '标题·稳住每一步',
                role: 'title',
                content: '稳住每一步',
                bounds: { x: 0.05, y: 0.1, width: 0.3, height: 0.2 }
            }
        ]
    }) === 'left'
);

const implementationLayerName = normalizeComposeDesignSpec({
    ...good,
    layout: {
        ...good.layout,
        regions: [{ ...good.layout.regions[1], id: 'scene-line' }]
    }
});
check(
    '工程实现标识不能进入交付图层，Harness 也不替 Agent 自动改名',
    !implementationLayerName.ok
        && implementationLayerName.issues.some((issue) => /用户可读/.test(issue) && /scene-line/.test(issue)),
    implementationLayerName.issues.join(' | ')
);

const derivedGradient = normalizeComposeDesignSpec({
    ...good,
    background: { kind: 'gradient', gradient: { fromHex: '#FFFFFF' } }
});
check('渐变缺项时失败，不从色板派生', !derivedGradient.ok && derivedGradient.issues.some((issue) => /background\.gradient/.test(issue)));

const photoPlan = planPhotoFullBleedPlacement({
    canvas: { width: 800, height: 800 },
    photo: { width: 3000, height: 4000 },
    subjectBox: { x: 0.3, y: 0.4, width: 0.4, height: 0.5 },
    targetRegion: { x: 0.5, y: 0.06, width: 0.45, height: 0.84 },
    fillRatio: 0.9
});
check('显式摄影构图可转换为确定性几何', photoPlan && photoPlan.width >= 800 && photoPlan.height >= 800, JSON.stringify(photoPlan));
check('摄影构图缺占比时不套默认值', planPhotoFullBleedPlacement({
    canvas: { width: 800, height: 800 },
    photo: { width: 3000, height: 4000 },
    subjectBox: { x: 0.3, y: 0.4, width: 0.4, height: 0.5 },
    targetRegion: { x: 0.5, y: 0.06, width: 0.45, height: 0.84 }
}) === null);

check('投影 none 不执行', planSubjectShadow({ kind: 'none' }) === null);
const shadowPlan = planSubjectShadow(good.subject.shadow);
check('显式投影参数原样进入 Photoshop 计划', shadowPlan?.angle === 104 && shadowPlan?.colorHex === '#3A2418' && shadowPlan?.opacity === 26);

const generated = normalizeComposeDesignSpec({
    ...good,
    background: {
        kind: 'generated',
        prompt: '低饱和亚麻与柔和侧光，左侧留白',
        referenceFilePath: 'E:/project/reference.jpg'
    }
});
check('显式 generated 背景通过', generated.ok, generated.issues.join(' | '));
if (generated.ok) {
    const prompt = buildBackdropPrompt(generated.spec);
    check('背景提示只消费 Agent 声明的文字区域', /explicitly declared/.test(prompt) && /do not include the product/i.test(prompt));
}

const modelHelp = describeComposeDesignForModel();
check('模型说明强调 Agent 作者权', /Harness 不提供品类预设/.test(modelHelp));
check('模型说明明确多个视觉元素不是固定模板', /同一 role 可以出现多次/.test(modelHelp) && /单素材上限/.test(modelHelp));
check('模型说明要求用户可读图层名且不由 Harness 自动改名', /用户可读/.test(modelHelp) && /绝不自动/.test(modelHelp));
check('模型说明不再暴露固定配方', !/repeatable_recipe|four-grid|固定配方/.test(modelHelp));
check(
    '模型说明区分另建候选与同文档修订，不把新文档自动当成更优版本',
    /document\.mode=new 会另建独立候选/.test(modelHelp)
        && /变化本身不等于质量结论/.test(modelHelp)
);

const priorCandidate = {
    version: 'design-fingerprint/v1',
    at: 1,
    documentName: '运动袜主图-A',
    documentId: 301,
    angle: '清爽运动感',
    treatment: 'photo',
    backgroundKind: 'photo',
    subjectFile: 'E:/project/M23A6055.jpg',
    regions: [
        { id: '主体·四色平铺', role: 'main-image', contentKind: 'image', contentSummary: 'M23A6055' },
        { id: '标题·多色防滑运动袜', role: 'title', contentKind: 'editable_text', contentSummary: '多色防滑运动袜' },
        { id: '场景·瑜伽普拉提', role: 'subtitle', contentKind: 'editable_text', contentSummary: '瑜伽 / 普拉提 / 室内运动' }
    ]
};
const reducedAlternative = {
    version: 'design-fingerprint/v1',
    at: 2,
    documentName: '运动袜主图-B',
    documentId: 302,
    angle: '纯商品陈列',
    treatment: 'photo',
    backgroundKind: 'photo',
    subjectFile: 'E:/project/M23A6055.jpg',
    regions: [
        { id: '主体·四色平铺', role: 'main-image', contentKind: 'image', contentSummary: 'M23A6055' }
    ]
};
const latestComparable = findLatestComparableDesign(reducedAlternative, [priorCandidate]);
const candidateComparison = compareDesignVersions(latestComparable, reducedAlternative);
check(
    '同素材另建更少元素时只报告结构减法与待比较，不判定文字必须保留',
    candidateComparison.relation === 'new_document_alternative'
        && candidateComparison.sameSubjectAsset === true
        && candidateComparison.structuralDirection === 'reduced'
        && candidateComparison.previous.regionCount === 3
        && candidateComparison.current.regionCount === 1
        && candidateComparison.removed.some((region) => region.role === 'title')
        && candidateComparison.removed.some((region) => region.role === 'subtitle')
        && candidateComparison.needsComparativeReview === true
        && candidateComparison.boundaries.structuralDifferenceIsNotQualityVerdict === true
        && candidateComparison.boundaries.doesNotRequireTextOrMinimumElementCount === true
        && candidateComparison.boundaries.doesNotSelectWinner === true,
    JSON.stringify(candidateComparison)
);
const sameDocumentReduction = compareDesignVersions(
    priorCandidate,
    { ...reducedAlternative, documentId: priorCandidate.documentId }
);
check(
    '同文档结构减法也只要求比较证据，不让删减动作自动成为质量升级',
    sameDocumentReduction.relation === 'same_document_revision'
        && sameDocumentReduction.structuralDirection === 'reduced'
        && sameDocumentReduction.needsComparativeReview === true
        && sameDocumentReduction.boundaries.doesNotSelectWinner === true,
    JSON.stringify(sameDocumentReduction)
);

async function verifyComposeDesignResultProjection() {
    const toolLayerIds = {
        createRectangle: 11,
        renderLayout: 12
    };
    const executedCalls = [];
    const result = await executeComposeDesign({
        ...good,
        rationale: {
            materials: selectionReason,
            structure: '商品摄影作为第一层级，标题只占辅助位置。'
        }
    }, {
        executeToolCall: async (toolName, params) => {
            executedCalls.push({ toolName, params });
            if (toolName === 'createDocument') {
                return { success: true, documentId: 701 };
            }
            if (toolName === 'createRectangle') {
                return { success: true, layerId: toolLayerIds.createRectangle };
            }
            if (toolName === 'renderLayout') {
                return {
                    success: true,
                    qualityState: 'passed',
                    created: [{ id: '主体·产品摄影', layerId: toolLayerIds.renderLayout }],
                    createdLayerIds: [toolLayerIds.renderLayout],
                    subjectLayerIds: [toolLayerIds.renderLayout],
                    stageGroupName: '点击图·春日薄款',
                    snapshot: { data: 'fixture', mediaType: 'image/jpeg' }
                };
            }
            return { success: true };
        },
        inferLayerId: (toolName, _params, toolResult) => toolResult?.layerId || toolLayerIds[toolName],
        invokeMain: async (channel) => {
            if (channel === 'resource:getAssetSubjectBox') {
                return { success: false, error: 'fixture deliberately omits subject geometry' };
            }
            if (channel === 'designWorkshop:readRecentDesigns') {
                return { success: false };
            }
            return { success: true };
        },
        projectPath: 'E:/project'
    });
    check(
        'composeDesign 成功结果单独返回模型的选图依据，并在结构化收据中保持同一原话',
        result.success === true
            && result.materialSelectionReasonText === selectionReason
            && result.artifactFacts?.materialSelection?.modelAuthoredReason === selectionReason,
        JSON.stringify(result)
    );
    check(
        'composeDesign 新文档使用透明机械底，不在显式背景步骤前注入白色视觉答案',
        executedCalls.find((call) => call.toolName === 'createDocument')?.params?.backgroundColor === 'transparent',
        JSON.stringify(executedCalls.find((call) => call.toolName === 'createDocument'))
    );

    const chatPanelSource = fs.readFileSync(
        path.join(root, 'src/renderer/components/ChatPanel.tsx'),
        'utf8'
    );
    check(
        'ChatPanel 按本轮具体内容投影选图依据，不再用任意长思考代替',
        chatPanelSource.includes('resolveMaterialSelectionReasonProjection({')
            && chatPanelSource.includes('visibleContents: collectedSteps.map((step) => step.content)')
            && !chatPanelSource.includes('spokeBeforeActing')
    );
}

function finish() {
    if (failed > 0) {
        console.error(`\ncomposeDesign 契约验证失败：${failed} 项`);
        process.exit(1);
    }
    console.log('\ncomposeDesign 契约验证通过。');
}

verifyComposeDesignResultProjection()
    .then(finish)
    .catch((error) => {
        failed += 1;
        console.error(`❌ composeDesign 结果投影验证异常: ${error?.stack || error}`);
        finish();
    });
