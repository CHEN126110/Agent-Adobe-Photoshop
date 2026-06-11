#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
const SERVICE_PATH = path.join(ROOT, 'src/renderer/services/stream-chat.service.ts');

function loadStreamChatExports() {
  const source = fs.readFileSync(SERVICE_PATH, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true
    },
    fileName: SERVICE_PATH
  });

  const streamModule = new Module(SERVICE_PATH, module);
  streamModule.filename = SERVICE_PATH;
  streamModule.paths = Module._nodeModulePaths(path.dirname(SERVICE_PATH));
  streamModule._compile(compiled.outputText, `${SERVICE_PATH}.js`);
  return streamModule.exports;
}

let listener = null;
const requests = [];

global.window = {
  designEcho: {
    onStreamChunk(callback) {
      listener = callback;
    },
    chatStream(request) {
      requests.push(request);
      setImmediate(() => {
        listener({
          requestId: request.requestId,
          chunk: {
            type: 'error',
            error: 'OpenRouter HTTP 429: quota exceeded. Please retry in 40s.'
          }
        });
      });
      return Promise.resolve({ success: true });
    },
    abortStream() {
      return Promise.resolve({ success: true });
    }
  }
};

async function expectStreamError() {
  const { streamChatAsync } = loadStreamChatExports();

  let rejected = null;
  try {
    await streamChatAsync('test-model', [
      { role: 'user', content: '你好' }
    ]);
  } catch (error) {
    rejected = error;
  }

  assert(rejected instanceof Error, 'streamChatAsync must reject when an error chunk arrives');
  assert(
    rejected.message.includes('HTTP 429') && rejected.message.includes('quota exceeded'),
    'streamChatAsync must preserve the compact provider error message'
  );
  assert.strictEqual(requests.length, 1, 'streamChatAsync should make exactly one stream request');
  assert(requests[0].requestId, 'stream request must contain a requestId');
}

expectStreamError()
  .then(() => {
    console.log(JSON.stringify({
      success: true,
      checks: [
        'renderer streamChatAsync rejects on stream error chunks',
        'renderer streamChatAsync preserves compact provider error cause',
        'renderer stream service sends requestId for callback correlation'
      ]
    }, null, 2));
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
