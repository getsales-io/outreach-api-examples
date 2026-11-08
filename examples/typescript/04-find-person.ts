// 04: find a person in the workspace, by work email or by free text.
//
// An email becomes an exact filter on work_email. People search matches that
// field as a lowercased term, so the address is lowercased and trimmed first.
// Anything else goes to q, free text over the name, the company name, the
// emails and the LinkedIn public ID. Each row's context carries the name, the
// role and the company the person is shown with.
// Other exact filters: ln_member_id, ln_id, sn_id, ln_nickname, playtable_sid.
// Search reads an index that trails a fresh write by a few seconds.
// Run: node examples/typescript/04-find-person.ts jane.cooper@example.com
//      node examples/typescript/04-find-person.ts "Jane Cooper"
import { gs, run, usage, type SearchResult } from "./client.ts";

interface Person {
  sid: string;
  playtable_sid: string;
  status: string;
  work_email: string | null;
  context: {
    name: string | null;
    role: string | null;
    company: { sid: string | null; name: string | null; domain: string | null } | null;
  } | null;
}

const query = process.argv[2]?.trim();
if (!query) usage('04-find-person.ts <work_email | "name or other text">');

run(async () => {
  const filter = query.includes("@")
    ? { work_email: { eq: query.toLowerCase() } }
    : { q: query };

  const res = await gs.post<SearchResult<Person>>("playtables", "/api/people/search", {
    filter,
    page_size: 10,
  });

  if (res.items.length === 0) {
    console.log("No one matches.");
    return;
  }
  for (const { item } of res.items) {
    const company = item.context?.company;
    console.log(
      [
        item.sid,
        item.context?.name ?? "(no name)",
        item.context?.role ?? "-",
        item.work_email ?? "-",
        company ? `${company.name ?? "(no name)"} (${company.domain ?? "no domain"})` : "no company",
        `table ${item.playtable_sid}`,
        item.status,
      ].join("  |  "),
    );
  }
});
