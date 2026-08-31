const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
require('ts-node').register({ transpileOnly: true, project: path.join(root, 'tsconfig.main.json') });

const {
    projectCodexSerializedOutgoingImages,
    buildCodexSuccessfulVisualPresentationReceipt
} = require(path.join(root, 'src/main/services/codex-visual-presentation-receipt.ts'));
const {
    buildOpenAICompatibleSuccessfulVisualPresentationReceipt,
    projectOpenAICompatibleSerializedOutgoingImages
} = require(path.join(root, 'src/main/services/openai-compatible-visual-presentation-receipt.ts'));
const {
    projectModelVisualPresentationReceiptRef,
    projectSerializedVisualImageDataUrl,
    readModelVisualPresentationReceipt
} = require(path.join(root, 'src/shared/model-visual-presentation-receipt.ts'));
const {
    sha256BytesHex,
    sha256Hex
} = require(path.join(root, 'src/shared/agent-runtime-v5/content-hash.ts'));
const { OpenAIAdapter } = require(path.join(root, 'src/main/services/provider-adapters/openai-adapter.ts'));
const { AnthropicAdapter } = require(path.join(root, 'src/main/services/provider-adapters/anthropic-adapter.ts'));
const { GeminiAdapter } = require(path.join(root, 'src/main/services/provider-adapters/gemini-adapter.ts'));
const { OllamaAdapter } = require(path.join(root, 'src/main/services/provider-adapters/ollama-adapter.ts'));
const { ModelService } = require(path.join(root, 'src/main/services/model-service.ts'));
const {
    resolveModelReasoningEffort
} = require(path.join(root, 'src/shared/model-reasoning-effort.ts'));

let failed = 0;

function check(condition, label, detail) {
    if (condition) {
        console.log(`  ✓ ${label}`);
        return;
    }
    failed += 1;
    console.error(`  ✗ ${label}${detail ? `：${detail}` : ''}`);
}

function dataUrl(mediaType, bytes) {
    return `data:${mediaType};base64,${Buffer.from(bytes).toString('base64')}`;
}

function nodeSha256(bytes) {
    return crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

const historyBytes = Uint8Array.from([0, 255, 128, 1, 2, 3, 4]);
const currentJpegBytes = Uint8Array.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1]);
const currentWebpBytes = Uint8Array.from([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]);

console.log('[1] 原始字节 SHA-256 与 Node crypto 一致，不对 Base64 文本取摘要');
check(
    sha256BytesHex(historyBytes) === nodeSha256(historyBytes)
        && sha256Hex('abc') === crypto.createHash('sha256').update('abc', 'utf8').digest('hex')
        && sha256BytesHex(historyBytes) !== sha256Hex(Buffer.from(historyBytes).toString('base64')),
    'decoded-byte digest 语义正确'
);

const prepared = {
    historyItems: [{
        type: 'message',
        role: 'user',
        content: [
            { type: 'input_text', text: '历史输入' },
            { type: 'input_image', image_url: dataUrl('image/png', historyBytes) }
        ]
    }],
    currentInput: [
        { type: 'text', text: '本轮评分', text_elements: [] },
        { type: 'image', url: dataUrl('image/jpeg', currentJpegBytes) },
        { type: 'image', url: dataUrl('image/webp', currentWebpBytes) }
    ]
};
const candidateKeys = ['history:one', 'judge:final', 'judge:candidate'];

console.log('[2] Codex 已序列化 outgoing 按历史→本轮、块内原序形成逐图回执');
const projections = projectCodexSerializedOutgoingImages(prepared);
const receipt = buildCodexSuccessfulVisualPresentationReceipt({
    prepared,
    candidateKeys,
    workerGeneration: 7,
    threadId: 'thread-internal-1',
    turnId: 'turn-scoring-1'
});
check(
    projections?.length === 3
        && receipt?.imageCount === 3
        && receipt.images.map((item) => item.candidateKey).join('|') === candidateKeys.join('|')
        && receipt.images[0].mediaType === 'image/png'
        && receipt.images[1].mediaType === 'image/jpeg'
        && receipt.images[2].mediaType === 'image/webp'
        && receipt.images[0].decodedByteSha256 === nodeSha256(historyBytes)
        && receipt.images[1].decodedByteSha256 === nodeSha256(currentJpegBytes)
        && receipt.images[2].decodedByteSha256 === nodeSha256(currentWebpBytes)
        && receipt.images[1].decodedByteLength === currentJpegBytes.length,
    '回执只绑定实际 outgoing 顺序、媒体类型与解码字节',
    JSON.stringify(receipt)
);

