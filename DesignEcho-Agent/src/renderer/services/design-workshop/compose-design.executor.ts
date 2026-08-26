/**
 * composeDesign 车间执行器：把 Agent 声明的「设计稿」按稳定制作工序做成可编辑 Photoshop 首稿。
 *
 * 工序：写前素材/几何预演 → 建画布 → 一次落位背景或摄影图 → renderLayout 执行 Agent 构图
 * → 主体投影 → 回读结构与快照（保存/导出由 Agent 看过当前版本后另行决定）。
 *
 * 只串既有原子工具与既有 renderLayout 管线，不重写任何排版 / 建层逻辑；每一步失败都停下并
 * 说清「哪一步、为什么、还能怎么做」，已完成的步骤如实列出（不回滚——半成品也是模型可续的起点）。
 */

import { readPhotoshopModalRecoveryEvidence } from '../../../shared/agent-react-observation-contract';
import {
    buildBackdropPrompt,
    isComposeDesignSubjectAliasRegion,
    normalizeComposeDesignSpec,
    planPhotoFullBleedPlacement,
    planSubjectShadow,
    type ComposeDesignSpec
} from '../../../shared/design-workshop/compose-design-spec';
import {
    compareDesignVersions,
    createRecentDesignsLedger,
    findDesignSameness,
    findLatestComparableDesign,
    type DesignFingerprint,
    type DesignFingerprintRegion,
    type DesignFingerprintSelectedAsset,
    type DesignVersionComparison,
    type RecentDesignsLedger
} from '../../../shared/design-workshop/recent-designs';
import { buildComposeDesignRationaleResultProjection } from '../../../shared/design-workshop/compose-design-rationale-visibility';
import {
    buildImagePlacementPrewritePlan,
    type ImagePlacementPrewritePlan,
    type ImagePlacementPrewriteSubjectFacts
} from '../../../shared/layout/image-placement-prewrite-plan';
import { buildImagePlacementReviewPlan } from '../../../shared/layout/image-placement-review-plan';
import {
    rendersLayoutBlockAsImage,
    solveRegionLayout,
    type NormalizedRegionBlock
} from '../../../shared/layout/layout-engine';
import { resolveRenderLayoutVisualStyle } from '../../../shared/layout/render-layout-style';
import { preflightResolvedImagePlacements } from '../../../shared/layout/resolved-image-placement-preflight';
import { classifyFilesystemProjectAffinity } from '../../../shared/photoshop-document-inventory';
import {
    buildPhotoshopHistoryTransition,
    findObservedPhotoshopMutationProof,
    readPhotoshopHistoryStateRef,
    readPhotoshopHistoryTransition,
    readPhotoshopMutationCommit,
    samePhotoshopHistoryStateRef
} from '../../../shared/photoshop-history-state-ref';
import type { PhotoshopHistoryStateRef } from '../../../shared/photoshop-history-state-ref';

export interface ComposeDesignExecutorDeps {
    executeToolCall: (toolName: string, params: any, options?: any) => Promise<any>;
    inferLayerId: (toolName: string, params: any, result: any) => number | undefined;
    invokeMain: (channel: string, ...args: any[]) => Promise<any>;
    /** 当前项目路径：近期成稿指纹（别每次都一样）落在项目 .designecho 下 */
    projectPath?: string;
    /** Harness 签发的请求级作用域；只用于区分独立任务与同任务修订。 */
    taskScopeId?: string;
    options?: any;
}

async function readRecentDesigns(invokeMain: ComposeDesignExecutorDeps['invokeMain'], projectPath?: string): Promise<RecentDesignsLedger> {
    if (!projectPath) return createRecentDesignsLedger();
    try {
        const read = await invokeMain('designWorkshop:readRecentDesigns', { projectPath });
        return read?.success && read.ledger && Array.isArray(read.ledger.items) ? read.ledger as RecentDesignsLedger : createRecentDesignsLedger();
    } catch {
        return createRecentDesignsLedger();
    }
}

interface WorkshopStep {
    step: string;
    tool: string;
    ok: boolean;
    ms: number;
    detail?: string;
    layerId?: number;
}

type ComposeMutationSettlementStatus = 'applied' | 'not_observed' | 'unknown';

interface ComposeMutationSettlement {
    status: ComposeMutationSettlementStatus;
    attemptedMutationTools: string[];
    successfulMutationTools: string[];
    finalHistoryStateRef?: PhotoshopHistoryStateRef;
    reason: string;
}

interface ComposePhotoSubjectEvidence {
    box: { x: number; y: number; width: number; height: number };
    method?: string;
    confidence?: string;
}

interface ComposePhotoSourceFacts {
    width: number;
    height: number;
    /** 缺失只表示没有可用主体框；普通整图 placement 仍可消费 width / height。 */
    subject?: ComposePhotoSubjectEvidence;
}

const COMPOSE_DESIGN_MUTATION_TOOLS: ReadonlySet<string> = new Set([
    'createDocument',
    'placeImage',
    'createRectangle',
    'addGradientOverlay',
    'renderLayout',
    'addDropShadow'
]);

function readComposeEnvironmentRecoveryEvidence(
    toolResults: Array<{ toolName: string; result: unknown }>
): Record<string, unknown> {
    for (let index = toolResults.length - 1; index >= 0; index -= 1) {
        const value = toolResults[index]?.result;
        const evidence = readPhotoshopModalRecoveryEvidence(value);
        if (evidence) return { ...evidence };
    }
    return {};
}

interface ComposeDesignIssueDetail {
    code: string;
    path?: string;
    message: string;
    allowedValues?: string[];
    focalPointOptional?: boolean;
    conflictingFields?: string[];
    recoveryOptions?: Array<{
        id: string;
        preserves: string;
        changes: Array<{
            operation: 'choose' | 'remove' | 'replace';
            path: string;
            value?: unknown;
            allowedValues?: string[];
        }>;
    }>;
}

function buildComposeDesignIssueDetails(issues: string[]): ComposeDesignIssueDetail[] {
    return issues.map((issue) => {
        const regionConflict = issue.match(/^layout\.regions\[(\d+)\]\.imagePlacement:(cover_and_subject_fill_ratio_are_ambiguous|cover_conflicts_with_avoid_crop|focal_point_and_subject_fill_ratio_conflict)$/);
        if (regionConflict) {
            const regionPath = `layout.regions[${regionConflict[1]}].imagePlacement`;
            if (regionConflict[2] === 'cover_and_subject_fill_ratio_are_ambiguous') {
                return {
                    code: 'image_placement_cover_subject_fill_conflict',
                    path: regionPath,
                    message: issue,
                    conflictingFields: ['fit', 'subjectFillRatio'],
                    recoveryOptions: [
                        {
                            id: 'preserve_cover',
                            preserves: 'fit=cover',
                            changes: [{ operation: 'remove', path: `${regionPath}.subjectFillRatio` }]
                        },
                        {
                            id: 'preserve_subject_fill',
                            preserves: 'subjectFillRatio',
                            changes: [{ operation: 'replace', path: `${regionPath}.fit`, value: 'contain' }]
                        }
                    ]
                };
            }
            if (regionConflict[2] === 'cover_conflicts_with_avoid_crop') {
                return {
                    code: 'image_placement_cover_avoid_crop_conflict',
                    path: regionPath,
                    message: issue,
                    conflictingFields: ['fit', 'cropPolicy'],
                    recoveryOptions: [
                        {
                            id: 'preserve_cover',
                            preserves: 'fit=cover',
                            changes: [{
                                operation: 'choose',
                                path: `${regionPath}.cropPolicy`,
                                allowedValues: ['protect-subject', 'allow-crop']
                            }]
                        },
                        {
                            id: 'preserve_avoid_crop',
                            preserves: 'cropPolicy=avoid-crop',
                            changes: [{ operation: 'replace', path: `${regionPath}.fit`, value: 'contain' }]
                        }
                    ]
                };
            }
            return {
                code: 'image_placement_focal_subject_fill_conflict',
                path: regionPath,
                message: issue,
                conflictingFields: ['focalPoint', 'subjectFillRatio'],
                recoveryOptions: [
                    {
                        id: 'preserve_focal_point',
                        preserves: 'focalPoint',
                        changes: [{ operation: 'remove', path: `${regionPath}.subjectFillRatio` }]
                    },
                    {
                        id: 'preserve_subject_fill',
                        preserves: 'subjectFillRatio',
                        changes: [{ operation: 'remove', path: `${regionPath}.focalPoint` }]
                    }
                ]
            };
        }
        if (issue.startsWith('background.imagePlacement.cropPolicy：')) {
            return {
                code: 'background_crop_policy_not_applicable',
                path: 'background.imagePlacement.cropPolicy',
                message: issue,
                allowedValues: ['avoid-crop', 'allow-crop'],
                focalPointOptional: true
            };
        }
        if (issue.startsWith('background.imagePlacement.subjectFillRatio：')) {
            return {
                code: 'background_subject_fill_not_applicable',
                path: 'background.imagePlacement.subjectFillRatio',
                message: issue,
                focalPointOptional: true
            };
        }
        return {
            code: 'design_spec_invalid',
            message: issue
        };
    });
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
    const clean = hex.replace('#', '');
    return {
        r: parseInt(clean.slice(0, 2), 16),
        g: parseInt(clean.slice(2, 4), 16),
        b: parseInt(clean.slice(4, 6), 16)
    };
}

function readFileStem(filePath: unknown): string {
    const parts = String(filePath || '').trim().split(/[\\/]+/);
    const fileName = parts[parts.length - 1] || '';
    return fileName.replace(/\.[^.]+$/, '').trim().slice(0, 28);
}

function findPrimarySubjectRegionIndex(spec: ComposeDesignSpec): number {
    const aliasIndex = spec.layout.regions.findIndex(isComposeDesignSubjectAliasRegion);
    if (aliasIndex >= 0) return aliasIndex;

    const subjectPath = String(spec.subject?.filePath || '').trim();
    if (!subjectPath) return -1;
    return spec.layout.regions.findIndex((region) => (
        region.role === 'main-image'
        && String(region.content || '').trim() === subjectPath
    ));
}

