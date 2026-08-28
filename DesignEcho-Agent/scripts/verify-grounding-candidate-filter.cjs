// GroundingDINO 定向回归：会话生命周期、分数断层、整体框抑制与逐短语公平限额。
const path = require('path');
const root = path.resolve(__dirname, '..');
require('ts-node').register({ transpileOnly: true, project: path.join(root, 'tsconfig.main.json') });
const { filterByScoreGap, GroundingDinoService } = require(path.join(root, 'src/main/services/grounding-dino-service.ts'));

let failed = 0;
function check(name, condition, detail) {
    if (condition) { console.log(`✅ ${name}`); return; }
    failed += 1;
    console.log(`❌ ${name}${detail ? ' — ' + detail : ''}`);
}

// ========== 分数断层 ==========

// 真机 2026-08-27：抠"袜子"检出两只袜子(0.40/0.39) + 模特的腿(0.24)
const realCase = [{ confidence: 0.40 }, { confidence: 0.39 }, { confidence: 0.24 }];
const kept = filterByScoreGap(realCase, 0.40);
check(
    '真机案例：腿(0.24)被挡在断层外',
    kept.length === 2 && kept.every(c => c.confidence >= 0.39),
    JSON.stringify(kept.map(c => c.confidence))
);

check(
    '分数接近的同类实例全部保留',
    filterByScoreGap([{ confidence: 0.52 }, { confidence: 0.49 }, { confidence: 0.45 }], 0.52).length === 3
);

check(
    '只有一个候选时不误筛',
    filterByScoreGap([{ confidence: 0.30 }], 0.30).length === 1
);

// ========== 同类实例保护（带坐标）==========

// 真机 2026-08-28：抠"鞋子"，图里两只鞋。冠军 0.697 把下限抬到 0.488，
// 另一只鞋因遮挡只有 0.45，旧逻辑把它整个丢掉，用户看到"少抠了一只鞋"。
const twoShoes = [
    { confidence: 0.697, x1: 300, y1: 200, x2: 700, y2: 500 },   // 400x300
    { confidence: 0.45,  x1: 20,  y1: 240, x2: 360, y2: 500 }    // 340x260，同量级
];
check(
    '真机案例：第二只鞋(0.45)因尺寸同量级而保留',
    filterByScoreGap(twoShoes, 0.697).length === 2,
    JSON.stringify(filterByScoreGap(twoShoes, 0.697).map(c => c.confidence))
);

// 尺寸保护不能放行"腿"这类误检：框大一个量级
const sockAndLeg = [
    { confidence: 0.40, x1: 300, y1: 900, x2: 420, y2: 1200 },   // 120x300 = 36000
    { confidence: 0.39, x1: 500, y1: 900, x2: 620, y2: 1200 },
    { confidence: 0.24, x1: 280, y1: 200, x2: 460, y2: 1250 }    // 180x1050 = 189000，5.25 倍
];
check(
    '尺寸差一个量级的腿(0.24)仍被拒',
    filterByScoreGap(sockAndLeg, 0.40).length === 2,
    JSON.stringify(filterByScoreGap(sockAndLeg, 0.40).map(c => c.confidence))
);

const weakTierWithLaterSibling = [
    { confidence: 0.70, x1: 0, y1: 0, x2: 100, y2: 100 },
    { confidence: 0.40, x1: 0, y1: 0, x2: 300, y2: 300 },
    { confidence: 0.35, x1: 200, y1: 0, x2: 295, y2: 100 }
];
check(
    '弱档中的大框误检不会连带抹掉后续同尺度实例',
    filterByScoreGap(weakTierWithLaterSibling, 0.70).map(c => c.confidence).join(',') === '0.7,0.35',
    JSON.stringify(filterByScoreGap(weakTierWithLaterSibling, 0.70).map(c => c.confidence))
);

// 缺少尺寸证据时不能使用"同尺度实例"例外放行
check(
    '无坐标时低于下限仍被拒',
    filterByScoreGap([{ confidence: 0.60 }, { confidence: 0.20 }], 0.60).length === 1
);

check(
    '略低于第一名但未跌破下限的候选保留',
    filterByScoreGap([{ confidence: 0.60 }, { confidence: 0.45 }], 0.60).length === 2,
    '0.45 > 0.60*0.7=0.42，不该截断'
);

