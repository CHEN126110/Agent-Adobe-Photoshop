export type AgentDiagnosticEvidenceVersion = 'agent-diagnostic-evidence/v0';

export interface AgentDiagnosticEvidence {
    version: AgentDiagnosticEvidenceVersion;
    evidenceKeys: string[];
    rawPayloadRedacted: true;
    warnings: string[];
    detailPageSkillReadiness?: unknown;
    designAgentOs?: unknown;
    agentIntentDeliberationGate?: unknown;
    designPlannerEvidence?: unknown;
    businessVisualEvidenceGate?: unknown;
    businessSkillVisualEvidenceControlDecision?: unknown;
    businessSkillImagePlacementVerificationIntake?: unknown;
    businessSkillExecutionPlanIntake?: unknown;
    agentResumableTaskContract?: unknown;
    agentResumeExecutionPolicy?: unknown;
    agentResumeContextGate?: unknown;
    agentResumeContextRefreshRun?: unknown;
    agentResumeReadonlyContextExecutor?: unknown;
    agentResumePlanning?: unknown;
    agentResumeExecutionGate?: unknown;
    agentResumeControlledExecutionRequest?: unknown;
    agentResumeControlledExecutionRunner?: unknown;
    mainImageQaReport?: unknown;
    mainImageExecutionAlignment?: unknown;
    mainImageScreenshotQa?: unknown;
    mainImageScreenshotProbeReadiness?: unknown;
}

const SUPPORTED_EVIDENCE_KEYS = [
    'detailPageSkillReadiness',
    'designAgentOs',
    'agentIntentDeliberationGate',
    'designPlannerEvidence',
    'businessVisualEvidenceGate',
    'businessSkillVisualEvidenceControlDecision',
    'businessSkillImagePlacementVerificationIntake',
    'businessSkillExecutionPlanIntake',
    'agentResumableTaskContract',
    'agentResumeExecutionPolicy',
    'agentResumeContextGate',
    'agentResumeContextRefreshRun',
    'agentResumeReadonlyContextExecutor',
    'agentResumePlanning',
    'agentResumeExecutionGate',
    'agentResumeControlledExecutionRequest',
    'agentResumeControlledExecutionRunner',
    'mainImageQaReport',
    'mainImageExecutionAlignment',
    'mainImageScreenshotQa',
    'mainImageScreenshotProbeReadiness'
] as const;

const REDACTED_VALUE = '[redacted]';
const MAX_OBJECT_DEPTH = 8;
const MAX_ARRAY_ITEMS = 50;

type SupportedEvidenceKey = typeof SUPPORTED_EVIDENCE_KEYS[number];

export function buildAgentDiagnosticEvidence(data: unknown): AgentDiagnosticEvidence | undefined {
    if (!isRecord(data)) return undefined;

    const evidence: AgentDiagnosticEvidence = {
        version: 'agent-diagnostic-evidence/v0',
        evidenceKeys: [],
        rawPayloadRedacted: true,
        warnings: []
    };

    for (const key of SUPPORTED_EVIDENCE_KEYS) {
        if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
        const sanitized = sanitizeAgentDiagnosticValue(data[key]);
        if (sanitized === undefined) continue;
        (evidence as Record<SupportedEvidenceKey, unknown>)[key] = sanitized;
        evidence.evidenceKeys.push(key);
    }

    if (evidence.evidenceKeys.length === 0) return undefined;
    return evidence;
}

export function sanitizeAgentDiagnosticValue(value: unknown, depth = 0): unknown {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (depth >= MAX_OBJECT_DEPTH) return '[redacted:max-depth]';

    if (Array.isArray(value)) {
        return value
            .slice(0, MAX_ARRAY_ITEMS)
            .map((item) => sanitizeAgentDiagnosticValue(item, depth + 1));
    }

    if (!isRecord(value)) return String(value);

    const output: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
        if (isRawPayloadKey(key)) {
            output[key] = REDACTED_VALUE;
            continue;
        }
        const sanitized = sanitizeAgentDiagnosticValue(nestedValue, depth + 1);
        if (sanitized !== undefined) {
            output[key] = sanitized;
        }
    }
    return output;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isRawPayloadKey(key: string): boolean {
    const normalized = key.toLowerCase();
    if (normalized === 'rawpayloadredacted') return false;
    return normalized.includes('base64')
        || normalized.includes('imagedata')
        || normalized.includes('rawimage')
        || normalized.includes('rawpayload')
        || normalized.includes('binary')
        || normalized.includes('buffer');
}
