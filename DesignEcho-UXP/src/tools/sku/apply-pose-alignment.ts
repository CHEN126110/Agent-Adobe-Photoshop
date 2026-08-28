import { action, app, constants } from 'photoshop';

import {
    arrayBufferFromBytes,
    assertImageBytesSafeForPhotoshop,
    bytesFromBase64ImagePayload
} from '../../core/image-safety';
import { assertImageSourceIdentity } from '../../core/image-source-identity';
import {
    buildPhotoshopTransactionMutationOutcome,
    photoshopTransactionRunner,
    type PhotoshopTransactionPreparation
} from '../../core/photoshop-transaction-runner';
import { createToolFailureResult } from '../../core/tool-error-normalizer';
import { getPhotoshopElementPlacement } from '../layout/photoshop-runtime-adapters';
import type { Tool, ToolExecutionContext, ToolResult } from '../types';
import {
    SKU_POSE_ALIGNMENT_APPLY_VERSION,
    SKU_POSE_ALIGNMENT_PROVIDER_RECEIPT_VERSION,
    SKU_POSE_ALIGNMENT_QUALITY_PROFILE,
    SKU_POSE_ALIGNMENT_REPORT_VERSION,
    type ApplySkuPoseAlignmentParams,
    type SkuPoseAlignmentBounds,
    type SkuPoseAlignmentProviderReceipt
} from './pose-alignment-contract';
import {
    normalizeApplySkuPoseAlignmentParams,
    poseAlignmentBoundsMatch,
    readPoseAlignmentPngSize,
    verifyPoseAlignmentAppliedState,
    verifyPoseAlignmentRolledBackState,
    type PoseAlignmentLayerState
} from './pose-alignment-validation';

const uxp = require('uxp');
const fs = uxp.storage.localFileSystem;

interface PoseAlignmentBefore {
    documentId: number;
    layerIds: number[];
    source: PoseAlignmentLayerState;
}

interface PoseAlignmentMutationReceipt {
    outputLayerId: number;
}

interface PoseAlignmentReadback {
    documentId: number;
    layerIds: number[];
    source?: PoseAlignmentLayerState;
    output?: PoseAlignmentLayerState;
}

interface ApplySkuPoseAlignmentData {
    sourceLayerId: number;
    outputLayerId: number;
    providerReceipt?: SkuPoseAlignmentProviderReceipt;
}

interface ApplySkuPoseAlignmentResult extends Record<string, unknown> {
    success: boolean;
    code?: string;
    error?: string;
    data: ApplySkuPoseAlignmentData | null;
}

function readLayerBounds(layer: any): SkuPoseAlignmentBounds {
    const bounds = layer?.boundsNoEffects || layer?.bounds;
    const left = Number(bounds?.left);
    const top = Number(bounds?.top);
    const right = Number(bounds?.right);
    const bottom = Number(bounds?.bottom);
    if (![left, top, right, bottom].every(Number.isFinite)
        || right <= left || bottom <= top) {
        throw new Error(`无法读取图层 ${String(layer?.id || '')} 的有效 bounds。`);
    }
    return {
        left,
        top,
        right,
        bottom,
        width: right - left,
        height: bottom - top
    };
}

function findLayerLocation(container: any, layerId: number): {
    layer: any;
    parent: any;
} | null {
    for (const layer of Array.from(container?.layers || []) as any[]) {
        if (Number(layer?.id) === layerId) return { layer, parent: container };
        if (layer?.layers) {
            const nested = findLayerLocation(layer, layerId);
            if (nested) return nested;
        }
    }
    return null;
}

function collectLayerIds(container: any): number[] {
    const ids: number[] = [];
    for (const layer of Array.from(container?.layers || []) as any[]) {
        const layerId = Number(layer?.id);
        if (Number.isSafeInteger(layerId) && layerId > 0) ids.push(layerId);
        if (layer?.layers) ids.push(...collectLayerIds(layer));
    }
    return ids;
}

function readLayerState(document: any, layerId: number): PoseAlignmentLayerState | undefined {
    const location = findLayerLocation(document, layerId);
    if (!location) return undefined;
    const parentId = location.parent === document ? null : Number(location.parent?.id);
    return {
        layerId,
        parentId: typeof parentId === 'number'
            && Number.isSafeInteger(parentId)
            && parentId > 0
            ? parentId
            : null,
        layerName: String(location.layer?.name || ''),
        visible: location.layer?.visible !== false,
        bounds: readLayerBounds(location.layer)
    };
}

