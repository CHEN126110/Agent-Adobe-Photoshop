#!/usr/bin/env node

/**
 * 撰写文案（optimize-text）真机探针：只读、不写 Photoshop、不改任何持久化状态。
 *
 * 目的：把"模型未返回可解析的候选文案"这类报错定位到真实环节——
 * 究竟是 HTTP 调用失败、还是模型把输出 token 全花在 reasoning 上导致正文为空、
 * 还是正文被 max_tokens 截断。这些只在真实模型上复现，靠读代码猜不出来。
 *
 * 用法：
 *   node scripts/probe-text-optimize-live.cjs --confirm-live
 *   node scripts/probe-text-optimize-live.cjs --confirm-live --max-tokens 4096 --count 8
 *   node scripts/probe-text-optimize-live.cjs --confirm-live --text "踩脚堆堆袜轻薄又自在 今天的通勤也要闪闪发光"
 *
 * API Key 优先取环境变量 DEEPSEEK_API_KEY；缺省时读本机 app-state-store.json 中已保存的 key。
 * 探针从不打印 key，只打印长度与来源。它会产生真实外部请求和 API 费用，必须显式传
 * --confirm-live；不得加入 maintenance:validate 或其他自动验证入口。
 */

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_TEXT = '踩脚堆堆袜轻薄又自在 今天的通勤也要闪闪发光';
const DEFAULT_BASE_URL = 'https://api.deepseek.com';

function parseArgs(argv) {
    // 默认与运行时策略一致：撰写文案任务关闭思考（见 task-orchestrator TASK_THINKING_DISABLED）。
    // --with-thinking 用于复现历史故障：思考会把输出预算吃光、正文为空。
    const args = { maxTokens: 4096, count: 8, text: DEFAULT_TEXT, model: '', baseUrl: '', noThinking: true, keyMessage: '', strict: false, confirmLive: false };
    for (let i = 0; i < argv.length; i += 1) {
        const key = argv[i];
        const value = argv[i + 1];
        if (key === '--max-tokens' && value) { args.maxTokens = Number(value); i += 1; }
        else if (key === '--count' && value) { args.count = Number(value); i += 1; }
        else if (key === '--text' && value) { args.text = value; i += 1; }
        else if (key === '--model' && value) { args.model = value; i += 1; }
        else if (key === '--base-url' && value) { args.baseUrl = value; i += 1; }
        else if (key === '--key-message' && value) { args.keyMessage = value; i += 1; }
        else if (key === '--strict') { args.strict = true; }
        else if (key === '--confirm-live') { args.confirmLive = true; }
        else if (key === '--no-thinking') { args.noThinking = true; }
        else if (key === '--with-thinking') { args.noThinking = false; }
    }
    return args;
}

function resolveStateStorePath() {
    const appData = process.env.APPDATA
        || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
    return path.join(appData, 'designecho-agent', 'app-state-store.json');
}

