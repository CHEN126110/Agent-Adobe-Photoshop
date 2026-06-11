import type {
    MainImageProjectStyleStrategyEvidence,
    MainImageVariantDirection
} from './main-image-project-style-strategy';
import { MAIN_IMAGE_DELIVERY_DOCUMENTS } from './main-image-design-core';

export type MainImagePlatformSizeProfileStatus =
    | 'ready_platform_size_profile'
    | 'ready_platform_size_profile_with_pending_confirmation'
    | 'blocked_missing_platform';

export type MainImageProductionDocumentStructureStatus =
    | 'blocked_missing_platform_size_profile'
    | 'blocked_missing_project_style_strategy'
    | 'blocked_missing_visual_grounding'
    | 'blocked_missing_variant_plan'
    | 'ready_production_document_structure';

export type MainImageSizeEvidenceLevel =
    | 'platform_developer_doc'
    | 'public_reference'
    | 'user_project_rule'
    | 'project_preference_pending_confirmation';

export interface MainImageSize {
    width: number;
    height: number;
}

export interface MainImageProjectPreferenceThirdRatio {
    id?: string;
    ratio: string;
    designSize: MainImageSize;
    exportSize: MainImageSize;
    label?: string;
    reason?: string;
}

export interface MainImagePlatformSizeProfileInput {
    platform?: string;
    productCategory?: string;
    includeProjectPreferenceThirdRatio?: boolean;
    projectPreferenceThirdRatio?: MainImageProjectPreferenceThirdRatio | null;
}

export interface MainImageSizeProfileEntry {
    id: string;
    ratio: string;
    label: string;
    designSize: MainImageSize;
    exportSize: MainImageSize;
    evidenceLevel: MainImageSizeEvidenceLevel;
    evidenceSummary: string;
    officialClaimAllowed: boolean;
    intendedUse: string;
    warnings: string[];
}

export interface MainImagePlatformSizeProfileEvidence {
    version: 'main-image-production-document-structure/v0';
    skillId: 'main-image-design';
    scene: 'ecommerce-socks';
    status: MainImagePlatformSizeProfileStatus;
    platform: string;
    productCategory: string;
    sizeProfiles: MainImageSizeProfileEntry[];
    officiallyConfirmedRatioCount: number;
    canClaimOfficialThirdRatio: false;
    canClaimOutputQuality: false;
    canClaimDesignComplete: false;
    noPhotoshopWrites: true;
    mustNotExecutePhotoshop: true;
    blockers: string[];
    warnings: string[];
    limitations: string[];
    evidence: Array<{
        source: string;
        summary: string;
        status: 'ready' | 'needs_review' | 'unknown' | 'failed';
    }>;
}

export interface MainImageProductionChildGroup {
    id: string;
    name: string;
    variantId: string;
    objective: string;
    imageType: 'click' | 'conversion';
    exportRole: 'click-image' | 'conversion-image';
    requiredEvidence: string[];
}

export interface MainImageProductionParentGroup {
    name: '点击图' | '转化图';
    role: 'click-images' | 'conversion-images';
    childGroups: MainImageProductionChildGroup[];
}

export interface MainImageProductionDocumentPlan {
    id: string;
    name: string;
    platform: string;
    ratio: string;
    canvasSize: MainImageSize;
    exportSize: MainImageSize;
    sizeProfileId: string;
    evidenceLevel: MainImageSizeEvidenceLevel;
    parentGroups: [MainImageProductionParentGroup, MainImageProductionParentGroup];
}

export interface MainImageProductionExportSpec {
    id: string;
    documentId: string;
    documentName: string;
    groupPath: [string, string];
    exportSize: MainImageSize;
    fileName: string;
    imageType: 'click' | 'conversion';
    qualityBoundary: string;
}

export interface MainImageProductionDocumentStructureInput {
    platformSizeProfileEvidence?: MainImagePlatformSizeProfileEvidence | null;
    projectStyleStrategyEvidence?: MainImageProjectStyleStrategyEvidence | null;
}

