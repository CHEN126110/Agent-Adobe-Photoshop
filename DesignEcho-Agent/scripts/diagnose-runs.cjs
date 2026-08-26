#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * CLI：真实运行诊断（读真机病历，不是 smoke）
 *
 * 数据源（全部是应用真实运行时已经在写的数据，本脚本只读不写）：
 *  1) 会话记录 <userData>/conversations/*.json —— 每条 assistant 消息携带 executionSummary
 *     （status/stopReason/iterations/工具计数/blockers/warnings）。不依赖项目路径，覆盖每一次真实使用。
 *  2) 运行档案 <project>/.designecho/runs/*.json（agent-run-record/v0）—— 含完整工具调用序列，
 *     信息更细，但只在运行携带 projectPath 时才落盘（见 autonomous-agent.executor.ts 的 persistAgentRunRecordSafely）。
 *
 * 用法：
 *   node scripts/diagnose-runs.cjs                 # 最近 10 轮 + 汇总诊断
 *   node scripts/diagnose-runs.cjs --last 30       # 最近 30 轮
 *   node scripts/diagnose-runs.cjs --all           # 全部
 *   node scripts/diagnose-runs.cjs --failed        # 只看未完成的运行
 *   node scripts/diagnose-runs.cjs --trace 48      # 展开第 48 轮的完整工具序列与模型思考
 *   node scripts/diagnose-runs.cjs --json          # 机读输出
 *   node scripts/diagnose-runs.cjs --data <目录>   # 指定 userData 目录
 *   node scripts/diagnose-runs.cjs --project <目录> # 指定项目目录，可重复
 *   node scripts/diagnose-runs.cjs --since 2026-08 # 只统计指定月份
 *
 * 纪律：所有结论只由记录字段直接支撑，并在输出中标注依据字段；不推测未记录的事实。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const APP_DIR_NAME = 'designecho-agent';

/** 停机原因 → 人话 + 严重度。未知原因如实透传，不猜。 */
const STOP_REASON_MEANING = {
    final_response: { text: '模型给出最终答复后自然结束', level: 'info' },
    completed: { text: '任务完成', level: 'info' },
    awaiting_user_confirmation: { text: '停在等待用户确认', level: 'info' },
    awaiting_confirmation: { text: '停在等待确认', level: 'info' },
    awaiting_user_input: { text: '停在等待用户补充输入', level: 'info' },
    cancelled: { text: '被取消', level: 'info' },
    max_iterations: { text: '迭代次数用尽（循环上限）', level: 'severe' },
    performance_budget: { text: '性能预算耗尽（时间/调用预算烧完）', level: 'severe' },
    tool_budget_final_response: { text: '工具预算耗尽后被迫收尾', level: 'severe' },
    no_progress: { text: '连续无进展被判停', level: 'severe' },
    tool_preflight_blocked: { text: '工具预检拦截，无法继续', level: 'severe' },
    plan_execution_mismatch: { text: '计划与执行对不上被判停', level: 'severe' },
    provider_output_truncated: { text: '模型输出被截断', level: 'severe' },
    provider_output_blocked: { text: '模型服务拦截了输出', level: 'severe' },
    empty_final_response: { text: '模型最终答复为空', level: 'severe' },
    error: { text: '运行异常终止', level: 'severe' },
    failed: { text: '运行失败', level: 'severe' }
};

function resolveUserDataDir(explicit) {
    if (explicit) return path.resolve(explicit);
    if (process.platform === 'win32') {
        const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
        return path.join(appData, APP_DIR_NAME);
    }
    if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', APP_DIR_NAME);
    }
    return path.join(os.homedir(), '.config', APP_DIR_NAME);
}

/** 时间戳归一：记录里同时存在秒级数字、毫秒级数字与 ISO 串。 */
function normalizeTimestamp(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value < 1e12 ? value * 1000 : value;
    }
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : 0;
}

