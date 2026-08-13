/**
 * Agent / Skill 的有序操作日志投影（纯逻辑）。
 *
 * Skill 的顶层返回值只是工作流信封；只有信封中按顺序公开的原子 Tool 结果，才可以
 * 参与 mutation、读回和验收事实判定。本模块只遍历约定的 ledger 字段以及稳定的
 * data/result/output 包装，不扫描 report、metadata、echoedInput 等任意业务对象。
 */

import { classifyAgentToolExecution } from './agent-tool-execution-preflight';
import { findObservedPhotoshopMutationProof } from './photoshop-history-state-ref';
import { getSkillById } from './skills/skill-declarations';

const DECLARED_LEDGER_KEYS = new Set([
    'toolresults',
    'toolcalllog',
    'operationresults',
    'readbackresults'
]);

const STABLE_ENVELOPE_KEYS = new Set([
    'data',
    'result',
    'output',
    'actualresult'
]);

const MAX_LEDGER_DEPTH = 6;
const MAX_LEDGER_ARRAY_LENGTH = 256;
const MAX_VISITED_NODE_COUNT = 512;

export interface AgentOperationLedgerSourceEntry {
    callId?: unknown;
    name?: unknown;
    arguments?: unknown;
    result?: unknown;
    origin?: unknown;
    failureDisposition?: unknown;
    qualityVerificationPhase?: unknown;
}

export interface AgentOperationLedgerProvenance {
    role: 'top_level_operation' | 'workflow_envelope' | 'nested_operation';
    topLevelIndex: number;
    depth: number;
    resultPath: string;
    declaredName: string;
    parentOperationName?: string;
}

