# Read Skill — 學會讀懂 Claude Code skill

掃描你電腦上已安裝的 skill（`~/.claude/plugins` 和 `~/.claude/skills`），在瀏覽器裡一步步教你怎麼讀。預設會顯示 mattpocock-skills 和 pstack。

## 啟動

```
npm start
```

會自動打開 http://localhost:4321（換 port：`PORT=5000 npm start`，不想自動開瀏覽器：`node server.mjs --no-open`）。不需要 `npm install`，只要 Node 18 以上。

## 有什麼功能

- **怎麼讀 skill**：skill 的結構、Claude 分三層載入的機制、六步閱讀法、兩套 skill 的風格統計，以及建議的閱讀路線。
- **每個 skill 的閱讀頁**
  1. description 拆成「做什麼／何時用」
  2. frontmatter 逐欄解說（`user-invocable`、`disable-model-invocation` 等）
  3. 骨架統計和類型猜測（流程型、參考型、路由器、短指令）
  4. 正文：其他 skill 顯示成綠色連結，附屬檔案顯示成藍色（點了從側邊打開），硬規則用黃底標出
  5. 附屬檔案列表
  6. 關聯：它點名誰、誰點名它
  7. 筆記和「我讀懂了」勾選（存在瀏覽器 localStorage）
- **🀄 中文對照**：按一下，每段英文下面會出現繁體中文翻譯，看不懂的地方另外附「💡 白話」解釋。翻譯透過本機的 `claude -p` 執行（用你登入的 Claude Code 帳號，不需要 API key），結果存在 `cache/`，同一份 skill 只會翻一次。換模型：`READ_SKILL_MODEL=haiku npm start`。
- **🧑‍💻 程式碼對照**：中文對照裡，跟寫程式有關的規則會附上「❌ 不照做／✅ 照做」的小段程式碼。
- **🗺️ 流程圖**：在 skill 頁面按一下，Claude 會把整份 skill 畫成 Mermaid 流程圖（起點、分支、轉交其他 skill、何時完成）。同樣存在 `cache/`，畫圖需要連網載入 Mermaid。
- **術語提示**：seam、subagent、diff、slop 等常見術語畫虛線底，滑鼠移上去會跳出中文解釋（`public/glossary.js` 可以自己加詞）。
- 側欄可以篩選 plugin、呼叫方式（自動＋手動 / 只能手動 / 背景知識），也能搜尋。

## 測試

```
npm test
```
