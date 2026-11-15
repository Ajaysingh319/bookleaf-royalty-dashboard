# BookLeaf Royalty Dashboard and Automated Notification System (Assignment 2)

Bubble.io (database, portals, workflows) + n8n Community Edition (automation) + Google Gemini (email wording).
Everything was built on free tiers (budget: 0).

> Confidential assignment material. Please do not share publicly.

## 1. What it does

An admin opens an author in the Bubble app and clicks **Generate royalty summary**. Bubble creates a
Notification Log entry (In Progress), sends the author and their books to an n8n webhook, n8n calculates the
royalty summary with deterministic code, asks Gemini to write the email text from those verified numbers,
validates the result, and replies to Bubble. Bubble then records **Success / Skipped / Failed**, the email text
and any error in the Notification Log.

```
Bubble button -> API Connector POST -> (Cloudflare quick tunnel, HTTPS) -> n8n webhook
   X-BookLeaf-Secret header check
   -> Validate Request -> Duplicate Guard -> Calculate (JS, no AI) -> Build Prompt
   -> Gemini (HTTP) -> Compose Email (verify AI output, else fallback template)
   -> Respond to webhook {status, summary_text, error, execution_id}
Bubble workflow: update Notification Log from the reply (Success / Skipped / Failed + Timestamp)
```

## 2. Important constraint found while building: Bubble Free plan and APIs

The brief suggests n8n may read data from Bubble's Data API and call back to Bubble. On the Free plan Bubble
**does not expose its Data API or Workflow API** to outside callers: a real call from n8n returned
`401 ... This application does not expose an API. Please upgrade your Bubble subscription for your API calls to run.`
(The settings page lets you tick the boxes, but calls are rejected.) Since the brief says a paid plan is not required,
the design was changed (the brief allows either "query the Bubble Data API" or "receive the full payload in the webhook"):

- **Data retrieval:** Bubble sends the author and all their books **in the webhook payload** (built in Bubble with
  `:formatted as text`). n8n does not need any Bubble token, so no Bubble secret exists outside Bubble.
- **Callback / status update:** instead of a separate n8n -> Bubble API call, n8n returns the result in the
  **synchronous HTTP response** and Bubble writes the Notification Log itself. If you have a paid Bubble plan, the
  reply fields (`status`, `summary_text`, `error`) can be PATCHed through the Data API instead with no other change.
- The app is therefore demonstrated on the **development version** (`/version-test/`); Bubble's Free plan shows
  "Upgrade to deploy" for the live version.

## 3. Repository contents

| File | Purpose |
|---|---|
| `n8n-workflow.json` | Importable n8n workflow (16 nodes, no secrets) |
| `code/*.js` | The JavaScript used inside the n8n Code nodes, readable on its own |
| `tests/test-local.js` | MOCK tests of the Code nodes against the real dataset (no network) |
| `tests/send-test.js` | Sends a real request, built from the dataset, to a running n8n |
| `tests/build-workflow.js` | Rebuilds `n8n-workflow.json` from `code/*.js` |

## 4. Bubble database (existing app, reused)

Types: **Author** (Author Id, Name, Email, Phone, City, Joined Date, Currency, Role, linked Account/User),
**Book** (Author, Book ID, Title, ISBN, Genre, Publication, Status, MRP, Author royalty per copy, Copies sold,
Royalty earned/paid/pending, Last payout, Payout due, Print partner, Platforms), **Notification Log**
(Author, Batch, Requested by, Status, Summary, Error, Timestamp, Trigger), plus Payout, Batch and User.
Authors own books (one-to-many); logs reference an author. Privacy rules are applied to every data type;
role-based pages route Authors and Admins to their own portal. Royalty figures are stored exactly as supplied
(no recalculation in Bubble) so the dataset stays queryable and linked.

## 5. n8n workflow

