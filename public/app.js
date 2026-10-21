import { GLOSSARY, TERM_RE } from "./glossary.js";

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const FOCUS = ["mattpocock-skills", "pstack"];

const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  },
};

let skills = [];
const filters = { plugins: new Set(store.get("plugins", FOCUS)), mode: "all", q: "" };
const notes = store.get("notes", {});

const MODES = {
  all: { label: "全部", test: () => true },
  both: { label: "自動＋手動", test: (s) => s.invocation.user && s.invocation.model },
  user: { label: "只能手動 /", test: (s) => s.invocation.user && !s.invocation.model },
  bg: { label: "背景知識", test: (s) => !s.invocation.user },
};

const FRONTMATTER_HELP = {
  name: "skill 的識別名稱，也是你打 <code>/名稱</code> 時用的指令。",
  description: "<b>最重要的一行。</b>它永遠放在 Claude 的 context 裡，Claude 只靠這段話決定要不要載入這個 skill。正文要等觸發之後才會被讀到。",
  "user-invocable": "設成 <code>false</code>：不會出現在 <code>/</code> 選單，只給 Claude 自己在需要時引用，相當於背景知識。",
  "disable-model-invocation": "設成 <code>true</code>：Claude 不會自己觸發它，只有你打 <code>/名稱</code> 才會執行。適合有副作用或需要你主動決定的流程。",
  "argument-hint": "打 <code>/名稱</code> 時提示可以接哪些參數。",
  paths: "限定只在處理符合這些路徑的檔案時，才自動考慮這個 skill。",
  "allowed-tools": "執行這個 skill 時預先允許的工具。",
  metadata: "額外的描述資訊。",
};

function invocationBadges(s) {
  const { user, model } = s.invocation;
  const out = [];
  if (user) out.push(`<span class="badge b-user" title="你可以打 /${esc(s.name)} 叫它">👤 你可以打 /${esc(s.name)}</span>`);
  if (model) out.push(`<span class="badge b-model" title="Claude 看到符合 description 的情境會自己載入">🤖 Claude 會自動觸發</span>`);
  if (!user) out.push(`<span class="badge b-bg" title="不在 / 選單裡">📚 背景知識（不在 / 選單）</span>`);
  return out.join("");
}

function invocationHint(s) {
  const { user, model } = s.invocation;
  if (user && !model) return "這個 skill 關掉了自動觸發，所以 description 只要說清楚「做什麼」，不必寫「什麼時候用」。Claude 不會自己挑它，要你主動打指令。";
  if (!user) return "這是給 Claude 參考的背景知識，通常是被其他 skill 點名引用，或在符合 description 的情境下載入。你在 / 選單裡看不到它。";
  if (!s.description.when) return "這段 description 沒有明確的「Use when…」觸發句，Claude 只能從「做什麼」去推測何時使用，觸發會比較不穩定。";
  return "Claude 平常只看得到這段文字。它會拿你說的話和「何時用」比對，符合就載入整份 SKILL.md。所以讀 skill 要先讀這裡。";
}

function guessKind(s) {
  const text = s.outline.map((h) => h.text).join(" ");
  if (s.calls.length >= 6) return ["路由器", "它點名了很多其他 skill，主要工作是判斷情境，再把 Claude 導向對的 skill 或流程。"];
  if (/step|phase|loop|round|workflow|process|流程|\b\d\./i.test(text)) return ["流程型", "標題看起來是一步一步的流程，讀的時候順著步驟走，注意每一步的進入和結束條件。"];
  if (s.words < 250) return ["短指令", "篇幅很短，通常是一條原則，或把工作轉交給別的 skill。每一句都是規則。"];
  return ["參考型", "主要是規則、詞彙或判斷標準，讓 Claude 做事時查閱。讀的時候抓「要做／不准做」。"];
}

// ---------- markdown ----------

