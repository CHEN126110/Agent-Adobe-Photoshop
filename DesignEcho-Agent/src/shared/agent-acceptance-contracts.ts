import type { AcceptanceSnapshot, AcceptanceSnapshotDiff } from './acceptance/photoshop-acceptance';
import { diffAcceptanceSnapshots } from './acceptance/photoshop-acceptance';
import type { AgentDiagnosticEvidence } from './agent-diagnostic-evidence';
import type {
    AgentExecutionLifecycleSnapshot,
    AgentExecutionLifecycleStatus
} from './agent-execution-lifecycle';
import {
    buildAgentExecutionLifecycleSnapshot,
    isAgentExecutionLifecycleBoundaryOk
} from './agent-execution-lifecycle';
import type { AgentIntentDecisionIntake } from './agent-intent-decision-intake';
import {
    buildAgentIntentDecisionIntake,
    isAgentIntentDecisionBoundaryOk
} from './agent-intent-decision-intake';
import type { AgentRequestLifecycleEvidence } from './agent-request-lifecycle';

export type AgentAcceptanceVersion = 'agent-acceptance/v0';

export type AgentAcceptanceCaseMode =
    | 'offline'
    | 'desktop_bridge'
    | 'live_photoshop';

export type AgentAcceptanceStatus =
    | 'passed'
    | 'failed'
    | 'needs_review';

export type AgentAcceptanceIssueLayer =
    | 'intent'
    | 'context'
    | 'routing'
    | 'model'
    | 'tool'
    | 'photoshop'
    | 'verification'
    | 'performance'
    | 'ux'
    | 'unknown';

export interface AgentAcceptanceCaseExpectation {
    route?: AgentRequestLifecycleEvidence['decision']['route'];
    routeSource?: AgentRequestLifecycleEvidence['decision']['source'];
    skillId?: string;
    executionKind?: AgentRequestLifecycleEvidence['execution']['kind'];
    requiresPhotoshop?: boolean;
    shouldUseTools?: boolean;
    shouldChangeDocument?: boolean;
    expectedExecutionStatus?: string;
    maxIterations?: number;
    maxToolCalls?: number;
}

export interface AgentAcceptanceCase {
    id: string;
    title: string;
    userInput: string;
    mode: AgentAcceptanceCaseMode;
    tags: string[];
    expectation: AgentAcceptanceCaseExpectation;
    notes?: string[];
}

export interface AgentAcceptanceToolEvent {
    name: string;
    success: boolean;
    durationMs?: number;
    error?: string;
    acceptanceStatus?: string;
}

export interface AgentAcceptanceChatStepEvidence {
    type?: string;
    content?: string;
    toolName?: string;
    toolResult?: {
        success?: boolean;
        error?: string;
        acceptance?: {
            status?: string;
        };
    };
}

export interface AgentAcceptanceChatMessageEvidence {
    content?: string;
    agentRequestLifecycle?: AgentRequestLifecycleEvidence;
    executionSummary?: AgentAcceptanceExecutionSummary;
    agentDiagnosticEvidence?: AgentDiagnosticEvidence;
    thinkingSteps?: AgentAcceptanceChatStepEvidence[];
}

export interface AgentAcceptanceExecutionSummary {
    status?: string;
    stopReason?: string;
    iterations?: number;
    toolCallCount?: number;
    successfulToolCalls?: number;
    failedToolCalls?: number;
    acceptanceVerified?: number;
    acceptanceFailed?: number;
    acceptanceNeedsReview?: number;
    noDocumentChangeRisks?: number;
    blockers?: string[];
    warnings?: string[];
    summaryText?: string;
}

export interface AgentRunDebugBundle {
    version: AgentAcceptanceVersion;
    caseId: string;
    generatedAt: string;
    request: {
        userInput: string;
    };
    model?: {
        provider?: string;
        modelId?: string;
        role?: string;
    };
    lifecycle?: AgentRequestLifecycleEvidence;
    executionSummary?: AgentAcceptanceExecutionSummary;
    diagnosticEvidence?: AgentDiagnosticEvidence;
    tools: AgentAcceptanceToolEvent[];
    timings?: {
        totalMs?: number;
        modelMs?: number;
        toolMs?: number;
    };
    beforeSnapshot?: AcceptanceSnapshot;
    afterSnapshot?: AcceptanceSnapshot;
    snapshotDiff?: AcceptanceSnapshotDiff;
    visibleThinking?: string[];
    visibleMessages?: string[];
    errors: string[];
    warnings: string[];
}

