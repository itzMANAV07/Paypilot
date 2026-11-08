"use client";

/**
 * components/InvoiceGrid.tsx
 *
 * AG Grid Community ledger of PayPal invoices.
 *
 * Features:
 * - Sortable + filterable columns
 * - StatusChip cell renderer (Paid / Sent / Overdue / Draft / Cancelled / …)
 * - Overdue rows highlighted red
 * - Currency formatting
 * - Row selection
 * - Refresh button
 * - Loading and empty states
 * - Re-fetches when `refreshAt` prop changes (triggered by Confirm in ChatPanel)
 *
 * AG Grid v36 — imports ag-grid.css + ag-theme-quartz.css
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, RowClassParams, ICellRendererParams, IRowNode } from "ag-grid-community";
import type { LedgerRow, GridFilterSpec } from "@/lib/schemas";

// AG Grid CSS — must be imported in a client component
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";

// ---------------------------------------------------------------------------
// StatusChip cell renderer
// ---------------------------------------------------------------------------

type ChipStyle = { bg: string; text: string; label: string };

const STATUS_STYLES: Record<string, ChipStyle> = {
  PAID: { bg: "bg-emerald-100", text: "text-emerald-700", label: "Paid" },
  MARKED_AS_PAID: { bg: "bg-emerald-100", text: "text-emerald-700", label: "Paid" },
  SENT: { bg: "bg-blue-100", text: "text-blue-700", label: "Sent" },
  UNPAID: { bg: "bg-blue-100", text: "text-blue-700", label: "Unpaid" },
  DRAFT: { bg: "bg-zinc-100", text: "text-zinc-600", label: "Draft" },
  CANCELLED: { bg: "bg-zinc-200", text: "text-zinc-500", label: "Cancelled" },
  REFUNDED: { bg: "bg-purple-100", text: "text-purple-700", label: "Refunded" },
  PARTIALLY_PAID: { bg: "bg-amber-100", text: "text-amber-700", label: "Partial" },
  PAYMENT_PENDING: { bg: "bg-yellow-100", text: "text-yellow-700", label: "Pending" },
};

function StatusChip({ data, value }: ICellRendererParams<LedgerRow>) {
  const isOverdue = data?.isOverdue;
  if (isOverdue) {
    return (
      <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
        Overdue
      </span>
    );
  }
  const style = STATUS_STYLES[value as string] ?? {
    bg: "bg-zinc-100", text: "text-zinc-600", label: value,
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${style.bg} ${style.text}`}
    >
      {style.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// ActionCellRenderer — simulate payment button on unpaid rows
// ---------------------------------------------------------------------------

function ActionCellRenderer(params: ICellRendererParams<LedgerRow>) {
  const row = params.data;
  if (!row) return null;

  const isPaid = row.status === "PAID" || row.status === "MARKED_AS_PAID";
  if (isPaid) {
    return (
      <span className="text-[11px] font-medium text-emerald-600">✓ Paid</span>
    );
  }

  const onSimulate = (params.context as { onSimulatePayment?: (id: string) => void })
    ?.onSimulatePayment;

  return (
    <button
      type="button"
      onClick={() => onSimulate?.(row.id)}
      title="Sandbox demo: simulate client payment via PayPal recordPayment"
      className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 transition-colors cursor-pointer"
    >
      <span>⚡ Simulate Payment</span>
      <span className="text-[9px] text-emerald-600 font-normal">(Sandbox demo)</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Currency formatter
// ---------------------------------------------------------------------------

function currencyFormatter(params: { value: number; data?: LedgerRow }) {
  const currency = params.data?.currency ?? "USD";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(params.value ?? 0);
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

const COL_DEFS: ColDef<LedgerRow>[] = [
  {
    field: "invoiceNumber",
    headerName: "Invoice #",
    width: 130,
    filter: "agTextColumnFilter",
    sort: "desc",
  },
  {
    field: "clientName",
    headerName: "Client",
    flex: 1,
    minWidth: 130,
    filter: "agTextColumnFilter",
  },
  {
    field: "clientEmail",
    headerName: "Email",
    flex: 1,
    minWidth: 160,
    filter: "agTextColumnFilter",
    hide: true, // hidden by default; visible via column menu
  },
  {
    field: "amount",
    headerName: "Amount",
    width: 120,
    filter: "agNumberColumnFilter",
    valueFormatter: currencyFormatter,
    type: "numericColumn",
  },
  {
    field: "dueDate",
    headerName: "Due Date",
    width: 115,
    filter: "agDateColumnFilter",
    valueFormatter: (p) =>
      p.value
        ? new Date(p.value + "T00:00:00").toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
        : "—",
  },
  {
    field: "daysOverdue",
    headerName: "Days Late",
    width: 100,
    filter: "agNumberColumnFilter",
    type: "numericColumn",
    valueFormatter: (p) => (p.value > 0 ? String(p.value) : "—"),
  },
  {
    field: "status",
    headerName: "Status",
    width: 115,
    filter: "agTextColumnFilter",
    cellRenderer: StatusChip,
  },
  {
    headerName: "Actions",
    width: 220,
    cellRenderer: ActionCellRenderer,
    sortable: false,
    filter: false,
  },
];

// ---------------------------------------------------------------------------
// Row class rule — highlight overdue rows
// ---------------------------------------------------------------------------

function getRowClass(params: RowClassParams<LedgerRow>) {
  if (params.data?.isOverdue) return "ag-overdue-row";
  return undefined;
}

// ---------------------------------------------------------------------------
// InvoiceGrid component
// ---------------------------------------------------------------------------

interface Props {
  /** Increment to trigger a data refresh. */
  refreshAt?: number;
  /** Called with the latest rows after each successful fetch. */
  onRowsLoaded?: (rows: LedgerRow[]) => void;
  /** Filter spec pushed from the AI chat via setGridFilter tool. */
  externalFilter?: GridFilterSpec | null;
  /** Called when the user clears the external filter inside the grid toolbar. */
  onClearFilter?: () => void;
  /** Called when a user action completes (e.g. payment simulated) to refresh parents */
  onActionCompleted?: () => void;
}

