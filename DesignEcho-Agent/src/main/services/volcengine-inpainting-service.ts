/**
 * 火山引擎 局部重绘（Inpainting）服务
 *
 * 支持产品：
 * - 即梦文生图3.1 https://www.volcengine.com/docs/85621/1756900
 * - 即梦AI-图片生成4.0 https://www.volcengine.com/docs/85621/1817045
 * - 即梦AI-交互编辑inpainting https://www.volcengine.com/docs/85621/1976207
 *
 * 鉴权：Access Key ID:Secret Access Key（火山引擎控制台 → 访问控制 → 密钥管理）
 * 格式：在设置中填写 "AccessKeyId:SecretAccessKey"
 *
 * 即梦文生图3.1 / 图片生成4.0 为图生图接口，无 mask 参数。采用图生图模式（image + prompt）生成整图，
 * 由上层用 mask 合成实现局部重绘效果。
 */

import * as crypto from 'crypto';

export type VolcengineInpaintModelType = 'volcengine-inpaint' | 'volcengine-inpaint-pro' | 'volcengine-inpaint-4';

/** 即梦文生图3.1 对接文档 85621/1756900 */
const JIMENG_3_1_CONFIG = {
    endpoint: 'https://visual.volcengineapi.com',
    host: 'visual.volcengineapi.com',
    action: 'HighAestheticSmartDrawing',
    version: '2022-08-31',
    region: 'cn-north-1',
    service: 'cv'
} as const;

/** 即梦AI-图片生成4.0 对接文档 85621/1817045（与 3.1 共用 endpoint，可能使用相同 Action 或不同 Action） */
const JIMENG_4_CONFIG = {
    ...JIMENG_3_1_CONFIG,
    action: 'HighAestheticSmartDrawing',
    version: '2022-08-31'
} as const;

const VOLCENGINE_INPAINT_ENDPOINT = JIMENG_3_1_CONFIG.endpoint;
const VOLCENGINE_HOST = JIMENG_3_1_CONFIG.host;
const VOLCENGINE_REGION = JIMENG_3_1_CONFIG.region;
const VOLCENGINE_SERVICE = JIMENG_3_1_CONFIG.service;

export interface VolcengineInpaintRequest {
    imageBase64: string;
    maskBase64: string;
    prompt: string;
    model?: VolcengineInpaintModelType;
    timeoutMs?: number;
}

export interface VolcengineInpaintResult {
    imageBase64: string;
    model: VolcengineInpaintModelType;
    raw: Record<string, unknown>;
}

class VolcengineInpaintingService {
    private accessKeyId = '';
    private secretAccessKey = '';

    setCredentials(accessKeyId: string, secretAccessKey: string): void {
        this.accessKeyId = (accessKeyId || '').trim();
        this.secretAccessKey = (secretAccessKey || '').trim();
        if (this.accessKeyId) {
            console.log('[VolcengineInpainting] 凭证已设置');
        }
    }

    /** 格式：accessKeyId:secretAccessKey */
    setApiKey(apiKey: string): void {
        const trimmed = (apiKey || '').trim();
        if (trimmed.includes(':')) {
            const idx = trimmed.indexOf(':');
            this.setCredentials(trimmed.slice(0, idx).trim(), trimmed.slice(idx + 1).trim());
        } else {
            this.accessKeyId = trimmed;
        }
    }

    hasCredentials(): boolean {
        return this.accessKeyId.length > 5 && this.secretAccessKey.length > 5;
    }

