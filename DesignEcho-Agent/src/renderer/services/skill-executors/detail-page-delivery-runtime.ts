/**
 * Detail-page delivery evidence projector.
 *
 * The Skill owns the master/slice artifact roles. Runtime owns the immutable
 * pre-write plan binding. This module only verifies the actual UXP save/export
 * readbacks and projects them into the shared delivery receipt contract.
 */

import {
    buildRuntimeDeliveryReceipt,
    hasVerifiedEditableDocumentArtifact,
    type RuntimeDeliveryArtifactEntry,
    type RuntimeDeliveryReceipt
} from '../../../shared/agent-runtime-v5/runtime-delivery-receipt';
import {
    readPhotoshopSourceHistoryStateRef,
    type PhotoshopHistoryStateRef
} from '../../../shared/photoshop-history-state-ref';
import { normalizeSkillDeliveryArtifactPath } from '../../../shared/skills/skill-delivery-convention';
import type { DetailPageDeliveryPlan } from './detail-page-delivery-plan';

export interface DetailPageDeliveryRuntimeEvidence {
    receipt: RuntimeDeliveryReceipt;
    sourceHistoryStateRef?: PhotoshopHistoryStateRef;
    documentId?: number;
    issues: string[];
}

function isRecord(value: unknown): value is Record<string, any> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function collectRecords(value: unknown): Record<string, any>[] {
    const records: Record<string, any>[] = [];
    const seen = new Set<object>();
    const visit = (candidate: unknown, depth: number): void => {
        if (depth > 7 || candidate === null || candidate === undefined) return;
        if (Array.isArray(candidate)) {
            candidate.slice(0, 96).forEach((item) => visit(item, depth + 1));
            return;
        }
        if (!isRecord(candidate) || seen.has(candidate)) return;
        seen.add(candidate);
        records.push(candidate);
        Object.values(candidate).slice(0, 96).forEach((item) => visit(item, depth + 1));
    };
    visit(value, 0);
    return records;
}

function sameHistoryStateRef(
    left: PhotoshopHistoryStateRef | undefined,
    right: PhotoshopHistoryStateRef | undefined
): boolean {
    return Boolean(left
        && right
        && left.documentId === right.documentId
        && left.historyStateId === right.historyStateId);
}

function normalizePaths(values: readonly unknown[]): string[] {
    return values.map(normalizeSkillDeliveryArtifactPath).filter(Boolean);
}

