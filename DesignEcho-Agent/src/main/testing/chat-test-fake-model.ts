type ChatTestMessage = {
    role?: string;
    content?: unknown;
    contentBlocks?: Array<{ type?: string; text?: string }>;
};

export function isChatTestFakeModelEnabled(): boolean {
    return process.env.DESIGNECHO_CHAT_TEST_FAKE_MODEL === '1';
}

function extractChatTestTextFromContent(content: unknown): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content
            .map((block) => {
                if (!block || typeof block !== 'object') return '';
                const record = block as Record<string, unknown>;
                if (typeof record.text === 'string') return record.text;
                if (typeof record.content === 'string') return record.content;
                return '';
            })
            .filter(Boolean)
            .join('\n');
    }
    return '';
}

function extractLastUserText(messages: unknown[]): string {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index] as ChatTestMessage | undefined;
        if (!message || message.role !== 'user') continue;

        const contentText = extractChatTestTextFromContent(message.content);
        if (contentText.trim()) return contentText.trim();

        const blockText = Array.isArray(message.contentBlocks)
            ? message.contentBlocks
                .filter((block) => block?.type === 'text' && typeof block.text === 'string')
                .map((block) => block.text)
                .join('\n')
            : '';
        if (blockText.trim()) return blockText.trim();
    }
    return '';
}

function isChatTestAcceptanceFailurePrompt(text: string): boolean {
    const normalized = text.replace(/\s+/g, '');
    return /测试验收失败|失败报告样本|制造验收失败/.test(normalized);
}

function isChatTestReferenceParsePrompt(messages: unknown[]): boolean {
    const userText = extractLastUserText(messages);
    return /canvasSize|alignmentGroups|elements|layoutType/.test(userText)
        && /参考图|reference|layout/i.test(userText)
        && /JSON|json/.test(userText);
}

function isChatTestVisibleReasoningPrompt(text: string): boolean {
    return text.includes('公开判断')
        && text.includes('不要暴露私有链式思维')
        && text.includes('用户请求：');
}

function extractVisibleReasoningTarget(text: string): string {
    const marker = '用户请求：';
    const index = text.lastIndexOf(marker);
    if (index === -1) return '';
    return text.slice(index + marker.length).trim().split(/\r?\n/)[0].trim();
}

function buildChatTestVisibleReasoningText(text: string): string {
    const target = extractVisibleReasoningTarget(text);
    if (/关闭.*文档.*不保存|文档.*不保存.*关闭/.test(target)) {
        return '我先理解这是关闭当前 Photoshop 文档且不保存的操作，再确认是否需要调用文档管理能力。';
    }
    if (/保存.*文档|文档.*保存|保存.*psd|psd.*保存/i.test(target)) {
        return '我先理解这是保存当前 Photoshop 文档的操作，再确认保存格式和项目位置。';
    }
    if (/图层.*颜色.*浅.*深|浅.*深.*图层/.test(target)) {
        return '我先理解这是按颜色明暗重排图层顺序的请求，再确认当前图层结构是否足够执行。';
    }
    if (/复刻|参考图|同款版式/.test(target)) {
        return '我先把参考图理解成可编辑的版式结构，再判断需要创建哪些 Photoshop 图层。';
    }
    if (/sku/i.test(target)) {
        return '我先理解 SKU 规格和备注目标，再确认需要生成哪些组合与输出文件。';
    }
    return '我先理解用户的设计目标和当前上下文，再决定是否需要调用 Photoshop 能力。';
}

