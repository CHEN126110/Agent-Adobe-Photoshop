const assert = require('assert');
const fs = require('fs');
const path = require('path');

const agentRoot = path.resolve(__dirname, '..');
require('ts-node').register({
    transpileOnly: true,
    project: path.join(agentRoot, 'tsconfig.main.json')
});

const {
    dispatchPhotoshopRemoveBackgroundWorkflow
} = require(path.join(agentRoot, 'src/main/services/photoshop-workflow-dispatch.ts'));
const { WebSocketServer } = require(path.join(agentRoot, 'src/main/websocket/server.ts'));
const { MCPHostService } = require(path.join(agentRoot, 'src/main/services/mcp-host-service.ts'));
const {
    registerVisualHandlers
} = require(path.join(agentRoot, 'src/main/uxp-handlers/visual-handlers.ts'));

async function expectRejectedBeforeDispatch(label, input, documentInfo, expectedPattern) {
    let documentReadCount = 0;
    let invokeCount = 0;
    await assert.rejects(
        () => dispatchPhotoshopRemoveBackgroundWorkflow(input, {
            getDocumentInfo: async () => {
                documentReadCount += 1;
                return documentInfo;
            },
            invokeRegisteredHandler: async () => {
                invokeCount += 1;
                return { success: true };
            }
        }),
        expectedPattern,
        label
    );
    assert.strictEqual(invokeCount, 0, `${label}: workflow handler must not run`);
    console.log(`✅ ${label}（documentReads=${documentReadCount}, workflowInvokes=${invokeCount}）`);
}

