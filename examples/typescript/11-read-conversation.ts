// 11: read a conversation from the unified inbox: the thread, who is in it,
// and its messages, on email and LinkedIn alike.
//
// The thread read returns its state (needs_you, agent, waiting, stalled, later,
// done), its channels and, with include participants, everyone in it.
// Messages come from the message search, newest first, and each older page
// asks for created_at before the oldest message already read. The script reads
// up to three pages and prints the messages oldest first.
// Run: node examples/typescript/11-read-conversation.ts ub_cv_XXXXXXXXXXXX
import { gs, run, usage, type GetResult, type SearchResult } from "./client.ts";

interface Conversation {
  sid: string;
  state: "needs_you" | "agent" | "waiting" | "stalled" | "later" | "done";
  channels: ("linkedin" | "email")[];
  sender_profile_sid: string | null;
  primary_person_sid: string | null;
  scenario_key: string | null;
  needs_reply: boolean;
  last_message_at: string | null;
}

interface Participant {
  sid: string;
  role: "counterpart" | "cc" | "group_member" | "sender";
  is_primary: boolean;
  display_name: string | null;
}

interface Message {
  sid: string;
  channel: "linkedin" | "email";
  direction: "inbound" | "outbound";
  author: "contact" | "user" | "agent";
  state: string;
  subject: string | null;
  body_text: string;
  created_at: string;
}

const conversationSid = process.argv[2];
if (!conversationSid) usage("11-read-conversation.ts <conversation_sid>");

run(async () => {
  const thread = await gs.get<GetResult<Conversation, { participants?: Participant[] }>>(
    "unibox",
    `/api/conversations/${conversationSid}`,
    { "include[]": ["participants"] },
  );
  const c = thread.item;
  console.log(`thread ${c.sid}: ${c.state} on ${c.channels.join(" + ")}, needs a reply: ${c.needs_reply ? "yes" : "no"}`);
  console.log(`sender profile ${c.sender_profile_sid ?? "-"}, person ${c.primary_person_sid ?? "not linked"}, scenario ${c.scenario_key ?? "-"}`);
  for (const p of thread.included.participants ?? []) {
    console.log(`  ${p.role}${p.is_primary ? " (primary)" : ""}: ${p.display_name ?? p.sid}`);
  }

  const messages: Message[] = [];
  let before: string | undefined;
  for (let page = 0; page < 3; page += 1) {
    const res = await gs.post<SearchResult<Message>>("unibox", "/api/messages/search", {
      filter: {
        conversation_sid: { eq: conversationSid },
        created_at: before ? { lt: before } : undefined,
      },
      sort: { field: "created_at", direction: "desc" },
      page_size: 20,
    });
    messages.push(...res.items.map((row) => row.item));
    const oldest = res.items.at(-1)?.item.created_at;
    if (!res.pagination.has_more || !oldest) break;
    before = oldest;
  }

  for (const m of messages.reverse()) {
    const who = m.direction === "inbound" ? "them" : m.author === "agent" ? "your AI SDR" : "you";
    console.log(`\n[${m.created_at}] ${who} on ${m.channel}${m.state === "pending_approval" ? " (draft waiting for approval)" : ""}`);
    if (m.subject) console.log(`subject: ${m.subject}`);
    console.log(m.body_text);
  }
});
