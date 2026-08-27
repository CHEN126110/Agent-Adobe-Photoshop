import { buildAgentReActToolArgumentsDigest } from '../../../shared/agent-react-observation-contract';
import {
    buildSkillDeliveryPlan,
    normalizeSkillDeliveryArtifactPath,
    renderSkillDeliveryPattern,
    resolveRuntimeSkillDeliveryConvention,
    resolveSkillDeliveryConvention,
    resolveSkillDeliveryProjectPath,
    type SkillDeliveryConvention,
    type SkillDeliveryConventionResolution,
    type SkillDeliveryEditableFormat,
    type SkillDeliveryPlanArtifact,
    type SkillDeliveryPlan,
    type SkillDeliveryRasterFormat
} from '../../../shared/skills/skill-delivery-convention';
import type { ParsedScreen } from './detail-page.types';

export const DETAIL_PAGE_DELIVERY_PLAN_VERSION =
    'detail-page-delivery-plan/v1' as const;

export interface DetailPageDeliveryPlan {
    version: typeof DETAIL_PAGE_DELIVERY_PLAN_VERSION;
    convention: SkillDeliveryConvention;
    deliveryPlanDigest: string;
    typedPlan: SkillDeliveryPlan;
    projectRoot: string;
    artifacts: SkillDeliveryPlanArtifact[];
    editable?: SkillDeliveryPlanArtifact;
    slices: Array<SkillDeliveryPlanArtifact & {
        screenId: string;
        screenIndex: number;
    }>;
    workflowCommit: {
        toolName: 'detail-page-design';
        params: {
            deliveryAction: 'commit';
            projectPath: string;
            exportSlices: boolean;
            exportQuality: number;
            workMode?: string;
            outputDir?: string;
            deliveryVersion?: string;
            deliveryConvention?: SkillDeliveryConvention;
        };
    };
    toolCalls: {
        saveDocument?: {
            format: 'psd' | 'psb';
            path: string;
            saveAs: true;
            conflictPolicy: 'fail_if_exists';
        };
        exportDetailPageSlices?: {
            screens: ParsedScreen[];
            config: {
                projectRoot: string;
                outputDir: string;
                format: 'jpeg' | 'png';
                quality: number;
                namingPattern: '{index}_{name}';
                createSubfolder: false;
                subfolder: 'detail-page-slices';
                conflictPolicy: 'fail_if_exists' | 'new_version';
                deliveryPlanDigest: string;
                expectedFiles: Array<{
                    screenId: string;
                    path: string;
                }>;
            };
        };
    };
    toolArgumentConstraints: Record<string, {
        argumentsDigest: string;
    }>;
    boundaries: {
        projectBound: true;
        overwriteForbidden: true;
        exactScreenSet: true;
        conventionContainsNoVisualDecisions: true;
        compatibilityOutputDirDoesNotClaimUserAuthority: true;
    };
}

export interface DetailPageDeliveryPlanResolution {
    status: 'ready' | 'blocked';
    plan?: DetailPageDeliveryPlan;
    convention?: SkillDeliveryConvention;
    blockers: string[];
}

export interface DetailPageDeliveryRequestResolution {
    status: 'ready' | 'blocked';
    projectRoot?: string;
    convention?: SkillDeliveryConvention;
    deliveryVersion: string;
    blockers: string[];
}

const DETAIL_PAGE_FALLBACK_DELIVERY_CONVENTION: SkillDeliveryConvention = {
    version: 'skill-delivery-convention/v0',
    provenance: 'skill_fallback',
    supportRefs: [],
    editable: {
        projectRelativeRoot: '详情页/可编辑源稿',
        fileNamePattern: '{defaultName}',
        format: 'psb'
    },
    raster: {
        projectRelativeRoot: '详情页/切片',
        fileNamePattern: '{index}_{screen}',
        format: 'jpg'
    },
    pairing: 'one_master_many_rasters',
    versionPolicy: 'fail_if_exists'
};

function cleanText(value: unknown): string {
    return String(value || '').trim();
}

function isAbsoluteProjectPath(value: string): boolean {
    return /^[a-z]:[\\/]/i.test(value)
        || /^\\\\[^\\/]+[\\/][^\\/]+/.test(value)
        || /^\//.test(value);
}

function normalizeProjectRoot(value: unknown): string {
    const root = cleanText(value).replace(/[\\/]+$/g, '');
    if (!root || !isAbsoluteProjectPath(root)) return '';
    const withoutPrefix = root
        .replace(/^[a-z]:[\\/]/i, '')
        .replace(/^\\\\[^\\/]+[\\/][^\\/]+[\\/]?/, '')
        .replace(/^\/+/, '');
    if (withoutPrefix.split(/[\\/]+/).some((segment) => segment === '.' || segment === '..')) {
        return '';
    }
    return root;
}

