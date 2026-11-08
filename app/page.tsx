"use client";

/**
 * app/page.tsx
 *
 * Phase 3 layout:
 * - Desktop: grid + cashflow cards on the left (flex-[3]), chat on the right (flex-[2])
 * - Mobile: grid/cards on top, chat below (stacked, min-height for chat)
 *
 * Data flow for grid auto-refresh:
 *   ChatPanel.onInvoiceCreated → setRefreshAt(Date.now())
 *   InvoiceGrid watches refreshAt → re-fetches
 *   InvoiceGrid.onRowsLoaded → setLedgerRows → CashflowCards updates
 */

import { useState, useCallback } from "react";
import dynamic from "next/dynamic";
import CashflowCards from "@/components/CashflowCards";
import AuditDrawer from "@/components/AuditDrawer";
import type { LedgerRow, GridFilterSpec } from "@/lib/schemas";

// Client-only: useChat (browser streaming) and AG Grid
const ChatPanel = dynamic(() => import("@/components/ChatPanel"), {
  ssr: false,
  loading: () => (
    <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
      Loading chat…
    </div>
  ),
});

const InvoiceGrid = dynamic(() => import("@/components/InvoiceGrid"), {
  ssr: false,
  loading: () => (
    <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
      Loading ledger…
    </div>
  ),
});

export default function Home() {
  // Incrementing refreshAt tells InvoiceGrid to re-fetch
  const [refreshAt, setRefreshAt] = useState<number>(0);
  // Grid rows lifted here so CashflowCards shares the same data
  const [ledgerRows, setLedgerRows] = useState<LedgerRow[]>([]);
  const [gridLoading, setGridLoading] = useState(true);
  // Filter spec driven by AI setGridFilter tool
  const [gridFilter, setGridFilter] = useState<GridFilterSpec | null>(null);
  // Audit log drawer visibility & refresh trigger
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditTrigger, setAuditTrigger] = useState<number>(0);

  const handleInvoiceCreated = useCallback(() => {
    setRefreshAt(Date.now());
    setAuditTrigger(Date.now());
  }, []);

  const handleActionCompleted = useCallback(() => {
    setRefreshAt(Date.now());
    setAuditTrigger(Date.now());
  }, []);

  const handleRowsLoaded = useCallback((rows: LedgerRow[]) => {
    setLedgerRows(rows);
    setGridLoading(false);
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* ── Sandbox Demo Banner ────────────────────────────────────────── */}
      <div className="bg-amber-500 text-amber-950 px-4 py-1.5 text-center text-xs font-semibold tracking-wide flex items-center justify-center gap-2 border-b border-amber-600/30 flex-shrink-0 shadow-xs">
        <span className="text-sm">⚠️</span>
        <span>
          <strong>Sandbox Demo</strong> — No real money is moved. All invoices and payments run in the PayPal Sandbox environment.
        </span>
      </div>

      {/* ── Top bar ─────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-3 shadow-xs flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-2xl">✈️</span>
          <span className="text-lg font-bold text-zinc-900">PayPilot</span>
          <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
            Sandbox
          </span>
        </div>
        <div className="flex items-center gap-4">
          <p className="hidden text-xs text-zinc-400 sm:block">
            AI proposes · You approve · PayPal executes
          </p>
          <button
            type="button"
            onClick={() => setAuditOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 transition-colors shadow-2xs cursor-pointer"
          >
            <span>📜</span>
            <span>Audit Log</span>
          </button>
        </div>
      </header>

      {/* ── Main area ───────────────────────────────────────────────── */}
      {/* Mobile: col (grid on top, chat below) | Desktop: row (grid left, chat right) */}
      <main className="flex flex-1 flex-col overflow-hidden md:flex-row">

        {/* Left: cashflow cards + invoice grid */}
        <section className="flex flex-col overflow-hidden border-b border-zinc-200 md:border-b-0 md:border-r md:flex-[3] bg-zinc-50 min-h-[300px] md:min-h-0">
          <div className="flex flex-col h-full overflow-hidden p-4 gap-4">
            <CashflowCards rows={ledgerRows} loading={gridLoading} />
            <div className="flex-1 min-h-0">
              <InvoiceGrid
                refreshAt={refreshAt}
                onRowsLoaded={handleRowsLoaded}
                externalFilter={gridFilter}
                onClearFilter={() => setGridFilter(null)}
                onActionCompleted={handleActionCompleted}
              />
            </div>
          </div>
        </section>

        {/* Right: chat panel */}
        <section className="flex flex-col overflow-hidden md:flex-[2] bg-white min-h-[400px] md:min-h-0">
          <ChatPanel
            onInvoiceCreated={handleInvoiceCreated}
            onFilterChange={setGridFilter}
          />
        </section>

      </main>

      {/* ── Audit Drawer ────────────────────────────────────────────── */}
      <AuditDrawer
        isOpen={auditOpen}
        onClose={() => setAuditOpen(false)}
        refreshTrigger={auditTrigger}
      />
    </div>
  );
}
