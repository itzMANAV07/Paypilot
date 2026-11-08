# PayPilot: AI Invoicing & Collections Agent

Project spec and build plan for the **PayPal AI Hackathon** (deadline Nov 13, 2026, 1:30am IST, so **submit by the evening of Nov 12**).

How to use this file: put it in the repo root as `PLAN.md`. Give the IDE agent one phase at a time (Section 9). Do not paste the whole file and say "build everything".

---

## 1. The idea

**PayPilot** is a chat-first AI agent for freelancers and small businesses that handles the full "get paid" loop on PayPal:

1. You type or paste something messy: *"Invoice Rahul $400 for the logo design, due in 14 days"*, or a whole client email or WhatsApp thread.
2. The AI extracts clients, line items, amounts, and dates into a structured **invoice preview**.
3. You review and click **Confirm**. PayPal creates and sends a real sandbox invoice.
4. An **AG Grid ledger** shows every invoice with live status from PayPal.
5. You ask *"Who hasn't paid me?"*. The agent finds overdue invoices, drafts a polite (or firm) reminder, and sends it through PayPal after you approve.

**One-line pitch:** "An AI accounts-receivable assistant that turns a chat message into a PayPal invoice and chases late payers for you, with a human approving every money action."

**Who it's for:** freelancers, agencies, and small shops who lose hours (and money) writing invoices and chasing payments.

**Why it can win:**

| Judging criterion | How PayPilot scores |
|---|---|
| Technological Implementation | Real PayPal Invoicing API lifecycle (create, send, list, remind, record payment, webhooks) plus LLM structured extraction and tool-calling |
| Design | Chat, confirmation card, and data grid in one coherent product, not a tech demo |
| Potential Impact | A concrete, relatable pain point (late payments) with a clear audience |
| Innovation | Human-in-the-loop *agentic* payments: the AI proposes, the human approves, and the money action never runs from LLM output alone |
| Presentation | One end-to-end flow that fits in 2.5 minutes |

**Prize targets (only claim what you actually build):** the overall 1st/2nd/3rd places, Best Use of PayPal + AI, Best Use of Agentic Commerce, Best Use of AG Grid (the ledger), and Best Use of Render (the hosted demo).

---

## 2. Features

### MUST (cut nothing here)
- **M1.** Chat to structured invoice draft (Zod-validated), shown as a preview card.
- **M2.** Confirm button creates and sends the invoice via PayPal Invoicing API (sandbox). The LLM does **not** trigger this call. The UI calls a normal API route.
- **M3.** AG Grid ledger: invoice number, client, amount, due date, status, and days overdue. Sortable, filterable, with status chips.
- **M4.** "Who owes me?" agent query reads live PayPal data and answers in plain language.
- **M5.** AI-drafted reminder, shown for approval, sent via the PayPal remind endpoint.
- **M6.** Demo mode: a "Simulate client payment" button records a payment so the status flips to PAID on camera.
- **M7.** Hosted demo URL on Render with seeded data, plus a README with setup instructions.

### SHOULD
- **S1.** Paste a whole client email or chat thread and extract the invoice from it.
- **S2.** Natural-language grid filtering ("show overdue over $200") where the agent sets the AG Grid filter model.
- **S3.** Cash-flow summary card (outstanding, overdue, paid this month).
- **S4.** Action audit log (who approved what, when).

### STRETCH (only if M1-M7 are polished)
- **X1.** PayPal webhook (`INVOICING.INVOICE.PAID`) updates the grid live. Render gives you the public URL this needs.
- **X2.** Screenshot or photo of a handwritten note to invoice (vision input).
- **X3.** Recurring invoice series.
- **X4.** Wire in PayPal's Agent Toolkit or MCP server for one extra capability (for example, creating an order), so you can honestly say you used PayPal's AI tooling.

---

## 3. Tech stack

