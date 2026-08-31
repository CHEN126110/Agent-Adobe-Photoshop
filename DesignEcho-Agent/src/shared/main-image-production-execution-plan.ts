import type {
    ImagePlacementBox,
    ImagePlacementRequiredReadback
} from './design-image-placement-core';
import type {
    MainImageProductionDocumentPlan,
    MainImageProductionDocumentStructure,
    MainImageProductionExportSpec,
    MainImageSize
} from './main-image-production-document-structure';
import type {
    MainImageVariantPlacementPlan,
    MainImageVariantPlacementStrategy
} from './main-image-variant-placement-strategy';
import type {
    MainImageSkillDeliveryPlan,
    MainImageSkillEditableArtifact,
    MainImageSkillRasterArtifact
} from './main-image-skill-delivery-plan';
import {
    getMainImageChildCreationOrder,
    resolveMainImageProductionSizeKey
} from './main-image-production-spec';

export type MainImageProductionExecutionPlanStatus =
    | 'blocked_missing_production_structure'
    | 'blocked_missing_variant_placement_strategy'
    | 'blocked_missing_selected_asset'
    | 'blocked_missing_slot_asset_assignments'
    | 'blocked_missing_delivery_plan'
    | 'blocked_missing_placement_for_child_group'
    | 'ready_execution_plan'
    | 'ready_execution_plan_with_pending_confirmation';

export type MainImageProductionExecutionTool =
    | 'createDocument'
    | 'createGroup'
    | 'placeImage'
    | 'transformLayer'
    | 'exportGroup'
    | 'saveDocument';

export type MainImageProductionExecutionPhase =
    | 'document'
    | 'group'
    | 'asset'
    | 'transform'
    | 'export'
    | 'save';

export interface MainImageProductionExecutionOperation {
    id: string;
    phase: MainImageProductionExecutionPhase;
    tool: MainImageProductionExecutionTool;
    documentId?: string;
    documentName?: string;
    groupPath?: string[];
    assignmentKey?: string;
    variantId?: string;
    placementPlanId?: string;
    exportSpecId?: string;
    deliveryArtifactId?: string;
    asset?: {
        name?: string;
        path?: string;
        width?: number;
        height?: number;
    };
    canvasSize?: MainImageSize;
    exportSize?: MainImageSize;
    resolutionPpi?: number;
    colorMode?: 'RGB';
    bitDepth?: 8;
    backgroundColor?: 'white';
    canvasPolicy?: 'preserve_document_canvas';
    outputPath?: string;
    outputFormat?: 'psd' | 'psb' | 'png' | 'jpg' | 'jpeg';
    conflictPolicy?: 'fail_if_exists';
    destinationBox?: ImagePlacementBox;
    subjectDestinationBox?: ImagePlacementBox;
    scalePercent?: number;
    requiredReadback: Array<ImagePlacementRequiredReadback | 'documentInfo' | 'exportFile'>;
    sourceContextIds: string[];
    executionBoundary: string;
    actualBounds?: undefined;
}

export interface MainImageProductionExecutionDocumentPlan {
    id: string;
    name: string;
    ratio: string;
    canvasSize: MainImageSize;
    exportSize: MainImageSize;
    resolutionPpi: number;
    colorMode: 'RGB';
    bitDepth: 8;
    sizeProfileId: string;
    operations: MainImageProductionExecutionOperation[];
}

export interface MainImageProductionExecutionPlanInput {
    productionDocumentStructure?: MainImageProductionDocumentStructure | null;
    variantPlacementStrategy?: MainImageVariantPlacementStrategy | null;
    deliveryPlan?: MainImageSkillDeliveryPlan | null;
    outputDir?: string;
    allowPendingRatioExecution?: boolean;
}

