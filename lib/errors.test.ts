import { test } from "node:test";
import assert from "node:assert/strict";
import { APIConnectionError, APIConnectionTimeoutError, APIError } from "openai";
import { MSG_GENERIC } from "./chat.ts";
import { classifyAiError, hebrewError, isDailyQuota } from "./errors.ts";

// Gemini's OpenAI-compatible endpoint: an array with one error object.
const gemini = (code: number, status: string, message: string, details: unknown[] = []) => [{ error: { code, status, message, details } }];
const quotaBody = (quotaId: string, retryDelay: string) =>
  gemini(429, "RESOURCE_EXHAUSTED", "You exceeded your current quota, please check your plan and billing details.", [
    { violations: [{ quotaId, quotaValue: "20" }] },
    { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay },
  ]);

const DAILY = new APIError(429, quotaBody("GenerateRequestsPerDayPerProjectPerModel-FreeTier", "7200s"), undefined, undefined);
const PER_MINUTE = new APIError(429, quotaBody("GenerateRequestsPerMinutePerProjectPerModel-FreeTier", "39s"), undefined, undefined);
// No quota id at all, but a retry hours away: still a daily limit.
const DAILY_NO_DETAILS = new APIError(429, gemini(429, "RESOURCE_EXHAUSTED", "Quota exceeded. Please retry in 5h17m56.3s."), undefined, undefined);
const BARE_429 = new APIError(429, { error: { message: "rate limited" } }, undefined, undefined);
const OVERLOADED = new APIError(503, gemini(503, "UNAVAILABLE", "The model is overloaded due to high demand."), undefined, undefined);
// Errors that arrive inside an already-open stream carry no HTTP status.
const STREAM_DAILY = new APIError(undefined, quotaBody("GenerateRequestsPerDayPerProjectPerModel-FreeTier", "7200s")[0].error, undefined, undefined);
const STREAM_UNAVAILABLE = new APIError(undefined, { code: 503, status: "UNAVAILABLE", message: "high demand" }, undefined, undefined);
const STREAM_DROPPED = new APIError(undefined, undefined, "terminated", undefined);

test("classification: daily quota vs per-minute limit vs temporary, for requests and streams", () => {
  assert.equal(classifyAiError(DAILY), "quota");
  assert.equal(classifyAiError(DAILY_NO_DETAILS), "quota");
  assert.equal(classifyAiError(STREAM_DAILY), "quota");
  assert.equal(classifyAiError(PER_MINUTE), "rate");
  assert.equal(classifyAiError(BARE_429), "rate");
  assert.equal(classifyAiError(OVERLOADED), "temporary");
  assert.equal(classifyAiError(new APIError(500, undefined, "boom", undefined)), "temporary");
  assert.equal(classifyAiError(STREAM_UNAVAILABLE), "temporary");
  assert.equal(classifyAiError(new APIConnectionTimeoutError()), "timeout");
  assert.equal(classifyAiError(Object.assign(new Error("aborted"), { name: "TimeoutError" })), "timeout");
  assert.equal(classifyAiError(new APIConnectionError({ message: "Connection error." })), "network");
  assert.equal(classifyAiError(STREAM_DROPPED), "network");
  assert.equal(classifyAiError(new APIError(401, undefined, "bad key", undefined)), "auth");
  assert.equal(classifyAiError(new APIError(404, undefined, "no model", undefined)), "notFound");
  assert.equal(classifyAiError(new APIError(400, undefined, "too long", undefined)), "badRequest");
  assert.equal(classifyAiError(new Error("something else")), "other");
  assert.equal(classifyAiError("not an error"), "other");
});

test("isDailyQuota: only a day-long limit", () => {
  assert.equal(isDailyQuota(DAILY), true);
  assert.equal(isDailyQuota(STREAM_DAILY), true);
  assert.equal(isDailyQuota(PER_MINUTE), false);
  assert.equal(isDailyQuota(OVERLOADED), false);
  assert.equal(isDailyQuota(new Error("quota exceeded")), false, "only provider errors");
});

test("Hebrew messages: daily quota points to the model picker; temporary errors say try again soon", () => {
  const alt = { alternatives: true };
  assert.equal(hebrewError(DAILY, alt), "המכסה היומית של המודל הזה נגמרה. החליפו מודל בכפתור ליד השליחה, או נסו שוב מחר.");
  assert.equal(hebrewError(STREAM_DAILY, alt), hebrewError(DAILY, alt), "same message when it arrives mid-stream");
  assert.equal(hebrewError(DAILY), "המכסה היומית של שירות ה-AI נגמרה. נסו שוב מחר.", "no other model to switch to");
  assert.equal(hebrewError(PER_MINUTE, alt), "הגעתם למגבלת השימוש. חכו דקה ונסו שוב, או החליפו מודל בכפתור ליד השליחה.");
  assert.equal(hebrewError(PER_MINUTE), "הגעתם למגבלת השימוש. חכו דקה ונסו שוב.");
  assert.equal(hebrewError(OVERLOADED, alt), "שירות ה-AI לא זמין כרגע. נסו שוב בעוד רגע.");
  assert.equal(hebrewError(STREAM_UNAVAILABLE), "שירות ה-AI לא זמין כרגע. נסו שוב בעוד רגע.");
  assert.equal(hebrewError(new APIConnectionTimeoutError()), "שירות ה-AI לא הגיב בזמן. נסו שוב בעוד רגע.");
  assert.equal(hebrewError(new APIConnectionError({ message: "x" })), "אין תקשורת עם שירות ה-AI. נסו שוב בעוד רגע.");
  for (const temporary of [OVERLOADED, STREAM_UNAVAILABLE, new APIConnectionTimeoutError()])
    assert.doesNotMatch(hebrewError(temporary, alt), /מכסה|מחר/, "a temporary error never says quota or tomorrow");
  assert.match(hebrewError(new APIError(401, undefined, "", undefined)), /בעיית הרשאה/);
  assert.match(hebrewError(new APIError(404, undefined, "", undefined)), /המודל שהוגדר לא נמצא/);
  assert.match(hebrewError(new APIError(400, undefined, "", undefined)), /הבקשה לא התקבלה/);
  assert.equal(hebrewError(new Error("?")), MSG_GENERIC);
});
