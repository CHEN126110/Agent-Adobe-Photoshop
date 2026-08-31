import type {
    MainImageProjectStyleStrategy,
    MainImageVariantDirection
} from './main-image-project-style-strategy';
import {
    buildMainImageSlotAssignmentKey,
    getMainImageParentCreationOrder,
    MAIN_IMAGE_DELIVERY_DOCUMENTS,
    listMainImageProductionSizeAliases,
    resolveMainImageProductionSizeKey,
    resolveMainImageSlotAssignments,
    type MainImageDeliveryDocumentSpec,
    type MainImageProductionSlotSpec,
    type MainImageSlotAssignment
} from './main-image-production-spec';

export type MainImagePlatformSizeProfileStatus =
    | 'ready_platform_size_profile'
    | 'ready_platform_size_profile_with_pending_confirmation'
    | 'blocked_missing_platform';

export type MainImageProductionDocumentStructureStatus =
    | 'blocked_missing_platform_size_profile'
    | 'blocked_missing_project_style_strategy'
    | 'blocked_missing_visual_context'
    | 'blocked_missing_variant_plan'
    | 'blocked_invalid_slot_assignments'
    | 'ready_production_document_structure';

export type MainImageSizeSourceLevel =
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
    sourceLevel?: MainImageSizeSourceLevel;
    officialClaimAllowed?: boolean;
    warnings?: string[];
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
    sourceLevel: MainImageSizeSourceLevel;
    sourceSummary: string;
    officialClaimAllowed: boolean;
    intendedUse: string;
    warnings: string[];
}

export interface MainImagePlatformSizeProfile {
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
}

export interface MainImageProductionChildGroup {
    id: string;
    name: string;
    variantId: string;
    assignmentKey?: string;
    objective: string;
    imageType: 'click' | 'conversion';
    exportRole: 'click-image' | 'conversion-image';
    labelNumber: number;
    populationStatus: 'assigned' | 'unassigned';
    requiredInputs: string[];
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
    resolutionPpi: number;
    colorMode: 'RGB';
    bitDepth: 8;
    backgroundLayer: {
        name: string;
        fill: 'white';
        locked: boolean;
        exportRole: 'none';
    };
    parentGroupPanelOrderTopDown: Array<'转化图' | '点击图'>;
    sizeProfileId: string;
    sourceLevel: MainImageSizeSourceLevel;
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
    canvasPolicy: 'preserve_document_canvas';
    qualityBoundary: string;
}

export interface MainImageProductionDocumentStructureInput {
    platformSizeProfile?: MainImagePlatformSizeProfile | null;
    projectStyleStrategy?: MainImageProjectStyleStrategy | null;
    requestedSizeKeys?: string[];
    requestedImageType?: string;
    slotAssignments?: unknown;
    createEmptySkeleton?: boolean;
}

export interface MainImageProductionDocumentStructure {
    version: 'main-image-production-document-structure/v0';
    skillId: 'main-image-design';
    scene: 'ecommerce-socks';
    status: MainImageProductionDocumentStructureStatus;
    platform: string;
    slotAssignments: MainImageSlotAssignment[];
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
    sourceLevel: MainImageSizeSourceLevel;
    sourceSummary: string;
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
        sourceLevel: input.sourceLevel,
        sourceSummary: cleanString(input.sourceSummary),
        officialClaimAllowed: input.officialClaimAllowed,
        intendedUse: cleanString(input.intendedUse),
        warnings: (input.warnings || []).map(cleanString).filter(Boolean)
    };
}

