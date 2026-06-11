import type {
    MainImageProductionExecutorHandoffEvidence,
    MainImageProductionExecutorToolRequest
} from './main-image-production-executor-handoff';

export type MainImageProductionExecutorBridgeMode =
    | 'dry-run-bridge'
    | 'live-executor-bridge';

export type MainImageProductionExecutorBridgeStatus =
    | 'blocked_missing_handoff'
    | 'blocked_handoff_not_ready'
    | 'blocked_missing_executor_capability'
    | 'blocked_requires_user_approval'
    | 'blocked_photoshop_unavailable'
    | 'ready_for_dry_run_bridge'
    | 'ready_for_live_executor_bridge';

export interface MainImageProductionExecutorBridgeConnection {
    connected?: boolean;
    documentWriteAvailable?: boolean;
    source?: string;
}

export interface MainImageProductionExecutorBridgeInput {
    productionExecutorHandoffEvidence?: MainImageProductionExecutorHandoffEvidence | null;
    availableToolNames?: string[];
    mode?: MainImageProductionExecutorBridgeMode;
    approvedLiveExecution?: boolean;
    photoshopConnection?: MainImageProductionExecutorBridgeConnection | null;
}

export interface MainImageProductionExecutorQueueItem {
    id: string;
    requestId: string;
    tool: MainImageProductionExecutorToolRequest['tool'];
    phase: MainImageProductionExecutorToolRequest['phase'];
    documentId?: string;
    documentName?: string;
    groupPath?: string[];
    payloadPreview: Record<string, unknown>;
    requiredReadback: MainImageProductionExecutorToolRequest['requiredReadback'];
    requiredPostRunReadbackTools: string[];
    sourceEvidenceIds: string[];
    executionBoundary: string;
}

export interface MainImageProductionExecutorBridgeEvidence {
    version: 'main-image-production-executor-bridge/v0';
    skillId: 'main-image-design';
    scene: 'ecommerce-socks';
    status: MainImageProductionExecutorBridgeStatus;
    mode: MainImageProductionExecutorBridgeMode;
    executorQueue: MainImageProductionExecutorQueueItem[];
    requiredToolNames: string[];
    missingToolNames: string[];
    handoffStatus?: MainImageProductionExecutorHandoffEvidence['status'];
    photoshopConnection: {
        connected: boolean;
        documentWriteAvailable: boolean;
        source: string;
    };
    canRunDryRunBridge: boolean;
    canRunLiveExecutor: boolean;
    noPhotoshopWrites: true;
    mustNotExecutePhotoshop: true;
    canClaimOutputQuality: false;
    canClaimDesignComplete: false;
    blockers: string[];
    warnings: string[];
    limitations: string[];
    evidence: Array<{
        source: string;
        summary: string;
        status: 'ready' | 'needs_review' | 'unknown' | 'failed';
    }>;
}

const READBACK_TOOL_BY_REQUIREMENT: Record<string, string> = {
    actualBounds: 'getLayerProperties',
    clippingState: 'getLayerProperties',
    documentInfo: 'getDocumentInfo',
    exportFile: 'getAcceptanceSnapshot',
    screenshot: 'getAcceptanceSnapshot'
};

const DEFAULT_READBACK_TOOLS = [
    'getDocumentInfo',
    'getLayerHierarchy',
    'getLayerProperties',
    'getAcceptanceSnapshot'
];

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

function cleanStrings(values: unknown): string[] {
    if (!Array.isArray(values)) return [];
    return Array.from(new Set(values.map(cleanString).filter(Boolean)));
}

function normalizeConnection(
    connection: MainImageProductionExecutorBridgeConnection | null | undefined
): MainImageProductionExecutorBridgeEvidence['photoshopConnection'] {
    return {
        connected: connection?.connected === true,
        documentWriteAvailable: connection?.documentWriteAvailable === true,
        source: cleanString(connection?.source) || 'not-provided'
    };
}

function collectReadbackTools(request: MainImageProductionExecutorToolRequest): string[] {
    const tools = new Set<string>();
    for (const readback of request.requiredReadback) {
        const toolName = READBACK_TOOL_BY_REQUIREMENT[readback];
        if (toolName) tools.add(toolName);
    }
    if (request.tool === 'createGroup' || request.tool === 'placeImage') {
        tools.add('getLayerHierarchy');
    }
    if (request.tool === 'createGroup' && request.groupPath && request.groupPath.length > 1) {
        tools.add('moveLayerToGroup');
    }
    return Array.from(tools);
}

function collectRequiredTools(
    handoff: MainImageProductionExecutorHandoffEvidence | null | undefined
): string[] {
    if (!handoff) return [];
    const tools = new Set<string>();
    for (const request of handoff.toolRequests) {
        tools.add(request.tool);
        for (const readbackTool of collectReadbackTools(request)) {
            tools.add(readbackTool);
        }
    }
    for (const readbackTool of DEFAULT_READBACK_TOOLS) {
        tools.add(readbackTool);
    }
    return Array.from(tools);
}

function collectMissingTools(input: {
    requiredToolNames: string[];
    availableToolNames: string[];
}): string[] {
    const available = new Set(input.availableToolNames);
    return input.requiredToolNames.filter((toolName) => !available.has(toolName));
}