console.log('[3] attemptId 绑定首次 Provider turn，原始 thread/turn 不出现在回执');
const anotherAttempt = buildCodexSuccessfulVisualPresentationReceipt({
    prepared,
    candidateKeys,
    workerGeneration: 7,
    threadId: 'thread-internal-1',
    turnId: 'turn-scoring-2'
});
const serializedReceipt = JSON.stringify(receipt);
check(
    /^[a-f0-9]{64}$/.test(receipt?.attemptId || '')
        && receipt?.attemptId !== anotherAttempt?.attemptId
        && !serializedReceipt.includes('thread-internal-1')
        && !serializedReceipt.includes('turn-scoring-1'),
    '成功 attempt 使用不可逆身份且不会跨 turn 复用'
);

console.log('[4] 入站 contentBlocks 形状不能冒充 Codex outgoing serializer');
const inboundOnly = {
    historyItems: [],
    currentInput: [{
        type: 'image',
        data: Buffer.from(currentJpegBytes).toString('base64'),
        mediaType: 'image/jpeg'
    }]
};
check(
    projectCodexSerializedOutgoingImages(inboundOnly) === undefined
        && !buildCodexSuccessfulVisualPresentationReceipt({
            prepared: inboundOnly,
            candidateKeys: ['should-not-sign'],
            workerGeneration: 1,
            threadId: 'thread',
            turnId: 'turn'
        }),
    '只有 input_image.image_url / image.url 的真实出站形状有资格签发'
);

console.log('[5] candidateKey 数量、唯一性或图片序列不完整时整份无回执');
const missingKey = buildCodexSuccessfulVisualPresentationReceipt({
    prepared,
    candidateKeys: candidateKeys.slice(0, 2),
    workerGeneration: 7,
    threadId: 'thread-internal-1',
    turnId: 'turn-scoring-1'
});
const duplicateKey = buildCodexSuccessfulVisualPresentationReceipt({
    prepared,
    candidateKeys: ['same', 'same', 'third'],
    workerGeneration: 7,
    threadId: 'thread-internal-1',
    turnId: 'turn-scoring-1'
});
check(!missingKey && !duplicateKey, '不截断、不补键、不签部分图片');

console.log('[6] 非 canonical Base64 或篡改后的 receipt 均 fail closed');
const invalidTailBits = projectSerializedVisualImageDataUrl('data:image/png;base64,AB==');
const tampered = receipt ? JSON.parse(JSON.stringify(receipt)) : {};
if (tampered.images?.[0]) tampered.images[0].decodedByteSha256 = '0'.repeat(64);
const tamperedOrdinal = receipt ? JSON.parse(JSON.stringify(receipt)) : {};
if (tamperedOrdinal.images?.[0]) tamperedOrdinal.images[0].ordinal = 9;
check(
    !invalidTailBits
        && Boolean(readModelVisualPresentationReceipt(receipt))
        && !readModelVisualPresentationReceipt(tampered)
        && !readModelVisualPresentationReceipt(tamperedOrdinal),
    '逐图摘要与整体 manifest 都会复算'
);

console.log('[7] Provider adapter parser 本身无权签发出站回执');
const ordinaryProviderResponse = new OpenAIAdapter('openai').parseResponse({
    choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1 }
});
const ordinaryProviderResponses = [
    ordinaryProviderResponse,
    new AnthropicAdapter().parseResponse({
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 }
    }),
    new GeminiAdapter().parseResponse({
        candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 }
    }),
    new OllamaAdapter('native').parseResponse({
        message: { content: 'ok' },
        prompt_eval_count: 1,
        eval_count: 1
    })
];
check(
    ordinaryProviderResponses.every((response) => (
        response.visualPresentationReceipt === undefined
    )),
    'adapter parser 不用入站消息或成功布尔补造回执；签发只属于 ModelService 的真实 serializer 终态'
);

console.log('[8] 只有成功 transport attempt 能绑定回执引用');
const successRef = projectModelVisualPresentationReceiptRef({
    succeeded: true,
    receipt
});
const failedRef = projectModelVisualPresentationReceiptRef({
    succeeded: false,
    receipt
});
check(
    successRef?.attemptId === receipt?.attemptId
        && successRef?.manifestSha256 === receipt?.manifestSha256
        && failedRef === undefined,
    '失败 attempt 即使携带对象也不能取得 receipt ref'
);