check(
    '低于相对下限但没有相邻分数断层时仍保留候选事实',
    filterByScoreGap([
        { confidence: 0.60 },
        { confidence: 0.44 },
        { confidence: 0.36 }
    ], 0.60).length === 3,
    '0.36 虽低于 0.42，但相对 0.44 只下降约 18%，不构成 25% 断层'
);

check(
    '跌幅大且已低于下限才进入弱档筛选',
    filterByScoreGap([{ confidence: 0.60 }, { confidence: 0.20 }], 0.60).length === 1
);

check('空输入返回空', filterByScoreGap([], 0).length === 0);

// ========== 整体框抑制 ==========

const svc = new GroundingDinoService({ modelsDir: 'unused-for-this-test' });
// 真机 2026-08-27：抠"鞋子"时除两个纯鞋框外，还有两个"袜+鞋"整体框
const shoeCase = [
    { phrase: 'shoe', confidence: 0.52, x1: 84, y1: 713, x2: 424, y2: 854 },
    { phrase: 'shoe', confidence: 0.49, x1: 405, y1: 686, x2: 564, y2: 818 },
    { phrase: 'shoe', confidence: 0.40, x1: 84, y1: 543, x2: 424, y2: 854 },
    { phrase: 'shoe', confidence: 0.40, x1: 377, y1: 516, x2: 564, y2: 818 }
];
const shoes = svc.applyNMS(shoeCase, 0.5);
check(
    '真机案例：两个"袜+鞋"整体框被抑制',
    shoes.length === 2 && shoes.every(b => b.y2 - b.y1 < 200),
    JSON.stringify(shoes.map(b => `${b.confidence}:${b.y2 - b.y1}`))
);

check(
    '不同短语互不抑制',
    svc.applyNMS([
        { phrase: 'sock', confidence: 0.5, x1: 0, y1: 0, x2: 100, y2: 100 },
        { phrase: 'shoe', confidence: 0.4, x1: 0, y1: 0, x2: 200, y2: 200 }
    ], 0.5).length === 2
);

const dominantPhraseBoxes = Array.from({ length: 13 }, (_, index) => ({
    phrase: 'sock',
    confidence: 0.99 - index * 0.01,
    x1: index * 20,
    y1: 0,
    x2: index * 20 + 10,
    y2: 10
}));
const phraseLimitInput = svc.applyNMS([
    ...dominantPhraseBoxes,
    { phrase: 'shoe', confidence: 0.30, x1: 1000, y1: 0, x2: 1010, y2: 10 }
], 0.5);
const phraseBalanced = svc.limitResultsByPhrase(phraseLimitInput, ['sock', 'shoe']);
check(
    '固定总限额按短语轮转，不会饿死其他短语',
    phraseBalanced.length === 12
        && phraseBalanced.filter(box => box.phrase === 'sock').length === 11
        && phraseBalanced.some(box => box.phrase === 'shoe'),
    JSON.stringify(phraseBalanced.map(box => box.phrase))
);
check(
    '机械限额确实会留下已知未返回候选，调用方必须收到 incomplete 收据',
    phraseLimitInput.length === 14 && phraseBalanced.length === 12
);

check(
    '同尺寸的重复框按 IoU 去重',
    svc.applyNMS([
        { phrase: 'sock', confidence: 0.5, x1: 0, y1: 0, x2: 100, y2: 100 },
        { phrase: 'sock', confidence: 0.4, x1: 5, y1: 5, x2: 105, y2: 105 }
    ], 0.5).length === 1
);

check(
    '高分的大框不被低分小框顶掉',
    (() => {
        const r = svc.applyNMS([
            { phrase: 'bag', confidence: 0.6, x1: 0, y1: 0, x2: 200, y2: 200 },
            { phrase: 'bag', confidence: 0.3, x1: 50, y1: 50, x2: 90, y2: 90 }
        ], 0.5);
        return r.length >= 1 && r[0].confidence === 0.6;
    })()
);

