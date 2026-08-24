// 近期成稿指纹 / 雷同判断纯逻辑测试：同版面签名 + 同暖米底 + 同标题连出三稿必须被点名；不同角度不误报。
const path = require('path');
const root = path.resolve(__dirname, '..');
require('ts-node').register({ transpileOnly: true, project: path.join(root, 'tsconfig.main.json') });
const {
    createRecentDesignsLedger, appendDesignFingerprint, findDesignSameness, isSameColorFamily, summarizeRecentDesignsForModel
} = require(path.join(root, 'src/shared/design-workshop/recent-designs.ts'));

let failed = 0;
function check(name, condition, detail) { if (condition) { console.log(`✅ ${name}`); return; } failed += 1; console.log(`❌ ${name}${detail ? ' — ' + detail : ''}`); }

const fp = (over) => ({
    version: 'design-fingerprint/v1', at: Date.now(), documentName: '主图-1', layoutSignature: 'title-left|subject-right|selling-point-bottom',
    treatment: 'cutout', backgroundKind: 'gradient', backgroundHex: '#F3E9DC', headline: '微压塑形\n舒适一整天',
    selectedAssets: [{ path: 'E:/p/IMG_1.jpg', role: 'main-image' }], taskScopeId: 'task-a', ...over
});

check('同色系：暖米 vs 米白', isSameColorFamily('#F3E9DC', '#F7EFE4'));
check('不同色系：暖米 vs 墨绿', !isSameColorFamily('#F3E9DC', '#1F3D2B'));
check('近乎无彩：白 vs 浅灰同系', isSameColorFamily('#FFFFFF', '#EDEDED'));

let ledger = createRecentDesignsLedger();
ledger = appendDesignFingerprint(ledger, fp({ documentName: '主图-1' }));
ledger = appendDesignFingerprint(ledger, fp({
    documentName: '主图-2',
    backgroundHex: '#F6EEE3',
    taskScopeId: 'task-b',
    materialSelectionReason: '场景中的穿着动作能说明本稿的运动用途'
}));
check('账本追加 2 条', ledger.items.length === 2);
check(
    '模型选图依据原样随指纹保存，不由 Harness 改写',
    ledger.items[1].materialSelectionReason === '场景中的穿着动作能说明本稿的运动用途'
);

const same = findDesignSameness({
    documentName: '主图-3',
    layoutSignature: 'title-left|subject-right|selling-point-bottom',
    treatment: 'cutout',
    backgroundKind: 'gradient',
    backgroundHex: '#F4EADF',
    headline: '微压塑形\n舒适一整天',
    selectedAssets: [{ path: 'e:\\p\\img_1.jpg', role: 'main-image' }],
    taskScopeId: 'task-c'
}, ledger.items);
check('同版面签名被点名', same.some((s) => /版面签名.*最近 2 稿完全相同/.test(s)), JSON.stringify(same));
check('同色系底色被点名', same.some((s) => /同一色系/.test(s)), JSON.stringify(same));
check('同标题被点名', same.some((s) => /一字不差/.test(s)), JSON.stringify(same));
check(
    '完整路径归一后，同一素材跨 ≥2 个独立任务会被中性提示',
    same.some((s) => /素材 img_1\.jpg.*最近 2 个不同任务中也被使用/.test(s) && /复用本身不是质量结论/.test(s)),
    JSON.stringify(same)
);

const sameBasenameDifferentPath = findDesignSameness({
    documentName: '同名但不同文件',
    treatment: 'photo',
    backgroundKind: 'photo',
    selectedAssets: [{ path: 'D:/another-project/IMG_1.jpg', role: 'main-image' }],
    taskScopeId: 'task-c'
}, ledger.items);
check(
    '不同目录下同名文件不冒充同一素材',
    !sameBasenameDifferentPath.some((s) => /不同任务中也被使用/.test(s)),
    JSON.stringify(sameBasenameDifferentPath)
);

const sameTaskRevision = findDesignSameness({
    documentName: '主图-1 修订',
    treatment: 'photo',
    backgroundKind: 'photo',
    selectedAssets: [{ path: 'E:/p/IMG_1.jpg', role: 'main-image' }],
    taskScopeId: 'task-a'
}, ledger.items);
check(
    '同 taskScopeId 的修订不计为跨任务素材重复',
    !sameTaskRevision.some((s) => /不同任务中也被使用/.test(s)),
    JSON.stringify(sameTaskRevision)
);

const unknownTaskScope = findDesignSameness({
    documentName: '旧记录关系未知',
    treatment: 'photo',
    backgroundKind: 'photo',
    selectedAssets: [{ path: 'E:/p/IMG_1.jpg', role: 'main-image' }]
}, ledger.items);
check(
    '缺少任务作用域时保持未知，不猜成跨任务重复',
    !unknownTaskScope.some((s) => /不同任务中也被使用/.test(s)),
    JSON.stringify(unknownTaskScope)
);

const legacyLedger = [
    fp({ documentName: '旧稿-1', selectedAssets: undefined, subjectFile: 'E:/legacy/product.jpg', taskScopeId: 'legacy-a' }),
    fp({ documentName: '旧稿-2', selectedAssets: undefined, subjectFile: 'E:/legacy/product.jpg', taskScopeId: 'legacy-b' })
];
const legacyCompatible = findDesignSameness({
    documentName: '新稿',
    treatment: 'photo',
    backgroundKind: 'photo',
    selectedAssets: [{ path: 'E:/legacy/product.jpg', role: 'supporting' }],
    taskScopeId: 'legacy-c'
}, legacyLedger);
check(
    '旧 subjectFile 只读记录仍能参与完整路径兼容比较',
    legacyCompatible.some((s) => /素材 product\.jpg.*最近 2 个不同任务中也被使用/.test(s)),
    JSON.stringify(legacyCompatible)
);

const fresh = findDesignSameness({ documentName: '主图-3', angle: '袜口特写做视觉锤', layoutSignature: 'photo-full-bleed|title-bottom-right', treatment: 'photo', backgroundKind: 'photo', headline: '木耳边，一眼认出', selectedAssets: [{ path: 'D:/x/IMG_7.jpg', role: 'main-image' }], taskScopeId: 'task-c' }, ledger.items);
check('换角度 / 自由构图 / 照片满幅 / 新标题 → 不报', fresh.length === 0, JSON.stringify(fresh));

check('空账本不报', findDesignSameness({ documentName: 'x', layoutSignature: 'agent-layout-signature', treatment: 'none', backgroundKind: 'solid' }, []).length === 0);

const summary = summarizeRecentDesignsForModel(ledger.items, 3);
check(
    '开工摘要只陈述近期事实，并把是否复用留给模型判断',
    /最近 2 稿/.test(summary)
        && /主图-2/.test(summary)
        && /选图依据「场景中的穿着动作能说明本稿的运动用途」/.test(summary)
        && /不规定本次必须变化或更换素材/.test(summary)
        && /若有意复用/.test(summary),
    summary
);
check(
    '开工摘要不再塞入固定设计流程或强制变化指令',
    !/至少两个|不要再交|候选里没有别的角度|必须换图/.test(summary),
    summary
);
check('无历史时摘要为空', summarizeRecentDesignsForModel([], 3) === '');

const capped = Array.from({ length: 25 }).reduce((acc, _, i) => appendDesignFingerprint(acc, fp({ documentName: `x${i}` })), createRecentDesignsLedger());
check('账本上限 20', capped.items.length === 20 && capped.items[0].documentName === 'x5');

if (failed > 0) { console.log(`\n${failed} 项失败`); process.exit(1); }
console.log('\n全部通过');