function buildChatTestFexReferenceParseJson(): string {
    const canvas = { width: 460, height: 460 };
    const px = (value: number, axis: 'x' | 'y' | 'w' | 'h') => {
        const denominator = axis === 'x' || axis === 'w' ? canvas.width : canvas.height;
        return Number((value / denominator).toFixed(6));
    };
    const elements = [
        ['title', 'headline', '合格证', 160, 41, 141, 45, 'bold', 40 / 460],
        ['brand', 'supporting-copy', '品牌:FEX', 38, 121, 94, 22, 'regular', 24 / 460],
        ['product-name', 'supporting-copy', '品名:袜子', 302, 121, 100, 22, 'regular', 24 / 460],
        ['style-no', 'supporting-copy', '货号:N-W210520', 37, 159, 187, 22, 'regular', 24 / 460],
        ['grade', 'supporting-copy', '等级:一等品', 300, 159, 123, 22, 'regular', 24 / 460],
        ['color', 'supporting-copy', '颜色:混色', 37, 197, 100, 22, 'regular', 24 / 460],
        ['inspector', 'supporting-copy', '检验员:018', 36, 235, 120, 22, 'regular', 24 / 460],
        ['material', 'supporting-copy', '成分:棉100%', 37, 290, 138, 22, 'regular', 24 / 460],
        ['execute-standard', 'supporting-copy', '执行标准:FZ/T73001-2016', 37, 328, 288, 22, 'regular', 24 / 460],
        ['compliance-standard', 'supporting-copy', '符合标准:GB18401-2010', 36, 366, 268, 22, 'regular', 24 / 460],
        ['safety-category', 'supporting-copy', '安全技术类别:B类可直接接触皮肤', 37, 404, 353, 22, 'regular', 24 / 460]
    ].map(([name, role, content, x, y, width, height, fontWeight, fontSizeRatio], index) => ({
        type: 'text',
        role,
        name,
        content,
        style: {
            textColor: '#111111',
            fontWeight,
            fontSizeRatio,
            effects: []
        },
        position: {
            x: px(Number(x), 'x'),
            y: px(Number(y), 'y')
        },
        size: {
            width: px(Number(width), 'w'),
            height: px(Number(height), 'h')
        },
        relationship: {
            group: index === 0 ? 'title' : index < 7 ? 'top-fields' : 'standards'
        },
        visualWeight: index === 0 ? 'primary' : 'secondary',
        zIndex: index + 1
    }));

    return JSON.stringify({
        layoutType: 'certificate-label',
        designIntent: '复刻白底黑字合格证文本排版，保留标题、左右字段列和底部标准说明。',
        canvasSize: canvas,
        composition: {
            focalPoint: 'title',
            readingOrder: elements.map((element) => element.name),
            density: 'medium',
            symmetry: 'center-title-left-right-fields'
        },
        elements,
        alignmentGroups: [
            { type: 'center-title', elementIndices: [0] },
            { type: 'left-column', elementIndices: [1, 3, 5, 6, 7, 8, 9, 10] },
            { type: 'right-column', elementIndices: [2, 4] }
        ]
    });
}

function buildChatTestNeutralReferenceParseJson(): string {
    const canvas = { width: 600, height: 420 };
    const px = (value: number, axis: 'x' | 'y' | 'w' | 'h') => {
        const denominator = axis === 'x' || axis === 'w' ? canvas.width : canvas.height;
        return Number((value / denominator).toFixed(6));
    };
    const elements = [
        ['title', 'headline', '品质检验卡', 184, 38, 232, 48, 'bold', 40 / 420],
        ['category', 'supporting-copy', '品类:针织袜', 52, 110, 138, 28, 'regular', 25 / 420],
        ['grade', 'supporting-copy', '等级:合格品', 350, 110, 138, 28, 'regular', 25 / 420],
        ['style-no', 'supporting-copy', '货号:Q-2026-0512', 52, 150, 218, 28, 'regular', 25 / 420],
        ['color', 'supporting-copy', '颜色:自然白', 350, 150, 138, 28, 'regular', 25 / 420],
        ['material', 'supporting-copy', '成分:棉80% 锦纶17% 氨纶3%', 52, 206, 360, 28, 'regular', 25 / 420],
        ['standard', 'supporting-copy', '执行标准:FZ/T73001-2016', 52, 248, 320, 28, 'regular', 25 / 420],
        ['safety', 'supporting-copy', '安全类别:B类可直接接触皮肤', 52, 290, 360, 28, 'regular', 25 / 420],
        ['inspector', 'supporting-copy', '检验员:028', 52, 332, 126, 28, 'regular', 25 / 420]
    ].map(([name, role, content, x, y, width, height, fontWeight, fontSizeRatio], index) => ({
        type: 'text',
        role,
        name,
        content,
        style: {
            textColor: '#111111',
            fontWeight,
            fontSizeRatio,
            effects: []
        },
        position: {
            x: px(Number(x), 'x'),
            y: px(Number(y), 'y')
        },
        size: {
            width: px(Number(width), 'w'),
            height: px(Number(height), 'h')
        },
        relationship: {
            group: index === 0 ? 'title' : index < 5 ? 'top-fields' : 'standards'
        },
        visualWeight: index === 0 ? 'primary' : 'secondary',
        zIndex: index + 1
    }));

    return JSON.stringify({
        layoutType: 'neutral-quality-card-text-layout',
        designIntent: '复刻中性品质检验卡的可编辑文本排版，保留标题、左右字段列和底部说明。',
        canvasSize: canvas,
        composition: {
            focalPoint: 'title',
            readingOrder: elements.map((element) => element.name),
            density: 'medium',
            symmetry: 'center-title-left-right-fields'
        },
        elements,
        alignmentGroups: [
            { type: 'center-title', elementIndices: [0] },
            { type: 'left-column', elementIndices: [1, 3, 5, 6, 7, 8] },
            { type: 'right-column', elementIndices: [2, 4] }
        ]
    });
}