export interface AgentOperationLedgerEntry {
    callId?: unknown;
    name: string;
    arguments: unknown;
    result: unknown;
    origin?: unknown;
    failureDisposition?: unknown;
    qualityVerificationPhase?: unknown;
    /** workflow envelope 必须为 false，避免外层 success 冒充内部 Photoshop 操作。 */
    succeeded?: boolean;
    operationLedgerProvenance: AgentOperationLedgerProvenance;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasTrustedSkillWorkflowBridgeReceipt(
    operationName: string,
    result: unknown
): boolean {
    if (!getSkillById(operationName) || !isRecord(result)) return false;
    const data = isRecord(result.data) ? result.data : undefined;
    const observation = data && isRecord(data.agentReActObservation)
        ? data.agentReActObservation
        : undefined;
    return observation?.version === 'agent-react-observation/v0'
        && observation.kind === 'skill'
        && observation.actionId === `skill:${operationName}`;
}

function normalizeLedgerKey(value: string): string {
    return value.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function normalizeDeclaredOperationName(value: unknown): { declaredName: string; name: string } {
    const declaredName = String(value || '').trim();
    const decorated = /^([a-z0-9_.:-]+)\[[^\]]+\]$/i.exec(declaredName);
    return {
        declaredName,
        name: decorated?.[1] || declaredName
    };
}

function readOperationName(value: Record<string, unknown>): { declaredName: string; name: string } {
    return normalizeDeclaredOperationName(
        value.providerToolName ?? value.toolName ?? value.name ?? value.tool
    );
}

function readOperationArguments(value: Record<string, unknown>): unknown {
    const candidate = value.arguments ?? value.params ?? value.input ?? value.request;
    return isRecord(candidate) ? candidate : {};
}

function readOperationResult(value: Record<string, unknown>): unknown {
    if (Object.prototype.hasOwnProperty.call(value, 'result')) return value.result;
    if (Object.prototype.hasOwnProperty.call(value, 'output')) return value.output;
    if (Object.prototype.hasOwnProperty.call(value, 'actualResult')) return value.actualResult;
    if (Object.prototype.hasOwnProperty.call(value, 'data')) return value.data;
    return value;
}

function readDeclaredSuccess(value: Record<string, unknown>, result: unknown): boolean {
    if (value.success === false) return false;
    return !isRecord(result) || result.success !== false;
}

function hasVerifiableNestedPhotoshopWrite(
    name: string,
    operationArguments: unknown,
    result: unknown
): boolean {
    if (classifyAgentToolExecution(name, operationArguments) !== 'photoshop_write') return true;
    return findObservedPhotoshopMutationProof(result)?.toolActionCompleted === true;
}

/**
 * 将顶层 Agent Tool 日志与 Skill 内声明式 Tool 日志投影为单一有序 ledger。
 *
 * - 顶层原子 Tool 保持原顺序；
 * - 含内部日志的顶层 Skill 先保留为不可执行 workflow envelope，再按公开顺序展开内部操作；
 * - 嵌套写操作没有 Host mutation proof 时标为未验证，裸 success 不取得完成信用；
 * - 无名称、无结果身份或藏在任意业务对象中的内容不会被猜成 Tool 操作。
 */
export function buildAgentOperationLedger(
    sourceEntries: readonly AgentOperationLedgerSourceEntry[]
): AgentOperationLedgerEntry[] {
    const ledger: AgentOperationLedgerEntry[] = [];
    const visited = new WeakSet<object>();
    let visitedNodeCount = 0;

    function collectDeclaredOperations(
        container: unknown,
        input: {
            topLevelIndex: number;
            depth: number;
            resultPath: string;
            parentOperationName: string;
            inherited: AgentOperationLedgerSourceEntry;
        }
    ): number {
        if (input.depth > MAX_LEDGER_DEPTH
            || visitedNodeCount >= MAX_VISITED_NODE_COUNT
            || !isRecord(container)) {
            return 0;
        }
        if (visited.has(container)) return 0;
        visited.add(container);
        visitedNodeCount += 1;

        let appended = 0;
        for (const [key, child] of Object.entries(container)) {
            const normalizedKey = normalizeLedgerKey(key);
            if (DECLARED_LEDGER_KEYS.has(normalizedKey) && Array.isArray(child)) {
                if (visited.has(child) || visitedNodeCount >= MAX_VISITED_NODE_COUNT) continue;
                visited.add(child);
                visitedNodeCount += 1;
                const ledgerPath = `${input.resultPath}.${key}`;
                for (let index = 0; index < Math.min(child.length, MAX_LEDGER_ARRAY_LENGTH); index += 1) {
                    const rawOperation = child[index];
                    if (!isRecord(rawOperation)) continue;
                    const operationName = readOperationName(rawOperation);
                    if (!operationName.name) continue;
                    const operationArguments = readOperationArguments(rawOperation);
                    const operationResult = readOperationResult(rawOperation);
                    const declaredSuccess = readDeclaredSuccess(rawOperation, operationResult);
                    const succeeded = declaredSuccess && hasVerifiableNestedPhotoshopWrite(
                        operationName.name,
                        operationArguments,
                        operationResult
                    );
                    const operationLedgerIndex = ledger.length;
                    ledger.push({
                        ...(typeof rawOperation.callId === 'string'
                            ? { callId: rawOperation.callId }
                            : {}),
                        name: operationName.name,
                        arguments: operationArguments,
                        result: operationResult,
                        ...(input.inherited.origin !== undefined
                            ? { origin: input.inherited.origin }
                            : {}),
                        ...(input.inherited.failureDisposition !== undefined
                            ? { failureDisposition: input.inherited.failureDisposition }
                            : {}),
                        ...(input.inherited.qualityVerificationPhase !== undefined
                            ? { qualityVerificationPhase: input.inherited.qualityVerificationPhase }
                            : {}),
                        succeeded,
                        operationLedgerProvenance: {
                            role: 'nested_operation',
                            topLevelIndex: input.topLevelIndex,
                            depth: input.depth,
                            resultPath: `${ledgerPath}[${index}]`,
                            declaredName: operationName.declaredName,
                            parentOperationName: input.parentOperationName
                        }
                    });
                    appended += 1;
                    const nestedOperationCount = collectDeclaredOperations(rawOperation, {
                        ...input,
                        depth: input.depth + 1,
                        resultPath: `${ledgerPath}[${index}]`,
                        parentOperationName: operationName.name
                    });
                    if (nestedOperationCount > 0) {
                        ledger[operationLedgerIndex].succeeded = false;
                        ledger[operationLedgerIndex].operationLedgerProvenance.role = 'workflow_envelope';
                    }
                    appended += nestedOperationCount;
                }
                continue;
            }
            if (STABLE_ENVELOPE_KEYS.has(normalizedKey)) {
                appended += collectDeclaredOperations(child, {
                    ...input,
                    depth: input.depth + 1,
                    resultPath: `${input.resultPath}.${key}`
                });
            }
        }
        return appended;
    }

    const entries = Array.isArray(sourceEntries) ? sourceEntries : [];
    for (let topLevelIndex = 0; topLevelIndex < entries.length; topLevelIndex += 1) {
        const source = entries[topLevelIndex] || {};
        const operationName = normalizeDeclaredOperationName(source.name);
        if (!operationName.name) continue;
        const isTrustedSkillWorkflowEnvelope = hasTrustedSkillWorkflowBridgeReceipt(
            operationName.name,
            source.result
        );
        const nestedStart = ledger.length;
        const nestedCount = isTrustedSkillWorkflowEnvelope
            ? collectDeclaredOperations(source.result, {
                topLevelIndex,
                depth: 1,
                resultPath: '$.result',
                parentOperationName: operationName.name,
                inherited: source
            })
            : 0;
        const topLevelEntry: AgentOperationLedgerEntry = {
            ...(typeof source.callId === 'string' ? { callId: source.callId } : {}),
            name: operationName.name,
            arguments: isRecord(source.arguments) ? source.arguments : {},
            result: source.result,
            ...(source.origin !== undefined ? { origin: source.origin } : {}),
            ...(source.failureDisposition !== undefined
                ? { failureDisposition: source.failureDisposition }
                : {}),
            ...(source.qualityVerificationPhase !== undefined
                ? { qualityVerificationPhase: source.qualityVerificationPhase }
                : {}),
            ...(isTrustedSkillWorkflowEnvelope ? { succeeded: false } : {}),
            operationLedgerProvenance: {
                role: isTrustedSkillWorkflowEnvelope ? 'workflow_envelope' : 'top_level_operation',
                topLevelIndex,
                depth: 0,
                resultPath: '$.result',
                declaredName: operationName.declaredName
            }
        };
        // envelope 不是操作；保留它只为 Skill 级质量包/恢复元数据提供同一 ledger 上的来源。
        // 内部操作必须紧跟其后并保留声明顺序。
        ledger.splice(nestedStart, 0, topLevelEntry);
    }

    return ledger;
}