function formatTime(ms) {
    if (!ms) return '(无时间)';
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function oneLine(value, maxLength) {
    const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function readJsonSafely(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return null;
    }
}

function normalizeExistingDirectory(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const resolved = path.resolve(text);
    try {
        return fs.statSync(resolved).isDirectory() ? resolved : '';
    } catch {
        return '';
    }
}

function dedupePaths(values) {
    const seen = new Set();
    const output = [];
    for (const value of values) {
        const resolved = normalizeExistingDirectory(value);
        if (!resolved) continue;
        const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
        if (seen.has(key)) continue;
        seen.add(key);
        output.push(resolved);
    }
    return output;
}

function collectProjectPathsFromValue(value, output, seenObjects) {
    if (value == null || typeof value !== 'object') return;
    if (seenObjects.has(value)) return;
    seenObjects.add(value);
    if (Array.isArray(value)) {
        for (const item of value) collectProjectPathsFromValue(item, output, seenObjects);
        return;
    }
    for (const [key, child] of Object.entries(value)) {
        if (key === 'projectPath' && typeof child === 'string') {
            const resolved = normalizeExistingDirectory(child);
            if (resolved) output.push(resolved);
            continue;
        }
        collectProjectPathsFromValue(child, output, seenObjects);
    }
}

/**
 * 会话中的稳定项目来源位于 agentRequestLifecycle.context.projectPath；旧消息还可能在
 * project context 或 diagnostic 子树中保存同名字段，因此统一递归读取，但只接受现存目录。
 */
function collectHistoricalProjectPaths(userDataDir) {
    const convDir = path.join(userDataDir, 'conversations');
    if (!fs.existsSync(convDir)) return [];
    const candidates = [];
    for (const name of fs.readdirSync(convDir).filter((file) => file.endsWith('.json'))) {
        const document = readJsonSafely(path.join(convDir, name));
        if (!document) continue;
        collectProjectPathsFromValue(document, candidates, new WeakSet());
    }
    return dedupePaths(candidates);
}

function hasDirectProjectRunArchive(projectPath) {
    return fs.existsSync(path.join(projectPath, '.designecho', 'runs'));
}

/**
 * 历史会话可能只覆盖同一项目集合的一部分。若多个已知项目共享一个父目录，而且该父目录
 * 直接包含带运行档案的项目，则扫描这一层项目集合；不递归到磁盘根或任意祖先目录。
 */
function inferProjectCollectionRoots(projectPaths) {
    const parentCounts = new Map();
    for (const projectPath of projectPaths) {
        const parent = path.dirname(projectPath);
        if (!parent || parent === projectPath) continue;
        const key = process.platform === 'win32' ? parent.toLowerCase() : parent;
        const current = parentCounts.get(key) || { path: parent, count: 0 };
        current.count += 1;
        parentCounts.set(key, current);
    }
    const inferred = [];
    for (const candidate of parentCounts.values()) {
        if (candidate.count < 2) continue;
        let children = [];
        try {
            children = fs.readdirSync(candidate.path, { withFileTypes: true });
        } catch {
            continue;
        }
        if (children.some((entry) => (
            entry.isDirectory()
            && hasDirectProjectRunArchive(path.join(candidate.path, entry.name))
        ))) {
            inferred.push(candidate.path);
        }
    }
    return dedupePaths(inferred);
}

function resolveRunRecordSearchRoots(input) {
    const explicitProjectRoots = dedupePaths(input.explicitProjectRoots || []);
    if (explicitProjectRoots.length > 0) {
        return {
            roots: explicitProjectRoots,
            source: 'command_line_projects'
        };
    }
    const historicalProjectPaths = collectHistoricalProjectPaths(input.userDataDir);
    const collectionRoots = inferProjectCollectionRoots(historicalProjectPaths);
    if (collectionRoots.length > 0) {
        return {
            roots: collectionRoots,
            source: 'conversation_project_collections'
        };
    }
    if (historicalProjectPaths.length > 0) {
        return {
            roots: historicalProjectPaths,
            source: 'conversation_projects'
        };
    }
    return {
        roots: dedupePaths([input.repositoryRoot]),
        source: 'repository_fallback'
    };
}

function parseYearMonth(value) {
    const text = String(value || '').trim();
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(text);
    if (!match) return null;
    return { year: Number(match[1]), month: Number(match[2]) };
}

function matchesYearMonth(value, filter) {
    if (!filter) return true;
    const timestamp = normalizeTimestamp(value);
    if (!timestamp) return false;
    const date = new Date(timestamp);
    return date.getFullYear() === filter.year && date.getMonth() + 1 === filter.month;
}

/** 从会话文件抽取运行：一条带 executionSummary 的 assistant 消息 = 一次运行。 */
function collectRunsFromConversations(userDataDir) {
    const convDir = path.join(userDataDir, 'conversations');
    if (!fs.existsSync(convDir)) {
        return { runs: [], sourceDir: convDir, fileCount: 0, missing: true };
    }
    const files = fs.readdirSync(convDir).filter((name) => name.endsWith('.json'));
    const runs = [];
    for (const name of files) {
        const doc = readJsonSafely(path.join(convDir, name));
        if (!doc) continue;
        for (const conv of doc.conversations || []) {
            const messages = conv.messages || [];
            for (let i = 0; i < messages.length; i += 1) {
                const message = messages[i];
                if (!message || !message.executionSummary) continue;
                let goal = '';
                for (let j = i - 1; j >= 0; j -= 1) {
                    if (messages[j] && messages[j].role === 'user') {
                        goal = String(messages[j].content || '');
                        break;
                    }
                }
                runs.push({
                    at: normalizeTimestamp(message.timestamp || conv.updatedAt),
                    conversationTitle: conv.title || '',
                    goal,
                    summary: message.executionSummary,
                    diagnostic: message.agentDiagnosticRecord || null,
                    steps: Array.isArray(message.thinkingSteps) ? message.thinkingSteps : [],
                    replyText: String(message.content || '')
                });
            }
        }
    }
    runs.sort((a, b) => a.at - b.at);
    // 全局序号一次定死：无论后续如何过滤，--trace 与列表里的编号始终指向同一轮运行。
    runs.forEach((run, i) => { run.index = i + 1; });
    return { runs, sourceDir: convDir, fileCount: files.length, missing: false };
}

/**
 * 收集意图路由决策（--routes）。
 *
 * 数据源同样是应用早就在写的字段：每条 assistant 消息的 agentRequestLifecycle.decision
 * （谁做的决策、选了哪个技能）与 agentDiagnosticRecord.agentIntentDeliberationGate
 * （模型是否被咨询过）。此前无人读取，于是「关键词判错了多少」始终是争论而非事实。
 */
function collectRouteDecisions(userDataDir) {
    const convDir = path.join(userDataDir, 'conversations');
    if (!fs.existsSync(convDir)) return { decisions: [], sourceDir: convDir, missing: true };
    const decisions = [];
    for (const name of fs.readdirSync(convDir).filter((n) => n.endsWith('.json'))) {
        const doc = readJsonSafely(path.join(convDir, name));
        if (!doc) continue;
        for (const conv of doc.conversations || []) {
            const messages = conv.messages || [];
            for (let i = 0; i < messages.length; i += 1) {
                const message = messages[i];
                const lifecycle = message && message.agentRequestLifecycle;
                if (!lifecycle || !lifecycle.decision) continue;
                let userText = '';
                for (let j = i - 1; j >= 0; j -= 1) {
                    if (messages[j] && messages[j].role === 'user') {
                        userText = String(messages[j].content || '').trim();
                        break;
                    }
                }
                const plan = message.agentTaskPlan || {};
                const gate = (message.agentDiagnosticRecord || {}).agentIntentDeliberationGate || {};
                decisions.push({
                    at: normalizeTimestamp(message.timestamp || conv.updatedAt),
                    userText,
                    source: lifecycle.decision.source || '(缺失)',
                    route: lifecycle.decision.route || '(缺失)',
                    skillId: lifecycle.decision.skillId || '',
                    selectedSkillId: lifecycle.decision.selectedSkillId || '',
                    requestKind: plan.requestKind || '',
                    planStatus: plan.status || '',
                    scenario: (plan.designBrief || {}).scenario || '',
                    modelConsulted: gate.modelConsulted === true,
                    gateStatus: gate.status || ''
                });
            }
        }
    }
    decisions.sort((a, b) => a.at - b.at);
    decisions.forEach((d, i) => { d.index = i + 1; });
    return { decisions, sourceDir: convDir, missing: false };
}

/**
 * 优先加载运行时真正在用的判据（shared/agent-negation-intent.ts），保证体检结论与线上同口径。
 * 只在 --routes 时懒加载 ts-node，不拖慢其它模式；加载失败则退回下面的内置副本，工具仍可用。
 */
let cachedNegationJudge;
function resolveNegationJudge() {
    if (cachedNegationJudge !== undefined) return cachedNegationJudge;
    try {
        require('ts-node').register({
            transpileOnly: true,
            project: path.resolve(__dirname, '..', 'tsconfig.main.json')
        });
        const mod = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-negation-intent.ts'));
        cachedNegationJudge = typeof mod.blocksDeterministicRouteByNegation === 'function'
            ? mod.blocksDeterministicRouteByNegation
            : null;
    } catch {
        cachedNegationJudge = null;
    }
    return cachedNegationJudge;
}

/**
 * 叫停类指令判据。运行时模块可用时直接复用它（单一口径）；不可用时退回内置副本。
 * 回答一个具体问题：用户明确叫停时，路由是否仍然直接选了技能。
 */
function looksLikeStopInstructionFallback(text) {
    const compact = String(text || '').replace(/\s+/g, '');
    if (!compact) return false;
    const negated = /(?:不要|不用|不必|无需|别|先别|先不要|先不|暂时不|暂不|不再|别再|不想|不打算)[^，,。！？!?；;\n]{0,6}(?:做|搞|弄|处理|生成|制作|设计|执行|继续|开始|动手|出图|排版|跑)/;
    const cancel = /(?:取消|停止|中止|终止|撤销|作废|算了|不做了|别做了|停下|打住)/;
    const cancelOperation = /(?:取消|停止|撤销)\s*(?:编组|群组|分组|选择|选中|显示|隐藏|锁定|链接|蒙版|图层样式|填充|描边|裁剪|选区)/;
    const positiveBefore = (pattern) => {
        const m = compact.match(pattern);
        if (!m || (m.index ?? 0) <= 0) return false;
        return /(?:做|搞|弄|生成|制作|设计|画|排版|导出|整理|分析|检查|读取|看看|帮我|处理|执行|创建|新建|修改|调整|替换)/
            .test(compact.slice(0, m.index));
    };
    if (negated.test(compact) && !positiveBefore(negated)) return true;
    return cancel.test(compact) && !cancelOperation.test(compact) && !positiveBefore(cancel);
}

function looksLikeStopInstruction(text) {
    const judge = resolveNegationJudge();
    return judge ? Boolean(judge(text)) : looksLikeStopInstructionFallback(text);
}

function printRouteReport(decisions, limit) {
    const shown = limit > 0 ? decisions.slice(-limit) : decisions;
    console.log(`\n意图路由决策（显示最近 ${shown.length} / 共 ${decisions.length} 次）\n`);
    for (const d of shown) {
        const stop = looksLikeStopInstruction(d.userText);
        const chose = d.selectedSkillId || d.skillId;
        const routedToSkill = Boolean(chose) && chose !== 'autonomous-agent';
        const mark = stop && routedToSkill ? '🔴' : (d.modelConsulted ? 'ℹ️' : '🟡');
        console.log(`${mark} [${d.index}] ${formatTime(d.at)}  ${oneLine(d.userText, 46) || '(无用户消息)'}`);
        console.log(`     判定=${d.source}  路由=${d.route}  技能=${chose || '(无)'}`
            + `  模型参与=${d.modelConsulted ? '是' : '否'}${d.scenario ? `  场景=${d.scenario}` : ''}`);
        if (stop && routedToSkill) {
            console.log(`     🔴 用户在叫停，路由却仍直接选了技能「${chose}」   [依据 用户原文 + decision.selectedSkillId]`);
        }
    }

    const total = decisions.length;
    // 主口径取 decision.source：agentIntentDeliberationGate.modelConsulted 字段只在部分路径写入
    // （真机覆盖率约 15%），拿它当分母会得出「模型 100% 未参与」这种失真结论。
    const modelRouted = decisions.filter((d) => d.source === 'model_router').length;
    const gateRecorded = decisions.filter((d) => d.gateStatus).length;
    const stopInstructions = decisions.filter((d) => looksLikeStopInstruction(d.userText));
    const stopMisrouted = stopInstructions.filter((d) => {
        const chose = d.selectedSkillId || d.skillId;
        return Boolean(chose) && chose !== 'autonomous-agent';
    });
    const pct = (n) => (total ? `${Math.round((n / total) * 100)}%` : '—');
    console.log('\n' + '━'.repeat(72));
    console.log(`路由质量汇总（${total} 次决策）`);
    console.log('━'.repeat(72));
    console.log(`  模型参与路由      ${modelRouted} / ${total}  (${pct(modelRouted)})   依据 decision.source === 'model_router'`);
    console.log(`  确定性规则判定    ${total - modelRouted} / ${total}  (${pct(total - modelRouted)})`);
    console.log(`  （modelConsulted 字段仅 ${gateRecorded} 条有记录，覆盖率不足，不作主口径）`);
    console.log(`  叫停类指令        ${stopInstructions.length} 次`);
    console.log(`  其中仍被选了技能  ${stopMisrouted.length} 次   ← 这类是关键词读不出否定的直接证据`);
    console.log('\n  判定来源分布：' + tally(decisions, (d) => d.source).map(([k, v]) => `${k}=${v}`).join('  '));
    console.log('  路由分布：      ' + tally(decisions, (d) => d.route).map(([k, v]) => `${k}=${v}`).join('  '));
    const skillTally = tally(decisions.filter((d) => d.selectedSkillId || d.skillId), (d) => d.selectedSkillId || d.skillId).slice(0, 8);
    if (skillTally.length) console.log('  选中技能：      ' + skillTally.map(([k, v]) => `${k}=${v}`).join('  '));
    if (stopMisrouted.length) {
        console.log('\n  被误路由的叫停指令：');
        for (const d of stopMisrouted.slice(-6)) {
            console.log(`     [${d.index}] ${oneLine(d.userText, 40)} → ${d.selectedSkillId || d.skillId}`);
        }
    }
}

/** 附带扫描运行档案（含完整工具序列），用于补充单轮细节。 */
function collectRunRecords(searchRoots, sinceFilter) {
    const records = [];
    const scanResults = [];
    const seenFiles = new Set();
    for (const root of searchRoots) {
        const beforeCount = records.length;
        if (fs.existsSync(root)) {
            walkForRunsDir(root, 0, records, seenFiles, sinceFilter);
        }
        scanResults.push({ root, count: records.length - beforeCount });
    }
    records.sort((a, b) => normalizeTimestamp(a.endedAt) - normalizeTimestamp(b.endedAt));
    records.forEach((record, index) => { record.__index = index + 1; });
    return { records, scanResults };
}

function walkForRunsDir(dir, depth, out, seenFiles, sinceFilter) {
    if (depth > 5) return;
    let entries = [];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        const child = path.join(dir, entry.name);
        if (entry.name === '.designecho') {
            const runsDir = path.join(child, 'runs');
            if (fs.existsSync(runsDir)) {
                for (const file of fs.readdirSync(runsDir)) {
                    if (!file.startsWith('run-') || !file.endsWith('.json')) continue;
                    const filePath = path.join(runsDir, file);
                    let realPath = filePath;
                    try {
                        realPath = fs.realpathSync(filePath);
                    } catch {
                        // 读取时会再次校验文件；这里保留规范化绝对路径用于去重。
                    }
                    const dedupeKey = process.platform === 'win32'
                        ? realPath.toLowerCase()
                        : realPath;
                    if (seenFiles.has(dedupeKey)) continue;
                    const record = readJsonSafely(filePath);
                    if (record
                        && record.version === 'agent-run-record/v0'
                        && matchesYearMonth(record.endedAt, sinceFilter)) {
                        seenFiles.add(dedupeKey);
                        records_push(out, record, filePath);
                    }
                }
            }
            continue;
        }
        walkForRunsDir(child, depth + 1, out, seenFiles, sinceFilter);
    }
}

