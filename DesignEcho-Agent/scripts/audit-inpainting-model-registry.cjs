#!/usr/bin/env node
/**
 * 局部重绘模型清单一致性审计。
 *
 * 起因：加 GPT 图像模型时要同时改四个地方——面板下拉、Agent 的 SUPPORTED_MODELS、
 * OpenRouter 服务的支持清单、参考图白名单。漏改任意一处，用户拿到的是
 * 「不支持的局部重绘模型「xxx」」这种看不懂的报错：下拉里明明有，后端却不认。
 *
 * 这里在开发期把四份清单对齐，比加一套运行时协议轻，也足够挡住这类漂移。
 *
 * 运行方式：npm run audit:inpainting-model-registry
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

let failures = 0;
function check(label, condition, detail) {
    if (condition) console.log(`  [通过] ${label}${detail ? ' — ' + detail : ''}`);
    else { failures += 1; console.log(`  [失败] ${label}${detail ? ' — ' + detail : ''}`); }
}

/** 抽出形如 const NAME: T[] = [ 'a', 'b' ]; 里的字符串字面量 */
function extractArrayLiterals(source, declarationPattern) {
    const match = declarationPattern.exec(source);
    if (!match) return null;
    const body = match[1];
    return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

const agentSource = read('src/main/services/inpainting-service.ts');
const openRouterSource = read('src/main/services/openrouter-gemini-image-service.ts');
const panelSource = read('public/webview/index.html');

// 1. Agent 端总清单
const agentModels = extractArrayLiterals(
    agentSource,
    /const SUPPORTED_MODELS:\s*InpaintingModel\[\]\s*=\s*\[([\s\S]*?)\];/
);
// 2. Agent 端 OpenRouter 子集
const agentOpenRouterModels = extractArrayLiterals(
    agentSource,
    /const OPENROUTER_MODELS:\s*InpaintingModel\[\]\s*=\s*\[([\s\S]*?)\];/
);
// 3. OpenRouter 服务自己的支持清单
const serviceModels = extractArrayLiterals(
    openRouterSource,
    /const SUPPORTED_MODELS:\s*OpenRouterGeminiImageModel\[\]\s*=\s*\[([\s\S]*?)\];/
);
// 4. 面板下拉
const dropdownMatch = /id="inpaintingModelDropdownMenu"[\s\S]*?<\/div>\s*<\/div>/.exec(panelSource);
const panelModels = dropdownMatch
    ? [...dropdownMatch[0].matchAll(/data-value="([^"]+)"/g)].map((m) => m[1])
    : null;
// 5. 面板参考图白名单
const panelReferenceModels = extractArrayLiterals(
    panelSource,
    /const INPAINTING_MODELS_WITH_REFERENCE_SUPPORT\s*=\s*\[([\s\S]*?)\];/
);

console.log('=== 四份清单都能解析出来 ===');
check('Agent SUPPORTED_MODELS', Array.isArray(agentModels) && agentModels.length > 0, String(agentModels));
check('Agent OPENROUTER_MODELS', Array.isArray(agentOpenRouterModels) && agentOpenRouterModels.length > 0, String(agentOpenRouterModels));
check('OpenRouter 服务 SUPPORTED_MODELS', Array.isArray(serviceModels) && serviceModels.length > 0, String(serviceModels));
check('面板下拉选项', Array.isArray(panelModels) && panelModels.length > 0, String(panelModels));
check('面板参考图白名单', Array.isArray(panelReferenceModels), String(panelReferenceModels));

if (failures > 0) {
    console.log('\n清单解析失败——多半是某处结构变了，先修解析再谈一致性。');
    process.exit(1);
}

const sorted = (list) => [...list].sort();
const sameSet = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

console.log('\n=== 面板下拉 ⟷ Agent 总清单 ===');
check('两边完全一致', sameSet(panelModels, agentModels),
    `面板 [${sorted(panelModels)}] vs Agent [${sorted(agentModels)}]`);
for (const model of panelModels) {
    check(`下拉项「${model}」后端认识`, agentModels.includes(model));
}

console.log('\n=== Agent OpenRouter 子集 ⟷ OpenRouter 服务清单 ===');
check('两边完全一致', sameSet(agentOpenRouterModels, serviceModels),
    `Agent [${sorted(agentOpenRouterModels)}] vs 服务 [${sorted(serviceModels)}]`);
check('OpenRouter 子集都在总清单里',
    agentOpenRouterModels.every((m) => agentModels.includes(m)));

console.log('\n=== 参考图白名单必须是 OpenRouter 子集 ===');
// 只有走 OpenRouter 多图输入的通道能消费参考图；即梦是官方蒙版接口，没有多图位
check('白名单不含非 OpenRouter 模型',
    panelReferenceModels.every((m) => agentOpenRouterModels.includes(m)),
    String(panelReferenceModels.filter((m) => !agentOpenRouterModels.includes(m))));
check('所有 OpenRouter 模型都在白名单里（都支持多图输入）',
    agentOpenRouterModels.every((m) => panelReferenceModels.includes(m)),
    String(agentOpenRouterModels.filter((m) => !panelReferenceModels.includes(m))));

console.log('\n=== 面板默认选中项必须有效 ===');
const defaultValue = (/id="inpaintingModelSelect"[^>]*data-value="([^"]+)"/.exec(panelSource) || [])[1];
check('默认模型在总清单内', !!defaultValue && agentModels.includes(defaultValue), `默认 = ${defaultValue}`);

console.log(`\n${failures === 0 ? '清单一致' : failures + ' 项不一致'}`);
process.exit(failures === 0 ? 0 : 1);
