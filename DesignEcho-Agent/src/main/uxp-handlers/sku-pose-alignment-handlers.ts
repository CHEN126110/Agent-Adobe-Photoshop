import { DESIGN_ECHO_TARGET_GUARD_ARGUMENT } from '../../shared/agent-tool-execution-preflight';
import {
    BinaryMessageType,
    createBinaryImageData
} from '../../shared/binary-protocol';
import { LAYER_PIXEL_CAPTURE_VERSION } from '../../shared/layer-pixel-capture-contract';
import {
    executeSkuPoseAlignmentProvider,
    type SkuPoseAlignmentApplyBinding,
    type SkuPoseAlignmentExportRequest
} from '../services/sku-pose-alignment-provider';
import type { SkuPoseAlignmentApplyRequest } from '../../shared/sku-pose-alignment-provider-contract';
import type { UXPContext } from './types';

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function buildTargetGuard(input: {
    expectedDocumentId: number;
    expectedHistoryStateId: number;
}): Record<string, unknown> {
    return {
        expectedDocumentId: input.expectedDocumentId,
        expectedHistoryStateRef: {
            documentId: input.expectedDocumentId,
            historyStateId: input.expectedHistoryStateId
        },
        observationTool: 'getDocumentInfo'
    };
}

export function registerSkuPoseAlignmentHandlers(context: UXPContext): void {
    const { wsServer, mattingService } = context;
    if (!wsServer) {
        console.log('[SKU Pose Provider] WebSocket 未连接，跳过注册');
        return;
    }

    wsServer.registerHandler('sku-pose-align-v1', async (rawRequest: unknown) => {
        let writeStarted = false;
        try {
            if (!mattingService) {
                console.warn('[SKU Pose Provider] 本地分割 Provider 未初始化；透明图层仍可直接使用 alpha。');
            }
            return await executeSkuPoseAlignmentProvider(rawRequest, {
                async captureLayer(request: SkuPoseAlignmentExportRequest): Promise<unknown> {
                    const captured = asRecord(await wsServer.sendRequest('captureLayerPixels', {
                        layerId: request.layerId,
                        maxSize: 8192,
                        [DESIGN_ECHO_TARGET_GUARD_ARGUMENT]: buildTargetGuard(request)
                    }, 120_000));
                    if (captured.success !== true) return captured;
                    const data = asRecord(captured.data);
                    const binaryRequestId = Number(data.binaryRequestId);
                    if (data.version !== LAYER_PIXEL_CAPTURE_VERSION
                        || !Number.isSafeInteger(binaryRequestId)
                        || binaryRequestId <= 0) {
                        throw new Error('图层像素捕获没有返回有效的版本化二进制收据。');
                    }
                    const binary = await wsServer.waitForBinaryData(binaryRequestId, 20_000);
                    if (binary.header.type !== BinaryMessageType.RAW_RGBA
                        || binary.header.requestId !== binaryRequestId
                        || binary.header.width !== Number(data.width)
                        || binary.header.height !== Number(data.height)
                        || binary.imageData.length !== Number(data.byteLength)) {
                        throw new Error('图层像素捕获的二进制帧与 JSON 收据不一致。');
                    }
                    return {
                        success: true,
                        data: {
                            ...data,
                            rgbaBuffer: binary.imageData
                        }
                    };
                },
                async createForegroundMask(input) {
                    if (!mattingService) {
                        return {
                            success: false,
                            error: '本地分割 Provider 未初始化，无法从不透明图层建立主体蒙版。'
                        };
                    }
                    return await mattingService.removeBackground(createBinaryImageData(
                        BinaryMessageType.RAW_RGBA,
                        input.rgbaBuffer,
                        input.width,
                        input.height
                    ), {
                        quality: 'quality',
                        returnMask: true,
                        binaryMaskOutput: false,
                        originalWidth: input.width,
                        originalHeight: input.height,
                        edgeRefine: 'quality'
                    });
                },
                async applyResult(
                    request: SkuPoseAlignmentApplyRequest,
                    binding: SkuPoseAlignmentApplyBinding
                ): Promise<unknown> {
                    writeStarted = true;
                    return await wsServer.sendRequest('applySkuPoseAlignment', {
                        ...request,
                        [DESIGN_ECHO_TARGET_GUARD_ARGUMENT]: buildTargetGuard(binding)
                    }, 180_000);
                }
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                success: false,
                status: 'failed',
                code: writeStarted
                    ? 'sku_pose_alignment_outcome_unknown'
                    : 'sku_pose_alignment_not_started',
                error: message,
                noMutation: !writeStarted,
                mutationState: writeStarted ? 'unknown' : 'not_started'
            };
        }
    });

    console.log('[SKU Pose Provider] v1 handler 已注册');
}