export interface MainImageProductionExecutionPlan {
    version: 'main-image-production-execution-plan/v0';
    skillId: 'main-image-design';
    scene: 'ecommerce-socks';
    status: MainImageProductionExecutionPlanStatus;
    documents: MainImageProductionExecutionDocumentPlan[];
    exportSpecs: MainImageProductionExportSpec[];
    plannedOperationCount: number;
    pendingConfirmations: string[];
    canExecuteWithoutReview: boolean;
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

function makeBlockedPlan(input: {
    status: MainImageProductionExecutionPlanStatus;
    blocker: string;
    warning?: string;
}): MainImageProductionExecutionPlan {
    return {
        version: 'main-image-production-execution-plan/v0',
        skillId: 'main-image-design',
        scene: 'ecommerce-socks',
        status: input.status,
        documents: [],
        exportSpecs: [],
        plannedOperationCount: 0,
        pendingConfirmations: [],
        canExecuteWithoutReview: false,
        verificationPolicy: {
            requiredBeforePhotoshopExecution: [
                'ready_production_document_structure',
                'ready_variant_placement_strategy',
                'selected_asset_trace'
            ],
            requiredAfterPhotoshopExecution: [
                'document_info_readback',
                'group_tree_readback',
                'actual_bounds_readback',
                'export_file_readback',
                'editable_document_readback'
            ],
            qualityClaimBoundary: 'blocked execution plan cannot support Photoshop writes or quality claims'
        },
        canClaimOutputQuality: false,
        canClaimDesignComplete: false,
        noPhotoshopWrites: true,
        mustNotExecutePhotoshop: true,
        blockers: [input.blocker],
        warnings: input.warning ? [input.warning] : [],
        limitations: ['阻断状态下不生成 Photoshop 操作序列，避免伪造已执行设计能力。']
    };
}

function buildPlacementLookup(
    placementStrategy: MainImageVariantPlacementStrategy
): Map<string, MainImageVariantPlacementPlan> {
    const lookup = new Map<string, MainImageVariantPlacementPlan>();
    for (const plan of placementStrategy.variantPlacementPlans) {
        lookup.set(plan.assignmentKey, plan);
    }
    return lookup;
}

function getPendingConfirmations(
    productionStructure: MainImageProductionDocumentStructure
): string[] {
    const pending: string[] = [];
    for (const document of productionStructure.documents) {
        if (document.sourceLevel === 'project_preference_pending_confirmation') {
            pending.push(`第三比例 ${document.ratio} / ${document.name} 仍是项目偏好待确认，执行前需要用户或后台规范确认。`);
        }
    }
    return Array.from(new Set(pending));
}

function buildMissingPlacementBlockers(input: {
    productionStructure: MainImageProductionDocumentStructure;
    placementLookup: Map<string, MainImageVariantPlacementPlan>;
}): string[] {
    const missing: string[] = [];
    for (const document of input.productionStructure.documents) {
        for (const parentGroup of document.parentGroups) {
            for (const childGroup of parentGroup.childGroups) {
                if (childGroup.populationStatus !== 'assigned') continue;
                if (!childGroup.assignmentKey || !input.placementLookup.has(childGroup.assignmentKey)) {
                    missing.push(`${document.id}/${childGroup.id}`);
                }
            }
        }
    }
    return missing;
}

function makeOperation(input: Omit<MainImageProductionExecutionOperation, 'executionBoundary'>): MainImageProductionExecutionOperation {
    return {
        ...input,
        executionBoundary: 'planned operation only; live Photoshop execution must be performed by the executor and then read back results'
    };
}

function buildCreateDocumentOperation(
    document: MainImageProductionDocumentPlan
): MainImageProductionExecutionOperation {
    return makeOperation({
        id: `${document.id}-create-document`,
        phase: 'document',
        tool: 'createDocument',
        documentId: document.id,
        documentName: document.name,
        canvasSize: document.canvasSize,
        exportSize: document.exportSize,
        resolutionPpi: document.resolutionPpi,
        colorMode: document.colorMode,
        bitDepth: document.bitDepth,
        backgroundColor: document.backgroundLayer.fill,
        requiredReadback: ['documentInfo'],
        sourceContextIds: [document.id, document.sizeProfileId]
    });
}

function buildParentGroupOperation(input: {
    document: MainImageProductionDocumentPlan;
    groupName: string;
}): MainImageProductionExecutionOperation {
    return makeOperation({
        id: `${input.document.id}-group-${input.groupName}`,
        phase: 'group',
        tool: 'createGroup',
        documentId: input.document.id,
        documentName: input.document.name,
        groupPath: [input.groupName],
        requiredReadback: ['documentInfo'],
        sourceContextIds: [input.document.id, input.groupName]
    });
}

function buildChildGroupOperation(input: {
    document: MainImageProductionDocumentPlan;
    groupPath: string[];
    childGroupId: string;
    variantId: string;
}): MainImageProductionExecutionOperation {
    return makeOperation({
        id: `${input.document.id}-${input.childGroupId}-create-group`,
        phase: 'group',
        tool: 'createGroup',
        documentId: input.document.id,
        documentName: input.document.name,
        groupPath: input.groupPath,
        variantId: input.variantId,
        requiredReadback: ['documentInfo'],
        sourceContextIds: [input.document.id, input.childGroupId, input.variantId]
    });
}

function buildPlaceImageOperation(input: {
    document: MainImageProductionDocumentPlan;
    groupPath: string[];
    childGroupId: string;
    variantId: string;
    assignmentKey: string;
    placement: MainImageVariantPlacementPlan;
    asset: MainImageProductionExecutionOperation['asset'];
}): MainImageProductionExecutionOperation {
    return makeOperation({
        id: `${input.document.id}-${input.childGroupId}-place-image`,
        phase: 'asset',
        tool: 'placeImage',
        documentId: input.document.id,
        documentName: input.document.name,
        groupPath: input.groupPath,
        variantId: input.variantId,
        assignmentKey: input.assignmentKey,
        placementPlanId: input.placement.id,
        asset: input.asset,
        requiredReadback: ['documentInfo'],
        sourceContextIds: [input.document.id, input.childGroupId, input.variantId, input.placement.id]
    });
}

function buildTransformOperation(input: {
    document: MainImageProductionDocumentPlan;
    groupPath: string[];
    childGroupId: string;
    variantId: string;
    assignmentKey: string;
    placement: MainImageVariantPlacementPlan;
}): MainImageProductionExecutionOperation {
    return makeOperation({
        id: `${input.document.id}-${input.childGroupId}-transform`,
        phase: 'transform',
        tool: 'transformLayer',
        documentId: input.document.id,
        documentName: input.document.name,
        groupPath: input.groupPath,
        variantId: input.variantId,
        assignmentKey: input.assignmentKey,
        placementPlanId: input.placement.id,
        destinationBox: input.placement.placementPlan.execution.destinationBox,
        subjectDestinationBox: input.placement.placementPlan.execution.subjectDestinationBox,
        scalePercent: input.placement.placementPlan.execution.scalePercent,
        requiredReadback: input.placement.placementPlan.execution.requiredReadback,
        sourceContextIds: [input.document.id, input.childGroupId, input.variantId, input.placement.id]
    });
}

function buildExportOperation(input: {
    document: MainImageProductionDocumentPlan;
    groupPath: [string, string];
    childGroupId: string;
    variantId: string;
    assignmentKey: string;
    exportSpec?: MainImageProductionExportSpec;
    deliveryArtifact?: MainImageSkillRasterArtifact;
}): MainImageProductionExecutionOperation {
    return makeOperation({
        id: `${input.document.id}-${input.childGroupId}-export`,
        phase: 'export',
        tool: 'exportGroup',
        documentId: input.document.id,
        documentName: input.document.name,
        groupPath: input.groupPath,
        variantId: input.variantId,
        assignmentKey: input.assignmentKey,
        exportSpecId: input.exportSpec?.id,
        deliveryArtifactId: input.deliveryArtifact?.artifactId,
        exportSize: input.exportSpec?.exportSize || input.document.exportSize,
        outputPath: input.deliveryArtifact?.path,
        outputFormat: input.deliveryArtifact?.format,
        conflictPolicy: 'fail_if_exists',
        canvasPolicy: input.exportSpec?.canvasPolicy || 'preserve_document_canvas',
        requiredReadback: ['exportFile'],
        sourceContextIds: [
            input.document.id,
            input.childGroupId,
            input.variantId,
            input.exportSpec?.id || `${input.groupPath.join('/')}-export`
        ]
    });
}

function buildSaveDocumentOperation(input: {
    document: MainImageProductionDocumentPlan;
    deliveryArtifact?: MainImageSkillEditableArtifact;
}): MainImageProductionExecutionOperation {
    return makeOperation({
        id: `${input.document.id}-save-editable`,
        phase: 'save',
        tool: 'saveDocument',
        documentId: input.document.id,
        documentName: input.document.name,
        deliveryArtifactId: input.deliveryArtifact?.artifactId,
        outputPath: input.deliveryArtifact?.path,
        outputFormat: input.deliveryArtifact?.format,
        conflictPolicy: 'fail_if_exists',
        requiredReadback: ['documentInfo'],
        sourceContextIds: [
            input.document.id,
            input.deliveryArtifact?.artifactId || `${input.document.id}-editable-delivery`
        ]
    });
}

function findRasterDeliveryArtifact(input: {
    deliveryPlan: MainImageSkillDeliveryPlan;
    exportSpecId: string | undefined;
}): MainImageSkillRasterArtifact | undefined {
    if (!input.exportSpecId) return undefined;
    return input.deliveryPlan.artifacts.find((artifact): artifact is MainImageSkillRasterArtifact => (
        artifact.kind === 'raster_export' && artifact.exportSpecId === input.exportSpecId
    ));
}

function findEditableDeliveryArtifact(input: {
    deliveryPlan: MainImageSkillDeliveryPlan;
    documentId: string;
}): MainImageSkillEditableArtifact | undefined {
    return input.deliveryPlan.artifacts.find((artifact): artifact is MainImageSkillEditableArtifact => (
        artifact.kind === 'editable_document' && artifact.documentId === input.documentId
    ));
}

function findExportSpec(input: {
    productionStructure: MainImageProductionDocumentStructure;
    document: MainImageProductionDocumentPlan;
    groupPath: [string, string];
}): MainImageProductionExportSpec | undefined {
    return input.productionStructure.exportSpecs.find((spec) => (
        spec.documentId === input.document.id
        && spec.groupPath[0] === input.groupPath[0]
        && spec.groupPath[1] === input.groupPath[1]
    ));
}

function buildDocumentExecutionPlan(input: {
    document: MainImageProductionDocumentPlan;
    productionStructure: MainImageProductionDocumentStructure;
    placementLookup: Map<string, MainImageVariantPlacementPlan>;
    deliveryPlan: MainImageSkillDeliveryPlan;
}): MainImageProductionExecutionDocumentPlan {
    const operations: MainImageProductionExecutionOperation[] = [
        buildCreateDocumentOperation(input.document)
    ];
    const exportOperations: MainImageProductionExecutionOperation[] = [];
    for (const parentGroup of input.document.parentGroups) {
        operations.push(buildParentGroupOperation({
            document: input.document,
            groupName: parentGroup.name
        }));
        const sizeKey = resolveMainImageProductionSizeKey(input.document.sizeProfileId);
        const childCreationOrder = sizeKey
            ? getMainImageChildCreationOrder(
                sizeKey,
                parentGroup.name === '点击图' ? 'click' : 'conversion'
            )
            : parentGroup.childGroups.map((group) => group.name);
        const childGroupsByName = new Map(parentGroup.childGroups.map((group) => [group.name, group]));
        const orderedChildGroups = childCreationOrder
            .map((name) => childGroupsByName.get(name))
            .filter((group): group is typeof parentGroup.childGroups[number] => Boolean(group));
        for (const childGroup of orderedChildGroups) {
            const groupPath: [string, string] = [parentGroup.name, childGroup.name];
            operations.push(buildChildGroupOperation({
                document: input.document,
                groupPath,
                childGroupId: childGroup.id,
                variantId: childGroup.variantId
            }));
            if (childGroup.populationStatus !== 'assigned') continue;
            if (!childGroup.assignmentKey) continue;
            const placement = input.placementLookup.get(childGroup.assignmentKey);
            if (!placement) continue;
            operations.push(buildPlaceImageOperation({
                document: input.document,
                groupPath,
                childGroupId: childGroup.id,
                variantId: childGroup.variantId,
                assignmentKey: childGroup.assignmentKey,
                placement,
                asset: placement.asset
            }));
            operations.push(buildTransformOperation({
                document: input.document,
                groupPath,
                childGroupId: childGroup.id,
                variantId: childGroup.variantId,
                assignmentKey: childGroup.assignmentKey,
                placement
            }));
            const exportSpec = findExportSpec({
                productionStructure: input.productionStructure,
                document: input.document,
                groupPath
            });
            exportOperations.push(buildExportOperation({
                document: input.document,
                groupPath,
                childGroupId: childGroup.id,
                variantId: childGroup.variantId,
                assignmentKey: childGroup.assignmentKey,
                exportSpec,
                deliveryArtifact: findRasterDeliveryArtifact({
                    deliveryPlan: input.deliveryPlan,
                    exportSpecId: exportSpec?.id
                })
            }));
        }
    }
    // 同一可编辑主稿的全部图层完成后再连续导出，使一主稿多 raster
    // 真正绑定同一 Photoshop revision；不能在后续图层尚未完成时提前导出。
    operations.push(...exportOperations);
    operations.push(buildSaveDocumentOperation({
        document: input.document,
        deliveryArtifact: findEditableDeliveryArtifact({
            deliveryPlan: input.deliveryPlan,
            documentId: input.document.id
        })
    }));

    return {
        id: input.document.id,
        name: input.document.name,
        ratio: input.document.ratio,
        canvasSize: input.document.canvasSize,
        exportSize: input.document.exportSize,
        resolutionPpi: input.document.resolutionPpi,
        colorMode: input.document.colorMode,
        bitDepth: input.document.bitDepth,
        sizeProfileId: input.document.sizeProfileId,
        operations
    };
}

function buildWarnings(input: {
    productionStructure: MainImageProductionDocumentStructure;
    placementStrategy: MainImageVariantPlacementStrategy;
    pendingConfirmations: string[];
}): string[] {
    return Array.from(new Set([
        ...input.productionStructure.warnings,
        ...input.placementStrategy.warnings,
        ...input.pendingConfirmations,
        '当前只是 Photoshop 操作计划；执行后必须读回文档、组、bounds、导出文件和截图/像素检查结果。'
    ].map(cleanString).filter(Boolean)));
}

export function buildMainImageProductionExecutionPlan(
    input: MainImageProductionExecutionPlanInput
): MainImageProductionExecutionPlan {
    const productionStructure = input.productionDocumentStructure;
    if (!productionStructure || productionStructure.status !== 'ready_production_document_structure') {
        return makeBlockedPlan({
            status: 'blocked_missing_production_structure',
            blocker: 'ready_main_image_production_document_structure_required'
        });
    }

    const placementStrategy = input.variantPlacementStrategy;
    if (!placementStrategy || placementStrategy.status !== 'ready_variant_placement_plan') {
        return makeBlockedPlan({
            status: 'blocked_missing_variant_placement_strategy',
            blocker: 'ready_main_image_variant_placement_strategy_required'
        });
    }

    const deliveryPlan = input.deliveryPlan;
    if (!deliveryPlan || deliveryPlan.status !== 'ready' || !deliveryPlan.deliveryPlanDigest) {
        return makeBlockedPlan({
            status: 'blocked_missing_delivery_plan',
            blocker: deliveryPlan?.blockers[0] || 'ready_main_image_skill_delivery_plan_required'
        });
    }

    const placementLookup = buildPlacementLookup(placementStrategy);
    const missingPlacementBlockers = buildMissingPlacementBlockers({
        productionStructure,
        placementLookup
    });
    if (missingPlacementBlockers.length > 0) {
        return makeBlockedPlan({
            status: 'blocked_missing_placement_for_child_group',
            blocker: `missing_placement_for_child_groups=${missingPlacementBlockers.slice(0, 8).join(',')}`,
            warning: `缺少 ${missingPlacementBlockers.length} 个子组对应的置入计划，不能生成 Photoshop 执行顺序。`
        });
    }

    const documents = productionStructure.documents.map((document) => buildDocumentExecutionPlan({
        document,
        productionStructure,
        placementLookup,
        deliveryPlan
    }));
    const plannedOperationCount = documents.reduce((total, document) => total + document.operations.length, 0);
    const pendingConfirmations = getPendingConfirmations(productionStructure);
    const status: MainImageProductionExecutionPlanStatus = pendingConfirmations.length > 0
        ? 'ready_execution_plan_with_pending_confirmation'
        : 'ready_execution_plan';
    const canExecuteWithoutReview = status === 'ready_execution_plan' || input.allowPendingRatioExecution === true;

    return {
        version: 'main-image-production-execution-plan/v0',
        skillId: 'main-image-design',
        scene: 'ecommerce-socks',
        status,
        documents,
        exportSpecs: productionStructure.exportSpecs,
        plannedOperationCount,
        pendingConfirmations,
        canExecuteWithoutReview,
        verificationPolicy: {
            requiredBeforePhotoshopExecution: [
                'ready_production_document_structure',
                'ready_variant_placement_strategy',
                'variant_scoped_asset_assignments',
                'pending_ratio_confirmation_if_present'
            ],
            requiredAfterPhotoshopExecution: [
                'document_info_readback',
                'group_tree_readback',
                'actual_bounds_readback',
                'clipping_state_readback',
                'export_file_readback',
                'editable_document_readback',
                'screenshot_or_pixel_probe'
            ],
            qualityClaimBoundary: '执行计划只证明下一步操作顺序合理；只有执行后读回结果才能进入主图质量验收。'
        },
        canClaimOutputQuality: false,
        canClaimDesignComplete: false,
        noPhotoshopWrites: true,
        mustNotExecutePhotoshop: true,
        blockers: [],
        warnings: buildWarnings({
            productionStructure,
            placementStrategy,
            pendingConfirmations
        }),
        limitations: [
            '执行计划不创建文档、不创建组、不置入图片、不导出文件。',
            '每个内容操作只消费对应 slot assignment 的素材与几何；没有逐槽 assignment 时只允许建立空骨架。',
            'destinationBox 是计划目标，不是 Photoshop actualBounds。',
            '第三比例未确认时，计划可以保留但不能自动作为官方规格执行。',
            '该计划只覆盖主图生产结构，详情页和 SKU 必须接入各自子 skill 后再扩展。'
        ]
    };
}