export interface AgentAcceptanceCheck {
    id: string;
    label: string;
    status: AgentAcceptanceStatus;
    layer: AgentAcceptanceIssueLayer;
    expected?: unknown;
    actual?: unknown;
    reason?: string;
}

export interface AgentAcceptanceReport {
    version: AgentAcceptanceVersion;
    caseId: string;
    title: string;
    status: AgentAcceptanceStatus;
    issueLayers: AgentAcceptanceIssueLayer[];
    checks: AgentAcceptanceCheck[];
    blockers: string[];
    warnings: string[];
    evidence: {
        hasLifecycle: boolean;
        agentIntentDecisionIntake?: AgentIntentDecisionIntake;
        agentExecutionLifecycleSnapshot?: AgentExecutionLifecycleSnapshot;
        hasExecutionSummary: boolean;
        hasDiagnosticEvidence: boolean;
        diagnosticEvidenceKeys: string[];
        businessSkillVisualEvidenceControlDecision?: AgentAcceptanceBusinessSkillVisualEvidenceControlDecision;
        businessSkillImagePlacementVerificationIntake?: AgentAcceptanceBusinessSkillEvidenceIntake;
        businessSkillExecutionPlanIntake?: AgentAcceptanceBusinessSkillEvidenceIntake;
        hasPhotoshopSnapshot: boolean;
        hasSnapshotDiff: boolean;
        toolCount: number;
        changedLayerCount?: number;
    };
    summary: string;
}

export interface AgentAcceptanceBusinessSkillVisualEvidenceControlDecision {
    decision?: string;
    canClaimDesignQuality?: boolean;
    resultEvidenceOnly?: boolean;
    requiredNextEvidence: string[];
}

export interface AgentAcceptanceBusinessSkillEvidenceIntake {
    status?: string;
    evidenceOnly?: boolean;
    userVisible?: boolean;
    canClaimDesignQuality?: boolean;
    requiredNextEvidence: string[];
    blockers: string[];
}

export interface BuildAgentRunDebugBundleInput {
    acceptanceCase: AgentAcceptanceCase;
    lifecycle?: AgentRequestLifecycleEvidence;
    executionSummary?: AgentAcceptanceExecutionSummary;
    diagnosticEvidence?: AgentDiagnosticEvidence;
    tools?: AgentAcceptanceToolEvent[];
    beforeSnapshot?: AcceptanceSnapshot;
    afterSnapshot?: AcceptanceSnapshot;
    visibleThinking?: string[];
    visibleMessages?: string[];
    errors?: string[];
    warnings?: string[];
    timings?: AgentRunDebugBundle['timings'];
    model?: AgentRunDebugBundle['model'];
    generatedAt?: string;
}

export interface BuildAgentRunDebugBundleFromMessageInput {
    acceptanceCase: AgentAcceptanceCase;
    message: AgentAcceptanceChatMessageEvidence;
    beforeSnapshot?: AcceptanceSnapshot;
    afterSnapshot?: AcceptanceSnapshot;
    errors?: string[];
    warnings?: string[];
    timings?: AgentRunDebugBundle['timings'];
    model?: AgentRunDebugBundle['model'];
    generatedAt?: string;
}

export function buildAgentRunDebugBundle(input: BuildAgentRunDebugBundleInput): AgentRunDebugBundle {
    const beforeSnapshot = input.beforeSnapshot;
    const afterSnapshot = input.afterSnapshot;
    const snapshotDiff = beforeSnapshot && afterSnapshot
        ? diffAcceptanceSnapshots(beforeSnapshot, afterSnapshot)
        : undefined;

    return {
        version: 'agent-acceptance/v0',
        caseId: input.acceptanceCase.id,
        generatedAt: input.generatedAt || new Date().toISOString(),
        request: {
            userInput: input.acceptanceCase.userInput
        },
        model: input.model,
        lifecycle: input.lifecycle,
        executionSummary: input.executionSummary,
        diagnosticEvidence: input.diagnosticEvidence,
        tools: Array.isArray(input.tools) ? input.tools : [],
        timings: input.timings,
        beforeSnapshot,
        afterSnapshot,
        snapshotDiff,
        visibleThinking: sanitizeStringArray(input.visibleThinking),
        visibleMessages: sanitizeStringArray(input.visibleMessages),
        errors: sanitizeStringArray(input.errors),
        warnings: sanitizeStringArray(input.warnings)
    };
}

