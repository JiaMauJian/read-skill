import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const CACHE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "cache");
const CHUNK = 25;
const PROMPT_VERSION = 2;
const PARALLEL = 3;
const MODEL = process.env.READ_SKILL_MODEL || "sonnet";
const inflight = new Map();

export function buildPrompt(blocks) {
  return `你是一位很會教人的台灣工程師。讀者英文不好，正在學習看懂 Claude Code 的 skill（寫給 AI 看的工作手冊）。

下面是一份 skill 裡依序切出來的段落（JSON 陣列）。請對每一段輸出：
- "zh"：自然、通順的繁體中文翻譯（台灣用語）。程式碼、檔名、skill 名稱、指令（例如 /tdd、SKILL.md、\`Agent\`）保持英文原樣。專有名詞第一次出現時，用「中文（English）」的格式。
- "plain"：白話解釋，1～2 句。說明這段實際上是在叫 Claude 做什麼，或這個抽象概念在現實中長什麼樣子。如果翻譯本身已經很好懂（例如很短的標題），就給空字串 ""。
- "why"：只有當這段是規則、指令或做法時才填，標題和單純的描述給 ""。用 2～4 句說明「為什麼要這樣做」，並舉一個具體的例子，對比照做和不照做的結果（例如寫程式時會發生什麼事）。例子要貼近日常的程式開發情境。
- "whyFrom"：如果理由是原文（這段或同一份 skill 的其他段落）自己寫出來的，填 "原文"；如果原文沒寫、是你推論作者的用意，填 "推測"。不要把推測講成作者說的。來源由這個欄位標示，why 的內文裡不用再寫「原文沒說」之類的話。why 為空時給 ""。

只輸出一個 JSON 陣列，長度必須是 ${blocks.length}，順序對應輸入，每個元素是 {"zh": "...", "plain": "...", "why": "...", "whyFrom": "..."}。不要輸出任何其他文字或 markdown 圍欄。

段落：
${JSON.stringify(blocks, null, 1)}`;
}

export function parseResult(text, expected) {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error("翻譯結果不是 JSON 陣列");
  const arr = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(arr) || arr.length !== expected) throw new Error(`翻譯段數不符：預期 ${expected}，拿到 ${arr.length}`);
  return arr.map((r) => {
    const why = String(r?.why ?? "");
    return { zh: String(r?.zh ?? ""), plain: String(r?.plain ?? ""), why, whyFrom: why ? (r?.whyFrom === "原文" ? "原文" : "推測") : "" };
  });
}

function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    // No tools and no hooks: the subprocess should only translate, never act or load skills.
    const args = ["-p", "--model", MODEL, "--tools", '""', "--no-session-persistence", "--output-format", "text",
      "--settings", process.platform === "win32" ? '"{\\"disableAllHooks\\":true}"' : "'{\"disableAllHooks\":true}'"];
    const child = spawn("claude", args, { shell: true, cwd: tmpdir(), windowsHide: true });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(err.trim() || `claude 結束碼 ${code}`))));
    child.stdin.end(prompt);
  });
}

async function translateChunk(blocks) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return parseResult(await runClaude(buildPrompt(blocks)), blocks.length);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

async function translateUncached(blocks) {
  const chunks = [];
  for (let i = 0; i < blocks.length; i += CHUNK) chunks.push(blocks.slice(i, i + CHUNK));
  const results = new Array(chunks.length);
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const i = next++;
      results[i] = await translateChunk(chunks[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, chunks.length) }, worker));
  return results.flat();
}

export async function translate(blocks) {
  const key = createHash("sha1").update(MODEL + "\n" + JSON.stringify(blocks)).digest("hex");
  const file = join(CACHE_DIR, key + ".json");
  if (existsSync(file)) return { results: JSON.parse(await readFile(file, "utf8")), cached: true };
  if (!inflight.has(key)) {
    inflight.set(key, (async () => {
      const results = await translateUncached(blocks);
      await mkdir(CACHE_DIR, { recursive: true });
      await writeFile(file, JSON.stringify(results));
      return results;
    })().finally(() => inflight.delete(key)));
  }
  return { results: await inflight.get(key), cached: false };
}
