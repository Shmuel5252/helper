import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_CHARS, MAX_MESSAGES, prepareHistory, type ChatMessage } from "./chat.ts";

const turns = (n: number): ChatMessage[] =>
  Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `m${i}`,
  }));

test("keeps only the last 20 messages", () => {
  const out = prepareHistory(turns(41))!; // m0..m40, ends with user
  assert.equal(out.length, MAX_MESSAGES - 1); // last 20 start with an assistant turn, which is dropped
  assert.equal(out[0].content, "m22");
  assert.equal(out.at(-1)!.content, "m40");
  assert.ok(out.length <= MAX_MESSAGES);

  const short = prepareHistory(turns(5))!;
  assert.equal(short.length, 5);
});

test("caps every message at 4,000 characters", () => {
  const out = prepareHistory([{ role: "user", content: "א".repeat(10_000) }])!;
  assert.equal(MAX_CHARS, 4000);
  assert.equal(out[0].content.length, MAX_CHARS);
});

test("rejects invalid input and drops junk entries", () => {
  assert.equal(prepareHistory(null), null);
  assert.equal(prepareHistory("hi"), null);
  assert.equal(prepareHistory([]), null);
  assert.equal(prepareHistory([{ role: "user", content: "   " }]), null);
  assert.equal(prepareHistory([{ role: "user", content: "hi" }, { role: "assistant", content: "yo" }]), null);
  assert.deepEqual(
    prepareHistory([{ role: "system", content: "evil" }, { role: "user", content: 5 }, { role: "user", content: "hi" }]),
    [{ role: "user", content: "hi" }],
  );
});

test("merges consecutive same-role turns (e.g. after a failed answer)", () => {
  assert.deepEqual(
    prepareHistory([
      { role: "user", content: "a" },
      { role: "user", content: "b" },
    ]),
    [{ role: "user", content: "a\n\nb" }],
  );
});