function records_push(out, record, filePath) {
    out.push(Object.assign({}, record, { __file: filePath }));
}

function normalizeRecordTextList(value) {
    const values = Array.isArray(value) ? value : (value == null ? [] : [value]);
    return values
        .map((item) => String(item || '').trim())
        .filter(Boolean);
}

function resolveRecordExecutionStatus(record) {
    const recordedStatus = String(record?.quality?.executionStatus || '').trim();
    if (recordedStatus === 'failed_before_tool_call') return 'failed';
    if (recordedStatus) return recordedStatus;
    if (record?.success === true) return 'completed';
    if (record?.stopReason === 'cancelled') return 'cancelled';
    if (record?.stopReason === 'awaiting_user_confirmation') return 'awaiting_confirmation';
    if (record?.stopReason === 'awaiting_user_input') return 'needs_review';
    return 'failed';
}

/**
 * agent-run-record/v0 是诊断的主数据源。这里把档案事实投影成现有列表/汇总结构，
 * 不从会话摘要补写不存在的字段，也不把等待确认误写成 completed。
 */
function mapRunRecordToRun(record) {
    const toolCalls = Array.isArray(record.toolCalls) ? record.toolCalls : [];
    const successfulToolCalls = toolCalls.filter((call) => call?.success !== false).length;
    const failedToolCalls = toolCalls.filter((call) => call?.success === false).length;
    const successfulMutationCalls = Number(
        record?.checkpoint?.activityCounts?.mutation?.successful
        ?? toolCalls.filter((call) => call?.success !== false && call?.activityClass === 'mutation').length
    );
    const observedMutationCalls = toolCalls.filter((call) => (
        call?.success === true
        && call?.activityClass === 'mutation'
        && (
            call?.photoshopMutationCommit?.mutationObserved === true
            || call?.photoshopHistoryTransition?.mutationObserved === true
        )
    )).length;
    const committedMutationCalls = toolCalls.filter((call) => (
        call?.success === true
        && call?.activityClass === 'mutation'
        && call?.photoshopMutationCommit?.mutationObserved === true
        && call?.photoshopMutationCommit?.toolActionCompleted === true
    )).length;
    const successfulObservationCalls = Number(
        record?.checkpoint?.activityCounts?.observation?.successful
        ?? toolCalls.filter((call) => call?.success !== false && call?.activityClass === 'observation').length
    );
    const lastFailedCall = [...toolCalls].reverse().find((call) => call?.success === false);
    const harnessActionCount = toolCalls.filter((call) => /^harness_/i.test(String(call?.origin || ''))).length;
    const firstObservedMutationCall = toolCalls.find(
        (call) => call?.success === true
            && call?.activityClass === 'mutation'
            && (
                call?.photoshopMutationCommit?.mutationObserved === true
                || call?.photoshopHistoryTransition?.mutationObserved === true
            )
    );
    const writeExpected = Boolean(String(record?.runtimeSession?.taskType || '').trim())
        || toolCalls.some((call) => call?.activityClass === 'mutation');
    const warnings = normalizeRecordTextList(record.warnings);
    const blockers = normalizeRecordTextList(record.blockers);
    return {
        at: normalizeTimestamp(record.endedAt),
        index: record.__index,
        conversationTitle: '',
        goal: String(record.goal || ''),
        diagnostic: null,
        steps: [],
        replyText: '',
        source: 'agent-run-record/v0',
        record,
        summary: {
            success: record.success === true,
            status: resolveRecordExecutionStatus(record),
            stopReason: String(record.stopReason || ''),
            iterations: Number(record.iterations || 0),
            toolCallCount: toolCalls.length,
            successfulToolCalls,
            failedToolCalls,
            successfulMutationCalls,
            observedMutationCalls,
            committedMutationCalls,
            writeExpected,
            successfulObservationCalls,
            businessActionCount: Math.max(0, toolCalls.length - harnessActionCount),
            harnessActionCount,
            lastToolName: String(record?.checkpoint?.lastToolName || toolCalls.at(-1)?.name || ''),
            lastError: String(lastFailedCall?.summary || lastFailedCall?.code || ''),
            firstMutationSeq: Number(firstObservedMutationCall?.seq || 0),
            firstMutationToolName: String(firstObservedMutationCall?.name || ''),
            firstMutationElapsedMs: typeof firstObservedMutationCall?.elapsedMs === 'number'
                ? firstObservedMutationCall.elapsedMs
                : undefined,
            blockers,
            warnings
        }
    };
}

