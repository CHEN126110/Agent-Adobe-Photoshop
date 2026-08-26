/**
 * 受控设计可靠性采集使用的最终交付路径投影。
 *
 * Runtime 先把 Manifest/行动计划已归属并完成 E2 复核的交付结果映射为真实文件路径；
 * 这里仅把位于本次 fixture 项目内的路径机械转换为相对引用。它不扫描目录、不挑成稿，
 * 也不会把项目外绝对路径或目录穿越写进 Debug Bridge 收据。
 */
export function normalizeDebugFinalArtifactRefs(
    values: unknown,
    expectedProjectPath: unknown
): string[] {
    if (!Array.isArray(values)) return [];
    const projectRoot = String(expectedProjectPath || '')
        .trim()
        .replace(/\\/g, '/')
        .replace(/\/+$/, '');
    const projectRootIdentity = projectRoot.toLowerCase();
    const refs: string[] = [];
    for (const value of values) {
        const candidate = String(value || '').trim().replace(/\\/g, '/');
        if (!candidate) continue;
        const candidateIdentity = candidate.toLowerCase();
        let relativeRef = candidate;
        if (projectRootIdentity && candidateIdentity.startsWith(`${projectRootIdentity}/`)) {
            relativeRef = candidate.slice(projectRoot.length + 1);
        } else if (/^[a-z][a-z0-9+.-]*:/i.test(candidate) || candidate.startsWith('/')) {
            continue;
        }
        relativeRef = relativeRef.replace(/^\.\//, '').replace(/\/+/g, '/');
        if (!relativeRef
            || relativeRef.split('/').includes('..')
            || relativeRef.includes('\0')
            || !/\.(?:psd|psb|jpe?g|png|webp)$/i.test(relativeRef)) {
            continue;
        }
        if (!refs.includes(relativeRef)) refs.push(relativeRef);
    }
    return refs.slice(0, 96);
}

export interface DebugSkuDeliveryEvidence {
    version: 'debug-sku-delivery-evidence/v2';
    runtimeDeliveryReceipt: {
        status: 'ready';
        settlementScope: 'multi_document_task';
        outputs: string[];
        resultRefs: string[];
        resultRefProofs: Array<{ resultRef: string; effect: 'save_export' }>;
        artifacts: Array<{
            path: string;
            kind: 'editable_document' | 'raster_export';
            proof: 'file_probe' | 'staged_editable_document_promotion';
            fileIdentity: { sha256: string; byteLength: number };
            sourceHistoryStateRef: { documentId: number; historyStateId: number };
        }>;
    };
    skuExportReadback: {
        version: 'sku-export-readback/v0';
        status: 'ready_for_review';
        expectedExportCount: number;
        actualExportCount: number;
        fileProbeCount: number;
        okFileProbeCount: number;
        failedFileProbeCount: number;
        missingFileProbeCount: number;
        dimensionMismatchCount: number;
        staleFileProbeCount: number;
        visualMetricBlockerCount: number;
        missingVisualMetricCount: number;
    };
    skuEditableDeliveryReadback: {
        version: 'sku-editable-delivery-readback/v1';
        status: 'ready';
        expectedCount: number;
        verifiedCount: number;
        expectedPaths: string[];
        verifiedPaths: string[];
        missingItemIds: string[];
        violations: string[];
        items: Array<{
            itemId: string;
            rasterPath: string;
            editablePath: string;
            templateName: string;
            combination: string[];
            sourceHistoryStateRef: { documentId: number; historyStateId: number };
            fileIdentity: { sha256: string; byteLength: number };
            copiedLayerIds: number[];
            copiedLayerNames: string[];
            freshnessProof: 'new_path' | 'modified_since_baseline';
            promotionVerified: true;
        }>;
    };
    boundaries: {
        developmentEvidenceOnly: true;
        normalizedProjectRelativePathsOnly: true;
        doesNotAffectRuntimeCompletion: true;
        doesNotJudgeDesignQuality: true;
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readPositiveInteger(value: unknown): number | undefined {
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : undefined;
}

function readNonNegativeInteger(value: unknown): number | undefined {
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : undefined;
}

function readFileIdentity(value: unknown): { sha256: string; byteLength: number } | undefined {
    if (!isRecord(value)) return undefined;
    const sha256 = String(value.sha256 || '').trim().toLowerCase();
    const byteLength = readPositiveInteger(value.byteLength);
    return /^[a-f0-9]{64}$/.test(sha256) && byteLength
        ? { sha256, byteLength }
        : undefined;
}

function readExactTextArray(value: unknown, limit: number): string[] | undefined {
    if (!Array.isArray(value) || value.length > limit) return undefined;
    const normalized = value.map((item) => String(item || '').trim());
    if (normalized.some((item) => !item) || new Set(normalized).size !== normalized.length) {
        return undefined;
    }
    return normalized;
}

function normalizeExactArtifactRefs(
    value: unknown,
    expectedProjectPath: unknown,
    limit: number
): string[] | undefined {
    if (!Array.isArray(value) || value.length === 0 || value.length > limit) return undefined;
    const refs = normalizeDebugFinalArtifactRefs(value, expectedProjectPath);
    return refs.length === value.length ? refs : undefined;
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
    if (left.length !== right.length) return false;
    const sortedLeft = [...left].sort();
    const sortedRight = [...right].sort();
    return sortedLeft.every((value, index) => value === sortedRight[index]);
}

export function normalizeDebugSkuDeliveryEvidence(
    value: unknown,
    expectedProjectPath: unknown
): DebugSkuDeliveryEvidence | undefined {
    if (!isRecord(value) || value.version !== 'agent-debug-sku-delivery-source/v1') return undefined;
    const receipt = isRecord(value.runtimeDeliveryReceipt) ? value.runtimeDeliveryReceipt : undefined;
    const exportReadback = isRecord(value.skuExportReadback) ? value.skuExportReadback : undefined;
    const editableReadback = isRecord(value.skuEditableDeliveryReadback)
        ? value.skuEditableDeliveryReadback
        : undefined;
    if (!receipt
        || receipt.status !== 'ready'
        || receipt.settlementScope !== 'multi_document_task'
        || !exportReadback
        || exportReadback.version !== 'sku-export-readback/v0'
        || exportReadback.status !== 'ready_for_review'
        || !editableReadback
        || editableReadback.version !== 'sku-editable-delivery-readback/v1'
        || editableReadback.status !== 'ready') {
        return undefined;
    }
    const outputs = readExactTextArray(receipt.outputs, 16);
    const resultRefs = readExactTextArray(receipt.resultRefs, 48);
    if (!outputs || !resultRefs || !Array.isArray(receipt.resultRefProofs)) return undefined;
    const resultRefProofs = receipt.resultRefProofs.flatMap((proof) => {
        if (!isRecord(proof)
            || proof.effect !== 'save_export'
            || typeof proof.resultRef !== 'string'
            || !resultRefs.includes(proof.resultRef)) {
            return [];
        }
        return [{ resultRef: proof.resultRef, effect: 'save_export' as const }];
    });
    if (resultRefProofs.length !== receipt.resultRefProofs.length
        || resultRefProofs.length !== resultRefs.length
        || new Set(resultRefProofs.map((proof) => proof.resultRef)).size !== resultRefs.length) {
        return undefined;
    }
    if (!Array.isArray(receipt.artifacts) || receipt.artifacts.length === 0) return undefined;
    const artifactPaths = normalizeExactArtifactRefs(
        receipt.artifacts.map((artifact) => isRecord(artifact) ? artifact.path : ''),
        expectedProjectPath,
        96
    );
    if (!artifactPaths) return undefined;
    const artifacts: DebugSkuDeliveryEvidence['runtimeDeliveryReceipt']['artifacts'] =
        receipt.artifacts.flatMap((artifact, index) => {
        if (!isRecord(artifact)) return [];
        const kind = artifact.kind;
        const proof = artifact.proof;
        const fileIdentity = readFileIdentity(artifact.fileIdentity);
        const sourceHistoryStateRef = isRecord(artifact.sourceHistoryStateRef)
            ? {
                documentId: readPositiveInteger(artifact.sourceHistoryStateRef.documentId),
                historyStateId: readPositiveInteger(artifact.sourceHistoryStateRef.historyStateId)
            }
            : undefined;
        if ((kind !== 'editable_document' && kind !== 'raster_export')
            || (proof !== 'file_probe' && proof !== 'staged_editable_document_promotion')) {
            return [];
        }
        if (!fileIdentity
            || !sourceHistoryStateRef?.documentId
            || !sourceHistoryStateRef.historyStateId) {
            return [];
        }
            return [{
                path: artifactPaths[index],
                kind,
                proof,
                fileIdentity,
                sourceHistoryStateRef: {
                    documentId: sourceHistoryStateRef.documentId,
                    historyStateId: sourceHistoryStateRef.historyStateId
                }
            }];
        });
    if (artifacts.length !== receipt.artifacts.length) return undefined;

    const expectedCount = readPositiveInteger(editableReadback.expectedCount);
    const verifiedCount = readPositiveInteger(editableReadback.verifiedCount);
    const expectedPaths = normalizeExactArtifactRefs(
        editableReadback.expectedPaths,
        expectedProjectPath,
        48
    );
    const verifiedPaths = normalizeExactArtifactRefs(
        editableReadback.verifiedPaths,
        expectedProjectPath,
        48
    );
    const missingItemIds = readExactTextArray(editableReadback.missingItemIds, 48);
    const violations = readExactTextArray(editableReadback.violations, 48);
    if (!expectedCount
        || !verifiedCount
        || !expectedPaths
        || !verifiedPaths
        || !missingItemIds
        || !violations
        || !Array.isArray(editableReadback.items)
        || editableReadback.items.length !== expectedCount) {
        return undefined;
    }
    const items: DebugSkuDeliveryEvidence['skuEditableDeliveryReadback']['items'] =
        editableReadback.items.flatMap((item) => {
        if (!isRecord(item)
            || item.promotionVerified !== true
            || (item.freshnessProof !== 'new_path'
                && item.freshnessProof !== 'modified_since_baseline')
            || !isRecord(item.sourceHistoryStateRef)) {
            return [];
        }
        const rasterPath = normalizeExactArtifactRefs([item.rasterPath], expectedProjectPath, 1)?.[0];
        const editablePath = normalizeExactArtifactRefs([item.editablePath], expectedProjectPath, 1)?.[0];
        const combination = readExactTextArray(item.combination, 16);
        const copiedLayerNames = readExactTextArray(item.copiedLayerNames, 16);
        const copiedLayerIds = Array.isArray(item.copiedLayerIds)
            ? item.copiedLayerIds.map(readPositiveInteger)
            : [];
        const documentId = readPositiveInteger(item.sourceHistoryStateRef.documentId);
        const historyStateId = readPositiveInteger(item.sourceHistoryStateRef.historyStateId);
        const fileIdentity = readFileIdentity(item.fileIdentity);
        const itemId = String(item.itemId || '').trim();
        const templateName = String(item.templateName || '').trim();
        if (!rasterPath
            || !editablePath
            || !itemId
            || !templateName
            || !combination
            || !copiedLayerNames
            || copiedLayerIds.length === 0
            || copiedLayerIds.some((layerId) => layerId === undefined)
            || copiedLayerIds.length !== copiedLayerNames.length
            || copiedLayerIds.length !== combination.length
            || !documentId
            || !historyStateId
            || !fileIdentity) {
            return [];
        }
            const freshnessProof = item.freshnessProof as 'new_path' | 'modified_since_baseline';
            return [{
            itemId,
            rasterPath,
            editablePath,
            templateName,
            combination,
            sourceHistoryStateRef: { documentId, historyStateId },
            fileIdentity,
            copiedLayerIds: copiedLayerIds as number[],
            copiedLayerNames,
            freshnessProof,
            promotionVerified: true as const
            }];
        });
    if (items.length !== editableReadback.items.length
        || new Set(items.map((item) => item.itemId)).size !== items.length) {
        return undefined;
    }

    const readCount = (key: string): number | undefined => readNonNegativeInteger(exportReadback[key]);
    const normalizedExportReadback = {
        version: 'sku-export-readback/v0' as const,
        status: 'ready_for_review' as const,
        expectedExportCount: readCount('expectedExportCount'),
        actualExportCount: readCount('actualExportCount'),
        fileProbeCount: readCount('fileProbeCount'),
        okFileProbeCount: readCount('okFileProbeCount'),
        failedFileProbeCount: readCount('failedFileProbeCount'),
        missingFileProbeCount: readCount('missingFileProbeCount'),
        dimensionMismatchCount: readCount('dimensionMismatchCount'),
        staleFileProbeCount: readCount('staleFileProbeCount'),
        visualMetricBlockerCount: readCount('visualMetricBlockerCount'),
        missingVisualMetricCount: readCount('missingVisualMetricCount')
    };
    if (Object.values(normalizedExportReadback).some((entry) => entry === undefined)) {
        return undefined;
    }
    const requiredOutputs = ['editable_sku_batch_documents', 'sku_images'];
    const itemRasterPaths = items.map((item) => item.rasterPath);
    const itemEditablePaths = items.map((item) => item.editablePath);
    const rasterArtifactPaths = artifacts
        .filter((artifact) => (
            artifact.kind === 'raster_export' && artifact.proof === 'file_probe'
        ))
        .map((artifact) => artifact.path);
    const editableArtifactPaths = artifacts
        .filter((artifact) => (
            artifact.kind === 'editable_document'
            && artifact.proof === 'staged_editable_document_promotion'
        ))
        .map((artifact) => artifact.path);
    const artifactsByPath = new Map(artifacts.map((artifact) => [artifact.path, artifact]));
    const itemArtifactIdentitiesBound = items.every((item) => {
        const rasterArtifact = artifactsByPath.get(item.rasterPath);
        const editableArtifact = artifactsByPath.get(item.editablePath);
        return Boolean(
            rasterArtifact
            && editableArtifact
            && editableArtifact.fileIdentity.sha256 === item.fileIdentity.sha256
            && editableArtifact.fileIdentity.byteLength === item.fileIdentity.byteLength
            && rasterArtifact.sourceHistoryStateRef.documentId === item.sourceHistoryStateRef.documentId
            && rasterArtifact.sourceHistoryStateRef.historyStateId === item.sourceHistoryStateRef.historyStateId
            && editableArtifact.sourceHistoryStateRef.documentId === item.sourceHistoryStateRef.documentId
            && editableArtifact.sourceHistoryStateRef.historyStateId === item.sourceHistoryStateRef.historyStateId
        );
    });
    const exportCountsReady = normalizedExportReadback.expectedExportCount === expectedCount
        && normalizedExportReadback.actualExportCount === expectedCount
        && normalizedExportReadback.fileProbeCount === expectedCount
        && normalizedExportReadback.okFileProbeCount === expectedCount
        && normalizedExportReadback.failedFileProbeCount === 0
        && normalizedExportReadback.missingFileProbeCount === 0
        && normalizedExportReadback.dimensionMismatchCount === 0
        && normalizedExportReadback.staleFileProbeCount === 0
        && normalizedExportReadback.visualMetricBlockerCount === 0
        && normalizedExportReadback.missingVisualMetricCount === 0;
    if (!requiredOutputs.every((output) => outputs.includes(output))
        || expectedCount !== verifiedCount
        || expectedCount !== items.length
        || expectedCount !== resultRefs.length
        || expectedCount !== resultRefProofs.length
        || artifacts.length !== expectedCount * 2
        || missingItemIds.length !== 0
        || violations.length !== 0
        || !sameStringSet(expectedPaths, verifiedPaths)
        || !sameStringSet(expectedPaths, itemEditablePaths)
        || !sameStringSet(rasterArtifactPaths, itemRasterPaths)
        || !sameStringSet(editableArtifactPaths, itemEditablePaths)
        || !itemArtifactIdentitiesBound
        || !exportCountsReady) {
        return undefined;
    }
    return {
        version: 'debug-sku-delivery-evidence/v2',
        runtimeDeliveryReceipt: {
            status: 'ready',
            settlementScope: 'multi_document_task',
            outputs,
            resultRefs,
            resultRefProofs,
            artifacts
        },
        skuExportReadback: normalizedExportReadback as DebugSkuDeliveryEvidence['skuExportReadback'],
        skuEditableDeliveryReadback: {
            version: 'sku-editable-delivery-readback/v1',
            status: 'ready',
            expectedCount,
            verifiedCount,
            expectedPaths,
            verifiedPaths,
            missingItemIds,
            violations,
            items
        },
        boundaries: {
            developmentEvidenceOnly: true,
            normalizedProjectRelativePathsOnly: true,
            doesNotAffectRuntimeCompletion: true,
            doesNotJudgeDesignQuality: true
        }
    };
}
