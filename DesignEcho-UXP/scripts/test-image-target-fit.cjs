const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadTypeScriptModule(relativePath, moduleName) {
    const sourcePath = path.resolve(__dirname, relativePath);
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
    wrapper(require, loadedModule, loadedModule.exports);
    return loadedModule.exports;
}

function loadImageTargetFitModule() {
    return loadTypeScriptModule('../src/core/image-target-fit.ts', 'image-target-fit.ts');
}

function assertPhotoshopDocumentEditStateContract() {
    const state = loadTypeScriptModule(
        '../src/core/photoshop-document-state.ts',
        'photoshop-document-state.ts'
    );
    assert.deepEqual(state.observePhotoshopDocumentEditState({ saved: true }), {
        editState: 'clean'
    });
    assert.deepEqual(state.observePhotoshopDocumentEditState({ saved: false }), {
        editState: 'dirty'
    });
    assert.equal(
        state.observePhotoshopDocumentEditState({}).editState,
        'unknown'
    );
    const inaccessible = {};
    Object.defineProperty(inaccessible, 'saved', {
        get() {
            throw new Error('saved unavailable');
        }
    });
    const inaccessibleState = state.observePhotoshopDocumentEditState(inaccessible);
    assert.equal(inaccessibleState.editState, 'unknown');
    assert.match(inaccessibleState.editStateReason, /saved unavailable/);
}

function assertMattingSourceExportGeometryContract() {
    const geometry = loadTypeScriptModule(
        '../src/core/matting-source-export-geometry.ts',
        'matting-source-export-geometry.ts'
    );
    assert.deepEqual(
        geometry.resolveLayerFullDocumentSourceBounds({
            layerBounds: { left: -100, top: 0, right: 900, bottom: 800 },
            documentWidth: 1000,
            documentHeight: 800
        }),
        { left: 0, top: 0, right: 900, bottom: 800 }
    );
    assert.deepEqual(
        geometry.resolveLayerFullDocumentSourceBounds({
            layerBounds: { left: 1, top: 1, right: 4672, bottom: 7007 },
            documentWidth: 4672,
            documentHeight: 7008
        }),
        { left: 1, top: 1, right: 4672, bottom: 7007 }
    );
    assert.throws(
        () => geometry.resolveLayerFullDocumentSourceBounds({
            layerBounds: { left: 2000, top: 0, right: 3000, bottom: 800 },
            documentWidth: 1000,
            documentHeight: 800
        }),
        /没有可见交集/
    );
}

