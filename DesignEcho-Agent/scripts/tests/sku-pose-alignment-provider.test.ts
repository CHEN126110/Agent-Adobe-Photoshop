import * as assert from 'assert';

import sharp from 'sharp';

import {
    executeSkuPoseAlignmentProvider,
    type SkuPoseAlignmentApplyBinding,
    type SkuPoseAlignmentProviderDependencies
} from '../../src/main/services/sku-pose-alignment-provider';
import { dispatchSkuPoseAlignmentWorkflow } from '../../src/main/services/sku-pose-alignment-workflow-dispatch';
import { MCPHostService } from '../../src/main/services/mcp-host-service';
import { registerSkuPoseAlignmentHandlers } from '../../src/main/uxp-handlers/sku-pose-alignment-handlers';
import { BinaryMessageType } from '../../src/shared/binary-protocol';
import { LAYER_PIXEL_CAPTURE_VERSION } from '../../src/shared/layer-pixel-capture-contract';
import {
    SKU_POSE_ALIGNMENT_APPLY_VERSION,
    SKU_POSE_ALIGNMENT_PROVIDER_RECEIPT_VERSION,
    SKU_POSE_ALIGNMENT_WORKFLOW_VERSION,
    type SkuPoseAlignmentApplyRequest,
    type SkuPoseAlignmentBounds
} from '../../src/shared/sku-pose-alignment-provider-contract';
import {
    createPoseFixture,
    type PoseFixture
} from './sku-pose-alignment.test';

interface ProviderHarness {
    dependencies: SkuPoseAlignmentProviderDependencies;
    captureCalls: unknown[];
    mattingCalls: unknown[];
    applyCalls: Array<{
        request: SkuPoseAlignmentApplyRequest;
        binding: SkuPoseAlignmentApplyBinding;
    }>;
}

const DOCUMENT_ID = 42;
const HISTORY_STATE_ID = 701;
const LAYER_ID = 9;
const OUTPUT_LAYER_ID = 901;

function createBounds(width: number, height: number): SkuPoseAlignmentBounds {
    return {
        left: 37,
        top: 61,
        right: 37 + width,
        bottom: 61 + height,
        width,
        height
    };
}

function createWorkflowRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        version: SKU_POSE_ALIGNMENT_WORKFLOW_VERSION,
        expectedDocumentId: DOCUMENT_ID,
        expectedHistoryStateId: HISTORY_STATE_ID,
        layerId: LAYER_ID,
        resultLayerName: '姿态统一｜浅咖',
        options: {
            strength: 0.9,
            cuffLockRatio: 0.15,
            maxIterations: 3
        },
        requestKey: 'pose-provider-contract',
        ...overrides
    };
}

function encodeFixtureRgba(
    fixture: PoseFixture,
    alpha: Buffer = fixture.mask
): Buffer {
    const pixels = fixture.raster.width * fixture.raster.height;
    const rgba = Buffer.allocUnsafe(pixels * 4);
    for (let index = 0; index < pixels; index += 1) {
        rgba[index * 4] = fixture.raster.data[index * 3];
        rgba[index * 4 + 1] = fixture.raster.data[index * 3 + 1];
        rgba[index * 4 + 2] = fixture.raster.data[index * 3 + 2];
        rgba[index * 4 + 3] = alpha[index];
    }
    return rgba;
}

