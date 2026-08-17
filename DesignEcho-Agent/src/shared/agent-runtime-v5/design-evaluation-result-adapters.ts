/**
 * 版本化 Skill 结果 → Evaluation Profile verification record 通用聚合器。
 *
 * 聚合器只负责注册解析、来源定位、mutation 时序失效与问题汇总；具体 Profile、
 * Skill bridge 和业务契约由 contribution 提供。这里不调用 Tool / 模型，不根据
 * 任务文本或 result.success 猜测质量，也不拥有最终 DesignVerdict。
 */

import {
    DESIGN_EVALUATION_RESULT_ADAPTER_CONTRIBUTIONS,
    type DesignEvaluationResultAdapterContribution
} from './design-evaluation-result-adapter-contributions';
import {
    type DesignEvaluationProfile,
    type DesignEvaluationVerificationRecord
} from './design-evaluation-profiles';

export interface DesignEvaluationSourceToolResult {
    name: string;
    result?: unknown;
}

export type DesignEvaluationResultAdapterIssueCode =
    | 'source_not_found'
    | 'source_contract_invalid'
    | 'source_stale_after_mutation'
    | 'explicit_failure_observed'
    | 'quality_review_required';

export interface DesignEvaluationResultAdapterResult {
    version: 'design-evaluation-result-adapter/v0';
    profileId: DesignEvaluationProfile['profileId'];
    sourceToolName?: string;
    sourceIndex?: number;
    records: DesignEvaluationVerificationRecord[];
    issueCodes: DesignEvaluationResultAdapterIssueCode[];
    boundaries: {
        executesTools: false;
        callsModel: false;
        trustsToolSuccessAsQualityPass: false;
        acceptsOnlyVersionedBusinessContracts: true;
        staleRecordsCanPass: false;
        finalVerdictOwnedByAdapter: false;
    };
}

export interface DesignEvaluationResultAdapterRegistry {
    version: 'design-evaluation-result-adapter-registry/v0';
    profileIds: readonly DesignEvaluationProfile['profileId'][];
    resolve(
        profileId: DesignEvaluationProfile['profileId']
    ): DesignEvaluationResultAdapterContribution | undefined;
}

const ADAPTER_BOUNDARIES: DesignEvaluationResultAdapterResult['boundaries'] = Object.freeze({
    executesTools: false,
    callsModel: false,
    trustsToolSuccessAsQualityPass: false,
    acceptsOnlyVersionedBusinessContracts: true,
    staleRecordsCanPass: false,
    finalVerdictOwnedByAdapter: false
});

function readRecord(value: unknown): Record<string, any> | undefined {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, any>
        : undefined;
}

function unique<T extends string>(values: T[]): T[] {
    return Array.from(new Set(values));
}

function findLatestSource(input: {
    toolResults: readonly DesignEvaluationSourceToolResult[];
    sourceToolName: string;
}): { index: number; result: Record<string, any>; data?: Record<string, any> } | undefined {
    for (let index = input.toolResults.length - 1; index >= 0; index -= 1) {
        const entry = input.toolResults[index];
        if (entry.name !== input.sourceToolName) continue;
        const result = readRecord(entry.result);
        if (!result) return { index, result: {} };
        return { index, result, data: readRecord(result.data) };
    }
    return undefined;
}

function resultIssues(records: DesignEvaluationVerificationRecord[]): DesignEvaluationResultAdapterIssueCode[] {
    const issues: DesignEvaluationResultAdapterIssueCode[] = [];
    if (records.some((record) => record.status === 'failed')) issues.push('explicit_failure_observed');
    if (records.some((record) => record.status === 'needs_review')) issues.push('quality_review_required');
    return issues;
}

function staleRecords(records: DesignEvaluationVerificationRecord[]): DesignEvaluationVerificationRecord[] {
    return records.map((record) => ({
        ...record,
        status: 'needs_review',
        verificationRef: `quality-adapter:${record.key}:stale`
    }));
}

/**
 * 从不可变贡献列表创建查找表。重复或无效身份在组合阶段直接失败，避免后注册覆盖前注册。
 */