function assertDetailPageSliceDeliveryContract() {
    const contract = loadTypeScriptModule(
        '../src/tools/layout/slice-export-contract.ts',
        'slice-export-contract.ts'
    );
    const screens = [
        { id: 101, name: '首屏', type: 'screen_hero', index: 0 },
        { id: 102, name: '卖点', type: 'screen_benefit', index: 1 }
    ];
    const digest = `skill-delivery-plan/v0:${'a'.repeat(64)}`;
    const valid = contract.buildSliceExportPlan(screens, {
        projectRoot: 'C:\\project',
        outputDir: 'C:\\project\\交付\\详情页切片',
        format: 'jpeg',
        quality: 12,
        conflictPolicy: 'fail_if_exists',
        deliveryPlanDigest: digest,
        expectedFiles: [
            { screenId: '101', path: 'C:\\project\\交付\\详情页切片\\01-首屏.jpg' },
            { screenId: '102', path: 'C:\\project\\交付\\详情页切片\\02-卖点.jpg' }
        ]
    });
    assert.equal(valid.status, 'ready');
    assert.equal(valid.config.conflictPolicy, 'fail_if_exists');
    assert.deepEqual(valid.files.map((file) => file.screenId), ['101', '102']);
    assert.deepEqual(valid.files.map((file) => file.path), [
        'C:\\project\\交付\\详情页切片\\01-首屏.jpg',
        'C:\\project\\交付\\详情页切片\\02-卖点.jpg'
    ]);

    const posixVersion = contract.buildSliceExportPlan(screens, {
        projectRoot: '/Volumes/Design Disk/Project',
        outputDir: '/Volumes/Design Disk/Project/Delivery/detail',
        format: 'png',
        conflictPolicy: 'new_version',
        deliveryPlanDigest: digest,
        expectedFiles: [
            { screenId: '101', path: '/Volumes/Design Disk/Project/Delivery/detail/v2-01.png' },
            { screenId: '102', path: '/Volumes/Design Disk/Project/Delivery/detail/v2-02.png' }
        ]
    });
    assert.equal(posixVersion.status, 'ready');
    assert.equal(posixVersion.config.conflictPolicy, 'new_version');

    const outsideProject = contract.buildSliceExportPlan(screens, {
        projectRoot: 'C:\\project',
        outputDir: 'D:\\outside',
        format: 'jpeg',
        conflictPolicy: 'fail_if_exists',
        deliveryPlanDigest: digest,
        expectedFiles: [
            { screenId: '101', path: 'D:\\outside\\01.jpg' },
            { screenId: '102', path: 'D:\\outside\\02.jpg' }
        ]
    });
    assert.equal(outsideProject.status, 'blocked');
    assert.ok(outsideProject.blockers.some((message) => message.includes('当前项目目录内')));

    for (const invalidConfig of [
        { namingPattern: '../{index}' },
        { namingPattern: '{screen}' },
        { createSubfolder: true, subfolder: '../切片' },
        { conflictPolicy: 'overwrite' }
    ]) {
        const invalid = contract.buildSliceExportPlan(screens, {
            projectRoot: 'C:\\project',
            outputDir: 'C:\\project\\详情页',
            format: 'jpeg',
            conflictPolicy: 'fail_if_exists',
            deliveryPlanDigest: digest,
            expectedFiles: [
                { screenId: '101', path: 'C:\\project\\详情页\\01.jpg' },
                { screenId: '102', path: 'C:\\project\\详情页\\02.jpg' }
            ],
            ...invalidConfig
        });
        assert.equal(invalid.status, 'blocked');
    }

    const duplicate = contract.buildSliceExportPlan(screens, {
        projectRoot: 'C:\\project',
        outputDir: 'C:\\project\\详情页',
        format: 'jpeg',
        conflictPolicy: 'fail_if_exists',
        deliveryPlanDigest: digest,
        expectedFiles: [
            { screenId: '101', path: 'C:\\project\\详情页\\same.jpg' },
            { screenId: '102', path: 'C:\\PROJECT\\详情页\\SAME.jpg' }
        ]
    });
    assert.equal(duplicate.status, 'blocked');
    assert.ok(duplicate.blockers.some((message) => message.includes('重复目标路径')));

    const wrongExtension = contract.buildSliceExportPlan(screens, {
        projectRoot: 'C:\\project',
        outputDir: 'C:\\project\\详情页',
        format: 'png',
        conflictPolicy: 'fail_if_exists',
        deliveryPlanDigest: digest,
        expectedFiles: [
            { screenId: '101', path: 'C:\\project\\详情页\\01.jpg' },
            { screenId: '102', path: 'C:\\project\\详情页\\02.png' }
        ]
    });
    assert.equal(wrongExtension.status, 'blocked');
    assert.ok(wrongExtension.blockers.some((message) => message.includes('扩展名')));

    const completeRollbackPlan = contract.buildSliceExportRollbackPlan({
        createdPaths: ['C:\\project\\详情页\\01.jpg', 'C:\\project\\详情页\\02.jpg'],
        preexistingPaths: [],
        deliverySucceeded: true,
        sourceStateRestored: true
    });
    assert.deepEqual(completeRollbackPlan, { rollbackPaths: [], blockers: [] });
    const partialRollbackPlan = contract.buildSliceExportRollbackPlan({
        createdPaths: [
            'C:\\project\\详情页\\01.jpg',
            'C:\\project\\详情页\\02.jpg',
            'C:\\project\\详情页\\old-sentinel.jpg'
        ],
        preexistingPaths: ['C:\\PROJECT\\详情页\\OLD-SENTINEL.jpg'],
        deliverySucceeded: false,
        sourceStateRestored: true
    });
    assert.deepEqual(partialRollbackPlan.rollbackPaths, [
        'C:\\project\\详情页\\01.jpg',
        'C:\\project\\详情页\\02.jpg'
    ]);
    assert.equal(
        partialRollbackPlan.rollbackPaths.includes('C:\\project\\详情页\\old-sentinel.jpg'),
        false,
        'pre-existing sentinel must never become a rollback deletion target'
    );
    assert.ok(partialRollbackPlan.blockers.some((message) => message.includes('运行前已存在')));
}