/**
 * 单轮诊断：每条结论都指名依据字段，字段缺失就不下结论。
 */
function diagnoseRun(run) {
    const s = run.summary || {};
    const findings = [];
    const push = (level, text, basis) => findings.push({ level, text, basis });

    const stop = STOP_REASON_MEANING[s.stopReason];
    if (stop && stop.level === 'severe') {
        push('severe', stop.text, `stopReason=${s.stopReason}`);
    }
    if (s.status === 'failed' && !stop) {
        push('severe', '运行失败', `status=failed, stopReason=${s.stopReason || '(缺失)'}`);
    }

    const blockers = Array.isArray(s.blockers) ? s.blockers : [];
    if (blockers.length) {
        push('severe', `${blockers.length} 条阻塞：${oneLine(blockers[0], 70)}`, 'blockers[]');
    }

    const mutations = Number(s.observedMutationCalls || 0);
    const iterations = Number(s.iterations || 0);
    const toolCalls = Number(s.toolCallCount || 0);
    const failedCalls = Number(s.failedToolCalls || 0);

    if (s.writeExpected === true && s.status === 'completed' && mutations === 0) {
        push('warn', '需要写入的运行判定为完成，但没有 Photoshop history/commit 证明真实写入',
            'status=completed, observedMutationCalls=0');
    }
    if (s.writeExpected === true && mutations === 0 && iterations >= 8) {
        push('warn', `迭代 ${iterations} 轮但没有真实写入`, `iterations=${iterations}, observedMutationCalls=0`);
    }
    if (failedCalls > 0) {
        push('warn', `${failedCalls} 次工具调用失败${s.lastError ? `，末次错误：${oneLine(s.lastError, 60)}` : ''}`,
            'failedToolCalls, lastError');
    }
    if (toolCalls > 0 && iterations > 0 && iterations >= toolCalls * 2 && iterations >= 6) {
        push('warn', `迭代 ${iterations} 轮只发出 ${toolCalls} 次工具调用，多数轮次没有动作`,
            `iterations=${iterations}, toolCallCount=${toolCalls}`);
    }
    const harness = Number(s.harnessActionCount || 0);
    const business = Number(s.businessActionCount || 0);
    if (harness > 0 && business === 0) {
        push('warn', `只有 ${harness} 次 Harness 动作、0 次业务动作`, 'harnessActionCount, businessActionCount=0');
    }
    if (Number(s.noDocumentChangeRisks || 0) > 0) {
        push('warn', `${s.noDocumentChangeRisks} 次调用被判定未产生文档变更`, 'noDocumentChangeRisks');
    }
    if (Number(s.acceptanceFailed || 0) > 0) {
        push('severe', `${s.acceptanceFailed} 项验收未通过`, 'acceptanceFailed');
    }
    const warnings = Array.isArray(s.warnings) ? s.warnings : [];
    if (warnings.length) {
        push('info', `${warnings.length} 条提醒：${oneLine(warnings[0], 60)}`, 'warnings[]');
    }
    if (stop && stop.level === 'info' && !findings.length) {
        push('info', stop.text, `stopReason=${s.stopReason}`);
    }
    return findings;
}

function severityOf(findings) {
    if (findings.some((f) => f.level === 'severe')) return 'severe';
    if (findings.some((f) => f.level === 'warn')) return 'warn';
    return 'info';
}

const MARK = { severe: '🔴', warn: '🟡', info: 'ℹ️' };

function tally(items, pick) {
    const out = new Map();
    for (const item of items) {
        const key = pick(item) ?? '(缺失)';
        out.set(key, (out.get(key) || 0) + 1);
    }
    return [...out.entries()].sort((a, b) => b[1] - a[1]);
}

/**
 * 疑似能力误判（治理切片 9 收敛指标「误判『我不会』次数」的启发式计数）。
 * 只做候选圈定、绝不自动定罪：零写入 + 无阻塞 + 非严重停机（自然结束却什么都没做），
 * 且至少命中一条结构化能力信号——model_access 类 provider 失败、能力类失败码、
 * 或 warning 文本出现「不会/无法/做不到/没有能力」等措辞。每一项都需要人工确认。
 */
function detectCapabilityDenialSuspects(runs) {
    const suspects = [];
    for (const run of runs) {
        const s = run.summary || {};
        if (Number(s.observedMutationCalls || 0) > 0) continue;
        const blockers = Array.isArray(s.blockers) ? s.blockers : [];
        if (blockers.length > 0) continue;
        const stop = STOP_REASON_MEANING[s.stopReason];
        if (stop && stop.level === 'severe') continue;
        const record = run.record || {};
        const signals = [];
        if (record.providerFailure && record.providerFailure.kind === 'model_access') {
            signals.push('providerFailure=model_access');
        }
        if (!signals.length) {
            const call = (Array.isArray(record.toolCalls) ? record.toolCalls : []).find((item) => (
                item && item.success === false
                && /no_usable_model|model[_\s-](?:unavailable|not[_\s-]?supported|does_not_support)|capabilit(?:y|ies)[_\s-]*(?:missing|unsupported|denied)|tool[_\s-]not[_\s-]found/i.test(String(item.code || ''))
            ));
            if (call) signals.push(`code=${call.name}:${call.code}`);
        }
        if (!signals.length) {
            const warningText = (Array.isArray(s.warnings) ? s.warnings : []).join(' ');
            if (/不会|无法|做不到|不能完成|没有.{0,6}(?:能力|权限|权限不足)|不具备.{0,6}(?:能力|权限)|no_usable_model/i.test(warningText)) {
                signals.push('warning=capability-denial');
            }
        }
        if (signals.length) {
            suspects.push({
                index: run.index,
                goal: run.goal,
                signal: signals[0],
                stopReason: s.stopReason || '(无)'
            });
        }
    }
    return suspects;
}

