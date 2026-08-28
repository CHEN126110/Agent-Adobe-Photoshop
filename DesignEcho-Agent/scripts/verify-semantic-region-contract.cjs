// 语义抠图 P0 契约测试：区域导出几何收据 + 目标生命周期完整性。
const path = require('path');
const Module = require('module');

const agentRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.resolve(agentRoot, '..');
require('ts-node').register({
    transpileOnly: true,
    project: path.join(agentRoot, 'tsconfig.main.json')
});

const {
    normalizeMattingOutputFormat,
    validateSemanticBaseExportReceipt,
    validateMattingMutationReceipt,
    validateExpectedMattingTargetIdentity,
    validateMattingTargetIdentityReceipt,
    validateSemanticDetectionCompleteness,
    validateSemanticRegionExportReceipt,
    validateSemanticTargetLifecycle
} = require(path.join(agentRoot, 'src/main/uxp-handlers/visual-handlers.ts'));
const { MattingService } = require(path.join(agentRoot, 'src/main/services/matting-service.ts'));

const photoshopMock = {
    app: { activeDocument: null },
    core: {
        executeAsModal: async (callback) => callback()
    },
    action: {},
    imaging: {}
};
const originalLoad = Module._load;
Module._load = function patchedModuleLoad(request, parent, isMain) {
    if (request === 'photoshop') return photoshopMock;
    if (request === 'uxp') {
        return { storage: { localFileSystem: {}, formats: { binary: 'binary' } } };
    }
    return originalLoad.call(this, request, parent, isMain);
};
const {
    ApplyMattingResultTool,
    RemoveBackgroundTool,
    isMattingOutputFormat,
    validateMattingTargetIdentity,
    validateSemanticMattingApplyContract
} = require(path.join(workspaceRoot, 'DesignEcho-UXP/src/tools/image/remove-background.ts'));
// photoshop-target-guard 在执行时延迟 require('photoshop')；测试全程保留同一 mock，
// 才能覆盖真正的 modal 前 guard，而不是让模块加载成功、运行时又失去 Host。

let failed = 0;
function check(name, condition, detail) {
    if (condition) {
        console.log(`✅ ${name}`);
        return;
    }
    failed += 1;
    console.log(`❌ ${name}${detail ? ` — ${detail}` : ''}`);
}

function makeLifecycle(overrides = {}) {
    return {
        schema: 'semantic-matting-target-lifecycle/v2',
        requestedTargetCount: 2,
        unresolvedTargetCount: 0,
        omittedTargetCount: 0,
        detectedTargetCount: 2,
        detectedRegionCount: 3,
        segmentationRequestedRegionCount: 3,
        segmentationCompletedRegionCount: 3,
        segmentationRequestedTargetCount: 3,
        segmentationCompletedTargetCount: 3,
        segmentationComplete: true,
        appliedRegionCount: 0,
        ...overrides
    };
}

