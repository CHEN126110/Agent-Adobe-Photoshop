import {
    validateRuntimeSessionIdentity,
    type RuntimeSessionIdentity
} from '../../../shared/agent-runtime-v5/runtime-session';
import type { MainImageProductionDocumentPlan } from '../../../shared/main-image-production-document-structure';
import type { PhotoshopHistoryStateRef } from '../../../shared/photoshop-history-state-ref';

const MAIN_IMAGE_AGENTIC_WORKSPACE_VERSION = 'main-image-agentic-workspace/v0' as const;
const MAIN_IMAGE_AGENTIC_WORKSPACE_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_ACTIVE_MAIN_IMAGE_AGENTIC_WORKSPACES = 16;

export interface MainImageAgenticWorkspaceGroupBinding {
    path: string[];
    layerId: number;
}

export interface MainImageAgenticWorkspaceDocumentBinding {
    logicalDocumentId: string;
    documentId: number;
    documentName: string;
    canvasSize: {
        width: number;
        height: number;
    };
    backgroundLayerId: number;
    groups: MainImageAgenticWorkspaceGroupBinding[];
    preparedHistoryStateRef: PhotoshopHistoryStateRef;
}

export interface MainImageAgenticWorkspaceReceipt {
    version: typeof MAIN_IMAGE_AGENTIC_WORKSPACE_VERSION;
    workspaceRef: string;
    status: 'prepared';
    document: MainImageAgenticWorkspaceDocumentBinding;
    expiresAt: string;
    boundaries: {
        identityOnly: true;
        grantsPermission: false;
        executesTools: false;
        changesTaskResult: false;
        requiresSameRuntimeTask: true;
        requiresLivePhotoshopReadback: true;
    };
}

export interface MainImageAgenticWorkspaceLease extends MainImageAgenticWorkspaceReceipt {
    projectPath: string;
    runtimeTaskIdentity: RuntimeSessionIdentity;
    productionDocument: MainImageProductionDocumentPlan;
    createdAt: string;
}

export interface CreateMainImageAgenticWorkspaceInput {
    runtimeTaskIdentity?: RuntimeSessionIdentity;
    projectPath?: string;
    document?: MainImageAgenticWorkspaceDocumentBinding;
    productionDocument?: MainImageProductionDocumentPlan;
    now?: Date;
}

export type CreateMainImageAgenticWorkspaceResult =
    | {
        status: 'ready';
        receipt: MainImageAgenticWorkspaceReceipt;
    }
    | {
        status: 'blocked';
        blockers: string[];
    };

export interface ResolveMainImageAgenticWorkspaceInput {
    workspaceRef?: string;
    runtimeTaskIdentity?: RuntimeSessionIdentity;
    projectPath?: string;
    now?: Date;
}

export type ResolveMainImageAgenticWorkspaceResult =
    | {
        status: 'ready';
        lease: MainImageAgenticWorkspaceLease;
    }
    | {
        status: 'blocked';
        blockers: string[];
    };

const workspaceLeases = new Map<string, MainImageAgenticWorkspaceLease>();

function cleanString(value: unknown): string {
    return String(value || '').trim();
}

function normalizePath(value: unknown): string {
    return cleanString(value).replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase();
}

function isPositiveInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function isMainImageAgenticRuntimeTaskIdentity(
    value: RuntimeSessionIdentity | undefined
): value is RuntimeSessionIdentity {
    return validateRuntimeSessionIdentity(value).ok;
}

function sameRuntimeTaskIdentity(
    left: RuntimeSessionIdentity,
    right: RuntimeSessionIdentity
): boolean {
    return left.version === right.version
        // RuntimeSession generation 会为 Reflexion 更换 runId/generation，但 taskRunId
        // 在现有单一 owner 中稳定等于 sessionId。workspace 必须跟随同一 TaskRun，
        // 不能被某一代模型回合锁死；项目/document/group/revision 另行精确校验。
        && left.sessionId === right.sessionId;
}

