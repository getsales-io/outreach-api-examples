// 10: subscribe to replies, and check the signature of every delivery.
//
// subscribe registers your public https endpoint for messages.received and
// then has GetSales send it one signed test delivery. The answer to the
// register call is the only place the webhook's secret ever appears, so copy
// it into your secret store the moment it prints.
// serve runs a small receiver for local work, meant to sit behind an https
// tunnel of your own. It reads the secret from GETSALES_WEBHOOK_SECRET, never
// from the command line, so the secret stays out of the process list and out
// of your shell history. It refuses a request with no fresh signature header
// before reading any of the body, stops reading a body at 1 MiB, answers 200
// to a delivery it verified, and then looks up the reply's text: a delivery
// names the message by sid and carries no text.
// A URL can hold one subscription per workspace, so a second register call
// for it answers 409 duplicate_rejected. Delete the webhook to start over.
// Run: node examples/typescript/10-subscribe-to-replies.ts subscribe https://example.com/hooks/getsales
//      read -rs GETSALES_WEBHOOK_SECRET && export GETSALES_WEBHOOK_SECRET
//      node examples/typescript/10-subscribe-to-replies.ts serve 8787
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { GetSalesError, gs, run, usage, type ActionResult, type CreateResult, type SearchResult } from "./client.ts";
import { readSignatureHeader, verifySignature } from "./webhook-signature.ts";

interface Webhook {
  sid: string;
  target_url: string;
  events: string[];
  secret?: string | null;
  status: "on" | "off" | "failed";
}

interface TestResult {
  http_status: number | null;
  duration_ms: number;
  error_kind: string;
}

interface Message {
  sid: string;
  conversation_sid: string;
  channel: "linkedin" | "email";
  direction: "inbound" | "outbound";
  body_text: string;
}

/**
 * The envelope around every delivery. payload holds the event's own fields:
 * for messages.received the message's sid, team_sid, conversation_sid,
 * channel, kind, provider_message_sid and created_at, and never its text.
 * The delivery that test_webhook sends carries { test: true } instead.
 */
interface Delivery {
  webhook_log_sid: string;
  type: string;
  emitted_at: string;
  team_sid: string;
  trace_id: string;
  payload?: {
    sid?: string;
    team_sid?: string;
    conversation_sid?: string;
    channel?: string;
    kind?: string;
    provider_message_sid?: string | null;
    created_at?: string | null;
    test?: boolean;
  };
}

/** A delivery is at most 64 KiB of JSON, so a body that passes this size is refused and the rest of it never read. */
const MAX_BODY_BYTES = 1024 * 1024;

const USAGE = "10-subscribe-to-replies.ts subscribe <public https URL> | serve <port>  (serve reads GETSALES_WEBHOOK_SECRET)";
const [mode, arg] = process.argv.slice(2);

async function subscribe(targetUrl: string): Promise<void> {
  let created: CreateResult<Webhook>;
  try {
    created = await gs.post<CreateResult<Webhook>>("integrations", "/api/webhooks", {
      name: "Replies",
      // GetSales posts only to https on a host the internet can reach.
      target_url: targetUrl,
      events: ["messages.received"],
    });
  } catch (err) {
    if (err instanceof GetSalesError && err.code === "duplicate_rejected") {
      throw new Error("The workspace already has a subscription for this URL. Delete that webhook first, or register a different URL.");
    }
    throw err;
  }
  const webhook = created.item;
  console.log(`webhook: ${webhook.sid}, ${webhook.status}, events ${webhook.events.join(", ")}`);
  console.log(`secret:  ${webhook.secret}`);
  console.log("No later read returns the secret. Keep it in your secret store, and give it to serve as GETSALES_WEBHOOK_SECRET.");

  const test = await gs.post<ActionResult<TestResult>>("integrations", `/api/webhooks/${webhook.sid}/test`, {
    override_event_type: "messages.received",
  });
  console.log(`test delivery: HTTP ${test.result.http_status ?? "no answer"}, ${test.result.error_kind}, ${test.result.duration_ms} ms`);
}

