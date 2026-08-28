const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const uxpRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(uxpRoot, '..');
const agentRoot = path.join(repoRoot, 'DesignEcho-Agent');

function transpileTypeScriptModule(sourcePath, moduleName, requireModule = require) {
    const source = fs.readFileSync(sourcePath, 'utf8');
    const transpiled = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            strict: true
        },
        fileName: sourcePath,
        reportDiagnostics: true
    });
    const errors = (transpiled.diagnostics || []).filter(
        diagnostic => diagnostic.category === ts.DiagnosticCategory.Error
    );
    assert.equal(errors.length, 0, `${moduleName} transpile diagnostics should be empty`);
    const loadedModule = { exports: {} };
    const wrapper = vm.runInThisContext(
        `(function (require, module, exports) { ${transpiled.outputText}\n})`,
        { filename: sourcePath }
    );
    wrapper(requireModule, loadedModule, loadedModule.exports);
    return loadedModule.exports;
}

function readExportedConstant(sourcePath, constantName) {
    const source = fs.readFileSync(sourcePath, 'utf8');
    const match = source.match(new RegExp(
        `export\\s+const\\s+${constantName}\\s*=\\s*['\"]([^'\"]+)['\"]`
    ));
    assert.ok(match, `missing ${constantName} in ${sourcePath}`);
    return match[1];
}

function createBounds() {
    return {
        left: 37,
        top: 61,
        right: 277,
        bottom: 421,
        width: 240,
        height: 360
    };
}

function createLayerState(overrides = {}) {
    return {
        layerId: 9,
        parentId: 3,
        layerName: '源图',
        visible: true,
        bounds: createBounds(),
        ...overrides
    };
}

function loadContracts() {
    const contractPath = path.join(uxpRoot, 'src/tools/sku/pose-alignment-contract.ts');
    const validationPath = path.join(uxpRoot, 'src/tools/sku/pose-alignment-validation.ts');
    const contract = transpileTypeScriptModule(contractPath, 'pose-alignment-contract.ts');
    const validation = transpileTypeScriptModule(
        validationPath,
        'pose-alignment-validation.ts',
        (moduleName) => {
            if (moduleName === './pose-alignment-contract') return contract;
            return require(moduleName);
        }
    );
    return { contract, validation };
}

function assertCrossRuntimeVersionBinding(contract) {
    const providerContractPath = path.join(
        agentRoot,
        'src/shared/sku-pose-alignment-provider-contract.ts'
    );
    const qualityContractPath = path.join(
        agentRoot,
        'src/shared/sku-pose-alignment-contract.ts'
    );
    const expected = {
        SKU_POSE_ALIGNMENT_WORKFLOW_VERSION: readExportedConstant(
            providerContractPath,
            'SKU_POSE_ALIGNMENT_WORKFLOW_VERSION'
        ),
        SKU_POSE_ALIGNMENT_APPLY_VERSION: readExportedConstant(
            providerContractPath,
            'SKU_POSE_ALIGNMENT_APPLY_VERSION'
        ),
        SKU_POSE_ALIGNMENT_PROVIDER_RECEIPT_VERSION: readExportedConstant(
            providerContractPath,
            'SKU_POSE_ALIGNMENT_PROVIDER_RECEIPT_VERSION'
        ),
        SKU_POSE_ALIGNMENT_REPORT_VERSION: readExportedConstant(
            qualityContractPath,
            'SKU_POSE_ALIGNMENT_REPORT_VERSION'
        ),
        SKU_POSE_ALIGNMENT_QUALITY_PROFILE: readExportedConstant(
            qualityContractPath,
            'SKU_POSE_ALIGNMENT_QUALITY_PROFILE'
        )
    };
    for (const [name, value] of Object.entries(expected)) {
        assert.equal(contract[name], value, `${name} must match Agent and UXP exactly`);
    }
    const uxpCaptureContractPath = path.join(
        uxpRoot,
        'src/tools/image/layer-pixel-capture-contract.ts'
    );
    const agentCaptureContractPath = path.join(
        agentRoot,
        'src/shared/layer-pixel-capture-contract.ts'
    );
    assert.equal(
        readExportedConstant(uxpCaptureContractPath, 'LAYER_PIXEL_CAPTURE_VERSION'),
        readExportedConstant(agentCaptureContractPath, 'LAYER_PIXEL_CAPTURE_VERSION'),
        'layer pixel capture contract must match Agent and UXP exactly'
    );
}

