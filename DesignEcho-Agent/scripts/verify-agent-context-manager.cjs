#!/usr/bin/env node
"use strict";

const assert = require('assert');
const path = require('path');

const root = path.resolve(__dirname, '..');
require('ts-node').register({ transpileOnly: true, project: path.join(root, 'tsconfig.main.json') });

const { ContextManager } = require(
    path.join(root, 'src', 'renderer', 'services', 'agent-runtime', 'context-manager.ts')
);
const { shouldReplayProviderReasoningContent } = require(
    path.join(root, 'src', 'shared', 'agent-model-transport-policy.ts')
);

function pinnedSystem(content) {
    return {
        role: 'system',
        content,
        contextMetadata: {
            source: 'test-system',
            authority: 'system',
            origin: 'system_policy',
            retention: 'pinned'
        }
    };
}

function currentUser(content) {
    return {
        role: 'user',
        content,
        contextMetadata: {
            source: 'test-user',
            authority: 'user',
            origin: 'current_user_instruction',
            retention: 'pinned'
        }
    };
}

function findToolOutput(messages, callId) {
    for (const message of messages) {
        if (message.role !== 'tool_result') continue;
        const result = (message.toolResults || []).find((item) => item.callId === callId);
        if (result) return result.output;
    }
    return undefined;
}

const underBudgetMessages = [
    pinnedSystem('system'),
    currentUser('goal'),
    { role: 'assistant', content: 'answer' }
];
const underBudgetManager = new ContextManager({ maxTokens: 100, keepRecentRounds: 2 });
const underBudgetDiagnostics = underBudgetManager.prepareWithDiagnostics(underBudgetMessages, 7);
assert.deepStrictEqual(
    underBudgetDiagnostics.messages,
    underBudgetMessages,
    '未超预算的诊断入口不得改写消息顺序或内容'
);
assert.deepStrictEqual(
    {
        beforeEstimatedTokens: underBudgetDiagnostics.beforeEstimatedTokens,
        afterEstimatedTokens: underBudgetDiagnostics.afterEstimatedTokens,
        beforeMessageCount: underBudgetDiagnostics.beforeMessageCount,
        afterMessageCount: underBudgetDiagnostics.afterMessageCount,
        reservedTokens: underBudgetDiagnostics.reservedTokens,
        removedMessageCount: underBudgetDiagnostics.removedMessageCount,
        compacted: underBudgetDiagnostics.compacted
    },
    {
        beforeEstimatedTokens: 11,
        afterEstimatedTokens: 11,
        beforeMessageCount: 3,
        afterMessageCount: 3,
        reservedTokens: 7,
        removedMessageCount: 0,
        compacted: false
    },
    '未超预算时只返回计数诊断，不得伪造裁剪或压缩'
);
const { messages: _underBudgetPreparedMessages, ...underBudgetCountsOnly } = underBudgetDiagnostics;
assert(
    !JSON.stringify(underBudgetCountsOnly).includes('system')
        && !JSON.stringify(underBudgetCountsOnly).includes('goal')
        && !JSON.stringify(underBudgetCountsOnly).includes('answer'),
    '上下文诊断字段不得记录消息正文'
);
assert.deepStrictEqual(
    underBudgetManager.prepare(underBudgetMessages),
    underBudgetMessages,
    '未超预算时不得改写消息顺序或内容'
);
assert.strictEqual(
    underBudgetManager.estimateTotal([{ role: 'assistant', reasoningContent: 'x'.repeat(1_000) }]),
    0,
    '通用 ContextManager 不得假定 Provider 会重放隐藏推理；Provider 特有负载应在适配层计账'
);
assert.strictEqual(
    new ContextManager({
        maxTokens: 100,
        keepRecentRounds: 2,
        includeReasoningContent: true
    }).estimateTotal([{ role: 'assistant', reasoningContent: 'x'.repeat(15) }]),
    10,
    '真实回放 reasoningContent 的 Provider 必须把该字符串计入上下文硬预算'
);
for (const provider of ['deepseek', 'xiaomi', 'openrouter']) {
    assert.strictEqual(
        shouldReplayProviderReasoningContent({ provider, thinkingEnabled: true }),
        true,
        `${provider} 开启思考时必须声明回放 reasoningContent`
    );
}
for (const provider of ['openai', 'openai-codex', 'anthropic', 'google', 'ollama']) {
    assert.strictEqual(
        shouldReplayProviderReasoningContent({ provider, thinkingEnabled: true }),
        false,
        `${provider} 不得为未发送的 reasoningContent 虚占上下文`
    );
}
assert.strictEqual(
    shouldReplayProviderReasoningContent({ provider: 'deepseek', thinkingEnabled: false }),
    false,
    'Provider 关闭思考时不得回放 reasoningContent'
);

