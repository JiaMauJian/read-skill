import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFlowPrompt, parseFlow } from "./flow.mjs";

test("buildFlowPrompt embeds the skill name and body", () => {
  const p = buildFlowPrompt("tdd", "Red before green.");
  assert.match(p, /「tdd」/);
  assert.match(p, /Red before green\./);
});

test("parseFlow tolerates surrounding text", () => {
  const out = parseFlow('好的：\n```json\n{"mermaid":"flowchart TD\\n A[\\"開始\\"]","summary":"主線"}\n```');
  assert.deepEqual(out, { mermaid: 'flowchart TD\n A["開始"]', summary: "主線" });
});

test("parseFlow accepts an empty chart for non-process skills", () => {
  assert.deepEqual(parseFlow('{"mermaid":"","summary":"這是原則，不是流程"}'), { mermaid: "", summary: "這是原則，不是流程" });
});

test("parseFlow rejects non-flowchart diagrams", () => {
  assert.throws(() => parseFlow('{"mermaid":"sequenceDiagram\\n A->>B: hi"}'), /flowchart/);
});
