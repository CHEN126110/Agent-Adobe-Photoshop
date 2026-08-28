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
const {
    compileRemoveBackgroundWorkflowRequest
} = require(path.join(agentRoot, 'src/shared/photoshop-remove-background-workflow.ts'));
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
    const salientCalls = [];
    await dispatchPhotoshopRemoveBackgroundWorkflow({
        ...validInput,
        targetPrompt: '   '
    }, {
        getDocumentInfo: async () => matchingDocument,
        invokeRegisteredHandler: async (method, params) => {
            salientCalls.push({ method, params });
            return { success: true };
        }
    });
    assert.strictEqual(salientCalls.length, 1);
    assert.strictEqual(salientCalls[0].params.targetPrompt, '');
    console.log('✅ 空 targetPrompt 明确进入通用前景抠图，不再伪装成语义目标缺失');
    await expectRejectedBeforeDispatch(
        '引导点没有 targetPrompt 时在读取 Photoshop 前拒绝',
        {
            ...validInput,
            targetPrompt: '',
            semanticGuidance: {
                version: 'semantic-matting-guidance/v1',
                sets: [{ foregroundPoints: [{ x: 0.5, y: 0.5 }] }]
            }
        },
        matchingDocument,
        /semanticGuidance.*targetPrompt/
    );
    await expectRejectedBeforeDispatch(
        '越界引导点在读取 Photoshop 前拒绝',
        {
            ...validInput,
            semanticGuidance: {
                version: 'semantic-matting-guidance/v1',
                sets: [{ foregroundPoints: [{ x: 1.5, y: 0.5 }] }]
            }
        },
        matchingDocument,
        /0 到 1/
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
    const semanticGuidance = {
        version: 'semantic-matting-guidance/v1',
        sets: [{
            foregroundPoints: [{ x: 0.42, y: 0.36 }],
            backgroundPoints: [{ x: 0.44, y: 0.52 }]
        }]
    };
    const result = await dispatchPhotoshopRemoveBackgroundWorkflow({
        ...validInput,
        targetPrompt: '  袜子  ',
        sampleAllLayers: true,
        enableHairRefine: false,
        semanticGuidance,
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
            semanticGuidance,
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

    const internalDocumentInfo = {
        success: true,
        document: { id: 42, activeLayerId: 9 },
        historyStateRef: { documentId: 42, historyStateId: 701 }
    };
    const compiledInternal = compileRemoveBackgroundWorkflowRequest({
        params: {
            sourceType: 'current_layer',
            targetPrompt: '袜子',
            outputMode: 'mask',
            semanticGuidance
        },
        documentInfo: internalDocumentInfo
    });
    assert.strictEqual(compiledInternal.valid, true);
    assert.deepStrictEqual(compiledInternal.request, {
        expectedDocumentId: 42,
        expectedHistoryStateId: 701,
        layerId: 9,
        targetPrompt: '袜子',
        outputFormat: 'mask',
        quality: 'balanced',
        sampleAllLayers: false,
        enableHairRefine: true,
        enableFabricRefine: true,
        semanticGuidance
    });
    assert.strictEqual(compileRemoveBackgroundWorkflowRequest({
        params: { sourceType: 'file_path', filePath: 'D:/input.png' },
        documentInfo: internalDocumentInfo
    }).code, 'matting_source_not_prepared');
    assert.strictEqual(compileRemoveBackgroundWorkflowRequest({
        params: { sourceType: 'current_layer', outputMode: 'replace' },
        documentInfo: internalDocumentInfo
    }).code, 'matting_destructive_replace_unsupported');
    assert.strictEqual(compileRemoveBackgroundWorkflowRequest({
        params: { sourceType: 'current_layer', semanticGuidance },
        documentInfo: internalDocumentInfo
    }).code, 'matting_guidance_requires_semantic_target');
    console.log('✅ 内部 Skill 参数只编译为绑定版本、绑定图层、非破坏的完整抠图请求');

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

    const invalidGuidanceResult = await liveHandler({
        layerId: 9,
        targetPrompt: '袜子',
        outputFormat: 'mask',
        semanticGuidance: {
            version: 'semantic-matting-guidance/v1',
            sets: [{ foregroundPoints: [{ x: -0.1, y: 0.5 }] }]
        }
    });
    assert.strictEqual(invalidGuidanceResult.success, false);
    assert.strictEqual(invalidGuidanceResult.errorCode, 'SEMANTIC_GUIDANCE_INVALID');
    assert.strictEqual(invalidGuidanceResult.noMutation, true);
    assert.strictEqual(photoshopSendCount, 0);
    console.log('✅ 无效语义引导在首次 Photoshop 导出前失败，不会产生半程请求');

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
    assert(handlerSource.includes('sampleAllLayers,\n                    semanticGuidance,\n                    control'));
    assert(handlerSource.includes("errorCode: 'MATTING_CANCELLED_WRITE_STATE_UNKNOWN'"));
    assert(handlerSource.indexOf('photoshopApplyStarted = true') < applyIndex);
    console.log('✅ 本地推理结束后的取消检查位于 applyMattingResult 之前，请求键贯穿导出与写回');

    const toolExecutorSource = fs.readFileSync(
        path.join(agentRoot, 'src/renderer/services/tool-executor.service.ts'),
        'utf8'
    );
    const mcpClientSource = fs.readFileSync(
        path.join(agentRoot, 'src/renderer/services/mcp-host.client.ts'),
        'utf8'
    );
    assert(toolExecutorSource.includes("if (method === 'removeBackground')"));
    assert(toolExecutorSource.includes('callPhotoshopRemoveBackgroundWorkflow({ ...compiled.request }'));
    assert(mcpClientSource.includes("const hostToolName = 'photoshop.workflows.remove_background'"));
    console.log('✅ 公开 removeBackground 已路由到 Main 完整工作流，不再把 UXP 导出原子动作当完成');

    const cancellationCalls = [];
    const mcpHost = new MCPHostService({
        host: '127.0.0.1',
        port: 0,
        wsServer: {
            isPluginConnected: () => false,
            cancelRequestByKey: (requestKey, reason, options) => {
                cancellationCalls.push({ requestKey, reason, options });
                return false;
            }
        },
        debugBridge: {},
        runtimeBuildIdentity: {}
    });
    const notStartedResult = await mcpHost.callTool('photoshop.workflows.remove_background', validInput);
    assert.deepStrictEqual(notStartedResult, {
        success: false,
        code: 'photoshop_workflow_not_started',
        error: 'Photoshop UXP plugin is not connected',
        noMutation: true,
        executesPhotoshop: false
    });
    console.log('✅ 完整工作流尚未启动时返回可区分的零写入事实，不伪造未知完成状态');
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
    });
    const uncertainResult = await uncertainHost.callTool(
        'photoshop.workflows.remove_background',
        validInput
    );
    assert.deepStrictEqual(uncertainResult, {
        success: false,
        code: 'photoshop_workflow_outcome_unknown',
        error: 'injected post-dispatch transport loss',
        noMutation: false,
        mutationState: 'unknown',
        executesPhotoshop: true
    });
    console.log('✅ handler 启动后的异常标记写入状态未知，禁止谎报 noMutation');
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