function buildVerifiedProjectProfiles(): MainImageSizeProfileEntry[] {
    return MAIN_IMAGE_DELIVERY_DOCUMENTS.map((document) => makeProfileEntry({
        id: `tmall-${document.folderKey}-main-image`,
        ratio: document.ratio,
        label: `店铺 ${document.ratio} 主图工作文档（${document.folderKey}）`,
        designSize: document.canvasSize,
        exportSize: document.batchExportSize,
        sourceLevel: 'user_project_rule',
        sourceSummary: `用户主图骨架与批量导出脚本：${document.folderKey} 文档使用 ${document.canvasSize.width}x${document.canvasSize.height} 工作画布，非空子组按原画布导出。`,
        officialClaimAllowed: false,
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
    const sourceLevel = preference.sourceLevel || 'project_preference_pending_confirmation';
    return makeProfileEntry({
        id: cleanString(preference.id) || `project-preference-${ratio.replace(/[^0-9a-z]+/gi, '-')}`,
        ratio,
        label: cleanString(preference.label) || '项目偏好第三比例',
        designSize,
        exportSize,
        sourceLevel,
        sourceSummary: cleanString(preference.reason) || '第三比例来自项目生产偏好，需后续用平台后台或用户规范确认。',
        officialClaimAllowed: preference.officialClaimAllowed === true,
        intendedUse: '项目内部生产和导出候选，未确认前不得声明为平台官方强制规格',
        warnings: preference.warnings || (sourceLevel === 'project_preference_pending_confirmation'
            ? ['第三比例不是已确认官方规范，必须保持可配置。']
            : [])
    });
}

function buildProfileWarnings(sizeProfiles: MainImageSizeProfileEntry[]): string[] {
    const warnings: string[] = [];
    if (sizeProfiles.some((item) => item.sourceLevel === 'project_preference_pending_confirmation')) {
        warnings.push('第三比例来自项目偏好或待确认资料，不能宣称为天猫官方已确认规格。');
    }
    if (sizeProfiles.length < 3) {
        warnings.push('当前 profile 未包含用户期望的三规格主图；后续应由项目配置或后台规范补齐。');
    }
    return warnings;
}

export function buildMainImagePlatformSizeProfile(
    input: MainImagePlatformSizeProfileInput = {}
): MainImagePlatformSizeProfile {
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
            limitations: ['当前只收口天猫主图 profile；其他平台需要单独来源配置。']
        };
    }

    const sizeProfiles = buildVerifiedProjectProfiles();
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
            'profile 是尺寸和导出计划，不创建文档、不创建组、不导出文件。',
            '设计源尺寸是当前店铺工作画布，脚本按原画布导出；平台上传约束仍需要按后台实时校验。',
            '800/750/1200 三规格来自用户项目生产规范，不能宣称为平台官方强制规格。'
        ]
    };
}

