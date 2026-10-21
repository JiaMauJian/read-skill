import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt, parseResult } from "./translate.mjs";

test("buildPrompt embeds every block and the expected count", () => {
  const p = buildPrompt(["Red before green.", "One slice at a time."]);
  assert.match(p, /長度必須是 2/);
  assert.match(p, /One slice at a time\./);
});

test("parseResult tolerates surrounding text and fills missing fields", () => {
  const out = parseResult('好的：\n```json\n[{"zh":"先紅後綠"},{"zh":"一次一片","plain":"每次只做一小步"}]\n```', 2);
  assert.deepEqual(out, [
    { zh: "先紅後綠", plain: "", why: "", whyFrom: "", code: "" },
    { zh: "一次一片", plain: "每次只做一小步", why: "", whyFrom: "", code: "" },
  ]);
});

test("parseResult rejects a wrong number of blocks", () => {
  assert.throws(() => parseResult('[{"zh":"a"}]', 2), /段數不符/);
});

test("parseResult labels any reason not marked 原文 as 推測", () => {
  const out = parseResult('[{"zh":"a","why":"因為…","whyFrom":"原文"},{"zh":"b","why":"大概是…","whyFrom":"???"}]', 2);
  assert.deepEqual(out.map((r) => r.whyFrom), ["原文", "推測"]);
});

test("parseResult keeps a code comparison when given", () => {
  const out = parseResult('[{"zh":"a","code":"// ❌ 不照做\\nx()\\n// ✅ 照做\\ny()"}]', 1);
  assert.match(out[0].code, /✅ 照做/);
});
