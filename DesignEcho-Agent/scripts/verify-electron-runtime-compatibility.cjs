#!/usr/bin/env node
"use strict";

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const ELECTRON_CHILD_ARGUMENT = '--electron-runtime-contract-child';
const EXPECTED_ELECTRON_MAJOR = 44;
const EXPECTED_NODE_MAJOR = 24;

function parseMajor(version) {
  return Number.parseInt(String(version || '').split('.')[0], 10);
}

function runElectronChild() {
  const electronExecutable = require('electron');
  const result = spawnSync(electronExecutable, [__filename, ELECTRON_CHILD_ARGUMENT], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
    },
    stdio: 'inherit',
    timeout: 30000,
    windowsHide: true
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

async function verifyElectronRuntime() {
  const { app, clipboard, nativeImage } = require('electron');
  await app.whenReady();

  assert.strictEqual(
    parseMajor(process.versions.electron),
    EXPECTED_ELECTRON_MAJOR,
    `Electron Runtime 必须为 ${EXPECTED_ELECTRON_MAJOR}.x，当前 ${process.versions.electron}`
  );
  assert.strictEqual(
    parseMajor(process.versions.node),
    EXPECTED_NODE_MAJOR,
    `Electron 内嵌 Node 必须为 ${EXPECTED_NODE_MAJOR}.x，当前 ${process.versions.node}`
  );
  assert.strictEqual(typeof clipboard.read, 'function', 'Electron 44 clipboard.read() 必须可用');
  assert.strictEqual(clipboard.readImage, undefined, '不得恢复 Electron 44 已删除的 clipboard.readImage()');

  const clipboardItems = await clipboard.read();
  assert(Array.isArray(clipboardItems), 'clipboard.read() 必须返回 ClipboardItem 数组');

  const handlersPath = path.resolve(
    __dirname,
    '..',
    'dist',
    'main',
    'main',
    'uxp-handlers',
    'webview-handlers.js'
  );
  const {
    decodeClipboardImageItems,
    flattenImageToWhite
  } = require(handlersPath);

  const pngSource = nativeImage.createFromBitmap(
    Buffer.from([20, 30, 40, 255]),
    { width: 1, height: 1 }
  );
  const jpegSource = nativeImage.createFromBitmap(
    Buffer.from([90, 100, 110, 255]),
    { width: 1, height: 1 }
  );
  const requestedTypes = [];
  const decoded = await decodeClipboardImageItems([
    {
      types: ['image/jpeg'],
      getType: async (type) => {
        requestedTypes.push(type);
        return new Blob([jpegSource.toJPEG(100)], { type: 'image/jpeg' });
      }
    },
    {
      types: ['image/png'],
      getType: async (type) => {
        requestedTypes.push(type);
        return new Blob([pngSource.toPNG()], { type: 'image/png' });
      }
    }
  ]);
  assert(decoded && !decoded.isEmpty(), 'ClipboardItem 图片必须解码为 NativeImage');
  assert.deepStrictEqual(requestedTypes, ['image/png'], '有 PNG 时必须优先读取 PNG，不提前降级 JPEG');
  assert.deepStrictEqual(
    Array.from(decoded.toBitmap()),
    [20, 30, 40, 255],
    'PNG ClipboardItem 解码后像素必须保持一致'
  );

  const transparentRed = nativeImage.createFromBitmap(
    Buffer.from([0, 0, 128, 128]),
    { width: 1, height: 1 }
  );
  const flattened = flattenImageToWhite(transparentRed);
  assert.deepStrictEqual(
    Array.from(flattened.toBitmap()),
    [127, 127, 255, 255],
    'sRGB BGRA 预乘像素必须按白底合成且输出不透明'
  );

  console.log(
    `[OK] Electron ${process.versions.electron} / Node ${process.versions.node} `
      + 'ClipboardItem、PNG 优先与 sRGB 白底像素契约通过。'
  );
}

if (!process.versions.electron) {
  runElectronChild();
} else if (process.argv.includes(ELECTRON_CHILD_ARGUMENT)) {
  verifyElectronRuntime()
    .then(() => appExit(0))
    .catch((error) => {
      console.error(error);
      appExit(1);
    });
} else {
  throw new Error('Electron Runtime 兼容性验证必须由 Node launcher 或显式 child 参数启动。');
}

function appExit(code) {
  const { app } = require('electron');
  app.exit(code);
}
