// 01: check that your key works and see which workspace it acts in.
//
// A table search with page_size 0 returns counts and no rows, which makes it
// the cheapest call that proves a key. Its meta block names the workspace
// (team_sid) and who made the call (actor_type "api_key").
// The current-user call, GET /id/v1/api/users/current, is no use for this: it
// looks the caller up as a person, a key's actor is the key's own id_ak_ sid,
// and so it answers 422 validation_failed with
// error.field_errors.sid[0].rule "invalid_id_type".
// Run: node examples/typescript/01-check-key.ts
import { gs, run, type SearchResult } from "./client.ts";

run(async () => {
  const res = await gs.post<SearchResult<{ sid: string }>>("playtables", "/api/playtables/search", {
    page_size: 0,
  });

  console.log("The key works.");
  console.log(`workspace:  ${res.meta.team_sid ?? "unknown"}`);
  console.log(`acting as:  ${res.meta.actor_type ?? "unknown"}`);
  console.log(`tables:     ${res.counts?.total_count ?? 0}`);
  console.log(`trace_id:   ${res.meta.trace_id}`);
});