console.log('[9] 生产接线只在 Codex 首次 turn 返回后暂存，并在成功 response 末端暴露');
const serviceText = fs.readFileSync(
    path.join(root, 'src/main/services/codex-subscription-service.ts'),
    'utf8'
);
const firstTurnCall = serviceText.indexOf('let completed = await this.runStructuredTurn({');
const receiptBuild = serviceText.indexOf('const visualPresentationReceipt = buildCodexSuccessfulVisualPresentationReceipt({');
const responseAttach = serviceText.indexOf('...(visualPresentationReceipt ? { visualPresentationReceipt } : {})');
check(
    firstTurnCall >= 0
        && receiptBuild > firstTurnCall
        && responseAttach > receiptBuild,
    '失败调用不会返回 staged receipt，repair 也不替换首次评分 attempt 身份'
);

console.log('[10] 质量优先推理档只映射到 Provider 真实支持的能力');
check(
    resolveModelReasoningEffort({
        supportedEfforts: ['low', 'medium', 'high', 'xhigh'],
        defaultEffort: 'low',
        requestedEffort: 'high'
    }) === 'high'
        && resolveModelReasoningEffort({
            supportedEfforts: ['low', 'medium'],
            defaultEffort: 'low',
            requestedEffort: 'high'
        }) === 'medium'
        && resolveModelReasoningEffort({
            supportedEfforts: [],
            defaultEffort: 'low',
            requestedEffort: 'high'
        }) === 'low',
    '支持 high 时按质量偏好请求；不支持时最近降级；未披露能力时不伪造档位'
);

console.log('[11] OpenAI-compatible 回执只从实际格式化的 image_url 序列签发');
const openAICompatibleMessages = [{
    role: 'user',
    content: [
        { type: 'text', text: '评分' },
        { type: 'image_url', image_url: { url: dataUrl('image/jpeg', currentJpegBytes) } },
        { type: 'image_url', image_url: { url: dataUrl('image/webp', currentWebpBytes) } }
    ]
}];
const openAICompatibleReceipt = buildOpenAICompatibleSuccessfulVisualPresentationReceipt({
    provider: 'deepseek',
    modelId: 'deepseek-v4-flash-vision-exp',
    formattedMessages: openAICompatibleMessages,
    candidateKeys: ['judge:final', 'judge:candidate'],
    responseId: 'chatcmpl-internal-1',
    responseCreated: 123
});
const mismatchedOpenAICompatibleReceipt =
    buildOpenAICompatibleSuccessfulVisualPresentationReceipt({
        provider: 'deepseek',
        modelId: 'deepseek-v4-flash-vision-exp',
        formattedMessages: openAICompatibleMessages,
        candidateKeys: ['judge:final'],
        responseId: 'chatcmpl-internal-1',
        responseCreated: 123
    });
check(
    projectOpenAICompatibleSerializedOutgoingImages(openAICompatibleMessages)?.length === 2
        && openAICompatibleReceipt?.provider === 'openai-compatible'
        && openAICompatibleReceipt.images[0].candidateKey === 'judge:final'
        && openAICompatibleReceipt.images[1].decodedByteSha256 === nodeSha256(currentWebpBytes)
        && !JSON.stringify(openAICompatibleReceipt).includes('chatcmpl-internal-1')
        && mismatchedOpenAICompatibleReceipt === undefined,
    '真实 serializer 顺序、字节摘要、候选键与不可逆 attempt 身份完整绑定'
);

