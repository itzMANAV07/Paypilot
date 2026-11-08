"use client";

/**
 * components/ReminderCard.tsx
 *
 * Rendered by ChatPanel when the LLM calls the `draftReminder` tool.
 * Shows editable subject and note with tone switcher.
 *
 * Send   → POST /api/invoices/[id]/remind (human-triggered only, never the LLM).
 * Cancel → dismisses the card without taking any action.
 */

import { useState } from "react";
import type { ReminderDraft } from "@/lib/schemas";

interface Props {
  initialDraft: ReminderDraft;
  onDiscard: () => void;
  onSent?: (invoiceId: string) => void;
}

export default function ReminderCard({ initialDraft, onDiscard, onSent }: Props) {
  const [subject, setSubject] = useState(initialDraft.subject);
  const [note, setNote] = useState(initialDraft.note);
  const [tone, setTone] = useState<"friendly" | "neutral" | "firm">(
    initialDraft.tone
  );
  const [status, setStatus] = useState<
    "idle" | "submitting" | "success" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSend() {
    if (!subject.trim() || !note.trim()) {
      setErrorMsg("Subject and note cannot be empty.");
      return;
    }

    setStatus("submitting");
    setErrorMsg("");

    try {
      const res = await fetch(`/api/invoices/${initialDraft.invoiceId}/remind`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, note }),
      });

      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
      };

      if (!res.ok) {
        setErrorMsg(
          data.error ?? "Failed to send reminder. Please try again."
        );
        setStatus("error");
        return;
      }

      setStatus("success");
      onSent?.(initialDraft.invoiceId);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Network error");
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm w-full">
        <p className="font-semibold text-emerald-800">
          ✅ Payment reminder sent!
        </p>
        <p className="mt-1 text-emerald-700 text-xs">
          PayPal invoice ID: <code className="font-mono">{initialDraft.invoiceId}</code>
        </p>
      </div>
    );
  }

  return (
    <div className="w-full rounded-xl border border-zinc-200 bg-white p-4 shadow-sm space-y-3 text-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
        <div className="flex items-center gap-2">
          <span className="text-base">🔔</span>
          <span className="font-semibold text-zinc-800">Payment Reminder Draft</span>
        </div>
        <span className="text-[11px] font-mono text-zinc-400 truncate max-w-[150px]">
          {initialDraft.invoiceId}
        </span>
      </div>

      {/* Tone badge / selector */}
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-zinc-500">Tone:</label>
        <div className="inline-flex rounded-lg border border-zinc-200 p-0.5 text-xs">
          {(["friendly", "neutral", "firm"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTone(t)}
              className={`rounded-md px-2.5 py-1 capitalize transition-colors cursor-pointer ${
                tone === t
                  ? t === "friendly"
                    ? "bg-blue-600 text-white font-medium"
                    : t === "firm"
                    ? "bg-red-600 text-white font-medium"
                    : "bg-zinc-800 text-white font-medium"
                  : "text-zinc-600 hover:text-zinc-900"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Subject */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-zinc-600">Email Subject</label>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          disabled={status === "submitting"}
          className="w-full rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-zinc-50"
        />
      </div>

      {/* Note */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-zinc-600">Message to Client</label>
        <textarea
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={status === "submitting"}
          className="w-full rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-zinc-50 resize-none"
        />
      </div>

      {/* Error message */}
      {errorMsg && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          ⚠️ {errorMsg}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-1 border-t border-zinc-100">
        <button
          type="button"
          onClick={onDiscard}
          disabled={status === "submitting"}
          className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 transition-colors cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSend}
          disabled={status === "submitting"}
          className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors cursor-pointer"
        >
          {status === "submitting" ? "Sending…" : "Send Reminder"}
        </button>
      </div>

      <p className="text-[10px] text-zinc-400 text-center">
        Human confirmation required · PayPal limits to 2 reminders/day
      </p>
    </div>
  );
}

