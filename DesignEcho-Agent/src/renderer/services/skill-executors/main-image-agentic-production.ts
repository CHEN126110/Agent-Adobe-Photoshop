import type { VerificationReport } from '../../../shared/design-agent-os-contracts';
import type {
    MainImageLiveExecutorOperationRequest,
    MainImageLiveExecutorRequestPackage
} from '../../../shared/main-image-live-executor-request';
import type { MainImageLiveExecutorRunResult } from '../../../shared/main-image-live-executor-runner';
import type {
    MainImageProductionDocumentPlan,
    MainImageProductionDocumentStructure,
    MainImageProductionExportSpec
} from '../../../shared/main-image-production-document-structure';
import type {
    MainImageSkillDeliveryPlan,
    MainImageSkillEditableArtifact,
    MainImageSkillRasterArtifact
} from '../../../shared/main-image-skill-delivery-plan';
import {
    readPhotoshopHistoryStateRef,
    type PhotoshopHistoryStateRef
} from '../../../shared/photoshop-history-state-ref';
import type {
    MainImageAgenticWorkspaceDocumentBinding,
    MainImageAgenticWorkspaceGroupBinding,
    MainImageAgenticWorkspaceLease
} from './main-image-agentic-workspace';

export type MainImageAgenticProductionAction = 'prepare' | 'finalize';

export interface MainImageAgenticPreparedDocumentInspection {
    status: 'ready' | 'blocked';
    document?: MainImageAgenticWorkspaceDocumentBinding;
    blockers: string[];
}

export interface MainImageAgenticFinalizedGroup {
    groupPath: [string, string];
    layerId: number;
    childGroupId: string;
    imageType: 'click' | 'conversion';
}

export interface MainImageAgenticFinalInspection {
    status: 'ready' | 'blocked';
    currentHistoryStateRef?: PhotoshopHistoryStateRef;
    finalizedGroups: MainImageAgenticFinalizedGroup[];
    blockers: string[];
}

interface HierarchyNode {
    id: number;
    name: string;
    path: string;
    kind: string;
    parentId: number | null;
    isBackgroundLayer: boolean;
    locked: boolean;
}

const FINAL_READBACK_TOOLS = [
    'getDocumentInfo',
    'getLayerHierarchy',
    'getLayerProperties',
    'getAcceptanceSnapshot'
];

function cleanString(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function readRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
}

function readPositiveInteger(value: unknown): number | undefined {
    const numeric = Number(value);
    if (!Number.isSafeInteger(numeric) || numeric <= 0) return undefined;
    return numeric;
}

function readDocumentRecord(value: unknown): Record<string, unknown> {
    const root = readRecord(value);
    const data = readRecord(root.data);
    const rootDocument = readRecord(root.document);
    const dataDocument = readRecord(data.document);
    return {
        ...data,
        ...dataDocument,
        ...rootDocument,
        ...root
    };
}

function readHierarchyNodes(value: unknown): HierarchyNode[] {
    const root = readRecord(value);
    const data = readRecord(root.data);
    let rawNodes: unknown[] = [];
    if (Array.isArray(root.flatList)) {
        rawNodes = root.flatList;
    } else if (Array.isArray(data.flatList)) {
        rawNodes = data.flatList;
    }
    return rawNodes.flatMap((value): HierarchyNode[] => {
        const node = readRecord(value);
        const id = readPositiveInteger(node.id);
        const path = cleanString(node.path);
        const parentId = node.parentId === null ? null : readPositiveInteger(node.parentId);
        if (!id || !path || parentId === undefined) return [];
        return [{
            id,
            name: cleanString(node.name),
            path,
            kind: cleanString(node.kind).toLowerCase(),
            parentId,
            isBackgroundLayer: node.isBackgroundLayer === true,
            locked: node.locked === true
        }];
    });
}

function sameHistoryStateRef(
    left: PhotoshopHistoryStateRef,
    right: PhotoshopHistoryStateRef
): boolean {
    return left.documentId === right.documentId
        && left.historyStateId === right.historyStateId;
}

