# Code Simplifier Baseline

- Generated at: 2026-03-04T11:40:42.121Z
- Scope: `DesignEcho-Agent/src` + `DesignEcho-UXP/src` + `scripts` + `playwright-skill`
- Rule source: `.cursor/rules/code-simplifier.md`
- Run command: `node scripts/code-simplifier-audit.js`

## Snapshot

- Source files: **336**
- Total lines: **140997**
- Nested ternary hits (line-level): **18**
- Long lines (>140 chars): **315**
- try/catch count: **1042**

- Large files (>800 lines): **29**

## Largest Files

| File | Lines | Arrow Fn | try/catch | Nested Ternary | Hotspot Score |
| --- | --- | --- | --- | --- | --- |
| `DesignEcho-Agent/src/main/index.ts` | 5850 | 186 | 57 | 0 | 181 |
| `DesignEcho-Agent/src/renderer/components/ChatPanel.tsx` | 3498 | 101 | 26 | 1 | 110 |
| `DesignEcho-UXP/src/tools/image/remove-background.ts` | 2840 | 17 | 34 | 0 | 77 |
| `DesignEcho-Agent/src/renderer/components/SettingsModal.tsx` | 2733 | 141 | 13 | 1 | 96 |
| `DesignEcho-UXP/src/tools/layout/sku-layout-tool.ts` | 2240 | 32 | 15 | 0 | 62 |
| `DesignEcho-UXP/src/index.ts` | 2174 | 59 | 20 | 0 | 61 |
| `DesignEcho-Agent/src/main/services/matting-service.ts` | 1702 | 9 | 16 | 0 | 42 |
| `DesignEcho-Agent/src/renderer/services/skill-executors/detail-page.executor.ts` | 1690 | 41 | 4 | 2 | 63 |
| `DesignEcho-Agent/src/renderer/services/tool-executor.service.ts` | 1636 | 32 | 19 | 0 | 46 |
| `DesignEcho-Agent/src/renderer/components/KnowledgeManager.tsx` | 1492 | 251 | 8 | 0 | 67 |
| `scripts/6.0琚滃瓙鎺掔増.jsx` | 1438 | 0 | 16 | 0 | 34 |
| `DesignEcho-Agent/src/renderer/components/TemplateKnowledgePanel.tsx` | 1434 | 60 | 10 | 0 | 38 |
| `DesignEcho-Agent/src/renderer/services/skill-executors/sku-batch.executor.ts` | 1394 | 77 | 14 | 1 | 48 |
| `DesignEcho-Agent/src/main/services/local-detection-service.ts` | 1359 | 8 | 7 | 0 | 32 |
| `DesignEcho-Agent/src/renderer/components/AssetGallery.tsx` | 1358 | 60 | 3 | 1 | 48 |
| `DesignEcho-Agent/src/renderer/components/SKUKnowledgePanel.tsx` | 1314 | 67 | 5 | 0 | 38 |
| `DesignEcho-Agent/src/main/services/resource-manager-service.ts` | 1282 | 34 | 20 | 0 | 37 |
| `DesignEcho-Agent/src/renderer/stores/app.store.ts` | 1260 | 150 | 1 | 0 | 47 |
| `DesignEcho-Agent/src/main/services/sam-service.ts` | 1169 | 7 | 3 | 0 | 24 |
| `DesignEcho-UXP/src/tools/layout/smart-layout-engine.ts` | 1151 | 7 | 6 | 0 | 24 |
| `DesignEcho-Agent/src/renderer/components/ProjectManager.tsx` | 1149 | 23 | 4 | 0 | 24 |
| `DesignEcho-Agent/src/main/services/model-service.ts` | 1005 | 47 | 7 | 0 | 27 |
| `DesignEcho-Agent/src/renderer/services/unified-agent.service.ts` | 967 | 21 | 8 | 0 | 24 |
| `DesignEcho-Agent/src/shared/config/models.config.ts` | 962 | 8 | 0 | 0 | 24 |
| `DesignEcho-Agent/src/renderer/services/skill-executors/layout-replication.executor.ts` | 945 | 12 | 4 | 0 | 24 |
| `DesignEcho-UXP/src/tools/layer/smart-object-tools.ts` | 944 | 23 | 10 | 0 | 24 |
| `DesignEcho-Agent/src/renderer/components/knowledge/TemplateEditor.tsx` | 899 | 52 | 0 | 0 | 19 |
| `DesignEcho-Agent/src/main/services/template-knowledge.service.ts` | 895 | 29 | 7 | 0 | 16 |
| `DesignEcho-UXP/src/tools/morphing/warp-explorer.ts` | 836 | 4 | 15 | 0 | 18 |
| `DesignEcho-Agent/src/main/websocket/server.ts` | 794 | 24 | 9 | 0 | 16 |

