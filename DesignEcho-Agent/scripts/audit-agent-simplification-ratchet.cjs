#!/usr/bin/env node
'use strict';

/**
 * Agent 简化债务棘轮（第0步·止血）。
 *
 * 立场（对齐 Anthropic「Building Effective Agents」+ 本仓库 gap 文档的四条元原则）：
 *   - Agency 来自模型，harness 别替模型做决策 → 关键词/正则意图分类是「提示词水管工」反模式，只许减不许增。
 *   - 挂在循环上，不写进循环里 → agent.ts 主循环里的续跑/纠偏/停机分支只许减不许增。
 *
 * 契约（仿 audit:executor-generic 债务棘轮）：
 *   - 每个度量有一个「冻结基线」，当前值必须 ≤ 基线，否则审计失败（拦住「乱堆」）。
 *   - 当一次简化真正减少了某度量，请把该度量的基线**下调到新的当前值**——棘轮只能往下走，
 *     不能让减掉的复杂度又悄悄爬回来。基线上调只允许在有明确评审理由时手动进行。
 *
 * 本审计零行为改动、纯静态计数，供 CI / preflight 常态运行。
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(relPath) {
    return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function countMatches(text, pattern) {
    const matches = text.match(pattern);
    return matches ? matches.length : 0;
}

/**
 * 冻结基线（2026-07-23 测得）。简化后请把对应 baseline 下调到新的当前值。
 * 每个度量注明「减它的方向」，让后来者知道该往哪减、而不是往回堆。
 */
