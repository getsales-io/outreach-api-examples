// Runs every example, curl and TypeScript, against the local mock API and
// checks the calls each one makes. No network: the examples read
// GETSALES_API_HOST, which points them at the mock.
import assert from "node:assert/strict";
import { execFile, spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  REPLY_TEXT,
  SIDS,
  TEAMMATE_EMAIL,
  TEST_KEY,
  WEBHOOK_SECRET,
  startMockApi,
  type MockApi,
  type RecordedRequest,
} from "./mock-api.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HAVE_CURL_TOOLS = ["curl", "jq", "openssl"].every((tool) => spawnSync("sh", ["-c", `command -v ${tool}`]).status === 0);
/** The size past which the receiver in example 10 stops reading a body. */
const RECEIVER_CAP = 1024 * 1024;

/** Everything the examples are allowed to call. Nothing here sends on a channel. */
const ALLOWED = new Set([
  "search_playtables", "create_playtable", "get_playtable", "create_person", "search_people", "search_companies",
  "list_provider_catalog", "create_playtable_field", "estimate_credits", "create_playtable_run", "get_playtable_run",
  "search_workflows", "add_workflow_people", "search_sender_profiles", "create_webhook", "test_webhook", "search_messages",
  "get_conversation", "search_team_members", "create_task",
]);

let api: MockApi;

before(async () => {
  api = await startMockApi();
  if (!api.contractSource) console.log("# OpenAPI documents not found: requests are checked by the mock's own routes only");
});

after(async () => {
  await api.close();
});

interface Outcome {
  code: number;
  stdout: string;
  stderr: string;
  requests: RecordedRequest[];
  problems: string[];
}

/** The environment an example runs in. A key set to undefined is left out. */
function env(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...process.env, GETSALES_API_HOST: api.url, GETSALES_API_KEY: TEST_KEY };
  delete out.GETSALES_WEBHOOK_SECRET;
  for (const [name, value] of Object.entries(extra)) {
    if (value === undefined) delete out[name];
    else out[name] = value;
  }
  return out;
}

function runExample(kind: "curl" | "typescript", name: string, args: string[], extraEnv: Record<string, string | undefined> = {}): Promise<Outcome> {
  api.reset();
  // A curl script runs the way a reader runs it, through its shebang, so the
  // executable bit is tested too.
  const file = kind === "curl" ? join(ROOT, "examples", "curl", `${name}.sh`) : join(ROOT, "examples", "typescript", `${name}.ts`);
  const [command, argv] = kind === "curl" ? [file, args] : [process.execPath, [file, ...args]];
  return new Promise((done) => {
    execFile(command, argv, { env: env(extraEnv), timeout: 60_000 }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === "number" ? err.code : 1) : 0;
      done({ code, stdout, stderr, requests: api.requests.slice(), problems: api.problems.slice() });
    });
  });
}

const operations = (outcome: Outcome) => outcome.requests.map((r) => r.operationId ?? `${r.method} ${r.path}`);
const bodyOf = (outcome: Outcome, operationId: string) => outcome.requests.find((r) => r.operationId === operationId)?.body as any;

interface Case {
  name: string;
  file: string;
  args: string[];
  expect: string[];
  check?: (outcome: Outcome) => void;
}