function documentNameMatches(expected: string, actual: string): boolean {
    const normalize = (value: string): string => value.replace(/\.(psd|psb)$/i, '').toLowerCase();
    const expectedName = normalize(cleanString(expected));
    const actualName = normalize(cleanString(actual));
    return expectedName === actualName
        || actualName.startsWith(`${expectedName} `)
        || actualName.startsWith(`${expectedName}-`)
        || actualName.startsWith(`${expectedName}_`);
}

function listExpectedGroupPaths(
    document: MainImageProductionDocumentPlan
): Array<[string, string?]> {
    const paths: Array<[string, string?]> = [];
    for (const parent of document.parentGroups) {
        paths.push([parent.name]);
        for (const child of parent.childGroups) {
            paths.push([parent.name, child.name]);
        }
    }
    return paths;
}

function buildPrepareVerificationReport(
    source: MainImageLiveExecutorRequestPackage,
    operationCount: number
): VerificationReport {
    return {
        ...source.verificationReport,
        reportId: 'main-image-agentic-prepare-request',
        status: operationCount > 0 ? 'passed' : 'failed',
        summary: operationCount > 0
            ? `主图 Agent 工作文档准备请求包含 ${operationCount} 个建档/建组操作；不包含设计、保存或导出。`
            : '主图 Agent 工作文档准备请求没有可执行的建档/建组操作。',
        checks: [
            {
                id: 'prepare-operation-scope',
                label: 'Agent 工作文档准备边界',
                status: operationCount > 0 ? 'passed' : 'failed',
                summary: `createDocument/createGroup operations=${operationCount}; design/save/export=0`
            }
        ],
        blockers: operationCount > 0 ? [] : ['main_image_agentic_prepare_operations_missing'],
        limitations: [
            'prepare 只创建一个标准工作文档和空图层组，不置入素材、不排版、不保存、不导出。',
            '画面内容必须由同一 Agent 在 prepare 返回后通过通用 Photoshop 工具完成。'
        ]
    };
}

export function normalizeMainImageAgenticProductionAction(
    value: unknown
): MainImageAgenticProductionAction | undefined {
    if (value === 'prepare' || value === 'finalize') return value;
    return undefined;
}

export function buildMainImageAgenticPrepareRequestPackage(
    source: MainImageLiveExecutorRequestPackage | null | undefined
): MainImageLiveExecutorRequestPackage | null {
    if (!source
        || source.status !== 'ready_for_executor_dispatch'
        || source.canDispatchLiveExecutor !== true) {
        return null;
    }
    const operationRequests = source.operationRequests.filter((request) => (
        request.tool === 'createDocument' || request.tool === 'createGroup'
    ));
    const createDocumentCount = operationRequests.filter((request) => request.tool === 'createDocument').length;
    if (createDocumentCount !== 1 || operationRequests.length < 2) return null;
    return {
        ...source,
        requestLabel: 'main-image-agentic-workspace-prepare',
        operationRequests,
        operationCount: operationRequests.length,
        acceptancePlan: {
            ...source.acceptancePlan,
            requiredReadbackTools: FINAL_READBACK_TOOLS,
            requiredReadback: ['documentInfo', 'layerHierarchy', 'screenshot'],
            requiresActualBounds: false,
            requiresAcceptanceSnapshot: true,
            boundary: 'prepare only proves one exact Photoshop document and its empty standard groups; it cannot prove design or delivery.'
        },
        blockers: [],
        warnings: Array.from(new Set([
            ...source.warnings,
            '本请求只准备 Agent 设计工作区；中间设计内容不由 Skill 或 Harness 生成。'
        ])),
        limitations: [
            ...source.limitations,
            'prepare 已从原生产队列中移除 place/transform/save/export；文件交付只能由后续 finalize 完成。'
        ],
        verificationReport: buildPrepareVerificationReport(source, operationRequests.length)
    };
}