export function createDesignEvaluationResultAdapterRegistry(
    contributions: readonly DesignEvaluationResultAdapterContribution[]
): DesignEvaluationResultAdapterRegistry {
    const byProfileId = new Map<
        DesignEvaluationProfile['profileId'],
        DesignEvaluationResultAdapterContribution
    >();
    for (const item of contributions) {
        const profileId = String(item.profileId || '').trim() as DesignEvaluationProfile['profileId'];
        const sourceToolName = String(item.sourceToolName || '').trim();
        if (!profileId || !sourceToolName || typeof item.buildRecords !== 'function') {
            throw new Error('Evaluation result adapter contribution 非法：必须声明 profileId、sourceToolName 和 buildRecords。');
        }
        if (byProfileId.has(profileId)) {
            throw new Error(`Evaluation result adapter contribution 重复注册 Profile：${profileId}`);
        }
        byProfileId.set(profileId, Object.freeze({
            ...item,
            profileId,
            sourceToolName
        }));
    }
    const profileIds = Object.freeze(Array.from(byProfileId.keys()));
    return Object.freeze({
        version: 'design-evaluation-result-adapter-registry/v0',
        profileIds,
        resolve(profileId: DesignEvaluationProfile['profileId']): DesignEvaluationResultAdapterContribution | undefined {
            const normalized = String(profileId || '').trim() as DesignEvaluationProfile['profileId'];
            return byProfileId.get(normalized);
        }
    });
}

const DEFAULT_DESIGN_EVALUATION_RESULT_ADAPTER_REGISTRY = createDesignEvaluationResultAdapterRegistry(
    DESIGN_EVALUATION_RESULT_ADAPTER_CONTRIBUTIONS
);

/**
 * 保留既有公开 facade；Profile 对应哪个 Skill 结果、如何翻译完全由 registry contribution 决定。
 */
export function adaptDesignEvaluationRecordsFromToolResults(input: {
    profile: DesignEvaluationProfile;
    toolResults: readonly DesignEvaluationSourceToolResult[];
    /** Agent 运行日志中最后一次成功 mutation 的下标；更早的质量记录必须失效。 */
    lastMutationIndex?: number;
}): DesignEvaluationResultAdapterResult {
    const adapter = DEFAULT_DESIGN_EVALUATION_RESULT_ADAPTER_REGISTRY.resolve(input.profile.profileId);
    if (!adapter) {
        return {
            version: 'design-evaluation-result-adapter/v0',
            profileId: input.profile.profileId,
            records: [],
            issueCodes: [],
            boundaries: ADAPTER_BOUNDARIES
        };
    }
    const sourceToolName = adapter.sourceToolName;
    const source = findLatestSource({ toolResults: input.toolResults, sourceToolName });
    if (!source) {
        return {
            version: 'design-evaluation-result-adapter/v0',
            profileId: input.profile.profileId,
            sourceToolName,
            records: [],
            issueCodes: ['source_not_found'],
            boundaries: ADAPTER_BOUNDARIES
        };
    }
    const records = source.data ? adapter.buildRecords(source.data) : [];
    if (records.length === 0) {
        return {
            version: 'design-evaluation-result-adapter/v0',
            profileId: input.profile.profileId,
            sourceToolName,
            sourceIndex: source.index,
            records: [],
            issueCodes: ['source_contract_invalid'],
            boundaries: ADAPTER_BOUNDARIES
        };
    }
    const lastMutationIndex = Number.isFinite(input.lastMutationIndex)
        ? Number(input.lastMutationIndex)
        : -1;
    const isStale = source.index < lastMutationIndex;
    const finalRecords = isStale ? staleRecords(records) : records;
    return {
        version: 'design-evaluation-result-adapter/v0',
        profileId: input.profile.profileId,
        sourceToolName,
        sourceIndex: source.index,
        records: finalRecords,
        issueCodes: unique([
            ...(isStale ? ['source_stale_after_mutation' as const] : []),
            ...resultIssues(finalRecords)
        ]),
        boundaries: ADAPTER_BOUNDARIES
    };
}

export type { DesignEvaluationResultAdapterContribution } from './design-evaluation-result-adapter-contributions';
