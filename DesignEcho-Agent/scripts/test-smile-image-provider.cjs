#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

require("ts-node").register({
  transpileOnly: true,
  project: path.resolve(__dirname, "..", "tsconfig.main.json")
});

const axiosModule = require("axios");
const axios = axiosModule.default || axiosModule;
const {
  SmileAiImageService,
  isSmileAiImageModelId
} = require(path.resolve(
  __dirname,
  "..",
  "src",
  "main",
  "services",
  "smile-ai-image-service.ts"
));
const {
  syncImageProviderApiKeys
} = require(path.resolve(
  __dirname,
  "..",
  "src",
  "main",
  "services",
  "image-provider-credential-sync.ts"
));

let failures = 0;

function check(label, condition, detail) {
  if (condition) {
    console.log("  [通过] " + label + (detail ? " — " + detail : ""));
    return;
  }
  failures += 1;
  console.log("  [失败] " + label + (detail ? " — " + detail : ""));
}

async function expectProviderError(label, action, expectedStage, expectedCode) {
  let caught;
  try {
    await action();
  } catch (error) {
    caught = error;
  }
  check(label + " 会失败", !!caught);
  check(label + " 保留 provider", caught?.provider === "smile-ai", String(caught?.provider));
  check(label + " 保留 stage", caught?.errorStage === expectedStage, String(caught?.errorStage));
  if (expectedCode) {
    check(label + " 保留 code", caught?.errorCode === expectedCode, String(caught?.errorCode));
  }
}

async function withAxiosMocks(mocks, action) {
  const originalPost = axios.post;
  const originalGet = axios.get;
  axios.post = mocks.post || originalPost;
  axios.get = mocks.get || originalGet;
  try {
    return await action();
  } finally {
    axios.post = originalPost;
    axios.get = originalGet;
  }
}

function inlineImageResponse(base64) {
  return {
    status: 200,
    data: {
      candidates: [{
        content: {
          parts: [{ inlineData: { mimeType: "image/png", data: base64 } }]
        }
      }]
    }
  };
}