export function buildAgentRunDebugBundleFromMessage(
    input: BuildAgentRunDebugBundleFromMessageInput
): AgentRunDebugBundle {
    const thinkingSteps = Array.isArray(input.message.thinkingSteps)
        ? input.message.thinkingSteps
        : [];

    return buildAgentRunDebugBundle({
        acceptanceCase: input.acceptanceCase,
        lifecycle: input.message.agentRequestLifecycle,
        executionSummary: input.message.executionSummary,
        diagnosticEvidence: input.message.agentDiagnosticEvidence,
        tools: extractToolEventsFromChatSteps(thinkingSteps),
        beforeSnapshot: input.beforeSnapshot,
        afterSnapshot: input.afterSnapshot,
        visibleThinking: thinkingSteps
            .filter((step) => step.type === 'thinking')
            .map((step) => step.content || ''),
        visibleMessages: input.message.content ? [input.message.content] : [],
        errors: input.errors,
        warnings: input.warnings,
        timings: input.timings,
        model: input.model,
        generatedAt: input.generatedAt
    });
}

export function evaluateAgentAcceptance(
    acceptanceCase: AgentAcceptanceCase,
    bundle: AgentRunDebugBundle
): AgentAcceptanceReport {
    const toolCallCount = bundle.tools.length || Number(bundle.executionSummary?.toolCallCount || 0);
    const executionLifecycleSnapshot = buildAgentExecutionLifecycleSnapshot({
        lifecycle: bundle.lifecycle,
        status: deriveExecutionLifecycleStatus(bundle.executionSummary),
        toolCallCount,
        activeToolName: deriveActiveToolName(bundle),
        blockers: bundle.executionSummary?.blockers,
        warnings: [
            ...sanitizeStringArray(bundle.lifecycle?.warnings),
            ...sanitizeStringArray(bundle.executionSummary?.warnings)
        ],
        generatedAt: bundle.generatedAt
    });
    const intentDecisionIntake = buildAgentIntentDecisionIntake({
        lifecycle: bundle.lifecycle,
        acceptanceCase,
        executionSummary: bundle.executionSummary,
        tools: bundle.tools,
        generatedAt: bundle.generatedAt
    });
    const checks: AgentAcceptanceCheck[] = [
        checkLifecycle(acceptanceCase, bundle),
        checkAgentExecutionLifecycleSnapshot(executionLifecycleSnapshot),
        checkAgentIntentDecisionIntake(intentDecisionIntake),
        checkRoute(acceptanceCase, bundle),
        checkSkill(acceptanceCase, bundle),
        checkExecutionKind(acceptanceCase, bundle),
        checkToolUsage(acceptanceCase, bundle),
        checkExecutionSummary(acceptanceCase, bundle),
        checkDocumentChange(acceptanceCase, bundle),
        checkDiagnosticControlDecision(bundle),
        checkBusinessSkillEvidenceIntake(
            'business-skill-image-placement-verification-intake',
            extractBusinessSkillEvidenceIntake(
                bundle.diagnosticEvidence,
                'businessSkillImagePlacementVerificationIntake'
            )
        ),
        checkBusinessSkillEvidenceIntake(
            'business-skill-execution-plan-intake',
            extractBusinessSkillEvidenceIntake(bundle.diagnosticEvidence, 'businessSkillExecutionPlanIntake')
        ),
        checkVisibleThinking(bundle)
    ].filter(Boolean) as AgentAcceptanceCheck[];
    const diagnosticControlDecision = extractDiagnosticControlDecision(bundle.diagnosticEvidence);
    const imagePlacementIntake = extractBusinessSkillEvidenceIntake(
        bundle.diagnosticEvidence,
        'businessSkillImagePlacementVerificationIntake'
    );
    const executionPlanIntake = extractBusinessSkillEvidenceIntake(
        bundle.diagnosticEvidence,
        'businessSkillExecutionPlanIntake'
    );

    const blockers = collectCheckReasons(checks, 'failed');
    const warnings = [
        ...collectCheckReasons(checks, 'needs_review'),
        ...bundle.warnings,
        ...sanitizeStringArray(bundle.lifecycle?.warnings),
        ...sanitizeStringArray(bundle.executionSummary?.warnings),
        ...formatDiagnosticControlWarnings(diagnosticControlDecision),
        ...formatBusinessSkillEvidenceIntakeWarnings('image placement', imagePlacementIntake),
        ...formatBusinessSkillEvidenceIntakeWarnings('execution plan', executionPlanIntake),
        ...formatAgentIntentDecisionIntakeWarnings(intentDecisionIntake)
    ];
    const status = deriveReportStatus(checks, blockers);
    const issueLayers = Array.from(new Set(checks
        .filter((check) => check.status !== 'passed')
        .map((check) => check.layer)));
    const changedLayerCount = bundle.snapshotDiff?.summary.changed || 0;

    return {
        version: 'agent-acceptance/v0',
        caseId: acceptanceCase.id,
        title: acceptanceCase.title,
        status,
        issueLayers,
        checks,
        blockers,
        warnings,
        evidence: {
            hasLifecycle: Boolean(bundle.lifecycle),
            agentIntentDecisionIntake: intentDecisionIntake,
            agentExecutionLifecycleSnapshot: executionLifecycleSnapshot,
            hasExecutionSummary: Boolean(bundle.executionSummary),
            hasDiagnosticEvidence: Boolean(bundle.diagnosticEvidence),
            diagnosticEvidenceKeys: bundle.diagnosticEvidence?.evidenceKeys || [],
            businessSkillVisualEvidenceControlDecision: diagnosticControlDecision,
            businessSkillImagePlacementVerificationIntake: imagePlacementIntake,
            businessSkillExecutionPlanIntake: executionPlanIntake,
            hasPhotoshopSnapshot: Boolean(bundle.beforeSnapshot || bundle.afterSnapshot),
            hasSnapshotDiff: Boolean(bundle.snapshotDiff),
            toolCount: bundle.tools.length,
            changedLayerCount
        },
        summary: formatReportSummary(acceptanceCase, status, issueLayers, blockers, warnings)
    };
}

