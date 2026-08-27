/**
 * Main-image delivery runtime evidence.
 *
 * This module does not choose a delivery convention or any visual content. It
 * only probes the Skill-compiled exact paths, binds save/export results to the
 * typed plan, and builds the producer delivery receipt.
 */

import {
    buildRuntimeDeliveryReceipt,
    hasVerifiedEditableDocumentArtifact,
    type RuntimeDeliveryArtifactEntry,
    type RuntimeDeliveryReceipt,
    type RuntimeDeliverySettlementScope
} from '../../../shared/agent-runtime-v5/runtime-delivery-receipt';
import type {
    MainImageLiveExecutorOperationRunResult,
    MainImageLiveExecutorRunResult
} from '../../../shared/main-image-live-executor-runner';
import type {
    MainImageSkillDeliveryArtifact,
    MainImageSkillDeliveryPlan
} from '../../../shared/main-image-skill-delivery-plan';
import type {
    MainImageResultFileProbe
} from '../../../shared/main-image-screenshot-probe-readiness';
import type {
    StagedCommittedFileIdentity
} from '../../../shared/sku-staging-transaction-contract';
import {
    readPhotoshopSourceHistoryStateRef,
    type PhotoshopHistoryStateRef
} from '../../../shared/photoshop-history-state-ref';
import {
    normalizeSkillDeliveryArtifactPath
} from '../../../shared/skills/skill-delivery-convention';

export interface MainImageDeliveryRuntimeEvidence {
    rasterPaths: string[];
    rasterFileProbes: MainImageResultFileProbe[];
    allFileProbes: MainImageResultFileProbe[];
    actualRasterPathsMatchPlan: boolean;
    runtimeArtifacts: RuntimeDeliveryArtifactEntry[];
    resultRefs: string[];
    settlementScope: RuntimeDeliverySettlementScope;
    sourceHistoryRolesSatisfied: boolean;
    deliveryProducerComplete: boolean;
    receipt: RuntimeDeliveryReceipt;
}

export interface MainImageStagedDeliveryReadiness {
    ready: boolean;
    allFileProbes: MainImageResultFileProbe[];
    rasterFileProbes: MainImageResultFileProbe[];
    actualRasterPathsMatchPlan: boolean;
    runtimeArtifacts: RuntimeDeliveryArtifactEntry[];
    resultRefs: string[];
    sourceHistoryRolesSatisfied: boolean;
    issues: string[];
}

function cleanString(value: unknown): string {
    return String(value || '').trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function uniquePaths(paths: readonly string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const rawPath of paths) {
        const path = cleanString(rawPath);
        const key = normalizeSkillDeliveryArtifactPath(path);
        if (!path || !key || seen.has(key)) continue;
        seen.add(key);
        result.push(path);
    }
    return result;
}

export async function probeMainImageResultFiles(
    paths: readonly string[]
): Promise<MainImageResultFileProbe[]> {
    const api = window.designEcho?.probeImageFile;
    const unique = uniquePaths(paths);
    if (!api || unique.length === 0) return [];

    const probes: MainImageResultFileProbe[] = [];
    for (const resultPath of unique) {
        try {
            const result = await api(resultPath);
            probes.push({
                path: cleanString(result?.path) || resultPath,
                status: result?.status || (result?.success ? 'ok' : 'unavailable'),
                exists: result?.exists,
                isFile: result?.isFile,
                byteLength: result?.byteLength,
                format: result?.format,
                dimensions: result?.dimensions,
                sha256: result?.sha256,
                error: result?.error,
                rawImagesRedacted: result?.rawImagesRedacted === true
            });
        } catch (error: any) {
            probes.push({
                path: resultPath,
                status: 'unavailable',
                exists: undefined,
                isFile: undefined,
                error: error?.message || String(error),
                rawImagesRedacted: true
            });
        }
    }
    return probes;
}

export function getMainImageDeliveryArtifacts(
    plan: MainImageSkillDeliveryPlan,
    kind?: MainImageSkillDeliveryArtifact['kind']
): MainImageSkillDeliveryArtifact[] {
    return plan.artifacts.filter((artifact) => !kind || artifact.kind === kind);
}

export function findMainImageFileProbe(
    probes: readonly MainImageResultFileProbe[],
    artifactPath: string
): MainImageResultFileProbe | undefined {
    const target = normalizeSkillDeliveryArtifactPath(artifactPath);
    return probes.find((probe) => normalizeSkillDeliveryArtifactPath(probe.path) === target);
}

