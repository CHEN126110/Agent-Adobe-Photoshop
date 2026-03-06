# DesignEcho 技术文档

> **版本**: 2.1.0  
> **更新日期**: 2026-01-31  
> **架构状态**: Electron + ONNX Runtime + RAG + 审美决策系统

---

## 目录

1. [项目概述](#1-项目概述)
2. [系统架构](#2-系统架构)
3. [核心服务模块](#3-核心服务模块)
4. [知识库系统](#4-知识库系统)
5. [AI 模型](#5-ai-模型)
6. [通信协议](#6-通信协议)
7. [工具注册系统](#7-工具注册系统)
8. [开发指南](#8-开发指南)

---

## 1. 项目概述

### 1.1 定位

DesignEcho 是一个 **AI 驱动的 Photoshop 设计助手**，通过 UXP 插件与 Electron 桌面端协同工作。核心理念是让 AI 具备**设计师级别的审美判断力**，而非简单的规则执行。

### 1.2 核心能力

| 功能分类 | 功能 | 描述 | 状态 |
|----------|------|------|------|
| **AI 推理** | 智能抠图 | BiRefNet + YOLO-World 语义分割 | ✅ 已上线 |
| | 选区分割 | SAM2.1-Large 点击/框选分割 | ✅ 已上线 |
| | 形态统一 | MLS 变形算法，产品对齐参考形状 | ✅ 已上线 |
| | 图像协调 | IC-Light 光照协调 | ✅ 已上线 |
| **知识系统** | RAG 检索 | LanceDB + BGE 向量检索 | ✅ 已上线 |
| | 审美知识库 | 布局/配色/字体/参考案例 | ✅ 已上线 |
| | 趋势感知 | 联网搜索设计趋势 | ✅ 已上线 |
| | VLM 分析 | 视觉模型分析设计优缺点 | ✅ 已上线 |
| **设计辅助** | 智能布局 | 自动检测主体并计算最佳缩放/位置 | ✅ 已上线 |
| | SKU 批量生成 | 基于配置批量生成 SKU 图 | ✅ 已上线 |
| | 模板系统 | 模板解析与批量渲染 | ✅ 已上线 |

### 1.3 技术栈

```
┌─────────────────────────────────────────────────────────────────────┐
│                      DesignEcho 2.1 技术栈                          │
├─────────────────────────────────────────────────────────────────────┤
│  前端 UI        │ React 18 + TypeScript + Tailwind CSS + Zustand  │
│  桌面端         │ Electron 28 + Node.js 20                         │
│  PS 插件        │ Adobe UXP + TypeScript + Webpack                 │
│  AI 推理        │ ONNX Runtime (onnxruntime-node) + DirectML GPU  │
│  向量数据库     │ LanceDB (嵌入式)                                  │
│  Embedding      │ @xenova/transformers (bge-small-zh-v1.5)         │
│  图像处理       │ Sharp                                             │
│  通信协议       │ WebSocket + JSON-RPC 2.0 + 二进制协议            │
│  云端模型       │ Gemini 3 / Claude 3.5 / GPT-4o / Qwen3          │
│  本地模型       │ Ollama (Qwen2.5 / LLaVA / DeepSeek)             │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. 系统架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DesignEcho 2.1 系统架构                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌──────────────────────────────────────────────────────────────────────┐ │
│   │                      DesignEcho-Agent (Electron)                     │ │
│   ├──────────────────────────────────────────────────────────────────────┤ │
│   │                                                                      │ │
│   │   ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐   │ │
│   │   │   渲染进程       │   │   主进程         │   │   AI 推理层     │   │ │
│   │   │   (React UI)    │   │   (Node.js)     │   │   (ONNX)       │   │ │
│   │   │                 │   │                 │   │                 │   │ │
│   │   │  • ChatPanel    │   │  • 262 IPC      │   │  • BiRefNet    │   │ │
│   │   │  • AssetGallery │   │    Handlers     │   │  • YOLO-World  │   │ │
│   │   │  • Settings     │   │  • WebSocket    │   │  • SAM2.1      │   │ │
│   │   │  • Knowledge    │◄─►│    Server       │   │  • IC-Light    │   │ │
│   │   │    Manager      │   │  • 40+ Services │   │                 │   │ │
│   │   └─────────────────┘   └────────┬────────┘   └─────────────────┘   │ │
│   │                                  │                                   │ │
│   │   ┌─────────────────┐   ┌────────▼────────┐   ┌─────────────────┐   │ │
│   │   │   知识库系统     │   │   审美决策系统   │   │   LLM 服务      │   │ │
│   │   │                 │   │                 │   │                 │   │ │
│   │   │  • RAG Engine   │   │  • 知识库管理   │   │  • 云端模型     │   │ │
│   │   │  • VectorStore  │   │  • 趋势感知     │   │  • 本地 Ollama  │   │ │
│   │   │  • Embedding    │   │  • VLM 分析     │   │  • 流式输出     │   │ │
│   │   │  • 知识管理     │   │  • 自验证       │   │  • 思维过程     │   │ │
│   │   └─────────────────┘   └─────────────────┘   └─────────────────┘   │ │
│   │                                                                      │ │
│   └──────────────────────────────────────────────────────────────────────┘ │
│                                    │                                       │
│                           WebSocket (8765)                                 │
│                                    │                                       │
│   ┌──────────────────────────────────────────────────────────────────────┐ │
│   │                      DesignEcho-UXP (Photoshop 插件)                  │ │
│   ├──────────────────────────────────────────────────────────────────────┤ │
│   │                                                                      │ │
│   │   ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐   │ │
│   │   │   工具注册表     │   │   BatchPlay     │   │   通信模块      │   │ │
│   │   │   (61+ Tools)   │   │   API 封装      │   │   WS Client     │   │ │
│   │   └─────────────────┘   └─────────────────┘   └─────────────────┘   │ │
│   │                                                                      │ │
│   └──────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 项目结构

```
c:\UXP\2.0\
├── DesignEcho-Agent/              # Electron 桌面端（AI 推理中心）
│   ├── src/
│   │   ├── main/                  # 主进程
│   │   │   ├── index.ts           # 入口 (~5400 行)
│   │   │   ├── services/          # 服务层 (40+ 服务)
│   │   │   │   ├── aesthetic/     # 审美决策系统 (7 文件)
│   │   │   │   ├── rag/           # RAG 知识检索 (7 文件)
│   │   │   │   ├── designer/      # 设计师档案 (3 文件)
│   │   │   │   ├── morphing/      # 形态变形 (16 文件)
│   │   │   │   └── ...            # 其他服务
│   │   │   ├── ipc-handlers/      # IPC 处理器 (262 handlers)
│   │   │   ├── uxp-handlers/      # UXP 请求处理器
│   │   │   └── websocket/         # WebSocket 服务器
│   │   ├── renderer/              # 渲染进程 (React UI)
│   │   │   ├── components/        # UI 组件 (25+)
│   │   │   ├── services/          # 前端服务 (16)
│   │   │   ├── stores/            # Zustand 状态管理
│   │   │   └── prompts/           # AI Prompt 模板
│   │   └── shared/                # 共享模块
│   │       └── config/            # 模型配置
│   ├── models/                    # ONNX 模型文件
│   │   ├── birefnet/              # 抠图模型
│   │   ├── yolo-world/            # 目标检测
│   │   ├── sam2/                  # 分割模型
│   │   └── harmonization/         # 光照协调
│   ├── resources/
│   │   └── shared/knowledge/      # 共享知识数据
│   │       ├── socks-basic/       # 袜子电商知识
│   │       └── design-aesthetics/ # 设计审美知识
│   └── dist/                      # 编译输出
│
├── DesignEcho-UXP/                # Photoshop UXP 插件
│   ├── src/
│   │   ├── tools/                 # 工具实现 (61+ 工具)
│   │   │   ├── text/              # 文字工具 (5)
│   │   │   ├── layout/            # 布局工具 (20)
│   │   │   ├── image/             # 图像工具 (8)
│   │   │   ├── canvas/            # 画布工具 (12)
│   │   │   ├── layer/             # 图层工具 (12)
│   │   │   ├── morphing/          # 形态工具 (10)
│   │   │   └── sku/               # SKU 工具 (2)
│   │   ├── core/                  # 核心模块
│   │   └── index.ts               # 入口
│   └── dist/                      # 编译输出
│
└── docs/                          # 项目文档
```

---

## 3. 核心服务模块

### 3.1 主进程服务 (`src/main/services/`)

| 模块 | 文件 | 职责 |
|------|------|------|
| **Skills 系统** | `skills/` | 渐进式披露 + Agentic RAG |
| ├ skill-registry | | 技能注册表 (6 个内置技能) |
| ├ agentic-rag-nodes | | 检索决策/质量评估/重写 |
| └ types | | 类型定义 |
| **审美决策系统** | `aesthetic/` | AI 审美判断与决策 |
| ├ aesthetic-knowledge-service | | 审美知识库管理 |
| ├ aesthetic-decision-service | | AI 决策服务 |
| ├ trend-sensing-service | | 联网趋势感知 |
| ├ vlm-aesthetic-service | | VLM 设计分析 |
| └ product-library-service | | 产品库管理 |
| **RAG 系统** | `rag/` | 知识检索增强 |
| ├ embedding-service | | 向量嵌入 (BGE) |
| ├ vector-store | | LanceDB 存储 |
| ├ retrieval-engine | | 混合检索引擎 |
| └ knowledge-indexer | | 知识索引器 |
| **AI 推理** | | |
| ├ matting-service | | BiRefNet + YOLO 抠图 |
| ├ sam-service | | SAM2.1 分割 |
| ├ harmonization-service | | IC-Light 协调 |
| └ model-service | | LLM 调用统一接口 |
| **设计辅助** | | |
| ├ smart-layout-service | | 智能布局计算 |
| ├ subject-detection-service | | 主体检测 |
| ├ template-service | | 模板系统 |
| └ sku-config-service | | SKU 配置管理 |
| **知识管理** | | |
| ├ knowledge-service | | 内置知识库 |
| └ user-knowledge-service | | 用户自定义知识 |

### 3.2 IPC Handlers 统计

共 **262 个 IPC handlers**，分布在 23 个模块中：

| 模块 | Handler 数量 | 职责 |
|------|-------------|------|
| knowledge-handlers | 31 | 知识库查询 |
| aesthetic-handlers | 30 | 审美决策系统 |
| rag-handlers | 24 | RAG 检索 |
| user-knowledge-handlers | 19 | 用户知识 |
| template-handlers | 15 | 模板系统 |
| template-knowledge-handlers | 14 | 模板知识 |
| sku-knowledge-handlers | 14 | SKU 知识 |
| file-system-handlers | 13 | 文件操作 |
| resource-handlers | 12 | 资源管理 |
| sku-handlers | 11 | SKU 生成 |
| bfl-handlers | 8 | FLUX 图像生成 |
| matting-handlers | 8 | 抠图服务 |
| smart-layout-handlers | 7 | 智能布局 |
| config-handlers | 6 | 配置管理 |
| model-download-handlers | 6 | 模型下载 |
| design-spec-handlers | 5 | 设计规范 |
| ecommerce-project-handlers | 5 | 电商项目 |
| harmonization-handlers | 4 | 图像协调 |
| log-handlers | 4 | 日志服务 |
| ollama-handlers | 4 | Ollama 管理 |
| websocket-handlers | 4 | WebSocket |
| stream-handlers | 3 | 流式输出 |

### 3.3 渲染进程服务 (`src/renderer/services/`)

| 服务 | 职责 |
|------|------|
| agent-orchestrator | AI Agent 执行编排 |
| unified-agent.service | 统一 Agent 服务 |
| tool-executor.service | 工具执行器 |
| aesthetic.service | 审美服务接口 |
| rag.service | RAG 检索接口 |
| stream-chat.service | 流式对话 |
| context-compressor | 上下文压缩 |
| memory.service | 对话记忆 |

---

## 4. 知识库系统

### 4.1 知识库架构

```
知识库系统
│
├── 【内置知识】(只读)
│   ├── socks-basic/           # 袜子电商知识数据
│   │   ├── selling-points.json    # 42 个卖点
│   │   ├── pain-points.json       # 30 个痛点
│   │   ├── color-schemes.json     # 12 套配色
│   │   ├── categories.json        # 类目分类
│   │   └── layout-rules.json      # 布局规则
│   │
│   └── design-aesthetics/     # 设计审美知识数据
│       ├── aesthetic-references.json  # 审美参考案例
│       ├── layout-knowledge.json      # 布局知识
│       ├── color-knowledge.json       # 配色知识
│       └── typography-knowledge.json  # 字体知识
│
├── 【用户知识】(可读写)
│   ├── 全局知识 (user-knowledge.json)
│   ├── 项目知识 (.designecho/knowledge.json)
│   └── 标记的"好设计" (marked-designs.json)
│
└── 【RAG 系统】
    ├── LanceDB 向量存储
    ├── BGE-small-zh 嵌入模型
    └── 混合检索 (语义 + 关键词 + 个性化)
```

### 4.2 审美决策系统

```
审美决策流程
│
├── 1. 案例采集层
│   ├── 系统内置审美参考
│   ├── 用户标记的"好设计"
│   └── 联网搜索 (Tavily/DuckDuckGo)
│
├── 2. 趋势感知层
│   ├── 搜索当前设计趋势
│   ├── 判断流行周期 (新兴/巅峰/衰退)
│   └── 生成差异化建议
│
├── 3. 视觉分析层 (VLM)
│   ├── 分析设计优点
│   ├── 提取实现技巧
│   ├── 给出改进建议
│   └── 判断是否过时
│
└── 4. 自验证层
    ├── 决策解释 (为什么这样做)
    ├── 置信度评估
    ├── 参考案例关联
    └── 是否需要用户确认
```

---

## 5. AI 模型

### 5.1 本地 ONNX 模型

| 模型 | 文件 | 用途 | 加速 |
|------|------|------|------|
| BiRefNet | `birefnet/birefnet.onnx` | 高精度抠图 | DirectML |
| YOLO-World | `yolo-world/yolov8s-worldv2.onnx` | 目标检测 | DirectML |
| SAM2.1-Large | `sam2/vision_encoder_fp16.onnx` | 选区分割 | DirectML |
| IC-Light | `harmonization/ic-light-fc-unet.onnx` | 光照协调 | DirectML |

### 5.2 云端 LLM 模型

| Provider | 推荐模型 | 用途 |
|----------|----------|------|
| Google AI | Gemini 3 Flash | 日常设计分析 (低成本) |
| Google AI | Gemini 3 Pro | 复杂决策 |
| OpenRouter | Claude 3.5 Sonnet | 综合最强 |
| OpenRouter | GPT-4o | 文案语感 |
| OpenRouter | DeepSeek V3 | 高性价比 |
| Ollama Cloud | Qwen3 VL | 中文视觉分析 |
| Ollama Cloud | Kimi K2.5 | 中文顶级 |

### 5.3 本地 LLM 模型 (Ollama)

| 模型 | 参数 | 显存 | 用途 |
|------|------|------|------|
| Qwen2.5 14B | 14B | 10GB | 中文文案首选 |
| LLaVA 13B | 13B | 10GB | 视觉分析 |
| DeepSeek Coder V2 | 16B | 10GB | 工具调用 |
| MiniCPM-V 8B | 8B | 8GB | 轻量视觉 |

---

## 6. 通信协议

### 6.1 WebSocket 服务

- **端口**: 8765
- **协议**: JSON-RPC 2.0 + 二进制协议
- **最大负载**: 100MB

### 6.2 已注册的 WebSocket Handlers

```
核心功能:
├── webview.message         # WebView 消息
├── remove-background       # 抠图
├── remove-background-multi # 多目标抠图
├── smartLayout             # 智能布局
├── detectSubject           # 主体检测
├── calculateSmartScale     # 智能缩放
├── harmonize               # 图像协调
├── inpainting              # 局部重绘
├── morphing.execute        # 形态变形
└── enhanced-shape-morph    # 增强形态变形
```

---

## 7. 工具注册系统

### 7.1 UXP 工具分类

共 **61+ 个工具**，分布在 7 个类别：

| 类别 | 数量 | 示例工具 |
|------|------|----------|
| 文字工具 | 5 | GetTextContent, SetTextStyle |
| 布局工具 | 20 | MoveLayer, AlignLayers, SmartLayout |
| 图像工具 | 8 | RemoveBackground, PlaceImage |
| 画布工具 | 12 | GetDocumentInfo, CreateDocument |
| 图层工具 | 12 | TransformLayer, LayerEffects |
| 形态工具 | 10 | MorphToShape, WarpExplorer |
| SKU 工具 | 2 | SKULayout, SKUConfig |

### 7.2 Agent 可调用工具示例

```typescript
// 工具描述自动生成，供 AI Agent 使用
const tools = [
    {
        name: "smartLayout",
        description: "智能布局，自动计算产品最佳缩放和位置",
        parameters: { designType: "mainImage|sku|detail" }
    },
    {
        name: "removeBackground",
        description: "智能抠图，移除图片背景",
        parameters: { mode: "auto|precise" }
    },
    // ... 更多工具
];
```

---

## 8. 开发指南

### 8.1 环境要求

- Node.js 20+
- Photoshop 2024+
- GPU (推荐，用于 DirectML 加速)
- 显存 8GB+ (运行本地模型)

### 8.2 启动命令

```powershell
# 编译并启动 Agent（安全方式，不影响 Photoshop）
Stop-Process -Name "electron" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Set-Location -Path "C:\UXP\2.0\DesignEcho-Agent"
npm run build
npm start

# ⚠️ 禁止使用以下命令（会杀掉 Photoshop 进程）
# Stop-Process -Name "node" -Force  # ❌ 危险
# taskkill /f /im node.exe          # ❌ 危险
```

### 8.3 添加新功能

1. **添加 IPC Handler**
   - 在 `src/main/ipc-handlers/` 创建新文件
   - 在 `index.ts` 中注册

2. **添加服务**
   - 在 `src/main/services/` 创建服务
   - 导出单例

3. **添加 UXP 工具**
   - 在 `DesignEcho-UXP/src/tools/` 创建工具
   - 在 `registry.ts` 中注册

### 8.4 调试

- 日志文件: `DesignEcho-Agent/uxp-debug.log`
- WebSocket: `ws://127.0.0.1:8765`
- DevTools: Ctrl+Shift+I (Electron)

---

## 更新日志

### v2.2.0 (2026-01-31)

- ✅ 新增 Skills 系统 - 渐进式披露架构
- ✅ 新增 Agentic RAG - 自主检索决策
- ✅ 6 个内置设计技能 (主图/详情页/SKU/文案/配色/图像)
- ✅ 检索质量评估 (gradeDocuments)
- ✅ 查询重写机制 (rewriteQuery)

### v2.1.0 (2026-01-31)

- ✅ 新增审美决策系统 (7 个服务)
- ✅ 新增趋势感知服务 (联网搜索)
- ✅ 新增 VLM 设计分析服务
- ✅ 新增用户标记"好设计"功能
- ✅ 审美知识集成到 Agent 执行流程
- ✅ 新增 design-aesthetics 审美知识数据

### v2.0.0 (2026-01-25)

- ✅ 移除 Python 依赖，纯 Node.js + ONNX
- ✅ 新增 RAG 知识检索系统
- ✅ 新增设计师档案服务
- ✅ DirectML GPU 加速