function buildComposeDesignSourceAudit(spec: ComposeDesignSpec, projectPath?: string): Record<string, unknown> {
    const regionSources = spec.layout.regions
        .filter(rendersLayoutBlockAsImage)
        .map((region) => ({ role: `visual:${region.id || region.role}`, path: region.content }));
    const sources = [
        { role: 'subject', path: spec.subject?.filePath },
        { role: 'background', path: spec.background.kind === 'asset' ? spec.background.filePath : undefined },
        { role: 'background_reference', path: spec.background.referenceFilePath },
        ...regionSources
    ]
        .filter((entry) => String(entry.path || '').trim())
        .map((entry) => {
            const path = String(entry.path || '').trim();
            const affinity = classifyFilesystemProjectAffinity(path, projectPath);
            return {
                role: entry.role,
                path,
                projectAffinity: affinity.affinity,
                ...(affinity.relativePath ? { projectRelativePath: affinity.relativePath } : {}),
                reason: affinity.reason,
                temporaryStoragePath: /[\\/]appdata[\\/]local[\\/]temp[\\/]/i.test(path)
            };
        });
    return {
        version: 'compose-design-source-audit/v1',
        projectPath,
        sources,
        factsOnly: true,
        note: '项目归属与临时目录标记只报告路径事实；用户附件或外部导入的授权必须由其真实来源收据解释，不能靠模型猜。'
    };
}

function buildDesignFingerprintRegions(spec: ComposeDesignSpec): DesignFingerprintRegion[] {
    return spec.layout.regions.map((region) => {
        const image = isComposeDesignSubjectAliasRegion(region) || rendersLayoutBlockAsImage(region);
        return {
            id: String(region.id || '').trim(),
            role: String(region.role || '').trim(),
            contentKind: image ? 'image' : 'editable_text',
            contentSummary: image
                ? (isComposeDesignSubjectAliasRegion(region)
                    ? readFileStem(spec.subject?.filePath || 'subject')
                    : readFileStem(region.content))
                : String(region.content || '').replace(/\s+/g, ' ').trim().slice(0, 120),
            ...(image && region.imagePlacement ? {
                imagePlacement: {
                    fit: region.imagePlacement.fit,
                    anchor: region.imagePlacement.anchor,
                    cropPolicy: region.imagePlacement.cropPolicy,
                    ...(region.imagePlacement.subjectFillRatio !== undefined
                        ? { subjectFillRatio: region.imagePlacement.subjectFillRatio }
                        : {}),
                    ...(region.imagePlacement.focalPoint
                        ? { focalPoint: { ...region.imagePlacement.focalPoint } }
                        : {})
                }
            } : {})
        };
    });
}

function collectComposeDesignSelectedAssets(spec: ComposeDesignSpec): DesignFingerprintSelectedAsset[] {
    const selected = new Map<string, DesignFingerprintSelectedAsset>();
    const add = (value: unknown, role: string): void => {
        const filePath = String(value || '').trim();
        if (!filePath) return;
        const identity = filePath.replace(/\\/g, '/').toLowerCase();
        if (!identity || selected.has(identity)) return;
        selected.set(identity, { path: filePath, role });
    };

    add(spec.subject?.filePath, 'subject');
    if (spec.background.kind === 'asset') add(spec.background.filePath, 'background');
    for (const region of spec.layout.regions) {
        if (!rendersLayoutBlockAsImage(region) || isComposeDesignSubjectAliasRegion(region)) continue;
        add(region.content, String(region.role || region.id || 'layout-image').trim() || 'layout-image');
    }
    return Array.from(selected.values());
}

function mergeComposeDesignQualityState(
    layoutQualityState: unknown,
    comparison?: DesignVersionComparison,
    additionalFindings: readonly any[] = []
): 'passed' | 'needs_review' | 'needs_repair' | 'failed' {
    const normalized = String(layoutQualityState || 'passed');
    if (normalized === 'failed') return 'failed';
    if (normalized === 'needs_repair'
        || additionalFindings.some((finding) => finding?.severity === 'repair')) {
        return 'needs_repair';
    }
    if (normalized === 'needs_review'
        || comparison?.needsComparativeReview
        || additionalFindings.length > 0) {
        return 'needs_review';
    }
    return 'passed';
}

function rebindComposeVisualObservationBundle(bundle: any): any {
    if (!bundle || bundle.version !== 'visual-observation-bundle/v1' || !Array.isArray(bundle.items)) {
        return undefined;
    }
    return {
        ...bundle,
        items: bundle.items.map((item: any, index: number) => ({
            ...item,
            identity: {
                ...(item?.identity || {}),
                outer: 'composeDesign',
                resultPath: `$.visualObservationBundle.items[${index}]`
            }
        }))
    };
}

function readComposeSnapshotPayload(result: any): any {
    return result?.snapshot || result?.data?.snapshot || (
        result?.base64 || result?.imageData
            ? {
                ...(result?.base64 ? { base64: result.base64 } : {}),
                ...(result?.imageData ? { imageData: result.imageData } : {}),
                ...(result?.format ? { format: result.format } : {})
            }
            : undefined
    );
}

function readComposeSnapshotImage(snapshot: any): Record<string, string> | undefined {
    if (typeof snapshot === 'string' && snapshot) return { base64: snapshot };
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return undefined;
    const base64 = typeof snapshot.base64 === 'string' ? snapshot.base64 : '';
    const imageData = typeof snapshot.imageData === 'string' ? snapshot.imageData : '';
    const dataUrl = typeof snapshot.dataUrl === 'string' ? snapshot.dataUrl : '';
    if (!base64 && !imageData && !dataUrl) return undefined;
    return {
        ...(base64 ? { base64 } : {}),
        ...(imageData ? { imageData } : {}),
        ...(dataUrl ? { dataUrl } : {}),
        ...(typeof snapshot.format === 'string' ? { format: snapshot.format } : {}),
        ...(typeof snapshot.mediaType === 'string' ? { mediaType: snapshot.mediaType } : {})
    };
}

function describeVersionComparison(comparison?: DesignVersionComparison): string {
    if (!comparison) return '';
    const removed = comparison.removed.map((region) => `${region.role}「${region.id}」`);
    const added = comparison.added.map((region) => `${region.role}「${region.id}」`);
    let relation: string;
    if (comparison.relation === 'new_document_alternative') {
        relation = `当前「${comparison.current.documentName}」是另建候选，没有修改前稿「${comparison.previous.documentName}」`;
    } else if (comparison.relation === 'same_document_revision') {
        relation = `当前结果与「${comparison.previous.documentName}」属于同一 Photoshop 文档的后续状态`;
    } else {
        relation = `当前结果与「${comparison.previous.documentName}」的文档关系尚不能从收据确定`;
    }
    return [
        `${relation}；声明元素 ${comparison.previous.regionCount} → ${comparison.current.regionCount}。`,
        removed.length > 0 ? `移除：${removed.join('、')}。` : '',
        added.length > 0 ? `新增：${added.join('、')}。` : '',
        comparison.needsComparativeReview
            ? '这是结构性减法的变化证据，不是好坏结论，也不要求保留文字或达到固定元素数；当前尚没有证明新候选优于前稿。请结合这个差异与同文档视觉读回给出比较理由，或按需取得独立评审证据后再把它当作更优版本。'
            : ''
    ].filter(Boolean).join(' ');
}

function failure(
    step: string,
    reason: string,
    steps: WorkshopStep[],
    extra: Record<string, unknown> = {}
): Record<string, unknown> {
    return {
        success: false,
        status: 'failed',
        failedStep: step,
        error: `composeDesign 在「${step}」失败：${reason}`,
        message: `首稿在「${step}」没有完成。已经成功的操作保留在当前文档中，Agent 可根据失败原因继续处理。`,
        steps,
        ...extra
    };
}

function executionFailure(
    step: string,
    reason: string,
    spec: ComposeDesignSpec,
    documentId: number | undefined,
    steps: WorkshopStep[],
    extra: Record<string, unknown> = {}
): Record<string, unknown> {
    const attemptedMutationTools = steps
        .filter((item) => COMPOSE_DESIGN_MUTATION_TOOLS.has(item.tool))
        .map((item) => item.tool);
    const successfulMutationTools = steps
        .filter((item) => item.ok && COMPOSE_DESIGN_MUTATION_TOOLS.has(item.tool))
        .map((item) => item.tool);
    const extraData = extra.data && typeof extra.data === 'object' && !Array.isArray(extra.data)
        ? extra.data as Record<string, unknown>
        : {};
    const { data: _data, ...rest } = extra;
    const mutationSettlement = extraData.mutationSettlement
        && typeof extraData.mutationSettlement === 'object'
        && !Array.isArray(extraData.mutationSettlement)
        ? extraData.mutationSettlement as ComposeMutationSettlement
        : undefined;
    const observedMutationProof = findObservedPhotoshopMutationProof(extra);
    const createdDocumentByHostProof = Array.isArray(extra.toolResults)
        && extra.toolResults.some((entry: any) => {
            if (entry?.toolName !== 'createDocument') return false;
            const commit = readPhotoshopMutationCommit(entry.result);
            return commit?.changeKind === 'document_creation'
                && commit.mutationObserved === true;
        });
    let mutationStatus: ComposeMutationSettlementStatus;
    if (mutationSettlement?.status) {
        mutationStatus = mutationSettlement.status;
    } else if (observedMutationProof) {
        mutationStatus = 'applied';
    } else if (attemptedMutationTools.length > 0) {
        mutationStatus = 'unknown';
    } else {
        mutationStatus = 'not_observed';
    }
    let failureMessage: string;
    if (mutationStatus === 'applied') {
        failureMessage = `首稿在「${step}」没有完整完成，但 Photoshop 已发生部分改动。不要直接重复整单；先查看当前文档，再由 Agent 决定续做或重建。`;
    } else if (mutationStatus === 'unknown') {
        failureMessage = `首稿在「${step}」没有完整完成，而且暂时无法确认 Photoshop 的最终写入状态。请先读取当前文档和版本，再决定下一步，避免叠加修改。`;
    } else {
        failureMessage = `首稿在「${step}」没有完成；失败结算没有观察到本次复合调用留下 Photoshop 改动。`;
    }
    return failure(step, reason, steps, {
        ...rest,
        message: failureMessage,
        documentId,
        data: {
            version: 'compose-design-execution/v1',
            createdDocument: spec.document.mode === 'new'
                && (steps.some((item) => item.ok && item.tool === 'createDocument')
                    || createdDocumentByHostProof),
            layoutRendered: steps.some((item) => item.ok && item.tool === 'renderLayout'),
            ...(mutationStatus === 'applied' ? { partialMutation: true } : {}),
            ...(mutationStatus === 'not_observed' ? { partialMutation: false } : {}),
            mutationStatus,
            completedStepCount: steps.filter((item) => item.ok).length,
            attemptedMutationTools,
            successfulMutationTools,
            ...(documentId !== undefined ? { documentId } : {}),
            ...extraData
        }
    });
}