export function formatAgentAcceptanceReportMarkdown(report: AgentAcceptanceReport): string {
    const lines = [
        `# Agent Acceptance Report: ${report.caseId}`,
        '',
        `- status: ${report.status}`,
        `- title: ${report.title}`,
        `- summary: ${report.summary}`,
        `- issueLayers: ${report.issueLayers.length ? report.issueLayers.join(', ') : 'none'}`,
        '',
        '## Evidence',
        '',
        `- lifecycle: ${report.evidence.hasLifecycle}`,
        `- agentIntentDecisionIntake: ${report.evidence.agentIntentDecisionIntake?.status || 'none'}`,
        `- agentExecutionLifecycleSnapshot: ${report.evidence.agentExecutionLifecycleSnapshot?.phase || 'none'}`,
        `- executionSummary: ${report.evidence.hasExecutionSummary}`,
        `- diagnosticEvidence: ${report.evidence.hasDiagnosticEvidence}`,
        `- diagnosticEvidenceKeys: ${report.evidence.diagnosticEvidenceKeys.length ? report.evidence.diagnosticEvidenceKeys.join(', ') : 'none'}`,
        `- businessSkillVisualEvidenceControlDecision: ${report.evidence.businessSkillVisualEvidenceControlDecision?.decision || 'none'}`,
        `- businessSkillImagePlacementVerificationIntake: ${report.evidence.businessSkillImagePlacementVerificationIntake?.status || 'none'}`,
        `- businessSkillExecutionPlanIntake: ${report.evidence.businessSkillExecutionPlanIntake?.status || 'none'}`,
        `- photoshopSnapshot: ${report.evidence.hasPhotoshopSnapshot}`,
        `- snapshotDiff: ${report.evidence.hasSnapshotDiff}`,
        `- toolCount: ${report.evidence.toolCount}`,
        `- changedLayerCount: ${report.evidence.changedLayerCount ?? 'n/a'}`,
        '',
        '## Checks',
        ''
    ];

    for (const check of report.checks) {
        lines.push(`- [${check.status}] ${check.id} (${check.layer}): ${check.reason || check.label}`);
    }

    if (report.blockers.length > 0) {
        lines.push('', '## Blockers', '');
        for (const blocker of report.blockers) {
            lines.push(`- ${blocker}`);
        }
    }

    if (report.warnings.length > 0) {
        lines.push('', '## Warnings', '');
        for (const warning of report.warnings) {
            lines.push(`- ${warning}`);
        }
    }

    return `${lines.join('\n')}\n`;
}

