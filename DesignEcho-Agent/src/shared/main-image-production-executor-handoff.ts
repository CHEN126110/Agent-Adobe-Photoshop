import type {
    MainImageProductionExecutionOperation,
    MainImageProductionExecutionPlanEvidence,
    MainImageProductionExecutionTool
} from './main-image-production-execution-plan';

export type MainImageProductionExecutorHandoffMode =
    | 'dry-run'
    | 'executor-handoff';

export type MainImageProductionExecutorHandoffStatus =
    | 'blocked_missing_execution_plan'
    | 'blocked_execution_plan_not_ready'
    | 'blocked_pending_confirmation'
    | 'blocked_missing_tool_capability'
    | 'ready_for_dry_run'
    | 'ready_for_executor_handoff';

export interface MainImageProductionExecutorHandoffInput {
    productionExecutionPlanEvidence?: MainImageProductionExecutionPlanEvidence | null;
    availableToolNames?: string[];
    outputDir?: string;
    approvedPendingConfirmations?: boolean;
    mode?: MainImageProductionExecutorHandoffMode;
}

export interface MainImageProductionExecutorToolRequest {
    id: string;
    tool: MainImageProductionExecutionTool;
    phase: MainImageProductionExecutionOperation['phase'];
    documentId?: string;
    documentName?: string;
    groupPath?: string[];
    payloadPreview: Record<string, unknown>;
    requiredReadback: MainImageProductionExecutionOperation['requiredReadback'];
    sourceEvidenceIds: string[];
    executionBoundary: string;
}

export interface MainImageProductionExecutorHandoffEvidence {
    version: 'main-image-production-executor-handoff/v0';
    skillId: 'main-image-design';
    scene: 'ecommerce-socks';
    status: MainImageProductionExecutorHandoffStatus;
    mode: MainImageProductionExecutorHandoffMode;
    toolRequests: MainImageProductionExecutorToolRequest[];
    requiredToolNames: MainImageProductionExecutionTool[];
    missingToolNames: MainImageProductionExecutionTool[];
    pendingConfirmations: string[];
    canRunDryRun: boolean;
    canRunExecutor: boolean;
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
    return values.map(cleanString).filter(Boolean);
}

function cleanToolNames(values: unknown): string[] {
    return Array.from(new Set(cleanStrings(values)));
}

function flattenOperations(
    executionPlan: MainImageProductionExecutionPlanEvidence
): MainImageProductionExecutionOperation[] {
    return executionPlan.documents.flatMap((document) => document.operations);
}

function collectRequiredTools(
    executionPlan: MainImageProductionExecutionPlanEvidence | null | undefined
): MainImageProductionExecutionTool[] {
    if (!executionPlan) return [];
    return Array.from(new Set(flattenOperations(executionPlan).map((operation) => operation.tool)));
}

function collectMissingTools(input: {
    requiredToolNames: MainImageProductionExecutionTool[];
    availableToolNames: string[];
}): MainImageProductionExecutionTool[] {
    const available = new Set(input.availableToolNames);
    return input.requiredToolNames.filter((toolName) => !available.has(toolName));
}

function compactObject(value: Record<string, unknown>): Record<string, unknown> {
    const compacted: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
        if (item !== undefined && item !== null && item !== '') {
            compacted[key] = item;
        }
    }
    return compacted;
}

function cleanAsset(
    asset: MainImageProductionExecutionOperation['asset']
): MainImageProductionExecutionOperation['asset'] {
    if (!asset) return undefined;
    return compactObject({
        name: cleanString(asset.name),
        path: cleanString(asset.path),
        width: asset.width,
        height: asset.height
    }) as MainImageProductionExecutionOperation['asset'];
}

function buildPayloadPreview(input: {
    operation: MainImageProductionExecutionOperation;
    outputDir: string;
}): Record<string, unknown> {
    const operation = input.operation;
    return compactObject({
        documentId: cleanString(operation.documentId),
        documentName: cleanString(operation.documentName),
        groupPath: operation.groupPath?.map(cleanString).filter(Boolean),
        variantId: cleanString(operation.variantId),
        placementPlanId: cleanString(operation.placementPlanId),
        exportSpecId: cleanString(operation.exportSpecId),
        asset: cleanAsset(operation.asset),
        canvasSize: operation.canvasSize,
        exportSize: operation.exportSize,
        outputDir: operation.tool === 'exportGroup' ? cleanString(input.outputDir) : undefined,
        destinationBox: operation.destinationBox,
        subjectDestinationBox: operation.subjectDestinationBox,
        scalePercent: operation.scalePercent
    });
}

function buildToolRequests(input: {
    executionPlan: MainImageProductionExecutionPlanEvidence;
    outputDir: string;
}): MainImageProductionExecutorToolRequest[] {
    return flattenOperations(input.executionPlan).map((operation, index) => ({
        id: `${String(index + 1).padStart(3, '0')}-${operation.id}`,
        tool: operation.tool,
        phase: operation.phase,
        documentId: cleanString(operation.documentId) || undefined,
        documentName: cleanString(operation.documentName) || undefined,
        groupPath: operation.groupPath?.map(cleanString).filter(Boolean),
        payloadPreview: buildPayloadPreview({
            operation,
            outputDir: input.outputDir
        }),
        requiredReadback: operation.requiredReadback,
        sourceEvidenceIds: operation.sourceEvidenceIds.map(cleanString).filter(Boolean),
        executionBoundary: 'handoff request only; not executed by this helper; executor must write to Photoshop and then read back evidence'
    }));
}

