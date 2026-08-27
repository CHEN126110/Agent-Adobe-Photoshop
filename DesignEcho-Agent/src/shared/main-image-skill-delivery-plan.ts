/**
 * Main-image Skill delivery compiler.
 *
 * The Agent/user owns the selected convention. This compiler only turns that
 * convention and the already-selected production structure into exact project
 * artifact paths. It never chooses assets, layout, copy, color, or aesthetics.
 */

import { MAIN_IMAGE_DELIVERY_DOCUMENTS } from './main-image-design-core';
import type {
    MainImageProductionDocumentPlan,
    MainImageProductionDocumentStructure,
    MainImageProductionExportSpec
} from './main-image-production-document-structure';
import {
    buildSkillDeliveryPlan,
    normalizeSkillDeliveryArtifactPath,
    renderSkillDeliveryPattern,
    resolveSkillDeliveryConvention,
    resolveSkillDeliveryProjectPath,
    SKILL_DELIVERY_CONVENTION_VERSION,
    type SkillDeliveryConvention,
    type SkillDeliveryEditableFormat,
    type SkillDeliveryPatternValues,
    type SkillDeliveryPlan,
    type SkillDeliveryPlanArtifact,
    type SkillDeliveryRasterFormat
} from './skills/skill-delivery-convention';

export const MAIN_IMAGE_SKILL_DELIVERY_PLAN_VERSION = 'main-image-skill-delivery-plan/v0' as const;

export type MainImageSkillDeliveryPlanStatus =
    | 'ready'
    | 'blocked_invalid_convention'
    | 'blocked_missing_project'
    | 'blocked_missing_production_structure'
    | 'blocked_unsupported_pairing'
    | 'blocked_invalid_artifact_plan';

export type MainImageSkillDeliveryArtifact =
    | MainImageSkillRasterArtifact
    | MainImageSkillEditableArtifact;

interface MainImageSkillDeliveryArtifactBase extends SkillDeliveryPlanArtifact {
    documentId: string;
    documentName: string;
    sizeKey: string;
}

export interface MainImageSkillRasterArtifact extends MainImageSkillDeliveryArtifactBase {
    kind: 'raster_export';
    format: SkillDeliveryRasterFormat;
    exportSpecId: string;
    imageType: 'click' | 'conversion';
}

export interface MainImageSkillEditableArtifact extends MainImageSkillDeliveryArtifactBase {
    kind: 'editable_document';
    format: 'psd' | 'psb';
}

export interface MainImageSkillDeliveryDocumentPlan {
    documentId: string;
    documentName: string;
    sizeKey: string;
    editableArtifactId: string;
    rasterArtifactIds: string[];
}

export interface MainImageSkillDeliveryPlan {
    version: typeof MAIN_IMAGE_SKILL_DELIVERY_PLAN_VERSION;
    skillId: 'main-image-design';
    status: MainImageSkillDeliveryPlanStatus;
    projectPath: string;
    convention?: SkillDeliveryConvention;
    typedPlan?: SkillDeliveryPlan;
    deliveryPlanDigest?: string;
    documents: MainImageSkillDeliveryDocumentPlan[];
    artifacts: MainImageSkillDeliveryArtifact[];
    blockers: string[];
    warnings: string[];
    boundaries: {
        conventionSelectedByAgentOrUser: true;
        compilesOrganizationOnly: true;
        noVisualDecision: true;
        noFilesystemRead: true;
        noPhotoshopWrite: true;
    };
}

export interface BuildMainImageSkillDeliveryPlanInput {
    projectPath?: string | null;
    deliveryConvention?: unknown;
    deliveryVersion?: string | null;
    productionDocumentStructure?: MainImageProductionDocumentStructure | null;
}