async function verifySharedInitialization() {
    const loadingService = new GroundingDinoService({
        modelsDir: 'unused-for-this-test',
        idleReleaseMs: 0
    });
    let loadCalls = 0;
    let finishLoad;
    const loadGate = new Promise(resolve => {
        finishLoad = resolve;
    });

    loadingService.initializeOnce = async function initializeOnceForTest() {
        loadCalls += 1;
        await loadGate;
        loadingService.session = { release() {} };
        loadingService.tokenizer = {};
        loadingService.ort = {};
        return true;
    };

    const first = loadingService.initialize();
    const second = loadingService.initialize();
    await Promise.resolve();
    check('并发首次 initialize 只启动一个加载任务', loadCalls === 1, `loadCalls=${loadCalls}`);

    finishLoad();
    const initialized = await Promise.all([first, second]);
    check(
        '并发 initialize 共享同一次成功结果',
        initialized.every(Boolean),
        JSON.stringify(initialized)
    );
    loadingService.dispose();
}

async function verifySessionReferenceDuringPreprocess() {
    const lifecycleService = new GroundingDinoService({
        modelsDir: 'unused-for-this-test',
        idleReleaseMs: 0
    });
    const events = [];
    const session = {
        released: false,
        async run() {
            events.push('run');
            if (session.released) throw new Error('session was released before run');
            return {
                logits: { dims: [1, 0, 2], data: new Float32Array(0) },
                pred_boxes: { dims: [1, 0, 4], data: new Float32Array(0) }
            };
        },
        release() {
            session.released = true;
            events.push('release');
        }
    };

    lifecycleService.session = session;
    lifecycleService.tokenizer = {
        encodePhrases() {
            return {
                ids: [101, 102],
                spans: [{ phrase: 'shoe', start: 0, end: 1 }]
            };
        }
    };
    lifecycleService.ort = {
        Tensor: class FakeTensor {
            constructor(type, data, dims) {
                this.type = type;
                this.data = data;
                this.dims = dims;
            }
        }
    };
    lifecycleService.preprocessImage = async function preprocessImageForTest() {
        events.push('preprocess');
        // 模拟旧 idle timer 恰好在异步预处理窗口触发释放。
        lifecycleService.releaseSession();
        check(
            '预处理持有引用时释放请求不会提前释放会话',
            lifecycleService.session === session && !session.released
        );
        return { tensor: new Float32Array(3), width: 1, height: 1 };
    };

    const result = await lifecycleService.detect(Buffer.alloc(0), ['shoe']);
    check('释放请求期间仍由局部 session 完成推理', result.success && events.includes('run'));
    check(
        '最后一个引用退出后才执行延后释放',
        events.join('>') === 'preprocess>run>release' && lifecycleService.session === null,
        events.join('>')
    );
    lifecycleService.dispose();
}

function installFakeRuntime(service, session, preprocess) {
    service.session = session;
    service.tokenizer = {
        encodePhrases() {
            return {
                ids: [101, 102],
                spans: [{ phrase: 'shoe', start: 0, end: 1 }]
            };
        }
    };
    service.ort = {
        Tensor: class FakeTensor {
            constructor(type, data, dims) {
                this.type = type;
                this.data = data;
                this.dims = dims;
            }
        }
    };
    service.preprocessImage = preprocess;
}

async function verifyInferenceQueueAndRelease() {
    const concurrentService = new GroundingDinoService({
        modelsDir: 'unused-for-this-test',
        idleReleaseMs: 0
    });
    const runResolvers = [];
    let preprocessCalls = 0;
    const emptyOutputs = {
        logits: { dims: [1, 0, 2], data: new Float32Array(0) },
        pred_boxes: { dims: [1, 0, 4], data: new Float32Array(0) }
    };
    const session = {
        releaseCalls: 0,
        run() {
            return new Promise(resolve => {
                runResolvers.push(() => resolve(emptyOutputs));
            });
        },
        release() {
            session.releaseCalls += 1;
        }
    };

    installFakeRuntime(concurrentService, session, async function preprocessImageForConcurrentTest() {
        preprocessCalls += 1;
        return { tensor: new Float32Array(3), width: 1, height: 1 };
    });

    const first = concurrentService.detect(Buffer.alloc(0), ['shoe']);
    const second = concurrentService.detect(Buffer.alloc(0), ['shoe']);
    await new Promise(resolve => setImmediate(resolve));
    check(
        '并发 detect 只允许一个进入预处理和 session.run',
        runResolvers.length === 1 && preprocessCalls === 1,
        `runs=${runResolvers.length}, preprocess=${preprocessCalls}`
    );

    runResolvers[0]();
    const firstResult = await first;
    await new Promise(resolve => setImmediate(resolve));
    check(
        '第一项完成后第二项才进入推理',
        firstResult.success && runResolvers.length === 2 && preprocessCalls === 2,
        `runs=${runResolvers.length}, preprocess=${preprocessCalls}`
    );

    runResolvers[1]();
    const secondResult = await second;
    concurrentService.releaseSession();
    check(
        '串行队列完成后显式释放只执行一次',
        secondResult.success && session.releaseCalls === 1 && concurrentService.session === null,
        `releaseCalls=${session.releaseCalls}`
    );
    concurrentService.dispose();
}