## Refactor Hotspots

| File | Score | Lines | Nested Ternary | Long Lines | any |
| --- | --- | --- | --- | --- | --- |
| `DesignEcho-Agent/src/main/index.ts` | 181 | 5850 | 0 | 47 | 86 |
| `DesignEcho-Agent/src/renderer/components/ChatPanel.tsx` | 110 | 3498 | 1 | 9 | 27 |
| `DesignEcho-Agent/src/renderer/components/SettingsModal.tsx` | 96 | 2733 | 1 | 16 | 21 |
| `DesignEcho-UXP/src/tools/image/remove-background.ts` | 77 | 2840 | 0 | 8 | 43 |
| `DesignEcho-Agent/src/renderer/components/KnowledgeManager.tsx` | 67 | 1492 | 0 | 92 | 24 |
| `DesignEcho-Agent/src/renderer/services/skill-executors/detail-page.executor.ts` | 63 | 1690 | 2 | 1 | 16 |
| `DesignEcho-UXP/src/tools/layout/sku-layout-tool.ts` | 62 | 2240 | 0 | 8 | 49 |
| `DesignEcho-UXP/src/index.ts` | 61 | 2174 | 0 | 3 | 47 |
| `DesignEcho-Agent/src/renderer/components/AssetGallery.tsx` | 48 | 1358 | 1 | 0 | 1 |
| `DesignEcho-Agent/src/renderer/services/skill-executors/sku-batch.executor.ts` | 48 | 1394 | 1 | 6 | 38 |
| `DesignEcho-Agent/src/renderer/stores/app.store.ts` | 47 | 1260 | 0 | 0 | 9 |
| `DesignEcho-Agent/src/renderer/services/tool-executor.service.ts` | 46 | 1636 | 0 | 9 | 62 |
| `DesignEcho-Agent/src/main/services/matting-service.ts` | 42 | 1702 | 0 | 7 | 20 |
| `DesignEcho-Agent/src/renderer/components/SKUKnowledgePanel.tsx` | 38 | 1314 | 0 | 0 | 6 |
| `DesignEcho-Agent/src/renderer/components/TemplateKnowledgePanel.tsx` | 38 | 1434 | 0 | 0 | 13 |
| `DesignEcho-Agent/src/main/services/resource-manager-service.ts` | 37 | 1282 | 0 | 0 | 10 |
| `scripts/6.0琚滃瓙鎺掔増.jsx` | 34 | 1438 | 0 | 3 | 0 |
| `DesignEcho-Agent/src/main/services/local-detection-service.ts` | 32 | 1359 | 0 | 2 | 15 |
| `DesignEcho-Agent/src/main/preload.ts` | 28 | 621 | 0 | 1 | 27 |
| `DesignEcho-Agent/src/renderer/components/CustomSelect.tsx` | 28 | 435 | 2 | 2 | 0 |
| `DesignEcho-Agent/src/main/services/model-service.ts` | 27 | 1005 | 0 | 2 | 30 |
| `DesignEcho-Agent/src/main/services/aesthetic/trend-sensing-service.ts` | 26 | 649 | 1 | 0 | 8 |
| `DesignEcho-Agent/src/main/services/log-service.ts` | 26 | 749 | 1 | 1 | 10 |
| `DesignEcho-Agent/src/renderer/components/message/parser.ts` | 26 | 741 | 1 | 2 | 7 |
| `DesignEcho-Agent/src/renderer/services/skill-executors/main-image.executor.ts` | 26 | 683 | 1 | 1 | 15 |
| `DesignEcho-Agent/src/main/services/sam-service.ts` | 24 | 1169 | 0 | 0 | 15 |
| `DesignEcho-Agent/src/renderer/components/ProjectManager.tsx` | 24 | 1149 | 0 | 0 | 4 |
| `DesignEcho-Agent/src/renderer/services/skill-executors/layout-replication.executor.ts` | 24 | 945 | 0 | 3 | 12 |
| `DesignEcho-Agent/src/renderer/services/unified-agent.service.ts` | 24 | 967 | 0 | 1 | 28 |
| `DesignEcho-Agent/src/shared/config/models.config.ts` | 24 | 962 | 0 | 0 | 1 |