async function run() {
    // ========== Main：区域几何必须来自实际收据 ==========
    const requestedSourceBounds = { left: -50, top: 20, right: 150, bottom: 220 };
    const targetIdentity = {
        schema: 'matting-target-identity/v1',
        documentId: 11,
        historyStateId: 101,
        layerId: 42,
        layerName: '目标图层',
        layerKind: '1',
        layerBounds: { left: -100, top: 0, right: 900, bottom: 800 },
        isBackgroundLayer: false
    };
    const withTargetIdentity = (exportResult) => ({
        ...exportResult,
        targetIdentity,
        sourceHistoryStateRef: { documentId: 11, historyStateId: 101 }
    });
    check(
        '外部工作流绑定同一 document/history 时允许继续',
        validateExpectedMattingTargetIdentity({
            identity: targetIdentity,
            expectedDocumentId: 11,
            expectedHistoryStateId: 101
        }).valid
    );
    check(
        '外部工作流绑定错误 document 时在推理前拒绝',
        validateExpectedMattingTargetIdentity({
            identity: targetIdentity,
            expectedDocumentId: 12,
            expectedHistoryStateId: 101
        }).code === 'expected_document_changed'
    );
    check(
        '外部工作流绑定过期 history 时在推理前拒绝',
        validateExpectedMattingTargetIdentity({
            identity: targetIdentity,
            expectedDocumentId: 11,
            expectedHistoryStateId: 102
        }).code === 'expected_history_state_changed'
    );
    check(
        '外部工作流的非法目标身份断言不能被当作未提供',
        validateExpectedMattingTargetIdentity({
            identity: targetIdentity,
            expectedDocumentId: 0
        }).code === 'expected_document_id_invalid'
    );
    const offCanvasReceipt = validateSemanticRegionExportReceipt({
        requestedSourceBounds,
        expectedMode: 'layer-region',
        expectedTargetIdentity: targetIdentity,
        outputGeometry: { left: -100, top: 0, width: 1000, height: 800 },
        exportResult: withTargetIdentity({
            sourceExportReceiptSchema: 'matting-source-export/v1',
            sourceRegionApplied: true,
            sourceExportMode: 'layer-region',
            requestedSourceBounds,
            actualSourceBounds: { left: 0, top: 20, right: 150, bottom: 220 },
            useBinaryTransfer: true,
            binaryRequestId: 7,
            binaryImageWidth: 150,
            binaryImageHeight: 200
        })
    });
    check('off-canvas clamp 收据可验证', offCanvasReceipt.valid, JSON.stringify(offCanvasReceipt));
    check(
        '回贴坐标使用 actualSourceBounds 而非请求 bounds',
        offCanvasReceipt.regionInOutput?.x1 === 100
            && offCanvasReceipt.regionInOutput?.x2 === 250,
        JSON.stringify(offCanvasReceipt.regionInOutput)
    );

    const wholeLayerFallback = validateSemanticRegionExportReceipt({
        requestedSourceBounds,
        expectedMode: 'layer-region',
        expectedTargetIdentity: targetIdentity,
        outputGeometry: { left: -100, top: 0, width: 1000, height: 800 },
        exportResult: withTargetIdentity({
            sourceExportReceiptSchema: 'matting-source-export/v1',
            sourceRegionApplied: false,
            sourceExportMode: 'layer-full',
            requestedSourceBounds,
            actualSourceBounds: { left: -100, top: 0, right: 900, bottom: 800 },
            useBinaryTransfer: true,
            binaryRequestId: 8,
            binaryImageWidth: 1000,
            binaryImageHeight: 800
        })
    });
    check('区域请求回退整层时 fail-closed', !wholeLayerFallback.valid && wholeLayerFallback.code === 'semantic_region_not_applied');

    const missingReceipt = validateSemanticRegionExportReceipt({
        requestedSourceBounds,
        expectedMode: 'layer-region',
        expectedTargetIdentity: targetIdentity,
        outputGeometry: { left: -100, top: 0, width: 1000, height: 800 },
        exportResult: withTargetIdentity({ success: true })
    });
    check('缺几何收据时 fail-closed', !missingReceipt.valid && missingReceipt.code === 'semantic_region_receipt_missing');

    const outsideReceipt = validateSemanticRegionExportReceipt({
        requestedSourceBounds,
        expectedMode: 'layer-region',
        expectedTargetIdentity: targetIdentity,
        outputGeometry: { left: -100, top: 0, width: 1000, height: 800 },
        exportResult: withTargetIdentity({
            sourceExportReceiptSchema: 'matting-source-export/v1',
            sourceRegionApplied: true,
            sourceExportMode: 'layer-region',
            requestedSourceBounds,
            actualSourceBounds: { left: -80, top: 20, right: 200, bottom: 220 },
            useBinaryTransfer: true,
            binaryRequestId: 9,
            binaryImageWidth: 280,
            binaryImageHeight: 200
        })
    });
    check('实际 bounds 超出请求时拒绝', !outsideReceipt.valid && outsideReceipt.code === 'semantic_region_actual_outside_request');

    const baseReceipt = validateSemanticBaseExportReceipt({
        expectedMode: 'layer-full',
        outputGeometry: { left: -100, top: 0, width: 1000, height: 800 },
        exportResult: {
            sourceExportReceiptSchema: 'matting-source-export/v1',
            sourceRegionApplied: false,
            sourceExportMode: 'layer-full',
            actualSourceBounds: { left: 0, top: 0, right: 900, bottom: 800 }
        }
    });
    check('首次 off-canvas 导出也必须返回实际 bounds', baseReceipt.valid, JSON.stringify(baseReceipt));
    check(
        '首次导出实际范围映射到完整图层输出坐标',
        baseReceipt.regionInOutput?.x1 === 100 && baseReceipt.regionInOutput?.x2 === 1000,
        JSON.stringify(baseReceipt.regionInOutput)
    );

    const changedRevisionReceipt = validateSemanticRegionExportReceipt({
        requestedSourceBounds,
        expectedMode: 'layer-region',
        expectedTargetIdentity: targetIdentity,
        outputGeometry: { left: -100, top: 0, width: 1000, height: 800 },
        exportResult: {
            ...withTargetIdentity({
                sourceExportReceiptSchema: 'matting-source-export/v1',
                sourceRegionApplied: true,
                sourceExportMode: 'layer-region',
                requestedSourceBounds,
                actualSourceBounds: { left: 0, top: 20, right: 150, bottom: 220 },
                useBinaryTransfer: true,
                binaryRequestId: 10,
                binaryImageWidth: 150,
                binaryImageHeight: 200
            }),
            targetIdentity: { ...targetIdentity, historyStateId: 102 },
            sourceHistoryStateRef: { documentId: 11, historyStateId: 102 }
        }
    });
    check(
        'high-res 区域图 history 与首次导出不一致时拒绝',
        !changedRevisionReceipt.valid && changedRevisionReceipt.code === 'semantic_region_target_revision_changed',
        JSON.stringify(changedRevisionReceipt)
    );

    check(
        'Main 严格校验目标身份 receipt',
        validateMattingTargetIdentityReceipt(targetIdentity).valid
            && !validateMattingTargetIdentityReceipt({ ...targetIdentity, layerName: '另一图层' }, targetIdentity).valid
    );

    // ========== Main + UXP：requested/detected/segmented/applied 守恒 ==========
    check(
        '未解析目标在检测前整体失败',
        !validateSemanticTargetLifecycle(makeLifecycle({ unresolvedTargetCount: 1 }), 'pre-detection').valid
    );
    check(
        '超限 omitted 目标在检测前整体失败',
        !validateSemanticTargetLifecycle(makeLifecycle({ omittedTargetCount: 1 }), 'pre-detection').valid
    );
    check(
        'mixed 检测只命中部分短语时整体失败',
        !validateSemanticTargetLifecycle(makeLifecycle({ detectedTargetCount: 1 }), 'post-detection').valid
    );
    check(
        '分割只完成部分检测框时 apply 前失败',
        !validateSemanticTargetLifecycle(makeLifecycle({ segmentationCompletedRegionCount: 2 }), 'pre-apply').valid
    );
    check('完整目标收据允许进入 apply', validateSemanticTargetLifecycle(makeLifecycle(), 'pre-apply').valid);
    check(
        'apply 成功但缺 applied 数量收据时不报成功',
        !validateSemanticTargetLifecycle(makeLifecycle(), 'post-apply').valid
    );
    check(
        'requested/detected/segmented/applied 全部守恒才完成',
        validateSemanticTargetLifecycle(makeLifecycle({ appliedRegionCount: 3 }), 'post-apply').valid
    );
    check(
        'region 与 target 四个分割计数分别守恒',
        !validateSemanticTargetLifecycle(
            makeLifecycle({ segmentationCompletedRegionCount: 3, segmentationCompletedTargetCount: 2 }),
            'pre-apply'
        ).valid
    );
    check(
        '检测实例被安全上限截断时整体失败',
        !validateSemanticDetectionCompleteness({
            complete: false,
            candidateCountBeforeLimit: 14,
            returnedRegionCount: 12,
            truncatedRegionCount: 2,
            boxes: new Array(12).fill({})
        }).valid
    );
    check(
        '完整且未截断的检测收据可进入逐短语检查',
        validateSemanticDetectionCompleteness({
            complete: true,
            candidateCountBeforeLimit: 3,
            returnedRegionCount: 3,
            truncatedRegionCount: 0,
            boxes: new Array(3).fill({})
        }).valid
    );
    check(
        'Main 与 UXP 都拒绝非法 outputFormat',
        normalizeMattingOutputFormat('not-a-format') === null
            && !isMattingOutputFormat('not-a-format')
            && normalizeMattingOutputFormat('MASK') === 'mask'
    );
    check('channel 是受白名单约束的已知输出格式', normalizeMattingOutputFormat('channel') === 'channel');
    const verifiedMutationReceipt = {
        schema: 'matting-mutation-receipt/v1',
        documentId: 11,
        requestedLayerId: 42,
        actualLayerId: 42,
        beforeHistoryStateId: 101,
        afterHistoryStateId: 102,
        historyChanged: true,
        historyChangeRequired: true,
        outputFormat: 'mask',
        maskWidth: 1000,
        maskHeight: 800,
        outputReadback: 'verified',
        outputReadbackKind: 'user-mask-enabled',
        outputExists: true,
        complete: true
    };
    check(
        'Main 只接受真实 history 变化和输出读回均完整的 mutation receipt',
        validateMattingMutationReceipt({
            value: verifiedMutationReceipt,
            expectedTargetIdentity: targetIdentity,
            expectedOutputFormat: 'mask',
            expectedMaskWidth: 1000,
            expectedMaskHeight: 800
        }).valid
    );
    check(
        '仅回显 appliedRegionCount、缺真实 mutation readback 时不能完成',
        !validateMattingMutationReceipt({
            value: { ...verifiedMutationReceipt, outputReadback: 'unknown', outputExists: null, complete: false },
            expectedTargetIdentity: targetIdentity,
            expectedOutputFormat: 'mask',
            expectedMaskWidth: 1000,
            expectedMaskHeight: 800
        }).valid
    );
    check(
        'selection 可用选区 bounds 读回完成，不伪造必须变化的 history',
        validateMattingMutationReceipt({
            value: {
                ...verifiedMutationReceipt,
                afterHistoryStateId: 101,
                historyChanged: false,
                historyChangeRequired: false,
                outputFormat: 'selection',
                outputReadbackKind: 'selection-bounds'
            },
            expectedTargetIdentity: targetIdentity,
            expectedOutputFormat: 'selection',
            expectedMaskWidth: 1000,
            expectedMaskHeight: 800
        }).valid
    );

    // 同一局部图内的多 box 必须逐目标验证。box1 的 union mask 即使跨进 box2，
    // 也不能替一个真实失败的 box2 伪造“框内有前景”。
    const mattingService = new MattingService({ gpuMode: 'cpu' });
    mattingService.initialized = true;
    mattingService.loadBiRefNetModel = async () => false;
    mattingService.decodeImageInput = async () => ({
        buffer: Buffer.from('semantic-region-fixture'),
        width: 20,
        height: 10
    });
    const crossingMask = Buffer.alloc(20 * 10, 0);
    for (let y = 2; y < 8; y++) {
        for (let x = 2; x < 16; x++) crossingMask[y * 20 + x] = 255;
    }
    let samCall = 0;
    mattingService.setBoxSegmenter({
        isReady() { return true; },
        async segmentWithBox() {
            samCall += 1;
            if (samCall === 1) {
                return { success: true, mask: crossingMask, maskWidth: 20, maskHeight: 10 };
            }
            return { success: false, error: 'injected second target failure' };
        }
    });
    const perTargetFailure = await mattingService.segmentHighResRegions([
        {
            imageInput: 'fixture',
            regionInOutput: { x1: 0, y1: 0, x2: 20, y2: 10 },
            boxesInRegion: [
                { x1: 1, y1: 1, x2: 9, y2: 9 },
                { x1: 11, y1: 1, x2: 19, y2: 9 }
            ]
        }
    ], {
        outputWidth: 20,
        outputHeight: 10,
        binaryMaskOutput: true
    });
    check(
        'SAM 第二目标失败时，第一目标跨框 mask 不能伪造完整成功',
        perTargetFailure.success === false
            && perTargetFailure.targetCompleteness?.complete === false
            && perTargetFailure.targetCompleteness?.segmentedTargetCount === 0
            && JSON.stringify(perTargetFailure.targetCompleteness?.failedRegionIndexes) === '[0]',
        JSON.stringify(perTargetFailure.targetCompleteness)
    );

    const legacyBoxService = new MattingService({ gpuMode: 'cpu' });
    legacyBoxService.initialized = true;
    legacyBoxService.loadBiRefNetModel = async () => false;
    legacyBoxService.resolveImageBuffer = async () => ({
        buffer: Buffer.from('legacy-box-fixture'),
        error: null
    });
    legacyBoxService.sharp = () => ({ metadata: async () => ({ width: 20, height: 10 }) });
    let legacySamCall = 0;
    legacyBoxService.setBoxSegmenter({
        isReady() { return true; },
        async segmentWithBox() {
            legacySamCall += 1;
            return legacySamCall === 1
                ? { success: true, mask: crossingMask, maskWidth: 20, maskHeight: 10 }
                : { success: false, error: 'injected partial legacy box failure' };
        }
    });
    const legacyPartial = await legacyBoxService.segmentWithinBoxes('fixture', [
        { x1: 1, y1: 1, x2: 9, y2: 9 },
        { x1: 11, y1: 1, x2: 19, y2: 9 }
    ], { binaryMaskOutput: true });
    check(
        '旧框内分割入口也不能以 1/2 成功返回部分 union mask',
        legacyPartial.success === false
            && !legacyPartial.maskBuffer
            && /1\/2/.test(legacyPartial.error || ''),
        JSON.stringify({ success: legacyPartial.success, error: legacyPartial.error })
    );

    const noScopeService = new MattingService({ gpuMode: 'cpu' });
    noScopeService.initialized = true;
    noScopeService.decodeImageInput = async () => ({
        buffer: Buffer.from('semantic-no-scope-fixture'),
        width: 20,
        height: 10
    });
    noScopeService.loadBiRefNetModel = async () => true;
    noScopeService.segmentBoxWithBiRefNet = async () => ({
        maskBuffer: Buffer.alloc(20 * 10, 255),
        width: 20,
        height: 10,
        offsetX: 0,
        offsetY: 0
    });
    noScopeService.setBoxSegmenter(null);
    const noVerifiedScope = await noScopeService.segmentHighResRegions([
        {
            imageInput: 'fixture',
            regionInOutput: { x1: 0, y1: 0, x2: 20, y2: 10 },
            boxesInRegion: [{ x1: 2, y1: 1, x2: 18, y2: 9 }]
        }
    ], {
        outputWidth: 20,
        outputHeight: 10,
        binaryMaskOutput: true,
        requireVerifiedSemanticScope: true
    });
    check(
        '语义模式下 SAM 不可用时，BiRefNet 有前景也不能签完整 scope',
        noVerifiedScope.success === false
            && noVerifiedScope.targetCompleteness?.complete === false
            && noVerifiedScope.targetCompleteness?.scopeVerificationComplete === false,
        JSON.stringify(noVerifiedScope.targetCompleteness)
    );

    check('UXP 接受完整的 pre-apply 契约', validateSemanticMattingApplyContract(makeLifecycle()));
    check(
        'UXP 在 Photoshop mutation 前拒绝部分分割契约',
        !validateSemanticMattingApplyContract(makeLifecycle({ segmentationCompletedTargetCount: 2 }))
    );
    const applyTool = new ApplyMattingResultTool();
    const rejectedOutputFormat = await applyTool.execute({
        originalLayerId: 42,
        outputFormat: 'not-a-format'
    });
    check(
        'UXP 在读取蒙版或进入 modal 前拒绝非法 outputFormat',
        rejectedOutputFormat.success === false
            && rejectedOutputFormat.errorCode === 'MATTING_OUTPUT_FORMAT_INVALID',
        JSON.stringify(rejectedOutputFormat)
    );
    const rejectedDeleteBackground = await applyTool.execute({
        originalLayerId: 42,
        outputFormat: 'selection',
        deleteBackground: true
    });
    check(
        'UXP 在 mutation 前拒绝无像素读回的 deleteBackground',
        rejectedDeleteBackground.success === false
            && rejectedDeleteBackground.errorCode === 'MATTING_DELETE_BACKGROUND_UNSUPPORTED',
        JSON.stringify(rejectedDeleteBackground)
    );
    const rejectedApply = await applyTool.execute({
        originalLayerId: 42,
        semanticTargetContract: makeLifecycle({ detectedTargetCount: 1 })
    });
    check(
        'UXP 无文档环境下也先拒绝不完整目标，不触发 Photoshop',
        rejectedApply.success === false && rejectedApply.errorCode === 'SEMANTIC_TARGET_CONTRACT_INCOMPLETE',
        JSON.stringify(rejectedApply)
    );

    // ========== UXP：区域失败不得触发整层 / copy / Base64 回退 ==========
    const layer = {
        id: 42,
        name: '目标图层',
        kind: 1,
        isBackgroundLayer: false,
        bounds: { left: -100, top: 0, right: 900, bottom: 800 }
    };
    photoshopMock.app.activeDocument = {
        id: 11,
        width: 1000,
        height: 800,
        activeHistoryState: { id: 101 },
        layers: [layer],
        activeLayers: [layer]
    };
    check(
        'UXP 目标身份同时绑定 document/history/layer identity',
        validateMattingTargetIdentity(targetIdentity, photoshopMock.app.activeDocument).valid
    );
    photoshopMock.action.batchPlay = async (descriptors) => {
        if (descriptors?.[0]?._obj === 'get' && descriptors?.[0]?._target?.[0]?._ref === 'layer') {
            return [{ userMaskEnabled: true }];
        }
        return [];
    };
    const successfulApplyTool = new ApplyMattingResultTool();
    successfulApplyTool.applyRawMaskAsLayerMask = async () => {
        photoshopMock.app.activeDocument.activeHistoryState = { id: 102 };
        return 42;
    };
    const verifiedApplyResult = await successfulApplyTool.execute({
        originalLayerId: 42,
        outputFormat: 'mask',
        maskImageBase64: 'RAW_MASK:1:1:/w==',
        semanticTargetContract: makeLifecycle(),
        expectedTargetIdentity: targetIdentity
    });
    check(
        'UXP success 绑定真实 before/after history 与 user-mask readback receipt',
        verifiedApplyResult.success === true
            && verifiedApplyResult.mutationReceipt?.beforeHistoryStateId === 101
            && verifiedApplyResult.mutationReceipt?.afterHistoryStateId === 102
            && verifiedApplyResult.mutationReceipt?.outputReadback === 'verified'
            && verifiedApplyResult.mutationReceipt?.complete === true,
        JSON.stringify(verifiedApplyResult)
    );
    photoshopMock.app.activeDocument.activeHistoryState = { id: 101 };
    photoshopMock.action.batchPlay = async (descriptors) => {
        if (descriptors?.[0]?._obj === 'get'
            && descriptors?.[0]?._target?.[0]?._property === 'name') {
            return [{ name: 'DesignEcho Mask' }];
        }
        return [];
    };
    const successfulChannelTool = new ApplyMattingResultTool();
    successfulChannelTool.createAlphaChannelFromRawMask = async () => {
        photoshopMock.app.activeDocument.activeHistoryState = { id: 103 };
        return { name: 'DesignEcho Mask', id: 77 };
    };
    const verifiedChannelResult = await successfulChannelTool.execute({
        originalLayerId: 42,
        outputFormat: 'channel',
        maskImageBase64: 'RAW_MASK:1:1:/w==',
        semanticTargetContract: makeLifecycle(),
        expectedTargetIdentity: targetIdentity
    });
    check(
        'channel 仅在 DesignEcho Mask 名称读回与 history 变化均真实时成功',
        verifiedChannelResult.success === true
            && verifiedChannelResult.mutationReceipt?.channelName === 'DesignEcho Mask'
            && verifiedChannelResult.mutationReceipt?.outputReadbackKind === 'alpha-channel-name'
            && verifiedChannelResult.mutationReceipt?.complete === true,
        JSON.stringify(verifiedChannelResult)
    );
    photoshopMock.app.activeDocument.activeHistoryState = { id: 101 };
    const mismatchedApplyIdentity = { ...targetIdentity, historyStateId: 100 };
    const rejectedChangedTargetApply = await new ApplyMattingResultTool().execute({
        originalLayerId: 42,
        outputFormat: 'mask',
        semanticTargetContract: makeLifecycle(),
        expectedTargetIdentity: mismatchedApplyIdentity
    });
    check(
        'apply 在读取蒙版和 Photoshop mutation 前拒绝已变化 history',
        rejectedChangedTargetApply.success === false
            && rejectedChangedTargetApply.errorCode === 'MATTING_TARGET_CHANGED_BEFORE_APPLY',
        JSON.stringify(rejectedChangedTargetApply)
    );
    let missingLayerRejected = false;
    await new ApplyMattingResultTool().applyRawMaskAsLayerMask(
        11,
        999,
        new Uint8Array([255]),
        1,
        1
    ).catch(() => {
        missingLayerRejected = true;
    });
    check('RAW mask 找不到绑定 layerId 时不再回退 active layer', missingLayerRejected);
    const createdChannelNames = [];
    photoshopMock.action.batchPlay = async (descriptors) => {
        for (const descriptor of descriptors || []) {
            if (descriptor?._obj === 'make' && descriptor?.new?._class === 'channel') {
                createdChannelNames.push(descriptor.name);
            }
        }
        return [];
    };
    photoshopMock.imaging.createImageDataFromBuffer = async () => {
        throw new Error('injected alpha image failure');
    };
    let alphaFailurePropagated = false;
    await new ApplyMattingResultTool().createAlphaChannelFromRawMask(
        11,
        new Uint8Array([255]),
        1,
        1
    ).catch(() => {
        alphaFailurePropagated = true;
    });
    check(
        'Alpha 通道创建失败向上抛出且不再创建空通道冒充成功',
        alphaFailurePropagated
            && JSON.stringify(createdChannelNames) === JSON.stringify([]),
        JSON.stringify(createdChannelNames)
    );
    photoshopMock.app.activeDocument.activeHistoryState = { id: 102 };
    let changedRevisionReadCalls = 0;
    const changedRevisionTool = new RemoveBackgroundTool();
    changedRevisionTool.setWebSocketClient({ sendBinaryData() {} });
    changedRevisionTool.getLayerImageDataBinary = async () => {
        changedRevisionReadCalls += 1;
        throw new Error('must not read changed revision');
    };
    const changedRevisionExport = await changedRevisionTool.execute({
        layerId: 42,
        sourceRegion: requestedSourceBounds,
        expectedTargetIdentity: targetIdentity
    });
    check(
        'high-res 取像在 history 变化后、读取像素前失败',
        changedRevisionExport.success === false
            && changedRevisionExport.error === 'SOURCE_TARGET_CHANGED'
            && changedRevisionReadCalls === 0,
        JSON.stringify(changedRevisionExport)
    );
    photoshopMock.app.activeDocument.activeHistoryState = { id: 101 };
    const exportTool = new RemoveBackgroundTool();
    exportTool.setWebSocketClient({ sendBinaryData() {} });
    let wholeLayerFallbackCalls = 0;
    exportTool.getLayerImageDataBinary = async () => {
        throw new Error('injected region export failure');
    };
    exportTool.copyLayerAndExportBinary = async () => {
        wholeLayerFallbackCalls += 1;
        throw new Error('whole-layer binary fallback must not run');
    };
    exportTool.getLayerImageData = async () => {
        wholeLayerFallbackCalls += 1;
        return 'unexpected base64 fallback';
    };
    exportTool.copyLayerAndExport = async () => {
        wholeLayerFallbackCalls += 1;
        return 'unexpected copy fallback';
    };
    const failedRegionExport = await exportTool.execute({
        layerId: 42,
        sourceRegion: { left: -50, top: 20, right: 150, bottom: 220 },
        expectedTargetIdentity: targetIdentity
    });
    check(
        'UXP 区域导出失败返回 SOURCE_REGION_EXPORT_FAILED',
        failedRegionExport.success === false && failedRegionExport.error === 'SOURCE_REGION_EXPORT_FAILED',
        JSON.stringify(failedRegionExport)
    );
    check('UXP 区域导出失败没有调用任何整层回退', wholeLayerFallbackCalls === 0, String(wholeLayerFallbackCalls));

    // ========== UXP：Photoshop 返回的 sourceBounds 原样进入收据 ==========
    photoshopMock.imaging.getPixels = async () => ({
        sourceBounds: { left: 0, top: 20, right: 150, bottom: 220 },
        imageData: {
            width: 150,
            height: 200,
            components: 3,
            dispose() {},
            async getData() { return new Uint8Array(150 * 200 * 3); }
        }
    });
    photoshopMock.imaging.encodeImageData = async () => new ArrayBuffer(32);
    const receiptTool = new RemoveBackgroundTool();
    const binaryFullExport = await receiptTool.getLayerImageDataBinary(
        42,
        512,
        { expectedTargetIdentity: targetIdentity }
    );
    check(
        'UXP 首次整层 getPixels 也返回实际 sourceBounds/mode',
        binaryFullExport.sourceRegionApplied === false
            && binaryFullExport.sourceExportMode === 'layer-full'
            && JSON.stringify(binaryFullExport.actualSourceBounds) === JSON.stringify({ left: 0, top: 20, right: 150, bottom: 220 }),
        JSON.stringify(binaryFullExport)
    );
    const binaryRegion = await receiptTool.getLayerImageDataBinary(
        42,
        512,
        { sourceRegion: requestedSourceBounds, expectedTargetIdentity: targetIdentity }
    );
    check('UXP 标记 sourceRegionApplied=true', binaryRegion.sourceRegionApplied === true);
    check('UXP 返回 layer-region 模式', binaryRegion.sourceExportMode === 'layer-region');
    check(
        'UXP 返回 Photoshop 实际 clamp bounds',
        JSON.stringify(binaryRegion.actualSourceBounds) === JSON.stringify({ left: 0, top: 20, right: 150, bottom: 220 }),
        JSON.stringify(binaryRegion.actualSourceBounds)
    );

    let midReadDisposeCount = 0;
    photoshopMock.imaging.getPixels = async () => {
        photoshopMock.app.activeDocument.activeHistoryState = { id: 104 };
        return {
            sourceBounds: { left: 0, top: 20, right: 150, bottom: 220 },
            imageData: {
                width: 150,
                height: 200,
                components: 3,
                dispose() { midReadDisposeCount += 1; },
                async getData() { return new Uint8Array(150 * 200 * 3); }
            }
        };
    };
    let midReadRevisionRejected = false;
    await receiptTool.getLayerImageDataBinary(
        42,
        512,
        { sourceRegion: requestedSourceBounds, expectedTargetIdentity: targetIdentity }
    ).catch(() => {
        midReadRevisionRejected = true;
    });
    check(
        'getPixels modal 读取期间 history 改变时丢弃图像且 fail-closed',
        midReadRevisionRejected && midReadDisposeCount === 1,
        `rejected=${midReadRevisionRejected}, dispose=${midReadDisposeCount}`
    );
    photoshopMock.app.activeDocument.activeHistoryState = { id: 101 };

    let disposeCount = 0;
    photoshopMock.imaging.getPixels = async () => ({
        sourceBounds: { left: 0, top: 20, right: 150, bottom: 220 },
        imageData: {
            width: 150,
            height: 200,
            components: 3,
            dispose() { disposeCount += 1; },
            async getData() { throw new Error('injected raw read failure'); }
        }
    });
    photoshopMock.imaging.encodeImageData = async () => {
        throw new Error('injected encode failure');
    };
    let dualEncodingFailureObserved = false;
    await receiptTool.getLayerImageDataBinary(
        42,
        512,
        { sourceRegion: requestedSourceBounds, expectedTargetIdentity: targetIdentity }
    ).catch(() => {
        dualEncodingFailureObserved = true;
    });
    check(
        'JPEG 与 RAW 都失败时 ImageData 仍且仅 dispose 一次',
        dualEncodingFailureObserved && disposeCount === 1,
        `failure=${dualEncodingFailureObserved}, dispose=${disposeCount}`
    );

    console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项未通过`);
    process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
