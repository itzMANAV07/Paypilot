/**
 * lib/ledger.ts
 *
 * Normalises raw PayPal invoice objects (from listInvoices / getInvoice)
 * into LedgerRow values for the AG Grid and cashflow cards.
 *
 * Status values confirmed from PayPal Invoicing v2 docs:
 *   DRAFT | SENT | PAID | PARTIALLY_PAID | CANCELLED | REFUNDED
 *   MARKED_AS_PAID | PAYMENT_PENDING
 *
 * "OVERDUE" is NOT a PayPal status. We compute it:
 *   isOverdue = (status === "SENT") && due_date exists && due_date < today (UTC)
 *
 * Response path for client email:
 *   primary_recipients[0].billing_info.email_address
 * Response path for client name:
 *   primary_recipients[0].billing_info.name.given_name + surname
 * Amount:
 *   amount.value (string → number) + amount.currency_code
 * Due date:
 *   detail.payment_term.due_date  (YYYY-MM-DD, only when term_type=DUE_ON_DATE_SPECIFIED)
 */

import type { PayPalInvoice } from "./paypal";
import type { LedgerRow } from "./schemas";

/** Today's date string YYYY-MM-DD in UTC — extracted for testability. */
export function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

/** PayPal statuses where the invoice is awaiting payment. */
const UNPAID_STATUSES = new Set(["SENT", "UNPAID", "PAYMENT_PENDING"]);

/** PayPal statuses treated as "paid" for cashflow totals. */
const PAID_STATUSES = new Set(["PAID", "MARKED_AS_PAID", "PARTIALLY_PAID"]);

/**
 * Derive a display-friendly client name from the billing_info name object.
 * Falls back to email prefix if no name parts are present.
 */
function extractClientName(invoice: PayPalInvoice): string {
  const billingInfo =
    invoice.primary_recipients?.[0]?.billing_info;
  if (!billingInfo) return "Unknown";

  const name = billingInfo.name;
  if (!name) return billingInfo.email_address || "Unknown";

  const given = name.given_name ?? "";
  const surname = name.surname ?? "";
  const company = name.company_name ?? "";

  if (given || surname) return `${given} ${surname}`.trim();
  if (company) return company;
  return billingInfo.email_address || "Unknown";
}

/**
 * Normalise a single PayPal invoice into a LedgerRow.
 * Pass in today's date string (YYYY-MM-DD) for testability.
 */
export function normaliseInvoice(
  invoice: PayPalInvoice,
  today: string = todayUTC()
): LedgerRow {
  const clientEmail =
    invoice.primary_recipients?.[0]?.billing_info?.email_address ?? "";
  const clientName = extractClientName(invoice);

  const amount = parseFloat(invoice.amount?.value ?? "0") || 0;
  const currency = invoice.amount?.currency_code ?? invoice.detail?.currency_code ?? "USD";

  const dueDate = invoice.detail?.payment_term?.due_date ?? undefined;

  const status = invoice.status ?? "DRAFT";

  // Overdue = unpaid status AND due date is in the past
  const isOverdue =
    UNPAID_STATUSES.has(status) &&
    !!dueDate &&
    dueDate < today;

  const daysOverdue =
    isOverdue && dueDate
      ? Math.floor(
          (new Date(today).getTime() - new Date(dueDate).getTime()) /
            (1000 * 60 * 60 * 24)
        )
      : 0;

  return {
    id: invoice.id,
    invoiceNumber: invoice.detail?.invoice_number ?? invoice.id,
    clientName,
    clientEmail,
    amount,
    currency,
    dueDate,
    status,
    isOverdue,
    daysOverdue,
  };
}

/**
 * Normalise an array of PayPal invoices into LedgerRows, newest first.
 */
export function normaliseInvoices(
  invoices: PayPalInvoice[],
  today: string = todayUTC()
): LedgerRow[] {
  return invoices.map((inv) => normaliseInvoice(inv, today));
}

// ---------------------------------------------------------------------------
// Cashflow aggregations (used by CashflowCards)
// ---------------------------------------------------------------------------

export interface CashflowSummary {
  /** Sum of SENT/UNPAID invoices that are NOT overdue */
  outstanding: number;
  /** Sum of overdue invoices */
  overdue: number;
  /** Sum of PAID / MARKED_AS_PAID / PARTIALLY_PAID invoices */
  paid: number;
  currency: string;
}

export function computeCashflow(rows: LedgerRow[]): CashflowSummary {
  let outstanding = 0;
  let overdue = 0;
  let paid = 0;
  let currency = "USD";

  for (const row of rows) {
    if (row.currency) currency = row.currency; // last one wins (all USD in demo)

    if (PAID_STATUSES.has(row.status)) {
      paid += row.amount;
    } else if (row.isOverdue) {
      overdue += row.amount;
    } else if (UNPAID_STATUSES.has(row.status)) {
      outstanding += row.amount;
    }
  }

  return { outstanding, overdue, paid, currency };
}

