# 2026-08-03 · 从应用入口不可达的源码

这批文件已从 `src/` 移出，按**原相对路径**归档在本目录，需要时可直接拷回。
`MANIFEST.json` 记录了完整清单与行数。

## 移除依据

用可达性分析而非「有没有人 import 我」来判定：从四个真实入口

- `src/main/index.ts`
- `src/main/preload.ts`
- `src/renderer/main.tsx`
- `src/renderer/App.tsx`

沿 import 图遍历，**遍历不到的即为不可达**。这样才能抓到「一群文件互相 import、整体却没人用」的死簇——
`main/services/aesthetic/` 那 9 个文件就是这种，逐个看每个都"有引用"。

## 刻意没有移除的两类

1. **被 `scripts/` 消费的**（38 个文件 / 11,834 行）。它们从应用入口不可达，但审计与维护脚本在用，
   其中 `agent-runtime-v5/skill-package-contract.ts`、`agent-runtime-v5/prompt-capability-governance.ts`
   还在 `run-core-validation.cjs` 链路上。构建工具是合法消费者，不算死代码。
2. **副作用导入的**。`import './xxx'`（不带 `from`）不会被常规 import 分析发现，而注册表正是靠它加载。
   `shared/agent-runtime-v5/manifests/detail-page.structure-preset.ts` 属于此类，已还原。

## 这批里最值得注意的

同一件事存在三套实现，只有一套在跑：

| 实现 | 状态 |
|---|---|
| `main/services/morphing/optimized-morphing-service.ts` | **在用**（未移除） |
| `main/services/morphing/morphing-service.ts` 等 | 已移除 |
| `main/services/webgl-warp-engine/` | 已移除 |
| `main/services/contour-analysis-service.ts` + `mls-warp-service.ts` | 已移除 |

新方案上线时旧的没删，是长期项目最常见的代码堆积形态。

## 验证记录

移除后全部通过：`build:typecheck:renderer`、10 项 audit、`npm test` 5/5、
`build:renderer`（vite/rollup）、DesignEcho-UXP 的 webpack 构建。

其中 **renderer 打包这一步是必须的**：`detail-page.structure-preset` 那次误删
typecheck 完全没报错，只有 rollup 解析模块时才暴露。