function normalizeAbsolutePathForCompare(value: string): string {
    const windows = /^[a-z]:[\\/]/i.test(value) || /^\\\\/.test(value);
    const normalized = value.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/$/g, '');
    return windows ? normalized.toLowerCase() : normalized;
}

function resolveProjectRelativeOutputRoot(
    projectRoot: string,
    outputDir: unknown
): { relativeRoot?: string; absoluteRoot?: string; blockers: string[] } {
    const absoluteRoot = normalizeProjectRoot(outputDir);
    if (!absoluteRoot) {
        return { blockers: ['outputDir 必须是当前项目内无 traversal 的绝对目录。'] };
    }
    const projectKey = normalizeAbsolutePathForCompare(projectRoot);
    const outputKey = normalizeAbsolutePathForCompare(absoluteRoot);
    if (!outputKey.startsWith(`${projectKey}/`)) {
        return { blockers: ['outputDir 必须位于当前项目目录内。'] };
    }
    const normalizedAbsolute = absoluteRoot.replace(/\\/g, '/').replace(/\/$/g, '');
    const normalizedProject = projectRoot.replace(/\\/g, '/').replace(/\/$/g, '');
    const relativeRoot = normalizedAbsolute.slice(normalizedProject.length + 1).trim();
    return relativeRoot
        ? { relativeRoot, absoluteRoot, blockers: [] }
        : { blockers: ['outputDir 不能直接使用项目根目录；请指定一个交付子目录。'] };
}

function basenameWithoutExtension(value: unknown): string {
    const path = cleanText(value).replace(/\\/g, '/');
    const name = path.slice(path.lastIndexOf('/') + 1).trim();
    return name.replace(/\.[^.]+$/, '').trim() || '详情页';
}

function containsVersionToken(convention: SkillDeliveryConvention): boolean {
    return [
        convention.editable?.folderPattern,
        convention.editable?.fileNamePattern,
        convention.raster?.folderPattern,
        convention.raster?.fileNamePattern
    ].some((pattern) => String(pattern || '').includes('{version}'));
}

function joinDeliveryPath(root: string, child: string): string {
    return resolveSkillDeliveryProjectPath(root, child);
}

