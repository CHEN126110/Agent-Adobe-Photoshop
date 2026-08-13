#!/usr/bin/env node
/**
 * OpenRouter 图像请求体契约测试。
 *
 * 起因：局部重绘的请求体里，图片内容块的字段名写成了 camelCase 的 `imageUrl`。
 * OpenAI 兼容层不认识这个名字，三张图（原图裁剪 / 红框引导图 / 参考图）被**静默丢弃**，
 * 模型只收到那段文字，执行的其实是纯文生图——返回一张跟原图毫无关系的新场景。
 * 整条链路没有任何一处会报错：请求 200，模型有返回，图也贴进了画布，只是内容完全不对。
 *
 * 这类"静默丢弃"靠跑一次看效果是发现不了的（结果看起来总是"模型不太行"），
 * 只能靠契约断言钉住。仓库里其余出图路径用的都是 snake_case，
 * 这里额外做一次跨文件一致性检查，避免将来又只在某一处写错。
 *
 * 运行方式：npm run test:openrouter-image-request
 */

const fs = require('fs');
const path = require('path');

require('ts-node').register({
    transpileOnly: true,
    project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const { OpenRouterGeminiImageService } = require(
    path.resolve(__dirname, '..', 'src', 'main', 'services', 'openrouter-gemini-image-service.ts')
);

let failures = 0;
function check(label, condition, detail) {
    if (condition) console.log(`  [通过] ${label}${detail ? ' — ' + detail : ''}`);
    else { failures += 1; console.log(`  [失败] ${label}${detail ? ' — ' + detail : ''}`); }
}

const service = new OpenRouterGeminiImageService();

function buildBody(model, referenceCount = 0) {
    return service.buildRequestBody({
        model,
        instruction: 'edit instruction',
        sourceDataUrl: 'data:image/webp;base64,SOURCE',
        guideDataUrl: 'data:image/webp;base64,GUIDE',
        referenceDataUrls: Array.from({ length: referenceCount }, (_, i) => `data:image/webp;base64,REF${i}`),
        aspectRatio: '4:3',
        imageSize: '2K'
    });
}

console.log('=== 图片内容块字段名（这条错了 = 图被静默丢弃）===');
{
    const body = buildBody('google/gemini-3-pro-image', 2);
    const content = body.messages[0].content;
    const imageBlocks = content.filter((b) => b.type === 'image_url');

    check('原图 + 引导图 + 2 张参考图共 4 个图块', imageBlocks.length === 4, `实际 ${imageBlocks.length}`);
    check('每个图块都用 snake_case image_url',
        imageBlocks.every((b) => b.image_url && typeof b.image_url.url === 'string'),
        JSON.stringify(imageBlocks.map((b) => Object.keys(b))));
    check('没有任何图块用 camelCase imageUrl',
        imageBlocks.every((b) => !('imageUrl' in b)));
    check('图片 URL 原样保留',
        imageBlocks.map((b) => b.image_url.url).join(',')
            === 'data:image/webp;base64,SOURCE,data:image/webp;base64,GUIDE,data:image/webp;base64,REF0,data:image/webp;base64,REF1');
    check('文本块排在图片之前', content[0].type === 'text');
}

console.log('\n=== 无参考图时仍要带上原图与引导图 ===');
{
    const imageBlocks = buildBody('google/gemini-3-pro-image', 0).messages[0].content
        .filter((b) => b.type === 'image_url');
    check('恰好 2 个图块', imageBlocks.length === 2, `实际 ${imageBlocks.length}`);
    check('都用 image_url', imageBlocks.every((b) => !!b.image_url));
}

console.log('\n=== image_config 按模型下发（非通用参数）===');
{
    const gemini = buildBody('google/gemini-3-pro-image');
    check('Gemini 带 image_config', !!gemini.image_config,
        JSON.stringify(gemini.image_config));
    for (const model of ['openai/gpt-5-image', 'openai/gpt-5-image-mini', 'openai/gpt-5.4-image-2']) {
        check(`${model} 不带 image_config`, buildBody(model).image_config === undefined);
    }
}

console.log('\n=== 模型选择必须被尊重 ===');
{
    for (const model of ['google/gemini-3-pro-image', 'openai/gpt-5-image', 'openai/gpt-5-image-mini', 'openai/gpt-5.4-image-2']) {
        check(`${model} 原样进请求体`, buildBody(model).model === model);
    }
    let threw = false;
    try {
        service.normalizeModel('vendor/not-supported');
    } catch (error) {
        threw = true;
        check('不支持的模型显式报错而不是静默换成默认模型',
            String(error?.message || '').includes('不在支持清单'), error?.message);
    }
    if (!threw) {
        failures += 1;
        console.log('  [失败] 不支持的模型应当抛错，实际静默通过');
    }
}

console.log('\n=== 跨文件一致性：仓库不得再出现 camelCase 图块 ===');
{
    const roots = ['src/main', 'src/renderer', 'src/shared'];
    const offenders = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (/\.tsx?$/.test(entry.name)) {
                const text = fs.readFileSync(full, 'utf8');
                // 只抓"构造请求"的写法；回包解析里兼容 imageUrl 是合理的
                if (/type:\s*'image_url'[^}]*imageUrl\s*:/.test(text)) {
                    offenders.push(path.relative(path.resolve(__dirname, '..'), full));
                }
            }
        }
    };
    for (const root of roots) {
        const abs = path.resolve(__dirname, '..', root);
        if (fs.existsSync(abs)) walk(abs);
    }
    check('没有文件在构造请求时用 camelCase imageUrl', offenders.length === 0, offenders.join(', '));
}

console.log(`\n${failures === 0 ? '全部通过' : failures + ' 项失败'}`);
process.exit(failures === 0 ? 0 : 1);