const SUPPORTED_EDITABLE_FORMATS = new Set<SkillDeliveryEditableFormat>(['psd', 'psb']);
const SUPPORTED_RASTER_FORMATS = new Set<SkillDeliveryRasterFormat>(['jpg', 'jpeg', 'png']);
const KNOWN_DELIVERY_EXTENSIONS = /\.(?:psd|psb|tiff?|png|jpe?g)$/i;

function cleanString(value: unknown): string {
    return String(value || '').trim();
}

function fallbackMainImageDeliveryConvention(): SkillDeliveryConvention {
    return {
        version: SKILL_DELIVERY_CONVENTION_VERSION,
        provenance: 'skill_fallback',
        supportRefs: [],
        editable: {
            projectRelativeRoot: '主图/源文件',
            folderPattern: '{size}',
            fileNamePattern: '主图源稿',
            format: 'psb'
        },
        raster: {
            projectRelativeRoot: '主图',
            folderPattern: '{size}',
            fileNamePattern: '{kind}-{index}',
            format: 'jpg'
        },
        pairing: 'one_master_many_rasters',
        versionPolicy: 'fail_if_exists'
    };
}

function makePlan(input: {
    status: MainImageSkillDeliveryPlanStatus;
    projectPath?: string;
    convention?: SkillDeliveryConvention;
    documents?: MainImageSkillDeliveryDocumentPlan[];
    artifacts?: MainImageSkillDeliveryArtifact[];
    blockers?: string[];
    warnings?: string[];
}): MainImageSkillDeliveryPlan {
    const artifacts = input.artifacts || [];
    const typedPlanResolution = input.convention && artifacts.length > 0 && input.projectPath
        ? buildSkillDeliveryPlan({
            projectPath: input.projectPath,
            convention: input.convention,
            artifacts
        })
        : undefined;
    const typedPlan = typedPlanResolution?.status === 'ready'
        ? typedPlanResolution.plan
        : undefined;
    const deliveryPlanDigest = typedPlan?.digest;
    const typedPlanBlockers = typedPlanResolution?.status === 'blocked'
        ? typedPlanResolution.blockers
        : [];
    const status = input.status === 'ready' && typedPlanBlockers.length > 0
        ? 'blocked_invalid_artifact_plan'
        : input.status;
    return {
        version: MAIN_IMAGE_SKILL_DELIVERY_PLAN_VERSION,
        skillId: 'main-image-design',
        status,
        projectPath: cleanString(input.projectPath),
        convention: input.convention,
        typedPlan,
        deliveryPlanDigest,
        documents: input.documents || [],
        artifacts,
        blockers: Array.from(new Set([
            ...(input.blockers || []),
            ...typedPlanBlockers
        ].map(cleanString).filter(Boolean))),
        warnings: Array.from(new Set((input.warnings || []).map(cleanString).filter(Boolean))),
        boundaries: {
            conventionSelectedByAgentOrUser: true,
            compilesOrganizationOnly: true,
            noVisualDecision: true,
            noFilesystemRead: true,
            noPhotoshopWrite: true
        }
    };
}

function looksLikeAbsoluteProjectPath(value: string): boolean {
    return /^(?:[a-z]:[\\/]|\\\\[^\\]+[\\][^\\]+|\/)/i.test(value);
}

function isPathInsideProject(projectPath: string, artifactPath: string): boolean {
    const projectKey = normalizeSkillDeliveryArtifactPath(projectPath).replace(/\/+$/g, '');
    const artifactKey = normalizeSkillDeliveryArtifactPath(artifactPath);
    return Boolean(projectKey && artifactKey.startsWith(`${projectKey}/`));
}

function sizeKeyForDocument(document: MainImageProductionDocumentPlan): string {
    const deliveryDocument = MAIN_IMAGE_DELIVERY_DOCUMENTS.find((candidate) => (
        candidate.ratio === document.ratio
        || candidate.canvasSize.width === document.canvasSize.width
        && candidate.canvasSize.height === document.canvasSize.height
    ));
    return deliveryDocument?.folderKey
        || `${document.exportSize.width}x${document.exportSize.height}`;
}

