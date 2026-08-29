#!/usr/bin/env node
"use strict";

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');

const root = path.resolve(__dirname, '..');

function readPackage(packageName) {
  const entry = require.resolve(packageName, { paths: [root] });
  let directory = path.dirname(entry);
  while (directory !== path.dirname(directory)) {
    const candidate = path.join(directory, 'package.json');
    if (fs.existsSync(candidate)) {
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      if (parsed.name === packageName) return parsed;
    }
    directory = path.dirname(directory);
  }
  throw new Error(`无法定位依赖 package.json：${packageName}`);
}

function major(version) {
  return Number.parseInt(String(version || '').split('.')[0], 10);
}

function minor(version) {
  return Number.parseInt(String(version || '').split('.')[1], 10);
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address());
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    request.once('error', reject);
    request.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function writeJson(response, payload) {
  response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function writeStream(response, model) {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive'
  });
  const events = [
    {
      id: 'chatcmpl-stream-fixture',
      object: 'chat.completion.chunk',
      created: 1787990000,
      model,
      choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: 'plan' }, finish_reason: null }]
    },
    {
      id: 'chatcmpl-stream-fixture',
      object: 'chat.completion.chunk',
      created: 1787990000,
      model,
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            id: 'call_stream_fixture',
            type: 'function',
            function: { name: 'inspectFixture', arguments: '{"value":' }
          }]
        },
        finish_reason: null
      }]
    },
    {
      id: 'chatcmpl-stream-fixture',
      object: 'chat.completion.chunk',
      created: 1787990000,
      model,
      choices: [{
        index: 0,
        delta: { tool_calls: [{ index: 0, function: { arguments: '1}' } }] },
        finish_reason: 'tool_calls'
      }]
    },
    {
      id: 'chatcmpl-stream-fixture',
      object: 'chat.completion.chunk',
      created: 1787990000,
      model,
      choices: [],
      usage: {
        prompt_tokens: 12,
        completion_tokens: 5,
        total_tokens: 17,
        prompt_cache_hit_tokens: 8,
        prompt_cache_miss_tokens: 4
      }
    }
  ];
  for (const event of events) response.write(`data: ${JSON.stringify(event)}\n\n`);
  response.end('data: [DONE]\n\n');
}

