/**
 * Thin owner adapter for Runtime Accounting before and after staged Runtime binding.
 *
 * It never owns budgets, permissions, stages or task results. Before binding it owns one
 * unscoped RuntimeAccountingLedger; after binding RuntimeSession.accounting is the only owner.
 */

import {
    buildRuntimeAccountingDigest,
    createRuntimeAccountingLedger,
    measureRuntimeModelOutputShape,
    recordRuntimeModelCall,
    recordRuntimePerformanceUsage,
    recordRuntimeProviderOutputRecoveryAttempt,
    recordRuntimeProviderOutputRecoveryOutcome,
    recordRuntimeRecoveryAttempt,
    recordRuntimeToolCall,
    type RuntimeAccountingDigest,
    type RuntimeAccountingLedger,
    type RuntimeContextPreparationShape,
    type RuntimeModelCallKind,
    type RuntimeModelRequestMode,
    type RuntimeModelVisualInput,
    type RuntimePerformanceUsage,
    type RuntimeProviderOutputRecoveryFailureReason,
    type RuntimeRequestedThinking
} from '../../../shared/agent-runtime-v5/runtime-accounting';
import type { ModelReasoningEffort } from '../../../shared/config/models.config';
import {
    recordRuntimeSessionModelCall,
    recordRuntimeSessionPerformanceUsage,
    recordRuntimeSessionProviderOutputRecoveryAttempt,
    recordRuntimeSessionProviderOutputRecoveryOutcome,
    recordRuntimeSessionRecoveryAttempt,
    recordRuntimeSessionToolCall,
    type RuntimeSession
} from '../../../shared/agent-runtime-v5/runtime-session';
import { readProviderTransportMetrics } from '../../../shared/provider-transport-metrics';
import type { ModelTransportAttemptAccounting } from './types';

interface ModelAccountingInput {
    callKind: RuntimeModelCallKind;
    durationMs: number;
    succeeded: boolean;
    requestMode?: RuntimeModelRequestMode;
    agentIteration?: number;
    runtimeGeneration?: number;
    requestStartedActiveMs?: number;
    transportAttemptIndex?: number;
    transportAttemptCount?: number;
    requestedThinking?: RuntimeRequestedThinking;
    requestedReasoningEffort?: ModelReasoningEffort;
    requestedMaxTokens?: number;
    contextPreparation?: RuntimeContextPreparationShape;
    visualInput?: RuntimeModelVisualInput;
    usage?: ModelTransportAttemptAccounting['usage'];
    failureKind?: ModelTransportAttemptAccounting['failureKind'];
    providerCode?: string;
    status?: number;
    promptShape?: Parameters<typeof recordRuntimeModelCall>[0]['promptShape'];
    outcome?: unknown;
}

interface ToolAccountingInput {
    durationMs: number;
    succeeded: boolean;
}

export class ActiveRuntimeAccounting {
    private unboundLedger: RuntimeAccountingLedger | undefined;

    beginRun(startedAtMs: number, runtimeSession: RuntimeSession | undefined): void {
        this.unboundLedger = runtimeSession
            ? undefined
            : createRuntimeAccountingLedger(new Date(startedAtMs).toISOString());
    }

    readUnboundLedgerForTransfer(): RuntimeAccountingLedger | undefined {
        return this.unboundLedger;
    }

    releaseUnboundLedgerAfterBinding(): void {
        this.unboundLedger = undefined;
    }

    recordModelCall(
        runtimeSession: RuntimeSession | undefined,
        input: ModelAccountingInput
    ): RuntimeSession | undefined {
        const candidateAttempts = (input.outcome as {
            transportAttempts?: ModelTransportAttemptAccounting[];
        } | null)?.transportAttempts;
        const transportAttempts = Array.isArray(candidateAttempts)
            ? candidateAttempts
                .filter((attempt) => (
                    attempt
                    && Number.isFinite(attempt.durationMs)
                    && typeof attempt.succeeded === 'boolean'
                ))
                .slice(0, 4)
            : [];
        if (transportAttempts.length > 0) {
            let currentSession = runtimeSession;
            let outputAttemptIndex = -1;
            if (input.succeeded) {
                for (let index = transportAttempts.length - 1; index >= 0; index -= 1) {
                    if (transportAttempts[index].succeeded) {
                        outputAttemptIndex = index;
                        break;
                    }
                }
            }
            for (let index = 0; index < transportAttempts.length; index += 1) {
                const attempt = transportAttempts[index];
                const providerTransportMetrics = readProviderTransportMetrics(
                    attempt.providerTransportMetrics
                );
                currentSession = this.recordSingleModelCall(currentSession, {
                    callKind: input.callKind,
                    durationMs: Math.max(0, Math.floor(attempt.durationMs)),
                    succeeded: attempt.succeeded,
                    requestMode: input.requestMode,
                    agentIteration: input.agentIteration,
                    runtimeGeneration: input.runtimeGeneration,
                    requestStartedActiveMs: input.requestStartedActiveMs,
                    transportAttemptIndex: index + 1,
                    transportAttemptCount: transportAttempts.length,
                    requestedThinking: input.requestedThinking,
                    requestedReasoningEffort: input.requestedReasoningEffort,
                    requestedMaxTokens: input.requestedMaxTokens,
                    contextPreparation: input.contextPreparation,
                    visualInput: input.visualInput,
                    usage: attempt.usage,
                    failureKind: attempt.failureKind,
                    providerCode: attempt.providerCode,
                    status: attempt.status,
                    promptShape: input.promptShape && providerTransportMetrics
                        ? { ...input.promptShape, providerTransportMetrics }
                        : input.promptShape,
                    ...(index === outputAttemptIndex ? { outcome: input.outcome } : {})
                });
            }
            for (let index = 1; index < transportAttempts.length; index += 1) {
                currentSession = this.recordRecoveryAttempt(currentSession);
            }
            return currentSession;
        }
        return this.recordSingleModelCall(runtimeSession, {
            ...input,
            transportAttemptIndex: 1,
            transportAttemptCount: 1
        });
    }