async function readReply(messageSid: string): Promise<void> {
  const res = await gs.post<SearchResult<Message>>("unibox", "/api/messages/search", {
    filter: { sid: { eq: messageSid } },
    page_size: 1,
  });
  const message = res.items[0]?.item;
  if (!message) {
    console.log(`no message ${messageSid} in the workspace`);
    return;
  }
  console.log(`reply on ${message.channel} in ${message.conversation_sid}: ${message.body_text}`);
}

/** Answers a refusal and closes the connection once the answer is out, so nothing more of the request is read. */
function refuse(req: IncomingMessage, res: ServerResponse, status: number, why: string): void {
  console.log(`refused a request (${status}): ${why}`);
  res.writeHead(status, { "Content-Type": "application/json", Connection: "close" });
  res.end('{"ok":false}', () => req.destroy());
}

function handleDelivery(raw: Buffer): void {
  let delivery: Delivery;
  try {
    delivery = JSON.parse(raw.toString("utf8")) as Delivery;
  } catch {
    console.log("a signed delivery whose body is not JSON");
    return;
  }
  console.log(`delivery ${delivery.webhook_log_sid}: ${delivery.type}${delivery.payload?.test ? " (test)" : ""}`);
  const messageSid = delivery.payload?.sid;
  if (delivery.type === "messages.received" && typeof messageSid === "string") {
    readReply(messageSid).catch((err: unknown) => console.error(err instanceof Error ? err.message : err));
  }
}

function serve(port: number, secret: string): void {
  // A delivery arrives in one piece: a request still trickling in after 10 seconds is cut off.
  const server = createServer({ requestTimeout: 10_000, headersTimeout: 10_000 }, (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405, { Allow: "POST", Connection: "close" }).end();
      return;
    }
    const header = req.headers["x-webhook-signature"];
    const signature = typeof header === "string" ? header : undefined;
    // The cheap checks come before any of the body is read: the header has to be there, well formed and fresh.
    if (!readSignatureHeader(signature)) {
      refuse(req, res, 401, "no fresh, well-formed X-Webhook-Signature header");
      return;
    }
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      refuse(req, res, 413, `Content-Length ${declared} is over ${MAX_BODY_BYTES} bytes`);
      return;
    }

    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on("data", (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        done = true;
        chunks.length = 0;
        refuse(req, res, 413, `the body passed ${MAX_BODY_BYTES} bytes`);
        return;
      }
      chunks.push(chunk);
    });
    req.on("error", () => {
      done = true;
    });
    req.on("end", () => {
      if (done) return;
      done = true;
      const raw = Buffer.concat(chunks);
      if (!verifySignature(raw, signature, secret)) {
        refuse(req, res, 401, "the signature does not match this body and secret");
        return;
      }
      // Answer 2xx once the delivery is verified, then do the work.
      res.writeHead(200, { "Content-Type": "application/json" }).end('{"ok":true}');
      handleDelivery(raw);
    });
  });
  server.listen(port, "127.0.0.1", () => {
    const address = server.address();
    console.log(`listening on http://127.0.0.1:${typeof address === "object" && address ? address.port : port}`);
  });
}

if (mode === "subscribe" && arg) {
  run(() => subscribe(arg));
} else if (mode === "serve" && arg) {
  const port = Number(arg);
  if (!Number.isInteger(port) || port < 0 || port > 65535) usage(USAGE);
  const secret = process.env.GETSALES_WEBHOOK_SECRET;
  if (!secret) {
    console.error("GETSALES_WEBHOOK_SECRET is not set. It is the secret the subscribe step printed: read -rs GETSALES_WEBHOOK_SECRET && export GETSALES_WEBHOOK_SECRET");
    process.exit(2);
  }
  run(async () => serve(port, secret));
} else {
  usage(USAGE);
}