function checkLifecycle(
    acceptanceCase: AgentAcceptanceCase,
    bundle: AgentRunDebugBundle
): AgentAcceptanceCheck {
    if (bundle.lifecycle) {
        return passed('lifecycle-present', 'Debug bundle includes agentRequestLifecycle.', 'routing');
    }
    if (acceptanceCase.mode === 'offline') {
        return needsReview('lifecycle-present', 'Offline case has no lifecycle evidence.', 'routing');
    }
    return failed('lifecycle-present', 'Runtime case must include agentRequestLifecycle.', 'routing');
}

function checkAgentExecutionLifecycleSnapshot(
    snapshot: AgentExecutionLifecycleSnapshot
): AgentAcceptanceCheck {
    if (isAgentExecutionLifecycleBoundaryOk(snapshot) === true) {
        return passed(
            'agent-execution-lifecycle-snapshot',
            'Agent execution lifecycle snapshot keeps evidence boundaries.',
            'verification'
        );
    }
    return failed(
        'agent-execution-lifecycle-snapshot',
        'Agent execution lifecycle snapshot violated no-provider/no-Photoshop/no-reasoning boundaries.',
        'verification'
    );
}

function checkRoute(
    acceptanceCase: AgentAcceptanceCase,
    bundle: AgentRunDebugBundle
): AgentAcceptanceCheck | undefined {
    const expected = acceptanceCase.expectation.route;
    if (!expected) return undefined;
    const actual = bundle.lifecycle?.decision.route;
    if (actual === expected) return passed('route', 'Route matched expectation.', 'routing', expected, actual);
    return failed('route', 'Route did not match expectation.', 'routing', expected, actual);
}

function checkSkill(
    acceptanceCase: AgentAcceptanceCase,
    bundle: AgentRunDebugBundle
): AgentAcceptanceCheck | undefined {
    const expected = acceptanceCase.expectation.skillId;
    if (!expected) return undefined;
    const actual = bundle.lifecycle?.decision.skillId;
    if (actual === expected) return passed('skill', 'Skill matched expectation.', 'routing', expected, actual);
    return failed('skill', 'Skill did not match expectation.', 'routing', expected, actual);
}

function checkExecutionKind(
    acceptanceCase: AgentAcceptanceCase,
    bundle: AgentRunDebugBundle
): AgentAcceptanceCheck | undefined {
    const expected = acceptanceCase.expectation.executionKind;
    if (!expected) return undefined;
    const actual = bundle.lifecycle?.execution.kind;
    if (actual === expected) return passed('execution-kind', 'Execution kind matched expectation.', 'tool', expected, actual);
    return failed('execution-kind', 'Execution kind did not match expectation.', 'tool', expected, actual);
}

function checkToolUsage(
    acceptanceCase: AgentAcceptanceCase,
    bundle: AgentRunDebugBundle
): AgentAcceptanceCheck {
    const shouldUseTools = acceptanceCase.expectation.shouldUseTools === true;
    const actualCount = bundle.tools.length || Number(bundle.executionSummary?.toolCallCount || 0);
    if (shouldUseTools && actualCount > 0) return passed('tool-usage', 'Expected tool usage is present.', 'tool');
    if (!shouldUseTools && actualCount === 0) return passed('tool-usage', 'No tool usage expected or observed.', 'tool');
    if (shouldUseTools) return failed('tool-usage', 'Expected tool usage, but no tool evidence was found.', 'tool', true, actualCount);
    return failed('tool-usage', 'Unexpected tool usage for a non-execution request.', 'tool', false, actualCount);
}

