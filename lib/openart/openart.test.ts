import { test } from "node:test";
import assert from "node:assert/strict";
import { decrypt, encrypt } from "./crypto.ts";
import { accountSummary } from "./account.ts";
import { cleanEnhanced, enhanceSystemPrompt } from "./enhance.ts";
import { israelDay } from "./day.ts";

const KEY = Buffer.alloc(32, 7).toString("base64");

test("token set encryption round-trips, uses a fresh IV, and rejects tampering or a wrong key", async () => {
  const plain = JSON.stringify({ access_token: "at_secret", refresh_token: "rt_secret" });
  const a = await encrypt(plain, KEY);
  const b = await encrypt(plain, KEY);
  assert.notEqual(a, b, "random IV per write");
  assert.ok(!a.includes("secret") && !Buffer.from(a, "base64").toString().includes("secret"));
  assert.equal(await decrypt(a, KEY), plain);
  const tampered = Buffer.from(a, "base64");
  tampered[20] ^= 1;
  await assert.rejects(decrypt(tampered.toString("base64"), KEY));
  await assert.rejects(decrypt(a, Buffer.alloc(32, 8).toString("base64")));
  await assert.rejects(encrypt(plain, Buffer.alloc(16).toString("base64")), /32 bytes/);
});

test("daily cap day is the Israel calendar day", () => {
  // 22:30 UTC on Jan 15 is already Jan 16 in Israel (UTC+2); 20:30 UTC on Jul 1 is Jul 1 23:30 (UTC+3).
  assert.equal(israelDay(Date.UTC(2026, 0, 15, 22, 30)), "2026-01-16");
  assert.equal(israelDay(Date.UTC(2026, 6, 1, 20, 30)), "2026-07-01");
  assert.equal(israelDay(Date.UTC(2026, 6, 1, 21, 30)), "2026-07-02");
});

test("account balance is read from the real account_get shape", () => {
  // Shape of the real reply (values made up).
  assert.deepEqual(accountSummary({ user: { uid: "u1", email: "a@b.c" }, plan: "Plus", credits: 2800 }), { credits: 2800, plan: "Plus" });
  assert.deepEqual(accountSummary({ user: { uid: "u1" }, plan: "", credits: 0 }), { credits: 0, plan: undefined });
  for (const bad of [null, undefined, "x", {}, { credits: "2800" }, { credits: NaN }, { balance: 5 }]) {
    assert.equal(accountSummary(bad).credits, undefined);
  }
});

test("prompt enhancement: system prompt per task, literal reading, cleaned answer", () => {
  const image = enhanceSystemPrompt("image", false);
  assert.match(image, /AI image generator/);
  assert.match(image, /under 80 words/);
  assert.match(image, /Never add brand names/);
  assert.match(image, /El Al/);
  assert.match(enhanceSystemPrompt("image", true), /changes the attached image/);
  assert.match(enhanceSystemPrompt("video", false), /AI video generator/);
  assert.match(enhanceSystemPrompt("video", true), /first frame/);

  assert.equal(cleanEnhanced('Prompt: "A small airplane flying above the clouds."'), "A small airplane flying above the clouds.");
  assert.equal(cleanEnhanced("<think>plan it</think>\n  An orange cat\n on a sofa  "), "An orange cat on a sofa");
  assert.equal(cleanEnhanced("“A red kite”"), "A red kite");
  assert.equal(cleanEnhanced("<think>never closed"), "");
  assert.equal(cleanEnhanced("   "), "");
  assert.equal(cleanEnhanced("x".repeat(3000)).length, 1000);
});
