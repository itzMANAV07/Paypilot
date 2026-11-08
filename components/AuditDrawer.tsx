"use client";

/**
 * components/AuditDrawer.tsx
 *
 * Slide-out drawer displaying the chronological audit trail of all approved actions:
 *  - Invoice creation & dispatch
 *  - Payment reminders sent
 *  - Simulated payments recorded
 *
 * Rules: Never logs secrets. Every entry has a strict human-action origin.
 */

import { useEffect, useState, useCallback } from "react";
import type { AuditEntry, AuditAction } from "@/lib/audit";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  refreshTrigger?: number;
}

const ACTION_LABELS: Record<
  AuditAction,
  { label: string; bg: string; text: string }
> = {
  INVOICE_CREATED_AND_SENT: {
    label: "Invoice Created",
    bg: "bg-blue-100",
    text: "text-blue-800",
  },
  REMINDER_SENT: {
    label: "Reminder Sent",
    bg: "bg-amber-100",
    text: "text-amber-800",
  },
  PAYMENT_SIMULATED: {
    label: "Payment Simulated",
    bg: "bg-emerald-100",
    text: "text-emerald-800",
  },
  INVOICE_CANCELLED: {
    label: "Invoice Cancelled",
    bg: "bg-zinc-100",
    text: "text-zinc-800",
  },
};

export default function AuditDrawer({
  isOpen,
  onClose,
  refreshTrigger,
}: Props) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchLog = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/audit");
      if (res.ok) {
        const data = (await res.json()) as { entries: AuditEntry[] };
        setEntries(data.entries ?? []);
      }
    } catch {
      // Ignore network errors in drawer
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchLog();
    }
  }, [isOpen, refreshTrigger, fetchLog]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30 backdrop-blur-xs transition-opacity">
      {/* Backdrop click to close */}
      <div className="flex-1" onClick={onClose} />

      {/* Drawer panel */}
      <div className="flex w-full max-w-md flex-col bg-white shadow-2xl h-full border-l border-zinc-200 animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 bg-zinc-50">
          <div className="flex items-center gap-2">
            <span className="text-xl">📜</span>
            <div>
              <h2 className="text-sm font-bold text-zinc-900">
                Action Audit Log
              </h2>
              <p className="text-[11px] text-zinc-500">
                Human-approved actions only · Immutable trail
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchLog}
              disabled={loading}
              className="rounded-lg border border-zinc-200 p-1.5 text-xs text-zinc-600 hover:bg-zinc-100 transition-colors cursor-pointer"
              title="Refresh log"
            >
              ↻
            </button>
            <button
              onClick={onClose}
              className="rounded-lg border border-zinc-200 p-1.5 text-xs text-zinc-600 hover:bg-zinc-100 transition-colors cursor-pointer font-bold"
              title="Close drawer"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading && entries.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-xs text-zinc-400">
              Loading audit entries…
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center text-zinc-400 gap-2">
              <span className="text-3xl">📭</span>
              <p className="text-xs">No actions logged yet.</p>
              <p className="text-[11px] text-zinc-400">
                Create an invoice, send a reminder, or simulate a payment to see
                records here.
              </p>
            </div>
          ) : (
            entries.map((entry) => {
              const meta = ACTION_LABELS[entry.action] ?? {
                label: entry.action,
                bg: "bg-zinc-100",
                text: "text-zinc-700",
              };
              const date = new Date(entry.timestamp);

              return (
                <div
                  key={entry.id}
                  className="rounded-xl border border-zinc-200 bg-white p-3 shadow-xs space-y-2 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.bg} ${meta.text}`}
                    >
                      {meta.label}
                    </span>
                    <span className="text-[10px] text-zinc-400">
                      {date.toLocaleDateString()} {date.toLocaleTimeString()}
                    </span>
                  </div>

                  <div className="font-mono text-[11px] text-zinc-600 truncate">
                    Invoice: <span className="font-semibold">{entry.invoiceId}</span>
                  </div>

                  {entry.details && Object.keys(entry.details).length > 0 && (
                    <div className="rounded-lg bg-zinc-50 p-2 font-mono text-[11px] text-zinc-700 space-y-0.5 border border-zinc-100">
                      {Object.entries(entry.details).map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-2">
                          <span className="text-zinc-400">{k}:</span>
                          <span className="truncate max-w-[200px]">
                            {typeof v === "object" ? JSON.stringify(v) : String(v)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-zinc-200 p-3 bg-zinc-50 text-center text-[10px] text-zinc-400">
          {entries.length} recorded event{entries.length !== 1 ? "s" : ""} · Logged to disk & memory
        </div>
      </div>
    </div>
  );
}

