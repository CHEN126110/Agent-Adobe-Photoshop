const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

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
    evaluateImagePlacementQuality
} = require(path.join(root, 'src/shared/layout/image-placement-quality.ts'));
const {
    IMAGE_PLACEMENT_REVIEW_CAPTURE_LIMIT,
    buildImagePlacementReviewPlan
} = require(path.join(root, 'src/shared/layout/image-placement-review-plan.ts'));
const {
    buildImagePlacementPrewritePlan
} = require(path.join(root, 'src/shared/layout/image-placement-prewrite-plan.ts'));
const {
    buildToolAcceptanceVerification
} = require(path.join(root, 'src/shared/acceptance/tool-acceptance.ts'));
const {
    buildCompoundPhotoshopWriteExceptionSettlement
} = require(path.join(root, 'src/shared/compound-photoshop-write-settlement.ts'));
const {
    attachPhotoshopModalRecoveryEvidenceIfUnresolved,
    readPhotoshopModalRecoveryEvidence
} = require(path.join(root, 'src/shared/agent-react-observation-contract.ts'));
const {
    readPhotoshopOperationResult,
    requiresPhotoshopOperationReadback
} = require(path.join(root, 'src/shared/photoshop-operation-result.ts'));
const {
    generateToolSchemas
} = require(path.join(root, 'src/renderer/services/agent-runtime/tool-schemas.ts'));
const {
    sanitizeUserVisibleDiagnosticText
} = require(path.join(root, 'src/shared/chat-response-cleaner.ts'));
const {
    buildCodexStrictOutputSchema,
    restoreCodexStrictOutputValue
} = require(path.join(root, 'src/main/services/codex-strict-output-schema.ts'));
const {
    buildCodexHostEnvelopeOutputSchema,
    buildCodexStructuredToolOutputSchema,
    parseCodexDirectToolArgumentsOutput,
    parseCodexStructuredAssistantOutput
} = require(path.join(root, 'src/main/services/codex-subscription-service.ts'));