function makeEvidence(input: {
    status: MainImageProductionExecutorHandoffStatus;
    mode: MainImageProductionExecutorHandoffMode;
    requiredToolNames: MainImageProductionExecutionTool[];
    missingToolNames: MainImageProductionExecutionTool[];
    pendingConfirmations: string[];
    toolRequests?: MainImageProductionExecutorToolRequest[];
    blockers?: string[];
    warnings?: string[];
    limitations?: string[];
    evidenceStatus?: 'ready' | 'needs_review' | 'unknown' | 'failed';
}): MainImageProductionExecutorHandoffEvidence {
    const canRunDryRun = input.status === 'ready_for_dry_run' || input.status === 'ready_for_executor_handoff';
    const canRunExecutor = input.status === 'ready_for_executor_handoff';

    return {
        version: 'main-image-production-executor-handoff/v0',
        skillId: 'main-image-design',
        scene: 'ecommerce-socks',
        status: input.status,
        mode: input.mode,
        toolRequests: input.toolRequests || [],
        requiredToolNames: input.requiredToolNames,
        missingToolNames: input.missingToolNames,
        pendingConfirmations: input.pendingConfirmations,
        canRunDryRun,
        canRunExecutor,
        noPhotoshopWrites: true,
        mustNotExecutePhotoshop: true,
        canClaimOutputQuality: false,
        canClaimDesignComplete: false,
        blockers: input.blockers || [],
        warnings: input.warnings || [],
        limitations: [
            'executor handoff 只生成工具请求清单，不执行 Photoshop 写入。',
            '只有真实 executor 写入后读回 documentInfo、bounds、截图和导出文件，才能进入质量验收。',
            'toolRequests 是交接 manifest，不是模型思考，也不是已完成设计结果。',
            ...(input.limitations || [])
        ],
        evidence: [{
            source: 'main-image-production-executor-handoff',
            summary: `status=${input.status}; requests=${input.toolRequests?.length || 0}; missingTools=${input.missingToolNames.join('/') || 'none'}`,
            status: input.evidenceStatus || (canRunDryRun ? 'ready' : 'failed')
        }]
    };
}

function isExecutionPlanReady(
    executionPlan: MainImageProductionExecutionPlanEvidence
): boolean {
    return executionPlan.status === 'ready_execution_plan'
        || executionPlan.status === 'ready_execution_plan_with_pending_confirmation';
}

export function buildMainImageProductionExecutorHandoffEvidence(
    input: MainImageProductionExecutorHandoffInput
): MainImageProductionExecutorHandoffEvidence {
    const mode = input.mode || 'dry-run';
    const executionPlan = input.productionExecutionPlanEvidence;
    const outputDir = cleanString(input.outputDir);
    const requiredToolNames = collectRequiredTools(executionPlan);
    const availableToolNames = cleanToolNames(input.availableToolNames);
    const pendingConfirmations = cleanStrings(executionPlan?.pendingConfirmations);

    if (!executionPlan) {
        return makeEvidence({
            status: 'blocked_missing_execution_plan',
            mode,
            requiredToolNames,
            missingToolNames: [],
            pendingConfirmations,
            blockers: ['main_image_production_execution_plan_required'],
            evidenceStatus: 'failed'
        });
    }

    if (!isExecutionPlanReady(executionPlan) || executionPlan.plannedOperationCount <= 0) {
        return makeEvidence({
            status: 'blocked_execution_plan_not_ready',
            mode,
            requiredToolNames,
            missingToolNames: [],
            pendingConfirmations,
            blockers: [`execution_plan_status_not_ready=${executionPlan.status}`],
            warnings: executionPlan.warnings,
            evidenceStatus: 'failed'
        });
    }

    if (
        pendingConfirmations.length > 0
        && input.approvedPendingConfirmations !== true
        && executionPlan.canExecuteWithoutReview !== true
    ) {
        return makeEvidence({
            status: 'blocked_pending_confirmation',
            mode,
            requiredToolNames,
            missingToolNames: [],
            pendingConfirmations,
            blockers: ['pending_ratio_confirmation_required_before_executor_handoff'],
            warnings: [
                ...executionPlan.warnings,
                ...pendingConfirmations
            ],
            evidenceStatus: 'needs_review'
        });
    }

    const missingToolNames = collectMissingTools({
        requiredToolNames,
        availableToolNames
    });
    if (missingToolNames.length > 0) {
        return makeEvidence({
            status: 'blocked_missing_tool_capability',
            mode,
            requiredToolNames,
            missingToolNames,
            pendingConfirmations,
            blockers: [`missing_tool_capability=${missingToolNames.join(',')}`],
            warnings: executionPlan.warnings,
            evidenceStatus: 'failed'
        });
    }

    const toolRequests = buildToolRequests({
        executionPlan,
        outputDir
    });
    const status: MainImageProductionExecutorHandoffStatus = mode === 'executor-handoff'
        ? 'ready_for_executor_handoff'
        : 'ready_for_dry_run';

    return makeEvidence({
        status,
        mode,
        requiredToolNames,
        missingToolNames,
        pendingConfirmations,
        toolRequests,
        warnings: executionPlan.warnings,
        evidenceStatus: 'ready'
    });
}