1. **Webhook** (POST `/webhook/bookleaf-royalty-summary`), Header Auth credential. A wrong or missing secret returns 403.
2. **Validate Request**: author id format `AUTH###`, author name, `books` is a list. Invalid -> HTTP 400.
3. **Duplicate Guard** (idempotency): the same author (or same request_id) inside 60 seconds is ignored and answered
   with `duplicate_ignored`; Bubble records it as Skipped and creates no second email. State lives in n8n workflow static data.
4. **Calculate** (Code): validates numbers (no NaN/negative/text), works in integer paise, keeps supplied figures unchanged,
   sums totals, warns if pending != earned - paid or earned != copies x rate, assigns the royalty badge and next-payout date.
5. **Build Prompt + Gemini**: the AI receives only the verified figures (as pre-formatted text) and writes the wording.
6. **Compose Email**: rejects the AI output if it is not valid JSON, quotes any rupee amount not in the verified data,
   omits the author's name, a published book's title or the pending total. On any problem (or if the AI call fails or times
   out) a deterministic **fallback template** is used, so a notification is always produced. The reply says which source
   was used (`email_source: ai | template`) and why.
7. **Respond**: JSON with status, execution id, author id, totals, summary text, any AI problem or error.
   Failures anywhere funnel through **Build Failure** and still return a clear error (never silent).

### Royalty status badge (brief A2) and payout timing (brief B)
- Green: nothing pending. Yellow: pending, last payout within 90 days (or never paid but the book is under 90 days old).
  Red: pending and last payout over 90 days ago, or never paid for a published book older than 90 days.
- The brief refers to the "quarterly cycle and 45-day window from the Knowledge Base". The Assignment 1 Knowledge Base
  was not available while building, so this was implemented from that sentence only: royalties for a finished
  calendar quarter are expected within 45 days after quarter end; if that window has already passed, the next quarter's
  window is quoted. **This interpretation should be checked against the Knowledge Base.**
- Books "In Production" are mentioned with their stage and excluded from financial totals.

### AI prompt strategy
System prompt fixes the tone (warm, professional, plain language), forbids inventing or recalculating anything,
requires amounts to be copied exactly, and lists the required sections (greeting, per-book summary, totals,
next payout, paid-up acknowledgement, production updates, closing "Team BookLeaf"). Structured output (JSON schema
with `subject` and `body`) is requested. Model: `gemini-3.5-flash-lite` (free tier). The earlier choice `gemini-2.5-flash` was
rejected by Google (no longer available to new users) and `gemini-3.8-flash` timed out repeatedly, both handled by the
fallback template as designed.

## 6. Security
- Webhook protected by a shared secret header (n8n Header Auth credential). The secret is stored only in n8n and in
  Bubble's API Connector as a **private** header. It is not in this repository.
- Gemini key lives only in an n8n credential. The export contains credential names and ids only.
- n8n runs locally; the public address is a Cloudflare quick tunnel that exposes the n8n port. The editor still needs its
  owner login, but the tunnel URL changes on every restart and exposes more than the webhook; keep it running only during use.
- n8n's execution view shows incoming headers, including the secret, on the local machine. Avoid showing that panel in recordings.

