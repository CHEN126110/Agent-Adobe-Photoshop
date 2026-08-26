#!/usr/bin/env node
"use strict";

const assert = require('assert');
const fs = require('fs');
const Module = require('module');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  assert(fs.existsSync(absolutePath), `缺少验证文件：${relativePath}`);
  return fs.readFileSync(absolutePath, 'utf8');
}

const preloadSource = read('src/main/preload.ts');
const preloadBuild = read('dist/main/main/preload.js');
const runtimeHandlers = read('src/main/ipc-handlers/runtime-handlers.ts');
const handlerIndex = read('src/main/ipc-handlers/index.ts');
const mainIndex = read('src/main/index.ts');
const rendererTypes = read('src/renderer/types.d.ts');
const mcpHostClient = read('src/renderer/services/mcp-host.client.ts');

const unsafeRelativeRuntimeImports = Array.from(preloadSource.matchAll(
  /^\s*import\s+(?!type\b)[^;]*?from\s+['"](\.{1,2}\/[^'"]+)['"];?/gm
)).map((match) => match[1]);
const unsafeRelativeSideEffectImports = Array.from(preloadSource.matchAll(
  /^\s*import\s+['"](\.{1,2}\/[^'"]+)['"];?/gm
)).map((match) => match[1]);

assert.deepStrictEqual(
  [...unsafeRelativeRuntimeImports, ...unsafeRelativeSideEffectImports],
  [],
  'Sandbox preload 不得运行时 import 相对本地模块；请改用 type-only import、IPC 或单文件 bundling。'
);

const builtRequires = Array.from(preloadBuild.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g))
  .map((match) => match[1]);
assert.deepStrictEqual(
  builtRequires.filter((specifier) => specifier !== 'electron'),
  [],
  `编译后的 sandbox preload 只能 require electron，当前额外依赖：${builtRequires.join(', ')}`
);

assert(preloadSource.includes("contextBridge.exposeInMainWorld('designEcho', api)"));
assert(preloadSource.includes('selectEagleLibrary:'));
assert(preloadSource.includes("ipcRenderer.invoke('eagleLibrary:select', options)"));
assert(preloadSource.includes("ipcRenderer.invoke('runtime:getMcpHostEndpoint') as Promise<string>"));
assert(runtimeHandlers.includes("ipcMain.handle('runtime:getMcpHostEndpoint'"));
assert(runtimeHandlers.includes('LOOPBACK_MCP_ENDPOINT.test(endpoint)'));
assert(handlerIndex.includes('registerRuntimeHandlers(context)'));
assert(mainIndex.includes('mcpHostEndpoint: mcpHostService ? `${mcpHostService.getBaseUrl()}/mcp` : null'));
assert(mainIndex.includes('contextIsolation: true'));
assert(mainIndex.includes('nodeIntegration: false'));
assert(mainIndex.includes('sandbox: true'));
assert(!mainIndex.includes('sandbox: false'));
assert(rendererTypes.includes('getMcpHostEndpoint?: () => Promise<string>'));
assert(mcpHostClient.includes('fetch(await resolveMcpHostEndpoint()'));
assert(mcpHostClient.includes('Electron 内必须对当前 Runtime owner fail closed'));

async function verifyBuiltBridgeProjection() {
  const exposed = {};
  const invocations = [];
  const electronMock = {
    contextBridge: {
      exposeInMainWorld: (name, value) => {
        exposed[name] = value;
      }
    },
    ipcRenderer: {
      invoke: async (channel, ...args) => {
        invocations.push({ channel, args });
        if (channel === 'runtime:getMcpHostEndpoint') return 'http://127.0.0.1:8768/mcp';
        return { success: false, status: 'contract_probe' };
      },
      on: () => undefined,
      once: () => undefined,
      removeListener: () => undefined,
      send: () => undefined,
      sendSync: () => ({ success: true, value: null })
    }
  };

  const preloadPath = path.join(root, 'dist', 'main', 'main', 'preload.js');
  const originalLoad = Module._load;
  try {
    Module._load = function loadWithElectronMock(request, parent, isMain) {
      if (request === 'electron') return electronMock;
      return originalLoad.call(this, request, parent, isMain);
    };
    delete require.cache[require.resolve(preloadPath)];
    require(preloadPath);
  } finally {
    Module._load = originalLoad;
  }

  const bridge = exposed.designEcho;
  assert(bridge && typeof bridge === 'object', '编译后的 preload 必须暴露 designEcho');
  for (const method of [
    'selectEagleLibrary',
    'openEagleLibrary',
    'queryEagleLibrary',
    'getEagleLibraryPreview',
    'getMcpHostEndpoint',
    'invoke'
  ]) {
    assert.strictEqual(typeof bridge[method], 'function', `designEcho.${method} 必须是函数`);
  }

  await bridge.selectEagleLibrary({ defaultPath: 'C:/fixture.library' });
  await bridge.openEagleLibrary('C:/fixture.library', true);
  await bridge.queryEagleLibrary({ libraryPath: 'C:/fixture.library', limit: 1 });
  await bridge.getEagleLibraryPreview({ libraryPath: 'C:/fixture.library', itemId: 'fixture' });
  assert.strictEqual(await bridge.getMcpHostEndpoint(), 'http://127.0.0.1:8768/mcp');

  assert.deepStrictEqual(
    invocations.slice(-5).map((entry) => entry.channel),
    [
      'eagleLibrary:select',
      'eagleLibrary:open',
      'eagleLibrary:query',
      'eagleLibrary:getPreview',
      'runtime:getMcpHostEndpoint'
    ]
  );
}

verifyBuiltBridgeProjection()
  .then(() => {
    console.log('[OK] Electron sandbox preload 为单文件运行边界，Eagle 桥与当前 Runtime endpoint 接线完整。');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
