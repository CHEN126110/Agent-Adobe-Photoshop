# `index.ts` 重构计划

> 当前：5457 行 -> 目标：约 500 行（参考精简版 `index.ts`）

## 现状分析

### 已模块化部分
- **IPC Handlers**：25 个模块文件（`ipc-handlers/`）
- **UXP Handlers**：11 个模块文件（`uxp-handlers/`）

### 待迁移部分
- `index.ts` 中仍保留 54 个内联 handlers

## 待迁移内容分类

### 1. WebSocket UXP Handlers（约 2000 行）

`index.ts` 中大量 `wsServer.on('action', ...)` 定义需要迁移：

| Handler 类别 | 估计行数 | 目标文件 |
|-------------|---------|----------|
| `morphToShape` | ~500 | `uxp-handlers/morphing-handlers.ts` |
| `batchMorphToShape` | ~300 | `uxp-handlers/morphing-handlers.ts` |
| `autoAlign` | ~200 | `uxp-handlers/layout-handlers.ts` |
| `smartLayout` | ~400 | `uxp-handlers/smart-layout-handlers.ts` |
| 其他形态相关 | ~600 | 分类整理 |

### 2. 二进制协议处理（约 500 行）

- `receivedBinaryImages` 缓存管理
- `onBinary` 处理器
- 二进制图像解码/编码

-> 迁移到 `services/binary-protocol-service.ts`

### 3. 服务初始化逻辑（约 300 行）

- 各服务的初始化代码
- 依赖注入配置

-> 保留在 `index.ts`，但简化为函数调用

### 4. 调试/诊断代码（约 200 行）

- `morphExecutionCount`
- 各种调试日志
- 临时诊断代码

-> 清理或迁移到调试模块

## 迁移策略

### 阶段 1：UXP Morphing Handlers
1. 创建 `uxp-handlers/morphing-handlers.ts`
2. 迁移 `morphToShape`、`batchMorphToShape` 等
3. 从 `index.ts` 调用模块化 handler

### 阶段 2：二进制协议
1. 创建 `services/binary-protocol-service.ts`
2. 封装二进制缓存和处理逻辑
3. 导出简洁接口

### 阶段 3：服务初始化
1. 创建 `services/service-initializer.ts`
2. 统一管理服务生命周期
3. 简化 `index.ts` 启动流程

### 阶段 4：清理
1. 移除调试代码
2. 统一日志格式
3. 最终验证

## 参考

- `index.ts`：442 行的精简版本
- 目标：`index.ts` 只负责应用启动和模块协调

## 风险

1. **运行时依赖**：许多 handler 依赖闭包中的服务实例
2. **循环依赖**：模块间可能存在循环引用
3. **类型安全**：拆分时需确保类型正确传递

## 建议

考虑到风险，建议采用渐进式迁移：
1. 每次只迁移一类 handler
2. 迁移后立即测试
3. 使用 re-export 保持兼容