function hasVerifiedMainImageFileIdentity(probe: MainImageResultFileProbe | undefined): boolean {
    return Boolean(probe
        && probe.exists === true
        && probe.isFile === true
        && Number.isSafeInteger(Number(probe.byteLength))
        && Number(probe.byteLength) > 0
        && /^[a-f0-9]{64}$/.test(cleanString(probe.sha256)));
}

function collectNestedMainImageHistoryStateRefs(
    value: unknown,
    depth = 0
): PhotoshopHistoryStateRef[] {
    if (depth > 8 || value === null || value === undefined) return [];
    const direct = readPhotoshopSourceHistoryStateRef(value);
    const results = direct ? [direct] : [];
    const children = Array.isArray(value)
        ? value.slice(0, 64)
        : (isRecord(value) ? Object.values(value).slice(0, 64) : []);
    for (const child of children) {
        results.push(...collectNestedMainImageHistoryStateRefs(child, depth + 1));
    }
    return results;
}

export function sameMainImageHistoryStateRef(
    left: PhotoshopHistoryStateRef,
    right: PhotoshopHistoryStateRef
): boolean {
    return left.documentId === right.documentId && left.historyStateId === right.historyStateId;
}

function findMainImageArtifactOperation(input: {
    artifact: MainImageSkillDeliveryArtifact;
    runner: MainImageLiveExecutorRunResult;
}): MainImageLiveExecutorOperationRunResult | undefined {
    return input.runner.operationResults.find((candidate) => {
        if (input.artifact.kind === 'raster_export') {
            return candidate.tool === 'exportGroup'
                && candidate.sourceRequestId.includes(input.artifact.exportSpecId);
        }
        return candidate.tool === 'saveDocument'
            && candidate.sourceRequestId.includes(`${input.artifact.documentId}-save-editable`);
    });
}

function findNestedVerifiedEditableArtifactRecord(
    value: unknown,
    expectedPath: string,
    depth = 0
): Record<string, unknown> | undefined {
    if (depth > 8 || value === null || value === undefined) return undefined;
    if (isRecord(value) && hasVerifiedEditableDocumentArtifact(value)) {
        const savedPath = cleanString(value.savedPath) || cleanString(value.filePath);
        if (normalizeSkillDeliveryArtifactPath(savedPath) === normalizeSkillDeliveryArtifactPath(expectedPath)) {
            return value;
        }
    }
    const children = Array.isArray(value)
        ? value.slice(0, 64)
        : (isRecord(value) ? Object.values(value).slice(0, 64) : []);
    for (const child of children) {
        const record = findNestedVerifiedEditableArtifactRecord(child, expectedPath, depth + 1);
        if (record) return record;
    }
    return undefined;
}

function findMainImageArtifactSourceHistoryStateRef(input: {
    artifact: MainImageSkillDeliveryArtifact;
    runner: MainImageLiveExecutorRunResult;
}): PhotoshopHistoryStateRef | undefined {
    const operation = findMainImageArtifactOperation(input);
    if (!operation?.success) return undefined;
    const refs = collectNestedMainImageHistoryStateRefs(operation.actualResult);
    if (refs.length === 0) return undefined;
    const first = refs[0];
    return refs.every((candidate) => sameMainImageHistoryStateRef(first, candidate))
        ? first
        : undefined;
}

function buildMainImageRuntimeArtifactEntries(input: {
    plan: MainImageSkillDeliveryPlan;
    probes: readonly MainImageResultFileProbe[];
    runner: MainImageLiveExecutorRunResult;
    probePathsByArtifactId?: Readonly<Record<string, string>>;
    operationPathsByArtifactId?: Readonly<Record<string, string>>;
}): RuntimeDeliveryArtifactEntry[] {
    return input.plan.artifacts.flatMap((artifact) => {
        const probePath = input.probePathsByArtifactId?.[artifact.artifactId] || artifact.path;
        const operationPath = input.operationPathsByArtifactId?.[artifact.artifactId] || artifact.path;
        const probe = findMainImageFileProbe(input.probes, probePath);
        const sourceHistoryStateRef = findMainImageArtifactSourceHistoryStateRef({
            artifact,
            runner: input.runner
        });
        const operation = findMainImageArtifactOperation({ artifact, runner: input.runner });
        const editableProofReady = artifact.kind !== 'editable_document'
            || Boolean(findNestedVerifiedEditableArtifactRecord(operation?.actualResult, operationPath));
        if (!hasVerifiedMainImageFileIdentity(probe) || !sourceHistoryStateRef || !editableProofReady) {
            return [];
        }
        return [{
            path: artifact.path,
            kind: artifact.kind,
            proof: artifact.kind === 'editable_document'
                ? 'editable_document_artifact' as const
                : 'file_probe' as const,
            fileIdentity: {
                sha256: cleanString(probe?.sha256),
                byteLength: Number(probe?.byteLength)
            },
            sourceHistoryStateRef,
            planBinding: {
                artifactId: artifact.artifactId,
                pairId: artifact.pairId,
                order: artifact.order,
                format: artifact.format,
                sourceHistoryRole: artifact.sourceHistoryRole
            }
        }];
    });
}

