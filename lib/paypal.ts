/**
 * lib/paypal.ts
 *
 * Thin, typed client for the PayPal Invoicing v2 REST API.
 *
 * Schemas verified against:
 *   https://developer.paypal.com/docs/api/invoicing/v2/
 *
 * Design decisions:
 * - OAuth token is cached in memory and refreshed ~60 s before expiry.
 * - `paypalFetch` surfaces PayPal's error body on non-2xx responses.
 * - Money values are strings per the PayPal spec ("400.00").
 * - Invoice ID is obtained via `Prefer: return=representation` header
 *   so we get the full JSON body (including `id`) rather than parsing a URL.
 * - Pagination in `listInvoices` fetches all pages by default (up to a
 *   configurable max) and returns a flat array.
 */

import { env, PAYPAL_BASE_URL } from "./env";

// ---------------------------------------------------------------------------
// Types (inferred from the PayPal v2 Invoicing API spec)
// ---------------------------------------------------------------------------

export interface PayPalMoney {
  currency_code: string;
  value: string; // string per PayPal spec
}

export interface PayPalInvoiceItem {
  name: string;
  description?: string;
  quantity: string; // string per PayPal spec
  unit_amount: PayPalMoney;
  unit_of_measure?: string;
}

export interface PayPalName {
  given_name?: string;
  surname?: string;
  company_name?: string;
}

export interface PayPalBillingInfo {
  name?: PayPalName;
  email_address: string;
}

export interface PayPalInvoiceDetail {
  invoice_number?: string;
  invoice_date?: string; // YYYY-MM-DD
  currency_code: string;
  note?: string;
  memo?: string;
  payment_term?: {
    term_type:
      | "DUE_ON_RECEIPT"
      | "DUE_ON_DATE_SPECIFIED"
      | "NET_10"
      | "NET_15"
      | "NET_30"
      | "NET_45"
      | "NET_60"
      | "NET_90"
      | "NO_DUE_DATE";
    due_date?: string; // YYYY-MM-DD — required when term_type=DUE_ON_DATE_SPECIFIED
  };
}

export interface PayPalInvoiceBody {
  detail: PayPalInvoiceDetail;
  invoicer?: {
    name?: PayPalName;
    email_address?: string;
  };
  primary_recipients?: Array<{
    billing_info: PayPalBillingInfo;
  }>;
  items?: PayPalInvoiceItem[];
}

export type InvoiceStatus =
  | "DRAFT"
  | "SENT"
  | "UNPAID"
  | "PAID"
  | "MARKED_AS_PAID"
  | "CANCELLED"
  | "REFUNDED"
  | "PARTIALLY_PAID"
  | "PAYMENT_PENDING";

export interface PayPalInvoice extends PayPalInvoiceBody {
  id: string;
  status: InvoiceStatus;
  amount?: PayPalMoney;
}

export interface PayPalInvoiceList {
  total_pages?: number;
  total_items?: number;
  items?: PayPalInvoice[];
}

// ---------------------------------------------------------------------------
// Token cache
// ---------------------------------------------------------------------------

interface TokenCache {
  accessToken: string;
  expiresAt: number; // ms since epoch
}

let tokenCache: TokenCache | null = null;

/** Fetch a fresh OAuth2 client-credentials token and cache it. */
async function fetchAccessToken(): Promise<string> {
  const now = Date.now();
  // Refresh 60 seconds before expiry to avoid edge-case failures
  if (tokenCache && now < tokenCache.expiresAt - 60_000) {
    return tokenCache.accessToken;
  }

  const credentials = Buffer.from(
    `${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`
  ).toString("base64");

  const res = await fetch(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new PayPalError(res.status, "OAUTH_FAILED", body);
  }

  const data = JSON.parse(await res.text()) as {
    access_token: string;
    expires_in: number;
  };

  tokenCache = {
    accessToken: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };

  return tokenCache.accessToken;
}

/** Clears the token cache (useful in tests). */
export function clearTokenCache(): void {
  tokenCache = null;
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class PayPalError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly errorCode: string,
    public readonly details: string
  ) {
    super(`PayPal API error ${statusCode} [${errorCode}]: ${details}`);
    this.name = "PayPalError";
  }
}

// ---------------------------------------------------------------------------
// Core fetch wrapper
// ---------------------------------------------------------------------------

type HttpMethod = "GET" | "POST" | "DELETE" | "PATCH";

interface FetchOptions {
  method?: HttpMethod;
  body?: unknown;
  /** Additional headers merged on top of defaults. */
  headers?: Record<string, string>;
  /** Raw query string (without leading `?`). */
  query?: string;
}

/**
 * Authenticated fetch against the PayPal API.
 * Throws `PayPalError` on any non-2xx response, surfacing PayPal's error body.
 */
export async function paypalFetch<T = unknown>(
  path: string,
  options: FetchOptions = {}
): Promise<T> {
  const token = await fetchAccessToken();
  const url =
    `${PAYPAL_BASE_URL}${path}` + (options.query ? `?${options.query}` : "");

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    // Return the full representation so we get `id` directly in the response
    // body instead of having to parse the Location header.
    "Prefer": "return=representation",
    ...options.headers,
  };

  const res = await fetch(url, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  // 204 No Content — return undefined cast to T
  if (res.status === 204) {
    return undefined as T;
  }

  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }

  if (!res.ok) {
    // Try to extract a PayPal error code from the body
    const errorCode =
      typeof json === "object" && json !== null && "name" in json
        ? String((json as Record<string, unknown>).name)
        : "UNKNOWN";
    throw new PayPalError(res.status, errorCode, text);
  }

  return json as T;
}