function fnv1a32(value: Uint8Array): string {
    let hash = 0x811c9dc5;
    for (const byte of value) {
        hash ^= byte;
        hash = Math.imul(hash, 0x01000193);
    }
    return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function buildVerifiedApplyResult(
    request: SkuPoseAlignmentApplyRequest,
    binding: SkuPoseAlignmentApplyBinding,
    overrides: Record<string, unknown> = {}
): Record<string, unknown> {
    return {
        success: true,
        data: {
            sourceLayerId: request.layerId,
            outputLayerId: OUTPUT_LAYER_ID,
            providerReceipt: {
                version: SKU_POSE_ALIGNMENT_PROVIDER_RECEIPT_VERSION,
                documentId: binding.expectedDocumentId,
                sourceLayerId: request.layerId,
                outputLayerId: OUTPUT_LAYER_ID,
                sourcePreserved: true,
                sourceVisibleAfter: false,
                outputVisible: true,
                sourceBounds: request.sourceBounds,
                outputBounds: request.outputBounds,
                geometryVerified: true,
                sourceImageIdentityVerified: true,
                qualityReportVersion: request.qualityReportVersion,
                qualityProfile: request.qualityProfile,
                qualityFingerprint: request.qualityFingerprint
            }
        },
        photoshopOperationResult: {
            version: 'photoshop-operation-result/v1',
            operationId: 'pose-provider-test',
            toolName: 'applySkuPoseAlignment',
            status: 'verified',
            applicationStatus: 'applied',
            transactionState: 'committed',
            effect: 'applied',
            rollback: { attempted: false, verified: false },
            before: {
                documentId: binding.expectedDocumentId,
                historyStateId: binding.expectedHistoryStateId
            },
            after: {
                documentId: binding.expectedDocumentId,
                historyStateId: binding.expectedHistoryStateId + 1
            }
        },
        ...overrides
    };
}

function createHarness(input: {
    fixture: PoseFixture;
    rgba: Buffer;
    bounds?: SkuPoseAlignmentBounds;
    mattingMask?: Buffer;
    applyResult?: (
        request: SkuPoseAlignmentApplyRequest,
        binding: SkuPoseAlignmentApplyBinding
    ) => unknown;
}): ProviderHarness {
    const captureCalls: unknown[] = [];
    const mattingCalls: unknown[] = [];
    const applyCalls: ProviderHarness['applyCalls'] = [];
    const width = input.fixture.raster.width;
    const height = input.fixture.raster.height;
    return {
        captureCalls,
        mattingCalls,
        applyCalls,
        dependencies: {
            async captureLayer(request) {
                captureCalls.push(request);
                return {
                    success: true,
                    data: {
                        version: LAYER_PIXEL_CAPTURE_VERSION,
                        binaryRequestId: 77,
                        mimeType: 'image/x-raw-rgba',
                        width,
                        height,
                        components: 4,
                        componentSize: 8,
                        byteLength: input.rgba.length,
                        checksum: fnv1a32(input.rgba),
                        contentBounds: input.bounds || createBounds(width, height),
                        targetIdentity: {
                            documentId: request.expectedDocumentId,
                            historyStateId: request.expectedHistoryStateId,
                            layerId: request.layerId
                        },
                        noMutation: true,
                        rgbaBuffer: input.rgba
                    }
                };
            },
            async createForegroundMask(request) {
                mattingCalls.push(request);
                const mask = input.mattingMask || input.fixture.mask;
                return {
                    success: true,
                    maskBuffer: mask,
                    maskWidth: width,
                    maskHeight: height
                };
            },
            async applyResult(request, binding) {
                applyCalls.push({ request, binding });
                return input.applyResult
                    ? input.applyResult(request, binding)
                    : buildVerifiedApplyResult(request, binding);
            }
        }
    };
}

function createModerateCurveFixture(): PoseFixture {
    return createPoseFixture({
        centerAt(progress) {
            const t = progress * 2 - 1;
            return 120 + 16 * t + 14 * t * t;
        }
    });
}

function cropFixtureToForeground(fixture: PoseFixture): PoseFixture {
    let left = fixture.raster.width;
    let top = fixture.raster.height;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < fixture.raster.height; y += 1) {
        for (let x = 0; x < fixture.raster.width; x += 1) {
            if (fixture.mask[y * fixture.raster.width + x] < 104) continue;
            left = Math.min(left, x);
            top = Math.min(top, y);
            right = Math.max(right, x);
            bottom = Math.max(bottom, y);
        }
    }
    assert.ok(right >= left && bottom >= top);
    const width = right - left + 1;
    const height = bottom - top + 1;
    const rgb = Buffer.alloc(width * height * 3);
    const mask = Buffer.alloc(width * height);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const sourceIndex = (y + top) * fixture.raster.width + x + left;
            const targetIndex = y * width + x;
            rgb[targetIndex * 3] = fixture.raster.data[sourceIndex * 3];
            rgb[targetIndex * 3 + 1] = fixture.raster.data[sourceIndex * 3 + 1];
            rgb[targetIndex * 3 + 2] = fixture.raster.data[sourceIndex * 3 + 2];
            mask[targetIndex] = fixture.mask[sourceIndex];
        }
    }
    return {
        raster: { data: rgb, width, height, channels: 3 },
        mask
    };
}

