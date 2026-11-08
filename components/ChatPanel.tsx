"use client";

/**
 * components/ChatPanel.tsx
 *
 * Chat interface using the Vercel AI SDK `useChat` hook.
 * - Streams assistant responses from POST /api/chat
 * - Renders InvoicePreviewCard when the LLM calls `prepareInvoice`
 * - Renders compact readable lists/cards for read-only tools:
 *     - listInvoices
 *     - findOverdue
 *     - cashflowSummary
 *     - setGridFilter
 * - Drives grid filtering via `onFilterChange` when setGridFilter is called.
 * - Never triggers money actions itself — that's the Confirm button's job.
 */

import { useChat } from "ai/react";
import { useRef, useEffect, useState } from "react";
import InvoicePreviewCard from "./InvoicePreviewCard";
import ReminderCard from "./ReminderCard";
import type { InvoiceDraft, ReminderDraft, GridFilterSpec } from "@/lib/schemas";

interface PrepareInvoiceResult {
  ok: boolean;
  draft?: InvoiceDraft;
  error?: string;
}

interface ListInvoicesResult {
  count: number;
  rows: Array<{
    invoiceNumber: string;
    clientName: string;
    amount: number;
    currency: string;
    status: string;
    dueDate?: string;
    isOverdue: boolean;
    daysOverdue: number;
  }>;
}

interface FindOverdueResult {
  count: number;
  rows: Array<{
    invoiceNumber: string;
    clientName: string;
    amount: number;
    currency: string;
    daysOverdue: number;
    dueDate?: string;
  }>;
}

interface CashflowSummaryResult {
  outstanding: number;
  overdue: number;
  paid: number;
  currency: string;
  totalInvoices: number;
}

interface SetGridFilterResult {
  ok: boolean;
  filterSpec: GridFilterSpec;
  description: string;
}

interface Props {
  /** Called after a Confirm & Send succeeds — parent uses this to refresh the grid. */
  onInvoiceCreated?: () => void;
  /** Called when the AI issues a filter command */
  onFilterChange?: (spec: GridFilterSpec | null) => void;
}

function formatUSD(val: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(val || 0);
}