function buildAggregate(runs) {
    const total = runs.length;
    const statusTally = tally(runs, (r) => r.summary.status);
    const stopTally = tally(runs, (r) => r.summary.stopReason);
    const writeExpectedRuns = runs.filter((r) => r.summary.writeExpected === true);
    const zeroMutation = writeExpectedRuns.filter((r) => Number(r.summary.observedMutationCalls || 0) === 0);
    const completed = runs.filter((r) => r.summary.status === 'completed');
    const successful = runs.filter((r) => (
        r.summary.success === true
        || (r.summary.success === undefined && r.summary.status === 'completed')
    ));
    const withBlockers = runs.filter((r) => (r.summary.blockers || []).length > 0);
    const budgetExhausted = runs.filter((r) => {
        const meaning = STOP_REASON_MEANING[r.summary.stopReason];
        return meaning && meaning.level === 'severe';
    });
    // 历史大盘只用于找病例，不是固定 Case 成功率。这里仍坚持 history/commit
    // mutationObserved 才算真实 Photoshop 写入，写类 Tool success 单独保留作兼容诊断。
    const completedWithWrites = completed.filter(
        (r) => Number(r.summary.observedMutationCalls || 0) > 0
    );
    const totalSuccessfulMutations = runs.reduce(
        (sum, run) => sum + Number(run.summary.observedMutationCalls || 0), 0
    );
    const totalWriteToolSuccesses = runs.reduce(
        (sum, run) => sum + Number(run.summary.successfulMutationCalls || 0), 0
    );
    const totalObservationCalls = runs.reduce(
        (sum, run) => sum + Number(run.summary.successfulObservationCalls || 0), 0
    );
    const totalBusinessActions = runs.reduce(
        (sum, run) => sum + Number(run.summary.businessActionCount || 0), 0
    );
    // 收敛指标（治理切片 9）：首次成功写入延迟——只统计带时序的新档案，覆盖率如实上报。
    const firstWriteLatencyValues = runs
        .filter((run) => Number(run.summary.observedMutationCalls || 0) > 0)
        .map((run) => run.summary.firstMutationElapsedMs)
        .filter((value) => typeof value === 'number' && Number.isFinite(value))
        .sort((a, b) => a - b);
    const capabilityDenialSuspects = detectCapabilityDenialSuspects(runs);
    return {
        total,
        statusTally,
        stopTally,
        successfulCount: successful.length,
        completedCount: completed.length,
        totalToolCalls: runs.reduce((sum, run) => sum + Number(run.summary.toolCallCount || 0), 0),
        failedToolCalls: runs.reduce((sum, run) => sum + Number(run.summary.failedToolCalls || 0), 0),
        zeroMutationCount: zeroMutation.length,
        writeExpectedCount: writeExpectedRuns.length,
        zeroMutationCompletedCount: completed.filter((r) => (
            r.summary.writeExpected === true && Number(r.summary.observedMutationCalls || 0) === 0
        )).length,
        completedWithWritesCount: completedWithWrites.length,
        totalSuccessfulMutations,
        totalWriteToolSuccesses,
        totalObservationCalls,
        totalBusinessActions,
        withBlockersCount: withBlockers.length,
        budgetExhaustedCount: budgetExhausted.length,
        firstWriteLatencyValues,
        firstWriteLatencyCoverage: {
            withWrites: runs.filter((run) => Number(run.summary.observedMutationCalls || 0) > 0).length,
            withTiming: firstWriteLatencyValues.length
        },
        capabilityDenialSuspects,
        lastToolTally: tally(runs.filter((r) => r.summary.lastToolName), (r) => r.summary.lastToolName).slice(0, 6)
    };
}

function median(values) {
    if (!values.length) return null;
    const mid = Math.floor(values.length / 2);
    return values.length % 2 === 1 ? values[mid] : Math.round((values[mid - 1] + values[mid]) / 2);
}

function percentile(values, ratio) {
    if (!values.length) return null;
    const index = Math.min(values.length - 1, Math.floor(values.length * ratio));
    return values[index];
}

