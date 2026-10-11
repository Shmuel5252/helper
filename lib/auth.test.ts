import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidCode, isValidSession, sessionToken } from "./auth.ts";

test("access code: correct, wrong, empty, missing env", async () => {
  assert.equal(await isValidCode("s3cret", "s3cret"), true);
  assert.equal(await isValidCode("  s3cret \n", "s3cret"), true); // pasted with whitespace
  assert.equal(await isValidCode("s3cre", "s3cret"), false);
  assert.equal(await isValidCode("S3CRET", "s3cret"), false);
  assert.equal(await isValidCode("", "s3cret"), false);
  assert.equal(await isValidCode("anything", undefined), false);
  assert.equal(await isValidCode("", ""), false);
});

test("session cookie: token never equals the code and depends on it", async () => {
  const token = await sessionToken("s3cret");
  assert.notEqual(token, "s3cret");
  assert.equal(await isValidSession(token, "s3cret"), true);
  assert.equal(await isValidSession(token, "other"), false);
  assert.equal(await isValidSession("s3cret", "s3cret"), false);
  assert.equal(await isValidSession(undefined, "s3cret"), false);
  assert.equal(await isValidSession(token, undefined), false);
});

test("session cookie lasts 365 days and is httpOnly, secure, lax", async () => {
  const { SESSION_COOKIE } = await import("./auth.ts");
  assert.equal(SESSION_COOKIE.maxAge, 365 * 24 * 60 * 60);
  assert.deepEqual([SESSION_COOKIE.httpOnly, SESSION_COOKIE.secure, SESSION_COOKIE.sameSite], [true, true, "lax"]);
});
