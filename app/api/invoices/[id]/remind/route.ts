/**
 * app/api/invoices/[id]/remind/route.ts
 *
 * POST /api/invoices/:id/remind
 *
 * Human-triggered endpoint to send a payment reminder via PayPal Invoicing v2.
 * The LLM never calls this directly.
 * Re-validates inputs with Zod, invokes remindInvoice, and appends to the audit log.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { remindInvoice, PayPalError } from "@/lib/paypal";
import { writeAuditEntry } from "@/lib/audit";
import { getClientIp, checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

const RemindBodySchema = z.object({
  subject: z.string().min(1).max(500).optional(),
  note: z.string().min(1).max(2000).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 1. Abuse protection: IP rate limiting
  const ip = getClientIp(req);
  const rateCheck = checkRateLimit("remindInvoice", ip, RATE_LIMITS.remindInvoice);
  if (!rateCheck.allowed) {
    const retrySec = Math.ceil(rateCheck.resetMs / 1000);
    return NextResponse.json(
      {
        error: `Rate limit reached. Please wait ${retrySec}s before sending another reminder.`,
      },
      {
        status: 429,
        headers: { "Retry-After": String(retrySec) },
      }
    );
  }

  const { id: invoiceId } = await params;

  if (!invoiceId || typeof invoiceId !== "string") {
    return NextResponse.json(
      { error: "Invoice ID is required" },
      { status: 400 }
    );
  }

  let body: unknown = {};
  try {
    const text = await req.text();
    if (text) {
      body = JSON.parse(text);
    }
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = RemindBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Validation error",
        issues: parsed.error.issues.map((i) => i.message),
      },
      { status: 422 }
    );
  }

  const { subject, note } = parsed.data;

  try {
    await remindInvoice(invoiceId, {
      subject,
      note,
      send_to_recipient: true,
      send_to_invoicer: false,
    });

    writeAuditEntry("REMINDER_SENT", invoiceId, {
      subject: subject ?? "Default reminder",
      note: note ?? "",
    });

    return NextResponse.json({ ok: true, invoiceId });
  } catch (err) {
    if (err instanceof PayPalError) {
      // Check for PayPal daily reminder limit (2 per day)
      const isDailyLimit =
        err.statusCode === 422 &&
        (err.errorCode === "REMINDER_ALREADY_SENT" ||
          err.details.toLowerCase().includes("reminder") ||
          err.details.toLowerCase().includes("limit"));

      if (isDailyLimit) {
        return NextResponse.json(
          {
            error:
              "PayPal daily limit reached: You can send at most 2 reminders per invoice per day.",
          },
          { status: 422 }
        );
      }

      return NextResponse.json(
        { error: `PayPal error: ${err.details || err.errorCode}` },
        { status: err.statusCode || 500 }
      );
    }

    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to send reminder" },
      { status: 500 }
    );
  }
}

