export type ModelProviderFailureKind =
    | 'billing'
    | 'auth'
    | 'model_access'
    | 'rate_limit'
    | 'timeout'
    | 'network'
    | 'protocol'
    | 'service_unavailable'
    | 'unknown';

export type ModelProviderFailureBasis = 'status' | 'code' | 'message' | 'none';

export interface ModelProviderFailure {
    kind: ModelProviderFailureKind;
    basis: ModelProviderFailureBasis;
    status?: number;
    providerCode?: string;
    diagnostic: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function readStatusFromRecord(record: Record<string, unknown> | null): number | undefined {
    if (!record) return undefined;
    const response = asRecord(record.response);
    const cause = asRecord(record.cause);
    const candidates = [
        record.status,
        record.statusCode,
        response?.status,
        cause?.status,
        cause?.statusCode
    ];
    for (const candidate of candidates) {
        const status = Number(candidate);
        if (Number.isInteger(status) && status >= 100 && status <= 599) return status;
    }
    return undefined;
}

function compactDiagnostic(value: unknown): string {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;"']+/ig, '$1[redacted]')
        .replace(/((?:api[_\s-]?key|access[_\s-]?token|secret)\s*[:=]\s*)["']?[^\s,;"']+/ig, '$1[redacted]')
        .replace(/\b(?:sk|key|token)-[A-Za-z0-9_-]{12,}\b/g, '[redacted]')
        .slice(0, 500);
}

/** Run Record / UI 共享的有界诊断清洗；只保留排障所需文本，不允许 Key、Token 或大载荷外泄。 */
export function sanitizeModelProviderDiagnostic(value: unknown): string {
    return compactDiagnostic(value);
}

function readProviderDiagnostic(error: unknown): string {
    if (error instanceof Error) return compactDiagnostic(error.message || error.name);
    const record = asRecord(error);
    if (!record) return compactDiagnostic(error);
    const response = asRecord(record.response);
    const responseData = asRecord(response?.data);
    const responseError = asRecord(responseData?.error);
    return compactDiagnostic(
        record.message
        || responseError?.message
        || responseData?.message
        || record.error
        || error
    );
}

function readProviderCode(error: unknown): string | undefined {
    const record = asRecord(error);
    const response = asRecord(record?.response);
    const responseData = asRecord(response?.data);
    const responseError = asRecord(responseData?.error);
    const rawCode = record?.code || responseError?.code || responseData?.code;
    const code = compactDiagnostic(rawCode);
    return code ? code.slice(0, 120) : undefined;
}

function readStatusFromDiagnostic(diagnostic: string): number | undefined {
    const match = diagnostic.match(/\b(401|402|403|408|409|425|429|500|501|502|503|504)\b/);
    return match ? Number(match[1]) : undefined;
}

function buildFailure(
    kind: ModelProviderFailureKind,
    basis: ModelProviderFailureBasis,
    diagnostic: string,
    status?: number,
    providerCode?: string
): ModelProviderFailure {
    return {
        kind,
        basis,
        ...(status ? { status } : {}),
        ...(providerCode ? { providerCode } : {}),
        diagnostic
    };
}

/**
 * 只在已经确定是模型 Provider 调用失败的边界使用本函数。
 *
 * 这里按 HTTP 状态/Provider code 做确定性归因；文本只在上游没有保留结构化字段时作为
 * 次级证据。它不是自然语言意图路由，也不能拿去扫描模型正常回复。
 */
export function classifyModelProviderFailure(error: unknown): ModelProviderFailure {
    const diagnostic = readProviderDiagnostic(error);
    const providerCode = readProviderCode(error);
    const structuredStatus = readStatusFromRecord(asRecord(error));
    const status = structuredStatus || readStatusFromDiagnostic(diagnostic);
    const normalized = `${providerCode || ''} ${diagnostic}`.toLowerCase();
    const statusBasis: ModelProviderFailureBasis = structuredStatus ? 'status' : 'message';

    if (status === 402) {
        return buildFailure('billing', statusBasis, diagnostic, status, providerCode);
    }
    if (/insufficient[_\s-]*(?:balance|credit|credits|funds|quota)|balance\s+is\s+insufficient|quota[_\s-]*exceeded|余额不足|账户余额|额度不足|配额不足/i.test(normalized)) {
        return buildFailure('billing', providerCode ? 'code' : 'message', diagnostic, status, providerCode);
    }
    if (/requires?\s+(?:an?\s+)?subscription|subscription[_\s-]*(?:required|needed)|upgrade(?:\s+your\s+plan)?\s+for\s+access|not\s+(?:allowed|entitled|authorized)\s+to\s+(?:use|access)\s+(?:this\s+)?model|model\s+(?:access|permission)\s+(?:is\s+)?(?:required|denied|not\s+enabled)|no\s+endpoints?\s+found|model\s+(?:not\s+found|does\s+not\s+exist|unavailable)|permission_denied|forbidden|需要.*订阅|订阅.*(?:不足|要求)|升级.*(?:订阅|访问)|模型.*(?:无权|无权限|未开放|不可用)/i.test(normalized)) {
        return buildFailure('model_access', providerCode ? 'code' : (structuredStatus ? 'status' : 'message'), diagnostic, status, providerCode);
    }
    if (status === 401) {
        return buildFailure('auth', statusBasis, diagnostic, status, providerCode);
    }
    if (/invalid[_\s-]*api[_\s-]*key|unauthorized|authentication[_\s-]*(?:error|failed|failure)|鉴权失败|认证失败|api\s*key\s*(?:无效|错误|未配置|过期)|api\s*key\s+not\s+configured/i.test(normalized)) {
        return buildFailure('auth', providerCode ? 'code' : 'message', diagnostic, status, providerCode);
    }
    // 403 表示服务已理解请求但拒绝访问，不能在缺少认证证据时把它等同于 API Key 无效。
    // Provider 没给更具体原因时，用户应检查模型权限/订阅，而不是反复更换正确的 Key。
    if (status === 403) {
        return buildFailure('model_access', statusBasis, diagnostic, status, providerCode);
    }
    if (status === 429 || /rate[_\s-]*limit|too\s+many\s+requests|resource_exhausted|请求过于频繁|限流/i.test(normalized)) {
        return buildFailure('rate_limit', structuredStatus ? 'status' : (providerCode ? 'code' : 'message'), diagnostic, status, providerCode);
    }
    if (status === 408 || status === 504 || /timed?\s*out|timeout|etimedout|请求超时/i.test(normalized)) {
        return buildFailure('timeout', structuredStatus ? 'status' : (providerCode ? 'code' : 'message'), diagnostic, status, providerCode);
    }
    if (/econnrefused|econnreset|enotfound|dns|network\s*(?:error|failed|failure)|failed\s+to\s+fetch|socket\s*(?:closed|hang\s*up)|网络连接失败/i.test(normalized)) {
        return buildFailure('network', providerCode ? 'code' : 'message', diagnostic, status, providerCode);
    }
    if (/response\s+parse\s+error|invalid\s+json|malformed\s+(?:response|sse)|invalid\s+response|protocol\s+error|unexpected\s+token.*json|响应解析失败|协议响应异常/i.test(normalized)) {
        return buildFailure('protocol', providerCode ? 'code' : 'message', diagnostic, status, providerCode);
    }
    if ((status !== undefined && status >= 500) || /service\s+unavailable|bad\s+gateway|provider\s+unavailable|服务暂时不可用/i.test(normalized)) {
        return buildFailure('service_unavailable', structuredStatus ? 'status' : (providerCode ? 'code' : 'message'), diagnostic, status, providerCode);
    }
    return buildFailure('unknown', providerCode ? 'code' : 'none', diagnostic, status, providerCode);
}
