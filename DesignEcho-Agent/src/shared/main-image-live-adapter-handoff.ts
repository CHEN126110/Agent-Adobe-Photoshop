export type MainImageLiveAdapterHandoffStatus =
    | 'blocked_missing_adapter_contract'
    | 'blocked_adapter_contract_not_ready'
    | 'blocked_missing_toolchain_evidence'
    | 'blocked_toolchain_not_validated'
    | 'blocked_toolchain_cleanup_not_safe'
    | 'ready_for_guarded_adapter_handoff';

export interface MainImageLiveAdapterContractLike {
    version?: string;
    status?: string;
    requestedOperationCount?: number;
    mappedOperationCount?: number;
    blockedOperationCount?: number;
    operationCount?: number;
    requiredToolNames?: string[];
    missingToolNames?: string[];
    readbackTools?: string[];
    mappings?: unknown[];
    canCreateAdapter?: boolean;
    canWritePhotoshop?: boolean;
    requiresDisposableDocument?: boolean;
    requiresExplicitLiveApproval?: boolean;
    blockers?: string[];
    warnings?: string[];
    limitations?: string[];
    evidence?: Array<{
        source?: string;
        summary?: string;
        status?: string;
    }>;
}

export interface MainImageUxpToolchainEvidence {
    source?: string;
    mode?: string;
    success?: boolean;
    preflightReady?: boolean;
    assertionCount?: number;
    failedAssertions?: string[];
    exportedPath?: string;
    exportFileExists?: boolean;
    cleanup?: {
        closed?: boolean;
        restoredOriginal?: boolean;
        disposableStillOpen?: boolean;
        errors?: string[];
    };
    requiredToolNames?: string[];
    missingToolNames?: string[];
}

export interface MainImageLiveAdapterHandoffInput {
    adapterContract?: MainImageLiveAdapterContractLike | null;
    toolchainEvidence?: MainImageUxpToolchainEvidence | null;
}

export interface MainImageLiveAdapterHandoffEvidence {
    version: 'main-image-live-adapter-handoff/v0';
    skillId: 'main-image-design';
    scene: 'design-skill-main-image';
    status: MainImageLiveAdapterHandoffStatus;
    canWireAdapter: boolean;
    canRunProduction: false;
    canWritePhotoshop: false;
    requiresDisposableDocument: true;
    requiresExplicitLiveApproval: true;
    canClaimOutputQuality: false;
    canClaimDesignComplete: false;
    operationSummary: {
        operationCount: number;
        mappedOperationCount: number;
        blockedOperationCount: number;
        mappingCount: number;
    };
    toolchainSummary: {
        source: string;
        mode: string;
        preflightReady: boolean;
        assertionCount: number;
        failedAssertionCount: number;
        exportFileExists: boolean;
        cleanupClosed: boolean;
        cleanupRestoredOriginal: boolean;
        disposableStillOpen: boolean;
    };
    requiredToolNames: string[];
    missingToolNames: string[];
    readbackTools: string[];
    blockers: string[];
    warnings: string[];
    limitations: string[];
    evidence: Array<{
        source: string;
        summary: string;
        status: 'ready' | 'needs_review' | 'failed' | 'unknown';
    }>;
}

const READY_ADAPTER_CONTRACT_STATUS = 'ready_for_disposable_photoshop_adapter';

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

