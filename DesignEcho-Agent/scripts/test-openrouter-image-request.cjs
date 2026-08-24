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

console.log('=== 局部重绘：input_references 字段名与数量（这条错了 = 图被静默丢弃）===');
{
    const body = buildBody('google/gemini-3-pro-image', 2);
    const refs = body.input_references;

    check('input_references 存在且是数组', Array.isArray(refs), typeof refs);
    check('原图 + 引导图 + 2 张参考图共 4 项', refs.length === 4, `实际 ${refs?.length}`);
    check('每项都是 { type:"image_url", image_url:{ url } } 形状',
        refs.every((r) => r.type === 'image_url' && r.image_url && typeof r.image_url.url === 'string'),
        JSON.stringify(refs.map((r) => Object.keys(r))));
    check('没有任何项用 camelCase imageUrl',
        refs.every((r) => !('imageUrl' in r)));
    check('图片 URL 原样保留且顺序为 源图→引导图→参考图',
        refs.map((r) => r.image_url.url).join(',')
            === 'data:image/webp;base64,SOURCE,data:image/webp;base64,GUIDE,data:image/webp;base64,REF0,data:image/webp;base64,REF1');
    check('prompt 是顶层字符串（不再包在 messages 里）', typeof body.prompt === 'string' && body.prompt.length > 0);
    check('不再发 chat 路径的 messages / modalities',
        body.messages === undefined && body.modalities === undefined);
}

console.log('\n=== 无参考图时仍要带上原图与引导图 ===');
{
    const refs = buildBody('google/gemini-3-pro-image', 0).input_references;
    check('恰好 2 项', refs.length === 2, `实际 ${refs.length}`);
    check('都是 image_url 形状', refs.every((r) => r.type === 'image_url' && !!r.image_url));
}

// 整图重生（image-to-image）路径：无引导图，其余契约与局部重绘一致。
// 这条路径是新加的，注释里承诺过"谁改了字段名都会在契约测试里立刻暴露"——所以断言必须真的在。
function buildGenerationBody(model, referenceCount = 0, aspectRatio = '16:9', imageSize = '2K') {
    return service.buildGenerationRequestBody({
        model,
        instruction: 'regenerate instruction',
        sourceDataUrl: 'data:image/webp;base64,SOURCE',
        referenceDataUrls: Array.from({ length: referenceCount }, (_, i) => `data:image/webp;base64,REF${i}`),
        aspectRatio,
        imageSize
    });
}

console.log('\n=== 整图重生路径：input_references 字段名与数量 ===');
{
    const body = buildGenerationBody('google/gemini-3-pro-image', 2);
    const refs = body.input_references;

    check('原图 + 2 张参考图共 3 项（无引导图）', refs.length === 3, `实际 ${refs.length}`);
    check('每项都是 { type:"image_url", image_url:{ url } } 形状',
        refs.every((r) => r.type === 'image_url' && r.image_url && typeof r.image_url.url === 'string'),
        JSON.stringify(refs.map((r) => Object.keys(r))));
    check('没有任何项用 camelCase imageUrl', refs.every((r) => !('imageUrl' in r)));
    check('图片 URL 原样保留',
        refs.map((r) => r.image_url.url).join(',')
            === 'data:image/webp;base64,SOURCE,data:image/webp;base64,REF0,data:image/webp;base64,REF1');
    check('prompt 是顶层字符串', typeof body.prompt === 'string');
}

