import type {
    AgentTaskPublicPlanControlledOperationRequest
} from '../../shared/agent-task-public-plan-execution-request';
import { sanitizeAgentResumePlanningValue } from '../../shared/agent-resume-planning';

const PUBLIC_PLAN_OPERATION_VAULT_VERSION = 'public-plan-operation-vault/v0' as const;
const STORAGE_KEY_PREFIX = 'designecho:public-plan-operation-vault:v0:';
const MAX_OPERATIONS = 80;

interface PublicPlanOperationVaultRecord {
    version: typeof PUBLIC_PLAN_OPERATION_VAULT_VERSION;
    sourceMessageId: string;
    requestId: string;
    savedAt: string;
    operationRequests: AgentTaskPublicPlanControlledOperationRequest[];
}

function cleanText(value: unknown, maxLength = 240): string {
    return String(value || '').trim().slice(0, maxLength);
}

function buildStorageKey(sourceMessageId: string): string {
    return `${STORAGE_KEY_PREFIX}${encodeURIComponent(cleanText(sourceMessageId, 160))}`;
}

function getVaultStorage(): Storage | undefined {
    if (typeof window === 'undefined') return undefined;
    try {
        return window.localStorage;
    } catch {
        return undefined;
    }
}

function normalizeOperations(
    value: unknown
): AgentTaskPublicPlanControlledOperationRequest[] {
    if (!Array.isArray(value)) return [];
    return value.slice(0, MAX_OPERATIONS).flatMap((operation) => {
        if (!operation || typeof operation !== 'object') return [];
        const item = operation as Record<string, unknown>;
        const operationId = cleanText(item.operationId);
        const toolName = cleanText(item.toolName);
        const readbackTargets = Array.isArray(item.readbackTargets)
            ? item.readbackTargets.map((target) => cleanText(target)).filter(Boolean).slice(0, 24)
            : [];
        if (!operationId || !toolName || item.params === undefined) return [];
        return [{
            operationId,
            toolName,
            params: sanitizeAgentResumePlanningValue(item.params),
            ...(cleanText(item.paramsSummary, 600)
                ? { paramsSummary: cleanText(item.paramsSummary, 600) }
                : {}),
            readbackTargets
        }];
    });
}

export function savePublicPlanOperationVault(input: {
    sourceMessageId: string;
    requestId: string;
    operationRequests: AgentTaskPublicPlanControlledOperationRequest[];
}): boolean {
    const sourceMessageId = cleanText(input.sourceMessageId, 160);
    const requestId = cleanText(input.requestId, 160);
    const operationRequests = normalizeOperations(input.operationRequests);
    const storage = getVaultStorage();
    if (!sourceMessageId || !requestId || operationRequests.length === 0 || !storage) {
        return false;
    }
    const record: PublicPlanOperationVaultRecord = {
        version: PUBLIC_PLAN_OPERATION_VAULT_VERSION,
        sourceMessageId,
        requestId,
        savedAt: new Date().toISOString(),
        operationRequests
    };
    try {
        storage.setItem(buildStorageKey(sourceMessageId), JSON.stringify(record));
        return true;
    } catch {
        return false;
    }
}

export function loadPublicPlanOperationVault(input: {
    sourceMessageId: string;
    requestId: string;
}): AgentTaskPublicPlanControlledOperationRequest[] {
    const sourceMessageId = cleanText(input.sourceMessageId, 160);
    const requestId = cleanText(input.requestId, 160);
    const storage = getVaultStorage();
    if (!sourceMessageId || !requestId || !storage) return [];
    try {
        const raw = storage.getItem(buildStorageKey(sourceMessageId));
        if (!raw) return [];
        const parsed = JSON.parse(raw) as Partial<PublicPlanOperationVaultRecord>;
        if (
            parsed.version !== PUBLIC_PLAN_OPERATION_VAULT_VERSION
            || cleanText(parsed.sourceMessageId, 160) !== sourceMessageId
        ) {
            return [];
        }
        if (cleanText(parsed.requestId, 160) !== requestId) return [];
        return normalizeOperations(parsed.operationRequests);
    } catch {
        return [];
    }
}

export function removePublicPlanOperationVault(sourceMessageId: string): void {
    const normalizedMessageId = cleanText(sourceMessageId, 160);
    const storage = getVaultStorage();
    if (!normalizedMessageId || !storage) return;
    try {
        storage.removeItem(buildStorageKey(normalizedMessageId));
    } catch {
        // 本地存储不可用不改变受控执行结果；确认范围仍由持久消息中的白名单约束。
    }
}
