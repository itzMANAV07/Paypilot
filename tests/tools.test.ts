/**
 * tests/tools.test.ts
 *
 * Unit tests for read-only AI tools in lib/tools.ts:
 *  - listInvoices
 *  - findOverdue
 *  - cashflowSummary
 *  - setGridFilter
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PayPalInvoice } from "../lib/paypal";

const mockInvoices: PayPalInvoice[] = [
  {
    id: "INV2-001",
    status: "SENT",
    detail: {
      invoice_number: "1001",
      currency_code: "USD",
      payment_term: {
        term_type: "DUE_ON_DATE_SPECIFIED",
        due_date: "2020-01-01", // definitely past / overdue
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
    amount: { currency_code: "USD", value: "500.00" },
  },
  {
    id: "INV2-002",
    status: "PAID",
    detail: {
      invoice_number: "1002",
      currency_code: "USD",
      payment_term: {
        term_type: "DUE_ON_DATE_SPECIFIED",
        due_date: "2020-02-01",
      },
    },
    primary_recipients: [
      {
        billing_info: {
          name: { company_name: "Acme Corp" },
          email_address: "billing@acme.com",
        },
      },
    ],
    amount: { currency_code: "USD", value: "1200.00" },
  },
  {
    id: "INV2-003",
    status: "SENT",
    detail: {
      invoice_number: "1003",
      currency_code: "USD",
      payment_term: {
        term_type: "DUE_ON_DATE_SPECIFIED",
        due_date: "2099-12-31", // future / outstanding
      },
    },
    primary_recipients: [
      {
        billing_info: {
          name: { given_name: "Sarah", surname: "Connor" },
          email_address: "sarah@future.com",
        },
      },
    ],
    amount: { currency_code: "USD", value: "300.00" },
  },
  {
    id: "INV2-004",
    status: "SENT",
    detail: {
      invoice_number: "1004",
      currency_code: "USD",
      payment_term: {
        term_type: "DUE_ON_DATE_SPECIFIED",
        due_date: "2019-01-01", // very overdue (older than 1001)
      },
    },
    primary_recipients: [
      {
        billing_info: {
          name: { given_name: "Dave", surname: "Miller" },
          email_address: "dave@example.com",
        },
      },
    ],
    amount: { currency_code: "USD", value: "800.00" },
  },
];

vi.mock("../lib/paypal", () => ({
  listInvoices: vi.fn(async () => mockInvoices),
  getInvoice: vi.fn(async (id: string) => {
    const found = mockInvoices.find((i) => i.id === id);
    if (!found) throw new Error("Invoice not found");
    return found;
  }),
  PayPalError: class extends Error {},
}));

import {
  listInvoicesTool,
  findOverdueTool,
  cashflowSummaryTool,
  setGridFilterTool,
  draftReminderTool,
} from "../lib/tools";

const mockOpts = { toolCallId: "call_1", messages: [] };

describe("lib/tools.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("listInvoicesTool", () => {
    it("returns all invoices when no filter is provided", async () => {
      // Execute the tool
      const result = await listInvoicesTool.execute!({}, mockOpts);
      expect(result.count).toBe(4);
      expect(result.rows).toHaveLength(4);
      expect(result.rows[0].invoiceNumber).toBe("1001");
      expect(result.rows[0].id).toBe("INV2-001");
    });

    it("filters by status", async () => {
      const result = await listInvoicesTool.execute!(
        { status: "PAID" },
        mockOpts
      );
      expect(result.count).toBe(1);
      expect(result.rows[0].invoiceNumber).toBe("1002");
      expect(result.rows[0].status).toBe("PAID");
    });

    it("filters by clientName (case-insensitive substring)", async () => {
      const result = await listInvoicesTool.execute!(
        { clientName: "acme" },
        mockOpts
      );
      expect(result.count).toBe(1);
      expect(result.rows[0].clientName).toBe("Acme Corp");
    });

    it("filters by minAmount and maxAmount", async () => {
      const result = await listInvoicesTool.execute!(
        { minAmount: 400, maxAmount: 800 },
        mockOpts
      );
      // Expected: 1001 (500) and 1004 (800)
      expect(result.count).toBe(2);
      const numbers = result.rows.map((r) => r.invoiceNumber);
      expect(numbers).toContain("1001");
      expect(numbers).toContain("1004");
    });
  });

  describe("findOverdueTool", () => {
    it("returns only overdue invoices, sorted worst (highest daysOverdue) first", async () => {
      const result = await findOverdueTool.execute!({}, mockOpts);
      // Invoices 1004 (2019) and 1001 (2020) are SENT + past due date
      expect(result.count).toBe(2);
      expect(result.rows[0].invoiceNumber).toBe("1004"); // older due date = more days overdue
      expect(result.rows[0].id).toBe("INV2-004");
      expect(result.rows[1].invoiceNumber).toBe("1001");
      expect(result.rows[1].id).toBe("INV2-001");
      expect(result.rows[0].daysOverdue).toBeGreaterThan(result.rows[1].daysOverdue);
    });
  });

  describe("cashflowSummaryTool", () => {
    it("returns correct cashflow breakdown", async () => {
      const result = await cashflowSummaryTool.execute!({}, mockOpts);
      // Overdue: 1001 (500) + 1004 (800) = 1300
      // Outstanding (SENT and not overdue): 1003 (300)
      // Paid: 1002 (1200)
      expect(result.overdue).toBe(1300);
      expect(result.outstanding).toBe(300);
      expect(result.paid).toBe(1200);
      expect(result.totalInvoices).toBe(4);
      expect(result.currency).toBe("USD");
    });
  });

  describe("setGridFilterTool", () => {
    it("returns valid filter spec and human-readable description", async () => {
      const spec = {
        overdueOnly: true,
        minAmount: 200,
        clientName: "Rahul",
      };
      const result = await setGridFilterTool.execute!(spec, mockOpts);
      expect(result.ok).toBe(true);
      expect(result.filterSpec).toEqual(spec);
      expect(result.description).toContain("overdue only");
      expect(result.description).toContain("min $200");
      expect(result.description).toContain("client: Rahul");
    });

    it("handles empty spec cleanly", async () => {
      const result = await setGridFilterTool.execute!({}, mockOpts);
      expect(result.ok).toBe(true);
      expect(result.filterSpec).toEqual({});
      expect(result.description).toBe("all invoices (cleared)");
    });
  });

  describe("draftReminderTool", () => {
    it("drafts a friendly reminder using invoice details", async () => {
      const result = await draftReminderTool.execute!(
        { invoiceId: "INV2-001", tone: "friendly" },
        mockOpts
      );
      expect(result.ok).toBe(true);
      expect(result.draft?.invoiceId).toBe("INV2-001");
      expect(result.draft?.tone).toBe("friendly");
      expect(result.draft?.subject).toContain("Friendly reminder: Invoice #1001");
      expect(result.draft?.note).toContain("Rahul Sharma");
      expect(result.draft?.note).toContain("$500.00");
    });

    it("drafts a neutral reminder", async () => {
      const result = await draftReminderTool.execute!(
        { invoiceId: "INV2-001", tone: "neutral" },
        mockOpts
      );
      expect(result.ok).toBe(true);
      expect(result.draft?.tone).toBe("neutral");
      expect(result.draft?.subject).toContain("Payment Reminder: Invoice #1001");
    });

    it("drafts a firm reminder highlighting overdue status", async () => {
      const result = await draftReminderTool.execute!(
        { invoiceId: "INV2-001", tone: "firm" },
        mockOpts
      );
      expect(result.ok).toBe(true);
      expect(result.draft?.tone).toBe("firm");
      expect(result.draft?.subject).toContain("URGENT / OVERDUE");
      expect(result.draft?.note).toContain("past due");
    });

    it("resolves an invoiceNumber to an INV2-... id", async () => {
      const result = await draftReminderTool.execute!(
        { invoiceId: "1001", tone: "friendly" },
        mockOpts
      );
      expect(result.ok).toBe(true);
      expect(result.draft?.invoiceId).toBe("INV2-001");
      expect(result.draft?.subject).toContain("Invoice #1001");
      expect(result.draft?.note).toContain("Rahul Sharma");
    });

    it("handles non-existent invoice gracefully with fallback text", async () => {
      const result = await draftReminderTool.execute!(
        { invoiceId: "INV2-NONEXISTENT", tone: "friendly" },
        mockOpts
      );
      expect(result.ok).toBe(true);
      expect(result.draft?.invoiceId).toBe("INV2-NONEXISTENT");
      expect(result.draft?.subject).toContain("INV2-NONEXISTENT");
    });
  });
});