// 这一组是 4K 失效的直接防线。真实事故：分辨率一直发在 image_config.image_size 里，
// 那是 Google 原生 API 的字段名，OpenRouter 图像 API 只认顶层 resolution，
// 于是档位从未生效、输出恒为该比例的 1K 档（3:4 → 896×1200，真机 5 次记录一致）。
console.log('\n=== 分辨率必须走顶层 resolution（不是 image_config.image_size）===');
{
    const gemini = buildGenerationBody('google/gemini-3-pro-image-preview', 0, '16:9', '4K');
    check('顶层 resolution 下发且取值正确', gemini.resolution === '4K', String(gemini.resolution));
    check('顶层 aspect_ratio 下发且取值正确', gemini.aspect_ratio === '16:9', String(gemini.aspect_ratio));
    check('不得再出现 image_config（OpenRouter 图像 API 不认这个字段）',
        gemini.image_config === undefined, JSON.stringify(gemini.image_config));
    check('不得再出现 image_size 顶层字段', gemini.image_size === undefined);
    check('n 锁定为 1（模型 supported_parameters 的 min=max=1）', gemini.n === 1, String(gemini.n));
    check('output_format 显式要 png（消除上游默认回 JPEG 的有损与无 ICC）',
        gemini.output_format === 'png', String(gemini.output_format));

    for (const model of ['google/gemini-3-pro-image', 'google/gemini-3.1-flash-image-preview']) {
        const b = buildGenerationBody(model, 0, '4:3', '4K');
        check(`${model} 带 resolution/aspect_ratio`, b.resolution === '4K' && b.aspect_ratio === '4:3');
    }
    // OpenAI 系**不支持 resolution**（images API 的 supported_parameters 里没有这一项），
    // 但**支持 aspect_ratio**——两者要分开断言。
    // 早先这里把两个混在一起断言"都不带"，那是基于"OpenAI 系不吃比例"的错误假设，
    // 已被 models API 的声明证伪：gpt-image-2 / gpt-5.4-image-2 各有 9 档比例。
    for (const model of ['openai/gpt-5-image', 'openai/gpt-5-image-mini', 'openai/gpt-5.4-image-2', 'openai/gpt-image-2']) {
        const b = buildGenerationBody(model);
        check(`${model} 不带 resolution（未声明支持，发了会被忽略）`, b.resolution === undefined);
        check(`${model} 带 aspect_ratio（models API 声明支持）`, typeof b.aspect_ratio === 'string');
        check(`${model} 带 quality=high（声明支持 quality 的模型才发）`, b.quality === 'high');
    }
    check('模型原样进请求体', buildGenerationBody('google/gemini-3-pro-image-preview').model === 'google/gemini-3-pro-image-preview');
}

// 档位能力以**图像 API 的 supported_parameters** 为准（/api/v1/images/models，公开免鉴权）：
// 四个 Gemini 图像条目的 resolution 都包含 4K。
// 注意这与旧断言相反——此前"GA 不支持 4K"的结论来自 chat/completions 路径透传给 Google
// 的 400 报文，那条路径压根不管分辨率，其报文不能用来推断图像 API 的能力。
console.log('\n=== 档位钳制以图像 API 的 supported_parameters 为准 ===');
{
    // capImageSize 是 TS private（仅编译期约束），契约测试直接触达运行期方法：
    // 钳错一档 = 一次付费的无效调用，必须把行为钉死。
    const svc = service;
    check('Pro preview 请求 4K 原样放行', svc.capImageSize('google/gemini-3-pro-image-preview', '4K') === '4K');
    check('Flash preview 请求 4K 原样放行', svc.capImageSize('google/gemini-3.1-flash-image-preview', '4K') === '4K');
    check('Pro GA 请求 4K 原样放行（图像 API 声明支持）', svc.capImageSize('google/gemini-3-pro-image', '4K') === '4K');
    check('Flash GA 请求 4K 原样放行', svc.capImageSize('google/gemini-3.1-flash-image', '4K') === '4K');
    check('Pro GA 请求 2K 原样放行', svc.capImageSize('google/gemini-3-pro-image', '2K') === '2K');
    check('Pro GA 请求 1K 原样放行', svc.capImageSize('google/gemini-3-pro-image', '1K') === '1K');
}

