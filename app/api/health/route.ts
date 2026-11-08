/**
 * app/api/health/route.ts
 *
 * GET /api/health
 *
 * Health check endpoint for Render deployments and uptime monitors.
 */

import { NextResponse } from "next/server";
import { env } from "@/lib/env";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    demoMode: env.DEMO_MODE,
    paypalEnv: env.PAYPAL_ENV,
  });
}

