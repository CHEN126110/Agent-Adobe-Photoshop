import { isPolicyGateResult } from './tool-safety-policy';

/**
 * policyGate 重复命中护栏——「豁免熔断」的反向漏洞收口。
 *
 * 背景（真机病例 2026-08-03，会话 55bd7d3e）：
 * policyGate 结果被有意排除出失败会计（agent.ts updateLoopGuards），因为策略重定向不是工具执行
 * 失败，不该被放大成熔断/no_progress 停机（治理审计 2026-07-08）。这个方向是对的，但只做了单向
 * 保护——**豁免熔断不等于允许无限撞同一堵墙**。
 *
 * 反向漏洞的真机形态：用户说「再新建一个文档 尺寸随意都行」，createDocument 被同一条门禁
 * （create_document_target_unresolved）连拦 8 次。模型每次都照门禁指路调 listDocuments，
 * 但那是只读工具、改变不了判定输入，于是原样重试、再撞同一堵墙。
 * 三个现有守卫全部失效：
 *  - repeatedToolBatchCount：批次是 createDocument → listDocuments 交替，签名不同，不累加；
 *  - consecutiveFailedToolRounds：policyGate 被排除后，每轮还有成功的 listDocuments，计数清零；
 *  - consecutiveControlToolNoProgressRounds：撞墙的不是 Harness 控制工具，够不着。
 * 结果：20 轮迭代、18 次工具调用、0 次写入，最后还报 completed。
 *
 * 本护栏与 consecutiveControlToolNoProgressRounds 完全同构——那一条堵的是「控制工具被排除出失败
 * 会计」的反向漏洞（含结构化 idempotent no-op），这一条堵的是「policyGate 被排除出失败会计」的同类漏洞。
 *
 * 设计约束：
 *  1. 按「同一堵墙」累计，不按连续轮次。真机形态就是「拦→成功→拦」交替，任何
 *     以「连续」为口径的计数都会被中间那次成功清零，必须用一次 run 内的累计值。
 *  2. 只统计真正的策略拦截。等待用户确认的 HITL 卡（safetyBlock）是正常暂停、不是撞墙。
 *  3. 触发后如实停机并告知用户被哪条门禁挡住，而不是继续烧预算、最后伪装成功。
 */

/**
 * 同一堵墙在一次 run 内被撞到多少次即判定为死锁。
 *
 * 取 5 的依据：Harness 主动介入的有界修复通常在 4-5 次内自行收尾（与
 * suppressConsecutiveFailedRound 豁免同源的经验值），高于它才不会抢先掐断正当重试；
 * 而真机死锁病例连撞 8 次，5 次足以在烧穿预算前叫停。
 */
export const POLICY_GATE_REPEAT_BLOCK_LIMIT = 5;

/**
 * 同一堵墙的**不可豁免**上限——达到后任何 Harness 恢复都不能再压住停机。
 *
 * 背景（真机病例 2026-08-18，运行档案 [491]）：`photoshop_target_changed_before_execution`
 * 在一次 run 内挡下 sku-batch **14 次**，签名、code、上账全部正确，累计计数也照常涨到 14，
 * 却一次都没停机——因为 agent.ts 的停机判断是
 * `if (repeatedPolicyGate && !options.suppressConsecutiveFailedRound)`，
 * 而模型每轮都夹一次 requestAgentCapabilities 触发 liveness recovery，
 * `suppressConsecutiveFailedRound` **每轮都为真**。
 *
 * 原设计写着「计数照常累加、只是本轮不停机，下一轮即触发」，这句话隐含了
 * 「豁免不会每轮都成立」的假设。真机证明该假设不成立：只要模型持续调用控制工具，
 * 豁免就能无限续期，累计计数彻底失去意义，最后烧穿 performance_budget、零写入。
 *
 * 因此豁免本身也要有界：LIMIT 之后仍可宽限，但到 HARD_LIMIT 必须如实停机。
 * 取 2 倍是因为豁免的正当用途是「让 Harness 排好的恢复动作获得一次真实执行机会」——
 * 5 次额外机会远超任何一条有界修复所需，再撞就是出口不可达。
 */
export const POLICY_GATE_REPEAT_HARD_BLOCK_LIMIT = POLICY_GATE_REPEAT_BLOCK_LIMIT * 2;

/** 一次 run 内的累计状态：墙标识 → 命中次数。 */
export type PolicyGateRepeatState = Map<string, number>;

export function createPolicyGateRepeatState(): PolicyGateRepeatState {
    return new Map<string, number>();
}

/** 命中同一堵墙达到上限时的停机裁决。 */
export interface PolicyGateRepeatVerdict {
    signature: string;
    count: number;
    toolName: string;
    message: string;
    /**
     * 本次裁决能否被 Harness 恢复豁免（suppressConsecutiveFailedRound）压住本轮停机。
     * count 达到 POLICY_GATE_REPEAT_HARD_BLOCK_LIMIT 后为 false：账本自己决定这堵墙
     * 还能不能宽限，调用方不得再自行判断。
     */
    suppressible: boolean;
}

