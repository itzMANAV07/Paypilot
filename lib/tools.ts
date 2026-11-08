/**
 * lib/tools.ts
 *
 * Read-only AI SDK tools for the chat route.
 *
 * GUARDRAIL: None of these tools create, send, remind, or pay anything.
 * They only read from PayPal and return data, or return a filter spec for
 * the UI to apply to the AG Grid.
 */

import { tool } from "ai";
import { z } from "zod";
import { listInvoices as paypalListInvoices, getInvoice as paypalGetInvoice } from "./paypal";
import { normaliseInvoices, normaliseInvoice, computeCashflow } from "./ledger";
import type { GridFilterSpec, ReminderDraft } from "./schemas";

// ---------------------------------------------------------------------------
// listInvoices — returns a filtered list of LedgerRows
// ---------------------------------------------------------------------------

export const listInvoicesTool = tool({
  description:
    "List invoices from PayPal, optionally filtered by status, client name, " +
    "or amount range. Use when the user asks to see invoices or find specific ones.",
  parameters: z.object({
    status: z
      .string()
      .optional()
      .describe(
        "Filter by exact PayPal status: DRAFT, SENT, PAID, PARTIALLY_PAID, " +
          "CANCELLED, REFUNDED, MARKED_AS_PAID, PAYMENT_PENDING"
      ),
    clientName: z
      .string()
      .optional()
      .describe("Filter by client name (case-insensitive substring match)"),
    minAmount: z
      .number()
      .optional()
      .describe("Minimum invoice amount in USD (inclusive)"),
    maxAmount: z
      .number()
      .optional()
      .describe("Maximum invoice amount in USD (inclusive)"),
  }),
  execute: async ({ status, clientName, minAmount, maxAmount }) => {
    const raw = await paypalListInvoices();
    let rows = normaliseInvoices(raw);

    if (status) {
      rows = rows.filter((r) => r.status === status);
    }
    if (clientName) {
      const q = clientName.toLowerCase();
      rows = rows.filter((r) => r.clientName.toLowerCase().includes(q));
    }
    if (minAmount !== undefined) {
      rows = rows.filter((r) => r.amount >= minAmount);
    }
    if (maxAmount !== undefined) {
      rows = rows.filter((r) => r.amount <= maxAmount);
    }

    return {
      count: rows.length,
      rows: rows.map((r) => ({
        invoiceNumber: r.invoiceNumber,
        clientName: r.clientName,
        amount: r.amount,
        currency: r.currency,
        status: r.status,
        dueDate: r.dueDate,
        isOverdue: r.isOverdue,
        daysOverdue: r.daysOverdue,
      })),
    };
  },
});

// ---------------------------------------------------------------------------
// findOverdue — overdue invoices sorted worst-first
// ---------------------------------------------------------------------------

export const findOverdueTool = tool({
  description:
    "Find all overdue invoices (sent but past due date), sorted by most overdue first. " +
    "Use when the user asks who hasn't paid, who's late, or which invoices are overdue.",
  parameters: z.object({}),
  execute: async () => {
    const raw = await paypalListInvoices();
    const rows = normaliseInvoices(raw)
      .filter((r) => r.isOverdue)
      .sort((a, b) => b.daysOverdue - a.daysOverdue);

    return {
      count: rows.length,
      rows: rows.map((r) => ({
        invoiceNumber: r.invoiceNumber,
        clientName: r.clientName,
        amount: r.amount,
        currency: r.currency,
        daysOverdue: r.daysOverdue,
        dueDate: r.dueDate,
      })),
    };
  },
});

// ---------------------------------------------------------------------------
// cashflowSummary — outstanding / overdue / paid totals
// ---------------------------------------------------------------------------

export const cashflowSummaryTool = tool({
  description:
    "Return outstanding, overdue, and paid totals across all invoices. " +
    "Use when the user asks about cashflow, how much is owed, or financial summaries.",
  parameters: z.object({}),
  execute: async () => {
    const raw = await paypalListInvoices();
    const rows = normaliseInvoices(raw);
    const summary = computeCashflow(rows);
    return {
      outstanding: summary.outstanding,
      overdue: summary.overdue,
      paid: summary.paid,
      currency: summary.currency,
      totalInvoices: rows.length,
    };
  },
});

// ---------------------------------------------------------------------------
// setGridFilter — returns a filter spec for the UI to apply to the AG Grid
// ---------------------------------------------------------------------------

