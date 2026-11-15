// Sends a REAL request (real author data from the dataset) to the local n8n webhook, shaped like Bubble's payload.
// Usage: node send-test.js <dataset.json> <AUTHxxx> <test|prod> [request_id] [secretfile]
const fs = require('fs');
const [, , dataPath, authorId, mode = 'test', reqId, secretFile = 'E:/Development/tools/bookleaf-webhook-secret.txt'] = process.argv;
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const a = data.authors.find((x) => x.author_id === authorId);
if (!a) { console.log('unknown author in dataset'); process.exit(2); }
const s = (v) => (v === null || v === undefined ? '' : String(v));
const body = {
  request_id: reqId || `cli-${authorId}-${Date.now()}`,
  trigger: 'Single',
  author: { author_id: a.author_id, name: a.name, email: a.email, city: a.city },
  books: a.books.map((b) => ({
    book_id: b.book_id, title: b.title, genre: b.genre, status: b.status, publication: s(b.publication_date),
    mrp: s(b.mrp), royalty_per_copy: s(b.author_royalty_per_copy), copies_sold: s(b.total_copies_sold),
    royalty_earned: s(b.total_royalty_earned), royalty_paid: s(b.royalty_paid), royalty_pending: s(b.royalty_pending),
    last_payout: s(b.last_royalty_payout_date),
  })),
};
const secret = fs.readFileSync(secretFile, 'utf8').trim();
const url = `http://localhost:5678/${mode === 'prod' ? 'webhook' : 'webhook-test'}/bookleaf-royalty-summary`;
(async () => {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BookLeaf-Secret': process.env.BL_SECRET_OVERRIDE || secret }, body: JSON.stringify(body) });
  const t = await r.text();
  console.log('HTTP', r.status);
  try { console.log(JSON.stringify(JSON.parse(t), null, 2)); } catch { console.log(t); }
})();
