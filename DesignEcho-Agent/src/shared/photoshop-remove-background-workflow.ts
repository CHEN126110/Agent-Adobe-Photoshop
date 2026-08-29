import {
    normalizeSemanticMattingGuidance,
    type SemanticMattingGuidance
} from './semantic-matting-guidance';

export type RemoveBackgroundWorkflowOutputFormat = 'mask' | 'selection' | 'channel' | 'layer';
export type RemoveBackgroundWorkflowQuality = 'fast' | 'balanced' | 'quality';

export interface RemoveBackgroundWorkflowRequest {
    expectedDocumentId: number;
    expectedHistoryStateId: number;
    layerId: number;
    targetPrompt: string;
    outputFormat: RemoveBackgroundWorkflowOutputFormat;
    quality: RemoveBackgroundWorkflowQuality;
    sampleAllLayers: boolean;
    enableHairRefine: boolean;
    enableFabricRefine: boolean;
    semanticGuidance?: SemanticMattingGuidance;
}

export type RemoveBackgroundWorkflowCompileResult =
    | { valid: true; request: RemoveBackgroundWorkflowRequest }
    | { valid: false; code: string; error: string };

const OUTPUT_FORMATS = new Set<RemoveBackgroundWorkflowOutputFormat>([
    'mask',
    'selection',
    'channel',
    'layer'
]);

const QUALITY_PRESETS = new Set<RemoveBackgroundWorkflowQuality>([
    'fast',
    'balanced',
    'quality'
]);

function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
}

function readPositiveInteger(value: unknown): number | undefined {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) return undefined;
    return parsed;
}

function resolveOutputFormat(
    params: Record<string, unknown>
): RemoveBackgroundWorkflowCompileResult | RemoveBackgroundWorkflowOutputFormat {
    const explicit = String(params.outputFormat || '').trim() as RemoveBackgroundWorkflowOutputFormat;
    if (explicit) {
        if (OUTPUT_FORMATS.has(explicit)) return explicit;
        return {
            valid: false,
            code: 'matting_output_format_invalid',
            error: '抠图输出只能选择新图层、图层蒙版、选区或 Alpha 通道。'
        };
    }

    const outputMode = String(params.outputMode || '').trim().toLowerCase();
    if (outputMode === 'new_layer' || outputMode === 'layer') return 'layer';
    if (outputMode === 'mask') return 'mask';
    if (outputMode === 'selection') return 'selection';
    if (outputMode === 'channel') return 'channel';
    if (outputMode === 'replace' || params.createNewLayer === false) {
        return {
            valid: false,
            code: 'matting_destructive_replace_unsupported',
            error: '当前可靠抠图链不支持直接覆盖原像素；请选择新图层或非破坏性蒙版。'
        };
    }
    if (params.useMask === true) return 'mask';
    return 'layer';
}

function resolveQuality(
    value: unknown
): RemoveBackgroundWorkflowCompileResult | RemoveBackgroundWorkflowQuality {
    if (value === undefined || value === null || typeof value === 'number') return 'balanced';
    const normalized = String(value).trim().toLowerCase() as RemoveBackgroundWorkflowQuality;
    if (QUALITY_PRESETS.has(normalized)) return normalized;
    return {
        valid: false,
        code: 'matting_quality_invalid',
        error: '抠图质量只能选择 fast、balanced 或 quality。'
    };
}

export function compileRemoveBackgroundWorkflowRequest(input: {
    params: unknown;
    documentInfo: unknown;
}): RemoveBackgroundWorkflowCompileResult {
    const params = asRecord(input.params);
    const sourceType = String(params.sourceType || 'current_layer').trim().toLowerCase();
    if (sourceType !== 'current_layer') {
        return {
            valid: false,
            code: 'matting_source_not_prepared',
            error: '指定文件或项目素材必须先置入 Photoshop 并取得真实图层身份，不能静默改用当前图层。'
        };
    }

    const documentInfo = asRecord(input.documentInfo);
    const document = asRecord(documentInfo.document);
    const historyStateRef = asRecord(documentInfo.historyStateRef);
    const documentId = readPositiveInteger(document.id);
    const historyDocumentId = readPositiveInteger(historyStateRef.documentId);
    const historyStateId = readPositiveInteger(historyStateRef.historyStateId);
    if (documentInfo.success === false
        || !documentId
        || !historyStateId
        || historyDocumentId !== documentId) {
        return {
            valid: false,
            code: 'matting_document_identity_unavailable',
            error: '无法取得当前 Photoshop 文档与历史版本，抠图工作流没有启动。'
        };
    }

    const layerId = readPositiveInteger(params.layerId)
        || readPositiveInteger(document.activeLayerId);
    if (!layerId) {
        return {
            valid: false,
            code: 'matting_layer_identity_unavailable',
            error: '当前没有可验证的目标图层，抠图工作流没有启动。'
        };
    }

    const outputFormat = resolveOutputFormat(params);
    if (typeof outputFormat !== 'string') return outputFormat;
    const quality = resolveQuality(params.quality);
    if (typeof quality !== 'string') return quality;

    const targetPrompt = String(params.targetPrompt || '').trim();
    const semanticGuidance = normalizeSemanticMattingGuidance(params.semanticGuidance);
    if (!semanticGuidance.valid) {
        return {
            valid: false,
            code: 'matting_semantic_guidance_invalid',
            error: `${semanticGuidance.error} ${semanticGuidance.issues.join(' ')}`.trim()
        };
    }
    if (semanticGuidance.guidance && !targetPrompt) {
        return {
            valid: false,
            code: 'matting_guidance_requires_semantic_target',
            error: '正负点引导必须绑定调用方明确选择的语义目标。'
        };
    }

    return {
        valid: true,
        request: {
            expectedDocumentId: documentId,
            expectedHistoryStateId: historyStateId,
            layerId,
            targetPrompt,
            outputFormat,
            quality,
            sampleAllLayers: params.sampleAllLayers === true,
            enableHairRefine: params.enableHairRefine !== false,
            enableFabricRefine: params.enableFabricRefine !== false,
            ...(semanticGuidance.guidance
                ? { semanticGuidance: semanticGuidance.guidance }
                : {})
        }
    };
}
