# 推銀仔機

瀏覽器 3D 推銀仔機遊戲。Vite + TypeScript + three.js + Rapier (WASM)，冇後端，進度存喺 localStorage。

## 點樣行

```bash
npm install
npm run dev        # 開發模式，預設 http://localhost:5173
npm run build      # tsc 檢查 + 打包去 dist/
npm run preview    # 預覽打包結果
```

需要 Node 20 或以上。

## 點樣玩

- 點擊（電腦）或者掂（手機）機器上方任何位置，就會喺嗰個 x 位置投一粒銀仔，每粒扣 1 信用點。每撳一下只會投一次，想自動投就要喺商店買自動投幣機。
- 上層推板會前後掃，推住下面嘅銀仔。跌出前面就贏錢，跌出兩邊就蝕。
- 中間嘅 JACKPOT 洞：銀仔跌入去會觸發老虎機（唔會計錢），有銀幣雨、特殊幣同「護欄」（10 秒封住兩邊）。
- 銀仔種類：銀幣 +1、金幣 +5、大幣 +5、炸彈（跌出或者停低幾秒就爆炸，彈開附近銀仔）、寶石（五色集齊一套 +100）。
- 商店可以升級推板速度、側欄高度、每次投幣數量、特殊幣機率、自動投幣機。
- 進度（信用點、升級、寶石）會自動儲存。排行榜記錄信用點最高峰同最大 Jackpot 獎勵，各十名，用日期做標籤。
- 信用點用晒會出現救濟金掣。

## 開發備註

開發模式下 `window.__game` 可以俾自動化測試用：`credits`、`bodies`、`slotPhase`、`drop(x)`、`forceSlot()`、`advance(秒)`。正式打包唔會包含。

檔案分工：`world.ts` 場景同物理世界，`coins.ts` 銀仔種類同 InstancedMesh，`pusher.ts` 推板，`slot.ts` 老虎機，`shop.ts` 升級，`save.ts` 存檔同排行榜，`game.ts` 經濟狀態，`input.ts` 滑鼠同觸控，`ui.ts` 介面，`audio.ts` WebAudio 合成音效。
