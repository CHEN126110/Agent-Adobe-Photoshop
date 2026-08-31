# Risks

> 本文件只保存当前仍可能影响产品结果或下一阶段判断的风险。已关闭事故、旧 PID /端口 /文件状态和完成后的回归保护由 Git、Decision、测试和 Run Record 承担。

## 使用规则

- 每个风险 ID 唯一，并标明状态、影响、当前证据和退出条件。
- `active` 表示当前仍成立；`mitigated` 表示已有保护但需持续回归；`unknown` 表示缺少足够当前证据。
- 风险不拥有排期；进入当前实现必须由 Plan / CurrentTask 激活。

## 当前高风险

### R-061 正式技术成功率仍不足

- 状态：active
- 影响：文件生成、Tool success 或模型自述可能与正式技术交付不一致，阻止 S1 可靠性基线成立。
- 当前证据：固定 5 Case 队列目前只有 r31 一份正式零人工技术通过；r37 / r38 仍有弃稿结算和 Artifact 引用缺口。
- 退出条件：S1 固定 5 Case × 2 轮达到至少 8 / 10 技术成功、零跨文档事故和零错误完成声明。

### R-062 自动 Evaluation 不稳定且可能高估结果

- 状态：active
- 影响：Agent 可能在错字、标题过重、主体遮挡或商业完成度不足时宣称成熟，导致错误修订或错误交付。
- 当前证据：r36 / r37 / r38 出现评审协议失败；r31 / r35 等自动分与人工 finding 存在偏差。
- 退出条件：缺陷注入集和人工校准证明协议完整率、关键缺陷检出率和假通过率达到 S1 / S2 目标。

### R-063 视觉语义到构图执行存在表征断裂

- 状态：active
- 影响：Agent 可以看见丰富像素，却把决定压缩为单 bbox、矩形目标区、粗锚点和比例；Host 会精确执行错误设计决定。
- 当前证据：多次真实运行出现连续 transform 搜索；单图分析偏分类，Strategy 与执行 schema 不能直接衔接。
- 退出条件：S2 A/B 证明 Agent 作者化中间表达提高盲评结果并减少无方向调整，且不形成 Harness 审美 Gate。

### R-064 图片置入链仍有部分事务与事实新鲜度缺口

- 状态：active
- 影响：缩放成功、移动失败或图层内容变化后使用旧主体框，可能在半完成状态上继续修改。
- 当前证据：`alignToReference` 未进入统一 Photoshop transaction；主体来源映射缺内容 checksum / history revision，EXIF 和 alpha 语义也未完全统一。
- 退出条件：相关 Tool 走唯一事务、主体事实绑定内容版本，真实 Photoshop 故障注入证明失败不留下部分修改。

### R-065 业务 Skill 可能继续复制共享能力或交互 owner

- 状态：mitigated
- 影响：主图、SKU、详情页修复若进入通用 Agent 分支或通用卡片，会再次降低通用性并制造重复状态。
- 当前证据：当前已有设计作者权、Skill Package 和交互 owner 审计，但历史 executor 仍大且真实 E2E 未完成。
- 退出条件：S3 三类 Skill 多样本通过，第四个 Skill 接入不修改 Agent loop、TaskRun、通用 UI、事务或 Release owner。

### R-066 未审核经验污染生产知识

- 状态：mitigated
- 影响：模型自评、参考图误读或一次偶然成功可能被写回成正式原则，放大错误审美。
- 当前证据：Experience Publisher、项目校准和 Memory 人审边界已建立；长期跨项目发布仍未开放。
- 退出条件：S5 所有正式经验变更具备来源、人工批准、版本、Canary 和回滚，在线自动晋升保持 0。

### R-067 共享 Photoshop / UXP 开发环境可能被其它会话替换

- 状态：active
- 影响：正式 Case 的 Agent build、UXP build、Runtime lease 和真实 Host 可能不属于同一版本，导致错误归因。
- 当前证据：历史 r26 / r32 等出现外部进程、UXP generation 或 Runtime identity 漂移；开发期租约已有局部治理。
- 退出条件：每次正式 Case 在提交前和终态都证明同一 clean Agent / UXP identity、Runtime lease、fixture 与 Host revision。

### R-068 文档真相源可能再次膨胀和漂移

- 状态：mitigated
- 影响：后续工程 Agent 读取旧任务、旧模型结构和旧命令，重新走入已证伪路线。
- 当前证据：本轮整理前 CurrentTask / Plan / Status 和 project-state 已经分裂；规划检查原来只 warning。
- 退出条件：CurrentTask / Plan 单 H2、四 ID 一致、当前文档命令真实存在并进入持续维护检查；连续两个开发切片无漂移回归。