export interface MainImageProductionDocumentStructureEvidence {
    version: 'main-image-production-document-structure/v0';
    skillId: 'main-image-design';
    scene: 'ecommerce-socks';
    status: MainImageProductionDocumentStructureStatus;
    platform: string;
    documents: MainImageProductionDocumentPlan[];
    exportSpecs: MainImageProductionExportSpec[];
    verificationPolicy: {
        requiredBeforePhotoshopExecution: string[];
        requiredAfterPhotoshopExecution: string[];
        qualityClaimBoundary: string;
    };
    canClaimOutputQuality: false;
    canClaimDesignComplete: false;
    noPhotoshopWrites: true;
    mustNotExecutePhotoshop: true;
    blockers: string[];
    warnings: string[];
    limitations: string[];
    evidence: Array<{
        source: string;
        summary: string;
        status: 'ready' | 'needs_review' | 'unknown' | 'failed';
    }>;
}

const FORBIDDEN_PAYLOAD_PATTERNS = [
    /raw-image-payload/gi,
    /base64-image-payload/gi,
    /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi,
    /data:image\//gi
];

function cleanString(value: unknown): string {
    let text = String(value || '').trim();
    for (const pattern of FORBIDDEN_PAYLOAD_PATTERNS) {
        text = text.replace(pattern, '[redacted-image-payload]');
    }
    return text.replace(/\s+/g, ' ').trim();
}

function toPositiveInteger(value: unknown): number | undefined {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
    return Math.round(numeric);
}

function normalizeSize(size: MainImageSize | undefined): MainImageSize | undefined {
    const width = toPositiveInteger(size?.width);
    const height = toPositiveInteger(size?.height);
    if (!width || !height) return undefined;
    return { width, height };
}

function makeProfileEntry(input: {
    id: string;
    ratio: string;
    label: string;
    designSize: MainImageSize;
    exportSize: MainImageSize;
    evidenceLevel: MainImageSizeEvidenceLevel;
    evidenceSummary: string;
    officialClaimAllowed: boolean;
    intendedUse: string;
    warnings?: string[];
}): MainImageSizeProfileEntry {
    return {
        id: cleanString(input.id),
        ratio: cleanString(input.ratio),
        label: cleanString(input.label),
        designSize: input.designSize,
        exportSize: input.exportSize,
        evidenceLevel: input.evidenceLevel,
        evidenceSummary: cleanString(input.evidenceSummary),
        officialClaimAllowed: input.officialClaimAllowed,
        intendedUse: cleanString(input.intendedUse),
        warnings: (input.warnings || []).map(cleanString).filter(Boolean)
    };
}

function buildBaseTmallProfiles(): MainImageSizeProfileEntry[] {
    return MAIN_IMAGE_DELIVERY_DOCUMENTS.map((document) => makeProfileEntry({
        id: `tmall-${document.folderKey}-main-image`,
        ratio: document.ratio,
        label: `天猫 ${document.ratio} 主图（${document.folderKey}）`,
        designSize: document.canvasSize,
        exportSize: document.canvasSize,
        evidenceLevel: document.folderKey === '1200' ? 'user_project_rule' : 'platform_developer_doc',
        evidenceSummary: document.folderKey === '1200'
            ? '用户项目规范：1200 文件夹对应 9:16 主图文档，宽 1440，且不包含转化图。'
            : `淘宝/天猫主图生产规范：${document.folderKey} 文件夹对应 ${document.ratio} 主图文档，内部工作宽度 1440。`,
        officialClaimAllowed: document.folderKey !== '1200',
        intendedUse: document.contentPolicy
    }));
}

function buildProjectPreferenceThirdProfile(
    input: MainImagePlatformSizeProfileInput
): MainImageSizeProfileEntry | undefined {
    if (input.includeProjectPreferenceThirdRatio !== true) return undefined;
    const preference = input.projectPreferenceThirdRatio;
    const designSize = normalizeSize(preference?.designSize);
    const exportSize = normalizeSize(preference?.exportSize);
    const ratio = cleanString(preference?.ratio);
    if (!preference || !designSize || !exportSize || !ratio) return undefined;
    return makeProfileEntry({
        id: cleanString(preference.id) || `project-preference-${ratio.replace(/[^0-9a-z]+/gi, '-')}`,
        ratio,
        label: cleanString(preference.label) || '项目偏好第三比例',
        designSize,
        exportSize,
        evidenceLevel: 'project_preference_pending_confirmation',
        evidenceSummary: cleanString(preference.reason) || '第三比例来自项目生产偏好，需后续用平台后台或用户规范确认。',
        officialClaimAllowed: false,
        intendedUse: '项目内部生产和导出候选，未确认前不得声明为平台官方强制规格',
        warnings: ['第三比例不是已确认官方规范，必须保持可配置。']
    });
}