export function inspectMainImageAgenticPreparedDocument(input: {
    productionDocument: MainImageProductionDocumentPlan;
    expectedDocumentId: number;
    documentInfoResult: unknown;
    hierarchyResult: unknown;
}): MainImageAgenticPreparedDocumentInspection {
    const blockers: string[] = [];
    const documentRecord = readDocumentRecord(input.documentInfoResult);
    const documentInfoHistory = readPhotoshopHistoryStateRef(input.documentInfoResult);
    const hierarchyHistory = readPhotoshopHistoryStateRef(input.hierarchyResult);
    const documentId = readPositiveInteger(documentRecord.id)
        || readPositiveInteger(documentRecord.documentId)
        || documentInfoHistory?.documentId;
    const documentName = cleanString(documentRecord.name);
    const width = readPositiveInteger(documentRecord.width);
    const height = readPositiveInteger(documentRecord.height);
    if (!readPositiveInteger(input.expectedDocumentId)) {
        blockers.push('main_image_agentic_prepare_created_document_receipt_missing');
    } else if (documentId !== input.expectedDocumentId) {
        blockers.push('main_image_agentic_prepare_created_document_mismatch');
    }
    if (!documentId || !documentInfoHistory || !hierarchyHistory) {
        blockers.push('main_image_agentic_prepare_document_identity_missing');
    } else if (!sameHistoryStateRef(documentInfoHistory, hierarchyHistory)) {
        blockers.push('main_image_agentic_prepare_readback_revision_changed');
    }
    if (!documentNameMatches(input.productionDocument.name, documentName)) {
        blockers.push('main_image_agentic_prepare_document_name_mismatch');
    }
    if (width !== input.productionDocument.canvasSize.width
        || height !== input.productionDocument.canvasSize.height) {
        blockers.push('main_image_agentic_prepare_canvas_mismatch');
    }
    const nodes = readHierarchyNodes(input.hierarchyResult);
    const background = nodes.find((node) => node.isBackgroundLayer);
    // Photoshop 会按宿主语言把同一背景层读成「背景」或 "Background"；
    // 身份应由 isBackgroundLayer + locked + layerId 证明，不能把本地化名称当协议。
    if (!background || !background.locked) {
        blockers.push('main_image_agentic_prepare_background_layer_missing');
    }
    const groups: MainImageAgenticWorkspaceGroupBinding[] = [];
    for (const path of listExpectedGroupPaths(input.productionDocument)) {
        const pathText = path.filter(Boolean).join('/');
        const node = nodes.find((candidate) => candidate.path === pathText);
        if (!node || node.kind !== 'group') {
            blockers.push(`main_image_agentic_prepare_group_missing:${pathText}`);
            continue;
        }
        groups.push({ path: path.filter(Boolean) as string[], layerId: node.id });
    }
    const expectedGroupCount = listExpectedGroupPaths(input.productionDocument).length;
    if (groups.length !== expectedGroupCount) {
        blockers.push('main_image_agentic_prepare_group_set_incomplete');
    }
    if (blockers.length > 0
        || !documentId
        || !documentInfoHistory
        || !background) {
        return { status: 'blocked', blockers: Array.from(new Set(blockers)) };
    }
    return {
        status: 'ready',
        document: {
            logicalDocumentId: input.productionDocument.id,
            documentId,
            documentName: input.productionDocument.name,
            canvasSize: { ...input.productionDocument.canvasSize },
            backgroundLayerId: background.id,
            groups,
            preparedHistoryStateRef: documentInfoHistory
        },
        blockers: []
    };
}

export function readMainImageAgenticPreparedDocumentId(
    runner: MainImageLiveExecutorRunResult
): number | undefined {
    const createDocumentResult = runner.operationResults.find((operation) => (
        operation.tool === 'createDocument' && operation.success
    ));
    if (!createDocumentResult) return undefined;
    const documentIds = Array.from(new Set(
        createDocumentResult.readbackResults
            .filter((readback) => readback.success && readback.toolName === 'getDocumentInfo')
            .map((readback) => readPhotoshopHistoryStateRef(readback.data)?.documentId)
            .filter((documentId): documentId is number => Boolean(readPositiveInteger(documentId)))
    ));
    return documentIds.length === 1 ? documentIds[0] : undefined;
}

