// MOCK tests of the workflow's Code nodes against the real dataset (no network, no Bubble, no Gemini).
// Usage: node test-local.js "<path to sample json>"
const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const src = (f) => fs.readFileSync(path.join(__dirname, 'code', f), 'utf8');

function run(file, { input, nodes = {}, staticData = {}, executionId = '1' }) {
  const fn = new Function('$input', '$', '$getWorkflowStaticData', '$execution', src(file));
  const $ = (name) => {
    if (!(name in nodes)) throw new Error(`Node "${name}" has not been executed`);
    return { first: () => ({ json: nodes[name] }) };
  };
  return fn({ first: () => ({ json: input }) }, $, () => staticData, { id: executionId })[0].json;
}

// Payload shaped like the one Bubble sends (every value is text, empty text = missing)
const s = (v) => (v === null || v === undefined ? '' : String(v));
const payloadFor = (a) => ({
  request_id: `req-${a.author_id}`,
  trigger: 'Single',
  author: { author_id: a.author_id, name: a.name, email: a.email, city: a.city },
  books: a.books.map((b) => ({
    book_id: b.book_id, title: b.title, genre: b.genre, status: b.status, publication: s(b.publication_date),
    mrp: s(b.mrp), royalty_per_copy: s(b.author_royalty_per_copy), copies_sold: s(b.total_copies_sold),
    royalty_earned: s(b.total_royalty_earned), royalty_paid: s(b.royalty_paid), royalty_pending: s(b.royalty_pending),
    last_payout: s(b.last_royalty_payout_date),
  })),
});

const settings = { gemini_model: 'm', overdue_days: 90, payout_window_days: 45, today_override: '2026-11-14' };
const results = [];
const check = (id, name, ok, detail) => results.push({ id, name, ok, detail });

function pipeline(payload, ai) {
  const v = run('validate-request.js', { input: { body: payload } });
  if (!v.valid) throw new Error('INVALID: ' + v.errors.join('; '));
  const dg = run('duplicate-guard.js', { input: v, staticData: {} });
  const nodes = { Settings: settings, 'Duplicate Guard': dg };
  const calc = run('calculate.js', { input: dg, nodes });
  nodes.Calculate = calc;
  const prompt = run('build-prompt.js', { input: calc, nodes });
  const aiInput = typeof ai === 'function' ? ai(calc, prompt) : ai;
  const email = run('compose-email.js', { input: aiInput, nodes });
  return { calc, prompt, email };
}
const aiOk = (text) => ({ candidates: [{ content: { parts: [{ text }] } }] });
const inr = (x) => '₹' + Number(x).toLocaleString('en-IN');
const goodAi = (calc) => {
  const lines = [`Dear ${calc.author.name.split(' ')[0]},`, ''];
  calc.books.filter((b) => b.published).forEach((b) => lines.push(`${b.title}: ${b.copies_sold} copies, earned ${inr(b.royalty_earned)}, paid ${inr(b.royalty_paid)}, pending ${inr(b.royalty_pending)}.`));
  lines.push('', `Total pending ${inr(calc.totals.pending)}. Thank you for writing with us. Warm regards, Team BookLeaf`);
  return JSON.stringify({ subject: 'Your royalty summary', body: lines.join('\n') });
};
const clone = (o) => JSON.parse(JSON.stringify(o));
const byId = Object.fromEntries(data.authors.map((a) => [a.author_id, a]));
const fails = (fn) => { try { fn(); return ''; } catch (e) { return e.message; } };

// A / B: valid authors, multiple books
{ const r = pipeline(payloadFor(byId.AUTH001), (c) => aiOk(goodAi(c)));
  check('A', 'AUTH001 totals match source data (19908 / 16338 / 3570)', r.calc.totals.earned === 19908 && r.calc.totals.paid === 16338 && r.calc.totals.pending === 3570, JSON.stringify(r.calc.totals));
  check('A2', 'AUTH001 badges: BK001 red, BK002 green', r.calc.books[0].badge === 'red' && r.calc.books[1].badge === 'green', r.calc.books.map((b) => b.badge).join(','));
  check('A3', 'AI email accepted when it quotes only verified amounts', r.email.source === 'ai', r.email.ai_problem); }
{ const r = pipeline(payloadFor(byId.AUTH007), (c) => aiOk(goodAi(c)));
  check('B', 'AUTH007 (3 books, 1 in production) totals 60865 / 53000 / 7865', r.calc.totals.earned === 60865 && r.calc.totals.paid === 53000 && r.calc.totals.pending === 7865 && r.calc.flags.in_production_count === 1, JSON.stringify(r.calc.totals)); }
{ const bad = [];
  for (const a of data.authors) {
    const r = pipeline(payloadFor(a), { error: { message: 'x' } });
    const sum = (k) => a.books.reduce((t, b) => t + b[k], 0);
    if (r.calc.totals.earned !== sum('total_royalty_earned') || r.calc.totals.paid !== sum('royalty_paid') || r.calc.totals.pending !== sum('royalty_pending') || r.calc.warnings.length) bad.push(a.author_id);
  }
  check('ALL', 'All 10 real authors: totals equal source sums, zero warnings', bad.length === 0, bad.join(',')); }
{ const r = pipeline(payloadFor(byId.AUTH003), { error: { message: 'boom' } });
  check('NP', 'AUTH003 never paid + pending: red badge, next payout given', r.calc.books[0].badge === 'red' && !!r.calc.next_payout, JSON.stringify(r.calc.next_payout)); }
{ const r = pipeline(payloadFor(byId.AUTH008), { error: { message: 'boom' } });
  check('PAID', 'AUTH008 fully paid: green, no next payout, template says paid up', r.calc.books[0].badge === 'green' && r.calc.next_payout === null && /fully paid up/.test(r.email.body), r.calc.books[0].badge); }
{ const r = pipeline(payloadFor(byId.AUTH009), { error: { message: 'boom' } });
  check('PROD', 'AUTH009 (1 in production + 1 published): production update included', /in production/.test(r.email.body) && r.calc.flags.in_production_count === 1, ''); }

