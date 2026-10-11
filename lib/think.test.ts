import { test } from "node:test";
import assert from "node:assert/strict";
import { createThinkFilter } from "./think.ts";

const run = (chunks: string[]) => {
  const f = createThinkFilter();
  return chunks.map((c) => f.push(c)).join("") + f.flush();
};

test("strips a whole <think> block and the whitespace after it", () => {
  assert.equal(run(["<think>reasoning here</think>\n\nשלום!"]), "שלום!");
});

test("strips <think> when both tags are split across chunks", () => {
  assert.equal(run(["<th", "ink>step 1", " step 2</thi", "nk>", "\n\n", "תשובה", " סופית"]), "תשובה סופית");
  assert.equal(run(["<", "t", "h", "i", "n", "k", ">", "x", "<", "/", "think", ">", "ok"]), "ok");
});

test("passes normal text through, including lone '<' and look-alikes", () => {
  assert.equal(run(["a < b and x <th", "ree"]), "a < b and x <three");
  assert.equal(run(["ends with <"]), "ends with <");
  assert.equal(run(["שלום ", "עולם"]), "שלום עולם");
});

test("text before a think block is kept; unterminated block is dropped", () => {
  assert.equal(run(["intro <think>hidden</think> outro"]), "intro outro");
  assert.equal(run(["<think>never closed"]), "");
});
