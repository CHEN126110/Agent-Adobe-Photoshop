#!/usr/bin/env node
/** MobileSAM 范围、缓存与模型下载完整性回归；不加载 ONNX 权重。 */
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const Module = require('module');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
require('ts-node').register({
    transpileOnly: true,
    project: path.join(root, 'tsconfig.main.json')
});

const {
    createSemanticScopeMaskFromLogits,
    resolveDecoderMaskCandidateCount,
    SAMService
} = require(path.join(root, 'src/main/services/sam-service.ts'));
const {
    MattingService,
    resolveSemanticScopeRefinementRadius
} = require(path.join(root, 'src/main/services/matting-service.ts'));

let passed = 0;
const failures = [];
function check(name, condition, detail) {
    if (condition) {
        passed += 1;
        console.log(`✅ ${name}`);
        return;
    }
    failures.push(`${name}${detail ? `：${detail}` : ''}`);
}

const service = new SAMService({ modelsDir: 'unused-for-pure-logic-test' });

const multiPointPrompts = service.preparePrompts(
    { x1: 1, y1: 2, x2: 3, y2: 4 },
    [
        { x: 5, y: 6, label: 1 },
        { x: 7, y: 8, label: 0 }
    ],
    100,
    50,
    2
);
check(
    'Box Prompt 后可同时附加 Agent 前景点与背景点',
    JSON.stringify(Array.from(multiPointPrompts.pointCoords)) === JSON.stringify([2, 4, 6, 8, 10, 12, 14, 16])
        && JSON.stringify(Array.from(multiPointPrompts.pointLabels)) === JSON.stringify([2, 3, 1, 0]),
    JSON.stringify({
        coords: Array.from(multiPointPrompts.pointCoords),
        labels: Array.from(multiPointPrompts.pointLabels)
    })
);
const legacySinglePointPrompts = service.preparePrompts(
    { x1: 1, y1: 2, x2: 3, y2: 4 },
    { x: 5, y: 6, label: 1 },
    100,
    50,
    2
);
check(
    '历史单点调用保持兼容，不改变既有 Box 标签顺序',
    JSON.stringify(Array.from(legacySinglePointPrompts.pointLabels)) === JSON.stringify([2, 3, 1])
);
let invalidGuidanceRejected = false;
try {
    service.preparePrompts(
        { x1: 1, y1: 2, x2: 3, y2: 4 },
        [{ x: Number.NaN, y: 6, label: 1 }],
        100,
        50,
        2
    );
} catch (error) {
    invalidGuidanceRejected = /无效坐标或标签/.test(String(error?.message || error));
}
check('Provider 不会静默丢弃无效引导点', invalidGuidanceRejected);

const scope = createSemanticScopeMaskFromLogits(
    new Float32Array([-1, -0.001, 0, 0.001, 2, Number.NaN]),
    3,
    2
);
check(
    'SAM 语义范围严格使用官方 logit > 0，不把负值或零改成半透明前景',
    JSON.stringify(Array.from(scope)) === JSON.stringify([0, 0, 0, 255, 255, 0]),
    JSON.stringify(Array.from(scope))
);
check(
    'matting 权重不能把语义范围修正带扩大到邻近物尺度',
    resolveSemanticScopeRefinementRadius(3072, 2740) === 8
        && resolveSemanticScopeRefinementRadius(640, 480) === 2
);
check(
    'MobileSAM decoder 能从 ONNX 元数据区分 4 候选与旧单候选能力',
    resolveDecoderMaskCandidateCount([
        { name: 'masks', shape: [1, 4, 256, 256] },
        { name: 'iou_predictions', shape: [1, 4] }
    ]) === 4
        && resolveDecoderMaskCandidateCount([
            { name: 'iou_predictions', shape: [1, 1] }
        ]) === 1
);

const componentService = new MattingService({
    modelsDir: 'unused-for-pure-logic-test',
    gpuMode: 'cpu'
});
const componentWidth = 12;
const componentHeight = 6;
const componentMask = Buffer.alloc(componentWidth * componentHeight, 0);
for (const [x1, x2] of [[1, 4], [7, 10]]) {
    for (let y = 1; y < 4; y++) {
        for (let x = x1; x < x2; x++) componentMask[y * componentWidth + x] = 255;
    }
}
componentMask[5 * componentWidth + 11] = 255;
const ownedComponents = componentService.keepTargetComponents(
    componentMask,
    componentWidth,
    componentHeight,
    [
        { x1: 0, y1: 0, x2: 5, y2: 5 },
        { x1: 6, y1: 0, x2: 11, y2: 5 }
    ]
);
check(
    '多目标组件归属保留每个选定目标并移除框外孤立碎片',
    ownedComponents.foreground === 18
        && ownedComponents.mask[2 * componentWidth + 2] === 255
        && ownedComponents.mask[2 * componentWidth + 8] === 255
        && ownedComponents.mask[5 * componentWidth + 11] === 0,
    JSON.stringify({ foreground: ownedComponents.foreground })
);

for (let index = 0; index < 7; index++) {
    service.rememberEmbedding(`image-${index}`, { index }, 10, 10, 1);
}
check(
    '嵌入缓存硬上限为 6 条并淘汰最旧条目',
    service.imageEmbeddingCache.size === 6
        && !service.imageEmbeddingCache.has('image-0')
        && service.imageEmbeddingCache.has('image-6'),
    `size=${service.imageEmbeddingCache.size}`
);