## Nested Ternary Locations (Top)

- `DesignEcho-Agent/src/main/services/aesthetic/trend-sensing-service.ts:357`
- `DesignEcho-Agent/src/main/services/log-service.ts:331`
- `DesignEcho-Agent/src/main/services/morphing/benchmark-comparison.ts:364`
- `DesignEcho-Agent/src/main/services/rag/rag-service.ts:255`
- `DesignEcho-Agent/src/renderer/components/AssetGallery.tsx:408`
- `DesignEcho-Agent/src/renderer/components/ChatPanel.tsx:2368`
- `DesignEcho-Agent/src/renderer/components/CustomSelect.tsx:222`
- `DesignEcho-Agent/src/renderer/components/CustomSelect.tsx:245`
- `DesignEcho-Agent/src/renderer/components/LayoutFixList.tsx:179`
- `DesignEcho-Agent/src/renderer/components/message/parser.ts:453`
- `DesignEcho-Agent/src/renderer/components/ReferenceUpload.tsx:58`
- `DesignEcho-Agent/src/renderer/components/SettingsModal.tsx:1838`
- `DesignEcho-Agent/src/renderer/services/skill-executors/detail-page.executor.ts:500`
- `DesignEcho-Agent/src/renderer/services/skill-executors/detail-page.executor.ts:772`
- `DesignEcho-Agent/src/renderer/services/skill-executors/main-image.executor.ts:632`
- `DesignEcho-Agent/src/renderer/services/skill-executors/sku-batch.executor.ts:189`
- `DesignEcho-Agent/src/renderer/services/theme-adapter.ts:315`
- `scripts/recent-changes.js:118`

## Long Line Locations (Top)

