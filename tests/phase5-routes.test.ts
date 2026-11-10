/**
 * tests/phase5-routes.test.ts
 *
 * Unit tests for Phase 5 API routes:
 *  - POST /api/invoices/:id/remind
 *  - POST /api/invoices/:id/simulate-payment
 *  - GET /api/audit
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import path from "path";
import os from "os";
import fs from "fs";

// Mock env
vi.mock("../lib/env", () => ({
  env: {
    DEMO_MODE: true,
    INVOICER_NAME: "PayPilot Merchant",
    INVOICER_EMAIL: "merchant@paypilot.demo",
    PAYPAL_CLIENT_ID: "client-id",
    PAYPAL_CLIENT_SECRET: "client-secret",
    PAYPAL_ENV: "sandbox",
  },
  PAYPAL_BASE_URL: "https://api-m.sandbox.paypal.com",
}));

// Mock paypal client
const mockRemindInvoice = vi.fn();
const mockRecordPayment = vi.fn();
const mockGetInvoice = vi.fn();

vi.mock("../lib/paypal", () => {
  class MockPayPalError extends Error {
    constructor(
      public readonly statusCode: number,
      public readonly errorCode: string,
      public readonly details: string
    ) {
      super(`PayPal error ${statusCode}: ${details}`);
      this.name = "PayPalError";
    }
  }

  return {
    remindInvoice: (...args: unknown[]) => mockRemindInvoice(...args),
    recordPayment: (...args: unknown[]) => mockRecordPayment(...args),
    getInvoice: (...args: unknown[]) => mockGetInvoice(...args),
    PayPalError: MockPayPalError,
  };
});

import { POST as remindHandler } from "../app/api/invoices/[id]/remind/route";
import { POST as simulatePaymentHandler } from "../app/api/invoices/[id]/simulate-payment/route";
import { GET as auditHandler } from "../app/api/audit/route";
import { clearAuditLog, getAuditLog } from "../lib/audit";
import { env } from "../lib/env";
import { PayPalError } from "../lib/paypal";

const testAuditPath = path.join(os.tmpdir(), `paypilot-test-audit-${Date.now()}.json`);

describe("Phase 5 API Routes", () => {
  beforeAll(() => {
    process.env.AUDIT_LOG_PATH = testAuditPath;
  });

  afterAll(() => {
    delete process.env.AUDIT_LOG_PATH;
    try {
      if (fs.existsSync(testAuditPath)) {
        fs.unlinkSync(testAuditPath);
      }
    } catch {
      // Best-effort
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    clearAuditLog();
    (env as { DEMO_MODE: boolean }).DEMO_MODE = true;
  });

  describe("POST /api/invoices/[id]/remind", () => {
    it("successfully sends a reminder and writes to the audit log", async () => {
      mockRemindInvoice.mockResolvedValueOnce(undefined);

      const req = new Request("http://localhost/api/invoices/INV2-123/remind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: "Friendly reminder",
          note: "Please pay when possible.",
        }),
      });

      const res = await remindHandler(req, {
        params: Promise.resolve({ id: "INV2-123" }),
      });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.invoiceId).toBe("INV2-123");

      expect(mockRemindInvoice).toHaveBeenCalledWith("INV2-123", {
        subject: "Friendly reminder",
        note: "Please pay when possible.",
        send_to_recipient: true,
        send_to_invoicer: false,
      });

      // Verify audit log entry
      const log = getAuditLog();
      expect(log).toHaveLength(1);
      expect(log[0].action).toBe("REMINDER_SENT");
      expect(log[0].invoiceId).toBe("INV2-123");
      expect(log[0].details.subject).toBe("Friendly reminder");
    });

    it("surfaces friendly error message when PayPal 2-reminder daily limit is reached", async () => {
      mockRemindInvoice.mockRejectedValueOnce(
        new PayPalError(
          422,
          "REMINDER_ALREADY_SENT",
          "Reminder already sent max 2 times today"
        )
      );

      const req = new Request("http://localhost/api/invoices/INV2-123/remind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: "Hey", note: "Please pay" }),
      });

      const res = await remindHandler(req, {
        params: Promise.resolve({ id: "INV2-123" }),
      });
      const data = await res.json();

      expect(res.status).toBe(422);
      expect(data.error).toContain("PayPal daily limit reached");
      expect(data.error).toContain("at most 2 reminders");
    });
  });

  describe("POST /api/invoices/[id]/simulate-payment", () => {
    it("returns 403 when DEMO_MODE is false", async () => {
      (env as { DEMO_MODE: boolean }).DEMO_MODE = false;

      const req = new Request(
        "http://localhost/api/invoices/INV2-123/simulate-payment",
        { method: "POST" }
      );

      const res = await simulatePaymentHandler(req, {
        params: Promise.resolve({ id: "INV2-123" }),
      });
      const data = await res.json();

      expect(res.status).toBe(403);
      expect(data.error).toContain("DEMO_MODE=true");
      expect(mockRecordPayment).not.toHaveBeenCalled();
    });

    it("records payment, writes to audit log, and returns 200 when DEMO_MODE=true", async () => {
      mockGetInvoice.mockResolvedValueOnce({
        id: "INV2-123",
        status: "SENT",
        amount: { currency_code: "USD", value: "450.00" },
      });
      mockRecordPayment.mockResolvedValueOnce({
        payment_id: "PMT-999-XYZ",
      });

      const req = new Request(
        "http://localhost/api/invoices/INV2-123/simulate-payment",
        { method: "POST" }
      );

      const res = await simulatePaymentHandler(req, {
        params: Promise.resolve({ id: "INV2-123" }),
      });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.paymentId).toBe("PMT-999-XYZ");

      expect(mockRecordPayment).toHaveBeenCalledWith("INV2-123", {
        method: "OTHER",
        amount: { currency_code: "USD", value: "450.00" },
        note: "Simulated client payment (PayPilot sandbox demo)",
      });

      // Verify audit log entry
      const log = getAuditLog();
      expect(log).toHaveLength(1);
      expect(log[0].action).toBe("PAYMENT_SIMULATED");
      expect(log[0].invoiceId).toBe("INV2-123");
      expect(log[0].details.amount).toBe("450.00");
    });

    it("rejects simulation if invoice is already paid", async () => {
      mockGetInvoice.mockResolvedValueOnce({
        id: "INV2-PAID",
        status: "PAID",
        amount: { currency_code: "USD", value: "100.00" },
      });

      const req = new Request(
        "http://localhost/api/invoices/INV2-PAID/simulate-payment",
        { method: "POST" }
      );

      const res = await simulatePaymentHandler(req, {
        params: Promise.resolve({ id: "INV2-PAID" }),
      });
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toContain("already paid");
      expect(mockRecordPayment).not.toHaveBeenCalled();
    });
  });

  describe("GET /api/audit", () => {
    it("returns all audit entries", async () => {
      // Trigger a payment simulation to create an entry
      mockGetInvoice.mockResolvedValueOnce({
        id: "INV2-AUDIT",
        status: "SENT",
        amount: { currency_code: "USD", value: "150.00" },
      });
      mockRecordPayment.mockResolvedValueOnce({ payment_id: "PMT-AUDIT" });

      const postReq = new Request(
        "http://localhost/api/invoices/INV2-AUDIT/simulate-payment",
        { method: "POST" }
      );
      await simulatePaymentHandler(postReq, {
        params: Promise.resolve({ id: "INV2-AUDIT" }),
      });

      const res = await auditHandler();
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(Array.isArray(data.entries)).toBe(true);
      expect(data.entries.length).toBe(1);
      expect(data.entries[0].action).toBe("PAYMENT_SIMULATED");
    });
  });
});

