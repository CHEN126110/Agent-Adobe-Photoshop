/**
 * 工具结果整理（纯逻辑，可被 smoke 直接测试）
 *
 * 三个职责：
 * 1. sanitizeToolOutputForModel：回填给模型的工具结果做超长字段截断，并剥离内部下一步
 *    Tool 规划字段——此前快照 base64 以完整 JSON 文本进入上下文（token 炸弹且模型
 *    无法作为图像理解），内部恢复契约也会越权成为模型下一步提示
 * 2. extractImageFromToolResult：从快照类工具结果中提取图像，
 *    由 Agent 循环以 user 图像消息回传给视觉模型（模型"看着画布"工作的基础）
 * 3. compactPostWriteImagePayloadForRuntimeLog：图像已经转发给视觉模型和用户后，
 *    从运行日志释放像素，只保留尺寸、格式与复核身份，避免长图多轮执行累积 MB 级字符串。
 */

import {
    MAX_VISUAL_OBSERVATION_BUNDLE_ITEMS,
    VISUAL_OBSERVATION_BUNDLE_VERSION,
    buildVisualObservationKey,
    inspectVisualObservationBundles,
    summarizeVisualObservationBundles,
    type VisualObservationBundleSummary,
    type VisualObservationIdentity,
    type VisualObservationItem
} from '../../../shared/visual-observation-bundle';
import { sha256Hex } from '../../../shared/agent-runtime-v5/content-hash';

/** 单个字符串字段截断阈值（base64 等长字段超过即截断） */
const MAX_STRING_FIELD_CHARS = 1500;
/** 数组保留条数上限 */
const MAX_ARRAY_ITEMS = 50;
/**
 * 深度上限，防御循环引用之外的深结构。
 * 图层树每层组占 2 级 JSON 深度（组对象 + children 数组）：6 只能穿透约 3 层组嵌套，
 * 真机详情页（详情页>屏组>图片/文案>层）被剪成「嵌套过深」——rootLayerId 子树也照样被剪。
 * 放宽到 14（约 7 层组嵌套）；字符串/数组上限仍在，上下文保护不失效。
 * 查特定图层优先用 findLayers（扁平结果，不吃深度），不靠翻树。
 */
const MAX_DEPTH = 14;
/** 识别为图像 base64 的最小长度 */
const MIN_IMAGE_BASE64_CHARS = 500;
/** 受控图像容器最多向下检查的层数，避免异常 Tool 结果造成无界遍历 */
const MAX_IMAGE_CONTAINER_DEPTH = 8;
/** 单次 Tool 结果最多检查的容器节点数 */
const MAX_IMAGE_CONTAINER_NODES = 256;
const MAX_IMAGE_COMPACTION_DEPTH = 12;
const MAX_IMAGE_COMPACTION_NODES = 2048;
const MAX_IMAGE_COMPACTION_ARRAY_ITEMS = 512;
/**
 * Tool / Skill 可以在原始结果里携带内部续跑契约，供 Runtime 对账和 staged 执行点使用；
 * 这些字段不能回灌模型成为隐式下一步计划。事实、失败原因和普通恢复说明仍会保留。
 */
const MODEL_PLANNING_AUTHORITY_FIELD_KEYS = new Set([
    'allowedtoolnames',
    'nextrequiredtool',
    'nextrequiredtools',
    'nextrequiredtooloptions',
    'nextrequiredtoolreason',
    'requirednexttool',
    'requiredtool',
    'requiredtoolcall',
    'requiredarguments'
]);
/**
 * 只在这些通用结果容器中向下寻找图像。
 *
 * 这里刻意不递归任意对象：Tool 结果可能同时携带 Host 元数据、调试 payload 或用户内容；
 * 视觉通道只读取明确的结果/观察容器，避免把不相关的长字符串误当图片。
 */
