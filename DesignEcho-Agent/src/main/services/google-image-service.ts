/**
 * Google Nano Banana 图像编辑服务
 *
 * 对外只暴露业务模型名，内部映射到官方 API Model ID。
 */

export type GoogleInpaintModelType = 'nano-banana' | 'nano-banana-pro';

const GOOGLE_IMAGE_MODEL_MAP: Record<GoogleInpaintModelType, string> = {
    'nano-banana': 'gemini-2.5-flash-image',
    'nano-banana-pro': 'gemini-3-pro-image-preview'
};

// 兼容历史请求中的旧值，统一归一化到业务模型名
function normalizeModel(model: string): GoogleInpaintModelType {
    if (model === 'nano-banana' || model === 'gemini-2.5-flash-image') {
        return 'nano-banana';
    }
    if (model === 'nano-banana-pro' || model === 'gemini-3-pro-image-preview') {
        return 'nano-banana-pro';
    }
    throw new Error(`不支持的 Nano Banana 模型: ${model}`);
}

export interface GoogleImageEditRequest {
    model: GoogleInpaintModelType | 'gemini-2.5-flash-image' | 'gemini-3-pro-image-preview';
    prompt: string;
    inputImageBase64: string;
    inputMimeType?: 'image/png' | 'image/jpeg';
    extraImageBase64List?: string[];
    timeoutMs?: number;
}

export interface GoogleImageEditResult {
    imageBase64: string;
    mimeType: 'image/png' | 'image/jpeg';
    model: GoogleInpaintModelType;
    apiModelId: string;
    raw: Record<string, unknown>;
}

class GoogleImageService {
    private apiKey = '';
    private readonly endpointBase = 'https://generativelanguage.googleapis.com/v1beta/models';

    setApiKey(apiKey: string): void {
        this.apiKey = (apiKey || '').trim();
        console.log('[GoogleImageService] API Key 已设置');
    }

    hasApiKey(): boolean {
        return this.apiKey.length > 10;
    }

    async editImage(request: GoogleImageEditRequest): Promise<GoogleImageEditResult> {
        if (!this.hasApiKey()) {
            throw new Error('Google API Key 未配置。请在设置中配置 Google AI Studio API 密钥。');
        }
        if (!request.prompt?.trim()) {
            throw new Error('提示词不能为空');
        }
        if (!request.inputImageBase64?.trim()) {
            throw new Error('缺少输入图像');
        }

        const model = normalizeModel(request.model);
        const apiModelId = GOOGLE_IMAGE_MODEL_MAP[model];
        const mimeType = request.inputMimeType || 'image/png';
        const timeoutMs = request.timeoutMs ?? 120000;
        const endpoint = `${this.endpointBase}/${apiModelId}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

        const parts: Array<Record<string, unknown>> = [
            { text: request.prompt },
            {
                inline_data: {
                    mime_type: mimeType,
                    data: request.inputImageBase64
                }
            }
        ];

        const extras = request.extraImageBase64List || [];
        for (const base64 of extras) {
            if (!base64?.trim()) continue;
            parts.push({
                inline_data: {
                    mime_type: 'image/png',
                    data: base64
                }
            });
        }

        const payload: Record<string, unknown> = {
            contents: [{ parts }],
            generationConfig: {
                responseModalities: ['TEXT', 'IMAGE']
            }
        };

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: controller.signal
            });

            const responseText = await response.text();
            let parsed: any = {};
            try {
                parsed = responseText ? JSON.parse(responseText) : {};
            } catch {
                throw new Error(`Google 图像接口返回非 JSON 响应: ${responseText.slice(0, 300)}`);
            }

            if (!response.ok) {
                const message = parsed?.error?.message || parsed?.message || `HTTP ${response.status}`;
                throw new Error(`Google 图像接口失败 (${response.status}): ${message}`);
            }

            const partsList = parsed?.candidates?.[0]?.content?.parts;
            if (!Array.isArray(partsList)) {
                throw new Error('Google 图像接口未返回可解析的 content.parts');
            }

            for (const part of partsList) {
                const inlineData = part?.inlineData || part?.inline_data;
                const data = inlineData?.data;
                const mt = inlineData?.mimeType || inlineData?.mime_type;
                if (typeof data === 'string' && data.length > 0) {
                    return {
                        imageBase64: data,
                        mimeType: mt === 'image/jpeg' ? 'image/jpeg' : 'image/png',
                        model,
                        apiModelId,
                        raw: parsed
                    };
                }
            }

            throw new Error('Google 图像接口未返回图片数据（inlineData.data 为空）');
        } catch (error: any) {
            if (error?.name === 'AbortError') {
                throw new Error(`Google 图像接口超时 (${timeoutMs}ms)`);
            }
            throw error;
        } finally {
            clearTimeout(timeout);
        }
    }
}

export const googleImageService = new GoogleImageService();