const CASES: Case[] = [
  { name: "01 check the key", file: "01-check-key", args: [], expect: ["search_playtables"] },
  {
    name: "02 create a table", file: "02-create-table", args: ["Agencies for the Q4 campaign"], expect: ["create_playtable"],
    check: (o) => assert.deepEqual(bodyOf(o, "create_playtable").config, { auto_run: false }),
  },
  {
    name: "03 add a person", file: "03-add-person-to-table", args: [SIDS.table, "jane.cooper@example.com", "Jane Cooper", "jane-cooper-example"],
    expect: ["create_person"],
    check: (o) => {
      const body = bodyOf(o, "create_person");
      assert.equal(body.on_duplicate, "skip");
      assert.equal(body.ln_nickname, "jane-cooper-example");
    },
  },
  {
    name: "03 add a person with no email", file: "03-add-person-to-table", args: [SIDS.table, "-", "Jane Cooper"], expect: ["create_person"],
    check: (o) => assert.equal(bodyOf(o, "create_person").work_email, null),
  },
  {
    name: "04 find a person by email", file: "04-find-person", args: ["Jane.Cooper@Example.com"], expect: ["search_people"],
    check: (o) => assert.deepEqual(bodyOf(o, "search_people").filter, { work_email: { eq: "jane.cooper@example.com" } }),
  },
  {
    name: "04 an email with spaces around it is trimmed and lowercased", file: "04-find-person", args: ["  JANE.Cooper@example.COM \t"], expect: ["search_people"],
    check: (o) => assert.deepEqual(bodyOf(o, "search_people").filter, { work_email: { eq: "jane.cooper@example.com" } }),
  },
  {
    name: "04 find a person by name", file: "04-find-person", args: ["Jane Cooper"], expect: ["search_people"],
    check: (o) => assert.deepEqual(bodyOf(o, "search_people").filter, { q: "Jane Cooper" }),
  },
  {
    name: "04 free text is trimmed too, and keeps its case", file: "04-find-person", args: ["  Jane Cooper  "], expect: ["search_people"],
    check: (o) => assert.deepEqual(bodyOf(o, "search_people").filter, { q: "Jane Cooper" }),
  },
  {
    name: "05 search companies by domain", file: "05-search-companies", args: ["Example.com"], expect: ["search_companies"],
    check: (o) => assert.deepEqual(bodyOf(o, "search_companies").filter, { domain: { eq: "example.com" } }),
  },
  {
    name: "05 search companies by name", file: "05-search-companies", args: ["Example Agency"], expect: ["search_companies"],
    check: (o) => assert.deepEqual(bodyOf(o, "search_companies").filter, { q: "Example Agency" }),
  },
  {
    name: "06 waterfall column, estimate only", file: "06-waterfall-enrichment", args: [SIDS.table],
    expect: ["list_provider_catalog", "get_playtable", "create_playtable_field", "estimate_credits"],
    check: (o) => {
      const payload = bodyOf(o, "create_playtable_field").payload;
      // the row's own address, then the two finders that have a platform key, in catalog order
      assert.deepEqual(payload.steps.map((s: { tool_sid: string }) => s.tool_sid), [
        "row:people.work_email",
        "in:hunter.email.find",
        "in:findymail.email.find",
      ]);
      assert.deepEqual(payload.verify, { tool_sid: "in:emaillistverify.email.verify", params: {} });
      assert.equal(bodyOf(o, "create_playtable_field").config.auto_run, false);
      assert.deepEqual(bodyOf(o, "estimate_credits"), {
        rows: { view_sid: SIDS.peopleView },
        actions: [{ type: "column", field_sid: SIDS.field, cells: "not_run" }],
      });
      // The budget it suggests is the estimate's max (45.6), never expected (18.4).
      assert.match(o.stdout + o.stderr, new RegExp(`${SIDS.table} 45\\.6\\n`));
    },
  },
  {
    name: "06 waterfall column, run with a budget", file: "06-waterfall-enrichment", args: [SIDS.table, "50"],
    expect: ["list_provider_catalog", "get_playtable", "create_playtable_field", "estimate_credits", "create_playtable_run", "get_playtable_run"],
    check: (o) => {
      const run = bodyOf(o, "create_playtable_run");
      const estimate = bodyOf(o, "estimate_credits");
      assert.equal(run.max_budget, 50);
      assert.equal(run.type, "enrich");
      assert.deepEqual(run.field_sids, [SIDS.field]);
      // The estimate priced the rows and the cells this run takes.
      assert.deepEqual(run.scope, estimate.rows);
      assert.equal(run.params.cells, estimate.actions[0].cells);
      assert.doesNotMatch(o.stdout + o.stderr, /budget_exhausted/);
      assert.deepEqual(o.requests.at(-1)?.query, { "include[]": ["progress"] });
    },
  },
  {
    name: "06 a budget over expected but under max gets a warning", file: "06-waterfall-enrichment", args: [SIDS.table, "30"],
    expect: ["list_provider_catalog", "get_playtable", "create_playtable_field", "estimate_credits", "create_playtable_run", "get_playtable_run"],
    check: (o) => {
      assert.equal(bodyOf(o, "create_playtable_run").max_budget, 30);
      assert.match(o.stdout + o.stderr, /under the estimate's max \(45\.6\).*budget_exhausted/);
    },
  },
  { name: "07 list workflows", file: "07-list-workflows", args: [], expect: ["search_workflows"] },
  {
    name: "08 add people in one call, and the one it holds stays as they are", file: "08-add-people-to-workflow",
    args: [SIDS.workflow, SIDS.person, SIDS.newPerson],
    expect: ["add_workflow_people"],
    check: (o) => {
      assert.equal(o.requests[0]?.path, `/api/workflows/${SIDS.workflow}/add-people`);
      // Nobody is filtered out first, and no restart: the server leaves the person it holds as they are.
      assert.deepEqual(bodyOf(o, "add_workflow_people"), { people_sids: [SIDS.person, SIDS.newPerson] });
    },
  },
  {
    name: "08 a sid given twice is sent once, in the order given", file: "08-add-people-to-workflow",
    args: [SIDS.workflow, SIDS.newPerson, SIDS.person, SIDS.newPerson],
    expect: ["add_workflow_people"],
    check: (o) => assert.deepEqual(bodyOf(o, "add_workflow_people").people_sids, [SIDS.newPerson, SIDS.person]),
  },
  { name: "09 list sender profiles", file: "09-list-sender-profiles", args: [], expect: ["search_sender_profiles"] },
  {
    name: "10 subscribe to replies", file: "10-subscribe-to-replies", args: ["subscribe", "https://example.com/hooks/getsales"],
    expect: ["create_webhook", "test_webhook"],
    check: (o) => {
      assert.deepEqual(bodyOf(o, "create_webhook").events, ["messages.received"]);
      assert.equal(bodyOf(o, "test_webhook").override_event_type, "messages.received");
    },
  },
  {
    name: "11 read a conversation", file: "11-read-conversation", args: [SIDS.conversation], expect: ["get_conversation", "search_messages"],
    check: (o) => assert.deepEqual(o.requests[0]?.query, { "include[]": ["participants"] }),
  },
  { name: "12 hand-off task, unassigned", file: "12-create-handoff-task", args: [SIDS.conversation], expect: ["create_task"] },
  {
    name: "12 hand-off task to a teammate", file: "12-create-handoff-task", args: [SIDS.conversation, TEAMMATE_EMAIL],
    expect: ["search_team_members", "create_task"],
    check: (o) => assert.equal(bodyOf(o, "create_task").assignee_user_sid, SIDS.user),
  },
  {
    name: "12 the teammate's email is trimmed and lowercased", file: "12-create-handoff-task", args: [SIDS.conversation, ` ${TEAMMATE_EMAIL.toUpperCase()} `],
    expect: ["search_team_members", "create_task"],
    check: (o) => {
      assert.equal(bodyOf(o, "search_team_members").filter.email.eq, TEAMMATE_EMAIL);
      assert.equal(bodyOf(o, "create_task").assignee_user_sid, SIDS.user);
    },
  },
];

function assertClean(outcome: Outcome, expect: string[]): void {
  assert.equal(outcome.code, 0, `exit code ${outcome.code}\nstdout:\n${outcome.stdout}\nstderr:\n${outcome.stderr}`);
  assert.deepEqual(outcome.problems, [], `the mock found problems:\n${outcome.problems.join("\n")}`);
  assert.deepEqual(operations(outcome), expect);
  for (const op of operations(outcome)) assert.ok(ALLOWED.has(op), `${op} is not on the allowed list`);
}

describe("TypeScript examples", () => {
  for (const c of CASES) {
    test(c.name, async () => {
      const outcome = await runExample("typescript", c.file, c.args);
      assertClean(outcome, c.expect);
      c.check?.(outcome);
    });
  }
});

describe("curl examples", { skip: HAVE_CURL_TOOLS ? false : "needs curl, jq and openssl" }, () => {
  for (const c of CASES) {
    test(c.name, async () => {
      const outcome = await runExample("curl", c.file, c.args);
      assertClean(outcome, c.expect);
      c.check?.(outcome);
    });
  }
});

describe("verifying a delivery and reading the reply", () => {
  // A messages.received delivery as GetSales sends it: references only, no text.
  const delivery = JSON.stringify({
    webhook_log_sid: "wh_lg_Lg3tQ8nW5kR2",
    type: "messages.received",
    emitted_at: "2026-11-03T09:12:44+00:00",
    team_sid: SIDS.team,
    trace_id: "019a4c2e-5b7d-7a10-8c3f-6e21d9b04a58",
    payload: {
      sid: SIDS.message,
      team_sid: SIDS.team,
      conversation_sid: SIDS.conversation,
      channel: "email",
      kind: "email",
      provider_message_sid: null,
      created_at: "2026-11-03T08:12:44+00:00",
    },
  });
  const header = (secret: string, body: string = delivery) => {
    const t = Math.floor(Date.now() / 1000);
    return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
  };
  /** The header with the last hex character of v1 changed: one byte off the right MAC. */
  const lastByteOff = (value: string) => value.slice(0, -1) + (value.endsWith("0") ? "1" : "0");

  const curlOnly = { skip: HAVE_CURL_TOOLS ? false : "needs curl, jq and openssl" };

  test("curl: verify accepts a signed delivery, reads the reply, and refuses a forged or one-byte-off signature", curlOnly, async () => {
    const dir = mkdtempSync(join(tmpdir(), "outreach-examples-"));
    try {
      const file = join(dir, "delivery.json");
      writeFileSync(file, delivery);
      const secretEnv = { GETSALES_WEBHOOK_SECRET: WEBHOOK_SECRET };
      const ok = await runExample("curl", "10-subscribe-to-replies", ["verify", header(WEBHOOK_SECRET), file], secretEnv);
      assertClean(ok, ["search_messages"]);
      assert.match(ok.stdout, new RegExp(REPLY_TEXT.slice(0, 20)));
      for (const bad of [header("not-the-secret"), lastByteOff(header(WEBHOOK_SECRET))]) {
        const refused = await runExample("curl", "10-subscribe-to-replies", ["verify", bad, file], secretEnv);
        assert.equal(refused.code, 1, refused.stderr);
        assert.deepEqual(refused.requests, []);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("curl: verify fails closed without GETSALES_WEBHOOK_SECRET and never takes the secret as an argument", curlOnly, async () => {
    const dir = mkdtempSync(join(tmpdir(), "outreach-examples-"));
    try {
      const file = join(dir, "delivery.json");
      writeFileSync(file, delivery);
      const noSecret = await runExample("curl", "10-subscribe-to-replies", ["verify", header(WEBHOOK_SECRET), file]);
      assert.equal(noSecret.code, 1);
      assert.match(noSecret.stderr, /GETSALES_WEBHOOK_SECRET/);
      assert.deepEqual(noSecret.requests, []);
      // The old argument order, secret first, is a usage error now.
      const oldOrder = await runExample("curl", "10-subscribe-to-replies", ["verify", WEBHOOK_SECRET, header(WEBHOOK_SECRET), file], { GETSALES_WEBHOOK_SECRET: WEBHOOK_SECRET });
      assert.notEqual(oldOrder.code, 0);
      assert.deepEqual(oldOrder.requests, []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  interface Receiver {
    child: ChildProcessWithoutNullStreams;
    port: number;
    output: () => string;
  }

  async function startReceiver(): Promise<Receiver> {
    api.reset();
    const child = spawn(process.execPath, [join(ROOT, "examples", "typescript", "10-subscribe-to-replies.ts"), "serve", "0"], {
      env: env({ GETSALES_WEBHOOK_SECRET: WEBHOOK_SECRET }),
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    const port = await new Promise<number>((done, fail) => {
      const timer = setTimeout(() => fail(new Error(`no listening line:\n${output}`)), 10_000);
      child.stdout.on("data", () => {
        const found = /listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(output);
        if (found) {
          clearTimeout(timer);
          done(Number(found[1]));
        }
      });
    });
    return { child, port, output: () => output };
  }

  /**
   * Posts to the receiver and resolves with the status of its answer, or with
   * the socket error when the receiver cut the connection first. The body goes
   * out in chunks, so the receiver can answer before it has all of it.
   */
  function post(port: number, headers: Record<string, string>, chunks: Buffer[]): Promise<number | string> {
    return new Promise((done) => {
      let settled = false;
      const req = request({ host: "127.0.0.1", port, path: "/hooks/getsales", method: "POST", headers }, (res) => {
        settled = true;
        res.resume();
        done(res.statusCode ?? 0);
      });
      req.on("error", (err: NodeJS.ErrnoException) => {
        if (settled) return;
        settled = true;
        done(err.code ?? err.message);
      });
      for (const chunk of chunks) req.write(chunk);
      req.end();
    });
  }

  /**
   * A refusal of a request whose body was still arriving. The receiver writes
   * its answer and closes the socket at once, so the client sees either the
   * status or a reset, whichever its TCP stack delivers first. The receiver's
   * own log line says which refusal it was.
   */
  async function assertRefusedEarly(receiver: Receiver, result: number | string, status: number, before: number): Promise<void> {
    assert.ok([status, "ECONNRESET", "EPIPE"].includes(result), `got ${String(result)}`);
    const line = `refused a request (${status})`;
    const count = () => receiver.output().split(line).length - 1;
    for (let i = 0; i < 50 && count() <= before; i += 1) await new Promise((r) => setTimeout(r, 20));
    assert.equal(count(), before + 1, receiver.output());
  }

  const refusals = (receiver: Receiver, status: number) => receiver.output().split(`refused a request (${status})`).length - 1;

  const jsonHeaders = (signature?: string): Record<string, string> => ({
    "Content-Type": "application/json",
    "X-Webhook-Event": "messages.received",
    ...(signature ? { "X-Webhook-Signature": signature } : {}),
  });

  test("TypeScript: serve answers 200 to a signed delivery and 401 to a forged or one-byte-off one, and reads the reply", async () => {
    const receiver = await startReceiver();
    try {
      const body = [Buffer.from(delivery)];
      assert.equal(await post(receiver.port, jsonHeaders(header("not-the-secret")), body), 401);
      assert.equal(await post(receiver.port, jsonHeaders(lastByteOff(header(WEBHOOK_SECRET))), body), 401);
      assert.equal(await post(receiver.port, jsonHeaders(header(WEBHOOK_SECRET)), body), 200);
      for (let i = 0; i < 50 && !receiver.output().includes(REPLY_TEXT); i += 1) await new Promise((r) => setTimeout(r, 100));
      assert.ok(receiver.output().includes(REPLY_TEXT), receiver.output());
      assert.deepEqual(api.requests.map((r) => r.operationId), ["search_messages"]);
      assert.deepEqual(api.problems, []);
    } finally {
      receiver.child.kill();
    }
  });

  test("TypeScript: serve refuses a request with no signature header, or a stale one, before reading the body", async () => {
    const receiver = await startReceiver();
    try {
      // A body far over the cap: a refusal that came from reading it would be a 413.
      const big = [Buffer.alloc(RECEIVER_CAP), Buffer.alloc(RECEIVER_CAP)];
      await assertRefusedEarly(receiver, await post(receiver.port, jsonHeaders(), big), 401, 0);
      const t = Math.floor(Date.now() / 1000) - 3600;
      const stale = `t=${t},v1=${createHmac("sha256", WEBHOOK_SECRET).update(`${t}.${delivery}`).digest("hex")}`;
      await assertRefusedEarly(receiver, await post(receiver.port, jsonHeaders(stale), big), 401, 1);
      assert.equal(refusals(receiver, 413), 0, receiver.output());
      assert.deepEqual(api.requests, []);
    } finally {
      receiver.child.kill();
    }
  });

  test("TypeScript: serve answers 413 to a body over 1 MiB, declared or streamed, and calls nothing", async () => {
    const receiver = await startReceiver();
    try {
      const signature = header(WEBHOOK_SECRET);
      const declared = { ...jsonHeaders(signature), "Content-Length": String(RECEIVER_CAP + 1) };
      await assertRefusedEarly(receiver, await post(receiver.port, declared, [Buffer.alloc(RECEIVER_CAP + 1)]), 413, 0);
      // Refused on the declared length alone, before a byte of the body was counted.
      assert.match(receiver.output(), /Content-Length 1048577 is over 1048576 bytes/);
      // No Content-Length: the body streams in chunks and the receiver counts as it reads.
      const streamed = [Buffer.alloc(512 * 1024), Buffer.alloc(512 * 1024), Buffer.alloc(512 * 1024)];
      await assertRefusedEarly(receiver, await post(receiver.port, jsonHeaders(signature), streamed), 413, 1);
      assert.match(receiver.output(), /the body passed 1048576 bytes/);
      assert.deepEqual(api.requests, []);
      // The receiver is still up and takes the next good delivery.
      assert.equal(await post(receiver.port, jsonHeaders(header(WEBHOOK_SECRET)), [Buffer.from(delivery)]), 200);
    } finally {
      receiver.child.kill();
    }
  });

  test("TypeScript: serve will not start without GETSALES_WEBHOOK_SECRET", async () => {
    const outcome = await runExample("typescript", "10-subscribe-to-replies", ["serve", "0"]);
    assert.equal(outcome.code, 2);
    assert.match(outcome.stderr, /GETSALES_WEBHOOK_SECRET/);
    assert.doesNotMatch(outcome.stdout, /listening/);
  });
});
