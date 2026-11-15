// Build Failure: single funnel for every failed step. The text goes back to Bubble in the webhook reply,
// where Bubble records it in the Notification Log (Status = Failed, Error = this text).
const j = $input.first().json || {};
let ctx = {};
try { ctx = $('Duplicate Guard').first().json; } catch (e) { ctx = {}; }

let msg = '';
const e = j.error;
if (typeof e === 'string') msg = e;
else if (e && typeof e === 'object') msg = e.message || e.description || JSON.stringify(e);
else if (j.message) msg = j.message;
else msg = JSON.stringify(j);
msg = String(msg).replace(/\s+/g, ' ').slice(0, 400);

return [{
  json: {
    author_id: ctx.author_id,
    execution_id: $execution.id,
    error_text: `[n8n execution ${$execution.id}] ${msg}`,
    failed_at: new Date().toISOString(),
  },
}];