| Layer | Choice | Why |
|---|---|---|
| App | **Next.js (App Router) + TypeScript** | One repo for UI and API, easy Render deploy |
| AI | **Vercel AI SDK** (`ai`) with a provider package of your choice | Provider-agnostic tool-calling and structured output; switch models via env var |
| LLM | Any strong tool-calling model (Gemini, Claude, or OpenAI). Pick the current model name from the provider docs | Don't hard-code a model name; read it from `LLM_MODEL` |
| Validation | **Zod** | Invoice schema shared by the LLM output, API routes, and UI |
| Grid | **AG Grid Community** (`ag-grid-react`) | Targets the AG Grid prizes |
| PayPal | Thin custom client for the **Invoicing v2 REST API** (sandbox) | Full control and fewer surprises than a wrapper |
| Hosting | **Render** (Web Service) | Public URL for judges, webhooks, Render prize |
| Tests | Vitest for the PayPal client and schema | Shows engineering quality |

Why a custom PayPal client instead of the Agent Toolkit: the Invoicing endpoints are well documented, and a thin typed client is fastest to debug in 3 days. Add the toolkit or MCP as stretch X4.

---

## 4. Architecture

```
Browser (Next.js UI)
 ├─ ChatPanel ──────────► POST /api/chat        (streamText + tools; read-only + "prepare" tools)
 ├─ InvoicePreviewCard ─► POST /api/invoices    (create + send; called by UI on Confirm, NOT by the LLM)
 ├─ InvoiceGrid (AG Grid)► GET  /api/invoices   (live list from PayPal)
 ├─ ReminderCard ───────► POST /api/invoices/:id/remind   (on Confirm)
 └─ DemoControls ───────► POST /api/invoices/:id/simulate-payment  (DEMO_MODE only)

Server
 lib/paypal.ts   OAuth token cache + typed fetch wrapper for Invoicing v2
 lib/schemas.ts  Zod: InvoiceDraft, ReminderDraft, LedgerRow
 lib/tools.ts    AI SDK tools (see Section 6)
 lib/ledger.ts   Normalises PayPal invoices to LedgerRow, computes overdue
 lib/audit.ts    In-memory (or JSON file) action log
```

**Key design rule:** the LLM only gets tools that *read* data or *prepare* a draft. Anything that spends, sends, or changes money is a plain API route triggered by a user click. This is the "guardrail" story for your video and your Agentic Commerce pitch.

Suggested folders:

```
/app            page.tsx, api/chat, api/invoices/...
/components     ChatPanel, InvoicePreviewCard, ReminderCard, InvoiceGrid, StatusChip, CashflowCards
/lib            paypal.ts, schemas.ts, tools.ts, ledger.ts, audit.ts, env.ts
/scripts        smoke-test-paypal.ts, seed-sandbox.ts
/tests          paypal.test.ts, schemas.test.ts, ledger.test.ts
PLAN.md  README.md  LICENSE  .env.example
```

---

## 5. PayPal integration spec (verify against the official docs before coding)

Docs: `https://developer.paypal.com/invoicing/reference` and the Invoicing API v2 reference.

- **Base URL (sandbox):** `https://api-m.sandbox.paypal.com`
- **Auth:** `POST /v1/oauth2/token`, Basic auth (`client_id:secret`), body `grant_type=client_credentials`. Cache the token until shortly before it expires.
- **Endpoints you will use:**

| Action | Endpoint |
|---|---|
| Create draft invoice | `POST /v2/invoicing/invoices` |
| Send invoice | `POST /v2/invoicing/invoices/{id}/send` |
| List invoices | `GET /v2/invoicing/invoices` (paginated) |
| Show invoice details | `GET /v2/invoicing/invoices/{id}` |
| Send reminder | `POST /v2/invoicing/invoices/{id}/remind` (max 2 per invoice per day) |
| Record payment (demo) | `POST /v2/invoicing/invoices/{id}/payments` |
| Cancel sent invoice | `POST /v2/invoicing/invoices/{id}/cancel` |
| Search | `POST /v2/invoicing/search-invoices` |

