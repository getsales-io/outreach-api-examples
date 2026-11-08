# GetSales: Outreach API Examples

This repository holds twelve working tasks for the GetSales API, each written once as a bash script built on curl and once as a TypeScript file that makes the same calls. GetSales is LinkedIn and email outreach for agencies and GTM teams, in one app. Describe who you sell to, and GetSales finds the people and their work emails, scores them and writes the first lines, and every reply comes back to a team inbox.

The tasks follow one list from the first row to the first reply. They create a table and fill it with people and companies, add a [waterfall enrichment](https://getsales.io/waterfall-enrichment/) column that finds work emails within a credit budget, put people into a [multichannel sequence](https://getsales.io/multichannel-sequences/), subscribe to replies with a signed webhook, read a thread from the [unified inbox](https://getsales.io/unified-inbox/) and hand it to a teammate as a task. None of them sends a message on any channel.

## Which tasks are here?

| Task | curl | TypeScript | Operations |
|---|---|---|---|
| 01 Prove that a key works and see the workspace it acts in | [01-check-key.sh](examples/curl/01-check-key.sh) | [01-check-key.ts](examples/typescript/01-check-key.ts) | `search_playtables` |
| 02 Create a table for a list of people and companies | [02-create-table.sh](examples/curl/02-create-table.sh) | [02-create-table.ts](examples/typescript/02-create-table.ts) | `create_playtable` |
| 03 Add a person to a table, and get their row back when the workspace already has them | [03-add-person-to-table.sh](examples/curl/03-add-person-to-table.sh) | [03-add-person-to-table.ts](examples/typescript/03-add-person-to-table.ts) | `create_person` |
| 04 Find a person by work email or by name | [04-find-person.sh](examples/curl/04-find-person.sh) | [04-find-person.ts](examples/typescript/04-find-person.ts) | `search_people` |
| 05 Search companies by domain or by name | [05-search-companies.sh](examples/curl/05-search-companies.sh) | [05-search-companies.ts](examples/typescript/05-search-companies.ts) | `search_companies` |
| 06 Add a column that finds work emails, price it, then run it under a budget | [06-waterfall-enrichment.sh](examples/curl/06-waterfall-enrichment.sh) | [06-waterfall-enrichment.ts](examples/typescript/06-waterfall-enrichment.ts) | `list_provider_catalog`, `get_playtable`, `create_playtable_field`, `estimate_credits`, `create_playtable_run`, `get_playtable_run` |
| 07 List workflows with their status and how many people each holds | [07-list-workflows.sh](examples/curl/07-list-workflows.sh) | [07-list-workflows.ts](examples/typescript/07-list-workflows.ts) | `search_workflows` |
| 08 Add people to a workflow and leave anyone it already holds as they are | [08-add-people-to-workflow.sh](examples/curl/08-add-people-to-workflow.sh) | [08-add-people-to-workflow.ts](examples/typescript/08-add-people-to-workflow.ts) | `add_workflow_people` |
| 09 List sender profiles and the channels each one holds | [09-list-sender-profiles.sh](examples/curl/09-list-sender-profiles.sh) | [09-list-sender-profiles.ts](examples/typescript/09-list-sender-profiles.ts) | `search_sender_profiles` |
| 10 Subscribe to replies and check the signature of each delivery | [10-subscribe-to-replies.sh](examples/curl/10-subscribe-to-replies.sh) | [10-subscribe-to-replies.ts](examples/typescript/10-subscribe-to-replies.ts) | `create_webhook`, `test_webhook`, `search_messages` |
| 11 Read a thread from the inbox, oldest message first | [11-read-conversation.sh](examples/curl/11-read-conversation.sh) | [11-read-conversation.ts](examples/typescript/11-read-conversation.ts) | `get_conversation`, `search_messages` |
| 12 Hand a thread to a teammate with a task | [12-create-handoff-task.sh](examples/curl/12-create-handoff-task.sh) | [12-create-handoff-task.ts](examples/typescript/12-create-handoff-task.ts) | `search_team_members`, `create_task` |

An operation is named by its operationId, the name the [API docs](https://docs.getsales.io) and the MCP tools use for it. A script that needs arguments prints a usage line when you start it without them. Most take sids that an earlier task produced: the table from 02, people from 03 or 04, a workflow from 07, and a conversation from the `conversation_sid` in the payload of a reply delivery in 10.

Task 09 reads the workspace's sender profiles. A sender profile is the identity your team sends as, with its LinkedIn account and its mailboxes. A workflow names the sender profiles it uses by their `ub_sp_` sids.

## How do I run them?

You need a GetSales workspace, from [getsales.io](https://getsales.io/) if you have none yet, and a key made in it: open Settings, then API keys. A new key's secret begins with `gs_live_` and the app shows it once, when the key is made, so save it then. Both halves of the repo read it from the environment:

```bash
export GETSALES_API_KEY="gs_live_YOUR_KEY"
```

Every request carries it as `Authorization: Bearer <key>`. A key works inside the workspace that made it, with the permissions chosen for it. More on keys: [authentication](https://docs.getsales.io/authentication).

One host serves five services, and the first segment of the path picks the service: `/playtables/v1` for tables, people, companies, enrichment and workflows, `/unibox/v1` for sender profiles, the inbox and tasks, `/integrations/v1` for webhooks and the provider catalog, `/id/v1` for workspace members and `/signals/v1` for buying signals. The host is written in one place, `API_HOST` in [examples/typescript/client.ts](examples/typescript/client.ts), and the curl scripts read that line.

The scripts need bash and curl. Tasks 06, 08, 10 and 12 also use [jq](https://jqlang.org), and the verify mode of 10 uses openssl. The TypeScript files import nothing outside Node: Node 22.18 or later [runs them as they are](https://nodejs.org/api/typescript.html), and on Node 18 or 20 [tsx](https://tsx.is) runs them.

```bash
./examples/curl/04-find-person.sh jane.cooper@example.com
node examples/typescript/04-find-person.ts jane.cooper@example.com
npx tsx examples/typescript/04-find-person.ts "Jane Cooper"
```

## What do a call and its answer look like?

Task 01 posts a table search with `page_size` 0. That returns counts and no rows, so it is the cheapest call that proves a key:

```bash
curl -sS -X POST "$GETSALES_API/playtables/v1/api/playtables/search" \
  -H "Authorization: Bearer $GETSALES_API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary '{ "page_size": 0 }'
```

`$GETSALES_API` is the host from `client.ts`. In the answer, `meta.team_sid` is the workspace and `meta.actor_type` says that a key made the call:

```json
{
  "success": true,
  "operation": "search",
  "items": [],
  "counts": { "total_count": 3, "groups": [] },
  "pagination": { "next_cursor": null, "has_more": false, "total_count": 3 },
  "applied_filters": {},
  "includes": [],
  "meta": {
    "trace_id": "019a4c2e-5b7d-7a10-8c3f-6e21d9b04a58",
    "team_sid": "ts_tm_Q4rT8vW2xY6z",
    "actor_type": "api_key"
  }
}
```

A successful answer always has `success: true`, an `operation` that names its shape (`search`, `get`, `create`, `update`, `delete`, `metrics` or `action`) and a `meta` block. Quote its `trace_id` when you write to support. A search puts each row in `items[]` as an `item` plus the relations you asked for under `included`, then gives `counts` over everything the filter matched, and `pagination`.

A refused call answers `success: false` and an `error` object whose `code` is one of 16 values. These are two refusals you can meet in these examples, written as the API sends them, with `meta` cut down to its trace id.

A key that lacks a permission the call needs gets HTTP 403. `error.context.reason` is `scope_missing`, and `error.context.required_permission` names the permission:

```json
{
  "success": false,
  "error": {
    "code": "forbidden",
    "message": "You do not have permission for this. Ask a workspace admin to grant it.",
    "recoverable": false,
    "context": { "reason": "scope_missing", "required_permission": "can_manage_playtables" }
  },
  "meta": { "trace_id": "019a4c2e-5b7d-7a10-8c3f-6e21d9b04a58" }
}
```

The current-user call, `GET /id/v1/api/users/current`, looks the caller up as a person. A key's actor is the key itself, an `id_ak_` sid, so with a key that call gets HTTP 422, and this is why task 01 proves a key with a table search:

```json
{
  "success": false,
  "error": {
    "code": "validation_failed",
    "message": "Expected us_mb_ prefix, got id_ak_Kq4nR8tW2mX6",
    "recoverable": true,
    "field_errors": {
      "sid": [{ "rule": "invalid_id_type", "message": "Expected us_mb_ prefix, got id_ak_Kq4nR8tW2mX6" }]
    }
  },
  "meta": { "trace_id": "019a4c2e-5b7d-7a10-8c3f-6e21d9b04a58" }
}
```

The TypeScript client raises every refusal as a `GetSalesError` that carries `code`, `status`, `traceId` and the whole `error` object as `body`.

Sids carry a prefix that names the kind of object: `pt_tb_` a table, `cr_pp_` a person, `cr_co_` a company, `pt_fd_` a column, `wf_wf_` a workflow, `ub_sp_` a sender profile, `ub_cv_` a conversation and `wh_hk_` a webhook.

## Which permissions does each task need?

A key holds the permissions picked when it was made, and a call outside them gets the 403 above.

| Task | Permissions |
|---|---|
| 01 | `can_view_playtables` |
| 02 | `can_manage_playtables` |
| 03 | `can_act_people` |
| 04, 05 | `can_view_people` |
| 06 | `can_view_integrations`, `can_view_playtables` and `can_manage_playtables`, plus `can_act_playtables` to start the run |
| 07 | `can_view_workflows` |
| 08 | `can_act_workflows` |
| 09 | `can_view_sender_profiles` |
| 10 | `can_manage_webhooks`, plus `can_view_conversations` to read a reply |
| 11 | `can_view_conversations` |
| 12 | `can_act_conversations`, plus `can_view_team_members` when you pass a teammate's email |

## What should I know before building on it?

- Search calls take `filter` (`{ field: { eq | ne | in | nin | gte | lte | gt | lt | is_null } }`, with `q` for free text), `sort`, `page_size` (0 to 500, 50 by default, and 0 for counts alone) and `cursor`. The cursor comes from `pagination.next_cursor`, is opaque and only moves forward. A GET repeats an array parameter, as in `?include[]=progress`.
- A person is one row across the whole workspace. People are matched by email and by the LinkedIn identifiers `ln_member_id`, `ln_id`, `sn_id` and `ln_nickname`, the LinkedIn public ID. The API keeps those identifiers and never a profile URL. With `on_duplicate: "skip"`, adding someone the workspace already has returns their existing row with `already_exists: true`, and a person stays in one table at a time.
- People search matches a work email as a lowercased term, so task 04 lowercases and trims an address before it filters on it, and task 12 does the same with a teammate's email.
- Only task 06 spends credits, and only when you give it a budget. It creates the column with `config.auto_run: false`, prices the run with `estimate_credits` over the same rows and cells, then starts it with `max_budget`, and the run stops by itself with reason `budget_exhausted` when it reaches that sum. The estimate answers `min`, `expected` and `max` in credits. Set `max_budget` from `max`, never from `expected`: a budget under `max` can stop the run before the last row. A column with `auto_run` on runs each row as it lands, outside any run's budget, and its `daily_credit_limit` caps what it spends in a day. The provider catalog lists every [email finder](https://getsales.io/email-finder/) step with its price.
- People enter a workflow through `add_workflow_people`, which adds them through the workflow's manual source and makes that source when there is none. A person the workflow already holds stays as they are, even when their journey has ended, so running task 08 again, or retrying after a lost answer, starts nobody over. To run such people again on purpose, the call takes `restart`: `from_start` runs them from the first step, `from_current` from the step they are on.
- A webhook delivery carries references to objects. The `payload` of a `messages.received` delivery holds the message's `sid`, `team_sid`, `conversation_sid`, `channel`, `kind`, `provider_message_sid` and `created_at`, and no text, so task 10 reads the text with `search_messages` by that sid. The delivery that `test_webhook` sends has `{ "test": true }` as its payload. A URL holds one subscription per workspace, and its secret appears once, in the answer to `create_webhook`. GetSales attempts a delivery up to 5 times, and a subscription turns `failed` after 20 failed attempts in a row or a single 410. More in [receive webhooks](https://docs.getsales.io/guides/receive-webhooks).
- The receiver in task 10 reads its secret from `GETSALES_WEBHOOK_SECRET`, refuses a request with no fresh signature header before reading the body, and stops reading at 1 MiB. A delivery is never larger than 64 KiB.

## Can an AI agent make the same calls?

Yes. Each operation in the table is also a typed tool of the GetSales Outreach MCP Server, under the same operationId (`search_people`, `create_playtable_field`, `add_workflow_people` and the rest). The agent signs in through OAuth, or with the same `gs_live_` key as a bearer token. Any MCP client can connect, Claude and Cursor among them, and the steps for each are on [docs.getsales.io](https://docs.getsales.io).

## How are the examples checked?

```bash
npm install
npm run typecheck     # tsc --noEmit over the TypeScript examples and the tests
npm run check-paths   # every call, curl and TypeScript, against the OpenAPI documents
npm test              # every example against a local mock of the API, offline
```

`check-paths` reads the method, path, body fields and query parameters of each call out of the scripts and compares them with the OpenAPI documents, taken from `--openapi <dir>` or `GETSALES_OPENAPI_DIR`, or downloaded from the docs site with `--from-docs`. It also fails when the curl and TypeScript versions of a task call different operations, and when the host appears anywhere outside `client.ts`. `npm test` needs Node 22.18 or later, plus curl, jq and openssl for the curl half.

## License

MIT, see [LICENSE](LICENSE).

GetSales is an independent product and is not affiliated with, endorsed by, or sponsored by LinkedIn Corporation. LinkedIn and the LinkedIn logo are trademarks of LinkedIn Corporation. Use of GetSales is at your own risk and subject to the applicable third-party platform terms.
