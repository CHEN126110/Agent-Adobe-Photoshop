/**
 * Main-image production structure owned by the main-image Skill package.
 *
 * This module records only the user's verified document/container/export convention. It does
 * not choose source images, decide which slots to populate, author copy, or select a layout.
 */

import type {
    SmartScalingAnchor,
    SmartScalingCropPolicy,
    SmartScalingMode,
    SmartScalingPreset
} from './design-smart-scaling-policy';

export type MainImageDeliveryFolderKey = '800' | '750' | '1200';
export type MainImageDeliveryRatio = '1:1' | '3:4' | '2:3';
export type MainImageDeliverableImageType = 'click' | 'conversion';

export interface MainImageSlotAssetSpec {
    id?: string;
    name?: string;
    path: string;
    width: number;
    height: number;
}

export interface MainImageSlotSubjectBoundsSpec {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

export interface MainImageSlotPlacementSpec {
    targetBox: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    safeBox?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    preset: SmartScalingPreset;
    decisionReason: string;
}

/**
 * One Agent/user-authored content assignment for one exact production slot.
 * Reusing an asset or direction across documents requires another explicit assignment.
 */
export interface MainImageSlotAssignment {
    sizeKey: string;
    imageType: MainImageDeliverableImageType;
    slotName: string;
    variantId: string;
    objective: string;
    visualHook?: string;
    layoutFocus?: string;
    copyRole?: string;
    asset: MainImageSlotAssetSpec;
    subjectBounds: MainImageSlotSubjectBoundsSpec;
    placement: MainImageSlotPlacementSpec;
}

export interface MainImageSlotAssignmentResolution {
    assignments: MainImageSlotAssignment[];
    issues: string[];
}

export interface MainImageProductionSlotSpec {
    name: string;
    imageType: MainImageDeliverableImageType;
    /** Numeric label/order visible in the verified skeleton; it is not a completion requirement. */
    labelNumber: number;
    populationPolicy: 'agent_or_user_selected';
    exportPolicy: 'export_when_structurally_non_empty';
}

export interface MainImageDeliveryDocumentSpec {
    folderKey: MainImageDeliveryFolderKey;
    documentBaseName: MainImageDeliveryFolderKey;
    ratio: MainImageDeliveryRatio;
    label: string;
    /** Photoshop working canvas verified from the user's standard skeleton. */
    canvasSize: {
        width: number;
        height: number;
    };
    /** The provided JSX exports without resizing, so the batch raster keeps the working size. */
    batchExportSize: {
        width: number;
        height: number;
    };
    /** Current evidence does not establish the final platform upload dimensions. */
    platformUploadSize: null;
    platformUploadSizeStatus: 'unverified';
    resolutionPpi: 72;
    colorMode: 'RGB';
    bitDepth: 8;
    backgroundLayer: {
        name: '背景';
        fill: 'white';
        locked: true;
        exportRole: 'none';
    };
    parentGroupPanelOrderTopDown: ['转化图', '点击图'];
    sourceDocumentPath: string;
    exportFolder: string;
    includedImageTypes: MainImageDeliverableImageType[];
    excludedImageTypes: MainImageDeliverableImageType[];
    slots: {
        click: MainImageProductionSlotSpec[];
        conversion: MainImageProductionSlotSpec[];
    };
    slotPanelOrderTopDown: {
        click: string[];
        conversion: string[];
    };
    batchExportPolicy: {
        pixelPolicy: 'preserve_work_canvas';
        fileNamePolicy: 'child_group_name';
        occupancyPolicy: 'export_structurally_non_empty_only';
        siblingIsolationRequired: true;
    };
    contentPolicy: string;
}

const MAIN_IMAGE_PRODUCTION_SIZE_ALIASES: Readonly<Record<string, MainImageDeliveryFolderKey>> = Object.freeze({
    'tmall-1x1-main-image': '800',
    '方图': '800',
    '方形': '800',
    'tmall-3x4-main-image': '750',
    '竖图': '750',
    '竖版': '750',
    'tmall-2x3-main-image': '1200',
    'tmall-2:3-main-image': '1200',
    '长图': '1200',
    '长竖图': '1200'
});

const CONVERSION_MAIN_IMAGE_POSITIONS = [2, 3, 4, 5] as const;

function buildClickSlots(folderKey: MainImageDeliveryFolderKey): MainImageProductionSlotSpec[] {
    return Array.from({ length: 5 }, (_, index) => ({
        name: `${folderKey}-${index + 1}`,
        imageType: 'click' as const,
        labelNumber: index + 1,
        populationPolicy: 'agent_or_user_selected' as const,
        exportPolicy: 'export_when_structurally_non_empty' as const
    }));
}

function buildConversionSlots(): MainImageProductionSlotSpec[] {
    return CONVERSION_MAIN_IMAGE_POSITIONS.map((position) => ({
        name: String(position),
        imageType: 'conversion' as const,
        labelNumber: position,
        populationPolicy: 'agent_or_user_selected' as const,
        exportPolicy: 'export_when_structurally_non_empty' as const
    }));
}

function buildSlots(folderKey: MainImageDeliveryFolderKey): MainImageDeliveryDocumentSpec['slots'] {
    return {
        click: buildClickSlots(folderKey),
        conversion: buildConversionSlots()
    };
}

function buildPanelOrderTopDown(
    slots: MainImageDeliveryDocumentSpec['slots']
): MainImageDeliveryDocumentSpec['slotPanelOrderTopDown'] {
    return {
        click: slots.click.map((slot) => slot.name).reverse(),
        conversion: slots.conversion.map((slot) => slot.name).reverse()
    };
}

function buildDocumentSlots(folderKey: MainImageDeliveryFolderKey): Pick<
    MainImageDeliveryDocumentSpec,
    'slots' | 'slotPanelOrderTopDown'
> {
    const slots = buildSlots(folderKey);
    return {
        slots,
        slotPanelOrderTopDown: buildPanelOrderTopDown(slots)
    };
}

function buildBatchExportPolicy(): MainImageDeliveryDocumentSpec['batchExportPolicy'] {
    return {
        pixelPolicy: 'preserve_work_canvas',
        fileNamePolicy: 'child_group_name',
        occupancyPolicy: 'export_structurally_non_empty_only',
        siblingIsolationRequired: true
    };
}

export const MAIN_IMAGE_DELIVERY_DOCUMENTS: MainImageDeliveryDocumentSpec[] = [
    {
        folderKey: '800',
        documentBaseName: '800',
        ratio: '1:1',
        label: '800 方形主图物料',
        canvasSize: { width: 1500, height: 1500 },
        batchExportSize: { width: 1500, height: 1500 },
        platformUploadSize: null,
        platformUploadSizeStatus: 'unverified',
        resolutionPpi: 72,
        colorMode: 'RGB',
        bitDepth: 8,
        backgroundLayer: { name: '背景', fill: 'white', locked: true, exportRole: 'none' },
        parentGroupPanelOrderTopDown: ['转化图', '点击图'],
        sourceDocumentPath: 'PSD/800.psb',
        exportFolder: '主图/800',
        includedImageTypes: ['click', 'conversion'],
        excludedImageTypes: [],
        ...buildDocumentSlots('800'),
        batchExportPolicy: buildBatchExportPolicy(),
        contentPolicy: '文档固定提供点击图与转化图容器；具体填充数量、素材、构图和文字由 Agent 或用户决定。'
    },
    {
        folderKey: '750',
        documentBaseName: '750',
        ratio: '3:4',
        label: '750 竖版主图物料',
        canvasSize: { width: 1500, height: 2000 },
        batchExportSize: { width: 1500, height: 2000 },
        platformUploadSize: null,
        platformUploadSizeStatus: 'unverified',
        resolutionPpi: 72,
        colorMode: 'RGB',
        bitDepth: 8,
        backgroundLayer: { name: '背景', fill: 'white', locked: true, exportRole: 'none' },
        parentGroupPanelOrderTopDown: ['转化图', '点击图'],
        sourceDocumentPath: 'PSD/750.psb',
        exportFolder: '主图/750',
        includedImageTypes: ['click', 'conversion'],
        excludedImageTypes: [],
        ...buildDocumentSlots('750'),
        batchExportPolicy: buildBatchExportPolicy(),
        contentPolicy: '文档固定提供点击图与转化图容器；同一商品方向可按竖版画布重新组织，但不复制固定版式。'
    },
    {
        folderKey: '1200',
        documentBaseName: '1200',
        ratio: '2:3',
        label: '1200 竖版主图物料',
        canvasSize: { width: 1440, height: 2160 },
        batchExportSize: { width: 1440, height: 2160 },
        platformUploadSize: null,
        platformUploadSizeStatus: 'unverified',
        resolutionPpi: 72,
        colorMode: 'RGB',
        bitDepth: 8,
        backgroundLayer: { name: '背景', fill: 'white', locked: true, exportRole: 'none' },
        parentGroupPanelOrderTopDown: ['转化图', '点击图'],
        sourceDocumentPath: 'PSD/1200.psb',
        exportFolder: '主图/1200',
        includedImageTypes: ['click', 'conversion'],
        excludedImageTypes: [],
        ...buildDocumentSlots('1200'),
        batchExportPolicy: buildBatchExportPolicy(),
        contentPolicy: '文档固定保留点击图与转化图容器；是否填充转化槽属于当前任务的内容决定，不由 Harness 禁止或强制。'
    }
];

function cleanString(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeAliasKey(value: unknown): string {
    return cleanString(value).replace(/：/g, ':').replace(/\s+/g, '').toLowerCase();
}

function readFiniteNumber(value: unknown): number | undefined {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
}

function readPositiveNumber(value: unknown): number | undefined {
    const number = readFiniteNumber(value);
    if (number === undefined || number <= 0) return undefined;
    return number;
}

function readBox(value: unknown): MainImageSlotPlacementSpec['targetBox'] | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    const x = readFiniteNumber(record.x);
    const y = readFiniteNumber(record.y);
    const width = readPositiveNumber(record.width);
    const height = readPositiveNumber(record.height);
    if (x === undefined || y === undefined || !width || !height) return undefined;
    return { x, y, width, height };
}

function readPreset(value: unknown): SmartScalingPreset | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    const scaleMode = cleanString(record.scaleMode) as SmartScalingMode;
    const anchor = cleanString(record.anchor) as SmartScalingAnchor;
    const cropPolicy = cleanString(record.cropPolicy) as SmartScalingCropPolicy;
    const targetFill = readPositiveNumber(record.targetFill);
    const minFill = readPositiveNumber(record.minFill);
    const maxFill = readPositiveNumber(record.maxFill);
    const visualBiasY = readFiniteNumber(record.visualBiasY);
    const minScale = readPositiveNumber(record.minScale);
    const maxScale = readPositiveNumber(record.maxScale);
    if (
        (scaleMode !== 'contain' && scaleMode !== 'cover')
        || !['center', 'top-center', 'bottom-center', 'left-center', 'right-center'].includes(anchor)
        || !['avoid-crop', 'protect-subject', 'allow-crop'].includes(cropPolicy)
        || !targetFill
        || !minFill
        || !maxFill
        || visualBiasY === undefined
        || !minScale
        || !maxScale
        || minFill > maxFill
        || minScale > maxScale
    ) {
        return undefined;
    }
    return {
        scaleMode,
        targetFill,
        minFill,
        maxFill,
        anchor,
        cropPolicy,
        visualBiasY,
        minScale,
        maxScale
    };
}