async function run() {
    const validInput = {
        expectedDocumentId: 42,
        expectedHistoryStateId: 701,
        layerId: 9,
        targetPrompt: '袜子',
        outputFormat: 'mask'
    };
    const matchingDocument = {
        success: true,
        document: { id: 42, name: 'Disposable.psd' },
        historyStateRef: { documentId: 42, historyStateId: 701 }
    };

    const cancelledBeforeRead = new AbortController();
    cancelledBeforeRead.abort('test');
    let cancelledBeforeReadCount = 0;
    let cancelledBeforeInvokeCount = 0;
    await assert.rejects(
        () => dispatchPhotoshopRemoveBackgroundWorkflow({
            ...validInput,
            abortSignal: cancelledBeforeRead.signal
        }, {
            getDocumentInfo: async () => {
                cancelledBeforeReadCount += 1;
                return matchingDocument;
            },
            invokeRegisteredHandler: async () => {
                cancelledBeforeInvokeCount += 1;
                return { success: true };
            }
        }),
        /取消/
    );
    assert.strictEqual(cancelledBeforeReadCount, 0);
    assert.strictEqual(cancelledBeforeInvokeCount, 0);
    console.log('✅ 客户端已断开时不读取文档、不启动工作流');

    const cancelledAfterRead = new AbortController();
    let cancelledAfterReadInvokeCount = 0;
    await assert.rejects(
        () => dispatchPhotoshopRemoveBackgroundWorkflow({
            ...validInput,
            abortSignal: cancelledAfterRead.signal
        }, {
            getDocumentInfo: async () => {
                cancelledAfterRead.abort('test');
                return matchingDocument;
            },
            invokeRegisteredHandler: async () => {
                cancelledAfterReadInvokeCount += 1;
                return { success: true };
            }
        }),
        /取消/
    );
    assert.strictEqual(cancelledAfterReadInvokeCount, 0);
    console.log('✅ 文档核对期间客户端断开时不进入既有 handler');

    await expectRejectedBeforeDispatch(
        '缺 expectedDocumentId 时在读取 Photoshop 前拒绝',
        { ...validInput, expectedDocumentId: undefined },
        matchingDocument,
        /expectedDocumentId/
    );
    await expectRejectedBeforeDispatch(
        '缺 layerId 时在读取 Photoshop 前拒绝',
        { ...validInput, layerId: 0 },
        matchingDocument,
        /layerId/
    );
    await expectRejectedBeforeDispatch(
        '空 targetPrompt 时在读取 Photoshop 前拒绝',
        { ...validInput, targetPrompt: '   ' },
        matchingDocument,
        /targetPrompt/
    );
    await expectRejectedBeforeDispatch(
        '非法 outputFormat 时在读取 Photoshop 前拒绝',
        { ...validInput, outputFormat: 'jpeg' },
        matchingDocument,
        /outputFormat/
    );
    await expectRejectedBeforeDispatch(
        '非法 expectedHistoryStateId 不能降级成未绑定版本',
        { ...validInput, expectedHistoryStateId: 'stale' },
        matchingDocument,
        /expectedHistoryStateId/
    );
    await expectRejectedBeforeDispatch(
        '非法 quality 不能静默改成 balanced',
        { ...validInput, quality: 'ultra' },
        matchingDocument,
        /quality/
    );
    await expectRejectedBeforeDispatch(
        '文档身份不可读时零工作流调用',
        validInput,
        { success: false, error: 'busy' },
        /无法读取当前 Photoshop 文档身份/
    );
    await expectRejectedBeforeDispatch(
        '活动文档不匹配时零工作流调用',
        validInput,
        {
            success: true,
            document: { id: 43 },
            historyStateRef: { documentId: 43, historyStateId: 701 }
        },
        /期望 42，实际 43/
    );
    await expectRejectedBeforeDispatch(
        '历史版本不匹配时零工作流调用',
        validInput,
        {
            success: true,
            document: { id: 42 },
            historyStateRef: { documentId: 42, historyStateId: 702 }
        },
        /期望 701，实际 702/
    );

    const calls = [];
    const workflowReceipt = { success: true, mutationReceipt: { complete: true } };
    const liveController = new AbortController();
    const result = await dispatchPhotoshopRemoveBackgroundWorkflow({
        ...validInput,
        targetPrompt: '  袜子  ',
        sampleAllLayers: true,
        enableHairRefine: false,
        requestKey: 'semantic-e2e-1',
        abortSignal: liveController.signal
    }, {
        getDocumentInfo: async () => matchingDocument,
        invokeRegisteredHandler: async (method, params) => {
            calls.push({ method, params });
            return workflowReceipt;
        }
    });
    assert.strictEqual(result, workflowReceipt);
    assert.deepStrictEqual(calls, [{
        method: 'remove-background',
        params: {
            mode: 'ai',
            useMask: true,
            outputFormat: 'mask',
            quality: 'balanced',
            targetPrompt: '袜子',
            sampleAllLayers: true,
            enableHairRefine: false,
            enableFabricRefine: true,
            layerId: 9,
            expectedDocumentId: 42,
            requestKey: 'semantic-e2e-1',
            abortSignal: liveController.signal,
            expectedHistoryStateId: 701
        }
    }]);
    console.log('✅ 精确 document/history/layer 与调用方目标原样进入既有 remove-background handler');

    const historyOptionalCalls = [];
    await dispatchPhotoshopRemoveBackgroundWorkflow({
        expectedDocumentId: 42,
        layerId: 10,
        targetPrompt: '鞋子',
        outputFormat: 'layer',
        quality: 'fast'
    }, {
        getDocumentInfo: async () => matchingDocument,
        invokeRegisteredHandler: async (method, params) => {
            historyOptionalCalls.push({ method, params });
            return { success: true };
        }
    });
    assert.strictEqual(historyOptionalCalls.length, 1);
    assert.strictEqual(historyOptionalCalls[0].params.useMask, false);
    assert.strictEqual(historyOptionalCalls[0].params.quality, 'fast');
    assert.strictEqual(
        Object.prototype.hasOwnProperty.call(historyOptionalCalls[0].params, 'expectedHistoryStateId'),
        false
    );
    console.log('✅ 未声明 history 时不伪造版本事实，layer 输出不伪装为 mask');

    const server = new WebSocketServer(0);
    let receivedParams = null;
    server.registerHandler('contract-test', async (params) => {
        receivedParams = params;
        return { success: true, source: 'registered-handler' };
    });
    assert.deepStrictEqual(
        await server.invokeRegisteredHandler('contract-test', { value: 1 }),
        { success: true, source: 'registered-handler' }
    );
    assert.deepStrictEqual(receivedParams, { value: 1 });
    await assert.rejects(
        () => server.invokeRegisteredHandler('missing-handler', {}),
        /尚未注册/
    );
    console.log('✅ MCP 宿主复用同一注册 handler，缺 handler 时明确失败');

    const registeredHandlers = new Map();
    let photoshopSendCount = 0;
    registerVisualHandlers({
        wsServer: {
            registerHandler: (name, handler) => registeredHandlers.set(name, handler),
            isPluginConnected: () => true,
            sendProgress: () => undefined,
            sendRequest: async () => {
                photoshopSendCount += 1;
                return { success: true };
            }
        },
        logService: { logAgent: () => undefined },
        mattingService: {},
        groundingDinoService: null,
        samService: null
    });
    const liveHandler = registeredHandlers.get('remove-background');
    assert.strictEqual(typeof liveHandler, 'function');
    const preAbortedHandlerController = new AbortController();
    preAbortedHandlerController.abort('test');
    const preAbortedHandlerResult = await liveHandler({
        layerId: 9,
        targetPrompt: '袜子',
        outputFormat: 'mask',
        abortSignal: preAbortedHandlerController.signal,
        requestKey: 'semantic-e2e-aborted'
    });
    assert.strictEqual(preAbortedHandlerResult.success, false);
    assert.strictEqual(preAbortedHandlerResult.errorCode, 'MATTING_WORKFLOW_CANCELLED');
    assert.strictEqual(photoshopSendCount, 0);
    console.log('✅ 已取消信号进入真实 remove-background handler 后仍保持零 Photoshop 请求');

    const visualHandlerSource = fs.readFileSync(
        path.join(agentRoot, 'src/main/uxp-handlers/visual-handlers.ts'),
        'utf8'
    );
    const handlerStart = visualHandlerSource.indexOf("registerHandler('remove-background'");
    const handlerEnd = visualHandlerSource.indexOf(
        "registerHandler('remove-background-by-selection'",
        handlerStart
    );
    const handlerSource = visualHandlerSource.slice(handlerStart, handlerEnd).replace(/\r\n/g, '\n');
    const inferenceIndex = handlerSource.indexOf('const mattingResult');
    const postInferenceCancelIndex = handlerSource.indexOf(
        'if (isMattingWorkflowCancelled(control))',
        inferenceIndex
    );
    const applyIndex = handlerSource.indexOf("sendRequest('applyMattingResult'");
    assert(handlerStart >= 0 && handlerEnd > handlerStart);
    assert(inferenceIndex >= 0);
    assert(postInferenceCancelIndex > inferenceIndex);
    assert(applyIndex > postInferenceCancelIndex);
    assert(handlerSource.includes('control.requestKey ? { requestKey: control.requestKey } : {}'));
    assert(handlerSource.includes('sampleAllLayers,\n                    control'));
    assert(handlerSource.includes("errorCode: 'MATTING_CANCELLED_WRITE_STATE_UNKNOWN'"));
    assert(handlerSource.indexOf('photoshopApplyStarted = true') < applyIndex);
    console.log('✅ 本地推理结束后的取消检查位于 applyMattingResult 之前，请求键贯穿导出与写回');

    const cancellationCalls = [];
    const mcpHost = new MCPHostService({
        host: '127.0.0.1',
        port: 0,
        wsServer: {
            cancelRequestByKey: (requestKey, reason, options) => {
                cancellationCalls.push({ requestKey, reason, options });
                return false;
            }
        },
        debugBridge: {},
        runtimeBuildIdentity: {}
    });
    const workflowRequest = {
        jsonrpc: '2.0',
        id: 77,
        method: 'tools/call',
        params: {
            name: 'photoshop.workflows.remove_background',
            arguments: {}
        }
    };
    const generatedRequestKey = mcpHost.resolveHttpAbortRequestKey(workflowRequest);
    assert(generatedRequestKey.startsWith('mcp-http:77:'));
    assert.strictEqual(mcpHost.shouldAwaitFinalResultAfterHttpAbort(workflowRequest), true);
    const keyedRequest = mcpHost.attachHttpAbortRequestKey(workflowRequest, generatedRequestKey);
    assert.strictEqual(keyedRequest.params.arguments.requestKey, generatedRequestKey);
    const hostAbortController = new AbortController();
    mcpHost.workflowAbortControllers.set(generatedRequestKey, hostAbortController);
    const cancelResult = await mcpHost.callTool('photoshop.tools.cancel', {
        requestKey: generatedRequestKey,
        awaitFinalResult: false
    });
    assert.strictEqual(cancelResult.cancelled, true);
    assert.strictEqual(cancelResult.workflowCancelled, true);
    assert.strictEqual(cancelResult.photoshopRequestCancelled, false);
    assert.strictEqual(hostAbortController.signal.aborted, true);
    assert.deepStrictEqual(cancellationCalls, [{
        requestKey: generatedRequestKey,
        reason: 'mcp_tool_cancel',
        options: { awaitFinalResult: true }
    }]);
    console.log('✅ HTTP 断连与显式 cancel 共用 requestKey，可在本地推理阶段中止后续写回');

    console.log('\n全部通过');
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
