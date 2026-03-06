# DesignEcho 技术文档中心

> **项目**: DesignEcho - AI 驱动的 Photoshop 设计助手  
> **版本**: 2.1.0  
> **最后更新**: 2026-01-31

---

## 📊 项目状态

| 指标 | 数值 |
|------|------|
| IPC Handlers | 262 个 |
| 服务模块 | 40+ 个 |
| UXP 工具 | 61+ 个 |
| 内置知识数据 | 2 组 |
| 本地 AI 模型 | 4 个 (BiRefNet, YOLO, SAM2, IC-Light) |

**核心能力**: 智能抠图 | 形态统一 | RAG 知识检索 | 审美决策 | 趋势感知

---

## 📚 文档索引

### 项目状态

| 文档 | 描述 | 重要性 |
|------|------|--------|
| [project-status.md](./project-status.md) | **项目状态** - 单一真理来源，所有状态以此为准 | ⭐⭐⭐ 必读 |
| [code-simplifier-system-plan.md](./code-simplifier-system-plan.md) | **代码治理方案** - 当前有效的代码清理规则、优先级和首批清理清单 | ⭐⭐ |
| [skill-capability-matrix.md](./skill-capability-matrix.md) | **技能真值表** - 当前技能的声明、执行器、路由和闭环状态总表 | ⭐⭐⭐ |

### 核心文档

| 文档 | 描述 | 适用对象 |
|------|------|----------|
| [DesignEcho-技术文档.md](./DesignEcho-技术文档.md) | **项目总览** - 架构、模块、服务、AI 模型 | 所有开发者 |
| [视觉模型配置说明.md](../DesignEcho-Agent/docs/视觉模型配置说明.md) | **VLM 配置** - 云端/本地视觉模型选择 | AI 开发者 |

### 产品文档

| 文档 | 描述 | 适用对象 |
|------|------|----------|
| [产品需求文档-PRD.md](./产品需求文档-PRD.md) | **产品规划** - 业务场景、功能模块、用户流程 | 产品/运营/全员 |
| [需求可行性分析.md](./需求可行性分析.md) | **可行性评估** - 技术难点、风险、实施建议 | 技术/产品 |
| [开发规划-Roadmap.md](./开发规划-Roadmap.md) | **开发计划** - 阶段划分、任务分解、里程碑 | 技术/项目管理 |

### 技术指南

| 文档 | 描述 | 适用对象 |
|------|------|----------|
| [UXP-开发指南.md](./UXP-开发指南.md) | Adobe Photoshop UXP 插件开发 | 前端/插件开发者 |
| [Electron-Agent-指南.md](./Electron-Agent-指南.md) | Electron 桌面端开发 | 后端开发者 |
| [AI-模型指南.md](./AI-模型指南.md) | BiRefNet, YOLO-World, SAM2 模型 | AI/算法工程师 |
| [Agent-Skills-最佳实践.md](./Agent-Skills-最佳实践.md) | 工具系统、Skills 设计模式 | 架构师/全栈 |

### 功能文档

| 文档 | 描述 | 状态 |
|------|------|------|
| [选区抠图功能现状.md](./选区抠图功能现状.md) | 选区分割功能分析与改进方案 | ✅ 已完成 |
| [形态统一技术方案.md](./形态统一技术方案.md) | MLS 变形算法技术方案 | ✅ 已完成 |
| [模板系统规范.md](./模板系统规范.md) | 模板解析与渲染规范 | ✅ 已完成 |

---

## 🗂️ 目录结构

```
c:\UXP\2.0\
├── DesignEcho-Agent/              # Electron 桌面端
│   ├── src/
│   │   ├── main/                  # 主进程
│   │   │   ├── services/          # 40+ 服务
│   │   │   │   ├── aesthetic/     # 审美决策系统 (7 文件)
│   │   │   │   ├── rag/           # RAG 知识检索 (7 文件)
│   │   │   │   └── ...
│   │   │   └── ipc-handlers/      # 262 IPC handlers
│   │   ├── renderer/              # React UI
│   │   └── shared/                # 共享模块
│   ├── models/                    # ONNX 模型
│   └── resources/
│       └── layout-rules.json      # 布局规则
│
├── DesignEcho-UXP/                # Photoshop 插件
│   └── src/
│       └── tools/                 # 61+ 工具
│
└── docs/                          # 文档
    ├── README.md                  # 文档索引（本文件）
    ├── project-status.md          # 项目状态（单一真理来源）
    ├── DesignEcho-技术文档.md      # 技术总览
    └── ...
```

---

## 🚀 快速开始

### 环境要求

- Node.js 20+
- Photoshop 2024+
- GPU (推荐，用于 DirectML 加速)

### 启动 Agent

```powershell
# 安全启动命令（不影响 Photoshop）
Stop-Process -Name "electron" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Set-Location -Path "C:\UXP\2.0\DesignEcho-Agent"
npm run build
npm start
```

⚠️ **禁止使用** `Stop-Process -Name "node"` 或 `taskkill /f /im node.exe`，会杀掉 Photoshop 进程！

---

## 📈 最近更新

### 2026-01-31 (v2.1.0)

- ✅ 新增审美决策系统
- ✅ 新增趋势感知服务（联网搜索）
- ✅ 新增 VLM 设计分析服务
- ✅ 新增用户标记"好设计"功能
- ✅ 审美知识集成到 Agent 执行流程
- ✅ 新增 design-aesthetics 审美知识数据
- ✅ 更新项目文档

### 2026-01-25 (v2.0.0)

- ✅ 移除 Python 依赖，纯 Node.js + ONNX
- ✅ 新增 RAG 知识检索系统
- ✅ DirectML GPU 加速

---

## 📖 阅读顺序建议

1. **新手入门**: `project-status.md` → `DesignEcho-技术文档.md`
2. **UXP 开发**: `UXP-开发指南.md` → `Agent-Skills-最佳实践.md`
3. **AI 开发**: `AI-模型指南.md` → `视觉模型配置说明.md`
4. **产品理解**: `产品需求文档-PRD.md` → `开发规划-Roadmap.md`
