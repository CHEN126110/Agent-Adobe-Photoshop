import type { ModelProviderFailureKind } from './model-provider-failure';

export type ConversationalProviderFailureKind = ModelProviderFailureKind;

export type ConversationalUnavailableAudience = 'general' | 'capability';

export function buildConversationalUnavailableActionHint(kind: ConversationalProviderFailureKind): string {
    if (kind === 'auth') return '请在设置里检查当前模型的 API Key 后再发。';
    if (kind === 'billing') return '请充值对应模型服务，或在设置里切换可用模型后重试。';
    if (kind === 'model_access') return '请在模型服务侧确认该模型的订阅或访问权限，或在设置里切换到当前账号可用的模型；API Key 不一定有问题。';
    if (kind === 'rate_limit') return '稍后再发一次即可。';
    if (kind === 'network') return '稍后再发一次即可。';
    if (kind === 'timeout') return '请稍后重试；如果持续发生，请检查模型服务或切换可用模型。';
    if (kind === 'service_unavailable') return '请稍后重试，或在设置里切换可用模型。';
    if (kind === 'protocol') return '请稍后重试；如果持续发生，请切换模型并查看运行记录中的 Provider 诊断。';
    return '';
}

export function buildConversationalUnavailableMessage(input: {
    audience?: ConversationalUnavailableAudience;
    kind?: ConversationalProviderFailureKind;
    /**
     * 实际失败的模型标识。必须报出来：路由、意图分类等内部角色用的常常不是用户在设置里
     * 选中的那个模型（真机 2026-08-01：用户配好并测通了 deepseek-v4-pro，失败的却是
     * 路由角色选用的 deepseek-v4-flash）。只说「当前模型」会把用户送去反复检查一份好的配置。
     */
    failedModelLabel?: string;
} = {}): string {
    const kind = input.kind || 'unknown';
    void input.audience;
    const actionHint = buildConversationalUnavailableActionHint(kind);
    const modelLabel = String(input.failedModelLabel || '').trim();
    if (kind === 'auth') {
        return modelLabel
            ? [`模型「${modelLabel}」没有通过认证。`, actionHint].filter(Boolean).join('')
            : ['当前模型没有通过认证。', actionHint].filter(Boolean).join('');
    }
    if (kind === 'billing') {
        return modelLabel
            ? [`模型「${modelLabel}」的账户余额或可用额度不足。`, actionHint].filter(Boolean).join('')
            : ['当前模型的账户余额或可用额度不足。', actionHint].filter(Boolean).join('');
    }
    if (kind === 'model_access') {
        return modelLabel
            ? [`模型「${modelLabel}」当前不可用，或当前账号没有该模型的访问资格。`, actionHint].filter(Boolean).join('')
            : ['当前模型不可用，或当前账号没有该模型的访问资格。', actionHint].filter(Boolean).join('');
    }
    if (kind === 'protocol') {
        return modelLabel
            ? [`模型服务没有为「${modelLabel}」返回可解析的协议响应。`, actionHint].filter(Boolean).join('')
            : ['模型服务没有返回可解析的协议响应。', actionHint].filter(Boolean).join('');
    }
    if (kind === 'service_unavailable') {
        return modelLabel
            ? [`模型「${modelLabel}」的服务当前繁忙或暂时不可用。`, actionHint].filter(Boolean).join('')
            : ['模型服务当前繁忙或暂时不可用。', actionHint].filter(Boolean).join('');
    }
    if (kind === 'rate_limit') {
        return modelLabel
            ? [`模型「${modelLabel}」当前请求过多，服务暂时限流。`, actionHint].filter(Boolean).join('')
            : ['模型服务当前请求过多，暂时限流。', actionHint].filter(Boolean).join('');
    }
    if (kind === 'timeout') {
        return modelLabel
            ? [`等待模型「${modelLabel}」回复超时。`, actionHint].filter(Boolean).join('')
            : ['等待模型回复超时。', actionHint].filter(Boolean).join('');
    }
    if (kind === 'network') {
        return modelLabel
            ? [`连接模型「${modelLabel}」的服务时网络中断。`, actionHint].filter(Boolean).join('')
            : ['连接模型服务时网络中断。', actionHint].filter(Boolean).join('');
    }

    const head = modelLabel
        ? `这次没有拿到模型「${modelLabel}」的回复，先不继续处理。`
        : '这次没有拿到模型回复，先不继续处理。';
    return [head, actionHint].filter(Boolean).join('');
}
