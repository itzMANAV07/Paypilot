/**
 * lib/schemas.ts
 *
 * Zod schemas shared by:
 *  - LLM tool output (prepareInvoice)
 *  - POST /api/invoices request body validation
 *  - UI InvoicePreviewCard props
 *
 * Keep this file as the single source of truth for shape + validation rules.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// InvoiceDraft — what the LLM extracts and the user edits before confirming
// ---------------------------------------------------------------------------

export const InvoiceItemSchema = z.object({
  name: z.string().min(1, "Item name is required"),
  quantity: z
    .number({ invalid_type_error: "Quantity must be a number" })
    .positive("Quantity must be positive"),
  unitAmount: z
    .number({ invalid_type_error: "Unit amount must be a number" })
    .positive("Unit amount must be positive"),
});

export type InvoiceItem = z.infer<typeof InvoiceItemSchema>;

export const InvoiceDraftSchema = z.object({
  clientName: z.string().min(1, "Client name is required"),
  clientEmail: z
    .string()
    .email("Client email must be a valid email address"),
  currency: z.literal("USD"), // sandbox is USD-only
  items: z
    .array(InvoiceItemSchema)
    .min(1, "At least one line item is required"),
  dueInDays: z
    .number({ invalid_type_error: "Due days must be a number" })
    .int("Due days must be a whole number")
    .min(0, "Due days must be 0 or more")
    .max(90, "Due days must be 90 or fewer"),
  note: z.string().max(1000).optional(),
});

export type InvoiceDraft = z.infer<typeof InvoiceDraftSchema>;

/** Compute total amount for a draft (for the amount cap check). */
export function draftTotal(draft: InvoiceDraft): number {
  return draft.items.reduce(
    (sum, item) => sum + item.quantity * item.unitAmount,
    0
  );
}

// ---------------------------------------------------------------------------
// ReminderDraft — what the LLM drafts for the user to approve before sending
// ---------------------------------------------------------------------------

export const ReminderDraftSchema = z.object({
  invoiceId: z.string().min(1),
  subject: z.string().min(1, "Subject is required"),
  note: z.string().min(1, "Note is required"),
  tone: z.enum(["friendly", "neutral", "firm"]),
});

export type ReminderDraft = z.infer<typeof ReminderDraftSchema>;

// ---------------------------------------------------------------------------
// LedgerRow — normalised view of a PayPal invoice for the AG Grid (Phase 3)
// ---------------------------------------------------------------------------

export const LedgerRowSchema = z.object({
  id: z.string(),
  invoiceNumber: z.string(),
  clientName: z.string(),
  clientEmail: z.string(),
  amount: z.number(),
  currency: z.string(),
  dueDate: z.string().optional(), // ISO date string YYYY-MM-DD
  status: z.string(),
  isOverdue: z.boolean(),
  daysOverdue: z.number(),
});

export type LedgerRow = z.infer<typeof LedgerRowSchema>;

// ---------------------------------------------------------------------------
// API request/response shapes
// ---------------------------------------------------------------------------

/** POST /api/invoices request body */
export const CreateInvoiceRequestSchema = InvoiceDraftSchema;
export type CreateInvoiceRequest = InvoiceDraft;

/** POST /api/invoices response body */
export const CreateInvoiceResponseSchema = z.object({
  invoiceId: z.string(),
  status: z.string(),
  invoiceNumber: z.string().optional(),
});
export type CreateInvoiceResponse = z.infer<typeof CreateInvoiceResponseSchema>;

/** POST /api/chat message shape */
export const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

/** POST /api/chat request body */
export const ChatRequestSchema = z.object({
  messages: z.array(ChatMessageSchema).min(1),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

// ---------------------------------------------------------------------------
// Server-side amount cap (enforced in POST /api/invoices)
// ---------------------------------------------------------------------------

/** Maximum invoice total allowed in demo mode (USD). */
export const DEMO_AMOUNT_CAP_USD = 5_000;

// ---------------------------------------------------------------------------
// GridFilterSpec — filter spec emitted by setGridFilter tool, applied by grid
// ---------------------------------------------------------------------------

export interface GridFilterSpec {
  overdueOnly?: boolean;
  minAmount?: number;
  maxAmount?: number;
  clientName?: string;
  status?: string;
}

export const GridFilterSpecSchema = {
  overdueOnly: { type: "boolean", optional: true },
  minAmount:   { type: "number",  optional: true },
  maxAmount:   { type: "number",  optional: true },
  clientName:  { type: "string",  optional: true },
  status:      { type: "string",  optional: true },
} as const;