function sameOrderedMainImagePaths(
    expected: readonly string[],
    actual: readonly string[]
): boolean {
    const expectedKeys = expected.map(normalizeSkillDeliveryArtifactPath).filter(Boolean);
    const actualKeys = actual.map(normalizeSkillDeliveryArtifactPath).filter(Boolean);
    return expectedKeys.length === actualKeys.length
        && expectedKeys.every((pathKey, index) => pathKey === actualKeys[index]);
}

function committedMainImageFilesMatch(input: {
    plan: MainImageSkillDeliveryPlan;
    committedFiles?: readonly StagedCommittedFileIdentity[];
    probes: readonly MainImageResultFileProbe[];
}): boolean {
    const committedFiles = input.committedFiles || [];
    return committedFiles.length === input.plan.artifacts.length
        && committedFiles.every((file, index) => {
            const artifact = input.plan.artifacts[index];
            const probe = findMainImageFileProbe(input.probes, artifact.path);
            return normalizeSkillDeliveryArtifactPath(file.path)
                    === normalizeSkillDeliveryArtifactPath(artifact.path)
                && Number.isSafeInteger(Number(file.byteLength))
                && Number(file.byteLength) > 0
                && /^[a-f0-9]{64}$/.test(cleanString(file.sha256))
                && Number(probe?.byteLength) === Number(file.byteLength)
                && cleanString(probe?.sha256) === cleanString(file.sha256);
        });
}

function mainImageSourceHistoryRolesSatisfied(input: {
    plan: MainImageSkillDeliveryPlan;
    artifacts: readonly RuntimeDeliveryArtifactEntry[];
}): boolean {
    const byPair = new Map<string, PhotoshopHistoryStateRef[]>();
    for (const planned of input.plan.artifacts) {
        const actual = input.artifacts.find((artifact) => (
            normalizeSkillDeliveryArtifactPath(artifact.path)
            === normalizeSkillDeliveryArtifactPath(planned.path)
        ));
        if (!actual?.sourceHistoryStateRef) return false;
        const refs = byPair.get(planned.pairId) || [];
        refs.push(actual.sourceHistoryStateRef);
        byPair.set(planned.pairId, refs);
    }
    for (const refs of byPair.values()) {
        if (refs.length === 0 || !refs.every((value) => sameMainImageHistoryStateRef(refs[0], value))) {
            return false;
        }
    }
    return byPair.size > 0;
}

