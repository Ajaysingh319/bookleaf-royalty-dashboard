// Duplicate Guard (idempotency): the same author (or the same request_id) inside the window is ignored.
// State lives in n8n workflow static data, which persists between production executions.
const v = $input.first().json;
const WINDOW_MS = 60 * 1000;
const sd = $getWorkflowStaticData('global');
sd.recent = sd.recent || {};
const now = Date.now();

for (const k of Object.keys(sd.recent)) {
  if (now - sd.recent[k].t > WINDOW_MS * 10) delete sd.recent[k];
}

const prev = sd.recent[v.author_id];
const sameRequest = Object.values(sd.recent).some((e) => e.request_id === v.request_id);
let duplicate = false;
let reason = '';
if (prev && now - prev.t < WINDOW_MS) {
  duplicate = true;
  reason = `Duplicate request ignored: ${v.author_id} was already triggered ${Math.round((now - prev.t) / 1000)}s ago`;
} else if (sameRequest) {
  duplicate = true;
  reason = `Duplicate request ignored: request_id ${v.request_id} was already processed`;
}

if (!duplicate) sd.recent[v.author_id] = { t: now, request_id: v.request_id };

return [{ json: { ...v, duplicate, duplicate_reason: reason } }];