export default function InvoiceGrid({
  refreshAt,
  onRowsLoaded,
  externalFilter,
  onClearFilter,
  onActionCompleted,
}: Props) {
  const gridRef = useRef<AgGridReact<LedgerRow>>(null);
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<{
    text: string;
    isError?: boolean;
  } | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/invoices");
      const data = (await res.json()) as {
        items?: LedgerRow[];
        error?: string;
      };
      if (!res.ok || data.error) {
        setError(data.error ?? "Failed to load invoices");
        setRows([]);
      } else {
        const loaded = data.items ?? [];
        setRows(loaded);
        setLastFetched(new Date());
        onRowsLoaded?.(loaded);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [onRowsLoaded]);

  const handleSimulatePayment = useCallback(
    async (invoiceId: string) => {
      setActionNotice({ text: `Simulating payment for ${invoiceId}…` });
      try {
        const res = await fetch(`/api/invoices/${invoiceId}/simulate-payment`, {
          method: "POST",
        });
        const data = (await res.json()) as { ok?: boolean; error?: string };

        if (!res.ok) {
          setActionNotice({
            text: data.error ?? "Failed to simulate payment",
            isError: true,
          });
          return;
        }

        setActionNotice({
          text: `✅ Payment recorded for ${invoiceId}! Status updated to PAID.`,
        });
        fetchInvoices();
        onActionCompleted?.();
      } catch (err) {
        setActionNotice({
          text: err instanceof Error ? err.message : "Network error",
          isError: true,
        });
      }
    },
    [fetchInvoices, onActionCompleted]
  );

  // Initial fetch and re-fetch when refreshAt changes
  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices, refreshAt]);

  const isExternalFilterPresent = useCallback((): boolean => {
    if (!externalFilter) return false;
    return Boolean(
      externalFilter.overdueOnly ||
        externalFilter.clientName ||
        externalFilter.minAmount !== undefined ||
        externalFilter.maxAmount !== undefined ||
        externalFilter.status
    );
  }, [externalFilter]);

  const doesExternalFilterPass = useCallback(
    (node: IRowNode<LedgerRow>): boolean => {
      const row = node.data;
      if (!row || !externalFilter) return true;
      if (externalFilter.overdueOnly && !row.isOverdue) return false;
      if (
        externalFilter.clientName &&
        !row.clientName
          .toLowerCase()
          .includes(externalFilter.clientName.toLowerCase())
      ) {
        return false;
      }
      if (
        externalFilter.minAmount !== undefined &&
        row.amount < externalFilter.minAmount
      ) {
        return false;
      }
      if (
        externalFilter.maxAmount !== undefined &&
        row.amount > externalFilter.maxAmount
      ) {
        return false;
      }
      if (externalFilter.status && row.status !== externalFilter.status) {
        return false;
      }
      return true;
    },
    [externalFilter]
  );

  useEffect(() => {
    gridRef.current?.api?.onFilterChanged();
  }, [externalFilter]);

  const filterSummary = (() => {
    if (!externalFilter) return null;
    const parts: string[] = [];
    if (externalFilter.overdueOnly) parts.push("Overdue only");
    if (externalFilter.clientName)
      parts.push(`Client: "${externalFilter.clientName}"`);
    if (externalFilter.status) parts.push(`Status: ${externalFilter.status}`);
    if (externalFilter.minAmount !== undefined)
      parts.push(`Min $${externalFilter.minAmount}`);
    if (externalFilter.maxAmount !== undefined)
      parts.push(`Max $${externalFilter.maxAmount}`);
    return parts.length > 0 ? parts.join(" · ") : null;
  })();

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-zinc-700">
            Invoice Ledger
            {!loading && rows.length > 0 && (
              <span className="ml-2 text-xs font-normal text-zinc-400">
                {rows.length} invoice{rows.length !== 1 ? "s" : ""}
              </span>
            )}
          </span>
          {filterSummary && (
            <div className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 border border-blue-200 px-2.5 py-0.5 text-xs text-blue-700">
              <span>🔍 {filterSummary}</span>
              {onClearFilter && (
                <button
                  type="button"
                  onClick={onClearFilter}
                  className="ml-0.5 font-bold text-blue-600 hover:text-blue-900 cursor-pointer"
                  title="Clear filter"
                >
                  ✕
                </button>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {lastFetched && (
            <span className="text-xs text-zinc-400">
              Updated {lastFetched.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={fetchInvoices}
            disabled={loading}
            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 transition-colors cursor-pointer"
          >
            {loading ? "Loading…" : "↻ Refresh"}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          ❌ {error}
        </div>
      )}

      {/* Action Notification */}
      {actionNotice && (
        <div
          className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs ${
            actionNotice.isError
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}
        >
          <span>{actionNotice.text}</span>
          <button
            type="button"
            onClick={() => setActionNotice(null)}
            className="font-bold opacity-60 hover:opacity-100 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Grid */}
      <div
        className="ag-theme-quartz flex-1 min-h-0"
        style={{ width: "100%" }}
      >
        <style>{`
          .ag-overdue-row {
            background-color: #fef2f2 !important;
          }
          .ag-overdue-row:hover .ag-cell {
            background-color: #fee2e2 !important;
          }
        `}</style>

        {loading && rows.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-zinc-400">
            Loading invoices…
          </div>
        ) : !loading && rows.length === 0 && !error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-zinc-400">
            <span className="text-3xl">📭</span>
            <p>No invoices yet. Create one using the chat.</p>
          </div>
        ) : (
          <AgGridReact<LedgerRow>
            ref={gridRef}
            rowData={rows}
            columnDefs={COL_DEFS}
            defaultColDef={{
              sortable: true,
              resizable: true,
              suppressMovable: false,
            }}
            context={{ onSimulatePayment: handleSimulatePayment }}
            isExternalFilterPresent={isExternalFilterPresent}
            doesExternalFilterPass={doesExternalFilterPass}
            rowSelection={{ mode: "singleRow" }}
            getRowClass={getRowClass}
            animateRows
            pagination
            paginationPageSize={20}
            domLayout="autoHeight"
            noRowsOverlayComponent={() => (
              <span className="text-sm text-zinc-400">No invoices found.</span>
            )}
            loadingOverlayComponent={() => (
              <span className="text-sm text-zinc-400">Loading…</span>
            )}
          />
        )}
      </div>
    </div>
  );
}