const CONTROLLED_IMAGE_CONTAINER_KEYS = new Set([
    'snapshot',
    'snapshots',
    // createProjectContactSheetOverview 的总览图（sheet.imageData）：模型「一眼比所有候选」的眼睛，
    // 此前不在容器名单里，总览图从来到不了主模型（run 498：选图只看文件名）。
    'sheet',
    'screens',
    'screensnapshots',
    'images',
    'image',
    'data',
    'result',
    'output',
    'toolresults',
    'observations',
    'visualobservations',
    'artifacts',
    'visualobservationbundle',
    'visualobservationbundles'
]);
/** 显式 Bundle 由契约读取器优先处理；通用递归跳过，避免同一像素以匿名路径再进一次。 */
const EXPLICIT_VISUAL_OBSERVATION_CONTAINER_KEYS = new Set([
    'visualobservationbundle',
    'visualobservationbundles'
]);
/** 这些容器可直接承载 base64 字符串或字符串数组，其余容器仍必须有明确像素字段 */
const DIRECT_IMAGE_CONTAINER_KEYS = new Set([
    'snapshot',
    'snapshots',
    'screens',
    'screensnapshots',
    'images',
    'image'
]);
const IMAGE_PAYLOAD_KEYS = new Set([
    'base64',
    'imagedata',
    'dataurl',
    ...DIRECT_IMAGE_CONTAINER_KEYS
]);

export interface ToolResultImage {
    data: string;
    mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
    sourceId?: string | number;
    sourceName?: string;
    observationIdentity?: VisualObservationIdentity;
    observationKey?: string;
    resultPath?: string;
    sourceKind?: string;
    document?: string;
    history?: string;
}

export interface ToolResultImageCollection {
    images: ToolResultImage[];
    bundleSummary?: VisualObservationBundleSummary;
    overflow?: {
        expectedCount: number;
        extractedCount: number;
        omittedCount: number;
        reason: 'harness_candidate_limit' | 'producer_limit' | 'payload_scan_limit';
    };
}

function encodedImageLength(value: unknown): number {
    return typeof value === 'string' ? value.length : 0;
}

/**
 * renderLayout 的自动写后快照只需要在当前观察通道中存活到图片被读取。
 * Agent 的完成契约依赖 postWriteObservation / agentVisualObservation 与快照元数据，
 * 不依赖原始像素；就地压缩可同时释放 toolResults 与 toolCallLog 共享的同一结果对象。
 */
export function compactPostWriteImagePayloadForRuntimeLog(output: any): void {
    if (!output || typeof output !== 'object') return;
    compactImagesInControlledContainer(
        output,
        '',
        0,
        new WeakSet<object>(),
        { visitedNodes: 0 },
        false
    );
}