function normalizeGroupBindings(
    groups: MainImageAgenticWorkspaceGroupBinding[]
): MainImageAgenticWorkspaceGroupBinding[] | null {
    if (!Array.isArray(groups) || groups.length === 0 || groups.length > 32) return null;
    const seenPaths = new Set<string>();
    const seenLayerIds = new Set<number>();
    const normalized: MainImageAgenticWorkspaceGroupBinding[] = [];
    for (const group of groups) {
        const path = Array.isArray(group?.path)
            ? group.path.map(cleanString).filter(Boolean)
            : [];
        const pathKey = path.join('/').toLowerCase();
        if (path.length === 0
            || !pathKey
            || seenPaths.has(pathKey)
            || !isPositiveInteger(group?.layerId)
            || seenLayerIds.has(group.layerId)) {
            return null;
        }
        seenPaths.add(pathKey);
        seenLayerIds.add(group.layerId);
        normalized.push({ path, layerId: group.layerId });
    }
    return normalized;
}

function normalizeDocumentBinding(
    document: MainImageAgenticWorkspaceDocumentBinding | undefined
): MainImageAgenticWorkspaceDocumentBinding | null {
    if (!document
        || !cleanString(document.logicalDocumentId)
        || !isPositiveInteger(document.documentId)
        || !cleanString(document.documentName)
        || !isPositiveInteger(document.canvasSize?.width)
        || !isPositiveInteger(document.canvasSize?.height)
        || !isPositiveInteger(document.backgroundLayerId)
        || document.preparedHistoryStateRef?.documentId !== document.documentId
        || !isPositiveInteger(document.preparedHistoryStateRef?.historyStateId)) {
        return null;
    }
    const groups = normalizeGroupBindings(document.groups);
    if (!groups) return null;
    return {
        logicalDocumentId: cleanString(document.logicalDocumentId),
        documentId: document.documentId,
        documentName: cleanString(document.documentName),
        canvasSize: {
            width: document.canvasSize.width,
            height: document.canvasSize.height
        },
        backgroundLayerId: document.backgroundLayerId,
        groups,
        preparedHistoryStateRef: { ...document.preparedHistoryStateRef }
    };
}