const toolExecutorSource = fs.readFileSync(
    path.join(root, 'src/renderer/services/tool-executor.service.ts'),
    'utf8'
);
const composeExecutorSource = fs.readFileSync(
    path.join(root, 'src/renderer/services/design-workshop/compose-design.executor.ts'),
    'utf8'
);
const resolvedImagePreflightSource = fs.readFileSync(
    path.join(root, 'src/shared/layout/resolved-image-placement-preflight.ts'),
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

function collectStrictOutputSchemaIssues(schema, currentPath = '$') {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return [];
    const issues = [];
    for (const unsupported of ['allOf', 'oneOf', 'not', 'if', 'then', 'else']) {
        if (Object.prototype.hasOwnProperty.call(schema, unsupported)) {
            issues.push(`${currentPath}.${unsupported}`);
        }
    }
    if (schema.type === 'object') {
        const properties = schema.properties && typeof schema.properties === 'object'
            ? schema.properties
            : {};
        const propertyNames = Object.keys(properties).sort();
        const requiredNames = Array.isArray(schema.required)
            ? [...schema.required].sort()
            : [];
        if (schema.additionalProperties !== false) issues.push(`${currentPath}.additionalProperties`);
        if (JSON.stringify(propertyNames) !== JSON.stringify(requiredNames)) {
            issues.push(`${currentPath}.required`);
        }
        for (const [key, nested] of Object.entries(properties)) {
            issues.push(...collectStrictOutputSchemaIssues(nested, `${currentPath}.properties.${key}`));
        }
    }
    if (schema.items) {
        issues.push(...collectStrictOutputSchemaIssues(schema.items, `${currentPath}.items`));
    }
    if (Array.isArray(schema.anyOf)) {
        schema.anyOf.forEach((branch, index) => {
            issues.push(...collectStrictOutputSchemaIssues(branch, `${currentPath}.anyOf[${index}]`));
        });
    }
    if (schema.$defs && typeof schema.$defs === 'object') {
        for (const [key, nested] of Object.entries(schema.$defs)) {
            issues.push(...collectStrictOutputSchemaIssues(nested, `${currentPath}.$defs.${key}`));
        }
    }
    return issues;
}

function measureStructuredOutputLimits(schema) {
    const metrics = {
        objectPropertyCount: 0,
        maxObjectDepth: 0,
        restrictedStringChars: 0,
        enumValueCount: 0
    };

    function visit(node, objectDepth) {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
            node.forEach((item) => visit(item, objectDepth));
            return;
        }

        const nextObjectDepth = node.type === 'object'
            ? objectDepth + 1
            : objectDepth;
        metrics.maxObjectDepth = Math.max(metrics.maxObjectDepth, nextObjectDepth);

        if (node.properties && typeof node.properties === 'object') {
            const entries = Object.entries(node.properties);
            metrics.objectPropertyCount += entries.length;
            metrics.restrictedStringChars += entries.reduce((total, [key]) => total + key.length, 0);
            entries.forEach(([, nested]) => visit(nested, nextObjectDepth));
        }
        for (const definitionsKey of ['$defs', 'definitions']) {
            if (!node[definitionsKey] || typeof node[definitionsKey] !== 'object') continue;
            const entries = Object.entries(node[definitionsKey]);
            metrics.restrictedStringChars += entries.reduce((total, [key]) => total + key.length, 0);
            entries.forEach(([, nested]) => visit(nested, nextObjectDepth));
        }
        if (Array.isArray(node.enum)) {
            metrics.enumValueCount += node.enum.length;
            metrics.restrictedStringChars += node.enum.reduce((total, value) => (
                total + (typeof value === 'string' ? value.length : 0)
            ), 0);
        }
        if (typeof node.const === 'string') {
            metrics.restrictedStringChars += node.const.length;
        }
        for (const nestedKey of ['items', 'additionalProperties', 'not', 'if', 'then', 'else']) {
            visit(node[nestedKey], nextObjectDepth);
        }
        for (const branchesKey of ['anyOf', 'oneOf', 'allOf']) {
            visit(node[branchesKey], nextObjectDepth);
        }
    }

    visit(schema, 0);
    return metrics;
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

function buildPlacementAcceptanceSnapshot(historyStateId, layers) {
    return {
        success: true,
        hasDocument: true,
        documentState: 'present',
        historyStateRef: { documentId: 901, historyStateId },
        document: { id: 901, name: '图片落位验收.psd', width: 800, height: 800, resolution: 72 },
        selectedLayerIds: layers.length ? [layers[layers.length - 1].id] : [],
        summary: {
            totalLayers: layers.length,
            selectedLayers: layers.length ? 1 : 0,
            visibleLayers: layers.length,
            hiddenLayers: 0,
            textLayers: 0,
            groupLayers: 0,
            pixelLayers: layers.length,
            adjustmentLayers: 0,
            smartObjectLayers: layers.length,
            otherLayers: 0
        },
        layers,
        warnings: []
    };
}

const focalClampedAcceptance = buildToolAcceptanceVerification({
    toolName: 'placeImage',
    params: {
        filePath: 'C:\\素材\\商品图.jpg',
        name: '商品图',
        targetBounds: { x: 0, y: 0, width: 100, height: 100 },
        targetFit: 'cover',
        targetAnchor: 'center',
        focalPoint: { x: 0, y: 0 }
    },
    result: {
        success: true,
        layerId: 77,
        placement: {
            focalPointClamped: true,
            focalDeviationPx: 50,
            geometryVerification: { verified: true, issues: [] }
        }
    },
    before: { snapshot: buildPlacementAcceptanceSnapshot(10, []) },
    after: {
        snapshot: buildPlacementAcceptanceSnapshot(11, [{
            id: 77,
            name: '商品图',
            kind: 'smartObject',
            visible: true,
            locked: false,
            depth: 0,
            index: 0,
            parentId: null,
            parentName: null,
            path: '商品图',
            selected: true,
            bounds: { left: 0, top: 0, right: 100, bottom: 200, width: 100, height: 200 }
        }])
    }
});
check(
    '几何执行正确但焦点被夹紧时仍需视觉复核，不能假通过',
    focalClampedAcceptance.verified === false
        && focalClampedAcceptance.assertionStatus === 'needs_review'
        && focalClampedAcceptance.assertions?.some((assertion) => (
            assertion.id === 'placeImage.targetBounds'
                && assertion.status === 'needs_review'
                && assertion.summary.includes('关注点受到边界约束')
        )),
    JSON.stringify(focalClampedAcceptance)
);
check(
    'composeDesign 的摄影图和图片背景直接按最终图框一次置入，不再先错放后叠加 transform',
    composeExecutorSource.includes("run('一次置入摄影图最终位置', 'placeImage'")
        && composeExecutorSource.includes("placementIntent: 'planned_full_frame'")
        && !composeExecutorSource.includes("'摄影图定大小定位置', 'transformLayer'")
        && !composeExecutorSource.includes("'背景落位', 'transformLayer'")
        && !composeExecutorSource.includes("'transformLayer',\n    'renameLayer'"),
    'composeDesign 仍保留 place→transform 的两次写入路径'
);
const renderLayoutExecutionSource = toolExecutorSource.slice(
    toolExecutorSource.indexOf("if (toolName === 'renderLayout')"),
    toolExecutorSource.indexOf("if (toolName === 'fitLayerSubjectToRegion')")
);
check(
    'renderLayout 在图片写入前预演主体与图框，subjectFillRatio 由单次 placeImage 兑现',
    renderLayoutExecutionSource.includes('preflightResolvedImagePlacements({')
        && resolvedImagePreflightSource.includes('buildImagePlacementPrewritePlan({')
        && resolvedImagePreflightSource.includes('plansByBlockId.set(block.id, prewriteResult.plan)')
        && renderLayoutExecutionSource.includes('const finalTargetBounds = prewritePlan?.finalWrite?.targetBounds')
        && renderLayoutExecutionSource.includes("'precomputed_subject_fit_single_place'")
        && !renderLayoutExecutionSource.includes("executeToolCall('fitLayerSubjectToRegion'"),
    'renderLayout 仍存在首写后再调用 subject-fit 的二次变换路径'
);
check(
    'composeDesign 与 renderLayout 共用同一图片写前预演，并且外层预演早于首个 Photoshop 写入',
    composeExecutorSource.includes('preflightResolvedImagePlacements({')
        && composeExecutorSource.indexOf("step: '预演构图中的全部图片落位'")
            < composeExecutorSource.indexOf("run('建画布', 'createDocument'")
        && (toolExecutorSource.match(/preflightResolvedImagePlacements\(\{/g) || []).length === 1
        && (composeExecutorSource.match(/preflightResolvedImagePlacements\(\{/g) || []).length === 1,
    '图片落位预演仍在两个执行器中各写一套，或 composeDesign 仍先写后验'
);
check(
    'renderLayout 每个成功原子写立即登记图层，并在失败路径同样读取最终 Host revision',
    renderLayoutExecutionSource.indexOf("createdLayerIds.push(boxLayerId)")
        < renderLayoutExecutionSource.indexOf("if (boxResult && boxResult.success === false)")
        && renderLayoutExecutionSource.indexOf("createdLayerIds.push(textLayerId)")
            < renderLayoutExecutionSource.indexOf("if (textResult && textResult.success === false)")
        && renderLayoutExecutionSource.includes('if (layoutStartHistoryStateRef && !layoutFinalWriteHistoryStateRef)'),
    'selling-point 半成功图层仍可能从收据消失，或失败后没有最终版本结算'
);
check(
    'standalone renderLayout 的非结构化异常也用写前 Host revision 结算为 applied 或 unknown',
    toolExecutorSource.includes('compoundWriteStartHistoryStateRef = layoutStartHistoryStateRef')
        && toolExecutorSource.includes('compoundWriteExecutionArmed = true')
        && renderLayoutExecutionSource.indexOf('compoundWriteExecutionArmed = true')
            < renderLayoutExecutionSource.indexOf('for (const b of resolved)')
        && toolExecutorSource.includes("if (toolName === 'renderLayout' && compoundWriteExecutionArmed)")
        && toolExecutorSource.includes('buildCompoundPhotoshopWriteExceptionSettlement({')
        && toolExecutorSource.includes('不能直接重放整次布局'),
    'renderLayout 抛出异常时仍可能绕过最终 Host revision 结算'
);
const appliedCompoundSettlement = buildCompoundPhotoshopWriteExceptionSettlement({
    operationId: 'render-layout-applied-fixture',
    toolName: 'renderLayout',
    before: { documentId: 8, historyStateId: 10 },
    after: { documentId: 8, historyStateId: 11 },
    message: 'fixture exception'
});
check(
    'renderLayout 异常结算在同文档 history 前进时生成 Runtime 可读的 applied operation envelope',
    appliedCompoundSettlement.mutationObserved === true
        && appliedCompoundSettlement.photoshopHistoryTransition?.after?.historyStateId === 11
        && readPhotoshopOperationResult(appliedCompoundSettlement)?.status === 'applied'
        && requiresPhotoshopOperationReadback(appliedCompoundSettlement) === true,
    JSON.stringify(appliedCompoundSettlement)
);
const unknownCompoundSettlement = buildCompoundPhotoshopWriteExceptionSettlement({
    operationId: 'render-layout-unknown-fixture',
    toolName: 'renderLayout',
    before: { documentId: 8, historyStateId: 10 },
    message: 'fixture exception without final revision'
});
check(
    'renderLayout 异常结算缺最终 revision 时生成正式 unknown envelope，Runtime 必须建立读回写锁',
    unknownCompoundSettlement.mutationObserved === false
        && readPhotoshopOperationResult(unknownCompoundSettlement)?.status === 'unknown'
        && requiresPhotoshopOperationReadback(unknownCompoundSettlement) === true,
    JSON.stringify(unknownCompoundSettlement)
);
const strictModalRecoveryEvidence = readPhotoshopModalRecoveryEvidence({
    success: false,
    recoveryRequired: true,
    environmentState: 'photoshop_native_modal_suspected',
    environmentObservation: {
        capability: 'capturePhotoshopWindow',
        scope: 'adobe_photoshop_application_window'
    }
});
const unresolvedWithModalRecovery = attachPhotoshopModalRecoveryEvidenceIfUnresolved(
    unknownCompoundSettlement,
    strictModalRecoveryEvidence
);
const appliedWithoutModalRecovery = attachPhotoshopModalRecoveryEvidenceIfUnresolved(
    appliedCompoundSettlement,
    strictModalRecoveryEvidence
);
check(
    '普通写入 timeout 只有在 operation 仍未决时保留严格 modal 恢复证据，已证明 applied 时不伪报堵塞',
    unresolvedWithModalRecovery.environmentState === 'photoshop_native_modal_suspected'
        && unresolvedWithModalRecovery.environmentObservation?.capability === 'capturePhotoshopWindow'
        && appliedWithoutModalRecovery.environmentState === undefined
        && readPhotoshopModalRecoveryEvidence({
            success: true,
            recoveryRequired: true,
            environmentState: 'photoshop_native_modal_suspected',
            environmentObservation: {
                capability: 'capturePhotoshopWindow',
                scope: 'adobe_photoshop_application_window'
            }
        }) === undefined
        && readPhotoshopModalRecoveryEvidence({
            success: false,
            recoveryRequired: false,
            environmentState: 'photoshop_native_modal_suspected',
            environmentObservation: {
                capability: 'capturePhotoshopWindow',
                scope: 'adobe_photoshop_application_window'
            }
        }) === undefined,
    JSON.stringify({ unresolvedWithModalRecovery, appliedWithoutModalRecovery })
);
check(
    'renderLayout 用组级 swap 延迟删除旧稿，保护 owned 后代并如实记录失败清理',
    renderLayoutExecutionSource.indexOf('ownedLayerPreflightIssues')
        < renderLayoutExecutionSource.indexOf("action: 'deletePreviousStageGroup'")
        && renderLayoutExecutionSource.indexOf('candidateStructureVerified')
            < renderLayoutExecutionSource.indexOf("action: 'deletePreviousStageGroup'")
        && renderLayoutExecutionSource.includes('oldStagePreservedUntilCandidateVerified: true')
        && renderLayoutExecutionSource.includes('hierarchyNodeContainsAnyLayerId(layer, ownedLayerIds)')
        && renderLayoutExecutionSource.includes("action: 'promoteStageCandidateGroup'")
        && renderLayoutExecutionSource.includes('name === `${stageGroupName}·新稿待切换`')
        && renderLayoutExecutionSource.includes("action: 'restoreOwnedLayerAfterCandidateFailure'")
        && renderLayoutExecutionSource.includes("action: 'hideRetainedFailedStageCandidateGroup'")
        && renderLayoutExecutionSource.includes('failedCandidateRetained,')
        && renderLayoutExecutionSource.includes('failedCandidateHidden,')
        && renderLayoutExecutionSource.includes('cleanupCreatedLayer')
        && renderLayoutExecutionSource.includes("'裁切基底创建失败但执行结果仍返回图层身份'")
        && renderLayoutExecutionSource.includes('cleanupFailures: cleanupFailures.length > 0')
        && renderLayoutExecutionSource.includes('stageSwapReceipt,'),
    '旧稿仍可能在新组验真前删除，owned 后代或失败清理没有进入结构化 swap 收据'
);
check(
    'composeDesign 的主体占比与普通摄影图框预演都早于新建文档，图片语义名进入首次 placeImage',
    composeExecutorSource.indexOf('photoPrewritePlan = planPhotoFullBleedPlacement({')
        < composeExecutorSource.indexOf("run('建画布', 'createDocument'")
        && composeExecutorSource.indexOf('const framePrewrite = buildImagePlacementPrewritePlan({')
            < composeExecutorSource.indexOf("run('建画布', 'createDocument'")
        && composeExecutorSource.includes('name: backgroundSemanticName')
        && !composeExecutorSource.includes("run('语义命名素材层', 'renameLayer'"),
    '摄影预演仍晚于 createDocument，或图片仍需第二次 rename'
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
const allAgentTools = generateToolSchemas();
const composeDesignTool = allAgentTools.find((tool) => tool.name === 'composeDesign');
const composeDesignToolSchema = composeDesignTool?.inputSchema;
const composeTypographySchema = composeDesignToolSchema
    ?.properties?.layout?.properties?.visualStyle?.properties?.typography;
const composeSubjectSchema = composeDesignToolSchema?.properties?.subject;
const composeBackgroundPlacementSchema = composeDesignToolSchema
    ?.properties?.background?.properties?.imagePlacement;
const composeRegionPlacementSchema = composeDesignToolSchema
    ?.properties?.layout?.properties?.regions?.items?.properties?.imagePlacement;
const composeToolSchemaBeforeStrictProjection = JSON.stringify(composeDesignToolSchema);
const composeStrictOutputSchema = buildCodexStrictOutputSchema({
    ...composeDesignToolSchema,
    additionalProperties: false
});
const composeStrictOutputSchemaIssues = collectStrictOutputSchemaIssues(composeStrictOutputSchema);
const allToolStrictProjectionFailures = allAgentTools.flatMap((tool) => {
    try {
        const projected = buildCodexStrictOutputSchema({
            ...tool.inputSchema,
            additionalProperties: false
        });
        const issues = collectStrictOutputSchemaIssues(projected);
        return issues.length > 0 ? [{ tool: tool.name, issues }] : [];
    } catch (error) {
        return [{ tool: tool.name, issues: [String(error?.message || error)] }];
    }
});
check(
    'Codex strict wire projection 覆盖当前全部 Agent Tool schema',
    allToolStrictProjectionFailures.length === 0,
    JSON.stringify(allToolStrictProjectionFailures.slice(0, 8))
);
const productionNativeOutputSchema = buildCodexStructuredToolOutputSchema(allAgentTools);
const productionNativeWireSchema = buildCodexStrictOutputSchema(productionNativeOutputSchema);
const productionNativeSchemaIssues = collectStrictOutputSchemaIssues(productionNativeWireSchema);
const productionNativeSchemaMetrics = measureStructuredOutputLimits(productionNativeWireSchema);
const productionHostEnvelopeValidator = new Ajv({ allErrors: true, strict: false }).compile(
    buildCodexHostEnvelopeOutputSchema(allAgentTools)
);
const validProductionEnvelope = {
    content: '',
    toolCalls: [{ id: 'call-1', name: 'getDocumentInfo', arguments: {} }],
    stopReason: 'tool_use'
};
const invalidProductionEnvelope = {
    content: '',
    toolCalls: [{ id: 'call-2', name: 'unknownTool', arguments: {} }],
    stopReason: 'tool_use'
};
const validProductionEnvelopeAccepted = productionHostEnvelopeValidator(validProductionEnvelope);
const invalidProductionEnvelopeRejected = !productionHostEnvelopeValidator(invalidProductionEnvelope);
const getDocumentInfoTool = allAgentTools.find((tool) => tool.name === 'getDocumentInfo');
const productionParserTools = [composeDesignTool, getDocumentInfoTool].filter(Boolean);
const productionParserOutputSchema = buildCodexStructuredToolOutputSchema(productionParserTools);
const productionParserEnvelopeValidator = new Ajv({ allErrors: true, strict: false }).compile(
    buildCodexHostEnvelopeOutputSchema(productionParserTools)
);
const parsedProductionEnvelope = parseCodexStructuredAssistantOutput(JSON.stringify({
    content: '',
    toolCalls: [
        {
            id: 'call-compose',
            name: 'composeDesign',
            arguments: { rationale: null }
        },
        {
            id: 'call-read',
            name: 'getDocumentInfo',
            arguments: {}
        }
    ],
    stopReason: 'tool_use'
}), productionParserOutputSchema, productionParserEnvelopeValidator);
const parsedDirectComposeArguments = parseCodexDirectToolArgumentsOutput(
    JSON.stringify({ rationale: null }),
    composeDesignTool
);
let unknownProductionDiscriminatorRejected = false;
try {
    parseCodexStructuredAssistantOutput(JSON.stringify({
        content: '',
        toolCalls: [{ id: 'call-unknown', name: 'unknownTool', arguments: {} }],
        stopReason: 'tool_use'
    }), productionParserOutputSchema, productionParserEnvelopeValidator);
} catch {
    unknownProductionDiscriminatorRejected = true;
}
let duplicateProductionToolRejected = false;
try {
    buildCodexStructuredToolOutputSchema([allAgentTools[0], allAgentTools[0]]);
} catch {
    duplicateProductionToolRejected = true;
}
let embeddedReferenceProductionToolRejected = false;
try {
    buildCodexStructuredToolOutputSchema([{
        name: 'embeddedReferenceFixture',
        description: 'test fixture',
        inputSchema: {
            type: 'object',
            properties: { value: { $ref: '#/$defs/value' } },
            required: ['value'],
            $defs: { value: { type: 'string' } }
        }
    }]);
} catch {
    embeddedReferenceProductionToolRejected = true;
}
check(
    'Codex 生产输出 schema 直接覆盖全部 Tool、保留轻量 Host 校验且不重复工具描述',
    productionNativeSchemaIssues.length === 0
        && productionNativeOutputSchema.properties?.toolCalls?.items?.anyOf?.length === allAgentTools.length
        && productionNativeOutputSchema.properties.toolCalls.items.anyOf.every((branch) => (
            !Object.prototype.hasOwnProperty.call(branch, 'description')
        ))
        && validProductionEnvelopeAccepted
        && invalidProductionEnvelopeRejected
        && parsedProductionEnvelope.toolCalls.length === 2
        && parsedProductionEnvelope.toolCalls[0].name === 'composeDesign'
        && !Object.prototype.hasOwnProperty.call(
            parsedProductionEnvelope.toolCalls[0].arguments,
            'rationale'
        )
        && parsedProductionEnvelope.toolCalls[1].name === 'getDocumentInfo'
        && !Object.prototype.hasOwnProperty.call(parsedDirectComposeArguments, 'rationale')
        && unknownProductionDiscriminatorRejected
        && duplicateProductionToolRejected
        && embeddedReferenceProductionToolRejected,
    JSON.stringify({
        productionNativeSchemaIssues: productionNativeSchemaIssues.slice(0, 8),
        hostErrors: productionHostEnvelopeValidator.errors,
        parsedProductionEnvelope,
        parsedDirectComposeArguments,
        unknownProductionDiscriminatorRejected,
        duplicateProductionToolRejected,
        embeddedReferenceProductionToolRejected
    })
);
check(
    'Codex 全量原生 Tool 联合低于 Structured Outputs 官方结构上限',
    productionNativeSchemaMetrics.objectPropertyCount <= 5000
        && productionNativeSchemaMetrics.maxObjectDepth <= 10
        && productionNativeSchemaMetrics.restrictedStringChars <= 120000
        && productionNativeSchemaMetrics.enumValueCount <= 1000,
    JSON.stringify({
        ...productionNativeSchemaMetrics,
        serializedBytes: Buffer.byteLength(JSON.stringify(productionNativeWireSchema), 'utf8')
    })
);
check(
    'Codex 直修 schema 递归封闭 composeDesign 全部对象且不携带 strict 不支持的条件关键字',
    composeStrictOutputSchemaIssues.length === 0
        && composeStrictOutputSchema.properties?.rationale?.anyOf?.[0]?.additionalProperties === false
        && ['angle', 'purpose', 'claim', 'materials', 'structure'].every((key) => (
            composeStrictOutputSchema.properties?.rationale?.anyOf?.[0]?.required?.includes(key)
        )),
    JSON.stringify(composeStrictOutputSchemaIssues)
);
check(
    'Codex strict wire projection 不改写 composeDesign 原 Tool schema 的 optional/required 业务语义',
    JSON.stringify(composeDesignToolSchema) === composeToolSchemaBeforeStrictProjection
        && !composeDesignToolSchema?.required?.includes('rationale')
        && !composeDesignToolSchema?.properties?.rationale?.required,
    JSON.stringify(composeDesignToolSchema?.properties?.rationale)
);

const strictProjectionFixture = {
    type: 'object',
    additionalProperties: false,
    properties: {
        requiredText: { type: 'string' },
        optionalText: { type: 'string' },
        nullableText: { type: ['string', 'null'] },
        optionalNullableText: { type: ['string', 'null'] },
        nested: {
            type: 'object',
            properties: {
                requiredNumber: { type: 'number' },
                optionalNumber: { type: 'number' }
            },
            required: ['requiredNumber']
        },
        rows: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    note: { type: 'string' }
                },
                required: ['id']
            }
        },
        freeObject: { type: 'object', additionalProperties: true },
        typedFreeObject: { type: 'object', additionalProperties: { type: 'string' } },
        requiredNullableFreeObject: {
            type: ['object', 'null'],
            additionalProperties: true
        },
        referenced: { $ref: '#/$defs/referenceItem' }
    },
    required: [
        'requiredText',
        'nullableText',
        'nested',
        'rows',
        'requiredNullableFreeObject',
        'referenced'
    ],
    $defs: {
        referenceItem: {
            type: 'object',
            properties: {
                id: { type: 'string' },
                note: { type: 'string' }
            },
            required: ['id']
        }
    }
};
const strictProjectionFixtureBefore = JSON.stringify(strictProjectionFixture);
const strictProjectionWireSchema = buildCodexStrictOutputSchema(strictProjectionFixture);
const strictProjectionRestored = restoreCodexStrictOutputValue({
    requiredText: 'required',
    optionalText: null,
    nullableText: null,
    optionalNullableText: null,
    nested: { requiredNumber: 1, optionalNumber: null },
    rows: [{ id: 'row-1', note: null }],
    freeObject: JSON.stringify({ arbitrary: { depth: 2 } }),
    typedFreeObject: JSON.stringify({ label: 'kept' }),
    requiredNullableFreeObject: null,
    referenced: { id: 'ref-1', note: null }
}, strictProjectionFixture);
check(
    'Codex strict wire 只清理原可选 null，保留显式 nullable 并恢复数组、$ref/$defs 与动态对象',
    JSON.stringify(strictProjectionFixture) === strictProjectionFixtureBefore
        && collectStrictOutputSchemaIssues(strictProjectionWireSchema).length === 0
        && !Object.prototype.hasOwnProperty.call(strictProjectionRestored, 'optionalText')
        && strictProjectionRestored.nullableText === null
        && Object.prototype.hasOwnProperty.call(strictProjectionRestored, 'optionalNullableText')
        && strictProjectionRestored.optionalNullableText === null
        && !Object.prototype.hasOwnProperty.call(strictProjectionRestored.nested, 'optionalNumber')
        && !Object.prototype.hasOwnProperty.call(strictProjectionRestored.rows[0], 'note')
        && strictProjectionRestored.freeObject?.arbitrary?.depth === 2
        && strictProjectionRestored.typedFreeObject?.label === 'kept'
        && strictProjectionRestored.requiredNullableFreeObject === null
        && !Object.prototype.hasOwnProperty.call(strictProjectionRestored.referenced, 'note')
        && strictProjectionWireSchema.properties?.freeObject?.type?.includes('string')
        && strictProjectionWireSchema.properties?.typedFreeObject?.type?.includes('string')
        && strictProjectionWireSchema.properties?.requiredNullableFreeObject?.anyOf?.some((branch) => (
            branch.type === 'null'
        )),
    JSON.stringify({ strictProjectionWireSchema, strictProjectionRestored })
);
let standaloneOpenUnionRejected = false;
try {
    buildCodexStrictOutputSchema({
        anyOf: [
            { type: 'string' },
            { type: 'object', additionalProperties: true }
        ]
    });
} catch {
    standaloneOpenUnionRejected = true;
}
check(
    'Codex strict wire 对无法无损恢复的 standalone open-object union fail closed',
    standaloneOpenUnionRejected
);
const getDocumentInfoToolSchema = getDocumentInfoTool?.inputSchema;
const nativeToolEnvelopeFixture = {
    type: 'object',
    additionalProperties: false,
    properties: {
        content: { type: 'string' },
        toolCalls: {
            type: 'array',
            items: {
                anyOf: [
                    {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            id: { type: 'string' },
                            name: { type: 'string', const: 'composeDesign' },
                            arguments: { ...composeDesignToolSchema, additionalProperties: false }
                        },
                        required: ['id', 'name', 'arguments']
                    },
                    {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            id: { type: 'string' },
                            name: { type: 'string', const: 'getDocumentInfo' },
                            arguments: { ...getDocumentInfoToolSchema, additionalProperties: false }
                        },
                        required: ['id', 'name', 'arguments']
                    }
                ]
            }
        },
        stopReason: { type: 'string', enum: ['end_turn', 'tool_use'] }
    },
    required: ['content', 'toolCalls', 'stopReason']
};
const nativeToolEnvelopeWireSchema = buildCodexStrictOutputSchema(nativeToolEnvelopeFixture);
check(
    'Codex 原生 Tool arguments 使用 name.const 可恢复联合，并覆盖完整 composeDesign schema',
    collectStrictOutputSchemaIssues(nativeToolEnvelopeWireSchema).length === 0
        && nativeToolEnvelopeWireSchema.properties?.toolCalls?.items?.anyOf?.[0]
            ?.properties?.name?.const === 'composeDesign'
        && nativeToolEnvelopeWireSchema.properties?.toolCalls?.items?.anyOf?.[1]
            ?.properties?.name?.const === 'getDocumentInfo',
    JSON.stringify(collectStrictOutputSchemaIssues(nativeToolEnvelopeWireSchema).slice(0, 8))
);
const discriminatedRestoreFixture = {
    anyOf: [
        {
            type: 'object',
            additionalProperties: false,
            properties: {
                name: { type: 'string', const: 'composeDesign' },
                arguments: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        requiredText: { type: 'string' },
                        optionalText: { type: 'string' }
                    },
                    required: ['requiredText']
                }
            },
            required: ['name', 'arguments']
        },
        {
            type: 'object',
            additionalProperties: false,
            properties: {
                name: { type: 'string', const: 'getDocumentInfo' },
                arguments: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {},
                    required: []
                }
            },
            required: ['name', 'arguments']
        }
    ]
};
const restoredDiscriminatedCall = restoreCodexStrictOutputValue({
    name: 'composeDesign',
    arguments: { requiredText: '中文与 C:\\项目\\素材.jpg', optionalText: null }
}, discriminatedRestoreFixture);
const unknownDiscriminatorCall = restoreCodexStrictOutputValue({
    name: 'unknownTool',
    arguments: { requiredText: 'keep', optionalText: null }
}, discriminatedRestoreFixture);
let duplicateDiscriminatorRejected = false;
try {
    buildCodexStrictOutputSchema({
        anyOf: discriminatedRestoreFixture.anyOf.map((branch) => ({
            ...branch,
            properties: {
                ...branch.properties,
                name: { type: 'string', const: 'duplicate' }
            }
        }))
    });
} catch {
    duplicateDiscriminatorRejected = true;
}
const schemasWithEmbeddedRefs = allAgentTools.filter((tool) => (
    /"(?:\$ref|\$defs|definitions)"\s*:/.test(JSON.stringify(tool.inputSchema))
));
check(
    'Codex name.const 恢复只清理命中分支的 optional null，未知或重复 discriminator fail closed',
    restoredDiscriminatedCall.name === 'composeDesign'
        && restoredDiscriminatedCall.arguments.requiredText === '中文与 C:\\项目\\素材.jpg'
        && !Object.prototype.hasOwnProperty.call(restoredDiscriminatedCall.arguments, 'optionalText')
        && unknownDiscriminatorCall.arguments.optionalText === null
        && duplicateDiscriminatorRejected
        && schemasWithEmbeddedRefs.length === 0,
    JSON.stringify({ restoredDiscriminatedCall, unknownDiscriminatorCall, schemasWithEmbeddedRefs })
);
check(
    'composeDesign 模型 schema 与执行校验同时要求背景决定和明确字体',
    composeDesignToolSchema?.required?.includes('background')
        && ['title', 'subtitle', 'body', 'sellingPoint'].every((role) => (
            composeTypographySchema?.properties?.[role]?.required?.includes('fontName')
        ))
);
const composePhotoSubjectBranch = composeSubjectSchema?.oneOf?.find((branch) => (
    branch?.properties?.treatment?.enum?.includes('photo')
));
check(
    'composeDesign Provider 允许完整摄影关系只声明 region.imagePlacement，不强迫伪造主体占比',
    composePhotoSubjectBranch?.required?.includes('treatment')
        && composePhotoSubjectBranch.required.includes('shadow')
        && !composePhotoSubjectBranch.required.includes('fillRatio'),
    JSON.stringify(composePhotoSubjectBranch)
);
check(
    'composeDesign 的 Provider 可见背景落位契约与运行时一致',
    Array.isArray(composeBackgroundPlacementSchema?.properties?.cropPolicy?.enum)
        && composeBackgroundPlacementSchema.properties.cropPolicy.enum.join(',') === 'avoid-crop,allow-crop'
        && !Object.prototype.hasOwnProperty.call(composeBackgroundPlacementSchema?.properties || {}, 'subjectFillRatio')
        && !composeBackgroundPlacementSchema?.required?.includes('focalPoint'),
    JSON.stringify(composeBackgroundPlacementSchema)
);
const validateComposeRegionPlacement = new Ajv({ allErrors: true, strict: false })
    .compile(composeRegionPlacementSchema);