const ephemeralMessages = [
    pinnedSystem('system'),
    currentUser('goal'),
    {
        role: 'user',
        content: 'old observation',
        contextMetadata: {
            source: 'old', authority: 'data_only', origin: 'runtime_observation',
            retention: 'ephemeral', scope: 'same-observation'
        }
    },
    {
        role: 'user',
        content: 'new observation',
        contextMetadata: {
            source: 'new', authority: 'data_only', origin: 'runtime_observation',
            retention: 'ephemeral', scope: 'same-observation'
        }
    }
];
const ephemeralPrepared = underBudgetManager.prepare(ephemeralMessages);
assert(!ephemeralPrepared.some((message) => message.content === 'old observation'));
assert(ephemeralPrepared.some((message) => message.content === 'new observation'));

const protocolMessages = [
    pinnedSystem('system'),
    currentUser('goal'),
    {
        role: 'assistant',
        toolCalls: [{ id: 'call-ok', name: 'read', arguments: { id: 1 } }]
    },
    {
        role: 'tool_result',
        toolResults: [{ callId: 'call-ok', success: true, output: { summary: 'ok' } }]
    },
    {
        role: 'assistant',
        toolCalls: [{ id: 'call-incomplete', name: 'read', arguments: {} }]
    },
    {
        role: 'tool_result',
        toolResults: [{ callId: 'orphan', success: true, output: { summary: 'orphan' } }]
    }
];
const protocolPrepared = underBudgetManager.prepare(protocolMessages);
assert(protocolPrepared.some((message) => message.toolCalls?.[0]?.id === 'call-ok'));
assert(protocolPrepared.some((message) => message.toolResults?.[0]?.callId === 'call-ok'));
assert(!protocolPrepared.some((message) => message.toolCalls?.[0]?.id === 'call-incomplete'));
assert(!protocolPrepared.some((message) => message.toolResults?.[0]?.callId === 'orphan'));

const exactBoundaryMessages = [pinnedSystem('a'), currentUser('b')];
assert.strictEqual(
    new ContextManager({ maxTokens: 2, keepRecentRounds: 0 }).prepare(exactBoundaryMessages).length,
    2,
    '每条消息分别取整后恰好等于预算时必须通过'
);
let protectedOverflow;
try {
    new ContextManager({ maxTokens: 1, keepRecentRounds: 0 }).prepare(exactBoundaryMessages);
} catch (error) {
    protectedOverflow = error;
}
assert.strictEqual(protectedOverflow?.code, 'context_window_budget_exceeded');
assert.strictEqual(protectedOverflow?.contextAssessment?.estimatedMessageTokens, 2);
assert.strictEqual(protectedOverflow?.contextAssessment?.overByTokens, 1);