console.log('\n=== 模型 id 必须是 OpenRouter 真实存在的写法（不带日期后缀）===');
{
    // 2026-08-17 实测：带日期后缀的写法不是 OpenRouter 的模型 id，而是条目 created 日期 /
    // Google 上游快照名。发出去会被宽松匹配解析回本体，image_config 在这一步被丢弃——
    // 表现为选了 4K 却只出 896×1200。这条契约防止再退回那种写法。
    check(
        'legacy 带日期写法被解析成正式 id（Pro）',
        service.normalizeModel('google/gemini-3-pro-image-preview-20251120') === 'google/gemini-3-pro-image-preview'
    );
    check(
        'legacy 带日期写法被解析成正式 id（Flash）',
        service.normalizeModel('google/gemini-3.1-flash-image-preview-20260226') === 'google/gemini-3.1-flash-image-preview'
    );
    // 走真实调用顺序（normalizeModel → buildGenerationBody），而不是直接调 build 绕过解析：
    // 前者才是 editImage / generateFromImage 实际发出请求的路径。
    for (const legacy of [
        'google/gemini-3-pro-image-preview-20251120',
        'google/gemini-3.1-flash-image-preview-20260226'
    ]) {
        const sentModel = String(buildGenerationBody(service.normalizeModel(legacy)).model);
        check(`真实路径下「${legacy}」发出的请求体不含日期后缀`, !/\d{8}/.test(sentModel), sentModel);
    }
}

console.log('\n=== 局部重绘路径同样走顶层 resolution ===');
{
    for (const model of ['google/gemini-3-pro-image-preview', 'google/gemini-3-pro-image']) {
        const body = buildBody(model);
        check(`${model} 带 resolution/aspect_ratio`,
            body.resolution === '2K' && body.aspect_ratio === '4:3',
            `resolution=${body.resolution} aspect_ratio=${body.aspect_ratio}`);
        check(`${model} 不再带 image_config`, body.image_config === undefined);
    }
    // 同上：OpenAI 系不吃 resolution，但吃 aspect_ratio，要分开断言
    for (const model of ['openai/gpt-5-image', 'openai/gpt-5-image-mini', 'openai/gpt-5.4-image-2', 'openai/gpt-image-2']) {
        const body = buildBody(model);
        check(`${model} 不带 resolution`, body.resolution === undefined);
        check(`${model} 带 aspect_ratio`, typeof body.aspect_ratio === 'string');
    }
}

console.log('\n=== 模型选择必须被尊重 ===');
{
    for (const model of ['google/gemini-3-pro-image-preview', 'google/gemini-3-pro-image', 'google/gemini-3.1-flash-image-preview', 'google/gemini-3.1-flash-image', 'openai/gpt-5-image', 'openai/gpt-5-image-mini', 'openai/gpt-5.4-image-2']) {
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

// 端点走错是这次 4K 事故的根因本身：chat/completions 路径没有分辨率概念，
// 在那里发任何档位参数都等于没发。端点名必须钉住。
console.log('\n=== 端点必须是图像 API，而不是 chat/completions ===');
{
    const source = fs.readFileSync(
        path.resolve(__dirname, '..', 'src', 'main', 'services', 'openrouter-gemini-image-service.ts'),
        'utf8'
    );
    check('使用 https://openrouter.ai/api/v1/images',
        source.includes("'https://openrouter.ai/api/v1/images'"));
    // 只查**字符串字面量**：注释里提到 chat/completions 是在记录事故根因，那是有价值的，
    // 不能因为断言写得太粗把它禁掉。真正要防的是端点常量又指回那条路。
    const chatEndpointLiterals = source.match(/['"`]https:\/\/openrouter\.ai\/api\/v1\/chat\/completions['"`]/g) || [];
    check('端点常量不再指向 chat/completions',
        chatEndpointLiterals.length === 0, chatEndpointLiterals.join(', '));
}

console.log(`\n${failures === 0 ? '全部通过' : failures + ' 项失败'}`);
process.exit(failures === 0 ? 0 : 1);