function assertRuntimeBuildIdentityContract() {
    const runtimeBuild = require('./runtime-build-identity.cjs');
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'designecho-uxp-build-'));
    const sourceRoot = path.join(testRoot, 'src');
    fs.mkdirSync(path.join(sourceRoot, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, 'entry.ts'), 'export const value = 1;\n', 'utf8');
    fs.writeFileSync(path.join(sourceRoot, 'nested', 'feature.ts'), 'export const enabled = true;\n', 'utf8');

    try {
        const firstDigest = runtimeBuild.calculateSourceDigest(sourceRoot);
        const repeatedDigest = runtimeBuild.calculateSourceDigest(sourceRoot);
        assert.match(firstDigest, /^sha256:[0-9a-f]{64}$/);
        assert.equal(repeatedDigest, firstDigest, 'unchanged UXP source must keep a stable digest');
        fs.appendFileSync(path.join(sourceRoot, 'entry.ts'), 'export const changed = true;\n', 'utf8');
        assert.notEqual(
            runtimeBuild.calculateSourceDigest(sourceRoot),
            firstDigest,
            'UXP source changes must change the source digest'
        );

        const gitCommit = '0123456789abcdef0123456789abcdef01234567';
        const identity = runtimeBuild.createRuntimeBuildIdentity({
            repoRoot: testRoot,
            uxpRoot: testRoot,
            buildMode: 'production',
            builtAt: '2026-08-27T00:00:00.000Z',
            gitIdentity: {
                gitCommit,
                gitDirty: true,
                dirtyScope: 'DesignEcho-UXP'
            }
        });
        assert.equal(identity.version, 'designecho-uxp-runtime-build/v1');
        assert.equal(identity.gitCommit, gitCommit);
        assert.equal(identity.gitDirty, true);
        assert.equal(identity.buildMode, 'production');
        assert.match(identity.buildId, /^designecho-uxp-production-[0-9a-f]{12}-[0-9a-f]{12}-dirty$/);
        const cleanIdentity = runtimeBuild.createRuntimeBuildIdentity({
            repoRoot: testRoot,
            uxpRoot: testRoot,
            buildMode: 'production',
            builtAt: '2026-08-27T00:00:00.000Z',
            gitIdentity: {
                gitCommit,
                gitDirty: false,
                dirtyScope: 'DesignEcho-UXP'
            }
        });
        assert.match(cleanIdentity.buildId, /^designecho-uxp-production-[0-9a-f]{12}-[0-9a-f]{12}$/);

        const runtimeAsset = Buffer.from('module.exports = "runtime";\n', 'utf8');
        const manifest = runtimeBuild.createRuntimeBuildManifest(identity, runtimeAsset);
        assert.equal(manifest.version, 'designecho-uxp-runtime-build-manifest/v1');
        assert.equal(manifest.buildId, identity.buildId);
        assert.equal(manifest.runtimeFile.ref, 'runtime.js');
        assert.equal(manifest.runtimeFile.size, runtimeAsset.length);
        assert.match(manifest.runtimeFile.digest, /^sha256:[0-9a-f]{64}$/);
        assert.match(manifest.manifestDigest, /^sha256:[0-9a-f]{64}$/);
        assert.equal(runtimeBuild.verifyRuntimeBuildManifest(manifest, runtimeAsset), true);
        assert.equal(
            runtimeBuild.verifyRuntimeBuildManifest(manifest, Buffer.from('tampered', 'utf8')),
            false,
            'runtime.js tampering must invalidate the UXP build manifest'
        );
        assert.equal(
            runtimeBuild.verifyRuntimeBuildManifest({
                ...manifest,
                sourceDigest: `sha256:${'0'.repeat(64)}`
            }, runtimeAsset),
            false,
            'manifest metadata tampering must invalidate the manifest digest'
        );

        globalThis.__DESIGNECHO_UXP_RUNTIME_BUILD__ = identity;
        const runtimeInfoModule = loadTypeScriptModule(
            '../src/core/runtime-build-info.ts',
            'runtime-build-info.ts'
        );
        const runtimeInfo = runtimeInfoModule.getPhotoshopRuntimeBuildInfo();
        assert.equal(runtimeInfo.buildId, identity.buildId);
        assert.equal(runtimeInfo.gitCommit, gitCommit);
        assert.equal(runtimeInfo.gitDirty, true);
        assert.equal(runtimeInfo.sourceDigest, identity.sourceDigest);
        assert.equal(runtimeInfo.builtAt, identity.builtAt);
        assert.match(runtimeInfo.loadedAt, /^\d{4}-\d{2}-\d{2}T/);
        assert.ok(runtimeInfo.features.includes('diagnoseState.runtimeInfo'));
    } finally {
        delete globalThis.__DESIGNECHO_UXP_RUNTIME_BUILD__;
        fs.rmSync(testRoot, { recursive: true, force: true });
    }

    const webpackSource = fs.readFileSync(
        path.resolve(__dirname, '../webpack.config.js'),
        'utf8'
    );
    assert.ok(
        webpackSource.includes('new webpack.DefinePlugin({')
            && webpackSource.includes('__DESIGNECHO_UXP_RUNTIME_BUILD__')
            && webpackSource.includes('new RuntimeBuildManifestPlugin(runtimeBuildIdentity)'),
        'webpack must embed the UXP identity and emit the runtime manifest in the same compilation'
    );

    const distRoot = path.resolve(__dirname, '../dist');
    const manifestPath = path.join(distRoot, 'runtime-build-manifest.json');
    const runtimePath = path.join(distRoot, 'runtime.js');
    if (fs.existsSync(manifestPath) && fs.existsSync(runtimePath)) {
        const generatedManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const generatedRuntime = fs.readFileSync(runtimePath);
        assert.equal(
            runtimeBuild.verifyRuntimeBuildManifest(generatedManifest, generatedRuntime),
            true,
            'generated runtime-build-manifest.json must verify the emitted runtime.js bytes'
        );
    }
}

function assertJpegQualityNormalizationContract() {
    const jpegQuality = loadTypeScriptModule(
        '../src/core/jpeg-quality.ts',
        'jpeg-quality.ts'
    );
    const normalize = jpegQuality.normalizePhotoshopJpegQuality;

    assert.equal(normalize(undefined), 12, 'saveDocument omission must default to native quality 12');
    assert.equal(normalize(1), 1, 'native minimum must remain native quality 1');
    assert.equal(normalize(6), 6, 'native quality must not be interpreted as a percentage');
    assert.equal(normalize(12), 12, 'native maximum must not collapse to quality 1');
    assert.equal(normalize(13), 2, '13 starts the percentage-style compatibility range');
    assert.equal(normalize(50), 6, 'percentage-style quality must map to the native scale');
    assert.equal(normalize(80, 80), 10, 'quickExport default 80 must retain native quality 10');
    assert.equal(normalize(85, 85), 10, 'batchExport default 85 must retain native quality 10');
    assert.equal(normalize(100), 12, 'percentage maximum must map to native quality 12');
    assert.equal(normalize(200), 12, 'out-of-range high values must be clamped safely');
    assert.equal(normalize(0), 1, 'out-of-range low values must be clamped safely');
    assert.equal(normalize(Number.NaN, 80), 10, 'invalid input must use the caller default semantics');
}