async function selectLayer(layerId: number): Promise<void> {
    await action.batchPlay([{
        _obj: 'select',
        _target: [{ _ref: 'layer', _id: layerId }],
        makeVisible: false,
        _options: { dialogOptions: 'dontDisplay' }
    }], { synchronousExecution: true });
}

async function transformActiveLayer(widthPercent: number, heightPercent: number): Promise<void> {
    await action.batchPlay([{
        _obj: 'transform',
        freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' },
        width: { _unit: 'percentUnit', _value: widthPercent },
        height: { _unit: 'percentUnit', _value: heightPercent },
        _options: { dialogOptions: 'dontDisplay' }
    }], { synchronousExecution: true });
}

async function fitLayerExactly(layer: any, target: SkuPoseAlignmentBounds): Promise<void> {
    const before = readLayerBounds(layer);
    const widthPercent = target.width / before.width * 100;
    const heightPercent = target.height / before.height * 100;
    if (Math.abs(widthPercent - 100) > 0.05 || Math.abs(heightPercent - 100) > 0.05) {
        await transformActiveLayer(widthPercent, heightPercent);
    }
    const scaled = readLayerBounds(layer);
    if (typeof layer?.translate !== 'function') {
        throw new Error('姿态统一结果层不支持 DOM translate，已拒绝调用可能弹窗的原生 move。');
    }
    await Promise.resolve(layer.translate(target.left - scaled.left, target.top - scaled.top));
}

function buildFailure(params: unknown, error: unknown): ApplySkuPoseAlignmentResult {
    const failure = createToolFailureResult({
        toolName: 'applySkuPoseAlignment',
        error,
        params
    });
    return {
        ...failure,
        success: false,
        data: null
    };
}

