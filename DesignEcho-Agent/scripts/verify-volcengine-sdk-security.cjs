#!/usr/bin/env node
"use strict";

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');

const root = path.resolve(__dirname, '..');

function resolvePackage(packageName, searchPaths = [root]) {
  const entry = require.resolve(packageName, { paths: searchPaths });
  let directory = path.dirname(entry);
  while (directory !== path.dirname(directory)) {
    const candidate = path.join(directory, 'package.json');
    if (fs.existsSync(candidate)) {
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      if (parsed.name === packageName) {
        return { directory, entry, package: parsed };
      }
    }
    directory = path.dirname(directory);
  }
  throw new Error(`无法定位依赖 package.json：${packageName}`);
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
    request.once('end', () => resolve(Buffer.concat(chunks)));
  });
}

function snapshotEnvironment(keys) {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnvironment(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function main() {
  const appPackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const openApi = resolvePackage('@volcengine/openapi');
  const tosSdk = resolvePackage('@volcengine/tos-sdk');
  const directAxios = resolvePackage('axios');
  const openApiAxios = resolvePackage('axios', [openApi.directory]);
  const openApiAxiosFormData = resolvePackage('form-data', [openApiAxios.directory]);
  const openApiFormData = resolvePackage('form-data', [openApi.directory]);
  const openApiProtobuf = resolvePackage('protobufjs', [openApi.directory]);
  const openApiUtf8 = resolvePackage('@protobufjs/utf8', [openApiProtobuf.directory]);
  const openApiUuid = resolvePackage('uuid', [openApi.directory]);
  const tosAxios = resolvePackage('axios', [tosSdk.directory]);
  const tosAdapter = resolvePackage('axios-adapter-uniapp', [tosSdk.directory]);
  const tosAdapterAxios = resolvePackage('axios', [tosAdapter.directory]);
  const tosLodash = resolvePackage('lodash', [tosSdk.directory]);
  const tosProxyMiddleware = resolvePackage('http-proxy-middleware', [tosSdk.directory]);
  const followRedirects = resolvePackage('follow-redirects', [openApiAxios.directory]);

  assert.strictEqual(openApi.package.version, '1.36.2');
  assert.strictEqual(tosSdk.package.version, '2.9.1');
  assert.strictEqual(directAxios.package.version, '1.20.0');
  assert.strictEqual(openApiAxios.package.version, '0.33.0');
  assert.strictEqual(openApiFormData.package.version, '3.0.5');
  assert.strictEqual(openApiAxiosFormData.package.version, '4.0.6');
  assert.strictEqual(openApiProtobuf.package.version, '7.6.6');
  assert.strictEqual(openApiUtf8.package.version, '1.1.2');
  assert.strictEqual(openApiUuid.package.version, '11.1.1');
  assert.strictEqual(tosAxios.package.version, '0.33.0');
  assert.strictEqual(tosAdapterAxios.package.version, '0.33.0');
  assert.strictEqual(tosLodash.package.version, '4.18.1');
  assert.strictEqual(tosProxyMiddleware.package.version, '2.0.10');
  assert.strictEqual(followRedirects.package.version, '1.16.0');

  assert.deepStrictEqual(appPackage.overrides?.['@volcengine/openapi'], {
    axios: { '.': '0.33.0', 'form-data': '4.0.6' },
    'form-data': '3.0.5',
    protobufjs: '7.6.6',
    uuid: '11.1.1'
  });
  assert.deepStrictEqual(appPackage.overrides?.['@volcengine/tos-sdk'], {
    axios: '0.33.0',
    'axios-adapter-uniapp': { axios: '0.33.0' },
    'http-proxy-middleware': '2.0.10',
    lodash: '4.18.1'
  });

  const protobuf = require(openApiProtobuf.entry);
  const fixtureType = new protobuf.Type('SecurityFixture')
    .add(new protobuf.Field('label', 1, 'string'))
    .add(new protobuf.Field('count', 2, 'uint32'));
  const encoded = fixtureType.encode({ label: '安全兼容', count: 7 }).finish();
  const decoded = fixtureType.decode(encoded);
  assert.strictEqual(decoded.label, '安全兼容');
  assert.strictEqual(decoded.count, 7);

  const uuid = require(openApiUuid.entry);
  assert.match(uuid.v4(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

  const requests = [];
  const server = http.createServer(async (request, response) => {
    const body = await readBody(request);
    requests.push({
      method: request.method,
      url: request.url,
      headers: request.headers,
      body
    });
    if (request.method === 'PUT') {
      response.writeHead(200, {
        etag: '"fixture-etag"',
        'x-tos-request-id': 'fixture-request-id',
        'x-tos-id-2': 'fixture-id-2'
      });
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ code: 10000, data: { task_id: 'fixture-task' } }));
  });

  const environmentKeys = [
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'ALL_PROXY',
    'NO_PROXY',
    'VOLC_PROXY_HOST',
    'VOLC_PROXY_PORT'
  ];
  const previousEnvironment = snapshotEnvironment(environmentKeys);
  const address = await listen(server);
  try {
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    delete process.env.ALL_PROXY;
    delete process.env.VOLC_PROXY_HOST;
    delete process.env.VOLC_PROXY_PORT;
    process.env.NO_PROXY = '127.0.0.1,localhost';

    const axiosImport = require(directAxios.entry);
    const axios = axiosImport.default || axiosImport;
    const directResponse = await axios.get(`http://127.0.0.1:${address.port}/direct-axios`, {
      proxy: false,
      timeout: 3000,
      maxContentLength: 64 * 1024
    });
    assert.strictEqual(directResponse.data.code, 10000);

    const openApiImport = require(openApi.entry);
    const Service = openApiImport.Service || openApiImport.default?.Service || openApiImport.default;
    const service = new Service({
      serviceName: 'cv',
      region: 'cn-north-1',
      host: `127.0.0.1:${address.port}`,
      protocol: 'http:',
      accessKeyId: 'fixture-access-key',
      secretKey: 'fixture-secret-key'
    });
    const jsonApi = service.createJSONAPI('FixtureJSON', { Version: '2022-08-31' });
    const jsonResult = await jsonApi({ req_key: 'fixture-json', count: 1 }, { timeout: 3000 });
    assert.strictEqual(jsonResult.data.task_id, 'fixture-task');

    const formApi = service.createFormDataAPI('FixtureForm', { Version: '2022-08-31' });
    const formResult = await formApi({ label: 'fixture-form' }, { timeout: 3000 });
    assert.strictEqual(formResult.data.task_id, 'fixture-task');

    const tosImport = require(tosSdk.entry);
    const TosClient = tosImport.default || tosImport;
    const tos = new TosClient({
      accessKeyId: 'fixture-access-key',
      accessKeySecret: 'fixture-secret-key',
      region: 'cn-beijing',
      endpoint: `127.0.0.1:${address.port}`,
      secure: false,
      forcePathStyle: true,
      requestTimeout: 3000,
      connectionTimeout: 3000,
      maxRetryCount: 0
    });
    const tosResult = await tos.putObject({
      bucket: 'fixture-bucket',
      key: 'fixture/object.txt',
      body: Buffer.from('fixture-body', 'utf8'),
      contentType: 'text/plain'
    });
    assert.strictEqual(tosResult.requestId, 'fixture-request-id');

    const directRequest = requests.find((item) => item.url === '/direct-axios');
    const jsonRequest = requests.find((item) => item.url?.includes('Action=FixtureJSON'));
    const formRequest = requests.find((item) => item.url?.includes('Action=FixtureForm'));
    const tosRequest = requests.find((item) => item.method === 'PUT');
    assert(directRequest, '根 Axios 1.20 请求必须到达本地 upstream');
    assert(jsonRequest, 'OpenAPI JSON 签名请求必须到达本地 upstream');
    assert(formRequest, 'OpenAPI multipart 签名请求必须到达本地 upstream');
    assert(tosRequest, 'TOS putObject 签名请求必须到达本地 upstream');
    assert.match(String(jsonRequest.headers.authorization || ''), /^HMAC-SHA256 /);
    assert.match(String(jsonRequest.headers['content-type'] || ''), /^application\/json/i);
    assert.deepStrictEqual(JSON.parse(jsonRequest.body.toString('utf8')), {
      req_key: 'fixture-json',
      count: 1
    });
    assert.match(String(formRequest.headers['content-type'] || ''), /^multipart\/form-data; boundary=/i);
    assert(formRequest.body.includes(Buffer.from('fixture-form', 'utf8')));
    assert.strictEqual(tosRequest.body.toString('utf8'), 'fixture-body');
    assert.match(String(tosRequest.headers.authorization || ''), /^TOS4-HMAC-SHA256 /);

    console.log(
      '[OK] Volcengine OpenAPI 1.36.2 / TOS 2.9.1 在安全覆盖依赖上通过 '
      + 'Axios、JSON/multipart 签名、TOS putObject、protobuf 与 UUID 契约。'
    );
  } finally {
    restoreEnvironment(previousEnvironment);
    await closeServer(server);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
