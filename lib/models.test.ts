import { test } from "node:test";
import assert from "node:assert/strict";
import { displayName, parseModels, publicModels, resolveModel } from "./models.ts";

const SUGGESTED =
  "fast|gemini-3.6-flash|מהיר|לרוב השאלות|none|1,deep|gemini-3.6-flash|מעמיק|לשאלות מורכבות, איטי יותר|medium|1";
const quiet = () => {};

test("parses the suggested value, including a comma inside a description", () => {
  const m = parseModels(SUGGESTED, { effort: "none" }, quiet);
  assert.deepEqual(m, [
    { key: "fast", model: "gemini-3.6-flash", label: "מהיר", description: "לרוב השאלות", effort: "none", vision: true },
    {
      key: "deep",
      model: "gemini-3.6-flash",
      label: "מעמיק",
      description: "לשאלות מורכבות, איטי יותר",
      effort: "medium",
      vision: true,
    },
  ]);
});

test("empty effort uses AI_REASONING_EFFORT; spaces and newlines between entries are fine", () => {
  const m = parseModels(" a | m1 | א | | | 0 ,\n b|m2|ב|desc||1 ", { effort: "medium" }, quiet);
  assert.deepEqual(
    m.map((e) => [e.key, e.model, e.description, e.effort, e.vision]),
    [
      ["a", "m1", "", "medium", false],
      ["b", "m2", "desc", "medium", true],
    ],
  );
});

test('"off" omits reasoning_effort; an empty AI_REASONING_EFFORT does too', () => {
  const m = parseModels("a|m1|א||off|1,b|m2|ב|||1,c|m3|ג||high|0", { effort: "medium" }, quiet);
  assert.deepEqual(m.map((e) => e.effort), ["", "medium", "high"]);
  assert.deepEqual(parseModels("a|m1|א|||1", { effort: "" }, quiet)[0].effort, "");
  assert.deepEqual(parseModels("a|m1|א|||1", { effort: "off" }, quiet)[0].effort, "");
  assert.deepEqual(parseModels("a|m1|א|||1", { effort: "bogus" }, quiet)[0].effort, "none");
  assert.deepEqual(parseModels(undefined, { model: "x", effort: "" }, quiet)[0].effort, "");
});

test("malformed entries are skipped with a warning, valid ones kept", () => {
  const warnings: string[] = [];
  const m = parseModels(
    [
      "ok|m|תווית|תיאור|none|1",
      "bad key!|m|x|y|none|1", // invalid key
      "nomodel||x|y|none|1", // missing model id
      "nolabel|m||y|none|1", // missing label
      "effort|m|x|y|turbo|1", // unknown effort
      "vis|m|x|y|none|yes", // bad vision flag
      "short|m|x", // too few fields
      "ok|m2|כפול|y|none|0", // duplicate key
    ].join(","),
    { effort: "none" },
    (w) => warnings.push(w),
  );
  // A broken vision field can't mark an entry boundary, so some neighbors are rejected together.
  assert.deepEqual(m.map((e) => e.key), ["ok"]);
  assert.ok(warnings.length >= 4, warnings.join("\n"));
});

test("duplicate keys keep the first entry", () => {
  const m = parseModels("a|m1|א||none|1,a|m2|ב||none|0", { effort: "none" }, quiet);
  assert.deepEqual(m.map((e) => e.model), ["m1"]);
});

test("unset or fully invalid AI_MODELS falls back to a single AI_MODEL entry (no vision)", () => {
  for (const raw of [undefined, "", "garbage"]) {
    const m = parseModels(raw, { model: "meta/llama", effort: "low" }, quiet);
    assert.deepEqual(m, [
      { key: "default", model: "meta/llama", label: "ברירת מחדל", description: "", effort: "low", vision: false },
    ]);
  }
  assert.deepEqual(parseModels(undefined, { effort: "none" }, quiet), []);
});

test("allowlist: only known keys are honored, anything else gets the default", () => {
  const m = parseModels(SUGGESTED, { effort: "none" }, quiet);
  assert.equal(resolveModel(m, "deep")!.key, "deep");
  for (const k of ["gemini-3.6-flash", "evil", "", undefined, null, 5, { key: "deep" }, "__proto__"])
    assert.equal(resolveModel(m, k)!.key, "fast");
  assert.equal(resolveModel([], "fast"), undefined);
});

test("public list exposes a readable model name, never the raw id", () => {
  const pub = publicModels(parseModels(SUGGESTED, { effort: "none" }, quiet));
  assert.deepEqual(Object.keys(pub[0]).sort(), ["description", "group", "key", "label", "modelName", "vision"]);
  assert.deepEqual(pub.map((p) => p.modelName), ["Gemini 3.6 Flash", "Gemini 3.6 Flash"]);
  assert.ok(!JSON.stringify(pub).includes("gemini-3.6-flash"));
});

test("display names derived from model ids", () => {
  assert.equal(displayName("gemini-3.6-flash"), "Gemini 3.6 Flash");
  assert.equal(displayName("gemini-3.5-flash-lite"), "Gemini 3.5 Flash-Lite");
  assert.equal(displayName("gemini-3.1-flash-lite"), "Gemini 3.1 Flash-Lite");
  assert.equal(displayName("models/gemini-3.8-flash"), "Gemini 3.8 Flash");
  assert.equal(displayName("meta/llama-3.3-70b-instruct"), "Llama 3.3 70b-Instruct");
  assert.equal(displayName("mock-deep"), "Mock Deep");
  assert.equal(displayName("gpt-4o"), "Gpt 4o");
});