function formatDuration(ms) {
    if (ms === null || ms === undefined) return '—';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s`;
}

function printRun(run) {
    const s = run.summary;
    const findings = diagnoseRun(run);
    const mark = MARK[severityOf(findings)];
    console.log(`\n${mark} [${run.index}] ${formatTime(run.at)}  ${s.status || '(无状态)'} / ${s.stopReason || '(无停机原因)'}`);
    console.log(`   目标  ${oneLine(run.goal, 84) || '(未记录用户消息)'}`);
    console.log(`   计数  迭代 ${s.iterations || 0} · 工具 ${s.toolCallCount || 0}（成功 ${s.successfulToolCalls || 0} / 失败 ${s.failedToolCalls || 0}）`
        + ` · 写类成功 ${s.successfulMutationCalls || 0} / 真实写入 ${s.observedMutationCalls || 0}`
        + ` · 观察 ${s.successfulObservationCalls || 0}`
        + ` · 业务 ${s.businessActionCount || 0} / Harness ${s.harnessActionCount || 0}`);
    if (s.lastToolName) console.log(`   末工具 ${s.lastToolName}${s.lastError ? ` · 错误：${oneLine(s.lastError, 56)}` : ''}`);
    if (s.summaryText) console.log(`   回复  ${oneLine(s.summaryText, 84)}`);
    for (const f of findings) {
        console.log(`   ${MARK[f.level]} ${f.text}   [依据 ${f.basis}]`);
    }
}

function printAggregate(agg, runs) {
    const pct = (n) => (agg.total ? `${Math.round((n / agg.total) * 100)}%` : '—');
    console.log('\n' + '━'.repeat(72));
    console.log(`汇总（${agg.total} 次真实运行）`);
    console.log('━'.repeat(72));
    console.log(`  成功运行        ${agg.successfulCount} / ${agg.total}  (${pct(agg.successfulCount)})   依据 agent-run-record.success`);
    console.log(`  完成状态        ${agg.completedCount} / ${agg.total}  (${pct(agg.completedCount)})   等待确认可 success=true，但不冒充 completed`);
    console.log(`  工具调用        ${agg.totalToolCalls}，失败 ${agg.failedToolCalls}`);
    console.log(`  需写入且零实写  ${agg.zeroMutationCount} / ${agg.writeExpectedCount}   依据 taskType/写调用存在且 observedMutationCalls=0`);
    console.log(`  声称完成但零实写 ${agg.zeroMutationCompletedCount}                依据 status=completed 且 observedMutationCalls=0`);
    console.log(`  完成且有真实写入 ${agg.completedWithWritesCount} / ${agg.total}  (${pct(agg.completedWithWritesCount)})   依据 Photoshop history/commit mutationObserved=true【历史大盘，非固定 Case 成功率】`);
    console.log(`  真实写入合计    ${agg.totalSuccessfulMutations} 次 · 写类 Tool success ${agg.totalWriteToolSuccesses} 次 · 观察调用 ${agg.totalObservationCalls} 次 / 业务动作 ${agg.totalBusinessActions} 次`);
    const firstWriteMedian = median(agg.firstWriteLatencyValues);
    const firstWriteP90 = percentile(agg.firstWriteLatencyValues, 0.9);
    console.log(`  首次写入延迟    中位 ${formatDuration(firstWriteMedian)} / P90 ${formatDuration(firstWriteP90)}   时序覆盖 ${agg.firstWriteLatencyCoverage.withTiming}/${agg.firstWriteLatencyCoverage.withWrites}（有写入运行中带时序档案的比例）【收敛指标】`);
    console.log(`  疑似能力误判    ${agg.capabilityDenialSuspects.length} / ${agg.total}  (${pct(agg.capabilityDenialSuspects.length)})   依据 零写入+无阻塞+自然停机+能力信号，需人工确认【收敛指标】`);
    console.log(`  预算/空转耗尽    ${agg.budgetExhaustedCount} / ${agg.total}  (${pct(agg.budgetExhaustedCount)})   依据 stopReason 属严重类`);
    console.log(`  带阻塞           ${agg.withBlockersCount} / ${agg.total}  (${pct(agg.withBlockersCount)})   依据 blockers[]`);
    console.log('\n  status 分布：   ' + agg.statusTally.map(([k, v]) => `${k}=${v}`).join('  '));
    console.log('  stopReason 分布：');
    for (const [reason, count] of agg.stopTally) {
        const meaning = STOP_REASON_MEANING[reason];
        console.log(`     ${String(count).padStart(3)} × ${reason}${meaning ? `  — ${meaning.text}` : ''}`);
    }
    if (agg.lastToolTally.length) {
        console.log('  停在哪个工具（lastToolName）：' + agg.lastToolTally.map(([k, v]) => `${k}=${v}`).join('  '));
    }
    const blockerTally = tally(
        runs.flatMap((r) => (r.summary.blockers || []).map((b) => oneLine(b, 48))),
        (b) => b
    ).slice(0, 5);
    if (blockerTally.length) {
        console.log('  高频阻塞：');
        for (const [text, count] of blockerTally) console.log(`     ${String(count).padStart(3)} × ${text}`);
    }
}

/** 工具结果摘要：只取可读标量，图像/base64/超长字段一律不打印（防终端被 base64 淹没）。 */
function digestToolResult(result) {
    if (!result || typeof result !== 'object') return '';
    const parts = [];
    for (const [key, value] of Object.entries(result)) {
        if (/image|base64|dataUrl|thumbnail|pixels|buffer/i.test(key)) {
            parts.push(`${key}=<已省略>`);
            continue;
        }
        if (value == null) continue;
        if (typeof value === 'object') {
            parts.push(`${key}=${Array.isArray(value) ? `[${value.length}]` : '{…}'}`);
            continue;
        }
        const text = String(value);
        if (text.length > 60) {
            parts.push(`${key}=${text.slice(0, 57)}…`);
            continue;
        }
        parts.push(`${key}=${text}`);
        if (parts.length >= 6) break;
    }
    return parts.join(' ');
}

const STEP_MARK = { success: '✓', error: '✗', pending: '·', running: '·' };

/** 展开单轮完整轨迹：工具调用序列 + 模型思考文本，用于定位「为什么停在这里」。 */
function printTrace(run) {
    const s = run.summary || {};
    console.log('━'.repeat(72));
    console.log(`运行 [${run.index}] 完整轨迹  ${formatTime(run.at)}  ${s.status} / ${s.stopReason}`);
    console.log('━'.repeat(72));
    console.log(`目标：${oneLine(run.goal, 200) || '(未记录)'}`);
    if (!run.steps.length) {
        console.log('\n本轮消息未保存 thinkingSteps（旧记录或未开启过程记录），只能看执行摘要。');
        printRun(run);
        return;
    }
    console.log(`\n共 ${run.steps.length} 步：\n`);
    let toolSeq = 0;
    for (const step of run.steps) {
        const type = step.type || '?';
        const mark = STEP_MARK[step.status] || ' ';
        if (type === 'tool_call') {
            toolSeq += 1;
            const duration = Number(step.duration || 0);
            const digest = digestToolResult(step.toolResult);
            console.log(`  ${mark} #${String(toolSeq).padStart(2)} ${String(step.toolName || '(无名)').padEnd(28)} ${String(duration + 'ms').padStart(7)}  ${oneLine(step.content, 40)}`);
            if (digest) console.log(`        └ ${oneLine(digest, 100)}`);
            if (step.status === 'error') {
                const reason = (step.toolResult && (step.toolResult.error || step.toolResult.message)) || step.content;
                console.log(`        └ 失败：${oneLine(reason, 100)}`);
            }
            continue;
        }
        if (type === 'thinking') {
            const text = String(step.content || '').split('\n').filter(Boolean);
            console.log(`  💭 模型思考：`);
            for (const line of text.slice(0, 6)) console.log(`        ${oneLine(line, 96)}`);
            if (text.length > 6) console.log(`        …（还有 ${text.length - 6} 行）`);
            continue;
        }
        console.log(`  ${mark} [${type}] ${oneLine(step.content, 88)}`);
    }

    const toolSteps = run.steps.filter((step) => step.type === 'tool_call');
    const slowest = [...toolSteps].sort((a, b) => Number(b.duration || 0) - Number(a.duration || 0)).slice(0, 5);
    if (slowest.length) {
        console.log('\n最耗时的调用：' + slowest.map((step) => `${step.toolName}=${Number(step.duration || 0)}ms`).join('  '));
        // 并行批次内各调用记录的是整批耗时（同批 duration 相同），直接求和会高于真实墙钟时间。
        // 因此按「相同 duration 的相邻调用只计一次」折算，并同时给出未折算值，让口径可见。
        let batchAdjusted = 0;
        let previousDuration = null;
        for (const step of toolSteps) {
            const duration = Number(step.duration || 0);
            if (duration !== previousDuration) batchAdjusted += duration;
            previousDuration = duration;
        }
        const rawTotal = toolSteps.reduce((sum, step) => sum + Number(step.duration || 0), 0);
        console.log(`工具耗时：约 ${batchAdjusted}ms（${toolSteps.length} 次调用，并行批次按整批只计一次）`);
        if (rawTotal !== batchAdjusted) {
            console.log(`  逐条相加为 ${rawTotal}ms——并行批次内每个调用记录的都是整批耗时，该值偏高，不能当作真实墙钟时间。`);
        }
    }
    console.log('');
    printRun(run);
}

function printRunRecordTrace(record) {
    console.log('━'.repeat(72));
    console.log(`运行档案 [${record.__index}] ${formatTime(normalizeTimestamp(record.endedAt))}  ${record.success ? 'success' : 'failed'} / ${record.stopReason || '(无停机原因)'}`);
    console.log('━'.repeat(72));
    console.log(`目标：${oneLine(record.goal, 200) || '(未记录)'}`);
    console.log(`项目：${record.projectPath || '(未记录)'}`);
    console.log(`档案：${record.__file}`);
    if (Number(record.droppedToolCalls || 0) > 0) {
        console.log(`提示：本档案因体积限制省略了 ${Number(record.droppedToolCalls)} 次工具调用摘要。`);
    }
    const toolCalls = Array.isArray(record.toolCalls) ? record.toolCalls : [];
    if (!toolCalls.length) {
        console.log('\n本档案没有工具调用。');
        printPromptShapeSamples(record);
        return;
    }
    console.log(`\n共 ${toolCalls.length} 次工具调用：\n`);
    for (const call of toolCalls) {
        const mark = call.success === false ? '✗' : '✓';
        const seq = Number(call.seq || 0);
        const origin = call.origin ? ` · ${call.origin}` : '';
        const code = call.code ? ` · ${call.code}` : '';
        const summary = oneLine(call.summary, 112);
        console.log(`  ${mark} #${String(seq).padStart(2)} ${String(call.name || '(无名)').padEnd(30)} ${call.activityClass || call.riskClass || ''}${origin}${code}`);
        if (summary) console.log(`        └ ${summary}`);
        if (Array.isArray(call.argsKeys) && call.argsKeys.length) {
            console.log(`        └ 参数字段：${call.argsKeys.join(', ')}`);
        }
    }
    if (Array.isArray(record.blockers) && record.blockers.length) {
        console.log(`\n阻塞：${record.blockers.map((item) => oneLine(item, 120)).join('；')}`);
    }
    printPromptShapeSamples(record);
}

function readRuntimeAccounting(record) {
    const nested = record?.runtimeSession?.accounting;
    const standalone = record?.runtimeAccounting;
    if (nested && standalone) return null;
    return nested || standalone || null;
}

/**
 * 提示体量：回答「模型是不是被淹了」。每次模型调用的系统提示 / 历史 / 工具 schema 字符数与 token 数，
 * staged 从 runtimeSession.accounting 读取，普通 agentic 从顶层 runtimeAccounting 读取；
 * 两者同时存在属于非法档案，不在诊断脚本里猜测或合并。
 */
