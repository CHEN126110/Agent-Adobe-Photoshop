#!/usr/bin/env node

/**
 * Live, non-mutating Xiaomi MiMo protocol probe.
 *
 * Verifies the exact history shape used by the Agent after a thinking response
 * reaches its output limit: assistant reasoning_content is passed back intact,
 * including when visible content is empty. The probe never reads or prints an
 * API key and uses only a synthetic in-memory tool.
 *
 * Usage:
 *   MIMO_API_KEY=... node scripts/probe-xiaomi-thinking-continuity.cjs
 */

const assert = require('node:assert/strict');

const API_URL = 'https://api.xiaomimimo.com/v1/chat/completions';
const MODEL = process.env.MIMO_MODEL || 'mimo-v2.5-pro-ultraspeed';
const API_KEY = process.env.MIMO_API_KEY;

const tools = [{
    type: 'function',
    function: {
        name: 'get_probe_status',
        description: 'Return the status of a synthetic protocol continuity probe.',
        parameters: {
            type: 'object',
            properties: {
                label: { type: 'string' }
            },
            required: ['label'],
            additionalProperties: false
        }
    }
}];

function summarizeAssistant(message) {
    return {
        hasContent: typeof message?.content === 'string' && message.content.length > 0,
        contentLength: typeof message?.content === 'string' ? message.content.length : 0,
        hasReasoning: typeof message?.reasoning_content === 'string'
            && message.reasoning_content.length > 0,
        reasoningLength: typeof message?.reasoning_content === 'string'
            ? message.reasoning_content.length
            : 0,
        toolCallCount: Array.isArray(message?.tool_calls) ? message.tool_calls.length : 0
    };
}

async function requestCompletion(messages, options = {}) {
    const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: MODEL,
            messages,
            tools,
            tool_choice: options.toolChoice || 'none',
            max_completion_tokens: options.maxCompletionTokens || 512,
            temperature: 1.0,
            top_p: 0.95,
            stream: false
        }),
        signal: AbortSignal.timeout(60_000)
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const providerMessage = String(payload?.error?.message || payload?.message || 'unknown error')
            .replace(/\s+/g, ' ')
            .slice(0, 240);
        throw new Error(`MiMo HTTP ${response.status}: ${providerMessage}`);
    }

    const choice = payload?.choices?.[0];
    assert(choice?.message, 'MiMo response must contain choices[0].message');
    return {
        message: choice.message,
        finishReason: choice.finish_reason || 'unknown'
    };
}

async function main() {
    assert(API_KEY, 'MIMO_API_KEY is required');

    const messages = [
        {
            role: 'system',
            content: '你是协议探针。只处理合成测试数据，不访问任何真实项目。'
        },
        {
            role: 'user',
            content: '请调用 get_probe_status，label 必须是 continuity-probe。'
        }
    ];

    const toolTurn = await requestCompletion(messages, {
        toolChoice: 'required',
        maxCompletionTokens: 1024
    });
    assert(
        Array.isArray(toolTurn.message.tool_calls) && toolTurn.message.tool_calls.length > 0,
        'The first MiMo turn must produce a synthetic tool call'
    );
    assert(
        typeof toolTurn.message.reasoning_content === 'string'
            && toolTurn.message.reasoning_content.length > 0,
        'Thinking-mode tool call must return reasoning_content'
    );
    messages.push(toolTurn.message);

    for (const toolCall of toolTurn.message.tool_calls) {
        messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({ success: true, status: 'continuity-ok' })
        });
    }

    const constrainedTurn = await requestCompletion(messages, {
        toolChoice: 'none',
        maxCompletionTokens: 32
    });
    assert(
        typeof constrainedTurn.message.reasoning_content === 'string'
            && constrainedTurn.message.reasoning_content.length > 0,
        'Token-constrained thinking turn must expose reasoning_content for pass-through'
    );
    messages.push({
        ...constrainedTurn.message,
        content: typeof constrainedTurn.message.content === 'string'
            ? constrainedTurn.message.content
            : ''
    });
    messages.push({
        role: 'user',
        content: '继续上一轮，用一句简体中文确认协议连续性；不要调用工具。'
    });

    const resumedTurn = await requestCompletion(messages, {
        toolChoice: 'none',
        maxCompletionTokens: 512
    });
    assert(
        typeof resumedTurn.message.content === 'string' && resumedTurn.message.content.length > 0,
        'MiMo must accept the preserved reasoning history and return resumed visible content'
    );

    console.log(JSON.stringify({
        ok: true,
        model: MODEL,
        toolTurn: {
            finishReason: toolTurn.finishReason,
            ...summarizeAssistant(toolTurn.message)
        },
        constrainedTurn: {
            finishReason: constrainedTurn.finishReason,
            ...summarizeAssistant(constrainedTurn.message)
        },
        resumedTurn: {
            finishReason: resumedTurn.finishReason,
            ...summarizeAssistant(resumedTurn.message)
        }
    }, null, 2));
}

main().catch((error) => {
    console.error(`probe failed: ${error?.message || String(error)}`);
    process.exitCode = 1;
});