let encoderReleased = 0;
let decoderReleased = 0;
service.encoderSession = { async release() { encoderReleased += 1; } };
service.decoderSession = { async release() { decoderReleased += 1; } };

async function verifyModelDownloadIntegrity() {
    const temporaryUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'designecho-model-download-contract-'));
    const handlers = new Map();
    const electronMock = {
        ipcMain: {
            handle(channel, handler) {
                handlers.set(channel, handler);
            }
        },
        app: {
            getPath(name) {
                if (name !== 'userData') throw new Error(`unexpected app path: ${name}`);
                return temporaryUserData;
            }
        },
        dialog: {},
        shell: { async openPath() { return ''; } },
        BrowserWindow: class BrowserWindow {}
    };
    const originalLoad = Module._load;
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === 'electron') return electronMock;
        return originalLoad.call(this, request, parent, isMain);
    };

    let server;
    try {
        const modulePath = path.join(root, 'src/main/ipc-handlers/model-download-handlers.ts');
        delete require.cache[require.resolve(modulePath)];
        const { registerModelDownloadHandlers } = require(modulePath);
        registerModelDownloadHandlers({
            mainWindow: null,
            logService: null,
            mattingService: null
        });
        const download = handlers.get('model:downloadToModels');
        const checkFile = handlers.get('model:checkModelFile');
        if (typeof download !== 'function' || typeof checkFile !== 'function') {
            throw new Error('模型下载 handler 未注册。');
        }

        const payload = Buffer.from('verified-mobile-sam-artifact', 'utf8');
        const expectedSha256 = crypto.createHash('sha256').update(payload).digest('hex');
        server = http.createServer((request, response) => {
            const declaredLength = request.url === '/truncated.onnx'
                ? payload.length + 10
                : payload.length;
            response.writeHead(200, {
                'content-type': 'application/octet-stream',
                'content-length': String(declaredLength)
            });
            response.end(payload);
        });
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
        const address = server.address();
        const url = `http://127.0.0.1:${address.port}/model.onnx`;
        const event = { sender: { send() {} } };

        await download(event, url, 'sam', 'verified.onnx', 'progress:verified', expectedSha256);
        const verifiedPath = path.join(temporaryUserData, 'models', 'sam', 'verified.onnx');
        check(
            '模型下载只在 SHA-256 匹配后晋升正式文件',
            fs.existsSync(verifiedPath)
                && fs.readFileSync(verifiedPath).equals(payload)
                && await checkFile(event, 'sam', 'verified.onnx', expectedSha256) === true
        );
        check(
            '同一文件用错误 SHA-256 检查时不会冒充已安装',
            await checkFile(event, 'sam', 'verified.onnx', '0'.repeat(64)) === false
        );

        let mismatchRejected = false;
        try {
            await download(event, url, 'sam', 'mismatch.onnx', 'progress:mismatch', 'f'.repeat(64));
        } catch (error) {
            mismatchRejected = /完整性校验失败/.test(String(error?.message || error));
        }
        const modelDir = path.join(temporaryUserData, 'models', 'sam');
        const partialFiles = fs.readdirSync(modelDir).filter(name => name.endsWith('.part'));
        check(
            '哈希错误的下载不会留下正式文件或半成品',
            mismatchRejected
                && !fs.existsSync(path.join(modelDir, 'mismatch.onnx'))
                && partialFiles.length === 0,
            JSON.stringify({ mismatchRejected, partialFiles })
        );

        let truncatedRejected = false;
        try {
            await download(
                event,
                `http://127.0.0.1:${address.port}/truncated.onnx`,
                'sam',
                'truncated.onnx',
                'progress:truncated',
                expectedSha256
            );
        } catch (error) {
            truncatedRejected = /下载中断|下载不完整/.test(String(error?.message || error));
        }
        const partialAfterTruncated = fs.readdirSync(modelDir).filter(name => name.endsWith('.part'));
        check(
            '传输中断不会把截断模型晋升为正式文件',
            truncatedRejected
                && !fs.existsSync(path.join(modelDir, 'truncated.onnx'))
                && partialAfterTruncated.length === 0,
            JSON.stringify({ truncatedRejected, partialAfterTruncated })
        );

        let traversalRejected = false;
        try {
            await download(event, url, '../escape', 'outside.onnx', 'progress:escape', expectedSha256);
        } catch (error) {
            traversalRejected = /目标路径无效|越出模型目录/.test(String(error?.message || error));
        }
        check('模型下载目标不能用路径穿越逃出 models 目录', traversalRejected);
    } finally {
        Module._load = originalLoad;
        if (server) await new Promise(resolve => server.close(resolve));
        fs.rmSync(temporaryUserData, { recursive: true, force: true });
    }
}

async function main() {
    await verifyModelDownloadIntegrity();
    await service.dispose();
    check(
        'dispose 释放两个 ONNX session 并清空缓存',
        encoderReleased === 1
            && decoderReleased === 1
            && service.encoderSession === null
            && service.decoderSession === null
            && service.imageEmbeddingCache.size === 0,
        `encoder=${encoderReleased}, decoder=${decoderReleased}, cache=${service.imageEmbeddingCache.size}`
    );

    if (failures.length > 0) {
        console.error('\nSAM 后处理校验失败：');
        for (const failure of failures) console.error(`  - ${failure}`);
        process.exit(1);
    }
    console.log(`\n全部通过（${passed} 项）`);
}

main().catch((error) => {
    console.error('SAM 后处理校验异常：', error);
    process.exit(1);
});