async function testAppliedPathUsesOneVerifiedWrite(): Promise<void> {
    const fixture = createModerateCurveFixture();
    const harness = createHarness({ fixture, rgba: encodeFixtureRgba(fixture) });
    const result = await executeSkuPoseAlignmentProvider(
        createWorkflowRequest(),
        harness.dependencies
    );
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.status, 'applied');
    assert.strictEqual(result.noMutation, false);
    assert.strictEqual(harness.captureCalls.length, 1);
    assert.strictEqual(harness.mattingCalls.length, 0, '透明 RGBA 应直接使用真实 alpha');
    assert.strictEqual(harness.applyCalls.length, 1, '整个 Provider 只能发起一次 Photoshop 写调用');
    const [{ request, binding }] = harness.applyCalls;
    assert.strictEqual(request.version, SKU_POSE_ALIGNMENT_APPLY_VERSION);
    assert.strictEqual(request.layerId, LAYER_ID);
    assert.deepStrictEqual(request.sourceImageSize, { width: 240, height: 360 });
    assert.ok(request.outputImageSize.width > request.sourceImageSize.width);
    assert.ok(request.outputImageSize.height > request.sourceImageSize.height);
    assert.ok(request.outputBounds.width > request.sourceBounds.width);
    assert.ok(request.outputBounds.height > request.sourceBounds.height);
    assert.deepStrictEqual(binding, {
        expectedDocumentId: DOCUMENT_ID,
        expectedHistoryStateId: HISTORY_STATE_ID,
        requestKey: 'pose-provider-contract'
    });
    assert.match(request.imageChecksum, /^fnv1a32:[a-f0-9]{8}$/);
    assert.match(request.qualityFingerprint, /^fnv1a32:[a-f0-9]{8}$/);
    const outputMetadata = await sharp(Buffer.from(request.imageBase64, 'base64')).metadata();
    assert.strictEqual(outputMetadata.width, request.outputImageSize.width);
    assert.strictEqual(outputMetadata.height, request.outputImageSize.height);
}

async function testTightPhotoshopBoundsGainMechanicalSafetyCanvas(): Promise<void> {
    const fixture = cropFixtureToForeground(createModerateCurveFixture());
    const harness = createHarness({ fixture, rgba: encodeFixtureRgba(fixture) });
    const result = await executeSkuPoseAlignmentProvider(
        createWorkflowRequest(),
        harness.dependencies
    );
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.status, 'applied');
    assert.strictEqual(harness.applyCalls.length, 1);
    const request = harness.applyCalls[0].request;
    assert.ok(request.workingPadding.left >= 24);
    assert.ok(request.workingPadding.right >= 24);
    assert.ok(request.workingPadding.top >= 24);
    assert.ok(request.workingPadding.bottom >= 24);
    assert.strictEqual(
        request.outputImageSize.width,
        request.sourceImageSize.width
            + request.workingPadding.left
            + request.workingPadding.right
    );
}

async function testStraightPoseDoesNotWrite(): Promise<void> {
    const fixture = createPoseFixture({ centerAt: () => 120 });
    const harness = createHarness({ fixture, rgba: encodeFixtureRgba(fixture) });
    const result = await executeSkuPoseAlignmentProvider(
        createWorkflowRequest(),
        harness.dependencies
    );
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.status, 'not_needed');
    assert.strictEqual(result.noMutation, true);
    assert.strictEqual(harness.applyCalls.length, 0);
}

async function testOpaqueSnapshotUsesExplicitMatting(): Promise<void> {
    const fixture = createModerateCurveFixture();
    const opaqueAlpha = Buffer.alloc(fixture.raster.width * fixture.raster.height, 255);
    const harness = createHarness({
        fixture,
        rgba: encodeFixtureRgba(fixture, opaqueAlpha),
        mattingMask: fixture.mask
    });
    const result = await executeSkuPoseAlignmentProvider(
        createWorkflowRequest(),
        harness.dependencies
    );
    assert.strictEqual(result.status, 'applied');
    assert.strictEqual(harness.mattingCalls.length, 1);
    assert.strictEqual(harness.applyCalls.length, 1);
}

async function testRejectedGeometryDoesNotLeakCandidate(): Promise<void> {
    const fixture = createPoseFixture({
        centerAt(progress) {
            return 120 + 34 * Math.sin(progress * Math.PI * 2);
        }
    });
    const harness = createHarness({ fixture, rgba: encodeFixtureRgba(fixture) });
    const result = await executeSkuPoseAlignmentProvider(
        createWorkflowRequest(),
        harness.dependencies
    );
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.status, 'rejected');
    assert.strictEqual(result.noMutation, true);
    assert.strictEqual(harness.applyCalls.length, 0);
}

