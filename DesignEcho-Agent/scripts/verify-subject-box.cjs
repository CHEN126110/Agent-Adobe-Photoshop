// 主体框纯逻辑测试：把「主体在哪」算成素材属性（不依赖 Photoshop 选择主体）。
// 断言：①透明底图 alpha 命中且确定；②白底图纯色裁边命中且高置信、框准；③整图内容（渐变）两级都不命中；
// ④JPEG 级噪声不影响裁边；⑤相对框 ↔ 图层外框投影可逆；⑥分割框按覆盖率给置信；⑦兜底整框低置信。
const path = require('path');
const root = path.resolve(__dirname, '..');
require('ts-node').register({ transpileOnly: true, project: path.join(root, 'tsconfig.main.json') });
const {
    computeAlphaSubjectBox,
    computeUniformBorderSubjectBox,
    projectRelativeBoxOntoFrame,
    relativeBoxFromFrame,
    resolveMattingSubjectBox,
    frameSubjectBox
} = require(path.join(root, 'src/shared/subject-box-from-pixels.ts'));

let failed = 0;
function check(condition, label, detail) {
    if (condition) {
        console.log(`  ✓ ${label}`);
        return;
    }
    failed += 1;
    console.error(`  ✗ ${label}${detail ? `：${detail}` : ''}`);
}
function near(a, b, eps) { return Math.abs(a - b) <= eps; }

function makeImage(width, height, channels, fill) {
    const data = new Uint8Array(width * height * channels);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const px = fill(x, y);
            const o = (y * width + x) * channels;
            data[o] = px[0]; data[o + 1] = px[1]; data[o + 2] = px[2];
            if (channels === 4) data[o + 3] = px[3] === undefined ? 255 : px[3];
        }
    }
    return { data, width, height, channels };
}

console.log('[1] 透明底 alpha');
const alphaImg = makeImage(200, 100, 4, (x, y) => (x >= 50 && x < 150 && y >= 20 && y < 80) ? [200, 30, 30, 255] : [0, 0, 0, 0]);
const alpha = computeAlphaSubjectBox(alphaImg);
check(Boolean(alpha) && alpha.method === 'alpha' && alpha.confidence === 'certain', 'alpha 命中且确定');
check(Boolean(alpha) && near(alpha.box.x, 0.25, 0.01) && near(alpha.box.width, 0.5, 0.01) && near(alpha.box.y, 0.2, 0.01) && near(alpha.box.height, 0.6, 0.01), 'alpha 框准确', alpha && JSON.stringify(alpha.box));
const opaqueImg = makeImage(100, 100, 4, () => [10, 10, 10, 255]);
check(computeAlphaSubjectBox(opaqueImg) === undefined, '整图不透明 → alpha 不认');

console.log('[2] 白底裁边（含 JPEG 级噪声）');
let seed = 7;
const noise = () => { seed = (seed * 9301 + 49297) % 233280; return Math.floor(seed / 233280 * 9) - 4; };
const whiteBg = makeImage(300, 200, 3, (x, y) => {
    const inside = x >= 90 && x < 210 && y >= 40 && y < 160;
    if (inside) return [40 + noise(), 60 + noise(), 120 + noise()];
    return [250 + Math.max(-4, Math.min(5, noise())), 250 + Math.max(-4, Math.min(5, noise())), 250 + Math.max(-4, Math.min(5, noise()))];
});
const trim = computeUniformBorderSubjectBox(whiteBg);
check(Boolean(trim) && trim.method === 'trim' && trim.confidence === 'high', '白底裁边命中且高置信', trim && trim.note);
check(Boolean(trim) && near(trim.box.x, 0.3, 0.02) && near(trim.box.width, 0.4, 0.02) && near(trim.box.y, 0.2, 0.02) && near(trim.box.height, 0.6, 0.02), '裁边框准确', trim && JSON.stringify(trim.box));
const alphaOnWhite = computeAlphaSubjectBox({ ...whiteBg, channels: 3 });
check(alphaOnWhite === undefined, 'RGB 图 alpha 不适用');

console.log('[3] 整图都是内容 → 两级都不认');
const gradient = makeImage(120, 120, 3, (x, y) => [x * 2 % 256, y * 2 % 256, (x + y) % 256]);
check(computeUniformBorderSubjectBox(gradient) === undefined, '渐变图裁边不认（边框不均匀）');
const fullContent = makeImage(120, 120, 3, (x, y) => (x < 3 || y < 3 || x >= 117 || y >= 117) ? [255, 255, 255] : [30, 30, 30]);
const nearlyFull = computeUniformBorderSubjectBox(fullContent);
check(Boolean(nearlyFull) && near(nearlyFull.box.width, 0.95, 0.01), '3px 白边也是可裁的边：主体 = 内容 95%（这是真实答案，不算失败）', nearlyFull && JSON.stringify(nearlyFull.box));
const edgeToEdge = makeImage(120, 120, 3, (x, y) => (x < 60) ? [30, 30, 30] : [220, 220, 220]);
check(computeUniformBorderSubjectBox(edgeToEdge) === undefined, '内容顶到边、边框两种颜色 → 不认');

console.log('[4] 相对框 ↔ 图层外框投影');
const frame = { left: 100, top: 50, right: 700, bottom: 450 };
const projected = projectRelativeBoxOntoFrame({ x: 0.25, y: 0.2, width: 0.5, height: 0.6 }, frame);
check(projected.left === 250 && projected.top === 130 && projected.right === 550 && projected.bottom === 370, '投影正确', JSON.stringify(projected));
const back = relativeBoxFromFrame(projected, frame);
check(Boolean(back) && near(back.x, 0.25, 0.001) && near(back.width, 0.5, 0.001), '反算可逆', JSON.stringify(back));
const scaledFrame = { left: 0, top: 0, right: 1200, bottom: 800 };
const projected2 = projectRelativeBoxOntoFrame(back, scaledFrame);
check(projected2.left === 300 && projected2.right === 900, '缩放后按相对框投影 = 等比缩放结果', JSON.stringify(projected2));

console.log('[5] 分割框置信 + 兜底');
const mattingMid = resolveMattingSubjectBox({ left: 100, top: 100, right: 500, bottom: 500 }, 1000, 1000);
check(Boolean(mattingMid) && mattingMid.confidence === 'medium', '分割框覆盖 16% → medium');
const mattingBig = resolveMattingSubjectBox({ left: 10, top: 10, right: 980, bottom: 980 }, 1000, 1000);
check(Boolean(mattingBig) && mattingBig.confidence === 'low', '分割框覆盖 94% → low');
const fallback = frameSubjectBox();
check(fallback.method === 'frame' && fallback.confidence === 'low' && fallback.coverage === 1, '兜底整框低置信');

if (failed > 0) {
    console.error(`\n[FAIL] 主体框纯逻辑：${failed} 项断言失败`);
    process.exit(1);
}
console.log('\n[OK] 主体框纯逻辑测试通过');
