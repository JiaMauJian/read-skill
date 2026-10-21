import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";
import { loadSkills, readSupportingFile } from "./lib/skills.mjs";
import { translate } from "./lib/translate.mjs";
import { flowchart } from "./lib/flow.mjs";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "public");
const PORT = Number(process.env.PORT) || 4321;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

let skills = await loadSkills();
const byId = () => new Map(skills.map((s) => [s.id, s]));

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

const summary = ({ body, frontmatterRaw, dir, ...rest }) => rest;

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname === "/api/skills") {
      if (url.searchParams.has("reload")) skills = await loadSkills();
      return json(res, 200, skills.map(summary));
    }
    if (url.pathname === "/api/skill") {
      const s = byId().get(url.searchParams.get("id"));
      return s ? json(res, 200, s) : json(res, 404, { error: "not found" });
    }
    if (url.pathname === "/api/file") {
      const s = byId().get(url.searchParams.get("id"));
      if (!s) return json(res, 404, { error: "not found" });
      return json(res, 200, { content: await readSupportingFile(s, url.searchParams.get("path")) });
    }
    if (url.pathname === "/api/flow" && req.method === "POST") {
      const s = byId().get(url.searchParams.get("id"));
      return s ? json(res, 200, await flowchart(s)) : json(res, 404, { error: "not found" });
    }
    if (url.pathname === "/api/translate" && req.method === "POST") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const { blocks } = JSON.parse(raw);
      if (!Array.isArray(blocks) || !blocks.length || blocks.some((b) => typeof b !== "string")) return json(res, 400, { error: "blocks 必須是字串陣列" });
      return json(res, 200, await translate(blocks));
    }
    const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (file.includes("..")) return json(res, 400, { error: "bad path" });
    const data = await readFile(join(PUBLIC, file));
    res.writeHead(200, { "content-type": (TYPES[extname(file)] ?? "text/plain") + "; charset=utf-8" });
    res.end(data);
  } catch (err) {
    json(res, err.code === "ENOENT" ? 404 : 500, { error: err.message });
  }
}).listen(PORT, "127.0.0.1", () => {
  const link = `http://localhost:${PORT}`;
  console.log(`read-skill：找到 ${skills.length} 個 skill → ${link}`);
  if (!process.argv.includes("--no-open")) {
    const cmd = process.platform === "win32" ? `start "" ${link}` : process.platform === "darwin" ? `open ${link}` : `xdg-open ${link}`;
    exec(cmd);
  }
});