async function testSnapshotMismatchStopsBeforeInferenceAndWrite(): Promise<void> {
    const fixture = createModerateCurveFixture();
    const harness = createHarness({
        fixture,
        rgba: encodeFixtureRgba(fixture),
        bounds: createBounds(320, 360)
    });
    await assert.rejects(
        () => executeSkuPoseAlignmentProvider(createWorkflowRequest(), harness.dependencies),
        /快照尺寸.*bounds.*不一致/
    );
    assert.strictEqual(harness.mattingCalls.length, 0);
    assert.strictEqual(harness.applyCalls.length, 0);
}

async function testInvalidRequestStopsBeforePhotoshopRead(): Promise<void> {
    const fixture = createModerateCurveFixture();
    const harness = createHarness({ fixture, rgba: encodeFixtureRgba(fixture) });
    await assert.rejects(
        () => executeSkuPoseAlignmentProvider(
            createWorkflowRequest({ version: 'sku-pose-alignment-workflow/v0' }),
            harness.dependencies
        ),
        /只接受 sku-pose-alignment-workflow\/v1/
    );
    assert.strictEqual(harness.captureCalls.length, 0);
    assert.strictEqual(harness.applyCalls.length, 0);
}

async function testSuccessWithoutProviderReceiptIsNotCompletion(): Promise<void> {
    const fixture = createModerateCurveFixture();
    const harness = createHarness({
        fixture,
        rgba: encodeFixtureRgba(fixture),
        applyResult(request, binding) {
            return buildVerifiedApplyResult(request, binding, {
                data: {
                    sourceLayerId: request.layerId,
                    outputLayerId: OUTPUT_LAYER_ID
                }
            });
        }
    });
    const result = await executeSkuPoseAlignmentProvider(
        createWorkflowRequest(),
        harness.dependencies
    );
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.status, 'failed');
    assert.strictEqual(result.noMutation, false, '事务已经证明应用时不能谎报零写入');
    assert.strictEqual(result.code, 'sku_pose_alignment_receipt_unverified');
}

async function testFailedWriteKeepsTriStateMutationFact(): Promise<void> {
    const fixture = createModerateCurveFixture();
    const notAppliedHarness = createHarness({
        fixture,
        rgba: encodeFixtureRgba(fixture),
        applyResult() {
            return {
                success: false,
                code: 'injected_not_applied',
                error: 'injected not applied',
                photoshopOperationResult: {
                    version: 'photoshop-operation-result/v1',
                    operationId: 'pose-not-applied',
                    toolName: 'applySkuPoseAlignment',
                    status: 'failed',
                    applicationStatus: 'not_applied',
                    transactionState: 'not_started',
                    effect: 'none',
                    rollback: { attempted: false, verified: false }
                }
            };
        }
    });
    const notApplied = await executeSkuPoseAlignmentProvider(
        createWorkflowRequest(),
        notAppliedHarness.dependencies
    );
    assert.strictEqual(notApplied.success, false);
    assert.strictEqual(notApplied.noMutation, true);

    const unknownHarness = createHarness({
        fixture,
        rgba: encodeFixtureRgba(fixture),
        applyResult() {
            return {
                success: false,
                code: 'injected_unknown',
                error: 'injected unknown',
                photoshopOperationResult: {
                    version: 'photoshop-operation-result/v1',
                    operationId: 'pose-unknown',
                    toolName: 'applySkuPoseAlignment',
                    status: 'unknown',
                    applicationStatus: 'unknown',
                    transactionState: 'transport_unknown',
                    effect: 'unknown',
                    rollback: { attempted: false, verified: false }
                }
            };
        }
    });
    const unknown = await executeSkuPoseAlignmentProvider(
        createWorkflowRequest(),
        unknownHarness.dependencies
    );
    assert.strictEqual(unknown.success, false);
    assert.strictEqual(unknown.noMutation, false);
}

async function testDispatchBindsCurrentDocumentRevision(): Promise<void> {
    const request = createWorkflowRequest();
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const matchingDocument = {
        success: true,
        document: { id: DOCUMENT_ID },
        historyStateRef: {
            documentId: DOCUMENT_ID,
            historyStateId: HISTORY_STATE_ID
        }
    };
    await dispatchSkuPoseAlignmentWorkflow(request, {
        getDocumentInfo: async () => matchingDocument,
        invokeRegisteredHandler: async (method, params) => {
            calls.push({ method, params });
            return { success: true };
        }
    });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].method, 'sku-pose-align-v1');
    assert.strictEqual(calls[0].params.expectedDocumentId, DOCUMENT_ID);
    assert.strictEqual(calls[0].params.expectedHistoryStateId, HISTORY_STATE_ID);

    let staleInvokeCount = 0;
    await assert.rejects(
        () => dispatchSkuPoseAlignmentWorkflow(request, {
            getDocumentInfo: async () => ({
                ...matchingDocument,
                historyStateRef: {
                    documentId: DOCUMENT_ID,
                    historyStateId: HISTORY_STATE_ID + 1
                }
            }),
            invokeRegisteredHandler: async () => {
                staleInvokeCount += 1;
                return { success: true };
            }
        }),
        /历史版本已经变化/
    );
    assert.strictEqual(staleInvokeCount, 0);
}