const evidenceCallId = 'state-evidence';
const evidenceHistory = [
    pinnedSystem('system'),
    currentUser('continue the design'),
    {
        role: 'assistant',
        toolCalls: [{ id: evidenceCallId, name: 'matchDetailPageContent', arguments: {} }]
    },
    {
        role: 'tool_result',
        toolResults: [{
            callId: evidenceCallId,
            success: true,
            output: {
                success: true,
                summary: `large-result-${'x'.repeat(4_000)}`,
                projectRoot: 'C:/fixture/project',
                historyStateRef: { documentId: 22, historyStateId: 49 },
                data: {
                    selectionReceipt: {
                        version: 'detail-asset-selection-receipt/v0',
                        screenId: 7,
                        placeholderLayerId: 42,
                        candidateSetId: 'detail-candidates:7:42:fixture',
                        candidateId: 'detail-candidates:7:42:fixture:2',
                        selectedAssetPath: 'C:/fixture/second.jpg',
                        selectedBy: 'agent',
                        decisionId: 'agent-choice-second'
                    },
                    targetBounds: { x: 100, y: 120, width: 640, height: 720 }
                }
            }
        }]
    }
];
const evidenceManager = new ContextManager({ maxTokens: 1_000, keepRecentRounds: 1 });
const evidencePrepared = evidenceManager.prepare(evidenceHistory, 50);
const compressedEvidence = findToolOutput(evidencePrepared, evidenceCallId);
assert.strictEqual(compressedEvidence?.compressedHistoricalToolResult, true);
assert.strictEqual(compressedEvidence?.contextEvidence?.projectRoot, 'C:/fixture/project');
assert.deepStrictEqual(
    compressedEvidence?.contextEvidence?.historyStateRef,
    { documentId: 22, historyStateId: 49 }
);
assert.strictEqual(
    compressedEvidence?.contextEvidence?.data?.selectionReceipt?.candidateId,
    'detail-candidates:7:42:fixture:2'
);
assert.strictEqual(
    compressedEvidence?.contextEvidence?.data?.targetBounds?.width,
    640
);
assert(
    evidenceManager.estimateTotal(evidencePrepared) + 50 <= 1_000,
    '压缩后的消息与预留必须落在真实上下文预算内'
);

const unresolvedAssetCallId = 'detail-assets-required';
const assetDecisionRequests = Array.from({ length: 6 }, (_, requestIndex) => {
    const screenId = requestIndex + 1;
    const placeholderLayerId = 100 + requestIndex;
    const candidateSetId = `detail-candidates:${screenId}:${placeholderLayerId}:fixture`;
    return {
        screenId,
        screenName: `screen-${screenId}`,
        placeholderLayerId,
        placeholderLayerName: `placeholder-${placeholderLayerId}`,
        candidates: Array.from({ length: 5 }, (_, candidateIndex) => ({
            candidateSetId,
            candidateId: `${candidateSetId}:${candidateIndex + 1}`,
            imagePath: `C:/fixture/screen-${screenId}/candidate-${candidateIndex + 1}.jpg`,
            score: 100 - candidateIndex,
            reasons: [`rank-${candidateIndex + 1}`],
            placementSafetyEligible: candidateIndex % 2 === 0,
            needsMatting: candidateIndex % 2 !== 0,
            assetUsageDecision: {
                visualObserved: true,
                visualRole: candidateIndex === 0 ? 'model_product' : 'detail',
                backgroundType: 'scene',
                directUseSuitability: candidateIndex === 0 ? 'direct' : 'conditional',
                sourceTreatment: candidateIndex === 0 ? 'direct_place' : 'requires_visual_review',
                automaticPlacementEligible: candidateIndex === 0,
                reason: `candidate-safety-${candidateIndex + 1}`
            }
        }))
    };
});
const unresolvedAssetHistory = [
    pinnedSystem('system'),
    currentUser('continue the detail page'),
    {
        role: 'assistant',
        toolCalls: [{ id: unresolvedAssetCallId, name: 'matchDetailPageContent', arguments: {} }]
    },
    {
        role: 'tool_result',
        toolResults: [{
            callId: unresolvedAssetCallId,
            success: true,
            output: {
                success: true,
                message: `selection-required-${'x'.repeat(30_000)}`,
                data: {
                    status: 'detail_asset_selection_required',
                    projectPath: 'C:/fixture/project',
                    fillPlans: [{ privateExecutionPayload: 'must-not-survive-compression' }],
                    assetDecisionRequests
                }
            }
        }]
    }
];
const unresolvedAssetManager = new ContextManager({ maxTokens: 8_000, keepRecentRounds: 1 });
const unresolvedAssetPrepared = unresolvedAssetManager.prepare(unresolvedAssetHistory, 50);
const compressedAssetHandoff = findToolOutput(unresolvedAssetPrepared, unresolvedAssetCallId);
const compressedAssetData = compressedAssetHandoff?.contextEvidence?.data;
assert.strictEqual(compressedAssetHandoff?.compressedHistoricalToolResult, true);
assert.strictEqual(compressedAssetData?.status, 'detail_asset_selection_required');
assert.strictEqual(compressedAssetData?.assetDecisionRequestCount, 6);
assert.strictEqual(compressedAssetData?.omittedAssetDecisionRequestCount, 0);
assert.strictEqual(compressedAssetData?.assetDecisionRequests?.length, 6);
assert.strictEqual(compressedAssetData?.assetDecisionRequests?.[5]?.screenId, 6);
assert.strictEqual(compressedAssetData?.assetDecisionRequests?.[5]?.placeholderLayerId, 105);
assert.strictEqual(
    compressedAssetData?.assetDecisionRequests?.[5]?.candidateSetId,
    'detail-candidates:6:105:fixture'
);
assert.strictEqual(compressedAssetData?.assetDecisionRequests?.[5]?.candidateCount, 5);
assert.strictEqual(compressedAssetData?.assetDecisionRequests?.[5]?.omittedCandidateCount, 2);
assert.strictEqual(compressedAssetData?.assetDecisionRequests?.[5]?.candidates?.length, 3);
assert.strictEqual(
    compressedAssetData?.assetDecisionRequests?.[5]?.candidates?.[2]?.candidateId,
    'detail-candidates:6:105:fixture:3'
);
assert.strictEqual(
    compressedAssetData?.assetDecisionRequests?.[5]?.candidates?.[2]?.imagePath,
    'C:/fixture/screen-6/candidate-3.jpg'
);
assert.strictEqual(
    compressedAssetData?.assetDecisionRequests?.[5]?.candidates?.[2]?.safety?.placementSafetyEligible,
    true
);
assert.strictEqual(
    compressedAssetData?.assetDecisionRequests?.[5]?.candidates?.[2]?.safety?.sourceTreatment,
    'requires_visual_review'
);
assert.strictEqual(compressedAssetData?.fillPlans, undefined, '不得把 fillPlans 泛开放进历史上下文');
assert(
    unresolvedAssetManager.estimateTotal(unresolvedAssetPrepared) + 50 <= 8_000,
    '有界候选 handoff 压缩后必须仍满足上下文预算'
);