const placementBase = {
    anchor: 'center',
    scale: 1,
    rotation: 0,
    mask: 'none',
    overflow: 'clip'
};
check(
    'composeDesign Provider 可见 region 落位契约拒绝 cover 与 subjectFillRatio 同时出现',
    validateComposeRegionPlacement({
        ...placementBase,
        fit: 'cover',
        cropPolicy: 'protect-subject',
        subjectFillRatio: 0.82
    }) === false,
    JSON.stringify(validateComposeRegionPlacement.errors)
);
check(
    'composeDesign Provider 可见 region 落位契约允许 contain 与 subjectFillRatio',
    validateComposeRegionPlacement({
        ...placementBase,
        fit: 'contain',
        cropPolicy: 'avoid-crop',
        subjectFillRatio: 0.82
    }) === true,
    JSON.stringify(validateComposeRegionPlacement.errors)
);
check(
    'composeDesign Provider 可见 region 落位契约允许不带 subjectFillRatio 的 cover',
    validateComposeRegionPlacement({
        ...placementBase,
        fit: 'cover',
        cropPolicy: 'allow-crop'
    }) === true,
    JSON.stringify(validateComposeRegionPlacement.errors)
);
check(
    'composeDesign Provider 可见 region 落位契约拒绝 cover 与 avoid-crop',
    validateComposeRegionPlacement({
        ...placementBase,
        fit: 'cover',
        cropPolicy: 'avoid-crop'
    }) === false,
    JSON.stringify(validateComposeRegionPlacement.errors)
);
check(
    'composeDesign Provider 可见 region 落位契约拒绝 focalPoint 与 subjectFillRatio 同时出现',
    validateComposeRegionPlacement({
        ...placementBase,
        fit: 'contain',
        cropPolicy: 'protect-subject',
        focalPoint: { x: 0.5, y: 0.5 },
        subjectFillRatio: 0.82
    }) === false,
    JSON.stringify(validateComposeRegionPlacement.errors)
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
                imagePlacement: { fit: 'contain', anchor: 'center', scale: 1, rotation: 0, mask: 'none', overflow: 'visible', cropPolicy: 'avoid-crop' }
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

const backgroundPlacementBase = {
    fit: 'contain',
    anchor: 'center',
    scale: 1,
    rotation: 0,
    mask: 'none',
    overflow: 'visible'
};
const protectedBackground = normalizeComposeDesignSpec({
    ...good,
    background: {
        kind: 'asset',
        filePath: 'E:/project/background.jpg',
        imagePlacement: { ...backgroundPlacementBase, cropPolicy: 'protect-subject' }
    }
});
check(
    '绕过 Provider schema 的背景 protect-subject 仍被运行时防御拒绝',
    protectedBackground.ok === false
        && protectedBackground.issues.some((issue) => (
            issue.startsWith('background.imagePlacement.cropPolicy：')
            && issue.includes('不能使用 protect-subject')
        )),
    JSON.stringify(protectedBackground.issues)
);
const uncroppedBackground = normalizeComposeDesignSpec({
    ...good,
    background: {
        kind: 'asset',
        filePath: 'E:/project/background.jpg',
        imagePlacement: { ...backgroundPlacementBase, cropPolicy: 'avoid-crop' }
    }
});
check(
    '背景使用 avoid-crop 时 focalPoint 保持可选，不制造隐藏必填项',
    uncroppedBackground.ok === true
        && !uncroppedBackground.issues.some((issue) => issue.includes('focalPoint')),
    JSON.stringify(uncroppedBackground.issues)
);

const extremeCoverBlock = {
    id: '收尾·模特穿搭',
    role: 'main-image',
    x: 0,
    y: 4649,
    width: 750,
    height: 426,
    imagePlacement: {
        fit: 'cover',
        anchor: 'center',
        scale: 1,
        rotation: 0,
        mask: 'clipping',
        overflow: 'clip',
        cropPolicy: 'protect-subject'
    }
};
const extremeProtectedCover = evaluateImagePlacementQuality({
    block: extremeCoverBlock,
    layerId: 901,
    actualBounds: { x: 0, y: 4344, width: 750, height: 1036 },
    actualSubjectBounds: { x: 0, y: 4344, width: 750, height: 1036 },
    subjectDetection: {
        method: 'asset:matting',
        confidence: 'high',
        relativeBox: { x: 0, y: 0, width: 1, height: 1 }
    },
    clippingApplied: true,
    clippingBaseLayerId: 900,
    canvas: { width: 750, height: 5195 }
});
check(
    '竖图 cover 进入短横框会报告真实裁切比例，并在保护主体意图下拒绝假通过',
    extremeProtectedCover.qualityState === 'needs_repair'
        && Math.abs(extremeProtectedCover.cropFacts.frameVisibleRatio - 0.411) < 0.002
        && extremeProtectedCover.cropFacts.subjectVisibleRatio === extremeProtectedCover.cropFacts.frameVisibleRatio
        && extremeProtectedCover.cropFacts.clippedSubjectEdges.includes('top')
        && extremeProtectedCover.cropFacts.clippedSubjectEdges.includes('bottom')
        && extremeProtectedCover.findings.some((finding) => finding.code === 'protected_subject_cropped'),
    JSON.stringify(extremeProtectedCover)
);
const intentionalCover = evaluateImagePlacementQuality({
    block: {
        ...extremeCoverBlock,
        imagePlacement: { ...extremeCoverBlock.imagePlacement, cropPolicy: 'allow-crop' }
    },
    layerId: 901,
    actualBounds: { x: 0, y: 4344, width: 750, height: 1036 },
    clippingApplied: true,
    clippingBaseLayerId: 900,
    canvas: { width: 750, height: 5195 }
});
check(
    'Agent 明确允许裁切时 Harness 只要求看真实画面，不替模型否决构图',
    intentionalCover.qualityState === 'needs_review'
        && intentionalCover.cropFacts.cropPolicySatisfied === true
        && intentionalCover.findings.some((finding) => finding.code === 'intentional_crop_requires_visual_review')
        && !intentionalCover.findings.some((finding) => finding.severity === 'repair'),
    JSON.stringify(intentionalCover)
);
const avoidCropViolation = evaluateImagePlacementQuality({
    block: {
        ...extremeCoverBlock,
        imagePlacement: {
            ...extremeCoverBlock.imagePlacement,
            fit: 'contain',
            cropPolicy: 'avoid-crop'
        }
    },
    layerId: 901,
    actualBounds: { x: 0, y: 4344, width: 750, height: 1036 },
    clippingApplied: true,
    clippingBaseLayerId: 900
});
check(
    'avoid-crop 与真实裁切冲突时产生确定性修复，不再 cropPolicySatisfied=false 却假通过',
    avoidCropViolation.qualityState === 'needs_repair'
        && avoidCropViolation.cropFacts.cropPolicySatisfied === false
        && avoidCropViolation.findings.some((finding) => finding.code === 'frame_crop_violates_policy'),
    JSON.stringify(avoidCropViolation)
);
const lowConfidenceProtectedCover = evaluateImagePlacementQuality({
    block: extremeCoverBlock,
    layerId: 901,
    actualBounds: { x: 0, y: 4344, width: 750, height: 1036 },
    actualSubjectBounds: { x: 0, y: 4344, width: 750, height: 1036 },
    subjectDetection: { method: 'frame', confidence: 'low' },
    clippingApplied: true,
    clippingBaseLayerId: 900
});
check(
    '低置信主体框不能把保护主体裁切判成确定性通过或确定性失败',
    lowConfidenceProtectedCover.qualityState === 'needs_review'
        && lowConfidenceProtectedCover.cropFacts.cropPolicySatisfied === 'unknown'
        && lowConfidenceProtectedCover.findings.some((finding) => finding.code === 'crop_intent_unverified'),
    JSON.stringify(lowConfidenceProtectedCover)
);
const noHiddenSubjectRatio = evaluateImagePlacementQuality({
    block: {
        id: '主体·留白实验',
        role: 'main-image',
        x: 0,
        y: 0,
        width: 1000,
        height: 1000,
        imagePlacement: {
            fit: 'contain', anchor: 'top-center', scale: 1, rotation: 0,
            mask: 'none', overflow: 'visible', cropPolicy: 'avoid-crop'
        }
    },
    layerId: 902,
    actualBounds: { x: 350, y: 0, width: 300, height: 300 },
    clippingApplied: false
});
const underfillFinding = noHiddenSubjectRatio.findings.find((finding) => finding.code === 'main_image_underfilled');
check(
    '缺少 Agent 主体占比时 Harness 不再偷偷补 0.82 或生成伪可执行修订动作',
    underfillFinding && underfillFinding.recommendedAction === undefined
        && !JSON.stringify(noHiddenSubjectRatio).includes('0.82'),
    JSON.stringify(noHiddenSubjectRatio)
);

const placementReviewReceipts = [
    {
        blockId: '完全裁出画框',
        qualityState: 'needs_review',
        targetBounds: { x: 0, y: 4649, width: 750, height: 426 },
        cropFacts: {
            requiresVisualReview: true,
            frameVisibleRatio: 0,
            cropPolicySatisfied: true
        }
    },
    ...Array.from({ length: 9 }, (_unused, index) => ({
        blockId: `普通复核-${index + 2}`,
        qualityState: 'needs_review',
        targetBounds: { x: 20, y: 200 + index * 430, width: 710, height: 400 },
        cropFacts: {
            requiresVisualReview: true,
            frameVisibleRatio: 1,
            cropPolicySatisfied: true
        }
    })),
    {
        blockId: '无需复核',
        qualityState: 'passed',
        targetBounds: { x: 0, y: 0, width: 750, height: 400 },
        cropFacts: {
            requiresVisualReview: false,
            frameVisibleRatio: 0,
            cropPolicySatisfied: true
        }
    }
];
const placementReviewPlan = buildImagePlacementReviewPlan({
    receipts: placementReviewReceipts,
    canvas: { width: 750, height: 5195 }
});
check(
    '长页图片复核计划保留 frameVisibleRatio=0 的最高机械风险，不被默认值吞掉',
    placementReviewPlan.allTargets[0]?.sourceId === '完全裁出画框'
        && placementReviewPlan.allTargets[0]?.riskScore === 1,
    JSON.stringify(placementReviewPlan.allTargets[0])
);
check(
    '长页图片复核统一使用 3.5% 最少 12px 的画布内 padding',
    placementReviewPlan.allTargets[0]?.captureRegion?.x === 0
        && placementReviewPlan.allTargets[0]?.captureRegion?.y === 4634
        && placementReviewPlan.allTargets[0]?.captureRegion?.width === 750
        && placementReviewPlan.allTargets[0]?.captureRegion?.height === 456,
    JSON.stringify(placementReviewPlan.allTargets[0]?.captureRegion)
);
check(
    '长页图片复核 cap=8 但 expectedTargets 保留全部义务，并显式记录 overflow',
    IMAGE_PLACEMENT_REVIEW_CAPTURE_LIMIT === 8
        && placementReviewPlan.allTargets.length === 10
        && placementReviewPlan.selectedTargets.length === 8
        && placementReviewPlan.expectedTargets.length === 10
        && placementReviewPlan.overflow?.omittedCount === 2
        && placementReviewPlan.overflow?.reason === 'producer_limit'
        && placementReviewPlan.overflow?.sourceIds?.join(',') === '普通复核-9,普通复核-10',
    JSON.stringify(placementReviewPlan)
);
check(
    'renderLayout 与 composeDesign 共用纯机械图片复核计划，不再各自漂移风险公式',
    toolExecutorSource.includes('buildImagePlacementReviewPlan({')
        && composeExecutorSource.includes('buildImagePlacementReviewPlan({')
        && !toolExecutorSource.includes('frameVisibleRatio || 1')
        && !composeExecutorSource.includes('frameVisibleRatio || 1')
);

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
    subject: { filePath: 'E:/project/photo.jpg', treatment: 'photo', shadow: { kind: 'none' } },
    layout: {
        ...good.layout,
        groupName: '完整摄影关系',
        regions: [{
            id: '主视觉·完整摄影',
            role: 'main-image',
            content: 'subject',
            bounds: { x: 0, y: 0, width: 1, height: 1 },
            imagePlacement: {
                fit: 'cover', anchor: 'right-center', scale: 1, rotation: 0,
                mask: 'none', overflow: 'clip', cropPolicy: 'allow-crop'
            }
        }]
    }
});
check(
    '完整摄影关系可只用 Agent 声明的 region.imagePlacement，不强迫 subject.fillRatio',
    photoWithoutFill.ok
        && photoWithoutFill.spec?.subject?.fillRatio === undefined
        && photoWithoutFill.spec?.layout?.regions?.[0]?.imagePlacement?.anchor === 'right-center',
    JSON.stringify(photoWithoutFill.issues)
);
const photoWithInvalidFill = normalizeComposeDesignSpec({
    ...photoWithoutFill.spec,
    subject: { ...photoWithoutFill.spec.subject, fillRatio: 0 }
});
check(
    'Agent 一旦显式声明摄影主体占比，运行时仍严格校验该约束',
    photoWithInvalidFill.ok === false
        && photoWithInvalidFill.issues.some((issue) => /subject\.fillRatio/.test(issue)),
    JSON.stringify(photoWithInvalidFill.issues)
);

