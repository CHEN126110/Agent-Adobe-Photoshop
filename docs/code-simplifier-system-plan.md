# DesignEcho Code Cleanup Plan

> Scope: `DesignEcho-Agent/src` + `DesignEcho-UXP/src` + `docs`
> Last updated: `2026-03-06`
> Baseline report: `docs/code-simplifier-baseline.md`
> Feature audit: `docs/agent-feature-audit-2026-03-04.md`

## 1. Goal

杩欎唤鏂囨。涓嶆槸鈥滀唬鐮佺編鍖栬鍒掆€濓紝鑰屾槸褰撳墠椤圭洰鐨勪唬鐮佹不鐞嗗熀绾裤€?
褰撳墠椤圭洰鐨勪富瑕侀棶棰樹笉鏄崟绾枃浠惰繃澶э紝鑰屾槸涓変欢浜嬪悓鏃跺瓨鍦細

1. 瀵瑰鏆撮湶鐨勮兘鍔涘浜庣湡姝ｉ棴鐜彲鐢ㄧ殑鑳藉姏銆?2. 鐢ㄦ埛闇€姹傛寔缁彔鍔犲悗锛岄仐鐣欎簡澶ч噺鏃у叆鍙ｃ€佸吋瀹硅矾寰勩€佷复鏃惰剼鏈拰鏈帴绾夸唬鐮併€?3. 鏂囨。銆佸姛鑳界姸鎬佸拰鐪熷疄杩愯璺緞鏈夊亸宸紝瀹规槗璁╁悗缁紑鍙戝熀浜庨敊璇鐭ョ户缁爢浠ｇ爜銆?
娌荤悊鐩爣锛?
1. 鍏堣鈥滅湡瀹炶兘鍔涜竟鐣屸€濇竻鏅般€?2. 鍐嶈鈥滆繍琛岄摼璺€濇敹鍙ｅ埌灏戞暟鍙俊鍏ュ彛銆?3. 鏈€鍚庡啀鍋氬ぇ浣撻噺妯″潡鎷嗗垎鍜岄鏍肩粺涓€銆?
## 2. Current Facts

鍩轰簬 `2026-03-04` 鐨勫熀绾垮璁″拰褰撳墠浠ｇ爜鎵弿锛屽綋鍓嶄簨瀹炲涓嬶細

