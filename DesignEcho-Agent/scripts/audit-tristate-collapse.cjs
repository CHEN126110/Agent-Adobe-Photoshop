#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * 债务棘轮：能力/状态三态被压成布尔的写法只许减、不许增。
 *
 * 病理（2026-08-01 一天内四次复现）：能力与状态字段是 `boolean | undefined`，要表达
 * 「声明是」「声明否」「压根没说」三件事。用 `=== true` / `=== false` 收敛时第三种被静默
 * 折向否定，下游据此阻断，于是出现「模型选得到却用不了」「界面绿灯亮着却说没连接」
 * 「项目里有图却说没有来源」这类用户完全无法自救的状态。四个现场分别是：
 *   - supportsToolUse 未声明 → 判不支持 → no_usable_model
 *   - photoshopConnected 快照不新鲜 → 判未连接 → 整轮阻断
 *   - observe_only 识别不出文档角色 → 硬禁写 → 13 次查看 0 次改动
 *   - 回复正文里一个裸 401 → 判认证失败 → 整条好回复被替换
 *
 * 判据见 CLAUDE.md「拦『确定做不到』可以，拦『不知道能不能做到』不行」，
 * 落地出口是 shared/model-capability-verdict.ts 的 capabilityBlocksExecution()。
 *
 * 本脚本不追求消灭存量（110 处里多数是纯展示/统计，无害），只锁住**增量**：
 * 新增能力判定必须走 verdict 原语，不要再在调用点自己写 === false。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = ['src/shared', 'src/renderer/services', 'src/main/services'];

/** 这些字段承载三态，直接与布尔字面量比较即为折叠风险点。 */
const TRISTATE_FIELDS = [
    'supportsToolUse',
    'supportsVision',
    'supportsStreaming',
    'photoshopConnected',
    'isPluginConnected',
    'hasDocument'
];

const PATTERN = new RegExp(
    `\\b(?:${TRISTATE_FIELDS.join('|')})\\s*===\\s*(?:true|false)`,
    'g'
);

/**
 * 基线 = 引入 verdict 原语并继续迁移连接/文档阻断点后的**实测**存量，不是估计值。
 * 只许降不许升；确需新增时，先问它拦的是「确定做不到」还是「不知道能不能做到」——
 * 前者有依据、可以阻断，后者只是猜测，代价由模型和用户承担。
 *
 * 当前基线里的多数命中是纯展示/统计（无害），真正危险的是用它直接产出阻断的那些。
 * 逐步迁移到 capabilityBlocksExecution() 后，把这个数字往下收。
 */
const BASELINE = 24;

function walk(dir, out) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(full, out);
        } else if (/\.tsx?$/.test(entry.name)) {
            out.push(full);
        }
    }
}

const files = [];
for (const dir of SCAN_DIRS) {
    const full = path.join(ROOT, dir);
    if (fs.existsSync(full)) walk(full, files);
}

const hits = [];
for (const file of files) {
    // 原语自身就是用来解释三态的，它内部的比较是定义而非折叠。
    if (file.endsWith('model-capability-verdict.ts')) continue;
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
        const matches = line.match(PATTERN);
        if (!matches) return;
        for (const match of matches) {
            hits.push({
                file: path.relative(ROOT, file).replace(/\\/g, '/'),
                line: index + 1,
                code: match
            });
        }
    });
}

const success = hits.length <= BASELINE;
const report = {
    success,
    count: hits.length,
    baseline: BASELINE,
    rule: '能力/状态三态不得压成布尔；阻断判断一律走 capabilityBlocksExecution()',
    ...(success
        ? {}
        : {
            violation: `三态折叠点从基线 ${BASELINE} 增至 ${hits.length}。`
                + '新增能力判定请改用 shared/model-capability-verdict.ts：'
                + '只有 unsupported（有依据的否定）允许阻断，unknown 一律放行。',
            newestHits: hits.slice(-8)
        }),
    ...(hits.length < BASELINE
        ? { note: `已降至 ${hits.length}，可把 BASELINE 收紧到该值以锁住成果。` }
        : {})
};

console.log(JSON.stringify(report, null, 2));
process.exitCode = success ? 0 : 1;