const METRICS = [
    {
        id: 'intent_classifier_regex',
        label: '意图兼容正则用点（2 个 legacy/fallback 文件）',
        baseline: 137,
        reduceHint: '普通自然语言直进主 Agent；继续把 routing/control-plane 中仅服务 legacy 无模型兼容的关键词规则下沉或退役。',
        files: [
            'src/renderer/services/agent-orchestration/routing.ts',
            'src/shared/agent-intent-control-plane.ts'
        ],
        pattern: /\.(test|match|exec)\(|new RegExp/g
    },
    {
        id: 'agent_loop_control_branches',
        label: 'agent.ts 主循环续跑/纠偏/停机分支',
        // 33→24（2026-08-03）：退役根据助手自然语言承诺猜 Tool 的第二恢复 owner。
        // 真实续跑只认结构化 TaskRun / Runtime 阶段义务与显式交付动作。
        // 24→22（2026-08-11）：继续退役根据任务/回复文本与裸文件扩展名猜导出、关档的
        // explicit action recovery；交付义务只由 TaskPlan / Runtime / Tool 结果结构化 owner 提供。
        // 22→21（2026-08-12）：required-tool no-call 计数清理由一个方法所有，Runtime
        // 绑定、run reset 与结果恢复不再各自复制状态写入。
        // 21→17（2026-08-21）：Tool 结果中的 nextRequiredTool* 退出 Recovery Queue；
        // 删除结果级 allowlist、重复 Harness 控制消息和下游兜底合成，选择权交还模型。
        // 17→13（2026-08-21）：退役整个 next-turn Recovery Queue 与 required Tool no-call
        // 调度器；未完成、预检、阶段停滞和活性恢复只反馈事实，不再裁剪下一轮工具面。
        baseline: 13,
        reduceHint: '把续跑/停机收敛到一小组清晰条件；用外化计划替代循环内隐式续跑推力（挂在循环上，不写进循环里）。',
        files: ['src/renderer/services/agent-runtime/agent.ts'],
        pattern: /RecoveryDirective|ReplanAttempt|RemediationAttempt|applyRequired|applyPromised|no\.?progress|NudgeSent/g
    },
    {
        id: 'tool_result_planning_authority',
        label: 'Harness 接管下一轮 Tool 规划的入口',
        baseline: 0,
        reduceHint: '失败结果和未完成义务只能报告事实；不得进入 Recovery Queue、裁剪下一轮工具面、合成 Tool call，或把验收缺口翻译成指定工具/参数。',
        files: [
            'src/renderer/services/agent-runtime/agent.ts',
            'src/renderer/services/agent-policies/design-task-policy.ts',
            'src/renderer/services/agent-runtime/tool-result-sanitizer.ts',
            'src/shared/agent-tool-execution-preflight.ts'
        ],
        pattern: /required_tool_result|applyRequiredToolRecoveryDirective|resolveRequiredToolRecovery|AgentRecoveryQueue|queueRecovery\(|getActiveRecoveryToolNames|handleRequiredToolNoCallConstraint|required_tool_no_call|buildDeterministicCompactE1WorkflowOwnerCall|selectInitialRuntimeE1WorkflowOwnerTools|harness_compact_workflow_owner|hasRecoveryContextForTool|readRequiredToolName|describeSkillNextStep|nextStep:\s*describeSkill|recommendedAction|suggestedObservation|立即调用|下一步再次调用|根据用户原始动作调用|调用 createDocument|调用 get(?:AllTextLayers|DocumentInfo|AnnotatedSnapshot|CanvasSnapshot)/g
    },
    {
        // Agent 是「设计师」不是「工程师」：用户可见文案不得出现 harness / 测试过程话术
        // （处理状态 / 共处理 N 项 / 已到本轮上限 / 判断次数…）。剩余的是解析旧记录用的兼容路径，只许减。
        id: 'user_facing_harness_jargon',
        label: '用户可见生成器里的工程/测试话术（Agent 应像设计师）',
        baseline: 0,
        reduceHint: '结果说明用设计师口吻说「这稿做到哪一步、下一步怎么办」；工具动作计数与阶段/预算术语只留在开发用运行档案，不进用户界面。',
        files: [
            'src/renderer/services/agent-runtime/agent.ts',
            'src/renderer/components/message/parser.ts',
            'src/shared/agent-runtime-v5/runtime-session.ts'
        ],
        pattern: /处理状态：|共处理 \$?\{?[a-z]|[0-9a-zA-Z}]+ 项已处理|[0-9a-zA-Z}]+ 项未完成|本轮处理上限|本轮处理到达上限|判断次数上限|处理动作上限|本轮没有完成有效处理|本轮没有形成可展示/g
    },
    {
        // 设计路径宪法（2026-08-17）：agent.ts 在 07-23→08-17 的 25 天里从 7450 行涨到 13433 行（+80%），
        // 前三个度量却全部持平——增长发生在 stage / 声明 / 门禁 / 读回这些棘轮不数的维度。
        // 主循环文件的体量本身进棘轮：只许减不许增；新能力挂到循环外的注册表 / 数据层，不写进循环里。
        id: 'agent_ts_line_count',
        label: 'agent.ts 主循环文件行数',
        // 13488→13519（2026-08-17 同日，有评审理由的上调）：①模型回合的实时活动带「正在看画面」语义
        // （+7）；②视觉候选额度用尽改为缩略图降级读入而非失明（+21，缩图逻辑本体在 vision-thumbnail.ts
        // 循环外模块）。两者都是「眼睛与可见性」的用户明确诉求，不是新门禁 / 新分支。
        // 13519→13547（2026-08-18，有评审理由的上调）：紧凑工作流「owner 先行」——判据在
        // agent-workflow-continuation-scope.ts（循环外纯逻辑），门禁在 runtime-session.ts 既有返回点内
        // （blockedTool 计数不变），agent.ts 只多一个 8 行的转发方法 + 一条错误文案 + 出口字段透传。
        // 依据：真机 2026-08-18 三次批量任务模型都跳过 owner 直接往只读来源文档上画（宪法三问已答）。
        // 同日 +4：每次模型调用记「提示体量」样本（systemChars / historyChars / toolSchemaChars / tokens）进
        // 运行档案——回答「模型是不是被淹了」要靠数；测量本体在 runtime-accounting.ts（循环外纯逻辑）。
        // 同日 +9：阶段提示里对紧凑工作流明说「owner 会自己读来源、直接调用它」（R2/E1 各一句），
        // 与 owner 先行写入门禁同口径——真机同类任务先看 6–10 轮才轮到 owner。
        // 13547→13570（2026-08-18 晚，有评审理由的上调）：工作流「反复非致命交回却无推进」计入熔断
        //（真机：sku-batch 每次交回「先读模板再申请写入」，模型读一遍再调，无限循环，用户「一直堵着了」）；
        // 两张计数 Map + 一个 countSuccessfulMutations + 交回原因入失败账本，共 +23 行，不新增拦截返回点。
        // 13570→13585（同日，有评审理由）：运行结束（完成/失败/取消/停机）释放文档写入身份，
        // 修「另一个 TaskRun 已持有写入身份」泄漏（真机 15:28 SKU 全败）；+15 行，无新增拦截返回点。
        // 13585→13603（同日，有评审理由）：任务卡 = 完成契约——模型立过卡而清单未达成时不判 completed
        //（用户 08-18「Agent 不知道做到什么程度才算完成」）；只读任务卡账本，不加前置门禁；+18 行。
        // 13604→13606：模型无正文时的兜底改为一句中性短句（用户不要状态口播），+2 行。
        // 13606→13624（2026-08-18 用户拍板「先把底层思维与任务卡落地再让它做设计」）：
        //   injectDesignerOpening——面上有任务卡与车间工具时，开工第一轮先「想、看、立卡」再动手（工作方法提示，不拦工具）。+18 行。
        // 13624→13627（2026-08-19 用户：车间出的稿每次大同小异、没有想法）：开工提示加「先想两个角度选一个」，
        //   并把调用方读出的同项目近期几稿指纹摘要（openingDesignContext）念给模型——摆事实不给方向。+3 行。
        // 13627→13631（2026-08-19 效率）：视觉专家复核调用显式关思考（run 498：每张快照 60–80s、常正文为空）。+4 行注释。
        // 13631→13632（2026-08-19 用户：「说为什么」是底层思维不是单独环节）：开工提示补一句「这不是填表，之后每步都这样开口」。+1 行。
        // 13632→13666（2026-08-19 用户：拿不准就列选项让我选 / 全自动它自己定）：askUserToChoose 返回 userChoiceRequest 时
        //   本轮到此暂停（stopReason awaiting_user_input，选项随最终消息渲染，点选=普通回复继续；不冻结操作、不走续接账本）。+34 行。
        // 13666→13674（2026-08-19 减法+并行）：本会话删执行前同工具熔断器（−15）、读回永久封锁改解锁交底（±0）、
        //   熔断器「前提变了给一次机会」（+12）；余量为并行会话技能目标守卫 rebinding 改动。
        // 13674→13680（2026-08-19）：截断恢复消息在截断发生于工具调用时点名「参数太长、怎么缩」（真机 20 条绝对路径截断循环 5 次）。+6 行。
        // 13680→13688（2026-08-19 用户：重复说重复做）：并行批步骤同名工具合并计数（分析素材内容 ×2）。+8 行。
        // 13688→13707（2026-08-21，上下文容量治理）：模型真实窗口现在统一约束 system、运行上下文、
        // Tool schema、历史与输出预留；Agent 只保留容量计划注入和每轮调用前一处 prepare 接线，
        // 压缩/超限诊断已迁到 context-manager.ts，分配算法在 shared/agent-context-allocation.ts。
        // 不新增意图分类、业务分支或 Tool 门禁。
        // 13707→13554（2026-08-21）：删除 Required Tool Result 规划接管链及其失效的失败摘要辅助方法；
        // 安全门禁仍在执行点，Tool 结果只报告恢复选项，主循环不再强制下一轮工具。
        // 13554→13147（2026-08-21）：删除 AgentRecoveryQueue、required Tool no-call、各恢复源
        // 排队/消费与重复 allowlist 适配；安全读回继续由显式 mutation state + 写锁所有。
        // 13147→13025（2026-08-21）：删除紧凑工作流 Tool call 合成、首轮 owner 工具面裁剪，
        // 以及已经失去调用方的交付工具筛选器；完成补救只回报契约缺口，不再生成工具步骤。
        // 13025→13024（2026-08-21）：预检撞墙仍对用户可见，但原始 blocker 不再经术语替换后直出；
        // 设计师过程投影移到循环外的 agent-user-visible-state.ts，主循环只消费已转换文案。
        // 13024→13023（2026-08-21）：重复失败提示移除内部轮次统计，改为简洁设计进度说明。
        // 13022→13020：请求级性能投影/恢复算法下沉到 performance-ledger 纯函数。
        // 12972→12964（2026-08-24）：未绑定 Runtime Accounting 的 owner 选择下沉到独立薄适配器。
        // 12964→12941（2026-08-24）：交互恢复与 writer 释放判定下沉，主循环只消费结构化结果。
        // 12941→12936（2026-08-25）：参考策略、终审上下文与证据装配继续下沉到独立适配器。
        // 12929→12892（2026-08-25）：终审证据、真实使用视图与 Provider 协议保持在独立 runtime owner，
        // Agent 核心只承接 Profile 元数据与推理偏好，不回填设计决策分支。
        // 12892→12878：视觉预算策略迁出；12878→12876（2026-08-26）：最终文件收集迁至独立运行时模块；
        // 12874→12870（2026-08-27）：Runtime Session 到 workflow continuation 的身份投影下沉到通用契约。
        // 12870→12859（2026-08-27）：交互复入停滞判断与工具失败结果归一迁出主循环，
        // Agent 只在统一执行边界消费两者结果。
        baseline: 12859,
        reduceHint: '把 Stage / 声明 / 读回 / 恢复等子系统从 agent.ts 迁出到独立模块或数据层；新增能力走注册表，不在主循环里长分支。',
        files: ['src/renderer/services/agent-runtime/agent.ts'],
        count: (text) => text.split('\n').length
    },
    {
        // 模型动手前要填的「表」：每多一张表就多一处「填不过就死锁」的可能（真机 08-17 简报表连撞 7 次）。
        id: 'harness_control_tools',
        label: 'Harness 控制/声明工具数量（AGENT_HARNESS_CONTROL_TOOL_NAMES）',
        // 6→7（2026-08-21）：新增只读 Capability 目录检索，把大规模按需能力 schema 从常驻提示移出；
        // 搜索不执行业务动作、不激活能力，收益是首轮 schema 与上下文显著下降。不得再因业务品类增加控制工具。
        baseline: 7,
        reduceHint: '声明是笔记不是门票：合并或退役控制工具，把结构化记录改为可选的 Project State 写入。',
        files: ['src/shared/agent-tool-execution-preflight.ts'],
        count: (text) => {
            const match = text.match(/AGENT_HARNESS_CONTROL_TOOL_NAMES:\s*readonly string\[\]\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\)/);
            if (!match) return 999;
            return countMatches(match[1], /'[A-Za-z]+'|[A-Z_]+_TOOL_NAME/g);
        }
    },
    {
        // 常驻提示只放跨任务不变量；七步法 / 任务卡 / 评审均按需加载。原则越多越会互相稀释；
        // 能进入 Knowledge、引擎或工具结果的内容不写成常驻原则。条数只减不增。
        id: 'design_principle_lines',
        label: '无条件注入的通用设计原则条数（GENERAL_DESIGN_PRINCIPLES）',
        baseline: 6,
        reduceHint: '只保留跨任务不变量；方法论、品类知识和工具用法移到按需上下文。',
        files: ['src/shared/designer-agent-autonomy-principles.ts'],
        count: (text) => {
            const start = text.indexOf('const GENERAL_DESIGN_PRINCIPLES = [');
            if (start < 0) return 999;
            const end = text.indexOf('];', start);
            return countMatches(text.slice(start, end), /\n    '/g);
        }
    },
    {
        // 执行点拦截返回（blockedTool:）的数量：每个都是一堵墙，墙只许拆不许砌。
        // 新增拦截前先问：它拦的是「做错」（不可逆 / 有唯一答案）还是「说错」（应降级为提示）。
        id: 'execution_gate_return_points',
        label: '执行点拦截返回点（blockedTool:）',
        // 19→20（2026-08-19 并行会话）：autonomous executor 技能目标守卫 rebinding 的 block 分支（报错点名可刷新目标的工具）。
        // 20→19（2026-08-24）：waiting/writer/reobserve 结构性阻断统一收口，移除重复返回点。
        // 19→16（2026-08-25）：参考与 Brief 阻断统一委托 runtime-reference-adapter。
        baseline: 16,
        reduceHint: '拦「说错」的门禁降级为事后 warning 或一次性提示；保留的门禁必须声明可达的出口工具。',
        files: [
            'src/renderer/services/agent-runtime/agent.ts',
            'src/renderer/services/agent-runtime/performance-ledger.ts',
            'src/shared/agent-runtime-v5/runtime-session.ts',
            'src/shared/agent-tool-execution-preflight.ts',
            'src/renderer/services/skill-executors/autonomous-agent.executor.ts'
        ],
        pattern: /blockedTool:/g
    }
];

/**
 * 设计路径宪法·不变量（非棘轮，是硬断言）：开放创意清单必须保持 agentic 执行模型。
 * 谁把它改回 staged，就是把「先填三张表才许画第一笔」的门禁重新套到创意路径上。
 */
const AGENTIC_MANIFESTS = [
    'src/shared/agent-runtime-v5/manifests/general-design.manifest.ts',
    'src/shared/agent-runtime-v5/manifests/main-image.manifest.ts',
    'src/shared/agent-runtime-v5/manifests/detail-page.manifest.ts',
    'src/shared/agent-runtime-v5/manifests/single-canvas-visual.manifest.ts',
    'src/shared/agent-runtime-v5/manifests/reference-replication.manifest.ts'
];

let failed = false;
const rows = [];
for (const metric of METRICS) {
    let current = 0;
    for (const file of metric.files) {
        const text = read(file);
        current += typeof metric.count === 'function'
            ? metric.count(text)
            : countMatches(text, metric.pattern);
    }
    const status = current > metric.baseline ? 'FAIL(超基线)'
        : current < metric.baseline ? 'ok(可下调基线)'
            : 'ok(持平)';
    if (current > metric.baseline) failed = true;
    rows.push({ id: metric.id, label: metric.label, baseline: metric.baseline, current, status, reduceHint: metric.reduceHint });
}

console.log('Agent 简化债务棘轮：');
for (const row of rows) {
    console.log(`  [${row.status}] ${row.label}: 当前 ${row.current} / 基线 ${row.baseline}`);
    if (row.status.startsWith('FAIL')) {
        console.error(`    ✗ 又堆复杂度了：不允许新增关键词分类/循环分支。减它的方向 → ${row.reduceHint}`);
    } else if (row.status.startsWith('ok(可下调')) {
        console.log(`    ↓ 已减到 ${row.current}，请把该度量 baseline 下调到 ${row.current}，锁住成果。`);
    }
}

const regressedManifests = AGENTIC_MANIFESTS.filter((file) => (
    !/execution_model:\s*'agentic'/.test(read(file))
));
if (regressedManifests.length > 0) {
    failed = true;
    console.error(`  [FAIL(宪法)] 开放创意清单必须保持 execution_model: 'agentic'，以下清单已回潮为 staged：\n    - ${regressedManifests.join('\n    - ')}`);
} else {
    console.log(`  [ok(宪法)] ${AGENTIC_MANIFESTS.length} 份开放创意清单均为 agentic 执行模型（不建 Stage 机、声明不作写入门票）。`);
}

if (failed) {
    console.error('\n[FAIL] Agent 简化棘轮：检测到复杂度上涨。见上方「减它的方向」。');
    process.exitCode = 1;
} else {
    console.log('\n[OK] Agent 简化棘轮通过：水管工面没有上涨。');
}
