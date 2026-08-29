/**
 * 选中态与文档名的纯函数测试。
 *
 * 这里存在的直接原因：documentDisplayName 曾被一次批量替换改成了 `return documentDisplayName(doc)`
 * ——函数体变成无条件自调用，任何一次调用都会抛栈溢出。它通过了 tsc（返回类型是显式标注的），
 * 也通过了当时的全部测试（没有一个用例碰过 index.ts 里的这个函数），最终会让
 * 图生图每次成功出图后在写候选缓存时崩掉，把已经计费的整批结果报成"生成失败"。
 * 类型检查挡不住这类形状的缺陷，只有真正调用它的用例能。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
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
        d => d.category === ts.DiagnosticCategory.Error
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

const {
    documentDisplayName,
    buildImageToImageSelectionPayload,
    buildImageToImageSelectionSignature,
    isSelectionOwnedByCandidateRun
} = loadTypeScriptModule('../src/core/image-to-image-selection.ts', 'image-to-image-selection');

let checks = 0;
const check = (name, fn) => { fn(); checks++; };

// ===== documentDisplayName =====
check('title wins over name', () => {
    assert.equal(documentDisplayName({ title: '主图A.psd', name: 'other' }), '主图A.psd');
});
check('falls back to name', () => {
    assert.equal(documentDisplayName({ name: '详情页B.psd' }), '详情页B.psd');
});
check('blank title falls through to name', () => {
    assert.equal(documentDisplayName({ title: '   ', name: 'B.psd' }), 'B.psd');
});
check('returns empty string when unreadable', () => {
    assert.equal(documentDisplayName(null), '');
    assert.equal(documentDisplayName(undefined), '');
    assert.equal(documentDisplayName({}), '');
});
check('never fabricates a name from non-string values', () => {
    // String(...) 写法会把这些转成 "[object Object]" / "123" 塞进用户提示里
    assert.equal(documentDisplayName({ title: {}, name: {} }), '');
    assert.equal(documentDisplayName({ title: 123, name: null }), '');
});
check('does not blow the stack (guards against self-recursive rewrites)', () => {
    // 这一条就是为那次无限递归写的：它必须能被调用 1000 次而不抛 RangeError
    for (let i = 0; i < 1000; i++) {
        documentDisplayName({ title: 'A' + i });
    }
    assert.doesNotThrow(() => documentDisplayName({ name: 'x' }));
});

// ===== signature 必须含文档 =====
const basePayload = {
    documentName: 'A.psd', documentId: 1, width: 100, height: 100,
    selectionState: 'single', hasSelectedLayer: true,
    selectedLayerId: 2, selectedLayerName: '图层 1',
    selectedLayerWidth: 10, selectedLayerHeight: 10
};

check('signature changes when the document changes', () => {
    // 图层 id 在不同文档里各自编号，撞号是常态。签名漏掉文档时，
    // "在 A 选中图层 2"与"切到 B 也选中图层 2"会算出同一个指纹，
    // 轮询判定无变化直接返回，面板永远不知道用户换了文档。
    const inA = buildImageToImageSelectionSignature(basePayload);
    const inB = buildImageToImageSelectionSignature({ ...basePayload, documentId: 2, documentName: 'B.psd' });
    assert.notEqual(inA, inB, '换文档必须产生不同的签名');
});

check('signature changes when the document is renamed', () => {
    const before = buildImageToImageSelectionSignature(basePayload);
    const after = buildImageToImageSelectionSignature({ ...basePayload, documentName: '另存为.psd' });
    assert.notEqual(before, after);
});

check('signature is stable for identical state', () => {
    assert.equal(
        buildImageToImageSelectionSignature(basePayload),
        buildImageToImageSelectionSignature({ ...basePayload })
    );
});

// ===== payload =====
check('payload keeps documentId and falls back on empty name', () => {
    const p = buildImageToImageSelectionPayload({ id: 7, title: '', name: '', activeLayers: [] });
    assert.equal(p.documentId, 7);
    assert.equal(p.documentName, '当前文档', '读不到名字时面板仍要有话可说');
});

// ===== 跨文档归属判断 =====
check('selection in another document never counts as this run', () => {
    const owned = isSelectionOwnedByCandidateRun(
        { documentId: 2, selectedLayerId: 5 },
        { sourceDocumentId: 1, sourceLayerId: 5, appliedLayerId: null }
    );
    assert.equal(owned, false, '图层号撞上了也不能算同一批——文档不同');
});

check('unknown document id does not destroy candidates', () => {
    // 读不到 id 是"不知道"，把不知道当成"不属于本批"会触发清空候选的破坏性行为，
    // 而候选是按次计费买来的
    const owned = isSelectionOwnedByCandidateRun(
        { documentId: null, selectedLayerId: 5 },
        { sourceDocumentId: 1, sourceLayerId: 5, appliedLayerId: null }
    );
    assert.equal(owned, true);
});

console.log(`image-to-image-selection: ${checks} cases passed`);