const lowConfidenceFullFramePrewrite = buildImagePlacementPrewritePlan({
    source: {
        width: 3000,
        height: 4000,
        subject: {
            box: { x: 0.12, y: 0.08, width: 0.76, height: 0.84 },
            method: 'matting',
            confidence: 'low'
        }
    },
    target: { x: 0, y: 0, width: 800, height: 800 },
    placement: {
        fit: 'cover',
        anchor: 'right-center',
        cropPolicy: 'allow-crop'
    },
    canvas: { width: 800, height: 800 }
});
check(
    '普通摄影图框预演只消费源图尺寸和 Agent 构图声明，低置信主体框不阻断可逆首写',
    lowConfidenceFullFramePrewrite.ok === true
        && lowConfidenceFullFramePrewrite.plan.mode === 'normal'
        && lowConfidenceFullFramePrewrite.plan.finalWrite.fit === 'cover'
        && lowConfidenceFullFramePrewrite.plan.finalWrite.anchor === 'right-center',
    JSON.stringify(lowConfidenceFullFramePrewrite)
);
const lowConfidenceSubjectFillPrewrite = buildImagePlacementPrewritePlan({
    source: {
        width: 3000,
        height: 4000,
        subject: {
            box: { x: 0.12, y: 0.08, width: 0.76, height: 0.84 },
            method: 'matting',
            confidence: 'low'
        }
    },
    target: { x: 0, y: 0, width: 800, height: 800 },
    placement: {
        fit: 'contain',
        anchor: 'right-center',
        cropPolicy: 'avoid-crop',
        subjectFillRatio: 0.82
    },
    canvas: { width: 800, height: 800 }
});
check(
    '显式 subjectFillRatio 仍必须有可用主体框，低置信检测不能被当成主体事实',
    lowConfidenceSubjectFillPrewrite.ok === false
        && lowConfidenceSubjectFillPrewrite.issues.some((issue) => (
            issue.code === 'subject_evidence_unusable_for_subject_fill'
        )),
    JSON.stringify(lowConfidenceSubjectFillPrewrite)
);

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
            imagePlacement: { fit: 'cover', anchor: 'center', scale: 1, rotation: 0, mask: 'none', overflow: 'clip', cropPolicy: 'protect-subject' }
        }]
    }
});
check(
    'Agent 可明确选择只有商品图、不编造文字的有效设计',
    photoOnly.ok,
    photoOnly.issues.join(' | ')
);

