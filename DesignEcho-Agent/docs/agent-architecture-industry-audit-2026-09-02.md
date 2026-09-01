# Agent 架构行业经典问题审计（2026-09-02）

> 文档类型：一次性审计报告（历史资料层）。审计方法：6 个维度审查员并行读代码取证 + 每条「存在/部分存在」发现由独立怀疑者对抗核实（24 个子代理、502 次工具调用）；1 条发现被驳回。对照基准：行业经典 Agent 架构问题（并行/TOCTOU、上下文腐烂、控制流牢笼、工具身份、判断权边界）+ NousResearch hermes-agent 自我进化三件套。排序口径：北极星影响（惊艳成稿 + 自我进化），不按工程洁癖。

## 一句话结论

**单次运行是合格设计师，跨运行是失忆设计师。** 行业经典的执行引擎类问题（并行竞争、TOCTOU、上下文腐烂、传话失真、判断权越界）绝大多数已被真机事故驱动的治理闭合，工具身份与判断权边界维度零确认问题；真正的结构性缺口高度集中在自我进化闭环——四条断线（技能补丁生效、评审校准回流、指纹反雷同、候选区可见性）共用一个根因：**独立 Experience Publisher（用户批准 UI + 主进程签名原子写入）从未建成**。防伪造的 fail-closed 闸门造得比 Hermes 还保守，但钥匙没造。

## 维度总览

| 维度 | 结论 | 确认问题 |
|------|------|----------|
| 并行执行与 TOCTOU | 健康，行业最优实践形态已落地 | 2（minor/major，守护缺口非活体竞争） |
| 上下文管理 | 4/5 已治理 | 1（minor，前缀缓存盲区） |
| 控制流牢笼 | 技能路由已交模型；授权维度有残留 | 3（1 major） |
| 自我进化（Hermes 对照） | **闭环最后一公里全部断路** | 5（2 critical） |
| 工具身份与判断权边界 | 治理最扎实，全部 governed/absent | 0 |
| 北极星缺口 | 运行时骨架全接线，跨运行沉淀断链 | 6（2 critical） |

## Critical（4 条，全部在进化闭环，共用一个根因）

### C1. 学习候选区无发布器，生产消费出口恒空（exists）

`design-learning-candidates.ts:645-647` 自述「当前没有独立发布器，本出口保持空」。`listPublishedEvaluationCalibrationSamples` 是评审器唯一经验入口，但 normalize 把一切 published/promoted 声明强制降回候选并隔离——出口在数学上恒为空。评审校准样本、原则、配方、SKILL 补丁四类候选全部断头在候选区；只有参考学习一轨（studyReference → memory 人审 → searchDesignKnowledge）已闭合。

### C2. 技能自写断在发布环节（partially）

Hermes 闭环是「Agent 写→人批→生效」；我们是「Agent 写→登记→永远等待」。`proposeSkillImprovement` 结构化补丁、候选四态、行为事实自动晋升（P1）、有界策展（P3）全部已落地且比记忆所称更完整——真正缺的只是 P2 位置的发布器：主进程无任何应用 skill_improvement 的路径，`audit-skill-package-contract.cjs:126` 甚至断言 `applySkillImprovement` 不得存在（刻意 fail-closed 留白，待独立立项）。

### C3. 评审校准通道结构性断路（exists）

`recordDesignVerdict` 收集的用户留/改/弃样本永远到不了评审器（同 C1 根因）；`evaluate-design.executor.ts:178-196` 用校准样本作自动对照参考的分支是死代码。评审器有对照能力（盲评 4/4 背书）但无法吸收用户口味——「判断得出好不好看」的进化被卡死。

### C4. 近期成稿指纹账本写路径零调用，反雷同记忆死亡（exists）

`appendDesignFingerprint`（recent-designs.ts:118）与 IPC `designWorkshop:writeRecentDesigns` 全仓零调用方。Git 史证实：2b600b58 曾写账本，2ce67f2c 有意删除并注释承诺「待视觉评审通过后晋升」——晋升从未落地。后果：`findDesignSameness` 永远对空账本比较，「与近期稿雷同」警告与同角度惩罚永不触发，开场注入的 recentDesignsContext 恒为空。originality 逐稿评分仍在工作，死的是跨稿 sameness 线。

## Major（6 条）