function sameOrderedPaths(left: readonly unknown[], right: readonly unknown[]): boolean {
    const normalizedLeft = normalizePaths(left);
    const normalizedRight = normalizePaths(right);
    return normalizedLeft.length === normalizedRight.length
        && normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function readEditableSaveRecord(
    result: unknown,
    expectedPath: string
): Record<string, any> | undefined {
    const expectedPathKey = normalizeSkillDeliveryArtifactPath(expectedPath);
    return collectRecords(result).find((record) => {
        if (record.success !== true || !hasVerifiedEditableDocumentArtifact(record)) return false;
        const savedPath = String(record.savedPath || record.filePath || '').trim();
        return normalizeSkillDeliveryArtifactPath(savedPath) === expectedPathKey;
    });
}

function readSliceExportRecord(input: {
    result: unknown;
    plan: DetailPageDeliveryPlan;
    expectedPaths: readonly string[];
}): Record<string, any> | undefined {
    const expectedPaths = input.expectedPaths;
    const expectedScreenIds = input.plan.slices.map((slice) => slice.screenId);
    return collectRecords(input.result).find((record) => {
        const deliveryArtifact = isRecord(record.sliceDeliveryArtifact)
            ? record.sliceDeliveryArtifact
            : undefined;
        const screenSetArtifact = isRecord(record.screenSetArtifact)
            ? record.screenSetArtifact
            : undefined;
        const screens = Array.isArray(record.screens) ? record.screens : [];
        const actualScreenIds = screens.map((screen) => (
            isRecord(screen) ? String(screen.screenId || '').trim() : ''
        ));
        const actualPaths = screens.map((screen) => (
            isRecord(screen) ? screen.path : undefined
        ));
        return Boolean(
            record.success === true
            && deliveryArtifact?.version === 'runtime-detail-page-slice-delivery-artifact/v1'
            && deliveryArtifact.basis === 'uxp_exact_no_replace_slice_export'
            && deliveryArtifact.deliveryPlanDigest === input.plan.deliveryPlanDigest
            && deliveryArtifact.exactArtifactSet === true
            && sameOrderedPaths(deliveryArtifact.expectedPaths || [], expectedPaths)
            && sameOrderedPaths(deliveryArtifact.exportedPaths || [], expectedPaths)
            && screenSetArtifact?.version === 'runtime-screen-set-artifact/v1'
            && screenSetArtifact.basis === 'uxp_full_document_screen_parse'
            && JSON.stringify(screenSetArtifact.expectedScreenIds || []) === JSON.stringify(expectedScreenIds)
            && JSON.stringify(screenSetArtifact.exportedScreenIds || []) === JSON.stringify(expectedScreenIds)
            && JSON.stringify(actualScreenIds) === JSON.stringify(expectedScreenIds)
            && sameOrderedPaths(actualPaths, expectedPaths)
        );
    });
}

function planBinding(artifact: DetailPageDeliveryPlan['artifacts'][number]): NonNullable<
    RuntimeDeliveryArtifactEntry['planBinding']
> {
    return {
        artifactId: artifact.artifactId,
        pairId: artifact.pairId,
        order: artifact.order,
        format: artifact.format,
        sourceHistoryRole: artifact.sourceHistoryRole
    };
}

function deliveryOutputsForWorkMode(workMode: unknown): string[] {
    switch (String(workMode || '').trim().toLowerCase()) {
        case 'redesign':
            return ['detail_page_psd', 'detail_page_slices', 'redesign_report'];
        case 'template_fill':
            return ['detail_page_psd', 'detail_page_slices', 'template_fill_report'];
        case 'export_only':
            return ['detail_page_slices', 'delivery_manifest'];
        case 'edit_existing':
            return ['updated_detail_page_psd', 'change_verification_report'];
        case 'create_new':
        default:
            return ['detail_page_psd', 'detail_page_slices', 'delivery_record'];
    }
}

export function buildDetailPageDeliveryRuntimeEvidence(input: {
    plan: DetailPageDeliveryPlan;
    workMode?: unknown;
    expectedSourceHistoryStateRef: PhotoshopHistoryStateRef;
    saveResult?: unknown;
    sliceResult?: unknown;
    stagedPathsByArtifactId: Readonly<Record<string, string>>;
    committedFiles: ReadonlyArray<{
        path: string;
        byteLength: number;
        sha256: string;
    }>;
}): DetailPageDeliveryRuntimeEvidence {
    const issues: string[] = [];
    const saveRecord = input.plan.editable
        ? readEditableSaveRecord(
            input.saveResult,
            input.stagedPathsByArtifactId[input.plan.editable.artifactId]
        )
        : undefined;
    const expectedSliceStagePaths = input.plan.slices.map((slice) => (
        input.stagedPathsByArtifactId[slice.artifactId]
    ));
    const sliceRecord = input.plan.slices.length > 0
        ? readSliceExportRecord({
            result: input.sliceResult,
            plan: input.plan,
            expectedPaths: expectedSliceStagePaths
        })
        : undefined;
    const saveHistoryStateRef = saveRecord
        ? readPhotoshopSourceHistoryStateRef(saveRecord)
        : undefined;
    const sliceHistoryStateRef = sliceRecord
        ? readPhotoshopSourceHistoryStateRef(sliceRecord)
        : undefined;
    if (input.plan.editable && !saveRecord) issues.push('可编辑母稿缺少 UXP 暂存副本元数据证明。');
    if (input.plan.slices.length > 0 && !sliceRecord) {
        issues.push('详情页切片缺少完整屏集合、精确暂存路径或无覆盖导出证明。');
    }
    const saveHistoryMatches = !input.plan.editable
        || sameHistoryStateRef(saveHistoryStateRef, input.expectedSourceHistoryStateRef);
    const sliceHistoryMatches = input.plan.slices.length === 0
        || sameHistoryStateRef(sliceHistoryStateRef, input.expectedSourceHistoryStateRef);
    if (!saveHistoryMatches || !sliceHistoryMatches) {
        issues.push('可编辑母稿、切片与视觉复核通过的 Photoshop 版本不一致。');
    }

    const committedByPath = new Map(input.committedFiles.map((file) => (
        [normalizeSkillDeliveryArtifactPath(file.path), file] as const
    )));
    if (committedByPath.size !== input.plan.artifacts.length) {
        issues.push('主进程提交后的完整文件集合与冻结计划数量不一致。');
    }
    const artifacts: RuntimeDeliveryArtifactEntry[] = input.plan.artifacts.flatMap((artifact) => {
        const committed = committedByPath.get(normalizeSkillDeliveryArtifactPath(artifact.path));
        const sourceHistoryStateRef = artifact.kind === 'editable_document'
            ? saveHistoryStateRef
            : sliceHistoryStateRef;
        if (!committed
            || !sourceHistoryStateRef
            || !Number.isSafeInteger(committed.byteLength)
            || committed.byteLength <= 0
            || !/^[a-f0-9]{64}$/i.test(committed.sha256)) return [];
        return [{
            path: artifact.path,
            kind: artifact.kind,
            proof: artifact.kind === 'editable_document'
                ? 'staged_editable_document_promotion' as const
                : 'file_probe' as const,
            fileIdentity: {
                sha256: committed.sha256.toLowerCase(),
                byteLength: committed.byteLength
            },
            sourceHistoryStateRef,
            planBinding: planBinding(artifact)
        }];
    });
    const resultRefSuffix = input.plan.deliveryPlanDigest.split(':').pop()?.slice(0, 12) || 'unknown';
    const resultRefs = input.committedFiles.map((file, index) => (
        `detail-page-commit-${index + 1}-${file.sha256.slice(0, 12) || resultRefSuffix}`
    ));
    const receipt = buildRuntimeDeliveryReceipt({
        status: issues.length === 0 && artifacts.length === input.plan.artifacts.length
            ? 'ready'
            : 'incomplete',
        settlementScope: 'single_document_revision',
        outputs: deliveryOutputsForWorkMode(input.workMode),
        resultRefs,
        resultRefProofs: resultRefs.map((resultRef) => ({
            resultRef,
            effect: 'save_export' as const
        })),
        artifacts,
        expectedDeliveryPlan: {
            digest: input.plan.deliveryPlanDigest,
            convention: input.plan.convention,
            artifacts: input.plan.artifacts
        },
        sourceHistoryStateRef: input.expectedSourceHistoryStateRef,
        issues
    });
    return {
        receipt,
        sourceHistoryStateRef: receipt.sourceHistoryStateRef,
        documentId: receipt.sourceHistoryStateRef?.documentId,
        issues: [...receipt.issues]
    };
}
