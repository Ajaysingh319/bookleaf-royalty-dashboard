// Build Prompt: the AI only receives pre-calculated, verified facts and writes the wording.
const facts = $input.first().json;
const cfg = $('Settings').first().json;

const inr = (x) => '₹' + Number(x).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const authorFacts = {
  author_name: facts.author.name,
  reference_date: facts.reference_date,
  published_books: facts.books.filter((b) => b.published).map((b) => ({
    title: b.title,
    copies_sold: b.copies_sold,
    royalty_earned: inr(b.royalty_earned),
    royalty_paid: inr(b.royalty_paid),
    royalty_pending: inr(b.royalty_pending),
    last_payout_date: b.last_payout_date || 'no payout has been made yet',
  })),
  books_in_production: facts.books.filter((b) => b.in_production).map((b) => ({
    title: b.title,
    stage: b.status,
  })),
  totals: {
    total_earned: inr(facts.totals.earned),
    total_paid: inr(facts.totals.paid),
    total_pending: inr(facts.totals.pending),
  },
  all_royalties_paid: facts.flags.all_paid,
  next_payout: facts.next_payout
    ? { expected_by: facts.next_payout.expected_by, quarter_end: facts.next_payout.quarter_end }
    : null,
};

const system = [
  'You write royalty summary emails for BookLeaf Publishing authors.',
  'Tone: warm, professional, clear and respectful. Plain language, no hype, no jargon.',
  'STRICT RULES:',
  '1. Use ONLY the facts in the JSON provided. Never invent, estimate, round or recalculate any number, date, title or status.',
  '2. Copy every rupee amount exactly as written in the JSON (including the ₹ symbol).',
  '3. Greet the author by name. Summarise each published book (copies sold, earned, paid, pending, last payout date).',
  '4. Give a clear breakdown of total earned, total paid and total pending.',
  '5. If next_payout is not null, explain that BookLeaf pays royalties quarterly and that payment is expected within 45 days of the quarter end, naming the expected_by date. Do not promise an exact payment day.',
  '6. If all_royalties_paid is true, warmly acknowledge that everything is paid up.',
  '7. If books_in_production is not empty, add a short status update for each such book (title and stage only).',
  '8. End with a warm, professional closing signed "Team BookLeaf".',
  'Return JSON with exactly two string fields: "subject" and "body" (plain text, paragraphs separated by blank lines).',
].join('\n');

const geminiBody = {
  systemInstruction: { parts: [{ text: system }] },
  contents: [{ role: 'user', parts: [{ text: 'Facts (JSON):\n' + JSON.stringify(authorFacts, null, 2) }] }],
  generationConfig: {
    temperature: 0.3,
    maxOutputTokens: 2000,
    thinkingConfig: { thinkingLevel: 'low' },
    responseMimeType: 'application/json',
    responseSchema: {
      type: 'OBJECT',
      properties: { subject: { type: 'STRING' }, body: { type: 'STRING' } },
      required: ['subject', 'body'],
    },
  },
};

return [{ json: { geminiBody, model: cfg.gemini_model } }];