const longHistory = [pinnedSystem('system'), currentUser('goal')];
for (let index = 0; index < 120; index += 1) {
    const callId = `long-${index}`;
    longHistory.push({
        role: 'assistant',
        toolCalls: [{ id: callId, name: 'read', arguments: { index } }]
    });
    longHistory.push({
        role: 'tool_result',
        toolResults: [{
            callId,
            success: true,
            output: { success: true, summary: `result-${index}-${'x'.repeat(500)}` }
        }]
    });
}
const longManager = new ContextManager({ maxTokens: 600, keepRecentRounds: 3 });
const longDiagnostics = longManager.prepareWithDiagnostics(longHistory, 50);
const longPrepared = longDiagnostics.messages;
assert.strictEqual(longDiagnostics.beforeMessageCount, longHistory.length);
assert.strictEqual(longDiagnostics.afterMessageCount, longPrepared.length);
assert.strictEqual(
    longDiagnostics.removedMessageCount,
    longHistory.length - longPrepared.length,
    '长历史诊断必须准确报告删除的消息数量'
);
assert(longDiagnostics.beforeEstimatedTokens > longDiagnostics.afterEstimatedTokens);
assert(longDiagnostics.removedMessageCount > 0);
assert.strictEqual(longDiagnostics.reservedTokens, 50);
assert.strictEqual(longDiagnostics.compacted, true);
const { messages: _longPreparedMessages, ...longCountsOnly } = longDiagnostics;
assert(
    !JSON.stringify(longCountsOnly).includes('result-119-'),
    '裁剪诊断字段不得记录历史 Tool 正文'
);
for (let index = 0; index < longPrepared.length; index += 1) {
    const message = longPrepared[index];
    if (!message.toolCalls?.length) continue;
    const result = longPrepared[index + 1];
    assert(result?.role === 'tool_result', '长历史裁剪不得留下孤立 Tool call');
    const actualIds = new Set((result.toolResults || []).map((item) => item.callId));
    for (const call of message.toolCalls) assert(actualIds.has(call.id));
}
assert(longManager.estimateTotal(longPrepared) + 50 <= 600);

console.log('agent-context-manager: capacity, protocol, freshness, and structured evidence checks passed');