export async function inspectMainImageStagedDeliveryBeforePromotion(input: {
    plan: MainImageSkillDeliveryPlan;
    runner: MainImageLiveExecutorRunResult;
    actualRasterPaths: readonly string[];
    stagedPathsByArtifactId: Readonly<Record<string, string>>;
}): Promise<MainImageStagedDeliveryReadiness> {
    const plannedArtifacts = getMainImageDeliveryArtifacts(input.plan);
    const stagedPaths = plannedArtifacts.map((artifact) => (
        cleanString(input.stagedPathsByArtifactId[artifact.artifactId])
    ));
    const uniqueStagedPathCount = new Set(
        stagedPaths.map(normalizeSkillDeliveryArtifactPath).filter(Boolean)
    ).size;
    const allFileProbes = stagedPaths.some((filePath) => !filePath)
        ? []
        : await probeMainImageResultFiles(stagedPaths);
    const stagedRasterPaths = getMainImageDeliveryArtifacts(input.plan, 'raster_export')
        .map((artifact) => cleanString(input.stagedPathsByArtifactId[artifact.artifactId]));
    const stagedRasterPathKeys = new Set(
        stagedRasterPaths.map(normalizeSkillDeliveryArtifactPath).filter(Boolean)
    );
    const rasterFileProbes = allFileProbes.filter((probe) => (
        stagedRasterPathKeys.has(normalizeSkillDeliveryArtifactPath(probe.path))
    ));
    const actualRasterPathsMatchPlan = sameOrderedMainImagePaths(
        stagedRasterPaths,
        input.actualRasterPaths
    );
    const runtimeArtifacts = buildMainImageRuntimeArtifactEntries({
        plan: input.plan,
        probes: allFileProbes,
        runner: input.runner,
        probePathsByArtifactId: input.stagedPathsByArtifactId,
        operationPathsByArtifactId: input.stagedPathsByArtifactId
    });
    const resultRefs = input.runner.operationResults
        .filter((operation) => (
            (operation.phase === 'export' || operation.phase === 'save')
            && operation.success
        ))
        .map((operation) => operation.requestId);
    const sourceHistoryRolesSatisfied = mainImageSourceHistoryRolesSatisfied({
        plan: input.plan,
        artifacts: runtimeArtifacts
    });
    const issues = [
        ...(input.runner.status !== 'completed_requires_review'
            ? [`主图执行状态为 ${input.runner.status}。`]
            : []),
        ...(stagedPaths.length !== plannedArtifacts.length
            || uniqueStagedPathCount !== plannedArtifacts.length
            ? ['主图暂存文件映射不完整或存在重复路径。']
            : []),
        ...(!actualRasterPathsMatchPlan
            ? ['主图实际导出路径与本次暂存计划不一致。']
            : []),
        ...(runtimeArtifacts.length !== plannedArtifacts.length
            ? ['部分主图暂存文件缺少稳定文件身份或 Photoshop 源版本读回。']
            : []),
        ...(resultRefs.length !== plannedArtifacts.length
            ? ['主图保存与导出操作数量不完整。']
            : []),
        ...(!sourceHistoryRolesSatisfied
            ? ['主图可编辑稿与对应导出图没有绑定同一 Photoshop 文档版本。']
            : [])
    ];
    return {
        ready: issues.length === 0,
        allFileProbes,
        rasterFileProbes,
        actualRasterPathsMatchPlan,
        runtimeArtifacts,
        resultRefs,
        sourceHistoryRolesSatisfied,
        issues
    };
}

