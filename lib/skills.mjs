import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, sep, dirname, basename } from "node:path";
import { homedir } from "node:os";

const CLAUDE_DIR = join(homedir(), ".claude");
const SKIP_DIRS = new Set(["node_modules", ".git"]);

export function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: {}, raw: "", body: text };
  const data = {};
  let lastKey = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (kv) {
      lastKey = kv[1];
      data[lastKey] = unquote(kv[2]);
    } else if (lastKey && /^\s+\S/.test(line)) {
      data[lastKey] = (data[lastKey] ? data[lastKey] + " " : "") + line.trim();
    }
  }
  return { data, raw: m[1], body: text.slice(m[0].length) };
}

function unquote(v) {
  const s = v.trim();
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^(['"]).*\1$/.test(s)) return s.slice(1, -1);
  return s;
}

// The description is the only thing Claude sees before loading a skill,
// so split it into "what it does" and "when to trigger".
const TRIGGER_RE = /\b(Use (?:this skill |only |this )?(?:when|for|after|whenever)|Apply (?:when|to|before|after|during)|Use$|TRIGGER|Triggers? on|Invoked through|Dispatched)\b/i;

export function splitDescription(desc = "") {
  const text = String(desc).trim();
  const i = text.search(TRIGGER_RE);
  if (i <= 0) return i === 0 ? { what: "", when: text } : { what: text, when: "" };
  return { what: text.slice(0, i).trim(), when: text.slice(i).trim() };
}

export function invocation(data) {
  const user = data["user-invocable"] !== false;
  const model = data["disable-model-invocation"] !== true;
  return { user, model };
}

export function outline(body) {
  const out = [];
  let inFence = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const h = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (h) out.push({ level: h[1].length, text: h[2] });
  }
  return out;
}

const FILE_EXT = "md|mjs|js|ts|sh|py|json|yaml|yml|txt";

export function fileRefs(body) {
  const refs = new Set();
  for (const m of body.matchAll(/\]\(([^)\s#]+)\)/g)) {
    if (!/^[a-z]+:/i.test(m[1])) refs.add(m[1].replace(/^\.\//, ""));
  }
  for (const m of body.matchAll(new RegExp("`([\\w./<>-]+\\.(?:" + FILE_EXT + "))`", "g"))) {
    refs.add(m[1].replace(/^\.\//, ""));
  }
  return [...refs];
}

// Finds mentions of other skills in decorated form: plugin:name, /name,
// **name**, `name`, "name". Bare words are too noisy ("how", "pr").
// pstack also names principle skills by title: **Laziness Protocol.** → principle-laziness-protocol.
export function skillRefs(body, skill, allSkills) {
  const found = new Set();
  const boldSlugs = new Set([...body.matchAll(/\*\*([^*]+)\*\*/g)].map((m) => "principle-" + kebab(m[1])));
  for (const other of allSkills) {
    if (other.id !== skill.id && other.plugin === skill.plugin && boldSlugs.has(other.name)) found.add(other.id);
    if (other.id === skill.id) continue;
    const n = escapeRe(other.name);
    const qualified = new RegExp(`\\b${escapeRe(other.plugin)}:${n}\\b`);
    const samePlugin = other.plugin === skill.plugin;
    const decorated = new RegExp(`(?:\\*\\*${n}\\*\\*|\`/?${n}\`|"${n}"|(?:^|[\\s(])/${n}\\b)`, "m");
    if (qualified.test(body) || (samePlugin && decorated.test(body))) found.add(other.id);
  }
  return [...found];
}

function kebab(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function walk(dir, root = dir, acc = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, root, acc);
    else acc.push(relative(root, full).split(sep).join("/"));
  }
  return acc;
}

export async function discoverPlugins() {
  const plugins = [];
  const manifest = join(CLAUDE_DIR, "plugins", "installed_plugins.json");
  if (existsSync(manifest)) {
    const json = JSON.parse(await readFile(manifest, "utf8"));
    for (const [key, installs] of Object.entries(json.plugins ?? {})) {
      const inst = installs[0];
      if (!inst || !existsSync(join(inst.installPath, "skills"))) continue;
      plugins.push({ name: key.split("@")[0], version: inst.version, path: join(inst.installPath, "skills") });
    }
  }
  const userSkills = join(CLAUDE_DIR, "skills");
  if (existsSync(userSkills)) plugins.push({ name: "user", version: "", path: userSkills });
  return plugins;
}

export async function loadSkills() {
  const skills = [];
  for (const plugin of await discoverPlugins()) {
    const files = (await walk(plugin.path)).filter((f) => basename(f) === "SKILL.md");
    for (const rel of files) {
      const dir = join(plugin.path, dirname(rel));
      const text = await readFile(join(plugin.path, rel), "utf8");
      const { data, raw, body } = parseFrontmatter(text);
      const name = data.name || basename(dir);
      const parts = dirname(rel).split("/");
      const supporting = (await walk(dir)).filter((f) => f !== "SKILL.md");
      skills.push({
        id: `${plugin.name}:${name}`,
        plugin: plugin.name,
        version: plugin.version,
        name,
        category: parts.length > 1 ? parts.slice(0, -1).join("/") : "",
        dir,
        frontmatter: data,
        frontmatterRaw: raw,
        body,
        description: splitDescription(data.description),
        invocation: invocation(data),
        outline: outline(body),
        fileRefs: fileRefs(body),
        supporting,
        lines: text.split(/\r?\n/).length,
        words: body.split(/\s+/).filter(Boolean).length,
      });
    }
  }
  for (const s of skills) s.calls = skillRefs(s.body, s, skills);
  for (const s of skills) s.calledBy = skills.filter((o) => o.calls.includes(s.id)).map((o) => o.id);
  return skills;
}

export async function readSupportingFile(skill, relPath) {
  const full = join(skill.dir, relPath);
  if (relative(skill.dir, full).startsWith("..")) throw new Error("path escapes skill dir");
  const info = await stat(full);
  if (info.size > 512 * 1024) return "(檔案太大，略過顯示)";
  return readFile(full, "utf8");
}