function printPromptShapeSamples(record) {
    const accounting = readRuntimeAccounting(record);
    if (accounting) {
        console.log(`\n运行会计：模型 ${accounting.modelCallCount} 次 / ${accounting.modelDurationMs}ms；工具 ${accounting.toolCallCount} 次 / ${accounting.toolDurationMs}ms；usage 未上报 ${accounting.unreportedUsageCallCount} 次。`);
        const recoveryAttempts = Number(accounting.providerOutputRecoveryAttemptCount || 0);
        const recoverySuccesses = Number(accounting.providerOutputRecoverySuccessCount || 0);
        const recoveryFailures = Number(accounting.providerOutputRecoveryFailureCount || 0);
        if (recoveryAttempts > 0 || recoverySuccesses > 0 || recoveryFailures > 0) {
            const failureCounts = accounting.providerOutputRecoveryFailureCounts || {};
            console.log(
                `Provider 输出恢复：请求 ${recoveryAttempts} 次，成功 ${recoverySuccesses} 次，失败 ${recoveryFailures} 次`
                + `（长度 ${Number(failureCounts.max_tokens || 0)}，流不完整 ${Number(failureCounts.stream_incomplete || 0)}，`
                + `内容拦截 ${Number(failureCounts.content_blocked || 0)}，请求错误 ${Number(failureCounts.request_error || 0)}）。`
            );
        }
    }
    const samples = accounting?.promptShapeSamples;
    if (!Array.isArray(samples) || samples.length === 0) return;
    console.log('\n提示体量（每次模型调用；字符数 / token）：');
    console.log('  #    阶段  系统提示   历史     工具schema  工具数  图  消息数   输入token  输出token   耗时');
    for (const sample of samples) {
        const cells = [
            String(sample.seq).padStart(3),
            String(sample.stage || '').padEnd(5),
            String(sample.systemChars).padStart(8),
            String(sample.historyChars).padStart(8),
            String(sample.toolSchemaChars).padStart(11),
            String(sample.toolCount).padStart(6),
            String(sample.imageBlocks).padStart(3),
            String(sample.messageCount).padStart(6),
            String(sample.inputTokens ?? '-').padStart(10),
            String(sample.outputTokens ?? '-').padStart(9),
            `${sample.durationMs}ms`.padStart(8)
        ];
        console.log('  ' + cells.join(' '));
    }
    const first = samples[0];
    const last = samples[samples.length - 1];
    const maxSystem = Math.max(...samples.map((s) => s.systemChars));
    const maxTools = Math.max(...samples.map((s) => s.toolSchemaChars));
    console.log(`  小结：系统提示 ${first.systemChars}→${last.systemChars} 字（峰值 ${maxSystem}），工具 schema 峰值 ${maxTools} 字，历史 ${first.historyChars}→${last.historyChars} 字。`);
    console.log('  看法：系统提示 + 工具 schema 是每次都重发的固定开销；历史增长是 ReAct 的轮次税。哪个大就先砍哪个。');
}

function parseArgs(argv) {
    const options = {
        last: 10,
        all: false,
        json: false,
        failedOnly: false,
        dataDir: '',
        trace: 0,
        routes: false,
        projectRoots: [],
        sinceText: '',
        help: false
    };
    for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--all') options.all = true;
        else if (arg === '--json') options.json = true;
        else if (arg === '--failed') options.failedOnly = true;
        else if (arg === '--routes') options.routes = true;
        else if (arg === '--convergence') options.convergence = true;
        else if (arg === '--trace') options.trace = Math.max(1, Number(argv[++i]) || 0);
        else if (arg === '--last') options.last = Math.max(1, Number(argv[++i]) || 10);
        else if (arg === '--data') options.dataDir = argv[++i] || '';
        else if (arg === '--project') {
            const projectPath = argv[++i] || '';
            if (!projectPath) {
                console.error('--project 需要一个目录路径。');
                process.exit(1);
            }
            options.projectRoots.push(projectPath);
        }
        else if (arg === '--since') options.sinceText = argv[++i] || '';
        else if (arg === '--help' || arg === '-h') options.help = true;
        else {
            console.error(`未知参数：${arg}（用 --help 查看用法）`);
            process.exit(1);
        }
    }
    return options;
}

function readConvergenceBaseline() {
    try {
        const statePath = path.join(__dirname, '..', 'project-memory', 'project-state.json');
        if (!fs.existsSync(statePath)) return null;
        const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        const baseline = state && state.convergenceBaseline;
        if (!baseline || typeof baseline.completedWithWritesRate !== 'number') return null;
        return baseline;
    } catch {
        return null;
    }
}

/**
 * 收敛指标对照（治理切片 3/5/9）：完成且有真实写入率、观察占比、首次写入延迟与
 * 疑似能力误判计数，并对照 project-state.json 中记录的治理前基线。只报告，不判定
 * 失败——收敛由人看。新指标在基线未回填时只输出当前值。
 */
function printConvergenceComparison(agg, baseline) {
    const pct = (value) => `${(value * 100).toFixed(1)}%`;
    const currentRate = agg.total > 0 ? agg.completedWithWritesCount / agg.total : 0;
    const observationShare = agg.totalBusinessActions > 0
        ? agg.totalObservationCalls / agg.totalBusinessActions
        : null;
    const currentFirstWriteMedian = median(agg.firstWriteLatencyValues);
    const currentDenialCount = agg.capabilityDenialSuspects.length;
    console.log('\n' + '━'.repeat(72));
    console.log('收敛指标对照（治理口径：完成且有真实写入 / 观察占比 / 首次写入延迟 / 疑似能力误判）');
    console.log('━'.repeat(72));
    console.log(`  当前窗口：${agg.total} 次运行`);
    console.log(`  完成且有真实写入 ${agg.completedWithWritesCount} / ${agg.total}  (${pct(currentRate)})   依据 Photoshop history/commit mutationObserved=true（历史大盘，非固定 Case 成功率）`);
    console.log(`  观察占比       ${agg.totalObservationCalls} / ${agg.totalBusinessActions} 次业务动作`
        + (observationShare === null ? '' : `  (${pct(observationShare)})`));
    console.log(`  首次写入延迟   中位 ${formatDuration(currentFirstWriteMedian)}   时序覆盖 ${agg.firstWriteLatencyCoverage.withTiming}/${agg.firstWriteLatencyCoverage.withWrites}（旧档案无时序，覆盖随新运行增长）`);
    console.log(`  疑似能力误判   ${currentDenialCount} 条候选   依据 零写入+无阻塞+自然停机+能力信号，需人工逐条确认`);
    if (agg.capabilityDenialSuspects.length) {
        for (const suspect of agg.capabilityDenialSuspects.slice(0, 5)) {
            console.log(`     [#${suspect.index}] ${oneLine(suspect.goal, 46)}  ← ${suspect.signal}（停机 ${suspect.stopReason}）`);
        }
        if (agg.capabilityDenialSuspects.length > 5) {
            console.log(`     …还有 ${agg.capabilityDenialSuspects.length - 5} 条候选`);
        }
    }
    if (baseline && baseline.metricSemantics === 'observed_photoshop_mutation/v1') {
        const deltaRate = currentRate - baseline.completedWithWritesRate;
        const deltaShare = observationShare === null ? null : observationShare - baseline.observationShare;
        console.log(`  ── 治理前基线（${baseline.window}，${baseline.totalRuns} 次运行，记录于 ${baseline.capturedAt}）──`);
        console.log(`  完成且有写入   ${pct(baseline.completedWithWritesRate)} → ${pct(currentRate)}`
            + `  (Δ ${deltaRate >= 0 ? '+' : ''}${(deltaRate * 100).toFixed(1)} 个百分点)`);
        if (deltaShare !== null) {
            console.log(`  观察占比       ${pct(baseline.observationShare)} → ${pct(observationShare)}`
                + `  (Δ ${deltaShare >= 0 ? '+' : ''}${(deltaShare * 100).toFixed(1)} 个百分点)`);
        }
        if (typeof baseline.firstWriteLatencyMedianMs === 'number' && currentFirstWriteMedian !== null) {
            const deltaLatency = currentFirstWriteMedian - baseline.firstWriteLatencyMedianMs;
            console.log(`  首次写入延迟   ${formatDuration(baseline.firstWriteLatencyMedianMs)} → ${formatDuration(currentFirstWriteMedian)}`
                + `  (Δ ${deltaLatency >= 0 ? '+' : ''}${formatDuration(Math.abs(deltaLatency))})`);
        }
        if (typeof baseline.capabilityDenialSuspectCount === 'number') {
            const deltaDenial = currentDenialCount - baseline.capabilityDenialSuspectCount;
            console.log(`  疑似能力误判   ${baseline.capabilityDenialSuspectCount} → ${currentDenialCount}`
                + `  (Δ ${deltaDenial >= 0 ? '+' : ''}${deltaDenial})`);
        }
        console.log('  收敛判据：完成且有写入率上升、首次写入延迟下降、观察占比下降、疑似能力误判减少为收敛方向；反之为回退，需回到治理切片排查。');
    } else if (baseline) {
        console.log('  （历史 convergenceBaseline 使用“写类 Tool success”旧口径，与当前 Photoshop history/commit 真写入口径不可直接比较；已停止输出伪 delta。）');
    } else {
        console.log('  （project-state.json 未记录可比 convergenceBaseline，仅输出当前值。）');
    }
}