function readAsset(value: unknown): MainImageSlotAssetSpec | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    const path = cleanString(record.path);
    const width = readPositiveNumber(record.width);
    const height = readPositiveNumber(record.height);
    if (!path || !width || !height) return undefined;
    return {
        id: cleanString(record.id) || undefined,
        name: cleanString(record.name) || undefined,
        path,
        width,
        height
    };
}

function readSubjectBounds(value: unknown): MainImageSlotSubjectBoundsSpec | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    const left = readFiniteNumber(record.left);
    const top = readFiniteNumber(record.top);
    const right = readFiniteNumber(record.right);
    const bottom = readFiniteNumber(record.bottom);
    const width = readPositiveNumber(record.width);
    const height = readPositiveNumber(record.height);
    if (left === undefined || top === undefined || right === undefined || bottom === undefined || !width || !height) {
        return undefined;
    }
    if (right <= left || bottom <= top) return undefined;
    if (Math.abs(width - (right - left)) > 0.01 || Math.abs(height - (bottom - top)) > 0.01) {
        return undefined;
    }
    return { left, top, right, bottom, width, height };
}

function readPlacement(value: unknown): MainImageSlotPlacementSpec | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    const targetBox = readBox(record.targetBox);
    const safeBox = record.safeBox === undefined ? undefined : readBox(record.safeBox);
    const preset = readPreset(record.preset);
    const decisionReason = cleanString(record.decisionReason);
    if (!targetBox || (record.safeBox !== undefined && !safeBox) || !preset || !decisionReason) return undefined;
    return { targetBox, safeBox, preset, decisionReason };
}