async function main() {
  const png = await sharp({
    create: {
      width: 16,
      height: 16,
      channels: 4,
      background: { r: 210, g: 150, b: 120, alpha: 1 }
    }
  }).png().toBuffer();
  const jpegReference = await sharp({
    create: {
      width: 12,
      height: 18,
      channels: 3,
      background: { r: 30, g: 90, b: 160 }
    }
  }).jpeg().toBuffer();
  const outputBase64 = png.toString("base64");

  console.log("=== 模型身份与凭据生命周期 ===");
  check(
    "三个 Smile 图像模型被精确识别",
    [
      "smile-ai/gemini-3-pro-image-preview",
      "smile-ai/gemini-3.1-flash-image-preview",
      "smile-ai/gpt-image-2"
    ].every(isSmileAiImageModelId)
  );
  check("未知模型不归 Smile Provider", !isSmileAiImageModelId("smile-ai/not-real"));

  const credentialCalls = { openrouter: [], smileAi: [] };
  const targets = {
    openrouter: { setApiKey: (value) => credentialCalls.openrouter.push(value) },
    smileAi: { setApiKey: (value) => credentialCalls.smileAi.push(value) }
  };
  const smileOnly = syncImageProviderApiKeys({ smileAi: "smile-key" }, targets);
  check(
    "只更新 Smile Key 不会依赖 OpenRouter",
    smileOnly.join(",") === "smileAi"
      && credentialCalls.openrouter.length === 0
      && credentialCalls.smileAi[0] === "smile-key"
  );
  const clearOpenRouter = syncImageProviderApiKeys({ openrouter: "" }, targets);
  check(
    "空字符串能独立清空 OpenRouter",
    clearOpenRouter.join(",") === "openrouter"
      && credentialCalls.openrouter[0] === ""
      && credentialCalls.smileAi.length === 1
  );

  const service = new SmileAiImageService();
  await expectProviderError(
    "未配置 Key",
    () => service.generateImage("test"),
    "provider-validate"
  );
  service.setApiKey("test-smile-key");
  await expectProviderError(
    "未知模型",
    () => service.generateImage("test", { model: "smile-ai/not-real" }),
    "provider-validate",
    "unsupported_model"
  );
  await expectProviderError(
    "未知比例",
    () => service.generateImage("test", { aspectRatio: "7:5" }),
    "provider-validate",
    "unsupported_aspect_ratio"
  );
  await expectProviderError(
    "损坏参考图",
    () => service.generateImage("test", { referenceImages: [Buffer.from("not-an-image")] }),
    "provider-validate",
    "invalid_input_image"
  );

  console.log("\n=== Gemini 原生请求契约 ===");
  let bananaRequest;
  const bananaResult = await withAxiosMocks({
    post: async (url, body, config) => {
      bananaRequest = { url, body, config };
      return inlineImageResponse(outputBase64);
    }
  }, () => service.generateFromImage(
    "preserve product details",
    png,
    {
      model: "smile-ai/gemini-3-pro-image-preview",
      imageSize: "4K",
      aspectRatio: "16:9",
      referenceImages: [jpegReference]
    }
  ));
  check(
    "档位进入模型名后缀",
    bananaRequest.url.includes("gemini-3-pro-image-preview-4k:generateContent"),
    bananaRequest.url
  );
  check(
    "Bearer 与 x-goog-api-key 同时存在",
    bananaRequest.config.headers.Authorization === "Bearer test-smile-key"
      && bananaRequest.config.headers["x-goog-api-key"] === "test-smile-key"
  );
  const imageConfig = bananaRequest.body.generationConfig.imageConfig;
  check(
    "比例参数精确下发且 imageSize 固定 1K",
    imageConfig.aspectRatio === "16:9" && imageConfig.imageSize === "1K",
    JSON.stringify(imageConfig)
  );
  const imageParts = bananaRequest.body.contents[0].parts.filter((part) => part.inlineData);
  check("源图与一张参考图都进入请求", imageParts.length === 2, String(imageParts.length));
  const normalizedReference = Buffer.from(imageParts[1].inlineData.data, "base64");
  check(
    "JPEG 参考图被真实转为 PNG 后才标 image/png",
    (await sharp(normalizedReference).metadata()).format === "png"
      && imageParts[1].inlineData.mimeType === "image/png"
  );
  check(
    "实际输出与请求比例不一致会产生可见复核说明",
    String(bananaResult.providerNotice || "").includes("请求比例 16:9")
  );

  console.log("\n=== GPT Image 2 路由、下载与取消 ===");
  let textRequest;
  await withAxiosMocks({
    post: async (url, body, config) => {
      textRequest = { url, body, config };
      return { status: 200, data: { data: [{ b64_json: outputBase64 }] } };
    }
  }, () => service.generateImage("make a clean background", {
    model: "smile-ai/gpt-image-2",
    aspectRatio: "16:9"
  }));
  check(
    "GPT 文生图走 generations 且比例映射到 1536x1024",
    textRequest.url.endsWith("/v1/images/generations")
      && textRequest.body.size === "1536x1024",
    textRequest.url + " " + JSON.stringify(textRequest.body)
  );

  const abortController = new AbortController();
  let downloadRequest;
  await withAxiosMocks({
    post: async () => ({
      status: 200,
      data: { data: [{ url: "https://cdn.example.test/generated.png" }] }
    }),
    get: async (url, config) => {
      downloadRequest = { url, config };
      return {
        status: 200,
        data: png,
        headers: { "content-type": "image/png" }
      };
    }
  }, () => service.generateImage("make a square", {
    model: "smile-ai/gpt-image-2",
    signal: abortController.signal
  }));
  check(
    "结果下载继承取消信号与响应体预算",
    downloadRequest.config.signal === abortController.signal
      && downloadRequest.config.maxContentLength >= 90 * 1024 * 1024
  );

  await withAxiosMocks({
    post: async () => ({
      status: 200,
      data: { data: [{ url: "http://127.0.0.1/internal.png" }] }
    })
  }, () => expectProviderError(
    "非 HTTPS 结果地址",
    () => service.generateImage("test", { model: "smile-ai/gpt-image-2" }),
    "provider-ready",
    "unsafe_result_url"
  ));

  await withAxiosMocks({
    post: async () => {
      const error = new Error("canceled");
      error.code = "ERR_CANCELED";
      error.name = "CanceledError";
      throw error;
    }
  }, () => expectProviderError(
    "用户取消",
    () => service.generateImage("test"),
    "provider-canceled",
    "canceled"
  ));

  await withAxiosMocks({
    post: async () => ({
      status: 401,
      data: { error: { code: "invalid_token", message: "invalid token" } }
    })
  }, () => expectProviderError(
    "批量全部失败",
    () => service.generateBatchFromImage("test", png, { count: 2 }),
    "provider-validate",
    "invalid_token"
  ));

  console.log("\n=== 能力声明与真实执行链一致性 ===");
  const root = path.resolve(__dirname, "..");
  const panel = fs.readFileSync(path.join(root, "public", "webview", "index.html"), "utf8");
  const uxpOptions = fs.readFileSync(
    path.join(root, "..", "DesignEcho-UXP", "src", "core", "image-generation-options.ts"),
    "utf8"
  );
  const handler = fs.readFileSync(
    path.join(root, "src", "main", "uxp-handlers", "image-to-image-handlers.ts"),
    "utf8"
  );
  const mainIndex = fs.readFileSync(path.join(root, "src", "main", "index.ts"), "utf8");
  const configHandlers = fs.readFileSync(
    path.join(root, "src", "main", "ipc-handlers", "config-handlers.ts"),
    "utf8"
  );
  for (const model of [
    "smile-ai/gemini-3-pro-image-preview",
    "smile-ai/gemini-3.1-flash-image-preview",
    "smile-ai/gpt-image-2"
  ]) {
    check(model + " 存在于面板下拉", panel.includes('data-value="' + model + '"'));
    check(model + " 存在于 UXP 档位表", uxpOptions.includes("'" + model + "':"));
  }
  check(
    "GPT Image 2 比例不会被转换成未消费的像素字段",
    /'smile-ai\/gpt-image-2'\s*:\s*\{[\s\S]*?aspectRatioTier:\s*true/.test(panel)
  );
  const pixelRangeBody = (
    /const AI_IMAGE_MODEL_PIXEL_RANGE\s*=\s*\{([\s\S]*?)\n\s*\};/.exec(panel)
    || []
  )[1] || "";
  const pixelRangeKeys = [...pixelRangeBody.matchAll(/'([^']+)'\s*:/g)].map((match) => match[1]);
  check(
    "图像模型像素能力表没有重复键",
    new Set(pixelRangeKeys).size === pixelRangeKeys.length
  );
  check(
    "OpenRouter Flash preview 有独立能力项",
    pixelRangeKeys.includes("google/gemini-3.1-flash-image-preview")
  );
  check(
    "执行收据能报告 smile-ai Provider",
    handler.includes("isSmileAiModel")
      && handler.includes("if (isSmileAiModel) return 'smile-ai'")
  );
  check(
    "启动恢复与热更新共用独立凭据同步函数",
    mainIndex.includes("syncImageProviderApiKeys({")
      && configHandlers.includes("syncImageProviderApiKeys({")
  );

  console.log("\n" + (failures === 0 ? "全部通过" : failures + " 项失败"));
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
