// 07: list your workflows, the multichannel sequences people move through,
// with their status and how many people each one holds.
//
// Archived workflows are left out with a status filter. A workflow takes new
// people only once it has a published version: published_version_sid is null
// until the first publish. The script reads up to five pages, each time
// handing back the pagination.next_cursor of the page before as cursor. A
// cursor is a token to return as it came, and it only ever moves ahead.
// Run: node examples/typescript/07-list-workflows.ts
import { gs, run, type SearchResult } from "./client.ts";

interface Workflow {
  sid: string;
  name: string;
  status: "draft" | "active" | "paused" | "archived";
  published_version_sid: string | null;
  sender_profile_sids: string[];
  updated_at: string;
}

interface Included {
  records_counts?: { total_count: number };
}

run(async () => {
  let cursor: string | null = null;
  for (let page = 1; page <= 5; page += 1) {
    const res: SearchResult<Workflow, Included> = await gs.post<SearchResult<Workflow, Included>>(
      "playtables",
      "/api/workflows/search",
      {
        filter: { status: { ne: "archived" } },
        include: ["records_counts"],
        sort: { field: "updated_at", direction: "desc" },
        page_size: 50,
        cursor,
      },
    );
    for (const { item, included } of res.items) {
      console.log(
        [
          item.sid,
          item.status.padEnd(6),
          item.published_version_sid ? "published" : "not published",
          `${included.records_counts?.total_count ?? 0} people`,
          `${item.sender_profile_sids.length} sender profile(s)`,
          item.name,
        ].join("  |  "),
      );
    }
    cursor = res.pagination.next_cursor;
    if (!cursor) break;
  }
});