    /**
     * 测试凭证是否有效。发送最小请求，根据返回错误判断：
     * - 鉴权错误（SignatureDoesNotMatch、InvalidAccessKeyId 等）→ 凭证无效
     * - 参数错误（InvalidParameter、MissingParameter 等）→ 凭证有效，接口可达
     */
    async testCredentials(accessKeyId?: string, secretAccessKey?: string): Promise<{ success: boolean; message?: string; error?: string }> {
        const ak = (accessKeyId ?? this.accessKeyId).trim();
        const sk = (secretAccessKey ?? this.secretAccessKey).trim();
        if (!ak || !sk || ak.length < 5 || sk.length < 5) {
            return { success: false, error: '请填写完整的 Access Key ID 和 Secret Access Key' };
        }

        const config = JIMENG_4_CONFIG;
        const body = this.buildT2IBody({ imageBase64: 'test', maskBase64: '', prompt: 'test' }, 'volcengine-inpaint-4');
        const pathWithQuery = `/?Action=${config.action}&Version=${config.version}`;

        const prevAk = this.accessKeyId;
        const prevSk = this.secretAccessKey;
        this.accessKeyId = ak;
        this.secretAccessKey = sk;
        const signedHeaders = this.signRequest('POST', pathWithQuery, body);
        this.accessKeyId = prevAk;
        this.secretAccessKey = prevSk;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        try {
            const response = await fetch(`${VOLCENGINE_INPAINT_ENDPOINT}${pathWithQuery}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...signedHeaders },
                body: JSON.stringify(body),
                signal: controller.signal
            });
            clearTimeout(timeout);
            const responseText = await response.text();
            let parsed: any = {};
            try {
                parsed = responseText ? JSON.parse(responseText) : {};
            } catch {
                return { success: false, error: '接口返回异常，请检查网络' };
            }

            const code = (parsed?.ResponseMetadata?.Error?.Code || parsed?.code || '').toLowerCase();
            const message = parsed?.ResponseMetadata?.Error?.Message || parsed?.message || '';

            if (response.ok) {
                return { success: true, message: '✅ 凭证有效' };
            }
            if (response.status === 401 || response.status === 403 ||
                code.includes('signature') || code.includes('accesskey') || code.includes('denied') ||
                code.includes('unauthorized') || code.includes('forbidden') || code.includes('invalidcredential')) {
                return { success: false, error: `❌ 凭证无效: ${message || code || response.status}` };
            }
            if (code.includes('invalid') || code.includes('missing') || code.includes('parameter') ||
                response.status === 400) {
                return { success: true, message: '✅ 凭证有效（接口可达）' };
            }
            return { success: false, error: `❌ ${message || code || '请求失败'}` };
        } catch (e: unknown) {
            clearTimeout(timeout);
            if (e instanceof Error && e.name === 'AbortError') {
                return { success: false, error: '❌ 请求超时，请检查网络' };
            }
            if (e instanceof Error) {
                return { success: false, error: `❌ ${e.message}` };
            }
            return { success: false, error: '❌ 验证失败' };
        }
    }

    async inpaint(request: VolcengineInpaintRequest): Promise<VolcengineInpaintResult> {
        if (!this.hasCredentials()) {
            throw new Error('火山引擎凭证未配置。请在设置中配置（格式：AccessKeyId:SecretAccessKey）');
        }
        if (!request.prompt?.trim()) {
            throw new Error('提示词不能为空');
        }
        if (!request.imageBase64?.trim() || !request.maskBase64?.trim()) {
            throw new Error('缺少输入图像或蒙版');
        }

        const timeoutMs = request.timeoutMs ?? 120000;
        const model = request.model || 'volcengine-inpaint';
        const config = model === 'volcengine-inpaint-4' ? JIMENG_4_CONFIG : JIMENG_3_1_CONFIG;

        const body = this.buildT2IBody(request, model);

        const pathWithQuery = `/?Action=${config.action}&Version=${config.version}`;
        const signedHeaders = this.signRequest('POST', pathWithQuery, body);

        const url = `${VOLCENGINE_INPAINT_ENDPOINT}${pathWithQuery}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...signedHeaders
                },
                body: JSON.stringify(body),
                signal: controller.signal
            });

            clearTimeout(timeout);

            const responseText = await response.text();
            let parsed: any = {};
            try {
                parsed = responseText ? JSON.parse(responseText) : {};
            } catch {
                console.error('[VolcengineInpainting] 响应非 JSON:', responseText?.slice(0, 500));
                throw new Error(`火山引擎接口返回非 JSON: ${responseText.slice(0, 200)}`);
            }

            if (!response.ok) {
                const code = parsed?.ResponseMetadata?.Error?.Code || parsed?.code || parsed?.error?.code;
                const message = parsed?.ResponseMetadata?.Error?.Message || parsed?.message || parsed?.error?.message || `HTTP ${response.status}`;
                const codeLower = String(code || '').toLowerCase();
                console.error('[VolcengineInpainting] 请求失败:', { status: response.status, code, message, raw: responseText?.slice(0, 500) });
                if (codeLower.includes('invalidcredential') || (codeLower.includes('invalid') && codeLower.includes('credential'))) {
                    const productHint = model === 'volcengine-inpaint-4'
                        ? '已开通「即梦AI-图片生成4.0」'
                        : '已开通「即梦AI-图片生成」→「即梦文生图3.1」或「即梦AI-图片生成4.0」';
                    console.error('[VolcengineInpainting] 鉴权失败:', productHint);
                    throw new Error(
                        `火山引擎 请求失败: ${message}。请确认：1) Access Key 来自控制台→访问控制→密钥管理；2) ${productHint}。文档：https://www.volcengine.com/docs/85621/1817045`
                    );
                }
                throw new Error(`火山引擎 请求失败: ${message} (${code || response.status})`);
            }

            const data = parsed?.data || parsed?.result || parsed;
            let imageBase64 = data?.image_base64 || data?.imageBase64 || data?.image;

            if (!imageBase64 && data?.url) {
                const imgRes = await fetch(data.url);
                if (!imgRes.ok) throw new Error('无法下载生成结果');
                const buf = await imgRes.arrayBuffer();
                imageBase64 = Buffer.from(buf).toString('base64');
            }

            if (!imageBase64) {
                throw new Error('火山引擎未返回有效图像数据');
            }

            const generatedBase64 = String(imageBase64).replace(/^data:image\/\w+;base64,/, '');
            const compositeBase64 = await this.compositeWithMask(
                request.imageBase64,
                request.maskBase64,
                generatedBase64
            );

