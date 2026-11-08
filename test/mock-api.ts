// A local stand-in for the GetSales API, so the tests can run every example
// without the network. It answers the operations the examples call with fixed
// sample rows, records each request, and, when the OpenAPI documents are at
// hand, checks every request and every sample answer against them.
import { existsSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkBody,
  checkPathValues,
  checkQuery,
  checkResponse,
  findOperation,
  loadContract,
} from "../scripts/lib/openapi.mjs";

export const TEST_KEY = "gs_live_example_key_for_tests";
export const WEBHOOK_SECRET = "5f0c9e2a7b41d8366e1fa0b2c4d97e83";

export const SIDS = {
  team: "ts_tm_Q4rT8vW2xY6z",
  table: "pt_tb_Tb6wN3kR8qM2",
  peopleView: "pt_vw_Pv3nR8kQ1sT6",
  companiesView: "pt_vw_Cv9mL2xR7dK4",
  person: "cr_pp_Jc4nR7tY2wQ9",
  newPerson: "cr_pp_Np8kT2wQ6mR3",
  company: "cr_co_Ea5kT9mW3qL1",
  field: "pt_fd_Wf2kR8nT4xL7",
  run: "pt_rn_Rn6tY3kP9wQ2",
  workflow: "wf_wf_Jk2mP9nR4qW1",
  version: "wf_vr_Vr8nK2tP5xQ3",
  source: "wf_sr_Sr4mT8kQ2nW6",
  senderProfile: "ub_sp_Sp5kQ9mT3nW7",
  secondSenderProfile: "ub_sp_Sp2nW6kR9tQ4",
  mailbox: "em_ac_Mb2nR6tK8wQ4",
  webhook: "wh_hk_Wh3kT7nQ1mR5",
  conversation: "ub_cv_Bv9nK4xP1sD7",
  message: "ub_ms_Ms4kR8nT2wQ6",
  olderMessage: "ub_ms_Ms9tQ3kW7nR1",
  counterpart: "ub_pt_Pt6nQ2kT8wR4",
  sender: "ub_pt_Pt3wK9nR5tQ7",
  task: "ub_tk_Tk9mR3nW5qT1",
  member: "ts_mb_Mm4kT8nQ2wR6",
  user: "us_mb_Us7nK3tQ9wM2",
} as const;

export const TEAMMATE_EMAIL = "sam.lee@example.com";
export const REPLY_TEXT = "Thanks, a short call next week works. Tuesday?";

export interface RecordedRequest {
  method: string;
  service: string;
  path: string;
  query: Record<string, string[]>;
  body: unknown;
  operationId: string | undefined;
}

export interface MockApi {
  url: string;
  /** Every request since the last reset. */
  requests: RecordedRequest[];
  /** Everything the mock found wrong since the last reset: unrouted calls, contract mismatches. */
  problems: string[];
  /** Where the OpenAPI documents came from, or null when they were not found. */
  contractSource: string | null;
  reset(): void;
  close(): Promise<void>;
}

