#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
  BoundedBinaryMessageStore,
  validateIncomingBinaryFrame
} = require(path.resolve(__dirname, '..', 'src', 'main', 'websocket', 'binary-message-store.ts'));
const {
  BinaryMessageType,
  createBinaryMessage
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'binary-protocol.ts'));
const { WebSocketServer } = require(
  path.resolve(__dirname, '..', 'src', 'main', 'websocket', 'server.ts')
);

function rawHeader(requestId, width, height, type = BinaryMessageType.RAW_RGBA) {
  return { requestId, width, height, type };
}

async function main() {
  const validRaw = validateIncomingBinaryFrame(
    rawHeader(1, 2, 2),
    Buffer.alloc(2 * 2 * 4)
  );
  assert.strictEqual(validRaw.ok, true);

  const rawMismatch = validateIncomingBinaryFrame(
    rawHeader(2, 2, 2),
    Buffer.alloc(15)
  );
  assert.strictEqual(rawMismatch.ok, false);
  assert.strictEqual(rawMismatch.code, 'binary_raw_geometry_mismatch');

  const oversized = validateIncomingBinaryFrame(
    rawHeader(3, 3, 3, BinaryMessageType.PNG),
    Buffer.alloc(11),
    { maxFrameBytes: 10, maxDimension: 10, maxPixels: 100 }
  );
  assert.strictEqual(oversized.ok, false);
  assert.strictEqual(oversized.code, 'binary_frame_budget_exceeded');

  const tooManyPixels = validateIncomingBinaryFrame(
    rawHeader(4, 11, 10, BinaryMessageType.PNG),
    Buffer.alloc(5),
    { maxFrameBytes: 10, maxDimension: 20, maxPixels: 100 }
  );
  assert.strictEqual(tooManyPixels.ok, false);
  assert.strictEqual(tooManyPixels.code, 'binary_pixel_budget_exceeded');

  let now = 100;
  const store = new BoundedBinaryMessageStore({
    maxEntries: 2,
    maxBytes: 10,
    ttlMs: 1000,
    now: () => now,
    scheduleCleanup: false
  });
  assert.deepStrictEqual(store.put({
    header: rawHeader(10, 1, 1), imageData: Buffer.alloc(4), timestamp: now
  }), { accepted: true });
  assert.deepStrictEqual(store.put({
    header: rawHeader(11, 1, 1, BinaryMessageType.PNG), imageData: Buffer.alloc(5), timestamp: now
  }), { accepted: true });
  const capacityRejected = store.put({
    header: rawHeader(12, 1, 1, BinaryMessageType.PNG), imageData: Buffer.alloc(2), timestamp: now
  });
  assert.strictEqual(capacityRejected.accepted, false);
  assert.deepStrictEqual(
    { entries: store.getDiagnostics().entryCount, bytes: store.getDiagnostics().residentBytes },
    { entries: 2, bytes: 9 }
  );
  assert(store.takeRejection(12)?.reason.includes('暂存区已满'));

  const consumed = store.take(10);
  assert.strictEqual(consumed?.imageData.length, 4);
  assert.strictEqual(store.take(10), undefined);
  assert.strictEqual(store.getDiagnostics().residentBytes, 5);
  assert.strictEqual(store.put({
    header: rawHeader(12, 1, 1, BinaryMessageType.PNG), imageData: Buffer.alloc(5), timestamp: now
  }).accepted, true);
  assert.strictEqual(store.getDiagnostics().residentBytes, 10);

  // 同 requestId 替换必须先释放旧 Buffer，不能把 residentBytes 重复相加。
  assert.strictEqual(store.put({
    header: rawHeader(11, 1, 1, BinaryMessageType.PNG), imageData: Buffer.alloc(2), timestamp: now
  }).accepted, true);
  assert.strictEqual(store.getDiagnostics().residentBytes, 7);

  now += 1000;
  store.pruneExpired(now);
  assert.deepStrictEqual(
    { entries: store.getDiagnostics().entryCount, bytes: store.getDiagnostics().residentBytes },
    { entries: 0, bytes: 0 }
  );

  // 真实 WebSocket owner：二进制先到时进入唯一缓存，JSON waiter 随后只消费一次。
  const server = new WebSocketServer(0);
  const firstFrame = createBinaryMessage(
    BinaryMessageType.RAW_RGBA,
    101,
    2,
    2,
    Buffer.alloc(16, 7)
  );
  await server.handleBinaryMessage(firstFrame, {});
  assert.strictEqual(server.getConnectionDiagnostics().binaryCache.entryCount, 1);
  const firstRead = await server.waitForBinaryData(101, 100);
  assert.strictEqual(firstRead?.imageData.length, 16);
  assert.strictEqual(server.getConnectionDiagnostics().binaryCache.entryCount, 0);

  // JSON waiter 先到时直接交付，不经过缓存。
  const waiting = server.waitForBinaryData(102, 1000);
  await server.handleBinaryMessage(createBinaryMessage(
    BinaryMessageType.RAW_MASK,
    102,
    2,
    2,
    Buffer.alloc(4, 1)
  ), {});
  const waited = await waiting;
  assert.strictEqual(waited?.header.type, BinaryMessageType.RAW_MASK);
  assert.strictEqual(server.getConnectionDiagnostics().binaryCache.entryCount, 0);

  // 非法 RAW 帧必须立即形成拒绝事实；后来的 JSON 请求不能再空等完整超时。
  await server.handleBinaryMessage(createBinaryMessage(
    BinaryMessageType.RAW_RGBA,
    103,
    2,
    2,
    Buffer.alloc(15)
  ), {});
  await assert.rejects(
    server.waitForBinaryData(103, 1000),
    (error) => error.code === 'binary_raw_geometry_mismatch'
      && /RAW 二进制字节数/.test(error.message)
  );
  assert.strictEqual(server.getConnectionDiagnostics().binaryCache.entryCount, 0);

  // JSON waiter 先到、非法帧后到：错误直接交给 waiter，不在 rejection store 留第二份污染。
  const rejectedWhileWaiting = server.waitForBinaryData(104, 1000);
  await server.handleBinaryMessage(createBinaryMessage(
    BinaryMessageType.RAW_RGBA,
    104,
    2,
    2,
    Buffer.alloc(15)
  ), {});
  await assert.rejects(
    rejectedWhileWaiting,
    (error) => error.code === 'binary_raw_geometry_mismatch'
  );
  assert.strictEqual(server.getConnectionDiagnostics().binaryCache.rejectedCount, 0);

  // 同一 requestId 的失败已经消费后可以接收新的合法帧，不能被 30 秒旧拒绝再次拦截。
  const retryAfterConsumedRejection = server.waitForBinaryData(104, 1000);
  await server.handleBinaryMessage(createBinaryMessage(
    BinaryMessageType.RAW_RGBA,
    104,
    2,
    2,
    Buffer.alloc(16, 9)
  ), {});
  assert.strictEqual((await retryAfterConsumedRejection).imageData.length, 16);

  await assert.rejects(
    server.waitForBinaryData(105, 10),
    (error) => error.code === 'binary_wait_timeout' && /10ms/.test(error.message)
  );

  const disconnectedWaiter = server.waitForBinaryData(106, 1000);
  server.stop();
  await assert.rejects(
    disconnectedWaiter,
    (error) => error.code === 'binary_request_terminated'
  );

  assert.strictEqual(server.getConnectionDiagnostics().binaryCache.residentBytes, 0);

  console.log('[OK] 二进制消息单一 owner、几何校验、容量上限、消费释放与 TTL 验证通过。');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
