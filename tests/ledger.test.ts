/**
 * tests/ledger.test.ts
 *
 * Unit tests for lib/ledger.ts — normalisation and cashflow computation.
 * Uses mocked PayPal invoice shapes (no network).
 */

import { describe, it, expect } from "vitest";
import { normaliseInvoice, normaliseInvoices, computeCashflow } from "../lib/ledger";
import type { PayPalInvoice } from "../lib/paypal";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TODAY = "2026-11-09";
const PAST = "2026-10-01";   // 39 days before TODAY
const FUTURE = "2026-12-01"; // 22 days after TODAY

function makeInvoice(overrides: Partial<PayPalInvoice> = {}): PayPalInvoice {
  return {
    id: "INV2-TEST-001",
    status: "SENT",
    detail: {
      invoice_number: "1001",
      currency_code: "USD",
      payment_term: {
        term_type: "DUE_ON_DATE_SPECIFIED",
        due_date: FUTURE,
      },
    },
    primary_recipients: [
      {
        billing_info: {
          name: { given_name: "Rahul", surname: "Sharma" },
          email_address: "rahul@example.com",
        },
      },
    ],
    amount: { currency_code: "USD", value: "400.00" },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// normaliseInvoice
// ---------------------------------------------------------------------------

describe("normaliseInvoice", () => {
  it("maps basic fields correctly", () => {
    const row = normaliseInvoice(makeInvoice(), TODAY);
    expect(row.id).toBe("INV2-TEST-001");
    expect(row.invoiceNumber).toBe("1001");
    expect(row.clientName).toBe("Rahul Sharma");
    expect(row.clientEmail).toBe("rahul@example.com");
    expect(row.amount).toBe(400);
    expect(row.currency).toBe("USD");
    expect(row.dueDate).toBe(FUTURE);
    expect(row.status).toBe("SENT");
  });

  it("is NOT overdue when dueDate is in the future", () => {
    const row = normaliseInvoice(makeInvoice({ status: "SENT" }), TODAY);
    expect(row.isOverdue).toBe(false);
    expect(row.daysOverdue).toBe(0);
  });

  it("IS overdue when status=SENT and dueDate is in the past", () => {
    const inv = makeInvoice({
      status: "SENT",
      detail: {
        invoice_number: "1001",
        currency_code: "USD",
        payment_term: { term_type: "DUE_ON_DATE_SPECIFIED", due_date: PAST },
      },
    });
    const row = normaliseInvoice(inv, TODAY);
    expect(row.isOverdue).toBe(true);
    expect(row.daysOverdue).toBeGreaterThan(0);
  });

  it("computes daysOverdue correctly", () => {
    const inv = makeInvoice({
      status: "SENT",
      detail: {
        invoice_number: "1001",
        currency_code: "USD",
        payment_term: { term_type: "DUE_ON_DATE_SPECIFIED", due_date: "2026-11-01" },
      },
    });
    // TODAY = 2026-11-09, dueDate = 2026-11-01 → 8 days overdue
    const row = normaliseInvoice(inv, TODAY);
    expect(row.isOverdue).toBe(true);
    expect(row.daysOverdue).toBe(8);
  });

  it("is NOT overdue when status=PAID even if dueDate is past", () => {
    const inv = makeInvoice({
      status: "PAID",
      detail: {
        invoice_number: "1001",
        currency_code: "USD",
        payment_term: { term_type: "DUE_ON_DATE_SPECIFIED", due_date: PAST },
      },
    });
    const row = normaliseInvoice(inv, TODAY);
    expect(row.isOverdue).toBe(false);
    expect(row.daysOverdue).toBe(0);
  });

  it("is NOT overdue when status=CANCELLED", () => {
    const inv = makeInvoice({
      status: "CANCELLED",
      detail: {
        invoice_number: "1001",
        currency_code: "USD",
        payment_term: { term_type: "DUE_ON_DATE_SPECIFIED", due_date: PAST },
      },
    });
    const row = normaliseInvoice(inv, TODAY);
    expect(row.isOverdue).toBe(false);
  });

  it("is NOT overdue when dueDate is absent", () => {
    const inv = makeInvoice({
      status: "SENT",
      detail: { invoice_number: "1001", currency_code: "USD" },
    });
    const row = normaliseInvoice(inv, TODAY);
    expect(row.isOverdue).toBe(false);
    expect(row.dueDate).toBeUndefined();
  });

  it("handles DRAFT status", () => {
    const row = normaliseInvoice(makeInvoice({ status: "DRAFT" }), TODAY);
    expect(row.status).toBe("DRAFT");
    expect(row.isOverdue).toBe(false);
  });

  it("falls back to id as invoiceNumber when detail is missing", () => {
    const inv = makeInvoice({
      detail: { currency_code: "USD" },
    });
    const row = normaliseInvoice(inv, TODAY);
    expect(row.invoiceNumber).toBe("INV2-TEST-001");
  });

  it("handles missing primary_recipients gracefully", () => {
    const inv = makeInvoice({ primary_recipients: undefined });
    const row = normaliseInvoice(inv, TODAY);
    expect(row.clientName).toBe("Unknown");
    expect(row.clientEmail).toBe("");
  });

  it("parses amount value from string to number", () => {
    const inv = makeInvoice({ amount: { currency_code: "USD", value: "1250.75" } });
    const row = normaliseInvoice(inv, TODAY);
    expect(row.amount).toBe(1250.75);
  });

  it("defaults amount to 0 when missing", () => {
    const inv = makeInvoice({ amount: undefined });
    const row = normaliseInvoice(inv, TODAY);
    expect(row.amount).toBe(0);
  });

  it("uses company_name when given_name/surname absent", () => {
    const inv = makeInvoice({
      primary_recipients: [
        {
          billing_info: {
            name: { company_name: "Acme Corp" },
            email_address: "billing@acme.com",
          },
        },
      ],
    });
    const row = normaliseInvoice(inv, TODAY);
    expect(row.clientName).toBe("Acme Corp");
  });
});

// ---------------------------------------------------------------------------
// normaliseInvoices
// ---------------------------------------------------------------------------

describe("normaliseInvoices", () => {
  it("returns an array of LedgerRows", () => {
    const rows = normaliseInvoices([makeInvoice(), makeInvoice({ id: "INV2-002" })], TODAY);
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe("INV2-TEST-001");
    expect(rows[1].id).toBe("INV2-002");
  });

  it("returns empty array for empty input", () => {
    expect(normaliseInvoices([], TODAY)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// computeCashflow
// ---------------------------------------------------------------------------

describe("computeCashflow", () => {
  const rows = [
    // outstanding (SENT, not overdue)
    {
      id: "1", invoiceNumber: "1", clientName: "A", clientEmail: "a@x.com",
      amount: 500, currency: "USD", dueDate: FUTURE,
      status: "SENT", isOverdue: false, daysOverdue: 0,
    },
    // overdue (SENT, past due)
    {
      id: "2", invoiceNumber: "2", clientName: "B", clientEmail: "b@x.com",
      amount: 300, currency: "USD", dueDate: PAST,
      status: "SENT", isOverdue: true, daysOverdue: 39,
    },
    // paid
    {
      id: "3", invoiceNumber: "3", clientName: "C", clientEmail: "c@x.com",
      amount: 1200, currency: "USD", dueDate: PAST,
      status: "PAID", isOverdue: false, daysOverdue: 0,
    },
    // draft — not counted anywhere
    {
      id: "4", invoiceNumber: "4", clientName: "D", clientEmail: "d@x.com",
      amount: 200, currency: "USD", dueDate: undefined,
      status: "DRAFT", isOverdue: false, daysOverdue: 0,
    },
  ];

  it("computes outstanding correctly (SENT, not overdue)", () => {
    const cf = computeCashflow(rows);
    expect(cf.outstanding).toBe(500);
  });

  it("computes overdue correctly (SENT, past due)", () => {
    const cf = computeCashflow(rows);
    expect(cf.overdue).toBe(300);
  });

  it("computes paid correctly (PAID)", () => {
    const cf = computeCashflow(rows);
    expect(cf.paid).toBe(1200);
  });

  it("does not count DRAFT in any bucket", () => {
    const cf = computeCashflow(rows);
    expect(cf.outstanding + cf.overdue + cf.paid).toBe(2000);
  });

  it("returns zeros for empty input", () => {
    const cf = computeCashflow([]);
    expect(cf.outstanding).toBe(0);
    expect(cf.overdue).toBe(0);
    expect(cf.paid).toBe(0);
  });

  it("counts MARKED_AS_PAID in paid bucket", () => {
    const cf = computeCashflow([
      {
        id: "5", invoiceNumber: "5", clientName: "E", clientEmail: "e@x.com",
        amount: 750, currency: "USD", dueDate: PAST,
        status: "MARKED_AS_PAID", isOverdue: false, daysOverdue: 0,
      },
    ]);
    expect(cf.paid).toBe(750);
  });
});