const coverSubjectFillConflictInput = {
    ...good,
    layout: {
        ...good.layout,
        regions: [{
            ...good.layout.regions[0],
            imagePlacement: {
                ...good.layout.regions[0].imagePlacement,
                fit: 'cover',
                cropPolicy: 'protect-subject',
                subjectFillRatio: 0.82
            }
        }]
    }
};
const coverSubjectFillConflict = normalizeComposeDesignSpec(coverSubjectFillConflictInput);
check(
    '绕过 Provider schema 的 cover 与 subjectFillRatio 冲突仍被 runtime 拒绝',
    coverSubjectFillConflict.ok === false
        && coverSubjectFillConflict.issues.includes('layout.regions[0].imagePlacement:cover_and_subject_fill_ratio_are_ambiguous'),
    JSON.stringify(coverSubjectFillConflict.issues)
);
const coverAvoidCropConflict = normalizeComposeDesignSpec({
    ...good,
    layout: {
        ...good.layout,
        regions: [{
            ...good.layout.regions[0],
            imagePlacement: {
                ...good.layout.regions[0].imagePlacement,
                fit: 'cover',
                cropPolicy: 'avoid-crop'
            }
        }]
    }
});
check(
    '绕过 Provider schema 的 cover 与 avoid-crop 冲突仍被 runtime 拒绝',
    coverAvoidCropConflict.ok === false
        && coverAvoidCropConflict.issues.includes('layout.regions[0].imagePlacement:cover_conflicts_with_avoid_crop'),
    JSON.stringify(coverAvoidCropConflict.issues)
);
const focalSubjectFillConflict = normalizeComposeDesignSpec({
    ...good,
    layout: {
        ...good.layout,
        regions: [{
            ...good.layout.regions[0],
            imagePlacement: {
                ...good.layout.regions[0].imagePlacement,
                fit: 'contain',
                cropPolicy: 'protect-subject',
                focalPoint: { x: 0.5, y: 0.5 },
                subjectFillRatio: 0.82
            }
        }]
    }
});
check(
    '绕过 Provider schema 的 focalPoint 与 subjectFillRatio 冲突仍被 runtime 拒绝',
    focalSubjectFillConflict.ok === false
        && focalSubjectFillConflict.issues.includes('layout.regions[0].imagePlacement:focal_point_and_subject_fill_ratio_conflict'),
    JSON.stringify(focalSubjectFillConflict.issues)
);
const publicPlacementConflict = sanitizeUserVisibleDiagnosticText(
    'composeDesign 设计稿不完整：layout.regions[0].imagePlacement:cover_and_subject_fill_ratio_are_ambiguous'
);
const additionalPublicPlacementConflicts = [
    sanitizeUserVisibleDiagnosticText(
        'composeDesign 设计稿不完整：layout.regions[1].imagePlacement:cover_conflicts_with_avoid_crop'
    ),
    sanitizeUserVisibleDiagnosticText(
        'composeDesign 设计稿不完整：layout.regions[2].imagePlacement:focal_point_and_subject_fill_ratio_conflict'
    )
];
check(
    '图片落位冲突的用户文案不泄漏字段路径或英文 code',
    publicPlacementConflict.includes('第 1 张图片')
        && publicPlacementConflict.includes('保留其中一种意图')
        && !publicPlacementConflict.includes('layout.regions')
        && !publicPlacementConflict.includes('cover_and_subject_fill_ratio_are_ambiguous')
        && additionalPublicPlacementConflicts.every((message) => (
            message.includes('保留其中一种')
                && !message.includes('layout.regions')
                && !message.includes('cover_conflicts_with_avoid_crop')
                && !message.includes('focal_point_and_subject_fill_ratio_conflict')
        )),
    JSON.stringify([publicPlacementConflict, ...additionalPublicPlacementConflicts])
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
                imagePlacement: { fit: 'cover', anchor: 'top-center', scale: 1, rotation: 0, mask: 'none', overflow: 'clip', cropPolicy: 'allow-crop' }
            },
            {
                id: '细节·防滑纹理',
                role: 'decoration',
                content: 'E:/project/grip-detail.png',
                bounds: { x: 0.63, y: 0.56, width: 0.32, height: 0.34 },
                imagePlacement: { fit: 'cover', anchor: 'center', scale: 1, rotation: 0, mask: 'clipping', overflow: 'clip', cropPolicy: 'allow-crop', focalPoint: { x: 0.48, y: 0.42 } }
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
        && multiVisual.spec.layout.regions[0].imagePlacement.anchor === 'top-center'
        && multiVisual.spec.layout.regions[1].imagePlacement.focalPoint.y === 0.42
);
const unsupportedImagePlacement = normalizeComposeDesignSpec({
    ...good,
    layout: {
        ...good.layout,
        regions: [{
            ...good.layout.regions[0],
            imagePlacement: {
                ...good.layout.regions[0].imagePlacement,
                rotation: 3,
                scale: 1.08
            }
        }]
    }
});
check(
    'composeDesign 在 Photoshop 写入前拒绝执行层不能兑现的图片旋转与额外缩放',
    !unsupportedImagePlacement.ok
        && unsupportedImagePlacement.issues.some((issue) => /rotation/.test(issue))
        && unsupportedImagePlacement.issues.some((issue) => /scale/.test(issue)),
    unsupportedImagePlacement.issues.join(' | ')
);
const prematureSave = normalizeComposeDesignSpec({
    ...good,
    save: { projectSubdir: '交付', format: 'psd' }
});
check(
    'composeDesign 拒绝在 Agent 看过当前版本前内部保存',
    !prematureSave.ok && prematureSave.issues.some((issue) => /composeDesign 不在 Agent 看见写后真实画面前保存/.test(issue)),
    prematureSave.issues.join(' | ')
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
    fillRatio: 0.9,
    anchor: 'center'
});
check('显式摄影构图可转换为确定性几何', photoPlan && photoPlan.width >= 800 && photoPlan.height >= 800, JSON.stringify(photoPlan));
const conflictingPhotoPlan = planPhotoFullBleedPlacement({
    canvas: { width: 800, height: 800 },
    photo: { width: 3000, height: 4000 },
    subjectBox: { x: 0.3, y: 0.25, width: 0.4, height: 0.5 },
    targetRegion: { x: 0.5, y: 0.06, width: 0.45, height: 0.84 },
    fillRatio: 0.3,
    anchor: 'center'
});
check(
    '摄影满幅与主体占比冲突时只返回冲突事实，不替 Agent 选择牺牲主体占比',
    conflictingPhotoPlan?.designIntentSatisfied === false
        && conflictingPhotoPlan.fillIntentSatisfied === false
        && conflictingPhotoPlan.actualFillRatio > conflictingPhotoPlan.requestedFillRatio
        && conflictingPhotoPlan.constraintIssues.includes('full_canvas_cover_conflicts_with_subject_fill'),
    JSON.stringify(conflictingPhotoPlan)
);
check('摄影构图缺占比时不套默认值', planPhotoFullBleedPlacement({
    canvas: { width: 800, height: 800 },
    photo: { width: 3000, height: 4000 },
    subjectBox: { x: 0.3, y: 0.4, width: 0.4, height: 0.5 },
    targetRegion: { x: 0.5, y: 0.06, width: 0.45, height: 0.84 },
    anchor: 'center'
}) === null);