function createWorkspaceRef(): string | null {
    const cryptoApi = globalThis.crypto;
    if (typeof cryptoApi?.randomUUID === 'function') {
        return `main-image-workspace:${cryptoApi.randomUUID()}`;
    }
    if (typeof cryptoApi?.getRandomValues !== 'function') return null;
    const bytes = new Uint8Array(24);
    cryptoApi.getRandomValues(bytes);
    return `main-image-workspace:${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function copyDocumentBinding(
    document: MainImageAgenticWorkspaceDocumentBinding
): MainImageAgenticWorkspaceDocumentBinding {
    return {
        ...document,
        canvasSize: { ...document.canvasSize },
        groups: document.groups.map((group) => ({
            path: [...group.path],
            layerId: group.layerId
        })),
        preparedHistoryStateRef: { ...document.preparedHistoryStateRef }
    };
}

function copyProductionDocument(
    document: MainImageProductionDocumentPlan
): MainImageProductionDocumentPlan {
    return {
        ...document,
        canvasSize: { ...document.canvasSize },
        exportSize: { ...document.exportSize },
        backgroundLayer: { ...document.backgroundLayer },
        parentGroupPanelOrderTopDown: [...document.parentGroupPanelOrderTopDown],
        parentGroups: document.parentGroups.map((parent) => ({
            ...parent,
            childGroups: parent.childGroups.map((child) => ({
                ...child,
                requiredInputs: [...child.requiredInputs]
            }))
        })) as MainImageProductionDocumentPlan['parentGroups']
    };
}

function toPublicReceipt(lease: MainImageAgenticWorkspaceLease): MainImageAgenticWorkspaceReceipt {
    return {
        version: lease.version,
        workspaceRef: lease.workspaceRef,
        status: 'prepared',
        document: copyDocumentBinding(lease.document),
        expiresAt: lease.expiresAt,
        boundaries: { ...lease.boundaries }
    };
}

function purgeExpiredWorkspaceLeases(now: Date): void {
    const nowMs = now.getTime();
    for (const [workspaceRef, lease] of workspaceLeases) {
        if (Date.parse(lease.expiresAt) <= nowMs) {
            workspaceLeases.delete(workspaceRef);
        }
    }
}

export function createMainImageAgenticWorkspace(
    input: CreateMainImageAgenticWorkspaceInput
): CreateMainImageAgenticWorkspaceResult {
    const now = input.now || new Date();
    purgeExpiredWorkspaceLeases(now);
    const projectPath = cleanString(input.projectPath);
    const document = normalizeDocumentBinding(input.document);
    const productionDocument = input.productionDocument;
    if (!isMainImageAgenticRuntimeTaskIdentity(input.runtimeTaskIdentity)) {
        return { status: 'blocked', blockers: ['main_image_workspace_runtime_task_identity_required'] };
    }
    if (!projectPath) {
        return { status: 'blocked', blockers: ['main_image_workspace_project_path_required'] };
    }
    if (!document) {
        return { status: 'blocked', blockers: ['main_image_workspace_document_binding_invalid'] };
    }
    if (!productionDocument
        || productionDocument.id !== document.logicalDocumentId
        || cleanString(productionDocument.name) !== document.documentName
        || productionDocument.canvasSize.width !== document.canvasSize.width
        || productionDocument.canvasSize.height !== document.canvasSize.height) {
        return { status: 'blocked', blockers: ['main_image_workspace_production_document_mismatch'] };
    }
    if (workspaceLeases.size >= MAX_ACTIVE_MAIN_IMAGE_AGENTIC_WORKSPACES) {
        return { status: 'blocked', blockers: ['main_image_workspace_capacity_reached'] };
    }
    const workspaceRef = createWorkspaceRef();
    if (!workspaceRef) {
        return { status: 'blocked', blockers: ['main_image_workspace_secure_reference_unavailable'] };
    }
    const lease: MainImageAgenticWorkspaceLease = {
        version: MAIN_IMAGE_AGENTIC_WORKSPACE_VERSION,
        workspaceRef,
        status: 'prepared',
        projectPath,
        runtimeTaskIdentity: input.runtimeTaskIdentity,
        productionDocument: copyProductionDocument(productionDocument),
        document,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + MAIN_IMAGE_AGENTIC_WORKSPACE_TTL_MS).toISOString(),
        boundaries: {
            identityOnly: true,
            grantsPermission: false,
            executesTools: false,
            changesTaskResult: false,
            requiresSameRuntimeTask: true,
            requiresLivePhotoshopReadback: true
        }
    };
    workspaceLeases.set(workspaceRef, lease);
    return { status: 'ready', receipt: toPublicReceipt(lease) };
}

export function resolveMainImageAgenticWorkspace(
    input: ResolveMainImageAgenticWorkspaceInput
): ResolveMainImageAgenticWorkspaceResult {
    const now = input.now || new Date();
    purgeExpiredWorkspaceLeases(now);
    const workspaceRef = cleanString(input.workspaceRef);
    const lease = workspaceRef ? workspaceLeases.get(workspaceRef) : undefined;
    if (!lease) {
        return { status: 'blocked', blockers: ['main_image_workspace_not_found_or_expired'] };
    }
    if (!isMainImageAgenticRuntimeTaskIdentity(input.runtimeTaskIdentity)
        || !sameRuntimeTaskIdentity(lease.runtimeTaskIdentity, input.runtimeTaskIdentity)) {
        return { status: 'blocked', blockers: ['main_image_workspace_runtime_task_identity_mismatch'] };
    }
    if (!input.projectPath
        || normalizePath(lease.projectPath) !== normalizePath(input.projectPath)) {
        return { status: 'blocked', blockers: ['main_image_workspace_project_path_mismatch'] };
    }
    return {
        status: 'ready',
        lease: {
            ...lease,
            runtimeTaskIdentity: {
                ...lease.runtimeTaskIdentity,
                boundaries: { ...lease.runtimeTaskIdentity.boundaries }
            },
            productionDocument: copyProductionDocument(lease.productionDocument),
            document: copyDocumentBinding(lease.document),
            boundaries: { ...lease.boundaries }
        }
    };
}

export function consumeMainImageAgenticWorkspace(
    input: ResolveMainImageAgenticWorkspaceInput
): ResolveMainImageAgenticWorkspaceResult {
    const resolved = resolveMainImageAgenticWorkspace(input);
    if (resolved.status !== 'ready') return resolved;
    workspaceLeases.delete(resolved.lease.workspaceRef);
    return resolved;
}