function renderName(input: {
    pattern: string;
    values: SkillDeliveryPatternValues;
    label: string;
    blockers: string[];
}): string {
    const rendered = renderSkillDeliveryPattern(input.pattern, input.values);
    if (rendered.status === 'ready' && rendered.value) return rendered.value;
    input.blockers.push(`${input.label}无法生成安全名称：${rendered.blockers.join('；')}`);
    return '';
}

function appendFormatExtension(input: {
    renderedName: string;
    format: SkillDeliveryEditableFormat | SkillDeliveryRasterFormat;
    label: string;
    blockers: string[];
}): string {
    const extension = input.format === 'jpeg' ? 'jpeg' : input.format;
    if (new RegExp(`\\.${extension}$`, 'i').test(input.renderedName)) return input.renderedName;
    if (KNOWN_DELIVERY_EXTENSIONS.test(input.renderedName)) {
        input.blockers.push(`${input.label}的文件扩展名与 format=${input.format} 不一致。`);
        return '';
    }
    return `${input.renderedName}.${extension}`;
}

function targetUsesVersion(target: {
    folderPattern?: string;
    fileNamePattern: string;
}): boolean {
    return /\{version\}/.test(target.folderPattern || '') || /\{version\}/.test(target.fileNamePattern);
}

function buildArtifactPath(input: {
    projectPath: string;
    projectRelativeRoot: string;
    folderPattern?: string;
    fileNamePattern: string;
    format: SkillDeliveryEditableFormat | SkillDeliveryRasterFormat;
    values: SkillDeliveryPatternValues;
    label: string;
    blockers: string[];
}): string {
    const folder = input.folderPattern
        ? renderName({
            pattern: input.folderPattern,
            values: input.values,
            label: `${input.label}文件夹`,
            blockers: input.blockers
        })
        : '';
    const renderedName = renderName({
        pattern: input.fileNamePattern,
        values: input.values,
        label: `${input.label}文件名`,
        blockers: input.blockers
    });
    const fileName = appendFormatExtension({
        renderedName,
        format: input.format,
        label: input.label,
        blockers: input.blockers
    });
    if (!fileName) return '';
    const relativePath = [input.projectRelativeRoot, folder, fileName].filter(Boolean).join('/');
    const artifactPath = resolveSkillDeliveryProjectPath(input.projectPath, relativePath);
    if (!isPathInsideProject(input.projectPath, artifactPath)) {
        input.blockers.push(`${input.label}超出当前项目目录。`);
        return '';
    }
    return artifactPath;
}

function resolveConvention(value: unknown): {
    convention?: SkillDeliveryConvention;
    blockers: string[];
} {
    if (value === undefined || value === null) {
        return { convention: fallbackMainImageDeliveryConvention(), blockers: [] };
    }
    const resolution = resolveSkillDeliveryConvention(value);
    if (resolution.status !== 'ready' || !resolution.convention) {
        return { blockers: resolution.blockers };
    }
    return { convention: resolution.convention, blockers: [] };
}

function exportSpecsForDocument(
    structure: MainImageProductionDocumentStructure,
    documentId: string
): MainImageProductionExportSpec[] {
    return structure.exportSpecs.filter((spec) => spec.documentId === documentId);
}

function buildRasterValues(input: {
    document: MainImageProductionDocumentPlan;
    exportSpec: MainImageProductionExportSpec;
    sizeKey: string;
    index: number;
    version: string;
}): SkillDeliveryPatternValues {
    const kind = input.exportSpec.imageType === 'click' ? '点击图' : '转化图';
    return {
        defaultName: `${kind}-${input.index}`,
        index: input.index,
        row: input.index,
        size: input.sizeKey,
        kind,
        name: input.exportSpec.groupPath[1] || `${kind}-${input.index}`,
        version: input.version,
        screen: kind
    };
}

