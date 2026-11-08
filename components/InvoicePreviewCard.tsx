"use client";

/**
 * components/InvoicePreviewCard.tsx
 *
 * Rendered by ChatPanel when the LLM calls the `prepareInvoice` tool.
 * Shows all extracted fields as editable inputs.
 * Confirm → POST /api/invoices (never the LLM).
 * Discard → dismisses the card without taking any action.
 */

import { useState } from "react";
import type { InvoiceDraft, InvoiceItem } from "@/lib/schemas";

interface Props {
  initialDraft: InvoiceDraft;
  onDiscard: () => void;
  onConfirmed: (invoiceId: string) => void;
}

export default function InvoicePreviewCard({
  initialDraft,
  onDiscard,
  onConfirmed,
}: Props) {
  const [draft, setDraft] = useState<InvoiceDraft>(initialDraft);
  const [status, setStatus] = useState<
    "idle" | "submitting" | "success" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [invoiceId, setInvoiceId] = useState("");

  // ── Derived ──────────────────────────────────────────────────────────────
  const total = draft.items.reduce(
    (sum, item) => sum + item.quantity * item.unitAmount,
    0
  );

  // ── Handlers ─────────────────────────────────────────────────────────────
  function updateField<K extends keyof InvoiceDraft>(
    key: K,
    value: InvoiceDraft[K]
  ) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function updateItem(index: number, field: keyof InvoiceItem, value: string) {
    setDraft((d) => {
      const items = [...d.items];
      items[index] = {
        ...items[index],
        [field]:
          field === "name"
            ? value
            : Number(value) >= 0
            ? Number(value)
            : items[index][field],
      };
      return { ...d, items };
    });
  }

  function addItem() {
    setDraft((d) => ({
      ...d,
      items: [...d.items, { name: "", quantity: 1, unitAmount: 0 }],
    }));
  }

  function removeItem(index: number) {
    setDraft((d) => ({
      ...d,
      items: d.items.filter((_, i) => i !== index),
    }));
  }

  async function handleConfirm() {
    setStatus("submitting");
    setErrorMsg("");
    try {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = (await res.json()) as {
        invoiceId?: string;
        error?: string;
        issues?: Array<{ field: string; message: string }>;
        warning?: string;
      };
      if (!res.ok) {
        const msg =
          data.issues
            ? data.issues.map((i) => `${i.field}: ${i.message}`).join("; ")
            : data.error ?? "Unknown error";
        setErrorMsg(msg);
        setStatus("error");
        return;
      }
      setInvoiceId(data.invoiceId ?? "");
      setStatus("success");
      onConfirmed(data.invoiceId ?? "");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Network error");
      setStatus("error");
    }
  }

  // ── Success state ─────────────────────────────────────────────────────────
  if (status === "success") {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm">
        <p className="font-semibold text-emerald-700">
          ✅ Invoice sent to {draft.clientEmail}
        </p>
        <p className="mt-1 text-emerald-600">
          PayPal invoice ID: <code className="font-mono">{invoiceId}</code>
        </p>
      </div>
    );
  }

  // ── Editable card ─────────────────────────────────────────────────────────
  return (
    <div className="rounded-xl border border-zinc-200 bg-white shadow-sm text-sm w-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
        <span className="font-semibold text-zinc-800">📄 Invoice Draft</span>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
          Pending Review
        </span>
      </div>

      <div className="space-y-4 p-4">
        {/* Client details */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-1">
              Client Name
            </label>
            <input
              className="w-full rounded-lg border border-zinc-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={draft.clientName}
              onChange={(e) => updateField("clientName", e.target.value)}
              placeholder="Client name"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-1">
              Client Email
            </label>
            <input
              type="email"
              className="w-full rounded-lg border border-zinc-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={draft.clientEmail}
              onChange={(e) => updateField("clientEmail", e.target.value)}
              placeholder="client@example.com"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-1">
              Due in (days)
            </label>
            <input
              type="number"
              min={0}
              max={90}
              className="w-full rounded-lg border border-zinc-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={draft.dueInDays}
              onChange={(e) =>
                updateField("dueInDays", Math.max(0, Math.min(90, Number(e.target.value))))
              }
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-1">
              Currency
            </label>
            <input
              className="w-full rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-1.5 text-sm text-zinc-500"
              value="USD"
              disabled
            />
          </div>
        </div>

        {/* Line items */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-zinc-500">
              Line Items
            </span>
            <button
              onClick={addItem}
              className="text-xs text-blue-600 hover:text-blue-800 font-medium"
            >
              + Add item
            </button>
          </div>
          <div className="space-y-2">
            {draft.items.map((item, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <input
                  className="col-span-5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={item.name}
                  onChange={(e) => updateItem(i, "name", e.target.value)}
                  placeholder="Description"
                />
                <input
                  type="number"
                  min={0.01}
                  step={0.01}
                  className="col-span-2 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-right"
                  value={item.quantity}
                  onChange={(e) => updateItem(i, "quantity", e.target.value)}
                  placeholder="Qty"
                />
                <input
                  type="number"
                  min={0.01}
                  step={0.01}
                  className="col-span-3 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-right"
                  value={item.unitAmount}
                  onChange={(e) =>
                    updateItem(i, "unitAmount", e.target.value)
                  }
                  placeholder="Unit price"
                />
                <span className="col-span-1 text-right text-zinc-600 font-mono text-xs">
                  ${(item.quantity * item.unitAmount).toFixed(2)}
                </span>
                <button
                  onClick={() => removeItem(i)}
                  className="col-span-1 text-zinc-400 hover:text-red-500 text-center"
                  title="Remove item"
                  disabled={draft.items.length === 1}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Total */}
        <div className="flex justify-end border-t border-zinc-100 pt-3">
          <span className="font-semibold text-zinc-800">
            Total:{" "}
            <span className="font-mono text-blue-700">
              ${total.toFixed(2)} USD
            </span>
          </span>
        </div>

        {/* Note */}
        <div>
          <label className="block text-xs font-medium text-zinc-500 mb-1">
            Note to client (optional)
          </label>
          <textarea
            className="w-full rounded-lg border border-zinc-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            rows={2}
            value={draft.note ?? ""}
            onChange={(e) =>
              updateField("note", e.target.value || undefined)
            }
            placeholder="Thank you for your business!"
          />
        </div>

        {/* Error */}
        {status === "error" && (
          <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
            ❌ {errorMsg}
          </p>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={handleConfirm}
            disabled={status === "submitting"}
            className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {status === "submitting" ? "Sending…" : "✓ Confirm & Send Invoice"}
          </button>
          <button
            onClick={onDiscard}
            disabled={status === "submitting"}
            className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 transition-colors"
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}