export async function applySkuPoseAlignment(
    rawParams: ApplySkuPoseAlignmentParams,
    context?: ToolExecutionContext
): Promise<ApplySkuPoseAlignmentResult> {
    let params: ApplySkuPoseAlignmentParams;
    let tempFile: any;
    try {
        params = normalizeApplySkuPoseAlignmentParams(rawParams);
        const decoded = bytesFromBase64ImagePayload(params.imageBase64);
        const safety = assertImageBytesSafeForPhotoshop(decoded.bytes, {
            formatHint: decoded.mimeType,
            sourceLabel: `姿态统一结果「${params.resultLayerName}」`
        });
        if (safety.format !== 'png') throw new Error('姿态统一结果必须是安全 PNG。');
        assertImageSourceIdentity({
            bytes: decoded.bytes,
            expectedByteLength: params.imageByteLength,
            expectedChecksum: params.imageChecksum
        });
        const pngSize = readPoseAlignmentPngSize(decoded.bytes);
        if (pngSize.width !== params.outputImageSize.width
            || pngSize.height !== params.outputImageSize.height) {
            throw new Error(
                `姿态统一 PNG ${pngSize.width}×${pngSize.height} 与已验证工作画布 `
                + `${params.outputImageSize.width}×${params.outputImageSize.height} 不一致。`
            );
        }

        const tempFolder = await fs.getTemporaryFolder();
        tempFile = await tempFolder.createFile(
            `designecho_pose_${params.layerId}_${Date.now()}.png`,
            { overwrite: true }
        );
        await tempFile.write(arrayBufferFromBytes(decoded.bytes), {
            format: uxp.storage.formats.binary
        });
        const fileToken = await fs.createSessionToken(tempFile);
        const diagnosticParams = {
            version: params.version,
            layerId: params.layerId,
            resultLayerName: params.resultLayerName,
            sourceBounds: params.sourceBounds,
            outputBounds: params.outputBounds,
            sourceImageSize: params.sourceImageSize,
            outputImageSize: params.outputImageSize,
            workingPadding: params.workingPadding,
            imageByteLength: params.imageByteLength,
            imageChecksum: params.imageChecksum,
            qualityReportVersion: params.qualityReportVersion,
            qualityProfile: params.qualityProfile,
            qualityFingerprint: params.qualityFingerprint
        };

        return await photoshopTransactionRunner.run<
            PoseAlignmentBefore,
            PoseAlignmentReadback,
            ApplySkuPoseAlignmentResult,
            PoseAlignmentMutationReceipt
        >({
            operationId: `applySkuPoseAlignment:${String(context?.requestId || Date.now())}`,
            toolName: 'applySkuPoseAlignment',
            commandName: 'DesignEcho: SKU 姿态统一',
            params: diagnosticParams,
            context,
            historyMode: 'suspend',
            expectedEffect: 'mutation_required',
            requiredBinding: 'document_revision',
            rollbackTargetPolicy: 'document_revision_and_active_layer',
            prepare(scope): PhotoshopTransactionPreparation<PoseAlignmentBefore, ApplySkuPoseAlignmentResult> {
                const source = readLayerState(scope.document, params.layerId);
                if (!source) throw new Error(`未找到姿态统一源图层 ID: ${params.layerId}`);
                if (!poseAlignmentBoundsMatch(source.bounds, params.sourceBounds)) {
                    throw new Error('姿态统一源图层 bounds 与只读快照不一致，已在写入前停止。');
                }
                return {
                    kind: 'ready',
                    before: {
                        documentId: Number(scope.document.id),
                        layerIds: collectLayerIds(scope.document),
                        source
                    }
                };
            },
            async mutate(scope, before) {
                await selectLayer(params.layerId);
                await action.batchPlay([{
                    _obj: 'placeEvent',
                    null: { _path: fileToken, _kind: 'local' },
                    freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' },
                    offset: {
                        _obj: 'offset',
                        horizontal: { _unit: 'pixelsUnit', _value: 0 },
                        vertical: { _unit: 'pixelsUnit', _value: 0 }
                    },
                    _options: { dialogOptions: 'dontDisplay' }
                }], { synchronousExecution: true });
                const outputLayer = scope.document.activeLayers?.[0];
                const outputLayerId = Number(outputLayer?.id);
                if (!outputLayer || !Number.isSafeInteger(outputLayerId) || outputLayerId <= 0
                    || before.layerIds.includes(outputLayerId)) {
                    throw new Error('姿态统一置入后没有得到唯一的新输出图层。');
                }
                outputLayer.name = params.resultLayerName;
                await fitLayerExactly(outputLayer, params.outputBounds);

                const sourceLocation = findLayerLocation(scope.document, params.layerId);
                if (!sourceLocation) throw new Error('姿态统一写入期间源图层消失。');
                if (typeof outputLayer.move !== 'function') {
                    throw new Error('姿态统一结果无法移动到源图层同级位置。');
                }
                await Promise.resolve(outputLayer.move(
                    sourceLocation.layer,
                    getPhotoshopElementPlacement(constants, 'PLACEBEFORE', 'applySkuPoseAlignment')
                ));
                outputLayer.visible = true;
                sourceLocation.layer.visible = false;
                await selectLayer(outputLayerId);

                return buildPhotoshopTransactionMutationOutcome(
                    {
                        success: true,
                        data: {
                            sourceLayerId: params.layerId,
                            outputLayerId
                        }
                    },
                    { outputLayerId }
                );
            },
            readState({ scope, receipt }): PoseAlignmentReadback {
                const outputLayerId = Number(receipt?.outputLayerId);
                return {
                    documentId: Number(scope.document.id),
                    layerIds: collectLayerIds(scope.document),
                    source: readLayerState(scope.document, params.layerId),
                    output: Number.isSafeInteger(outputLayerId) && outputLayerId > 0
                        ? readLayerState(scope.document, outputLayerId)
                        : undefined
                };
            },
            verifyApplied({ before, after, receipt }) {
                return verifyPoseAlignmentAppliedState({
                    beforeDocumentId: before.documentId,
                    afterDocumentId: after.documentId,
                    beforeLayerIds: before.layerIds,
                    afterLayerIds: after.layerIds,
                    sourceBefore: before.source,
                    sourceAfter: after.source,
                    outputAfter: after.output,
                    outputLayerId: receipt?.outputLayerId,
                    resultLayerName: params.resultLayerName,
                    outputBounds: params.outputBounds
                });
            },
            verifyRolledBack({ before, after }) {
                return verifyPoseAlignmentRolledBackState({
                    beforeDocumentId: before.documentId,
                    afterDocumentId: after.documentId,
                    beforeLayerIds: before.layerIds,
                    afterLayerIds: after.layerIds,
                    sourceBefore: before.source,
                    sourceAfter: after.source,
                    outputAfter: after.output
                });
            },
            buildVerifiedResult({ after, receipt }): ApplySkuPoseAlignmentResult {
                const source = after.source as PoseAlignmentLayerState;
                const output = after.output as PoseAlignmentLayerState;
                const providerReceipt: SkuPoseAlignmentProviderReceipt = {
                    version: SKU_POSE_ALIGNMENT_PROVIDER_RECEIPT_VERSION,
                    documentId: after.documentId,
                    sourceLayerId: source.layerId,
                    outputLayerId: output.layerId,
                    sourcePreserved: true,
                    sourceVisibleAfter: false,
                    outputVisible: true,
                    sourceBounds: params.sourceBounds,
                    outputBounds: output.bounds,
                    geometryVerified: true,
                    sourceImageIdentityVerified: true,
                    qualityReportVersion: SKU_POSE_ALIGNMENT_REPORT_VERSION,
                    qualityProfile: SKU_POSE_ALIGNMENT_QUALITY_PROFILE,
                    qualityFingerprint: params.qualityFingerprint
                };
                return {
                    success: true,
                    data: {
                        sourceLayerId: source.layerId,
                        outputLayerId: receipt?.outputLayerId as number,
                        providerReceipt
                    }
                };
            }
        });
    } catch (error) {
        return buildFailure({
            version: rawParams?.version,
            layerId: rawParams?.layerId,
            resultLayerName: rawParams?.resultLayerName,
            imageByteLength: rawParams?.imageByteLength,
            imageChecksum: rawParams?.imageChecksum,
            qualityFingerprint: rawParams?.qualityFingerprint
        }, error);
    } finally {
        if (tempFile) {
            try {
                await tempFile.delete();
            } catch (error) {
                console.warn('[applySkuPoseAlignment] 临时 PNG 清理失败:', error);
            }
        }
    }
}

