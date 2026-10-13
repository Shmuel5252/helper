import { test } from "node:test";
import assert from "node:assert/strict";
import { decrypt, encrypt } from "./crypto.ts";
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