function checkExecutionSummary(
    acceptanceCase: AgentAcceptanceCase,
    bundle: AgentRunDebugBundle
): AgentAcceptanceCheck {
    const expected = acceptanceCase.expectation.expectedExecutionStatus;
    const summary = bundle.executionSummary;
    if (!summary && !expected) {
        return passed(
            'execution-summary',
            'No executionSummary is required for this acceptance case.',
            'verification'
        );
    }
    if (!summary) return needsReview('execution-summary', 'No executionSummary is available.', 'verification');
    if (!expected) return passed('execution-summary', 'Execution summary is available.', 'verification');
    if (summary.status === expected) {
        return passed('execution-summary', 'Execution status matched expectation.', 'verification', expected, summary.status);
    }
    return failed('execution-summary', 'Execution status did not match expectation.', 'verification', expected, summary.status);
}

function checkDocumentChange(
    acceptanceCase: AgentAcceptanceCase,
    bundle: AgentRunDebugBundle
): AgentAcceptanceCheck {
    const shouldChange = acceptanceCase.expectation.shouldChangeDocument === true;
    if (!shouldChange) return passed('document-change', 'No document change expected for this case.', 'photoshop');
    if (!bundle.snapshotDiff) {
        return needsReview('document-change', 'Document change expected but no snapshot diff is available.', 'photoshop');
    }
    if (!bundle.snapshotDiff.comparable) {
        return needsReview('document-change', `Snapshot diff is not comparable: ${bundle.snapshotDiff.issues.join('; ')}`, 'photoshop');
    }
    const changed = bundle.snapshotDiff.summary.added + bundle.snapshotDiff.summary.removed + bundle.snapshotDiff.summary.changed;
    if (changed > 0) return passed('document-change', 'Snapshot diff shows document changes.', 'photoshop');
    return failed('document-change', 'Document change expected, but snapshot diff found no changes.', 'photoshop');
}

function checkDiagnosticControlDecision(bundle: AgentRunDebugBundle): AgentAcceptanceCheck | undefined {
    const decision = extractDiagnosticControlDecision(bundle.diagnosticEvidence);
    if (!decision) return undefined;
    if (decision.canClaimDesignQuality !== false) {
        return failed(
            'business-visual-control-no-quality-claim',
            'Business visual control decision must keep canClaimDesignQuality=false.',
            'verification',
            false,
            decision.canClaimDesignQuality
        );
    }
    if (decision.resultEvidenceOnly !== true) {
        return failed(
            'business-visual-control-result-only',
            'Business visual control decision must keep resultEvidenceOnly=true.',
            'verification',
            true,
            decision.resultEvidenceOnly
        );
    }
    return passed(
        'business-visual-control-boundary',
        'Business visual control decision keeps result-only and no-quality-claim boundaries.',
        'verification'
    );
}

function checkAgentIntentDecisionIntake(
    intake: AgentIntentDecisionIntake | undefined
): AgentAcceptanceCheck | undefined {
    if (!intake) return undefined;
    if (isAgentIntentDecisionBoundaryOk(intake) !== true) {
        return failed(
            'agent-intent-decision-intake-boundary',
            'Agent intent decision intake must stay hidden, evidence-only and non-executing.',
            'verification'
        );
    }
    return passed(
        'agent-intent-decision-intake-boundary',
        'Agent intent decision intake keeps hidden evidence and no-execution boundaries.',
        'verification'
    );
}

function checkBusinessSkillEvidenceIntake(
    id: string,
    intake: AgentAcceptanceBusinessSkillEvidenceIntake | undefined
): AgentAcceptanceCheck | undefined {
    if (!intake) return undefined;
    if (intake.canClaimDesignQuality !== false) {
        return failed(
            `${id}-no-quality-claim`,
            `${id} must keep canClaimDesignQuality=false.`,
            'verification',
            false,
            intake.canClaimDesignQuality
        );
    }
    if (intake.userVisible !== false) {
        return failed(
            `${id}-hidden`,
            `${id} must stay hidden and userVisible=false.`,
            'ux',
            false,
            intake.userVisible
        );
    }
    if (intake.evidenceOnly !== true) {
        return failed(
            `${id}-evidence-only`,
            `${id} must stay evidenceOnly=true.`,
            'verification',
            true,
            intake.evidenceOnly
        );
    }
    return passed(
        `${id}-boundary`,
        `${id} keeps hidden, evidence-only and no-quality-claim boundaries.`,
        'verification'
    );
}

