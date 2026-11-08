// 02: create a table, the workspace's container for a list of people and
// companies. The table comes with a default view per tab.
//
// Creating is idempotent on the name: a second call with the same name returns
// the existing table with already_exists true. config.auto_run false keeps paid
// columns from running on rows as they land. You start runs yourself (see 06).
// Run: node examples/typescript/02-create-table.ts ["Table name"] ["Description"]
import { gs, run, type CreateResult } from "./client.ts";

interface Playtable {
  sid: string;
  name: string;
  people_default_view_sid: string;
  company_default_view_sid: string;
  config: { auto_run: boolean };
}

const [name = "Agencies for the Q4 campaign", description = "Created from the outreach API examples"] = process.argv.slice(2);

run(async () => {
  const res = await gs.post<CreateResult<Playtable>>("playtables", "/api/playtables", {
    name,
    description,
    config: { auto_run: false },
  });

  const table = res.item;
  console.log(res.already_exists ? "A table with this name already exists:" : "Created:");
  console.log(`table:              ${table.sid}  ${table.name}`);
  console.log(`people view:        ${table.people_default_view_sid}`);
  console.log(`companies view:     ${table.company_default_view_sid}`);
  console.log(`auto_run:           ${table.config.auto_run}`);
});