export async function executeComposeDesign(rawParams: any, deps: ComposeDesignExecutorDeps): Promise<any> {
    const startedAt = Date.now();
    const steps: WorkshopStep[] = [];
    const warnings: string[] = [];
    let latestMutationEvidence: Record<string, unknown> = {};
    let latestEnvironmentRecoveryEvidence: Record<string, unknown> = {};
    const mutationToolResults: Array<{ toolName: string; result: unknown }> = [];
    let composeStartHistoryStateRef: PhotoshopHistoryStateRef | undefined;
    let documentId: number | undefined;
    const { executeToolCall, inferLayerId, invokeMain, options } = deps;

    const normalized = normalizeComposeDesignSpec(rawParams);
    if (!normalized.ok || !normalized.spec) {
        return {
            success: false,
            status: 'failed',
            code: 'design_spec_invalid',
            failedStep: '设计稿校验',
            error: `composeDesign 设计稿不完整：${normalized.issues.join('；')}`,
            message: '设计方案信息还不完整，本次没有修改 Photoshop。Agent 可补全设计决定后继续。',
            issues: normalized.issues,
            issueDetails: buildComposeDesignIssueDetails(normalized.issues),
            steps
        };
    }
    const spec: ComposeDesignSpec = normalized.spec;
    const primarySubjectRegionIndex = findPrimarySubjectRegionIndex(spec);
    warnings.push(...normalized.notes);
    const visualStylePreflight = resolveRenderLayoutVisualStyle({
        backgroundHex: spec.palette.backgroundHex,
        visualStyle: spec.layout.visualStyle
    });
    if (!visualStylePreflight.ok) {
        return {
            success: false,
            status: 'failed',
            failedStep: '设计稿校验',
            error: `composeDesign 视觉样式不符合执行范围：${visualStylePreflight.issues.join('；')}`,
            message: '当前视觉方案还有无法可靠执行的部分，本次没有修改 Photoshop。Agent 可调整方案后继续。',
            issues: visualStylePreflight.issues,
            steps
        };
    }
    const sourceAudit = buildComposeDesignSourceAudit(spec, deps.projectPath);
    const outsideSources = Array.isArray(sourceAudit.sources)
        ? sourceAudit.sources.filter((source: any) => source?.projectAffinity === 'outside_current_project')
        : [];
    if (outsideSources.length > 0) {
        warnings.push(`素材来源审计：${outsideSources.map((source: any) => `${source.role}=${source.path}`).join('；')} 不在当前项目目录；这是路径事实，不自动等于错误，但交付说明必须能追溯到用户附件或导入来源。`);
    }

    const recordMutationToolResult = (tool: string, result: unknown): void => {
        if (!COMPOSE_DESIGN_MUTATION_TOOLS.has(tool)) return;
        mutationToolResults.push({ toolName: tool, result });
        const mutationCommit = readPhotoshopMutationCommit(result);
        const historyTransition = readPhotoshopHistoryTransition(result);
        if (tool === 'createDocument'
            && mutationCommit?.changeKind === 'document_creation'
            && mutationCommit.createdDocumentId) {
            documentId = mutationCommit.createdDocumentId;
        }
        const mutationEvidence = {
            ...(mutationCommit?.mutationObserved === true ? { photoshopMutationCommit: mutationCommit } : {}),
            ...(historyTransition?.mutationObserved === true ? { photoshopHistoryTransition: historyTransition } : {})
        };
        if (Object.keys(mutationEvidence).length > 0) latestMutationEvidence = mutationEvidence;
    };

    const run = async (
        step: string,
        tool: string,
        params: any,
        executionOptions: any = options
    ): Promise<{ result: any; layerId?: number }> => {
        const t0 = Date.now();
        let result: any;
        try {
            result = await executeToolCall(tool, params, executionOptions);
        } catch (error: any) {
            const thrownResult = error && typeof error === 'object' && !Array.isArray(error)
                ? { ...error, success: false, error: error?.message || String(error) }
                : { success: false, error: String(error) };
            const environmentRecovery = readComposeEnvironmentRecoveryEvidence([
                { toolName: tool, result: thrownResult }
            ]);
            if (Object.keys(environmentRecovery).length > 0) {
                latestEnvironmentRecoveryEvidence = environmentRecovery;
            }
            recordMutationToolResult(tool, thrownResult);
            steps.push({
                step,
                tool,
                ok: false,
                ms: Date.now() - t0,
                detail: String(thrownResult.error).slice(0, 300)
            });
            throw error;
        }
        const ok = result?.success !== false;
        const layerId = ok ? inferLayerId(tool, params, result) : undefined;
        const environmentRecovery = readComposeEnvironmentRecoveryEvidence([
            { toolName: tool, result }
        ]);
        if (Object.keys(environmentRecovery).length > 0) {
            latestEnvironmentRecoveryEvidence = environmentRecovery;
        }
        recordMutationToolResult(tool, result);
        steps.push({
            step,
            tool,
            ok,
            ms: Date.now() - t0,
            layerId,
            detail: ok ? undefined : String(result?.error || result?.message || 'unknown error').slice(0, 300)
        });
        return { result, layerId };
    };

    const settleFailedMutationState = async (): Promise<ComposeMutationSettlement> => {
        const attemptedMutationTools = steps
            .filter((item) => COMPOSE_DESIGN_MUTATION_TOOLS.has(item.tool))
            .map((item) => item.tool);
        const successfulMutationTools = steps
            .filter((item) => item.ok && COMPOSE_DESIGN_MUTATION_TOOLS.has(item.tool))
            .map((item) => item.tool);
        if (attemptedMutationTools.length === 0) {
            return {
                status: 'not_observed',
                attemptedMutationTools,
                successfulMutationTools,
                reason: '失败发生在第一个 Photoshop 写入调用之前。'
            };
        }

        const t0 = Date.now();
        let settlementRead: any;
        try {
            settlementRead = await executeToolCall('getDocumentInfo', {}, options);
        } catch (error: any) {
            settlementRead = error && typeof error === 'object' && !Array.isArray(error)
                ? { ...error, success: false, error: error?.message || String(error) }
                : { success: false, error: String(error) };
        }
        const settlementEnvironmentRecovery = readComposeEnvironmentRecoveryEvidence([
            { toolName: 'getDocumentInfo', result: settlementRead }
        ]);
        if (Object.keys(settlementEnvironmentRecovery).length > 0) {
            latestEnvironmentRecoveryEvidence = settlementEnvironmentRecovery;
        }
        const finalHistoryStateRef = settlementRead?.success === false
            ? undefined
            : readPhotoshopHistoryStateRef(settlementRead);
        steps.push({
            step: '结算失败后的 Photoshop 版本',
            tool: 'getDocumentInfo',
            ok: Boolean(finalHistoryStateRef),
            ms: Date.now() - t0,
            detail: finalHistoryStateRef
                ? `document=${finalHistoryStateRef.documentId}, history=${finalHistoryStateRef.historyStateId}`
                : String(settlementRead?.error || '未取得最终 historyStateRef').slice(0, 300)
        });
        const observedMutationProof = findObservedPhotoshopMutationProof({
            ...latestMutationEvidence,
            toolResults: mutationToolResults
        });

        if (composeStartHistoryStateRef && finalHistoryStateRef) {
            if (composeStartHistoryStateRef.documentId !== finalHistoryStateRef.documentId) {
                latestMutationEvidence = {};
                return {
                    status: 'unknown',
                    attemptedMutationTools,
                    successfulMutationTools,
                    finalHistoryStateRef,
                    reason: '失败结算时活动文档身份已经变化，不能把其他文档版本冒充本次写入结果。'
                };
            }
            const transition = buildPhotoshopHistoryTransition(
                { historyStateRef: composeStartHistoryStateRef },
                { historyStateRef: finalHistoryStateRef }
            );
            if (transition.mutationObserved === true) {
                latestMutationEvidence = { photoshopHistoryTransition: transition };
                return {
                    status: 'applied',
                    attemptedMutationTools,
                    successfulMutationTools,
                    finalHistoryStateRef,
                    reason: `同一 Photoshop 文档 history ${composeStartHistoryStateRef.historyStateId} → ${finalHistoryStateRef.historyStateId}。`
                };
            }
            latestMutationEvidence = {};
            return {
                status: 'unknown',
                attemptedMutationTools,
                successfulMutationTools,
                finalHistoryStateRef,
                reason: observedMutationProof
                    ? '子工具报告过真实变更，但最终活动文档回到了起始版本；可能发生撤销、回滚或文档切换，证据冲突，不能声明未修改。'
                    : '已经派发写调用；虽然最终活动文档与起始版本相同，但缺少每个调用均未应用或已验证回滚的收据。'
            };
        }

        if (observedMutationProof) {
            return {
                status: 'applied',
                attemptedMutationTools,
                successfulMutationTools,
                ...(finalHistoryStateRef ? { finalHistoryStateRef } : {}),
                reason: '至少一个子工具返回了 Host 绑定的真实变更证明；最终复合调用没有完整完成。'
            };
        }
        latestMutationEvidence = {};
        return {
            status: 'unknown',
            attemptedMutationTools,
            successfulMutationTools,
            ...(finalHistoryStateRef ? { finalHistoryStateRef } : {}),
            reason: '已经派发 Photoshop 写入调用，但没有取得可证明应用或未应用的最终版本对账。'
        };
    };

    const failExecution = async (
        step: string,
        reason: string,
        extra: Record<string, unknown> = {}
    ): Promise<Record<string, unknown>> => {
        const mutationSettlement = await settleFailedMutationState();
        const existingData = extra.data && typeof extra.data === 'object' && !Array.isArray(extra.data)
            ? extra.data as Record<string, unknown>
            : {};
        return executionFailure(step, reason, spec, documentId, steps, {
            ...extra,
            ...latestMutationEvidence,
            ...latestEnvironmentRecoveryEvidence,
            toolResults: mutationToolResults,
            data: {
                ...existingData,
                mutationSettlement
            }
        });
    };

    try {
    // 活动文档的真实画布是后续纯几何预演的输入，因此先只读确认；新文档则等所有
    // 可确定的素材/主体/摄影约束都通过后再创建，避免预演失败留下空文档。
    if (spec.document.mode === 'active') {
        const { result } = await run('确认活动文档', 'getDocumentInfo', {});
        if (result?.success === false || !result?.document) {
            return failExecution('确认活动文档', result?.error || '没有可用的活动文档；document.mode=active 需要先打开或切换到目标文档');
        }
        documentId = Number(result.document.id) || undefined;
        composeStartHistoryStateRef = readPhotoshopHistoryStateRef(result);
        const w = Number(result.document.width);
        const h = Number(result.document.height);
        if (w && h && (Math.abs(w - spec.canvas.width) > 1 || Math.abs(h - spec.canvas.height) > 1)) {
            warnings.push(`活动文档实际 ${w}×${h}，与设计稿 canvas ${spec.canvas.width}×${spec.canvas.height} 不一致；按文档实际尺寸排版`);
            spec.canvas = { width: w, height: h };
        }
    }

    // 写入前素材准备：照片素材 → 透明 PNG 文件；原照片保留作场景底的光线参照。
    const originalSubjectPath = spec.subject?.filePath;
    let subjectFilePath = spec.subject?.filePath;
    let cutoutInfo: Record<string, unknown> | undefined;
    if (spec.subject?.cutout && subjectFilePath) {
        const t0 = Date.now();
        let cutout: any;
        try {
            cutout = await invokeMain('designWorkshop:prepareSubjectCutout', { filePath: subjectFilePath });
        } catch (error: any) {
            cutout = { success: false, error: error?.message || String(error) };
        }
        steps.push({
            step: '产品抠图',
            tool: 'designWorkshop:prepareSubjectCutout',
            ok: cutout?.success === true,
            ms: Date.now() - t0,
            detail: cutout?.success ? String(cutout.filePath || '') : String(cutout?.error || '').slice(0, 300)
        });
        if (cutout?.success && cutout.filePath) {
            subjectFilePath = String(cutout.filePath);
            cutoutInfo = { filePath: subjectFilePath, sourcePath: originalSubjectPath, usedModel: cutout.usedModel };
        } else {
            // 用户原则（2026-08-19）：不兜底。抠图失败就停在这一步：是换 treatment=photo（照片本身当画面）、换一张更好抠的素材，还是先修抠图服务，由模型判断。
            return failExecution('产品抠图', `${cutout?.error || '未返回透明图'}。可改 subject.treatment=photo 用照片本身当画面重调（document.mode=active），或换一张背景干净、主体完整的素材`);
        }
    }

    // ①.6 源图宽高与主体框是两种独立事实：普通完整摄影 placement 只需要宽高；
    // 只有 Agent 显式声明主体占比或 protect-subject 时，才消费可用主体框。
    let photoInfo: ComposePhotoSourceFacts | undefined;
    if (subjectFilePath) {
        const t0 = Date.now();
        try {
            const box: any = await invokeMain('resource:getAssetSubjectBox', subjectFilePath);
            const rel = box?.resolution?.box;
            const iw = Number(box?.imageWidth);
            const ih = Number(box?.imageHeight);
            const subjectBox = rel
                ? {
                    x: Number(rel.x),
                    y: Number(rel.y),
                    width: Number(rel.width),
                    height: Number(rel.height)
                }
                : undefined;
            const hasValidSubjectBox = Boolean(box?.success && subjectBox)
                && [subjectBox!.x, subjectBox!.y, subjectBox!.width, subjectBox!.height]
                    .every(Number.isFinite)
                && subjectBox!.x >= 0
                && subjectBox!.y >= 0
                && subjectBox!.width > 0
                && subjectBox!.height > 0
                && subjectBox!.x + subjectBox!.width <= 1
                && subjectBox!.y + subjectBox!.height <= 1;
            if (iw > 0 && ih > 0) {
                photoInfo = {
                    width: iw,
                    height: ih,
                    ...(hasValidSubjectBox
                        ? {
                            subject: {
                                box: subjectBox!,
                                method: box?.resolution?.method,
                                confidence: box?.resolution?.confidence
                            }
                        }
                        : {})
                };
            }
            let sourceFactDetail: string;
            if (photoInfo?.subject) {
                sourceFactDetail = `尺寸 ${photoInfo.width}×${photoInfo.height}；相对主体框 ${photoInfo.subject.box.x.toFixed(3)},${photoInfo.subject.box.y.toFixed(3)},${photoInfo.subject.box.width.toFixed(3)},${photoInfo.subject.box.height.toFixed(3)}（${photoInfo.subject.method || ''} ${photoInfo.subject.confidence || ''}）`;
            } else if (photoInfo) {
                sourceFactDetail = `尺寸 ${photoInfo.width}×${photoInfo.height}；未取得可用主体框`;
            } else {
                sourceFactDetail = String(box?.error || '未得到源图尺寸').slice(0, 200);
            }
            steps.push({
                step: '读取摄影源图事实',
                tool: 'resource:getAssetSubjectBox',
                ok: photoInfo !== undefined,
                ms: Date.now() - t0,
                detail: sourceFactDetail
            });
        } catch (error: any) {
            steps.push({ step: '读取摄影源图事实', tool: 'resource:getAssetSubjectBox', ok: false, ms: Date.now() - t0, detail: String(error?.message || error).slice(0, 200) });
        }
    }
    if (spec.subject?.treatment === 'photo' && subjectFilePath && !photoInfo) {
        const t0 = Date.now();
        try {
            const probe: any = await invokeMain('resource:probeImageFile', subjectFilePath);
            const width = Number(probe?.dimensions?.width);
            const height = Number(probe?.dimensions?.height);
            if (probe?.success && width > 0 && height > 0) {
                photoInfo = { width, height };
            }
            steps.push({
                step: '读取摄影源图尺寸',
                tool: 'resource:probeImageFile',
                ok: photoInfo !== undefined,
                ms: Date.now() - t0,
                detail: photoInfo
                    ? `尺寸 ${photoInfo.width}×${photoInfo.height}；元数据探针不提供主体框`
                    : String(probe?.error || '未得到源图尺寸').slice(0, 200)
            });
        } catch (error: any) {
            steps.push({ step: '读取摄影源图尺寸', tool: 'resource:probeImageFile', ok: false, ms: Date.now() - t0, detail: String(error?.message || error).slice(0, 200) });
        }
    }

    const photoFirst = spec.subject?.treatment === 'photo' && Boolean(subjectFilePath);
    const photoTargetRegion = primarySubjectRegionIndex >= 0
        ? spec.layout.regions[primarySubjectRegionIndex]?.bounds
        : undefined;
    const photoPlacementIntent = primarySubjectRegionIndex >= 0
        ? spec.layout.regions[primarySubjectRegionIndex]?.imagePlacement
        : undefined;
    let photoPrewritePlan: ReturnType<typeof planPhotoFullBleedPlacement> = null;
    let photoFramePrewritePlan: ImagePlacementPrewritePlan | undefined;
    let photoPrewriteCropFacts: {
        subjectAfter?: { x: number; y: number; width: number; height: number };
        subjectVisibleRatio?: number;
        frameVisibleRatio: number;
        subjectConfidence: string;
        reliableSubjectEvidence: boolean;
    } | undefined;
    if (photoFirst) {
        if (!photoInfo) {
            return failExecution(
                '摄影图写前预演',
                '未取得摄影源图的真实宽高，不能执行 Agent 声明的图框几何；本次没有创建或修改 Photoshop 文档',
                { prewritePlacement: 'missing_photo_source_dimensions' }
            );
        }
        if (!photoTargetRegion || !photoPlacementIntent) {
            return failExecution(
                '摄影图写前预演',
                'Agent 设计稿缺少可定位的 main-image 主体区域或 imagePlacement；本次没有创建或修改 Photoshop 文档',
                { prewritePlacement: 'missing_photo_prewrite_facts' }
            );
        }
        const subjectMethod = String(photoInfo.subject?.method || '').toLowerCase();
        const subjectConfidence = String(photoInfo.subject?.confidence || '').toLowerCase();
        const usableSubjectEvidence = Boolean(photoInfo.subject)
            && ['alpha', 'trim', 'matting'].includes(subjectMethod)
            && ['certain', 'high', 'medium'].includes(subjectConfidence);
        const reliableSubjectEvidence = usableSubjectEvidence
            && (subjectConfidence === 'certain' || subjectConfidence === 'high');
        const subjectFillDeclared = spec.subject?.fillRatio !== undefined;
        if (subjectFillDeclared) {
            if (!usableSubjectEvidence) {
                return failExecution(
                    '摄影图写前预演',
                    `Agent 已声明 subject.fillRatio，但主体框只有 ${subjectMethod || 'unknown'} / ${subjectConfidence || 'unknown'} 证据，不能把整张照片或低置信框冒充产品主体来兑现占比；本次没有创建或修改 Photoshop 文档`,
                    { prewritePlacement: 'subject_evidence_unusable' }
                );
            }
            photoPrewritePlan = planPhotoFullBleedPlacement({
                canvas: spec.canvas,
                photo: { width: photoInfo.width, height: photoInfo.height },
                subjectBox: photoInfo.subject!.box,
                targetRegion: photoTargetRegion,
                fillRatio: spec.subject!.fillRatio!,
                anchor: photoPlacementIntent.anchor,
                focalPoint: photoPlacementIntent.focalPoint
            });
            if (!photoPrewritePlan) {
                return failExecution(
                    '摄影图写前预演',
                    '无法从当前画布、素材尺寸、主体框、目标区域与声明占比求出有效摄影图框；本次没有创建或修改 Photoshop 文档',
                    { prewritePlacement: 'invalid_photo_plan' }
                );
            }
            if (!photoPrewritePlan.designIntentSatisfied) {
                return failExecution(
                    '摄影图写前预演',
                    `摄影满幅、主体占比与锚点/关注点不能同时兑现：声明主体占比 ${photoPrewritePlan.requestedFillRatio.toFixed(3)}，按满幅约束将变为约 ${photoPrewritePlan.actualFillRatio.toFixed(3)}，焦点偏差约 ${Math.round(photoPrewritePlan.focusDeviationPx)}px（${photoPrewritePlan.constraintIssues.join('、') || 'focus_not_satisfied'}）。请由 Agent 调整设计，Harness 不替它决定牺牲哪一项；本次没有创建或修改 Photoshop 文档`,
                    { photoPlan: photoPrewritePlan }
                );
            }
            const subjectAfter = {
                x: photoPrewritePlan.x + photoInfo.subject!.box.x * photoPrewritePlan.width,
                y: photoPrewritePlan.y + photoInfo.subject!.box.y * photoPrewritePlan.height,
                width: photoInfo.subject!.box.width * photoPrewritePlan.width,
                height: photoInfo.subject!.box.height * photoPrewritePlan.height
            };
            const visibleWidth = Math.max(
                0,
                Math.min(subjectAfter.x + subjectAfter.width, spec.canvas.width)
                    - Math.max(subjectAfter.x, 0)
            );
            const visibleHeight = Math.max(
                0,
                Math.min(subjectAfter.y + subjectAfter.height, spec.canvas.height)
                    - Math.max(subjectAfter.y, 0)
            );
            const subjectVisibleRatio = (visibleWidth * visibleHeight)
                / Math.max(1, subjectAfter.width * subjectAfter.height);
            const frameVisibleRatio = (spec.canvas.width * spec.canvas.height)
                / Math.max(1, photoPrewritePlan.width * photoPrewritePlan.height);
            if (photoPlacementIntent.cropPolicy === 'protect-subject'
                && subjectVisibleRatio < 1) {
                return failExecution(
                    '摄影图写前预演',
                    `当前满幅构图会让约 ${Math.round((1 - subjectVisibleRatio) * 1000) / 10}% 的检测主体落在画布外，与 protect-subject 冲突；本次没有创建文档或置入图层。请调整区域/占比/锚点，或由 Agent 明确改写裁切意图`,
                    { photoPlan: photoPrewritePlan, subjectAfter, subjectVisibleRatio }
                );
            }
            photoPrewriteCropFacts = {
                subjectAfter,
                subjectVisibleRatio,
                frameVisibleRatio,
                subjectConfidence,
                reliableSubjectEvidence
            };
        } else {
            const framePrewrite = buildImagePlacementPrewritePlan({
                source: {
                    width: photoInfo.width,
                    height: photoInfo.height,
                    ...(usableSubjectEvidence ? {
                        subject: {
                            box: photoInfo.subject!.box,
                            method: photoInfo.subject!.method as ImagePlacementPrewriteSubjectFacts['method'],
                            confidence: photoInfo.subject!.confidence as ImagePlacementPrewriteSubjectFacts['confidence']
                        }
                    } : {})
                },
                target: {
                    x: photoTargetRegion.x * spec.canvas.width,
                    y: photoTargetRegion.y * spec.canvas.height,
                    width: photoTargetRegion.width * spec.canvas.width,
                    height: photoTargetRegion.height * spec.canvas.height
                },
                placement: {
                    fit: photoPlacementIntent.fit,
                    anchor: photoPlacementIntent.anchor,
                    cropPolicy: photoPlacementIntent.cropPolicy,
                    ...(photoPlacementIntent.focalPoint
                        ? { focalPoint: photoPlacementIntent.focalPoint }
                        : {})
                },
                canvas: spec.canvas
            });
            if (!framePrewrite.ok) {
                return failExecution(
                    '摄影图写前预演',
                    `当前完整摄影构图的图框声明无法可靠执行：${framePrewrite.issues.map((issue) => issue.message).join('；')} Harness 没有替 Agent 改写 fit、anchor、关注点或裁切策略；本次没有创建或修改 Photoshop 文档`,
                    { prewritePlacement: 'declared_frame_placement_invalid', placementIssues: framePrewrite.issues }
                );
            }
            photoFramePrewritePlan = framePrewrite.plan;
            photoPrewriteCropFacts = {
                subjectVisibleRatio: framePrewrite.plan.normalPreview.subject?.visibleRatio,
                frameVisibleRatio: framePrewrite.plan.normalPreview.insideTarget.frameRatio,
                subjectConfidence,
                reliableSubjectEvidence
            };
        }
    }

    const renderRegions = spec.layout.regions.map((region, stackOrder) => ({
        ...(isComposeDesignSubjectAliasRegion(region) && subjectFilePath
            ? { ...region, content: subjectFilePath }
            : region),
        stackOrder
    }));
    // 摄影优先时 primary subject 已由上方一次性 placeImage 计划负责；其余独立图片仍须
    // 在 composeDesign 的任何 Photoshop 写入之前通过与 renderLayout 相同的落位预演。
    const effectiveRegions = photoFirst
        ? renderRegions.filter((_region, index) => index !== primarySubjectRegionIndex)
        : renderRegions;
    const renderLayoutBaseParams = {
        canvas: spec.canvas,
        regions: effectiveRegions,
        visualStyle: spec.layout.visualStyle,
        columns: spec.layout.columns,
        marginScale: spec.layout.marginScale,
        gutterScale: spec.layout.gutterScale,
        pageBackgroundHex: spec.palette.backgroundHex,
        groupName: spec.layout.groupName
    };
    const solvedLayout = solveRegionLayout({
        canvas: spec.canvas,
        columns: spec.layout.columns,
        marginScale: spec.layout.marginScale,
        gutterScale: spec.layout.gutterScale,
        // normalizeComposeDesignSpec 已把空 id 判为无效；这里仅把该运行时事实收窄给布局类型，
        // 不生成替代名称，也不改写 Agent 的语义图层名。
        regions: effectiveRegions.map((region) => ({
            ...region,
            id: region.id!
        })) as NormalizedRegionBlock[]
    });
    const layoutImagePreflightStartedAt = Date.now();
    const layoutImagePreflight = await preflightResolvedImagePlacements({
        blocks: solvedLayout.blocks,
        canvas: spec.canvas,
        executorLabel: 'composeDesign / renderLayout',
        readAssetSubjectBox: (sourcePath: string) => (
            invokeMain('resource:getAssetSubjectBox', sourcePath)
        )
    });
    steps.push({
        step: '预演构图中的全部图片落位',
        tool: 'resource:getAssetSubjectBox',
        ok: layoutImagePreflight.ok,
        ms: Date.now() - layoutImagePreflightStartedAt,
        detail: layoutImagePreflight.ok
            ? `已预演 ${layoutImagePreflight.plansByBlockId.size} 个图片区域`
            : layoutImagePreflight.findings.map((finding) => finding.message).join('；').slice(0, 300)
    });
    if (!layoutImagePreflight.ok) {
        return failExecution(
            '构图图片写前预演',
            `${layoutImagePreflight.findings.map((finding) => finding.message).join('；')} Harness 没有替 Agent 改写图片、图框、关注点或裁切策略；本次没有创建或修改 Photoshop 文档。`,
            {
                placementPreflightFindings: layoutImagePreflight.findings,
                layoutWarnings: solvedLayout.warnings
            }
        );
    }

    // 所有能在源素材坐标中判定的摄影约束已经通过，才允许创建新文档。
    if (spec.document.mode === 'new') {
        const { result } = await run('建画布', 'createDocument', {
            width: spec.canvas.width,
            height: spec.canvas.height,
            ...(spec.canvas.resolution ? { resolution: spec.canvas.resolution } : {}),
            ...(spec.canvas.colorMode ? { colorMode: spec.canvas.colorMode } : {}),
            name: spec.document.name,
            backgroundColor: 'transparent'
        });
        if (result?.success === false) {
            return failExecution('建画布', result?.error || 'createDocument 未成功');
        }
        documentId = Number(result?.documentId ?? result?.document?.id ?? result?.data?.documentId) || undefined;
    }

    // ② 背景 / 摄影满幅
    let backgroundLayerId: number | undefined;
    let backgroundPlacement: Record<string, unknown> | undefined;
    const backgroundPlacementFindings: any[] = [];
    let backdrop: Record<string, unknown> | undefined;
    let photoPlacement: Record<string, unknown> | undefined;
    const photoPlacementFindings: any[] = [];
    /** 照片三列忙碌度 / 明度与文字侧：交回模型的证据（构图由它定，车间不替它排） */
    let photoEvidence: {
        busyness: { left: number; middle: number; right: number };
        luminance: { left: number; middle: number; right: number };
        textSide: 'left' | 'center' | 'right';
        calmerSide: 'left' | 'right';
    } | undefined;
    let photoLayerId: number | undefined;
    const fullCanvas = { x: 0, y: 0, width: spec.canvas.width, height: spec.canvas.height };
    if (photoFirst) {
        // 摄影优先：先在素材坐标中完成主体框、区域与裁切预演，确认可兑现后才一次置入最终图框。
        // 禁止“先按原尺寸置入，再在错误结果上叠加 transform”的正常路径。
        // 照片分区体检：量出照片左 / 中 / 右三列的忙碌度与明度——这是证据，不是版式。
        // 分区分析只返回忙碌度与明度事实；Harness 不据此改字色、换边或重写 regions。
        try {
            const analysis: any = await invokeMain('designWorkshop:analyzePhotoRegions', { filePath: subjectFilePath });
            if (analysis?.success && Array.isArray(analysis.columns?.busyness)) {
                const [leftBusy, midBusy, rightBusy] = analysis.columns.busyness as number[];
                const [leftLum, midLum, rightLum] = analysis.columns.luminance as number[];
                const { describeTextSideForLayout } = await import('../../../shared/design-workshop/compose-design-spec');
                const textSide = describeTextSideForLayout(spec.layout);
                const sideIndex = textSide === 'left' ? 0 : textSide === 'right' ? 2 : 1;
                const textLuminance = [leftLum, midLum, rightLum][sideIndex];
                const textBusy = [leftBusy, midBusy, rightBusy][sideIndex];
                const calmerSide = leftBusy <= rightBusy ? 'left' : 'right';
                const calmerBusy = Math.min(leftBusy, rightBusy);
                photoEvidence = {
                    busyness: { left: leftBusy, middle: midBusy, right: rightBusy },
                    luminance: { left: leftLum, middle: midLum, right: rightLum },
                    textSide, calmerSide
                };
                steps.push({ step: '照片分区体检', tool: 'designWorkshop:analyzePhotoRegions', ok: true, ms: 0, detail: `忙碌度 左 ${leftBusy.toFixed(2)} / 中 ${midBusy.toFixed(2)} / 右 ${rightBusy.toFixed(2)}；文字落在${textSide === 'left' ? '左' : textSide === 'right' ? '右' : '中'}侧（明度 ${textLuminance.toFixed(2)}）` });
                if (textSide !== 'center' && textBusy > calmerBusy + 0.15) {
                    warnings.push(`文字落在照片较忙的一侧（${textSide === 'left' ? '左' : '右'} ${textBusy.toFixed(2)} vs ${calmerSide === 'left' ? '左' : '右'} ${calmerBusy.toFixed(2)}）；这是观察事实，请由 Agent 根据真实快照判断是否改构图。`);
                }
                warnings.push(`Agent 声明的文字区域平均明度为 ${textLuminance.toFixed(2)}；Harness 未替换 Agent 的字色。`);
            }
        } catch {
            photoEvidence = undefined;
        }
        const subjectFillPlan = photoPrewritePlan;
        const framePlan = photoFramePrewritePlan;
        const targetRegion = photoTargetRegion!;
        const primarySubjectPlacement = photoPlacementIntent!;
        const cropFacts = photoPrewriteCropFacts!;
        if (!subjectFillPlan && !framePlan) {
            return failExecution(
                '摄影图写前预演',
                '摄影图写前计划没有形成可执行图框；本次没有置入图片',
                { prewritePlacement: 'photo_prewrite_plan_missing' }
            );
        }
        if (primarySubjectPlacement.cropPolicy === 'protect-subject'
            && !cropFacts.reliableSubjectEvidence) {
            photoPlacementFindings.push({
                code: 'photo_protected_subject_unverified',
                severity: 'review',
                closureKind: 'visual',
                blockId: String(spec.layout.regions[primarySubjectRegionIndex]?.id || '摄影主体'),
                role: 'main-image',
                message: `摄影图声明 protect-subject，主体框置信度为 ${photoInfo!.subject?.confidence || 'unknown'}，当前满幅构图约有 ${Math.round((1 - cropFacts.frameVisibleRatio) * 100)}% 的图框在画布外；几何预演没有发现主体越界，但 Harness 不能把中置信检测冒充最终视觉结论，必须看真实画面。`
            });
        }
        if (primarySubjectPlacement.cropPolicy === 'allow-crop'
            && cropFacts.frameVisibleRatio < 1) {
            photoPlacementFindings.push({
                code: 'photo_full_bleed_crop_requires_visual_review',
                severity: 'review',
                closureKind: 'visual',
                blockId: String(spec.layout.regions[primarySubjectRegionIndex]?.id || '摄影主体'),
                role: 'main-image',
                message: `Agent 允许摄影图有意裁切；当前满幅构图约有 ${Math.round((1 - cropFacts.frameVisibleRatio) * 100)}% 的图框在画布外，必须看最终真实画面判断裁切是否服务 Brief。`
            });
        }
        let cropPolicySatisfied: boolean | 'unknown' = true;
        if (primarySubjectPlacement.cropPolicy === 'protect-subject') {
            cropPolicySatisfied = cropFacts.reliableSubjectEvidence ? true : 'unknown';
        } else if (primarySubjectPlacement.cropPolicy === 'avoid-crop') {
            cropPolicySatisfied = cropFacts.frameVisibleRatio >= 0.999;
        }
        const finalWrite = framePlan?.finalWrite;
        const finalTargetBounds = subjectFillPlan
            ? {
                x: subjectFillPlan.x,
                y: subjectFillPlan.y,
                width: subjectFillPlan.width,
                height: subjectFillPlan.height
            }
            : finalWrite!.targetBounds;
        const photoLayerName = String(spec.layout.regions[primarySubjectRegionIndex]!.id).trim();
        const placedPhoto = await run('一次置入摄影图最终位置', 'placeImage', {
            filePath: subjectFilePath,
            name: photoLayerName,
            designRole: 'hero',
            placementIntent: 'planned_full_frame',
            targetBounds: finalTargetBounds,
            targetFit: subjectFillPlan ? 'contain' : finalWrite!.fit,
            targetAnchor: subjectFillPlan ? 'center' : finalWrite!.anchor,
            ...(!subjectFillPlan && finalWrite?.focalPoint
                ? { focalPoint: finalWrite.focalPoint }
                : {})
        });
        const layerId = placedPhoto.layerId;
        if (placedPhoto.result?.success === false || !layerId) {
            return failExecution(
                '一次置入摄影图最终位置',
                `${placedPhoto.result?.error || 'placeImage 未返回图层 id'}；写前计划外框为 ${Math.round(finalTargetBounds.width)}×${Math.round(finalTargetBounds.height)} @ ${Math.round(finalTargetBounds.x)},${Math.round(finalTargetBounds.y)}，没有进入“先错放、再补变换”的路径`,
                { photoPlan: subjectFillPlan || framePlan }
            );
        }
        photoLayerId = layerId;
        backgroundLayerId = layerId;
        for (const finding of photoPlacementFindings) finding.layerId = layerId;
        const executionPlacement = placedPhoto.result?.placement
            || placedPhoto.result?.data?.placement;
        photoPlacement = {
            ...(subjectFillPlan
                ? subjectFillPlan
                : {
                    version: framePlan!.version,
                    mode: framePlan!.mode,
                    plannedBounds: framePlan!.finalWrite.targetBounds,
                    preview: framePlan!.normalPreview
                }),
            targetRegion,
            ...(subjectFillPlan ? { subjectBox: photoInfo!.subject!.box } : {}),
            subjectEvidence: {
                available: Boolean(photoInfo!.subject),
                method: photoInfo!.subject?.method || 'unknown',
                confidence: photoInfo!.subject?.confidence || 'unknown',
                usedForPlacement: Boolean(subjectFillPlan)
                    || primarySubjectPlacement.cropPolicy === 'protect-subject'
            },
            declaredImagePlacement: primarySubjectPlacement,
            cropFacts: {
                frameVisibleRatio: cropFacts.frameVisibleRatio,
                ...(cropFacts.subjectVisibleRatio !== undefined
                    ? { subjectVisibleRatio: cropFacts.subjectVisibleRatio }
                    : {}),
                cropPolicySatisfied,
                subjectDetectionConfidence: photoInfo!.subject?.confidence || 'unavailable'
            },
            executionPlacement
        };
        if (subjectFillPlan) warnings.push(...subjectFillPlan.notes);
    } else if (spec.background.kind === 'solid') {
        const { result, layerId } = await run('铺纯色底', 'createRectangle', {
            ...fullCanvas, fillColorHex: spec.background.colorHex, name: '背景-底色'
        });
        if (result?.success === false) return failExecution('铺纯色底', result?.error || 'createRectangle 未成功');
        backgroundLayerId = layerId;
    } else if (spec.background.kind === 'gradient') {
        const gradient = spec.background.gradient!;
        const { result, layerId } = await run('铺渐变底·底板', 'createRectangle', {
            ...fullCanvas, fillColorHex: gradient.fromHex, name: '背景-渐变'
        });
        if (result?.success === false || !layerId) return failExecution('铺渐变底', result?.error || 'createRectangle 未返回图层 id');
        backgroundLayerId = layerId;
        const overlay = await run('铺渐变底·渐变叠加', 'addGradientOverlay', {
            layerId,
            startColor: hexToRgb(gradient.fromHex),
            endColor: hexToRgb(gradient.toHex),
            angle: Number.isFinite(Number(gradient.angle)) ? Number(gradient.angle) : 90,
            opacity: 100
        });
        if (overlay.result?.success === false) {
            // 用户原则（2026-08-19）：不兜底。渐变没叠上就是背景没按设计做出来，停在这一步交回，别悄悄变纯色。
            return failExecution('渐变叠加', `${overlay.result?.error || 'addGradientOverlay failed'}。底色矩形已铺（${gradient.fromHex}）；可重调一次，或改 background.kind=solid 明确用纯色`, { backgroundLayerId });
        }
    } else if (spec.background.kind === 'asset' || spec.background.kind === 'generated') {
        let imageParams: Record<string, unknown>;
        if (spec.background.kind === 'asset') {
            imageParams = { filePath: spec.background.filePath };
        } else {
            const referencePath = String(spec.background.referenceFilePath || originalSubjectPath || '').trim();
            const prompt = buildBackdropPrompt(spec);
            const t0 = Date.now();
            let generation: any;
            try {
                generation = await invokeMain('designWorkshop:generateBackdrop', {
                    referenceFilePath: referencePath,
                    prompt,
                    width: spec.canvas.width,
                    height: spec.canvas.height
                });
            } catch (error: any) {
                generation = { success: false, error: error?.message || String(error) };
            }
            steps.push({
                step: '生成场景底',
                tool: 'designWorkshop:generateBackdrop',
                ok: generation?.success === true,
                ms: Date.now() - t0,
                detail: generation?.success ? `${generation.model || ''} ${generation.width || '?'}×${generation.height || '?'}` : String(generation?.error || '').slice(0, 300)
            });
            if (!generation?.success || !generation?.imageData) {
                // 用户原则（2026-08-19）：不兜底。生成不可用（欠费 / 无 Key / 超时）就停在这一步、把原因交回：
                // 是换 background.kind=solid / gradient / asset 重调，还是告诉用户去充值，由模型判断，不由车间偷偷换成纯色。
                return failExecution('生成场景底', `${generation?.error || '未返回图片'}。画布已建、主体已备好；请改 background.kind 为 solid / gradient / asset 重调（document.mode=active 接着做），或如实告诉用户生成服务不可用`, { cutout: cutoutInfo });
            } else {
                backdrop = { model: generation.model, width: generation.width, height: generation.height, prompt };
                imageParams = { imageData: generation.imageData };
            }
        }
        if (Object.keys(imageParams).length > 0) {
            const declaredBackgroundPlacement = spec.background.imagePlacement!;
            const backgroundSemanticName = spec.background.kind === 'asset'
                ? `背景·${readFileStem(spec.background.filePath) || '场景素材'}`
                : '背景·生成场景';
            const { result, layerId } = await run('置入背景图', 'placeImage', {
                ...imageParams,
                name: backgroundSemanticName,
                designRole: 'background',
                placementIntent: 'planned_full_frame',
                targetBounds: fullCanvas,
                targetFit: declaredBackgroundPlacement.fit,
                targetAnchor: declaredBackgroundPlacement.anchor,
                ...(declaredBackgroundPlacement.focalPoint
                    ? { focalPoint: declaredBackgroundPlacement.focalPoint }
                    : {})
            });
            if (result?.success === false || !layerId) return failExecution('置入背景图', result?.error || 'placeImage 未返回图层 id');
            backgroundLayerId = layerId;
            {
                const geometry = result?.placement
                    || result?.data?.placement;
                backgroundPlacement = {
                    declared: declaredBackgroundPlacement,
                    geometry
                };
                const outsideTargetFraction = Number(geometry?.outsideTargetFraction);
                if (!geometry?.geometryVerification?.verified) {
                    backgroundPlacementFindings.push({
                        code: 'background_placement_receipt_unverified',
                        severity: 'review',
                        closureKind: 'observation',
                        blockId: '背景素材',
                        role: 'background',
                        layerId,
                        message: '背景已经执行落位，但缺少 verified=true 的 UXP 写后几何收据，不能确认锚点或关注点已兑现。'
                    });
                } else if (declaredBackgroundPlacement.cropPolicy === 'allow-crop'
                    && Number.isFinite(outsideTargetFraction)
                    && outsideTargetFraction > 0.015) {
                    backgroundPlacementFindings.push({
                        code: 'background_crop_requires_visual_review',
                        severity: 'review',
                        closureKind: 'visual',
                        blockId: '背景素材',
                        role: 'background',
                        layerId,
                        message: `Agent 允许背景有意超出画布，当前约有 ${Math.round(outsideTargetFraction * 100)}% 的图框位于画布外；请看最终画面判断关注区域、光线和留白是否仍成立。`
                    });
                }
            }
        }
    }

    // ③ 执行 Agent 构图（主体 + 文字；背景已在上方处理）。
    const renderLayoutParams = {
        ...renderLayoutBaseParams,
        ownedLayers: backgroundLayerId !== undefined
            ? [{
                layerId: backgroundLayerId,
                bucket: '图片',
                blockId: photoFirst
                    ? String(spec.layout.regions[primarySubjectRegionIndex]?.id || '摄影主体')
                    : '背景',
                stackOrder: photoFirst ? primarySubjectRegionIndex : -1
            }]
            : []
    };
    const layoutStepName = '按 Agent 设计稿排版';
    const deferredLayoutObservationOptions = {
        ...options,
        deferCompositeVisualObservation: true
    };
    const layout = await run(
        layoutStepName,
        'renderLayout',
        renderLayoutParams,
        deferredLayoutObservationOptions
    );
    const layoutResult = layout.result;
    if (layoutResult?.success === false) {
        return failExecution('执行 Agent 构图', layoutResult?.error || (Array.isArray(layoutResult?.errors) ? layoutResult.errors.map((e: any) => e?.error).join('；') : 'renderLayout 未成功'), {
            layoutResult: {
                message: layoutResult?.message,
                errors: layoutResult?.errors,
                warnings: layoutResult?.warnings,
                createdLayerIds: layoutResult?.createdLayerIds,
                cleanupFailures: layoutResult?.cleanupFailures,
                stageSwapReceipt: layoutResult?.stageSwapReceipt,
                photoshopHistoryTransition: layoutResult?.photoshopHistoryTransition,
                photoshopMutationCommit: layoutResult?.photoshopMutationCommit
            }
        });
    }
    if (Array.isArray(layoutResult?.warnings)) warnings.push(...layoutResult.warnings.map((w: unknown) => String(w)));
    const subjectLayerIds: number[] = Array.isArray(layoutResult?.subjectLayerIds)
        ? layoutResult.subjectLayerIds.filter((id: unknown) => Number.isFinite(Number(id))).map(Number)
        : [];
    const primarySubjectRegionId = primarySubjectRegionIndex >= 0
        ? String(spec.layout.regions[primarySubjectRegionIndex]?.id || '')
        : '';
    const primarySubjectLayerIds: number[] = Array.isArray(layoutResult?.created)
        ? layoutResult.created
            .filter((entry: any) => primarySubjectRegionId && String(entry?.id || '') === primarySubjectRegionId)
            .map((entry: any) => Number(entry?.layerId))
            .filter((layerId: number) => Number.isFinite(layerId) && layerId > 0)
        : [];

    // ④ 主体投影
    const shadowPlan = spec.subject ? planSubjectShadow(spec.subject.shadow) : null;
    if (shadowPlan && primarySubjectLayerIds.length > 0) {
        for (const layerId of primarySubjectLayerIds) {
            const shadow = await run('主体投影', 'addDropShadow', { layerId, ...shadowPlan });
            if (shadow.result?.success === false) {
                return failExecution(
                    '主体投影',
                    `${shadow.result?.error || 'addDropShadow failed'}；写入结果未被当作“未发生”，请先按工具回执核对当前文档版本后再续做`,
                    { shadowResult: shadow.result, subjectLayerId: layerId }
                );
            }
        }
    } else if (shadowPlan && spec.subject) {
        warnings.push('未识别到主体图层，已按事实跳过投影；请由 Agent 检查主体区域与素材图层收据');
    }

    // ⑤ 对不对：文案功能词必须有产品事实来源（真机：写了「3D立体编织 / 透气亲肤」而产品事实里没有）
    const { checkFunctionalClaims, describeFactCheckFindings } = await import('../../../shared/design-fact-check');
    const copyTexts = [
        { layerName: '主标题', text: Array.isArray(spec.layout.headline) ? spec.layout.headline.join('\n') : String(spec.layout.headline || '') },
        ...(spec.layout.subline ? [{ layerName: '副标题', text: String(spec.layout.subline) }] : []),
        ...((spec.layout.proofItems || []).map((item, index) => ({ layerName: `卖点-${index + 1}`, text: String(item) }))),
        ...(spec.layout.dataBar ? [{ layerName: '数据条', text: String(spec.layout.dataBar) }] : []),
        ...((spec.layout.regions || [])
            .filter((region) => !isComposeDesignSubjectAliasRegion(region) && !rendersLayoutBlockAsImage(region))
            .map((region) => ({ layerName: region.id || region.role, text: String(region.content) })))
    ].filter((entry) => entry.text.trim());
    const factFindings = checkFunctionalClaims(copyTexts, spec.productFacts);
    if (factFindings.length > 0) {
        warnings.push(`对不对：${factFindings.map((f) => f.message).join('；')}`);
    }

    let finalSnapshot = layoutResult?.snapshot;
    let finalPostWriteObservation = layoutResult?.postWriteObservation;
    let finalVisualObservationBundle = rebindComposeVisualObservationBundle(
        layoutResult?.visualObservationBundle
    );
    let finalVisualToolResults = layoutResult?.toolResults;
    let finalDocumentInfo = layoutResult?.documentInfo;
    let finalHistoryStateRef = layoutResult?.historyStateRef;
    let finalStructureReadback: any;
    const finalObservationFindings: any[] = [];
    // renderLayout 在 composeDesign 内显式延迟视觉采集；所有背景、布局和投影写入结束后，
    // 由外层只读一次最终结构/画面，避免重复截图和旧 historyState 冒充最终版本。
    {
        const structureRead = await run(
            '读取最终写后结构',
            'getLayerHierarchy',
            { includeBounds: true }
        );
        finalStructureReadback = structureRead.result;
        const finalWriteHistoryStateRef = readPhotoshopHistoryStateRef(structureRead.result);
        const overviewParams = {
            region: { x: 0, y: 0, width: spec.canvas.width, height: spec.canvas.height },
            maxSize: 1600,
            ...(finalWriteHistoryStateRef?.documentId
                ? { expectedDocumentId: finalWriteHistoryStateRef.documentId }
                : {})
        };
        const overview = await run('读取最终写后画面', 'getCanvasSnapshot', overviewParams);
        const overviewHistoryStateRef = readPhotoshopHistoryStateRef(overview.result);
        const overviewSnapshot = readComposeSnapshotPayload(overview.result);
        const overviewImage = readComposeSnapshotImage(overviewSnapshot);
        const overviewCaptured = overview.result?.success !== false && Boolean(overviewImage);
        const verifiedSameDocumentVersion = overviewCaptured
            && Boolean(finalWriteHistoryStateRef)
            && samePhotoshopHistoryStateRef(finalWriteHistoryStateRef, overviewHistoryStateRef);
        finalSnapshot = overviewSnapshot;
        finalHistoryStateRef = overviewHistoryStateRef || finalWriteHistoryStateRef;
        finalDocumentInfo = overview.result?.documentInfo || overview.result?.data?.documentInfo;
        finalPostWriteObservation = {
            toolName: 'getCanvasSnapshot',
            params: overviewParams,
            captured: overviewCaptured,
            historyStateRef: overviewHistoryStateRef,
            writeHistoryStateRef: finalWriteHistoryStateRef,
            documentInfo: finalDocumentInfo,
            verifiedSameDocumentVersion,
            error: overviewCaptured
                ? (verifiedSameDocumentVersion
                    ? undefined
                    : '最终写入后的画面与 Photoshop 历史版本不一致')
                : String(overview.result?.error || 'getCanvasSnapshot 未返回可读取的最终画面')
        };
        if (!overviewCaptured || !verifiedSameDocumentVersion) {
            finalObservationFindings.push({
                code: 'compose_final_visual_observation_unverified',
                severity: overviewCaptured ? 'repair' : 'review',
                closureKind: overviewCaptured ? 'replan' : 'observation',
                blockId: spec.layout.groupName,
                role: 'layout',
                message: `composeDesign 在最后一次视觉写入后未取得可信的同版本画面：${finalPostWriteObservation.error}。`
            });
        }

        finalVisualObservationBundle = undefined;
        finalVisualToolResults = undefined;
        const isLongCanvas = spec.canvas.height > spec.canvas.width * 3;
        const reviewPlan = buildImagePlacementReviewPlan({
            receipts: isLongCanvas && Array.isArray(layoutResult?.imagePlacementReceipts)
                ? layoutResult.imagePlacementReceipts
                : [],
            canvas: spec.canvas
        });
        if (reviewPlan.selectedTargets.length > 0 && finalWriteHistoryStateRef) {
            const items = [];
            const toolResults = [];
            for (let index = 0; index < reviewPlan.selectedTargets.length; index += 1) {
                const reviewTarget = reviewPlan.selectedTargets[index];
                const receipt = reviewTarget.receipt;
                const localParams = {
                    region: reviewTarget.captureRegion,
                    maxSize: 1400,
                    expectedDocumentId: finalWriteHistoryStateRef.documentId
                };
                const local = await run(
                    `读取图片区域「${String(receipt.blockId)}」最终画面`,
                    'getCanvasSnapshot',
                    localParams
                );
                if (local.result && typeof local.result === 'object' && !Array.isArray(local.result)) {
                    local.result.sourceKind = reviewTarget.sourceKind;
                    local.result.sourceId = reviewTarget.sourceId;
                }
                const localSnapshot = readComposeSnapshotPayload(local.result);
                const image = readComposeSnapshotImage(localSnapshot);
                const localHistoryStateRef = readPhotoshopHistoryStateRef(local.result);
                const captured = local.result?.success !== false
                    && Boolean(image)
                    && samePhotoshopHistoryStateRef(finalWriteHistoryStateRef, localHistoryStateRef);
                items.push({
                    identity: {
                        outer: 'composeDesign',
                        resultPath: `$.visualObservationBundle.items[${index}]`,
                        document: String(localHistoryStateRef?.documentId || 'unknown'),
                        history: String(localHistoryStateRef?.historyStateId || 'unknown'),
                        sourceKind: reviewTarget.sourceKind,
                        sourceId: reviewTarget.sourceId
                    },
                    label: `图片区域「${String(receipt.blockId)}」裁切复核`,
                    captured,
                    ...(image ? { image } : {})
                });
                if (local.result && typeof local.result === 'object' && !Array.isArray(local.result)) {
                    toolResults.push({
                        toolName: 'getCanvasSnapshot',
                        success: local.result.success !== false,
                        result: local.result
                    });
                }
            }
            finalVisualObservationBundle = {
                version: 'visual-observation-bundle/v1',
                expectedObservationCount: reviewPlan.expectedTargets.length,
                expectedTargets: reviewPlan.expectedTargets,
                items,
                ...(reviewPlan.overflow ? { overflow: reviewPlan.overflow } : {})
            };
            finalVisualToolResults = toolResults;
            if (items.some((item) => item.captured !== true)) {
                finalObservationFindings.push({
                    code: 'compose_local_visual_observation_incomplete',
                    severity: 'review',
                    closureKind: 'observation',
                    blockId: spec.layout.groupName,
                    role: 'layout',
                    message: 'composeDesign 在最后一次写入后没有完整取得全部高裁切风险图片区的同版本局部画面。'
                });
            }
        } else if (!isLongCanvas
            && overviewCaptured
            && verifiedSameDocumentVersion
            && overview.result
            && typeof overview.result === 'object'
            && !Array.isArray(overview.result)
            && overviewImage) {
            overview.result.sourceKind = 'layout-canvas';
            overview.result.sourceId = 'final-canvas';
            finalVisualObservationBundle = {
                version: 'visual-observation-bundle/v1',
                expectedObservationCount: 1,
                expectedTargets: [{ sourceKind: 'layout-canvas', sourceId: 'final-canvas' }],
                items: [{
                    identity: {
                        outer: 'composeDesign',
                        resultPath: '$.visualObservationBundle.items[0]',
                        document: String(overviewHistoryStateRef?.documentId || 'unknown'),
                        history: String(overviewHistoryStateRef?.historyStateId || 'unknown'),
                        sourceKind: 'layout-canvas',
                        sourceId: 'final-canvas'
                    },
                    label: '最终单画布',
                    captured: true,
                    image: overviewImage
                }]
            };
            finalVisualToolResults = [{
                toolName: 'getCanvasSnapshot',
                success: true,
                result: overview.result
            }];
        }
    }

    // ⑤.6 别每次都一样：记录 Agent 实际声明的版面签名，不再记录或比较内置配方。
    const recentLedger = await readRecentDesigns(invokeMain, deps.projectPath);
    const layoutSignature = `regions:${spec.layout.regions.map((region) => {
        const bounds = region.bounds;
        const placement = region.imagePlacement
            ? [
                region.imagePlacement.fit,
                region.imagePlacement.anchor,
                region.imagePlacement.cropPolicy,
                region.imagePlacement.subjectFillRatio ?? '',
                region.imagePlacement.focalPoint
                    ? `${region.imagePlacement.focalPoint.x},${region.imagePlacement.focalPoint.y}`
                    : ''
            ].join(',')
            : '';
        return `${region.role}@${bounds.x.toFixed(3)},${bounds.y.toFixed(3)},${bounds.width.toFixed(3)},${bounds.height.toFixed(3)}${placement ? `[${placement}]` : ''}`;
    }).join('|')}`;
    const fingerprint: DesignFingerprint = {
        version: 'design-fingerprint/v1',
        at: Date.now(),
        documentName: spec.document.name,
        ...(documentId !== undefined ? { documentId } : {}),
        angle: spec.rationale.angle,
        layoutSignature,
        regions: buildDesignFingerprintRegions(spec),
        treatment: spec.subject ? spec.subject.treatment : 'none',
        backgroundKind: photoFirst ? 'photo' : spec.background.kind,
        backgroundHex: photoFirst ? undefined : (spec.background.colorHex || spec.palette.backgroundHex),
        headline: Array.isArray(spec.layout.headline) ? spec.layout.headline.join('\n') : (spec.layout.headline ? String(spec.layout.headline) : undefined),
        selectedAssets: collectComposeDesignSelectedAssets(spec),
        ...(String(spec.rationale.materials || '').trim()
            ? { materialSelectionReason: String(spec.rationale.materials).trim() }
            : {}),
        ...(String(deps.taskScopeId || '').trim() ? { taskScopeId: String(deps.taskScopeId).trim() } : {})
    };
    const sameness = findDesignSameness(fingerprint, recentLedger.items);
    if (sameness.length > 0) {
        warnings.push(`与近期稿雷同：${sameness.join('；')}`);
    }
    const previousComparableDesign = findLatestComparableDesign(fingerprint, recentLedger.items);
    const versionComparison = previousComparableDesign
        ? compareDesignVersions(previousComparableDesign, fingerprint)
        : undefined;
    const versionComparisonFinding = versionComparison?.needsComparativeReview
        ? {
            code: 'candidate_structural_reduction_not_compared',
            severity: 'review',
            closureKind: 'comparison',
            blockId: spec.layout.groupName,
            role: 'layout',
            message: describeVersionComparison(versionComparison),
            comparison: versionComparison
        }
        : undefined;
    const qualityFindings = [
        ...(Array.isArray(layoutResult?.qualityFindings) ? layoutResult.qualityFindings : []),
        ...backgroundPlacementFindings,
        ...photoPlacementFindings,
        ...finalObservationFindings,
        ...(versionComparisonFinding ? [versionComparisonFinding] : [])
    ];
    const qualityState = mergeComposeDesignQualityState(
        layoutResult?.qualityState,
        versionComparison,
        [
            ...backgroundPlacementFindings,
            ...photoPlacementFindings,
            ...finalObservationFindings
        ]
    );
    const artifactFacts = {
        version: 'compose-design-artifact-facts/v1',
        document: {
            id: documentId,
            name: spec.document.name,
            mode: spec.document.mode,
            relationToPreviousCandidate: versionComparison?.relation || 'not_compared'
        },
        canvas: spec.canvas,
        designRationale: spec.rationale,
        materialSelection: {
            version: 'material-selection-receipt/v1',
            selectedAssets: fingerprint.selectedAssets || [],
            explanationStatus: fingerprint.materialSelectionReason ? 'provided' : 'missing',
            ...(fingerprint.materialSelectionReason
                ? { modelAuthoredReason: fingerprint.materialSelectionReason }
                : {}),
            boundaries: {
                modelReasonDoesNotProveChoiceIsGood: true,
                doesNotRankOrSelectReplacement: true,
                doesNotRequireDifferentAsset: true
            }
        },
        declaredRegions: fingerprint.regions,
        declaredRegionCount: fingerprint.regions?.length || 0,
        declaredImageRegionCount: fingerprint.regions?.filter((region) => region.contentKind === 'image').length || 0,
        declaredEditableTextRegionCount: fingerprint.regions?.filter((region) => region.contentKind === 'editable_text').length || 0,
        createdLayerIds: Array.isArray(layoutResult?.createdLayerIds) ? layoutResult.createdLayerIds : [],
        stageGroupName: layoutResult?.stageGroupName,
        productFacts: spec.productFacts,
        reviewStatus: 'candidate_unreviewed',
        factsOnly: true,
        provesBetterThanPreviousCandidate: false
    };

    // ⑥ 是否调用 evaluateDesign 属于 Agent 的风险判断，不是 composeDesign 的隐藏固定流程。
    // 若 renderLayout 后又发生了投影等写入，上方已经重读最终结构与同版本像素，绝不复用旧快照。

    // ⑦ composeDesign 只生产候选，不拥有视觉终审。几何/结构 passed 不能替代模型看图，
    // 因此本工具不再把候选写入「近期成稿」；指纹随结果返回，待同版本视觉评审通过后再晋升。

    const elapsedMs = Date.now() - startedAt;
    const okSteps = steps.filter((item) => item.ok).length;
    const rationaleResultProjection = buildComposeDesignRationaleResultProjection({
        text: spec.rationale.text,
        materials: spec.rationale.materials
    });
    return {
        success: true,
        status: qualityState === 'passed' ? 'completed' : qualityState,
        qualityState,
        continuationRequired: qualityState === 'needs_repair' || qualityState === 'needs_review',
        ...rationaleResultProjection,
        factFindings: factFindings.length ? factFindings : undefined,
        message: [
            `composeDesign 完成：${okSteps}/${steps.length} 步，${(elapsedMs / 1000).toFixed(1)} 秒；文档「${spec.document.name}」已按 Agent 声明的 regions 与 visualStyle 建成可编辑候选稿（${photoFirst ? '摄影素材按显式主体区域定位' : `背景 ${spec.background.kind}`}${subjectLayerIds.length ? '，主体已置入并执行声明的投影' : ''}）。`,
            factFindings.length ? `对不对：${describeFactCheckFindings(factFindings)}` : '',
            sameness.length ? `与近期稿雷同：${sameness.join('；')}。这是事实提示，不会替 Agent 自动改稿。` : '',
            describeVersionComparison(versionComparison),
            '已返回真实结构与快照；由 Agent 根据画面与风险决定是否评审或修订。'
        ].filter(Boolean).join('\n'),
        // 设计说明原样带出：界面「为什么这样做」、运行档案与后续评审器逐条对照都从这里取。
        designRationale: spec.rationale,
        documentId,
        documentInfo: finalDocumentInfo,
        historyStateRef: finalHistoryStateRef,
        snapshot: finalSnapshot,
        postWriteObservation: finalPostWriteObservation,
        visualObservationBundle: finalVisualObservationBundle,
        toolResults: finalVisualToolResults,
        requiresVisualReview: true,
        backgroundLayerId,
        backgroundPlacement,
        backdrop,
        photoLayerId,
        photoPlacement,
        photoEvidence,
        cutout: cutoutInfo,
        subjectLayerIds: subjectLayerIds.length ? subjectLayerIds : undefined,
        stageGroupName: layoutResult?.stageGroupName,
        layerStructureReceipt: layoutResult?.layerStructureReceipt,
        finalStructureReadback,
        ownerReceipt: layoutResult?.ownerReceipt,
        sourceAudit,
        artifactFacts,
        candidateFingerprint: fingerprint,
        versionComparison,
        ...(versionComparisonFinding ? {
            comparisonClosure: {
                status: 'needs_comparative_review',
                closesWith: [
                    'same_document_visual_readback_with_model_review_reason',
                    'version_bound_independent_critic_pass'
                ],
                doesNotRequireSpecificTool: true
            }
        } : {}),
        ...latestMutationEvidence,
        created: layoutResult?.created,
        createdLayerIds: layoutResult?.createdLayerIds,
        imagePlacementReceipts: layoutResult?.imagePlacementReceipts,
        textFitReceipts: layoutResult?.textFitReceipts,
        qualityFindings: qualityFindings.length > 0 ? qualityFindings : undefined,
        occlusionFindings: layoutResult?.occlusionFindings,
        grid: layoutResult?.grid,
        data: {
            version: 'compose-design-execution/v1',
            createdDocument: spec.document.mode === 'new',
            layoutRendered: true,
            partialMutation: false,
            completedStepCount: okSteps,
            ...(documentId !== undefined ? { documentId } : {})
        },
        steps,
        warnings: warnings.length ? warnings : undefined,
        elapsedMs
    };
    } catch (error: any) {
        // 用户结果只投影有界错误与真实 Host 结算；完整 stack 留在内部日志供病历定位，
        // 不能因安全投影而让非预期依赖异常失去根因。
        console.error('[composeDesign] 非预期执行异常', error);
        return failExecution(
            '执行异常',
            String(error?.message || error || 'composeDesign 未知异常'),
            { unexpectedException: true }
        );
    }
}