function readNumber(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function getOperationCount(contract: MainImageLiveAdapterContractLike | null | undefined): number {
    if (!contract) return 0;
    const requestedOperationCount = readNumber(contract.requestedOperationCount);
    if (requestedOperationCount > 0) return requestedOperationCount;
    return readNumber(contract.operationCount);
}

function getToolchainFailedAssertions(toolchainEvidence: MainImageUxpToolchainEvidence | null | undefined): string[] {
    return cleanStrings(toolchainEvidence?.failedAssertions);
}

function getMissingToolNames(input: {
    adapterContract?: MainImageLiveAdapterContractLike | null;
    toolchainEvidence?: MainImageUxpToolchainEvidence | null;
}): string[] {
    return Array.from(new Set([
        ...cleanStrings(input.adapterContract?.missingToolNames),
        ...cleanStrings(input.toolchainEvidence?.missingToolNames)
    ]));
}

function getRequiredToolNames(input: {
    adapterContract?: MainImageLiveAdapterContractLike | null;
    toolchainEvidence?: MainImageUxpToolchainEvidence | null;
}): string[] {
    return Array.from(new Set([
        ...cleanStrings(input.adapterContract?.requiredToolNames),
        ...cleanStrings(input.toolchainEvidence?.requiredToolNames)
    ]));
}

function isAdapterContractReady(adapterContract: MainImageLiveAdapterContractLike): boolean {
    return adapterContract.status === READY_ADAPTER_CONTRACT_STATUS
        && adapterContract.canCreateAdapter === true
        && adapterContract.canWritePhotoshop !== true
        && adapterContract.requiresDisposableDocument === true
        && adapterContract.requiresExplicitLiveApproval === true
        && cleanStrings(adapterContract.missingToolNames).length === 0;
}

function isToolchainEvidenceValidated(toolchainEvidence: MainImageUxpToolchainEvidence): boolean {
    return toolchainEvidence.success === true
        && toolchainEvidence.preflightReady === true
        && readNumber(toolchainEvidence.assertionCount) > 0
        && getToolchainFailedAssertions(toolchainEvidence).length === 0
        && cleanStrings(toolchainEvidence.missingToolNames).length === 0
        && toolchainEvidence.exportFileExists === true;
}

function isCleanupSafe(toolchainEvidence: MainImageUxpToolchainEvidence): boolean {
    return toolchainEvidence.cleanup?.closed === true
        && toolchainEvidence.cleanup?.restoredOriginal === true
        && toolchainEvidence.cleanup?.disposableStillOpen === false
        && cleanStrings(toolchainEvidence.cleanup?.errors).length === 0;
}

function buildToolchainSummary(
    toolchainEvidence: MainImageUxpToolchainEvidence | null | undefined
): MainImageLiveAdapterHandoffEvidence['toolchainSummary'] {
    return {
        source: cleanString(toolchainEvidence?.source) || 'unknown',
        mode: cleanString(toolchainEvidence?.mode) || 'unknown',
        preflightReady: toolchainEvidence?.preflightReady === true,
        assertionCount: readNumber(toolchainEvidence?.assertionCount),
        failedAssertionCount: getToolchainFailedAssertions(toolchainEvidence).length,
        exportFileExists: toolchainEvidence?.exportFileExists === true,
        cleanupClosed: toolchainEvidence?.cleanup?.closed === true,
        cleanupRestoredOriginal: toolchainEvidence?.cleanup?.restoredOriginal === true,
        disposableStillOpen: toolchainEvidence?.cleanup?.disposableStillOpen === true
    };
}

function buildOperationSummary(
    adapterContract: MainImageLiveAdapterContractLike | null | undefined
): MainImageLiveAdapterHandoffEvidence['operationSummary'] {
    return {
        operationCount: getOperationCount(adapterContract),
        mappedOperationCount: readNumber(adapterContract?.mappedOperationCount),
        blockedOperationCount: readNumber(adapterContract?.blockedOperationCount),
        mappingCount: Array.isArray(adapterContract?.mappings) ? adapterContract.mappings.length : 0
    };
}

function makeEvidence(input: {
    status: MainImageLiveAdapterHandoffStatus;
    adapterContract?: MainImageLiveAdapterContractLike | null;
    toolchainEvidence?: MainImageUxpToolchainEvidence | null;
    blockers?: string[];
    warnings?: string[];
    limitations?: string[];
}): MainImageLiveAdapterHandoffEvidence {
    const canWireAdapter = input.status === 'ready_for_guarded_adapter_handoff';
    const adapterContract = input.adapterContract;
    const toolchainEvidence = input.toolchainEvidence;

    return {
        version: 'main-image-live-adapter-handoff/v0',
        skillId: 'main-image-design',
        scene: 'design-skill-main-image',
        status: input.status,
        canWireAdapter,
        canRunProduction: false,
        canWritePhotoshop: false,
        requiresDisposableDocument: true,
        requiresExplicitLiveApproval: true,
        canClaimOutputQuality: false,
        canClaimDesignComplete: false,
        operationSummary: buildOperationSummary(adapterContract),
        toolchainSummary: buildToolchainSummary(toolchainEvidence),
        requiredToolNames: getRequiredToolNames({ adapterContract, toolchainEvidence }),
        missingToolNames: getMissingToolNames({ adapterContract, toolchainEvidence }),
        readbackTools: cleanStrings(adapterContract?.readbackTools),
        blockers: input.blockers || [],
        warnings: [
            ...cleanStrings(adapterContract?.warnings),
            ...(input.warnings || [])
        ],
        limitations: [
            'main-image live adapter handoff 只判断是否允许后续接入真实 adapter，不执行 Photoshop。',
            'ready_for_guarded_adapter_handoff 不等于设计完成，也不等于视觉质量通过。',
            '真实 adapter 仍必须限制在 disposable document、显式 live approval、逐步 readback 和最终验收快照内。',
            ...(input.limitations || []),
            ...cleanStrings(adapterContract?.limitations)
        ],
        evidence: [{
            source: 'main-image-live-adapter-handoff',
            summary: `status=${input.status}; canWireAdapter=${canWireAdapter}; operationCount=${getOperationCount(adapterContract)}`,
            status: canWireAdapter ? 'ready' : 'failed'
        }]
    };
}

export function buildMainImageLiveAdapterHandoffEvidence(
    input: MainImageLiveAdapterHandoffInput = {}
): MainImageLiveAdapterHandoffEvidence {
    const adapterContract = input.adapterContract || null;
    const toolchainEvidence = input.toolchainEvidence || null;

    if (!adapterContract) {
        return makeEvidence({
            status: 'blocked_missing_adapter_contract',
            blockers: ['缺少 live Photoshop adapter contract，不能接入真实 adapter。']
        });
    }

    if (!isAdapterContractReady(adapterContract)) {
        return makeEvidence({
            status: 'blocked_adapter_contract_not_ready',
            adapterContract,
            toolchainEvidence,
            blockers: [
                `live Photoshop adapter contract 未就绪：${cleanString(adapterContract.status) || 'unknown'}`,
                ...cleanStrings(adapterContract.blockers),
                ...getMissingToolNames({ adapterContract, toolchainEvidence }).map((toolName) => `缺少工具能力：${toolName}`)
            ]
        });
    }

    if (!toolchainEvidence) {
        return makeEvidence({
            status: 'blocked_missing_toolchain_evidence',
            adapterContract,
            blockers: ['缺少 AGENT-141 disposable UXP toolchain live smoke 证据，不能接入真实 adapter。']
        });
    }

    if (!isToolchainEvidenceValidated(toolchainEvidence)) {
        return makeEvidence({
            status: 'blocked_toolchain_not_validated',
            adapterContract,
            toolchainEvidence,
            blockers: [
                'AGENT-141 disposable UXP toolchain live smoke 未通过或证据不完整。',
                ...getToolchainFailedAssertions(toolchainEvidence),
                ...getMissingToolNames({ adapterContract, toolchainEvidence }).map((toolName) => `缺少工具能力：${toolName}`)
            ]
        });
    }

    if (!isCleanupSafe(toolchainEvidence)) {
        return makeEvidence({
            status: 'blocked_toolchain_cleanup_not_safe',
            adapterContract,
            toolchainEvidence,
            blockers: [
                'AGENT-141 disposable UXP toolchain live smoke 清理或原文档恢复不安全。',
                ...cleanStrings(toolchainEvidence.cleanup?.errors)
            ]
        });
    }

    return makeEvidence({
        status: 'ready_for_guarded_adapter_handoff',
        adapterContract,
        toolchainEvidence,
        warnings: [
            '下一步只能接入 guarded adapter，仍不能默认运行生产文档写入。'
        ]
    });
}