- `DesignEcho-Agent/src/renderer/components/Header.tsx:120` (771 chars)
- `DesignEcho-Agent/src/renderer/services/tool-executor.service.ts:96` (573 chars)
- `DesignEcho-Agent/src/main/services/morphing/sock-region-analyzer.ts:122` (315 chars)
- `DesignEcho-Agent/src/renderer/components/KnowledgeSearch.tsx:348` (256 chars)
- `DesignEcho-Agent/src/renderer/components/MemorySettings.tsx:267` (254 chars)
- `DesignEcho-Agent/src/renderer/components/MemorySettings.tsx:303` (246 chars)
- `DesignEcho-UXP/src/tools/image/inpainting.ts:360` (235 chars)
- `DesignEcho-Agent/src/renderer/components/SmartRecommendation.tsx:107` (230 chars)
- `DesignEcho-Agent/src/renderer/services/skill-executors/design-reference-search.executor.ts:80` (217 chars)
- `DesignEcho-Agent/src/shared/prompts/reference-analysis.ts:169` (217 chars)
- `DesignEcho-Agent/src/main/services/aesthetic/aesthetic-knowledge-service.ts:465` (216 chars)
- `DesignEcho-Agent/src/main/services/morphing/benchmark-comparison.ts:403` (216 chars)
- `DesignEcho-Agent/src/renderer/components/CustomSelect.tsx:222` (212 chars)
- `DesignEcho-Agent/src/main/index.ts:1118` (209 chars)
- `DesignEcho-Agent/src/main/services/morphing/benchmark-comparison.ts:366` (208 chars)
- `DesignEcho-Agent/src/renderer/components/SmartRecommendation.tsx:384` (208 chars)
- `DesignEcho-Agent/src/renderer/components/KnowledgeSearch.tsx:312` (201 chars)
- `DesignEcho-Agent/src/shared/prompts/reference-analysis.ts:174` (199 chars)
- `DesignEcho-UXP/src/tools/layout/align-to-reference.ts:122` (199 chars)
- `DesignEcho-Agent/src/renderer/services/tool-executor.service.ts:102` (198 chars)
- `DesignEcho-Agent/src/main/index.ts:368` (196 chars)
- `DesignEcho-Agent/src/main/index.ts:423` (196 chars)
- `DesignEcho-Agent/src/renderer/components/DesignerSettings.tsx:105` (195 chars)
- `DesignEcho-Agent/src/main/services/shape-morphing-orchestrator.ts:229` (191 chars)
- `DesignEcho-Agent/src/main/services/knowledge-service.ts:86` (189 chars)
- `DesignEcho-Agent/src/main/services/local-detection-service.ts:807` (189 chars)
- `DesignEcho-Agent/src/main/services/morphing/enhanced-morph-executor.ts:149` (188 chars)
- `DesignEcho-UXP/src/tools/layout/sku-layout-tool.ts:1482` (188 chars)
- `DesignEcho-Agent/src/renderer/components/message/parser.ts:12` (187 chars)
- `DesignEcho-Agent/src/renderer/services/context.service.ts:540` (187 chars)
- `DesignEcho-UXP/src/tools/image/inpainting.ts:387` (186 chars)
- `DesignEcho-UXP/src/index.ts:265` (185 chars)
- `DesignEcho-UXP/src/tools/image/inpainting.ts:125` (183 chars)
- `DesignEcho-Agent/src/renderer/components/knowledge/ProjectIndexer.tsx:158` (181 chars)
- `DesignEcho-Agent/src/renderer/services/skill-executors/sku-batch.executor.ts:654` (181 chars)
- `DesignEcho-Agent/src/renderer/services/skill-executors/sku-batch.executor.ts:685` (181 chars)
- `DesignEcho-Agent/src/renderer/services/tool-executor.service.ts:31` (181 chars)
- `DesignEcho-Agent/src/main/ipc-handlers/ollama-handlers.ts:92` (180 chars)
- `DesignEcho-Agent/src/main/services/rag/psd-ingestor.ts:427` (179 chars)
- `DesignEcho-UXP/src/tools/image/export-layer.ts:161` (179 chars)
- `DesignEcho-Agent/src/main/services/shape-morphing-orchestrator.ts:429` (178 chars)
- `DesignEcho-Agent/src/renderer/components/DesignerSettings.tsx:429` (178 chars)
- `DesignEcho-Agent/src/renderer/components/SettingsModal.tsx:1222` (178 chars)
- `DesignEcho-Agent/src/main/index.ts:1144` (177 chars)
- `DesignEcho-Agent/src/main/services/matting-service.ts:1039` (177 chars)
- `DesignEcho-Agent/src/renderer/components/knowledge/ProjectIndexer.tsx:155` (177 chars)
- `DesignEcho-Agent/src/main/ipc-handlers/user-knowledge-handlers.ts:55` (174 chars)
- `DesignEcho-Agent/src/main/services/matting-service.ts:893` (174 chars)
- `DesignEcho-Agent/src/renderer/services/skill-executors/layout-replication.executor.ts:874` (173 chars)
- `DesignEcho-Agent/src/main/services/morphing/sparse-displacement.ts:80` (172 chars)
- `DesignEcho-Agent/src/renderer/components/KnowledgeManager.tsx:369` (172 chars)
- `DesignEcho-Agent/src/renderer/types.d.ts:178` (172 chars)
- `DesignEcho-Agent/src/main/ipc-handlers/user-knowledge-handlers.ts:33` (171 chars)
- `DesignEcho-Agent/src/renderer/components/KnowledgeManager.tsx:410` (171 chars)
- `DesignEcho-Agent/src/main/ipc-handlers/user-knowledge-handlers.ts:72` (170 chars)
- `DesignEcho-Agent/src/main/services/matting-service.ts:912` (170 chars)
- `DesignEcho-UXP/src/tools/image/remove-background.ts:199` (170 chars)
- `DesignEcho-Agent/src/renderer/components/KnowledgeManager.tsx:415` (169 chars)
- `DesignEcho-Agent/src/renderer/services/unified-agent.service.ts:478` (169 chars)
- `DesignEcho-Agent/src/renderer/components/DesignerSettings.tsx:552` (168 chars)
- `DesignEcho-UXP/src/tools/layout/sku-layout-tool.ts:852` (168 chars)
- `DesignEcho-UXP/src/tools/text/create-text-layer.ts:15` (168 chars)
- `DesignEcho-Agent/src/renderer/components/KnowledgeManager.tsx:370` (166 chars)
- `DesignEcho-Agent/src/renderer/components/KnowledgeSearch.tsx:434` (166 chars)
- `DesignEcho-Agent/src/renderer/services/skill-executors/find-edit-element.executor.ts:89` (166 chars)
- `DesignEcho-UXP/src/tools/image/inpainting.ts:137` (166 chars)
- `DesignEcho-Agent/src/main/services/asset-library-service.ts:468` (165 chars)
- `DesignEcho-UXP/src/index.ts:2095` (165 chars)
- `DesignEcho-Agent/src/main/services/sock-morphing/sock-morph-engine.ts:19` (164 chars)
- `DesignEcho-Agent/src/main/services/model-service.ts:690` (163 chars)
- `DesignEcho-Agent/src/renderer/services/skill-executors/layout-replication.executor.ts:869` (163 chars)
- `DesignEcho-Agent/src/renderer/services/skill-executors/sku-batch.executor.ts:1377` (163 chars)
- `DesignEcho-UXP/src/tools/layout/sku-layout-tool.ts:1140` (163 chars)
- `DesignEcho-Agent/src/main/index.ts:1099` (162 chars)
- `DesignEcho-Agent/src/renderer/App.tsx:26` (162 chars)
- `DesignEcho-Agent/src/renderer/components/SettingsModal.tsx:1291` (162 chars)
- `DesignEcho-Agent/src/main/preload.ts:573` (161 chars)
- `DesignEcho-Agent/src/main/services/matting-service.ts:894` (160 chars)
- `DesignEcho-Agent/src/main/index.ts:28` (159 chars)
- `DesignEcho-Agent/src/main/services/model-service.ts:393` (159 chars)
- `DesignEcho-Agent/src/main/services/contour-service.ts:183` (158 chars)
- `DesignEcho-Agent/src/renderer/components/ChatPanel.tsx:265` (158 chars)
- `DesignEcho-Agent/src/renderer/components/knowledge/UnifiedKnowledgePanel.tsx:270` (158 chars)
- `DesignEcho-Agent/src/renderer/components/SmartRecommendation.tsx:157` (158 chars)
- `DesignEcho-UXP/src/tools/image/remove-background.ts:241` (158 chars)
- `DesignEcho-Agent/src/main/ipc-handlers/user-knowledge-handlers.ts:38` (157 chars)
- `DesignEcho-Agent/src/main/services/user-knowledge-service.ts:265` (157 chars)
- `DesignEcho-Agent/src/renderer/services/tool-executor.service.ts:34` (157 chars)
- `DesignEcho-Agent/src/main/services/morphing/smart-cuff-detector.ts:355` (156 chars)
- `DesignEcho-Agent/src/renderer/components/ChatPanel.tsx:215` (156 chars)
- `DesignEcho-Agent/src/main/services/asset-library-service.ts:382` (155 chars)
- `DesignEcho-Agent/src/renderer/services/skill-executors/design-reference-search.executor.ts:48` (155 chars)
- `DesignEcho-Agent/src/main/services/user-knowledge-service.ts:163` (154 chars)
- `DesignEcho-Agent/src/renderer/components/ChatPanel.tsx:235` (154 chars)
- `DesignEcho-Agent/src/renderer/services/skill-executors/find-edit-element.executor.ts:77` (154 chars)
- `DesignEcho-Agent/src/renderer/services/tool-executor.service.ts:65` (154 chars)
- `DesignEcho-Agent/src/main/index.ts:1160` (153 chars)
- `DesignEcho-Agent/src/main/ipc-handlers/websocket-handlers.ts:42` (153 chars)
- `DesignEcho-Agent/src/main/services/rag/vector-store.ts:112` (153 chars)
- `DesignEcho-Agent/src/renderer/components/KnowledgeManager.tsx:364` (153 chars)
- `DesignEcho-Agent/src/renderer/components/LayoutFixList.tsx:172` (153 chars)
- `DesignEcho-UXP/src/tools/image/remove-background.ts:1225` (153 chars)
- `DesignEcho-Agent/src/main/services/user-knowledge-service.ts:331` (152 chars)
- `DesignEcho-Agent/src/renderer/components/SettingsModal.tsx:467` (152 chars)
- `DesignEcho-Agent/src/renderer/services/skill-executors/sku-batch.executor.ts:1373` (152 chars)
- `DesignEcho-UXP/src/tools/image/export-layer.ts:205` (152 chars)
- `DesignEcho-Agent/src/main/services/matting-service.ts:853` (151 chars)
- `DesignEcho-Agent/src/main/services/rag/rag-service.ts:196` (151 chars)
- `DesignEcho-Agent/src/renderer/components/knowledge/ProjectIndexer.tsx:136` (151 chars)
- `DesignEcho-Agent/src/main/services/user-knowledge-service.ts:41` (150 chars)
- `DesignEcho-Agent/src/renderer/components/SettingsModal.tsx:1455` (150 chars)
- `DesignEcho-Agent/src/renderer/services/skill-executors/find-edit-element.executor.ts:85` (150 chars)
- `DesignEcho-Agent/src/renderer/services/tool-executor.service.ts:40` (150 chars)
- `DesignEcho-UXP/src/tools/image/remove-background.ts:1143` (150 chars)
- `DesignEcho-Agent/src/renderer/components/ChatPanel.tsx:274` (149 chars)
- `DesignEcho-Agent/src/renderer/components/ChatPanel.tsx:1268` (149 chars)
- `DesignEcho-Agent/src/renderer/services/skill-executors/layout-replication.executor.ts:110` (149 chars)
- `DesignEcho-Agent/src/renderer/services/skill-executors/main-image.executor.ts:641` (149 chars)
- `DesignEcho-UXP/src/tools/image/place-image.ts:243` (149 chars)
- `playwright-skill/lib/helpers.js:359` (149 chars)

## Suggested Execution Order

1. Split oversized orchestrators/entry files first (`main/index.ts`, `uxp/index.ts`, large React containers).
2. Replace nested ternary chains with explicit `if/else` or `switch`.
3. Extract repeated status/message update blocks into named functions.
4. Reduce `any` usage in high-churn modules by adding stable local interfaces.
5. Keep each simplification batch behavior-neutral and verifiable via existing build/test commands.
