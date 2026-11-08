"use client";

/**
 * components/CashflowCards.tsx
 *
 * Three summary cards above the AG Grid ledger:
 *  - Outstanding (SENT, not yet due)
 *  - Overdue     (SENT, past due date)
 *  - Paid total  (PAID + MARKED_AS_PAID)
 *
 * Props: LedgerRow[] — same data the grid uses, computed here client-side.
 */

import type { LedgerRow } from "@/lib/schemas";
import { computeCashflow } from "@/lib/ledger";

interface Props {
  rows: LedgerRow[];
  loading?: boolean;
}

function fmt(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

interface CardProps {
  label: string;
  value: string;
  accent: string; // Tailwind colour classes
  icon: string;
  loading?: boolean;
}

function Card({ label, value, accent, icon, loading }: CardProps) {
  return (
    <div className={`rounded-xl border ${accent} bg-white p-4 shadow-sm flex-1 min-w-0`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
          {label}
        </span>
        <span className="text-lg">{icon}</span>
      </div>
      {loading ? (
        <div className="h-7 w-24 animate-pulse rounded bg-zinc-100" />
      ) : (
        <p className="text-xl font-bold text-zinc-900 font-mono truncate">
          {value}
        </p>
      )}
    </div>
  );
}

export default function CashflowCards({ rows, loading }: Props) {
  const cf = computeCashflow(rows);
  const currency = cf.currency || "USD";

  return (
    <div className="flex gap-3 flex-wrap">
      <Card
        label="Outstanding"
        value={fmt(cf.outstanding, currency)}
        accent="border-blue-200"
        icon="📋"
        loading={loading}
      />
      <Card
        label="Overdue"
        value={fmt(cf.overdue, currency)}
        accent={cf.overdue > 0 ? "border-red-300" : "border-zinc-200"}
        icon="⚠️"
        loading={loading}
      />
      <Card
        label="Paid (total)"
        value={fmt(cf.paid, currency)}
        accent="border-emerald-200"
        icon="✅"
        loading={loading}
      />
    </div>
  );
}