function appendExtension(
    renderedName: string,
    format: SkillDeliveryEditableFormat | SkillDeliveryRasterFormat
): { value?: string; blockers: string[] } {
    const normalizedFormat = format === 'jpeg' ? 'jpg' : format;
    const existingExtension = (renderedName.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
    if (existingExtension) {
        const normalizedExisting = existingExtension === 'jpeg' ? 'jpg' : existingExtension;
        if (normalizedExisting !== normalizedFormat) {
            return {
                blockers: [`命名 pattern 的扩展名 .${existingExtension} 与 format=${format} 不一致。`]
            };
        }
        return { value: renderedName, blockers: [] };
    }
    return { value: `${renderedName}.${normalizedFormat}`, blockers: [] };
}

function renderFolder(
    root: string,
    pattern: string | undefined,
    values: Parameters<typeof renderSkillDeliveryPattern>[1]
): { value?: string; blockers: string[] } {
    if (!pattern) return { value: root, blockers: [] };
    const rendered = renderSkillDeliveryPattern(pattern, values);
    return rendered.value
        ? { value: joinDeliveryPath(root, rendered.value), blockers: [] }
        : { blockers: rendered.blockers };
}

function normalizeDetailPageDeliveryConvention(
    value: unknown,
    allowSkillFallback = false
): SkillDeliveryConventionResolution {
    if (value === undefined || value === null) {
        return {
            status: 'ready',
            convention: DETAIL_PAGE_FALLBACK_DELIVERY_CONVENTION,
            blockers: []
        };
    }
    return allowSkillFallback
        ? resolveRuntimeSkillDeliveryConvention(value)
        : resolveSkillDeliveryConvention(value);
}

export function resolveDetailPageDeliveryConvention(
    value: unknown
): SkillDeliveryConventionResolution {
    const resolution = normalizeDetailPageDeliveryConvention(value);
    if (resolution.status !== 'ready' || !resolution.convention) return resolution;
    const blockers: string[] = [];
    if (resolution.convention.editable?.format === 'tif') {
        blockers.push('详情页可编辑母稿当前只接受 PSD 或 PSB；TIF 尚无可编辑结构收据。');
    }
    return blockers.length > 0
        ? { status: 'blocked', blockers }
        : resolution;
}

function projectDetailPageConventionForArtifacts(input: {
    convention: SkillDeliveryConvention;
    includeEditable: boolean;
    includeSlices: boolean;
}): SkillDeliveryConvention {
    let pairing: SkillDeliveryConvention['pairing'];
    if (input.includeEditable && input.includeSlices) {
        pairing = 'one_master_many_rasters';
    } else if (input.includeEditable) {
        pairing = 'editable_only';
    } else {
        pairing = 'raster_only';
    }
    return {
        ...input.convention,
        ...(input.includeEditable && input.convention.editable
            ? { editable: { ...input.convention.editable } }
            : { editable: undefined }),
        ...(input.includeSlices && input.convention.raster
            ? { raster: { ...input.convention.raster } }
            : { raster: undefined }),
        pairing
    };
}

export function validateDetailPageDeliveryRequest(input: {
    projectPath: string;
    outputDir?: unknown;
    deliveryConvention?: unknown;
    deliveryVersion?: unknown;
}): DetailPageDeliveryRequestResolution {
    const projectRoot = normalizeProjectRoot(input.projectPath);
    const blockers: string[] = [];
    if (!projectRoot) blockers.push('详情页交付需要无 traversal 的绝对项目目录。');
    let conventionInput = input.deliveryConvention;
    let explicitOutputRoot: string | undefined;
    if (projectRoot && cleanText(input.outputDir)) {
        const outputRoot = resolveProjectRelativeOutputRoot(projectRoot, input.outputDir);
        blockers.push(...outputRoot.blockers);
        explicitOutputRoot = outputRoot.absoluteRoot;
        if (input.deliveryConvention === undefined
            && outputRoot.relativeRoot) {
            conventionInput = {
                ...DETAIL_PAGE_FALLBACK_DELIVERY_CONVENTION,
                provenance: 'skill_fallback',
                supportRefs: [],
                editable: {
                    ...DETAIL_PAGE_FALLBACK_DELIVERY_CONVENTION.editable!,
                    projectRelativeRoot: outputRoot.relativeRoot
                },
                raster: {
                    ...DETAIL_PAGE_FALLBACK_DELIVERY_CONVENTION.raster!,
                    projectRelativeRoot: outputRoot.relativeRoot
                }
            } satisfies SkillDeliveryConvention;
        }
    }
    const conventionResolution = input.deliveryConvention === undefined
        ? normalizeDetailPageDeliveryConvention(conventionInput, true)
        : resolveDetailPageDeliveryConvention(conventionInput);
    blockers.push(...conventionResolution.blockers);
    if (projectRoot
        && explicitOutputRoot
        && input.deliveryConvention !== undefined
        && conventionResolution.convention?.raster) {
        const conventionRasterRoot = resolveSkillDeliveryProjectPath(
            projectRoot,
            conventionResolution.convention.raster.projectRelativeRoot
        );
        if (normalizeAbsolutePathForCompare(conventionRasterRoot)
            !== normalizeAbsolutePathForCompare(explicitOutputRoot)) {
            blockers.push('outputDir 与 deliveryConvention.raster.projectRelativeRoot 冲突。');
        }
    }
    const deliveryVersion = cleanText(input.deliveryVersion);
    if (conventionResolution.convention
        && containsVersionToken(conventionResolution.convention)
        && !deliveryVersion) {
        blockers.push('交付命名使用了 {version}，Agent 或用户必须先明确 deliveryVersion。');
    }
    if (conventionResolution.status !== 'ready'
        || !conventionResolution.convention
        || !projectRoot
        || blockers.length > 0) {
        return {
            status: 'blocked',
            deliveryVersion,
            blockers: Array.from(new Set(blockers))
        };
    }
    return {
        status: 'ready',
        projectRoot,
        convention: conventionResolution.convention,
        deliveryVersion,
        blockers: []
    };
}

export function buildDetailPageDeliveryPlan(input: {
    projectPath: string;
    outputDir?: unknown;
    screens: readonly ParsedScreen[];
    documentName?: string;
    workMode?: unknown;
    exportSlices?: unknown;
    deliveryConvention?: unknown;
    deliveryVersion?: unknown;
    exportQuality?: unknown;
}): DetailPageDeliveryPlanResolution {
    const requestResolution = validateDetailPageDeliveryRequest({
        projectPath: input.projectPath,
        outputDir: input.outputDir,
        deliveryConvention: input.deliveryConvention,
        deliveryVersion: input.deliveryVersion
    });
    if (requestResolution.status !== 'ready'
        || !requestResolution.convention
        || !requestResolution.projectRoot) {
        return {
            status: 'blocked',
            blockers: requestResolution.blockers
        };
    }
    const workMode = cleanText(input.workMode).toLowerCase() || 'create_new';
    const includeEditable = workMode !== 'export_only';
    const includeSlices = workMode === 'export_only'
        || workMode === 'create_new'
        || workMode === 'redesign'
        || workMode === 'template_fill'
        || input.exportSlices === true;
    if (workMode === 'analyze_only') {
        return {
            status: 'blocked',
            blockers: ['analyze_only 不产生文件交付计划。']
        };
    }
    const convention = projectDetailPageConventionForArtifacts({
        convention: requestResolution.convention,
        includeEditable,
        includeSlices
    });
    const blockers: string[] = [];
    const projectRoot = requestResolution.projectRoot;
    if (includeSlices
        && (!Array.isArray(input.screens) || input.screens.length < 2 || input.screens.length > 64)) {
        blockers.push('详情页交付计划必须覆盖当前文档的 2–64 个完整屏。');
    }
    const screenIds = input.screens.map((screen) => String(screen?.id || '').trim());
    if (includeSlices
        && (screenIds.some((screenId) => !screenId)
            || new Set(screenIds).size !== screenIds.length)) {
        blockers.push('详情页屏缺少稳定 id 或存在重复 id。');
    }
    if (includeEditable && !convention.editable) blockers.push('当前模式需要 PSD/PSB 可编辑母稿。');
    if (includeSlices && !convention.raster) blockers.push('当前模式需要完整详情页切片。');
    const version = requestResolution.deliveryVersion;
    if (blockers.length > 0) {
        return { status: 'blocked', convention, blockers: Array.from(new Set(blockers)) };
    }

    const defaultName = basenameWithoutExtension(input.documentName);
    const sharedValues = {
        defaultName,
        name: defaultName,
        kind: 'detail-page',
        version
    };
    let editablePath = '';
    if (convention.editable) {
        const editableRoot = resolveSkillDeliveryProjectPath(
            projectRoot,
            convention.editable.projectRelativeRoot
        );
        const editableFolder = renderFolder(
            editableRoot,
            convention.editable.folderPattern,
            { ...sharedValues, kind: 'editable' }
        );
        const editableName = renderSkillDeliveryPattern(
            convention.editable.fileNamePattern,
            { ...sharedValues, kind: 'editable' }
        );
        const editableFileName = editableName.value
            ? appendExtension(editableName.value, convention.editable.format)
            : { blockers: editableName.blockers };
        blockers.push(...editableFolder.blockers, ...editableFileName.blockers);
        if (editableFolder.value && editableFileName.value) {
            editablePath = joinDeliveryPath(editableFolder.value, editableFileName.value);
        }
    }

    const rasterRoot = convention.raster
        ? resolveSkillDeliveryProjectPath(
            projectRoot,
            convention.raster.projectRelativeRoot
        )
        : '';
    const slicePaths: Array<{
        screenId: string;
        screenIndex: number;
        path: string;
        format: SkillDeliveryRasterFormat;
    }> = [];
    if (includeSlices && convention.raster) input.screens.forEach((screen, index) => {
        const screenName = cleanText(screen.name) || `第${index + 1}屏`;
        const values = {
            ...sharedValues,
            index: index + 1,
            screen: screenName,
            name: screenName,
            kind: 'slice'
        };
        const folder = renderFolder(rasterRoot, convention.raster?.folderPattern, values);
        const name = renderSkillDeliveryPattern(convention.raster!.fileNamePattern, values);
        const fileName = name.value
            ? appendExtension(name.value, convention.raster!.format)
            : { blockers: name.blockers };
        blockers.push(...folder.blockers, ...fileName.blockers);
        if (folder.value && fileName.value) {
            slicePaths.push({
                path: joinDeliveryPath(folder.value, fileName.value),
                format: convention.raster!.format,
                screenId: String(screen.id),
                screenIndex: index + 1
            });
        }
    });
    if (includeSlices && slicePaths.length !== input.screens.length) {
        blockers.push('详情页切片命名没有逐屏完整编译。');
    }
    const artifactPaths = [
        ...(editablePath ? [editablePath] : []),
        ...slicePaths.map((slice) => slice.path)
    ];
    const normalizedPaths = artifactPaths.map(normalizeSkillDeliveryArtifactPath);
    if (new Set(normalizedPaths).size !== normalizedPaths.length) {
        blockers.push('详情页交付约定生成了重复目标文件。');
    }
    if (blockers.length > 0) {
        return { status: 'blocked', convention, blockers: Array.from(new Set(blockers)) };
    }

    const typedPlanResolution = buildSkillDeliveryPlan({
        projectPath: projectRoot,
        convention,
        artifacts: [
            ...(includeEditable && convention.editable ? [{
                artifactId: 'detail-page-master',
                kind: 'editable_document' as const,
                pairId: 'detail-page-set',
                order: 0,
                path: editablePath,
                format: convention.editable.format,
                sourceHistoryRole: 'same_document_revision' as const
            }] : []),
            ...slicePaths.map((slice, index) => ({
                artifactId: `detail-page-screen-${slice.screenId}`,
                kind: 'raster_export' as const,
                pairId: 'detail-page-set',
                order: index + (includeEditable ? 1 : 0),
                path: slice.path,
                format: slice.format,
                sourceHistoryRole: 'same_document_revision' as const
            }))
        ]
    });
    if (typedPlanResolution.status !== 'ready' || !typedPlanResolution.plan) {
        return {
            status: 'blocked',
            convention,
            blockers: typedPlanResolution.blockers
        };
    }
    const typedPlan = typedPlanResolution.plan;
    const deliveryPlanDigest = typedPlan.digest;
    const editable = typedPlan.artifacts.find((artifact) => artifact.kind === 'editable_document');
    const slices = typedPlan.artifacts
        .filter((artifact) => artifact.kind === 'raster_export')
        .map((artifact, index) => ({
            ...artifact,
            screenId: slicePaths[index].screenId,
            screenIndex: slicePaths[index].screenIndex
        }));
    const rasterFormat: 'jpeg' | 'png' = convention.raster?.format === 'png'
        ? 'png'
        : 'jpeg';
    const quality = Number(input.exportQuality);
    const saveDocument = editable ? {
        format: editable.format as 'psd' | 'psb',
        path: editable.path,
        saveAs: true as const,
        conflictPolicy: 'fail_if_exists' as const
    } : undefined;
    const exportDetailPageSlices = includeSlices ? {
        screens: input.screens.map((screen) => ({ ...screen })),
        config: {
            projectRoot,
            outputDir: rasterRoot,
            format: rasterFormat,
            quality: Number.isFinite(quality)
                ? Math.max(1, Math.min(12, Math.round(quality)))
                : 10,
            namingPattern: '{index}_{name}' as const,
            createSubfolder: false as const,
            subfolder: 'detail-page-slices' as const,
            conflictPolicy: convention.versionPolicy as 'fail_if_exists' | 'new_version',
            deliveryPlanDigest,
            typedPlan,
            expectedFiles: slices.map((slice) => ({
                screenId: slice.screenId!,
                path: slice.path
            }))
        }
    } : undefined;
    const workflowCommitParams: DetailPageDeliveryPlan['workflowCommit']['params'] = {
        deliveryAction: 'commit',
        projectPath: projectRoot,
        exportSlices: includeSlices,
        exportQuality: exportDetailPageSlices?.config.quality || 10,
        ...(workMode ? { workMode } : {}),
        ...(cleanText(input.outputDir) ? { outputDir: cleanText(input.outputDir) } : {}),
        ...(version ? { deliveryVersion: version } : {}),
        ...(input.deliveryConvention !== undefined ? { deliveryConvention: convention } : {})
    };
    const toolArgumentConstraints: DetailPageDeliveryPlan['toolArgumentConstraints'] = {
        'detail-page-design': {
            argumentsDigest: buildAgentReActToolArgumentsDigest(workflowCommitParams)
        },
        ...(exportDetailPageSlices ? {
            exportDetailPageSlices: {
                argumentsDigest: buildAgentReActToolArgumentsDigest(exportDetailPageSlices)
            }
        } : {}),
        ...(saveDocument ? {
            saveDocument: {
                argumentsDigest: buildAgentReActToolArgumentsDigest(saveDocument)
            }
        } : {})
    };
    return {
        status: 'ready',
        convention,
        plan: {
            version: DETAIL_PAGE_DELIVERY_PLAN_VERSION,
            typedPlan,
            convention,
            deliveryPlanDigest,
            projectRoot,
            artifacts: typedPlan.artifacts,
            ...(editable ? { editable } : {}),
            slices,
            workflowCommit: {
                toolName: 'detail-page-design',
                params: workflowCommitParams
            },
            toolCalls: {
                ...(saveDocument ? { saveDocument } : {}),
                ...(exportDetailPageSlices ? { exportDetailPageSlices } : {})
            },
            toolArgumentConstraints,
            boundaries: {
                projectBound: true,
                overwriteForbidden: true,
                exactScreenSet: true,
                conventionContainsNoVisualDecisions: true,
                compatibilityOutputDirDoesNotClaimUserAuthority: true
            }
        },
        blockers: []
    };
}