function loadPanelWorkflow(contract) {
    const panelWorkflowPath = path.join(uxpRoot, 'src/core/sku-pose-panel-workflow.ts');
    return transpileTypeScriptModule(
        panelWorkflowPath,
        'sku-pose-panel-workflow.ts',
        (moduleName) => {
            if (moduleName === '../tools/sku/pose-alignment-contract') return contract;
            return require(moduleName);
        }
    );
}

async function assertPanelBatchWorkflow(contract, panelWorkflow) {
    const calls = [];
    const progress = [];
    const targets = new Map([
        [9, { documentId: 42, historyStateId: 100, layerId: 9, layerName: '浅咖' }],
        [10, { documentId: 42, historyStateId: 101, layerId: 10, layerName: '深咖' }]
    ]);
    const result = await panelWorkflow.executeSkuPosePanelBatch({
        expectedDocumentId: 42,
        layerIds: [9, 9, 10],
        strength: 0.7,
        cuffLockRatio: 0.15
    }, {
        readCurrentTarget(layerId) {
            const target = targets.get(layerId);
            assert.ok(target, `missing target fixture ${layerId}`);
            return target;
        },
        async invokeWorkflow(params, timeoutMs) {
            calls.push({ params, timeoutMs });
            if (params.layerId === 9) {
                return { success: true, status: 'applied', noMutation: false };
            }
            return { success: true, status: 'not_needed', noMutation: true };
        },
        onProgress(item) {
            progress.push(item);
        }
    });
    assert.equal(calls.length, 2, 'duplicate layer ids must not repeat mutations');
    assert.equal(calls[0].params.version, contract.SKU_POSE_ALIGNMENT_WORKFLOW_VERSION);
    assert.deepEqual(calls[0].params.options, { strength: 0.7, cuffLockRatio: 0.15 });
    assert.equal(calls[0].params.expectedDocumentId, 42);
    assert.equal(calls[0].params.expectedHistoryStateId, 100);
    assert.equal(calls[0].params.resultLayerName, '浅咖 · 姿态统一');
    assert.equal(calls[1].params.expectedHistoryStateId, 101);
    assert.ok(calls.every(call => call.timeoutMs === 180000));
    assert.equal(result.success, true);
    assert.equal(result.totalLayers, 2);
    assert.equal(result.appliedCount, 1);
    assert.equal(result.notNeededCount, 1);
    assert.equal(result.stoppedOnUnknownMutation, false);
    assert.equal(progress.length, 4, 'each layer must have real start/finish progress');

    let safeFailureCalls = 0;
    const safeFailure = await panelWorkflow.executeSkuPosePanelBatch({
        expectedDocumentId: 42,
        layerIds: [9, 10],
        strength: 1,
        cuffLockRatio: 0
    }, {
        readCurrentTarget(layerId) {
            return targets.get(layerId);
        },
        async invokeWorkflow(params) {
            safeFailureCalls += 1;
            if (params.layerId === 9) {
                return {
                    success: false,
                    status: 'rejected',
                    noMutation: true,
                    error: '候选会裁切主体，已跳过。'
                };
            }
            return { success: true, status: 'applied', noMutation: false };
        }
    });
    assert.equal(safeFailureCalls, 2, 'proven no-mutation rejection may continue safely');
    assert.equal(safeFailure.rejectedCount, 1);
    assert.equal(safeFailure.appliedCount, 1);
    assert.equal(safeFailure.success, false);
    assert.equal(safeFailure.stoppedOnUnknownMutation, false);

    let unknownCalls = 0;
    const unknown = await panelWorkflow.executeSkuPosePanelBatch({
        expectedDocumentId: 42,
        layerIds: [9, 10, 11],
        strength: 0.8,
        cuffLockRatio: 0
    }, {
        readCurrentTarget(layerId) {
            return {
                documentId: 42,
                historyStateId: 200 + unknownCalls,
                layerId,
                layerName: `图层 ${layerId}`
            };
        },
        async invokeWorkflow() {
            unknownCalls += 1;
            if (unknownCalls === 1) {
                return { success: true, status: 'applied', noMutation: false };
            }
            return {
                success: false,
                status: 'failed',
                noMutation: false,
                mutationState: 'unknown',
                error: '写入结果无法确认。'
            };
        }
    });
    assert.equal(unknownCalls, 2, 'unknown mutation must stop later selected layers');
    assert.equal(unknown.processedCount, 2);
    assert.equal(unknown.stoppedOnUnknownMutation, true);
    assert.equal(unknown.failedCount, 1);

    let wrongDocumentCalls = 0;
    const wrongDocument = await panelWorkflow.executeSkuPosePanelBatch({
        expectedDocumentId: 42,
        layerIds: [9, 10],
        strength: 0.8,
        cuffLockRatio: 0
    }, {
        readCurrentTarget(layerId) {
            return {
                documentId: 99,
                historyStateId: 300,
                layerId,
                layerName: `跨文档 ${layerId}`
            };
        },
        async invokeWorkflow() {
            wrongDocumentCalls += 1;
            throw new Error('must not invoke');
        }
    });
    assert.equal(wrongDocumentCalls, 0, 'stale panel selection must never write another document');
    assert.equal(wrongDocument.processedCount, 1);
    assert.equal(wrongDocument.results[0].noMutation, true);
    assert.match(wrongDocument.results[0].error, /文档已变化/);

    await assert.rejects(
        () => panelWorkflow.executeSkuPosePanelBatch({
            expectedDocumentId: 42,
            layerIds: [9],
            strength: 1.2,
            cuffLockRatio: 0
        }, {
            readCurrentTarget() {
                throw new Error('must not read');
            },
            async invokeWorkflow() {
                throw new Error('must not invoke');
            }
        }),
        /矫正强度必须在 0~1 之间/
    );
}