function normalizeFieldKey(key: string): string {
    return String(key || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function isSupportedImageDataUrl(value: string): boolean {
    return /^data:image\/(?:png|jpeg|webp);base64,/i.test(value);
}

function looksLikeRawImageBase64(value: string): boolean {
    if (value.length < MIN_IMAGE_BASE64_CHARS) return false;
    return /^[A-Za-z0-9+/=\r\n]+$/.test(value.slice(0, 1000));
}

function shouldOmitImagePayloadFromText(value: string, fieldKey?: string): boolean {
    if (isSupportedImageDataUrl(value)) return true;
    if (!fieldKey || !IMAGE_PAYLOAD_KEYS.has(normalizeFieldKey(fieldKey))) return false;
    return looksLikeRawImageBase64(value);
}

function sanitizeValueForModel(value: any, depth: number, fieldKey?: string): any {
    if (depth > MAX_DEPTH) return '[嵌套过深，已省略]';
    if (typeof value === 'string') {
        if (shouldOmitImagePayloadFromText(value, fieldKey)) {
            return `[图像像素已从文本上下文省略（已截断），原长 ${value.length} 字符]`;
        }
        if (value.length > MAX_STRING_FIELD_CHARS) {
            return `${value.slice(0, MAX_STRING_FIELD_CHARS)}…[已截断，原长 ${value.length} 字符]`;
        }
        return value;
    }
    if (Array.isArray(value)) {
        const limited = value.slice(0, MAX_ARRAY_ITEMS).map(item => sanitizeValueForModel(item, depth + 1, fieldKey));
        if (value.length > MAX_ARRAY_ITEMS) {
            limited.push(`[数组共 ${value.length} 项，仅保留前 ${MAX_ARRAY_ITEMS} 项]`);
        }
        return limited;
    }
    if (value && typeof value === 'object') {
        const out: Record<string, any> = {};
        for (const [key, val] of Object.entries(value)) {
            if (MODEL_PLANNING_AUTHORITY_FIELD_KEYS.has(normalizeFieldKey(key))) continue;
            out[key] = sanitizeValueForModel(val, depth + 1, key);
        }
        return out;
    }
    return value;
}

/** 深度截断工具输出，并从模型上下文剥离图像像素与内部下一步 Tool 规划字段 */
export function sanitizeToolOutputForModel(value: any, depth = 0): any {
    return sanitizeValueForModel(value, depth);
}

function asModelRecord(value: unknown): Record<string, any> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, any>
        : undefined;
}

/**
 * Skill 的完整返回值同时服务于 Runtime 记账、续跑、交互卡和开发诊断，不能直接整包回灌模型。
 * 模型只需要知道这项工作做到哪里、形成了什么以及还差什么。
 * Skill 的 nextAction / recovery 属于生产者建议，不能成为主 Agent 的下一步计划。
 *
 * 调用方必须先确认 toolName 是已注册 Skill；这里再校验 runner 签发的规范 observation，
 * 避免普通 Tool 伪造相似字段后取得 Skill 投影待遇。原始返回对象不会被修改。
 */
function describeSkillWorkState(status: unknown): string {
    switch (String(status || '').trim()) {
        case 'completed': return '已完成';
        case 'needs_repair': return '需要继续设计';
        case 'blocked': return '等待必要信息';
        case 'failed': return '未完成';
        default: return '需要继续判断';
    }
}

function isInternalSkillExecutionDetail(value: unknown): boolean {
    return /^已执行\s*skill[：:]/i.test(String(value || '').trim());
}

export function projectSkillWorkflowOutputForModel(
    skillId: string,
    value: unknown,
    options: { includeDetailedResult?: boolean } = {}
): unknown {
    const sanitized = sanitizeToolOutputForModel(value);
    const record = asModelRecord(sanitized);
    const data = asModelRecord(record?.data);
    const observation = asModelRecord(data?.agentReActObservation);
    const normalizedSkillId = String(skillId || '').trim();
    const trustedObservation = Boolean(
        normalizedSkillId
        && observation?.version === 'agent-react-observation/v0'
        && observation?.kind === 'skill'
        && observation?.actionId === `skill:${normalizedSkillId}`
    );
    if (!record || !trustedObservation || !observation) return sanitized;

    const summary = String(observation.summary || '').trim();
    const detailedResult = options.includeDetailedResult === true
        ? String(record.message || '').trim()
        : '';
    const details = Array.isArray(observation.details)
        ? observation.details.filter((item) => !isInternalSkillExecutionDetail(item))
        : [];

    return {
        ...(typeof record.success === 'boolean' ? { success: record.success } : {}),
        ...(record.nonFatal === true ? { nonFatal: true } : {}),
        ...(record.cancelled === true ? { cancelled: true } : {}),
        workResult: {
            state: describeSkillWorkState(observation.status),
            summary,
            ...(detailedResult && detailedResult !== summary ? { result: detailedResult } : {}),
            details,
            issues: Array.isArray(observation.blockers) ? observation.blockers : [],
            notes: Array.isArray(observation.warnings) ? observation.warnings : []
        },
        ...(data?.requiresUserAction === true || data?.awaitingUserConfirmation === true
            ? { waitingForUser: true }
            : {}),
        ...(record.untrustedExternalContent === true ? { untrustedExternalContent: true } : {}),
        ...(record.contentTrustNotice ? { contentTrustNotice: record.contentTrustNotice } : {}),
        ...(record.contextEnvelope ? { contextEnvelope: record.contextEnvelope } : {})
    };
}

function resolveMediaType(formatHint: string, fallback: ToolResultImage['mediaType'] = 'image/png'): ToolResultImage['mediaType'] {
    const hint = String(formatHint || '').toLowerCase();
    if (hint.includes('jpeg') || hint.includes('jpg')) return 'image/jpeg';
    if (hint.includes('webp')) return 'image/webp';
    if (hint.includes('png')) return 'image/png';
    return fallback;
}

function readFormatHint(value: Record<string, any>, inheritedFormatHint: string): string {
    return String(value.format || value.mimeType || value.mediaType || inheritedFormatHint || '');
}

function resolveImageCandidate(candidate: unknown, formatHint: string): ToolResultImage | null {
    if (typeof candidate !== 'string' || candidate.length < MIN_IMAGE_BASE64_CHARS) return null;

    const dataUrlMatch = candidate.match(/^data:(image\/(?:png|jpeg|webp));base64,([\s\S]+)$/i);
    if (dataUrlMatch) {
        return {
            data: dataUrlMatch[2].replace(/[\r\n]/g, ''),
            mediaType: dataUrlMatch[1].toLowerCase() as ToolResultImage['mediaType']
        };
    }

    // 原始 base64：抽样校验字符集，避免把普通长文本当图像
    if (looksLikeRawImageBase64(candidate)) {
        return {
            data: candidate.replace(/[\r\n]/g, ''),
            mediaType: resolveMediaType(formatHint)
        };
    }
    return null;
}

/**
 * 把一条已验证的 Bundle item 转成模型图像载荷。
 * 这个单项转换不套用通用 ToolResult 的 24 张候选上限；R5 会先对
 * 整个 ReviewSet 做 profile 预算拒绝，因此不能在这里静默截掉后续屏。
 */
export function buildToolResultImageFromVisualObservationItem(
    item: Pick<VisualObservationItem, 'identity' | 'image' | 'label'>
): ToolResultImage | null {
    const imageValue = item.image?.dataUrl
        || item.image?.base64
        || item.image?.imageData;
    const image = resolveImageCandidate(
        imageValue,
        item.image?.mediaType || item.image?.format || ''
    );
    if (!image) return null;
    return {
        ...image,
        sourceId: item.identity.sourceId,
        ...(item.label ? { sourceName: item.label } : {}),
        observationIdentity: { ...item.identity },
        observationKey: buildVisualObservationKey(item.identity),
        resultPath: item.identity.resultPath,
        sourceKind: item.identity.sourceKind,
        document: item.identity.document,
        history: item.identity.history
    };
}

function compactImagesInControlledContainer(
    value: unknown,
    inheritedFormatHint: string,
    depth: number,
    visited: WeakSet<object>,
    budget: { visitedNodes: number },
    allowDirectImageString: boolean
): void {
    if (!value
        || typeof value !== 'object'
        || depth > MAX_IMAGE_COMPACTION_DEPTH
        || budget.visitedNodes >= MAX_IMAGE_COMPACTION_NODES
        || visited.has(value)) {
        return;
    }
    visited.add(value);
    budget.visitedNodes += 1;

    if (Array.isArray(value)) {
        for (let index = 0; index < Math.min(value.length, MAX_IMAGE_COMPACTION_ARRAY_ITEMS); index++) {
            const item = value[index];
            if (typeof item === 'string'
                && allowDirectImageString
                && resolveImageCandidate(item, inheritedFormatHint)) {
                value[index] = {
                    omittedFromRuntimeLog: true,
                    encodedLength: item.length,
                    contentFingerprint: `sha256:${sha256Hex(item)}`
                };
                continue;
            }
            compactImagesInControlledContainer(
                item,
                inheritedFormatHint,
                depth + 1,
                visited,
                budget,
                allowDirectImageString
            );
        }
        return;
    }

    const record = value as Record<string, any>;
    const formatHint = readFormatHint(record, inheritedFormatHint);
    let removedLength = 0;
    let contentFingerprint = '';
    for (const [key, candidate] of Object.entries(record)) {
        const normalizedKey = normalizeFieldKey(key);
        if (!IMAGE_PAYLOAD_KEYS.has(normalizedKey) || typeof candidate !== 'string') continue;
        if (!resolveImageCandidate(candidate, formatHint)) continue;
        removedLength = Math.max(removedLength, encodedImageLength(candidate));
        contentFingerprint = `sha256:${sha256Hex(candidate)}`;
        if (normalizedKey === 'base64' || normalizedKey === 'imagedata') {
            delete record[key];
        } else {
            record[key] = {
                omittedFromRuntimeLog: true,
                encodedLength: candidate.length,
                contentFingerprint
            };
        }
    }
    if (removedLength > 0) {
        record.omittedFromRuntimeLog = true;
        record.encodedLength = Math.max(Number(record.encodedLength || 0), removedLength);
        record.contentFingerprint = contentFingerprint;
    }

    for (const [key, child] of Object.entries(record)) {
        const normalizedKey = normalizeFieldKey(key);
        const isBundleItems = record.version === VISUAL_OBSERVATION_BUNDLE_VERSION
            && normalizedKey === 'items';
        if (!CONTROLLED_IMAGE_CONTAINER_KEYS.has(normalizedKey) && !isBundleItems) continue;
        compactImagesInControlledContainer(
            child,
            formatHint,
            depth + 1,
            visited,
            budget,
            DIRECT_IMAGE_CONTAINER_KEYS.has(normalizedKey)
        );
    }
}

function pushUniqueImage(
    images: ToolResultImage[],
    image: ToolResultImage | null,
    limit: number
): void {
    if (!image || images.length >= limit) return;
    const pixelSignature = `${image.mediaType}:${image.data.length}:${image.data.slice(0, 48)}:${image.data.slice(-48)}`;
    const sourceSignature = [
        image.document || '',
        image.history || '',
        image.sourceKind || '',
        String(image.sourceId ?? '')
    ].join('|');
    const hasStableSourceSignature = Boolean(
        image.document
        && image.document !== 'unknown'
        && image.history
        && image.history !== 'unknown'
        && image.sourceKind
        && image.sourceKind !== 'unknown'
        && image.sourceId !== undefined
        && String(image.sourceId).trim()
        && String(image.sourceId) !== 'unknown'
    );
    const identitySignature = image.observationKey
        || [
            image.resultPath || '',
            image.document || '',
            image.history || '',
            image.sourceKind || '',
            String(image.sourceId ?? '')
        ].join('|');
    const signature = `${identitySignature || 'anonymous'}:${pixelSignature}`;
    if (images.some((candidate) => {
        const candidatePixelSignature = `${candidate.mediaType}:${candidate.data.length}:${candidate.data.slice(0, 48)}:${candidate.data.slice(-48)}`;
        const candidateSourceSignature = [
            candidate.document || '',
            candidate.history || '',
            candidate.sourceKind || '',
            String(candidate.sourceId ?? '')
        ].join('|');
        const candidateHasStableSourceSignature = Boolean(
            candidate.document
            && candidate.document !== 'unknown'
            && candidate.history
            && candidate.history !== 'unknown'
            && candidate.sourceKind
            && candidate.sourceKind !== 'unknown'
            && candidate.sourceId !== undefined
            && String(candidate.sourceId).trim()
            && String(candidate.sourceId) !== 'unknown'
        );
        if (hasStableSourceSignature
            && candidateHasStableSourceSignature
            && candidateSourceSignature === sourceSignature
            && candidatePixelSignature === pixelSignature) {
            return true;
        }
        const candidateIdentitySignature = candidate.observationKey
            || [
                candidate.resultPath || '',
                candidate.document || '',
                candidate.history || '',
                candidate.sourceKind || '',
                String(candidate.sourceId ?? '')
            ].join('|');
        return `${candidateIdentitySignature || 'anonymous'}:${candidatePixelSignature}` === signature;
    })) {
        return;
    }
    images.push(image);
}

function collectImagesInControlledContainer(
    value: unknown,
    inheritedFormatHint: string,
    depth: number,
    visited: WeakSet<object>,
    budget: { visitedNodes: number },
    allowDirectImageString: boolean,
    images: ToolResultImage[],
    limit: number,
    resultPath: string,
    outer: string,
    inheritedIdentity?: Partial<VisualObservationIdentity>
): void {
    if (images.length >= limit) return;
    if (typeof value === 'string') {
        if (allowDirectImageString) {
            const resolved = resolveImageCandidate(value, inheritedFormatHint);
            const observationIdentity: VisualObservationIdentity = {
                outer,
                resultPath,
                document: inheritedIdentity?.document || 'unknown',
                history: inheritedIdentity?.history || 'unknown',
                sourceKind: inheritedIdentity?.sourceKind || 'image',
                sourceId: resultPath
            };
            pushUniqueImage(images, resolved ? {
                ...resolved,
                sourceId: observationIdentity.sourceId,
                observationIdentity,
                observationKey: buildVisualObservationKey(observationIdentity),
                resultPath,
                sourceKind: observationIdentity.sourceKind,
                document: observationIdentity.document,
                history: observationIdentity.history
            } : null, limit);
        }
        return;
    }
    if (!value
        || typeof value !== 'object'
        || depth > MAX_IMAGE_CONTAINER_DEPTH
        || budget.visitedNodes >= MAX_IMAGE_CONTAINER_NODES) {
        return;
    }
    if (visited.has(value)) return;
    visited.add(value);
    budget.visitedNodes += 1;

    if (Array.isArray(value)) {
        for (let index = 0; index < Math.min(value.length, MAX_ARRAY_ITEMS); index++) {
            const item = value[index];
            collectImagesInControlledContainer(
                item,
                inheritedFormatHint,
                depth + 1,
                visited,
                budget,
                allowDirectImageString,
                images,
                limit,
                `${resultPath}[${index}]`,
                outer,
                inheritedIdentity
            );
            if (images.length >= limit) return;
        }
        return;
    }

    const record = value as Record<string, any>;
    const formatHint = readFormatHint(record, inheritedFormatHint);
    const rawHistoryStateRef = record.historyStateRef && typeof record.historyStateRef === 'object'
        ? record.historyStateRef
        : {};
    const explicitIdentity = record.identity && typeof record.identity === 'object'
        ? record.identity
        : {};
    const sourceId = explicitIdentity.sourceId
        ?? record.sourceId
        ?? record.screenId
        ?? inheritedIdentity?.sourceId
        ?? resultPath;
    const sourceKind = explicitIdentity.sourceKind
        ?? record.sourceKind
        ?? inheritedIdentity?.sourceKind
        ?? (/screens?\[|screensnapshot/i.test(resultPath) ? 'screen' : 'image');
    const document = explicitIdentity.document
        ?? explicitIdentity.documentId
        ?? record.document
        ?? record.documentId
        ?? rawHistoryStateRef.documentId
        ?? inheritedIdentity?.document
        ?? 'unknown';
    const history = explicitIdentity.history
        ?? explicitIdentity.historyStateId
        ?? record.history
        ?? record.historyStateId
        ?? rawHistoryStateRef.historyStateId
        ?? inheritedIdentity?.history
        ?? 'unknown';
    const observationIdentity: VisualObservationIdentity = {
        outer: String(explicitIdentity.outer || outer || 'unknown'),
        resultPath: String(explicitIdentity.resultPath || resultPath || '$'),
        document: String(document),
        history: String(history),
        sourceKind: String(sourceKind),
        sourceId: String(sourceId)
    };
    for (const [key, candidate] of Object.entries(record)) {
        if (!IMAGE_PAYLOAD_KEYS.has(normalizeFieldKey(key))) continue;
        const image = resolveImageCandidate(candidate, formatHint);
        pushUniqueImage(images, image ? {
            ...image,
            sourceId: record.screenId ?? record.sourceId ?? observationIdentity.sourceId,
            ...(record.screenName || record.sourceName || record.label
                ? { sourceName: String(record.screenName || record.sourceName || record.label) }
                : {}),
            observationIdentity,
            observationKey: buildVisualObservationKey(observationIdentity),
            resultPath: observationIdentity.resultPath,
            sourceKind: observationIdentity.sourceKind,
            document: observationIdentity.document,
            history: observationIdentity.history
        } : null, limit);
        if (images.length >= limit) return;
    }

    const entries = Object.entries(record);
    for (const controlledKey of CONTROLLED_IMAGE_CONTAINER_KEYS) {
        if (EXPLICIT_VISUAL_OBSERVATION_CONTAINER_KEYS.has(controlledKey)) continue;
        for (const [key, child] of entries) {
            if (normalizeFieldKey(key) !== controlledKey) continue;
            collectImagesInControlledContainer(
                child,
                formatHint,
                depth + 1,
                visited,
                budget,
                DIRECT_IMAGE_CONTAINER_KEYS.has(controlledKey),
                images,
                limit,
                `${resultPath}.${key}`,
                outer,
                observationIdentity
            );
            if (images.length >= limit) return;
        }
    }
}

/**
 * 从工具结果中提取图像（base64 或 data-url）。
 * 检查通用、受控的结果/观察容器；返回 null 表示该结果不含可用图像。
 *
 * 形状必须覆盖真实 UXP 返回（视神经断裂病例 2026-07-07）：
 * - getCanvasSnapshot 返回嵌套 `snapshot: { base64, format, ... }`——此前候选列表只认
 *   字符串字段，全系统调用量最大的像素眼「成功」了 16 次却没有一张图真正进过模型，
 *   模型在「以为自己看过」的状态下做设计（run-record 实证：92 会话中该工具图像转发 0 次）。
 * - getScreenSnapshots 的真实 UXP 返回在 `snapshots[].base64`；历史包装层也可能使用
 *   `screens[]`、`images[]` 或 `data.screenSnapshots[]`。
 */
export function extractImageFromToolResult(output: any): ToolResultImage | null {
    return extractImagesFromToolResult(output, 1)[0] || null;
}

/**
 * 从单个 Tool 结果收集多图视觉候选与覆盖率。
 *
 * 显式 `visualObservationBundle/v1` 优先；随后才扫描兼容的 UXP 结果形状。Bundle 的
 * expectedObservationCount / overflow 会被原样投影，供 Agent 和完成契约识别未读观察记录。
 */
export function collectImagesFromToolResult(
    output: any,
    limit = 3,
    outer = 'unknown'
): ToolResultImageCollection {
    if (!output || typeof output !== 'object') return { images: [] };
    // The collector is also used by the Runtime evidence verifier. Keep the internal scan
    // ceiling aligned with the Bundle contract; ordinary model-facing callers still pass
    // their own much smaller candidate limit (typically 3/8/24).
    const normalizedLimit = Math.max(
        1,
        Math.min(MAX_VISUAL_OBSERVATION_BUNDLE_ITEMS, Math.round(Number(limit) || 3))
    );
    const images: ToolResultImage[] = [];
    const bundleScan = inspectVisualObservationBundles(output, outer);
    const bundles = bundleScan.bundles;
    const bundleSummary = bundles.length > 0
        ? summarizeVisualObservationBundles(bundles)
        : undefined;
    for (const bundle of bundles) {
        for (const item of bundle.items) {
            if (images.length >= normalizedLimit) break;
            pushUniqueImage(
                images,
                buildToolResultImageFromVisualObservationItem(item),
                normalizedLimit
            );
        }
        if (images.length >= normalizedLimit) break;
    }
    collectImagesInControlledContainer(
        output,
        '',
        0,
        new WeakSet<object>(),
        { visitedNodes: 0 },
        false,
        images,
        normalizedLimit,
        '$',
        outer
    );
    const expectedCount = bundleSummary?.expectedCount || images.length;
    const producerOverflow = bundleSummary?.overflowCount || 0;
    const omittedByHarness = Math.max(0, (bundleSummary?.capturedCount || images.length) - images.length);
    const scanOmitted = bundleScan.truncated || bundleScan.invalidBundleCount > 0 ? 1 : 0;
    const omittedCount = Math.max(producerOverflow, omittedByHarness, scanOmitted);
    return {
        images,
        ...(bundleSummary ? { bundleSummary } : {}),
        ...(omittedCount > 0 ? {
            overflow: {
                expectedCount,
                extractedCount: images.length,
                omittedCount,
                reason: scanOmitted > 0
                    ? 'payload_scan_limit'
                    : producerOverflow > 0
                    ? 'producer_limit'
                    : 'harness_candidate_limit'
            }
        } : {})
    };
}

/** 从单个 Tool 结果提取最多 limit 张按观察记录身份去重的图像。 */
export function extractImagesFromToolResult(
    output: any,
    limit = 3,
    outer = 'unknown'
): ToolResultImage[] {
    return collectImagesFromToolResult(output, limit, outer).images;
}
