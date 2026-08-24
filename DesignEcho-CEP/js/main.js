/**
 * DesignEcho CEP 桥：与 UXP 版说同一套协议（ws://localhost:8765，MCP JSON-RPC）。
 *
 * 职责：
 *  1. 面板 iframe 加载 Agent 界面（http://127.0.0.1:8766）；
 *  2. 连 8765：发 initialize / initialized，然后应答 Agent 发来的 ping / tools/list / tools/call；
 *  3. tools/call → window.__adobe_cep__.evalScript 进 jsx/host.jsx（ExtendScript）执行；
 *  4. 截图类结果返回临时文件路径，由这里用 window.cep.fs 以 Base64 读回再交给 Agent。
 *
 * 边界：这是能力子集版（无像素接口、无事务化读回、无历史版本守卫）。未实现的工具
 * 返回明确错误并列出本版可用工具——不猜、不静默、不冒充 UXP 版。
 */
(function () {
    'use strict';

    var UI_URL = 'http://127.0.0.1:8766';
    var WS_URL = 'ws://localhost:8765';
    var PLUGIN_VERSION = '0.1.0-cep';

    var statusEl = document.getElementById('status');
    var statusText = document.getElementById('statusText');
    var ui = document.getElementById('ui');
    document.getElementById('retry').onclick = function () { location.reload(); };

    function setStatus(kind, text) {
        statusEl.className = kind;
        statusText.textContent = text;
    }

    // ---------- 面板 UI ----------
    ui.src = UI_URL;

    // ---------- ExtendScript 调用 ----------
    function evalJsx(name, args) {
        return new Promise(function (resolve) {
            var payload = encodeURIComponent(JSON.stringify(args || {}));
            var script = 'DE_dispatch("' + name + '", "' + payload + '")';
            window.__adobe_cep__.evalScript(script, function (raw) {
                if (raw === 'EvalScript error.' || raw === undefined || raw === null || raw === '') {
                    resolve({ success: false, error: 'ExtendScript 执行失败（EvalScript error）：工具 ' + name + '。多半是 host.jsx 语法错误或 Photoshop 忙。' });
                    return;
                }
                try {
                    resolve(JSON.parse(decodeURIComponent(raw)));
                } catch (e) {
                    resolve({ success: false, error: 'ExtendScript 返回无法解析：' + String(raw).slice(0, 200) });
                }
            });
        });
    }

    // ---------- 截图文件回读 ----------
    function readFileBase64(path) {
        var r = window.cep.fs.readFile(path, window.cep.encoding.Base64);
        if (r.err !== 0) return null;
        return r.data;
    }

    // ---------- 本版工具表（能力子集，schema 与 UXP 版同名同参） ----------
    var TOOLS = [
        { name: 'getDocumentInfo', description: '获取当前文档信息', inputSchema: { type: 'object', properties: {} } },
        { name: 'listDocuments', description: '列出所有已打开的文档', inputSchema: { type: 'object', properties: { includeDetails: { type: 'boolean' } } } },
        { name: 'switchDocument', description: '切换到已打开的指定文档', inputSchema: { type: 'object', properties: { documentName: { type: 'string' }, documentId: { type: 'number' } } } },
        { name: 'createDocument', description: '创建新文档', inputSchema: { type: 'object', properties: { width: { type: 'number' }, height: { type: 'number' }, name: { type: 'string' }, resolution: { type: 'number' } } } },
        { name: 'getLayerHierarchy', description: '获取图层层级树（含 bounds）', inputSchema: { type: 'object', properties: { includeHidden: { type: 'boolean' } } } },
        { name: 'createTextLayer', description: '创建文字图层', inputSchema: { type: 'object', properties: { content: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, fontSize: { type: 'number' }, colorHex: { type: 'string' }, name: { type: 'string' }, fontName: { type: 'string' } }, required: ['content'] } },
        { name: 'setTextContent', description: '修改文字图层内容', inputSchema: { type: 'object', properties: { layerId: { type: 'number' }, content: { type: 'string' } }, required: ['content'] } },
        { name: 'moveLayer', description: '移动图层位置（绝对坐标）', inputSchema: { type: 'object', properties: { layerId: { type: 'number' }, x: { type: 'number' }, y: { type: 'number' } } } },
        { name: 'transformLayer', description: '等比缩放图层', inputSchema: { type: 'object', properties: { layerId: { type: 'number' }, scaleUniform: { type: 'number' } } } },
        { name: 'placeImage', description: '置入图片为智能对象', inputSchema: { type: 'object', properties: { filePath: { type: 'string' }, name: { type: 'string' } }, required: ['filePath'] } },
        { name: 'saveDocument', description: '保存文档（psd/jpg/png）', inputSchema: { type: 'object', properties: { path: { type: 'string' }, format: { type: 'string' }, quality: { type: 'number' } } } },
        { name: 'getDocumentSnapshot', description: '获取文档截图（临时文件导出，较慢）', inputSchema: { type: 'object', properties: { maxSize: { type: 'number' } } } },
        { name: 'closeDocument', description: '关闭文档', inputSchema: { type: 'object', properties: { documentName: { type: 'string' }, save: { type: 'boolean' } } } }
    ];
    var TOOL_NAMES = {};
    TOOLS.forEach(function (t) { TOOL_NAMES[t.name] = true; });

    async function callTool(name, args) {
        if (!TOOL_NAMES[name]) {
            return {
                success: false,
                error: '工具 ' + name + ' 在 CEP 版（老 Photoshop 支持层）不可用。本版可用：' + TOOLS.map(function (t) { return t.name; }).join('、') + '。请只用这些工具完成任务，做不到的部分如实告诉用户这台 Photoshop 版本较老。'
            };
        }
        var result = await evalJsx(name, args);
        // 截图：JSX 只导出临时文件，这里读成 base64 交回（与 UXP 版同字段 imageData）
        if (name === 'getDocumentSnapshot' && result && result.success && result.tempPath) {
            var b64 = readFileBase64(result.tempPath);
            if (!b64) return { success: false, error: '截图文件读取失败：' + result.tempPath };
            result.imageData = b64;
            result.format = 'jpeg';
            delete result.tempPath;
        }
        return result;
    }

    // ---------- WebSocket / MCP ----------
    var ws = null;
    var nextId = 1;
    var pending = {};

    function send(obj) { try { ws.send(JSON.stringify(obj)); } catch (e) { /* 连接断开由 onclose 处理 */ } }
    function request(method, params) {
        return new Promise(function (resolve, reject) {
            var id = 'cep-' + (nextId++);
            pending[id] = { resolve: resolve, reject: reject };
            send({ jsonrpc: '2.0', id: id, method: method, params: params });
        });
    }

    async function handleRequest(msg) {
        var method = msg.method;
        try {
            if (method === 'ping') { send({ jsonrpc: '2.0', id: msg.id, result: { status: 'pong' } }); return; }
            if (method === 'tools/list') { send({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } }); return; }
            if (method === 'tools/call') {
                var name = msg.params && msg.params.name;
                var args = (msg.params && msg.params.arguments) || {};
                var result = await callTool(name, args);
                send({
                    jsonrpc: '2.0', id: msg.id,
                    result: { content: [{ type: 'text', text: JSON.stringify(result) }], isError: result && result.success === false }
                });
                return;
            }
            send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'CEP 版不支持方法：' + method } });
        } catch (e) {
            send({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: String(e && e.message || e) } });
        }
    }

    function connect() {
        setStatus('', '正在连接 DesignEcho Agent…');
        ws = new WebSocket(WS_URL);
        ws.onopen = async function () {
            setStatus('ok', '已连接（CEP 兼容版 · 能力子集）');
            try {
                await request('initialize', {
                    protocolVersion: '2024-11-05',
                    capabilities: { roots: { listChanged: true } },
                    clientInfo: { name: 'DesignEcho-CEP', version: PLUGIN_VERSION }
                });
                send({ jsonrpc: '2.0', method: 'initialized', params: {} });
            } catch (e) {
                setStatus('err', 'Agent 初始化失败：' + (e && e.message || e));
            }
        };
        ws.onmessage = function (event) {
            var msg;
            try { msg = JSON.parse(event.data); } catch (e) { return; }
            if (msg.id !== undefined && msg.method) { handleRequest(msg); return; }
            if (msg.id !== undefined && pending[msg.id]) {
                var p = pending[msg.id]; delete pending[msg.id];
                if (msg.error) p.reject(new Error(msg.error.message || 'error')); else p.resolve(msg.result);
                return;
            }
            // 通知（agent.status / pong 等）忽略即可
        };
        ws.onclose = function () {
            setStatus('err', 'Agent 未连接：请先启动 DesignEcho 应用（8765/8766），10 秒后自动重试');
            setTimeout(connect, 10000);
        };
        ws.onerror = function () { try { ws.close(); } catch (e) { /* noop */ } };
    }

    connect();
    // 心跳：与 UXP 版一致，周期 ping 让 Agent 知道插件活着
    setInterval(function () { if (ws && ws.readyState === 1) send({ jsonrpc: '2.0', method: 'pong', params: {} }); }, 20000);
})();
