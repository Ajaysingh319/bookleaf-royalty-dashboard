// Calculate: deterministic royalty summary. NO AI involved. Supplied Bubble figures are never overwritten;
// they are validated, summed in integer paise (no float drift) and checked for consistency.
const req = $('Duplicate Guard').first().json;
const author = req.author;
const cfg = $('Settings').first().json;
const raw = Array.isArray(req.books) ? req.books : [];

if (raw.length === 0) {
  throw new Error(`No books were sent for ${author.author_id} (${author.name}); nothing to summarise`);
}

const OVERDUE_DAYS = Number(cfg.overdue_days) || 90;
const WINDOW_DAYS = Number(cfg.payout_window_days) || 45;
const now = cfg.today_override ? new Date(cfg.today_override) : new Date();
if (isNaN(now.getTime())) throw new Error('Invalid today_override setting');
const DAY = 86400000;

const norm = (o) => {
  const r = {};
  for (const k of Object.keys(o)) r[k.toLowerCase().replace(/[^a-z0-9]/g, '')] = o[k];
  return r;
};
const pick = (o, ...names) => {
  for (const n of names) if (o[n] !== undefined && o[n] !== null && o[n] !== '') return o[n];
  return null;
};
// Returns null when missing; throws on non-numeric / negative / non-finite values.
const num = (v, field, label) => {
  if (v === null || v === undefined || v === '') return null;
  const x = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
  if (!Number.isFinite(x)) throw new Error(`Invalid ${field} "${v}" for ${label}`);
  if (x < 0) throw new Error(`Negative ${field} (${x}) for ${label}`);
  return x;
};
const cents = (x) => Math.round(x * 100);
const rupees = (c) => c / 100;
const asDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};
const iso = (d) => (d ? d.toISOString().slice(0, 10) : null);

const warnings = [];
const books = [];
let tEarned = 0, tPaid = 0, tPending = 0;

for (const rb of raw) {
  const b = norm(rb);
  const bookId = pick(b, 'bookid') || rb._id;
  const title = pick(b, 'title', 'booktitle', 'name') || '(untitled)';
  const label = `book ${bookId} "${title}"`;
  const status = String(pick(b, 'status') || '').trim();
  const published = /^published/i.test(status);
  const inProduction = /^in production/i.test(status);

  const copies = num(pick(b, 'copiessold', 'totalcopiessold'), 'copies sold', label);
  const rate = num(pick(b, 'authorroyaltypercopy', 'royaltypercopy'), 'royalty per copy', label);
  const mrp = num(pick(b, 'mrp'), 'MRP', label);
  const earned = num(pick(b, 'royaltyearned', 'totalroyaltyearned'), 'royalty earned', label);
  const paid = num(pick(b, 'royaltypaid'), 'royalty paid', label);
  const pending = num(pick(b, 'royaltypending'), 'royalty pending', label);

  if (published && (earned === null || paid === null || pending === null)) {
    throw new Error(`Missing royalty fields (earned/paid/pending) for published ${label}`);
  }
  const eC = cents(earned ?? 0), paC = cents(paid ?? 0), peC = cents(pending ?? 0);

  if (published && earned !== null && paid !== null && pending !== null && eC - paC !== peC) {
    warnings.push(`${label}: pending (${pending}) differs from earned - paid (${rupees(eC - paC)})`);
  }
  if (published && copies !== null && rate !== null && earned !== null && cents(copies * rate) !== eC) {
    warnings.push(`${label}: earned (${earned}) differs from copies x rate (${rupees(cents(copies * rate))})`);
  }

  const pubDate = asDate(pick(b, 'publication', 'publicationdate'));
  const lastPayout = asDate(pick(b, 'lastpayout', 'lastroyaltypayoutdate'));

  // Royalty status badge (brief, A2): Green = nothing pending; Red = pending AND (last payout > 90 days ago,
  // or never paid for a published book older than 90 days); Yellow = pending but within the normal cycle.
  let badge = 'n/a';
  if (published) {
    if (peC === 0) badge = 'green';
    else if (lastPayout) badge = (now - lastPayout) / DAY > OVERDUE_DAYS ? 'red' : 'yellow';
    else badge = pubDate && (now - pubDate) / DAY > OVERDUE_DAYS ? 'red' : 'yellow';
  }

  if (published) { tEarned += eC; tPaid += paC; tPending += peC; }

  books.push({
    book_id: bookId,
    title,
    status,
    published,
    in_production: inProduction,
    genre: pick(b, 'genre'),
    isbn: pick(b, 'isbn'),
    publication_date: iso(pubDate),
    mrp,
    royalty_per_copy: rate,
    copies_sold: copies ?? 0,
    royalty_earned: rupees(eC),
    royalty_paid: rupees(paC),
    royalty_pending: rupees(peC),
    last_payout_date: iso(lastPayout),
    badge,
    platforms: Array.isArray(pick(b, 'platforms')) ? pick(b, 'platforms') : [],
  });
}

if (!books.some((b) => b.published) && !books.some((b) => b.in_production)) {
  throw new Error(`No usable books for ${author.author_id}`);
}
if (tEarned - tPaid !== tPending) {
  warnings.push(`Totals: pending (${rupees(tPending)}) differs from earned - paid (${rupees(tEarned - tPaid)})`);
}

// Payout timing (brief B): payouts are quarterly with a 45-day window. Royalties for a finished quarter are
// expected within 45 days after quarter end; if that window has already passed, the next window applies.
const quarterEnd = (d, offset) => {
  const q = Math.floor(d.getUTCMonth() / 3) + offset;
  const year = d.getUTCFullYear() + Math.floor(q / 4);
  const qi = ((q % 4) + 4) % 4;
  return new Date(Date.UTC(year, qi * 3 + 3, 0));
};
const prevEnd = quarterEnd(now, -1);
const currEnd = quarterEnd(now, 0);
const prevWindowEnd = new Date(prevEnd.getTime() + WINDOW_DAYS * DAY);
const currWindowEnd = new Date(currEnd.getTime() + WINDOW_DAYS * DAY);
const useWindow = prevWindowEnd >= now ? prevWindowEnd : currWindowEnd;
const useQuarterEnd = prevWindowEnd >= now ? prevEnd : currEnd;

const hasPending = tPending > 0;
return [{
  json: {
    author,
    reference_date: iso(now),
    books,
    totals: { earned: rupees(tEarned), paid: rupees(tPaid), pending: rupees(tPending) },
    flags: {
      has_pending: hasPending,
      all_paid: !hasPending && books.some((b) => b.published),
      has_overdue: books.some((b) => b.badge === 'red'),
      in_production_count: books.filter((b) => b.in_production).length,
    },
    next_payout: hasPending ? {
      quarter_end: iso(useQuarterEnd),
      expected_by: iso(useWindow),
    } : null,
    warnings,
  },
}];