async function verifyDeepSeekVisionDispatch() {
    console.log('[12] DeepSeek 视觉型号在 plain chat 与真实 Final Judge adapter 路径都保留图片');
    const service = new ModelService({});
    const capturedBodies = [];
    const capturedRequestOptions = [];
    const responseModes = ['complete', 'complete', 'complete', 'length', 'refusal', 'missing-id'];
    service.deepseek = {
        chat: {
            completions: {
                create: async (body, requestOptions) => {
                    capturedBodies.push(body);
                    capturedRequestOptions.push(requestOptions);
                    const responseMode = responseModes[capturedBodies.length - 1] || 'complete';
                    return {
                        ...(responseMode === 'missing-id'
                            ? {}
                            : { id: `chatcmpl-test-${capturedBodies.length}` }),
                        created: 456 + capturedBodies.length,
                        choices: [{
                            message: responseMode === 'refusal'
                                ? { content: '', refusal: 'blocked' }
                                : { content: '完整评分结果' },
                            finish_reason: responseMode === 'length' ? 'length' : 'stop'
                        }],
                        usage: { prompt_tokens: 10, completion_tokens: 3 }
                    };
                }
            }
        }
    };
    const messages = [{
        role: 'user',
        content: [
            { type: 'text', text: '请看图' },
            {
                type: 'image',
                image: {
                    data: Buffer.from(currentJpegBytes).toString('base64'),
                    mediaType: 'image/jpeg'
                }
            }
        ]
    }];
    const visionResponse = await service.chat(
        'deepseek-v4-flash-vision-exp',
        messages,
        {
            thinkingEnabled: false,
            visualPresentationCandidateKeys: ['judge:final']
        }
    );
    const textResponse = await service.chat(
        'deepseek-v4-pro',
        messages,
        {
            thinkingEnabled: false,
            visualPresentationCandidateKeys: ['must-not-sign']
        }
    );
    const visionContent = capturedBodies[0]?.messages?.[0]?.content;
    const textContent = capturedBodies[1]?.messages?.[0]?.content;
    const adapterMessages = [{
        role: 'user',
        content: '请看图',
        contentBlocks: [{
            type: 'image',
            data: Buffer.from(currentWebpBytes).toString('base64'),
            mediaType: 'image/webp'
        }]
    }];
    const adapterResponse = await service.chatWithTools(
        'deepseek-v4-flash-vision-exp',
        adapterMessages,
        [],
        {
            thinkingEnabled: false,
            timeoutMs: 12_345,
            visualPresentationCandidateKeys: ['judge:adapter-final']
        }
    );
    const adapterContent = capturedBodies[2]?.messages?.[0]?.content;
    const adapterReceipt = readModelVisualPresentationReceipt(
        adapterResponse.visualPresentationReceipt
    );
    check(
        Array.isArray(visionContent)
            && visionContent.some((block) => block?.type === 'image_url')
            && readModelVisualPresentationReceipt(visionResponse.visualPresentationReceipt)?.imageCount === 1
            && typeof textContent === 'string'
            && textResponse.visualPresentationReceipt === undefined
            && Array.isArray(adapterContent)
            && adapterContent.some((block) => block?.type === 'image_url')
            && adapterReceipt?.provider === 'openai-compatible'
            && adapterReceipt?.images[0]?.candidateKey === 'judge:adapter-final'
            && capturedRequestOptions[2]?.timeout === 12_345,
        'supportsVision=true 才保留实际图片；Final Judge 的 provider_adapter 路径签发真实出站回执并执行有界超时，文本型号不签发伪回执'
    );

    console.log('[13] 非完整终态与缺失 Provider response id 不能签发视觉回执');
    const lengthResponse = await service.chatWithTools(
        'deepseek-v4-flash-vision-exp',
        adapterMessages,
        [],
        { visualPresentationCandidateKeys: ['judge:length'] }
    );
    const refusalResponse = await service.chatWithTools(
        'deepseek-v4-flash-vision-exp',
        adapterMessages,
        [],
        { visualPresentationCandidateKeys: ['judge:refusal'] }
    );
    const missingIdResponse = await service.chatWithTools(
        'deepseek-v4-flash-vision-exp',
        adapterMessages,
        [],
        { visualPresentationCandidateKeys: ['judge:missing-id'] }
    );
    check(
        lengthResponse.stopReason === 'max_tokens'
            && refusalResponse.stopReason === 'content_blocked'
            && missingIdResponse.stopReason === 'end_turn'
            && lengthResponse.visualPresentationReceipt === undefined
            && refusalResponse.visualPresentationReceipt === undefined
            && missingIdResponse.visualPresentationReceipt === undefined,
        'length、refusal 与缺 response id 都保持无回执，不能用成功 HTTP 或入站图片补造'
    );
}

verifyDeepSeekVisionDispatch()
    .then(() => {
        if (failed > 0) {
            console.error(`\nModel visual presentation receipt 测试失败：${failed} 项`);
            process.exit(1);
        }
        console.log('\nModel visual presentation receipt 测试通过。');
    })
    .catch((error) => {
        console.error('\nModel visual presentation receipt 测试异常：', error);
        process.exit(1);
    });