function assertExportGroupDeliveryContract() {
    const sourcePath = path.resolve(__dirname, '../src/tools/image/export-group.ts');
    const source = fs.readFileSync(sourcePath, 'utf8');
    assert.match(source, /type ExportGroupFormat = 'png' \| 'jpg'/);
    assert.match(source, /enum: \['png', 'jpg'\]/);
    assert.match(source, /conflictPolicy\?: ExportGroupConflictPolicy/);
    assert.match(source, /CONFLICT_POLICY === 'fail_if_exists' && targetFile\.exists/);
    assert.match(source, /var jpgOptions = new JPEGSaveOptions\(\)/);
    assert.match(source, /sourceHistoryStateRef = readActiveHistoryStateRef\(doc\)/);
    assert.match(source, /sameHistoryStateRef\(sourceHistoryStateRef, afterExportHistoryStateRef\)/);
    assert.doesNotMatch(source, /exportGroup 当前仅支持 png 格式/);
}

function assertRasterExportRevisionContract() {
    const jsxBridgePath = path.resolve(__dirname, '../src/core/jsx-bridge.ts');
    const saveDocumentPath = path.resolve(__dirname, '../src/tools/canvas/save-document.ts');
    const jsxBridgeSource = fs.readFileSync(jsxBridgePath, 'utf8');
    const saveDocumentSource = fs.readFileSync(saveDocumentPath, 'utf8');
    const freezeIndex = saveDocumentSource.indexOf(
        'const sourceHistoryStateRef = requireRasterExportSourceHistoryStateRef(doc);'
    );
    const dispatchIndex = saveDocumentSource.indexOf(
        'const jsxResult = await saveDocumentViaJsx(requestedPath',
        freezeIndex
    );
    const jsxGuardIndex = jsxBridgeSource.indexOf("throw new Error('JSX 保存前源文档已变化，未写入目标文件。')");
    const jsxSaveIndex = jsxBridgeSource.indexOf('saveDoc.saveAs(target, options, true, Extension.LOWERCASE)');

    assert.ok(freezeIndex >= 0 && freezeIndex < dispatchIndex,
        'UXP must freeze the source revision before dispatching the JSX file write');
    assert.ok(jsxGuardIndex >= 0 && jsxGuardIndex < jsxSaveIndex,
        'JSX must verify the selected source document before writing the target file');
    assert.ok(jsxBridgeSource.includes('expectedSourceDocumentId?: number')
        && jsxBridgeSource.includes("throw new Error('JSX 保存前源文档已变化，未写入目标文件。')")
        && !jsxBridgeSource.includes('sourceHistoryStateId'),
    'JSX must guard the source document without projecting its incompatible history identity as UXP evidence');
    assert.ok(saveDocumentSource.includes('requireRasterExportSourceHistoryStateRef(doc)')
        && saveDocumentSource.includes('verifyRasterExportSourceHistoryStateRef({')
        && saveDocumentSource.includes('emittedDocumentId: jsxResult.sourceDocumentId')
        && saveDocumentSource.includes('sameHistoryStateRef(input.expected, afterExportHistoryStateRef)')
        && saveDocumentSource.includes('导出完成后无法确认文件仍来自同一 Photoshop 文档版本'),
    'saveDocument and quickExport must return only a same-document JSX and UXP pre/post same-revision receipt');
}