function makeSafeName(value: unknown): string {
    return cleanString(value).replace(/[\\/:*?"<>|]+/g, '').slice(0, 36);
}

function makeSafePhotoshopDocumentName(value: unknown): string {
    return cleanString(value)
        .replace(/(\d+)\s*:\s*(\d+)/g, '$1x$2')
        .replace(/[\\/:*?"<>|]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 72);
}

function normalizeScopeKey(value: unknown): string {
    return cleanString(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function findDeliverySpecForProfile(
    profile: MainImageSizeProfileEntry
): MainImageDeliveryDocumentSpec | undefined {
    return MAIN_IMAGE_DELIVERY_DOCUMENTS.find((item) => (
        profile.id === `tmall-${item.folderKey}-main-image`
    ));
}

function getProfileScopeAliases(profile: MainImageSizeProfileEntry): string[] {
    const deliverySpec = findDeliverySpecForProfile(profile);
    const rawAliases = [
        profile.id,
        profile.ratio,
        profile.label,
        `${profile.designSize.width}x${profile.designSize.height}`,
        `${profile.exportSize.width}x${profile.exportSize.height}`,
        ...(deliverySpec ? listMainImageProductionSizeAliases(deliverySpec.folderKey) : [])
    ];
    return Array.from(new Set(rawAliases.flatMap((alias) => {
        const cleanAlias = cleanString(alias);
        const normalizedAlias = normalizeScopeKey(alias);
        return cleanAlias && normalizedAlias && cleanAlias !== normalizedAlias
            ? [cleanAlias, normalizedAlias]
            : [cleanAlias || normalizedAlias];
    }).filter(Boolean)));
}

function resolveMainImageScopeToken(value: unknown): '800' | '750' | '1200' | undefined {
    return resolveMainImageProductionSizeKey(value);
}

function filterProfilesByRequestedScope(
    profiles: MainImageSizeProfileEntry[],
    requestedSizeKeys: string[] | undefined
): MainImageSizeProfileEntry[] {
    const requested = Array.from(new Set((requestedSizeKeys || [])
        .map(normalizeScopeKey)
        .filter(Boolean)));
    const requestedTokens = new Set(requestedSizeKeys
        ?.map(resolveMainImageScopeToken)
        .filter(Boolean) as Array<'800' | '750' | '1200'> || []);
    if (requested.length === 0) return profiles;
    return profiles.filter((profile) => {
        const aliases = getProfileScopeAliases(profile).map(normalizeScopeKey).filter(Boolean);
        const profileTokens = new Set(aliases.map(resolveMainImageScopeToken).filter(Boolean));
        for (const token of requestedTokens) {
            if (profileTokens.has(token)) return true;
        }
        return requested.some((key) => aliases.includes(key) || aliases.some((alias) => alias.includes(key)));
    });
}

function normalizeRequestedImageType(value: unknown): 'click' | 'conversion' | undefined {
    const normalized = normalizeScopeKey(value);
    if (!normalized) return undefined;
    if (normalized.includes('conversion') || normalized.includes('zhuanhua')) return 'conversion';
    if (normalized.includes('click') || normalized.includes('shoutu')) return 'click';
    const raw = cleanString(value);
    if (/转化图|卖点图|利益点图/i.test(raw)) return 'conversion';
    if (/点击图|首图|商品首图|淘宝商品首图/i.test(raw)) return 'click';
    return undefined;
}

function makeStandardSlotChildGroup(
    profile: MainImageSizeProfileEntry,
    slot: MainImageProductionSlotSpec,
    assignment: MainImageSlotAssignment | undefined
): MainImageProductionChildGroup {
    const assigned = Boolean(assignment);
    const variantId = cleanString(assignment?.variantId)
        || `unassigned-slot:${profile.id}:${slot.imageType}:${slot.name}`;
    return {
        id: `${profile.id}-${slot.imageType}-slot-${makeSafeName(slot.name)}`,
        name: slot.name,
        variantId,
        assignmentKey: assignment ? buildMainImageSlotAssignmentKey(assignment) : undefined,
        objective: assigned ? cleanString(assignment?.objective) : '',
        imageType: slot.imageType,
        exportRole: slot.imageType === 'click' ? 'click-image' : 'conversion-image',
        labelNumber: slot.labelNumber,
        populationStatus: assigned ? 'assigned' : 'unassigned',
        requiredInputs: assigned
            ? [
                'agent_authored_slot_assignment',
                'slot_scoped_asset_dimensions',
                'slot_scoped_subject_bounds',
                'slot_scoped_placement_decision',
                'production_group_created',
                'post_export_file_exists',
                'post_export_screenshot_or_probe'
            ].map(cleanString).filter(Boolean)
            : ['production_group_created']
    };
}

function makeCustomVariantChildGroup(
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
        labelNumber: variant.imageType === 'click' ? index + 1 : index + 2,
        populationStatus: 'assigned',
        requiredInputs: [
            ...variant.requiredInputs,
            'production_group_created',
            'post_export_file_exists',
            'post_export_screenshot_or_probe'
        ].map(cleanString).filter(Boolean)
    };
}

function buildStandardSlotGroups(input: {
    profile: MainImageSizeProfileEntry;
    slots: MainImageProductionSlotSpec[];
    assignments: MainImageSlotAssignment[];
}): MainImageProductionChildGroup[] {
    return input.slots.map((slot) => makeStandardSlotChildGroup(
        input.profile,
        slot,
        input.assignments.find((assignment) => (
            assignment.imageType === slot.imageType
            && assignment.slotName === slot.name
        ))
    ));
}

function buildParentGroups(
    profile: MainImageSizeProfileEntry,
    assignments: MainImageSlotAssignment[]
): [MainImageProductionParentGroup, MainImageProductionParentGroup] {
    const deliverySpec = findDeliverySpecForProfile(profile);
    if (deliverySpec) {
        const groupsByName: Record<'点击图' | '转化图', MainImageProductionParentGroup> = {
            点击图: {
                name: '点击图',
                role: 'click-images',
                childGroups: buildStandardSlotGroups({
                    profile,
                    slots: deliverySpec.slots.click,
                    assignments
                })
            },
            转化图: {
                name: '转化图',
                role: 'conversion-images',
                childGroups: buildStandardSlotGroups({
                    profile,
                    slots: deliverySpec.slots.conversion,
                    assignments
                })
            }
        };
        const creationOrder = getMainImageParentCreationOrder();
        return [groupsByName[creationOrder[0]], groupsByName[creationOrder[1]]];
    }
    const clickAssignments = assignments.filter((assignment) => assignment.imageType === 'click');
    const conversionAssignments = assignments.filter((assignment) => assignment.imageType === 'conversion');
    return [
        {
            name: '点击图',
            role: 'click-images',
            childGroups: clickAssignments.map((assignment, index) => makeCustomVariantChildGroup(profile, {
                id: assignment.variantId,
                imageType: assignment.imageType,
                objective: assignment.objective,
                visualHook: assignment.visualHook || '',
                layoutFocus: assignment.layoutFocus || '',
                copyRole: assignment.copyRole || '',
                referenceNeed: '',
                requiredInputs: []
            }, index))
        },
        {
            name: '转化图',
            role: 'conversion-images',
            childGroups: conversionAssignments.map((assignment, index) => makeCustomVariantChildGroup(profile, {
                id: assignment.variantId,
                imageType: assignment.imageType,
                objective: assignment.objective,
                visualHook: assignment.visualHook || '',
                layoutFocus: assignment.layoutFocus || '',
                copyRole: assignment.copyRole || '',
                referenceNeed: '',
                requiredInputs: []
            }, index))
        }
    ];
}

function buildDocumentPlan(
    platform: string,
    profile: MainImageSizeProfileEntry,
    assignments: MainImageSlotAssignment[]
): MainImageProductionDocumentPlan {
    const deliverySpec = findDeliverySpecForProfile(profile);
    return {
        id: `main-image-document-${profile.id}`,
        name: deliverySpec?.documentBaseName
            || makeSafePhotoshopDocumentName(`${platform}-${profile.ratio}-${profile.label}`),
        platform,
        ratio: profile.ratio,
        canvasSize: profile.designSize,
        exportSize: profile.exportSize,
        resolutionPpi: deliverySpec?.resolutionPpi || 72,
        colorMode: deliverySpec?.colorMode || 'RGB',
        bitDepth: deliverySpec?.bitDepth || 8,
        backgroundLayer: deliverySpec?.backgroundLayer || {
            name: '背景',
            fill: 'white',
            locked: true,
            exportRole: 'none'
        },
        parentGroupPanelOrderTopDown: deliverySpec?.parentGroupPanelOrderTopDown || ['转化图', '点击图'],
        sizeProfileId: profile.id,
        sourceLevel: profile.sourceLevel,
        parentGroups: buildParentGroups(profile, assignments)
    };
}

function buildExportSpecs(documents: MainImageProductionDocumentPlan[]): MainImageProductionExportSpec[] {
    const specs: MainImageProductionExportSpec[] = [];
    for (const document of documents) {
        for (const parentGroup of document.parentGroups) {
            parentGroup.childGroups.forEach((childGroup) => {
                if (childGroup.populationStatus !== 'assigned') return;
                specs.push({
                    id: `${document.id}-${childGroup.id}-export`,
                    documentId: document.id,
                    documentName: document.name,
                    groupPath: [parentGroup.name, childGroup.name],
                    exportSize: document.exportSize,
                    fileName: `${makeSafeName(childGroup.name)}.jpg`,
                    imageType: childGroup.imageType,
                    canvasPolicy: 'preserve_document_canvas',
                    qualityBoundary: '导出规格只指向 Agent 已分配的非空组；必须隔离兄弟组、保留完整工作画布，并在 Photoshop 执行后读取文件、截图或像素 probe 才能验收。'
                });
            });
        }
    }
    return specs;
}

function makeBlockedProductionStructure(input: {
    status: MainImageProductionDocumentStructureStatus;
    platform: string;
    blocker: string;
    warning?: string;
}): MainImageProductionDocumentStructure {
    return {
        version: 'main-image-production-document-structure/v0',
        skillId: 'main-image-design',
        scene: 'ecommerce-socks',
        status: input.status,
        platform: input.platform,
        slotAssignments: [],
        documents: [],
        exportSpecs: [],
        verificationPolicy: {
            requiredBeforePhotoshopExecution: ['platform_size_profile', 'asset_bound_visual_context', 'variant_plan'],
            requiredAfterPhotoshopExecution: ['document_exists', 'parent_groups_exist', 'child_groups_exist', 'export_files_exist'],
            qualityClaimBoundary: 'blocked production structure cannot support Photoshop writes or quality claims'
        },
        canClaimOutputQuality: false,
        canClaimDesignComplete: false,
        noPhotoshopWrites: true,
        mustNotExecutePhotoshop: true,
        blockers: [input.blocker],
        warnings: input.warning ? [input.warning] : [],
        limitations: ['生产文档结构是只读计划；阻断状态下不能伪造文档、分组或导出结果。']
    };
}

export function buildMainImageProductionDocumentStructure(
    input: MainImageProductionDocumentStructureInput = {}
): MainImageProductionDocumentStructure {
    const platformSizeProfile = input.platformSizeProfile;
    const platform = cleanString(platformSizeProfile?.platform) || 'unknown';
    if (!platformSizeProfile || platformSizeProfile.sizeProfiles.length === 0) {
        return makeBlockedProductionStructure({
            status: 'blocked_missing_platform_size_profile',
            platform,
            blocker: 'main_image_platform_size_profile_required'
        });
    }

    const assignmentResolution = resolveMainImageSlotAssignments(input.slotAssignments);
    if (assignmentResolution.issues.length > 0) {
        return makeBlockedProductionStructure({
            status: 'blocked_invalid_slot_assignments',
            platform,
            blocker: `main_image_slot_assignments_invalid=${assignmentResolution.issues.join(',')}`
        });
    }
    const createEmptySkeleton = input.createEmptySkeleton === true;
    const styleStrategy = input.projectStyleStrategy;
    if (!styleStrategy && !createEmptySkeleton) {
        return makeBlockedProductionStructure({
            status: 'blocked_missing_project_style_strategy',
            platform,
            blocker: 'main_image_project_style_strategy_required'
        });
    }
    if (styleStrategy && styleStrategy.status !== 'ready_visual_context' && !createEmptySkeleton) {
        return makeBlockedProductionStructure({
            status: 'blocked_missing_visual_context',
            platform,
            blocker: 'main_image_visual_context_required',
            warning: '缺少与所选素材绑定的可用视觉上下文时，不能生成点击图/转化图生产结构。'
        });
    }

    const scopedProfiles = filterProfilesByRequestedScope(platformSizeProfile.sizeProfiles, input.requestedSizeKeys);
    if (scopedProfiles.length === 0) {
        return makeBlockedProductionStructure({
            status: 'blocked_missing_platform_size_profile',
            platform,
            blocker: 'main_image_requested_size_profile_not_supported',
            warning: '本次请求的主图尺寸没有命中当前平台交付规格，不能继续生成生产结构。'
        });
    }

    const requestedImageType = normalizeRequestedImageType(input.requestedImageType);
    const scopedSizeKeys = new Set(scopedProfiles
        .map((profile) => findDeliverySpecForProfile(profile)?.folderKey)
        .filter(Boolean));
    const assignmentsOutsideScope = assignmentResolution.assignments.filter((assignment) => (
        !scopedSizeKeys.has(resolveMainImageProductionSizeKey(assignment.sizeKey))
        || Boolean(requestedImageType && assignment.imageType !== requestedImageType)
    ));
    if (assignmentsOutsideScope.length > 0) {
        return makeBlockedProductionStructure({
            status: 'blocked_invalid_slot_assignments',
            platform,
            blocker: `main_image_slot_assignments_outside_requested_scope=${assignmentsOutsideScope
                .map(buildMainImageSlotAssignmentKey)
                .join(',')}`
        });
    }
    const documents = scopedProfiles.map((profile) => buildDocumentPlan(
        platform,
        profile,
        assignmentResolution.assignments.filter((assignment) => (
            resolveMainImageProductionSizeKey(assignment.sizeKey)
                === findDeliverySpecForProfile(profile)?.folderKey
        ))
    ));
    const exportSpecs = buildExportSpecs(documents);
    const pendingThirdRatio = scopedProfiles.some(
        (profile) => profile.sourceLevel === 'project_preference_pending_confirmation'
    );
    const warnings = [
        ...platformSizeProfile.warnings
    ];
    if (assignmentResolution.assignments.length === 0) {
        warnings.push('固定主图骨架已建立，但 Agent 尚未为任何槽位声明内容方向；当前不会生成置入、变换或导出操作。');
    }
    if (pendingThirdRatio) {
        warnings.push('生产结构包含待确认第三比例，执行前应允许用户或后台配置调整。');
    }
    if (scopedProfiles.length < platformSizeProfile.sizeProfiles.length) {
        warnings.push('本次生产结构已按用户明确请求的尺寸范围收窄，未展开未请求的主图规格。');
    }
    if (requestedImageType) {
        warnings.push(`本次生产结构已按用户明确请求的${requestedImageType === 'click' ? '点击图/首图' : '转化图'}范围收窄，未展开另一类子图。`);
    }

    return {
        version: 'main-image-production-document-structure/v0',
        skillId: 'main-image-design',
        scene: 'ecommerce-socks',
        status: 'ready_production_document_structure',
        platform,
        slotAssignments: assignmentResolution.assignments,
        documents,
        exportSpecs,
        verificationPolicy: {
            requiredBeforePhotoshopExecution: [
                'platform_size_profile',
                'asset_bound_visual_context',
                'agent_authored_slot_assignments_for_content_operations',
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
            qualityClaimBoundary: '只有执行后读回文档、分组、导出文件和截图/像素检查结果，才能进入质量验收。'
        },
        canClaimOutputQuality: false,
        canClaimDesignComplete: false,
        noPhotoshopWrites: true,
        mustNotExecutePhotoshop: true,
        blockers: [],
        warnings,
        limitations: [
            '生产文档结构只描述文档、父组、子组和导出规格，不执行 Photoshop。',
            '父级组固定为「点击图」和「转化图」，三个标准文档均保留 5 个点击槽与 4 个转化槽；空槽不会产生内容或导出。',
            '槽位名称与画布是生产结构；填哪些槽、每槽素材、目标、构图和文案仍由 Agent 或用户决定。',
            '待确认比例必须保留来源状态，不能作为平台官方事实展示。'
        ]
    };
}
