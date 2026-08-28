import { openRouterGeminiImageService } from './openrouter-gemini-image-service';
import { smileAiImageService } from './smile-ai-image-service';

export interface ImageProviderApiKeys {
    openrouter?: string;
    smileAi?: string;
}

export interface ImageProviderCredentialTarget {
    setApiKey(apiKey?: string): void;
}

export interface ImageProviderCredentialTargets {
    openrouter: ImageProviderCredentialTarget;
    smileAi: ImageProviderCredentialTarget;
}

const DEFAULT_TARGETS: ImageProviderCredentialTargets = {
    openrouter: openRouterGeminiImageService,
    smileAi: smileAiImageService
};

/**
 * 把每个图像 Provider 的凭据独立同步到自己的 Service。
 *
 * undefined 表示本次没有更新该字段；空字符串表示用户明确清空。不要把一个 Provider
 * 的更新挂在另一个 Provider 的 if 分支里，否则只配置 Smile 而没配置 OpenRouter 时，
 * 持久化状态看似正确，真实执行 Service 却始终没有 Key。
 */
export function syncImageProviderApiKeys(
    keys: ImageProviderApiKeys,
    targets: ImageProviderCredentialTargets = DEFAULT_TARGETS
): Array<keyof ImageProviderCredentialTargets> {
    const updated: Array<keyof ImageProviderCredentialTargets> = [];
    if (keys.openrouter !== undefined) {
        targets.openrouter.setApiKey(keys.openrouter);
        updated.push('openrouter');
    }
    if (keys.smileAi !== undefined) {
        targets.smileAi.setApiKey(keys.smileAi);
        updated.push('smileAi');
    }
    return updated;
}
