// 05: search the companies in your workspace, by domain or by name.
//
// A domain is an exact filter on the lowercased apex domain. Anything else goes
// to q, free text over the name, domain and website. include people_counts adds
// how many people of each company the workspace holds.
// To stay inside one table, add playtable_sids: { in: ["pt_tb_..."] } to the filter.
// Run: node examples/typescript/05-search-companies.ts example.com
//      node examples/typescript/05-search-companies.ts "Example Agency"
import { gs, run, usage, type SearchResult } from "./client.ts";

interface Company {
  sid: string;
  domain: string | null;
  playtable_sids: string[];
  context: { name: string | null; website: string | null } | null;
}

const query = process.argv[2];
if (!query) usage('05-search-companies.ts <domain | "company name">');

run(async () => {
  const lower = query.toLowerCase();
  const filter = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(lower)
    ? { domain: { eq: lower } }
    : { q: query };

  const res = await gs.post<SearchResult<Company, { people_counts?: { total_count: number } }>>(
    "playtables",
    "/api/companies/search",
    { filter, include: ["people_counts"], page_size: 10 },
  );

  if (res.items.length === 0) {
    console.log("No company matches.");
    return;
  }
  for (const { item, included } of res.items) {
    console.log(
      [
        item.sid,
        item.context?.name ?? "(no name)",
        item.domain ?? "no domain",
        `${included.people_counts?.total_count ?? 0} people`,
        `${item.playtable_sids.length} table(s)`,
      ].join("  |  "),
    );
  }
});
