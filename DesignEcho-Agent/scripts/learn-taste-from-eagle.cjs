#!/usr/bin/env node
/**
 * 从用户指定的 Eagle 参考文件夹提取设计经验候选。
 * 每张走 studyReference(approvedReference=true)：推演做法与 takeaways 进入长期知识人工审核队列。
 * 模型对参考图的解释仍是推断，批准前不会成为正式知识或评审校准。
 *
 * 前置：Eagle 在跑（localhost:41595）；调试窗口在跑（CDP 9223，带工具测试桥）。
 * 用法：node scripts/learn-taste-from-eagle.cjs --folder <EagleFolderId> [--folder <id2>] [--limit 6] [--purpose "..."] [--port 9223]
 *   例：--folder MPQGRQUJ9KFTE（主图/点击图-参考） --folder M53OBAZGFLFBZ（转化图-卖点参考）
 */
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const folders = []; for (let i = 0; i < args.length; i += 1) if (args[i] === '--folder' && args[i + 1]) folders.push(args[i + 1]);
const readArg = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const limit = Number(readArg('--limit', '6'));
const port = Number(readArg('--port', '9223'));
const purpose = readArg('--purpose', '学习用户认可的参考：说得出好在哪、怎么做的，沉淀成用户口味');
if (folders.length === 0) { console.error('用法：--folder <EagleFolderId> [--limit 6]'); process.exit(1); }

async function eagle(pathname) {
    const r = await fetch(`http://localhost:41595${pathname}`);
    const j = await r.json();
    if (j.status !== 'success') throw new Error(`Eagle ${pathname} → ${JSON.stringify(j).slice(0, 200)}`);
    return j.data;
}
async function connect() {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (!page) throw new Error('找不到调试窗口页面');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0; const pending = new Map();
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
    const send = (method, params) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
    const call = async (tool, params) => {
        const r = await send('Runtime.evaluate', { expression: `(async () => JSON.parse(JSON.stringify(await window.__DESIGNECHO_TOOL_TEST_BRIDGE__.executeToolCall(${JSON.stringify(tool)}, ${JSON.stringify(params)}))))()`, awaitPromise: true, returnByValue: true, timeout: 300000 });
        if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
        return r.result?.result?.value;
    };
    return { call, close: () => ws.close() };
}

(async () => {
    const { call, close } = await connect();
    const results = [];
    for (const folderId of folders) {
        const items = await eagle(`/api/item/list?folders=${encodeURIComponent(folderId)}&limit=${limit}&orderBy=-modificationTime`);
        console.log(`文件夹 ${folderId}：${items.length} 张`);
        for (const item of items) {
            // Eagle 缩略图路径（本地文件）；原图在同目录 <name>.<ext>
            let filePath = '';
            try {
                const thumb = await eagle(`/api/item/thumbnail?id=${encodeURIComponent(item.id)}`);
                const dir = path.dirname(decodeURIComponent(String(thumb).replace(/^file:\/\/\/?/, '')));
                const original = path.join(dir, `${item.name}.${item.ext}`);
                filePath = fs.existsSync(original) ? original : decodeURIComponent(String(thumb).replace(/^file:\/\/\/?/, ''));
            } catch (error) {
                console.log(`  跳过 ${item.name}：拿不到路径（${error.message}）`);
                continue;
            }
            const t0 = Date.now();
            const study = await call('studyReference', { filePath, purpose, deliverable: '主图 / 点击图', approvedReference: true });
            const ok = study?.success === true;
            results.push({ id: item.id, name: item.name, filePath, ok, summary: study?.study?.summary, strengths: study?.study?.strengths, learning: study?.learning, error: study?.error });
            console.log(`  ${ok ? '✓' : '✗'} ${item.name} · ${(Date.now() - t0) / 1000 | 0}s · ${ok ? (study.study.strengths || []).slice(0, 2).join(' / ') : study?.error}`);
        }
    }
    const outDir = path.join(process.cwd(), 'tmp', 'taste'); fs.mkdirSync(outDir, { recursive: true });
    const out = path.join(outDir, `eagle-taste-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
    fs.writeFileSync(out, JSON.stringify(results, null, 2), 'utf8');
    const okCount = results.filter((r) => r.ok).length;
    console.log(`\n完成：${okCount}/${results.length} 张已分析；经验候选进入项目 .designecho/learning-candidates.json，未自动回灌评审器；明细 ${out}`);
    close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