export async function buildMainImageDeliveryRuntimeEvidence(input: {
    plan: MainImageSkillDeliveryPlan;
    runner: MainImageLiveExecutorRunResult;
    actualRasterPaths: readonly string[];
    stagedPathsByArtifactId?: Readonly<Record<string, string>>;
    stagedFileProbes?: readonly MainImageResultFileProbe[];
    committedFiles?: readonly StagedCommittedFileIdentity[];
    externalCommitAccepted?: boolean;
}): Promise<MainImageDeliveryRuntimeEvidence> {
    const plannedArtifacts = getMainImageDeliveryArtifacts(input.plan);
    const rasterPaths = getMainImageDeliveryArtifacts(input.plan, 'raster_export')
        .map((artifact) => artifact.path);
    const canProjectCommittedStagedProbes = Boolean(
        input.stagedPathsByArtifactId
        && input.stagedFileProbes
        && input.committedFiles
        && input.committedFiles.length === plannedArtifacts.length
    );
    const allFileProbes = canProjectCommittedStagedProbes
        ? plannedArtifacts.flatMap((artifact, index) => {
            const stagedPath = input.stagedPathsByArtifactId?.[artifact.artifactId] || '';
            const stagedProbe = findMainImageFileProbe(input.stagedFileProbes || [], stagedPath);
            const committed = input.committedFiles?.[index];
            if (!stagedProbe || !committed) return [];
            return [{
                ...stagedProbe,
                path: artifact.path,
                exists: true,
                isFile: true,
                byteLength: committed.byteLength,
                sha256: committed.sha256,
                rawImagesRedacted: true
            }];
        })
        : await probeMainImageResultFiles(plannedArtifacts.map((artifact) => artifact.path));
    const rasterPathKeys = new Set(rasterPaths.map(normalizeSkillDeliveryArtifactPath));
    const rasterFileProbes = allFileProbes.filter((probe) => (
        rasterPathKeys.has(normalizeSkillDeliveryArtifactPath(probe.path))
    ));
    const expectedOperationRasterPaths = getMainImageDeliveryArtifacts(input.plan, 'raster_export')
        .map((artifact) => (
            input.stagedPathsByArtifactId?.[artifact.artifactId] || artifact.path
        ));
    const actualRasterPathsMatchPlan = sameOrderedMainImagePaths(
        expectedOperationRasterPaths,
        input.actualRasterPaths
    );
    const runtimeArtifacts = buildMainImageRuntimeArtifactEntries({
        plan: input.plan,
        probes: allFileProbes,
        runner: input.runner,
        operationPathsByArtifactId: input.stagedPathsByArtifactId
    });
    const resultRefs = input.runner.operationResults
        .filter((operation) => (
            (operation.phase === 'export' || operation.phase === 'save')
            && operation.success
        ))
        .map((operation) => operation.requestId);
    const artifactHistoryRefs = runtimeArtifacts
        .map((artifact) => artifact.sourceHistoryStateRef)
        .filter((value): value is PhotoshopHistoryStateRef => Boolean(value));
    const singleDocumentSourceHistoryStateRef = artifactHistoryRefs.length === plannedArtifacts.length
        && artifactHistoryRefs.length > 0
        && artifactHistoryRefs.every((value) => sameMainImageHistoryStateRef(artifactHistoryRefs[0], value))
        ? artifactHistoryRefs[0]
        : undefined;
    const settlementScope: RuntimeDeliverySettlementScope = input.plan.documents.length === 1
        ? 'single_document_revision'
        : 'multi_document_task';
    const sourceHistoryRolesSatisfied = mainImageSourceHistoryRolesSatisfied({
        plan: input.plan,
        artifacts: runtimeArtifacts
    });
    const runnerCompleted = input.runner.status === 'completed_requires_review';
    const committedFilesMatchPlan = committedMainImageFilesMatch({
        plan: input.plan,
        committedFiles: input.committedFiles,
        probes: allFileProbes
    });
    const deliveryProducerComplete = runnerCompleted
        && actualRasterPathsMatchPlan
        && runtimeArtifacts.length === plannedArtifacts.length
        && resultRefs.length === plannedArtifacts.length
        && sourceHistoryRolesSatisfied
        && input.externalCommitAccepted === true
        && committedFilesMatchPlan
        && (settlementScope === 'multi_document_task' || Boolean(singleDocumentSourceHistoryStateRef));
    const receipt = buildRuntimeDeliveryReceipt({
        settlementScope,
        status: deliveryProducerComplete ? 'ready' : 'incomplete',
        outputs: ['main_image_psd', 'main_image_preview', 'delivery_manifest'],
        resultRefs,
        resultRefProofs: resultRefs.map((resultRef) => ({
            resultRef,
            effect: 'save_export' as const
        })),
        artifacts: runtimeArtifacts,
        expectedDeliveryPlan: input.plan.typedPlan
            ? {
                digest: input.plan.typedPlan.digest,
                convention: input.plan.typedPlan.convention,
                artifacts: input.plan.typedPlan.artifacts
            }
            : undefined,
        sourceHistoryStateRef: settlementScope === 'single_document_revision'
            ? singleDocumentSourceHistoryStateRef
            : undefined,
        issues: [
            ...(!runnerCompleted ? [`主图执行状态为 ${input.runner.status}。`] : []),
            ...(!actualRasterPathsMatchPlan
                ? ['exportGroup 的实际 raster 路径与执行前冻结计划不一致。']
                : []),
            ...(resultRefs.length !== plannedArtifacts.length
                ? ['主图的 save/export 操作引用与冻结文件计划不一致。']
                : []),
            ...(runtimeArtifacts.length !== plannedArtifacts.length
                ? ['部分主图 raster 或可编辑稿缺少文件身份或 Photoshop 源版本读回。']
                : []),
            ...(!sourceHistoryRolesSatisfied
                ? ['主图的可编辑稿与对应导出图不是同一 Photoshop 文档版本。']
                : []),
            ...(input.externalCommitAccepted !== true
                ? ['主图整组文件提交没有获得 Runtime 接受。']
                : []),
            ...(!committedFilesMatchPlan
                ? ['主进程提交后的文件身份与冻结计划或正式目录读回不一致。']
                : [])
        ]
    });
    return {
        rasterPaths,
        rasterFileProbes,
        allFileProbes,
        actualRasterPathsMatchPlan,
        runtimeArtifacts,
        resultRefs,
        settlementScope,
        sourceHistoryRolesSatisfied,
        deliveryProducerComplete,
        receipt
    };
}
