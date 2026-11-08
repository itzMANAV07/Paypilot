/**
 * app/api/audit/route.ts
 *
 * GET /api/audit
 *
 * Returns all recorded audit log entries (newest first).
 */

import { NextResponse } from "next/server";
import { getAuditLog } from "@/lib/audit";

export async function GET() {
  const entries = getAuditLog();
  return NextResponse.json({ entries });
}

