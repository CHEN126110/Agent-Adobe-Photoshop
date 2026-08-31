# Current Task

## 2026-08-31 S1-DELIVERY-REVIEW-ROOT-CAUSE-001：技术可靠交付首个根因纵切

### 目标

1. 启动 S1“技术可靠交付基线”，先关闭 `INTAKE-083` 的 `finalArtifactRefs` 丢失，再处理 `INTAKE-084` 的 Evaluation / Review 协议稳定性；不在已知 blocker 未闭合时继续购买形式上的正式样本。
2. 让真实 Photoshop 写入、同目标读回、可编辑源稿、栅格导出、Agent 交付声明、Artifact Repository 与 Debug Attempt 收据形成同一 TaskRun / revision 的可验证链路。
3. 建立第一条可重复的隔离实机 Case 路径：技术失败能够落到唯一 owner 和首个偏差，成功必须由结构化收据证明，不能由文件存在、助手措辞或评测器猜测。
4. 为 S1 的 5 Case × 2 次正式队列清除基础设施 blocker；本纵切通过后才启动完整样本采集。

### 当前事实

- S0 文档真相源治理已经通过 65 项核心验证；当前项目路线、Owner 边界和 SMART 出口已经收口。
- 只读 Design Reliability preflight 能连接 Debug Bridge、Photoshop MCP 和真实 UXP Runtime，但当前仍因 S0 工作树未提交、Agent Runtime 提交不匹配、未提供一次性 fixture、未签发 Debug 写授权以及打开文档 ownership 未解析而不可开始正式写入。
- `finalArtifactRefs` 已在多次真实运行中出现“PSD / JPG 已产生但最终引用为空”；正式基准明确禁止扫描目录补造结果，只接受 Agent delivery receipt 与同 revision Repository 证据。
- `evaluateDesign` 同时存在结构协议失败与高分漏检两类问题；协议完整性、同目标绑定和审美校准必须分开归因，不能用默认分数或第二评审器掩盖。
- 当前可靠性数据只能证明存在历史单次通过和大量失败记录，不能形成 S1 的当前版本成功率；正式分母必须来自冻结 Case、canonical Attempt 和终态证据。

### 实施边界

- Agent 拥有交付声明、设计判断和修订选择；Harness 只绑定 TaskRun、target / revision、权限、Tool 收据、Repository 投影、Evaluation 结果与终态。
- 不扫描项目目录猜最终文件，不把全部导出当最终稿，不放宽 `finalArtifactManifest`，不把 Debug sidecar 升级为生产完成 owner。
- 不建立第二套 Evaluation、Review 状态机或品类专属 Runtime；协议修复进入现有 `DesignVerdict`、completion contract 和同任务复入链。
- 不关闭、保存或修改用户当前打开的外部 Photoshop 文档。正式写入只允许发生在通过 preflight 的一次性 fixture 和明确授权范围内。
- S0 文档改动先形成可回滚 Git 基线；S1 生产改动与评测记录保持独立提交边界。

### 下一步

1. 固化并提交 S0 文档治理基线，重建与当前提交一致的 Agent / UXP 调试运行身份。
2. 追踪 `runtimeDeliveryReceipt → final-delivery-artifact-collector → debug sidecar → ChatPanel submit receipt → design-reliability` 全链，建立能复现空 `finalArtifactRefs` 的可复用契约测试。
3. 只修首个丢失或错误清空交付引用的 owner；运行专项测试、Renderer 类型检查和核心验证。
4. 聚合 Evaluation 协议失败，分别验证结构解析、同 revision Review binding、DesignVerdict 投影和用户可见状态；协议问题与审美校准分开处理。
5. 准备一个新的隔离 fixture，完成一轮真实写入、读回、保存、导出和诚实终态；通过后再冻结剩余 5 Case × 2 队列。

### 验证与未知

- 必须验证：交付引用来自 Agent 声明且精确匹配 producer receipt；包含至少一个可编辑源稿和一个栅格导出；二者绑定同一任务目标与允许的 revision。
- 必须验证：外部文档 revision 零变化；失败不会被表达成“已完成”或“结果需要复核”；同一 blocker 不会通过重试、换措辞或新 TaskRun 被隐藏。
- 必须验证：Evaluation 输出非法时保留真实协议失败并给 Agent 可行动事实；合法结果只能消费当前 Review set，不得伪造人工裁决或默认高分。
- 当前未知：空引用发生在 producer receipt、结果引用集合、Reflexion generation 清空、Debug sidecar 发布还是 Attempt 规范化；以代码追踪和失败夹具确定首个偏差。
- 当前未知：真实 Debug 写授权与一次性 fixture 尚未准备；在提交、构建和环境身份一致前不得启动 Photoshop 写入。

### 状态

`in_progress`
