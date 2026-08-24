#!/usr/bin/env node
/**
 * 画廊评测：一组真实 brief → composeDesign 出稿 → evaluateDesign 评分 → 一张 HTML 画廊。
 * 用眼睛判断每次改动有没有变好，取代读日志。
 *
 * 前置：调试窗口在跑（launch-chat-ui-debug-window.cjs --use-default-runtime-ports --port 9223 ...），
 *       Photoshop 已连接；briefs 文件是 JSON 数组，每项 = composeDesign 的参数（可含 name 字段作标题）。
 * 用法：node scripts/design-gallery-eval.cjs --briefs tmp/gallery-briefs.json [--out tmp/gallery] [--port 9223] [--limit 10]
 * 输出：<out>/index.html + 每条 brief 的快照 jpg + results.json；每次运行按时间戳建子目录，方便前后对比。
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const readArg = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const briefsPath = readArg('--briefs', '');
const outRoot = readArg('--out', path.join(process.cwd(), 'tmp', 'gallery'));
const port = Number(readArg('--port', '9223'));
const limit = Number(readArg('--limit', '10'));
if (!briefsPath || !fs.existsSync(briefsPath)) {
    console.error('用法：node scripts/design-gallery-eval.cjs --briefs <briefs.json> [--out dir] [--port 9223] [--limit 10]');
    process.exit(1);
}
const briefs = JSON.parse(fs.readFileSync(briefsPath, 'utf8')).slice(0, limit);
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(outRoot, stamp);
fs.mkdirSync(outDir, { recursive: true });

async function connect() {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (!page) throw new Error('找不到调试窗口页面（CDP）');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0; const pending = new Map();
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
    const send = (method, params) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
    const call = async (tool, params) => {
        const r = await send('Runtime.evaluate', {
            expression: `(async () => JSON.parse(JSON.stringify(await window.__DESIGNECHO_TOOL_TEST_BRIDGE__.executeToolCall(${JSON.stringify(tool)}, ${JSON.stringify(params)}))))()`,
            awaitPromise: true, returnByValue: true, timeout: 600000
        });
        if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500));
        return r.result?.result?.value;
    };
    const hasBridge = await (async () => (await send('Runtime.evaluate', { expression: 'typeof window.__DESIGNECHO_TOOL_TEST_BRIDGE__ !== "undefined"', returnByValue: true })).result?.result?.value)();
    if (!hasBridge) throw new Error('调试窗口没有工具测试桥（需 designechoChatTestBridge=1）');
    return { call, close: () => ws.close() };
}

function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

(async () => {
    let bridge = await connect();
    let call = bridge.call;
    const results = [];
    for (let index = 0; index < briefs.length; index += 1) {
        // 上一条若把页面搞崩（桥丢失），重连一次再继续
        try {
            await call('getDesignTaskCard', {});
        } catch {
            try { bridge.close(); } catch { /* ignore */ }
            bridge = await connect();
            call = bridge.call;
        }
        const brief = briefs[index];
        const name = brief.name || brief.layout?.headline || `brief-${index + 1}`;
        const spec = { ...brief }; delete spec.name;
        const t0 = Date.now();
        console.log(`[${index + 1}/${briefs.length}] ${name} …`);
        let compose = null; let evaluation = null; let snapshotFile = '';
        try {
            compose = await call('composeDesign', spec);
            const b64 = compose?.snapshot?.imageData || compose?.snapshot?.snapshot?.base64 || compose?.snapshot?.base64;
            if (b64) {
                snapshotFile = `${String(index + 1).padStart(2, '0')}-${name.replace(/[^\w一-龥-]/g, '_').slice(0, 24)}.jpg`;
                fs.writeFileSync(path.join(outDir, snapshotFile), Buffer.from(String(b64).replace(/^data:image\/\w+;base64,/, ''), 'base64'));
            }
            if (compose?.success) {
                // 图片走文件路径而不是塞进 CDP 表达式：1MB 级 base64 进 Runtime.evaluate 会把页面搞崩、桥丢失。
                evaluation = await call('evaluateDesign', {
                    deliverable: name,
                    rationale: spec.rationale,
                    ...(snapshotFile ? { filePath: path.join(outDir, snapshotFile) } : {})
                });
            }
        } catch (error) {
            compose = { success: false, error: error.message };
        }
        const elapsedMs = Date.now() - t0;
        const row = {
            name, elapsedMs, snapshotFile,
            composeSuccess: compose?.success === true, composeError: compose?.error, composeSteps: compose?.steps,
            evaluation: evaluation?.evaluation, evaluationSummary: evaluation?.summary, evaluationError: evaluation?.error
        };
        results.push(row);
        console.log(`   ${row.composeSuccess ? '出稿 ✓' : '出稿 ✗ ' + (row.composeError || '')} · ${row.evaluationSummary || row.evaluationError || '未评'} · ${(elapsedMs / 1000).toFixed(0)}s`);
    }
    fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ stamp, briefsPath, results }, null, 2), 'utf8');
    const avg = results.filter((r) => r.evaluation?.overall).map((r) => r.evaluation.overall);
    const mean = avg.length ? (avg.reduce((a, b) => a + b, 0) / avg.length).toFixed(1) : '—';
    const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>画廊评测 ${esc(stamp)}</title>
<style>body{font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#111;color:#eee;margin:0;padding:24px}
h1{font-weight:600;font-size:20px;margin:0 0 4px}.meta{color:#999;font-size:13px;margin-bottom:20px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:18px}
.card{background:#1b1b1b;border:1px solid #2a2a2a;border-radius:10px;overflow:hidden}
.card img{width:100%;aspect-ratio:1/1;object-fit:contain;background:#000;display:block}
.body{padding:12px 14px}.name{font-weight:600;margin-bottom:6px}.score{font-size:22px;font-weight:700}
.score.pass{color:#7bd88f}.score.revise{color:#f5c451}.score.pivot{color:#f2726f}
.crit{margin:8px 0 0;padding-left:18px;color:#ccc;font-size:13px;line-height:1.5}.err{color:#f2726f;font-size:13px}
.small{color:#888;font-size:12px}</style></head><body>
<h1>画廊评测 · ${esc(stamp)}</h1><div class="meta">${results.length} 条 brief · 出稿成功 ${results.filter((r) => r.composeSuccess).length} · 平均分 ${mean}/10 · briefs：${esc(briefsPath)}</div>
<div class="grid">${results.map((r) => `<div class="card">${r.snapshotFile ? `<img src="${esc(r.snapshotFile)}" alt="">` : '<div style="aspect-ratio:1/1;background:#000"></div>'}<div class="body"><div class="name">${esc(r.name)}</div>${r.evaluation ? `<div class="score ${esc(r.evaluation.verdict)}">${r.evaluation.overall}/10 <span class="small">${esc(r.evaluation.criteria.map((c) => `${c.label} ${c.score}`).join(' · '))} · ${esc(r.evaluation.verdict)}</span></div><ol class="crit">${r.evaluation.critiques.map((c) => `<li>${esc(c)}</li>`).join('')}</ol>` : `<div class="err">${esc(r.evaluationError || r.composeError || '未评')}</div>`}<div class="small">${(r.elapsedMs / 1000).toFixed(0)}s</div></div></div>`).join('')}</div>
</body></html>`;
    fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');
    console.log(`\n画廊：${path.join(outDir, 'index.html')}`);
    bridge.close();
})().catch((error) => { console.error('ERR', error.message); process.exit(1); });