function readStringField(result: unknown, field: string): string {
    if (result == null || typeof result !== 'object') return '';
    return String((result as Record<string, unknown>)[field] || '').trim();
}

/**
 * 是否为等待用户确认的 HITL 卡结果。
 * 它同样带 policyGate + success:false，但语义是「正常暂停等真人确认」，
 * 反复出现属于正当流程（用户确认后由 ChatPanel 重放），绝不能计入撞墙。
 */
export function isHumanConfirmationPolicyGate(result: unknown): boolean {
    if (result == null || typeof result !== 'object') return false;
    return (result as { safetyBlock?: unknown }).safetyBlock === true;
}

/**
 * 门禁独有的结构字段——「这次不是工具执行失败，是被拦下了」的客观证据。
 *
 * blockedTool：拦截点记录被挡住的工具名（agent.ts 执行前置、runtime-session、preflight 等）。
 * nextRequiredTool：门禁给出的下一步指引（design-discipline-runtime、executor wrapper 等）。
 *
 * 普通 Photoshop 工具失败（图层没找到、文档已关闭）不会带这两个字段，因此不会被误计入撞墙。
 */
const GATE_STRUCTURAL_FIELDS = ['blockedTool', 'nextRequiredTool'] as const;

/**
 * 这次结果是否该进撞墙账本。
 *
 * 真机病例 2026-08-14：`runtime_task_run_revision_reobserve_required`（agent.ts 的
 * runtime session 门禁）在一次 run 内挡下 createTextLayer **7 次**，超过 5 次上限却没有停机，
 * 最后死于 performance_budget、零写入。根因不是护栏阈值，而是**账本依赖门禁自报身份**：
 * 那条门禁的返回对象漏了 `policyGate: true`，`isPolicyGateResult()` 判 false，
 * 签名解析直接返回 null——这堵墙从头到尾不在账本上，可以被无限撞。
 * 同一个函数里的兄弟门禁（1347/1370/1385/1418 行）都标了，唯独它没标。
 *
 * 因此判据改为「结构识别优先于自报」：只要带门禁独有字段就必须上账，
 * 不再要求每个拦截点记得贴标签。漏贴 `policyGate` 仍会影响熔断豁免语义
 * （那是另一回事，由 audit 守住），但**再也不能让一堵墙从账本上消失**。
 */
export function isLedgerAccountableGate(result: unknown): boolean {
    if (isPolicyGateResult(result)) return true;
    if (result == null || typeof result !== 'object') return false;
    const record = result as Record<string, unknown>;
    if (record.success !== false) return false;
    if (isDeclarationValidationRejection(record)) return true;
    return GATE_STRUCTURAL_FIELDS.some((field) => {
        const value = record[field];
        return typeof value === 'string' && value.trim().length > 0;
    });
}

/**
 * Harness 声明表单（declareDesignBrief / Strategy / ActionPlan / ReferenceBrief）的结构校验驳回。
 * 它不是 Photoshop 失败，也不带 blockedTool——但和门禁一样是「Harness 拒绝模型」：
 * 真机 2026-08-17 `runtime_design_brief_declaration_invalid` 一次 run 内连撞 7 次不停机、零写入。
 * 同一表单被连续驳回到上限，就是模型看不懂表单要求，继续盲试没有意义，必须上账并停机说清。
 */
function isDeclarationValidationRejection(record: Record<string, unknown>): boolean {
    const code = String(record.code || '').trim();
    return code.endsWith('_declaration_invalid');
}

/**
 * 解析一次工具结果对应的「墙标识」——同一堵墙必须得到同一个标识，不同的墙必须区分开。
 *
 * 返回 null = 本次结果不该计入撞墙统计。
 *
 * 判断依据（可用字段）：
 *  - isPolicyGateResult(result)：是否策略拦截结果（policyGate === true）。
 *  - isHumanConfirmationPolicyGate(result)：是否等待真人确认的 HITL 卡。
 *  - readStringField(result, 'code')：门禁代码，如 'create_document_target_unresolved'。
 *    注意并非所有门禁都带 code——设计纪律守卫（design-discipline-runtime）的拦截就没有
 *    code，只有 message/error，需要一个稳定回退。
 *  - toolName：被拦的工具名。
 *
 * 粒度权衡：标识太粗（只用 toolName）会把不同门禁混算成一堵墙、误停正当重试；
 * 太细（掺入完整 message）会因门禁文案里的动态状态（文档名、计数）每次都不同，
 * 让护栏永远数不到上限、彻底失效。
 */