type Body = Record<string, any>;
interface Context {
  body: Body;
  query: Record<string, string[]>;
  params: Record<string, string>;
}
interface Route {
  method: string;
  service: string;
  path: string;
  operationId: string;
  answer(ctx: Context): Body;
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const META = {
  trace_id: "019a4c2e-5b7d-7a10-8c3f-6e21d9b04a58",
  span_id: "8c3f6e21d9b04a58",
  timestamp: "2026-11-03T09:00:00Z",
  duration_ms: 12,
  team_sid: SIDS.team,
  actor_type: "api_key",
};

const PAGE_END = { next_cursor: null, has_more: false, total_count: null };

const search = (items: Body[], extra: Body = {}): Body => ({
  success: true,
  operation: "search",
  items,
  pagination: { ...PAGE_END, total_count: items.length },
  applied_filters: {},
  includes: [],
  meta: META,
  ...extra,
});
const get = (item: Body, included: Body = {}): Body => ({ success: true, operation: "get", item, included, includes: Object.keys(included), meta: META });
const create = (item: Body): Body => ({ success: true, operation: "create", item, already_exists: false, meta: META });
const action = (name: string, result: Body, item: Body | null = null): Body => ({ success: true, operation: "action", action: name, item, result, meta: META });

const message = (sid: string, direction: "inbound" | "outbound", text: string, createdAt: string): Body => ({
  sid,
  team_sid: SIDS.team,
  conversation_sid: SIDS.conversation,
  channel: "email",
  kind: "email",
  direction,
  state: direction === "inbound" ? "delivered" : "sent",
  origin: "native",
  author: direction === "inbound" ? "contact" : "agent",
  subject: direction === "inbound" ? null : "A question about your Q4 campaigns",
  body_text: text,
  created_at: createdAt,
});

const ROUTES: Route[] = [
  {
    method: "POST", service: "playtables", path: "/api/playtables/search", operationId: "search_playtables",
    answer: () => search([], { pagination: { ...PAGE_END, total_count: 3 }, counts: { total_count: 3, groups: [] } }),
  },
  {
    method: "POST", service: "playtables", path: "/api/playtables", operationId: "create_playtable",
    answer: ({ body }) => create({
      sid: SIDS.table,
      team_sid: SIDS.team,
      name: body.name,
      description: body.description ?? null,
      people_default_view_sid: SIDS.peopleView,
      company_default_view_sid: SIDS.companiesView,
      config: { auto_run: body.config?.auto_run ?? false },
    }),
  },
  {
    method: "GET", service: "playtables", path: "/api/playtables/{sid}", operationId: "get_playtable",
    answer: ({ params }) => get({
      sid: params.sid,
      team_sid: SIDS.team,
      name: "Agencies for the Q4 campaign",
      people_default_view_sid: SIDS.peopleView,
      company_default_view_sid: SIDS.companiesView,
      config: { auto_run: false },
    }),
  },
  {
    method: "POST", service: "playtables", path: "/api/people", operationId: "create_person",
    answer: ({ body }) => create({
      sid: SIDS.person,
      team_sid: SIDS.team,
      playtable_sid: body.playtable_sid,
      status: body.work_email || body.ln_nickname ? "ok" : "no_contact_data",
      work_email: body.work_email ?? null,
      context: { name: body.full_name ?? null },
    }),
  },
  {
    method: "POST", service: "playtables", path: "/api/people/search", operationId: "search_people",
    answer: () => search([
      {
        item: {
          sid: SIDS.person,
          team_sid: SIDS.team,
          playtable_sid: SIDS.table,
          status: "ok",
          work_email: "jane.cooper@example.com",
          context: {
            name: "Jane Cooper",
            role: "Head of Growth",
            company: { sid: SIDS.company, name: "Example Agency", domain: "example.com", picture_url: null, ln_id: null },
          },
        },
        included: {},
      },
    ]),
  },
  {
    method: "POST", service: "playtables", path: "/api/companies/search", operationId: "search_companies",
    answer: () => search([
      {
        item: {
          sid: SIDS.company,
          team_sid: SIDS.team,
          domain: "example.com",
          playtable_sids: [SIDS.table],
          context: { name: "Example Agency", website: "https://example.com" },
        },
        included: { people_counts: { total_count: 2 } },
      },
    ]),
  },
  {
    method: "GET", service: "integrations", path: "/api/provider-catalog", operationId: "list_provider_catalog",
    answer: () => action("provider-catalog", {
      entries: [
        { operation: "email.find", provider: "hunter", model: null, name: "Find email: Hunter", platform_key: true, price_expected: 1 },
        { operation: "email.find", provider: "findymail", model: null, name: "Find email: Findymail", platform_key: true, price_expected: 1 },
        { operation: "email.find", provider: "anymailfinder", model: null, name: "Find email: Anymailfinder", platform_key: false, price_expected: 1 },
        { operation: "email.verify", provider: "emaillistverify", model: null, name: "Verify email: EmailListVerify", platform_key: true, price_expected: 0.1 },
        { operation: "llm.generate", provider: "anthropic", model: "claude-sonnet-4-5", name: "Generate: Claude Sonnet", platform_key: true, price_expected: 0.4 },
      ],
    }),
  },
  {
    method: "POST", service: "playtables", path: "/api/playtable-fields", operationId: "create_playtable_field",
    answer: ({ body }) => create({
      sid: SIDS.field,
      team_sid: SIDS.team,
      playtable_sid: body.playtable_sid,
      object_type: body.object_type,
      name: body.name,
      slug: body.slug,
      category: "action",
      type: body.type,
    }),
  },
  {
    // One column action over a view of 40 people, 38 of them not run yet. The
    // totals are the sums over the actions, so here they are the action's own.
    method: "POST", service: "playtables", path: "/api/playtable-fields/estimate-credits", operationId: "estimate_credits",
    answer: ({ body }) => action("estimate_credits", {
      min: 0,
      expected: 18.4,
      max: 45.6,
      currency: "credits",
      priced_at: "2026-11-03T09:00:00Z",
      basis: { rows: { form: "scope", requested: null, matched: 40 }, rows_sampled: 0, sampled: false },
      actions: [
        {
          type: "column",
          min: 0,
          expected: 18.4,
          max: 45.6,
          rows: 38,
          per_row: { min: 0, expected: 0.4842, max: 1.2 },
          detail: {
            field_sid: body.actions?.[0]?.field_sid ?? SIDS.field,
            rows_matched: 40,
            rows_to_run: 38,
            steps: [
              { tool_sid: "in:hunter.email.find", price_min: 0, price_max: 1 },
              { tool_sid: "in:findymail.email.find", price_min: 0, price_max: 1 },
            ],
          },
        },
      ],
    }),
  },
  {
    method: "POST", service: "playtables", path: "/api/playtable-runs", operationId: "create_playtable_run",
    answer: ({ body }) => create({
      sid: SIDS.run,
      team_sid: SIDS.team,
      playtable_sid: body.playtable_sid,
      object_type: body.object_type,
      type: body.type,
      field_sids: body.field_sids,
      max_budget: body.max_budget ?? null,
      finished_at: null,
    }),
  },
  {
    method: "GET", service: "playtables", path: "/api/playtable-runs/{sid}", operationId: "get_playtable_run",
    answer: ({ params }) => get(
      { sid: params.sid, team_sid: SIDS.team, max_budget: 50 },
      {
        progress: {
          state: "finished",
          total_jobs: 38,
          pending_jobs: 0,
          processed_jobs: 38,
          failed_jobs: 0,
          cancelled_at: null,
          spent_credits: 21,
        },
      },
    ),
  },
  {
    method: "POST", service: "playtables", path: "/api/workflows/search", operationId: "search_workflows",
    answer: () => search([
      {
        item: {
          sid: SIDS.workflow,
          team_sid: SIDS.team,
          name: "Agencies, Q4",
          status: "active",
          published_version_sid: SIDS.version,
          sender_profile_sids: [SIDS.senderProfile],
          updated_at: "2026-11-02T16:20:00Z",
        },
        included: { records_counts: { total_count: 120 } },
      },
    ]),
  },
  {
    // The workflow holds SIDS.person already, whose journey has ended, and had
    // no manual source until this call. With no restart in the body, that
    // person stays as they are and every other sid enters.
    method: "POST", service: "playtables", path: "/api/workflows/{sid}/add-people", operationId: "add_workflow_people",
    answer: ({ body, params }) => {
      const asked: string[] = body.people_sids ?? [];
      const held = asked.filter((sid) => sid === SIDS.person).length;
      return action(
        "add-people",
        {
          source_created: true,
          entered_count: asked.length - held,
          re_entered_count: 0,
          skipped_enrolled_count: held,
          skipped_in_flight_count: 0,
          blocked_stoplisted_count: 0,
          blocked_limit_count: 0,
          blocked_other_count: 0,
        },
        { sid: SIDS.source, team_sid: SIDS.team, workflow_sid: params.sid, view_sid: null, name: "Hand-picked", type: "manual", auto_add: false },
      );
    },
  },
  {
    method: "POST", service: "unibox", path: "/api/sender-profiles/search", operationId: "search_sender_profiles",
    answer: () => search([
      {
        item: {
          sid: SIDS.senderProfile,
          team_sid: SIDS.team,
          name: "Jane Cooper",
          label: "Outbound EU",
          linkedin_status: "active",
          mailboxes: [{ email_account_sid: SIDS.mailbox, address: "jane@example.com", status: "active", is_primary: true }],
        },
        included: {},
      },
      {
        item: { sid: SIDS.secondSenderProfile, team_sid: SIDS.team, name: "Sam Lee", label: null, linkedin_status: null, mailboxes: null },
        included: {},
      },
    ]),
  },
  {
    method: "POST", service: "integrations", path: "/api/webhooks", operationId: "create_webhook",
    answer: ({ body }) => create({
      sid: SIDS.webhook,
      team_sid: SIDS.team,
      name: body.name,
      target_url: body.target_url,
      events: body.events,
      filters: body.filters ?? null,
      secret: WEBHOOK_SECRET,
      status: "on",
      consecutive_failed_attempts: 0,
      last_failure_at: null,
    }),
  },
  {
    method: "POST", service: "integrations", path: "/api/webhooks/{sid}/test", operationId: "test_webhook",
    answer: ({ params }) => action(
      "test",
      { http_status: 200, response_body: null, duration_ms: 84, error_kind: "none", error_message: null },
      { sid: params.sid, team_sid: SIDS.team, status: "on" },
    ),
  },
  {
    method: "POST", service: "unibox", path: "/api/messages/search", operationId: "search_messages",
    answer: ({ body }) => {
      if (body.filter?.sid?.eq) {
        return search(body.filter.sid.eq === SIDS.message
          ? [{ item: message(SIDS.message, "inbound", REPLY_TEXT, "2026-11-03T08:12:44Z"), included: {} }]
          : []);
      }
      return search([
        { item: message(SIDS.message, "inbound", REPLY_TEXT, "2026-11-03T08:12:44Z"), included: {} },
        { item: message(SIDS.olderMessage, "outbound", "Hi Jane, a quick question about your Q4 campaigns.", "2026-11-01T10:00:00Z"), included: {} },
      ]);
    },
  },
  {
    method: "GET", service: "unibox", path: "/api/conversations/{sid}", operationId: "get_conversation",
    answer: ({ params }) => get(
      {
        sid: params.sid,
        team_sid: SIDS.team,
        channels: ["email"],
        state: "needs_you",
        sender_profile_sid: SIDS.senderProfile,
        primary_person_sid: SIDS.person,
        scenario_key: "meeting_request",
        needs_reply: true,
        last_message_at: "2026-11-03T08:12:44Z",
      },
      {
        participants: [
          { sid: SIDS.counterpart, conversation_sid: params.sid, role: "counterpart", is_primary: true, display_name: "Jane Cooper" },
          { sid: SIDS.sender, conversation_sid: params.sid, role: "sender", is_primary: false, display_name: "Sam Lee" },
        ],
      },
    ),
  },
  {
    method: "POST", service: "id", path: "/api/team-members/search", operationId: "search_team_members",
    answer: ({ body }) => search(body.filter?.email?.eq === TEAMMATE_EMAIL
      ? [{ item: { sid: SIDS.member, team_sid: SIDS.team, user_sid: SIDS.user, email: TEAMMATE_EMAIL, status: "active" }, included: {} }]
      : []),
  },
  {
    method: "POST", service: "unibox", path: "/api/tasks", operationId: "create_task",
    answer: ({ body }) => create({
      sid: SIDS.task,
      team_sid: SIDS.team,
      title: body.title,
      state: "open",
      conversation_sid: body.conversation_sid ?? null,
      person_sid: SIDS.person,
      body: body.body ?? null,
      assignee_user_sid: body.assignee_user_sid ?? null,
      expires_at: "2026-12-03T09:00:00Z",
    }),
  },
];

function routeFor(method: string, service: string, path: string): { route: Route; params: Record<string, string> } | null {
  const segments = path.split("/").filter(Boolean);
  for (const route of ROUTES) {
    if (route.method !== method || route.service !== service) continue;
    const want = route.path.split("/").filter(Boolean);
    if (want.length !== segments.length) continue;
    const params: Record<string, string> = {};
    const fits = want.every((segment, i) => {
      const got = segments[i] ?? "";
      if (/^\{.+\}$/.test(segment)) {
        params[segment.slice(1, -1)] = decodeURIComponent(got);
        return true;
      }
      return segment === got;
    });
    if (fits) return { route, params };
  }
  return null;
}

function openApiDir(): string | null {
  const fromEnv = process.env.GETSALES_OPENAPI_DIR;
  if (fromEnv) return resolve(fromEnv);
  const nextDoor = resolve(ROOT, "..", "..", "openapi", "gs.openapi.public");
  return existsSync(nextDoor) ? nextDoor : null;
}

function reply(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json", "X-Trace-Id": META.trace_id });
  res.end(JSON.stringify(body));
}

export async function startMockApi(): Promise<MockApi> {
  const dir = openApiDir();
  const contract: Map<string, any> | null = dir ? loadContract(dir) : null;
  const requests: RecordedRequest[] = [];
  const problems: string[] = [];

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://mock.local");
      const method = req.method ?? "GET";
      const query: Record<string, string[]> = {};
      for (const [name, value] of url.searchParams) (query[name] ??= []).push(value);
      const match = /^\/([a-z]+)\/v1(\/.*)$/.exec(url.pathname);
      const service = match?.[1] ?? "";
      const path = match?.[2] ?? url.pathname;
      const raw = Buffer.concat(chunks).toString("utf8");
      let body: unknown;
      try {
        body = raw === "" ? undefined : JSON.parse(raw);
      } catch {
        problems.push(`${method} ${url.pathname}: the body is not JSON`);
      }
      const recorded: RecordedRequest = { method, service, path, query, body, operationId: undefined };
      requests.push(recorded);

      if (req.headers.authorization !== `Bearer ${TEST_KEY}`) {
        problems.push(`${method} ${url.pathname}: no or wrong bearer key`);
        reply(res, 401, { success: false, error: { code: "unauthorized", message: "missing or invalid token", recoverable: false }, meta: META });
        return;
      }
      const found = routeFor(method, service, path);
      if (!found) {
        problems.push(`${method} /${service}/v1${path}: the mock has no answer for this call`);
        reply(res, 404, { success: false, error: { code: "not_found", message: "no such route in the mock", recoverable: false }, meta: META });
        return;
      }
      recorded.operationId = found.route.operationId;
      const answer = found.route.answer({ body: (body ?? {}) as Body, query, params: found.params });

      const entry = contract?.get(service);
      if (contract && !entry) problems.push(`${service}: no OpenAPI document`);
      if (entry) {
        const where = `${method} /${service}/v1${path}`;
        const operation = findOperation(entry, method, path);
        if (!operation) {
          problems.push(`${where}: not a documented operation`);
        } else {
          if (operation.op.operationId !== found.route.operationId) {
            problems.push(`${where}: documented as ${operation.op.operationId}, the mock calls it ${found.route.operationId}`);
          }
          const checks = [
            ...checkPathValues(entry, operation, path),
            ...checkQuery(entry, operation, query, "request"),
            ...checkBody(entry, operation, method === "GET" ? undefined : body, "request"),
            ...checkResponse(entry, operation, 200, answer),
          ];
          for (const problem of checks) problems.push(`${where}: ${problem}`);
        }
      }
      reply(res, 200, answer);
    });
  });

  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    problems,
    contractSource: dir,
    reset() {
      requests.length = 0;
      problems.length = 0;
    },
    close: () => new Promise<void>((done, fail) => server.close((err) => (err ? fail(err) : done()))),
  };
}
