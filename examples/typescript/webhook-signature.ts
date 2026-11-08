// Checks the signature GetSales puts on each webhook delivery.
//
// The X-Webhook-Signature header reads t=<unix seconds>,v1=<64 hex characters>.
// v1 is an HMAC-SHA256 of the timestamp, a dot and the request body as it came
// off the wire, keyed with the secret that create_webhook handed back when the
// subscription was made.
// Guide: https://docs.getsales.io/guides/receive-webhooks
import { createHmac, timingSafeEqual } from "node:crypto";

/** How far t may sit from this machine's clock, either way, before a delivery is refused as a possible replay. */
export const SIGNATURE_MAX_AGE_SECONDS = 300;

export interface SignatureHeader {
  /** The timestamp exactly as the header wrote it, since the HMAC covers those digits. */
  t: string;
  /** The 32 bytes the 64 hex characters of v1 stand for. */
  v1: Buffer;
}

/**
 * Reads the header without the body. Returns null when the header is missing,
 * does not read t=<digits>,v1=<64 hex characters>, or carries a timestamp
 * outside the window. A receiver can call this before it reads a byte of the
 * body and refuse at once.
 */
export function readSignatureHeader(
  header: string | null | undefined,
  nowSeconds: number = Date.now() / 1000,
): SignatureHeader | null {
  if (typeof header !== "string" || header === "") return null;
  let t: string | undefined;
  let v1: string | undefined;
  for (const piece of header.split(",")) {
    const at = piece.indexOf("=");
    if (at <= 0) continue;
    const name = piece.slice(0, at).trim();
    const value = piece.slice(at + 1).trim();
    if (name === "t") t = value;
    else if (name === "v1") v1 = value;
  }
  if (t === undefined || !/^\d{1,12}$/.test(t)) return null;
  if (v1 === undefined || !/^[0-9a-fA-F]{64}$/.test(v1)) return null;
  if (Math.abs(nowSeconds - Number(t)) > SIGNATURE_MAX_AGE_SECONDS) return null;
  return { t, v1: Buffer.from(v1, "hex") };
}

/**
 * True only when the header was made from these exact body bytes with this
 * secret, inside the window. Hand it the body before JSON.parse sees it: the
 * same JSON written out again can differ byte for byte (an escape decoded, a
 * number reformatted, keys in another order) and then the MAC will not match.
 * A missing secret, body or header is a refusal, never a pass.
 */
export function verifySignature(
  rawBody: string | Uint8Array | null | undefined,
  header: string | null | undefined,
  secret: string | null | undefined,
  nowSeconds: number = Date.now() / 1000,
): boolean {
  if (typeof secret !== "string" || secret === "") return false;
  if (rawBody === null || rawBody === undefined) return false;
  const signature = readSignatureHeader(header, nowSeconds);
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(`${signature.t}.`).update(rawBody).digest();
  // Both sides are 32 bytes here, which timingSafeEqual requires.
  return timingSafeEqual(expected, signature.v1);
}