1. **负向结局通道死代码**（exists）：`recordDesignRunOutcome` 支持 rejected 一票回退，但全仓唯一调用方硬编码 'delivered'（save_export 成功钩子）。晋升前提「0 次否决」永远真空满足——只学被交付的、不学被否决的，口味校准只有半边。
2. **礼貌措辞写请求被正则误伤**（partially）：能力问句正则（agent-intent-control-plane.ts:472-474）把「你能帮我把背景换成白色吗」判成能力问句，toolScopeCeiling 压成 none，整轮拒调工具只回文字。豁免函数只放行三类只读请求。中文用户高频措辞被卡在惊艳成稿的入口——这是「Agent 显得笨」的残留牢笼。技能路由维度「正则只提示不拦截」已兑现（pre_router_bypassed 属实），授权/工具范围维度不成立。
3. **自动终审信号不回流学习**（exists）：每次 creative_design 自动触发的 Final Judge（8 维评分卡）产出只进 Reflexion 重入约束，运行结束即弃。最稳定、必然发生的质量信号源对进化贡献为零；候选采集完全依赖模型自愿调 evaluateDesign——结构性偏食。
4. **敢的正向供给缺失**（partially）：概念迁移通道已有（reference-study 结构化推演 + directionExploration + 破格授权），但无大胆案例策展通道（Eagle 检索自认只返同品类竞品图）；内置版面配方已整体删除（记忆过期）；惩罚保守的唯一机制（sameness）因 C4 断电。「敢」只剩许可没有供给。
5. **并发角色白名单漂移无守护**（partially）：PARALLEL_SAFE_TEAMMATE_ROLES 与 registry canWriteToPhotoshop 今天精确互补，但 policy 注释与 CLAUDE.md 宣称的交叉校验器（smoke-design-team-pipeline.cjs）已随 smoke 退役消失，无任何替代。扩展队友角色（蓝图 10 Agent 方向）时新增写角色只改 registry 不改 policy 就静默引入并发写竞争。
6. **记忆策展双轨**（partially）：设计记忆条目有完整人审 UI；最关键的项目学习候选账本（learning-candidates.json）零 UI，用户不可见不可修剪（对照 Hermes /journey）。与 C1 同根因：发布器没有 UI 入口。已隔离出生产消费面，危害是死端而非失控。

## Minor / Info

- **TOCTOU 残留窗口**（minor）：防护主体是行业少见的扎实做法——写预检从工具日志签发 document+historyState+activeLayer 私有守卫，并在 executeAsModal 临界区内部复核；历史「两 run 并发污染同一文档」病例已治理。残留：47 个 executeAsModal 工具仅 12 个走事务 runner 的临界区内复核，document_revision 强绑定仅 4 个工具；窗口只在多客户端并发（8767/8768/用户脚本）场景。
- **前缀缓存盲区**（minor）：「已修」实为前缀稳定性修复（工具清单不逐轮增删）+依赖 DeepSeek/MiMo 服务端自动缓存，对主力通道成立；anthropic-adapter.ts 直连路径零 cache_control，若主力切换会回到全价平方级；压缩改写历史与前缀缓存的交互无文档。
- **兜底错误归因**（minor）：主执行链干净（无任何 catch 返回 success:true）；SKU 模板库 IPC 异常被折成「没有找到模板候选」（sku-batch.executor.ts:1696-1707），真实根因（IPC 故障）被误归因。
- **文档/记忆与代码矛盾**（info/minor，审计纪律要求报告）：CLAUDE.md 代码地图列出的 `agent-orchestration/task-classifier.ts` 不存在；`agent-intent-control-plane.ts` 实际在 shared/；CLAUDE.md 宣称的并发角色交叉校验不存在；记忆「版面配方已落地」「出稿必评」与代码不符（配方已显式删除、评审属 Agent 风险判断非固定流程）。audit-entry-doc-sync 的裸文件名盲区（looksLikeFilePath 要求含 /）是漏检根因。

## 被对抗核实驳回的发现

- 「概念先行缺失（rationale 写完即弃）」：被代码直接否定——rationale/angle 有六个真实消费点（指纹、雷同检测、评审 intentAlignment、过程流投影、终审、方向探索）；「可选而非必经」是被契约代码显式钉死的有意裁决（不是写入门票），与 agentic 不设门禁的治理原则一致。

## 与用户案例（并行/Fork-Join/TOCTOU）的直接对照

行业最优实践「只读并行、写串行、分阶段」在本项目已是落地形态而非目标：`agent-parallel-execution-policy.ts` 保序批次切分（unknown fail-closed 归串行）、`agent.ts:7039` 并行批真 Promise.all、写预检可见此前全部结果。TOCTOU 防护强于「文件读写锁」：守卫在 executeAsModal 临界区内部复核 historyStateId，中途篡改被拦为失败而非污染。残留是工程尾巴（见 Minor），不是架构病。

## 建议行动（按北极星优先级，未立项，待用户裁决排期）

1. **P0 — Experience Publisher 立项**：用户批准 UI + 主进程签名原子写入。一个立项同时接通 C1/C2/C3/C4 四条断线与 Major-6 的可见性（同根因）。这是对自我进化伤害最大的单点，也是收益最集中的单点。
2. **P1 — 礼貌措辞误伤修复**：能力问句正则的豁免面扩到写请求，或把该判定交回模型（与「理解优于硬编码」方向一致）。直接改善「Agent 显得笨」。
3. **P2 — 断线的负向信号接线**：用户否决稿件时签发 rejected 结局；Final Judge 评分卡写入学习候选（advisory，不动权限）。
4. **P3 — 守护补位**：并发角色白名单交叉校验静态断言入 maintenance:validate；并行切分策略补纯逻辑测试；audit-entry-doc-sync 裸文件名盲区。
5. **P4 — 文档/记忆纠偏**：CLAUDE.md 代码地图两处、过期记忆条目。