function assertImageSourceIdentityContract() {
    const identity = loadTypeScriptModule(
        '../src/core/image-source-identity.ts',
        'image-source-identity.ts'
    );
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 250]);
    const checksum = identity.calculateImageSourceChecksum(bytes);
    assert.match(checksum, /^fnv1a32:[a-f0-9]{8}$/);
    assert.doesNotThrow(() => identity.assertImageSourceIdentity({
        bytes,
        expectedByteLength: bytes.length,
        expectedChecksum: checksum
    }));
    assert.throws(() => identity.assertImageSourceIdentity({
        bytes,
        expectedByteLength: bytes.length + 1,
        expectedChecksum: checksum
    }), /字节长度不一致/);
    assert.throws(() => identity.assertImageSourceIdentity({
        bytes,
        expectedByteLength: bytes.length,
        expectedChecksum: 'fnv1a32:deadbeef'
    }), /源图校验失败/);
    assert.throws(() => identity.assertImageSourceIdentity({
        bytes,
        expectedChecksum: 'sha256:abc'
    }), /格式不受支持/);

    const placeImagePath = path.resolve(__dirname, '../src/tools/image/place-image.ts');
    const placeImageSource = fs.readFileSync(placeImagePath, 'utf8');
    assert.ok(
        (placeImageSource.match(/assertImageSourceIdentity\s*\(\s*\{/g) || []).length >= 2,
        'filePath and imageData placement must both verify the actual source bytes'
    );
    assert.ok(
        placeImageSource.includes('仅提供 fileToken 时无法重新读取并核对源图字节身份'),
        'fileToken-only placement must fail closed when source identity was declared'
    );
    assert.ok(
        placeImageSource.includes("version: 'place-image-source-identity/v1'")
            && placeImageSource.includes('identityProof:')
            && placeImageSource.includes('sourceIdentityVerified ?'),
        'source identity proof must be emitted only after current UXP bytes were actually verified'
    );
}

function assertSkuPairedEditableDeliveryContract() {
    const skuLayoutPath = path.resolve(__dirname, '../src/tools/layout/sku-layout-tool.ts');
    const saveDocumentPath = path.resolve(__dirname, '../src/tools/canvas/save-document.ts');
    const skuLayoutSource = fs.readFileSync(skuLayoutPath, 'utf8');
    const saveDocumentSource = fs.readFileSync(saveDocumentPath, 'utf8');
    const noteQaIndex = skuLayoutSource.indexOf('const allNoteQaReady =');
    const noteEditableSaveIndex = skuLayoutSource.indexOf(
        'saveEditableDocumentSnapshotInModal({',
        noteQaIndex
    );
    const noteCloseIndex = skuLayoutSource.indexOf(
        "commandName: '关闭自选备注模板文档'",
        noteEditableSaveIndex
    );
    const comboQaIndex = skuLayoutSource.lastIndexOf('最终实时边界 QA 未达到 ready');
    const comboEditableSaveIndex = skuLayoutSource.indexOf(
        'saveEditableDocumentSnapshotInModal({',
        comboQaIndex
    );
    const comboCleanupIndex = skuLayoutSource.indexOf(
        'await deleteCopiedSkuLayers(',
        comboEditableSaveIndex
    );
    assert.ok(noteQaIndex >= 0 && noteQaIndex < noteEditableSaveIndex && noteEditableSaveIndex < noteCloseIndex,
        'note PSB must be saved after live QA and before document close');
    assert.ok(comboQaIndex >= 0 && comboQaIndex < comboEditableSaveIndex && comboEditableSaveIndex < comboCleanupIndex,
        'combo PSB must be saved after live QA and before copied-layer cleanup');
    assert.ok(skuLayoutSource.includes("version: 'sku-layout-delivery-plan/v1'")
        && skuLayoutSource.includes("schema: 'sku-editable-structure-readback/v1'")
        && skuLayoutSource.includes("autoLayoutQaStatus: 'ready'")
        && skuLayoutSource.includes(".psb`"),
    'SKU paired delivery must carry frozen item identity, structure readback, ready QA and PSB paths');
    assert.ok(saveDocumentSource.includes('const sourceHistoryStateRef = readActiveHistoryStateRef(input.document)')
        && saveDocumentSource.includes('await batchPlaySave(getSaveDescriptor(format)')
        && saveDocumentSource.includes('readEditableDocumentArtifactProof('),
    'editable snapshot must bind pre-save Photoshop history and post-save file metadata');
    assert.ok(saveDocumentSource.includes('params.asCopy === true')
        && saveDocumentSource.includes('const saveAsCapability = (modalDocument as any)?.saveAs')
        && saveDocumentSource.includes("typeof saveAsCapability?.psd !== 'function'")
        && saveDocumentSource.includes("typeof saveAsCapability?.psb !== 'function'")
        && saveDocumentSource.includes('await saveAsCapability.psd(targetEntry, saveOptions, true)')
        && saveDocumentSource.includes('await saveAsCapability.psb(targetEntry, saveOptions, true)'),
    'runtime staging must save PSD/PSB as a copy without rebinding the active document path');
}

function closeTo(actual, expected, tolerance = 0.001) {
    assert.ok(
        Math.abs(actual - expected) <= tolerance,
        `expected ${actual} to be within ${tolerance} of ${expected}`
    );
}

function assertTransformTargetBoundsTransactionContract() {
    const transformPath = path.resolve(
        __dirname,
        '../src/tools/layer/transform-layer.ts'
    );
    const runnerPath = path.resolve(
        __dirname,
        '../src/core/photoshop-transaction-runner.ts'
    );
    const transformSource = fs.readFileSync(transformPath, 'utf8');
    const runnerSource = fs.readFileSync(runnerPath, 'utf8');
    const ownerStart = transformSource.indexOf('private async executeTargetBoundsTransaction');
    const ownerEnd = transformSource.indexOf('private buildTargetBoundsSuccessResult', ownerStart);
    assert.ok(ownerStart >= 0 && ownerEnd > ownerStart, 'targetBounds transaction owner must exist');
    const owner = transformSource.slice(ownerStart, ownerEnd);
    const fitStart = transformSource.indexOf('async function fitLayerToTargetBounds');
    const fitEnd = transformSource.indexOf('async function selectTransformTargetLayer', fitStart);
    assert.ok(fitStart >= 0 && fitEnd > fitStart, 'targetBounds mutation helper must exist');
    const fitOwner = transformSource.slice(fitStart, fitEnd);

    assert.ok(
        owner.includes('photoshopTransactionRunner.run<'),
        'targetBounds mutations must use the canonical Photoshop transaction runner'
    );
    assert.ok(
        owner.includes("historyMode: 'suspend'")
            && owner.includes("rollbackTargetPolicy: 'document_revision'"),
        'targetBounds transaction must suspend history and declare a rollback target'
    );
    assert.ok(
        owner.includes('placement?.geometryVerification.verified === true'),
        'geometry verification false must fail transaction verification'
    );
    assert.ok(
        owner.includes('verifyRolledBack')
            && owner.includes('sameTransformLayerBounds(before.bounds, after.bounds)'),
        'rollback must read back and verify the pre-write layer bounds'
    );
    assert.ok(
        owner.includes('await fitLayerToTargetBounds(')
            && !owner.includes('core.executeAsModal'),
        'scale and translate must execute inside the transaction callback, not a second modal owner'
    );
    assert.ok(
        fitOwner.includes('await transformLayerPercent(')
            && fitOwner.includes('await translateLayerWithoutNativeMove(')
            && !fitOwner.includes('try {'),
        'a scale-then-translate failure must propagate to the transaction runner without being swallowed'
    );
    const mutationFailureStart = runnerSource.indexOf(
        'if (mutationError || mutationResult?.success === false)'
    );
    const mutationFailureEnd = runnerSource.indexOf(
        'const settledMutationResult',
        mutationFailureStart
    );
    const mutationFailureOwner = runnerSource.slice(
        mutationFailureStart,
        mutationFailureEnd
    );
    const verificationFailureStart = runnerSource.indexOf(
        'if (verificationError || !verification.verified)'
    );
    const verificationFailureEnd = runnerSource.indexOf(
        'if (isPhotoshopTransactionCancellationRequested',
        verificationFailureStart
    );
    const verificationFailureOwner = runnerSource.slice(
        verificationFailureStart,
        verificationFailureEnd
    );
    assert.ok(
        mutationFailureOwner.includes('if (historySuspension)')
            && mutationFailureOwner.includes('return await this.rollbackFailure({')
            && verificationFailureOwner.includes('if (historySuspension)')
            && verificationFailureOwner.includes('return await this.rollbackFailure({'),
        'canonical runner must retain rollback paths for mutation exceptions and verification failure'
    );
}

function sliceAgentToolSchema(source, toolName, nextToolName) {
    const start = source.indexOf(`name: '${toolName}'`);
    const end = source.indexOf(`name: '${nextToolName}'`, start + 1);
    assert.ok(start >= 0 && end > start, `${toolName} Agent schema must exist`);
    return source.slice(start, end);
}

function assertImagePlacementParameterConflictContracts() {
    const placeImagePath = path.resolve(
        __dirname,
        '../src/tools/image/place-image.ts'
    );
    const transformLayerPath = path.resolve(
        __dirname,
        '../src/tools/layer/transform-layer.ts'
    );
    const agentToolSchemasPath = path.resolve(
        __dirname,
        '../../DesignEcho-Agent/src/renderer/services/agent-runtime/tool-schemas.ts'
    );
    const skuColorCardExecutorPath = path.resolve(
        __dirname,
        '../../DesignEcho-Agent/src/renderer/services/skill-executors/sku-color-card.executor.ts'
    );
    const placeImageSource = fs.readFileSync(placeImagePath, 'utf8');
    const transformLayerSource = fs.readFileSync(transformLayerPath, 'utf8');
    const agentToolSchemasSource = fs.readFileSync(agentToolSchemasPath, 'utf8');
    const skuColorCardExecutorSource = fs.readFileSync(skuColorCardExecutorPath, 'utf8');
    const transformSchema = sliceAgentToolSchema(
        agentToolSchemasSource,
        'transformLayer',
        'quickScale'
    );
    const placeImageSchema = sliceAgentToolSchema(
        agentToolSchemasSource,
        'placeImage',
        'replaceLayerContent'
    );

    assert.ok(
        placeImageSource.includes('collectTargetBoundsConflictingParameters(params)')
            && placeImageSource.includes("'scale',")
            && placeImageSource.includes("'fitToCanvas',")
            && placeImageSource.includes("'x',")
            && placeImageSource.includes("'y',")
            && placeImageSource.includes("'center',")
            && placeImageSource.includes("'allowUpscale'")
            && placeImageSource.includes('已拒绝静默忽略冲突参数'),
        'placeImage execution must fail closed instead of ignoring targetBounds conflicts'
    );
    for (const [toolName, source] of [
        ['placeImage', placeImageSource],
        ['transformLayer', transformLayerSource]
    ]) {
        assert.ok(
            source.includes("=== undefined ? 'targetFit' : ''")
                && source.includes("=== undefined ? 'targetAnchor' : ''")
                && source.includes('targetBounds 需要同时显式提供 targetFit 与 targetAnchor')
                && source.includes('已拒绝由执行器默认决定适配或锚点'),
            `${toolName} UXP execution must require explicit targetFit and targetAnchor with targetBounds`
        );
        assert.ok(
            source.includes('targetFit、targetAnchor 与 focalPoint 只在提供有效 targetBounds 时生效'),
            `${toolName} UXP execution must reject target fit controls without targetBounds`
        );
    }
    assert.ok(
        transformLayerSource.includes('fitToCanvas 需要显式 fitPercentage')
            && transformLayerSource.includes('focalPoint 不能与同一次 rotate/flip 混用'),
        'transformLayer UXP execution must preserve fitPercentage and focal-point conflict checks'
    );
    assert.ok(
        skuColorCardExecutorSource.includes('targetAnchor: plan.imagePlacement.anchor')
            && !/targetFit:\s*'contain',\s*layerOrder:/.test(skuColorCardExecutorSource),
        'SKU internal placeImage calls must forward the Agent-authored anchor instead of relying on UXP center'
    );
    assert.ok(
        !placeImageSource.includes('focalPoint 存在时只保留为请求事实，不参与落位')
            && placeImageSource.includes('focalPoint 存在时优先由 focalPoint 控制落位'),
        'placeImage source comments must describe the real focal-point geometry'
    );
    for (const field of ['scale', 'fitToCanvas', 'x', 'y', 'center', 'allowUpscale']) {
        assert.ok(
            placeImageSchema.includes(`{ required: ['${field}'] }`),
            `placeImage Agent schema must reject targetBounds with ${field}`
        );
    }
    for (const field of ['scaleUniform', 'scaleX', 'scaleY', 'fitPercentage']) {
        assert.ok(
            transformSchema.includes(`{ required: ['${field}'] }`),
            `transformLayer Agent schema must reject targetBounds with ${field}`
        );
    }
    assert.ok(
        transformSchema.includes("required: ['fitToCanvas']")
            && transformSchema.includes('properties: { fitToCanvas: { enum: [true] } }')
            && transformSchema.includes("then: { required: ['fitPercentage'] }")
            && transformSchema.includes("if: { required: ['focalPoint'] }")
            && transformSchema.includes("required: ['rotate']")
            && transformSchema.includes('properties: { rotate: { not: { enum: [0] } } }')
            && transformSchema.includes("required: ['flipHorizontal']")
            && transformSchema.includes("required: ['flipVertical']"),
        'transformLayer Agent schema must mirror UXP targetBounds and focal-point conflicts'
    );
    for (const [toolName, schema] of [
        ['placeImage', placeImageSchema],
        ['transformLayer', transformSchema]
    ]) {
        const reverseDependency = schema.indexOf("{ required: ['targetFit'] }");
        const requiredTargetBounds = schema.indexOf("then: { required: ['targetBounds'] }", reverseDependency);
        assert.ok(
            reverseDependency >= 0
                && schema.includes("{ required: ['targetAnchor'] }")
                && schema.includes("{ required: ['focalPoint'] }")
                && requiredTargetBounds > reverseDependency,
            `${toolName} Agent schema must require targetBounds for fit, anchor, or focalPoint`
        );
    }
    assert.ok(
        placeImageSchema.includes('contain 完整保留；cover 铺满并可能超出；fill 拉伸。'),
        'placeImage must retain the minimal semantic difference between fit modes'
    );
}

const geometry = loadImageTargetFitModule();
const target = { left: 0, top: 0, width: 750, height: 426 };
const portrait = { left: 100, top: 50, width: 4672, height: 6453 };

assert.deepEqual(
    geometry.normalizeImageTargetBounds({ x: '12', y: 20, right: 112, bottom: 220 }),
    { left: 12, top: 20, width: 100, height: 200 }
);
assert.equal(
    geometry.normalizeImageTargetBounds({ x: 0, y: 0, width: 0, height: 100 }),
    null
);
assert.equal(
    geometry.normalizeImageTargetBounds({ x: false, y: 0, width: 10, height: 10 }),
    null
);

const containPlan = geometry.resolveImageTargetFitPlan({
    sourceBounds: portrait,
    targetBounds: target,
    fit: 'contain',
    targetAnchor: 'center'
});
closeTo(containPlan.expectedBounds.height, 426);
closeTo(containPlan.expectedBounds.width, 308.4258484425848);
closeTo(containPlan.expectedBounds.left, 220.7870757787076);
closeTo(containPlan.expectedBounds.top, 0);
assert.equal(containPlan.effectiveAlignment, 'anchor');
const containOutcome = geometry.measureImageTargetFitOutcome(
    containPlan,
    containPlan.expectedBounds
);
closeTo(containOutcome.insideTargetRatio, 1);
closeTo(containOutcome.outsideTargetFraction, 0);
assert.deepEqual(containOutcome.outsideTargetEdges, []);
assert.deepEqual(containOutcome.geometryVerification, { verified: true, issues: [] });

const coverPlan = geometry.resolveImageTargetFitPlan({
    sourceBounds: portrait,
    targetBounds: target,
    fit: 'cover',
    targetAnchor: 'center'
});
closeTo(coverPlan.expectedBounds.width, 750);
closeTo(coverPlan.expectedBounds.height, 1035.9053938356165);
closeTo(coverPlan.expectedBounds.left, 0);
closeTo(coverPlan.expectedBounds.top, -304.9526969178082);
const coverOutcome = geometry.measureImageTargetFitOutcome(
    coverPlan,
    coverPlan.expectedBounds
);
closeTo(coverOutcome.targetCoverageRatio, 1);
closeTo(coverOutcome.insideTargetRatio, 0.41123446459011315);
closeTo(coverOutcome.outsideTargetFraction, 0.5887655354098869);
assert.deepEqual(coverOutcome.outsideTargetEdges, ['top', 'bottom']);
assert.equal('croppedFraction' in coverOutcome, false);
assert.equal('clippedEdges' in coverOutcome, false);
assert.deepEqual(coverOutcome.geometryVerification, { verified: true, issues: [] });

const shiftedCoverOutcome = geometry.measureImageTargetFitOutcome(
    coverPlan,
    { ...coverPlan.expectedBounds, left: 20 }
);
assert.equal(shiftedCoverOutcome.geometryVerification.verified, false);
assert.ok(shiftedCoverOutcome.geometryVerification.issues.includes('position_mismatch'));

const topPlan = geometry.resolveImageTargetFitPlan({
    sourceBounds: portrait,
    targetBounds: target,
    fit: 'cover',
    targetAnchor: 'top-center'
});
closeTo(topPlan.expectedBounds.top, 0);
assert.deepEqual(
    geometry.measureImageTargetFitOutcome(topPlan, topPlan.expectedBounds).outsideTargetEdges,
    ['bottom']
);

const bottomPlan = geometry.resolveImageTargetFitPlan({
    sourceBounds: portrait,
    targetBounds: target,
    fit: 'cover',
    targetAnchor: 'bottom-center'
});
closeTo(bottomPlan.expectedBounds.top, target.height - bottomPlan.expectedBounds.height);

const rightPlan = geometry.resolveImageTargetFitPlan({
    sourceBounds: { left: 0, top: 0, width: 200, height: 100 },
    targetBounds: { left: 0, top: 0, width: 100, height: 100 },
    fit: 'cover',
    targetAnchor: 'right-center'
});
closeTo(rightPlan.expectedBounds.left, -100);
assert.deepEqual(
    geometry.measureImageTargetFitOutcome(rightPlan, rightPlan.expectedBounds).outsideTargetEdges,
    ['left']
);

const leftPlan = geometry.resolveImageTargetFitPlan({
    sourceBounds: { left: 0, top: 0, width: 200, height: 100 },
    targetBounds: { left: 0, top: 0, width: 100, height: 100 },
    fit: 'cover',
    targetAnchor: 'left-center'
});
closeTo(leftPlan.expectedBounds.left, 0);
assert.deepEqual(
    geometry.measureImageTargetFitOutcome(leftPlan, leftPlan.expectedBounds).outsideTargetEdges,
    ['right']
);

const focalPlan = geometry.resolveImageTargetFitPlan({
    sourceBounds: { left: 0, top: 0, width: 100, height: 200 },
    targetBounds: { left: 0, top: 0, width: 100, height: 100 },
    fit: 'cover',
    targetAnchor: 'bottom-center',
    focalPoint: { x: 0.5, y: 0.25 }
});
assert.equal(focalPlan.effectiveAlignment, 'focal-point');
assert.equal(focalPlan.focalPointApplied, true);
assert.equal(focalPlan.focalPointClamped, false);
closeTo(focalPlan.expectedBounds.top, 0);
const focalOutcome = geometry.measureImageTargetFitOutcome(
    focalPlan,
    focalPlan.expectedBounds
);
assert.deepEqual(focalOutcome.actualFocalPosition, { x: 50, y: 50 });
assert.deepEqual(focalOutcome.targetFocalPosition, { x: 50, y: 50 });
closeTo(focalOutcome.focalDeviationPx, 0);

const clampedFocalPlan = geometry.resolveImageTargetFitPlan({
    sourceBounds: { left: 0, top: 0, width: 100, height: 200 },
    targetBounds: { left: 0, top: 0, width: 100, height: 100 },
    fit: 'cover',
    focalPoint: { x: 0.5, y: 0 }
});
closeTo(clampedFocalPlan.expectedBounds.top, 0);
assert.equal(clampedFocalPlan.focalPointApplied, true);
assert.equal(clampedFocalPlan.focalPointClamped, true);
const clampedFocalOutcome = geometry.measureImageTargetFitOutcome(
    clampedFocalPlan,
    clampedFocalPlan.expectedBounds
);
assert.deepEqual(clampedFocalOutcome.actualFocalPosition, { x: 50, y: 0 });
assert.deepEqual(clampedFocalOutcome.targetFocalPosition, { x: 50, y: 50 });
closeTo(clampedFocalOutcome.focalDeviationPx, 50);
assert.equal(clampedFocalOutcome.geometryVerification.verified, true);
assert.deepEqual(clampedFocalOutcome.geometryVerification.issues, []);

const leftContainPlan = geometry.resolveImageTargetFitPlan({
    sourceBounds: { left: 0, top: 0, width: 100, height: 50 },
    targetBounds: { left: 10, top: 20, width: 300, height: 300 },
    fit: 'contain',
    targetAnchor: 'left-center'
});
assert.deepEqual(leftContainPlan.expectedBounds, {
    left: 10,
    top: 95,
    width: 300,
    height: 150
});

const fillPlan = geometry.resolveImageTargetFitPlan({
    sourceBounds: { left: 20, top: 30, width: 100, height: 50 },
    targetBounds: { left: 10, top: 15, width: 300, height: 200 },
    fit: 'fill'
});
assert.equal(fillPlan.effectiveAlignment, 'fill-exact');
assert.equal(fillPlan.focalPointApplied, false);
assert.deepEqual(fillPlan.expectedBounds, {
    left: 10,
    top: 15,
    width: 300,
    height: 200
});

assert.throws(
    () => geometry.resolveImageTargetFitPlan({
        sourceBounds: portrait,
        targetBounds: target,
        fit: 'stretch'
    }),
    /targetFit 不支持/
);
assert.throws(
    () => geometry.resolveImageTargetFitPlan({
        sourceBounds: portrait,
        targetBounds: target,
        targetAnchor: 'top-left'
    }),
    /targetAnchor 不支持/
);
assert.throws(
    () => geometry.resolveImageTargetFitPlan({
        sourceBounds: portrait,
        targetBounds: target,
        focalPoint: { x: 1.2, y: 0.5 }
    }),
    /focalPoint\.x\/y/
);
assert.throws(
    () => geometry.resolveImageTargetFitPlan({
        sourceBounds: portrait,
        targetBounds: target,
        focalPoint: { x: '0.5', y: 0.5 }
    }),
    /focalPoint\.x\/y/
);
assert.throws(
    () => geometry.resolveImageTargetFitPlan({
        sourceBounds: portrait,
        targetBounds: target,
        fit: 'fill',
        focalPoint: { x: 0.5, y: 0.5 }
    }),
    /不能同时使用 focalPoint/
);

assertTransformTargetBoundsTransactionContract();
assertImagePlacementParameterConflictContracts();
assertMattingSourceExportGeometryContract();
assertJpegQualityNormalizationContract();
assertExportGroupDeliveryContract();
assertRasterExportRevisionContract();
assertDetailPageSliceDeliveryContract();
assertImageSourceIdentityContract();
assertSkuPairedEditableDeliveryContract();
assertRuntimeBuildIdentityContract();
assertPhotoshopDocumentEditStateContract();

console.log('image-target-fit: 17 geometry cases, matting source geometry, Photoshop document edit state, runtime build identity, source identity, paired SKU editable delivery, revision-bound raster export, export-group and detail-page slice delivery, parameter conflicts, JPEG quality, and transaction audit passed');