function buildProfileWarnings(sizeProfiles: MainImageSizeProfileEntry[]): string[] {
    const warnings: string[] = [];
    if (sizeProfiles.some((item) => item.evidenceLevel === 'project_preference_pending_confirmation')) {
        warnings.push('第三比例来自项目偏好或待确认资料，不能宣称为天猫官方已确认规格。');
    }
    if (sizeProfiles.length < 3) {
        warnings.push('当前 profile 未包含用户期望的三规格主图；后续应由项目配置或后台规范补齐。');
    }
    return warnings;
}

export function buildMainImagePlatformSizeProfileEvidence(
    input: MainImagePlatformSizeProfileInput = {}
): MainImagePlatformSizeProfileEvidence {
    const platform = cleanString(input.platform) || 'tmall';
    const productCategory = cleanString(input.productCategory) || 'socks';
    if (platform !== 'tmall') {
        return {
            version: 'main-image-production-document-structure/v0',
            skillId: 'main-image-design',
            scene: 'ecommerce-socks',
            status: 'blocked_missing_platform',
            platform,
            productCategory,
            sizeProfiles: [],
            officiallyConfirmedRatioCount: 0,
            canClaimOfficialThirdRatio: false,
            canClaimOutputQuality: false,
            canClaimDesignComplete: false,
            noPhotoshopWrites: true,
            mustNotExecutePhotoshop: true,
            blockers: ['unsupported_main_image_platform_profile'],
            warnings: [],
            limitations: ['当前只收口天猫主图 profile；其他平台需要单独证据。'],
            evidence: [{
                source: 'main-image-platform-size-profile',
                summary: `unsupported platform=${platform || 'unknown'}`,
                status: 'failed'
            }]
        };
    }

    const sizeProfiles = buildBaseTmallProfiles();
    const thirdProfile = buildProjectPreferenceThirdProfile(input);
    if (thirdProfile) sizeProfiles.push(thirdProfile);
    const warnings = buildProfileWarnings(sizeProfiles);
    const status: MainImagePlatformSizeProfileStatus = warnings.length > 0
        ? 'ready_platform_size_profile_with_pending_confirmation'
        : 'ready_platform_size_profile';

    return {
        version: 'main-image-production-document-structure/v0',
        skillId: 'main-image-design',
        scene: 'ecommerce-socks',
        status,
        platform,
        productCategory,
        sizeProfiles,
        officiallyConfirmedRatioCount: sizeProfiles.filter((item) => item.officialClaimAllowed).length,
        canClaimOfficialThirdRatio: false,
        canClaimOutputQuality: false,
        canClaimDesignComplete: false,
        noPhotoshopWrites: true,
        mustNotExecutePhotoshop: true,
        blockers: [],
        warnings,
        limitations: [
            'profile 是尺寸和导出计划 evidence，不创建文档、不创建组、不导出文件。',
            '设计源尺寸是内部工作尺寸；平台上传约束仍需要按后台实时校验。',
            '1200/9:16 来自当前项目生产规范，不能在没有后台证据时宣称为平台官方强制规格。'
        ],
        evidence: [{
            source: 'main-image-platform-size-profile',
            summary: `platform=${platform}; profiles=${sizeProfiles.map((item) => item.ratio).join('/')}; confirmed=${sizeProfiles.filter((item) => item.officialClaimAllowed).length}`,
            status: 'ready'
        }]
    };
}

function getStyleVariants(
    styleEvidence: MainImageProjectStyleStrategyEvidence
): {
    clickImages: MainImageVariantDirection[];
    conversionImages: MainImageVariantDirection[];
} {
    return {
        clickImages: styleEvidence.variantPlan.clickImages || [],
        conversionImages: styleEvidence.variantPlan.conversionImages || []
    };
}