    private recordSingleModelCall(
        runtimeSession: RuntimeSession | undefined,
        input: ModelAccountingInput
    ): RuntimeSession | undefined {
        const outputShape = input.succeeded
            ? measureRuntimeModelOutputShape(input.outcome)
            : undefined;
        const { outcome: _outcome, ...accountingInput } = input;
        const persistedInput = {
            ...accountingInput,
            ...(outputShape ? { outputShape } : {})
        };
        if (runtimeSession) {
            this.unboundLedger = undefined;
            return recordRuntimeSessionModelCall({ session: runtimeSession, ...persistedInput });
        }
        if (this.unboundLedger) {
            this.unboundLedger = recordRuntimeModelCall({ ledger: this.unboundLedger, ...persistedInput });
        }
        return undefined;
    }

    recordToolCall(
        runtimeSession: RuntimeSession | undefined,
        input: ToolAccountingInput
    ): RuntimeSession | undefined {
        if (runtimeSession) {
            this.unboundLedger = undefined;
            return recordRuntimeSessionToolCall({ session: runtimeSession, ...input });
        }
        if (this.unboundLedger) {
            this.unboundLedger = recordRuntimeToolCall({ ledger: this.unboundLedger, ...input });
        }
        return undefined;
    }

    recordRecoveryAttempt(runtimeSession: RuntimeSession | undefined): RuntimeSession | undefined {
        if (runtimeSession) {
            this.unboundLedger = undefined;
            return recordRuntimeSessionRecoveryAttempt({ session: runtimeSession });
        }
        if (this.unboundLedger) {
            this.unboundLedger = recordRuntimeRecoveryAttempt(this.unboundLedger);
        }
        return undefined;
    }

    recordProviderOutputRecoveryAttempt(
        runtimeSession: RuntimeSession | undefined
    ): RuntimeSession | undefined {
        if (runtimeSession) {
            this.unboundLedger = undefined;
            return recordRuntimeSessionProviderOutputRecoveryAttempt({ session: runtimeSession });
        }
        if (this.unboundLedger) {
            this.unboundLedger = recordRuntimeProviderOutputRecoveryAttempt(this.unboundLedger);
        }
        return undefined;
    }

    recordProviderOutputRecoveryOutcome(
        runtimeSession: RuntimeSession | undefined,
        outcome: 'succeeded' | RuntimeProviderOutputRecoveryFailureReason
    ): RuntimeSession | undefined {
        if (runtimeSession) {
            this.unboundLedger = undefined;
            return recordRuntimeSessionProviderOutputRecoveryOutcome({
                session: runtimeSession,
                outcome
            });
        }
        if (this.unboundLedger) {
            this.unboundLedger = recordRuntimeProviderOutputRecoveryOutcome(
                this.unboundLedger,
                outcome
            );
        }
        return undefined;
    }

    synchronizePerformanceUsage(
        runtimeSession: RuntimeSession | undefined,
        usage: RuntimePerformanceUsage
    ): RuntimeSession | undefined {
        if (runtimeSession) {
            this.unboundLedger = undefined;
            return recordRuntimeSessionPerformanceUsage({ session: runtimeSession, usage });
        }
        if (this.unboundLedger) {
            this.unboundLedger = recordRuntimePerformanceUsage({
                ledger: this.unboundLedger,
                usage
            });
        }
        return undefined;
    }

    readDigest(runtimeSession?: RuntimeSession): RuntimeAccountingDigest | undefined {
        const ledger = runtimeSession?.accounting || this.unboundLedger;
        return ledger ? buildRuntimeAccountingDigest({ ledger }) : undefined;
    }
}