function makeEvidence(input: {
    status: MainImageProductionExecutorBridgeStatus;
    mode: MainImageProductionExecutorBridgeMode;
    handoff?: MainImageProductionExecutorHandoffEvidence | null;
    requiredToolNames: string[];
    missingToolNames: string[];
    photoshopConnection: MainImageProductionExecutorBridgeEvidence['photoshopConnection'];
    executorQueue?: MainImageProductionExecutorQueueItem[];
    blockers?: string[];
    warnings?: string[];
    evidenceStatus?: 'ready' | 'needs_review' | 'unknown' | 'failed';
}): MainImageProductionExecutorBridgeEvidence {
    const canRunDryRunBridge = input.status === 'ready_for_dry_run_bridge'
        || input.status === 'ready_for_live_executor_bridge';
    const canRunLiveExecutor = input.status === 'ready_for_live_executor_bridge';

    return {
        version: 'main-image-production-executor-bridge/v0',
        skillId: 'main-image-design',
        scene: 'ecommerce-socks',
        status: input.status,
        mode: input.mode,
        executorQueue: input.executorQueue || [],
        requiredToolNames: input.requiredToolNames,
        missingToolNames: input.missingToolNames,
        handoffStatus: input.handoff?.status,
        photoshopConnection: input.photoshopConnection,
        canRunDryRunBridge,
        canRunLiveExecutor,
        noPhotoshopWrites: true,
        mustNotExecutePhotoshop: true,
        canClaimOutputQuality: false,
        canClaimDesignComplete: false,
        blockers: input.blockers || [],
        warnings: input.warnings || [],
        limitations: [
            'executor bridge 只做真实执行前的门禁和队列预览，不执行 Photoshop。',
            'ready_for_live_executor_bridge 只表示可以交给单独 executor；本 helper 仍不写入 Photoshop。',
            '真实写入后必须读回 documentInfo、layer hierarchy、layer properties、acceptance snapshot，再进入质量验收。'
        ],
        evidence: [{
            source: 'main-image-production-executor-bridge',
            summary: `status=${input.status}; queue=${input.executorQueue?.length || 0}; missingTools=${input.missingToolNames.join('/') || 'none'}`,
            status: input.evidenceStatus || (canRunDryRunBridge ? 'ready' : 'failed')
        }]
    };
}

function isHandoffReady(handoff: MainImageProductionExecutorHandoffEvidence): boolean {
    return handoff.status === 'ready_for_dry_run' || handoff.status === 'ready_for_executor_handoff';
}

function buildExecutorQueue(
    handoff: MainImageProductionExecutorHandoffEvidence
): MainImageProductionExecutorQueueItem[] {
    return handoff.toolRequests.map((request, index) => ({
        id: `bridge-${String(index + 1).padStart(3, '0')}-${request.id}`,
        requestId: request.id,
        tool: request.tool,
        phase: request.phase,
        documentId: request.documentId,
        documentName: request.documentName,
        groupPath: request.groupPath,
        payloadPreview: request.payloadPreview,
        requiredReadback: request.requiredReadback,
        requiredPostRunReadbackTools: collectReadbackTools(request),
        sourceEvidenceIds: request.sourceEvidenceIds,
        executionBoundary: 'executor queue preview only; not executed by this bridge helper'
    }));
}

export function buildMainImageProductionExecutorBridgeEvidence(
    input: MainImageProductionExecutorBridgeInput
): MainImageProductionExecutorBridgeEvidence {
    const mode = input.mode || 'dry-run-bridge';
    const handoff = input.productionExecutorHandoffEvidence;
    const requiredToolNames = collectRequiredTools(handoff);
    const availableToolNames = cleanStrings(input.availableToolNames);
    const photoshopConnection = normalizeConnection(input.photoshopConnection);

    if (!handoff) {
        return makeEvidence({
            status: 'blocked_missing_handoff',
            mode,
            requiredToolNames,
            missingToolNames: [],
            photoshopConnection,
            blockers: ['main_image_production_executor_handoff_required']
        });
    }

    if (!isHandoffReady(handoff) || handoff.toolRequests.length === 0) {
        return makeEvidence({
            status: 'blocked_handoff_not_ready',
            mode,
            handoff,
            requiredToolNames,
            missingToolNames: [],
            photoshopConnection,
            blockers: [`handoff_status_not_ready=${handoff.status}`],
            warnings: handoff.warnings,
            evidenceStatus: 'needs_review'
        });
    }

    const missingToolNames = collectMissingTools({
        requiredToolNames,
        availableToolNames
    });
    if (missingToolNames.length > 0) {
        return makeEvidence({
            status: 'blocked_missing_executor_capability',
            mode,
            handoff,
            requiredToolNames,
            missingToolNames,
            photoshopConnection,
            blockers: [`missing_executor_capability=${missingToolNames.join(',')}`],
            warnings: handoff.warnings
        });
    }

    if (mode === 'live-executor-bridge' && input.approvedLiveExecution !== true) {
        return makeEvidence({
            status: 'blocked_requires_user_approval',
            mode,
            handoff,
            requiredToolNames,
            missingToolNames: [],
            photoshopConnection,
            blockers: ['explicit_user_approval_required_before_live_executor_bridge'],
            warnings: handoff.warnings,
            evidenceStatus: 'needs_review'
        });
    }

    if (
        mode === 'live-executor-bridge'
        && (!photoshopConnection.connected || !photoshopConnection.documentWriteAvailable)
    ) {
        return makeEvidence({
            status: 'blocked_photoshop_unavailable',
            mode,
            handoff,
            requiredToolNames,
            missingToolNames: [],
            photoshopConnection,
            blockers: ['photoshop_connection_and_document_write_capability_required'],
            warnings: handoff.warnings
        });
    }

    const executorQueue = buildExecutorQueue(handoff);
    const status: MainImageProductionExecutorBridgeStatus = mode === 'live-executor-bridge'
        ? 'ready_for_live_executor_bridge'
        : 'ready_for_dry_run_bridge';

    return makeEvidence({
        status,
        mode,
        handoff,
        requiredToolNames,
        missingToolNames: [],
        photoshopConnection,
        executorQueue,
        warnings: handoff.warnings,
        evidenceStatus: 'ready'
    });
}