export default function ChatPanel({ onInvoiceCreated, onFilterChange }: Props) {
  const { messages, input, handleInputChange, handleSubmit, isLoading, error } =
    useChat({
      api: "/api/chat",
    });

  // Track discarded tool call IDs so the draft card disappears after Discard
  const [discarded, setDiscarded] = useState<Set<string>>(new Set());
  // Track confirmed tool call IDs (card replaced by success state inside the card)
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  // Track applied filter tool calls to avoid re-triggering parent callbacks
  const [appliedFilters, setAppliedFilters] = useState<Set<string>>(new Set());

  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Handle setGridFilter side-effects
  useEffect(() => {
    for (const msg of messages) {
      if (!msg.toolInvocations) continue;
      for (const inv of msg.toolInvocations) {
        if (
          inv.toolName === "setGridFilter" &&
          inv.state === "result" &&
          !appliedFilters.has(inv.toolCallId)
        ) {
          const res = inv.result as SetGridFilterResult;
          if (res?.ok && res.filterSpec) {
            onFilterChange?.(res.filterSpec);
          }
          setAppliedFilters((prev) => new Set([...prev, inv.toolCallId]));
        }
      }
    }
  }, [messages, appliedFilters, onFilterChange]);

  const suggestions = [
    "Invoice Rahul $400 for logo design, due in 14 days",
    "Who hasn't paid me yet?",
    "How much is currently overdue?",
    "Show overdue invoices in the grid",
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-4 py-12">
            <div className="text-4xl">✈️</div>
            <h2 className="text-xl font-semibold text-zinc-800">
              Welcome to PayPilot
            </h2>
            <p className="text-sm text-zinc-500 max-w-sm">
              Ask about receivables, check overdue accounts, filter your ledger,
              or tell me who to invoice.
            </p>
            <div className="flex flex-col gap-2 w-full max-w-sm mt-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="rounded-lg border border-zinc-200 px-3 py-2 text-xs text-left text-zinc-600 hover:bg-zinc-50 transition-colors cursor-pointer"
                  onClick={() => {
                    const fakeEvent = {
                      target: { value: s },
                    } as React.ChangeEvent<HTMLInputElement>;
                    handleInputChange(fakeEvent);
                    setTimeout(() => {
                      const form = document.getElementById(
                        "chat-form"
                      ) as HTMLFormElement | null;
                      form?.requestSubmit();
                    }, 50);
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${
              message.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            <div
              className={`max-w-[85%] space-y-2 ${
                message.role === "user" ? "items-end" : "items-start"
              } flex flex-col`}
            >
              {/* Text content */}
              {message.content && (
                <div
                  className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                    message.role === "user"
                      ? "bg-blue-600 text-white rounded-br-sm"
                      : "bg-zinc-100 text-zinc-800 rounded-bl-sm"
                  }`}
                >
                  {message.content}
                </div>
              )}

              {/* Tool Invocations */}
              {message.toolInvocations?.map((invocation) => {
                // 1. prepareInvoice (draft card)
                if (invocation.toolName === "prepareInvoice") {
                  if (discarded.has(invocation.toolCallId)) return null;

                  if (invocation.state === "call") {
                    return (
                      <div
                        key={invocation.toolCallId}
                        className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-500 animate-pulse"
                      >
                        Extracting invoice details…
                      </div>
                    );
                  }

                  if (invocation.state === "result") {
                    const result = invocation.result as PrepareInvoiceResult;
                    if (!result.ok || !result.draft) {
                      return (
                        <div
                          key={invocation.toolCallId}
                          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                        >
                          ⚠️ Could not parse invoice:{" "}
                          {result.error ?? "unknown error"}
                        </div>
                      );
                    }

                    if (confirmed.has(invocation.toolCallId)) {
                      return null;
                    }

                    return (
                      <InvoicePreviewCard
                        key={invocation.toolCallId}
                        initialDraft={result.draft}
                        onDiscard={() =>
                          setDiscarded((prev) =>
                            new Set([...prev, invocation.toolCallId])
                          )
                        }
                        onConfirmed={(invoiceId) => {
                          setConfirmed((prev) =>
                            new Set([...prev, invocation.toolCallId])
                          );
                          onInvoiceCreated?.();
                          return invoiceId;
                        }}
                      />
                    );
                  }
                }

                // 2. draftReminder (interactive editable reminder card)
                if (invocation.toolName === "draftReminder") {
                  if (discarded.has(invocation.toolCallId)) return null;

                  if (invocation.state === "call") {
                    return (
                      <div
                        key={invocation.toolCallId}
                        className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-500 animate-pulse"
                      >
                        Drafting payment reminder…
                      </div>
                    );
                  }

                  if (invocation.state === "result") {
                    const result = invocation.result as {
                      ok?: boolean;
                      draft?: ReminderDraft;
                      error?: string;
                    };

                    if (!result.ok || !result.draft) {
                      return (
                        <div
                          key={invocation.toolCallId}
                          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                        >
                          ⚠️ Could not draft reminder:{" "}
                          {result.error ?? "unknown error"}
                        </div>
                      );
                    }

                    if (confirmed.has(invocation.toolCallId)) {
                      return null;
                    }

                    return (
                      <ReminderCard
                        key={invocation.toolCallId}
                        initialDraft={result.draft}
                        onDiscard={() =>
                          setDiscarded((prev) =>
                            new Set([...prev, invocation.toolCallId])
                          )
                        }
                        onSent={(invoiceId) => {
                          setConfirmed((prev) =>
                            new Set([...prev, invocation.toolCallId])
                          );
                          onInvoiceCreated?.();
                        }}
                      />
                    );
                  }
                }

                // 3. listInvoices (compact readable list)
                if (invocation.toolName === "listInvoices") {
                  if (invocation.state === "call") {
                    return (
                      <div
                        key={invocation.toolCallId}
                        className="text-xs text-zinc-400 animate-pulse"
                      >
                        Fetching invoices from PayPal…
                      </div>
                    );
                  }
                  if (invocation.state === "result") {
                    const res = invocation.result as ListInvoicesResult;
                    return (
                      <div
                        key={invocation.toolCallId}
                        className="w-full rounded-xl border border-zinc-200 bg-white p-3 text-xs shadow-sm space-y-2"
                      >
                        <div className="flex items-center justify-between border-b border-zinc-100 pb-1.5 text-zinc-600 font-medium">
                          <span>📋 Invoices ({res.count})</span>
                        </div>
                        {res.count === 0 ? (
                          <p className="text-zinc-400 py-1">No invoices found matching criteria.</p>
                        ) : (
                          <div className="space-y-1.5 max-h-48 overflow-y-auto">
                            {res.rows.map((row) => (
                              <div
                                key={row.invoiceNumber}
                                className="flex items-center justify-between text-zinc-700 py-0.5"
                              >
                                <span className="font-medium truncate max-w-[140px]">
                                  #{row.invoiceNumber} · {row.clientName}
                                </span>
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold">{formatUSD(row.amount)}</span>
                                  <span
                                    className={`rounded px-1.5 py-0.2 text-[10px] font-semibold uppercase ${
                                      row.isOverdue
                                        ? "bg-red-100 text-red-700"
                                        : row.status === "PAID"
                                        ? "bg-emerald-100 text-emerald-700"
                                        : "bg-blue-100 text-blue-700"
                                    }`}
                                  >
                                    {row.isOverdue ? "Overdue" : row.status}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  }
                }

                // 3. findOverdue (overdue list sorted worst first)
                if (invocation.toolName === "findOverdue") {
                  if (invocation.state === "call") {
                    return (
                      <div
                        key={invocation.toolCallId}
                        className="text-xs text-amber-600 animate-pulse"
                      >
                        Scanning for overdue invoices…
                      </div>
                    );
                  }
                  if (invocation.state === "result") {
                    const res = invocation.result as FindOverdueResult;
                    return (
                      <div
                        key={invocation.toolCallId}
                        className="w-full rounded-xl border border-red-200 bg-red-50/50 p-3 text-xs shadow-sm space-y-2"
                      >
                        <div className="flex items-center justify-between border-b border-red-100 pb-1.5 text-red-800 font-semibold">
                          <span>⚠️ Overdue Invoices ({res.count})</span>
                        </div>
                        {res.count === 0 ? (
                          <p className="text-emerald-700 py-1">
                            🎉 No overdue invoices! All payments are up to date.
                          </p>
                        ) : (
                          <div className="space-y-1.5 max-h-48 overflow-y-auto">
                            {res.rows.map((row) => (
                              <div
                                key={row.invoiceNumber}
                                className="flex items-center justify-between text-zinc-800 py-0.5"
                              >
                                <span className="font-medium truncate max-w-[140px]">
                                  #{row.invoiceNumber} · {row.clientName}
                                </span>
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-red-600">
                                    {formatUSD(row.amount)}
                                  </span>
                                  <span className="rounded bg-red-100 text-red-700 px-1.5 py-0.5 text-[10px] font-semibold">
                                    {row.daysOverdue}d late
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  }
                }

                // 4. cashflowSummary (summary cards)
                if (invocation.toolName === "cashflowSummary") {
                  if (invocation.state === "call") {
                    return (
                      <div
                        key={invocation.toolCallId}
                        className="text-xs text-zinc-400 animate-pulse"
                      >
                        Calculating cashflow summary…
                      </div>
                    );
                  }
                  if (invocation.state === "result") {
                    const res = invocation.result as CashflowSummaryResult;
                    return (
                      <div
                        key={invocation.toolCallId}
                        className="w-full rounded-xl border border-zinc-200 bg-white p-3 text-xs shadow-sm space-y-2"
                      >
                        <div className="font-semibold text-zinc-700 border-b border-zinc-100 pb-1">
                          📊 Cashflow Snapshot
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-center pt-1">
                          <div className="rounded-lg bg-blue-50 p-2">
                            <div className="text-[10px] uppercase font-semibold text-blue-600">
                              Outstanding
                            </div>
                            <div className="text-xs font-bold text-blue-900 mt-0.5">
                              {formatUSD(res.outstanding)}
                            </div>
                          </div>
                          <div className="rounded-lg bg-red-50 p-2">
                            <div className="text-[10px] uppercase font-semibold text-red-600">
                              Overdue
                            </div>
                            <div className="text-xs font-bold text-red-900 mt-0.5">
                              {formatUSD(res.overdue)}
                            </div>
                          </div>
                          <div className="rounded-lg bg-emerald-50 p-2">
                            <div className="text-[10px] uppercase font-semibold text-emerald-600">
                              Paid
                            </div>
                            <div className="text-xs font-bold text-emerald-900 mt-0.5">
                              {formatUSD(res.paid)}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  }
                }

                // 5. setGridFilter (badge)
                if (invocation.toolName === "setGridFilter") {
                  if (invocation.state === "call") {
                    return (
                      <div
                        key={invocation.toolCallId}
                        className="text-xs text-blue-500 animate-pulse"
                      >
                        Updating grid filter…
                      </div>
                    );
                  }
                  if (invocation.state === "result") {
                    const res = invocation.result as SetGridFilterResult;
                    return (
                      <div
                        key={invocation.toolCallId}
                        className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50/70 px-3 py-1.5 text-xs text-blue-800"
                      >
                        <span>🔍 Filtered grid: <strong>{res.description}</strong></span>
                        {onFilterChange && (
                          <button
                            type="button"
                            onClick={() => onFilterChange(null)}
                            className="text-[11px] font-semibold text-blue-600 hover:text-blue-900 underline ml-1 cursor-pointer"
                          >
                            Reset
                          </button>
                        )}
                      </div>
                    );
                  }
                }

                return null;
              })}
            </div>
          </div>
        ))}

        {/* Thinking indicator */}
        {isLoading && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm bg-zinc-100 px-4 py-2.5 text-sm text-zinc-500">
              <span className="inline-flex gap-1">
                <span className="animate-bounce">●</span>
                <span className="animate-bounce [animation-delay:150ms]">●</span>
                <span className="animate-bounce [animation-delay:300ms]">●</span>
              </span>
            </div>
          </div>
        )}

        {/* Stream error */}
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            ❌ {error.message}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-zinc-100 px-4 py-3">
        <form
          id="chat-form"
          onSubmit={handleSubmit}
          className="flex gap-2 items-end"
        >
          <textarea
            className="flex-1 resize-none rounded-xl border border-zinc-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 max-h-32"
            rows={1}
            value={input}
            onChange={handleInputChange}
            placeholder="Invoice Rahul $400 for logo design, due in 14 days…"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e as unknown as React.FormEvent<HTMLFormElement>);
              }
            }}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors cursor-pointer"
          >
            Send
          </button>
        </form>
        <p className="mt-1.5 text-center text-xs text-zinc-400">
          AI proposes · You approve · PayPal executes
        </p>
      </div>
    </div>
  );
}