function checkVisibleThinking(bundle: AgentRunDebugBundle): AgentAcceptanceCheck {
    const visibleThinking = bundle.visibleThinking || [];
    const leaked = visibleThinking.some((item) => {
        const value = item.toLowerCase();
        return value.includes('agentrequestlifecycle')
            || value.includes('routesource')
            || value.includes('executionkind')
            || value.includes('intent router');
    });
    if (!leaked) return passed('visible-thinking-boundary', 'Visible thinking does not expose lifecycle/router internals.', 'ux');
    return failed('visible-thinking-boundary', 'Visible thinking exposes lifecycle/router internals.', 'ux');
}

function extractBusinessSkillEvidenceIntake(
    diagnosticEvidence: AgentDiagnosticEvidence | undefined,
    key: 'businessSkillImagePlacementVerificationIntake' | 'businessSkillExecutionPlanIntake'
): AgentAcceptanceBusinessSkillEvidenceIntake | undefined {
    if (!isRecord(diagnosticEvidence)) return undefined;
    const raw = diagnosticEvidence[key];
    if (!isRecord(raw)) return undefined;
    return {
        status: typeof raw.status === 'string' ? raw.status : undefined,
        evidenceOnly: typeof raw.evidenceOnly === 'boolean' ? raw.evidenceOnly : undefined,
        userVisible: typeof raw.userVisible === 'boolean' ? raw.userVisible : undefined,
        canClaimDesignQuality: typeof raw.canClaimDesignQuality === 'boolean' ? raw.canClaimDesignQuality : undefined,
        requiredNextEvidence: normalizeStringArray(raw.requiredNextEvidence),
        blockers: normalizeStringArray(raw.blockers)
    };
}

function extractDiagnosticControlDecision(
    diagnosticEvidence: AgentDiagnosticEvidence | undefined
): AgentAcceptanceBusinessSkillVisualEvidenceControlDecision | undefined {
    if (!isRecord(diagnosticEvidence)) return undefined;
    const raw = diagnosticEvidence.businessSkillVisualEvidenceControlDecision;
    if (!isRecord(raw)) return undefined;
    const requiredNextEvidence = Array.isArray(raw.requiredNextEvidence)
        ? raw.requiredNextEvidence.map((item) => String(item || '').trim()).filter(Boolean)
        : [];
    return {
        decision: typeof raw.decision === 'string' ? raw.decision : undefined,
        canClaimDesignQuality: typeof raw.canClaimDesignQuality === 'boolean' ? raw.canClaimDesignQuality : undefined,
        resultEvidenceOnly: typeof raw.resultEvidenceOnly === 'boolean' ? raw.resultEvidenceOnly : undefined,
        requiredNextEvidence
    };
}

function formatDiagnosticControlWarnings(
    decision: AgentAcceptanceBusinessSkillVisualEvidenceControlDecision | undefined
): string[] {
    if (!decision?.decision) return [];
    const suffix = decision.requiredNextEvidence.length
        ? `; requiredNextEvidence=${decision.requiredNextEvidence.join(',')}`
        : '';
    return [`business visual evidence control decision: ${decision.decision}${suffix}`];
}

function formatBusinessSkillEvidenceIntakeWarnings(
    label: string,
    intake: AgentAcceptanceBusinessSkillEvidenceIntake | undefined
): string[] {
    if (!intake?.status) return [];
    const parts = [`business skill ${label} evidence: ${intake.status}`];
    if (intake.requiredNextEvidence.length > 0) {
        parts.push(`requiredNextEvidence=${intake.requiredNextEvidence.join(',')}`);
    }
    if (intake.blockers.length > 0) {
        parts.push(`blockers=${intake.blockers.join(',')}`);
    }
    return [parts.join('; ')];
}