function makeSafeName(value: unknown): string {
    return cleanString(value).replace(/[\\/:*?"<>|]+/g, '').slice(0, 36);
}

function makeChildGroup(
    profile: MainImageSizeProfileEntry,
    variant: MainImageVariantDirection,
    index: number
): MainImageProductionChildGroup {
    const typeLabel = variant.imageType === 'click' ? '点击图' : '转化图';
    const objective = cleanString(variant.objective) || `${typeLabel} ${index + 1}`;
    return {
        id: `${profile.id}-${variant.imageType}-${index + 1}`,
        name: `${typeLabel}-${index + 1}-${makeSafeName(objective) || '方案'}`,
        variantId: cleanString(variant.id) || `${variant.imageType}-${index + 1}`,
        objective,
        imageType: variant.imageType,
        exportRole: variant.imageType === 'click' ? 'click-image' : 'conversion-image',
        requiredEvidence: [
            ...variant.requiredEvidence,
            'production_group_created',
            'post_export_file_exists',
            'post_export_screenshot_or_probe'
        ].map(cleanString).filter(Boolean)
    };
}

function buildParentGroups(
    profile: MainImageSizeProfileEntry,
    styleEvidence: MainImageProjectStyleStrategyEvidence
): [MainImageProductionParentGroup, MainImageProductionParentGroup] {
    const variants = getStyleVariants(styleEvidence);
    const deliverySpec = MAIN_IMAGE_DELIVERY_DOCUMENTS.find((item) => item.ratio === profile.ratio);
    const allowConversion = !deliverySpec || deliverySpec.includedImageTypes.includes('conversion');
    return [
        {
            name: '点击图',
            role: 'click-images',
            childGroups: variants.clickImages.map((variant, index) => makeChildGroup(profile, variant, index))
        },
        {
            name: '转化图',
            role: 'conversion-images',
            childGroups: allowConversion
                ? variants.conversionImages.map((variant, index) => makeChildGroup(profile, variant, index))
                : []
        }
    ];
}

function buildDocumentPlan(
    platform: string,
    profile: MainImageSizeProfileEntry,
    styleEvidence: MainImageProjectStyleStrategyEvidence
): MainImageProductionDocumentPlan {
    return {
        id: `main-image-document-${profile.id}`,
        name: `${platform}-${profile.ratio}-${profile.label}`,
        platform,
        ratio: profile.ratio,
        canvasSize: profile.designSize,
        exportSize: profile.exportSize,
        sizeProfileId: profile.id,
        evidenceLevel: profile.evidenceLevel,
        parentGroups: buildParentGroups(profile, styleEvidence)
    };
}

function buildExportSpecs(documents: MainImageProductionDocumentPlan[]): MainImageProductionExportSpec[] {
    const specs: MainImageProductionExportSpec[] = [];
    for (const document of documents) {
        for (const parentGroup of document.parentGroups) {
            parentGroup.childGroups.forEach((childGroup, index) => {
                specs.push({
                    id: `${document.id}-${childGroup.id}-export`,
                    documentId: document.id,
                    documentName: document.name,
                    groupPath: [parentGroup.name, childGroup.name],
                    exportSize: document.exportSize,
                    fileName: `${makeSafeName(document.name)}-${parentGroup.name}-${index + 1}.jpg`,
                    imageType: childGroup.imageType,
                    qualityBoundary: '导出规格只指向可导出的组；必须在 Photoshop 执行后读取文件、截图或像素 probe 才能验收。'
                });
            });
        }
    }
    return specs;
}

function makeBlockedProductionEvidence(input: {
    status: MainImageProductionDocumentStructureStatus;
    platform: string;
    blocker: string;
    warning?: string;
}): MainImageProductionDocumentStructureEvidence {
    return {
        version: 'main-image-production-document-structure/v0',
        skillId: 'main-image-design',
        scene: 'ecommerce-socks',
        status: input.status,
        platform: input.platform,
        documents: [],
        exportSpecs: [],
        verificationPolicy: {
            requiredBeforePhotoshopExecution: ['platform_size_profile', 'visual_or_manual_style_grounding', 'variant_plan'],
            requiredAfterPhotoshopExecution: ['document_exists', 'parent_groups_exist', 'child_groups_exist', 'export_files_exist'],
            qualityClaimBoundary: 'blocked evidence cannot support Photoshop writes or quality claims'
        },
        canClaimOutputQuality: false,
        canClaimDesignComplete: false,
        noPhotoshopWrites: true,
        mustNotExecutePhotoshop: true,
        blockers: [input.blocker],
        warnings: input.warning ? [input.warning] : [],
        limitations: ['生产文档结构是只读计划；阻断状态下不能伪造文档、分组或导出结果。'],
        evidence: [{
            source: 'main-image-production-document-structure',
            summary: input.blocker,
            status: 'failed'
        }]
    };
}

export function buildMainImageProductionDocumentStructureEvidence(
    input: MainImageProductionDocumentStructureInput = {}
): MainImageProductionDocumentStructureEvidence {
    const profileEvidence = input.platformSizeProfileEvidence;
    const platform = cleanString(profileEvidence?.platform) || 'unknown';
    if (!profileEvidence || profileEvidence.sizeProfiles.length === 0) {
        return makeBlockedProductionEvidence({
            status: 'blocked_missing_platform_size_profile',
            platform,
            blocker: 'main_image_platform_size_profile_required'
        });
    }

    const styleEvidence = input.projectStyleStrategyEvidence;
    if (!styleEvidence) {
        return makeBlockedProductionEvidence({
            status: 'blocked_missing_project_style_strategy',
            platform,
            blocker: 'main_image_project_style_strategy_required'
        });
    }
    if (styleEvidence.status !== 'ready_visual_grounded') {
        return makeBlockedProductionEvidence({
            status: 'blocked_missing_visual_grounding',
            platform,
            blocker: 'main_image_visual_grounding_required',
            warning: '缺少真实视觉模型或人工标注时，不能生成点击图/转化图生产结构。'
        });
    }

    const variants = getStyleVariants(styleEvidence);
    if (variants.clickImages.length === 0 && variants.conversionImages.length === 0) {
        return makeBlockedProductionEvidence({
            status: 'blocked_missing_variant_plan',
            platform,
            blocker: 'main_image_variant_plan_required'
        });
    }

    const documents = profileEvidence.sizeProfiles.map((profile) => buildDocumentPlan(
        platform,
        profile,
        styleEvidence
    ));
    const exportSpecs = buildExportSpecs(documents);
    const pendingThirdRatio = profileEvidence.sizeProfiles.some(
        (profile) => profile.evidenceLevel === 'project_preference_pending_confirmation'
    );
    const warnings = [
        ...profileEvidence.warnings
    ];
    if (pendingThirdRatio) {
        warnings.push('生产结构包含待确认第三比例，执行前应允许用户或后台配置调整。');
    }

    return {
        version: 'main-image-production-document-structure/v0',
        skillId: 'main-image-design',
        scene: 'ecommerce-socks',
        status: 'ready_production_document_structure',
        platform,
        documents,
        exportSpecs,
        verificationPolicy: {
            requiredBeforePhotoshopExecution: [
                'platform_size_profile',
                'visual_or_manual_style_grounding',
                'variant_plan',
                'user_or_config_confirmation_for_pending_ratios'
            ],
            requiredAfterPhotoshopExecution: [
                'document_exists',
                'parent_groups_exist',
                'child_groups_exist',
                'group_bounds_readback',
                'export_files_exist',
                'screenshot_or_pixel_probe'
            ],
            qualityClaimBoundary: '只有执行后读回文档、分组、导出文件和截图/像素证据，才能进入质量验收。'
        },
        canClaimOutputQuality: false,
        canClaimDesignComplete: false,
        noPhotoshopWrites: true,
        mustNotExecutePhotoshop: true,
        blockers: [],
        warnings,
        limitations: [
            '生产文档结构只描述文档、父组、子组和导出规格，不执行 Photoshop。',
            '父级组固定为「点击图」和「转化图」，子组才是单张图的导出单元；1200/9:16 的「转化图」组必须保持空。',
            '待确认比例必须保留 evidence 标记，不能作为平台官方事实展示。'
        ],
        evidence: [{
            source: 'main-image-production-document-structure',
            summary: `documents=${documents.length}; exportSpecs=${exportSpecs.length}; pendingThirdRatio=${pendingThirdRatio}`,
            status: 'ready'
        }]
    };
}
