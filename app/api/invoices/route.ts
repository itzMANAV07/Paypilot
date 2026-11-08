/**
 * app/api/invoices/route.ts
 *
 * POST /api/invoices  — create and send a PayPal invoice (human-triggered only)
 * GET  /api/invoices  — list all invoices (Phase 3; stub returns [] for now)
 *
 * GUARDRAIL: This route is called by the UI Confirm button. The LLM never
 * calls it directly. All inputs are re-validated with Zod server-side.
 */

import { NextResponse } from "next/server";
import {
  InvoiceDraftSchema,
  draftTotal,
  DEMO_AMOUNT_CAP_USD,
  type CreateInvoiceResponse,
} from "@/lib/schemas";
import { createDraftInvoice, sendInvoice } from "@/lib/paypal";
import { writeAuditEntry } from "@/lib/audit";
import { env } from "@/lib/env";
import { getClientIp, checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

// ---------------------------------------------------------------------------
// POST /api/invoices — create + send
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  // 1. Abuse protection: IP rate limiting
  const ip = getClientIp(req);
  const rateCheck = checkRateLimit("createInvoice", ip, RATE_LIMITS.createInvoice);
  if (!rateCheck.allowed) {
    const retrySec = Math.ceil(rateCheck.resetMs / 1000);
    return NextResponse.json(
      {
        error: `Rate limit reached. Please wait ${retrySec}s before creating another invoice.`,
      },
      {
        status: 429,
        headers: { "Retry-After": String(retrySec) },
      }
    );
  }

  // 2. Parse request body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // 3. Validate with Zod (never trust the client or the LLM)
  const parsed = InvoiceDraftSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        issues: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 422 }
    );
  }

  const draft = parsed.data;

  // 3. Enforce amount cap (server-side guardrail)
  const total = draftTotal(draft);
  if (total > DEMO_AMOUNT_CAP_USD) {
    return NextResponse.json(
      {
        error: `Invoice total $${total.toFixed(2)} exceeds the demo limit of $${DEMO_AMOUNT_CAP_USD.toLocaleString()}. This cap keeps the sandbox safe.`,
      },
      { status: 422 }
    );
  }

  // 4. Compute due date
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + draft.dueInDays);
  const dueDateStr = dueDate.toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  // 5. Build PayPal request body from the validated draft
  const paypalBody = {
    detail: {
      invoice_date: today,
      currency_code: draft.currency,
      ...(draft.note ? { note: draft.note } : {}),
      ...(draft.dueInDays === 0
        ? { payment_term: { term_type: "DUE_ON_RECEIPT" as const } }
        : {
            payment_term: {
              term_type: "DUE_ON_DATE_SPECIFIED" as const,
              due_date: dueDateStr,
            },
          }),
    },
    invoicer: {
      name: { company_name: env.INVOICER_NAME },
      email_address: env.INVOICER_EMAIL,
    },
    primary_recipients: [
      {
        billing_info: {
          name: { given_name: draft.clientName },
          email_address: draft.clientEmail,
        },
      },
    ],
    items: draft.items.map((item) => ({
      name: item.name,
      quantity: String(item.quantity),
      unit_amount: {
        currency_code: draft.currency,
        value: item.unitAmount.toFixed(2),
      },
    })),
  };

  // 6. Create draft invoice on PayPal
  let invoice;
  try {
    invoice = await createDraftInvoice(paypalBody);
  } catch (err) {
    console.error("[/api/invoices POST] createDraftInvoice failed:", err);
    return NextResponse.json(
      { error: "Failed to create invoice on PayPal. Check server logs." },
      { status: 502 }
    );
  }

  // 7. Send the invoice (this triggers the email to the client)
  try {
    await sendInvoice(invoice.id, {
      send_to_recipient: true,
      send_to_invoicer: false,
    });
  } catch (err) {
    console.error("[/api/invoices POST] sendInvoice failed:", err);
    // Invoice was created but not sent — still return the ID with a warning
    return NextResponse.json(
      {
        invoiceId: invoice.id,
        status: invoice.status,
        warning: "Invoice created but could not be sent. Check server logs.",
      },
      { status: 207 }
    );
  }

  // 8. Write audit log (non-blocking — failure here must not fail the request)
  try {
    writeAuditEntry("INVOICE_CREATED_AND_SENT", invoice.id, {
      clientName: draft.clientName,
      clientEmail: draft.clientEmail,
      total,
      currency: draft.currency,
      dueInDays: draft.dueInDays,
      itemCount: draft.items.length,
    });
  } catch (err) {
    console.warn("[/api/invoices POST] audit log write failed:", err);
  }

  const response: CreateInvoiceResponse = {
    invoiceId: invoice.id,
    status: "SENT",
    invoiceNumber: invoice.detail?.invoice_number,
  };

  return NextResponse.json(response, { status: 201 });
}

// ---------------------------------------------------------------------------
// GET /api/invoices — list all invoices as LedgerRow[]
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const { listInvoices } = await import("@/lib/paypal");
    const { normaliseInvoices } = await import("@/lib/ledger");

    const invoices = await listInvoices({ pageSize: 20, maxPages: 50 });
    const rows = normaliseInvoices(invoices);

    return NextResponse.json({ items: rows });
  } catch (err) {
    // Surface a clean error — never expose a stack trace
    const message =
      err instanceof Error ? err.message : "Failed to fetch invoices";
    console.error("[GET /api/invoices]", err);
    return NextResponse.json({ error: message, items: [] }, { status: 502 });
  }
}