// C. no books
{ const p = payloadFor(byId.AUTH001); p.books = []; const m = fails(() => pipeline(p));
  check('C', 'Author with no books -> clear error', /No books were sent/.test(m), m); }
// D / E. request validation
{ const v = (body) => run('validate-request.js', { input: { body } });
  const d = payloadFor(byId.AUTH001); delete d.author.author_id;
  const e = payloadFor(byId.AUTH001); e.author.author_id = 'bad!';
  const nb = payloadFor(byId.AUTH001); nb.books = 'x';
  check('D', 'Missing author_id rejected', v(d).valid === false && v(d).errors.includes('author.author_id is missing'), v(d).errors.join(';'));
  check('E', 'Invalid author_id format rejected', v(e).valid === false, v(e).errors.join(';'));
  check('E2', 'books not a list rejected', v(nb).valid === false, v(nb).errors.join(';'));
  check('V', 'Valid request accepted', v(payloadFor(byId.AUTH010)).valid === true, ''); }
// F. invalid royalty values
{ const a = payloadFor(byId.AUTH001); a.books[0].royalty_pending = 'abc';
  const b = payloadFor(byId.AUTH001); b.books[0].royalty_paid = '-5';
  const c = payloadFor(byId.AUTH001); c.books[0].royalty_earned = '';
  check('F1', 'Non-numeric royalty value rejected', /Invalid royalty pending/.test(fails(() => pipeline(a))), fails(() => pipeline(a)));
  check('F2', 'Negative royalty value rejected', /Negative royalty paid/.test(fails(() => pipeline(b))), fails(() => pipeline(b)));
  check('F3', 'Missing royalty field on published book rejected', /Missing royalty fields/.test(fails(() => pipeline(c))), fails(() => pipeline(c))); }
// H. AI failure -> template with identical verified figures
{ const r = pipeline(payloadFor(byId.AUTH002), { error: { message: 'Gemini 503' } });
  check('H', 'AI API failure -> deterministic template, figures intact', r.email.source === 'template' && r.email.body.includes('₹13,024') && /AI call failed/.test(r.email.ai_problem), r.email.ai_problem); }
{ const r = pipeline(payloadFor(byId.AUTH002), aiOk(JSON.stringify({ subject: 's', body: `Dear Rohit, you earned ₹99,999 in total. ${'x'.repeat(100)}` })));
  check('AI1', 'AI invented amount rejected, template used', r.email.source === 'template' && /not in the verified data/.test(r.email.ai_problem), r.email.ai_problem); }
{ const r = pipeline(payloadFor(byId.AUTH002), aiOk('not json at all'));
  check('AI2', 'AI non-JSON output rejected, template used', r.email.source === 'template', r.email.ai_problem); }
// I. idempotency
{ const sd = {}; const v1 = run('validate-request.js', { input: { body: payloadFor(byId.AUTH001) } });
  const v2 = run('validate-request.js', { input: { body: { ...payloadFor(byId.AUTH001), request_id: 'other' } } });
  const v3 = run('validate-request.js', { input: { body: payloadFor(byId.AUTH002) } });
  const g1 = run('duplicate-guard.js', { input: v1, staticData: sd }), g2 = run('duplicate-guard.js', { input: v2, staticData: sd }), g3 = run('duplicate-guard.js', { input: v3, staticData: sd });
  check('I', 'Same author twice within 60s: 2nd ignored; other author allowed', g1.duplicate === false && g2.duplicate === true && g3.duplicate === false, g2.duplicate_reason); }

let failed = 0;
for (const r of results) { if (!r.ok) failed++; console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id.padEnd(5)} ${r.name}  ${r.ok ? '' : '=> ' + r.detail}`); }
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