function inline(text) {
  const codes = [];
  let s = esc(text).replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = s
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => `<a href="${u}" data-href="${u}">${t}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^\w*])\*([^*\s][^*]*)\*(?!\w)/g, "$1<em>$2</em>")
    .replace(/(^|[^\w])_([^_\s][^_]*)_(?!\w)/g, "$1<em>$2</em>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

function md(src) {
  const lines = src.replace(/\r/g, "").split("\n");
  const out = [];
  let para = [];
  let lists = [];
  let hid = 0;
  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`);
    para = [];
  };
  const closeLists = (indent = -1) => {
    while (lists.length && lists.at(-1).indent > indent) out.push(`</li></${lists.pop().tag}>`);
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^\s*(```|~~~)/);
    if (fence) {
      flushPara(); closeLists();
      const buf = [];
      while (++i < lines.length && !lines[i].trim().startsWith(fence[1])) buf.push(lines[i]);
      out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (h) {
      flushPara(); closeLists();
      out.push(`<h${h[1].length} id="h-${hid++}">${inline(h[2])}</h${h[1].length}>`);
      continue;
    }
    if (/^\s*\|/.test(line) && /^\s*\|?[\s:|-]+\|/.test(lines[i + 1] ?? "")) {
      flushPara(); closeLists();
      const row = (l, tag) => "<tr>" + l.trim().replace(/^\||\|$/g, "").split("|").map((c) => `<${tag}>${inline(c.trim())}</${tag}>`).join("") + "</tr>";
      const rows = [row(line, "th")];
      i++;
      while (i + 1 < lines.length && /^\s*\|/.test(lines[i + 1])) rows.push(row(lines[++i], "td"));
      out.push(`<table>${rows.join("")}</table>`);
      continue;
    }
    if (/^\s*>/.test(line)) {
      flushPara(); closeLists();
      out.push(`<blockquote>${inline(line.replace(/^\s*>\s?/, ""))}</blockquote>`);
      continue;
    }
    const li = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (li) {
      flushPara();
      const indent = li[1].length;
      const tag = /\d/.test(li[2]) ? "ol" : "ul";
      closeLists(indent);
      if (lists.length && lists.at(-1).indent === indent) out.push("</li><li>");
      else { lists.push({ indent, tag }); out.push(`<${tag}><li>`); }
      out.push(inline(li[3]));
      continue;
    }
    if (!line.trim()) { flushPara(); continue; }
    if (lists.length && /^\s+\S/.test(line)) { out.push(" " + inline(line.trim())); continue; }
    closeLists();
    para.push(line.trim());
  }
  flushPara(); closeLists();
  return out.join("");
}

// ---------- annotation ----------

function kebab(t) {
  return t.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-");
}

function findSkill(raw, from) {
  const t = raw.trim().replace(/^\//, "").replace(/[.:]$/, "");
  const exact = skills.find((s) => s.id === t);
  if (exact) return exact;
  return skills.find((s) => s.plugin === from.plugin && s.id !== from.id && (s.name === t || s.name === "principle-" + kebab(t)));
}

function findFile(raw, skill) {
  const t = raw.replace(/^\.\//, "");
  return skill.supporting.find((f) => f === t || f.endsWith("/" + t));
}

const RULE_RE = /\b(MUST|NEVER|ALWAYS|must not|must|never|always|don't|do not|only|required|IMPORTANT|Non-negotiables?)\b/g;

function annotate(root, skill) {
  for (const el of root.querySelectorAll("code, strong")) {
    if (el.closest("pre") || el.children.length) continue;
    const target = findSkill(el.textContent, skill);
    if (target) { el.replaceWith(link(`#/skill/${target.id}`, "skill-ref", el.textContent, target.description.what || target.description.when)); continue; }
    const file = el.tagName === "CODE" && findFile(el.textContent, skill);
    if (file) el.replaceWith(fileLink(file, el.textContent));
  }
  for (const a of root.querySelectorAll("a[data-href]")) {
    const file = findFile(a.dataset.href, skill);
    if (file) a.replaceWith(fileLink(file, a.textContent));
    else if (/^https?:/.test(a.dataset.href)) a.target = "_blank";
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts = [];
  while (walker.nextNode()) if (!walker.currentNode.parentElement.closest("pre, code, a")) texts.push(walker.currentNode);
  const names = skills.filter((s) => s.id !== skill.id).flatMap((s) => (s.plugin === skill.plugin ? [s.id, s.name] : [s.id]));
  const refRe = new RegExp(`"(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).sort((a, b) => b.length - a.length).join("|")})"|\\b([\\w-]+:[\\w-]+)\\b`, "g");
  const seenTerms = new Set();
  const rules = (t) => esc(t).replace(RULE_RE, '<mark class="rule">$1</mark>');
  const marked = (t) => {
    let out = "", last = 0;
    for (const m of t.matchAll(TERM_RE)) {
      const key = m[0].toLowerCase();
      if (seenTerms.has(key)) continue;
      seenTerms.add(key);
      out += rules(t.slice(last, m.index)) + `<abbr class="term" data-zh="${esc(GLOSSARY[key])}">${esc(m[0])}</abbr>`;
      last = m.index + m[0].length;
    }
    return out + rules(t.slice(last));
  };
  for (const node of texts) {
    if ([RULE_RE, refRe, TERM_RE].every((re) => node.nodeValue.search(re) < 0)) continue;
    let html = "", last = 0;
    for (const m of node.nodeValue.matchAll(refRe)) {
      const target = findSkill(m[1] ?? m[2], skill);
      if (!target) continue;
      html += marked(node.nodeValue.slice(last, m.index)) + `<a class="skill-ref" href="#/skill/${target.id}">${esc(m[0])}</a>`;
      last = m.index + m[0].length;
    }
    const span = document.createElement("span");
    span.innerHTML = html + marked(node.nodeValue.slice(last));
    node.replaceWith(...span.childNodes);
  }
}

// ---------- translation ----------

const zhPref = () => document.body.classList.contains("show-zh");
const claudeFailed = (what, e) => `${what}失敗：${e.message}。請確認終端機可以執行 claude 指令。`;

function textOf(el) {
  if (el.tagName === "TR") return [...el.cells].map((c) => c.textContent.trim()).join(" | ");
  const clone = el.cloneNode(true);
  clone.querySelectorAll("ul, ol, .zh, .label").forEach((n) => n.remove());
  return clone.textContent.replace(/\s+/g, " ").trim();
}

function zhBox(r) {
  const div = document.createElement("div");
  div.className = "zh";
  div.innerHTML = `<div class="zh-t">${esc(r.zh)}</div>` +
    (r.plain ? `<div class="zh-p">💡 <b>白話</b>　${esc(r.plain)}</div>` : "") +
    (r.why ? `<div class="zh-w">🤔 <b>為什麼</b> <span class="src src-${r.whyFrom === "原文" ? "orig" : "guess"}" title="${r.whyFrom === "原文" ? "skill 原文自己寫了這個理由" : "原文沒寫理由，這是 Claude 推測作者的用意"}">${r.whyFrom === "原文" ? "原文有寫" : "推測"}</span>　${esc(r.why)}</div>` : "") +
    (r.code ? `<div class="zh-c">🧑‍💻 <b>程式碼對照</b><pre><code>${esc(r.code)}</code></pre></div>` : "");
  return div;
}

function placeZh(el, box) {
  if (el.tagName === "TR") {
    const tr = document.createElement("tr");
    tr.className = "zh-row";
    const td = tr.insertCell();
    td.colSpan = el.cells.length;
    td.append(box);
    el.after(tr);
  } else if (el.tagName === "LI") {
    const nested = [...el.children].find((c) => c.tagName === "UL" || c.tagName === "OL");
    nested ? el.insertBefore(box, nested) : el.append(box);
  } else if (/^H\d$|^P$|^BLOCKQUOTE$/.test(el.tagName)) {
    el.after(box);
  } else {
    el.append(box);
  }
}

async function translateIn(container, status, extra = []) {
  const els = [...extra, ...container.querySelectorAll("h1, h2, h3, h4, h5, h6, p, li, blockquote, tr:not(.zh-row)")]
    .filter((el) => !el.dataset.zh && /[A-Za-z]{2}/.test(textOf(el)));
  if (!els.length) return;
  status.textContent = `翻譯中（${els.length} 段）… 第一次翻這份大約要 10～90 秒，之後會記住，下次直接顯示。`;
  els.forEach((el) => (el.dataset.zh = "pending"));
  try {
    const res = await fetch("/api/translate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ blocks: els.map(textOf) }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    els.forEach((el, i) => { el.dataset.zh = "done"; placeZh(el, zhBox(data.results[i])); });
    status.textContent = data.cached ? "✓ 已顯示中文（之前翻過）" : "✓ 翻譯完成，已存起來";
  } catch (e) {
    els.forEach((el) => delete el.dataset.zh);
    status.textContent = claudeFailed("翻譯", e);
  }
}

function setZh(on) {
  document.body.classList.toggle("show-zh", on);
  store.set("zh", on);
  document.querySelectorAll(".zh-toggle").forEach((b) => (b.textContent = on ? "🀄 中文對照：開" : "🀄 中文對照：關"));
}

function link(href, cls, text, title = "") {
  const a = document.createElement("a");
  a.href = href; a.className = cls; a.textContent = text; a.title = title;
  return a;
}

function fileLink(path, text) {
  const a = link("#", "file-ref", text, path);
  a.dataset.file = path;
  return a;
}

// ---------- sidebar ----------

function visible() {
  const q = filters.q.toLowerCase();
  return skills.filter((s) => filters.plugins.has(s.plugin) && MODES[filters.mode].test(s) &&
    (!q || s.name.includes(q) || String(s.frontmatter.description ?? "").toLowerCase().includes(q)));
}

function renderSidebar(currentId) {
  const plugins = [...new Set(skills.map((s) => s.plugin))];
  $("#plugins").innerHTML = plugins.map((p) => `<button class="chip ${filters.plugins.has(p) ? "on" : ""}" data-plugin="${p}">${p}</button>`).join("");
  $("#modes").innerHTML = Object.entries(MODES).map(([k, m]) => `<button class="chip ${filters.mode === k ? "on" : ""}" data-mode="${k}">${m.label}</button>`).join("");
  const list = visible();
  const done = list.filter((s) => notes[s.id]?.done).length;
  $("#progress").textContent = `顯示 ${list.length} 個 · 已讀懂 ${done} 個`;
  let html = "", lastGroup = null;
  for (const s of list) {
    const group = s.plugin + (s.category ? " / " + s.category : "");
    if (group !== lastGroup) { html += `<li class="cat">${esc(group)}</li>`; lastGroup = group; }
    const tag = !s.invocation.user ? "📚" : !s.invocation.model ? "👤" : "";
    html += `<li><a href="#/skill/${s.id}" class="${s.id === currentId ? "on" : ""}">${esc(s.name)}${notes[s.id]?.done ? '<span class="done">✓</span>' : ""}<span class="tag">${tag}</span></a></li>`;
  }
  $("#list").innerHTML = html || "<li class='cat'>沒有符合的 skill</li>";
}

// ---------- guide ----------

function pluginStats(plugin) {
  const list = skills.filter((s) => s.plugin === plugin);
  if (!list.length) return null;
  const avg = Math.round(list.reduce((a, s) => a + s.lines, 0) / list.length);
  const withFiles = list.filter((s) => s.supporting.length).length;
  const top = [...list].sort((a, b) => b.calledBy.length - a.calledBy.length).slice(0, 5).filter((s) => s.calledBy.length);
  return {
    count: list.length, avg, withFiles,
    user: list.filter(MODES.user.test).length,
    bg: list.filter(MODES.bg.test).length,
    both: list.filter(MODES.both.test).length,
    top,
  };
}

function statCard(title, plugin, notesHtml) {
  const st = pluginStats(plugin);
  if (!st) return `<div class="card"><h3>${title}</h3><p class="hint">這台電腦沒有安裝 ${plugin}。</p></div>`;
  return `<div class="card"><h3>${title}</h3>
    <div class="stat"><span>skill 數量</span><b>${st.count}</b></div>
    <div class="stat"><span>SKILL.md 平均行數</span><b>${st.avg}</b></div>
    <div class="stat"><span>有附屬檔案的</span><b>${st.withFiles}</b></div>
    <div class="stat"><span>🤖 自動＋👤 手動</span><b>${st.both}</b></div>
    <div class="stat"><span>👤 只能手動 /</span><b>${st.user}</b></div>
    <div class="stat"><span>📚 背景知識</span><b>${st.bg}</b></div>
    <p class="why">最常被其他 skill 點名：${st.top.map((s) => `<a href="#/skill/${s.id}">${s.name}</a>（${s.calledBy.length}）`).join("、") || "無"}</p>
    ${notesHtml}</div>`;
}

function pathLinks(ids) {
  return `<div class="path">${ids.map((id) => {
    const s = skills.find((x) => x.id === id);
    return s ? `<a href="#/skill/${id}">${s.name}</a>` : "";
  }).filter(Boolean).join("<span>→</span>")}</div>`;
}

function renderGuide() {
  $("#main").innerHTML = `
  <h1>怎麼讀懂一個 skill</h1>
  <p class="lede">skill 不是程式，是<b>寫給 Claude 看的工作手冊</b>。讀 skill 就是在讀「作者想讓 Claude 在什麼情況下、用什麼方式做事」。這頁先教你看的順序，再用你電腦上裝好的 mattpocock-skills 和 pstack 實際練習。</p>

  <h2>1. 一個 skill 長什麼樣子</h2>
  <div class="anatomy">skills/tdd/
<span class="fm">SKILL.md ── 開頭的 frontmatter（--- 包起來那段）
  name: tdd
  description: Test-driven development. Use when the user wants …   <em>← 觸發條件，永遠在 Claude 眼前</em></span><span class="bd">  # Test-Driven Development …                                       <em>← 正文：觸發後才載入的操作手冊</em>
  See [tests.md](tests.md) …                                        <em>← 指向附屬檔案</em>
  call the Skill tool with "codebase-design"                        <em>← 叫另一個 skill</em></span><span class="fl">tests.md, mocking.md, references/, playbooks/, scripts/           <em>← 附屬檔案：需要時才去讀</em></span></div>

  <h2>2. Claude 是分三層讀 skill 的</h2>
  <div class="card">
    <div class="step"><div class="n">A</div><div><b>平常：只看 name + description。</b><p>所有 skill 的 description 都塞在 Claude 的 context 裡。所以 description 寫得好不好，決定 skill 會不會在對的時候被叫出來。</p></div></div>
    <div class="step"><div class="n">B</div><div><b>觸發後：讀整份 SKILL.md 正文。</b><p>你打 <code>/tdd</code>，或 Claude 判斷情境符合，就載入正文照著做。</p></div></div>
    <div class="step"><div class="n">C</div><div><b>需要時：讀附屬檔案或其他 skill。</b><p>正文寫「See tests.md」或「use the <b>how</b> skill」，Claude 走到那一步才去讀。這叫漸進揭露 (progressive disclosure)，可以省 context。</p></div></div>
  </div>

  <h2>3. 六步閱讀法</h2>
  <div class="card">
    <div class="step"><div class="n">1</div><div><b>先讀 description，拆成「做什麼」和「何時用」。</b><p>問自己：我說哪句話會觸發它？這個 app 會自動幫你拆成兩塊。</p></div></div>
    <div class="step"><div class="n">2</div><div><b>看誰能叫它。</b><p>👤 你打 <code>/名稱</code>、🤖 Claude 自動觸發、📚 只當背景知識。這由 <code>disable-model-invocation</code> 和 <code>user-invocable</code> 兩個欄位決定。</p></div></div>
    <div class="step"><div class="n">3</div><div><b>掃標題骨架，判斷類型。</b><p>流程型（一步步做）、參考型（規則和詞彙）、路由器（把工作分派給別的 skill）、短指令（一條原則）。類型決定你怎麼讀下去。</p></div></div>
    <div class="step"><div class="n">4</div><div><b>讀正文時抓硬規則。</b><p>must / never / always / only / don't 這類字是作者真正在意的限制，app 會用 <mark class="rule">黃底</mark> 標出來。</p></div></div>
    <div class="step"><div class="n">5</div><div><b>追連結。</b><p><a class="skill-ref">綠色</a> 是它叫的其他 skill，<a class="file-ref">藍色</a> 是附屬檔案，點了就能跳過去或打開。</p></div></div>
    <div class="step"><div class="n">6</div><div><b>用一句話寫下來。</b><p>「這個 skill 讓 Claude 在 ___ 時，做 ___，而且絕不 ___。」寫得出來才算讀懂。每個 skill 頁面底下都有筆記欄。</p></div></div>
  </div>

  <h2>4. 兩套 skill 的風格（用你電腦上的實際資料算的）</h2>
  <div class="grid2">
    ${statCard("Matt Pocock — mattpocock-skills", "mattpocock-skills", `<p class="why">多半短小、一個 skill 做一件事。很多是只能手動的工作流程（<code>/grill-me</code>、<code>/to-spec</code>、<code>/handoff</code>），由你決定何時開始。範例和細節放在同資料夾的 .md 檔。skill 之間用「call the Skill tool with "…"」互相轉交。</p>`)}
    ${statCard("poteto — pstack", "pstack", `<p class="why">以 <code>poteto-mode</code> 為總入口：它像路由器，依任務把 Claude 導到 <code>playbooks/</code> 裡的流程和其他 skill。大量 <code>principle-*</code> skill 是背景知識，只讓 Claude 引用。安裝後還有 SessionStart hook，在每次開 session 時提醒 Claude 進入 poteto-mode。</p>`)}
  </div>

  <h2>5. 建議的閱讀路線</h2>
  <div class="card"><h3>Matt Pocock</h3>
    ${pathLinks(["mattpocock-skills:grill-me", "mattpocock-skills:grilling", "mattpocock-skills:tdd", "mattpocock-skills:codebase-design", "mattpocock-skills:writing-for-agents"])}
    <p class="why">先比較 grill-me 和 grilling：grill-me 整份只有一行「Call the Skill tool with "grilling"」，是給你手動用的入口；grilling 才是本體，Claude 也能自動觸發。接著看 tdd 怎麼引用附屬檔案和 codebase-design。最後讀 writing-for-agents 和它的 SKILL-MECHANICS.md，那是 Matt 寫 skill 的方法論。</p>
  </div>
  <div class="card"><h3>pstack</h3>
    ${pathLinks(["pstack:poteto-help", "pstack:poteto-mode", "pstack:principle-laziness-protocol", "pstack:how", "pstack:architect"])}
    <p class="why">poteto-help 是說明書。poteto-mode 是核心，先看它的 Principles 和 Non-negotiables 怎麼把工作分派出去，再點進一條 principle 看「背景知識」型 skill 有多短。最後讀 how 和 architect 兩個常用流程。poteto-mode 的附屬檔案 <code>playbooks/authoring-a-skill.md</code> 是 poteto 寫 skill 的規則。</p>
  </div>`;
  renderSidebar(null);
}

// ---------- reader ----------

async function renderSkill(id) {
  renderSidebar(id);
  const res = await fetch(`/api/skill?id=${encodeURIComponent(id)}`);
  if (!res.ok) { $("#main").innerHTML = `<p>找不到 ${esc(id)}</p>`; return; }
  const s = await res.json();
  const [kind, kindWhy] = guessKind(s);
  const fmKeys = Object.keys(s.frontmatter);
  const note = notes[id] ?? {};
  const groups = {};
  for (const f of s.supporting) (groups[f.includes("/") ? f.split("/")[0] + "/" : "（同層）"] ??= []).push(f);
  const rel = (ids) => ids.map((x) => `<a href="#/skill/${x}">${esc(x.startsWith(s.plugin + ":") ? x.split(":")[1] : x)}</a>`).join("") || '<span class="hint">無</span>';

  $("#main").innerHTML = `
  <p class="hint">${esc(s.plugin)} ${esc(s.version)}${s.category ? " · " + esc(s.category) : ""} · ${s.lines} 行 · ${s.words} 字</p>
  <h1>${esc(s.name)}</h1>
  <div class="badges">${invocationBadges(s)}${s.frontmatter["argument-hint"] ? `<span class="badge b-meta">參數：${esc(s.frontmatter["argument-hint"])}</span>` : ""}<span class="badge b-meta">類型猜測：${kind}</span></div>

  <div class="card"><h3>① 什麼時候會用到它（description）</h3>
    <div class="split">
      <div class="what"><span class="label">做什麼</span>${esc(s.description.what || "（沒寫，直接從觸發條件開始）")}</div>
      <div class="when"><span class="label">何時用</span>${esc(s.description.when || "（沒寫）")}</div>
    </div>
    <p class="hint">💡 ${invocationHint(s)}</p>
  </div>

  <div class="card"><h3>② frontmatter 逐欄解說</h3>
    <pre style="white-space:pre-wrap"><code>${esc(s.frontmatterRaw)}</code></pre>
    ${fmKeys.map((k) => `<div class="stat"><span><code>${esc(k)}</code></span><span style="text-align:right;max-width:75%">${FRONTMATTER_HELP[k] ?? "非標準欄位。"}</span></div>`).join("")}
  </div>

  <div class="card"><h3>③ 先看骨架</h3>
    <p style="margin:0">${s.outline.length} 個標題 · ${s.supporting.length} 個附屬檔案 · 點名 ${s.calls.length} 個 skill · 被 ${s.calledBy.length} 個 skill 點名</p>
    <p class="hint">類型猜測「${kind}」：${kindWhy}</p>
  </div>

  <div class="card"><h3>🗺️ 流程圖</h3>
    <div class="toolbar"><button id="flow-btn">畫出這個 skill 的流程</button><span id="flow-status" class="hint"></span></div>
    <div id="flow"></div>
  </div>

  <h2>④ 正文</h2>
  <div class="toolbar">
    <button class="zh-toggle" id="zh-btn"></button><span id="zh-status"></span>
  </div>
  <div class="toolbar">
    <span class="legend"><span><abbr class="term" data-zh="把滑鼠移到虛線底的字上，會跳出中文解釋">術語</abbr></span><span><a class="skill-ref">其他 skill</a></span><span><a class="file-ref">附屬檔案</a></span><span><mark class="rule">硬規則</mark></span></span>
    <label><input type="checkbox" id="rules-toggle" ${document.body.classList.contains("no-rules") ? "" : "checked"}> 標出硬規則</label>
  </div>
  <div class="reader">
    <article class="card md" id="body"></article>
    <nav class="toc">${s.outline.map((h, i) => `<a class="l${h.level}" href="#" data-h="${i}">${esc(h.text.replace(/[`*]/g, ""))}</a>`).join("") || '<span class="hint">沒有標題</span>'}</nav>
  </div>

  <div class="card"><h3>⑤ 附屬檔案</h3>
    ${s.supporting.length ? `<ul class="files">${Object.entries(groups).map(([g, fs]) => `<li class="dir">${esc(g)}</li>` + fs.map((f) => `<li><a href="#" data-file="${esc(f)}">${esc(f)}</a></li>`).join("")).join("")}</ul>
    <p class="hint">正文裡有點名的檔案，Claude 走到那一步才會讀。沒被點名的（例如 scripts/ 裡的測試）通常是給 skill 內的腳本用，不是給 Claude 讀的。</p>` : '<p class="hint">沒有附屬檔案，所有內容都在 SKILL.md 裡。</p>'}
  </div>

  <div class="card rel"><h3>⑥ 關聯</h3>
    <p style="margin:4px 0"><b>它點名的 skill：</b>${rel(s.calls)}</p>
    <p style="margin:4px 0"><b>點名它的 skill：</b>${rel(s.calledBy)}</p>
  </div>

  <div class="card notes"><h3>⑦ 我的理解</h3>
    <textarea id="note" placeholder="用一句話：這個 skill 讓 Claude 在 ___ 時，做 ___，而且絕不 ___。&#10;我學到的寫法技巧：…">${esc(note.text ?? "")}</textarea>
    <label><input type="checkbox" id="done" ${note.done ? "checked" : ""}> 我讀懂了</label>
    <p class="hint">筆記只存在這個瀏覽器裡。</p>
  </div>`;

  const body = $("#body");
  body.innerHTML = md(s.body);
  annotate(body, s);
  window.currentSkill = s;
  $("#main").scrollTop = 0;
  window.scrollTo(0, 0);

  const save = () => {
    notes[id] = { text: $("#note").value, done: $("#done").checked };
    store.set("notes", notes);
  };
  $("#note").addEventListener("input", save);
  $("#done").addEventListener("change", () => { save(); renderSidebar(id); });
  $("#rules-toggle").addEventListener("change", (e) => document.body.classList.toggle("no-rules", !e.target.checked));
  const runZh = () => translateIn(body, $("#zh-status"), [...document.querySelectorAll("#main .what, #main .when")]);
  setZh(zhPref());
  $("#zh-btn").addEventListener("click", () => { setZh(!zhPref()); if (zhPref()) runZh(); });
  if (zhPref()) runZh();
  $("#flow-btn").addEventListener("click", () => drawFlow(s));
}

let mermaidLib;
async function drawFlow(s) {
  const status = $("#flow-status"), out = $("#flow"), btn = $("#flow-btn");
  btn.disabled = true;
  status.textContent = "畫圖中… 第一次大約要 10～60 秒，之後會記住。";
  try {
    const res = await fetch(`/api/flow?id=${encodeURIComponent(s.id)}`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    if (window.currentSkill !== s) return;
    const { mermaid: src, summary } = data.results;
    btn.hidden = true;
    status.textContent = "";
    if (!src) { out.innerHTML = `<p class="hint">這份 skill 不是步驟流程，沒有圖可畫。${esc(summary)}</p>`; return; }
    mermaidLib ??= (await import("https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs")).default;
    mermaidLib.initialize({ startOnLoad: false, theme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "default" });
    let svg;
    try {
      ({ svg } = await mermaidLib.render(`flow-${Date.now()}`, src));
    } catch {
      svg = `<p class="hint">圖的語法有誤，只能顯示原始碼：</p><pre><code>${esc(src)}</code></pre>`;
    }
    out.innerHTML = `<p style="margin:0 0 8px">${esc(summary)}</p><div class="flow-svg">${svg}</div><p class="hint">這張圖是 Claude 讀完正文後整理的主幹，細節以正文為準。</p>`;
  } catch (e) {
    btn.disabled = false;
    status.textContent = claudeFailed("畫圖", e);
  }
}

async function openFile(path) {
  const s = window.currentSkill;
  const res = await fetch(`/api/file?id=${encodeURIComponent(s.id)}&path=${encodeURIComponent(path)}`);
  const { content = "", error } = await res.json();
  $("#drawer-title").textContent = `${s.name}/${path}`;
  $("#drawer-status").textContent = "";
  const el = $("#drawer-body");
  if (error) el.textContent = error;
  else if (path.endsWith(".md")) { el.innerHTML = md(content.replace(/^---[\s\S]*?---\n/, "")); annotate(el, s); }
  else el.innerHTML = `<pre><code>${esc(content)}</code></pre>`;
  $("#drawer").hidden = false;
  el.scrollTop = 0;
  if (zhPref() && path.endsWith(".md")) translateIn(el, $("#drawer-status"));
}

// ---------- wiring ----------

function route() {
  const hash = location.hash || "#/";
  document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("on", hash === "#/" ? a.dataset.nav === "guide" : a.dataset.nav === "browse"));
  $("#drawer").hidden = true;
  if (hash.startsWith("#/skill/")) return renderSkill(decodeURIComponent(hash.slice(8)));
  if (hash === "#/browse") {
    const first = visible()[0];
    if (first) location.hash = `#/skill/${first.id}`;
    else renderGuide();
    return;
  }
  renderGuide();
}

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-plugin], [data-mode], [data-file], [data-h]");
  if (!t) return;
  e.preventDefault();
  if (t.dataset.plugin) {
    const p = t.dataset.plugin;
    filters.plugins.has(p) ? filters.plugins.delete(p) : filters.plugins.add(p);
    store.set("plugins", [...filters.plugins]);
    renderSidebar(window.currentSkill?.id);
  } else if (t.dataset.mode) {
    filters.mode = t.dataset.mode;
    renderSidebar(window.currentSkill?.id);
  } else if (t.dataset.file) {
    openFile(t.dataset.file);
  } else if (t.dataset.h) {
    document.getElementById(`h-${t.dataset.h}`)?.scrollIntoView({ behavior: "smooth" });
  }
});
$("#search").addEventListener("input", (e) => { filters.q = e.target.value.trim(); renderSidebar(window.currentSkill?.id); });
$("#drawer-close").addEventListener("click", () => ($("#drawer").hidden = true));
$("#drawer-zh").addEventListener("click", () => {
  setZh(!zhPref());
  if (zhPref()) translateIn($("#drawer-body"), $("#drawer-status"));
});
setZh(store.get("zh", false));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("#drawer").hidden = true; });
$("#reload").addEventListener("click", async () => {
  skills = await (await fetch("/api/skills?reload=1")).json();
  route();
});
window.addEventListener("hashchange", route);

skills = await (await fetch("/api/skills")).json();
route();