- Creating a draft does **not** notify the customer. Notification happens on `/send`.
- Money values are **strings** (`"400.00"`) with `currency_code`.
- The create call returns a link; **parse the invoice id from the returned `href`** (confirm the response shape in the docs).
- Use `DUE_ON_DATE_SPECIFIED` with a computed `due_date` (verify the allowed `term_type` enums).
- "Overdue" is probably not a PayPal status. Compute it: status is SENT/UNPAID and `due_date < today`.
- The "record payment" endpoint records an *external* payment. In the demo, label it honestly as "Simulated payment (sandbox)".

---

## 6. AI agent design

**System prompt (core idea):** You are PayPilot, an accounts-receivable assistant. You never send invoices or reminders yourself. You prepare drafts for the user to approve. Always ask a clarifying question if the client, amount, or currency is missing. Never invent amounts or emails.

**Tools the LLM can call:**

| Tool | Side effects? | Purpose |
|---|---|---|
| `prepareInvoice(text)` | None | Extract an `InvoiceDraft` and return it for the preview card |
| `listInvoices(filter?)` | Read-only | Fetch from PayPal |
| `findOverdue()` | Read-only | Overdue invoices with days late |
| `cashflowSummary()` | Read-only | Outstanding, overdue, paid totals |
| `draftReminder(invoiceId, tone)` | None | Write a reminder subject and note; returns a `ReminderDraft` for approval |
| `setGridFilter(filterSpec)` | UI only | Natural-language grid filtering (SHOULD) |

**Not tools:** create/send invoice, send reminder, simulate payment. Those are UI-triggered API routes.

**Zod schema sketch (`lib/schemas.ts`):**

```ts
export const InvoiceDraft = z.object({
  clientName: z.string().min(1),
  clientEmail: z.string().email(),
  currency: z.literal("USD"),            // keep USD for the sandbox demo
  items: z.array(z.object({
    name: z.string(), quantity: z.number().positive(), unitAmount: z.number().positive()
  })).min(1),
  dueInDays: z.number().int().min(0).max(90),
  note: z.string().optional(),
});
```

**Guardrails (mention these in the video):**
- Human approval on every send and reminder.
- Server-side amount cap (for example, reject any invoice over $5,000 in demo mode).
- Server validates the draft again with Zod. Never trust the client or the LLM.
- Audit log of every approved action.
- `DEMO_MODE` flag gates the simulate-payment route.

---

## 7. Sandbox gotchas (read before Day 1)

- Create a **sandbox Business account** (the invoicer) and a **sandbox Personal account** (the client). Use the personal account's email as the recipient. Sandbox emails don't go to real inboxes.
- Create the REST app under the sandbox business account to get `client_id` and `secret`.
- **Stay on USD.** Other currencies can have account-level restrictions. Verify before using INR.
- The invoice number must be unique. Let PayPal auto-generate it, or add a short random suffix.
- Reminders are limited to 2 per invoice per day. Handle that error in the UI.
- Never commit secrets. Provide `.env.example`:

```
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_ENV=sandbox
INVOICER_NAME=
INVOICER_EMAIL=
LLM_PROVIDER=
LLM_MODEL=
LLM_API_KEY=
DEMO_MODE=true
```

---

## 8. Schedule (about 3 days)

| When | Goal |
|---|---|
| **Day 1 (Nov 9-10)** | Accounts, scaffold, PayPal client working from a script, then draft and send from the UI (Phases 0-2) |
| **Day 2 (Nov 10-11)** | Grid, agent tools, reminders, demo controls (Phases 3-5) |
| **Day 3 (Nov 11-12)** | Deploy, polish, README, tests, video, submit (Phases 6-7) |
| **Buffer** | Submit before the evening of Nov 12. Do not wait for the final hours. |

---

## 9. Step-by-step implementation plan (paste one phase at a time)

