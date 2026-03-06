# AI 模型技术指南

> **适用模型**: BiRefNet, YOLO-World, SAM2, MobileSAM  
> **更新日期**: 2026-01-25  
> **推理框架**: ONNX Runtime (Node.js)

---

## 目录

1. [模型概述](#1-模型概述)
2. [BiRefNet 抠图模型](#2-birefnet-抠图模型)
3. [YOLO-World 目标检测](#3-yolo-world-目标检测)
4. [SAM2 交互式分割](#4-sam2-交互式分割)
5. [ONNX Runtime 集成](#5-onnx-runtime-集成)
6. [图像预处理](#6-图像预处理)
7. [性能优化](#7-性能优化)
8. [模型更新](#8-模型更新)

---

## 1. 模型概述

### 1.1 模型清单

| 模型 | 版本 | 大小 | 功能 |
|------|------|------|------|
| **BiRefNet** | ONNX | 928 MB | 高精度语义分割/抠图 |
| **YOLO-World** | v8s-worldv2 | 48 MB | 开放词汇目标检测 |
| **SAM2** | Large FP16 | 435 MB | 交互式分割 (Box/Point) |
| **MobileSAM** | ONNX | 38 MB | 轻量级交互分割 |

### 1.2 模型文件位置

```
DesignEcho-Agent/models/
├── birefnet/
│   ├── birefnet.onnx           # 928 MB - 主模型
│   └── birefnet_old.onnx       # 214 MB - 旧版本
├── yolo-world/
│   └── yolov8s-worldv2.onnx    # 48 MB
├── sam/
│   ├── mobile_sam_encoder.onnx # 22 MB
│   └── mobile_sam_decoder.onnx # 16 MB
└── sam2/
    ├── vision_encoder_fp16.onnx
    ├── vision_encoder_fp16.onnx_data   # 424 MB
    ├── prompt_encoder_mask_decoder_fp16.onnx
    └── prompt_encoder_mask_decoder_fp16.onnx_data
```

---

## 2. BiRefNet 抠图模型

### 2.1 模型简介

**BiRefNet (Bilateral Reference Network)** 是一种高精度显著性目标检测模型，特别擅长：
- 毛发边缘处理
- 透明物体分割
- 复杂背景分离

### 2.2 技术规格

| 参数 | 值 |
|------|-----|
| 输入尺寸 | 1024 × 1024 × 3 (RGB) |
| 输出尺寸 | 1024 × 1024 × 1 (Mask) |
| 数据格式 | Float32, NCHW |
| 归一化 | ImageNet (mean/std) |

### 2.3 预处理代码

```typescript
// matting-service.ts
const BIREFNET_INPUT_SIZE = 1024;
const IMAGENET_MEAN = [0.485, 0.456, 0.406];
const IMAGENET_STD = [0.229, 0.224, 0.225];

async function preprocessImage(imageBuffer: Buffer): Promise<Float32Array> {
    const sharp = (await import('sharp')).default;
    
    // 1. 调整尺寸
    const resized = await sharp(imageBuffer)
        .resize(BIREFNET_INPUT_SIZE, BIREFNET_INPUT_SIZE, { fit: 'fill' })
        .removeAlpha()
        .raw()
        .toBuffer();
    
    // 2. 转换为 Float32 并归一化
    const float32Data = new Float32Array(3 * 1024 * 1024);
    
    for (let i = 0; i < 1024 * 1024; i++) {
        // RGB → CHW 格式
        float32Data[i] = (resized[i * 3] / 255 - IMAGENET_MEAN[0]) / IMAGENET_STD[0];
        float32Data[1024 * 1024 + i] = (resized[i * 3 + 1] / 255 - IMAGENET_MEAN[1]) / IMAGENET_STD[1];
        float32Data[2 * 1024 * 1024 + i] = (resized[i * 3 + 2] / 255 - IMAGENET_MEAN[2]) / IMAGENET_STD[2];
    }
    
    return float32Data;
}
```

### 2.4 推理代码

```typescript
async function runBiRefNet(imageBuffer: Buffer): Promise<Buffer> {
    const ort = await import('onnxruntime-node');
    
    // 1. 加载模型
    const session = await ort.InferenceSession.create('models/birefnet/birefnet.onnx');
    
    // 2. 预处理
    const inputData = await preprocessImage(imageBuffer);
    const inputTensor = new ort.Tensor('float32', inputData, [1, 3, 1024, 1024]);
    
    // 3. 推理
    const results = await session.run({ input: inputTensor });
    
    // 4. 后处理
    const outputData = results.output.data as Float32Array;
    const maskBuffer = Buffer.alloc(1024 * 1024);
    
    for (let i = 0; i < outputData.length; i++) {
        // Sigmoid 激活 + 量化到 0-255
        const sigmoid = 1 / (1 + Math.exp(-outputData[i]));
        maskBuffer[i] = Math.round(sigmoid * 255);
    }
    
    return maskBuffer;
}
```

### 2.5 适用场景

- ✅ 产品抠图（电商）
- ✅ 人像分割
- ✅ 毛发边缘
- ⚠️ 不支持用户指定目标（自动检测显著物体）

---

## 3. YOLO-World 目标检测

### 3.1 模型简介

**YOLO-World** 是开放词汇目标检测模型，可以根据文本描述检测任意物体。

### 3.2 技术规格

| 参数 | 值 |
|------|-----|
| 输入尺寸 | 640 × 640 × 3 (RGB) |
| 输出格式 | 边界框 + 置信度 + 类别 |
| 文本编码 | CLIP 文本编码器 |

### 3.3 使用方式

```typescript
const YOLO_INPUT_SIZE = 640;
const YOLO_CONF_THRESHOLD = 0.25;
const YOLO_IOU_THRESHOLD = 0.45;

interface DetectionBox {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    confidence: number;
    label: string;
}

async function detectObjects(
    imageBuffer: Buffer, 
    textPrompts: string[]  // 如 ['袜子', '鞋子']
): Promise<DetectionBox[]> {
    // 1. 图像预处理
    const imageData = await preprocessForYolo(imageBuffer);
    
    // 2. 文本编码
    const textEmbeddings = await encodeTextPrompts(textPrompts);
    
    // 3. 推理
    const results = await yoloSession.run({
        images: imageData,
        txt_feats: textEmbeddings
    });
    
    // 4. NMS 后处理
    return applyNMS(results, YOLO_CONF_THRESHOLD, YOLO_IOU_THRESHOLD);
}
```

### 3.4 与 BiRefNet 配合

```
用户输入: "请抠出图片中的袜子"
    │
    ▼
YOLO-World: 检测"袜子"边界框
    │
    ▼
裁剪边界框区域
    │
    ▼
BiRefNet: 精细分割
    │
    ▼
合并回原图坐标
```

---

## 4. SAM2 交互式分割

### 4.1 模型简介

**SAM2 (Segment Anything Model 2)** 是 Meta 发布的交互式分割模型，支持：
- Box Prompt: 框选目标
- Point Prompt: 点击目标
- Mask Prompt: 基于已有蒙版优化

### 4.2 技术规格

| 参数 | 值 |
|------|-----|
| Vision Encoder 输入 | 1024 × 1024 × 3 |
| Mask 输出 | 256 × 256 (需放大) |
| Prompt 格式 | 归一化坐标 (0-1) |

### 4.3 Box Prompt 示例

```typescript
async function segmentWithBox(
    imageBuffer: Buffer,
    box: { x1: number; y1: number; x2: number; y2: number }
): Promise<Buffer> {
    // 1. 编码图像
    const imageEmbedding = await visionEncoder.run({ image: imageData });
    
    // 2. 准备 Box Prompt (归一化坐标)
    const normalizedBox = new Float32Array([
        box.x1 / imageWidth,
        box.y1 / imageHeight,
        box.x2 / imageWidth,
        box.y2 / imageHeight
    ]);
    
    // 3. 解码蒙版
    const result = await maskDecoder.run({
        image_embeddings: imageEmbedding,
        point_coords: normalizedBox,
        point_labels: new Float32Array([2, 3])  // 2=左上角, 3=右下角
    });
    
    // 4. 放大到原始尺寸 (256 → 原尺寸)
    return upsampleMask(result.masks, imageWidth, imageHeight);
}
```

### 4.4 输出分辨率问题

⚠️ **SAM 原生输出仅 256×256**，放大时会有锯齿。

解决方案：
```typescript
// 高斯模糊 + 阈值
function refineSAMMask(mask256: Buffer, targetSize: number): Buffer {
    // 1. 双三次插值放大
    const upscaled = bicubicResize(mask256, targetSize);
    
    // 2. 高斯模糊消除锯齿
    const blurred = gaussianBlur(upscaled, sigma = 2.5);
    
    // 3. 阈值二值化
    return threshold(blurred, 128);
}
```

---

## 5. ONNX Runtime 集成

### 5.1 安装

```bash
npm install onnxruntime-node
```

### 5.2 基础使用

```typescript
import * as ort from 'onnxruntime-node';

// 创建会话
const session = await ort.InferenceSession.create('model.onnx', {
    executionProviders: ['cpu'],  // 或 'cuda'
    graphOptimizationLevel: 'all'
});

// 查看输入输出
console.log('Inputs:', session.inputNames);
console.log('Outputs:', session.outputNames);

// 创建张量
const tensor = new ort.Tensor('float32', data, [1, 3, 224, 224]);

// 推理
const results = await session.run({ input_name: tensor });
```

### 5.3 GPU 加速

```typescript
// CUDA (NVIDIA)
const session = await ort.InferenceSession.create('model.onnx', {
    executionProviders: ['cuda', 'cpu']  // 优先 CUDA，回退 CPU
});

// DirectML (Windows)
const session = await ort.InferenceSession.create('model.onnx', {
    executionProviders: ['dml', 'cpu']
});
```

### 5.4 内存管理

```typescript
// 释放会话
session.release();

// 释放张量
tensor.dispose();
```

---

## 6. 图像预处理

### 6.1 使用 Sharp

```typescript
import sharp from 'sharp';

// 调整尺寸 + 获取原始像素
const { data, info } = await sharp(imageBuffer)
    .resize(1024, 1024, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

console.log(info);  // { width: 1024, height: 1024, channels: 3 }
```

### 6.2 HWC → CHW 转换

```typescript
// Sharp 输出: HWC (Height × Width × Channels)
// ONNX 输入: CHW (Channels × Height × Width)

function hwcToChw(hwcData: Buffer, width: number, height: number): Float32Array {
    const chw = new Float32Array(3 * width * height);
    
    for (let h = 0; h < height; h++) {
        for (let w = 0; w < width; w++) {
            const hwcIdx = (h * width + w) * 3;
            const pixelIdx = h * width + w;
            
            chw[pixelIdx] = hwcData[hwcIdx] / 255;                    // R
            chw[width * height + pixelIdx] = hwcData[hwcIdx + 1] / 255;  // G
            chw[2 * width * height + pixelIdx] = hwcData[hwcIdx + 2] / 255;  // B
        }
    }
    
    return chw;
}
```

### 6.3 ImageNet 归一化

```typescript
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

function normalize(data: Float32Array, width: number, height: number): Float32Array {
    const size = width * height;
    
    for (let c = 0; c < 3; c++) {
        for (let i = 0; i < size; i++) {
            data[c * size + i] = (data[c * size + i] - MEAN[c]) / STD[c];
        }
    }
    
    return data;
}
```

---

## 7. 性能优化

### 7.1 模型延迟加载

```typescript
class MattingService {
    private session: ort.InferenceSession | null = null;
    
    async ensureLoaded(): Promise<void> {
        if (!this.session) {
            console.log('[Model] Loading BiRefNet...');
            this.session = await ort.InferenceSession.create('birefnet.onnx');
        }
    }
    
    async removeBackground(image: Buffer): Promise<Buffer> {
        await this.ensureLoaded();
        // ...推理
    }
}
```

### 7.2 批处理

```typescript
// 多张图片一起推理
const batchSize = 4;
const batchTensor = new ort.Tensor('float32', batchData, [batchSize, 3, 1024, 1024]);
```

### 7.3 Worker Threads

```typescript
import { Worker } from 'worker_threads';

// 主线程
const worker = new Worker('./inference-worker.js');
worker.postMessage({ imageBuffer });
worker.on('message', (mask) => {
    // 处理结果
});

// inference-worker.js
parentPort.on('message', async ({ imageBuffer }) => {
    const mask = await runInference(imageBuffer);
    parentPort.postMessage(mask);
});
```

### 7.4 缓存策略

```typescript
// 缓存图像嵌入（SAM2）
const embeddingCache = new Map<string, Float32Array>();

async function getImageEmbedding(imageHash: string, imageBuffer: Buffer) {
    if (embeddingCache.has(imageHash)) {
        return embeddingCache.get(imageHash)!;
    }
    
    const embedding = await visionEncoder.run({ image: imageBuffer });
    embeddingCache.set(imageHash, embedding);
    
    return embedding;
}
```

---

## 8. 模型更新

### 8.1 模型下载脚本

```powershell
# scripts/download-models.ps1
$models = @{
    "birefnet" = "https://huggingface.co/..."
    "yolo-world" = "https://huggingface.co/..."
}

foreach ($name in $models.Keys) {
    $url = $models[$name]
    $path = "models/$name"
    
    if (!(Test-Path $path)) {
        Write-Host "Downloading $name..."
        Invoke-WebRequest -Uri $url -OutFile "$path.onnx"
    }
}
```

### 8.2 模型验证

```typescript
async function validateModel(modelPath: string): Promise<boolean> {
    try {
        const session = await ort.InferenceSession.create(modelPath);
        console.log(`✅ ${modelPath} - Inputs: ${session.inputNames}`);
        session.release();
        return true;
    } catch (error) {
        console.error(`❌ ${modelPath} - ${error.message}`);
        return false;
    }
}
```

---

## 附录

### A. 模型来源

| 模型 | 来源 | License |
|------|------|---------|
| BiRefNet | [ZhengPeng7/BiRefNet](https://github.com/ZhengPeng7/BiRefNet) | MIT |
| YOLO-World | [AILab-CVC/YOLO-World](https://github.com/AILab-CVC/YOLO-World) | GPL-3.0 |
| SAM2 | [facebookresearch/segment-anything-2](https://github.com/facebookresearch/segment-anything-2) | Apache-2.0 |

### B. ONNX 导出

```python
# PyTorch → ONNX
import torch

model = load_model()
dummy_input = torch.randn(1, 3, 1024, 1024)

torch.onnx.export(
    model,
    dummy_input,
    "model.onnx",
    opset_version=17,
    input_names=['input'],
    output_names=['output'],
    dynamic_axes={'input': {0: 'batch'}}
)
```

### C. 参考资源

- [ONNX Runtime 文档](https://onnxruntime.ai/docs/)
- [BiRefNet Paper](https://arxiv.org/abs/2401.03407)
- [SAM2 Paper](https://arxiv.org/abs/2408.00714)
- [YOLO-World Paper](https://arxiv.org/abs/2401.17270)

---

> **文档维护**: 请在模型更新后同步更新此文档
