import { test } from "node:test";
import assert from "node:assert/strict";
import { parseModels, publicModels } from "./models.ts";
import {
  exhaustedLabel,
  isExhausted,
  loadExhausted,
  markExhausted,
  nextPacificMidnight,
  parseQuotaError,
  QUOTA_KEY,
  quotaResetAt,
} from "./quota.ts";

const GEMINI_DAILY = [
  {
    error: {
      code: 429,
      message:
        "You exceeded your current quota.\n* Quota exceeded for metric: generate_content_free_tier_requests, limit: 20, model: gemini-3.6-flash\nPlease retry in 5h17m56.357817274s.",
      status: "RESOURCE_EXHAUSTED",
      details: [
        { violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier", quotaValue: "20" }] },
        { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "19076s" },
      ],
    },
  },
];

test("daily quota 429: detected, retry time taken from retryDelay", () => {
  assert.deepEqual(parseQuotaError(GEMINI_DAILY), { daily: true, retryMs: 19_076_000 });
});

test("retry time falls back to the human 'retry in 5h17m…' text, then to none", () => {
  const noDelay = JSON.parse(JSON.stringify(GEMINI_DAILY));
  noDelay[0].error.details.pop();
  assert.deepEqual(parseQuotaError(noDelay), { daily: true, retryMs: 19_076_358 }); // 5h17m56.358s
  assert.equal(parseQuotaError({ error: { message: "PerDay quota" } }).retryMs, null);
});

test("per-minute 429 is not daily", () => {
  const perMinute = { error: { details: [{ violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" }] }, { retryDelay: "21s" }] } };
  assert.deepEqual(parseQuotaError(perMinute), { daily: false, retryMs: 21_000 });
  assert.equal(parseQuotaError(null, "rate limited").daily, false);
});

test("Pacific midnight fallback, across both DST switches", () => {
  const at = (iso: string) => new Date(iso).getTime();
  // Winter (PST, UTC-8): midnight = 08:00Z
  assert.equal(nextPacificMidnight(at("2026-01-15T20:00:00Z")), at("2026-01-16T08:00:00Z"));
  // Summer (PDT, UTC-7): midnight = 07:00Z; just before midnight still rolls to the next one
  assert.equal(nextPacificMidnight(at("2026-07-01T06:59:00Z")), at("2026-07-01T07:00:00Z"));
  assert.equal(nextPacificMidnight(at("2026-07-01T07:00:00Z")), at("2026-07-02T07:00:00Z"));
  // Spring forward 2026-03-08 02:00 PST: the evening before (PST) → midnight PST
  assert.equal(nextPacificMidnight(at("2026-03-08T04:00:00Z")), at("2026-03-08T08:00:00Z"));
  // ...and later that day (now PDT) → next midnight PDT
  assert.equal(nextPacificMidnight(at("2026-03-08T19:00:00Z")), at("2026-03-09T07:00:00Z"));
  // Fall back 2026-11-01 02:00 PDT: that day's next midnight is PST
  assert.equal(nextPacificMidnight(at("2026-11-01T20:00:00Z")), at("2026-11-02T08:00:00Z"));
  assert.equal(nextPacificMidnight(at("2026-11-01T06:30:00Z")), at("2026-11-01T07:00:00Z"));
  // quotaResetAt prefers the provider's retry time
  assert.equal(quotaResetAt(1000, 5000), 6000);
  assert.equal(quotaResetAt(at("2026-01-15T20:00:00Z"), null), at("2026-01-16T08:00:00Z"));
});

class FakeStorage {
  data = new Map<string, string>();
  getItem = (k: string) => this.data.get(k) ?? null;
  setItem = (k: string, v: string) => void this.data.set(k, v);
  removeItem = (k: string) => void this.data.delete(k);
}

test("exhausted groups persist until their reset time, then clear themselves", () => {
  const s = new FakeStorage();
  markExhausted(s, "fast", 5000, 1000);
  markExhausted(s, "lite", 9000, 1000);
  assert.deepEqual(loadExhausted(s, 2000), { fast: 5000, lite: 9000 });
  assert.ok(isExhausted(loadExhausted(s, 2000), "fast", 2000));
  assert.deepEqual(loadExhausted(s, 6000), { lite: 9000 }, "fast expired");
  assert.deepEqual(JSON.parse(s.getItem(QUOTA_KEY)!), { lite: 9000 }, "storage cleaned too");
  assert.deepEqual(loadExhausted(s, 10_000), {});
  assert.equal(s.getItem(QUOTA_KEY), null);
  s.setItem(QUOTA_KEY, "{broken");
  assert.deepEqual(loadExhausted(s, 0), {});
  assert.deepEqual(loadExhausted(null, 0), {});
  assert.ok(!isExhausted({ fast: 5000 }, "fast", 5000));
  assert.ok(!isExhausted({ fast: 5000 }, undefined, 0));
});

test("badge text: hours, two hours, one hour, tomorrow", () => {
  const h = 3_600_000;
  assert.equal(exhaustedLabel(3 * h, 0), "נגמרה המכסה · מתחדש בעוד 3 שעות");
  assert.equal(exhaustedLabel(2 * h - 1, 0), "נגמרה המכסה · מתחדש בעוד שעתיים");
  assert.equal(exhaustedLabel(10 * 60_000, 0), "נגמרה המכסה · מתחדש בעוד שעה");
  assert.equal(exhaustedLabel(12 * h, 0), "נגמרה המכסה · מתחדש בעוד 12 שעות");
  assert.equal(exhaustedLabel(13 * h, 0), "נגמרה המכסה · מתחדש מחר");
});

test("entries sharing a model id form one quota group named after the first entry", () => {
  const m = parseModels(
    "fast|g-36|מהיר||none|1,deep|g-36|מעמיק||medium|1,lite|g-35-lite|חסכוני||off|1,other|g-38|מהיר 2||none|1",
    { effort: "none" },
    () => {},
  );
  assert.deepEqual(
    publicModels(m).map((p) => [p.key, p.group]),
    [
      ["fast", "fast"],
      ["deep", "fast"],
      ["lite", "lite"],
      ["other", "other"],
    ],
  );
  assert.ok(!JSON.stringify(publicModels(m)).includes("g-"), "group never reveals the model id");
});