export function inspectMainImageAgenticFinalDocument(input: {
    workspace: MainImageAgenticWorkspaceLease;
    documentInfoResult: unknown;
    hierarchyResult: unknown;
}): MainImageAgenticFinalInspection {
    const blockers: string[] = [];
    const expectedDocument = input.workspace.document;
    const documentRecord = readDocumentRecord(input.documentInfoResult);
    const documentInfoHistory = readPhotoshopHistoryStateRef(input.documentInfoResult);
    const hierarchyHistory = readPhotoshopHistoryStateRef(input.hierarchyResult);
    const documentId = readPositiveInteger(documentRecord.id)
        || readPositiveInteger(documentRecord.documentId)
        || documentInfoHistory?.documentId;
    if (!documentInfoHistory || !hierarchyHistory || !documentId) {
        blockers.push('main_image_agentic_finalize_document_identity_missing');
    } else if (!sameHistoryStateRef(documentInfoHistory, hierarchyHistory)) {
        blockers.push('main_image_agentic_finalize_readback_revision_changed');
    } else if (documentId !== expectedDocument.documentId) {
        blockers.push('main_image_agentic_finalize_document_mismatch');
    } else if (sameHistoryStateRef(documentInfoHistory, expectedDocument.preparedHistoryStateRef)) {
        blockers.push('main_image_agentic_finalize_design_revision_unchanged');
    }
    if (!documentNameMatches(expectedDocument.documentName, cleanString(documentRecord.name))) {
        blockers.push('main_image_agentic_finalize_document_name_mismatch');
    }
    if (readPositiveInteger(documentRecord.width) !== expectedDocument.canvasSize.width
        || readPositiveInteger(documentRecord.height) !== expectedDocument.canvasSize.height) {
        blockers.push('main_image_agentic_finalize_canvas_mismatch');
    }
    const nodes = readHierarchyNodes(input.hierarchyResult);
    const nodeByPath = new Map(nodes.map((node) => [node.path, node]));
    const background = nodes.find((node) => node.id === expectedDocument.backgroundLayerId);
    if (!background || !background.isBackgroundLayer || !background.locked) {
        blockers.push('main_image_agentic_finalize_background_identity_mismatch');
    }
    for (const binding of expectedDocument.groups) {
        const path = binding.path.join('/');
        const node = nodeByPath.get(path);
        if (!node || node.kind !== 'group' || node.id !== binding.layerId) {
            blockers.push(`main_image_agentic_finalize_group_identity_mismatch:${path}`);
        }
    }
    const finalizedGroups: MainImageAgenticFinalizedGroup[] = [];
    for (const parent of input.workspace.productionDocument.parentGroups) {
        for (const child of parent.childGroups) {
            const groupPath: [string, string] = [parent.name, child.name];
            const pathText = groupPath.join('/');
            const groupNode = nodeByPath.get(pathText);
            if (!groupNode || groupNode.kind !== 'group') continue;
            const hasAuthoredContent = nodes.some((node) => (
                node.path.startsWith(`${pathText}/`)
                && node.kind !== 'group'
                && !node.isBackgroundLayer
            ));
            if (!hasAuthoredContent) continue;
            finalizedGroups.push({
                groupPath,
                layerId: groupNode.id,
                childGroupId: child.id,
                imageType: child.imageType
            });
        }
    }
    if (finalizedGroups.length === 0) {
        blockers.push('main_image_agentic_finalize_no_nonempty_standard_group');
    }
    return {
        status: blockers.length === 0 ? 'ready' : 'blocked',
        ...(documentInfoHistory ? { currentHistoryStateRef: documentInfoHistory } : {}),
        finalizedGroups,
        blockers: Array.from(new Set(blockers))
    };
}