async function testHandlerBindsBinaryCaptureBeforeSingleWrite(): Promise<void> {
    const fixture = createModerateCurveFixture();
    const rgba = encodeFixtureRgba(fixture);
    const handlers = new Map<string, (request: unknown) => Promise<Record<string, unknown>>>();
    const sendCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const wsServer = {
        registerHandler(name: string, handler: (request: unknown) => Promise<Record<string, unknown>>) {
            handlers.set(name, handler);
        },
        async sendRequest(name: string, args: Record<string, unknown>) {
            sendCalls.push({ name, args });
            if (name === 'captureLayerPixels') {
                return {
                    success: true,
                    data: {
                        version: LAYER_PIXEL_CAPTURE_VERSION,
                        binaryRequestId: 77,
                        mimeType: 'image/x-raw-rgba',
                        width: fixture.raster.width,
                        height: fixture.raster.height,
                        components: 4,
                        componentSize: 8,
                        byteLength: rgba.length,
                        checksum: fnv1a32(rgba),
                        contentBounds: createBounds(fixture.raster.width, fixture.raster.height),
                        targetIdentity: {
                            documentId: DOCUMENT_ID,
                            historyStateId: HISTORY_STATE_ID,
                            layerId: LAYER_ID
                        },
                        noMutation: true
                    }
                };
            }
            if (name === 'applySkuPoseAlignment') {
                const guard = args.__designEchoTargetGuard as {
                    expectedDocumentId: number;
                    expectedHistoryStateRef: { historyStateId: number };
                };
                return buildVerifiedApplyResult(
                    args as unknown as SkuPoseAlignmentApplyRequest,
                    {
                        expectedDocumentId: guard.expectedDocumentId,
                        expectedHistoryStateId: guard.expectedHistoryStateRef.historyStateId
                    }
                );
            }
            throw new Error(`unexpected request: ${name}`);
        },
        async waitForBinaryData(requestId: number) {
            assert.strictEqual(requestId, 77);
            return {
                header: {
                    type: BinaryMessageType.RAW_RGBA,
                    requestId,
                    width: fixture.raster.width,
                    height: fixture.raster.height
                },
                imageData: rgba
            };
        }
    };
    registerSkuPoseAlignmentHandlers({
        wsServer,
        mattingService: null
    } as never);
    const handler = handlers.get('sku-pose-align-v1');
    assert.strictEqual(typeof handler, 'function');
    const result = await handler!(createWorkflowRequest());
    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(sendCalls.map((call) => call.name), [
        'captureLayerPixels',
        'applySkuPoseAlignment'
    ]);
    const captureGuard = sendCalls[0].args.__designEchoTargetGuard as {
        expectedDocumentId: number;
        expectedHistoryStateRef: { historyStateId: number };
    };
    assert.strictEqual(captureGuard.expectedDocumentId, DOCUMENT_ID);
    assert.strictEqual(captureGuard.expectedHistoryStateRef.historyStateId, HISTORY_STATE_ID);

    const mismatchHandlers = new Map<string, (request: unknown) => Promise<Record<string, unknown>>>();
    let mismatchWriteCount = 0;
    registerSkuPoseAlignmentHandlers({
        wsServer: {
            registerHandler(name: string, registered: (request: unknown) => Promise<Record<string, unknown>>) {
                mismatchHandlers.set(name, registered);
            },
            async sendRequest(name: string) {
                if (name === 'applySkuPoseAlignment') mismatchWriteCount += 1;
                return {
                    success: true,
                    data: {
                        version: LAYER_PIXEL_CAPTURE_VERSION,
                        binaryRequestId: 88,
                        mimeType: 'image/x-raw-rgba',
                        width: fixture.raster.width,
                        height: fixture.raster.height,
                        components: 4,
                        componentSize: 8,
                        byteLength: rgba.length,
                        checksum: fnv1a32(rgba),
                        contentBounds: createBounds(fixture.raster.width, fixture.raster.height),
                        targetIdentity: {
                            documentId: DOCUMENT_ID,
                            historyStateId: HISTORY_STATE_ID,
                            layerId: LAYER_ID
                        },
                        noMutation: true
                    }
                };
            },
            async waitForBinaryData() {
                return {
                    header: {
                        type: BinaryMessageType.RAW_RGB,
                        requestId: 88,
                        width: fixture.raster.width,
                        height: fixture.raster.height
                    },
                    imageData: rgba
                };
            }
        },
        mattingService: null
    } as never);
    const mismatchResult = await mismatchHandlers.get('sku-pose-align-v1')!(
        createWorkflowRequest()
    );
    assert.strictEqual(mismatchResult.success, false);
    assert.strictEqual(mismatchResult.noMutation, true);
    assert.strictEqual(mismatchWriteCount, 0);
}

