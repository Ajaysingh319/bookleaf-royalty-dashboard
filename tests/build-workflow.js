// Assembles the importable n8n workflow JSON from the code files. Contains NO secrets:
// credentials are referenced by name only and must be created in n8n after import.
const fs = require('fs');
const path = require('path');
const code = (f) => fs.readFileSync(path.join(__dirname, 'code', f), 'utf8');

// Credential ids below are this machine's n8n ids (not secret). On another n8n instance, re-select the
// credentials by name after import.
const CRED_WEBHOOK = { id: 'yOqZt8wcAd9fxTCW', name: 'BookLeaf Webhook Secret' };
const CRED_GEMINI = { id: 'wLHZDlWJsZB9Ixmd', name: 'Gemini API Key' };

const nodes = [];
const add = (n) => { nodes.push(n); return n; };
const codeNode = (name, file, position, errOut = false) => add({
  parameters: { jsCode: code(file) }, name, type: 'n8n-nodes-base.code', typeVersion: 2, position,
  ...(errOut ? { onError: 'continueErrorOutput' } : {}),
});
const respond = (name, position, status, bodyExpr) => add({
  parameters: { respondWith: 'json', responseBody: `={{ JSON.stringify(${bodyExpr}) }}`, options: { responseCode: status } },
  name, type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position,
});
const ifBool = (name, position, expr) => add({
  parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
    conditions: [{ id: name, leftValue: `={{ ${expr} }}`, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
    combinator: 'and' }, options: {} },
  name, type: 'n8n-nodes-base.if', typeVersion: 2.2, position,
});
const DG = "$('Duplicate Guard').first().json";
const CE = "$('Compose Email').first().json";

add({
  parameters: { content: [
    '## BookLeaf royalty summary',
    'Bubble button -> POST webhook (X-BookLeaf-Secret header) with the author + books ->',
    'validate -> duplicate guard -> deterministic royalty maths (Code) -> Gemini writes the email text ->',
    'output validated (fallback template if the AI fails or invents a number) -> reply to Bubble,',
    'which records Success / Failed / Skipped in its Notification Log.',
    '',
    'Credentials to create after import (values are never stored in this file):',
    '1. BookLeaf Webhook Secret (Header Auth: name X-BookLeaf-Secret)',
    '2. Gemini API Key (Header Auth: name x-goog-api-key)',
  ].join('\n'), height: 240, width: 560 },
  name: 'Notes', type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: [0, -140],
});

add({
  parameters: { httpMethod: 'POST', path: 'bookleaf-royalty-summary', authentication: 'headerAuth', responseMode: 'responseNode', options: {} },
  name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 300],
  webhookId: 'b00c1ea5-0000-4000-8000-0a11a0000001',
  credentials: { httpHeaderAuth: CRED_WEBHOOK },
});

const setv = (name, value, type = 'string') => ({ id: name, name, value, type });
add({
  parameters: { assignments: { assignments: [
    setv('gemini_model', 'gemini-3.5-flash-lite'),
    setv('overdue_days', 90, 'number'),
    setv('payout_window_days', 45, 'number'),
    setv('today_override', ''),
  ] }, includeOtherFields: true, options: {} },
  name: 'Settings', type: 'n8n-nodes-base.set', typeVersion: 3.4, position: [220, 300],
});

codeNode('Validate Request', 'validate-request.js', [440, 300]);
ifBool('Request Valid?', [660, 300], '$json.valid');
respond('Respond 400', [880, 520], 400, "{ status: 'rejected', errors: $json.errors, execution_id: $json.execution_id }");
codeNode('Duplicate Guard', 'duplicate-guard.js', [880, 200]);
ifBool('Is Duplicate?', [1100, 200], '$json.duplicate');
respond('Respond Duplicate', [1320, 60], 200, `{ status: 'duplicate_ignored', author_id: ${DG}.author_id, reason: ${DG}.duplicate_reason, execution_id: $execution.id, completed_at: new Date().toISOString() }`);

codeNode('Calculate', 'calculate.js', [1320, 300], true);
codeNode('Build Prompt', 'build-prompt.js', [1540, 300]);
add({
  parameters: {
    method: 'POST',
    url: "=https://generativelanguage.googleapis.com/v1beta/models/{{ $('Build Prompt').first().json.model }}:generateContent",
    sendBody: true, specifyBody: 'json', jsonBody: "={{ JSON.stringify($('Build Prompt').first().json.geminiBody) }}",
    authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', options: { timeout: 25000 },
  },
  name: 'Gemini', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [1760, 300],
  credentials: { httpHeaderAuth: CRED_GEMINI },
  retryOnFail: false, onError: 'continueErrorOutput',
});
codeNode('Compose Email', 'compose-email.js', [1980, 300], true);
respond('Respond Success', [2200, 240], 200,
  `{ status: 'success', execution_id: $execution.id, author_id: ${DG}.author_id, request_id: ${DG}.request_id, email_source: ${CE}.source, ai_problem: ${CE}.ai_problem, subject: ${CE}.subject, summary_text: ${CE}.summary_text, totals: ${CE}.totals, warnings: ${CE}.warnings, completed_at: new Date().toISOString() }`);

codeNode('Build Failure', 'build-failure.js', [1760, 560]);
respond('Respond Failed', [1980, 560], 200,
  "{ status: 'failed', execution_id: $execution.id, author_id: $json.author_id, error: $json.error_text, completed_at: new Date().toISOString() }");

const link = (from, outputs) => [from, { main: outputs.map((o) => (o ? (Array.isArray(o) ? o : [o]).map((n) => ({ node: n, type: 'main', index: 0 })) : [])) }];
const connections = Object.fromEntries([
  link('Webhook', [['Settings']]),
  link('Settings', [['Validate Request']]),
  link('Validate Request', [['Request Valid?']]),
  link('Request Valid?', [['Duplicate Guard'], ['Respond 400']]),
  link('Duplicate Guard', [['Is Duplicate?']]),
  link('Is Duplicate?', [['Respond Duplicate'], ['Calculate']]),
  link('Calculate', [['Build Prompt'], ['Build Failure']]),
  link('Build Prompt', [['Gemini']]),
  link('Gemini', [['Compose Email'], ['Compose Email']]),
  link('Compose Email', [['Respond Success'], ['Build Failure']]),
  link('Build Failure', [['Respond Failed']]),
]);

nodes.forEach((n, i) => { n.id = `bl-${String(i + 1).padStart(2, '0')}-${n.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`; });

const workflow = {
  name: 'BookLeaf Royalty Summary',
  nodes, connections, active: false,
  settings: { executionOrder: 'v1', saveDataErrorExecution: 'all', saveDataSuccessExecution: 'all', saveManualExecutions: true },
  pinData: {}, meta: { templateCredsSetupCompleted: false }, tags: [],
};
const out = process.argv[2] || path.join(__dirname, 'n8n-workflow.json');
fs.writeFileSync(out, JSON.stringify(workflow, null, 2));
console.log(`wrote ${out} (${nodes.length} nodes)`);