            return {
                imageBase64: compositeBase64,
                model: model,
                raw: parsed
            };
        } catch (e: unknown) {
            clearTimeout(timeout);
            if (e instanceof Error) {
                if (e.name === 'AbortError') {
                    throw new Error('火山引擎 请求超时，请稍后重试');
                }
                throw e;
            }
            throw new Error(String(e));
        }
    }

    /** 即梦 图生图请求体：prompt + binary_data_base64。3.1 与 4.0 共用同一请求格式，后端按订阅路由 */
    private buildT2IBody(request: VolcengineInpaintRequest, _model?: VolcengineInpaintModelType): Record<string, unknown> {
        const img = request.imageBase64.replace(/^data:image\/\w+;base64,/, '');
        return {
            req: {
                prompt: request.prompt.trim(),
                binary_data_base64: [img]
            }
        };
    }

    /**
     * 文生图无 mask，生成整图后需用 mask 合成：原图保留 mask 黑色区域，生成图填充 mask 白色区域
     */
    private async compositeWithMask(
        originalBase64: string,
        maskBase64: string,
        generatedBase64: string
    ): Promise<string> {
        const sharp = (await import('sharp')).default;
        const orig = originalBase64.replace(/^data:image\/\w+;base64,/, '');
        const msk = maskBase64.replace(/^data:image\/\w+;base64,/, '');
        const gen = generatedBase64;

        const [origMeta, maskMeta, genMeta] = await Promise.all([
            sharp(Buffer.from(orig, 'base64')).metadata(),
            sharp(Buffer.from(msk, 'base64')).metadata(),
            sharp(Buffer.from(gen, 'base64')).metadata()
        ]);

        const w = origMeta.width || maskMeta.width || genMeta.width || 1024;
        const h = origMeta.height || maskMeta.height || genMeta.height || 1024;

        const [origRaw, maskRaw, genRaw] = await Promise.all([
            sharp(Buffer.from(orig, 'base64')).resize(w, h, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
            sharp(Buffer.from(msk, 'base64')).resize(w, h, { fit: 'fill' }).grayscale().raw().toBuffer({ resolveWithObject: true }),
            sharp(Buffer.from(gen, 'base64')).resize(w, h, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
        ]);

        const out = Buffer.alloc(w * h * 4);
        const origBuf = origRaw.data;
        const maskBuf = maskRaw.data;
        const genBuf = genRaw.data;

        for (let i = 0; i < w * h; i++) {
            const alpha = maskBuf[i] / 255;
            const o = i * 4;
            out[o] = Math.round(origBuf[o] * (1 - alpha) + genBuf[o] * alpha);
            out[o + 1] = Math.round(origBuf[o + 1] * (1 - alpha) + genBuf[o + 1] * alpha);
            out[o + 2] = Math.round(origBuf[o + 2] * (1 - alpha) + genBuf[o + 2] * alpha);
            out[o + 3] = Math.round((origBuf[o + 3] ?? 255) * (1 - alpha) + (genBuf[o + 3] ?? 255) * alpha);
        }

        const png = await sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
        return png.toString('base64');
    }

    /**
     * 火山引擎 OpenAPI 签名（符合 volc-openapi-demos 规范）
     */
    private signRequest(method: string, pathWithQuery: string, body: Record<string, unknown>): Record<string, string> {
        const now = new Date();
        const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, '');
        const xDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z?$/, 'Z');

        const payload = JSON.stringify(body);
        const payloadHash = crypto.createHash('sha256').update(payload, 'utf8').digest('hex');

        const path = '/';
        const query = pathWithQuery.startsWith('/?') ? pathWithQuery.slice(2) : '';
        const signedHeaders = 'content-type;host;x-content-sha256;x-date';
        const canonicalRequest = [
            method,
            path,
            query,
            `content-type:application/json`,
            `host:${VOLCENGINE_HOST}`,
            `x-content-sha256:${payloadHash}`,
            `x-date:${xDate}`,
            '',
            signedHeaders,
            payloadHash
        ].join('\n');

        const credentialScope = `${dateStamp}/${VOLCENGINE_REGION}/${VOLCENGINE_SERVICE}/request`;
        const stringToSign = [
            'HMAC-SHA256',
            xDate,
            credentialScope,
            crypto.createHash('sha256').update(canonicalRequest, 'utf8').digest('hex')
        ].join('\n');

        const kDate = crypto.createHmac('sha256', this.secretAccessKey).update(dateStamp, 'utf8').digest();
        const kRegion = crypto.createHmac('sha256', kDate).update(VOLCENGINE_REGION, 'utf8').digest();
        const kService = crypto.createHmac('sha256', kRegion).update(VOLCENGINE_SERVICE, 'utf8').digest();
        const kSigning = crypto.createHmac('sha256', kService).update('request', 'utf8').digest();
        const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

        const authHeader = `HMAC-SHA256 Credential=${this.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

        return {
            'Host': VOLCENGINE_HOST,
            'X-Date': xDate,
            'X-Content-Sha256': payloadHash,
            'Authorization': authHeader
        };
    }
}

export const volcengineInpaintingService = new VolcengineInpaintingService();