export function buildMainImageAgenticFinalProductionStructure(input: {
    workspace: MainImageAgenticWorkspaceLease;
    finalizedGroups: MainImageAgenticFinalizedGroup[];
}): MainImageProductionDocumentStructure {
    const document = input.workspace.productionDocument;
    const exportSpecs: MainImageProductionExportSpec[] = input.finalizedGroups.map((group) => ({
        id: `${document.id}-${group.childGroupId}-agentic-export`,
        documentId: document.id,
        documentName: document.name,
        groupPath: [...group.groupPath],
        exportSize: { ...document.exportSize },
        fileName: `${group.groupPath[1]}.jpg`,
        imageType: group.imageType,
        canvasPolicy: 'preserve_document_canvas',
        qualityBoundary: '只导出同一 TaskRun 中 Agent 已实际填充且经 Photoshop 层级读回确认的标准组；视觉质量仍由 Agent 看真实结果判断。'
    }));
    return {
        version: 'main-image-production-document-structure/v0',
        skillId: 'main-image-design',
        scene: 'ecommerce-socks',
        status: 'ready_production_document_structure',
        platform: document.platform,
        slotAssignments: [],
        documents: [document],
        exportSpecs,
        verificationPolicy: {
            requiredBeforePhotoshopExecution: [
                'same_runtime_task_workspace',
                'exact_document_and_group_identity',
                'agent_authored_nonempty_group'
            ],
            requiredAfterPhotoshopExecution: [
                'editable_file_exists',
                'raster_files_exist',
                'all_files_share_same_photoshop_revision'
            ],
            qualityClaimBoundary: '文件交付完成不等于视觉质量通过；主 Agent 必须查看真实导出图后判断。'
        },
        canClaimOutputQuality: false,
        canClaimDesignComplete: false,
        noPhotoshopWrites: true,
        mustNotExecutePhotoshop: true,
        blockers: [],
        warnings: [],
        limitations: [
            '该结构只从真实 Photoshop 层级读回投影非空标准组，不推断画面审美。'
        ]
    };
}

function buildFinalizeVerificationReport(operationCount: number): VerificationReport {
    return {
        reportId: 'main-image-agentic-finalize-request',
        scenario: 'main-image',
        status: operationCount > 1 ? 'needs_review' : 'failed',
        scope: 'task',
        summary: operationCount > 1
            ? `同一 TaskRun 的主图工作文档已形成 ${operationCount - 1} 个非空组导出和 1 个可编辑稿保存请求。`
            : '主图 Agent 工作文档没有形成可交付的非空组。',
        checks: [
            {
                id: 'finalize-artifact-set',
                label: 'Agent 主图交付文件集合',
                status: operationCount > 1 ? 'needs_review' : 'failed',
                summary: `raster=${Math.max(0, operationCount - 1)}; editable=${operationCount > 0 ? 1 : 0}`
            }
        ],
        blockers: operationCount > 1 ? [] : ['main_image_agentic_finalize_artifacts_missing'],
        warnings: [],
        limitations: [
            '请求包只声明保存与导出；真实文件身份、路径、字节和 Photoshop revision 必须由 staged delivery 事务验证。'
        ]
    };
}

function makeFinalizeRequest(input: {
    id: string;
    requestId: string;
    tool: 'exportGroup' | 'saveDocument';
    phase: 'export' | 'save';
    document: MainImageProductionDocumentPlan;
    groupPath?: [string, string];
    payloadPreview: Record<string, unknown>;
    sourceContextIds: string[];
}): MainImageLiveExecutorOperationRequest {
    return {
        id: input.id,
        sourceDryRunId: `agentic-finalize:${input.requestId}`,
        requestId: input.requestId,
        tool: input.tool,
        phase: input.phase,
        documentId: input.document.id,
        documentName: input.document.name,
        ...(input.groupPath ? { groupPath: [...input.groupPath] } : {}),
        payloadPreview: { ...input.payloadPreview },
        requiredReadback: input.tool === 'exportGroup' ? ['exportFile'] : ['documentInfo'],
        requiredPostRunReadbackTools: input.tool === 'exportGroup'
            ? ['getAcceptanceSnapshot']
            : ['getDocumentInfo'],
        sourceContextIds: [...input.sourceContextIds],
        dispatchBoundary: 'Agent-authored content already exists; this request only performs exact staged save/export for the same TaskRun workspace.',
        actualResult: null
    };
}

