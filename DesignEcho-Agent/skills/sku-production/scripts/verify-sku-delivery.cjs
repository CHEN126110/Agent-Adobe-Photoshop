/**
 * SKU 交付核对脚本（确定性，零容差）：核对导出目录里的组合文件是否
 * 数量完整、无多余、非空。文件级核对，不看画面内容——画面质量归视觉复核。
 *
 * 参数（argv[2] JSON）：
 *   directory  必填，导出目录绝对路径
 *   combos     必填，确认的组合清单，如 [["浅灰驼","米白"],["橄榄绿","藕粉","米白"]]
 *   ext        可选，文件扩展名（默认 "jpg"）
 *
 * 输出（stdout JSON）：{ ok, expected, found, missing, extra, empty, notes }
 */

'use strict';

const fs = require('fs');
const path = require('path');

function fail(message) {
    process.stdout.write(JSON.stringify({ ok: false, error: message }, null, 2));
    process.exit(1);
}

let params;
try {
    params = JSON.parse(process.argv[2] || '{}');
} catch (error) {
    fail(`参数不是合法 JSON：${error.message}`);
}

const directory = String(params.directory || '').trim();
const combos = Array.isArray(params.combos) ? params.combos : null;
const ext = String(params.ext || 'jpg').replace(/^\./, '').toLowerCase();

if (!directory) fail('缺少 directory：请传导出目录绝对路径。');
if (!fs.existsSync(directory)) fail(`导出目录不存在：${directory}`);
if (!combos || combos.length === 0) fail('缺少 combos：请传已确认的组合清单（二维数组，每项是一组色名）。');

const normalize = (name) => String(name || '').replace(/\s+/g, '').toLowerCase();

const files = fs.readdirSync(directory).filter((file) => file.toLowerCase().endsWith(`.${ext}`));

const missing = [];
const matchedFiles = new Set();
const empty = [];

for (const combo of combos) {
    const colorKeys = combo.map(normalize);
    const match = files.find((file) => {
        const key = normalize(path.basename(file, path.extname(file)));
        return colorKeys.every((color) => key.includes(color));
    });
    if (!match) {
        missing.push(combo.join('+'));
        continue;
    }
    matchedFiles.add(match);
    if (fs.statSync(path.join(directory, match)).size === 0) {
        empty.push(match);
    }
}

const extra = files.filter((file) => !matchedFiles.has(file));

const result = {
    ok: missing.length === 0 && empty.length === 0,
    expected: combos.length,
    found: matchedFiles.size,
    missing,
    extra,
    empty,
    notes: [
        missing.length > 0 ? `缺 ${missing.length} 个组合的导出文件——先补齐再宣称完成。` : '',
        extra.length > 0 ? `目录里有 ${extra.length} 个未对应任何确认组合的文件——确认是否为旧版残留。` : '',
        empty.length > 0 ? `${empty.length} 个文件大小为 0——导出损坏，需要重新导出。` : '',
        '本脚本只核对文件级事实（数量/命名/非空），画面质量仍需视觉复核。'
    ].filter(Boolean)
};

process.stdout.write(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