function assertPanelSurfaceMigration() {
    const htmlPath = path.join(agentRoot, 'public/webview/index.html');
    const indexPath = path.join(uxpRoot, 'src/index.ts');
    const html = fs.readFileSync(htmlPath, 'utf8');
    const indexSource = fs.readFileSync(indexPath, 'utf8');
    assert.match(html, /id="morphEdgeStrength"/);
    assert.match(html, /id="morphCuffProtect"/);
    for (const removedId of [
        'refShapeSelect',
        'morphContentProtect',
        'morphSmoothness',
        'morphStepSelect',
        'morphForceRedetect',
        'sockStyleSelect',
        'cuffTypeGrid'
    ]) {
        assert.ok(!html.includes(`id="${removedId}"`), `${removedId} must leave the live panel`);
    }
    assert.doesNotMatch(html, /morphProgressInterval|setInterval\(\(\) => \{[\s\S]{0,300}showMorphProgress/);
    assert.match(indexSource, /executeSkuPosePanelBatch/);
    assert.match(indexSource, /expectedDocumentId:\s*morphPanelDocumentId/);
    assert.match(indexSource, /sendRequest\('sku-pose-align-v1'/);
    assert.doesNotMatch(indexSource, /sendRequest\('pose-align-layers'/);
    assert.doesNotMatch(indexSource, /sendRequest\('enhanced-shape-morph'/);
}

function assertParameterAndPngContracts(contract, validation) {
    const workingPadding = { left: 84, top: 29, right: 84, bottom: 29 };
    const outputBounds = {
        left: -47,
        top: 32,
        right: 361,
        bottom: 450,
        width: 408,
        height: 418
    };
    const valid = {
        version: contract.SKU_POSE_ALIGNMENT_APPLY_VERSION,
        layerId: 9,
        resultLayerName: '  姿态统一｜浅咖  ',
        sourceBounds: createBounds(),
        outputBounds,
        sourceImageSize: { width: 240, height: 360 },
        outputImageSize: { width: 408, height: 418 },
        workingPadding,
        imageBase64: 'AA==',
        imageByteLength: 24,
        imageChecksum: 'fnv1a32:1234abcd',
        qualityReportVersion: contract.SKU_POSE_ALIGNMENT_REPORT_VERSION,
        qualityProfile: contract.SKU_POSE_ALIGNMENT_QUALITY_PROFILE,
        qualityFingerprint: 'fnv1a32:deadbeef'
    };
    const normalized = validation.normalizeApplySkuPoseAlignmentParams(valid);
    assert.equal(normalized.resultLayerName, '姿态统一｜浅咖');
    assert.equal(normalized.layerId, 9);
    assert.throws(
        () => validation.normalizeApplySkuPoseAlignmentParams({ ...valid, version: 'v0' }),
        /只接受 sku-pose-alignment-apply\/v1/
    );
    assert.throws(
        () => validation.normalizeApplySkuPoseAlignmentParams({
            ...valid,
            qualityProfile: 'unverified-profile/v1'
        }),
        /质量契约版本不匹配/
    );
    assert.throws(
        () => validation.normalizeApplySkuPoseAlignmentParams({
            ...valid,
            sourceBounds: { ...createBounds(), right: 300 }
        }),
        /sourceBounds/
    );
    assert.throws(
        () => validation.normalizeApplySkuPoseAlignmentParams({
            ...valid,
            outputImageSize: { width: 400, height: 418 }
        }),
        /输出像素尺寸与工作画布留白不一致/
    );
    assert.throws(
        () => validation.normalizeApplySkuPoseAlignmentParams({
            ...valid,
            outputBounds: { ...outputBounds, left: -20, right: 388 }
        }),
        /outputBounds 与源图比例及安全留白不一致/
    );
    assert.throws(
        () => validation.normalizeApplySkuPoseAlignmentParams({
            ...valid,
            qualityFingerprint: 'not-a-fingerprint'
        }),
        /qualityFingerprint/
    );

    const pngHeader = Buffer.alloc(24);
    pngHeader.writeUInt32BE(408, 16);
    pngHeader.writeUInt32BE(418, 20);
    assert.deepEqual(validation.readPoseAlignmentPngSize(pngHeader), {
        width: 408,
        height: 418
    });
    assert.throws(
        () => validation.readPoseAlignmentPngSize(Buffer.alloc(12)),
        /文件头不完整/
    );
}

function assertReadbackVerification(validation) {
    const bounds = createBounds();
    const outputBounds = {
        left: -47,
        top: 32,
        right: 361,
        bottom: 450,
        width: 408,
        height: 418
    };
    const sourceBefore = createLayerState();
    const sourceAfter = createLayerState({ visible: false });
    const outputAfter = createLayerState({
        layerId: 901,
        layerName: '姿态统一｜浅咖',
        visible: true,
        bounds: outputBounds
    });
    const base = {
        beforeDocumentId: 42,
        afterDocumentId: 42,
        beforeLayerIds: [3, 9],
        afterLayerIds: [3, 9, 901],
        sourceBefore,
        sourceAfter,
        outputAfter,
        outputLayerId: 901,
        resultLayerName: '姿态统一｜浅咖',
        outputBounds
    };
    assert.equal(validation.verifyPoseAlignmentAppliedState(base).verified, true);
    assert.equal(validation.verifyPoseAlignmentAppliedState({
        ...base,
        outputAfter: { ...outputAfter, bounds: { ...outputBounds, bottom: 430, height: 398 } }
    }).verified, false, 'cropped output must not pass geometry readback');
    assert.equal(validation.verifyPoseAlignmentAppliedState({
        ...base,
        sourceAfter: { ...sourceAfter, visible: true }
    }).verified, false, 'visible original must not pass the non-destructive delivery state');
    assert.equal(validation.verifyPoseAlignmentAppliedState({
        ...base,
        afterLayerIds: [3, 9, 901, 902]
    }).verified, false, 'more than one new layer must not pass the single-write result');
    assert.equal(validation.verifyPoseAlignmentAppliedState({
        ...base,
        outputAfter: { ...outputAfter, parentId: 4 }
    }).verified, false, 'output in a different group must not pass sibling readback');

    const rollbackBase = {
        beforeDocumentId: 42,
        afterDocumentId: 42,
        beforeLayerIds: [3, 9],
        afterLayerIds: [3, 9],
        sourceBefore,
        sourceAfter: createLayerState(),
        outputAfter: undefined
    };
    assert.equal(validation.verifyPoseAlignmentRolledBackState(rollbackBase).verified, true);
    assert.equal(validation.verifyPoseAlignmentRolledBackState({
        ...rollbackBase,
        afterLayerIds: [3, 9, 901],
        outputAfter
    }).verified, false, 'rollback with residual output must fail verification');
}

function assertUniqueTransactionOwnership() {
    const applyPath = path.join(uxpRoot, 'src/tools/sku/apply-pose-alignment.ts');
    const capturePath = path.join(uxpRoot, 'src/tools/image/capture-layer-pixels.ts');
    const exportLayerPath = path.join(uxpRoot, 'src/tools/image/export-layer.ts');
    const registryPath = path.join(uxpRoot, 'src/tools/registry.ts');
    const indexPath = path.join(uxpRoot, 'src/index.ts');
    const agentAuditPath = path.join(agentRoot, 'scripts/audit-tool-registry.cjs');
    const agentHandlerPath = path.join(
        agentRoot,
        'src/main/uxp-handlers/sku-pose-alignment-handlers.ts'
    );
    const applySource = fs.readFileSync(applyPath, 'utf8');
    const captureSource = fs.readFileSync(capturePath, 'utf8');
    const exportLayerSource = fs.readFileSync(exportLayerPath, 'utf8');
    const registrySource = fs.readFileSync(registryPath, 'utf8');
    const indexSource = fs.readFileSync(indexPath, 'utf8');
    const agentAuditSource = fs.readFileSync(agentAuditPath, 'utf8');
    const agentHandlerSource = fs.readFileSync(agentHandlerPath, 'utf8');
    assert.match(applySource, /photoshopTransactionRunner\.run/);
    assert.match(applySource, /historyMode:\s*'suspend'/);
    assert.match(applySource, /requiredBinding:\s*'document_revision'/);
    assert.match(
        applySource,
        /rollbackTargetPolicy:\s*'document_revision_and_active_layer'/
    );
    assert.doesNotMatch(applySource, /\b(?:core\.)?executeAsModal\s*\(/);
    assert.doesNotMatch(applySource, /hostControl\.(?:suspendHistory|resumeHistory)/);
    assert.equal(
        (applySource.match(/_obj:\s*'placeEvent'/g) || []).length,
        1,
        'pose apply must have exactly one placement mutation path'
    );
    assert.match(applySource, /verifyPoseAlignmentAppliedState/);
    assert.match(applySource, /verifyPoseAlignmentRolledBackState/);
    assert.match(applySource, /SKU_POSE_ALIGNMENT_PROVIDER_RECEIPT_VERSION/);
    assert.match(registrySource, /new ApplySkuPoseAlignmentTool\(\)/);
    assert.match(captureSource, /mode:\s*'pixels-rgba'/);
    assert.match(captureSource, /BinaryMessageType\.RAW_RGBA/);
    assert.match(captureSource, /sameHistoryStateRef\(before, after\)/);
    assert.doesNotMatch(captureSource, /native-png|runJsxCode|\.duplicate\(/);
    assert.match(exportLayerSource, /exportUsingSmallDocPNG\(doc\.id, layerId, maxSize\)/);
    assert.doesNotMatch(exportLayerSource, /sourceDoc\.duplicate\(/);
    assert.match(registrySource, /new CaptureLayerPixelsTool\(\)/);
    assert.match(indexSource, /captureLayerPixelsTool\.setWebSocketClient\(wsClient\)/);
    assert.match(agentHandlerSource, /sendRequest\('captureLayerPixels'/);
    assert.match(agentHandlerSource, /waitForBinaryData\(binaryRequestId/);
    assert.doesNotMatch(agentHandlerSource, /native-png|exportLayerAsBase64/);
    assert.ok(
        agentAuditSource.includes("['applySkuPoseAlignment',")
            && agentAuditSource.includes('SKU Skill 内部版本化 Provider')
            && agentAuditSource.includes("['captureLayerPixels',")
            && agentAuditSource.includes('Provider 内部二进制像素捕获工具'),
        'specialized capture/apply tools must remain hidden from the generic Agent tool surface'
    );
}

async function main() {
    const { contract, validation } = loadContracts();
    const panelWorkflow = loadPanelWorkflow(contract);
    assertCrossRuntimeVersionBinding(contract);
    assertParameterAndPngContracts(contract, validation);
    assertReadbackVerification(validation);
    assertUniqueTransactionOwnership();
    await assertPanelBatchWorkflow(contract, panelWorkflow);
    assertPanelSurfaceMigration();
    console.log('✅ PASS │ UXP 姿态 Provider 与面板：跨端版本、逐层冻结、未知写停机、几何读回、回滚与唯一事务');
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
