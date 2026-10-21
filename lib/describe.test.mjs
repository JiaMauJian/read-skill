import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDescribePrompt, parseDescribe } from "./describe.mjs";

test("buildDescribePrompt embeds the skill name and description", () => {
  const p = buildDescribePrompt("tdd", "Apply after a task. Verify it.");
  assert.match(p, /「tdd」/);
  assert.match(p, /Apply after a task\. Verify it\./);
});

test("parseDescribe tolerates surrounding text", () => {
  const out = parseDescribe('好的：\n```json\n{"what":"先寫測試","when":"你說要 TDD 時"}\n```');
  assert.deepEqual(out, { what: "先寫測試", when: "你說要 TDD 時" });
});

test("parseDescribe keeps an empty when", () => {
  assert.deepEqual(parseDescribe('{"what":"整理程式碼","when":""}'), { what: "整理程式碼", when: "" });
});