1. 棣栨柟浠ｇ爜瀹¤鑼冨洿鍐呭叡鏈?`336` 涓簮鏂囦欢锛宍29` 涓枃浠惰秴杩?`800` 琛屻€?2. 鏈€澶х儹鐐逛粛鐒舵槸鍏ュ彛鍜岀紪鎺掑眰锛岃€屼笉鏄簳灞傜畻娉曞眰锛?   - `DesignEcho-Agent/src/main/index.ts`
   - `DesignEcho-UXP/src/index.ts`
   - `DesignEcho-Agent/src/renderer/components/ChatPanel.tsx`
   - `DesignEcho-Agent/src/renderer/components/SettingsModal.tsx`
   - `DesignEcho-UXP/src/tools/image/remove-background.ts`
   - `DesignEcho-UXP/src/tools/layout/sku-layout-tool.ts`
3. 缁熶竴 Agent 宸茬粡鎴愪负涓昏矾寰勶紝浣嗕粛娣锋湁鏃ц鍒欍€佹棫瀛楁銆佹棫鍏煎鍏ュ彛銆?4. `agent-feature-audit-2026-03-04.md` 宸茬粡鏄庣‘璇嗗埆鍑轰竴鎵光€滃０鏄庝簡浣嗘湭褰㈡垚绋冲畾闂幆鈥濈殑鎶€鑳姐€?5. 浠撳簱鍐呬粛瀛樺湪鏈寮曠敤鐨勭粍浠躲€佷复鏃?smoke 鑴氭湰銆佸簾寮冨叆鍙ｅ拰鍏煎鍒悕锛岃繖浜涘唴瀹逛細鎸佺画骞叉壈鍒ゆ柇銆?
## 3. Governance Rules

浠庢湰杞紑濮嬶紝浠ｇ爜娓呯悊鎸変笅闈㈢殑瑙勫垯鎵ц锛?
1. 鍏堟敹鍙ｈ兘鍔涳紝鍐嶄紭鍖栧啓娉曘€?   - 娌℃湁瀹屾暣鈥滃０鏄?+ 璺敱 + 鎵ц + 杩斿洖缁撴灉 + 鐘舵€佽鏄庘€濈殑鍔熻兘锛屼笉搴旂户缁澶栨毚闇层€?2. 鏈畬鎴愬姛鑳介粯璁ら殣钘忔垨绉婚櫎锛屼笉缁х画鈥滃厛鎸傚叆鍙ｅ啀琛ュ疄鐜扳€濄€?3. `docs/project-status.md` 鏄敮涓€鐘舵€佺湡鐩告簮銆?   - 鏂板銆佷笅绾裤€佺鐢ㄣ€佸緟娴嬭瘯鐘舵€侀兘蹇呴』鍥炲啓杩欓噷銆?4. 鍚屼竴鑱岃矗鍙繚鐣欎竴涓富鍏ュ彛銆?   - 鍏煎鍒悕蹇呴』鏈夋竻鐞嗘湡闄愶紝涓嶈兘闀挎湡鍏卞瓨銆?5. 涓存椂鑴氭湰蹇呴』婊¤冻浜岄€変竴锛?   - 瑕佷箞杩涘叆姝ｅ紡 `scripts/` 骞跺啓鐢ㄩ€旇鏄庛€?   - 瑕佷箞鍒犻櫎銆?6. 鏃犲紩鐢ㄦ枃浠朵笉榛樿淇濈暀銆?   - 鈥滀互鍚庡彲鑳芥湁鐢ㄢ€濅笉鏄繚鐣欑悊鐢便€?7. 澶ф枃浠舵媶鍒嗕紭鍏堟寜杩愯杈圭晫鎷嗭紝涓嶆寜鏈烘琛屾暟鎷嗐€?
## 4. Priority Order

### P0: Capability Closure

鍏堣В鍐斥€滈」鐩湅璧锋潵浼氾紝瀹為檯涓婁笉绋冲畾鎴栦笉瀹屾暣鈥濈殑闂銆?
1. 閫愪釜鏍稿 `skill-declarations.ts` 涓凡澹版槑鎶€鑳界殑鐪熷疄闂幆鎯呭喌銆?2. 瀵规湭褰㈡垚闂幆鐨勮兘鍔涘仛浜岄€変竴锛?   - 琛ラ綈鎵ц閾捐矾鍜岄獙璇?   - 浠庡０鏄庛€佽矾鐢便€乁I 鏆撮湶涓Щ闄?3. 瀵?`project-status.md` 涓€滆鍒掍腑 / 寰呮祴璇?/ 宸插畬鎴愨€濆仛涓€娆℃寜浠ｇ爜鍥炲啓銆?
### P1: Runtime Path Cleanup

鍦ㄤ笉鏀瑰彉鍔熻兘缁撴灉鐨勫墠鎻愪笅锛屾竻鐞嗚瀵兼€х殑鏃ц矾寰勩€?
1. 娓呯悊鏈寮曠敤鐨勭粍浠躲€佽剼鏈€佷复鏃剁洰褰曞唴瀹广€?2. 閫愭绉婚櫎宸插簾寮冪殑 legacy 鍏ュ彛鍜屼粎涓哄吋瀹逛繚鐣欑殑鍒悕璺緞銆?3. 鏀跺彛缁熶竴 Agent銆丆hat銆乼ool executor 涔嬮棿鐨勫疄闄呰皟鐢ㄩ摼銆?
### P2: Oversized File Decomposition

鍙湪鑳藉姏杈圭晫娓呮浠ュ悗鍐嶆媶澶ф枃浠躲€?
1. `DesignEcho-Agent/src/main/index.ts`
2. `DesignEcho-UXP/src/index.ts`
3. `DesignEcho-Agent/src/renderer/components/ChatPanel.tsx`
4. `DesignEcho-Agent/src/renderer/services/unified-agent.service.ts`

鎷嗗垎鍘熷垯锛?
1. 鍏堟娊杩愯杈圭晫锛屽啀鎶藉伐鍏峰嚱鏁般€?2. 瀵瑰鎺ュ彛鍜岃繑鍥炵粨鏋勪繚鎸佷笉鍙樸€?3. 姣忔鍙媶涓€鏉″瀭鐩撮摼璺紝閬垮厤妯悜澶ф惉瀹躲€?
## 5. First Batch Checklist

杩欎竴鎵圭殑鐩爣涓嶆槸鈥滃ぇ閲嶆瀯鈥濓紝鑰屾槸鍏堝噺灏戣瀵兼€т唬鐮侊細

1. 鍒犻櫎鏃犲紩鐢ㄧ殑澶х粍浠跺拰涓存椂 smoke 鏂囦欢銆?2. 寤虹珛缁熶竴浠ｇ爜娌荤悊鏂囨。锛岄伩鍏嶇户缁浠借鍒掑苟瀛樸€?3. 主进程入口已收口到当前模块化主入口，不再保留并行的 legacy main entry。
## 6. Done In This Batch

鎴嚦 `2026-03-06`锛屽凡瀹屾垚锛?
1. 鍒犻櫎鏃犲紩鐢ㄧ粍浠讹細
   - `DesignEcho-Agent/src/renderer/components/KnowledgeManager.tsx`
2. 鍒犻櫎鏈寮曠敤鐨勪复鏃?decision smoke 鏂囦欢锛?   - `DesignEcho-Agent/tmp/decision-debug-smoke.cjs`
   - `DesignEcho-Agent/tmp/decision-debug-smoke.ts`
   - `DesignEcho-Agent/tmp/tsconfig.smoke.json`
3. 灏嗕唬鐮佹不鐞嗗彛寰勬敹鏁涘埌鏈枃浠躲€?
4. 缁夊娅庨獮鎯邦攽閺?Skills 缁崵绮哄▓瀣╃稇娴狅絿鐖滈敍?
   - `DesignEcho-Agent/src/renderer/components/SkillsPanel.tsx`
   - `DesignEcho-Agent/src/renderer/services/skills.service.ts`
   - `DesignEcho-Agent/src/main/ipc-handlers/skill-handlers.ts`
   - `DesignEcho-Agent/src/main/services/skills/*`
   - `DesignEcho-Agent/src/main/ipc-handlers/index.ts` 娑撳秴鍟€濞夈劌鍞?`registerSkillHandlers()`
## 7. Acceptance Criteria

姣忎竴鎵逛唬鐮佹不鐞嗛兘瑕佹弧瓒筹細

1. 鏀瑰姩鑼冨洿鍙В閲婏紝鑳借鏄庘€滀负浠€涔堝垹鈥濆拰鈥滀负浠€涔堜繚鐣欌€濄€?2. 琚垹鍐呭鍙瘉鏄庢湭鎺ュ叆涓婚摼璺紝鎴栧凡琚浛浠ｃ€?3. 瑙﹁揪婧愮爜鐨勬敼鍔ㄨ嚦灏戦€氳繃瀵瑰簲椤圭洰鐨勬瀯寤烘牎楠屻€?4. 鏂囨。鐘舵€佷笌浠ｇ爜鐘舵€佸悓姝ワ紝涓嶅啀鍑虹幇鈥滀唬鐮佸拰鏂囨。鍚勮鍚勮瘽鈥濄€?
## 8. Commands

```powershell
node scripts/code-simplifier-audit.js
cd DesignEcho-Agent
npm run build:main
cd ../DesignEcho-UXP
npm run build
```
