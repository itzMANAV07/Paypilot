/**
 * app/api/invoices/[id]/simulate-payment/route.ts
 *
 * POST /api/invoices/:id/simulate-payment
 *
 * Simulates a client payment using PayPal's record external payment endpoint.
 *
 * GUARDRAIL: Only works when DEMO_MODE=true. Returns 403 Forbidden otherwise.
 * Appends to the audit log upon success.
 */

import { NextResponse } from "next/server";
import { getInvoice, recordPayment, PayPalError } from "@/lib/paypal";
import { writeAuditEntry } from "@/lib/audit";
import { env } from "@/lib/env";
import { getClientIp, checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 1. Abuse protection: IP rate limiting
  const ip = getClientIp(req);
  const rateCheck = checkRateLimit("simulatePayment", ip, RATE_LIMITS.simulatePayment);
  if (!rateCheck.allowed) {
    const retrySec = Math.ceil(rateCheck.resetMs / 1000);
    return NextResponse.json(
      {
        error: `Rate limit reached. Please wait ${retrySec}s before simulating another payment.`,
      },
      {
        status: 429,
        headers: { "Retry-After": String(retrySec) },
      }
    );
  }

  // 2. Guardrail: DEMO_MODE must be enabled
  if (!env.DEMO_MODE) {
    return NextResponse.json(
      { error: "Payment simulation is disabled. Set DEMO_MODE=true to enable." },
      { status: 403 }
    );
  }

  const { id: invoiceId } = await params;

  if (!invoiceId || typeof invoiceId !== "string") {
    return NextResponse.json(
      { error: "Invoice ID is required" },
      { status: 400 }
    );
  }

  try {
    // 2. Fetch invoice to find amount & currency owed
    const invoice = await getInvoice(invoiceId);

    if (invoice.status === "PAID" || invoice.status === "MARKED_AS_PAID") {
      return NextResponse.json(
        { error: `Invoice ${invoiceId} is already paid.` },
        { status: 400 }
      );
    }

    const value = invoice.amount?.value ?? "0.00";
    const currency = invoice.amount?.currency_code ?? invoice.detail?.currency_code ?? "USD";

    // 3. Record payment against invoice
    const result = await recordPayment(invoiceId, {
      method: "OTHER",
      amount: {
        currency_code: currency,
        value,
      },
      note: "Simulated client payment (PayPilot sandbox demo)",
    });

    // 4. Log to audit trail
    writeAuditEntry("PAYMENT_SIMULATED", invoiceId, {
      amount: value,
      currency,
      paymentId: result.payment_id,
      note: "Simulated client payment (demo)",
    });

    return NextResponse.json({
      ok: true,
      invoiceId,
      paymentId: result.payment_id,
      amount: value,
      currency,
    });
  } catch (err) {
    if (err instanceof PayPalError) {
      return NextResponse.json(
        { error: `PayPal error: ${err.details || err.errorCode}` },
        { status: err.statusCode || 500 }
      );
    }

    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to record simulated payment",
      },
      { status: 500 }
    );
  }
}

