// 09: list your sender profiles and the channels each one holds.
//
// A sender profile is the identity your team sends as, with its LinkedIn account and its mailboxes.
// linkedin_status is null while the profile has no LinkedIn account, and
// mailboxes[] lists each mailbox with its address, its status and whether it
// is the primary one.
// There is no single-read call: to read one, filter by sid: { eq: "ub_sp_..." }.
// A workflow names the sender profiles it uses by these ub_sp_ sids.
// Run: node examples/typescript/09-list-sender-profiles.ts
import { gs, run, type SearchResult } from "./client.ts";

interface Mailbox {
  email_account_sid: string;
  address: string | null;
  status: string;
  is_primary: boolean;
}

interface SenderProfile {
  sid: string;
  name: string;
  label: string | null;
  linkedin_status: string | null;
  mailboxes: Mailbox[] | null;
}

run(async () => {
  const res = await gs.post<SearchResult<SenderProfile>>("unibox", "/api/sender-profiles/search", {
    sort: { field: "name", direction: "asc" },
    page_size: 100,
  });

  if (res.items.length === 0) {
    console.log("No sender profiles yet. They are set up in the app.");
    return;
  }
  for (const { item } of res.items) {
    console.log(`${item.sid}  ${item.name}${item.label ? `  (${item.label})` : ""}`);
    console.log(`  LinkedIn: ${item.linkedin_status ?? "not connected"}`);
    for (const mailbox of item.mailboxes ?? []) {
      console.log(`  mailbox:  ${mailbox.address ?? mailbox.email_account_sid}  ${mailbox.status}${mailbox.is_primary ? "  primary" : ""}`);
    }
  }
});