async function main() {
  const appPackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const openaiPackage = readPackage('openai');
  const wsPackage = readPackage('ws');
  const zodPackage = readPackage('zod');
  const undiciPackage = readPackage('undici');

  assert.strictEqual(major(openaiPackage.version), 7, '必须运行 OpenAI SDK 7.x');
  assert.strictEqual(major(wsPackage.version), 8, 'OpenAI SDK WebSocket peer 必须保持 ws 8.x');
  assert(minor(wsPackage.version) >= 21, `ws 必须满足 ^8.21.0，当前 ${wsPackage.version}`);
  assert.strictEqual(major(zodPackage.version), 4, '根 Zod 必须保持 4.x');
  assert(major(undiciPackage.version) >= 7 && major(undiciPackage.version) < 9,
    `undici 必须位于 OpenAI 7 支持范围，当前 ${undiciPackage.version}`);
  assert(String(openaiPackage.peerDependencies?.zod || '').includes('^4.0'),
    'OpenAI SDK 必须正式声明 Zod 4 peer');
  assert(!appPackage.overrides?.openai, 'OpenAI/Zod 未声明兼容 override 必须退役');

  const capturedRequests = [];
  const upstream = http.createServer(async (request, response) => {
    const body = JSON.parse(await readBody(request));
    capturedRequests.push({
      url: request.url,
      authorization: request.headers.authorization,
      body
    });
    if (String(body.model).startsWith('delay-')) {
      const timer = setTimeout(() => {
        if (!response.destroyed && !response.writableEnded) {
          writeJson(response, {
            id: 'chatcmpl-delay-fixture',
            object: 'chat.completion',
            created: 1787990000,
            model: body.model,
            choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'late' } }]
          });
        }
      }, 250);
      response.once('close', () => clearTimeout(timer));
      return;
    }
    if (body.stream === true) {
      writeStream(response, body.model);
      return;
    }
    writeJson(response, {
      id: 'chatcmpl-fixture',
      object: 'chat.completion',
      created: 1787990000,
      model: body.model,
      choices: [{
        index: 0,
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: null,
          reasoning_content: 'fixture reasoning',
          tool_calls: [{
            id: 'call_fixture',
            type: 'function',
            function: { name: 'inspectFixture', arguments: '{"ok":true}' }
          }]
        }
      }],
      usage: {
        prompt_tokens: 12,
        completion_tokens: 5,
        total_tokens: 17,
        prompt_cache_hit_tokens: 8,
        prompt_cache_miss_tokens: 4
      }
    });
  });

  let proxyConnectCount = 0;
  const proxy = http.createServer((request, response) => {
    const target = new URL(request.url);
    const forwarded = http.request({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: request.method,
      headers: request.headers
    }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    });
    forwarded.once('error', (error) => response.destroy(error));
    request.pipe(forwarded);
  });
  proxy.on('connect', (request, clientSocket, head) => {
    proxyConnectCount += 1;
    const separator = String(request.url || '').lastIndexOf(':');
    const host = String(request.url || '').slice(0, separator);
    const port = Number.parseInt(String(request.url || '').slice(separator + 1), 10);
    const upstreamSocket = net.connect(port, host, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstreamSocket.write(head);
      upstreamSocket.pipe(clientSocket);
      clientSocket.pipe(upstreamSocket);
    });
    upstreamSocket.once('error', (error) => clientSocket.destroy(error));
  });

  const upstreamAddress = await listen(upstream);
  const proxyAddress = await listen(proxy);
  const previousProxy = process.env.DESIGNECHO_PROXY_URL;
  process.env.DESIGNECHO_PROXY_URL = `http://127.0.0.1:${proxyAddress.port}`;

  let dispatcher;
  try {
    const { getOpenAIFetchOptions } = require(path.join(
      root,
      'dist',
      'main',
      'main',
      'services',
      'network-proxy.js'
    ));
    const fetchOptions = getOpenAIFetchOptions();
    dispatcher = fetchOptions?.dispatcher;
    assert(dispatcher && typeof dispatcher.dispatch === 'function',
      'OpenAI 7 必须取得 undici Dispatcher，而不是已移除的 httpAgent');

    const OpenAIImport = require('openai');
    const OpenAI = OpenAIImport.default || OpenAIImport;
    const client = new OpenAI({
      apiKey: 'test-sdk-key',
      baseURL: `http://127.0.0.1:${upstreamAddress.port}/v1`,
      fetchOptions,
      maxRetries: 0,
      timeout: 5000
    });

    const request = {
      model: 'deepseek-v4-flash-vision-exp',
      messages: [{ role: 'user', content: 'fixture' }],
      tools: [{
        type: 'function',
        function: {
          name: 'inspectFixture',
          description: 'fixture',
          parameters: { type: 'object', properties: {} }
        }
      }],
      thinking: { type: 'disabled' },
      max_tokens: 64
    };
    const response = await client.chat.completions.create(request);
    assert.strictEqual(response.choices[0]?.finish_reason, 'tool_calls');
    assert.strictEqual(response.choices[0]?.message?.reasoning_content, 'fixture reasoning');
    assert.strictEqual(response.choices[0]?.message?.tool_calls?.[0]?.function?.name, 'inspectFixture');
    assert.strictEqual(response.usage?.prompt_cache_hit_tokens, 8);
    assert.strictEqual(response.usage?.prompt_cache_miss_tokens, 4);

    const stream = await client.chat.completions.create({
      ...request,
      stream: true,
      stream_options: { include_usage: true }
    });
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    assert.strictEqual(chunks[0]?.choices?.[0]?.delta?.reasoning_content, 'plan');
    assert.strictEqual(chunks[1]?.choices?.[0]?.delta?.tool_calls?.[0]?.function?.name, 'inspectFixture');
    assert.strictEqual(chunks.at(-1)?.usage?.prompt_cache_hit_tokens, 8);
    assert.strictEqual(chunks.at(-1)?.usage?.prompt_cache_miss_tokens, 4);

    await assert.rejects(
      client.chat.completions.create(
        { ...request, model: 'delay-timeout-fixture' },
        { timeout: 25 }
      ),
      (error) => error?.name === 'APIConnectionTimeoutError' || /timed out/i.test(String(error?.message || '')),
      'per-request timeout 必须终止 SDK 请求'
    );

    const abortController = new AbortController();
    const abortedRequest = client.chat.completions.create(
      { ...request, model: 'delay-abort-fixture' },
      { signal: abortController.signal }
    );
    setTimeout(() => abortController.abort(), 25);
    await assert.rejects(
      abortedRequest,
      (error) => ['APIUserAbortError', 'AbortError'].includes(String(error?.constructor?.name || '')),
      'AbortSignal 必须终止 SDK 请求'
    );

    const completedRequests = capturedRequests.filter((item) => (
      item.body.model === 'deepseek-v4-flash-vision-exp'
    ));
    assert.strictEqual(completedRequests.length, 2, '普通与流式请求都必须到达 local upstream');
    for (const captured of capturedRequests) {
      assert.strictEqual(captured.url, '/v1/chat/completions');
      assert.strictEqual(captured.authorization, 'Bearer test-sdk-key');
      assert.deepStrictEqual(captured.body.thinking, { type: 'disabled' });
    }
    for (const captured of completedRequests) {
      assert.strictEqual(captured.body.model, 'deepseek-v4-flash-vision-exp');
    }
    assert(proxyConnectCount >= 1, 'OpenAI SDK 请求必须真实经过 undici ProxyAgent 隧道');

    console.log(
      `[OK] OpenAI ${openaiPackage.version} + Zod ${zodPackage.version} + ws ${wsPackage.version} `
        + '通过本地代理、DeepSeek 扩展、Tool Call、流式 usage/cache、timeout 与 abort 契约。'
    );
  } finally {
    if (previousProxy === undefined) delete process.env.DESIGNECHO_PROXY_URL;
    else process.env.DESIGNECHO_PROXY_URL = previousProxy;
    await dispatcher?.close?.();
    await closeServer(proxy);
    await closeServer(upstream);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
