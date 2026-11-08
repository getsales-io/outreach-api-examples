// 06: add a waterfall enrichment column that finds work emails, price it with
// estimate_credits, then run it with a budget.
//
// The column's steps run in order and stop at the first address found: the
// address the row already has (free as a step), then every email finder in
// the provider catalog. A verifier from the catalog checks each address before
// it wins, the row's own one too unless its email_status is already ok, and a
// rejected address sends the chain on to the next finder.
// Creating the column spends nothing. auto_run stays false, so the run below,
// capped by max_budget, is the only spending. If you switch auto_run on later,
// rows that land run outside any run's budget: daily_credit_limit on the
// column is the cap then.
// The estimate prices the run before it starts, over the same rows and the
// same cells, and answers min, expected and max in credits. Set max_budget
// from max, never from expected: expected is the likely cost, and a budget
// under max can stop the run before the last row (reason budget_exhausted).
// Run: node examples/typescript/06-waterfall-enrichment.ts pt_tb_XXXXXXXXXXXX        estimate only
//      node examples/typescript/06-waterfall-enrichment.ts pt_tb_XXXXXXXXXXXX 120    run it, max_budget 120 credits
import { setTimeout as sleep } from "node:timers/promises";
import { gs, run, usage, type ActionResult, type CreateResult, type GetResult } from "./client.ts";

interface CatalogEntry {
  operation: string;
  provider: string;
  name: string;
  platform_key: boolean;
  price_expected: number;
}

interface PlaytableField {
  sid: string;
  name: string;
  slug: string;
  type: string;
}

/** The answer of estimate_credits: the sums over the actions, then each action's own numbers. */
interface CreditsEstimate {
  min: number;
  expected: number;
  max: number;
  currency: "credits";
  basis: { rows: { form: "count" | "scope" | "table"; requested: number | null; matched: number | null } };
  actions: { type: string; min: number; expected: number; max: number; rows: number }[];
}

interface PlaytableRun {
  sid: string;
  max_budget: number | null;
}

interface Progress {
  state: "waiting" | "resolving" | "queued" | "running" | "finished" | "cancelled";
  total_jobs: number;
  processed_jobs: number;
  failed_jobs: number;
  spent_credits: number;
}

const [playtableSid, budgetArg] = process.argv.slice(2);
if (!playtableSid) usage("06-waterfall-enrichment.ts <playtable_sid> [max_budget_in_credits]");
const budget = budgetArg === undefined ? undefined : Number(budgetArg);
if (budget !== undefined && !(budget > 0)) usage("06-waterfall-enrichment.ts <playtable_sid> [max_budget_in_credits > 0]");

run(async () => {
  // 1. Email finders and verifiers from the provider catalog.
  const catalog = await gs.get<ActionResult<{ entries: CatalogEntry[] }>>("integrations", "/api/provider-catalog");
  const finders = catalog.result.entries.filter((e) => e.operation === "email.find" && e.platform_key);
  const verifier = catalog.result.entries
    .filter((e) => e.operation === "email.verify" && e.platform_key)
    .sort((a, b) => a.price_expected - b.price_expected)[0];
  if (finders.length === 0) throw new Error("the provider catalog lists no email finder right now");
  console.log(`finders: ${finders.map((f) => f.name).join(", ")}`);
  console.log(`verifier: ${verifier?.name ?? "none"}`);

  // 2. The table's people view is the run's scope: every person in the table.
  const table = await gs.get<GetResult<{ sid: string; people_default_view_sid: string }>>(
    "playtables",
    `/api/playtables/${playtableSid}`,
  );
  const scope = { view_sid: table.item.people_default_view_sid };

  // 3. The column. Idempotent on the slug: a second call returns the existing column.
  const field = await gs.post<CreateResult<PlaytableField>>("playtables", "/api/playtable-fields", {
    playtable_sid: playtableSid,
    object_type: "people",
    type: "action_waterfall",
    name: "Work email finder",
    slug: "work_email_finder",
    payload: {
      steps: [
        // The address the row already has, at no cost.
        { tool_sid: "row:people.work_email", params: {} },
        // Every finder gets the same inputs, filled per row from the table.
        // Each finder reads the inputs it serves.
        ...finders.map((f) => ({
          tool_sid: `in:${f.provider}.email.find`,
          params: { full_name: "{{people.full_name}}", company_name: "{{company.name}}", domain: "{{company.domain}}" },
        })),
      ],
      stop_on_first: true,
      // The winning address fills the person's work_email when it is empty.
      output_mapping: [{ path: "$.email", target: "people.work_email" }],
      verify: verifier ? { tool_sid: `in:${verifier.provider}.email.verify`, params: {} } : null,
      accept_catch_all: true,
    },
    config: {
      auto_run: false,
      run_condition: null,
      nl_condition: null,
      daily_credit_limit: null,
      preset_sid: null,
    },
    add_to_default_view: true,
  });
  if (field.item.type !== "action_waterfall") {
    throw new Error(`the slug work_email_finder already belongs to a ${field.item.type} column of this table`);
  }
  console.log(`column: ${field.item.sid} ${field.item.name}${field.already_exists ? " (already there)" : ""}`);

  // 4. The estimate: what the run would cost, over its rows and its cells.
  // rows is the run's scope below, and cells the run's params.cells: the
  // estimate prices the cells of the view that have not run yet.
  const estimate = await gs.post<ActionResult<CreditsEstimate>>("playtables", "/api/playtable-fields/estimate-credits", {
    rows: scope,
    actions: [{ type: "column", field_sid: field.item.sid, cells: "not_run" }],
  });
  const cost = estimate.result;
  console.log(
    `estimate: ${cost.actions[0]?.rows ?? 0} of ${cost.basis.rows.matched ?? "?"} rows to run, ` +
      `${cost.min} to ${cost.max} ${cost.currency}, ${cost.expected} expected`,
  );

  if (budget === undefined) {
    console.log("Nothing ran. To run it, pass a budget in credits, set from the estimate's max:");
    console.log(`  node examples/typescript/06-waterfall-enrichment.ts ${playtableSid} ${cost.max}`);
    return;
  }
  if (budget < cost.max) {
    console.log(`note: a budget under the estimate's max (${cost.max}) can stop the run before the last row (reason budget_exhausted)`);
  }

  // 5. The run, capped at the budget.
  const created = await gs.post<CreateResult<PlaytableRun>>("playtables", "/api/playtable-runs", {
    playtable_sid: playtableSid,
    object_type: "people",
    type: "enrich",
    field_sids: [field.item.sid],
    scope,
    params: { cells: "not_run" },
    max_budget: budget,
  });
  console.log(`run: ${created.item.sid}, max_budget ${created.item.max_budget}`);

  // 6. Progress, every 5 seconds until the run ends.
  for (;;) {
    const res = await gs.get<GetResult<PlaytableRun, { progress: Progress }>>(
      "playtables",
      `/api/playtable-runs/${created.item.sid}`,
      { "include[]": ["progress"] },
    );
    const p = res.included.progress;
    console.log(`${p.state}: ${p.processed_jobs}/${p.total_jobs} done, ${p.failed_jobs} failed, ${p.spent_credits} credits spent`);
    if (p.state === "finished" || p.state === "cancelled") break;
    await sleep(5000);
  }
});