### Phase 0: Manual setup (you, about 45 min)
1. Create a PayPal Developer account and log in to the dashboard.
2. Create sandbox Business and Personal accounts, and a REST app. Copy `client_id` and `secret`.
3. Create a **public GitHub repo** with an **MIT license** (the license must show in the repo's About section).
4. Get an LLM API key. Create a Render account.
5. Join the hackathon Discord (links are on the Devpost page).

**Done when:** you have credentials in a local `.env` and an empty repo cloned.

### Phase 1: Scaffold and PayPal client
**Prompt to paste:**
> Read PLAN.md sections 3-7. Scaffold a Next.js App Router + TypeScript project with Tailwind, Zod, Vitest. Create `lib/env.ts` (validated env vars), `lib/paypal.ts` with: OAuth token fetch and in-memory cache, a typed `paypalFetch` wrapper with error handling that surfaces PayPal's error body, and functions `createDraftInvoice`, `sendInvoice`, `listInvoices` (handle pagination), `getInvoice`, `remindInvoice`, `recordPayment`. Before writing request bodies, fetch the official Invoicing v2 docs and follow the exact schema. Add `scripts/smoke-test-paypal.ts` that creates a draft invoice for the sandbox personal account, sends it, then lists invoices and prints the status. Add Vitest tests that mock `fetch`. Do not build any UI yet.

**Done when:** `npx tsx scripts/smoke-test-paypal.ts` creates and sends a real sandbox invoice and prints it in the list.

### Phase 2: Invoice drafting and confirm flow (core loop)
**Prompt:**
> Implement `lib/schemas.ts` (InvoiceDraft per PLAN.md), `POST /api/chat` using the Vercel AI SDK `streamText` with the `prepareInvoice` tool (structured extraction via Zod, provider chosen by `LLM_PROVIDER`/`LLM_MODEL`), and a `POST /api/invoices` route that re-validates the draft, enforces the amount cap, then calls `createDraftInvoice` + `sendInvoice` and writes to the audit log. Build `ChatPanel` and `InvoicePreviewCard` (editable fields, Confirm and Discard). The LLM must never call create or send. Only the Confirm button does, via `/api/invoices`. If required fields are missing, the assistant asks a clarifying question instead of guessing.

**Done when:** typing "Invoice Rahul $400 for logo design, due in 14 days" shows a preview, and clicking Confirm sends a real sandbox invoice.

### Phase 3: AG Grid ledger
**Prompt:**
> Implement `lib/ledger.ts` that normalises PayPal invoices into `LedgerRow` (invoiceNumber, clientName, clientEmail, amount, currency, dueDate, status, daysOverdue, isOverdue). Implement `GET /api/invoices`. Build `InvoiceGrid` with AG Grid Community: sorting, filtering, a `StatusChip` cell renderer (Paid, Sent, Overdue, Draft, Cancelled), currency formatting, row selection, and a refresh button. Add `CashflowCards` (outstanding, overdue, paid) above the grid. Layout: grid on the left or top, chat on the right, responsive on mobile.

**Done when:** invoices created in Phase 2 appear in the grid with correct statuses and overdue highlighting.

### Phase 4: Agent read tools and Q&A
**Prompt:**
> In `lib/tools.ts` add read-only tools `listInvoices`, `findOverdue`, `cashflowSummary` using `lib/ledger.ts`. Update the system prompt per PLAN.md section 6. Ensure the assistant answers questions like "who hasn't paid me?" and "how much is outstanding?" from live data, with concise answers and no invented numbers. Add a `setGridFilter` tool that returns a filter spec the UI applies to AG Grid (overdue only, min amount, client name).

**Done when:** "Who hasn't paid me?" returns the correct overdue list, and "show overdue over $200" filters the grid.

### Phase 5: Reminders and demo controls
**Prompt:**
> Add the `draftReminder(invoiceId, tone)` tool (tones: friendly, neutral, firm). It returns a `ReminderDraft` (subject, note) shown in a `ReminderCard` with Edit, Send, and Cancel. Send calls `POST /api/invoices/:id/remind` (not the LLM). Handle PayPal's 2-per-day limit with a friendly message. Add `POST /api/invoices/:id/simulate-payment` that calls `recordPayment`, enabled only when `DEMO_MODE=true`, plus a "Simulate client payment" button on the grid row labeled "Sandbox demo". Add `lib/audit.ts` and an audit-log drawer in the UI.

**Done when:** you can ask for a reminder, approve it, simulate a payment, and watch the row turn PAID.

### Phase 6: Deploy on Render
**Prompt:**
> Add a `render.yaml` (or document the manual Render Web Service setup: build `npm ci && npm run build`, start `npm start`), health check route, and a seed script that creates 5-6 varied sandbox invoices (some overdue, some paid) so judges see a populated demo. Add basic rate limiting on `/api/chat` and the money routes, and make sure no secrets are exposed to the client bundle.

Then in Render, set the env vars from `.env.example`, deploy, and test the public URL end to end. Stretch X1: add `POST /api/webhooks/paypal` for `INVOICING.INVOICE.PAID`, register it in the sandbox app, and verify the webhook signature before trusting it.

**Done when:** a stranger can open the URL and complete the whole flow without any setup.

### Phase 7: Docs, tests, video, submission
**Prompt:**
> Write a README with: what it does, a architecture diagram (Mermaid), setup steps (PayPal sandbox, env vars, run locally, deploy to Render), which AI model and tools are used and how, the guardrail design, and known limitations. Ensure `LICENSE` (MIT) is present. Run lint, typecheck, and tests, and fix everything. Do not add new features.

Then you (not the IDE):
1. Record the demo video (script in Section 11).
2. Upload to YouTube as **public**, with no copyrighted music.
3. Fill in the Devpost form (Section 10).

---

## 10. Submission checklist (Devpost)

- [ ] Public repo (GitHub/GitLab/Bitbucket) with **LICENSE visible in the About section**
- [ ] Repo has all source and clear setup and run instructions
- [ ] **Hosted demo URL** (Render) works from a fresh browser and a private window
- [ ] Text description of features and functionality
- [ ] List of AI tools and models used, and *how* they are used
- [ ] YouTube demo video, **under 3 minutes**, public, link on the form
- [ ] Video shows the project running (not slides or mockups) and uses no third-party trademarks or copyrighted music
- [ ] PayPal **sandbox** only; no real money, no real secrets in the repo
- [ ] Claim only the sponsor tools you actually integrated

**Devpost description skeleton:** Problem (late and manual invoicing) → Solution (PayPilot) → How it works (chat → draft → approve → PayPal invoice → live ledger → reminders) → Guardrails (human approval, server validation, caps, audit) → Tech stack → What's next.

---

## 11. Demo video script (about 2:30)

| Time | Show | Say |
|---|---|---|
| 0:00-0:20 | Title and the problem | "Freelancers lose hours writing invoices and chasing late payers. PayPilot does it from a chat." |
| 0:20-1:00 | Paste a messy client message, preview card appears, click Confirm | "The AI extracts the invoice. I review it. Nothing is sent until I approve." |
| 1:00-1:25 | Real PayPal sandbox invoice created, appears in the AG Grid ledger | "It's a real PayPal invoice, live in my ledger." |
| 1:25-1:55 | Ask "Who hasn't paid me?", reminder draft appears, approve it | "The agent finds overdue invoices and drafts a reminder. I approve, PayPal sends it." |
| 1:55-2:15 | Click simulate payment, row turns PAID, cash-flow cards update | "When the client pays, the status updates." |
| 2:15-2:30 | Guardrails and tech recap | "The AI proposes. A human approves. PayPal executes. Built with PayPal Invoicing API, an LLM, AG Grid, and Render." |

Tip: record at the end of Day 3 against the **hosted** URL, with seeded data already in place.

---

## 12. Rules for the IDE agent (save as `AGENTS.md` in the repo)

```
- Work on ONE phase at a time from PLAN.md. Do not start the next phase.
- Before writing PayPal request bodies, read the official docs and follow the exact schema. Do not guess field names.
- The LLM must never call a tool that sends, pays, or changes money. Those are UI-triggered API routes.
- Validate all inputs with Zod on the server. Never trust LLM output.
- Never log or expose secrets. All env access goes through lib/env.ts.
- Keep files small and typed. No `any` unless commented.
- After each phase: run typecheck, lint, tests; then summarise what changed and how to verify it manually.
- Prefer boring, working code over clever abstractions. This is a 3-day hackathon.
- If something is ambiguous, ask me one short question instead of guessing.
```