function buildEditableValues(input: {
    document: MainImageProductionDocumentPlan;
    sizeKey: string;
    index: number;
    version: string;
}): SkillDeliveryPatternValues {
    return {
        defaultName: '主图源稿',
        index: input.index,
        size: input.sizeKey,
        kind: '源稿',
        name: input.document.name,
        version: input.version,
        screen: '源稿'
    };
}

export function buildMainImageSkillDeliveryPlan(
    input: BuildMainImageSkillDeliveryPlanInput
): MainImageSkillDeliveryPlan {
    const projectPath = cleanString(input.projectPath);
    const resolved = resolveConvention(input.deliveryConvention);
    if (!resolved.convention) {
        return makePlan({
            status: 'blocked_invalid_convention',
            projectPath,
            blockers: resolved.blockers
        });
    }
    const convention = resolved.convention;
    const blockers: string[] = [];
    const warnings: string[] = [];
    if (!projectPath || !looksLikeAbsoluteProjectPath(projectPath)) {
        return makePlan({
            status: 'blocked_missing_project',
            projectPath,
            convention,
            blockers: ['主图精确交付计划需要当前项目的绝对路径。']
        });
    }
    const structure = input.productionDocumentStructure;
    if (!structure || structure.status !== 'ready_production_document_structure') {
        return makePlan({
            status: 'blocked_missing_production_structure',
            projectPath,
            convention,
            blockers: ['主图精确交付计划需要已确定的生产文档与导出组结构。']
        });
    }
    if (!convention.editable || !convention.raster) {
        blockers.push('主图完整交付必须同时声明可编辑稿与 raster 导出图。');
    }
    if (convention.editable && !SUPPORTED_EDITABLE_FORMATS.has(convention.editable.format)) {
        blockers.push('当前主图 live runner 只能验真 PSD/PSB 可编辑稿。');
    }
    if (convention.raster && !SUPPORTED_RASTER_FORMATS.has(convention.raster.format)) {
        blockers.push('当前主图 live runner 只支持 JPG/JPEG/PNG 导出。');
    }
    const deliveryVersion = cleanString(input.deliveryVersion);
    if (convention.versionPolicy === 'new_version') {
        if (!deliveryVersion) {
            blockers.push('new_version 需要 Agent 或用户显式给出 deliveryVersion。');
        }
        if (convention.editable && !targetUsesVersion(convention.editable)) {
            blockers.push('new_version 的 editable 文件夹或文件名必须使用 {version}。');
        }
        if (convention.raster && !targetUsesVersion(convention.raster)) {
            blockers.push('new_version 的 raster 文件夹或文件名必须使用 {version}。');
        }
    }
    if (blockers.length > 0 || !convention.editable || !convention.raster) {
        return makePlan({
            status: 'blocked_invalid_convention',
            projectPath,
            convention,
            blockers
        });
    }

    const artifacts: MainImageSkillDeliveryArtifact[] = [];
    const documents: MainImageSkillDeliveryDocumentPlan[] = [];
    const pathKeys = new Set<string>();
    let artifactOrder = 0;
    for (const [documentIndex, document] of structure.documents.entries()) {
        const sizeKey = sizeKeyForDocument(document);
        const exportSpecs = exportSpecsForDocument(structure, document.id);
        if (exportSpecs.length === 0) {
            blockers.push(`${sizeKey} 主图文档没有已确定的导出组。`);
            continue;
        }
        if (convention.pairing === 'one_editable_per_raster' && exportSpecs.length !== 1) {
            blockers.push(
                `${sizeKey} 主图文档包含 ${exportSpecs.length} 个 raster，当前 runner 不能把它们伪装成逐图可编辑稿。`
            );
            continue;
        }

        const editableArtifactId = `editable:${document.id}`;
        const editablePath = buildArtifactPath({
            projectPath,
            projectRelativeRoot: convention.editable.projectRelativeRoot,
            folderPattern: convention.editable.folderPattern,
            fileNamePattern: convention.editable.fileNamePattern,
            format: convention.editable.format,
            values: buildEditableValues({
                document,
                sizeKey,
                index: documentIndex + 1,
                version: deliveryVersion
            }),
            label: `${sizeKey} 可编辑稿`,
            blockers
        });
        const rasterArtifactIds: string[] = [];
        exportSpecs.forEach((exportSpec, exportIndex) => {
            const artifactId = `raster:${exportSpec.id}`;
            const path = buildArtifactPath({
                projectPath,
                projectRelativeRoot: convention.raster!.projectRelativeRoot,
                folderPattern: convention.raster!.folderPattern,
                fileNamePattern: convention.raster!.fileNamePattern,
                format: convention.raster!.format,
                values: buildRasterValues({
                    document,
                    exportSpec,
                    sizeKey,
                    index: exportIndex + 1,
                    version: deliveryVersion
                }),
                label: `${sizeKey} 第 ${exportIndex + 1} 张导出图`,
                blockers
            });
            if (!path) return;
            const pathKey = normalizeSkillDeliveryArtifactPath(path);
            if (pathKeys.has(pathKey)) {
                blockers.push(`主图精确交付计划出现重复路径：${path}`);
                return;
            }
            pathKeys.add(pathKey);
            rasterArtifactIds.push(artifactId);
            artifacts.push({
                artifactId,
                kind: 'raster_export',
                pairId: convention.pairing === 'one_editable_per_raster'
                    ? `pair:${exportSpec.id}`
                    : `pair:${document.id}`,
                documentId: document.id,
                documentName: document.name,
                sizeKey,
                path,
                format: convention.raster!.format,
                order: artifactOrder++,
                sourceHistoryRole: 'same_document_revision',
                exportSpecId: exportSpec.id,
                imageType: exportSpec.imageType
            });
        });
        if (editablePath) {
            const editablePathKey = normalizeSkillDeliveryArtifactPath(editablePath);
            if (pathKeys.has(editablePathKey)) {
                blockers.push(`主图精确交付计划出现重复路径：${editablePath}`);
            } else {
                pathKeys.add(editablePathKey);
                artifacts.push({
                    artifactId: editableArtifactId,
                    kind: 'editable_document',
                    pairId: convention.pairing === 'one_editable_per_raster'
                        ? `pair:${exportSpecs[0].id}`
                        : `pair:${document.id}`,
                    documentId: document.id,
                    documentName: document.name,
                    sizeKey,
                    path: editablePath,
                    format: convention.editable.format as 'psd' | 'psb',
                    order: artifactOrder++,
                    sourceHistoryRole: 'same_document_revision'
                });
            }
        }
        documents.push({
            documentId: document.id,
            documentName: document.name,
            sizeKey,
            editableArtifactId,
            rasterArtifactIds
        });
    }

    const expectedArtifactCount = structure.exportSpecs.length + structure.documents.length;
    if (artifacts.length !== expectedArtifactCount) {
        blockers.push(`主图精确交付计划应有 ${expectedArtifactCount} 个文件，实际只生成 ${artifacts.length} 个。`);
    }
    if (convention.versionPolicy === 'replace_exact_set') {
        blockers.push('主图 Skill 不允许 replace_exact_set；所有可编辑稿和导出图都必须在同名目标存在时停止。');
    }
    if (blockers.length > 0) {
        return makePlan({
            status: convention.pairing === 'one_editable_per_raster'
                ? 'blocked_unsupported_pairing'
                : 'blocked_invalid_artifact_plan',
            projectPath,
            convention,
            documents,
            artifacts,
            blockers,
            warnings
        });
    }
    return makePlan({
        status: 'ready',
        projectPath,
        convention,
        documents,
        artifacts,
        warnings
    });
}
