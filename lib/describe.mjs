import { askClaude, cached } from "./translate.mjs";

export function buildDescribePrompt(name, description) {
  return `你是一位很會教人的台灣工程師。讀者英文不好，正在學習看懂 Claude Code 的 skill（寫給 AI 看的工作手冊）。

Claude 平常只看得到每個 skill 的 description，靠它決定要不要載入這個 skill。下面是 skill「${name}」的 description。請讀懂它，用白話的繁體中文（台灣用語）回答兩件事：
- "what"：這個 skill 叫 Claude 做什麼。1～2 句，講實際的動作，不要逐字翻譯。
- "when"：什麼情況下會用到它，也就是使用者說什麼話、或 Claude 碰到什麼狀況時會觸發。1～2 句。如果 description 完全沒提到什麼時候用，給 ""。

同一句話可能同時講了兩件事（例如 "Apply after X. Verify Y."），要把它拆開放到對的欄位。程式碼、skill 名稱、指令（例如 /tdd）保持英文原樣。

只輸出一個 JSON 物件：{"what": "...", "when": "..."}。不要輸出任何其他文字或 markdown 圍欄。

description：
${description}`;
}

export function parseDescribe(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("description 整理結果不是 JSON");
  const r = JSON.parse(text.slice(start, end + 1));
  return { what: String(r?.what ?? ""), when: String(r?.when ?? "") };
}

export const describe = (skill) => {
  const description = String(skill.frontmatter.description ?? "");
  return cached(["describe", skill.name, description], () => askClaude(buildDescribePrompt(skill.name, description), parseDescribe));
};
