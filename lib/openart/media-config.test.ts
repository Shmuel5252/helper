import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_IMAGE_MODELS, DEFAULT_VIDEO_MODELS, modeFor, parseCap, parseMediaOptions, publicMediaOptions } from "./media-config.ts";

const quiet = () => {};

test("defaults: two image and two video options with typed settings", () => {
  const img = parseMediaOptions(undefined, DEFAULT_IMAGE_MODELS, quiet);
  const vid = parseMediaOptions("", DEFAULT_VIDEO_MODELS, quiet);
  assert.deepEqual(img.map((o) => [o.key, o.model, o.settings]), [
    ["lite", "nano-banana-2-lite", {}],
    ["nb2", "nano-banana-2", { resolution: "1K" }],
  ]);
  assert.deepEqual(vid.map((o) => [o.key, o.model, o.settings]), [
    ["pixverse", "pixverseV6", { duration: 5, resolution: "540p", generateAudio: false }],
    ["veo", "veo3-1", { duration: 4, resolution: "720p", mode: "lite" }],
  ]);
  assert.equal(vid[0].description, "5 שניות, 540p", "commas inside a description survive");
});

test("malformed entries are skipped; all-invalid falls back to the defaults", () => {
  const warnings: string[] = [];
  const opts = parseMediaOptions("ok|m1|א|ב|a=1,bad key|m|x|y|,short|m|x,dup|m|x||,dup|m2|y||", DEFAULT_IMAGE_MODELS, (w) => warnings.push(w));
  assert.deepEqual(opts.map((o) => o.key), ["ok", "dup"]);
  assert.ok(warnings.length >= 2);
  assert.deepEqual(
    parseMediaOptions("garbage", DEFAULT_IMAGE_MODELS, quiet).map((o) => o.key),
    ["lite", "nb2"],
  );
  assert.deepEqual(parseMediaOptions("x|m|l|d|a=b=c", DEFAULT_IMAGE_MODELS, quiet).map((o) => o.key), ["lite", "nb2"]);
});

test("public options never include the model id or settings", () => {
  const pub = publicMediaOptions(parseMediaOptions(undefined, DEFAULT_VIDEO_MODELS, quiet));
  assert.deepEqual(pub.map((p) => p.modelName), ["PixVerse V6", "Veo 3.1"]);
  assert.deepEqual(Object.keys(pub[0]).sort(), ["description", "key", "label", "modelName"]);
});

test("mode follows kind and whether a reference image is attached", () => {
  assert.equal(modeFor("image", false), "text2image");
  assert.equal(modeFor("image", true), "image2image");
  assert.equal(modeFor("video", false), "text2video");
  assert.equal(modeFor("video", true), "image2video");
});

test("daily credit cap is optional: unset, empty, 0 or junk means no limit", () => {
  for (const raw of [undefined, "", " ", "0", "-5", "abc"]) assert.equal(parseCap(raw), null, String(raw));
  assert.equal(parseCap("200"), 200);
  assert.equal(parseCap(" 150 "), 150);
});