function formatAgentIntentDecisionIntakeWarnings(
    intake: AgentIntentDecisionIntake | undefined
): string[] {
    if (!intake) return [];
    const parts = [`agent intent decision evidence: ${intake.status}`];
    if (intake.requiredNextEvidence.length > 0) {
        parts.push(`requiredNextEvidence=${intake.requiredNextEvidence.join(',')}`);
    }
    if (intake.blockers.length > 0) {
        parts.push(`blockers=${intake.blockers.join(',')}`);
    }
    return [parts.join('; ')];
}

function normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => String(item || '').trim())
        .filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deriveReportStatus(checks: AgentAcceptanceCheck[], blockers: string[]): AgentAcceptanceStatus {
    if (blockers.length > 0 || checks.some((check) => check.status === 'failed')) return 'failed';
    if (checks.some((check) => check.status === 'needs_review')) return 'needs_review';
    return 'passed';
}

function collectCheckReasons(checks: AgentAcceptanceCheck[], status: AgentAcceptanceStatus): string[] {
    return checks
        .filter((check) => check.status === status)
        .map((check) => `${check.id}: ${check.reason || check.label}`);
}

function formatReportSummary(
    acceptanceCase: AgentAcceptanceCase,
    status: AgentAcceptanceStatus,
    issueLayers: AgentAcceptanceIssueLayer[],
    blockers: string[],
    warnings: string[]
): string {
    if (status === 'passed') {
        return `验收通过：${acceptanceCase.title}`;
    }
    if (status === 'failed') {
        return `验收失败：${acceptanceCase.title}；问题层级 ${issueLayers.join(', ') || 'unknown'}；阻断 ${blockers.length} 项。`;
    }
    return `需要复核：${acceptanceCase.title}；问题层级 ${issueLayers.join(', ') || 'unknown'}；观察项 ${warnings.length} 项。`;
}

function passed(
    id: string,
    reason: string,
    layer: AgentAcceptanceIssueLayer,
    expected?: unknown,
    actual?: unknown
): AgentAcceptanceCheck {
    return {
        id,
        label: reason,
        status: 'passed',
        layer,
        expected,
        actual,
        reason
    };
}

function failed(
    id: string,
    reason: string,
    layer: AgentAcceptanceIssueLayer,
    expected?: unknown,
    actual?: unknown
): AgentAcceptanceCheck {
    return {
        id,
        label: reason,
        status: 'failed',
        layer,
        expected,
        actual,
        reason
    };
}

function needsReview(
    id: string,
    reason: string,
    layer: AgentAcceptanceIssueLayer,
    expected?: unknown,
    actual?: unknown
): AgentAcceptanceCheck {
    return {
        id,
        label: reason,
        status: 'needs_review',
        layer,
        expected,
        actual,
        reason
    };
}

function sanitizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => String(item || '').trim())
        .filter(Boolean);
}

function deriveExecutionLifecycleStatus(
    executionSummary: AgentAcceptanceExecutionSummary | undefined
): AgentExecutionLifecycleStatus {
    const status = String(executionSummary?.status || '').toLowerCase();
    if (status === 'completed' || status === 'success' || status === 'succeeded') return 'completed';
    if (status === 'failed' || status === 'error') return 'failed';
    if (status === 'cancelled' || status === 'canceled') return 'cancelled';
    return 'running';
}

function deriveActiveToolName(bundle: AgentRunDebugBundle): string | undefined {
    const status = deriveExecutionLifecycleStatus(bundle.executionSummary);
    if (status !== 'running') return undefined;
    const lastTool = bundle.tools[bundle.tools.length - 1];
    return lastTool?.name;
}

function extractToolEventsFromChatSteps(steps: AgentAcceptanceChatStepEvidence[]): AgentAcceptanceToolEvent[] {
    return steps
        .filter((step) => Boolean(step.toolName || step.toolResult))
        .map((step) => ({
            name: String(step.toolName || 'unknown-tool'),
            success: step.toolResult?.success !== false,
            error: step.toolResult?.error,
            acceptanceStatus: step.toolResult?.acceptance?.status
        }));
}