// ---------------------------------------------------------------------------
// Invoicing v2 API functions
// ---------------------------------------------------------------------------

/**
 * Create a draft invoice.
 * Uses `Prefer: return=representation` so the response body contains `id`.
 *
 * POST /v2/invoicing/invoices
 */
export async function createDraftInvoice(
  body: PayPalInvoiceBody
): Promise<PayPalInvoice> {
  return paypalFetch<PayPalInvoice>("/v2/invoicing/invoices", {
    method: "POST",
    body,
  });
}

/**
 * Send a draft invoice to the recipient.
 * This triggers the email notification — do NOT call from LLM.
 *
 * POST /v2/invoicing/invoices/{id}/send
 */
export interface SendInvoiceOptions {
  subject?: string;
  note?: string;
  send_to_recipient?: boolean;
  send_to_invoicer?: boolean;
}

export async function sendInvoice(
  invoiceId: string,
  options: SendInvoiceOptions = {}
): Promise<void> {
  await paypalFetch<void>(`/v2/invoicing/invoices/${invoiceId}/send`, {
    method: "POST",
    body: {
      send_to_recipient: options.send_to_recipient ?? true,
      send_to_invoicer: options.send_to_invoicer ?? false,
      ...(options.subject ? { subject: options.subject } : {}),
      ...(options.note ? { note: options.note } : {}),
    },
  });
}

/**
 * List invoices with automatic pagination.
 * Returns all invoices across all pages (up to `maxPages`).
 *
 * GET /v2/invoicing/invoices
 */
export interface ListInvoicesOptions {
  pageSize?: number;
  /** Max number of pages to fetch to avoid runaway pagination. Default: 50. */
  maxPages?: number;
}

export async function listInvoices(
  options: ListInvoicesOptions = {}
): Promise<PayPalInvoice[]> {
  const pageSize = options.pageSize ?? 20;
  const maxPages = options.maxPages ?? 50;
  const all: PayPalInvoice[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const data = await paypalFetch<PayPalInvoiceList>("/v2/invoicing/invoices", {
      query: `page=${page}&page_size=${pageSize}&total_required=true`,
    });

    const items = data.items ?? [];
    all.push(...items);

    // If we got fewer items than the page size, we're on the last page
    if (items.length < pageSize) break;
    // Also stop if PayPal says there are no more pages
    if (data.total_pages !== undefined && page >= data.total_pages) break;
  }

  return all;
}

/**
 * Get a single invoice by ID.
 *
 * GET /v2/invoicing/invoices/{id}
 */
export async function getInvoice(invoiceId: string): Promise<PayPalInvoice> {
  return paypalFetch<PayPalInvoice>(`/v2/invoicing/invoices/${invoiceId}`);
}

/**
 * Send a payment reminder for a sent invoice.
 * PayPal limits this to 2 reminders per invoice per day.
 *
 * POST /v2/invoicing/invoices/{id}/remind
 */
export interface RemindInvoiceOptions {
  subject?: string;
  note?: string;
  send_to_recipient?: boolean;
  send_to_invoicer?: boolean;
}

export async function remindInvoice(
  invoiceId: string,
  options: RemindInvoiceOptions = {}
): Promise<void> {
  await paypalFetch<void>(`/v2/invoicing/invoices/${invoiceId}/remind`, {
    method: "POST",
    body: {
      notification: {
        send_to_recipient: options.send_to_recipient ?? true,
        send_to_invoicer: options.send_to_invoicer ?? false,
        ...(options.subject ? { subject: options.subject } : {}),
        ...(options.note ? { note: options.note } : {}),
      },
    },
  });
}

/**
 * Record an external payment against an invoice (demo / simulate-payment).
 * Marks the invoice PAID when the full amount is recorded.
 *
 * POST /v2/invoicing/invoices/{id}/payments
 */
export type PaymentMethod =
  | "BANK_TRANSFER"
  | "CASH"
  | "CHECK"
  | "CREDIT_CARD"
  | "DEBIT_CARD"
  | "PAYPAL"
  | "WIRE_TRANSFER"
  | "OTHER";

export interface RecordPaymentOptions {
  method: PaymentMethod;
  amount?: PayPalMoney;
  note?: string;
  /** YYYY-MM-DD */
  payment_date?: string;
}

export interface RecordPaymentResponse {
  payment_id: string;
}

export async function recordPayment(
  invoiceId: string,
  options: RecordPaymentOptions
): Promise<RecordPaymentResponse> {
  const today = new Date().toISOString().slice(0, 10);
  return paypalFetch<RecordPaymentResponse>(
    `/v2/invoicing/invoices/${invoiceId}/payments`,
    {
      method: "POST",
      body: {
        method: options.method,
        payment_date: options.payment_date ?? today,
        ...(options.amount ? { amount: options.amount } : {}),
        ...(options.note ? { note: options.note } : {}),
      },
    }
  );
}