function isBoxInside(
    inner: { x: number; y: number; width: number; height: number },
    outer: { x: number; y: number; width: number; height: number }
): boolean {
    return inner.x >= outer.x
        && inner.y >= outer.y
        && inner.x + inner.width <= outer.x + outer.width
        && inner.y + inner.height <= outer.y + outer.height;
}

export function resolveMainImageProductionSizeKey(value: unknown): MainImageDeliveryFolderKey | undefined {
    const normalized = normalizeAliasKey(value);
    if (!normalized) return undefined;
    for (const document of MAIN_IMAGE_DELIVERY_DOCUMENTS) {
        const canonicalAliases = [
            document.folderKey,
            document.documentBaseName,
            document.ratio,
            document.ratio.replace(':', 'x'),
            `${document.canvasSize.width}x${document.canvasSize.height}`,
            `tmall-${document.folderKey}-main-image`
        ].map(normalizeAliasKey);
        if (canonicalAliases.includes(normalized)) return document.folderKey;
    }
    return MAIN_IMAGE_PRODUCTION_SIZE_ALIASES[normalized];
}

export function listMainImageProductionSizeAliases(
    folderKey: MainImageDeliveryFolderKey
): string[] {
    const document = getMainImageProductionDocumentSpec(folderKey);
    const configuredAliases = Object.entries(MAIN_IMAGE_PRODUCTION_SIZE_ALIASES)
        .filter(([, targetFolderKey]) => targetFolderKey === folderKey)
        .map(([alias]) => alias);
    return Array.from(new Set([
        document.folderKey,
        document.documentBaseName,
        document.ratio,
        document.ratio.replace(':', 'x'),
        `${document.canvasSize.width}x${document.canvasSize.height}`,
        `tmall-${document.folderKey}-main-image`,
        ...configuredAliases
    ]));
}

