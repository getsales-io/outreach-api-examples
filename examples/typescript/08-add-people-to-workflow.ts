// 08: add people to a workflow. Anyone the workflow already holds stays as
// they are, so a second run of the script, or a retry after a lost answer,
// starts nobody over.
//
// add_workflow_people is the one way into a workflow. The people enter
// through the workflow's manual source, and the call makes that source when
// the workflow has none, so a key that may act on workflows is enough. A
// person the workflow holds already is left as they are, a finished journey
// included, and counted in skipped_enrolled_count. To run them again on
// purpose, add restart to the body: "from_start" runs them from the first
// step, "from_current" from the step they are on.
// The workflow needs a published version (409 invalid_transition) and must
// not be archived (409 conflict). Every person sid must exist (find them with
// 04): one unknown sid rejects the whole call with 422 relation_not_found,
// and nobody is added.
// Run: node examples/typescript/08-add-people-to-workflow.ts wf_wf_XXXXXXXXXXXX cr_pp_XXXXXXXXXXXX [more cr_pp_ sids, up to 500]
import { gs, run, usage, type ActionResult } from "./client.ts";

/** What this call did. */
interface AddPeopleResult {
  source_created: boolean;
  entered_count: number;
  skipped_enrolled_count: number;
  re_entered_count: number;
  blocked_stoplisted_count: number;
  blocked_limit_count: number;
  blocked_other_count: number;
}

/** The workflow's manual source, which took the people in. */
interface WorkflowSource {
  sid: string;
  name: string | null;
  type: "manual";
}

const [workflowSid, ...personSids] = process.argv.slice(2);
if (!workflowSid || personSids.length === 0) {
  usage("08-add-people-to-workflow.ts <workflow_sid> <person_sid> [more person sids]");
}
// Each sid once, in the order given.
const people = [...new Set(personSids)];
if (people.length > 500) usage("08-add-people-to-workflow.ts: at most 500 people per call");

run(async () => {
  const res = await gs.post<ActionResult<AddPeopleResult, WorkflowSource | null>>(
    "playtables",
    `/api/workflows/${workflowSid}/add-people`,
    { people_sids: people },
  );
  const r = res.result;
  console.log(`entered: ${r.entered_count}`);
  console.log(`in the workflow already, left as they are: ${r.skipped_enrolled_count}`);
  console.log(
    `blocked: ${r.blocked_stoplisted_count} on the stoplist, ${r.blocked_limit_count} waiting for a free slot, ` +
      `${r.blocked_other_count} not eligible`,
  );
  if (res.item) console.log(`manual source: ${res.item.sid}${r.source_created ? " (made by this call)" : ""}`);
});
