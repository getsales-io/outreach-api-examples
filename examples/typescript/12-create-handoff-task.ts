// 12: hand a conversation to a teammate with a task.
//
// A task anchored to a thread shows on the thread, and a task that is undated
// or due today turns the thread to needs_you at once. Put in body what the
// teammate needs to act without rereading the thread. Your AI SDR opens the
// same kind of task when it hands a thread to a person.
// With a teammate's email, the script looks up their member record and assigns
// the task to them (reading members takes a key that may view team members).
// The address is lowercased and trimmed before it goes into the filter.
// Without one, the task stays unassigned. Each run of the script makes a new task.
// due_at sets a deadline (ISO 8601 UTC). An open task expires a month after
// it is created unless you set expires_at, or null for never.
// Run: node examples/typescript/12-create-handoff-task.ts ub_cv_XXXXXXXXXXXX [teammate@example.com] ["Task title"]
import { gs, run, usage, type CreateResult, type SearchResult } from "./client.ts";

interface TeamMember {
  sid: string;
  user_sid: string | null;
  email: string;
  status: "invited" | "active" | "revoked";
}

interface Task {
  sid: string;
  title: string;
  state: "open" | "done" | "canceled";
  conversation_sid: string | null;
  person_sid: string | null;
  assignee_user_sid: string | null;
  expires_at: string | null;
}

const [conversationSid, emailArg, title = "Reply needs a person: they asked for a call"] = process.argv.slice(2);
if (!conversationSid) usage('12-create-handoff-task.ts <conversation_sid> [teammate_email] ["title"]');
const teammateEmail = emailArg?.trim().toLowerCase();

run(async () => {
  let assignee: string | null = null;
  if (teammateEmail) {
    const members = await gs.post<SearchResult<TeamMember>>("id", "/api/team-members/search", {
      filter: {
        email: { eq: teammateEmail },
        status: { eq: "active" },
      },
      page_size: 1,
    });
    assignee = members.items[0]?.item.user_sid ?? null;
    if (!assignee) throw new Error(`no active member with the email ${teammateEmail}`);
  }

  const res = await gs.post<CreateResult<Task>>("unibox", "/api/tasks", {
    title,
    body: "They replied asking for a short call next week. Offer two times and send the meeting link.",
    conversation_sid: conversationSid,
    assignee_user_sid: assignee,
  });

  const task = res.item;
  console.log(`task ${task.sid}: ${task.title}`);
  console.log(`state ${task.state}, assigned to ${task.assignee_user_sid ?? "nobody yet"}, person ${task.person_sid ?? "not linked"}`);
  console.log(`expires ${task.expires_at ?? "never"}`);
});
