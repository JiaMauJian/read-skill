import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFrontmatter, invocation, outline, fileRefs, skillRefs } from "./skills.mjs";

test("parseFrontmatter reads keys, quotes and booleans", () => {
  const { data, body } = parseFrontmatter('---\nname: tdd\ndescription: "Do X. Use when Y."\nuser-invocable: false\n---\n# Title\n');
  assert.deepEqual(data, { name: "tdd", description: "Do X. Use when Y.", "user-invocable": false });
  assert.equal(body, "# Title\n");
});

test("invocation reflects frontmatter flags", () => {
  assert.deepEqual(invocation({}), { user: true, model: true });
  assert.deepEqual(invocation({ "user-invocable": false }), { user: false, model: true });
  assert.deepEqual(invocation({ "disable-model-invocation": true }), { user: true, model: false });
});

test("outline ignores headings inside code fences", () => {
  assert.deepEqual(outline("# A\n```\n# not\n```\n## B"), [
    { level: 1, text: "A" },
    { level: 2, text: "B" },
  ]);
});

test("fileRefs finds links and backticked paths, not URLs", () => {
  const refs = fileRefs("See [tests.md](tests.md) and `playbooks/bug-fix.md`, [docs](https://x.y/a.md).");
  assert.deepEqual(refs.sort(), ["playbooks/bug-fix.md", "tests.md"]);
});

test("skillRefs matches decorated mentions only", () => {
  const all = [
    { id: "p:how", name: "how", plugin: "p" },
    { id: "p:architect", name: "architect", plugin: "p" },
    { id: "q:tdd", name: "tdd", plugin: "q" },
    { id: "p:self", name: "self", plugin: "p" },
  ];
  const me = all[3];
  assert.deepEqual(skillRefs("I know how. Use the **architect** skill, then q:tdd.", me, all), ["p:architect", "q:tdd"]);
});

test("skillRefs maps bold principle titles to principle-* skills", () => {
  const all = [
    { id: "p:principle-laziness-protocol", name: "principle-laziness-protocol", plugin: "p" },
    { id: "p:mode", name: "mode", plugin: "p" },
  ];
  assert.deepEqual(skillRefs("- **Laziness Protocol.** Bias to deletion.", all[1], all), ["p:principle-laziness-protocol"]);
});
