// 03: add a person to a table, and get the existing row back instead of a 409
// when the workspace already has them.
//
// Duplicates are found across the whole workspace by the emails and the
// LinkedIn identifiers: ln_member_id, ln_id, sn_id, and ln_nickname, the
// LinkedIn public ID. With on_duplicate "skip" the existing row comes back with
// already_exists true, wherever it lives ("move" would re-home it into this
// table instead). Without on_duplicate, an email or LinkedIn id match answers
// 409 duplicate_rejected, and a match on the public ID alone adds the row
// flagged as a duplicate.
// Pass - for a value you do not have.
// Run: node examples/typescript/03-add-person-to-table.ts pt_tb_XXXXXXXXXXXX jane.cooper@example.com ["Jane Cooper"] [ln_nickname]
import { gs, run, usage, type CreateResult } from "./client.ts";

interface Person {
  sid: string;
  playtable_sid: string;
  status: "ok" | "failed_validation" | "no_contact_data" | "duplicate" | "stoplisted";
  work_email: string | null;
  context: { name: string | null } | null;
}

const [playtableSid, ...rest] = process.argv.slice(2);
if (!playtableSid || rest.length === 0) {
  usage("03-add-person-to-table.ts <playtable_sid> <work_email or -> [full_name] [ln_nickname]");
}
// "-" or a missing value is sent as null.
const [workEmail, fullName, lnNickname] = [rest[0], rest[1], rest[2]].map((v) => (v && v !== "-" ? v : null));

run(async () => {
  const res = await gs.post<CreateResult<Person>>("playtables", "/api/people", {
    playtable_sid: playtableSid,
    work_email: workEmail,
    full_name: fullName,
    ln_nickname: lnNickname,
    on_duplicate: "skip",
  });

  const person = res.item;
  if (res.already_exists) {
    console.log(`Already in the workspace, in table ${person.playtable_sid}:`);
  } else {
    console.log("Added:");
  }
  console.log(`person:  ${person.sid}  ${person.context?.name ?? "(no name yet)"}`);
  console.log(`email:   ${person.work_email ?? "-"}`);
  // ok, no_contact_data (no identity given), duplicate or stoplisted.
  console.log(`status:  ${person.status}`);
});