export function resolvePolicyGateBlockSignature(
    toolName: string,
    result: unknown
): string | null {
    if (!isLedgerAccountableGate(result) || isHumanConfirmationPolicyGate(result)) return null;

    const normalizedToolName = String(toolName || '').trim();
    if (!normalizedToolName) return null;

    const code = readStringField(result, 'code');
    if (code) return `${normalizedToolName}:code:${code}`;

    const message = readStringField(result, 'message') || readStringField(result, 'error');
    if (!message) return null;
    // 没有 code 的旧门禁只能从文案派生签名。去掉名称、编号等动态值，保留门禁语义；
    // 不退化成 toolName 单值，避免同一工具的不同门禁被误合并。
    const normalizedMessage = message
        .toLowerCase()
        .replace(/[「『“"'].*?[」』”"']/g, '<value>')
        .replace(/\b\d+(?:\.\d+)?\b/g, '<number>')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180);
    return normalizedMessage
        ? `${normalizedToolName}:message:${normalizedMessage}`
        : null;
}

/**
 * 记录一次工具结果，返回该墙的最新累计次数（未计入则返回 0）。
 */
export function recordPolicyGateBlock(
    state: PolicyGateRepeatState,
    toolName: string,
    result: unknown
): number {
    const signature = resolvePolicyGateBlockSignature(toolName, result);
    if (!signature) return 0;
    const next = (state.get(signature) || 0) + 1;
    state.set(signature, next);
    return next;
}

/**
 * 批量记录一轮的工具结果，并返回首个达到上限的墙（没有则返回 null）。
 * 调用方负责传入本轮 toolName 与 result 的配对。
 */
export function recordPolicyGateBlockRound(
    state: PolicyGateRepeatState,
    entries: readonly { toolName: string; result: unknown }[]
): PolicyGateRepeatVerdict | null {
    let verdict: PolicyGateRepeatVerdict | null = null;
    for (const entry of entries) {
        const signature = resolvePolicyGateBlockSignature(entry.toolName, entry.result);
        if (!signature) continue;
        const count = (state.get(signature) || 0) + 1;
        state.set(signature, count);
        if (count >= POLICY_GATE_REPEAT_BLOCK_LIMIT && !verdict) {
            const suppressible = count < POLICY_GATE_REPEAT_HARD_BLOCK_LIMIT;
            verdict = {
                signature,
                count,
                toolName: entry.toolName,
                suppressible,
                message: buildPolicyGateRepeatStopMessage({
                    toolName: entry.toolName,
                    count,
                    blockMessage: readStringField(entry.result, 'message')
                        || readStringField(entry.result, 'error'),
                    declarationRejection: entry.result != null && typeof entry.result === 'object'
                        && isDeclarationValidationRejection(entry.result as Record<string, unknown>),
                    exhaustedRecoveryGrace: !suppressible
                })
            };
        }
    }
    return verdict;
}

/**
 * 停机说明：必须如实告诉用户被哪条门禁挡住、撞了多少次，
 * 而不是把 0 产出的运行包装成「这稿做好了」。
 */
export function buildPolicyGateRepeatStopMessage(input: {
    toolName: string;
    count: number;
    blockMessage?: string;
    declarationRejection?: boolean;
    /** 已用尽 Harness 恢复宽限（count 达到硬上限），停机不可再被豁免压住。 */
    exhaustedRecoveryGrace?: boolean;
}): string {
    const blockMessage = String(input.blockMessage || '').trim();
    if (input.declarationRejection) {
        const lines = [
            `系统要求先提交的「${input.toolName}」表单已经连续 ${input.count} 次没有通过校验，继续盲试不会有进展，已停止。`,
            '这是系统表单要求与模型理解之间的问题，不代表你的需求描述错误。'
        ];
        if (blockMessage) lines.push(`最后一次校验说明：${blockMessage}`);
        lines.push('本轮没有完成，运行记录已保留诊断。');
        return lines.join('\n');
    }
    const lines = [
        `同一条策略门禁已经挡下 ${input.toolName} ${input.count} 次，继续原样重试不会有进展，已停止。`,
        '这通常说明门禁给出的下一步指引无法真正解除它本身的拦截条件（出口不可达）。'
    ];
    if (blockMessage) lines.push(`门禁说明：${blockMessage}`);
    if (input.exhaustedRecoveryGrace) {
        lines.push('期间系统已经多次安排替代动作重试，仍然撞在同一条门禁上，宽限次数已用尽。');
    }
    lines.push('这是系统门禁路径问题，不代表你的需求描述错误；本轮没有完成，运行记录已保留诊断。');
    return lines.join('\n');
}

/**
 * 供诊断使用：导出当前累计快照（按次数降序）。
 */
export function summarizePolicyGateBlocks(
    state: PolicyGateRepeatState
): { signature: string; count: number }[] {
    return Array.from(state.entries())
        .map(([signature, count]) => ({ signature, count }))
        .sort((left, right) => right.count - left.count);
}

/** 仅供接线处判断结果是否为策略拦截，避免调用方再 import 一次 tool-safety-policy。 */
export { isPolicyGateResult };