export function buildMainImageAgenticFinalizeRequestPackage(input: {
    workspaceRef: string;
    productionStructure: MainImageProductionDocumentStructure;
    deliveryPlan: MainImageSkillDeliveryPlan;
}): MainImageLiveExecutorRequestPackage | null {
    const document = input.productionStructure.documents[0];
    if (!document
        || input.productionStructure.documents.length !== 1
        || input.deliveryPlan.status !== 'ready'
        || !input.deliveryPlan.typedPlan
        || !input.deliveryPlan.deliveryPlanDigest) {
        return null;
    }
    const operationRequests: MainImageLiveExecutorOperationRequest[] = [];
    for (const exportSpec of input.productionStructure.exportSpecs) {
        const artifact = input.deliveryPlan.artifacts.find((candidate): candidate is MainImageSkillRasterArtifact => (
            candidate.kind === 'raster_export' && candidate.exportSpecId === exportSpec.id
        ));
        if (!artifact) return null;
        operationRequests.push(makeFinalizeRequest({
            id: `agentic-finalize-${String(operationRequests.length + 1).padStart(3, '0')}-${exportSpec.id}`,
            requestId: `${exportSpec.id}-agentic-finalize-export`,
            tool: 'exportGroup',
            phase: 'export',
            document,
            groupPath: exportSpec.groupPath,
            payloadPreview: {
                documentId: document.id,
                documentName: document.name,
                groupPath: [...exportSpec.groupPath],
                exportSpecId: exportSpec.id,
                deliveryArtifactId: artifact.artifactId,
                exportSize: { ...exportSpec.exportSize },
                outputPath: artifact.path,
                format: artifact.format === 'jpeg' ? 'jpg' : artifact.format,
                conflictPolicy: 'fail_if_exists',
                canvasPolicy: exportSpec.canvasPolicy
            },
            sourceContextIds: [input.workspaceRef, document.id, exportSpec.id, artifact.artifactId]
        }));
    }
    const editableArtifact = input.deliveryPlan.artifacts.find((candidate): candidate is MainImageSkillEditableArtifact => (
        candidate.kind === 'editable_document' && candidate.documentId === document.id
    ));
    if (!editableArtifact || operationRequests.length === 0) return null;
    operationRequests.push(makeFinalizeRequest({
        id: `agentic-finalize-${String(operationRequests.length + 1).padStart(3, '0')}-${document.id}-save-editable`,
        requestId: `${document.id}-save-editable`,
        tool: 'saveDocument',
        phase: 'save',
        document,
        payloadPreview: {
            documentId: document.id,
            documentName: document.name,
            deliveryArtifactId: editableArtifact.artifactId,
            outputPath: editableArtifact.path,
            format: editableArtifact.format,
            conflictPolicy: 'fail_if_exists'
        },
        sourceContextIds: [input.workspaceRef, document.id, editableArtifact.artifactId]
    }));
    return {
        version: 'main-image-live-executor-request/v0',
        skillId: 'main-image-design',
        scene: 'ecommerce-socks',
        status: 'ready_for_executor_dispatch',
        requestLabel: 'main-image-agentic-workspace-finalize',
        canDispatchLiveExecutor: true,
        noPhotoshopWrites: true,
        mustNotExecutePhotoshop: true,
        canClaimOutputQuality: false,
        canClaimDesignComplete: false,
        operationRequests,
        operationCount: operationRequests.length,
        acceptancePlan: {
            requiredReadbackTools: FINAL_READBACK_TOOLS,
            requiredReadback: ['documentInfo', 'exportFile', 'screenshot'],
            requiresActualBounds: false,
            requiresAcceptanceSnapshot: true,
            requiresQaReport: true,
            requiresManualReviewBeforeQualityClaim: true,
            boundary: 'File delivery can close only after exact staged bytes and the same Photoshop source revision are verified.'
        },
        blockers: [],
        warnings: [],
        limitations: [
            'finalize 不修改设计内容，只保存同一文档并导出真实非空标准组。',
            '文件交付成功不代表视觉质量通过，主 Agent 仍需查看导出图。'
        ],
        verificationReport: buildFinalizeVerificationReport(operationRequests.length)
    };
}