async function testMcpHostPreservesWorkflowStartFact(): Promise<void> {
    const request = createWorkflowRequest();
    const disconnectedHost = new MCPHostService({
        host: '127.0.0.1',
        port: 0,
        wsServer: {
            isPluginConnected: () => false
        },
        debugBridge: {},
        runtimeBuildIdentity: {}
    } as never);
    const notStarted = await disconnectedHost.callTool(
        'photoshop.workflows.sku_pose_alignment',
        request
    );
    assert.strictEqual(notStarted.success, false);
    assert.strictEqual(notStarted.code, 'sku_pose_alignment_not_started');
    assert.strictEqual(notStarted.noMutation, true);
    assert.strictEqual(notStarted.mutationState, 'not_started');
    assert.strictEqual(notStarted.executesPhotoshop, false);
    const httpRequest = {
        jsonrpc: '2.0',
        id: 909,
        method: 'tools/call',
        params: {
            name: 'photoshop.workflows.sku_pose_alignment',
            arguments: { ...request, requestKey: undefined }
        }
    };
    const generatedRequestKey = (disconnectedHost as never as {
        resolveHttpAbortRequestKey(value: unknown): string;
    }).resolveHttpAbortRequestKey(httpRequest);
    assert.match(generatedRequestKey, /^mcp-http:909:/);
    assert.strictEqual((disconnectedHost as never as {
        shouldAwaitFinalResultAfterHttpAbort(value: unknown): boolean;
    }).shouldAwaitFinalResultAfterHttpAbort(httpRequest), true);

    const matchingDocument = {
        success: true,
        document: { id: DOCUMENT_ID },
        historyStateRef: {
            documentId: DOCUMENT_ID,
            historyStateId: HISTORY_STATE_ID
        }
    };
    const uncertainHost = new MCPHostService({
        host: '127.0.0.1',
        port: 0,
        wsServer: {
            isPluginConnected: () => true,
            callMCPTool: async () => matchingDocument,
            invokeRegisteredHandler: async () => {
                throw new Error('injected post-dispatch transport loss');
            }
        },
        debugBridge: {},
        runtimeBuildIdentity: {}
    } as never);
    const unknown = await uncertainHost.callTool(
        'photoshop.workflows.sku_pose_alignment',
        request
    );
    assert.strictEqual(unknown.success, false);
    assert.strictEqual(unknown.code, 'sku_pose_alignment_outcome_unknown');
    assert.strictEqual(unknown.noMutation, false);
    assert.strictEqual(unknown.mutationState, 'unknown');
    assert.strictEqual(unknown.executesPhotoshop, true);
}

export async function runSkuPoseAlignmentProviderTests(): Promise<void> {
    await testAppliedPathUsesOneVerifiedWrite();
    await testTightPhotoshopBoundsGainMechanicalSafetyCanvas();
    await testStraightPoseDoesNotWrite();
    await testOpaqueSnapshotUsesExplicitMatting();
    await testRejectedGeometryDoesNotLeakCandidate();
    await testSnapshotMismatchStopsBeforeInferenceAndWrite();
    await testInvalidRequestStopsBeforePhotoshopRead();
    await testSuccessWithoutProviderReceiptIsNotCompletion();
    await testFailedWriteKeepsTriStateMutationFact();
    await testDispatchBindsCurrentDocumentRevision();
    await testHandlerBindsBinaryCaptureBeforeSingleWrite();
    await testMcpHostPreservesWorkflowStartFact();
    console.log('✅ PASS │ SKU 姿态 Provider：单写事务、版本绑定、收据验证与失败三态');
}
