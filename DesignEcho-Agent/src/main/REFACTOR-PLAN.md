# index.ts 閲嶆瀯璁″垝

> 褰撳墠: 5457 琛?鈫?鐩爣: ~500 琛?(鍙傝€?index.ts)

## 鐜扮姸鍒嗘瀽

### 宸叉ā鍧楀寲
- **IPC Handlers**: 25 涓ā鍧楁枃浠?(`ipc-handlers/`)
- **UXP Handlers**: 11 涓ā鍧楁枃浠?(`uxp-handlers/`)

### 寰呰縼绉?(index.ts 涓粛鏈?54 涓唴鑱?handlers)

## 寰呰縼绉诲唴瀹瑰垎绫?

### 1. WebSocket UXP Handlers (~2000 琛?

index.ts 涓ぇ閲?`wsServer.on('action', ...)` 瀹氫箟闇€瑕佽縼绉伙細

| Handler 绫诲埆 | 浼拌琛屾暟 | 鐩爣鏂囦欢 |
|-------------|---------|----------|
| morphToShape | ~500 | `uxp-handlers/morphing-handlers.ts` |
| batchMorphToShape | ~300 | `uxp-handlers/morphing-handlers.ts` |
| autoAlign | ~200 | `uxp-handlers/layout-handlers.ts` |
| smartLayout | ~400 | `uxp-handlers/smart-layout-handlers.ts` |
| 鍏朵粬褰㈡€佺浉鍏?| ~600 | 鍒嗙被鏁寸悊 |

### 2. 浜岃繘鍒跺崗璁鐞?(~500 琛?

- `receivedBinaryImages` 缂撳瓨绠＄悊
- `onBinary` 澶勭悊鍣?
- 浜岃繘鍒跺浘鍍忚В鐮?缂栫爜

鈫?杩佺Щ鍒? `services/binary-protocol-service.ts`

### 3. 鏈嶅姟鍒濆鍖栭€昏緫 (~300 琛?

- 鍚勬湇鍔＄殑鍒濆鍖栦唬鐮?
- 渚濊禆娉ㄥ叆閰嶇疆

鈫?淇濈暀鍦?index.ts锛屼絾绠€鍖栦负鍑芥暟璋冪敤

### 4. 璋冭瘯/璇婃柇浠ｇ爜 (~200 琛?

- `morphExecutionCount`
- 鍚勭璋冭瘯鏃ュ織
- 涓存椂璇婃柇浠ｇ爜

鈫?娓呯悊鎴栬縼绉诲埌璋冭瘯妯″潡

## 杩佺Щ绛栫暐

### 闃舵 1: UXP Morphing Handlers
1. 鍒涘缓 `uxp-handlers/morphing-handlers.ts`
2. 杩佺Щ morphToShape, batchMorphToShape 绛?
3. 浠?index.ts 璋冪敤妯″潡鍖?handler

### 闃舵 2: 浜岃繘鍒跺崗璁?
1. 鍒涘缓 `services/binary-protocol-service.ts`
2. 灏佽浜岃繘鍒剁紦瀛樺拰澶勭悊閫昏緫
3. 瀵煎嚭绠€娲佹帴鍙?

### 闃舵 3: 鏈嶅姟鍒濆鍖?
1. 鍒涘缓 `services/service-initializer.ts`
2. 缁熶竴绠＄悊鏈嶅姟鐢熷懡鍛ㄦ湡
3. 绠€鍖?index.ts 鍚姩娴佺▼

### 闃舵 4: 娓呯悊
1. 绉婚櫎璋冭瘯浠ｇ爜
2. 缁熶竴鏃ュ織鏍煎紡
3. 鏈€缁堥獙璇?

## 鍙傝€?

- `index.ts`: 442 琛岀殑绮剧畝鐗堟湰
- 鐩爣: index.ts 鍙礋璐ｅ簲鐢ㄥ惎鍔ㄥ拰妯″潡鍗忚皟

## 椋庨櫓

1. **杩愯鏃朵緷璧?*: 璁稿 handler 渚濊禆闂寘涓殑鏈嶅姟瀹炰緥
2. **寰幆渚濊禆**: 妯″潡闂村彲鑳藉瓨鍦ㄥ惊鐜紩鐢?
3. **绫诲瀷瀹夊叏**: 鎷嗗垎鏃堕渶纭繚绫诲瀷姝ｇ‘浼犻€?

## 寤鸿

鑰冭檻鍒伴闄╋紝寤鸿閲囩敤娓愯繘寮忚縼绉伙細
1. 姣忔鍙縼绉讳竴涓?handler 绫诲埆
2. 杩佺Щ鍚庣珛鍗虫祴璇?
3. 浣跨敤 re-export 淇濇寔鍏煎
