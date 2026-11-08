import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { API_HOST, GetSalesError, buildUrl, gs } from "../examples/typescript/client.ts";

const realFetch = globalThis.fetch;
let seen: { url: string; init: RequestInit }[] = [];

function answer(status: number, body: unknown, headers: Record<string, string> = {}): void {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), init: init ?? {} });
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return new Response(text, { status, headers: { "Content-Type": "application/json", ...headers } });
  }) as typeof fetch;
}

beforeEach(() => {
  seen = [];
  process.env.GETSALES_API_KEY = "gs_live_example_key_for_tests";
  delete process.env.GETSALES_API_HOST;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

test("the host is an https URL with no trailing slash", () => {
  assert.match(API_HOST, /^https:\/\/[a-z0-9.-]+$/);
});

test("a URL is the host, the service, v1 and the path", () => {
  assert.equal(buildUrl("playtables", "/api/people/search"), `${API_HOST}/playtables/v1/api/people/search`);
});

test("GETSALES_API_HOST replaces the host, and an array query repeats its name", () => {
  process.env.GETSALES_API_HOST = "http://127.0.0.1:9999/";
  const url = new URL(buildUrl("unibox", "/api/conversations/ub_cv_Bv9nK4xP1sD7", { "include[]": ["participants", "messages_tail"] }));
  assert.equal(url.origin, "http://127.0.0.1:9999");
  assert.equal(url.pathname, "/unibox/v1/api/conversations/ub_cv_Bv9nK4xP1sD7");
  assert.deepEqual(url.searchParams.getAll("include[]"), ["participants", "messages_tail"]);
});

test("a POST sends the key as a bearer token and the body as JSON", async () => {
  answer(200, { success: true, operation: "search", items: [], meta: { trace_id: "t-1" } });
  const res = await gs.post("playtables", "/api/playtables/search", { page_size: 0 });
  assert.equal(res.operation, "search");
  const [call] = seen;
  assert.ok(call);
  const headers = call.init.headers as Record<string, string>;
  assert.equal(call.init.method, "POST");
  assert.equal(headers.Authorization, "Bearer gs_live_example_key_for_tests");
  assert.equal(headers["Content-Type"], "application/json");
  assert.equal(call.init.body, JSON.stringify({ page_size: 0 }));
});

test("a GET sends no body and no content type", async () => {
  answer(200, { success: true, operation: "get", item: {}, included: {}, meta: { trace_id: "t-2" } });
  await gs.get("playtables", "/api/playtables/pt_tb_Tb6wN3kR8qM2");
  const [call] = seen;
  assert.ok(call);
  assert.equal(call.init.method, "GET");
  assert.equal(call.init.body, undefined);
  assert.equal((call.init.headers as Record<string, string>)["Content-Type"], undefined);
});

test("an error envelope becomes a GetSalesError with its code, status and trace id", async () => {
  answer(409, {
    success: false,
    error: { code: "duplicate_rejected", message: "target_url is already subscribed", recoverable: false, suggestion: "Delete the old webhook first." },
    meta: { trace_id: "019a4c2e-5b7d-7a10-8c3f-6e21d9b04a58" },
  });
  await assert.rejects(gs.post("integrations", "/api/webhooks", {}), (err: unknown) => {
    assert.ok(err instanceof GetSalesError);
    assert.equal(err.status, 409);
    assert.equal(err.code, "duplicate_rejected");
    assert.equal(err.traceId, "019a4c2e-5b7d-7a10-8c3f-6e21d9b04a58");
    assert.equal(err.body?.suggestion, "Delete the old webhook first.");
    assert.match(err.message, /duplicate_rejected \(HTTP 409\)/);
    return true;
  });
});

test("an answer that is not JSON still fails with the HTTP status and the trace header", async () => {
  answer(502, "<html>Bad gateway</html>", { "X-Trace-Id": "trace-from-header" });
  await assert.rejects(gs.post("unibox", "/api/tasks", {}), (err: unknown) => {
    assert.ok(err instanceof GetSalesError);
    assert.equal(err.code, "http_502");
    assert.equal(err.traceId, "trace-from-header");
    return true;
  });
});

test("a 200 without success true is not taken as a success", async () => {
  answer(200, { hello: "world" });
  await assert.rejects(gs.post("unibox", "/api/tasks", {}), GetSalesError);
});

test("a missing key stops before any request", async () => {
  delete process.env.GETSALES_API_KEY;
  answer(200, { success: true, operation: "search", items: [], meta: { trace_id: "t-3" } });
  await assert.rejects(gs.post("playtables", "/api/playtables/search", {}), /GETSALES_API_KEY/);
  assert.equal(seen.length, 0);
});
