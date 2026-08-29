/**
 * 跨文档置入的落位几何测试。
 *
 * 这段逻辑决定"结果贴到别的文档时落在哪、占多大"，错了就是不可逆的写入错误，
 * 而它在真机上很难复现（要开两个尺寸不同的文档来回切），所以用纯函数测试兜住。
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

const {
    resolveCrossDocumentPlacement,
    buildCrossDocumentPlacementNotice
} = loadTypeScriptModule('../src/core/cross-document-placement.ts', 'cross-document-placement');

let checks = 0;
const check = (name, fn) => { fn(); checks++; };

// 多数用例针对可缩放路径（placeEvent）；不可缩放路径（putPixels）在文件末尾单独覆盖
const scalable = (input) => resolveCrossDocumentPlacement({ ...input, canScale: true });

// —— 放得下：保持原始像素，只居中 ——
check('fits inside canvas: centered, not scaled', () => {
    const p = scalable({
        imageWidth: 800, imageHeight: 600, docWidth: 2000, docHeight: 1500
    });
    assert.equal(p.scaled, false);
    assert.equal(p.placementWidth, 800);
    assert.equal(p.placementHeight, 600);
    assert.deepEqual(p.targetBounds, { left: 600, top: 450 });
});

// —— 正好等于画布：不缩放，落在原点 ——
check('exact canvas size: no scale, origin', () => {
    const p = scalable({
        imageWidth: 1000, imageHeight: 1000, docWidth: 1000, docHeight: 1000
    });
    assert.equal(p.scaled, false);
    assert.deepEqual(p.targetBounds, { left: 0, top: 0 });
});

// —— 放不下：等比缩到 fit，且不会溢出画布 ——
check('larger than canvas: scaled to fit, stays in bounds', () => {
    const p = scalable({
        imageWidth: 3000, imageHeight: 3000, docWidth: 800, docHeight: 600
    });
    assert.equal(p.scaled, true);
    // 短边约束：600/3000 = 0.2
    assert.equal(p.placementWidth, 600);
    assert.equal(p.placementHeight, 600);
    assert.deepEqual(p.targetBounds, { left: 100, top: 0 });
    assert.ok(p.targetBounds.left >= 0 && p.targetBounds.top >= 0);
    assert.ok(p.targetBounds.left + p.placementWidth <= 800);
    assert.ok(p.targetBounds.top + p.placementHeight <= 600);
});

// —— 极端长条图：等比不失真，仍在画布内 ——
check('extreme aspect ratio: keeps ratio, stays in bounds', () => {
    const p = scalable({
        imageWidth: 4000, imageHeight: 500, docWidth: 1000, docHeight: 1000
    });
    assert.equal(p.scaled, true);
    assert.equal(p.placementWidth, 1000);
    assert.equal(p.placementHeight, 125); // 500 * 0.25，比例保持
    assert.ok(p.targetBounds.top + p.placementHeight <= 1000);
    const srcRatio = 4000 / 500;
    const outRatio = p.placementWidth / p.placementHeight;
    assert.ok(Math.abs(srcRatio - outRatio) < 0.05, '等比缩放不应改变宽高比');
});

// —— 比画布小很多：绝不放大 ——
check('tiny image: never upscaled', () => {
    const p = scalable({
        imageWidth: 10, imageHeight: 10, docWidth: 4000, docHeight: 4000
    });
    assert.equal(p.scaled, false);
    assert.equal(p.placementWidth, 10);
    assert.equal(p.placementHeight, 10);
});

// —— 读不到尺寸：返回 null，让调用方拒绝而不是瞎猜落点 ——
for (const bad of [
    { imageWidth: 0, imageHeight: 100, docWidth: 100, docHeight: 100 },
    { imageWidth: 100, imageHeight: 100, docWidth: 0, docHeight: 100 },
    { imageWidth: NaN, imageHeight: 100, docWidth: 100, docHeight: 100 },
    { imageWidth: 100, imageHeight: 100, docWidth: 100, docHeight: -5 },
    { imageWidth: undefined, imageHeight: 100, docWidth: 100, docHeight: 100 }
]) {
    check('invalid dimensions return null', () => {
        assert.equal(resolveCrossDocumentPlacement({ ...bad, canScale: true }), null);
    });
}

// —— 提示必须点名两个文档，并给出恢复出口 ——
check('notice names both documents and the way back', () => {
    const placement = scalable({
        imageWidth: 800, imageHeight: 600, docWidth: 2000, docHeight: 1500
    });
    const msg = buildCrossDocumentPlacementNotice({
        sourceDocumentName: '主图A.psd',
        activeDocumentName: '详情页B.psd',
        placement,
        resultLabel: 'AI 生图结果'
    });
    assert.ok(msg.includes('主图A.psd'), '必须点名来源文档');
    assert.ok(msg.includes('详情页B.psd'), '必须点名当前文档');
    assert.ok(msg.includes('居中'), '必须说明落位方式');
    assert.ok(!msg.includes('undefined'));
});

check('notice mentions scaling only when scaled', () => {
    const scaled = buildCrossDocumentPlacementNotice({
        sourceDocumentName: 'A', activeDocumentName: 'B', resultLabel: 'R',
        placement: scalable({
            imageWidth: 3000, imageHeight: 3000, docWidth: 800, docHeight: 600
        })
    });
    assert.ok(scaled.includes('等比缩小'), '缩过就要说');

    const notScaled = buildCrossDocumentPlacementNotice({
        sourceDocumentName: 'A', activeDocumentName: 'B', resultLabel: 'R',
        placement: scalable({
            imageWidth: 100, imageHeight: 100, docWidth: 800, docHeight: 600
        })
    });
    assert.ok(!notScaled.includes('等比缩小'), '没缩就不该说缩了');
});

// —— 文档名缺失时不能出现「「」」这种空书名号 ——
check('missing document names degrade gracefully', () => {
    const msg = buildCrossDocumentPlacementNotice({
        sourceDocumentName: '', activeDocumentName: '', resultLabel: 'AI 生图结果',
        placement: scalable({
            imageWidth: 100, imageHeight: 100, docWidth: 800, docHeight: 600
        })
    });
    assert.ok(!msg.includes('「」'), '空名字不能渲染成空书名号');
    assert.ok(msg.includes('另一个文档') && msg.includes('当前文档'));
});

// ===== 不可缩放路径（putPixels / raw RGBA） =====
// 这条路径不读 placementWidth，按原始像素贴。坐标与尺寸必须来自同一套假设，
// 否则会出现"按缩放后尺寸算坐标、按原始尺寸贴像素"的错位——这正是本文件要守住的那条线。

check('non-scalable path: never scales, reports original size', () => {
    const p = resolveCrossDocumentPlacement({
        imageWidth: 3000, imageHeight: 3000, docWidth: 800, docHeight: 600, canScale: false
    });
    assert.equal(p.scaled, false);
    assert.equal(p.placementWidth, 3000, '不能缩的路径必须原样上报尺寸');
    assert.equal(p.placementHeight, 3000);
    assert.equal(p.overflows, true);
});

check('non-scalable path: never emits negative coordinates', () => {
    const p = resolveCrossDocumentPlacement({
        imageWidth: 3000, imageHeight: 3000, docWidth: 800, docHeight: 600, canScale: false
    });
    // 居中会算出负数（(800-3000)/2 = -1100），那会把图整个推到画布左上之外，
    // 用户连贴没贴上都看不出来。必须钳到 0。
    assert.equal(p.targetBounds.left, 0);
    assert.equal(p.targetBounds.top, 0);
});

check('non-scalable path: still centers when it fits', () => {
    const p = resolveCrossDocumentPlacement({
        imageWidth: 400, imageHeight: 300, docWidth: 1000, docHeight: 900, canScale: false
    });
    assert.equal(p.overflows, false);
    assert.deepEqual(p.targetBounds, { left: 300, top: 300 });
});

check('non-scalable path: one oversized side still counts as overflow', () => {
    const p = resolveCrossDocumentPlacement({
        imageWidth: 400, imageHeight: 2000, docWidth: 1000, docHeight: 900, canScale: false
    });
    assert.equal(p.overflows, true);
    assert.equal(p.targetBounds.top, 0);
    assert.equal(p.targetBounds.left, 300, '未超出的那一边仍应居中');
});

check('overflow notice explains the visible symptom and the way out', () => {
    const msg = buildCrossDocumentPlacementNotice({
        sourceDocumentName: '主图A.psd',
        activeDocumentName: '小图B.psd',
        resultLabel: '局部重绘结果',
        placement: resolveCrossDocumentPlacement({
            imageWidth: 3000, imageHeight: 3000, docWidth: 800, docHeight: 600, canScale: false
        })
    });
    assert.ok(msg.includes('大于当前画布'), '必须说明为什么只看得到一部分');
    assert.ok(msg.includes('左上角'), '必须说明落位方式');
    assert.ok(msg.includes('主图A.psd') && msg.includes('小图B.psd'));
    assert.ok(!msg.includes('居中'), '左上对齐时不能说成居中');
});

// ===== 残留图层说明并入同一条提示 =====
check('leftover layer is reported inside the same notice', () => {
    const msg = buildCrossDocumentPlacementNotice({
        sourceDocumentName: 'A.psd',
        activeDocumentName: 'B.psd',
        resultLabel: 'AI 生图结果',
        leftoverDocumentName: 'C.psd',
        placement: scalable({ imageWidth: 100, imageHeight: 100, docWidth: 800, docHeight: 600 })
    });
    assert.ok(msg.includes('C.psd'), '必须点名残留在哪个文档');
    assert.ok(msg.includes('自动收掉'), '必须给出无需手动处理的出路');
});

check('no leftover mention when nothing was left behind', () => {
    const msg = buildCrossDocumentPlacementNotice({
        sourceDocumentName: 'A.psd', activeDocumentName: 'B.psd', resultLabel: 'R',
        placement: scalable({ imageWidth: 100, imageHeight: 100, docWidth: 800, docHeight: 600 })
    });
    assert.ok(!msg.includes('还留在'), '没有残留就不该提残留');
});

check('overflow notice also carries the leftover note', () => {
    const msg = buildCrossDocumentPlacementNotice({
        sourceDocumentName: 'A.psd', activeDocumentName: 'B.psd', resultLabel: 'R',
        leftoverDocumentName: 'C.psd',
        placement: resolveCrossDocumentPlacement({
            imageWidth: 3000, imageHeight: 3000, docWidth: 800, docHeight: 600, canScale: false
        })
    });
    assert.ok(msg.includes('大于当前画布') && msg.includes('C.psd'), '两条信息都要在');
});

console.log(`cross-document-placement: ${checks} cases passed`);
