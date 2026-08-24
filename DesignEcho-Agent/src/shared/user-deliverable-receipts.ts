/**
 * 用户点名交付物的收据投影（纯逻辑，无 IO）。
 *
 * 本模块只做字面归属：用户写了哪些交付名，就在真实文件/文档证据里寻找同名引用。
 * 它不识别业务品类、不选择 Skill，也不把一个候选收据重复分配给多个交付物。
 */

import type { UserDeclaredDeliverable } from './user-declared-deliverables';
import { classifyAgentToolExecution } from './agent-tool-execution-preflight';

export type UserDeliverableEvidenceKind = 'file' | 'document_write';

export interface UserDeliverableEvidenceCandidate {
    id: string;
    kind: UserDeliverableEvidenceKind;
    reference: string;
    toolName: string;
    logIndex: number;
}

export interface UserDeliverableReceiptProjection {
    deliverableId: string;
    label: string;
    status: 'passed' | 'failed' | 'needs_review';
    receipt?: UserDeliverableEvidenceCandidate;
    matchingCandidateIds: string[];
    reason?: string;
}

interface UserDeliverableToolLogEntryLike {
    name?: unknown;
    arguments?: unknown;
    result?: unknown;
    succeeded?: unknown;
}

const FILE_PATH_PATTERN = /\.(?:psd|psb|png|jpe?g|webp|tiff?|gif|bmp|pdf|svg)(?:$|[?#])/iu;
const DELIVERY_RESULT_KEYS = new Set([
    'outputPath',
    'path',
    'filePath',
    'savedPath',
    'savePath',
    'exportedPath',
    'exportedFiles',
    'files',
    'outputs',
    'results',
    'exports',
    'data',
    'editableDocumentArtifact'
]);

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function collectResultFilePaths(value: unknown, into: Set<string>, depth: number): void {
    if (depth > 4 || into.size >= 64) return;
    if (typeof value === 'string') {
        const path = value.trim();
        if (FILE_PATH_PATTERN.test(path) && !/^data:/iu.test(path)) into.add(path);
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) collectResultFilePaths(item, into, depth + 1);
        return;
    }
    if (!isRecord(value)) return;
    for (const [key, nested] of Object.entries(value)) {
        if (DELIVERY_RESULT_KEYS.has(key)) collectResultFilePaths(nested, into, depth + 1);
    }
}

/** 只消费成功 save/export Tool 的结果路径；调用参数中的目标路径不能冒充落盘收据。 */
export function collectUserDeliverableFileEvidence(
    log: readonly UserDeliverableToolLogEntryLike[]
): UserDeliverableEvidenceCandidate[] {
    const candidates: UserDeliverableEvidenceCandidate[] = [];
    for (let index = 0; index < log.length; index += 1) {
        const entry = log[index];
        const name = String(entry?.name || '').trim();
        if (!name
            || name === 'smartSave'
            || entry?.succeeded === false
            || !isRecord(entry?.result)
            || entry.result.success === false
            || classifyAgentToolExecution(name, entry.arguments) !== 'save_export') {
            continue;
        }
        const paths = new Set<string>();
        collectResultFilePaths(entry.result, paths, 0);
        for (const path of paths) {
            candidates.push({
                id: `file:${index}:${normalizeLiteral(path)}`,
                kind: 'file',
                reference: path,
                toolName: name,
                logIndex: index
            });
        }
    }
    return candidates;
}

function normalizeLiteral(value: unknown): string {
    return String(value || '')
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/[\s._-]+/gu, '');
}

function candidateMatchesLabel(
    candidate: UserDeliverableEvidenceCandidate,
    label: string
): boolean {
    const normalizedLabel = normalizeLiteral(label);
    if (normalizedLabel.length < 2) return false;
    return normalizeLiteral(candidate.reference).includes(normalizedLabel);
}

function uniqueCandidates(
    candidates: readonly UserDeliverableEvidenceCandidate[],
    requiredKind: UserDeliverableEvidenceKind
): UserDeliverableEvidenceCandidate[] {
    const byReference = new Map<string, UserDeliverableEvidenceCandidate>();
    for (const candidate of candidates) {
        if (candidate.kind !== requiredKind) continue;
        const referenceKey = normalizeLiteral(candidate.reference);
        if (!referenceKey) continue;
        const existing = byReference.get(referenceKey);
        if (!existing || candidate.logIndex > existing.logIndex) {
            byReference.set(referenceKey, { ...candidate });
        }
    }
    return [...byReference.values()].sort((left, right) => left.logIndex - right.logIndex);
}

/**
 * 将真实候选证据逐一归属到用户点名的交付物。
 *
 * - 没有任何候选：确定性缺失（failed）。
 * - 有候选但名称无法归属：事实可能存在但身份未知（needs_review）。
 * - 同一候选同时命中多个交付名：拒绝重复记账（needs_review）。
 * - 只有唯一归属的候选才签发 passed 收据。
 */
export function projectUserDeliverableReceipts(input: {
    deliverables: readonly UserDeclaredDeliverable[];
    candidates: readonly UserDeliverableEvidenceCandidate[];
    requiredKind: UserDeliverableEvidenceKind;
}): UserDeliverableReceiptProjection[] {
    const deliverables = Array.isArray(input.deliverables) ? input.deliverables : [];
    const candidates = uniqueCandidates(input.candidates, input.requiredKind);
    const matchingDeliverableIdsByCandidate = new Map<string, string[]>();

    for (const candidate of candidates) {
        const matchingIds = deliverables
            .filter((deliverable) => candidateMatchesLabel(candidate, deliverable.label))
            .map((deliverable) => deliverable.id);
        matchingDeliverableIdsByCandidate.set(candidate.id, matchingIds);
    }

    const assignedCandidateIds = new Set<string>();
    return deliverables.map((deliverable) => {
        const matches = candidates.filter((candidate) => (
            candidateMatchesLabel(candidate, deliverable.label)
        ));
        const uniqueMatches = matches.filter((candidate) => (
            matchingDeliverableIdsByCandidate.get(candidate.id)?.length === 1
        ));
        const receipt = uniqueMatches.find((candidate) => !assignedCandidateIds.has(candidate.id));
        if (receipt) {
            assignedCandidateIds.add(receipt.id);
            return {
                deliverableId: deliverable.id,
                label: deliverable.label,
                status: 'passed',
                receipt,
                matchingCandidateIds: matches.map((candidate) => candidate.id)
            };
        }

        if (candidates.length === 0) {
            return {
                deliverableId: deliverable.id,
                label: deliverable.label,
                status: 'failed',
                matchingCandidateIds: [],
                reason: `没有找到“${deliverable.label}”的真实${input.requiredKind === 'file' ? '保存或导出文件' : '文档写入'}收据。`
            };
        }

        const hasAmbiguousMatch = matches.some((candidate) => (
            (matchingDeliverableIdsByCandidate.get(candidate.id)?.length || 0) > 1
                || assignedCandidateIds.has(candidate.id)
        ));
        return {
            deliverableId: deliverable.id,
            label: deliverable.label,
            status: 'needs_review',
            matchingCandidateIds: matches.map((candidate) => candidate.id),
            reason: hasAmbiguousMatch
                ? `现有收据无法唯一归属于“${deliverable.label}”；同一个文件或文档不能同时证明多个交付物。`
                : `存在交付证据，但名称或路径无法证明它属于“${deliverable.label}”。`
        };
    });
}