function main() {
    const options = parseArgs(process.argv);
    if (options.help) {
        console.log([
            'DesignEcho 真实运行诊断',
            '',
            '用法：',
            '  node scripts/diagnose-runs.cjs [--last N|--all] [--failed]',
            '  node scripts/diagnose-runs.cjs --trace N [--since YYYY-MM]',
            '  node scripts/diagnose-runs.cjs --project <目录> [--project <目录>...]',
            '  node scripts/diagnose-runs.cjs --data <userData目录> [--json|--routes]',
            '  node scripts/diagnose-runs.cjs --all --since YYYY-MM --convergence',
            '',
            '--trace 优先展开 agent-run-record/v0 的真实工具序列；没有档案时才回退到会话过程。'
        ].join('\n'));
        return;
    }

    const userDataDir = resolveUserDataDir(options.dataDir);
    const sinceFilter = options.sinceText ? parseYearMonth(options.sinceText) : null;
    if (options.sinceText && !sinceFilter) {
        console.error(`--since 必须使用 YYYY-MM 格式，收到：${options.sinceText}`);
        process.exit(1);
    }
    for (const projectRoot of options.projectRoots) {
        const resolvedProjectRoot = path.resolve(projectRoot);
        let isDirectory = false;
        try {
            isDirectory = fs.statSync(resolvedProjectRoot).isDirectory();
        } catch {
            isDirectory = false;
        }
        if (!isDirectory) {
            console.error(`--project 指定的目录不存在或不是目录：${resolvedProjectRoot}`);
            process.exit(1);
        }
    }

    if (options.routes) {
        const routeData = collectRouteDecisions(userDataDir);
        if (routeData.missing) {
            console.error(`未找到会话目录：${routeData.sourceDir}`);
            process.exit(1);
        }
        if (!routeData.decisions.length) {
            console.log('没有找到带路由决策的记录（agentRequestLifecycle.decision）。');
            return;
        }
        console.log('DesignEcho 意图路由体检');
        console.log(`数据源：${routeData.sourceDir}`);
        printRouteReport(routeData.decisions, options.all ? 0 : options.last);
        console.log('\n说明：判定全部来自应用真实写入的决策字段，未做推测性归因。');
        return;
    }

    const collected = collectRunsFromConversations(userDataDir);
    if (collected.missing) {
        console.error(`未找到会话目录：${collected.sourceDir}`);
        console.error('若应用数据目录不在默认位置，用 --data <userData 目录> 指定。');
        process.exit(1);
    }

    const conversationRuns = collected.runs.filter((run) => matchesYearMonth(run.at, sinceFilter));
    const recordRoots = resolveRunRecordSearchRoots({
        explicitProjectRoots: options.projectRoots,
        userDataDir,
        repositoryRoot: path.resolve(__dirname, '..')
    });
    const recordCollection = collectRunRecords(recordRoots.roots, sinceFilter);
    const records = recordCollection.records;
    let runs = records.length > 0
        ? records.map(mapRunRecordToRun)
        : conversationRuns;
    if (options.trace) {
        const record = records.find((item) => item.__index === options.trace);
        if (record) {
            printRunRecordTrace(record);
            return;
        }
        const target = conversationRuns.find((run) => run.index === options.trace);
        if (!target) {
            console.error(`没有第 ${options.trace} 条运行档案或会话运行：当前档案 ${records.length} 条，会话运行 ${conversationRuns.length} 次。`);
            process.exit(1);
        }
        printTrace(target);
        return;
    }
    if (options.failedOnly) {
        runs = runs.filter((run) => (
            run.summary.success === false
            || (run.summary.success === undefined && run.summary.status !== 'completed')
        ));
    }
    if (!runs.length) {
        console.log(`已扫描 ${recordRoots.roots.length} 个运行档案根和 ${collected.fileCount} 个会话文件，没有找到匹配的运行记录。`);
        return;
    }

    const shown = options.all ? runs : runs.slice(-options.last);
    const aggregate = buildAggregate(runs);

    if (options.convergence) {
        console.log(`DesignEcho 真实运行诊断 · 收敛对照`);
        console.log(`运行档案搜索来源：${recordRoots.source}${options.sinceText ? ` · 月份 ${options.sinceText}` : ''}`);
        console.log(`运行档案（含完整工具序列）：${records.length} 条`);
        printConvergenceComparison(aggregate, readConvergenceBaseline());
        console.log('\n说明：以上全部来自应用真实运行时写入的记录字段，未做任何推测性归因。');
        return;
    }

    if (options.json) {
        console.log(JSON.stringify({
            source: {
                conversationsDir: collected.sourceDir,
                fileCount: collected.fileCount,
                runRecordRootSource: recordRoots.source,
                runRecordScans: recordCollection.scanResults,
                runRecordCount: records.length,
                primary: records.length > 0 ? 'agent-run-record/v0' : 'conversation_execution_summary',
                since: options.sinceText || null
            },
            aggregate,
            runs: shown.map((run) => ({
                index: run.index,
                at: run.at,
                atText: formatTime(run.at),
                goal: run.goal,
                summary: run.summary,
                findings: diagnoseRun(run)
            }))
        }, null, 2));
        return;
    }

    console.log(`DesignEcho 真实运行诊断`);
    console.log(`会话索引：${collected.sourceDir}（${collected.fileCount} 个会话文件）`);
    console.log(`运行档案搜索来源：${recordRoots.source}${options.sinceText ? ` · 月份 ${options.sinceText}` : ''}`);
    for (const scan of recordCollection.scanResults) {
        console.log(`  ${scan.root} → ${scan.count} 条`);
    }
    console.log(`运行档案（含完整工具序列）：${records.length} 条` + (records.length ? '' : ' —— 当前搜索根未发现档案'));
    console.log(`诊断主数据：${records.length > 0 ? 'agent-run-record/v0' : 'conversation executionSummary 兜底'}`);
    console.log(`本次显示：最近 ${shown.length} / 共 ${runs.length} 次运行${options.failedOnly ? '（仅失败）' : ''}`);

    shown.forEach((run) => printRun(run));
    printAggregate(aggregate, runs);
    console.log('\n说明：以上全部来自应用真实运行时写入的记录字段，未做任何推测性归因。');
}

main();
