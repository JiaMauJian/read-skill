import { askClaude, cached } from "./translate.mjs";

export function buildFlowPrompt(name, body) {
  return `你是一位很會教人的台灣工程師。讀者正在學習看懂 Claude Code 的 skill（寫給 AI 看的工作手冊）。

請把下面這份 skill「${name}」畫成一張 Mermaid 流程圖，讓讀者一眼看懂 Claude 載入它之後會怎麼走：從哪裡開始、有哪些判斷分支、哪裡會轉交給其他 skill、哪裡要停下來問使用者、什麼時候算完成。

規則：
- 用 \`flowchart TD\`。節點 15 個以內，只畫主幹，細節省略。
- 每個節點的文字都用雙引號包起來，例如 A["寫一個會失敗的測試"]、B{"測試通過了嗎？"}。文字用繁體中文，skill 名稱和指令保持英文。文字裡不要再出現雙引號。
- 判斷用菱形 {}，分支線上標條件，例如 B -->|"否"| C。
- 如果這份 skill 根本不是流程（例如只是一條原則、一份參考資料），mermaid 給 ""。

只輸出一個 JSON 物件：{"mermaid": "...", "summary": "用 1～2 句繁體中文說明這張圖的主線"}。不要輸出任何其他文字或 markdown 圍欄。

skill 內容：
${body}`;
}

export function parseFlow(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("流程圖結果不是 JSON");
  const r = JSON.parse(text.slice(start, end + 1));
  const mermaid = String(r?.mermaid ?? "").trim();
  if (mermaid && !/^flowchart\s/.test(mermaid)) throw new Error("流程圖不是 flowchart 語法");
  return { mermaid, summary: String(r?.summary ?? "") };
}

export const flowchart = (skill) => cached(["flow", skill.id, skill.body], () => askClaude(buildFlowPrompt(skill.name, skill.body), parseFlow));
