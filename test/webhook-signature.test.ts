import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { SIGNATURE_MAX_AGE_SECONDS, readSignatureHeader, verifySignature } from "../examples/typescript/webhook-signature.ts";

const SECRET = "5f0c9e2a7b41d8366e1fa0b2c4d97e83";
const BODY = JSON.stringify({
  webhook_log_sid: "wh_lg_Lg3tQ8nW5kR2",
  type: "messages.received",
  emitted_at: "2026-11-03T09:12:44+00:00",
  team_sid: "ts_tm_Q4rT8vW2xY6z",
  trace_id: "019a4c2e-5b7d-7a10-8c3f-6e21d9b04a58",
  payload: {
    sid: "ub_ms_Ms4kR8nT2wQ6",
    team_sid: "ts_tm_Q4rT8vW2xY6z",
    conversation_sid: "ub_cv_Bv9nK4xP1sD7",
    channel: "email",
    kind: "email",
    provider_message_sid: null,
    created_at: "2026-11-03T09:12:40+00:00",
  },
});
const NOW = 1_762_160_000;

const sign = (body: string, secret: string, t: number) =>
  `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;

/** The same header with one hex character of v1 changed, at index i of the 64. */
function flipV1(header: string, i: number): string {
  const at = header.indexOf("v1=") + 3;
  const hex = header.slice(at);
  const ch = hex[i] === "0" ? "1" : "0";
  return header.slice(0, at) + hex.slice(0, i) + ch + hex.slice(i + 1);
}

test("accepts a delivery signed with the secret", () => {
  assert.equal(verifySignature(BODY, sign(BODY, SECRET, NOW), SECRET, NOW), true);
});

test("accepts the raw bytes as a Buffer the same way", () => {
  assert.equal(verifySignature(Buffer.from(BODY), sign(BODY, SECRET, NOW), SECRET, NOW), true);
});

test("accepts spaces after the comma", () => {
  assert.equal(verifySignature(BODY, sign(BODY, SECRET, NOW).replace(",", ", "), SECRET, NOW), true);
});

test("matches the signer's known answer, a vector computed outside this file", () => {
  // The vector the backend's signer test pins: t 1700000000, secret topsecret.
  const body = '{"event":"x","data":{"k":"v"}}';
  const header = "t=1700000000,v1=638461faafbaa51140cf04f113427aad135559769316d4fdf3b94ac5828e2c9b";
  assert.equal(verifySignature(body, header, "topsecret", 1_700_000_010), true);
  assert.equal(verifySignature(body, flipV1(header, 63), "topsecret", 1_700_000_010), false);
});

test("refuses a v1 that differs from the right one in its first hex character", () => {
  const header = sign(BODY, SECRET, NOW);
  assert.equal(verifySignature(BODY, flipV1(header, 0), SECRET, NOW), false);
});

test("refuses a v1 that differs from the right one in its last hex character", () => {
  const header = sign(BODY, SECRET, NOW);
  assert.equal(verifySignature(BODY, flipV1(header, 63), SECRET, NOW), false);
});

test("refuses a v1 that differs in any one hex character", () => {
  const header = sign(BODY, SECRET, NOW);
  for (let i = 0; i < 64; i += 1) assert.equal(verifySignature(BODY, flipV1(header, i), SECRET, NOW), false, `position ${i}`);
});

test("refuses a body changed after signing", () => {
  const header = sign(BODY, SECRET, NOW);
  assert.equal(verifySignature(BODY.replace("messages.received", "messages.sent"), header, SECRET, NOW), false);
});

test("refuses the same JSON written out again with other bytes", () => {
  // The sender writes a non-ASCII letter as a backslash-u escape and a float as
  // 1.0. JSON.parse and JSON.stringify return the same value as other bytes.
  const sent = '{"type":"webhooks.test","payload":{"test":true,"note":"caf\\u00e9","score":1.0}}';
  const header = sign(sent, SECRET, NOW);
  const rewritten = JSON.stringify(JSON.parse(sent));
  assert.deepEqual(JSON.parse(rewritten), JSON.parse(sent));
  assert.notEqual(rewritten, sent);
  assert.equal(verifySignature(sent, header, SECRET, NOW), true);
  assert.equal(verifySignature(rewritten, header, SECRET, NOW), false);
});

test("refuses a body that was parsed and re-encoded with other spacing", () => {
  const header = sign(BODY, SECRET, NOW);
  assert.equal(verifySignature(JSON.stringify(JSON.parse(BODY), null, 2), header, SECRET, NOW), false);
});

test("refuses another secret", () => {
  assert.equal(verifySignature(BODY, sign(BODY, "another-secret", NOW), SECRET, NOW), false);
});

test("refuses a signature older than the window, and one too far ahead", () => {
  const old = NOW - SIGNATURE_MAX_AGE_SECONDS - 1;
  assert.equal(verifySignature(BODY, sign(BODY, SECRET, old), SECRET, NOW), false);
  const ahead = NOW + SIGNATURE_MAX_AGE_SECONDS + 1;
  assert.equal(verifySignature(BODY, sign(BODY, SECRET, ahead), SECRET, NOW), false);
  const edge = NOW - SIGNATURE_MAX_AGE_SECONDS;
  assert.equal(verifySignature(BODY, sign(BODY, SECRET, edge), SECRET, NOW), true);
});

test("fails closed when the secret is set and the body or the header is missing", () => {
  const header = sign(BODY, SECRET, NOW);
  assert.equal(verifySignature(undefined, header, SECRET, NOW), false);
  assert.equal(verifySignature(null, header, SECRET, NOW), false);
  assert.equal(verifySignature(BODY, undefined, SECRET, NOW), false);
  assert.equal(verifySignature(BODY, null, SECRET, NOW), false);
});

test("fails closed when no secret is set, even for a header made with an empty key", () => {
  assert.equal(verifySignature(BODY, sign(BODY, "", NOW), "", NOW), false);
  assert.equal(verifySignature(BODY, sign(BODY, SECRET, NOW), undefined, NOW), false);
  assert.equal(verifySignature(BODY, sign(BODY, SECRET, NOW), null, NOW), false);
});

test("refuses a missing or malformed header without throwing", () => {
  const hex = "a".repeat(64);
  for (const header of [undefined, "", "v1=abc", "t=abc,v1=def", `t=${NOW}`, "nonsense", `t=${NOW},v1=`, `v1=${hex}`, `t=-5,v1=${hex}`, `t=${NOW},v1=${"g".repeat(64)}`]) {
    assert.equal(verifySignature(BODY, header, SECRET, NOW), false, String(header));
  }
});

test("refuses a v1 of another length without throwing", () => {
  assert.equal(verifySignature(BODY, `t=${NOW},v1=abcd`, SECRET, NOW), false);
  const header = sign(BODY, SECRET, NOW);
  assert.equal(verifySignature(BODY, `${header}0`, SECRET, NOW), false);
  assert.equal(verifySignature(BODY, header.slice(0, -1), SECRET, NOW), false);
});

test("the header check alone answers before any body is read", () => {
  const header = sign(BODY, SECRET, NOW);
  const read = readSignatureHeader(header, NOW);
  assert.ok(read);
  assert.equal(read.t, String(NOW));
  assert.equal(read.v1.length, 32);
  assert.equal(readSignatureHeader(sign(BODY, SECRET, NOW - SIGNATURE_MAX_AGE_SECONDS - 1), NOW), null);
  assert.equal(readSignatureHeader(undefined, NOW), null);
  assert.equal(readSignatureHeader("t=1762160000", NOW), null);
});
