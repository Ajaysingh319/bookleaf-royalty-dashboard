// Compose Email: validates the AI output against the calculated facts; on any problem (AI error, bad JSON,
// invented amounts, missing author name/pending total) it falls back to a deterministic template.
const facts = $('Calculate').first().json;
const input = $input.first().json || {};

const inr = (x) => '₹' + Number(x).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const published = facts.books.filter((b) => b.published);
const production = facts.books.filter((b) => b.in_production);

function template() {
  const lines = [`Dear ${facts.author.name},`, '', 'Here is your royalty summary from BookLeaf Publishing.', ''];
  for (const b of published) {
    lines.push(`• ${b.title}: ${b.copies_sold} copies sold; royalty earned ${inr(b.royalty_earned)}, paid ${inr(b.royalty_paid)}, pending ${inr(b.royalty_pending)}; ` +
      `last payout: ${b.last_payout_date || 'no payout made yet'}.`);
  }
  lines.push('', `Total earned: ${inr(facts.totals.earned)}`, `Total paid: ${inr(facts.totals.paid)}`, `Total pending: ${inr(facts.totals.pending)}`, '');
  if (facts.flags.has_pending && facts.next_payout) {
    lines.push(`BookLeaf pays royalties quarterly, and payment is expected within 45 days of the quarter end. Your next payout is expected by ${facts.next_payout.expected_by}.`, '');
  } else if (facts.flags.all_paid) {
    lines.push('Great news: all of your royalties are fully paid up. Thank you for being part of BookLeaf!', '');
  }
  for (const b of production) {
    lines.push(`Update: "${b.title}" is currently in production (${b.status}).`);
  }
  if (production.length) lines.push('');
  lines.push('If you have any questions, simply reply to this email and we will be happy to help.', '', 'Warm regards,', 'Team BookLeaf');
  return { subject: 'Your BookLeaf royalty summary', body: lines.join('\n') };
}

// ---- allowed numbers (everything the AI is permitted to quote in rupees)
const allowed = new Set();
const add = (x) => { if (typeof x === 'number' && Number.isFinite(x)) allowed.add(x.toFixed(2)); };
['earned', 'paid', 'pending'].forEach((k) => add(facts.totals[k]));
for (const b of facts.books) {
  ['royalty_earned', 'royalty_paid', 'royalty_pending', 'mrp', 'royalty_per_copy'].forEach((k) => add(b[k]));
}

function checkAi(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) { return { ok: false, why: 'AI response was not valid JSON' }; }
  if (!parsed || typeof parsed.subject !== 'string' || typeof parsed.body !== 'string' ||
      !parsed.subject.trim() || parsed.body.trim().length < 80) {
    return { ok: false, why: 'AI response missing subject/body or too short' };
  }
  const re = /(?:₹|Rs\.?\s?|INR\s?)\s*([\d,]+(?:\.\d{1,2})?)/gi;
  let m;
  while ((m = re.exec(parsed.body)) !== null) {
    const v = Number(m[1].replace(/,/g, ''));
    if (!allowed.has(v.toFixed(2))) return { ok: false, why: `AI quoted an amount not in the verified data: ${m[0]}` };
  }
  const first = facts.author.name.split(/\s+/)[0].toLowerCase();
  if (!parsed.body.toLowerCase().includes(first)) return { ok: false, why: 'AI email does not greet the author by name' };
  if (facts.flags.has_pending && !parsed.body.includes(inr(facts.totals.pending))) {
    return { ok: false, why: 'AI email omits the verified total pending amount' };
  }
  for (const b of published) {
    if (!parsed.body.includes(b.title)) return { ok: false, why: `AI email omits book title "${b.title}"` };
  }
  return { ok: true, subject: parsed.subject.trim(), body: parsed.body.trim() };
}

let source = 'template';
let aiProblem = '';
let email = null;

const cand = input.candidates && input.candidates[0];
const text = cand && cand.content && cand.content.parts && cand.content.parts.map((p) => p.text || '').join('');
if (input.error || !text) {
  const why = input.error ? (input.error.message || input.error) : 'empty AI response';
  aiProblem = ('AI call failed: ' + (typeof why === 'string' ? why : JSON.stringify(why))).slice(0, 300);
} else {
  const r = checkAi(text);
  if (r.ok) { source = 'ai'; email = { subject: r.subject, body: r.body }; }
  else aiProblem = r.why;
}
if (!email) email = template();

return [{
  json: {
    subject: email.subject,
    body: email.body,
    summary_text: `Subject: ${email.subject}\n\n${email.body}`,
    source,
    ai_problem: aiProblem,
    totals: facts.totals,
    warnings: facts.warnings,
  },
}];
