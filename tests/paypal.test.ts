/**
 * tests/paypal.test.ts
 *
 * Unit tests for lib/paypal.ts.
 * All network calls are mocked — no real credentials needed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock env before importing paypal ──────────────────────────────────────
vi.mock("../lib/env", () => ({
  env: {
    PAYPAL_CLIENT_ID: "test-client-id",
    PAYPAL_CLIENT_SECRET: "test-client-secret",
    PAYPAL_ENV: "sandbox",
    INVOICER_NAME: "Test Business",
    INVOICER_EMAIL: "invoicer@example.com",
    DEMO_MODE: false,
  },
  PAYPAL_BASE_URL: "https://api-m.sandbox.paypal.com",
}));

import {
  clearTokenCache,
  createDraftInvoice,
  sendInvoice,
  listInvoices,
  getInvoice,
  remindInvoice,
  recordPayment,
  PayPalError,
} from "../lib/paypal";

// ── Helpers ───────────────────────────────────────────────────────────────

function makeTokenResponse() {
  return {
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({ access_token: "test-token", expires_in: 3600 }),
  } as Response;
}

function makeJsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

function makeErrorResponse(status: number, name: string, message: string) {
  return {
    ok: false,
    status,
    text: async () => JSON.stringify({ name, message }),
  } as Response;
}

function makeNoContentResponse() {
  return {
    ok: true,
    status: 204,
    text: async () => "",
  } as Response;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("paypalFetch / token cache", () => {
  beforeEach(() => {
    clearTokenCache();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches a new token and caches it", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockResolvedValueOnce(makeTokenResponse()) // token
      .mockResolvedValueOnce(
        makeJsonResponse({
          id: "INV2-TEST-001",
          status: "DRAFT",
          detail: { currency_code: "USD" },
        })
      ); // create

    await createDraftInvoice({
      detail: { currency_code: "USD" },
      items: [
        {
          name: "Test",
          quantity: "1",
          unit_amount: { currency_code: "USD", value: "100.00" },
        },
      ],
    });

    // Token was fetched once
    const tokenCall = mockFetch.mock.calls[0];
    expect(tokenCall[0]).toContain("/v1/oauth2/token");
  });

  it("reuses cached token on second call", async () => {
    const mockFetch = vi.mocked(fetch);
    // Token response
    mockFetch.mockResolvedValueOnce(makeTokenResponse());
    // Two API responses
    mockFetch.mockResolvedValue(
      makeJsonResponse({ id: "INV2-TEST-001", status: "DRAFT", detail: { currency_code: "USD" } })
    );

    await createDraftInvoice({ detail: { currency_code: "USD" } });
    await createDraftInvoice({ detail: { currency_code: "USD" } });

    // fetch called 3 times total: 1 token + 2 API calls (token is reused)
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});

describe("createDraftInvoice", () => {
  beforeEach(() => {
    clearTokenCache();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs to /v2/invoicing/invoices and returns the invoice", async () => {
    const mockFetch = vi.mocked(fetch);
    const fakeInvoice = {
      id: "INV2-ABCD-1234",
      status: "DRAFT",
      detail: { currency_code: "USD" },
      amount: { currency_code: "USD", value: "400.00" },
    };
    mockFetch
      .mockResolvedValueOnce(makeTokenResponse())
      .mockResolvedValueOnce(makeJsonResponse(fakeInvoice, 201));

    const result = await createDraftInvoice({
      detail: {
        currency_code: "USD",
        payment_term: { term_type: "DUE_ON_DATE_SPECIFIED", due_date: "2026-12-01" },
      },
      items: [
        {
          name: "Logo Design",
          quantity: "1",
          unit_amount: { currency_code: "USD", value: "400.00" },
        },
      ],
    });

    expect(result.id).toBe("INV2-ABCD-1234");
    expect(result.status).toBe("DRAFT");

    const apiCall = mockFetch.mock.calls[1];
    expect(apiCall[0]).toContain("/v2/invoicing/invoices");
    expect((apiCall[1] as RequestInit).method).toBe("POST");
    // Should include Prefer header
    const headers = (apiCall[1] as RequestInit).headers as Record<string, string>;
    expect(headers["Prefer"]).toBe("return=representation");
  });

  it("throws PayPalError on non-2xx response", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockResolvedValueOnce(makeTokenResponse())
      .mockResolvedValueOnce(
        makeErrorResponse(422, "VALIDATION_ERROR", "Invoice validation failed")
      );

    await expect(
      createDraftInvoice({ detail: { currency_code: "USD" } })
    ).rejects.toThrow(PayPalError);
  });
});

describe("sendInvoice", () => {
  beforeEach(() => {
    clearTokenCache();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs to /v2/invoicing/invoices/{id}/send", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockResolvedValueOnce(makeTokenResponse())
      .mockResolvedValueOnce(makeNoContentResponse());

    await sendInvoice("INV2-TEST-001");

    const apiCall = mockFetch.mock.calls[1];
    expect(apiCall[0]).toContain("/v2/invoicing/invoices/INV2-TEST-001/send");
    expect((apiCall[1] as RequestInit).method).toBe("POST");
  });

  it("returns void on 204", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockResolvedValueOnce(makeTokenResponse())
      .mockResolvedValueOnce(makeNoContentResponse());

    const result = await sendInvoice("INV2-TEST-001");
    expect(result).toBeUndefined();
  });
});

describe("listInvoices", () => {
  beforeEach(() => {
    clearTokenCache();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("fetches all pages and returns flat array", async () => {
    const mockFetch = vi.mocked(fetch);

    const page1 = {
      total_pages: 2,
      total_items: 3,
      items: [
        { id: "INV2-001", status: "SENT", detail: { currency_code: "USD" } },
        { id: "INV2-002", status: "DRAFT", detail: { currency_code: "USD" } },
      ],
    };
    const page2 = {
      total_pages: 2,
      total_items: 3,
      items: [
        { id: "INV2-003", status: "PAID", detail: { currency_code: "USD" } },
      ],
    };

    // Token fetched once and cached; page 2 reuses the cached token.
    mockFetch
      .mockResolvedValueOnce(makeTokenResponse()) // OAuth token
      .mockResolvedValueOnce(makeJsonResponse(page1)) // page 1
      .mockResolvedValueOnce(makeJsonResponse(page2)); // page 2 (cached token)

    // pageSize=2: page1 returns exactly 2 items → not < 2 → continues.
    // page2 returns 1 item < 2 → stops.
    const invoices = await listInvoices({ pageSize: 2 });

    expect(invoices.length).toBe(3);
    expect(invoices.map((i) => i.id)).toEqual(["INV2-001", "INV2-002", "INV2-003"]);
  });

  it("stops at total_pages boundary", async () => {
    const mockFetch = vi.mocked(fetch);

    const page1 = {
      total_pages: 1,
      total_items: 2,
      items: [
        { id: "INV2-001", status: "SENT", detail: { currency_code: "USD" } },
        { id: "INV2-002", status: "DRAFT", detail: { currency_code: "USD" } },
      ],
    };

    mockFetch
      .mockResolvedValueOnce(makeTokenResponse())
      .mockResolvedValueOnce(makeJsonResponse(page1));

    const invoices = await listInvoices({ pageSize: 20 });
    // 2 items < 20 pageSize, so stops after page 1
    expect(invoices.length).toBe(2);
  });

  it("returns empty array when no invoices exist", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockResolvedValueOnce(makeTokenResponse())
      .mockResolvedValueOnce(makeJsonResponse({ total_pages: 0, total_items: 0, items: [] }));

    const invoices = await listInvoices();
    expect(invoices).toEqual([]);
  });
});

describe("getInvoice", () => {
  beforeEach(() => {
    clearTokenCache();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("GETs /v2/invoicing/invoices/{id}", async () => {
    const mockFetch = vi.mocked(fetch);
    const fakeInvoice = {
      id: "INV2-XYZ-999",
      status: "SENT",
      detail: { currency_code: "USD" },
    };
    mockFetch
      .mockResolvedValueOnce(makeTokenResponse())
      .mockResolvedValueOnce(makeJsonResponse(fakeInvoice));

    const result = await getInvoice("INV2-XYZ-999");
    expect(result.id).toBe("INV2-XYZ-999");
    expect(result.status).toBe("SENT");

    const apiCall = mockFetch.mock.calls[1];
    expect(apiCall[0]).toContain("/v2/invoicing/invoices/INV2-XYZ-999");
    expect((apiCall[1] as RequestInit).method).toBe("GET"); // paypalFetch always sets method explicitly
  });
});

describe("remindInvoice", () => {
  beforeEach(() => {
    clearTokenCache();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs to /v2/invoicing/invoices/{id}/remind", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockResolvedValueOnce(makeTokenResponse())
      .mockResolvedValueOnce(makeNoContentResponse());

    await remindInvoice("INV2-TEST-001", {
      subject: "Friendly reminder",
      note: "Just checking in!",
    });

    const apiCall = mockFetch.mock.calls[1];
    expect(apiCall[0]).toContain("/v2/invoicing/invoices/INV2-TEST-001/remind");
    expect((apiCall[1] as RequestInit).method).toBe("POST");

    const body = JSON.parse((apiCall[1] as RequestInit).body as string);
    expect(body.subject).toBe("Friendly reminder");
    expect(body.note).toBe("Just checking in!");
    expect(body.send_to_recipient).toBe(true);
    expect(body.send_to_invoicer).toBe(false);
  });

  it("throws PayPalError on 422 (rate limit hit)", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockResolvedValueOnce(makeTokenResponse())
      .mockResolvedValueOnce(
        makeErrorResponse(422, "REMINDER_ALREADY_SENT", "Max 2 reminders per day")
      );

    await expect(remindInvoice("INV2-TEST-001")).rejects.toThrow(PayPalError);
  });
});

describe("recordPayment", () => {
  beforeEach(() => {
    clearTokenCache();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs to /v2/invoicing/invoices/{id}/payments", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockResolvedValueOnce(makeTokenResponse())
      .mockResolvedValueOnce(
        makeJsonResponse({ payment_id: "PMT-ABC123" }, 200)
      );

    const result = await recordPayment("INV2-TEST-001", {
      method: "OTHER",
      amount: { currency_code: "USD", value: "400.00" },
      note: "Simulated payment (sandbox)",
    });

    expect(result.payment_id).toBe("PMT-ABC123");

    const apiCall = mockFetch.mock.calls[1];
    expect(apiCall[0]).toContain("/v2/invoicing/invoices/INV2-TEST-001/payments");

    const body = JSON.parse((apiCall[1] as RequestInit).body as string);
    expect(body.method).toBe("OTHER");
    expect(body.amount.value).toBe("400.00");
    expect(body.note).toBe("Simulated payment (sandbox)");
  });
});

describe("PayPalError", () => {
  it("has correct name, statusCode, errorCode and message", () => {
    const err = new PayPalError(422, "VALIDATION_ERROR", "some details");
    expect(err.name).toBe("PayPalError");
    expect(err.statusCode).toBe(422);
    expect(err.errorCode).toBe("VALIDATION_ERROR");
    expect(err.message).toContain("422");
    expect(err.message).toContain("VALIDATION_ERROR");
    expect(err instanceof Error).toBe(true);
  });
});