async function verifyDisposeCancelsQueuedInference() {
    const service = new GroundingDinoService({
        modelsDir: 'unused-for-this-test',
        idleReleaseMs: 0
    });
    let finishRun;
    let runCalls = 0;
    const runGate = new Promise(resolve => { finishRun = resolve; });
    const emptyOutputs = {
        logits: { dims: [1, 0, 2], data: new Float32Array(0) },
        pred_boxes: { dims: [1, 0, 4], data: new Float32Array(0) }
    };
    const session = {
        releaseCalls: 0,
        async run() {
            runCalls += 1;
            await runGate;
            return emptyOutputs;
        },
        release() { session.releaseCalls += 1; }
    };
    installFakeRuntime(service, session, async () => ({
        tensor: new Float32Array(3),
        width: 1,
        height: 1
    }));

    const active = service.detect(Buffer.alloc(0), ['shoe']);
    const queued = service.detect(Buffer.alloc(0), ['shoe']);
    await new Promise(resolve => setImmediate(resolve));
    service.dispose();
    const queuedResult = await queued;
    check(
        'dispose 会取消尚未开始预处理的排队推理',
        queuedResult.success === false && runCalls === 1,
        `success=${queuedResult.success}, runs=${runCalls}`
    );
    check('dispose 不会提前释放仍在运行的会话', session.releaseCalls === 0);
    finishRun();
    const activeResult = await active;
    check(
        '活跃推理结束后会话只释放一次',
        activeResult.success && session.releaseCalls === 1 && service.session === null,
        `releaseCalls=${session.releaseCalls}`
    );
}

async function verifyTruncationReceipt() {
    const service = new GroundingDinoService({
        modelsDir: 'unused-for-this-test',
        idleReleaseMs: 0
    });
    const queryCount = 13;
    const probability = 0.9;
    const logit = Math.log(probability / (1 - probability));
    const logits = new Float32Array(queryCount * 2);
    const boxes = new Float32Array(queryCount * 4);
    for (let index = 0; index < queryCount; index++) {
        logits[index * 2] = logit;
        boxes[index * 4] = (index + 0.5) / queryCount;
        boxes[index * 4 + 1] = 0.5;
        boxes[index * 4 + 2] = 0.04;
        boxes[index * 4 + 3] = 0.5;
    }
    const session = {
        async run() {
            return {
                logits: { dims: [1, queryCount, 2], data: logits },
                pred_boxes: { dims: [1, queryCount, 4], data: boxes }
            };
        },
        release() {}
    };
    installFakeRuntime(service, session, async () => ({
        tensor: new Float32Array(3),
        width: 1300,
        height: 100
    }));

    const result = await service.detect(Buffer.alloc(0), ['shoe']);
    check(
        '13 个有效候选不会被 12 个结果伪装成完整检测',
        result.success
            && result.boxes.length === 12
            && result.candidateCountBeforeLimit === 13
            && result.returnedRegionCount === 12
            && result.truncatedRegionCount === 1
            && result.truncationReason === 'result_budget'
            && result.complete === false,
        JSON.stringify(result)
    );
    service.dispose();
}

async function main() {
    await verifySharedInitialization();
    await verifySessionReferenceDuringPreprocess();
    await verifyInferenceQueueAndRelease();
    await verifyDisposeCancelsQueuedInference();
    await verifyTruncationReceipt();
    console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项未通过`);
    process.exitCode = failed === 0 ? 0 : 1;
}

main().catch(error => {
    console.error('❌ GroundingDINO 定向回归异常:', error);
    process.exitCode = 1;
});
