/**
 * app/api/chat/route.ts
 *
 * POST /api/chat
 *
 * Streams a response using the Vercel AI SDK streamText.
 * Tools:
 *   - prepareInvoice   (draft-only — the user must Confirm before anything hits PayPal)
 *   - listInvoices     (read-only)
 *   - findOverdue      (read-only)
 *   - cashflowSummary  (read-only)
 *   - setGridFilter    (read-only, UI-side effect)
 *
 * GUARDRAIL: This route never creates, sends, reminds, or pays anything.
 * Money actions happen in POST /api/invoices, triggered by the UI.
 */

import { streamText, tool } from "ai";
import { z } from "zod";
import { getModel } from "@/lib/ai-provider";
import { InvoiceDraftSchema } from "@/lib/schemas";
import { readTools } from "@/lib/tools";
import { getClientIp, checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

export const maxDuration = 30; // Vercel function timeout

const SYSTEM_PROMPT = `You are PayPilot, an accounts-receivable assistant for freelancers and small businesses.
Your job is to help the user create USD invoices and understand their receivables.

TOOLS (all read-only or draft-only):
- prepareInvoice: extract invoice details for user review (draft only — never creates or sends)
- draftReminder: draft a payment reminder card for user review with a tone (friendly, neutral, or firm) (draft only — never sends)
- listInvoices: list invoices, optionally filtered by status, client, or amount
- findOverdue: list overdue invoices sorted worst-first (most days late first)
- cashflowSummary: outstanding / overdue / paid totals across all invoices
- setGridFilter: filter the invoice grid on screen (UI-side only — no data change)

INVOICE & REMINDER DRAFTING RULES:
1. You NEVER send invoices or reminders yourself — you only prepare drafts for the user to review and approve.
2. If clientName, clientEmail, or at least one item with a name and amount is missing, do NOT call prepareInvoice. Ask a short clarifying question instead.
3. When the user asks to remind someone or send a reminder, find the invoice ID first (using findOverdue or listInvoices if needed), then call draftReminder with the appropriate tone (friendly, neutral, or firm). Always pass the PayPal invoice id (INV2-...) returned by the tools to draftReminder, not just the invoice number.
4. Never invent or guess a client's email address. If it is not provided, ask for it.
5. Never invent amounts. If the amount is ambiguous, ask the user to confirm.
6. Currency is always USD. Do not ask about currency.
7. dueInDays defaults to 14 if the user does not specify.

ANSWER RULES (for read tools):
- Always call a tool first; never answer from memory or guess amounts, statuses, or client names.
- Lead with the direct answer, then a short bulleted list if more than one item.
- If no invoices match, say so plainly: "No invoices match that filter."
- Never fabricate invoice IDs, amounts, or client names.
- Be concise — one sentence of context, then the data.
- After calling prepareInvoice or draftReminder, write a brief confirmation: "Here is your draft — please review and confirm when ready."`;

export async function POST(req: Request) {
  // 1. Abuse protection: IP rate limiting
  const ip = getClientIp(req);
  const rateCheck = checkRateLimit("chat", ip, RATE_LIMITS.chat);
  if (!rateCheck.allowed) {
    const retrySec = Math.ceil(rateCheck.resetMs / 1000);
    return new Response(
      JSON.stringify({
        error: `Too many chat requests. Please wait ${retrySec}s before sending another message.`,
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(retrySec),
        },
      }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (
    !body ||
    typeof body !== "object" ||
    !Array.isArray((body as Record<string, unknown>).messages)
  ) {
    return new Response(JSON.stringify({ error: "messages array required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { messages } = body as { messages: Array<{ role: string; content?: string }> };

  // 2. Abuse protection: Conversation length & message size limits
  if (messages.length > 50) {
    return new Response(
      JSON.stringify({
        error: "Conversation history too long (max 50 messages). Please clear or reset.",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const lastUserMsg = messages[messages.length - 1];
  if (
    lastUserMsg?.content &&
    typeof lastUserMsg.content === "string" &&
    lastUserMsg.content.length > 2500
  ) {
    return new Response(
      JSON.stringify({
        error: "Message exceeds maximum allowed length of 2500 characters.",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  let model;
  try {
    model = getModel();
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const result = streamText({
    model,
    system: SYSTEM_PROMPT,
    messages: messages as Parameters<typeof streamText>[0]["messages"],
    maxSteps: 3, // tool call → result → summary
    maxTokens: 1000, // Abuse protection: limit token generation per request
    tools: {
      prepareInvoice: tool({
        description:
          "Extract and validate invoice details from the user's message. " +
          "Call ONLY when clientName, clientEmail, and at least one item with name and amount are known. " +
          "Returns the validated draft for the user to review. Never creates or sends anything.",
        parameters: z.object({
          clientName: z
            .string()
            .min(1)
            .describe("Full name of the client or company"),
          clientEmail: z
            .string()
            .email()
            .describe("Client's email address — required to send the invoice"),
          currency: z.literal("USD").describe("Always USD"),
          items: z
            .array(
              z.object({
                name: z
                  .string()
                  .min(1)
                  .describe("Description of the work or product"),
                quantity: z
                  .number()
                  .positive()
                  .describe("Number of units"),
                unitAmount: z
                  .number()
                  .positive()
                  .describe("Price per unit in USD"),
              })
            )
            .min(1)
            .describe("Line items"),
          dueInDays: z
            .number()
            .int()
            .min(0)
            .max(90)
            .describe("Days until payment is due (0 = due on receipt)"),
          note: z
            .string()
            .max(1000)
            .optional()
            .describe("Optional note to the client"),
        }),
        execute: async (args) => {
          const parsed = InvoiceDraftSchema.safeParse(args);
          if (!parsed.success) {
            return {
              ok: false,
              error: parsed.error.issues.map((i) => i.message).join("; "),
            };
          }
          return { ok: true, draft: parsed.data };
        },
      }),
      // Merge in all read-only tools
      ...readTools,
    },
  });

  return result.toDataStreamResponse();
}