## 7. Setup (Windows, no Docker)
1. Install n8n locally: `npm install --prefix "E:\Development\n8n" n8n@2`
2. Start it: set `N8N_USER_FOLDER=E:\Development\n8n-data`, `N8N_SECURE_COOKIE=false` (plain http://localhost),
   `WEBHOOK_URL=<tunnel url>/`, then run `E:\Development\n8n\node_modules\.bin\n8n.cmd start` (first start takes minutes).
3. Create the owner account, then two Header Auth credentials: `BookLeaf Webhook Secret` (name `X-BookLeaf-Secret`),
   `Gemini API Key` (name `x-goog-api-key`).
4. Import `n8n-workflow.json` (paste it onto the canvas), select the two credentials by name on the Webhook and Gemini
   nodes, save and **Publish**.
5. Start a Cloudflare quick tunnel: `cloudflared tunnel --url http://localhost:5678`; put the printed https address in
   the Bubble API Connector call URL (`/webhook/bookleaf-royalty-summary`) and re-initialize the call.
6. In Bubble (API Connector, collection `n8n`, call `Generate royalty summary`, Use as Action): set the private header
   `X-BookLeaf-Secret` to the same secret.
The laptop, n8n and the tunnel must stay running for the integration to work.

## 8. Test results
Mock tests (`node tests/test-local.js <dataset.json>`, no network): **20/20 passed**. Covers: totals for all 10 real authors
equal the dataset sums; badges; multiple books; a book in production; a never-paid author; a fully paid author; no books;
missing/invalid author id; invalid, negative and missing royalty values; AI failure; AI inventing an amount; AI returning
non-JSON; duplicate guard.

Real integration tests (live n8n + Gemini; the dataset is the supplied one):

| Test | Result |
|---|---|
| Valid author with AI (AUTH005, AUTH006) | Pass: success, `email_source: ai`, totals correct |
| Author with multiple books (AUTH001/002/004/005) | Pass |
| AI failure (model removed -> 404; model timeout 25 s) | Pass: fallback template, figures identical, `ai_problem` reported |
| Wrong webhook secret | Pass: HTTP 403 |
| Malformed request (author id missing) | Pass: HTTP 400 |
| Duplicate request (AUTH006 twice within 2 s) | Pass: second returned `duplicate_ignored` |
| End to end from Bubble (admin, Meera Nair) | Pass: log created, Success, summary text stored |
| Bulk trigger from Bubble (admin, authors with pending royalties) | Pass: 9 of 9 authors processed (AUTH008 has nothing pending and is excluded), 9 Success, 0 Failed; 9 Notification Log entries. 7 emails came from Gemini and 2 (Diya Chatterjee, Kavita Deshmukh) used the fallback template when the AI call did not return a usable result |
| Bubble Data API from n8n | Fail by design on Free plan (401), see section 2 |

Not run against the live system: an author with no books and invalid royalty values (covered by mock tests only) and a
Bubble-side outage test (n8n stopped while a button is pressed).

## 9. Known limitations / honest notes
- **Data entry:** CSV upload is not available on the Free plan, so the dataset was entered by hand. After a field-by-field comparison
  with the supplied JSON, all 18 Book records match (titles, ISBNs, statuses, dates, print partners, platforms, MRP, royalty figures).
  The 10 authors match as well. The Notification Log entries dated 14 Nov 2026 were generated before the last data corrections, so a few
  last-payout dates inside those older emails differ; new runs use the corrected data.
- **Privacy rules:** reviewed in the editor (Admin sees all; an author sees only their own Author, Book and Payout records; Notification
  Log and Batch are admin-only; "everyone else" has no access) and checked live by running the app as author Meera Nair: My Books and
  the dashboard showed only her two books and her own totals (earned 25,295, paid 22,240, pending 3,055), and the author menu has no
  admin links. (Typing an admin page address while signed in as her showed only her own dashboard; this specific check should be
  repeated on camera.)
- **Status badges** in Bubble were rewritten (with Bubble's Agent) to the brief's rule (Fully Paid / Pending / Overdue by the 90-day test).
  The badges read each book's Last payout and Publication dates, so they are only as correct as that data (see the first bullet).
- Bulk runs send authors one after another (about 2 seconds apart) and are subject to Gemini's free-tier limits, so some emails may use the fallback template.
- The Knowledge Base was not available; payout wording follows only the brief's sentence.
- SMTP email delivery (a bonus) was not implemented; the generated email is stored in the Notification Log as the brief allows.
- Duplicate protection lives in n8n memory (resets if n8n restarts) and only within a 60 second window.

## 10. Learning notes
Bubble was new. Key lessons: privacy rules and option sets; the API Connector (cURL import then manual fixes); that API
access is gated on the Free plan and how to design around it; and using Bubble's Agent for repetitive workflow building while
verifying its output against the database.
