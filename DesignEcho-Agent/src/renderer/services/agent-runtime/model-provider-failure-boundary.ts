import { sanitizeUserVisibleDiagnosticText } from '../../../shared/chat-response-cleaner';
import {
    classifyModelProviderFailure,
    ModelProviderCallError
} from '../../../shared/model-provider-failure';

/** 把模型边界的可识别失败恢复成结构化异常，避免主循环把它当普通质量失败。 */
export function rethrowKnownModelProviderFailure(modelId: string, error: unknown): void {
    if (error instanceof ModelProviderCallError
        || (error as { name?: string } | null)?.name === 'ModelProviderCallError') {
        throw error;
    }
    const providerFailure = classifyModelProviderFailure(error);
    if (providerFailure.kind !== 'unknown') {
        throw new ModelProviderCallError(modelId, providerFailure);
    }
}

export function buildAgentIterationFailureMessage(error: unknown): string {
    const detail = sanitizeUserVisibleDiagnosticText(
        error instanceof Error ? error.message : String(error || '')
    );
    return detail
        ? `这次处理没有完成：${detail}`
        : '这次处理没有完成，当前结果已保留。';
}
