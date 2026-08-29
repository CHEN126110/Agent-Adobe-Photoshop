#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ROOT = path.resolve(__dirname, "..");
const EXPECTED_SHARP_VERSION = "0.35.4";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function collectTypeScriptFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolutePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTypeScriptFiles(absolutePath));
      continue;
    }
    if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      files.push(absolutePath);
    }
  }
  return files;
}

function buildRgbaFixture(width, height) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      pixels[offset] = 20 + x * 30;
      pixels[offset + 1] = 40 + y * 35;
      pixels[offset + 2] = 180 - x * 10;
      pixels[offset + 3] = x === 0 && y === 0 ? 96 : 255;
    }
  }
  return pixels;
}

async function verifyModuleEntrypoints() {
  assert.strictEqual(typeof sharp, "function", "Sharp CommonJS entry must export the constructor.");
  const esm = await import("sharp");
  assert.strictEqual(typeof esm.default, "function", "Sharp ESM entry must expose the default constructor.");
  assert.strictEqual(
    esm.default.versions.sharp,
    EXPECTED_SHARP_VERSION,
    "Sharp ESM and CommonJS entries must resolve the same runtime."
  );
}

async function verifyImagePipelines() {
  const width = 6;
  const height = 4;
  const raw = buildRgbaFixture(width, height);
  const png = await sharp(raw, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 6 })
    .toBuffer();
  const pngMetadata = await sharp(png, { failOn: "error" }).metadata();
  assert.deepStrictEqual(
    { format: pngMetadata.format, width: pngMetadata.width, height: pngMetadata.height, channels: pngMetadata.channels },
    { format: "png", width, height, channels: 4 },
    "PNG encode/decode metadata changed."
  );

  const jpeg = await sharp(png, { failOn: "none" })
    .flatten({ background: "#ffffff" })
    .resize(3, 2, { fit: "fill" })
    .jpeg({ quality: 88 })
    .toBuffer();
  const jpegMetadata = await sharp(jpeg).metadata();
  assert.deepStrictEqual(
    { format: jpegMetadata.format, width: jpegMetadata.width, height: jpegMetadata.height },
    { format: "jpeg", width: 3, height: 2 },
    "JPEG resize pipeline changed."
  );

  const webp = await sharp(png).webp({ quality: 80 }).toBuffer();
  const webpMetadata = await sharp(webp).metadata();
  assert.strictEqual(webpMetadata.format, "webp", "WebP codec is unavailable.");

  const sharpened = await sharp(png)
    .sharpen({ sigma: 1.1, m1: 1, m2: 2.5, x1: 2, y2: 10, y3: 20 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.deepStrictEqual(
    { width: sharpened.info.width, height: sharpened.info.height, channels: sharpened.info.channels },
    { width, height, channels: 4 },
    "Fine-grained sharpen output shape changed."
  );

  const overlay = await sharp({
    create: { width: 2, height: 2, channels: 4, background: { r: 255, g: 40, b: 20, alpha: 0.5 } }
  }).png().toBuffer();
  const composite = await sharp(png)
    .composite([{ input: overlay, left: 2, top: 1 }])
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.deepStrictEqual(
    { width: composite.info.width, height: composite.info.height, channels: composite.info.channels },
    { width, height, channels: 4 },
    "Composite pipeline output shape changed."
  );
}

function verifyInstalledRuntime() {
  const packageJson = readJson(path.join(ROOT, "package.json"));
  assert.strictEqual(packageJson.dependencies.sharp, "^0.35.4", "package.json must select the Sharp 0.35 security line.");
  assert.strictEqual(sharp.versions.sharp, EXPECTED_SHARP_VERSION, "Unexpected installed Sharp runtime version.");
  assert.match(sharp.versions.vips || "", /^8\.18\./, "Sharp 0.35 must load the bundled libvips 8.18 line.");
  if (process.platform === "win32" && process.arch === "x64") {
    const nativePackage = readJson(path.join(
      ROOT,
      "node_modules",
      "@img",
      "sharp-win32-x64",
      "package.json"
    ));
    assert.strictEqual(nativePackage.version, EXPECTED_SHARP_VERSION, "Windows x64 Sharp binary is out of sync.");
  }
}

function verifyRemovedApiIsAbsent() {
  const removedProperty = "failOn" + "Error";
  const sourceRoot = path.join(ROOT, "src", "main");
  const offenders = collectTypeScriptFiles(sourceRoot)
    .filter((filePath) => fs.readFileSync(filePath, "utf8").includes(removedProperty))
    .map((filePath) => path.relative(ROOT, filePath).replace(/\\/g, "/"));
  assert.deepStrictEqual(offenders, [], `Removed Sharp constructor property remains in: ${offenders.join(", ")}`);
}

async function main() {
  verifyInstalledRuntime();
  verifyRemovedApiIsAbsent();
  await verifyModuleEntrypoints();
  await verifyImagePipelines();
  console.log(JSON.stringify({
    success: true,
    sharp: sharp.versions.sharp,
    libvips: sharp.versions.vips,
    entrypoints: ["commonjs", "esm"],
    codecs: ["png", "jpeg", "webp"],
    operations: ["raw", "resize", "flatten", "sharpen", "composite"]
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