export class ApplySkuPoseAlignmentTool implements Tool {
    name = 'applySkuPoseAlignment';

    schema = {
        name: this.name,
        description: 'SKU Skill 内部姿态统一 Provider：只接受已通过离线质量契约的同尺寸 PNG，并在唯一 Photoshop 事务内非破坏写入与读回。',
        parameters: {
            type: 'object' as const,
            properties: {
                version: { type: 'string', description: '固定 sku-pose-alignment-apply/v1' },
                layerId: { type: 'number', description: '源图层 ID' },
                resultLayerName: { type: 'string', description: '调用方明确给出的输出图层名' },
                sourceBounds: { type: 'object', description: '与只读快照绑定的源图层文档坐标' },
                outputBounds: { type: 'object', description: '按像素留白机械推导的输出图层文档坐标' },
                sourceImageSize: { type: 'object', description: '离线 PNG 的原始像素尺寸' },
                outputImageSize: { type: 'object', description: '含透明安全留白的输出 PNG 像素尺寸' },
                workingPadding: { type: 'object', description: '源像素进入安全工作画布时的四边留白' },
                imageBase64: { type: 'string', description: '离线质量检查通过的同尺寸 PNG' },
                imageByteLength: { type: 'number', description: 'PNG 字节长度' },
                imageChecksum: { type: 'string', description: 'PNG fnv1a32 校验和' },
                qualityReportVersion: { type: 'string', description: '离线质量报告版本' },
                qualityProfile: { type: 'string', description: '离线质量画像版本' },
                qualityFingerprint: { type: 'string', description: '离线质量报告指纹' }
            },
            required: [
                'version',
                'layerId',
                'resultLayerName',
                'sourceBounds',
                'outputBounds',
                'sourceImageSize',
                'outputImageSize',
                'workingPadding',
                'imageBase64',
                'imageByteLength',
                'imageChecksum',
                'qualityReportVersion',
                'qualityProfile',
                'qualityFingerprint'
            ]
        }
    };

    async execute(
        params: ApplySkuPoseAlignmentParams,
        context?: ToolExecutionContext
    ): Promise<ToolResult<ApplySkuPoseAlignmentData>> {
        return await applySkuPoseAlignment(params, context);
    }
}
