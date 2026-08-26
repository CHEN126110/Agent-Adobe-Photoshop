/**
 * 设计源文件解析服务（PSD 知识库 P0 · main 侧 IO 壳）
 *
 * ag-psd 离线解析设计师 PSD/PSB（不占 Photoshop、skipLayerImageData 不读像素），
 * 转换为最简树后交给 shared/psd-design-source 纯逻辑提炼 design-source-profile。
 * 只读：绝不修改源文件；P0 不落盘（profile 只作为工具结果返回）。
 */

import * as fs from 'fs';
import * as path from 'path';
import { readPsd } from 'ag-psd';
import {
    validatePsdDesignSourceFile,
    buildPsdDesignSourceProfile,
    type RawDesignSourceNode,
    type PsdDesignSourceProfile
} from '../../shared/psd-design-source';

export interface AnalyzePsdDesignSourceResult {
    success: boolean;
    profile?: PsdDesignSourceProfile;
    error?: string;
}

function toColorHex(color: unknown): string | undefined {
    const record = color as { r?: unknown; g?: unknown; b?: unknown } | undefined;
    if (!record || !Number.isFinite(Number(record.r))) return undefined;
    const channel = (value: unknown): string =>
        Math.max(0, Math.min(255, Math.round(Number(value) || 0))).toString(16).padStart(2, '0');
    return `#${channel(record.r)}${channel(record.g)}${channel(record.b)}`.toUpperCase();
}

function readTextColorHex(text: any): string | undefined {
    const direct = toColorHex(text?.style?.fillColor);
    if (direct) return direct;
    // 分段样式（styleRuns）里的首个填色：整层未设统一色时的常见形态（探针实测缺口）
    const runs = Array.isArray(text?.styleRuns) ? text.styleRuns : [];
    for (const run of runs) {
        const runColor = toColorHex(run?.style?.fillColor);
        if (runColor) return runColor;
    }
    return undefined;
}

function resolveNodeKind(layer: any): RawDesignSourceNode['kind'] {
    if (Array.isArray(layer?.children)) return 'group';
    if (layer?.text) return 'text';
    if (layer?.placedLayer) return 'smartObject';
    if (layer?.vectorMask || layer?.vectorFill || layer?.vectorOrigination) return 'shape';
    if (layer?.adjustment) return 'unknown';
    return 'pixel';
}

interface SmartObjectRecursionContext {
    linkedFiles: any[];
    depth: number;
    maxDepth: number;
}

const SMART_OBJECT_EMBED_MAX_BYTES = 900 * 1024 * 1024;
const PSD_SIGNATURE = '8BPS';

/**
 * 嵌入式智能对象内部结构的受限递归（2026-08-24）：设计的封装语义藏在 SO 边界里
 * （真机实证：纯底色卡的主体件/阴影件、场景卡的整卡结构都只有钻进 SO 才能看到）。
 * 深度默认 2；内容非 PSB（JPEG 等位图）标注媒体终点；单个 SO 失败留痕不炸整树。
 */
function attachSmartObjectContents(node: RawDesignSourceNode, layer: any, ctx: SmartObjectRecursionContext): void {
    if (ctx.depth >= ctx.maxDepth) return;
    const placedId = String(layer?.placedLayer?.id || '').trim();
    if (!placedId) return;
    const linked = ctx.linkedFiles.find((file) => String(file?.id || '').trim() === placedId);
    if (!linked?.data) return;
    const data = Buffer.isBuffer(linked.data) ? linked.data : Buffer.from(linked.data);
    if (data.length > SMART_OBJECT_EMBED_MAX_BYTES) {
        node.smartObjectContentsError = `内嵌文件过大（${Math.round(data.length / 1024 / 1024)}MB），跳过内部解析。`;
        return;
    }
    if (data.length < 4 || data.toString('latin1', 0, 4) !== PSD_SIGNATURE) {
        node.smartObjectMedia = 'image';
        return;
    }
    try {
        const inner = readPsd(data, { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true });
        const innerCtx: SmartObjectRecursionContext = {
            linkedFiles: Array.isArray(inner.linkedFiles) ? inner.linkedFiles : [],
            depth: ctx.depth + 1,
            maxDepth: ctx.maxDepth
        };
        node.smartObjectContents = {
            canvas: { width: Number(inner.width) || 0, height: Number(inner.height) || 0 },
            tree: Array.isArray(inner.children) ? inner.children.map((child) => toRawNode(child, innerCtx)) : []
        };
    } catch (error) {
        node.smartObjectContentsError = `内部解析失败：${error instanceof Error ? error.message : String(error)}`;
    }
}