export function buildMainImageSlotAssignmentKey(input: Pick<
    MainImageSlotAssignment,
    'sizeKey' | 'imageType' | 'slotName' | 'variantId'
>): string {
    return [input.sizeKey, input.imageType, input.slotName, input.variantId]
        .map(cleanString)
        .join('/');
}

export function resolveMainImageSlotAssignments(value: unknown): MainImageSlotAssignmentResolution {
    if (value === undefined || value === null) return { assignments: [], issues: [] };
    if (!Array.isArray(value)) return { assignments: [], issues: ['slot_assignments_must_be_array'] };
    const assignments: MainImageSlotAssignment[] = [];
    const issues: string[] = [];
    const occupiedSlots = new Set<string>();
    for (const [index, item] of value.entries()) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            issues.push(`slot_assignment_${index + 1}_must_be_object`);
            continue;
        }
        const record = item as Record<string, unknown>;
        const sizeKey = resolveMainImageProductionSizeKey(record.sizeKey);
        const imageType = cleanString(record.imageType) as MainImageDeliverableImageType;
        const slotName = cleanString(record.slotName);
        const variantId = cleanString(record.variantId);
        const objective = cleanString(record.objective);
        const document = sizeKey ? getMainImageProductionDocumentSpec(sizeKey) : undefined;
        const validSlots = imageType === 'click'
            ? document?.slots.click
            : imageType === 'conversion' ? document?.slots.conversion : undefined;
        const asset = readAsset(record.asset);
        const subjectBounds = readSubjectBounds(record.subjectBounds);
        const placement = readPlacement(record.placement);
        const issuePrefix = `slot_assignment_${index + 1}`;
        if (!sizeKey) issues.push(`${issuePrefix}_size_key_invalid`);
        if (imageType !== 'click' && imageType !== 'conversion') issues.push(`${issuePrefix}_image_type_invalid`);
        if (!slotName || !validSlots?.some((slot) => slot.name === slotName)) {
            issues.push(`${issuePrefix}_slot_name_invalid`);
        }
        if (!variantId) issues.push(`${issuePrefix}_variant_id_required`);
        if (!objective) issues.push(`${issuePrefix}_objective_required`);
        if (!asset) issues.push(`${issuePrefix}_asset_invalid`);
        if (!subjectBounds) issues.push(`${issuePrefix}_subject_bounds_invalid`);
        const subjectBoundsInsideAsset = Boolean(asset && subjectBounds && (
            subjectBounds.left >= 0
            && subjectBounds.top >= 0
            && subjectBounds.right <= asset.width
            && subjectBounds.bottom <= asset.height
        ));
        if (asset && subjectBounds && !subjectBoundsInsideAsset) {
            issues.push(`${issuePrefix}_subject_bounds_outside_asset`);
        }
        if (!placement) issues.push(`${issuePrefix}_placement_invalid`);
        const canvasBox = document ? {
            x: 0,
            y: 0,
            width: document.canvasSize.width,
            height: document.canvasSize.height
        } : undefined;
        const targetBoxInsideCanvas = Boolean(canvasBox && placement && isBoxInside(placement.targetBox, canvasBox));
        if (document && placement && !targetBoxInsideCanvas) {
            issues.push(`${issuePrefix}_target_box_outside_canvas`);
        }
        const safeBoxInsideCanvas = Boolean(canvasBox && placement && (
            placement.safeBox === undefined || isBoxInside(placement.safeBox, canvasBox)
        ));
        if (document && placement?.safeBox && !safeBoxInsideCanvas) {
            issues.push(`${issuePrefix}_safe_box_outside_canvas`);
        }
        const targetBoxInsideSafeBox = Boolean(placement && (
            placement.safeBox === undefined || isBoxInside(placement.targetBox, placement.safeBox)
        ));
        if (placement?.safeBox && !targetBoxInsideSafeBox) {
            issues.push(`${issuePrefix}_target_box_outside_safe_box`);
        }
        if (!sizeKey || !validSlots?.some((slot) => slot.name === slotName)
            || !variantId || !objective || !asset || !subjectBounds || !placement
            || !subjectBoundsInsideAsset || !targetBoxInsideCanvas
            || !safeBoxInsideCanvas || !targetBoxInsideSafeBox) {
            continue;
        }
        const occupiedSlotKey = `${sizeKey}/${imageType}/${slotName}`;
        if (occupiedSlots.has(occupiedSlotKey)) {
            issues.push(`${issuePrefix}_slot_already_assigned`);
            continue;
        }
        occupiedSlots.add(occupiedSlotKey);
        assignments.push({
            sizeKey,
            imageType,
            slotName,
            variantId,
            objective,
            visualHook: cleanString(record.visualHook) || undefined,
            layoutFocus: cleanString(record.layoutFocus) || undefined,
            copyRole: cleanString(record.copyRole) || undefined,
            asset,
            subjectBounds,
            placement
        });
    }
    return { assignments, issues: Array.from(new Set(issues)) };
}

export function getMainImageParentCreationOrder(): ['点击图', '转化图'] {
    const panelOrder = getMainImageProductionDocumentSpec('800').parentGroupPanelOrderTopDown;
    return [panelOrder[1], panelOrder[0]];
}

export function getMainImageChildCreationOrder(
    folderKey: MainImageDeliveryFolderKey,
    imageType: MainImageDeliverableImageType
): string[] {
    const document = getMainImageProductionDocumentSpec(folderKey);
    return [...document.slotPanelOrderTopDown[imageType]];
}

export function getMainImageProductionDocumentSpec(
    folderKey: MainImageDeliveryFolderKey
): MainImageDeliveryDocumentSpec {
    const document = MAIN_IMAGE_DELIVERY_DOCUMENTS.find((item) => item.folderKey === folderKey);
    if (!document) throw new Error(`Unknown main-image production folder key: ${folderKey}`);
    return document;
}
