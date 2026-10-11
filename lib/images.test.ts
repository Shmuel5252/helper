import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareHistory } from "./chat.ts";
import { saveHistory, STORE_KEY, type Conversation } from "./history.ts";
import {
  dataUrlBytes,
  DEFAULT_IMAGE_PROMPT,
  findImageError,
  IMAGE_ERRORS,
  IMAGE_MAX_BYTES,
  IMAGE_PLACEHOLDER,
} from "./images.ts";

const img = (bytes = 300, type = "jpeg") => `data:image/${type};base64,${"A".repeat(Math.ceil((bytes * 4) / 3))}`;

test("dataUrlBytes decodes base64 length, padding included", () => {
  assert.equal(dataUrlBytes("data:image/png;base64,QUJD"), 3);
  assert.equal(dataUrlBytes("data:image/png;base64,QUI="), 2);
  assert.equal(dataUrlBytes("data:image/png;base64,QQ=="), 1);
});

test("image validation: allowed types, count and size", () => {
  const ok = [{ role: "user", content: "x", images: [img(), img(300, "png"), img(300, "webp")] }];
  assert.equal(findImageError(ok), null);
  assert.equal(findImageError([{ role: "user", content: "no images" }]), null);

  const bad = (images: unknown) => findImageError([{ role: "user", content: "", images }]);
  assert.equal(bad([img(), img(), img(), img()]), IMAGE_ERRORS.count);
  assert.equal(bad([img(300, "gif")]), IMAGE_ERRORS.type);
  assert.equal(bad([img(300, "svg+xml")]), IMAGE_ERRORS.type);
  assert.equal(bad(["https://example.com/cat.jpg"]), IMAGE_ERRORS.type); // no remote URLs
  assert.equal(bad(["data:image/jpeg;base64,not base64!"]), IMAGE_ERRORS.type);
  assert.equal(bad([42]), IMAGE_ERRORS.type);
  assert.equal(bad("data:image/jpeg;base64,AAAA"), IMAGE_ERRORS.type);
  assert.equal(bad([img(IMAGE_MAX_BYTES + 10)]), IMAGE_ERRORS.size);
  assert.equal(bad([img(IMAGE_MAX_BYTES - 10)]), null);
});

test("history: only the latest user message with images keeps them; older become a placeholder", () => {
  const a = img(100), b = img(200), c = img(300);
  const out = prepareHistory(
    [
      { role: "user", content: "מה זה?", images: [a] },
      { role: "assistant", content: "חתול" },
      { role: "user", content: "ועכשיו?", images: [b, c] },
      { role: "assistant", content: "כלב" },
      { role: "user", content: "איזה צבע הוא?" },
    ],
    { vision: true },
  )!;
  assert.deepEqual(out[0], { role: "user", content: `מה זה?\n${IMAGE_PLACEHOLDER}` });
  assert.deepEqual(out[2], { role: "user", content: "ועכשיו?", images: [b, c] }); // follow-ups still see it
  assert.deepEqual(out[4], { role: "user", content: "איזה צבע הוא?" });
  assert.deepEqual(prepareHistory(out, { vision: true }), out, "idempotent");
});

test("history: image-only message gets the default prompt; non-vision models get no images", () => {
  const msgs = [{ role: "user", content: "  ", images: [img()] }];
  assert.deepEqual(prepareHistory(msgs, { vision: true }), [
    { role: "user", content: DEFAULT_IMAGE_PROMPT, images: [img()] },
  ]);
  assert.deepEqual(prepareHistory(msgs, { vision: false }), [{ role: "user", content: IMAGE_PLACEHOLDER }]);
  assert.equal(prepareHistory([{ role: "user", content: "", images: [] }], { vision: true }), null);
  // assistant messages can't smuggle images
  const out = prepareHistory(
    [
      { role: "user", content: "hi" },
      { role: "assistant", content: "yo", images: [img()] },
      { role: "user", content: "again" },
    ],
    { vision: true },
  )!;
  assert.ok(out.every((m) => !m.images));
});

test("history: merged consecutive image messages keep at most 3 images", () => {
  const imgs = [1, 2, 3, 4].map((n) => img(n * 10));
  const out = prepareHistory(
    [
      { role: "user", content: "", images: imgs.slice(0, 2) },
      { role: "user", content: "שתיים", images: imgs.slice(2) },
    ],
    { vision: true },
  )!;
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].images, imgs.slice(1));
  assert.equal(out[0].content, "שתיים");
});

test("storage keeps thumbnails only, never the full images", () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
  const conv: Conversation = {
    id: "c",
    title: "תמונה",
    createdAt: 1,
    updatedAt: 1,
    pinned: false,
    messages: [{ role: "user", content: "", images: ["data:image/jpeg;base64,THUMB"], full: [img(500_000)] }],
  };
  saveHistory(storage, { activeId: "c", conversations: [conv] });
  const saved = JSON.parse(data.get(STORE_KEY)!);
  assert.deepEqual(saved.conversations[0].messages[0], { role: "user", content: "", images: ["data:image/jpeg;base64,THUMB"] });
  assert.ok(data.get(STORE_KEY)!.length < 1000);
  assert.ok(conv.messages[0].full, "in-memory copy untouched");
});
