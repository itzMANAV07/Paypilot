/**
 * lib/audit.ts
 *
 * In-memory action audit log. Persists to `audit-log.json` in the project
 * root so entries survive a hot-reload in dev. In production on Render, the
 * in-memory log is fine — the JSON write is best-effort.
 *
 * Rules (AGENTS.md): the LLM never triggers these writes.
 * Writes happen only from server-side API route handlers (user-approved actions).
 */

import fs from "fs";
import path from "path";

export type AuditAction =
  | "INVOICE_CREATED_AND_SENT"
  | "REMINDER_SENT"
  | "PAYMENT_SIMULATED"
  | "INVOICE_CANCELLED";

export interface AuditEntry {
  id: string;
  action: AuditAction;
  invoiceId: string;
  details: Record<string, unknown>;
  timestamp: string; // ISO 8601
}

// ---------------------------------------------------------------------------
// In-memory store (shared across requests in the same Node.js process)
// ---------------------------------------------------------------------------

let entries: AuditEntry[] = [];
let loaded = false;

function getLogPath(): string {
  return process.env.AUDIT_LOG_PATH || path.join(process.cwd(), "audit-log.json");
}

/** Load any previously persisted entries on first use. */
function maybeLoad() {
  if (loaded) return;
  loaded = true;
  try {
    const logPath = getLogPath();
    if (fs.existsSync(logPath)) {
      const raw = fs.readFileSync(logPath, "utf8");
      entries = JSON.parse(raw) as AuditEntry[];
    }
  } catch {
    // Best-effort — ignore read errors
  }
}

/** Persist the in-memory log to disk (best-effort). */
function maybePersist() {
  try {
    fs.writeFileSync(getLogPath(), JSON.stringify(entries, null, 2), "utf8");
  } catch {
    // Best-effort — ignore write errors (e.g. read-only FS on Render free tier)
  }
}

/** Append a new entry to the audit log. */
export function writeAuditEntry(
  action: AuditAction,
  invoiceId: string,
  details: Record<string, unknown> = {}
): AuditEntry {
  maybeLoad();
  const entry: AuditEntry = {
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    action,
    invoiceId,
    details,
    timestamp: new Date().toISOString(),
  };
  entries.push(entry);
  maybePersist();
  return entry;
}

/** Return all audit entries (newest first). */
export function getAuditLog(): AuditEntry[] {
  maybeLoad();
  return [...entries].reverse();
}

/** Clear the log (useful in tests). */
export function clearAuditLog(): void {
  loaded = true;
  entries = [];
  try {
    const logPath = getLogPath();
    if (fs.existsSync(logPath)) {
      fs.unlinkSync(logPath);
    }
  } catch {
    // Best-effort
  }
}

