/**
 * composeDesign 车间执行器：把 Agent 声明的「设计稿」按稳定制作工序做成可编辑 Photoshop 首稿。
 *
 * 工序：建画布 → 铺背景（solid / gradient / asset / generated）→ renderLayout 执行 Agent 构图
 * → 主体投影 → （可选保存）→ 回读结构与快照。
 *
 * 只串既有原子工具与既有 renderLayout 管线，不重写任何排版 / 建层逻辑；每一步失败都停下并
 * 说清「哪一步、为什么、还能怎么做」，已完成的步骤如实列出（不回滚——半成品也是模型可续的起点）。
 */

import {
    buildBackdropPrompt,
    isComposeDesignSubjectAliasRegion,
    normalizeComposeDesignSpec,
    planSubjectShadow,
    type ComposeDesignSpec
} from '../../../shared/design-workshop/compose-design-spec';
import {
    appendDesignFingerprint,
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
import { isTransientPhotoshopBusyFailure } from '../../../shared/photoshop-transient-error';
import { rendersLayoutBlockAsImage } from '../../../shared/layout/layout-engine';
import { resolveRenderLayoutVisualStyle } from '../../../shared/layout/render-layout-style';
import { classifyFilesystemProjectAffinity } from '../../../shared/photoshop-document-inventory';

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

const COMPOSE_DESIGN_MUTATION_TOOLS: ReadonlySet<string> = new Set([
    'createDocument',
    'placeImage',
    'transformLayer',
    'renameLayer',
    'createRectangle',
    'addGradientOverlay',
    'renderLayout',
    'addDropShadow',
    'saveDocument'
]);

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
                : String(region.content || '').replace(/\s+/g, ' ').trim().slice(0, 120)
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
    comparison?: DesignVersionComparison
): 'passed' | 'needs_review' | 'needs_repair' | 'failed' {
    const normalized = String(layoutQualityState || 'passed');
    if (normalized === 'failed') return 'failed';
    if (normalized === 'needs_repair') return 'needs_repair';
    if (normalized === 'needs_review' || comparison?.needsComparativeReview) return 'needs_review';
    return 'passed';
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

function sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** 只有明确的短时忙碌才允许同一复合步骤重试；原生弹窗/写状态未知必须交回 Agent 观察（判定收拢到 shared/photoshop-transient-error）。 */
function isRetryablePhotoshopBusyFailure(result: any): boolean {
    return isTransientPhotoshopBusyFailure(result);
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
    const successfulMutationTools = steps
        .filter((item) => item.ok && COMPOSE_DESIGN_MUTATION_TOOLS.has(item.tool))
        .map((item) => item.tool);
    const extraData = extra.data && typeof extra.data === 'object' && !Array.isArray(extra.data)
        ? extra.data as Record<string, unknown>
        : {};
    const { data: _data, ...rest } = extra;
    return failure(step, reason, steps, {
        ...rest,
        documentId,
        data: {
            version: 'compose-design-execution/v1',
            createdDocument: spec.document.mode === 'new'
                && steps.some((item) => item.ok && item.tool === 'createDocument'),
            layoutRendered: steps.some((item) => item.ok && item.tool === 'renderLayout'),
            partialMutation: successfulMutationTools.length > 0,
            completedStepCount: steps.filter((item) => item.ok).length,
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
    let documentId: number | undefined;
    const { executeToolCall, inferLayerId, invokeMain, options } = deps;

    const normalized = normalizeComposeDesignSpec(rawParams);
    if (!normalized.ok || !normalized.spec) {
        return {
            success: false,
            status: 'failed',
            failedStep: '设计稿校验',
            error: `composeDesign 设计稿不完整：${normalized.issues.join('；')}`,
            message: '设计方案信息还不完整，本次没有修改 Photoshop。Agent 可补全设计决定后继续。',
            issues: normalized.issues,
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

    const run = async (step: string, tool: string, params: any): Promise<{ result: any; layerId?: number }> => {
        const t0 = Date.now();
        const result = await executeToolCall(tool, params, options);
        const ok = result?.success !== false;
        const layerId = ok ? inferLayerId(tool, params, result) : undefined;
        if (ok && COMPOSE_DESIGN_MUTATION_TOOLS.has(tool)) {
            const mutationEvidence = {
                ...(result?.photoshopMutationCommit ? {
                    photoshopMutationCommit: result.photoshopMutationCommit
                } : {}),
                ...(result?.photoshopHistoryTransition ? {
                    photoshopHistoryTransition: result.photoshopHistoryTransition
                } : {})
            };
            if (Object.keys(mutationEvidence).length > 0) {
                latestMutationEvidence = mutationEvidence;
            }
        }
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

    const failExecution = (
        step: string,
        reason: string,
        extra: Record<string, unknown> = {}
    ): Record<string, unknown> => executionFailure(
        step,
        reason,
        spec,
        documentId,
        steps,
        {
            ...extra,
            ...latestMutationEvidence
        }
    );

    // ① 画布
    if (spec.document.mode === 'new') {
        const { result } = await run('建画布', 'createDocument', {
            width: spec.canvas.width,
            height: spec.canvas.height,
            ...(spec.canvas.resolution ? { resolution: spec.canvas.resolution } : {}),
            ...(spec.canvas.colorMode ? { colorMode: spec.canvas.colorMode } : {}),
            name: spec.document.name,
            // 新文档先使用透明底；solid / gradient / asset / generated 会在下一步显式铺设，
            // none 则保持真正无背景。Harness 不用白色替 Agent 补一个未声明的视觉答案。
            backgroundColor: 'transparent'
        });
        if (result?.success === false) {
            return failExecution('建画布', result?.error || 'createDocument 未成功');
        }
        documentId = Number(result?.documentId ?? result?.document?.id ?? result?.data?.documentId) || undefined;
    } else {
        const { result } = await run('确认活动文档', 'getDocumentInfo', {});
        if (result?.success === false || !result?.document) {
            return failExecution('确认活动文档', result?.error || '没有可用的活动文档；document.mode=active 需要先打开或切换到目标文档');
        }
        documentId = Number(result.document.id) || undefined;
        const w = Number(result.document.width);
        const h = Number(result.document.height);
        if (w && h && (Math.abs(w - spec.canvas.width) > 1 || Math.abs(h - spec.canvas.height) > 1)) {
            warnings.push(`活动文档实际 ${w}×${h}，与设计稿 canvas ${spec.canvas.width}×${spec.canvas.height} 不一致；按文档实际尺寸排版`);
            spec.canvas = { width: w, height: h };
        }
    }

    // ①.5 产品抠图（照片素材 → 透明 PNG 文件）；原照片保留作场景底的光线参照
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

    // ①.6 读取主体在素材中的真实位置。它只提供几何事实，不按主体形状改写构图。
    let photoInfo: { width: number; height: number; box: { x: number; y: number; width: number; height: number }; method?: string; confidence?: string } | undefined;
    if (subjectFilePath) {
        const t0 = Date.now();
        try {
            const box: any = await invokeMain('resource:getAssetSubjectBox', subjectFilePath);
            const rel = box?.resolution?.box;
            const iw = Number(box?.imageWidth);
            const ih = Number(box?.imageHeight);
            if (box?.success && rel && iw > 0 && ih > 0 && Number(rel.width) > 0 && Number(rel.height) > 0) {
                photoInfo = {
                    width: iw, height: ih,
                    box: { x: Number(rel.x), y: Number(rel.y), width: Number(rel.width), height: Number(rel.height) },
                    method: box?.resolution?.method, confidence: box?.resolution?.confidence
                };
            }
            steps.push({
                step: '读取素材主体框',
                tool: 'resource:getAssetSubjectBox',
                ok: photoInfo !== undefined,
                ms: Date.now() - t0,
                detail: photoInfo !== undefined
                    ? `相对框 ${photoInfo.box.x.toFixed(3)},${photoInfo.box.y.toFixed(3)},${photoInfo.box.width.toFixed(3)},${photoInfo.box.height.toFixed(3)}（${box?.resolution?.method || ''} ${box?.resolution?.confidence || ''}）`
                    : String(box?.error || '未得到主体框').slice(0, 200)
            });
        } catch (error: any) {
            steps.push({ step: '读取素材主体框', tool: 'resource:getAssetSubjectBox', ok: false, ms: Date.now() - t0, detail: String(error?.message || error).slice(0, 200) });
        }
    }

    // ② 背景 / 摄影满幅
    let backgroundLayerId: number | undefined;
    let backdrop: Record<string, unknown> | undefined;
    let photoPlacement: Record<string, unknown> | undefined;
    /** 照片三列忙碌度 / 明度与文字侧：交回模型的证据（构图由它定，车间不替它排） */
    let photoEvidence: {
        busyness: { left: number; middle: number; right: number };
        luminance: { left: number; middle: number; right: number };
        textSide: 'left' | 'center' | 'right';
        calmerSide: 'left' | 'right';
    } | undefined;
    let photoLayerId: number | undefined;
    const fullCanvas = { x: 0, y: 0, width: spec.canvas.width, height: spec.canvas.height };
    const photoFirst = spec.subject?.treatment === 'photo' && Boolean(subjectFilePath);
    if (photoFirst) {
        // 摄影优先：先置入照片，再按 Agent 声明的主体区域与占比求解几何；不抠图、不另铺背景。
        const { result, layerId } = await run('置入摄影图', 'placeImage', {
            filePath: subjectFilePath, designRole: 'hero', placementIntent: 'direct_full_frame'
        });
        if (result?.success === false || !layerId) return failExecution('置入摄影图', result?.error || 'placeImage 未返回图层 id');
        photoLayerId = layerId;
        backgroundLayerId = layerId;
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
        const targetRegion = primarySubjectRegionIndex >= 0
            ? spec.layout.regions[primarySubjectRegionIndex]?.bounds
            : undefined;
        if (photoInfo && targetRegion) {
            const { planPhotoFullBleedPlacement } = await import('../../../shared/design-workshop/compose-design-spec');
            const plan = planPhotoFullBleedPlacement({
                canvas: spec.canvas, photo: { width: photoInfo.width, height: photoInfo.height },
                subjectBox: photoInfo.box, targetRegion, fillRatio: spec.subject!.fillRatio!
            });
            if (plan) {
                const fit = await run('摄影图定大小定位置', 'transformLayer', {
                    layerId, targetBounds: { x: plan.x, y: plan.y, width: plan.width, height: plan.height }, targetFit: 'contain'
                });
                if (fit.result?.success === false) {
                    // 用户原则（2026-08-19）：不兜底。定位失败就停在这一步、说清原因，由模型决定换图 / 手给主体框 / 改占比。
                    return failExecution('摄影图定大小定位置', `${fit.result?.error || 'transformLayer failed'}；照片已置入但没定位（计划外框 ${Math.round(plan.width)}×${Math.round(plan.height)} @ ${Math.round(plan.x)},${Math.round(plan.y)}）。可换一张主体更清楚的照片、给 subject.fillRatio、或自己划 regions 再调`, { photoLayerId: layerId, photoPlan: plan });
                }
                photoPlacement = { ...plan, targetRegion, subjectBox: photoInfo.box, detection: `${photoInfo.method || ''} ${photoInfo.confidence || ''}`.trim() };
                warnings.push(...plan.notes);
            }
        } else {
            return failExecution(
                '摄影图主体定位',
                photoInfo
                    ? 'Agent 设计稿缺少 main-image 主体区域，无法执行声明的摄影构图'
                    : '未取得产品在照片中的主体框，不能用居中满幅预设替 Agent 猜测构图；请换可识别素材、改用 cutout，或先提供可靠主体框',
                { photoLayerId: layerId }
            );
        }
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
            const { result, layerId } = await run('置入背景图', 'placeImage', {
                ...imageParams,
                designRole: 'background',
                placementIntent: 'direct_full_frame'
            });
            if (result?.success === false || !layerId) return failExecution('置入背景图', result?.error || 'placeImage 未返回图层 id');
            backgroundLayerId = layerId;
            const cover = await run('背景满幅', 'transformLayer', {
                layerId, targetBounds: fullCanvas, targetFit: 'cover'
            });
            if (cover.result?.success === false) {
                warnings.push(`背景满幅缩放未成功（${cover.result?.error || 'transformLayer failed'}），背景可能未铺满画布`);
            }
        }
    }

    if (backgroundLayerId !== undefined
        && (photoFirst || spec.background.kind === 'asset' || spec.background.kind === 'generated')) {
        let semanticSource: unknown = '生成场景';
        if (photoFirst) {
            semanticSource = originalSubjectPath;
        } else if (spec.background.kind === 'asset') {
            semanticSource = spec.background.filePath;
        }
        const sourceStem = readFileStem(semanticSource);
        const semanticName = photoFirst
            ? String(spec.layout.regions[primarySubjectRegionIndex]?.id || '').trim()
            : `背景·${sourceStem || '场景素材'}`;
        const rename = await run('语义命名素材层', 'renameLayer', {
            layerId: backgroundLayerId,
            newName: semanticName
        });
        if (rename.result?.success === false) {
            warnings.push(`素材层未能改成语义名称「${semanticName}」：${rename.result?.error || 'renameLayer failed'}`);
        }
    }

    // ③ 执行 Agent 构图（主体 + 文字；背景已在上方处理）。
    const renderRegions = spec.layout.regions.map((region) => (
            isComposeDesignSubjectAliasRegion(region) && subjectFilePath
                ? { ...region, content: subjectFilePath }
                : region
        ));
    // 摄影优先时只有 primary subject 区域用于上一步定位摄影图；其余独立图片元素照常渲染。
    const effectiveRegions = photoFirst
        ? renderRegions.filter((_region, index) => index !== primarySubjectRegionIndex)
        : renderRegions;
    const renderLayoutParams = {
        canvas: spec.canvas,
        regions: effectiveRegions,
        visualStyle: spec.layout.visualStyle,
        marginScale: spec.layout.marginScale,
        gutterScale: spec.layout.gutterScale,
        pageBackgroundHex: spec.palette.backgroundHex,
        groupName: spec.layout.groupName,
        ownedLayers: backgroundLayerId !== undefined
            ? [{ layerId: backgroundLayerId, bucket: '图片' }]
            : []
    };
    const layoutStepName = '按 Agent 设计稿排版';
    let layout = await run(layoutStepName, 'renderLayout', renderLayoutParams);
    let layoutResult = layout.result;
    // 仅短时忙碌重试一次。modal_suspected 可能已经派发写入，必须先让 Agent 用
    // capturePhotoshopWindow 看完整 Photoshop 窗口，不能由 Harness 盲目重复写。
    if (layoutResult?.success === false && isRetryablePhotoshopBusyFailure(layoutResult)) {
        await sleep(2000);
        layout = await run(`${layoutStepName}（忙碌后重试）`, 'renderLayout', renderLayoutParams);
        layoutResult = layout.result;
    }
    if (layoutResult?.success === false) {
        return failExecution('执行 Agent 构图', layoutResult?.error || (Array.isArray(layoutResult?.errors) ? layoutResult.errors.map((e: any) => e?.error).join('；') : 'renderLayout 未成功'), {
            layoutResult: {
                message: layoutResult?.message,
                errors: layoutResult?.errors,
                warnings: layoutResult?.warnings
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
                warnings.push(`主体图层 ${layerId} 投影未成功（${shadow.result?.error || 'addDropShadow failed'}）`);
            }
        }
    } else if (shadowPlan && spec.subject) {
        warnings.push('未识别到主体图层，已按事实跳过投影；请由 Agent 检查主体区域与素材图层收据');
    }

    // ⑤ 保存（可选）
    let saved: Record<string, unknown> | undefined;
    if (spec.save) {
        const save = await run('保存', 'saveDocument', {
            format: spec.save.format,
            projectSubdir: spec.save.projectSubdir,
            saveAs: true
        });
        if (save.result?.success === false) {
            warnings.push(`保存未成功（${save.result?.error || 'saveDocument failed'}），文档仍在 Photoshop 中打开`);
        } else {
            saved = { path: save.result?.path || save.result?.filePath, format: spec.save.format };
        }
    }

    // ⑤.5 对不对：文案功能词必须有产品事实来源（真机：写了「3D立体编织 / 透气亲肤」而产品事实里没有）
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

    // ⑤.6 别每次都一样：记录 Agent 实际声明的版面签名，不再记录或比较内置配方。
    const recentLedger = await readRecentDesigns(invokeMain, deps.projectPath);
    const layoutSignature = `regions:${spec.layout.regions.map((region) => {
        const bounds = region.bounds;
        return `${region.role}@${bounds.x.toFixed(3)},${bounds.y.toFixed(3)},${bounds.width.toFixed(3)},${bounds.height.toFixed(3)}`;
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
        ...(versionComparisonFinding ? [versionComparisonFinding] : [])
    ];
    const qualityState = mergeComposeDesignQualityState(layoutResult?.qualityState, versionComparison);
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
        saved,
        factsOnly: true,
        provesBetterThanPreviousCandidate: false
    };

    // ⑥ renderLayout 已带写后结构与快照；不再追加重复的文档读取或强制独立评审。
    // 是否调用 evaluateDesign 属于 Agent 的风险判断，不是 composeDesign 的隐藏固定流程。
    const snapshot = layoutResult?.snapshot;

    // ⑦ 只有结构质量已经通过的稿件才进入「近期成稿」。needs_review / needs_repair 是
    // 可续做的当前版本，不是成稿；把它写进记忆会让失败首稿反过来污染下一次创意判断。
    const completedDesign = qualityState === 'passed';
    if (deps.projectPath && completedDesign) {
        try {
            const nextLedger = appendDesignFingerprint(recentLedger, fingerprint);
            await invokeMain('designWorkshop:writeRecentDesigns', { projectPath: deps.projectPath, ledger: nextLedger });
        } catch {
            // 记不上不影响出稿
        }
    }

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
        documentInfo: layoutResult?.documentInfo,
        historyStateRef: layoutResult?.historyStateRef,
        snapshot,
        requiresVisualReview: true,
        backgroundLayerId,
        backdrop,
        photoLayerId,
        photoPlacement,
        photoEvidence,
        cutout: cutoutInfo,
        subjectLayerIds: subjectLayerIds.length ? subjectLayerIds : undefined,
        stageGroupName: layoutResult?.stageGroupName,
        layerStructureReceipt: layoutResult?.layerStructureReceipt,
        sourceAudit,
        artifactFacts,
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
        createdLayerIds: layoutResult?.createdLayerIds,
        qualityFindings: qualityFindings.length > 0 ? qualityFindings : undefined,
        occlusionFindings: layoutResult?.occlusionFindings,
        grid: layoutResult?.grid,
        saved,
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
}