function hasChatTestToolResult(messages: unknown[], callId: string): boolean {
    return messages.some((message) => {
        const record = message as Record<string, unknown> | undefined;
        if (!record || record.role !== 'tool_result' || !Array.isArray(record.toolResults)) return false;
        return record.toolResults.some((item) => {
            const result = item as Record<string, unknown> | undefined;
            return result?.callId === callId;
        });
    });
}

export function buildChatTestFakeModelText(modelId: string, messages: unknown[]): string {
    if (isChatTestReferenceParsePrompt(messages)) {
        if (process.env.DESIGNECHO_CHAT_TEST_REFERENCE_CASE === 'neutral-text-layout') {
            return buildChatTestNeutralReferenceParseJson();
        }
        return buildChatTestFexReferenceParseJson();
    }

    const userText = extractLastUserText(messages);
    const normalized = userText.replace(/\s+/g, '');

    if (isChatTestVisibleReasoningPrompt(userText)) {
        return buildChatTestVisibleReasoningText(userText);
    }

    if (isChatTestAcceptanceFailurePrompt(userText)) {
        return JSON.stringify({
            route: 'autonomous_agent',
            skillId: null,
            mode: 'execute',
            skillParams: {},
            confidence: 0.86,
            intentSummary: '执行受控验收失败样本，用于验证用户页面不会把失败伪装成完成。'
        });
    }

    if (/什么模型|哪个模型|哪种模型|模型/.test(normalized)) {
        return `测试模型响应：我是 DesignEcho 的受控测试模型，当前请求会按普通对话回答，不应读取 Photoshop 文档，也不应触发执行链。调用模型 ID：${modelId}`;
    }

    if (/你好|hello|hi/i.test(userText)) {
        return '测试模型响应：你好。这是普通聊天路径，应该直接回复，不调用 Photoshop 工具。';
    }

    return '测试模型响应：这条消息被识别为普通对话，应该直接回复，不调用 Photoshop 工具。';
}

export function buildChatTestFakeModelWithTools(modelId: string, messages: unknown[], tools: unknown[]) {
    const userText = extractLastUserText(messages);
    const acceptanceFailureCallId = 'chat-test-acceptance-failed-1';

    if (isChatTestAcceptanceFailurePrompt(userText)) {
        if (tools.length === 0 || hasChatTestToolResult(messages, acceptanceFailureCallId)) {
            return {
                content: '已完成并验证。',
                toolCalls: [],
                usage: {
                    inputTokens: 0,
                    outputTokens: 0
                },
                stopReason: 'end_turn'
            };
        }

        return {
            content: '',
            toolCalls: [
                {
                    id: acceptanceFailureCallId,
                    name: 'getDocumentInfo',
                    arguments: {
                        __chatTestAcceptanceFailed: true
                    }
                }
            ],
            usage: {
                inputTokens: 0,
                outputTokens: 0
            },
            stopReason: 'tool_use'
        };
    }

    return {
        content: buildChatTestFakeModelText(modelId, messages),
        toolCalls: [],
        usage: {
            inputTokens: 0,
            outputTokens: 0
        },
        stopReason: 'end_turn'
    };
}