function readRuntimeState() {
    const storePath = resolveStateStorePath();
    if (!fs.existsSync(storePath)) {
        throw new Error(`未找到本机运行状态文件：${storePath}。请先启动一次 Agent，或用 --model / DEEPSEEK_API_KEY 手动指定。`);
    }
    // 状态文件里模型设置是"JSON 字符串套 JSON"，直接按对象路径取会落空；
    // 统一把转义还原成普通 JSON 文本后再按片段解析，避免依赖具体嵌套层级。
    const rawText = fs.readFileSync(storePath, 'utf8');
    const flat = rawText.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    const prefsMatch = flat.match(/"modelPreferences":(\{.*?"thinking":\{[^}]*\}\})/);
    const preferences = prefsMatch ? JSON.parse(prefsMatch[1]) : null;
    const keyMatch = flat.match(/"deepseek":"(sk-[^"]+)"/);
    const dynamicMatch = flat.match(/"dynamicModels":(\[[\s\S]*?\])(?=,"|\})/);
    let dynamicModels = [];
    if (dynamicMatch) {
        try { dynamicModels = JSON.parse(dynamicMatch[1]); } catch { dynamicModels = []; }
    }
    return {
        storePath,
        preferences,
        dynamicModels,
        deepseekKey: keyMatch ? keyMatch[1] : ''
    };
}

function loadTextHandlerInternals() {
    const distPath = path.join(__dirname, '..', 'dist', 'main', 'main', 'uxp-handlers', 'text-handlers.js');
    if (!fs.existsSync(distPath)) {
        throw new Error(`未找到编译产物：${distPath}。请先执行 npm run build:main。`);
    }
    const mod = require(distPath);
    if (typeof mod.buildOptimizePrompt !== 'function' || typeof mod.normalizeCandidates !== 'function') {
        throw new Error('dist 中的 text-handlers 未导出探针所需函数，编译产物可能是旧版本。请重新执行 npm run build:main。');
    }
    return mod;
}

function previewText(value, limit = 400) {
    const text = String(value || '');
    if (text.length <= limit) return text;
    return `${text.slice(0, limit)}…（共 ${text.length} 字）`;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (!args.confirmLive) {
        throw new Error('这是会读取本机 API Key 并产生真实外部请求费用的人工探针。确认后请显式传入 --confirm-live。');
    }
    const state = readRuntimeState();
    const apiKey = (process.env.DEEPSEEK_API_KEY || state.deepseekKey || '').trim();
    if (!apiKey) {
        throw new Error('未找到 DeepSeek API Key：请设置环境变量 DEEPSEEK_API_KEY，或在 Agent 设置中保存 DeepSeek Key 后重试。');
    }

    const configuredModelId = args.model
        || String(state.preferences?.primaryModel || '').trim();
    const dynamic = state.dynamicModels.find(item => item?.id === configuredModelId);
    const apiModelId = dynamic?.apiModelId || configuredModelId.replace(/^deepseek-/, '');
    const baseUrl = args.baseUrl || DEFAULT_BASE_URL;

    const { buildOptimizePrompt, normalizeCandidates } = loadTextHandlerInternals();
    const promptParams = {
        creativeStyle: 'natural',
        targetAudience: '甜美女生',
        description: '这是一款蝴蝶结丝带 分趾小腿袜',
        keyMessage: args.keyMessage
    };
    // 探针不传图，视觉能力按"不可用"声明，与无图运行时一致
    // --strict 复现运行时的第二轮：带上一轮的失败样本与真实原因
    const failures = args.strict
        ? [{
            text: ['新疆棉贴着脚踝软', '软的像被云朵轻轻托住'].join('\n'),
            reasons: ['字数 18，需 16（+2）', '比原文多 2 字，可能撑出原有占位或画布']
        }]
        : [];
    const prompt = buildOptimizePrompt(args.text, promptParams, args.count, args.strict, failures, false);

    console.log('===== 撰写文案真机探针 =====');
    console.log(`状态文件：${state.storePath}`);
    console.log(`运行时主模型：${configuredModelId}（API 模型名 ${apiModelId}）`);
    console.log(`API Key：来源=${process.env.DEEPSEEK_API_KEY ? '环境变量' : '本机状态文件'}，长度=${apiKey.length}`);
    console.log(`原文：「${args.text}」（${args.text.replace(/[\r\n]/g, '').length} 字）`);
    console.log(`请求候选数：${args.count}，max_tokens：${args.maxTokens}，思考模式：${args.noThinking ? '显式关闭' : '按模型默认'}`);
    console.log(`提示词长度：${prompt.length} 字`);
    console.log(`本句重点：${args.keyMessage || '(未指定)'}`);
    console.log('');

    const startedAt = Date.now();
    const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: apiModelId,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: args.maxTokens,
            temperature: 0.7,
            stream: false,
            ...(args.noThinking ? { thinking: { type: 'disabled' } } : {})
        }),
        signal: AbortSignal.timeout(180_000)
    });

    const payload = await response.json().catch(() => ({}));
    const elapsedMs = Date.now() - startedAt;

    if (!response.ok) {
        const providerMessage = String(payload?.error?.message || payload?.message || 'unknown error')
            .replace(/\s+/g, ' ')
            .slice(0, 300);
        console.log(`HTTP ${response.status}（${elapsedMs} ms）：${providerMessage}`);
        process.exitCode = 1;
        return;
    }

    const choice = payload?.choices?.[0] || {};
    const message = choice.message || {};
    const content = String(message.content || '');
    const reasoning = String(message.reasoning_content || '');

    console.log(`耗时：${elapsedMs} ms`);
    console.log(`finish_reason：${choice.finish_reason}`);
    console.log(`usage：${JSON.stringify(payload.usage || {})}`);
    console.log(`正文长度：${content.length}；思考长度：${reasoning.length}`);
    console.log('');
    console.log('--- 正文预览 ---');
    console.log(content ? previewText(content, 800) : '（空，模型没有产出任何正文）');
    if (reasoning) {
        console.log('');
        console.log('--- 思考预览 ---');
        console.log(previewText(reasoning, 400));
    }

    if (content) {
        // 走运行时同一套归一化 + 三档版式验收，直接看用户最终能拿到几个可用候选
        const normalized = normalizeCandidates({ text: content }, args.text, 3, undefined, [], []);
        console.log('');
        console.log('--- 版式验收（与运行时同一套逻辑）---');
        console.log(`解析出候选：${normalized.stats.collected}，去重可用：${normalized.stats.extracted}`);
        console.log(`全等(ok)：${normalized.stats.ok}，近版式(watch)：${normalized.stats.watch}，版式外(risk)：${normalized.stats.risk}`);
        normalized.candidateDetails.forEach((detail, index) => {
            console.log(`  ${index + 1}. [${detail.fitStatus}] ${detail.text.replace(/\n/g, '⏎')}`
                + `（${detail.charCount} 字，${detail.lengthDiff >= 0 ? '+' : ''}${detail.lengthDiff}）`
                + (detail.risks && detail.risks.length ? ` ← ${detail.risks.join('；')}` : ''));
        });
    }

    console.log('');
    console.log('--- 判读 ---');
    if (!content && reasoning) {
        console.log('结论：输出预算被思考内容吃光，正文为空 → 上层会报"模型未返回可解析的候选文案"。');
    } else if (choice.finish_reason === 'length') {
        console.log('结论：正文被 max_tokens 截断，末尾候选不完整。');
    } else if (!content) {
        console.log('结论：模型既无正文也无思考，需检查请求参数与账号状态。');
    } else {
        console.log('结论：模型正常产出正文，失败点不在模型调用本身。');
    }
}

main().catch(error => {
    console.error(`探针执行失败：${error?.message || error}`);
    process.exitCode = 1;
});
