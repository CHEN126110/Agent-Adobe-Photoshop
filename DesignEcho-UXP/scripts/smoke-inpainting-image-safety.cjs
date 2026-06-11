#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'src', 'tools', 'image', 'inpainting.ts');

function assert(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function main() {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const classStart = source.indexOf('export class ApplyRasterImageResultTool');
  assert(classStart >= 0, 'ApplyRasterImageResultTool should exist');
  const classBody = source.slice(classStart);

  const importChecks = [
    'assertImageBytesSafeForPhotoshop',
    'bytesFromBase64ImagePayload',
    'readFileEntryBytes',
    'arrayBufferFromBytes'
  ];

  for (const symbol of importChecks) {
    assert(
      source.includes(symbol),
      `ApplyRasterImageResultTool should use ${symbol} from image-safety before Photoshop placeEvent`
    );
  }

  assert(
    source.includes("from '../../core/image-safety'"),
    'ApplyRasterImageResultTool should import shared image-safety helpers'
  );
  assert(
    !classBody.includes('atob('),
    'ApplyRasterImageResultTool should not manually decode base64 because it bypasses shared image safety'
  );
  assert(
    classBody.includes('readFileEntryBytes(fileEntry, storage)'),
    'ApplyRasterImageResultTool should preflight filePath bytes before createSessionToken/placeEvent'
  );
  assert(
    classBody.includes('bytesFromBase64ImagePayload(params.imageData'),
    'ApplyRasterImageResultTool should decode base64 through shared image safety helper'
  );
  assert(
    classBody.includes('assertImageBytesSafeForPhotoshop(bytes'),
    'ApplyRasterImageResultTool should validate encoded bytes before temp write/placeEvent'
  );
  assert(
    classBody.includes('arrayBufferFromBytes(bytes'),
    'ApplyRasterImageResultTool should write temporary encoded bytes through shared ArrayBuffer helper'
  );

  console.log(JSON.stringify({
    success: true,
    checks: [
      'ApplyRasterImageResultTool imports shared image-safety helpers',
      'filePath encoded image results are preflighted before Photoshop placeEvent',
      'base64 encoded image results are decoded and validated through shared image-safety',
      'manual atob decoding is not used in ApplyRasterImageResultTool'
    ]
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({
    success: false,
    error: error && error.message ? error.message : String(error),
    details: error && error.details ? error.details : undefined
  }, null, 2));
  process.exit(1);
}