export const setGridFilterTool = tool({
  description:
    "Filter the invoice grid on screen. Returns a filter spec that the UI applies. " +
    "Use when the user wants to focus the grid on certain invoices (overdue, by client, by amount, by status). " +
    "This does NOT change any data — it only adjusts what the user sees in the grid.",
  parameters: z.object({
    overdueOnly: z
      .boolean()
      .optional()
      .describe("Show only overdue invoices"),
    minAmount: z
      .number()
      .optional()
      .describe("Show only invoices with amount >= this value"),
    maxAmount: z
      .number()
      .optional()
      .describe("Show only invoices with amount <= this value"),
    clientName: z
      .string()
      .optional()
      .describe("Show only invoices for this client (substring match)"),
    status: z
      .string()
      .optional()
      .describe(
        "Show only invoices with this exact status: DRAFT, SENT, PAID, etc."
      ),
  }),
  execute: async (spec) => {
    // Build a human-readable description of the applied filter
    const parts: string[] = [];
    if (spec.overdueOnly) parts.push("overdue only");
    if (spec.clientName) parts.push(`client: ${spec.clientName}`);
    if (spec.status) parts.push(`status: ${spec.status}`);
    if (spec.minAmount !== undefined) parts.push(`min $${spec.minAmount}`);
    if (spec.maxAmount !== undefined) parts.push(`max $${spec.maxAmount}`);

    const description =
      parts.length > 0 ? parts.join(", ") : "all invoices (cleared)";

    const filterSpec: GridFilterSpec = {
      ...(spec.overdueOnly !== undefined && { overdueOnly: spec.overdueOnly }),
      ...(spec.minAmount !== undefined && { minAmount: spec.minAmount }),
      ...(spec.maxAmount !== undefined && { maxAmount: spec.maxAmount }),
      ...(spec.clientName && { clientName: spec.clientName }),
      ...(spec.status && { status: spec.status }),
    };

    return { ok: true, filterSpec, description };
  },
});

// ---------------------------------------------------------------------------
// draftReminder — draft a payment reminder for user review (NO side effects)
// ---------------------------------------------------------------------------

export const draftReminderTool = tool({
  description:
    "Draft a payment reminder for an invoice for user review. " +
    "Has NO side effects — does not send the reminder. Returns an editable draft card. " +
    "Tones: 'friendly' (warm check-in), 'neutral' (standard professional reminder), or 'firm' (strict overdue notice).",
  parameters: z.object({
    invoiceId: z
      .string()
      .min(1)
      .describe("The PayPal invoice ID (e.g. INV2-XXXX-XXXX-XXXX-XXXX)"),
    tone: z
      .enum(["friendly", "neutral", "firm"])
      .default("friendly")
      .describe("Tone of the reminder: friendly, neutral, or firm"),
  }),
  execute: async ({ invoiceId, tone = "friendly" }) => {
    let clientName = "Client";
    let invoiceNumber = invoiceId;
    let amount = "";
    let dueDate = "";
    let daysOverdue = 0;

    try {
      const inv = await paypalGetInvoice(invoiceId);
      const row = normaliseInvoice(inv);
      clientName = row.clientName;
      invoiceNumber = row.invoiceNumber;
      amount = `$${row.amount.toFixed(2)}`;
      dueDate = row.dueDate ?? "";
      daysOverdue = row.daysOverdue;
    } catch {
      // Fallback to basic details if live lookup fails
    }

    const numRef = invoiceNumber ? `#${invoiceNumber}` : "your invoice";
    const amtRef = amount ? ` for ${amount}` : "";
    const dueRef = dueDate ? ` that was due on ${dueDate}` : "";

    let subject = "";
    let note = "";

    switch (tone) {
      case "friendly":
        subject = `Friendly reminder: Invoice ${numRef}`;
        note = `Hi ${clientName}, hope you're having a great week! Just a friendly reminder regarding invoice ${numRef}${amtRef}${dueRef}. Please let us know if you have any questions or when we might expect payment. Thanks so much!`;
        break;

      case "neutral":
        subject = `Payment Reminder: Invoice ${numRef}`;
        note = `Hello ${clientName}, this is a payment reminder for invoice ${numRef}${amtRef}${dueRef}. Please remit payment at your earliest convenience. Thank you.`;
        break;

      case "firm": {
        subject = `URGENT / OVERDUE: Invoice ${numRef} Payment Required`;
        const overduePhrase =
          daysOverdue > 0
            ? `is now ${daysOverdue} days past due`
            : "is past due";
        note = `Dear ${clientName}, invoice ${numRef}${amtRef} ${overduePhrase}${dueRef}. Please process this payment immediately to keep your account current. If payment has already been sent, please disregard this notice.`;
        break;
      }
    }

    const draft: ReminderDraft = {
      invoiceId,
      subject,
      note,
      tone,
    };

    return {
      ok: true,
      draft,
    };
  },
});

// ---------------------------------------------------------------------------
// Exported tool map (merged into chat route alongside prepareInvoice)
// ---------------------------------------------------------------------------

export const readTools = {
  listInvoices: listInvoicesTool,
  findOverdue: findOverdueTool,
  cashflowSummary: cashflowSummaryTool,
  setGridFilter: setGridFilterTool,
  draftReminder: draftReminderTool,
} as const;