check('投影 none 不执行', planSubjectShadow({ kind: 'none' }) === null);
const shadowPlan = planSubjectShadow(good.subject.shadow);
check('显式投影参数原样进入 Photoshop 计划', shadowPlan?.angle === 104 && shadowPlan?.colorHex === '#3A2418' && shadowPlan?.opacity === 26);

const generated = normalizeComposeDesignSpec({
    ...good,
    background: {
        kind: 'generated',
        prompt: '低饱和亚麻与柔和侧光，左侧留白',
        referenceFilePath: 'E:/project/reference.jpg',
        imagePlacement: {
            fit: 'cover', anchor: 'left-center', scale: 1, rotation: 0,
            mask: 'none', overflow: 'clip', cropPolicy: 'allow-crop'
        }
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
    const invalidPlacementResult = await executeComposeDesign(coverSubjectFillConflictInput, {
        executeToolCall: async () => {
            throw new Error('设计稿校验失败时不应调用 Photoshop 工具');
        },
        inferLayerId: () => undefined,
        invokeMain: async () => {
            throw new Error('设计稿校验失败时不应调用主进程');
        }
    });
    const invalidPlacementIssue = invalidPlacementResult.issueDetails?.[0];
    check(
        'composeDesign 落位冲突返回不替 Agent 选择的机器可读恢复选项',
        invalidPlacementResult.success === false
            && invalidPlacementIssue?.code === 'image_placement_cover_subject_fill_conflict'
            && invalidPlacementIssue?.path === 'layout.regions[0].imagePlacement'
            && invalidPlacementIssue?.conflictingFields?.join(',') === 'fit,subjectFillRatio'
            && invalidPlacementIssue?.recoveryOptions?.length === 2
            && invalidPlacementIssue.recoveryOptions.every((option) => option.recommended === undefined)
            && invalidPlacementIssue.recoveryOptions.some((option) => option.id === 'preserve_cover')
            && invalidPlacementIssue.recoveryOptions.some((option) => option.id === 'preserve_subject_fill'),
        JSON.stringify(invalidPlacementResult)
    );
    const additionalInvalidPlacementInputs = [
        {
            input: {
                ...good,
                layout: {
                    ...good.layout,
                    regions: [{
                        ...good.layout.regions[0],
                        imagePlacement: {
                            ...good.layout.regions[0].imagePlacement,
                            fit: 'cover',
                            cropPolicy: 'avoid-crop'
                        }
                    }]
                }
            },
            expectedCode: 'image_placement_cover_avoid_crop_conflict',
            expectedFields: 'fit,cropPolicy'
        },
        {
            input: {
                ...good,
                layout: {
                    ...good.layout,
                    regions: [{
                        ...good.layout.regions[0],
                        imagePlacement: {
                            ...good.layout.regions[0].imagePlacement,
                            fit: 'contain',
                            cropPolicy: 'protect-subject',
                            focalPoint: { x: 0.5, y: 0.5 },
                            subjectFillRatio: 0.82
                        }
                    }]
                }
            },
            expectedCode: 'image_placement_focal_subject_fill_conflict',
            expectedFields: 'focalPoint,subjectFillRatio'
        }
    ];
    for (const issueCase of additionalInvalidPlacementInputs) {
        const issueResult = await executeComposeDesign(issueCase.input, {
            executeToolCall: async () => {
                throw new Error('设计稿校验失败时不应调用 Photoshop 工具');
            },
            inferLayerId: () => undefined,
            invokeMain: async () => {
                throw new Error('设计稿校验失败时不应调用主进程');
            }
        });
        const issueDetail = issueResult.issueDetails?.[0];
        check(
            `composeDesign ${issueCase.expectedCode} 返回对称恢复选项`,
            issueDetail?.code === issueCase.expectedCode
                && issueDetail?.conflictingFields?.join(',') === issueCase.expectedFields
                && issueDetail?.recoveryOptions?.length === 2
                && issueDetail.recoveryOptions.every((option) => option.recommended === undefined),
            JSON.stringify(issueResult)
        );
    }

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
                    snapshot: { data: 'fixture', mediaType: 'image/jpeg' },
                    historyStateRef: { documentId: 701, historyStateId: 3 },
                    postWriteObservation: {
                        captured: true,
                        verifiedSameDocumentVersion: true,
                        historyStateRef: { documentId: 701, historyStateId: 3 }
                    },
                    visualObservationBundle: {
                        version: 'visual-observation-bundle/v1',
                        expectedObservationCount: 1,
                        items: [{
                            identity: {
                                outer: 'renderLayout', resultPath: '$.items[0]', document: '701', history: '3',
                                sourceKind: 'layout-region', sourceId: '主体·产品摄影'
                            },
                            captured: true,
                            image: { base64: 'fixture-local' }
                        }]
                    },
                    imagePlacementReceipts: [{
                        blockId: '主体·产品摄影',
                        qualityState: 'needs_review',
                        targetBounds: { x: 400, y: 64, width: 352, height: 672 },
                        cropFacts: { requiresVisualReview: true, frameVisibleRatio: 0.7, cropPolicySatisfied: true }
                    }],
                    ownerReceipt: { version: 'render-layout-owner/v1' }
                };
            }
            if (toolName === 'getLayerHierarchy') {
                return {
                    success: true,
                    historyStateRef: { documentId: 701, historyStateId: 4 },
                    hierarchy: []
                };
            }
            if (toolName === 'getCanvasSnapshot') {
                return {
                    success: true,
                    historyStateRef: { documentId: 701, historyStateId: 4 },
                    documentInfo: { id: 701, name: '春日薄款主图' },
                    snapshot: { base64: `final-${params?.region?.y || 0}`, format: 'png' }
                };
            }
            return { success: true };
        },
        inferLayerId: (toolName, _params, toolResult) => toolResult?.layerId || toolLayerIds[toolName],
        invokeMain: async (channel) => {
            if (channel === 'resource:getAssetSubjectBox') {
                return {
                    success: true,
                    imageWidth: 1200,
                    imageHeight: 1800,
                    error: 'fixture deliberately omits subject geometry'
                };
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
    check(
        'composeDesign 保留图片落位与 owner 收据，并在后续投影写入后重建最终视觉版本',
        result.postWriteObservation?.verifiedSameDocumentVersion === true
            && result.historyStateRef?.historyStateId === 4
            && result.snapshot?.base64 === 'final-0'
            && result.visualObservationBundle?.items?.[0]?.identity?.outer === 'composeDesign'
            && result.visualObservationBundle?.items?.[0]?.identity?.history === '4'
            && result.visualObservationBundle?.items?.[0]?.identity?.sourceId === 'final-canvas'
            && result.imagePlacementReceipts?.[0]?.blockId === '主体·产品摄影'
            && result.ownerReceipt?.version === 'render-layout-owner/v1',
        JSON.stringify({
            visualObservationBundle: result.visualObservationBundle,
            postWriteObservation: result.postWriteObservation,
            imagePlacementReceipts: result.imagePlacementReceipts,
            ownerReceipt: result.ownerReceipt
        })
    );

    const fullFramePhotoInput = {
        ...good,
        document: { mode: 'new', name: '完整摄影构图首稿' },
        background: { kind: 'none' },
        subject: {
            filePath: 'E:/project/DSC08134.jpg',
            treatment: 'photo',
            shadow: { kind: 'none' }
        },
        layout: {
            ...good.layout,
            groupName: '完整摄影·右侧重心',
            regions: [{
                id: '主视觉·模特穿搭摄影',
                role: 'main-image',
                content: 'subject',
                bounds: { x: 0, y: 0, width: 1, height: 1 },
                imagePlacement: {
                    fit: 'cover', anchor: 'right-center', scale: 1, rotation: 0,
                    mask: 'none', overflow: 'clip', cropPolicy: 'allow-crop'
                }
            }]
        }
    };
    const fullFramePhotoCalls = [];
    const fullFramePhotoResult = await executeComposeDesign(fullFramePhotoInput, {
        executeToolCall: async (toolName, params) => {
            fullFramePhotoCalls.push({ toolName, params });
            if (toolName === 'createDocument') {
                return { success: true, documentId: 880 };
            }
            if (toolName === 'placeImage') {
                return {
                    success: true,
                    layerId: 881,
                    bounds: { left: 0, top: -133, right: 800, bottom: 934 },
                    placement: {
                        targetBounds: params.targetBounds,
                        targetFit: params.targetFit,
                        targetAnchor: params.targetAnchor,
                        geometryVerification: { verified: true, issues: [] }
                    }
                };
            }
            if (toolName === 'renderLayout') {
                return {
                    success: true,
                    qualityState: 'passed',
                    created: [],
                    createdLayerIds: [],
                    subjectLayerIds: [],
                    imagePlacementReceipts: [],
                    ownerReceipt: { version: 'render-layout-owner/v1' }
                };
            }
            if (toolName === 'getLayerHierarchy') {
                return {
                    success: true,
                    historyStateRef: { documentId: 880, historyStateId: 3 },
                    hierarchy: []
                };
            }
            if (toolName === 'getCanvasSnapshot') {
                return {
                    success: true,
                    historyStateRef: { documentId: 880, historyStateId: 3 },
                    documentInfo: { id: 880, name: '完整摄影构图首稿' },
                    snapshot: { base64: 'full-frame-final', format: 'png' }
                };
            }
            return { success: true };
        },
        inferLayerId: (_toolName, _params, toolResult) => toolResult?.layerId,
        invokeMain: async (channel) => {
            if (channel === 'resource:getAssetSubjectBox') {
                return {
                    success: false,
                    imageWidth: 3000,
                    imageHeight: 4000,
                    error: 'fixture only exposes source dimensions'
                };
            }
            if (channel === 'designWorkshop:readRecentDesigns') return { success: false };
            return { success: false };
        }
    });
    const fullFramePlaceCall = fullFramePhotoCalls.find((call) => call.toolName === 'placeImage');
    const fullFrameLayoutCall = fullFramePhotoCalls.find((call) => call.toolName === 'renderLayout');
    check(
        'composeDesign 在只有源图尺寸、没有主体框时仍按 Agent 图框声明一次置入，再返回同版本真实画面',
        fullFramePhotoResult.success === true
            && fullFramePlaceCall?.params?.targetFit === 'cover'
            && fullFramePlaceCall?.params?.targetAnchor === 'right-center'
            && fullFramePlaceCall?.params?.targetBounds?.width === 800
            && fullFramePlaceCall?.params?.targetBounds?.height === 800
            && fullFrameLayoutCall?.params?.regions?.length === 0
            && fullFramePhotoResult.photoPlacement?.subjectEvidence?.available === false
            && fullFramePhotoResult.photoPlacement?.subjectEvidence?.confidence === 'unknown'
            && fullFramePhotoResult.photoPlacement?.subjectEvidence?.usedForPlacement === false
            && fullFramePhotoResult.postWriteObservation?.verifiedSameDocumentVersion === true,
        JSON.stringify({ fullFramePhotoResult, fullFramePhotoCalls })
    );

    const noBoxProtectedCalls = [];
    const noBoxProtectedResult = await executeComposeDesign({
        ...fullFramePhotoInput,
        layout: {
            ...fullFramePhotoInput.layout,
            regions: [{
                ...fullFramePhotoInput.layout.regions[0],
                imagePlacement: {
                    ...fullFramePhotoInput.layout.regions[0].imagePlacement,
                    cropPolicy: 'protect-subject'
                }
            }]
        }
    }, {
        executeToolCall: async (toolName) => {
            noBoxProtectedCalls.push(toolName);
            return { success: true, documentId: 883 };
        },
        inferLayerId: () => undefined,
        invokeMain: async (channel) => {
            if (channel === 'resource:getAssetSubjectBox') {
                return {
                    success: false,
                    imageWidth: 3000,
                    imageHeight: 4000,
                    error: 'fixture only exposes source dimensions'
                };
            }
            return { success: false };
        }
    });
    check(
        'composeDesign 的 protect-subject 在只有尺寸、没有主体框时仍于写前失败',
        noBoxProtectedResult.success === false
            && noBoxProtectedResult.failedStep === '摄影图写前预演'
            && noBoxProtectedResult.data?.partialMutation === false
            && noBoxProtectedResult.placementIssues?.some((issue) => (
                issue.code === 'subject_facts_required_for_protection'
            ))
            && noBoxProtectedCalls.length === 0,
        JSON.stringify({ noBoxProtectedResult, noBoxProtectedCalls })
    );

    const lowConfidenceFillCalls = [];
    const lowConfidenceFillResult = await executeComposeDesign({
        ...fullFramePhotoInput,
        subject: { ...fullFramePhotoInput.subject, fillRatio: 0.82 }
    }, {
        executeToolCall: async (toolName) => {
            lowConfidenceFillCalls.push(toolName);
            return { success: true, documentId: 882 };
        },
        inferLayerId: () => undefined,
        invokeMain: async (channel) => {
            if (channel === 'resource:getAssetSubjectBox') {
                return {
                    success: true,
                    imageWidth: 3000,
                    imageHeight: 4000,
                    resolution: {
                        box: { x: 0.12, y: 0.08, width: 0.76, height: 0.84 },
                        method: 'matting',
                        confidence: 'low'
                    }
                };
            }
            return { success: false };
        }
    });
    check(
        'composeDesign 在 Agent 显式声明 fillRatio 时仍拒绝低置信主体框，且写前失败没有 Photoshop 副作用',
        lowConfidenceFillResult.success === false
            && lowConfidenceFillResult.failedStep === '摄影图写前预演'
            && lowConfidenceFillResult.data?.partialMutation === false
            && lowConfidenceFillResult.prewritePlacement === 'subject_evidence_unusable'
            && lowConfidenceFillCalls.length === 0,
        JSON.stringify({ lowConfidenceFillResult, lowConfidenceFillCalls })
    );

    const photoConflictCalls = [];
    const photoConflictResult = await executeComposeDesign({
        ...good,
        background: { kind: 'none' },
        subject: {
            filePath: 'E:/project/photo-conflict.jpg',
            treatment: 'photo',
            shadow: { kind: 'none' },
            fillRatio: 0.3
        },
        layout: {
            ...good.layout,
            groupName: '摄影冲突预演',
            regions: [{
                id: '主体·摄影冲突',
                role: 'main-image',
                content: 'subject',
                bounds: { x: 0.5, y: 0.06, width: 0.45, height: 0.84 },
                imagePlacement: {
                    fit: 'cover', anchor: 'center', scale: 1, rotation: 0,
                    mask: 'none', overflow: 'clip', cropPolicy: 'allow-crop'
                }
            }]
        }
    }, {
        executeToolCall: async (toolName) => {
            photoConflictCalls.push(toolName);
            return { success: true, documentId: 990 };
        },
        inferLayerId: () => undefined,
        invokeMain: async (channel) => {
            if (channel === 'resource:getAssetSubjectBox') {
                return {
                    success: true,
                    imageWidth: 3000,
                    imageHeight: 4000,
                    resolution: {
                        box: { x: 0.3, y: 0.25, width: 0.4, height: 0.5 },
                        method: 'trim',
                        confidence: 'high'
                    }
                };
            }
            return { success: false };
        }
    });
    check(
        'composeDesign 在摄影约束冲突时先返回无写入事实，不创建空文档或错误图层',
        photoConflictResult.success === false
            && photoConflictResult.failedStep === '摄影图写前预演'
            && photoConflictResult.data?.partialMutation === false
            && !photoConflictCalls.includes('createDocument')
            && !photoConflictCalls.includes('placeImage'),
        JSON.stringify({ photoConflictResult, photoConflictCalls })
    );

    const nestedImagePreflightCalls = [];
    const nestedImagePreflightResult = await executeComposeDesign({
        ...good,
        layout: {
            ...good.layout,
            regions: [
                ...good.layout.regions,
                {
                    id: '装饰·局部产品图',
                    role: 'decoration',
                    content: 'E:/project/independent-product.jpg',
                    bounds: { x: 0.06, y: 0.58, width: 0.28, height: 0.28 },
                    imagePlacement: {
                        fit: 'cover', anchor: 'center', scale: 1, rotation: 0,
                        mask: 'clipping', overflow: 'clip', cropPolicy: 'protect-subject'
                    }
                }
            ]
        }
    }, {
        executeToolCall: async (toolName) => {
            nestedImagePreflightCalls.push(toolName);
            return { success: true };
        },
        inferLayerId: () => undefined,
        invokeMain: async (channel, sourcePath) => {
            if (channel === 'resource:getAssetSubjectBox') {
                return {
                    success: true,
                    imageWidth: 1200,
                    imageHeight: 1800,
                    ...(String(sourcePath).includes('independent-product')
                        ? {}
                        : {
                            resolution: {
                                box: { x: 0.2, y: 0.1, width: 0.6, height: 0.8 },
                                method: 'alpha',
                                confidence: 'certain'
                            }
                        })
                };
            }
            return { success: false };
        }
    });
    check(
        'composeDesign 在任何 Photoshop 写入前预演独立图片区域，失败不留下空文档或背景层',
        nestedImagePreflightResult.success === false
            && nestedImagePreflightResult.failedStep === '构图图片写前预演'
            && nestedImagePreflightResult.data?.partialMutation === false
            && nestedImagePreflightResult.data?.mutationStatus === 'not_observed'
            && nestedImagePreflightResult.placementPreflightFindings?.some((finding) => (
                finding.blockId === '装饰·局部产品图'
                && finding.code === 'subject_facts_required_for_protection'
            ))
            && nestedImagePreflightCalls.length === 0,
        JSON.stringify({ nestedImagePreflightResult, nestedImagePreflightCalls })
    );

    let openingModalReadCount = 0;
    const openingModalResult = await executeComposeDesign({
        ...good,
        document: { mode: 'active', name: '开场弹窗活动文档' }
    }, {
        executeToolCall: async (toolName) => {
            if (toolName === 'getDocumentInfo') {
                openingModalReadCount += 1;
                return {
                    success: false,
                    error: 'getDocumentInfo 处理超时：Photoshop 可能有弹窗未关闭。',
                    errorCategory: 'photoshop_native_modal_suspected',
                    environmentState: 'photoshop_native_modal_suspected',
                    recoveryRequired: true,
                    environmentObservation: {
                        capability: 'capturePhotoshopWindow',
                        scope: 'adobe_photoshop_application_window',
                        purpose: '读取包含原生弹窗的真实 Photoshop 窗口。'
                    }
                };
            }
            return { success: true };
        },
        inferLayerId: () => undefined,
        invokeMain: async () => ({ success: false })
    });
    check(
        'composeDesign 开场只读确认就遇到原生弹窗时，也把整窗观察出口交回 Agent',
        openingModalResult.success === false
            && openingModalResult.failedStep === '确认活动文档'
            && openingModalResult.data?.mutationStatus === 'not_observed'
            && openingModalResult.environmentState === 'photoshop_native_modal_suspected'
            && openingModalResult.environmentObservation?.capability === 'capturePhotoshopWindow'
            && openingModalResult.environmentObservation?.scope === 'adobe_photoshop_application_window'
            && openingModalReadCount === 1,
        JSON.stringify(openingModalResult)
    );

    let failureSettlementReadCount = 0;
    const partialCommitCalls = [];
    const partialCommitResult = await executeComposeDesign({
        ...good,
        document: { mode: 'active', name: '活动文档局部修订' },
        subject: {
            ...good.subject,
            shadow: { kind: 'none' }
        }
    }, {
        executeToolCall: async (toolName) => {
            partialCommitCalls.push(toolName);
            if (toolName === 'getDocumentInfo') {
                failureSettlementReadCount += 1;
                const historyStateId = failureSettlementReadCount === 1 ? 8049 : 8053;
                return {
                    success: true,
                    document: { id: 701, width: 800, height: 800 },
                    historyStateRef: { documentId: 701, historyStateId }
                };
            }
            if (toolName === 'createRectangle') {
                return {
                    success: true,
                    layerId: 11,
                    photoshopHistoryTransition: {
                        version: 'photoshop-history-transition/v1',
                        basis: 'acceptance_snapshot_pair',
                        before: { documentId: 701, historyStateId: 8049 },
                        after: { documentId: 701, historyStateId: 8050 },
                        mutationObserved: true,
                        documentChanged: false
                    }
                };
            }
            if (toolName === 'renderLayout') {
                return {
                    success: false,
                    status: 'failed',
                    error: 'Photoshop 可能正忙：卖点文字创建失败，候选底块已经保留',
                    createdLayerIds: [12],
                    photoshopHistoryTransition: {
                        version: 'photoshop-history-transition/v1',
                        basis: 'acceptance_snapshot_pair',
                        before: { documentId: 701, historyStateId: 8050 },
                        after: { documentId: 701, historyStateId: 8053 },
                        mutationObserved: true,
                        documentChanged: false
                    }
                };
            }
            return { success: true };
        },
        inferLayerId: (_toolName, _params, toolResult) => toolResult?.layerId,
        invokeMain: async (channel) => {
            if (channel === 'resource:getAssetSubjectBox') {
                return { success: true, imageWidth: 1200, imageHeight: 1800 };
            }
            return { success: false };
        }
    });
    check(
        'composeDesign 失败子调用即使 success=false 也保留真实 History 证据并做最终版本结算',
        partialCommitResult.success === false
            && partialCommitResult.data?.partialMutation === true
            && partialCommitResult.data?.mutationStatus === 'applied'
            && partialCommitResult.photoshopHistoryTransition?.before?.historyStateId === 8049
            && partialCommitResult.photoshopHistoryTransition?.after?.historyStateId === 8053
            && partialCommitResult.toolResults?.some((entry) => (
                entry.toolName === 'renderLayout'
                && entry.result?.success === false
                && entry.result?.photoshopHistoryTransition?.after?.historyStateId === 8053
            ))
            && partialCommitResult.message.includes('Photoshop 已发生部分改动')
            && !partialCommitResult.message.includes('未修改')
            && partialCommitCalls.filter((toolName) => toolName === 'renderLayout').length === 1
            && partialCommitCalls.filter((toolName) => toolName === 'getDocumentInfo').length === 2,
        JSON.stringify({ partialCommitResult, partialCommitCalls })
    );

    let modalSettlementReads = 0;
    let modalRenderCalls = 0;
    const modalFailureResult = await executeComposeDesign({
        ...good,
        document: { mode: 'active', name: '弹窗堵塞活动文档' },
        subject: { ...good.subject, shadow: { kind: 'none' } }
    }, {
        executeToolCall: async (toolName) => {
            if (toolName === 'getDocumentInfo') {
                modalSettlementReads += 1;
                return {
                    success: true,
                    document: { id: 705, width: 800, height: 800 },
                    historyStateRef: {
                        documentId: 705,
                        historyStateId: modalSettlementReads === 1 ? 300 : 301
                    }
                };
            }
            if (toolName === 'createRectangle') {
                return {
                    success: true,
                    layerId: 41,
                    photoshopHistoryTransition: {
                        version: 'photoshop-history-transition/v1', basis: 'acceptance_snapshot_pair',
                        before: { documentId: 705, historyStateId: 300 },
                        after: { documentId: 705, historyStateId: 301 },
                        mutationObserved: true, documentChanged: false
                    }
                };
            }
            if (toolName === 'renderLayout') {
                modalRenderCalls += 1;
                return {
                    success: false,
                    error: 'renderLayout 处理超时：Photoshop 可能有弹窗未关闭。',
                    errorCategory: 'photoshop_native_modal_suspected',
                    environmentState: 'photoshop_native_modal_suspected',
                    recoveryRequired: true,
                    environmentObservation: {
                        capability: 'capturePhotoshopWindow',
                        scope: 'adobe_photoshop_application_window',
                        purpose: '读取包含原生弹窗的真实 Photoshop 窗口。'
                    },
                    suggestion: '先观察完整 Photoshop 窗口，不要重复写入。'
                };
            }
            return { success: true };
        },
        inferLayerId: (_toolName, _params, toolResult) => toolResult?.layerId,
        invokeMain: async (channel) => channel === 'resource:getAssetSubjectBox'
            ? { success: true, imageWidth: 1200, imageHeight: 1800 }
            : { success: false }
    });
    check(
        'composeDesign 遇到 Photoshop 原生弹窗嫌疑时不重放整单，并把整窗观察出口投影回 Agent',
        modalFailureResult.success === false
            && modalRenderCalls === 1
            && modalSettlementReads === 2
            && modalFailureResult.environmentState === 'photoshop_native_modal_suspected'
            && modalFailureResult.recoveryRequired === true
            && modalFailureResult.environmentObservation?.capability === 'capturePhotoshopWindow'
            && modalFailureResult.environmentObservation?.scope === 'adobe_photoshop_application_window'
            && modalFailureResult.toolResults?.some((entry) => (
                entry.toolName === 'renderLayout'
                && entry.result?.environmentState === 'photoshop_native_modal_suspected'
            )),
        JSON.stringify(modalFailureResult)
    );

    let settlementModalReads = 0;
    const settlementModalResult = await executeComposeDesign({
        ...good,
        document: { mode: 'active', name: '结算读回弹窗活动文档' },
        subject: { ...good.subject, shadow: { kind: 'none' } }
    }, {
        executeToolCall: async (toolName) => {
            if (toolName === 'getDocumentInfo') {
                settlementModalReads += 1;
                if (settlementModalReads === 1) {
                    return {
                        success: true,
                        document: { id: 706, width: 800, height: 800 },
                        historyStateRef: { documentId: 706, historyStateId: 400 }
                    };
                }
                return {
                    success: false,
                    recoveryRequired: true,
                    environmentState: 'photoshop_native_modal_suspected',
                    environmentObservation: {
                        capability: 'capturePhotoshopWindow',
                        scope: 'adobe_photoshop_application_window'
                    },
                    error: '失败结算读取时 Photoshop 出现原生弹窗嫌疑。'
                };
            }
            if (toolName === 'createRectangle') {
                return { success: false, error: '背景写入没有返回可确认结果。' };
            }
            return { success: true };
        },
        inferLayerId: () => undefined,
        invokeMain: async (channel) => channel === 'resource:getAssetSubjectBox'
            ? { success: true, imageWidth: 1200, imageHeight: 1800 }
            : { success: false }
    });
    check(
        '原始写失败未携带弹窗字段、但失败结算读回发现弹窗时，恢复证据仍能到达 Agent',
        settlementModalResult.success === false
            && settlementModalResult.data?.mutationStatus === 'unknown'
            && settlementModalResult.environmentState === 'photoshop_native_modal_suspected'
            && settlementModalResult.environmentObservation?.capability === 'capturePhotoshopWindow'
            && settlementModalReads === 2,
        JSON.stringify(settlementModalResult)
    );

    let conflictingSettlementReads = 0;
    const conflictingProofResult = await executeComposeDesign({
        ...good,
        document: { mode: 'active', name: '冲突证据活动文档' },
        subject: { ...good.subject, shadow: { kind: 'none' } }
    }, {
        executeToolCall: async (toolName) => {
            if (toolName === 'getDocumentInfo') {
                conflictingSettlementReads += 1;
                return {
                    success: true,
                    document: { id: 702, width: 800, height: 800 },
                    historyStateRef: { documentId: 702, historyStateId: 900 }
                };
            }
            if (toolName === 'createRectangle') {
                return {
                    success: true,
                    layerId: 21,
                    photoshopHistoryTransition: {
                        version: 'photoshop-history-transition/v1', basis: 'acceptance_snapshot_pair',
                        before: { documentId: 702, historyStateId: 900 },
                        after: { documentId: 702, historyStateId: 901 },
                        mutationObserved: true, documentChanged: false
                    }
                };
            }
            if (toolName === 'renderLayout') {
                return {
                    success: false,
                    error: '局部构图失败后外部发生了撤销',
                    photoshopHistoryTransition: {
                        version: 'photoshop-history-transition/v1', basis: 'acceptance_snapshot_pair',
                        before: { documentId: 702, historyStateId: 901 },
                        after: { documentId: 702, historyStateId: 902 },
                        mutationObserved: true, documentChanged: false
                    }
                };
            }
            return { success: true };
        },
        inferLayerId: (_toolName, _params, toolResult) => toolResult?.layerId,
        invokeMain: async (channel) => channel === 'resource:getAssetSubjectBox'
            ? { success: true, imageWidth: 1200, imageHeight: 1800 }
            : { success: false }
    });
    check(
        'composeDesign 遇到子工具 mutation proof 与最终原版本冲突时保持 unknown，不把撤销或切换冒充未修改',
        conflictingProofResult.success === false
            && conflictingProofResult.data?.mutationStatus === 'unknown'
            && conflictingProofResult.data?.partialMutation === undefined
            && conflictingProofResult.photoshopHistoryTransition === undefined
            && conflictingProofResult.data?.mutationSettlement?.reason?.includes('证据冲突')
            && conflictingSettlementReads === 2,
        JSON.stringify(conflictingProofResult)
    );

    let createdDocumentSettlementReads = 0;
    const failedCreateDocumentResult = await executeComposeDesign(good, {
        executeToolCall: async (toolName) => {
            if (toolName === 'createDocument') {
                return {
                    success: false,
                    error: '文档已创建，但激活后的尺寸读回失败',
                    photoshopMutationCommit: {
                        version: 'photoshop-mutation-commit/v1',
                        basis: 'same_execute_as_modal',
                        bindingStrength: 'unguarded',
                        changeKind: 'document_creation',
                        beforeOpenDocumentIds: [70],
                        createdDocumentId: 703,
                        after: { documentId: 703, historyStateId: 1, activeLayerId: null },
                        toolActionCompleted: false,
                        mutationObserved: true,
                        documentChanged: true
                    }
                };
            }
            if (toolName === 'getDocumentInfo') {
                createdDocumentSettlementReads += 1;
                return {
                    success: true,
                    document: { id: 703, width: 800, height: 800 },
                    historyStateRef: { documentId: 703, historyStateId: 1 }
                };
            }
            return { success: true };
        },
        inferLayerId: () => undefined,
        invokeMain: async (channel) => channel === 'resource:getAssetSubjectBox'
            ? { success: true, imageWidth: 1200, imageHeight: 1800 }
            : { success: false }
    });
    check(
        'createDocument 返回失败但 Host commit 证明新文档已创建时，composeDesign 不再把 createdDocument 写成 false',
        failedCreateDocumentResult.success === false
            && failedCreateDocumentResult.documentId === 703
            && failedCreateDocumentResult.data?.documentId === 703
            && failedCreateDocumentResult.data?.createdDocument === true
            && failedCreateDocumentResult.data?.partialMutation === true
            && failedCreateDocumentResult.data?.mutationStatus === 'applied'
            && createdDocumentSettlementReads === 1,
        JSON.stringify(failedCreateDocumentResult)
    );

    let exceptionSettlementReads = 0;
    const thrownAfterWriteResult = await executeComposeDesign({
        ...good,
        document: { mode: 'active', name: '异常结算活动文档' },
        subject: { ...good.subject, shadow: { kind: 'none' } }
    }, {
        executeToolCall: async (toolName) => {
            if (toolName === 'getDocumentInfo') {
                exceptionSettlementReads += 1;
                const historyStateId = exceptionSettlementReads === 1 ? 1000 : 1001;
                return {
                    success: true,
                    document: { id: 704, width: 800, height: 800 },
                    historyStateRef: { documentId: 704, historyStateId }
                };
            }
            if (toolName === 'createRectangle') {
                return {
                    success: true,
                    layerId: 31,
                    photoshopHistoryTransition: {
                        version: 'photoshop-history-transition/v1', basis: 'acceptance_snapshot_pair',
                        before: { documentId: 704, historyStateId: 1000 },
                        after: { documentId: 704, historyStateId: 1001 },
                        mutationObserved: true, documentChanged: false
                    }
                };
            }
            if (toolName === 'renderLayout') {
                const structuredError = new Error('fixture renderLayout unexpected exception');
                structuredError.success = true;
                throw structuredError;
            }
            return { success: true };
        },
        inferLayerId: (_toolName, _params, toolResult) => toolResult?.layerId,
        invokeMain: async (channel) => channel === 'resource:getAssetSubjectBox'
            ? { success: true, imageWidth: 1200, imageHeight: 1800 }
            : { success: false }
    });
    check(
        'composeDesign 在先写入后发生非结构化异常时仍走同一失败结算，不以 reject 丢失现场事实',
        thrownAfterWriteResult.success === false
            && thrownAfterWriteResult.failedStep === '执行异常'
            && thrownAfterWriteResult.unexpectedException === true
            && thrownAfterWriteResult.data?.partialMutation === true
            && thrownAfterWriteResult.photoshopHistoryTransition?.after?.historyStateId === 1001
            && thrownAfterWriteResult.toolResults?.some((entry) => (
                entry.toolName === 'renderLayout' && entry.result?.success === false
            ))
            && exceptionSettlementReads === 2,
        JSON.stringify(thrownAfterWriteResult)
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