function toRawNode(layer: any, ctx?: SmartObjectRecursionContext): RawDesignSourceNode {
    const kind = resolveNodeKind(layer);
    const node: RawDesignSourceNode = {
        name: typeof layer?.name === 'string' ? layer.name : undefined,
        kind,
        left: Number.isFinite(Number(layer?.left)) ? Number(layer.left) : undefined,
        top: Number.isFinite(Number(layer?.top)) ? Number(layer.top) : undefined,
        right: Number.isFinite(Number(layer?.right)) ? Number(layer.right) : undefined,
        bottom: Number.isFinite(Number(layer?.bottom)) ? Number(layer.bottom) : undefined,
        hasEffects: Boolean(layer?.effects && Object.keys(layer.effects).some((key) => key !== 'disabled'))
    };
    // 技法参数展开（2026-08-23）：effects 的原始参数（投影距离 / 描边 / 渐变…）是可复用的技法配方，
    // 只带布尔会把技法信息全部丢掉。H3 普查显示带 effects 图层仅约 1%，完整透传不会膨胀 profile。
    if (node.hasEffects && layer?.effects && typeof layer.effects === 'object') {
        const enabledEffects: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(layer.effects as Record<string, unknown>)) {
            if (key === 'disabled') continue;
            enabledEffects[key] = value;
        }
        if (Object.keys(enabledEffects).length > 0) {
            node.effects = enabledEffects;
        }
    }
    if (typeof layer?.blendMode === 'string' && layer.blendMode !== 'normal' && layer.blendMode !== 'pass through' && layer.blendMode !== 'passThrough') {
        node.blendMode = layer.blendMode;
    }
    if (kind === 'text') {
        node.text = {
            content: typeof layer?.text?.text === 'string' ? layer.text.text : undefined,
            fontName: layer?.text?.style?.font?.name ? String(layer.text.style.font.name) : undefined,
            fontSize: Number.isFinite(Number(layer?.text?.style?.fontSize)) ? Number(layer.text.style.fontSize) : undefined,
            colorHex: readTextColorHex(layer?.text)
        };
    }
    if (kind === 'group') {
        node.children = (layer.children as any[]).map((child) => toRawNode(child, ctx));
    }
    if (kind === 'smartObject' && ctx) {
        attachSmartObjectContents(node, layer, ctx);
    }
    return node;
}

export async function analyzePsdDesignSourceFile(filePath: string): Promise<AnalyzePsdDesignSourceResult> {
    const normalizedPath = String(filePath || '').trim();
    if (!normalizedPath || !fs.existsSync(normalizedPath)) {
        return { success: false, error: `设计源文件不存在：${normalizedPath || '(空路径)'}。请确认完整路径。` };
    }
    const stats = fs.statSync(normalizedPath);
    const validation = validatePsdDesignSourceFile({ filePath: normalizedPath, fileSizeBytes: stats.size });
    if (!validation.ok) {
        return { success: false, error: validation.reason };
    }
    try {
        const startedAt = Date.now();
        const buffer = fs.readFileSync(normalizedPath);
        const psd = readPsd(buffer, {
            skipLayerImageData: true,
            skipCompositeImageData: true,
            skipThumbnail: true
        });
        const parseMs = Date.now() - startedAt;
        const rootCtx: SmartObjectRecursionContext = {
            linkedFiles: Array.isArray((psd as any).linkedFiles) ? (psd as any).linkedFiles : [],
            depth: 0,
            maxDepth: 2
        };
        const tree = Array.isArray(psd.children) ? psd.children.map((child) => toRawNode(child, rootCtx)) : [];
        const profile = buildPsdDesignSourceProfile({
            fileName: path.basename(normalizedPath),
            format: validation.format,
            fileSizeBytes: stats.size,
            parseMs,
            canvas: { width: Number(psd.width) || 0, height: Number(psd.height) || 0 },
            tree
        });
        return { success: true, profile };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            success: false,
            error: `解析设计源文件失败：${message}。文件可能损坏或使用了 ag-psd 不支持的特性；可在 Photoshop 中打开后用 getLayerHierarchy 读取结构。`
        };
    }
}
